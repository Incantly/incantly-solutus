/**
 * Taylor, Iterate/IterateList/Cobweb, polynomial helpers, SlopeField, SolveODE, NSolveODE
 * (functions-calculus design.md 1, 8.5, 8.8, 8.9, 8.10; errors.md 3 and 6; agent.md lessons 3).
 */
import { describe, expect, it } from 'vitest';
import {
  ev,
  evReason,
  expectUndefined,
  fails,
  fig,
  list,
  near,
  nearPt,
  noticeCodes,
  num,
  ok,
  pts,
  reasonOf,
  setFree,
  useTimeout,
  val,
  within,
} from './helpers';

useTimeout();

describe('Taylor(f, a, n): degree-n polynomial about x = a (8.5)', () => {

  it('sin about 0 of order 5 evaluates to x - x^3/6 + x^5/120', () => {
    const f = fig(['f(x) = sin(x)', 'tp = Taylor(f, 0, 5)']);
    near(ev(f, 'tp(1)'), 1 - 1 / 6 + 1 / 120, 1e-10);
    near(ev(f, 'tp(0.5)'), 0.5 - 0.5 ** 3 / 6 + 0.5 ** 5 / 120, 1e-10);
  });

  it('exp about 0 of order 4 at 1 is 1 + 1 + 1/2 + 1/6 + 1/24', () => {
    const f = fig(['f(x) = exp(x)', 'tp = Taylor(f, 0, 4)']);
    near(ev(f, 'tp(1)'), 1 + 1 + 0.5 + 1 / 6 + 1 / 24, 1e-10);
  });

  it('order 0 is the constant f(a)', () => {
    const f = fig(['f(x) = exp(x)', 'tp = Taylor(f, 1, 0)']);
    near(ev(f, 'tp(5)'), Math.E, 1e-10);
  });

  it('ln about 1 of order 3 at 2 is 1 - 1/2 + 1/3', () => {
    const f = fig(['f(x) = ln(x)', 'tp = Taylor(f, 1, 3)']);
    near(ev(f, 'tp(2)'), 1 - 0.5 + 1 / 3, 1e-10);
  });

  it('a polynomial is reproduced exactly when the order is high enough: x^3 - 2x about 1 of order 3', () => {
    const f = fig(['f(x) = x^3 - 2 * x', 'tp = Taylor(f, 1, 3)']);
    near(ev(f, 'tp(2.7)'), 2.7 ** 3 - 5.4, 1e-9);
  });

  it('about a != 0: sqrt about 4 of order 2 matches value, slope and curvature at 4', () => {
    const f = fig(['f(x) = sqrt(x)', 'tp = Taylor(f, 4, 2)']);
    near(ev(f, 'tp(4)'), 2, 1e-10);
    near(ev(f, 'tp(5)'), 2 + 0.25 - 1 / 64, 1e-9);
  });

  it('a slider on the centre animates the polynomial: tp(a) equals sin(a)', () => {
    const f = fig(['a = 0 in -3..3 step 0.1', 'f(x) = sin(x)', 'tp = Taylor(f, a, 3)']);
    setFree(f, 'a', 1.2);
    near(ev(f, 'tp(1.2)'), Math.sin(1.2), 1e-10);
  });

  it('a slider on the order: n = 3 then n = 5', () => {
    const f = fig(['n = 3 in 0..10 step 1', 'f(x) = sin(x)', 'tp = Taylor(f, 0, n)']);
    near(ev(f, 'tp(1)'), 1 - 1 / 6, 1e-10);
    setFree(f, 'n', 5);
    near(ev(f, 'tp(1)'), 1 - 1 / 6 + 1 / 120, 1e-10);
  });

  it('a slider that makes the order negative gives undefined with bad_argument', () => {
    const f = fig(['n = 3 in -2..10 step 1', 'f(x) = sin(x)', 'tp = Taylor(f, 0, n)']);
    setFree(f, 'n', -1);
    expectUndefined(f, 'tp', 'bad_argument');
  });

  it('inline expression: Taylor(sin(x), 0, 5) (FC 14.12)', () => {
    const f = fig('tp = Taylor(sin(x), 0, 5)');
    near(ev(f, 'tp(1)'), 1 - 1 / 6 + 1 / 120, 1e-10);
  });

  it('TaylorPolynomial is an alias for Taylor', () => {
    const f = fig(['f(x) = cos(x)', 'tp = TaylorPolynomial(f, 0, 2)']);
    near(ev(f, 'tp(1)'), 0.5, 1e-10);
  });

  it('a negative literal order is a line error bad_argument', () => {
    fails(fig('f(x) = sin(x)'), 'tp = Taylor(f, 0, -1)', 'bad_argument');
  });

  it('order 100 is rejected (bad_argument or limit; the cap is 40)', () => {
    fails(fig('f(x) = sin(x)'), 'tp = Taylor(f, 0, 100)', ['bad_argument', 'limit']);
  });

});

describe('polynomial helpers: Degree, Coefficients, Polynomial, Numerator, Denominator (1)', () => {
  it('Degree of 3x^2 - 2x + 5 is 2', () => {
    const f = fig(['p(x) = 3 * x^2 - 2 * x + 5', 'd = Degree(p)']);
    expect(num(f, 'd')).toBe(2);
  });

  it('Coefficients(p): index k + 1 holds the coefficient of x^k (1-based)', () => {
    const f = fig(['p(x) = 3 * x^2 - 2 * x + 5', 'c = Coefficients(p)']);
    const c = list<number>(f, 'c');
    near(c[0] as number, 5, 1e-12);
    near(c[1] as number, -2, 1e-12);
    near(c[2] as number, 3, 1e-12);
    expect(c.length).toBe(3);
  });

  it('Coefficients of a Taylor polynomial: sin order 5 gives 0, 1, 0, -1/6, 0, 1/120', () => {
    const f = fig(['tp = Taylor(sin(x), 0, 5)', 'c = Coefficients(tp)']);
    const c = list<number>(f, 'c');
    [0, 1, 0, -1 / 6, 0, 1 / 120].forEach((v, i) => near(c[i] as number, v, 1e-9));
  });

  it('Polynomial through (0, 1), (1, 3), (2, 9) is 2x^2 + 1', () => {
    const f = fig(['q = Polynomial([(0, 1), (1, 3), (2, 9)])']);
    near(ev(f, 'q(3)'), 19, 1e-9);
    near(ev(f, 'q(0)'), 1, 1e-9);
  });

  it('Numerator and Denominator of (x^2 + 1)/(x - 1) at 3 are 10 and 2', () => {
    const f = fig(['r(x) = (x^2 + 1) / (x - 1)', 'nu = Numerator(r)', 'de = Denominator(r)']);
    near(ev(f, 'nu(3)'), 10, 1e-9);
    near(ev(f, 'de(3)'), 2, 1e-9);
  });
});

describe('Iterate, IterateList, Cobweb (8.8)', () => {
  it('Iterate(g, 8, 3) with g = x/2 is 1', () => {
    const f = fig(['g(x) = x / 2', 'v = Iterate(g, 8, 3)']);
    near(num(f, 'v'), 1, 1e-12);
  });

  it('Iterate of x^2 from 2 with 10 steps overflows to undefined (not_finite or overflow)', () => {
    const f = fig(['g(x) = x^2', 'v = Iterate(g, 2, 10)']);
    expectUndefined(f, 'v', ['not_finite', 'overflow']);
  });

  it('IterateList ends with the Iterate value and halves each step', () => {
    const f = fig(['g(x) = x / 2', 'L = IterateList(g, 8, 3)', 'v = Iterate(g, 8, 3)']);
    const L = list<number>(f, 'L');
    near(L[L.length - 1] as number, num(f, 'v'), 1e-12);
    for (let i = 1; i < L.length; i++) near((L[i] as number) / (L[i - 1] as number), 0.5, 1e-12);
  });

  it('Cobweb returns 2n + 1 points: (x0, 0), (x0, f(x0)), (f(x0), f(x0)), ...', () => {
    const f = fig(['g(x) = x / 2', 'C = Cobweb(g, 8, 2)']);
    const c = pts(f, 'C');
    expect(c.length).toBe(5);
    const want = [[8, 0], [8, 4], [4, 4], [4, 2], [2, 2]];
    c.forEach((p, i) => nearPt(p, (want[i] as number[])[0] as number, (want[i] as number[])[1] as number, 1e-12));
  });

  it('IterateList count above 100000 is a limit error', () => {
    fails(fig('g(x) = x / 2'), 'L = IterateList(g, 1, 100001)', 'limit');
  });

  it('IterateList of 100000 steps is allowed and quick', { retry: 2 }, () => {
    const f = within(1500, () => fig(['g(x) = cos(x)', 'L = IterateList(g, 1, 100000)']));
    expect(list(f, 'L').length).toBeGreaterThanOrEqual(100000);
  });

});

describe('SlopeField(g) (8.10)', () => {

  it('the default grid is 25 and the default segment length 0.8 of a cell', () => {
    const f = fig(['g(x, y) = x - y', 'sf = SlopeField(g)']);
    const v = val<{ n: number; length: number }>(f, 'sf');
    expect(v.n).toBe(25);
    near(v.length, 0.8, 1e-12);
  });

  it('the field carries the slope function: slope(1, 2) is g(1, 2) = -1', () => {
    const f = fig(['g(x, y) = x - y', 'sf = SlopeField(g)']);
    const v = val<{ slope: (x: number, y: number) => number }>(f, 'sf');
    near(v.slope(1, 2), -1, 1e-12);
    near(v.slope(3, -1), 4, 1e-12);
  });

});

describe('SolveODE(g, x0, y0, x1): first-order solution as a Function (8.9)', () => {
  it('y\' = x - y from (0, 1): y(x) = x - 1 + 2 e^-x at x = 2.5 and 4', () => {
    const f = fig(['g(x, y) = x - y', 'sol = SolveODE(g, 0, 1, 4)']);
    near(ev(f, 'sol(2.5)'), 1.5 + 2 * Math.exp(-2.5), 1e-6);
    near(ev(f, 'sol(4)'), 3 + 2 * Math.exp(-4), 1e-6);
  });

  it('y\' = y from (0, 1): y(2) = e^2', () => {
    const f = fig(['g(x, y) = y', 'sol = SolveODE(g, 0, 1, 2)']);
    near(ev(f, 'sol(2)'), Math.exp(2), 1e-6);
  });

  it('logistic y\' = y (1 - y) from (0, 0.5): y(3) = 1/(1 + e^-3)', () => {
    const f = fig(['g(x, y) = y * (1 - y)', 'sol = SolveODE(g, 0, 0.5, 3)']);
    near(ev(f, 'sol(3)'), 1 / (1 + Math.exp(-3)), 1e-6);
  });

  it('a start away from x = 0: from (-2, 0) the solution is x - 1 + 3 e^-2 e^-x, y(4) = 3 + 3 e^-6', () => {
    const f = fig(['g(x, y) = x - y', 'sol = SolveODE(g, -2, 0, 4)']);
    near(ev(f, 'sol(4)'), 3 + 3 * Math.exp(-6), 1e-6);
  });

  it('the domain is [x0, x1]: outside it the value is undefined', () => {
    const f = fig(['g(x, y) = x - y', 'sol = SolveODE(g, 0, 1, 4)']);
    expect(evReason(f, 'sol(5)')).toBeDefined();
    expect(evReason(f, 'sol(-1)')).toBeDefined();
  });

  it('the solution is a real function: its derivative at 1 is g(1, y(1))', () => {
    const f = fig(['g(x, y) = x - y', 'sol = SolveODE(g, 0, 1, 4)', 'm = Slope(sol, 1)']);
    near(num(f, 'm'), 1 - ev(f, 'sol(1)'), 1e-5);
  });

  it('the solve follows a slider on the initial value', () => {
    const f = fig(['y0 = 1 in -3..3 step 0.5', 'g(x, y) = y', 'sol = SolveODE(g, 0, y0, 1)']);
    near(ev(f, 'sol(1)'), Math.E, 1e-6);
    setFree(f, 'y0', 2);
    near(ev(f, 'sol(1)'), 2 * Math.E, 1e-6);
  });

  it('blow-up: y\' = 1 + y^2 from (0, 0) over [0, 3] stops before pi/2 with a blowup warning', () => {
    const f = fig(['g(x, y) = 1 + y^2']);
    const r = ok(f, 'sol = SolveODE(g, 0, 0, 3)');
    near(ev(f, 'sol(1.5)'), Math.tan(1.5), 1e-5);
    expect(evReason(f, 'sol(2)')).toBe('out_of_domain');
    expect(noticeCodes(r).concat(r.notices.map((n) => n.message))).toEqual(expect.arrayContaining([expect.stringMatching(/blowup|blow-up|infinity/i)]));
    expect(reasonOf(f, 'sol')).toBeUndefined();
  });

  it('a long solve with 3000+ steps finishes in a blink: y\' = cos(50 x) y', { retry: 2 }, () => {
    const f = within(500, () => fig(['g(x, y) = cos(50 * x) * y', 'sol = SolveODE(g, 0, 1, 30)']));
    near(ev(f, 'sol(30)'), Math.exp(Math.sin(1500) / 50), 1e-5);
  });
});

describe('SolveODE parametric form: SolveODE(dy, dx, x0, y0, tEnd) -> Curve (8.9)', () => {
  const setup = ['dxf(x, y) = -y', 'dyf(x, y) = x'];
  it('rotation (x\' = -y, y\' = x) from (1, 0) for t = pi/2 ends at (0, 1)', () => {
    const f = fig([...setup, 'cv = SolveODE(dyf, dxf, 1, 0, pi / 2)']);
    const c = val<{ kind: string; curve: string; pieces: Float64Array[] }>(f, 'cv');
    expect(c.curve).toBe('sampled');
    const p = c.pieces[c.pieces.length - 1] as Float64Array;
    near(p[p.length - 2] as number, 0, 1e-5);
    near(p[p.length - 1] as number, 1, 1e-5);
  });

  it('every sample is on the unit circle', () => {
    const f = fig([...setup, 'cv = SolveODE(dyf, dxf, 1, 0, 6)']);
    const c = val<{ pieces: Float64Array[] }>(f, 'cv');
    for (const p of c.pieces) for (let i = 0; i + 1 < p.length; i += 2) near(Math.hypot(p[i] as number, p[i + 1] as number), 1, 1e-6);
  });

  it('a negative tEnd runs backwards: from (1, 0) for t = -pi/2 ends at (0, -1)', () => {
    const f = fig([...setup, 'cv = SolveODE(dyf, dxf, 1, 0, -pi / 2)']);
    const c = val<{ pieces: Float64Array[] }>(f, 'cv');
    const p = c.pieces[c.pieces.length - 1] as Float64Array;
    near(p[p.length - 2] as number, 0, 1e-5);
    near(p[p.length - 1] as number, -1, 1e-5);
  });

});

describe('NSolveODE: systems with dense output (8.9)', () => {
  it('y\'\' = -4 y from (1, 0): y(s) = cos(2 s) and v(s) = -2 sin(2 s)', () => {
    const f = fig(['sys = NSolveODE([v, -4 * y], s, [y, v], [1, 0], 0, 6)', 'ya = sys[1]', 'va = sys[2]']);
    near(ev(f, 'ya(1.3)'), Math.cos(2.6), 1e-6);
    near(ev(f, 'va(1.3)'), -2 * Math.sin(2.6), 1e-6);
  });

  it('a pendulum conserves energy: v^2/2 - 9.8 cos(y) stays within 1e-5 over [0, 10]', () => {
    const f = fig(['sys = NSolveODE([v, -9.8 * sin(y)], s, [y, v], [0.6, 0], 0, 10)', 'ya = sys[1]', 'va = sys[2]']);
    const e0 = -9.8 * Math.cos(0.6);
    for (const s of [2.5, 5, 7.5, 10]) {
      const y = ev(f, `ya(${s})`);
      const v = ev(f, `va(${s})`);
      near(v * v / 2 - 9.8 * Math.cos(y), e0, 1e-5, `energy at ${s}`);
    }
  });

  it('exponential decay system x\' = -x, y\' = x - y from (1, 0): y = s e^-s', () => {
    const f = fig(['sys = NSolveODE([-xx, xx - yy], s, [xx, yy], [1, 0], 0, 5)', 'yf = sys[2]']);
    near(ev(f, 'yf(2)'), 2 * Math.exp(-2), 1e-6);
  });

  it('stop = expr ends the solve where it first becomes true: free fall stops at y = 0, s = 1.4286', () => {
    const f = fig(['sys = NSolveODE([v, -9.8], s, [y, v], [10, 0], 0, 5, stop = y < 0)', 'ya = sys[1]']);
    expect(evReason(f, 'ya(1.4)')).toBeUndefined();
    expect(evReason(f, 'ya(1.5)')).toBeDefined();
    near(ev(f, 'ya(1.4)'), 10 - 4.9 * 1.4 * 1.4, 1e-6);
  });

  it('the event time is located precisely: the last defined s is within 1e-6 of sqrt(10/4.9)', () => {
    const f = fig(['sys = NSolveODE([v, -9.8], s, [y, v], [10, 0], 0, 5, stop = y < 0)', 'ya = sys[1]']);
    const tEnd = Math.sqrt(10 / 4.9);
    expect(evReason(f, `ya(${tEnd - 1e-6})`)).toBeUndefined();
    expect(evReason(f, `ya(${tEnd + 1e-3})`)).toBeDefined();
  });

  it('more than 16 variables is a limit error', () => {
    const names = Array.from({ length: 17 }, (_, i) => `u${i + 1}`);
    const zeros = names.map(() => '0').join(', ');
    fails(fig([]), `sys = NSolveODE([${zeros}], s, [${names.join(', ')}], [${zeros}], 0, 1)`, 'limit');
  });

  it('a slider on a coefficient re-solves: y\'\' = -k y has frequency sqrt(k)', () => {
    const f = fig(['k = 4 in 1..16 step 1', 'sys = NSolveODE([v, -k * y], s, [y, v], [1, 0], 0, 6)', 'ya = sys[1]']);
    near(ev(f, 'ya(1)'), Math.cos(2), 1e-6);
    setFree(f, 'k', 9);
    near(ev(f, 'ya(1)'), Math.cos(3), 1e-6);
  });

});
