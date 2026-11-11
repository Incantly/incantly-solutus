/**
 * Analytic 3D picking on the CPU (space-3d design 9.4): no GPU readback, exact
 * parameters for dragging and snapping, and headless-testable. Meshes pick
 * through a BVH built on mesh update.
 */
import type { ObjId } from '@incantly/kernel';
import { v3Add, v3Cross, v3Dot, v3Len, v3Scale, v3Sub, type Ray, type V3 } from './camera';

export type PickKind = 'point' | 'path' | 'surface' | 'label' | 'gizmo';

export interface PickHit {
  readonly objId: ObjId;
  readonly kind: PickKind;
  /** Distance along the ray. */
  readonly t: number;
  readonly world: V3;
  readonly param?: { readonly s?: number; readonly u?: number; readonly v?: number };
  /** Pixels from the pointer, for points and paths. */
  readonly screenDist: number;
  /** True when the hit surface is transparent (ranks last). */
  readonly transparent: boolean;
}

export interface PickOpts {
  /** Screen-space tolerance for points and paths, in CSS px. */
  readonly tolerancePx: number;
  /** When false, transparent surfaces are skipped. */
  readonly includeTransparent: boolean;
}

/** Projector the host supplies (camera + canvas); null when behind the eye. */
export type Projector = (p: V3) => { x: number; y: number } | null;

/* ---------------- ray primitives ---------------- */

/** Ray-plane: `t = (c - n.o) / (n.d)`; null when parallel. */
export function rayPlane(o: V3, d: V3, n: V3, c: number): number | null {
  const denom = v3Dot(n, d);
  if (Math.abs(denom) <= 1e-12) return null;
  return (c - v3Dot(n, o)) / denom;
}

/**
 * Closest approach between ray `o + t d` and line `a + s e` (design 10.1).
 * Holds the last value when `1 - (d.e)^2 < 1e-6` (parallel): returns null.
 */
export function rayLineClosest(o: V3, d: V3, a: V3, e: V3): { t: number; s: number } | null {
  const de = v3Dot(d, e);
  if (1 - de * de < 1e-6) return null;
  const w = v3Sub(o, a);
  const dw = v3Dot(d, w);
  const ew = v3Dot(e, w);
  const denom = 1 - de * de;
  const t = (de * ew - dw) / denom;
  const s = (ew - de * dw) / denom;
  return { t, s };
}

/** Ray-sphere with the stable quadratic form `q = -(b + sign(b)disc)/2`. */
export function raySphere(o: V3, d: V3, c: V3, r: number): readonly [number, number] | null {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const a = v3Dot(d, d);
  const b = 2 * (d.x * ox + d.y * oy + d.z * oz);
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0 || a === 0) return null;
  const sq = Math.sqrt(disc);
  const q = -(b + Math.sign(b === 0 ? 1 : b) * sq) / 2;
  if (q === 0) return [0, 0];
  const t0 = q / a;
  const t1 = cc / q;
  return t0 <= t1 ? [t0, t1] : [t1, t0];
}

/** Ray-triangle (Moller-Trumbore); null on miss. `u/v` are barycentric. */
export function rayTriangle(o: V3, d: V3, a: V3, b: V3, c: V3): { t: number; u: number; v: number } | null {
  const e1 = v3Sub(b, a);
  const e2 = v3Sub(c, a);
  const p = v3Cross(d, e2);
  const det = v3Dot(e1, p);
  if (Math.abs(det) < 1e-15) return null;
  const inv = 1 / det;
  const tvec = v3Sub(o, a);
  const u = v3Dot(tvec, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = v3Cross(tvec, e1);
  const v = v3Dot(d, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = v3Dot(e2, q) * inv;
  return t >= 0 ? { t, u, v } : null;
}

/* ---------------- BVH over mesh triangles ---------------- */

export interface Bvh {
  readonly pos: Float32Array;
  readonly idx: Uint32Array;
  /** Flat nodes: [minX,minY,minZ,maxX,maxY,maxZ,left,right,triStart,triCount]. */
  readonly nodes: Float64Array;
  readonly order: Uint32Array;
  readonly nodeCount: number;
}

const BVH_LEAF = 8;

function triCentroid(pos: Float32Array, idx: Uint32Array, tri: number): V3 {
  const a = (idx[tri * 3] ?? 0) * 3;
  const b = (idx[tri * 3 + 1] ?? 0) * 3;
  const c = (idx[tri * 3 + 2] ?? 0) * 3;
  return {
    x: ((pos[a] ?? 0) + (pos[b] ?? 0) + (pos[c] ?? 0)) / 3,
    y: ((pos[a + 1] ?? 0) + (pos[b + 1] ?? 0) + (pos[c + 1] ?? 0)) / 3,
    z: ((pos[a + 2] ?? 0) + (pos[b + 2] ?? 0) + (pos[c + 2] ?? 0)) / 3,
  };
}

/** Median-split BVH build, O(n log n); runs off-thread for big meshes. */
export function buildBvh(pos: Float32Array, idx: Uint32Array): Bvh {
  const triCount = Math.floor(idx.length / 3);
  const order = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) order[i] = i;
  const nodes: number[] = [];
  const build = (start: number, count: number): number => {
    const nodeAt = nodes.length / 10;
    nodes.push(0, 0, 0, 0, 0, 0, -1, -1, start, count);
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i < count; i++) {
      const tri = order[start + i] ?? 0;
      for (let k = 0; k < 3; k++) {
        const v = ((idx[tri * 3 + k] ?? 0) * 3);
        const x = pos[v] ?? 0;
        const y = pos[v + 1] ?? 0;
        const z = pos[v + 2] ?? 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
    nodes[nodeAt * 10] = x0;
    nodes[nodeAt * 10 + 1] = y0;
    nodes[nodeAt * 10 + 2] = z0;
    nodes[nodeAt * 10 + 3] = x1;
    nodes[nodeAt * 10 + 4] = y1;
    nodes[nodeAt * 10 + 5] = z1;
    if (count <= BVH_LEAF) return nodeAt;
    const ex = x1 - x0;
    const ey = y1 - y0;
    const ez = z1 - z0;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const slice = [...order.slice(start, start + count)];
    slice.sort((a, b) => {
      const ca = triCentroid(pos, idx, a);
      const cb = triCentroid(pos, idx, b);
      const va = axis === 0 ? ca.x : axis === 1 ? ca.y : ca.z;
      const vb = axis === 0 ? cb.x : axis === 1 ? cb.y : cb.z;
      return va - vb;
    });
    for (let i = 0; i < slice.length; i++) order[start + i] = slice[i] ?? 0;
    const mid = Math.floor(count / 2);
    const left = build(start, mid);
    const right = build(start + mid, count - mid);
    nodes[nodeAt * 10 + 6] = left;
    nodes[nodeAt * 10 + 7] = right;
    return nodeAt;
  };
  if (triCount > 0) build(0, triCount);
  return { pos, idx, nodes: new Float64Array(nodes), order, nodeCount: nodes.length / 10 };
}

function rayBox(o: V3, d: V3, min: V3, max: V3): boolean {
  let t0 = 0;
  let t1 = Infinity;
  const oo = [o.x, o.y, o.z];
  const dd = [d.x, d.y, d.z];
  const mn = [min.x, min.y, min.z];
  const mx = [max.x, max.y, max.z];
  for (let i = 0; i < 3; i++) {
    const di = dd[i] ?? 0;
    if (Math.abs(di) < 1e-15) {
      if ((oo[i] ?? 0) < (mn[i] ?? 0) || (oo[i] ?? 0) > (mx[i] ?? 0)) return false;
    } else {
      let a = ((mn[i] ?? 0) - (oo[i] ?? 0)) / di;
      let b = ((mx[i] ?? 0) - (oo[i] ?? 0)) / di;
      if (a > b) {
        const t = a;
        a = b;
        b = t;
      }
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Nearest ray hit on a BVH, or null. */
export function rayBvh(bvh: Bvh, ray: Ray): { t: number; u: number; v: number; tri: number } | null {
  let best: { t: number; u: number; v: number; tri: number } | null = null;
  const stack: number[] = bvh.nodeCount > 0 ? [0] : [];
  while (stack.length > 0) {
    const ni = stack.pop() ?? 0;
    const base = ni * 10;
    const min = { x: bvh.nodes[base] ?? 0, y: bvh.nodes[base + 1] ?? 0, z: bvh.nodes[base + 2] ?? 0 };
    const max = { x: bvh.nodes[base + 3] ?? 0, y: bvh.nodes[base + 4] ?? 0, z: bvh.nodes[base + 5] ?? 0 };
    if (!rayBox(ray.o, ray.d, min, max)) continue;
    const left = bvh.nodes[base + 6] ?? -1;
    const right = bvh.nodes[base + 7] ?? -1;
    if (left < 0) {
      const start = bvh.nodes[base + 8] ?? 0;
      const count = bvh.nodes[base + 9] ?? 0;
      for (let i = 0; i < count; i++) {
        const tri = bvh.order[start + i] ?? 0;
        const a = (bvh.idx[tri * 3] ?? 0) * 3;
        const b = (bvh.idx[tri * 3 + 1] ?? 0) * 3;
        const c = (bvh.idx[tri * 3 + 2] ?? 0) * 3;
        const hit = rayTriangle(
          ray.o, ray.d,
          { x: bvh.pos[a] ?? 0, y: bvh.pos[a + 1] ?? 0, z: bvh.pos[a + 2] ?? 0 },
          { x: bvh.pos[b] ?? 0, y: bvh.pos[b + 1] ?? 0, z: bvh.pos[b + 2] ?? 0 },
          { x: bvh.pos[c] ?? 0, y: bvh.pos[c + 1] ?? 0, z: bvh.pos[c + 2] ?? 0 },
        );
        if (hit !== null && (best === null || hit.t < best.t)) best = { ...hit, tri };
      }
    } else {
      stack.push(left, right);
    }
  }
  return best;
}

/* ---------------- picking over a scene ---------------- */

export type Pickable =
  | { readonly k: 'point'; readonly objId: ObjId; readonly at: V3 }
  | { readonly k: 'path'; readonly objId: ObjId; readonly pts: Float32Array; readonly closed: boolean }
  | { readonly k: 'surface'; readonly objId: ObjId; readonly bvh: Bvh; readonly transparent: boolean }
  | { readonly k: 'label'; readonly objId: ObjId; readonly at: V3; readonly radiusPx: number }
  | { readonly k: 'gizmo'; readonly objId: ObjId; readonly at: V3; readonly radiusPx: number };

const PICK_PRIORITY: Readonly<Record<PickKind, number>> = {
  gizmo: 0,
  label: 1,
  point: 2,
  path: 3,
  surface: 4,
};

/**
 * Pick hits sorted best-first: gizmo, labels, points, paths, surfaces; ties
 * by depth. Points within tolerance beat a surface in front of them unless
 * hidden behind an opaque surface; transparent surfaces rank last.
 */
export function pick(
  items: readonly Pickable[],
  ray: Ray,
  project: Projector,
  pointerX: number,
  pointerY: number,
  opts: PickOpts,
): PickHit[] {
  const hits: PickHit[] = [];
  let opaqueT = Infinity;
  const surfaces: Array<{ item: Extract<Pickable, { k: 'surface' }>; t: number; u: number; v: number }> = [];
  for (const item of items) {
    switch (item.k) {
      case 'gizmo':
      case 'label': {
        const s = project(item.at);
        if (s === null) break;
        const dist = Math.hypot(s.x - pointerX, s.y - pointerY);
        if (dist <= item.radiusPx) {
          hits.push({
            objId: item.objId,
            kind: item.k,
            t: v3Len(v3Sub(item.at, ray.o)),
            world: item.at,
            screenDist: dist,
            transparent: false,
          });
        }
        break;
      }
      case 'point': {
        const s = project(item.at);
        if (s === null) break;
        const dist = Math.hypot(s.x - pointerX, s.y - pointerY);
        if (dist <= opts.tolerancePx) {
          hits.push({
            objId: item.objId,
            kind: 'point',
            t: v3Len(v3Sub(item.at, ray.o)),
            world: item.at,
            screenDist: dist,
            transparent: false,
          });
        }
        break;
      }
      case 'path': {
        const n = Math.floor(item.pts.length / 3);
        let best: { dist: number; s: number; world: V3 } | null = null;
        const ptAt = (i: number): V3 => ({ x: item.pts[i * 3] ?? 0, y: item.pts[i * 3 + 1] ?? 0, z: item.pts[i * 3 + 2] ?? 0 });
        const segs = n < 2 ? 0 : item.closed ? n : n - 1;
        const span = item.closed ? n : Math.max(n - 1, 1);
        if (n === 1) {
          const p = ptAt(0);
          const s = project(p);
          if (s !== null) {
            const dist = Math.hypot(s.x - pointerX, s.y - pointerY);
            if (dist <= opts.tolerancePx) best = { dist, s: 0, world: p };
          }
        }
        // Test every segment in screen space, not only the vertices (design 9.4).
        for (let i = 0; i < segs; i++) {
          const p0 = ptAt(i);
          const p1 = ptAt((i + 1) % n);
          const s0 = project(p0);
          const s1 = project(p1);
          if (s0 === null || s1 === null) continue;
          const dx = s1.x - s0.x;
          const dy = s1.y - s0.y;
          const len2 = dx * dx + dy * dy;
          const tt = len2 > 0 ? Math.min(1, Math.max(0, ((pointerX - s0.x) * dx + (pointerY - s0.y) * dy) / len2)) : 0;
          const dist = Math.hypot(pointerX - (s0.x + tt * dx), pointerY - (s0.y + tt * dy));
          if (dist <= opts.tolerancePx && (best === null || dist < best.dist)) {
            best = { dist, s: (i + tt) / span, world: v3Add(p0, v3Scale(v3Sub(p1, p0), tt)) };
          }
        }
        if (best !== null) {
          hits.push({
            objId: item.objId,
            kind: 'path',
            t: v3Len(v3Sub(best.world, ray.o)),
            world: best.world,
            param: { s: best.s },
            screenDist: best.dist,
            transparent: false,
          });
        }
        break;
      }
      case 'surface': {
        if (item.transparent && !opts.includeTransparent) break;
        const hit = rayBvh(item.bvh, ray);
        if (hit !== null) {
          surfaces.push({ item, t: hit.t, u: hit.u, v: hit.v });
          if (!item.transparent && hit.t < opaqueT) opaqueT = hit.t;
        }
        break;
      }
    }
  }
  for (const s of surfaces) {
    hits.push({
      objId: s.item.objId,
      kind: 'surface',
      t: s.t,
      world: v3Add(ray.o, v3Scale(ray.d, s.t)),
      param: { u: s.u, v: s.v },
      screenDist: 0,
      transparent: s.item.transparent,
    });
  }
  // Drop points/paths hidden behind an opaque surface.
  const kept = hits.filter((h) => h.kind === 'surface' || h.t <= opaqueT + 1e-9);
  kept.sort((a, b) => {
    const pa = PICK_PRIORITY[a.kind] + (a.transparent ? 10 : 0);
    const pb = PICK_PRIORITY[b.kind] + (b.transparent ? 10 : 0);
    if (pa !== pb) return pa - pb;
    if (a.kind === 'surface' || b.kind === 'surface') return a.t - b.t;
    if (a.screenDist !== b.screenDist) return a.screenDist - b.screenDist;
    return a.t - b.t;
  });
  return kept;
}

/** Screen-space distance of a world point from the pointer, or null behind. */
export function screenDistance(project: Projector, at: V3, pointerX: number, pointerY: number): number | null {
  const s = project(at);
  return s === null ? null : Math.hypot(s.x - pointerX, s.y - pointerY);
}
