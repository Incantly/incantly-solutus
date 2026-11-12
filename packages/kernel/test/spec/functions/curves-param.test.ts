/**
 * Parametric curves, Bezier, Spline, Polar, and curve queries (curves-loci design.md sections 1, 5, 8, 13;
 * errors.md 1 and 2).
 */
import { describe, expect, it } from 'vitest';
import {
  curveVal,
  distToLine,
  expectLine,
  expectUndefined,
  fails,
  fig,
  isHorizontal,
  lineOf,
  near,
  nearPt,
  num,
  pt,
  reasonOf,
  setFree,
  slopeOf,
  useTimeout,
  val,
  within,
  xy,
} from './helpers';

useTimeout();

const CIRCLE = 'cc = Curve(cos(s), sin(s), s, 0, tau)';

describe('Curve(x(s), y(s), s, a, b): parametric curves (1, 5)', () => {

  it('the curve is parametric with the given range', () => {
    const f = fig(CIRCLE);
    const c = curveVal(f, 'cc');
    expect(c.curve).toBe('param');
    near(c.lo as number, 0, 1e-12);
    near(c.hi as number, 2 * Math.PI, 1e-12);
  });

  it('the formulas are evaluated at a parameter: the unit circle at pi/3', () => {
    const f = fig(CIRCLE);
    const [x, y] = xy(f, 'cc', Math.PI / 3);
    near(x, 0.5, 1e-12);
    near(y, Math.sqrt(3) / 2, 1e-12);
  });

  it('a full turn is flagged closed (end equals start)', () => {
    const f = fig(CIRCLE);
    expect(curveVal(f, 'cc').closed).toBe(true);
  });

  it('an empty range (a == b) is bad_argument', () => {
    fails(fig([]), 'cc = Curve(cos(s), sin(s), s, 1, 1)', 'bad_argument');
  });

  it('a reversed range (b < a) is bad_argument with a hint about low-to-high ranges', () => {
    const e = fails(fig([]), 'cc = Curve(cos(s), sin(s), s, 3, 1)', 'bad_argument');
    expect(e.hint ?? '').not.toBe('');
  });

  it('an infinite range is not supported for plotting: missing_range or bad_argument', () => {
    fails(fig([]), 'cc = Curve(cos(s), sin(s), s, -inf, inf)', ['missing_range', 'bad_argument']);
  });

});

describe('Parametric curve lines: c(s) = (x(s), y(s)) in a..b (5, errors 1)', () => {
  it('the line form makes a Curve (not a Function)', () => {
    const f = fig('cc(s) = (2 * cos(s), sin(s)) in 0..tau');
    expect(f.get('cc')?.type).toBe('Curve');
  });

  it('the line form evaluates like the command form', () => {
    const f = fig('cc(s) = (2 * cos(s), sin(s)) in 0..tau');
    const [x, y] = xy(f, 'cc', Math.PI / 2);
    near(x, 0, 1e-12);
    near(y, 1, 1e-12);
  });

  // to be implemented: contested: language design 3.10 keeps f(x) = (x, x^2) as a Function<Point>; needs a ruling
  it.skip('a pair without a range is missing_range, pointing at the end of the line', () => {
    const e = fails(fig([]), 'cc(s) = (cos(s), sin(s))', 'missing_range');
    expect(e.hint ?? '').toMatch(/in 0\.\.tau|in 0\.\./);
  });

});

describe('Polar(r, θ, a, b) (5)', () => {
  it('a circle r = 2 is a Curve through (2, 0) and (0, 2)', () => {
    const f = fig('pc = Polar(2, θ, 0, tau)');
    expect(f.get('pc')?.type).toBe('Curve');
    nearPt({ x: xy(f, 'pc', 0)[0], y: xy(f, 'pc', 0)[1] }, 2, 0, 1e-12);
    nearPt({ x: xy(f, 'pc', Math.PI / 2)[0], y: xy(f, 'pc', Math.PI / 2)[1] }, 0, 2, 1e-12);
  });

  it('the rose r = sin(3 θ) at θ = pi/6 is the point (cos pi/6, sin pi/6)', () => {
    const f = fig('pc = Polar(sin(3 * θ), θ, 0, tau)');
    const [x, y] = xy(f, 'pc', Math.PI / 6);
    near(x, Math.cos(Math.PI / 6), 1e-12);
    near(y, Math.sin(Math.PI / 6), 1e-12);
  });

  it('an unbound angle name is unknown_name with a hint about θ', () => {
    const e = fails(fig([]), 'pc = Polar(sin(2 * u), θ, 0, tau)', ['unknown_name', 'free_variable']);
    expect(`${e.hint ?? ''} ${e.message}`).toMatch(/θ|angle|theta/i);
  });

});

describe('Derivative, Slope, Tangent, Normal of parametric curves (5)', () => {
  it('Derivative(c) is the curve (x\', y\'): for the unit circle at pi/3 it is (-sin, cos)', () => {
    const f = fig([CIRCLE, 'dc = Derivative(cc)']);
    const [x, y] = xy(f, 'dc', Math.PI / 3);
    near(x, -Math.sin(Math.PI / 3), 1e-8);
    near(y, Math.cos(Math.PI / 3), 1e-8);
  });

  it('Slope(c, s) is dy/dx: the unit circle at pi/4 has slope -1', () => {
    const f = fig([CIRCLE, 'm = Slope(cc, pi / 4)']);
    near(num(f, 'm'), -1, 1e-7);
  });

  it('Slope at a singular point (both derivatives zero) is undefined with singular_point', () => {
    const f = fig(['cu = Curve(s^2, s^3, s, -1, 1)', 'm = Slope(cu, 0)']);
    expectUndefined(f, 'm', 'singular_point');
  });

  it('Slope(c) with no parameter is the curve (x(s), dy/dx)', () => {
    const f = fig([CIRCLE, 'sc = Slope(cc)']);
    expect(f.get('sc')?.type).toBe('Curve');
    const [x, y] = xy(f, 'sc', Math.PI / 4);
    near(x, Math.SQRT1_2, 1e-9);
    near(y, -1, 1e-7);
  });

  it('Tangent(c, s) of the unit circle at pi/2 is y = 1', () => {
    const f = fig([CIRCLE, 'T = Tangent(cc, pi / 2)']);
    expectLine(lineOf(f, 'T'), 0, 1, 1e-7);
  });

  it('Tangent(c, pi/4) is x + y = sqrt 2', () => {
    const f = fig([CIRCLE, 'T = Tangent(cc, pi / 4)']);
    const l = lineOf(f, 'T');
    near(slopeOf(l), -1, 1e-7);
    expect(distToLine(l, Math.SQRT1_2, Math.SQRT1_2)).toBeLessThan(1e-8);
  });

  it('Tangent at a cusp uses the first non-zero higher derivative: the semicubical cusp (s^2, s^3) has the x-axis at s = 0 (design 5 over errors.md: silent-doc choice)', () => {
    const f = fig(['cu = Curve(s^2, s^3, s, -1, 1)', 'T = Tangent(cu, 0)']);
    const l = lineOf(f, 'T');
    expect(isHorizontal(l)).toBe(true);
    expect(distToLine(l, 0, 0)).toBeLessThan(1e-9);
  });

  it('Tangent follows a slider parameter: slope of the unit circle at s is -cot(s)', () => {
    const f = fig(['k = 1 in 0..6 step 0.1', CIRCLE, 'T = Tangent(cc, k)']);
    setFree(f, 'k', 1.6);
    near(slopeOf(lineOf(f, 'T')), -1 / Math.tan(1.6), 1e-6);
  });

  it('Tangent outside the parameter range is undefined with out_of_range or curve_undefined_at_param', () => {
    const f = fig(['cc = Curve(cos(s), sin(s), s, 0, pi)', 'T = Tangent(cc, 5)']);
    expectUndefined(f, 'T', ['out_of_range', 'curve_undefined_at_param']);
  });

});

describe('Curvature, CurvatureVector, OsculatingCircle of parametric curves (5)', () => {
  it('the unit circle has curvature +1 (counter-clockwise)', () => {
    const f = fig([CIRCLE, 'k = Curvature(cc, 0.5)']);
    near(num(f, 'k'), 1, 1e-6);
  });

  it('the ellipse (2 cos, sin) has curvature 2 at s = 0 and 1/4 at s = pi/2', () => {
    const f = fig(['cc = Curve(2 * cos(s), sin(s), s, 0, tau)', 'k0 = Curvature(cc, 0)', 'k1 = Curvature(cc, pi / 2)']);
    near(num(f, 'k0'), 2, 1e-6);
    near(num(f, 'k1'), 0.25, 1e-6);
  });

  it('the osculating circle of the ellipse (2 cos, sin) at s = 0 has radius 0.5 and centre (1.5, 0)', () => {
    const f = fig(['cc = Curve(2 * cos(s), sin(s), s, 0, tau)', 'O = OsculatingCircle(cc, 0)']);
    const c = val<{ cx: number; cy: number; r: number }>(f, 'O');
    near(c.r, 0.5, 1e-6);
    near(c.cx, 1.5, 1e-6);
    near(c.cy, 0, 1e-6);
  });

  it('a straight line has no osculating circle: undefined with infinite_radius', () => {
    const f = fig(['cl = Curve(s, 2 * s + 1, s, -3, 3)', 'O = OsculatingCircle(cl, 1)']);
    expectUndefined(f, 'O', 'infinite_radius');
  });

  it('CurvatureVector of the unit circle at s = 0 is (-1, 0), pointing at the centre', () => {
    const f = fig([CIRCLE, 'V = CurvatureVector(cc, 0)']);
    const v = val<{ x: number; y: number }>(f, 'V');
    near(v.x, -1, 1e-6);
    near(v.y, 0, 1e-6);
  });

});

describe('Length of parametric curves (5)', () => {
  it('Length(c) of the unit circle is 2 pi', () => {
    const f = fig([CIRCLE, 'L = Length(cc)']);
    near(num(f, 'L'), 2 * Math.PI, 1e-9);
  });

  it('the ellipse (2 cos, sin) has perimeter 9.688448220547675', () => {
    const f = fig(['ce = Curve(2 * cos(s), sin(s), s, 0, tau)', 'L = Length(ce)']);
    near(num(f, 'L'), 9.688448220547675, 1e-8);
  });

  it('the parabola (s, s^2) over [0, 1] has length sqrt(5)/2 + asinh(2)/4', () => {
    const f = fig(['cp = Curve(s, s^2, s, 0, 1)', 'L = Length(cp)']);
    near(num(f, 'L'), Math.sqrt(5) / 2 + Math.asinh(2) / 4, 1e-9);
  });

  it('the cusp curve (s^2, s^3) over [0, 1] has length (13 sqrt 13 - 8)/27 (split where the speed vanishes)', () => {
    const f = fig(['cu = Curve(s^2, s^3, s, 0, 1)', 'L = Length(cu)']);
    near(num(f, 'L'), (13 * Math.sqrt(13) - 8) / 27, 1e-9);
  });

});

describe('Bezier (8)', () => {
  const pts = '[(0, 0), (1, 2), (2, 2), (3, 0)]';

  it('the parameter runs 0..1: the tangent at 0 points along the first control leg (slope 2) through (0, 0)', () => {
    const f = fig([`bz = Bezier(${pts})`, 'T = Tangent(bz, 0)']);
    const l = lineOf(f, 'T');
    near(slopeOf(l), 2, 1e-6);
    expect(distToLine(l, 0, 0)).toBeLessThan(1e-8);
  });

  it('the tangent at 1 points along the last control leg (slope -2) through (3, 0)', () => {
    const f = fig([`bz = Bezier(${pts})`, 'T = Tangent(bz, 1)']);
    const l = lineOf(f, 'T');
    near(slopeOf(l), -2, 1e-6);
    expect(distToLine(l, 3, 0)).toBeLessThan(1e-8);
  });

  it('at the middle (parameter 0.5) the curve is at (1.5, 1.5) with a horizontal tangent', () => {
    const f = fig([`bz = Bezier(${pts})`, 'T = Tangent(bz, 0.5)']);
    const l = lineOf(f, 'T');
    expect(isHorizontal(l)).toBe(true);
    near(l.c / l.b, 1.5, 1e-7);
  });

  it('a quadratic Bezier (degree count - 1 = 2) has midpoint (1, 1) for control (0,0), (1,2), (2,0)', () => {
    const f = fig(['bz = Bezier([(0, 0), (1, 2), (2, 0)])', 'T = Tangent(bz, 0.5)']);
    const l = lineOf(f, 'T');
    expect(isHorizontal(l)).toBe(true);
    near(l.c / l.b, 1, 1e-7);
  });

  it('more than 12 points is a limit error', () => {
    const many = Array.from({ length: 13 }, (_, i) => `(${i}, ${i % 3})`).join(', ');
    fails(fig([]), `bz = Bezier([${many}])`, 'limit');
  });
});

describe('Spline (8)', () => {
  const four = '[(0, 0), (1, 2), (2, 1), (3, 3)]';

  it('the natural spline passes through its control points: Closest to (1, 2) is (1, 2)', () => {
    const f = fig([`sp = Spline(${four})`, 'cl = Closest(sp, (1, 2))']);
    nearPt(pt(f, 'cl'), 1, 2, 1e-6);
  });

  it('closed = true makes a closed curve through the first point again', () => {
    const f = fig([`sp = Spline(${four}, closed = true)`]);
    expect(curveVal(f, 'sp').closed).toBe(true);
  });

  it('a bad kind is bad_argument with the allowed kinds', () => {
    const e = fails(fig([]), `sp = Spline(${four}, kind = "cosine")`, 'bad_argument');
    expect(JSON.stringify(e.params) + e.message).toMatch(/natural|centripetal/);
  });

  it('a straight run of collinear points gives a straight spline of the same length', () => {
    const f = fig(['sp = Spline([(0, 0), (1, 1), (2, 2), (3, 3)])', 'L = Length(sp)']);
    near(num(f, 'L'), 3 * Math.SQRT2, 1e-6);
  });

});

describe('Closest(c, P) on parametric curves (5)', () => {
  it('the closest point of the unit circle to (3, 4) is (0.6, 0.8)', () => {
    const f = fig([CIRCLE, 'cl = Closest(cc, (3, 4))']);
    nearPt(pt(f, 'cl'), 0.6, 0.8, 1e-9);
  });

  it('the closest point of the parabola (s, s^2) to (0, 3) has the global minimum distance', () => {
    const f = fig(['cp = Curve(s, s^2, s, -3, 3)', 'cl = Closest(cp, (0, 3))']);
    const p = pt(f, 'cl');
    // Minimising x^2 + (x^2 - 3)^2: x^2 = 2.5.
    near(Math.abs(p.x), Math.sqrt(2.5), 1e-8);
    near(p.y, 2.5, 1e-8);
  });

});

describe('Parametric curve edge cases (13)', () => {

  it('a huge parameter range is cheap to define and query: s in 0..1000', () => {
    const f = within(1000, () => fig(['sp = Curve(s * cos(s), s * sin(s), s, 0, 1000)', 'T = Tangent(sp, 3)']));
    expect(reasonOf(f, 'T')).toBeUndefined();
  });

  it('a Lissajous figure has the Length of its speed integral (checked by a 200000-step midpoint rule in the test)', () => {
    const f = fig(['li = Curve(sin(3 * s), sin(2 * s), s, 0, tau)', 'L = Length(li)']);
    const n = 200000;
    const h = (2 * Math.PI) / n;
    let want = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * h;
      want += Math.hypot(3 * Math.cos(3 * t), 2 * Math.cos(2 * t)) * h;
    }
    near(num(f, 'L'), want, 1e-8);
  });

  it('a curve with an undefined input is undefined with input_undefined, not a throw', () => {
    const f = fig(['k = sqrt(-1)', 'cc = Curve(k * cos(s), sin(s), s, 0, tau)']);
    expectUndefined(f, 'cc', 'input_undefined');
  });

});
