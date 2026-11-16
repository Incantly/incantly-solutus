/**
 * Derivative, NDerivative, Slope, Tangent, Normal, Curvature, OsculatingCircle of functions
 * (functions-calculus design.md sections 1, 6, 7, 11).
 */
import { describe, expect, it } from 'vitest';
import {
  distToLine,
  ev,
  evReason,
  expectLine,
  expectUndefined,
  fails,
  fig,
  lineOf,
  near,
  reasonOf,
  setFree,
  slopeOf,
  useTimeout,
  val,
  within,
} from './helpers';

useTimeout();

const D = 1e-7; // derivative values: the docs target 1e-9 or better; 1e-7 leaves room for a numeric fallback

describe('Derivative(f): values against known derivatives (FC 7)', () => {
  const cases: [string, number, (x: number) => number][] = [
    ['x^3 - 3x', 2, () => 9],
    ['sin(x)', 0, () => 1],
    ['cos(x)', 0.7, (x) => -Math.sin(x)],
    ['exp(x)', 1, () => Math.E],
    ['ln(x)', 2, () => 0.5],
    ['sqrt(x)', 4, () => 0.25],
    ['atan(x)', 1, () => 0.5],
    ['1 / x', 2, () => -0.25],
    ['x^x', 2, (x) => x ** x * (Math.log(x) + 1)],
    ['2^x', 3, () => 8 * Math.LN2],
    ['sin(x) / x', 1, () => Math.cos(1) - Math.sin(1)],
    ['sin(x) * cos(2 * x)', 0.3, (x) => Math.cos(x) * Math.cos(2 * x) - 2 * Math.sin(x) * Math.sin(2 * x)],
    ['(x^2 + 1) / (x - 1)', 3, () => (2 * 3 * 2 - 10) / 4],
    ['floor(x)', 0.5, () => 0],
  ];
  it.each(cases)('d/dx of %s at %d', (body, x0, want) => {
    const f = fig([`f(x) = ${body}`, 'd = Derivative(f)']);
    near(ev(f, `d(${x0})`), want(x0), D);
  });

  it('the derivative of a user-function call uses the chain rule through the called function', () => {
    const f = fig(['f(x) = x + 1', 'g(x) = f(x)^2', 'd = Derivative(g)']);
    near(ev(f, 'd(1)'), 4, D);
  });

});

describe('Derivative(f, n): higher orders', () => {
  const cases: [string, number, number, number][] = [
    ['x^4', 2, 2, 48],
    ['sin(x)', 2, Math.PI / 2, -1],
    ['x^3 - 3x', 4, 5, 0],
  ];
  it.each(cases)('Derivative of %s of order %d at %d is %d', (body, n, x0, want) => {
    const f = fig([`f(x) = ${body}`, `d = Derivative(f, ${n})`]);
    near(ev(f, `d(${x0})`), want, 1e-5);
  });

});

describe('Derivative: partial derivatives of two-variable functions (FC 1, 6)', () => {
  const setup = ['g(x, y) = x^2 * y + sin(y)'];
  it('Derivative(g, x) is 2 x y', () => {
    const f = fig([...setup, 'gx = Derivative(g, x)']);
    near(ev(f, 'gx(1, 2)'), 4, D);
    near(ev(f, 'gx(3, -1)'), -6, D);
  });
  it('Derivative(g, y) is x^2 + cos(y)', () => {
    const f = fig([...setup, 'gy = Derivative(g, y)']);
    near(ev(f, 'gy(1, 2)'), 1 + Math.cos(2), D);
  });
  it('Derivative(g, x, 2) is 2 y', () => {
    const f = fig([...setup, 'gxx = Derivative(g, x, 2)']);
    near(ev(f, 'gxx(1, 2)'), 4, 1e-5);
  });
  it('Derivative(g, y, 2) is -sin(y)', () => {
    const f = fig([...setup, 'gyy = Derivative(g, y, 2)']);
    near(ev(f, 'gyy(1, 2)'), -Math.sin(2), 1e-5);
  });
});

describe('Derivative of a piecewise function and corners (FC 6)', () => {
  it('the derivative of a piecewise function is the piecewise of derivatives', () => {
    const f = fig(['f(x) = if(x < 0, -x, x^2)', 'd = Derivative(f)']);
    near(ev(f, 'd(-2)'), -1, D);
    near(ev(f, 'd(3)'), 6, D);
  });

  it('at a corner the derivative function is undefined with reason corner, not a branch value', () => {
    const f = fig(['f(x) = abs(x)', 'd = Derivative(f)']);
    expect(evReason(f, 'd(0)')).toBe('corner');
  });

  it('where the one-sided derivatives agree there is no corner', () => {
    const f = fig(['f(x) = if(x < 1, x^2, 2 * x - 1)', 'd = Derivative(f)']);
    near(ev(f, 'd(1)'), 2, 1e-6);
  });

  it('the domain restriction is kept by the derivative', () => {
    const f = fig(['f(x) = x^2 in 0..2', 'd = Derivative(f)']);
    near(ev(f, 'd(1)'), 2, D);
    expect(evReason(f, 'd(5)')).toBe('out_of_domain');
  });
});

describe('NDerivative: numeric derivative for bodies the rules cannot print (FC 1, 7)', () => {
  it('NDerivative of a smooth function matches the exact derivative', () => {
    const f = fig(['f(x) = sin(x) * x', 'n = NDerivative(f)']);
    near(ev(f, 'n(1.3)'), Math.sin(1.3) + 1.3 * Math.cos(1.3), 1e-6);
  });

  it('NDerivative works on a body with mod, which has no symbolic rule', () => {
    const f = fig(['f(x) = x * mod(10, 3) + x^2', 'n = NDerivative(f)']);
    near(ev(f, 'n(2)'), 1 + 4, 1e-5);
  });

  it('Derivative(h) with a body that has no derivative rule fails at the line with not_differentiable', () => {
    const f = fig('h(x) = noise(x, 1) * x');
    const e = fails(f, 'd = Derivative(h)', 'not_differentiable');
    expect(e.hint ?? '').toMatch(/NDerivative/);
  });

});

describe('Slope(f, x0) (FC 1, 11)', () => {
  it.each([
    ['x^3 - 3x', 2, 9],
  ])('Slope of %s at %d is %d', (body, x0, want) => {
    const f = fig([`f(x) = ${body}`, `m = Slope(f, ${x0})`]);
    near(Number(f.value('m')), want as number, D);
  });

  it('Slope at a corner is undefined with reason corner', () => {
    const f = fig(['f(x) = abs(x)', 'm = Slope(f, 0)']);
    expectUndefined(f, 'm', 'corner');
  });

  it('Slope at a smooth piece junction is defined', () => {
    const f = fig(['f(x) = if(x < 1, x^2, 2 * x - 1)', 'm = Slope(f, 1)']);
    near(Number(f.value('m')), 2, 1e-6);
  });

});

describe('Tangent(f, x0) and Normal(f, x0)', () => {
  it('Tangent of x^2 at 3 is y = 6x - 9', () => {
    const f = fig(['f(x) = x^2', 'T = Tangent(f, 3)']);
    expectLine(lineOf(f, 'T'), 6, -9, 1e-6);
  });

  it('Tangent of x^3 - 3x at 1 (a minimum) is horizontal at y = -2', () => {
    const f = fig(['f(x) = x^3 - 3x', 'T = Tangent(f, 1)']);
    expectLine(lineOf(f, 'T'), 0, -2, 1e-6);
  });

  it('Tangent follows a slider (the lesson in agent.md)', () => {
    const f = fig(['f(x) = x^3 - 3x', 'a = -2 in -2..2 step 0.01', 'T = Tangent(f, a)']);
    near(slopeOf(lineOf(f, 'T')), 9, 1e-6);
    setFree(f, 'a', 0);
    near(slopeOf(lineOf(f, 'T')), -3, 1e-6);
  });

  it('Tangent at a corner is undefined', () => {
    const f = fig(['f(x) = abs(x)', 'T = Tangent(f, 0)']);
    expect(reasonOf(f, 'T')).toBeDefined();
  });

  it('Normal of x^2 at 1 has slope -1/2 and passes through (1, 1)', () => {
    const f = fig(['f(x) = x^2', 'N = Normal(f, 1)']);
    const n = lineOf(f, 'N');
    near(slopeOf(n), -0.5, 1e-6);
    expect(distToLine(n, 1, 1)).toBeLessThan(1e-8);
  });

  it('Normal is perpendicular to the tangent', () => {
    const f = fig(['f(x) = sin(x) + x', 'T = Tangent(f, 0.4)', 'N = Normal(f, 0.4)']);
    const t = lineOf(f, 'T');
    const n = lineOf(f, 'N');
    near(t.a * n.a + t.b * n.b, 0, 1e-6);
  });

});

describe('Curvature(f, x0) and OsculatingCircle(f, x0) of a function graph (FC 1, curves 1)', () => {
  it('curvature of y = x^2 at 0 is 2', () => {
    const f = fig(['f(x) = x^2', 'k = Curvature(f, 0)']);
    near(Number(f.value('k')), 2, 1e-6);
  });

  it('curvature of y = sin(x) at pi/2 is -1', () => {
    const f = fig(['f(x) = sin(x)', 'k = Curvature(f, pi / 2)']);
    near(Number(f.value('k')), -1, 1e-6);
  });

  it('the osculating circle of y = x^2 at 0 has radius 0.5 and centre (0, 0.5)', () => {
    const f = fig(['f(x) = x^2', 'O = OsculatingCircle(f, 0)']);
    const c = val<{ cx: number; cy: number; r: number }>(f, 'O');
    near(c.r, 0.5, 1e-5);
    near(c.cx, 0, 1e-5);
    near(c.cy, 0.5, 1e-5);
  });

  it('the osculating circle at an inflection point is undefined with infinite_radius', () => {
    const f = fig(['f(x) = x^3', 'O = OsculatingCircle(f, 0)']);
    expectUndefined(f, 'O', 'infinite_radius');
  });
});

describe('Derivative: the derivative integrates back (FC 13: property tests)', () => {
  it('Integral of Derivative(f) over [0, 20] equals f(20) - f(0), under 300 ms', { retry: 2 }, () => {
    const f = within(300, () => fig(['f(x) = sin(x) * cos(2 * x) + sqrt(x + 2)', 'd = Derivative(f)', 'I = Integral(d, 0, 20)']));
    near(Number(f.value('I')), ev(f, 'f(20)') - ev(f, 'f(0)'), 1e-7);
  });
});
