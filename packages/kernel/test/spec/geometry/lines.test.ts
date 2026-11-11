/**
 * Lines, segments, rays, vectors, special lines, bisectors, directions and vector commands.
 * Docs: points-lines/design.md 1.1, 5.1 to 5.3, 5.2 (directions), 13.6 (operators); points-lines/errors.md 3, 4;
 * kernel/rulings.md K2 (self reference); language/rulings.md Q5 to Q7 (arity kinds).
 */
import { describe, expect, it, vi } from 'vitest';
import { bad, dirOf, evalIn, expectLine, expectOnLine, fig, near, nearPt, ok, pt, sinBetween, tryLine, undefIn, val, isUndef, type L3, type V2 } from './helpers';

vi.setConfig({ testTimeout: 5000 });

const BASE = ['A = (0, 0)', 'B = (4, 0)', 'C = (1, 3)', 'l = Line(A, B)', 'u = Vector(3, 4)', 'w = Vector(1, 2)'];

describe('Line', () => {
  it('Line(P, Q) passes through both points', () => {
    const f = fig([...BASE, 'm = Line(A, C)']);
    expectOnLine(val(f, 'm'), { x: 0, y: 0 });
    expectOnLine(val(f, 'm'), { x: 1, y: 3 });
  });
  it('Line(P, Vector) has the direction of the vector', () => {
    const l = evalIn<L3>(BASE, 'Line((1, 1), Vector(1, 2))');
    expectOnLine(l, { x: 2, y: 3 });
    expectOnLine(l, { x: 0, y: -1 });
  });
  it('Line(P, Line) is the parallel through P', () => {
    const f = fig([...BASE, 'm = Line((0, 2), l)']);
    expectOnLine(val(f, 'm'), { x: 0, y: 2 });
    near(sinBetween(val(f, 'm'), val(f, 'l')), 0, 1e-12);
  });
  it('Line(equation) from 2x + 3y == 6 passes through (3, 0) and (0, 2)', () => {
    const l = evalIn<L3>([], 'Line(2x + 3y == 6)');
    expectOnLine(l, { x: 3, y: 0 });
    expectOnLine(l, { x: 0, y: 2 });
  });
  it('Line(equation) of a vertical line x == 2', () => expectLine(evalIn([], 'Line(x == 2)'), { a: 1, b: 0, c: 2 }));
  it('Line(A, A) is undefined: coincident_points', () => expect(undefIn(BASE, 'Line(A, A)')).toBe('coincident_points'));
});

describe('Segment and Ray', () => {
  it('Segment(P, Q) holds both end points', () => {
    const s = evalIn<{ a: V2; b: V2 }>(BASE, 'Segment(A, C)');
    nearPt(s.a, 0, 0);
    nearPt(s.b, 1, 3);
  });
  it('Segment(P, length) runs along +x', () => {
    const s = evalIn<{ a: V2; b: V2 }>(BASE, 'Segment((1, 1), 3)');
    nearPt(s.b, 4, 1);
  });
  it('Ray(P, Q) starts at P and points to Q', () => {
    const r = evalIn<{ from: V2; dir: V2 }>(BASE, 'Ray(A, C)');
    nearPt(r.from, 0, 0);
    near(r.dir.y / r.dir.x, 3, 1e-12);
  });
  it('Ray(P, P) is undefined: coincident_points', () => expect(undefIn(BASE, 'Ray(A, A)')).toBe('coincident_points'));
});

describe('Vector', () => {
  it('Vector(dx, dy)', () => nearPt(evalIn([], 'Vector(2, -3)'), 2, -3));
  it('Vector(P, Q) is Q - P', () => nearPt(evalIn(BASE, 'Vector(B, C)'), -3, 3));
  it('Point - Point is a Vector', () => {
    const f = fig([...BASE, 'v = C - B']);
    expect(f.get('v')?.type).toBe('Vector');
    nearPt(val(f, 'v'), -3, 3);
  });
  it('Vector + Vector and Vector - Vector', () => {
    nearPt(evalIn(BASE, 'u + w'), 4, 6);
    nearPt(evalIn(BASE, 'u - w'), 2, 2);
  });
  it('Vector * Vector is a type_mismatch whose hint names Dot and Cross', () => {
    const e = bad(tryLine(BASE, 'p = u * w'), 'type_mismatch');
    expect(e.hint ?? '').toMatch(/Dot/);
    expect(e.hint ?? '').toMatch(/Cross/);
  });
  it('Point + Point is a type_mismatch', () => bad(tryLine(BASE, 'p = A + B'), 'type_mismatch'));
});

describe('Direction and Normal', () => {
  it('Direction(Line(P, Q)) is the unit vector from P to Q', () => nearPt(evalIn([], 'Direction(Line((0, 0), (3, 4)))'), 0.6, 0.8));
  it('Direction(Segment) runs from the first to the second end point', () => nearPt(evalIn([], 'Direction(Segment((1, 1), (1, 6)))'), 0, 1));
  it('Direction(Line(equation)) has a positive first non-zero component', () => {
    const d = evalIn<V2>([], 'Direction(Line(2x + 3y == 6))');
    nearPt(d, 3 / Math.sqrt(13), -2 / Math.sqrt(13));
  });
  it('Direction of a vertical equation line points up (first non-zero component positive)', () => nearPt(evalIn([], 'Direction(Line(x == 2))'), 0, 1));
  it('Normal(Line) is the direction turned 90 degrees counter-clockwise', () => nearPt(evalIn([], 'Normal(Line((0, 0), (1, 0)))'), 0, 1));
  it('Direction of the stored line agrees with (b, -a)', () => {
    const l = evalIn<L3>(BASE, 'Line(A, C)');
    const d = dirOf(l);
    const dd = evalIn<V2>(BASE, 'Direction(Line(A, C))');
    nearPt(dd, d.x, d.y, 1e-12);
  });
});

describe('Perpendicular and Parallel', () => {
  const lines = ['m = Line((0, 0), (4, 0))', 's = Segment((0, 0), (4, 0))', 'r = Ray((0, 0), (4, 0))', 'v = Vector(4, 0)', 'P = (1, 2)'];
  it.each(['m', 's', 'r', 'v'])('Perpendicular(P, %s) passes through P at right angles to the carrier', (target) => {
    const f = fig([...lines, `q = Perpendicular(P, ${target})`]);
    expectOnLine(val(f, 'q'), { x: 1, y: 2 });
    expectOnLine(val(f, 'q'), { x: 1, y: 9 });
  });
  it.each(['m', 's', 'r', 'v'])('Parallel(P, %s) passes through P along the carrier', (target) => {
    const f = fig([...lines, `q = Parallel(P, ${target})`]);
    expectOnLine(val(f, 'q'), { x: 1, y: 2 });
    expectOnLine(val(f, 'q'), { x: -7, y: 2 });
  });
  it('Perpendicular to a slanted line is perpendicular (dot of directions is 0)', () => {
    const f = fig(['m = Line((0, 0), (3, 4))', 'P = (5, 1)', 'q = Perpendicular(P, m)']);
    const dm = dirOf(val(f, 'm'));
    const dq = dirOf(val(f, 'q'));
    near(dm.x * dq.x + dm.y * dq.y, 0, 1e-12);
  });
  it('Perpendicular(P, zero-length segment) is undefined: zero_length', () => {
    expect(undefIn(['P = (1, 2)', 'zs = Segment((1, 1), (1, 1))'], 'Perpendicular(P, zs)')).toBe('zero_length');
  });
  it('Parallel(P, zero vector) is undefined: zero_length', () => {
    expect(undefIn(['P = (1, 2)', 'zv = Vector(0, 0)'], 'Parallel(P, zv)')).toBe('zero_length');
  });
  it('the altitude from A of a triangle meets the opposite side at a right angle', () => {
    const f = fig(['A = (0, 0)', 'B = (6, 0)', 'C = (2, 4)', 'h = Perpendicular(A, Line(B, C))', 'H = Intersect(h, Line(B, C))']);
    const H = pt(f, 'H');
    near((H.x - 0) * (6 - 2) + (H.y - 0) * (0 - 4), 0, 1e-12);
  });
});

describe('Bisector', () => {
  it('Bisector(P, Q) is the perpendicular bisector', () => expectLine(evalIn([], 'Bisector((0, 0), (4, 0))'), { a: 1, b: 0, c: 2 }));
  it('Bisector(P, P) is undefined: coincident_points', () => expect(undefIn(BASE, 'Bisector(A, A)')).toBe('coincident_points'));
  it('Bisector(A, B, C) bisects the angle at the middle point', () => {
    expectLine(evalIn([], 'Bisector((1, 0), (0, 0), (0, 1))'), { a: 1, b: -1, c: 0 });
  });
  it('Bisector(A, B, C) of a straight angle is the perpendicular at the apex', () => {
    expectLine(evalIn([], 'Bisector((-1, 0), (0, 0), (1, 0))'), { a: 1, b: 0, c: 0 });
  });
  it('Bisector(A, B, C) of a zero angle is the common arm', () => {
    expectLine(evalIn([], 'Bisector((1, 0), (0, 0), (2, 0))'), { a: 0, b: 1, c: 0 });
  });
  it('Bisector(A, B, C) with a zero arm is undefined: zero_length', () => {
    expect(undefIn([], 'Bisector((0, 0), (0, 0), (1, 1))')).toBe('zero_length');
  });
  const two = (deg: number) => [`Q = (${Math.cos(rad(deg))}, ${Math.sin(rad(deg))})`, 'l1 = Line((0, 0), (1, 0))', 'l2 = Line((0, 0), Q)', 'B = Bisector(l1, l2)'];
  function rad(d: number): number {
    return (d * Math.PI) / 180;
  }
  it('Bisector(L1, L2) returns two lines', () => expect((val(fig(two(30)), 'B') as unknown[]).length).toBe(2));
  it('slot 1 bisects the acute angle between the lines (30 degrees)', () => {
    const f = fig(two(30));
    const b1 = (val(f, 'B') as L3[])[0]!;
    expectOnLine(b1, { x: Math.cos(rad(15)), y: Math.sin(rad(15)) });
  });
  it('slot 1 is the acute bisector whichever way the second line is oriented (150 degrees)', () => {
    const f = fig(two(150));
    const b1 = (val(f, 'B') as L3[])[0]!;
    expectOnLine(b1, { x: Math.cos(rad(165)), y: Math.sin(rad(165)) });
  });
  it('parallel lines: slot 1 is the mid-line', () => {
    const f = fig(['l1 = Line((0, 0), (1, 0))', 'l2 = Line((0, 2), (1, 2))', 'B = Bisector(l1, l2)', 'b1 = B[1]']);
    expectLine(val(f, 'b1'), { a: 0, b: 1, c: 1 });
  });
  it('parallel lines: slot 2 is an undefined slot (null), and the list keeps its length 2', () => {
    const f = fig(['l1 = Line((0, 0), (1, 0))', 'l2 = Line((0, 2), (1, 2))', 'B = Bisector(l1, l2)']);
    const slots = val<unknown[]>(f, 'B');
    expect(slots.length).toBe(2);
    expect(slots[1] ?? null).toBeNull();
  });
  it('coincident lines: slot 1 is the line, slot 2 is an undefined slot (null)', () => {
    const f = fig(['l1 = Line((0, 0), (1, 1))', 'l2 = Line((2, 2), (3, 3))', 'B = Bisector(l1, l2)']);
    const slots = val<(L3 | null)[]>(f, 'B');
    expectLine(slots[0], val(f, 'l1'));
    expect(slots[1] ?? null).toBeNull();
  });
  it('Bisector(A, B, 3) is a no_matching_form error listing the forms', () => {
    const e = bad(tryLine(BASE, 'b = Bisector(A, B, 3)'), 'no_matching_form');
    expect(e.forms.length).toBeGreaterThan(1);
  });
});

describe('UnitVector, PerpVector, UnitPerpVector', () => {
  it('UnitVector(Vector) has length 1 and the same direction', () => nearPt(evalIn(BASE, 'UnitVector(u)'), 0.6, 0.8));
  it('UnitVector(zero vector) is undefined: zero_length', () => expect(undefIn([], 'UnitVector(Vector(0, 0))')).toBe('zero_length'));
  it('PerpVector(Vector) has the same length, turned 90 degrees counter-clockwise', () => nearPt(evalIn(BASE, 'PerpVector(u)'), -4, 3));
  it('PerpVector(Segment) turns the segment vector', () => nearPt(evalIn([], 'PerpVector(Segment((0, 0), (3, 4)))'), -4, 3));
  it('PerpVector(zero vector) is the zero vector (not an error)', () => nearPt(evalIn([], 'PerpVector(Vector(0, 0))'), 0, 0));
  it('UnitPerpVector(Vector) has length 1', () => nearPt(evalIn(BASE, 'UnitPerpVector(u)'), -0.8, 0.6));
  it('UnitPerpVector(zero vector) is undefined: zero_length', () => expect(undefIn([], 'UnitPerpVector(Vector(0, 0))')).toBe('zero_length'));
});

describe('Dot, Cross, Length', () => {
  it('Dot(u, w)', () => near(evalIn<number>(BASE, 'Dot(u, w)'), 11));
  it('Dot accepts two points as position vectors', () => near(evalIn<number>(BASE, 'Dot((1, 2), (3, 4))'), 11));
  it('Cross(u, w) is the signed area u.x w.y - u.y w.x', () => near(evalIn<number>(BASE, 'Cross(u, w)'), 2));
  it('Length(Vector) is the Euclidean norm', () => near(evalIn<number>(BASE, 'Length(u)'), 5));
  it('Length(Ray) is undefined', () => {
    const f = fig(['r = Ray((0, 0), (1, 0))', 'n = Length(r)']);
    expect(isUndef(f, 'n')).toBe(true);
  });
  it('Length of a vector with a component above 1e154 is undefined: not_finite', () => expect(undefIn([], 'Length(Vector(3e160, 4e160))')).toBe('not_finite'));
});

describe('Names, kinds and cycles', () => {
  it('an unnamed Intersect is an unnamed_object error that says to name it', () => {
    const e = bad(tryLine([...BASE, 'm = Line(A, C)'], 'Intersect(l, m)'), 'unnamed_object');
    expect(e.hint ?? '').toMatch(/=/);
  });
  it('a missing object is an unknown_name error', () => bad(tryLine(BASE, 'q = Perpendicular(A, lin)'), 'unknown_name'));
  it('Line(A) with a Point is a no_matching_form error (the count fits the equation form)', () => bad(tryLine(BASE, 'q = Line(A)'), 'no_matching_form'));
  it('Line(A, 5) is a no_matching_form error', () => bad(tryLine(BASE, 'q = Line(A, 5)'), 'no_matching_form'));
  it('a point defined from itself through a dependent is a cycle', () => {
    const f = fig(['A = (0, 0)', 'B = (4, 0)', 'M = Midpoint(A, B)']);
    bad(f.apply('A = Midpoint(M, B)'), 'cycle');
  });
  it('A = Midpoint(A, B) on an existing free point is an assignment run once (kernel ruling K2)', () => {
    const f = fig(['A = (0, 0)', 'B = (4, 0)']);
    ok(f.apply('A = Midpoint(A, B)'));
    nearPt(val(f, 'A'), 2, 0);
  });
  it('a failed definition leaves the figure unchanged', () => {
    const f = fig(BASE);
    const before = f.toScript();
    bad(f.apply('q = Line(A, 5)'));
    expect(f.toScript()).toBe(before);
  });
});
