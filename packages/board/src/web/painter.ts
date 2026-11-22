/**
 * `BoardPainter` on the web (design 3, 6.3, 8, 9): layer 4. Four canvases stack in one element: the tiles (WebGL 2 on the
 * view package's back-end, Canvas 2D as the backup), the live layer (a 2D canvas that asks for `desynchronized`, where
 * the stroke being drawn grows), the top layer (the shapes that are above a figure card, drawn over the card layer that
 * sits between the tiles and the live layer), and the overlay (selection, lasso, laser, the eraser's ring, the tail of
 * the stroke and its predicted samples). The tile cache is the core's `TileCache` (512 device pixel tiles at power-of-two zoom steps,
 * least recently used, capped); this file keeps the pictures. States: the back-end (B15), the frame (B16) and the live
 * layer (B17) are `*_MACHINE` tables in docs/state-machines.md. Every call returns a `BoardResult`; nothing throws.
 */
import { StateMachine } from '@incantly/kernel';
import { sendIfAble } from '../core/machine';
import type { MachineTable } from '@incantly/kernel';
import type { CameraView } from '../core/camera';
import { TILE_CAP_BYTES, TILE_CAP_BYTES_LOW, TileCache } from '../core/draw';
import type { BoardPainter, DrawItem, LiveStrokeView, OverlayItems, SelectionView, Tile, TileContent } from '../core/draw';
import { boardError, DONE, refusedMove } from '../core/errors';
import type { BoardError, BoardResult } from '../core/errors';
import { GlRaster } from './painter-gl';
import { CanvasRaster, drawItems2D, fillTriangles, rgbCss } from './painter-2d';
import { LiveGl } from './painter-live';
import type { ImageLookup, TileRaster } from './painter-2d';

type BackendState = 'gl' | 'lost' | 'canvas2d';
type BackendEvent = 'contextLost' | 'contextRestored' | 'fail';

export const BACKEND_MACHINE: MachineTable<BackendState, BackendEvent> = {
  gl: { contextLost: 'lost', fail: 'canvas2d' },
  lost: { contextRestored: 'gl', fail: 'canvas2d' },
  canvas2d: {},
};

type FrameState = 'between' | 'drawing';
type FrameEvent = 'begin' | 'end';

export const FRAME_MACHINE: MachineTable<FrameState, FrameEvent> = {
  between: { begin: 'drawing' },
  drawing: { end: 'between' },
};

type LayerState = 'clear' | 'inking' | 'holding';
type LayerEvent = 'ink' | 'release' | 'abort' | 'settle';

export const LIVELAYER_MACHINE: MachineTable<LayerState, LayerEvent> = {
  clear: { ink: 'inking' },
  inking: { ink: 'inking', release: 'holding', abort: 'clear' },
  holding: { settle: 'clear' },
};

/** The last points of a live stroke are not final yet (the smoothing looks 2 points ahead, widths 1 more): they go to the overlay. */
export const LIVE_LAG = 5;

export interface WebPainterOptions {
  /** Bytes the tile pictures may hold; default 64 MB, 24 MB on a device with 4 GB or less. */
  readonly capBytes?: number;
  /** Draw with Canvas 2D only (a host that wants no GPU, and tests). */
  readonly canvas2dOnly?: boolean;
  /** Called once with `render_failed` when the board falls back to Canvas 2D. */
  readonly onNotice?: (error: BoardError) => void;
  /** Called when the painter wants a frame (a lost context came back). */
  readonly requestFrame?: () => void;
  /** Where a refused move of the painter's machines is told (the board's `onError`, as `internal`). */
  readonly onError?: (error: BoardError) => void;
}

/** A shape drawn over figure cards: its draw item, and the card outlines (page units, `[x0, y0, …]`) it shows inside. */
export interface OverCardItem {
  readonly item: DrawItem;
  readonly clip: readonly (readonly number[])[];
}

export interface PainterStats {
  readonly backend: BackendState;
  /** Tiles drawn since the painter was made. */
  readonly tilesDrawn: number;
  /** GPU draw calls of the last composed frame (0 with Canvas 2D). */
  readonly drawCalls: number;
}

const cssOf = (c: HTMLCanvasElement): void => {
  const s = c.style;
  s.position = 'absolute';
  s.left = '0';
  s.top = '0';
  s.display = 'block';
};

export class WebPainter implements BoardPainter {
  /** The element to put in the page: the stacked canvases. */
  readonly element: HTMLDivElement;
  readonly tiles: TileCache;
  readonly #options: WebPainterOptions;
  readonly #backend = new StateMachine(BACKEND_MACHINE, 'gl', refusedMove('painter backend', () => this.#options.onError));
  readonly #frameState = new StateMachine(FRAME_MACHINE, 'between', refusedMove('painter frame', () => this.#options.onError));
  readonly #layer = new StateMachine(LIVELAYER_MACHINE, 'clear', refusedMove('live layer', () => this.#options.onError));
  #tileCanvas: HTMLCanvasElement;
  readonly #liveCanvas: HTMLCanvasElement;
  readonly #overlayCanvas: HTMLCanvasElement;
  readonly #topCanvas: HTMLCanvasElement;
  /** The live layer's drawing: WebGL 2 where the browser has it (the stroke and its tail from typed arrays), else a 2D context. */
  #liveGl: LiveGl | null = null;
  /** The numbers a live frame hands to the GL layer, written again each frame. */
  readonly #liveParams = new Float64Array(7);
  readonly #live: CanvasRenderingContext2D | null;
  readonly #overlay: CanvasRenderingContext2D | null;
  readonly #top: CanvasRenderingContext2D | null;
  /** True while the top layer holds a picture, so an empty frame clears it once and then costs nothing. */
  #topDrawn = false;
  #raster: TileRaster | null = null;
  /** Where image shapes get their pictures; handed to every raster the painter opens. */
  #images: ImageLookup = () => null;
  readonly #shown: Tile[] = [];
  readonly #extra: DrawItem[] = [];
  #tail: LiveStrokeView | null = null;
  /** The camera and pixel ratio of the frame being built. */
  readonly frame = { x: 0, y: 0, zoom: 1, dpr: 1 };
  /** The size of the surface in CSS and device pixels. */
  readonly size = { w: 1, h: 1, devW: 1, devH: 1 };
  /** The live layer's marks: which stroke, how many groups are on it, the camera it was drawn under. */
  readonly ink = { serial: -1, drawn: 0, x: 0, y: 0, zoom: 1, dpr: 1 };
  readonly #counters = { tilesDrawn: 0, drawCalls: 0 };
  /**
   * What the tile canvas shows now: the camera, the size, how many tiles had been drawn and which tiles were put on it. A
   * frame that would put the same picture there again does not (a stroke being drawn changes the live layer and the
   * overlay, never the tiles, so it costs the GPU and the garbage collector nothing).
   */
  readonly #screen = { x: Number.NaN, y: Number.NaN, zoom: Number.NaN, dpr: Number.NaN, devW: 0, devH: 0, drawn: -1 };
  readonly #composed: Tile[] = [];
  readonly #stops: (() => void)[] = [];
  readonly #liveStops: (() => void)[] = [];

  constructor(options: WebPainterOptions = {}) {
    this.#options = options;
    const memory = (typeof navigator !== 'undefined' ? (navigator as { deviceMemory?: number }).deviceMemory : undefined) ?? 8;
    this.tiles = new TileCache({
      capBytes: options.capBytes ?? (memory <= 4 ? TILE_CAP_BYTES_LOW : TILE_CAP_BYTES),
      release: (tile) => this.#raster?.release(tile),
      ...(options.onError !== undefined ? { report: options.onError } : {}),
    });
    this.element = document.createElement('div');
    this.element.style.cssText = 'position:relative;overflow:hidden;width:100%;height:100%';
    this.#tileCanvas = document.createElement('canvas');
    this.#liveCanvas = document.createElement('canvas');
    this.#overlayCanvas = document.createElement('canvas');
    this.#topCanvas = document.createElement('canvas');
    for (const c of [this.#tileCanvas, this.#liveCanvas, this.#topCanvas, this.#overlayCanvas]) cssOf(c);
    this.#liveCanvas.style.pointerEvents = 'none';
    this.#topCanvas.style.pointerEvents = 'none';
    this.#overlayCanvas.style.pointerEvents = 'none';
    this.element.append(this.#tileCanvas, this.#liveCanvas, this.#topCanvas, this.#overlayCanvas);
    if (options.canvas2dOnly !== true) this.#liveGl = LiveGl.open(this.#liveCanvas);
    this.#live = this.#liveGl === null ? this.#context(this.#liveCanvas, { alpha: true, desynchronized: true }) : null;
    if (this.#liveGl !== null) this.#watchLive();
    this.#top = this.#context(this.#topCanvas, { alpha: true });
    this.#overlay = this.#context(this.#overlayCanvas, { alpha: true });
    this.#openRaster();
  }

  #context(canvas: HTMLCanvasElement, attributes: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null {
    try {
      return canvas.getContext('2d', attributes);
    } catch {
      return null;
    }
  }

  /** The live layer's GL context may be lost and come back: the layer is opened again on the same canvas and the stroke drawn again. */
  #watchLive(): void {
    const canvas = this.#liveCanvas;
    const lost = (e: Event): void => e.preventDefault();
    const restored = (): void => {
      this.#liveGl = LiveGl.open(canvas);
      this.#liveGl?.resize(this.size.devW, this.size.devH);
      this.ink.serial = -1;
      this.ink.drawn = 0;
      this.#options.requestFrame?.();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    this.#liveStops.push(() => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    });
  }

  /**
   * Puts the card layer in the stack: above the tiles, below the live stroke, the top layer and the overlay, so ink and
   * arrows drawn over a card show over it and handles and guides over both.
   */
  mountCards(layer: HTMLElement): void {
    this.#tileCanvas.after(layer);
  }

  /** Sets where the pictures of image shapes come from; tiles that hold images are drawn again by the caller when one arrives. */
  setImages(lookup: ImageLookup): void {
    this.#images = lookup;
    this.#raster?.setImages(lookup);
  }

  /** `gl`, `lost` or `canvas2d`. */
  get backend(): BackendState {
    return this.#backend.state;
  }

  get stats(): PainterStats {
    return { backend: this.#backend.state, tilesDrawn: this.#counters.tilesDrawn, drawCalls: this.#counters.drawCalls };
  }

  /** The live layer's state: `clear`, `inking` or `holding`. */
  get liveState(): LayerState {
    return this.#layer.state;
  }

  // ------------------------------------------------------------------------------------------------ setting up

  #openRaster(): void {
    if (this.#options.canvas2dOnly !== true) {
      const gl = GlRaster.open(this.#tileCanvas);
      if (gl.ok) {
        this.#raster = gl.value;
        gl.value.setImages(this.#images);
        const lost = (e: Event): void => {
          e.preventDefault();
          if (this.#backend.send('contextLost')) this.tiles.lose();
        };
        const restored = (): void => this.#restore();
        this.#tileCanvas.addEventListener('webglcontextlost', lost);
        this.#tileCanvas.addEventListener('webglcontextrestored', restored);
        const canvas = this.#tileCanvas;
        this.#stops.push(() => {
          canvas.removeEventListener('webglcontextlost', lost);
          canvas.removeEventListener('webglcontextrestored', restored);
        });
        return;
      }
      this.#fallBack(gl);
      return;
    }
    this.#backend.send('fail');
    this.#openCanvasRaster();
  }

  /** The Canvas 2D raster, on a fresh canvas (a canvas that had a GPU context cannot give a 2D one). */
  #openCanvasRaster(): void {
    for (const stop of this.#stops.splice(0)) stop();
    const fresh = document.createElement('canvas');
    cssOf(fresh);
    this.element.replaceChild(fresh, this.#tileCanvas);
    this.#tileCanvas = fresh;
    const r = CanvasRaster.open(fresh);
    this.#raster = r.ok ? r.value : null;
    if (r.ok) r.value.setImages(this.#images);
    if (this.size.devW > 1 || this.size.devH > 1) this.#applySize();
  }

  /** WebGL 2 failed: tell the host once and draw with Canvas 2D from now on. */
  #fallBack(error: BoardError): void {
    if (!this.#backend.send('fail')) return;
    this.#screen.drawn = -1;
    this.tiles.lose();
    this.#raster?.dispose();
    this.#raster = null;
    this.#openCanvasRaster();
    this.tiles.invalidateAll();
    try {
      this.#options.onNotice?.(error);
    } catch {
      // the host's handler failed; the board still draws
    }
  }

  /** The context came back: build the GPU pieces again, or fall back. */
  #restore(): void {
    if (this.#backend.state !== 'lost') return;
    this.#raster?.dispose();
    const gl = GlRaster.open(this.#tileCanvas);
    if (!gl.ok) {
      this.#fallBack(gl);
      return;
    }
    this.#raster = gl.value;
    this.#screen.drawn = -1;
    gl.value.setImages(this.#images);
    this.#backend.send('contextRestored');
    this.tiles.invalidateAll();
    this.#applySize();
    this.#options.requestFrame?.();
  }

  /** Sets the size: `cssW × cssH` CSS pixels at `dpr` device pixels each. */
  resize(cssW: number, cssH: number, dpr: number): void {
    const w = Math.max(1, Math.floor(cssW));
    const h = Math.max(1, Math.floor(cssH));
    const ratio = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
    if (w === this.size.w && h === this.size.h && ratio === this.frame.dpr && this.#raster !== null) return;
    this.size.w = w;
    this.size.h = h;
    this.size.devW = Math.max(1, Math.round(w * ratio));
    this.size.devH = Math.max(1, Math.round(h * ratio));
    this.frame.dpr = ratio;
    this.#applySize();
  }

  #applySize(): void {
    const { w, h, devW, devH } = this.size;
    for (const c of [this.#tileCanvas, this.#liveCanvas, this.#topCanvas, this.#overlayCanvas]) {
      c.width = devW;
      c.height = devH;
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
    }
    // changing a canvas's size empties it: the live layer starts again from the stroke's first group, and the tiles are composed again
    this.#screen.drawn = -1;
    this.ink.drawn = 0;
    this.ink.serial = -1;
    this.#topDrawn = false;
    this.#liveGl?.resize(devW, devH);
    const raster = this.#raster?.resize(devW, devH);
    if (raster !== undefined && !raster.ok) this.#fallBack(raster);
  }

  // ------------------------------------------------------------------------------------------------ the frame

  beginFrame(camera: CameraView, dpr: number): BoardResult<undefined> {
    if (!this.#frameState.send('begin')) return boardError('bad_argument', 'A frame is already open; end it first.', { detail: { field: 'beginFrame' } });
    this.frame.x = camera.x;
    this.frame.y = camera.y;
    this.frame.zoom = camera.zoom;
    if (dpr > 0 && Number.isFinite(dpr) && dpr !== this.frame.dpr) {
      this.frame.dpr = dpr;
      this.size.devW = Math.max(1, Math.round(this.size.w * dpr));
      this.size.devH = Math.max(1, Math.round(this.size.h * dpr));
      this.#applySize();
    }
    this.#shown.length = 0;
    this.#extra.length = 0;
    this.#tail = null;
    return DONE;
  }

  /**
   * Shows a tile. With `content` the tile's picture is drawn first; on the GPU a tile with many shapes stops after `until` (a
   * `performance.now` time) and goes on the next time it is called with the same `content`, and it is drawn (fresh) when the
   * last slice is. The Canvas 2D backup always draws a tile whole.
   */
  drawTile(tile: Tile, content: TileContent | null, until?: number): BoardResult<undefined> {
    if (this.#frameState.state !== 'drawing') return this.#outside('drawTile');
    if (this.#backend.state === 'lost') return DONE;
    if (content !== null) {
      const raster = this.#raster;
      if (raster === null) return boardError('render_failed', 'The board has no way to draw.', { detail: { backend: this.#backend.state } });
      // the Canvas 2D backup draws a tile whole: the shapes whose items are not made yet are made now
      if (content.more !== undefined && !(raster instanceof GlRaster)) while (!content.more(1 << 20)) continue;
      let drawn = raster.render(tile, content, until);
      if (!drawn.ok && this.#backend.state === 'gl') {
        this.#fallBack(drawn);
        // the slices not made yet are made now
        if (content.more !== undefined) while (!content.more(1 << 20)) continue;
        drawn = this.#raster === null ? drawn : (this.#raster as TileRaster).render(tile, content);
      }
      if (!drawn.ok) return drawn;
      if (raster instanceof GlRaster && raster.pending === tile && this.#backend.state === 'gl') {
        if (tile.state === 'fresh' || tile.state === 'stale') this.#shown.push(tile);
        return DONE;
      }
      this.tiles.markDrawn(tile);
      this.#counters.tilesDrawn++;
    }
    if (tile.state === 'fresh' || tile.state === 'stale') this.#shown.push(tile);
    return DONE;
  }

  drawItems(items: readonly DrawItem[]): BoardResult<undefined> {
    if (this.#frameState.state !== 'drawing') return this.#outside('drawItems');
    this.#extra.push(...items);
    return DONE;
  }

  /**
   * Draws the shapes that are above a figure card on the top layer, each clipped to the outlines (page units) of the
   * cards it is above, so it shows over the card and nowhere else. The layer is drawn again every frame; an empty list
   * clears it.
   */
  drawOverCards(entries: readonly OverCardItem[]): BoardResult<undefined> {
    if (this.#frameState.state !== 'drawing') return this.#outside('drawOverCards');
    const ctx = this.#top;
    if (ctx === null) return DONE;
    if (entries.length === 0 && !this.#topDrawn) return DONE;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.#topCanvas.width, this.#topCanvas.height);
    this.#topDrawn = entries.length > 0;
    const { dpr, zoom, x: camX, y: camY } = this.frame;
    const k = zoom * dpr;
    for (const entry of entries) {
      ctx.save();
      ctx.beginPath();
      for (const poly of entry.clip) {
        for (let i = 0; i + 1 < poly.length; i += 2) {
          const x = ((poly[i] as number) - camX) * k;
          const y = ((poly[i + 1] as number) - camY) * k;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      ctx.clip();
      drawItems2D(ctx, [entry.item], k, camX, camY, this.#images);
      ctx.restore();
    }
    return DONE;
  }

  /**
   * Grows the stroke being drawn on the live layer: only the groups that became final since the last frame are drawn,
   * with one group of overlap so no seam shows. The groups not final yet are drawn on the overlay by `drawOverlay`.
   */
  drawLiveStroke(view: LiveStrokeView | null): BoardResult<undefined> {
    if (this.#frameState.state !== 'drawing') return this.#outside('drawLiveStroke');
    const ctx = this.#live;
    if (view === null) {
      if (this.#layer.state === 'inking') this.abortLive();
      return DONE;
    }
    const gl = this.#liveGl;
    if (gl !== null) return this.#drawLiveGl(gl, view);
    if (ctx === null || this.#layer.state === 'holding') return DONE;
    this.#layer.send('ink');
    const f = this.frame;
    const ink = this.ink;
    const moved = ink.x !== f.x || ink.y !== f.y || ink.zoom !== f.zoom || ink.dpr !== f.dpr;
    if (view.serial !== ink.serial || moved) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.#liveCanvas.width, this.#liveCanvas.height);
      ink.serial = view.serial;
      ink.drawn = 0;
      ink.x = f.x;
      ink.y = f.y;
      ink.zoom = f.zoom;
      ink.dpr = f.dpr;
      this.#liveCanvas.style.opacity = String(view.opacity);
      this.#liveCanvas.style.mixBlendMode = view.multiply ? 'multiply' : 'normal';
    }
    const o = view.outliner;
    const finalGroups = Math.max(0, o.groups - LIVE_LAG);
    if (finalGroups > ink.drawn) {
      const from = o.marks[Math.max(0, ink.drawn - 1)] as number;
      const to = o.marks[finalGroups] as number;
      const k = f.zoom * f.dpr;
      ctx.setTransform(k, 0, 0, k, (view.originX - f.x) * k, (view.originY - f.y) * k);
      ctx.fillStyle = rgbCss(view.r, view.g, view.b);
      fillTriangles(ctx, o.vertices, o.indices, from, to);
      ink.drawn = finalGroups;
    }
    this.#tail = view;
    return DONE;
  }

  /**
   * The live layer on WebGL 2: the whole stroke so far, tail groups and predicted samples included, drawn again from the
   * outliner's typed arrays each frame. (The Canvas 2D layer cannot take things back, so it draws only what is final and
   * leaves the rest to the overlay; a canvas cleared and drawn again can.)
   */
  #drawLiveGl(gl: LiveGl, view: LiveStrokeView): BoardResult<undefined> {
    if (this.#layer.state === 'holding') return DONE;
    this.#layer.send('ink');
    const f = this.frame;
    const ink = this.ink;
    if (view.serial !== ink.serial) {
      ink.serial = view.serial;
      this.#liveCanvas.style.opacity = String(view.opacity);
      this.#liveCanvas.style.mixBlendMode = view.multiply ? 'multiply' : 'normal';
    }
    ink.x = f.x;
    ink.y = f.y;
    ink.zoom = f.zoom;
    ink.dpr = f.dpr;
    const o = view.outliner;
    const { devW, devH, w, h } = this.size;
    const k = f.zoom * f.dpr;
    gl.clear();
    const q = this.#liveParams;
    q[0] = (2 * k) / devW;
    q[1] = (-2 * k) / devH;
    q[2] = (2 * (view.originX - f.x) * k) / devW - 1;
    q[3] = 1 - (2 * (view.originY - f.y) * k) / devH;
    q[4] = view.r;
    q[5] = view.g;
    q[6] = view.b;
    gl.drawStroke(o.vertices, o.vertexCount, o.indices, o.indexCount, q);
    const p = view.predicted;
    if (p !== null && p.count > 1) {
      q[0] = Math.max(1, view.size * f.zoom * 0.7);
      q[1] = w;
      q[2] = h;
      q[3] = view.r;
      q[4] = view.g;
      q[5] = view.b;
      q[6] = 0.5;
      gl.drawTail(p.xy, p.count, q);
    }
    return DONE;
  }

  /** The stroke ended and was stored: the live layer keeps showing it until the tile that holds it is drawn. */
  releaseLive(): void {
    sendIfAble(this.#layer, 'release');
  }

  /** The tile that holds the stroke is drawn: the live layer lets go. */
  settleLive(): void {
    if (sendIfAble(this.#layer, 'settle')) this.#clearLive();
  }

  /** The stroke was dropped. */
  abortLive(): void {
    if (sendIfAble(this.#layer, 'abort')) this.#clearLive();
  }

  #clearLive(): void {
    this.#liveGl?.clear();
    const ctx = this.#live;
    if (ctx !== null) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.#liveCanvas.width, this.#liveCanvas.height);
    }
    this.ink.serial = -1;
    this.ink.drawn = 0;
  }

  drawOverlay(overlay: OverlayItems): BoardResult<undefined> {
    if (this.#frameState.state !== 'drawing') return this.#outside('drawOverlay');
    const ctx = this.#overlay;
    if (ctx === null) return DONE;
    const { dpr, zoom, x: camX, y: camY } = this.frame;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.#overlayCanvas.width, this.#overlayCanvas.height);
    const k = zoom * dpr;
    // items that are in no tile
    drawItems2D(ctx, this.#extra, k, camX, camY, this.#images);
    ctx.globalAlpha = 1;
    // the part of the live stroke that is not final yet, and its predicted tail
    const tail = this.#tail;
    if (tail !== null) {
      const o = tail.outliner;
      const finalGroups = Math.max(0, o.groups - LIVE_LAG);
      ctx.setTransform(k, 0, 0, k, (tail.originX - camX) * k, (tail.originY - camY) * k);
      ctx.globalAlpha = tail.opacity;
      ctx.fillStyle = rgbCss(tail.r, tail.g, tail.b);
      fillTriangles(ctx, o.vertices, o.indices, o.marks[Math.max(0, finalGroups - 1)] as number, o.marks[o.groups] as number);
      const p = tail.predicted;
      if (p !== null && p.count > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = tail.opacity * 0.5;
        ctx.strokeStyle = rgbCss(tail.r, tail.g, tail.b);
        ctx.lineWidth = Math.max(1, tail.size * zoom * 0.7);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < p.count; i++) {
          const px = p.xy[i * 2] as number;
          const py = p.xy[i * 2 + 1] as number;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.#drawChrome(ctx, overlay);
    return DONE;
  }

  /** A closed path of page points `[x0, y0, …]` in CSS pixels. */
  #polygon(ctx: CanvasRenderingContext2D, pts: readonly number[]): void {
    const { x: camX, y: camY, zoom } = this.frame;
    ctx.beginPath();
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const x = ((pts[i] as number) - camX) * zoom;
      const y = ((pts[i + 1] as number) - camY) * zoom;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /** The outline of each selected shape, the frame round them, and the handles at the same size at every zoom. */
  #drawSelection(ctx: CanvasRenderingContext2D, sel: SelectionView): void {
    const { x: camX, y: camY, zoom } = this.frame;
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (const outline of sel.outlines) {
      if (outline.length < 6) continue;
      this.#polygon(ctx, outline);
      ctx.stroke();
    }
    if (sel.frame !== null) {
      ctx.lineWidth = 1.5;
      this.#polygon(ctx, sel.frame);
      ctx.stroke();
    }
    for (const h of sel.handles) {
      const x = (h.x - camX) * zoom;
      const y = (h.y - camY) * zoom;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (h.kind === 'resize') ctx.rect(x - 4, y - 4, 8, 8);
      else ctx.arc(x, y, h.kind === 'rotate' ? 5 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** Selection, lasso loop, laser trail and the cursor ring, in CSS pixels. */
  #drawChrome(ctx: CanvasRenderingContext2D, overlay: OverlayItems): void {
    const { x: camX, y: camY, zoom } = this.frame;
    if (overlay.selection.length > 0) {
      ctx.strokeStyle = '#2563eb';
      ctx.fillStyle = 'rgba(37,99,235,0.06)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      for (const b of overlay.selection) {
        const x = (b.minX - camX) * zoom;
        const y = (b.minY - camY) * zoom;
        const w = (b.maxX - b.minX) * zoom;
        const h = (b.maxY - b.minY) * zoom;
        ctx.fillRect(x, y, w, h);
        ctx.strokeRect(x, y, w, h);
      }
      ctx.setLineDash([]);
    }
    const sel = overlay.selected;
    if (sel !== undefined && sel !== null) this.#drawSelection(ctx, sel);
    const hint = overlay.hint;
    if (hint !== undefined && hint !== null && hint.length >= 6) {
      ctx.strokeStyle = '#16a34a';
      ctx.lineWidth = 2.5;
      this.#polygon(ctx, hint);
      ctx.stroke();
    }
    const guides = overlay.guides;
    if (guides !== undefined && guides.length > 0) {
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      for (const g of guides) {
        ctx.beginPath();
        ctx.moveTo((g.x0 - camX) * zoom, (g.y0 - camY) * zoom);
        ctx.lineTo((g.x1 - camX) * zoom, (g.y1 - camY) * zoom);
        ctx.stroke();
      }
    }
    const marquee = overlay.marquee;
    if (marquee !== undefined && marquee !== null) {
      ctx.fillStyle = 'rgba(37,99,235,0.08)';
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1;
      const mx = (marquee.minX - camX) * zoom;
      const my = (marquee.minY - camY) * zoom;
      ctx.fillRect(mx, my, (marquee.maxX - marquee.minX) * zoom, (marquee.maxY - marquee.minY) * zoom);
      ctx.strokeRect(mx, my, (marquee.maxX - marquee.minX) * zoom, (marquee.maxY - marquee.minY) * zoom);
    }
    const loop = overlay.loop;
    if (loop !== null && loop.count > 1) {
      ctx.strokeStyle = '#2563eb';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < loop.count; i++) {
        const x = ((loop.xy[i * 2] as number) - camX) * zoom;
        const y = ((loop.xy[i * 2 + 1] as number) - camY) * zoom;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const laser = overlay.laser;
    if (laser !== null && laser.count > 0) {
      ctx.lineCap = 'round';
      for (let i = 1; i < laser.count; i++) {
        const a = 1 - (laser.age[i] as number);
        ctx.strokeStyle = `rgba(239,68,68,${(a * 0.85).toFixed(3)})`;
        ctx.lineWidth = 2 + 4 * a;
        ctx.beginPath();
        ctx.moveTo(((laser.xy[(i - 1) * 2] as number) - camX) * zoom, ((laser.xy[(i - 1) * 2 + 1] as number) - camY) * zoom);
        ctx.lineTo(((laser.xy[i * 2] as number) - camX) * zoom, ((laser.xy[i * 2 + 1] as number) - camY) * zoom);
        ctx.stroke();
      }
      const hx = ((laser.xy[(laser.count - 1) * 2] as number) - camX) * zoom;
      const hy = ((laser.xy[(laser.count - 1) * 2 + 1] as number) - camY) * zoom;
      ctx.fillStyle = 'rgba(239,68,68,0.95)';
      ctx.beginPath();
      ctx.arc(hx, hy, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    const c = overlay.cursor;
    if (c !== null) {
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(1, c.radius), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  endFrame(): BoardResult<undefined> {
    if (!this.#frameState.send('end')) return boardError('bad_argument', 'There is no frame to end.', { detail: { field: 'endFrame' } });
    const raster = this.#raster;
    if (raster === null || this.#backend.state === 'lost') return DONE;
    const { x, y, zoom, dpr } = this.frame;
    if (this.#unchanged(x, y, zoom, dpr)) return DONE;
    let composed = raster.compose(this.#shown, x, y, zoom, dpr);
    if (!composed.ok && this.#backend.state === 'gl') {
      this.#fallBack(composed);
      composed = this.#raster === null ? composed : (this.#raster as TileRaster).compose(this.#shown, x, y, zoom, dpr);
    }
    if (composed.ok) this.#remember(x, y, zoom, dpr);
    else this.#screen.drawn = -1;
    if (raster instanceof GlRaster) this.#counters.drawCalls = raster.drawCalls;
    return composed;
  }

  /** True when the tile canvas already shows what composing the shown tiles would draw. */
  #unchanged(x: number, y: number, zoom: number, dpr: number): boolean {
    const s = this.#screen;
    const shown = this.#shown;
    const was = this.#composed;
    if (s.drawn !== this.#counters.tilesDrawn || s.x !== x || s.y !== y || s.zoom !== zoom || s.dpr !== dpr || s.devW !== this.size.devW || s.devH !== this.size.devH || was.length !== shown.length) return false;
    for (let i = 0; i < shown.length; i++) if (was[i] !== shown[i]) return false;
    return true;
  }

  #remember(x: number, y: number, zoom: number, dpr: number): void {
    const s = this.#screen;
    s.x = x;
    s.y = y;
    s.zoom = zoom;
    s.dpr = dpr;
    s.devW = this.size.devW;
    s.devH = this.size.devH;
    s.drawn = this.#counters.tilesDrawn;
    this.#composed.length = 0;
    for (const tile of this.#shown) this.#composed.push(tile);
  }

  #outside(call: string): BoardResult<never> {
    return boardError('bad_argument', `${call} was called outside a frame.`, { hint: 'Call beginFrame first.', detail: { field: call } });
  }

  dispose(): void {
    for (const stop of this.#stops.splice(0)) stop();
    for (const stop of this.#liveStops.splice(0)) stop();
    this.#liveGl?.dispose();
    this.#liveGl = null;
    this.tiles.clear();
    this.#raster?.dispose();
    this.#raster = null;
    this.element.remove();
  }
}
