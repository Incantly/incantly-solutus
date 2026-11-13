/** Statistics: regression and fits (design 7; errors 2, 3). */
import { describe, expect, it } from 'vitest';
import { apply, bad, fields, fig, nums, ok, reasonOf, undef } from './helpers';

const P = ['P = [(1, 2.1), (2, 3.9), (3, 6.2), (4, 7.8), (5, 10.1)]'];
const close = (a: unknown, b: number, tol = 1e-9): void => expect(Math.abs((a as number) - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe('the Fit record (design 7.1)', () => {
  it('FitLine: coefficients, R², standard errors, equation', () => {
    const f = fields(P, 'fit = FitLine(P)');
    const [a, b] = nums(f['params']);
    close(a, 1.99);
    close(b, 0.05);
    close(f['r2'], 0.997305328900977);
    close(nums(f['stderr'])[0], 0.059721576223897795);
    close(nums(f['stderr'])[1], 0.19807406022327906);
    expect([f['n'], f['dof'], f['model'], f['space'], f['iterations']]).toEqual([5, 3, 'line', 'data', 0]);
    expect(f['names']).toEqual(['a', 'b']);
    expect(f['equation']).toBe('y = 1.99 x + 0.05');
    expect(nums(f['residuals']).length).toBe(5);
  });

  it('fields read by name, f is a function, the summary shows the equation', () => {
    const g = fig(P);
    ok(g.apply('fit = FitLine(P)'));
    ok(g.apply('r = fit.r2'));
    ok(g.apply('y0 = fit.f(10)'));
    close(g.value('y0'), 19.95);
    bad(g.apply('w = fit.r_squared'), 'unknown_field');
    expect(JSON.stringify(apply(P, 'fit = FitLine(P)'))).toMatch(/Fit line: y = 1\.99 x \+ 0\.05, R² 0\.9973/);
  });

  it('two lists work like points', () => {
    close(nums(fields([], 'fit = FitLine([1, 2, 3], [2, 4, 6.5])')['params'])[0], 2.25);
  });
});

describe('fit commands (design 7.2)', () => {
  it('FitPoly matches the least-squares polynomial', () => {
    const f = fields(P, 'q = FitPoly(P, 2)');
    const c = nums(f['params']);
    close(c[0], 0.02142857142857, 1e-8);
    close(c[1], 1.86142857142857, 1e-8);
    close(c[2], 0.2, 1e-8);
  });

  it('FitPoly degree outside 0..12 is bad_argument at check time', () => {
    const e = bad(fig(P).apply('q = FitPoly(P, 15)'), 'bad_argument');
    expect(e.message).toMatch(/0 to 12/);
    bad(fig(P).apply('q = FitPoly(P, 2.5)'), 'bad_argument');
  });

  it('too few distinct x is too_few_values; all x equal is degenerate_x', () => {
    expect(undef(['Q = [(1, 1), (2, 2), (3, 3)]'], 'q = FitPoly(Q, 3)')).toBe('too_few_values');
    expect(undef(['Q = [(1, 1), (1, 2), (1, 3)]'], 'q = FitLine(Q)')).toBe('degenerate_x');
  });

  it('FitLineX is x on y', () => {
    const f = fields(['Q = [(1, 1), (1, 2), (1, 3)]'], 'q = FitLineX(Q)');
    expect(nums(f['params'])).toEqual([0, 1]);
    expect(f['equation']).toBe('x = 1');
  });

  it('FitExp recovers exact data; log space on request', () => {
    const S = ['E = Map(Range(0, 5), k, (k, 3 exp(0.4 k)))'];
    const f = fields(S, 'ef = FitExp(E)');
    close(nums(f['params'])[0], 3, 1e-8);
    close(nums(f['params'])[1], 0.4, 1e-8);
    const r = apply(S, 'ef = FitExp(E, space = "log")');
    ok(r);
    expect(JSON.stringify(r)).toMatch(/log_space_bias/);
    expect(fields(S, 'ef = FitExp(E, space = "log")')['space']).toBe('log');
    bad(fig(S).apply('ef = FitExp(E, space = "ln")'), 'bad_option');
  });

  it('FitPow and FitGrowth', () => {
    const pw = fields(['W = Map(Range(1, 6), k, (k, 2 k^1.5))'], 'w = FitPow(W)');
    close(nums(pw['params'])[1], 1.5, 1e-8);
    const g = fields(['G = Map(Range(0, 5), k, (k, 5 * 2^k))'], 'g = FitGrowth(G)');
    close(nums(g['params'])[0], 5, 1e-8);
    close(nums(g['params'])[1], 2, 1e-8);
    expect(undef(['W = [(-1, 2), (2, 3)]'], 'w = FitPow(W)')).toBe('out_of_domain');
  });

  it('FitLog', () => {
    const f = fields(['L = Map(Range(1, 6), k, (k, 1 + 2 ln(k)))'], 'f = FitLog(L)');
    close(nums(f['params'])[0], 1, 1e-10);
    close(nums(f['params'])[1], 2, 1e-10);
    expect(undef(['L = [(0, 1), (1, 2)]'], 'f = FitLog(L)')).toBe('out_of_domain');
  });

  it('FitSin finds the frequency', () => {
    const f = fields(['S = Map(Range(0, 40), k, (k / 4, 1 + 2 sin(1.3 k / 4 + 0.5)))'], 's = FitSin(S)');
    const [a, b, c, d] = nums(f['params']);
    close(a, 1, 1e-6);
    close(b, 2, 1e-6);
    close(c, 1.3, 1e-6);
    close(d, 0.5, 1e-6);
    expect(undef([], 's = FitSin([(1, 2), (2, 3), (3, 1)])')).toBe('too_few_values');
  });

  it('FitLogistic', () => {
    const f = fields(['G = Map(Range(-5, 5), k, (k, 10 / (1 + 2 exp(-0.8 k))))'], 'g = FitLogistic(G)');
    const [a, b, c] = nums(f['params']);
    close(a, 10, 1e-6);
    close(b, 2, 1e-6);
    close(c, 0.8, 1e-6);
  });

  it('Fit with a basis of functions; a dependent basis is singular_fit', () => {
    const S = ['B = Map(Range(0, 6), k, (k, 3 sin(k) + 2 cos(k)))', 'f1(x) = sin(x)', 'f2(x) = cos(x)', 'f3(x) = 2 sin(x)'];
    const f = fields(S, 'b = Fit(B, [f1, f2])');
    close(nums(f['params'])[0], 3, 1e-10);
    close(nums(f['params'])[1], 2, 1e-10);
    expect(undef(S, 'b = Fit(B, [f1, f3])')).toBe('singular_fit');
  });

  it('FitModel from start values; the arity is checked against a literal start', () => {
    const S = ['M = Map(Range(0, 8), k, (k, 4 exp(-0.3 k) + 1))', 'm(x, a, b, c) = a * exp(-b * x) + c', 'g(x, a) = a * x'];
    const f = fields(S, 'fm = FitModel(M, m, [1, 0.1, 0])');
    const [a, b, c] = nums(f['params']);
    close(a, 4, 1e-6);
    close(b, 0.3, 1e-6);
    close(c, 1, 1e-6);
    bad(fig(S).apply('fm = FitModel(M, g, [1, 2])'), 'bad_argument');
  });

  it('an exact fit has no standard errors (no_dof) but is defined', () => {
    const f = fig(['Q = [(1, 1), (2, 3)]']);
    ok(f.apply('q = FitLine(Q)'));
    ok(f.apply('se = q.stderr'));
    expect(reasonOf(f, 'se')).toBeDefined();
    ok(f.apply('r = q.r2'));
    expect(f.value('r')).toBe(1);
  });

  it('weights change the fit', () => {
    const a = nums(fields([], 'f = FitLine([(0, 0), (1, 1), (2, 5)], weights = [1, 1, 0])')['params']);
    close(a[0], 1);
    close(a[1], 0);
    expect(undef([], 'f = FitLine([(0, 0), (1, 1)], weights = [1, -1])')).toBe('bad_weights');
  });

  it('CorrTest', () => {
    const r = fields(P, 'c = CorrTest(P)');
    close(r['estimate'], Math.sqrt(0.997305328900977), 1e-12);
    expect(r['df']).toBe(3);
    expect(r['p'] as number).toBeLessThan(0.001);
  });
});
