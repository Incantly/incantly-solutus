/**
 * The Canvas 2D drawing of the board's painter: the backup for the WebGL 2 tiles (`render_failed`, design 3), and the
 * drawing of the live layer and the overlay, which are always 2D. A stroke's triangles all have the same winding, so
 * one nonzero fill of all of them is the union: overlapping pieces of one stroke draw once, even with opacity.
 */
import { TILE_PX, tileBox } from '../core/draw';
import type { DrawItem, Tile, TileContent } from '../core/draw';
import { cssFontFor } from '../core/text';
import { PATH_CLOSE, PATH_CUBIC, PATH_LINE, PATH_MOVE } from '../core/paint';
import type { ClipBox, ImagePart, Part, PathPart, ShapeItem } from '../core/paint';
import { boardError, DONE, ok } from '../core/errors';
import type { BoardResult } from '../core/errors';

/** Extra pixels kept round a tile's 512 so smooth scaling at the edges finds its neighbour's pixels. */
export const TILE_GUTTER = 2;
export const TILE_SIZE = TILE_PX + 2 * TILE_GUTTER;

/** Gives the picture of an image asset, or null while it is not ready (a grey box is drawn then). */
export type ImageLookup = (asset: string) => CanvasImageSource | null;

const noImages: ImageLookup = () => null;

/** What both rasters (GPU and 2D) do for the painter. */
export interface TileRaster {
  /** Where the pictures of image shapes come from. */
  setImages(lookup: ImageLookup): void;
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

function tracePath(ctx: CanvasRenderingContext2D, d: readonly number[]): void {
  ctx.beginPath();
  for (let i = 0; i < d.length; ) {
    const op = d[i] as number;
    if (op === PATH_MOVE) {
      ctx.moveTo(d[i + 1] as number, d[i + 2] as number);
      i += 3;
    } else if (op === PATH_LINE) {
      ctx.lineTo(d[i + 1] as number, d[i + 2] as number);
      i += 3;
    } else if (op === PATH_CUBIC) {
      ctx.bezierCurveTo(d[i + 1] as number, d[i + 2] as number, d[i + 3] as number, d[i + 4] as number, d[i + 5] as number, d[i + 6] as number);
      i += 7;
    } else if (op === PATH_CLOSE) {
      ctx.closePath();
      i += 1;
    } else {
      return;
    }
  }
}

function drawPathPart(ctx: CanvasRenderingContext2D, p: PathPart): void {
  tracePath(ctx, p.d);
  if (p.fill !== null) {
    ctx.fillStyle = p.fill;
    ctx.fill();
  }
  if (p.stroke !== null && p.width > 0) {
    ctx.strokeStyle = p.stroke;
    ctx.lineWidth = p.width;
    ctx.lineCap = p.cap;
    ctx.lineJoin = 'round';
    ctx.setLineDash(p.dash as number[]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

const sizeOf = (img: CanvasImageSource): { w: number; h: number } => {
  const i = img as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
  return { w: i.naturalWidth ?? i.width ?? 1, h: i.naturalHeight ?? i.height ?? 1 };
};

function drawImagePart(ctx: CanvasRenderingContext2D, p: ImagePart, images: ImageLookup): void {
  const img = images(p.asset);
  if (img === null) {
    // not decoded yet, or it cannot be: a grey box with a cross
    ctx.fillStyle = '#eceef2';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = '#b6bac4';
    ctx.lineWidth = Math.max(1, Math.min(p.w, p.h) / 60);
    ctx.strokeRect(p.x, p.y, p.w, p.h);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + p.w, p.y + p.h);
    ctx.moveTo(p.x + p.w, p.y);
    ctx.lineTo(p.x, p.y + p.h);
    ctx.stroke();
    return;
  }
  const natural = sizeOf(img);
  const c = p.crop;
  if (c === null) ctx.drawImage(img, p.x, p.y, p.w, p.h);
  else ctx.drawImage(img, c.x * natural.w, c.y * natural.h, c.w * natural.w, c.h * natural.h, p.x, p.y, p.w, p.h);
}

function drawParts(ctx: CanvasRenderingContext2D, parts: readonly Part[], images: ImageLookup): void {
  for (const part of parts) {
    if (part.k === 'path') {
      drawPathPart(ctx, part);
    } else if (part.k === 'glyph') {
      ctx.font = cssFontFor(part.font, part.family, part.px);
      ctx.fillStyle = part.color;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(part.s, part.x, part.y);
    } else {
      drawImagePart(ctx, part, images);
    }
  }
}

/** Sets a frame's clip: the frame's rectangle, turned about its middle, in page units under the context's page transform. */
function clipTo(ctx: CanvasRenderingContext2D, c: ClipBox): void {
  ctx.translate(c.x, c.y);
  ctx.translate(c.px, c.py);
  ctx.rotate(c.rotation);
  ctx.translate(-c.px, -c.py);
  ctx.beginPath();
  ctx.rect(0, 0, c.w, c.h);
  ctx.clip();
}

function drawShape(ctx: CanvasRenderingContext2D, item: ShapeItem, scale: number, x0: number, y0: number, images: ImageLookup): void {
  ctx.save();
  // the page transform: page unit (x0, y0) is the context's origin
  ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  if (item.clip !== null) {
    clipTo(ctx, item.clip);
    ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  }
  ctx.globalAlpha = item.a;
  ctx.translate(item.x + item.px, item.y + item.py);
  ctx.rotate(item.rotation);
  ctx.translate(-item.px, -item.py);
  drawParts(ctx, item.parts, images);
  ctx.restore();
}

/**
 * Draws the items with Canvas 2D: page unit `(x0, y0)` is the top-left of the context and `scale` device pixels make
 * a page unit. Strokes are the union of their triangles; shapes are their vector parts, clipped to the frame that
 * holds them. The context's own transform is left as the identity.
 */
export function drawItems2D(ctx: CanvasRenderingContext2D, items: readonly DrawItem[], scale: number, x0: number, y0: number, images: ImageLookup = noImages): void {
  for (const item of items) {
    if (item.k === 'shape') {
      drawShape(ctx, item, scale, x0, y0, images);
      continue;
    }
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, (item.ox - x0) * scale, (item.oy - y0) * scale);
    if (item.rot !== 0) {
      ctx.translate(item.px, item.py);
      ctx.rotate(item.rot);
      ctx.translate(-item.px, -item.py);
    }
    ctx.globalAlpha = item.a;
    ctx.fillStyle = rgbCss(item.r, item.g, item.b);
    fillTriangles(ctx, item.outline.vertices, item.outline.indices, 0, item.outline.indices.length);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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
  #images: ImageLookup = noImages;

  setImages(lookup: ImageLookup): void {
    this.#images = lookup;
  }

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
    drawItems2D(ctx, content.items, scale, x0, y0, this.#images);
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
