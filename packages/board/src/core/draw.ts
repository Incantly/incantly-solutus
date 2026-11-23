/**
 * What the core hands the painter (design 3, 9; layer 1 to layer 4): the draw list of a tile or a region, the tile
 * cache with its memory cap, culling through the index grid, and level of detail. The `BoardPainter` interface is the
 * contract a web painter and a React Native one both meet. No DOM, no timers, no GPU; a painter keeps its own handle
 * on each `Tile`. The tile machine is B14 in docs/state-machines.md.
 */
import { StateMachine } from '@incantly/kernel';
import { sendIfAble } from './machine';
import type { MachineTable } from '@incantly/kernel';
import type { CameraView } from './camera';
import { isInk, shapeBounds, shapeGeometry, unionBounds } from './geometry';
import { inkPivot } from './ink/geometry';
import type { DrawLod, KindRegistry } from './kinds/def';
import type { ClipBox, Part, ShapeItem } from './paint';
import { measureGeneration } from './text';
import type { Outline, Outliner } from './ink/outline';
import { OutlineCache } from './ink/outline';
import { parseColor } from './kinds/ink';
import { refusedMove } from './errors';
import type { BoardResult, ErrorSink } from './errors';
import type { PageIndex } from './page-index';
import type { Bounds, Diff, PageBackground, ShapeRecord } from './types';
import { isShape } from './types';

// ---------------------------------------------------------------------------------------------------------------
// tiles

/** A tile is 512 device pixels square (plus a gutter the painter keeps for smooth edges). */
export const TILE_PX = 512;
/** Bytes of one tile's picture: 512 × 512 pixels of 4 bytes, plus the gutter. */
export const TILE_BYTES = (TILE_PX + 4) * (TILE_PX + 4) * 4;
export const TILE_CAP_BYTES = 64 * 1024 * 1024;
export const TILE_CAP_BYTES_LOW = 24 * 1024 * 1024;
/** More tiles than this in a view at the steady step, and the step of the zoom as it is now is used instead. */
export const MAX_VISIBLE_TILES = 48;

/** The zoom step of a zoom: tiles are drawn at `2^k` device pixels per page unit, never more than half a step too coarse. */
export function stepOf(zoom: number, dpr: number): number {
  const scale = zoom * dpr;
  if (!(scale > 0) || !Number.isFinite(scale)) return 0;
  return Math.ceil(Math.log2(scale) - 0.1);
}

/** The side of a tile in page units at step `k`. */
export const tileSpan = (k: number): number => TILE_PX / Math.pow(2, k);

/** The page box a tile covers. */
export function tileBox(k: number, tx: number, ty: number): Bounds {
  const span = tileSpan(k);
  return { minX: tx * span, minY: ty * span, maxX: (tx + 1) * span, maxY: (ty + 1) * span };
}

// a step fits in 6 bits and a column or row in 2^20 either side: the key is one integer below 2^53
const TILE_OFFSET = 1 << 20;
const TILE_SIDE = 1 << 21;
export const tileId = (k: number, tx: number, ty: number): number => ((k + 32) * TILE_SIDE + (tx + TILE_OFFSET)) * TILE_SIDE + (ty + TILE_OFFSET);

type TileState = 'blank' | 'fresh' | 'stale' | 'gone';
type TileEvent = 'draw' | 'dirty' | 'lose' | 'evict';

export const TILE_MACHINE: MachineTable<TileState, TileEvent> = {
  blank: { draw: 'fresh', evict: 'gone' },
  fresh: { dirty: 'stale', lose: 'blank', evict: 'gone' },
  stale: { draw: 'fresh', dirty: 'stale', lose: 'blank', evict: 'gone' },
  gone: {},
};

/** One tile of the cache: its place, its state, and the painter's handle on its picture. */
export class Tile {
  readonly k: number;
  readonly tx: number;
  readonly ty: number;
  readonly id: number;
  /** The painter's own object (a GPU target, a canvas); the cache never looks inside. */
  handle: unknown = null;
  /** The frame this tile was last used in. */
  lastUsed = 0;
  readonly #report: ErrorSink | undefined;
  readonly #machine = new StateMachine(TILE_MACHINE, 'blank', refusedMove('tile', () => this.#report));

  constructor(k: number, tx: number, ty: number, report?: ErrorSink) {
    this.#report = report;
    this.k = k;
    this.tx = tx;
    this.ty = ty;
    this.id = tileId(k, tx, ty);
  }

  get state(): TileState {
    return this.#machine.state;
  }

  /** True when the tile has to be drawn before it is shown. */
  get needsDraw(): boolean {
    return this.#machine.state === 'blank' || this.#machine.state === 'stale';
  }

  get box(): Bounds {
    return tileBox(this.k, this.tx, this.ty);
  }

  /** The painter drew it. */
  drawn(): boolean {
    return sendIfAble(this.#machine, 'draw');
  }

  dirty(): boolean {
    return sendIfAble(this.#machine, 'dirty');
  }

  lose(): boolean {
    return sendIfAble(this.#machine, 'lose');
  }

  evict(): boolean {
    return sendIfAble(this.#machine, 'evict');
  }
}

export interface TileCacheOptions {
  /** Bytes the drawn tiles may hold; default 64 MB. */
  readonly capBytes?: number;
  /** Called when a tile leaves the cache or loses its picture: the painter frees its handle. */
  readonly release?: (tile: Tile) => void;
  /** Where a refused tile move is told (the board's `onError`). */
  readonly report?: ErrorSink;
}

const meets = (a: Bounds, b: Bounds): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** The tiles of the current page, kept in a least-recently-used cache with a memory cap (design 9, item 4). */
export class TileCache {
  readonly capBytes: number;
  readonly #tiles = new Map<number, Tile>();
  readonly #release: ((tile: Tile) => void) | undefined;
  readonly #report: ErrorSink | undefined;
  #frame = 0;
  #bytes = 0;

  constructor(options: TileCacheOptions = {}) {
    const cap = options.capBytes;
    this.capBytes = cap !== undefined && Number.isFinite(cap) && cap >= TILE_BYTES ? cap : TILE_CAP_BYTES;
    this.#release = options.release;
    this.#report = options.report;
  }

  /** The number of tiles held. */
  get size(): number {
    return this.#tiles.size;
  }

  /** Bytes of the tiles that have a picture. */
  get bytes(): number {
    return this.#bytes;
  }

  /** The number of the frame being built. */
  get frame(): number {
    return this.#frame;
  }

  get(k: number, tx: number, ty: number): Tile | undefined {
    return this.#tiles.get(tileId(k, tx, ty));
  }

  /** Starts a frame: tiles used in it are the newest. */
  beginFrame(): void {
    this.#frame++;
    // a tile that was never drawn and is out of sight is only a place holder: forget it (a method kept on the cache, so a
    // frame makes no iterator and no closure for it)
    this.#tiles.forEach(this.#sweep);
  }

  readonly #sweep = (tile: Tile): void => {
    if (tile.state === 'blank' && tile.lastUsed < this.#frame - 1) {
      this.#tiles.delete(tile.id);
      tile.evict();
    }
  };

  /** The view the last call of `visible` answered, and its tiles: the same view again is answered from them. */
  readonly #seen = { valid: false, k: 0, tx0: 0, ty0: 0, tx1: 0, ty1: 0 };
  readonly #seenTiles: Tile[] = [];
  /** The camera and screen of the last call of `visible`: x, y, zoom, steady zoom, width, height, pixel ratio. */
  readonly #lastView = new Float64Array(7);

  /** True when no tile of the last answer has left the cache. */
  #keptLive(): boolean {
    const kept = this.#seenTiles;
    for (let i = 0; i < kept.length; i++) if ((kept[i] as Tile).state === 'gone') return false;
    return true;
  }

  /**
   * Fills `out` with the tiles that cover the screen `width × height` CSS pixels at the camera's steady zoom (made
   * blank when new), and marks them used in this frame. Returns how many.
   */
  visible(camera: CameraView & { readonly steadyZoom: number }, width: number, height: number, dpr: number, out: Tile[]): number {
    if (!(width > 0) || !(height > 0)) {
      out.length = 0;
      return 0;
    }
    // `out` is written by index and cut to its count at the end: emptying it with `length = 0` first would drop its storage, and
    // every frame would make a new one (BR-77)
    let n = 0;
    // the same camera and screen as the last call (a stroke being drawn): its tiles again, with nothing worked out; the numbers are
    // kept in a typed array, so comparing them makes nothing
    const last = this.#lastView;
    if (
      this.#seen.valid &&
      last[0] === camera.x &&
      last[1] === camera.y &&
      last[2] === camera.zoom &&
      last[3] === camera.steadyZoom &&
      last[4] === width &&
      last[5] === height &&
      last[6] === dpr &&
      this.#keptLive()
    ) {
      const kept = this.#seenTiles;
      for (let i = 0; i < kept.length; i++) {
        const tile = kept[i] as Tile;
        tile.lastUsed = this.#frame;
        out[n++] = tile;
      }
      if (out.length !== n) out.length = n;
      return n;
    }
    last[0] = camera.x;
    last[1] = camera.y;
    last[2] = camera.zoom;
    last[3] = camera.steadyZoom;
    last[4] = width;
    last[5] = height;
    last[6] = dpr;
    let k = stepOf(camera.steadyZoom, dpr);
    let span = tileSpan(k);
    let tx0 = Math.floor(camera.x / span);
    let ty0 = Math.floor(camera.y / span);
    let tx1 = Math.floor((camera.x + width / camera.zoom) / span);
    let ty1 = Math.floor((camera.y + height / camera.zoom) / span);
    // zoomed far out from the steady zoom, the steady step would need a great many tiles, all to be drawn again when the zoom
    // settles: the step the zoom is at now needs the few that the settled view needs
    const ideal = stepOf(camera.zoom, dpr);
    if (ideal < k && (tx1 - tx0 + 1) * (ty1 - ty0 + 1) > MAX_VISIBLE_TILES) {
      k = ideal;
      span = tileSpan(k);
      tx0 = Math.floor(camera.x / span);
      ty0 = Math.floor(camera.y / span);
      tx1 = Math.floor((camera.x + width / camera.zoom) / span);
      ty1 = Math.floor((camera.y + height / camera.zoom) / span);
    }
    const seen = this.#seen;
    const kept = this.#seenTiles;
    let again = seen.valid && seen.k === k && seen.tx0 === tx0 && seen.ty0 === ty0 && seen.tx1 === tx1 && seen.ty1 === ty1;
    for (let i = 0; again && i < kept.length; i++) if ((kept[i] as Tile).state === 'gone') again = false;
    if (again) {
      // the same tiles as the last frame (a stroke being drawn, a still page): their ids are not worked out again
      for (let i = 0; i < kept.length; i++) {
        const tile = kept[i] as Tile;
        tile.lastUsed = this.#frame;
        out[n++] = tile;
      }
      if (out.length !== n) out.length = n;
      return n;
    }
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const id = tileId(k, tx, ty);
        let tile = this.#tiles.get(id);
        if (tile === undefined) this.#tiles.set(id, (tile = new Tile(k, tx, ty, this.#report)));
        tile.lastUsed = this.#frame;
        out[n++] = tile;
      }
    }
    if (out.length !== n) out.length = n;
    seen.valid = true;
    seen.k = k;
    seen.tx0 = tx0;
    seen.ty0 = ty0;
    seen.tx1 = tx1;
    seen.ty1 = ty1;
    for (let i = 0; i < n; i++) this.#seenTiles[i] = out[i] as Tile;
    this.#seenTiles.length = n;
    return n;
  }

  /** The painter drew the tile: it holds a picture now. */
  markDrawn(tile: Tile): void {
    const had = tile.state !== 'blank';
    if (!tile.drawn()) return;
    if (!had) this.#bytes += TILE_BYTES;
    this.enforce();
  }

  /** A shape changed inside `region`: every drawn tile of every step that meets it must be drawn again. */
  invalidate(region: Bounds): number {
    let n = 0;
    for (const tile of this.#tiles.values()) if (meets(tile.box, region) && tile.dirty()) n++;
    return n;
  }

  /** Every drawn tile must be drawn again. */
  invalidateAll(): void {
    for (const tile of this.#tiles.values()) tile.dirty();
  }

  /** The GPU context was lost: no tile has a picture. */
  lose(): void {
    for (const tile of this.#tiles.values()) {
      if (tile.state === 'fresh' || tile.state === 'stale') this.#bytes -= TILE_BYTES;
      if (tile.lose()) this.#release?.(tile);
    }
    this.#bytes = Math.max(0, this.#bytes);
  }

  /** Drops every tile (a page change, or the painter went away). */
  clear(): void {
    this.#seen.valid = false;
    for (const tile of this.#tiles.values()) this.#drop(tile);
    this.#tiles.clear();
    this.#bytes = 0;
  }

  /** Evicts the least recently used tiles until the bytes fit the cap; tiles of the current frame stay. */
  enforce(): void {
    if (this.#bytes <= this.capBytes) return;
    const old = [...this.#tiles.values()].filter((t) => t.lastUsed < this.#frame).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const tile of old) {
      if (this.#bytes <= this.capBytes) break;
      this.#tiles.delete(tile.id);
      this.#drop(tile);
    }
  }

  #drop(tile: Tile): void {
    const held = tile.state === 'fresh' || tile.state === 'stale';
    if (tile.evict()) {
      if (held) this.#bytes -= TILE_BYTES;
      this.#release?.(tile);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// what to draw

/** One stroke to draw: its triangles in the shape's own coordinates, moved by `ox, oy` into the page. */
export interface InkItem {
  readonly k: 'ink';
  readonly id: string;
  /** 0 is drawn first (a highlighter goes under ink and shapes), 1 after it. */
  readonly layer: 0 | 1;
  readonly ox: number;
  readonly oy: number;
  /** The stroke's turn (BR-21) about the point `px, py` of its own coordinates. */
  readonly rot: number;
  readonly px: number;
  readonly py: number;
  readonly outline: Outline;
  /** Straight (not premultiplied) colour, each 0 to 1; `a` already holds the stroke's opacity. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** What a painter draws: a stroke as triangles, or any other shape as vector parts. */
export type DrawItem = InkItem | ShapeItem;

export interface TileContent {
  /** The page box of the tile: draw what meets it. */
  readonly box: Bounds;
  readonly items: readonly DrawItem[];
  /** The page's paper, drawn under the items in each tile (BR-18); absent or `none` for plain. */
  readonly background?: PageBackground;
  /**
   * A tile with many shapes is made in slices (BR-73): `items` holds the first ones, `total` is how many shapes the whole tile
   * has (at most), and `more(count)` makes the items of up to `count` more shapes, appends them to `items` and says whether
   * there are no more to come. A painter that cannot draw in slices calls it until it says so.
   */
  readonly total?: number;
  readonly more?: (count: number) => boolean;
}

/** Level of detail by the size a shape has on screen (design 9, item 6). */
export type Lod = DrawLod;

/** A stroke under half a pixel is not drawn; one under 24 pixels gets coarser arcs. */
export function lodOf(bounds: Bounds, scale: number): Lod {
  const px = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * scale;
  return px < 0.5 ? 'skip' : px < 24 ? 'coarse' : 'full';
}

/** The draw list of a region: culling through the index grid, order by layer then by the shape's `index`. */
export class DrawList {
  readonly #index: PageIndex;
  readonly outlines: OutlineCache;
  readonly #ids: string[] = [];
  readonly #parts = new WeakMap<object, { generation: number; byLod: Partial<Record<Lod, readonly Part[]>> }>();
  /**
   * The draw item of a stored shape at the last scale it was asked for, with the text measure it was made under. A stored
   * record never changes (an edit is a new record), so the item stays right while the scale and the measure stay the same;
   * a shape inside a group or a frame is not kept, because its clip is the frame's record, not its own.
   */
  readonly #items = new WeakMap<object, { scale: number; generation: number; item: DrawItem | undefined }[]>();

  constructor(index: PageIndex, outlines: OutlineCache = new OutlineCache()) {
    this.#index = index;
    this.outlines = outlines;
  }

  /** The ids of the shapes whose bounds meet `box`, the culling a frame does (`margin` is in page units). */
  cull(box: Bounds, margin = 0, out: string[] = []): string[] {
    return this.#index.grid.queryViewport({ minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin }, out);
  }

  /** The strokes that meet `box`, ready to draw at `scale` device pixels per page unit. */
  itemsIn(box: Bounds, scale: number): DrawItem[] {
    this.#ids.length = 0;
    this.cull(box, 0, this.#ids);
    // highlighters go under everything else: the two layers are sorted by order key on their own, so the sort does not ask for a
    // layer at every comparison
    const under: ShapeRecord[] = [];
    const over: ShapeRecord[] = [];
    for (let i = 0; i < this.#ids.length; i++) {
      const s = this.#index.shape(this.#ids[i] as string);
      // a shape that is not drawn (too small to see) is left out before the sort, which is the dearest part of a busy tile
      if (s !== undefined && this.itemOf(s, scale) !== undefined) (layerOf(s) === 0 ? under : over).push(s);
    }
    under.sort(byOrder);
    over.sort(byOrder);
    const out: DrawItem[] = [];
    for (let i = 0; i < under.length; i++) {
      const item = this.itemOf(under[i] as ShapeRecord, scale);
      if (item !== undefined) out.push(item);
    }
    for (let i = 0; i < over.length; i++) {
      const item = this.itemOf(over[i] as ShapeRecord, scale);
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  /**
   * The strokes and shapes that meet `box`, made in slices: the shapes are found and put in order at once (the cheap part),
   * and their items are made `count` shapes at a time by `more`, which appends them to `items`. `itemsIn` is this and all
   * of it at once. The shapes in `leave` are left out (the ones a gesture holds above the tiles, BR-82).
   */
  plan(box: Bounds, scale: number, leave?: ReadonlySet<string>): { readonly items: DrawItem[]; readonly total: number; readonly more: (count: number) => boolean } {
    this.#ids.length = 0;
    this.cull(box, 0, this.#ids);
    const under: ShapeRecord[] = [];
    const over: ShapeRecord[] = [];
    const skip = leave !== undefined && leave.size > 0 ? leave : undefined;
    for (let i = 0; i < this.#ids.length; i++) {
      const id = this.#ids[i] as string;
      if (skip?.has(id) === true) continue;
      const s = this.#index.shape(id);
      if (s !== undefined) (layerOf(s) === 0 ? under : over).push(s);
    }
    under.sort(byOrder);
    over.sort(byOrder);
    const ordered = under.length === 0 ? over : under.concat(over);
    const items: DrawItem[] = [];
    let next = 0;
    const more = (count: number): boolean => {
      const end = Math.min(ordered.length, next + count);
      for (; next < end; next++) {
        const item = this.itemOf(ordered[next] as ShapeRecord, scale);
        if (item !== undefined) items.push(item);
      }
      return next >= ordered.length;
    };
    return { items, total: ordered.length, more };
  }

  /** One shape as a draw item, or undefined when it is not drawn (unknown kind, too small to see). */
  itemOf(shape: ShapeRecord, scale: number): DrawItem | undefined {
    if (shape.parent !== null) return this.#makeItem(shape, scale);
    const generation = measureGeneration();
    let kept = this.#items.get(shape);
    if (kept === undefined) {
      kept = [];
      this.#items.set(shape, kept);
    }
    for (let i = 0; i < kept.length; i++) {
      const known = kept[i] as { scale: number; generation: number; item: DrawItem | undefined };
      if (known.scale === scale && known.generation === generation) return known.item;
    }
    const item = this.#makeItem(shape, scale);
    // the last few scales are kept: a zoom goes in and out over a few steps
    if (kept.length >= ITEM_SCALES) kept.shift();
    kept.push({ scale, generation, item });
    return item;
  }

  #makeItem(shape: ShapeRecord, scale: number): DrawItem | undefined {
    const kinds = this.#index.kinds;
    const geometry = shapeGeometry(shape, kinds);
    if (geometry === undefined) return undefined;
    const lod = kinds.get(shape.kind)?.lod?.(shape, scale) ?? lodOf(geometry.bounds, scale);
    if (lod === 'skip') return undefined;
    if (!isInk(shape)) {
      const parts = this.#partsOf(shape, lod);
      if (parts === undefined) return undefined;
      return {
        k: 'shape',
        id: shape.id,
        layer: 1,
        x: shape.x,
        y: shape.y,
        rotation: shape.rotation,
        px: geometry.cx,
        py: geometry.cy,
        parts,
        a: shape.opacity,
        clip: this.#clipOf(shape),
      };
    }
    const { props } = shape;
    // the arcs' tolerance is a quarter of a device pixel (a whole one when the stroke is small), so a zoom step
    // keeps one outline per stroke
    const tolerance = (lod === 'coarse' ? 1 : 0.25) / scale;
    const outline = this.outlines.get(props.points, props.points, props.stride, { size: props.size, nib: props.nib, tolerance });
    const [r, g, b, alpha] = parseColor(props.color);
    const pivot = shape.rotation === 0 ? NO_PIVOT : inkPivot(shape);
    return {
      k: 'ink',
      id: shape.id,
      layer: layerOf(shape),
      ox: shape.x,
      oy: shape.y,
      rot: shape.rotation,
      px: pivot.x,
      py: pivot.y,
      outline,
      r,
      g,
      b,
      a: alpha * props.opacity * shape.opacity,
    };
  }

  /** The parts of a shape at a level of detail, kept on the record (a record never changes) until the text measure changes. */
  #partsOf(shape: ShapeRecord, lod: Lod): readonly Part[] | undefined {
    const generation = measureGeneration();
    let entry = this.#parts.get(shape);
    if (entry === undefined || entry.generation !== generation) {
      entry = { generation, byLod: {} };
      this.#parts.set(shape, entry);
    }
    const known = entry.byLod[lod];
    if (known !== undefined) return known;
    const def = this.#index.kinds.get(shape.kind);
    if (def?.draw === undefined) return undefined;
    let made: readonly Part[];
    try {
      made = def.draw(shape, lod);
    } catch {
      return undefined;
    }
    entry.byLod[lod] = made;
    return made;
  }

  /** The rectangle of the frame that holds the shape (itself or through groups), or null. */
  #clipOf(shape: ShapeRecord): ClipBox | null {
    let id = shape.parent;
    for (let depth = 0; id !== null && depth < 32; depth++) {
      const parent = this.#index.shape(id);
      if (parent === undefined) return null;
      if (parent.kind === 'frame') {
        const g = shapeGeometry(parent, this.#index.kinds);
        if (g === undefined) return null;
        return { x: parent.x, y: parent.y, rotation: parent.rotation, px: g.cx, py: g.cy, w: g.box.maxX - g.box.minX, h: g.box.maxY - g.box.minY };
      }
      id = parent.parent;
    }
    return null;
  }
}

const NO_PIVOT = { x: 0, y: 0 } as const;

/** Back to front: the shape's order key, then its id. */
const byOrder = (a: ShapeRecord, b: ShapeRecord): number => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** How many scales the draw item of a stored shape is kept for. */
const ITEM_SCALES = 4;

function layerOf(shape: ShapeRecord): 0 | 1 {
  return isInk(shape) && shape.props.nib === 'highlighter' ? 0 : 1;
}

/**
 * The page boxes a diff changed on `page`: before and after of every shape that moved, was added or removed. A shape in
 * `leave` is left out: it is held above the tiles (BR-82), so no tile shows it and none has to be drawn again for it.
 */
export function diffRegions(diff: Diff, page: string, kinds?: KindRegistry, leave?: ReadonlySet<string>): Bounds[] {
  const out: Bounds[] = [];
  const add = (s: ShapeRecord): void => {
    if (s.page !== page || leave?.has(s.id) === true) return;
    const b = shapeBounds(s, kinds);
    if (b !== undefined) out.push(b);
  };
  for (const r of diff.added) if (isShape(r)) add(r);
  for (const r of diff.removed) if (isShape(r)) add(r);
  for (const u of diff.updated) {
    if (isShape(u.before)) add(u.before);
    if (isShape(u.after)) add(u.after);
  }
  return out;
}

/** The smallest box holding every box, or undefined when there are none. */
export function regionOf(boxes: readonly Bounds[]): Bounds | undefined {
  let all: Bounds | undefined;
  for (const b of boxes) all = unionBounds(all, b);
  return all;
}

// ---------------------------------------------------------------------------------------------------------------
// the painter contract

/** Points in screen pixels, `x, y` pairs: the predicted tail of a stroke, drawn on the overlay and never stored. */
export interface PredictedView {
  readonly xy: Float32Array;
  readonly count: number;
}

/** The stroke being drawn. Its triangles live in the live stroke's own `Outliner`, outside the store (BR-10). */
export interface LiveStrokeView {
  /** Changes when a new stroke starts, so a painter knows to start its live layer again. */
  readonly serial: number;
  /** Where the stroke's origin is, in page units. */
  readonly originX: number;
  readonly originY: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** The stroke's width at full pressure, in page units (the predicted tail is drawn with it). */
  readonly size: number;
  /** The stroke's opacity, applied to the whole layer so overlapping segments do not darken. */
  readonly opacity: number;
  /** A highlighter multiplies with what is under it. */
  readonly multiply: boolean;
  /** Built from the stroke's points this frame; read its vertices, indices, marks and groups. */
  readonly outliner: Outliner;
  readonly predicted: PredictedView | null;
}

/** The laser's trail: page points with their age 0 (new) to 1 (gone). */
export interface TrailView {
  readonly xy: Float32Array;
  readonly age: Float32Array;
  readonly count: number;
}

/** A snap guide to draw: a line from `x0, y0` to `x1, y1` in page units. */
export interface GuideLine {
  readonly kind: 'edge' | 'centre' | 'gap' | 'grid';
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** A handle on the selection, at a page point; the painter draws it the same size at every zoom. */
export interface OverlayHandle {
  readonly id: string;
  readonly kind: 'resize' | 'rotate' | 'kind';
  readonly x: number;
  readonly y: number;
}

/** The selection as the painter shows it: each shape's outline, the frame round them, and the handles. */
export interface SelectionView {
  /** One closed polygon `[x0, y0, …]` of page units for each selected shape. */
  readonly outlines: readonly (readonly number[])[];
  /** The corners of the frame round the selection, 8 numbers (top-left, top-right, bottom-right, bottom-left), or null. */
  readonly frame: readonly number[] | null;
  readonly handles: readonly OverlayHandle[];
}

/** Everything drawn above the board: laser, lasso loop, selection, the eraser's ring, the pen's hover dot. */
export interface OverlayItems {
  readonly laser: TrailView | null;
  /** The lasso's loop in page units, `x, y` pairs. */
  readonly loop: { readonly xy: Float32Array; readonly count: number } | null;
  readonly selection: readonly Bounds[];
  /** A ring or dot at a screen position: the eraser's size, the pen's nib. */
  readonly cursor: { readonly x: number; readonly y: number; readonly radius: number; readonly color: string } | null;
  /** The selection with its frame and handles (round 3); `selection` stays for a painter that draws boxes only. */
  readonly selected?: SelectionView | null;
  /** Snap guides while a shape moves or is resized. */
  readonly guides?: readonly GuideLine[];
  /** The box being dragged to select, in page units. */
  readonly marquee?: Bounds | null;
  /** The outline `[x0, y0, …]` of the shape an arrow end would stick to. */
  readonly hint?: readonly number[] | null;
}

/** Layer 1 to layer 4 (design 3). Every call returns a `Result` and never throws. */
export interface BoardPainter {
  beginFrame(camera: CameraView, dpr: number): BoardResult<undefined>;
  /** Shows a tile. With `content` the tile's picture is drawn (again) first; without, its cached picture is reused. */
  drawTile(tile: Tile, content: TileContent | null, until?: number): BoardResult<undefined>;
  /**
   * Items not in a tile (what an agent animates, a dragged shape), drawn this frame only, over the tiles. With `clip` they
   * show only inside those page boxes (a shape settling back into tiles is drawn over the tiles that do not hold it yet).
   */
  drawItems(items: readonly DrawItem[], clip?: readonly Bounds[]): BoardResult<undefined>;
  drawLiveStroke(stroke: LiveStrokeView | null): BoardResult<undefined>;
  drawOverlay(overlay: OverlayItems): BoardResult<undefined>;
  endFrame(): BoardResult<undefined>;
}
