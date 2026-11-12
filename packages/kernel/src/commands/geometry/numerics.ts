/**
 * Exact-enough small determinants, stable solvers and scale-aware helpers shared
 * by every geometry rule (points-lines 3.3, 3.4). Pure functions; the only tolerance
 * comes from the caller (resolved from the rule context by `tolOf`).
 */
import type { Tol, V2 } from './types';

export const EPS = 2.220446049250313e-16;
export const TAU = Math.PI * 2;

/** The shared tolerance, resolved from the rule context (plus an optional per-call override). */
export function tolOf(tol: number, override?: number): Tol {
  const t = override !== undefined ? override : tol;
  const sane = typeof t === 'number' && t > 0 && Number.isFinite(t) ? t : 1e-9;
  return { eq: sane, on: sane, parallel: sane, far: 1e14 };
}

/* ------------------------------ 2x2 determinants ------------------------------ */

/** Split constant for Dekker's two-product (2^27 + 1). */
const SPLIT = 134217729;

/** Error-free product: x*y = p + e with |e| <= EPS*|p|. */
function twoProduct(x: number, y: number): { p: number; e: number } {
  const p = x * y;
  const cx = SPLIT * x;
  const hx = cx - (cx - x);
  const lx = x - hx;
  const cy = SPLIT * y;
  const hy = cy - (cy - y);
  const ly = y - hy;
  const e = lx * ly - (p - hx * hy - lx * hy - hx * ly);
  return { p, e };
}

/**
 * det [[a,b],[c,d]] accurate to about 1 ulp, with a rounding bound (points-lines 3.4).
 * Non-finite inputs give value NaN and err Infinity.
 */
export function det2(a: number, b: number, c: number, d: number): { value: number; err: number } {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
    return { value: NaN, err: Infinity };
  }
  const p1 = twoProduct(a, d);
  const p2 = twoProduct(b, c);
  const value = p1.p - p2.p;
  // Compensation for the subtraction plus the product errors, with slack.
  const err = 4 * EPS * (Math.abs(p1.p) + Math.abs(p2.p)) + Math.abs(p1.e) + Math.abs(p2.e);
  return { value, err };
}

export interface OrientResult {
  readonly sign: -1 | 0 | 1;
  readonly value: number;
  readonly err: number;
}

/** Orientation of r relative to the directed line p->q. sign = 0 only when rounding cannot decide. */
export function orient(p: V2, q: V2, r: V2): OrientResult {
  const d = det2(q.x - p.x, q.y - p.y, r.x - p.x, r.y - p.y);
  if (d.value !== d.value) return { sign: 0, value: NaN, err: Infinity };
  if (Math.abs(d.value) <= d.err) return { sign: 0, value: d.value, err: d.err };
  return { sign: d.value > 0 ? 1 : -1, value: d.value, err: d.err };
}

/* ------------------------------ vector helpers ------------------------------ */

export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y });
export const dot = (a: V2, b: V2): number => a.x * b.x + a.y * b.y;
export const cross = (a: V2, b: V2): number => a.x * b.y - a.y * b.x;
export const norm2 = (a: V2): number => Math.hypot(a.x, a.y);
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.y - b.y);

export const isFinitePt = (p: V2): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);

/** True when every coordinate is finite and below 1e150 (points-lines 10.4). */
export const isSanePt = (p: V2): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) < 1e150 && Math.abs(p.y) < 1e150;

export const isSaneNum = (v: number): boolean => Number.isFinite(v) && Math.abs(v) < 1e150;

/** Relative equality: |a-b| <= t*max(1,|a|,|b|). */
export const relEq = (a: number, b: number, t: number): boolean =>
  a === b || Math.abs(a - b) <= t * Math.max(1, Math.abs(a), Math.abs(b));

/** Whole-number test (within 1e-9). */
export const isWhole = (v: number): boolean =>
  Number.isFinite(v) && Math.abs(v - Math.round(v)) <= 1e-9 * Math.max(1, Math.abs(v));

/** Wrap into [0, 2*pi). */
export function wrapTau(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r === 0 ? 0 : r;
}

/** Wrap into (-pi, pi]. */
export function wrapPi(a: number): number {
  const r = ((a + Math.PI) % TAU + TAU) % TAU;
  return r <= 0 ? Math.PI : r - Math.PI;
}

/**
 * cos/sin with exact quarter turns (polygons-transforms 6.3): within 4*EPS*|t|
 * of a multiple of pi/2 the values snap to 0, 1 or -1.
 */
export function sincos(t: number): { c: number; s: number } {
  const q = Math.round((t / Math.PI) * 2);
  if (Math.abs(t - (q * Math.PI) / 2) <= 4 * EPS * Math.max(1, Math.abs(t))) {
    const k = ((q % 4) + 4) % 4;
    if (k === 0) return { c: 1, s: 0 };
    if (k === 1) return { c: 0, s: 1 };
    if (k === 2) return { c: -1, s: 0 };
    return { c: 0, s: -1 };
  }
  return { c: Math.cos(t), s: Math.sin(t) };
}

/* ------------------------------ stable polynomial solvers ------------------------------ */

export type QuadRoots =
  | { readonly kind: 'two'; readonly s1: number; readonly s2: number; readonly tangent: boolean }
  | { readonly kind: 'one'; readonly s: number }
  | { readonly kind: 'none' };

/**
 * Stable pair form for a*s^2 + 2*b*s + c = 0 (points-lines 4.3).
 * Roots ascend. Near-zero discriminant (relative 64*EPS) counts as tangent.
 */
export function solveStable(a: number, b: number, c: number, cScale = 0): QuadRoots {
  if (!(a === a && b === b && c === c)) return { kind: 'none' };
  if (a === 0) {
    if (b === 0) return { kind: 'none' };
    return { kind: 'one', s: -c / (2 * b) };
  }
  const disc = b * b - a * c;
  // `cScale` is the size of the terms that add up to c: a point that sits on the conic has c near 0 yet carries their rounding error.
  const tol = 64 * EPS * (b * b + Math.abs(a) * Math.max(Math.abs(c), cScale));
  if (disc < -tol) return { kind: 'none' };
  if (Math.abs(disc) <= tol) return { kind: 'two', s1: -b / a, s2: -b / a, tangent: true };
  const q = -(b + (b >= 0 ? Math.sqrt(disc) : -Math.sqrt(disc)));
  if (q === 0) return { kind: 'two', s1: 0, s2: -c / a, tangent: false };
  const r1 = q / a;
  const r2 = c / q;
  return r1 <= r2
    ? { kind: 'two', s1: r1, s2: r2, tangent: false }
    : { kind: 'two', s1: r2, s2: r1, tangent: false };
}

/** Stable form for A*s^2 + B*s + C = 0. Roots ascend. */
export function solveQuad(A: number, B: number, C: number): QuadRoots {
  if (!(A === A && B === B && C === C)) return { kind: 'none' };
  if (A === 0) {
    if (B === 0) return { kind: 'none' };
    return { kind: 'one', s: -C / B };
  }
  const disc = B * B - 4 * A * C;
  const tol = 64 * EPS * (B * B + Math.abs(4 * A * C));
  if (disc < -tol) return { kind: 'none' };
  if (Math.abs(disc) <= tol) return { kind: 'two', s1: -B / (2 * A), s2: -B / (2 * A), tangent: true };
  const q = -(B + (B >= 0 ? Math.sqrt(disc) : -Math.sqrt(disc))) / 2;
  if (q === 0) return { kind: 'two', s1: 0, s2: -C / A, tangent: false };
  const r1 = q / A;
  const r2 = C / q;
  return r1 <= r2
    ? { kind: 'two', s1: r1, s2: r2, tangent: false }
    : { kind: 'two', s1: r2, s2: r1, tangent: false };
}

/** All real roots of a*t^3 + b*t^2 + c*t + d = 0, ascending (trigonometric/Cardano hybrid). */
export function cubicRealRoots(a: number, b: number, c: number, d: number): number[] {
  if (a === 0) {
    const q = solveQuad(b, c, d);
    if (q.kind === 'two') return q.s1 === q.s2 ? [q.s1] : [q.s1, q.s2];
    if (q.kind === 'one') return [q.s];
    return [];
  }
  const bn = b / a;
  const cn = c / a;
  const dn = d / a;
  const p = cn - (bn * bn) / 3;
  const q = (2 * bn * bn * bn) / 27 - (bn * cn) / 3 + dn;
  const shift = -bn / 3;
  const disc = (q * q) / 4 + (p * p * p) / 27;
  const out: number[] = [];
  if (disc > 0) {
    const sd = Math.sqrt(disc);
    const u = Math.cbrt(-q / 2 + sd);
    const v = Math.cbrt(-q / 2 - sd);
    out.push(u + v + shift);
  } else if (p === 0) {
    out.push(shift);
  } else {
    const r = 2 * Math.sqrt(-p / 3);
    const phi = Math.acos(Math.min(1, Math.max(-1, (-q / 2) / Math.sqrt((-p / 3) * (-p / 3) * (-p / 3)))));
    for (let k = 0; k < 3; k++) out.push(r * Math.cos((phi + TAU * k) / 3) + shift);
    out.sort((x, y) => x - y);
  }
  // Polish each root with Newton on the cubic.
  for (let i = 0; i < out.length; i++) {
    let t = out[i] as number;
    for (let k = 0; k < 8; k++) {
      const f = ((t + bn) * t + cn) * t + dn;
      const df = (3 * t + 2 * bn) * t + cn;
      if (df === 0) break;
      const nt = t - f / df;
      if (nt === t) break;
      t = nt;
    }
    out[i] = t;
  }
  return out;
}

/** Brent's method on [a, b] with f(a)*f(b) <= 0. Up to 60 iterations. */
export function brent(f: (x: number) => number, a: number, b: number): number {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return (a + b) / 2;
  if (Math.abs(fa) < Math.abs(fb)) {
    const t = a;
    a = b;
    b = t;
    const tf = fa;
    fa = fb;
    fb = tf;
  }
  let c = a;
  let fc = fa;
  let d = b - a;
  for (let i = 0; i < 60; i++) {
    if (fb === 0 || Math.abs(b - a) < 1e-14 * Math.max(1, Math.abs(b))) return b;
    if (fa !== fc && fb !== fc) {
      const s1 = (a * fb * fc) / ((fa - fb) * (fa - fc));
      const s2 = (b * fa * fc) / ((fb - fa) * (fb - fc));
      const s3 = (c * fa * fb) / ((fc - fa) * (fc - fb));
      const s = s1 + s2 + s3;
      const ok =
        (s - (3 * a + b) / 4) * (s - b) < 0 &&
        (i < 2 || Math.abs(s - b) < Math.abs(b - c) / 2) &&
        (i < 2 || Math.abs(b - c) < Math.abs(c - d));
      d = ok ? b - s : (a - b) / 2;
      c = b;
      fc = fb;
      b = ok ? s : b + d;
    } else {
      const s = b - (fb * (b - a)) / (fb - fa);
      const ok = (s - (3 * a + b) / 4) * (s - b) < 0 && (i < 2 || Math.abs(s - b) < Math.abs(b - c) / 2);
      d = ok ? b - s : (a - b) / 2;
      c = b;
      fc = fb;
      b = ok ? s : b + d;
    }
    fb = f(b);
    if (fa * fb > 0) {
      a = c;
      fa = fc;
    }
    if (Math.abs(fa) < Math.abs(fb)) {
      const t = a;
      a = b;
      b = t;
      const tf = fa;
      fa = fb;
      fb = tf;
    }
    if (d === 0) return b;
  }
  return b;
}

/* ------------------------------ deterministic hashing ------------------------------ */

/**
 * Deterministic uniform in [0, 1) for a (seed, stream) pair (RandomIn;
 * same hash family as the language's `rand`, with an independent stream).
 */
const hashDv = new DataView(new ArrayBuffer(16));
export function hashRand(seed: number, stream: number): number {
  const s = Number.isFinite(seed) ? seed : 0;
  hashDv.setFloat64(0, s + 0, true);
  hashDv.setFloat64(8, stream * 0.6180339887498949 + 0.4142135623730951, true);
  let h =
    hashDv.getUint32(0, true) ^
    Math.imul(hashDv.getUint32(4, true), 0x9e3779b1) ^
    Math.imul(hashDv.getUint32(8, true), 0x85ebca6b) ^
    Math.imul(hashDv.getUint32(12, true), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* ------------------------------ polynomial fit and roots ------------------------------ */

/**
 * Least-squares fit of degree `deg` through (xs, ys) (normal equations +
 * Gaussian elimination with partial pivoting). Returns coefficients highest
 * power first, or undefined when singular.
 */
export function polyFit(xs: readonly number[], ys: readonly number[], deg: number): number[] | undefined {
  const n = deg + 1;
  const m: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j <= n; j++) row.push(0);
    m.push(row);
  }
  for (let k = 0; k < xs.length; k++) {
    const x = xs[k] as number;
    const y = ys[k] as number;
    const pw: number[] = [1];
    for (let i = 1; i <= 2 * deg; i++) pw.push((pw[i - 1] as number) * x);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) (m[i] as number[])[j] = ((m[i] as number[])[j] as number) + (pw[i + j] as number);
      (m[i] as number[])[n] = ((m[i] as number[])[n] as number) + (pw[i] as number) * y;
    }
  }
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs((m[r] as number[])[c] as number) > Math.abs((m[piv] as number[])[c] as number)) piv = r;
    }
    if ((m[piv] as number[])[c] === 0) return undefined;
    const tmp = m[c] as number[];
    m[c] = m[piv] as number[];
    m[piv] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = ((m[r] as number[])[c] as number) / (((m[c] as number[])[c] as number) || 1);
      for (let j = c; j <= n; j++) {
        (m[r] as number[])[j] = ((m[r] as number[])[j] as number) - f * ((m[c] as number[])[j] as number);
      }
    }
  }
  const lowFirst: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = (m[i] as number[])[i] as number;
    if (d === 0) return undefined;
    lowFirst.push(((m[i] as number[])[n] as number) / d);
  }
  return lowFirst.reverse();
}

/** Durand-Kerner roots of a polynomial (highest power first); real ones, ascending. */
export function polyRoots(coeffs: readonly number[]): number[] {
  const c = [...coeffs];
  while (c.length > 1 && c[0] === 0) c.shift();
  const deg = c.length - 1;
  if (deg <= 0) return [];
  if (deg === 1) return [-(c[1] as number) / (c[0] as number)];
  if (deg === 2) {
    const q = solveQuad(c[0] as number, c[1] as number, c[2] as number);
    if (q.kind === 'two') return q.s1 === q.s2 ? [q.s1] : [q.s1, q.s2];
    if (q.kind === 'one') return [q.s];
    return [];
  }
  if (deg === 3) return cubicRealRoots(c[0] as number, c[1] as number, c[2] as number, c[3] as number);
  const evalP = (x: number): number => {
    let v = 0;
    for (const k of c) v = v * x + k;
    return v;
  };
  // Durand-Kerner in complex arithmetic (Aberth starts on a circle).
  const zr: number[] = [];
  const zi: number[] = [];
  const lead = c[0] as number;
  for (let i = 0; i < deg; i++) {
    const a = (TAU * i) / deg + 0.3;
    zr.push(0.4 * Math.cos(a));
    zi.push(0.4 * Math.sin(a));
  }
  const evalC = (x: number, y: number): [number, number] => {
    let rx = 0;
    let ry = 0;
    for (const k of c) {
      const nx = rx * x - ry * y + k;
      ry = rx * y + ry * x;
      rx = nx;
    }
    return [rx / lead, ry / lead];
  };
  for (let it = 0; it < 200; it++) {
    let done = true;
    for (let i = 0; i < deg; i++) {
      const [px, py] = evalC(zr[i] as number, zi[i] as number);
      let dx = 1;
      let dy = 0;
      for (let j = 0; j < deg; j++) {
        if (j === i) continue;
        const ax = (zr[i] as number) - (zr[j] as number);
        const ay = (zi[i] as number) - (zi[j] as number);
        const nx = dx * ax - dy * ay;
        dy = dx * ay + dy * ax;
        dx = nx;
      }
      const den = dx * dx + dy * dy;
      if (den === 0) continue;
      const step = Math.hypot(px, py) / Math.sqrt(den);
      if (step > 1e-14) done = false;
      zr[i] = (zr[i] as number) - (px * dx + py * dy) / den;
      zi[i] = (zi[i] as number) - (py * dx - px * dy) / den;
    }
    if (done) break;
  }
  const out: number[] = [];
  for (let i = 0; i < deg; i++) {
    if (Math.abs(zi[i] as number) < 1e-10 * Math.max(1, Math.abs(zr[i] as number))) {
      const x = zr[i] as number;
      if (Math.abs(evalP(x)) < 1e-8 * Math.max(1, Math.abs(x) ** deg)) out.push(x);
    }
  }
  return out.sort((a, b) => a - b);
}