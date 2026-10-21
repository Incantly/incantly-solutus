import type { Bounds, GeometryHelpers, Line, Point, Segment } from '../api/types';

const EPSILON = 1e-12;

const point = (x: number, y: number): Point => Object.freeze({ x, y });

/**
 * Clips the parametric line p(t) = a + t (b - a) to `bounds` for t in
 * [tMin, tMax] (Liang-Barsky). Returns null when nothing is inside.
 */
function clip(a: Point, b: Point, bounds: Bounds, tMin: number, tMax: number): Segment | null {
  const [x, y, width, height] = bounds;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return null;
  let t0 = tMin;
  let t1 = tMax;
  const edges: Array<[number, number]> = [
    [-dx, a.x - x],
    [dx, x + width - a.x],
    [-dy, a.y - y],
    [dy, y + height - a.y],
  ];
  for (const [p, q] of edges) {
    if (Math.abs(p) < EPSILON) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  if (t0 > t1) return null;
  return Object.freeze({ from: point(a.x + t0 * dx, a.y + t0 * dy), to: point(a.x + t1 * dx, a.y + t1 * dy) });
}

export const geometry: GeometryHelpers = {
  point,
  midpoint: (a, b) => point((a.x + b.x) / 2, (a.y + b.y) / 2),
  distance: (a, b) => Math.hypot(b.x - a.x, b.y - a.y),
  lineThrough: (a, b): Line => Object.freeze({ a: point(a.x, a.y), b: point(b.x, b.y) }),
  intersect(first, second) {
    const { a: p1, b: p2 } = first;
    const { a: p3, b: p4 } = second;
    const det = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
    if (Math.abs(det) < EPSILON) return null;
    const c1 = p1.x * p2.y - p1.y * p2.x;
    const c2 = p3.x * p4.y - p3.y * p4.x;
    return point((c1 * (p3.x - p4.x) - (p1.x - p2.x) * c2) / det, (c1 * (p3.y - p4.y) - (p1.y - p2.y) * c2) / det);
  },
  clipRay: (origin, through, bounds) => clip(origin, through, bounds, 0, Number.POSITIVE_INFINITY),
  clipLine: (a, b, bounds) => clip(a, b, bounds, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
};
