/**
 * Solids (docs/features/space-3d/design.md 6.1, 6.2, 7; .kiro/specs/space-3d R2): pyramids, prisms, the regular solids
 * from an edge, spheres, cylinders and cones; their measures; and their meetings with lines and planes. Faces keep a
 * fixed order (base first, then the sides in the order of the base's edges, then the top), so `Faces(p)[1]` stays the
 * same face after a drag.
 */
import type { CommandRule, RuleCall } from '../../graph/registry';
import { formatNumber } from '../../language/runtime';
import type { LineLike } from './rules';
import { hitPlane, insidePolygon, lineLike, newell, plane3, sane, seg3, tolFor } from './rules';
import type { Circle3, Cone3, Cylinder3, Face, Plane3, Polygon3, Polyhedron, SolidKind, Sphere3 } from './types';
import { shape3Of } from './types';
import type { V3 } from './v3';
import { add, cross, dist, dot, frameOf, kahan, len, normalOf, scale, sizeOf, sub, toFrame, unit } from './v3';

const r = (run: (call: RuleCall) => unknown): CommandRule => ({ run });
const fmt = (x: number): string => formatNumber(Number(x.toPrecision(4)));
const V = (call: RuleCall, i: number): V3 => call.values[i] as V3;
const N = (call: RuleCall, i: number): number => call.values[i] as number;

/* ------------------------------ polyhedra ------------------------------ */

const centroid = (pts: readonly V3[]): V3 => scale(pts.reduce((s, p) => add(s, p), { x: 0, y: 0, z: 0 }), 1 / pts.length);

/** A convex solid from its vertices and face loops: normals point out, and the loops turn counter-clockwise outside. */
export function polyhedron(verts: readonly V3[], loops: readonly (readonly number[])[], kind: SolidKind, height?: number): Polyhedron {
  const c = centroid(verts);
  const faces: Face[] = loops.map((loop) => {
    const pts = loop.map((i) => verts[i] as V3);
    let n = unit(newell(pts)) ?? { x: 0, y: 0, z: 1 };
    let idx = [...loop];
    if (dot(n, sub(centroid(pts), c)) < 0) {
      idx = idx.reverse();
      n = scale(n, -1);
    }
    return { idx, normal: n };
  });
  return { shape3: 'Polyhedron', verts, faces, kind, closed: edgesPaired(faces), ...(height !== undefined ? { height } : {}) };
}

/** Every edge is used by exactly two faces, once in each direction. */
function edgesPaired(faces: readonly Face[]): boolean {
  const seen = new Map<string, number>();
  for (const f of faces) {
    for (let i = 0; i < f.idx.length; i++) {
      const a = f.idx[i] as number;
      const b = f.idx[(i + 1) % f.idx.length] as number;
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  for (const n of seen.values()) if (n !== 2) return false;
  return true;
}

/** The centre of area of a flat polygon (not the mean of its corners). */
export function areaCentroid(pts: readonly V3[]): V3 {
  const o = pts[0] as V3;
  const n = newell(pts);
  let w = 0;
  let s = { x: 0, y: 0, z: 0 };
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = pts[i] as V3;
    const b = pts[i + 1] as V3;
    const t = dot(cross(sub(a, o), sub(b, o)), n);
    w += t;
    s = add(s, scale(add(o, add(a, b)), t / 3));
  }
  return w === 0 ? centroid(pts) : scale(s, 1 / w);
}

const polyNormal = (g: Polygon3): V3 => normalOf(g.f);

function pyramidOf(call: RuleCall, base: Polygon3, apex: V3): unknown {
  const n = polyNormal(base);
  const h = dot(sub(apex, base.f.o), n);
  if (Math.abs(h) <= tolFor(call, sizeOf([...base.pts, apex]))) return call.fail('degenerate', 'the apex is in the plane of the base, so the pyramid is flat');
  const m = base.pts.length;
  const verts = [...base.pts, apex];
  const loops = [base.pts.map((_, i) => i), ...base.pts.map((_, i) => [i, (i + 1) % m, m])];
  return polyhedron(verts, loops, 'pyramid', Math.abs(h));
}

export const pyramidApex = r((call) => {
  const apex = V(call, 1);
  return sane(call, apex) ? pyramidOf(call, call.values[0] as Polygon3, apex) : undefined;
});
export const pyramidHeight = r((call) => {
  const base = call.values[0] as Polygon3;
  const h = N(call, 1);
  if (!Number.isFinite(h)) return call.fail('not_finite', 'the height is not a finite number');
  if (h === 0) return call.fail('degenerate', 'a pyramid of height 0 is flat');
  return pyramidOf(call, base, add(areaCentroid(base.pts), scale(polyNormal(base), h)));
});

function prismOf(call: RuleCall, base: Polygon3, shift: V3): unknown {
  const n = polyNormal(base);
  const h = dot(shift, n);
  if (Math.abs(h) <= tolFor(call, sizeOf(base.pts))) return call.fail('degenerate', 'the top is in the plane of the base, so the prism is flat');
  const m = base.pts.length;
  const verts = [...base.pts, ...base.pts.map((p) => add(p, shift))];
  const loops = [base.pts.map((_, i) => i), ...base.pts.map((_, i) => [i, (i + 1) % m, m + ((i + 1) % m), m + i]), base.pts.map((_, i) => m + i)];
  return polyhedron(verts, loops, 'prism', Math.abs(h));
}

export const prismTop = r((call) => {
  const base = call.values[0] as Polygon3;
  const top = V(call, 1);
  return sane(call, top) ? prismOf(call, base, sub(top, base.pts[0] as V3)) : undefined;
});
export const prismHeight = r((call) => {
  const base = call.values[0] as Polygon3;
  const h = N(call, 1);
  if (!Number.isFinite(h)) return call.fail('not_finite', 'the height is not a finite number');
  if (h === 0) return call.fail('degenerate', 'a prism of height 0 is flat');
  return prismOf(call, base, scale(polyNormal(base), h));
});

/** The frame of a regular solid on edge PQ, on the side of R: e1 along PQ, e2 towards R, e3 = e1 × e2 (design 6.1). */
function edgeFrame(call: RuleCall): { p: V3; a: number; e1: V3; e2: V3; e3: V3 } | undefined {
  const p = V(call, 0);
  const q = V(call, 1);
  const s = V(call, 2);
  if (!sane(call, p, q, s)) return undefined;
  const a = dist(p, q);
  const e1 = unit(sub(q, p));
  if (!e1 || a <= tolFor(call, sizeOf([p, q]))) {
    call.fail('degenerate', 'the two ends of the edge are the same point');
    return undefined;
  }
  const w = sub(s, p);
  const e2 = unit(sub(w, scale(e1, dot(w, e1))));
  if (!e2 || len(cross(e1, w)) <= Math.max(call.tol, 1e-12) * a * len(w)) {
    call.fail('degenerate', 'the side point is on the line of the edge, so it gives no side');
    return undefined;
  }
  return { p, a, e1, e2, e3: cross(e1, e2) };
}

const at = (f: { p: V3; a: number; e1: V3; e2: V3; e3: V3 }, i: number, j: number, k: number): V3 => add(f.p, add(scale(f.e1, i * f.a), add(scale(f.e2, j * f.a), scale(f.e3, k * f.a))));

export const cubeRule = r((call) => {
  const f = edgeFrame(call);
  if (!f) return undefined;
  const verts = [at(f, 0, 0, 0), at(f, 1, 0, 0), at(f, 1, 1, 0), at(f, 0, 1, 0), at(f, 0, 0, 1), at(f, 1, 0, 1), at(f, 1, 1, 1), at(f, 0, 1, 1)];
  const loops = [[0, 1, 2, 3], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]];
  return polyhedron(verts, loops, 'cube', f.a);
});

export const tetrahedronRule = r((call) => {
  const f = edgeFrame(call);
  if (!f) return undefined;
  const c = at(f, 0.5, Math.sqrt(3) / 2, 0);
  const g = at(f, 0.5, Math.sqrt(3) / 6, 0);
  const verts = [at(f, 0, 0, 0), at(f, 1, 0, 0), c, add(g, scale(f.e3, f.a * Math.sqrt(2 / 3)))];
  return polyhedron(verts, [[0, 1, 2], [0, 1, 3], [1, 2, 3], [2, 0, 3]], 'tetrahedron', f.a * Math.sqrt(2 / 3));
});

export const octahedronRule = r((call) => {
  const f = edgeFrame(call);
  if (!f) return undefined;
  // the edge is one side of the middle square; the two tips are above and below its centre
  const c = at(f, 0.5, 0.5, 0);
  const h = f.a / Math.SQRT2;
  const verts = [at(f, 0, 0, 0), at(f, 1, 0, 0), at(f, 1, 1, 0), at(f, 0, 1, 0), add(c, scale(f.e3, h)), add(c, scale(f.e3, -h))];
  const loops = [[0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4], [1, 0, 5], [2, 1, 5], [3, 2, 5], [0, 3, 5]];
  return polyhedron(verts, loops, 'octahedron');
});

/* ------------------------------ round solids ------------------------------ */

export const sphereRadius = r((call) => {
  const c = V(call, 0);
  const rad = N(call, 1);
  if (!sane(call, c) || !Number.isFinite(rad)) return call.fail('not_finite', 'the radius is not a finite number');
  if (!(rad > 0)) return call.fail('degenerate', 'a sphere needs a radius above 0');
  return { shape3: 'Sphere', c, r: rad } satisfies Sphere3;
});
export const sphereThrough = r((call) => {
  const c = V(call, 0);
  const q = V(call, 1);
  if (!sane(call, c, q)) return undefined;
  const rad = dist(c, q);
  return rad > 0 ? ({ shape3: 'Sphere', c, r: rad } satisfies Sphere3) : call.fail('degenerate', 'the point is the centre, so the radius is 0');
});

function roundSolid(call: RuleCall, kind: 'Cylinder' | 'Cone'): unknown {
  const a = V(call, 0);
  const b = V(call, 1);
  const rad = N(call, 2);
  if (!sane(call, a, b)) return undefined;
  if (!Number.isFinite(rad)) return call.fail('not_finite', 'the radius is not a finite number');
  if (!(rad > 0)) return call.fail('degenerate', `a ${kind.toLowerCase()} needs a radius above 0`);
  if (dist(a, b) <= tolFor(call, sizeOf([a, b]))) return call.fail('degenerate', `the ${kind === 'Cone' ? 'apex is the centre of the base' : 'two centres are the same point'}, so the height is 0`);
  return { shape3: kind, a, b, r: rad } satisfies Cylinder3 | Cone3;
}
export const cylinderRule = r((call) => roundSolid(call, 'Cylinder'));
export const coneRule = r((call) => roundSolid(call, 'Cone'));

export const circleAxis = r((call) => {
  const c = V(call, 0);
  const rad = N(call, 1);
  const n = unit(V(call, 2));
  if (!sane(call, c)) return undefined;
  if (!n) return call.fail('degenerate', 'the axis is the zero vector');
  if (!(rad >= 0) || !Number.isFinite(rad)) return call.fail('degenerate', 'a circle needs a radius of 0 or more');
  return { shape3: 'Circle3', f: frameOf(c, n), r: rad } satisfies Circle3;
});

/* ------------------------------ measures ------------------------------ */

/** Volume of a closed solid: the signed tetrahedra of each face fan about the centroid, Kahan-summed (design 6.1). */
export function polyVolume(p: Polyhedron): number {
  const c = centroid(p.verts);
  const parts: number[] = [];
  for (const f of p.faces) {
    const o = sub(p.verts[f.idx[0] as number] as V3, c);
    for (let i = 1; i + 1 < f.idx.length; i++) {
      const a = sub(p.verts[f.idx[i] as number] as V3, c);
      const b = sub(p.verts[f.idx[i + 1] as number] as V3, c);
      parts.push(dot(o, cross(a, b)) / 6);
    }
  }
  return Math.abs(kahan(parts));
}

export const polyArea = (p: Polyhedron): number => kahan(p.faces.map((f) => len(newell(f.idx.map((i) => p.verts[i] as V3))) / 2));

const heightOf = (s: Cylinder3 | Cone3): number => dist(s.a, s.b);

export const volumeRule = r((call) => {
  const v = call.values[0];
  switch (shape3Of(v)) {
    case 'Polyhedron': {
      const p = v as Polyhedron;
      return p.closed ? polyVolume(p) : call.fail('not_closed', 'an edge of the solid has only one face');
    }
    case 'Sphere':
      return (4 / 3) * Math.PI * (v as Sphere3).r ** 3;
    case 'Cylinder': {
      const s = v as Cylinder3;
      return Math.PI * s.r * s.r * heightOf(s);
    }
    case 'Cone': {
      const s = v as Cone3;
      return (Math.PI * s.r * s.r * heightOf(s)) / 3;
    }
    default:
      return call.fail('out_of_domain', 'this shape has no volume');
  }
});

export const surfaceAreaRule = r((call) => {
  const v = call.values[0];
  switch (shape3Of(v)) {
    case 'Polyhedron':
      return polyArea(v as Polyhedron);
    case 'Sphere':
      return 4 * Math.PI * (v as Sphere3).r ** 2;
    case 'Cylinder': {
      const s = v as Cylinder3;
      return 2 * Math.PI * s.r * (s.r + heightOf(s));
    }
    case 'Cone': {
      const s = v as Cone3;
      return Math.PI * s.r * (s.r + Math.hypot(s.r, heightOf(s)));
    }
    default:
      return call.fail('out_of_domain', 'this shape has no surface area');
  }
});

export const heightRule = r((call) => {
  const v = call.values[0];
  if (shape3Of(v) === 'Polyhedron') {
    const p = v as Polyhedron;
    return p.height !== undefined ? p.height : call.fail('out_of_domain', `a ${p.kind} has no height; pyramids, prisms and cubes do`);
  }
  return heightOf(v as Cylinder3 | Cone3);
});

export const radiusRule = r((call) => (call.values[0] as { r: number }).r);
export const centerRule = r((call) => {
  const v = call.values[0];
  return shape3Of(v) === 'Circle3' ? (v as Circle3).f.o : (v as Sphere3).c;
});
export const circleArea = r((call) => Math.PI * (call.values[0] as Circle3).r ** 2);
export const circleLength = r((call) => 2 * Math.PI * (call.values[0] as Circle3).r);

export const verticesRule = r((call) => [...(call.values[0] as Polyhedron).verts]);

/** The edges once each, in the order the faces first use them. */
export function edgesOf(p: Polyhedron): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const f of p.faces) {
    for (let i = 0; i < f.idx.length; i++) {
      const a = f.idx[i] as number;
      const b = f.idx[(i + 1) % f.idx.length] as number;
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([a, b]);
    }
  }
  return out;
}

export const edgesRule = r((call) => {
  const p = call.values[0] as Polyhedron;
  return edgesOf(p).map(([a, b]) => seg3(p.verts[a] as V3, p.verts[b] as V3));
});

export function faceOf(p: Polyhedron, f: Face): Polygon3 {
  const pts = f.idx.map((i) => p.verts[i] as V3);
  return { shape3: 'Polygon3', pts, f: frameOf(pts[0] as V3, f.normal, pts[1]) };
}

export const facesRule = r((call) => {
  const p = call.values[0] as Polyhedron;
  return p.faces.map((f) => faceOf(p, f));
});

/* ------------------------------ meetings with planes and lines (design 7) ------------------------------ */

/** The cross-section of a convex solid by a plane, as a flat polygon, or the reason there is none. */
export function sectionOf(p: Polyhedron, pl: Plane3, tol: number): Polygon3 | { reason: 'no_intersection' | 'degenerate'; detail: string } {
  const d = p.verts.map((v) => dot(pl.n, v) - pl.c);
  const pts: V3[] = [];
  const push = (q: V3): void => {
    if (!pts.some((x) => dist(x, q) <= tol)) pts.push(q);
  };
  p.verts.forEach((v, i) => {
    if (Math.abs(d[i] as number) <= tol) push(v);
  });
  for (const [a, b] of edgesOf(p)) {
    const da = d[a] as number;
    const db = d[b] as number;
    if ((da > tol && db < -tol) || (da < -tol && db > tol)) {
      const t = da / (da - db);
      const va = p.verts[a] as V3;
      push(add(va, scale(sub(p.verts[b] as V3, va), t)));
    }
  }
  if (pts.length === 0) {
    const gap = Math.min(...d.map(Math.abs));
    return { reason: 'no_intersection', detail: `the plane misses the solid by ${fmt(gap)}` };
  }
  if (pts.length < 3) return { reason: 'degenerate', detail: pts.length === 1 ? 'the plane only touches a corner of the solid' : 'the plane only touches an edge of the solid' };
  // a convex solid cuts in a convex polygon: order the points by angle about their centre
  const c = centroid(pts);
  const f = frameOf(c, pl.n);
  const ang = (q: V3): number => {
    const t = toFrame(f, q);
    return Math.atan2(t.t, t.s);
  };
  const ordered = [...pts].sort((x, y) => ang(x) - ang(y));
  return { shape3: 'Polygon3', pts: ordered, f: frameOf(ordered[0] as V3, pl.n, ordered[1]) };
}

export const intersectPlanePoly = r((call) => {
  const swap = shape3Of(call.values[0]) === 'Polyhedron';
  const p = call.values[swap ? 0 : 1] as Polyhedron;
  const pl = call.values[swap ? 1 : 0] as Plane3;
  const s = sectionOf(p, pl, tolFor(call, sizeOf(p.verts)));
  return 'reason' in s ? call.fail(s.reason, s.detail) : s;
});

export const intersectPlaneSphere = r((call) => {
  const swap = shape3Of(call.values[0]) === 'Sphere';
  const s = call.values[swap ? 0 : 1] as Sphere3;
  const pl = call.values[swap ? 1 : 0] as Plane3;
  const d = dot(pl.n, s.c) - pl.c;
  const tol = tolFor(call, sizeOf([s.c]) + s.r);
  if (Math.abs(d) > s.r + tol) return call.fail('no_intersection', `the plane misses the sphere by ${fmt(Math.abs(d) - s.r)}`);
  // touching gives a circle of radius 0, so the result stays a Circle3 (design 7)
  const rad = Math.abs(d) >= s.r ? 0 : Math.sqrt((s.r - Math.abs(d)) * (s.r + Math.abs(d)));
  return { shape3: 'Circle3', f: frameOf(sub(s.c, scale(pl.n, d)), pl.n), r: rad } satisfies Circle3;
});

/** Where a line-like value meets a sphere: two slots in order along the line; a tangent line gives two equal points. */
function sphereSlots(l: LineLike, s: Sphere3, tol: number): ({ p: V3 } | { reason: 'no_intersection'; detail: string })[] {
  const w = sub(l.o, s.c);
  const a = dot(l.d, l.d);
  const b = 2 * dot(l.d, w);
  const c = dot(w, w) - s.r * s.r;
  const disc = b * b - 4 * a * c;
  // the gap between the line and the sphere, for the detail
  const t0 = -b / (2 * a);
  const gap = dist(add(l.o, scale(l.d, t0)), s.c) - s.r;
  if (disc < 0 && gap > tol) {
    const miss = { reason: 'no_intersection' as const, detail: `the line misses the sphere by ${fmt(gap)}` };
    return [miss, miss];
  }
  const sq = Math.sqrt(Math.max(0, disc));
  // the stable form: q = -(b + sign(b) √disc) / 2, roots q / a and c / q
  const q = -(b + (b >= 0 ? sq : -sq)) / 2;
  const ts = q === 0 ? [t0, t0] : [q / a, c / q].sort((x, y) => x - y);
  return ts.map((t) =>
    t >= l.lo - 1e-9 && t <= l.hi + 1e-9 ? { p: add(l.o, scale(l.d, t)) } : { reason: 'no_intersection' as const, detail: 'the sphere is past the end of the segment or ray' },
  );
}

export const intersectLineSphere = r((call) => {
  const l = lineLike(call.values[0]) as LineLike;
  const s = call.values[1] as Sphere3;
  const slots = sphereSlots(l, s, tolFor(call, sizeOf([l.o, s.c]) + s.r));
  if (slots.every((x) => 'reason' in x)) {
    const first = slots[0] as { reason: 'no_intersection'; detail: string };
    return call.fail(first.reason, first.detail);
  }
  return slots.map((x) => ('p' in x ? x.p : undefined));
});

export const intersectLineSphereK = r((call) => {
  const l = lineLike(call.values[0]) as LineLike;
  const s = call.values[1] as Sphere3;
  const k = N(call, 2);
  if (k !== 1 && k !== 2) return call.fail('index_out_of_range', `a line meets a sphere at most twice; index ${k} is out of range`);
  const slot = sphereSlots(l, s, tolFor(call, sizeOf([l.o, s.c]) + s.r))[k - 1] as { p: V3 } | { reason: 'no_intersection'; detail: string };
  return 'p' in slot ? slot.p : call.fail(slot.reason, slot.detail);
});

export const intersectLinePoly = r((call) => {
  const l = lineLike(call.values[0]) as LineLike;
  const p = call.values[1] as Polyhedron;
  const tol = tolFor(call, sizeOf([l.o, ...p.verts]));
  const hits: { t: number; p: V3 }[] = [];
  for (const f of p.faces) {
    const g = faceOf(p, f);
    const h = hitPlane(l, plane3(g.f.o, f.normal), tol);
    if ('reason' in h || !insidePolygon(g, h.p, tol)) continue;
    // a hit on an edge or corner belongs to every face there: keep it once
    if (!hits.some((x) => dist(x.p, h.p) <= tol)) hits.push(h);
  }
  if (hits.length === 0) return call.fail('no_intersection', 'the line misses the solid');
  return hits.sort((a, b) => a.t - b.t).map((h) => h.p);
});
