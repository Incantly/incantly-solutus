/**
 * Regression and fit commands (docs/features/statistics/design.md 7). Every fit returns the `Fit` record of 7.1.
 */
import type { RuleCall } from '../../graph/registry';
import type { FunctionValue } from '../../language/runtime';
import type { CommandSpec, ParamSpec, Refusal } from '../../language/table';
import { centralSums, enumCheck, fmt, form, given, num, numbers, oneOf, opt, p, pairs, pearson, record, spec, tailOf } from './core';
import { at } from './describe-commands';
import { tSf } from './dist';
import { levenberg, linearLS, polyLS } from './fit';
import type { Model } from './fit';
import { MAX_FIT_POINTS, MAX_POLY_DEGREE, SPACES, TAILS, TAIL_ALIASES } from './types';

const L = 'List<Number>';
const P = 'List<Point>';
const fits = spec('fits');
const LETTERS = 'abcdefghijklm';

/* ------------------------------ data ------------------------------ */

interface Data {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly w: Float64Array | undefined;
  /** Index of the first argument after the data. */
  readonly next: number;
}

/** The points and the `weights` option (the last parameter of every fit form). */
function fitData(call: RuleCall, isPts: boolean, weightsIdx: number): Data | undefined {
  const d = pairs(call, 0, isPts);
  if (!d) return undefined;
  if (d.xs.length > MAX_FIT_POINTS) return call.fail('too_large', `${d.xs.length} points; a fit takes at most ${MAX_FIT_POINTS.toLocaleString('en')}`);
  let w: Float64Array | undefined;
  if (given(call, weightsIdx)) {
    w = numbers(call, weightsIdx, 'the weights');
    if (!w) return undefined;
    if (w.length !== d.xs.length) return call.fail('size_mismatch', `${d.xs.length} points, ${w.length} weights`);
    const bad = w.findIndex((v) => v < 0);
    if (bad >= 0) return call.fail('bad_weights', `weight ${bad + 1} is ${w[bad]}; weights are 0 or more`);
  }
  return { xs: d.xs, ys: d.ys, w, next: d.next };
}

const distinctCount = (xs: Float64Array): number => new Set(xs).size;

/* ------------------------------ the Fit record ------------------------------ */

function fnValue(g: (x: number) => number): FunctionValue {
  const call1 = (x: number): number => {
    const v = g(x);
    return Number.isFinite(v) ? v : NaN;
  };
  return {
    arity: 1,
    ret: 'Number',
    call: (x: number) => call1(x),
    call1,
    batch(xs: Float64Array, out: Float64Array) {
      for (let i = 0; i < xs.length; i++) out[i] = call1(xs[i] as number);
    },
  };
}

interface FitParts {
  readonly model: string;
  readonly g: (x: number) => number;
  readonly params: Float64Array;
  readonly names: readonly string[];
  readonly equation: string;
  /** Covariance of the parameters divided by s², or undefined. */
  readonly inv: Float64Array | undefined;
  readonly space: 'data' | 'log';
  readonly iterations: number;
  /** Residuals measured on another scale (log space); default `y - g(x)`. */
  readonly residuals?: Float64Array;
}

function fitRecord(call: RuleCall, d: Data, parts: FitParts): unknown {
  const n = d.xs.length;
  const k = parts.params.length;
  const res = parts.residuals ?? d.xs.map((x, i) => (d.ys[i] as number) - parts.g(x));
  if (!res.every(Number.isFinite)) return call.fail('out_of_domain', 'the fitted curve is undefined at a data point');
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (d.w ? (d.w[i] as number) : 1) * (res[i] as number) ** 2;
  const yy = parts.space === 'log' ? d.ys.map((y) => Math.log(Math.abs(y))) : d.ys;
  const sst = d.w ? weightedSst(yy, d.w) : centralSums(yy).s2;
  const dof = n - k;
  const reasons: Record<string, string> = {};
  const r2 = sst > 0 ? 1 - sse / sst : undefined;
  if (r2 === undefined) reasons['r2'] = 'zero_variance';
  const adjR2 = r2 !== undefined && n - k > 0 && n > 1 ? 1 - ((1 - r2) * (n - 1)) / (n - k) : undefined;
  if (adjR2 === undefined) reasons['adjR2'] = r2 === undefined ? 'zero_variance' : 'no_dof';
  let stderr: Float64Array | undefined;
  if (dof <= 0) reasons['stderr'] = 'no_dof';
  else if (!parts.inv) reasons['stderr'] = 'singular_fit';
  else {
    const s2 = sse / dof;
    stderr = Float64Array.from({ length: k }, (_, j) => Math.sqrt(Math.max(0, s2 * ((parts.inv as Float64Array)[j * k + j] as number))));
    if (!stderr.every(Number.isFinite)) {
      stderr = undefined;
      reasons['stderr'] = 'singular_fit';
    }
  }
  if (dof < 3) call.notify('overfit', { dof });
  if (parts.space === 'log') call.notify('log_space_bias', {});
  return record('Fit', {
    f: fnValue(parts.g), equation: parts.equation, params: parts.params, names: parts.names.slice(), stderr, r2, adjR2, sse,
    rmse: Math.sqrt(sse / n), n, dof, residuals: res, model: parts.model, space: parts.space, iterations: parts.iterations,
  }, reasons);
}

function weightedSst(ys: Float64Array, w: Float64Array): number {
  let sw = 0;
  let sy = 0;
  for (let i = 0; i < ys.length; i++) {
    sw += w[i] as number;
    sy += (w[i] as number) * (ys[i] as number);
  }
  const m = sy / sw;
  let s = 0;
  for (let i = 0; i < ys.length; i++) s += (w[i] as number) * ((ys[i] as number) - m) ** 2;
  return s;
}

/* ------------------------------ equations ------------------------------ */

const coef = (c: number, first: boolean): string => {
  const t = fmt(Math.abs(c));
  return first ? (c < 0 ? `-${t}` : t) : c < 0 ? ` - ${t}` : ` + ${t}`;
};

/** `y = 1.92 x + 0.41` from descending coefficients. */
function polyEquation(desc: Float64Array, v = 'x', lhs = 'y'): string {
  const d = desc.length - 1;
  const parts: string[] = [];
  desc.forEach((c, i) => {
    const pow = d - i;
    if (c === 0 && desc.length > 1) return;
    const first = parts.length === 0;
    const mag = Math.abs(c);
    const body = pow === 0 ? coef(c, first) : `${mag === 1 ? (first ? (c < 0 ? '-' : '') : c < 0 ? ' - ' : ' + ') : `${coef(c, first)} `}${v}${pow > 1 ? `^${pow}` : ''}`;
    parts.push(body);
  });
  return `${lhs} = ${parts.join('') || '0'}`;
}

/* ------------------------------ linear models ------------------------------ */

function polyFit(call: RuleCall, d: Data, degree: number, model: string): unknown {
  const need = degree + 1;
  const distinct = distinctCount(d.xs);
  if (d.xs.length < need || distinct < need) {
    if (distinct === 1 && d.xs.length >= need && degree >= 1) return call.fail('degenerate_x', `all x values are ${d.xs[0]}`);
    return call.fail('too_few_values', degree <= 1 ? `a line needs 2 points with different x, got ${distinct}` : `degree ${degree} needs ${need} distinct x values, got ${distinct}`);
  }
  const r = polyLS(d.xs, d.ys, degree, d.w);
  if (!(r.cond < 1e15)) return call.fail('singular_fit', `the polynomial basis is dependent (condition ${fmt(r.cond, 2)})`);
  const k = degree + 1;
  // descending: a x^d + … ; reorder the covariance too
  const desc = Float64Array.from({ length: k }, (_, i) => r.coef[k - 1 - i] as number);
  const inv = new Float64Array(k * k);
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) inv[i * k + j] = r.cov[(k - 1 - i) * k + (k - 1 - j)] as number;
  if (degree >= 2 && degree >= d.xs.length / 2) call.notify('overfit', { degree });
  const g = (x: number): number => {
    let s = 0;
    for (let i = 0; i < k; i++) s = s * x + (desc[i] as number);
    return s;
  };
  return fitRecord(call, d, { model, g, params: desc, names: LETTERS.slice(0, k).split(''), equation: polyEquation(desc), inv, space: 'data', iterations: 0 });
}

const runLine = (isPts: boolean) => (call: RuleCall): unknown => {
  const d = fitData(call, isPts, isPts ? 1 : 2);
  return d ? polyFit(call, d, 1, 'line') : undefined;
};

const runPoly = (isPts: boolean) => (call: RuleCall): unknown => {
  const d = fitData(call, isPts, isPts ? 2 : 3);
  if (!d) return undefined;
  const deg = num(call, d.next);
  if (deg === undefined || !Number.isInteger(deg) || deg < 0 || deg > MAX_POLY_DEGREE) return call.fail('bad_parameter', `the degree must be a whole number from 0 to ${MAX_POLY_DEGREE}, not ${String(deg)}`);
  return polyFit(call, d, deg, `poly${deg}`);
};

const runLineX = (isPts: boolean) => (call: RuleCall): unknown => {
  const d = fitData(call, isPts, isPts ? 1 : 2);
  if (!d) return undefined;
  const ys = new Set(d.ys);
  if (d.ys.length < 2 || ys.size < 2) return ys.size === 1 && d.ys.length >= 2 ? call.fail('degenerate_x', `all y values are ${d.ys[0]}`) : call.fail('too_few_values', `a line needs 2 points with different y, got ${ys.size}`);
  const r = polyLS(d.ys, d.xs, 1, d.w);
  const a = r.coef[1] as number;
  const b = r.coef[0] as number;
  const swapped: Data = { xs: d.ys, ys: d.xs, w: d.w, next: d.next };
  const inv = Float64Array.of(r.cov[3] as number, r.cov[2] as number, r.cov[1] as number, r.cov[0] as number);
  const rec = fitRecord(call, swapped, { model: 'lineX', g: (y) => a * y + b, params: Float64Array.of(a, b), names: ['a', 'b'], equation: polyEquation(Float64Array.of(a, b), 'y', 'x'), inv, space: 'data', iterations: 0 }) as ReturnType<typeof record> | undefined;
  if (!rec) return undefined;
  // f is y as a function of x: y = (x - b) / a
  const f = a === 0 ? undefined : fnValue((x) => (x - b) / a);
  return record('Fit', { ...rec.fields, f }, { ...(rec.reasons ?? {}), ...(f ? {} : { f: 'degenerate_x' }) });
};

const runLog = (isPts: boolean) => (call: RuleCall): unknown => {
  const d = fitData(call, isPts, isPts ? 1 : 2);
  if (!d) return undefined;
  const bad = d.xs.findIndex((x) => x <= 0);
  if (bad >= 0) return call.fail('out_of_domain', `x = ${d.xs[bad]} at position ${bad + 1}; ln undefined`);
  const lx = d.xs.map(Math.log);
  if (distinctCount(lx) < 2) return distinctCount(d.xs) === 1 && d.xs.length >= 2 ? call.fail('degenerate_x', `all x values are ${d.xs[0]}`) : call.fail('too_few_values', 'needs 2 points with different x');
  const r = polyLS(lx, d.ys, 1, d.w);
  const a = r.coef[0] as number;
  const b = r.coef[1] as number;
  return fitRecord(call, d, {
    model: 'log', g: (x) => a + b * Math.log(x), params: Float64Array.of(a, b), names: ['a', 'b'], equation: `y = ${fmt(a)}${coef(b, false)} ln(x)`, inv: r.cov, space: 'data', iterations: 0,
  });
};

/** `Fit(points, [f1, f2, …])`: y = c1 f1(x) + c2 f2(x) + … by QR. */
const runBasis = (isPts: boolean) => (call: RuleCall): unknown => {
  const d = fitData(call, isPts, isPts ? 2 : 3);
  if (!d) return undefined;
  const basis = call.values[d.next];
  if (!Array.isArray(basis) || basis.length === 0) return call.fail(Array.isArray(basis) ? 'empty_list' : 'input_undefined', 'the basis has no functions');
  const fs = basis as FunctionValue[];
  const n = d.xs.length;
  const k = fs.length;
  if (n < k) return call.fail('too_few_values', `${k} functions need at least ${k} points, got ${n}`);
  const A = new Float64Array(n * k);
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) {
    const v = at(fs[j] as FunctionValue, d.xs[i] as number);
    if (v !== v) return call.fail('has_undefined', `basis function ${j + 1} is undefined at x = ${d.xs[i]}`);
    A[i * k + j] = v;
  }
  const r = linearLS(A, n, k, d.ys, d.w);
  if (!(r.cond < 1e13)) return call.fail('singular_fit', `basis functions are linearly dependent (condition ${fmt(r.cond, 2)})`);
  const c = r.c;
  const g = (x: number): number => {
    let s = 0;
    for (let j = 0; j < k; j++) s += (c[j] as number) * at(fs[j] as FunctionValue, x);
    return s;
  };
  const names = Array.from({ length: k }, (_, j) => `c${j + 1}`);
  const equation = `y = ${Array.from(c, (v, j) => `${coef(v, j === 0)} f${j + 1}(x)`).join('')}`;
  return fitRecord(call, d, { model: 'basis', g, params: c, names, equation, inv: r.inv, space: 'data', iterations: 0 });
};

/* ------------------------------ nonlinear models ------------------------------ */

function lm(call: RuleCall, d: Data, model: Model, start: Float64Array): ReturnType<typeof levenberg> | undefined {
  const r = levenberg(model, d.xs, d.ys, start, d.w, (n) => call.work.spend(n));
  if (!r.ok) return call.fail('no_convergence', r.why);
  return r;
}

/** A line through `(u, v)` with weights, for log-space starts. */
function line(u: Float64Array, v: Float64Array, w?: Float64Array): { a: number; b: number; cov: Float64Array } | undefined {
  if (distinctCount(u) < 2) return undefined;
  const r = polyLS(u, v, 1, w);
  return { a: r.coef[1] as number, b: r.coef[0] as number, cov: Float64Array.of(r.cov[3] as number, r.cov[2] as number, r.cov[1] as number, r.cov[0] as number) };
}

type Kind = 'pow' | 'exp' | 'growth';

/** Power, exponential and growth fits: a log-space line, then (in data space) Levenberg–Marquardt from it (design 7.4). */
const runLogModel = (kind: Kind, isPts: boolean) => (call: RuleCall): unknown => {
  const d = fitData(call, isPts, isPts ? 2 : 3);
  if (!d) return undefined;
  const space = oneOf(call, isPts ? 1 : 2, 'data', SPACES, 'space');
  if (!space) return undefined;
  const n = d.xs.length;
  if (n < 2) return call.fail('too_few_values', `needs 2 points, got ${n}`);
  if (kind === 'pow') {
    const bad = d.xs.findIndex((x) => x <= 0);
    if (bad >= 0) return call.fail('out_of_domain', `x = ${d.xs[bad]} at position ${bad + 1}; x^b needs x > 0`);
  }
  const pos = d.ys.every((y) => y > 0);
  const neg = d.ys.every((y) => y < 0);
  const sign = neg ? -1 : 1;
  const u = kind === 'pow' ? d.xs.map(Math.log) : d.xs;
  let start: Float64Array;
  let logLine: ReturnType<typeof line>;
  if (pos || neg) {
    logLine = line(u, d.ys.map((y) => Math.log(Math.abs(y))), d.w);
    if (!logLine) return distinctCount(d.xs) === 1 ? call.fail('degenerate_x', `all x values are ${d.xs[0]}`) : call.fail('too_few_values', 'needs 2 points with different x');
    start = Float64Array.of(sign * Math.exp(logLine.b), logLine.a);
  } else {
    const firstBad = d.ys.findIndex((y) => (pos ? y <= 0 : y * (d.ys[0] as number) <= 0));
    if (space === 'log' || kind !== 'pow') return call.fail('out_of_domain', `y = ${d.ys[firstBad >= 0 ? firstBad : 0]}; ${kind === 'pow' ? 'the log start needs y > 0' : 'y must have one sign'}`);
    start = Float64Array.of(d.ys.reduce((a, b) => a + b, 0) / n, 1);
  }
  const model: Model = kind === 'pow' ? (x, q) => (q[0] as number) * x ** (q[1] as number) : (x, q) => (q[0] as number) * Math.exp((q[1] as number) * x);
  const names = ['a', 'b'];
  const eq = (a: number, b: number): string => (kind === 'pow' ? `y = ${fmt(a)} x^${fmt(b)}` : kind === 'exp' ? `y = ${fmt(a)} e^(${fmt(b)} x)` : `y = ${fmt(a)} · ${fmt(b)}^x`);
  const out = (q: Float64Array): Float64Array => (kind === 'growth' ? Float64Array.of(q[0] as number, Math.exp(q[1] as number)) : q);
  if (space === 'log') {
    const ll = logLine as { a: number; b: number; cov: Float64Array };
    const q = out(start);
    const lres = d.xs.map((x, i) => Math.log(Math.abs(d.ys[i] as number)) - Math.log(Math.abs(model(x, start))));
    return fitRecord(call, d, {
      model: kind, g: (x) => model(x, start), params: q, names, equation: eq(q[0] as number, q[1] as number), inv: ll.cov, space: 'log', iterations: 0, residuals: lres,
    });
  }
  const r = lm(call, d, model, start);
  if (!r) return undefined;
  const q = out(r.p);
  return fitRecord(call, d, { model: kind, g: (x) => model(x, r.p), params: q, names, equation: eq(q[0] as number, q[1] as number), inv: r.inv, space: 'data', iterations: r.iterations });
};

/** `y = a + b sin(c x + d)`: scan c, solve the linear part at each, then refine all four (design 7.2). */
const runSin = (isPts: boolean) => (call: RuleCall): unknown => {
  const d = fitData(call, isPts, isPts ? 1 : 2);
  if (!d) return undefined;
  const n = d.xs.length;
  if (n < 4) return call.fail('too_few_values', `FitSin needs 4 points, got ${n}`);
  const sx = Float64Array.from(d.xs).sort();
  const range = (sx[n - 1] as number) - (sx[0] as number);
  if (!(range > 0)) return call.fail('degenerate_x', `all x values are ${d.xs[0]}`);
  const cMin = (2 * Math.PI) / range;
  const cMax = Math.PI / (range / (n - 1));
  let best = { sse: Infinity, a: 0, p: 0, q: 0, c: cMin };
  const A = new Float64Array(n * 3);
  const steps = 400;
  for (let s = 0; s < steps; s++) {
    const c = cMin + ((cMax - cMin) * s) / (steps - 1);
    for (let i = 0; i < n; i++) {
      const x = d.xs[i] as number;
      A[i * 3] = 1;
      A[i * 3 + 1] = Math.sin(c * x);
      A[i * 3 + 2] = Math.cos(c * x);
    }
    const r = linearLS(A, n, 3, d.ys, d.w);
    if (!(r.cond < 1e12)) continue;
    let sse = 0;
    for (let i = 0; i < n; i++) {
      const e = (d.ys[i] as number) - (r.c[0] as number) - (r.c[1] as number) * (A[i * 3 + 1] as number) - (r.c[2] as number) * (A[i * 3 + 2] as number);
      sse += (d.w ? (d.w[i] as number) : 1) * e * e;
    }
    if (sse < best.sse) best = { sse, a: r.c[0] as number, p: r.c[1] as number, q: r.c[2] as number, c };
    if (!call.work.spend(1 + Math.floor(n / 1000))) return call.fail('no_convergence', 'the frequency scan ran out of work');
  }
  if (best.sse === Infinity) return call.fail('singular_fit', 'no frequency separates the sine and cosine parts');
  const start = Float64Array.of(best.a, Math.hypot(best.p, best.q), best.c, Math.atan2(best.q, best.p));
  const model: Model = (x, q) => (q[0] as number) + (q[1] as number) * Math.sin((q[2] as number) * x + (q[3] as number));
  const r = lm(call, d, model, start);
  if (!r) return undefined;
  const q = Float64Array.from(r.p);
  // b > 0 and d in (-π, π]
  if ((q[1] as number) < 0) {
    q[1] = -(q[1] as number);
    q[3] = (q[3] as number) + Math.PI;
  }
  q[3] = Math.atan2(Math.sin(q[3] as number), Math.cos(q[3] as number));
  return fitRecord(call, d, {
    model: 'sin', g: (x) => model(x, q), params: q, names: ['a', 'b', 'c', 'd'],
    equation: `y = ${fmt(q[0] as number)}${coef(q[1] as number, false)} sin(${fmt(q[2] as number)} x${coef(q[3] as number, false)})`, inv: r.inv, space: 'data', iterations: r.iterations,
  });
};

/** `y = a / (1 + b e^(-c x))`: start from the range and a linearised line, then Levenberg–Marquardt. */
const runLogistic = (isPts: boolean) => (call: RuleCall): unknown => {
  const d = fitData(call, isPts, isPts ? 1 : 2);
  if (!d) return undefined;
  const n = d.xs.length;
  if (n < 3) return call.fail('too_few_values', `FitLogistic needs 3 points, got ${n}`);
  if (distinctCount(d.xs) < 2) return call.fail('degenerate_x', `all x values are ${d.xs[0]}`);
  let top = -Infinity;
  for (const y of d.ys) top = Math.max(top, y);
  const a0 = top > 0 ? 1.1 * top : 1;
  const us: number[] = [];
  const vs: number[] = [];
  d.xs.forEach((x, i) => {
    const y = d.ys[i] as number;
    if (y > 0 && y < a0) {
      us.push(x);
      vs.push(Math.log(a0 / y - 1));
    }
  });
  let b0 = 1;
  let c0 = 1;
  const ln = us.length >= 2 ? line(Float64Array.from(us), Float64Array.from(vs)) : undefined;
  if (ln) {
    c0 = -ln.a;
    b0 = Math.exp(ln.b);
  }
  const model: Model = (x, q) => (q[0] as number) / (1 + (q[1] as number) * Math.exp(-(q[2] as number) * x));
  const r = lm(call, d, model, Float64Array.of(a0, b0, c0));
  if (!r) return undefined;
  const q = r.p;
  return fitRecord(call, d, {
    model: 'logistic', g: (x) => model(x, q), params: q, names: ['a', 'b', 'c'],
    equation: `y = ${fmt(q[0] as number)} / (1 + ${fmt(q[1] as number)} e^(${fmt(-(q[2] as number))} x))`, inv: r.inv, space: 'data', iterations: r.iterations,
  });
};

/** `FitModel(points, f, start)`: f(x, p1, …, pk) from the start values. */
const runModel = (isPts: boolean) => (call: RuleCall): unknown => {
  const d = fitData(call, isPts, isPts ? 3 : 4);
  if (!d) return undefined;
  const f = call.values[d.next] as FunctionValue | undefined;
  const start = numbers(call, d.next + 1, 'the start values');
  if (!f || !start) return f ? undefined : call.fail('input_undefined', 'the model is undefined');
  if (f.arity !== start.length + 1) return call.fail('bad_parameter', `the model takes ${f.arity} arguments; with ${start.length} start values it needs ${start.length + 1}`);
  if (d.xs.length < start.length) return call.fail('too_few_values', `${start.length} parameters need at least ${start.length} points, got ${d.xs.length}`);
  const model: Model = (x, q) => {
    const v = f.call(x, ...q);
    return typeof v === 'number' ? v : NaN;
  };
  const r = lm(call, d, model, start);
  if (!r) return undefined;
  const q = r.p;
  const names = Array.from({ length: q.length }, (_, j) => `p${j + 1}`);
  return fitRecord(call, d, {
    model: 'model', g: (x) => model(x, q), params: q, names, equation: `y = f(x, ${Array.from(q, (v) => fmt(v)).join(', ')})`, inv: r.inv, space: 'data', iterations: r.iterations,
  });
};

/** `CorrTest(points[, tail])`: the t test of r = 0. */
const runCorrTest = (isPts: boolean) => (call: RuleCall): unknown => {
  const d = pairs(call, 0, isPts);
  if (!d) return undefined;
  const tail = tailOf(call, d.next);
  if (!tail) return undefined;
  const n = d.xs.length;
  if (n < 3) return call.fail('too_few_values', `CorrTest needs 3 points, got ${n}`);
  const r = pearson(d.xs, d.ys);
  if (r !== r) return call.fail('zero_variance', 'one of the variables is constant');
  const df = n - 2;
  const t = Math.abs(r) === 1 ? Math.sign(r) * Infinity : r * Math.sqrt(df / (1 - r * r));
  const pv = tail === 'two' ? Math.min(1, 2 * tSf(Math.abs(t), df)) : tail === 'right' ? tSf(t, df) : tSf(-t, df);
  return record('Test', { statistic: t, p: pv, df, tail, estimate: r, se: Math.sqrt((1 - r * r) / df), n, test: 'CorrTest' });
};

/* ------------------------------ the table ------------------------------ */

const W = (): ParamSpec => opt('weights', L);
const S = (): ParamSpec => opt('space', 'Text', 'data');
const tailCheck = (i: number) => enumCheck(i, 'tail', TAILS, TAIL_ALIASES, 'Use "right" for a test that the value is larger.');

function degreeCheck(i: number) {
  return (c: { args: readonly { literal: unknown }[] }): Refusal | undefined => {
    const v = c.args[i]?.literal;
    if (typeof v !== 'number' || (Number.isInteger(v) && v >= 0 && v <= MAX_POLY_DEGREE)) return undefined;
    return { kind: 'bad_argument', message: `FitPoly degree must be a whole number from 0 to ${MAX_POLY_DEGREE}.`, param: i, hint: 'A degree this high will oscillate. Try 2 or 3.', params: { command: 'FitPoly', why: `the degree must be a whole number from 0 to ${MAX_POLY_DEGREE}, not ${v}` } };
  };
}

/** FitModel: the function's parameter count against a literal start list (errors 2, `arity_mismatch`). */
function modelCheck(fi: number, si: number) {
  return (c: { args: readonly { literal: unknown; type?: string }[] }): Refusal | undefined => {
    const ty = (c.args[fi] as { type?: string } | undefined)?.type ?? '';
    const m = /\((\d)\)$/.exec(ty);
    const start = c.args[si]?.literal;
    if (!m || !Array.isArray(start)) return undefined;
    const arity = Number(m[1]);
    if (arity === start.length + 1) return undefined;
    return { kind: 'bad_argument', message: `The model takes ${arity} arguments; with ${start.length} start values it needs ${start.length + 1}: f(x, p1, …).`, param: fi, params: { command: 'FitModel', why: `the model needs ${start.length + 1} arguments, it takes ${arity}` } };
  };
}

/** Both data forms of a fit: (points, …) and (xs, ys, …). */
function both(name: string, extra: (isPts: boolean) => ParamSpec[], run: (isPts: boolean) => (call: RuleCall) => unknown, summary: string, check?: (off: number) => ((c: never) => Refusal | undefined) | undefined): CommandSpec {
  const mk = (isPts: boolean) => {
    const off = isPts ? 1 : 2;
    const ck = check?.(off);
    return form([...(isPts ? [p('points', P)] : [p('xs', L), p('ys', L)]), ...extra(isPts)], 'Record<Fit>', run(isPts), summary, ck ? { check: ck as never } : {});
  };
  return fits(name, [mk(true), mk(false)]);
}

export const FIT_COMMANDS: readonly CommandSpec[] = [
  both('FitLine', () => [W()], runLine, 'the least-squares line y = a x + b'),
  both('FitLineX', () => [W()], runLineX, 'the line x = a y + b (x on y)'),
  both('FitPoly', () => [p('degree', 'Number'), W()], runPoly, 'the least-squares polynomial of a degree', (off) => degreeCheck(off)),
  both('FitPow', () => [S(), W()], (isPts) => runLogModel('pow', isPts), 'y = a x^b', (off) => enumCheck(off, 'space', SPACES)),
  both('FitExp', () => [S(), W()], (isPts) => runLogModel('exp', isPts), 'y = a e^(b x)', (off) => enumCheck(off, 'space', SPACES)),
  both('FitGrowth', () => [S(), W()], (isPts) => runLogModel('growth', isPts), 'y = a b^x', (off) => enumCheck(off, 'space', SPACES)),
  both('FitLog', () => [W()], runLog, 'y = a + b ln x'),
  both('FitSin', () => [W()], runSin, 'y = a + b sin(c x + d)'),
  both('FitLogistic', () => [W()], runLogistic, 'y = a / (1 + b e^(-c x))'),
  both('Fit', () => [p('basis', 'List<Function<Number>>'), W()], runBasis, 'y = c1 f1(x) + c2 f2(x) + …'),
  both('FitModel', () => [p('f', 'Function<Number>'), p('start', L), W()], runModel, 'the parameters of f(x, p1, …) from start values', (off) => modelCheck(off, off + 1) as never),
  fits('CorrTest', [
    form([p('points', P), opt('tail', 'Text', 'two')], 'Record<Test>', runCorrTest(true), 'the t test that r = 0', { check: tailCheck(1) }),
    form([p('xs', L), p('ys', L), opt('tail', 'Text', 'two')], 'Record<Test>', runCorrTest(false), 'the t test that r = 0', { check: tailCheck(2) }),
  ]),
];

