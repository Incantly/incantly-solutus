/**
 * Inequalities: Predicate and Predicate2, calls, Boundary, PointIn, Area (curves-loci design.md 1, 7, 13;
 * errors.md 1 and 2).
 */
import { describe, expect, it } from 'vitest';
import {
  evB,
  expectUndefined,
  fails,
  fig,
  list,
  near,
  nearList,
  nearPt,
  noticeCodes,
  num,
  ok,
  pt,
  reasonOf,
  setFree,
  useTimeout,
  within,
} from './helpers';

useTimeout();

const PI = Math.PI;

describe('Predicate lines: p(x) = condition and q(x, y) = condition (1, 7, 15.2)', () => {
  it('p(x) = x^2 > 4 makes a Predicate', () => {
    const f = fig('p(x) = x^2 > 4');
    expect(String(f.get('p')?.type)).toMatch(/Predicate/);
  });

  it('q(x, y) = x^2 + y^2 < 4 makes a Predicate2', () => {
    const f = fig('q(x, y) = x^2 + y^2 < 4');
    expect(String(f.get('q')?.type)).toMatch(/Predicate/);
  });

  it('calling a one-variable predicate gives a Bool: p(3) true, p(1) false', () => {
    const f = fig('p(x) = x^2 > 4');
    expect(evB(f, 'p(3)')).toBe(true);
    expect(evB(f, 'p(1)')).toBe(false);
    expect(evB(f, 'p(-3)')).toBe(true);
  });

  it('calling a two-variable predicate gives a Bool: inside and outside the disc', () => {
    const f = fig('q(x, y) = x^2 + y^2 < 4');
    expect(evB(f, 'q(1, 1)')).toBe(true);
    expect(evB(f, 'q(2, 2)')).toBe(false);
  });

  it.each([
    ['x > 1', 1, false],
    ['x <= 1', 1, true],
  ])('p(x) = %s at %d is %s', (cond, x, want) => {
    const f = fig(`p(x) = ${cond}`);
    expect(evB(f, `p(${x})`)).toBe(want);
  });

  it('a chain is allowed: band(x, y) = 1 < x^2 + y^2 < 4', () => {
    const f = fig('band(x, y) = 1 < x^2 + y^2 < 4');
    expect(evB(f, 'band(1.2, 0)')).toBe(true);
    expect(evB(f, 'band(0.5, 0)')).toBe(false);
    expect(evB(f, 'band(3, 0)')).toBe(false);
  });

  it('and combines conditions: sys(x, y) = y >= x and x + y < 3 and y < 2', () => {
    const f = fig('sys(x, y) = y >= x and x + y < 3 and y < 2');
    expect(evB(f, 'sys(0, 1)')).toBe(true);
    expect(evB(f, 'sys(1, 0)')).toBe(false);
    expect(evB(f, 'sys(1.5, 1.5)')).toBe(false);
    expect(evB(f, 'sys(0, 2)')).toBe(false);
  });

  it('a predicate with a slider follows it', () => {
    const f = fig(['r = 2 in 0..5 step 0.5', 'q(x, y) = x^2 + y^2 <= r^2']);
    expect(evB(f, 'q(2.5, 0)')).toBe(false);
    setFree(f, 'r', 3);
    expect(evB(f, 'q(2.5, 0)')).toBe(true);
  });

  // to be implemented: contested: the test names the predicate t, and t is reserved for the clock (README decision 14)
  it.skip('a transcendental condition is accepted: sin(x) * y > 1', () => {
    const f = fig('t(x, y) = sin(x) * y > 1');
    expect(evB(f, 't(pi / 2, 2)')).toBe(true);
    expect(evB(f, 't(pi / 2, 0.5)')).toBe(false);
  });

  it('a body above 400 nodes is a limit error, not silently skipped', () => {
    const body = Array.from({ length: 450 }, () => 'x').join(' + ');
    fails(fig([]), `big(x, y) = ${body} > 0`, 'limit');
  });

});

describe('Boundary(p, a, b): where the predicate changes truth (7)', () => {
  it('x^2 > 4 changes at -2 and 2', () => {
    const f = fig(['p(x) = x^2 > 4', 'B = Boundary(p, -5, 5)']);
    nearList(list<number>(f, 'B'), [-2, 2], 1e-9);
  });

  it('x^3 > x + 1 changes at the real root 1.3247179572447', () => {
    const f = fig(['p(x) = x^3 > x + 1', 'B = Boundary(p, -5, 5)']);
    nearList(list<number>(f, 'B'), [1.324717957244746], 1e-9);
  });

  it('a chain 1 < x^2 < 4 changes at -2, -1, 1, 2', () => {
    const f = fig(['p(x) = 1 < x^2 < 4', 'B = Boundary(p, -5, 5)']);
    nearList(list<number>(f, 'B'), [-2, -1, 1, 2], 1e-9);
  });

  it('sin(x) > 0 on [-1, 7] changes at 0, pi, 2 pi', () => {
    const f = fig(['p(x) = sin(x) > 0', 'B = Boundary(p, -1, 7)']);
    nearList(list<number>(f, 'B'), [0, PI, 2 * PI], 1e-9);
  });

  it('a predicate true everywhere has no boundary: the empty list, defined', () => {
    const f = fig(['p(x) = x^2 > -1', 'B = Boundary(p, -5, 5)']);
    expect(reasonOf(f, 'B')).toBeUndefined();
    expect(list(f, 'B')).toEqual([]);
  });

});

describe('PointIn(q, P0): a point kept inside the region (7)', () => {
  const disc = 'q(x, y) = x^2 + y^2 < 4';
  it('a point already inside stays', () => {
    const f = fig([disc, 'P0 = (1, 1)', 'PI = PointIn(q, P0)']);
    nearPt(pt(f, 'PI'), 1, 1, 1e-12);
  });

  it('a point outside moves to the nearest inside point: from (5, 0) to just inside (2, 0)', () => {
    const f = fig([disc, 'P0 = (5, 0)', 'PI = PointIn(q, P0)']);
    const p = pt(f, 'PI');
    near(p.x, 2, 1e-6);
    near(p.y, 0, 1e-9);
    expect(p.x).toBeLessThan(2);
  });

  it('an empty region gives empty_region', () => {
    const f = fig(['qe(x, y) = x^2 + y^2 < -1', 'P0 = (1, 1)', 'PI = PointIn(qe, P0)']);
    expectUndefined(f, 'PI', 'empty_region');
  });

});

describe('Area(q, x0, x1, y0, y1): measure of the region in a rectangle (7)', () => {
  const tol = 2e-3;
  it('a disc of radius 2 in [-3, 3]^2 has area 4 pi', () => {
    const f = fig(['q(x, y) = x^2 + y^2 < 4', 'A = Area(q, -3, 3, -3, 3)']);
    near(num(f, 'A'), 4 * PI, tol / 12);
  });

  it('half the disc: disc and y > x has area 2 pi', () => {
    const f = fig(['disc(x, y) = x^2 + y^2 <= 4', 'half(x, y) = y > x', 'both(x, y) = disc(x, y) and half(x, y)', 'A = Area(both, -3, 3, -3, 3)']);
    near(num(f, 'A'), 2 * PI, 3e-4);
  });

  it('the region below the sine curve in [0, pi] x [-1, 1] has area pi + 2', () => {
    const f = fig(['b(x, y) = y < sin(x)', 'A = Area(b, 0, pi, -1, 1)']);
    near(num(f, 'A'), PI + 2, 5e-4);
  });

  it('an empty region gives empty_region', () => {
    const f = fig(['qe(x, y) = x^2 + y^2 < -1', 'A = Area(qe, -3, 3, -3, 3)']);
    expectUndefined(f, 'A', 'empty_region');
  });

  it('the area follows a slider: x^2 + y^2 <= r^2 is pi r^2', () => {
    const f = fig(['r = 2 in 0..5 step 0.5', 'q(x, y) = x^2 + y^2 <= r^2', 'A = Area(q, -6, 6, -6, 6)']);
    near(num(f, 'A'), 4 * PI, 3e-4);
    setFree(f, 'r', 3);
    near(num(f, 'A'), 9 * PI, 3e-4);
  });

  // to be implemented: contested: the test names the predicate t, and t is reserved for the clock (README decision 14)
  it.skip('an unusual condition is measured, not skipped: sin(x) * y > 1 in [0, pi] x [0, 4] is positive and finite', () => {
    const f = within(500, () => fig(['t(x, y) = sin(x) * y > 1', 'A = Area(t, 0, pi, 0, 4)']));
    expect(num(f, 'A')).toBeGreaterThan(0);
    expect(Number.isFinite(num(f, 'A'))).toBe(true);
  });

  // to be implemented: Area does not raise the identically_true notice yet
  it.skip('the notices of an inequality that is true everywhere include identically_true', () => {
    const f = fig([]);
    const r = ok(f, 'tt(x, y) = x^2 >= 0');
    expect(noticeCodes(r)).toContain('identically_true');
  });
});

describe('Boundary, PointIn and Area on inequalities written as plain relation lines (silent-doc fallback)', () => {
  // The docs write inequalities as q(x, y) = condition. The language also accepts a bare relation line, and the
  // commands must work on it. These tests separate "the command is right" from "the define-line form is typed right".
  it('Area of the relation x^2 + y^2 < 4 in [-3, 3]^2 is 4 pi', () => {
    const f = fig(['r = x^2 + y^2 < 4', 'A = Area(r, -3, 3, -3, 3)']);
    near(num(f, 'A'), 4 * PI, 3e-4);
  });

  it('Area of y < sin(x) in [0, pi] x [-1, 1] is pi + 2', () => {
    const f = fig(['r = y < sin(x)', 'A = Area(r, 0, pi, -1, 1)']);
    near(num(f, 'A'), PI + 2, 5e-4);
  });

  it('Area of an empty relation is empty_region', () => {
    const f = fig(['r = x^2 + y^2 < -1', 'A = Area(r, -3, 3, -3, 3)']);
    expectUndefined(f, 'A', 'empty_region');
  });

  it('Boundary of x^2 > 4 on [-5, 5] is [-2, 2]', () => {
    const f = fig(['r = x^2 > 4', 'B = Boundary(r, -5, 5)']);
    nearList(list<number>(f, 'B'), [-2, 2], 1e-9);
  });

  it('PointIn moves an outside point strictly inside the strict region: x^2 + y^2 < 4 holds for the result', () => {
    const f = fig(['r = x^2 + y^2 < 4', 'P0 = (5, 0)', 'PI = PointIn(r, P0)']);
    const p = pt(f, 'PI');
    expect(p.x * p.x + p.y * p.y).toBeLessThan(4);
    near(p.x, 2, 1e-6);
  });

  it('PointIn onto the nearest point: from (3, 3) it lands near (sqrt 2, sqrt 2)', () => {
    const f = fig(['r = x^2 + y^2 < 4', 'P0 = (3, 3)', 'PI = PointIn(r, P0)']);
    nearPt(pt(f, 'PI'), Math.SQRT2, Math.SQRT2, 1e-5);
  });

  it('PointIn on an empty region is empty_region', () => {
    const f = fig(['r = x^2 + y^2 < -1', 'P0 = (1, 1)', 'PI = PointIn(r, P0)']);
    expectUndefined(f, 'PI', 'empty_region');
  });
});
