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
  return { vertices, faces, edges, smooth, twoSided, radius };
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
