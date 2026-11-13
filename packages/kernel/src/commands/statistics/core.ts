/**
 * Shared pieces of the statistics area: argument helpers, the sort cache, compensated sums and moments, quantile methods
 * and ranks (docs/features/statistics/design.md 3.2, 3.3, 10.1, 10.2).
 */
import type { Pt } from '../../contracts/values';
import type { CommandRule, RuleCall } from '../../graph/registry';
import type { CommandForm, CommandSpec, ParamSpec, Refusal } from '../../language/table';
import { MAX_LIST, isPt, record } from '../lists/types';
import { QUANTILE_METHODS, TAILS, TAIL_ALIASES } from './types';
import type { QuantileMethod, Tail } from './types';

/* ------------------------------ spec helpers ------------------------------ */

export const p = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
/** An optional parameter, given by position or by name (`method = "linear"`). */
export const opt = (name: string, type: string, def?: number | boolean | string): ParamSpec =>
  def === undefined ? { name, type, optional: true } : { name, type, optional: true, default: def };

export type Run = (call: RuleCall) => unknown;

export function form(params: readonly ParamSpec[], returns: string, run: Run, summary: string, extra: Partial<CommandForm> = {}): CommandForm {
  const rule = (): CommandRule => ({ run });
  return { params, returns, rule, summary, ...extra };
}

export const spec = (group: string) => (name: string, forms: readonly CommandForm[]): CommandSpec => ({ name, kind: 'object', group, forms });

/* ------------------------------ check-time hooks ------------------------------ */

interface Facts {
  readonly args: readonly { readonly literal: unknown; readonly omitted: boolean }[];
}

/** A literal text option outside its set is `bad_option` (errors 2). Aliases are accepted and listed in the hint. */
export function enumCheck(i: number, param: string, allowed: readonly string[], aliases: Readonly<Record<string, string>> = {}, hint?: string) {
  return (c: Facts): Refusal | undefined => {
    const v = c.args[i]?.literal;
    if (typeof v !== 'string' || allowed.includes(v) || Object.hasOwn(aliases, v)) return undefined;
    const list = allowed.map((a) => `"${a}"`).join(', ');
    const signs = Object.keys(aliases);
    return {
      kind: 'bad_option',
      message: `${param} must be one of ${list}.`,
      param: i,
      hint: hint ?? (signs.length > 0 ? `The signs ${signs.map((s) => `"${s}"`).join(' ')} are also accepted.` : `Use one of ${list}.`),
      params: { command: param, why: `${param} must be one of ${list}, not "${v}"` },
    };
  };
}

/** A literal number that must be a whole number in a range is `bad_argument` (errors 2). */
export function wholeCheck(i: number, param: string, lo: number, hi: number, hint?: string) {
  return (c: Facts): Refusal | undefined => {
    const v = c.args[i]?.literal;
    if (typeof v !== 'number' || (Number.isInteger(v) && v >= lo && v <= hi)) return undefined;
    return {
      kind: 'bad_argument',
      message: `${param} must be a whole number from ${lo} to ${hi}.`,
      param: i,
      ...(hint ? { hint } : {}),
      params: { command: param, why: `${param} must be a whole number from ${lo} to ${hi}, not ${v}` },
    };
  };
}

/** A literal level must be strictly between 0 and 1. */
export function levelCheck(i: number) {
  return (c: Facts): Refusal | undefined => {
    const v = c.args[i]?.literal;
    if (typeof v !== 'number' || (v > 0 && v < 1)) return undefined;
    return { kind: 'bad_argument', message: 'The level must be between 0 and 1, such as 0.95.', param: i, params: { command: 'level', why: `the level must be between 0 and 1, not ${v}` } };
  };
}

/** Runs every hook and returns the first refusal. */
export const checks = (...hooks: ((c: Facts) => Refusal | undefined)[]) => (c: Facts): Refusal | undefined => {
  for (const h of hooks) {
    const r = h(c);
    if (r) return r;
  }
  return undefined;
};

/* ------------------------------ argument helpers ------------------------------ */

export const num = (call: RuleCall, i: number): number | undefined => {
  const v = call.values[i];
  return typeof v === 'number' && v === v ? v : undefined;
};

export const given = (call: RuleCall, i: number): boolean => call.args[i] !== undefined && !call.args[i]?.omitted;

export const text = (call: RuleCall, i: number, def: string): string => {
  const v = call.values[i];
  return typeof v === 'string' ? v : def;
};

export const bool = (call: RuleCall, i: number, def: boolean): boolean => {
  const v = call.values[i];
  return typeof v === 'boolean' ? v : def;
};

/** A list of numbers, checked for undefined elements (design 3.2). */
export function numbers(call: RuleCall, i: number, what = 'the list'): Float64Array | undefined {
  const v = call.values[i];
  let xs: Float64Array;
  if (v instanceof Float64Array) xs = v;
  else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) xs = Float64Array.from(v as number[]);
  else return call.fail('input_undefined', `${what} is undefined`);
  for (let k = 0; k < xs.length; k++) {
    const x = xs[k] as number;
    if (x !== x) return call.fail('has_undefined', `value ${k + 1} of ${what} is undefined; use RemoveUndefined`);
    if (!Number.isFinite(x)) return call.fail('not_finite', `value ${k + 1} of ${what} is ${x}`);
  }
  if (xs.length > MAX_LIST) return call.fail('too_large', `${what} has ${xs.length} values; at most ${MAX_LIST.toLocaleString('en')}`);
  return xs;
}

/** Same as `numbers`, and not empty. */
export function nonEmpty(call: RuleCall, i: number, what = 'the list'): Float64Array | undefined {
  const xs = numbers(call, i, what);
  if (xs === undefined) return undefined;
  if (xs.length === 0) return call.fail('empty_list', `${what} has no values`);
  return xs;
}

/** A list of points as two lists. */
export function pointLists(call: RuleCall, i: number, what = 'the points'): { xs: Float64Array; ys: Float64Array } | undefined {
  const v = call.values[i];
  if (!Array.isArray(v)) return call.fail('input_undefined', `${what} are undefined`);
  const n = v.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const q = v[k] as Pt;
    if (!isPt(q) || q.x !== q.x || q.y !== q.y) return call.fail('has_undefined', `point ${k + 1} is undefined; use RemoveUndefined`);
    xs[k] = q.x;
    ys[k] = q.y;
  }
  return { xs, ys };
}

/**
 * The data of a two-variable command: a list of points at `i`, or two lists of numbers at `i` and `i + 1`. Returns the
 * lists and the index of the first argument after the data.
 */
export function pairs(call: RuleCall, i: number, isPoints: boolean): { xs: Float64Array; ys: Float64Array; next: number } | undefined {
  if (isPoints) {
    const d = pointLists(call, i);
    return d ? { ...d, next: i + 1 } : undefined;
  }
  const xs = numbers(call, i, 'xs');
  if (!xs) return undefined;
  const ys = numbers(call, i + 1, 'ys');
  if (!ys) return undefined;
  if (xs.length !== ys.length) return call.fail('size_mismatch', `xs has ${xs.length} values, ys has ${ys.length}`);
  return { xs, ys, next: i + 2 };
}

/** Frequencies: non-negative whole numbers of the data's length (design 3.2). */
export function freqs(call: RuleCall, i: number, n: number): Float64Array | undefined {
  const fs = numbers(call, i, 'the frequencies');
  if (!fs) return undefined;
  if (fs.length !== n) return call.fail('size_mismatch', `the data has ${n} values, the frequencies ${fs.length}`);
  let total = 0;
  for (let k = 0; k < fs.length; k++) {
    const f = fs[k] as number;
    if (f < 0 || !Number.isInteger(f)) return call.fail('bad_weights', `frequency ${k + 1} is ${f}; frequencies are whole numbers from 0`);
    total += f;
  }
  if (total > 2 ** 53) return call.fail('bad_weights', 'the frequencies add up to more than 2^53');
  return fs;
}

/** The tail word, with its signs (design 3.3). */
export function tailOf(call: RuleCall, i: number): Tail | undefined {
  const v = text(call, i, 'two');
  if ((TAILS as readonly string[]).includes(v)) return v as Tail;
  const a = TAIL_ALIASES[v];
  if (a) return a;
  return call.fail('bad_argument', `the tail must be "two", "left" or "right", not "${v}"`);
}

export function methodOf(call: RuleCall, i: number, def: QuantileMethod): QuantileMethod | undefined {
  const v = text(call, i, def);
  if ((QUANTILE_METHODS as readonly string[]).includes(v)) return v as QuantileMethod;
  return call.fail('bad_argument', `the method must be one of ${QUANTILE_METHODS.join(', ')}, not "${v}"`);
}

export function oneOf<T extends string>(call: RuleCall, i: number, def: T, allowed: readonly T[], what: string): T | undefined {
  const v = text(call, i, def);
  if ((allowed as readonly string[]).includes(v)) return v as T;
  return call.fail('bad_argument', `${what} must be one of ${allowed.join(', ')}, not "${v}"`);
}

export { record };

/* ------------------------------ sums and moments ------------------------------ */

/** Neumaier compensated sum of `xs[i] * (w ? w[i] : 1)`. */
export function sum(xs: ArrayLike<number>, w?: ArrayLike<number>): number {
  let s = 0;
  let c = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = w ? (xs[i] as number) * (w[i] as number) : (xs[i] as number);
    const t = s + x;
    if (Math.abs(s) >= Math.abs(x)) c += s - t + x;
    else c += x - t + s;
    s = t;
  }
  return s + c;
}

/** The count: the length, or the total of the frequencies. */
export const countOf = (xs: ArrayLike<number>, w?: ArrayLike<number>): number => (w ? sum(w) : xs.length);

export function mean(xs: ArrayLike<number>, w?: ArrayLike<number>): number {
  return sum(xs, w) / countOf(xs, w);
}

/**
 * Central sums `Σ (x - m)^k` for k = 2, 3, 4, by the corrected two-pass method (design 10.1): the second pass adds the
 * correction `(Σ (x - m))^2 / n` to the sum of squares.
 */
export function centralSums(xs: ArrayLike<number>, w?: ArrayLike<number>): { n: number; mean: number; s2: number; s3: number; s4: number } {
  const n = countOf(xs, w);
  const m = mean(xs, w);
  let c1 = 0;
  let s2 = 0;
  let c2 = 0;
  let s3 = 0;
  let s4 = 0;
  for (let i = 0; i < xs.length; i++) {
    const f = w ? (w[i] as number) : 1;
    if (f === 0) continue;
    const d = (xs[i] as number) - m;
    const d2 = d * d;
    c1 += f * d;
    // compensated sum of squares
    const term = f * d2;
    const t = s2 + term;
    if (s2 >= term) c2 += s2 - t + term;
    else c2 += term - t + s2;
    s2 = t;
    s3 += f * d2 * d;
    s4 += f * d2 * d2;
  }
  s2 = s2 + c2 - (c1 * c1) / n;
  return { n, mean: m + c1 / n, s2: Math.max(0, s2), s3, s4 };
}

/** Centred sum of products of deviations, two-pass. */
export function sxy(xs: ArrayLike<number>, ys: ArrayLike<number>): number {
  const mx = mean(xs);
  const my = mean(ys);
  let s = 0;
  let c = 0;
  let ex = 0;
  let ey = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    ex += dx;
    ey += dy;
    const term = dx * dy;
    const t = s + term;
    if (Math.abs(s) >= Math.abs(term)) c += s - t + term;
    else c += term - t + s;
    s = t;
  }
  return s + c - (ex * ey) / xs.length;
}

/* ------------------------------ sorting ------------------------------ */

const SORTED = new WeakMap<object, Float64Array>();

/** The ascending copy of a list, cached per list value so commands on the same list sort once (design 3.2). */
export function sorted(xs: Float64Array): Float64Array {
  let s = SORTED.get(xs);
  if (!s) {
    s = Float64Array.from(xs).sort();
    SORTED.set(xs, s);
  }
  return s;
}

/**
 * The data in order, as order statistics: `n` values in all (the frequency total), `at(k)` the k-th smallest (0-based).
 * With frequencies the data is never expanded: `at` searches the cumulative counts.
 */
export interface Ordered {
  readonly n: number;
  at(k: number): number;
}

export function ordered(xs: Float64Array, w?: Float64Array): Ordered {
  if (!w) {
    const s = sorted(xs);
    return { n: s.length, at: (k) => s[k] as number };
  }
  const idx = Array.from(xs.keys()).filter((i) => (w[i] as number) > 0);
  idx.sort((a, b) => (xs[a] as number) - (xs[b] as number));
  const vals = new Float64Array(idx.length);
  const cum = new Float64Array(idx.length);
  let c = 0;
  idx.forEach((i, k) => {
    vals[k] = xs[i] as number;
    c += w[i] as number;
    cum[k] = c;
  });
  return {
    n: c,
    at(k) {
      // first position whose cumulative count exceeds k
      let lo = 0;
      let hi = cum.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((cum[mid] as number) > k) hi = mid;
        else lo = mid + 1;
      }
      return vals[lo] as number;
    },
  };
}

/** The median of order statistics `lo .. lo + len - 1`. */
export function medianOf(o: Ordered, lo: number, len: number): number {
  if (len <= 0) return NaN;
  const h = lo + (len - 1) / 2;
  return len % 2 === 1 ? o.at(h) : (o.at(Math.floor(h)) + o.at(Math.ceil(h))) / 2;
}

export const median = (o: Ordered): number => medianOf(o, 0, o.n);

/** The first and third quartiles by the halves or hinges rule (design 3.3). */
function halves(o: Ordered, hinges: boolean): { q1: number; q3: number } {
  const n = o.n;
  if (n === 1) return { q1: o.at(0), q3: o.at(0) };
  const len = n % 2 === 1 && hinges ? (n + 1) / 2 : Math.floor(n / 2);
  return { q1: medianOf(o, 0, len), q3: medianOf(o, n - len, len) };
}

/** The p-quantile by a method (design 3.3). `p` is in [0, 1]. */
export function quantile(o: Ordered, p: number, method: QuantileMethod): number {
  const n = o.n;
  if (method === 'halves' || method === 'hinges') {
    // piecewise linear through min, q1, median, q3, max; exact at the quartiles
    const { q1, q3 } = halves(o, method === 'hinges');
    const knots = [o.at(0), q1, median(o), q3, o.at(n - 1)];
    const u = Math.min(3.999999999999, p * 4);
    const k = Math.floor(u);
    const a = knots[k] as number;
    const b = knots[k + 1] as number;
    return p === 1 ? (knots[4] as number) : a + (u - k) * (b - a);
  }
  if (method === 'nearest') {
    const k = Math.max(1, Math.ceil(p * n - 1e-12));
    return o.at(Math.min(n, k) - 1);
  }
  const h = method === 'linear' ? (n - 1) * p : Math.min(n - 1, Math.max(0, p * (n + 1) - 1));
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  const a = o.at(lo);
  return a + (h - lo) * (o.at(hi) - a);
}

export function quartiles(o: Ordered, method: QuantileMethod): { q1: number; q3: number } {
  if (method === 'halves' || method === 'hinges') return halves(o, method === 'hinges');
  return { q1: quantile(o, 0.25, method), q3: quantile(o, 0.75, method) };
}

/** All values with the highest count, ascending (design 4). */
export function modes(xs: Float64Array, w?: Float64Array): { values: Float64Array; repeated: boolean } {
  const idx = Array.from(xs.keys()).filter((i) => !w || (w[i] as number) > 0);
  idx.sort((a, b) => (xs[a] as number) - (xs[b] as number));
  const vals: number[] = [];
  const counts: number[] = [];
  for (const i of idx) {
    const x = xs[i] as number;
    const f = w ? (w[i] as number) : 1;
    if (vals.length > 0 && vals[vals.length - 1] === x) counts[counts.length - 1] = (counts[counts.length - 1] as number) + f;
    else {
      vals.push(x);
      counts.push(f);
    }
  }
  const top = Math.max(...counts);
  return { values: Float64Array.from(vals.filter((_, k) => counts[k] === top)), repeated: top > 1 };
}

/** Average ranks, ties by exact equality (design 10.2); or ordinal ranks, ties broken by position. */
export function ranks(xs: Float64Array, ordinal: boolean): { ranks: Float64Array; ties: number } {
  const n = xs.length;
  const idx = Array.from(xs.keys()).sort((a, b) => (xs[a] as number) - (xs[b] as number) || a - b);
  const r = new Float64Array(n);
  let ties = 0;
  for (let k = 0; k < n; ) {
    let j = k;
    while (j + 1 < n && xs[idx[j + 1] as number] === xs[idx[k] as number]) j++;
    if (j > k) ties += j - k + 1;
    for (let m = k; m <= j; m++) r[idx[m] as number] = ordinal ? m + 1 : (k + j) / 2 + 1;
    k = j + 1;
  }
  return { ranks: r, ties };
}

/** Pearson correlation, clamped to [-1, 1] (design 10.1); NaN when either list is constant. */
export function pearson(xs: Float64Array, ys: Float64Array): number {
  const sx = centralSums(xs).s2;
  const sy = centralSums(ys).s2;
  if (sx === 0 || sy === 0) return NaN;
  const r = sxy(xs, ys) / Math.sqrt(sx * sy);
  return Math.max(-1, Math.min(1, r));
}

/** True when every value is the same. */
export const constant = (xs: ArrayLike<number>): boolean => {
  for (let i = 1; i < xs.length; i++) if (xs[i] !== xs[0]) return false;
  return true;
};

/** A short number for summaries and equations. */
export function fmt(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e6 || a < 1e-4) return x.toExponential(digits - 1).replace(/\.?0+e/, 'e');
  return String(Number(x.toPrecision(digits)));
}
