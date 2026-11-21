/**
 * Narrow phase in the plane (docs/features/physics/design.md 6.4): contact manifolds for circle–circle, polygon–circle
 * and polygon–polygon (separating axis, then clipping the incident edge), with speculative contacts up to a margin.
 * Manifolds are stored in body frames (as Box2D 2.x does), so the position pass can recompute them as bodies move, and
 * each point carries a feature id so its impulse survives from step to step.
 */

/** A shape as the narrow phase sees it: world-space data, kept up to date by the world. */
export interface Shape2 {
  readonly kind: 0 | 1; // 0 circle, 1 polygon (a 2-point polygon is a thin wall)
  readonly body: number;
  readonly radius: number;
  /** Circle centre, body frame. */
  readonly lcx: number;
  readonly lcy: number;
  /** Polygon corners and edge normals, body frame, counter-clockwise. */
  readonly lx: Float64Array;
  readonly ly: Float64Array;
  readonly lnx: Float64Array;
  readonly lny: Float64Array;
  /** The same in world space. */
  readonly wx: Float64Array;
  readonly wy: Float64Array;
  readonly wnx: Float64Array;
  readonly wny: Float64Array;
  wcx: number;
  wcy: number;
}

export const ManifoldType = { Circles: 0, FaceA: 1, FaceB: 2 } as const;
export type ManifoldType = (typeof ManifoldType)[keyof typeof ManifoldType];

/** A manifold in body frames: the normal and plane point in the frame of the reference body, points in the other. */
export interface Manifold {
  type: ManifoldType;
  count: number;
  lnx: number;
  lny: number;
  lpx: number;
  lpy: number;
  p0x: number;
  p0y: number;
  id0: number;
  p1x: number;
  p1y: number;
  id1: number;
}

export function newManifold(): Manifold {
  return { type: ManifoldType.Circles, count: 0, lnx: 0, lny: 0, lpx: 0, lpy: 0, p0x: 0, p0y: 0, id0: 0, p1x: 0, p1y: 0, id1: 0 };
}

/** Body poses the narrow phase needs: centre of mass and the rotation's cos and sin. */
export interface Poses {
  readonly px: Float64Array;
  readonly py: Float64Array;
  readonly qc: Float64Array;
  readonly qs: Float64Array;
  /**
   * The margin a manifold is made within, and the two radii `worldManifold` takes (of the shapes of A and B): set by the
   * caller before the call (fields, not arguments: a number passed in a call that is not inlined is a heap number, which
   * is garbage in every contact of every step, design 11.4).
   */
  margin: number;
  radA: number;
  radB: number;
}

/* (World point to body frame, and a direction to it, are written out where they are used: see `collidePolygonCircle` and `collidePolygons`.) */

export function collideCircles(P: Poses, a: Shape2, b: Shape2, m: Manifold): void {
  m.count = 0;
  const dx = b.wcx - a.wcx;
  const dy = b.wcy - a.wcy;
  const r = a.radius + b.radius + P.margin;
  if (dx * dx + dy * dy > r * r) return;
  m.type = ManifoldType.Circles;
  m.lpx = a.lcx;
  m.lpy = a.lcy;
  m.lnx = 0;
  m.lny = 0;
  m.count = 1;
  m.p0x = b.lcx;
  m.p0y = b.lcy;
  m.id0 = 0;
  void P;
}

/** `a` is the polygon, `b` the circle. */
export function collidePolygonCircle(P: Poses, a: Shape2, b: Shape2, m: Manifold): void {
  m.count = 0;
  const cx = b.wcx;
  const cy = b.wcy;
  const R = a.radius + b.radius + P.margin;
  const n = a.wx.length;
  let sep = -Infinity;
  let edge = 0;
  for (let i = 0; i < n; i++) {
    const s = (a.wnx[i] as number) * (cx - (a.wx[i] as number)) + (a.wny[i] as number) * (cy - (a.wy[i] as number));
    if (s > R) return;
    if (s > sep) {
      sep = s;
      edge = i;
    }
  }
  const i1 = edge;
  const i2 = (edge + 1) % n;
  const v1x = a.wx[i1] as number;
  const v1y = a.wy[i1] as number;
  const v2x = a.wx[i2] as number;
  const v2y = a.wy[i2] as number;
  m.type = ManifoldType.FaceA;
  m.count = 1;
  m.p0x = b.lcx;
  m.p0y = b.lcy;
  m.id0 = 0;
  if (sep < 1e-12) {
    m.lnx = a.lnx[i1] as number;
    m.lny = a.lny[i1] as number;
    m.lpx = 0.5 * ((a.lx[i1] as number) + (a.lx[i2] as number));
    m.lpy = 0.5 * ((a.ly[i1] as number) + (a.ly[i2] as number));
    return;
  }
  const u1 = (cx - v1x) * (v2x - v1x) + (cy - v1y) * (v2y - v1y);
  const u2 = (cx - v2x) * (v1x - v2x) + (cy - v2y) * (v1y - v2y);
  if (u1 <= 0 || u2 <= 0) {
    const vx = u1 <= 0 ? v1x : v2x;
    const vy = u1 <= 0 ? v1y : v2y;
    const dx = cx - vx;
    const dy = cy - vy;
    const d2 = dx * dx + dy * dy;
    if (d2 > R * R) {
      m.count = 0;
      return;
    }
    const d = Math.sqrt(d2);
    const nx = d > 0 ? dx / d : (a.wnx[i1] as number);
    const ny = d > 0 ? dy / d : (a.wny[i1] as number);
    // (the body-frame maps written out: a number passed to or returned from a call that is not inlined is a heap number)
    const ca = P.qc[a.body] as number;
    const sa = P.qs[a.body] as number;
    const ox = vx - (P.px[a.body] as number);
    const oy = vy - (P.py[a.body] as number);
    m.lnx = ca * nx + sa * ny;
    m.lny = -sa * nx + ca * ny;
    m.lpx = ca * ox + sa * oy;
    m.lpy = -sa * ox + ca * oy;
    m.id0 = u1 <= 0 ? 1 : 2;
    return;
  }
  const fx = 0.5 * (v1x + v2x);
  const fy = 0.5 * (v1y + v2y);
  const s = (cx - fx) * (a.wnx[i1] as number) + (cy - fy) * (a.wny[i1] as number);
  if (s > R) {
    m.count = 0;
    return;
  }
  m.lnx = a.lnx[i1] as number;
  m.lny = a.lny[i1] as number;
  m.lpx = 0.5 * ((a.lx[i1] as number) + (a.lx[i2] as number));
  m.lpy = 0.5 * ((a.ly[i1] as number) + (a.ly[i2] as number));
}

const MAX_SEP = { s: 0, e: 0 };

/** The edge of `p1` with the largest separation from `p2`. */
function maxSeparation(p1: Shape2, p2: Shape2): void {
  const n1 = p1.wx.length;
  const n2 = p2.wx.length;
  let best = -Infinity;
  let be = 0;
  for (let i = 0; i < n1; i++) {
    const nx = p1.wnx[i] as number;
    const ny = p1.wny[i] as number;
    const vx = p1.wx[i] as number;
    const vy = p1.wy[i] as number;
    let si = Infinity;
    for (let j = 0; j < n2; j++) {
      const s = nx * ((p2.wx[j] as number) - vx) + ny * ((p2.wy[j] as number) - vy);
      if (s < si) si = s;
    }
    if (si > best) {
      best = si;
      be = i;
    }
  }
  MAX_SEP.s = best;
  MAX_SEP.e = be;
}

/** Scratch for clipping: two points and their ids. */
const CL = new Float64Array(6);
const CL2 = new Float64Array(6);

/** The side `clip` cuts by, set by the caller: the normal in 0 and 1, the offset in 2 (numbers passed in a call are heap numbers when it is not inlined). */
const CLP = new Float64Array(3);

/**
 * Clips the segment (x0, y0, id0)–(x1, y1, id1) in `src` to the side where `nx x + ny y - offset ≤ 0`, with `nx`, `ny`
 * and `offset` read from `CLP`, into `dst`. Returns the number of points kept (0 to 2). A new point takes the id `cutId`.
 */
function clip(src: Float64Array, dst: Float64Array, cutId: number): number {
  const nx = CLP[0] as number;
  const ny = CLP[1] as number;
  const offset = CLP[2] as number;
  let k = 0;
  const d0 = nx * (src[0] as number) + ny * (src[1] as number) - offset;
  const d1 = nx * (src[3] as number) + ny * (src[4] as number) - offset;
  if (d0 <= 0) {
    dst[0] = src[0] as number;
    dst[1] = src[1] as number;
    dst[2] = src[2] as number;
    k = 1;
  }
  if (d1 <= 0) {
    dst[k * 3] = src[3] as number;
    dst[k * 3 + 1] = src[4] as number;
    dst[k * 3 + 2] = src[5] as number;
    k++;
  }
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    dst[k * 3] = (src[0] as number) + t * ((src[3] as number) - (src[0] as number));
    dst[k * 3 + 1] = (src[1] as number) + t * ((src[4] as number) - (src[1] as number));
    dst[k * 3 + 2] = cutId;
    k++;
  }
  return k;
}

export function collidePolygons(P: Poses, a: Shape2, b: Shape2, m: Manifold): void {
  m.count = 0;
  const R = a.radius + b.radius + P.margin;
  maxSeparation(a, b);
  const sepA = MAX_SEP.s;
  const edgeA = MAX_SEP.e;
  if (sepA > R) return;
  maxSeparation(b, a);
  const sepB = MAX_SEP.s;
  const edgeB = MAX_SEP.e;
  if (sepB > R) return;
  let ref: Shape2;
  let inc: Shape2;
  let edge: number;
  let flip: boolean;
  // a thin wall (two corners) gives the face whenever it is about as good, so a body resting on a long wall keeps
  // the same contact features step after step (and its warm start); otherwise the usual small preference for A
  const aWall = a.wx.length === 2 && b.wx.length > 2;
  const bWall = b.wx.length === 2 && a.wx.length > 2;
  const useB = bWall ? sepB > sepA - 0.01 : aWall ? sepB > sepA + 0.01 : sepB > sepA + 0.0005;
  if (useB) {
    ref = b;
    inc = a;
    edge = edgeB;
    flip = true;
  } else {
    ref = a;
    inc = b;
    edge = edgeA;
    flip = false;
  }
  const rn = ref.wx.length;
  const nrx = ref.wnx[edge] as number;
  const nry = ref.wny[edge] as number;
  // incident edge: the one whose normal is most against the reference normal
  const inN = inc.wx.length;
  let ie = 0;
  let minDot = Infinity;
  for (let i = 0; i < inN; i++) {
    const d = nrx * (inc.wnx[i] as number) + nry * (inc.wny[i] as number);
    if (d < minDot) {
      minDot = d;
      ie = i;
    }
  }
  const i1 = ie;
  const i2 = (ie + 1) % inN;
  CL[0] = inc.wx[i1] as number;
  CL[1] = inc.wy[i1] as number;
  CL[2] = edge * 256 + i1;
  CL[3] = inc.wx[i2] as number;
  CL[4] = inc.wy[i2] as number;
  CL[5] = edge * 256 + i2;
  const r1 = edge;
  const r2 = (edge + 1) % rn;
  const v1x = ref.wx[r1] as number;
  const v1y = ref.wy[r1] as number;
  const v2x = ref.wx[r2] as number;
  const v2y = ref.wy[r2] as number;
  let tx = v2x - v1x;
  let ty = v2y - v1y;
  const tl = Math.sqrt(tx * tx + ty * ty);
  if (!(tl > 0)) return;
  tx /= tl;
  ty /= tl;
  const side1 = -(tx * v1x + ty * v1y) + R;
  const side2 = tx * v2x + ty * v2y + R;
  CLP[0] = -tx;
  CLP[1] = -ty;
  CLP[2] = side1;
  if (clip(CL, CL2, edge * 256 + 128 + 0) < 2) return;
  CLP[0] = tx;
  CLP[1] = ty;
  CLP[2] = side2;
  if (clip(CL2, CL, edge * 256 + 128 + 1) < 2) return;
  const front = nrx * v1x + nry * v1y;
  m.type = flip ? ManifoldType.FaceB : ManifoldType.FaceA;
  m.lnx = ref.lnx[edge] as number;
  m.lny = ref.lny[edge] as number;
  m.lpx = 0.5 * ((ref.lx[r1] as number) + (ref.lx[r2] as number));
  m.lpy = 0.5 * ((ref.ly[r1] as number) + (ref.ly[r2] as number));
  const flipBit = flip ? 65536 : 0;
  let k = 0;
  for (let p = 0; p < 2; p++) {
    const x = CL[p * 3] as number;
    const y = CL[p * 3 + 1] as number;
    const sep = nrx * x + nry * y - front;
    if (sep > R) continue;
    const ox = x - (P.px[inc.body] as number);
    const oy = y - (P.py[inc.body] as number);
    const lx = (P.qc[inc.body] as number) * ox + (P.qs[inc.body] as number) * oy;
    const ly = -(P.qs[inc.body] as number) * ox + (P.qc[inc.body] as number) * oy;
    const id = (CL[p * 3 + 2] as number) + flipBit;
    if (k === 0) {
      m.p0x = lx;
      m.p0y = ly;
      m.id0 = id;
    } else {
      m.p1x = lx;
      m.p1y = ly;
      m.id1 = id;
    }
    k++;
  }
  m.count = k;
}

/** Writes the world normal (A to B), points and separations of a manifold for the current poses. */
export interface WorldManifold {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  s0: number;
  x1: number;
  y1: number;
  s1: number;
}

export function newWorldManifold(): WorldManifold {
  return { nx: 0, ny: 0, x0: 0, y0: 0, s0: 0, x1: 0, y1: 0, s1: 0 };
}

export function worldManifold(P: Poses, m: Manifold, bodyA: number, bodyB: number, out: WorldManifold): void {
  const rA = P.radA;
  const rB = P.radB;
  const cA = P.qc[bodyA] as number;
  const sA = P.qs[bodyA] as number;
  const cB = P.qc[bodyB] as number;
  const sB = P.qs[bodyB] as number;
  const ax = P.px[bodyA] as number;
  const ay = P.py[bodyA] as number;
  const bx = P.px[bodyB] as number;
  const by = P.py[bodyB] as number;
  if (m.type === ManifoldType.Circles) {
    const pAx = ax + cA * m.lpx - sA * m.lpy;
    const pAy = ay + sA * m.lpx + cA * m.lpy;
    const pBx = bx + cB * m.p0x - sB * m.p0y;
    const pBy = by + sB * m.p0x + cB * m.p0y;
    let nx = pBx - pAx;
    let ny = pBy - pAy;
    const l = Math.sqrt(nx * nx + ny * ny);
    if (l > 1e-15) {
      nx /= l;
      ny /= l;
    } else {
      nx = 1;
      ny = 0;
    }
    out.nx = nx;
    out.ny = ny;
    const qAx = pAx + rA * nx;
    const qAy = pAy + rA * ny;
    const qBx = pBx - rB * nx;
    const qBy = pBy - rB * ny;
    out.x0 = 0.5 * (qAx + qBx);
    out.y0 = 0.5 * (qAy + qBy);
    out.s0 = (qBx - qAx) * nx + (qBy - qAy) * ny;
    return;
  }
  if (m.type === ManifoldType.FaceA) {
    const nx = cA * m.lnx - sA * m.lny;
    const ny = sA * m.lnx + cA * m.lny;
    const ppx = ax + cA * m.lpx - sA * m.lpy;
    const ppy = ay + sA * m.lpx + cA * m.lpy;
    out.nx = nx;
    out.ny = ny;
    for (let i = 0; i < m.count; i++) {
      const lx = i === 0 ? m.p0x : m.p1x;
      const ly = i === 0 ? m.p0y : m.p1y;
      const qx = bx + cB * lx - sB * ly;
      const qy = by + sB * lx + cB * ly;
      const d = (qx - ppx) * nx + (qy - ppy) * ny;
      const aX = qx + (rA - d) * nx;
      const aY = qy + (rA - d) * ny;
      const bX = qx - rB * nx;
      const bY = qy - rB * ny;
      const s = (bX - aX) * nx + (bY - aY) * ny;
      if (i === 0) {
        out.x0 = 0.5 * (aX + bX);
        out.y0 = 0.5 * (aY + bY);
        out.s0 = s;
      } else {
        out.x1 = 0.5 * (aX + bX);
        out.y1 = 0.5 * (aY + bY);
        out.s1 = s;
      }
    }
    return;
  }
  // FaceB: the reference face is on B; the normal is turned round to point from A to B
  const nx = cB * m.lnx - sB * m.lny;
  const ny = sB * m.lnx + cB * m.lny;
  const ppx = bx + cB * m.lpx - sB * m.lpy;
  const ppy = by + sB * m.lpx + cB * m.lpy;
  out.nx = -nx;
  out.ny = -ny;
  for (let i = 0; i < m.count; i++) {
    const lx = i === 0 ? m.p0x : m.p1x;
    const ly = i === 0 ? m.p0y : m.p1y;
    const qx = ax + cA * lx - sA * ly;
    const qy = ay + sA * lx + cA * ly;
    const d = (qx - ppx) * nx + (qy - ppy) * ny;
    const bX = qx + (rB - d) * nx;
    const bY = qy + (rB - d) * ny;
    const aX = qx - rA * nx;
    const aY = qy - rA * ny;
    const s = (aX - bX) * nx + (aY - bY) * ny;
    if (i === 0) {
      out.x0 = 0.5 * (aX + bX);
      out.y0 = 0.5 * (aY + bY);
      out.s0 = s;
    } else {
      out.x1 = 0.5 * (aX + bX);
      out.y1 = 0.5 * (aY + bY);
      out.s1 = s;
    }
  }
}
