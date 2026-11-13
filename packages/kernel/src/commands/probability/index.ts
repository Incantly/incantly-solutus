/**
 * Probability, first round: the `Distribution` type, its constructors, and evaluating, shading and describing a
 * distribution (docs/features/probability/design.md 3, 4.1, 4.3). Sampling, the calculator view and the rest of the
 * distributions follow in the probability round.
 *
 * Plug in with `registerProbability(registry)`.
 */
import type { CommandRegistry, CommandRule, RuleCall } from '../../graph/registry';
import { registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { registerValueText } from '../../language/runtime';
import type { FunctionValue } from '../../language/runtime';
import type { CommandForm, CommandSpec, ParamSpec, Refusal } from '../../language/table';
import { T, listOf } from '../../language/types';
import type { Ty } from '../../language/types';
import { registerReasonPhrase } from '../../errors/phrases';
import { record, registerRecordSchema } from '../lists/types';
import { DISTRIBUTIONS, dist, distText, isDist } from './dists';
import type { DistSpec, DistributionValue } from './dists';

declare module '../../contracts/values' {
  interface AreaUndefReasons {
    // probability
    undefined_moment: true;
    not_continuous: true;
  }
}

const D = 'Distribution';
const N = 'Number';
const p = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });

function form(params: readonly ParamSpec[], returns: string, run: (call: RuleCall) => unknown, summary: string, extra: Partial<CommandForm> = {}): CommandForm {
  const rule = (): CommandRule => ({ run });
  return { params, returns, rule, summary, ...extra };
}

const spec = (group: string) => (name: string, forms: readonly CommandForm[]): CommandSpec => ({ name, kind: 'object', group, forms });
const dists = spec('distributions');
const probs = spec('probability');

const num = (call: RuleCall, i: number): number | undefined => {
  const v = call.values[i];
  return typeof v === 'number' && v === v ? v : undefined;
};

function distArg(call: RuleCall, i: number): DistributionValue | undefined {
  const d = call.values[i];
  return isDist(d) ? d : call.fail('input_undefined', 'the distribution is undefined');
}

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

/** Literal parameters that break the domain are a check-time `bad_argument` (design 10.8). */
function literalCheck(s: DistSpec) {
  return (c: { args: readonly { literal: unknown }[] }): Refusal | undefined => {
    const vals = c.args.map((a) => a.literal);
    if (!vals.every((v) => typeof v === 'number')) return undefined;
    const ps = vals as number[];
    for (let i = 0; i < s.params.length; i++) {
      const d = s.params[i] as DistSpec['params'][number];
      if (!d.ok(ps[i] as number, ps)) {
        return { kind: 'bad_argument', message: `${s.kind} needs ${d.rule}, not ${d.name} = ${ps[i]}.`, param: i, params: { command: s.kind, why: `${s.kind} needs ${d.rule}` } };
      }
    }
    return undefined;
  };
}

const CONSTRUCTORS: readonly CommandSpec[] = DISTRIBUTIONS.map((s) =>
  dists(s.kind, [form(s.params.map((x) => p(x.name, N)), D, construct(s), `the ${s.kind} distribution`, { check: literalCheck(s) })]));

/* ------------------------------ evaluate ------------------------------ */

/** A function value of x with a batch evaluator; `lattice` marks a discrete mass for the plotter. */
export function fnOfDist(g: (x: number) => number, lattice: boolean): FunctionValue & { lattice: boolean } {
  const call1 = (x: number): number => {
    const v = g(x);
    return Number.isFinite(v) ? v : NaN;
  };
  return {
    arity: 1, ret: 'Number', call: (x: number) => call1(x), call1, lattice,
    batch(xs: Float64Array, out: Float64Array) {
      for (let i = 0; i < xs.length; i++) out[i] = call1(xs[i] as number);
    },
  };
}

const at = (f: (d: DistributionValue, x: number) => number) => (call: RuleCall): unknown => {
  const d = distArg(call, 0);
  const x = num(call, 1);
  if (!d) return undefined;
  if (x === undefined && !(typeof call.values[1] === 'number')) return call.fail('input_undefined', 'x is undefined');
  return f(d, call.values[1] as number);
};

const pdf = (d: DistributionValue, x: number): number => d.spec.pdf(d.params, x);
const cdf = (d: DistributionValue, x: number): number => d.spec.cdf(d.params, x);
const sf = (d: DistributionValue, x: number): number => d.spec.sf(d.params, x);

/** P(a ≤ X ≤ b), with the ends of a discrete interval as given. */
function prob(d: DistributionValue, a: number, b: number, ends: string): number {
  if (b < a) return 0;
  if (!d.spec.discrete) return Math.max(0, cdf(d, b) - cdf(d, a));
  const lo = ends[0] === '[' ? Math.ceil(a) : Math.floor(a) + 1;
  const hi = ends[1] === ']' ? Math.floor(b) : Math.ceil(b) - 1;
  if (hi < lo) return 0;
  return Math.max(0, cdf(d, hi) - cdf(d, lo - 1));
}

function runProb(call: RuleCall): unknown {
  const d = distArg(call, 0);
  const a = call.values[1];
  const b = call.values[2];
  const ends = typeof call.values[3] === 'string' ? call.values[3] : '[]';
  if (!d) return undefined;
  if (typeof a !== 'number' || typeof b !== 'number' || a !== a || b !== b) return call.fail('input_undefined', 'a bound is undefined');
  if (!['[]', '[)', '(]', '()'].includes(ends)) return call.fail('bad_argument', `ends must be "[]", "[)", "(]" or "()", not "${ends}"`);
  return prob(d, a, b, ends);
}

function runQuantile(call: RuleCall): unknown {
  const d = distArg(call, 0);
  const q = num(call, 1);
  const tail = typeof call.values[2] === 'string' ? call.values[2] : 'left';
  if (!d) return undefined;
  if (q === undefined || q < 0 || q > 1) return call.fail('out_of_domain', `q is ${String(q)}; it must be between 0 and 1`);
  const s = d.spec.support(d.params);
  const qq = tail === 'right' ? 1 - q : q;
  if (qq <= 0) return s.lo;
  if (qq >= 1) return s.hi;
  return d.spec.quantile(d.params, qq);
}

function moment(kind: 'mean' | 'variance' | 'sd') {
  return (call: RuleCall): unknown => {
    const d = distArg(call, 0);
    if (!d) return undefined;
    const m = d.spec.moments(d.params);
    const v = kind === 'mean' ? m.mean : m.variance;
    if (v === undefined) return call.fail('undefined_moment', `${d.spec.kind} with these parameters has no ${kind === 'mean' ? 'mean' : 'variance'}`);
    return kind === 'sd' ? Math.sqrt(v) : v;
  };
}

/** The area under a continuous density from a to b (design 4.3). */
function runShade(call: RuleCall): unknown {
  const d = distArg(call, 0);
  const a = call.values[1];
  const b = call.values[2];
  if (!d) return undefined;
  if (typeof a !== 'number' || typeof b !== 'number' || a !== a || b !== b) return call.fail('input_undefined', 'a bound is undefined');
  if (d.spec.discrete) return call.fail('not_continuous', `${d.spec.kind} is discrete; use BarChart(d)`);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const mass = prob(d, lo, hi, '[]');
  return { kind: 'region', shape: { t: 'under', a: lo, b: hi }, value: mass, area: mass, f: (x: number) => pdf(d, x), g: null };
}

function runCentral(call: RuleCall): unknown {
  const d = distArg(call, 0);
  const m = num(call, 1);
  if (!d) return undefined;
  if (m === undefined || !(m > 0 && m < 1)) return call.fail('out_of_domain', `the mass must be between 0 and 1, not ${String(m)}`);
  const t = (1 - m) / 2;
  return record('CentralInterval', { lo: d.spec.quantile(d.params, t), hi: d.spec.quantile(d.params, 1 - t), mass: m });
}

const TAILS = ['left', 'right'];
const tailCheck = (c: { args: readonly { literal: unknown }[] }): Refusal | undefined => {
  const v = c.args[2]?.literal;
  if (typeof v !== 'string' || TAILS.includes(v)) return undefined;
  return { kind: 'bad_option', message: 'tail must be one of "left", "right".', param: 2, params: { command: 'tail', why: `tail must be "left" or "right", not "${v}"` } };
};
const endsCheck = (c: { args: readonly { literal: unknown }[] }): Refusal | undefined => {
  const v = c.args[3]?.literal;
  if (typeof v !== 'string' || ['[]', '[)', '(]', '()'].includes(v)) return undefined;
  return { kind: 'bad_option', message: 'ends must be one of "[]", "[)", "(]", "()".', param: 3, params: { command: 'ends', why: `ends must be "[]", "[)", "(]" or "()", not "${v}"` } };
};

const EVALUATE: readonly CommandSpec[] = [
  probs('Pdf', [
    form([p('d', D), p('x', N)], N, at(pdf), 'the density (or the mass) at x'),
    form([p('d', D)], 'Function<Number>', (c) => { const d = distArg(c, 0); return d ? fnOfDist((x) => pdf(d, x), d.spec.discrete) : undefined; }, 'the density as a function'),
  ]),
  probs('Cdf', [
    form([p('d', D), p('x', N)], N, at(cdf), 'P(X ≤ x)'),
    form([p('d', D)], 'Function<Number>', (c) => { const d = distArg(c, 0); return d ? fnOfDist((x) => cdf(d, x), false) : undefined; }, 'the cumulative distribution as a function'),
    form([p('d', D), p('a', N), p('b', N)], N, (c) => runProb(c), 'P(a ≤ X ≤ b)'),
  ]),
  probs('Sf', [form([p('d', D), p('x', N)], N, at(sf), 'P(X > x), accurate in the upper tail')]),
  probs('Prob', [form([p('d', D), p('a', N), p('b', N), p('ends', 'Text', { optional: true, default: '[]' })], N, runProb, 'the probability of an interval', { check: endsCheck })]),
  probs('Quantile', [form([p('d', D), p('q', N), p('tail', 'Text', { optional: true, default: 'left' })], N, runQuantile, 'the smallest x with Cdf(d, x) ≥ q', { check: tailCheck })]),
  probs('Mean', [form([p('d', D)], N, moment('mean'), 'the mean of the distribution')]),
  probs('Variance', [form([p('d', D)], N, moment('variance'), 'the variance of the distribution')]),
  probs('StdDev', [form([p('d', D)], N, moment('sd'), 'the standard deviation of the distribution')]),
  probs('Shade', [form([p('d', D), p('a', N), p('b', N)], 'Region', runShade, 'the area under the density from a to b')]),
  probs('CentralInterval', [form([p('d', D), p('mass', N)], 'Record<CentralInterval>', runCentral, 'the interval with equal tails holding the mass')]),
];

/* ------------------------------ registration ------------------------------ */

const FIELDS: Readonly<Record<string, Ty>> = { mean: T.Number, variance: T.Number, sd: T.Number, name: T.Text, discrete: T.Bool, params: listOf(T.Number) };

let registered = false;

/** Registers the area. Idempotent. */
export function registerProbability(registry: CommandRegistry): void {
  registry.registerAll(CONSTRUCTORS);
  registry.registerAll(EVALUATE);
  if (registered) return;
  registered = true;
  registerRecordSchema('CentralInterval', [
    { name: 'lo', ty: T.Number },
    { name: 'hi', ty: T.Number },
    { name: 'mass', ty: T.Number },
  ]);
  registerFieldTyper('Distribution', (field) => FIELDS[field]);
  registerFieldNames('Distribution', () => Object.keys(FIELDS));
  registerFieldReader('Distribution', (field, value) => {
    if (!isDist(value)) return undefined;
    const m = value.spec.moments(value.params);
    switch (field) {
      case 'mean': return m.mean;
      case 'variance': return m.variance;
      case 'sd': return m.variance === undefined ? undefined : Math.sqrt(m.variance);
      case 'name': return value.spec.kind;
      case 'discrete': return value.spec.discrete;
      case 'params': return Float64Array.from(value.params);
      default: return undefined;
    }
  });
  registerValueText((v) => (isDist(v) ? distText(v) : undefined));
  registerReasonPhrase('undefined_moment', { noun: 'no such moment', sentence: 'This distribution has no mean or variance with these parameters.' });
  registerReasonPhrase('not_continuous', { noun: 'not continuous', sentence: 'This needs a continuous distribution.' });
}

export const PROBABILITY_TYPES: readonly string[] = ['Distribution'];
export { DISTRIBUTIONS, dist, distText, isDist } from './dists';
export type { DistSpec, DistributionValue } from './dists';
