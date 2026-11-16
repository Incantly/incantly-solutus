/**
 * Vectors and frames in space (docs/features/space-3d/design.md 5, 11). Pure: no DOM, no clock.
 */

export interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** An orthonormal frame of a plane: origin and two perpendicular unit axes. The normal is u × v. */
export interface Frame {
  readonly o: V3;
  readonly u: V3;
  readonly v: V3;
}

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const dist = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
/** a + t (b - a), written so t = 1 gives b exactly. */
export const lerp = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const mid = (a: V3, b: V3): V3 => ({ x: a.x + (b.x - a.x) / 2, y: a.y + (b.y - a.y) / 2, z: a.z + (b.z - a.z) / 2 });

/** The unit vector, or `undefined` for a zero or non-finite one. */
export function unit(a: V3): V3 | undefined {
  const l = len(a);
  if (!(l > 0) || !Number.isFinite(l)) return undefined;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

export const finite = (a: V3): boolean => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);

export function isV3(v: unknown): v is V3 {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { x?: unknown; y?: unknown; z?: unknown };
  return typeof o.x === 'number' && typeof o.y === 'number' && typeof o.z === 'number';
}

/** Any unit vector perpendicular to `n` (unit), chosen stably from the smallest component. */
export function perp(n: V3): V3 {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  const pick = ax <= ay && ax <= az ? v3(1, 0, 0) : ay <= az ? v3(0, 1, 0) : v3(0, 0, 1);
  return unit(cross(n, pick)) as V3;
}

/** A frame of the plane through `o` with unit normal `n`; `towards` (optional) sets the direction of u. */
export function frameOf(o: V3, n: V3, towards?: V3): Frame {
  let u = towards ? unit(sub(towards, scale(n, dot(towards, n)))) : undefined;
  u ??= perp(n);
  return { o, u, v: cross(n, u) };
}

export const normalOf = (f: Frame): V3 => cross(f.u, f.v);
/** A point of the frame's plane from its plane coordinates. */
export const fromFrame = (f: Frame, s: number, t: number): V3 => add(f.o, add(scale(f.u, s), scale(f.v, t)));
/** Plane coordinates of a point (its projection onto the plane). */
export const toFrame = (f: Frame, p: V3): { s: number; t: number } => {
  const d = sub(p, f.o);
  return { s: dot(d, f.u), t: dot(d, f.v) };
};

/** The 3×3 determinant of the rows a, b, c. */
export const det3 = (a: V3, b: V3, c: V3): number => dot(a, cross(b, c));

/** The size of a set of points (largest coordinate span), for scale-aware tolerances. */
export function sizeOf(pts: readonly V3[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p.x, p.y, p.z);
    hi = Math.max(hi, p.x, p.y, p.z);
  }
  return Math.max(1, hi - lo, ...pts.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))));
}

/** Rotates `p` about the axis through `o` with unit direction `d` by `a` radians (Rodrigues). */
export function rotateAbout(p: V3, o: V3, d: V3, a: number): V3 {
  const r = sub(p, o);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = dot(d, r) * (1 - c);
  return add(o, add(add(scale(r, c), scale(cross(d, r), s)), scale(d, k)));
}

/** Kahan sum, for volumes and areas that add many small parts. */
export function kahan(xs: readonly number[]): number {
  let s = 0;
  let c = 0;
  for (const x of xs) {
    const y = x - c;
    const t = s + y;
    c = t - s - y;
    s = t;
  }
  return s;
}
