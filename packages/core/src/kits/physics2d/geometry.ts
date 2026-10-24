import type { Vec2 } from '../../api/types';
import { SceneApiError } from '../../scene/errors';

/**
 * Small 2D maths for the physics kit: rotations, transforms and the shapes
 * bodies are made of. Shapes are stored around their centre of mass, so a
 * body's position is where it balances and turns.
 */

export type V2 = [number, number];

/** A rotation as its cosine and sine. */
export interface Rot {
  c: number;
  s: number;
}

/** A body's frame: its centre of mass and rotation. */
export interface Frame {
  x: number;
  y: number;
  q: Rot;
}

export const cross = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;

/** World point of a local point. */
export function toWorld(f: Frame, lx: number, ly: number): V2 {
  return [f.q.c * lx - f.q.s * ly + f.x, f.q.s * lx + f.q.c * ly + f.y];
}

/** Local point of a world point. */
export function toLocal(f: Frame, wx: number, wy: number): V2 {
  const dx = wx - f.x;
  const dy = wy - f.y;
  return [f.q.c * dx + f.q.s * dy, -f.q.s * dx + f.q.c * dy];
}

/** A local direction turned into the world. */
export function rotate(q: Rot, x: number, y: number): V2 {
  return [q.c * x - q.s * y, q.s * x + q.c * y];
}

/** A world direction turned into a frame. */
export function unrotate(q: Rot, x: number, y: number): V2 {
  return [q.c * x + q.s * y, -q.s * x + q.c * y];
}

export interface CircleShape {
  readonly type: 'circle';
  readonly r: number;
}

export interface PolygonShape {
  readonly type: 'poly';
  /** Corners around the centre of mass, counter-clockwise. */
  readonly verts: readonly V2[];
  /** Outward unit normal of the edge from corner i to corner i + 1. */
  readonly norms: readonly V2[];
}

export type Shape = CircleShape | PolygonShape;

export interface MassData {
  readonly area: number;
  /** Second moment of area about the centre, m⁴ per metre of depth. */
  readonly inertia: number;
  /** Where the given points' centre of mass is, before they are moved around it. */
  readonly centroid: V2;
}

/** Radius of a shape's collision rounding: circles are round, polygons sharp. */
export const radiusOf = (shape: Shape): number => (shape.type === 'circle' ? shape.r : 0);

/** The distance from the centre to the farthest point of the shape. */
export function extent(shape: Shape): number {
  if (shape.type === 'circle') return shape.r;
  let max = 0;
  for (const [x, y] of shape.verts) max = Math.max(max, Math.hypot(x, y));
  return max;
}

export function circle(r: number): CircleShape {
  return { type: 'circle', r };
}

/**
 * A convex polygon from points in any winding, moved so its centre of mass
 * is at the origin. Returns the shape and where that centre was.
 */
export function polygon(points: ReadonlyArray<Vec2>, call: string): { shape: PolygonShape; centroid: V2 } {
  if (!Array.isArray(points) || points.length < 3 || points.length > 16) {
    throw new SceneApiError(`${call} needs from 3 to 16 corner points [x, y], in metres`);
  }
  const pts: V2[] = points.map((p) => {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new SceneApiError(`${call} needs corner points as [x, y] pairs of finite numbers`);
    }
    return [p[0], p[1]];
  });
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i]!;
    const [bx, by] = pts[(i + 1) % pts.length]!;
    area += cross(ax, ay, bx, by) / 2;
  }
  if (Math.abs(area) < 1e-6) throw new SceneApiError(`${call} has no area: its corners lie on one line`);
  if (area < 0) pts.reverse();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const c = pts[(i + 2) % pts.length]!;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) throw new SceneApiError(`${call} has two corners in the same place`);
    if (cross(b[0] - a[0], b[1] - a[1], c[0] - b[0], c[1] - b[1]) < -1e-9) {
      throw new SceneApiError(`${call} must be convex: every corner must turn the same way. Build a concave shape from convex bodies joined by rods`);
    }
  }
  const mass = polygonMass(pts);
  const verts = pts.map(([x, y]) => [x - mass.centroid[0], y - mass.centroid[1]] as V2);
  return { shape: { type: 'poly', verts, norms: normals(verts) }, centroid: mass.centroid };
}

function normals(verts: readonly V2[]): V2[] {
  return verts.map(([ax, ay], i) => {
    const [bx, by] = verts[(i + 1) % verts.length]!;
    const length = Math.hypot(bx - ax, by - ay);
    return [(by - ay) / length, -(bx - ax) / length];
  });
}

/** Area, centroid and second moment of a counter-clockwise polygon. */
export function polygonMass(pts: readonly V2[]): MassData {
  // Triangles fanned from the first corner, for numerical accuracy far from the origin.
  const [ox, oy] = pts[0]!;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let inertia = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const ex1 = pts[i]![0] - ox;
    const ey1 = pts[i]![1] - oy;
    const ex2 = pts[i + 1]![0] - ox;
    const ey2 = pts[i + 1]![1] - oy;
    const d = cross(ex1, ey1, ex2, ey2);
    const triangle = d / 2;
    area += triangle;
    cx += (triangle * (ex1 + ex2)) / 3;
    cy += (triangle * (ey1 + ey2)) / 3;
    const intx2 = ex1 * ex1 + ex2 * ex1 + ex2 * ex2;
    const inty2 = ey1 * ey1 + ey2 * ey1 + ey2 * ey2;
    inertia += (0.25 / 3) * d * (intx2 + inty2);
  }
  cx /= area;
  cy /= area;
  // About the first corner, then moved to the centroid (parallel axis theorem).
  const about = inertia - area * (cx * cx + cy * cy);
  return { area, inertia: about, centroid: [cx + ox, cy + oy] };
}

export function massOf(shape: Shape): MassData {
  if (shape.type === 'circle') {
    const area = Math.PI * shape.r * shape.r;
    return { area, inertia: (area * shape.r * shape.r) / 2, centroid: [0, 0] };
  }
  const data = polygonMass(shape.verts);
  return { area: data.area, inertia: data.inertia, centroid: [0, 0] };
}

/** The shape's outline in world coordinates; circles become `sides`-gons. */
export function outline(shape: Shape, f: Frame, sides = 32): V2[] {
  if (shape.type === 'poly') return shape.verts.map(([x, y]) => toWorld(f, x, y));
  const out: V2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * 2 * Math.PI;
    out.push([f.x + shape.r * Math.cos(a), f.y + shape.r * Math.sin(a)]);
  }
  return out;
}

/** Keeps the part of a polygon where `inside` holds (Sutherland–Hodgman, one edge). */
export function clip(points: readonly V2[], inside: (p: V2) => number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const dp = inside(p);
    const dq = inside(q);
    if (dp >= 0) out.push(p);
    if ((dp >= 0) !== (dq >= 0)) {
      const k = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
    }
  }
  return out;
}

/** Area and centroid of a polygon in either winding; zero area for fewer than three points. */
export function areaAndCentroid(points: readonly V2[]): { area: number; x: number; y: number } {
  if (points.length < 3) return { area: 0, x: 0, y: 0 };
  let area = 0;
  let cx = 0;
  let cy = 0;
  const [ox, oy] = points[0]!;
  for (let i = 1; i < points.length - 1; i++) {
    const ax = points[i]![0] - ox;
    const ay = points[i]![1] - oy;
    const bx = points[i + 1]![0] - ox;
    const by = points[i + 1]![1] - oy;
    const triangle = cross(ax, ay, bx, by) / 2;
    area += triangle;
    cx += (triangle * (ax + bx)) / 3;
    cy += (triangle * (ay + by)) / 3;
  }
  if (Math.abs(area) < 1e-12) return { area: 0, x: ox, y: oy };
  return { area: Math.abs(area), x: cx / area + ox, y: cy / area + oy };
}
