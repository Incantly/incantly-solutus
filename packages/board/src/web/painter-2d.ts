/**
 * The Canvas 2D drawing of the board's painter: the backup for the WebGL 2 tiles (`render_failed`, design 3), and the
 * drawing of the live layer and the overlay, which are always 2D. A stroke's triangles all have the same winding, so
 * one nonzero fill of all of them is the union: overlapping pieces of one stroke draw once, even with opacity.
 */
import { TILE_PX, tileBox } from '../core/draw';
import type { Tile, TileContent } from '../core/draw';
import { boardError, DONE, ok } from '../core/errors';
import type { BoardResult } from '../core/errors';

/** Extra pixels kept round a tile's 512 so smooth scaling at the edges finds its neighbour's pixels. */
export const TILE_GUTTER = 2;
export const TILE_SIZE = TILE_PX + 2 * TILE_GUTTER;

/** What both rasters (GPU and 2D) do for the painter. */
export interface TileRaster {
  /** Draws a tile's picture from its content. */
  render(tile: Tile, content: TileContent): BoardResult<undefined>;
  /** Gives back a tile's picture. */
  release(tile: Tile): void;
  /** The drawing surface is `devW × devH` device pixels. */
  resize(devW: number, devH: number): BoardResult<undefined>;
  /** Puts the shown tiles on the screen. `zoom` is CSS pixels per page unit. */
  compose(tiles: readonly Tile[], camX: number, camY: number, zoom: number, dpr: number): BoardResult<undefined>;
  dispose(): void;
}

/** One nonzero fill of the triangles `indices[from..to)` of `vertices` (x, y pairs), in the context's current transform. */
export function fillTriangles(ctx: CanvasRenderingContext2D, vertices: Float32Array, indices: Uint32Array, from: number, to: number): void {
  if (to <= from) return;
  ctx.beginPath();
  for (let i = from; i + 2 < to; i += 3) {
    const a = (indices[i] as number) * 2;
    const b = (indices[i + 1] as number) * 2;
    const c = (indices[i + 2] as number) * 2;
    ctx.moveTo(vertices[a] as number, vertices[a + 1] as number);
    ctx.lineTo(vertices[b] as number, vertices[b + 1] as number);
    ctx.lineTo(vertices[c] as number, vertices[c + 1] as number);
    ctx.closePath();
  }
  ctx.fill('nonzero');
}

/** `rgb(…)` of a colour whose channels are 0 to 1. */
export const rgbCss = (r: number, g: number, b: number): string => `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;

function tryContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d', { alpha: true });
  } catch {
    return null;
  }
}

/** The tiles drawn with Canvas 2D: each picture is a canvas, and `compose` copies them to the board's own canvas. */
export class CanvasRaster implements TileRaster {
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;

  private constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    this.#canvas = canvas;
    this.#ctx = ctx;
  }

  /** A raster on `canvas`, or `render_failed` when the browser gives no 2D context. */
  static open(canvas: HTMLCanvasElement): BoardResult<CanvasRaster> {
    const ctx = tryContext(canvas);
    if (ctx === null) return boardError('render_failed', 'This browser cannot draw the board.', { hint: 'Try a current browser.', detail: { backend: 'canvas2d' } });
    return ok(new CanvasRaster(canvas, ctx));
  }

  render(tile: Tile, content: TileContent): BoardResult<undefined> {
    let picture = tile.handle as HTMLCanvasElement | null;
    if (picture === null) {
      try {
        picture = document.createElement('canvas');
      } catch {
        return boardError('render_failed', 'A tile could not be made.', { detail: { backend: 'canvas2d' } });
      }
      picture.width = TILE_SIZE;
      picture.height = TILE_SIZE;
      tile.handle = picture;
    }
    const ctx = picture.getContext('2d');
    if (ctx === null) return boardError('render_failed', 'A tile could not be drawn.', { detail: { backend: 'canvas2d' } });
    const scale = Math.pow(2, tile.k);
    const box = tileBox(tile.k, tile.tx, tile.ty);
    const x0 = box.minX - TILE_GUTTER / scale;
    const y0 = box.minY - TILE_GUTTER / scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (const item of content.items) {
      ctx.setTransform(scale, 0, 0, scale, (item.ox - x0) * scale, (item.oy - y0) * scale);
      ctx.globalAlpha = item.a;
      ctx.fillStyle = rgbCss(item.r, item.g, item.b);
      fillTriangles(ctx, item.outline.vertices, item.outline.indices, 0, item.outline.indices.length);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return DONE;
  }

  release(tile: Tile): void {
    tile.handle = null;
  }

  resize(_devW: number, _devH: number): BoardResult<undefined> {
    // the canvas has its own size; the painter sets it
    return DONE;
  }

  compose(tiles: readonly Tile[], camX: number, camY: number, zoom: number, dpr: number): BoardResult<undefined> {
    const ctx = this.#ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    const pxPerUnit = zoom * dpr;
    for (const tile of tiles) {
      const picture = tile.handle as HTMLCanvasElement | null;
      if (picture === null) continue;
      const box = tileBox(tile.k, tile.tx, tile.ty);
      const dx0 = (box.minX - camX) * pxPerUnit;
      const dy0 = (box.minY - camY) * pxPerUnit;
      const size = (box.maxX - box.minX) * pxPerUnit;
      const x0 = Math.round(dx0);
      const y0 = Math.round(dy0);
      ctx.drawImage(picture, TILE_GUTTER, TILE_GUTTER, TILE_PX, TILE_PX, x0, y0, Math.round(dx0 + size) - x0, Math.round(dy0 + size) - y0);
    }
    return DONE;
  }

  dispose(): void {
    // nothing to free: the pictures are plain canvases
  }
}
