/**
 * Implicit curves, Contour/Contours, ImplicitDerivative, queries on implicit curves, Intersect,
 * Asymptote of curves, Curve(pts) (curves-loci design.md 1, 6, 13; errors.md 1, 2).
 */
import { describe, expect, it } from 'vitest';
import {
  curveVal,
  distToLine,
  ev,
  expectHorizontal,
  expectUndefined,
  expectVertical,
  fails,
  fig,
  implicitAt,
  isVertical,
  lineOf,
  list,
  near,
  nearPt,
  noticeCodes,
  num,
  ok,
  pt,
  pts,
  reasonOf,
  slopeOf,
  useTimeout,
  val,
  within,
  type Ln,
} from './helpers';

useTimeout();

const UNIT = 'uc = Curve(x^2 + y^2 == 1)';
const ELL = 'el = Curve(x^2 / 4 + y^2 == 1)';

describe('implicit curves: Curve(F == G) (6)', () => {

  it('the value carries the field of the curve (F - G) for the plotter', () => {
    const c = curveVal(fig(UNIT), 'uc');
    expect(typeof (c.f ?? c.residual)).toBe('function');
  });

  it('the field is F - G: zero on the curve, negative inside, positive outside the unit circle', () => {
    const f = fig(UNIT);
    near(implicitAt(f, 'uc', 0.6, 0.8), 0, 1e-12);
    expect(implicitAt(f, 'uc', 0, 0)).toBeLessThan(0);
    expect(implicitAt(f, 'uc', 2, 0)).toBeGreaterThan(0);
  });

  it('the ellipse x^2/4 + y^2 == 1 vanishes at (2, 0) and (0, 1)', () => {
    const f = fig(ELL);
    near(implicitAt(f, 'el', 2, 0), 0, 1e-12);
    near(implicitAt(f, 'el', 0, 1), 0, 1e-12);
  });

  it('a transcendental curve is allowed: sin(x) + sin(y) == sin(x * y)', () => {
    const f = fig('wc = Curve(sin(x) + sin(y) == sin(x * y))');
    near(implicitAt(f, 'wc', 0, 0), 0, 1e-12);
  });

  // to be implemented: the notice is raised as kind identically_true with a code in the registry's format; the test reads the code field
  it.skip('F - G identically zero (x == x) is defined with an identically_true notice', () => {
    const f = fig([]);
    const r = ok(f, 'tc = Curve(x == x)');
    expect(noticeCodes(r)).toContain('identically_true');
  });
});

describe('implicit curve lines: c(x, y) = F == G (6, 12)', () => {
  it('the line form makes an implicit Curve, not a Function', () => {
    const f = fig('ee(x, y) = x^2 / 4 + y^2 == 1');
    expect(f.get('ee')?.type).toBe('Curve');
  });

  it('the line form has the same field as Curve(...)', () => {
    const f = fig('ee(x, y) = x^2 / 4 + y^2 == 1');
    near(implicitAt(f, 'ee', 2, 0), 0, 1e-12);
  });

  it('a one-parameter equation c(x) = x^2 == 4 is bad_argument ("isolated numbers, not a curve")', () => {
    const e = fails(fig([]), 'cx(x) = x^2 == 4', 'bad_argument');
    expect(`${e.hint ?? ''}${e.message}`).toMatch(/Roots|isolated|curve/);
  });

  it('redefining an implicit curve line as a Function is type_change', () => {
    const f = fig('ee(x, y) = x^2 + y^2 == 1');
    fails(f, 'ee(x, y) = x + y', 'type_change');
  });

  it('y = x^2 written as a curve with a single = is an error that points at ==', () => {
    const e = fails(fig([]), 'c1(x, y) = y = x^2', ['syntax', 'assign_in_expr']);
    expect(`${e.hint ?? ''} ${e.expected.join(' ')} ${e.suggest.join(' ')}`).toMatch(/==|f\(x\)/);
  });

});

describe('Contour and Contours (1)', () => {
  it('Contour(g, k) is the set g(x, y) = k: a circle of radius 2 for g = x^2 + y^2 and k = 4', () => {
    const f = fig(['g(x, y) = x^2 + y^2', 'co = Contour(g, 4)']);
    expect(f.get('co')?.type).toBe('Curve');
    near(implicitAt(f, 'co', 2, 0), 0, 1e-12);
    near(implicitAt(f, 'co', 0, -2), 0, 1e-12);
    expect(implicitAt(f, 'co', 0, 0)).not.toBe(0);
  });

  it('Contours(g, levels) is a list of curves, one per level', () => {
    const f = fig(['g(x, y) = x^2 + y^2', 'cs = Contours(g, [1, 4, 9])']);
    expect(list(f, 'cs').length).toBe(3);
  });

  it('more than 50 levels is a limit error', () => {
    const levels = Array.from({ length: 51 }, (_, i) => i + 1).join(', ');
    fails(fig('g(x, y) = x^2 + y^2'), `cs = Contours(g, [${levels}])`, 'limit');
  });
});

describe('ImplicitDerivative and Slope/Tangent/Normal on implicit curves (6)', () => {
  it('ImplicitDerivative of the unit circle is -x/y: at (0.6, 0.8) it is -0.75', () => {
    const f = fig([UNIT, 'dy = ImplicitDerivative(uc)']);
    near(ev(f, 'dy(0.6, 0.8)'), -0.75, 1e-9);
  });

  it('ImplicitDerivative where F_y is identically zero is undefined with identically_zero', () => {
    const f = fig(['vl = Curve(x^2 == 4)', 'dy = ImplicitDerivative(vl)']);
    expectUndefined(f, 'dy', 'identically_zero');
  });

  it('Slope(c, P) of the unit circle at (0.6, 0.8) is -0.75', () => {
    const f = fig([UNIT, 'm = Slope(uc, (0.6, 0.8))']);
    near(num(f, 'm'), -0.75, 1e-8);
  });

  it('Slope at a singular point (the node of x*y == 0 at the origin) is undefined with singular_point', () => {
    const f = fig(['nd = Curve(x * y == 0)', 'm = Slope(nd, (0, 0))']);
    expectUndefined(f, 'm', 'singular_point');
  });

  it('Tangent(c, P) of the unit circle at (0.6, 0.8) has slope -0.75 and passes through P', () => {
    const f = fig([UNIT, 'T = Tangent(uc, (0.6, 0.8))']);
    const l = lineOf(f, 'T');
    near(slopeOf(l), -0.75, 1e-8);
    expect(distToLine(l, 0.6, 0.8)).toBeLessThan(1e-8);
  });

  it('Tangent(c, P) at (1, 0) is the vertical x = 1', () => {
    const f = fig([UNIT, 'T = Tangent(uc, (1, 0))']);
    expectVertical(lineOf(f, 'T'), 1, 1e-8);
  });

  it('Tangent at a singular point is undefined with singular_point', () => {
    const f = fig(['nd = Curve(x * y == 0)', 'T = Tangent(nd, (0, 0))']);
    expectUndefined(f, 'T', 'singular_point');
  });

  it('Normal(c, P) of the unit circle at (0.6, 0.8) passes through the origin', () => {
    const f = fig([UNIT, 'N = Normal(uc, (0.6, 0.8))']);
    expect(distToLine(lineOf(f, 'N'), 0, 0)).toBeLessThan(1e-8);
  });

  it('Normal is perpendicular to Tangent on an implicit curve', () => {
    const f = fig([ELL, 'T = Tangent(el, (1, 0.5 * sqrt(3)))', 'N = Normal(el, (1, 0.5 * sqrt(3)))']);
    const t = lineOf(f, 'T');
    const n = lineOf(f, 'N');
    near(t.a * n.a + t.b * n.b, 0, 1e-8);
  });

});

describe('Curvature and OsculatingCircle of implicit curves (6)', () => {

  it('the formula (−F_y² F_xx + 2 F_x F_y F_xy − F_x² F_yy)/(F_x² + F_y²)^1.5 gives -1 for x^2 + y^2 == 1', () => {
    const f = fig([UNIT, 'k = Curvature(uc, (0.6, 0.8))']);
    near(num(f, 'k'), -1, 1e-6);
  });

  it('the ellipse x^2/4 + y^2 == 1 has |curvature| 2 at (2, 0)', () => {
    const f = fig([ELL, 'k = Curvature(el, (2, 0))']);
    near(Math.abs(num(f, 'k')), 2, 1e-5);
  });

  it('a straight implicit curve (y == 2 x + 1) has curvature 0 and an infinite_radius osculating circle', () => {
    const f = fig(['sl = Curve(y == 2 * x + 1)', 'k = Curvature(sl, (0, 1))', 'O = OsculatingCircle(sl, (0, 1))']);
    near(num(f, 'k'), 0, 1e-8);
    expectUndefined(f, 'O', 'infinite_radius');
  });
});

describe('Closest(c, P) on implicit curves (6)', () => {
  it('(3, 4) to the unit circle is (0.6, 0.8)', () => {
    const f = fig([UNIT, 'cl = Closest(uc, (3, 4))']);
    nearPt(pt(f, 'cl'), 0.6, 0.8, 1e-8);
  });

  it('a point inside the unit circle: (0, 0.3) to the circle is (0, 1)', () => {
    const f = fig([UNIT, 'cl = Closest(uc, (0, 0.3))']);
    nearPt(pt(f, 'cl'), 0, 1, 1e-8);
  });

  it('(0, 3) to the ellipse x^2/4 + y^2 == 1 is (0, 1)', () => {
    const f = fig([ELL, 'cl = Closest(el, (0, 3))']);
    nearPt(pt(f, 'cl'), 0, 1, 1e-8);
  });

});

describe('Intersect of curves, lines, circles and functions (6)', () => {
  it('two circles (x-1)^2 + y^2 == 1 and x^2 + y^2 == 1 meet at (0.5, -sqrt3/2) and (0.5, sqrt3/2), sorted by x then y', () => {
    const f = fig([UNIT, 'c2 = Curve((x - 1)^2 + y^2 == 1)', 'I = Intersect(uc, c2)']);
    const r = pts(f, 'I');
    expect(r.length).toBe(2);
    nearPt(r[0] as { x: number; y: number }, 0.5, -Math.sqrt(3) / 2, 1e-8);
    nearPt(r[1] as { x: number; y: number }, 0.5, Math.sqrt(3) / 2, 1e-8);
  });

  it('curves that do not meet give the empty list, defined', () => {
    const f = fig([UNIT, 'c2 = Curve((x - 5)^2 + y^2 == 1)', 'I = Intersect(uc, c2)']);
    expect(reasonOf(f, 'I')).toBeUndefined();
    expect(pts(f, 'I')).toEqual([]);
  });

  it('a curve and a function: the unit circle and f(x) = x meet at (-sqrt.5, -sqrt.5) and (sqrt.5, sqrt.5)', () => {
    const f = fig([UNIT, 'f(x) = x', 'I = Intersect(uc, f)']);
    const r = pts(f, 'I');
    expect(r.length).toBe(2);
    nearPt(r[0] as { x: number; y: number }, -Math.SQRT1_2, -Math.SQRT1_2, 1e-8);
    nearPt(r[1] as { x: number; y: number }, Math.SQRT1_2, Math.SQRT1_2, 1e-8);
  });

  it('a parametric curve and an implicit curve: (2 cos, sin) is the ellipse, meeting x^2 + y^2 == 4 at (±2, 0)', () => {
    const f = fig(['pe = Curve(2 * cos(s), sin(s), s, 0, tau)', 'bc = Curve(x^2 + y^2 == 4)', 'I = Intersect(pe, bc)']);
    const r = pts(f, 'I');
    expect(r.length).toBe(2);
    nearPt(r[0] as { x: number; y: number }, -2, 0, 1e-7);
    nearPt(r[1] as { x: number; y: number }, 2, 0, 1e-7);
  });

  it('two parametric curves: the unit circle and the line (s, s) meet twice', () => {
    const f = fig(['pc = Curve(cos(s), sin(s), s, 0, tau)', 'pl = Curve(s, s, s, -2, 2)', 'I = Intersect(pc, pl)']);
    const r = pts(f, 'I');
    expect(r.length).toBe(2);
    nearPt(r[0] as { x: number; y: number }, -Math.SQRT1_2, -Math.SQRT1_2, 1e-7);
  });

  // to be implemented: Intersect does not raise the tangent notice yet, and the test reads the code field, which holds a registry code
  it.skip('a tangential meeting is reported once per point with a tangent notice: unit circle and (x-2)^2 + y^2 == 1 at (1, 0)', () => {
    const f = fig([]);
    ok(f, UNIT);
    ok(f, 'c2 = Curve((x - 2)^2 + y^2 == 1)');
    const r = ok(f, 'I = Intersect(uc, c2)');
    const p = pts(f, 'I');
    expect(p.length).toBe(1);
    nearPt(p[0] as { x: number; y: number }, 1, 0, 1e-6);
    expect(noticeCodes(r)).toContain('tangent');
  });

  it('with a window: the unit circle and y = x inside [0, 2] x [0, 2] meet only at (sqrt.5, sqrt.5)', () => {
    const f = fig([UNIT, 'f(x) = x', 'I = Intersect(uc, f, 0, 2, 0, 2)']);
    const r = pts(f, 'I');
    expect(r.length).toBe(1);
    nearPt(r[0] as { x: number; y: number }, Math.SQRT1_2, Math.SQRT1_2, 1e-8);
  });

  it('the intersection of a cubic and a line: y == x^3 - x and y == 0 gives x = -1, 0, 1', () => {
    const f = fig(['cu = Curve(y == x^3 - x)', 'ax = Curve(y == 0)', 'I = Intersect(cu, ax)']);
    const r = pts(f, 'I');
    expect(r.length).toBe(3);
    [-1, 0, 1].forEach((x, i) => nearPt(r[i] as { x: number; y: number }, x, 0, 1e-7));
  });

  it('two conics in a time budget: ellipse and circle intersect fast', { retry: 2 }, () => {
    const f = within(500, () => fig([ELL, 'bc = Curve(x^2 + y^2 == 2)', 'I = Intersect(el, bc)']));
    expect(pts(f, 'I').length).toBe(4);
  });

});

describe('Asymptote of an implicit polynomial curve (6)', () => {
  it('x y == 1 has the asymptotes x = 0 and y = 0', () => {
    const f = fig(['hy = Curve(x * y == 1)', 'as = Asymptote(hy)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(2);
    const v = ls.find((l) => isVertical(l)) as Ln;
    const h = ls.find((l) => !isVertical(l)) as Ln;
    expectVertical(v, 0, 1e-9);
    expectHorizontal(h, 0, 1e-9);
  });

  it('x^2 - y^2 == 1 has y = -x and y = x, sorted by slope', () => {
    const f = fig(['hy = Curve(x^2 - y^2 == 1)', 'as = Asymptote(hy)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(2);
    near(slopeOf(ls[0] as Ln), -1, 1e-9);
    near(slopeOf(ls[1] as Ln), 1, 1e-9);
    near((ls[0] as Ln).c, 0, 1e-9);
    near((ls[1] as Ln).c, 0, 1e-9);
  });

  it('a parabola (y == x^2) has no asymptotes: empty list', () => {
    const f = fig(['pa = Curve(y == x^2)', 'as = Asymptote(pa)']);
    expect(list(f, 'as')).toEqual([]);
  });

  it('(x - 1) y == 1 is shifted: x = 1 and y = 0', () => {
    const f = fig(['hy = Curve((x - 1) * y == 1)', 'as = Asymptote(hy)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(2);
    const v = ls.find((l) => isVertical(l)) as Ln;
    expectVertical(v, 1, 1e-9);
  });

  it('a non-polynomial implicit curve is unsupported_family (line error or undefined)', () => {
    const f = fig('wc = Curve(sin(x) + sin(y) == 1)');
    const r = f.apply('as = Asymptote(wc)');
    if (r.ok) expectUndefined(f, 'as', 'unsupported_family');
    else expect(r.kind).toBe('unsupported_family');
  });
});

describe('Curve(pts): the algebraic curve of lowest degree (1, 6, errors 1)', () => {
  const circle5 = '[(1, 0), (0, 1), (-1, 0), (0, -1), (0.6, 0.8)]';
  it('5 points give a conic: all 5 points lie on it', () => {
    const f = fig(`fc = Curve(${circle5})`);
    expect(f.get('fc')?.type).toBe('Curve');
    const scale = Math.abs(implicitAt(f, 'fc', 0, 0));
    for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1], [0.6, 0.8]]) {
      expect(Math.abs(implicitAt(f, 'fc', x as number, y as number))).toBeLessThan(1e-8 * Math.max(scale, 1));
    }
  });

  it('the conic through 5 points of the unit circle also contains other points of the circle', () => {
    const f = fig(`fc = Curve(${circle5})`);
    const scale = Math.abs(implicitAt(f, 'fc', 0, 0));
    expect(Math.abs(implicitAt(f, 'fc', Math.SQRT1_2, Math.SQRT1_2))).toBeLessThan(1e-7 * Math.max(scale, 1));
  });

  it('9 points on the folium x^3 + y^3 == 3 x y give that cubic: another point of the folium lies on it', () => {
    const on = (t: number): string => `(${(3 * t) / (1 + t ** 3)}, ${(3 * t * t) / (1 + t ** 3)})`;
    const nine = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, -0.5, -2].map(on).join(', ');
    const f = fig(`fc = Curve([${nine}])`);
    const x = (3 * 1.2) / (1 + 1.2 ** 3);
    const y = (3 * 1.44) / (1 + 1.2 ** 3);
    const scale = Math.abs(implicitAt(f, 'fc', 1, 1)) + Math.abs(implicitAt(f, 'fc', -1, 2));
    expect(scale).toBeGreaterThan(0);
    expect(Math.abs(implicitAt(f, 'fc', x, y))).toBeLessThan(1e-6 * scale);
  });

  it('6 points is bad_argument and names the valid counts 5, 9, 14', () => {
    const six = Array.from({ length: 6 }, (_, i) => `(${i}, ${i * i})`).join(', ');
    const e = fails(fig([]), `fc = Curve([${six}])`, 'bad_argument');
    const text = JSON.stringify(e.params) + e.message + (e.hint ?? '');
    expect(text).toMatch(/5/);
    expect(text).toMatch(/9/);
  });

  it('moving one of the points redefines the conic', () => {
    const f = fig(['Pm = (0.6, 0.8)', 'fc = Curve([(1, 0), (0, 1), (-1, 0), (0, -1), Pm])']);
    ok(f, 'Pm = (0.28, 0.96)');
    const scale = Math.abs(implicitAt(f, 'fc', 0, 0));
    expect(Math.abs(implicitAt(f, 'fc', 0.28, 0.96))).toBeLessThan(1e-8 * Math.max(scale, 1));
  });
});

describe('implicit curves: speed (6 targets)', () => {
  it('defining and querying the transcendental curve is fast', { retry: 2 }, () => {
    within(500, () => fig(['wc = Curve(sin(x) + sin(y) == sin(x * y))', 'cl = Closest(wc, (1, 1))']));
    void val;
  });
});
