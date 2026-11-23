/**
 * Shape fixing (design 7.3): a rough hand-drawn stroke becomes a clean shape. Our own code. An open stroke is a straight
 * line, else an arrow (a line that ends in a head). A closed stroke looks for its corners first: with 3 to 6 clear
 * corners (each turns the pen by more than 45 degrees) it is a polygon (a rectangle when it has four right angles),
 * unless a circle or ellipse is a closer fit, so a drawn pentagon is a pentagon and a drawn circle stays a circle;
 * a closed stroke with no such corners is tried as a circle or ellipse. A fit is kept only when the mean distance from
 * the stroke to the clean shape is under 6% of the shape's size (`FIT_MAX`). No DOM, no timers, no `Date`.
 */
import { distToSegmentSq, wrapAngle } from '../math2d';

/** The largest mean distance from the stroke to the clean shape, as a fraction of the shape's size. */
export const FIT_MAX = 0.06;

export type Recognised =
  | { readonly kind: 'line'; readonly fit: number; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
  | { readonly kind: 'arrow'; readonly fit: number; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
  | { readonly kind: 'ellipse'; readonly fit: number; readonly cx: number; readonly cy: number; readonly w: number; readonly h: number }
  | { readonly kind: 'rect'; readonly fit: number; readonly cx: number; readonly cy: number; readonly w: number; readonly h: number; readonly rotation: number }
  | { readonly kind: 'polygon'; readonly fit: number; readonly points: readonly number[] };

const SAMPLES = 64;

/** A corner is clear when the pen turns by more than this at it. */
const CORNER_TURN = Math.PI / 4;

/** `n` points along the polyline, equally spaced by the length walked. */
function resample(xy: ArrayLike<number>, n: number): number[] {
  const count = Math.floor(xy.length / 2);
  const cum: number[] = [0];
  for (let i = 1; i < count; i++) {
    cum.push((cum[i - 1] as number) + Math.hypot((xy[i * 2] as number) - (xy[(i - 1) * 2] as number), (xy[i * 2 + 1] as number) - (xy[(i - 1) * 2 + 1] as number)));
  }
  const total = cum[count - 1] as number;
  const out: number[] = [];
  if (total <= 0) return out;
  let seg = 1;
  for (let k = 0; k < n; k++) {
    const at = (total * k) / (n - 1);
    while (seg < count - 1 && (cum[seg] as number) < at) seg++;
    const a = cum[seg - 1] as number;
    const b = cum[seg] as number;
    const t = b > a ? (at - a) / (b - a) : 0;
    out.push((xy[(seg - 1) * 2] as number) + t * ((xy[seg * 2] as number) - (xy[(seg - 1) * 2] as number)), (xy[(seg - 1) * 2 + 1] as number) + t * ((xy[seg * 2 + 1] as number) - (xy[(seg - 1) * 2 + 1] as number)));
  }
  return out;
}

const pathLength = (xy: ArrayLike<number>): number => {
  let len = 0;
  for (let i = 1; i < Math.floor(xy.length / 2); i++) len += Math.hypot((xy[i * 2] as number) - (xy[(i - 1) * 2] as number), (xy[i * 2 + 1] as number) - (xy[(i - 1) * 2 + 1] as number));
  return len;
};

/** The indices of the Douglas-Peucker simplification of the polyline `xy` with tolerance `eps`. */
function simplify(xy: ArrayLike<number>, eps: number): number[] {
  const n = Math.floor(xy.length / 2);
  if (n < 3) return n === 0 ? [] : [0, n - 1];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  const e2 = eps * eps;
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegmentSq(xy[i * 2] as number, xy[i * 2 + 1] as number, xy[a * 2] as number, xy[a * 2 + 1] as number, xy[b * 2] as number, xy[b * 2 + 1] as number);
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > e2 && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i] === 1) out.push(i);
  return out;
}

/** The mean distance from the points to the closed or open polyline `ring`. */
function meanDistance(points: readonly number[], ring: readonly number[], closed: boolean): number {
  const n = Math.floor(ring.length / 2);
  const last = closed ? n : n - 1;
  let sum = 0;
  const count = points.length / 2;
  for (let p = 0; p < count; p++) {
    let best = Infinity;
    for (let i = 0; i < last; i++) {
      const j = (i + 1) % n;
      const d = distToSegmentSq(points[p * 2] as number, points[p * 2 + 1] as number, ring[i * 2] as number, ring[i * 2 + 1] as number, ring[j * 2] as number, ring[j * 2 + 1] as number);
      if (d < best) best = d;
    }
    sum += Math.sqrt(best);
  }
  return count === 0 ? Infinity : sum / count;
}

function tryLine(pts: readonly number[], length: number): Recognised | undefined {
  const n = pts.length / 2;
  const x0 = pts[0] as number;
  const y0 = pts[1] as number;
  const x1 = pts[(n - 1) * 2] as number;
  const y1 = pts[(n - 1) * 2 + 1] as number;
  const chord = Math.hypot(x1 - x0, y1 - y0);
  if (chord < 1e-6 || length > chord * 1.25) return undefined;
  const fit = meanDistance(pts, [x0, y0, x1, y1], false) / chord;
  return fit < FIT_MAX ? { kind: 'line', fit, x0, y0, x1, y1 } : undefined;
}

function tryEllipse(pts: readonly number[]): Recognised | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i] as number);
    maxX = Math.max(maxX, pts[i] as number);
    minY = Math.min(minY, pts[i + 1] as number);
    maxY = Math.max(maxY, pts[i + 1] as number);
  }
  let w = maxX - minX;
  let h = maxY - minY;
  if (w < 1e-6 || h < 1e-6 || Math.min(w, h) / Math.max(w, h) < 0.15) return undefined;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const circle = Math.abs(w - h) / Math.max(w, h) < 0.12;
  if (circle) {
    w = (w + h) / 2;
    h = w;
  }
  let sum = 0;
  const count = pts.length / 2;
  for (let i = 0; i < count; i++) {
    const dx = (pts[i * 2] as number) - cx;
    const dy = (pts[i * 2 + 1] as number) - cy;
    const rho = Math.sqrt((dx / (w / 2)) ** 2 + (dy / (h / 2)) ** 2);
    // the distance along the ray from the middle to the ellipse, which is close to the distance to the ellipse
    sum += rho === 0 ? Math.min(w, h) / 2 : Math.abs(rho - 1) * (Math.hypot(dx, dy) / rho);
  }
  const fit = sum / count / ((w + h) / 2);
  return fit < FIT_MAX ? { kind: 'ellipse', fit, cx, cy, w, h } : undefined;
}

/** The interior angle at `b` between `a` and `c`, in radians. */
function angleAt(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const u = Math.atan2(ay - by, ax - bx);
  const v = Math.atan2(cy - by, cx - bx);
  return Math.abs(wrapAngle(u - v));
}

function tryPolygon(xy: ArrayLike<number>, pts: readonly number[], diag: number): Recognised | undefined {
  // the stroke closed on itself, simplified: each vertex that is left is a corner
  const n = Math.floor(xy.length / 2);
  const ring: number[] = [];
  for (let i = 0; i < n; i++) ring.push(xy[i * 2] as number, xy[i * 2 + 1] as number);
  ring.push(xy[0] as number, xy[1] as number);
  const idx = simplify(ring, diag * 0.05);
  const corners: number[] = [];
  for (let k = 0; k < idx.length - 1; k++) corners.push(ring[(idx[k] as number) * 2] as number, ring[(idx[k] as number) * 2 + 1] as number);
  // corners closer than 8% of the size are one corner
  const merged: number[] = [];
  for (let i = 0; i < corners.length; i += 2) {
    const px = merged[merged.length - 2];
    const py = merged[merged.length - 1];
    if (px !== undefined && py !== undefined && Math.hypot((corners[i] as number) - px, (corners[i + 1] as number) - py) < diag * 0.08) continue;
    merged.push(corners[i] as number, corners[i + 1] as number);
  }
  if (merged.length >= 4 && Math.hypot((merged[0] as number) - (merged[merged.length - 2] as number), (merged[1] as number) - (merged[merged.length - 1] as number)) < diag * 0.08) merged.length -= 2;
  dropStraight(merged);
  const k = merged.length / 2;
  if (k < 3 || k > 6) return undefined;
  const fit = meanDistance(pts, merged, true) / diag;
  if (fit >= FIT_MAX) return undefined;
  if (k === 4) {
    const right = [0, 1, 2, 3].every((i) => {
      const a = merged.slice(((i + 3) % 4) * 2, ((i + 3) % 4) * 2 + 2);
      const b = merged.slice(i * 2, i * 2 + 2);
      const c = merged.slice(((i + 1) % 4) * 2, ((i + 1) % 4) * 2 + 2);
      return Math.abs(angleAt(a[0] as number, a[1] as number, b[0] as number, b[1] as number, c[0] as number, c[1] as number) - Math.PI / 2) < (16 * Math.PI) / 180;
    });
    const side = (i: number): number => Math.hypot((merged[((i + 1) % 4) * 2] as number) - (merged[i * 2] as number), (merged[((i + 1) % 4) * 2 + 1] as number) - (merged[i * 2 + 1] as number));
    if (right && Math.abs(side(0) - side(2)) / Math.max(side(0), side(2)) < 0.2 && Math.abs(side(1) - side(3)) / Math.max(side(1), side(3)) < 0.2) {
      let w = (side(0) + side(2)) / 2;
      let h = (side(1) + side(3)) / 2;
      let rotation = Math.atan2((merged[3] as number) - (merged[1] as number), (merged[2] as number) - (merged[0] as number));
      // the turn is kept between -45 and 45 degrees; a larger one is the same rectangle with its sides swapped
      if (rotation > Math.PI / 4) {
        rotation -= Math.PI / 2;
        [w, h] = [h, w];
      } else if (rotation <= -Math.PI / 4) {
        rotation += Math.PI / 2;
        [w, h] = [h, w];
      }
      if (Math.abs(rotation) < (4 * Math.PI) / 180) rotation = 0;
      const cx = ((merged[0] as number) + (merged[2] as number) + (merged[4] as number) + (merged[6] as number)) / 4;
      const cy = ((merged[1] as number) + (merged[3] as number) + (merged[5] as number) + (merged[7] as number)) / 4;
      return { kind: 'rect', fit, cx, cy, w, h, rotation };
    }
  }
  return { kind: 'polygon', fit, points: merged };
}

/** The pen turns by less than this at a point that is no corner but only a point on a side. */
const STRAIGHT_TURN = Math.PI / 9;

/** Takes the points that lie on a side (the pen turns by under 20 degrees there) out of the closed polygon `xy`, the flattest first. */
function dropStraight(xy: number[]): void {
  for (;;) {
    const n = xy.length / 2;
    if (n <= 3) return;
    let flattest = -1;
    let least = STRAIGHT_TURN;
    for (let i = 0; i < n; i++) {
      const a = ((i + n - 1) % n) * 2;
      const b = i * 2;
      const c = ((i + 1) % n) * 2;
      const turn = Math.PI - angleAt(xy[a] as number, xy[a + 1] as number, xy[b] as number, xy[b + 1] as number, xy[c] as number, xy[c + 1] as number);
      if (turn < least) {
        least = turn;
        flattest = i;
      }
    }
    if (flattest < 0) return;
    xy.splice(flattest * 2, 2);
  }
}

/** True when every corner of the closed polygon `xy` turns the pen by more than 45 degrees. */
function clearCorners(xy: readonly number[]): boolean {
  const n = xy.length / 2;
  for (let i = 0; i < n; i++) {
    const a = ((i + n - 1) % n) * 2;
    const b = i * 2;
    const c = ((i + 1) % n) * 2;
    const turn = Math.PI - angleAt(xy[a] as number, xy[a + 1] as number, xy[b] as number, xy[b + 1] as number, xy[c] as number, xy[c + 1] as number);
    if (turn <= CORNER_TURN) return false;
  }
  return true;
}

/** The mean distance from the stroke to the clean shape, in the stroke's own units (a fit is a fraction of the shape's size). */
function meanOff(r: Recognised, diag: number): number {
  return r.kind === 'ellipse' ? r.fit * ((r.w + r.h) / 2) : r.fit * diag;
}

function tryArrow(xy: ArrayLike<number>, length: number, diag: number): Recognised | undefined {
  const idx = simplify(xy, diag * 0.05);
  if (idx.length < 3 || idx.length > 7) return undefined;
  const at = (k: number): { x: number; y: number } => ({ x: xy[(idx[k] as number) * 2] as number, y: xy[(idx[k] as number) * 2 + 1] as number });
  const tail = at(0);
  const tip = at(1);
  const shaft = Math.hypot(tip.x - tail.x, tip.y - tail.y);
  if (shaft < length * 0.4) return undefined;
  // after the tip the pen stays near the tip: the two strokes of the head
  let headLength = 0;
  for (let k = 2; k < idx.length; k++) {
    const p = at(k);
    if (Math.hypot(p.x - tip.x, p.y - tip.y) > shaft * 0.5) return undefined;
    headLength += Math.hypot(p.x - at(k - 1).x, p.y - at(k - 1).y);
  }
  if (headLength < shaft * 0.25) return undefined;
  const upTo = (idx[1] as number) + 1;
  const shaftPts = resample(Array.from({ length: upTo * 2 }, (_, i) => xy[i] as number), SAMPLES);
  if (shaftPts.length === 0) return undefined;
  const fit = meanDistance(shaftPts, [tail.x, tail.y, tip.x, tip.y], false) / shaft;
  return fit < FIT_MAX ? { kind: 'arrow', fit, x0: tail.x, y0: tail.y, x1: tip.x, y1: tip.y } : undefined;
}

/**
 * The clean shape for a stroke of page points `[x0, y0, x1, y1, …]`, or undefined when no shape fits within 6%.
 * Strokes shorter than 4 units across or with fewer than 8 points are never fixed.
 */
export function recogniseStroke(xy: ArrayLike<number>): Recognised | undefined {
  const count = Math.floor(xy.length / 2);
  if (count < 8) return undefined;
  for (let i = 0; i < xy.length; i++) if (!Number.isFinite(xy[i] as number)) return undefined;
  const length = pathLength(xy);
  const pts = resample(xy, SAMPLES);
  if (pts.length === 0 || length < 4) return undefined;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    minX = Math.min(minX, pts[i] as number);
    maxX = Math.max(maxX, pts[i] as number);
    minY = Math.min(minY, pts[i + 1] as number);
    maxY = Math.max(maxY, pts[i + 1] as number);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (diag < 4) return undefined;
  const gap = Math.hypot((xy[0] as number) - (xy[(count - 1) * 2] as number), (xy[1] as number) - (xy[(count - 1) * 2 + 1] as number));
  const closed = gap <= length * 0.25;
  if (!closed) return tryLine(pts, length) ?? tryArrow(xy, length, diag);
  const polygon = tryPolygon(xy, pts, diag);
  const ellipse = tryEllipse(pts);
  if (polygon === undefined || ellipse === undefined) return polygon ?? ellipse;
  // the corners come first; the ellipse keeps a stroke it fits more closely than the corners do (a circle has no clear corners)
  const clear = polygon.kind === 'rect' || (polygon.kind === 'polygon' && clearCorners(polygon.points));
  return clear && meanOff(polygon, diag) <= meanOff(ellipse, diag) ? polygon : ellipse;
}
