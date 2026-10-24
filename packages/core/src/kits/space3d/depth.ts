import type { Vec3 } from '../../api/types';

/**
 * Depth where pieces of a 3D drawing meet (C3-4, CH-2). The engine first
 * sorts what it draws far to near by each piece's middle. That is right for
 * most pairs and wrong for some: a long face beside a short one, the bottom
 * of a glass under the liquid in it, a line passing a sphere. So every pair
 * that overlaps on the stage is compared where it overlaps, by the depth of
 * each piece's own geometry there (the plane of a face, the front of a
 * sphere, the point along a line), and the order is mended to put the nearer
 * on top. Pieces that pass through each other have no right order; they keep
 * the order of their middles.
 */

/** A stage point. */
export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** How camera space reaches the stage: the camera's centre, pan, scale and perspective distance (0 for none). */
export interface DepthView {
  readonly cx: number;
  readonly cy: number;
  readonly panX: number;
  readonly panY: number;
  readonly scale: number;
  readonly distance: number;
}

/** A drawn piece's geometry: on the stage, and in camera space (x right, y up, z toward the viewer). */
export type PieceShape =
  | { readonly kind: 'polygon'; readonly screen: readonly Pt[]; readonly cam: readonly Vec3[] }
  /** A piece drawn at one depth, such as an arrowhead. */
  | { readonly kind: 'flat'; readonly screen: readonly Pt[]; readonly depth: number }
  /** A sphere drawn as a disc, or a point (camRadius 0). */
  | { readonly kind: 'disc'; readonly centre: Pt; readonly radius: number; readonly cam: Vec3; readonly camRadius: number }
  | { readonly kind: 'polyline'; readonly screen: readonly Pt[]; readonly cam: readonly Vec3[] };

/** A piece ready to compare: its box, its outline or line on the stage, and its depth anywhere under it. */
export interface Prepared {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** The outline of a face, sphere or arrowhead; null for a line. */
  readonly outline: readonly Pt[] | null;
  /** Whether the outline is convex, so it can clip another. */
  readonly convex: boolean;
  /** The points of a line; null for anything else. */
  readonly line: readonly Pt[] | null;
  /** The nearest and farthest it reaches, its bias included. */
  readonly zMin: number;
  readonly zMax: number;
  /** A disc's circle, for overlap tests sharper than its outline. */
  readonly circle: { readonly x: number; readonly y: number; readonly r: number } | null;
  /**
   * The convex solid or sheet a face is part of, and which way the face is
   * turned: faces of one turned the same way never cover each other, and one
   * turned away is behind one turned to the viewer wherever they overlap.
   */
  readonly group: { readonly solid: object; readonly facing: 1 | -1 } | null;
  /** Whether a stage point is covered. */
  inside(x: number, y: number): boolean;
  /** The depth under a stage point, its bias included; larger is nearer. NaN where it has none, such as a face seen edge-on. */
  depth(x: number, y: number): number;
}

/** Half the width of a drawn line, in stage units, for sampling along it. */
export const LINE_HALF = 1;
/** Sides of the polygon that stands for a disc when clipping. */
const DISC_SIDES = 16;
/** Square stage units an overlap must cover before its order matters. */
const MIN_OVERLAP = 0.25;
/** Stage units of a line that must cross a piece before its order matters. */
const MIN_CROSSING = 0.5;
/**
 * How much nearer, as a share of the drawing's size, a piece must be than
 * another where they overlap to count as nearer there; closer than that they
 * are even, as a label on a face is. The engine and the audit share it.
 */
export const DEPTH_TOLERANCE = 0.002;
/** Above this many pieces, or overlapping pairs, the order of the middles stands: mending it would cost a frame. */
export const ORDER_PIECES = 1200;
const ORDER_PAIRS = 24_000;

function signedArea(points: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) sum += points[j]!.x * points[i]!.y - points[i]!.x * points[j]!.y;
  return sum / 2;
}

/** Whether a polygon turns the same way at every corner (straight corners allowed). */
function isConvex(points: readonly Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const c = points[(i + 2) % points.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-9) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** Whether a point lies inside a polygon, by counting crossings. */
export function inPolygon(points: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The nearest point of a polyline: the segment, how far along it, and the squared distance. */
export function nearest(points: readonly Pt[], x: number, y: number): { segment: number; t: number; d2: number } {
  let best = { segment: 0, t: 0, d2: Infinity };
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
    const px = a.x + dx * t - x;
    const py = a.y + dy * t - y;
    const d2 = px * px + py * py;
    if (d2 < best.d2) best = { segment: i, t, d2 };
  }
  return best;
}

/** The nearest and farthest depth of some points, with a bias. */
function range(cam: readonly Vec3[], bias: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const c of cam) {
    if (c[2] < min) min = c[2];
    if (c[2] > max) max = c[2];
  }
  return [min + bias, max + bias];
}

/** Whether two convex outlines overlap: no edge of either separates them (the separating axis test). */
function convexOverlap(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i]!;
      const q = polygon[(i + 1) % polygon.length]!;
      const nx = q.y - p.y;
      const ny = p.x - q.x;
      let minA = Infinity;
      let maxA = -Infinity;
      for (const v of a) {
        const t = v.x * nx + v.y * ny;
        if (t < minA) minA = t;
        if (t > maxA) maxA = t;
      }
      let minB = Infinity;
      let maxB = -Infinity;
      for (const v of b) {
        const t = v.x * nx + v.y * ny;
        if (t < minB) minB = t;
        if (t > maxB) maxB = t;
      }
      // Touching along an edge is not overlapping.
      const slack = 1e-9 * (Math.abs(nx) + Math.abs(ny));
      if (maxA <= minB + slack || maxB <= minA + slack) return false;
    }
  }
  return true;
}

/** Whether a circle and a convex outline overlap: the outline's edges, and the line to its nearest corner, are the only axes that can separate them. */
function circleOverlap(c: { readonly x: number; readonly y: number; readonly r: number }, polygon: readonly Pt[]): boolean {
  let nearest = polygon[0]!;
  let best = Infinity;
  for (const v of polygon) {
    const d = (v.x - c.x) ** 2 + (v.y - c.y) ** 2;
    if (d < best) {
      best = d;
      nearest = v;
    }
  }
  const axes: Array<readonly [number, number]> = [[nearest.x - c.x, nearest.y - c.y]];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!;
    const q = polygon[(i + 1) % polygon.length]!;
    axes.push([q.y - p.y, p.x - q.x]);
  }
  for (const [nx, ny] of axes) {
    const length = Math.hypot(nx, ny);
    if (length < 1e-12) continue;
    const centre = (c.x * nx + c.y * ny) / length;
    let min = Infinity;
    let max = -Infinity;
    for (const v of polygon) {
      const t = (v.x * nx + v.y * ny) / length;
      if (t < min) min = t;
      if (t > max) max = t;
    }
    if (max <= centre - c.r || min >= centre + c.r) return false;
  }
  return true;
}

/** Whether two convex areas overlap: circles and outlines alike. */
function areasOverlap(a: Prepared, b: Prepared): boolean {
  if (a.circle && b.circle) return Math.hypot(a.circle.x - b.circle.x, a.circle.y - b.circle.y) < a.circle.r + b.circle.r;
  if (a.circle) return circleOverlap(a.circle, b.outline!);
  if (b.circle) return circleOverlap(b.circle, a.outline!);
  return convexOverlap(a.outline!, b.outline!);
}

/** Whether two pieces overlap on the stage at all, where that can be told cheaply; true where it cannot. */
function overlapping(a: Prepared, b: Prepared): boolean {
  if (a.outline && b.outline) return a.convex && b.convex ? areasOverlap(a, b) : true;
  const line = a.line ?? b.line;
  const other = a.line ? b : a;
  if (line && other.outline && other.convex) {
    for (let i = 0; i + 1 < line.length; i++) if (clipSegment(line[i]!, line[i + 1]!, other.outline)) return true;
    return false;
  }
  return true;
}

export function prepare(shape: PieceShape, bias: number, view: DepthView, group: Prepared['group'] = null): Prepared | null {
  const d = view.distance;
  // A stage point as a point on the picture plane, in camera units.
  const px = (x: number) => (x - view.cx - view.panX) / view.scale;
  const py = (y: number) => -(y - view.cy - view.panY) / view.scale;
  const box = (points: readonly Pt[], pad: number) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  };
  switch (shape.kind) {
    case 'polygon': {
      const { screen, cam } = shape;
      if (screen.length < 3 || cam.length !== screen.length) return null;
      // The face's plane: Newell's normal through its middle.
      let nx = 0;
      let ny = 0;
      let nz = 0;
      let mx = 0;
      let my = 0;
      let mz = 0;
      for (let i = 0; i < cam.length; i++) {
        const a = cam[i]!;
        const b = cam[(i + 1) % cam.length]!;
        nx += (a[1] - b[1]) * (a[2] + b[2]);
        ny += (a[2] - b[2]) * (a[0] + b[0]);
        nz += (a[0] - b[0]) * (a[1] + b[1]);
        mx += a[0];
        my += a[1];
        mz += a[2];
      }
      const length = Math.hypot(nx, ny, nz);
      if (!(length > 1e-12)) return null;
      nx /= length;
      ny /= length;
      nz /= length;
      const h = (nx * mx + ny * my + nz * mz) / cam.length;
      const [zMin, zMax] = range(cam, bias);
      const depth = (x: number, y: number) => {
        const u = px(x);
        const v = py(y);
        if (d > 0) {
          // Along the ray from the eye at z = d through the picture point: c = (u w/d, v w/d, d - w).
          const denominator = (nx * u) / d + (ny * v) / d - nz;
          if (Math.abs(denominator) < 1e-9) return Number.NaN;
          return d - (h - nz * d) / denominator + bias;
        }
        if (Math.abs(nz) < 1e-9) return Number.NaN;
        return (h - nx * u - ny * v) / nz + bias;
      };
      return { ...box(screen, 0), outline: screen, convex: isConvex(screen), line: null, zMin, zMax, circle: null, group, inside: (x, y) => inPolygon(screen, x, y), depth };
    }
    case 'flat': {
      const { screen } = shape;
      if (screen.length < 3) return null;
      const at = shape.depth + bias;
      return { ...box(screen, 0), outline: screen, convex: isConvex(screen), line: null, zMin: at, zMax: at, circle: null, group, inside: (x, y) => inPolygon(screen, x, y), depth: () => at };
    }
    case 'disc': {
      const { centre, radius: r } = shape;
      if (!(r > 0)) return null;
      const [sx, sy, sz] = shape.cam;
      const r2 = shape.camRadius ** 2;
      // Drawn round the disc, so whatever touches the disc touches it.
      const outline: Pt[] = [];
      const reach = r / Math.cos(Math.PI / DISC_SIDES);
      for (let i = 0; i < DISC_SIDES; i++) {
        const a = (2 * Math.PI * i) / DISC_SIDES;
        outline.push({ x: centre.x + reach * Math.cos(a), y: centre.y + reach * Math.sin(a) });
      }
      return {
        minX: centre.x - r,
        minY: centre.y - r,
        maxX: centre.x + r,
        maxY: centre.y + r,
        outline,
        convex: true,
        line: null,
        zMin: sz - shape.camRadius + bias,
        zMax: sz + shape.camRadius + bias,
        circle: { x: centre.x, y: centre.y, r },
        group,
        inside: (x, y) => (x - centre.x) ** 2 + (y - centre.y) ** 2 <= r * r,
        depth: (x, y) => {
          // Where the view ray through the point first meets the sphere; the drawn disc
          // reaches a little past the true outline, where the ray only grazes it.
          const u = px(x);
          const v = py(y);
          if (d > 0) {
            // c = O + w e, with O the eye at z = d and e = (u/d, v/d, -1).
            const ex = u / d;
            const ey = v / d;
            const ox = -sx;
            const oy = -sy;
            const oz = d - sz;
            const a = ex * ex + ey * ey + 1;
            const b = 2 * (ex * ox + ey * oy - oz);
            const c = ox * ox + oy * oy + oz * oz - r2;
            return d - (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a) + bias;
          }
          return sz + Math.sqrt(Math.max(0, r2 - (u - sx) ** 2 - (v - sy) ** 2)) + bias;
        },
      };
    }
    case 'polyline': {
      const { screen, cam } = shape;
      if (screen.length < 2 || cam.length !== screen.length) return null;
      const [zMin, zMax] = range(cam, bias);
      return {
        ...box(screen, LINE_HALF),
        outline: null,
        convex: false,
        line: screen,
        zMin,
        zMax,
        circle: null,
        group,
        inside: (x, y) => nearest(screen, x, y).d2 <= LINE_HALF * LINE_HALF,
        depth: (x, y) => {
          const { segment, t } = nearest(screen, x, y);
          const a = cam[segment]![2];
          const b = cam[segment + 1]![2];
          return a + (b - a) * t + bias;
        },
      };
    }
  }
}

/** Two buffers of x, y pairs that clipping passes between, kept to spare the garbage collector. */
let clipIn = new Float64Array(64);
let clipOut = new Float64Array(64);

/** A polygon clipped by a convex one (Sutherland and Hodgman). */
export function clip(subject: readonly Pt[], clipper: readonly Pt[]): Pt[] {
  const turn = signedArea(clipper) >= 0 ? 1 : -1;
  // Each edge can add a corner, so room for the subject and one more per clipping edge.
  const room = 2 * (subject.length + clipper.length + 1);
  if (clipIn.length < room) {
    clipIn = new Float64Array(room * 2);
    clipOut = new Float64Array(room * 2);
  }
  let input = clipIn;
  let output = clipOut;
  let count = subject.length;
  for (let k = 0; k < count; k++) {
    input[2 * k] = subject[k]!.x;
    input[2 * k + 1] = subject[k]!.y;
  }
  for (let i = 0; i < clipper.length && count > 0; i++) {
    const a = clipper[i]!;
    const b = clipper[(i + 1) % clipper.length]!;
    const ex = turn * (b.x - a.x);
    const ey = turn * (b.y - a.y);
    let n = 0;
    for (let j = 0; j < count; j++) {
      const px = input[2 * j]!;
      const py = input[2 * j + 1]!;
      const k = j + 1 === count ? 0 : j + 1;
      const qx = input[2 * k]!;
      const qy = input[2 * k + 1]!;
      const sp = ex * (py - a.y) - ey * (px - a.x);
      const sq = ex * (qy - a.y) - ey * (qx - a.x);
      if (sp >= 0) {
        output[2 * n] = px;
        output[2 * n + 1] = py;
        n++;
      }
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        output[2 * n] = px + (qx - px) * t;
        output[2 * n + 1] = py + (qy - py) * t;
        n++;
      }
    }
    [input, output] = [output, input];
    count = n;
  }
  const result: Pt[] = [];
  for (let k = 0; k < count; k++) result.push({ x: input[2 * k]!, y: input[2 * k + 1]! });
  return result;
}

/** The area and centroid of a polygon, or null when it has none. */
export function centroid(points: readonly Pt[]): { area: number; at: Pt } | null {
  if (points.length < 3) return null;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const p = points[j]!;
    const q = points[i]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-12) return null;
  return { area: Math.abs(a) / 2, at: { x: cx / (3 * a), y: cy / (3 * a) } };
}

/** The part of a segment inside a convex polygon, as fractions along it, or null (Cyrus and Beck). */
function clipSegment(p: Pt, q: Pt, polygon: readonly Pt[]): readonly [number, number] | null {
  const turn = signedArea(polygon) >= 0 ? 1 : -1;
  let enter = 0;
  let exit = 1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const f0 = turn * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const f1 = turn * ((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x));
    if (f0 < 0 && f1 < 0) return null;
    if (f0 < 0) enter = Math.max(enter, f0 / (f0 - f1));
    else if (f1 < 0) exit = Math.min(exit, f0 / (f0 - f1));
    if (enter > exit) return null;
  }
  return [enter, exit];
}

/** What `nearer` says of pieces that overlap but are as near as each other there, such as a label on a face. */
export const EVEN = 2;

/**
 * Which of two pieces is nearer where they overlap on the stage, and how
 * surely: above 0 for `a`, below 0 for `b`; EVEN where they overlap and are
 * as near as each other; 0 where they do not overlap. At 1 or -1 the order
 * is firm: one piece is nearer all over the overlap. Between, the pieces pass
 * through each other, so each is nearer somewhere and no order shows both
 * right; the number is the share of the overlap where the winner is nearer
 * less the share where it is not, the better order to keep when nothing firm
 * says otherwise.
 */
export function nearer(a: Prepared, b: Prepared, tolerance: number): number {
  if (a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY) return 0;
  // One wholly nearer than the other: so it is wherever they overlap, if they overlap at all.
  if (a.zMin > b.zMax + tolerance) return overlapping(a, b) ? 1 : 0;
  if (b.zMin > a.zMax + tolerance) return overlapping(a, b) ? -1 : 0;
  let even = 0;
  const sign = (da: number, db: number): number => (!Number.isFinite(da) || !Number.isFinite(db) ? 0 : da > db + tolerance ? 1 : db > da + tolerance ? -1 : Number.NaN);
  /** Votes for `a` and for `b` as a signed share; firm when one side has them all, EVEN when only ties were found. */
  const share = (near: number, far: number, least: number): number => {
    if (near < least && far < least) return even >= least ? EVEN : 0;
    if (far < least) return 1;
    if (near < least) return -1;
    return (near - far) / (near + far);
  };
  if (a.line && b.line) {
    // Two lines: where they cross.
    let near = 0;
    let far = 0;
    for (let i = 0; i + 1 < a.line.length; i++) {
      const p = a.line[i]!;
      const rx = a.line[i + 1]!.x - p.x;
      const ry = a.line[i + 1]!.y - p.y;
      for (let j = 0; j + 1 < b.line.length; j++) {
        const q = b.line[j]!;
        const sx = b.line[j + 1]!.x - q.x;
        const sy = b.line[j + 1]!.y - q.y;
        const cross = rx * sy - ry * sx;
        if (Math.abs(cross) < 1e-12) continue;
        const t = ((q.x - p.x) * sy - (q.y - p.y) * sx) / cross;
        const u = ((q.x - p.x) * ry - (q.y - p.y) * rx) / cross;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const v = sign(a.depth(p.x + rx * t, p.y + ry * t), b.depth(p.x + rx * t, p.y + ry * t));
        if (v > 0) near++;
        else if (v < 0) far++;
        else if (Number.isNaN(v)) even++;
      }
    }
    return share(near, far, 1);
  }
  if (a.line || b.line) {
    // A line and a face, sphere or arrowhead: along the line where it crosses the other.
    const line = (a.line ?? b.line)!;
    const piece = a.line ? a : b;
    const other = a.line ? b : a;
    let near = 0;
    let far = 0;
    const count = (x: number, y: number, length: number) => {
      const v = sign(piece.depth(x, y), other.depth(x, y));
      if (v > 0) near += length;
      else if (v < 0) far += length;
      else if (Number.isNaN(v)) even += length;
    };
    for (let i = 0; i + 1 < line.length; i++) {
      const p = line[i]!;
      const q = line[i + 1]!;
      const length = Math.hypot(q.x - p.x, q.y - p.y);
      if (length < 1e-9) continue;
      if (other.convex) {
        const span = clipSegment(p, q, other.outline!);
        if (!span || (span[1] - span[0]) * length < 1e-6) continue;
        // Near both ends of the part inside and at its middle.
        const third = ((span[1] - span[0]) * length) / 3;
        for (const f of [1 / 6, 1 / 2, 5 / 6]) {
          const t = span[0] + (span[1] - span[0]) * f;
          count(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, third);
        }
      } else {
        const steps = Math.max(1, Math.ceil(length));
        for (let k = 0; k < steps; k++) {
          const t = (k + 0.5) / steps;
          const x = p.x + (q.x - p.x) * t;
          const y = p.y + (q.y - p.y) * t;
          if (other.inside(x, y)) count(x, y, length / steps);
        }
      }
    }
    const lineNearer = share(near, far, MIN_CROSSING);
    return a.line || lineNearer === EVEN ? lineNearer : -lineNearer;
  }
  // Two areas: compared at the middle of their overlap and near each of its corners,
  // and where those disagree, all across it.
  if (a.convex && b.convex && !areasOverlap(a, b)) return 0;
  let overlap: Pt[] | null = null;
  if (a.convex) overlap = clip(b.outline!, a.outline!);
  else if (b.convex) overlap = clip(a.outline!, b.outline!);
  if (overlap) {
    const middle = centroid(overlap);
    if (!middle || middle.area < MIN_OVERLAP) return 0;
    const { x: mx, y: my } = middle.at;
    let near = 0;
    let far = 0;
    const count = (x: number, y: number) => {
      const v = sign(a.depth(x, y), b.depth(x, y));
      if (v > 0) near++;
      else if (v < 0) far++;
      else if (Number.isNaN(v)) even++;
    };
    count(mx, my);
    for (const corner of overlap) count(mx + (corner.x - mx) * 0.9, my + (corner.y - my) * 0.9);
    if (near > 0 && far > 0) {
      // They pass through each other: how much of the overlap each is nearer across, never firm.
      sampleWithin(overlap, (x, y) => count(x, y));
      return Math.max(-0.95, Math.min(0.95, (near - far) / (near + far)));
    }
    return share(near, far, 1);
  }
  // Neither is convex: samples across their boxes' overlap.
  const minX = Math.max(a.minX, b.minX);
  const minY = Math.max(a.minY, b.minY);
  const maxX = Math.min(a.maxX, b.maxX);
  const maxY = Math.min(a.maxY, b.maxY);
  const stepX = Math.max(0.5, (maxX - minX) / 8);
  const stepY = Math.max(0.5, (maxY - minY) / 8);
  let near = 0;
  let far = 0;
  for (let y = minY + stepY / 2; y < maxY; y += stepY) {
    for (let x = minX + stepX / 2; x < maxX; x += stepX) {
      if (!a.inside(x, y) || !b.inside(x, y)) continue;
      const v = sign(a.depth(x, y), b.depth(x, y));
      if (v > 0) near++;
      else if (v < 0) far++;
      else if (Number.isNaN(v)) even++;
    }
  }
  return share(near, far, 1);
}

/** Calls `visit` at points spread over a polygon: a grid of `grid` by `grid` over its box, however thin, kept where they fall inside. */
export function sampleWithin(polygon: readonly Pt[], visit: (x: number, y: number) => void, grid = 8): void {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const stepX = Math.max(0.05, (maxX - minX) / grid);
  const stepY = Math.max(0.05, (maxY - minY) / grid);
  for (let y = minY + stepY / 2; y < maxY; y += stepY) {
    for (let x = minX + stepX / 2; x < maxX; x += stepX) if (inPolygon(polygon, x, y)) visit(x, y);
  }
}

/** A mended order, and the orders given up to break rings, as pairs of indices: the second was to be drawn after the first. */
export interface Mended {
  readonly order: readonly number[];
  readonly cut: ReadonlyArray<readonly [number, number]>;
}

/**
 * Mends a far-to-near order: wherever two pieces overlap on the stage, the
 * nearer comes later. Pieces are given in the order of their middles, which
 * stands wherever nothing overlaps; the result is that order changed as
 * little as it can be (a topological sort that always takes the earliest
 * piece it may). Where the orders form a ring, as pieces passing through each
 * other can, or three that each lie over the next, the least sure order in
 * the ring gives way. Returns null when the order of the middles already
 * stands, or the drawing is too large to mend.
 */
export function mendOrder(pieces: ReadonlyArray<Prepared | null>, tolerance: number): Mended | null {
  const found = relate(pieces, tolerance);
  return found ? orderOf(found) : null;
}

/** The orders between pieces that overlap on the stage: who is drawn after whom, and how surely. */
export interface Relations {
  readonly n: number;
  /** The first is drawn before the second; sureness from 0 (as near as each other) to 1 (firm). */
  readonly orders: ReadonlyArray<readonly [number, number, number]>;
  /** Pairs that pass through each other. */
  readonly crossing: ReadonlyArray<readonly [number, number]>;
}

/**
 * The orders between every pair that overlaps, by sweeping their boxes from
 * left to right, or only the pairs with a piece in `only`; null when there
 * are too many to afford.
 */
export function relate(pieces: ReadonlyArray<Prepared | null>, tolerance: number, only?: ReadonlySet<number>): Relations | null {
  const n = pieces.length;
  if (n < 2 || n > ORDER_PIECES) return null;
  const indices: number[] = [];
  for (let i = 0; i < n; i++) if (pieces[i]) indices.push(i);
  indices.sort((i, j) => pieces[i]!.minX - pieces[j]!.minX);
  const orders: Array<readonly [number, number, number]> = [];
  const crossing: Array<readonly [number, number]> = [];
  let pairs = 0;
  for (let s = 0; s < indices.length; s++) {
    const i = indices[s]!;
    const p = pieces[i]!;
    for (let t = s + 1; t < indices.length; t++) {
      const j = indices[t]!;
      const q = pieces[j]!;
      if (q.minX > p.maxX) break;
      if (q.minY > p.maxY || q.maxY < p.minY) continue;
      if (only && !only.has(i) && !only.has(j)) continue;
      if (p.group && q.group && p.group.solid === q.group.solid) {
        // One convex solid: turned the same way they never overlap; otherwise the face turned away is behind.
        if (p.group.facing !== q.group.facing) {
          const [first, second] = p.group.facing < 0 ? [i, j] : [j, i];
          orders.push([first, second, 1]);
        }
        continue;
      }
      if (++pairs > ORDER_PAIRS) return null;
      const relation = nearer(p, q, tolerance);
      if (relation === 0) continue;
      // The nearer is drawn after the other; pieces as near as each other keep the order of their middles, least surely of all.
      const [first, second] = relation === EVEN ? [Math.min(i, j), Math.max(i, j)] : relation > 0 ? [j, i] : [i, j];
      const sure = relation === EVEN ? 0 : Math.abs(relation);
      orders.push([first, second, sure]);
      if (sure > 0 && sure < 1) crossing.push([i, j]);
    }
  }
  return { n, orders, crossing };
}

/**
 * The order of the middles mended to keep every order in `relations`, as
 * little changed as it can be; null when it already keeps them.
 */
export function orderOf(relations: Relations): Mended | null {
  const { n } = relations;
  /** For each piece, the pieces drawn after it and before it, each with how sure the order is. */
  const after: Array<Array<readonly [number, number]>> = Array.from({ length: n }, () => []);
  const before: Array<Array<readonly [number, number]>> = Array.from({ length: n }, () => []);
  const waiting = new Int32Array(n);
  let backward = false;
  for (const [first, second, sure] of relations.orders) {
    after[first]!.push([second, sure]);
    before[second]!.push([first, sure]);
    waiting[second]!++;
    if (first > second) backward = true;
  }
  if (!backward) return null;
  // Kahn's algorithm, always taking the earliest piece that may go next.
  const heap: number[] = [];
  const push = (value: number) => {
    heap.push(value);
    let k = heap.length - 1;
    while (k > 0) {
      const parent = (k - 1) >> 1;
      if (heap[parent]! <= value) break;
      heap[k] = heap[parent]!;
      k = parent;
    }
    heap[k] = value;
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      let k = 0;
      for (;;) {
        const left = 2 * k + 1;
        if (left >= heap.length) break;
        const right = left + 1;
        const child = right < heap.length && heap[right]! < heap[left]! ? right : left;
        if (heap[child]! >= last) break;
        heap[k] = heap[child]!;
        k = child;
      }
      heap[k] = last;
    }
    return top;
  };
  const done = new Uint8Array(n);
  /** Orders dropped to break rings, as first * n + second. */
  const dropped = new Set<number>();
  const cut: Array<readonly [number, number]> = [];
  for (let i = 0; i < n; i++) if (waiting[i] === 0) push(i);
  const order: number[] = [];
  while (order.length < n) {
    if (heap.length === 0) breakRing();
    const i = pop();
    done[i] = 1;
    order.push(i);
    for (const [j] of after[i]!) {
      if (done[j] || dropped.has(i * n + j)) continue;
      if (--waiting[j]! === 0) push(j);
    }
  }
  return { order, cut };

  /**
   * Every piece left waits on another left, so they wait in a ring: walk back
   * from the earliest, along the least sure orders, until a piece comes round
   * again, and drop the least sure order of that ring; again until a piece is
   * free.
   */
  function breakRing(): void {
    while (heap.length === 0) {
      let start = 0;
      while (done[start]) start++;
      const seen = new Map<number, number>();
      const path: number[] = [];
      let at = start;
      for (;;) {
        seen.set(at, path.length);
        path.push(at);
        let back: readonly [number, number] | null = null;
        for (const edge of before[at]!) {
          if (done[edge[0]] || dropped.has(edge[0] * n + at)) continue;
          if (!back || edge[1] < back[1]) back = edge;
        }
        if (!back) break;
        at = back[0];
        if (seen.has(at)) break;
      }
      // The ring, walked backwards: ring[k] waits on ring[k + 1], and the last on the first.
      const ring = seen.has(at) && path.length > 1 ? path.slice(seen.get(at)) : [];
      let drop: readonly [number, number, number] | null = null;
      for (let k = 0; k < ring.length; k++) {
        const second = ring[k]!;
        const first = ring[(k + 1) % ring.length]!;
        const edge = before[second]!.find(([f]) => f === first && !dropped.has(first * n + second));
        if (edge && (!drop || edge[1] < drop[2])) drop = [first, second, edge[1]];
      }
      if (!drop) {
        // No ring found: the earliest piece goes now.
        waiting[start] = 0;
        push(start);
        return;
      }
      const [first, second] = drop;
      dropped.add(first * n + second);
      cut.push([first, second]);
      if (--waiting[second]! === 0) push(second);
    }
  }
}
