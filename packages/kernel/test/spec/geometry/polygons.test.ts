/**
 * Polygons, polylines, rigid polygons, polygon measures and boolean operations.
 * Docs: polygons-transforms/design.md 1.1, 3.1 to 3.4, 4.1 to 4.4, 5, 10; polygons-transforms/errors.md 3 to 6;
 * polygons-transforms/agent.md 2 and 5; points-lines/design.md 4.5.
 */
import { describe, expect, it, vi } from 'vitest';
import { bad, evalIn, fig, near, nearPt, num, ok, polyPts, shoelace, tryLine, undefIn, val, type V2 } from './helpers';

vi.setConfig({ testTimeout: 5000 });

const PI = Math.PI;
const TRI = ['A = (0, 0)', 'B = (4, 0)', 'C = (1, 3)', 'tri = Polygon(A, B, C)'];
const SQ = ['sq = Polygon((0, 0), (2, 0), (2, 2), (0, 2))'];
const nm = (base: string[], expr: string): number => evalIn<number>(base, expr);
const pts = (base: string[], expr: string): V2[] => evalIn<{ pts: V2[] }>(base, expr).pts;
const polys = (base: string[], expr: string): { pts: V2[] }[] => {
  const f = fig(base);
  ok(f.apply(`out = ${expr}`), expr);
  const c = f.cellOf('out')!;
  return c.defined ? (c.value as { pts: V2[] }[]) : [];
};
const area = (p: { pts: V2[] }): number => Math.abs(shoelace(p.pts));

describe('Polygon constructors', () => {
  it('Polygon(A, B, C) holds the vertices in order and is one object', () => {
    const f = fig(TRI);
    expect(polyPts(f, 'tri')).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 1, y: 3 }]);
    expect(f.objects().length).toBe(4);
    expect(f.get('tri')?.type).toBe('Polygon');
  });
  it('Polygon(A, B) is a too_few_points error that suggests Segment', () => {
    const e = bad(tryLine(TRI, 'p = Polygon(A, B)'), 'too_few_points');
    expect(e.hint ?? '').toMatch(/Segment/);
  });
  it('a list of two points is undefined at run time: too_few_points', () => expect(undefIn(TRI, 'Polygon([A, B])')).toBe('too_few_points'));
  it('the regular polygon by centre has its first vertex pointing up', () => {
    const v = pts([], 'Polygon((0, 0), 2, 4)');
    nearPt(v[0], 0, 2, 1e-12);
    nearPt(v[1], -2, 0, 1e-12);
    nearPt(v[2], 0, -2, 1e-12);
    nearPt(v[3], 2, 0, 1e-12);
  });
  it('a 1000-gon uses the direct angle for each vertex (no error build-up)', () => {
    const v = pts([], 'Polygon((0, 0), 1, 1000)');
    expect(v.length).toBe(1000);
    const k = 999;
    nearPt(v[k], Math.cos(PI / 2 + (2 * PI * k) / 1000), Math.sin(PI / 2 + (2 * PI * k) / 1000), 1e-13);
  });
  it('more than 1000 literal sides is a limit error', () => bad(tryLine([], 'p = Polygon((0, 0), 1, 1001)'), 'limit'));
  it('a literal side count of 2 is a bad_argument error naming the parameter', () => {
    const e = bad(tryLine([], 'p = Polygon((0, 0), 1, 2)'), 'bad_argument');
    expect(e.token).toBe('2');
  });
  it('a computed side count below 3 is undefined: too_few_sides', () => expect(undefIn(['n0 = 2'], 'Polygon((0, 0), 1, n0)')).toBe('too_few_sides'));
  it('a side count that is not whole is undefined: not_whole', () => expect(undefIn(['n0 = 5.37'], 'Polygon((0, 0), 1, n0)')).toBe('not_whole'));
  it('a side count within 1e-9 of a whole number is accepted', () => expect(pts(['n0 = 4.0000000001'], 'Polygon((0, 0), 1, n0)').length).toBe(4));
  it('the edge form goes counter-clockwise from P and vertex 1 is exactly Q', () => {
    const v = pts([], 'Polygon((0, 0), (2, 0), 4)');
    expect(v[1]).toEqual({ x: 2, y: 0 });
    nearPt(v[2], 2, 2, 1e-12);
    nearPt(v[3], 0, 2, 1e-12);
  });
  it('the edge form with P = Q is undefined: coincident_points', () => expect(undefIn([], 'Polygon((1, 1), (1, 1), 5)')).toBe('coincident_points'));
  it('a vector polygon lays the vectors head to tail from the start', () => {
    const v = pts([], 'Polygon((0, 0), Vector(2, 0), Vector(0, 3), Vector(-2, 0))');
    expect(v.length).toBe(4);
    nearPt(v[2], 2, 3);
    nearPt(v[3], 0, 3);
  });
  it('a Polyline is open and has the vertex count it was given', () => {
    const f = fig(['pl = Polyline((0, 0), (3, 0), (3, 4))', 'plen = Length(pl)']);
    near(num(f, 'plen'), 7);
    expect(f.get('pl')?.type).toBe('Polyline');
  });
});

describe('Vertex, Side, Vertices, Sides', () => {
  it('Vertex(poly, 3)', () => nearPt(evalIn(SQ, 'Vertex(sq, 3)'), 2, 2));
  it('Side(poly, 1) runs from vertex 1 to vertex 2', () => {
    const s = evalIn<{ a: V2; b: V2 }>(SQ, 'Side(sq, 1)');
    nearPt(s.a, 0, 0);
    nearPt(s.b, 2, 0);
  });
  it('Side(poly, n) wraps to vertex 1', () => {
    const s = evalIn<{ a: V2; b: V2 }>(SQ, 'Side(sq, 4)');
    nearPt(s.a, 0, 2);
    nearPt(s.b, 0, 0);
  });
  it('a literal vertex index 0 is a bad_argument error', () => bad(tryLine(SQ, 'P = Vertex(sq, 0)'), 'bad_argument'));
  it('a literal side index above n is a bad_argument error', () => bad(tryLine(TRI, 'P = Side(tri, 7)'), 'bad_argument'));
  it('a computed index out of range is undefined: index_out_of_range', () => expect(undefIn([...SQ, 'k0 = 9'], 'Vertex(sq, k0)')).toBe('index_out_of_range'));
  it('a computed index that is not whole is undefined: not_whole', () => expect(undefIn([...SQ, 'k0 = 2.5'], 'Vertex(sq, k0)')).toBe('not_whole'));
});

describe('measures', () => {
  it('Area of a triangle', () => near(nm(TRI, 'Area(tri)'), 6, 1e-14));
  it('SignedArea is positive counter-clockwise and negative clockwise', () => {
    near(nm(SQ, 'SignedArea(sq)'), 4);
    near(nm([], 'SignedArea(Polygon((0, 0), (0, 2), (2, 2), (2, 0)))'), -4);
  });
  it('Perimeter of the triangle is 4 + sqrt 18 + sqrt 10', () => near(nm(TRI, 'Perimeter(tri)'), 4 + Math.sqrt(18) + Math.sqrt(10), 1e-14));
  it('Area is accurate far from the origin (coordinates translated by the first vertex)', () => {
    near(nm([], 'Area(Polygon((1e6, 1e6), (1e6 + 1, 1e6), (1e6, 1e6 + 1)))'), 0.5, 1e-12);
  });
  it('the algebraic area of a self-crossing polygon is the absolute shoelace value (here 2)', () => {
    near(nm(['bt2 = Polygon((0, 0), (4, 0), (0, 2), (2, 2))'], 'Area(bt2)'), 2, 1e-12);
  });
  it('Length of a Polyline is its total length', () => near(nm(['pl = Polyline((0, 0), (3, 0), (3, 4))'], 'Length(pl)'), 7));
  it('Centroid of a triangle is the vertex mean', () => nearPt(evalIn(TRI, 'Centroid(tri)'), 5 / 3, 1, 1e-14));
  it('Centroid of a zero-area polygon is undefined: zero_area', () => expect(undefIn([], 'Centroid(Polygon((0, 0), (1, 1), (2, 2)))')).toBe('zero_area'));
  it('Convex ignores a repeated vertex (a zero turn)', () => expect(evalIn<boolean>([], 'Convex(Polygon((0, 0), (2, 0), (2, 0), (2, 2), (0, 2)))')).toBe(true));
  it('InteriorAngles of a triangle add up to pi', () => {
    const a = evalIn<number[]>(TRI, 'InteriorAngles(tri)');
    near(a.reduce((s, v) => s + v, 0), PI, 1e-14);
  });
  it('InteriorAngles of a square are all pi/2, clockwise or counter-clockwise', () => {
    for (const src of ['Polygon((0, 0), (2, 0), (2, 2), (0, 2))', 'Polygon((0, 0), (0, 2), (2, 2), (2, 0))']) {
      for (const a of evalIn<number[]>([], `InteriorAngles(${src})`)) near(a, PI / 2, 1e-14);
    }
  });
  it('InteriorAngles gives 3pi/2 at the reflex corner of an L-shape and the sum is (n - 2) pi', () => {
    const a = evalIn<number[]>([], 'InteriorAngles(Polygon((0, 0), (2, 0), (2, 1), (1, 1), (1, 2), (0, 2)))');
    near(a[3]!, (3 * PI) / 2, 1e-14);
    near(a.reduce((s, v) => s + v, 0), 4 * PI, 1e-13);
  });
});

describe('Rigid polygons', () => {
  it('Rigid(poly) starts exactly on top of the source', () => {
    const f = fig([...TRI, 'rg = Rigid(tri)']);
    const a = polyPts(f, 'rg');
    const b = polyPts(f, 'tri');
    a.forEach((p, i) => nearPt(p, b[i]!.x, b[i]!.y, 1e-12));
  });
  it('a rigid copy takes the new shape when the source is reshaped, and keeps its pose', () => {
    const f = fig([...TRI, 'rg = Rigid(tri, 3, 1)']);
    ok(f.apply('C = (1, 6)'));
    const v = polyPts(f, 'rg');
    nearPt(v[0], 3, 1, 1e-12);
    near(Math.hypot(v[2]!.x - v[0]!.x, v[2]!.y - v[0]!.y), Math.hypot(1, 6), 1e-12);
  });
  it('Rigid(A, B, C) no longer depends on the points after it is made', () => {
    const f = fig(['A = (0, 0)', 'B = (4, 0)', 'C = (1, 3)', 'rg = Rigid(A, B, C)']);
    const before = JSON.stringify(polyPts(f, 'rg'));
    ok(f.apply('A = (-5, -5)'));
    expect(JSON.stringify(polyPts(f, 'rg'))).toBe(before);
  });
  it('Rigid(A, B) with two points is an arg_count error (no form takes 2 arguments)', () => bad(tryLine(['A = (0, 0)', 'B = (1, 0)'], 'rg = Rigid(A, B)'), 'arg_count'));
});

describe('boolean operations', () => {
  const TWO = ['a0 = Polygon((0, 0), (3, 0), (3, 3), (0, 3))', 'b0 = Polygon((2, 2), (5, 2), (5, 5), (2, 5))'];
  it('IntersectPath of two overlapping squares is the 1 by 1 overlap', () => {
    const r = polys(TWO, 'IntersectPath(a0, b0)');
    expect(r.length).toBe(1);
    near(area(r[0]!), 1, 1e-12);
  });
  it('Union of two overlapping squares is one polygon of area 17', () => {
    const r = polys(TWO, 'Union(a0, b0)');
    expect(r.length).toBe(1);
    near(area(r[0]!), 17, 1e-12);
  });
  it('Difference of two overlapping squares is one polygon of area 8 (no hole)', () => {
    const r = polys(TWO, 'Difference(a0, b0)');
    expect(r.length).toBe(1);
    near(area(r[0]!), 8, 1e-12);
  });
  it('disjoint polygons: the intersection is the empty list, the union has both, the difference is the first', () => {
    const base = [...SQ, 'far = Polygon((10, 10), (12, 10), (12, 12), (10, 12))'];
    expect(polys(base, 'IntersectPath(sq, far)').length).toBe(0);
    expect(polys(base, 'Union(sq, far)').length).toBe(2);
    const d = polys(base, 'Difference(sq, far)');
    expect(d.length).toBe(1);
    near(area(d[0]!), 4, 1e-12);
  });
  it('containment: intersection is the inner polygon, union is the outer, inner minus outer is empty', () => {
    const base = ['big = Polygon((0, 0), (10, 0), (10, 10), (0, 10))', 'small = Polygon((2, 2), (4, 2), (4, 4), (2, 4))'];
    near(area(polys(base, 'IntersectPath(big, small)')[0]!), 4, 1e-12);
    near(area(polys(base, 'Union(big, small)')[0]!), 100, 1e-12);
    expect(polys(base, 'Difference(small, big)').length).toBe(0);
  });
  it('outer minus inner would have a hole: undefined has_hole', () => {
    expect(undefIn(['big = Polygon((0, 0), (10, 0), (10, 10), (0, 10))', 'small = Polygon((2, 2), (4, 2), (4, 4), (2, 4))'], 'Difference(big, small)')).toBe('has_hole');
  });
  it('results are counter-clockwise', () => {
    for (const p of polys(TWO, 'Union(a0, b0)')) expect(shoelace(p.pts)).toBeGreaterThan(0);
  });
  it('a result that falls in two pieces lists them in order of their lowest-left vertex', () => {
    const r = polys(['bar = Polygon((0, 0), (6, 0), (6, 2), (0, 2))', 'cut = Polygon((2, -1), (4, -1), (4, 3), (2, 3))'], 'Difference(bar, cut)');
    expect(r.length).toBe(2);
    near(Math.min(...r[0]!.pts.map((p) => p.x)), 0, 1e-12);
    near(Math.min(...r[1]!.pts.map((p) => p.x)), 4, 1e-12);
    near(area(r[0]!) + area(r[1]!), 8, 1e-12);
  });
  it('two squares sharing a whole edge join into one polygon of area 8 (a degenerate contact resolved)', () => {
    const r = polys(['s1 = Polygon((0, 0), (2, 0), (2, 2), (0, 2))', 's2 = Polygon((2, 0), (4, 0), (4, 2), (2, 2))'], 'Union(s1, s2)');
    expect(r.length).toBe(1);
    near(area(r[0]!), 8, 1e-6);
  });
  it('a triangle and a square that share one vertex still give a union (a degenerate contact resolved)', () => {
    const r = polys([...SQ, 'tr2 = Polygon((2, 2), (4, 2), (3, 4))'], 'Union(sq, tr2)');
    expect(r.length).toBeGreaterThan(0);
    near(r.reduce((s, p) => s + area(p), 0), 4 + 2, 1e-6);
  });
  it('a self-crossing input is undefined: not_simple', () => {
    expect(undefIn([...SQ, 'bow = Polygon((0, 0), (2, 2), (2, 0), (0, 2))'], 'Union(sq, bow)')).toBe('not_simple');
  });
  it('more than 256 input vertices is a limit', () => {
    const f = fig(['p1 = Polygon((0, 0), 5, 200)', 'p2 = Polygon((1, 0), 5, 200)']);
    const r = f.apply('u2 = Union(p1, p2)');
    if (r.ok) expect(f.cellOf('u2')!.defined === false && (f.cellOf('u2') as { reason: string }).reason).toBe('limit');
    else expect(r.kind).toBe('limit');
  });
  it('IntersectPath(line, polygon) is the chord inside the polygon', () => {
    const r = evalIn<{ a: V2; b: V2 }[]>(SQ, 'IntersectPath(Line((-1, 1), (3, 1)), sq)');
    expect(r.length).toBe(1);
    nearPt(r[0]!.a, 0, 1);
    nearPt(r[0]!.b, 2, 1);
  });
  it('IntersectPath(line, polygon) for a line that misses is an empty list, not undefined', () => {
    const f = fig([...SQ, 'ch = IntersectPath(Line((0, 5), (1, 5)), sq)']);
    expect(val(f, 'ch')).toEqual([]);
  });
  it('a line that only grazes a corner gives no chord', () => {
    const f = fig([...SQ, 'ch = IntersectPath(Line((-1, 1), (1, -1)), sq)']);
    const chords = val<{ a: V2; b: V2 }[]>(f, 'ch');
    expect(chords.every((c) => Math.hypot(c.a.x - c.b.x, c.a.y - c.b.y) < 1e-9)).toBe(true);
  });
});
