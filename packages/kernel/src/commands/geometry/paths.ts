/**
 * Limited and unlimited paths (points-lines 3.2, conics 3.5): everything a point
 * can ride or an intersection can be filtered by. Built from primitive data so
 * this module never imports the conic classifiers (conics.ts builds on it).
 */
import type { FunctionValue } from '../../language/runtime';
import type { CentralFrame, GeomCurveValue, ParabolaFrame, Path, V2 } from './types';
import { EPS, TAU, cubicRealRoots, wrapPi } from './numerics';

/* ------------------------------ line-likes ------------------------------ */

/**
 * Line a*x + b*y = c with a^2 + b^2 = 1. s in maths units along (b, -a), measured from `origin` (a point on the line;
 * the foot of the origin when absent). The normalised parameter counts in units of `len`, the defining vector length
 * (points-lines 3.2); `len` is 1 for a line given by an equation.
 */
export function linePath(a: number, b: number, c: number, origin?: V2, len = 1): Path {
  const dx = b;
  const dy = -a;
  const foot = { x: a * c, y: b * c };
  // s0: where `origin` sits along the direction from the foot.
  const s0 = origin ? (origin.x - foot.x) * dx + (origin.y - foot.y) * dy : 0;
  const unit = len > 0 && Number.isFinite(len) ? len : 1;
  return {
    kind: 'line',
    closed: false,
    domain: [-Infinity, Infinity],
    at: (s) => ({ x: foot.x + (s + s0) * dx, y: foot.y + (s + s0) * dy }),
    tangent: () => ({ x: dx, y: dy }),
    project: (p) => {
      const t = (p.x - foot.x) * dx + (p.y - foot.y) * dy;
      const qx = foot.x + t * dx;
      const qy = foot.y + t * dy;
      return { s: t - s0, dist: Math.hypot(p.x - qx, p.y - qy) };
    },
    norm: (s) => 0.5 + Math.atan(s / unit) / Math.PI,
    unnorm: (u) => unit * Math.tan(Math.PI * (u - 0.5)),
  };
}

/** Ray from `from` along unit `dir`. s >= 0 in maths units; the normalised parameter counts in units of `len`. */
export function rayPath(from: V2, dir: V2, len = 1): Path {
  const unit = len > 0 && Number.isFinite(len) ? len : 1;
  return {
    kind: 'ray',
    closed: false,
    domain: [0, Infinity],
    at: (s) => ({ x: from.x + s * dir.x, y: from.y + s * dir.y }),
    tangent: () => ({ ...dir }),
    project: (p) => {
      const s = Math.max(0, (p.x - from.x) * dir.x + (p.y - from.y) * dir.y);
      return { s, dist: Math.hypot(p.x - from.x - s * dir.x, p.y - from.y - s * dir.y) };
    },
    norm: (s) => (2 / Math.PI) * Math.atan(Math.max(0, s) / unit),
    unnorm: (u) => unit * Math.tan((Math.PI / 2) * Math.min(1, Math.max(0, u))),
  };
}

/** Segment a->b. s in [0, 1]. */
export function segmentPath(a: V2, b: V2): Path {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const len = Math.sqrt(len2);
  const ux = len > 0 ? dx / len : 1;
  const uy = len > 0 ? dy / len : 0;
  return {
    kind: 'segment',
    closed: false,
    domain: [0, 1],
    at: (s) => ({ x: a.x + s * dx, y: a.y + s * dy }),
    tangent: () => (len > 0 ? { x: ux, y: uy } : undefined),
    project: (p) => {
      const s = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      return { s, dist: Math.hypot(p.x - a.x - s * dx, p.y - a.y - s * dy) };
    },
    norm: (s) => s,
    unnorm: (u) => u,
  };
}

/* ------------------------------ circles and ellipses ------------------------------ */

/** Circle: s = global polar angle about the centre in (-pi, pi]. */
export function circlePath(cx: number, cy: number, r: number): Path {
  return {
    kind: 'circle',
    closed: true,
    domain: [-Math.PI, Math.PI],
    at: (s) => ({ x: cx + r * Math.cos(s), y: cy + r * Math.sin(s) }),
    tangent: (s) => (r > 0 ? { x: -Math.sin(s), y: Math.cos(s) } : undefined),
    project: (p, hint) => {
      if (!(r > 0)) return { s: 0, dist: Math.hypot(p.x - cx, p.y - cy) };
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (dx === 0 && dy === 0) return { s: hint ?? 0, dist: r };
      return { s: Math.atan2(dy, dx), dist: Math.abs(Math.hypot(dx, dy) - r) };
    },
    norm: (s) => (s + Math.PI) / TAU,
    unnorm: (u) => u * TAU - Math.PI,
  };
}

/**
 * Ellipse with a central frame (conics 3.5). s = global polar angle about the
 * centre: it depends on nothing but the centre, so points riding on it survive
 * circle crossings and rotations of the shape.
 */
export function ellipsePath(f: CentralFrame): Path {
  const ax = Math.atan2(f.uy, f.ux);
  const a2 = f.a * f.a;
  const b2 = f.b * f.b;
  const radiusAt = (s: number): number => {
    const d = s - ax;
    const cs = Math.cos(d);
    const sn = Math.sin(d);
    const q = (cs * cs) / a2 + (sn * sn) / b2;
    return q > 0 ? 1 / Math.sqrt(q) : 0;
  };
  return {
    kind: 'ellipse',
    closed: true,
    domain: [-Math.PI, Math.PI],
    at: (s) => {
      const r = radiusAt(s);
      return { x: f.cx + r * Math.cos(s), y: f.cy + r * Math.sin(s) };
    },
    tangent: (s) => numericTangent((t) => ({ x: f.cx + radiusAt(t) * Math.cos(t), y: f.cy + radiusAt(t) * Math.sin(t) }), s),
    project: (p, hint) => projectEllipse(f, p, hint),
    norm: (s) => (s + Math.PI) / TAU,
    unnorm: (u) => u * TAU - Math.PI,
  };
}

/** Nearest point on an ellipse by the monotone root method (conics 3.5). */
function projectEllipse(f: CentralFrame, p: V2, hint?: number): { s: number; dist: number } {
  const rx = p.x - f.cx;
  const ry = p.y - f.cy;
  const nx = -f.uy;
  const ny = f.ux;
  const X = rx * f.ux + ry * f.uy;
  const Y = rx * nx + ry * ny;
  const a = f.a;
  const b = f.b;
  const tiny = 64 * EPS * Math.max(a, b, 1);
  if (Math.abs(X) < tiny && Math.abs(Y) < tiny) {
    // The centre: nearest are the minor vertices; hint breaks the tie.
    if (hint !== undefined) return { s: hint, dist: b };
    return { s: Math.atan2(ny, nx), dist: b };
  }
  const a2 = a * a;
  const b2 = b * b;
  const c0 = a * X;
  const c1 = b * Y;
  const g = (t: number): number => {
    const u0 = c0 / (t + a2);
    const u1 = c1 / (t + b2);
    return u0 * u0 + u1 * u1 - 1;
  };
  const lo = -b2 + tiny * Math.max(1, b);
  if (g(lo) <= 0) {
    // On-axis case: nearest is a vertex.
    const cands: V2[] = [
      { x: a, y: 0 },
      { x: -a, y: 0 },
      { x: 0, y: b },
      { x: 0, y: -b },
    ];
    let best = cands[0] as V2;
    let bd = Infinity;
    for (const q of cands) {
      const d = Math.hypot(X - q.x, Y - q.y);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    const gx = f.cx + best.x * f.ux + best.y * nx;
    const gy = f.cy + best.x * f.uy + best.y * ny;
    return { s: Math.atan2(gy - f.cy, gx - f.cx), dist: bd };
  }
  let hi = a2 + b2 + Math.abs(c0) + Math.abs(c1) + 1;
  for (let i = 0; i < 100 && g(hi) > 0; i++) hi *= 2;
  let low = lo;
  let high = hi;
  let t = (lo + hi) / 2;
  for (let i = 0; i < 60; i++) {
    const gv = g(t);
    const gp = -2 * ((c0 * c0) / Math.pow(t + a2, 3) + (c1 * c1) / Math.pow(t + b2, 3));
    let nt = gp !== 0 ? t - gv / gp : (low + high) / 2;
    if (!(nt > low && nt < high)) nt = (low + high) / 2;
    t = nt;
    if (g(t) > 0) low = t;
    else high = t;
    if (high - low < 1e-15 * Math.max(1, Math.abs(t))) break;
  }
  const qx = (a2 * X) / (t + a2);
  const qy = (b2 * Y) / (t + b2);
  const gx = f.cx + qx * f.ux + qy * nx;
  const gy = f.cy + qx * f.uy + qy * ny;
  return { s: Math.atan2(gy - f.cy, gx - f.cx), dist: Math.hypot(p.x - gx, p.y - gy) };
}

/* ------------------------------ parabolas and hyperbolas ------------------------------ */

/** Parabola: V + u*n + (u^2/2p)*axis (conics 3.5). */
export function parabolaPath(f: ParabolaFrame): Path {
  const nx = -f.uy;
  const ny = f.ux;
  const at = (u: number): V2 => {
    const k = (u * u) / (2 * f.p);
    return { x: f.vx + u * nx + k * f.ux, y: f.vy + u * ny + k * f.uy };
  };
  return {
    kind: 'parabola',
    closed: false,
    domain: [-Infinity, Infinity],
    at,
    tangent: (u) => {
      const tx = nx + (u / f.p) * f.ux;
      const ty = ny + (u / f.p) * f.uy;
      const l = Math.hypot(tx, ty);
      return l > 0 ? { x: tx / l, y: ty / l } : undefined;
    },
    project: (p) => {
      const rx = p.x - f.vx;
      const ry = p.y - f.vy;
      const al = rx * nx + ry * ny;
      const be = rx * f.ux + ry * f.uy;
      const roots = cubicRealRoots(1, 0, 2 * f.p * (f.p - be), -2 * f.p * f.p * al);
      let bs = 0;
      let bd = Infinity;
      const cands = roots.length > 0 ? roots : [0];
      for (const u of cands) {
        const q = at(u);
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < bd) {
          bd = d;
          bs = u;
        }
      }
      return { s: bs, dist: bd };
    },
    norm: (u) => 0.5 + Math.atan(u / f.p) / Math.PI,
    unnorm: (v) => f.p * Math.tan(Math.PI * (v - 0.5)),
  };
}

/**
 * Hyperbola: branch 1 on raw s in [-1, 1] (w = tan(pi*s/2)), branch 2 on
 * (1, 2) and (-2, -1). Branch 1 normalises to (0, 0.5), branch 2 to (0.5, 1).
 */
export function hyperbolaPath(f: CentralFrame): Path {
  const nx = -f.uy;
  const ny = f.ux;
  const branchOf = (s: number): { br: 1 | 2; w: number } => {
    if (s >= -1 && s <= 1) return { br: 1, w: Math.tan((Math.PI * s) / 2) };
    if (s > 1) {
      const z = 2 * (s - 1.5);
      const zc = Math.min(1 - 1e-12, Math.max(-1 + 1e-12, z));
      return { br: 2, w: Math.tan((Math.PI * zc) / 2) };
    }
    const z = 2 * (s + 1.5);
    const zc = Math.min(1 - 1e-12, Math.max(-1 + 1e-12, z));
    return { br: 2, w: Math.tan((Math.PI * zc) / 2) };
  };
  const atW = (br: 1 | 2, w: number): V2 => {
    const wc = Math.min(30, Math.max(-30, w));
    const sg = br === 1 ? 1 : -1;
    const x = sg * f.a * Math.cosh(wc);
    const y = f.b * Math.sinh(wc);
    return { x: f.cx + x * f.ux + y * nx, y: f.cy + x * f.uy + y * ny };
  };
  return {
    kind: 'hyperbola',
    closed: false,
    domain: [-2, 2],
    at: (s) => {
      const { br, w } = branchOf(Math.min(2 - 1e-9, Math.max(-2 + 1e-9, s)));
      return atW(br, w);
    },
    tangent: (s) => numericTangent((t) => atW(branchOf(t).br, branchOf(t).w), s),
    project: (p, hint) => projectHyperbola(f, p, hint, atW),
    norm: (s) => {
      const { br, w } = branchOf(s);
      return (br === 1 ? 0.25 : 0.75) + Math.atan(w) / TAU;
    },
    unnorm: (u) => {
      if (u < 0.5) {
        const w = Math.tan(TAU * (u - 0.25));
        return (2 / Math.PI) * Math.atan(w);
      }
      const w = Math.tan(TAU * (u - 0.75));
      return 1.5 + Math.atan(w) / Math.PI;
    },
  };
}

function projectHyperbola(
  f: CentralFrame,
  p: V2,
  hint: number | undefined,
  atW: (br: 1 | 2, w: number) => V2,
): { s: number; dist: number } {
  const rx = p.x - f.cx;
  const ry = p.y - f.cy;
  const nx = -f.uy;
  const ny = f.ux;
  const X = rx * f.ux + ry * f.uy;
  const Y = rx * nx + ry * ny;
  let best: { br: 1 | 2; w: number; d: number } = { br: 1, w: 0, d: Infinity };
  for (const br of [1, 2] as const) {
    const sg = br === 1 ? 1 : -1;
    // Sampled starts, then Newton polish on d^2/dw^2 = 0.
    const starts: number[] = [0, 1, -1, 2, -2, 3, -3];
    if (hint !== undefined) starts.push(hintToW(hint, br));
    if (Number.isFinite(Y / f.b)) starts.push(Math.asinh(Math.min(1e6, Math.max(-1e6, Y / f.b))));
    for (const w0 of starts) {
      let w = w0;
      for (let i = 0; i < 25; i++) {
        const wc = Math.min(30, Math.max(-30, w));
        const ch = Math.cosh(wc);
        const sh = Math.sinh(wc);
        const px = sg * f.a * ch - X;
        const py = f.b * sh - Y;
        const g = px * sg * f.a * sh + py * f.b * ch;
        const h =
          (sg * f.a * sh) * (sg * f.a * sh) +
          px * sg * f.a * ch +
          (f.b * ch) * (f.b * ch) +
          py * f.b * sh;
        if (h === 0) break;
        const nw = w - g / h;
        if (!Number.isFinite(nw)) break;
        if (Math.abs(nw - w) < 1e-13 * Math.max(1, Math.abs(w))) {
          w = nw;
          break;
        }
        w = nw;
      }
      const q = atW(br, w);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < best.d) best = { br, w, d };
    }
  }
  const s = best.br === 1 ? (2 / Math.PI) * Math.atan(best.w) : 1.5 + Math.atan(best.w) / Math.PI;
  return { s, dist: best.d };
}

function hintToW(hint: number, br: 1 | 2): number {
  return Math.tan(TAU * (br === 1 ? hint - 0.25 : hint - 0.75));
}

/* ------------------------------ arcs ------------------------------ */

/** An arc: carrier circle/ellipse path restricted to [from, from+sweep] in polar angle. */
export function arcPath(carrier: Path, from: number, sweep: number): Path {
  const lo = from;
  const hi = from + sweep;
  const full = sweep >= TAU - 1e-12;
  return {
    kind: 'arc',
    closed: full,
    domain: [lo, hi],
    at: (s) => carrier.at(wrapPi(s)),
    tangent: (s) => carrier.tangent(wrapPi(s)),
    project: (p, hint) => {
      const pr = carrier.project(p, hint);
      let s = pr.s;
   
      // Bring into [lo, hi] by full turns when the carrier angle is outside.
      while (s < lo - Math.PI) s += TAU;
      while (s > hi + Math.PI) s -= TAU;
      const c = Math.min(hi, Math.max(lo, s));
      const q = carrier.at(wrapPi(c));
      return { s: c, dist: Math.hypot(p.x - q.x, p.y - q.y) };
    },
    norm: (s) => (sweep > 0 ? (s - lo) / sweep : 0),
    unnorm: (u) => lo + Math.min(1, Math.max(0, u)) * sweep,
  };
}

/* ------------------------------ polylines and polygons ------------------------------ */

/** Open polyline: raw s in [0, 1] by arc-length fraction. */
export function polylinePath(pts: readonly V2[]): Path {
  const cum = cumulative(pts, false);
  const total = cum[cum.length - 1] ?? 0;
  const atFrac = (f: number): V2 => {
    if (total === 0 || pts.length === 0) return { ...(pts[0] ?? { x: 0, y: 0 }) };
    const target = Math.min(1, Math.max(0, f)) * total;
    let i = 0;
    while (i + 1 < cum.length - 1 && (cum[i + 1] as number) < target) i++;
    const c0 = cum[i] as number;
    const c1 = cum[i + 1] as number;
    const t = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
    const a = pts[i] as V2;
    const b = pts[i + 1] as V2;
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };
  return {
    kind: 'polyline',
    closed: false,
    domain: [0, 1],
    at: atFrac,
    tangent: (s) => {
      if (total === 0) return undefined;
      const target = Math.min(1, Math.max(0, s)) * total;
      let i = 0;
      while (i + 1 < cum.length - 1 && (cum[i + 1] as number) < target) i++;
      const a = pts[i] as V2;
      const b = pts[i + 1] as V2;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      return l > 0 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : undefined;
    },
    project: (p, hint) => projectPolyline(pts, cum, total, p, hint),
    norm: (s) => s,
    unnorm: (u) => u,
  };
}

/** Closed polygon boundary: raw s in [0, 1] by arc-length fraction. */
export function polygonPath(pts: readonly V2[]): Path {
  const cum = cumulative(pts, true);
  const total = cum[cum.length - 1] ?? 0;
  const atFrac = (f: number): V2 => {
    if (total === 0 || pts.length === 0) return { ...(pts[0] ?? { x: 0, y: 0 }) };
    const target = (((f % 1) + 1) % 1) * total;
    let i = 0;
    while (i + 1 < cum.length - 1 && (cum[i + 1] as number) < target) i++;
    const c0 = cum[i] as number;
    const c1 = cum[i + 1] as number;
    const t = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
    const a = pts[i % pts.length] as V2;
    const b = pts[(i + 1) % pts.length] as V2;
    return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
  };
  return {
    kind: 'polygon',
    closed: true,
    domain: [0, 1],
    at: atFrac,
    tangent: (s) => {
      if (total === 0) return undefined;
      const target = (((s % 1) + 1) % 1) * total;
      let i = 0;
      while (i + 1 < cum.length - 1 && (cum[i + 1] as number) < target) i++;
      const a = pts[i % pts.length] as V2;
      const b = pts[(i + 1) % pts.length] as V2;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      return l > 0 ? { x: (b.x - a.x) / l, y: (b.y - a.y) / l } : undefined;
    },
    project: (p, hint) => projectPolygon(pts, cum, total, p, hint),
    norm: (s) => s,
    unnorm: (u) => u,
  };
}

function cumulative(pts: readonly V2[], closed: boolean): number[] {
  const cum: number[] = [0];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i] as V2;
    const b = pts[(i + 1) % pts.length] as V2;
    cum.push((cum[cum.length - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return cum;
}

function projectPolyline(
  pts: readonly V2[], cum: readonly number[], total: number, p: V2, hint?: number,
): { s: number; dist: number } {
  let bs = 0;
  let bd = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as V2;
    const b = pts[i + 1] as V2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    const s = total > 0 ? (((cum[i] as number) + t * ((cum[i + 1] as number) - (cum[i] as number))) / total) : 0;
    const better = d < bd - 1e-12 || (hint !== undefined && Math.abs(d - bd) <= 1e-12 && Math.abs(s - hint) < Math.abs(bs - hint));
    if (better) {
      bd = d;
      bs = s;
    }
  }
  return { s: bs, dist: bd };
}

function projectPolygon(
  pts: readonly V2[], cum: readonly number[], total: number, p: V2, hint?: number,
): { s: number; dist: number } {
  let bs = 0;
  let bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as V2;
    const b = pts[(i + 1) % pts.length] as V2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    const s = total > 0 ? (((cum[i] as number) + t * ((cum[i + 1] as number) - (cum[i] as number))) / total) : 0;
    const better = d < bd - 1e-12 || (hint !== undefined && Math.abs(d - bd) <= 1e-12 && Math.abs(s - hint) < Math.abs(bs - hint));
    if (better) {
      bd = d;
      bs = s;
    }
  }
  return { s: bs, dist: bd };
}

/* ------------------------------ functions and curves ------------------------------ */

/**
 * Function graph: raw x in (-inf, inf). at() can return non-finite coords
 * where f is undefined; callers must validate.
 */
export function functionPath(f: FunctionValue): Path {
  const ev = (x: number): number | undefined => {
    const v = f.call1 ? f.call1(x) : f.call(x);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  return {
    kind: 'function',
    closed: false,
    domain: [-Infinity, Infinity],
    at: (x) => {
      const y = ev(x);
      return { x, y: y ?? NaN };
    },
    tangent: (x) => {
      const y = ev(x);
      if (y === undefined) return undefined;
      const h = 1e-7 * Math.max(1, Math.abs(x));
      const y1 = ev(x + h);
      const y0 = ev(x - h);
      if (y0 === undefined || y1 === undefined) return undefined;
      const d = (y1 - y0) / (2 * h);
      const l = Math.hypot(1, d);
      return { x: 1 / l, y: d / l };
    },
    project: (p, hint) => {
      // Coarse sample at 128 points in u-space, then Newton polish on d^2.
      let bx = hint !== undefined ? Math.tan(Math.PI * (hint - 0.5)) : 0;
      let bd = Infinity;
      for (let i = 0; i < 128; i++) {
        const u = (i + 0.5) / 128;
        const x = Math.tan(Math.PI * (u - 0.5));
        const y = ev(x);
        if (y === undefined) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) {
          bd = d;
          bx = x;
        }
      }
      if (!Number.isFinite(bx)) return { s: 0, dist: Infinity };
      let x = bx;
      for (let i = 0; i < 20; i++) {
        const y = ev(x);
        if (y === undefined) break;
        const h = 1e-7 * Math.max(1, Math.abs(x));
        const ya = ev(x + h);
        const yb = ev(x - h);
        if (ya === undefined || yb === undefined) break;
        const d = (ya - yb) / (2 * h);
        const d2 = (ya - 2 * y + yb) / (h * h);
        const g = -2 * (p.x - x) - 2 * (p.y - y) * d;
        const hess = 2 + 2 * d * d - 2 * (p.y - y) * d2;
        if (hess === 0) break;
        const nx = x - g / hess;
        if (!Number.isFinite(nx)) break;
        if (Math.abs(nx - x) < 1e-12 * Math.max(1, Math.abs(x))) {
          x = nx;
          break;
        }
        x = nx;
      }
      const y = ev(x);
      if (y === undefined) return { s: bx, dist: bd };
      return { s: x, dist: Math.hypot(p.x - x, p.y - y) };
    },
    norm: (x) => 0.5 + Math.atan(x) / Math.PI,
    unnorm: (u) => Math.tan(Math.PI * (u - 0.5)),
  };
}

/** Sampled curve: raw s in [0, 1] by piece fraction. */
export function curvePath(c: GeomCurveValue): Path {
  const lengths: number[] = [];
  let total = 0;
  for (const piece of c.pieces) {
    let L = 0;
    for (let i = 0; i + 1 < piece.length; i++) {
      L += Math.hypot((piece[i + 1] as V2).x - (piece[i] as V2).x, (piece[i + 1] as V2).y - (piece[i] as V2).y);
    }
    lengths.push(L);
    total += L;
  }
  const atFrac = (f: number): V2 => {
    const target = Math.min(1, Math.max(0, f)) * total;
    let acc = 0;
    for (let k = 0; k < c.pieces.length; k++) {
      const piece = c.pieces[k] as V2[];
      const L = lengths[k] as number;
      if (target <= acc + L || k === c.pieces.length - 1) {
        let rest = target - acc;
        for (let i = 0; i + 1 < piece.length; i++) {
          const a = piece[i] as V2;
          const b = piece[i + 1] as V2;
          const sl = Math.hypot(b.x - a.x, b.y - a.y);
          if (rest <= sl || i + 2 === piece.length) {
            const t = sl > 0 ? rest / sl : 0;
            return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
          }
          rest -= sl;
        }
        return { ...(piece[piece.length - 1] as V2) };
      }
      acc += L;
    }
    const last = c.pieces[c.pieces.length - 1] as V2[];
    return { ...(last[last.length - 1] as V2) };
  };
  return {
    kind: 'curve',
    closed: c.closed,
    domain: [0, 1],
    at: atFrac,
    tangent: (s) => numericTangent(atFrac, s),
    project: (p, hint) => {
      let bs = 0;
      let bd = Infinity;
      let acc = 0;
      for (let k = 0; k < c.pieces.length; k++) {
        const piece = c.pieces[k] as V2[];
        const L = lengths[k] as number;
        for (let i = 0; i + 1 < piece.length; i++) {
          const a = piece[i] as V2;
          const b = piece[i + 1] as V2;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len2 = dx * dx + dy * dy;
          const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
          const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
          const sl = Math.hypot(dx, dy);
          const s = total > 0 ? (acc + t * sl) / total : 0;
          const better = d < bd - 1e-12 || (hint !== undefined && Math.abs(d - bd) <= 1e-12 && Math.abs(s - hint) < Math.abs(bs - hint));
          if (better) {
            bd = d;
            bs = s;
          }
        }
        acc += L;
      }
      return { s: bs, dist: bd };
    },
    norm: (s) => s,
    unnorm: (u) => u,
  };
}

/** Central-difference unit tangent with step 1e-7 relative. */
function numericTangent(at: (s: number) => V2, s: number): V2 | undefined {
  const h = 1e-7 * Math.max(1, Math.abs(s));
  const a = at(s - h);
  const b = at(s + h);
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return undefined;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  return l > 0 ? { x: dx / l, y: dy / l } : undefined;
}