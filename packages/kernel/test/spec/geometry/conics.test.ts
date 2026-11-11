/**
 * Circles, arcs, sectors, conic constructors, conic kinds and properties, measures of conics.
 * Docs: conics/design.md 1.1, 3.3, 4.1 to 4.6, 5; conics/errors.md 3, 4; conics/agent.md 2.
 */
import { describe, expect, it, vi } from 'vitest';
import { bad, evalIn, fig, near, nearPt, num, ok, tryLine, undefIn, val, type V2 } from './helpers';

vi.setConfig({ testTimeout: 5000 });

const PI = Math.PI;
const O = ['O = (0, 0)', 'c = Circle(O, 2)'];
const EL = ['el = Ellipse((-3, 0), (3, 0), 5)'];
const HY = ['h = Hyperbola((-5, 0), (5, 0), 3)'];
const PA = ['pa = Parabola((0, 1), Line((-5, -1), (5, -1)))'];
const nm = (base: string[], expr: string): number => evalIn<number>(base, expr);

/** Perimeter of an ellipse by Simpson's rule on the parametrisation (independent of the code under test). */
function ellipseCircumference(a: number, b: number): number {
  const n = 200000;
  const f = (t: number) => Math.hypot(a * Math.sin(t), b * Math.cos(t));
  let s = f(0) + f(PI / 2);
  for (let k = 1; k < n; k++) s += f((k * PI) / 2 / n) * (k % 2 === 1 ? 4 : 2);
  return 4 * (s * (PI / 2 / n)) / 3;
}

describe('circles', () => {
  it('Circle(C, r) has the given centre and radius', () => {
    const f = fig([...O, 'r = Radius(c)', 'ctr = Center(c)']);
    near(num(f, 'r'), 2);
    nearPt(val(f, 'ctr'), 0, 0);
  });
  it('Circle(C, segment) takes the live length of the segment as radius', () => {
    const f = fig(['C = (0, 0)', 'B = (3, 0)', 's = Segment(C, B)', 'k = Circle(C, s)', 'r = Radius(k)']);
    ok(f.apply('B = (6, 8)'));
    near(num(f, 'r'), 10);
  });
  it('Circle(A, B, C) is the circumcircle: the 3-4-5 triangle has centre (2, 1.5) and radius 2.5', () => {
    const f = fig(['A = (0, 0)', 'B = (4, 0)', 'C = (0, 3)', 'k = Circle(A, B, C)', 'r = Radius(k)', 'ctr = Center(k)']);
    near(num(f, 'r'), 2.5, 1e-12);
    nearPt(val(f, 'ctr'), 2, 1.5, 1e-12);
  });
  it('Circle(A, B, C) of three collinear points is undefined: collinear', () => expect(undefIn(['A = (0, 0)', 'B = (1, 1)', 'C = (2, 2)'], 'Circle(A, B, C)')).toBe('collinear'));
  it('Circle(A, B, C) far from the origin keeps its accuracy (relative coordinates)', () => {
    const f = fig(['A = (1e6, 1e6)', 'B = (1e6 + 4, 1e6)', 'C = (1e6, 1e6 + 3)', 'k = Circle(A, B, C)', 'r = Radius(k)']);
    near(num(f, 'r'), 2.5, 1e-9);
  });
  it('a negative radius from a variable is undefined: negative_radius', () => expect(undefIn(['r0 = -1', 'O = (0, 0)'], 'Circle(O, r0)')).toBe('negative_radius'));
  it('a literal negative radius is a bad_argument error', () => bad(tryLine(['O = (0, 0)'], 'k = Circle(O, -2)'), 'bad_argument'));
  it('radius 0 is a degenerate circle (a dot), defined, so a slider through 0 does not blink', () => {
    const f = fig(['O = (0, 0)', 'r0 = 0', 'k = Circle(O, r0)']);
    expect(f.cellOf('k')!.defined).toBe(true);
    near(nm(['O = (0, 0)', 'r0 = 0', 'k = Circle(O, r0)'], 'Radius(k)'), 0);
  });
  it('an infinite radius is undefined: not_finite', () => expect(undefIn(['O = (0, 0)'], 'Circle(O, inf)')).toBe('not_finite'));
  it('Incircle of the 3-4-5 triangle has centre (1, 1) and radius 1', () => {
    const f = fig(['A = (0, 0)', 'B = (4, 0)', 'C = (0, 3)', 'k = Incircle(A, B, C)', 'r = Radius(k)', 'ctr = Center(k)']);
    near(num(f, 'r'), 1, 1e-12);
    nearPt(val(f, 'ctr'), 1, 1, 1e-12);
  });
});

describe('arcs and sectors', () => {
  it('Arc(C, r, from, to) has length r times the sweep', () => near(nm(O, 'Length(Arc(O, 2, 0, pi/2))'), PI, 1e-14));
  it('a "to" below "from" wraps counter-clockwise: from pi/2 to 0 is 3pi/2 long', () => near(nm(O, 'Length(Arc(O, 2, pi/2, 0))'), 3 * PI, 1e-14));
  it('a sweep of exactly 2pi is the full circle', () => near(nm(O, 'Length(Arc(O, 2, 0, 2*pi))'), 4 * PI, 1e-14));
  it('a sweep of 0 is a defined empty arc of length 0', () => near(nm(O, 'Length(Arc(O, 2, 1, 1))'), 0));
  it('Arc(C, S, E) takes the radius from S and only the direction of E', () => near(nm([], 'Length(Arc((0, 0), (2, 0), (0, 5)))'), PI, 1e-14));
  it('Arc(circle, P, P) is the full circle (the user gave points)', () => near(nm(O, 'Length(Arc(c, (2, 0), (2, 0)))'), 4 * PI, 1e-14));
  it('Arc with a point at the centre is undefined: coincident_points', () => expect(undefIn(O, 'Arc(c, (0, 0), (2, 0))')).toBe('coincident_points'));
  it('ArcThrough(A, B, C) counter-clockwise: the upper half of the circle through three points', () => {
    const base = ['A = (2, 0)', 'B = (0, 2)', 'C = (-2, 0)', 'a1 = ArcThrough(A, B, C)'];
    near(nm(base, 'Length(a1)'), 2 * PI, 1e-12);
    nearPt(evalIn(base, 'Midpoint(a1)'), 0, 2, 1e-12);
  });
  it('ArcThrough of collinear points is undefined: collinear', () => expect(undefIn([], 'ArcThrough((0, 0), (1, 1), (2, 2))')).toBe('collinear'));
  it('Semicircle(A, B) is the half on the left of A to B, centre at the midpoint', () => {
    const base = ['A = (0, 0)', 'B = (4, 0)', 'sc = Semicircle(A, B)'];
    nearPt(evalIn(base, 'Midpoint(sc)'), 2, 2, 1e-12);
    near(nm(base, 'Length(sc)'), 2 * PI, 1e-12);
  });
  it('Sector area is half r squared times the sweep', () => near(nm(O, 'Area(Sector(O, 2, 0, pi/2))'), PI, 1e-14));
  it('SectorThrough(A, B, C) of a half disc has area 2pi', () => near(nm([], 'Area(SectorThrough((2, 0), (0, 2), (-2, 0)))'), 2 * PI, 1e-12));
  it('a Sector is a Sector and an Arc is an Arc', () => {
    const f = fig([...O, 'sc = Sector(O, 2, 0, 1)', 'ar = Arc(O, 2, 0, 1)']);
    expect(f.get('sc')?.type).toBe('Sector');
    expect(f.get('ar')?.type).toBe('Arc');
  });
  it('Ellipse arc by polar angle: a quarter by symmetry has a quarter of the circumference', () => {
    near(nm(EL, 'Length(Arc(el, 0, pi/2))'), ellipseCircumference(5, 4) / 4, 1e-9);
  });
  it('Ellipse sector area for a quarter is a quarter of pi a b', () => near(nm(EL, 'Area(Sector(el, 0, pi/2))'), (PI * 20) / 4, 1e-9));
});

describe('ellipse, hyperbola, parabola constructors', () => {
  it('Ellipse(F1, F2, a): axes, centre and eccentricity', () => {
    const f = fig([...EL, 'a1 = SemiMajor(el)', 'b1 = SemiMinor(el)', 'ec = Eccentricity(el)', 'lin = LinearEccentricity(el)', 'ctr = Center(el)']);
    near(num(f, 'a1'), 5);
    near(num(f, 'b1'), 4);
    near(num(f, 'ec'), 0.6);
    near(num(f, 'lin'), 3);
    nearPt(val(f, 'ctr'), 0, 0);
  });
  it('Ellipse with a too short major axis is undefined: too_short (it never becomes a hyperbola)', () => expect(undefIn([], 'Ellipse((-3, 0), (3, 0), 2)')).toBe('too_short'));
  it('Ellipse with coincident foci is a circle', () => {
    const f = fig(['q = Ellipse((1, 1), (1, 1), 3)', 'ty = Type(q)', 'ec = Eccentricity(q)']);
    expect(val(f, 'ty')).toBe('circle');
    near(num(f, 'ec'), 0);
  });
  it('Ellipse with coincident foci and a = 0 is undefined: non_positive', () => expect(undefIn([], 'Ellipse((0, 0), (0, 0), 0)')).toBe('non_positive'));
  it('Hyperbola(F1, F2, a) has b = sqrt(c^2 - a^2) and eccentricity c / a', () => {
    const f = fig([...HY, 'a1 = SemiMajor(h)', 'b1 = SemiMinor(h)', 'ec = Eccentricity(h)']);
    near(num(f, 'a1'), 3);
    near(num(f, 'b1'), 4);
    near(num(f, 'ec'), 5 / 3);
  });
  it('Hyperbola with a transverse axis that is too long is undefined: too_long', () => expect(undefIn([], 'Hyperbola((-5, 0), (5, 0), 5)')).toBe('too_long'));
  it('Hyperbola with a = 0 is undefined: non_positive', () => expect(undefIn([], 'Hyperbola((-5, 0), (5, 0), 0)')).toBe('non_positive'));
  it('Hyperbola with coincident foci is undefined: coincident_points', () => expect(undefIn([], 'Hyperbola((1, 1), (1, 1), 2)')).toBe('coincident_points'));
  it('Parabola(F, directrix): parameter, vertex, focus and directrix', () => {
    const f = fig([...PA, 'p1 = Parameter(pa)', 'vx = Vertex(pa)', 'fc = Focus(pa)', 'dr = Directrix(pa)']);
    near(num(f, 'p1'), 2);
    nearPt((val(f, 'vx') as V2[])[0], 0, 0);
    nearPt((val(f, 'fc') as V2[])[0], 0, 1);
    expect((val(f, 'dr') as unknown[]).length).toBe(1);
  });
  it('Parabola with the focus on the directrix is undefined: focus_on_directrix', () => expect(undefIn([], 'Parabola((0, -1), Line((-5, -1), (5, -1)))')).toBe('focus_on_directrix'));
});

describe('Conic from numbers, lists, points and equations', () => {
  it('Conic(1, 0, 1, 0, 0, -4) is the circle of radius 2', () => {
    const f = fig(['k = Conic(1, 0, 1, 0, 0, -4)', 'ty = Type(k)', 'r = Radius(k)']);
    expect(val(f, 'ty')).toBe('circle');
    near(num(f, 'r'), 2, 1e-12);
  });
  it('Coefficients are scaled so the first non-zero of A, C, B is 1', () => {
    const co = evalIn<number[]>(['k = Conic(2, 0, 2, 0, 0, -8)'], 'Coefficients(k)');
    expect(co.map((v) => Math.round(v * 1e9) / 1e9)).toEqual([1, 0, 1, 0, 0, -4]);
  });
  it('Coefficients of x^2/9 + y^2/4 == 1 are [1, 0, 2.25, 0, 0, -9]', () => {
    const co = evalIn<number[]>(['k = Conic(x^2/9 + y^2/4 == 1)'], 'Coefficients(k)');
    [1, 0, 2.25, 0, 0, -9].forEach((v, i) => near(co[i]!, v, 1e-9));
  });
  it('a list of five numbers is a bad_argument error', () => bad(tryLine([], 'k = Conic([1, 0, 1, 0, 0])'), 'bad_argument'));
  it('three numbers fit no form: arg_count', () => bad(tryLine([], 'k = Conic(1, 2, 3)'), 'arg_count'));
  it('all-zero coefficients are undefined: degenerate_conic', () => expect(undefIn([], 'Conic(0, 0, 0, 0, 0, 0)')).toBe('degenerate_conic'));
  it('coefficients above 1e150 are undefined: not_finite', () => expect(undefIn([], 'Conic(1e160, 0, 1e160, 0, 0, -1e160)')).toBe('not_finite'));
  it('Conic through five points on an ellipse is that ellipse', () => {
    const base = ['p1 = (3, 0)', 'p2 = (0, 2)', 'p3 = (-3, 0)', 'p4 = (0, -2)', 'p5 = (1.5, 1.7320508075688772)', 'k = Conic(p1, p2, p3, p4, p5)'];
    expect(evalIn<string>(base, 'Type(k)')).toBe('ellipse');
    const co = evalIn<number[]>(base, 'Coefficients(k)');
    [1, 0, 2.25, 0, 0, -9].forEach((v, i) => near(co[i]!, v, 1e-9));
  });
  it('Conic through five points passes through each of them (residual below 1e-12 of the scale)', () => {
    const P5 = [[3, 0], [0, 2], [-3, 0], [0, -2], [1.5, 1.7320508075688772]];
    const base = [...P5.map((q, i) => `p${i + 1} = (${q[0]}, ${q[1]})`), 'k = Conic(p1, p2, p3, p4, p5)'];
    const [A, B, C, D, E, F] = evalIn<number[]>(base, 'Coefficients(k)') as [number, number, number, number, number, number];
    for (const [x, y] of P5) expect(Math.abs(A * x * x + B * x * y + C * y * y + D * x + E * y + F)).toBeLessThan(1e-12 * 10);
  });
  it('five points with four collinear are undefined: collinear', () => {
    expect(undefIn([], 'Conic((0, 0), (1, 0), (2, 0), (3, 0), (0, 1))')).toBe('collinear');
  });
  it('five points with a repeated point are undefined: coincident_points', () => {
    expect(undefIn([], 'Conic((0, 0), (1, 0), (1, 0), (3, 1), (0, 1))')).toBe('coincident_points');
  });
  it('five points with three collinear give a pair of lines', () => {
    expect(evalIn<string>(['k = Conic((0, 0), (1, 0), (2, 0), (0, 1), (1, 1))'], 'Type(k)')).toBe('parallel lines');
  });
  it.each([
    ['x^2 + y^2 == 4', 'circle'],
    ['x^2/9 + y^2/4 == 1', 'ellipse'],
    ['x^2 - y^2 == 1', 'hyperbola'],
    ['y == x^2', 'parabola'],
    ['x^2 - y^2 == 0', 'two lines'],
    ['x^2 == 1', 'parallel lines'],
    ['x^2 == 0', 'double line'],
    ['x^2 + y^2 == 0', 'point'],
    ['x^2 + y^2 == -1', 'empty'],
  ])('Type(Conic(%s)) is "%s"', (eq, kind) => expect(evalIn<string>([`k = Conic(${eq})`], 'Type(k)')).toBe(kind));
  it('a slider turns a circle into an ellipse and then into parallel lines (x^2 + k y^2 == 4)', () => {
    const f = fig(['k0 = 1 in -2..2 step 0.25', 'q = Conic(x^2 + k0 * y^2 == 4)', 'ty = Type(q)']);
    expect(val(f, 'ty')).toBe('circle');
    f.setFree('k0', 0.25, 'slider');
    f.flush();
    expect(val(f, 'ty')).toBe('ellipse');
    f.setFree('k0', 0, 'slider');
    f.flush();
    expect(val(f, 'ty')).toBe('parallel lines');
    f.setFree('k0', -1, 'slider');
    f.flush();
    expect(val(f, 'ty')).toBe('hyperbola');
  });
  it('a cubic equation is a not_quadratic error', () => bad(tryLine([], 'k = Conic(x^3 + y == 1)'), 'not_quadratic'));
  it('x or y inside a function is a not_polynomial error', () => bad(tryLine([], 'k = Conic(sin(x) + y == 0)'), 'not_polynomial'));
  it('an expression without == is a bad_equation error', () => bad(tryLine([], 'k = Conic(x^2 + y^2)'), 'bad_equation'));
  it('a single = inside Conic is an assign_in_expr error (language ruling Q9 wins over the bad_equation row)', () => bad(tryLine([], 'k = Conic(x^2 = 4)'), 'assign_in_expr'));
});

describe('properties', () => {
  it('Center of a parabola is undefined: no_center', () => expect(undefIn(PA, 'Center(pa)')).toBe('no_center'));
  it('Radius of an ellipse is undefined: not_circle', () => expect(undefIn(EL, 'Radius(el)')).toBe('not_circle'));
  it('Eccentricity: circle 0, parabola 1', () => {
    near(nm(O, 'Eccentricity(c)'), 0);
    near(nm(PA, 'Eccentricity(pa)'), 1);
  });
  it('Focus(ellipse) lists both foci, and the labels follow the order the foci were given', () => {
    const a = evalIn<V2[]>(['q = Ellipse((-3, 0), (3, 0), 5)'], 'Focus(q)');
    const b = evalIn<V2[]>(['q = Ellipse((3, 0), (-3, 0), 5)'], 'Focus(q)');
    expect(a.length).toBe(2);
    nearPt(a[0], b[1]!.x, b[1]!.y);
    nearPt(a[1], b[0]!.x, b[0]!.y);
    expect(Math.abs(a[0]!.x)).toBeCloseTo(3, 12);
  });
  it('Vertex(ellipse) lists the major axis ends, then the minor axis ends', () => {
    const v = evalIn<V2[]>(EL, 'Vertex(el)');
    expect(v.length).toBe(4);
    nearPt(v[0], 5, 0);
    nearPt(v[1], -5, 0);
    nearPt(v[2], 0, 4);
    nearPt(v[3], 0, -4);
  });
  it('Directrix(ellipse) lists two lines at distance a / e from the centre', () => {
    const d = evalIn<{ a: number; b: number; c: number }[]>(EL, 'Directrix(el)');
    expect(d.length).toBe(2);
    near(Math.abs(d[0]!.c) / Math.hypot(d[0]!.a, d[0]!.b), 5 / 0.6, 1e-12);
  });
  it('Directrix(circle) is undefined: no_directrix', () => expect(undefIn(O, 'Directrix(c)')).toBe('no_directrix'));
  it('Axes(ellipse) are [major, minor]', () => {
    const ax = evalIn<{ a: number; b: number; c: number }[]>(EL, 'Axes(el)');
    near(Math.abs(ax[0]!.b), 1);
    near(Math.abs(ax[1]!.a), 1);
  });
  it('Tilt is the direction of the major axis in [0, pi), whichever focus comes first', () => {
    near(nm([], 'Tilt(Ellipse((-1, -1), (1, 1), 3))'), PI / 4, 1e-12);
    near(nm([], 'Tilt(Ellipse((1, 1), (-1, -1), 3))'), PI / 4, 1e-12);
  });
  it('Parameter of a circle is undefined: wrong_kind', () => expect(undefIn(O, 'Parameter(c)')).toBe('wrong_kind'));
  it('a degenerate conic makes the property undefined: wrong_kind', () => {
    expect(undefIn(['k = Conic(x^2 - y^2 == 0)'], 'Eccentricity(k)')).toBe('wrong_kind');
  });
  it('Center of two intersecting lines is their crossing point', () => nearPt(evalIn(['k = Conic((x - 1)^2 - (y - 2)^2 == 0)'], 'Center(k)'), 1, 2, 1e-9));
});

describe('areas and lengths', () => {
  it('Area of a circle and of an ellipse', () => {
    near(nm(O, 'Area(c)'), 4 * PI, 1e-14);
    near(nm(EL, 'Area(el)'), 20 * PI, 1e-14);
  });
  it('Area of a hyperbola or parabola is undefined: unbounded', () => {
    expect(undefIn(HY, 'Area(h)')).toBe('unbounded');
    expect(undefIn(PA, 'Area(pa)')).toBe('unbounded');
  });
  it('Circumference of a circle is 2 pi r, and Perimeter is the same', () => {
    near(nm(O, 'Circumference(c)'), 4 * PI, 1e-14);
    near(nm(O, 'Perimeter(c)'), 4 * PI, 1e-14);
  });
  it('Circumference of an ellipse is exact to 1e-12 relative', () => near(nm(EL, 'Circumference(el)'), ellipseCircumference(5, 4), 1e-9));
});
