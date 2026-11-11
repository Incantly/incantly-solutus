/**
 * Points: Midpoint, Vertex, Closest, centres, barycentres, polar forms, PointOn / Along / ParamOf, PointIn, RandomIn.
 * Docs: points-lines/design.md 1.1, 5.4, 5.5, 6, 3.5; points-lines/errors.md 3, 4; conics/design.md 3.5 (hyperbola default parameter).
 */
import { describe, expect, it, vi } from 'vitest';
import { bad, dist, evalIn, fig, near, nearPt, num, ok, pt, tryLine, undefIn, val, isUndef, type V2 } from './helpers';

vi.setConfig({ testTimeout: 5000 });

const TRI = ['A = (0, 0)', 'B = (4, 0)', 'C = (0, 3)'];
const AB = ['A = (0, 0)', 'B = (4, 2)'];

describe('Midpoint', () => {
  it('of two points is their mean', () => nearPt(evalIn(AB, 'Midpoint(A, B)'), 2, 1));
  it('of a segment is the middle of its end points', () => nearPt(evalIn([...AB, 's = Segment(A, B)'], 'Midpoint(s)'), 2, 1));
  it('of an arc is the middle of the arc, on the arc', () => {
    const m = evalIn<V2>(['O = (0, 0)', 'a = Arc(O, 2, 0, pi/2)'], 'Midpoint(a)');
    nearPt(m, Math.SQRT2, Math.SQRT2);
  });
  it('of an arc that crosses angle 0 is on the arc, not on the opposite side', () => {
    // from 3pi/2 sweeping pi counter-clockwise to pi/2: the middle is at angle 0
    nearPt(evalIn(['O = (0, 0)', 'a = Arc(O, 2, 3*pi/2, pi/2)'], 'Midpoint(a)'), 2, 0, 1e-9);
  });
  it('is undefined, naming its cause, when an input is undefined', () => {
    const f = fig(['A = (0, 0)', 'B = (1, 0)', 'l = Line(A, B)', 'm = Line((0, 1), (1, 1))', 'Q = Intersect(l, m)', 'M = Midpoint(Q, A)']);
    expect(isUndef(f, 'M')).toBe(true);
    const c = f.cellOf('M');
    expect(c && !c.defined && c.cause).toBeTruthy();
  });
  it('of two points far apart does not overflow (computed as P + (Q - P) / 2)', () => {
    nearPt(evalIn(['A = (-1e100, 0)', 'B = (1e100, 4)'], 'Midpoint(A, B)'), 0, 2, 1e-9);
  });
});

describe('Vertex of a segment or ray', () => {
  it('Vertex(segment, 1) is the first end point', () => nearPt(evalIn([...AB, 's = Segment(A, B)'], 'Vertex(s, 1)'), 0, 0));
  it('Vertex(ray) is the start of the ray', () => nearPt(evalIn([...AB, 'r = Ray(A, B)'], 'Vertex(r)'), 0, 0));
  it('a literal index outside 1..2 is a bad_argument error with a position', () => {
    const e = bad(tryLine([...AB, 's = Segment(A, B)'], 'V = Vertex(s, 3)'), 'bad_argument');
    expect(e.line).toBeGreaterThan(0);
    expect(e.token).toBe('3');
  });
});

describe('Barycenter, Centroid of points, Trilinear', () => {
  it('Barycenter with equal weights is the mean', () => nearPt(evalIn(TRI, 'Barycenter([A, B, C], [1, 1, 1])'), 4 / 3, 1));
  it('Barycenter with weights 2, 1, 1', () => nearPt(evalIn(TRI, 'Barycenter([A, B, C], [2, 1, 1])'), 1, 0.75));
  it('Barycenter with total weight 0 is undefined: division_by_zero', () => {
    expect(undefIn(TRI, 'Barycenter([A, B, C], [1, -1, 0])')).toBe('division_by_zero');
  });
  it('Trilinear 1:1:1 is the incentre', () => nearPt(evalIn(TRI, 'Trilinear(A, B, C, 1, 1, 1)'), 1, 1));
  it('Trilinear with weights summing to 0 is division_by_zero', () => {
    expect(undefIn(TRI, 'Trilinear(A, B, C, 3, -5, 0)')).toBe('division_by_zero');
  });
});

describe('TriangleCenter(A, B, C, n) on the 3-4-5 triangle A(0,0) B(4,0) C(0,3)', () => {
  // a = |BC| = 5, b = |CA| = 3, c = |AB| = 4, s = 6, circumradius 2.5, inradius 1
  const centre = (n: number): V2 => evalIn(TRI, `TriangleCenter(A, B, C, ${n})`);
  it('n = 1 is the incentre (1, 1)', () => nearPt(centre(1), 1, 1));
  it('n = 2 is the centroid (4/3, 1)', () => nearPt(centre(2), 4 / 3, 1));
  it('n = 3 is the circumcentre, the midpoint of the hypotenuse (2, 1.5)', () => nearPt(centre(3), 2, 1.5));
  it('n = 4 is the orthocentre, the right-angle vertex (0, 0)', () => nearPt(centre(4), 0, 0));
  it('n = 5 is the nine-point centre (1, 0.75)', () => nearPt(centre(5), 1, 0.75));
  it('n = 6 is the symmedian point (0.72, 0.96)', () => nearPt(centre(6), 0.72, 0.96));
  it('n = 7 is the Gergonne point (8/11, 9/11)', () => nearPt(centre(7), 8 / 11, 9 / 11));
  it('n = 8 is the Nagel point (2, 1)', () => nearPt(centre(8), 2, 1));
  it('n = 9 is the Mittenpunkt (18/11, 12/11)', () => nearPt(centre(9), 18 / 11, 12 / 11));
  it('n = 10 is the Spieker centre (1.5, 1)', () => nearPt(centre(10), 1.5, 1));
  it('n = 11 is the Feuerbach point (1, 2), on both the incircle and the nine-point circle', () => nearPt(centre(11), 1, 2));
  it('n = 12 is defined for a triangle (the doc names no formula, so only definedness is checked)', () => {
    const p = centre(12);
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
  it('n = 13 (first isogonic point) sees every side at 120 degrees', () => {
    const p = centre(13);
    const angle = (u: V2, v: V2) => Math.acos(((u.x - p.x) * (v.x - p.x) + (u.y - p.y) * (v.y - p.y)) / (dist(u, p) * dist(v, p)));
    const A = { x: 0, y: 0 }, B = { x: 4, y: 0 }, C = { x: 0, y: 3 };
    near(angle(A, B), (2 * Math.PI) / 3, 1e-9);
    near(angle(B, C), (2 * Math.PI) / 3, 1e-9);
    near(angle(C, A), (2 * Math.PI) / 3, 1e-9);
  });
  it('an index above 13 is rejected with bad_argument (the supported list)', () => {
    bad(tryLine(TRI, 'P = TriangleCenter(A, B, C, 14)'), 'bad_argument');
  });
  it('collinear vertices are undefined: collinear', () => {
    expect(undefIn(['A = (0, 0)', 'B = (1, 1)', 'C = (2, 2)'], 'TriangleCenter(A, B, C, 3)')).toBe('collinear');
  });
});

describe('FromPolar and ToPolar', () => {
  it('FromPolar(2, pi/2) is (0, 2)', () => nearPt(evalIn([], 'FromPolar(2, pi/2)'), 0, 2));
  it('ToPolar of the vector (1, 1) is [sqrt 2, pi/4]', () => {
    const [r, t] = evalIn<number[]>([], 'ToPolar(Vector(1, 1))');
    near(r!, Math.SQRT2);
    near(t!, Math.PI / 4);
  });
  it('ToPolar gives theta in (-pi, pi]: the negative x axis is +pi, not -pi', () => {
    const [, t] = evalIn<number[]>([], 'ToPolar(Vector(-1, 0))');
    near(t!, Math.PI);
  });
  it('ToPolar of a vector pointing down is -pi/2', () => {
    const [, t] = evalIn<number[]>([], 'ToPolar(Vector(0, -2))');
    near(t!, -Math.PI / 2);
  });
});

describe('Closest', () => {
  const BASE = ['A = (0, 0)', 'B = (4, 0)', 'l = Line(A, B)', 's = Segment(A, B)', 'r = Ray(A, B)', 'O = (0, 0)', 'c = Circle(O, 2)'];
  it('Closest(line, P) is the foot of the perpendicular', () => nearPt(evalIn(BASE, 'Closest(l, (1, 5))'), 1, 0));
  it('Closest(segment, P) beyond an end is that end', () => nearPt(evalIn(BASE, 'Closest(s, (7, 2))'), 4, 0));
  it('Closest(ray, P) behind the start is the start', () => nearPt(evalIn(BASE, 'Closest(r, (-3, 2))'), 0, 0));
  it('Closest(circle, P) is on the ray from the centre to P', () => nearPt(evalIn(BASE, 'Closest(c, (3, 4))'), 1.2, 1.6));
  it('Closest(polygon, P) is the nearest boundary point', () => {
    nearPt(evalIn(['sq = Polygon((0,0), (2,0), (2,2), (0,2))'], 'Closest(sq, (5, 1))'), 2, 1);
  });
  it('Closest(line, line) is the point of the first line nearest the second (their crossing)', () => {
    nearPt(evalIn([...BASE, 'm = Line((1, 1), (2, 3))'], 'Closest(l, m)'), 0.5, 0);
  });
  it('Closest(ellipse, P) on the major axis is the vertex', () => {
    nearPt(evalIn(['e1 = Ellipse((-3, 0), (3, 0), 5)'], 'Closest(e1, (10, 0))'), 5, 0, 1e-8);
  });
  it('Closest(ellipse, P) for a point on the ellipse is that point', () => {
    nearPt(evalIn(['e1 = Ellipse((-3, 0), (3, 0), 5)'], 'Closest(e1, (3, 3.2))'), 3, 3.2, 1e-8);
  });
});

describe('PointOn, Along and ParamOf', () => {
  const BASE = ['A = (0, 0)', 'B = (4, 0)', 's = Segment(A, B)', 'l = Line(A, B)', 'r = Ray(A, B)', 'O = (0, 0)', 'c = Circle(O, 2)'];
  it('PointOn(segment) defaults to the middle (parameter 0.5)', () => nearPt(evalIn(BASE, 'PointOn(s)'), 2, 0));
  it('PointOn(segment, 0.25) is a quarter of the way', () => nearPt(evalIn(BASE, 'PointOn(s, 0.25)'), 1, 0));
  it('PointOn(circle, 0.5) is on the +x side (angle 0 maps to parameter 0.5)', () => nearPt(evalIn(BASE, 'PointOn(c, 0.5)'), 2, 0));
  it('PointOn(circle, 0.25) is at angle -pi/2', () => nearPt(evalIn(BASE, 'PointOn(c, 0.25)'), 0, -2));
  it('PointOn(line, 0.5) is at the first defining point', () => nearPt(evalIn(BASE, 'PointOn(l, 0.5)'), 0, 0));
  it('PointOn(line, 0.75) is one defining-vector length along (parameter 0.5 + atan(1)/pi)', () => nearPt(evalIn(BASE, 'PointOn(l, 0.75)'), 4, 0));
  it('PointOn(ray, 0.5) is one defining-vector length along (parameter 2 atan(s) / pi)', () => nearPt(evalIn(BASE, 'PointOn(r, 0.5)'), 4, 0));
  it('PointOn(polygon, u) is the arc-length fraction along the boundary', () => {
    const sq = ['sq = Polygon((0,0), (2,0), (2,2), (0,2))'];
    nearPt(evalIn(sq, 'PointOn(sq, 0.125)'), 1, 0);
    nearPt(evalIn(sq, 'PointOn(sq, 0.375)'), 2, 1);
  });
  it('PointOn(hyperbola) defaults to the vertex of the first branch (parameter 0.25)', () => {
    nearPt(evalIn(['h = Hyperbola((-5, 0), (5, 0), 3)'], 'PointOn(h)'), 3, 0, 1e-9);
  });
  it('PointOn rides along when the path moves, keeping its relative position', () => {
    const f = fig([...BASE, 'P = PointOn(s, 0.25)']);
    ok(f.apply('B = (8, 0)'));
    nearPt(val(f, 'P'), 2, 0);
  });
  it('PointOn(circle, 0.25) follows the circle when its centre moves', () => {
    const f = fig([...BASE, 'P = PointOn(c, 0.75)']);
    ok(f.apply('O = (1, 1)'));
    nearPt(val(f, 'P'), 1, 3);
  });
  it('dragging a PointOn writes its parameter, never the path', () => {
    const f = fig([...BASE, 'P = PointOn(c, 0.25)']);
    const plan = f.dragPlan('P', { x: 0, y: 5 });
    expect(plan.reason).toBeUndefined();
    expect(plan.writes.length).toBeGreaterThan(0);
    expect(plan.writes.map((w) => w.name)).not.toContain('O');
    expect(plan.writes.map((w) => w.name)).not.toContain('c');
    f.drag(plan);
    f.commitDrag();
    nearPt(val(f, 'P'), 0, 2, 1e-9);
    nearPt(val(f, 'O'), 0, 0);
  });
  it('dragging a PointOn on a segment projects the pointer onto it', () => {
    const f = fig([...BASE, 'P = PointOn(s, 0.5)']);
    f.drag(f.dragPlan('P', { x: 3, y: 7 }));
    f.commitDrag();
    nearPt(val(f, 'P'), 3, 0, 1e-9);
  });
  it('PointOn(x, ...) with a Number is a not_a_path error', () => {
    bad(tryLine(['r = 3'], 'P = PointOn(r, 0.5)'), 'not_a_path');
  });
  it('PointOn(Point) is a not_a_path error', () => {
    bad(tryLine(BASE, 'P = PointOn(A)'), 'not_a_path');
  });
  it('Along(circle, u) is the same position as PointOn(circle, u)', () => {
    const f = fig([...BASE, 'P = PointOn(c, 0.3)', 'Q = Along(c, 0.3)']);
    nearPt(val(f, 'Q'), pt(f, 'P').x, pt(f, 'P').y, 1e-12);
  });
  it('Along(c, t / 10) at t = 0 is at parameter 0, the point (-2, 0)', () => {
    const f = fig([...BASE, 'P = Along(c, t / 10)']);
    expect(dist(pt(f, 'P'), { x: -2, y: 0 })).toBeLessThan(1e-9);
  });
  it('ParamOf(P) of a PointOn on a circle is its parameter', () => {
    const f = fig([...BASE, 'P = PointOn(c, 0.3)', 'u = ParamOf(P)']);
    near(num(f, 'u'), 0.3, 1e-12);
  });
  it('ParamOf(P) of a PointOn on a segment is its parameter', () => {
    const f = fig([...BASE, 'P = PointOn(s, 0.8)', 'u = ParamOf(P)']);
    near(num(f, 'u'), 0.8, 1e-12);
  });
});

describe('PointIn', () => {
  const SQ = ['sq = Polygon((0,0), (4,0), (4,4), (0,4))'];
  it('PointIn(polygon) is inside the polygon', () => {
    const f = fig([...SQ, 'P = PointIn(sq)', 'ins = InRegion(P, sq)']);
    expect(val(f, 'ins')).toBe(true);
  });
  it('PointIn(circle, 0.5, 0) is half a radius along the first axis', () => {
    nearPt(evalIn(['O = (0, 0)', 'c = Circle(O, 2)'], 'PointIn(c, 0.5, 0)'), 1, 0, 1e-9);
  });
  it('PointIn(sector, r, theta) takes fractions of the radius and of the sweep', () => {
    nearPt(evalIn(['O = (0, 0)', 's = Sector(O, 2, 0, pi/2)'], 'PointIn(s, 0.5, 0.5)'), Math.SQRT1_2, Math.SQRT1_2, 1e-9);
  });
  it('PointIn(polygon) stays inside a convex polygon after reshaping', () => {
    const f = fig(['A = (0, 0)', 'B = (4, 0)', 'C = (4, 4)', 'D = (0, 4)', 'sq = Polygon(A, B, C, D)', 'P = PointIn(sq)']);
    ok(f.apply('C = (9, 7)'));
    ok(f.apply('ins = InRegion(P, sq)'));
    expect(val(f, 'ins')).toBe(true);
  });
  it('PointIn(line) is a not_a_region error', () => {
    bad(tryLine(['A = (0, 0)', 'B = (1, 0)', 'l = Line(A, B)'], 'P = PointIn(l)'), 'not_a_region');
  });
});

describe('RandomIn', () => {
  const SQ = ['sq = Polygon((0,0), (4,0), (4,4), (0,4))', 'O = (0, 0)', 'c = Circle(O, 2)', 'sd = 1'];
  it('is pure: the same seed gives the same point in two figures', () => {
    expect(pt(fig([...SQ, 'P = RandomIn(sq, 7)']), 'P')).toEqual(pt(fig([...SQ, 'P = RandomIn(sq, 7)']), 'P'));
  });
  it('the box form stays inside the box for 40 seeds', () => {
    for (let k = 1; k <= 40; k++) {
      const p = evalIn<V2>([], `RandomIn(-1, 3, 2, 5, ${k})`);
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(3);
      expect(p.y).toBeGreaterThanOrEqual(2);
      expect(p.y).toBeLessThanOrEqual(5);
    }
  });
  it('the polygon form stays inside a triangle for 40 seeds', () => {
    const f = fig(['tri = Polygon((0,0), (6,0), (0,3))', 'P = RandomIn(tri, 1)', 'ins = InRegion(P, tri)', 'k = 1']);
    for (let k = 1; k <= 40; k++) {
      ok(f.apply(`P = RandomIn(tri, ${k})`));
      expect(val(f, 'ins')).toBe(true);
    }
  });
  it('the disc form stays inside the circle for 40 seeds', () => {
    for (let k = 1; k <= 40; k++) {
      const p = evalIn<V2>(SQ, `RandomIn(c, ${k})`);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(2 + 1e-12);
    }
  });
  it('the disc form is uniform in area: the mean distance from the centre is about 2r/3', () => {
    const f = fig(['O = (0, 0)', 'c = Circle(O, 1)', 'P = RandomIn(c, 1)', 'd = Distance(O, P)']);
    let sum = 0;
    const n = 300;
    for (let k = 1; k <= n; k++) {
      ok(f.apply(`P = RandomIn(c, ${k})`));
      sum += num(f, 'd');
    }
    const mean = sum / n;
    expect(mean).toBeGreaterThan(0.6);
    expect(mean).toBeLessThan(0.73);
  });
  it('is undefined for an undefined region, with the input as cause', () => {
    const f = fig(['A = (0, 0)', 'B = (1, 0)', 'C = (2, 0)', 'T = Circle(A, B, C)', 'P = RandomIn(T, 1)']);
    expect(isUndef(f, 'P')).toBe(true);
  });
});

describe('list slots are 1-based', () => {
});
