/**
 * Describing one list and two lists, frequency, classes and tables (docs/features/statistics/design.md 4, 5).
 */
import type { RuleCall } from '../../graph/registry';
import type { FunctionValue } from '../../language/runtime';
import type { CommandSpec } from '../../language/table';
import { makeMatrix } from '../lists/types';
import type { MatrixValue } from '../lists/types';
import {
  centralSums, checks, constant, countOf, enumCheck, form, freqs, given, mean, median, methodOf, modes, nonEmpty, num, numbers,
  oneOf, opt, ordered, p, pairs, pearson, quantile, quartiles, ranks, record, sorted, spec, sum, sxy, wholeCheck,
} from './core';
import type { Ordered } from './core';
import { CLOSED, MAX_AUTO_CLASSES, MAX_BINS, MAX_TABLE_COLS, MAX_TABLE_ROWS, QUANTILE_METHODS, SCALES } from './types';
import type { QuantileMethod, Scale } from './types';

const L = 'List<Number>';
const P = 'List<Point>';
const FN = 'Function<Number>';
const stat = spec('stats');

/* ------------------------------ one list ------------------------------ */

/** The data and optional frequencies at `i`, `i + 1` (when the form has them). */
function data(call: RuleCall, i: number, withFreqs: boolean): { xs: Float64Array; w: Float64Array | undefined; n: number } | undefined {
  const xs = nonEmpty(call, i);
  if (!xs) return undefined;
  let w: Float64Array | undefined;
  if (withFreqs) {
    w = freqs(call, i + 1, xs.length);
    if (!w) return undefined;
    if (sum(w) === 0) return call.fail('empty_list', 'the frequencies are all 0');
  }
  return { xs, w, n: countOf(xs, w) };
}

type OneRun = (d: { xs: Float64Array; w: Float64Array | undefined; n: number }, call: RuleCall) => unknown;

/** A command over one list, with a frequency form when `freq` is true. */
function one(name: string, summary: string, run: OneRun, freq: boolean, returns = 'Number'): CommandSpec {
  const forms = [form([p('list', L)], returns, (c) => { const d = data(c, 0, false); return d ? run(d, c) : undefined; }, summary)];
  if (freq) forms.push(form([p('list', L), p('freqs', L)], returns, (c) => { const d = data(c, 0, true); return d ? run(d, c) : undefined; }, `${summary}, with frequencies`));
  return stat(name, forms);
}

const variance = (sample: boolean) => (d: { xs: Float64Array; w: Float64Array | undefined; n: number }, call: RuleCall): number | undefined => {
  if (sample && d.n < 2) return call.fail('too_few_values', `the sample variance needs 2 values, got ${d.n}`);
  return centralSums(d.xs, d.w).s2 / (sample ? d.n - 1 : d.n);
};

const methodCheck = (i: number) => enumCheck(i, 'method', QUANTILE_METHODS);

/** Quartile commands: (list[, method]) and (list, freqs[, method]). */
function quartileSpec(name: string, summary: string, pick: (q: { q1: number; q3: number }) => number): CommandSpec {
  const run = (withFreqs: boolean) => (call: RuleCall): unknown => {
    const d = data(call, 0, withFreqs);
    const m = methodOf(call, withFreqs ? 2 : 1, 'halves');
    if (!d || !m) return undefined;
    return pick(quartiles(ordered(d.xs, d.w), m));
  };
  return stat(name, [
    form([p('list', L), opt('method', 'Text', 'halves')], 'Number', run(false), summary, { check: methodCheck(1) }),
    form([p('list', L), p('freqs', L), opt('method', 'Text', 'halves')], 'Number', run(true), `${summary}, with frequencies`, { check: methodCheck(2) }),
  ]);
}

function pCheck(i: number) {
  return (c: { args: readonly { literal: unknown }[] }) => {
    const v = c.args[i]?.literal;
    const bad = (x: unknown): boolean => typeof x === 'number' && !(x >= 0 && x <= 1);
    if (bad(v) || (Array.isArray(v) && v.some(bad))) return { kind: 'bad_argument', message: 'p must be between 0 and 1.', param: i, params: { command: 'Quantile', why: 'p must be between 0 and 1' } };
    return undefined;
  };
}

function runQuantile(withFreqs: boolean, many: boolean) {
  return (call: RuleCall): unknown => {
    const d = data(call, 0, withFreqs);
    const m = methodOf(call, withFreqs ? 3 : 2, 'linear');
    if (!d || !m) return undefined;
    const o = ordered(d.xs, d.w);
    const ps = many ? numbers(call, 1, 'p') : Float64Array.of(num(call, 1) ?? NaN);
    if (!ps) return undefined;
    const out = new Float64Array(ps.length);
    for (let k = 0; k < ps.length; k++) {
      const q = ps[k] as number;
      if (!(q >= 0 && q <= 1)) return call.fail('out_of_domain', `p is ${q}; it must be between 0 and 1`);
      out[k] = quantile(o, q, m);
    }
    return many ? out : out[0];
  };
}

function fiveNumber(o: Ordered, method: QuantileMethod): Record<string, unknown> {
  const { q1, q3 } = quartiles(o, method);
  return { min: o.at(0), q1, median: median(o), q3, max: o.at(o.n - 1), method };
}

function describeOne(xs: Float64Array, w: Float64Array | undefined, method: QuantileMethod): ReturnType<typeof record> {
  const o = ordered(xs, w);
  const cs = centralSums(xs, w);
  const n = cs.n;
  const { q1, q3 } = quartiles(o, method);
  const v = cs.s2 / n;
  const reasons: Record<string, string> = {};
  const sampleVariance = n >= 2 ? cs.s2 / (n - 1) : undefined;
  if (sampleVariance === undefined) {
    reasons['sampleVariance'] = 'too_few_values';
    reasons['sampleSd'] = 'too_few_values';
  }
  const skew = v > 0 ? cs.s3 / n / v ** 1.5 : undefined;
  const kurt = v > 0 ? cs.s4 / n / (v * v) : undefined;
  if (skew === undefined) {
    reasons['skewness'] = 'zero_variance';
    reasons['kurtosis'] = 'zero_variance';
  }
  const lo = o.at(0);
  const hi = o.at(n - 1);
  let sumSq = 0;
  for (let i = 0; i < xs.length; i++) sumSq += (w ? (w[i] as number) : 1) * (xs[i] as number) ** 2;
  return record('Describe', {
    n, sum: sum(xs, w), mean: cs.mean, median: median(o), mode: modes(xs, w).values, min: lo, max: hi, range: hi - lo, q1, q3, iqr: q3 - q1,
    variance: v, sd: Math.sqrt(v), sampleVariance, sampleSd: sampleVariance === undefined ? undefined : Math.sqrt(sampleVariance),
    sumSq, sxx: cs.s2, skewness: skew, kurtosis: kurt, method,
  }, reasons);
}

function runDescribe(withFreqs: boolean) {
  return (call: RuleCall): unknown => {
    const d = data(call, 0, withFreqs);
    const m = methodOf(call, withFreqs ? 2 : 1, 'halves');
    if (!d || !m) return undefined;
    return describeOne(d.xs, d.w, m);
  };
}

function runDescribePoints(call: RuleCall): unknown {
  const d = pairs(call, 0, true);
  if (!d) return undefined;
  const n = d.xs.length;
  if (n === 0) return call.fail('empty_list', 'the points have no values');
  const cxy = sxy(d.xs, d.ys);
  const r = pearson(d.xs, d.ys);
  const rs = pearson(ranks(d.xs, false).ranks, ranks(d.ys, false).ranks);
  const reasons: Record<string, string> = {};
  if (r !== r) {
    reasons['r'] = 'zero_variance';
    reasons['r2'] = 'zero_variance';
    reasons['spearman'] = 'zero_variance';
  }
  if (n < 2) reasons['sampleCov'] = 'too_few_values';
  return record('Describe2', {
    x: describeOne(d.xs, undefined, 'halves'), y: describeOne(d.ys, undefined, 'halves'),
    r: r === r ? r : undefined, r2: r === r ? r * r : undefined, cov: cxy / n, sampleCov: n >= 2 ? cxy / (n - 1) : undefined,
    sxy: cxy, spearman: rs === rs ? rs : undefined, n,
  }, reasons);
}

function runOutliers(call: RuleCall): unknown {
  const xs = nonEmpty(call, 0);
  if (!xs) return undefined;
  const k = given(call, 1) ? num(call, 1) : 1.5;
  if (k === undefined || k < 0) return call.fail('bad_parameter', `k must be 0 or more, not ${String(k)}`);
  const { q1, q3 } = quartiles(ordered(xs), 'halves');
  const lo = q1 - k * (q3 - q1);
  const hi = q3 + k * (q3 - q1);
  return Float64Array.from(sorted(xs).filter((x) => x < lo || x > hi));
}

function runMeanAbsDev(call: RuleCall): unknown {
  const xs = nonEmpty(call, 0);
  if (!xs) return undefined;
  const m = mean(xs);
  return sum(xs.map((x) => Math.abs(x - m))) / xs.length;
}

function runMedianAbsDev(call: RuleCall): unknown {
  const xs = nonEmpty(call, 0);
  if (!xs) return undefined;
  const m = median(ordered(xs));
  const dev = xs.map((x) => Math.abs(x - m));
  return median(ordered(dev));
}

function runGeometric(call: RuleCall): unknown {
  const xs = nonEmpty(call, 0);
  if (!xs) return undefined;
  const bad = xs.findIndex((x) => x <= 0);
  if (bad >= 0) return call.fail('out_of_domain', `value ${bad + 1} is ${xs[bad]}; the geometric mean needs positive values`);
  return Math.exp(sum(xs.map(Math.log)) / xs.length);
}

function runHarmonic(call: RuleCall): unknown {
  const xs = nonEmpty(call, 0);
  if (!xs) return undefined;
  const zero = xs.findIndex((x) => x === 0);
  if (zero >= 0) return call.fail('out_of_domain', `value ${zero + 1} is 0; the harmonic mean needs non-zero values`);
  if (xs.some((x) => x > 0) && xs.some((x) => x < 0)) return call.fail('out_of_domain', 'the harmonic mean needs values of one sign');
  return xs.length / sum(xs.map((x) => 1 / x));
}

const moment = (k: 3 | 4) => (call: RuleCall): unknown => {
  const xs = nonEmpty(call, 0);
  if (!xs) return undefined;
  const cs = centralSums(xs);
  const v = cs.s2 / cs.n;
  if (v === 0) return call.fail('zero_variance', `all values are ${xs[0]}`);
  return k === 3 ? cs.s3 / cs.n / v ** 1.5 : cs.s4 / cs.n / (v * v);
};

function runZScores(call: RuleCall): unknown {
  const xs = nonEmpty(call, 0);
  if (!xs) return undefined;
  const cs = centralSums(xs);
  const sd = Math.sqrt(cs.s2 / cs.n);
  if (sd === 0) return call.fail('zero_variance', `all values are ${xs[0]}`);
  return xs.map((x) => (x - cs.mean) / sd);
}

const runRank = (ordinal: boolean) => (call: RuleCall): unknown => {
  const xs = numbers(call, 0);
  return xs ? ranks(xs, ordinal).ranks : undefined;
};

function runRescale(call: RuleCall): unknown {
  const xs = nonEmpty(call, 0);
  const lo = num(call, 1);
  const hi = num(call, 2);
  if (!xs || lo === undefined || hi === undefined) return xs ? call.fail('input_undefined', 'a bound is undefined') : undefined;
  const s = sorted(xs);
  const a = s[0] as number;
  const b = s[s.length - 1] as number;
  if (a === b) return call.fail('zero_variance', `all values are ${a}`);
  return xs.map((x) => lo + ((x - a) / (b - a)) * (hi - lo));
}

/* ------------------------------ two lists ------------------------------ */

type PairRun = (xs: Float64Array, ys: Float64Array, call: RuleCall) => unknown;

/** A two-list command: (xs, ys) and (points). */
function two(name: string, summary: string, run: PairRun): CommandSpec {
  const wrap = (isPts: boolean) => (call: RuleCall): unknown => {
    const d = pairs(call, 0, isPts);
    if (!d) return undefined;
    if (d.xs.length === 0) return call.fail('empty_list', 'there are no values');
    return run(d.xs, d.ys, call);
  };
  return stat(name, [form([p('xs', L), p('ys', L)], 'Number', wrap(false), summary), form([p('points', P)], 'Number', wrap(true), summary)]);
}

const cov = (sample: boolean): PairRun => (xs, ys, call) => {
  if (sample && xs.length < 2) return call.fail('too_few_values', `the sample covariance needs 2 values, got ${xs.length}`);
  return sxy(xs, ys) / (sample ? xs.length - 1 : xs.length);
};

const correlation: PairRun = (xs, ys, call) => {
  if (xs.length < 2) return call.fail('too_few_values', `the correlation needs 2 values, got ${xs.length}`);
  if (constant(xs)) return call.fail('zero_variance', `all x values are ${xs[0]}`);
  if (constant(ys)) return call.fail('zero_variance', `all y values are ${ys[0]}`);
  return pearson(xs, ys);
};

const spearman: PairRun = (xs, ys, call) => {
  const rx = ranks(xs, false);
  const ry = ranks(ys, false);
  const r = correlation(rx.ranks, ry.ranks, call);
  if (typeof r === 'number' && rx.ties + ry.ties > xs.length / 5) call.notify('ties_in_data', { ties: rx.ties + ry.ties });
  return r;
};

/** Evaluates a function of one number; NaN when undefined. */
export function at(f: FunctionValue, x: number): number {
  const v = f.call1 ? f.call1(x) : f.call(x);
  return typeof v === 'number' ? v : NaN;
}

/** Residuals `y - f(x)`, or the reason. */
export function residualsOf(call: RuleCall, xs: Float64Array, ys: Float64Array, f: FunctionValue): Float64Array | undefined {
  const out = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const v = at(f, xs[i] as number);
    if (v !== v) return call.fail('has_undefined', `f is undefined at x = ${xs[i]} (point ${i + 1})`);
    out[i] = (ys[i] as number) - v;
  }
  return out;
}

function withF(name: string, summary: string, returns: string, run: (xs: Float64Array, ys: Float64Array, res: Float64Array, call: RuleCall) => unknown): CommandSpec {
  const wrap = (isPts: boolean) => (call: RuleCall): unknown => {
    const d = pairs(call, 0, isPts);
    if (!d) return undefined;
    if (d.xs.length === 0) return call.fail('empty_list', 'there are no points');
    const f = call.values[d.next] as FunctionValue | undefined;
    if (!f) return call.fail('input_undefined', 'the function is undefined');
    const res = residualsOf(call, d.xs, d.ys, f);
    return res ? run(d.xs, d.ys, res, call) : undefined;
  };
  return stat(name, [
    form([p('points', P), p('f', FN)], returns, wrap(true), summary),
    form([p('xs', L), p('ys', L), p('f', FN)], returns, wrap(false), summary),
  ]);
}

/* ------------------------------ classes and frequency ------------------------------ */

/** A width rounded up to 1, 2 or 5 times a power of ten. */
function niceWidth(w: number): number {
  const e = Math.floor(Math.log10(w));
  const base = 10 ** e;
  for (const m of [1, 2, 5, 10]) if (m * base >= w * (1 - 1e-12)) return m * base;
  return 10 * base;
}

/** Edges at `start + i * width` covering `lo .. hi`. */
function edgesByWidth(lo: number, hi: number, width: number, start: number): Float64Array {
  const out: number[] = [];
  let k = 0;
  for (;;) {
    const e = start + k * width;
    out.push(Math.abs(e) < width * 1e-12 ? 0 : Number(e.toPrecision(15)));
    if (e > hi || (k > 0 && e >= hi && hi > lo)) break;
    k++;
  }
  if (out.length < 2) out.push(start + width);
  return Float64Array.from(out);
}

/** The automatic class rule (design 5); `constant` when every value is the same. */
export function autoEdges(xs: Float64Array): { edges: Float64Array; constant: boolean } {
  const s = sorted(xs);
  const lo = s[0] as number;
  const hi = s[s.length - 1] as number;
  if (lo === hi) return { edges: Float64Array.of(lo - 0.5, lo + 0.5), constant: true };
  if (hi - lo <= 30 && xs.every(Number.isInteger)) {
    const out = new Float64Array(hi - lo + 2);
    for (let k = 0; k < out.length; k++) out[k] = lo - 0.5 + k;
    return { edges: out, constant: false };
  }
  const n = xs.length;
  const { q1, q3 } = quartiles(ordered(xs), 'halves');
  let w = q3 > q1 ? 2 * (q3 - q1) * n ** (-1 / 3) : (hi - lo) / (Math.ceil(Math.log2(n)) + 1);
  w = niceWidth(w);
  while ((hi - lo) / w > MAX_AUTO_CLASSES) w = niceWidth(w * 1.0001);
  const start = Math.floor(lo / w + 1e-12) * w;
  return { edges: edgesByWidth(lo, hi, w, start), constant: false };
}

/** Edges strictly increasing, or the reason. */
export function checkEdges(call: RuleCall, edges: Float64Array): boolean {
  if (edges.length < 2) {
    call.fail('bad_edges', 'edges need at least 2 values');
    return false;
  }
  for (let k = 1; k < edges.length; k++) {
    if (!((edges[k] as number) > (edges[k - 1] as number))) {
      call.fail('bad_edges', `edges ${edges[k - 1]} and ${edges[k]} are out of order`);
      return false;
    }
  }
  return true;
}

/** Counts per class; classes are `[a, b)` with the last closed (or `(a, b]` with the first closed). */
export function countClasses(edges: Float64Array, xs: Float64Array, closed: 'left' | 'right', w?: Float64Array): { counts: Float64Array; outside: number } {
  const m = edges.length - 1;
  const counts = new Float64Array(m);
  let outside = 0;
  const first = edges[0] as number;
  const last = edges[m] as number;
  // equal widths: the class is found by division, then nudged across an edge it rounded past
  const width = (last - first) / m;
  let uniform = width > 0;
  for (let k = 1; uniform && k < m; k++) if (Math.abs((edges[k] as number) - (first + k * width)) > 1e-12 * Math.max(1, Math.abs(edges[k] as number))) uniform = false;
  if (uniform && !w) {
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i] as number;
      if (x < first || x > last) {
        outside++;
        continue;
      }
      let k = Math.floor((x - first) / width);
      if (k >= m) k = m - 1;
      if (k < 0) k = 0;
      if (closed === 'left') {
        if (k + 1 < m && x >= (edges[k + 1] as number)) k++;
        else if (k > 0 && x < (edges[k] as number)) k--;
      } else {
        if (k > 0 && x <= (edges[k] as number)) k--;
        else if (k + 1 < m && x > (edges[k + 1] as number)) k++;
      }
      counts[k] = (counts[k] as number) + 1;
    }
    return { counts, outside };
  }
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] as number;
    const f = w ? (w[i] as number) : 1;
    if (x < first || x > last) {
      outside += f;
      continue;
    }
    // binary search for the class
    let lo = 0;
    let hi = m - 1;
    if (closed === 'left') {
      // last class whose lower edge <= x
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((edges[mid] as number) <= x) lo = mid;
        else hi = mid - 1;
      }
    } else {
      // first class whose upper edge >= x
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((edges[mid + 1] as number) >= x) hi = mid;
        else lo = mid + 1;
      }
    }
    counts[lo] = (counts[lo] as number) + f;
  }
  return { counts, outside };
}

/** Heights for a scale. */
export function scaled(counts: Float64Array, edges: Float64Array, scale: Scale, total: number): Float64Array {
  return counts.map((c, k) => {
    if (scale === 'count') return c;
    if (scale === 'relative') return total > 0 ? c / total : 0;
    return total > 0 ? c / total / ((edges[k + 1] as number) - (edges[k] as number)) : 0;
  });
}

function runClasses(call: RuleCall): unknown {
  const xs = nonEmpty(call, 0);
  if (!xs) return undefined;
  if (!given(call, 1)) {
    const a = autoEdges(xs);
    if (a.constant) call.notify('all_equal_values', { value: xs[0] as number });
    return a.edges;
  }
  const bins = num(call, 1);
  if (bins === undefined || !Number.isInteger(bins) || bins < 1 || bins > MAX_BINS) return call.fail('bad_parameter', `bins must be a whole number from 1 to ${MAX_BINS}, not ${String(bins)}`);
  const s = sorted(xs);
  let lo = s[0] as number;
  let hi = s[s.length - 1] as number;
  if (lo === hi) {
    call.notify('all_equal_values', { value: lo });
    lo -= 0.5;
    hi += 0.5;
  }
  const out = new Float64Array(bins + 1);
  for (let k = 0; k <= bins; k++) out[k] = lo + ((hi - lo) * k) / bins;
  out[bins] = hi;
  return out;
}

function runClassesByWidth(call: RuleCall): unknown {
  const xs = nonEmpty(call, 0);
  const w = num(call, 1);
  if (!xs) return undefined;
  if (w === undefined || !(w > 0)) return call.fail('bad_parameter', `the width must be positive, not ${String(w)}`);
  const s = sorted(xs);
  const lo = s[0] as number;
  const hi = s[s.length - 1] as number;
  const start = given(call, 2) ? num(call, 2) : Math.floor(lo / w + 1e-12) * w;
  if (start === undefined) return call.fail('input_undefined', 'the start is undefined');
  if (start > lo) return call.fail('bad_parameter', `the start ${start} is above the smallest value ${lo}`);
  if ((hi - start) / w > MAX_BINS) return call.fail('too_large', `that width makes more than ${MAX_BINS} classes`);
  return edgesByWidth(lo, hi, w, start);
}

function runFrequency(call: RuleCall): unknown {
  const edges = numbers(call, 0, 'the edges');
  const xs = numbers(call, 1);
  const closed = oneOf(call, 2, 'left', CLOSED, 'closed');
  const scale = oneOf(call, 3, 'count', SCALES, 'scale');
  if (!edges || !xs || !closed || !scale || !checkEdges(call, edges)) return undefined;
  const { counts, outside } = countClasses(edges, xs, closed);
  let h = scaled(counts, edges, scale, xs.length - outside);
  if (call.values[4] === true) {
    let c = 0;
    h = h.map((v, k) => (c += scale === 'density' ? v * ((edges[k + 1] as number) - (edges[k] as number)) : v));
  }
  return h;
}

/* ------------------------------ tables ------------------------------ */

export function table(titles: readonly string[], columns: readonly unknown[], caption = ''): ReturnType<typeof record> {
  const first = columns[0];
  const rows = first instanceof Float64Array || Array.isArray(first) ? (first as ArrayLike<unknown>).length : 0;
  return record('Table', { rows, cols: columns.length, titles: titles.slice(), columns: columns.slice(), caption });
}

/** `[a, b)` with the last class `[a, b]`; or `(a, b]` with the first class `[a, b]`. */
function classLabel(a: number, b: number, closed: 'left' | 'right', end: boolean): string {
  const l = closed === 'left' || end ? '[' : '(';
  const r = closed === 'right' || end ? ']' : ')';
  return `${l}${a}, ${b}${r}`;
}

function runFrequencyTable(call: RuleCall): unknown {
  const edges = numbers(call, 0, 'the edges');
  const xs = numbers(call, 1);
  const closed = oneOf(call, 2, 'left', CLOSED, 'closed');
  if (!edges || !xs || !closed || !checkEdges(call, edges)) return undefined;
  const { counts } = countClasses(edges, xs, closed);
  const m = counts.length;
  const labels = Array.from({ length: m }, (_, k) => classLabel(edges[k] as number, edges[k + 1] as number, closed, closed === 'left' ? k === m - 1 : k === 0));
  return freqTable(labels, counts, 'class');
}

function freqTable(labels: readonly unknown[], counts: Float64Array, first: string): unknown {
  const total = sum(counts);
  let c = 0;
  const cum = counts.map((v) => (c += v));
  return table([first, 'count', 'relative', 'cumulative', 'cumulative relative'], [
    labels.slice(), counts, counts.map((v) => (total > 0 ? v / total : 0)), cum, cum.map((v) => (total > 0 ? v / total : 0)),
  ]);
}

function runFrequencyTableValues(call: RuleCall): unknown {
  const xs = nonEmpty(call, 0);
  if (!xs) return undefined;
  const s = sorted(xs);
  const vals: number[] = [];
  const counts: number[] = [];
  for (const x of s) {
    if (vals.length > 0 && vals[vals.length - 1] === x) counts[counts.length - 1] = (counts[counts.length - 1] as number) + 1;
    else {
      vals.push(x);
      counts.push(1);
    }
  }
  return freqTable(Float64Array.from(vals) as unknown as unknown[], Float64Array.from(counts), 'value');
}

const key = (v: unknown): string => (typeof v === 'number' ? `n${v}` : `t${String(v)}`);

function distinct(items: readonly unknown[]): unknown[] {
  const seen = new Map<string, unknown>();
  for (const v of items) if (!seen.has(key(v))) seen.set(key(v), v);
  return [...seen.values()].sort((a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
}

const itemsOf = (v: unknown): unknown[] | undefined => (v instanceof Float64Array ? Array.from(v) : Array.isArray(v) ? (v as unknown[]) : undefined);

function contingency(observed: MatrixValue, rowLabels: readonly unknown[], colLabels: readonly unknown[]): unknown {
  const R = observed.rows;
  const C = observed.cols;
  const cols: unknown[] = [[...rowLabels.map(String), 'total']];
  const titles = ['', ...colLabels.map(String), 'total'];
  const rowTot = new Float64Array(R + 1);
  for (let j = 0; j < C; j++) {
    const col = new Float64Array(R + 1);
    for (let i = 0; i < R; i++) {
      const v = observed.data[i * C + j] as number;
      col[i] = v;
      col[R] = (col[R] as number) + v;
      rowTot[i] = (rowTot[i] as number) + v;
    }
    rowTot[R] = (rowTot[R] as number) + (col[R] as number);
    cols.push(col);
  }
  cols.push(rowTot);
  return record('Contingency', { observed, rowLabels: rowLabels.slice(), colLabels: colLabels.slice(), table: table(titles, cols) });
}

function runContingency(call: RuleCall): unknown {
  const a = itemsOf(call.values[0]);
  const b = itemsOf(call.values[1]);
  if (!a || !b) return call.fail('input_undefined', 'a list is undefined');
  if (a.length !== b.length) return call.fail('size_mismatch', `the first list has ${a.length} values, the second ${b.length}`);
  if (a.length === 0) return call.fail('empty_list', 'the lists have no values');
  const ra = distinct(a);
  const cb = distinct(b);
  const ri = new Map(ra.map((v, i) => [key(v), i]));
  const ci = new Map(cb.map((v, i) => [key(v), i]));
  const data = new Float64Array(ra.length * cb.length);
  for (let k = 0; k < a.length; k++) {
    const i = ri.get(key(a[k])) as number;
    const j = ci.get(key(b[k])) as number;
    data[i * cb.length + j] = (data[i * cb.length + j] as number) + 1;
  }
  return contingency(makeMatrix(ra.length, cb.length, data), ra, cb);
}

function runContingencyCounts(call: RuleCall): unknown {
  const m = call.values[0] as MatrixValue | undefined;
  const rl = itemsOf(call.values[1]);
  const cl = itemsOf(call.values[2]);
  if (!m || !rl || !cl) return call.fail('input_undefined', 'an argument is undefined');
  if (rl.length !== m.rows || cl.length !== m.cols) return call.fail('size_mismatch', `the matrix is ${m.rows}×${m.cols}, with ${rl.length} row labels and ${cl.length} column labels`);
  for (let k = 0; k < m.data.length; k++) {
    const v = m.data[k] as number;
    if (!(v >= 0)) return call.fail('bad_parameter', `count ${k + 1} is ${v}; counts are 0 or more`);
  }
  return contingency(m, rl, cl);
}

function runTable(call: RuleCall): unknown {
  const titles = itemsOf(call.values[0]);
  if (!titles) return call.fail('input_undefined', 'the titles are undefined');
  const cols: unknown[] = [];
  for (let k = 1; k < call.values.length; k++) {
    const c = call.values[k];
    if (c === undefined) return call.fail('input_undefined', `column ${k} is undefined`);
    cols.push(c);
  }
  if (cols.length === 0) return call.fail('empty_list', 'a table needs a column');
  if (cols.length > MAX_TABLE_COLS) return call.fail('too_large', `a table has at most ${MAX_TABLE_COLS} columns`);
  if (titles.length !== cols.length) return call.fail('size_mismatch', `${titles.length} titles for ${cols.length} columns`);
  const len = (c: unknown): number => (itemsOf(c) ?? []).length;
  const n = len(cols[0]);
  const odd = cols.findIndex((c) => len(c) !== n);
  if (odd >= 0) return call.fail('size_mismatch', `column 1 has ${n} rows, column ${odd + 1} has ${len(cols[odd])}`);
  if (n > MAX_TABLE_ROWS) return call.fail('too_large', `a table has at most ${MAX_TABLE_ROWS} rows`);
  return table(titles.map(String), cols);
}

/* ------------------------------ the table ------------------------------ */

const noRepeat = (call: RuleCall, r: { values: Float64Array; repeated: boolean }): Float64Array => {
  if (!r.repeated) call.notify('no_repeated_value', {});
  return r.values;
};

export const DESCRIBE_COMMANDS: readonly CommandSpec[] = [
  stat('Count', [form([p('list', L), p('freqs', L)], 'Number', (c) => { const d = data(c, 0, true); return d?.n; }, 'the number of values, with frequencies')]),
  stat('Sum', [form([p('list', L), p('freqs', L)], 'Number', (c) => { const d = data(c, 0, true); return d ? sum(d.xs, d.w) : undefined; }, 'the total, with frequencies')]),
  one('Mean', 'the mean', (d) => mean(d.xs, d.w), true),
  one('Median', 'the median', (d) => median(ordered(d.xs, d.w)), true),
  one('Mode', 'the most frequent values, ascending', (d, c) => noRepeat(c, modes(d.xs, d.w)), true, 'List<Number>'),
  one('DataRange', 'the largest value minus the smallest', (d) => { const s = sorted(d.xs); return (s[s.length - 1] as number) - (s[0] as number); }, false),
  quartileSpec('Q1', 'the first quartile', (q) => q.q1),
  quartileSpec('Q3', 'the third quartile', (q) => q.q3),
  quartileSpec('IQR', 'the interquartile range', (q) => q.q3 - q.q1),
  stat('Quantile', [
    form([p('list', L), p('p', 'Number'), opt('method', 'Text', 'linear')], 'Number', runQuantile(false, false), 'the p-quantile', { check: checks(pCheck(1), methodCheck(2)) }),
    form([p('list', L), p('ps', L), opt('method', 'Text', 'linear')], 'List<Number>', runQuantile(false, true), 'the quantile at each p', { check: checks(pCheck(1), methodCheck(2)) }),
    form([p('list', L), p('p', 'Number'), p('freqs', L), opt('method', 'Text', 'linear')], 'Number', runQuantile(true, false), 'the p-quantile, with frequencies', { check: checks(pCheck(1), methodCheck(3)) }),
  ]),
  stat('FiveNumber', [form([p('list', L), opt('method', 'Text', 'halves')], 'Record<FiveNumber>', (c) => {
    const xs = nonEmpty(c, 0);
    const m = methodOf(c, 1, 'halves');
    return xs && m ? record('FiveNumber', fiveNumber(ordered(xs), m)) : undefined;
  }, 'min, q1, median, q3, max', { check: methodCheck(1) })]),
  stat('Outliers', [form([p('list', L), opt('k', 'Number', 1.5)], 'List<Number>', runOutliers, 'values more than k IQR outside the quartiles')]),
  one('Variance', 'the variance (divide by n)', variance(false), true),
  one('StdDev', 'the standard deviation (divide by n)', (d, c) => { const v = variance(false)(d, c); return v === undefined ? undefined : Math.sqrt(v); }, true),
  one('SampleVariance', 'the sample variance (divide by n - 1)', variance(true), true),
  one('SampleStdDev', 'the sample standard deviation (divide by n - 1)', (d, c) => { const v = variance(true)(d, c); return v === undefined ? undefined : Math.sqrt(v); }, true),
  stat('MeanAbsDev', [form([p('list', L)], 'Number', runMeanAbsDev, 'the mean of |x - mean|')]),
  stat('MedianAbsDev', [form([p('list', L)], 'Number', runMedianAbsDev, 'the median of |x - median|')]),
  one('Rms', 'the root mean square', (d) => Math.sqrt(sum(d.xs.map((x) => x * x)) / d.n), false),
  stat('GeometricMean', [form([p('list', L)], 'Number', runGeometric, 'the geometric mean of positive values')]),
  stat('HarmonicMean', [form([p('list', L)], 'Number', runHarmonic, 'the harmonic mean')]),
  stat('Skewness', [form([p('list', L)], 'Number', moment(3), 'the moment skewness')]),
  stat('Kurtosis', [form([p('list', L)], 'Number', moment(4), 'the moment kurtosis (not excess)')]),
  stat('Sxx', [
    form([p('list', L)], 'Number', (c) => { const xs = nonEmpty(c, 0); return xs ? centralSums(xs).s2 : undefined; }, 'the sum of squared deviations from the mean'),
    form([p('points', P)], 'Number', (c) => { const d = pairs(c, 0, true); return d ? (d.xs.length ? centralSums(d.xs).s2 : c.fail('empty_list', 'no points')) : undefined; }, 'Sxx of the x values'),
  ]),
  stat('Syy', [
    form([p('list', L)], 'Number', (c) => { const xs = nonEmpty(c, 0); return xs ? centralSums(xs).s2 : undefined; }, 'the sum of squared deviations from the mean'),
    form([p('points', P)], 'Number', (c) => { const d = pairs(c, 0, true); return d ? (d.ys.length ? centralSums(d.ys).s2 : c.fail('empty_list', 'no points')) : undefined; }, 'Syy of the y values'),
  ]),
  one('SumSq', 'the sum of squares', (d) => sum(d.xs.map((x) => x * x), d.w), true),
  stat('ZScores', [form([p('list', L)], 'List<Number>', runZScores, '(x - mean) / sd for each value')]),
  stat('Rank', [form([p('list', L)], 'List<Number>', runRank(false), 'ranks 1..n, ties get the average')]),
  stat('RankOrdinal', [form([p('list', L)], 'List<Number>', runRank(true), 'ranks 1..n, ties by position')]),
  stat('Rescale', [form([p('list', L), p('lo', 'Number'), p('hi', 'Number')], 'List<Number>', runRescale, 'min..max mapped to lo..hi')]),
  stat('Describe', [
    form([p('list', L), opt('method', 'Text', 'halves')], 'Record<Describe>', runDescribe(false), 'every summary of one list', { check: methodCheck(1) }),
    form([p('list', L), p('freqs', L), opt('method', 'Text', 'halves')], 'Record<Describe>', runDescribe(true), 'every summary, with frequencies', { check: methodCheck(2) }),
    form([p('points', P)], 'Record<Describe2>', runDescribePoints, 'both variables, correlation and covariance'),
  ]),
  // two lists
  two('Covariance', 'the covariance (divide by n)', cov(false)),
  two('SampleCovariance', 'the sample covariance (divide by n - 1)', cov(true)),
  two('Correlation', 'Pearson r', correlation),
  two('Spearman', 'the rank correlation', spearman),
  two('Sxy', 'the sum of products of deviations', (xs, ys) => sxy(xs, ys)),
  stat('SumProd', [form([p('xs', L), p('ys', L)], 'Number', (c) => { const d = pairs(c, 0, false); return d ? sum(d.xs.map((x, i) => x * (d.ys[i] as number))) : undefined; }, 'the sum of the products')]),
  withF('RSquare', '1 - SSE/SST of f against the data', 'Number', (_xs, ys, res, call) => {
    const sst = centralSums(ys).s2;
    if (sst === 0) return call.fail('zero_variance', `all y values are ${ys[0]}`);
    return 1 - sum(res.map((r) => r * r)) / sst;
  }),
  withF('SumSquaredErrors', 'the sum of squared residuals of f', 'Number', (_xs, _ys, res) => sum(res.map((r) => r * r))),
  withF('Residuals', 'y - f(x) for each point', 'List<Number>', (_xs, _ys, res) => res),
  // frequency and classes
  stat('Classes', [
    form([p('list', L)], 'List<Number>', runClasses, 'class edges by the automatic rule'),
    form([p('list', L), p('bins', 'Number')], 'List<Number>', runClasses, 'edges of equal classes', { check: wholeCheck(1, 'bins', 1, MAX_BINS) }),
  ]),
  stat('ClassesByWidth', [form([p('list', L), p('width', 'Number'), opt('start', 'Number')], 'List<Number>', runClassesByWidth, 'edges at start + i * width')]),
  stat('Frequency', [form([p('edges', L), p('list', L), opt('closed', 'Text', 'left'), opt('scale', 'Text', 'count'), opt('cumulative', 'Bool', false)], 'List<Number>', runFrequency, 'counts per class', {
    check: checks(enumCheck(2, 'closed', CLOSED), enumCheck(3, 'scale', SCALES)),
  })]),
  stat('FrequencyTable', [
    form([p('edges', L), p('list', L), opt('closed', 'Text', 'left')], 'Table', runFrequencyTable, 'class, count, relative and cumulative columns', { check: enumCheck(2, 'closed', CLOSED) }),
    form([p('list', L)], 'Table', runFrequencyTableValues, 'a row for each distinct value'),
  ]),
  stat('ContingencyTable', [
    form([p('a', 'List<Number>|List<Text>'), p('b', 'List<Number>|List<Text>')], 'Record<Contingency>', runContingency, 'counts of each pair of categories'),
    form([p('observed', 'Matrix'), p('rowLabels', 'List<Number>|List<Text>'), p('colLabels', 'List<Number>|List<Text>')], 'Record<Contingency>', runContingencyCounts, 'from ready counts'),
  ]),
  stat('Column', [form([p('table', 'Table'), p('title', 'Text')], 'List', (call) => {
    const t = call.values[0] as { fields: Record<string, unknown> } | undefined;
    const name = call.values[1];
    if (!t || typeof name !== 'string') return call.fail('input_undefined', 'the table or the title is undefined');
    const titles = t.fields['titles'] as string[];
    const k = titles.indexOf(name);
    if (k < 0) return call.fail('bad_parameter', `no column "${name}"; the columns are ${titles.map((x) => `"${x}"`).join(', ')}`);
    return (t.fields['columns'] as unknown[])[k];
  }, 'the column with that title, as a list')]),
  { name: 'Table', kind: 'object', group: 'stats', forms: [{ ...form([p('titles', 'List<Text>')], 'Table', runTable, 'a table from columns'), rest: p('columns', 'List<Number>|List<Text>') }] },
];

