/**
 * Polygons, polylines, measures and boolean operations
 * (docs/features/polygons-transforms/design.md sections 3-4): plain vertex
 * data, compensated measures, Greiner-Hormann booleans with a deterministic
 * perturbation for degenerate contacts. Holes are v1-out (has_hole).
 */
import type { CommandRule, RuleCall } from '../../graph/registry';
import type { PolygonValue, V2 } from './types';
import { FLAG_CHECKED, FLAG_CONVEX, FLAG_SIMPLE, isArcV, isCircleV, isConicV, isPolygonV, isPolylineV, isPt } from './types';
import { TAU, dist, isSaneNum, isSanePt, isWhole, norm2, orient } from './numerics';
import { arcLengthEllipse, centralParams, ellipseCircumference, sectorAreaEllipse, toConic } from './conics';
import { lineLikeOf, linePolyPoints } from './intersect';
import { pointInPolygon, rule } from './points';

const P = (call: RuleCall, i: number): V2 => call.values[i] as V2;
const N = (call: RuleCall, i: number): number => call.values[i] as number;

const sanePt = (call: RuleCall, p: V2): boolean => {
  if (!isSanePt(p)) {
    call.fail('not_finite');
    return false;
  }
  return true;
};

const saneNum = (call: RuleCall, v: number): boolean => {
  if (!isSaneNum(v)) {
    call.fail('not_finite');
    return false;
  }
  return true;
};

/* ------------------------------ measures (3.2) ------------------------------ */

/** Shoelace in coordinates relative to the first vertex, Neumaier-compensated. */
export function signedAreaOf(pts: readonly V2[]): number {
  if (pts.length < 3) return 0;
  const o = pts[0] as V2;
  let s = 0;
  let c = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as V2;
    const q = pts[(i + 1) % pts.length] as V2;
    const t = (p.x - o.x) * (q.y - o.y) - (q.x - o.x) * (p.y - o.y) - c;
    const ns = s + t;
    c = ns - s - t;
    s = ns;
  }
  return s / 2;
}

export function perimeterOf(pts: readonly V2[], closed: boolean): number {
  let s = 0;
  let c = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const p = pts[i] as V2;
    const q = pts[(i + 1) % pts.length] as V2;
    const t = Math.hypot(q.x - p.x, q.y - p.y) - c;
    const ns = s + t;
    c = ns - s - t;
    s = ns;
  }
  return s;
}

/** Area centroid in relative coordinates; undefined for zero area. */
export function centroidOf(pts: readonly V2[]): V2 | undefined {
  if (pts.length < 3) return undefined;
  const o = pts[0] as V2;
  let a2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as V2;
    const q = pts[(i + 1) % pts.length] as V2;
    const cr = (p.x - o.x) * (q.y - o.y) - (q.x - o.x) * (p.y - o.y);
    a2 += cr;
    cx += (p.x - o.x + (q.x - o.x)) * cr;
    cy += (p.y - o.y + (q.y - o.y)) * cr;
  }
  if (a2 === 0) return undefined;
  return { x: o.x + cx / (3 * a2), y: o.y + cy / (3 * a2) };
}

/** No self-crossing (all non-adjacent edge pairs, robust orient). */
export function isSimplePoly(pts: readonly V2[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a0 = pts[i] as V2;
    const a1 = pts[(i + 1) % n] as V2;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const b0 = pts[j] as V2;
      const b1 = pts[(j + 1) % n] as V2;
      const o1 = orient(a0, a1, b0).sign;
      const o2 = orient(a0, a1, b1).sign;
      const o3 = orient(b0, b1, a0).sign;
      const o4 = orient(b0, b1, a1).sign;
      if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return false;
    }
  }
  return true;
}

/** Convex: all turns share a sign and the total turning is one full turn. */
export function isConvexPoly(pts: readonly V2[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  let pos = false;
  let neg = false;
  let turn = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as V2;
    const b = pts[(i + 1) % n] as V2;
    const c = pts[(i + 2) % n] as V2;
    const s = orient(a, b, c).sign;
    if (s > 0) pos = true;
    if (s < 0) neg = true;
    const ang = Math.atan2((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x), (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y));
    turn += ang;
    void prev;
    prev = ang;
  }
  if (pos && neg) return false;
  return Math.abs(Math.abs(turn) - TAU) < 1e-6;
}

/** Build a polygon value with cached area, orientation and flags. */
export function makePolygon(pts: readonly V2[]): PolygonValue {
  const area = signedAreaOf(pts);
  const orientation = area > 0 ? 1 : area < 0 ? -1 : 0;
  let flags = 0;
  if (pts.length <= 256) {
    flags |= FLAG_CHECKED;
    if (isSimplePoly(pts)) flags |= FLAG_SIMPLE;
    if (isConvexPoly(pts)) flags |= FLAG_CONVEX;
  }
  return { pts: pts.map((p) => ({ ...p })), signedArea: area, orientation, flags };
}

/* ------------------------------ constructors (3.4) ------------------------------ */

function ptArgs(call: RuleCall): V2[] | undefined {
  const out: V2[] = [];
  for (const v of call.values) {
    if (!isPt(v) || !isSanePt(v)) {
      call.fail('not_finite');
      return undefined;
    }
    out.push(v);
  }
  return out;
}

export const polygonPtsRule: CommandRule = rule((call) => {
  const pts = ptArgs(call);
  if (!pts) return undefined;
  return makePolygon(pts);
});

export const polygonListRule: CommandRule = rule((call) => {
  const v = call.values[0] as readonly unknown[];
  if (!Array.isArray(v)) return call.fail('out_of_domain', 'needs a point list');
  const pts: V2[] = [];
  for (const item of v) {
    if (item === undefined) return call.fail('input_undefined', 'the list has an undefined entry');
    if (!isPt(item) || !isSanePt(item)) return call.fail('not_finite');
    pts.push(item);
  }
  if (pts.length < 3) return call.fail('too_few_points', `a polygon needs 3 or more points, found ${pts.length}`);
  return makePolygon(pts);
});

function checkSides(call: RuleCall, n: number): number | undefined {
  if (!isWhole(n)) {
    call.fail('not_whole', `sides = ${n}; a regular polygon needs a whole number`);
    return undefined;
  }
  const k = Math.round(n);
  if (k < 3) {
    call.fail('too_few_sides', `a regular polygon needs at least 3 sides, found ${k}`);
    return undefined;
  }
  if (k > 1000) {
    call.fail('limit', 'at most 1000 sides');
    return undefined;
  }
  return k;
}

export const polygonCenterRule: CommandRule = rule((call) => {
  const c = P(call, 0);
  const r = N(call, 1);
  const n = N(call, 2);
  const start = call.values.length > 3 ? (call.values[3] as number) : Math.PI / 2;
  if (!sanePt(call, c) || !saneNum(call, r) || !saneNum(call, start)) return undefined;
  const k = checkSides(call, n);
  if (k === undefined) return undefined;
  // r < 0 points the vertices the opposite way.
  const rr = Math.abs(r);
  const off = r < 0 ? Math.PI : 0;
  const pts: V2[] = [];
  for (let i = 0; i < k; i++) {
    const a = start + off + (TAU * i) / k;
    pts.push({ x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) });
  }
  return makePolygon(pts);
});

export const polygonEdgeRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const q = P(call, 1);
  const n = N(call, 2);
  if (!sanePt(call, p) || !sanePt(call, q)) return undefined;
  const k = checkSides(call, n);
  if (k === undefined) return undefined;
  const s = dist(p, q);
  if (s <= call.tol * Math.max(1, norm2(p))) return call.fail('coincident_points');
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const h = s / (2 * Math.tan(Math.PI / k));
  const nx = -(q.y - p.y) / s;
  const ny = (q.x - p.x) / s;
  const ox = mx + h * nx;
  const oy = my + h * ny;
  const pts: V2[] = [];
  const base = Math.atan2(p.y - oy, p.x - ox);
  for (let i = 0; i < k; i++) {
    const a = base + (TAU * i) / k;
    const rad = Math.hypot(p.x - ox, p.y - oy);
    pts.push({ x: ox + rad * Math.cos(a), y: oy + rad * Math.sin(a) });
  }
  pts[1] = { ...q };
  return makePolygon(pts);
});

export const polygonVectorRule: CommandRule = rule((call) => {
  const s = P(call, 0);
  if (!sanePt(call, s)) return undefined;
  const vecs: V2[] = [];
  for (let i = 1; i < call.values.length; i++) {
    const v = call.values[i] as V2;
    if (!isPt(v) || !sanePt(call, v)) return undefined;
    vecs.push(v);
  }
  if (vecs.length < 2) return call.fail('too_few_points', 'a vector polygon needs 2 or more vectors');
  const pts: V2[] = [{ ...s }];
  let x = s.x;
  let y = s.y;
  for (const v of vecs) {
    x += v.x;
    y += v.y;
    pts.push({ x, y });
  }
  return makePolygon(pts);
});

export const polylinePtsRule: CommandRule = rule((call) => {
  const pts = ptArgs(call);
  if (!pts) return undefined;
  return { pts };
});

export const polylineListRule: CommandRule = rule((call) => {
  const v = call.values[0] as readonly unknown[];
  if (!Array.isArray(v)) return call.fail('out_of_domain', 'needs a point list');
  const pts: V2[] = [];
  for (const item of v) {
    if (item === undefined) return call.fail('input_undefined', 'the list has an undefined entry');
    if (!isPt(item) || !isSanePt(item)) return call.fail('not_finite');
    pts.push(item);
  }
  if (pts.length < 2) return call.fail('too_few_points', `a polyline needs 2 or more points, found ${pts.length}`);
  return { pts };
});

export const polylineVectorRule: CommandRule = rule((call) => {
  const s = P(call, 0);
  if (!sanePt(call, s)) return undefined;
  const vecs: V2[] = [];
  for (let i = 1; i < call.values.length; i++) {
    const v = call.values[i] as V2;
    if (!isPt(v) || !sanePt(call, v)) return undefined;
    vecs.push(v);
  }
  if (vecs.length < 1) return call.fail('too_few_points', 'a vector polyline needs 1 or more vectors');
  const pts: V2[] = [{ ...s }];
  let x = s.x;
  let y = s.y;
  for (const v of vecs) {
    x += v.x;
    y += v.y;
    pts.push({ x, y });
  }
  return { pts };
});

/* ------------------------------ Rigid (5) ------------------------------ */

function rigidOf(src: readonly V2[], dx: number, dy: number): PolygonValue {
  const s1 = src[0] as V2;
  const s2 = src[1] as V2;
  const phi = Math.atan2(s2.y - s1.y, s2.x - s1.x);
  const cp = Math.cos(-phi);
  const sp = Math.sin(-phi);
  const anchor = { x: s1.x + dx, y: s1.y + dy };
  const turn = phi;
  const ct = Math.cos(turn);
  const st = Math.sin(turn);
  const pts = src.map((p) => {
    const lx = (p.x - s1.x) * cp - (p.y - s1.y) * sp;
    const ly = (p.x - s1.x) * sp + (p.y - s1.y) * cp;
    return { x: anchor.x + ct * lx - st * ly, y: anchor.y + st * lx + ct * ly };
  });
  return makePolygon(pts);
}

export const rigidRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (!isPolygonV(v)) return call.fail('wrong_kind', 'Rigid needs a polygon');
  return rigidOf(v.pts, 0, 0);
});

export const rigidOffsetRule: CommandRule = rule(
  (call) => {
    const v = call.values[0];
    const dx = N(call, 1);
    const dy = N(call, 2);
    if (!isPolygonV(v)) return call.fail('wrong_kind', 'Rigid needs a polygon');
    if (!saneNum(call, dx) || !saneNum(call, dy)) return undefined;
    return rigidOf(v.pts, dx, dy);
  },
  {
    invert: (target, c) => {
      if (!isPolygonV(target)) return undefined;
      const src = c.values[0] as PolygonValue;
      if (!isPolygonV(src) || src.pts.length === 0) return undefined;
      const t = (target as PolygonValue).pts[0] as V2;
      const s1 = src.pts[0] as V2;
      if (!t || !s1) return undefined;
      return [
        { param: 1, value: t.x - s1.x },
        { param: 2, value: t.y - s1.y },
      ];
    },
  },
);

export const rigidPtsRule: CommandRule = rule((call) => {
  const pts = ptArgs(call);
  if (!pts || pts.length < 3) return call.fail('too_few_points', 'a rigid polygon needs 3 or more points');
  return rigidOf(pts, 0, 0);
});

/* ------------------------------ Vertex, Side, Vertices, Sides ------------------------------ */

export const vertexPolyRule: CommandRule = rule((call) => {
  const v = call.values[0];
  const pts = isPolygonV(v) ? v.pts : isPolylineV(v) ? (v.pts as V2[]) : undefined;
  if (!pts) return call.fail('wrong_kind', 'needs a polygon or polyline');
  const k = N(call, 1);
  if (!isWhole(k) || k < 1 || k > pts.length) return call.fail('index_out_of_range', `index ${k} of ${pts.length}`);
  return { ...(pts[k - 1] as V2) };
});

export const verticesRule: CommandRule = rule((call) => {
  const v = call.values[0];
  const pts = isPolygonV(v) ? v.pts : isPolylineV(v) ? (v.pts as V2[]) : undefined;
  if (!pts) return call.fail('wrong_kind', 'needs a polygon or polyline');
  return pts.map((p) => ({ ...p }));
});

export const sideRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (!isPolygonV(v)) return call.fail('wrong_kind', 'Side needs a polygon');
  const k = N(call, 1);
  if (!isWhole(k) || k < 1 || k > v.pts.length) return call.fail('index_out_of_range', `index ${k} of ${v.pts.length}`);
  const a = v.pts[k - 1] as V2;
  const b = v.pts[k % v.pts.length] as V2;
  return { a: { ...a }, b: { ...b } };
});

export const sidesRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (isPolygonV(v)) {
    return v.pts.map((p, i) => ({ a: { ...p }, b: { ...(v.pts[(i + 1) % v.pts.length] as V2) } }));
  }
  if (isPolylineV(v)) {
    const pts = v.pts as V2[];
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) out.push({ a: { ...(pts[i] as V2) }, b: { ...(pts[i + 1] as V2) } });
    return out;
  }
  return call.fail('wrong_kind', 'needs a polygon or polyline');
});

export const centroidPolyRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (!isPolygonV(v)) return call.fail('wrong_kind', 'Centroid needs a polygon');
  const c = centroidOf(v.pts);
  if (!c) return call.fail('zero_area', 'the polygon has zero area');
  return c;
});

export const convexRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (!isPolygonV(v)) return call.fail('wrong_kind', 'Convex needs a polygon');
  if (v.flags & FLAG_CHECKED) return (v.flags & FLAG_CONVEX) !== 0;
  return isConvexPoly(v.pts);
});

export const simpleRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (!isPolygonV(v)) return call.fail('wrong_kind', 'Simple needs a polygon');
  if (v.flags & FLAG_CHECKED) return (v.flags & FLAG_SIMPLE) !== 0;
  return true;
});

/* ------------------------------ Area, Perimeter, Length ------------------------------ */

export const areaPolyRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (!isPolygonV(v)) return call.fail('wrong_kind', 'Area needs a polygon');
  return Math.abs(v.signedArea);
});

export const areaPtsRule: CommandRule = rule((call) => {
  const pts = ptArgs(call);
  if (!pts) return undefined;
  return Math.abs(signedAreaOf(pts));
});

export const areaSectorRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (!isArcV(v)) return call.fail('wrong_kind', 'needs a sector');
  const cp = centralParams(v.conic);
  if (!cp || (v.conic.kind !== 'circle' && v.conic.kind !== 'ellipse')) {
    return call.fail('wrong_kind', 'needs a circle or ellipse sector');
  }
  if (v.conic.kind === 'circle') return 0.5 * cp.a * cp.a * v.sweep;
  return sectorAreaEllipse(cp.a, cp.b, v.from, v.sweep, Math.atan2(cp.uy, cp.ux));
});

export const areaConicRule: CommandRule = rule((call) => {
  const c = toConic(call.values[0]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  const cp = centralParams(c);
  if (!cp || (c.kind !== 'circle' && c.kind !== 'ellipse')) return call.fail('unbounded');
  return Math.PI * cp.a * cp.b;
});

export const signedAreaRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (!isPolygonV(v)) return call.fail('wrong_kind', 'SignedArea needs a polygon');
  return v.signedArea;
});

export const perimeterRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (isPolygonV(v)) return perimeterOf(v.pts, true);
  if (isPolylineV(v)) return perimeterOf(v.pts as V2[], false);
  if (isArcV(v)) {
    const cp = centralParams(v.conic);
    if (!cp || (v.conic.kind !== 'circle' && v.conic.kind !== 'ellipse')) {
      return call.fail('wrong_kind', 'needs a circle or ellipse sector');
    }
    if (v.conic.kind === 'circle') return cp.a * v.sweep + 2 * cp.a;
    const arc = arcLengthEllipse(cp.a, cp.b, v.from - Math.atan2(cp.uy, cp.ux), v.sweep);
    const r0 = polarRadius(cp.a, cp.b, v.from - Math.atan2(cp.uy, cp.ux));
    const r1 = polarRadius(cp.a, cp.b, v.from + v.sweep - Math.atan2(cp.uy, cp.ux));
    return arc + r0 + r1;
  }
  const c = toConic(v);
  if (!c) return call.fail('wrong_kind', 'not a perimeter shape');
  const cp = centralParams(c);
  if (!cp || (c.kind !== 'circle' && c.kind !== 'ellipse')) return call.fail('unbounded');
  if (c.kind === 'circle') return TAU * cp.a;
  return ellipseCircumference(cp.a, cp.b);
});

function polarRadius(a: number, b: number, phi: number): number {
  const q = (Math.cos(phi) * Math.cos(phi)) / (a * a) + (Math.sin(phi) * Math.sin(phi)) / (b * b);
  return q > 0 ? 1 / Math.sqrt(q) : 0;
}

export const circumferenceRule: CommandRule = rule((call) => {
  const c = toConic(call.values[0]);
  if (!c) return call.fail('wrong_kind', 'not a conic');
  const cp = centralParams(c);
  if (!cp || (c.kind !== 'circle' && c.kind !== 'ellipse')) return call.fail('unbounded');
  if (c.kind === 'circle') return TAU * cp.a;
  return ellipseCircumference(cp.a, cp.b);
});

export const lengthRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (isPt(v) && !isPolygonV(v) && !isPolylineV(v) && !isArcV(v) && !isConicV(v) && !isCircleV(v)) {
    if (!sanePt(call, v)) return undefined;
    return norm2(v);
  }
  const s = v as { a?: V2; b?: V2; from?: V2; dir?: V2 };
  if (s.a !== undefined && s.b !== undefined && isPt(s.a) && isPt(s.b)) {
    if (!sanePt(call, s.a) || !sanePt(call, s.b)) return undefined;
    return dist(s.a, s.b);
  }
  if (s.from !== undefined && s.dir !== undefined) return call.fail('unbounded', 'a ray has no length');
  if (isPolylineV(v)) return perimeterOf(v.pts as V2[], false);
  if (isArcV(v)) {
    const cp = centralParams(v.conic);
    if (!cp || (v.conic.kind !== 'circle' && v.conic.kind !== 'ellipse')) {
      return call.fail('wrong_kind', 'needs a circle or ellipse arc');
    }
    if (v.conic.kind === 'circle') return cp.a * v.sweep;
    return arcLengthEllipse(cp.a, cp.b, v.from - Math.atan2(cp.uy, cp.ux), v.sweep);
  }
  return call.fail('out_of_domain', 'not a length shape');
});

export const interiorAnglesRule: CommandRule = rule((call) => {
  const v = call.values[0];
  if (!isPolygonV(v)) return call.fail('wrong_kind', 'InteriorAngles needs a polygon');
  const pts = v.pts;
  const n = pts.length;
  const ccw = v.signedArea >= 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n] as V2;
    const cur = pts[i] as V2;
    const next = pts[(i + 1) % n] as V2;
    const incoming = { x: prev.x - cur.x, y: prev.y - cur.y };
    const outgoing = { x: next.x - cur.x, y: next.y - cur.y };
    if (norm2(incoming) === 0 || norm2(outgoing) === 0) {
      out.push(NaN);
      continue;
    }
    // Interior angle: CCW from outgoing to incoming for CCW polygons, mirrored otherwise.
    const cross = ccw
      ? outgoing.x * incoming.y - outgoing.y * incoming.x
      : incoming.x * outgoing.y - incoming.y * outgoing.x;
    const dotp = outgoing.x * incoming.x + outgoing.y * incoming.y;
    let a = Math.atan2(cross, dotp);
    if (a <= 0) a += TAU;
    out.push(a);
  }
  if (out.some((x) => !Number.isFinite(x))) return call.fail('zero_length', 'a duplicate vertex has no angle');
  return out;
});

/* ------------------------------ IntersectPath (4.1, 4.2) ------------------------------ */

export const intersectPathLineRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[0]);
  const v = call.values[1];
  if (!ll) return call.fail('zero_length');
  if (!isPolygonV(v)) return call.fail('wrong_kind', 'IntersectPath needs a polygon');
  const pts = v.pts;
  const tol = call.tol;
  const o = { x: ll.ox, y: ll.oy };
  const d = { x: ll.dx, y: ll.dy };
  const hits = linePolyPoints(o, d, pts, true, tol).pts;
  // Classify vertex hits as crossing or touching; drop touches.
  interface Hit {
    s: number;
    cross: boolean;
  }
  const list: Hit[] = [];
  for (const h of hits) {
    const s = (h.p.x - o.x) * d.x + (h.p.y - o.y) * d.y;
    // Vertex? Find the nearest vertex.
    let vi = -1;
    for (let i = 0; i < pts.length; i++) {
      if (dist(h.p, pts[i] as V2) <= tol * 8 * Math.max(1, norm2(h.p))) {
        vi = i;
        break;
      }
    }
    if (vi < 0) {
      list.push({ s, cross: true });
      continue;
    }
    const prev = pts[(vi - 1 + pts.length) % pts.length] as V2;
    const next = pts[(vi + 1) % pts.length] as V2;
    const s1 = orient(o, { x: o.x + d.x, y: o.y + d.y }, prev).sign;
    const s2 = orient(o, { x: o.x + d.x, y: o.y + d.y }, next).sign;
    list.push({ s, cross: s1 !== s2 });
  }
  const splits = list.filter((h) => h.cross).map((h) => h.s);
  // Clip to segment/ray limits.
  let lo = ll.lo;
  let hi = ll.hi;
  if (ll.kind !== 'line') {
    if (!Number.isFinite(hi)) hi = 1e12;
  } else {
    lo = -1e12;
    hi = 1e12;
  }
  splits.sort((a, b) => a - b);
  const bounds = [lo, ...splits, hi];
  const out: Array<{ a: V2; b: V2 }> = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const s0 = Math.max(bounds[i] as number, lo);
    const s1 = Math.min(bounds[i + 1] as number, hi);
    if (!(s1 > s0)) continue;
    const mid = { x: o.x + ((s0 + s1) / 2) * d.x, y: o.y + ((s0 + s1) / 2) * d.y };
    if (!pointInPolygon(mid, pts, tol)) continue;
    out.push({ a: { x: o.x + s0 * d.x, y: o.y + s0 * d.y }, b: { x: o.x + s1 * d.x, y: o.y + s1 * d.y } });
  }
  return out;
});

export const intersectPathPolyRule: CommandRule = rule((call) => polyBoolean(call, 'intersection'));
export const unionRule: CommandRule = rule((call) => polyBoolean(call, 'union'));
export const differenceRule: CommandRule = rule((call) => polyBoolean(call, 'difference'));

type BoolOp = 'intersection' | 'union' | 'difference';

function polyBoolean(call: RuleCall, op: BoolOp): unknown {
  const a = call.values[0];
  const b = call.values[1];
  if (!isPolygonV(a) || !isPolygonV(b)) return call.fail('wrong_kind', 'needs two polygons');
  const tol = call.tol;
  if (a.pts.length + b.pts.length > 256) return call.fail('limit', 'boolean operations take 256 vertices in total');
  const simpleA = a.flags & FLAG_CHECKED ? (a.flags & FLAG_SIMPLE) !== 0 : isSimplePoly(a.pts);
  const simpleB = b.flags & FLAG_CHECKED ? (b.flags & FLAG_SIMPLE) !== 0 : isSimplePoly(b.pts);
  if (!simpleA || !simpleB) return call.fail('not_simple', 'boolean operations need non-self-crossing polygons');
  if (!call.work.spend(2000 + a.pts.length * b.pts.length)) return call.fail('timeout');
  const r = booleanOp(a.pts, b.pts, op, tol);
  if ('fail' in r) return call.fail(r.fail, r.detail);
  return r.polys.map((pts) => makePolygon(pts));
}

/* ------------------------------ Greiner-Hormann booleans ------------------------------ */

interface Crossing {
  p: V2;
  ai: number;
  as: number;
  bi: number;
  bs: number;
}

type BoolResult = { polys: V2[][] } | { fail: 'has_hole' | 'no_convergence'; detail?: string };

function booleanOp(aa: readonly V2[], bb: readonly V2[], op: BoolOp, tol: number): BoolResult {
  const convexA = aa.length <= 256 ? isConvexPoly(aa) : false;
  const convexB = bb.length <= 256 ? isConvexPoly(bb) : false;
  if (op === 'intersection' && convexA && convexB) {
    const pts = clipConvex(aa, bb, tol);
    return { polys: pts.length >= 3 ? [pts] : [] };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const scale = polyScale(aa, bb);
    const bShift: readonly V2[] =
      attempt === 0 ? bb : bb.map((p) => ({ x: p.x + 1e-9 * scale * 0.37, y: p.y + 1e-9 * scale * 0.71 }));
    const found = findCrossings(aa, bShift, tol);
    if (found.degenerate) continue; // perturb and retry
    const r = runGH(aa, bShift, found.list, op, tol);
    if (r === 'retry') continue;
    return r;
  }
  return { fail: 'no_convergence', detail: 'degenerate contacts did not resolve' };
}

function polyScale(a: readonly V2[], b: readonly V2[]): number {
  let m = 1;
  for (const p of [...a, ...b]) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  return m;
}

/** Sutherland-Hodgman: convex subject clipped by convex clip. */
function clipConvex(subject: readonly V2[], clip: readonly V2[], tol: number): V2[] {
  void tol;
  let out = [...subject];
  const ccw = signedAreaOf(clip) >= 0;
  for (let i = 0; i < clip.length; i++) {
    const e0 = clip[i] as V2;
    const e1 = clip[(i + 1) % clip.length] as V2;
    const input = out;
    out = [];
    if (input.length === 0) break;
    let s = input[input.length - 1] as V2;
    for (const e of input) {
      const insideE = ccw ? orient(e0, e1, e).sign >= 0 : orient(e0, e1, e).sign <= 0;
      const insideS = ccw ? orient(e0, e1, s).sign >= 0 : orient(e0, e1, s).sign <= 0;
      if (insideE) {
        if (!insideS) {
          const q = lineEdgeHit(s, e, e0, e1);
          if (q) out.push(q);
        }
        out.push(e);
      } else if (insideS) {
        const q = lineEdgeHit(s, e, e0, e1);
        if (q) out.push(q);
      }
      s = e;
    }
  }
  return out;
}

function lineEdgeHit(s: V2, e: V2, e0: V2, e1: V2): V2 | undefined {
  const d1x = e.x - s.x;
  const d1y = e.y - s.y;
  const d2x = e1.x - e0.x;
  const d2y = e1.y - e0.y;
  const det = d1x * d2y - d2x * d1y;
  if (det === 0) return undefined;
  const t = ((e0.x - s.x) * d2y - (e0.y - s.y) * d2x) / det;
  return { x: s.x + t * d1x, y: s.y + t * d1y };
}

/** All proper edge crossings; degenerate when any touch is at a vertex or overlap. */
function findCrossings(a: readonly V2[], b: readonly V2[], tol: number): { list: Crossing[]; degenerate: boolean } {
  const list: Crossing[] = [];
  let degenerate = false;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i] as V2;
    const a1 = a[(i + 1) % a.length] as V2;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j] as V2;
      const b1 = b[(j + 1) % b.length] as V2;
      const o1 = orient(a0, a1, b0).sign;
      const o2 = orient(a0, a1, b1).sign;
      const o3 = orient(b0, b1, a0).sign;
      const o4 = orient(b0, b1, a1).sign;
      if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) {
        // Touching or collinear: check for a real contact.
        if (segTouch(a0, a1, b0, b1, tol)) degenerate = true;
        continue;
      }
      if (o1 !== o2 && o3 !== o4) {
        const p = segCrossPoint(a0, a1, b0, b1);
        if (!p) {
          degenerate = true;
          continue;
        }
        const la = dist(a0, a1) || 1;
        const lb = dist(b0, b1) || 1;
        const as = dist(a0, p) / la;
        const bs = dist(b0, p) / lb;
        if (as <= tol || as >= 1 - tol || bs <= tol || bs >= 1 - tol) {
          degenerate = true;
          continue;
        }
        list.push({ p, ai: i, as, bi: j, bs });
      }
    }
  }
  // Dedupe shared points.
  const ded: Crossing[] = [];
  for (const c of list) {
    if (!ded.some((d) => dist(c.p, d.p) <= tol * 8 * Math.max(1, norm2(c.p)))) ded.push(c);
  }
  return { list: ded, degenerate };
}

/** True when the segments touch (endpoint contact or collinear overlap). */
function segTouch(a0: V2, a1: V2, b0: V2, b1: V2, tol: number): boolean {
  const pts: Array<[V2, V2, V2]> = [
    [a0, b0, b1],
    [a1, b0, b1],
    [b0, a0, a1],
    [b1, a0, a1],
  ];
  for (const [p, s0, s1] of pts) {
    const dx = s1.x - s0.x;
    const dy = s1.y - s0.y;
    const len = Math.hypot(dx, dy) || 1;
    const t = ((p.x - s0.x) * dx + (p.y - s0.y) * dy) / (len * len);
    if (t >= -tol && t <= 1 + tol) {
      const d = Math.abs((p.x - s0.x) * dy - (p.y - s0.y) * dx) / len;
      if (d <= tol * Math.max(1, len, norm2(p))) return true;
    }
  }
  return false;
}

function segCrossPoint(a0: V2, a1: V2, b0: V2, b1: V2): V2 | undefined {
  const d1x = a1.x - a0.x;
  const d1y = a1.y - a0.y;
  const d2x = b1.x - b0.x;
  const d2y = b1.y - b0.y;
  const det = d1x * d2y - d2x * d1y;
  if (det === 0) return undefined;
  const t = ((b0.x - a0.x) * d2y - (b0.y - a0.y) * d2x) / det;
  return { x: a0.x + t * d1x, y: a0.y + t * d1y };
}

interface StreamItem {
  p: V2;
  cross: number; // crossing index, or -1
  entry: boolean; // entry (vs exit) on this polygon; meaningful for crossings
}

function runGH(a: readonly V2[], b: readonly V2[], crosses: Crossing[], op: BoolOp, tol: number): BoolResult | 'retry' {
  if (crosses.length === 0) return noCrossing(a, b, op, tol);
  // Build streams: vertices interleaved with crossings sorted by (edge, param).
  const buildStream = (pts: readonly V2[], get: (c: Crossing) => { i: number; s: number }): StreamItem[] => {
    const per = new Map<number, Array<{ s: number; ci: number }>>();
    crosses.forEach((c, ci) => {
      const { i, s } = get(c);
      const arr = per.get(i) ?? [];
      arr.push({ s, ci });
      per.set(i, arr);
    });
    const out: StreamItem[] = [];
    for (let i = 0; i < pts.length; i++) {
      out.push({ p: { ...(pts[i] as V2) }, cross: -1, entry: false });
      const arr = (per.get(i) ?? []).sort((x, y) => x.s - y.s);
      for (const e of arr) out.push({ p: { ...((crosses[e.ci] as Crossing).p) }, cross: e.ci, entry: false });
    }
    return out;
  };
  const sa = buildStream(a, (c) => ({ i: c.ai, s: c.as }));
  const sb = buildStream(b, (c) => ({ i: c.bi, s: c.bs }));
  // Label entries: the bit after the crossing is inside the other polygon.
  const label = (stream: StreamItem[], other: readonly V2[]): boolean => {
    for (let i = 0; i < stream.length; i++) {
      const it = stream[i] as StreamItem;
      if (it.cross < 0) continue;
      const nx = stream[(i + 1) % stream.length] as StreamItem;
      const mid = { x: (it.p.x + nx.p.x) / 2, y: (it.p.y + nx.p.y) / 2 };
      const pv = stream[(i - 1 + stream.length) % stream.length] as StreamItem;
      const pmid = { x: (it.p.x + pv.p.x) / 2, y: (it.p.y + pv.p.y) / 2 };
      const after = pointInPolygon(mid, other, tol);
      const before = pointInPolygon(pmid, other, tol);
      if (after === before) return false; // tangent touch: needs perturbation
      it.entry = after && !before;
    }
    return true;
  };
  if (!label(sa, b) || !label(sb, a)) return 'retry';
  // Walk.
  const rings: V2[][] = [];
  const visited = new Set<number>();
  const atCross = (stream: StreamItem[], ci: number): number => stream.findIndex((it) => it.cross === ci);
  const walk = (startPoly: 0 | 1, startCi: number, forwardB: boolean): V2[] | undefined => {
    const ring: V2[] = [];
    let poly = startPoly;
    let ci = startCi;
    for (let guard = 0; guard < 10000; guard++) {
      const key = poly * 100000 + ci;
      if (visited.has(key)) break;
      visited.add(key);
      const stream = poly === 0 ? sa : sb;
      let idx = atCross(stream, ci);
      if (idx < 0) return undefined;
      const fwd = poly === 0 ? true : forwardB;
      for (let g2 = 0; g2 < 10000; g2++) {
        const it = stream[idx] as StreamItem;
        ring.push({ ...it.p });
        idx = fwd ? (idx + 1) % stream.length : (idx - 1 + stream.length) % stream.length;
        const nx = stream[idx] as StreamItem;
        if (nx.cross >= 0) {
          // Switch or continue by the op's rule.
          const isEntry = fwd ? nx.entry : !nx.entry;
          const switchNow = op === 'intersection' ? !isEntry : isEntry;
          ci = nx.cross;
          if (switchNow) poly = poly === 0 ? 1 : 0;
          break;
        }
      }
      if (poly === startPoly && ci === startCi) break;
    }
    return ring.length >= 3 ? ring : undefined;
  };
  if (op === 'intersection') {
    for (let ci = 0; ci < crosses.length; ci++) {
      if (visited.has(ci)) continue;
      const idx = atCross(sa, ci);
      if (idx >= 0 && (sa[idx] as StreamItem).entry) {
        const r = walk(0, ci, true);
        if (r) rings.push(r);
      }
    }
    // B-side starts for rings the A-starts miss.
    for (let ci = 0; ci < crosses.length; ci++) {
      if (visited.has(100000 + ci)) continue;
      const idx = atCross(sb, ci);
      if (idx >= 0 && (sb[idx] as StreamItem).entry) {
        const r = walk(1, ci, true);
        if (r) rings.push(r);
      }
    }
  } else if (op === 'union') {
    for (let ci = 0; ci < crosses.length; ci++) {
      if (visited.has(ci)) continue;
      const idx = atCross(sa, ci);
      if (idx >= 0 && !(sa[idx] as StreamItem).entry) {
        const r = walk(0, ci, true);
        if (r) rings.push(r);
      }
    }
    for (let ci = 0; ci < crosses.length; ci++) {
      if (visited.has(100000 + ci)) continue;
      const idx = atCross(sb, ci);
      if (idx >= 0 && !(sb[idx] as StreamItem).entry) {
        const r = walk(1, ci, true);
        if (r) rings.push(r);
      }
    }
  } else {
    // Difference: A forward, B backward.
    for (let ci = 0; ci < crosses.length; ci++) {
      if (visited.has(ci)) continue;
      const idx = atCross(sa, ci);
      if (idx >= 0 && !(sa[idx] as StreamItem).entry) {
        const r = walk(0, ci, false);
        if (r) rings.push(r);
      }
    }
  }
  // Drop slivers, orient CCW, order canonically, check holes.
  const scale = polyScale(a, b);
  const kept = rings.filter((r) => Math.abs(signedAreaOf(r)) > 1e-12 * scale * scale);
  const polys = kept.map((r) => (signedAreaOf(r) < 0 ? [...r].reverse() : r));
  polys.sort((x, y) => {
    const lx = lowestLeft(x);
    const ly = lowestLeft(y);
    return lx[1] - ly[1] || lx[0] - ly[0];
  });
  // A piece strictly inside another is a hole (v1-out).
  for (let i = 0; i < polys.length; i++) {
    for (let j = 0; j < polys.length; j++) {
      if (i === j) continue;
      const inner = polys[i] as V2[];
      const outer = polys[j] as V2[];
      if (inner.length > 0 && pointInPolygon(inner[0] as V2, outer, tol)) {
        return { fail: 'has_hole', detail: 'the result has a hole; polygons with holes are not supported yet' };
      }
    }
  }
  return { polys };
}

function lowestLeft(pts: readonly V2[]): [number, number] {
  let best = pts[0] as V2;
  for (const p of pts) {
    if (p.y < best.y || (p.y === best.y && p.x < best.x)) best = p;
  }
  return [best.x, best.y];
}

function noCrossing(a: readonly V2[], b: readonly V2[], op: BoolOp, tol: number): BoolResult {
  const aInB = pointInPolygon(a[0] as V2, b, tol);
  const bInA = pointInPolygon(b[0] as V2, a, tol);
  if (op === 'intersection') {
    if (aInB) return { polys: [[...a]] };
    if (bInA) return { polys: [[...b]] };
    return { polys: [] };
  }
  if (op === 'union') {
    if (aInB) return { polys: [[...b]] };
    if (bInA) return { polys: [[...a]] };
    return { polys: [[...a], [...b]] };
  }
  if (aInB) return { polys: [] };
  if (bInA) {
    return { fail: 'has_hole', detail: 'b lies inside a, so the difference has a hole; polygons with holes are not supported yet' };
  }
  return { polys: [[...a]] };
}