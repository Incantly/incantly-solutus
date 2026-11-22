/**
 * The glyph atlas of the GPU tiles (design 9 item 4, BR-73): each piece of text is drawn once with Canvas 2D, white, on a
 * small canvas, and copied into one texture. A tile then draws the text as a textured quad in the same draw call as its
 * strokes and shapes, in order, instead of stopping to paint a layer and copy a whole tile picture for every note. A piece
 * of text is kept for its string, font, size on screen and the text measure, so a zoom step or a font that arrived makes
 * new ones. The atlas starts again, between two tiles, when it is nearly full (a tile keeps its own picture, so no tile
 * needs an old entry). A piece too big for the atlas has no entry and its shape is drawn with Canvas 2D.
 */
import { cssFontFor, measureGeneration } from '../core/text';
import type { GlyphPart } from '../core/paint';

export const ATLAS_SIZE = 1024;
/** Pixels round a piece of text, for the smoothing at its edges. */
const PAD = 2;
/** Entries bigger than this (device pixels) are not kept. */
const MAX_W = 640;
const MAX_H = 160;
/** The white block at the corner of the atlas that triangles of one colour sample: its size and the texture coordinate inside it. */
const WHITE = 4;
export const WHITE_UV = 2 / ATLAS_SIZE;
/** The atlas starts again at the next tile when this much of its rows is used. */
const FULL = 0.7;

/** Where a piece of text is in the atlas, and how it sits on its baseline. All sizes are device pixels. */
export interface GlyphSlot {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly w: number;
  readonly h: number;
  /** From the entry's top-left corner to the point the text is placed at (its baseline origin). */
  readonly ox: number;
  readonly oy: number;
}

/** What the atlas needs from the GPU: a texture it can copy a canvas into. */
export interface AtlasTexture {
  /** Copies `source` into the texture with its top-left at `x, y`. */
  upload(source: HTMLCanvasElement, x: number, y: number): boolean;
  /** Writes opaque white into the square `size` pixels wide with its top-left at `x, y`. */
  fillWhite(x: number, y: number, size: number): boolean;
}

export class GlyphAtlas {
  readonly #texture: AtlasTexture;
  readonly #slots = new Map<string, GlyphSlot | null>();
  #scratch: HTMLCanvasElement | null = null;
  #ctx: CanvasRenderingContext2D | null = null;
  // the shelf packer: the next free place on the current row, the row's top and height, and the rows' end
  #x = WHITE;
  #y = 0;
  #row = WHITE;
  #generation = -1;
  /** Entries kept, for tests and the painter's statistics. */
  get size(): number {
    return this.#slots.size;
  }

  constructor(texture: AtlasTexture) {
    this.#texture = texture;
  }

  /** Called before a tile is drawn: starts the atlas again when it is nearly full, and when the text measure changed. */
  beginTile(): void {
    const generation = measureGeneration();
    if (generation !== this.#generation || this.#y + this.#row > ATLAS_SIZE * FULL) {
      this.#generation = generation;
      this.#slots.clear();
      this.#x = WHITE;
      this.#y = 0;
      this.#row = WHITE;
      this.#putWhite();
    }
  }

  /** The white block that triangles sample, written once after every restart. */
  #putWhite(): void {
    this.#texture.fillWhite(0, 0, WHITE);
  }

  /** The place of `part` at `scale` device pixels per page unit, drawn into the atlas when new; null when it does not fit. */
  slot(part: GlyphPart, scale: number): GlyphSlot | null {
    const size = Math.round(part.px * scale * 100) / 100;
    const key = `${part.family}|${part.font}|${size}|${part.s}`;
    const known = this.#slots.get(key);
    if (known !== undefined) return known;
    const made = this.#draw(part, size);
    this.#slots.set(key, made);
    return made;
  }

  #draw(part: GlyphPart, size: number): GlyphSlot | null {
    if (!(size > 0) || part.s === '') return null;
    let ctx = this.#ctx;
    let canvas = this.#scratch;
    if (ctx === null || canvas === null) {
      canvas = document.createElement('canvas');
      ctx = canvas.getContext('2d', { willReadFrequently: false });
      if (ctx === null) return null;
      this.#scratch = canvas;
      this.#ctx = ctx;
    }
    ctx.font = cssFontFor(part.font, part.family, size);
    ctx.textBaseline = 'alphabetic';
    let m: TextMetrics;
    try {
      m = ctx.measureText(part.s);
    } catch {
      return null;
    }
    const left = Math.ceil(Math.max(0, m.actualBoundingBoxLeft));
    const right = Math.ceil(Math.max(m.width, m.actualBoundingBoxRight));
    const above = Math.ceil(Math.max(size * 0.2, m.actualBoundingBoxAscent));
    const below = Math.ceil(Math.max(size * 0.05, m.actualBoundingBoxDescent));
    const w = left + right + 2 * PAD;
    const h = above + below + 2 * PAD;
    if (w > MAX_W || h > MAX_H || !(w > 0) || !(h > 0)) return null;
    if (this.#x + w > ATLAS_SIZE) {
      this.#y += this.#row;
      this.#x = 0;
      this.#row = 0;
    }
    if (this.#y + h > ATLAS_SIZE) return null;
    const at = { x: this.#x, y: this.#y };
    // a canvas takes its size from its attributes, and a new size empties it and drops the font
    canvas.width = w;
    canvas.height = h;
    ctx.font = cssFontFor(part.font, part.family, size);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(part.s, PAD + left, PAD + above);
    if (!this.#texture.upload(canvas, at.x, at.y)) return null;
    this.#x += w;
    this.#row = Math.max(this.#row, h);
    return { u0: at.x / ATLAS_SIZE, v0: at.y / ATLAS_SIZE, u1: (at.x + w) / ATLAS_SIZE, v1: (at.y + h) / ATLAS_SIZE, w, h, ox: PAD + left, oy: PAD + above };
  }
}
