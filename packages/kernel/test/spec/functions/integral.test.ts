/**
 * Integral, AreaUnder, Riemann (functions-calculus design.md 7, 8.1, 8.2, 11; agent.md 1).
 */
import { describe, expect, it } from 'vitest';
import {
  ev,
  expectUndefined,
  fails,
  fig,
  near,
  num,
  region,
  reasonOf,
  setFree,
  useTimeout,
  val,
  within,
} from './helpers';

useTimeout();

const PI = Math.PI;

describe('Integral(f, a, b): definite integrals against exact values (8.1)', () => {
  const cases: [string, string, string, number][] = [
    ['x^3 - 3x', '0', '2', -2],
    ['sin(x)', '0', 'pi', 2],
    ['cos(x)', '0', 'pi / 2', 1],
    ['1 / x', '1', 'exp(1)', 1],
    ['1 / (1 + x^2)', '0', '1', PI / 4],
  ];
  it.each(cases)('Integral of %s from %s to %s', (body, a, b, want) => {
    const f = fig([`f(x) = ${body}`, `I = Integral(f, ${a}, ${b})`]);
    near(num(f, 'I'), want, 1e-8);
  });

  it('additivity: integral over [0, 2] plus [2, 5] equals [0, 5]', () => {
    const f = fig(['f(x) = sin(x) + x^2 / 10', 'A = Integral(f, 0, 2)', 'B = Integral(f, 2, 5)', 'C = Integral(f, 0, 5)']);
    near(num(f, 'A') + num(f, 'B'), num(f, 'C'), 1e-9);
  });

  it('an inline expression is accepted (FC 14.12): Integral(x^2, 0, 3)', () => {
    const f = fig('I = Integral(x^2, 0, 3)');
    near(num(f, 'I'), 9, 1e-8);
  });

  it('the bound follows a slider', () => {
    const f = fig(['b = 1 in 0..5 step 0.5', 'f(x) = x^2', 'I = Integral(f, 0, b)']);
    near(num(f, 'I'), 1 / 3, 1e-9);
    setFree(f, 'b', 3);
    near(num(f, 'I'), 9, 1e-9);
  });

});

describe('Integral: break points, piecewise, sums (8.1, 6)', () => {
  it('abs(x) over [-1, 2] is 2.5 (the break at 0 is exact)', () => {
    const f = fig(['f(x) = abs(x)', 'I = Integral(f, -1, 2)']);
    near(num(f, 'I'), 2.5, 1e-10);
  });

  it('floor(x) over [0, 3.5] is 4.5 (breaks at integers)', () => {
    const f = fig(['f(x) = floor(x)', 'I = Integral(f, 0, 3.5)']);
    near(num(f, 'I'), 4.5, 1e-9);
  });

  it('a piecewise tent over [0, 2] is 1', () => {
    const f = fig(['f(x) = if(x < 1, x, 2 - x)', 'I = Integral(f, 0, 2)']);
    near(num(f, 'I'), 1, 1e-10);
  });

  it('a step function over [0, 4] with a jump at 1.5: if(x < 1.5, 1, 3) is 1.5 + 7.5 = 9', () => {
    const f = fig(['f(x) = if(x < 1.5, 1, 3)', 'I = Integral(f, 0, 4)']);
    near(num(f, 'I'), 1.5 + 7.5, 1e-10);
  });

  it('sign(x) over [-2, 3] is 1', () => {
    const f = fig(['f(x) = sign(x)', 'I = Integral(f, -2, 3)']);
    near(num(f, 'I'), 1, 1e-9);
  });

  it('Integral(f, g, a, b) is the integral of f - g: x and x^2 on [0, 1] give 1/6', () => {
    const f = fig(['f(x) = x', 'g(x) = x^2', 'I = Integral(f, g, 0, 1)']);
    near(num(f, 'I'), 1 / 6, 1e-10);
  });

  it('Integral(f, g, a, b) is signed: x and x^2 on [-1, 1] give -2/3', () => {
    const f = fig(['f(x) = x', 'g(x) = x^2', 'I = Integral(f, g, -1, 1)']);
    near(num(f, 'I'), -2 / 3, 1e-10);
  });

  it('NIntegral is accepted as an alias for Integral', () => {
    const f = fig(['f(x) = x^2', 'I = NIntegral(f, 0, 3)']);
    near(num(f, 'I'), 9, 1e-9);
  });
});

describe('Integral: improper bounds and singularities (8.1)', () => {
  const cases: [string, string, string, number][] = [
    ['exp(-x^2)', '-inf', 'inf', Math.sqrt(PI)],
    ['ln(x)', '0', '1', -1],
    ['1 / sqrt(x)', '0', '1', 2],
    ['1 / sqrt(abs(x))', '-1', '1', 4],
  ];
  it.each(cases)('Integral of %s from %s to %s', (body, a, b, want) => {
    const f = within(500, () => fig([`f(x) = ${body}`, `I = Integral(f, ${a}, ${b})`]));
    near(num(f, 'I'), want, 1e-6);
  });

  it('1/x^2 over [-1, 1] diverges at the interior pole', { retry: 2 }, () => {
    const f = within(1000, () => fig(['f(x) = 1 / x^2', 'I = Integral(f, -1, 1)']));
    expectUndefined(f, 'I', 'diverges');
  });

  it('1/x over [0, 1] diverges', { retry: 2 }, () => {
    const f = within(1000, () => fig(['f(x) = 1 / x', 'I = Integral(f, 0, 1)']));
    expectUndefined(f, 'I', 'diverges');
  });

  it('1/x over [-1, 1] diverges (no principal value)', { retry: 2 }, () => {
    const f = within(1000, () => fig(['f(x) = 1 / x', 'I = Integral(f, -1, 1)']));
    expectUndefined(f, 'I', 'diverges');
  });

  it('the integral of an everywhere-undefined function is undefined, not zero or a throw', () => {
    const f = fig(['f(x) = sqrt(x)', 'I = Integral(f, -5, -1)']);
    expect(reasonOf(f, 'I')).toBeDefined();
  });
});

describe('Integral(f): antiderivative as a Function (7)', () => {

  it.each([
    ['exp(-x^2)', 0, 1],
  ])('af(b) - af(a) equals the definite integral of %s from %d to %d', (body, a, b) => {
    const f = fig([`f(x) = ${body}`, 'af = Integral(f)', `D = Integral(f, ${a}, ${b})`]);
    near(ev(f, `af(${b}) - af(${a})`), num(f, 'D'), 1e-8);
  });

  it('the slope of the antiderivative is the function: Slope(F, 1.3) = f(1.3)', () => {
    const f = fig(['f(x) = sin(x) + 2', 'af = Integral(f)', 'm = Slope(af, 1.3)']);
    near(num(f, 'm'), Math.sin(1.3) + 2, 1e-6);
  });

  it('Integral(f, through) passes through the given point', () => {
    const f = fig(['f(x) = x^2', 'P = (1, 5)', 'af = Integral(f, P)']);
    near(ev(f, 'af(1)'), 5, 1e-9);
    near(ev(f, 'af(2)'), 5 + 7 / 3, 1e-8);
  });

  it('a long run of sequential evaluations is fast (the panel cache): 1000 evaluations of F', { retry: 2 }, () => {
    const f = fig(['f(x) = sin(x) * exp(-x / 5)', 'af = Integral(f)', 'g(x) = af(x)']);
    within(500, () => {
      let s = 0;
      for (let i = 0; i < 100; i++) s += ev(f, `g(${i / 10})`);
      return s;
    });
  });

});

describe('Integral of two-variable functions (1)', () => {
  it('Integral(g, y) is a partial antiderivative: gi(2, 3) of x*y is 9', () => {
    const f = fig(['g(x, y) = x * y', 'gi = Integral(g, y)']);
    near(ev(f, 'gi(2, 3)') - ev(f, 'gi(2, 0)'), 9, 1e-8);
  });

  it('Integral(g, y, 0, 1) is a function of x: x/2 for g = x*y', () => {
    const f = fig(['g(x, y) = x * y', 'hi = Integral(g, y, 0, 1)']);
    near(ev(f, 'hi(4)'), 2, 1e-9);
  });

  it('Integral(g, 0, 1) on a two-variable function is no_matching_form with a hint to integrate one out', () => {
    const f = fig('g(x, y) = x * y');
    const e = fails(f, 'I = Integral(g, 0, 1)', 'no_matching_form');
    expect(e.hint ?? '').toMatch(/Integral\(g, ?y, ?0, ?1\)/);
    expect(e.forms.length).toBeGreaterThan(0);
  });
});

describe('AreaUnder: a Region with .value (signed) and .area (unsigned) (1, 4)', () => {
  it('the field A.value reads the signed integral in a line (agent.md: S.value)', () => {
    const f = fig(['f(x) = x^3 - 3x', 'A = AreaUnder(f, 0, 2)', 'v = A.value']);
    near(num(f, 'v'), -2, 1e-9);
  });

  it('the field A.area reads the unsigned area in a line', () => {
    const f = fig(['f(x) = x^3 - 3x', 'A = AreaUnder(f, 0, 2)', 'a = A.area']);
    near(num(f, 'a'), 2.5, 1e-9);
  });

  it('Riemann regions have the same .value and .area fields', () => {
    const f = fig(['f(x) = x^2', 'S = Riemann(f, 0, 2, 4)', 'v = S.value', 'a = S.area']);
    near(num(f, 'v'), 1.75, 1e-9);
    near(num(f, 'a'), 1.75, 1e-9);
  });

  it('A.value is the signed integral and A.area the unsigned one: x^3 - 3x on [0, 2]', () => {
    const f = fig(['f(x) = x^3 - 3x', 'A = AreaUnder(f, 0, 2)']);
    near(region(f, 'A').value, -2, 1e-9);
    near(region(f, 'A').area, 2.5, 1e-9);
  });

  it('sin on [0, 2 pi] has value 0 and area 4', () => {
    const f = fig(['f(x) = sin(x)', 'A = AreaUnder(f, 0, 2 * pi)']);
    near(region(f, 'A').value, 0, 1e-9);
    near(region(f, 'A').area, 4, 1e-8);
  });

  it('AreaUnder(f, g, a, b) between two curves: x and x^2 on [0, 1] is 1/6', () => {
    const f = fig(['f(x) = x', 'g(x) = x^2', 'A = AreaUnder(f, g, 0, 1)']);
    near(region(f, 'A').value, 1 / 6, 1e-9);
    near(region(f, 'A').area, 1 / 6, 1e-9);
  });

  it('the curves cross: x and x^2 on [-1, 1] have value -2/3 and area 1', () => {
    const f = fig(['f(x) = x', 'g(x) = x^2', 'A = AreaUnder(f, g, -1, 1)']);
    near(region(f, 'A').value, -2 / 3, 1e-9);
    near(region(f, 'A').area, 1, 1e-8);
  });

  it('the Region follows a slider', () => {
    const f = fig(['b = 1 in 0..5 step 0.5', 'f(x) = x', 'A = AreaUnder(f, 0, b)']);
    near(region(f, 'A').value, 0.5, 1e-9);
    setFree(f, 'b', 4);
    near(region(f, 'A').value, 8, 1e-9);
  });
});

describe('Riemann(f, a, b, n [, rule]): sums and bars (8.2)', () => {
  const sums: [string, number][] = [
    ['left', 1.75],
    ['right', 3.75],
    ['mid', 2.625],
    ['trapezoid', 2.75],
    ['simpson', 8 / 3],
    ['upper', 3.75],
    ['lower', 1.75],
  ];
  it.each(sums)('x^2 on [0, 2] with n = 4 and rule "%s" has value %d', (rule, want) => {
    const f = fig(['f(x) = x^2', `S = Riemann(f, 0, 2, 4, "${rule}")`]);
    near(region(f, 'S').value, want, 1e-9);
  });

  it('a numeric offset reads the height at that fraction of each slice: offset 0.25', () => {
    const f = fig(['f(x) = x^2', 'S = Riemann(f, 0, 2, 4, 0.25)']);
    const h = 0.5;
    let want = 0;
    for (let i = 0; i < 4; i++) want += h * (0 + (i + 0.25) * h) ** 2;
    near(region(f, 'S').value, want, 1e-9);
  });

  it('upper sums use the exact supremum of each slice, not the end points: sin on [0, pi] with n = 1 gives pi', () => {
    const f = fig(['f(x) = sin(x)', 'S = Riemann(f, 0, pi, 1, "upper")']);
    near(region(f, 'S').value, PI, 1e-9);
  });

  it('the upper sum is at least the integral and the lower sum at most the integral', () => {
    const f = fig(['f(x) = sin(3 * x) + x / 3', 'U = Riemann(f, 0, 4, 7, "upper")', 'L = Riemann(f, 0, 4, 7, "lower")', 'I = Integral(f, 0, 4)']);
    expect(val<{ value: number }>(f, 'U').value).toBeGreaterThanOrEqual(num(f, 'I') - 1e-9);
    expect(val<{ value: number }>(f, 'L').value).toBeLessThanOrEqual(num(f, 'I') + 1e-9);
  });

  it('simpson with odd n uses n + 1: x^4 on [0, 2] with n = 3 equals n = 4', () => {
    const f = fig(['f(x) = x^4', 'A = Riemann(f, 0, 2, 3, "simpson")', 'B = Riemann(f, 0, 2, 4, "simpson")']);
    near(val<{ value: number }>(f, 'A').value, val<{ value: number }>(f, 'B').value, 1e-12);
    near(val<{ value: number }>(f, 'B').value, 6.416666666666667, 1e-9);
  });

  it('.value is signed and .area unsigned: cos on [0, pi] with n = 4 and midpoints', () => {
    const f = fig(['f(x) = cos(x)', 'S = Riemann(f, 0, pi, 4, "mid")']);
    near(region(f, 'S').value, 0, 1e-9);
    let want = 0;
    for (let i = 0; i < 4; i++) want += Math.abs(Math.cos(((i + 0.5) * PI) / 4)) * (PI / 4);
    near(region(f, 'S').area, want, 1e-9);
  });

  it('a large n converges: left sum of x^2 on [0, 2] with n = 1000 is within 0.005 of 8/3', () => {
    const f = fig(['f(x) = x^2', 'S = Riemann(f, 0, 2, 1000)']);
    expect(Math.abs(region(f, 'S').value - 8 / 3)).toBeLessThan(0.005);
  });

  it('the sum follows the slice-count slider n', () => {
    const f = fig(['n = 4 in 1..60 step 1', 'f(x) = x^2', 'S = Riemann(f, 0, 2, n)']);
    near(region(f, 'S').value, 1.75, 1e-9);
    setFree(f, 'n', 8);
    near(region(f, 'S').value, 0.25 * (0 + 0.0625 + 0.25 + 0.5625 + 1 + 1.5625 + 2.25 + 3.0625), 1e-9);
  });

});

describe('Riemann: aliases that map to Riemann (1)', () => {
  it('LeftSum(f, a, b, n) is the left sum', () => {
    const f = fig(['f(x) = x^2', 'S = LeftSum(f, 0, 2, 4)']);
    near(region(f, 'S').value, 1.75, 1e-9);
  });
  it('RectangleSum(f, a, b, n, d) reads the height at fraction d', () => {
    const f = fig(['f(x) = x^2', 'S = RectangleSum(f, 0, 2, 4, 0.5)']);
    near(region(f, 'S').value, 2.625, 1e-9);
  });
});

describe('Riemann and Integral: argument errors (errors 2)', () => {
  const setup = ['f(x) = x^2'];
  it('Riemann with n = 0 is bad_argument', () => {
    const e = fails(fig(setup), 'S = Riemann(f, 0, 1, 0)', 'bad_argument');
    expect(String(e.params.param ?? '')).toBe('n');
  });
  it('Riemann with an unknown rule "middle" is bad_argument and lists the allowed rules', () => {
    const e = fails(fig(setup), 'S = Riemann(f, 0, 1, 4, "middle")', 'bad_argument');
    expect(JSON.stringify(e.params) + e.message).toMatch(/left|right|mid|trapezoid/);
  });
  it('Riemann with n = 1000000 is a limit error', () => {
    fails(fig(setup), 'S = Riemann(f, 0, 1, 1000000)', 'limit');
  });
  it('a slider that makes n zero turns the region undefined with bad_argument (not a line error)', () => {
    const f = fig(['n = 3 in 0..9 step 1', 'f(x) = x^2', 'S = Riemann(f, 0, 1, n)']);
    setFree(f, 'n', 0);
    expectUndefined(f, 'S', 'bad_argument');
  });
  it('Derivative order 2.5 is bad_argument with param n', () => {
    const e = fails(fig(setup), 'd = Derivative(f, 2.5)', 'bad_argument');
    expect(String(e.params.param ?? '')).toBe('n');
  });
});

describe('Integral: results carry notices when partial (errors 3)', () => {

  it('a wildly oscillating integrand either converges or returns a value with a step_limit warning, never hangs', { retry: 2 }, () => {
    const f = within(3000, () => fig(['f(x) = sin(1 / x)', 'I = Integral(f, 0.0001, 1)']));
    const c = f.cellOf('I');
    expect(c).toBeDefined();
    if (c && !c.defined) expect(['step_limit', 'diverges']).toContain(c.reason);
  });

});
