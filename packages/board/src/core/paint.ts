/**
 * What a shape kind draws (design 7.2): a list of vector parts in the shape's own coordinates. A part is plain data (a
 * path of commands, a glyph, an image), so the core stays free of the DOM and a web painter or a React Native one
 * draws the same list. The draw list wraps the parts of a shape in a `ShapeItem` with the shape's place and rotation.
 */
import type { math } from '@incantly/view';

/** Path commands as one flat list: `M x y`, `L x y`, `C x1 y1 x2 y2 x y`, `Z`. */
export const PATH_MOVE = 0;
export const PATH_LINE = 1;
export const PATH_CUBIC = 2;
export const PATH_CLOSE = 3;

export type PathData = readonly number[];

export type FontFamily = 'sans' | 'serif' | 'mono' | 'hand';
export const FONT_FAMILIES: readonly FontFamily[] = ['sans', 'serif', 'mono', 'hand'];

export type Dash = 'solid' | 'dashed' | 'dotted';
export const DASHES: readonly Dash[] = ['solid', 'dashed', 'dotted'];

export interface PathPart {
  readonly k: 'path';
  readonly d: PathData;
  /** A CSS colour, or null for no fill. */
  readonly fill: string | null;
  /** A CSS colour, or null for no line. */
  readonly stroke: string | null;
  /** Line width in the shape's units. */
  readonly width: number;
  /** Dash lengths, empty for a solid line. */
  readonly dash: readonly number[];
  readonly cap: 'butt' | 'round';
}

export interface GlyphPart {
  readonly k: 'glyph';
  readonly x: number;
  readonly y: number;
  readonly s: string;
  readonly font: math.MathFont;
  readonly family: FontFamily;
  readonly px: number;
  readonly color: string;
}

/** A picture of an image asset, `x, y, w, h` in the shape's units; `crop` is the part of the image to show (0 to 1 of each side). */
export interface ImagePart {
  readonly k: 'image';
  readonly asset: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly crop: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
}

export type Part = PathPart | GlyphPart | ImagePart;

/** A rotated rectangle in page units that clips what a frame holds. */
export interface ClipBox {
  /** The frame's own origin and rotation, and its pivot in its own units. */
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly px: number;
  readonly py: number;
  readonly w: number;
  readonly h: number;
}

/** One shape ready to draw: its parts and where they go. The painter moves and rotates them about the pivot. */
export interface ShapeItem {
  readonly k: 'shape';
  readonly id: string;
  readonly layer: 0 | 1;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  /** The point the shape turns about, in the shape's own units. */
  readonly px: number;
  readonly py: number;
  readonly parts: readonly Part[];
  /** The shape's opacity, 0 to 1. */
  readonly a: number;
  readonly clip: ClipBox | null;
  // a stroke's fields, absent on a shape, so code that reads a draw item's `outline` or `ox` compiles for both
  readonly outline?: undefined;
  readonly ox?: undefined;
  readonly oy?: undefined;
  readonly r?: undefined;
  readonly g?: undefined;
  readonly b?: undefined;
}

// ---------------------------------------------------------------------------------------------------------------
// path builders

/** The dash pattern for a line of width `width`. */
export function dashFor(dash: Dash, width: number): readonly number[] {
  if (dash === 'dashed') return [Math.max(6, width * 4), Math.max(5, width * 3)];
  if (dash === 'dotted') return [Math.max(1, width * 0.1), Math.max(4, width * 2.2)];
  return [];
}

/** A closed path through the points `[x0, y0, x1, y1, …]`. */
export function polygonPath(points: readonly number[]): number[] {
  const d: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    d.push(i === 0 ? PATH_MOVE : PATH_LINE, points[i] as number, points[i + 1] as number);
  }
  if (d.length > 0) d.push(PATH_CLOSE);
  return d;
}

/** An open path through the points. */
export function polylinePath(points: readonly number[]): number[] {
  const d: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    d.push(i === 0 ? PATH_MOVE : PATH_LINE, points[i] as number, points[i + 1] as number);
  }
  return d;
}

/** The magic number of a quarter circle drawn with a cubic. */
const KAPPA = 0.5522847498307936;

/** A closed ellipse path in the box `0, 0, w, h`. */
export function ellipsePath(w: number, h: number): number[] {
  const rx = w / 2;
  const ry = h / 2;
  const cx = rx;
  const cy = ry;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    PATH_MOVE, cx + rx, cy,
    PATH_CUBIC, cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry,
    PATH_CUBIC, cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy,
    PATH_CUBIC, cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry,
    PATH_CUBIC, cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy,
    PATH_CLOSE,
  ];
}

/** A rounded rectangle path in the box `x, y, w, h` with corner radius `r`. */
export function roundRectPath(x: number, y: number, w: number, h: number, r: number): number[] {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  if (k === 0) return polygonPath([x, y, x + w, y, x + w, y + h, x, y + h]);
  const c = k * (1 - KAPPA);
  return [
    PATH_MOVE, x + k, y,
    PATH_LINE, x + w - k, y,
    PATH_CUBIC, x + w - c, y, x + w, y + c, x + w, y + k,
    PATH_LINE, x + w, y + h - k,
    PATH_CUBIC, x + w, y + h - c, x + w - c, y + h, x + w - k, y + h,
    PATH_LINE, x + k, y + h,
    PATH_CUBIC, x + c, y + h, x, y + h - c, x, y + h - k,
    PATH_LINE, x, y + k,
    PATH_CUBIC, x, y + c, x + c, y, x + k, y,
    PATH_CLOSE,
  ];
}

/** A stroked or filled path as a part. */
export function pathPart(d: PathData, fill: string | null, stroke: string | null, width: number, dash: readonly number[] = [], cap: 'butt' | 'round' = 'round'): PathPart {
  return { k: 'path', d, fill, stroke, width, dash, cap };
}

/** `none` and the empty text mean no colour. */
export const cssOrNull = (c: string): string | null => (c === 'none' || c === '' ? null : c);
