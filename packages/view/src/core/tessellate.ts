/**
 * Vector paths as triangles for the GPU (performance 2.2 item 4: paths are tessellated once and cached). A path is a flat
 * list of commands, `0 x y` move, `1 x y` line, `2 x1 y1 x2 y2 x y` cubic, `3` close, in any units; `tolerance` is the
 * largest distance, in those units, between a curve and the segments that stand for it. The output is indexed triangles
 * (`x, y` pairs and indices) with no winding promised, so a back-end draws them with culling off. No DOM, no GPU.
 *
 * A filled path becomes one fan (a convex contour) or an ear-clipped polygon (a concave one). A contour that cannot be
 * filled this way (several contours, which may hold holes, or edges that cross) is refused with `null`, and the caller
 * draws it another way. A stroked path becomes a quad for each segment, a fan for each join and a fan for each round cap:
 * their union is the line, so all the triangles of one stroke can share one depth and be blended once.
 */

export const PATH_OP_MOVE = 0;
export const PATH_OP_LINE = 1;
export const PATH_OP_CUBIC = 2;
export const PATH_OP_CLOSE = 3;

/** One run of points of a path: `x, y` pairs, and whether it was closed. */
export interface Contour {
  readonly points: number[];
  readonly closed: boolean;
}

/** Where triangles are written: vertices as `x, y` pairs, indices into them. */
export interface MeshSink {
  readonly vertices: number[];
  readonly indices: number[];
}

export const newSink = (): MeshSink => ({ vertices: [], indices: [] });

const MAX_CURVE_STEPS = 200;

/** The segments of a cubic from `(x0, y0)` to `(x3, y3)`, appended to `out` (without the first point). */
function flattenCubic(out: number[], x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, tolerance: number): void {
  // the largest second difference of the control points bounds the error of a step: n steps keep it under the tolerance
  const ddx = Math.max(Math.abs(x0 - 2 * x1 + x2), Math.abs(x1 - 2 * x2 + x3));
  const ddy = Math.max(Math.abs(y0 - 2 * y1 + y2), Math.abs(y1 - 2 * y2 + y3));
  const dd = Math.hypot(ddx, ddy);
  const steps = Math.max(1, Math.min(MAX_CURVE_STEPS, Math.ceil(Math.sqrt((0.75 * dd) / Math.max(tolerance, 1e-9)))));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    out.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
  }
}

/** The contours of a path, curves cut into segments no further than `tolerance` from the curve. */
export function flattenPath(d: readonly number[], tolerance: number): Contour[] {
  const out: Contour[] = [];
  let cur: number[] = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;
  const finish = (closed: boolean): void => {
    if (cur.length >= 2) out.push({ points: cur, closed });
    cur = [];
  };
  for (let i = 0; i < d.length; ) {
    const op = d[i] as number;
    if (op === PATH_OP_MOVE) {
      finish(false);
      curX = startX = d[i + 1] as number;
      curY = startY = d[i + 2] as number;
      cur.push(curX, curY);
      i += 3;
    } else if (op === PATH_OP_LINE) {
      if (cur.length === 0) cur.push(curX, curY);
      curX = d[i + 1] as number;
      curY = d[i + 2] as number;
      cur.push(curX, curY);
      i += 3;
    } else if (op === PATH_OP_CUBIC) {
      if (cur.length === 0) cur.push(curX, curY);
      const x3 = d[i + 5] as number;
      const y3 = d[i + 6] as number;
      flattenCubic(cur, curX, curY, d[i + 1] as number, d[i + 2] as number, d[i + 3] as number, d[i + 4] as number, x3, y3, tolerance);
      curX = x3;
      curY = y3;
      i += 7;
    } else if (op === PATH_OP_CLOSE) {
      finish(true);
      // a new run after a close starts where the closed one did
      curX = startX;
      curY = startY;
      i += 1;
    } else {
      break;
    }
  }
  finish(false);
  return out;
}

/** The points of `points` with repeated neighbours dropped; a closed run also drops a last point equal to its first. */
function dedupe(points: readonly number[], closed: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i] as number;
    const y = points[i + 1] as number;
    const n = out.length;
    if (n >= 2 && Math.abs((out[n - 2] as number) - x) < 1e-9 && Math.abs((out[n - 1] as number) - y) < 1e-9) continue;
    out.push(x, y);
  }
  const n = out.length;
  if (closed && n >= 4 && Math.abs((out[0] as number) - (out[n - 2] as number)) < 1e-9 && Math.abs((out[1] as number) - (out[n - 1] as number)) < 1e-9) out.length = n - 2;
  return out;
}

const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** True when segments `p1p2` and `p3p4` cross at a point that is not an end of both. */
function segmentsCross(p: readonly number[], i1: number, i2: number, i3: number, i4: number): boolean {
  const d1 = cross(p[i3 * 2] as number, p[i3 * 2 + 1] as number, p[i4 * 2] as number, p[i4 * 2 + 1] as number, p[i1 * 2] as number, p[i1 * 2 + 1] as number);
  const d2 = cross(p[i3 * 2] as number, p[i3 * 2 + 1] as number, p[i4 * 2] as number, p[i4 * 2 + 1] as number, p[i2 * 2] as number, p[i2 * 2 + 1] as number);
  const d3 = cross(p[i1 * 2] as number, p[i1 * 2 + 1] as number, p[i2 * 2] as number, p[i2 * 2 + 1] as number, p[i3 * 2] as number, p[i3 * 2 + 1] as number);
  const d4 = cross(p[i1 * 2] as number, p[i1 * 2 + 1] as number, p[i2 * 2] as number, p[i2 * 2 + 1] as number, p[i4 * 2] as number, p[i4 * 2 + 1] as number);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when two edges that do not share an end cross. */
function selfCrosses(p: readonly number[]): boolean {
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(p, i, (i + 1) % n, j, (j + 1) % n)) return true;
    }
  }
  return false;
}

const inTriangle = (px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean => {
  const d1 = cross(ax, ay, bx, by, px, py);
  const d2 = cross(bx, by, cx, cy, px, py);
  const d3 = cross(cx, cy, ax, ay, px, py);
  return d1 >= 0 && d2 >= 0 && d3 >= 0;
};

/**
 * Adds the triangles that fill a path (nonzero rule) to `out`. Returns false, and adds nothing, when the path has no
 * area, has more than one contour, or has edges that cross: the caller fills such a path another way.
 */
export function fillMesh(contours: readonly Contour[], out: MeshSink): boolean {
  if (contours.length !== 1) return false;
  const pts = dedupe((contours[0] as Contour).points, true);
  const n = pts.length / 2;
  if (n < 3) return false;
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += (pts[i * 2] as number) * (pts[j * 2 + 1] as number) - (pts[j * 2] as number) * (pts[i * 2 + 1] as number);
  }
  if (Math.abs(area2) < 1e-12) return false;
  // order the corners counter-clockwise so "convex corner" is a positive cross product
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(area2 > 0 ? i : n - 1 - i);
  const at = (i: number, k: number): number => pts[i * 2 + k] as number;
  let convex = true;
  for (let i = 0; i < n && convex; i++) {
    const a = order[i] as number;
    const b = order[(i + 1) % n] as number;
    const c = order[(i + 2) % n] as number;
    if (cross(at(a, 0), at(a, 1), at(b, 0), at(b, 1), at(c, 0), at(c, 1)) < -1e-12) convex = false;
  }
  if (!convex && selfCrosses(pts)) return false;
  const base = out.vertices.length / 2;
  for (let i = 0; i < n; i++) out.vertices.push(pts[i * 2] as number, pts[i * 2 + 1] as number);
  if (convex) {
    for (let i = 1; i + 1 < n; i++) out.indices.push(base + (order[0] as number), base + (order[i] as number), base + (order[i + 1] as number));
    return true;
  }
  // ear clipping
  const ring = order.slice();
  const tris: number[] = [];
  let guard = n * n + 8;
  while (ring.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < ring.length; i++) {
      const ia = ring[(i + ring.length - 1) % ring.length] as number;
      const ib = ring[i] as number;
      const ic = ring[(i + 1) % ring.length] as number;
      if (cross(at(ia, 0), at(ia, 1), at(ib, 0), at(ib, 1), at(ic, 0), at(ic, 1)) <= 1e-12) continue;
      let ear = true;
      for (const other of ring) {
        if (other === ia || other === ib || other === ic) continue;
        if (inTriangle(at(other, 0), at(other, 1), at(ia, 0), at(ia, 1), at(ib, 0), at(ib, 1), at(ic, 0), at(ic, 1))) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      tris.push(ia, ib, ic);
      ring.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) return false;
  }
  if (ring.length !== 3) return false;
  tris.push(ring[0] as number, ring[1] as number, ring[2] as number);
  for (const t of tris) out.indices.push(base + t);
  return true;
}

export type LineCap = 'butt' | 'round';

/** The number of segments for an arc of `angle` radians on radius `r`, no segment further than `tolerance` from the arc. */
function arcSteps(angle: number, r: number, tolerance: number): number {
  if (!(r > tolerance)) return 1;
  const step = 2 * Math.acos(1 - tolerance / r);
  return Math.max(1, Math.min(64, Math.ceil(angle / Math.max(step, 0.05))));
}

/** A fan about `(cx, cy)` from the direction `a0` through `sweep` radians (positive turns from +x to +y), radius `r`. */
function fan(out: MeshSink, cx: number, cy: number, r: number, a0: number, sweep: number, tolerance: number): void {
  const steps = arcSteps(Math.abs(sweep), r, tolerance);
  const c = out.vertices.length / 2;
  out.vertices.push(cx, cy);
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (sweep * i) / steps;
    out.vertices.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  for (let i = 0; i < steps; i++) out.indices.push(c, c + 1 + i, c + 2 + i);
}

/** Adds the triangles of the line through `points` (a run of `x, y` pairs), `width` wide, to `out`. */
function strokeRun(points: readonly number[], closed: boolean, width: number, cap: LineCap, tolerance: number, out: MeshSink): void {
  const p = dedupe(points, closed);
  const n = p.length / 2;
  const h = width / 2;
  if (n === 1) {
    if (cap === 'round') fan(out, p[0] as number, p[1] as number, h, 0, Math.PI * 2, tolerance);
    return;
  }
  if (n < 2) return;
  const segs = closed && n > 2 ? n : n - 1;
  const dx: number[] = [];
  const dy: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    const ex = (p[b] as number) - (p[a] as number);
    const ey = (p[b + 1] as number) - (p[a + 1] as number);
    const len = Math.hypot(ex, ey);
    dx.push(ex / len);
    dy.push(ey / len);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    const nx = -(dy[i] as number) * h;
    const ny = (dx[i] as number) * h;
    const v = out.vertices.length / 2;
    out.vertices.push((p[a] as number) + nx, (p[a + 1] as number) + ny, (p[a] as number) - nx, (p[a + 1] as number) - ny, (p[b] as number) - nx, (p[b + 1] as number) - ny, (p[b] as number) + nx, (p[b + 1] as number) + ny);
    out.indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  // joins: round, on the outer side of the turn (a turn that is small enough is one triangle)
  const from = closed && n > 2 ? 0 : 1;
  const to = closed && n > 2 ? n : n - 1;
  for (let i = from; i < to; i++) {
    const s0 = (i + segs - 1) % segs;
    const s1 = i % segs;
    const x0 = dx[s0] as number;
    const y0 = dy[s0] as number;
    const x1 = dx[s1] as number;
    const y1 = dy[s1] as number;
    const turn = x0 * y1 - y0 * x1;
    const along = x0 * x1 + y0 * y1;
    if (Math.abs(turn) < 1e-9 && along > 0) continue;
    // the outer side is the right of a left turn: the normal of a segment is (-dy, dx), the left
    const side = turn > 0 ? -1 : 1;
    const a0 = Math.atan2(side * x0, -side * y0);
    let sweep = Math.atan2(turn, along);
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    fan(out, p[i * 2] as number, p[i * 2 + 1] as number, h, a0, sweep, tolerance);
  }
  if (!closed && cap === 'round') {
    // the end cap turns from the left normal of the last segment through its direction to the right normal
    const last = segs - 1;
    fan(out, p[(n - 1) * 2] as number, p[(n - 1) * 2 + 1] as number, h, Math.atan2(dx[last] as number, -(dy[last] as number)), -Math.PI, tolerance);
    fan(out, p[0] as number, p[1] as number, h, Math.atan2(-(dx[0] as number), dy[0] as number), -Math.PI, tolerance);
  }
}

/** The pieces of a run that a dash pattern leaves: each is a run of `x, y` pairs. */
function dashRuns(points: readonly number[], closed: boolean, pattern: readonly number[]): number[][] {
  const p = dedupe(points, closed);
  const n = p.length / 2;
  const runs: number[][] = [];
  if (n < 2) return runs;
  const segs = closed && n > 2 ? n : n - 1;
  let k = 0;
  let left = pattern[0] as number;
  let on = true;
  let cur: number[] = [p[0] as number, p[1] as number];
  const guard = { steps: 0 };
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    const ax = p[a] as number;
    const ay = p[a + 1] as number;
    const ex = (p[b] as number) - ax;
    const ey = (p[b + 1] as number) - ay;
    const len = Math.hypot(ex, ey);
    let at = 0;
    while (len - at > left && guard.steps++ < 100_000) {
      at += left;
      const x = ax + (ex * at) / len;
      const y = ay + (ey * at) / len;
      if (on) {
        cur.push(x, y);
        runs.push(cur);
        cur = [];
      } else {
        cur = [x, y];
      }
      on = !on;
      k = (k + 1) % pattern.length;
      left = pattern[k] as number;
    }
    left -= len - at;
    if (on) cur.push(p[b] as number, p[b + 1] as number);
  }
  if (on && cur.length >= 4) runs.push(cur);
  return runs;
}

/**
 * Adds the triangles of the stroke of a path to `out`: `width` wide, round joins, `cap` ends, and `dash` (alternating
 * lengths of line and gap, empty for a solid line) along each contour. A width of 0 or less adds nothing.
 */
export function strokeMesh(contours: readonly Contour[], width: number, cap: LineCap, dash: readonly number[], tolerance: number, out: MeshSink): void {
  if (!(width > 0)) return;
  const pattern = dash.length > 0 && dash.every((d) => d > 0) ? (dash.length % 2 === 1 ? [...dash, ...dash] : dash) : [];
  for (const c of contours) {
    if (pattern.length === 0) {
      strokeRun(c.points, c.closed, width, cap, tolerance, out);
    } else {
      for (const run of dashRuns(c.points, c.closed, pattern)) strokeRun(run, false, width, cap, tolerance, out);
    }
  }
}
