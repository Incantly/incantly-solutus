/**
 * Bodies in space (docs/features/physics/design.md 2.4 and 7; .kiro/specs/physics R5): `Body` on spheres, boxes,
 * cubes, prisms, pyramids, cylinders, cones and convex polyhedra gives a `Body3`; solid space shapes and `Ground()` are
 * its walls. A body's value carries its start and its pose now, with its shape where it is, so the Space view draws it.
 */
import type {} from '../../contracts/values';
import type { V3 } from '../space/v3';
import type { Cone3, Cylinder3, Polyhedron, Sphere3 } from '../space/types';
import { shape3Of } from '../space/types';
import type { ShapeDef3 } from '../../physics/world3';
import { volumeOf3 } from '../../physics/world3';
import { cos, sin } from '../../physics/math';

declare module '../../contracts/values' {
  interface AreaTypeNames {
    Body3: true;
  }
}

/** Sides of a cylinder or cone for contacts (design 7). */
export const ROUND_SIDES = 24;

export interface BodySpec3 {
  readonly shapes: readonly ShapeDef3[];
  /** The solid as written, at the start: what is drawn, moved to the pose. */
  readonly solid: Polyhedron | Sphere3 | Cylinder3 | Cone3;
  readonly mass?: number;
  readonly density: number;
  readonly v: V3;
  readonly w: V3;
  readonly bounce: number;
  readonly friction: number;
  readonly fixed: boolean;
  readonly group: number;
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
  readonly massNow: number;
}

export interface Body3Value {
  readonly schema: 'Body3';
  readonly spec: BodySpec3;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Turn as a quaternion (w, x, y, z). */
  readonly q: readonly [number, number, number, number];
  readonly v: V3;
  readonly spin: V3;
  readonly asleep: boolean;
  readonly mass: number;
  readonly energy: number;
  readonly kinetic: number;
  readonly potential: number;
  readonly forces?: Float64Array;
  readonly touching: readonly string[];
  /** The solid where the body is now. */
  readonly now: Polyhedron | Sphere3 | Cylinder3 | Cone3;
}

export function isBody3Value(v: unknown): v is Body3Value {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Body3';
}

/** A cylinder or cone as a convex solid of `ROUND_SIDES` sides (base centre a, top b). */
function roundHull(a: V3, b: V3, r: number, cone: boolean): ShapeDef3 {
  const ax = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const l = Math.sqrt(ax.x * ax.x + ax.y * ax.y + ax.z * ax.z) || 1;
  const u = { x: ax.x / l, y: ax.y / l, z: ax.z / l };
  // two directions across the axis
  const t = Math.abs(u.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const e1 = norm(cross(u, t));
  const e2 = cross(u, e1);
  const n = ROUND_SIDES;
  const verts: V3[] = [];
  for (let k = 0; k < n; k++) {
    const th = (2 * Math.PI * k) / n;
    const c = cos(th) * r;
    const s = sin(th) * r;
    verts.push({ x: a.x + e1.x * c + e2.x * s, y: a.y + e1.y * c + e2.y * s, z: a.z + e1.z * c + e2.z * s });
  }
  const faces: number[][] = [];
  // the base, seen from outside (against the axis): clockwise round u
  faces.push(Array.from({ length: n }, (_, k) => n - 1 - k));
  if (cone) {
    verts.push(b);
    for (let k = 0; k < n; k++) faces.push([k, (k + 1) % n, n]);
  } else {
    for (let k = 0; k < n; k++) {
      const th = (2 * Math.PI * k) / n;
      verts.push({ x: b.x + e1.x * cos(th) * r + e2.x * sin(th) * r, y: b.y + e1.y * cos(th) * r + e2.y * sin(th) * r, z: b.z + e1.z * cos(th) * r + e2.z * sin(th) * r });
    }
    faces.push(Array.from({ length: n }, (_, k) => n + k));
    for (let k = 0; k < n; k++) faces.push([k, (k + 1) % n, n + ((k + 1) % n), n + k]);
  }
  return { kind: 'hull', verts, faces };
}

const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const norm = (a: V3): V3 => {
  const l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};

/** True when every corner is on the inner side of every face (or on it). */
export function isConvexHull(p: Polyhedron): boolean {
  for (const f of p.faces) {
    const o = p.verts[f.idx[0] as number] as V3;
    for (const v of p.verts) {
      if (f.normal.x * (v.x - o.x) + f.normal.y * (v.y - o.y) + f.normal.z * (v.z - o.z) > 1e-7) return false;
    }
  }
  return true;
}

export type Body3Shape = { readonly ok: true; readonly shapes: ShapeDef3[]; readonly solid: Polyhedron | Sphere3 | Cylinder3 | Cone3 } | { readonly ok: false; readonly why: 'not_convex' | 'no_volume'; readonly detail: string };

/** The shapes of a body in space. */
export function body3ShapeOf(v: unknown): Body3Shape {
  const k = shape3Of(v);
  if (k === 'Sphere') {
    const s = v as Sphere3;
    return s.r > 0 ? { ok: true, shapes: [{ kind: 'sphere', c: s.c, r: s.r }], solid: s } : { ok: false, why: 'no_volume', detail: 'a sphere of radius 0 has no volume' };
  }
  if (k === 'Cylinder' || k === 'Cone') {
    const s = v as Cylinder3;
    if (!(s.r > 0)) return { ok: false, why: 'no_volume', detail: 'it has no volume' };
    return { ok: true, shapes: [roundHull(s.a, s.b, s.r, k === 'Cone')], solid: s };
  }
  if (k === 'Polyhedron') {
    const p = v as Polyhedron;
    if (!p.closed) return { ok: false, why: 'no_volume', detail: 'it is not closed' };
    if (!isConvexHull(p)) return { ok: false, why: 'not_convex', detail: 'it has dents' };
    return { ok: true, shapes: [{ kind: 'hull', verts: p.verts, faces: p.faces.map((f) => f.idx) }], solid: p };
  }
  return { ok: false, why: 'no_volume', detail: 'it has no volume' };
}

/** A solid space shape as walls: hulls and spheres; planes are endless. */
export function solid3Of(v: unknown): ShapeDef3[] | undefined {
  const k = shape3Of(v);
  if (k === 'Plane') {
    const p = v as { n: V3; c: number };
    return [{ kind: 'plane', n: p.n, d: p.c }];
  }
  if (k === 'Polyhedron') {
    const p = v as Polyhedron;
    if (!p.closed) return undefined;
    return [{ kind: 'hull', verts: p.verts, faces: p.faces.map((f) => f.idx) }];
  }
  const b = body3ShapeOf(v);
  return b.ok ? b.shapes : undefined;
}

/**
 * Terrain from a solid function of two variables: a heightfield on an n × n grid over a rectangle (design 7). The
 * world tests only the cells under each shape, each triangle as a slab half a unit thick, so a 128 × 128 grid costs
 * no more a step than a small one.
 */
export function terrainOf(f: (x: number, y: number) => unknown, x0: number, x1: number, y0: number, y1: number, n: number): ShapeDef3[] {
  const h = new Float64Array((n + 1) * (n + 1));
  const dx = (x1 - x0) / n;
  const dy = (y1 - y0) / n;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const z = f(x0 + dx * i, y0 + dy * j);
      h[i * (n + 1) + j] = typeof z === 'number' && Number.isFinite(z) ? z : Number.NaN;
    }
  }
  return [{ kind: 'heightfield', x0, y0, dx, dy, nx: n, ny: n, h }];
}

/** The start of a body in space: its centre of mass and mass. */
export function startOf3(shapes: readonly ShapeDef3[], mass: number | undefined, density: number): { cx: number; cy: number; cz: number; massNow: number } {
  const m = volumeOf3(shapes);
  return { cx: m.cx, cy: m.cy, cz: m.cz, massNow: mass ?? density * m.vol };
}

/** Moves a solid by the turn q about the start centre c0 and then to the centre p. */
export function solidNow(s: Polyhedron | Sphere3 | Cylinder3 | Cone3, c0: V3, p: V3, q: readonly [number, number, number, number]): Polyhedron | Sphere3 | Cylinder3 | Cone3 {
  const [qw, qx, qy, qz] = q;
  const R = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy),
    2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx),
    2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy),
  ] as const;
  const mv = (v: V3): V3 => {
    const x = v.x - c0.x;
    const y = v.y - c0.y;
    const z = v.z - c0.z;
    return { x: p.x + R[0] * x + R[1] * y + R[2] * z, y: p.y + R[3] * x + R[4] * y + R[5] * z, z: p.z + R[6] * x + R[7] * y + R[8] * z };
  };
  const rot = (v: V3): V3 => ({ x: R[0] * v.x + R[1] * v.y + R[2] * v.z, y: R[3] * v.x + R[4] * v.y + R[5] * v.z, z: R[6] * v.x + R[7] * v.y + R[8] * v.z });
  if (s.shape3 === 'Sphere') return { ...s, c: mv(s.c) };
  if (s.shape3 === 'Cylinder' || s.shape3 === 'Cone') return { ...s, a: mv(s.a), b: mv(s.b) };
  return { ...s, verts: s.verts.map(mv), faces: s.faces.map((f) => ({ idx: f.idx, normal: rot(f.normal) })) };
}
