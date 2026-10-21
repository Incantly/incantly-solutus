import { rotate, toLocal, toWorld, unrotate, type Frame, type PolygonShape, type Shape, type V2 } from './geometry';

/**
 * Narrow-phase collision: contact manifolds between circles and convex
 * polygons, in the form Box2D uses (a reference face or circle centre, and
 * contact points in the other body's frame), so the same contact can be
 * re-measured cheaply while positions are corrected and matched across steps
 * for warm starting.
 */

/** Penetration the solver allows, so resting contacts stay touching instead of chattering. */
export const LINEAR_SLOP = 0.005;
/** Contacts start this far apart, so a body coming to rest keeps its contact. */
export const CONTACT_MARGIN = LINEAR_SLOP;

export type ManifoldType = 'circles' | 'faceA' | 'faceB';

export interface ManifoldPoint {
  /** Circles: the centre of B. faceA: a point on B. faceB: a point on A. In that body's frame. */
  readonly local: V2;
  /** Which features touch, to match the point in the next step. */
  readonly id: number;
  normalImpulse: number;
  tangentImpulse: number;
}

export interface Manifold {
  readonly type: ManifoldType;
  /** The reference face's normal in its body's frame (unused for circles). */
  readonly localNormal: V2;
  /** circles: A's centre; faceA: on A's face; faceB: on B's face; in that body's frame. */
  readonly localPoint: V2;
  readonly points: ManifoldPoint[];
}

const id = (indexA: number, indexB: number, typeA: number, typeB: number): number => indexA | (indexB << 8) | (typeA << 16) | (typeB << 24);
const VERTEX = 0;
const FACE = 1;

function circles(a: Frame, ra: number, b: Frame, rb: number): Manifold | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const r = ra + rb + CONTACT_MARGIN;
  if (dx * dx + dy * dy > r * r) return null;
  return { type: 'circles', localNormal: [0, 0], localPoint: [0, 0], points: [{ local: [0, 0], id: 0, normalImpulse: 0, tangentImpulse: 0 }] };
}

function polygonCircle(poly: PolygonShape, a: Frame, r: number, b: Frame): Manifold | null {
  const [cx, cy] = toLocal(a, b.x, b.y);
  const radius = r + CONTACT_MARGIN;
  let normalIndex = 0;
  let separation = -Infinity;
  const { verts, norms } = poly;
  for (let i = 0; i < verts.length; i++) {
    const s = norms[i]![0] * (cx - verts[i]![0]) + norms[i]![1] * (cy - verts[i]![1]);
    if (s > radius) return null;
    if (s > separation) {
      separation = s;
      normalIndex = i;
    }
  }
  const v1 = verts[normalIndex]!;
  const v2 = verts[(normalIndex + 1) % verts.length]!;
  const point = (): ManifoldPoint => ({ local: [0, 0], id: 0, normalImpulse: 0, tangentImpulse: 0 });
  if (separation < 1e-9) {
    // The centre is inside the polygon.
    return { type: 'faceA', localNormal: norms[normalIndex]!, localPoint: [(v1[0] + v2[0]) / 2, (v1[1] + v2[1]) / 2], points: [point()] };
  }
  const u1 = (cx - v1[0]) * (v2[0] - v1[0]) + (cy - v1[1]) * (v2[1] - v1[1]);
  const u2 = (cx - v2[0]) * (v1[0] - v2[0]) + (cy - v2[1]) * (v1[1] - v2[1]);
  if (u1 <= 0 || u2 <= 0) {
    // Nearest to a corner.
    const v = u1 <= 0 ? v1 : v2;
    const dx = cx - v[0];
    const dy = cy - v[1];
    const d = Math.hypot(dx, dy);
    if (d > radius) return null;
    const n: V2 = d > 1e-12 ? [dx / d, dy / d] : norms[normalIndex]!;
    return { type: 'faceA', localNormal: n, localPoint: v, points: [point()] };
  }
  const fx = (v1[0] + v2[0]) / 2;
  const fy = (v1[1] + v2[1]) / 2;
  const s = (cx - fx) * norms[normalIndex]![0] + (cy - fy) * norms[normalIndex]![1];
  if (s > radius) return null;
  return { type: 'faceA', localNormal: norms[normalIndex]!, localPoint: [fx, fy], points: [point()] };
}

/** The face of poly1 with the largest separation from poly2, and that separation. */
function maxSeparation(p1: PolygonShape, f1: Frame, p2: PolygonShape, f2: Frame): { edge: number; separation: number } {
  let best = 0;
  let max = -Infinity;
  for (let i = 0; i < p1.verts.length; i++) {
    // Face i of poly1 in poly2's frame.
    const nw = rotate(f1.q, p1.norms[i]![0], p1.norms[i]![1]);
    const [nx, ny] = unrotate(f2.q, nw[0], nw[1]);
    const vw = toWorld(f1, p1.verts[i]![0], p1.verts[i]![1]);
    const [vx, vy] = toLocal(f2, vw[0], vw[1]);
    let si = Infinity;
    for (const v of p2.verts) {
      const s = nx * (v[0] - vx) + ny * (v[1] - vy);
      if (s < si) si = s;
    }
    if (si > max) {
      max = si;
      best = i;
    }
  }
  return { edge: best, separation: max };
}

interface ClipVertex {
  v: V2;
  id: number;
}

function incidentEdge(p1: PolygonShape, f1: Frame, edge1: number, p2: PolygonShape, f2: Frame): [ClipVertex, ClipVertex] {
  const nw = rotate(f1.q, p1.norms[edge1]![0], p1.norms[edge1]![1]);
  const [nx, ny] = unrotate(f2.q, nw[0], nw[1]);
  let index = 0;
  let min = Infinity;
  for (let i = 0; i < p2.norms.length; i++) {
    const dot = nx * p2.norms[i]![0] + ny * p2.norms[i]![1];
    if (dot < min) {
      min = dot;
      index = i;
    }
  }
  const i2 = (index + 1) % p2.verts.length;
  return [
    { v: toWorld(f2, p2.verts[index]![0], p2.verts[index]![1]), id: id(edge1, index, FACE, VERTEX) },
    { v: toWorld(f2, p2.verts[i2]![0], p2.verts[i2]![1]), id: id(edge1, i2, FACE, VERTEX) },
  ];
}

function clipSegment(input: readonly ClipVertex[], nx: number, ny: number, offset: number, vertexIndexA: number): ClipVertex[] {
  const out: ClipVertex[] = [];
  const [a, b] = input as [ClipVertex, ClipVertex];
  const d0 = nx * a.v[0] + ny * a.v[1] - offset;
  const d1 = nx * b.v[0] + ny * b.v[1] - offset;
  if (d0 <= 0) out.push(a);
  if (d1 <= 0) out.push(b);
  if (d0 * d1 < 0) {
    const k = d0 / (d0 - d1);
    const indexB = (a.id >> 8) & 0xff;
    out.push({ v: [a.v[0] + k * (b.v[0] - a.v[0]), a.v[1] + k * (b.v[1] - a.v[1])], id: id(vertexIndexA, indexB, VERTEX, FACE) });
  }
  return out;
}

function polygons(pa: PolygonShape, fa: Frame, pb: PolygonShape, fb: Frame): Manifold | null {
  const a = maxSeparation(pa, fa, pb, fb);
  if (a.separation > CONTACT_MARGIN) return null;
  const b = maxSeparation(pb, fb, pa, fa);
  if (b.separation > CONTACT_MARGIN) return null;
  const flip = b.separation > a.separation + 0.1 * LINEAR_SLOP;
  const [p1, f1, p2, f2, edge1] = flip ? [pb, fb, pa, fa, b.edge] : [pa, fa, pb, fb, a.edge];
  const incident = incidentEdge(p1, f1, edge1, p2, f2);
  const iv1 = edge1;
  const iv2 = (edge1 + 1) % p1.verts.length;
  const v11l = p1.verts[iv1]!;
  const v12l = p1.verts[iv2]!;
  const tl = Math.hypot(v12l[0] - v11l[0], v12l[1] - v11l[1]);
  const localTangent: V2 = [(v12l[0] - v11l[0]) / tl, (v12l[1] - v11l[1]) / tl];
  const localNormal: V2 = [localTangent[1], -localTangent[0]];
  const planePoint: V2 = [(v11l[0] + v12l[0]) / 2, (v11l[1] + v12l[1]) / 2];
  const [tx, ty] = rotate(f1.q, localTangent[0], localTangent[1]);
  const nx = ty;
  const ny = -tx;
  const v11 = toWorld(f1, v11l[0], v11l[1]);
  const v12 = toWorld(f1, v12l[0], v12l[1]);
  const front = nx * v11[0] + ny * v11[1];
  const side1 = -(tx * v11[0] + ty * v11[1]) + CONTACT_MARGIN;
  const side2 = tx * v12[0] + ty * v12[1] + CONTACT_MARGIN;
  const clip1 = clipSegment(incident, -tx, -ty, side1, iv1);
  if (clip1.length < 2) return null;
  const clip2 = clipSegment(clip1, tx, ty, side2, iv2);
  if (clip2.length < 2) return null;
  const points: ManifoldPoint[] = [];
  for (const cv of clip2) {
    const separation = nx * cv.v[0] + ny * cv.v[1] - front;
    if (separation > CONTACT_MARGIN) continue;
    // Feature ids are kept from A's point of view, so a flipped pair still matches next step.
    const featureId = flip ? id((cv.id >> 8) & 0xff, cv.id & 0xff, (cv.id >> 24) & 0xff, (cv.id >> 16) & 0xff) : cv.id;
    points.push({ local: toLocal(f2, cv.v[0], cv.v[1]), id: featureId, normalImpulse: 0, tangentImpulse: 0 });
  }
  if (points.length === 0) return null;
  return { type: flip ? 'faceB' : 'faceA', localNormal, localPoint: planePoint, points };
}

/**
 * The contact manifold between two shapes, or null when they are apart.
 * Circle-against-polygon pairs must be passed polygon first; `collide`
 * reports whether it swapped them.
 */
export function collide(sa: Shape, fa: Frame, sb: Shape, fb: Frame): { manifold: Manifold; swapped: boolean } | null {
  if (sa.type === 'circle' && sb.type === 'circle') {
    const m = circles(fa, sa.r, fb, sb.r);
    return m ? { manifold: m, swapped: false } : null;
  }
  if (sa.type === 'poly' && sb.type === 'circle') {
    const m = polygonCircle(sa, fa, sb.r, fb);
    return m ? { manifold: m, swapped: false } : null;
  }
  if (sa.type === 'circle' && sb.type === 'poly') {
    const m = polygonCircle(sb, fb, sa.r, fa);
    return m ? { manifold: m, swapped: true } : null;
  }
  const m = polygons(sa as PolygonShape, fa, sb as PolygonShape, fb);
  return m ? { manifold: m, swapped: false } : null;
}

export interface WorldContact {
  /** From A to B. */
  readonly normal: V2;
  readonly points: V2[];
  readonly separations: number[];
}

/** Contact normal, points and separations in world coordinates. */
export function worldManifold(m: Manifold, fa: Frame, ra: number, fb: Frame, rb: number): WorldContact {
  const points: V2[] = [];
  const separations: number[] = [];
  if (m.type === 'circles') {
    const pa = toWorld(fa, m.localPoint[0], m.localPoint[1]);
    const pb = toWorld(fb, m.points[0]!.local[0], m.points[0]!.local[1]);
    let nx = 1;
    let ny = 0;
    const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (d > 1e-12) {
      nx = (pb[0] - pa[0]) / d;
      ny = (pb[1] - pa[1]) / d;
    }
    const ca: V2 = [pa[0] + ra * nx, pa[1] + ra * ny];
    const cb: V2 = [pb[0] - rb * nx, pb[1] - rb * ny];
    points.push([(ca[0] + cb[0]) / 2, (ca[1] + cb[1]) / 2]);
    separations.push((cb[0] - ca[0]) * nx + (cb[1] - ca[1]) * ny);
    return { normal: [nx, ny], points, separations };
  }
  const [reference, other, rRef, rOther] = m.type === 'faceA' ? [fa, fb, ra, rb] : [fb, fa, rb, ra];
  const [nx, ny] = rotate(reference.q, m.localNormal[0], m.localNormal[1]);
  const plane = toWorld(reference, m.localPoint[0], m.localPoint[1]);
  for (const p of m.points) {
    const clipPoint = toWorld(other, p.local[0], p.local[1]);
    const toPlane = rRef - ((clipPoint[0] - plane[0]) * nx + (clipPoint[1] - plane[1]) * ny);
    const cRef: V2 = [clipPoint[0] + toPlane * nx, clipPoint[1] + toPlane * ny];
    const cOther: V2 = [clipPoint[0] - rOther * nx, clipPoint[1] - rOther * ny];
    points.push([(cRef[0] + cOther[0]) / 2, (cRef[1] + cOther[1]) / 2]);
    separations.push((cOther[0] - cRef[0]) * nx + (cOther[1] - cRef[1]) * ny);
  }
  return { normal: m.type === 'faceA' ? [nx, ny] : [-nx, -ny], points, separations };
}

/** One contact point re-measured at the current positions, for position correction. */
export function positionManifold(m: Manifold, fa: Frame, ra: number, fb: Frame, rb: number, index: number): { normal: V2; point: V2; separation: number } {
  if (m.type === 'circles') {
    const pa = toWorld(fa, m.localPoint[0], m.localPoint[1]);
    const pb = toWorld(fb, m.points[0]!.local[0], m.points[0]!.local[1]);
    const d = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const normal: V2 = d > 1e-12 ? [(pb[0] - pa[0]) / d, (pb[1] - pa[1]) / d] : [1, 0];
    return { normal, point: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], separation: d - ra - rb };
  }
  const [reference, other] = m.type === 'faceA' ? [fa, fb] : [fb, fa];
  const [nx, ny] = rotate(reference.q, m.localNormal[0], m.localNormal[1]);
  const plane = toWorld(reference, m.localPoint[0], m.localPoint[1]);
  const clipPoint = toWorld(other, m.points[index]!.local[0], m.points[index]!.local[1]);
  const separation = (clipPoint[0] - plane[0]) * nx + (clipPoint[1] - plane[1]) * ny - ra - rb;
  return { normal: m.type === 'faceA' ? [nx, ny] : [-nx, -ny], point: clipPoint, separation };
}

/** Whether two shapes overlap, for sensors. */
export function overlaps(sa: Shape, fa: Frame, sb: Shape, fb: Frame): boolean {
  const hit = collide(sa, fa, sb, fb);
  if (!hit) return false;
  const [s1, f1, s2, f2] = hit.swapped ? [sb, fb, sa, fa] : [sa, fa, sb, fb];
  const world = worldManifold(hit.manifold, f1, s1.type === 'circle' ? s1.r : 0, f2, s2.type === 'circle' ? s2.r : 0);
  return world.separations.some((s) => s < 0);
}

