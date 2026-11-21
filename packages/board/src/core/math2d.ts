/** Small plane geometry the kinds, the tools and snapping share. Plain numbers in, plain numbers out; no DOM. */
import type { Bounds } from './types';

export const TAU = Math.PI * 2;

/** An angle brought into (-π, π]. */
export function wrapAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}

/** The box with sides `minX..maxX`, `minY..maxY` (the caller keeps min below max). */
export const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY });

export const boxW = (b: Bounds): number => b.maxX - b.minX;
export const boxH = (b: Bounds): number => b.maxY - b.minY;
export const boxCx = (b: Bounds): number => (b.minX + b.maxX) / 2;
export const boxCy = (b: Bounds): number => (b.minY + b.maxY) / 2;

/** The box grown by `by` on every side. */
export const grow = (b: Bounds, by: number): Bounds => ({ minX: b.minX - by, minY: b.minY - by, maxX: b.maxX + by, maxY: b.maxY + by });

/** The box moved by `dx, dy`. */
export const shift = (b: Bounds, dx: number, dy: number): Bounds => ({ minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy });

export const boxesMeet = (a: Bounds, b: Bounds): boolean => a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** The box of the points `[x0, y0, x1, y1, …]`; the empty box at the origin for none. */
export function pointsBox(points: ArrayLike<number>): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i] as number;
    const y = points[i + 1] as number;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return minX > maxX ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}

/** The point `(x, y)` turned by `angle` about `(cx, cy)`. */
export function rotateAbout(x: number, y: number, cx: number, cy: number, angle: number): { x: number; y: number } {
  if (angle === 0) return { x, y };
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/** The squared distance from a point to a segment. */
export function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const x = ax + t * dx - px;
  const y = ay + t * dy - py;
  return x * x + y * y;
}

/** The distance from a point to the line through `points` (a closed ring when `closed`). */
export function distToPath(px: number, py: number, points: ArrayLike<number>, closed: boolean): number {
  const n = Math.floor(points.length / 2);
  if (n === 0) return Infinity;
  if (n === 1) return Math.hypot(px - (points[0] as number), py - (points[1] as number));
  let best = Infinity;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const d = distToSegmentSq(px, py, points[i * 2] as number, points[i * 2 + 1] as number, points[j * 2] as number, points[j * 2 + 1] as number);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** True when the point is inside the closed polygon `[x0, y0, x1, y1, …]` (even-odd rule). */
export function inPolygon(px: number, py: number, poly: ArrayLike<number>): boolean {
  const n = Math.floor(poly.length / 2);
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2] as number;
    const yi = poly[i * 2 + 1] as number;
    const xj = poly[j * 2] as number;
    const yj = poly[j * 2 + 1] as number;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The point of the closed polygon's outline nearest `from`, reached by walking the segment from `from` to `to`: the first crossing, or null when the segment crosses nothing. */
export function firstCrossing(poly: ArrayLike<number>, fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number } | null {
  const n = Math.floor(poly.length / 2);
  let bestT = Infinity;
  const rx = toX - fromX;
  const ry = toY - fromY;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = poly[i * 2] as number;
    const ay = poly[i * 2 + 1] as number;
    const sx = (poly[j * 2] as number) - ax;
    const sy = (poly[j * 2 + 1] as number) - ay;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - fromX) * sy - (ay - fromY) * sx) / den;
    const u = ((ax - fromX) * ry - (ay - fromY) * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < bestT) bestT = t;
  }
  return bestT === Infinity ? null : { x: fromX + rx * bestT, y: fromY + ry * bestT };
}

/** A regular polygon approximating the ellipse in the box `0, 0, w, h`, `sides` corners, as `[x0, y0, …]`. */
export function ellipsePoly(w: number, h: number, sides = 48): number[] {
  const out: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU;
    out.push(w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2);
  }
  return out;
}

/** The finite number or the fallback. */
export const finiteOr = (v: number, fallback: number): number => (Number.isFinite(v) ? v : fallback);

/** `v` kept between `lo` and `hi`. */
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
