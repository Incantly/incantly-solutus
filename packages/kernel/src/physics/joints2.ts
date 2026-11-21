/**
 * Joints in the plane (docs/features/physics/design.md 2.4, 6.5): hinge (with motor and angle limits), rod, rope, spring,
 * weld (that can break), slider (with motor and limits), pulley and grab. Each is a set of velocity rows solved with the
 * contacts in sequential impulses, and a position pass that removes drift. Anchors are kept in each body's frame.
 * Exact operations only.
 */
import type { Joint2, World2 } from './world2';
import { FK, LINEAR_SLOP } from './world2';

const ANGULAR_SLOP = (2 / 180) * Math.PI;
const MAX_LIN = 0.2;
const MAX_ANG = (8 / 180) * Math.PI;

/** A world point on body i from a point in its frame. */
function rot(w: World2, i: number, x: number, y: number): [number, number] {
  const c = w.qc[i] as number;
  const s = w.qs[i] as number;
  return [c * x - s * y, s * x + c * y];
}

function applyP(w: World2, a: number, b: number, rAx: number, rAy: number, rBx: number, rBy: number, Px: number, Py: number): void {
  w.vx[a] = (w.vx[a] as number) - (w.invM[a] as number) * Px;
  w.vy[a] = (w.vy[a] as number) - (w.invM[a] as number) * Py;
  w.w[a] = (w.w[a] as number) - (w.invI[a] as number) * (rAx * Py - rAy * Px);
  w.vx[b] = (w.vx[b] as number) + (w.invM[b] as number) * Px;
  w.vy[b] = (w.vy[b] as number) + (w.invM[b] as number) * Py;
  w.w[b] = (w.w[b] as number) + (w.invI[b] as number) * (rBx * Py - rBy * Px);
}

function moveP(w: World2, a: number, b: number, rAx: number, rAy: number, rBx: number, rBy: number, Px: number, Py: number): void {
  w.px[a] = (w.px[a] as number) - (w.invM[a] as number) * Px;
  w.py[a] = (w.py[a] as number) - (w.invM[a] as number) * Py;
  w.ang[a] = (w.ang[a] as number) - (w.invI[a] as number) * (rAx * Py - rAy * Px);
  w.px[b] = (w.px[b] as number) + (w.invM[b] as number) * Px;
  w.py[b] = (w.py[b] as number) + (w.invM[b] as number) * Py;
  w.ang[b] = (w.ang[b] as number) + (w.invI[b] as number) * (rBx * Py - rBy * Px);
  if (w.invI[a] !== 0) w.setRot(a);
  if (w.invI[b] !== 0) w.setRot(b);
}

/** Relative speed of the anchor of b against the anchor of a. */
function relV(w: World2, a: number, b: number, rAx: number, rAy: number, rBx: number, rBy: number): [number, number] {
  return [
    (w.vx[b] as number) - (w.w[b] as number) * rBy - (w.vx[a] as number) + (w.w[a] as number) * rAy,
    (w.vy[b] as number) + (w.w[b] as number) * rBx - (w.vy[a] as number) - (w.w[a] as number) * rAx,
  ];
}

/** Anchors in body frames from a world point at the start (both bodies at angle 0 then). */
export function localAnchor(w: World2, i: number, x: number, y: number): [number, number] {
  const c = w.qc[i] as number;
  const s = w.qs[i] as number;
  const dx = x - (w.px[i] as number);
  const dy = y - (w.py[i] as number);
  return [c * dx + s * dy, -s * dx + c * dy];
}

abstract class Base implements Joint2 {
  broken = false;
  impulseX = 0;
  impulseY = 0;
  collide = false;
  abstract readonly kind: number;
  breaks = 0;
  constructor(readonly a: number, readonly b: number) {}
  abstract initVelocity(w: World2, h: number): void;
  abstract warmStart(w: World2): void;
  abstract solveVelocity(w: World2, h: number): void;
  abstract solvePosition(w: World2): boolean;
  abstract save(out: number[]): void;
  abstract load(src: Float64Array, at: number): number;
  energy(_w: World2): number {
    return 0;
  }
  /** The force it carries now, N (j.force). */
  force(h: number): number {
    return Math.sqrt(this.impulseX * this.impulseX + this.impulseY * this.impulseY) / h;
  }
  /** Its length or angle now, for j.length and j.angle. */
  length(_w: World2): number {
    return 0;
  }
  angle(_w: World2): number {
    return 0;
  }
}

/* ------------------------------ hinge ------------------------------ */

export interface HingeOptions {
  readonly motor?: number;
  readonly torque?: number;
  readonly min?: number;
  readonly max?: number;
}

export class Hinge2 extends Base {
  readonly kind = FK.tension;
  private ix = 0;
  private iy = 0;
  private motorImp = 0;
  private lowImp = 0;
  private upImp = 0;
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  private k11 = 0;
  private k12 = 0;
  private k22 = 0;
  private axial = 0;
  private refAngle: number;
  constructor(w: World2, a: number, b: number, private readonly la: [number, number], private readonly lb: [number, number], public opts: HingeOptions) {
    super(a, b);
    this.refAngle = (w.ang[b] as number) - (w.ang[a] as number);
  }

  override angle(w: World2): number {
    return (w.ang[this.b] as number) - (w.ang[this.a] as number) - this.refAngle;
  }

  initVelocity(w: World2): void {
    const { a, b } = this;
    [this.rAx, this.rAy] = rot(w, a, this.la[0], this.la[1]);
    [this.rBx, this.rBy] = rot(w, b, this.lb[0], this.lb[1]);
    const mA = w.invM[a] as number;
    const mB = w.invM[b] as number;
    const iA = w.invI[a] as number;
    const iB = w.invI[b] as number;
    this.k11 = mA + mB + this.rAy * this.rAy * iA + this.rBy * this.rBy * iB;
    this.k12 = -this.rAy * this.rAx * iA - this.rBy * this.rBx * iB;
    this.k22 = mA + mB + this.rAx * this.rAx * iA + this.rBx * this.rBx * iB;
    this.axial = iA + iB > 0 ? 1 / (iA + iB) : 0;
    if (this.opts.motor === undefined) this.motorImp = 0;
  }

  warmStart(w: World2): void {
    const { a, b } = this;
    applyP(w, a, b, this.rAx, this.rAy, this.rBx, this.rBy, this.ix, this.iy);
    const axialImp = this.motorImp + this.lowImp - this.upImp;
    w.w[a] = (w.w[a] as number) - (w.invI[a] as number) * axialImp;
    w.w[b] = (w.w[b] as number) + (w.invI[b] as number) * axialImp;
  }

  solveVelocity(w: World2, h: number): void {
    const { a, b } = this;
    const iA = w.invI[a] as number;
    const iB = w.invI[b] as number;
    const inv_h = 1 / h;
    if (this.opts.motor !== undefined && this.axial > 0) {
      const cdot = (w.w[b] as number) - (w.w[a] as number) - this.opts.motor;
      const max = (this.opts.torque ?? 1e9) * h;
      const old = this.motorImp;
      this.motorImp = Math.max(-max, Math.min(max, old - this.axial * cdot));
      const d = this.motorImp - old;
      w.w[a] = (w.w[a] as number) - iA * d;
      w.w[b] = (w.w[b] as number) + iB * d;
    }
    if (this.axial > 0 && this.opts.min !== undefined) {
      const C = this.angle(w) - this.opts.min;
      const cdot = (w.w[b] as number) - (w.w[a] as number);
      const old = this.lowImp;
      this.lowImp = Math.max(0, old - this.axial * (cdot + (C > 0 ? C * inv_h : 0)));
      const d = this.lowImp - old;
      w.w[a] = (w.w[a] as number) - iA * d;
      w.w[b] = (w.w[b] as number) + iB * d;
    }
    if (this.axial > 0 && this.opts.max !== undefined) {
      const C = this.opts.max - this.angle(w);
      const cdot = (w.w[a] as number) - (w.w[b] as number);
      const old = this.upImp;
      this.upImp = Math.max(0, old - this.axial * (cdot + (C > 0 ? C * inv_h : 0)));
      const d = this.upImp - old;
      w.w[a] = (w.w[a] as number) + iA * d;
      w.w[b] = (w.w[b] as number) - iB * d;
    }
    const [cx, cy] = relV(w, a, b, this.rAx, this.rAy, this.rBx, this.rBy);
    const det = this.k11 * this.k22 - this.k12 * this.k12;
    if (det === 0) return;
    const dx = -(this.k22 * cx - this.k12 * cy) / det;
    const dy = -(-this.k12 * cx + this.k11 * cy) / det;
    this.ix += dx;
    this.iy += dy;
    applyP(w, a, b, this.rAx, this.rAy, this.rBx, this.rBy, dx, dy);
    this.impulseX = this.ix;
    this.impulseY = this.iy;
  }

  solvePosition(w: World2): boolean {
    const { a, b } = this;
    let angErr = 0;
    const iA = w.invI[a] as number;
    const iB = w.invI[b] as number;
    if (iA + iB > 0 && (this.opts.min !== undefined || this.opts.max !== undefined)) {
      const ang = this.angle(w);
      let C = 0;
      if (this.opts.min !== undefined && ang < this.opts.min) C = Math.max(-MAX_ANG, ang - this.opts.min + ANGULAR_SLOP);
      else if (this.opts.max !== undefined && ang > this.opts.max) C = Math.min(MAX_ANG, ang - this.opts.max - ANGULAR_SLOP);
      if (C !== 0) {
        const imp = -C / (iA + iB);
        w.ang[a] = (w.ang[a] as number) - iA * imp;
        w.ang[b] = (w.ang[b] as number) + iB * imp;
        if (iA !== 0) w.setRot(a);
        if (iB !== 0) w.setRot(b);
        angErr = Math.abs(C);
      }
    }
    const [rAx, rAy] = rot(w, a, this.la[0], this.la[1]);
    const [rBx, rBy] = rot(w, b, this.lb[0], this.lb[1]);
    const Cx = (w.px[b] as number) + rBx - (w.px[a] as number) - rAx;
    const Cy = (w.py[b] as number) + rBy - (w.py[a] as number) - rAy;
    const mA = w.invM[a] as number;
    const mB = w.invM[b] as number;
    const k11 = mA + mB + rAy * rAy * iA + rBy * rBy * iB;
    const k12 = -rAy * rAx * iA - rBy * rBx * iB;
    const k22 = mA + mB + rAx * rAx * iA + rBx * rBx * iB;
    const det = k11 * k22 - k12 * k12;
    if (det !== 0) {
      const Px = -(k22 * Cx - k12 * Cy) / det;
      const Py = -(-k12 * Cx + k11 * Cy) / det;
      moveP(w, a, b, rAx, rAy, rBx, rBy, Px, Py);
    }
    return Math.sqrt(Cx * Cx + Cy * Cy) <= LINEAR_SLOP && angErr <= ANGULAR_SLOP;
  }

  save(out: number[]): void {
    out.push(this.ix, this.iy, this.motorImp, this.lowImp, this.upImp);
  }

  load(s: Float64Array, k: number): number {
    this.ix = s[k++] as number;
    this.iy = s[k++] as number;
    this.motorImp = s[k++] as number;
    this.lowImp = s[k++] as number;
    this.upImp = s[k++] as number;
    return k;
  }
}

/* ------------------------------ rod, rope and spring ------------------------------ */

export type DistanceKind = 'rod' | 'rope' | 'spring';

export class Distance2 extends Base {
  readonly kind: number;
  private imp = 0;
  private ux = 0;
  private uy = 0;
  private len = 0;
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  private mass = 0;
  constructor(
    a: number,
    b: number,
    private readonly la: [number, number],
    private readonly lb: [number, number],
    readonly mode: DistanceKind,
    /** Rod and rope: the length; spring: the rest length. */
    readonly L: number,
    readonly k = 0,
    readonly damping = 0,
  ) {
    super(a, b);
    this.kind = mode === 'spring' ? FK.spring : FK.tension;
  }

  private frame(w: World2): void {
    const { a, b } = this;
    [this.rAx, this.rAy] = rot(w, a, this.la[0], this.la[1]);
    [this.rBx, this.rBy] = rot(w, b, this.lb[0], this.lb[1]);
    const dx = (w.px[b] as number) + this.rBx - (w.px[a] as number) - this.rAx;
    const dy = (w.py[b] as number) + this.rBy - (w.py[a] as number) - this.rAy;
    this.len = Math.sqrt(dx * dx + dy * dy);
    if (this.len > 1e-12) {
      this.ux = dx / this.len;
      this.uy = dy / this.len;
    } else {
      this.ux = 0;
      this.uy = 0;
    }
    const crA = this.rAx * this.uy - this.rAy * this.ux;
    const crB = this.rBx * this.uy - this.rBy * this.ux;
    const m = (w.invM[a] as number) + (w.invI[a] as number) * crA * crA + (w.invM[b] as number) + (w.invI[b] as number) * crB * crB;
    this.mass = m > 0 ? 1 / m : 0;
  }

  override length(w: World2): number {
    this.frame(w);
    return this.len;
  }

  initVelocity(w: World2, h: number): void {
    this.frame(w);
    if (this.mode === 'spring') {
      // a spring is a force, not a constraint: F = -k (L - rest) - c (rate of stretch)
      const [vx, vy] = relV(w, this.a, this.b, this.rAx, this.rAy, this.rBx, this.rBy);
      const rate = vx * this.ux + vy * this.uy;
      const f = -this.k * (this.len - this.L) - this.damping * rate;
      const I = f * h;
      applyP(w, this.a, this.b, this.rAx, this.rAy, this.rBx, this.rBy, I * this.ux, I * this.uy);
      this.impulseX = I * this.ux;
      this.impulseY = I * this.uy;
      this.imp = 0;
    } else if (this.mode === 'rope' && this.len < this.L - LINEAR_SLOP) {
      this.imp = 0;
    }
  }

  warmStart(w: World2): void {
    if (this.mode === 'spring' || this.imp === 0) return;
    applyP(w, this.a, this.b, this.rAx, this.rAy, this.rBx, this.rBy, this.imp * this.ux, this.imp * this.uy);
  }

  solveVelocity(w: World2, h: number): void {
    if (this.mode === 'spring' || this.mass === 0) return;
    const [vx, vy] = relV(w, this.a, this.b, this.rAx, this.rAy, this.rBx, this.rBy);
    const cdot = vx * this.ux + vy * this.uy;
    const old = this.imp;
    if (this.mode === 'rod') this.imp = old - this.mass * cdot;
    else {
      // a rope only pulls; while slack it lets the ends close the gap this step, but not stretch past it
      const C = this.len - this.L;
      const bias = C < 0 ? C / h : 0;
      this.imp = Math.min(0, old - this.mass * (cdot + bias));
    }
    const d = this.imp - old;
    if (d !== 0) applyP(w, this.a, this.b, this.rAx, this.rAy, this.rBx, this.rBy, d * this.ux, d * this.uy);
    this.impulseX = this.imp * this.ux;
    this.impulseY = this.imp * this.uy;
  }

  solvePosition(w: World2): boolean {
    if (this.mode === 'spring') return true;
    this.frame(w);
    let C = this.len - this.L;
    if (this.mode === 'rope' && C <= 0) return true;
    C = Math.max(-MAX_LIN, Math.min(MAX_LIN, C));
    const P = -this.mass * C;
    moveP(w, this.a, this.b, this.rAx, this.rAy, this.rBx, this.rBy, P * this.ux, P * this.uy);
    return Math.abs(C) < LINEAR_SLOP;
  }

  override energy(w: World2): number {
    if (this.mode !== 'spring') return 0;
    this.frame(w);
    return 0.5 * this.k * (this.len - this.L) * (this.len - this.L);
  }

  override force(h: number): number {
    return Math.sqrt(this.impulseX * this.impulseX + this.impulseY * this.impulseY) / h;
  }

  save(out: number[]): void {
    out.push(this.imp);
  }

  load(s: Float64Array, k: number): number {
    this.imp = s[k++] as number;
    return k;
  }
}

/* ------------------------------ weld ------------------------------ */

export class Weld2 extends Base {
  readonly kind = FK.tension;
  private ix = 0;
  private iy = 0;
  private iw = 0;
  private readonly refAngle: number;
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  constructor(w: World2, a: number, b: number, private readonly la: [number, number], private readonly lb: [number, number], breaks: number) {
    super(a, b);
    this.refAngle = (w.ang[b] as number) - (w.ang[a] as number);
    this.breaks = breaks;
  }

  initVelocity(w: World2): void {
    [this.rAx, this.rAy] = rot(w, this.a, this.la[0], this.la[1]);
    [this.rBx, this.rBy] = rot(w, this.b, this.lb[0], this.lb[1]);
  }

  warmStart(w: World2): void {
    applyP(w, this.a, this.b, this.rAx, this.rAy, this.rBx, this.rBy, this.ix, this.iy);
    w.w[this.a] = (w.w[this.a] as number) - (w.invI[this.a] as number) * this.iw;
    w.w[this.b] = (w.w[this.b] as number) + (w.invI[this.b] as number) * this.iw;
  }

  solveVelocity(w: World2): void {
    const { a, b } = this;
    const mA = w.invM[a] as number;
    const mB = w.invM[b] as number;
    const iA = w.invI[a] as number;
    const iB = w.invI[b] as number;
    if (iA + iB > 0) {
      const cdot = (w.w[b] as number) - (w.w[a] as number);
      const d = -cdot / (iA + iB);
      this.iw += d;
      w.w[a] = (w.w[a] as number) - iA * d;
      w.w[b] = (w.w[b] as number) + iB * d;
    }
    const [cx, cy] = relV(w, a, b, this.rAx, this.rAy, this.rBx, this.rBy);
    const k11 = mA + mB + this.rAy * this.rAy * iA + this.rBy * this.rBy * iB;
    const k12 = -this.rAy * this.rAx * iA - this.rBy * this.rBx * iB;
    const k22 = mA + mB + this.rAx * this.rAx * iA + this.rBx * this.rBx * iB;
    const det = k11 * k22 - k12 * k12;
    if (det === 0) return;
    const dx = -(k22 * cx - k12 * cy) / det;
    const dy = -(-k12 * cx + k11 * cy) / det;
    this.ix += dx;
    this.iy += dy;
    applyP(w, a, b, this.rAx, this.rAy, this.rBx, this.rBy, dx, dy);
    this.impulseX = this.ix;
    this.impulseY = this.iy;
  }

  solvePosition(w: World2): boolean {
    const { a, b } = this;
    const iA = w.invI[a] as number;
    const iB = w.invI[b] as number;
    const C = (w.ang[b] as number) - (w.ang[a] as number) - this.refAngle;
    if (iA + iB > 0 && C !== 0) {
      const imp = -Math.max(-MAX_ANG, Math.min(MAX_ANG, C)) / (iA + iB);
      w.ang[a] = (w.ang[a] as number) - iA * imp;
      w.ang[b] = (w.ang[b] as number) + iB * imp;
      if (iA !== 0) w.setRot(a);
      if (iB !== 0) w.setRot(b);
    }
    const [rAx, rAy] = rot(w, a, this.la[0], this.la[1]);
    const [rBx, rBy] = rot(w, b, this.lb[0], this.lb[1]);
    const Cx = (w.px[b] as number) + rBx - (w.px[a] as number) - rAx;
    const Cy = (w.py[b] as number) + rBy - (w.py[a] as number) - rAy;
    const mA = w.invM[a] as number;
    const mB = w.invM[b] as number;
    const k11 = mA + mB + rAy * rAy * iA + rBy * rBy * iB;
    const k12 = -rAy * rAx * iA - rBy * rBx * iB;
    const k22 = mA + mB + rAx * rAx * iA + rBx * rBx * iB;
    const det = k11 * k22 - k12 * k12;
    if (det !== 0) moveP(w, a, b, rAx, rAy, rBx, rBy, -(k22 * Cx - k12 * Cy) / det, -(-k12 * Cx + k11 * Cy) / det);
    return Math.sqrt(Cx * Cx + Cy * Cy) <= LINEAR_SLOP && Math.abs(C) <= ANGULAR_SLOP;
  }

  override force(h: number): number {
    return Math.sqrt(this.ix * this.ix + this.iy * this.iy) / h;
  }

  save(out: number[]): void {
    out.push(this.ix, this.iy, this.iw);
  }

  load(s: Float64Array, k: number): number {
    this.ix = s[k++] as number;
    this.iy = s[k++] as number;
    this.iw = s[k++] as number;
    return k;
  }
}

/* ------------------------------ slider ------------------------------ */

export interface SliderOptions {
  readonly min?: number;
  readonly max?: number;
  readonly motor?: number;
  readonly force?: number;
  /** A spring along the axis toward 0 (a car's suspension). */
  readonly spring?: number;
  readonly damping?: number;
}

export class Slider2 extends Base {
  readonly kind = FK.tension;
  private ip = 0;
  private iw = 0;
  private im = 0;
  private il = 0;
  private iu = 0;
  private readonly refAngle: number;
  /** The axis in a's frame. */
  private readonly axl: [number, number];
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  private ax = 0;
  private ay = 0;
  private trans = 0;
  constructor(w: World2, a: number, b: number, private readonly la: [number, number], private readonly lb: [number, number], axis: [number, number], public opts: SliderOptions) {
    super(a, b);
    this.refAngle = (w.ang[b] as number) - (w.ang[a] as number);
    const l = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1]) || 1;
    const c = w.qc[a] as number;
    const s = w.qs[a] as number;
    const x = axis[0] / l;
    const y = axis[1] / l;
    this.axl = [c * x + s * y, -s * x + c * y];
  }

  override length(w: World2): number {
    this.frame(w);
    return this.trans;
  }

  private frame(w: World2): void {
    [this.rAx, this.rAy] = rot(w, this.a, this.la[0], this.la[1]);
    [this.rBx, this.rBy] = rot(w, this.b, this.lb[0], this.lb[1]);
    [this.ax, this.ay] = rot(w, this.a, this.axl[0], this.axl[1]);
    const dx = (w.px[this.b] as number) + this.rBx - (w.px[this.a] as number) - this.rAx;
    const dy = (w.py[this.b] as number) + this.rBy - (w.py[this.a] as number) - this.rAy;
    this.trans = dx * this.ax + dy * this.ay;
  }

  /** One row along a direction (x, y) through the anchors, accumulating into `acc`; returns the new total. */
  private row(w: World2, dx: number, dy: number, target: number, acc: number, lo: number, hi: number): number {
    const { a, b } = this;
    // the anchor of a seen from b's anchor, for the turning terms
    const d1x = (w.px[b] as number) + this.rBx - (w.px[a] as number);
    const d1y = (w.py[b] as number) + this.rBy - (w.py[a] as number);
    const sA = d1x * dy - d1y * dx;
    const sB = this.rBx * dy - this.rBy * dx;
    const mA = w.invM[a] as number;
    const mB = w.invM[b] as number;
    const iA = w.invI[a] as number;
    const iB = w.invI[b] as number;
    const k = mA + mB + iA * sA * sA + iB * sB * sB;
    if (!(k > 0)) return acc;
    const cdot = dx * ((w.vx[b] as number) - (w.vx[a] as number)) + dy * ((w.vy[b] as number) - (w.vy[a] as number)) + sB * (w.w[b] as number) - sA * (w.w[a] as number);
    const next = Math.max(lo, Math.min(hi, acc - (cdot - target) / k));
    const d = next - acc;
    w.vx[a] = (w.vx[a] as number) - mA * d * dx;
    w.vy[a] = (w.vy[a] as number) - mA * d * dy;
    w.w[a] = (w.w[a] as number) - iA * d * sA;
    w.vx[b] = (w.vx[b] as number) + mB * d * dx;
    w.vy[b] = (w.vy[b] as number) + mB * d * dy;
    w.w[b] = (w.w[b] as number) + iB * d * sB;
    return next;
  }

  initVelocity(w: World2, h: number): void {
    this.frame(w);
    if (this.opts.spring !== undefined && this.opts.spring > 0) {
      // the suspension spring is a force along the axis
      const { a, b } = this;
      const [vx, vy] = relV(w, a, b, this.rAx, this.rAy, this.rBx, this.rBy);
      const rate = vx * this.ax + vy * this.ay;
      const f = -this.opts.spring * this.trans - (this.opts.damping ?? 0) * rate;
      applyP(w, a, b, this.rAx, this.rAy, this.rBx, this.rBy, f * h * this.ax, f * h * this.ay);
    }
  }

  warmStart(_w: World2): void {
    // the rows are cheap and few; they start from zero each step
    this.ip = this.iw = this.im = this.il = this.iu = 0;
  }

  solveVelocity(w: World2, h: number): void {
    const { a, b } = this;
    const iA = w.invI[a] as number;
    const iB = w.invI[b] as number;
    if (iA + iB > 0) {
      const cdot = (w.w[b] as number) - (w.w[a] as number);
      const d = -cdot / (iA + iB);
      this.iw += d;
      w.w[a] = (w.w[a] as number) - iA * d;
      w.w[b] = (w.w[b] as number) + iB * d;
    }
    this.ip = this.row(w, -this.ay, this.ax, 0, this.ip, -Infinity, Infinity);
    if (this.opts.motor !== undefined) {
      const max = (this.opts.force ?? 1e9) * h;
      this.im = this.row(w, this.ax, this.ay, this.opts.motor, this.im, -max, max);
    }
    const inv_h = 1 / h;
    if (this.opts.min !== undefined) {
      const C = this.trans - this.opts.min;
      this.il = this.row(w, this.ax, this.ay, C > 0 ? -C * inv_h : 0, this.il, 0, Infinity);
    }
    if (this.opts.max !== undefined) {
      const C = this.opts.max - this.trans;
      this.iu = this.row(w, -this.ax, -this.ay, C > 0 ? -C * inv_h : 0, this.iu, 0, Infinity);
    }
    this.impulseX = -this.ay * this.ip;
    this.impulseY = this.ax * this.ip;
  }

  solvePosition(w: World2): boolean {
    const { a, b } = this;
    const iA = w.invI[a] as number;
    const iB = w.invI[b] as number;
    const C = (w.ang[b] as number) - (w.ang[a] as number) - this.refAngle;
    if (iA + iB > 0 && C !== 0) {
      const imp = -Math.max(-MAX_ANG, Math.min(MAX_ANG, C)) / (iA + iB);
      w.ang[a] = (w.ang[a] as number) - iA * imp;
      w.ang[b] = (w.ang[b] as number) + iB * imp;
      if (iA !== 0) w.setRot(a);
      if (iB !== 0) w.setRot(b);
    }
    this.frame(w);
    const dx = (w.px[b] as number) + this.rBx - (w.px[a] as number) - this.rAx;
    const dy = (w.py[b] as number) + this.rBy - (w.py[a] as number) - this.rAy;
    const perp = -this.ay * dx + this.ax * dy;
    const mA = w.invM[a] as number;
    const mB = w.invM[b] as number;
    let along = 0;
    if (this.opts.min !== undefined && this.trans < this.opts.min) along = this.trans - this.opts.min;
    else if (this.opts.max !== undefined && this.trans > this.opts.max) along = this.trans - this.opts.max;
    const m = mA + mB;
    if (m > 0) {
      const Px = (-(-this.ay) * Math.max(-MAX_LIN, Math.min(MAX_LIN, perp)) - this.ax * Math.max(-MAX_LIN, Math.min(MAX_LIN, along))) / m;
      const Py = (-this.ax * Math.max(-MAX_LIN, Math.min(MAX_LIN, perp)) - this.ay * Math.max(-MAX_LIN, Math.min(MAX_LIN, along))) / m;
      w.px[a] = (w.px[a] as number) - mA * Px;
      w.py[a] = (w.py[a] as number) - mA * Py;
      w.px[b] = (w.px[b] as number) + mB * Px;
      w.py[b] = (w.py[b] as number) + mB * Py;
    }
    return Math.abs(perp) <= LINEAR_SLOP && Math.abs(along) <= LINEAR_SLOP && Math.abs(C) <= ANGULAR_SLOP;
  }

  save(out: number[]): void {
    out.push(0);
  }

  load(_s: Float64Array, k: number): number {
    return k + 1;
  }
}

/* ------------------------------ pulley ------------------------------ */

export class Pulley2 extends Base {
  readonly kind = FK.tension;
  private imp = 0;
  private readonly total: number;
  private uAx = 0;
  private uAy = 0;
  private uBx = 0;
  private uBy = 0;
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  private mass = 0;
  constructor(w: World2, a: number, b: number, private readonly la: [number, number], private readonly lb: [number, number], private readonly gA: [number, number], private readonly gB: [number, number], readonly ratio: number) {
    super(a, b);
    this.frame(w);
    this.total = this.lenA(w) + ratio * this.lenB(w);
  }

  private lenA(w: World2): number {
    return Math.sqrt(((w.px[this.a] as number) + this.rAx - this.gA[0]) ** 2 + ((w.py[this.a] as number) + this.rAy - this.gA[1]) ** 2);
  }

  private lenB(w: World2): number {
    return Math.sqrt(((w.px[this.b] as number) + this.rBx - this.gB[0]) ** 2 + ((w.py[this.b] as number) + this.rBy - this.gB[1]) ** 2);
  }

  private frame(w: World2): void {
    [this.rAx, this.rAy] = rot(w, this.a, this.la[0], this.la[1]);
    [this.rBx, this.rBy] = rot(w, this.b, this.lb[0], this.lb[1]);
    const ax = (w.px[this.a] as number) + this.rAx - this.gA[0];
    const ay = (w.py[this.a] as number) + this.rAy - this.gA[1];
    const bx = (w.px[this.b] as number) + this.rBx - this.gB[0];
    const by = (w.py[this.b] as number) + this.rBy - this.gB[1];
    const la = Math.sqrt(ax * ax + ay * ay) || 1;
    const lb = Math.sqrt(bx * bx + by * by) || 1;
    this.uAx = ax / la;
    this.uAy = ay / la;
    this.uBx = bx / lb;
    this.uBy = by / lb;
    const ruA = this.rAx * this.uAy - this.rAy * this.uAx;
    const ruB = this.rBx * this.uBy - this.rBy * this.uBx;
    const mA = (w.invM[this.a] as number) + (w.invI[this.a] as number) * ruA * ruA;
    const mB = (w.invM[this.b] as number) + (w.invI[this.b] as number) * ruB * ruB;
    const m = mA + this.ratio * this.ratio * mB;
    this.mass = m > 0 ? 1 / m : 0;
  }

  override length(w: World2): number {
    this.frame(w);
    return this.lenA(w) + this.ratio * this.lenB(w);
  }

  initVelocity(w: World2): void {
    this.frame(w);
  }

  private apply(w: World2, d: number): void {
    const PAx = -d * this.uAx;
    const PAy = -d * this.uAy;
    const PBx = -this.ratio * d * this.uBx;
    const PBy = -this.ratio * d * this.uBy;
    const { a, b } = this;
    w.vx[a] = (w.vx[a] as number) + (w.invM[a] as number) * PAx;
    w.vy[a] = (w.vy[a] as number) + (w.invM[a] as number) * PAy;
    w.w[a] = (w.w[a] as number) + (w.invI[a] as number) * (this.rAx * PAy - this.rAy * PAx);
    w.vx[b] = (w.vx[b] as number) + (w.invM[b] as number) * PBx;
    w.vy[b] = (w.vy[b] as number) + (w.invM[b] as number) * PBy;
    w.w[b] = (w.w[b] as number) + (w.invI[b] as number) * (this.rBx * PBy - this.rBy * PBx);
  }

  warmStart(w: World2): void {
    if (this.imp !== 0) this.apply(w, this.imp);
  }

  solveVelocity(w: World2): void {
    const { a, b } = this;
    const vpAx = (w.vx[a] as number) - (w.w[a] as number) * this.rAy;
    const vpAy = (w.vy[a] as number) + (w.w[a] as number) * this.rAx;
    const vpBx = (w.vx[b] as number) - (w.w[b] as number) * this.rBy;
    const vpBy = (w.vy[b] as number) + (w.w[b] as number) * this.rBx;
    const cdot = -(this.uAx * vpAx + this.uAy * vpAy) - this.ratio * (this.uBx * vpBx + this.uBy * vpBy);
    const d = -this.mass * cdot;
    this.imp += d;
    this.apply(w, d);
    this.impulseX = -this.imp * this.uBx * this.ratio;
    this.impulseY = -this.imp * this.uBy * this.ratio;
  }

  solvePosition(w: World2): boolean {
    this.frame(w);
    const C = this.total - this.lenA(w) - this.ratio * this.lenB(w);
    const imp = -this.mass * Math.max(-MAX_LIN, Math.min(MAX_LIN, C));
    const { a, b } = this;
    w.px[a] = (w.px[a] as number) - (w.invM[a] as number) * imp * this.uAx;
    w.py[a] = (w.py[a] as number) - (w.invM[a] as number) * imp * this.uAy;
    w.px[b] = (w.px[b] as number) - (w.invM[b] as number) * this.ratio * imp * this.uBx;
    w.py[b] = (w.py[b] as number) - (w.invM[b] as number) * this.ratio * imp * this.uBy;
    return Math.abs(C) < LINEAR_SLOP;
  }

  save(out: number[]): void {
    out.push(this.imp);
  }

  load(s: Float64Array, k: number): number {
    this.imp = s[k++] as number;
    return k;
  }
}

/* ------------------------------ grab ------------------------------ */

/** Pulls a point of b toward a moving target with a stiff damped spring (5 Hz, damping 0.9), scaled by b's mass. */
export class Grab2 extends Base {
  readonly kind = FK.applied;
  tx = 0;
  ty = 0;
  constructor(a: number, b: number, private readonly lb: [number, number], tx: number, ty: number) {
    super(a, b);
    this.tx = tx;
    this.ty = ty;
  }

  initVelocity(w: World2, h: number): void {
    const b = this.b;
    const m = w.mass[b] as number;
    const omega = 2 * Math.PI * 5;
    const [rx, ry] = rot(w, b, this.lb[0], this.lb[1]);
    const px = (w.px[b] as number) + rx;
    const py = (w.py[b] as number) + ry;
    const vx = (w.vx[b] as number) - (w.w[b] as number) * ry;
    const vy = (w.vy[b] as number) + (w.w[b] as number) * rx;
    const fx = m * omega * omega * (this.tx - px) - 2 * 0.9 * m * omega * vx;
    const fy = m * omega * omega * (this.ty - py) - 2 * 0.9 * m * omega * vy;
    w.vx[b] = (w.vx[b] as number) + (w.invM[b] as number) * fx * h;
    w.vy[b] = (w.vy[b] as number) + (w.invM[b] as number) * fy * h;
    w.w[b] = (w.w[b] as number) + (w.invI[b] as number) * (rx * fy - ry * fx) * h;
    this.impulseX = fx * h;
    this.impulseY = fy * h;
  }

  warmStart(): void {}
  solveVelocity(): void {}
  solvePosition(): boolean {
    return true;
  }
  save(out: number[]): void {
    out.push(this.tx, this.ty);
  }
  load(s: Float64Array, k: number): number {
    this.tx = s[k++] as number;
    this.ty = s[k++] as number;
    return k;
  }
}

/* ------------------------------ wheel ------------------------------ */

export interface WheelOptions {
  /** Suspension stiffness, N/m, and damping, N s/m. */
  readonly spring: number;
  readonly damping: number;
  /** How far the wheel may move along the suspension from its rest place, m. */
  readonly travel: number;
  /** Target spin of the wheel against the chassis, rad/s, and the most torque the motor gives, N m. */
  motor?: number;
  torque?: number;
}

/**
 * A wheel on a chassis (physics design 8, in the plane): the wheel's centre stays on a line fixed in the chassis (the
 * suspension), a spring and damper hold it along that line, it turns freely, and a motor may drive its spin.
 */
export class Wheel2 extends Base {
  readonly kind = FK.spring;
  private ip = 0;
  private im = 0;
  private il = 0;
  private iu = 0;
  private readonly axl: [number, number];
  private rAx = 0;
  private rAy = 0;
  private rBx = 0;
  private rBy = 0;
  private ax = 0;
  private ay = 0;
  private trans = 0;
  constructor(w: World2, a: number, b: number, private readonly la: [number, number], axis: [number, number], public opts: WheelOptions) {
    super(a, b);
    const l = Math.sqrt(axis[0] * axis[0] + axis[1] * axis[1]) || 1;
    const c = w.qc[a] as number;
    const s = w.qs[a] as number;
    const x = axis[0] / l;
    const y = axis[1] / l;
    this.axl = [c * x + s * y, -s * x + c * y];
  }

  private frame(w: World2): void {
    [this.rAx, this.rAy] = rot(w, this.a, this.la[0], this.la[1]);
    this.rBx = 0;
    this.rBy = 0;
    [this.ax, this.ay] = rot(w, this.a, this.axl[0], this.axl[1]);
    const dx = (w.px[this.b] as number) - (w.px[this.a] as number) - this.rAx;
    const dy = (w.py[this.b] as number) - (w.py[this.a] as number) - this.rAy;
    this.trans = dx * this.ax + dy * this.ay;
  }

  override length(w: World2): number {
    this.frame(w);
    return this.trans;
  }

  private row(w: World2, dx: number, dy: number, target: number, acc: number, lo: number, hi: number): number {
    const { a, b } = this;
    const d1x = (w.px[b] as number) - (w.px[a] as number);
    const d1y = (w.py[b] as number) - (w.py[a] as number);
    const sA = d1x * dy - d1y * dx;
    const mA = w.invM[a] as number;
    const mB = w.invM[b] as number;
    const iA = w.invI[a] as number;
    const k = mA + mB + iA * sA * sA;
    if (!(k > 0)) return acc;
    const cdot = dx * ((w.vx[b] as number) - (w.vx[a] as number)) + dy * ((w.vy[b] as number) - (w.vy[a] as number)) - sA * (w.w[a] as number);
    const next = Math.max(lo, Math.min(hi, acc - (cdot - target) / k));
    const d = next - acc;
    w.vx[a] = (w.vx[a] as number) - mA * d * dx;
    w.vy[a] = (w.vy[a] as number) - mA * d * dy;
    w.w[a] = (w.w[a] as number) - iA * d * sA;
    w.vx[b] = (w.vx[b] as number) + mB * d * dx;
    w.vy[b] = (w.vy[b] as number) + mB * d * dy;
    return next;
  }

  initVelocity(w: World2, h: number): void {
    this.frame(w);
    const { a, b } = this;
    // the suspension spring and damper, as a force along the axis
    const vx = (w.vx[b] as number) - (w.vx[a] as number) + (w.w[a] as number) * this.rAy;
    const vy = (w.vy[b] as number) - (w.vy[a] as number) - (w.w[a] as number) * this.rAx;
    const rate = vx * this.ax + vy * this.ay;
    const f = -this.opts.spring * this.trans - this.opts.damping * rate;
    applyP(w, a, b, this.rAx + (w.px[b] as number) - (w.px[a] as number) - this.rAx, this.rAy + (w.py[b] as number) - (w.py[a] as number) - this.rAy, 0, 0, f * h * this.ax, f * h * this.ay);
    this.springX = f * h * this.ax;
    this.springY = f * h * this.ay;
    this.impulseX = this.springX;
    this.impulseY = this.springY;
  }

  warmStart(): void {
    this.ip = this.im = this.il = this.iu = 0;
  }

  solveVelocity(w: World2, h: number): void {
    const { a, b } = this;
    // the motor turns the wheel against the chassis
    if (this.opts.motor !== undefined) {
      const iA = w.invI[a] as number;
      const iB = w.invI[b] as number;
      if (iA + iB > 0) {
        const max = (this.opts.torque ?? 0) * h;
        const cdot = (w.w[b] as number) - (w.w[a] as number) - this.opts.motor;
        const old = this.im;
        this.im = Math.max(-max, Math.min(max, old - cdot / (iA + iB)));
        const d = this.im - old;
        w.w[a] = (w.w[a] as number) - iA * d;
        w.w[b] = (w.w[b] as number) + iB * d;
      }
    }
    this.ip = this.row(w, -this.ay, this.ax, 0, this.ip, -Infinity, Infinity);
    const inv_h = 1 / h;
    const lo = this.trans + this.opts.travel;
    this.il = this.row(w, this.ax, this.ay, lo > 0 ? -lo * inv_h : 0, this.il, 0, Infinity);
    const hi = this.opts.travel - this.trans;
    this.iu = this.row(w, -this.ax, -this.ay, hi > 0 ? -hi * inv_h : 0, this.iu, 0, Infinity);
    // everything the mount carries: the spring, the side push, and the stops at the ends of its travel
    this.impulseX = this.springX - this.ay * this.ip + (this.il - this.iu) * this.ax;
    this.impulseY = this.springY + this.ax * this.ip + (this.il - this.iu) * this.ay;
  }

  private springX = 0;
  private springY = 0;

  solvePosition(w: World2): boolean {
    this.frame(w);
    const { a, b } = this;
    const dx = (w.px[b] as number) - (w.px[a] as number) - this.rAx;
    const dy = (w.py[b] as number) - (w.py[a] as number) - this.rAy;
    const perp = -this.ay * dx + this.ax * dy;
    const mA = w.invM[a] as number;
    const mB = w.invM[b] as number;
    const m = mA + mB;
    if (m > 0 && Math.abs(perp) > LINEAR_SLOP) {
      const c = Math.max(-MAX_LIN, Math.min(MAX_LIN, perp)) / m;
      w.px[a] = (w.px[a] as number) - mA * c * this.ay;
      w.py[a] = (w.py[a] as number) + mA * c * this.ax;
      w.px[b] = (w.px[b] as number) + mB * c * this.ay;
      w.py[b] = (w.py[b] as number) - mB * c * this.ax;
    }
    return Math.abs(perp) <= LINEAR_SLOP;
  }

  save(out: number[]): void {
    out.push(0);
  }

  load(_s: Float64Array, k: number): number {
    return k + 1;
  }
}
