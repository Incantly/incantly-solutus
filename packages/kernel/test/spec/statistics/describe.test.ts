/** Statistics: describing one list and two lists, frequencies, classes and tables (design 3, 4, 5; errors 3). */
import { describe, expect, it } from 'vitest';
import { apply, bad, fields, fig, num, nums, ok, rec, undef, val } from './helpers';

const D = ['data = [4, 7, 8, 8, 9, 10, 12, 15, 21]'];
const close = (a: number, b: number, tol = 1e-12): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe('one list (design 4)', () => {
  it('centre and spread', () => {
    close(num(D, 'm = Mean(data)'), 10.444444444444445);
    expect(num(D, 'md = Median(data)')).toBe(9);
    close(num(D, 'v = Variance(data)'), 22.469135802469136);
    close(num(D, 'sv = SampleVariance(data)'), 25.27777777777778);
    close(num(D, 's = StdDev(data)'), Math.sqrt(22.469135802469136));
    close(num(D, 'ss = SampleStdDev(data)'), Math.sqrt(25.27777777777778));
    expect(num(D, 'r = DataRange(data)')).toBe(17);
    close(num(D, 'k = Skewness(data)'), 0.9739341429551928, 1e-10);
    close(num(D, 'k = Kurtosis(data)'), 3.2555162419997585, 1e-10);
    close(num(D, 'g = GeometricMean(data)'), 9.464967914258818);
    close(num(D, 'h = HarmonicMean(data)'), 8.558490566037735);
    expect(num(D, 'a = MedianAbsDev(data)')).toBe(2);
    close(num(D, 'q = Rms([3, 4])'), Math.sqrt(12.5));
    close(num(D, 'q = Sxx(data)'), 22.469135802469136 * 9);
    expect(num(D, 'q = SumSq([1, 2, 3])')).toBe(14);
  });

  it('Mode returns every most frequent value, ascending', () => {
    expect(nums(val([], 'm = Mode([3, 1, 3, 1, 2])'))).toEqual([1, 3]);
    expect(JSON.stringify(apply([], 'm = Mode([1, 2, 3])'))).toMatch(/no_repeated_value/);
  });

  it('quartiles default to halves; hinges, linear, exclusive and nearest on request (design 3.3)', () => {
    expect(num(D, 'a = Q1(data)')).toBe(7.5);
    expect(num(D, 'a = Q3(data)')).toBe(13.5);
    expect(num(D, 'a = IQR(data)')).toBe(6);
    expect(num(D, 'a = Q1(data, method = "hinges")')).toBe(8);
    expect(num(D, 'a = Q3(data, "hinges")')).toBe(12);
    close(num(D, 'a = Quantile(data, 0.9)'), 16.2);
    expect(num(D, 'a = Quantile(data, 0.9, method = "exclusive")')).toBe(21);
    expect(num(D, 'a = Quantile(data, 0.9, method = "nearest")')).toBe(21);
    expect(nums(val(D, 'a = Quantile(data, [0, 0.5, 1])'))).toEqual([4, 9, 21]);
  });

  it('a method outside the set is bad_option with the allowed values (errors 2)', () => {
    const e = bad(fig(D).apply('a = Quantile(data, 0.5, method = "R7")'), 'bad_option');
    expect(e.message).toMatch(/halves/);
    bad(fig(D).apply('a = Q1(data, "middle")'), 'bad_option');
  });

  it('p outside [0, 1] is bad_argument', () => {
    bad(fig(D).apply('a = Quantile(data, 1.5)'), 'bad_argument');
  });

  it('FiveNumber and Describe are records', () => {
    const f = fields(D, 'f = FiveNumber(data)');
    expect([f['min'], f['q1'], f['median'], f['q3'], f['max'], f['method']]).toEqual([4, 7.5, 9, 13.5, 21, 'halves']);
    const d = fields(D, 'd = Describe(data)');
    expect(d['n']).toBe(9);
    close(d['mean'] as number, 10.444444444444445);
    expect(nums(d['mode'])).toEqual([8]);
    expect(d['iqr']).toBe(6);
    close(d['sampleSd'] as number, Math.sqrt(25.27777777777778));
    const f2 = fig(D);
    ok(f2.apply('d = Describe(data)'));
    ok(f2.apply('s = d.sd'));
    close(f2.value('s') as number, Math.sqrt(22.469135802469136));
    bad(f2.apply('w = d.stdev'), 'unknown_field');
  });

  it('frequencies are never expanded and give the same answers (design 3.2)', () => {
    const S = ['v = [1, 2, 3]', 'f = [2, 1, 3]'];
    const raw = ['r = [1, 1, 2, 3, 3, 3]'];
    expect(num(S, 'c = Count(v, f)')).toBe(6);
    expect(num(S, 's = Sum(v, f)')).toBe(13);
    close(num(S, 'm = Mean(v, f)'), num(raw, 'm = Mean(r)'));
    close(num(S, 'm = Variance(v, f)'), num(raw, 'm = Variance(r)'));
    close(num(S, 'm = SampleStdDev(v, f)'), num(raw, 'm = SampleStdDev(r)'));
    expect(num(S, 'm = Median(v, f)')).toBe(num(raw, 'm = Median(r)'));
    expect(num(S, 'm = Q1(v, f)')).toBe(num(raw, 'm = Q1(r)'));
    expect(nums(val(S, 'm = Mode(v, f)'))).toEqual([3]);
    expect(rec(val(S, 'd = Describe(v, f)')).fields['n']).toBe(6);
  });

  it('bad frequencies are bad_weights; unequal lengths size_mismatch', () => {
    expect(undef(['v = [1, 2]'], 'm = Mean(v, [1, -1])')).toBe('bad_weights');
    expect(undef(['v = [1, 2]'], 'm = Mean(v, [1, 0.5])')).toBe('bad_weights');
    expect(undef(['v = [1, 2]'], 'm = Mean(v, [1, 2, 3])')).toBe('size_mismatch');
  });

  it('ranks, z-scores, rescaling and outliers', () => {
    expect(nums(val([], 'r = Rank([10, 20, 20, 5])'))).toEqual([2, 3.5, 3.5, 1]);
    expect(nums(val([], 'r = RankOrdinal([10, 20, 20, 5])'))).toEqual([2, 3, 4, 1]);
    expect(nums(val([], 'zs = ZScores([1, 3])'))).toEqual([-1, 1]);
    expect(nums(val([], 'rs = Rescale([2, 4, 6], 0, 1)'))).toEqual([0, 0.5, 1]);
    expect(nums(val([], 'o = Outliers([1, 2, 3, 4, 5, 6, 40])'))).toEqual([40]);
  });

  it('undefined reasons (errors 3)', () => {
    expect(undef([], 'm = Mean(Filter([1, 2], k, k > 5))')).toBe('empty_list');
    expect(undef([], 's = SampleVariance([3])')).toBe('too_few_values');
    expect(undef([], 'g = GeometricMean([1, -2])')).toBe('out_of_domain');
    expect(undef([], 'h = HarmonicMean([1, 0])')).toBe('out_of_domain');
    expect(undef([], 'zs = ZScores([4, 4, 4])')).toBe('zero_variance');
  });

  it('variance stays accurate for large offsets (design 10.1)', () => {
    const f = fig(['L = Map(Range(1, 1000), k, 1000000000 + k - 2 floor(k / 2))']);
    ok(f.apply('v = Variance(L)'));
    close(f.value('v') as number, 0.25, 1e-10);
  });

  it('the Describe summary names the numbers (agent 2)', () => {
    const r = apply(D, 'd = Describe(data)');
    expect(JSON.stringify(r)).toMatch(/Describe n 9, mean 10\.44/);
  });
});

describe('two lists (design 4)', () => {
  const P = ['P = [(1, 2.1), (2, 3.9), (3, 6.2), (4, 7.8), (5, 10.1)]'];
  it('correlation, covariance and sums of products from points or two lists', () => {
    close(num(P, 'r = Correlation(P)') ** 2, 0.997305328900977);
    close(num(P, 'r = Correlation(Xs(P), Ys(P))'), num(P, 'r = Correlation(P)'));
    close(num(P, 'c = Covariance(P)'), num(P, 'c = Sxy(P)') / 5);
    close(num(P, 'c = SampleCovariance(P)'), num(P, 'c = Sxy(P)') / 4);
    expect(num([], 's = SumProd([1, 2], [3, 4])')).toBe(11);
    close(num([], 's = Spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7])'), 0.8207826816681233);
  });

  it('a constant list is zero_variance; unequal lengths size_mismatch', () => {
    expect(undef([], 'r = Correlation([1, 2, 3], [4, 4, 4])')).toBe('zero_variance');
    expect(undef([], 'r = Correlation([1, 2, 3], [4, 5])')).toBe('size_mismatch');
  });

  it('RSquare, SumSquaredErrors and Residuals of a function', () => {
    const S = [...P, 'f(x) = 2x'];
    expect(nums(val(S, 'r = Residuals(P, f)')).map((v) => Number(v.toFixed(10)))).toEqual([0.1, -0.1, 0.2, -0.2, 0.1]);
    close(num(S, 's = SumSquaredErrors(P, f)'), 0.11);
    expect(num(S, 'r = RSquare(P, f)')).toBeGreaterThan(0.99);
  });

  it('Describe(points) has both variables', () => {
    const d = fields(P, 'd = Describe(P)');
    expect(d['n']).toBe(5);
    expect(rec(d['x']).fields['mean']).toBe(3);
    close(d['r2'] as number, 0.997305328900977);
  });
});

describe('frequency, classes and tables (design 5)', () => {
  it('Classes: whole numbers with a small range get one class per value', () => {
    expect(nums(val([], 'c = Classes([1, 2, 2, 3])'))).toEqual([0.5, 1.5, 2.5, 3.5]);
  });

  it('Classes: nice widths otherwise, covering the data', () => {
    const e = nums(val(['L = Map(Range(1, 100), k, k * 1.37)'], 'c = Classes(L)'));
    const w = (e[1] as number) - (e[0] as number);
    expect([1, 2, 5].some((m) => Math.abs(w / 10 ** Math.floor(Math.log10(w)) - m) < 1e-9)).toBe(true);
    expect(e[0]).toBeLessThanOrEqual(1.37);
    expect(e[e.length - 1]).toBeGreaterThanOrEqual(137);
  });

  it('Classes with a count, ClassesByWidth', () => {
    expect(nums(val([], 'c = Classes([0, 10], 5)'))).toEqual([0, 2, 4, 6, 8, 10]);
    expect(nums(val([], 'c = ClassesByWidth([3, 17], 5)'))).toEqual([0, 5, 10, 15, 20]);
    bad(fig().apply('c = Classes([1, 2], 0)'), 'bad_argument');
  });

  it('Frequency counts left-closed classes, the last closed; right on request', () => {
    expect(nums(val([], 'f = Frequency([0, 10, 20], [0, 5, 10, 20])'))).toEqual([2, 2]);
    expect(nums(val([], 'f = Frequency([0, 10, 20], [0, 5, 10, 20], "right")'))).toEqual([3, 1]);
    expect(nums(val([], 'f = Frequency([0, 10, 20], [1, 2, 15, 30], scale = "relative")'))).toEqual([2 / 3, 1 / 3]);
    expect(nums(val([], 'f = Frequency([0, 10, 20], [1, 2, 15], cumulative = true)'))).toEqual([2, 3]);
  });

  it('edges out of order are bad_edges', () => {
    expect(undef([], 'f = Frequency([0, 10, 5], [1])')).toBe('bad_edges');
  });

  it('FrequencyTable, ContingencyTable and Table', () => {
    const t = fields([], 'ft = FrequencyTable([0, 10, 20], [1, 2, 15])');
    expect(t['rows']).toBe(2);
    expect(t['titles']).toEqual(['class', 'count', 'relative', 'cumulative', 'cumulative relative']);
    const c = fields([], 'c = ContingencyTable(["a", "b", "a"], [1, 1, 2])');
    expect(c['rowLabels']).toEqual(['a', 'b']);
    const tab = fields([], 'T = Table(["x", "y"], [1, 2], [3, 4])');
    expect([tab['rows'], tab['cols']]).toEqual([2, 2]);
    expect(undef([], 'T = Table(["x", "y"], [1, 2], [3])')).toBe('size_mismatch');
  });
});
