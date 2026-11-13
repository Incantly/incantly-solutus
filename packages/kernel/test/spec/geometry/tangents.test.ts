/**
 * Special lines tied to conics (Tangent, Polar, Pole, ConjugateDiameter, Asymptote, IsTangent) and curvature.
 * Docs: conics/design.md 1.1, 6.1 to 6.7, 7; conics/errors.md 4; conics/agent.md 2 and 5.2.
 */
import { describe, expect, it, vi } from 'vitest';
import { evalIn, ok, expectLine, expectOnLine, fig, lineDist, near, nearPt, num, slotUndef, undefIn, val, type L3, type V2 } from './helpers';

vi.setConfig({ testTimeout: 5000 });

const CIRC = ['O = (0, 0)', 'c = Circle(O, 2)'];
const EL = ['el = Ellipse((-3, 0), (3, 0), 5)'];
const HYP = ['hy = Conic(x^2/9 - y^2/16 == 1)'];
const PARAB = ['pb = Conic(x^2 == 4y)'];
type Slot = L3 | null | undefined;
/** The slots of a list result; a whole-undefined result (no solution at all) is an empty list. */
const lines = (base: string[], expr: string): Slot[] => {
  const f = fig(base);
  ok(f.apply(`out = ${expr}`), expr);
  const c = f.cellOf('out')!;
  return c.defined ? (c.value as Slot[]) : [];
};

describe('Tangent(Point, Conic)', () => {
  it('from an outside point to a circle gives two lines through the point, each at distance r from the centre', () => {
    const [t1, t2] = lines(CIRC, 'Tangent((5, 0), c)') as L3[];
    for (const t of [t1!, t2!]) {
      expectOnLine(t, { x: 5, y: 0 }, 1e-12);
      near(lineDist(t, { x: 0, y: 0 }), 2, 1e-12);
    }
  });
  it('slot 1 touches on the left of the ray from the point to the centre', () => {
    const [t1, t2] = lines(CIRC, 'Tangent((5, 0), c)') as L3[];
    expectOnLine(t1, { x: 0.8, y: -Math.sqrt(3.36) }, 1e-12);
    expectOnLine(t2, { x: 0.8, y: Math.sqrt(3.36) }, 1e-12);
  });
  it('from a point on the circle slot 1 is the tangent there and slot 2 is undefined', () => {
    const [t1, t2] = lines(CIRC, 'Tangent((2, 0), c)');
    expectLine(t1, { a: 1, b: 0, c: 2 });
    expect(slotUndef(t2)).toBe(true);
  });
  it('from an inside point both slots are undefined: inside', () => expect(undefIn(CIRC, 'Tangent((1, 1), c)')).toBe('inside'));
  it('from a point a hair off the circle slot 1 is still a tangent through that point (no flicker)', () => {
    for (const d of [0, 1e-9, 1e-6]) {
      const [t1] = lines(CIRC, `Tangent((${2 + d}, 0), c)`);
      expectOnLine(t1, { x: 2, y: 0 }, 1e-5);
    }
  });
  it('from an outside point to an ellipse both lines touch the ellipse', () => {
    const f = fig([...EL, 'T = Tangent((0, 8), el)', 't1 = T[1]', 't2 = T[2]', 'k1 = IsTangent(t1, el)', 'k2 = IsTangent(t2, el)']);
    expect(val(f, 'k1')).toBe(true);
    expect(val(f, 'k2')).toBe(true);
  });
  it('from a point on an asymptote of a hyperbola only one finite tangent exists', () => {
    const [t1, t2] = lines(HYP, 'Tangent((3, 4), hy)');
    expect(slotUndef(t1)).toBe(false);
    expect(slotUndef(t2)).toBe(true);
  });
  it('both tangent lengths from the point are equal (circle)', () => {
    const f = fig([...CIRC, 'Q = (4, 1)', 'T = Tangent(Q, c)', 't1 = T[1]', 't2 = T[2]', 'A1 = Intersect(t1, c, 1)', 'A2 = Intersect(t2, c, 1)', 'd1 = Distance(Q, A1)', 'd2 = Distance(Q, A2)']);
    near(num(f, 'd1'), num(f, 'd2'), 1e-6);
  });
});

describe('Tangent(Line, Conic) and Tangent(Conic, Conic)', () => {
  it('parallel to the x axis a circle has the two tangents y = -2 and y = 2 (slot order: see the report)', () => {
    const ts = lines(CIRC, 'Tangent(Line((0, 0), (1, 0)), c)') as L3[];
    expect(ts.length).toBe(2);
    const ys = ts.map((t) => t.c / t.b).sort((p, q) => p - q);
    near(ys[0]!, -2);
    near(ys[1]!, 2);
  });
  it('an ellipse has the two tangents y = -4 and y = 4 parallel to its major axis', () => {
    const ts = lines(EL, 'Tangent(Line((0, 0), (1, 0)), el)') as L3[];
    const ys = ts.map((t) => t.c / t.b).sort((p, q) => p - q);
    near(ys[0]!, -4, 1e-9);
    near(ys[1]!, 4, 1e-9);
  });
  it('a parabola has one tangent of a given slope; slot 2 is undefined', () => {
    const [t1, t2] = lines(PARAB, 'Tangent(Line((0, 0), (1, 1)), pb)');
    expectOnLine(t1, { x: 1, y: 0 }, 1e-12);
    expect(slotUndef(t2)).toBe(true);
  });
  it('a direction with no tangent is undefined: no_tangent (horizontal on x^2/9 - y^2/16 = 1)', () => {
    expect(undefIn(HYP, 'Tangent(Line((0, 0), (1, 0)), hy)')).toBe('no_tangent');
  });
  it('a degenerate conic gives degenerate_conic', () => {
    expect(undefIn(['k = Conic(x^2 - y^2 == 0)'], 'Tangent(Line((0, 0), (1, 0)), k)')).toBe('degenerate_conic');
  });
  it('two separate equal circles have four common tangents, each at distance 2 from both centres', () => {
    const ts = lines(['o1 = (0, 0)', 'o2 = (6, 0)', 'c1 = Circle(o1, 2)', 'c2 = Circle(o2, 2)'], 'Tangent(c1, c2)');
    expect(ts.filter((t) => !slotUndef(t)).length).toBe(4);
    for (const t of ts as L3[]) {
      near(lineDist(t, { x: 0, y: 0 }), 2, 1e-9);
      near(lineDist(t, { x: 6, y: 0 }), 2, 1e-9);
    }
  });
  it('two overlapping circles have only the two outer tangents', () => {
    const ts = lines(['o1 = (0, 0)', 'o2 = (2, 0)', 'c1 = Circle(o1, 2)', 'c2 = Circle(o2, 2)'], 'Tangent(c1, c2)');
    expect(ts.filter((t) => !slotUndef(t)).length).toBe(2);
  });
  it('a circle nested inside another has no common tangent', () => {
    const ts = lines(['o1 = (0, 0)', 'o2 = (0.5, 0)', 'c1 = Circle(o1, 4)', 'c2 = Circle(o2, 1)'], 'Tangent(c1, c2)');
    expect(ts.filter((t) => !slotUndef(t)).length).toBe(0);
  });
});

describe('Polar, Pole and ConjugateDiameter', () => {
  it('the polar of (4, 0) with respect to the circle of radius 2 is x = 1', () => expectLine(evalIn(CIRC, 'Polar((4, 0), c)'), { a: 1, b: 0, c: 1 }));
  it('Polar from the singular point of a pair of lines: degenerate_conic', () => expect(undefIn(['k = Conic(x^2 - y^2 == 0)'], 'Polar((0, 0), k)')).toBe('degenerate_conic'));
  it('Pole(line, circle) inverts Polar: the pole of x = 1 is (4, 0)', () => nearPt(evalIn(CIRC, 'Pole(Line((1, 0), (1, 1)), c)'), 4, 0, 1e-12));
  it('Pole after Polar returns the original point for an ellipse', () => {
    const f = fig(['el = Conic(x^2/25 + y^2/16 == 1)', 'P = (7, 3)', 'pl = Polar(P, el)', 'Q = Pole(pl, el)']);
    const q = val<V2>(f, 'Q');
    nearPt(q, 7, 3, 1e-9);
  });
  it('the pole of a line through the centre is at infinity', () => expect(undefIn(CIRC, 'Pole(Line((0, 0), (1, 0)), c)')).toBe('at_infinity'));
  it('ConjugateDiameter of the direction (1, 1) in an ellipse passes through the centre with direction (25, -16)', () => {
    const l = evalIn<L3>(['el = Conic(x^2/25 + y^2/16 == 1)'], 'ConjugateDiameter(Line((0, 0), (1, 1)), el)');
    expectOnLine(l, { x: 0, y: 0 }, 1e-12);
    expectOnLine(l, { x: 25, y: -16 }, 1e-9);
  });
  it('ConjugateDiameter of a parabola is parallel to the axis (vertical for x^2 = 4y)', () => {
    const l = evalIn<L3>(PARAB, 'ConjugateDiameter(Vector(1, 1), pb)');
    near(l.b, 0, 1e-12);
  });
  it('ConjugateDiameter in an asymptote direction is the asymptote', () => {
    const l = evalIn<L3>(HYP, 'ConjugateDiameter(Vector(3, 4), hy)');
    expectOnLine(l, { x: 0, y: 0 }, 1e-12);
    expectOnLine(l, { x: 3, y: 4 }, 1e-9);
  });
});

describe('Asymptote and IsTangent', () => {
  it('a hyperbola with a = 3, b = 4 has asymptotes through the centre with slopes 4/3 and -4/3', () => {
    const [a1, a2] = lines(HYP, 'Asymptote(hy)') as L3[];
    expectOnLine(a1, { x: 3, y: 4 }, 1e-9);
    expectOnLine(a2, { x: 3, y: -4 }, 1e-9);
    expectOnLine(a1, { x: 0, y: 0 }, 1e-9);
  });
  it('Asymptote of an ellipse is undefined: not_hyperbola', () => expect(undefIn(EL, 'Asymptote(el)')).toBe('not_hyperbola'));
  it('Asymptote of a pair of lines is the lines themselves', () => {
    const ls = lines(['k = Conic(x^2 - y^2 == 0)'], 'Asymptote(k)');
    expect(ls.filter((l) => !slotUndef(l)).length).toBe(2);
  });
  it('Asymptote of 1/x: the vertical x = 0 first, then the horizontal y = 0', () => {
    const [v, h] = lines(['f(x) = 1 / x'], 'Asymptote(f)');
    expectLine(v, { a: 1, b: 0, c: 0 });
    expectLine(h, { a: 0, b: 1, c: 0 });
  });
  it('a polynomial has no asymptote: the list is empty', () => expect(evalIn(['f(x) = x^2 - 3'], 'Asymptote(f)')).toEqual([]));
  it('IsTangent is true for y = 2 on the circle of radius 2 and false for y = 2.1 and y = 1', () => {
    expect(evalIn(CIRC, 'IsTangent(Line((0, 2), (1, 2)), c)')).toBe(true);
    expect(evalIn(CIRC, 'IsTangent(Line((0, 2.1), (1, 2.1)), c)')).toBe(false);
    expect(evalIn(CIRC, 'IsTangent(Line((0, 1), (1, 1)), c)')).toBe(false);
  });
});

describe('Curvature, CurvatureVector, OsculatingCircle', () => {
  it('Curvature of a circle has magnitude 1 / r', () => near(Math.abs(evalIn<number>(CIRC, 'Curvature((0, 2), c)')), 0.5, 1e-9));
  it('Curvature of y = x^2 at the vertex is 2', () => near(evalIn<number>(['f(x) = x^2'], 'Curvature((0, 0), f)'), 2, 1e-9));
  it('the CurvatureVector of a circle points to the centre', () => {
    const v = evalIn<V2>(CIRC, 'CurvatureVector((2, 0), c)');
    expect(v.x).toBeLessThan(0);
    near(v.y, 0, 1e-9);
  });
  it('OsculatingCircle of a circle is the circle', () => {
    const f = fig([...CIRC, 'oc = OsculatingCircle((0, 2), c)', 'r = Radius(oc)', 'ctr = Center(oc)']);
    near(num(f, 'r'), 2, 1e-9);
    nearPt(val(f, 'ctr'), 0, 0, 1e-9);
  });
  it('OsculatingCircle of y = x^2 at the vertex has radius 1/2 and centre (0, 0.5)', () => {
    const f = fig(['f(x) = x^2', 'oc = OsculatingCircle((0, 0), f)', 'r = Radius(oc)', 'ctr = Center(oc)']);
    near(num(f, 'r'), 0.5, 1e-9);
    nearPt(val(f, 'ctr'), 0, 0.5, 1e-9);
  });
  it('OsculatingCircle of x^2 = 4y at its vertex has radius 2 and centre (0, 2)', () => {
    const f = fig([...PARAB, 'oc = OsculatingCircle((0, 0), pb)', 'r = Radius(oc)', 'ctr = Center(oc)']);
    near(num(f, 'r'), 2, 1e-9);
    nearPt(val(f, 'ctr'), 0, 2, 1e-9);
  });
});
