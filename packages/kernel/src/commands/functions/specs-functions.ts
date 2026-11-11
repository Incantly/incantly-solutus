/**
 * Function and calculus commands (docs/features/functions-calculus), plus the merged
 * specs of the commands shared with curves-loci (whose curve forms live in
 * specs-curves). Exact symbolic results belong to the CAS area: every result here is
 * numeric, computed from the language's compiled closures.
 */
import type { Pt, UndefReason } from '../../contracts/values';
import type { RuleCall, RuleWork } from '../../graph/registry';
import type { FunctionValue } from '../../language/runtime';
import type { CommandSpec } from '../../language/table';
import { toSampledCurve } from './locus';
import { sample1, sample2, sampleN, numArg, isFin } from './sample';
import type { Fn1, Sampled1 } from './sample';
import {
  brent, cauchyBound, derivativeAt, detectPolynomial, diff1, diff2, findRoots, goldenMin, kappaStraight,
  newton, polyDeriv, polyEval, quad, taylorCoeffs, wynn,
} from './numeric';
import { odeDomain, odeEval, solveOde } from './ode';
import type { OdeSolution } from './ode';
import { fn1Value, fn2Value, form, fmt, intIn, lineFromPointSlope, objSpec, p } from './rules';
import type { FieldData, RegionData } from './types';
import {
  asymptoteCurveForms, curvatureCurveForms, curvatureVectorCurveForms, derivativeCurveForms, intersectCurveForms,
  lengthCurveForms, normalCurveForms, osculatingCurveForms, slopeCurveForms, tangentCurveForms,
} from './specs-curves';

const F1 = 'Function<Number, 1>';
const F1RET = 'Function<Number, 1>';

/** Reads a one-variable Number function argument. */
function reqFn1(call: RuleCall, i: number): Sampled1 | undefined {
  const v = call.values[i];
  if (typeof v !== 'object' || v === null || (v as FunctionValue).arity !== 1 || typeof (v as FunctionValue).call !== 'function') {
    call.fail('bad_argument', 'This command needs a function of one variable.');
    return undefined;
  }
  return sample1(v as FunctionValue);
}

function reqFn2(call: RuleCall, i: number): { readonly f: (x: number, y: number) => number; lastReason: UndefReason | undefined } | undefined {
  const v = call.values[i];
  if (typeof v !== 'object' || v === null || (v as FunctionValue).arity !== 2 || typeof (v as FunctionValue).call !== 'function') {
    call.fail('bad_argument', 'This command needs a function of two variables.');
    return undefined;
  }
  return sample2(v as FunctionValue);
}

function orderArg(call: RuleCall, i: number, max: number): number | undefined {
  const n = numArg(call, i);
  if (n === undefined || !intIn(n, 0, max)) {
    call.fail('bad_argument', `The order must be a whole number from 0 to ${max}.`);
    return undefined;
  }
  return n;
}

/* ------------------------------ derivatives ------------------------------ */

type SlopeOut = { readonly d: number } | { readonly corner: true } | { readonly undef: true };

/**
 * Slope by one-sided differences with corner detection: when the two sides differ
 * beyond tolerance at step `h` and the difference does not shrink at `h / 64`, the
 * function has a corner. A single defined side gives a one-sided slope.
 */
function slopeAt(f: Sampled1, x0: number, tol: number): SlopeOut {
  const c = f.f(x0);
  if (c !== c) return { undef: true };
  // One-sided third-order stencils: exact for cubic pieces, so a smooth junction of two pieces reads the same slope
  // from both sides, and a corner reads two different ones.
  const hs = 5e-4 * Math.max(1, Math.abs(x0));
  const side = (sgn: 1 | -1): number => {
    const a = f.f(x0 + sgn * hs);
    const b = f.f(x0 + sgn * 2 * hs);
    const d = f.f(x0 + sgn * 3 * hs);
    return a === a && b === b && d === d ? (sgn * (-11 * c + 18 * a - 9 * b + 2 * d)) / (6 * hs) : Number.NaN;
  };
  const sr = side(1);
  const sl = side(-1);
  const sides = sr === sr && sl === sl;
  const sidesAgree = sides && Math.abs(sr - sl) <= 1e-7 * Math.max(1, Math.abs(sr), Math.abs(sl));
  // Smooth point: two central differences at h and h/2 agree. At a junction of pieces they differ by O(h).
  const hc = 6e-6 * Math.max(1, Math.abs(x0));
  const c1a = f.f(x0 + hc);
  const c1b = f.f(x0 - hc);
  const c2a = f.f(x0 + hc / 2);
  const c2b = f.f(x0 - hc / 2);
  if (c1a === c1a && c1b === c1b && c2a === c2a && c2b === c2b && (!sides || sidesAgree)) {
    const d1 = (c1a - c1b) / (2 * hc);
    const d2 = (c2a - c2b) / hc;
    if (Math.abs(d1 - d2) <= 1e-8 * Math.max(1, Math.abs(d1), Math.abs(c))) return { d: (4 * d2 - d1) / 3 };
  }
  if (sidesAgree) return { d: (sr + sl) / 2 };
  const h = hc;
  const right = f.f(x0 + h);
  const left = f.f(x0 - h);
  const dr = right === right ? (right - c) / h : Number.NaN;
  const dl = left === left ? (c - left) / h : Number.NaN;
  if (dr !== dr && dl !== dl) return { undef: true };
  if (dr !== dr || dl !== dl) {
    // One-sided slope: when it grows as h shrinks, the slope is infinite.
    const one = dr !== dr ? dl : dr;
    const h2 = h / 64;
    const r2 = f.f(x0 + h2);
    const l2 = f.f(x0 - h2);
    const two = dr !== dr ? (l2 === l2 ? (c - l2) / h2 : Number.NaN) : (r2 === r2 ? (r2 - c) / h2 : Number.NaN);
    if (two === two && one !== 0 && Math.sign(two) === Math.sign(one) && Math.abs(two) > 4 * Math.max(1, Math.abs(one))) {
      return { d: one > 0 ? Infinity : -Infinity };
    }
    return { d: one };
  }
  const d1 = Math.abs(dl - dr);
  if (d1 > tol * Math.max(1, Math.abs(dl), Math.abs(dr))) {
    const h2 = h / 64;
    const r2 = f.f(x0 + h2);
    const l2 = f.f(x0 - h2);
    if (r2 === r2 && l2 === l2) {
      const d2 = Math.abs((c - l2) / h2 - (r2 - c) / h2);
      if (d2 > d1 / 8) return { corner: true };
    }
  }
  return { d: (dl + dr) / 2 };
}

/** Derivative sampler of order `n` with per-evaluation reasons. */
function derivSampler(f: Sampled1, n: number, tol: number): { readonly f: Fn1; lastReason: () => UndefReason | undefined } {
  let why: UndefReason | undefined;
  if (n === 1) {
    return {
      f: (x: number): number => {
        const s = slopeAt(f, x, tol);
        if ('d' in s) {
          why = undefined;
          return s.d;
        }
        why = 'corner' in s ? 'corner' : (f.lastReason ?? 'not_finite');
        return Number.NaN;
      },
      lastReason: () => why,
    };
  }
  return {
    f: (x: number): number => {
      let spent = 0;
      const v = derivativeAt(f.f, x, n, (c) => (spent += c) <= 4096);
      if (v !== v) {
        why = f.lastReason ?? 'not_finite';
        return Number.NaN;
      }
      why = undefined;
      return v;
    },
    lastReason: () => why,
  };
}

function runDerivative(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const hasN = call.args.length > 1 && !call.args[1]?.omitted;
  const n = hasN ? orderArg(call, 1, 20) : 1;
  if (n === undefined) return undefined;
  if (n === 0) return call.values[0];
  const s = derivSampler(f, n, call.tol);
  return fn1Value(s.f, s.lastReason);
}

function runNDerivative(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const s = derivSampler(f, 1, call.tol);
  return fn1Value(s.f, s.lastReason);
}

function runDerivative2(call: RuleCall, formIndex: number): unknown {
  const g = reqFn2(call, 0);
  if (!g) return undefined;
  const binder = call.args[1]?.binder;
  if (binder !== 'x' && binder !== 'y') return call.fail('bad_argument', 'The variable is the name x or y.');
  const v = binder === 'x' ? 0 : 1;
  const hasN = formIndex === 1;
  const n = hasN ? orderArg(call, 2, 20) : 1;
  if (n === undefined) return undefined;
  if (n === 0) return call.values[0];
  const tol = call.tol;
  let why: UndefReason | undefined;
  const one = (h: (x: number, y: number) => number): ((x: number, y: number) => number) => (x, y) => {
    const t = v === 0 ? x : y;
    const st = 6e-6 * Math.max(1, Math.abs(t));
    const a = v === 0 ? h(x + st, y) : h(x, y + st);
    const b = v === 0 ? h(x - st, y) : h(x, y - st);
    if (a !== a || b !== b) {
      why = g.lastReason ?? 'not_finite';
      return Number.NaN;
    }
    why = undefined;
    return (a - b) / (2 * st);
  };
  let f = g.f;
  for (let k = 0; k < n; k++) f = one(f);
  void tol;
  return fn2Value(f, () => why);
}

function runSlope(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  const x0 = numArg(call, 1);
  if (!f || x0 === undefined) return call.fail('bad_argument', 'Slope needs a function and a point.');
  const s = slopeAt(f, x0, call.tol);
  if ('d' in s) return s.d;
  if ('corner' in s) return call.fail('corner', `f has a corner at ${fmt(x0)}; use Limit of the difference quotient from one side.`);
  return call.fail(f.lastReason ?? 'not_finite', `f is not defined at ${fmt(x0)}.`);
}

function runTangent(call: RuleCall, normal: boolean): unknown {
  const f = reqFn1(call, 0);
  const x0 = numArg(call, 1);
  if (!f || x0 === undefined) return call.fail('bad_argument', `${normal ? 'Normal' : 'Tangent'} needs a function and a point.`);
  const y0 = f.f(x0);
  if (y0 !== y0) return call.fail(f.lastReason ?? 'not_finite', `f is not defined at ${fmt(x0)}.`);
  const s = slopeAt(f, x0, call.tol);
  if ('corner' in s) return call.fail('corner', `f has a corner at ${fmt(x0)}.`);
  if ('undef' in s) return call.fail(f.lastReason ?? 'not_finite', `f has no slope at ${fmt(x0)}.`);
  const m = normal ? (s.d === 0 ? Infinity : -1 / s.d) : s.d;
  return lineFromPointSlope(x0, y0, m) ?? call.fail('not_finite', 'The line could not be built.');
}

function runCurvatureFn(call: RuleCall, mode: 'k' | 'v' | 'circle'): unknown {
  const f = reqFn1(call, 0);
  const x0 = numArg(call, 1);
  if (!f || x0 === undefined) return call.fail('bad_argument', 'This command needs a function and a point.');
  const y0 = f.f(x0);
  if (y0 !== y0) return call.fail(f.lastReason ?? 'not_finite', `f is not defined at ${fmt(x0)}.`);
  const s = slopeAt(f, x0, call.tol);
  if ('corner' in s) return call.fail('corner', `f has a corner at ${fmt(x0)}.`);
  if ('undef' in s) return call.fail(f.lastReason ?? 'not_finite', `f has no slope at ${fmt(x0)}.`);
  const d1 = s.d;
  const d2 = diff2(f.f, x0);
  if (d2 !== d2) return call.fail(f.lastReason ?? 'not_finite', `f has no second derivative at ${fmt(x0)}.`);
  const den = Math.pow(1 + d1 * d1, 1.5);
  const h = 1.2e-4 * Math.max(1, Math.abs(x0));
  const straight = kappaStraight(Math.abs(d2), Math.max(1, Math.abs(y0)) / (h * h));
  const kappa = straight ? 0 : d2 / den;
  const nl = Math.hypot(d1, 1);
  const nx = -d1 / nl;
  const ny = 1 / nl;
  if (mode === 'k') return kappa;
  if (mode === 'v') return { x: kappa * nx, y: kappa * ny };
  if (straight || kappa === 0) return call.fail('infinite_radius', 'The curve is straight here; Tangent(f, x0) is the best fit.');
  return { cx: x0 + nx / kappa, cy: y0 + ny / kappa, r: 1 / Math.abs(kappa) };
}

/* ------------------------------ integrals ------------------------------ */

/** A fixed work budget for lazy closure evaluation, which runs outside any rule's budget. */
function cappedWork(limit: number): RuleWork {
  let used = 0;
  return {
    limit,
    get used() {
      return used;
    },
    get left() {
      return Math.max(0, limit - used);
    },
    spend: (n = 1): boolean => {
      used += typeof n === 'number' && n > 0 ? n : 1;
      return used <= limit;
    },
  };
}

function quadOpts(call: RuleCall): { tolAbs: number; tolRel: number; maxDepth: number; work: RuleWork } {
  return { tolAbs: 1e-10, tolRel: 1e-10, maxDepth: 20, work: call.work };
}

function runIntegralDef(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  const a = numArg(call, 1);
  const b = numArg(call, 2);
  if (!f || a === undefined || b === undefined) return call.fail('bad_argument', 'Integral needs a function and bounds.');
  const r = quad(f.f, a, b, quadOpts(call));
  if (r.divergesAt !== undefined) {
    const at = r.divergesAt === Infinity || r.divergesAt === -Infinity ? 'near infinity' : `near x = ${fmt(r.divergesAt)}`;
    return call.fail('diverges', `f is not integrable ${at}.`);
  }
  // step_limit keeps the best estimate as a defined value (the warning channel does not exist yet).
  return r.value;
}

function runIntegralBetween(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  const g = reqFn1(call, 1);
  const a = numArg(call, 2);
  const b = numArg(call, 3);
  if (!f || !g || a === undefined || b === undefined) return call.fail('bad_argument', 'Integral needs two functions and bounds.');
  const h = (x: number): number => {
    const u = f.f(x);
    const v = g.f(x);
    return u === u && v === v ? u - v : Number.NaN;
  };
  const r = quad(h, a, b, quadOpts(call));
  if (r.divergesAt !== undefined) {
    const at = r.divergesAt === Infinity || r.divergesAt === -Infinity ? 'near infinity' : `near x = ${fmt(r.divergesAt)}`;
    return call.fail('diverges', `f - g is not integrable ${at}.`);
  }
  return r.value;
}

/**
 * Numeric antiderivative `F(x) = c0 + integral(x0..x)` with a panel cache (functions
 * design 7): unit panels are integrated once each; `F` is a prefix sum plus one
 * partial panel. Lazy evaluation uses fixed internal caps (|x - x0| <= 4096).
 */
function antiderivative(f: Fn1, x0: number, c0: number): { readonly f: Fn1; lastReason: () => UndefReason | undefined } {
  const panels = new Map<number, number>();
  let why: UndefReason | undefined;
  const panelOf = (x: number): number => Math.floor(x - x0);
  const panelQuad = (k: number): number => {
    const hit = panels.get(k);
    if (hit !== undefined) return hit;
    const r = quad(f, x0 + k, x0 + k + 1, { tolAbs: 1e-10, tolRel: 1e-10, maxDepth: 20, work: cappedWork(50000) });
    const v = r.divergesAt !== undefined ? Number.NaN : r.value;
    panels.set(k, v);
    return v;
  };
  const evalF = (x: number): number => {
    if (x !== x) {
      why = 'not_finite';
      return Number.NaN;
    }
    if (Math.abs(x - x0) > 4096) {
      why = 'step_limit';
      return Number.NaN;
    }
    const k = panelOf(x);
    let sum = 0;
    if (x >= x0) {
      for (let j = 0; j < k; j++) {
        const v = panelQuad(j);
        if (v !== v) {
          why = 'diverges';
          return Number.NaN;
        }
        sum += v;
      }
      const r = quad(f, x0 + k, x, { tolAbs: 1e-10, tolRel: 1e-10, maxDepth: 20, work: cappedWork(50000) });
      if (r.divergesAt !== undefined || r.value !== r.value) {
        why = r.divergesAt !== undefined ? 'diverges' : 'step_limit';
        return Number.NaN;
      }
      sum += r.value;
    } else {
      let back = 0;
      for (let j = -1; j > k; j--) {
        const v = panelQuad(j);
        if (v !== v) {
          why = 'diverges';
          return Number.NaN;
        }
        back += v;
      }
      const r = quad(f, x, x0 + k + 1, { tolAbs: 1e-10, tolRel: 1e-10, maxDepth: 20, work: cappedWork(50000) });
      if (r.divergesAt !== undefined || r.value !== r.value) {
        why = r.divergesAt !== undefined ? 'diverges' : 'step_limit';
        return Number.NaN;
      }
      why = undefined;
      return c0 - back - r.value;
    }
    why = undefined;
    return c0 + sum;
  };
  return { f: evalF, lastReason: () => why };
}

function runIntegralIndef(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const a = antiderivative(f.f, 0, 0);
  return fn1Value(a.f, a.lastReason);
}

function runIntegralThrough(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  const v = call.values[1];
  if (!f || typeof v !== 'object' || v === null) return call.fail('bad_argument', 'Integral needs a function and a point.');
  const q = v as Pt;
  if (typeof q.x !== 'number' || typeof q.y !== 'number') return call.fail('bad_argument', 'Integral needs a function and a point.');
  if (!isFin(q.x) || !isFin(q.y)) return call.fail('bad_argument', 'The point must be finite.');
  const a = antiderivative(f.f, q.x, q.y);
  return fn1Value(a.f, a.lastReason);
}

function runIntegralPartial2(call: RuleCall): unknown {
  const g = reqFn2(call, 0);
  if (!g) return undefined;
  const binder = call.args[1]?.binder;
  if (binder !== 'x' && binder !== 'y') return call.fail('bad_argument', 'The variable is the name x or y.');
  const v = binder === 'x' ? 0 : 1;
  let why: UndefReason | undefined;
  // Panel cache per outer value (heat-map rows share it).
  const rows = new Map<number, Map<number, number>>();
  const order: number[] = [];
  const f = (x: number, y: number): number => {
    const outer = v === 0 ? y : x;
    const inner = v === 0 ? x : y;
    if (outer !== outer || inner !== inner) {
      why = 'not_finite';
      return Number.NaN;
    }
    if (Math.abs(inner) > 4096) {
      why = 'step_limit';
      return Number.NaN;
    }
    let row = rows.get(outer);
    if (!row) {
      row = new Map<number, number>();
      rows.set(outer, row);
      order.push(outer);
      if (order.length > 1024) rows.delete(order.shift() as number);
    }
    const g1 = (t: number): number => (v === 0 ? g.f(t, outer) : g.f(outer, t));
    const k = Math.floor(inner);
    const panel = (j: number): number => {
      const hit = (row as Map<number, number>).get(j);
      if (hit !== undefined) return hit;
      const r = quad(g1, j, j + 1, { tolAbs: 1e-10, tolRel: 1e-10, maxDepth: 20, work: cappedWork(50000) });
      const w = r.divergesAt !== undefined ? Number.NaN : r.value;
      (row as Map<number, number>).set(j, w);
      return w;
    };
    let sum = 0;
    if (inner >= 0) {
      for (let j = 0; j < k; j++) {
        const w = panel(j);
        if (w !== w) {
          why = 'diverges';
          return Number.NaN;
        }
        sum += w;
      }
      const r = quad(g1, k, inner, { tolAbs: 1e-10, tolRel: 1e-10, maxDepth: 20, work: cappedWork(50000) });
      if (r.divergesAt !== undefined || r.value !== r.value) {
        why = r.divergesAt !== undefined ? 'diverges' : 'step_limit';
        return Number.NaN;
      }
      sum += r.value;
    } else {
      for (let j = -1; j > k; j--) {
        const w = panel(j);
        if (w !== w) {
          why = 'diverges';
          return Number.NaN;
        }
        sum += w;
      }
      const r = quad(g1, inner, k + 1, { tolAbs: 1e-10, tolRel: 1e-10, maxDepth: 20, work: cappedWork(50000) });
      if (r.divergesAt !== undefined || r.value !== r.value) {
        why = r.divergesAt !== undefined ? 'diverges' : 'step_limit';
        return Number.NaN;
      }
      sum -= r.value;
    }
    why = undefined;
    return sum;
  };
  return fn2Value(f, () => why);
}

function runIntegralOut(call: RuleCall): unknown {
  const g = reqFn2(call, 0);
  if (!g) return undefined;
  const binder = call.args[1]?.binder;
  const a = numArg(call, 2);
  const b = numArg(call, 3);
  if (binder !== 'x' && binder !== 'y') return call.fail('bad_argument', 'The variable is the name x or y.');
  if (a === undefined || b === undefined) return call.fail('bad_argument', 'Integral needs bounds.');
  const v = binder === 'x' ? 0 : 1;
  let why: UndefReason | undefined;
  const memo = new Map<number, number>();
  const order: number[] = [];
  const f = (t: number): number => {
    if (t !== t) {
      why = 'not_finite';
      return Number.NaN;
    }
    const hit = memo.get(t);
    if (hit !== undefined) {
      why = undefined;
      return hit;
    }
    const g1 = (s: number): number => (v === 0 ? g.f(s, t) : g.f(t, s));
    const r = quad(g1, a, b, { tolAbs: 1e-10, tolRel: 1e-10, maxDepth: 20, work: cappedWork(50000) });
    if (r.divergesAt !== undefined || r.value !== r.value) {
      why = r.divergesAt !== undefined ? 'diverges' : 'step_limit';
      return Number.NaN;
    }
    memo.set(t, r.value);
    order.push(t);
    if (order.length > 4096) memo.delete(order.shift() as number);
    why = undefined;
    return r.value;
  };
  return fn1Value(f, () => why);
}

/* ------------------------------ AreaUnder, Riemann ------------------------------ */

function runAreaUnder(call: RuleCall, withG: boolean): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const g = withG ? reqFn1(call, 1) : null;
  if (withG && !g) return undefined;
  const ai = withG ? 2 : 1;
  const a = numArg(call, ai);
  const b = numArg(call, ai + 1);
  if (a === undefined || b === undefined) return call.fail('bad_argument', 'AreaUnder needs a function and bounds.');
  const gg = g as Sampled1 | null;
  const h = (x: number): number => {
    const u = f.f(x);
    if (!gg) return u;
    const v = gg.f(x);
    return u === u && v === v ? u - v : Number.NaN;
  };
  const val = quad(h, a, b, quadOpts(call));
  if (val.divergesAt !== undefined) return call.fail('diverges', 'The signed integral does not converge.');
  const abs = quad((x) => {
    const v = h(x);
    return v === v ? Math.abs(v) : Number.NaN;
  }, a, b, quadOpts(call));
  if (abs.divergesAt !== undefined) return call.fail('diverges', 'The area integral does not converge.');
  const data: RegionData = {
    kind: 'region',
    shape: { t: 'under', a, b },
    value: val.value,
    area: abs.value,
    f: f.f,
    g: gg ? gg.f : null,
  };
  return data;
}

const SUM_RULES = ['left', 'right', 'mid', 'upper', 'lower', 'trapezoid', 'simpson'] as const;

function runRiemann(call: RuleCall, fixedRule?: string): unknown {
  const f = reqFn1(call, 0);
  const a = numArg(call, 1);
  const b = numArg(call, 2);
  const n0 = numArg(call, 3);
  if (!f || a === undefined || b === undefined || n0 === undefined) return call.fail('bad_argument', 'Riemann needs a function, bounds and a count.');
  if (!isFin(a) || !isFin(b)) return call.fail('bad_argument', 'Riemann needs finite bounds.');
  if (!Number.isInteger(n0) || n0 < 1) return call.fail('bad_argument', 'The slice count must be a whole number of 1 or more.');
  if (n0 > 100000) return call.fail('limit', 'Riemann takes at most 100000 slices.');
  let rule = fixedRule ?? 'left';
  let offset = 0;
  if (fixedRule === undefined && call.args.length > 4 && !call.args[4]?.omitted) {
    const v = call.values[4];
    if (typeof v === 'string') {
      if (!(SUM_RULES as readonly string[]).includes(v)) return call.fail('bad_argument', 'The rule is one of "left" "right" "mid" "upper" "lower" "trapezoid" "simpson".');
      rule = v;
    } else if (typeof v === 'number') {
      if (!(v >= 0 && v <= 1)) return call.fail('bad_argument', 'The offset is a fraction from 0 to 1.');
      offset = v;
      rule = 'offset';
    } else return call.fail('bad_argument', 'The fifth argument is a rule name or an offset fraction.');
  }
  let n = n0;
  if (rule === 'simpson' && n % 2 === 1) n++;
  const work = call.work;
  const h = (b - a) / n;
  // Kahan-compensated sums.
  let value = 0;
  let area = 0;
  let cv = 0;
  let ca = 0;
  const add = (signed: number): boolean => {
    if (signed !== signed) return false;
    const y = signed - cv;
    const t = value + y;
    cv = t - value - y;
    value = t;
    const ay = Math.abs(signed) - ca;
    const at = area + ay;
    ca = at - area - ay;
    area = at;
    return true;
  };
  const at = (x: number): number => {
    if (!work.spend(1)) return Number.NaN;
    return f.f(x);
  };
  const failBudget = (): unknown => call.fail('timeout', 'The work budget ran out.');
  if (rule === 'trapezoid') {
    const fa = at(a);
    const fb = at(b);
    if (fa !== fa || fb !== fb) return call.fail(f.lastReason ?? 'not_finite', 'f is not defined at an end point.');
    if (!add((h * fa) / 2) || !add((h * fb) / 2)) return failBudget();
    for (let i = 1; i < n; i++) {
      const v = at(a + i * h);
      if (v !== v) return call.fail(f.lastReason ?? 'not_finite', `f is not defined at ${fmt(a + i * h)}.`);
      if (!add(h * v)) return failBudget();
    }
  } else if (rule === 'simpson') {
    for (let i = 0; i < n; i += 2) {
      const x0 = a + i * h;
      const v0 = at(x0);
      const v1 = at(x0 + h);
      const v2 = at(x0 + 2 * h);
      if (v0 !== v0 || v1 !== v1 || v2 !== v2) return call.fail(f.lastReason ?? 'not_finite', 'f is not defined on a slice.');
      if (!add((h / 3) * (v0 + 4 * v1 + v2))) return failBudget();
    }
  } else if (rule === 'upper' || rule === 'lower') {
    const sgn = rule === 'upper' ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const l = a + i * h;
      const r = l + h;
      const m = riemannSliceExtremum(f.f, l, r, sgn, work);
      if (m === null) return call.fail(f.lastReason ?? 'not_finite', 'f is not defined on a slice.');
      if (m === 'spent') return failBudget();
      if (!add(h * m)) return failBudget();
    }
  } else {
    const o = rule === 'left' ? 0 : rule === 'right' ? 1 : rule === 'mid' ? 0.5 : offset;
    for (let i = 0; i < n; i++) {
      const v = at(a + (i + o) * h);
      if (v !== v) return call.fail(f.lastReason ?? 'not_finite', `f is not defined at ${fmt(a + (i + o) * h)}.`);
      if (!add(h * v)) return failBudget();
    }
  }
  const data: RegionData = {
    kind: 'region',
    shape: { t: 'bars', a, b, n, rule, offset: rule === 'offset' ? offset : rule === 'left' ? 0 : rule === 'right' ? 1 : rule === 'mid' ? 0.5 : 0 },
    value,
    area,
    f: f.f,
    g: null,
  };
  return data;
}

/* ------------------------------ roots and extrema ------------------------------ */

function intervalAB(call: RuleCall, ai: number): { readonly a: number; readonly b: number } | undefined {
  const a0 = numArg(call, ai);
  const b0 = numArg(call, ai + 1);
  if (a0 === undefined || b0 === undefined) return undefined;
  if (!isFin(a0) || !isFin(b0)) {
    call.fail('bad_argument', 'The interval bounds must be finite.');
    return undefined;
  }
  if (a0 === b0) {
    call.fail('empty_interval', 'The interval is empty.');
    return undefined;
  }
  return { a: Math.min(a0, b0), b: Math.max(a0, b0) };
}

/** Leftmost-first root search result shared by `Root` and `Roots`. */
function rootsOn(call: RuleCall, f: Sampled1, a: number, b: number): { readonly roots: readonly number[]; readonly identicalZero: boolean } | undefined {
  const rr = findRoots(f.f, a, b, call.tol, call.work, 512);
  if (rr.spent) {
    call.fail('timeout', 'The work budget ran out.');
    return undefined;
  }
  return { roots: rr.roots, identicalZero: rr.identicalZero };
}

function runRootInterval(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const ab = intervalAB(call, 1);
  if (!ab) return undefined;
  const r = rootsOn(call, f, ab.a, ab.b);
  if (!r) return undefined;
  if (r.identicalZero) return { x: ab.a, y: 0 };
  if (r.roots.length > 0) {
    const x = r.roots[0] as number;
    return { x, y: 0 };
  }
  // Detail names the smallest absolute value, per the errors doc example.
  let bx = ab.a;
  let bv = Infinity;
  for (let i = 0; i <= 256; i++) {
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    const x = ab.a + ((ab.b - ab.a) * i) / 256;
    const v = Math.abs(f.f(x));
    if (v === v && v < bv) {
      bv = v;
      bx = x;
    }
  }
  return call.fail('no_root', `f has no sign change and no tangent touch on [${fmt(ab.a)}, ${fmt(ab.b)}]; its smallest absolute value there is ${fmt(bv)} at x = ${fmt(bx)}.`);
}

function runRootStart(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  const x0 = numArg(call, 1);
  if (!f || x0 === undefined) return call.fail('bad_argument', 'Root needs a function and a start value or interval.');
  if (!isFin(x0)) return call.fail('bad_argument', 'The start value must be finite.');
  const tol = call.tol;
  const r = newton(f.f, x0, call.work, tol);
  if (r === r) {
    const v = f.f(r);
    if (v === v && Math.abs(v) <= Math.sqrt(tol) * Math.max(1, Math.abs(f.f(x0)))) return { x: r, y: 0 };
  }
  // Expand a bracket outward by doubling, then Brent.
  let d = Math.max(1, Math.abs(x0)) / 4;
  for (let i = 0; i < 60; i++) {
    if (!call.work.spend(2)) return call.fail('timeout', 'The work budget ran out.');
    const lo = x0 - d;
    const hi = x0 + d;
    const a = f.f(lo);
    const b = f.f(hi);
    if (a === a && b === b && ((a < 0 && b > 0) || (a > 0 && b < 0))) {
      const root = brent(f.f, lo, hi, call.work);
      if (root === root) return { x: root, y: 0 };
      return call.fail('no_convergence', 'The iteration did not settle.');
    }
    d *= 2;
    if (!(d < 1e300)) break;
  }
  return call.fail('no_root', `No root was found near ${fmt(x0)}.`);
}

function runRootsInterval(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const ab = intervalAB(call, 1);
  if (!ab) return undefined;
  const r = rootsOn(call, f, ab.a, ab.b);
  if (!r) return undefined;
  if (r.identicalZero) return call.fail('identically_zero', 'Every x is a root.');
  return r.roots.map((x) => ({ x, y: 0 }));
}

function trimZeros(c: readonly number[]): number[] {
  let d = c.length - 1;
  while (d > 0 && c[d] === 0) d--;
  return c.slice(0, d + 1);
}

/** Roots of the interpolant itself by recursive derivative isolation (exact algebra, no sampling). */
function interpRoots(c: readonly number[], tol: number, work: RuleWork): { readonly roots: number[]; readonly spent: boolean } {
  const t = trimZeros(c);
  const d = t.length - 1;
  if (d <= 0) return { roots: [], spent: false };
  if (d === 1) return { roots: [-(t[0] as number) / (t[1] as number)], spent: false };
  const sub = interpRoots(trimZeros(polyDeriv(t)), tol, work);
  if (sub.spent) return sub;
  const B = Math.min(cauchyBound(t), 1e12);
  const f = (x: number): number => polyEval(t, x);
  const pts = [-B, ...sub.roots.filter((x) => x > -B && x < B), B].sort((p, q) => p - q);
  let scale = 1;
  for (const x of pts) {
    const v = Math.abs(f(x));
    if (v > scale) scale = v;
  }
  const out: number[] = [];
  for (const cp of sub.roots) {
    if (!work.spend(4)) return { roots: out, spent: true };
    if (Math.abs(f(cp)) <= Math.sqrt(tol) * scale) {
      const r = newton(f, cp, work, tol);
      out.push(r === r ? r : cp);
    }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const lo = pts[i] as number;
    const hi = pts[i + 1] as number;
    if (!work.spend(2)) return { roots: out, spent: true };
    const a = f(lo);
    const b = f(hi);
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      const r = brent(f, lo, hi, work);
      if (r === r) out.push(r);
    } else if (a === 0) out.push(lo);
  }
  out.sort((p, q) => p - q);
  const dd: number[] = [];
  for (const x of out) {
    const last = dd[dd.length - 1];
    if (last === undefined || Math.abs(x - last) > tol * Math.max(1, Math.abs(x))) dd.push(x);
  }
  return { roots: dd, spent: false };
}

function runRootsPoly(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const tol = call.tol;
  const det = detectPolynomial(f.f, 0, tol, call.work);
  if (det.spent) return call.fail('timeout', 'The work budget ran out.');
  if (det.degree === null || !det.coeffs) return call.fail('needs_interval', 'f is not a polynomial of degree 20 or less, so Roots needs an interval.');
  const coeffs = det.coeffs.slice(0, det.degree + 1);
  if (det.degree === 0) {
    return Math.abs(coeffs[0] as number) <= tol ? call.fail('identically_zero', 'Every x is a root.') : [];
  }
  // True-function scale for verification.
  let scale = 1;
  for (let i = 0; i <= 8; i++) {
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    const v = Math.abs(f.f(-4 + i));
    if (v === v && v > scale) scale = v;
  }
  const out: number[] = [];
  const iso = interpRoots(coeffs, tol, call.work);
  if (iso.spent) return call.fail('timeout', 'The work budget ran out.');
  for (const r of iso.roots) {
    const nr = newton(f.f, r, call.work, tol);
    const at = nr === nr ? nr : r;
    const v = f.f(at);
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    if (v === v && Math.abs(v) <= Math.sqrt(tol) * scale) out.push(at);
  }
  // Plus a direct scan on the Cauchy bound, in case interpolation brackets missed any.
  const B = Math.min(cauchyBound(coeffs), 1e9);
  const scan = findRoots(f.f, -B, B, tol, call.work, 512);
  if (scan.spent) return call.fail('timeout', 'The work budget ran out.');
  for (const r of scan.roots) out.push(r);
  out.sort((p, q) => p - q);
  const dd: number[] = [];
  for (const x of out) {
    const last = dd[dd.length - 1];
    if (last === undefined || Math.abs(x - last) > tol * Math.max(1, Math.abs(x))) dd.push(x);
  }
  return dd.map((x) => ({ x, y: 0 }));
}

function runRootsGuesses(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const gv = call.values[1];
  const guesses: number[] = [];
  if (gv instanceof Float64Array) {
    for (let i = 0; i < gv.length; i++) guesses.push(gv[i] as number);
  } else if (Array.isArray(gv)) {
    for (const e of gv) if (typeof e === 'number') guesses.push(e);
  } else return call.fail('bad_argument', 'Roots needs a list of start values.');
  const tol = call.tol;
  const out: number[] = [];
  for (const x0 of guesses) {
    if (!isFin(x0)) continue;
    const r = newton(f.f, x0, call.work, tol);
    if (r === r) {
      const v = f.f(r);
      if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
      if (v === v && Math.abs(v) <= Math.sqrt(tol) * Math.max(1, Math.abs(f.f(x0)))) out.push(r);
    }
  }
  out.sort((p, q) => p - q);
  const dd: number[] = [];
  for (const x of out) {
    const last = dd[dd.length - 1];
    if (last === undefined || Math.abs(x - last) > tol * Math.max(1, Math.abs(x))) dd.push(x);
  }
  return dd.map((x) => ({ x, y: 0 }));
}

/** Critical points of `f` on `[a, b]` (zeros of the numeric first derivative). */
function criticals(call: RuleCall, f: Sampled1, a: number, b: number): { readonly pts: number[] } | undefined {
  const dp = (x: number): number => diff1(f.f, x);
  const rr = findRoots(dp, a, b, call.tol, call.work, 512);
  if (rr.spent) {
    call.fail('timeout', 'The work budget ran out.');
    return undefined;
  }
  return { pts: [...rr.roots] };
}

function runExtremumInterval(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const ab = intervalAB(call, 1);
  if (!ab) return undefined;
  if (ab.b - ab.a > 1e6) return call.fail('limit', 'Extremum takes a search interval up to 1e6 wide.');
  const cr = criticals(call, f, ab.a, ab.b);
  if (!cr) return undefined;
  const dp = (x: number): number => diff1(f.f, x);
  const out: Pt[] = [];
  const bounds = [ab.a, ...cr.pts, ab.b];
  cr.pts.forEach((c, i) => {
    const l = 0.5 * ((bounds[i] as number) + c);
    const r = 0.5 * (c + (bounds[i + 2] as number));
    const dl = dp(l);
    const dr = dp(r);
    if (!call.work.spend(2)) return;
    if (dl !== dl || dr !== dr) return;
    if ((dl < 0 && dr > 0) || (dl > 0 && dr < 0)) {
      const y = f.f(c);
      if (y === y) out.push({ x: c, y });
    }
  });
  return out;
}

function runExtremumPoly(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const tol = call.tol;
  const det = detectPolynomial(f.f, 0, tol, call.work);
  if (det.spent) return call.fail('timeout', 'The work budget ran out.');
  if (det.degree === null || !det.coeffs) return call.fail('needs_interval', 'f is not a polynomial of degree 20 or less, so Extremum needs an interval.');
  if (det.degree <= 1) return [];
  const B = Math.min(cauchyBound(det.coeffs), 1e9);
  const dp = (x: number): number => diff1(f.f, x);
  const rr = findRoots(dp, -B, B, tol, call.work, 512);
  if (rr.spent) return call.fail('timeout', 'The work budget ran out.');
  const out: Pt[] = [];
  const bounds = [-B, ...rr.roots, B];
  rr.roots.forEach((c, i) => {
    const dl = dp(0.5 * ((bounds[i] as number) + c));
    const dr = dp(0.5 * (c + (bounds[i + 2] as number)));
    if (!call.work.spend(2)) return;
    if (dl !== dl || dr !== dr) return;
    if ((dl < 0 && dr > 0) || (dl > 0 && dr < 0)) {
      const y = f.f(c);
      if (y === y) out.push({ x: c, y });
    }
  });
  return out;
}

function runMinMax(call: RuleCall, wantMax: boolean): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const ab = intervalAB(call, 1);
  if (!ab) return undefined;
  const cr = criticals(call, f, ab.a, ab.b);
  if (!cr) return undefined;
  let bx = ab.a;
  let bv = f.f(ab.a);
  const consider = (x: number): void => {
    const v = f.f(x);
    if (!call.work.spend(1)) return;
    if (v !== v) return;
    if (bv !== bv || (wantMax ? v > bv : v < bv)) {
      bv = v;
      bx = x;
    }
  };
  consider(ab.b);
  for (const c of cr.pts) consider(c);
  if (bv !== bv) return call.fail('no_extremum', 'f is undefined everywhere on the interval.');
  return { x: bx, y: bv };
}

function runInflectionInterval(call: RuleCall, polyOnly: boolean): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const tol = call.tol;
  let a: number;
  let b: number;
  if (polyOnly) {
    const det = detectPolynomial(f.f, 0, tol, call.work);
    if (det.spent) return call.fail('timeout', 'The work budget ran out.');
    if (det.degree === null || !det.coeffs) return call.fail('needs_interval', 'f is not a polynomial of degree 20 or less, so Inflection needs an interval.');
    if (det.degree <= 1) return [];
    const B = Math.min(cauchyBound(det.coeffs), 1e9);
    a = -B;
    b = B;
  } else {
    const ab = intervalAB(call, 1);
    if (!ab) return undefined;
    a = ab.a;
    b = ab.b;
  }
  const d2 = (x: number): number => diff2(f.f, x);
  const rr = findRoots(d2, a, b, tol, call.work, 512);
  if (rr.spent) return call.fail('timeout', 'The work budget ran out.');
  const out: Pt[] = [];
  const bounds = [a, ...rr.roots, b];
  rr.roots.forEach((c, i) => {
    const dl = d2(0.5 * ((bounds[i] as number) + c));
    const dr = d2(0.5 * (c + (bounds[i + 2] as number)));
    if (!call.work.spend(2)) return;
    if (dl !== dl || dr !== dr) return;
    if ((dl < 0 && dr > 0) || (dl > 0 && dr < 0)) {
      const y = f.f(c);
      if (y === y) out.push({ x: c, y });
    }
  });
  return out;
}

function runHole(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const ab = intervalAB(call, 1);
  if (!ab) return undefined;
  const tol = call.tol;
  // Scan an even grid plus a lattice of simple fractions (an isolated hole sits on a nice
  // number far more often than on a grid point); each undefined run is localised and
  // checked by one-sided limits.
  const N = 2048;
  const xsSet = new Set<number>();
  for (let i = 0; i <= N; i++) xsSet.add(ab.a + ((ab.b - ab.a) * i) / N);
  const lo = Math.min(ab.a, ab.b);
  const hi = Math.max(ab.a, ab.b);
  let step = 1 / 120;
  while ((hi - lo) / step > 4096) step *= 2;
  for (let k = Math.ceil(lo / step); k * step <= hi; k++) xsSet.add(k * step);
  const xs = [...xsSet].sort((u, v) => u - v);
  const nan: boolean[] = [];
  for (const x of xs) {
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    const v = f.f(x);
    nan.push(v !== v);
  }
  const out: Pt[] = [];
  const last = xs.length - 1;
  let i = 1;
  while (i < last) {
    if (!nan[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < last && nan[j + 1]) j++;
    const c = ((xs[i] as number) + (xs[j] as number)) / 2;
    const left = limitOneSided(f.f, c, -1, tol, call.work);
    const right = limitOneSided(f.f, c, 1, tol, call.work);
    if (left.spent || right.spent) return call.fail('timeout', 'The work budget ran out.');
    if (left.t === 'value' && right.t === 'value' && Math.abs(left.v - right.v) <= tol * Math.max(1, Math.abs(left.v), Math.abs(right.v))) {
      out.push({ x: c, y: (left.v + right.v) / 2 });
    }
    i = j + 1;
  }
  return out;
}

function runIntersectFn(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  const g = reqFn1(call, 1);
  if (!f || !g) return undefined;
  const ab = intervalAB(call, 2);
  if (!ab) return undefined;
  const h = (x: number): number => {
    const u = f.f(x);
    const v = g.f(x);
    return u === u && v === v ? u - v : Number.NaN;
  };
  const rr = findRoots(h, ab.a, ab.b, call.tol, call.work, 512);
  if (rr.spent) return call.fail('timeout', 'The work budget ran out.');
  if (rr.identicalZero) return call.fail('identically_zero', 'f and g agree everywhere on the interval.');
  const out: Pt[] = [];
  for (const x of rr.roots) {
    const y = f.f(x);
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    if (y === y) out.push({ x, y });
  }
  return out;
}

/** Supremum (`sgn` 1) or infimum (-1) of `f` on `[l, r]` by dense sampling plus golden refinement. */
function riemannSliceExtremum(f: Fn1, l: number, r: number, sgn: 1 | -1, work: RuleWork): number | 'spent' | null {
  const K = 17;
  let bx = l;
  let bv = sgn === 1 ? -Infinity : Infinity;
  for (let i = 0; i <= K; i++) {
    if (!work.spend(1)) return 'spent';
    const x = l + ((r - l) * i) / K;
    const v = f(x);
    if (v !== v) return null;
    if ((sgn === 1 && v > bv) || (sgn === -1 && v < bv)) {
      bv = v;
      bx = x;
    }
  }
  // Golden-section refine around the best sample.
  const w = (r - l) / K;
  const lo = Math.max(l, bx - w);
  const hi = Math.min(r, bx + w);
  const m = goldenMin((x: number) => {
    const v = f(x);
    return v === v ? -sgn * v : Number.NaN;
  }, lo, hi, work, 1e-9);
  if (m !== m) return bv;
  if (!work.spend(1)) return 'spent';
  const v = f(m);
  if (v !== v) return bv;
  return sgn === 1 ? Math.max(bv, v) : Math.min(bv, v);
}

/* ------------------------------ limits ------------------------------ */

type SideLimit = { readonly t: 'value'; readonly v: number } | { readonly t: 'inf'; readonly sign: 1 | -1 } | { readonly t: 'none' };

/**
 * One-sided limit by numeric extrapolation (functions design 8.5 route 3): samples
 * at `a +/- 10^-k` (or `+/-10^k` at infinity), growth classification, then Wynn's
 * epsilon algorithm with a direct-agreement fallback. Deterministic.
 */
function limitOneSided(f: Fn1, a: number, dir: 1 | -1, tol: number, work: RuleWork): SideLimit & { readonly spent: boolean } {
  const inf = a === Infinity || a === -Infinity;
  const xs: number[] = [];
  if (!inf) {
    for (let k = 2; k <= 14; k++) xs.push(a + dir * Math.pow(10, -k));
  } else {
    const s = a === Infinity ? 1 : -1;
    for (let k = 1; k <= 14; k++) xs.push(s * Math.pow(10, k));
  }
  const raw: number[] = [];
  for (const x of xs) {
    if (!work.spend(1)) return { t: 'none', spent: true };
    raw.push(f(x));
  }
  // Overflow tail: a finite monotone prefix growing past 1e6 and then only NaN
  // means the values overflowed on the way to infinity (exp at inf).
  let ni = raw.length;
  while (ni > 0 && raw[ni - 1] !== raw[ni - 1]) ni--;
  const head = raw.slice(0, ni);
  if (ni < raw.length && ni >= 2 && head.every((v) => v === v && v !== Infinity && v !== -Infinity)) {
    let up = true;
    let down = true;
    for (let i = 1; i < head.length; i++) {
      if (!((head[i] as number) > (head[i - 1] as number))) up = false;
      if (!((head[i] as number) < (head[i - 1] as number))) down = false;
    }
    const last = head[head.length - 1] as number;
    if (up && last > 1e6) return { t: 'inf', sign: 1, spent: false };
    if (down && last < -1e6) return { t: 'inf', sign: -1, spent: false };
  }
  const clean = raw.filter((v) => v === v);
  const finite = clean.filter((v) => v !== Infinity && v !== -Infinity);
  if (clean.some((v) => v === Infinity) && !clean.some((v) => v === -Infinity) && finite.every((v) => v > 0)) {
    return { t: 'inf', sign: 1, spent: false };
  }
  if (clean.some((v) => v === -Infinity) && !clean.some((v) => v === Infinity) && finite.every((v) => v < 0)) {
    return { t: 'inf', sign: -1, spent: false };
  }
  if (finite.length < 5) return { t: 'none', spent: false };
  // Growth: strictly monotone with the last beyond ten times the first.
  let monoUp = true;
  let monoDown = true;
  for (let i = 1; i < finite.length; i++) {
    if (!((finite[i] as number) > (finite[i - 1] as number))) monoUp = false;
    if (!((finite[i] as number) < (finite[i - 1] as number))) monoDown = false;
  }
  const first = Math.abs(finite[0] as number);
  const last = finite[finite.length - 1] as number;
  if (monoUp && last > 10 * Math.max(first, 1) && last > 10) {
    return { t: 'inf', sign: 1, spent: false };
  }
  if (monoDown && -last > 10 * Math.max(first, 1) && -last > 10) {
    return { t: 'inf', sign: -1, spent: false };
  }
  // Snap geometrically shrinking tails to exact zero (1/x, e^-x at infinity).
  const shrink = (v: number): number => {
    if (v !== 0 && Math.abs(v) < tol * 1e-6) return 0;
    if (v !== 0 && Math.abs(v) <= tol) {
      const t = finite.slice(-4);
      if (t.length === 4 && t.every((u, i) => i === 0 || (Math.abs(u) <= 0.6 * Math.abs(t[i - 1] as number) && Math.sign(u) === Math.sign(t[0] as number)))) {
        return 0;
      }
    }
    return v;
  };
  // Finite point: halving steps stay clear of cancellation noise (for example
  // (1 - cos x) / x^2 is garbage below 1e-4 but exact to 1e-12 from steps down to 2e-4).
  // The shortest prefix on which Wynn settles wins.
  if (!inf) {
    const hv: number[] = [];
    for (let k = 0; k < 9; k++) {
      if (!work.spend(1)) return { t: 'none', spent: true };
      hv.push(f(a + dir * 0.05 * Math.pow(2, -k)));
    }
    if (hv.every((v) => v === v && v !== Infinity && v !== -Infinity)) {
      for (let m = 5; m <= hv.length; m++) {
        const exh = wynn(hv.slice(0, m), tol);
        if (exh !== null) return { t: 'value', v: Math.abs(exh) < tol * 1e-6 ? 0 : exh, spent: false };
      }
    }
  }
  const seq = finite;
  // The shortest prefix on which Wynn settles wins: later samples may be rounding noise.
  for (let m = Math.min(5, seq.length); m <= seq.length; m++) {
    const ex = wynn(seq.slice(0, m), tol);
    if (ex !== null) return { t: 'value', v: shrink(ex), spent: false };
  }
  const tail = seq.slice(-3);
  const agree = Math.abs((tail[0] as number) - (tail[1] as number)) <= tol * Math.max(1, Math.abs(tail[1] as number)) &&
    Math.abs((tail[1] as number) - (tail[2] as number)) <= tol * Math.max(1, Math.abs(tail[2] as number));
  if (agree) return { t: 'value', v: shrink(tail[2] as number), spent: false };
  return { t: 'none', spent: false };
}

function sideText(s: SideLimit): string {
  if (s.t === 'value') return fmt(s.v);
  if (s.t === 'inf') return s.sign === 1 ? 'inf' : '-inf';
  return 'no limit';
}

function runLimit(call: RuleCall, withSide: boolean): unknown {
  const f = reqFn1(call, 0);
  const a = numArg(call, 1);
  if (!f || a === undefined) return call.fail('bad_argument', 'Limit needs a function and a point.');
  if (a !== a) return call.fail('bad_argument', 'The point must be a number or inf.');
  let side: 'left' | 'right' | 'both' = 'both';
  if (withSide) {
    const s = call.values[2];
    if (s !== 'left' && s !== 'right') return call.fail('bad_argument', 'The side is "left" or "right".');
    side = s;
  }
  const tol = call.tol;
  if (side !== 'both') {
    const one = limitOneSided(f.f, a, side === 'left' ? -1 : 1, tol, call.work);
    if (one.spent) return call.fail('timeout', 'The work budget ran out.');
    if (one.t === 'value') return one.v;
    if (one.t === 'inf') return one.sign === 1 ? Infinity : -Infinity;
    return call.fail('no_limit', `f does not settle from the ${side} at ${fmt(a)}.`);
  }
  const left = limitOneSided(f.f, a, -1, tol, call.work);
  const right = limitOneSided(f.f, a, 1, tol, call.work);
  if (left.spent || right.spent) return call.fail('timeout', 'The work budget ran out.');
  if (left.t === 'value' && right.t === 'value' && Math.abs(left.v - right.v) <= tol * Math.max(1, Math.abs(left.v), Math.abs(right.v))) {
    return (left.v + right.v) / 2;
  }
  if (left.t === 'inf' && right.t === 'inf' && left.sign === right.sign) return left.sign === 1 ? Infinity : -Infinity;
  return call.fail('no_limit', `From the left f tends to ${sideText(left)}, from the right to ${sideText(right)}.`);
}

/* ------------------------------ Taylor ------------------------------ */

function runTaylor(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  const a = numArg(call, 1);
  const n0 = numArg(call, 2);
  if (!f || a === undefined || n0 === undefined) return call.fail('bad_argument', 'Taylor needs a function, a centre and an order.');
  if (!isFin(a)) return call.fail('bad_argument', 'The centre must be finite.');
  if (!Number.isInteger(n0) || n0 < 0) return call.fail('bad_argument', 'The order must be a whole number of 0 or more.');
  if (n0 > 40) return call.fail('limit', 'Taylor takes an order up to 40.');
  if (n0 === 0) {
    const v = f.f(a);
    if (v !== v) return call.fail(f.lastReason ?? 'not_finite', `f is not defined at ${fmt(a)}.`);
    return fn1Value(() => v, () => undefined);
  }
  const tc = taylorCoeffs(f.f, a, n0, call.tol, call.work);
  if (!tc) return call.fail('no_convergence', 'The Taylor coefficients did not settle.');
  const c = Float64Array.from(tc.coeffs);
  // The constant term is f(a) exactly (a least-squares fit would miss it by fit noise);
  // where f(a) is undefined but the limit exists, the limit is the constant term.
  const fa = f.f(a);
  if (fa === fa) c[0] = fa;
  else {
    const left = limitOneSided(f.f, a, -1, call.tol, call.work);
    const right = limitOneSided(f.f, a, 1, call.tol, call.work);
    if (!left.spent && !right.spent && left.t === 'value' && right.t === 'value' &&
      Math.abs(left.v - right.v) <= call.tol * Math.max(1, Math.abs(left.v), Math.abs(right.v))) {
      c[0] = (left.v + right.v) / 2;
    }
  }
  return fn1Value((x) => {
    if (x !== x || x === Infinity || x === -Infinity) return Number.NaN;
    return polyEval(c, x - a);
  }, () => 'not_finite');
}

/* ------------------------------ Asymptote of a function ------------------------------ */

/**
 * Polishes a coarse pole location by Newton on the reciprocal, tolerating the NaN
 * at the pole itself: a step landing on NaN is halved back until defined. Falls
 * back to the coarse location. Deterministic.
 */
function poleRefine(rec: Fn1, bx: number, a: number, b: number, tol: number, work: RuleWork): number {
  let x = bx;
  let fx = rec(x);
  if (fx !== fx) return bx;
  for (let i = 0; i < 40; i++) {
    if (Math.abs(fx) <= tol) return x;
    if (!work.spend(3)) return x;
    const h = 6e-6 * Math.max(1, Math.abs(x));
    const d = (rec(x + h) - rec(x - h)) / (2 * h);
    if (d !== d || d === 0) return x;
    let step = fx / d;
    const maxStep = 4 * Math.max(1, Math.abs(x));
    if (Math.abs(step) > maxStep) step = step > 0 ? maxStep : -maxStep;
    let nx = x - step;
    let nfx = rec(nx);
    if (!work.spend(1)) return x;
    for (let k = 0; k < 10 && nfx !== nfx; k++) {
      step /= 2;
      nx = x - step;
      nfx = rec(nx);
      if (!work.spend(1)) return x;
    }
    if (nfx !== nfx) return x;
    if (nx < a || nx > b) return x;
    x = nx;
    fx = nfx;
  }
  return x;
}

/** Snaps a located point to the nearest simple fraction (k / 120) when it is within `tol` of it. */
function snapNice(x: number, tol: number): number {
  if (!Number.isFinite(x)) return x;
  const k = Math.round(x * 120) / 120;
  return Math.abs(x - k) <= tol * Math.max(1, Math.abs(x)) ? k : x;
}

function runAsymptoteFn(call: RuleCall, withRange: boolean): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  let a = -100;
  let b = 100;
  if (withRange) {
    const ab = intervalAB(call, 1);
    if (!ab) return undefined;
    a = ab.a;
    b = ab.b;
  }
  const tol = call.tol;
  if (b - a > 1e6) return call.fail('limit', 'Asymptote takes a search interval up to 1e6 wide.');
  // Vertical candidates: undefined runs and sign changes with a large or undefined middle.
  const N = 1024;
  const xs: number[] = [];
  const vs: number[] = [];
  for (let i = 0; i <= N; i++) {
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    const x = a + ((b - a) * i) / N;
    xs.push(x);
    vs.push(f.f(x));
  }
  const cand: number[] = [];
  let i = 0;
  while (i <= N) {
    if ((vs[i] as number) === (vs[i] as number)) {
      if (i < N && (vs[i + 1] as number) === (vs[i + 1] as number)) {
        const u = vs[i] as number;
        const v = vs[i + 1] as number;
        if ((u < 0 && v > 0) || (u > 0 && v < 0)) {
          const m = f.f(((xs[i] as number) + (xs[i + 1] as number)) / 2);
          if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
          if (m !== m || Math.abs(m) > 2 * Math.max(Math.abs(u), Math.abs(v), 1e-300)) {
            cand.push(((xs[i] as number) + (xs[i + 1] as number)) / 2);
          }
        }
      }
      i++;
      continue;
    }
    let j = i;
    while (j + 1 <= N && (vs[j + 1] as number) !== (vs[j + 1] as number)) j++;
    cand.push(((xs[i] as number) + (xs[j] as number)) / 2);
    i = j + 1;
  }
  const verts: number[] = [];
  for (const c of cand) {
    // Localise by maximising |f| over the neighbourhood, then polish with Newton on 1/f.
    const w = ((b - a) / N) * 4;
    const l = Math.max(a, c - w);
    const r = Math.min(b, c + w);
    let bx = c;
    let bv = -1;
    for (let k = 0; k <= 64; k++) {
      if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
      const x = l + ((r - l) * k) / 64;
      const v = Math.abs(f.f(x));
      if (v === v && v > bv) {
        bv = v;
        bx = x;
      }
    }
    const rec = (x: number): number => {
      const v = f.f(x);
      return v === v && v !== 0 ? 1 / v : Number.NaN;
    };
    const pole = snapNice(poleRefine(rec, bx, a, b, tol, call.work), 1e-9);
    const left = limitOneSided(f.f, pole, -1, tol, call.work);
    const right = limitOneSided(f.f, pole, 1, tol, call.work);
    if (left.spent || right.spent) return call.fail('timeout', 'The work budget ran out.');
    if (left.t === 'inf' || right.t === 'inf') verts.push(pole);
  }
  verts.sort((p, q) => p - q);
  const dv: number[] = [];
  for (const x of verts) {
    const last = dv[dv.length - 1];
    if (last === undefined || Math.abs(x - last) > tol * Math.max(1, Math.abs(x))) dv.push(x);
  }
  // Horizontal and oblique, each end.
  interface Ob { readonly m: number; readonly c: number }
  const obs: Ob[] = [];
  for (const end of [Infinity, -Infinity] as const) {
    const m = limitOneSided((x) => {
      const v = f.f(x);
      return v === v && x !== 0 ? v / x : Number.NaN;
    }, end, 1, tol, call.work);
    if (m.spent) return call.fail('timeout', 'The work budget ran out.');
    if (m.t !== 'value') continue;
    if (Math.abs(m.v) <= tol) {
      const c = limitOneSided(f.f, end, 1, tol, call.work);
      if (c.spent) return call.fail('timeout', 'The work budget ran out.');
      if (c.t === 'value') obs.push({ m: 0, c: c.v });
      continue;
    }
    const mv = m.v;
    const c = limitOneSided((x) => {
      const v = f.f(x);
      return v === v ? v - mv * x : Number.NaN;
    }, end, 1, tol, call.work);
    if (c.spent) return call.fail('timeout', 'The work budget ran out.');
    if (c.t === 'value') obs.push({ m: mv, c: c.v });
  }
  const lines: { readonly a: number; readonly b: number; readonly c: number }[] = dv.map((x) => ({ a: 1, b: 0, c: x }));
  const seen: Ob[] = [];
  for (const o of obs) {
    if (seen.some((s) => Math.abs(s.m - o.m) <= tol * Math.max(1, Math.abs(o.m)) && Math.abs(s.c - o.c) <= tol * Math.max(1, Math.abs(o.c)))) {
      continue;
    }
    seen.push(o);
  }
  seen.sort((p, q) => (p.m === 0 ? -1 : q.m === 0 ? 1 : 0));
  for (const o of seen) {
    // y = m x + c  <=>  m x - y = -c, normalised.
    const n = Math.hypot(o.m, 1);
    let la = o.m / n;
    let lb = -1 / n;
    let lc = -o.c / n;
    if (la < 0 || (la === 0 && lb < 0)) {
      la = -la;
      lb = -lb;
      lc = -lc;
    }
    lines.push({ a: la, b: lb, c: lc });
  }
  return lines;
}

/* ------------------------------ iteration ------------------------------ */

function countArg(call: RuleCall, i: number): number | undefined {
  const n = numArg(call, i);
  if (n === undefined || !Number.isInteger(n) || n < 0) {
    call.fail('bad_argument', 'The count must be a whole number of 0 or more.');
    return undefined;
  }
  if (n > 100000) {
    call.fail('limit', 'Iteration takes a count up to 100000.');
    return undefined;
  }
  return n;
}

function runIterate(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  const x0 = numArg(call, 1);
  const n = countArg(call, 2);
  if (!f || x0 === undefined || n === undefined) return call.fail('bad_argument', 'Iterate needs a function, a start and a count.');
  let x = x0;
  for (let i = 0; i < n; i++) {
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    const v = f.f(x);
    if (v !== v || v === Infinity || v === -Infinity) return call.fail(f.lastReason ?? 'not_finite', `The orbit leaves the numbers at step ${i + 1}.`);
    x = v;
  }
  return x;
}

function runIterateList(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  const x0 = numArg(call, 1);
  const n = countArg(call, 2);
  if (!f || x0 === undefined || n === undefined) return call.fail('bad_argument', 'IterateList needs a function, a start and a count.');
  const out = new Float64Array(n);
  let x = x0;
  for (let i = 0; i < n; i++) {
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    const v = f.f(x);
    if (v !== v || v === Infinity || v === -Infinity) {
      if (i === 0) return call.fail(f.lastReason ?? 'not_finite', 'The first step leaves the numbers.');
      return out.slice(0, i);
    }
    out[i] = v;
    x = v;
  }
  return out;
}

function runCobweb(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  const x0 = numArg(call, 1);
  const n = countArg(call, 2);
  if (!f || x0 === undefined || n === undefined) return call.fail('bad_argument', 'Cobweb needs a function, a start and a count.');
  if (2 * n + 1 > call.limits.listSize) return call.fail('limit', `Cobweb makes ${2 * n + 1} points, over the list limit.`);
  const out: Pt[] = [{ x: x0, y: 0 }];
  let x = x0;
  for (let i = 0; i < n; i++) {
    if (!call.work.spend(1)) return call.fail('timeout', 'The work budget ran out.');
    const v = f.f(x);
    if (v !== v || v === Infinity || v === -Infinity) {
      if (i === 0) return call.fail(f.lastReason ?? 'not_finite', 'The first step leaves the numbers.');
      return out;
    }
    out.push({ x, y: v }, { x: v, y: v });
    x = v;
  }
  return out;
}

/* ------------------------------ slope fields, ODE ------------------------------ */

function runSlopeField(call: RuleCall): unknown {
  const g = reqFn2(call, 0);
  if (!g) return undefined;
  const n = numArg(call, 1) ?? 25;
  const length = numArg(call, 2) ?? 0.8;
  if (!Number.isInteger(n) || n < 1) return call.fail('bad_argument', 'The grid size n must be a whole number of 1 or more.');
  if (!(length >= 0 && length <= 1)) return call.fail('bad_argument', 'The segment length is a fraction from 0 to 1.');
  const x0 = numArg(call, 3);
  const x1 = numArg(call, 4);
  const y0 = numArg(call, 5);
  const y1 = numArg(call, 6);
  const given = [x0, x1, y0, y1].filter((v) => v !== undefined).length;
  if (given !== 0 && given !== 4) return call.fail('bad_argument', 'Give the whole rectangle x0, x1, y0, y1 or none of it.');
  let rect: FieldData['rect'] = null;
  if (given === 4) {
    const a = x0 as number;
    const b = x1 as number;
    const c = y0 as number;
    const d = y1 as number;
    if (!isFin(a) || !isFin(b) || !isFin(c) || !isFin(d) || !(a < b) || !(c < d)) {
      return call.fail('bad_argument', 'The rectangle needs finite bounds with x0 < x1 and y0 < y1.');
    }
    rect = { x0: a, x1: b, y0: c, y1: d };
  }
  const data: FieldData = { kind: 'field', slope: (x, y) => g.f(x, y), n, length, rect };
  return data;
}

/** One solution variable as a `FunctionValue` over the solved domain. */
function odeFunction(sol: OdeSolution, v: number): FunctionValue {
  const [lo, hi] = odeDomain(sol);
  let why: UndefReason = 'out_of_domain';
  return fn1Value((s) => {
    if (s !== s || s < lo || s > hi) {
      why = 'out_of_domain';
      return Number.NaN;
    }
    const r = odeEval(sol, v, s);
    if (r !== r) {
      why = 'not_finite';
      return Number.NaN;
    }
    return r;
  }, () => why);
}

function runSolveODE(call: RuleCall): unknown {
  const g = reqFn2(call, 0);
  const x0 = numArg(call, 1);
  const y0 = numArg(call, 2);
  const x1 = numArg(call, 3);
  if (!g || x0 === undefined || y0 === undefined || x1 === undefined) return call.fail('bad_argument', 'SolveODE needs a right-hand side, a start point and an end.');
  if (!isFin(x0) || !isFin(y0) || !isFin(x1)) return call.fail('bad_argument', 'SolveODE needs finite numbers.');
  if (x0 === x1) return call.fail('empty_interval', 'The interval is empty.');
  const rhs = (s: number, y: Float64Array, out: Float64Array): boolean => {
    const v = g.f(s, y[0] as number);
    if (v !== v) return false;
    out[0] = v;
    return true;
  };
  const sol = solveOde({ rhs, n: 1, s0: x0, y0: new Float64Array([y0]), s1: x1, rtol: 1e-8, atol: 1e-10, work: call.work });
  switch (sol.end) {
    case 'done':
    case 'stop':
    case 'blowup':
    case 'step_limit':
      return odeFunction(sol, 0);
    case 'stiff':
      return call.fail('stiff', 'The steps are forced extremely small; shorten the interval.');
    case 'spent':
      return call.fail('timeout', 'The work budget ran out.');
    case 'rhs_undefined':
      return sol.steps === 0 ? call.fail(g.lastReason ?? 'out_of_domain', 'The right-hand side is not defined at the start.') : odeFunction(sol, 0);
  }
}

function runSolveODEParam(call: RuleCall): unknown {
  const dy = reqFn2(call, 0);
  const dx = reqFn2(call, 1);
  const x0 = numArg(call, 2);
  const y0 = numArg(call, 3);
  const tEnd = numArg(call, 4);
  if (!dy || !dx || x0 === undefined || y0 === undefined || tEnd === undefined) {
    return call.fail('bad_argument', 'SolveODE needs two right-hand sides, a start point and an end time.');
  }
  if (!isFin(x0) || !isFin(y0) || !isFin(tEnd)) return call.fail('bad_argument', 'SolveODE needs finite numbers.');
  if (tEnd === 0) return call.fail('empty_interval', 'The time range is empty.');
  const rhs = (s: number, y: Float64Array, out: Float64Array): boolean => {
    void s;
    const x = y[0] as number;
    const yy = y[1] as number;
    const vx = dx.f(x, yy);
    const vy = dy.f(x, yy);
    if (vx !== vx || vy !== vy) return false;
    out[0] = vx;
    out[1] = vy;
    return true;
  };
  const sol = solveOde({ rhs, n: 2, s0: 0, y0: new Float64Array([x0, y0]), s1: tEnd, rtol: 1e-8, atol: 1e-10, work: call.work });
  if (sol.end === 'stiff') return call.fail('stiff', 'The steps are forced extremely small; shorten the interval.');
  if (sol.end === 'spent') return call.fail('timeout', 'The work budget ran out.');
  if (sol.end === 'rhs_undefined' && sol.steps === 0) {
    return call.fail(dx.lastReason ?? dy.lastReason ?? 'out_of_domain', 'A right-hand side is not defined at the start.');
  }
  // Sample the dense output: 8 points per step, decimated to 20000.
  const per = 8;
  const total = sol.steps * per + 1;
  const stride = Math.max(1, Math.ceil(total / 20000));
  const pts: Pt[] = [];
  const mesh = sol.mesh;
  for (let k = 0; k < sol.steps; k++) {
    for (let j = 0; j < per; j += 1) {
      const idx = k * per + j;
      if (idx % stride !== 0 && !(k === sol.steps - 1 && j === per - 1)) continue;
      const s = (mesh[k] as number) + (((mesh[k + 1] as number) - (mesh[k] as number)) * j) / per;
      const x = odeEval(sol, 0, s);
      const y = odeEval(sol, 1, s);
      if (x === x && y === y) pts.push({ x, y });
    }
  }
  const xe = odeEval(sol, 0, mesh[sol.steps] as number);
  const ye = odeEval(sol, 1, mesh[sol.steps] as number);
  if (xe === xe && ye === ye) {
    const last = pts[pts.length - 1];
    if (!last || last.x !== xe || last.y !== ye) pts.push({ x: xe, y: ye });
  }
  return toSampledCurve([pts], 'ode');
}

function runNSolveODE(call: RuleCall): unknown {
  const rhsV = call.values[0];
  const initV = call.values[1];
  const s0 = numArg(call, 2);
  const s1 = numArg(call, 3);
  if (!Array.isArray(rhsV) || s0 === undefined || s1 === undefined) {
    return call.fail('bad_argument', 'NSolveODE needs a list of right-hand sides, initial values and a range.');
  }
  const n = rhsV.length;
  if (n < 1) return call.fail('bad_argument', 'NSolveODE needs at least one equation.');
  if (n > 16) return call.fail('limit', 'NSolveODE takes at most 16 variables.');
  const fns: { readonly f: (xs: readonly number[]) => number }[] = [];
  for (let i = 0; i < n; i++) {
    const e = rhsV[i] as FunctionValue | undefined;
    if (!e || typeof e.call !== 'function' || e.arity !== n + 1) {
      return call.fail('bad_argument', `Right-hand side ${i + 1} must be a function of s and the ${n} variables.`);
    }
    fns.push(sampleN(e));
  }
  const init: number[] = [];
  if (initV instanceof Float64Array) {
    for (let i = 0; i < initV.length; i++) init.push(initV[i] as number);
  } else if (Array.isArray(initV)) {
    for (const e of initV) {
      if (typeof e !== 'number') return call.fail('bad_argument', 'Initial values must be numbers.');
      init.push(e);
    }
  } else return call.fail('bad_argument', 'NSolveODE needs a list of initial values.');
  if (init.length !== n) return call.fail('bad_argument', `NSolveODE needs ${n} initial values, one per variable.`);
  for (const v of init) if (!isFin(v)) return call.fail('bad_argument', 'Initial values must be finite.');
  if (!isFin(s0) || !isFin(s1)) return call.fail('bad_argument', 'NSolveODE needs a finite range.');
  if (s0 === s1) return call.fail('empty_interval', 'The range is empty.');
  const stopV = call.values[4] as FunctionValue | undefined;
  let stop: ((s: number, y: Float64Array) => number) | undefined;
  if (stopV !== undefined) {
    if (typeof stopV.call !== 'function' || stopV.arity !== n + 1) {
      return call.fail('bad_argument', `stop must be a function of s and the ${n} variables.`);
    }
    const ss = sampleN(stopV);
    stop = (s, y) => ss.f([s, ...Array.from(y.slice(0, n))]);
  }
  const rtol = numArg(call, 5) ?? 1e-8;
  const atol = numArg(call, 6) ?? 1e-10;
  if (!isFin(rtol) || !(rtol > 0) || !isFin(atol) || !(atol > 0)) return call.fail('bad_argument', 'rtol and atol must be positive.');
  const args = new Float64Array(n + 1);
  const rhs = (s: number, y: Float64Array, out: Float64Array): boolean => {
    args[0] = s;
    for (let i = 0; i < n; i++) args[i + 1] = y[i] as number;
    const xs = Array.from(args);
    for (let i = 0; i < n; i++) {
      const v = (fns[i] as { f: (xs: readonly number[]) => number }).f(xs);
      if (v !== v) return false;
      out[i] = v;
    }
    return true;
  };
  const sol = solveOde({ rhs, n, s0, y0: Float64Array.from(init), s1, ...(stop ? { stop } : {}), rtol, atol, work: call.work });
  switch (sol.end) {
    case 'done':
    case 'stop':
    case 'blowup':
    case 'step_limit':
      return Array.from({ length: n }, (_, v) => odeFunction(sol, v));
    case 'stiff':
      return call.fail('stiff', 'The steps are forced extremely small; shorten the interval.');
    case 'spent':
      return call.fail('timeout', 'The work budget ran out.');
    case 'rhs_undefined':
      return sol.steps === 0
        ? call.fail('out_of_domain', 'A right-hand side is not defined at the start.')
        : Array.from({ length: n }, (_, v) => odeFunction(sol, v));
  }
}

/* ------------------------------ polynomial helpers ------------------------------ */

function runDegree(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const det = detectPolynomial(f.f, 0, call.tol, call.work);
  if (det.spent) return call.fail('timeout', 'The work budget ran out.');
  if (det.degree === null) return call.fail('bad_argument', 'f is not a polynomial of degree 20 or less.');
  return det.degree;
}

function runCoefficients(call: RuleCall): unknown {
  const f = reqFn1(call, 0);
  if (!f) return undefined;
  const det = detectPolynomial(f.f, 0, call.tol, call.work);
  if (det.spent) return call.fail('timeout', 'The work budget ran out.');
  if (det.degree === null || !det.coeffs) return call.fail('bad_argument', 'f is not a polynomial of degree 20 or less.');
  return new Float64Array(det.coeffs.slice(0, det.degree + 1));
}

function runPolynomial(call: RuleCall): unknown {
  const v = call.values[0];
  if (!Array.isArray(v)) return call.fail('bad_argument', 'Polynomial needs a list of points.');
  const pts: Pt[] = [];
  for (const e of v) {
    if (typeof e !== 'object' || e === null || typeof (e as Pt).x !== 'number' || typeof (e as Pt).y !== 'number') {
      return call.fail('bad_argument', 'Polynomial needs a list of points.');
    }
    pts.push(e as Pt);
  }
  if (pts.length < 1) return call.fail('bad_argument', 'Polynomial needs at least one point.');
  if (pts.length > 500) return call.fail('limit', 'Polynomial takes at most 500 points.');
  for (const q of pts) if (!isFin(q.x) || !isFin(q.y)) return call.fail('bad_argument', 'Polynomial points must be finite.');
  const tol = call.tol;
  const xs = pts.map((q) => q.x).sort((p, q) => p - q);
  for (let i = 1; i < xs.length; i++) {
    if (Math.abs((xs[i] as number) - (xs[i - 1] as number)) <= tol * Math.max(1, Math.abs(xs[i] as number))) {
      return call.fail('degenerate_points', 'Two points share an x value.');
    }
  }
  if (!call.work.spend(pts.length * pts.length)) return call.fail('timeout', 'The work budget ran out.');
  // Newton divided differences.
  const n = pts.length;
  const ox = pts.map((q) => q.x);
  const dd = pts.map((q) => q.y);
  for (let j = 1; j < n; j++) {
    for (let i = n - 1; i >= j; i--) dd[i] = ((dd[i] as number) - (dd[i - 1] as number)) / ((ox[i] as number) - (ox[i - j] as number));
  }
  return fn1Value((x) => {
    if (!isFin(x)) return Number.NaN;
    let acc = dd[n - 1] as number;
    for (let i = n - 2; i >= 0; i--) acc = (dd[i] as number) + (x - (ox[i] as number)) * acc;
    return acc;
  }, () => 'not_finite');
}

function runLimitSide(call: RuleCall, side: 'left' | 'right'): unknown {
  const f = reqFn1(call, 0);
  const a = numArg(call, 1);
  if (!f || a === undefined) return call.fail('bad_argument', 'Limit needs a function and a point.');
  if (a !== a) return call.fail('bad_argument', 'The point must be a number or inf.');
  const one = limitOneSided(f.f, a, side === 'left' ? -1 : 1, call.tol, call.work);
  if (one.spent) return call.fail('timeout', 'The work budget ran out.');
  if (one.t === 'value') return one.v;
  if (one.t === 'inf') return one.sign === 1 ? Infinity : -Infinity;
  return call.fail('no_limit', `f does not settle from the ${side} at ${fmt(a)}.`);
}

/* ------------------------------ specs ------------------------------ */

const F2 = 'Function2';
const BINDER = { kind: 'binder' } as const;

export const FUNCTIONS_SPECS: CommandSpec[] = [
  objSpec('Derivative', [
    form([p('f', F1)], F1RET, runDerivative, 'derivative as a function'),
    form([p('f', F1), p('n', 'Number')], F1RET, runDerivative, 'n-th derivative as a function'),
    form([p('g', F2), p('v', 'Number', BINDER)], F2, (call) => runDerivative2(call, 0), 'partial derivative in x or y'),
    form([p('g', F2), p('v', 'Number', BINDER), p('n', 'Number')], F2, (call) => runDerivative2(call, 1), 'n-th partial derivative'),
    ...derivativeCurveForms,
  ]),
  objSpec('NDerivative', [form([p('f', F1)], F1RET, runNDerivative, 'numeric derivative as a function')]),
  objSpec('Slope', [
    form([p('f', F1), p('x0', 'Number')], 'Number', runSlope, "the derivative's value at a point"),
    ...slopeCurveForms,
  ]),
  objSpec('Tangent', [
    form([p('f', F1), p('x0', 'Number')], 'Line', (call) => runTangent(call, false), 'tangent line at a point'),
    ...tangentCurveForms,
  ]),
  objSpec('Normal', [
    form([p('f', F1), p('x0', 'Number')], 'Line', (call) => runTangent(call, true), 'normal line at a point'),
    ...normalCurveForms,
  ]),
  objSpec('Curvature', [
    form([p('f', F1), p('x0', 'Number')], 'Number', (call) => runCurvatureFn(call, 'k'), 'signed curvature at a point'),
    ...curvatureCurveForms,
  ]),
  objSpec('CurvatureVector', [
    form([p('f', F1), p('x0', 'Number')], 'Vector', (call) => runCurvatureFn(call, 'v'), 'curvature vector at a point'),
    ...curvatureVectorCurveForms,
  ]),
  objSpec('OsculatingCircle', [
    form([p('f', F1), p('x0', 'Number')], 'Circle', (call) => runCurvatureFn(call, 'circle'), 'osculating circle at a point'),
    ...osculatingCurveForms,
  ]),
  objSpec('Integral', [
    form([p('f', F1)], F1RET, runIntegralIndef, 'antiderivative (numeric)'),
    form([p('f', F1), p('through', 'Point')], F1RET, runIntegralThrough, 'antiderivative passing a point'),
    form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'Number', runIntegralDef, 'definite integral'),
    form([p('f', F1), p('g', F1), p('a', 'Number'), p('b', 'Number')], 'Number', runIntegralBetween, 'integral of f - g'),
    form([p('g', F2), p('v', 'Number', BINDER)], F2, runIntegralPartial2, 'partial antiderivative in x or y'),
    form([p('g', F2), p('v', 'Number', BINDER), p('a', 'Number'), p('b', 'Number')], F1RET, runIntegralOut, 'integral over one variable'),
  ]),
  objSpec('AreaUnder', [
    form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'Region', (call) => runAreaUnder(call, false), 'region under f from a to b'),
    form([p('f', F1), p('g', F1), p('a', 'Number'), p('b', 'Number')], 'Region', (call) => runAreaUnder(call, true), 'region between f and g'),
  ]),
  objSpec('Riemann', [
    form([p('f', F1), p('a', 'Number'), p('b', 'Number'), p('n', 'Number')], 'Region', (call) => runRiemann(call), 'left-rectangle sum'),
    form(
      [p('f', F1), p('a', 'Number'), p('b', 'Number'), p('n', 'Number'), p('rule', 'Text')], 'Region',
      (call) => runRiemann(call), 'sum with a named rule',
    ),
    form(
      [p('f', F1), p('a', 'Number'), p('b', 'Number'), p('n', 'Number'), p('offset', 'Number')], 'Region',
      (call) => runRiemann(call), 'sum with heights read at a fraction of each slice',
    ),
  ]),
  objSpec('Root', [
    form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'Point', runRootInterval, 'first root in [a, b]'),
    form([p('f', F1), p('x0', 'Number')], 'Point', runRootStart, 'root near a start value'),
  ]),
  objSpec('Roots', [
    form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'List<Point>', runRootsInterval, 'every root in [a, b], sorted'),
    form([p('f', F1)], 'List<Point>', runRootsPoly, 'roots of a polynomial or rational function'),
    form([p('f', F1), p('guesses', 'List<Number>')], 'List<Point>', runRootsGuesses, 'one root near each guess'),
  ]),
  objSpec('Extremum', [
    form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'List<Point>', runExtremumInterval, 'local extrema in the open interval'),
    form([p('f', F1)], 'List<Point>', runExtremumPoly, 'extrema of a polynomial'),
  ]),
  objSpec('Maximum', [form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'Point', (call) => runMinMax(call, true), 'global maximum on [a, b]')]),
  objSpec('Minimum', [form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'Point', (call) => runMinMax(call, false), 'global minimum on [a, b]')]),
  objSpec('Inflection', [
    form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'List<Point>', (call) => runInflectionInterval(call, false), 'inflection points in [a, b]'),
    form([p('f', F1)], 'List<Point>', (call) => runInflectionInterval(call, true), 'inflection points of a polynomial'),
  ]),
  objSpec('Hole', [form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'List<Point>', runHole, 'removable discontinuities in [a, b]')]),
  objSpec('Asymptote', [
    form([p('f', F1)], 'List<Line>', (call) => runAsymptoteFn(call, false), 'asymptotes over the default range'),
    form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'List<Line>', (call) => runAsymptoteFn(call, true), 'asymptotes over [a, b]'),
    ...asymptoteCurveForms,
  ]),
  objSpec('Intersect', [
    form([p('f', F1), p('g', F1), p('a', 'Number'), p('b', 'Number')], 'List<Point>', runIntersectFn, 'intersections of two functions on [a, b]'),
    ...intersectCurveForms,
  ]),
  objSpec('Length', [...lengthCurveForms]),
  objSpec('Taylor', [form([p('f', F1), p('a', 'Number'), p('n', 'Number')], F1RET, runTaylor, 'degree-n Taylor polynomial about a')]),
  objSpec('Limit', [
    form([p('f', F1), p('a', 'Number')], 'Number', (call) => runLimit(call, false), 'two-sided limit (a may be inf)'),
    form([p('f', F1), p('a', 'Number'), p('side', 'Text')], 'Number', (call) => runLimit(call, true), 'one-sided limit'),
  ]),
  objSpec('Iterate', [form([p('f', F1), p('x0', 'Number'), p('n', 'Number')], 'Number', runIterate, 'n-th iterate from x0')]),
  objSpec('IterateList', [form([p('f', F1), p('x0', 'Number'), p('n', 'Number')], 'List<Number>', runIterateList, 'orbit from x0')]),
  objSpec('Cobweb', [form([p('f', F1), p('x0', 'Number'), p('n', 'Number')], 'List<Point>', runCobweb, 'cobweb zig-zag points')]),
  objSpec('SlopeField', [
    form(
      [
        p('g', F2), p('n', 'Number', { optional: true, default: 25 }), p('length', 'Number', { optional: true, default: 0.8 }),
        p('x0', 'Number', { optional: true }), p('x1', 'Number', { optional: true }), p('y0', 'Number', { optional: true }), p('y1', 'Number', { optional: true }),
      ],
      'Field', runSlopeField, 'slope field of y\u2019 = g(x, y)',
    ),
  ]),
  objSpec('SolveODE', [
    form([p('g', F2), p('x0', 'Number'), p('y0', 'Number'), p('x1', 'Number')], F1RET, runSolveODE, "solution of y' = g(x, y)"),
    form(
      [p('dy', F2), p('dx', F2), p('x0', 'Number'), p('y0', 'Number'), p('tEnd', 'Number')], 'Curve',
      runSolveODEParam, 'parametric solution of dy/dx = dy/dx',
    ),
  ]),
  objSpec('NSolveODE', [
    form(
      [
        p('rhs', 'List<Function<Number>>'), p('init', 'List<Number>'), p('s0', 'Number'), p('s1', 'Number'),
        p('stop', 'Function<Number>', { optional: true }), p('rtol', 'Number', { optional: true, default: 1e-8 }), p('atol', 'Number', { optional: true, default: 1e-10 }),
      ],
      'List<Function<Number, 1>>', runNSolveODE, 'system solution, one function per variable',
    ),
  ]),
  objSpec('Degree', [form([p('f', F1)], 'Number', runDegree, 'degree of a polynomial')]),
  objSpec('Coefficients', [form([p('f', F1)], 'List<Number>', runCoefficients, 'coefficients, index k is x^k')]),
  objSpec('Polynomial', [form([p('pts', 'List<Point>')], F1RET, runPolynomial, 'interpolating polynomial through points')]),
  // Accepted aliases (docs: "accepted but not printed"; without a core aliases field they are thin specs).
  objSpec('LeftSum', [form([p('f', F1), p('a', 'Number'), p('b', 'Number'), p('n', 'Number')], 'Region', (call) => runRiemann(call, 'left'), 'left sum')]),
  objSpec('RightSum', [form([p('f', F1), p('a', 'Number'), p('b', 'Number'), p('n', 'Number')], 'Region', (call) => runRiemann(call, 'right'), 'right sum')]),
  objSpec('UpperSum', [form([p('f', F1), p('a', 'Number'), p('b', 'Number'), p('n', 'Number')], 'Region', (call) => runRiemann(call, 'upper'), 'upper sum')]),
  objSpec('LowerSum', [form([p('f', F1), p('a', 'Number'), p('b', 'Number'), p('n', 'Number')], 'Region', (call) => runRiemann(call, 'lower'), 'lower sum')]),
  objSpec('RectangleSum', [form([p('f', F1), p('a', 'Number'), p('b', 'Number'), p('n', 'Number')], 'Region', (call) => runRiemann(call, 'left'), 'rectangle sum')]),
  objSpec('TrapezoidalSum', [form([p('f', F1), p('a', 'Number'), p('b', 'Number'), p('n', 'Number')], 'Region', (call) => runRiemann(call, 'trapezoid'), 'trapezoid sum')]),
  objSpec('IntegralBetween', [form([p('f', F1), p('g', F1), p('a', 'Number'), p('b', 'Number')], 'Number', runIntegralBetween, 'integral of f - g')]),
  objSpec('NIntegral', [
    form([p('f', F1)], F1RET, runIntegralIndef, 'numeric antiderivative'),
    form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'Number', runIntegralDef, 'numeric definite integral'),
    form([p('f', F1), p('g', F1), p('a', 'Number'), p('b', 'Number')], 'Number', runIntegralBetween, 'numeric integral of f - g'),
  ]),
  objSpec('TurningPoint', [
    form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'List<Point>', runExtremumInterval, 'local extrema in the open interval'),
    form([p('f', F1)], 'List<Point>', runExtremumPoly, 'extrema of a polynomial'),
  ]),
  objSpec('TaylorPolynomial', [form([p('f', F1), p('a', 'Number'), p('n', 'Number')], F1RET, runTaylor, 'degree-n Taylor polynomial about a')]),
  objSpec('LimitAbove', [form([p('f', F1), p('a', 'Number')], 'Number', (call) => runLimitSide(call, 'right'), 'limit from the right')]),
  objSpec('LimitBelow', [form([p('f', F1), p('a', 'Number')], 'Number', (call) => runLimitSide(call, 'left'), 'limit from the left')]),
  objSpec('RemovableDiscontinuity', [form([p('f', F1), p('a', 'Number'), p('b', 'Number')], 'List<Point>', runHole, 'removable discontinuities in [a, b]')]),
  objSpec('RootList', [form([p('f', F1), p('guesses', 'List<Number>')], 'List<Point>', runRootsGuesses, 'one root near each guess')]),
  objSpec('ParametricDerivative', [...slopeCurveForms]),
];
