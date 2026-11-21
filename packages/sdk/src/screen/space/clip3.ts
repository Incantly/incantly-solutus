/**
 * The clip box (docs/features/space-3d/design.md 8.7; ui.md 8; .kiro/specs/space-3d-surfaces R2): faces cut against
 * the six planes of the box (Sutherland–Hodgman), line pieces cut to it (Liang–Barsky), points outside left out. Pure.
 */
import type { space } from '@incantly/kernel';

type V3 = space.V3;

export interface Box3 {
  readonly min: V3;
  readonly max: V3;
}

export const inBox = (b: Box3, p: V3, e = 1e-9): boolean =>
  p.x >= b.min.x - e && p.x <= b.max.x + e && p.y >= b.min.y - e && p.y <= b.max.y + e && p.z >= b.min.z - e && p.z <= b.max.z + e;

const AXES = ['x', 'y', 'z'] as const;

/** A flat convex face cut to the box, or `undefined` when nothing of it is inside. */
export function clipFace(pts: readonly V3[], b: Box3): V3[] | undefined {
  let poly: V3[] = [...pts];
  for (const k of AXES) {
    for (const side of [0, 1] as const) {
      if (poly.length === 0) return undefined;
      const lim = side === 0 ? b.min[k] : b.max[k];
      const inside = (p: V3): boolean => (side === 0 ? p[k] >= lim : p[k] <= lim);
      const out: V3[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i] as V3;
        const c = poly[(i + 1) % poly.length] as V3;
        const ia = inside(a);
        const ic = inside(c);
        if (ia) out.push(a);
        if (ia !== ic) {
          const t = (lim - a[k]) / (c[k] - a[k]);
          out.push({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t, z: a.z + (c.z - a.z) * t });
        }
      }
      poly = out;
    }
  }
  return poly.length >= 3 ? poly : undefined;
}

/** The part of the piece a→b inside the box, or `undefined`. */
export function clipSegment(a: V3, b: V3, box: Box3): [V3, V3] | undefined {
  let t0 = 0;
  let t1 = 1;
  for (const k of AXES) {
    const d = b[k] - a[k];
    for (const [lim, sign] of [[box.min[k], -1], [box.max[k], 1]] as const) {
      // sign·(a + t d − lim) ≤ 0 inside
      const p = sign * d;
      const q = sign * (lim - a[k]);
      if (Math.abs(p) < 1e-15) {
        if (q < 0) return undefined;
        continue;
      }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 > t1) return undefined;
    }
  }
  const at = (t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
  return [at(t0), at(t1)];
}

/** The 12 edges of the box. */
export function boxEdges(b: Box3): [V3, V3][] {
  const c = (i: number): V3 => ({ x: i & 1 ? b.max.x : b.min.x, y: i & 2 ? b.max.y : b.min.y, z: i & 4 ? b.max.z : b.min.z });
  const out: [V3, V3][] = [];
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) out.push([c(i), c(i | bit)]);
  return out;
}
