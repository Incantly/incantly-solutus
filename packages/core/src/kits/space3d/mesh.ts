import type { Mesh3DData, Vec3 } from '../../api/types';
import { SceneApiError } from '../../scene/errors';

/**
 * Solids as corner points and faces. Faces list corner indices
 * counter-clockwise seen from outside, so their normals point out and
 * back-face culling works from any camera (C3-3).
 */
export interface Mesh {
  readonly vertices: readonly Vec3[];
  readonly faces: readonly (readonly number[])[];
  /** Each edge once, for the wire look. */
  readonly edges: readonly (readonly [number, number])[];
  /** Round solids: facet seams are hidden. */
  readonly smooth: boolean;
  /** Flat sheets seen from both sides. */
  readonly twoSided: boolean;
  /** Distance from the centre to the farthest corner. */
  readonly radius: number;
  /**
   * Convex: every corner lies on or behind every face. Seen from anywhere,
   * its faces turned to the viewer never cover each other, and where one
   * turned away shows through, it is behind the one turned to the viewer.
   */
  readonly convex: boolean;
}

/** Corner-by-face checks above this, convexity goes unchecked: a mesh that large is drawn as not convex. */
const CONVEX_CHECKS = 200_000;

/** Whether every corner lies on or behind the plane of every face (Newell's normal, pointing out). */
function isConvexMesh(vertices: readonly Vec3[], faces: readonly (readonly number[])[], radius: number): boolean {
  if (faces.length * vertices.length > CONVEX_CHECKS) return false;
  const slack = 1e-7 * Math.max(radius, 1e-9);
  for (const face of faces) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < face.length; i++) {
      const a = vertices[face[i]!]!;
      const b = vertices[face[(i + 1) % face.length]!]!;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0] / face.length;
      cy += a[1] / face.length;
      cz += a[2] / face.length;
    }
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-12) continue;
    for (const v of vertices) if (((v[0] - cx) * nx + (v[1] - cy) * ny + (v[2] - cz) * nz) / length > slack) return false;
  }
  return true;
}

export const MAX_MESH_FACES = 2000;
const MAX_MESH_VERTICES = 4000;

function finish(vertices: Vec3[], faces: number[][], smooth: boolean, twoSided: boolean): Mesh {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const face of faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i]!;
      const b = face[(i + 1) % face.length]!;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([a, b]);
    }
  }
  const radius = vertices.reduce((r, v) => Math.max(r, Math.hypot(v[0], v[1], v[2])), 0);
  return { vertices, faces, edges, smooth, twoSided, radius, convex: isConvexMesh(vertices, faces, radius) };
}

function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new SceneApiError(`${name} must be a positive number`);
  return value;
}

export function segmentsOf(value: unknown, fallback = 24): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 3 || value > 96) {
    throw new SceneApiError('segments must be a whole number from 3 to 96');
  }
  return value;
}

export function boxMesh(sx: number, sy: number, sz: number): Mesh {
  positive(sx, 'box width');
  positive(sy, 'box depth');
  positive(sz, 'box height');
  const vertices: Vec3[] = [];
  for (let i = 0; i < 8; i++) vertices.push([(i & 1 ? 0.5 : -0.5) * sx, (i & 2 ? 0.5 : -0.5) * sy, (i & 4 ? 0.5 : -0.5) * sz]);
  const faces = [
    [4, 5, 7, 6], // top
    [0, 2, 3, 1], // bottom
    [1, 3, 7, 5], // +x
    [0, 4, 6, 2], // -x
    [2, 6, 7, 3], // +y
    [0, 1, 5, 4], // -y
  ];
  return finish(vertices, faces, false, false);
}

function ring(r: number, z: number, n: number): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    out.push([r * Math.cos(a), r * Math.sin(a), z]);
  }
  return out;
}

export function cylinderMesh(r: number, h: number, n: number): Mesh {
  positive(r, 'cylinder radius');
  positive(h, 'cylinder height');
  const vertices = [...ring(r, -h / 2, n), ...ring(r, h / 2, n)];
  const faces: number[][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, n + j, n + i]);
  }
  faces.push(Array.from({ length: n }, (_, i) => n + i));
  faces.push(Array.from({ length: n }, (_, i) => n - 1 - i));
  return finish(vertices, faces, true, false);
}

export function coneMesh(r: number, h: number, n: number): Mesh {
  positive(r, 'cone radius');
  positive(h, 'cone height');
  const vertices: Vec3[] = [...ring(r, -h / 2, n), [0, 0, h / 2]];
  const faces: number[][] = [];
  for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n]);
  faces.push(Array.from({ length: n }, (_, i) => n - 1 - i));
  return finish(vertices, faces, true, false);
}

export function planeMesh(w: number, d: number): Mesh {
  positive(w, 'plane width');
  positive(d, 'plane depth');
  const vertices: Vec3[] = [
    [-w / 2, -d / 2, 0],
    [w / 2, -d / 2, 0],
    [w / 2, d / 2, 0],
    [-w / 2, d / 2, 0],
  ];
  return finish(vertices, [[0, 1, 2, 3]], false, true);
}

export function torusMesh(R: number, r: number, n: number): Mesh {
  positive(R, 'torus radius');
  positive(r, 'torus tube radius');
  const m = Math.max(6, Math.round(n / 2));
  const vertices: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const u = (i / n) * 2 * Math.PI;
    for (let j = 0; j < m; j++) {
      const v = (j / m) * 2 * Math.PI;
      const w = R + r * Math.cos(v);
      vertices.push([w * Math.cos(u), w * Math.sin(u), r * Math.sin(v)]);
    }
  }
  const at = (i: number, j: number) => (i % n) * m + (j % m);
  const faces: number[][] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) faces.push([at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
  return finish(vertices, faces, true, false);
}

/** Twice the signed area of a closed outline: above 0 when it runs counter-clockwise. */
function shoelace(points: readonly (readonly [number, number])[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

const MAX_PROFILE = 120;

/**
 * A solid of revolution (S3-9): a profile of [r, z] points turned about z.
 * Points on the axis close the solid there; an end off the axis gets a flat
 * cap unless `open`. The profile may run either way, and a profile that ends
 * where it starts is a ring that never meets the axis.
 */
export function latheMesh(profile: unknown, n: number, open = false): Mesh {
  if (!Array.isArray(profile) || profile.length < 2 || profile.length > MAX_PROFILE) {
    throw new SceneApiError(`lathe needs from 2 to ${MAX_PROFILE} profile points [r, z]`);
  }
  let points = profile.map((p, i): [number, number] => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      throw new SceneApiError(`lathe profile point ${i} must be [r, z], two finite numbers`);
    }
    if (p[0] < 0) throw new SceneApiError(`lathe profile point ${i} has a negative radius; r is the distance from the axis`);
    return [p[0], p[1]];
  });
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const ring = points.length > 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-9;
  if (ring) points = points.slice(0, -1);
  else if (!open) {
    // Flat caps where an end is off the axis, so a profile of r(z) samples is a closed solid.
    if (first[0] > 1e-9) points.unshift([0, first[1]]);
    if (last[0] > 1e-9) points.push([0, last[1]]);
  }
  // Faces point out when the solid is on the left of the profile's direction: counter-clockwise in (r, z), closed along the axis.
  if (shoelace(points) < 0) points.reverse();
  const rings: number[][] = [];
  const vertices: Vec3[] = [];
  for (const [r, z] of points) {
    if (r <= 1e-9) {
      rings.push([vertices.length]);
      vertices.push([0, 0, z]);
      continue;
    }
    rings.push(Array.from({ length: n }, (_, i) => vertices.length + i));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      vertices.push([r * Math.cos(a), r * Math.sin(a), z]);
    }
  }
  const faces: number[][] = [];
  const bands = ring ? rings.length : rings.length - 1;
  for (let k = 0; k < bands; k++) {
    const a = rings[k]!;
    const b = rings[(k + 1) % rings.length]!;
    if (a.length === 1 && b.length === 1) continue;
    // A flat cap is one face, as on a cylinder; a point off the ring's height makes a cone of triangles.
    const flat = Math.abs(points[k]![1] - points[(k + 1) % points.length]![1]) < 1e-9;
    if (flat && a.length === 1) {
      faces.push([...b].reverse());
      continue;
    }
    if (flat && b.length === 1) {
      faces.push([...a]);
      continue;
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (a.length === 1) faces.push([a[0]!, b[j]!, b[i]!]);
      else if (b.length === 1) faces.push([a[i]!, a[j]!, b[0]!]);
      else faces.push([a[i]!, a[j]!, b[j]!, b[i]!]);
    }
  }
  if (faces.length === 0) throw new SceneApiError('A lathe profile needs at least one point off the axis');
  if (faces.length > MAX_MESH_FACES) throw new SceneApiError(`This lathe has ${faces.length} faces, more than ${MAX_MESH_FACES}; use fewer profile points or segments`);
  return finish(vertices, faces, true, open);
}

/** The three world axes, for the planes of an extrusion. */
const AXES: Readonly<Record<'x' | 'y' | 'z', Vec3>> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

/**
 * A flat outline pulled into a slab (S3-9): `outline` in the plane of two
 * axes ('xz' is x across and z up), `depth` along the third, centred on the
 * plane. The outline may be concave and run either way.
 */
export function extrudeData(outline: ReadonlyArray<readonly [number, number]>, depth: number, plane: 'xy' | 'xz' | 'yz'): Mesh3DData {
  const u = AXES[plane[0] as 'x' | 'y' | 'z'];
  const v = AXES[plane[1] as 'x' | 'y' | 'z'];
  // The side the outline faces when it runs counter-clockwise.
  const w: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const points = shoelace(outline) < 0 ? [...outline].reverse() : [...outline];
  const at = (p: readonly [number, number], s: number): Vec3 => [
    p[0] * u[0] + p[1] * v[0] + s * w[0],
    p[0] * u[1] + p[1] * v[1] + s * w[1],
    p[0] * u[2] + p[1] * v[2] + s * w[2],
  ];
  const n = points.length;
  const vertices = [...points.map((p) => at(p, -depth / 2)), ...points.map((p) => at(p, depth / 2))];
  const faces: number[][] = [Array.from({ length: n }, (_, i) => n + i), Array.from({ length: n }, (_, i) => n - 1 - i)];
  for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  return { vertices, faces };
}

/**
 * Outlines stacked into one solid (S3-9), such as a hull: each ring the
 * same number of [x, y] points at its height, from the lowest up, closed by
 * flat caps at both ends.
 */
export function loftData(rings: ReadonlyArray<{ readonly z: number; readonly points: ReadonlyArray<readonly [number, number]> }>): Mesh3DData {
  const n = rings[0]!.points.length;
  const turn = shoelace(rings[0]!.points) < 0;
  const vertices: Vec3[] = [];
  for (const ring of rings) {
    const points = turn ? [...ring.points].reverse() : ring.points;
    for (const [x, y] of points) vertices.push([x, y, ring.z]);
  }
  const top = (rings.length - 1) * n;
  const faces: number[][] = [Array.from({ length: n }, (_, i) => n - 1 - i), Array.from({ length: n }, (_, i) => top + i)];
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      faces.push([k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i]);
    }
  }
  return { vertices, faces };
}

export function customMesh(data: Mesh3DData): Mesh {
  if (typeof data !== 'object' || data === null || !Array.isArray(data.vertices) || !Array.isArray(data.faces)) {
    throw new SceneApiError('mesh needs { vertices: [[x, y, z], ...], faces: [[i, j, k], ...] }');
  }
  if (data.vertices.length < 3 || data.vertices.length > MAX_MESH_VERTICES) throw new SceneApiError(`A mesh has from 3 to ${MAX_MESH_VERTICES} vertices`);
  if (data.faces.length < 1 || data.faces.length > MAX_MESH_FACES) throw new SceneApiError(`A mesh has from 1 to ${MAX_MESH_FACES} faces`);
  const vertices = data.vertices.map((v, i): Vec3 => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new SceneApiError(`Mesh vertex ${i} must be three finite numbers`);
    }
    return [v[0], v[1], v[2]];
  });
  const faces = data.faces.map((face, i) => {
    if (!Array.isArray(face) || face.length < 3 || face.length > 64) throw new SceneApiError(`Mesh face ${i} needs from 3 to 64 corner indices`);
    return face.map((index) => {
      if (!Number.isInteger(index) || index < 0 || index >= vertices.length) throw new SceneApiError(`Mesh face ${i} names vertex ${String(index)}, which does not exist`);
      return index;
    });
  });
  return finish(vertices, faces, false, false);
}
