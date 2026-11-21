/**
 * From figure values to physics shapes (docs/features/physics/design.md 2.1, 6.4, 6.8): the convex parts of a body's
 * shape, and the walls a solid shape becomes (solid blocks, round posts, thin walls along lines and curves).
 */
import { isArcV, isCircleV, isConicV, isFunctionV, isGeomCurveV, isLineV, isPolygonV, isPolylineV, isRayV, isSegmentV } from '../geometry/types';
import { pathOf } from '../geometry/points';
import type { Pt } from '../../physics/geom2';
import { area2, cleanPolygon, convexParts, ellipsePoints, firstCrossing } from '../../physics/geom2';
import { cos, sin } from '../../physics/math';
import type { ShapeDef2 } from '../../physics/world2';
import type { Outline } from './types';

/** Corners of an ellipse used for contacts (design 6.4). */
export const ELLIPSE_SIDES = 24;
/** Pieces a solid curve is cut into, at most (design 11.3). */
export const MAX_GROUND_PIECES = 2000;

export type BodyShape =
  | { readonly ok: true; readonly shapes: ShapeDef2[]; readonly outline: Outline; readonly parts: number }
  | { readonly ok: false; readonly why: 'no_area' | 'self_crossing' | 'degenerate'; readonly edges?: readonly [number, number]; readonly detail: string };

/** The shape of a body: polygons, boxes, circles, ellipses and closed polylines. */
export function bodyShapeOf(v: unknown): BodyShape {
  if (isPolygonV(v)) return polygonBody(v.pts as Pt[]);
  if (isPolylineV(v)) {
    const pts = v.pts as Pt[];
    const first = pts[0];
    const last = pts[pts.length - 1];
    if (pts.length >= 4 && first && last && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.y - last.y) < 1e-9) return polygonBody(pts.slice(0, -1));
    return { ok: false, why: 'no_area', detail: 'an open polyline has no area' };
  }
  if (isCircleV(v)) {
    if (!(v.r > 0)) return { ok: false, why: 'degenerate', detail: 'a circle of radius 0 has no area' };
    return { ok: true, shapes: [{ kind: 'circle', x: v.cx, y: v.cy, r: v.r }], outline: { kind: 'circle', cx: v.cx, cy: v.cy, r: v.r }, parts: 1 };
  }
  if (isConicV(v) && (v.kind === 'ellipse' || v.kind === 'circle') && v.frame && 'cx' in v.frame) {
    const f = v.frame;
    if (v.kind === 'circle' || Math.abs(f.a - f.b) < 1e-12) {
      return { ok: true, shapes: [{ kind: 'circle', x: f.cx, y: f.cy, r: f.a }], outline: { kind: 'circle', cx: f.cx, cy: f.cy, r: f.a }, parts: 1 };
    }
    const pts = ellipsePoints(f.cx, f.cy, f.ux, f.uy, f.a, f.b, ELLIPSE_SIDES, sin, cos);
    return { ok: true, shapes: [{ kind: 'poly', pts }], outline: { kind: 'ellipse', pts, cx: f.cx, cy: f.cy, ux: f.ux, uy: f.uy, a: f.a, b: f.b }, parts: 1 };
  }
  return { ok: false, why: 'no_area', detail: 'it has no area' };
}

function polygonBody(raw: readonly Pt[]): BodyShape {
  const cross = firstCrossing(raw);
  if (cross) return { ok: false, why: 'self_crossing', edges: cross, detail: `edges ${cross[0] + 1} and ${cross[1] + 1} cross` };
  const pts = cleanPolygon(raw);
  if (pts.length < 3 || !(Math.abs(area2(pts)) > 1e-12)) return { ok: false, why: 'degenerate', detail: 'all its corners are on one line' };
  const parts = convexParts(pts);
  if (parts.length === 0) return { ok: false, why: 'degenerate', detail: 'it has no area' };
  return { ok: true, shapes: parts.map((p) => ({ kind: 'poly', pts: p })), outline: { kind: 'polygon', pts }, parts: parts.length };
}

/** A segment as a thin two-sided wall. */
const wall = (a: Pt, b: Pt): ShapeDef2 => ({ kind: 'poly', pts: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] });

/** Cuts a line through p with direction d to the world square of half size `range`; undefined when it misses it. */
function clipLine(p: Pt, d: Pt, range: number, t0 = -Infinity, t1 = Infinity): [Pt, Pt] | undefined {
  let lo = t0;
  let hi = t1;
  for (const [o, dd] of [[p.x, d.x], [p.y, d.y]] as const) {
    if (Math.abs(dd) < 1e-15) {
      if (o < -range || o > range) return undefined;
      continue;
    }
    let a = (-range - o) / dd;
    let b = (range - o) / dd;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
  }
  if (!(hi > lo)) return undefined;
  return [{ x: p.x + lo * d.x, y: p.y + lo * d.y }, { x: p.x + hi * d.x, y: p.y + hi * d.y }];
}

export interface SolidShape {
  readonly shapes: ShapeDef2[];
  /** True when a curve was cut short to the piece limit or the world. */
  readonly sampled: boolean;
}

/**
 * The walls a solid shape becomes. Polygons are solid blocks (split into convex parts), circles round posts, ellipses
 * 48-sided blocks, and everything else a chain of thin walls along it inside the world square.
 */
export function solidShapeOf(v: unknown, range: number): SolidShape | undefined {
  if (isPolygonV(v)) {
    const pts = cleanPolygon(v.pts as Pt[]);
    if (pts.length < 3 || firstCrossing(pts)) return pts.length >= 2 ? chainOf(pts, true) : undefined;
    return { shapes: convexParts(pts).map((p) => ({ kind: 'poly', pts: p })), sampled: false };
  }
  if (isCircleV(v)) return v.r > 0 ? { shapes: [{ kind: 'circle', x: v.cx, y: v.cy, r: v.r }], sampled: false } : undefined;
  if (isConicV(v) && v.kind === 'ellipse' && v.frame && 'cx' in v.frame) {
    const f = v.frame;
    return { shapes: [{ kind: 'poly', pts: ellipsePoints(f.cx, f.cy, f.ux, f.uy, f.a, f.b, 48, sin, cos) }], sampled: false };
  }
  if (isSegmentV(v)) return { shapes: [wall(v.a, v.b)], sampled: false };
  if (isLineV(v)) {
    // a x + b y = c
    const l = Math.sqrt(v.a * v.a + v.b * v.b);
    if (!(l > 0)) return undefined;
    const p = { x: (v.a * v.c) / (l * l), y: (v.b * v.c) / (l * l) };
    const seg = clipLine(p, { x: -v.b / l, y: v.a / l }, range);
    return seg ? { shapes: [wall(seg[0], seg[1])], sampled: true } : undefined;
  }
  if (isRayV(v)) {
    const l = Math.sqrt(v.dir.x * v.dir.x + v.dir.y * v.dir.y);
    if (!(l > 0)) return undefined;
    const seg = clipLine(v.from, { x: v.dir.x / l, y: v.dir.y / l }, range, 0);
    return seg ? { shapes: [wall(seg[0], seg[1])], sampled: true } : undefined;
  }
  if (isPolylineV(v)) return chainOf(v.pts as Pt[], false);
  if (isArcV(v) || isFunctionV(v) || isGeomCurveV(v) || isConicV(v)) {
    const path = pathOf(v);
    if (!path) return undefined;
    let [a, b] = path.domain;
    if (isFunctionV(v)) {
      a = Math.max(a, -range);
      b = Math.min(b, range);
    }
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      a = Number.isFinite(a) ? a : -range;
      b = Number.isFinite(b) ? b : range;
    }
    if (!(b > a)) return undefined;
    const n = Math.min(MAX_GROUND_PIECES, Math.max(16, Math.ceil((b - a) * 8)));
    const pts: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const p = path.at(a + ((b - a) * i) / n);
      if (Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= range * 2 && Math.abs(p.y) <= range * 2) pts.push(p);
      else pts.push({ x: Number.NaN, y: Number.NaN });
    }
    const c = chainOf(pts, path.closed);
    return c ? { shapes: c.shapes, sampled: c.sampled || n === MAX_GROUND_PIECES } : undefined;
  }
  return undefined;
}

/** Thin walls between neighbouring points; undefined points break the chain. */
function chainOf(pts: readonly Pt[], closed: boolean): SolidShape | undefined {
  const shapes: ShapeDef2[] = [];
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last && shapes.length < MAX_GROUND_PIECES; i++) {
    const a = pts[i] as Pt;
    const b = pts[(i + 1) % n] as Pt;
    if (!Number.isFinite(a.x) || !Number.isFinite(b.x) || !Number.isFinite(a.y) || !Number.isFinite(b.y)) continue;
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < 1e-12) continue;
    shapes.push(wall(a, b));
  }
  return shapes.length > 0 ? { shapes, sampled: shapes.length >= MAX_GROUND_PIECES } : undefined;
}
