/**
 * Geometry of stored strokes: bounds, the distance from a segment (the eraser's path), cutting a stroke where the
 * eraser passed, and how many of its points a loop encloses. Plain numbers in, plain numbers out; no DOM.
 */
import { pointInPolygon } from '../index-grid';
import { rotateAbout } from '../math2d';
import { sampleHalfWidth } from './outline';
import type { InkProps } from '../kinds/ink';
import type { Bounds, ShapeRecord } from '../types';

/** How much wider than `size` a stroke can get: the tilt of a marker nib. */
const WIDEST = 1.65;

export type InkShape = ShapeRecord<'ink', InkProps>;

const cache = new WeakMap<object, Bounds>();

/** The page box a stroke covers, grown by its widest half width. Cached on the record. */
export function inkBounds(shape: ShapeRecord<string, InkProps>): Bounds {
  const known = cache.get(shape);
  if (known !== undefined) return known;
  const { points, stride, size } = shape.props;
  const n = Math.floor(points.length / stride);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = points[i * stride] as number;
    const y = points[i * stride + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (n === 0) {
    minX = minY = maxX = maxY = 0;
  }
  const pad = size * 0.5 * WIDEST + 0.5;
  const box: Bounds = { minX: shape.x + minX - pad, minY: shape.y + minY - pad, maxX: shape.x + maxX + pad, maxY: shape.y + maxY + pad };
  cache.set(shape, box);
  return box;
}

/**
 * A stroke turns about the middle of its points' box (BR-21; `core/geometry.ts`): its page point is
 * `(x, y) + c + R(rotation) (l - c)` for a point `l` of its own coordinates. These find `c` and move points between the
 * two, so the eraser and the lasso read a turned stroke where it is drawn.
 */
const pivots = new WeakMap<object, { readonly x: number; readonly y: number }>();

/** The centre of the stroke's points' box, in its own coordinates. */
export function inkPivot(shape: ShapeRecord<string, InkProps>): { readonly x: number; readonly y: number } {
  const known = pivots.get(shape);
  if (known !== undefined) return known;
  const { points, stride } = shape.props;
  const n = Math.floor(points.length / stride);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = points[i * stride] as number;
    const y = points[i * stride + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const c = n === 0 ? { x: 0, y: 0 } : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  pivots.set(shape, c);
  return c;
}

/** A page point in the stroke's own coordinates (the point itself, less the origin, when the stroke is not turned). */
export function inkToLocal(shape: ShapeRecord<string, InkProps>, px: number, py: number): { x: number; y: number } {
  const dx = px - shape.x;
  const dy = py - shape.y;
  if (shape.rotation === 0) return { x: dx, y: dy };
  const c = inkPivot(shape);
  return rotateAbout(dx, dy, c.x, c.y, -shape.rotation);
}

/** A stroke's point (its own coordinates) on the page. */
export function inkToPage(shape: ShapeRecord<string, InkProps>, lx: number, ly: number): { x: number; y: number } {
  if (shape.rotation === 0) return { x: shape.x + lx, y: shape.y + ly };
  const c = inkPivot(shape);
  const r = rotateAbout(lx, ly, c.x, c.y, shape.rotation);
  return { x: shape.x + r.x, y: shape.y + r.y };
}

/** The same stroke with its turn written into its points (rotation 0), so a piece cut from it keeps its place. */
export function bakeInkRotation(shape: ShapeRecord<string, InkProps>): ShapeRecord<string, InkProps> {
  if (shape.rotation === 0) return shape;
  const c = inkPivot(shape);
  const { points, stride } = shape.props;
  const out = points.slice();
  const n = Math.floor(out.length / stride);
  for (let i = 0; i < n; i++) {
    const r = rotateAbout(out[i * stride] as number, out[i * stride + 1] as number, c.x, c.y, shape.rotation);
    out[i * stride] = r.x;
    out[i * stride + 1] = r.y;
  }
  return { ...shape, rotation: 0, props: { ...shape.props, points: out } };
}

/** The squared distance from the point to the segment `a`-`b`. */
export function pointSegmentDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
}

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** The squared distance between two segments. */
export function segmentDistSq(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0;
  return Math.min(
    pointSegmentDistSq(ax, ay, cx, cy, dx, dy),
    pointSegmentDistSq(bx, by, cx, cy, dx, dy),
    pointSegmentDistSq(cx, cy, ax, ay, bx, by),
    pointSegmentDistSq(dx, dy, ax, ay, bx, by),
  );
}

/** True when the eraser's path (the segment `a`-`b`, grown by `radius`) touches the stroke's line or its width. */
export function inkTouches(shape: ShapeRecord<string, InkProps>, ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  const { points, stride, size } = shape.props;
  const n = Math.floor(points.length / stride);
  const reach = radius + size * 0.5;
  const reach2 = reach * reach;
  const la = inkToLocal(shape, ax, ay);
  const lb = inkToLocal(shape, bx, by);
  const lax = la.x;
  const lay = la.y;
  const lbx = lb.x;
  const lby = lb.y;
  if (n === 1) return pointSegmentDistSq(points[0] as number, points[1] as number, lax, lay, lbx, lby) <= reach2;
  for (let i = 0; i + 1 < n; i++) {
    const x0 = points[i * stride] as number;
    const y0 = points[i * stride + 1] as number;
    const x1 = points[(i + 1) * stride] as number;
    const y1 = points[(i + 1) * stride + 1] as number;
    if (segmentDistSq(x0, y0, x1, y1, lax, lay, lbx, lby) <= reach2) return true;
  }
  return false;
}

/**
 * Cuts a stroke where the eraser's path passed. A segment is split at the edge of the eraser, not thrown away: the
 * pieces end where the ink meets the ring, and a run of two or more points is kept (new arrays; the stroke's own
 * array is not written). Returns null when the path touched nothing, an empty list when nothing is left.
 */
export function cutInk(turned: ShapeRecord<string, InkProps>, ax: number, ay: number, bx: number, by: number, radius: number): Float32Array[] | null {
  // a turned stroke is cut where it is drawn; its pieces have the turn written in and belong to a shape with rotation 0
  const shape = bakeInkRotation(turned);
  const { points, stride, size, nib } = shape.props;
  const n = Math.floor(points.length / stride);
  const lax = ax - shape.x;
  const lay = ay - shape.y;
  const lbx = bx - shape.x;
  const lby = by - shape.y;
  if (n === 0) return null;
  if (n === 1) {
    const half = halfAt(points, stride, size, nib, 0, 1, 0);
    return pointSegmentDistSq(points[0] as number, points[1] as number, lax, lay, lbx, lby) <= (radius + half) * (radius + half) ? [] : null;
  }
  const pieces: Float32Array[] = [];
  const run: number[] = [];
  let open = false;
  let touched = false;
  const close = (): void => {
    if (run.length >= stride * 2) pieces.push(Float32Array.from(run));
    run.length = 0;
    open = false;
  };
  const dropLast = (): void => {
    run.length = Math.max(0, run.length - stride);
    if (run.length >= stride * 2) close();
    else {
      run.length = 0;
      open = false;
    }
  };
  for (let j = 0; j + 1 < n; j++) {
    const half = Math.max(halfAt(points, stride, size, nib, j, j + 1, 0), halfAt(points, stride, size, nib, j, j + 1, 1));
    const span = erasedSpan(
      points[j * stride] as number, points[j * stride + 1] as number,
      points[(j + 1) * stride] as number, points[(j + 1) * stride + 1] as number,
      lax, lay, lbx, lby, radius + half,
    );
    if (span === null) {
      if (!open) {
        pointAt(run, points, stride, j, 0);
        open = true;
      }
      pointAt(run, points, stride, j, 1);
      continue;
    }
    touched = true;
    const e0 = span[0];
    const e1 = span[1];
    if (e0 <= SPAN_EPS) {
      if (open) dropLast();
    } else {
      if (!open) pointAt(run, points, stride, j, 0);
      pointAt(run, points, stride, j, e0);
      close();
    }
    if (e1 < 1 - SPAN_EPS) {
      pointAt(run, points, stride, j, e1);
      pointAt(run, points, stride, j, 1);
      open = true;
    }
  }
  if (open) close();
  return touched ? pieces : null;
}

/** Shorter than this, an erased span is the same point. */
const SPAN_EPS = 1e-5;

/** Half the drawn width at `t` along the segment from point `j` to `j + 1`. */
function halfAt(points: Float32Array, stride: number, size: number, nib: InkProps['nib'], j: number, next: number, t: number): number {
  const i0 = j * stride;
  const i1 = next * stride;
  const pressure = (points[i0 + 2] as number) + ((points[i1 + 2] as number) - (points[i0 + 2] as number)) * t;
  const dx = (points[i1] as number) - (points[i0] as number);
  const dy = (points[i1 + 1] as number) - (points[i0 + 1] as number);
  const len = Math.hypot(dx, dy);
  const tiltX = stride === 5 ? (points[i0 + 3] as number) : 0;
  const tiltY = stride === 5 ? (points[i0 + 4] as number) : 0;
  return sampleHalfWidth(size, nib, pressure, tiltX, tiltY, len > 0 ? dx / len : 1, len > 0 ? dy / len : 0);
}

/** Appends the point at `t` along the segment that starts at point `j`. */
function pointAt(out: number[], points: Float32Array, stride: number, j: number, t: number): void {
  const i0 = j * stride;
  const i1 = (j + 1) * stride;
  for (let k = 0; k < stride; k++) {
    const a = points[i0 + k] as number;
    out.push(a + ((points[i1 + k] as number) - a) * t);
  }
}

/**
 * The part of segment `a`-`b` that comes within `reach` of segment `c`-`d`, as `t` from 0 to 1, or null when it
 * misses. A capsule is convex, so the part is one interval.
 */
function erasedSpan(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number, reach: number): [number, number] | null {
  const abx = bx - ax;
  const aby = by - ay;
  const cdx = dx - cx;
  const cdy = dy - cy;
  const cd2 = cdx * cdx + cdy * cdy;
  const reach2 = reach * reach;
  let lo = 1;
  let hi = 0;
  let any = false;
  const take = (span: [number, number] | null): void => {
    if (span === null) return;
    any = true;
    if (span[0] < lo) lo = span[0];
    if (span[1] > hi) hi = span[1];
  };
  // a point eraser is only the circle; a segment also has the circle at its far end and the band between them
  take(clipSpan(diskSpan(ax, ay, abx, aby, cx, cy, reach2), ax, ay, abx, aby, cx, cy, cdx, cdy, cd2, -Infinity, cd2 > 1e-18 ? 0 : Infinity));
  if (cd2 > 1e-18) {
    take(clipSpan(diskSpan(ax, ay, abx, aby, dx, dy, reach2), ax, ay, abx, aby, cx, cy, cdx, cdy, cd2, 1, Infinity));
    take(clipSpan(slabSpan(ax, ay, abx, aby, cx, cy, cdx, cdy, cd2, reach), ax, ay, abx, aby, cx, cy, cdx, cdy, cd2, 0, 1));
  }
  if (!any) return null;
  const a = lo < 0 ? 0 : lo;
  const b = hi > 1 ? 1 : hi;
  return a <= b ? [a, b] : null;
}

/** Where `|P(t) - centre|^2 <= reach2` on the infinite line through the segment. `P(t) = (ax, ay) + t (abx, aby)`. */
function diskSpan(ax: number, ay: number, abx: number, aby: number, cx: number, cy: number, reach2: number): [number, number] | null {
  const vx = ax - cx;
  const vy = ay - cy;
  const qa = abx * abx + aby * aby;
  const qb = 2 * (vx * abx + vy * aby);
  const qc = vx * vx + vy * vy - reach2;
  if (qa < 1e-18) return qc <= 0 ? [0, 1] : null;
  const disc = qb * qb - 4 * qa * qc;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = (-qb - s) / (2 * qa);
  const t1 = (-qb + s) / (2 * qa);
  return t0 < t1 ? [t0, t1] : [t1, t0];
}

/** Where the line stays within `reach` of the infinite line through `c` to `c + cd`. */
function slabSpan(ax: number, ay: number, abx: number, aby: number, cx: number, cy: number, cdx: number, cdy: number, cd2: number, reach: number): [number, number] | null {
  const limit = reach * Math.sqrt(cd2);
  const g0 = (ax - cx) * cdy - (ay - cy) * cdx;
  const gd = abx * cdy - aby * cdx;
  if (Math.abs(gd) < 1e-14) return Math.abs(g0) <= limit ? [-Infinity, Infinity] : null;
  const tA = (-limit - g0) / gd;
  const tB = (limit - g0) / gd;
  return tA < tB ? [tA, tB] : [tB, tA];
}

/** `span` limited to the `t` whose projection onto `c` to `c + cd` lies between `uMin` and `uMax`, and to 0..1. */
function clipSpan(span: [number, number] | null, ax: number, ay: number, abx: number, aby: number, cx: number, cy: number, cdx: number, cdy: number, cd2: number, uMin: number, uMax: number): [number, number] | null {
  if (span === null) return null;
  let lo = span[0];
  let hi = span[1];
  if (cd2 > 1e-18 && uMax < Infinity) {
    const u0 = ((ax - cx) * cdx + (ay - cy) * cdy) / cd2;
    const du = (abx * cdx + aby * cdy) / cd2;
    const along = duRange(u0, du, uMin, uMax);
    if (along === null) return null;
    if (along[0] > lo) lo = along[0];
    if (along[1] < hi) hi = along[1];
  }
  if (lo < 0) lo = 0;
  if (hi > 1) hi = 1;
  return lo <= hi ? [lo, hi] : null;
}

/** The `t` for which `u0 + t du` lies between `uMin` and `uMax`. */
function duRange(u0: number, du: number, uMin: number, uMax: number): [number, number] | null {
  if (Math.abs(du) < 1e-14) return u0 >= uMin && u0 <= uMax ? [-Infinity, Infinity] : null;
  const tOf = (u: number): number => (u - u0) / du;
  if (du > 0) return [uMin === -Infinity ? -Infinity : tOf(uMin), uMax === Infinity ? Infinity : tOf(uMax)];
  return [uMax === Infinity ? -Infinity : tOf(uMax), uMin === -Infinity ? Infinity : tOf(uMin)];
}

/** How many of the stroke's points are inside the polygon `[x0, y0, x1, y1, …]` of page units. */
export function pointsInside(shape: ShapeRecord<string, InkProps>, polygon: readonly number[]): number {
  const { points, stride } = shape.props;
  const n = Math.floor(points.length / stride);
  let inside = 0;
  for (let i = 0; i < n; i++) {
    const p = inkToPage(shape, points[i * stride] as number, points[i * stride + 1] as number);
    if (pointInPolygon(p.x, p.y, polygon)) inside++;
  }
  return inside;
}

/**
 * True when more than half of the stroke's points are inside the polygon: the same answer as
 * `pointsInside(shape, polygon) * 2 > count`, and it stops as soon as that is settled, either way.
 */
export function mostlyInside(shape: ShapeRecord<string, InkProps>, polygon: readonly number[]): boolean {
  const { points, stride } = shape.props;
  const n = Math.floor(points.length / stride);
  if (n === 0) return false;
  let inside = 0;
  let outside = 0;
  for (let i = 0; i < n; i++) {
    const p = inkToPage(shape, points[i * stride] as number, points[i * stride + 1] as number);
    if (pointInPolygon(p.x, p.y, polygon)) {
      inside++;
      if (inside * 2 > n) return true;
    } else {
      outside++;
      // inside can no longer pass half
      if (outside * 2 >= n) return false;
    }
  }
  return inside * 2 > n;
}
