/**
 * One surface interface for every 2D target (graphics-view design 6):
 * screen and offscreen canvas, SVG export and a recording surface for tests.
 * This file is pure; the Canvas2D, SVG and software back-ends implement it.
 */
import type { Px, PxPoint, PxRect } from './coords';
import { px } from './coords';
import type { HatchSpec, Rgba } from './styles';

/** 2D affine transform: x' = a x + c y + e, y' = b x + d y + f. */
export interface Affine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY_AFFINE: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function affineMul(m: Affine, n: Affine): Affine {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

export function affineApply(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

export function affineTranslate(dx: number, dy: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

export function affineScale(sx: number, sy: number): Affine {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

export type PathCommand =
  | { readonly k: 'M'; readonly x: number; readonly y: number }
  | { readonly k: 'L'; readonly x: number; readonly y: number }
  | { readonly k: 'Q'; readonly cx: number; readonly cy: number; readonly x: number; readonly y: number }
  | { readonly k: 'C'; readonly c1x: number; readonly c1y: number; readonly c2x: number; readonly c2y: number; readonly x: number; readonly y: number }
  | { readonly k: 'A'; readonly rx: number; readonly ry: number; readonly rot: number; readonly large: boolean; readonly sweep: boolean; readonly x: number; readonly y: number }
  | { readonly k: 'Z' };

/** Typed array for big curves (x0,y0,x1,y1,... in view pixels). */
export type PathData = Float32Array | readonly PathCommand[];

export function isCommandPath(p: PathData): p is readonly PathCommand[] {
  return !ArrayBuffer.isView(p);
}

export interface StrokeStyle {
  readonly color: Rgba;
  readonly width: number;
  readonly dash: readonly number[];
  readonly dashPhase: number;
  readonly cap: 'butt' | 'round' | 'square';
  readonly join: 'round' | 'miter' | 'bevel';
  readonly miterLimit: number;
  readonly opacity: number;
}

export type FillStyle =
  | { readonly kind: 'solid'; readonly color: Rgba; readonly opacity: number }
  | { readonly kind: 'hatch'; readonly spec: HatchSpec; readonly color: Rgba; readonly opacity: number };

export interface TextRun {
  readonly text: string;
  /** True when the text holds `$maths$`; back-ends route it to maths layout. */
  readonly math: boolean;
}

export interface TextStyle {
  readonly size: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly family: string;
  readonly align: 'left' | 'center' | 'right';
  readonly color: Rgba;
  readonly opacity: number;
  readonly background: Rgba | 'none';
}

export interface TextMetrics {
  readonly width: number;
  readonly height: number;
  readonly ascent: number;
}

/** An image by key; the host owns the decoded bitmap, the core only the key. */
export interface ImageSource {
  readonly key: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface Surface {
  save(): void;
  restore(): void;
  transform(m: Affine): void;
  clipRect(r: PxRect): void;
  clipPath(p: PathData): void;
  path(p: PathData): void;
  stroke(st: StrokeStyle): void;
  fill(f: FillStyle): void;
  text(t: TextRun, at: PxPoint, st: TextStyle): void;
  image(img: ImageSource, dest: PxRect, opacity: number): void;
  measure(t: TextRun, st: TextStyle): TextMetrics;
}

/** One recorded call on a `RecordSurface`, for golden tests. */
export type RecordedCall =
  | { readonly k: 'save' }
  | { readonly k: 'restore' }
  | { readonly k: 'transform'; readonly m: Affine }
  | { readonly k: 'clipRect'; readonly r: PxRect }
  | { readonly k: 'clipPath'; readonly n: number }
  | { readonly k: 'path'; readonly n: number }
  | { readonly k: 'stroke'; readonly st: StrokeStyle }
  | { readonly k: 'fill'; readonly f: FillStyle }
  | { readonly k: 'text'; readonly t: TextRun; readonly at: PxPoint; readonly st: TextStyle }
  | { readonly k: 'image'; readonly img: ImageSource; readonly dest: PxRect; readonly opacity: number };

function pathLen(p: PathData): number {
  return isCommandPath(p) ? p.length : p.length / 2;
}

/**
 * Records calls for golden checks. `measure` uses a deterministic estimate
 * (0.6 em per character) so Node tests match without fonts.
 */
export class RecordSurface implements Surface {
  readonly calls: RecordedCall[] = [];

  save(): void {
    this.calls.push({ k: 'save' });
  }
  restore(): void {
    this.calls.push({ k: 'restore' });
  }
  transform(m: Affine): void {
    this.calls.push({ k: 'transform', m });
  }
  clipRect(r: PxRect): void {
    this.calls.push({ k: 'clipRect', r });
  }
  clipPath(p: PathData): void {
    this.calls.push({ k: 'clipPath', n: pathLen(p) });
  }
  path(p: PathData): void {
    this.calls.push({ k: 'path', n: pathLen(p) });
  }
  stroke(st: StrokeStyle): void {
    this.calls.push({ k: 'stroke', st });
  }
  fill(f: FillStyle): void {
    this.calls.push({ k: 'fill', f });
  }
  text(t: TextRun, at: PxPoint, st: TextStyle): void {
    this.calls.push({ k: 'text', t, at, st });
  }
  image(img: ImageSource, dest: PxRect, opacity: number): void {
    this.calls.push({ k: 'image', img, dest, opacity });
  }
  measure(t: TextRun, st: TextStyle): TextMetrics {
    const width = [...t.text].length * st.size * 0.6;
    return { width, height: st.size * 1.2, ascent: st.size * 0.9 };
  }
  clear(): void {
    this.calls.length = 0;
  }
}

/** Bounding box of path data in view pixels, or null when empty. */
export function pathBounds(p: PathData): PxRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const eat = (x: number, y: number): void => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  if (isCommandPath(p)) {
    for (const c of p) {
      if (c.k === 'Z') continue;
      eat(c.x, c.y);
      if (c.k === 'Q') eat(c.cx, c.cy);
      if (c.k === 'C') {
        eat(c.c1x, c.c1y);
        eat(c.c2x, c.c2y);
      }
    }
  } else {
    for (let i = 0; i + 1 < p.length; i += 2) eat(p[i] ?? 0, p[i + 1] ?? 0);
  }
  if (!Number.isFinite(x0)) return null;
  return { x0: px(x0), x1: px(x1), y0: px(y0), y1: px(y1) };
}

/** Expand a rect by `pad` px on every side (line width, halo, label). */
export function expandRect(r: PxRect, pad: number): PxRect {
  return { x0: px((r.x0 as number) - pad), x1: px((r.x1 as number) + pad), y0: px((r.y0 as number) - pad), y1: px((r.y1 as number) + pad) };
}

/** Union of two rects, either of which may be null. */
export function unionRect(a: PxRect | null, b: PxRect | null): PxRect | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    x0: px(Math.min(a.x0 as number, b.x0 as number)),
    x1: px(Math.max(a.x1 as number, b.x1 as number)),
    y0: px(Math.min(a.y0 as number, b.y0 as number)),
    y1: px(Math.max(a.y1 as number, b.y1 as number)),
  };
}

/** True when the rects overlap (edges count as overlapping). */
export function rectsOverlap(a: PxRect, b: PxRect): boolean {
  return (a.x0 as number) <= (b.x1 as number) && (b.x0 as number) <= (a.x1 as number) &&
    (a.y0 as number) <= (b.y1 as number) && (b.y0 as number) <= (a.y1 as number);
}

/** Snap axis-aligned 1 px lines to half device pixels for sharpness (7.6). */
export function snapDevice(x: number, dpr: number): number {
  return (Math.round(x * dpr - 0.5) + 0.5) / dpr;
}
