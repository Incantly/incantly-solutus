/**
 * Extremum, Maximum, Minimum, Inflection (functions-calculus design.md 8.4, errors.md 3).
 */
import { describe, expect, it } from 'vitest';
import { expectUndefined, fails, fig, nearPt, pt, pts, setFree, useTimeout, within } from './helpers';

useTimeout();

type XY = [number, number];
const check = (got: { x: number; y: number }[], want: XY[], tol = 1e-7): void => {
  expect(got.length, JSON.stringify(got)).toBe(want.length);
  got.forEach((p, i) => nearPt(p, (want[i] as XY)[0], (want[i] as XY)[1], tol));
};

describe('Extremum(f, a, b): all local extrema in the open interval (8.4)', () => {
  const cases: [string, number, number, XY[]][] = [
    ['x^3 - 3x', -3, 3, [[-1, 2], [1, -2]]],
    ['sin(x)', 0, 7, [[Math.PI / 2, 1], [(3 * Math.PI) / 2, -1]]],
    ['abs(x)', -1, 1, [[0, 0]]],
    ['if(x < 1, x, 2 - x)', -3, 3, [[1, 1]]],
    ['x^4 - 2 * x^2', -2, 2, [[-1, -1], [0, 0], [1, -1]]],
    ['exp(x)', -3, 3, []],
    ['x^3', -1, 1, []],
  ];
  it.each(cases)('Extremum of %s on (%d, %d)', (body, a, b, want) => {
    const f = fig([`f(x) = ${body}`, `E = Extremum(f, ${a}, ${b})`]);
    check(pts(f, 'E'), want);
  });

  it('a saddle (x^3 at 0) has f\' = 0 but no sign change and is not an extremum', () => {
    const f = fig(['f(x) = x^3', 'E = Extremum(f, -2, 2)']);
    expect(pts(f, 'E')).toEqual([]);
  });

  it('a narrow spike is found: exp(-1000 (x - 0.5)^2) on (0, 1) has its maximum at (0.5, 1)', () => {
    const f = fig(['f(x) = exp(-1000 * (x - 0.5)^2)', 'E = Extremum(f, 0, 1)']);
    const r = pts(f, 'E');
    expect(r.length).toBe(1);
    nearPt(r[0] as { x: number; y: number }, 0.5, 1, 1e-8);
  });

  it('the extremum count follows a slider: x^3 - k x has two extrema for k > 0, none for k <= 0', () => {
    const f = fig(['k = 3 in -3..9 step 1', 'f(x) = x^3 - k * x', 'E = Extremum(f, -5, 5)']);
    expect(pts(f, 'E').length).toBe(2);
    setFree(f, 'k', -1);
    expect(pts(f, 'E')).toEqual([]);
  });

  it('TurningPoint is accepted as an alias for Extremum', () => {
    const f = fig(['f(x) = x^3 - 3x', 'E = TurningPoint(f, -3, 3)']);
    check(pts(f, 'E'), [[-1, 2], [1, -2]]);
  });
});

describe('Extremum(f): polynomials need no interval (8.4)', () => {
  it('x^4 - 2 x^2 has extrema at -1, 0, 1', () => {
    const f = fig(['f(x) = x^4 - 2 * x^2', 'E = Extremum(f)']);
    check(pts(f, 'E'), [[-1, -1], [0, 0], [1, -1]]);
  });

  it('a quadratic has its vertex: 2 x^2 - 8 x + 3 at (2, -5)', () => {
    const f = fig(['f(x) = 2 * x^2 - 8 * x + 3', 'E = Extremum(f)']);
    check(pts(f, 'E'), [[2, -5]]);
  });

  it('Extremum(f) of a non-polynomial is needs_interval', () => {
    const f = fig('f(x) = sin(x)');
    fails(f, 'E = Extremum(f)', 'needs_interval');
  });
});

describe('Maximum(f, a, b) and Minimum(f, a, b): the global point on the closed interval (8.4)', () => {
  const cases: [string, number, number, XY, XY][] = [
    ['x^3 - 3x', -3, 3, [3, 18], [-3, -18]],
    ['x^3 - 3x', -1.5, 1.5, [-1, 2], [1, -2]],
    ['sin(x)', 0, 3, [Math.PI / 2, 1], [0, 0]],
  ];
  it.each(cases)('global extrema of %s on [%d, %d]', (body, a, b, mx, mn) => {
    const f = fig([`f(x) = ${body}`, `M = Maximum(f, ${a}, ${b})`, `m = Minimum(f, ${a}, ${b})`]);
    nearPt(pt(f, 'M'), mx[0], mx[1], 1e-7);
    nearPt(pt(f, 'm'), mn[0], mn[1], 1e-7);
  });

  it('a narrow spike is the global maximum: exp(-1000 (x - 0.5)^2) on [0, 1] at (0.5, 1)', () => {
    const f = fig(['f(x) = exp(-1000 * (x - 0.5)^2)', 'M = Maximum(f, 0, 1)']);
    nearPt(pt(f, 'M'), 0.5, 1, 1e-8);
  });

  it('the maximum of a piecewise function can be at a break: if(x < 1, x, 3 - 2x) at (1, 1)', () => {
    const f = fig(['f(x) = if(x < 1, x, 3 - 2 * x)', 'M = Maximum(f, -2, 3)']);
    nearPt(pt(f, 'M'), 1, 1, 1e-8);
  });

  it('Maximum with an empty interval a == b is undefined (no_extremum or empty_interval)', () => {
    const f = fig(['f(x) = x^2', 'M = Maximum(f, 2, 2)']);
    expectUndefined(f, 'M', ['no_extremum', 'empty_interval']);
  });

  it('Maximum of a function undefined everywhere on the interval is no_extremum', () => {
    const f = fig(['f(x) = sqrt(x)', 'M = Maximum(f, -5, -1)']);
    expectUndefined(f, 'M', 'no_extremum');
  });

});

describe('Inflection(f, a, b): sign changes of f\'\' (8.4)', () => {
  const cases: [string, number, number, XY[]][] = [
    ['x^3 - 3x', -3, 3, [[0, 0]]],
    ['x^4', -1, 1, []],
    ['sin(x)', -4, 4, [[-Math.PI, 0], [0, 0], [Math.PI, 0]]],
    ['exp(-x^2)', -3, 3, [[-1 / Math.SQRT2, Math.exp(-0.5)], [1 / Math.SQRT2, Math.exp(-0.5)]]],
  ];
  it.each(cases)('Inflection of %s on [%d, %d]', (body, a, b, want) => {
    const f = fig([`f(x) = ${body}`, `W = Inflection(f, ${a}, ${b})`]);
    check(pts(f, 'W'), want, 1e-6);
  });

  it('a zero of f\'\' with no sign change (x^4 at 0) is not an inflection', () => {
    const f = fig(['f(x) = x^4', 'W = Inflection(f, -2, 2)']);
    expect(pts(f, 'W')).toEqual([]);
  });

  it('Inflection(f) for a polynomial needs no interval: x^4 - 6 x^2', () => {
    const f = fig(['f(x) = x^4 - 6 * x^2', 'W = Inflection(f)']);
    check(pts(f, 'W'), [[-1, -5], [1, -5]], 1e-6);
  });

  it('Inflection(f) of a non-polynomial is needs_interval', () => {
    const f = fig('f(x) = sin(x)');
    fails(f, 'W = Inflection(f)', 'needs_interval');
  });

});

describe('Extremum and Inflection: time limits', () => {
  it('Extremum of sin(x) on (0, 100) finds 32 extrema under 500 ms', () => {
    const f = within(500, () => fig(['f(x) = sin(x)', 'E = Extremum(f, 0, 100)']));
    expect(pts(f, 'E').length).toBe(32);
  });

});
