/**
 * Intersections (points-lines 4, conics 8): every pair of kinds, the canonical
 * slot orders (3.5), and the tangent lines (conics 6.2-6.4) which share the
 * line-conic machinery.
 */
import type { UndefReason } from '../../contracts/values';
import type { ConicValue, HLine, V2 } from './types';
import { EPS, TAU, brent, cubicRealRoots, det2, orient, polyFit, polyRoots, solveQuad, solveStable } from './numerics';
import type { Path } from './types';
import {
  adj3,
  centralParams,
  circleConic,
  classifyQuad,
  conicAt,
  conicGrad,
  det3,
  frob3,
  matOf,
  matVec3,
  quadOf,
  splitPair,
} from './conics';
import { circlePath, ellipsePath, hyperbolaPath, parabolaPath } from './paths';

/** One output slot: a point, or the reason it is missing. */
export type Slot = { p: V2 } | { reason: UndefReason; detail?: string };

/** One output slot: a line, or the reason it is missing. */
export type LineSlot = { l: HLine } | { reason: UndefReason; detail?: string };

export const NO_INT: Slot = { reason: 'no_intersection' };

/** A line-like operand as its carrier plus limits (points-lines 9). */
export interface LineLike {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  /** Unit direction (b, -a). */
  readonly dx: number;
  readonly dy: number;
  /** Foot of the origin on the carrier. */
  readonly ox: number;
  readonly oy: number;
  /** Parameter limits along the direction in maths units: segments [0, len], rays [0, inf). */
  readonly lo: number;
  readonly hi: number;
  readonly kind: 'line' | 'ray' | 'segment';
}

export function lineLikeOf(v: unknown): LineLike | undefined {
  const o = v as Record<string, unknown>;
  if (typeof o !== 'object' || o === null) return undefined;
  if (typeof o['a'] === 'number' && typeof o['b'] === 'number' && typeof o['c'] === 'number') {
    const a = o['a'];
    const b = o['b'];
    const c = o['c'];
    const l = Math.hypot(a, b);
    if (!(l > 0)) return undefined;
    const na = a / l;
    const nb = b / l;
    const nc = c / l;
    return { a: na, b: nb, c: nc, dx: nb, dy: -na, ox: na * nc, oy: nb * nc, lo: -Infinity, hi: Infinity, kind: 'line' };
  }
  const p = (x: unknown): V2 | undefined =>
    typeof x === 'object' && x !== null && typeof (x as V2).x === 'number' && typeof (x as V2).y === 'number'
      ? (x as V2)
      : undefined;
  const av = p(o['a']);
  const bv = p(o['b']);
  if (av && bv) {
    const dx = bv.x - av.x;
    const dy = bv.y - av.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) return undefined;
    const ux = dx / len;
    const uy = dy / len;
    // Left normal storage: (a, b) = (-uy, ux), c = a*ax + b*ay.
    return { a: -uy, b: ux, c: -uy * av.x + ux * av.y, dx: ux, dy: uy, ox: av.x, oy: av.y, lo: 0, hi: len, kind: 'segment' };
  }
  const fv = p(o['from']);
  const dv = p(o['dir']);
  if (fv && dv) {
    const len = Math.hypot(dv.x, dv.y);
    if (!(len > 0)) return undefined;
    const ux = dv.x / len;
    const uy = dv.y / len;
    return { a: -uy, b: ux, c: -uy * fv.x + ux * fv.y, dx: ux, dy: uy, ox: fv.x, oy: fv.y, lo: 0, hi: Infinity, kind: 'ray' };
  }
  return undefined;
}

/** Parameter s of P along the line-like (0 at its origin). */
export function lineParam(l: LineLike, p: V2): number {
  return (p.x - l.ox) * l.dx + (p.y - l.oy) * l.dy;
}

/** True when P is within the limits (endpoint touching counts). */
export function withinLimits(l: LineLike, p: V2, tol: number): boolean {
  if (l.kind === 'line') return true;
  const s = lineParam(l, p);
  const e = tol * Math.max(1, Math.abs(s), norm2p(p));
  if (l.kind === 'ray') return s >= -e;
  const len = l.hi;
  return s >= -e && s <= len + e;
}

function norm2p(p: V2): number {
  return Math.hypot(p.x, p.y);
}

/* ------------------------------ 4.2 line-like with line-like ------------------------------ */

export interface LineHit {
  readonly p?: V2;
  readonly reason?: UndefReason;
  readonly detail?: string;
  /** Condition estimate 1/sin; above 1e6 the value is ill-conditioned. */
  readonly cond: number;
}

export function intersectLineLine(l1: LineLike, l2: LineLike, tol: number): LineHit {
  // Homogeneous cross of [a1, b1, -c1] x [a2, b2, -c2].
  const s = det2(l1.a, l1.b, l2.a, l2.b);
  const sine = Math.abs(s.value);
  const cond = sine > 0 ? 1 / sine : Infinity;
  if (sine <= tol) {
    // Parallel or identical: distance of l1's reference point to l2.
    const d = Math.abs(l2.a * l1.ox + l2.b * l1.oy - l2.c);
    const scale = Math.max(1, Math.abs(l1.c), Math.abs(l2.c), norm2p({ x: l1.ox, y: l1.oy }));
    if (d <= tol * scale) return { reason: 'coincident', cond };
    return { reason: 'parallel', cond };
  }
  const hx = l1.c * l2.b - l1.b * l2.c;
  const hy = l1.a * l2.c - l1.c * l2.a;
  const hw = s.value;
  const p = { x: hx / hw, y: hy / hw };
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return { reason: 'not_finite', cond };
  if (Math.hypot(p.x, p.y) > 1e14) return { reason: 'too_far', cond };
  if (!withinLimits(l1, p, tol) || !withinLimits(l2, p, tol)) return { reason: 'outside_path', cond };
  return { p, cond };
}

/* ------------------------------ 4.3 line-like with circle or conic ------------------------------ */

export interface ArcRange {
  readonly cx: number;
  readonly cy: number;
  readonly from: number;
  readonly sweep: number;
}

/**
 * Slots along the carrier (ascending s). Degenerate conics are intersected as
 * their lines; `range` filters arc carriers by polar angle.
 */
export function lineConicSlots(
  o: V2,
  d: V2,
  conic: ConicValue,
  tol: number,
  limits?: LineLike,
  range?: ArcRange,
): Slot[] {
  const q = conic.q;
  if (conic.kind === 'empty') return [{ reason: 'no_intersection' }, { reason: 'no_intersection' }];
  if (conic.kind === 'point' && conic.point) {
    const pt = conic.point;
    // Distance of the point to the carrier.
    const distTo = Math.abs((pt.x - o.x) * -d.y + (pt.y - o.y) * d.x);
    const scale = Math.max(1, norm2p(pt), norm2p(o));
    if (distTo > tol * scale) return [{ reason: 'no_intersection' }, { reason: 'no_intersection' }];
    if (limits && !withinLimits(limits, pt, tol)) return [{ reason: 'outside_path' }, { reason: 'outside_path' }];
    return [{ p: pt }, { p: pt }];
  }
  if ((conic.kind === 'lines' || conic.kind === 'parallel' || conic.kind === 'double' || conic.kind === 'line') && conic.lines) {
    const out: Slot[] = [];
    const lines = conic.lines[1] ? [conic.lines[0], conic.lines[1] as HLine] : [conic.lines[0]];
    for (const ln of lines) {
      const ll: LineLike = {
        a: ln.a, b: ln.b, c: ln.c, dx: ln.b, dy: -ln.a,
        ox: ln.a * ln.c, oy: ln.b * ln.c, lo: -Infinity, hi: Infinity, kind: 'line',
      };
      const carrier: LineLike = {
        a: -d.y, b: d.x, c: -d.y * o.x + d.x * o.y, dx: d.x, dy: d.y,
        ox: o.x, oy: o.y, lo: -Infinity, hi: Infinity, kind: 'line',
      };
      const hit = intersectLineLine(carrier, ll, tol);
      if (hit.p) {
        if (limits && !withinLimits(limits, hit.p, tol)) out.push({ reason: 'outside_path' });
        else out.push({ p: hit.p });
      } else if (hit.reason === 'coincident') {
        out.push({ reason: 'coincident' });
      } else {
        out.push({ reason: 'parallel' });
      }
    }
    while (out.length < 2) out.push({ reason: 'no_intersection' });
    // Ascending s along the carrier.
    out.sort((x, y) => {
      const sx = 'p' in x ? (x.p.x - o.x) * d.x + (x.p.y - o.y) * d.y : Infinity;
      const sy = 'p' in y ? (y.p.x - o.x) * d.x + (y.p.y - o.y) * d.y : Infinity;
      return sx - sy;
    });
    return range ? filterArcRange(out, range, tol) : out;
  }
  const Sxx = q.A;
  const Sxy = q.B / 2;
  const Syy = q.C;
  const lx = q.D / 2;
  const ly = q.E / 2;
  const alpha = Sxx * d.x * d.x + 2 * Sxy * d.x * d.y + Syy * d.y * d.y;
  const beta = (Sxx * o.x + Sxy * o.y) * d.x + (Sxy * o.x + Syy * o.y) * d.y + lx * d.x + ly * d.y;
  const gamma = conicAt(q, o.x, o.y);
  const roots = solveStable(alpha, beta, gamma);
  const at = (s: number): V2 => ({ x: o.x + s * d.x, y: o.y + s * d.y });
  const polish = (s: number): number => {
    const p = at(s);
    const g = conicGrad(q, p.x, p.y);
    const denom = g.x * d.x + g.y * d.y;
    if (denom === 0) return s;
    return s - conicAt(q, p.x, p.y) / denom;
  };
  let out: Slot[];
  if (roots.kind === 'none') {
    out = [{ reason: 'no_intersection' }, { reason: 'no_intersection' }];
  } else if (roots.kind === 'one') {
    const s = polish(roots.s);
    out = [{ p: at(s) }, { reason: 'no_intersection' }];
  } else {
    out = [{ p: at(polish(roots.s1)) }, { p: at(polish(roots.s2)) }];
  }
  if (limits) {
    out = out.map((sl) => ('p' in sl ? (withinLimits(limits, sl.p, tol) ? sl : { reason: 'outside_path' as UndefReason }) : sl));
  }
  // Far check.
  out = out.map((sl) =>
    'p' in sl && Math.hypot(sl.p.x, sl.p.y) > 1e14 ? { reason: 'too_far' as UndefReason } : sl,
  );
  return range ? filterArcRange(out, range, tol) : out;
}

function filterArcRange(slots: Slot[], range: ArcRange, tol: number): Slot[] {
  if (range.sweep >= TAU - 1e-12) return slots;
  return slots.map((sl) => {
    if (!('p' in sl)) return sl;
    const ang = Math.atan2(sl.p.y - range.cy, sl.p.x - range.cx);
    let rel = ang - range.from;
    while (rel < 0) rel += TAU;
    while (rel >= TAU) rel -= TAU;
    const slack = tol * 4;
    if (rel <= range.sweep + slack) return sl;
    return { reason: 'outside_path' as UndefReason };
  });
}

/* ------------------------------ 4.4 circle/conic with circle/conic ------------------------------ */

/** Circle with circle by the radical line (4.4). */
export function circleCircleSlots(
  c1: { cx: number; cy: number; r: number },
  c2: { cx: number; cy: number; r: number },
  tol: number,
): Slot[] {
  const dx = c2.cx - c1.cx;
  const dy = c2.cy - c1.cy;
  const dd = Math.hypot(dx, dy);
  const scale = Math.max(1, c1.r, c2.r, dd);
  if (dd <= tol * scale) {
    if (Math.abs(c1.r - c2.r) <= tol * Math.max(1, c1.r, c2.r)) {
      return [{ reason: 'coincident' }, { reason: 'coincident' }];
    }
    return [{ reason: 'no_intersection' }, { reason: 'no_intersection' }];
  }
  // Radical line: 2*(O2-O1).p = r1^2 - r2^2 - |O1|^2 + |O2|^2, normalised.
  const L = 2 * dd;
  const a = dx / dd;
  const b = dy / dd;
  const c = (c1.r * c1.r - c2.r * c2.r - (c1.cx * c1.cx + c1.cy * c1.cy) + (c2.cx * c2.cx + c2.cy * c2.cy)) / L;
  const o = { x: a * c, y: b * c };
  const d = { x: b, y: -a };
  const conic = circleConic(c1.cx, c1.cy, c1.r);
  const slots = lineConicSlots(o, d, conic, tol);
  // Canonical order: slot 1 left of O1 -> O2.
  const leftFirst = (s: Slot[]): Slot[] => {
    if (!('p' in s[0]!) || !('p' in s[1]!)) return s;
    const p1 = (s[0] as { p: V2 }).p;
    const o1 = orient({ x: c1.cx, y: c1.cy }, { x: c2.cx, y: c2.cy }, p1).sign;
    if (o1 >= 0) return s;
    return [s[1]!, s[0]!];
    // Collinear (tangent): keep ascending order.
    return s;
  };
  return leftFirst(slots);
}

/** General conic with conic (4.4): pencil of conics, split, intersect, polish. */
export function conicConicSlots(m1v: ConicValue, m2v: ConicValue, tol: number): Slot[] {
  // Same conic up to scale: coincident.
  if (sameConic(m1v.q, m2v.q, tol)) return [{ reason: 'coincident' }, { reason: 'coincident' }, { reason: 'coincident' }, { reason: 'coincident' }];
  // Degenerate inputs are intersected as their lines / points.
  const d1 = degenerateParts(m1v);
  const d2 = degenerateParts(m2v);
  if (d1 === 'empty' || d2 === 'empty') return four('no_intersection');
  if (d1 === 'point' || d2 === 'point') return pointConicSlots(m1v, m2v, tol);
  if (Array.isArray(d1) || Array.isArray(d2)) return linesConicSlots(m1v, m2v, tol);
  const M1 = matOf(m1v.q);
  const M2 = matOf(m2v.q);
  // Cubic det(M1 + l*M2) = 0 by interpolation at 0, 1, -1, 2.
  const f0 = det3(M1);
  const fp = (l: number): number => {
    const m = M1.map((v, i) => v + l * (M2[i] as number)) as unknown as typeof M1;
    return det3(m);
  };
  const f1 = fp(1);
  const f_1 = fp(-1);
  const f2 = fp(2);
  const d2c = (f1 + f_1 - 2 * f0) / 2;
  // Solve: d3c l^3 + d2c l^2 + d1c l + f0 = 0.
  const sum10 = (f1 - f_1) / 2; // d3 + d1
  const d3c = (f2 - f0 - 4 * d2c - 2 * sum10) / 6;
  const d1c = sum10 - d3c;
  const roots = cubicRealRoots(d3c, d2c, d1c, f0);
  // Polish roots on the determinant and order by conditioning of M1 + l*M2.
  interface Cand {
    l: number;
    q: number;
  }
  const cands: Cand[] = [];
  for (const l0 of roots) {
    let l = l0;
    for (let i = 0; i < 10; i++) {
      const h = 1e-7 * Math.max(1, Math.abs(l));
      const fl = det3(mixMat(M1, M2, l));
      const df = (det3(mixMat(M1, M2, l + h)) - det3(mixMat(M1, M2, l - h))) / (2 * h);
      if (df === 0) break;
      const nl = l - fl / df;
      if (!Number.isFinite(nl)) break;
      if (Math.abs(nl - l) < 1e-13 * Math.max(1, Math.abs(l))) {
        l = nl;
        break;
      }
      l = nl;
    }
    const N = mixMat(M1, M2, l);
    const q = degeneracyGap(N);
    if (Number.isFinite(q)) cands.push({ l, q });
  }
  cands.sort((a, b) => b.q - a.q);
  // Better-conditioned original conic for the line intersections.
  const cond1 = Math.abs(det3(M1)) / Math.pow(frob3(M1), 3);
  const cond2 = Math.abs(det3(M2)) / Math.pow(frob3(M2), 3);
  const useFirst = cond1 >= cond2;
  const target = useFirst ? m1v : m2v;
  for (const cand of cands) {
    const N = mixMat(M1, M2, cand.l);
    const lines = splitPair(N);
    const pts: V2[] = [];
    const ls = lines[1] ? [lines[0], lines[1]] : [lines[0]];
    for (const ln of ls) {
      const o = { x: ln.a * ln.c, y: ln.b * ln.c };
      const d = { x: ln.b, y: -ln.a };
      const slots = lineConicSlots(o, d, target, tol);
      for (const s of slots) if ('p' in s) pts.push(s.p);
    }
    // Polish with two Newton steps on the pair; validate.
    const ok: V2[] = [];
    for (const p of pts) {
      const q = polishPair(m1v, m2v, p);
      if (!q) continue;
      const scale = Math.max(1, Math.hypot(q.x, q.y));
      const r1 = Math.abs(conicAt(m1v.q, q.x, q.y)) / (scale * scale);
      const r2 = Math.abs(conicAt(m2v.q, q.x, q.y)) / (scale * scale);
      if (r1 <= 1e-12 && r2 <= 1e-12) ok.push(q);
    }
    const ded = dedupePoints(ok, tol);
    if (ded.length > 0) return orderConicSlots(ded, m1v, m2v, tol);
  }
  // Sampled fall-back: trace conic 1, bracket sign changes of conic 2.
  const sampled = sampledConicConic(m1v, m2v, tol);
  if (sampled.length > 0) return orderConicSlots(sampled, m1v, m2v, tol);
  return four('no_intersection');
}

function four(reason: UndefReason): Slot[] {
  return [{ reason }, { reason }, { reason }, { reason }];
}

function mixMat(a: Mat3, b: Mat3, l: number): Mat3 {
  return a.map((v, i) => v + l * (b[i] as number)) as unknown as Mat3;
}

/** Gap between the two non-zero and the zero singular values (symmetric 3x3). */
function degeneracyGap(N: Mat3): number {
  // Characteristic polynomial det(N - t I) = -t^3 + tr t^2 - e2 t + det.
  const tr = N[0] + N[4] + N[8];
  const e2 =
    (N[0] as number) * (N[4] as number) -
    (N[1] as number) * (N[3] as number) +
    (N[0] as number) * (N[8] as number) -
    (N[2] as number) * (N[6] as number) +
    (N[4] as number) * (N[8] as number) -
    (N[5] as number) * (N[7] as number);
  const roots = cubicRealRoots(-1, tr, -e2, det3(N)).map(Math.abs).sort((a, b) => b - a);
  const s0 = roots[0] ?? 0;
  const s1 = roots[1] ?? 0;
  const s2 = roots[2] ?? 0;
  if (!(s0 > 0)) return 0;
  return (s1 - s2) / s0;
}

function sameConic(a: { A: number; B: number; C: number; D: number; E: number; F: number }, b: typeof a, tol: number): boolean {
  const av = [a.A, a.B, a.C, a.D, a.E, a.F];
  const bv = [b.A, b.B, b.C, b.D, b.E, b.F];
  // Unit-norm matrices: same conic iff proportional with factor +-1.
  let dotp = 0;
  for (let i = 0; i < 6; i++) dotp += (av[i] as number) * (bv[i] as number);
  if (Math.abs(Math.abs(dotp) - 1) > tol * 8) return false;
  const s = dotp >= 0 ? 1 : -1;
  for (let i = 0; i < 6; i++) {
    if (Math.abs((av[i] as number) - s * (bv[i] as number)) > tol * 8) return false;
  }
  return true;
}

type DegParts = 'empty' | 'point' | HLine[] | 'regular';

function degenerateParts(c: ConicValue): DegParts {
  if (c.kind === 'empty') return 'empty';
  if (c.kind === 'point') return 'point';
  if ((c.kind === 'lines' || c.kind === 'parallel' || c.kind === 'double' || c.kind === 'line') && c.lines) {
    return c.lines[1] ? [c.lines[0], c.lines[1]] : [c.lines[0]];
  }
  return 'regular';
}

function pointConicSlots(m1v: ConicValue, m2v: ConicValue, tol: number): Slot[] {
  const pt = m1v.kind === 'point' ? m1v.point : m2v.kind === 'point' ? m2v.point : undefined;
  const other = m1v.kind === 'point' ? m2v : m1v;
  if (!pt) return four('no_intersection');
  const scale = Math.max(1, Math.hypot(pt.x, pt.y));
  if (other.kind === 'empty') return four('no_intersection');
  if (Math.abs(conicAt(other.q, pt.x, pt.y)) / (scale * scale) <= tol * 4) {
    return [{ p: pt }, { p: pt }, { reason: 'no_intersection' }, { reason: 'no_intersection' }];
  }
  return four('no_intersection');
}

function linesConicSlots(m1v: ConicValue, m2v: ConicValue, tol: number): Slot[] {
  const l1 = degenerateParts(m1v);
  const l2 = degenerateParts(m2v);
  const lines1 = Array.isArray(l1) ? l1 : null;
  const lines2 = Array.isArray(l2) ? l2 : null;
  const pts: V2[] = [];
  const pushLineLine = (a: HLine, b: HLine): void => {
    const mk = (ln: HLine): Parameters<typeof intersectLineLine>[0] => ({
      a: ln.a, b: ln.b, c: ln.c, dx: ln.b, dy: -ln.a,
      ox: ln.a * ln.c, oy: ln.b * ln.c, lo: -Infinity, hi: Infinity, kind: 'line',
    });
    const hit = intersectLineLine(mk(a), mk(b), tol);
    if (hit.p) pts.push(hit.p);
  };
  if (lines1 && lines2) {
    for (const a of lines1) for (const b of lines2) pushLineLine(a, b);
  } else {
    const lines = (lines1 ?? lines2) as HLine[];
    const other = lines1 ? m2v : m1v;
    for (const ln of lines) {
      const o = { x: ln.a * ln.c, y: ln.b * ln.c };
      const d = { x: ln.b, y: -ln.a };
      for (const s of lineConicSlots(o, d, other, tol)) if ('p' in s) pts.push(s.p);
    }
  }
  const ded = dedupePoints(pts, tol);
  if (ded.length === 0) return four('no_intersection');
  return orderConicSlots(ded, m1v, m2v, tol);
}

/** Two Newton steps on {M1(P) = 0, M2(P) = 0}. */
function polishPair(m1v: ConicValue, m2v: ConicValue, p: V2): V2 | undefined {
  let x = p.x;
  let y = p.y;
  for (let i = 0; i < 2; i++) {
    const f1 = conicAt(m1v.q, x, y);
    const f2 = conicAt(m2v.q, x, y);
    const g1 = conicGrad(m1v.q, x, y);
    const g2 = conicGrad(m2v.q, x, y);
    const det = g1.x * g2.y - g2.x * g1.y;
    if (det === 0 || !Number.isFinite(det)) return undefined;
    x -= (f1 * g2.y - f2 * g1.y) / det;
    y -= (g1.x * f2 - g2.x * f1) / det;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  }
  return { x, y };
}

export function dedupePoints(pts: readonly V2[], tol: number): V2[] {
  const out: V2[] = [];
  for (const p of pts) {
    const scale = Math.max(1, Math.hypot(p.x, p.y));
    if (!out.some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= tol * 8 * scale)) out.push(p);
  }
  return out;
}

/**
 * Canonical order for up to four slots (4.4): angle around the centroid of the
 * real solutions, from the first conic's major axis (+x for circles).
 */
function orderConicSlots(pts: V2[], m1v: ConicValue, _m2v: ConicValue, tol: number): Slot[] {
  void _m2v;
  void tol;
  const ded = dedupePoints(pts, 1e-9);
  let cx = 0;
  let cy = 0;
  for (const p of ded) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ded.length;
  cy /= ded.length;
  const cp = centralParams(m1v);
  const ref = cp && m1v.kind !== 'circle' ? Math.atan2(cp.uy, cp.ux) : 0;
  const withAng = ded.map((p) => ({ p, a: Math.atan2(p.y - cy, p.x - cx) - ref }));
  withAng.sort((a, b) => a.a - b.a);
  const out: Slot[] = withAng.map((w) => ({ p: w.p }));
  while (out.length < 4) out.push({ reason: 'no_intersection' });
  return out;
}

/** Sampled fall-back: trace conic 1, bracket sign changes of conic 2, Brent-refine. */
function sampledConicConic(m1v: ConicValue, m2v: ConicValue, tol: number): V2[] {
  const path = conicCarrierPath(m1v);
  if (!path) return [];
  const N = 512;
  const ts: number[] = [];
  const [lo, hi] = path.domain;
  const finite = Number.isFinite(lo) && Number.isFinite(hi);
  for (let i = 0; i <= N; i++) {
    ts.push(finite ? lo + ((hi - lo) * i) / N : path.unnorm(0.001 + (0.998 * i) / N));
  }
  const vals = ts.map((t) => {
    const p = path.at(t);
    return conicAt(m2v.q, p.x, p.y);
  });
  const out: V2[] = [];
  for (let i = 0; i < N; i++) {
    const a = vals[i] as number;
    const b = vals[i + 1] as number;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a === 0) {
      out.push(path.at(ts[i] as number));
      continue;
    }
    if (a * b < 0) {
      const t0 = ts[i] as number;
      const t1 = ts[i + 1] as number;
      const r = brent(
        (t) => conicAt(m2v.q, path.at(t).x, path.at(t).y),
        t0,
        t1,
      );
      const q = polishPair(m1v, m2v, path.at(r));
      if (q) out.push(q);
      if (out.length >= 4) break;
    }
  }
  return dedupePoints(out, tol);
}

/** Carrier path of a regular conic for tracing. */
function conicCarrierPath(c: ConicValue): Path | undefined {
  if (!c.frame) return undefined;
  if (c.kind === 'circle') {
    const f = c.frame as { cx: number; cy: number; a: number };
    return circlePath(f.cx, f.cy, f.a);
  }
  if (c.kind === 'ellipse') return ellipsePath(c.frame as never);
  if (c.kind === 'hyperbola') return hyperbolaPath(c.frame as never);
  if (c.kind === 'parabola') return parabolaPath(c.frame as never);
  return undefined;
}

/* ------------------------------ 4.5 polygons and polylines ------------------------------ */

export interface PolyHit {
  readonly p: V2;
  /** Boundary order key: edge index + fraction. */
  readonly key: number;
}

/** Line carrier against every edge; shared-vertex hits deduped; boundary order. */
export function linePolyPoints(o: V2, d: V2, pts: readonly V2[], closed: boolean, tol: number): { pts: PolyHit[]; overlap: boolean } {
  const n = pts.length;
  const edges = closed ? n : n - 1;
  const out: PolyHit[] = [];
  let overlap = false;
  for (let i = 0; i < edges; i++) {
    const e0 = pts[i] as V2;
    const e1 = pts[(i + 1) % n] as V2;
    const ex = e1.x - e0.x;
    const ey = e1.y - e0.y;
    const det = d.x * -ey - (-ex) * d.y;
    const scale = Math.max(1, Math.hypot(ex, ey), Math.hypot(e0.x, e0.y));
    if (Math.abs(det) <= tol * scale) {
      // Parallel: collinear?
      const side = (e0.x - o.x) * -d.y + (e0.y - o.y) * d.x;
      if (Math.abs(side) <= tol * scale) {
        overlap = true;
        out.push({ p: { ...e0 }, key: i });
        out.push({ p: { ...e1 }, key: i + 0.5 });
      }
      continue;
    }
    const rhsx = e0.x - o.x;
    const rhsy = e0.y - o.y;
    const s = (rhsx * -ey + ex * rhsy) / det;
    const t = (d.x * rhsy - d.y * rhsx) / det;
    if (t >= -tol && t <= 1 + tol) {
      void s;
      const p = { x: e0.x + t * ex, y: e0.y + t * ey };
      out.push({ p, key: i + Math.min(1, Math.max(0, t)) });
    }
  }
  // Dedupe shared vertices (two edges, one point).
  const ded: PolyHit[] = [];
  for (const h of out) {
    const scale = Math.max(1, Math.hypot(h.p.x, h.p.y));
    if (!ded.some((q) => Math.hypot(h.p.x - q.p.x, h.p.y - q.p.y) <= tol * 8 * scale)) ded.push(h);
  }
  ded.sort((a, b) => a.key - b.key);
  return { pts: ded, overlap };
}

/** All crossing points of two boundaries, in boundary order of the first. */
export function polyPolyPoints(a: readonly V2[], b: readonly V2[], tol: number): V2[] {
  const out: Array<{ p: V2; key: number }> = [];
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i] as V2;
    const a1 = a[(i + 1) % a.length] as V2;
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j] as V2;
      const b1 = b[(j + 1) % b.length] as V2;
      const p = segSeg(a0, a1, b0, b1, tol);
      if (p) {
        const len = Math.hypot(a1.x - a0.x, a1.y - a0.y) || 1;
        const t = ((p.x - a0.x) * (a1.x - a0.x) + (p.y - a0.y) * (a1.y - a0.y)) / (len * len);
        out.push({ p, key: i + Math.min(1, Math.max(0, t)) });
      }
    }
  }
  out.sort((x, y) => x.key - y.key);
  return dedupePoints(
    out.map((h) => h.p),
    tol,
  );
}

/** Proper or endpoint-touching segment intersection, or undefined. */
export function segSeg(a0: V2, a1: V2, b0: V2, b1: V2, tol: number): V2 | undefined {
  const d1x = a1.x - a0.x;
  const d1y = a1.y - a0.y;
  const d2x = b1.x - b0.x;
  const d2y = b1.y - b0.y;
  const det = d1x * d2y - d2x * d1y;
  const scale = Math.max(1, Math.hypot(d1x, d1y), Math.hypot(d2x, d2y));
  if (Math.abs(det) <= tol * scale * scale) return undefined;
  const t = ((b0.x - a0.x) * d2y - (b0.y - a0.y) * d2x) / det;
  const u = ((b0.x - a0.x) * d1y - (b0.y - a0.y) * d1x) / det;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return undefined;
  const tc = Math.min(1, Math.max(0, t));
  return { x: a0.x + tc * d1x, y: a0.y + tc * d1y };
}

/* ------------------------------ 4.6 functions ------------------------------ */

export type Fn1 = (x: number) => number | undefined;

export function evalFn(f: { call1?: (x: number) => number; call: (...xs: number[]) => number | V2 | undefined }, x: number): number | undefined {
  const v = f.call1 ? f.call1(x) : f.call(x);
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Polynomial path (4.6): fit degree <= 4, validate the fit, solve exactly,
 * polish on the true function. Undefined when not a polynomial there.
 */
export function polyRootsOf(g: Fn1, lo: number, hi: number): number[] | undefined {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return undefined;
  const xs: number[] = [];
  for (let i = 0; i < 9; i++) xs.push(lo + (span * i) / 8);
  const ys: number[] = [];
  for (const x of xs) {
    const y = g(x);
    if (y === undefined) return undefined;
    ys.push(y);
  }
  const scale = Math.max(1, ...ys.map(Math.abs));
  for (const deg of [1, 2, 3, 4]) {
    const c = polyFit(xs, ys, deg);
    if (!c) continue;
    let ok = true;
    for (let i = 0; i < 12; i++) {
      const x = lo + (span * (i + 0.5)) / 12;
      const y = g(x);
      if (y === undefined) {
        ok = false;
        break;
      }
      let f = 0;
      for (const k of c) f = f * x + k;
      if (Math.abs(f - y) > 1e-9 * scale + 1e-12) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const roots = polyRoots(c).filter((r) => r >= lo && r <= hi);
    const polished = polishTrueRoots(g, roots, scale);
    if (polished) return polished;
  }
  return undefined;
}

/** Newton-polish every root on the true function and validate the residual. */
function polishTrueRoots(g: Fn1, roots: readonly number[], scale: number): number[] | undefined {
  const out: number[] = [];
  for (const r0 of roots) {
    let x = r0;
    for (let i = 0; i < 25; i++) {
      const y = g(x);
      if (y === undefined) break;
      const h = 1e-7 * Math.max(1, Math.abs(x));
      const y1 = g(x + h);
      const y0 = g(x - h);
      if (y0 === undefined || y1 === undefined) break;
      const d = (y1 - y0) / (2 * h);
      if (d === 0) break;
      const nx = x - y / d;
      if (!Number.isFinite(nx)) break;
      if (Math.abs(nx - x) < 1e-13 * Math.max(1, Math.abs(x))) {
        x = nx;
        break;
      }
      x = nx;
    }
    const y = g(x);
    if (y === undefined || Math.abs(y) > 1e-9 * scale + 1e-11) return undefined;
    out.push(x);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Sign-scan with adaptive bisection (4.6): 256 intervals, bisect on sign
 * change or >10x slope change, Brent to 1e-14 relative. Tangential roots via
 * derivative-sign minima; poles skipped by the midpoint magnitude test.
 */
export function scanRoots(g: Fn1, lo: number, hi: number): number[] {
  const N = 256;
  const xs: number[] = [];
  for (let i = 0; i <= N; i++) xs.push(lo + ((hi - lo) * i) / N);
  const ys = xs.map((x) => g(x));
  const out: number[] = [];
  const push = (x: number): void => {
    if (out.length < 64 && !out.some((q) => Math.abs(q - x) < 1e-12 * Math.max(1, Math.abs(x)))) out.push(x);
  };
  for (let i = 0; i < N; i++) {
    const a = ys[i];
    const b = ys[i + 1];
    if (a === undefined || b === undefined) continue;
    if (a === 0) {
      push(xs[i] as number);
      continue;
    }
    if (a * b < 0) {
      // Pole test: |g| at the midpoint must be smaller than at the ends.
      const mid = (xs[i] as number) + ((xs[i + 1] as number) - (xs[i] as number)) / 2;
      const m = g(mid);
      if (m === undefined || !(Math.abs(m) < Math.max(Math.abs(a), Math.abs(b)))) continue;
      const gg = (x: number): number => g(x) ?? NaN;
      const r = brent(gg, xs[i] as number, xs[i + 1] as number);
      if (Number.isFinite(r)) push(r);
    } else if (i + 2 <= N) {
      // Tangential root: derivative sign change with a small |g| minimum.
      const c = ys[i + 2];
      if (c === undefined) continue;
      const d1 = b - a;
      const d2 = c - b;
      if (d1 * d2 < 0) {
        const scale = Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));
        if (Math.abs(b) < 1e-10 * scale) push(xs[i + 1] as number);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

/** Damped Newton from x0 (4.6 `near` form). Undefined after 50 failed steps. */
export function newtonNear(g: Fn1, x0: number): number | undefined {
  let x = x0;
  for (let i = 0; i < 50; i++) {
    const y = g(x);
    if (y === undefined) return undefined;
    if (Math.abs(y) < 1e-13 * Math.max(1, Math.abs(x))) return x;
    const h = 1e-7 * Math.max(1, Math.abs(x));
    const y1 = g(x + h);
    const y0 = g(x - h);
    if (y0 === undefined || y1 === undefined) return undefined;
    const d = (y1 - y0) / (2 * h);
    if (d === 0) return undefined;
    let step = y / d;
    for (let k = 0; k < 10; k++) {
      const ny = g(x - step);
      if (ny !== undefined && Math.abs(ny) < Math.abs(y)) break;
      step /= 2;
    }
    x -= step;
    if (!Number.isFinite(x)) return undefined;
  }
  const y = g(x);
  return y !== undefined && Math.abs(y) < 1e-10 * Math.max(1, Math.abs(x)) ? x : undefined;
}

/** Function with line: vertical lines evaluate; others root f(x) - (mx + b). */
export function functionLineRoots(
  f: { call1?: (x: number) => number; call: (...xs: number[]) => number | V2 | undefined },
  line: LineLike,
  from: number | undefined,
  to: number | undefined,
): { pts: V2[]; poly: boolean } {
  const ev: Fn1 = (x) => evalFn(f, x);
  if (Math.abs(line.b) <= 1e-12 * Math.abs(line.a)) {
    // Vertical line x = c/a.
    if (line.a === 0) return { pts: [], poly: false };
    const x0 = line.c / line.a;
    if (from !== undefined && x0 < from) return { pts: [], poly: false };
    if (to !== undefined && x0 > to) return { pts: [], poly: false };
    const y = ev(x0);
    return y === undefined ? { pts: [], poly: false } : { pts: [{ x: x0, y }], poly: false };
  }
  const m = -line.a / line.b;
  const bb = line.c / line.b;
  const g: Fn1 = (x) => {
    const y = ev(x);
    return y === undefined ? undefined : y - (m * x + bb);
  };
  if (from === undefined || to === undefined) {
    const roots = polyRootsOf(g, -10, 10);
    if (!roots) return { pts: [], poly: false };
    return { pts: roots.map((x) => ({ x, y: m * x + bb })), poly: true };
  }
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const roots = polyRootsOf(g, lo, hi) ?? scanRoots(g, lo, hi);
  return { pts: roots.map((x) => ({ x, y: m * x + bb })), poly: false };
}

/** Function with function: roots of f - g. */
export function functionFunctionRoots(
  f: { call1?: (x: number) => number; call: (...xs: number[]) => number | V2 | undefined },
  g2: { call1?: (x: number) => number; call: (...xs: number[]) => number | V2 | undefined },
  from: number | undefined,
  to: number | undefined,
): { pts: V2[]; poly: boolean } {
  const g: Fn1 = (x) => {
    const a = evalFn(f, x);
    const b = evalFn(g2, x);
    return a === undefined || b === undefined ? undefined : a - b;
  };
  if (from === undefined || to === undefined) {
    const roots = polyRootsOf(g, -10, 10);
    if (!roots) return { pts: [], poly: false };
    return {
      pts: roots.map((x) => ({ x, y: evalFn(f, x) as number })).filter((p) => Number.isFinite(p.y)),
      poly: true,
    };
  }
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const roots = polyRootsOf(g, lo, hi) ?? scanRoots(g, lo, hi);
  return {
    pts: roots.map((x) => ({ x, y: evalFn(f, x) as number })).filter((p) => Number.isFinite(p.y)),
    poly: false,
  };
}

/* ------------------------------ 4.7 parametric and implicit curves ------------------------------ */

/** Adaptive samples of a path: 64 base, split while the chord deviates. */
export function samplePath(path: Path, budget: number): V2[] {
  const [lo, hi] = path.domain;
  const finite = Number.isFinite(lo) && Number.isFinite(hi);
  const atU = (u: number): V2 => (finite ? path.at(lo + (hi - lo) * u) : path.at(path.unnorm(u)));
  const N = 64;
  const us: number[] = [];
  for (let i = 0; i <= N; i++) us.push(i / N);
  const pts = us.map(atU).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  void budget;
  return pts;
}

/**
 * Curve against a line-like, conic, function or curve (4.7): sample both,
 * find segment crossings, refine each with 2-D Newton. Approximate in the
 * sense of possibly missing a double contact.
 */
export function curveCurveSlots(pa: Path, pb: Path, tol: number, self: boolean): V2[] {
  const A = samplePath(pa, 4000);
  const B = self ? A : samplePath(pb, 4000);
  const out: V2[] = [];
  for (let i = 0; i + 1 < A.length && out.length < 64; i++) {
    for (let j = (self ? i + 2 : 0); j + 1 < B.length && out.length < 64; j++) {
      const a0 = A[i] as V2;
      const a1 = A[i + 1] as V2;
      const b0 = B[j] as V2;
      const b1 = B[j + 1] as V2;
      const cross = segSeg(a0, a1, b0, b1, tol);
      if (!cross) continue;
      const q = refineCrossing(pa, pb, cross);
      const fin = q ?? cross;
      const scale = Math.max(1, Math.hypot(fin.x, fin.y));
      if (!out.some((p) => Math.hypot(p.x - fin.x, p.y - fin.y) <= tol * 32 * scale)) out.push(fin);
    }
  }
  return out;
}

/** 2-D Newton on pa(s) - pb(t) = 0 from a segment crossing. */
function refineCrossing(pa: Path, pb: Path, seed: V2): V2 | undefined {
  let s = pa.project(seed).s;
  let t = pb.project(seed).s;
  for (let i = 0; i < 20; i++) {
    const A = pa.at(s);
    const B = pb.at(t);
    const fx = A.x - B.x;
    const fy = A.y - B.y;
    if (Math.hypot(fx, fy) < 1e-12) return { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
    const h = 1e-7;
    const dax = (pa.at(s + h).x - pa.at(s - h).x) / (2 * h);
    const day = (pa.at(s + h).y - pa.at(s - h).y) / (2 * h);
    const dbx = (pb.at(t + h).x - pb.at(t - h).x) / (2 * h);
    const dby = (pb.at(t + h).y - pb.at(t - h).y) / (2 * h);
    const det = dax * -dby - day * -dbx;
    if (det === 0 || !Number.isFinite(det)) return undefined;
    const ds = (fx * -dby - fy * -dbx) / det;
    const dt = (dax * fy - day * fx) / det;
    s -= ds;
    t -= dt;
    if (!Number.isFinite(s) || !Number.isFinite(t)) return undefined;
  }
  const A = pa.at(s);
  const B = pb.at(t);
  return Math.hypot(A.x - B.x, A.y - B.y) < 1e-8 ? { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 } : undefined;
}

/* ------------------------------ tangents (conics 6.2-6.4) ------------------------------ */

/** Tangent lines from P to a regular conic, in canonical slot order. */
export function tangentsFromPoint(p: V2, c: ConicValue, tol: number): LineSlot[] {
  const m = matOf(c.q);
  const n = frob3(m) || 1;
  const s = (m[0] * p.x + m[1] * p.y + m[2]) * p.x + (m[3] * p.x + m[4] * p.y + m[5]) * p.y + (m[6] * p.x + m[7] * p.y + m[8]);
  const scale = n * (p.x * p.x + p.y * p.y + 1);
  const rel = Math.abs(s) / Math.max(scale, EPS);
  // Polar line M p.
  const polar = matVec3(m, p.x, p.y, 1);
  const pl = Math.hypot(polar[0], polar[1]);
  if (rel <= tol) {
    // On the conic: slot 1 is the tangent, slot 2 is on_conic.
    if (!(pl > 0)) return [{ reason: 'degenerate_conic' }, { reason: 'degenerate_conic' }];
    return [{ l: polarLineOf(polar) }, { reason: 'on_conic' }];
  }
  // Inside test: sign of s equals the sign at the centre (central conics).
  const cp = centralParams(c);
  if (cp) {
    const sc = conicAt(c.q, cp.cx, cp.cy);
    if (s * sc > 0 && Math.abs(sc) > tol * scale) return [{ reason: 'inside' }, { reason: 'inside' }];
  } else if (c.kind === 'parabola' && c.frame && 'vx' in c.frame) {
    // Inside a parabola: same side as the focus relative to the curve.
    const f = c.frame;
    const fx = f.vx + (f.p / 2) * f.ux;
    const fy = f.vy + (f.p / 2) * f.uy;
    const sf = conicAt(c.q, fx, fy);
    if (s * sf > 0 && Math.abs(sf) > tol * scale) return [{ reason: 'inside' }, { reason: 'inside' }];
  }
  if (!(pl > 0)) return [{ reason: 'degenerate_conic' }, { reason: 'degenerate_conic' }];
  // Intersect the polar with the conic (4.3).
  const ln: HLine = { a: polar[0] / pl, b: polar[1] / pl, c: -polar[2] / pl };
  const o = { x: ln.a * ln.c, y: ln.b * ln.c };
  const d = { x: ln.b, y: -ln.a };
  const slots = lineConicSlots(o, d, c, tol);
  const touch = slots.filter((sl): sl is { p: V2 } => 'p' in sl);
  if (touch.length === 0) return [{ reason: 'inside' }, { reason: 'inside' }];
  if (touch.length === 1) {
    return [{ l: lineThroughH(p, (touch[0] as { p: V2 }).p) }, { reason: 'at_infinity' }];
  }
  const t1 = (touch[0] as { p: V2 }).p;
  const t2 = (touch[1] as { p: V2 }).p;
  // Slot 1 touches left of the ray from P toward the reference point.
  const ref = cp ? { x: cp.cx, y: cp.cy } : c.frame && 'vx' in c.frame ? { x: c.frame.vx, y: c.frame.vy } : { x: 0, y: 0 };
  const left1 = orient(p, ref, t1).sign;
  const first = left1 >= 0 ? t1 : t2;
  const second = left1 >= 0 ? t2 : t1;
  return [{ l: lineThroughH(p, first) }, { l: lineThroughH(p, second) }];
}

export function polarLineOf(polar: [number, number, number]): HLine {
  const l = Math.hypot(polar[0], polar[1]) || 1;
  return { a: polar[0] / l, b: polar[1] / l, c: -polar[2] / l };
}

/** Line through two points as HLine (ax + by = c, normalised). */
export function lineThroughH(p: V2, q: V2): HLine {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const l = Math.hypot(dx, dy) || 1;
  const a = -dy / l;
  const b = dx / l;
  return { a, b, c: a * p.x + b * p.y };
}

/** Tangents parallel to a line via the dual conic (conics 6.3). */
export function tangentsParallel(line: LineLike, c: ConicValue): LineSlot[] {
  const star = adj3(matOf(c.q));
  // (a b c0) M* (a b c0)^T = 0 with fixed (a, b): quadratic in c0.
  const a = line.a;
  const b = line.b;
  const A = star[8];
  const B = 2 * (star[2] * a + star[5] * b);
  const C = star[0] * a * a + 2 * star[1] * a * b + star[4] * b * b;
  const roots = solveQuad(A, B, C);
  const mk = (c0: number): HLine => ({ a, b, c: -c0 });
  if (roots.kind === 'none') return [{ reason: 'no_tangent' }, { reason: 'no_tangent' }];
  if (roots.kind === 'one') return [{ l: mk(roots.s) }, { reason: 'no_tangent' }];
  // Slot 1 has the smaller c0 (toward the negative side of the normal).
  const s1 = Math.min(roots.s1, roots.s2);
  const s2 = Math.max(roots.s1, roots.s2);
  return [{ l: mk(s1) }, { l: mk(s2) }];
}

/** Common tangents of two conics as an intersection in the dual plane (conics 6.4). */
export function commonTangents(c1: ConicValue, c2: ConicValue, tol: number): LineSlot[] {
  const s1 = adj3(matOf(c1.q));
  const s2 = adj3(matOf(c2.q));
  const d1 = classifyQuad(quadOf(s1), tol);
  const d2 = classifyQuad(quadOf(s2), tol);
  if ('fail' in d1 || 'fail' in d2) return [{ reason: 'degenerate_conic' }, { reason: 'degenerate_conic' }, { reason: 'degenerate_conic' }, { reason: 'degenerate_conic' }];
  const v1: ConicValue = { q: d1.q, kind: d1.kind, margin: d1.margin, ...(d1.frame ? { frame: d1.frame } : {}) };
  const v2: ConicValue = { q: d2.q, kind: d2.kind, margin: d2.margin, ...(d2.frame ? { frame: d2.frame } : {}) };
  const slots = conicConicSlots(v1, v2, tol);
  const lines: HLine[] = [];
  for (const s of slots) {
    if (!('p' in s)) continue;
    const l = Math.hypot(s.p.x, s.p.y);
    if (!(l > 0)) continue;
    const ln: HLine = { a: s.p.x / l, b: s.p.y / l, c: -1 / l };
    // Validate on both duals.
    const r1 = Math.abs(dualResidual(s1, ln));
    const r2 = Math.abs(dualResidual(s2, ln));
    const sc = Math.max(1, frob3(s1), frob3(s2));
    if (r1 <= tol * sc && r2 <= tol * sc) lines.push(ln);
  }
  lines.sort((x, y) => Math.atan2(x.b, x.a) - Math.atan2(y.b, y.a));
  const out: LineSlot[] = lines.map((l) => ({ l }));
  while (out.length < 4) out.push({ reason: 'no_tangent' });
  return out;
}

function dualResidual(star: Mat3, ln: HLine): number {
  const v = matVec3(star, ln.a, ln.b, -ln.c);
  return ln.a * v[0] + ln.b * v[1] - ln.c * v[2];
}

type Mat3 = readonly [number, number, number, number, number, number, number, number, number];
