/** Throwaway builder probe (deleted before commit): smoke + timing for geometry. */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry } from '@incantly/kernel';

const { registerGeometry, GEOMETRY_COMMANDS, GEOMETRY_TYPES } = geometry;

function fig(): Figure {
  const r = new CommandRegistry();
  registerGeometry(r);
  return new Figure({ commands: r });
}

function must(f: Figure, line: string): void {
  const r = f.apply(line);
  if (!r.ok) throw new Error(`${line}: ${r.kind} ${r.message}`);
}

function val(f: Figure, name: string): unknown {
  const c = f.cellOf(name);
  if (!c || !c.defined) throw new Error(`${name} undefined: ${c && !c.defined ? c.reason : 'missing'}`);
  return c.value;
}

function reason(f: Figure, name: string): string {
  const c = f.cellOf(name);
  if (!c) throw new Error(`${name} missing`);
  if (c.defined) throw new Error(`${name} unexpectedly defined`);
  return c.reason;
}

const pt = (v: unknown): [number, number] => {
  const p = v as { x: number; y: number };
  return [p.x, p.y];
};

describe('table', () => {
  it('has no problems with geometry types', () => {
    const r = new CommandRegistry();
    registerGeometry(r);
    const ps = r.problems({ types: [...GEOMETRY_TYPES, 'Matrix'] });
    expect(ps).toEqual([]);
  });
  it('registers 114 commands', () => {
    expect(GEOMETRY_COMMANDS.length).toBe(114);
  });
});

describe('points-lines', () => {
  it('midpoint, line, intersect, distance, angle', () => {
    const f = fig();
    must(f, 'A = (0, 0)');
    must(f, 'B = (4, 0)');
    must(f, 'C = (1, 3)');
    must(f, 'M = Midpoint(A, B)');
    expect(pt(val(f, 'M'))).toEqual([2, 0]);
    must(f, 'l = Line(A, B)');
    must(f, 'm = Line(A, C)');
    must(f, 'P = Intersect(l, m)');
    expect(pt(val(f, 'P'))).toEqual([0, 0]);
    must(f, 'd = Distance(A, B)');
    expect(val(f, 'd')).toBeCloseTo(4, 12);
    must(f, 'a = Angle(A, C, B)');
    expect(val(f, 'a')).toBeGreaterThan(0);
  });
  it('parallel and outside_path reasons', () => {
    const f = fig();
    must(f, 'A = (0, 0)');
    must(f, 'B = (1, 0)');
    must(f, 'C = (0, 1)');
    must(f, 'D = (1, 1)');
    must(f, 'a = Line(A, B)');
    must(f, 'b = Line(C, D)');
    must(f, 'P = Intersect(a, b)');
    expect(reason(f, 'P')).toBe('parallel');
    must(f, 's = Segment(A, B)');
    must(f, 'e = Line((5, -1), (5, 1))');
    must(f, 'Q = Intersect(s, e)');
    expect(reason(f, 'Q')).toBe('outside_path');
  });
  it('perpendicular, parallel, bisector', () => {
    const f = fig();
    must(f, 'A = (0, 0)');
    must(f, 'B = (4, 0)');
    must(f, 'l = Line(A, B)');
    must(f, 'P = (1, 2)');
    must(f, 'h = Perpendicular(P, l)');
    must(f, 'H = Intersect(h, l)');
    const [x, y] = pt(val(f, 'H'));
    expect(x).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(0, 12);
    must(f, 'd = Bisector(A, B)');
    must(f, 'S = Slope(l)');
    expect(val(f, 'S')).toBeCloseTo(0, 12);
  });
  it('vectors and polar', () => {
    const f = fig();
    must(f, 'u = Vector(3, 4)');
    must(f, 'w = UnitVector(u)');
    const [x, y] = pt(val(f, 'w'));
    expect(x).toBeCloseTo(0.6, 12);
    expect(y).toBeCloseTo(0.8, 12);
    must(f, 't = ToPolar(u)');
    expect(val(f, 't')).toEqual([5, Math.atan2(4, 3)]);
  });
  it('point on, along, param', () => {
    const f = fig();
    must(f, 'A = (0, 0)');
    must(f, 'B = (4, 0)');
    must(f, 's = Segment(A, B)');
    must(f, 'P = PointOn(s, 0.25)');
    expect(pt(val(f, 'P'))).toEqual([1, 0]);
    must(f, 'Q = Along(s, 0.5)');
    expect(pt(val(f, 'Q'))).toEqual([2, 0]);
    must(f, 'u = ParamOf(Q, s)');
    expect(val(f, 'u')).toBeCloseTo(0.5, 12);
  });
  it('predicates', () => {
    const f = fig();
    must(f, 'A = (0, 0)');
    must(f, 'B = (1, 0)');
    must(f, 'C = (2, 0)');
    must(f, 'k = AreCollinear(A, B, C)');
    expect(val(f, 'k')).toBe(true);
    must(f, 'a = Line(A, B)');
    must(f, 'b = Line((0, 1), (1, 1))');
    must(f, 'p = AreParallel(a, b)');
    expect(val(f, 'p')).toBe(true);
  });
});

describe('conics', () => {
  it('circle, arc, tangent, focus', () => {
    const f = fig();
    must(f, 'O = (0, 0)');
    must(f, 'c = Circle(O, 2)');
    must(f, 'Q = (4, 0)');
    must(f, 'T = Tangent(Q, c)');
    const t = val(f, 'T') as unknown[];
    expect(t.length).toBe(2);
    must(f, 'F = Focus(c)');
    expect((val(f, 'F') as unknown[]).length).toBe(2);
    must(f, 'r = Radius(c)');
    expect(val(f, 'r')).toBe(2);
    must(f, 's = Sector(O, 2, 0, 1.5707963267948966)');
    must(f, 'ar = Area(s)');
    expect(val(f, 'ar')).toBeCloseTo(Math.PI, 10);
  });
  it('ellipse and hyperbola guards', () => {
    const f = fig();
    must(f, 'F1 = (-3, 0)');
    must(f, 'F2 = (3, 0)');
    must(f, 'e = Ellipse(F1, F2, 5)');
    must(f, 'a = SemiMajor(e)');
    expect(val(f, 'a')).toBeCloseTo(5, 12);
    must(f, 'bad = Ellipse(F1, F2, 2)');
    expect(reason(f, 'bad')).toBe('too_short');
    must(f, 'h = Hyperbola(F1, F2, 2)');
    must(f, 'ah = Asymptote(h)');
    expect((val(f, 'ah') as unknown[]).length).toBe(2);
  });
  it('five-point conic and equation', () => {
    const f = fig();
    must(f, 'k = Conic(x^2 + y^2 == 4)');
    must(f, 't = Type(k)');
    expect(val(f, 't')).toBe('circle');
    must(f, 'q = Conic(x^3 + y == 1)');
    expect(reason(f, 'q')).toBe('not_quadratic');
  });
  it('line-circle slots and index', () => {
    const f = fig();
    must(f, 'O = (0, 0)');
    must(f, 'c = Circle(O, 2)');
    must(f, 'l = Line((-3, 0), (3, 0))');
    must(f, 'L = Intersect(l, c)');
    const pts = val(f, 'L') as Array<{ x: number; y: number } | undefined>;
    expect(pts.length).toBe(2);
    expect(pts[0]?.x).toBeCloseTo(-2, 10);
    expect(pts[1]?.x).toBeCloseTo(2, 10);
    must(f, 'P1 = Intersect(l, c, 1)');
    expect(pt(val(f, 'P1'))[0]).toBeCloseTo(-2, 10);
  });
});

describe('polygons-transforms', () => {
  it('polygon area, regular, vertex', () => {
    const f = fig();
    must(f, 'A = (0, 0)');
    must(f, 'B = (4, 0)');
    must(f, 'C = (1, 3)');
    must(f, 'tri = Polygon(A, B, C)');
    must(f, 'a = Area(tri)');
    expect(val(f, 'a')).toBeCloseTo(6, 12);
    must(f, 'O = (0, 0)');
    must(f, 'sq = Polygon(O, 2, 4)');
    must(f, 'asq = Area(sq)');
    expect(val(f, 'asq')).toBeCloseTo(8, 10);
    must(f, 'V = Vertex(tri, 2)');
    expect(pt(val(f, 'V'))).toEqual([4, 0]);
  });
  it('rotate, translate, reflect, dilate', () => {
    const f = fig();
    must(f, 'A = (2, 1)');
    must(f, 'O = (0, 0)');
    must(f, 'B = Rotate(A, 1.5707963267948966, O)');
    const [x, y] = pt(val(f, 'B'));
    expect(x).toBeCloseTo(-1, 12);
    expect(y).toBeCloseTo(2, 12);
    must(f, 'v = Vector(3, 0)');
    must(f, 'C = Translate(A, v)');
    expect(pt(val(f, 'C'))).toEqual([5, 1]);
    must(f, 'm = Line((0, 0), (1, 0))');
    must(f, 'D = Reflect(A, m)');
    expect(pt(val(f, 'D'))).toEqual([2, -1]);
    must(f, 'E = Dilate(A, 2, O)');
    expect(pt(val(f, 'E'))).toEqual([4, 2]);
  });
  it('booleans', () => {
    const f = fig();
    must(f, 'a = Polygon((0, 0), (3, 0), (3, 3), (0, 3))');
    must(f, 'b = Polygon((2, 2), (5, 2), (5, 5), (2, 5))');
    must(f, 'ov = IntersectPath(a, b)');
    must(f, 'oa = Area(ov[1])');
    expect(val(f, 'oa')).toBeCloseTo(1, 9);
    must(f, 'u = Union(a, b)');
    must(f, 'ua = Area(u[1])');
    expect(val(f, 'ua')).toBeCloseTo(17, 9);
    must(f, 'dd = Difference(a, b)');
    must(f, 'da = Area(dd[1])');
    expect(val(f, 'da')).toBeCloseTo(8, 9);
  });
  it('transform values and move', () => {
    const f = fig();
    must(f, 'A = (1, 0)');
    must(f, 'O = (0, 0)');
    must(f, 'T = Then(Turn(1.5707963267948966, O))');
    must(f, 'B = Move(A, T)');
    const [x, y] = pt(val(f, 'B'));
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(1, 12);
  });
  it('locus over a free number', () => {
    const f = fig();
    must(f, 's = 0 in 0..1');
    must(f, 'A = (0, 0)');
    must(f, 'B = (4, 0)');
    must(f, 's2 = Segment(A, B)');
    must(f, 'M = Along(s2, s)');
    must(f, 'tr = Locus(M, s, 0, 1)');
    const c = f.cellOf('tr');
    expect(c?.defined).toBe(true);
  });
});

describe('timing', () => {
  it('prints speed numbers', () => {
    const f = fig();
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) {
      must(f, `P${i} = (${i % 100}, ${(i * 7) % 100})`);
    }
    const t1 = performance.now();
    must(f, 'A = (0, 0)');
    must(f, 'B = (6, 0)');
    must(f, 'C = (2, 4)');
    must(f, 'ha = Perpendicular(A, Line(B, C))');
    must(f, 'hb = Perpendicular(B, Line(C, A))');
    must(f, 'H = Intersect(ha, hb)');
    const t2 = performance.now();
    must(f, 'O = (0, 0)');
    must(f, 'c1 = Circle(O, 5)');
    must(f, 'c2 = Circle((6, 0), 5)');
    must(f, 'II = Intersect(c1, c2)');
    const t3 = performance.now();
    must(f, 'e = Ellipse((-3, 0), (3, 0), 5)');
    must(f, 'h2 = Hyperbola((-3, 0), (3, 0), 2)');
    must(f, 'CC = Intersect(e, h2)');
    const t4 = performance.now();
    must(f, 'pg = Polygon(O, 2, 100)');
    must(f, 'ag = Area(pg)');
    const t5 = performance.now();
    console.log(`2000 points: ${(t1 - t0).toFixed(1)}ms`);
    console.log(`altitudes: ${(t2 - t1).toFixed(2)}ms`);
    console.log(`circle-circle: ${(t3 - t2).toFixed(2)}ms`);
    console.log(`conic-conic: ${(t4 - t3).toFixed(2)}ms`);
    console.log(`100-gon area: ${(t5 - t4).toFixed(2)}ms`);
    expect(val(f, 'ag')).toBeGreaterThan(0);
  });
});
