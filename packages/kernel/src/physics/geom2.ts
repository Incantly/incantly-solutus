/**
 * Plane geometry for the physics engine (docs/features/physics/design.md 6.4): orientation, convexity, self-crossing,
 * splitting a polygon with dents into convex parts (ear clipping, then Hertel–Mehlhorn merging), and mass properties.
 * Only exact operations (`+ - * /`, `Math.sqrt`); no allocation concerns here, it runs when a body is built.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Twice the signed area (positive when counter-clockwise). */
export function area2(pts: readonly Pt[]): number {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as Pt;
    const b = pts[(i + 1) % n] as Pt;
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

/** The points counter-clockwise, with repeated and collinear points removed. */
export function cleanPolygon(pts: readonly Pt[], eps = 1e-12): Pt[] {
  let p = pts.map((q) => ({ x: q.x, y: q.y }));
  if (area2(p) < 0) p.reverse();
  // drop repeats
  p = p.filter((q, i) => {
    const r = p[(i + 1) % p.length] as Pt;
    return Math.abs(q.x - r.x) > eps || Math.abs(q.y - r.y) > eps;
  });
  // drop collinear middle points
  let changed = true;
  while (changed && p.length > 3) {
    changed = false;
    for (let i = 0; i < p.length; i++) {
      const a = p[(i + p.length - 1) % p.length] as Pt;
      const b = p[i] as Pt;
      const c = p[(i + 1) % p.length] as Pt;
      const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      const scale = Math.abs(b.x - a.x) + Math.abs(b.y - a.y) + Math.abs(c.x - b.x) + Math.abs(c.y - b.y);
      if (Math.abs(cr) <= eps * scale * scale) {
        p.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return p;
}

const cross = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

export function isConvex(pts: readonly Pt[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) if (cross(pts[i] as Pt, pts[(i + 1) % n] as Pt, pts[(i + 2) % n] as Pt) < 0) return false;
  return true;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** The first two edges that cross (edge i runs from point i to point i + 1), or undefined for a simple polygon. */
export function firstCrossing(pts: readonly Pt[]): [number, number] | undefined {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(pts[i] as Pt, pts[(i + 1) % n] as Pt, pts[j] as Pt, pts[(j + 1) % n] as Pt)) return [i, j];
    }
  }
  return undefined;
}

function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  return cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
}

/** Ear clipping of a simple counter-clockwise polygon, giving index triples. */
function triangulate(pts: readonly Pt[]): [number, number, number][] {
  const idx = pts.map((_, i) => i);
  const tris: [number, number, number][] = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let cut = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length] as number;
      const i1 = idx[k] as number;
      const i2 = idx[(k + 1) % idx.length] as number;
      const a = pts[i0] as Pt;
      const b = pts[i1] as Pt;
      const c = pts[i2] as Pt;
      if (cross(a, b, c) <= 0) continue;
      let inside = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (inTriangle(pts[j] as Pt, a, b, c)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) tris.push([idx[0] as number, idx[1] as number, idx[2] as number]);
  return tris;
}

/**
 * Convex parts of a simple polygon: ear clipping, then merging neighbours while the union stays convex
 * (Hertel–Mehlhorn), with at most `maxVerts` corners per part. Parts are counter-clockwise.
 */
export function convexParts(input: readonly Pt[], maxVerts = 16): Pt[][] {
  const pts = cleanPolygon(input);
  if (pts.length < 3) return [];
  if (isConvex(pts) && pts.length <= maxVerts) return [pts];
  let parts: number[][] = triangulate(pts).map((t) => [...t]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const u = joinParts(parts[i] as number[], parts[j] as number[]);
        if (!u || u.length > maxVerts) continue;
        if (!isConvex(u.map((k) => pts[k] as Pt))) continue;
        parts[i] = u;
        parts.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  parts = parts.filter((p) => p.length >= 3);
  return parts.map((p) => p.map((k) => ({ x: (pts[k] as Pt).x, y: (pts[k] as Pt).y })));
}

/** Two index rings that share one edge, joined into one ring; undefined when they share no edge. */
function joinParts(a: readonly number[], b: readonly number[]): number[] | undefined {
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as number;
    const q = a[(i + 1) % a.length] as number;
    for (let j = 0; j < b.length; j++) {
      if (b[j] === q && b[(j + 1) % b.length] === p) {
        const out: number[] = [];
        for (let k = 0; k < a.length; k++) out.push(a[(i + 1 + k) % a.length] as number);
        // a from q round to p; then b's points between p and q
        for (let k = 2; k < b.length; k++) out.push(b[(j + k) % b.length] as number);
        return out;
      }
    }
  }
  return undefined;
}

export interface MassProps {
  /** Area. */
  readonly area: number;
  readonly cx: number;
  readonly cy: number;
  /** Second moment of area about the centroid (inertia for density 1). */
  readonly inertia: number;
}

/** Area, centroid and polar second moment of a convex counter-clockwise polygon. */
export function polygonMass(pts: readonly Pt[]): MassProps {
  // relative to the first point, for accuracy far from the origin
  const o = pts[0] as Pt;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let I = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const e1x = (pts[i] as Pt).x - o.x;
    const e1y = (pts[i] as Pt).y - o.y;
    const e2x = (pts[i + 1] as Pt).x - o.x;
    const e2y = (pts[i + 1] as Pt).y - o.y;
    const D = e1x * e2y - e1y * e2x;
    const a = 0.5 * D;
    area += a;
    cx += (a * (e1x + e2x)) / 3;
    cy += (a * (e1y + e2y)) / 3;
    const intx2 = e1x * e1x + e2x * e1x + e2x * e2x;
    const inty2 = e1y * e1y + e2y * e1y + e2y * e2y;
    I += (D / 12) * (intx2 + inty2);
  }
  if (!(area > 0)) return { area: 0, cx: o.x, cy: o.y, inertia: 0 };
  cx /= area;
  cy /= area;
  // I is about the first point: move it to the centroid
  const inertia = I - area * (cx * cx + cy * cy);
  return { area, cx: cx + o.x, cy: cy + o.y, inertia };
}

export function circleMass(cx: number, cy: number, r: number): MassProps {
  const area = Math.PI * r * r;
  return { area, cx, cy, inertia: 0.5 * area * r * r };
}

/** An ellipse as an n-gon, counter-clockwise. */
export function ellipsePoints(cx: number, cy: number, ux: number, uy: number, a: number, b: number, n: number, sin: (x: number) => number, cos: (x: number) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const th = (2 * Math.PI * i) / n;
    const c = cos(th) * a;
    const s = sin(th) * b;
    out.push({ x: cx + ux * c - uy * s, y: cy + uy * c + ux * s });
  }
  return out;
}
