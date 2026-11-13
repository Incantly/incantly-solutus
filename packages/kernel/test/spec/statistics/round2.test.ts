/** Statistics round 2: chart and table types, distributions in results, bands, implicit fits, columns. */
import { describe, expect, it } from 'vitest';
import { apply, bad, fields, fig, nums, ok, rec, undef, val } from './helpers';

const close = (a: unknown, b: number, tol = 1e-9): void => expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe('chart and table types', () => {
  it('a chart is a Chart<Schema> and a table a Table', () => {
    const r = apply([], 'h = Histogram([1, 2, 2, 3])');
    ok(r);
    if (r.ok) expect((r as { type?: string }).type).toBe('Chart');
    const f = fig(['h = Histogram([1, 2, 2, 3])']);
    ok(f.apply('n = h.total'));
    expect(f.value('n')).toBe(4);
    bad(f.apply('w = h.width'), 'unknown_field');
    const t = fig(['T = Table(["x", "y"], [1, 2], [3, 4])']);
    ok(t.apply('c = Column(T, "y")'));
    expect(nums(t.value('c'))).toEqual([3, 4]);
    ok(t.apply('r = T.rows'));
    expect(t.value('r')).toBe(2);
  });

  it('a Chart<Histogram> parameter refuses another chart', () => {
    bad(fig(['b = BarChart([1, 2])']).apply('p = FrequencyPolygon(b)'), 'no_matching_form');
  });
});

describe('distributions in results (design 8.1)', () => {
  it('a test carries the distribution of its statistic', () => {
    const f = fig(['s = [5.1, 4.9, 5.6, 5.8, 6.0, 5.4, 5.2, 5.9]', 'r = TTest(s, 5, "right")']);
    ok(f.apply('d = r.dist'));
    expect(JSON.stringify(apply(['s = [1, 2, 3, 4]', 'r = TTest(s, 2)'], 'd = r.dist'))).toMatch(/StudentT\(df = 3\)/);
    ok(f.apply('p = Sf(r.dist, r.statistic)'));
    close(f.value('p'), rec(f.value('r')).fields['p'] as number, 1e-12);
    ok(f.apply('area = Shade(r.dist, r.statistic, inf)'));
  });

  it('chi-squared, ANOVA and z results name their distributions', () => {
    expect(JSON.stringify(apply(['r = ChiSquaredTest([18, 22, 20, 40], [25, 25, 25, 25])'], 'd = r.dist'))).toMatch(/ChiSquared\(df = 3\)/);
    expect(JSON.stringify(apply(['r = ANOVA([[1, 2, 3], [4, 5, 6]])'], 'd = r.dist'))).toMatch(/FDist\(d1 = 1, d2 = 4\)/);
    expect(JSON.stringify(apply(['r = ZTest(105, 15, 36, 100)'], 'd = r.dist'))).toMatch(/Normal\(mu = 0, sigma = 1\)/);
  });
});

describe('probability first round', () => {
  it('evaluates the design table examples (probability design 4.4)', () => {
    close(val([], 'p = Cdf(Normal(0, 1), 1.96)'), 0.9750021048517795, 1e-14);
    close(val([], 'p = Cdf(Binomial(10, 0.5), 5)'), 0.623046875, 1e-13);
    close(val([], 'p = Pdf(Poisson(3), 2)'), 0.22404180765538775, 1e-13);
    close(val([], 'p = Cdf(Exponential(2), 1)'), 0.8646647167633873, 1e-14);
    close(val([], 'q = Quantile(Normal(100, 15), 0.9)'), 119.22327348316901, 1e-12);
    expect(val([], 'q = Quantile(Binomial(10, 0.5), 0.5)')).toBe(5);
    close(val([], 'p = Prob(Binomial(10, 0.5), 3, 5, "[)")'), (120 + 210) / 1024, 1e-12);
  });

  it('fields, moments and functions', () => {
    const f = fig(['d = Binomial(10, 0.3)']);
    ok(f.apply('m = d.mean'));
    expect(f.value('m')).toBeCloseTo(3, 12);
    ok(f.apply('s = StdDev(d)'));
    close(f.value('s'), Math.sqrt(2.1));
    ok(f.apply('g = Pdf(d)'));
    ok(f.apply('v = g(3)'));
    close(f.value('v'), 0.26682793200000005, 1e-12);
    expect(undef([], 'm = Mean(StudentT(1))')).toBe('undefined_moment');
  });

  it('literal parameters out of range are bad_argument; from objects bad_parameter', () => {
    bad(fig().apply('d = Normal(0, -1)'), 'bad_argument');
    expect(undef(['s = -1'], 'd = Normal(0, s)')).toBe('bad_parameter');
  });

  it('BarChart of a discrete distribution; a continuous one is a type error (probability R3)', () => {
    const b = fields([], 'b = BarChart(Binomial(4, 0.5))');
    expect(nums(b['xs'])).toEqual([0, 1, 2, 3, 4]);
    nums(b['heights']).forEach((h, i) => close(h, ([1, 4, 6, 4, 1][i] as number) / 16, 1e-13));
    bad(fig().apply('b = BarChart(Normal(0, 1))'), 'no_matching_form');
    expect(nums(fields([], 'b = BarChart(Poisson(2), 0, 3)')['xs'])).toEqual([0, 1, 2, 3]);
  });

  it('Shade gives the probability as the region value', () => {
    const f = fig(['d = Normal(0, 1)']);
    ok(f.apply('s = Shade(d, -1.96, 1.96)'));
    close((f.value('s') as { value: number }).value, 0.9500042097035593, 1e-12);
    // a discrete distribution gives bars with the interval picked out (probability R5.2)
    close(fields([], 's = Shade(Poisson(2), 0, 3)')['mass'] as number, 0.857123460498547, 1e-12);
  });
});

describe('bands and implicit fits (design 7.2)', () => {
  const P = ['P = [(1, 2.1), (2, 3.9), (3, 6.2), (4, 7.8), (5, 10.1)]', 'fit = FitLine(P)'];
  it('FitBand: the mean band matches the textbook formula at the mean of x', () => {
    const f = fig(P);
    ok(f.apply('band = FitBand(fit, 0.95)'));
    const r = f.value('band') as { f: (x: number) => number; g: (x: number) => number };
    // at x = mean(x) = 3 the half-width is t * s / sqrt(n)
    const s = Math.sqrt((rec(f.value('fit')).fields['sse'] as number) / 3);
    close((r.f(3) - r.g(3)) / 2, 3.182446305284263 * s / Math.sqrt(5), 1e-9);
    ok(f.apply('pb = FitBand(fit, 0.95, "prediction")'));
    const q = f.value('pb') as { f: (x: number) => number; g: (x: number) => number };
    expect(q.f(3) - q.g(3)).toBeGreaterThan(r.f(3) - r.g(3));
  });

  it('a nonlinear model has no band', () => {
    expect(undef(['E = Map(Range(0, 5), k, (k, 3 exp(0.4 k)))', 'ef = FitExp(E)'], 'b = FitBand(ef, 0.95)')).toBe('not_linear_model');
    bad(fig(P).apply('b = FitBand(fit, 0.95, "both")'), 'bad_option');
  });

  it('fits record their drawn range, 5 % beyond the data unless given', () => {
    const f = fields(P.slice(0, 1), 'fit = FitLine(P)');
    expect([f['from'], f['to']]).toEqual([0.8, 5.2]);
    const g = fields(P.slice(0, 1), 'fit = FitLine(P, from = 0, to = 10)');
    expect([g['from'], g['to']]).toEqual([0, 10]);
  });

  it('FitImplicit recovers a circle', () => {
    const f = fig(['C = Map(Range(0, 11), k, (2 + 3 cos(k * pi / 6), -1 + 3 sin(k * pi / 6)))']);
    ok(f.apply('c = FitImplicit(C, 2)'));
    const v = f.value('c') as { f: (x: number, y: number) => number; text: string };
    for (const [x, y] of [[5, -1], [2, 2], [-1, -1]] as const) expect(Math.abs(v.f(x, y))).toBeLessThan(1e-9);
    expect(Math.abs(v.f(2, -1))).toBeGreaterThan(1e-3);
    bad(f.apply('c2 = FitImplicit(C, 7)'), 'bad_argument');
  });
});

describe('large lists (design 10.1)', () => {
  it('quantiles of 5,000 mixed-sign values match a plain sort', () => {
    const f = fig(['L = Map(Range(1, 5000), k, sin(k * 7.3) * 100 - 20)']);
    ok(f.apply('q = Quantile(L, [0, 0.1, 0.5, 0.9, 1])'));
    const xs = Array.from({ length: 5000 }, (_, i) => Math.sin((i + 1) * 7.3) * 100 - 20).sort((a, b) => a - b);
    const lin = (p: number): number => {
      const h = (xs.length - 1) * p;
      const lo = Math.floor(h);
      return (xs[lo] as number) + (h - lo) * ((xs[Math.min(lo + 1, xs.length - 1)] as number) - (xs[lo] as number));
    };
    nums(f.value('q')).forEach((v, i) => close(v, lin([0, 0.1, 0.5, 0.9, 1][i] as number), 1e-12));
  });
});
