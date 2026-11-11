/**
 * Conics (docs/features/conics/design.md sections 3-7): the matrix form, native
 * frames, classification, constructors, properties, polars and curvature.
 * Line-conic and conic-conic intersections live in intersect.ts.
 */
import type {
  CentralFrame,
  ConicKind,
  ConicValue,
  HLine,
  ParabolaFrame,
  Path,
  Quad,
  V2,
} from './types';
import { isCircleV, isConicV } from './types';
import { EPS, TAU, det2, dist, norm2, solveQuad } from './numerics';
import { circlePath, ellipsePath, hyperbolaPath, linePath, parabolaPath } from './paths';

/* ------------------------------ 3x3 matrix ------------------------------ */

export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

/** M = [[A, B/2, D/2], [B/2, C, E/2], [D/2, E/2, F]]. */
export function matOf(q: Quad): Mat3 {
  return [q.A, q.B / 2, q.D / 2, q.B / 2, q.C, q.E / 2, q.D / 2, q.E / 2, q.F];
}

export function quadOf(m: Mat3): Quad {
  return { A: m[0], B: 2 * m[1], C: m[4], D: 2 * m[2], E: 2 * m[5], F: m[8] };
}

export function det3(m: Mat3): number {
  const [a, b, c, d, e, f, g, h, i] = m;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

export function frob3(m: Mat3): number {
  return Math.sqrt(
    m[0] * m[0] + 2 * m[1] * m[1] + 2 * m[2] * m[2] + m[4] * m[4] + 2 * m[5] * m[5] + m[8] * m[8],
  );
}

/** Adjugate (transposed cofactor matrix). */
export function adj3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [
    e * i - f * h,
    c * h - b * i,
    b * f - c * e,
    f * g - d * i,
    a * i - c * g,
    c * d - a * f,
    d * h - e * g,
    b * g - a * h,
    a * e - b * d,
  ];
}

export function matVec3(m: Mat3, x: number, y: number, w: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * w,
    m[3] * x + m[4] * y + m[5] * w,
    m[6] * x + m[7] * y + m[8] * w,
  ];
}

export function matMul3(a: Mat3, b: Mat3): Mat3 {
  const o: number[] = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] =
        (a[r * 3] as number) * (b[c] as number) +
        (a[r * 3 + 1] as number) * (b[3 + c] as number) +
        (a[r * 3 + 2] as number) * (b[6 + c] as number);
    }
  }
  return o as unknown as Mat3;
}

export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** Value of the conic form at (x, y). */
export function conicAt(q: Quad, x: number, y: number): number {
  return (q.A * x + q.B * y + q.D) * x + (q.C * y + q.E) * y + q.F;
}

/** Gradient of the conic form at (x, y). */
export function conicGrad(q: Quad, x: number, y: number): V2 {
  return { x: 2 * q.A * x + q.B * y + q.D, y: q.B * x + 2 * q.C * y + q.E };
}

const isCentralFrame = (f: CentralFrame | ParabolaFrame): f is CentralFrame =>
  (f as CentralFrame).cx !== undefined;

function normLine(a: number, b: number, c: number): HLine {
  const l = Math.hypot(a, b);
  if (!(l > 0)) return { a: 1, b: 0, c: 0 };
  return { a: a / l, b: b / l, c: c / l };
}

/* ------------------------------ classification (conics 3.3) ------------------------------ */

export interface Classified {
  readonly q: Quad;
  readonly kind: ConicKind;
  readonly frame?: CentralFrame | ParabolaFrame;
  readonly margin: number;
  readonly lines?: readonly [HLine, HLine?];
  readonly point?: V2;
}

/**
 * Scale, classify and frame a Quad. All thresholds are relative (to the
 * unit-norm matrix or the eigenvalues); `tol` is the figure tolerance.
 */
export function classifyQuad(q: Quad, tol: number): Classified | { fail: 'degenerate_conic' | 'not_finite' } {
  const vals = [q.A, q.B, q.C, q.D, q.E, q.F];
  if (!vals.every((v) => Number.isFinite(v))) return { fail: 'not_finite' };
  if (!vals.every((v) => Math.abs(v) < 1e150)) return { fail: 'not_finite' };
  let m = matOf(q);
  const n = frob3(m);
  if (!(n > 0)) return { fail: 'degenerate_conic' };
  m = m.map((v) => v / n) as unknown as Mat3;
  const qq = quadOf(m);
  const rho = Math.min(1e-6, Math.max(1e-14, tol * 0.1));
  const A = qq.A;
  const B = qq.B;
  const C = qq.C;
  const D = qq.D;
  const E = qq.E;
  const F = qq.F;

  // Linear case: quadratic part vanishes.
  const qMax = Math.max(Math.abs(A), Math.abs(B), Math.abs(C));
  if (qMax <= rho) {
    if (Math.hypot(D, E) <= rho) {
      return Math.abs(F) <= rho ? { fail: 'degenerate_conic' } : makeKind(qq, 'empty', 0);
    }
    return { ...makeKind(qq, 'line', 1), lines: [normLine(D, E, -F)] };
  }

  const delta = det2(A, B / 2, B / 2, C).value;
  const Delta = det3(m);
  const tr = A + C;
  const disc = Math.sqrt(Math.max(0, (A - C) * (A - C) + B * B));
  // Larger-magnitude eigenvalue first; the other as delta/lambda (no cancellation).
  let lBig = (tr + (tr >= 0 ? disc : -disc)) / 2;
  if (lBig === 0) lBig = (tr - (tr >= 0 ? disc : -disc)) / 2;
  const lSmall = lBig !== 0 ? delta / lBig : 0;
  const lMax = Math.max(Math.abs(lBig), Math.abs(lSmall));
  const rhoP = tol * lMax * lMax;

  // Rank of M.
  const minors = [
    Math.abs(m[0] * m[4] - m[1] * m[1]),
    Math.abs(m[0] * m[8] - m[2] * m[2]),
    Math.abs(m[4] * m[8] - m[5] * m[5]),
  ];
  const rank = Math.abs(Delta) > rho ? 3 : (minors[0] as number) > rho || (minors[1] as number) > rho || (minors[2] as number) > rho ? 2 : 1;

  if (rank === 1) {
    // Double line: direction from the quadratic part, offset from the linear part.
    const line = doubleLineOf(qq);
    return { ...makeKind(qq, 'double', Math.abs(Delta)), lines: [line] };
  }
  if (rank === 2) {
    if (delta < -rhoP) {
      const lines = splitPair(m);
      const pt = pairPoint(m);
      const out: Classified = { ...makeKind(qq, 'lines', Math.min(Math.abs(Delta), Math.abs(delta) / Math.max(lMax * lMax, EPS))), lines };
      if (pt) return { ...out, point: pt };
      return out;
    }
    if (delta > rhoP) {
      const pt = singletonOf(m);
      const out: Classified = { ...makeKind(qq, 'point', Math.min(Math.abs(Delta), Math.abs(delta) / Math.max(lMax * lMax, EPS))) };
      if (pt) return { ...out, point: pt };
      return out;
    }
    const lines = parallelLinesOf(qq);
    if (lines) return { ...makeKind(qq, 'parallel', Math.abs(Delta)), lines };
    return makeKind(qq, 'empty', 0);
  }
  // Rank 3.
  if (Math.abs(delta) <= rhoP) return parabolaFrom(qq, m, tol);
  if (delta > 0) {
    if (Delta * tr < 0) {
      const gap = Math.abs(lBig - lSmall) / Math.max(lMax, EPS);
      if (gap <= Math.max(1e-12, tol * 0.1)) return centralFrom(qq, m, 'circle', tol);
      return centralFrom(qq, m, 'ellipse', tol);
    }
    return makeKind(qq, 'empty', 0);
  }
  return centralFrom(qq, m, 'hyperbola', tol);
}

function makeKind(q: Quad, kind: ConicKind, margin: number): Classified {
  return { q, kind, margin: Math.min(1, Math.max(0, margin)) };
}

/**
 * Central frame. NOTE (doc conflict, conics 3.3 step 5): the doc says both
 * "major direction is the eigenvector of the larger-magnitude eigenvalue" and
 * "a^2 = -D/(d*l_a) with l_a the smaller-magnitude eigenvalue (the longer
 * axis)". Only the second is right (x^2/9 + y^2/4 = 1 has the major axis on
 * the smaller eigenvalue 1/9), so the major axis uses the smaller-magnitude
 * eigenvalue here.
 */
function centralFrom(qq: Quad, m: Mat3, kind: 'circle' | 'ellipse' | 'hyperbola', tol: number): Classified {
  const A = qq.A;
  const B = qq.B;
  const C = qq.C;
  const D = qq.D;
  const E = qq.E;
  const delta = det2(A, B / 2, B / 2, C).value;
  const Delta = det3(m);
  const tr = A + C;
  const disc = Math.sqrt(Math.max(0, (A - C) * (A - C) + B * B));
  const lp = (tr + disc) / 2;
  const lm = (tr - disc) / 2;
  const Fp = Delta / delta; // value at the centre
  const s1 = -Fp / lp;
  const s2 = -Fp / lm;
  let a2: number;
  let b2: number;
  let la: number;
  if (kind === 'hyperbola') {
    // Exactly one of s1, s2 is positive: the transverse axis.
    if (s1 > 0 && s2 <= 0) {
      a2 = s1;
      b2 = -s2;
      la = lp;
    } else if (s2 > 0 && s1 <= 0) {
      a2 = s2;
      b2 = -s1;
      la = lm;
    } else {
      return makeKind(qq, 'empty', 0);
    }
  } else {
    if (!(s1 > 0 && s2 > 0)) return makeKind(qq, 'empty', 0);
    if (s1 >= s2) {
      a2 = s1;
      b2 = s2;
      la = lp;
    } else {
      a2 = s2;
      b2 = s1;
      la = lm;
    }
  }
  // Eigenvector for la: perpendicular to the first row (A - la, B/2).
  let ux = -B / 2;
  let uy = A - la;
  if (Math.hypot(ux, uy) <= 1e-12 * Math.max(1, Math.abs(A) + Math.abs(B) + Math.abs(C))) {
    // Multiple eigenvalue (circle): any direction; use the theta convention.
    const th = 0.5 * Math.atan2(B, A - C);
    ux = Math.cos(th);
    uy = Math.sin(th);
  }
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul;
  uy /= ul;
  if (ux < -1e-12 || (Math.abs(ux) <= 1e-12 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  const cx = (B * E - 2 * C * D) / (4 * delta);
  const cy = (B * D - 2 * A * E) / (4 * delta);
  const lMax = Math.max(Math.abs(lp), Math.abs(lm));
  const margin = Math.min(
    Math.abs(delta) / Math.max(lMax * lMax, EPS),
    Math.abs(Delta),
    Math.abs(lp - lm) / Math.max(lMax, EPS),
  );
  void tol;
  return {
    ...makeKind(qq, kind, margin),
    frame: { cx, cy, ux, uy, a: Math.sqrt(a2), b: Math.sqrt(Math.max(0, b2)) },
  };
}

function parabolaFrom(qq: Quad, _m: Mat3, _tol: number): Classified {
  void _m;
  void _tol;
  const A = qq.A;
  const B = qq.B;
  const C = qq.C;
  const D = qq.D;
  const E = qq.E;
  const F = qq.F;
  const tr = A + C;
  // Null eigenvector of S: perpendicular to the larger row.
  const r0 = Math.hypot(A, B / 2);
  const r1 = Math.hypot(B / 2, C);
  let ux: number;
  let uy: number;
  if (r0 >= r1) {
    ux = -B / 2;
    uy = A;
  } else {
    ux = -C;
    uy = B / 2;
  }
  const ul = Math.hypot(ux, uy);
  if (!(ul > 0)) return makeKind(qq, 'empty', 0);
  ux /= ul;
  uy /= ul;
  if (ux < -1e-12 || (Math.abs(ux) <= 1e-12 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  const nx = -uy;
  const ny = ux;
  const mu = tr; // the non-zero eigenvalue
  if (!(Math.abs(mu) > 0)) return makeKind(qq, 'empty', 0);
  const lx = (D * ux + E * uy) / 2;
  const ly = (D * nx + E * ny) / 2;
  if (!(Math.abs(lx) > 0)) return makeKind(qq, 'empty', 0);
  const y0 = -ly / mu;
  const x0 = -(F - (ly * ly) / mu) / lx;
  const p = Math.abs(lx / mu);
  // Vertex in global coords: solve V from its frame coords (x0 along u, y0 along n).
  // Any particular solution of the linear part works: V = x0*u + y0*n adjusted
  // by walking from the origin.
  const vx = x0 * ux + y0 * nx;
  const vy = x0 * uy + y0 * ny;
  // The frame above is centred at the origin; shift so the vertex form holds.
  // Vertex: point with frame coords (x0, y0).
  const open = -Math.sign(lx / mu);
  const frame: ParabolaFrame = { vx, vy, ux: open * ux, uy: open * uy, p };
  // Validate: vertex on the curve.
  const res = Math.abs(conicAt(qq, vx, vy));
  if (!(res <= 1e-6)) {
    // Fall back to a direct solve in the rotated frame.
    const fb = parabolaVertexDirect(qq, ux, uy, nx, ny, mu, lx, ly);
    if (!fb) return makeKind(qq, 'empty', 0);
    return { ...makeKind(qq, 'parabola', 0), frame: fb };
  }
  return { ...makeKind(qq, 'parabola', 0), frame };
}

/** Direct vertex solve: substitute p = V0 + X u + Y n and read the vertex form. */
function parabolaVertexDirect(
  qq: Quad, ux: number, uy: number, nx: number, ny: number,
  mu: number, lx: number, _ly: number,
): ParabolaFrame | undefined {
  void _ly;
  // Work in frame coords relative to the origin: p = X u + Y n.
  // Conic: mu*Y^2 + 2*lx*X + 2*ly*Y + F = 0 with (lx, ly) as above.
  const D = qq.D;
  const E = qq.E;
  const F = qq.F;
  const ly = (D * nx + E * ny) / 2;
  const y0 = -ly / mu;
  const x0 = -(F - (ly * ly) / mu) / lx;
  const p = Math.abs(lx / mu);
  const vx = x0 * ux + y0 * nx;
  const vy = x0 * uy + y0 * ny;
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(p) || p <= 0) return undefined;
  const open = -Math.sign(lx / mu);
  return { vx, vy, ux: open * ux, uy: open * uy, p };
}

/** The double line of a rank-1 quad. */
function doubleLineOf(qq: Quad): HLine {
  // M = v v^T up to scale: the line is v (homogeneous), from the largest diagonal.
  const m = matOf(qq);
  const diags = [m[0], m[4], m[8]];
  let k = 0;
  if (Math.abs(diags[1] as number) > Math.abs(diags[k] as number)) k = 1;
  if (Math.abs(diags[2] as number) > Math.abs(diags[k] as number)) k = 2;
  const col = k === 0 ? [m[0], m[3], m[6]] : k === 1 ? [m[1], m[4], m[7]] : [m[2], m[5], m[8]];
  const c0 = col[0] as number;
  const c1 = col[1] as number;
  const c2 = col[2] as number;
  const s = Math.sign(diags[k] as number) || 1;
  const r = Math.sqrt(Math.abs(diags[k] as number)) || 1;
  return normLine((s * c0) / r, (s * c1) / r, (-s * c2) / r);
}

/**
 * Split a real rank-2 pair into two HLines: intersect with a line away from the
 * singular point, join the hits to it.
 */
export function splitPair(m: Mat3): readonly [HLine, HLine?] {
  const pt = pairPointH(m);
  // A coordinate line X_k = 0 that misses the singular point: the larger |pt_k|, the better.
  let k = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(pt[i] as number) > Math.abs(pt[k] as number)) k = i;
  // Two points o and d that span that line.
  const o: [number, number, number] = [0, 0, 0];
  const d: [number, number, number] = [0, 0, 0];
  const axes = [0, 1, 2].filter((i) => i !== k);
  o[axes[0] as number] = 1;
  d[axes[1] as number] = 1;
  // Q(lambda o + mu d) = lambda^2 Qo + 2 lambda mu Bod + mu^2 Qd; its roots (lambda : mu) are where the two lines cross X_k = 0.
  const mo = matVec3(m, o[0], o[1], o[2]);
  const md = matVec3(m, d[0], d[1], d[2]);
  const Qo = o[0] * mo[0] + o[1] * mo[1] + o[2] * mo[2];
  const Qd = d[0] * md[0] + d[1] * md[1] + d[2] * md[2];
  const Bod = o[0] * md[0] + o[1] * md[1] + o[2] * md[2];
  const disc = Bod * Bod - Qo * Qd;
  const hits: Array<[number, number]> = [];
  if (disc >= 0) {
    const sq = Math.sqrt(disc);
    const q = -(Bod + (Bod >= 0 ? sq : -sq));
    if (q !== 0) {
      hits.push([q, Qo]);
      hits.push([Qd, q]);
    } else {
      // Bod = 0 and disc = 0: Qo = 0 or Qd = 0.
      hits.push(Math.abs(Qo) <= Math.abs(Qd) ? [1, 0] : [0, 1]);
    }
  }
  const lines: HLine[] = [];
  for (const [lam, mu] of hits) {
    const h: [number, number, number] = [lam * o[0] + mu * d[0], lam * o[1] + mu * d[1], lam * o[2] + mu * d[2]];
    const lx = pt[1] * h[2] - pt[2] * h[1];
    const ly = pt[2] * h[0] - pt[0] * h[2];
    const lz = pt[0] * h[1] - pt[1] * h[0];
    if (Math.hypot(lx, ly) > 1e-12 * Math.hypot(lx, ly, lz)) lines.push(normLine(lx, ly, -lz));
  }
  // A double root gives the same line twice.
  const uniq: HLine[] = [];
  for (const l of lines) {
    const same = uniq.some((u) => {
      const sg = u.a * l.a + u.b * l.b >= 0 ? 1 : -1;
      return Math.abs(u.a - sg * l.a) <= 1e-9 && Math.abs(u.b - sg * l.b) <= 1e-9 && Math.abs(u.c - sg * l.c) <= 1e-9 * Math.max(1, Math.abs(l.c));
    });
    if (!same) uniq.push(l);
  }
  if (uniq.length === 0) return [{ a: 1, b: 0, c: 0 }];
  if (uniq.length === 1) return [uniq[0] as HLine];
  return [uniq[0] as HLine, uniq[1] as HLine];
}

/** Singular (homogeneous) point of a rank-2 matrix: the null vector. */
function pairPointH(m: Mat3): [number, number, number] {
  const adj = adj3(m);
  let bi = 0;
  let bv = 0;
  for (let i = 0; i < 9; i++) {
    const v = Math.abs(adj[i] as number);
    if (v > bv) {
      bv = v;
      bi = i;
    }
  }
  const col = bi % 3;
  return [adj[col] as number, adj[3 + col] as number, adj[6 + col] as number];
}

function pairPoint(m: Mat3): V2 | undefined {
  const p = pairPointH(m);
  if (Math.abs(p[2]) <= 1e-12 * Math.hypot(p[0], p[1])) return undefined;
  return { x: p[0] / p[2], y: p[1] / p[2] };
}

function singletonOf(m: Mat3): V2 | undefined {
  return pairPoint(m);
}

/**
 * Parallel lines of a rank-2 quad with delta ~ 0: reduce along the invariant
 * direction to a 1D quadratic. Undefined when no real lines exist.
 */
function parallelLinesOf(qq: Quad): readonly [HLine, HLine?] | undefined {
  const A = qq.A;
  const B = qq.B;
  const C = qq.C;
  const D = qq.D;
  const E = qq.E;
  const F = qq.F;
  // Invariant direction: null of S.
  const r0 = Math.hypot(A, B / 2);
  const r1 = Math.hypot(B / 2, C);
  let dx: number;
  let dy: number;
  if (r0 >= r1) {
    dx = -B / 2;
    dy = A;
  } else {
    dx = -C;
    dy = B / 2;
  }
  const dl = Math.hypot(dx, dy);
  if (!(dl > 0)) return undefined;
  dx /= dl;
  dy /= dl;
  const nx = -dy;
  const ny = dx;
  // Substitute p = t*n: alpha t^2 + beta t + F.
  const alpha = A * nx * nx + B * nx * ny + C * ny * ny;
  const beta = D * nx + E * ny;
  const roots = solveQuad(alpha, beta, F);
  if (roots.kind === 'none') return undefined;
  if (roots.kind === 'one') {
    const t = roots.s;
    return [normLine(nx, ny, -(nx * 0 + ny * 0) - t * (nx * nx + ny * ny))];
  }
  const mk = (t: number): HLine => normLine(nx, ny, -t);
  if (roots.s1 === roots.s2) return [mk(roots.s1)];
  return [mk(roots.s1), mk(roots.s2)];
}

/* ------------------------------ native constructors (conics 3.2, 4.1, 4.2) ------------------------------ */

export function circleConic(cx: number, cy: number, r: number): ConicValue {
  const q: Quad = { A: 1, B: 0, C: 1, D: -2 * cx, E: -2 * cy, F: cx * cx + cy * cy - r * r };
  return withUnitNorm(q, 'circle', { cx, cy, ux: 1, uy: 0, a: r, b: r }, 1);
}

function withUnitNorm(q: Quad, kind: ConicKind, frame: CentralFrame | ParabolaFrame | undefined, margin: number): ConicValue {
  const m = matOf(q);
  const n = frob3(m) || 1;
  const qq: Quad = { A: q.A / n, B: q.B / n, C: q.C / n, D: q.D / n, E: q.E / n, F: q.F / n };
  const base: ConicValue = { q: qq, kind, margin };
  return frame ? { ...base, frame } : base;
}

export function ellipseNative(f1: V2, f2: V2, a: number): ConicValue {
  const cx = (f1.x + f2.x) / 2;
  const cy = (f1.y + f2.y) / 2;
  const dx = f2.x - f1.x;
  const dy = f2.y - f1.y;
  const c = Math.hypot(dx, dy) / 2;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const b = Math.sqrt(Math.max(0, (a - c) * (a + c)));
  const q = quadFromCentral(cx, cy, ux, uy, a, b);
  return withUnitNorm(q, 'ellipse', { cx, cy, ux, uy, a, b }, 1);
}

export function hyperbolaNative(f1: V2, f2: V2, a: number): ConicValue {
  const cx = (f1.x + f2.x) / 2;
  const cy = (f1.y + f2.y) / 2;
  const dx = f2.x - f1.x;
  const dy = f2.y - f1.y;
  const c = Math.hypot(dx, dy) / 2;
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  const b = Math.sqrt(Math.max(0, (c - a) * (c + a)));
  const q = quadFromCentralHyper(cx, cy, ux, uy, a, b);
  return withUnitNorm(q, 'hyperbola', { cx, cy, ux, uy, a, b }, 1);
}

export function parabolaNative(f: V2, a: number, b: number, c: number): ConicValue {
  // Foot of F on the directrix; vertex = midpoint; p = |F - foot|.
  const s = a * f.x + b * f.y - c;
  const fx = f.x - s * a;
  const fy = f.y - s * b;
  const vx = (f.x + fx) / 2;
  const vy = (f.y + fy) / 2;
  const p = Math.hypot(f.x - fx, f.y - fy);
  const ux = (f.x - fx) / (p || 1);
  const uy = (f.y - fy) / (p || 1);
  // Quad: |p - F|^2 = dist(p, d)^2.
  const q: Quad = {
    A: 1 - a * a,
    B: -2 * a * b,
    C: 1 - b * b,
    D: -2 * f.x + 2 * c * a,
    E: -2 * f.y + 2 * c * b,
    F: f.x * f.x + f.y * f.y - c * c,
  };
  return withUnitNorm(q, 'parabola', { vx, vy, ux, uy, p }, 1);
}

/** Quad of X^2/a^2 + Y^2/b^2 = 1 in the frame (c, u). */
function quadFromCentral(cx: number, cy: number, ux: number, uy: number, a: number, b: number): Quad {
  const nx = -uy;
  const ny = ux;
  const ia = 1 / (a * a);
  const ib = 1 / (b * b);
  // S = ia u u^T + ib n n^T.
  const Sxx = ia * ux * ux + ib * nx * nx;
  const Sxy = ia * ux * uy + ib * nx * ny;
  const Syy = ia * uy * uy + ib * ny * ny;
  const lin = -(Sxx * cx + Sxy * cy);
  const linY = -(Sxy * cx + Syy * cy);
  return {
    A: Sxx,
    B: 2 * Sxy,
    C: Syy,
    D: 2 * lin,
    E: 2 * linY,
    F: Sxx * cx * cx + 2 * Sxy * cx * cy + Syy * cy * cy - 1,
  };
}

/** Quad of X^2/a^2 - Y^2/b^2 = 1 in the frame (c, u). */
function quadFromCentralHyper(cx: number, cy: number, ux: number, uy: number, a: number, b: number): Quad {
  const nx = -uy;
  const ny = ux;
  const ia = 1 / (a * a);
  const ib = 1 / (b * b);
  const Sxx = ia * ux * ux - ib * nx * nx;
  const Sxy = ia * ux * uy - ib * nx * ny;
  const Syy = ia * uy * uy - ib * ny * ny;
  const lin = -(Sxx * cx + Sxy * cy);
  const linY = -(Sxy * cx + Syy * cy);
  return {
    A: Sxx,
    B: 2 * Sxy,
    C: Syy,
    D: 2 * lin,
    E: 2 * linY,
    F: Sxx * cx * cx + 2 * Sxy * cx * cy + Syy * cy * cy - 1,
  };
}

/* ------------------------------ normalization and paths ------------------------------ */

/** A Circle or Conic value as a ConicValue (Circle is a subtype of Conic). */
export function toConic(v: unknown): ConicValue | undefined {
  if (isConicV(v)) return v;
  if (isCircleV(v)) {
    if (!(v.r >= 0) || !Number.isFinite(v.cx) || !Number.isFinite(v.cy) || !Number.isFinite(v.r)) return undefined;
    if (v.r === 0) {
      const r = classifyQuad({ A: 1, B: 0, C: 1, D: -2 * v.cx, E: -2 * v.cy, F: v.cx * v.cx + v.cy * v.cy }, 1e-9);
      if ('fail' in r) return undefined;
      const base: ConicValue = { q: r.q, kind: r.kind, margin: r.margin };
      return r.point ? { ...base, point: r.point } : base;
    }
    return circleConic(v.cx, v.cy, v.r);
  }
  return undefined;
}

/** The riding path of a conic (conics 3.5); line pairs ride their first line. */
export function conicPath(c: ConicValue): Path | undefined {
  if (!c.frame) {
    if ((c.kind === 'lines' || c.kind === 'parallel' || c.kind === 'double' || c.kind === 'line') && c.lines) {
      const l = c.lines[0];
      return linePath(l.a, l.b, l.c);
    }
    return undefined;
  }
  if (c.kind === 'circle') {
    const f = c.frame as CentralFrame;
    return circlePath(f.cx, f.cy, f.a);
  }
  if (c.kind === 'ellipse') return ellipsePath(c.frame as CentralFrame);
  if (c.kind === 'hyperbola') return hyperbolaPath(c.frame as CentralFrame);
  if (c.kind === 'parabola') return parabolaPath(c.frame as ParabolaFrame);
  if (c.lines) {
    const l = c.lines[0];
    return linePath(l.a, l.b, l.c);
  }
  return undefined;
}

/* ------------------------------ five-point conic (conics 4.3) ------------------------------ */

export function fivePointConic(
  pts: readonly V2[],
  tol: number,
): { conic: ConicValue } | { fail: 'coincident_points' | 'collinear' | 'degenerate_points' | 'no_convergence'; detail?: string } {
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      const a = pts[i] as V2;
      const b = pts[j] as V2;
      if (Math.hypot(a.x - b.x, a.y - b.y) <= tol * Math.max(1, Math.abs(a.x), Math.abs(a.y))) {
        return { fail: 'coincident_points' };
      }
    }
  }
  // Hartley normalisation: translate to the centroid, scale mean distance to sqrt(2).
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= 5;
  cy /= 5;
  let mean = 0;
  for (const p of pts) mean += Math.hypot(p.x - cx, p.y - cy);
  mean /= 5;
  const s = mean > 0 ? Math.SQRT2 / mean : 1;
  const np = pts.map((p) => ({ x: (p.x - cx) * s, y: (p.y - cy) * s }));
  // 5x6 design matrix, padded to 6x6 with a zero row.
  const A: number[][] = [];
  for (const p of np) A.push([p.x * p.x, p.x * p.y, p.y * p.y, p.x, p.y, 1]);
  A.push([0, 0, 0, 0, 0, 0]);
  const svd = jacobiSVD(A);
  if (!svd) return { fail: 'no_convergence' };
  const sig = [...svd.sigma].sort((a, b) => b - a);
  const s1 = sig[0] as number;
  const s5 = sig[4] as number;
  if (!(s5 > 1e-10 * s1)) {
    return fourCollinear(pts, tol) ? { fail: 'collinear' } : { fail: 'degenerate_points' };
  }
  // Null vector: column of V with the smallest singular value.
  let bi = 0;
  for (let i = 1; i < 6; i++) if ((svd.sigma[i] as number) < (svd.sigma[bi] as number)) bi = i;
  const col = (r: number): number => ((svd.V[r] as number[])[bi] as number);
  const nv = [col(0), col(1), col(2), col(3), col(4), col(5)];
  // De-normalise: M_x = E^T M_y E with E mapping (x, y, 1) to the normalised (s(x - cx), s(y - cy), 1).
  const my: Mat3 = [nv[0] as number, (nv[1] as number) / 2, (nv[3] as number) / 2, (nv[1] as number) / 2, nv[2] as number, (nv[4] as number) / 2, (nv[3] as number) / 2, (nv[4] as number) / 2, nv[5] as number];
  const E: Mat3 = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  const Et = transpose3(E);
  const mx = matMul3(matMul3(Et, my), E);
  const r = classifyQuad(quadOf(mx), tol);
  if ('fail' in r) return { fail: 'degenerate_points' };
  const base: ConicValue = { q: r.q, kind: r.kind, margin: r.margin };
  const w1 = r.frame ? { ...base, frame: r.frame } : base;
  const w2 = r.lines ? { ...w1, lines: r.lines } : w1;
  return { conic: r.point ? { ...w2, point: r.point } : w2 };
}

/** One-sided Jacobi SVD of a square matrix: {V, sigma}. Undefined past 30 sweeps. */
function jacobiSVD(A: number[][]): { V: number[][]; sigma: number[] } | undefined {
  const n = A.length;
  const a = A.map((row) => [...row]);
  const V: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) row.push(i === j ? 1 : 0);
    V.push(row);
  }
  const colDot = (p: number, q: number): number => {
    let s = 0;
    for (let i = 0; i < n; i++) s += (a[i] as number[])[p] as number * ((a[i] as number[])[q] as number);
    return s;
  };
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const beta = colDot(p, q);
        off += beta * beta;
        if (beta === 0) continue;
        const alpha = colDot(p, p);
        const gamma = colDot(q, q);
        if (alpha === 0 || gamma === 0) continue;
        const tau = (gamma - alpha) / (2 * beta);
        const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const sn = c * t;
        for (let i = 0; i < n; i++) {
          const api = (a[i] as number[])[p] as number;
          const aqi = (a[i] as number[])[q] as number;
          (a[i] as number[])[p] = c * api - sn * aqi;
          (a[i] as number[])[q] = sn * api + c * aqi;
        }
        for (let i = 0; i < n; i++) {
          const vpi = (V[i] as number[])[p] as number;
          const vqi = (V[i] as number[])[q] as number;
          (V[i] as number[])[p] = c * vpi - sn * vqi;
          (V[i] as number[])[q] = sn * vpi + c * vqi;
        }
      }
    }
    if (off === 0 || off < 1e-28) break;
    if (sweep === 29) return undefined;
  }
  const sigma: number[] = [];
  for (let j = 0; j < n; j++) sigma.push(Math.sqrt(Math.max(0, colDot(j, j))));
  return { V, sigma };
}

/** True when some 4 of the 5 points are collinear. */
function fourCollinear(pts: readonly V2[], tol: number): boolean {
  for (let skip = 0; skip < 5; skip++) {
    const sub = pts.filter((_, i) => i !== skip);
    let ok = true;
    const a = sub[0] as V2;
    const b = sub[1] as V2;
    const base = Math.max(1, dist(a, b));
    for (let i = 2; i < 4; i++) {
      const p = sub[i] as V2;
      const side = Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / (base || 1);
      if (side > tol * Math.max(1, norm2(p))) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/* ------------------------------ property readers (conics 5) ------------------------------ */

export function centralParams(c: ConicValue): CentralFrame | undefined {
  if ((c.kind === 'circle' || c.kind === 'ellipse' || c.kind === 'hyperbola') && c.frame && isCentralFrame(c.frame)) {
    return c.frame;
  }
  return undefined;
}

export function parabolaParams(c: ConicValue): number {
  if (c.kind === 'parabola' && c.frame && !isCentralFrame(c.frame)) return c.frame.p;
  return NaN;
}

export function centerOf(c: ConicValue): V2 | undefined {
  const cp = centralParams(c);
  if (cp) return { x: cp.cx, y: cp.cy };
  if (c.kind === 'lines' && c.lines && c.lines[1]) {
    const [l1, l2] = c.lines;
    const det = l1.a * l2.b - l2.a * l1.b;
    if (det === 0) return undefined;
    return { x: (l1.c * l2.b - l2.c * l1.b) / det, y: (l1.a * l2.c - l2.a * l1.c) / det };
  }
  if (c.kind === 'point' && c.point) return { ...c.point };
  return undefined;
}

export function semiAxesOf(c: ConicValue): [number, number] {
  const cp = centralParams(c);
  return cp ? [cp.a, cp.b] : [NaN, NaN];
}

export function linearEccentricityOf(c: ConicValue): number {
  const cp = centralParams(c);
  if (cp) {
    if (c.kind === 'circle') return 0;
    if (c.kind === 'ellipse') return Math.sqrt(Math.max(0, cp.a * cp.a - cp.b * cp.b));
    return Math.sqrt(cp.a * cp.a + cp.b * cp.b);
  }
  if (c.kind === 'parabola' && c.frame && !isCentralFrame(c.frame)) return c.frame.p / 2;
  return NaN;
}

export function eccentricityOf(c: ConicValue): number {
  if (c.kind === 'circle') return 0;
  if (c.kind === 'parabola') return 1;
  const cp = centralParams(c);
  if (!cp || cp.a === 0) return NaN;
  return linearEccentricityOf(c) / cp.a;
}

export function fociOf(c: ConicValue): V2[] {
  const cp = centralParams(c);
  if (!cp) {
    if (c.kind === 'parabola' && c.frame && !isCentralFrame(c.frame)) {
      const f = c.frame;
      return [{ x: f.vx + (f.p / 2) * f.ux, y: f.vy + (f.p / 2) * f.uy }];
    }
    return [];
  }
  if (c.kind === 'circle') return [
    { x: cp.cx, y: cp.cy },
    { x: cp.cx, y: cp.cy },
  ];
  const e = linearEccentricityOf(c);
  return [
    { x: cp.cx + e * cp.ux, y: cp.cy + e * cp.uy },
    { x: cp.cx - e * cp.ux, y: cp.cy - e * cp.uy },
  ];
}

export function verticesOf(c: ConicValue): V2[] {
  const cp = centralParams(c);
  if (cp) {
    const nx = -cp.uy;
    const ny = cp.ux;
    if (c.kind === 'hyperbola') {
      return [
        { x: cp.cx + cp.a * cp.ux, y: cp.cy + cp.a * cp.uy },
        { x: cp.cx - cp.a * cp.ux, y: cp.cy - cp.a * cp.uy },
      ];
    }
    return [
      { x: cp.cx + cp.a * cp.ux, y: cp.cy + cp.a * cp.uy },
      { x: cp.cx - cp.a * cp.ux, y: cp.cy - cp.a * cp.uy },
      { x: cp.cx + cp.b * nx, y: cp.cy + cp.b * ny },
      { x: cp.cx - cp.b * nx, y: cp.cy - cp.b * ny },
    ];
  }
  if (c.kind === 'parabola' && c.frame && !isCentralFrame(c.frame)) {
    return [{ x: c.frame.vx, y: c.frame.vy }];
  }
  return [];
}

export function directricesOf(c: ConicValue): HLine[] {
  const cp = centralParams(c);
  if (cp && (c.kind === 'ellipse' || c.kind === 'hyperbola')) {
    const e = eccentricityOf(c);
    if (!(e > 0)) return [];
    const d = cp.a / e;
    const mk = (s: number): HLine => {
      const px = cp.cx + s * d * cp.ux;
      const py = cp.cy + s * d * cp.uy;
      return { a: cp.ux, b: cp.uy, c: cp.ux * px + cp.uy * py };
    };
    return [mk(1), mk(-1)];
  }
  if (c.kind === 'parabola' && c.frame && !isCentralFrame(c.frame)) {
    const f = c.frame;
    const px = f.vx - (f.p / 2) * f.ux;
    const py = f.vy - (f.p / 2) * f.uy;
    return [{ a: f.ux, b: f.uy, c: f.ux * px + f.uy * py }];
  }
  return [];
}

export function majorAxisOf(c: ConicValue): HLine | undefined {
  const cp = centralParams(c);
  if (cp) {
    const nx = -cp.uy;
    const ny = cp.ux;
    return { a: nx, b: ny, c: nx * cp.cx + ny * cp.cy };
  }
  if (c.kind === 'parabola' && c.frame && !isCentralFrame(c.frame)) {
    const f = c.frame;
    const nx = -f.uy;
    const ny = f.ux;
    return { a: nx, b: ny, c: nx * f.vx + ny * f.vy };
  }
  return undefined;
}

export function minorAxisOf(c: ConicValue): HLine | undefined {
  const cp = centralParams(c);
  if (!cp) return undefined;
  return { a: cp.ux, b: cp.uy, c: cp.ux * cp.cx + cp.uy * cp.cy };
}

export function axesOf(c: ConicValue): HLine[] {
  const maj = majorAxisOf(c);
  if (c.kind === 'parabola') return maj ? [maj] : [];
  const min = minorAxisOf(c);
  if (maj && min) return [maj, min];
  if (c.kind === 'lines' && c.lines && c.lines[1]) return bisectorsOf(c.lines[0], c.lines[1]);
  return [];
}

function bisectorsOf(l1: HLine, l2: HLine): HLine[] {
  const hit = { x: 0, y: 0 };
  const det = l1.a * l2.b - l2.a * l1.b;
  if (det !== 0) {
    hit.x = (l1.c * l2.b - l2.c * l1.b) / det;
    hit.y = (l1.a * l2.c - l2.a * l1.c) / det;
  }
  let n1 = { x: l1.a, y: l1.b };
  const n2 = { x: l2.a, y: l2.b };
  if (n1.x * n2.x + n1.y * n2.y < 0) n1 = { x: -n1.x, y: -n1.y };
  const m1 = { x: n1.x + n2.x, y: n1.y + n2.y };
  const m2 = { x: n1.x - n2.x, y: n1.y - n2.y };
  const l1m = norm2(m1) || 1;
  const l2m = norm2(m2) || 1;
  return [
    { a: m1.x / l1m, b: m1.y / l1m, c: (m1.x * hit.x + m1.y * hit.y) / l1m },
    { a: m2.x / l2m, b: m2.y / l2m, c: (m2.x * hit.x + m2.y * hit.y) / l2m },
  ];
}

export function asymptotesOf(c: ConicValue): HLine[] {
  const cp = centralParams(c);
  if (cp && c.kind === 'hyperbola') {
    const nx = -cp.uy;
    const ny = cp.ux;
    const mk = (s: number): HLine => {
      const dx = cp.a * cp.ux + s * cp.b * nx;
      const dy = cp.a * cp.uy + s * cp.b * ny;
      const l = Math.hypot(dx, dy) || 1;
      const a = -dy / l;
      const b = dx / l;
      return { a, b, c: a * cp.cx + b * cp.cy };
    };
    return [mk(1), mk(-1)];
  }
  if (c.kind === 'lines' && c.lines) return c.lines[1] ? [c.lines[0], c.lines[1]] : [c.lines[0]];
  return [];
}

export function tiltOf(c: ConicValue): number {
  const cp = centralParams(c);
  if (cp) {
    const t = Math.atan2(cp.uy, cp.ux);
    return t < 0 ? t + Math.PI : t;
  }
  if (c.kind === 'parabola' && c.frame && !isCentralFrame(c.frame)) {
    const t = Math.atan2(c.frame.uy, c.frame.ux);
    return t < 0 ? t + Math.PI : t >= Math.PI ? t - Math.PI : t;
  }
  return NaN;
}

export function coefficientsOf(c: ConicValue): number[] {
  const { A, B, C, D, E, F } = c.q;
  const first = A !== 0 ? A : C !== 0 ? C : B !== 0 ? B : D !== 0 ? D : E !== 0 ? E : F !== 0 ? F : 1;
  return [A / first, B / first, C / first, D / first, E / first, F / first];
}

export function typeNameOf(c: ConicValue): string {
  switch (c.kind) {
    case 'circle':
      return 'circle';
    case 'ellipse':
      return 'ellipse';
    case 'hyperbola':
      return 'hyperbola';
    case 'parabola':
      return 'parabola';
    case 'lines':
      return 'two lines';
    case 'parallel':
      return 'parallel lines';
    case 'double':
      return 'double line';
    case 'point':
      return 'point';
    case 'line':
      return 'line';
    case 'empty':
      return 'empty';
  }
}

const fmtN = (v: number): string => {
  if (v === 0) return '0';
  const s = String(Math.round(v * 1000) / 1000);
  return s;
};

/** Readable equation, standard form by kind (general fallback). */
export function equationOf(c: ConicValue): string {
  const cp = centralParams(c);
  if (cp && c.kind === 'circle') {
    return `(x - ${fmtN(cp.cx)})^2 + (y - ${fmtN(cp.cy)})^2 = ${fmtN(cp.a * cp.a)}`;
  }
  if (cp && (c.kind === 'ellipse' || c.kind === 'hyperbola')) {
    const tilt = Math.atan2(cp.uy, cp.ux);
    const aligned = Math.abs(Math.sin(2 * tilt)) < 1e-9;
    const op = c.kind === 'ellipse' ? '+' : '-';
    if (aligned) {
      const swap = Math.abs(Math.cos(tilt)) < Math.abs(Math.sin(tilt));
      const A2 = swap ? cp.b * cp.b : cp.a * cp.a;
      const B2 = swap ? cp.a * cp.a : cp.b * cp.b;
      return `(x - ${fmtN(cp.cx)})^2/${fmtN(A2)} ${op} (y - ${fmtN(cp.cy)})^2/${fmtN(B2)} = 1`;
    }
  }
  if (c.kind === 'parabola' && c.frame && !isCentralFrame(c.frame)) {
    const f = c.frame;
    const horiz = Math.abs(f.ux) > Math.abs(f.uy);
    if (horiz || Math.abs(f.uy) > 0.999999) {
      const s = horiz ? Math.sign(f.ux) || 1 : 0;
      void s;
    }
  }
  const { A, B, C, D, E, F } = c.q;
  const parts: string[] = [];
  if (A !== 0) parts.push(`${fmtN(A)}x^2`);
  if (B !== 0) parts.push(`${fmtN(B)}xy`);
  if (C !== 0) parts.push(`${fmtN(C)}y^2`);
  if (D !== 0) parts.push(`${fmtN(D)}x`);
  if (E !== 0) parts.push(`${fmtN(E)}y`);
  if (F !== 0 || parts.length === 0) parts.push(fmtN(F));
  return `${parts.join(' + ').replace(/\+ -/g, '- ')} = 0`;
}

/* ------------------------------ dual tests and poles (conics 6) ------------------------------ */

/** True when l is tangent to c (dual test, same threshold as the intersection). */
export function dualConicTest(c: ConicValue, l: HLine, tol: number): boolean {
  const star = adj3(matOf(c.q));
  const v = matVec3(star, l.a, l.b, -l.c);
  const r = l.a * v[0] + l.b * v[1] - l.c * v[2];
  const n = frob3(star);
  return Math.abs(r) <= tol * 64 * Math.max(1, n);
}

/** Pole of a line: M^-1 L by Cramer. */
export function poleOf(c: ConicValue, l: HLine): { p?: V2; atInfinity: boolean; cond: number } | undefined {
  const m = matOf(c.q);
  const det = det3(m);
  const n = frob3(m) || 1;
  if (Math.abs(det) <= 1e-12 * n * n * n) return undefined;
  // Solve M p = (a, b, -c).
  const rhs: [number, number, number] = [l.a, l.b, -l.c];
  const rep = (col: number): Mat3 => {
    const o = [...m] as unknown as number[];
    o[col] = rhs[0];
    o[3 + col] = rhs[1];
    o[6 + col] = rhs[2];
    return o as unknown as Mat3;
  };
  const x = det3(rep(0)) / det;
  const y = det3(rep(1)) / det;
  const w = det3(rep(2)) / det;
  // Condition estimate via the adjugate norm.
  const adj = adj3(m);
  const cond = (n * frob3(adj)) / Math.abs(det);
  if (Math.abs(w) <= 1e-12 * Math.max(1, Math.hypot(x, y))) return { atInfinity: true, cond };
  return { p: { x: x / w, y: y / w }, atInfinity: false, cond };
}

/* ------------------------------ curvature (conics 7) ------------------------------ */

export interface Curvature {
  readonly ok: boolean;
  readonly kappa: number;
  /** Unit gradient (outward normal); curvature vector = kappa * normal. */
  readonly normal: V2;
}

/** Signed curvature at the projection of P, via the implicit formula. */
export function curvatureAt(c: ConicValue, p: V2): Curvature {
  const path = conicPath(c);
  const q = path ? path.at(path.project(p).s) : p;
  const g = conicGrad(c.q, q.x, q.y);
  const gl = Math.hypot(g.x, g.y);
  if (!(gl > 0)) return { ok: false, kappa: NaN, normal: { x: 1, y: 0 } };
  const { A, B, C } = c.q;
  const Fxx = 2 * A;
  const Fxy = B;
  const Fyy = 2 * C;
  const kappa = -((g.y * g.y * Fxx - 2 * g.x * g.y * Fxy + g.x * g.x * Fyy) / (gl * gl * gl));
  if (!Number.isFinite(kappa)) return { ok: false, kappa: NaN, normal: { x: 1, y: 0 } };
  return { ok: true, kappa, normal: { x: g.x / gl, y: g.y / gl } };
}

/* ------------------------------ measures (conics 4.6) ------------------------------ */

/** Complete elliptic integral E(m) by AGM (m = 1 - b^2/a^2). */
function ellE(m: number): number {
  if (m <= 0) return Math.PI / 2;
  if (m >= 1) return 1;
  let a = 1;
  let b = Math.sqrt(1 - m);
  let c = Math.sqrt(m);
  let sum = 0;
  let p2 = 1;
  for (let i = 0; i < 12; i++) {
    sum += (p2 * c * c) / 2;
    p2 *= 2;
    const an = (a + b) / 2;
    const bn = Math.sqrt(a * b);
    c = (a - b) / 2;
    a = an;
    b = bn;
    if (Math.abs(c) < 1e-17) break;
  }
  return ((Math.PI / (2 * a)) * (1 - sum)) as number;
}

/** Ellipse circumference 4aE(m), stable for very flat ellipses. */
export function ellipseCircumference(a: number, b: number): number {
  if (!(a > 0) || !(b >= 0)) return NaN;
  if (b === 0) return 4 * a;
  const m = 1 - (b * b) / (a * a);
  return 4 * a * ellE(m);
}

/** Polar angle (from the major axis) to eccentric angle. */
function polarToEccentric(phi: number, a: number, b: number): number {
  return Math.atan2(a * Math.sin(phi), b * Math.cos(phi));
}

/** Area of an ellipse sector over a polar sweep (1/2 a b dEta). */
export function sectorAreaEllipse(a: number, b: number, from: number, sweep: number, tilt: number): number {
  const e0 = polarToEccentric(from - tilt, a, b);
  const e1raw = polarToEccentric(from + sweep - tilt, a, b);
  let e1 = e1raw;
  while (e1 < e0) e1 += TAU;
  while (e1 - TAU >= e0 && e1 - e0 > sweep) e1 -= TAU;
  return 0.5 * a * b * Math.abs(e1 - e0);
}

/** Arc length of an ellipse arc over a polar sweep (adaptive Gauss-Kronrod). */
export function arcLengthEllipse(a: number, b: number, from: number, sweep: number): number {
  const tilt = 0; // polar angles here are measured in the frame already
  void tilt;
  const e0 = polarToEccentric(from, a, b);
  let e1 = polarToEccentric(from + sweep, a, b);
  while (e1 < e0) e1 += TAU;
  while (e1 - TAU >= e0 && e1 - e0 > sweep) e1 -= TAU;
  const f = (e: number): number => Math.sqrt(a * a * Math.sin(e) * Math.sin(e) + b * b * Math.cos(e) * Math.cos(e));
  return adaptiveGK(f, e0, e1, 1e-13, 64);
}

// Gauss-Kronrod 7-15 nodes and weights on [-1, 1].
const GK_X = [0.991455371120813, 0.949107912342759, 0.864864423359769, 0.741531185599394, 0.586087235467691, 0.405845151377397, 0.207784955007898, 0];
const GK_WK = [0.022935322010529, 0.063092092629979, 0.10479001032225, 0.140653259715525, 0.169004726639267, 0.190350578064785, 0.204432940075298, 0.209482141084728];
const GK_WG = [0, 0.12948496616887, 0, 0.279705391489277, 0, 0.381830050505119, 0, 0.417959183673469];

function gk15(f: (x: number) => number, a: number, b: number): { k: number; g: number } {
  const m = (a + b) / 2;
  const h = (b - a) / 2;
  let k = (GK_WK[7] as number) * f(m);
  let g = (GK_WG[7] as number) * f(m);
  for (let i = 0; i < 7; i++) {
    const dx = h * (GK_X[i] as number);
    const f1 = f(m - dx);
    const f2 = f(m + dx);
    k += (GK_WK[i] as number) * (f1 + f2);
    const w = GK_WG[i] as number;
    if (w !== 0) g += w * (f1 + f2);
  }
  return { k: k * h, g: g * h };
}

function adaptiveGK(f: (x: number) => number, a: number, b: number, tol: number, max: number): number {
  if (!(b > a)) return 0;
  const stack: Array<[number, number, number, number]> = [];
  const first = gk15(f, a, b);
  stack.push([a, b, first.k, Math.abs(first.k - first.g)]);
  let total = first.k;
  let err = Math.abs(first.k - first.g);
  let intervals = 1;
  while (stack.length > 0 && intervals < max) {
    const top = stack[stack.length - 1] as [number, number, number, number];
    if (err <= tol * Math.abs(total) || top[3] <= tol * Math.abs(total) / max) break;
    stack.pop();
    const [x0, x1, kk, ee] = top;
    total -= kk;
    err -= ee;
    const m = (x0 + x1) / 2;
    const l = gk15(f, x0, m);
    const r = gk15(f, m, x1);
    stack.push([x0, m, l.k, Math.abs(l.k - l.g)]);
    stack.push([m, x1, r.k, Math.abs(r.k - r.g)]);
    total += l.k + r.k;
    err += Math.abs(l.k - l.g) + Math.abs(r.k - r.g);
    intervals += 2;
  }
  return total;
}

/** Parabola arc length from the vertex to parameter u (closed form). */
export function parabolaArcLength(p: number, u: number): number {
  const t = u / p;
  return (p * ((t * Math.sqrt(1 + t * t) + Math.asinh(t)) / 2)) as number;
}


