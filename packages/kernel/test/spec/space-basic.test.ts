/** Points, vectors, lines and planes in space (.kiro/specs/space-3d R1; docs/features/space-3d design 2.3, 5, 7; errors 3, 4). */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, registerFunctions, registerNumbers, registerSpace, space, valueText } from '../../src/index';

let f: Figure;

const newFigure = (): Figure => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerSpace(r);
  return new Figure({ commands: r });
};

beforeEach(() => {
  f = newFigure();
});

const ok = (line: string): void => {
  const r = f.apply(line);
  if (!r.ok) throw new Error(`${line}: ${(r as { message: string }).message}`);
};
const val = (name: string): unknown => {
  const o = f.get(name);
  if (!o || !o.cell.defined) throw new Error(`${name} is undefined`);
  return o.cell.value;
};
const undef = (name: string): { reason: string; detail?: string } => {
  const o = f.get(name);
  if (!o || o.cell.defined) throw new Error(`${name} is defined`);
  return o.cell as unknown as { reason: string; detail?: string };
};
const fail = (line: string): { kind: string; message: string; hint?: string; suggest: string[]; code: string } => {
  const r = f.apply(line);
  if (r.ok) throw new Error(`${line} was accepted`);
  return r as never;
};
const close = (a: unknown, b: { x: number; y: number; z: number }): void => {
  const p = a as { x: number; y: number; z: number };
  expect(p.x).toBeCloseTo(b.x, 12);
  expect(p.y).toBeCloseTo(b.y, 12);
  expect(p.z).toBeCloseTo(b.z, 12);
};

describe('points in space (R1.1)', () => {
  it('(x, y, z) is a free Point3 with fields x, y, z; (x, y) stays a flat Point', () => {
    ok('A = (1, 2, 3)');
    ok('P = (1, 2)');
    expect(f.get('A')).toMatchObject({ type: 'Point3', free: true });
    expect(f.get('P')).toMatchObject({ type: 'Point', free: true });
    expect(val('A')).toEqual({ x: 1, y: 2, z: 3 });
    ok('k = A.x + A.y * A.z');
    expect(val('k')).toBe(7);
  });

  it('coordinates may be formulas; the point is then dependent', () => {
    ok('a = 2');
    ok('B = (a, a^2, -a)');
    expect(val('B')).toEqual({ x: 2, y: 4, z: -2 });
    expect(f.get('B')?.free).toBe(false);
  });

  it('refuses a point of three where an item is not a Number, and a field it has not', () => {
    expect(fail('C = (1, 2, "z")').kind).toBe('type_mismatch');
    ok('A = (1, 2, 3)');
    expect(fail('k = A.w').kind).toBe('unknown_field');
  });

  it('saves as it was written and reads back the same', () => {
    ok('A = (1, 2.5, -3)');
    ok('B = (0, 0, 1)');
    ok('s = Segment(A, B)');
    const script = f.toScript();
    expect(script).toContain('A = (1, 2.5, -3)');
    const g = newFigure();
    g.append(script);
    expect(g.toScript()).toBe(script);
    expect(g.get('s')?.type).toBe('Segment3');
  });

  it('a free point can be set and dragged; a midpoint drags its first point', () => {
    ok('A = (1, 2, 3)');
    ok('B = (3, 2, 3)');
    ok('M = Midpoint(A, B)');
    expect(f.setFree('A', { x: 0, y: 0, z: 0 }, 'drag').ok).toBe(true);
    f.flush();
    close(val('M'), { x: 1.5, y: 1, z: 1.5 });
    expect(f.toScript()).toContain('A = (0, 0, 0)');
    const plan = f.dragPlan('M', { x: 5, y: 5, z: 5 });
    expect(plan.writes).toEqual([{ id: f.get('A')?.id, name: 'A', value: { x: 7, y: 8, z: 7 } }]);
    expect(f.drag(plan).ok).toBe(true);
    close(val('M'), { x: 5, y: 5, z: 5 });
  });

  it('shows as (x, y, z) in texts', () => {
    ok('A = (1, 2, 3)');
    expect(valueText(val('A'))).toBe('(1, 2, 3)');
  });
});

describe('operators (R1.2)', () => {
  beforeEach(() => {
    ok('A = (1, 2, 3)');
    ok('B = (4, 6, 3)');
  });

  it('point − point is a vector; point ± vector is a point; vectors add, scale and negate', () => {
    ok('v = B - A');
    expect(f.get('v')?.type).toBe('Vector3');
    expect(val('v')).toEqual({ x: 3, y: 4, z: 0 });
    ok('C = A + v');
    expect(val('C')).toEqual({ x: 4, y: 6, z: 3 });
    ok('D = B - v');
    expect(val('D')).toEqual({ x: 1, y: 2, z: 3 });
    ok('w = 2 * v + v / 2 - v * 1');
    expect(val('w')).toEqual({ x: 4.5, y: 6, z: 0 });
    ok('n = -v');
    expect(val('n')).toEqual({ x: -3, y: -4, z: -0 });
    ok('L = v.length');
    expect(val('L')).toBe(5);
  });

  it('other mixes are type_mismatch (S007)', () => {
    expect(fail('X = A * B').kind).toBe('type_mismatch');
    expect(fail('X = A + B').kind).toBe('type_mismatch');
    ok('v = B - A');
    expect(fail('X = v + A').kind).toBe('type_mismatch');
  });
});

describe('lines and planes (R1.3)', () => {
  it('Vector, Segment, Line, Ray and Point', () => {
    ok('A = (0, 0, 0)');
    ok('B = (0, 0, 2)');
    ok('u = Vector(1, 2, 2)');
    expect(val('u')).toEqual({ x: 1, y: 2, z: 2 });
    ok('w = Vector(A, B)');
    expect(val('w')).toEqual({ x: 0, y: 0, z: 2 });
    ok('s = Segment(A, B)');
    expect(f.get('s')?.type).toBe('Segment3');
    ok('l = Line(A, B)');
    expect(val('l')).toMatchObject({ o: { x: 0, y: 0, z: 0 }, d: { x: 0, y: 0, z: 1 } });
    ok('m = Line(A, u)');
    close((val('m') as { d: unknown }).d, { x: 1 / 3, y: 2 / 3, z: 2 / 3 });
    ok('r = Ray(B, u)');
    expect(f.get('r')?.type).toBe('Ray3');
    ok('C = Point(A, u)');
    expect(val('C')).toEqual({ x: 1, y: 2, z: 2 });
    ok('M = Midpoint(s)');
    expect(val('M')).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('a line through one point twice is degenerate', () => {
    ok('A = (1, 1, 1)');
    ok('l = Line(A, A)');
    expect(undef('l').reason).toBe('degenerate');
  });

  it('Plane through three points, a point and a normal, a point and a line, and of a polygon', () => {
    ok('A = (1, 0, 0)');
    ok('B = (0, 1, 0)');
    ok('C = (0, 0, 1)');
    ok('p = Plane(A, B, C)');
    const p = val('p') as { n: { x: number; y: number; z: number }; c: number };
    const k = 1 / Math.sqrt(3);
    close(p.n, { x: k, y: k, z: k });
    expect(p.c).toBeCloseTo(k, 12);
    ok('q = Plane(A, Vector(0, 0, 2))');
    expect(val('q')).toMatchObject({ n: { x: 0, y: 0, z: 1 }, c: 0 });
    ok('r = Plane(C, Line(A, B))');
    close((val('r') as { n: unknown }).n, { x: k, y: k, z: k });
    ok('g = Polygon(A, B, C)');
    ok('s = Plane(g)');
    close((val('s') as { n: unknown }).n, { x: k, y: k, z: k });
    expect(valueText(val('q'))).toBe('plane z = 0');
  });

  it('three points in a row fix no plane; a point on its line fixes none', () => {
    ok('p = Plane((0, 0, 0), (1, 1, 1), (2, 2, 2))');
    expect(undef('p')).toMatchObject({ reason: 'degenerate' });
    expect(undef('p').detail).toMatch(/one line/);
    ok('q = Plane((1, 1, 1), Line((0, 0, 0), (2, 2, 2)))');
    expect(undef('q').reason).toBe('degenerate');
    ok('z0 = Plane((0, 0, 0), Vector(0, 0, 0))');
    expect(undef('z0').reason).toBe('degenerate');
  });

  it('a polygon is flat: one off its plane is not_coplanar with the distance; 1e-12 off is accepted', () => {
    ok('g = Polygon((0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 0.5))');
    expect(undef('g')).toMatchObject({ reason: 'not_coplanar', detail: 'point 4 is 0.5 off the plane of the first three' });
    ok('h = Polygon((0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 1e-12))');
    expect(f.get('h')?.cell.defined).toBe(true);
    ok('k = Polygon([(0, 0, 1), (3, 0, 1), (0, 4, 1)])');
    expect(f.get('k')?.type).toBe('Polygon3');
  });

  it('Dot, Cross, UnitVector, Direction and Normal', () => {
    ok('d = Dot(Vector(1, 2, 3), Vector(4, -5, 6))');
    expect(val('d')).toBe(12);
    ok('c = Cross(Vector(1, 0, 0), Vector(0, 1, 0))');
    expect(val('c')).toEqual({ x: 0, y: 0, z: 1 });
    ok('u = UnitVector(Vector(0, 3, 4))');
    close(val('u'), { x: 0, y: 0.6, z: 0.8 });
    ok('dir = Direction(Segment((1, 1, 1), (1, 1, 5)))');
    close(val('dir'), { x: 0, y: 0, z: 1 });
    ok('n = Normal(Plane((0, 0, 0), Vector(0, 2, 0)))');
    close(val('n'), { x: 0, y: 1, z: 0 });
    ok('m = Normal(Polygon((0, 0, 0), (1, 0, 0), (0, 1, 0)))');
    close(val('m'), { x: 0, y: 0, z: 1 });
  });
});

describe('measures (R1.3)', () => {
  it('Distance between points, to lines, to planes, between lines and between planes', () => {
    ok('a = Distance((1, 2, 3), (4, 6, 3))');
    expect(val('a')).toBe(5);
    ok('b = Distance((0, 3, 0), Line((0, 0, 0), (0, 0, 1)))');
    expect(val('b')).toBeCloseTo(3, 12);
    ok('c = Distance((0, 0, 5), Segment((0, 0, 0), (0, 0, 1)))');
    expect(val('c')).toBeCloseTo(4, 12);
    ok('d = Distance((7, 1, 2), Plane((0, 0, 0), Vector(1, 0, 0)))');
    expect(val('d')).toBeCloseTo(7, 12);
    ok('dl = Distance(Line((0, 0, 0), (1, 0, 0)), Line((0, 0, 3), (0, 1, 3)))');
    expect(val('dl')).toBeCloseTo(3, 12);
    ok('g = Distance(Plane((0, 0, 1), Vector(0, 0, 1)), Plane((0, 0, 4), Vector(0, 0, -1)))');
    expect(val('g')).toBeCloseTo(3, 12);
    ok('h = Distance(Plane((0, 0, 1), Vector(0, 0, 1)), Plane((0, 0, 4), Vector(1, 0, 1)))');
    expect(val('h')).toBe(0);
    ok('i = Distance(Line((0, 0, 2), (1, 0, 2)), Plane((0, 0, 0), Vector(0, 0, 1)))');
    expect(val('i')).toBeCloseTo(2, 12);
  });

  it('Angle between vectors, at a vertex, between lines, a line and a plane, and two planes', () => {
    ok('a = Angle(Vector(1, 0, 0), Vector(0, 1, 0))');
    expect(val('a')).toBeCloseTo(Math.PI / 2, 12);
    ok('b = Angle((1, 0, 0), (0, 0, 0), (1, 1, 0))');
    expect(val('b')).toBeCloseTo(Math.PI / 4, 12);
    ok('c = Angle(Line((0, 0, 0), (1, 0, 0)), Line((0, 0, 0), (-1, 1, 0)))');
    expect(val('c')).toBeCloseTo(Math.PI / 4, 12);
    ok('d = Angle(Line((0, 0, 0), (1, 0, 1)), Plane((0, 0, 0), Vector(0, 0, 1)))');
    expect(val('d')).toBeCloseTo(Math.PI / 4, 12);
    ok('ap = Angle(Plane((0, 0, 0), Vector(0, 0, 1)), Plane((0, 0, 0), Vector(0, 1, 1)))');
    expect(val('ap')).toBeCloseTo(Math.PI / 4, 12);
  });

  it('Length of vectors and segments; Area of a flat polygon in any plane', () => {
    ok('a = Length(Vector(2, 3, 6))');
    expect(val('a')).toBe(7);
    ok('b = Length(Segment((0, 0, 0), (0, 3, 4)))');
    expect(val('b')).toBe(5);
    ok('c = Area(Polygon((0, 0, 0), (2, 0, 0), (2, 0, 3), (0, 0, 3)))');
    expect(val('c')).toBeCloseTo(6, 12);
    // far from the origin the area keeps its digits
    ok('d = Area(Polygon((1e6, 1e6, 1e6), (1e6 + 1, 1e6, 1e6), (1e6 + 1, 1e6 + 1, 1e6), (1e6, 1e6 + 1, 1e6)))');
    expect(val('d')).toBeCloseTo(1, 9);
  });
});

describe('intersections (R1.3, design 7)', () => {
  it('a line and a plane meet in a point; parallel and lying in the plane are undefined with reasons', () => {
    ok('X = Intersect(Line((0, 0, 0), (1, 1, 1)), Plane((0, 0, 2), Vector(0, 0, 1)))');
    close(val('X'), { x: 2, y: 2, z: 2 });
    ok('Y = Intersect(Plane((0, 0, 2), Vector(0, 0, 1)), Line((0, 0, 0), (1, 1, 1)))');
    close(val('Y'), { x: 2, y: 2, z: 2 });
    ok('P = Intersect(Line((0, 0, 1), (1, 0, 1)), Plane((0, 0, 0), Vector(0, 0, 1)))');
    expect(undef('P').reason).toBe('parallel');
    ok('Q = Intersect(Line((0, 0, 0), (1, 0, 0)), Plane((0, 0, 0), Vector(0, 0, 1)))');
    expect(undef('Q').reason).toBe('coincident');
  });

  it('a segment or ray that stops short of the plane gives no_intersection', () => {
    ok('S = Intersect(Segment((0, 0, 0), (0, 0, 1)), Plane((0, 0, 2), Vector(0, 0, 1)))');
    expect(undef('S').reason).toBe('no_intersection');
    ok('R = Intersect(Ray((0, 0, 0), (0, 0, -1)), Plane((0, 0, 2), Vector(0, 0, 1)))');
    expect(undef('R').reason).toBe('no_intersection');
    ok('T = Intersect(Ray((0, 0, 0), (0, 0, 1)), Plane((0, 0, 2), Vector(0, 0, 1)))');
    close(val('T'), { x: 0, y: 0, z: 2 });
  });

  it('two lines meet, are parallel, the same, or skew with the gap', () => {
    ok('A = Intersect(Line((0, 0, 0), (1, 0, 0)), Line((2, -1, 0), (2, 1, 0)))');
    close(val('A'), { x: 2, y: 0, z: 0 });
    ok('B = Intersect(Line((0, 0, 0), (1, 0, 0)), Line((0, 1, 0), (1, 1, 0)))');
    expect(undef('B').reason).toBe('parallel');
    ok('C = Intersect(Line((0, 0, 0), (1, 0, 0)), Line((3, 0, 0), (5, 0, 0)))');
    expect(undef('C').reason).toBe('coincident');
    ok('D = Intersect(Line((0, 0, 0), (1, 0, 0)), Line((0, 1, 1.5), (0, 2, 1.5)))');
    expect(undef('D')).toMatchObject({ reason: 'skew', detail: 'the lines are skew: they pass 1.5 apart' });
  });

  it('two planes meet in a line; parallel and same planes are undefined', () => {
    ok('l = Intersect(Plane((0, 0, 0), Vector(0, 0, 1)), Plane((0, 0, 0), Vector(1, 0, 0)))');
    const l = val('l') as { o: unknown; d: { x: number; y: number; z: number } };
    expect(f.get('l')?.type).toBe('Line3');
    close(l.o, { x: 0, y: 0, z: 0 });
    expect(Math.abs(l.d.y)).toBeCloseTo(1, 12);
    ok('m = Intersect(Plane((0, 0, 1), Vector(0, 0, 1)), Plane((0, 0, 3), Vector(0, 0, 2)))');
    expect(undef('m').reason).toBe('parallel');
    ok('n = Intersect(Plane((0, 0, 1), Vector(0, 0, 1)), Plane((5, 5, 1), Vector(0, 0, -1)))');
    expect(undef('n').reason).toBe('coincident');
  });

  it('the line of two planes lies on both', () => {
    ok('p = Plane((1, 0, 0), (0, 1, 0), (0, 0, 1))');
    ok('q = Plane((0, 0, 0), Vector(1, -1, 2))');
    ok('l = Intersect(p, q)');
    const l = val('l') as { o: { x: number; y: number; z: number }; d: { x: number; y: number; z: number } };
    for (const pl of [val('p'), val('q')] as { n: { x: number; y: number; z: number }; c: number }[]) {
      for (const t of [0, 3, -7]) {
        const x = { x: l.o.x + t * l.d.x, y: l.o.y + t * l.d.y, z: l.o.z + t * l.d.z };
        expect(pl.n.x * x.x + pl.n.y * x.y + pl.n.z * x.z - pl.c).toBeCloseTo(0, 12);
      }
    }
  });

  it('a line and a polygon meet inside, on the edge, or not at all', () => {
    ok('g = Polygon((0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 0))');
    ok('A = Intersect(Line((1, 1, -1), (1, 1, 1)), g)');
    close(val('A'), { x: 1, y: 1, z: 0 });
    ok('B = Intersect(Line((2, 1, -1), (2, 1, 1)), g)');
    close(val('B'), { x: 2, y: 1, z: 0 });
    ok('C = Intersect(Line((3, 1, -1), (3, 1, 1)), g)');
    expect(undef('C').reason).toBe('no_intersection');
  });
});

describe('mixed dimensions (R1.4, errors 3 S001)', () => {
  it('a flat point where a point in space is wanted is mixed_dimension, with the lifted line', () => {
    ok('A = (1, 2, 3)');
    ok('P = (1, 2)');
    const e = fail('s = Segment(P, A)');
    expect(e).toMatchObject({ kind: 'mixed_dimension', code: 'C120' });
    expect(e.message).toBe('Segment(P, A): P is a flat Point but A is a Point3 in space.');
    expect(e.hint).toMatch(/\(x, y, 0\)/);
    expect(e.suggest).toEqual(['s = Segment((P.x, P.y, 0), A)']);
    expect(f.apply(e.suggest[0] as string).ok).toBe(true);
  });

  it('a literal flat point is lifted with its numbers', () => {
    ok('A = (1, 2, 3)');
    expect(fail('d = Distance((4, 5), A)').suggest).toEqual(['d = Distance((4, 5, 0), A)']);
  });

  it('two flat points stay flat: no mixed_dimension', () => {
    ok('s = Segment((0, 0), (1, 1))');
    expect(f.get('s')?.type).toBe('Segment');
  });
});

describe('the table', () => {
  it('has no ambiguous or unknown forms with the 3D types', () => {
    const r = new CommandRegistry();
    geometry.registerGeometry(r);
    registerNumbers(r);
    registerFunctions(r);
    registerSpace(r);
    // other areas have known overlaps of their own; none may involve a 3D form
    const mine = r.problems({ types: space.SPACE_TYPES }).filter((p) => /Point3|Vector3|Line3|Segment3|Ray3|Plane|Polygon3|LineLike3/.test(p.a + p.b + p.message));
    expect(mine).toEqual([]);
  });
});
