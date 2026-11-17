/**
 * Joints in space and ray wheels (docs/features/physics/design.md 2.4, 7, 8; .kiro/specs/physics R6): hinge about an
 * axis (with motor and angle limits), rod, rope, spring, weld (that can break), slider (with limits and motor), and the
 * ray wheel of a car. Each joint is velocity rows solved with the contacts by sequential impulses, warm started, and a
 * position pass that removes drift. Anchors and axes are kept in each body's frame. Exact operations only.
 */
import { atan2, cos, sin } from './math';
import type { Joint3, P3, World3 } from './world3';
import { BodyType3, FK3, quatAxis } from './world3';

const LINEAR_SLOP = 0.005;
const ANGULAR_SLOP = (2 / 180) * Math.PI;
const MAX_LIN = 0.2;
const MAX_ANG = (8 / 180) * Math.PI;

type V = [number, number, number];

const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V, b: V): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lenOf = (a: V): number => Math.sqrt(dot(a, a));
const unitOf = (a: V): V => {
  const l = lenOf(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** A body-frame vector in world space (no translation). */
function rotOf(w: World3, i: number, x: number, y: number, z: number): V {
  const R = w.R;
  const r = i * 9;
  return [
    (R[r] as number) * x + (R[r + 1] as number) * y + (R[r + 2] as number) * z,
    (R[r + 3] as number) * x + (R[r + 4] as number) * y + (R[r + 5] as number) * z,
    (R[r + 6] as number) * x + (R[r + 7] as number) * y + (R[r + 8] as number) * z,
  ];
}

/** A world vector in body i's frame (no translation). */
function unrot(w: World3, i: number, v: V): V {
  const R = w.R;
  const r = i * 9;
  return [
    (R[r] as number) * v[0] + (R[r + 3] as number) * v[1] + (R[r + 6] as number) * v[2],
    (R[r + 1] as number) * v[0] + (R[r + 4] as number) * v[1] + (R[r + 7] as number) * v[2],
    (R[r + 2] as number) * v[0] + (R[r + 5] as number) * v[1] + (R[r + 8] as number) * v[2],
  ];
}

/** I⁻¹ v for body i in world space. */
function invI(w: World3, i: number, v: V): V {
  const I = w.invIw;
  const o = i * 9;
  return [
    (I[o] as number) * v[0] + (I[o + 1] as number) * v[1] + (I[o + 2] as number) * v[2],
    (I[o + 3] as number) * v[0] + (I[o + 4] as number) * v[1] + (I[o + 5] as number) * v[2],
    (I[o + 6] as number) * v[0] + (I[o + 7] as number) * v[1] + (I[o + 8] as number) * v[2],
  ];
}

const posOf = (w: World3, i: number): V => [w.p[i * 3] as number, w.p[i * 3 + 1] as number, w.p[i * 3 + 2] as number];
const spinOf = (w: World3, i: number): V => [w.w[i * 3] as number, w.w[i * 3 + 1] as number, w.w[i * 3 + 2] as number];

/** The speed of a point of body i at r from its centre. */
function velAt(w: World3, i: number, r: V): V {
  const om = spinOf(w, i);
  const c = cross(om, r);
  return [(w.v[i * 3] as number) + c[0], (w.v[i * 3 + 1] as number) + c[1], (w.v[i * 3 + 2] as number) + c[2]];
}

/** Impulse P at r on body i, times sgn. */
function push(w: World3, i: number, sgn: number, r: V, P: V): void {
  const m = (w.invM[i] as number) * sgn;
  w.v[i * 3] = (w.v[i * 3] as number) + m * P[0];
  w.v[i * 3 + 1] = (w.v[i * 3 + 1] as number) + m * P[1];
  w.v[i * 3 + 2] = (w.v[i * 3 + 2] as number) + m * P[2];
  spin(w, i, sgn, cross(r, P));
}

/** An angular impulse L on body i, times sgn. */
function spin(w: World3, i: number, sgn: number, L: V): void {
  const d = invI(w, i, L);
  w.w[i * 3] = (w.w[i * 3] as number) + sgn * d[0];
  w.w[i * 3 + 1] = (w.w[i * 3 + 1] as number) + sgn * d[1];
  w.w[i * 3 + 2] = (w.w[i * 3 + 2] as number) + sgn * d[2];
}

/** Turns body i by the small rotation vector t (a position pass), keeping its speeds. */
function turnBy(w: World3, i: number, t: V): void {
  if (w.type[i] !== BodyType3.Dynamic) return;
  const k = i * 4;
  const qw = w.q[k] as number;
  const qx = w.q[k + 1] as number;
  const qy = w.q[k + 2] as number;
  const qz = w.q[k + 3] as number;
  const [dx, dy, dz] = t;
  w.q[k] = qw + 0.5 * (-dx * qx - dy * qy - dz * qz);
  w.q[k + 1] = qx + 0.5 * (dx * qw + dy * qz - dz * qy);
  w.q[k + 2] = qy + 0.5 * (-dx * qz + dy * qw + dz * qx);
  w.q[k + 3] = qz + 0.5 * (dx * qy - dy * qx + dz * qw);
  w.setRot(i);
}

/** Moves body i by d (a position pass). */
function shift(w: World3, i: number, d: V): void {
  if (w.type[i] !== BodyType3.Dynamic) return;
  w.p[i * 3] = (w.p[i * 3] as number) + d[0];
  w.p[i * 3 + 1] = (w.p[i * 3 + 1] as number) + d[1];
  w.p[i * 3 + 2] = (w.p[i * 3 + 2] as number) + d[2];
}

function inv3(m: readonly number[]): number[] | undefined {
  const [a, b, c, d, e, f, g, h, i] = m as [number, number, number, number, number, number, number, number, number];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-300)) return undefined;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}

const mul3 = (M: readonly number[], v: V): V => [
  (M[0] as number) * v[0] + (M[1] as number) * v[1] + (M[2] as number) * v[2],
  (M[3] as number) * v[0] + (M[4] as number) * v[1] + (M[5] as number) * v[2],
  (M[6] as number) * v[0] + (M[7] as number) * v[1] + (M[8] as number) * v[2],
];

/** K of a point link: the impulse at both anchors that changes their relative speed by one (a 3 × 3 matrix). */
function pointK(w: World3, a: number, b: number, ra: V, rb: V): number[] {
  const m = (w.invM[a] as number) + (w.invM[b] as number);
  const K: number[] = [];
  const cols: V[] = [];
  for (let k = 0; k < 3; k++) {
    const e: V = [k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0];
    const ca = cross(invI(w, a, cross(ra, e)), ra);
    const cb = cross(invI(w, b, cross(rb, e)), rb);
    cols.push([m * e[0] + ca[0] + cb[0], m * e[1] + ca[1] + cb[1], m * e[2] + ca[2] + cb[2]]);
  }
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) K.push((cols[c] as V)[r] as number);
  return K;
}

/** Ia⁻¹ + Ib⁻¹ in world space. */
function angK(w: World3, a: number, b: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 9; k++) out.push((w.invIw[a * 9 + k] as number) + (w.invIw[b * 9 + k] as number));
  return out;
}

/** 1 / (t (Ia⁻¹ + Ib⁻¹) t): the effective mass of a turn about t. */
function angMass(w: World3, a: number, b: number, t: V): number {
  const k = dot(t, invI(w, a, t)) + dot(t, invI(w, b, t));
  return k > 0 ? 1 / k : 0;
}

/** A unit vector across u, and the third of the frame. */
function across(u: V): [V, V] {
  const t: V = Math.abs(u[0]) < 0.57 ? [0, u[2], -u[1]] : [u[1], -u[0], 0];
  const t1 = unitOf(t);
  return [t1, cross(u, t1)];
}

/** The world rotation vector that carries quaternion `from` to `to` (to · from⁻¹, small or not). */
function rotErr(to: readonly number[], from: readonly number[]): V {
  // e = to * conj(from)
  const [aw, ax, ay, az] = to as [number, number, number, number];
  const bw = from[0] as number;
  const bx = -(from[1] as number);
  const by = -(from[2] as number);
  const bz = -(from[3] as number);
  const ew = aw * bw - ax * bx - ay * by - az * bz;
  const ex = aw * bx + ax * bw + ay * bz - az * by;
  const ey = aw * by - ax * bz + ay * bw + az * bx;
  const ez = aw * bz + ax * by - ay * bx + az * bw;
  const s = ew < 0 ? -2 : 2;
  return [s * ex, s * ey, s * ez];
}

const quatOf = (w: World3, i: number): number[] => [w.q[i * 4] as number, w.q[i * 4 + 1] as number, w.q[i * 4 + 2] as number, w.q[i * 4 + 3] as number];

function qmul(a: readonly number[], b: readonly number[]): number[] {
  const [aw, ax, ay, az] = a as [number, number, number, number];
  const [bw, bx, by, bz] = b as [number, number, number, number];
  return [aw * bw - ax * bx - ay * by - az * bz, aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw];
}

const conj = (q: readonly number[]): number[] => [q[0] as number, -(q[1] as number), -(q[2] as number), -(q[3] as number)];

/** A point of body i in its frame, from a world point. */
export function localPoint(w: World3, i: number, p: P3): V {
  return w.toLocal(i, p.x, p.y, p.z);
}

abstract class Base3 implements Joint3 {
  broken = false;
  breaks = 0;
  impulse = 0;
  abstract readonly kind: number;
  /** The impulse the link carried last step (world), for j.force and the counts of forces. */
  protected lin: V = [0, 0, 0];
  protected ra: V = [0, 0, 0];
  protected rb: V = [0, 0, 0];
  constructor(readonly a: number, readonly b: number, readonly la: V, readonly lb: V) {}
  abstract initVelocity(w: World3, h: number): void;
  abstract solveVelocity(w: World3, h: number): void;
  abstract solvePosition(w: World3): boolean;
  abstract save(out: number[]): void;
  abstract load(s: Float64Array, k: number): number;
  energy(_w: World3): number {
    return 0;
  }
  /** The force it carries now, N (j.force). */
  force(h: number): number {
    return lenOf(this.lin) / h;
  }
  length(w: World3): number {
    const [pa, pb] = this.ends(w);
    return lenOf([pb.x - pa.x, pb.y - pa.y, pb.z - pa.z]);
  }
  angle(_w: World3): number {
    return 0;
  }
  /** Its two anchors in the world now, for drawing. */
  ends(w: World3): [P3, P3] {
    const a = w.toWorld(this.a, this.la[0], this.la[1], this.la[2]);
    const b = w.toWorld(this.b, this.lb[0], this.lb[1], this.lb[2]);
    return [{ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }];
  }
  account(w: World3, inv_h: number): void {
    const [x, y, z] = this.lin;
    w.account(this.b, this.kind, x * inv_h, y * inv_h, z * inv_h);
    w.account(this.a, this.kind, -x * inv_h, -y * inv_h, -z * inv_h);
  }
  protected frame(w: World3): void {
    this.ra = rotOf(w, this.a, this.la[0], this.la[1], this.la[2]);
    this.rb = rotOf(w, this.b, this.lb[0], this.lb[1], this.lb[2]);
  }
}

/* ------------------------------ the point link (hinge, weld) ------------------------------ */

/** The two anchors stay together: three rows solved as one block. */
class PointLink {
  imp: V = [0, 0, 0];
  private Kinv: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  init(w: World3, a: number, b: number, ra: V, rb: V): void {
    this.Kinv = inv3(pointK(w, a, b, ra, rb)) ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
    push(w, a, -1, ra, this.imp);
    push(w, b, 1, rb, this.imp);
  }
  solve(w: World3, a: number, b: number, ra: V, rb: V): V {
    const va = velAt(w, a, ra);
    const vb = velAt(w, b, rb);
    const d = mul3(this.Kinv, [va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]]);
    this.imp = [this.imp[0] + d[0], this.imp[1] + d[1], this.imp[2] + d[2]];
    push(w, a, -1, ra, d);
    push(w, b, 1, rb, d);
    return this.imp;
  }
  /** Moves the anchors together; their gap now. */
  position(w: World3, a: number, b: number, la: V, lb: V): number {
    const ra = rotOf(w, a, la[0], la[1], la[2]);
    const rb = rotOf(w, b, lb[0], lb[1], lb[2]);
    const pa = posOf(w, a);
    const pb = posOf(w, b);
    let C: V = [pb[0] + rb[0] - pa[0] - ra[0], pb[1] + rb[1] - pa[1] - ra[1], pb[2] + rb[2] - pa[2] - ra[2]];
    const gap = lenOf(C);
    if (gap > MAX_LIN) C = [(C[0] * MAX_LIN) / gap, (C[1] * MAX_LIN) / gap, (C[2] * MAX_LIN) / gap];
    const Ki = inv3(pointK(w, a, b, ra, rb));
    if (Ki) {
      const P = mul3(Ki, C);
      w.movePose(a, b, { rax: ra[0], ray: ra[1], raz: ra[2], rbx: rb[0], rby: rb[1], rbz: rb[2] }, -P[0], -P[1], -P[2]);
    }
    return gap;
  }
}

/** The two bodies keep their turn to each other: three angular rows as one block. */
class AngleLock {
  imp: V = [0, 0, 0];
  private Kinv: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  /** The turn of b in a's frame at the start. */
  constructor(private readonly rel: readonly number[]) {}
  init(w: World3, a: number, b: number): void {
    this.Kinv = inv3(angK(w, a, b)) ?? [0, 0, 0, 0, 0, 0, 0, 0, 0];
    spin(w, a, -1, this.imp);
    spin(w, b, 1, this.imp);
  }
  solve(w: World3, a: number, b: number): void {
    const wa = spinOf(w, a);
    const wb = spinOf(w, b);
    const d = mul3(this.Kinv, [wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]]);
    this.imp = [this.imp[0] + d[0], this.imp[1] + d[1], this.imp[2] + d[2]];
    spin(w, a, -1, d);
    spin(w, b, 1, d);
  }
  position(w: World3, a: number, b: number): number {
    const e = rotErr(quatOf(w, b), qmul(quatOf(w, a), this.rel));
    const size = lenOf(e);
    const c = size > MAX_ANG ? MAX_ANG / size : 1;
    const Ki = inv3(angK(w, a, b));
    if (!Ki) return size;
    const L = mul3(Ki, [-e[0] * c, -e[1] * c, -e[2] * c]);
    turnBy(w, a, invI(w, a, [-L[0], -L[1], -L[2]]));
    turnBy(w, b, invI(w, b, L));
    return size;
  }
}

/* ------------------------------ hinge ------------------------------ */

export interface Hinge3Options {
  readonly motor?: number;
  readonly torque?: number;
  readonly min?: number;
  readonly max?: number;
}

export class Hinge3 extends Base3 {
  readonly kind = FK3.tension;
  private readonly point = new PointLink();
  private readonly axA: V;
  private readonly axB: V;
  private readonly refA: V;
  private readonly refB: V;
  private perp: [number, number] = [0, 0];
  private motorImp = 0;
  private lowImp = 0;
  private upImp = 0;
  private axis: V = [0, 0, 1];
  private t1: V = [1, 0, 0];
  private t2: V = [0, 1, 0];
  constructor(w: World3, a: number, b: number, la: V, lb: V, axis: V, public opts: Hinge3Options) {
    super(a, b, la, lb);
    const u = unitOf(axis);
    this.axA = unrot(w, a, u);
    this.axB = unrot(w, b, u);
    const [r] = across(u);
    this.refA = unrot(w, a, r);
    this.refB = unrot(w, b, r);
  }

  override angle(w: World3): number {
    const ax = rotOf(w, this.a, ...this.axA);
    const ra = rotOf(w, this.a, ...this.refA);
    const rb = rotOf(w, this.b, ...this.refB);
    return atan2(dot(ax, cross(ra, rb)), dot(ra, rb));
  }

  initVelocity(w: World3): void {
    this.frame(w);
    this.point.init(w, this.a, this.b, this.ra, this.rb);
    this.axis = rotOf(w, this.a, ...this.axA);
    [this.t1, this.t2] = across(this.axis);
    if (this.opts.motor === undefined) this.motorImp = 0;
    const L: V = [0, 0, 0];
    const axial = this.motorImp + this.lowImp - this.upImp;
    for (let k = 0; k < 3; k++) L[k] = this.perp[0] * (this.t1[k] as number) + this.perp[1] * (this.t2[k] as number) + axial * (this.axis[k] as number);
    spin(w, this.a, -1, L);
    spin(w, this.b, 1, L);
  }

  private row(w: World3, t: V, target: number, acc: number, lo: number, hi: number): number {
    const m = angMass(w, this.a, this.b, t);
    const cdot = dot(t, spinOf(w, this.b)) - dot(t, spinOf(w, this.a)) - target;
    const nw = Math.max(lo, Math.min(hi, acc - m * cdot));
    const d = nw - acc;
    if (d !== 0) {
      spin(w, this.a, -1, [t[0] * d, t[1] * d, t[2] * d]);
      spin(w, this.b, 1, [t[0] * d, t[1] * d, t[2] * d]);
    }
    return nw;
  }

  solveVelocity(w: World3, h: number): void {
    const inv_h = 1 / h;
    const ax = this.axis;
    if (this.opts.motor !== undefined) {
      const max = (this.opts.torque ?? 1e9) * h;
      this.motorImp = this.row(w, ax, this.opts.motor, this.motorImp, -max, max);
    }
    if (this.opts.min !== undefined) {
      const C = this.angle(w) - this.opts.min;
      this.lowImp = this.row(w, ax, C > 0 ? -C * inv_h : 0, this.lowImp, 0, Infinity);
    }
    if (this.opts.max !== undefined) {
      const C = this.opts.max - this.angle(w);
      this.upImp = -this.row(w, ax, C > 0 ? C * inv_h : 0, -this.upImp, -Infinity, 0);
    }
    this.perp = [this.row(w, this.t1, 0, this.perp[0], -Infinity, Infinity), this.row(w, this.t2, 0, this.perp[1], -Infinity, Infinity)];
    this.lin = this.point.solve(w, this.a, this.b, this.ra, this.rb);
    this.impulse = lenOf(this.lin);
  }

  solvePosition(w: World3): boolean {
    // the axes line up again: turn b's axis onto a's
    const aa = rotOf(w, this.a, ...this.axA);
    const bb = rotOf(w, this.b, ...this.axB);
    const e = cross(bb, aa);
    const size = lenOf(e);
    if (size > 1e-12) {
      const u: V = [e[0] / size, e[1] / size, e[2] / size];
      const c = Math.min(size, MAX_ANG);
      const m = angMass(w, this.a, this.b, u);
      const L: V = [u[0] * c * m, u[1] * c * m, u[2] * c * m];
      turnBy(w, this.a, invI(w, this.a, [-L[0], -L[1], -L[2]]));
      turnBy(w, this.b, invI(w, this.b, L));
    }
    let limit = 0;
    if (this.opts.min !== undefined || this.opts.max !== undefined) {
      const ang = this.angle(w);
      let C = 0;
      if (this.opts.min !== undefined && ang < this.opts.min) C = Math.max(-MAX_ANG, ang - this.opts.min + ANGULAR_SLOP);
      else if (this.opts.max !== undefined && ang > this.opts.max) C = Math.min(MAX_ANG, ang - this.opts.max - ANGULAR_SLOP);
      if (C !== 0) {
        const m = angMass(w, this.a, this.b, aa);
        const L: V = [-aa[0] * C * m, -aa[1] * C * m, -aa[2] * C * m];
        turnBy(w, this.a, invI(w, this.a, [-L[0], -L[1], -L[2]]));
        turnBy(w, this.b, invI(w, this.b, L));
        limit = Math.abs(C);
      }
    }
    const gap = this.point.position(w, this.a, this.b, this.la, this.lb);
    return gap <= LINEAR_SLOP && size <= ANGULAR_SLOP && limit <= ANGULAR_SLOP;
  }

  save(out: number[]): void {
    out.push(...this.point.imp, ...this.perp, this.motorImp, this.lowImp, this.upImp);
  }

  load(s: Float64Array, k: number): number {
    this.point.imp = [s[k++] as number, s[k++] as number, s[k++] as number];
    this.perp = [s[k++] as number, s[k++] as number];
    this.motorImp = s[k++] as number;
    this.lowImp = s[k++] as number;
    this.upImp = s[k++] as number;
    return k;
  }
}

/* ------------------------------ weld ------------------------------ */

export class Weld3 extends Base3 {
  readonly kind = FK3.tension;
  private readonly point = new PointLink();
  private readonly lock: AngleLock;
  /** The distance between the two centres at the start: a turning push over it counts as a force on the weld. */
  private readonly arm: number;
  constructor(w: World3, a: number, b: number, la: V, lb: V, breaks: number) {
    super(a, b, la, lb);
    this.breaks = breaks;
    this.lock = new AngleLock(qmul(conj(quatOf(w, a)), quatOf(w, b)));
    const pa = posOf(w, a);
    const pb = posOf(w, b);
    this.arm = Math.max(0.25, lenOf([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]));
  }

  initVelocity(w: World3): void {
    this.frame(w);
    this.point.init(w, this.a, this.b, this.ra, this.rb);
    this.lock.init(w, this.a, this.b);
  }

  solveVelocity(w: World3): void {
    this.lock.solve(w, this.a, this.b);
    this.lin = this.point.solve(w, this.a, this.b, this.ra, this.rb);
    // what breaks it: the pull at the weld and the turning push over the distance between the parts
    const turn = lenOf(this.lock.imp) / this.arm;
    this.impulse = Math.sqrt(dot(this.lin, this.lin) + turn * turn);
  }

  solvePosition(w: World3): boolean {
    const ang = this.lock.position(w, this.a, this.b);
    const gap = this.point.position(w, this.a, this.b, this.la, this.lb);
    return gap <= LINEAR_SLOP && ang <= ANGULAR_SLOP;
  }

  override length(): number {
    return 0;
  }

  save(out: number[]): void {
    out.push(...this.point.imp, ...this.lock.imp);
  }

  load(s: Float64Array, k: number): number {
    this.point.imp = [s[k++] as number, s[k++] as number, s[k++] as number];
    this.lock.imp = [s[k++] as number, s[k++] as number, s[k++] as number];
    return k;
  }
}

/* ------------------------------ rod, rope and spring ------------------------------ */

export type Distance3Kind = 'rod' | 'rope' | 'spring';

export class Distance3 extends Base3 {
  readonly kind: number;
  private imp = 0;
  private u: V = [0, 0, 0];
  private len = 0;
  private mass = 0;
  constructor(a: number, b: number, la: V, lb: V, readonly mode: Distance3Kind, readonly L: number, readonly k = 0, readonly damping = 0) {
    super(a, b, la, lb);
    this.kind = mode === 'spring' ? FK3.spring : FK3.tension;
  }

  private measure(w: World3): void {
    this.frame(w);
    const pa = posOf(w, this.a);
    const pb = posOf(w, this.b);
    const d: V = [pb[0] + this.rb[0] - pa[0] - this.ra[0], pb[1] + this.rb[1] - pa[1] - this.ra[1], pb[2] + this.rb[2] - pa[2] - this.ra[2]];
    this.len = lenOf(d);
    this.u = this.len > 1e-12 ? [d[0] / this.len, d[1] / this.len, d[2] / this.len] : [0, 0, 0];
    const ca = cross(this.ra, this.u);
    const cb = cross(this.rb, this.u);
    const m = (w.invM[this.a] as number) + (w.invM[this.b] as number) + dot(ca, invI(w, this.a, ca)) + dot(cb, invI(w, this.b, cb));
    this.mass = m > 0 ? 1 / m : 0;
  }

  private rate(w: World3): number {
    const va = velAt(w, this.a, this.ra);
    const vb = velAt(w, this.b, this.rb);
    return dot(this.u, [vb[0] - va[0], vb[1] - va[1], vb[2] - va[2]]);
  }

  private apply(w: World3, d: number): void {
    const P: V = [this.u[0] * d, this.u[1] * d, this.u[2] * d];
    push(w, this.a, -1, this.ra, P);
    push(w, this.b, 1, this.rb, P);
  }

  override length(w: World3): number {
    this.measure(w);
    return this.len;
  }

  override energy(w: World3): number {
    if (this.mode !== 'spring') return 0;
    this.measure(w);
    return 0.5 * this.k * (this.len - this.L) ** 2;
  }

  initVelocity(w: World3, h: number): void {
    this.measure(w);
    if (this.mode === 'spring') {
      // a spring is a force, not a constraint: F = -k (L - rest) - c (rate of stretch)
      const I = (-this.k * (this.len - this.L) - this.damping * this.rate(w)) * h;
      this.apply(w, I);
      this.lin = [this.u[0] * I, this.u[1] * I, this.u[2] * I];
      this.impulse = Math.abs(I);
      this.imp = 0;
      return;
    }
    if (this.mode === 'rope' && this.len < this.L - LINEAR_SLOP) this.imp = 0;
    if (this.imp !== 0) this.apply(w, this.imp);
  }

  solveVelocity(w: World3, h: number): void {
    if (this.mode === 'spring' || this.mass === 0) return;
    const cdot = this.rate(w);
    const old = this.imp;
    if (this.mode === 'rod') this.imp = old - this.mass * cdot;
    else {
      // a rope only pulls; while slack it lets the ends close the gap this step, but not stretch past it
      const C = this.len - this.L;
      this.imp = Math.min(0, old - this.mass * (cdot + (C < 0 ? C / h : 0)));
    }
    const d = this.imp - old;
    if (d !== 0) this.apply(w, d);
    this.lin = [this.u[0] * this.imp, this.u[1] * this.imp, this.u[2] * this.imp];
    this.impulse = Math.abs(this.imp);
  }

  solvePosition(w: World3): boolean {
    if (this.mode === 'spring') return true;
    this.measure(w);
    let C = this.len - this.L;
    if (this.mode === 'rope' && C < 0) return true;
    C = Math.max(-MAX_LIN, Math.min(MAX_LIN, C));
    const P = -this.mass * C;
    w.movePose(this.a, this.b, { rax: this.ra[0], ray: this.ra[1], raz: this.ra[2], rbx: this.rb[0], rby: this.rb[1], rbz: this.rb[2] }, this.u[0] * P, this.u[1] * P, this.u[2] * P);
    return Math.abs(C) <= LINEAR_SLOP;
  }

  save(out: number[]): void {
    out.push(this.imp);
  }

  load(s: Float64Array, k: number): number {
    this.imp = s[k++] as number;
    return k;
  }
}

/* ------------------------------ slider ------------------------------ */

export interface Slider3Options {
  readonly min?: number;
  readonly max?: number;
  readonly motor?: number;
  readonly force?: number;
}

/** b slides along a line fixed in a, and does not turn against a: a piston. */
export class Slider3 extends Base3 {
  readonly kind = FK3.tension;
  private readonly lock: AngleLock;
  private readonly axA: V;
  private perp: [number, number] = [0, 0];
  private motorImp = 0;
  private lowImp = 0;
  private upImp = 0;
  private axis: V = [1, 0, 0];
  private t1: V = [0, 1, 0];
  private t2: V = [0, 0, 1];
  private d: V = [0, 0, 0];
  constructor(w: World3, a: number, b: number, la: V, lb: V, axis: V, public opts: Slider3Options) {
    super(a, b, la, lb);
    this.axA = unrot(w, a, unitOf(axis));
    this.lock = new AngleLock(qmul(conj(quatOf(w, a)), quatOf(w, b)));
  }

  /** How far b's anchor is along the axis from a's. */
  override length(w: World3): number {
    this.measure(w);
    return dot(this.d, this.axis);
  }

  private measure(w: World3): void {
    this.frame(w);
    this.axis = rotOf(w, this.a, ...this.axA);
    [this.t1, this.t2] = across(this.axis);
    const pa = posOf(w, this.a);
    const pb = posOf(w, this.b);
    this.d = [pb[0] + this.rb[0] - pa[0] - this.ra[0], pb[1] + this.rb[1] - pa[1] - this.ra[1], pb[2] + this.rb[2] - pa[2] - this.ra[2]];
  }

  /** One linear row along t: [−t, −(ra + d) × t, t, rb × t]. */
  private parts(w: World3, t: V): { ga: V; gb: V; m: number } {
    const ga = cross([this.ra[0] + this.d[0], this.ra[1] + this.d[1], this.ra[2] + this.d[2]], t);
    const gb = cross(this.rb, t);
    const k = (w.invM[this.a] as number) + (w.invM[this.b] as number) + dot(ga, invI(w, this.a, ga)) + dot(gb, invI(w, this.b, gb));
    return { ga, gb, m: k > 0 ? 1 / k : 0 };
  }

  private applyRow(w: World3, t: V, ga: V, gb: V, d: number): void {
    const ma = (w.invM[this.a] as number) * d;
    const mb = (w.invM[this.b] as number) * d;
    for (let k = 0; k < 3; k++) {
      w.v[this.a * 3 + k] = (w.v[this.a * 3 + k] as number) - ma * (t[k] as number);
      w.v[this.b * 3 + k] = (w.v[this.b * 3 + k] as number) + mb * (t[k] as number);
    }
    spin(w, this.a, -d, ga);
    spin(w, this.b, d, gb);
  }

  private row(w: World3, t: V, target: number, acc: number, lo: number, hi: number): number {
    const { ga, gb, m } = this.parts(w, t);
    const cdot = dot(t, [(w.v[this.b * 3] as number) - (w.v[this.a * 3] as number), (w.v[this.b * 3 + 1] as number) - (w.v[this.a * 3 + 1] as number), (w.v[this.b * 3 + 2] as number) - (w.v[this.a * 3 + 2] as number)]) + dot(gb, spinOf(w, this.b)) - dot(ga, spinOf(w, this.a)) - target;
    const nw = Math.max(lo, Math.min(hi, acc - m * cdot));
    const d = nw - acc;
    if (d !== 0) this.applyRow(w, t, ga, gb, d);
    return nw;
  }

  initVelocity(w: World3): void {
    this.measure(w);
    this.lock.init(w, this.a, this.b);
    if (this.opts.motor === undefined) this.motorImp = 0;
    const axial = this.motorImp + this.lowImp - this.upImp;
    for (const [t, acc] of [[this.t1, this.perp[0]], [this.t2, this.perp[1]], [this.axis, axial]] as const) {
      if (acc === 0) continue;
      const { ga, gb } = this.parts(w, t);
      this.applyRow(w, t, ga, gb, acc);
    }
  }

  solveVelocity(w: World3, h: number): void {
    const inv_h = 1 / h;
    const s = dot(this.d, this.axis);
    if (this.opts.motor !== undefined) {
      const max = (this.opts.force ?? 1e9) * h;
      this.motorImp = this.row(w, this.axis, this.opts.motor, this.motorImp, -max, max);
    }
    if (this.opts.min !== undefined) {
      const C = s - this.opts.min;
      this.lowImp = this.row(w, this.axis, C > 0 ? -C * inv_h : 0, this.lowImp, 0, Infinity);
    }
    if (this.opts.max !== undefined) {
      const C = this.opts.max - s;
      this.upImp = -this.row(w, this.axis, C > 0 ? C * inv_h : 0, -this.upImp, -Infinity, 0);
    }
    this.lock.solve(w, this.a, this.b);
    this.perp = [this.row(w, this.t1, 0, this.perp[0], -Infinity, Infinity), this.row(w, this.t2, 0, this.perp[1], -Infinity, Infinity)];
    const ax = this.motorImp + this.lowImp - this.upImp;
    this.lin = [0, 1, 2].map((k) => this.perp[0] * (this.t1[k] as number) + this.perp[1] * (this.t2[k] as number) + ax * (this.axis[k] as number)) as V;
    this.impulse = lenOf(this.lin);
  }

  solvePosition(w: World3): boolean {
    const ang = this.lock.position(w, this.a, this.b);
    this.measure(w);
    let worst = 0;
    const fix = (t: V, C: number): void => {
      const c = Math.max(-MAX_LIN, Math.min(MAX_LIN, C));
      const { ga, gb, m } = this.parts(w, t);
      const d = -m * c;
      shift(w, this.a, [-(w.invM[this.a] as number) * d * t[0], -(w.invM[this.a] as number) * d * t[1], -(w.invM[this.a] as number) * d * t[2]]);
      shift(w, this.b, [(w.invM[this.b] as number) * d * t[0], (w.invM[this.b] as number) * d * t[1], (w.invM[this.b] as number) * d * t[2]]);
      const ta = invI(w, this.a, ga);
      const tb = invI(w, this.b, gb);
      turnBy(w, this.a, [-ta[0] * d, -ta[1] * d, -ta[2] * d]);
      turnBy(w, this.b, [tb[0] * d, tb[1] * d, tb[2] * d]);
      worst = Math.max(worst, Math.abs(C));
    };
    fix(this.t1, dot(this.d, this.t1));
    this.measure(w);
    fix(this.t2, dot(this.d, this.t2));
    this.measure(w);
    const s = dot(this.d, this.axis);
    if (this.opts.min !== undefined && s < this.opts.min - LINEAR_SLOP) fix(this.axis, s - this.opts.min);
    else if (this.opts.max !== undefined && s > this.opts.max + LINEAR_SLOP) fix(this.axis, s - this.opts.max);
    return worst <= LINEAR_SLOP && ang <= ANGULAR_SLOP;
  }

  save(out: number[]): void {
    out.push(...this.lock.imp, ...this.perp, this.motorImp, this.lowImp, this.upImp);
  }

  load(s: Float64Array, k: number): number {
    this.lock.imp = [s[k++] as number, s[k++] as number, s[k++] as number];
    this.perp = [s[k++] as number, s[k++] as number];
    this.motorImp = s[k++] as number;
    this.lowImp = s[k++] as number;
    this.upImp = s[k++] as number;
    return k;
  }
}

/* ------------------------------ the ray wheel ------------------------------ */

export interface Wheel3Spec {
  readonly r: number;
  readonly spring: number;
  readonly damping: number;
  readonly travel: number;
  readonly grip: number;
  readonly drive: boolean;
  readonly steers: boolean;
  /** The spring force over which the wheel comes off (0: never). */
  readonly breaks: number;
  readonly mass: number;
}

/**
 * A ray wheel on a chassis (design 8). Each step it casts a ray from its mount down the chassis's own down direction,
 * `travel + r` long, against the floor, terrain, solids and bodies. Where it hits, the spring and damper push the
 * chassis up (and the thing it stands on down), and the tyre's grip gives forward and side forces at the touch point,
 * within `grip` times the spring's push (the friction rule of 6.5). The wheel's own spin is a state: the motor turns it
 * through the power, the brake holds it, and the ground turns it as it rolls. A car faces its chassis's own x axis.
 */
export class Wheel3 implements Joint3 {
  readonly kind = FK3.normal;
  broken = false;
  /** The world never breaks a wheel by its impulse: the wheel breaks itself on its spring force. */
  readonly breaks = 0;
  impulse = 0;
  readonly b: number;
  /** What the vehicle asks of it this step. */
  motor = 0;
  steer = 0;
  brake = 0;
  power = 0;
  /** How many wheels the vehicle's power is shared between. */
  share = 1;
  /** Spin about its axle, rad/s (positive rolls the car forward), and how far it has turned. */
  spin = 0;
  turn = 0;
  /** From the mount to the wheel's centre now, m, and the spring's push, N. */
  susp: number;
  push = 0;
  touching = false;
  private latI = 0;
  private lonI = 0;
  private brakeI = 0;
  private ground = 0;
  private ra: V = [0, 0, 0];
  private rb: V = [0, 0, 0];
  private up: V = [0, 0, 1];
  private f: V = [1, 0, 0];
  private s: V = [0, 1, 0];
  private mLat = 0;
  private mLon = 0;
  private maxF = 0;
  private maxB = 0;
  private readonly Iw: number;
  constructor(readonly a: number, readonly mount: V, readonly spec: Wheel3Spec, readonly body: number, private readonly skip: (i: number) => boolean) {
    this.b = a;
    this.susp = spec.travel;
    this.Iw = Math.max(1e-6, 0.5 * spec.mass * spec.r * spec.r);
  }

  /** The direction the wheel faces and its axle, in the world, with the steer. */
  private dirs(w: World3): { f: V; s: V; down: V } {
    const d = this.spec.steers ? this.steer : 0;
    const c = d === 0 ? 1 : cos(d);
    const sn = d === 0 ? 0 : sin(d);
    return { f: rotOf(w, this.a, c, sn, 0), s: rotOf(w, this.a, -sn, c, 0), down: rotOf(w, this.a, 0, 0, -1) };
  }

  /** The wheel's centre now, its axle and the way it faces (world). */
  pose(w: World3): { c: P3; axle: P3; fwd: P3 } {
    const m = w.toWorld(this.a, this.mount[0], this.mount[1], this.mount[2]);
    const { f, s, down } = this.dirs(w);
    const l = Math.max(0, this.susp);
    return { c: { x: m[0] + down[0] * l, y: m[1] + down[1] * l, z: m[2] + down[2] * l }, axle: { x: s[0], y: s[1], z: s[2] }, fwd: { x: f[0], y: f[1], z: f[2] } };
  }

  initVelocity(w: World3, h: number): void {
    this.turn += this.spin * h;
    this.brakeI = 0;
    const r = this.spec.r;
    const m = w.toWorld(this.a, this.mount[0], this.mount[1], this.mount[2]);
    const { f, down } = this.dirs(w);
    this.up = [-down[0], -down[1], -down[2]];
    const hit = w.rayCast(m[0], m[1], m[2], down[0], down[1], down[2], this.spec.travel + r, this.skip);
    // the motor: the power shared by the driven wheels, as a torque at this spin, no more than the tyre can pass on
    const driveT = (fs: number): number => {
      if (!this.spec.drive || this.motor === 0 || this.power <= 0) return 0;
      const p = (Math.abs(this.motor) * this.power) / this.share;
      const cap = Math.max(this.spec.grip * fs * r, 0.05 * this.spec.mass * 9.8 * r);
      return Math.sign(this.motor) * Math.min(p / Math.max(Math.abs(this.spin), 1), cap);
    };
    if (!hit) {
      // in the air: the wheel hangs at full travel and spins free
      this.touching = false;
      this.susp = this.spec.travel;
      this.push = 0;
      this.latI = 0;
      this.lonI = 0;
      this.spin = (this.spin + (driveT(0) * h) / this.Iw) / (1 + 0.5 * h);
      this.maxB = this.brake * 1.5 * this.spec.grip * this.spec.mass * 9.8 * r * h;
      return;
    }
    this.ground = hit.body;
    this.touching = true;
    this.susp = hit.t - r;
    const P: V = [m[0] + down[0] * hit.t, m[1] + down[1] * hit.t, m[2] + down[2] * hit.t];
    const pg = posOf(w, this.ground);
    const pc = posOf(w, this.a);
    this.ra = [P[0] - pg[0], P[1] - pg[1], P[2] - pg[2]];
    this.rb = [P[0] - pc[0], P[1] - pc[1], P[2] - pc[2]];
    const vc = velAt(w, this.a, this.rb);
    const vg = velAt(w, this.ground, this.ra);
    const vrel: V = [vc[0] - vg[0], vc[1] - vg[1], vc[2] - vg[2]];
    // the spring and the damper, measured down the chassis from the mount; the ground takes their push along its
    // normal at the touch point, so a tilted chassis is not pushed along the road (the tyre holds it there)
    const x = this.spec.travel - this.susp;
    this.push = Math.max(0, this.spec.spring * x + this.spec.damping * dot(vrel, down));
    if (this.spec.breaks > 0 && this.push > this.spec.breaks) {
      this.breakOff(w);
      return;
    }
    const n: V = [hit.nx, hit.ny, hit.nz];
    this.up = n;
    const J = this.push * h;
    push(w, this.a, 1, this.rb, [n[0] * J, n[1] * J, n[2] * J]);
    push(w, this.ground, -1, this.ra, [n[0] * J, n[1] * J, n[2] * J]);
    // the tyre's frame on the ground
    const fn = dot(f, n);
    this.f = unitOf([f[0] - n[0] * fn, f[1] - n[1] * fn, f[2] - n[2] * fn]);
    this.s = cross(n, this.f);
    const k = (t: V): number => {
      const cb = cross(this.rb, t);
      const ca = cross(this.ra, t);
      return (w.invM[this.a] as number) + (w.invM[this.ground] as number) + dot(cb, invI(w, this.a, cb)) + dot(ca, invI(w, this.ground, ca));
    };
    const kl = k(this.s);
    this.mLat = kl > 0 ? 1 / kl : 0;
    this.mLon = 1 / (k(this.f) + (r * r) / this.Iw);
    this.maxF = this.spec.grip * this.push * h;
    this.maxB = this.brake * 1.5 * this.spec.grip * Math.max(this.push, this.spec.mass * 9.8) * r * h;
    this.spin += (driveT(this.push) * h) / this.Iw;
    // warm start: last step's tyre impulses, kept inside this step's grip
    this.lonI = Math.max(-this.maxF, Math.min(this.maxF, this.lonI));
    const side = Math.sqrt(Math.max(0, this.maxF * this.maxF - this.lonI * this.lonI));
    this.latI = Math.max(-side, Math.min(side, this.latI));
    this.tyre(w, this.lonI, this.latI);
  }

  /** Tyre impulses along the way it faces and across it: the chassis forward, the ground back, the wheel's spin. */
  private tyre(w: World3, lon: number, lat: number): void {
    if (lon === 0 && lat === 0) return;
    const P: V = [this.f[0] * lon + this.s[0] * lat, this.f[1] * lon + this.s[1] * lat, this.f[2] * lon + this.s[2] * lat];
    push(w, this.a, 1, this.rb, P);
    push(w, this.ground, -1, this.ra, P);
    this.spin -= (lon * this.spec.r) / this.Iw;
  }

  solveVelocity(w: World3): void {
    if (this.broken) return;
    if (this.maxB > 0) {
      const old = this.brakeI;
      this.brakeI = Math.max(-this.maxB, Math.min(this.maxB, old - this.spin * this.Iw));
      this.spin += (this.brakeI - old) / this.Iw;
    }
    if (!this.touching) return;
    const vrel = (): V => {
      const vc = velAt(w, this.a, this.rb);
      const vg = velAt(w, this.ground, this.ra);
      return [vc[0] - vg[0], vc[1] - vg[1], vc[2] - vg[2]];
    };
    // forward: the slip of the tyre on the ground goes to nothing, within the grip
    const slip = dot(this.f, vrel()) - this.spin * this.spec.r;
    const lon = Math.max(-this.maxF, Math.min(this.maxF, this.lonI - slip * this.mLon));
    const dl = lon - this.lonI;
    this.lonI = lon;
    this.tyre(w, dl, 0);
    // across: no sliding sideways, within what the grip has left
    const side = Math.sqrt(Math.max(0, this.maxF * this.maxF - this.lonI * this.lonI));
    const lat = Math.max(-side, Math.min(side, this.latI - dot(this.s, vrel()) * this.mLat));
    const ds = lat - this.latI;
    this.latI = lat;
    this.tyre(w, 0, ds);
    this.impulse = this.push;
  }

  solvePosition(): boolean {
    return true;
  }

  energy(): number {
    if (!this.touching) return 0;
    const x = Math.max(0, this.spec.travel - this.susp);
    return 0.5 * this.spec.spring * x * x;
  }

  account(w: World3, inv_h: number): void {
    if (!this.touching) return;
    const u = this.up;
    const N = this.push;
    w.account(this.a, FK3.normal, u[0] * N, u[1] * N, u[2] * N);
    w.account(this.ground, FK3.normal, -u[0] * N, -u[1] * N, -u[2] * N);
    const fx = (this.f[0] * this.lonI + this.s[0] * this.latI) * inv_h;
    const fy = (this.f[1] * this.lonI + this.s[1] * this.latI) * inv_h;
    const fz = (this.f[2] * this.lonI + this.s[2] * this.latI) * inv_h;
    w.account(this.a, FK3.friction, fx, fy, fz);
    w.account(this.ground, FK3.friction, -fx, -fy, -fz);
  }

  /** The wheel comes off: from now it is a free body, a round slab with the wheel's speed and spin (design 8). */
  private breakOff(w: World3): void {
    this.broken = true;
    this.touching = false;
    this.push = 0;
    if (this.body < 0) return;
    const { c, axle } = this.pose(w);
    const pc = posOf(w, this.a);
    const v = velAt(w, this.a, [c.x - pc[0], c.y - pc[1], c.z - pc[2]]);
    const om = spinOf(w, this.a);
    // the waiting body is a slab round the chassis's own y axis: turn it as the chassis, the steer, then the spin
    const qs = quatHalf(this.spec.steers ? this.steer : 0);
    const qt = quatHalf(this.turn);
    const q = qmul(qmul(quatOf(w, this.a), [qs[1], 0, 0, qs[0]]), [qt[1], 0, qt[0], 0]);
    const l = Math.sqrt((q[0] as number) ** 2 + (q[1] as number) ** 2 + (q[2] as number) ** 2 + (q[3] as number) ** 2) || 1;
    w.activate(this.body, c, [(q[0] as number) / l, (q[1] as number) / l, (q[2] as number) / l, (q[3] as number) / l], { x: v[0], y: v[1], z: v[2] }, { x: om[0] + this.spin * axle.x, y: om[1] + this.spin * axle.y, z: om[2] + this.spin * axle.z });
  }

  save(out: number[]): void {
    out.push(this.spin, this.turn, this.susp, this.push, this.touching ? 1 : 0, this.latI, this.lonI);
  }

  load(s: Float64Array, k: number): number {
    this.spin = s[k++] as number;
    this.turn = s[k++] as number;
    this.susp = s[k++] as number;
    this.push = s[k++] as number;
    this.touching = s[k++] === 1;
    this.latI = s[k++] as number;
    this.lonI = s[k++] as number;
    return k;
  }
}

/** sin and cos of half an angle, from the exact maths: [sin(a / 2), cos(a / 2)]. */
function quatHalf(a: number): [number, number] {
  const q = quatAxis(1, 0, 0, a);
  return [q[1], q[0]];
}
