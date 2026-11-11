/**
 * Curve, inequality, locus and envelope commands (docs/features/curves-loci).
 * Also exports the curve forms of the commands shared with functions-calculus
 * (`Derivative`, `Slope`, `Tangent`, ...), which specs-functions merges into the
 * single spec per command name.
 */
import type { ObjId, Pt } from '../../contracts/values';
import type { RuleCall } from '../../graph/registry';
import type { FunctionValue, RelationValue } from '../../language/runtime';
import type { CommandForm, CommandSpec } from '../../language/table';
import { sample2, sampleBody, numArg, isFin } from './sample';
import { chebyshevNodes, derivativeAt, findRoots, hessian2, kappaStraight, nullspaceRect, quad } from './numeric';
import { fn2Value, form, lineFromPointDir, objSpec, p, fmt } from './rules';
import { fitAlgebraic, openSlice, sweepEnvelope, sweepLocus, toSampledCurve } from './locus';
import type { Coef2, CurveData, ImplicitCurveData, ParamCurveData, PiecewiseCurveData, PolyPiece } from './types';
import { isCircle3, isLine3, isRelationValue } from './types';
import {
  asCurve, closestOnCurve, curveAcc, curveBbox, curvePoint, curveRange, curveVel, isEquation, projectImplicit,
} from './curves';
import type { AnyCurve } from './curves';

const CURVE = 'Curve|Relation';

/** Reads a curve argument: `CurveData` or an equation relation. Fails it otherwise. */
function reqCurve(call: RuleCall, i: number): AnyCurve | undefined {
  const v = call.values[i];
  if (isRelationValue(v) && !isEquation(v)) {
    call.fail('bad_argument', 'This is an inequality, not an equation; a curve needs lhs == rhs.');
    return undefined;
  }
  const c = asCurve(v);
  if (!c) call.fail('bad_argument', 'This value is not a curve.');
  return c ?? undefined;
}

function reqPt(call: RuleCall, i: number): Pt | undefined {
  const v = call.values[i];
  if (typeof v === 'object' && v !== null && typeof (v as Pt).x === 'number' && typeof (v as Pt).y === 'number') return v as Pt;
  call.fail('bad_argument', 'This value is not a point.');
  return undefined;
}

function reqFn2(call: RuleCall, i: number): FunctionValue | undefined {
  const v = call.values[i];
  if (typeof v === 'object' && v !== null && (v as FunctionValue).arity === 2 && typeof (v as FunctionValue).call === 'function') {
    return v as FunctionValue;
  }
  call.fail('bad_argument', 'This command needs a function of two variables.');
  return undefined;
}

function reqListPt(v: unknown): Pt[] | null {
  if (!Array.isArray(v)) return null;
  const out: Pt[] = [];
  for (const e of v) {
    if (typeof e !== 'object' || e === null || typeof (e as Pt).x !== 'number' || typeof (e as Pt).y !== 'number') return null;
    out.push(e as Pt);
  }
  return out;
}

/* ------------------------------ Curve constructors ------------------------------ */

function runCurve(call: RuleCall): unknown {
  const slot = call.args[2]?.slot;
  const a = numArg(call, 3);
  const b = numArg(call, 4);
  if (slot === undefined || a === undefined || b === undefined) return call.fail('bad_argument', 'Curve needs two formulas, a parameter and a finite range.');
  if (!isFin(a) || !isFin(b)) return call.fail('missing_range', 'A parametric curve needs a finite range; write in 0..tau for one full turn.');
  if (!(a < b)) return call.fail('bad_argument', 'Ranges run low to high; for a reverse path use a + b - s in the formula.');
  const fx = sampleBody(call, 0, slot);
  const fy = sampleBody(call, 1, slot);
  if (!fx || !fy) return call.fail('bad_argument', 'Curve needs two formulas in the parameter.');
  if (noCurveData(call, fx, fy, a, b)) return undefined;
  const closed = curveClosed(fx, fy, a, b);
  const data: ParamCurveData = { kind: 'curve', curve: 'param', fx, fy, lo: a, hi: b, closed };
  return data;
}

/** True when the ends meet within 1e-9 of the curve's scale (curves design 5). */
function curveClosed(fx: (s: number) => number, fy: (s: number) => number, lo: number, hi: number): boolean {
  const x0 = fx(lo);
  const y0 = fy(lo);
  const x1 = fx(hi);
  const y1 = fy(hi);
  if (x0 !== x0 || y0 !== y0 || x1 !== x1 || y1 !== y1) return false;
  const scale = Math.max(1, Math.abs(x0), Math.abs(y0), Math.abs(x1), Math.abs(y1));
  return Math.hypot(x1 - x0, y1 - y0) <= 1e-9 * scale;
}

function runPolar(call: RuleCall): unknown {
  const slot = call.args[1]?.slot;
  const a = numArg(call, 2);
  const b = numArg(call, 3);
  if (slot === undefined || a === undefined || b === undefined) return call.fail('bad_argument', 'Polar needs a radius formula, an angle and a finite range.');
  if (!isFin(a) || !isFin(b)) return call.fail('missing_range', 'A polar curve needs a finite range; write 0..tau for one full turn.');
  if (!(a < b)) return call.fail('bad_argument', 'Ranges run low to high.');
  const rr = sampleBody(call, 0, slot);
  if (!rr) return call.fail('bad_argument', 'Polar needs a radius formula in the angle.');
  const fx = (s: number): number => {
    const r = rr(s);
    return r === r ? r * Math.cos(s) : Number.NaN;
  };
  const fy = (s: number): number => {
    const r = rr(s);
    return r === r ? r * Math.sin(s) : Number.NaN;
  };
  if (noCurveData(call, fx, fy, a, b)) return undefined;
  const data: ParamCurveData = { kind: 'curve', curve: 'param', fx, fy, lo: a, hi: b, closed: curveClosed(fx, fy, a, b) };
  return data;
}

/** When a parametric formula is undefined at every one of 33 samples, the curve is undefined; its reason is the formula's. */
function noCurveData(call: RuleCall, fx: (s: number) => number, fy: (s: number) => number, lo: number, hi: number): boolean {
  for (let i = 0; i <= 32; i++) {
    const s = lo + ((hi - lo) * i) / 32;
    if (fx(s) === fx(s) && fy(s) === fy(s)) return false;
  }
  call.fail(call.env.reason ?? 'input_undefined', 'The formulas are not defined anywhere in the range.');
  return true;
}

function runBezier(call: RuleCall): unknown {
  const pts = reqListPt(call.values[0]);
  if (!pts) return call.fail('bad_argument', 'Bezier needs a list of points.');
  if (pts.length < 2) return call.fail('bad_argument', 'Bezier needs at least two points.');
  if (pts.length > 12) return call.fail('limit', 'Bezier takes at most 12 points.');
  for (const q of pts) if (!isFin(q.x) || !isFin(q.y)) return call.fail('bad_argument', 'Bezier points must be finite.');
  const n = pts.length - 1;
  // Bernstein to power basis.
  const cx = new Float64Array(n + 1);
  const cy = new Float64Array(n + 1);
  for (let j = 0; j <= n; j++) {
    let sx = 0;
    let sy = 0;
    // coefficient of s^j in sum_i P_i C(n, i) s^i (1 - s)^(n - i): only i <= j contributes
    for (let i = 0; i <= j; i++) {
      const c = binom(n, i) * binom(n - i, j - i) * (((j - i) % 2 === 0) ? 1 : -1);
      const q = pts[i] as Pt;
      sx += c * q.x;
      sy += c * q.y;
    }
    cx[j] = sx;
    cy[j] = sy;
  }
  const piece: PolyPiece = { s0: 0, s1: 1, cx, cy };
  const first = pts[0] as Pt;
  const last = pts[n] as Pt;
  const scale = Math.max(1, ...pts.flatMap((q) => [Math.abs(q.x), Math.abs(q.y)]));
  const data: PiecewiseCurveData = {
    kind: 'curve', curve: 'piecewise', pieces: [piece], lo: 0, hi: 1,
    closed: Math.hypot(last.x - first.x, last.y - first.y) <= 1e-9 * scale,
  };
  return data;
}

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let c = 1;
  const kk = Math.min(k, n - k);
  for (let i = 0; i < kk; i++) c = (c * (n - i)) / (i + 1);
  return c;
}

/* ------------------------------ Spline ------------------------------ */

/** Solves a tridiagonal system by the Thomas algorithm. Null on a zero pivot. */
function thomas(sub: Float64Array, diag: Float64Array, sup: Float64Array, rhs: Float64Array): Float64Array | null {
  const n = rhs.length;
  const c = new Float64Array(n);
  const d = new Float64Array(n);
  if (n === 0) return d;
  if ((diag[0] as number) === 0) return null;
  c[0] = (sup[0] as number) / (diag[0] as number);
  d[0] = (rhs[0] as number) / (diag[0] as number);
  for (let i = 1; i < n; i++) {
    const m = (diag[i] as number) - (sub[i] as number) * (c[i - 1] as number);
    if (m === 0) return null;
    c[i] = i < n - 1 ? (sup[i] as number) / m : 0;
    d[i] = ((rhs[i] as number) - (sub[i] as number) * (d[i - 1] as number)) / m;
  }
  const x = new Float64Array(n);
  x[n - 1] = d[n - 1] as number;
  for (let i = n - 2; i >= 0; i--) x[i] = (d[i] as number) - (c[i] as number) * (x[i + 1] as number);
  return x;
}

/** Cyclic tridiagonal solve by Sherman-Morrison (two Thomas solves). Null when singular. */
function cyclicThomas(
  sub: Float64Array, diag: Float64Array, sup: Float64Array, rhs: Float64Array, gamma: number, beta: number,
): Float64Array | null {
  const n = rhs.length;
  if (n === 1) {
    const d = (diag[0] as number) + gamma + beta;
    return d === 0 ? null : new Float64Array([(rhs[0] as number) / d]);
  }
  const dt = Float64Array.from(diag);
  dt[0] = (dt[0] as number) - gamma;
  dt[n - 1] = (dt[n - 1] as number) - beta;
  const u = new Float64Array(n);
  u[0] = gamma;
  u[n - 1] = beta;
  const y = thomas(sub, dt, sup, rhs);
  const q = thomas(sub, dt, sup, u);
  if (!y || !q) return null;
  const vy = (y[0] as number) + (y[n - 1] as number);
  const vq = (q[0] as number) + (q[n - 1] as number);
  const denom = 1 + vq;
  if (denom === 0) return null;
  const f = vy / denom;
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = (y[i] as number) - f * (q[i] as number);
  return x;
}

/** Hermite data to power coefficients in `u` in `[0, h]`. */
function hermitePower(y0: number, m0: number, y1: number, m1: number, h: number): Float64Array {
  const c0 = y0;
  const c1 = m0;
  const c2 = ((3 * (y1 - y0)) / h - 2 * m0 - m1) / h;
  const c3 = ((2 * (y0 - y1)) / h + m0 + m1) / (h * h);
  return new Float64Array([c0, c1, c2, c3]);
}

/** Shifts cubic coefficients from `u = s - s0` to `s`. */
function shiftCubic(c: Float64Array, s0: number): Float64Array {
  const a0 = c[0] as number;
  const a1 = c[1] as number;
  const a2 = c[2] as number;
  const a3 = c[3] as number;
  return new Float64Array([
    a0 - a1 * s0 + a2 * s0 * s0 - a3 * s0 * s0 * s0,
    a1 - 2 * a2 * s0 + 3 * a3 * s0 * s0,
    a2 - 3 * a3 * s0,
    a3,
  ]);
}

/** Natural cubic spline moments from chord lengths; null when singular. */
function naturalMoments(h: Float64Array, y: Float64Array, closed: boolean): Float64Array | null {
  const n = y.length;
  if (closed) {
    const sub = new Float64Array(n);
    const diag = new Float64Array(n);
    const sup = new Float64Array(n);
    const rhs = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const him = h[(i + n - 1) % n] as number;
      const hi = h[i] as number;
      sub[i] = him;
      diag[i] = 2 * (him + hi);
      sup[i] = hi;
      const slope1 = ((y[(i + 1) % n] as number) - (y[i] as number)) / hi;
      const slope0 = ((y[i] as number) - (y[(i + n - 1) % n] as number)) / him;
      rhs[i] = 6 * (slope1 - slope0);
    }
    return cyclicThomas(sub, diag, sup, rhs, h[n - 1] as number, h[n - 1] as number);
  }
  if (n <= 2) return new Float64Array(n);
  const m = n - 2;
  const sub = new Float64Array(m);
  const diag = new Float64Array(m);
  const sup = new Float64Array(m);
  const rhs = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const k = i + 1;
    const him = h[k - 1] as number;
    const hi = h[k] as number;
    sub[i] = him;
    diag[i] = 2 * (him + hi);
    sup[i] = hi;
    rhs[i] = 6 * (((y[k + 1] as number) - (y[k] as number)) / hi - ((y[k] as number) - (y[k - 1] as number)) / him);
  }
  const inner = thomas(sub, diag, sup, rhs);
  if (!inner) return null;
  const out = new Float64Array(n);
  for (let i = 0; i < m; i++) out[i + 1] = inner[i] as number;
  return out;
}

function naturalPieces(
  t: Float64Array, h: Float64Array, x: Float64Array, y: Float64Array, mx: Float64Array, my: Float64Array, closed: boolean,
): PolyPiece[] {
  const n = x.length;
  const segs = closed ? n : n - 1;
  const pieces: PolyPiece[] = [];
  for (let k = 0; k < segs; k++) {
    const i = k;
    const j = (k + 1) % n;
    const hk = h[k] as number;
    const s0 = t[i] as number;
    const build = (v0: number, m0: number, v1: number, m1: number): Float64Array => {
      const A = m0 / (6 * hk);
      const B = m1 / (6 * hk);
      const c0 = (v0 - (m0 * hk * hk) / 6) / hk;
      const c1 = (v1 - (m1 * hk * hk) / 6) / hk;
      const u = new Float64Array([A * hk * hk * hk + c0 * hk, -3 * A * hk * hk - c0 + c1, 3 * A * hk, B - A]);
      return shiftCubic(u, s0);
    };
    pieces.push({
      s0,
      s1: s0 + hk,
      cx: build(x[i] as number, mx[i] as number, x[j] as number, mx[j] as number),
      cy: build(y[i] as number, my[i] as number, y[j] as number, my[j] as number),
    });
  }
  return pieces;
}

function runSpline(call: RuleCall): unknown {
  const pts = reqListPt(call.values[0]);
  if (!pts) return call.fail('bad_argument', 'Spline needs a list of points.');
  const closed = call.values[1] === true;
  const kind = call.values[2];
  if (kind !== 'natural' && kind !== 'centripetal') return call.fail('bad_argument', 'Spline kind is "natural" or "centripetal".');
  if (pts.length < (closed ? 3 : 2)) return call.fail('bad_argument', closed ? 'A closed spline needs at least three points.' : 'A spline needs at least two points.');
  for (const q of pts) if (!isFin(q.x) || !isFin(q.y)) return call.fail('bad_argument', 'Spline points must be finite.');
  if (!call.work.spend(pts.length)) return call.fail('timeout', 'The work budget ran out.');
  const n = pts.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  pts.forEach((q, i) => {
    xs[i] = q.x;
    ys[i] = q.y;
  });
  if (kind === 'natural') {
    const segs = closed ? n : n - 1;
    const h = new Float64Array(segs);
    const t = new Float64Array(n);
    for (let i = 0; i < segs; i++) {
      const a = pts[i] as Pt;
      const b = pts[(i + 1) % n] as Pt;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (!(len > 0)) return call.fail('degenerate_points', 'Two defining points coincide.');
      h[i] = len;
      if (i + 1 < n) t[i + 1] = (t[i] as number) + len;
    }
    const mx = naturalMoments(h, xs, closed);
    const my = naturalMoments(h, ys, closed);
    if (!mx || !my) return call.fail('degenerate_points', 'The defining points do not determine one spline.');
    const pieces = naturalPieces(t, h, xs, ys, mx, my, closed);
    let hi = 0;
    for (let i = 0; i < segs; i++) hi += h[i] as number;
    const data: PiecewiseCurveData = { kind: 'curve', curve: 'piecewise', pieces, lo: 0, hi, closed };
    return data;
  }
  // Centripetal Catmull-Rom (alpha 1/2), segment by segment.
  const at = (i: number): Pt => {
    if (!closed) {
      if (i < 0) return { x: 2 * (xs[0] as number) - (xs[1] as number), y: 2 * (ys[0] as number) - (ys[1] as number) };
      if (i >= n) return { x: 2 * (xs[n - 1] as number) - (xs[n - 2] as number), y: 2 * (ys[n - 1] as number) - (ys[n - 2] as number) };
      return pts[i] as Pt;
    }
    return pts[((i % n) + n) % n] as Pt;
  };
  const segs = closed ? n : n - 1;
  const pieces: PolyPiece[] = [];
  let s = 0;
  for (let k = 0; k < segs; k++) {
    const p0 = at(k - 1);
    const p1 = at(k);
    const p2 = at(k + 1);
    const p3 = at(k + 2);
    const d01 = Math.pow(Math.hypot(p1.x - p0.x, p1.y - p0.y), 0.5);
    const d12 = Math.pow(Math.hypot(p2.x - p1.x, p2.y - p1.y), 0.5);
    const d23 = Math.pow(Math.hypot(p3.x - p2.x, p3.y - p2.y), 0.5);
    if (!(d01 > 0) || !(d12 > 0) || !(d23 > 0)) return call.fail('degenerate_points', 'Two defining points coincide.');
    const t0 = 0;
    const t1 = t0 + d01;
    const t2 = t1 + d12;
    const t3 = t2 + d23;
    const tangent = (a: number, b: number, c: number, d: number): readonly [number, number] => {
      const m1 = (t2 - t1) * ((b - a) / (t1 - t0) - (c - a) / (t2 - t0) + (c - b) / (t2 - t1));
      const m2 = (t2 - t1) * ((c - b) / (t2 - t1) - (d - b) / (t3 - t1) + (d - c) / (t3 - t2));
      return [m1, m2];
    };
    const [m1x, m2x] = tangent(p0.x, p1.x, p2.x, p3.x);
    const [m1y, m2y] = tangent(p0.y, p1.y, p2.y, p3.y);
    const h = t2 - t1;
    pieces.push({ s0: s, s1: s + h, cx: shiftCubic(hermitePower(p1.x, m1x, p2.x, m2x, h), s), cy: shiftCubic(hermitePower(p1.y, m1y, p2.y, m2y, h), s) });
    s += h;
  }
  const data: PiecewiseCurveData = { kind: 'curve', curve: 'piecewise', pieces, lo: 0, hi: s, closed };
  return data;
}

/* ------------------------------ Contour, point fit ------------------------------ */

function runContour(call: RuleCall): unknown {
  const g = reqFn2(call, 0);
  const level = numArg(call, 1);
  if (!g || level === undefined) return call.fail('bad_argument', 'Contour needs a function of two variables and a level.');
  if (!isFin(level)) return call.fail('bad_argument', 'The contour level must be finite.');
  const s = sample2(g);
  const data: ImplicitCurveData = { kind: 'curve', curve: 'implicit', f: (x, y) => s.f(x, y), level };
  return data;
}

function runContours(call: RuleCall): unknown {
  const g = reqFn2(call, 0);
  if (!g) return call.fail('bad_argument', 'Contours needs a function of two variables and levels.');
  const lv = call.values[1];
  const levels: number[] = [];
  if (lv instanceof Float64Array) {
    for (let i = 0; i < lv.length; i++) levels.push(lv[i] as number);
  } else if (Array.isArray(lv)) {
    for (const e of lv) {
      if (typeof e !== 'number') return call.fail('bad_argument', 'Contour levels must be numbers.');
      levels.push(e);
    }
  } else return call.fail('bad_argument', 'Contours needs a list of levels.');
  if (levels.length > 50) return call.fail('limit', 'Contours takes at most 50 levels.');
  for (const l of levels) if (!isFin(l)) return call.fail('bad_argument', 'Contour levels must be finite.');
  const s = sample2(g);
  return levels.map((level): ImplicitCurveData => ({ kind: 'curve', curve: 'implicit', f: (x, y) => s.f(x, y), level }));
}

const FIT_COUNTS = new Map<number, number>([[5, 2], [9, 3], [14, 4], [20, 5]]);

function runCurvePts(call: RuleCall): unknown {
  const pts = reqListPt(call.values[0]);
  if (!pts) return call.fail('bad_argument', 'Curve needs a list of points.');
  const d = FIT_COUNTS.get(pts.length);
  if (d === undefined) {
    return call.fail('bad_argument', `${pts.length} points do not fix one curve of low degree; pass 5 (conic), 9 (cubic), 14 (quartic) or 20 (quintic).`);
  }
  for (const q of pts) if (!isFin(q.x) || !isFin(q.y)) return call.fail('bad_argument', 'Curve points must be finite.');
  const tol = call.tol;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const q of pts) {
    if (q.x < minX) minX = q.x;
    if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y;
    if (q.y > maxY) maxY = q.y;
  }
  if (minX === maxX && minY === maxY) return call.fail('degenerate_points', 'The points coincide.');
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const sx = Math.max((maxX - minX) / 2, 1e-300);
  const sy = Math.max((maxY - minY) / 2, 1e-300);
  const terms: [number, number][] = [];
  for (let i = 0; i <= d; i++) for (let j = 0; j <= d - i; j++) terms.push([i, j]);
  const k = terms.length;
  const m = new Float64Array(pts.length * k);
  pts.forEach((q, r) => {
    const x = (q.x - cx) / sx;
    const y = (q.y - cy) / sy;
    const xp = new Float64Array(d + 1);
    const yp = new Float64Array(d + 1);
    xp[0] = 1;
    yp[0] = 1;
    for (let i = 1; i <= d; i++) {
      xp[i] = (xp[i - 1] as number) * x;
      yp[i] = (yp[i - 1] as number) * y;
    }
    terms.forEach(([i, j], t) => {
      m[r * k + t] = (xp[i] as number) * (yp[j] as number);
    });
  });
  const ns = nullspaceRect(m, pts.length, k, tol);
  if (!ns.vec) return call.fail('degenerate_points', 'The points lie on more than one curve of that degree.');
  const c = ns.vec;
  // Verify the fit on the points.
  let worst = 0;
  for (let r = 0; r < pts.length; r++) {
    let s = 0;
    for (let t = 0; t < k; t++) s += (c[t] as number) * (m[r * k + t] as number);
    if (Math.abs(s) > worst) worst = Math.abs(s);
  }
  if (worst > Math.sqrt(tol) * k) return call.fail('degenerate_points', 'The points do not lie on one curve of that degree.');
  // Unscale to power coefficients in original coordinates.
  const acc = new Map<string, number>();
  terms.forEach(([bi, bj], t) => {
    const cc = c[t] as number;
    if (cc === 0) return;
    for (let u = 0; u <= bi; u++) {
      for (let v = 0; v <= bj; v++) {
        const coef = (cc * binom(bi, u) * binom(bj, v) * Math.pow(-cx, bi - u) * Math.pow(-cy, bj - v)) / (Math.pow(sx, bi) * Math.pow(sy, bj));
        const key = `${u},${v}`;
        acc.set(key, (acc.get(key) ?? 0) + coef);
      }
    }
  });
  let largest = 0;
  for (const v of acc.values()) if (Math.abs(v) > largest) largest = Math.abs(v);
  if (!(largest > 0)) return call.fail('degenerate_points', 'The points do not determine one curve.');
  const poly: Coef2[] = [];
  for (const [key, v] of acc) {
    const w = v / largest;
    if (Math.abs(w) <= tol) continue;
    const [i, j] = key.split(',').map(Number) as [number, number];
    poly.push({ i, j, c: w });
  }
  const f = (x: number, y: number): number => {
    let s = 0;
    for (const t of poly) s += t.c * Math.pow(x, t.i) * Math.pow(y, t.j);
    return s;
  };
  const data: ImplicitCurveData = { kind: 'curve', curve: 'implicit', f, level: 0, poly };
  return data;
}

export const CURVE_COMMANDS: CommandSpec[] = [
  objSpec('Polar', [
    form(
      [p('r', 'Number', { kind: 'body' }), p('theta', 'Number', { kind: 'binder' }), p('a', 'Number'), p('b', 'Number')],
      'Curve', runPolar, 'polar curve r(theta) on a..b',
    ),
  ]),
  objSpec('Bezier', [form([p('pts', 'List<Point>')], 'Curve', runBezier, 'Bezier curve through points, parameter 0..1')]),
  objSpec('Spline', [
    form(
      [p('pts', 'List<Point>'), p('closed', 'Bool', { optional: true, default: false }), p('kind', 'Text', { optional: true, default: 'natural' })],
      'Curve', runSpline, 'smooth curve through points',
    ),
  ]),
  objSpec('Contour', [form([p('g', 'Function2'), p('level', 'Number')], 'Curve', runContour, 'the set g(x, y) = level')]),
  objSpec('Contours', [form([p('g', 'Function2'), p('levels', 'List<Number>')], 'List<Curve>', runContours, 'contours of g at levels')]),
  objSpec('Curve', [
    form(
      [p('x', 'Number', { kind: 'body' }), p('y', 'Number', { kind: 'body' }), p('s', 'Number', { kind: 'binder' }), p('a', 'Number'), p('b', 'Number')],
      'Curve', runCurve, 'parametric curve (x(s), y(s)) on a..b',
    ),
    form([p('equation', 'Relation')], 'Curve', runCurveRelation, 'implicit curve from an equation in x and y'),
    form([p('pts', 'List<Point>')], 'Curve', runCurvePts, 'lowest-degree curve through n(n+3)/2 points'),
  ]),
];

function runCurveRelation(call: RuleCall): unknown {
  const v = call.values[0];
  if (!isRelationValue(v) || !isEquation(v)) return call.fail('bad_argument', 'Curve needs an equation lhs == rhs in x and y.');
  return v;
}

/* ------------------------------ shared curve forms ------------------------------ */

function checkOrder(call: RuleCall, i: number): number | undefined {
  const n = numArg(call, i);
  if (n === undefined || !Number.isInteger(n) || n < 0 || n > 20) {
    call.fail('bad_argument', 'The derivative order must be a whole number from 0 to 20.');
    return undefined;
  }
  return n;
}

/** Resolves `(c, s)` for parametric-family curves: range, point and velocity. */
function resolveParam(call: RuleCall, c: AnyCurve, s: number): { readonly p: Pt; readonly v: Pt } | undefined {
  const r = curveRange(c);
  if (!r) {
    call.fail('bad_argument', 'This curve is implicit; pass a point on it instead of a parameter.');
    return undefined;
  }
  if (!(s >= r[0]) || !(s <= r[1])) {
    call.fail('out_of_range', `The parameter ${fmt(s)} is outside [${fmt(r[0])}, ${fmt(r[1])}].`);
    return undefined;
  }
  const p = curvePoint(c, s);
  if (!p) {
    call.fail('curve_undefined_at_param', `The curve is not defined at s = ${fmt(s)}.`);
    return undefined;
  }
  const v = curveVel(c, s);
  if (!v) {
    call.fail('curve_undefined_at_param', `The curve has no velocity at s = ${fmt(s)}.`);
    return undefined;
  }
  return { p, v };
}

/**
 * True when the speed at `s` vanishes next to its neighbours (a cusp or stop): an
 * exact zero, or a tiny speed whose neighbours point in opposite directions (a
 * finite-difference artifact at a cusp has truncation size but a meaningless
 * direction, while a smooth slow curve keeps its direction).
 */
function isStill(c: AnyCurve, s: number, v: Pt, tol: number): boolean {
  const r = curveRange(c);
  const h = r ? Math.max((r[1] - r[0]) * 1e-4, 1e-9 * Math.max(1, Math.abs(s))) : 1e-6;
  const a = curveVel(c, s - h);
  const b = curveVel(c, s + h);
  const m = Math.max(a ? Math.hypot(a.x, a.y) : 0, b ? Math.hypot(b.x, b.y) : 0, 1e-300);
  const sp = Math.hypot(v.x, v.y);
  if (sp <= tol * m) return true;
  if (!a || !b || sp > 1e-3 * m) return false;
  const na = Math.hypot(a.x, a.y);
  const nb = Math.hypot(b.x, b.y);
  if (!(na > 0) || !(nb > 0)) return true;
  return (a.x * b.x + a.y * b.y) / (na * nb) < 0;
}

/** First non-zero higher direction (acceleration, then 3rd/4th differences) for a cusp tangent. */
function cuspDirection(c: AnyCurve, s: number): Pt | null {
  if (c.t !== 'param') {
    const a = curveAcc(c, s);
    if (a && (a.x !== 0 || a.y !== 0)) return a;
    return null;
  }
  const h = 1.2e-4 * Math.max(1, Math.abs(s));
  const d2 = (f: (t: number) => number): number => (f(s + h) - 2 * f(s) + f(s - h)) / (h * h);
  const ax = d2(c.fx);
  const ay = d2(c.fy);
  if (ax === ax && ay === ay && (ax !== 0 || ay !== 0)) return { x: ax, y: ay };
  const h3 = 7e-4 * Math.max(1, Math.abs(s));
  const d3 = (f: (t: number) => number): number => (f(s + 2 * h3) - 2 * f(s + h3) + 2 * f(s - h3) - f(s - 2 * h3)) / (2 * h3 * h3 * h3);
  const bx = d3(c.fx);
  const by = d3(c.fy);
  if (bx === bx && by === by && (bx !== 0 || by !== 0)) return { x: bx, y: by };
  const h4 = 2e-3 * Math.max(1, Math.abs(s));
  const d4 = (f: (t: number) => number): number =>
    (f(s + 2 * h4) - 4 * f(s + h4) + 6 * f(s) - 4 * f(s - h4) + f(s - 2 * h4)) / (h4 * h4 * h4 * h4);
  const ex = d4(c.fx);
  const ey = d4(c.fy);
  if (ex === ex && ey === ey && (ex !== 0 || ey !== 0)) return { x: ex, y: ey };
  return null;
}

function runDerivativeCurve(call: RuleCall): unknown {
  const c = reqCurve(call, 0);
  if (!c) return undefined;
  const hasN = call.args.length > 1 && !call.args[1]?.omitted;
  const n = hasN ? checkOrder(call, 1) : 1;
  if (n === undefined) return undefined;
  if (c.t === 'implicit') {
    return call.fail('bad_argument', 'Derivatives of implicit curves are ImplicitDerivative; ImplicitDerivative(c) gives dy/dx as a function of x and y.');
  }
  if (n === 0) return call.values[0];
  const r = curveRange(c);
  if (!r) return call.fail('bad_argument', 'This curve has no parameter range.');
  if (c.t === 'piecewise') {
    const pieces: PolyPiece[] = [];
    for (const pc of c.pieces) {
      const dx = new Float64Array(Math.max(1, pc.cx.length - 1));
      const dy = new Float64Array(Math.max(1, pc.cy.length - 1));
      for (let i = 1; i < pc.cx.length; i++) dx[i - 1] = i * (pc.cx[i] as number);
      for (let i = 1; i < pc.cy.length; i++) dy[i - 1] = i * (pc.cy[i] as number);
      let ax = dx;
      let ay = dy;
      for (let k = 1; k < n; k++) {
        const nx = new Float64Array(Math.max(1, ax.length - 1));
        const ny = new Float64Array(Math.max(1, ay.length - 1));
        for (let i = 1; i < ax.length; i++) nx[i - 1] = i * (ax[i] as number);
        for (let i = 1; i < ay.length; i++) ny[i - 1] = i * (ay[i] as number);
        ax = nx;
        ay = ny;
      }
      pieces.push({ s0: pc.s0, s1: pc.s1, cx: ax, cy: ay });
    }
    const data: CurveData = { kind: 'curve', curve: 'piecewise', pieces, lo: r[0], hi: r[1], closed: false };
    return data;
  }
  // Parametric and sampled curves: differentiate the components numerically.
  const h = (s: number): number => 6e-6 * Math.max(1, Math.abs(s));
  const comp = (get: (s: number) => number): ((s: number) => number) => {
    if (n >= 2) {
      // higher orders from a local interpolant: repeated differences lose a digit and more at every order
      return (s: number): number => {
        if (c.t === 'param' && (s < r[0] || s > r[1])) return Number.NaN;
        if (c.t === 'sampled' && (s < 0 || s > 1)) return Number.NaN;
        return derivativeAt(get, s, n);
      };
    }
    let f = get;
    for (let k = 0; k < n; k++) {
      const g = f;
      f = (s: number): number => {
        if (c.t === 'param' && (s < r[0] || s > r[1])) return Number.NaN;
        if (c.t === 'sampled' && (s < 0 || s > 1)) return Number.NaN;
        const st = h(s);
        const a = g(s + st);
        const b = g(s - st);
        if (a === a && b === b) return (a - b) / (2 * st);
        const cc = g(s);
        if (cc !== cc) return Number.NaN;
        if (a === a) return (a - cc) / st;
        if (b === b) return (cc - b) / st;
        return Number.NaN;
      };
    }
    return f;
  };
  const px = (s: number): number => curvePoint(c, s)?.x ?? Number.NaN;
  const py = (s: number): number => curvePoint(c, s)?.y ?? Number.NaN;
  const fx = comp(px);
  const fy = comp(py);
  const data: ParamCurveData = { kind: 'curve', curve: 'param', fx, fy, lo: r[0], hi: r[1], closed: curveClosed(fx, fy, r[0], r[1]) };
  return data;
}

/** `Slope(c)`: the curve `(x(s), dy/dx)` of a parametric or sampled curve. */
function runSlopeCurve0(call: RuleCall): unknown {
  const c = reqCurve(call, 0);
  if (!c) return undefined;
  if (c.t === 'implicit') return call.fail('bad_argument', 'Slope of an implicit curve needs a point; ImplicitDerivative(c) gives dy/dx as a function of x and y.');
  const r = curveRange(c);
  if (!r) return call.fail('bad_argument', 'This curve has no parameter range.');
  const px = (s: number): number => curvePoint(c, s)?.x ?? Number.NaN;
  const py = (s: number): number => curvePoint(c, s)?.y ?? Number.NaN;
  const fy = (s: number): number => {
    const h = 6e-6 * Math.max(1, Math.abs(s));
    const dx = (px(s + h) - px(s - h)) / (2 * h);
    const dy = (py(s + h) - py(s - h)) / (2 * h);
    return dx === dx && dy === dy && dx !== 0 ? dy / dx : Number.NaN;
  };
  const data: ParamCurveData = { kind: 'curve', curve: 'param', fx: px, fy, lo: r[0], hi: r[1], closed: false };
  return data;
}

function runSlopeCurveS(call: RuleCall): unknown {
  const c = reqCurve(call, 0);
  const s = numArg(call, 1);
  if (!c || s === undefined) return call.fail('bad_argument', 'Slope needs a curve and a parameter or point.');
  if (c.t === 'implicit') return call.fail('bad_argument', 'This curve is implicit; pass a point on it instead of a parameter.');
  const r = resolveParam(call, c, s);
  if (!r) return undefined;
  const tol = call.tol;
  if (isStill(c, s, r.v, tol)) return call.fail('singular_point', `The curve has zero speed at s = ${fmt(s)} (a cusp).`);
  if (r.v.x === 0) return r.v.y > 0 ? Infinity : -Infinity;
  return r.v.y / r.v.x;
}

function implicitAt(call: RuleCall, c: AnyCurve, q: Pt): { readonly p: Pt; readonly gx: number; readonly gy: number } | undefined {
  if (c.t !== 'implicit') return undefined;
  const tol = call.tol;
  const v0 = c.f(q.x, q.y) - c.level;
  let p = q;
  if (!(v0 === v0 && Math.abs(v0) <= tol * Math.max(1, Math.abs(c.level), Math.abs(c.f(q.x, q.y))))) {
    const pr = projectImplicit(c.f, c.level, q, tol, call.work);
    if (!pr) {
      call.fail('not_on_curve', 'The point is not on the curve and could not be projected onto it. Use Closest(c, P).');
      return undefined;
    }
    p = pr;
  }
  const hx = 6e-6 * Math.max(1, Math.abs(p.x));
  const hy = 6e-6 * Math.max(1, Math.abs(p.y));
  const gx = (c.f(p.x + hx, p.y) - c.f(p.x - hx, p.y)) / (2 * hx);
  const gy = (c.f(p.x, p.y + hy) - c.f(p.x, p.y - hy)) / (2 * hy);
  if (gx !== gx || gy !== gy) {
    call.fail('singular_point', 'The curve has no gradient at this point.');
    return undefined;
  }
  return { p, gx, gy };
}

function runSlopeCurveP(call: RuleCall): unknown {
  const c = reqCurve(call, 0);
  const q = reqPt(call, 1);
  if (!c || !q) return undefined;
  if (c.t !== 'implicit') {
    // Parametric curve with a point: work at the closest parameter.
    const cl = closestOnCurve(c, q, call.tol, call.work);
    if (!cl) return call.fail('curve_undefined_at_param', 'The curve has no defined samples.');
    if (cl.spent) return call.fail('timeout', 'The work budget ran out.');
    if (cl.s === null) return call.fail('bad_argument', 'This curve has no parameter for the point.');
    const r = resolveParam(call, c, cl.s);
    if (!r) return undefined;
    if (isStill(c, cl.s, r.v, call.tol)) return call.fail('singular_point', 'The curve has zero speed there (a cusp).');
    if (r.v.x === 0) return r.v.y > 0 ? Infinity : -Infinity;
    return r.v.y / r.v.x;
  }
  const at = implicitAt(call, c, q);
  if (!at) return undefined;
  const tol = call.tol;
  const gm = Math.max(Math.abs(at.gx), Math.abs(at.gy));
  if (!(gm > 0)) return call.fail('singular_point', 'The gradient vanishes at this point.');
  if (Math.abs(at.gy) <= tol * Math.max(gm, 1e-300)) {
    if (Math.abs(at.gx) <= tol * Math.max(gm, 1e-300)) return call.fail('singular_point', 'The gradient vanishes at this point.');
    // Vertical tangent: -Fx / 0 is a signed infinity, a legal Number.
    return -at.gx / 0;
  }
  return -at.gx / at.gy;
}

function runTangentCurve(call: RuleCall, normal: boolean): unknown {
  const c = reqCurve(call, 0);
  if (!c) return undefined;
  const second = call.values[1];
  if (typeof second === 'number') {
    if (c.t === 'implicit') return call.fail('bad_argument', 'This curve is implicit; pass a point on it instead of a parameter.');
    const r = resolveParam(call, c, second);
    if (!r) return undefined;
    let dir = r.v;
    if (isStill(c, second, dir, call.tol)) {
      const cusp = cuspDirection(c, second);
      if (!cusp) return call.fail('singular_point', `The curve has zero speed at s = ${fmt(second)} (a cusp).`);
      dir = cusp;
    }
    const d = normal ? { x: -dir.y, y: dir.x } : dir;
    return lineFromPointDir(r.p.x, r.p.y, d.x, d.y) ?? call.fail('singular_point', 'The direction vanishes here.');
  }
  const q = reqPt(call, 1);
  if (!q) return undefined;
  if (c.t !== 'implicit') {
    const cl = closestOnCurve(c, q, call.tol, call.work);
    if (!cl) return call.fail('curve_undefined_at_param', 'The curve has no defined samples.');
    if (cl.spent) return call.fail('timeout', 'The work budget ran out.');
    if (cl.s === null) return call.fail('bad_argument', 'This curve has no parameter for the point.');
    const r = resolveParam(call, c, cl.s);
    if (!r) return undefined;
    let dir = r.v;
    if (isStill(c, cl.s, dir, call.tol)) {
      const cusp = cuspDirection(c, cl.s);
      if (!cusp) return call.fail('singular_point', 'The curve has zero speed there (a cusp).');
      dir = cusp;
    }
    const d = normal ? { x: -dir.y, y: dir.x } : dir;
    return lineFromPointDir(cl.p.x, cl.p.y, d.x, d.y) ?? call.fail('singular_point', 'The direction vanishes here.');
  }
  const at = implicitAt(call, c, q);
  if (!at) return undefined;
  const gm = Math.hypot(at.gx, at.gy);
  if (!(gm > 0)) return call.fail('singular_point', 'The gradient vanishes at this point.');
  const d = normal ? { x: at.gx, y: at.gy } : { x: -at.gy, y: at.gx };
  return lineFromPointDir(at.p.x, at.p.y, d.x, d.y) ?? call.fail('singular_point', 'The direction vanishes here.');
}

export const derivativeCurveForms: CommandForm[] = [
  form([p('c', CURVE)], 'Curve', runDerivativeCurve, 'derivative curve (x, y) of a parametric curve'),
  form([p('c', CURVE), p('n', 'Number')], 'Curve', runDerivativeCurve, 'n-th derivative curve'),
];

export const slopeCurveForms: CommandForm[] = [
  form([p('c', CURVE)], 'Curve', runSlopeCurve0, 'the curve (x(s), dy/dx) of a parametric curve'),
  form([p('c', CURVE), p('s', 'Number')], 'Number', runSlopeCurveS, 'dy/dx of a parametric curve at s'),
  form([p('c', CURVE), p('P', 'Point')], 'Number', runSlopeCurveP, 'dy/dx of an implicit curve at P'),
];

export const tangentCurveForms: CommandForm[] = [
  form([p('c', CURVE), p('s', 'Number')], 'Line', (call) => runTangentCurve(call, false), 'tangent to a parametric curve at s'),
  form([p('c', CURVE), p('P', 'Point')], 'Line', (call) => runTangentCurve(call, false), 'tangent to an implicit curve at P'),
];

export const normalCurveForms: CommandForm[] = [
  form([p('c', CURVE), p('s', 'Number')], 'Line', (call) => runTangentCurve(call, true), 'normal to a parametric curve at s'),
  form([p('c', CURVE), p('P', 'Point')], 'Line', (call) => runTangentCurve(call, true), 'normal to an implicit curve at P'),
];

/* ------------------------------ curvature, length, asymptotes ------------------------------ */

interface KappaOut {
  readonly kappa: number;
  readonly nx: number;
  readonly ny: number;
  readonly px: number;
  readonly py: number;
  readonly straight: boolean;
}

function curvatureAt(call: RuleCall, c: AnyCurve, second: number | Pt): KappaOut | undefined {
  if (typeof second === 'number') {
    if (c.t === 'implicit') {
      call.fail('bad_argument', 'This curve is implicit; pass a point on it instead of a parameter.');
      return undefined;
    }
    const r = resolveParam(call, c, second);
    if (!r) return undefined;
    if (isStill(c, second, r.v, call.tol)) {
      call.fail('singular_point', `The curve has zero speed at s = ${fmt(second)} (a cusp).`);
      return undefined;
    }
    const a = curveAcc(c, second);
    if (!a) {
      call.fail('curve_undefined_at_param', `The curve has no acceleration at s = ${fmt(second)}.`);
      return undefined;
    }
    const sp = Math.hypot(r.v.x, r.v.y);
    const num = r.v.x * a.y - r.v.y * a.x;
    const den = sp * sp * sp;
    const h = 1.2e-4 * Math.max(1, Math.abs(second));
    const noise = (Math.abs(r.v.x) * Math.max(1, Math.abs(r.p.y)) + Math.abs(r.v.y) * Math.max(1, Math.abs(r.p.x))) / (h * h);
    return { kappa: num / den, nx: -r.v.y / sp, ny: r.v.x / sp, px: r.p.x, py: r.p.y, straight: kappaStraight(Math.abs(num), noise) };
  }
  const q = second;
  if (c.t !== 'implicit') {
    const cl = closestOnCurve(c, q, call.tol, call.work);
    if (!cl) {
      call.fail('curve_undefined_at_param', 'The curve has no defined samples.');
      return undefined;
    }
    if (cl.spent) {
      call.fail('timeout', 'The work budget ran out.');
      return undefined;
    }
    if (cl.s === null) {
      call.fail('bad_argument', 'This curve has no parameter for the point.');
      return undefined;
    }
    return curvatureAt(call, c, cl.s);
  }
  const at = implicitAt(call, c, q);
  if (!at) return undefined;
  const gm = Math.hypot(at.gx, at.gy);
  if (!(gm > 0)) {
    call.fail('singular_point', 'The gradient vanishes at this point.');
    return undefined;
  }
  const [fxx, fxy, fyy] = hessian2((x, y) => c.f(x, y), at.p.x, at.p.y);
  if (fxx !== fxx || fxy !== fxy || fyy !== fyy) {
    call.fail('singular_point', 'The curve has no second derivatives at this point.');
    return undefined;
  }
  const num = -at.gy * at.gy * fxx + 2 * at.gx * at.gy * fxy - at.gx * at.gx * fyy;
  const den = gm * gm * gm;
  const hx = 1.2e-4 * Math.max(1, Math.abs(at.p.x));
  const hy = 1.2e-4 * Math.max(1, Math.abs(at.p.y));
  const hm = Math.min(hx, hy);
  const fmax = Math.max(1, Math.abs(c.f(at.p.x, at.p.y)), Math.abs(c.level));
  const noise = ((at.gx * at.gx + 2 * Math.abs(at.gx * at.gy) + at.gy * at.gy) * fmax) / (hm * hm);
  return { kappa: num / den, nx: at.gx / gm, ny: at.gy / gm, px: at.p.x, py: at.p.y, straight: kappaStraight(Math.abs(num), noise) };
}

function runCurvatureCurve(call: RuleCall): unknown {
  const c = reqCurve(call, 0);
  if (!c) return undefined;
  const second = call.values[1];
  const k = curvatureAt(call, c, typeof second === 'number' ? second : (reqPt(call, 1) as Pt));
  if (!k) return undefined;
  return k.straight ? 0 : k.kappa;
}

function runCurvatureVectorCurve(call: RuleCall): unknown {
  const c = reqCurve(call, 0);
  if (!c) return undefined;
  const second = call.values[1];
  const k = curvatureAt(call, c, typeof second === 'number' ? second : (reqPt(call, 1) as Pt));
  if (!k) return undefined;
  if (k.straight) return { x: 0, y: 0 };
  return { x: k.kappa * k.nx, y: k.kappa * k.ny };
}

function runOsculatingCurve(call: RuleCall): unknown {
  const c = reqCurve(call, 0);
  if (!c) return undefined;
  const second = call.values[1];
  const k = curvatureAt(call, c, typeof second === 'number' ? second : (reqPt(call, 1) as Pt));
  if (!k) return undefined;
  if (k.straight || !(Math.abs(k.kappa) > 0)) {
    call.fail('infinite_radius', 'The curve is straight here; Tangent(c, s) is the best fit.');
    return undefined;
  }
  return { cx: k.px + k.nx / k.kappa, cy: k.py + k.ny / k.kappa, r: 1 / Math.abs(k.kappa) };
}

export const curvatureCurveForms: CommandForm[] = [
  form([p('c', CURVE), p('s', 'Number')], 'Number', runCurvatureCurve, 'signed curvature of a parametric curve at s'),
  form([p('c', CURVE), p('P', 'Point')], 'Number', runCurvatureCurve, 'signed curvature of an implicit curve at P'),
];

export const curvatureVectorCurveForms: CommandForm[] = [
  form([p('c', CURVE), p('s', 'Number')], 'Vector', runCurvatureVectorCurve, 'curvature vector of a parametric curve at s'),
  form([p('c', CURVE), p('P', 'Point')], 'Vector', runCurvatureVectorCurve, 'curvature vector of an implicit curve at P'),
];

export const osculatingCurveForms: CommandForm[] = [
  form([p('c', CURVE), p('s', 'Number')], 'Circle', runOsculatingCurve, 'osculating circle of a parametric curve at s'),
  form([p('c', CURVE), p('P', 'Point')], 'Circle', runOsculatingCurve, 'osculating circle of an implicit curve at P'),
];

/* ------------------------------ Length ------------------------------ */

function runLengthCurve(call: RuleCall, withRange: boolean): unknown {
  const c = reqCurve(call, 0);
  if (!c) return undefined;
  if (c.t === 'implicit') return call.fail('bad_argument', 'Length needs a parametric curve with a finite range.');
  const r = curveRange(c);
  if (!r) return call.fail('bad_argument', 'This curve has no parameter range.');
  let a = r[0];
  let b = r[1];
  if (withRange) {
    const va = numArg(call, 1);
    const vb = numArg(call, 2);
    if (va === undefined || vb === undefined) return call.fail('bad_argument', 'Length needs a curve and a parameter range.');
    if (!isFin(va) || !isFin(vb)) return call.fail('unbounded', 'Give a finite range with Length(c, a, b).');
    if (va === vb) return 0;
    a = Math.min(va, vb);
    b = Math.max(va, vb);
    if (a < r[0] || b > r[1]) return call.fail('out_of_range', `The range [${fmt(a)}, ${fmt(b)}] leaves [${fmt(r[0])}, ${fmt(r[1])}].`);
  }
  if (c.t === 'sampled') {
    // Arc-fraction parameterization: length scales linearly.
    let total = 0;
    for (const pc of c.pieces) {
      for (let k = 2; k < pc.length; k += 2) total += Math.hypot((pc[k] as number) - (pc[k - 2] as number), (pc[k + 1] as number) - (pc[k - 1] as number));
    }
    return (b - a) * total;
  }
  const speed = (s: number): number => {
    const v = curveVel(c, s);
    return v ? Math.hypot(v.x, v.y) : Number.NaN;
  };
  const q = quad(speed, a, b, { tolAbs: 1e-10, tolRel: 1e-10, maxDepth: 20, work: call.work });
  if (q.spent) return call.fail('timeout', 'The work budget ran out.');
  if (q.divergesAt !== undefined) return call.fail('diverges', 'The arc length integral does not converge.');
  return q.value;
}

export const lengthCurveForms: CommandForm[] = [
  form([p('c', CURVE), p('a', 'Number'), p('b', 'Number')], 'Number', (call) => runLengthCurve(call, true), 'arc length over a parameter range'),
  form([p('c', CURVE)], 'Number', (call) => runLengthCurve(call, false), 'arc length of the whole curve'),
];

/* ------------------------------ Asymptote of a curve ------------------------------ */

function normLine(a: number, b: number, c: number): { readonly a: number; readonly b: number; readonly c: number } {
  const n = Math.hypot(a, b);
  let x = a / n;
  let y = b / n;
  let z = c / n;
  if (x < 0 || (x === 0 && y < 0)) {
    x = -x;
    y = -y;
    z = -z;
  }
  return { a: x, b: y, c: z };
}

function polyFn1(coeffs: readonly number[]): (x: number) => number {
  return (x: number): number => {
    let v = 0;
    for (let i = coeffs.length - 1; i >= 0; i--) v = v * x + (coeffs[i] as number);
    return v;
  };
}

function polyScale(coeffs: readonly number[]): number {
  let m = 0;
  for (const c of coeffs) if (Math.abs(c) > m) m = Math.abs(c);
  return Math.max(m, 1e-300);
}

function runAsymptoteCurve(call: RuleCall): unknown {
  const c = reqCurve(call, 0);
  if (!c) return undefined;
  if (c.t !== 'implicit' || !c.poly) {
    return call.fail('unsupported_family', 'Asymptote handles polynomial implicit curves; other curves are not supported.');
  }
  const tol = call.tol;
  const terms = c.poly.filter((t) => t.c !== 0);
  let n = 0;
  for (const t of terms) if (t.i + t.j > n) n = t.i + t.j;
  if (n < 1) return [];
  const at = (i: number, j: number): number => terms.find((t) => t.i === i && t.j === j)?.c ?? 0;
  const out: { readonly m: number; readonly line: { readonly a: number; readonly b: number; readonly c: number } }[] = [];
  const verts: number[] = [];
  // Oblique and horizontal: real roots (1, m) of the degree-n part.
  const hCoeffs: number[] = new Array<number>(n + 1).fill(0);
  for (let j = 0; j <= n; j++) hCoeffs[j] = at(n - j, j);
  let hd = n;
  while (hd > 0 && hCoeffs[hd] === 0) hd--;
  const hTrim = hCoeffs.slice(0, hd + 1);
  if (hd >= 1) {
    const bound = 1 + polyScale(hTrim) / Math.max(Math.abs(hTrim[hd] as number), 1e-300);
    const rr = findRoots(polyFn1(hTrim), -bound, bound, tol, call.work, 256);
    if (rr.spent) return call.fail('timeout', 'The work budget ran out.');
    const hp = hTrim.map((c, k) => k * c).slice(1);
    for (const m of rr.roots) {
      const hm = polyFn1(hp)(m);
      const hScale = polyScale(hp) * Math.max(1, Math.abs(m)) ** Math.max(0, hd - 1);
      if (!(Math.abs(hm) > tol * Math.max(hScale, 1e-300))) continue;
      let fnm = 0;
      for (let j = 0; j <= n - 1; j++) fnm += at(n - 1 - j, j) * Math.pow(m, j);
      const bb = -fnm / hm;
      if (bb !== bb || bb === Infinity || bb === -Infinity) continue;
      out.push({ m, line: normLine(m, -1, -bb) });
    }
  }
  // Vertical: simple real roots of the leading y-coefficient.
  let my = 0;
  for (const t of terms) if (t.j > my) my = t.j;
  const ay: number[] = [];
  for (let i = 0; i <= n - my; i++) ay.push(at(i, my));
  let ad = ay.length - 1;
  while (ad > 0 && ay[ad] === 0) ad--;
  if (ad >= 1) {
    const aTrim = ay.slice(0, ad + 1);
    const bound = 1 + polyScale(aTrim) / Math.max(Math.abs(aTrim[ad] as number), 1e-300);
    const rr = findRoots(polyFn1(aTrim), -bound, bound, tol, call.work, 256);
    if (rr.spent) return call.fail('timeout', 'The work budget ran out.');
    const ap = aTrim.map((cc, k) => k * cc).slice(1);
    for (const cx of rr.roots) {
      const dv = polyFn1(ap)(cx);
      if (Math.abs(dv) > tol * Math.max(polyScale(ap), 1e-300)) verts.push(cx);
    }
  }
  out.sort((p, q) => p.m - q.m);
  verts.sort((p, q) => p - q);
  return [...out.map((o) => o.line), ...verts.map((x) => normLine(1, 0, x))];
}

export const asymptoteCurveForms: CommandForm[] = [
  form([p('c', CURVE)], 'List<Line>', runAsymptoteCurve, 'asymptotes of a polynomial implicit curve'),
];

/* ------------------------------ Intersect ------------------------------ */

const IC = 'Curve|Relation|Line|Circle';
const F1 = 'Function<Number, 1>';
/** Default search window where no bounding box is known (matches Asymptote's default range). */
const SEARCH = 100;

type ICN = { readonly t: 'line'; readonly a: number; readonly b: number; readonly c: number } | { readonly t: 'circle'; readonly cx: number; readonly cy: number; readonly r: number } | { readonly t: 'curve'; readonly c: AnyCurve };

function lineCircleOfPoly(poly: readonly Coef2[], level: number, tol: number): ICN | null {
  const terms = poly.filter((t) => t.c !== 0);
  if (terms.length === 0) return null;
  let deg = 0;
  for (const t of terms) if (t.i + t.j > deg) deg = t.i + t.j;
  const at = (i: number, j: number): number => terms.find((t) => t.i === i && t.j === j)?.c ?? 0;
  if (deg <= 1) {
    const a = at(1, 0);
    const b = at(0, 1);
    const n = Math.hypot(a, b);
    if (!(n > 0)) return null;
    return { t: 'line', a: a / n, b: b / n, c: (level - at(0, 0)) / n };
  }
  if (deg === 2) {
    const xx = at(2, 0);
    const xy = at(1, 1);
    const yy = at(0, 2);
    if (Math.abs(xx - yy) <= tol * Math.max(Math.abs(xx), 1e-300) && Math.abs(xy) <= tol * Math.abs(xx) && xx !== 0) {
      const cx = -at(1, 0) / (2 * xx);
      const cy = -at(0, 1) / (2 * xx);
      const r2 = ((at(1, 0) * at(1, 0) + at(0, 1) * at(0, 1)) / (4 * xx * xx) - (at(0, 0) - level) / xx);
      if (r2 > 0 && cx === cx && cy === cy) return { t: 'circle', cx, cy, r: Math.sqrt(r2) };
    }
    return null;
  }
  return null;
}

function normalizeIC(v: unknown, tol: number): ICN | null {
  if (isLine3(v)) {
    const n = Math.hypot(v.a, v.b);
    if (!(n > 0) || v.a !== v.a || v.b !== v.b || v.c !== v.c) return null;
    return { t: 'line', a: v.a / n, b: v.b / n, c: v.c / n };
  }
  if (isCircle3(v)) {
    if (!(v.r > 0) || v.cx !== v.cx || v.cy !== v.cy || v.r !== v.r) return null;
    return { t: 'circle', cx: v.cx, cy: v.cy, r: v.r };
  }
  if (isRelationValue(v) && !isEquation(v)) return null;
  const c = asCurve(v);
  if (!c) return null;
  if (c.t === 'implicit' && c.poly) {
    const lc = lineCircleOfPoly(c.poly, c.level, tol);
    if (lc) return lc;
  }
  return { t: 'curve', c };
}

function implicitFn(m: ICN): { readonly f: (x: number, y: number) => number; readonly level: number } | null {
  if (m.t === 'line') return { f: (x, y) => m.a * x + m.b * y, level: m.c };
  if (m.t === 'circle') return { f: (x, y) => (x - m.cx) * (x - m.cx) + (y - m.cy) * (y - m.cy), level: m.r * m.r };
  if (m.c.t === 'implicit') return { f: m.c.f, level: m.c.level };
  return null;
}

function intersectClosed(l1: ICN, l2: ICN, tol: number): Pt[] | null {
  if (l1.t === 'line' && l2.t === 'line') {
    const det = l1.a * l2.b - l2.a * l1.b;
    if (!(Math.abs(det) > tol)) return [];
    return [{ x: (l1.c * l2.b - l2.c * l1.b) / det, y: (l1.a * l2.c - l2.a * l1.c) / det }];
  }
  const lineCircle = (l: { readonly a: number; readonly b: number; readonly c: number }, o: { readonly cx: number; readonly cy: number; readonly r: number }): Pt[] => {
    const d = l.a * o.cx + l.b * o.cy - l.c;
    const px = o.cx - l.a * d;
    const py = o.cy - l.b * d;
    const disc = o.r * o.r - d * d;
    if (disc < -tol * Math.max(1, o.r * o.r)) return [];
    if (disc <= tol * Math.max(1, o.r * o.r)) return [{ x: px, y: py }];
    const s = Math.sqrt(disc);
    return [
      { x: px - l.b * s, y: py + l.a * s },
      { x: px + l.b * s, y: py - l.a * s },
    ];
  };
  if (l1.t === 'line' && l2.t === 'circle') return lineCircle(l1, l2);
  if (l1.t === 'circle' && l2.t === 'line') return lineCircle(l2, l1);
  if (l1.t === 'circle' && l2.t === 'circle') {
    const dx = l2.cx - l1.cx;
    const dy = l2.cy - l1.cy;
    const d = Math.hypot(dx, dy);
    const scale = Math.max(1, l1.r, l2.r, d);
    // Concentric or coincident circles have no isolated intersections.
    if (d <= tol * scale) return [];
    const a = (l1.r * l1.r - l2.r * l2.r + d * d) / (2 * d);
    const h2 = l1.r * l1.r - a * a;
    if (h2 < -tol * scale * scale) return [];
    const mx = l1.cx + (a * dx) / d;
    const my = l1.cy + (a * dy) / d;
    if (h2 <= tol * scale * scale) return [{ x: mx, y: my }];
    const h = Math.sqrt(h2);
    return [
      { x: mx - (dy * h) / d, y: my + (dx * h) / d },
      { x: mx + (dy * h) / d, y: my - (dx * h) / d },
    ];
  }
  return null;
}

/** Damped Newton on a 2x2 system with a finite-difference Jacobian. Null on failure. */
function newton2(
  f: (x: number, y: number) => readonly [number, number], x0: number, y0: number,
  tol: number, work: { spend(n?: number): boolean },
): Pt | null {
  let x = x0;
  let y = y0;
  for (let i = 0; i < 30; i++) {
    if (!work.spend(5)) return null;
    const [f1, f2] = f(x, y);
    if (f1 !== f1 || f2 !== f2) return null;
    const sc = Math.max(1, Math.abs(x), Math.abs(y));
    if (Math.hypot(f1, f2) <= tol * sc) return { x, y };
    const h = 6e-6 * sc;
    const [a1, a2] = f(x + h, y);
    const [b1, b2] = f(x - h, y);
    const [c1, c2] = f(x, y + h);
    const [d1, d2] = f(x, y - h);
    if ([a1, a2, b1, b2, c1, c2, d1, d2].some((v) => v !== v)) return null;
    if (!work.spend(4)) return null;
    const j11 = (a1 - b1) / (2 * h);
    const j12 = (c1 - d1) / (2 * h);
    const j21 = (a2 - b2) / (2 * h);
    const j22 = (c2 - d2) / (2 * h);
    const det = j11 * j22 - j12 * j21;
    const js = Math.max(Math.abs(j11 * j22), Math.abs(j12 * j21), 1e-300);
    if (!(Math.abs(det) > tol * js)) return null;
    let dx = (f1 * j22 - f2 * j12) / det;
    let dy = (j11 * f2 - j21 * f1) / det;
    const here = Math.hypot(f1, f2);
    let ok = false;
    for (let k = 0; k < 4; k++) {
      const [g1, g2] = f(x - dx, y - dy);
      if (!work.spend(1)) return null;
      if (g1 === g1 && g2 === g2 && Math.hypot(g1, g2) < here) {
        ok = true;
        break;
      }
      dx /= 2;
      dy /= 2;
    }
    if (!ok) return null;
    x -= dx;
    y -= dy;
  }
  return null;
}

function dedupPts(pts: readonly Pt[]): Pt[] {
  const s = [...pts].sort((p, q) => (p.x - q.x) || (p.y - q.y));
  const out: Pt[] = [];
  for (const q of s) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 1e-10 * Math.max(1, Math.abs(q.x), Math.abs(q.y), Math.abs(last.x), Math.abs(last.y))) {
      out.push(q);
    }
  }
  return out;
}

function intersectParamParam(
  c1: AnyCurve, c2: AnyCurve, tol: number, w: import('../../graph/registry').RuleWork,
): { readonly pts: Pt[]; readonly spent: boolean } {
  const r1 = curveRange(c1);
  const r2 = curveRange(c2);
  if (!r1 || !r2) return { pts: [], spent: false };
  const G = 40;
  const d2 = (s: number, t: number): number => {
    const p = curvePoint(c1, s);
    const q = curvePoint(c2, t);
    return p && q ? (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y) : Number.NaN;
  };
  const grid: number[][] = [];
  let scale = 1;
  for (let i = 0; i <= G; i++) {
    const row: number[] = [];
    for (let j = 0; j <= G; j++) {
      if (!w.spend(2)) return { pts: [], spent: true };
      const v = d2(r1[0] + ((r1[1] - r1[0]) * i) / G, r2[0] + ((r2[1] - r2[0]) * j) / G);
      row.push(v);
      if (v === v && v > scale) scale = v;
    }
    grid.push(row);
  }
  scale = Math.sqrt(scale);
  const seeds: [number, number][] = [];
  for (let i = 0; i <= G; i++) {
    for (let j = 0; j <= G; j++) {
      const v = grid[i]?.[j] as number;
      if (v !== v) continue;
      let local = true;
      for (let a = -1; a <= 1 && local; a++) {
        for (let b = -1; b <= 1; b++) {
          if (a === 0 && b === 0) continue;
          const u = grid[i + a]?.[j + b];
          if (u === u && (u as number) < v) {
            local = false;
            break;
          }
        }
      }
      if (local) seeds.push([r1[0] + ((r1[1] - r1[0]) * i) / G, r2[0] + ((r2[1] - r2[0]) * j) / G]);
      if (seeds.length >= 24) break;
    }
    if (seeds.length >= 24) break;
  }
  const f = (s: number, t: number): readonly [number, number] => {
    const p = curvePoint(c1, s);
    const q = curvePoint(c2, t);
    return p && q ? [p.x - q.x, p.y - q.y] : [Number.NaN, Number.NaN];
  };
  const out: Pt[] = [];
  for (const [s, t] of seeds) {
    const hit = newton2(f, s, t, tol, w);
    if (!hit) continue;
    const p = curvePoint(c1, hit.x);
    const q = curvePoint(c2, hit.y);
    if (!w.spend(2)) return { pts: dedupPts(out), spent: true };
    if (p && q && Math.hypot(p.x - q.x, p.y - q.y) <= Math.sqrt(tol) * Math.max(1, scale)) out.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  }
  return { pts: dedupPts(out), spent: false };
}

function intersectParamImplicit(
  cp: AnyCurve, f: (x: number, y: number) => number, level: number, tol: number, work: import('../../graph/registry').RuleWork,
): { readonly pts: Pt[]; readonly spent: boolean } {
  const r = curveRange(cp);
  if (!r) return { pts: [], spent: false };
  const g = (s: number): number => {
    const p = curvePoint(cp, s);
    return p ? f(p.x, p.y) - level : Number.NaN;
  };
  const rr = findRoots(g, r[0], r[1], tol, work, 512);
  if (rr.spent) return { pts: [], spent: true };
  const out: Pt[] = [];
  for (const s of rr.roots) {
    const p = curvePoint(cp, s);
    if (p) out.push(p);
  }
  return { pts: dedupPts(out), spent: false };
}

interface Win {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
}

function intersectImplicitImplicit(
  f1: (x: number, y: number) => number, l1: number, f2: (x: number, y: number) => number, l2: number,
  win: Win, tol: number, work: import('../../graph/registry').RuleWork,
): { readonly pts: Pt[]; readonly spent: boolean } {
  // Calibrate residual scales on a coarse grid.
  let max1 = 1e-300;
  let max2 = 1e-300;
  for (let i = 0; i <= 16; i++) {
    for (let j = 0; j <= 16; j++) {
      if (!work.spend(2)) return { pts: [], spent: true };
      const x = win.x0 + ((win.x1 - win.x0) * i) / 16;
      const y = win.y0 + ((win.y1 - win.y0) * j) / 16;
      const a = Math.abs(f1(x, y) - l1);
      const b = Math.abs(f2(x, y) - l2);
      if (a === a && a > max1) max1 = a;
      if (b === b && b > max2) max2 = b;
    }
  }
  const t1 = 1e-6 * max1;
  const t2 = 1e-6 * max2;
  const minW = 1e-4 * Math.max(win.x1 - win.x0, win.y1 - win.y0);
  const cells: Win[] = [win];
  const out: Pt[] = [];
  const mixed = (vs: readonly number[], t: number): boolean => {
    let pos = false;
    let neg = false;
    for (const v of vs) {
      if (v !== v) continue;
      if (v > t) pos = true;
      if (v < -t) neg = true;
    }
    return pos && neg;
  };
  while (cells.length > 0) {
    const cell = cells.pop() as Win;
    if (!work.spend(10)) return { pts: dedupPts(out), spent: true };
    const xs = [cell.x0, cell.x1, (cell.x0 + cell.x1) / 2];
    const ys = [cell.y0, cell.y1, (cell.y0 + cell.y1) / 2];
    const v1: number[] = [];
    const v2: number[] = [];
    for (const x of xs) for (const y of ys) {
      v1.push(f1(x, y) - l1);
      v2.push(f2(x, y) - l2);
    }
    const near1 = v1.some((v) => v === v && Math.abs(v) < t1);
    const near2 = v2.some((v) => v === v && Math.abs(v) < t2);
    if (!(mixed(v1, t1) && mixed(v2, t2)) && !(near1 && near2)) continue;
    const w = Math.max(cell.x1 - cell.x0, cell.y1 - cell.y0);
    if (w > minW) {
      const mx = (cell.x0 + cell.x1) / 2;
      const my = (cell.y0 + cell.y1) / 2;
      cells.push(
        { x0: cell.x0, x1: mx, y0: cell.y0, y1: my }, { x0: mx, x1: cell.x1, y0: cell.y0, y1: my },
        { x0: cell.x0, x1: mx, y0: my, y1: cell.y1 }, { x0: mx, x1: cell.x1, y0: my, y1: cell.y1 },
      );
      continue;
    }
    const hit = newton2(
      (x, y) => [f1(x, y) - l1, f2(x, y) - l2],
      (cell.x0 + cell.x1) / 2, (cell.y0 + cell.y1) / 2, tol, work,
    );
    if (hit) {
      const a = Math.abs(f1(hit.x, hit.y) - l1);
      const b = Math.abs(f2(hit.x, hit.y) - l2);
      if (!work.spend(2)) return { pts: dedupPts(out), spent: true };
      if (a === a && b === b && a <= tol * Math.max(1, max1) && b <= tol * Math.max(1, max2)) out.push(hit);
      continue;
    }
    // Tangential fallback: descend on F1^2 + F2^2 from the cell centre.
    const fb = descendMin(f1, l1, f2, l2, (cell.x0 + cell.x1) / 2, (cell.y0 + cell.y1) / 2, w, work);
    if (fb.spent) return { pts: dedupPts(out), spent: true };
    if (fb.p) {
      const a = Math.abs(f1(fb.p.x, fb.p.y) - l1);
      const b = Math.abs(f2(fb.p.x, fb.p.y) - l2);
      if (a <= Math.sqrt(t1 * Math.max(1, max1)) && b <= Math.sqrt(t2 * Math.max(1, max2))) out.push(fb.p);
    }
  }
  return { pts: dedupPts(out), spent: false };
}

/** Coordinate descent on `F1^2 + F2^2` for tangential contacts. Best effort. */
function descendMin(
  f1: (x: number, y: number) => number, l1: number, f2: (x: number, y: number) => number, l2: number,
  x0: number, y0: number, w: number, work: { spend(n?: number): boolean },
): { readonly p: Pt | null; readonly spent: boolean } {
  let x = x0;
  let y = y0;
  const e = (a: number, b: number): number => {
    const u = f1(a, b) - l1;
    const v = f2(a, b) - l2;
    return u === u && v === v ? u * u + v * v : Infinity;
  };
  let best = e(x, y);
  let step = w / 2;
  for (let i = 0; i < 40; i++) {
    if (!work.spend(4)) return { p: null, spent: true };
    const cands: [number, number][] = [[x + step, y], [x - step, y], [x, y + step], [x, y - step]];
    let moved = false;
    for (const [cx, cy] of cands) {
      const v = e(cx, cy);
      if (v < best) {
        best = v;
        x = cx;
        y = cy;
        moved = true;
      }
    }
    if (!moved) step /= 2;
    if (step < 1e-12 * Math.max(1, Math.abs(x), Math.abs(y))) break;
  }
  return { p: best === Infinity ? null : { x, y }, spent: false };
}

function curveWindow(m: ICN, work: import('../../graph/registry').RuleWork): Win {
  if (m.t === 'line') return { x0: -SEARCH, x1: SEARCH, y0: -SEARCH, y1: SEARCH };
  if (m.t === 'circle') return { x0: m.cx - m.r, x1: m.cx + m.r, y0: m.cy - m.r, y1: m.cy + m.r };
  if (m.c.t === 'implicit') return { x0: -SEARCH, x1: SEARCH, y0: -SEARCH, y1: SEARCH };
  const bb = curveBbox(m.c, work);
  if (!bb) return { x0: -SEARCH, x1: SEARCH, y0: -SEARCH, y1: SEARCH };
  return { x0: bb.x0, x1: bb.x1, y0: bb.y0, y1: bb.y1 };
}

function meetWin(a: Win, b: Win): Win {
  return {
    x0: Math.max(a.x0, b.x0, -1e6), x1: Math.min(a.x1, b.x1, 1e6),
    y0: Math.max(a.y0, b.y0, -1e6), y1: Math.min(a.y1, b.y1, 1e6),
  };
}

function runIntersectCurves(call: RuleCall): unknown {
  const tol = call.tol;
  const m1 = normalizeIC(call.values[0], tol);
  const m2 = normalizeIC(call.values[1], tol);
  if (!m1 || !m2) return call.fail('bad_argument', 'Intersect needs curves, lines or circles.');
  const closed = intersectClosed(m1, m2, tol);
  if (closed) return dedupPts(closed);
  const i1 = implicitFn(m1);
  const i2 = implicitFn(m2);
  if (m1.t === 'curve' && m1.c.t !== 'implicit' && m2.t === 'curve' && m2.c.t !== 'implicit') {
    const r = intersectParamParam(m1.c, m2.c, tol, call.work);
    if (r.spent) return call.fail('timeout', 'The work budget ran out.');
    return r.pts;
  }
  if (m1.t === 'curve' && m1.c.t !== 'implicit' && i2) {
    const r = intersectParamImplicit(m1.c, i2.f, i2.level, tol, call.work);
    if (r.spent) return call.fail('timeout', 'The work budget ran out.');
    return r.pts;
  }
  if (m2.t === 'curve' && m2.c.t !== 'implicit' && i1) {
    const r = intersectParamImplicit(m2.c, i1.f, i1.level, tol, call.work);
    if (r.spent) return call.fail('timeout', 'The work budget ran out.');
    return r.pts;
  }
  if (i1 && i2) {
    const win = meetWin(curveWindow(m1, call.work), curveWindow(m2, call.work));
    if (win.x0 >= win.x1 || win.y0 >= win.y1) return [];
    const r = intersectImplicitImplicit(i1.f, i1.level, i2.f, i2.level, win, tol, call.work);
    if (r.spent) return call.fail('timeout', 'The work budget ran out.');
    return r.pts;
  }
  return call.fail('bad_argument', 'These two values have no intersection method.');
}

function runIntersectMixed(call: RuleCall, flip: boolean): unknown {
  const tol = call.tol;
  const fv = (flip ? call.values[1] : call.values[0]) as FunctionValue | undefined;
  const other = normalizeIC(flip ? call.values[0] : call.values[1], tol);
  if (!fv || typeof fv.call !== 'function' || fv.arity !== 1 || !other) {
    return call.fail('bad_argument', 'Intersect needs a one-variable function and a curve, line or circle.');
  }
  const win = curveWindow(other, call.work);
  const s = { f: (x: number): number => {
    let v: unknown;
    try {
      v = fv.call1 ? fv.call1(x) : fv.call(x);
    } catch {
      return Number.NaN;
    }
    return typeof v === 'number' ? v : Number.NaN;
  } };
  const asParam: AnyCurve = { t: 'param', fx: (x) => x, fy: s.f, lo: win.x0, hi: win.x1, closed: false };
  const io = implicitFn(other);
  if (other.t === 'curve' && other.c.t !== 'implicit') {
    const r = intersectParamParam(asParam, other.c, tol, call.work);
    if (r.spent) return call.fail('timeout', 'The work budget ran out.');
    return r.pts;
  }
  if (io) {
    const r = intersectParamImplicit(asParam, io.f, io.level, tol, call.work);
    if (r.spent) return call.fail('timeout', 'The work budget ran out.');
    return r.pts;
  }
  return call.fail('bad_argument', 'These two values have no intersection method.');
}

export const intersectCurveForms: CommandForm[] = [
  form([p('c1', IC), p('c2', IC)], 'List<Point>', runIntersectCurves, 'intersections of two curves, lines or circles'),
  form([p('f', F1), p('c', IC)], 'List<Point>', (call) => runIntersectMixed(call, false), 'intersections of a function with a curve'),
  form([p('c', IC), p('f', F1)], 'List<Point>', (call) => runIntersectMixed(call, true), 'intersections of a curve with a function'),
];

/* ------------------------------ ImplicitDerivative, Closest ------------------------------ */

function runImplicitDerivative(call: RuleCall): unknown {
  const c = reqCurve(call, 0);
  if (!c) return undefined;
  if (c.t !== 'implicit') return call.fail('bad_argument', 'ImplicitDerivative needs an implicit curve; parametric curves use Derivative(c).');
  const tol = call.tol;
  let why: 'singular_point' | 'not_finite' = 'not_finite';
  const f = (x: number, y: number): number => {
    const hx = 6e-6 * Math.max(1, Math.abs(x));
    const hy = 6e-6 * Math.max(1, Math.abs(y));
    const gx = (c.f(x + hx, y) - c.f(x - hx, y)) / (2 * hx);
    const gy = (c.f(x, y + hy) - c.f(x, y - hy)) / (2 * hy);
    if (gx !== gx || gy !== gy) {
      why = 'not_finite';
      return Number.NaN;
    }
    const gm = Math.max(Math.abs(gx), Math.abs(gy));
    if (!(gm > 0) || (Math.abs(gx) <= tol * gm && Math.abs(gy) <= tol * gm)) {
      why = 'singular_point';
      return Number.NaN;
    }
    if (Math.abs(gy) <= tol * gm) return -gx / 0;
    return -gx / gy;
  };
  return fn2Value(f, () => why);
}

function runClosest(call: RuleCall): unknown {
  const c = reqCurve(call, 0);
  const q = reqPt(call, 1);
  if (!c || !q) return undefined;
  const cl = closestOnCurve(c, q, call.tol, call.work);
  if (!cl) {
    if (c.t === 'implicit') return call.fail('no_convergence', 'The search for the nearest point did not settle.');
    return call.fail('curve_undefined_at_param', 'The curve has no defined samples.');
  }
  if (cl.spent) return call.fail('timeout', 'The work budget ran out.');
  return cl.p;
}

/* ------------------------------ inequalities ------------------------------ */

function reqPredicate(call: RuleCall, i: number): RelationValue | undefined {
  const v = call.values[i];
  if (!isRelationValue(v)) {
    call.fail('bad_argument', 'This command needs an inequality in x and y.');
    return undefined;
  }
  return v;
}

function runBoundary(call: RuleCall): unknown {
  const q = reqPredicate(call, 0);
  const a0 = numArg(call, 1);
  const b0 = numArg(call, 2);
  if (!q || a0 === undefined || b0 === undefined) return call.fail('bad_argument', 'Boundary needs an inequality and an interval.');
  if (!isFin(a0) || !isFin(b0)) return call.fail('bad_argument', 'Boundary needs a finite interval.');
  if (a0 === b0) return call.fail('empty_interval', 'The interval is empty.');
  const a = Math.min(a0, b0);
  const b = Math.max(a0, b0);
  const tol = call.tol;
  const test = (x: number): boolean | undefined => {
    try {
      return q.test(x, 0);
    } catch {
      return undefined;
    }
  };
  const N = 1024;
  const vals: (boolean | undefined)[] = [];
  for (let i = 0; i <= N; i++) {
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    vals.push(test(a + ((b - a) * i) / N));
  }
  const out: number[] = [];
  for (let i = 0; i < N; i++) {
    const u = vals[i];
    const v = vals[i + 1];
    if (u === undefined || v === undefined || u === v) continue;
    let lo = a + ((b - a) * i) / N;
    let hi = a + ((b - a) * (i + 1)) / N;
    const target = v;
    for (let k = 0; k < 40; k++) {
      if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
      const m = 0.5 * (lo + hi);
      if (hi - lo <= tol * Math.max(1, Math.abs(hi))) break;
      const t = test(m);
      if (t === undefined) break;
      if (t === target) hi = m;
      else lo = m;
    }
    out.push(0.5 * (lo + hi));
  }
  return new Float64Array(out);
}

function runPointIn(call: RuleCall): unknown {
  const q = reqPredicate(call, 0);
  const p0 = reqPt(call, 1);
  if (!q || !p0) return undefined;
  const test = (x: number, y: number): boolean | undefined => {
    try {
      return q.test(x, y);
    } catch {
      return undefined;
    }
  };
  if (test(p0.x, p0.y) === true) return { x: p0.x, y: p0.y };
  const base = Math.max(1, Math.abs(p0.x), Math.abs(p0.y));
  const R = 4 * base;
  const G = 64;
  let best: Pt | null = null;
  let bd = Infinity;
  for (let i = 0; i <= G; i++) {
    for (let j = 0; j <= G; j++) {
      if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
      const x = p0.x - R + ((2 * R * i) / G);
      const y = p0.y - R + ((2 * R * j) / G);
      if (test(x, y) !== true) continue;
      const d = Math.hypot(x - p0.x, y - p0.y);
      if (d < bd) {
        bd = d;
        best = { x, y };
      }
    }
  }
  if (!best) return call.fail('empty_region', 'No point near P0 satisfies the inequality.');
  // Walk back towards P0 to the boundary, then step inside.
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 40; k++) {
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    const m = 0.5 * (lo + hi);
    const x = p0.x + m * (best.x - p0.x);
    const y = p0.y + m * (best.y - p0.y);
    if (test(x, y) === true) hi = m;
    else lo = m;
    if (hi - lo <= 1e-9) break;
  }
  const m = hi + 1e-9;
  const x = p0.x + m * (best.x - p0.x);
  const y = p0.y + m * (best.y - p0.y);
  return test(x, y) === true ? { x, y } : best;
}

function runPredicateArea(call: RuleCall): unknown {
  const q = reqPredicate(call, 0);
  const x0 = numArg(call, 1);
  const x1 = numArg(call, 2);
  const y0 = numArg(call, 3);
  const y1 = numArg(call, 4);
  if (!q || x0 === undefined || x1 === undefined || y0 === undefined || y1 === undefined) {
    return call.fail('bad_argument', 'Area needs an inequality and a rectangle.');
  }
  if (!isFin(x0) || !isFin(x1) || !isFin(y0) || !isFin(y1) || !(x0 < x1) || !(y0 < y1)) {
    return call.fail('bad_argument', 'Area needs a rectangle with x0 < x1 and y0 < y1.');
  }
  const test = (x: number, y: number): boolean | undefined => {
    try {
      return q.test(x, y);
    } catch {
      return undefined;
    }
  };
  interface Cell {
    readonly ax: number;
    readonly bx: number;
    readonly ay: number;
    readonly by: number;
    readonly depth: number;
  }
  const stack: Cell[] = [{ ax: x0, bx: x1, ay: y0, by: y1, depth: 0 }];
  let area = 0;
  while (stack.length > 0) {
    const c = stack.pop() as Cell;
    if (!call.work.spend(5)) return call.fail('timeout', 'The work budget ran out.');
    const corners = [test(c.ax, c.ay), test(c.bx, c.ay), test(c.bx, c.by), test(c.ax, c.by)];
    const centre = test((c.ax + c.bx) / 2, (c.ay + c.by) / 2);
    const trues = corners.filter((v) => v === true).length;
    const falses = corners.filter((v) => v === false).length;
    const w = (c.bx - c.ax) * (c.by - c.ay);
    // Prune only from depth 5: corners alone cannot rule out a loop inside.
    if (c.depth >= 5) {
      if (trues === 4 && centre !== false) {
        area += w;
        continue;
      }
      if (falses === 4 && centre !== true) continue;
    }
    if (c.depth >= 8) {
      // Boundary cell: marching-squares fraction with bisected crossings.
      const frac = marchFraction(test, c, corners, centre, call.work);
      if (frac === null) return call.fail('timeout', 'The work budget ran out.');
      area += w * frac;
      continue;
    }
    const mx = (c.ax + c.bx) / 2;
    const my = (c.ay + c.by) / 2;
    stack.push(
      { ax: c.ax, bx: mx, ay: c.ay, by: my, depth: c.depth + 1 },
      { ax: mx, bx: c.bx, ay: c.ay, by: my, depth: c.depth + 1 },
      { ax: c.ax, bx: mx, ay: my, by: c.by, depth: c.depth + 1 },
      { ax: mx, bx: c.bx, ay: my, by: c.by, depth: c.depth + 1 },
    );
  }
  return area;
}

/** True-fraction of a boundary cell by marching squares; edge crossings bisected 25 times. Null when spent. */
function marchFraction(
  test: (x: number, y: number) => boolean | undefined,
  c: { readonly ax: number; readonly bx: number; readonly ay: number; readonly by: number },
  corners: (boolean | undefined)[],
  centre: boolean | undefined,
  work: { spend(n?: number): boolean },
): number | null {
  const b = corners.map((v) => v === true);
  const cross = (x0: number, y0: number, x1: number, y1: number, v0: boolean): number | null => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 25; k++) {
      if (!work.spend(1)) return null;
      const m = 0.5 * (lo + hi);
      const t = test(x0 + (x1 - x0) * m, y0 + (y1 - y0) * m);
      if (t === undefined) return 0.5;
      if (t === v0) lo = m;
      else hi = m;
    }
    return 0.5 * (lo + hi);
  };
  // Edge crossings as fractions from fixed ends (only computed when the ends differ).
  let tb = 0.5;
  let tr = 0.5;
  let tt = 0.5;
  let tl = 0.5;
  if (b[0] !== b[1]) {
    const t = cross(c.ax, c.ay, c.bx, c.ay, b[0] as boolean);
    if (t === null) return null;
    tb = (b[0] as boolean) ? t : 1 - t;
  }
  if (b[1] !== b[2]) {
    const t = cross(c.bx, c.ay, c.bx, c.by, b[1] as boolean);
    if (t === null) return null;
    tr = (b[1] as boolean) ? t : 1 - t;
  }
  if (b[3] !== b[2]) {
    const t = cross(c.ax, c.by, c.bx, c.by, b[3] as boolean);
    if (t === null) return null;
    tt = (b[3] as boolean) ? t : 1 - t;
  }
  if (b[0] !== b[3]) {
    const t = cross(c.ax, c.ay, c.ax, c.by, b[0] as boolean);
    if (t === null) return null;
    tl = (b[0] as boolean) ? t : 1 - t;
  }
  const idx = (b[0] ? 1 : 0) + (b[1] ? 2 : 0) + (b[2] ? 4 : 0) + (b[3] ? 8 : 0);
  // tb/tr/tt/tl are the true-segment lengths of their edges; each case composes them.
  switch (idx) {
    case 0: return 0;
    case 1: return (tb * tl) / 2;
    case 2: return (tb * tr) / 2;
    case 3: return (tl + tr) / 2;
    case 4: return (tr * tt) / 2;
    case 5: return centre === true ? 1 - (((1 - tb) * (1 - tr)) / 2 + ((1 - tl) * (1 - tt)) / 2) : ((tb * tl) / 2 + (tr * tt) / 2);
    case 6: return (tb + tt) / 2;
    case 7: return 1 - ((1 - tl) * (1 - tt)) / 2;
    case 8: return (tl * tt) / 2;
    case 9: return (tb + tt) / 2;
    case 10: return centre === true ? 1 - (((1 - tb) * (1 - tl)) / 2 + ((1 - tr) * (1 - tt)) / 2) : ((tb * tr) / 2 + (tl * tt) / 2);
    case 11: return 1 - ((1 - tr) * (1 - tt)) / 2;
    case 12: return (tr + tl) / 2;
    case 13: return 1 - ((1 - tb) * (1 - tr)) / 2;
    case 14: return 1 - ((1 - tb) * (1 - tl)) / 2;
    default: return 1;
  }
}

/* ------------------------------ loci, paths, envelopes ------------------------------ */

function moverTarget(call: RuleCall): { readonly mover: ObjId; readonly target: ObjId } | undefined {
  const target = call.ids[0];
  const mover = call.ids[1];
  if (target === undefined || mover === undefined) {
    call.fail('bad_argument', 'This command needs object names for the point and the mover.');
    return undefined;
  }
  return { mover, target };
}

function runLocusPP(call: RuleCall, withRange: boolean): unknown {
  if (withRange) {
    const from = numArg(call, 2);
    const to = numArg(call, 3);
    if (from === undefined || to === undefined || !isFin(from) || !isFin(to)) return call.fail('bad_argument', 'Locus needs a finite range.');
    if (from === to) return call.fail('empty_interval', 'The range is empty.');
  }
  const ids = moverTarget(call);
  if (!ids) return undefined;
  const setup = openSlice(call, ids.mover, ids.target);
  if (!setup.ok) return call.fail(setup.reason, setup.detail);
  // A slice that succeeds drove a free point, which has no path to move along.
  return call.fail('not_a_mover', 'The mover is a free point, not on a path. Locus needs kernel support for movers on paths.');
}

function runLocusFree(call: RuleCall): unknown {
  const from = numArg(call, 2);
  const to = numArg(call, 3);
  if (from === undefined || to === undefined || !isFin(from) || !isFin(to)) return call.fail('bad_argument', 'Locus needs a finite range.');
  if (from === to) return call.fail('empty_interval', 'The range is empty.');
  const ids = moverTarget(call);
  if (!ids) return undefined;
  const setup = openSlice(call, ids.mover, ids.target);
  if (!setup.ok) return call.fail(setup.reason, setup.detail);
  const sw = sweepLocus(setup.value, from, to);
  if (sw.spent) return call.fail('timeout', 'The work budget ran out.');
  return toSampledCurve(sw.pieces, 'locus');
}

function runPath(call: RuleCall): unknown {
  const from = numArg(call, 1);
  const to = numArg(call, 2);
  if (from === undefined || to === undefined || !isFin(from) || !isFin(to)) return call.fail('bad_argument', 'Path needs a finite clock range.');
  if (from === to) return call.fail('empty_interval', 'The range is empty.');
  const target = call.ids[0];
  if (target === undefined) return call.fail('bad_argument', 'Path needs the name of the point.');
  const setup = openSlice(call, 't', target);
  if (!setup.ok) return call.fail(setup.reason, setup.detail);
  const sw = sweepLocus(setup.value, from, to);
  if (sw.spent) return call.fail('timeout', 'The work budget ran out.');
  return toSampledCurve(sw.pieces, 'path');
}

function runLocusEquationPP(call: RuleCall): unknown {
  const ids = moverTarget(call);
  if (!ids) return undefined;
  const setup = openSlice(call, ids.mover, ids.target);
  if (!setup.ok) return call.fail(setup.reason, setup.detail);
  return call.fail('not_a_mover', 'The mover is a free point, not on a path. LocusEquation needs kernel support for movers on paths.');
}

function runLocusEquationFree(call: RuleCall): unknown {
  const from = numArg(call, 2);
  const to = numArg(call, 3);
  if (from === undefined || to === undefined || !isFin(from) || !isFin(to)) return call.fail('bad_argument', 'LocusEquation needs a finite range.');
  if (from === to) return call.fail('empty_interval', 'The range is empty.');
  const ids = moverTarget(call);
  if (!ids) return undefined;
  const setup = openSlice(call, ids.mover, ids.target);
  if (!setup.ok) return call.fail(setup.reason, setup.detail);
  // Fit and held-out points come straight from the slice (exact): polyline
  // interpolation noise would break the nullspace detection. Chebyshev nodes
  // for the fit, offset uniform nodes for the held-out set.
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const fitS = chebyshevNodes(600, lo, hi);
  const fitCells = setup.value.run(Array.from(fitS));
  const pts = cellsToPts(fitCells);
  if (pts.length < 60) return call.fail('degenerate_points', 'The locus covers too little of the curve to fit an equation.');
  const heldCells = setup.value.run(Array.from({ length: 200 }, (_, j) => lo + ((hi - lo) * (j + 0.5)) / 200));
  const held = cellsToPts(heldCells);
  const fit = fitAlgebraic(pts, held, call.tol);
  if (!fit.ok) return call.fail(fit.reason, fit.detail);
  const data: ImplicitCurveData = { kind: 'curve', curve: 'implicit', f: fit.value.f, level: 0, poly: fit.value.poly, text: fit.value.text };
  return data;
}

function cellsToPts(cells: readonly import('../../graph/types').Cell[]): Pt[] {
  const out: Pt[] = [];
  for (const cell of cells) {
    if (cell.defined && typeof cell.value === 'object' && cell.value !== null) {
      const v = cell.value as Pt;
      if (typeof v.x === 'number' && typeof v.y === 'number' && v.x === v.x && v.y === v.y) out.push({ x: v.x, y: v.y });
    }
  }
  return out;
}

function runEnvelopeP(call: RuleCall): unknown {
  const family = call.ids[0];
  const mover = call.ids[1];
  if (family === undefined || mover === undefined) return call.fail('bad_argument', 'Envelope needs object names for the family and the mover.');
  const setup = openSlice(call, mover, family);
  if (!setup.ok) return call.fail(setup.reason, setup.detail);
  return call.fail('not_a_mover', 'The mover is a free point, not on a path. Envelope needs kernel support for movers on paths.');
}

function runEnvelopeFree(call: RuleCall): unknown {
  const from = numArg(call, 2);
  const to = numArg(call, 3);
  if (from === undefined || to === undefined || !isFin(from) || !isFin(to)) return call.fail('bad_argument', 'Envelope needs a finite range.');
  if (from === to) return call.fail('empty_interval', 'The range is empty.');
  const family = call.ids[0];
  const mover = call.ids[1];
  if (family === undefined || mover === undefined) return call.fail('bad_argument', 'Envelope needs object names for the family and the mover.');
  const setup = openSlice(call, mover, family);
  if (!setup.ok) return call.fail(setup.reason, setup.detail);
  const sw = sweepEnvelope(setup.value, from, to, call.tol);
  if (!sw.ok) return call.fail(sw.reason, sw.detail);
  if (sw.value.spent) return call.fail('timeout', 'The work budget ran out.');
  return toSampledCurve(sw.value.pieces, 'envelope');
}

const FAMILY = 'Line|Segment|Ray|Circle';

export const LOCUS_COMMANDS: CommandSpec[] = [
  objSpec('Locus', [
    form([p('Q', 'Point'), p('P', 'Point')], 'Curve', (call) => runLocusPP(call, false), 'path of Q as the mover P goes along its path'),
    form([p('Q', 'Point'), p('P', 'Point'), p('from', 'Number'), p('to', 'Number')], 'Curve', (call) => runLocusPP(call, true), 'locus over a natural-unit range'),
    form([p('Q', 'Point'), p('a', 'Number'), p('from', 'Number'), p('to', 'Number')], 'Curve', runLocusFree, 'path of Q as the free number a goes from from to to'),
  ]),
  objSpec('Path', [form([p('P', 'Point'), p('from', 'Number'), p('to', 'Number')], 'Curve', runPath, 'path of a point over the clock range')]),
  objSpec('LocusEquation', [
    form([p('Q', 'Point'), p('P', 'Point')], 'Curve', runLocusEquationPP, 'algebraic equation of the locus of Q'),
    form([p('Q', 'Point'), p('a', 'Number'), p('from', 'Number'), p('to', 'Number')], 'Curve', runLocusEquationFree, 'locus equation driven by a free number'),
  ]),
  objSpec('Envelope', [
    form([p('family', FAMILY), p('P', 'Point')], 'Curve', runEnvelopeP, 'curve tangent to every member of the family'),
    form([p('family', FAMILY), p('a', 'Number'), p('from', 'Number'), p('to', 'Number')], 'Curve', runEnvelopeFree, 'envelope driven by a free number'),
  ]),
  objSpec('ImplicitDerivative', [form([p('c', CURVE)], 'Function2', runImplicitDerivative, 'dy/dx of an implicit curve as a function of x and y')]),
  objSpec('Closest', [form([p('c', CURVE), p('P', 'Point')], 'Point', runClosest, 'nearest point on the curve to P')]),
  objSpec('Boundary', [form([p('p', 'Relation|Region'), p('a', 'Number'), p('b', 'Number')], 'List<Number>', runBoundary, 'where a one-variable predicate changes truth')]),
  objSpec('PointIn', [form([p('q', 'Relation|Region'), p('P0', 'Point')], 'Point', runPointIn, 'a point kept inside the region')]),
  objSpec('Area', [
    form(
      [p('q', 'Relation|Region'), p('x0', 'Number'), p('x1', 'Number'), p('y0', 'Number'), p('y1', 'Number')],
      'Number', runPredicateArea, 'measure of the region inside a rectangle',
    ),
  ]),
];
