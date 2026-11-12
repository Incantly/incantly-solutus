/**
 * Operations on curve values shared by the curve commands (curves design 4, 5, 6):
 * every curve kind (this area's `CurveData` and the language's `RelationValue`)
 * answers the same sampling, projection and closest-point operations.
 */
import type { Pt } from '../../contracts/values';
import type { RuleWork } from '../../graph/registry';
import type { RelationValue } from '../../language/runtime';
import type { Fn1, Fn2 } from './sample';
import type { Coef2, PolyPiece } from './types';
import { isCurveData, isRelationValue } from './types';
import { goldenAbs, polyEval } from './numeric';

export type AnyCurve =
  | { readonly t: 'param'; readonly fx: Fn1; readonly fy: Fn1; readonly lo: number; readonly hi: number; readonly closed: boolean }
  | { readonly t: 'implicit'; readonly f: Fn2; readonly level: number; readonly poly: readonly Coef2[] | null }
  | { readonly t: 'piecewise'; readonly pieces: readonly PolyPiece[]; readonly lo: number; readonly hi: number; readonly closed: boolean }
  | { readonly t: 'sampled'; readonly pieces: readonly Float64Array[] };

/** Normalizes any curve-typed value to operations. Null when it is not a curve. */
export function asCurve(v: unknown): AnyCurve | null {
  if (isCurveData(v)) {
    switch (v.curve) {
      case 'param':
        return { t: 'param', fx: v.fx, fy: v.fy, lo: v.lo, hi: v.hi, closed: v.closed };
      case 'implicit':
        return { t: 'implicit', f: v.f, level: v.level, poly: v.poly ?? null };
      case 'piecewise':
        return { t: 'piecewise', pieces: v.pieces, lo: v.lo, hi: v.hi, closed: v.closed };
      case 'sampled':
        return { t: 'sampled', pieces: v.pieces };
    }
  }
  if (isRelationValue(v)) return relationCurve(v);
  return null;
}

/** An inline or defined equation as an implicit curve. Null for inequalities. */
export function relationCurve(r: RelationValue): AnyCurve | null {
  if (r.ops.length !== 1 || r.ops[0] !== '==') return null;
  const f: Fn2 = (x, y) => {
    if (x !== x || y !== y) return Number.NaN;
    let v: number;
    try {
      v = r.residual(x, y);
    } catch {
      return Number.NaN;
    }
    return typeof v === 'number' ? v : Number.NaN;
  };
  const p = r.poly;
  const poly: readonly Coef2[] | null = p
    ? [
        { i: 2, j: 0, c: p.xx }, { i: 1, j: 1, c: p.xy }, { i: 0, j: 2, c: p.yy },
        { i: 1, j: 0, c: p.x }, { i: 0, j: 1, c: p.y }, { i: 0, j: 0, c: p.c },
      ]
    : null;
  return { t: 'implicit', f, level: 0, poly };
}

/** True for an equation relation (usable as a curve); false for inequalities. */
export function isEquation(r: RelationValue): boolean {
  return r.ops.length === 1 && r.ops[0] === '==';
}

/* ------------------------------ sampling ------------------------------ */

/** Point of a parametric-family curve at `s`; null for implicit curves and gaps. */
export function curvePoint(c: AnyCurve, s: number): Pt | null {
  if (s !== s) return null;
  switch (c.t) {
    case 'param': {
      if (s < c.lo || s > c.hi) return null;
      const x = c.fx(s);
      const y = c.fy(s);
      return x === x && y === y ? { x, y } : null;
    }
    case 'piecewise':
      return piecewiseAt(c.pieces, s);
    case 'sampled':
      return sampledAtS(c.pieces, s);
    case 'implicit':
      return null;
  }
}

/** Velocity of a parametric-family curve at `s` (exact for pieces, finite differences else). */
export function curveVel(c: AnyCurve, s: number): Pt | null {
  if (s !== s) return null;
  switch (c.t) {
    case 'param': {
      const h = 6e-6 * Math.max(1, Math.abs(s));
      const x1 = c.fx(s + h);
      const x0 = c.fx(s - h);
      const y1 = c.fy(s + h);
      const y0 = c.fy(s - h);
      if (x1 === x1 && x0 === x0 && y1 === y1 && y0 === y0) return { x: (x1 - x0) / (2 * h), y: (y1 - y0) / (2 * h) };
      // One-sided at range ends and gaps.
      const xc = c.fx(s);
      const yc = c.fy(s);
      if (xc !== xc || yc !== yc) return null;
      if (x1 === x1 && y1 === y1) return { x: (x1 - xc) / h, y: (y1 - yc) / h };
      if (x0 === x0 && y0 === y0) return { x: (xc - x0) / h, y: (yc - y0) / h };
      return null;
    }
    case 'piecewise':
      return piecewiseVel(c.pieces, s);
    case 'sampled':
      return sampledVel(c.pieces, s);
    case 'implicit':
      return null;
  }
}

/** Acceleration (finite differences, or exact for pieces); null when unavailable. */
export function curveAcc(c: AnyCurve, s: number): Pt | null {
  if (s !== s) return null;
  if (c.t === 'piecewise') return piecewiseAcc(c.pieces, s);
  if (c.t === 'param') {
    const h = 1.2e-4 * Math.max(1, Math.abs(s));
    const xa = c.fx(s + h);
    const xc = c.fx(s);
    const xb = c.fx(s - h);
    const ya = c.fy(s + h);
    const yc = c.fy(s);
    const yb = c.fy(s - h);
    if ([xa, xc, xb, ya, yc, yb].some((v) => v !== v)) return null;
    return { x: (xa - 2 * xc + xb) / (h * h), y: (ya - 2 * yc + yb) / (h * h) };
  }
  return null;
}

/** Parameter range of a parametric-family curve; null for implicit curves. */
export function curveRange(c: AnyCurve): readonly [number, number] | null {
  switch (c.t) {
    case 'param':
    case 'piecewise':
      return [c.lo, c.hi];
    case 'sampled':
      return sampledRange(c.pieces);
    case 'implicit':
      return null;
  }
}

function piecewiseFind(pieces: readonly PolyPiece[], s: number): PolyPiece | null {
  for (const p of pieces) if (s >= p.s0 && s <= p.s1) return p;
  return null;
}

function piecewiseAt(pieces: readonly PolyPiece[], s: number): Pt | null {
  const p = piecewiseFind(pieces, s);
  if (!p) return null;
  const x = polyEval(p.cx, s);
  const y = polyEval(p.cy, s);
  return x === x && y === y ? { x, y } : null;
}

function polyDerivEval(c: Float64Array, s: number): number {
  let v = 0;
  for (let i = c.length - 1; i >= 1; i--) v = v * s + i * (c[i] as number);
  return v;
}

function polyDeriv2Eval(c: Float64Array, s: number): number {
  let v = 0;
  for (let i = c.length - 1; i >= 2; i--) v = v * s + i * (i - 1) * (c[i] as number);
  return v;
}

function piecewiseVel(pieces: readonly PolyPiece[], s: number): Pt | null {
  const p = piecewiseFind(pieces, s);
  if (!p) return null;
  return { x: polyDerivEval(p.cx, s), y: polyDerivEval(p.cy, s) };
}

function piecewiseAcc(pieces: readonly PolyPiece[], s: number): Pt | null {
  const p = piecewiseFind(pieces, s);
  if (!p) return null;
  return { x: polyDeriv2Eval(p.cx, s), y: polyDeriv2Eval(p.cy, s) };
}

/**
 * Sampled curves are parameterized by arc fraction over the concatenation of their
 * pieces (curves design 4): `s` in `[0, 1]` walks every piece in order.
 */
function sampledRange(pieces: readonly Float64Array[]): readonly [number, number] | null {
  return pieces.length > 0 ? [0, 1] : null;
}

function sampledLengths(pieces: readonly Float64Array[]): { readonly total: number; readonly cum: Float64Array } {
  const cum = new Float64Array(pieces.length + 1);
  let total = 0;
  pieces.forEach((pc, i) => {
    let L = 0;
    for (let k = 2; k < pc.length; k += 2) L += Math.hypot((pc[k] as number) - (pc[k - 2] as number), (pc[k + 1] as number) - (pc[k - 1] as number));
    total += L;
    cum[i + 1] = total;
  });
  return { total, cum };
}

function sampledAtS(pieces: readonly Float64Array[], s: number): Pt | null {
  if (s < 0 || s > 1 || pieces.length === 0) return null;
  const { total, cum } = sampledLengths(pieces);
  if (!(total > 0)) {
    const pc = pieces[0] as Float64Array;
    return pc.length >= 2 ? { x: pc[0] as number, y: pc[1] as number } : null;
  }
  let target = s * total;
  if (target < 0) target = 0;
  if (target > total) target = total;
  for (let i = 0; i < pieces.length; i++) {
    if (target > (cum[i + 1] as number) && i < pieces.length - 1) continue;
    const pc = pieces[i] as Float64Array;
    let acc = cum[i] as number;
    for (let k = 0; k < pc.length - 2; k += 2) {
      const seg = Math.hypot((pc[k + 2] as number) - (pc[k] as number), (pc[k + 3] as number) - (pc[k + 1] as number));
      if (acc + seg >= target) {
        const t = seg === 0 ? 0 : (target - acc) / seg;
        return { x: (pc[k] as number) + t * ((pc[k + 2] as number) - (pc[k] as number)), y: (pc[k + 1] as number) + t * ((pc[k + 3] as number) - (pc[k + 1] as number)) };
      }
      acc += seg;
    }
    const n = pc.length;
    return { x: pc[n - 2] as number, y: pc[n - 1] as number };
  }
  return null;
}

function sampledVel(pieces: readonly Float64Array[], s: number): Pt | null {
  const h = 1e-6;
  const a = sampledAtS(pieces, Math.max(0, s - h));
  const b = sampledAtS(pieces, Math.min(1, s + h));
  if (!a || !b) return null;
  const w = Math.min(1, s + h) - Math.max(0, s - h);
  if (w === 0) return null;
  return { x: (b.x - a.x) / w, y: (b.y - a.y) / w };
}

/** Point at fraction `u` of the parameter range (for `PointOn`, by the points area). */
export function curveAt01(c: AnyCurve, u: number): Pt | null {
  const r = curveRange(c);
  if (!r) return null;
  const cc = u < 0 ? 0 : u > 1 ? 1 : u;
  return curvePoint(c, r[0] + cc * (r[1] - r[0]));
}

/** Bounding box of a parametric-family curve by sampling; null for implicit curves. */
export function curveBbox(c: AnyCurve, work: RuleWork): { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number } | null {
  if (c.t === 'implicit') return null;
  if (c.t === 'sampled') {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const pc of c.pieces) {
      for (let k = 0; k < pc.length; k += 2) {
        const x = pc[k] as number;
        const y = pc[k + 1] as number;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x0 === Infinity ? null : { x0, x1, y0, y1 };
  }
  const r = curveRange(c);
  if (!r) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i <= 256; i++) {
    if (!work.spend(2)) break;
    const p = curvePoint(c, r[0] + ((r[1] - r[0]) * i) / 256);
    if (!p) continue;
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return x0 === Infinity ? null : { x0, x1, y0, y1 };
}

/* ------------------------------ implicit projection ------------------------------ */

/**
 * Projects `p0` onto the implicit curve `f = level` by Newton along the gradient
 * (20 steps, tolerance 1e-12). Null when it does not converge. Deterministic.
 */
export function projectImplicit(f: Fn2, level: number, p0: Pt, tol: number, work: RuleWork): Pt | null {
  let x = p0.x;
  let y = p0.y;
  for (let i = 0; i < 20; i++) {
    if (!work.spend(5)) return null;
    const v = f(x, y) - level;
    if (v !== v) return null;
    if (Math.abs(v) <= tol * Math.max(1, Math.abs(level))) return { x, y };
    const hx = 6e-6 * Math.max(1, Math.abs(x));
    const hy = 6e-6 * Math.max(1, Math.abs(y));
    const gx = (f(x + hx, y) - f(x - hx, y)) / (2 * hx);
    const gy = (f(x, y + hy) - f(x, y - hy)) / (2 * hy);
    const n2 = gx * gx + gy * gy;
    if (!(n2 > 0) || gx !== gx || gy !== gy) return null;
    const step = v / n2;
    // Damped: never jump further than the current distance scale in one step.
    const sc = Math.max(1, Math.abs(x), Math.abs(y));
    const k = Math.abs(step) * Math.sqrt(n2) > sc ? sc / (Math.abs(step) * Math.sqrt(n2)) : 1;
    x -= k * step * gx;
    y -= k * step * gy;
    if (x !== x || y !== y) return null;
  }
  const v = f(x, y) - level;
  return v === v && Math.abs(v) <= 64 * tol * Math.max(1, Math.abs(level)) ? { x, y } : null;
}

/* ------------------------------ closest point ------------------------------ */

export interface ClosestOut {
  readonly p: Pt;
  readonly d: number;
  readonly s: number | null;
  readonly spent: boolean;
}

/**
 * Nearest point on the curve to `P` (curves design 5, 6). Parametric families:
 * coarse uniform candidates plus safeguarded Newton on `d^2(s)`; implicit curves:
 * fixed-grid seeds projected onto the curve. Deterministic.
 */
export function closestOnCurve(c: AnyCurve, target: Pt, tol: number, work: RuleWork): ClosestOut | null {
  switch (c.t) {
    case 'implicit':
      return closestImplicit(c.f, c.level, target, tol, work);
    default:
      return closestParam(c, target, tol, work);
  }
}

function closestParam(c: AnyCurve, target: Pt, tol: number, work: RuleWork): ClosestOut | null {
  const r = curveRange(c);
  if (!r) return null;
  const d2 = (s: number): number => {
    const p = curvePoint(c, s);
    return p ? (p.x - target.x) * (p.x - target.x) + (p.y - target.y) * (p.y - target.y) : Number.NaN;
  };
  // Coarse candidates.
  const cand: number[] = [];
  let best = Infinity;
  let bestS = r[0];
  for (let i = 0; i <= 64; i++) {
    if (!work.spend(1)) {
      const p = best === Infinity ? null : curvePoint(c, bestS);
      return p ? { p, d: Math.sqrt(best), s: bestS, spent: true } : null;
    }
    const s = r[0] + ((r[1] - r[0]) * i) / 64;
    const v = d2(s);
    if (v !== v) continue;
    if (v < best) {
      best = v;
      bestS = s;
      cand.push(s);
      if (cand.length > 3) cand.shift();
    }
  }
  if (best === Infinity) return null;
  // Refine each candidate: Newton on d^2 with golden-section fallback.
  let bs = cand[cand.length - 1] as number;
  let bv = best;
  for (const s0 of cand) {
    const refined = refineClosest(d2, s0, r[0], r[1], tol, work);
    if (refined.spent) return { p: curvePoint(c, bs) ?? target, d: Math.sqrt(bv), s: bs, spent: true };
    if (refined.v < bv) {
      bv = refined.v;
      bs = refined.s;
    }
  }
  const p = curvePoint(c, bs);
  return p ? { p, d: Math.sqrt(bv), s: bs, spent: false } : null;
}

function refineClosest(d2: Fn1, s0: number, lo: number, hi: number, tol: number, work: RuleWork): { readonly s: number; readonly v: number; readonly spent: boolean } {
  let s = s0;
  let v = d2(s);
  if (v !== v) return { s, v: Infinity, spent: false };
  for (let i = 0; i < 24; i++) {
    if (!work.spend(3)) return { s, v, spent: true };
    const h = 6e-6 * Math.max(1, Math.abs(s));
    const a = d2(s + h);
    const b = d2(s - h);
    if (a !== a || b !== b) break;
    const d = (a - b) / (2 * h);
    const dd = (a - 2 * v + b) / (h * h);
    if (!(dd > 0) || d !== d) break;
    const step = d / dd;
    const ns = s - step;
    if (ns < lo || ns > hi || Math.abs(step) > (hi - lo) / 4) break;
    const nv = d2(ns);
    if (!work.spend(1)) return { s, v, spent: true };
    if (nv !== nv || nv > v) break;
    s = ns;
    v = nv;
    if (Math.abs(step) <= tol * Math.max(1, Math.abs(s))) return { s, v, spent: false };
  }
  // Fallback: golden section around the coarse best.
  const w = Math.max((hi - lo) / 64, tol * Math.max(1, Math.abs(s0)));
  const g = goldenAbs((x) => Math.sqrt(Math.max(d2(x), 0)), Math.max(lo, s0 - w), Math.min(hi, s0 + w), work, tol);
  if (g !== g) return { s, v, spent: false };
  const gv = d2(g);
  if (!work.spend(1)) return { s, v, spent: true };
  return gv === gv && gv < v ? { s: g, v: gv, spent: false } : { s, v, spent: false };
}

function closestImplicit(f: Fn2, level: number, target: Pt, tol: number, work: RuleWork): ClosestOut | null {
  // Fixed grid of seeds around P with doubling radius (deterministic, no randomness).
  const seeds: Pt[] = [{ ...target }];
  for (let ring = 0; ring < 4; ring++) {
    const rad = Math.pow(2, ring) * Math.max(1, Math.abs(target.x), Math.abs(target.y)) * 0.25;
    for (let k = 0; k < 16; k++) {
      const a = (2 * Math.PI * k) / 16;
      seeds.push({ x: target.x + rad * Math.cos(a), y: target.y + rad * Math.sin(a) });
    }
  }
  let best: Pt | null = null;
  let bd = Infinity;
  for (const seed of seeds) {
    if (!work.spend(1)) return best ? { p: best, d: bd, s: null, spent: true } : null;
    const p = projectImplicit(f, level, seed, tol, work);
    if (!p) continue;
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  if (!best) return null;
  return { p: best, d: bd, s: null, spent: false };
}
