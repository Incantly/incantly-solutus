/**
 * Probability, second round (docs/features/probability: design 3 to 6, errors 2 to 4; .kiro/specs/probability R3 to R7).
 * Built from the docs and the public API only.
 */
import { describe, expect, it } from 'vitest';
import { Figure } from '@incantly/kernel';
import { apply, bad, fields, fig, num, nums, ok, registry, undef, val } from '../statistics/helpers';

const close = (a: unknown, b: number, tol = 1e-12): void => {
  if (typeof a !== 'number') throw new Error(`not a number: ${String(a)}`);
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));
};

describe('known values (design 4.4)', () => {
  it.each([
    ['Cdf(Normal(0, 1), 1.96)', 0.9750021048517795],
    ['Quantile(Normal(0, 1), 0.975)', 1.959963984540054],
    ['Quantile(StudentT(10), 0.975)', 2.228138851986274],
    ['Quantile(ChiSquared(1), 0.95)', 3.841458820694124],
    ['Quantile(FDist(5, 10), 0.95)', 3.325834530413012],
    ['Cdf(Binomial(10, 0.5), 5)', 0.623046875],
    ['Pdf(Poisson(3), 2)', 0.22404180765538775],
    ['Cdf(Exponential(2), 1)', 0.8646647167633873],
  ])('%s', (expr, want) => {
    close(num([], `v = ${expr}`), want, 1e-10);
  });
});

describe('the rest of the distributions (R4)', () => {
  it.each([
    ['Cdf(Gamma(3, 2), 1)', 1 - 5 * Math.exp(-2)],
    ['Cdf(Erlang(3, 2), 1)', 1 - 5 * Math.exp(-2)],
    ['Cdf(Beta(2, 5), 0.3)', 1 - 0.7 ** 6 - 6 * 0.3 * 0.7 ** 5],
    ['Cdf(Cauchy(0, 1), 1)', 0.75],
    ['Cdf(Weibull(2, 1), 1)', 1 - Math.exp(-1)],
    ['Cdf(LogNormal(0, 1), 1)', 0.5],
    ['Median(LogNormal(0, 1))', 1],
    ['Cdf(Logistic(0, 1), 0)', 0.5],
    ['Variance(Logistic(0, 1))', Math.PI ** 2 / 3],
    ['Cdf(Triangular(0, 1, 2), 1)', 0.5],
    ['Mean(Triangular(0, 1, 2))', 1],
    ['Pdf(NegBinomial(3, 0.5), 0)', 0.125],
    ['Mean(NegBinomial(3, 0.5))', 3],
    ['Mean(HyperGeometric(50, 20, 10))', 4],
    ['Cdf(HyperGeometric(50, 20, 10), 10)', 1],
    ['Pdf(Zipf(1, 4), 1)', 0.48],
    ['Cdf(DiscreteUniform(1, 6), 3)', 0.5],
    ['Variance(DiscreteUniform(1, 6))', 35 / 12],
    ['Pdf(Geometric(0.5), 2)', 0.125],
  ])('%s', (expr, want) => {
    close(num([], `v = ${expr}`), want, 1e-11);
  });

  it('every constructor gives the specific type', () => {
    const f = fig(['a = Normal(0, 1)', 'b = Binomial(5, 0.5)', 'c = Discrete([1, 2], [0.5, 0.5])']);
    expect(f.get('a')?.type).toBe('ContinuousDistribution');
    expect(f.get('b')?.type).toBe('DiscreteDistribution');
    expect(f.get('c')?.type).toBe('DiscreteDistribution');
  });

  it('literal parameters that break a rule are bad_argument with an example', () => {
    const e = bad(fig().apply('d = Triangular(0, 3, 2)'), 'bad_argument');
    expect(JSON.stringify(e)).toMatch(/Triangular\(0, 1, 2\)/);
    bad(fig().apply('d = HyperGeometric(10, 12, 3)'), 'bad_argument');
    bad(fig().apply('d = Binomial(2.5, 0.5)'), 'bad_argument');
    expect(undef(['k = 3'], 'd = Erlang(k - 3, 1)')).toBe('bad_parameter');
  });

  it('a pmf sums to 1 and a quantile inverts the cdf', () => {
    for (const d of ['Binomial(30, 0.3)', 'Poisson(7.5)', 'NegBinomial(2.5, 0.4)', 'HyperGeometric(40, 15, 12)', 'Zipf(1.2, 30)', 'Geometric(0.2)']) {
      const total = num([`d = ${d}`], 's = Sum(Seq(Pdf(d, k), k, 0, 400))');
      close(total, 1, 1e-10);
      for (const q of [0.05, 0.5, 0.95]) {
        const k = num([`d = ${d}`], `k = Quantile(d, ${q})`);
        expect(num([`d = ${d}`], `c = Cdf(d, ${k})`)).toBeGreaterThanOrEqual(q - 1e-12);
        expect(num([`d = ${d}`], `c = Cdf(d, ${k - 1})`)).toBeLessThan(q);
      }
    }
    for (const d of ['Gamma(2.5, 0.7)', 'Beta(0.5, 3)', 'Weibull(1.5, 2)', 'LogNormal(1, 0.4)', 'Logistic(2, 3)', 'Triangular(-1, 0, 4)', 'FDist(3, 7)', 'StudentT(2.5)']) {
      for (const q of [0.001, 0.3, 0.9, 0.999]) {
        const x = num([`d = ${d}`], `xq = Quantile(d, ${q})`);
        close(num([`d = ${d}`], `c = Cdf(d, ${x})`), q, 1e-10);
      }
    }
  });
});

describe('Discrete(values, probs) (R4.2)', () => {
  const D = ['d = Discrete([1, 2, 3], [0.2, 0.5, 0.3])'];
  it('moments and interval ends', () => {
    close(num(D, 'm = Mean(d)'), 2.1);
    close(num(D, 'p = Prob(d, 2, 3)'), 0.8);
    close(num(D, 'p = Prob(d, 2, 3, "(]")'), 0.3);
    close(num(D, 'p = Prob(d, 2, 3, "[)")'), 0.5);
    expect(nums(val(D, 'm = Mode(d)'))).toEqual([2]);
  });
  it('values need not be whole numbers', () => {
    close(num(['d = Discrete([0.5, 1.5], [0.25, 0.75])'], 'p = Prob(d, 0.5, 1, "()")'), 0);
    close(num(['d = Discrete([0.5, 1.5], [0.25, 0.75])'], 'p = Cdf(d, 1)'), 0.25);
  });
  it('probabilities are scaled with a notice, or are bad_weights', () => {
    expect(JSON.stringify(apply([], 'd = Discrete([1, 2], [1, 1])'))).toMatch(/probs_not_normalised/);
    expect(JSON.stringify(apply([], 'd = Discrete([1, 2], [0.5, 0.5000001])'))).toMatch(/probs_normalised/);
    expect(undef([], 'd = Discrete([1, 2], [0.5, -0.5])')).toBe('bad_weights');
    expect(undef([], 'd = Discrete([1, 2, 3], [0.5, 0.5])')).toBe('bad_weights');
  });
});

describe('describe and show (R5)', () => {
  it('moments, median, mode and support', () => {
    close(num([], 's = Skewness(Exponential(1))'), 2);
    close(num([], 'k = Kurtosis(Normal(0, 1))'), 3);
    close(num([], 'm = Median(Exponential(1))'), Math.LN2);
    expect(nums(val([], 'm = Mode(Binomial(9, 0.5))'))).toEqual([4, 5]);
    expect(undef([], 'm = Mean(Cauchy(0, 1))')).toBe('undefined_moment');
    expect(undef([], 'm = Mode(Uniform(0, 1))')).toBe('undefined_moment');
    const s = fields([], 's = Support(Poisson(2))');
    expect([s['lo'], s['hi'], s['discrete']]).toEqual([0, Infinity, true]);
  });

  it('LogPdf stays accurate where Pdf underflows', () => {
    expect(num([], 'p = Pdf(Normal(0, 1), 40)')).toBe(0);
    close(num([], 'p = LogPdf(Normal(0, 1), 40)'), -800 - 0.5 * Math.log(2 * Math.PI), 1e-14);
  });

  it('a right-tail quantile is precise for tiny q', () => {
    close(num([], 'xq = Quantile(Normal(0, 1), 1e-20, "right")'), 9.26234008979841, 1e-12);
    close(num([], 'xq = Quantile(Gamma(2, 1), 1e-12, "right")'), num([], 'yq = Quantile(Gamma(2, 1), 1 - 1e-12)'), 1e-3);
    bad(fig().apply('xq = Quantile(Normal(0, 1), 1.2)'), 'bad_argument');
  });

  it('a discrete quantile notes the probability it reached', () => {
    const r = apply([], 'k = Quantile(Binomial(10, 0.5), 0.9)');
    ok(r);
    expect(JSON.stringify(r)).toMatch(/rounding_discrete_quantile/);
    expect(num([], 'k = Quantile(Binomial(10, 0.5), 0.9)')).toBe(7);
    expect(num([], 'k = Quantile(Binomial(10, 0.5), 0.623046875)')).toBe(5);
  });

  it('PlotRange uses 98 % for heavy tails', () => {
    const r = apply([], 'r = PlotRange(Cauchy(0, 1))');
    expect(JSON.stringify(r)).toMatch(/heavy_tail_plot/);
    close(fields([], 'r = PlotRange(Cauchy(0, 1))')['lo'] as number, Math.tan(Math.PI * (0.01 - 0.5)), 1e-10);
    const b = fields([], 'r = PlotRange(Binomial(20, 0.5))');
    expect(b['lo']).toBeLessThan(1);
    expect(b['hi']).toBeGreaterThan(18);
  });

  it('NormalApprox, CentralInterval and MinTrials', () => {
    const f = fig(['n = NormalApprox(Binomial(100, 0.5))']);
    expect(f.get('n')?.type).toBe('ContinuousDistribution');
    ok(f.apply('m = Mean(n)'));
    ok(f.apply('s = StdDev(n)'));
    close(f.value('m'), 50);
    close(f.value('s'), 5);
    close(fields([], 'c = CentralInterval(Normal(0, 1), 0.95)')['hi'] as number, 1.959963984540054, 1e-12);
    expect(num([], 'n = MinTrials(0.5, 1, 0.9)')).toBe(4);
    expect(undef([], 'n = MinTrials(0, 1, 0.9)')).toBe('zero_probability');
  });

  it('Shade of a discrete distribution picks out bars; ShadeTails and the mass field', () => {
    const s = fields([], 's = Shade(Binomial(4, 0.5), 1, 3)');
    close(s['mass'] as number, 14 / 16);
    expect(nums(s['inside'])).toEqual([0, 1, 1, 1, 0]);
    const open = fields([], 's = Shade(Binomial(4, 0.5), 1, 3, "[)")');
    close(open['mass'] as number, 10 / 16);
    close(num(['s = ShadeTails(Normal(0, 1), -1.96, 1.96)'], 'm = s.mass'), 0.04999579029644087, 1e-10);
    close(num(['s = Shade(Normal(0, 1), -1, 1)'], 'm = s.mass'), 0.6826894921370859, 1e-12);
    const t = fields([], 'tl = ShadeTails(Binomial(4, 0.5), 1, 3)');
    close(t['mass'] as number, 2 / 16);
    expect(nums(t['inside'])).toEqual([1, 0, 0, 0, 1]);
  });

  it('PdfTable', () => {
    const t = fields([], 'tb = PdfTable(Binomial(4, 0.5), 0, 4)');
    expect(t['titles']).toEqual(['k', 'P(X = k)', 'P(X ≤ k)', 'P(X ≥ k)']);
    const cols = t['columns'] as Float64Array[];
    expect(Array.from(cols[0] as Float64Array)).toEqual([0, 1, 2, 3, 4]);
    Array.from(cols[2] as Float64Array).forEach((v, i) => close(v, ([1, 5, 11, 15, 16][i] as number) / 16));
    Array.from(cols[3] as Float64Array).forEach((v, i) => close(v, ([16, 15, 11, 5, 1][i] as number) / 16));
    const c = fields([], 'tb = PdfTable(Normal(0, 1), -1, 1, 0.5)');
    expect(c['rows']).toBe(5);
    bad(fig().apply('tb = PdfTable(Poisson(3), 0, 500000)'), 'limit');
  });
});

describe('seeded randomness (R6)', () => {
  it('the same script gives the same numbers, also after a reload', () => {
    const lines = ['d = Normal(0, 1)', 'xs = Sample(d, 20)', 'r = RandomInt(1, 6)'];
    const a = fig(lines);
    const b = fig(lines);
    expect(nums(a.value('xs'))).toEqual(nums(b.value('xs')));
    expect(a.value('r')).toBe(b.value('r'));
    const c = Figure.fromScript(a.toScript(), { commands: registry }).figure;
    expect(nums(c.value('xs'))).toEqual(nums(a.value('xs')));
  });

  it('samples are prefix-stable', () => {
    const a = nums(val(['d = Gamma(2, 1)'], 'xs = Sample(d, 5)'));
    const b = nums(val(['d = Gamma(2, 1)'], 'xs = Sample(d, 12)'));
    expect(b.slice(0, 5)).toEqual(a);
    const f = fig(['n = 4', 'xs = Sample(Binomial(100, 0.3), n)']);
    const first = nums(f.value('xs'));
    ok(f.apply('n = 9'));
    expect(nums(f.value('xs')).slice(0, 4)).toEqual(first);
  });

  it('the name, the seed argument, @seed and the re-roll count each change the numbers', () => {
    const base = nums(val([], 'xs = Sample(Normal(0, 1), 5)'));
    expect(nums(val([], 'ys = Sample(Normal(0, 1), 5)'))).not.toEqual(base);
    expect(nums(val([], 'xs = Sample(Normal(0, 1), 5, seed = 7)'))).not.toEqual(base);
    expect(nums(val(['@seed 42'], 'xs = Sample(Normal(0, 1), 5)'))).not.toEqual(base);
    const f = fig(['xs = Sample(Normal(0, 1), 5)']);
    ok(f.apply('xs with reroll = 1'));
    expect(nums(f.value('xs'))).not.toEqual(base);
    ok(f.apply('Reroll(xs)'));
    const twice = nums(f.value('xs'));
    expect(twice).not.toEqual(base);
    expect(f.toScript()).toMatch(/reroll = 2/);
    const g = fig(['@seed 3', 'xs = Sample(Normal(0, 1), 5)']);
    const before = nums(g.value('xs'));
    ok(g.apply('@seed 4'));
    expect(nums(g.value('xs'))).not.toEqual(before);
  });

  it('a call inside Seq gives a new draw each time', () => {
    const xs = nums(val([], 'xs = Seq(Draw(Normal(0, 1)), k, 1, 6)'));
    expect(new Set(xs).size).toBe(6);
  });

  it('seed is named only, so RandomInt(1, 6, 10) is ten numbers', () => {
    const xs = nums(val([], 'xs = RandomInt(1, 6, 10)'));
    expect(xs.length).toBe(10);
    expect(xs.every((x) => Number.isInteger(x) && x >= 1 && x <= 6)).toBe(true);
    const r = num([], 'r = RandomInt(1, 6, seed = 3)');
    expect(Number.isInteger(r) && r >= 1 && r <= 6).toBe(true);
    const u = nums(val([], 'u = RandomReal(2, 3, 100)'));
    expect(u.every((x) => x >= 2 && x < 3)).toBe(true);
    bad(fig().apply('r = RandomInt(5, 1)'), 'bad_argument');
    bad(fig().apply('xs = Sample(Normal(0, 1), 5000000)'), 'limit');
  });

  it('sampling from a list, with and without replacement', () => {
    const xs = nums(val([], 'xs = Sample([1, 2, 3, 4, 5, 6, 7, 8], 8, false)'));
    expect([...xs].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(undef([], 'xs = Sample([1, 2, 3], 5, false)')).toBe('sample_too_large');
    expect(undef([], 'el = RandomElement(Seq(k, k, 1, 0))')).toBe('empty_list');
    expect(val([], 'el = RandomElement(["a", "b"])')).toMatch(/^[ab]$/);
  });

  it('RandomPolynomial has whole coefficients and a non-zero leading one', () => {
    const f = fig(['p = RandomPolynomial(3, -2, 2)']);
    expect(f.get('p')?.type).toBe('Function');
    const g = f.value('p') as { call1(x: number): number };
    const a = [g.call1(0), g.call1(1), g.call1(-1), g.call1(2)];
    expect(a.every(Number.isInteger)).toBe(true);
    // the third difference of a cubic is 6 times the leading coefficient
    const d3 = g.call1(3) - 3 * g.call1(2) + 3 * g.call1(1) - g.call1(0);
    expect(d3).not.toBe(0);
  });

  it('@seed must be a whole number', () => {
    bad(fig().apply('@seed abc'), 'bad_directive');
    bad(fig().apply('@seed -1.5'), 'bad_directive');
    ok(fig().apply('@seed 42 v1'));
  });

  it('samplers match their distributions', () => {
    const cases: [string, number, number][] = [
      ['Normal(2, 3)', 2, 9], ['Gamma(0.5, 2)', 0.25, 0.125], ['Gamma(4, 1)', 4, 4], ['Beta(2, 3)', 0.4, 0.04],
      ['Binomial(100, 0.3)', 30, 21], ['Binomial(20, 0.1)', 2, 1.8], ['Poisson(3)', 3, 3], ['Poisson(40)', 40, 40],
      ['NegBinomial(3, 0.4)', 4.5, 11.25], ['Geometric(0.3)', 7 / 3, 0.7 / 0.09], ['StudentT(6)', 0, 1.5], ['DiscreteUniform(1, 6)', 3.5, 35 / 12],
    ];
    for (const [d, mean, variance] of cases) {
      const xs = nums(val([], `xs = Sample(${d}, 40000)`));
      const m = xs.reduce((a, b) => a + b, 0) / xs.length;
      const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
      expect(Math.abs(m - mean)).toBeLessThan(5 * Math.sqrt(variance / xs.length));
      expect(Math.abs(v / variance - 1)).toBeLessThan(0.1);
    }
  });

  it('uniforms pass a chi-squared test', () => {
    const xs = nums(val([], 'xs = RandomReal(0, 1, 100000)'));
    const bins = new Array<number>(100).fill(0);
    for (const x of xs) bins[Math.floor(x * 100)]! += 1;
    const chi = bins.reduce((a, c) => a + (c - 1000) ** 2 / 1000, 0);
    // 99 degrees of freedom: the 99.99th percentile is about 157
    expect(chi).toBeLessThan(157);
  });
});
