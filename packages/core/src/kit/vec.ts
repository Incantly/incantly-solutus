import type { Mat3, Vec2, Vec3, VectorHelpers } from '../api/types';
import { SceneApiError } from '../scene/errors';

/**
 * Vectors and 3x3 matrices (FM-9, C3-1): plain arrays in, new arrays out.
 * 2D vectors are [x, y]; 3D vectors [x, y, z]; matrices are nine numbers,
 * row by row.
 */

function list(v: unknown, call: string): readonly number[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > 3) throw new SceneApiError(`vec.${call} needs vectors of 2 or 3 numbers`);
  return v as readonly number[];
}

function pair(a: unknown, b: unknown, call: string): [readonly number[], readonly number[]] {
  const u = list(a, call);
  const w = list(b, call);
  if (u.length !== w.length) throw new SceneApiError(`vec.${call} needs two vectors of the same size`);
  return [u, w];
}

const add = (a: readonly number[], b: readonly number[]) => {
  const [u, w] = pair(a, b, 'add');
  return u.map((v, i) => v + w[i]!);
};
const sub = (a: readonly number[], b: readonly number[]) => {
  const [u, w] = pair(a, b, 'sub');
  return u.map((v, i) => v - w[i]!);
};
const scale = (a: readonly number[], k: number) => list(a, 'scale').map((v) => v * k);
const dot = (a: readonly number[], b: readonly number[]) => {
  const [u, w] = pair(a, b, 'dot');
  return u.reduce((sum, v, i) => sum + v * w[i]!, 0);
};
const length = (a: readonly number[]) => Math.hypot(...list(a, 'length'));
const normalize = (a: readonly number[]) => {
  const n = length(a);
  return n === 0 ? list(a, 'normalize').map(() => 0) : a.map((v) => v / n);
};
/** The 3D cross product; for 2D vectors, the z component of it. */
function cross(a: Vec3, b: Vec3): Vec3;
function cross(a: Vec2, b: Vec2): number;
function cross(a: readonly number[], b: readonly number[]): Vec3 | number {
  const [u, w] = pair(a, b, 'cross');
  if (u.length === 2) return u[0]! * w[1]! - u[1]! * w[0]!;
  return [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
}
/** Rotates a 2D vector by `radians`, counter-clockwise. */
const rotate = (a: Vec2, radians: number): Vec2 => {
  const [x, y] = list(a, 'rotate');
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [x! * c - y! * s, x! * s + y! * c];
};
/** The angle between two vectors in radians, from 0 to pi. */
const angle = (a: readonly number[], b: readonly number[]) => {
  const n = length(a) * length(b);
  return n === 0 ? 0 : Math.acos(Math.min(1, Math.max(-1, dot(a, b) / n)));
};
const lerp = (a: readonly number[], b: readonly number[], k: number) => {
  const [u, w] = pair(a, b, 'lerp');
  return u.map((v, i) => v + (w[i]! - v) * k);
};

/** A rotation by `radians` about `axis` (Rodrigues). */
export function rotA(axis: Vec3, radians: number): Mat3 {
  const [x, y, z] = normalize(list(axis, 'rotA')) as unknown as Vec3;
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 9 || b.length !== 9) throw new SceneApiError('vec.mul needs two 3x3 matrices of nine numbers');
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!);
  return out as unknown as Mat3;
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  if (!Array.isArray(m) || m.length !== 9) throw new SceneApiError('vec.apply needs a 3x3 matrix of nine numbers');
  const [x, y, z] = v;
  return [m[0]! * x + m[1]! * y + m[2]! * z, m[3]! * x + m[4]! * y + m[5]! * z, m[6]! * x + m[7]! * y + m[8]! * z];
}

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export const vectors: VectorHelpers = Object.freeze({
  add,
  sub,
  scale,
  dot,
  cross,
  length,
  normalize,
  rotate,
  angle,
  lerp,
  rotA,
  mul,
  apply,
});
