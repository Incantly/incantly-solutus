/**
 * Points, lines, vectors, intersections and measures: the command rules
 * (docs/features/points-lines/design.md sections 4-7). All tolerances come
 * from the rule context; rules never use literal epsilons for decisions.
 */
import type { UndefReason } from '../../contracts/values';
import type { CommandRule, RuleCall } from '../../graph/registry';
import type { FunctionValue, RelationValue } from '../../language/runtime';
import type { ConicValue, Path, V2 } from './types';
import {
  isArcV,
  isCircleV,
  isConicV,
  isFunctionV,
  isGeomCurveV,
  isLineV,
  isPolygonV,
  isPolylineV,
  isPt,
  isRayV,
  isSegmentV,
} from './types';
import { TAU, det2, dist, dot, hashRand, isSaneNum, isSanePt, isWhole, norm2, orient, relEq, wrapPi, wrapTau } from './numerics';
import {
  arcPath,
  circlePath,
  curvePath,
  functionPath,
  linePath,
  polygonPath,
  polylinePath,
  rayPath,
  segmentPath,
} from './paths';
import { centralParams, circleConic, conicAt, conicPath, dualConicTest, toConic } from './conics';
import {
  circleCircleSlots,
  conicConicSlots,
  curveCurveSlots,
  dedupePoints,
  evalFn,
  functionFunctionRoots,
  functionLineRoots,
  intersectLineLine,
  lineConicSlots,
  lineLikeOf,
  linePolyPoints,
  newtonNear,
  polyPolyPoints,
  polyRootsOf,
  scanRoots,
  withinLimits,
} from './intersect';
import type { ArcRange, Fn1, LineLike, Slot } from './intersect';

export const rule = (run: (call: RuleCall) => unknown, extra?: Partial<CommandRule>): CommandRule => ({ run, ...extra });

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

/* ------------------------------ slot results (3.5) ------------------------------ */

/**
 * Fixed-length slot lists: defined with holes, except that when every slot is
 * missing for the SAME reason the whole result fails with that reason (so the
 * teacher can state it; the indexed form gives the same reason per slot).
 */
export function slotsToList(call: RuleCall, slots: readonly Slot[]): unknown {
  let reason: UndefReason | undefined;
  let detail: string | undefined;
  let allMissing = slots.length > 0;
  for (const s of slots) {
    if ('p' in s) {
      allMissing = false;
      break;
    }
    if (reason === undefined) {
      reason = s.reason;
      detail = s.detail;
    } else if (s.reason !== reason) {
      allMissing = false;
      break;
    }
  }
  if (allMissing && reason !== undefined) return call.fail(reason, detail);
  return slots.map((s) => ('p' in s ? s.p : undefined));
}

/** Indexed slot as a single Point (1-based). */
export function slotIndex(call: RuleCall, slots: readonly Slot[], k: number, max: number): unknown {
  if (!isWhole(k) || k < 1 || k > max) {
    return call.fail('index_out_of_range', `index ${k} of ${max}`);
  }
  const s = slots[k - 1];
  if (!s) return call.fail('index_out_of_range', `index ${k} of ${max}`);
  if ('p' in s) return s.p;
  return call.fail(s.reason, s.detail);
}

/** Nearest defined slot to P (ties: lowest slot). */
export function slotNear(call: RuleCall, slots: readonly Slot[], p: V2): unknown {
  let best: V2 | undefined;
  let bd = Infinity;
  for (const s of slots) {
    if (!('p' in s)) continue;
    const d = dist(s.p, p);
    if (d < bd) {
      bd = d;
      best = s.p;
    }
  }
  if (!best) {
    const first = slots[0];
    if (first && !('p' in first)) return call.fail(first.reason, first.detail);
    return call.fail('no_intersection');
  }
  return best;
}

/* ------------------------------ paths and regions from values ------------------------------ */

/** A path value from any path-typed object value, or undefined. */
export function pathOf(v: unknown): Path | undefined {
  if (isLineV(v)) {
    const l = Math.hypot(v.a, v.b);
    if (!(l > 0)) return undefined;
    return linePath(v.a / l, v.b / l, v.c / l, v.p, v.len);
  }
  if (isSegmentV(v)) {
    if (!isSanePt(v.a) || !isSanePt(v.b)) return undefined;
    return segmentPath(v.a, v.b);
  }
  if (isRayV(v)) {
    const l = norm2(v.dir);
    if (!(l > 0) || !isSanePt(v.from)) return undefined;
    const rl = (v as { len?: unknown }).len;
    return rayPath(v.from, { x: v.dir.x / l, y: v.dir.y / l }, typeof rl === 'number' ? rl : l);
  }
  if (isCircleV(v)) {
    if (!(v.r >= 0)) return undefined;
    return circlePath(v.cx, v.cy, v.r);
  }
  if (isConicV(v)) return conicPath(v);
  if (isArcV(v)) {
    const carrier = conicPath(v.conic);
    if (!carrier) return undefined;
    return arcPath(carrier, v.from, v.sweep);
  }
  if (isPolygonV(v)) return polygonPath(v.pts);
  if (isPolylineV(v)) return polylinePath(v.pts as V2[]);
  if (isFunctionV(v)) {
    if (v.ret !== 'Number' || v.arity !== 1) return undefined;
    return functionPath(v);
  }
  if (isGeomCurveV(v)) return curvePath(v);
  return undefined;
}

export type Region =
  | { kind: 'polygon'; pts: readonly V2[] }
  | { kind: 'disc'; cx: number; cy: number; ux: number; uy: number; a: number; b: number }
  | { kind: 'sector'; cx: number; cy: number; r: number; from: number; sweep: number };

/** A region value from any region-typed object value, or undefined. */
export function regionOf(v: unknown): Region | undefined {
  if (isPolygonV(v)) return { kind: 'polygon', pts: v.pts };
  if (isCircleV(v)) {
    if (!(v.r >= 0)) return undefined;
    return { kind: 'disc', cx: v.cx, cy: v.cy, ux: 1, uy: 0, a: v.r, b: v.r };
  }
  if (isConicV(v)) {
    if ((v.kind === 'circle' || v.kind === 'ellipse') && v.frame && 'cx' in v.frame) {
      const f = v.frame;
      return { kind: 'disc', cx: f.cx, cy: f.cy, ux: f.ux, uy: f.uy, a: f.a, b: f.b };
    }
    return undefined;
  }
  if (isArcV(v)) {
    // Sectors share the arc shape; only ellipse/circle sectors have interiors here.
    const cp = centralParams(v.conic);
    if (!cp || (v.conic.kind !== 'circle' && v.conic.kind !== 'ellipse')) return undefined;
    if (v.conic.kind === 'ellipse') return undefined; // ellipse sectors: not in v1
    return { kind: 'sector', cx: cp.cx, cy: cp.cy, r: cp.a, from: v.from, sweep: v.sweep };
  }
  return undefined;
}

/** Winding-number point-in-polygon; boundary (within tol) counts as inside. */
export function pointInPolygon(p: V2, pts: readonly V2[], tol: number): boolean {
  const n = pts.length;
  let winding = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as V2;
    const b = pts[(i + 1) % n] as V2;
    // Boundary test.
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
      if (t >= 0 && t <= 1) {
        const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
        if (d <= tol * Math.max(1, len, Math.hypot(p.x, p.y))) return true;
      }
    }
    if (a.y <= p.y) {
      if (b.y > p.y && orient(a, b, p).sign > 0) winding++;
    } else {
      if (b.y <= p.y && orient(a, b, p).sign < 0) winding--;
    }
  }
  return winding !== 0;
}

export function pointInRegion(p: V2, r: Region, tol: number): boolean {
  if (r.kind === 'polygon') return pointInPolygon(p, r.pts, tol);
  if (r.kind === 'disc') {
    const dx = p.x - r.cx;
    const dy = p.y - r.cy;
    const nx = -r.uy;
    const ny = r.ux;
    const X = (dx * r.ux + dy * r.uy) / (r.a || 1);
    const Y = (dx * nx + dy * ny) / (r.b || 1);
    return X * X + Y * Y <= 1 + tol * 4;
  }
  const dx = p.x - r.cx;
  const dy = p.y - r.cy;
  const rr = Math.hypot(dx, dy);
  if (rr > r.r * (1 + tol * 4)) return false;
  if (r.sweep >= TAU - 1e-12) return true;
  let rel = Math.atan2(dy, dx) - r.from;
  while (rel < 0) rel += TAU;
  while (rel >= TAU) rel -= TAU;
  return rel <= r.sweep + tol * 4;
}

/** Nearest point of the closed region (p itself when inside). */
export function closestInRegion(p: V2, r: Region, tol: number): V2 {
  if (pointInRegion(p, r, tol)) return { ...p };
  if (r.kind === 'polygon') {
    let best = { ...(r.pts[0] as V2) };
    let bd = Infinity;
    for (let i = 0; i < r.pts.length; i++) {
      const a = r.pts[i] as V2;
      const b = r.pts[(i + 1) % r.pts.length] as V2;
      const pr = segmentPath(a, b).project(p);
      if (pr.dist < bd) {
        bd = pr.dist;
        best = segmentPath(a, b).at(pr.s);
      }
    }
    return best;
  }
  if (r.kind === 'disc') {
    const dx = p.x - r.cx;
    const dy = p.y - r.cy;
    if (dx === 0 && dy === 0) return { x: r.cx + r.a * r.ux, y: r.cy + r.a * r.uy };
    // Scale back along the ray in unit-disc space.
    const nx = -r.uy;
    const ny = r.ux;
    const X = dx * r.ux + dy * r.uy;
    const Y = dx * nx + dy * ny;
    const e = Math.hypot(X / (r.a || 1), Y / (r.b || 1)) || 1;
    return { x: r.cx + dx / e, y: r.cy + dy / e };
  }
  // Sector: nearest of the arc and the two radii.
  const arc = arcPath(circlePath(r.cx, r.cy, r.r), r.from, r.sweep).project(p);
  const aq = arcPath(circlePath(r.cx, r.cy, r.r), r.from, r.sweep).at(arc.s);
  const e0 = { x: r.cx + r.r * Math.cos(r.from), y: r.cy + r.r * Math.sin(r.from) };
  const e1 = { x: r.cx + r.r * Math.cos(r.from + r.sweep), y: r.cy + r.r * Math.sin(r.from + r.sweep) };
  const c = { x: r.cx, y: r.cy };
  const cands = [aq, segmentPath(c, e0).at(segmentPath(c, e0).project(p).s), segmentPath(c, e1).at(segmentPath(c, e1).project(p).s)];
  let best = cands[0] as V2;
  let bd = dist(p, best);
  for (const q of cands) {
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

/* ------------------------------ Point, PointOn, Along, ParamOf ------------------------------ */

function pointOnPath(path: Path, u: number, call: RuleCall): unknown {
  if (!Number.isFinite(u)) return call.fail('not_finite');
  const uu = path.closed ? ((u % 1) + 1) % 1 : u;
  const s = path.unnorm(uu);
  if (!Number.isFinite(s)) return call.fail('too_far');
  const p = path.at(s);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return call.fail('out_of_domain', 'the function is undefined there');
  if (Math.hypot(p.x, p.y) > 1e14) return call.fail('too_far');
  return p;
}

export const pointOnDefaultRule: CommandRule = rule((call) => {
  const path = pathOf(call.values[0]);
  if (!path) return call.fail('out_of_domain', 'not a path');
  // conics 3.5: the default parameter of a hyperbola is its first vertex
  return pointOnPath(path, path.kind === 'hyperbola' ? 0.25 : 0.5, call);
});

export const pointOnRule: CommandRule = rule(
  (call) => {
    const path = pathOf(call.values[0]);
    if (!path) return call.fail('out_of_domain', 'not a path');
    return pointOnPath(path, N(call, 1), call);
  },
  {
    invert: (target, c) => {
      if (!isPt(target)) return undefined;
      const path = pathOf(c.values[0]);
      if (!path) return undefined;
      const pr = path.project(target as V2);
      return [{ param: 1, value: path.norm(pr.s) }];
    },
  },
);

export const alongRule: CommandRule = rule((call) => {
  const path = pathOf(call.values[0]);
  if (!path) return call.fail('out_of_domain', 'not a path');
  return pointOnPath(path, N(call, 1), call);
});

export const paramOfRule: CommandRule = rule((call) => {
  void call;
  // Single-argument form: the point's path cannot be read from its value
  // through the rule contract (kernel gap); the two-argument form works.
  return call.fail('out_of_domain', 'use ParamOf(P, path) with the path');
});

export const paramOfPathRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  if (!sanePt(call, p)) return undefined;
  const path = pathOf(call.values[1]);
  if (!path) return call.fail('out_of_domain', 'not a path');
  return path.norm(path.project(p).s);
});

/* ------------------------------ PointIn ------------------------------ */

function pointInAt(r: Region, u: number, v: number): V2 {
  if (r.kind === 'disc') {
    const nx = -r.uy;
    const ny = r.ux;
    return { x: r.cx + u * r.a * r.ux + v * r.b * nx, y: r.cy + u * r.a * r.uy + v * r.b * ny };
  }
  if (r.kind === 'sector') {
    const ang = r.from + v * r.sweep;
    const rad = Math.min(1, Math.max(0, u)) * r.r;
    return { x: r.cx + rad * Math.cos(ang), y: r.cy + rad * Math.sin(ang) };
  }
  // Polygon: centroid-ray map (u = angle fraction, v = radius fraction).
  const c = polyCentroid(r.pts) ?? { x: 0, y: 0 };
  const ang = u * TAU;
  const dir = { x: Math.cos(ang), y: Math.sin(ang) };
  const edge = rayPolygonHit(c, dir, r.pts);
  const t = Math.min(1, Math.max(0, v)) * edge;
  return { x: c.x + t * dir.x, y: c.y + t * dir.y };
}

function polyCentroid(pts: readonly V2[]): V2 | undefined {
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  if (pts.length === 0) return undefined;
  return { x: sx / pts.length, y: sy / pts.length };
}

/** Distance from c along dir to the polygon boundary (0 when c is outside). */
function rayPolygonHit(c: V2, dir: V2, pts: readonly V2[]): number {
  let best = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as V2;
    const b = pts[(i + 1) % pts.length] as V2;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const det = dir.x * -ey - (-ex) * dir.y;
    if (Math.abs(det) < 1e-15) continue;
    const rx = a.x - c.x;
    const ry = a.y - c.y;
    const s = (rx * -ey + ex * ry) / det;
    const t = (dir.x * ry - dir.y * rx) / det;
    if (s > 0 && t >= 0 && t <= 1 && (best === 0 || s < best)) best = s;
  }
  return best;
}

function pointInInvert(r: Region, t: V2): { u: number; v: number } {
  if (r.kind === 'disc') {
    const dx = t.x - r.cx;
    const dy = t.y - r.cy;
    const nx = -r.uy;
    const ny = r.ux;
    let u = (dx * r.ux + dy * r.uy) / (r.a || 1);
    let v = (dx * nx + dy * ny) / (r.b || 1);
    const l = Math.hypot(u, v);
    if (l > 1) {
      u /= l;
      v /= l;
    }
    return { u, v };
  }
  if (r.kind === 'sector') {
    let rel = Math.atan2(t.y - r.cy, t.x - r.cx) - r.from;
    while (rel < 0) rel += TAU;
    const v = r.sweep > 0 ? Math.min(1, Math.max(0, rel / r.sweep)) : 0;
    const u = Math.min(1, Math.hypot(t.x - r.cx, t.y - r.cy) / (r.r || 1));
    return { u, v };
  }
  const c = polyCentroid(r.pts) ?? { x: 0, y: 0 };
  const dx = t.x - c.x;
  const dy = t.y - c.y;
  const u = ((Math.atan2(dy, dx) / TAU) % 1 + 1) % 1;
  const edge = rayPolygonHit(c, { x: Math.cos(u * TAU), y: Math.sin(u * TAU) }, r.pts);
  const v = edge > 0 ? Math.min(1, Math.hypot(dx, dy) / edge) : 0;
  return { u, v };
}

function pointInRuleBody(call: RuleCall, u: number, v: number): unknown {
  const r = regionOf(call.values[0]);
  if (!r) return call.fail('wrong_kind', 'needs a polygon, circle, ellipse or sector interior');
  if (!saneNum(call, u) || !saneNum(call, v)) return undefined;
  const p = pointInAt(r, u, v);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return call.fail('not_finite');
  return p;
}

export const pointInDefaultRule: CommandRule = rule((call) => pointInRuleBody(call, 0, 0));

export const pointInRule: CommandRule = rule(
  (call) => pointInRuleBody(call, N(call, 1), N(call, 2)),
  {
    invert: (target, c) => {
      if (!isPt(target)) return undefined;
      const r = regionOf(c.values[0]);
      if (!r) return undefined;
      const { u, v } = pointInInvert(r, target as V2);
      return [
        { param: 1, value: u },
        { param: 2, value: v },
      ];
    },
  },
);

/* ------------------------------ RandomIn ------------------------------ */

function randomInRegion(r: Region, seed: number): V2 {
  if (r.kind === 'disc') {
    const a = hashRand(seed, 1) * TAU;
    const rad = Math.sqrt(hashRand(seed, 2));
    const nx = -r.uy;
    const ny = r.ux;
    return {
      x: r.cx + rad * Math.cos(a) * r.a * r.ux + rad * Math.sin(a) * r.b * nx,
      y: r.cy + rad * Math.cos(a) * r.a * r.uy + rad * Math.sin(a) * r.b * ny,
    };
  }
  if (r.kind === 'sector') {
    const a = r.from + hashRand(seed, 1) * r.sweep;
    const rad = Math.sqrt(hashRand(seed, 2)) * r.r;
    return { x: r.cx + rad * Math.cos(a), y: r.cy + rad * Math.sin(a) };
  }
  // Polygon: deterministic rejection over the bounding box (pure in seed).
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of r.pts) {
    x0 = Math.min(x0, p.x);
    x1 = Math.max(x1, p.x);
    y0 = Math.min(y0, p.y);
    y1 = Math.max(y1, p.y);
  }
  for (let i = 0; i < 100; i++) {
    const p = { x: x0 + hashRand(seed, 2 * i) * (x1 - x0), y: y0 + hashRand(seed, 2 * i + 1) * (y1 - y0) };
    if (pointInPolygon(p, r.pts, 1e-9)) return p;
  }
  return polyCentroid(r.pts) ?? { x: x0, y: y0 };
}

export const randomInRegionRule: CommandRule = rule((call) => {
  const r = regionOf(call.values[0]);
  if (!r) return call.fail('wrong_kind', 'needs a polygon, circle, ellipse or sector interior');
  const seed = N(call, 1);
  if (!Number.isFinite(seed)) return call.fail('not_finite');
  return randomInRegion(r, seed);
});

export const randomInRectRule: CommandRule = rule((call) => {
  const x0 = N(call, 0);
  const x1 = N(call, 1);
  const y0 = N(call, 2);
  const y1 = N(call, 3);
  const seed = N(call, 4);
  for (const v of [x0, x1, y0, y1]) if (!saneNum(call, v)) return undefined;
  if (!Number.isFinite(seed)) return call.fail('not_finite');
  return { x: x0 + hashRand(seed, 0) * (x1 - x0), y: y0 + hashRand(seed, 1) * (y1 - y0) };
});

/* ------------------------------ Point, Midpoint, Vertex ------------------------------ */

export const pointListRule: CommandRule = rule((call) => {
  const v = call.values[0] as ArrayLike<unknown>;
  const len = (v as readonly unknown[]).length;
  if (len !== 2) return call.fail('out_of_domain', `a point list needs 2 numbers, found ${len}`);
  const x = (v as readonly unknown[])[0] as number;
  const y = (v as readonly unknown[])[1] as number;
  if (typeof x !== 'number' || typeof y !== 'number') return call.fail('out_of_domain', 'a point list needs 2 numbers');
  if (!saneNum(call, x) || !saneNum(call, y)) return undefined;
  return { x, y };
});

export const pointPlusVectorRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const v = P(call, 1);
  if (!sanePt(call, p) || !sanePt(call, v)) return undefined;
  return { x: p.x + v.x, y: p.y + v.y };
});

export const midpointPPRule: CommandRule = rule(
  (call) => {
    const a = P(call, 0);
    const b = P(call, 1);
    if (!sanePt(call, a) || !sanePt(call, b)) return undefined;
    // a + (b - a)/2 avoids overflow.
    return { x: a.x + (b.x - a.x) / 2, y: a.y + (b.y - a.y) / 2 };
  },
  {
    invert: (target, c) => {
      if (!isPt(target)) return undefined;
      const b = c.values[1] as V2;
      if (!isPt(b)) return undefined;
      const t = target as V2;
      return [{ param: 0, value: { x: 2 * t.x - b.x, y: 2 * t.y - b.y } }];
    },
  },
);

export const midpointSegRule: CommandRule = rule((call) => {
  const s = call.values[0] as { a: V2; b: V2 };
  if (!sanePt(call, s.a) || !sanePt(call, s.b)) return undefined;
  return { x: s.a.x + (s.b.x - s.a.x) / 2, y: s.a.y + (s.b.y - s.a.y) / 2 };
});

export const midpointArcRule: CommandRule = rule((call) => {
  const path = pathOf(call.values[0]);
  if (!path) return call.fail('out_of_domain', 'not an arc');
  return pointOnPath(path, 0.5, call);
});

export const vertexSegRule: CommandRule = rule((call) => {
  const s = call.values[0] as { a: V2; b: V2 };
  const k = N(call, 1);
  if (!isWhole(k) || (k !== 1 && k !== 2)) return call.fail('index_out_of_range', `index ${k} of 2`);
  return k === 1 ? { ...s.a } : { ...s.b };
});

export const vertexRayRule: CommandRule = rule((call) => {
  const r = call.values[0] as { from: V2 };
  return { ...r.from };
});

/* ------------------------------ Intersect ------------------------------ */

type Operand =
  | { k: 'line'; ll: LineLike }
  | { k: 'conic'; c: ConicValue; range?: ArcRange }
  | { k: 'poly'; pts: readonly V2[]; closed: boolean }
  | { k: 'func'; f: FunctionValue }
  | { k: 'curve'; path: Path };

function classifyOperand(v: unknown, extend: boolean): Operand | { reason: UndefReason; detail?: string } {
  const ll = lineLikeOf(v);
  if (ll) {
    if (extend && ll.kind !== 'line') {
      return { k: 'line', ll: { ...ll, lo: -Infinity, hi: Infinity, kind: 'line' } };
    }
    return { k: 'line', ll };
  }
  if (isCircleV(v)) return { k: 'conic', c: circleConic(v.cx, v.cy, v.r) };
  if (isConicV(v)) return { k: 'conic', c: v };
  if (isArcV(v)) {
    if (extend) return { k: 'conic', c: v.conic };
    const cp = centralParams(v.conic);
    if (!cp) return { reason: 'wrong_kind', detail: 'arc of a degenerate conic' };
    return { k: 'conic', c: v.conic, range: { cx: cp.cx, cy: cp.cy, from: v.from, sweep: v.sweep } };
  }
  if (isPolygonV(v)) return { k: 'poly', pts: v.pts, closed: true };
  if (isPolylineV(v)) return { k: 'poly', pts: v.pts as V2[], closed: false };
  if (isFunctionV(v)) {
    if (v.ret !== 'Number' || v.arity !== 1) return { reason: 'out_of_domain', detail: 'needs a function of one number' };
    return { k: 'func', f: v };
  }
  if (isGeomCurveV(v)) return { k: 'curve', path: curvePath(v) };
  return { reason: 'out_of_domain', detail: 'not an intersection operand' };
}

/** Pairwise slots; compact lists for polygon/function/curve pairs. */
function intersectPair(a: Operand, b: Operand, tol: number): { slots: Slot[]; compact: boolean } {
  if (a.k === 'line' && b.k === 'line') {
    const hit = intersectLineLine(a.ll, b.ll, tol);
    if (hit.p) return { slots: [{ p: hit.p }], compact: false };
    const slot: Slot = hit.detail === undefined
      ? { reason: hit.reason as UndefReason }
      : { reason: hit.reason as UndefReason, detail: hit.detail };
    return { slots: [slot], compact: false };
  }
  if (a.k === 'line' && b.k === 'conic') {
    const o = { x: a.ll.ox, y: a.ll.oy };
    const d = { x: a.ll.dx, y: a.ll.dy };
    return { slots: lineConicSlots(o, d, b.c, tol, a.ll.kind === 'line' ? undefined : a.ll, b.range), compact: false };
  }
  if (a.k === 'conic' && b.k === 'line') {
    const o = { x: b.ll.ox, y: b.ll.oy };
    const d = { x: b.ll.dx, y: b.ll.dy };
    return { slots: lineConicSlots(o, d, a.c, tol, b.ll.kind === 'line' ? undefined : b.ll, a.range), compact: false };
  }
  if (a.k === 'conic' && b.k === 'conic') {
    const ac = a.c.kind === 'circle' ? circleOf(a.c) : undefined;
    const bc = b.c.kind === 'circle' ? circleOf(b.c) : undefined;
    let slots: Slot[];
    if (ac && bc) {
      slots = circleCircleSlots(ac, bc, tol);
    } else {
      slots = conicConicSlots(a.c, b.c, tol);
    }
    if (a.range || b.range) slots = slots.map((s) => (inRanges(s, a.range, b.range, tol) ? s : { reason: 'outside_path' as UndefReason }));
    return { slots, compact: false };
  }
  if (a.k === 'line' && b.k === 'poly') return { slots: linePolySlots(a.ll, b.pts, b.closed, tol), compact: true };
  if (a.k === 'poly' && b.k === 'line') return { slots: linePolySlots(b.ll, a.pts, a.closed, tol), compact: true };
  if (a.k === 'conic' && b.k === 'poly') return { slots: conicPolySlots(a.c, a.range, b.pts, b.closed, tol), compact: true };
  if (a.k === 'poly' && b.k === 'conic') return { slots: conicPolySlots(b.c, b.range, a.pts, a.closed, tol), compact: true };
  if (a.k === 'poly' && b.k === 'poly') {
    return { slots: polyPolyPoints(a.pts, b.pts, tol).map((p) => ({ p })), compact: true };
  }
  if (a.k === 'func' && b.k === 'line') {
    if (b.ll.kind !== 'line') {
      return { slots: funcSegRoots(a.f, b.ll).map((p) => ({ p })), compact: true };
    }
    const r = functionLineRoots(a.f, b.ll, undefined, undefined);
    return { slots: r.pts.map((p) => ({ p })), compact: true };
  }
  if (a.k === 'line' && b.k === 'func') {
    if (a.ll.kind !== 'line') {
      return { slots: funcSegRoots(b.f, a.ll).map((p) => ({ p })), compact: true };
    }
    const r = functionLineRoots(b.f, a.ll, undefined, undefined);
    return { slots: r.pts.map((p) => ({ p })), compact: true };
  }
  if (a.k === 'func' && b.k === 'func') {
    const r = functionFunctionRoots(a.f, b.f, undefined, undefined);
    return { slots: r.pts.map((p) => ({ p })), compact: true };
  }
  if (a.k === 'func' && b.k === 'conic') return { slots: funcConicRoots(a.f, b.c).map((p) => ({ p })), compact: true };
  if (a.k === 'conic' && b.k === 'func') return { slots: funcConicRoots(b.f, a.c).map((p) => ({ p })), compact: true };
  if (a.k === 'func' && b.k === 'poly') return { slots: funcPolyRoots(a.f, b.pts, b.closed).map((p) => ({ p })), compact: true };
  if (a.k === 'poly' && b.k === 'func') return { slots: funcPolyRoots(b.f, a.pts, a.closed).map((p) => ({ p })), compact: true };
  // Curve pairs (4.7): sample both, refine crossings.
  const pa = curveOperandPath(a);
  const pb = curveOperandPath(b);
  if (pa && pb) {
    const self = a.k === 'curve' && b.k === 'curve';
    return { slots: curveCurveSlots(pa, pb, tol, self).map((p) => ({ p })), compact: true };
  }
  return { slots: [{ reason: 'out_of_domain' }], compact: true };
}

function circleOf(c: ConicValue): { cx: number; cy: number; r: number } | undefined {
  const cp = centralParams(c);
  return cp ? { cx: cp.cx, cy: cp.cy, r: cp.a } : undefined;
}

function inRanges(s: Slot, ra: ArcRange | undefined, rb: ArcRange | undefined, tol: number): boolean {
  if (!('p' in s)) return true;
  const p = s.p;
  for (const r of [ra, rb]) {
    if (!r || r.sweep >= TAU - 1e-12) continue;
    let rel = Math.atan2(p.y - r.cy, p.x - r.cx) - r.from;
    while (rel < 0) rel += TAU;
    while (rel >= TAU) rel -= TAU;
    if (rel > r.sweep + tol * 4) return false;
  }
  return true;
}

function linePolySlots(ll: LineLike, pts: readonly V2[], closed: boolean, tol: number): Slot[] {
  const o = { x: ll.ox, y: ll.oy };
  const d = { x: ll.dx, y: ll.dy };
  const hits = linePolyPoints(o, d, pts, closed, tol).pts;
  const out: Slot[] = [];
  for (const h of hits) {
    if (ll.kind !== 'line' && !withinLimits(ll, h.p, tol)) continue;
    out.push({ p: h.p });
  }
  return out;
}

function conicPolySlots(c: ConicValue, range: ArcRange | undefined, pts: readonly V2[], closed: boolean, tol: number): Slot[] {
  const n = pts.length;
  const edges = closed ? n : n - 1;
  const out: Array<{ p: V2; key: number }> = [];
  for (let i = 0; i < edges; i++) {
    const e0 = pts[i] as V2;
    const e1 = pts[(i + 1) % n] as V2;
    const len = dist(e0, e1);
    if (!(len > 0)) continue;
    const d = { x: (e1.x - e0.x) / len, y: (e1.y - e0.y) / len };
    const ll: LineLike = {
      a: -d.y, b: d.x, c: -d.y * e0.x + d.x * e0.y, dx: d.x, dy: d.y,
      ox: e0.x, oy: e0.y, lo: 0, hi: len, kind: 'segment',
    };
    const slots = lineConicSlots(e0, d, c, tol, ll, range);
    for (const s of slots) {
      if (!('p' in s)) continue;
      const t = ((s.p.x - e0.x) * d.x + (s.p.y - e0.y) * d.y) / len;
      out.push({ p: s.p, key: i + Math.min(1, Math.max(0, t)) });
    }
  }
  out.sort((a, b) => a.key - b.key);
  return dedupePoints(
    out.map((h) => h.p),
    tol,
  ).map((p) => ({ p }));
}

/** Function against a segment/ray: bounded by its extent, so no interval is needed. */
function funcSegRoots(f: FunctionValue, ll: LineLike): V2[] {
  const ev: Fn1 = (x) => evalFn(f, x);
  const useX = Math.abs(ll.dx) >= Math.abs(ll.dy) * 0.5;
  if (useX && ll.dx !== 0) {
    const x0 = ll.ox + ll.lo * ll.dx;
    const x1 = ll.kind === 'segment' ? ll.ox + ll.hi * ll.dx : ll.ox + ll.dx * 100;
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    const m = ll.dy / ll.dx;
    const bb = ll.oy - m * ll.ox;
    const g: Fn1 = (x) => {
      const y = ev(x);
      return y === undefined ? undefined : y - (m * x + bb);
    };
    const roots = polyRootsOf(g, lo, hi) ?? scanRoots(g, lo, hi);
    return roots.map((x) => ({ x, y: m * x + bb }));
  }
  // Steep: parametrize by s along the ray/segment.
  const hi = ll.kind === 'segment' ? ll.hi : 100;
  const g: Fn1 = (s) => {
    const x = ll.ox + s * ll.dx;
    const y = ll.oy + s * ll.dy;
    const fy = ev(x);
    return fy === undefined ? undefined : fy - y;
  };
  const roots = polyRootsOf(g, ll.lo, hi) ?? scanRoots(g, ll.lo, hi);
  return roots.map((s) => ({ x: ll.ox + s * ll.dx, y: ll.oy + s * ll.dy }));
}

/** Function against a conic: roots of the conic residual along the graph. */
function funcConicRoots(f: FunctionValue, c: ConicValue): V2[] {
  const ev: Fn1 = (x) => evalFn(f, x);
  const g: Fn1 = (x) => {
    const y = ev(x);
    return y === undefined ? undefined : conicAt(c.q, x, y);
  };
  const roots = polyRootsOf(g, -10, 10) ?? scanRoots(g, -10, 10);
  return roots.map((x) => ({ x, y: ev(x) as number })).filter((p) => Number.isFinite(p.y));
}

/** Function against a polygon/polyline: per-edge bounded solves. */
function funcPolyRoots(f: FunctionValue, pts: readonly V2[], closed: boolean): V2[] {
  const n = pts.length;
  const edges = closed ? n : n - 1;
  const out: V2[] = [];
  for (let i = 0; i < edges; i++) {
    const e0 = pts[i] as V2;
    const e1 = pts[(i + 1) % n] as V2;
    const len = dist(e0, e1);
    if (!(len > 0)) continue;
    const d = { x: (e1.x - e0.x) / len, y: (e1.y - e0.y) / len };
    const ll: LineLike = {
      a: -d.y, b: d.x, c: -d.y * e0.x + d.x * e0.y, dx: d.x, dy: d.y,
      ox: e0.x, oy: e0.y, lo: 0, hi: len, kind: 'segment',
    };
    out.push(...funcSegRoots(f, ll));
  }
  return dedupePoints(out, 1e-9);
}

function curveOperandPath(op: Operand): Path | undefined {
  if (op.k === 'curve') return op.path;
  if (op.k === 'line') {
    if (op.ll.kind === 'line') return linePath(op.ll.a, op.ll.b, op.ll.c);
    if (op.ll.kind === 'ray') return rayPath({ x: op.ll.ox, y: op.ll.oy }, { x: op.ll.dx, y: op.ll.dy });
    return undefined;
  }
  if (op.k === 'conic') return conicPath(op.c);
  if (op.k === 'func') return functionPath(op.f);
  if (op.k === 'poly') return op.closed ? polygonPath(op.pts) : polylinePath(op.pts);
  return undefined;
}

function intersectBody(
  call: RuleCall,
  mode: 'list' | 'index' | 'near' | 'extend' | 'combo',
  extra: { k?: number; near?: V2; extend?: boolean },
): unknown {
  const tol = call.tol;
  const extend = mode === 'extend' || mode === 'combo' ? extra.extend !== false : false;
  const oa = classifyOperand(call.values[0], extend);
  const ob = classifyOperand(call.values[1], extend);
  if ('reason' in oa) return call.fail(oa.reason, oa.detail);
  if ('reason' in ob) return call.fail(ob.reason, ob.detail);
  const { slots, compact } = intersectPair(oa, ob, tol);
  if (mode === 'index') {
    if (compact) {
      const k = extra.k as number;
      if (!isWhole(k) || k < 1 || k > slots.length) return call.fail('index_out_of_range', `index ${extra.k} of ${slots.length}`);
      const s = slots[k - 1] as Slot;
      return 'p' in s ? s.p : call.fail(s.reason, s.detail);
    }
    return slotIndex(call, slots, extra.k as number, slots.length);
  }
  if (mode === 'near' || mode === 'combo') {
    const near = extra.near as V2;
    if (!isSanePt(near)) return call.fail('not_finite');
    return slotNear(call, slots, near);
  }
  if (compact) return slots.map((s) => ('p' in s ? s.p : undefined));
  return slotsToList(call, slots);
}

/** Line-like pair as a single Point (fixed-1 form). */
export const intersectLLRule: CommandRule = rule((call) => {
  const tol = call.tol;
  const a = lineLikeOf(call.values[0]);
  const b = lineLikeOf(call.values[1]);
  if (!a || !b) return call.fail('out_of_domain', 'needs two lines');
  const hit = intersectLineLine(a, b, tol);
  if (hit.p) return hit.p;
  return call.fail(hit.reason as UndefReason, hit.detail);
});

export const intersectLLIndexRule: CommandRule = rule((call) => {
  const k = N(call, 2);
  if (!isWhole(k) || k !== 1) return call.fail('index_out_of_range', `index ${k} of 1`);
  return intersectLLRule.run(call);
});

export const intersectLLNearRule: CommandRule = rule((call) => intersectLLRule.run(call));

export const intersectLLExtendRule: CommandRule = rule((call) => {
  const tol = call.tol;
  const ext = call.values[2] as boolean;
  const a = lineLikeOf(call.values[0]);
  const b = lineLikeOf(call.values[1]);
  if (!a || !b) return call.fail('out_of_domain', 'needs two lines');
  const ca: LineLike = ext && a.kind !== 'line' ? { ...a, lo: -Infinity, hi: Infinity, kind: 'line' } : a;
  const cb: LineLike = ext && b.kind !== 'line' ? { ...b, lo: -Infinity, hi: Infinity, kind: 'line' } : b;
  const hit = intersectLineLine(ca, cb, tol);
  if (hit.p) return hit.p;
  return call.fail(hit.reason as UndefReason, hit.detail);
});

export const intersectLLComboRule: CommandRule = rule((call) => intersectLLExtendRule.run(call));

export const intersectListRule: CommandRule = rule((call) => intersectBody(call, 'list', {}));
export const intersectIndexRule: CommandRule = rule((call) => intersectBody(call, 'index', { k: N(call, 2) }));
export const intersectNearRule: CommandRule = rule((call) => intersectBody(call, 'near', { near: P(call, 2) }));
export const intersectExtendRule: CommandRule = rule((call) =>
  intersectBody(call, 'extend', { extend: call.values[2] as boolean }),
);
export const intersectComboRule: CommandRule = rule((call) =>
  intersectBody(call, 'combo', { near: P(call, 2), extend: call.values[3] as boolean }),
);

/** Intersect(f, g, near = P): damped Newton from P.x. */
export const intersectNearFnRule: CommandRule = rule((call) => {
  const near = P(call, 2);
  if (!sanePt(call, near)) return undefined;
  const f = call.values[0] as FunctionValue;
  const g: Fn1 = (x) => {
    const a = evalFn(f, x);
    const b = evalFn(call.values[1] as FunctionValue, x);
    return a === undefined || b === undefined ? undefined : a - b;
  };
  if (!call.work.spend(500)) return call.fail('timeout');
  const x = newtonNear(g, near.x);
  if (x === undefined) return call.fail('no_convergence');
  const y = evalFn(f, x);
  if (y === undefined) return call.fail('no_convergence');
  return { x, y };
});

/** Intersect(f, g, from, to) and Intersect(f, line, from, to). */
export const intersectFFIntervalRule: CommandRule = rule((call) => {
  const f = call.values[0] as FunctionValue;
  const g = call.values[1] as FunctionValue;
  const from = N(call, 2);
  const to = N(call, 3);
  if (!saneNum(call, from) || !saneNum(call, to)) return undefined;
  if (!call.work.spend(5000)) return call.fail('timeout');
  return functionFunctionRoots(f, g, from, to).pts;
});

export const intersectFLineIntervalRule: CommandRule = rule((call) => {
  const f = call.values[0] as FunctionValue;
  const ll = lineLikeOf(call.values[1]);
  if (!ll) return call.fail('out_of_domain', 'needs a line');
  const from = N(call, 2);
  const to = N(call, 3);
  if (!saneNum(call, from) || !saneNum(call, to)) return undefined;
  if (!call.work.spend(5000)) return call.fail('timeout');
  const r = functionLineRoots(f, ll, from, to);
  return ll.kind === 'line' ? r.pts : r.pts.filter((p) => withinLimits(ll, p, call.tol));
});

/* ------------------------------ Line, Segment, Ray, Vector ------------------------------ */

/** Line through two points: left-normal storage so Direction runs P -> Q. */
export const linePPRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const b = P(call, 1);
  if (!sanePt(call, a) || !sanePt(call, b)) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const scale = Math.max(1, Math.abs(a.x), Math.abs(a.y), Math.abs(b.x), Math.abs(b.y));
  if (len <= call.tol * scale) return call.fail('coincident_points');
  const ux = dx / len;
  const uy = dy / len;
  return { a: -uy, b: ux, c: -uy * a.x + ux * a.y, p: { ...a }, len };
});

export const linePVRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const v = P(call, 1);
  if (!sanePt(call, p) || !sanePt(call, v)) return undefined;
  const len = norm2(v);
  if (len <= call.tol * Math.max(1, Math.abs(p.x), Math.abs(p.y))) return call.fail('zero_length');
  const ux = v.x / len;
  const uy = v.y / len;
  return { a: -uy, b: ux, c: -uy * p.x + ux * p.y, p: { ...p }, len };
});

export const lineParallelRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const ll = lineLikeOf(call.values[1]);
  if (!ll) return call.fail('out_of_domain', 'needs a line');
  if (!sanePt(call, p)) return undefined;
  return { a: ll.a, b: ll.b, c: ll.a * p.x + ll.b * p.y };
});

export const lineEqRule: CommandRule = rule((call) => {
  const rel = call.values[0] as RelationValue;
  if (rel.ops.length !== 1 || rel.ops[0] !== '==') return call.fail('bad_equation', 'Line needs one == equation');
  const poly = rel.poly;
  if (!poly) return call.fail('not_quadratic', 'not a polynomial equation of degree 1 or 2');
  if (poly.xx !== 0 || poly.xy !== 0 || poly.yy !== 0) {
    return call.fail('bad_equation', 'not a linear equation (it has degree 2)');
  }
  const l = Math.hypot(poly.x, poly.y);
  if (!(l > 0)) return call.fail('out_of_domain', '0 == 0 is not a line');
  // poly: x*X + y*Y + c = 0  ->  ax + by = c' form.
  // Direction (b, -a) has its first non-zero component positive (points-lines 5.2).
  let a = poly.x / l;
  let b = poly.y / l;
  let c = -poly.c / l;
  if (b < -1e-15 || (Math.abs(b) <= 1e-15 && -a < 0)) {
    a = -a;
    b = -b;
    c = -c;
  }
  return { a, b, c };
});

export const segmentPPRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const b = P(call, 1);
  if (!sanePt(call, a) || !sanePt(call, b)) return undefined;
  return { a: { ...a }, b: { ...b } };
});

export const segmentLenRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const len = N(call, 1);
  if (!sanePt(call, a) || !saneNum(call, len)) return undefined;
  return { a: { ...a }, b: { x: a.x + len, y: a.y } };
});

export const rayPPRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const b = P(call, 1);
  if (!sanePt(call, a) || !sanePt(call, b)) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const scale = Math.max(1, Math.abs(a.x), Math.abs(a.y));
  if (len <= call.tol * scale) return call.fail('coincident_points');
  return { from: { ...a }, dir: { x: dx / len, y: dy / len }, len };
});

export const rayPVRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const v = P(call, 1);
  if (!sanePt(call, a) || !sanePt(call, v)) return undefined;
  const len = norm2(v);
  if (len <= call.tol * Math.max(1, Math.abs(a.x), Math.abs(a.y))) return call.fail('zero_length');
  return { from: { ...a }, dir: { x: v.x / len, y: v.y / len }, len };
});

export const vectorNNRule: CommandRule = rule((call) => {
  const x = N(call, 0);
  const y = N(call, 1);
  if (!saneNum(call, x) || !saneNum(call, y)) return undefined;
  return { x, y };
});

export const vectorPPRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const b = P(call, 1);
  if (!sanePt(call, a) || !sanePt(call, b)) return undefined;
  return { x: b.x - a.x, y: b.y - a.y };
});

export const vectorPRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  if (!sanePt(call, p)) return undefined;
  return { ...p };
});

/* ------------------------------ Perpendicular, Parallel, Bisector ------------------------------ */

function carrierOf(v: unknown): { dx: number; dy: number } | undefined {
  const ll = lineLikeOf(v);
  if (ll) return { dx: ll.dx, dy: ll.dy };
  if (isPt(v)) {
    const l = norm2(v);
    if (!(l > 0)) return undefined;
    return { dx: v.x / l, dy: v.y / l };
  }
  return undefined;
}

export const perpendicularRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const c = carrierOf(call.values[1]);
  if (!c) return call.fail('zero_length');
  if (!sanePt(call, p)) return undefined;
  // Normal (-b, a) of the carrier's unit normal: direction (a, b).
  const a = c.dx;
  const b = c.dy;
  return { a, b, c: a * p.x + b * p.y };
});

export const parallelRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const c = carrierOf(call.values[1]);
  if (!c) return call.fail('zero_length');
  if (!sanePt(call, p)) return undefined;
  const a = -c.dy;
  const b = c.dx;
  return { a, b, c: a * p.x + b * p.y };
});

export const bisectorPPRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const b = P(call, 1);
  if (!sanePt(call, a) || !sanePt(call, b)) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len <= call.tol * Math.max(1, Math.abs(a.x), Math.abs(a.y))) return call.fail('coincident_points');
  const m = { x: a.x + dx / 2, y: a.y + dy / 2 };
  const n = { x: dx / len, y: dy / len };
  return { a: n.x, b: n.y, c: n.x * m.x + n.y * m.y };
});

export const bisectorSegRule: CommandRule = rule((call) => {
  const s = call.values[0] as { a: V2; b: V2 };
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len = Math.hypot(dx, dy);
  if (len <= call.tol * Math.max(1, Math.abs(s.a.x), Math.abs(s.a.y))) return call.fail('zero_length');
  const m = { x: s.a.x + dx / 2, y: s.a.y + dy / 2 };
  const n = { x: dx / len, y: dy / len };
  return { a: n.x, b: n.y, c: n.x * m.x + n.y * m.y };
});

export const bisectorAPEXRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const b = P(call, 1);
  const c = P(call, 2);
  if (!sanePt(call, a) || !sanePt(call, b) || !sanePt(call, c)) return undefined;
  const u1 = { x: a.x - b.x, y: a.y - b.y };
  const u2 = { x: c.x - b.x, y: c.y - b.y };
  const l1 = norm2(u1);
  const l2 = norm2(u2);
  const scale = Math.max(1, Math.abs(b.x), Math.abs(b.y));
  if (l1 <= call.tol * scale || l2 <= call.tol * scale) return call.fail('zero_length');
  const u = { x: u1.x / l1 + u2.x / l2, y: u1.y / l1 + u2.y / l2 };
  const ul = norm2(u);
  let d: V2;
  if (ul <= 1e-12) {
    // Straight angle: left normal of u1.
    d = { x: -u1.y / l1, y: u1.x / l1 };
  } else {
    d = { x: u.x / ul, y: u.y / ul };
  }
  const n = { x: -d.y, y: d.x };
  return { a: n.x, b: n.y, c: n.x * b.x + n.y * b.y };
});

export const bisectorLLRule: CommandRule = rule((call) => {
  const tol = call.tol;
  const l1 = lineLikeOf(call.values[0]) as LineLike;
  const l2 = lineLikeOf(call.values[1]) as LineLike;
  let n1 = { x: l1.a, y: l1.b };
  let c1 = l1.c;
  const n2 = { x: l2.a, y: l2.b };
  if (n1.x * n2.x + n1.y * n2.y < 0) {
    n1 = { x: -n1.x, y: -n1.y };
    c1 = -c1;
  }
  const s = Math.abs(det2(l1.a, l1.b, l2.a, l2.b).value);
  if (s <= tol) {
    // Parallel: slot 1 is the mid-line, slot 2 parallel (or coincident).
    const d = Math.abs(l2.a * l1.ox + l2.b * l1.oy - l2.c);
    const scale = Math.max(1, Math.abs(l1.c), Math.abs(l2.c));
    if (d <= tol * scale) {
      return [{ a: l1.a, b: l1.b, c: l1.c }, undefined];
    }
    // Mid-line: average of the two carriers with aligned normals.
    return [{ a: n1.x, b: n1.y, c: (c1 + l2.c) / 2 }, undefined];
  }
  const hit = intersectLineLine(l1, l2, tol);
  if (!hit.p) return call.fail(hit.reason as UndefReason, hit.detail);
  const q = hit.p;
  // Slot 1 bisects the acute angle (normal n1 + n2), slot 2 the obtuse.
  const m1 = { x: n1.x + n2.x, y: n1.y + n2.y };
  const m2 = { x: n1.x - n2.x, y: n1.y - n2.y };
  const l1m = norm2(m1) || 1;
  const l2m = norm2(m2) || 1;
  const b1 = { a: m1.x / l1m, b: m1.y / l1m, c: (m1.x * q.x + m1.y * q.y) / l1m };
  const b2 = { a: m2.x / l2m, b: m2.y / l2m, c: (m2.x * q.x + m2.y * q.y) / l2m };
  return [b1, b2];
});

/* ------------------------------ Direction, Normal, unit vectors ------------------------------ */

export const directionRule: CommandRule = rule((call) => {
  const ll = lineLikeOf(call.values[0]);
  if (!ll) return call.fail('zero_length');
  return { x: ll.dx, y: ll.dy };
});

export const normalRule: CommandRule = rule((call) => {
  const v = call.values[0];
  const ll = lineLikeOf(v);
  if (ll) return { x: ll.a, y: ll.b };
  if (isPt(v)) {
    const l = norm2(v);
    if (!(l > 0)) return call.fail('zero_length');
    return { x: -v.y / l, y: v.x / l };
  }
  return call.fail('zero_length');
});

export const unitVectorRule: CommandRule = rule((call) => {
  const v = call.values[0];
  const ll = lineLikeOf(v);
  if (ll) return { x: ll.dx, y: ll.dy };
  if (isPt(v)) {
    const l = norm2(v);
    if (l <= call.tol) return call.fail('zero_length');
    return { x: v.x / l, y: v.y / l };
  }
  return call.fail('zero_length');
});

export const perpVectorRule: CommandRule = rule((call) => {
  const v = call.values[0];
  const ll = lineLikeOf(v);
  if (ll) {
    // Same length as the defining vector, turned 90 degrees counter-clockwise (points-lines 1.1).
    const raw = (v as { len?: unknown }).len;
    const len = ll.kind === 'segment' ? ll.hi : typeof raw === 'number' && raw > 0 ? raw : 1;
    return { x: ll.a * len, y: ll.b * len };
  }
  if (isPt(v)) {
    if (!sanePt(call, v)) return undefined;
    return { x: -v.y, y: v.x };
  }
  return call.fail('zero_length');
});

export const unitPerpVectorRule: CommandRule = rule((call) => {
  const v = call.values[0];
  const ll = lineLikeOf(v);
  if (ll) return { x: ll.a, y: ll.b };
  if (isPt(v)) {
    const l = norm2(v);
    if (l <= call.tol) return call.fail('zero_length');
    return { x: -v.y / l, y: v.x / l };
  }
  return call.fail('zero_length');
});

/* ------------------------------ Dot, Cross, ToPolar, FromPolar ------------------------------ */

export const dotRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const b = P(call, 1);
  if (!sanePt(call, a) || !sanePt(call, b)) return undefined;
  return a.x * b.x + a.y * b.y;
});

export const crossRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const b = P(call, 1);
  if (!sanePt(call, a) || !sanePt(call, b)) return undefined;
  return a.x * b.y - a.y * b.x;
});

export const toPolarRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  if (!sanePt(call, v)) return undefined;
  return [norm2(v), Math.atan2(v.y, v.x)];
});

export const fromPolarRule: CommandRule = rule((call) => {
  const r = N(call, 0);
  const th = N(call, 1);
  if (!saneNum(call, r) || !saneNum(call, th)) return undefined;
  return { x: r * Math.cos(th), y: r * Math.sin(th) };
});

/* ------------------------------ Closest ------------------------------ */

export const closestPathRule: CommandRule = rule((call) => {
  const path = pathOf(call.values[0]);
  const p = P(call, 1);
  if (!path) return call.fail('out_of_domain', 'not a path');
  if (!sanePt(call, p)) return undefined;
  return path.at(path.project(p).s);
});

export const closestLLRule: CommandRule = rule((call) => {
  const a = lineLikeOf(call.values[0]) as LineLike;
  const b = lineLikeOf(call.values[1]) as LineLike;
  const hit = intersectLineLine(a, b, call.tol);
  if (hit.p) return hit.p;
  // Parallel: the point of a nearest b's reference point.
  const q = { x: b.ox, y: b.oy };
  const s = (q.x - a.ox) * a.dx + (q.y - a.oy) * a.dy;
  return { x: a.ox + s * a.dx, y: a.oy + s * a.dy };
});

export const closestRegionRule: CommandRule = rule((call) => {
  const r = regionOf(call.values[0]);
  const p = P(call, 1);
  if (!r) return call.fail('wrong_kind', 'needs a polygon, circle, ellipse or sector interior');
  if (!sanePt(call, p)) return undefined;
  return closestInRegion(p, r, call.tol);
});

/* ------------------------------ Barycenter, Centroid, TriangleCenter, Trilinear ------------------------------ */

function numList(v: unknown): number[] | undefined {
  if (ArrayBuffer.isView(v)) return Array.from(v as unknown as ArrayLike<number>);
  if (!Array.isArray(v)) return undefined;
  if (!v.every((x) => typeof x === 'number')) return undefined;
  return [...(v as number[])];
}

function ptList(v: unknown): V2[] | undefined {
  if (!Array.isArray(v)) return undefined;
  if (!v.every(isPt)) return undefined;
  return [...(v as V2[])];
}

export const barycenterRule: CommandRule = rule((call) => {
  const pts = ptList(call.values[0]);
  const w = numList(call.values[1]);
  if (!pts || !w) return call.fail('out_of_domain', 'needs a point list and a weight list');
  if (pts.length === 0) return call.fail('empty_list');
  if (pts.length !== w.length) return call.fail('out_of_domain', 'points and weights have different lengths');
  let sw = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i] as V2;
    const wi = w[i] as number;
    if (!sanePt(call, p) || !saneNum(call, wi)) return undefined;
    sw += wi;
    sx += wi * p.x;
    sy += wi * p.y;
  }
  if (sw === 0) return call.fail('division_by_zero', 'the weights add up to 0');
  return { x: sx / sw, y: sy / sw };
});

export const centroidListRule: CommandRule = rule((call) => {
  const pts = ptList(call.values[0]);
  if (!pts) return call.fail('out_of_domain', 'needs a point list');
  if (pts.length === 0) return call.fail('empty_list');
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    if (!sanePt(call, p)) return undefined;
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
});

export const triangleCenterRule: CommandRule = rule((call) => {
  const A = P(call, 0);
  const B = P(call, 1);
  const C = P(call, 2);
  const n = N(call, 3);
  if (!sanePt(call, A) || !sanePt(call, B) || !sanePt(call, C)) return undefined;
  if (!isWhole(n) || n < 1 || n > 13) return call.fail('index_out_of_range', `center ${n}; supported: 1 to 13`);
  // Sides and area.
  const a = dist(B, C);
  const b = dist(C, A);
  const c = dist(A, B);
  const area2 = Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y));
  const scale = Math.max(1, a, b, c);
  if (area2 <= call.tol * scale * scale) return call.fail('collinear');
  const s = (a + b + c) / 2;
  const area = area2 / 2;
  const R = (a * b * c) / (4 * area);
  const rIn = area / s;
  const bary = (wa: number, wb: number, wc: number): V2 => {
    const t = wa + wb + wc;
    return { x: (wa * A.x + wb * B.x + wc * C.x) / t, y: (wa * A.y + wb * B.y + wc * C.y) / t };
  };
  // Circumcenter via perpendicular bisectors.
  const d = 2 * ((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y));
  const bx = B.x - A.x;
  const by = B.y - A.y;
  const cx = C.x - A.x;
  const cy = C.y - A.y;
  const O = { x: A.x + ((bx * bx + by * by) * cy - (cx * cx + cy * cy) * by) / d, y: A.y + ((cx * cx + cy * cy) * bx - (bx * bx + by * by) * cx) / d };
  const H = { x: A.x + B.x + C.x - 2 * O.x, y: A.y + B.y + C.y - 2 * O.y };
  const Np = { x: (O.x + H.x) / 2, y: (O.y + H.y) / 2 };
  switch (n) {
    case 1:
      return bary(a, b, c);
    case 2:
      return bary(1, 1, 1);
    case 3:
      return O;
    case 4:
      return H;
    case 5:
      return Np;
    case 6:
      return bary(a * a, b * b, c * c);
    case 7:
      return bary(1 / (s - a), 1 / (s - b), 1 / (s - c));
    case 8:
      return bary(s - a, s - b, s - c);
    case 9:
      return bary(a * (s - a), b * (s - b), c * (s - c));
    case 10:
      return bary(b + c, c + a, a + b);
    case 11: {
      // The incircle touches the nine-point circle from inside: the point on the line N-I beyond I (external homothety centre).
      if (Math.abs(R / 2 - rIn) <= 1e-12 * R) return call.fail('degenerate', 'equilateral: the circles are concentric');
      const I = bary(a, b, c);
      const t = R / 2 - rIn;
      return { x: ((R / 2) * I.x - rIn * Np.x) / t, y: ((R / 2) * I.y - rIn * Np.y) / t };
    }
    case 12: {
      // Reflection of the Feuerbach point across the nine-point center.
      if (Math.abs(R / 2 - rIn) <= 1e-12 * R) return call.fail('degenerate', 'equilateral: the circles are concentric');
      const I = bary(a, b, c);
      const t = R / 2 - rIn;
      const F = { x: ((R / 2) * I.x - rIn * Np.x) / t, y: ((R / 2) * I.y - rIn * Np.y) / t };
      return { x: 2 * Np.x - F.x, y: 2 * Np.y - F.y };
    }
    default: {
      // First isogonic (Fermat): the obtuse vertex at >= 120 degrees, else
      // barycentric a/cos(A - pi/6) : ...
      const angA = Math.acos(Math.min(1, Math.max(-1, (b * b + c * c - a * a) / (2 * b * c))));
      const angB = Math.acos(Math.min(1, Math.max(-1, (c * c + a * a - b * b) / (2 * c * a))));
      const angC = Math.PI - angA - angB;
      if (angA >= (2 * Math.PI) / 3) return { ...A };
      if (angB >= (2 * Math.PI) / 3) return { ...B };
      if (angC >= (2 * Math.PI) / 3) return { ...C };
      return bary(a / Math.cos(angA - Math.PI / 6), b / Math.cos(angB - Math.PI / 6), c / Math.cos(angC - Math.PI / 6));
    }
  }
});

export const trilinearRule: CommandRule = rule((call) => {
  const A = P(call, 0);
  const B = P(call, 1);
  const C = P(call, 2);
  const x = N(call, 3);
  const y = N(call, 4);
  const z = N(call, 5);
  if (!sanePt(call, A) || !sanePt(call, B) || !sanePt(call, C)) return undefined;
  if (!saneNum(call, x) || !saneNum(call, y) || !saneNum(call, z)) return undefined;
  const a = dist(B, C);
  const b = dist(C, A);
  const c = dist(A, B);
  const wa = a * x;
  const wb = b * y;
  const wc = c * z;
  if (wa + wb + wc === 0) return call.fail('division_by_zero', 'the weights add up to 0');
  return { x: (wa * A.x + wb * B.x + wc * C.x) / (wa + wb + wc), y: (wa * A.y + wb * B.y + wc * C.y) / (wa + wb + wc) };
});

/* ------------------------------ Distance, Slope ------------------------------ */

export const distancePPRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const b = P(call, 1);
  if (!sanePt(call, a) || !sanePt(call, b)) return undefined;
  return dist(a, b);
});

export const distancePPathRule: CommandRule = rule((call) => {
  const p = P(call, 0);
  const path = pathOf(call.values[1]);
  if (!path) return call.fail('out_of_domain', 'not a path');
  if (!sanePt(call, p)) return undefined;
  return path.project(p).dist;
});

export const distanceLLRule: CommandRule = rule((call) => {
  const a = lineLikeOf(call.values[0]) as LineLike;
  const b = lineLikeOf(call.values[1]) as LineLike;
  const hit = intersectLineLine(a, b, call.tol);
  if (hit.p) return 0;
  if (hit.reason === 'coincident') return 0;
  if (hit.reason !== 'parallel') return call.fail(hit.reason as UndefReason, hit.detail);
  // Parallel carriers: distance between them.
  return Math.abs(b.a * a.ox + b.b * a.oy - b.c);
});

export const slopeRule: CommandRule = rule((call) => {
  const v = call.values[0];
  const tol = call.tol;
  const ll = lineLikeOf(v);
  if (ll) {
    if (Math.abs(ll.b) <= tol * Math.abs(ll.a)) return call.fail('vertical');
    return -ll.a / ll.b;
  }
  if (isPt(v)) {
    if (!sanePt(call, v)) return undefined;
    if (Math.abs(v.x) <= tol * Math.abs(v.y) && v.x === 0) return call.fail('vertical');
    if (v.x === 0) return call.fail('vertical');
    return v.y / v.x;
  }
  return call.fail('vertical');
});

/* ------------------------------ Angle ------------------------------ */

function angleBetween(ux: number, uy: number, vx: number, vy: number): number {
  return wrapTau(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
}

export const anglePPPRule: CommandRule = rule((call) => {
  const a = P(call, 0);
  const b = P(call, 1);
  const c = P(call, 2);
  if (!sanePt(call, a) || !sanePt(call, b) || !sanePt(call, c)) return undefined;
  const u = { x: a.x - b.x, y: a.y - b.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  const scale = Math.max(1, Math.abs(b.x), Math.abs(b.y));
  if (norm2(u) <= call.tol * scale || norm2(v) <= call.tol * scale) return call.fail('zero_length');
  return angleBetween(u.x, u.y, v.x, v.y);
});

export const angleLLRule: CommandRule = rule((call) => {
  const a = lineLikeOf(call.values[0]) as LineLike;
  const b = lineLikeOf(call.values[1]) as LineLike;
  // Counter-clockwise from the first line to the second, wrapped to [0, pi) (points-lines 7).
  const cross = a.dx * b.dy - a.dy * b.dx;
  const dotp = a.dx * b.dx + a.dy * b.dy;
  let t = Math.atan2(cross, dotp);
  if (t < 0) t += Math.PI;
  // A turn within rounding of a half turn is no turn.
  return t >= Math.PI - 1e-15 ? 0 : t;
});

export const angleVVRule: CommandRule = rule((call) => {
  const u = P(call, 0);
  const v = P(call, 1);
  if (!sanePt(call, u) || !sanePt(call, v)) return undefined;
  if (norm2(u) <= call.tol || norm2(v) <= call.tol) return call.fail('zero_length');
  return angleBetween(u.x, u.y, v.x, v.y);
});

export const angleVRule: CommandRule = rule((call) => {
  const v = P(call, 0);
  if (!sanePt(call, v)) return undefined;
  if (norm2(v) <= call.tol) return call.fail('zero_length');
  return wrapTau(Math.atan2(v.y, v.x));
});

export const angleNRule: CommandRule = rule((call) => {
  const v = N(call, 0);
  if (!saneNum(call, v)) return undefined;
  return wrapTau(v);
});

/* ------------------------------ AffineRatio, CrossRatio ------------------------------ */

export const affineRatioRule: CommandRule = rule((call) => {
  const A = P(call, 0);
  const B = P(call, 1);
  const C = P(call, 2);
  if (!sanePt(call, A) || !sanePt(call, B) || !sanePt(call, C)) return undefined;
  const ab = { x: B.x - A.x, y: B.y - A.y };
  const scale = Math.max(1, norm2(A), norm2(B), norm2(C));
  if (norm2(ab) <= call.tol * scale) return call.fail('coincident_points');
  const side = Math.abs((C.x - A.x) * ab.y - (C.y - A.y) * ab.x) / norm2(ab);
  if (side > call.tol * scale) return call.fail('not_collinear');
  const ac = { x: C.x - A.x, y: C.y - A.y };
  return dot(ac, ab) / dot(ab, ab);
});

export const crossRatioRule: CommandRule = rule((call) => {
  const A = P(call, 0);
  const B = P(call, 1);
  const C = P(call, 2);
  const D = P(call, 3);
  if (!sanePt(call, A) || !sanePt(call, B) || !sanePt(call, C) || !sanePt(call, D)) return undefined;
  const lam = (P1: V2, P2: V2, P3: V2): number | undefined => {
    const d = { x: P2.x - P1.x, y: P2.y - P1.y };
    const scale = Math.max(1, norm2(P1), norm2(P2), norm2(P3));
    if (norm2(d) <= call.tol * scale) return undefined;
    const side = Math.abs((P3.x - P1.x) * d.y - (P3.y - P1.y) * d.x) / norm2(d);
    if (side > call.tol * scale) return undefined;
    const e = { x: P3.x - P1.x, y: P3.y - P1.y };
    return dot(e, d) / dot(d, d);
  };
  const l1 = lam(B, C, D);
  const l2 = lam(A, C, D);
  if (l1 === undefined || l2 === undefined) return call.fail('not_collinear');
  if (l2 === 0) return call.fail('division_by_zero');
  return l1 / l2;
});

/* ------------------------------ Relation ------------------------------ */

export const relationRule: CommandRule = rule((call) => {
  const tol = call.tol;
  const a = call.values[0];
  const b = call.values[1];
  const la = lineLikeOf(a);
  const lb = lineLikeOf(b);
  // Identical.
  if (la && lb) {
    const hit = intersectLineLine(la, lb, tol);
    if (hit.reason === 'coincident') return 'identical';
  }
  if (isPt(a) && isPt(b) && dist(a, b) <= tol * Math.max(1, norm2(a), norm2(b))) return 'identical';
  if (isCircleV(a) && isCircleV(b)) {
    if (dist({ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }) <= tol && Math.abs(a.r - b.r) <= tol * Math.max(1, a.r, b.r)) {
      return 'identical';
    }
  }
  // Parallel / perpendicular (line-likes and vectors).
  // A point (or vector) against a line is never compared by direction: it is tested for incidence below.
  const da = la ? { x: la.dx, y: la.dy } : isPt(a) ? dirOf(a) : undefined;
  const db = lb ? { x: lb.dx, y: lb.dy } : isPt(b) ? dirOf(b) : undefined;
  if (da && db && !!la === !!lb) {
    const cross = Math.abs(da.x * db.y - da.y * db.x);
    const dotp = Math.abs(da.x * db.x + da.y * db.y);
    if (cross <= tol) return 'parallel';
    if (dotp <= tol) return 'perpendicular';
  }
  // Incident (point on path).
  if (isPt(a) && pathOf(b)) {
    const path = pathOf(b) as Path;
    const pr = path.project(a);
    const scale = Math.max(1, norm2(a));
    if (pr.dist <= tol * scale) return 'incident';
  }
  if (isPt(b) && pathOf(a)) {
    const path = pathOf(a) as Path;
    const pr = path.project(b);
    const scale = Math.max(1, norm2(b));
    if (pr.dist <= tol * scale) return 'incident';
  }
  // Tangent (line and conic).
  if (la && (isConicV(b) || isCircleV(b))) {
    const c = toConic(b);
    if (c && dualConicTest(c, { a: la.a, b: la.b, c: la.c }, tol)) return 'tangent';
  }
  if (lb && (isConicV(a) || isCircleV(a))) {
    const c = toConic(a);
    if (c && dualConicTest(c, { a: lb.a, b: lb.b, c: lb.c }, tol)) return 'tangent';
  }
  // Equal lengths (segments).
  if (isSegmentV(a) && isSegmentV(b)) {
    if (relEq(dist(a.a, a.b), dist(b.a, b.b), tol)) return 'equal length';
  }
  // Intersecting.
  if (la && lb) {
    const hit = intersectLineLine(la, lb, tol);
    if (hit.p) return 'intersecting';
  }
  return 'separate';
});

function dirOf(v: V2): V2 | undefined {
  const l = norm2(v);
  if (!(l > 0)) return undefined;
  return { x: v.x / l, y: v.y / l };
}

/* ------------------------------ Predicates ------------------------------ */

/** Per-call tol override (last value when the form has one), or the figure tol. */
function predTol(call: RuleCall, base: number): number | undefined {
  if (call.values.length <= base) return call.tol;
  const t = call.values[base] as number;
  if (!(t > 0) || !Number.isFinite(t)) {
    call.fail('out_of_domain', 'tol must be a positive number');
    return undefined;
  }
  return t;
}

export const areCollinearRule: CommandRule = rule((call) => {
  const t = predTol(call, 3);
  if (t === undefined) return undefined;
  const a = P(call, 0);
  const b = P(call, 1);
  const c = P(call, 2);
  const scale = Math.max(1, dist(a, b), dist(b, c), dist(c, a));
  // Scale-aware: distance of c to line ab.
  const ab = dist(a, b);
  if (ab === 0) return dist(a, c) <= t * scale;
  const side = Math.abs((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / ab;
  return side <= t * scale;
});

export const areConcurrentRule: CommandRule = rule((call) => {
  const t = predTol(call, 3);
  if (t === undefined) return undefined;
  const a = lineLikeOf(call.values[0]) as LineLike;
  const b = lineLikeOf(call.values[1]) as LineLike;
  const c = lineLikeOf(call.values[2]) as LineLike;
  const hit = intersectLineLine(a, b, t);
  if (hit.reason === 'coincident') {
    const hit2 = intersectLineLine(a, c, t);
    return hit2.reason === 'coincident';
  }
  if (!hit.p) return false;
  const p = hit.p;
  return Math.abs(c.a * p.x + c.b * p.y - c.c) <= t * Math.max(1, Math.abs(c.c), norm2(p));
});

export const areParallelRule: CommandRule = rule((call) => {
  const t = predTol(call, 2);
  if (t === undefined) return undefined;
  const a = lineLikeOf(call.values[0]) as LineLike;
  const b = lineLikeOf(call.values[1]) as LineLike;
  return Math.abs(det2(a.a, a.b, b.a, b.b).value) <= t;
});

export const arePerpendicularRule: CommandRule = rule((call) => {
  const t = predTol(call, 2);
  if (t === undefined) return undefined;
  const a = lineLikeOf(call.values[0]) as LineLike;
  const b = lineLikeOf(call.values[1]) as LineLike;
  return Math.abs(a.dx * b.dx + a.dy * b.dy) <= t;
});

export const areConcyclicRule: CommandRule = rule((call) => {
  const t = predTol(call, 4);
  if (t === undefined) return undefined;
  const a = P(call, 0);
  const b = P(call, 1);
  const c = P(call, 2);
  const d = P(call, 3);
  // Circle through a, b, c; d on it.
  const d2 = 2 * det2(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y).value;
  const scale = Math.max(1, dist(a, b), dist(b, c), dist(c, a));
  if (Math.abs(d2) <= t * scale * scale) {
    // a, b, c collinear: concyclic iff d is also on the line.
    return (
      Math.abs((d.x - a.x) * (b.y - a.y) - (d.y - a.y) * (b.x - a.x)) <= t * scale * Math.max(1, dist(a, d))
    );
  }
  const bx = b.x - a.x;
  const by = b.y - a.y;
  const cx = c.x - a.x;
  const cy = c.y - a.y;
  const ux = ((bx * bx + by * by) * cy - (cx * cx + cy * cy) * by) / d2;
  const uy = ((cx * cx + cy * cy) * bx - (bx * bx + by * by) * cx) / d2;
  const r = Math.hypot(ux, uy);
  return Math.abs(Math.hypot(d.x - a.x - ux, d.y - a.y - uy) - r) <= t * Math.max(1, r);
});

export const areEqualRule: CommandRule = rule((call) => {
  const t = predTol(call, 2);
  if (t === undefined) return undefined;
  return valuesEqual(call.values[0], call.values[1], t);
});

function valuesEqual(a: unknown, b: unknown, t: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') return relEq(a, b, t);
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b;
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (isPt(a) && isPt(b)) return dist(a, b) <= t * Math.max(1, norm2(a), norm2(b));
  if (isLineV(a) && isLineV(b)) {
    const la = Math.hypot(a.a, a.b) || 1;
    const lb = Math.hypot(b.a, b.b) || 1;
    const na = { a: a.a / la, b: a.b / la, c: a.c / la };
    const nb = { a: b.a / lb, b: b.b / lb, c: b.c / lb };
    const s = na.a * nb.a + na.b * nb.b >= 0 ? 1 : -1;
    return (
      Math.abs(na.a - s * nb.a) <= t && Math.abs(na.b - s * nb.b) <= t && Math.abs(na.c - s * nb.c) <= t * Math.max(1, Math.abs(na.c))
    );
  }
  if (isSegmentV(a) && isSegmentV(b)) {
    const sc = Math.max(1, norm2(a.a), norm2(a.b), norm2(b.a), norm2(b.b));
    return (
      (dist(a.a, b.a) <= t * sc && dist(a.b, b.b) <= t * sc) ||
      (dist(a.a, b.b) <= t * sc && dist(a.b, b.a) <= t * sc)
    );
  }
  if (isRayV(a) && isRayV(b)) {
    const sc = Math.max(1, norm2(a.from), norm2(b.from));
    return dist(a.from, b.from) <= t * sc && dist(a.dir, b.dir) <= t;
  }
  if (isCircleV(a) && isCircleV(b)) {
    return dist({ x: a.cx, y: a.cy }, { x: b.cx, y: b.cy }) <= t && relEq(a.r, b.r, t);
  }
  if (isConicV(a) && isConicV(b)) {
    if (a.kind !== b.kind) return false;
    const x = [a.q.A, a.q.B, a.q.C, a.q.D, a.q.E, a.q.F];
    const y = [b.q.A, b.q.B, b.q.C, b.q.D, b.q.E, b.q.F];
    return x.every((v, i) => Math.abs(v - (y[i] as number)) <= t * 8);
  }
  if (isArcV(a) && isArcV(b)) {
    return valuesEqual(a.conic, b.conic, t) && Math.abs(wrapPi(a.from - b.from)) <= t && Math.abs(a.sweep - b.sweep) <= t;
  }
  if (isPolygonV(a) && isPolygonV(b)) {
    if (a.pts.length !== b.pts.length) return false;
    const sc = Math.max(1, ...a.pts.map(norm2), ...b.pts.map(norm2));
    return a.pts.every((p, i) => dist(p, (b.pts as V2[])[i] as V2) <= t * sc);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => (x === undefined || b[i] === undefined ? x === b[i] : valuesEqual(x, b[i], t)));
  }
  return false;
}

export const areCongruentRule: CommandRule = rule((call) => {
  const t = predTol(call, 2);
  if (t === undefined) return undefined;
  return valuesCongruent(call.values[0], call.values[1], t);
});

function valuesCongruent(a: unknown, b: unknown, t: number): boolean {
  if (isPt(a) && isPt(b)) return true;
  if (isLineV(a) && isLineV(b)) return true;
  if (isSegmentV(a) && isSegmentV(b)) return relEq(dist(a.a, a.b), dist(b.a, b.b), t);
  if (isCircleV(a) && isCircleV(b)) return relEq(a.r, b.r, t);
  if (isArcV(a) && isArcV(b)) {
    const ca = centralParams(a.conic);
    const cb = centralParams(b.conic);
    if (!ca || !cb) return false;
    return relEq(ca.a, cb.a, t) && relEq(ca.b, cb.b, t) && Math.abs(a.sweep - b.sweep) <= t;
  }
  if (isPolygonV(a) && isPolygonV(b)) {
    if (a.pts.length !== b.pts.length) return false;
    const n = a.pts.length;
    const sides = (pts: readonly V2[]): number[] => pts.map((p, i) => dist(p, pts[(i + 1) % n] as V2));
    const sa = sides(a.pts);
    const sb = sides(b.pts);
    const sc = Math.max(1, ...sa, ...sb);
    const match = (off: number, rev: boolean): boolean => {
      for (let i = 0; i < n; i++) {
        const j = rev ? (off - i + n * 2) % n : (off + i) % n;
        if (Math.abs((sa[i] as number) - (sb[j] as number)) > t * sc) return false;
      }
      return true;
    };
    for (let off = 0; off < n; off++) {
      if (match(off, false) || match(off, true)) return true;
    }
    return false;
  }
  return valuesEqual(a, b, t);
}

export const onPathRule: CommandRule = rule((call) => {
  const hasTol = call.values.length > 2;
  const t = hasTol ? predTol(call, 2) : call.tol;
  if (t === undefined) return undefined;
  const p = P(call, 0);
  const path = pathOf(call.values[1]);
  if (!path) return call.fail('out_of_domain', 'not a path');
  if (!sanePt(call, p)) return undefined;
  return path.project(p).dist <= t * Math.max(1, norm2(p));
});

export const inRegionRule: CommandRule = rule((call) => {
  const hasTol = call.values.length > 2;
  const t = hasTol ? predTol(call, 2) : call.tol;
  if (t === undefined) return undefined;
  const p = P(call, 0);
  const r = regionOf(call.values[1]);
  if (!r) return call.fail('wrong_kind', 'needs a polygon, circle, ellipse or sector interior');
  if (!sanePt(call, p)) return undefined;
  return pointInRegion(p, r, t);
});

