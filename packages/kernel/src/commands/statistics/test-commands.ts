/**
 * Hypothesis tests and intervals (docs/features/statistics/design.md 8). Every command returns a record with named
 * fields: `statistic`, `p`, `df`, `tail`, `estimate`, `se`, `n` for a test; `lo`, `hi`, `level`, `margin`, `estimate`,
 * `se`, `df` for an interval.
 */
import type { RuleCall } from '../../graph/registry';
import type { CommandSpec, ParamSpec } from '../../language/table';
import { makeMatrix } from '../lists/types';
import type { MatrixValue } from '../lists/types';
import { bool, centralSums, enumCheck, form, levelCheck, mean, nonEmpty, num, numbers, oneOf, opt, p, record, spec, sum, tailOf } from './core';
import { table } from './describe-commands';
import { chiSqSf, fSf, normalQuantile, normalSf, tQuantile, tSf } from './dist';
import { MAX_ANOVA_GROUPS, MAX_CHI_TABLE, PROP_METHODS, TAILS, TAIL_ALIASES } from './types';
import type { Tail } from './types';

const L = 'List<Number>';
const N = 'Number';
const tests = spec('tests');

/* ------------------------------ shared ------------------------------ */

type Sf = (x: number) => number;

/** The p-value of a statistic for a tail, from the survival function of a symmetric distribution. */
function pValue(stat: number, tail: Tail, sf: Sf): number {
  if (tail === 'two') return Math.min(1, 2 * sf(Math.abs(stat)));
  return tail === 'right' ? sf(stat) : sf(-stat);
}

const zSf: Sf = normalSf;
const tSfOf = (df: number): Sf => (x) => tSf(x, df);

function testRecord(name: string, stat: number, pv: number, df: number | undefined, tail: string, estimate: number, se: number, n: number): unknown {
  return record('Test', { statistic: stat, p: pv, df, tail, estimate, se, n, test: name }, df === undefined ? { df: 'not_set' } : undefined);
}

function intervalRecord(name: string, estimate: number, margin: number, level: number, se: number, df: number | undefined): unknown {
  return record('Interval', { lo: estimate - margin, hi: estimate + margin, level, margin, estimate, se, df, test: name }, df === undefined ? { df: 'not_set' } : undefined);
}

function positive(call: RuleCall, v: number | undefined, what: string): number | undefined {
  if (v === undefined) return call.fail('input_undefined', `${what} is undefined`);
  if (!(v > 0)) return call.fail('bad_parameter', `${what} must be positive, got ${v}`);
  return v;
}

function count(call: RuleCall, v: number | undefined, what: string, min = 1): number | undefined {
  if (v === undefined) return call.fail('input_undefined', `${what} is undefined`);
  if (!Number.isInteger(v) || v < min) return call.fail('bad_parameter', `${what} must be a whole number from ${min}, got ${v}`);
  return v;
}

function levelOf(call: RuleCall, i: number): number | undefined {
  const v = call.values[i] === undefined ? 0.95 : num(call, i);
  if (v === undefined || !(v > 0 && v < 1)) return call.fail('bad_parameter', `the level must be between 0 and 1, got ${String(v)}`);
  return v;
}

/** Mean, sample sd and n of a sample of at least `min` values. */
function sample(call: RuleCall, i: number, min: number, what = 'the sample'): { m: number; sd: number; n: number } | undefined {
  const xs = nonEmpty(call, i, what);
  if (!xs) return undefined;
  if (xs.length < min) return call.fail('too_few_values', `${what} needs ${min} values, got ${xs.length}`);
  const cs = centralSums(xs);
  return { m: cs.mean, sd: xs.length > 1 ? Math.sqrt(cs.s2 / (xs.length - 1)) : 0, n: xs.length };
}

/** Welch–Satterthwaite degrees of freedom. */
const welchDf = (v1: number, n1: number, v2: number, n2: number): number => {
  const a = v1 / n1;
  const b = v2 / n2;
  return (a + b) ** 2 / (a * a / (n1 - 1) + b * b / (n2 - 1));
};

/* ------------------------------ one sample ------------------------------ */

function zTest(m: number, sigma: number, n: number, mu0: number, tail: Tail): unknown {
  const se = sigma / Math.sqrt(n);
  const z = (m - mu0) / se;
  return testRecord('ZTest', z, pValue(z, tail, zSf), undefined, tail, m, se, n);
}

function runZTestData(call: RuleCall): unknown {
  const s = sample(call, 0, 1);
  const mu0 = num(call, 1);
  const sigma = positive(call, num(call, 2), 'sigma');
  const tail = tailOf(call, 3);
  if (!s || mu0 === undefined || sigma === undefined || !tail) return undefined;
  return zTest(s.m, sigma, s.n, mu0, tail);
}

function runZTestSummary(call: RuleCall): unknown {
  const m = num(call, 0);
  const sigma = positive(call, num(call, 1), 'sigma');
  const n = count(call, num(call, 2), 'n');
  const mu0 = num(call, 3);
  const tail = tailOf(call, 4);
  if (m === undefined || mu0 === undefined) return call.fail('input_undefined', 'a number is undefined');
  if (sigma === undefined || n === undefined || !tail) return undefined;
  return zTest(m, sigma, n, mu0, tail);
}

function tTest(name: string, m: number, sd: number, n: number, mu0: number, tail: Tail): unknown {
  const se = sd / Math.sqrt(n);
  const t = (m - mu0) / se;
  return testRecord(name, t, pValue(t, tail, tSfOf(n - 1)), n - 1, tail, m, se, n);
}

function runTTestData(call: RuleCall): unknown {
  const s = sample(call, 0, 2);
  const mu0 = num(call, 1);
  const tail = tailOf(call, 2);
  if (!s || mu0 === undefined || !tail) return mu0 === undefined && s ? call.fail('input_undefined', 'mu0 is undefined') : undefined;
  if (s.sd === 0) return call.fail('zero_variance', `all values are ${s.m}`);
  return tTest('TTest', s.m, s.sd, s.n, mu0, tail);
}

function runTTestSummary(call: RuleCall): unknown {
  const m = num(call, 0);
  const sd = positive(call, num(call, 1), 'sd');
  const n = count(call, num(call, 2), 'n', 2);
  const mu0 = num(call, 3);
  const tail = tailOf(call, 4);
  if (m === undefined || mu0 === undefined) return call.fail('input_undefined', 'a number is undefined');
  if (sd === undefined || n === undefined || !tail) return undefined;
  return tTest('TTest', m, sd, n, mu0, tail);
}

/* ------------------------------ two samples ------------------------------ */

function zTest2(m1: number, s1: number, n1: number, m2: number, s2: number, n2: number, tail: Tail): unknown {
  const se = Math.sqrt((s1 * s1) / n1 + (s2 * s2) / n2);
  const z = (m1 - m2) / se;
  return testRecord('ZTest2', z, pValue(z, tail, zSf), undefined, tail, m1 - m2, se, n1 + n2);
}

function runZTest2Data(call: RuleCall): unknown {
  const a = sample(call, 0, 1, 'sample 1');
  const b = sample(call, 1, 1, 'sample 2');
  const s1 = positive(call, num(call, 2), 'sigma1');
  const s2 = positive(call, num(call, 3), 'sigma2');
  const tail = tailOf(call, 4);
  if (!a || !b || s1 === undefined || s2 === undefined || !tail) return undefined;
  return zTest2(a.m, s1, a.n, b.m, s2, b.n, tail);
}

function summary2(call: RuleCall, minN: number): { m1: number; s1: number; n1: number; m2: number; s2: number; n2: number } | undefined {
  const m1 = num(call, 0);
  const m2 = num(call, 3);
  if (m1 === undefined || m2 === undefined) return call.fail('input_undefined', 'a mean is undefined');
  const s1 = positive(call, num(call, 1), 'the first deviation');
  const n1 = count(call, num(call, 2), 'n1', minN);
  const s2 = positive(call, num(call, 4), 'the second deviation');
  const n2 = count(call, num(call, 5), 'n2', minN);
  if (s1 === undefined || n1 === undefined || s2 === undefined || n2 === undefined) return undefined;
  return { m1, s1, n1, m2, s2, n2 };
}

function runZTest2Summary(call: RuleCall): unknown {
  const s = summary2(call, 1);
  const tail = tailOf(call, 6);
  return s && tail ? zTest2(s.m1, s.s1, s.n1, s.m2, s.s2, s.n2, tail) : undefined;
}

/** Welch by default; pooled variance on request (design 3.3). */
function tTwo(m1: number, s1: number, n1: number, m2: number, s2: number, n2: number, pooled: boolean): { est: number; se: number; df: number } {
  const v1 = s1 * s1;
  const v2 = s2 * s2;
  if (pooled) {
    const df = n1 + n2 - 2;
    const sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / df;
    return { est: m1 - m2, se: Math.sqrt(sp2 * (1 / n1 + 1 / n2)), df };
  }
  return { est: m1 - m2, se: Math.sqrt(v1 / n1 + v2 / n2), df: welchDf(v1, n1, v2, n2) };
}

function runTTest2Data(call: RuleCall): unknown {
  const a = sample(call, 0, 2, 'sample 1');
  const b = sample(call, 1, 2, 'sample 2');
  const tail = tailOf(call, 2);
  if (!a || !b || !tail) return undefined;
  const r = tTwo(a.m, a.sd, a.n, b.m, b.sd, b.n, bool(call, 3, false));
  if (!(r.se > 0)) return call.fail('zero_variance', 'both samples are constant');
  const t = r.est / r.se;
  return testRecord('TTest2', t, pValue(t, tail, tSfOf(r.df)), r.df, tail, r.est, r.se, a.n + b.n);
}

function runTTest2Summary(call: RuleCall): unknown {
  const s = summary2(call, 2);
  const tail = tailOf(call, 6);
  if (!s || !tail) return undefined;
  const r = tTwo(s.m1, s.s1, s.n1, s.m2, s.s2, s.n2, bool(call, 7, false));
  const t = r.est / r.se;
  return testRecord('TTest2', t, pValue(t, tail, tSfOf(r.df)), r.df, tail, r.est, r.se, s.n1 + s.n2);
}

function differences(call: RuleCall): Float64Array | undefined {
  const a = numbers(call, 0, 'sample 1');
  const b = numbers(call, 1, 'sample 2');
  if (!a || !b) return undefined;
  if (a.length !== b.length) return call.fail('size_mismatch', `sample 1 has ${a.length} values, sample 2 has ${b.length}`);
  if (a.length < 2) return call.fail('too_few_values', `a paired test needs 2 pairs, got ${a.length}`);
  return a.map((x, i) => x - (b[i] as number));
}

function runTTestPaired(call: RuleCall): unknown {
  const d = differences(call);
  const tail = tailOf(call, 2);
  if (!d || !tail) return undefined;
  const cs = centralSums(d);
  const sd = Math.sqrt(cs.s2 / (d.length - 1));
  if (sd === 0) return call.fail('zero_variance', 'every difference is the same');
  return tTest('TTestPaired', cs.mean, sd, d.length, 0, tail);
}

/* ------------------------------ proportions ------------------------------ */

function prop(call: RuleCall, xi: number, ni: number): { x: number; n: number } | undefined {
  const n = count(call, num(call, ni), 'n');
  const x = count(call, num(call, xi), 'x', 0);
  if (n === undefined || x === undefined) return undefined;
  if (x > n) return call.fail('bad_parameter', `x = ${x} exceeds n = ${n}`);
  return { x, n };
}

function runZPropTest(call: RuleCall): unknown {
  const pr = prop(call, 0, 1);
  const p0 = num(call, 2);
  const tail = tailOf(call, 3);
  if (!pr || !tail) return undefined;
  if (p0 === undefined || !(p0 > 0 && p0 < 1)) return call.fail('bad_parameter', `p0 must be between 0 and 1, got ${String(p0)}`);
  if (pr.n * p0 < 10 || pr.n * (1 - p0) < 10) call.notify('normal_approx_weak', { n: pr.n });
  const ph = pr.x / pr.n;
  const se = Math.sqrt((p0 * (1 - p0)) / pr.n);
  const z = (ph - p0) / se;
  return testRecord('ZPropTest', z, pValue(z, tail, zSf), undefined, tail, ph, se, pr.n);
}

function runZPropTest2(call: RuleCall): unknown {
  const a = prop(call, 0, 1);
  const b = prop(call, 2, 3);
  const tail = tailOf(call, 4);
  if (!a || !b || !tail) return undefined;
  const pp = (a.x + b.x) / (a.n + b.n);
  const se = Math.sqrt(pp * (1 - pp) * (1 / a.n + 1 / b.n));
  if (!(se > 0)) return call.fail('zero_variance', 'the pooled proportion is 0 or 1');
  if (Math.min(a.x, a.n - a.x, b.x, b.n - b.x) < 10) call.notify('normal_approx_weak', { n: a.n + b.n });
  const est = a.x / a.n - b.x / b.n;
  const z = est / se;
  return testRecord('ZPropTest2', z, pValue(z, tail, zSf), undefined, tail, est, se, a.n + b.n);
}

/* ------------------------------ chi-squared and ANOVA ------------------------------ */

function chiResult(call: RuleCall, obs: MatrixValue, exp: Float64Array, df: number, name: string): unknown {
  let stat = 0;
  const contrib = new Float64Array(obs.data.length);
  const low: string[] = [];
  for (let k = 0; k < obs.data.length; k++) {
    const e = exp[k] as number;
    const o = obs.data[k] as number;
    contrib[k] = ((o - e) * (o - e)) / e;
    stat += contrib[k] as number;
    if (e < 5) low.push(obs.rows === 1 ? `${k + 1}` : `(${Math.floor(k / obs.cols) + 1}, ${(k % obs.cols) + 1})`);
  }
  if (low.length > 0) call.notify('expected_count_low', { cells: low.join(', ') });
  return record('ChiSquared', {
    statistic: stat, p: chiSqSf(stat, df), df, tail: 'right', n: sum(obs.data), expected: makeMatrix(obs.rows, obs.cols, exp), contributions: makeMatrix(obs.rows, obs.cols, contrib), test: name,
  });
}

function runChiIndependence(call: RuleCall): unknown {
  const m = call.values[0] as MatrixValue | undefined;
  if (!m) return call.fail('input_undefined', 'the table is undefined');
  if (m.rows < 2 || m.cols < 2) return call.fail('too_few_values', `the table is ${m.rows}×${m.cols}; independence needs at least 2×2`);
  if (m.rows > MAX_CHI_TABLE || m.cols > MAX_CHI_TABLE) return call.fail('too_large', `tables up to ${MAX_CHI_TABLE}×${MAX_CHI_TABLE}`);
  const neg = m.data.findIndex((v) => !(v >= 0));
  if (neg >= 0) return call.fail('bad_parameter', `count ${neg + 1} is ${m.data[neg]}; counts are 0 or more`);
  const R = new Float64Array(m.rows);
  const C = new Float64Array(m.cols);
  for (let i = 0; i < m.rows; i++) for (let j = 0; j < m.cols; j++) {
    const v = m.data[i * m.cols + j] as number;
    R[i] = (R[i] as number) + v;
    C[j] = (C[j] as number) + v;
  }
  const zr = R.findIndex((v) => v === 0);
  if (zr >= 0) return call.fail('cells_empty', `row ${zr + 1} sums to 0`);
  const zc = C.findIndex((v) => v === 0);
  if (zc >= 0) return call.fail('cells_empty', `column ${zc + 1} sums to 0`);
  const total = sum(R);
  const exp = new Float64Array(m.data.length);
  for (let i = 0; i < m.rows; i++) for (let j = 0; j < m.cols; j++) exp[i * m.cols + j] = ((R[i] as number) * (C[j] as number)) / total;
  return chiResult(call, m, exp, (m.rows - 1) * (m.cols - 1), 'ChiSquaredTest');
}

function runChiFit(call: RuleCall): unknown {
  const o = numbers(call, 0, 'the observed counts');
  const e = numbers(call, 1, 'the expected counts');
  if (!o || !e) return undefined;
  if (o.length !== e.length) return call.fail('size_mismatch', `${o.length} observed, ${e.length} expected`);
  if (o.length < 2) return call.fail('too_few_values', 'a goodness-of-fit test needs 2 categories');
  const ddof = num(call, 2) ?? 0;
  if (!Number.isInteger(ddof) || ddof < 0) return call.fail('bad_parameter', `ddof must be a whole number from 0, got ${ddof}`);
  const df = o.length - 1 - ddof;
  if (df < 1) return call.fail('too_few_values', `${o.length} categories leave no degrees of freedom with ddof ${ddof}`);
  if (o.some((v) => !(v >= 0))) return call.fail('bad_parameter', 'observed counts are 0 or more');
  if (e.some((v) => !(v > 0))) return call.fail('bad_parameter', 'expected counts must be positive');
  // expected counts are scaled to the observed total (so probabilities work too)
  const so = sum(o);
  const se = sum(e);
  const exp = e.map((v) => (v * so) / se);
  return chiResult(call, makeMatrix(1, o.length, o), exp, df, 'ChiSquaredTest');
}

function runAnova(call: RuleCall): unknown {
  const groups = call.values[0];
  if (!Array.isArray(groups)) return call.fail('input_undefined', 'the groups are undefined');
  if (groups.length < 2) return call.fail('groups_too_few', `ANOVA needs 2 groups, got ${groups.length}`);
  if (groups.length > MAX_ANOVA_GROUPS) return call.fail('too_large', `ANOVA takes up to ${MAX_ANOVA_GROUPS} groups`);
  const gs = groups.map((g) => (g instanceof Float64Array ? g : Float64Array.from(g as number[])));
  const empty = gs.findIndex((g) => g.length === 0);
  if (empty >= 0) return call.fail('groups_too_few', `group ${empty + 1} has no values`);
  const all = new Float64Array(gs.reduce((a, g) => a + g.length, 0));
  let off = 0;
  for (const g of gs) {
    all.set(g, off);
    off += g.length;
  }
  const N = all.length;
  const k = gs.length;
  if (N - k < 1) return call.fail('too_few_values', 'each group needs more values: no degrees of freedom within groups');
  const grand = mean(all);
  const means = Float64Array.from(gs, (g) => mean(g));
  let ssb = 0;
  let ssw = 0;
  gs.forEach((g, i) => {
    ssb += g.length * ((means[i] as number) - grand) ** 2;
    ssw += centralSums(g).s2;
  });
  const dfb = k - 1;
  const dfw = N - k;
  const msb = ssb / dfb;
  const msw = ssw / dfw;
  if (msw === 0) return call.fail('zero_variance', 'every group is constant');
  const F = msb / msw;
  const pv = fSf(F, dfb, dfw);
  const tbl = table(['source', 'SS', 'df', 'MS', 'F', 'p'], [
    ['between', 'within', 'total'], Float64Array.of(ssb, ssw, ssb + ssw), Float64Array.of(dfb, dfw, N - 1), Float64Array.of(msb, msw, NaN), Float64Array.of(F, NaN, NaN), Float64Array.of(pv, NaN, NaN),
  ]);
  return record('ANOVA', { F, p: pv, dfBetween: dfb, dfWithin: dfw, ssBetween: ssb, ssWithin: ssw, msBetween: msb, msWithin: msw, grandMean: grand, groupMeans: means, table: tbl });
}

/* ------------------------------ intervals ------------------------------ */

const zCrit = (level: number): number => normalQuantile(1 - (1 - level) / 2);
const tCrit = (level: number, df: number): number => tQuantile(1 - (1 - level) / 2, df);

function runZIntervalData(call: RuleCall): unknown {
  const s = sample(call, 0, 1);
  const sigma = positive(call, num(call, 1), 'sigma');
  const level = levelOf(call, 2);
  if (!s || sigma === undefined || level === undefined) return undefined;
  const se = sigma / Math.sqrt(s.n);
  return intervalRecord('ZInterval', s.m, zCrit(level) * se, level, se, undefined);
}

function runZIntervalSummary(call: RuleCall): unknown {
  const m = num(call, 0);
  const sigma = positive(call, num(call, 1), 'sigma');
  const n = count(call, num(call, 2), 'n');
  const level = levelOf(call, 3);
  if (m === undefined) return call.fail('input_undefined', 'the mean is undefined');
  if (sigma === undefined || n === undefined || level === undefined) return undefined;
  const se = sigma / Math.sqrt(n);
  return intervalRecord('ZInterval', m, zCrit(level) * se, level, se, undefined);
}

function tInterval(name: string, m: number, sd: number, n: number, level: number): unknown {
  const se = sd / Math.sqrt(n);
  return intervalRecord(name, m, tCrit(level, n - 1) * se, level, se, n - 1);
}

function runTIntervalData(call: RuleCall): unknown {
  const s = sample(call, 0, 2);
  const level = levelOf(call, 1);
  if (!s || level === undefined) return undefined;
  return tInterval('TInterval', s.m, s.sd, s.n, level);
}

function runTIntervalSummary(call: RuleCall): unknown {
  const m = num(call, 0);
  const sd = positive(call, num(call, 1), 'sd');
  const n = count(call, num(call, 2), 'n', 2);
  const level = levelOf(call, 3);
  if (m === undefined) return call.fail('input_undefined', 'the mean is undefined');
  if (sd === undefined || n === undefined || level === undefined) return undefined;
  return tInterval('TInterval', m, sd, n, level);
}

function runZInterval2Data(call: RuleCall): unknown {
  const a = sample(call, 0, 1, 'sample 1');
  const b = sample(call, 1, 1, 'sample 2');
  const s1 = positive(call, num(call, 2), 'sigma1');
  const s2 = positive(call, num(call, 3), 'sigma2');
  const level = levelOf(call, 4);
  if (!a || !b || s1 === undefined || s2 === undefined || level === undefined) return undefined;
  const se = Math.sqrt((s1 * s1) / a.n + (s2 * s2) / b.n);
  return intervalRecord('ZInterval2', a.m - b.m, zCrit(level) * se, level, se, undefined);
}

function runZInterval2Summary(call: RuleCall): unknown {
  const s = summary2(call, 1);
  const level = levelOf(call, 6);
  if (!s || level === undefined) return undefined;
  const se = Math.sqrt((s.s1 * s.s1) / s.n1 + (s.s2 * s.s2) / s.n2);
  return intervalRecord('ZInterval2', s.m1 - s.m2, zCrit(level) * se, level, se, undefined);
}

function runTInterval2Data(call: RuleCall): unknown {
  const a = sample(call, 0, 2, 'sample 1');
  const b = sample(call, 1, 2, 'sample 2');
  const level = levelOf(call, 2);
  if (!a || !b || level === undefined) return undefined;
  const r = tTwo(a.m, a.sd, a.n, b.m, b.sd, b.n, bool(call, 3, false));
  return intervalRecord('TInterval2', r.est, tCrit(level, r.df) * r.se, level, r.se, r.df);
}

function runTInterval2Summary(call: RuleCall): unknown {
  const s = summary2(call, 2);
  const level = levelOf(call, 6);
  if (!s || level === undefined) return undefined;
  const r = tTwo(s.m1, s.s1, s.n1, s.m2, s.s2, s.n2, bool(call, 7, false));
  return intervalRecord('TInterval2', r.est, tCrit(level, r.df) * r.se, level, r.se, r.df);
}

function runTIntervalPaired(call: RuleCall): unknown {
  const d = differences(call);
  const level = levelOf(call, 2);
  if (!d || level === undefined) return undefined;
  const cs = centralSums(d);
  return tInterval('TIntervalPaired', cs.mean, Math.sqrt(cs.s2 / (d.length - 1)), d.length, level);
}

function runZPropInterval(call: RuleCall): unknown {
  const pr = prop(call, 0, 1);
  const level = levelOf(call, 2);
  const method = oneOf(call, 3, 'wald', PROP_METHODS, 'method');
  if (!pr || level === undefined || !method) return undefined;
  const z = zCrit(level);
  const ph = pr.x / pr.n;
  const se = Math.sqrt((ph * (1 - ph)) / pr.n);
  if (method === 'wald') {
    if (pr.x < 10 || pr.n - pr.x < 10) call.notify('normal_approx_weak', { n: pr.n });
    return intervalRecord('ZPropInterval', ph, z * se, level, se, undefined);
  }
  const n = pr.n;
  const denom = 1 + (z * z) / n;
  const centre = (ph + (z * z) / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n));
  return intervalRecord('ZPropInterval', centre, half, level, se, undefined);
}

function runZPropInterval2(call: RuleCall): unknown {
  const a = prop(call, 0, 1);
  const b = prop(call, 2, 3);
  const level = levelOf(call, 4);
  if (!a || !b || level === undefined) return undefined;
  const p1 = a.x / a.n;
  const p2 = b.x / b.n;
  const se = Math.sqrt((p1 * (1 - p1)) / a.n + (p2 * (1 - p2)) / b.n);
  if (Math.min(a.x, a.n - a.x, b.x, b.n - b.x) < 10) call.notify('normal_approx_weak', { n: a.n + b.n });
  return intervalRecord('ZPropInterval2', p1 - p2, zCrit(level) * se, level, se, undefined);
}

/* ------------------------------ the table ------------------------------ */

const tailP = (): ParamSpec => opt('tail', 'Text', 'two');
const levelP = (): ParamSpec => opt('level', N, 0.95);
const pooledP = (): ParamSpec => opt('pooled', 'Bool', false);
const nums = (...names: string[]): ParamSpec[] => names.map((n) => p(n, N));
const tailCheck = (i: number) => enumCheck(i, 'tail', TAILS, TAIL_ALIASES, 'Use "right" for a test that the value is larger. The signs "<" ">" "!=" are also accepted.');
const T = 'Record<Test>';
const I = 'Record<Interval>';

export const TEST_COMMANDS: readonly CommandSpec[] = [
  tests('ZTest', [
    form([p('sample', L), p('mu0', N), p('sigma', N), tailP()], T, runZTestData, 'z test of a mean with known sigma', { check: tailCheck(3) }),
    form([...nums('mean', 'sigma', 'n', 'mu0'), tailP()], T, runZTestSummary, 'z test from summary numbers', { check: tailCheck(4) }),
  ]),
  tests('TTest', [
    form([p('sample', L), p('mu0', N), tailP()], T, runTTestData, 't test of a mean', { check: tailCheck(2) }),
    form([...nums('mean', 'sd', 'n', 'mu0'), tailP()], T, runTTestSummary, 't test from summary numbers', { check: tailCheck(4) }),
  ]),
  tests('ZTest2', [
    form([p('sample1', L), p('sample2', L), p('sigma1', N), p('sigma2', N), tailP()], T, runZTest2Data, 'z test of two means', { check: tailCheck(4) }),
    form([...nums('mean1', 'sigma1', 'n1', 'mean2', 'sigma2', 'n2'), tailP()], T, runZTest2Summary, 'z test of two means from summary numbers', { check: tailCheck(6) }),
  ]),
  tests('TTest2', [
    form([p('sample1', L), p('sample2', L), tailP(), pooledP()], T, runTTest2Data, 't test of two means (Welch unless pooled)', { check: tailCheck(2) }),
    form([...nums('mean1', 'sd1', 'n1', 'mean2', 'sd2', 'n2'), tailP(), pooledP()], T, runTTest2Summary, 't test of two means from summary numbers', { check: tailCheck(6) }),
  ]),
  tests('TTestPaired', [form([p('sample1', L), p('sample2', L), tailP()], T, runTTestPaired, 't test of paired differences', { check: tailCheck(2) })]),
  tests('ZPropTest', [form([...nums('x', 'n', 'p0'), tailP()], T, runZPropTest, 'z test of a proportion', { check: tailCheck(3) })]),
  tests('ZPropTest2', [form([...nums('x1', 'n1', 'x2', 'n2'), tailP()], T, runZPropTest2, 'z test of two proportions (pooled)', { check: tailCheck(4) })]),
  tests('ChiSquaredTest', [
    form([p('observed', 'Matrix')], 'Record<ChiSquared>', runChiIndependence, 'chi-squared test of independence'),
    form([p('observed', L), p('expected', L), opt('ddof', N, 0)], 'Record<ChiSquared>', runChiFit, 'chi-squared goodness of fit'),
  ]),
  tests('ANOVA', [form([p('groups', 'List<List<Number>>')], 'Record<ANOVA>', runAnova, 'one-way analysis of variance')]),
  tests('ZInterval', [
    form([p('sample', L), p('sigma', N), levelP()], I, runZIntervalData, 'z interval for a mean', { check: levelCheck(2) }),
    form([...nums('mean', 'sigma', 'n'), levelP()], I, runZIntervalSummary, 'z interval from summary numbers', { check: levelCheck(3) }),
  ]),
  tests('TInterval', [
    form([p('sample', L), levelP()], I, runTIntervalData, 't interval for a mean', { check: levelCheck(1) }),
    form([...nums('mean', 'sd', 'n'), levelP()], I, runTIntervalSummary, 't interval from summary numbers', { check: levelCheck(3) }),
  ]),
  tests('ZInterval2', [
    form([p('sample1', L), p('sample2', L), p('sigma1', N), p('sigma2', N), levelP()], I, runZInterval2Data, 'z interval for a difference of means', { check: levelCheck(4) }),
    form([...nums('mean1', 'sigma1', 'n1', 'mean2', 'sigma2', 'n2'), levelP()], I, runZInterval2Summary, 'z interval from summary numbers', { check: levelCheck(6) }),
  ]),
  tests('TInterval2', [
    form([p('sample1', L), p('sample2', L), levelP(), pooledP()], I, runTInterval2Data, 't interval for a difference of means', { check: levelCheck(2) }),
    form([...nums('mean1', 'sd1', 'n1', 'mean2', 'sd2', 'n2'), levelP(), pooledP()], I, runTInterval2Summary, 't interval from summary numbers', { check: levelCheck(6) }),
  ]),
  tests('TIntervalPaired', [form([p('sample1', L), p('sample2', L), levelP()], I, runTIntervalPaired, 't interval for paired differences', { check: levelCheck(2) })]),
  tests('ZPropInterval', [form([...nums('x', 'n'), levelP(), opt('method', 'Text', 'wald')], I, runZPropInterval, 'interval for a proportion (Wald or Wilson)', {
    check: (c) => levelCheck(2)(c) ?? enumCheck(3, 'method', PROP_METHODS)(c),
  })]),
  tests('ZPropInterval2', [form([...nums('x1', 'n1', 'x2', 'n2'), levelP()], I, runZPropInterval2, 'interval for a difference of proportions', { check: levelCheck(4) })]),
];
