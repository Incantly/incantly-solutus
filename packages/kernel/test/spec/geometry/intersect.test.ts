/**
 * Intersect: every pair of shapes, slot order, limits, extend, near, index, tangency, degenerate and far cases.
 * Docs: points-lines/design.md 3.5, 4.1 to 4.8, 10.1, 10.3; points-lines/errors.md 3, 4, 6; conics/design.md 6.2, 8.
 */
import { describe, expect, it, vi } from 'vitest';
import { bad, evalIn, expectFast, fig, near, nearPt, ok, pt, slotUndef, tryLine, undefIn, val, why, type V2 } from './helpers';

vi.setConfig({ testTimeout: 5000 });

type Slot = V2 | null | undefined;
const slots = (base: string[], expr: string): Slot[] => evalIn<Slot[]>(base, expr);
const defined = (xs: Slot[]): V2[] => xs.filter((p): p is V2 => !slotUndef(p));

const X = ['l = Line((-5, 0), (5, 0))', 'O = (0, 0)', 'c = Circle(O, 2)'];
const LL = ['l = Line((0, 0), (4, 0))', 'm = Line((1, -1), (1, 1))'];

describe('line with line', () => {
  it('crossing lines meet at one point', () => nearPt(evalIn(LL, 'Intersect(l, m)'), 1, 0));
  it('parallel lines are undefined: parallel', () => expect(undefIn(['l = Line((0, 0), (1, 0))', 'm = Line((0, 1), (1, 1))'], 'Intersect(l, m)')).toBe('parallel'));
  it('identical lines are undefined: coincident', () => expect(undefIn(['l = Line((0, 0), (1, 1))', 'm = Line((2, 2), (3, 3))'], 'Intersect(l, m)')).toBe('coincident'));
  it('lines almost parallel (sine 1e-8) still meet, to within the conditioning', () => {
    const p = evalIn<V2>(['l = Line((0, 0), (1, 0))', 'm = Line((1, 0), (2, 1e-8))'], 'Intersect(l, m)');
    nearPt(p, 1, 0, 1e-6);
  });
  it('directions with sine below 1e-12 count as parallel', () => {
    expect(undefIn(['l = Line((0, 0), (1, 0))', 'm = Line((0, 1), (1, 1.0000000000001))'], 'Intersect(l, m)')).toBe('parallel');
  });
  it('a meeting point beyond 1e14 from the origin is undefined: too_far', () => {
    expect(undefIn(['l = Line((0, 0), (1, 0))', 'm = Line((0, -1e6), (1e15, 0))'], 'Intersect(l, m)')).toBe('too_far');
  });
  it('a segment that stops short of the meeting point: outside_path', () => {
    expect(undefIn(['s = Segment((0, 0), (1, 0))', 'm = Line((3, -1), (3, 1))'], 'Intersect(s, m)')).toBe('outside_path');
  });
  it('a ray does not meet a line behind its start: outside_path', () => {
    expect(undefIn(['r = Ray((0, 0), (1, 0))', 'm = Line((-3, -1), (-3, 1))'], 'Intersect(r, m)')).toBe('outside_path');
  });
  it('two segments whose carriers cross outside them: outside_path', () => {
    expect(undefIn(['s1 = Segment((0, 0), (1, 1))', 's2 = Segment((0, 4), (1, 3))'], 'Intersect(s1, s2)')).toBe('outside_path');
  });
  it('extend = true intersects the carriers of the limited objects', () => {
    nearPt(evalIn(['s1 = Segment((0, 0), (1, 1))', 's2 = Segment((0, 4), (1, 3))'], 'Intersect(s1, s2, extend = true)'), 2, 2);
  });
  it('a literal index of 2 on a line-line pair is a bad_argument error naming the index', () => {
    const e = bad(tryLine(LL, 'P = Intersect(l, m, 2)'), 'bad_argument');
    expect(e.token).toBe('2');
  });
  it('a literal index of 0 is a bad_argument error (indexes start at 1)', () => bad(tryLine(LL, 'P = Intersect(l, m, 0)'), 'bad_argument'));
});

describe('line with circle', () => {
  it('slot 1 is the root with the smaller parameter along the line direction', () => {
    const [a, b] = slots(X, 'Intersect(l, c)');
    nearPt(a, -2, 0);
    nearPt(b, 2, 0);
  });
  it('reversing the line direction swaps the slots', () => {
    const [a, b] = slots(['l = Line((5, 0), (-5, 0))', 'O = (0, 0)', 'c = Circle(O, 2)'], 'Intersect(l, c)');
    nearPt(a, 2, 0);
    nearPt(b, -2, 0);
  });
  it('a line that misses the circle is undefined: no_intersection', () => {
    expect(undefIn(['l = Line((-5, 5), (5, 5))', 'O = (0, 0)', 'c = Circle(O, 2)'], 'Intersect(l, c)')).toBe('no_intersection');
  });
  it('a tangent line gives two equal points', () => {
    const [a, b] = slots(['l = Line((-5, 2), (5, 2))', 'O = (0, 0)', 'c = Circle(O, 2)'], 'Intersect(l, c)');
    nearPt(a, 0, 2, 1e-7);
    nearPt(b, 0, 2, 1e-7);
  });
  it('Intersect(Tangent(P, c)[1], c, 1) is a point (the tangent point), not a flicker', () => {
    const f = fig([...X, 'P = (2, 0)', 'T = Tangent(P, c)', 'tl = T[1]', 'Q = Intersect(tl, c, 1)']);
    nearPt(pt(f, 'Q'), 2, 0, 1e-7);
  });
  it('a segment that holds only one root leaves the other slot undefined, and the list keeps 2 slots', () => {
    const xs = slots(['s = Segment((0, 0), (5, 0))', 'O = (0, 0)', 'c = Circle(O, 2)'], 'Intersect(s, c)');
    expect(xs.length).toBe(2);
    expect(slotUndef(xs[0])).toBe(true);
    nearPt(xs[1], 2, 0);
  });
  it('a segment inside the circle holds neither root: outside_path', () => {
    expect(undefIn(['s = Segment((-1, 0), (1, 0))', 'O = (0, 0)', 'c = Circle(O, 2)'], 'Intersect(s, c, 1)')).toBe('outside_path');
  });
  it('an arc keeps only the roots inside its angle range', () => {
    const xs = slots(['O = (0, 0)', 'a = Arc(O, 2, 0, pi/2)', 'l = Line((-5, 0), (5, 0))'], 'Intersect(l, a)');
    expect(defined(xs).length).toBe(1);
    nearPt(defined(xs)[0], 2, 0, 1e-9);
  });
  it('extend = true on an arc uses the whole circle', () => {
    const xs = slots(['O = (0, 0)', 'a = Arc(O, 2, 0, pi/2)', 'l = Line((-5, 0), (5, 0))'], 'Intersect(l, a, extend = true)');
    expect(defined(xs).length).toBe(2);
  });
  it('near = P picks the root closest to P', () => nearPt(evalIn(X, 'Intersect(l, c, near = (1.9, 0.1))'), 2, 0));
  it('near = P with a tie picks the lowest slot', () => nearPt(evalIn(X, 'Intersect(l, c, near = (0, 7))'), -2, 0));
  it('a circle of radius 1e6 keeps relative accuracy', () => {
    const f = fig(['O = (0, 0)', 'c = Circle(O, 1e6)', 'm = Line((-2e6, 3e5), (2e6, 3e5))', 'I = Intersect(m, c, 2)']);
    const p = pt(f, 'I');
    near(Math.hypot(p.x, p.y) / 1e6, 1, 1e-12);
  });
});

describe('line with other conics', () => {
  it('a line parallel to a parabola axis meets it once; slot 2 is undefined', () => {
    const xs = slots(['p1 = Parabola((0, 1), Line((-5, -1), (5, -1)))', 'm = Line((2, -3), (2, 8))'], 'Intersect(m, p1)');
    expect(defined(xs).length).toBe(1);
    nearPt(defined(xs)[0], 2, 1, 1e-9);
  });
  it('a line meets a hyperbola in two points', () => {
    const xs = slots(['h1 = Conic(x^2 - y^2 == 1)', 'm = Line((-3, 0), (3, 0))'], 'Intersect(m, h1)');
    nearPt(xs[0], -1, 0, 1e-9);
    nearPt(xs[1], 1, 0, 1e-9);
  });
  it('a pair of lines (degenerate conic) is intersected line by line', () => {
    const xs = defined(slots(['k = Conic(x^2 - y^2 == 0)', 'm = Line((-3, 1), (3, 1))'], 'Intersect(m, k)'));
    expect(xs.length).toBe(2);
    expect(xs.map((p) => p.x).sort((a, b) => a - b).map((v) => Math.round(v * 1e9) / 1e9)).toEqual([-1, 1]);
  });
  it('the line direction decides the order on a conic: slot 1 first along the line', () => {
    const xs = slots(['el = Ellipse((-3, 0), (3, 0), 5)', 'm = Line((6, 0), (-6, 0))'], 'Intersect(m, el)');
    nearPt(xs[0], 5, 0, 1e-9);
    nearPt(xs[1], -5, 0, 1e-9);
  });
});

describe('circle with circle', () => {
  const two = (x2: number, r2 = 2) => ['o1 = (0, 0)', `o2 = (${x2}, 0)`, 'c1 = Circle(o1, 2)', `c2 = Circle(o2, ${r2})`];
  it('slot 1 is on the left of the directed centre line c1 to c2', () => {
    const [a, b] = slots(two(2), 'Intersect(c1, c2)');
    nearPt(a, 1, Math.sqrt(3));
    nearPt(b, 1, -Math.sqrt(3));
  });
  it('swapping the circles swaps the slots (left of the new directed line)', () => {
    const [a, b] = slots(two(2), 'Intersect(c2, c1)');
    nearPt(a, 1, -Math.sqrt(3));
    nearPt(b, 1, Math.sqrt(3));
  });
  it('externally tangent circles give two equal points', () => {
    const [a, b] = slots(['o1 = (0, 0)', 'o2 = (2, 0)', 'c1 = Circle(o1, 1)', 'c2 = Circle(o2, 1)'], 'Intersect(c1, c2)');
    nearPt(a, 1, 0, 1e-7);
    nearPt(b, 1, 0, 1e-7);
  });
  it('concentric circles with equal radii: coincident', () => {
    expect(undefIn(['o1 = (0, 0)', 'c1 = Circle(o1, 2)', 'c2 = Circle(o1, 2)'], 'Intersect(c1, c2)')).toBe('coincident');
  });
  it('concentric circles with different radii: no_intersection', () => {
    expect(undefIn(['o1 = (0, 0)', 'c1 = Circle(o1, 2)', 'c2 = Circle(o1, 3)'], 'Intersect(c1, c2)')).toBe('no_intersection');
  });
  it('far-apart circles: no_intersection', () => expect(undefIn(two(9), 'Intersect(c1, c2)')).toBe('no_intersection'));
  it('a circle inside another: no_intersection', () => expect(undefIn(two(0.5, 0.5), 'Intersect(c1, c2)')).toBe('no_intersection'));
  it('the order does not depend on history: moving a circle through tangency and back gives the same slots', () => {
    const f = fig(two(2).concat('I = Intersect(c1, c2)'));
    const first = JSON.stringify(val(f, 'I'));
    ok(f.apply('o2 = (9, 0)'));
    ok(f.apply('o2 = (2, 0)'));
    expect(JSON.stringify(val(f, 'I'))).toBe(first);
  });
});

describe('conic with conic', () => {
  const CE = ['el = Conic(x^2/16 + y^2 == 1)', 'cc = Conic(x^2 + y^2 == 4)'];
  it('a circle and an ellipse meet in four points', () => expect(defined(slots(CE, 'Intersect(cc, el)')).length).toBe(4));
  it('every point lies on both conics (residual below 1e-9)', () => {
    for (const p of defined(slots(CE, 'Intersect(cc, el)'))) {
      near(p.x * p.x + p.y * p.y, 4, 1e-9);
      near(p.x * p.x / 16 + p.y * p.y, 1, 1e-9);
    }
  });
  it('the four points are (±sqrt 3.2, ±sqrt 0.8)', () => {
    const xs = defined(slots(CE, 'Intersect(cc, el)'));
    for (const p of xs) {
      near(Math.abs(p.x), Math.sqrt(3.2), 1e-8);
      near(Math.abs(p.y), Math.sqrt(0.8), 1e-8);
    }
  });
  it('slots run counter-clockwise by angle from the first conic major axis (+x for a circle)', () => {
    const xs = slots(CE, 'Intersect(cc, el)');
    const ang = xs.map((p) => ((Math.atan2(p!.y, p!.x) * 180) / Math.PI + 360) % 360);
    expect(ang.map((a) => Math.round(a))).toEqual([27, 153, 207, 333]);
  });
  it('two conics that do not meet: no_intersection', () => {
    expect(undefIn(['a1 = Conic(x^2 + y^2 == 1)', 'a2 = Conic(x^2/100 + y^2/400 == 1)'], 'Intersect(a1, a2)')).toBe('no_intersection');
  });
  it('the same conic twice: coincident', () => expect(undefIn(['a1 = Conic(x^2 + y^2 == 1)', 'a2 = Conic(2x^2 + 2y^2 == 2)'], 'Intersect(a1, a2)')).toBe('coincident'));
  it('a parabola and a circle meet in the distinct points (0,0), (1,1), (-1,1)', () => {
    const xs = defined(slots(['pa = Conic(y == x^2)', 'cir = Conic(x^2 + (y - 1)^2 == 1)'], 'Intersect(pa, cir)'));
    const key = (p: V2) => `${Math.round(p.x * 1e4) / 1e4},${Math.round(p.y * 1e4) / 1e4}`;
    expect(xs.map(key).sort()).toEqual(['-1,1', '0,0', '1,1']);
  });
  it('conic with conic is typed as a list (no fixed single result)', () => expect(fig([...CE, 'I = Intersect(cc, el)']).get('I')?.type).toBe('List'));
  it('a conic from five points meets a line in two points on the conic', () => {
    const f = fig(['q1 = (3, 0)', 'q2 = (-3, 0)', 'q3 = (0, 2)', 'q4 = (0, -2)', 'q5 = (2.1213203435596424, 1.414213562373095)', 'k5 = Conic(q1, q2, q3, q4, q5)', 'm = Line((0, 0), (1, 1))', 'I = Intersect(m, k5)']);
    expect(defined(val(f, 'I')).length).toBe(2);
  });
});

describe('polygons and polylines', () => {
  const SQ = ['sq = Polygon((0, 0), (2, 0), (2, 2), (0, 2))'];
  it('a line through a square meets it twice, in boundary order from the first vertex', () => {
    const xs = slots([...SQ, 'm = Line((-1, 1), (3, 1))'], 'Intersect(m, sq)');
    expect(xs.length).toBe(2);
    nearPt(xs[0], 2, 1);
    nearPt(xs[1], 0, 1);
  });
  it('a line through a vertex gives the vertex once (the diagonal meets a square twice, not four times)', () => {
    expect(defined(slots([...SQ, 'm = Line((0, 0), (1, 1))'], 'Intersect(m, sq)')).length).toBe(2);
  });
  it('a line along an edge reports the two edge end points', () => {
    const xs = defined(slots([...SQ, 'm = Line((0, 0), (1, 0))'], 'Intersect(m, sq)'));
    expect(xs.length).toBe(2);
  });
  it('a line that misses the polygon gives an empty list or an undefined value, never a point', () => {
    const f = fig([...SQ, 'm = Line((0, 5), (1, 5))', 'I = Intersect(m, sq)']);
    const c = f.cellOf('I')!;
    if (c.defined) expect(defined(c.value as Slot[]).length).toBe(0);
  });
  it('two overlapping squares cross at two points, in boundary order of the first', () => {
    const xs = slots([...SQ, 'sq2 = Polygon((1, 1), (3, 1), (3, 3), (1, 3))'], 'Intersect(sq, sq2)');
    expect(xs.length).toBe(2);
    nearPt(xs[0], 2, 1);
    nearPt(xs[1], 1, 2);
  });
  it('a circle crossing a square meets it at 8 points on the circle, first on the bottom edge', () => {
    const xs = slots(['sq = Polygon((-1, -1), (1, -1), (1, 1), (-1, 1))', 'O = (0, 0)', 'cir = Circle(O, 1.2)'], 'Intersect(cir, sq)');
    expect(xs.length).toBe(8);
    for (const p of xs) near(Math.hypot(p!.x, p!.y), 1.2, 1e-12);
    nearPt(xs[0], -Math.sqrt(0.44), -1, 1e-9);
  });
  it('a polyline is intersected edge by edge, in order', () => {
    const xs = slots(['pl = Polyline((0, 0), (4, 4), (8, 0))', 'm = Line((0, 2), (9, 2))'], 'Intersect(m, pl)');
    nearPt(xs[0], 2, 2);
    nearPt(xs[1], 6, 2);
  });
});

describe('functions', () => {
  const AXIS = 'ax = Line((0, 0), (1, 0))';
  it('a polynomial and a line: roots sorted by x', () => {
    const xs = slots(['f(x) = x^2 - 1', AXIS], 'Intersect(f, ax)');
    nearPt(xs[0], -1, 0, 1e-12);
    nearPt(xs[1], 1, 0, 1e-12);
  });
  it('two polynomials (degree up to 4 of the difference) meet without an interval', () => {
    const xs = slots(['f(x) = x^2', 'g(x) = x + 2'], 'Intersect(f, g)');
    nearPt(xs[0], -1, 1, 1e-12);
    nearPt(xs[1], 2, 4, 1e-12);
  });
  it('a quartic meets a line at four points', () => expect(defined(slots(['f(x) = x^4 - 5x^2 + 4', AXIS], 'Intersect(f, ax)')).length).toBe(4));
  it('two non-polynomial functions without an interval: no_matching_form', () => {
    bad(tryLine(['f(x) = sin(x)', 'g(x) = cos(x)'], 'P = Intersect(f, g)'), 'no_matching_form');
  });
  it('sin and cos on an interval meet at pi/4 and 5pi/4', () => {
    const xs = defined(slots(['f(x) = sin(x)', 'g(x) = cos(x)'], 'Intersect(f, g, 0, 7)'));
    expect(xs.length).toBe(2);
    nearPt(xs[0], Math.PI / 4, Math.SQRT1_2, 1e-12);
    nearPt(xs[1], (5 * Math.PI) / 4, -Math.SQRT1_2, 1e-12);
  });
  it('sin and the x axis on 0.5..10 meet at pi, 2pi, 3pi', () => {
    const xs = defined(slots(['f(x) = sin(x)', AXIS], 'Intersect(f, ax, 0.5, 10)'));
    expect(xs.map((p) => p.x / Math.PI)).toEqual([1, 2, 3].map((k) => expect.closeTo(k, 10)));
  });
  it('a touching (double) root is found: 1 + cos(x) meets the axis at pi', () => {
    const xs = defined(slots(['f(x) = 1 + cos(x)', AXIS], 'Intersect(f, ax, 0.5, 5)'));
    expect(xs.length).toBe(1);
    nearPt(xs[0], Math.PI, 0, 1e-6);
  });
  it('a pole is not a root: 1/x never meets the x axis', () => {
    const f = fig(['f(x) = 1 / x', AXIS, 'I = Intersect(f, ax, -5, 5)']);
    const c = f.cellOf('I')!;
    if (c.defined) expect(defined(c.value as Slot[]).length).toBe(0);
  });
  it('more than 64 roots are cut at 64, the first 64 by x', () => {
    const xs = defined(slots(['f(x) = sin(x)', AXIS], 'Intersect(f, ax, 0.5, 400)'));
    expect(xs.length).toBe(64);
    near(xs[0]!.x, Math.PI, 1e-9);
    near(xs[63]!.x, 64 * Math.PI, 1e-9);
  });
  it('the near form runs Newton from the given point', () => {
    nearPt(evalIn(['f(x) = x^2', 'g(x) = 2x + 3'], 'Intersect(f, g, near = (2, 0))'), 3, 9, 1e-9);
  });
  it('the root of a function and a circle', () => {
    const xs = defined(slots(['f(x) = x', 'O = (0, 0)', 'cir = Circle(O, 2)'], 'Intersect(f, cir)'));
    expect(xs.length).toBe(2);
    for (const p of xs) near(Math.hypot(p.x, p.y), 2, 1e-12);
  });
});

describe('speed and determinism', () => {
  it('2,000 line-circle intersections update in under a second', () => {
    const f = fig(['A = (-5, 0)', 'B = (5, 0)', 'l = Line(A, B)', 'O = (0, 0)', 'c = Circle(O, 2)', 'I = Intersect(l, c)']);
    expectFast(() => {
      for (let k = 0; k < 2000; k++) {
        f.setFree('A', { x: -5, y: (k % 20) / 20 }, 'api');
        f.flush();
      }
    }, 1000, 'line-circle updates');
  });
  it('an undefined input makes the intersection undefined, naming the cause', () => {
    const f = fig(['l1 = Line((0, 0), (1, 0))', 'l2 = Line((0, 1), (1, 1))', 'Q = Intersect(l1, l2)', 'm = Line(Q, (0, 5))', 'R = Intersect(m, l1)']);
    expect(why(f, 'R')).toBe('input_undefined');
    const c = f.cellOf('R')!;
    expect(!c.defined && c.cause).toBeTruthy();
  });
});
