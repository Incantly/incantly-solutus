/** Solids, their measures and their meetings with lines and planes (.kiro/specs/space-3d R2; docs/features/space-3d design 6.1, 6.2, 7). */
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, registerFunctions, registerLists, registerNumbers, registerSpace, valueText } from '../../src/index';

let f: Figure;

beforeEach(() => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerLists(r);
  registerSpace(r);
  f = new Figure({ commands: r });
});

const ok = (...lines: string[]): void => {
  for (const line of lines) {
    const r = f.apply(line);
    if (!r.ok) throw new Error(`${line}: ${(r as { message: string }).message}`);
  }
};
const val = (name: string): unknown => {
  const o = f.get(name);
  if (!o || !o.cell.defined) throw new Error(`${name} is undefined: ${o && !o.cell.defined ? (o.cell as { reason: string }).reason : 'missing'}`);
  return o.cell.value;
};
const num = (name: string): number => val(name) as number;
const undef = (name: string): { reason: string; detail?: string } => {
  const o = f.get(name);
  if (!o || o.cell.defined) throw new Error(`${name} is defined`);
  return o.cell as unknown as { reason: string; detail?: string };
};
type P = { x: number; y: number; z: number };
const close = (a: unknown, b: P): void => {
  const p = a as P;
  expect(p.x).toBeCloseTo(b.x, 12);
  expect(p.y).toBeCloseTo(b.y, 12);
  expect(p.z).toBeCloseTo(b.z, 12);
};

describe('cubes, pyramids and prisms (R2.1, R2.2)', () => {
  beforeEach(() => ok('A = (0, 0, 0)', 'B = (2, 0, 0)', 'C = (0, 1, 0)', 'k = Cube(A, B, C)'));

  it('a cube on edge AB sits on the side of C, with 8 corners, 12 edges and 6 faces', () => {
    expect(f.get('k')?.type).toBe('Polyhedron');
    ok('V = Volume(k)', 'S = SurfaceArea(k)', 'h = Height(k)', 'vs = Vertices(k)', 'es = Edges(k)', 'fs = Faces(k)');
    expect(num('V')).toBeCloseTo(8, 12);
    expect(num('S')).toBeCloseTo(24, 12);
    expect(num('h')).toBeCloseTo(2, 12);
    expect((val('vs') as unknown[]).length).toBe(8);
    expect((val('es') as unknown[]).length).toBe(12);
    expect((val('fs') as unknown[]).length).toBe(6);
    expect(f.get('vs')?.typeText).toBe('List<Point3>');
    // on the side of C: every corner has y ≥ 0, and the far corner is (2, 2, 2)
    const vs = val('vs') as P[];
    expect(vs.every((p) => p.y >= -1e-12)).toBe(true);
    expect(vs.some((p) => Math.abs(p.x - 2) + Math.abs(p.y - 2) + Math.abs(p.z - 2) < 1e-12)).toBe(true);
    expect(valueText(val('k'))).toBe('cube, 6 faces, volume 8');
  });

  it('every face normal points out of the solid', () => {
    const k = val('k') as { verts: P[]; faces: { idx: number[]; normal: P }[] };
    const c = { x: 1, y: 1, z: 1 };
    for (const face of k.faces) {
      const q = k.verts[face.idx[0] as number] as P;
      expect((q.x - c.x) * face.normal.x + (q.y - c.y) * face.normal.y + (q.z - c.z) * face.normal.z).toBeGreaterThan(0);
    }
  });

  it('a pyramid is one third of the prism on the same base and height (agent lesson 5.2)', () => {
    ok('base = Polygon((0, 0, 0), (2, 0, 0), (2, 2, 0), (0, 2, 0))', 'py = Pyramid(base, 3)', 'pr = Prism(base, 3)', 'r = Volume(py) / Volume(pr)');
    expect(num('r')).toBeCloseTo(1 / 3, 12);
    ok('Vpy = Volume(py)', 'hp = Height(py)');
    expect(num('Vpy')).toBeCloseTo(4, 12);
    expect(num('hp')).toBeCloseTo(3, 12);
    // the apex is above the centre of area of the base
    ok('vs = Vertices(py)');
    close((val('vs') as P[])[4], { x: 1, y: 1, z: 3 });
  });

  it('a pyramid on an apex and a slanted prism on a top point', () => {
    ok('base = Polygon((0, 0, 0), (3, 0, 0), (0, 3, 0))', 'py = Pyramid(base, (1, 1, 2))', 'V = Volume(py)');
    expect(num('V')).toBeCloseTo((4.5 * 2) / 3, 12);
    ok('pr = Prism(base, (1, 1, 2))', 'W = Volume(pr)', 'h = Height(pr)');
    expect(num('W')).toBeCloseTo(4.5 * 2, 12);
    expect(num('h')).toBeCloseTo(2, 12);
    ok('fs = Faces(pr)');
    expect((val('fs') as unknown[]).length).toBe(5);
  });

  it('flat solids are degenerate (R2.4)', () => {
    ok('base = Polygon((0, 0, 0), (3, 0, 0), (0, 3, 0))', 'py = Pyramid(base, (1, 1, 0))', 'pr = Prism(base, 0)', 'pz = Pyramid(base, 0)');
    expect(undef('py')).toMatchObject({ reason: 'degenerate', detail: 'the apex is in the plane of the base, so the pyramid is flat' });
    expect(undef('pr').reason).toBe('degenerate');
    expect(undef('pz').reason).toBe('degenerate');
    ok('k2 = Cube(A, A, C)', 'k3 = Cube(A, B, (5, 0, 0))');
    expect(undef('k2').reason).toBe('degenerate');
    expect(undef('k3').detail).toMatch(/side point is on the line/);
  });

  it('the solid follows a dragged corner', () => {
    expect(f.setFree('B', { x: 3, y: 0, z: 0 }, 'drag').ok).toBe(true);
    f.flush();
    ok('V = Volume(k)');
    expect(num('V')).toBeCloseTo(27, 12);
  });
});

describe('the regular solids (R2.1)', () => {
  it('a tetrahedron and an octahedron of edge a have the volumes of the formulas', () => {
    ok('te = Tetrahedron((0, 0, 0), (2, 0, 0), (0, 1, 0))', 'Vt = Volume(te)', 'o = Octahedron((0, 0, 0), (2, 0, 0), (0, 1, 0))', 'Vo = Volume(o)', 'St = SurfaceArea(te)');
    expect(num('Vt')).toBeCloseTo(8 / (6 * Math.SQRT2), 12);
    expect(num('Vo')).toBeCloseTo((Math.SQRT2 / 3) * 8, 12);
    expect(num('St')).toBeCloseTo(Math.sqrt(3) * 4, 12);
    ok('es = Edges(te)', 'fo = Faces(o)');
    for (const s of val('es') as { a: P; b: P }[]) expect(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z)).toBeCloseTo(2, 12);
    expect((val('fo') as unknown[]).length).toBe(8);
  });

  it('an octahedron has no height', () => {
    ok('o = Octahedron((0, 0, 0), (2, 0, 0), (0, 1, 0))', 'h = Height(o)');
    expect(undef('h').reason).toBe('out_of_domain');
  });

  it('a unit cube far from the origin keeps its volume to 1e-12', () => {
    ok('k = Cube((1e6, 1e6, 1e6), (1e6 + 1, 1e6, 1e6), (1e6, 1e6 + 1, 1e6))', 'V = Volume(k)');
    expect(Math.abs(num('V') - 1)).toBeLessThan(1e-9);
  });
});

describe('spheres, cylinders and cones (R2.1, R2.2)', () => {
  it('measures of the formulas', () => {
    ok('s = Sphere((0, 0, 0), 2)', 'Vs = Volume(s)', 'Ss = SurfaceArea(s)', 'c = Cylinder((0, 0, 0), (0, 0, 3), 1)', 'Vc = Volume(c)', 'Sc = SurfaceArea(c)', 'hc = Height(c)');
    expect(num('Vs')).toBeCloseTo((4 / 3) * Math.PI * 8, 12);
    expect(num('Ss')).toBeCloseTo(16 * Math.PI, 12);
    expect(num('Vc')).toBeCloseTo(3 * Math.PI, 12);
    expect(num('Sc')).toBeCloseTo(2 * Math.PI * 4, 12);
    expect(num('hc')).toBeCloseTo(3, 12);
    ok('k = Cone((0, 0, 0), (0, 0, 4), 3)', 'Vk = Volume(k)', 'Sk = SurfaceArea(k)', 'rk = Radius(k)');
    expect(num('Vk')).toBeCloseTo(12 * Math.PI, 12);
    expect(num('Sk')).toBeCloseTo(Math.PI * 3 * (3 + 5), 12);
    expect(num('rk')).toBe(3);
    expect(valueText(val('s'))).toBe('sphere r=2 about (0, 0, 0)');
    expect(valueText(val('k'))).toBe('cone r=3 h=4');
  });

  it('a sphere through a point; its centre and radius', () => {
    ok('s = Sphere((1, 1, 1), (1, 1, 4))', 'r = Radius(s)', 'C = Center(s)');
    expect(num('r')).toBe(3);
    expect(val('C')).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('a zero radius or height is degenerate', () => {
    ok('s = Sphere((0, 0, 0), 0)', 'c = Cylinder((1, 1, 1), (1, 1, 1), 2)', 'k = Cone((0, 0, 0), (0, 0, 1), -1)');
    expect(undef('s').reason).toBe('degenerate');
    expect(undef('c').reason).toBe('degenerate');
    expect(undef('k').reason).toBe('degenerate');
  });

  it('a circle in space about an axis', () => {
    ok('c = Circle((0, 0, 1), 2, Vector(0, 0, 1))', 'a = Area(c)', 'r = Radius(c)');
    expect(num('a')).toBeCloseTo(4 * Math.PI, 12);
    expect(num('r')).toBe(2);
  });
});

describe('sections and meetings (R2.3, design 7)', () => {
  beforeEach(() => ok('k = Cube((0, 0, 0), (2, 0, 0), (0, 1, 0))'));

  it('a plane parallel to a face cuts a square', () => {
    ok('p = Plane((0, 0, 1), Vector(0, 0, 1))', 'cut = Intersect(p, k)', 'a = Area(cut)');
    expect(f.get('cut')?.type).toBe('Polygon3');
    expect((val('cut') as { pts: unknown[] }).pts.length).toBe(4);
    expect(num('a')).toBeCloseTo(4, 12);
    ok('cut2 = Intersect(k, p)', 'a2 = Area(cut2)');
    expect(num('a2')).toBeCloseTo(4, 12);
  });

  it('the plane through the centre square to a diagonal cuts a regular hexagon', () => {
    ok('p = Plane((1, 1, 1), Vector(1, 1, 1))', 'cut = Intersect(p, k)', 'a = Area(cut)');
    expect((val('cut') as { pts: unknown[] }).pts.length).toBe(6);
    expect(num('a')).toBeCloseTo(3 * Math.sqrt(3), 12);
  });

  it('a plane through a face gives the face; one through a corner only is degenerate; one past the cube misses', () => {
    ok('p = Plane((0, 0, 0), Vector(0, 0, 1))', 'cut = Intersect(p, k)', 'a = Area(cut)');
    expect(num('a')).toBeCloseTo(4, 12);
    ok('q = Plane((0, 0, 0), Vector(1, 1, 1))', 'c = Intersect(q, k)');
    expect(undef('c')).toMatchObject({ reason: 'degenerate', detail: 'the plane only touches a corner of the solid' });
    ok('m = Plane((0, 0, 5), Vector(0, 0, 1))', 'n = Intersect(m, k)');
    expect(undef('n')).toMatchObject({ reason: 'no_intersection', detail: 'the plane misses the solid by 3' });
  });

  it('a plane cuts a sphere in a circle; touching gives radius 0; missing says by how much', () => {
    ok('s = Sphere((0, 0, 0), 2)', 'c = Intersect(Plane((0, 0, 1), Vector(0, 0, 1)), s)', 'r = Radius(c)', 'C = Center(c)');
    expect(f.get('c')?.type).toBe('Circle3');
    expect(num('r')).toBeCloseTo(Math.sqrt(3), 12);
    close(val('C'), { x: 0, y: 0, z: 1 });
    ok('tc = Intersect(s, Plane((0, 0, 2), Vector(0, 0, 1)))', 'rt = Radius(tc)');
    expect(num('rt')).toBe(0);
    ok('u = Intersect(Plane((0, 0, 3.5), Vector(0, 0, 1)), s)');
    expect(undef('u')).toMatchObject({ reason: 'no_intersection', detail: 'the plane misses the sphere by 1.5' });
  });

  it('a line meets a sphere in two points in order; a tangent gives two equal points', () => {
    ok('s = Sphere((0, 0, 0), 2)', 'L = Intersect(Line((5, 0, 0), (-5, 0, 0)), s)');
    const L = val('L') as P[];
    close(L[0], { x: 2, y: 0, z: 0 });
    close(L[1], { x: -2, y: 0, z: 0 });
    ok('T = Intersect(Line((0, 2, 0), (1, 2, 0)), s)');
    const T = val('T') as P[];
    close(T[0], { x: 0, y: 2, z: 0 });
    close(T[1], { x: 0, y: 2, z: 0 });
    ok('P2 = Intersect(Line((5, 0, 0), (-5, 0, 0)), s, 2)');
    close(val('P2'), { x: -2, y: 0, z: 0 });
    ok('M = Intersect(Line((0, 3, 0), (1, 3, 0)), s)');
    expect(undef('M')).toMatchObject({ reason: 'no_intersection', detail: 'the line misses the sphere by 1' });
    ok('H = Intersect(Line((5, 0, 0), (-5, 0, 0)), s, 3)');
    expect(undef('H').reason).toBe('index_out_of_range');
  });

  it('a segment that ends inside a sphere has one slot left undefined', () => {
    ok('s = Sphere((0, 0, 0), 2)', 'L = Intersect(Segment((0, 0, 0), (5, 0, 0)), s)');
    const L = val('L') as (P | undefined)[];
    expect(L[0]).toBeUndefined();
    close(L[1], { x: 2, y: 0, z: 0 });
  });

  it('a line meets a solid in order along the line, a corner once', () => {
    ok('L = Intersect(Line((1, 1, -5), (1, 1, 5)), k)');
    const L = val('L') as P[];
    expect(L.length).toBe(2);
    close(L[0], { x: 1, y: 1, z: 0 });
    close(L[1], { x: 1, y: 1, z: 2 });
    ok('D = Intersect(Line((0, 0, 0), (2, 2, 2)), k)');
    expect((val('D') as P[]).length).toBe(2);
    ok('N = Intersect(Line((5, 5, -5), (5, 5, 5)), k)');
    expect(undef('N').reason).toBe('no_intersection');
  });
});
