/**
 * Probability (docs/features/probability/design.md): the distribution types and constructors, evaluating, describing and
 * shading a distribution, and seeded random commands.
 *
 * Plug in with `registerProbability(registry)`.
 */
import type { ActionCall, CommandRegistry, CommandRule, RuleCall } from '../../graph/registry';
import { registerPropertyTypes } from '../../graph/props';
import { FIELDS, registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { PROPERTIES } from '../../language/props';
import { registerValueText } from '../../language/runtime';
import type { FunctionValue } from '../../language/runtime';
import type { BoundArg, CommandForm, CommandSpec, ParamSpec, Refusal } from '../../language/table';
import { T, listOf, registerTypeAlias } from '../../language/types';
import type { Ty } from '../../language/types';
import { registerReasonPhrase } from '../../errors/phrases';
import { registerNotice } from '../../errors/notices';
import { record, registerRecordSchema } from '../lists/types';
import { table } from '../statistics/describe-commands';
import { handlerRunning, pushActionOutcome } from '../numbers/run';
import { DISTRIBUTIONS, discreteQuantileUpper, discreteSpec, dist, distText, distType, heavyTailed, isDist, solveIncreasing } from './dists';
import type { DistSpec, DistributionValue } from './dists';
import { keyOf, streamFor } from './random';

declare module '../../contracts/values' {
  interface AreaUndefReasons {
    // probability
    undefined_moment: true;
    not_continuous: true;
    sample_too_large: true;
    zero_probability: true;
    not_accurate: true;
  }
}

const D = 'Distribution';
const CD = 'ContinuousDistribution';
const DD = 'DiscreteDistribution';
const N = 'Number';
const NL = 'List<Number>';
const p = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const opt = (name: string, type: string, def: number | string | boolean): ParamSpec => ({ name, type, optional: true, default: def });
/** The named-only `seed =` every random command takes (design 6.3). */
const SEED = p('seed', N, { optional: true, named: true, default: 0 });

/** The most draws one random command makes (errors 2, `limit`). */
export const MAX_DRAWS = 1_000_000;
/** The most rows of a `PdfTable` (errors 2, `limit`). */
export const MAX_TABLE_ROWS = 100_000;

type Run = (call: RuleCall) => unknown;
type Check = (c: { args: readonly { literal: unknown; omitted?: boolean }[] }) => Refusal | undefined;

function form(params: readonly ParamSpec[], returns: string, run: Run, summary: string, extra: Partial<CommandForm> = {}): CommandForm {
  const rule = (): CommandRule => ({ run });
  return { params, returns, rule, summary, ...extra };
}

const spec = (group: string) => (name: string, forms: readonly CommandForm[]): CommandSpec => ({ name, kind: 'object', group, forms });
const dists = spec('distributions');
const probs = spec('probability');
const random = spec('random');

const num = (call: RuleCall, i: number): number | undefined => {
  const v = call.values[i];
  return typeof v === 'number' && v === v ? v : undefined;
};

function distArg(call: RuleCall, i: number): DistributionValue | undefined {
  const d = call.values[i];
  return isDist(d) ? d : call.fail('input_undefined', 'the distribution is undefined');
}

const checks = (...hooks: Check[]): Check => (c) => {
  for (const h of hooks) {
    const r = h(c);
    if (r) return r;
  }
  return undefined;
};

/* ------------------------------ constructors ------------------------------ */

function construct(s: DistSpec) {
  return (call: RuleCall): unknown => {
    const ps: number[] = [];
    for (let i = 0; i < s.params.length; i++) {
      const v = num(call, i);
      if (v === undefined) return call.fail('input_undefined', `${(s.params[i] as { name: string }).name} is undefined`);
      ps.push(v);
    }
    for (let i = 0; i < s.params.length; i++) {
      const d = s.params[i] as DistSpec['params'][number];
      if (!d.ok(ps[i] as number, ps)) return call.fail('bad_parameter', `${d.name} is ${ps[i]}; ${s.kind} needs ${d.rule}`);
    }
    return dist(s.kind, ps);
  };
}

/** A legal example for each constructor, for the hint of `bad_argument`. */
const EXAMPLES: Readonly<Record<string, string>> = {
  Normal: 'Normal(0, 1)', StudentT: 'StudentT(5)', ChiSquared: 'ChiSquared(3)', FDist: 'FDist(5, 10)', Exponential: 'Exponential(1)',
  Gamma: 'Gamma(3, 1)', Erlang: 'Erlang(3, 1)', Beta: 'Beta(2, 5)', Cauchy: 'Cauchy(0, 1)', Weibull: 'Weibull(2, 1)', LogNormal: 'LogNormal(0, 0.5)',
  Logistic: 'Logistic(0, 1)', Triangular: 'Triangular(0, 1, 2)', Uniform: 'Uniform(0, 1)', Binomial: 'Binomial(10, 0.5)', Bernoulli: 'Bernoulli(0.5)',
  Geometric: 'Geometric(0.3)', NegBinomial: 'NegBinomial(3, 0.5)', Poisson: 'Poisson(4)', HyperGeometric: 'HyperGeometric(50, 20, 10)',
  Zipf: 'Zipf(1, 10)', DiscreteUniform: 'DiscreteUniform(1, 6)',
};

/** Literal parameters that break the domain are a check-time `bad_argument` (design 10.8). */
function literalCheck(s: DistSpec): Check {
  return (c) => {
    const vals = c.args.map((a) => a.literal);
    if (!vals.every((v) => typeof v === 'number')) return undefined;
    const ps = vals as number[];
    for (let i = 0; i < s.params.length; i++) {
      const d = s.params[i] as DistSpec['params'][number];
      if (!d.ok(ps[i] as number, ps)) {
        const ex = EXAMPLES[s.kind];
        return {
          kind: 'bad_argument', message: `${s.kind} needs ${d.rule}, not ${d.name} = ${ps[i]}.`, param: i,
          ...(ex ? { hint: `For example ${ex}.` } : {}),
          params: { command: s.kind, why: `${s.kind} needs ${d.rule}` },
        };
      }
    }
    return undefined;
  };
}

/** `Discrete(values, probs)`: equal lengths, probabilities ≥ 0 that sum to 1 (rescaled with a notice when not). */
function runDiscrete(call: RuleCall): unknown {
  const vs = call.values[0];
  const ws = call.values[1];
  const values = vs instanceof Float64Array ? vs : Array.isArray(vs) ? Float64Array.from(vs as number[]) : undefined;
  const weights = ws instanceof Float64Array ? ws : Array.isArray(ws) ? Float64Array.from(ws as number[]) : undefined;
  if (!values || !weights) return call.fail('input_undefined', 'a list is undefined');
  if (values.length === 0) return call.fail('empty_list', 'no values');
  if (values.length !== weights.length) return call.fail('bad_weights', `${values.length} values but ${weights.length} probabilities`);
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] as number;
    if (!(w >= 0) || !Number.isFinite(w)) return call.fail('bad_weights', `probability ${i + 1} is ${w}`);
    if (!Number.isFinite(values[i] as number)) return call.fail('not_finite', `value ${i + 1} is not a finite number`);
    sum += w;
  }
  if (!(sum > 0)) return call.fail('bad_weights', 'the probabilities are all zero');
  const off = Math.abs(sum - 1);
  if (off > 1e-9) call.notify(off <= 1e-6 ? 'probs_normalised' : 'probs_not_normalised', { sum: Number(sum.toPrecision(10)) });
  const scaled = off > 1e-15 ? weights.map((w) => w / sum) : weights;
  return { kind: 'dist', spec: discreteSpec(values, scaled), params: [] } satisfies DistributionValue;
}

const CONSTRUCTORS: readonly CommandSpec[] = [
  ...DISTRIBUTIONS.map((s) => dists(s.kind, [form(s.params.map((x) => p(x.name, N)), distType(s), construct(s), `the ${s.kind} distribution`, { check: literalCheck(s) })])),
  dists('Discrete', [form([p('values', NL), p('probs', NL)], DD, runDiscrete, 'a distribution on the given values with the given probabilities')]),
];

/* ------------------------------ evaluate ------------------------------ */

/** A function value of x with a batch evaluator; `lattice` marks a discrete mass for the plotter, `step` a step cdf. */
export function fnOfDist(g: (x: number) => number, lattice: boolean, step = false): FunctionValue & { lattice: boolean; step: boolean } {
  const call1 = (x: number): number => {
    const v = g(x);
    return Number.isFinite(v) ? v : NaN;
  };
  return {
    arity: 1, ret: 'Number', call: (x: number) => call1(x), call1, lattice, step,
    batch(xs: Float64Array, out: Float64Array) {
      for (let i = 0; i < xs.length; i++) out[i] = call1(xs[i] as number);
    },
  };
}

const pdf = (d: DistributionValue, x: number): number => d.spec.pdf(d.params, x);
const logpdf = (d: DistributionValue, x: number): number => (d.spec.logpdf ? d.spec.logpdf(d.params, x) : Math.log(pdf(d, x)));
const cdf = (d: DistributionValue, x: number): number => d.spec.cdf(d.params, x);
const sf = (d: DistributionValue, x: number): number => d.spec.sf(d.params, x);
/** P(X < x) for a discrete distribution. */
const below = (d: DistributionValue, x: number): number => (d.spec.cdfBelow ? d.spec.cdfBelow(d.params, x) : cdf(d, Math.ceil(x) - 1));

const at = (f: (d: DistributionValue, x: number) => number) => (call: RuleCall): unknown => {
  const d = distArg(call, 0);
  if (!d) return undefined;
  const x = call.values[1];
  if (typeof x !== 'number' || x !== x) return call.fail('input_undefined', 'x is undefined');
  return f(d, x);
};

/** P(a ≤ X ≤ b), with the ends of a discrete interval as given (design 4.1). Far-out intervals use survival values. */
export function probOf(d: DistributionValue, a: number, b: number, ends: string): number {
  if (b < a) return 0;
  // infinite bounds read the ends of the cdf directly
  if (a === -Infinity && b === Infinity) return 1;
  if (a === -Infinity) return Math.min(1, Math.max(0, d.spec.discrete && ends[1] === ')' ? below(d, b) : cdf(d, b)));
  if (b === Infinity) return Math.min(1, Math.max(0, d.spec.discrete && ends[0] === '[' ? 1 - below(d, a) : sf(d, a)));
  if (!d.spec.discrete) {
    const m = d.spec.moments(d.params).median;
    if (m !== undefined && a > m) return Math.max(0, sf(d, a) - sf(d, b));
    return Math.max(0, cdf(d, b) - cdf(d, a));
  }
  const hi = ends[1] === ']' ? cdf(d, b) : below(d, b);
  const lo = ends[0] === '[' ? below(d, a) : cdf(d, a);
  return Math.max(0, Math.min(1, hi - lo));
}

const ENDS = ['[]', '[)', '(]', '()'];

function runProb(call: RuleCall): unknown {
  const d = distArg(call, 0);
  const a = call.values[1];
  const b = call.values[2];
  const ends = typeof call.values[3] === 'string' ? call.values[3] : '[]';
  if (!d) return undefined;
  if (typeof a !== 'number' || typeof b !== 'number' || a !== a || b !== b) return call.fail('input_undefined', 'a bound is undefined');
  if (!ENDS.includes(ends)) return call.fail('bad_argument', `ends must be "[]", "[)", "(]" or "()", not "${ends}"`);
  return probOf(d, a, b, ends);
}

/** The x with P(X ≤ x) = q (or P(X > x) = q for `upper`), using the spec's own method when it has one. */
export function quantileOf(d: DistributionValue, q: number, upper: boolean): number {
  const s = d.spec.support(d.params);
  if (!upper) {
    if (q <= 0) return s.lo;
    if (q >= 1) return s.hi;
    return d.spec.quantile(d.params, q);
  }
  if (q >= 1) return s.lo;
  if (q <= 0) return s.hi;
  if (d.spec.quantileUpper) return d.spec.quantileUpper(d.params, q);
  if (d.spec.discrete) return discreteQuantileUpper((k) => sf(d, k), q, s.lo, s.hi);
  if (q > 0.01) return d.spec.quantile(d.params, 1 - q);
  return solveIncreasing((x) => -sf(d, x), (x) => pdf(d, x), -q, s.lo, s.hi, d.spec.quantile(d.params, 1 - Math.max(q, 1e-12)));
}

function runQuantile(call: RuleCall): unknown {
  const d = distArg(call, 0);
  const q = num(call, 1);
  const tail = typeof call.values[2] === 'string' ? call.values[2] : 'left';
  if (!d) return undefined;
  if (q === undefined || q < 0 || q > 1) return call.fail('out_of_range', `q = ${String(q)} must be between 0 and 1`);
  const upper = tail === 'right';
  const x = quantileOf(d, q, upper);
  if (d.spec.discrete && q > 0 && q < 1 && Number.isFinite(x)) {
    const reached = upper ? sf(d, x) : cdf(d, x);
    if (Math.abs(reached - q) > 1e-9) {
      call.notify('rounding_discrete_quantile', { kind: d.spec.kind, op: upper ? '>' : '≤', x, reached: Number(reached.toPrecision(6)), q });
    }
  }
  if (x !== x) return call.fail('no_convergence', `no bracket for q = ${q}`);
  return x;
}

function runCentral(call: RuleCall): unknown {
  const d = distArg(call, 0);
  const m = num(call, 1);
  if (!d) return undefined;
  if (m === undefined || !(m > 0 && m < 1)) return call.fail('out_of_range', `the mass must be between 0 and 1, not ${String(m)}`);
  const t = (1 - m) / 2;
  return record('CentralInterval', { lo: quantileOf(d, t, false), hi: quantileOf(d, t, true), mass: m });
}

/** `MinTrials(p, k, confidence)`: the smallest n with P(Binomial(n, p) ≥ k) ≥ confidence (design 4.1). */
function runMinTrials(call: RuleCall): unknown {
  const pp = num(call, 0);
  const k = num(call, 1);
  const c = num(call, 2);
  if (pp === undefined || k === undefined || c === undefined) return call.fail('input_undefined', 'an argument is undefined');
  if (pp < 0 || pp > 1) return call.fail('out_of_range', `p = ${pp} must be between 0 and 1`);
  if (c < 0 || c >= 1) return call.fail('out_of_range', `the confidence must be from 0 up to (not including) 1, not ${c}`);
  if (!Number.isInteger(k) || k < 0) return call.fail('bad_parameter', `k is ${k}; it must be a whole number from 0`);
  if (k === 0) return 0;
  if (pp === 0) return call.fail('zero_probability', `with p = 0 there can never be ${k} successes`);
  // P(Binomial(n, p) ≥ k) = 1 - cdf(k - 1) rises with n
  const atLeast = (n: number): number => (n < k ? 0 : 1 - cdf(dist('Binomial', [n, pp]), k - 1));
  let hi = Math.max(k, 1);
  while (atLeast(hi) < c) {
    if (!call.work.spend()) return call.fail('no_convergence', 'too many trials');
    hi *= 2;
    if (hi > 1e15) return call.fail('no_convergence', 'too many trials');
  }
  let lo = k;
  while (lo < hi) {
    if (!call.work.spend()) return call.fail('no_convergence', 'too many trials');
    const m = Math.floor((lo + hi) / 2);
    if (atLeast(m) >= c) hi = m;
    else lo = m + 1;
  }
  return lo;
}

/* ------------------------------ describe ------------------------------ */

type MomentName = 'mean' | 'variance' | 'sd' | 'skewness' | 'kurtosis' | 'median';

const MOMENT_WORDS: Readonly<Record<MomentName, string>> = {
  mean: 'mean', variance: 'variance', sd: 'standard deviation', skewness: 'skewness', kurtosis: 'kurtosis', median: 'median',
};

/** A moment of the distribution; kurtosis is the plain (not excess) kurtosis, as for a list. */
export function momentOf(d: DistributionValue, kind: MomentName): number | undefined {
  const m = d.spec.moments(d.params);
  switch (kind) {
    case 'mean': return m.mean;
    case 'variance': return m.variance;
    case 'sd': return m.variance === undefined ? undefined : Math.sqrt(m.variance);
    case 'skewness': return m.skewness;
    case 'kurtosis': return m.kurtosis === undefined ? undefined : m.kurtosis + 3;
    case 'median': return m.median ?? d.spec.quantile(d.params, 0.5);
  }
}

function moment(kind: MomentName) {
  return (call: RuleCall): unknown => {
    const d = distArg(call, 0);
    if (!d) return undefined;
    const v = momentOf(d, kind);
    if (v === undefined) {
      const why = d.spec.kind === 'Cauchy' ? 'Cauchy' : `${d.spec.kind} with these parameters`;
      return call.fail('undefined_moment', `${why} has no ${MOMENT_WORDS[kind]}`);
    }
    if (v === Infinity) return call.fail('undefined_moment', `${d.spec.kind} with these parameters has infinite ${MOMENT_WORDS[kind]}`);
    return v;
  };
}

function runMode(call: RuleCall): unknown {
  const d = distArg(call, 0);
  if (!d) return undefined;
  const m = d.spec.moments(d.params).mode;
  if (!m) return call.fail('undefined_moment', `every value of ${d.spec.kind} is equally likely, so it has no single mode`);
  return Float64Array.from(m);
}

function runSupport(call: RuleCall): unknown {
  const d = distArg(call, 0);
  if (!d) return undefined;
  const s = d.spec.support(d.params);
  return record('Support', { lo: s.lo, hi: s.hi, discrete: d.spec.discrete });
}

/** A sensible window for drawing the distribution (design 4.2). */
export function plotRange(d: DistributionValue): { lo: number; hi: number; ymax: number; heavy: boolean } {
  const s = d.spec.support(d.params);
  const heavy = heavyTailed(d);
  let lo: number;
  let hi: number;
  if (d.spec.discrete) {
    const m = d.spec.moments(d.params);
    const sd = m.variance !== undefined && Number.isFinite(m.variance) ? Math.sqrt(m.variance) : undefined;
    if (m.mean !== undefined && sd !== undefined) {
      lo = Math.max(s.lo, Math.floor(m.mean - 4 * sd));
      hi = Math.min(s.hi, Math.ceil(m.mean + 4 * sd));
    } else {
      lo = Math.max(s.lo, quantileOf(d, 0.001, false));
      hi = Math.min(s.hi, quantileOf(d, 0.001, true));
    }
    if (hi <= lo) hi = lo + 1;
    let ymax = 0;
    const step = Math.max(1, Math.ceil((hi - lo) / 2000));
    for (let k = lo; k <= hi; k += step) ymax = Math.max(ymax, pdf(d, k));
    return { lo: lo - 0.5, hi: hi + 0.5, ymax, heavy: false };
  }
  const tail = heavy ? 0.01 : 0.0005;
  lo = Number.isFinite(s.lo) && cdf(d, s.lo + 1e-12 * Math.max(1, Math.abs(s.lo))) > 0.0005 ? s.lo : quantileOf(d, tail, false);
  hi = Number.isFinite(s.hi) && sf(d, s.hi - 1e-12 * Math.max(1, Math.abs(s.hi))) > 0.0005 ? s.hi : quantileOf(d, tail, true);
  if (Number.isFinite(s.lo) && s.lo >= 0 && lo < (hi - lo) * 0.1 + s.lo) lo = s.lo;
  if (!(hi > lo)) hi = lo + 1;
  const vals: number[] = [];
  for (let i = 0; i <= 400; i++) {
    const y = pdf(d, lo + ((hi - lo) * i) / 400);
    if (Number.isFinite(y)) vals.push(y);
  }
  vals.sort((x, y) => x - y);
  // an infinite spike at an end is cut at the 99th percentile of the samples
  let ymax = vals.length > 0 ? (vals[vals.length - 1] as number) : 1;
  if (vals.length > 10 && ymax > 10 * (vals[Math.floor(vals.length * 0.97)] as number)) ymax = vals[Math.floor(vals.length * 0.97)] as number;
  return { lo, hi, ymax, heavy };
}

function runPlotRange(call: RuleCall): unknown {
  const d = distArg(call, 0);
  if (!d) return undefined;
  const r = plotRange(d);
  if (r.heavy) call.notify('heavy_tail_plot', { kind: d.spec.kind });
  return record('PlotRange', { lo: r.lo, hi: r.hi, ymax: r.ymax });
}

function runNormalApprox(call: RuleCall): unknown {
  const d = distArg(call, 0);
  if (!d) return undefined;
  const m = d.spec.moments(d.params);
  if (m.mean === undefined || m.variance === undefined || !Number.isFinite(m.variance)) return call.fail('undefined_moment', `${d.spec.kind} has no finite mean and variance`);
  if (!(m.variance > 0)) return call.fail('bad_parameter', `${d.spec.kind} has variance 0`);
  return dist('Normal', [m.mean, Math.sqrt(m.variance)]);
}

/* ------------------------------ show ------------------------------ */

const regionOf = (d: DistributionValue, shape: { t: 'under' | 'tails'; a: number; b: number }, mass: number): unknown => ({
  kind: 'region', shape, value: mass, area: mass, mass, f: (x: number) => pdf(d, x), g: null,
});

function bounds(call: RuleCall): [number, number] | undefined {
  const a = call.values[1];
  const b = call.values[2];
  if (typeof a !== 'number' || typeof b !== 'number' || a !== a || b !== b) return call.fail('input_undefined', 'a bound is undefined');
  return [a, b];
}

/** The area under a continuous density from a to b (design 4.3). */
function runShade(call: RuleCall): unknown {
  const d = distArg(call, 0);
  if (!d) return undefined;
  const ab = bounds(call);
  if (!ab) return undefined;
  if (d.spec.discrete) return call.fail('not_continuous', `${d.spec.kind} is discrete; use BarChart(d)`);
  const lo = Math.min(ab[0], ab[1]);
  const hi = Math.max(ab[0], ab[1]);
  return regionOf(d, { t: 'under', a: lo, b: hi }, probOf(d, lo, hi, '[]'));
}

/** Bars of a discrete distribution with those in [a, b] (or outside it, for tails) picked out. */
function shadedBars(call: RuleCall, d: DistributionValue, a: number, b: number, ends: string, tails: boolean): unknown {
  const r = plotRange(d);
  const s = d.spec.support(d.params);
  let lo = Math.ceil(Math.max(s.lo, Math.min(r.lo, Number.isFinite(a) ? a : r.lo)));
  let hi = Math.floor(Math.min(s.hi, Math.max(r.hi, Number.isFinite(b) ? b : r.hi)));
  if (d.spec.atoms) {
    lo = s.lo;
    hi = s.hi;
  }
  const xs: number[] = [];
  if (d.spec.atoms) xs.push(...d.spec.atoms.values);
  else {
    if (hi - lo + 1 > MAX_TABLE_ROWS) return call.fail('too_large', `${hi - lo + 1} bars; at most ${MAX_TABLE_ROWS.toLocaleString('en')}`);
    for (let k = lo; k <= hi; k++) xs.push(k);
  }
  const inA = (x: number): boolean => (ends[0] === '[' ? x >= a : x > a);
  const inB = (x: number): boolean => (ends[1] === ']' ? x <= b : x < b);
  const X = Float64Array.from(xs);
  const H = X.map((x) => pdf(d, x));
  // for tails "[" puts the bound itself in the left tail and "]" in the right one
  const inTails = (x: number): boolean => (ends[0] === '[' ? x <= a : x < a) || (ends[1] === ']' ? x >= b : x > b);
  const inside = X.map((x) => ((tails ? inTails(x) : inA(x) && inB(x)) ? 1 : 0));
  const mass = tails ? (ends[0] === '[' ? cdf(d, a) : below(d, a)) + (ends[1] === ']' ? sf(d, b) + pdf(d, b) : sf(d, b)) : probOf(d, a, b, ends);
  let total = 0;
  for (const h of H) total += h;
  const labels = Array.from(X, (x) => String(x));
  return record('ShadedBars', { xs: X, heights: H, width: 0.9, total, labels, inside, lo: a, hi: b, ends, mass: Math.min(1, Math.max(0, mass)), tails });
}

function runShadeDiscrete(call: RuleCall): unknown {
  const d = distArg(call, 0);
  if (!d) return undefined;
  const ab = bounds(call);
  if (!ab) return undefined;
  const ends = typeof call.values[3] === 'string' ? call.values[3] : '[]';
  return shadedBars(call, d, Math.min(...ab), Math.max(...ab), ends, false);
}

function runTailsContinuous(call: RuleCall): unknown {
  const d = distArg(call, 0);
  if (!d) return undefined;
  const ab = bounds(call);
  if (!ab) return undefined;
  const lo = Math.min(...ab);
  const hi = Math.max(...ab);
  return regionOf(d, { t: 'tails', a: lo, b: hi }, Math.min(1, cdf(d, lo) + sf(d, hi)));
}

function runTailsDiscrete(call: RuleCall): unknown {
  const d = distArg(call, 0);
  if (!d) return undefined;
  const ab = bounds(call);
  if (!ab) return undefined;
  // X < lo and X > hi unless the ends say otherwise: "[]" here includes the bounds in the tails
  const ends = typeof call.values[3] === 'string' ? call.values[3] : '()';
  return shadedBars(call, d, Math.min(...ab), Math.max(...ab), ends === '()' ? '()' : ends, true);
}

function runPdfTableDiscrete(call: RuleCall): unknown {
  const d = distArg(call, 0);
  const from = num(call, 1);
  const to = num(call, 2);
  if (!d) return undefined;
  if (from === undefined || to === undefined) return call.fail('input_undefined', 'a bound is undefined');
  const s = d.spec.support(d.params);
  const lo = Math.ceil(Math.max(Math.min(from, to), s.lo));
  const hi = Math.floor(Math.min(Math.max(from, to), s.hi));
  const n = Math.max(0, hi - lo + 1);
  if (n > MAX_TABLE_ROWS) return call.fail('too_large', `range ${lo}..${hi} is ${n.toLocaleString('en')} rows; at most ${MAX_TABLE_ROWS.toLocaleString('en')}`);
  const k = new Float64Array(n);
  const pk = new Float64Array(n);
  const le = new Float64Array(n);
  const ge = new Float64Array(n);
  if (n > 0) {
    // one cdf and one survival value, then running sums of the mass
    let c = cdf(d, lo - 1);
    for (let i = 0; i < n; i++) {
      const x = lo + i;
      const m = pdf(d, x);
      k[i] = x;
      pk[i] = m;
      ge[i] = Math.min(1, Math.max(0, 1 - c));
      c += m;
      le[i] = Math.min(1, c);
    }
    // the upper tail from the survival function, where it is accurate
    for (let i = 0; i < n; i++) if ((ge[i] as number) < 0.5) ge[i] = sf(d, lo + i - 1);
  }
  return table(['k', 'P(X = k)', 'P(X ≤ k)', 'P(X ≥ k)'], [k, pk, le, ge], `${distText(d)}, k from ${lo} to ${hi}`);
}

function runPdfTableContinuous(call: RuleCall): unknown {
  const d = distArg(call, 0);
  const from = num(call, 1);
  const to = num(call, 2);
  const step = num(call, 3);
  if (!d) return undefined;
  if (from === undefined || to === undefined || step === undefined) return call.fail('input_undefined', 'an argument is undefined');
  if (!(step > 0)) return call.fail('bad_parameter', `step is ${step}; it must be above 0`);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const n = Math.floor((hi - lo) / step + 1e-9) + 1;
  if (n > MAX_TABLE_ROWS) return call.fail('too_large', `${n.toLocaleString('en')} rows; at most ${MAX_TABLE_ROWS.toLocaleString('en')}`);
  const x = new Float64Array(n);
  const f = new Float64Array(n);
  const F = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const v = lo + i * step;
    x[i] = v;
    f[i] = pdf(d, v);
    F[i] = cdf(d, v);
  }
  return table(['x', 'f(x)', 'F(x)'], [x, f, F], `${distText(d)}, x from ${lo} to ${hi} step ${step}`);
}

/* ------------------------------ random ------------------------------ */

const seedOf = (call: RuleCall, i: number): number => {
  const v = call.values[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/** One draw of `d` from sub-stream `index`. */
function drawFrom(d: DistributionValue, key: ReturnType<typeof keyOf>, index: number): number {
  const u = streamFor(key, index);
  return d.spec.sample ? d.spec.sample(d.params, u) : d.spec.quantile(d.params, u());
}

function count(call: RuleCall, i: number, what = 'n'): number | undefined {
  const n = num(call, i);
  if (n === undefined) return call.fail('input_undefined', `${what} is undefined`);
  if (!Number.isInteger(n) || n < 0) return call.fail('bad_parameter', `${what} is ${n}; it must be a whole number from 0`);
  if (n > MAX_DRAWS) return call.fail('limit', `${n.toLocaleString('en')} draws; at most ${MAX_DRAWS.toLocaleString('en')}`);
  return n;
}

function runDraw(call: RuleCall): unknown {
  const d = distArg(call, 0);
  if (!d) return undefined;
  return drawFrom(d, keyOf(call.random, seedOf(call, 1)), 0);
}

function runSampleDist(call: RuleCall): unknown {
  const d = distArg(call, 0);
  const n = count(call, 1);
  if (!d || n === undefined) return undefined;
  const key = keyOf(call.random, seedOf(call, 2));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = drawFrom(d, key, i);
  return out;
}

const itemsOf = (v: unknown): readonly unknown[] | undefined => (v instanceof Float64Array ? Array.from(v) : Array.isArray(v) ? v : undefined);
const asList = (like: unknown, items: unknown[]): unknown => (like instanceof Float64Array ? Float64Array.from(items as number[]) : items);

function runSampleList(call: RuleCall): unknown {
  const src = call.values[0];
  const items = itemsOf(src);
  const n = count(call, 1);
  const replace = typeof call.values[2] === 'boolean' ? call.values[2] : true;
  if (!items) return call.fail('input_undefined', 'the list is undefined');
  if (n === undefined) return undefined;
  if (items.length === 0) return n === 0 ? asList(src, []) : call.fail('empty_list', 'the list is empty');
  if (!replace && n > items.length) return call.fail('sample_too_large', `asked ${n}, the list has ${items.length}`);
  const key = keyOf(call.random, seedOf(call, 3));
  const out: unknown[] = new Array<unknown>(n);
  if (replace) {
    for (let i = 0; i < n; i++) out[i] = items[Math.floor(streamFor(key, i)() * items.length)];
  } else {
    // a partial Fisher–Yates shuffle where step i uses sub-stream i, so prefixes are stable
    const a = items.slice();
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(streamFor(key, i)() * (a.length - i));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
      out[i] = a[i];
    }
  }
  return asList(src, out);
}

function intRange(call: RuleCall): [number, number] | undefined {
  const lo = num(call, 0);
  const hi = num(call, 1);
  if (lo === undefined || hi === undefined) return call.fail('input_undefined', 'a bound is undefined');
  const a = Math.ceil(lo);
  const b = Math.floor(hi);
  if (b < a) return call.fail('bad_parameter', `there is no whole number from ${lo} to ${hi}`);
  return [a, b];
}

function runRandomInt(many: boolean) {
  return (call: RuleCall): unknown => {
    const r = intRange(call);
    if (!r) return undefined;
    const n = many ? count(call, 2) : 1;
    if (n === undefined) return undefined;
    const key = keyOf(call.random, seedOf(call, many ? 3 : 2));
    const span = r[1] - r[0] + 1;
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = r[0] + Math.floor(streamFor(key, i)() * span);
    return many ? out : out[0];
  };
}

function runRandomReal(many: boolean) {
  return (call: RuleCall): unknown => {
    const lo = num(call, 0);
    const hi = num(call, 1);
    if (lo === undefined || hi === undefined) return call.fail('input_undefined', 'a bound is undefined');
    if (!(hi >= lo) || !Number.isFinite(hi - lo)) return call.fail('bad_parameter', `hi is ${hi}; it must be at least lo = ${lo}`);
    const n = many ? count(call, 2) : 1;
    if (n === undefined) return undefined;
    const key = keyOf(call.random, seedOf(call, many ? 3 : 2));
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = lo + streamFor(key, i)() * (hi - lo);
    return many ? out : out[0];
  };
}

function runRandomElement(call: RuleCall): unknown {
  const items = itemsOf(call.values[0]);
  if (!items) return call.fail('input_undefined', 'the list is undefined');
  if (items.length === 0) return call.fail('empty_list', 'the list is empty');
  const key = keyOf(call.random, seedOf(call, 1));
  return items[Math.floor(streamFor(key, 0)() * items.length)];
}

/** The text of a polynomial with whole coefficients, highest power first: "3x^2 - x + 4". */
export function polyText(c: readonly number[]): string {
  let s = '';
  for (let k = c.length - 1; k >= 0; k--) {
    const a = c[k] as number;
    if (a === 0) continue;
    const mag = Math.abs(a);
    const body = k === 0 ? String(mag) : `${mag === 1 ? '' : mag}x${k > 1 ? `^${k}` : ''}`;
    s += s === '' ? (a < 0 ? `-${body}` : body) : a < 0 ? ` - ${body}` : ` + ${body}`;
  }
  return s === '' ? '0' : s;
}

function runRandomPolynomial(call: RuleCall): unknown {
  const deg = num(call, 0);
  const lo = num(call, 1);
  const hi = num(call, 2);
  if (deg === undefined || lo === undefined || hi === undefined) return call.fail('input_undefined', 'an argument is undefined');
  if (!Number.isInteger(deg) || deg < 0 || deg > 50) return call.fail('bad_parameter', `degree is ${deg}; it must be a whole number from 0 to 50`);
  const a = Math.ceil(lo);
  const b = Math.floor(hi);
  if (b < a) return call.fail('bad_parameter', `there is no whole number from ${lo} to ${hi}`);
  if (deg > 0 && a === 0 && b === 0) return call.fail('bad_parameter', 'the leading coefficient cannot be 0 when every coefficient is 0');
  const key = keyOf(call.random, seedOf(call, 3));
  const span = b - a + 1;
  const c: number[] = [];
  for (let k = 0; k <= deg; k++) {
    const u = streamFor(key, k);
    let v = a + Math.floor(u() * span);
    // the leading coefficient is drawn again until it is not 0 (from the same sub-stream)
    for (let t = 0; k === deg && deg > 0 && v === 0 && t < 64; t++) v = a + Math.floor(u() * span);
    if (k === deg && deg > 0 && v === 0) v = b !== 0 ? b : a;
    c.push(v);
  }
  const call1 = (x: number): number => {
    let y = 0;
    for (let k = c.length - 1; k >= 0; k--) y = y * x + (c[k] as number);
    return y;
  };
  const fn: FunctionValue & { randomPoly: readonly number[] } = {
    arity: 1, ret: 'Number', call: (x: number) => call1(x), call1, randomPoly: c,
    batch(xs: Float64Array, out: Float64Array) {
      for (let i = 0; i < xs.length; i++) out[i] = call1(xs[i] as number);
    },
  };
  return fn;
}

/** `Reroll(obj, …)`: adds 1 to each object's re-roll count, or to a free number that is used as a seed (design 6.3). */
function rerollRule(_args: readonly BoundArg[]): unknown {
  return {
    run: (call: ActionCall) => {
      const figure = call.figure;
      const wrote: import('../../contracts/values').ObjId[] = [];
      const names: string[] = [];
      for (const id of call.objects) {
        const view = figure.get(id);
        if (!view) continue;
        const v = figure.value(id);
        const line = view.free && typeof v === 'number' ? `${view.name} = ${v + 1}` : `${view.name} with reroll = ${rerollCount(view) + 1}`;
        const r = figure.apply(line);
        if (!r.ok) {
          pushActionOutcome(figure, { status: 'error', error: r });
          return handlerRunning(figure) ? { summary: `Reroll(${view.name}) failed` } : { summary: `Reroll(${view.name}) failed`, error: r };
        }
        wrote.push(id);
        names.push(view.name);
      }
      pushActionOutcome(figure, { status: 'done', wrote });
      return { summary: `rerolled ${names.join(', ')}` };
    },
  };
}

function rerollCount(view: { readonly style: unknown }): number {
  const ext = (view.style as { ext?: Record<string, unknown> }).ext;
  const v = ext?.['reroll'];
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
}

/* ------------------------------ check hooks ------------------------------ */

const optionCheck = (i: number, param: string, allowed: readonly string[], hint: string): Check => (c) => {
  const v = c.args[i]?.literal;
  if (typeof v !== 'string' || allowed.includes(v)) return undefined;
  const list = allowed.map((a) => `"${a}"`).join(', ');
  return { kind: 'bad_option', message: `${param} must be one of ${list}.`, param: i, hint, params: { command: param, why: `${param} must be one of ${list}, not "${v}"` } };
};
const tailCheck = optionCheck(2, 'tail', ['left', 'right'], 'Use "right" for a precise upper tail: Quantile(d, 0.001, "right").');
const endsCheck = optionCheck(3, 'ends', ENDS, 'Square bracket includes the end; round bracket leaves it out. "[)" means a ≤ X < b.');

const probCheck = (i: number, what: string): Check => (c) => {
  const v = c.args[i]?.literal;
  if (typeof v !== 'number' || (v >= 0 && v <= 1)) return undefined;
  return { kind: 'bad_argument', message: `${what} must be between 0 and 1, not ${v}.`, param: i, params: { command: what, why: `${what} must be between 0 and 1` } };
};

const drawsCheck = (i: number): Check => (c) => {
  const v = c.args[i]?.literal;
  if (typeof v !== 'number') return undefined;
  if (v > MAX_DRAWS) return { kind: 'limit', message: `A random command makes at most ${MAX_DRAWS.toLocaleString('en')} draws; this asks for ${v}.`, param: i, limit: { name: 'draws', max: MAX_DRAWS, got: v }, hint: 'Use fewer draws.' };
  if (!Number.isInteger(v) || v < 0) return { kind: 'bad_argument', message: `n must be a whole number from 0, not ${v}.`, param: i, params: { command: 'n', why: 'n must be a whole number from 0' } };
  return undefined;
};

const rangeCheck: Check = (c) => {
  const a = c.args[0]?.literal;
  const b = c.args[1]?.literal;
  if (typeof a !== 'number' || typeof b !== 'number' || a <= b) return undefined;
  return { kind: 'bad_argument', message: `The low end ${a} is above the high end ${b}.`, param: 1, hint: `Write it the other way round: (${b}, ${a}).`, params: { command: 'range', why: 'lo must not be above hi' } };
};

const tableRowsCheck: Check = (c) => {
  const a = c.args[1]?.literal;
  const b = c.args[2]?.literal;
  if (typeof a !== 'number' || typeof b !== 'number' || Math.abs(b - a) + 1 <= MAX_TABLE_ROWS) return undefined;
  return { kind: 'limit', message: `A table has at most ${MAX_TABLE_ROWS.toLocaleString('en')} rows; this asks for ${Math.abs(b - a) + 1}.`, param: 2, limit: { name: 'table_rows', max: MAX_TABLE_ROWS, got: Math.abs(b - a) + 1 } };
};

/* ------------------------------ the table ------------------------------ */

const EVALUATE: readonly CommandSpec[] = [
  probs('Pdf', [
    form([p('d', D), p('x', N)], N, at(pdf), 'the density (or the mass) at x'),
    form([p('d', D)], 'Function<Number>', (c) => { const d = distArg(c, 0); return d ? fnOfDist((x) => pdf(d, x), d.spec.discrete) : undefined; }, 'the density as a function'),
  ]),
  probs('LogPdf', [form([p('d', D), p('x', N)], N, at(logpdf), 'the log of the density, accurate where Pdf underflows')]),
  probs('Cdf', [
    form([p('d', D), p('x', N)], N, at(cdf), 'P(X ≤ x)'),
    form([p('d', D)], 'Function<Number>', (c) => { const d = distArg(c, 0); return d ? fnOfDist((x) => cdf(d, x), false, d.spec.discrete) : undefined; }, 'the cumulative distribution as a function'),
    form([p('d', D), p('a', N), p('b', N)], N, runProb, 'P(a ≤ X ≤ b)'),
  ]),
  probs('Sf', [form([p('d', D), p('x', N)], N, at(sf), 'P(X > x), accurate in the upper tail')]),
  probs('Prob', [form([p('d', D), p('a', N), p('b', N), opt('ends', 'Text', '[]')], N, runProb, 'the probability of an interval', { check: endsCheck })]),
  probs('Quantile', [form([p('d', D), p('q', N), opt('tail', 'Text', 'left')], N, runQuantile, 'the smallest x with Cdf(d, x) ≥ q', { check: checks(probCheck(1, 'q'), tailCheck) })]),
  probs('CentralInterval', [form([p('d', D), p('mass', N)], 'Record<CentralInterval>', runCentral, 'the interval with equal tails holding the mass')]),
  probs('MinTrials', [form([p('p', N), p('k', N), p('confidence', N)], N, runMinTrials, 'the fewest trials for at least k successes with the given confidence', { check: checks(probCheck(0, 'p')) })]),
  probs('Mean', [form([p('d', D)], N, moment('mean'), 'the mean of the distribution')]),
  probs('Variance', [form([p('d', D)], N, moment('variance'), 'the variance of the distribution')]),
  probs('StdDev', [form([p('d', D)], N, moment('sd'), 'the standard deviation of the distribution')]),
  probs('Skewness', [form([p('d', D)], N, moment('skewness'), 'the skewness of the distribution')]),
  probs('Kurtosis', [form([p('d', D)], N, moment('kurtosis'), 'the kurtosis of the distribution (3 for a normal)')]),
  probs('Median', [form([p('d', D)], N, moment('median'), 'the median of the distribution')]),
  probs('Mode', [form([p('d', D)], NL, runMode, 'the most likely values')]),
  probs('Support', [form([p('d', D)], 'Record<Support>', runSupport, 'where the distribution lives: lo, hi, discrete')]),
  probs('PlotRange', [form([p('d', D)], 'Record<PlotRange>', runPlotRange, 'a sensible window to draw the distribution')]),
  probs('NormalApprox', [form([p('d', D)], CD, runNormalApprox, 'the normal with the same mean and standard deviation')]),
  probs('Shade', [
    form([p('d', CD), p('a', N), p('b', N)], 'Region', runShade, 'the area under the density from a to b'),
    form([p('d', DD), p('a', N), p('b', N), opt('ends', 'Text', '[]')], 'Chart<ShadedBars>', runShadeDiscrete, 'the bars from a to b picked out', { check: endsCheck }),
  ]),
  probs('ShadeTails', [
    form([p('d', CD), p('lo', N), p('hi', N)], 'Region', runTailsContinuous, 'the area left of lo and right of hi'),
    form([p('d', DD), p('lo', N), p('hi', N), opt('ends', 'Text', '()')], 'Chart<ShadedBars>', runTailsDiscrete, 'the bars below lo and above hi picked out', { check: endsCheck }),
  ]),
  probs('PdfTable', [
    form([p('d', DD), p('from', N), p('to', N)], 'Table', runPdfTableDiscrete, 'k, P(X = k), P(X ≤ k) and P(X ≥ k) for each k', { check: tableRowsCheck }),
    form([p('d', CD), p('from', N), p('to', N), p('step', N)], 'Table', runPdfTableContinuous, 'x, f(x) and F(x) at each step'),
  ]),
];

const RANDOM: readonly CommandSpec[] = [
  random('Draw', [form([p('d', D), SEED], N, runDraw, 'one random value of the distribution')]),
  random('Sample', [
    form([p('d', D), p('n', N), SEED], NL, runSampleDist, 'n independent draws', { check: drawsCheck(1) }),
    form([p('list', 'List'), p('n', N), opt('replace', 'Bool', true), SEED], '=list', runSampleList, 'n elements of the list, with or without replacement', { check: drawsCheck(1) }),
  ]),
  random('RandomInt', [
    form([p('lo', N), p('hi', N), SEED], N, runRandomInt(false), 'a whole number from lo to hi', { check: rangeCheck }),
    form([p('lo', N), p('hi', N), p('n', N), SEED], NL, runRandomInt(true), 'n whole numbers from lo to hi', { check: checks(rangeCheck, drawsCheck(2)) }),
  ]),
  random('RandomReal', [
    form([p('lo', N), p('hi', N), SEED], N, runRandomReal(false), 'a number from lo up to hi', { check: rangeCheck }),
    form([p('lo', N), p('hi', N), p('n', N), SEED], NL, runRandomReal(true), 'n numbers from lo up to hi', { check: checks(rangeCheck, drawsCheck(2)) }),
  ]),
  random('RandomElement', [form([p('list', 'List'), SEED], '@list', runRandomElement, 'one element of the list')]),
  random('RandomPolynomial', [form([p('degree', N), p('lo', N), p('hi', N), SEED], 'Function<Number>', runRandomPolynomial, 'a polynomial with whole coefficients from lo to hi')]),
  { name: 'Reroll', kind: 'action', group: 'random', forms: [{ params: [], rest: p('objs', 'Any'), returns: null, rule: rerollRule, summary: 'new random numbers for the objects' }] },
];

/* ------------------------------ registration ------------------------------ */

const FIELD_TYPES: Readonly<Record<string, Ty>> = {
  mean: T.Number, variance: T.Number, sd: T.Number, median: T.Number, name: T.Text, discrete: T.Bool, params: listOf(T.Number),
};

const NOTICES: Readonly<Record<string, { code: string; severity: 'info' | 'warning'; template: string }>> = {
  probs_normalised: { code: 'P101', severity: 'info', template: 'The probabilities summed to {sum}; they were scaled to sum to 1.' },
  probs_not_normalised: { code: 'P102', severity: 'warning', template: 'The probabilities summed to {sum}, not 1; they were scaled to sum to 1.' },
  rounding_discrete_quantile: { code: 'P103', severity: 'info', template: '{kind} is discrete: P(X {op} {x}) = {reached}, the nearest it gets to {q}.' },
  heavy_tail_plot: { code: 'P104', severity: 'info', template: '{kind} has heavy tails; the window shows the central 98 %.' },
};

let registered = false;

/** Registers the area. Idempotent. */
export function registerProbability(registry: CommandRegistry): void {
  registry.registerAll(CONSTRUCTORS);
  registry.registerAll(EVALUATE);
  registry.registerAll(RANDOM);
  if (registered) return;
  registered = true;
  registerTypeAlias(D, [CD, DD]);
  registerRecordSchema('CentralInterval', [
    { name: 'lo', ty: T.Number },
    { name: 'hi', ty: T.Number },
    { name: 'mass', ty: T.Number },
  ]);
  registerRecordSchema('Support', [
    { name: 'lo', ty: T.Number },
    { name: 'hi', ty: T.Number },
    { name: 'discrete', ty: T.Bool },
  ]);
  registerRecordSchema('PlotRange', [
    { name: 'lo', ty: T.Number },
    { name: 'hi', ty: T.Number },
    { name: 'ymax', ty: T.Number },
  ]);
  for (const type of [CD, DD]) {
    registerFieldTyper(type, (field) => FIELD_TYPES[field]);
    registerFieldNames(type, () => Object.keys(FIELD_TYPES));
    registerFieldReader(type, (field, value) => {
      if (!isDist(value)) return undefined;
      const m = value.spec.moments(value.params);
      switch (field) {
        case 'mean': return m.mean;
        case 'variance': return m.variance;
        case 'sd': return m.variance === undefined ? undefined : Math.sqrt(m.variance);
        case 'median': return momentOf(value, 'median');
        case 'name': return value.spec.kind;
        case 'discrete': return value.spec.discrete;
        case 'params': return Float64Array.from(value.params);
        default: return undefined;
      }
    });
  }
  // a Region from Shade carries its probability (design 4.3)
  FIELDS['Region'] = { ...(FIELDS['Region'] ?? {}), mass: T.Number };
  registerFieldReader('Region', (field, value) => (field === 'mass' ? (value as { mass?: number }).mass ?? (value as { area?: number }).area : undefined));
  // the re-roll count of a random object (design 6.3): a style property, saved as `with reroll = k`
  if (!Object.hasOwn(PROPERTIES, 'reroll')) PROPERTIES['reroll'] = { kind: 'int', min: 0, allowed: 'a whole number from 0' };
  registerPropertyTypes('reroll', '*');
  registerValueText((v) => (isDist(v) ? distText(v) : undefined));
  registerValueText((v) => {
    const c = (v as { randomPoly?: readonly number[] } | null)?.randomPoly;
    return Array.isArray(c) ? polyText(c) : undefined;
  });
  for (const [kind, s] of Object.entries(NOTICES)) registerNotice(kind, s);
  registerReasonPhrase('undefined_moment', { noun: 'no such moment', sentence: 'This distribution has no such moment with these parameters.' });
  registerReasonPhrase('not_continuous', { noun: 'not continuous', sentence: 'This needs a continuous distribution.' });
  registerReasonPhrase('sample_too_large', { noun: 'sample too large', sentence: 'Without replacement a sample cannot be longer than the list.' });
  registerReasonPhrase('zero_probability', { noun: 'probability zero', sentence: 'With probability 0 this can never happen.' });
  registerReasonPhrase('not_accurate', { noun: 'not accurate', sentence: 'These parameters are outside the range where the answer is accurate.' });
}

export const PROBABILITY_TYPES: readonly string[] = [CD, DD];
export { DISTRIBUTIONS, discreteSpec, dist, distText, distType, isDist } from './dists';
export type { DistSpec, DistributionValue } from './dists';
export { keyOf, streamFor, mix32 } from './random';
