/**
 * Dragging (graphics-view design 12): drag plans, path projection, commit
 * rounding and keyboard nudges. The pointer lifecycle lives in the web layer;
 * this file is the pure maths behind it.
 */
import type { ObjId } from '@incantly/kernel';
import type { MathsPoint } from './coords';

export type DragPlanKind = 'free' | 'path' | 'slider' | 'parents' | 'label' | 'none';

export interface DragMoveRef {
  readonly id: ObjId;
  readonly role: 'point' | 'parameter' | 'number';
}

export interface DragPlan {
  readonly kind: DragPlanKind;
  readonly moves: readonly DragMoveRef[];
  /** When 'none': why, for the tooltip ("built from a midpoint"). */
  readonly reason?: string;
}

/** Facts the kernel side supplies once per object for its cached plan. */
export interface DragFacts {
  readonly free: boolean;
  readonly onPath: boolean;
  readonly pathDefined: boolean;
  readonly isSlider: boolean;
  readonly isLabel: boolean;
  readonly fixed: boolean;
  /** Free points the object was built from (empty when not parent-draggable). */
  readonly movableParents: readonly ObjId[];
  /** Short label for tooltips, e.g. "built from a midpoint". */
  readonly blockedReason: string;
}

/**
 * The cached drag plan (design 12.1). Dependent shapes move only when all
 * their inputs are free points or free numbers and the definition stays valid;
 * the kernel side precomputes that into `movableParents`.
 */
export function computeDragPlan(id: ObjId, facts: DragFacts): DragPlan {
  if (facts.fixed) return { kind: 'none', moves: [], reason: 'fixed' };
  if (facts.isLabel) return { kind: 'label', moves: [] };
  if (facts.free && !facts.onPath) return { kind: 'free', moves: [{ id, role: 'point' }] };
  if (facts.onPath) {
    if (!facts.pathDefined) return { kind: 'none', moves: [], reason: 'path_undefined' };
    return { kind: 'path', moves: [{ id, role: 'parameter' }] };
  }
  if (facts.isSlider) return { kind: 'slider', moves: [{ id, role: 'number' }] };
  if (facts.free) return { kind: 'free', moves: [{ id, role: 'point' }] };
  if (facts.movableParents.length > 0) {
    return { kind: 'parents', moves: facts.movableParents.map((p) => ({ id: p, role: 'point' as const })) };
  }
  return { kind: 'none', moves: [], reason: facts.blockedReason };
}

/** Pixels per maths unit, for pixel-space projection distances. */
export interface PixelMetric {
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface PathProjection {
  readonly s: number;
  readonly point: MathsPoint;
}

export interface PathProjector {
  project(p: MathsPoint, hint: number | null, metric: PixelMetric): PathProjection;
  readonly closed: boolean;
  readonly domain: { readonly lo: number; readonly hi: number };
}

export function clampParam(s: number, domain: { lo: number; hi: number }, closed: boolean): number {
  if (!Number.isFinite(s)) return domain.lo;
  if (closed) {
    const span = domain.hi - domain.lo;
    if (!(span > 0)) return domain.lo;
    return domain.lo + ((((s - domain.lo) % span) + span) % span);
  }
  return Math.min(domain.hi, Math.max(domain.lo, s));
}

/** Shortest wrap difference on a closed path, so drags do not spin (12.4). */
export function wrapDelta(from: number, to: number, domain: { lo: number; hi: number }): number {
  const span = domain.hi - domain.lo;
  let d = (to - from) % span;
  if (d > span / 2) d -= span;
  if (d < -span / 2) d += span;
  return d;
}

/* ---------------- closed-form projections (design 12.4) ---------------- */

function asMaths(x: number, y: number): MathsPoint {
  return { x: x as never, y: y as never };
}

/** Segment: fraction from the first to the second point, clamped 0..1. */
export function projectSegment(ax: number, ay: number, bx: number, by: number, p: MathsPoint): PathProjection {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const s = len2 > 0 ? ((p.x as number) - ax) * dx / len2 + (((p.y as number) - ay) * dy) / len2 : 0;
  const c = Math.min(1, Math.max(0, s));
  return { s: c, point: asMaths(ax + c * dx, ay + c * dy) };
}

/** Line: signed distance from the first defining point along the direction. */
export function projectLine(ox: number, oy: number, dx: number, dy: number, p: MathsPoint): PathProjection {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const s = ((p.x as number) - ox) * ux + ((p.y as number) - oy) * uy;
  return { s, point: asMaths(ox + s * ux, oy + s * uy) };
}

/** Ray: distance from the start in maths units, clamped at 0. */
export function projectRay(ox: number, oy: number, dx: number, dy: number, p: MathsPoint): PathProjection {
  const r = projectLine(ox, oy, dx, dy, p);
  const s = Math.max(0, r.s);
  const len = Math.hypot(dx, dy) || 1;
  return { s, point: asMaths(ox + (s * dx) / len, oy + (s * dy) / len) };
}

/** Circle: fraction of a full turn from the right-most point, wraps 0..1. */
export function projectCircle(cx: number, cy: number, r: number, p: MathsPoint): PathProjection {
  const a = Math.atan2((p.y as number) - cy, (p.x as number) - cx);
  const s = ((a / (2 * Math.PI)) % 1 + 1) % 1;
  return { s, point: asMaths(cx + r * Math.cos(a), cy + r * Math.sin(a)) };
}

/** Arc: fraction from start to end angle, clamped 0..1. */
export function projectArc(
  cx: number, cy: number, r: number, from: number, to: number, p: MathsPoint,
): PathProjection {
  const a = Math.atan2((p.y as number) - cy, (p.x as number) - cx);
  const span = to - from;
  let s = span !== 0 ? (a - from) / span : 0;
  s = Math.min(1, Math.max(0, s));
  const aa = from + s * span;
  return { s, point: asMaths(cx + r * Math.cos(aa), cy + r * Math.sin(aa)) };
}

/** Polygon: fraction of perimeter length, wraps 0..1. */
export function projectPolygon(pts: Float64Array, p: MathsPoint): PathProjection {
  const n = Math.floor(pts.length / 2);
  if (n < 2) return { s: 0, point: asMaths(pts[0] ?? 0, pts[1] ?? 0) };
  const cum: number[] = [0];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = Math.hypot((pts[j * 2] ?? 0) - (pts[i * 2] ?? 0), (pts[j * 2 + 1] ?? 0) - (pts[i * 2 + 1] ?? 0));
    cum.push((cum[i] ?? 0) + d);
  }
  const total = cum[n] ?? 1;
  let best = 0;
  let bestD = Infinity;
  let bestT = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[i * 2] ?? 0;
    const ay = pts[i * 2 + 1] ?? 0;
    const bx = pts[j * 2] ?? 0;
    const by = pts[j * 2 + 1] ?? 0;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, (((p.x as number) - ax) * dx + ((p.y as number) - ay) * dy) / len2)) : 0;
    const d = Math.hypot((p.x as number) - (ax + t * dx), (p.y as number) - (ay + t * dy));
    if (d < bestD) {
      bestD = d;
      best = i;
      bestT = t;
    }
  }
  const edgeLen = (cum[best + 1] ?? 0) - (cum[best] ?? 0);
  const s = total > 0 ? ((cum[best] ?? 0) + bestT * edgeLen) / total : 0;
  const j = (best + 1) % n;
  return {
    s,
    point: asMaths((pts[best * 2] ?? 0) + ((pts[j * 2] ?? 0) - (pts[best * 2] ?? 0)) * bestT,
      (pts[best * 2 + 1] ?? 0) + ((pts[j * 2 + 1] ?? 0) - (pts[best * 2 + 1] ?? 0)) * bestT),
  };
}

/* ------------- sampled projection for functions and curves ------------- */

/**
 * Coarse nearest sample in pixel space, then golden-section refine on the
 * squared pixel distance within ±1 sample (design 12.4). Accuracy target
 * 0.05 px, cost under 0.2 ms.
 */
export function projectOnSamples(
  pts: Float64Array,
  p: MathsPoint,
  metric: PixelMetric,
  hint: number | null,
  closed: boolean,
  pointerMovedPx: number,
): PathProjection {
  const n = Math.floor(pts.length / 2);
  if (n === 0) return { s: 0, point: asMaths(0, 0) };
  const pxOf = (i: number): number => (pts[i * 2] ?? 0) * metric.scaleX;
  const pyOf = (i: number): number => (pts[i * 2 + 1] ?? 0) * metric.scaleY;
  const tx = (p.x as number) * metric.scaleX;
  const ty = (p.y as number) * metric.scaleY;
  // Continuity: limit the search to a window around the hint unless the
  // pointer moved deliberately far (24 px window, 60 px escape).
  let lo = 0;
  let hi = n - 1;
  if (hint !== null && pointerMovedPx <= 60) {
    const hc = Math.round(hint * (n - 1));
    // 24 px along the path, estimated from the mean sample spacing.
    let span = 0;
    let acc = 0;
    for (let i = Math.max(1, hc); i < n && acc < 24; i++) {
      acc += Math.hypot(pxOf(i) - pxOf(i - 1), pyOf(i) - pyOf(i - 1));
      span++;
    }
    span = Math.max(span, 2);
    lo = Math.max(0, hc - span);
    hi = Math.min(n - 1, hc + span);
  }
  let bi = lo;
  let bd = Infinity;
  for (let i = lo; i <= hi; i++) {
    const d = (pxOf(i) - tx) ** 2 + (pyOf(i) - ty) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  // Golden-section refine between the neighbouring samples.
  const a = closed ? bi - 1 : Math.max(bi - 1, 0);
  const b = closed ? bi + 1 : Math.min(bi + 1, n - 1);
  const at = (f: number): { x: number; y: number } => {
    const i0 = Math.floor(f);
    const t = f - i0;
    const iA = closed ? ((i0 % n) + n) % n : Math.min(Math.max(i0, 0), n - 1);
    const iB = closed ? ((i0 + 1) % n + n) % n : Math.min(Math.max(i0 + 1, 0), n - 1);
    return {
      x: pxOf(iA) + (pxOf(iB) - pxOf(iA)) * t,
      y: pyOf(iA) + (pyOf(iB) - pyOf(iA)) * t,
    };
  };
  const dist2 = (f: number): number => {
    const q = at(f);
    return (q.x - tx) ** 2 + (q.y - ty) ** 2;
  };
  const gr = (Math.sqrt(5) - 1) / 2;
  let loF = a;
  let hiF = b;
  let c = hiF - gr * (hiF - loF);
  let d = loF + gr * (hiF - loF);
  for (let iter = 0; iter < 24; iter++) {
    if (dist2(c) < dist2(d)) hiF = d;
    else loF = c;
    c = hiF - gr * (hiF - loF);
    d = loF + gr * (hiF - loF);
  }
  const f = (loF + hiF) / 2;
  const q = at(f);
  const s = closed ? ((((f / (n - 1)) % 1) + 1) % 1) : Math.min(1, Math.max(0, f / Math.max(n - 1, 1)));
  return { s, point: asMaths(q.x / metric.scaleX, q.y / metric.scaleY) };
}

/* ---------------- commit rounding and nudges ---------------- */

/**
 * Saved drag results round to the displayed precision of the view:
 * `ceil(-log10(1 / scale)) + 1` digits (design 12.6).
 */
export function commitDigits(scale: number): number {
  return Math.ceil(-Math.log10(1 / Math.max(scale, 1e-300))) + 1;
}

export function roundForCommit(value: number, scale: number): number {
  const digits = Math.min(Math.max(commitDigits(scale), 0), 12);
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export type NudgeModifier = 'none' | 'shift' | 'alt';

/**
 * Keyboard nudge (12.7): 1 px, or the grid step when snapping is on;
 * shift ×10, alt ×0.1.
 */
export function nudgeStep(scale: number, gridStep: number | null, snapping: boolean, mod: NudgeModifier): number {
  const base = snapping && gridStep !== null && gridStep > 0 ? gridStep : 1 / Math.max(scale, 1e-300);
  if (mod === 'shift') return base * 10;
  if (mod === 'alt') return base * 0.1;
  return base;
}

/** Free-point target: pointer minus the grab offset, in maths units. */
export function freePointTarget(
  pointer: MathsPoint,
  grabOffset: { dx: number; dy: number },
): MathsPoint {
  return asMaths((pointer.x as number) - grabOffset.dx, (pointer.y as number) - grabOffset.dy);
}

/** Slider value from a pointer position along the track, quantised to step. */
export function sliderTarget(
  pointerPx: number, trackPx0: number, trackPx1: number, lo: number, hi: number, step: number,
): number {
  const span = trackPx1 - trackPx0;
  const f = span !== 0 ? (pointerPx - trackPx0) / span : 0;
  const v = lo + Math.min(1, Math.max(0, f)) * (hi - lo);
  if (!(step > 0)) return v;
  const q = lo + Math.round((v - lo) / step) * step;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number(Math.min(hi, Math.max(lo, q)).toFixed(Math.min(decimals, 12)));
}
