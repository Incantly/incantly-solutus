/**
 * Root, Roots, Intersect (functions-calculus design.md 8.3 and errors.md 3).
 */
import { describe, expect, it } from 'vitest';
import {
  detailOf,
  ev,
  expectUndefined,
  fails,
  fig,
  near,
  nearPt,
  pt,
  pts,
  reasonOf,
  setFree,
  useTimeout,
  within,
} from './helpers';

useTimeout();

const R = 1e-9;
const sqrt3 = Math.sqrt(3);

describe('Root(f, a, b): first root in [a, b] (8.3)', () => {
  const cases: [string, number, number, number][] = [
    ['x^2 - 2', 0, 3, Math.SQRT2],
    ['x^3 - 3x', -3, 3, -sqrt3],
    ['x^3 - 3x', -1, 3, 0],
  ];
  it.each(cases)('Root of %s on [%d, %d] is %d', (body, a, b, want) => {
    const f = fig([`f(x) = ${body}`, `r = Root(f, ${a}, ${b})`]);
    near(pt(f, 'r').x, want, R);
    near(pt(f, 'r').y, 0, 1e-9);
  });

  it('Root is the leftmost root when there are several', () => {
    const f = fig(['f(x) = sin(x)', 'r = Root(f, 1, 20)']);
    near(pt(f, 'r').x, Math.PI, R);
  });

  it('Root with no sign change is undefined with no_root', () => {
    const f = fig(['f(x) = x^2 + 1', 'r = Root(f, -5, 5)']);
    expectUndefined(f, 'r', 'no_root');
  });

  it('Root(f, 2, 3) where f has no root there is no_root, and the detail says so', () => {
    const f = fig(['f(x) = x^3 - 3x', 'r = Root(f, 2, 3)']);
    expectUndefined(f, 'r', 'no_root');
    expect(detailOf(f, 'r') ?? '').not.toBe('');
  });

  it('Root follows a slider on the function', () => {
    const f = fig(['k = 4 in 1..9 step 1', 'f(x) = x^2 - k', 'r = Root(f, 0, 10)']);
    near(pt(f, 'r').x, 2, R);
    setFree(f, 'k', 9);
    near(pt(f, 'r').x, 3, R);
  });
});

describe('Root(f, x0): nearest root from a start value (8.3)', () => {
  it.each([
    ['x^3 - 3x', 1.5, sqrt3],
  ])('Root of %s from %d is %d', (body, x0, want) => {
    const f = fig([`f(x) = ${body}`, `r = Root(f, ${x0})`]);
    near(pt(f, 'r').x, want as number, 1e-8);
  });

});

describe('Roots(f, a, b): every root, sorted (8.3)', () => {
  const cases: [string, number, number, number[]][] = [
    ['x^3 - 3x', -3, 3, [-sqrt3, 0, sqrt3]],
    ['(x - 1) * (x + 2) * (x - 4)', -10, 10, [-2, 1, 4]],
    ['sin(x)', 0, 10, [0, Math.PI, 2 * Math.PI, 3 * Math.PI]],
    ['x^4 - 10 * x^2 + 9', -5, 5, [-3, -1, 1, 3]],
    ['x^2 + 1', -5, 5, []],
    ['tan(x)', 0.1, 3.5, [Math.PI]],
  ];
  it.each(cases)('Roots of %s on [%d, %d]', (body, a, b, want) => {
    const f = fig([`f(x) = ${body}`, `r = Roots(f, ${a}, ${b})`]);
    const got = pts(f, 'r');
    expect(got.length).toBe(want.length);
    got.forEach((p, i) => {
      near(p.x, want[i] as number, 1e-8, `root ${i + 1}`);
      near(p.y, 0, 1e-8);
    });
  });

  it('no roots is the empty list, defined, not undefined', () => {
    const f = fig(['f(x) = x^2 + 1', 'r = Roots(f, -5, 5)']);
    expect(reasonOf(f, 'r')).toBeUndefined();
    expect(pts(f, 'r')).toEqual([]);
  });

  it('a double root (x - 1)^2 is found once, tangent', () => {
    const f = fig(['f(x) = (x - 1)^2', 'r = Roots(f, -3, 3)']);
    const r = pts(f, 'r');
    expect(r.length).toBe(1);
    near((r[0] as { x: number }).x, 1, 1e-6);
  });

  it('a double root among simple roots: (x - 1)^2 (x + 2) has roots -2 and 1', () => {
    const f = fig(['f(x) = (x - 1)^2 * (x + 2)', 'r = Roots(f, -5, 5)']);
    const r = pts(f, 'r');
    expect(r.length).toBe(2);
    near((r[0] as { x: number }).x, -2, 1e-8);
    near((r[1] as { x: number }).x, 1, 1e-6);
  });

  it('a root at an end point of the interval is included', () => {
    const f = fig(['f(x) = x * (x - 1)', 'r = Roots(f, 0, 1)']);
    const r = pts(f, 'r');
    expect(r.map((p) => Math.round(p.x))).toEqual([0, 1]);
  });

  it('Roots(f, a, b) with a > b swaps the interval', () => {
    const f = fig(['f(x) = x^3 - 3x', 'r = Roots(f, 3, -3)']);
    const xs = pts(f, 'r').map((p) => p.x);
    expect(xs.length).toBe(3);
    near(xs[0] as number, -sqrt3, 1e-9);
    near(xs[2] as number, sqrt3, 1e-9);
  });

  it('Roots with a == b is undefined with empty_interval', () => {
    const f = fig(['f(x) = x^3 - 3x', 'r = Roots(f, 1, 1)']);
    expectUndefined(f, 'r', 'empty_interval');
  });

  it('a function that is zero everywhere has no list of roots: identically_zero', () => {
    const f = fig(['f(x) = 0', 'r = Roots(f, -1, 1)']);
    expectUndefined(f, 'r', 'identically_zero');
  });

  it('a piecewise function with a root in each piece', () => {
    const f = fig(['f(x) = if(x < 0, x + 2, x - 3)', 'r = Roots(f, -5, 5)']);
    const xs = pts(f, 'r').map((p) => p.x);
    expect(xs.length).toBe(2);
    near(xs[0] as number, -2, 1e-9);
    near(xs[1] as number, 3, 1e-9);
  });

});

describe('Roots: hard cases and time limits (8.3 targets)', () => {
  it('sin(1/x) on [0.01, 1] has 31 roots (the doc says 62; the roots are 1/(k pi) for k = 1..31)', { retry: 2 }, () => {
    const f = within(500, () => fig(['f(x) = sin(1 / x)', 'r = Roots(f, 0.01, 1)']));
    const xs = pts(f, 'r').map((p) => p.x);
    expect(xs.length).toBe(31);
    xs.forEach((x, i) => near(x, 1 / ((31 - i) * Math.PI), 1e-8));
  });

  it('a degree-8 polynomial on [-10, 10] has all 8 roots to 1e-9, fast', { retry: 2 }, () => {
    const body = '(x + 4) * (x + 3) * (x + 2) * (x + 1) * (x - 1) * (x - 2) * (x - 3) * (x - 4)';
    const f = within(500, () => fig([`f(x) = ${body}`, 'r = Roots(f, -10, 10)']));
    const xs = pts(f, 'r').map((p) => p.x);
    expect(xs.length).toBe(8);
    [-4, -3, -2, -1, 1, 2, 3, 4].forEach((v, i) => near(xs[i] as number, v, 1e-9));
  });

  it('Roots over a huge interval [-1e9, 1e9] finds x = 0', { retry: 2 }, () => {
    const f = within(500, () => fig(['f(x) = x', 'r = Roots(f, -1000000000, 1000000000)']));
    const r = pts(f, 'r');
    expect(r.length).toBe(1);
    near((r[0] as { x: number }).x, 0, 1e-6);
  });

  it('roots close together are both found: (x - 1)(x - 1.001)', () => {
    const f = fig(['f(x) = (x - 1) * (x - 1.001)', 'r = Roots(f, 0, 2)']);
    const xs = pts(f, 'r').map((p) => p.x);
    expect(xs.length).toBe(2);
    near(xs[0] as number, 1, 1e-8);
    near(xs[1] as number, 1.001, 1e-8);
  });

  it('an oscillating function with many roots: sin(20 x) on [0, 10] has 64 roots', { retry: 2 }, () => {
    const f = within(500, () => fig(['f(x) = sin(20 * x)', 'r = Roots(f, 0, 10)']));
    expect(pts(f, 'r').length).toBe(64);
  });

});

describe('Roots: dynamic lists (1: "a list that grows and shrinks with a slider")', () => {
  it('f(x) = a x^2 + b: the root count follows b', () => {
    const f = fig(['a = 1 in -3..3 step 0.5', 'b = -4 in -9..9 step 0.5', 'f(x) = a * x^2 + b', 'r = Roots(f, -5, 5)']);
    expect(pts(f, 'r').length).toBe(2);
    setFree(f, 'b', 4);
    expect(pts(f, 'r')).toEqual([]);
    expect(reasonOf(f, 'r')).toBeUndefined();
    setFree(f, 'b', 0);
    const r = pts(f, 'r');
    expect(r.length).toBe(1);
    near((r[0] as { x: number }).x, 0, 1e-5);
  });

  it('the roots move with the slider: a = 1 gives +-2, a = 4 gives +-1', () => {
    const f = fig(['a = 1 in 1..9 step 1', 'f(x) = a * x^2 - 4', 'r = Roots(f, -5, 5)']);
    near(pts(f, 'r')[1]?.x as number, 2, 1e-9);
    setFree(f, 'a', 4);
    near(pts(f, 'r')[1]?.x as number, 1, 1e-9);
  });

});

describe('Roots(f): polynomials and rational functions, no interval (8.3)', () => {
  it('x^4 - 10 x^2 + 9 has roots -3, -1, 1, 3', () => {
    const f = fig(['f(x) = x^4 - 10 * x^2 + 9', 'r = Roots(f)']);
    const xs = pts(f, 'r').map((p) => p.x);
    expect(xs.length).toBe(4);
    [-3, -1, 1, 3].forEach((v, i) => near(xs[i] as number, v, 1e-9));
  });

  it('a polynomial with slider coefficients: x^2 - k follows k', () => {
    const f = fig(['k = 4 in 0..16 step 1', 'f(x) = x^2 - k', 'r = Roots(f)']);
    expect(pts(f, 'r').length).toBe(2);
    setFree(f, 'k', 9);
    near(pts(f, 'r')[1]?.x as number, 3, 1e-9);
  });

  it('a rational function: roots of the numerator, (x^2 - 1)/(x - 2) has -1 and 1', () => {
    const f = fig(['f(x) = (x^2 - 1) / (x - 2)', 'r = Roots(f)']);
    const xs = pts(f, 'r').map((p) => p.x);
    expect(xs.length).toBe(2);
    near(xs[0] as number, -1, 1e-9);
    near(xs[1] as number, 1, 1e-9);
  });

  it('a numerator root that is also a denominator root is a hole, not a root: (x^2 - 1)/(x - 1)', () => {
    const f = fig(['f(x) = (x^2 - 1) / (x - 1)', 'r = Roots(f)']);
    const xs = pts(f, 'r').map((p) => p.x);
    expect(xs.length).toBe(1);
    near(xs[0] as number, -1, 1e-9);
  });

  it('Roots(f) of a non-polynomial is the line error needs_interval', () => {
    const f = fig('f(x) = sin(x)');
    const e = fails(f, 'r = Roots(f)', 'needs_interval');
    expect(e.hint ?? '').toMatch(/Roots\(f, ?a, ?b\)|interval|-10/);
  });

  it('needs_interval lists the interval form among the forms', () => {
    const f = fig('f(x) = exp(x) - 2');
    const e = fails(f, 'r = Roots(f)', 'needs_interval');
    expect(e.forms.join(' ')).toMatch(/Roots\(f: Function, a: Number, b: Number\)/);
  });
});

describe('Roots(f, guesses): one root near each guess (1)', () => {
  it('guesses -2, 0.5, 2 find -sqrt3, 0, sqrt3 (order of the result is sorted or by guess; here they agree)', () => {
    const f = fig(['f(x) = x^3 - 3x', 'r = Roots(f, [-2, 0.5, 2])']);
    const xs = pts(f, 'r').map((p) => p.x);
    expect(xs.length).toBe(3);
    near(xs[0] as number, -sqrt3, 1e-8);
    near(xs[1] as number, 0, 1e-8);
    near(xs[2] as number, sqrt3, 1e-8);
  });

});

describe('Intersect(f, g, a, b): list of points (1, 8.3)', () => {
  it('x^2 and x + 2 meet at (-1, 1) and (2, 4)', () => {
    const f = fig(['f(x) = x^2', 'g(x) = x + 2', 'P = Intersect(f, g, -5, 5)']);
    const r = pts(f, 'P');
    expect(r.length).toBe(2);
    nearPt(r[0] as { x: number; y: number }, -1, 1, 1e-8);
    nearPt(r[1] as { x: number; y: number }, 2, 4, 1e-8);
  });

  it('a tangential meeting is one point: x^2 and 2x - 1 touch at (1, 1)', () => {
    const f = fig(['f(x) = x^2', 'g(x) = 2 * x - 1', 'P = Intersect(f, g, -5, 5)']);
    const r = pts(f, 'P');
    expect(r.length).toBe(1);
    nearPt(r[0] as { x: number; y: number }, 1, 1, 1e-6);
  });

  it('no intersection is the empty list', () => {
    const f = fig(['f(x) = x^2', 'g(x) = -1', 'P = Intersect(f, g, -5, 5)']);
    expect(pts(f, 'P')).toEqual([]);
  });

  it('sin(x) and cos(x) on [0, 10] meet 3 times', () => {
    const f = fig(['f(x) = sin(x)', 'g(x) = cos(x)', 'P = Intersect(f, g, 0, 10)']);
    const xs = pts(f, 'P').map((p) => p.x);
    expect(xs.length).toBe(3);
    near(xs[0] as number, Math.PI / 4, 1e-8);
    near(xs[1] as number, (5 * Math.PI) / 4, 1e-8);
    near(xs[2] as number, (9 * Math.PI) / 4, 1e-8);
  });

  it('intersections follow a slider', () => {
    const f = fig(['k = 2 in -3..5 step 0.5', 'f(x) = x^2', 'g(x) = k', 'P = Intersect(f, g, -5, 5)']);
    expect(pts(f, 'P').length).toBe(2);
    setFree(f, 'k', -1);
    expect(pts(f, 'P')).toEqual([]);
  });

});

describe('Roots: failures are undefined values with reasons, not errors (errors 3)', () => {

  it('the value of f at the root is zero to 1e-9', () => {
    const f = fig(['f(x) = exp(x) - x - 2', 'r = Root(f, 0, 3)']);
    near(ev(f, `f(${pt(f, 'r').x})`), 0, 1e-9);
  });
});
