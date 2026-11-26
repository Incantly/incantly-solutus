/**
 * Transformations: Translate, Rotate, Reflect, Dilate, Shear, Stretch, ApplyMatrix, progress, Transform values, live behaviour.
 * Docs: polygons-transforms/design.md 6.1 to 6.7, 7, 8.5, 8.6, 10, 11; polygons-transforms/errors.md 3 to 6; polygons-transforms/agent.md 2 and 4.
 */
import { describe, expect, it, vi } from 'vitest';
import { bad, evalIn, fig, near, nearPt, num, ok, polyPts, tryLine, undefIn, val, type V2 } from './helpers';

vi.setConfig({ testTimeout: 5000 });

const PI = Math.PI;
const O = ['O = (0, 0)', 'c = Circle(O, 2)'];
const XAXIS = 'ax = Line((0, 0), (1, 0))';
const TRI = ['A = (0, 0)', 'B = (4, 0)', 'C = (1, 3)', 'tri = Polygon(A, B, C)'];
const SQ = ['sq = Polygon((0, 0), (2, 0), (2, 2), (0, 2))'];
const p = (base: string[], expr: string): V2 => evalIn<V2>(base, expr);
const nm = (base: string[], expr: string): number => evalIn<number>(base, expr);
const exactly = (a: number, b: number): void => expect(a + 0, `${a} should be exactly ${b}`).toBe(b);

describe('Translate', () => {
  it('moves a point by the vector', () => nearPt(p([], 'Translate((1, 2), Vector(3, -1))'), 4, 1));
  it('moves a polygon, keeping its area, and the result is a Polygon', () => {
    const f = fig([...TRI, 'tri2 = Translate(tri, Vector(10, 10))', 'ar = Area(tri2)']);
    expect(f.get('tri2')?.type).toBe('Polygon');
    nearPt(polyPts(f, 'tri2')[2], 11, 13);
    near(num(f, 'ar'), 6);
  });
  it('is live: moving the source moves the image', () => {
    const f = fig([...TRI, 'tri2 = Translate(tri, Vector(10, 0))']);
    ok(f.apply('A = (1, 1)'));
    nearPt(polyPts(f, 'tri2')[0], 11, 1);
  });
});

describe('Rotate', () => {
  it('a quarter turn about the origin is exact: (3, 4) goes to (-4, 3)', () => {
    const r = p([], 'Rotate((3, 4), 90°, (0, 0))');
    exactly(r.x, -4);
    exactly(r.y, 3);
  });
  it('a half turn, three quarters and a full turn are exact', () => {
    const half = p([], 'Rotate((3, 4), 180°, (0, 0))');
    exactly(half.x, -3);
    exactly(half.y, -4);
    const three = p([], 'Rotate((3, 4), 270°, (0, 0))');
    exactly(three.x, 4);
    exactly(three.y, -3);
    const full = p([], 'Rotate((3, 4), 360°, (0, 0))');
    exactly(full.x, 3);
    exactly(full.y, 4);
  });
  it('a far-away centre keeps precision (centre-based application)', () => nearPt(p([], 'Rotate((100000001, 100000000), 90°, (100000000, 100000000))'), 1e8, 1e8 + 1, 1e-8));
  it('an angle beyond 1e10 radians is undefined: not_finite', () => expect(undefIn([], 'Rotate((1, 0), 1e11, (0, 0))')).toBe('not_finite'));
  it('a rotated polygon keeps its area and orientation', () => {
    const f = fig([...TRI, 'tri2 = Rotate(tri, 40°, (2, 2))', 'ar = Area(tri2)', 'sa = SignedArea(tri2)']);
    near(num(f, 'ar'), 6, 1e-13);
    near(num(f, 'sa'), 6, 1e-13);
  });
  it('follows a slider angle live', () => {
    const f = fig(['a0 = 0 in 0..6.283 step 0.01', 'P = (1, 0)', 'Q = Rotate(P, a0, (0, 0))']);
    f.setFree('a0', 1.5, 'slider');
    f.flush();
    nearPt(val(f, 'Q'), Math.cos(1.5), Math.sin(1.5), 1e-12);
  });
  it('Rotate(tri, A) with a point where the angle belongs is a no_matching_form error', () => bad(tryLine(TRI, 'r1 = Rotate(tri, A, (0, 0))'), 'no_matching_form'));
});

describe('Reflect', () => {
  it('about a line: (1, 2) over y = x is (2, 1)', () => nearPt(p([], 'Reflect((1, 2), Line((0, 0), (1, 1)))'), 2, 1, 1e-15));
  it('about a degenerate mirror is undefined: coincident_points', () => expect(undefIn([], 'Reflect((3, 4), Segment((1, 1), (1, 1)))')).toBe('coincident_points'));
  it('reverses the orientation of a polygon', () => near(nm(TRI.concat('r1 = Reflect(tri, Line((0, 0), (1, 1)))'), 'SignedArea(r1)'), -6, 1e-13));
  it('inversion in a circle: (1, 0) in the circle of radius 2 goes to (4, 0)', () => nearPt(p(O, 'Reflect((1, 0), c)'), 4, 0, 1e-15));
  it('inversion sends the centre to infinity: at_infinity', () => expect(undefIn(O, 'Reflect(O, c)')).toBe('at_infinity'));
  it('inversion of a point within 1e-12 r of the centre is too_far', () => expect(undefIn(O, 'Reflect((1e-13, 0), c)')).toBe('too_far'));
  it('inversion of a line not through the centre is a circle through the centre', () => {
    const f = fig([...O, 'm = Line((-3, 1), (3, 1))', 'k = Reflect(m, c)', 'r = Radius(k)', 'ctr = Center(k)']);
    expect(f.get('k')?.type).toBe('Conic');
    near(num(f, 'r'), 2, 1e-12);
    nearPt(val(f, 'ctr'), 0, 2, 1e-12);
  });
  it('inversion of a line through the centre stays a line', () => expect(evalIn<string>([...O, 'm = Line((-3, 0), (3, 0))', 'k = Reflect(m, c)'], 'Type(k)')).toBe('line'));
  it('inversion of a circle through the centre is a line (x = 2)', () => {
    expect(evalIn<string>([...O, 'c3 = Circle((1, 0), 1)', 'k = Reflect(c3, c)'], 'Type(k)')).toBe('line');
  });
  it('inversion of a circle not through the centre is a circle (centre (1.5, 0), radius 0.5)', () => {
    const f = fig([...O, 'c3 = Circle((3, 0), 1)', 'k = Reflect(c3, c)', 'r = Radius(k)', 'ctr = Center(k)']);
    near(num(f, 'r'), 0.5, 1e-12);
    nearPt(val(f, 'ctr'), 1.5, 0, 1e-12);
  });
  it('inversion of a segment is not supported (its image is an arc): a not_supported error', () => {
    bad(tryLine([...O, 's1 = Segment((1, 0), (3, 0))'], 'k = Reflect(s1, c)'), 'not_supported');
  });
  it('inversion of a polygon is not supported: a not_supported error', () => bad(tryLine([...O, ...SQ], 'k = Reflect(sq, c)'), 'not_supported'));
});

describe('Dilate', () => {
  it('about a centre: C + k (P - C)', () => nearPt(p([], 'Dilate((2, 3), 2, (1, 1))'), 3, 5, 1e-15));
  it('factor 0 collapses a polygon onto the centre: defined, area 0', () => {
    const f = fig([...TRI, 'z0 = Dilate(tri, 0, (1, 1))', 'ar = Area(z0)']);
    expect(polyPts(f, 'z0').every((q) => q.x === 1 && q.y === 1)).toBe(true);
    near(num(f, 'ar'), 0);
  });
  it('factor 0 on a circle is undefined: singular_transform', () => expect(undefIn(O, 'Dilate(c, 0, (0, 0))')).toBe('singular_transform'));
  it('factor 0 on a line is undefined: singular_transform', () => expect(undefIn([XAXIS], 'Dilate(ax, 0, (0, 1))')).toBe('singular_transform'));
});

describe('Shear and Stretch', () => {
  it('Shear moves a point along the line by ratio times its distance', () => nearPt(p([XAXIS], 'Shear((1, 2), ax, 0.5)'), 2, 2, 1e-15));
  it('Shear preserves the area of a polygon', () => near(nm([XAXIS, ...SQ, 'sh = Shear(sq, ax, 1)'], 'Area(sh)'), 4, 1e-13));
  it('Shear of a circle is an ellipse of the same area', () => {
    const f = fig([...O, XAXIS, 'k = Shear(c, ax, 1)', 'ty = Type(k)', 'ar = Area(k)']);
    expect(f.get('k')?.type).toBe('Conic');
    expect(val(f, 'ty')).toBe('ellipse');
    near(num(f, 'ar'), 4 * PI, 1e-10);
  });
  it('Stretch(shape, line, ratio) scales the distance from the line', () => nearPt(p([XAXIS], 'Stretch((1, 2), ax, 2)'), 1, 4, 1e-15));
  it('Stretch of a circle by 2 is an ellipse of area 8 pi', () => near(nm([...O, XAXIS, 'k = Stretch(c, ax, 2)'], 'Area(k)'), 8 * PI, 1e-10));
  it('Stretch by 0 flattens a polygon (area 0, defined) but is singular_transform for a circle', () => {
    near(nm([XAXIS, ...SQ, 'st = Stretch(sq, ax, 0)'], 'Area(st)'), 0, 1e-13);
    expect(undefIn([...O, XAXIS], 'Stretch(c, ax, 0)')).toBe('singular_transform');
  });
  it('Stretch(shape, vector) uses the vector length as ratio', () => nearPt(p([], 'Stretch((1, 1), Vector(3, 0))'), 3, 1, 1e-15));
});

describe('ApplyMatrix', () => {
  it('a 2 by 2 quarter turn', () => nearPt(p([], 'ApplyMatrix([[0, -1], [1, 0]], (1, 0))'), 0, 1, 1e-15));
  it('a 3 by 3 affine matrix adds a translation', () => nearPt(p([], 'ApplyMatrix([[1, 0, 5], [0, 1, 6], [0, 0, 1]], (1, 1))'), 6, 7, 1e-15));
  it('a projective matrix divides by w', () => nearPt(p([], 'ApplyMatrix([[1, 0, 0], [0, 1, 0], [1, 0, 1]], (1, 1))'), 0.5, 0.5, 1e-15));
  it('a point that maps to w = 0 is undefined: at_infinity', () => expect(undefIn([], 'ApplyMatrix([[1, 0, 0], [0, 1, 0], [1, 0, 1]], (-1, 3))')).toBe('at_infinity'));
  it('a segment that crosses the horizon is undefined: crosses_horizon', () => {
    expect(undefIn(['sg = Segment((-2, 0), (2, 0))'], 'ApplyMatrix([[1, 0, 0], [0, 1, 0], [1, 0, 1]], sg)')).toBe('crosses_horizon');
  });
  it('a projective matrix applied to a vector is undefined: not_affine', () => {
    expect(undefIn(['v = Vector(1, 1)'], 'ApplyMatrix([[1, 0, 0], [0, 1, 0], [1, 0, 1]], v)')).toBe('not_affine');
  });
  it('a non-singular 2 by 2 map turns a circle into an ellipse of area det times the old', () => {
    near(nm([...O, 'k = ApplyMatrix([[2, 0], [0, 1]], c)'], 'Area(k)'), 8 * PI, 1e-10);
  });
  it('a singular map flattens a circle: singular_transform, but a point is still mapped', () => {
    expect(undefIn(O, 'ApplyMatrix([[1, 0], [0, 0]], c)')).toBe('singular_transform');
    nearPt(p([], 'ApplyMatrix([[1, 0], [0, 0]], (3, 4))'), 3, 0, 1e-15);
  });
});

describe('progress', () => {
  it('progress = 0 gives the source exactly', () => {
    const f = fig([...TRI, 'im = Rotate(tri, 90°, (0, 0), progress = 0)']);
    expect(polyPts(f, 'im')).toEqual(polyPts(f, 'tri'));
  });
  it('Rotate at progress 0.5 is half the angle', () => nearPt(p([], 'Rotate((1, 0), 90°, (0, 0), progress = 0.5)'), Math.SQRT1_2, Math.SQRT1_2, 1e-15));
  it('Translate at progress 0.5 moves by half the vector', () => nearPt(p([], 'Translate((1, 1), Vector(4, 2), progress = 0.5)'), 3, 2, 1e-15));
  it('Reflect about a line at progress 0.5 is the foot of the perpendicular (the figure is flat)', () => nearPt(p([XAXIS], 'Reflect((1, 2), ax, progress = 0.5)'), 1, 0, 1e-15));
  it('a flat reflected polygon is a defined Polygon of area 0', () => {
    const f = fig([XAXIS, ...SQ.map((s) => s.replace('(0, 0), (2, 0), (2, 2), (0, 2)', '(0, 1), (2, 1), (2, 3), (0, 3)')), 'fl = Reflect(sq, ax, progress = 0.5)', 'ar = Area(fl)']);
    near(num(f, 'ar'), 0, 1e-13);
  });
});

describe('Transform values', () => {
  const VT = 'vv = Vector(2, 1)';
  it.each([
    ['Shift(vv)', 'Translate(P, vv)'],
    ['Turn(40°, (1, 1))', 'Rotate(P, 40°, (1, 1))'],
    ['Mirror(Line((0, 0), (1, 2)))', 'Reflect(P, Line((0, 0), (1, 2)))'],
    ['Scale(2.5, (1, 1))', 'Dilate(P, 2.5, (1, 1))'],
    ['ShearBy(Line((0, 0), (1, 0)), 0.5)', 'Shear(P, Line((0, 0), (1, 0)), 0.5)'],
    ['StretchBy(Line((0, 0), (1, 0)), 2)', 'Stretch(P, Line((0, 0), (1, 0)), 2)'],
  ])('Move(P, %s) equals %s', (tf, direct) => {
    const base = ['P = (3, 2)', VT];
    const a = p(base, `Move(P, ${tf})`);
    const b = p(base, direct);
    nearPt(a, b.x, b.y, 1e-14);
  });
  it('Then(T1, T2) applies T1 first, then T2', () => {
    const a = p(['P = (3, 2)', VT], 'Move(P, Then(Shift(vv), Turn(90°, (0, 0))))');
    const b = p(['P = (3, 2)', VT], 'Rotate(Translate(P, vv), 90°, (0, 0))');
    nearPt(a, b.x, b.y, 1e-14);
  });
  it('Inverse(T) undoes T', () => {
    const q = p(['P = (3, 2)', 'T0 = Then(Turn(40°, (1, 1)), Shift(Vector(2, 1)))'], 'Move(Move(P, T0), Inverse(T0))');
    nearPt(q, 3, 2, 1e-13);
  });
  it('Inverse of a singular transform is undefined: singular_transform', () => expect(undefIn([], 'Inverse(Scale(0, (0, 0)))')).toBe('singular_transform'));
  it('Move(shape, 3) is a not_a_transform error', () => bad(tryLine(TRI, 'm1 = Move(tri, 3)'), 'not_a_transform'));
});

describe('types of images, functions, and live behaviour', () => {
  it('a Function translated is still a Function: g(3) = f(2) + 2', () => {
    const f = fig(['f(x) = x^2', 'g = Translate(f, Vector(1, 2))', 'y0 = g(3)']);
    expect(f.get('g')?.type).toBe('Function');
    near(num(f, 'y0'), 6, 1e-12);
  });
  it('a Function reflected about the vertical line x = 1 is a Function: g(3) = f(-1)', () => {
    const f = fig(['f(x) = x^2 + x', 'g = Reflect(f, Line((1, 0), (1, 1)))', 'y0 = g(3)']);
    expect(f.get('g')?.type).toBe('Function');
    near(num(f, 'y0'), 0, 1e-12);
  });
  it('a Function reflected about the horizontal line y = 1 is a Function: g(2) = -2', () => {
    const f = fig(['f(x) = x^2', 'g = Reflect(f, Line((0, 1), (1, 1)))', 'y0 = g(2)']);
    expect(f.get('g')?.type).toBe('Function');
    near(num(f, 'y0'), -2, 1e-12);
  });
  it('a Function stretched across the horizontal line y = 1 by 2 is a Function: g(2) = 7', () => {
    const f = fig(['f(x) = x^2', 'g = Stretch(f, Line((0, 1), (1, 1)), 2)', 'y0 = g(2)']);
    expect(f.get('g')?.type).toBe('Function');
    near(num(f, 'y0'), 7, 1e-12);
  });
  it('a Function reflected in the slanted line through (0, 0) and (1, 1) is a Curve', () => {
    expect(fig(['f(x) = x^2', 'g = Reflect(f, Line((0, 0), (1, 1)))']).get('g')?.type).toBe('Curve');
  });
  it('Reflect(f, m) is a Curve when m names a vertical line', () => {
    expect(fig(['f(x) = x^2', 'm = Line((1, 0), (1, 1))', 'g = Reflect(f, m)']).get('g')?.type).toBe('Curve');
  });
  it('Reflect(f, Line((a, 0), (a, 1))) stays a Function after a changes, and g(3) = f(2a - 3)', () => {
    const f = fig(['f(x) = x^2', 'a = 1 in 0..5 step 0.1', 'g = Reflect(f, Line((a, 0), (a, 1)))', 'y0 = g(3)']);
    expect(f.get('g')?.type).toBe('Function');
    near(num(f, 'y0'), 1, 1e-12);
    f.setFree('a', 4, 'slider');
    f.flush();
    expect(f.get('g')?.type).toBe('Function');
    near(num(f, 'y0'), 25, 1e-12);
  });
  it('Reflect(f, yaxis) is a Function: g(3) = -3', () => {
    const f = fig(['f(x) = x', 'g = Reflect(f, yaxis)', 'y0 = g(3)']);
    expect(f.get('g')?.type).toBe('Function');
    near(num(f, 'y0'), -3, 1e-12);
  });
  it('Stretch(f, xaxis, 2) is a Function: g(3) = 18', () => {
    const f = fig(['f(x) = x^2', 'g = Stretch(f, xaxis, 2)', 'y0 = g(3)']);
    expect(f.get('g')?.type).toBe('Function');
    near(num(f, 'y0'), 18, 1e-12);
  });
  it('Reflect of a function about a vertical line with progress is a Curve', () => {
    expect(fig(['f(x) = x^2', 'g = Reflect(f, Line((1, 0), (1, 1)), progress = 0.5)']).get('g')?.type).toBe('Curve');
  });
  it('Reflect of a function about a horizontal line with progress is a Curve', () => {
    expect(fig(['f(x) = x^2', 'g = Reflect(f, Line((0, 1), (1, 1)), progress = 1)']).get('g')?.type).toBe('Curve');
  });
  it('Stretch of a function across a horizontal line with progress is a Curve', () => {
    expect(fig(['f(x) = x^2', 'g = Stretch(f, Line((0, 1), (1, 1)), 2, progress = 0.5)']).get('g')?.type).toBe('Curve');
  });
  it('Stretch of a function across a vertical line with progress is a Curve', () => {
    expect(fig(['f(x) = x^2', 'g = Stretch(f, Line((1, 0), (1, 1)), 2, progress = 1)']).get('g')?.type).toBe('Curve');
  });
  it('a Function rotated is a Curve', () => expect(fig(['f(x) = x^2', 'g = Rotate(f, 30°, (0, 0))']).get('g')?.type).toBe('Curve'));
  it('an image cannot be dragged: not_draggable', () => {
    const f = fig([...TRI, 'tri2 = Translate(tri, Vector(1, 1))']);
    expect(f.dragPlan('tri2', { x: 1, y: 1 }).reason).toBe('not_draggable');
  });
  it('redefining the source so the image would change type is a type_change error', () => {
    const f = fig([...TRI, 'tri2 = Rotate(tri, 40°, (0, 0))']);
    bad(f.apply('tri = Circle(A, 1)'), 'type_change');
  });
  it('the vertexlabels style accepts prime', () => ok(fig(TRI).apply('tri2 = Rotate(tri, 40°, (0, 0)) with vertexlabels = prime')));
  it('the vertexlabels style rejects an unknown value', () => bad(tryLine(TRI, 'tri2 = Rotate(tri, 40°, (0, 0)) with vertexlabels = bogus')));
});
