/**
 * Coordinate systems (graphics-view design 3) and zoom/pan/view maths (section 4).
 *
 * Four systems: maths units, view pixels (CSS px, top-left origin), device
 * pixels (view times dpr) and page pixels (screen-reader rectangles only).
 * A `Viewport` is immutable; zooming makes a new one.
 */
import { okResult, viewError } from '../errors';
import type { Result } from '@incantly/kernel';

/** Maths units; x right, y up. */
export type Maths = number & { readonly __space: 'maths' };
/** CSS pixels; x right, y down from the top-left of the canvas. */
export type Px = number & { readonly __space: 'px' };

export const maths = (v: number): Maths => v as Maths;
export const px = (v: number): Px => v as Px;

export interface MathsPoint {
  readonly x: Maths;
  readonly y: Maths;
}
export interface PxPoint {
  readonly x: Px;
  readonly y: Px;
}
export interface MathsRect {
  readonly x0: Maths;
  readonly x1: Maths;
  readonly y0: Maths;
  readonly y1: Maths;
}
export interface PxRect {
  readonly x0: Px;
  readonly x1: Px;
  readonly y0: Px;
  readonly y1: Px;
}

export interface Viewport {
  readonly width: Px;
  readonly height: Px;
  /** Pixel position of maths (0, 0); derived from the centre, kept for the paper trail. */
  readonly originX: Px;
  readonly originY: Px;
  /** Pixels per maths unit on x/y, always > 0. */
  readonly scaleX: number;
  readonly scaleY: number;
  readonly dpr: number;
  /** Maths point at the centre of the canvas; mapping is relative to it. */
  readonly centreX: Maths;
  readonly centreY: Maths;
}

export interface Mapper {
  readonly toPx: (p: MathsPoint) => PxPoint;
  readonly toMaths: (p: PxPoint) => MathsPoint;
  readonly lengthPx: (dxMaths: number, dyMaths: number) => number;
  readonly bounds: () => MathsRect;
}

export interface ViewLimits {
  readonly minWidth: number;
  readonly maxWidth: number;
}

export const DEFAULT_LIMITS: ViewLimits = { minWidth: 1e-9, maxWidth: 1e9 };
/** Canvases misbehave beyond ~3e7 px; we clip at 1e7 (design 3). */
export const MAX_DRAW_PX = 1e7;
/** Relative precision floor: width under `1e-10 * |centre|` is refused. */
export const RELATIVE_WIDTH_FLOOR = 1e-10;

export interface ViewState {
  readonly viewport: Viewport;
  readonly ratioLock: 'free' | 'equal';
  readonly limits: ViewLimits;
  /** What the last `@view` set; the home button restores it. */
  readonly home: MathsRect;
}

/** Anchors for text and widgets (design 3): maths or pinned view pixels. */
export type Anchor =
  | { readonly space: 'maths'; readonly p: MathsPoint }
  | { readonly space: 'view'; readonly p: PxPoint; readonly from: 'tl' | 'tr' | 'bl' | 'br' };

export interface ViewportOptions {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly centreX: number;
  readonly centreY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly dpr?: number;
}

function finite(n: number): boolean {
  return Number.isFinite(n);
}

/** Build a viewport, checking every number. */
export function createViewport(opts: ViewportOptions): Result<Viewport> {
  const dpr = opts.dpr ?? 1;
  const bad =
    !finite(opts.widthPx) || opts.widthPx <= 0 ||
    !finite(opts.heightPx) || opts.heightPx <= 0 ||
    !finite(opts.centreX) || !finite(opts.centreY) ||
    !finite(opts.scaleX) || opts.scaleX <= 0 ||
    !finite(opts.scaleY) || opts.scaleY <= 0 ||
    !finite(dpr) || dpr <= 0;
  if (bad) {
    return viewError({
      kind: 'bad_directive',
      messageKey: 'view.bad_directive',
      params: { directive: '@view', need: 'a positive size, finite centre and positive scales' },
      token: '@view',
      forms: ['@view x0 x1 y0 y1', '@view x0 x1 y0 y1 equal | free', '@view x0 x1 y0 y1 over seconds', '@view home'],
      hint: 'Give x0 less than x1, y0 less than y1, and a width between 1e-9 and 1e9.',
    });
  }
  const width = px(opts.widthPx);
  const height = px(opts.heightPx);
  const centreX = maths(opts.centreX);
  const centreY = maths(opts.centreY);
  return okResult({
    width,
    height,
    originX: px(opts.widthPx / 2 - opts.centreX * opts.scaleX),
    originY: px(opts.heightPx / 2 + opts.centreY * opts.scaleY),
    scaleX: opts.scaleX,
    scaleY: opts.scaleY,
    dpr,
    centreX,
    centreY,
  });
}

/**
 * Fit a maths region into a canvas. With `equal`, the shorter axis range is
 * widened outward so the whole requested box stays visible (design 4).
 */
export function viewportFromRegion(
  region: MathsRect,
  widthPx: number,
  heightPx: number,
  ratio: 'equal' | 'free',
  dpr = 1,
  limits: ViewLimits = DEFAULT_LIMITS,
): Result<Viewport> {
  const w = region.x1 - (region.x0 as number);
  const h = region.y1 - (region.y0 as number);
  if (!(w > 0) || !(h > 0) || !finite(w) || !finite(h)) {
    return viewError({
      kind: 'bad_directive',
      messageKey: 'view.bad_directive',
      params: { directive: '@view', need: 'x0 < x1 and y0 < y1' },
      token: '@view',
    });
  }
  if (w < limits.minWidth || h < limits.minWidth) {
    return viewError({
      kind: 'bad_directive',
      messageKey: 'view.bad_directive',
      params: { directive: '@view', need: `a width between ${limits.minWidth} and ${limits.maxWidth}` },
      token: '@view',
    });
  }
  if (w > limits.maxWidth || h > limits.maxWidth) {
    return viewError({
      kind: 'bad_directive',
      messageKey: 'view.bad_directive',
      params: { directive: '@view', need: `a width between ${limits.minWidth} and ${limits.maxWidth}` },
      token: '@view',
    });
  }
  let sx = widthPx / w;
  let sy = heightPx / h;
  if (ratio === 'equal') {
    const s = Math.min(sx, sy);
    sx = s;
    sy = s;
  }
  return createViewport({
    widthPx,
    heightPx,
    centreX: (region.x0 + (region.x1 as number)) / 2,
    centreY: (region.y0 + (region.y1 as number)) / 2,
    scaleX: sx,
    scaleY: sy,
    dpr,
  });
}

/** The default home region: x in -8..8, equal ratio, y centred at 0. */
export function defaultHome(widthPx: number, heightPx: number): MathsRect {
  const halfX = 8;
  const halfY = (8 * heightPx) / Math.max(1, widthPx);
  return { x0: maths(-halfX), x1: maths(halfX), y0: maths(-halfY), y1: maths(halfY) };
}

/** Centre-relative mapper: `(x - centreX) * scaleX + width / 2` (design 3). */
export function createMapper(view: Viewport): Mapper {
  const w = view.width as number;
  const h = view.height as number;
  const cx = view.centreX as number;
  const cy = view.centreY as number;
  const sx = view.scaleX;
  const sy = view.scaleY;
  return {
    toPx: (p: MathsPoint): PxPoint => ({
      x: px(((p.x as number) - cx) * sx + w / 2),
      y: px(h / 2 - ((p.y as number) - cy) * sy),
    }),
    toMaths: (p: PxPoint): MathsPoint => ({
      x: maths(((p.x as number) - w / 2) / sx + cx),
      y: maths((h / 2 - (p.y as number)) / sy + cy),
    }),
    lengthPx: (dxMaths: number, dyMaths: number): number =>
      Math.hypot(dxMaths * sx, dyMaths * sy),
    bounds: (): MathsRect => ({
      x0: maths(cx - w / 2 / sx),
      x1: maths(cx + w / 2 / sx),
      y0: maths(cy - h / 2 / sy),
      y1: maths(cy + h / 2 / sy),
    }),
  };
}

export type ZoomFeedback = 'zoom_limit' | 'precision_limit';

export interface ZoomResult {
  /** The new viewport, or the unchanged one when the zoom was refused. */
  readonly viewport: Viewport;
  /** Set when the zoom was refused; gesture feedback, not an error object. */
  readonly refused?: ZoomFeedback;
}

/**
 * Zoom about a fixed pixel `p` by factor `k > 1` (zoom in), keeping the maths
 * point under the pointer still (design 4). A free ratio is kept: both scales
 * move by the same `k`. Refusals return the old viewport plus a feedback code.
 */
export function zoomAbout(view: Viewport, p: PxPoint, k: number, limits: ViewLimits = DEFAULT_LIMITS): ZoomResult {
  if (!(k > 0) || !finite(k)) return { viewport: view, refused: 'zoom_limit' };
  const m = createMapper(view).toMaths(p);
  const scaleX = view.scaleX * k;
  const scaleY = view.scaleY * k;
  const widthUnits = (view.width as number) / scaleX;
  const heightUnits = (view.height as number) / scaleY;
  if (widthUnits < limits.minWidth || heightUnits < limits.minWidth || widthUnits > limits.maxWidth || heightUnits > limits.maxWidth) {
    return { viewport: view, refused: 'zoom_limit' };
  }
  const centre = Math.max(Math.abs(view.centreX as number), Math.abs(view.centreY as number), 1);
  if (widthUnits < RELATIVE_WIDTH_FLOOR * centre) {
    return { viewport: view, refused: 'precision_limit' };
  }
  // Keep m under p: shift the centre so the mapping holds at the new scale.
  const w = view.width as number;
  const h = view.height as number;
  const ncx = (m.x as number) - (((p.x as number) - w / 2) / scaleX);
  const ncy = (m.y as number) + (((p.y as number) - h / 2) / scaleY);
  const fixed = createViewport({
    widthPx: w,
    heightPx: h,
    centreX: ncx,
    centreY: ncy,
    scaleX,
    scaleY,
    dpr: view.dpr,
  });
  if (!fixed.ok) return { viewport: view, refused: 'zoom_limit' };
  return { viewport: fixed.value };
}

/** Pan by a view-pixel delta (dragging the background moves the scene with it). */
export function panBy(view: Viewport, dxPx: number, dyPx: number): Viewport {
  const built = createViewport({
    widthPx: view.width as number,
    heightPx: view.height as number,
    centreX: (view.centreX as number) - dxPx / view.scaleX,
    centreY: (view.centreY as number) + dyPx / view.scaleY,
    scaleX: view.scaleX,
    scaleY: view.scaleY,
    dpr: view.dpr,
  });
  return built.ok ? built.value : view;
}

/** Ease used by view tweens: `smooth(x) = x * x * (3 - 2 * x)` (design 4). */
export function smooth(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/**
 * Pure view tween: interpolate the log of the scales and the maths centre
 * linearly, eased. A function of `t` in [0, 1], so seeking is exact.
 */
export function tweenViewport(from: Viewport, to: Viewport, t: number): Viewport {
  const e = smooth(t);
  const scaleX = Math.exp((1 - e) * Math.log(from.scaleX) + e * Math.log(to.scaleX));
  const scaleY = Math.exp((1 - e) * Math.log(from.scaleY) + e * Math.log(to.scaleY));
  const built = createViewport({
    widthPx: from.width as number,
    heightPx: from.height as number,
    centreX: (1 - e) * (from.centreX as number) + e * (to.centreX as number),
    centreY: (1 - e) * (from.centreY as number) + e * (to.centreY as number),
    scaleX,
    scaleY,
    dpr: from.dpr,
  });
  return built.ok ? built.value : from;
}

/**
 * Liang-Barsky clip of a segment to a pixel rectangle. Returns the clipped
 * endpoints, or null when the segment misses. Used before painting so a point
 * at 1e12 never reaches the canvas (design 3).
 */
export function clipSegmentToRect(
  ax: number, ay: number, bx: number, by: number, rect: PxRect,
): readonly [number, number, number, number] | null {
  const x0 = rect.x0 as number;
  const x1 = rect.x1 as number;
  const y0 = rect.y0 as number;
  const y1 = rect.y1 as number;
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const edges: ReadonlyArray<readonly [number, number]> = [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/** Resolve an anchor to view pixels for a canvas of the given size. */
export function resolveAnchor(a: Anchor, view: Viewport): PxPoint {
  if (a.space === 'maths') return createMapper(view).toPx(a.p);
  const w = view.width as number;
  const h = view.height as number;
  const x = a.p.x as number;
  const y = a.p.y as number;
  switch (a.from) {
    case 'tl': return { x: px(x), y: px(y) };
    case 'tr': return { x: px(w - x), y: px(y) };
    case 'bl': return { x: px(x), y: px(h - y) };
    case 'br': return { x: px(w - x), y: px(h - y) };
  }
}

/** True when the canvas has no size yet; drawing pauses without an error. */
export function isDegenerateView(view: Viewport): boolean {
  return !((view.width as number) > 0) || !((view.height as number) > 0);
}

/** Fit-all: region covering `items` with an 8% margin (ui.md fit button). */
export function fitAllRegion(items: readonly MathsRect[], padFraction = 0.08): MathsRect | null {
  if (items.length === 0) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const r of items) {
    x0 = Math.min(x0, r.x0 as number);
    x1 = Math.max(x1, r.x1 as number);
    y0 = Math.min(y0, r.y0 as number);
    y1 = Math.max(y1, r.y1 as number);
  }
  const dx = Math.max(x1 - x0, 1e-9) * padFraction;
  const dy = Math.max(y1 - y0, 1e-9) * padFraction;
  return { x0: maths(x0 - dx), x1: maths(x1 + dx), y0: maths(y0 - dy), y1: maths(y1 + dy) };
}
