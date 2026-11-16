/**
 * Rules of points, vectors, lines and planes in space, their measures and intersections
 * (docs/features/space-3d/design.md 2.3, 7; errors.md 4; .kiro/specs/space-3d R1). A value that cannot be made is an
 * undefined value with a reason, never an error.
 */
import type { CommandRule, RuleCall } from '../../graph/registry';
import { formatNumber } from '../../language/runtime';
import type { Line3, Plane3, Polygon3, Ray3, Segment3 } from './types';
import { shape3Of } from './types';
import type { Frame, V3 } from './v3';
import { add, cross, dist, dot, finite, frameOf, isV3, len, mid, normalOf, scale, sizeOf, sub, toFrame, unit } from './v3';

const r = (run: (call: RuleCall) => unknown, extra: Partial<CommandRule> = {}): CommandRule => ({ run, ...extra });
const fmt = (x: number): string => formatNumber(Number(x.toPrecision(4)));
export const V = (call: RuleCall, i: number): V3 => call.values[i] as V3;

/** A scale-aware tolerance for inputs of this size. */
export const tolFor = (call: RuleCall, size: number): number => Math.max(call.tol, 1e-12) * Math.max(1, size);

/** False after failing the call when a coordinate is not finite. */
export function sane(call: RuleCall, ...ps: V3[]): boolean {
  if (ps.every(finite)) return true;
  call.fail('not_finite', 'a coordinate is not a finite number');
  return false;
}

/* ------------------------------ builders ------------------------------ */

export const line3 = (o: V3, d: V3): Line3 => ({ shape3: 'Line3', o, d });
export const ray3 = (o: V3, d: V3): Ray3 => ({ shape3: 'Ray3', o, d });
export const seg3 = (a: V3, b: V3): Segment3 => ({ shape3: 'Segment3', a, b });

/** The plane through `p` with unit normal `n`; `towards` sets its frame's first axis. */
export function plane3(p: V3, n: V3, towards?: V3): Plane3 {
  return { shape3: 'Plane', n, c: dot(n, p), f: frameOf(p, n, towards) };
}

/** Newell's normal of a closed loop: robust for any flat polygon, convex or not; its length is twice the area. */
export function newell(pts: readonly V3[]): V3 {
  let x = 0;
  let y = 0;
  let z = 0;
  const c = pts[0] as V3;
  for (let i = 0; i < pts.length; i++) {
    // relative to the first point, so a polygon far from the origin keeps its digits
    const a = sub(pts[i] as V3, c);
    const b = sub(pts[(i + 1) % pts.length] as V3, c);
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  return { x, y, z };
}

/**
 * A flat polygon through the points, or the reason it is not one: `degenerate` when they lie on one line,
 * `not_coplanar` with the first point off the plane and how far.
 */
export function polygon3(pts: readonly V3[], tol: number): Polygon3 | { reason: 'degenerate' | 'not_coplanar'; detail: string } {
  const size = sizeOf(pts);
  const o = pts[0] as V3;
  // the plane of the first three points not in a row: every later point must lie on it
  let n: V3 | undefined;
  let k = 2;
  const e1 = sub(pts[1] as V3, o);
  for (; k < pts.length && !n; k++) {
    const ek = sub(pts[k] as V3, o);
    const c = cross(e1, ek);
    // relative to the edges, so a polygon far from the origin is judged by its own size
    if (len(c) > Math.max(tol, 1e-12) * len(e1) * len(ek)) n = unit(c);
  }
  if (!n) return { reason: 'degenerate', detail: 'the points lie on one line' };
  // orient by Newell's normal, so the polygon's normal follows its winding
  if (dot(newell(pts), n) < 0) n = scale(n, -1);
  const c = dot(n, o);
  const flat = 1e-9 * size + tol;
  for (let i = 3; i < pts.length; i++) {
    const off = Math.abs(dot(n, pts[i] as V3) - c);
    if (off > flat) return { reason: 'not_coplanar', detail: `point ${i + 1} is ${fmt(off)} off the plane of the first three` };
  }
  return { shape3: 'Polygon3', pts, f: frameOf(o, n, pts[1]) };
}

/** A line-like value as origin, direction and its parameter range (a segment runs 0..1 along `b - a`). */
export interface LineLike {
  readonly o: V3;
  readonly d: V3;
  readonly lo: number;
  readonly hi: number;
}

export function lineLike(v: unknown): LineLike | undefined {
  const k = shape3Of(v);
  if (k === 'Line3') return { ...(v as Line3), lo: -Infinity, hi: Infinity };
  if (k === 'Ray3') return { ...(v as Ray3), lo: 0, hi: Infinity };
  if (k === 'Segment3') {
    const s = v as Segment3;
    return { o: s.a, d: sub(s.b, s.a), lo: 0, hi: 1 };
  }
  return undefined;
}

const within = (l: LineLike, t: number, tol: number): boolean => t >= l.lo - tol && t <= l.hi + tol;

/* ------------------------------ points, vectors, lines ------------------------------ */

export const vectorXYZ = r((call) => ({ x: call.values[0] as number, y: call.values[1] as number, z: call.values[2] as number }));
export const vectorPQ = r((call) => {
  const p = V(call, 0);
  const q = V(call, 1);
  return sane(call, p, q) ? sub(q, p) : undefined;
});
export const pointPlusVector = r((call) => {
  const p = V(call, 0);
  const v = V(call, 1);
  return sane(call, p, v) ? add(p, v) : undefined;
});

export const segment = r((call) => {
  const a = V(call, 0);
  const b = V(call, 1);
  return sane(call, a, b) ? seg3(a, b) : undefined;
});

const lineThrough = (make: (o: V3, d: V3) => unknown) => r((call) => {
  const p = V(call, 0);
  const q = V(call, 1);
  if (!sane(call, p, q)) return undefined;
  const d = unit(sub(q, p));
  return d ? make(p, d) : call.fail('degenerate', 'the two points are the same');
});
const lineAlong = (make: (o: V3, d: V3) => unknown) => r((call) => {
  const p = V(call, 0);
  const v = V(call, 1);
  if (!sane(call, p, v)) return undefined;
  const d = unit(v);
  return d ? make(p, d) : call.fail('degenerate', 'the direction is the zero vector');
});
export const linePQ = lineThrough(line3);
export const lineDir = lineAlong(line3);
export const rayPQ = lineThrough(ray3);
export const rayDir = lineAlong(ray3);

export const midpointPP = r(
  (call) => {
    const a = V(call, 0);
    const b = V(call, 1);
    return sane(call, a, b) ? mid(a, b) : undefined;
  },
  {
    // dragging the midpoint moves the first point and keeps the second (as in 2D)
    invert: (target, c) => {
      const b = c.values[1];
      if (!isV3(target) || !isV3(b)) return undefined;
      return [{ param: 0, value: sub(scale(target, 2), b) }];
    },
  },
);
export const midpointSeg = r((call) => {
  const s = call.values[0] as Segment3;
  return mid(s.a, s.b);
});

export const dotRule = r((call) => dot(V(call, 0), V(call, 1)));
export const crossRule = r((call) => cross(V(call, 0), V(call, 1)));
export const unitVector = r((call) => unit(V(call, 0)) ?? call.fail('degenerate', 'the zero vector has no direction'));
export const directionRule = r((call) => {
  const l = lineLike(call.values[0]) as LineLike;
  return unit(l.d) ?? call.fail('degenerate', 'the two ends are the same point');
});
export const normalRule = r((call) => {
  const v = call.values[0];
  if (shape3Of(v) === 'Plane') return (v as Plane3).n;
  return normalOf((v as Polygon3).f);
});

/* ------------------------------ planes ------------------------------ */

export const planePQR = r((call) => {
  const p = V(call, 0);
  const q = V(call, 1);
  const s = V(call, 2);
  if (!sane(call, p, q, s)) return undefined;
  const e1 = sub(q, p);
  const e2 = sub(s, p);
  const c = cross(e1, e2);
  const n = unit(c);
  if (!n || len(c) <= Math.max(call.tol, 1e-12) * len(e1) * len(e2)) return call.fail('degenerate', 'the three points lie on one line, so they fix no plane');
  return plane3(p, n, q);
});
export const planePN = r((call) => {
  const p = V(call, 0);
  const v = V(call, 1);
  if (!sane(call, p, v)) return undefined;
  const n = unit(v);
  return n ? plane3(p, n) : call.fail('degenerate', 'the normal is the zero vector');
});
export const planePL = r((call) => {
  const p = V(call, 0);
  const l = lineLike(call.values[1]) as LineLike;
  const c = cross(l.d, sub(p, l.o));
  const n = unit(c);
  if (!n || len(c) <= tolFor(call, sizeOf([p, l.o])) * len(l.d)) return call.fail('degenerate', 'the point is on the line, so they fix no plane');
  return plane3(l.o, n, add(l.o, l.d));
});
export const planeOfPolygon = r((call) => {
  const g = call.values[0] as Polygon3;
  return plane3(g.f.o, normalOf(g.f), g.pts[1]);
});

export const polygonPts = r((call) => {
  // the rest points come after the first three in `values`
  const pts = call.values as readonly V3[];
  if (!sane(call, ...pts)) return undefined;
  const g = polygon3(pts, call.tol);
  return 'reason' in g ? call.fail(g.reason, g.detail) : g;
});
export const polygonList = r((call) => {
  const pts = call.values[0] as readonly V3[];
  if (pts.length < 3) return call.fail('degenerate', 'a polygon needs at least three points');
  if (!sane(call, ...pts)) return undefined;
  const g = polygon3(pts, call.tol);
  return 'reason' in g ? call.fail(g.reason, g.detail) : g;
});

/* ------------------------------ measures ------------------------------ */

/** Closest point of a line-like value to `p`, clamped to its range. */
export function closestOn(l: LineLike, p: V3): V3 {
  const dd = dot(l.d, l.d);
  const t = Math.min(l.hi, Math.max(l.lo, dd > 0 ? dot(sub(p, l.o), l.d) / dd : 0));
  return add(l.o, scale(l.d, t));
}

export const distancePP = r((call) => dist(V(call, 0), V(call, 1)));
export const distancePL = r((call) => {
  const p = V(call, 0);
  return dist(p, closestOn(lineLike(call.values[1]) as LineLike, p));
});
export const distancePPlane = r((call) => {
  const pl = call.values[1] as Plane3;
  return Math.abs(dot(pl.n, V(call, 0)) - pl.c);
});

/** Distance between two infinite lines: the skew gap, or point to line when parallel. */
function lineLineGap(a: LineLike, b: LineLike): number {
  const n = cross(a.d, b.d);
  const nl = len(n);
  if (nl <= 1e-12 * len(a.d) * len(b.d)) return dist(b.o, closestOn({ ...a, lo: -Infinity, hi: Infinity }, b.o));
  return Math.abs(dot(sub(b.o, a.o), n)) / nl;
}

export const distanceLL = r((call) => {
  const a = lineLike(call.values[0]) as LineLike;
  const b = lineLike(call.values[1]) as LineLike;
  return lineLineGap({ ...a, lo: -Infinity, hi: Infinity }, { ...b, lo: -Infinity, hi: Infinity });
});
export const distancePlanePlane = r((call) => {
  const a = call.values[0] as Plane3;
  const b = call.values[1] as Plane3;
  const k = dot(a.n, b.n);
  if (Math.abs(Math.abs(k) - 1) > 1e-12) return 0;
  return Math.abs(a.c - Math.sign(k) * b.c);
});
export const distanceLPlane = r((call) => {
  const l = lineLike(call.values[0]) as LineLike;
  const pl = call.values[1] as Plane3;
  const d = unit(l.d);
  if (d && Math.abs(dot(d, pl.n)) > 1e-12) return 0;
  return Math.abs(dot(pl.n, l.o) - pl.c);
});

const clampAcos = (x: number): number => Math.acos(Math.min(1, Math.max(-1, x)));

export const angleVV = r((call) => {
  const a = unit(V(call, 0));
  const b = unit(V(call, 1));
  return a && b ? clampAcos(dot(a, b)) : call.fail('degenerate', 'the zero vector has no direction');
});
export const anglePVQ = r((call) => {
  const v = V(call, 1);
  const a = unit(sub(V(call, 0), v));
  const b = unit(sub(V(call, 2), v));
  return a && b ? clampAcos(dot(a, b)) : call.fail('degenerate', 'a point is at the vertex');
});
export const angleLL = r((call) => {
  const a = unit((lineLike(call.values[0]) as LineLike).d);
  const b = unit((lineLike(call.values[1]) as LineLike).d);
  return a && b ? clampAcos(Math.abs(dot(a, b))) : call.fail('degenerate', 'a line has no direction');
});
export const angleLPlane = r((call) => {
  const d = unit((lineLike(call.values[0]) as LineLike).d);
  const n = (call.values[1] as Plane3).n;
  return d ? Math.asin(Math.min(1, Math.abs(dot(d, n)))) : call.fail('degenerate', 'the line has no direction');
});
export const anglePlanePlane = r((call) => clampAcos(Math.abs(dot((call.values[0] as Plane3).n, (call.values[1] as Plane3).n))));

export const lengthVector = r((call) => len(V(call, 0)));
export const lengthSegment = r((call) => {
  const s = call.values[0] as Segment3;
  return dist(s.a, s.b);
});
export const areaPolygon = r((call) => len(newell((call.values[0] as Polygon3).pts)) / 2);

/* ------------------------------ intersections (design 7) ------------------------------ */

export const intersectLL = r((call) => {
  const a = lineLike(call.values[0]) as LineLike;
  const b = lineLike(call.values[1]) as LineLike;
  const size = sizeOf([a.o, b.o, add(a.o, a.d), add(b.o, b.d)]);
  const tol = tolFor(call, size);
  const n = cross(a.d, b.d);
  const nn = dot(n, n);
  const w = sub(b.o, a.o);
  if (Math.sqrt(nn) <= 1e-12 * len(a.d) * len(b.d)) {
    const gap = dist(b.o, closestOn({ ...a, lo: -Infinity, hi: Infinity }, b.o));
    return gap <= tol ? call.fail('coincident', 'the two lines are the same line') : call.fail('parallel', 'the lines run side by side and never meet');
  }
  const gap = Math.abs(dot(w, n)) / Math.sqrt(nn);
  if (gap > tol) return call.fail('skew', `the lines are skew: they pass ${fmt(gap)} apart`);
  // the closest points of the two lines (they meet within tol)
  const t = dot(cross(w, b.d), n) / nn;
  const s = dot(cross(w, a.d), n) / nn;
  if (!within(a, t, 1e-9) || !within(b, s, 1e-9)) return call.fail('no_intersection', 'the lines would meet past the end of a segment or ray');
  return mid(add(a.o, scale(a.d, t)), add(b.o, scale(b.d, s)));
});

/** Where a line-like value meets a plane: the point and its parameter, or the reason it does not. */
export function hitPlane(l: LineLike, pl: Plane3, tol: number): { p: V3; t: number } | { reason: 'parallel' | 'coincident' | 'no_intersection'; detail: string } {
  const nd = dot(pl.n, l.d);
  const off = dot(pl.n, l.o) - pl.c;
  if (Math.abs(nd) <= 1e-12 * len(l.d)) {
    return Math.abs(off) <= tol ? { reason: 'coincident', detail: 'the line lies in the plane' } : { reason: 'parallel', detail: 'the line runs parallel to the plane, so they never meet' };
  }
  const t = -off / nd;
  if (!within(l, t, 1e-9)) return { reason: 'no_intersection', detail: 'the plane is past the end of the segment or ray' };
  return { p: add(l.o, scale(l.d, t)), t };
}

export const intersectLPlane = r((call) => {
  const swap = shape3Of(call.values[0]) === 'Plane';
  const l = lineLike(call.values[swap ? 1 : 0]) as LineLike;
  const pl = call.values[swap ? 0 : 1] as Plane3;
  const h = hitPlane(l, pl, tolFor(call, sizeOf([l.o, pl.f.o])));
  return 'reason' in h ? call.fail(h.reason, h.detail) : h.p;
});

export const intersectPlanePlane = r((call) => {
  const a = call.values[0] as Plane3;
  const b = call.values[1] as Plane3;
  const d = cross(a.n, b.n);
  const dl = len(d);
  if (dl <= 1e-12) {
    const k = Math.sign(dot(a.n, b.n));
    return Math.abs(a.c - k * b.c) <= tolFor(call, sizeOf([a.f.o, b.f.o])) ? call.fail('coincident', 'the two planes are the same plane') : call.fail('parallel', 'the planes are parallel, so they never meet');
  }
  // the point of the line nearest the origin: a combination of the two normals
  const n12 = dot(a.n, b.n);
  const det = 1 - n12 * n12;
  const ca = (a.c - b.c * n12) / det;
  const cb = (b.c - a.c * n12) / det;
  return line3(add(scale(a.n, ca), scale(b.n, cb)), scale(d, 1 / dl));
});

/** Winding test in the polygon's own plane, with points on the edge counted inside. */
export function insidePolygon(g: Polygon3, p: V3, tol: number): boolean {
  const q = toFrame(g.f, p);
  const pts = g.pts.map((v) => toFrame(g.f, v));
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i] as { s: number; t: number };
    const b = pts[j] as { s: number; t: number };
    // on the edge
    const ex = b.s - a.s;
    const ey = b.t - a.t;
    const el = Math.hypot(ex, ey);
    if (el > 0) {
      const u = ((q.s - a.s) * ex + (q.t - a.t) * ey) / (el * el);
      if (u >= 0 && u <= 1 && Math.abs((q.s - a.s) * ey - (q.t - a.t) * ex) / el <= tol) return true;
    }
    if (a.t > q.t !== b.t > q.t && q.s < ((b.s - a.s) * (q.t - a.t)) / (b.t - a.t) + a.s) inside = !inside;
  }
  return inside;
}

export const intersectLPolygon = r((call) => {
  const l = lineLike(call.values[0]) as LineLike;
  const g = call.values[1] as Polygon3;
  const tol = tolFor(call, sizeOf([l.o, ...g.pts]));
  const pl = plane3(g.f.o, normalOf(g.f));
  const h = hitPlane(l, pl, tol);
  if ('reason' in h) return call.fail(h.reason, h.reason === 'coincident' ? 'the line lies in the plane of the polygon' : h.detail);
  return insidePolygon(g, h.p, tol) ? h.p : call.fail('no_intersection', 'the line meets the plane of the polygon outside it');
});

export type { Frame };
