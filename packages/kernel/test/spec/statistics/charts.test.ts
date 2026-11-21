/** Statistics: charts as records of the numbers behind them (design 6; errors 3, 4). */
import { describe, expect, it } from 'vitest';
import { apply, bad, fields, fig, nums, ok, rec, undef, val } from './helpers';

describe('Histogram', () => {
  it('equal classes from data give counts', () => {
    const h = fields([], 'h = Histogram([0, 10, 20], [1, 2, 15, 20])');
    expect(nums(h['counts'])).toEqual([2, 2]);
    expect(nums(h['heights'])).toEqual([2, 2]);
    expect([h['scale'], h['total'], h['binWidth'], h['outside'], h['n']]).toEqual(['count', 4, 10, 0, 4]);
  });

  it('unequal classes default to density and say so (design 3.3, errors 4)', () => {
    const r = apply([], 'h = Histogram([0, 10, 30], [1, 2, 15, 20])');
    ok(r);
    expect(JSON.stringify(r)).toMatch(/unequal_classes/);
    const h = fields([], 'h = Histogram([0, 10, 30], [1, 2, 15, 20])');
    expect(h['scale']).toBe('density');
    expect(nums(h['heights'])).toEqual([2 / 4 / 10, 2 / 4 / 20]);
    expect(h['total']).toBeCloseTo(1, 12);
  });

  it('a list one shorter than the edges is heights', () => {
    const h = fields([], 'h = Histogram([0, 1, 2, 3], [5, 7, 2])');
    expect(nums(h['heights'])).toEqual([5, 7, 2]);
  });

  it('automatic classes, a bin count, and the scale option', () => {
    const h = fields([], 'h = Histogram([1, 2, 2, 3, 3, 3])');
    expect(nums(h['edges'])).toEqual([0.5, 1.5, 2.5, 3.5]);
    expect(nums(h['counts'])).toEqual([1, 2, 3]);
    const b = fields([], 'h = Histogram([0, 1, 2, 3, 4], 2, scale = "relative")');
    expect(nums(b['heights'])).toEqual([0.4, 0.6]);
    bad(fig().apply('h = Histogram([1, 2], scale = "percent")'), 'bad_option');
  });

  it('values outside the edges are reported, edges out of order are bad_edges', () => {
    expect(fields([], 'h = Histogram([0, 10], [5, 50])')['outside']).toBe(1);
    expect(undef([], 'h = Histogram([0, 10, 5], [1, 2, 3, 4])')).toBe('bad_edges');
  });

  it('a histogram of no data is defined with n = 0 (design 6)', () => {
    expect(fields([], 'h = Histogram(Filter([1], k, k > 2))')['n']).toBe(0);
  });

  it('the summary lists the classes and counts (agent 2)', () => {
    expect(JSON.stringify(apply([], 'h = Histogram([0, 10, 20], [1, 2, 15])'))).toMatch(/Histogram 2 classes \[0, 20\], counts 2 1, heights are counts/);
  });
});

describe('other charts', () => {
  it('BarChart forms', () => {
    expect(nums(fields([], 'b = BarChart([3, 5])')['xs'])).toEqual([1, 2]);
    expect(fields([], 'b = BarChart(["a", "b"], [3, 5])')['labels']).toEqual(['a', 'b']);
    const d = fields([], 'b = BarChart([1, 1, 2, 5], 0.5)');
    expect([nums(d['xs']), nums(d['heights']), d['width']]).toEqual([[1, 2, 5], [2, 1, 1], 0.5]);
    expect(nums(fields([], 'b = BarChart(k^2, k, 1, 3)')['heights'])).toEqual([1, 4, 9]);
  });

  it('BoxPlot: five numbers by halves, Tukey whiskers with outliers', () => {
    const b = fields([], 'b = BoxPlot(1, 0.5, [1, 2, 3, 4, 5, 6, 40])');
    expect([b['min'], b['q1'], b['median'], b['q3'], b['max']]).toEqual([1, 2, 4, 6, 40]);
    const t = fields([], 'b = BoxPlot(1, 0.5, [1, 2, 3, 4, 5, 6, 40], whisker = "tukey")');
    expect([t['max'], nums(t['outliers'])]).toEqual([6, [40]]);
    expect(JSON.stringify(apply([], 'b = BoxPlot(1, 0.5, [1, 2, 3, 4, 5, 6, 40], "tukey")'))).toMatch(/1 outlier \(40\)/);
    const n = fields([], 'b = BoxPlot(0, 1, 2, 4, 5, 7, 9)');
    expect([n['q1'], n['iqr']]).toEqual([4, 3]);
  });

  it('BoxPlots stacks one plot per list', () => {
    const b = fields([], 'b = BoxPlots([[1, 2, 3], [4, 5, 6]], ["A", "B"])');
    expect((b['plots'] as unknown[]).length).toBe(2);
    expect(b['labels']).toEqual(['A', 'B']);
  });

  it('DotPlot stacks dots; StemPlot writes stems and leaves', () => {
    const d = fields([], 'd = DotPlot([1, 2, 2, 2])');
    expect(d['dots']).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 2, y: 3 }]);
    const s = fields([], 's = StemPlot([12, 15, 21, 23, 37])');
    expect(nums(s['stems'])).toEqual([1, 2, 3]);
    expect(s['leaves']).toEqual(['25', '13', '7']);
    expect(String(s['text'])).toMatch(/1 \| 25/);
  });

  it('PieChart fractions and angles; a negative value is negative_value', () => {
    const p = fields([], 'p = PieChart([1, 3])');
    expect(nums(p['fractions'])).toEqual([0.25, 0.75]);
    expect(nums(p['angles'])[0]).toBeCloseTo(Math.PI / 2, 12);
    expect(undef([], 'p = PieChart([1, -3])')).toBe('negative_value');
    bad(fig().apply('p = PieChart([1, 2, 3], ["a", "b"])'), 'bad_argument');
  });

  it('line, step and stick graphs sort by x; residual plot and squares', () => {
    expect(fields([], 'g = LineGraph([(2, 1), (1, 5)])')['points']).toEqual([{ x: 1, y: 5 }, { x: 2, y: 1 }]);
    const S = ['P = [(1, 3), (2, 3)]', 'f(x) = 2x'];
    expect(fields(S, 'r = ResidualPlot(P, f)')['points']).toEqual([{ x: 1, y: 1 }, { x: 2, y: -1 }]);
    const sq = val(S, 'sq = Squares(P, f)') as { pts: { x: number; y: number }[] }[];
    expect(sq.length).toBe(2);
    expect(sq[0]?.pts).toEqual([{ x: 1, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 2 }]);
  });

  it('NormalQuantilePlot uses (i - 0.375) / (n + 0.25)', () => {
    const q = fields([], 'q = NormalQuantilePlot([3, 1, 2])');
    expect(nums(q['x'])).toEqual([1, 2, 3]);
    expect(nums(q['z'])[1]).toBeCloseTo(0, 12);
    expect(q['r'] as number).toBeGreaterThan(0.99);
  });

  it('FrequencyPolygon from a histogram, and an ogive', () => {
    const f = fig(['h = Histogram([0, 10, 20], [1, 2, 15])']);
    ok(f.apply('p = FrequencyPolygon(h)'));
    expect(rec(f.value('p')).fields['points']).toEqual([{ x: -5, y: 0 }, { x: 5, y: 2 }, { x: 15, y: 1 }, { x: 25, y: 0 }]);
    ok(f.apply('o = FrequencyPolygon(h, cumulative = true)'));
    expect(rec(f.value('o')).fields['points']).toEqual([{ x: 0, y: 0 }, { x: 10, y: 2 }, { x: 20, y: 3 }]);
  });
});
