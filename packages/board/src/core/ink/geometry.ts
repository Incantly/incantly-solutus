/**
 * Geometry of stored strokes: bounds, the distance from a segment (the eraser's path), cutting a stroke where the
 * eraser passed, and how many of its points a loop encloses. Plain numbers in, plain numbers out; no DOM.
 */
import { pointInPolygon } from '../index-grid';
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
  const lax = ax - shape.x;
  const lay = ay - shape.y;
  const lbx = bx - shape.x;
  const lby = by - shape.y;
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
 * Cuts a stroke where the eraser's path passed: each segment that the path touches goes, and the runs of two or more
 * points that are left are the pieces (new arrays; the stroke's own array is not written). Returns null when the path
 * touched nothing, an empty list when nothing is left.
 */
export function cutInk(shape: ShapeRecord<string, InkProps>, ax: number, ay: number, bx: number, by: number, radius: number): Float32Array[] | null {
  const { points, stride, size } = shape.props;
  const n = Math.floor(points.length / stride);
  const reach = radius + size * 0.5;
  const reach2 = reach * reach;
  const lax = ax - shape.x;
  const lay = ay - shape.y;
  const lbx = bx - shape.x;
  const lby = by - shape.y;
  if (n === 0) return null;
  if (n === 1) {
    return pointSegmentDistSq(points[0] as number, points[1] as number, lax, lay, lbx, lby) <= reach2 ? [] : null;
  }
  const pieces: Float32Array[] = [];
  let touched = false;
  let start = 0;
  for (let j = 0; j + 1 < n; j++) {
    const hit =
      segmentDistSq(
        points[j * stride] as number, points[j * stride + 1] as number,
        points[(j + 1) * stride] as number, points[(j + 1) * stride + 1] as number,
        lax, lay, lbx, lby,
      ) <= reach2;
    if (!hit) continue;
    touched = true;
    if (j - start + 1 >= 2) pieces.push(points.slice(start * stride, (j + 1) * stride));
    start = j + 1;
  }
  if (!touched) return null;
  if (n - start >= 2) pieces.push(points.slice(start * stride, n * stride));
  return pieces;
}

/** How many of the stroke's points are inside the polygon `[x0, y0, x1, y1, …]` of page units. */
export function pointsInside(shape: ShapeRecord<string, InkProps>, polygon: readonly number[]): number {
  const { points, stride } = shape.props;
  const n = Math.floor(points.length / stride);
  let inside = 0;
  for (let i = 0; i < n; i++) {
    if (pointInPolygon(shape.x + (points[i * stride] as number), shape.y + (points[i * stride + 1] as number), polygon)) inside++;
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
    if (pointInPolygon(shape.x + (points[i * stride] as number), shape.y + (points[i * stride + 1] as number), polygon)) {
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
