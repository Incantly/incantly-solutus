/** Statistics: hypothesis tests, intervals and the distribution functions behind them (design 8, 10.3; errors 2-4). */
import { describe, expect, it } from 'vitest';
import { chiSqSf, fSf, normalQuantile, normalSf, tQuantile, tSf } from '@incantly/kernel';
import { apply, bad, fields, fig, undef } from './helpers';

const rel = (a: unknown, b: number, tol = 1e-10): void => expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(tol * Math.max(1e-300, Math.abs(b)));
const S = ['s = [5.1, 4.9, 5.6, 5.8, 6.0, 5.4, 5.2, 5.9]'];
const AB = ['a = [20, 22, 19, 24, 25]', 'b = [28, 27, 30, 26, 29, 31]'];

describe('distribution functions (design 10.3)', () => {
  it('match reference values', () => {
    rel(2 * normalSf(1.96), 0.04999579029644087, 1e-12);
    rel(normalQuantile(0.975), 1.959963984540054, 1e-14);
    rel(tQuantile(0.975, 7), 2.364624251592784, 1e-12);
    rel(chiSqSf(3.84, 1), 0.050043521248705085, 1e-12);
    rel(fSf(4, 2, 10), 0.052922149401344654, 1e-12);
    rel(tSf(2.5, 3.3), 0.04002641815417723, 1e-12);
  });
});

describe('tests (design 8.2)', () => {
  it('TTest: statistic, p and df by name, tails and signs', () => {
    const r = fields(S, 'r = TTest(s, 5)');
    rel(r['statistic'], 3.433758534669932);
    rel(r['p'], 0.010929323814770681);
    expect([r['df'], r['tail'], r['n']]).toEqual([7, 'two', 8]);
    rel(fields(S, 'r = TTest(s, 5, "right")')['p'], 0.0054646619073853405);
    rel(fields(S, 'r = TTest(s, 5, ">")')['p'], 0.0054646619073853405);
    expect(fields(S, 'r = TTest(s, 5, "<")')['tail']).toBe('left');
  });

  it('a tail outside the set is bad_option naming the allowed words (errors 5)', () => {
    const e = bad(fig(S).apply('r = TTest(s, 5, "larger")'), 'bad_option');
    expect(e.message).toMatch(/"two", "left", "right"/);
  });

  it('TTest2 is Welch by default, pooled on request; TTestPaired', () => {
    const w = fields(AB, 'r = TTest2(a, b)');
    rel(w['statistic'], -4.736415133683288);
    rel(w['p'], 0.0019384443391590018, 1e-9);
    rel(w['df'], 7.230464326160814);
    const p = fields(AB, 'r = TTest2(a, b, pooled = true)');
    rel(p['statistic'], -4.88263508690231);
    rel(p['p'], 0.000868214295724629, 1e-9);
    const pr = fields([], 'r = TTestPaired([10, 12, 9, 11], [12, 13, 9, 14])');
    rel(pr['statistic'], -2.32379000772445);
    rel(pr['p'], 0.10272807885839899, 1e-9);
  });

  it('summary-number forms match the data forms', () => {
    const d = fields(S, 'r = TTest(s, 5)');
    const m = (d['estimate'] as number).toString();
    const sd = ((d['se'] as number) * Math.sqrt(8)).toString();
    rel(fields([], `r = TTest(${m}, ${sd}, 8, 5)`)['p'], d['p'] as number, 1e-9);
    rel(fields([], 'r = ZTest(105, 15, 36, 100, "right")')['statistic'], 2);
  });

  it('proportion tests, with the weak-approximation warning', () => {
    const r = fields([], 'r = ZPropTest(60, 100, 0.5)');
    rel(r['statistic'], 2);
    expect(JSON.stringify(apply([], 'r = ZPropTest(3, 10, 0.5)'))).toMatch(/normal_approx_weak/);
    expect(undef([], 'r = ZPropTest(12, 10, 0.5)')).toBe('bad_parameter');
    expect(fields([], 'r = ZPropTest2(30, 50, 20, 50)')['estimate']).toBeCloseTo(0.2, 12);
  });

  it('chi-squared: independence and goodness of fit, low expected counts warn', () => {
    const c = fields([], 'r = ChiSquaredTest(Matrix([[10, 20], [30, 40]]))');
    rel(c['statistic'], 0.7936507936507936);
    rel(c['p'], 0.37299848361348686, 1e-9);
    expect(c['df']).toBe(1);
    const g = fields([], 'r = ChiSquaredTest([18, 22, 20, 40], [25, 25, 25, 25])');
    rel(g['statistic'], 12.32);
    rel(g['p'], 0.006363629995195272, 1e-9);
    expect(JSON.stringify(apply([], 'r = ChiSquaredTest(Matrix([[1, 2], [3, 4]]))'))).toMatch(/expected_count_low/);
    expect(undef([], 'r = ChiSquaredTest(Matrix([[0, 0], [3, 4]]))')).toBe('cells_empty');
  });

  it('ANOVA', () => {
    const r = fields([], 'r = ANOVA([[1, 2, 3], [4, 5, 6], [7, 8, 10]])');
    rel(r['F'], 20.846153846153854);
    rel(r['p'], 0.001991171830418581, 1e-9);
    expect([r['dfBetween'], r['dfWithin']]).toEqual([2, 6]);
    expect(undef([], 'r = ANOVA([[1, 2, 3]])')).toBe('groups_too_few');
  });

  it('the summary names the test, tail, statistic and p (agent 2)', () => {
    expect(JSON.stringify(apply(S, 'r = TTest(s, 5)'))).toMatch(/TTest two-tailed: t 3\.434, df 7, p 0\.01093/);
  });
});

describe('intervals (design 8.3)', () => {
  it('TInterval at 95 % by default', () => {
    const r = fields(S, 'r = TInterval(s)');
    rel(r['lo'], 5.151787890073701);
    rel(r['hi'], 5.823212109926299);
    expect([r['level'], r['df']]).toEqual([0.95, 7]);
  });

  it('ZInterval from summary numbers; a level outside (0, 1) is bad_argument', () => {
    const r = fields([], 'r = ZInterval(50, 10, 100, 0.95)');
    rel(r['margin'], 1.959963984540054 * 1, 1e-12);
    bad(fig(S).apply('r = ZInterval(s, 2, 1.5)'), 'bad_argument');
  });

  it('proportion intervals: Wald and Wilson', () => {
    const w = fields([], 'r = ZPropInterval(40, 100)');
    rel(w['margin'], 1.959963984540054 * Math.sqrt(0.24 / 100), 1e-12);
    const n = 100;
    const z = 1.959963984540054;
    const centre = (0.4 + (z * z) / (2 * n)) / (1 + (z * z) / n);
    rel(fields([], 'r = ZPropInterval(40, 100, method = "wilson")')['estimate'], centre, 1e-12);
  });

  it('two-sample intervals agree with the tests', () => {
    const t = fields(AB, 'r = TInterval2(a, b)');
    expect(t['hi'] as number).toBeLessThan(0);
    rel(t['df'], 7.230464326160814);
    expect(fields([], 'r = TIntervalPaired([10, 12, 9, 11], [12, 13, 9, 14])')['estimate']).toBe(-1.5);
  });
});
