/**
 * Cloth in space against the world (docs/features/physics/design.md 9.5, 9.6): points against bodies, solids, the floor
 * and terrain, pins to bodies, and the pushes the bodies take back at the start of the next step.
 *
 * Which points may touch which shapes is found once a step on the cloth's grid (`prepare`); each small step then tests
 * only those pairs. A point is pushed out to `thickness` from a shape along the face (or, for a ball, the direction) its
 * path came in by, measured against the body as it moved this step, so a fast ball does not pass through a sheet; then
 * friction takes off the part of its slide the touch allows. Against a body the point and the body share the push by
 * their masses, and the body takes its part at the start of the next step (design 9.6).
 */
import type { ClothDef } from './cloth';
import { ClothSet } from './cloth';
import type { World3 } from './world3';
import { BodyType3, FK3 } from './world3';

const NK = 10;
/** A ball keeps this part of the cloth's thickness from a face's middle (and all of it from its points). */
const FACE_GAP = 0.5;

export class Cloth3 extends ClothSet {
  private world: World3 | undefined;
  /** Shape and point pairs that may touch this step. */
  private nCand = 0;
  private candS = new Int32Array(1024);
  private candP = new Int32Array(1024);
  /** Shapes every point is tested against: planes and terrain. */
  private wide = new Int32Array(16);
  private nWide = 0;
  /** Each body's centre at the start of the step (before the world stepped it), for the paths of the tests. */
  private bp0 = new Float64Array(0);
  /** The hulls' face planes this step (n, n·v + thickness, four numbers a face), where each hull's start, and when made. */
  private planes = new Float64Array(256);
  private nPlanes = 0;
  private hullOff = new Int32Array(0);
  private hullStamp = new Int32Array(0);
  private hullTh = new Float64Array(0);
  private o3 = new Float64Array(8);

  /** Hull k's face planes for a cloth of thickness th, made at most once a step (a second thickness makes them again). */
  private hullPlanes(k: number, sh: { readonly faces: readonly Int32Array[]; readonly wv: Float64Array; readonly wn: Float64Array }, th: number): Float64Array {
    if (this.hullStamp.length <= k) {
      const n = Math.max(k + 1, this.hullStamp.length * 2, 16);
      const S = new Int32Array(n).fill(-1);
      S.set(this.hullStamp);
      const O = new Int32Array(n);
      O.set(this.hullOff);
      const T = new Float64Array(n);
      T.set(this.hullTh);
      this.hullStamp = S;
      this.hullOff = O;
      this.hullTh = T;
    }
    if (this.hullStamp[k] === this.stamp && this.hullTh[k] === th) return this.planes;
    const nf = sh.faces.length;
    if (this.nPlanes + nf * 4 > this.planes.length) {
      const P = new Float64Array(Math.max(this.planes.length * 2, this.nPlanes + nf * 4));
      P.set(this.planes.subarray(0, this.nPlanes));
      this.planes = P;
    }
    const pl = this.planes;
    const p0 = this.nPlanes;
    const { wv, wn } = sh;
    for (let f = 0; f < nf; f++) {
      const c0 = (sh.faces[f] as Int32Array)[0] as number;
      const nx = wn[f * 3] as number;
      const ny = wn[f * 3 + 1] as number;
      const nz = wn[f * 3 + 2] as number;
      const o = p0 + f * 4;
      pl[o] = nx;
      pl[o + 1] = ny;
      pl[o + 2] = nz;
      pl[o + 3] = nx * (wv[c0 * 3] as number) + ny * (wv[c0 * 3 + 1] as number) + nz * (wv[c0 * 3 + 2] as number) + th;
    }
    this.nPlanes += nf * 4;
    this.hullOff[k] = p0;
    this.hullStamp[k] = this.stamp;
    this.hullTh[k] = th;
    return pl;
  }
  /** The push the bodies took at the start of this step, as normal force and pin tension (for the force count). */
  private appliedN = new Float64Array(0);
  private appliedT = new Float64Array(0);
  /** The part of the owed pushes that came through pins. */
  private attached = false;

  constructor(defs: readonly ClothDef[]) {
    super(defs, 3);
  }

  /** Binds the cloth to its world once it is built: body pins are held at their points in the bodies' own frames. */
  attach(w: World3): void {
    this.world = w;
    this.sizeBodies(w.n);
    if (this.bp0.length !== w.n * 3) this.bp0 = Float64Array.from(w.p);
    if (this.appliedN.length !== w.n * 3) {
      this.appliedN = new Float64Array(w.n * 3);
      this.appliedT = new Float64Array(w.n * 3);
    }
    if (this.attached) return;
    this.attached = true;
    for (let q = 0; q < this.pinPoint.length; q++) {
      const b = this.pinBody[q] as number;
      if (b < 0) continue;
      const l = w.toLocal(b, this.pinX[q] as number, this.pinY[q] as number, this.pinZ[q] as number);
      this.pinX[q] = l[0];
      this.pinY[q] = l[1];
      this.pinZ[q] = l[2];
    }
  }

  /**
   * Before the body step: the pushes the cloth gave the bodies last step go in, as a change of speed and turn, and the
   * moves it gave them as a change of place (design 9.6). Each body's centre is kept, for this step's paths.
   */
  applyImpulses(w: World3): void {
    this.attach(w);
    const I = w.invIw;
    for (let i = 0; i < w.n; i++) {
      const jx = this.bjx[i] as number;
      const jy = this.bjy[i] as number;
      const jz = this.bjz[i] as number;
      const px = this.pjx[i] as number;
      const py = this.pjy[i] as number;
      const pz = this.pjz[i] as number;
      this.appliedT[i * 3] = px;
      this.appliedT[i * 3 + 1] = py;
      this.appliedT[i * 3 + 2] = pz;
      this.appliedN[i * 3] = jx - px;
      this.appliedN[i * 3 + 1] = jy - py;
      this.appliedN[i * 3 + 2] = jz - pz;
      if ((jx !== 0 || jy !== 0 || jz !== 0) && w.type[i] === BodyType3.Dynamic && !w.gone.has(i) && w.awake[i] === 1) {
        // the pins' part of the push is already in the body's speed: it took the small steps with the cloth
        const im = w.invM[i] as number;
        w.v[i * 3] = (w.v[i * 3] as number) + im * (jx - px);
        w.v[i * 3 + 1] = (w.v[i * 3 + 1] as number) + im * (jy - py);
        w.v[i * 3 + 2] = (w.v[i * 3 + 2] as number) + im * (jz - pz);
        const tx = this.btx[i] as number;
        const ty = this.bty[i] as number;
        const tz = this.btz[i] as number;
        const o = i * 9;
        w.w[i * 3] = (w.w[i * 3] as number) + (I[o] as number) * tx + (I[o + 1] as number) * ty + (I[o + 2] as number) * tz;
        w.w[i * 3 + 1] = (w.w[i * 3 + 1] as number) + (I[o + 3] as number) * tx + (I[o + 4] as number) * ty + (I[o + 5] as number) * tz;
        w.w[i * 3 + 2] = (w.w[i * 3 + 2] as number) + (I[o + 6] as number) * tx + (I[o + 7] as number) * ty + (I[o + 8] as number) * tz;
        w.p[i * 3] = (w.p[i * 3] as number) + (this.bdx[i] as number);
        w.p[i * 3 + 1] = (w.p[i * 3 + 1] as number) + (this.bdy[i] as number);
        w.p[i * 3 + 2] = (w.p[i * 3 + 2] as number) + (this.bdz[i] as number);
      }
      this.bjx[i] = 0;
      this.bjy[i] = 0;
      this.bjz[i] = 0;
      this.btx[i] = 0;
      this.bty[i] = 0;
      this.btz[i] = 0;
      this.pjx[i] = 0;
      this.pjy[i] = 0;
      this.pjz[i] = 0;
    }
    this.bp0.set(w.p);
    if (this.bv0.length !== w.v.length) this.bv0 = new Float64Array(w.v.length);
    this.bv0.set(w.v);
  }

  /** Each body's speed at the start of the world step. */
  private bv0 = new Float64Array(0);

  protected override bodyStep(b: number, out: Float64Array): void {
    const w = this.world as World3;
    for (let a = 0; a < 3; a++) {
      out[a] = this.bp0[b * 3 + a] as number;
      out[3 + a] = this.bv0[b * 3 + a] as number;
      out[6 + a] = w.p[b * 3 + a] as number;
      out[9 + a] = w.v[b * 3 + a] as number;
    }
  }

  protected override setBody(b: number): void {
    const w = this.world as World3;
    const a = this.ar;
    w.p[b * 3] = a[0] as number;
    w.p[b * 3 + 1] = a[1] as number;
    w.p[b * 3 + 2] = a[2] as number;
    w.v[b * 3] = a[3] as number;
    w.v[b * 3 + 1] = a[4] as number;
    w.v[b * 3 + 2] = a[5] as number;
    w.updateShapes(b);
  }

  protected override keepOut(b: number, io: Float64Array): boolean {
    return (this.world as World3).keepOut(b, io);
  }

  protected override shiftSpeed(b: number): void {
    const w = this.world as World3;
    const a = this.ar;
    w.v[b * 3] = (w.v[b * 3] as number) + (a[0] as number);
    w.v[b * 3 + 1] = (w.v[b * 3 + 1] as number) + (a[1] as number);
    w.v[b * 3 + 2] = (w.v[b * 3 + 2] as number) + (a[2] as number);
  }

  /** Body b's centre now, in the cloth's small steps: where it took the small steps to, or where the world put it. */
  private cx3 = new Float64Array(3);
  private centre(b: number): Float64Array {
    const c = this.cx3;
    if (this.subAt(b, c)) return c;
    const w = this.world as World3;
    c[0] = (w.p[b * 3] as number) + (this.bdx[b] as number);
    c[1] = (w.p[b * 3 + 1] as number) + (this.bdy[b] as number);
    c[2] = (w.p[b * 3 + 2] as number) + (this.bdz[b] as number);
    return c;
  }

  /** After the body step: the cloth's push counts as `normal` (touches) and `tension` (pins). */
  account(w: World3, h: number): void {
    const inv = 1 / h;
    for (let i = 0; i < w.n && i * 3 < this.appliedN.length; i++) {
      if (w.type[i] !== BodyType3.Dynamic || w.awake[i] === 0) continue;
      const o = i * NK * 3;
      for (let a = 0; a < 3; a++) {
        w.forces[o + FK3.normal * 3 + a] = (w.forces[o + FK3.normal * 3 + a] as number) + (this.appliedN[i * 3 + a] as number) * inv;
        w.forces[o + FK3.tension * 3 + a] = (w.forces[o + FK3.tension * 3 + a] as number) + (this.appliedT[i * 3 + a] as number) * inv;
      }
    }
  }

  /** One world step of the cloth against the world where it is now. */
  step(w: World3, h: number): void {
    this.hStep = h;
    this.stepWorld(w);
  }

  /** The step of `hStep` (set by the caller): the same as `step`, with no number passed in the call. */
  stepWorld(w: World3): void {
    this.attach(w);
    this.gx = w.gx;
    this.gy = w.gy;
    this.gz = w.gz;
    this.stepNow();
  }

  /* ------------------------------ hooks ------------------------------ */

  private live(b: number): boolean {
    const w = this.world as World3;
    return w.type[b] === BodyType3.Dynamic && !w.gone.has(b) && w.awake[b] === 1;
  }

  protected override anchor(q: number, out: Float64Array): void {
    const w = this.world as World3;
    const b = this.pinBody[q] as number;
    const R = w.R;
    const o = b * 9;
    const lx = this.pinX[q] as number;
    const ly = this.pinY[q] as number;
    const lz = this.pinZ[q] as number;
    const c = this.centre(b);
    out[0] = (c[0] as number) + (R[o] as number) * lx + (R[o + 1] as number) * ly + (R[o + 2] as number) * lz;
    out[1] = (c[1] as number) + (R[o + 3] as number) * lx + (R[o + 4] as number) * ly + (R[o + 5] as number) * lz;
    out[2] = (c[2] as number) + (R[o + 6] as number) * lx + (R[o + 7] as number) * ly + (R[o + 8] as number) * lz;
  }

  /**
   * A body's inverse mass felt at a point, for a pin (any direction): 1/m plus the most its turn can add, |r|² times the
   * largest row sum of I⁻¹ (an upper bound, so a light, small body never takes more than it can).
   */
  protected override bodyW(b: number): void {
    const q = this.ar;
    if (!this.live(b)) {
      q[21] = 0;
      return;
    }
    const w = this.world as World3;
    const rx = (q[11] as number) - (this.centre(b)[0] as number);
    const ry = (q[12] as number) - (this.centre(b)[1] as number);
    const rz = (q[13] as number) - (this.centre(b)[2] as number);
    const I = w.invIw;
    const o = b * 9;
    let most = 0;
    for (let a = 0; a < 3; a++) {
      const s = Math.abs(I[o + a * 3] as number) + Math.abs(I[o + a * 3 + 1] as number) + Math.abs(I[o + a * 3 + 2] as number);
      if (s > most) most = s;
    }
    q[21] = (w.invM[b] as number) + (rx * rx + ry * ry + rz * rz) * most;
  }

  /** The inverse mass of body b along the normal `ar[0..2]` at the point `ar[11..13]`, 1/m + (r × n)·I⁻¹(r × n), into `ar[21]`. */
  private bodyWn(b: number): void {
    const q = this.ar;
    if (!this.live(b)) {
      q[21] = 0;
      return;
    }
    const w = this.world as World3;
    const nx = q[0] as number;
    const ny = q[1] as number;
    const nz = q[2] as number;
    const rx = (q[11] as number) - (this.centre(b)[0] as number);
    const ry = (q[12] as number) - (this.centre(b)[1] as number);
    const rz = (q[13] as number) - (this.centre(b)[2] as number);
    const cx = ry * nz - rz * ny;
    const cy = rz * nx - rx * nz;
    const cz = rx * ny - ry * nx;
    const I = w.invIw;
    const o = b * 9;
    const ix = (I[o] as number) * cx + (I[o + 1] as number) * cy + (I[o + 2] as number) * cz;
    const iy = (I[o + 3] as number) * cx + (I[o + 4] as number) * cy + (I[o + 5] as number) * cz;
    const iz = (I[o + 6] as number) * cx + (I[o + 7] as number) * cy + (I[o + 8] as number) * cz;
    q[21] = (w.invM[b] as number) + cx * ix + cy * iy + cz * iz;
  }

  protected override bodyV(b: number, out: Float64Array): void {
    const w = this.world as World3;
    const q = this.ar;
    const x = q[11] as number;
    const y = q[12] as number;
    const z = q[13] as number;
    if (w.type[b] === BodyType3.Static || w.gone.has(b)) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return;
    }
    const rx = x - (this.centre(b)[0] as number);
    const ry = y - (this.centre(b)[1] as number);
    const rz = z - (this.centre(b)[2] as number);
    const wx = w.w[b * 3] as number;
    const wy = w.w[b * 3 + 1] as number;
    const wz = w.w[b * 3 + 2] as number;
    out[0] = (w.v[b * 3] as number) + wy * rz - wz * ry;
    out[1] = (w.v[b * 3 + 1] as number) + wz * rx - wx * rz;
    out[2] = (w.v[b * 3 + 2] as number) + wx * ry - wy * rx;
  }

  protected override bodyArm(b: number, out: Float64Array): void {
    const q = this.ar;
    out[0] = (q[11] as number) - (this.centre(b)[0] as number);
    out[1] = (q[12] as number) - (this.centre(b)[1] as number);
    out[2] = (q[13] as number) - (this.centre(b)[2] as number);
  }

  protected override bodyInvMass(b: number): void {
    this.ar[23] = this.live(b) ? ((this.world as World3).invM[b] as number) : 0;
  }

  protected override bodiesStir(c: number): boolean {
    const w = this.world;
    if (!w) return false;
    const ci = this.cloths[c];
    if (!ci) return false;
    // an awake body whose box comes near the cloth's points
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = ci.p0; i < ci.p0 + ci.n; i++) {
      const x = this.x[i] as number;
      const y = this.y[i] as number;
      const z = this.z[i] as number;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const m = ci.def.thickness + 0.05;
    for (let b = 0; b < w.n; b++) {
      if (!this.live(b)) continue;
      for (let k = w.shape0[b] as number; k < (w.shape0[b] as number) + (w.shapeN[b] as number); k++) {
        if ((w.lo[k * 3] as number) <= x1 + m && (w.hi[k * 3] as number) >= x0 - m && (w.lo[k * 3 + 1] as number) <= y1 + m && (w.hi[k * 3 + 1] as number) >= y0 - m && (w.lo[k * 3 + 2] as number) <= z1 + m && (w.hi[k * 3 + 2] as number) >= z0 - m) return true;
      }
    }
    return false;
  }

  /** The shape and point pairs that may touch this step, found on the grid built for this step. */
  protected override prepare(): void {
    const w = this.world as World3;
    this.nCand = 0;
    this.nWide = 0;
    this.nFace = 0;
    this.stamp = (this.stamp + 1) % 500000;
    this.nPlanes = 0;
    if (this.stamp === 0) this.hullStamp.fill(-1);
    let thick = 0;
    for (let c = 0; c < this.cloths.length; c++) thick = Math.max(thick, (this.cloths[c] as { def: { thickness: number } }).def.thickness);
    const pad = thick + this.pad + 0.01;
    for (let b = 0; b < w.n; b++) {
      if (w.gone.has(b)) continue;
      const s0 = w.shape0[b] as number;
      const sn = w.shapeN[b] as number;
      for (let k = s0; k < s0 + sn; k++) {
        const sh = w.shapes[k];
        if (!sh) continue;
        if (sh.kind === 2 || sh.kind === 3) {
          if (this.nWide >= this.wide.length) {
            const g = new Int32Array(this.wide.length * 2);
            g.set(this.wide);
            this.wide = g;
          }
          this.wide[this.nWide++] = k;
          continue;
        }
        // a moving body's box at the start and at the end of its step
        const dx = (w.p[b * 3] as number) - (this.bp0[b * 3] as number);
        const dy = (w.p[b * 3 + 1] as number) - (this.bp0[b * 3 + 1] as number);
        const dz = (w.p[b * 3 + 2] as number) - (this.bp0[b * 3 + 2] as number);
        // one box test against all the cloth's points first (inGrid), then the grid
        const ag = this.ar;
        ag[0] = (w.lo[k * 3] as number) - pad + Math.min(0, -dx);
        ag[1] = (w.lo[k * 3 + 1] as number) - pad + Math.min(0, -dy);
        ag[2] = (w.lo[k * 3 + 2] as number) - pad + Math.min(0, -dz);
        ag[3] = (w.hi[k * 3] as number) + pad + Math.max(0, -dx);
        ag[4] = (w.hi[k * 3 + 1] as number) + pad + Math.max(0, -dy);
        ag[5] = (w.hi[k * 3 + 2] as number) + pad + Math.max(0, -dz);
        const m = this.inGrid();
        const found = this.grid.found;
        // a ball: only points that may come within its radius this step (by their own speed and the ball's move)
        const ball = sh.kind === 0;
        const move = ball ? Math.sqrt(dx * dx + dy * dy + dz * dz) : 0;
        const hh = this.hStep;
        const near0 = ball ? sh.r + thick + 9.8 * hh * hh + (this.nGrab > 0 ? 0.5 : 0) + move + 0.01 : 0;
        // the grid hands back whole cells: a hull keeps only the points inside its padded box (it is tested every small step)
        const bx0 = (w.lo[k * 3] as number) - pad + Math.min(0, -dx);
        const by0 = (w.lo[k * 3 + 1] as number) - pad + Math.min(0, -dy);
        const bz0 = (w.lo[k * 3 + 2] as number) - pad + Math.min(0, -dz);
        const bx1 = (w.hi[k * 3] as number) + pad + Math.max(0, -dx);
        const by1 = (w.hi[k * 3 + 1] as number) + pad + Math.max(0, -dy);
        const bz1 = (w.hi[k * 3 + 2] as number) + pad + Math.max(0, -dz);
        for (let q = 0; q < m; q++) {
          const i = found[q] as number;
          const ci = this.cloths[this.owner[i] as number];
          if (!ci || ci.asleep || ci.unstable) continue;
          if (!ball) {
            const px = this.x[i] as number;
            const py = this.y[i] as number;
            const pz = this.z[i] as number;
            if (px < bx0 || px > bx1 || py < by0 || py > by1 || pz < bz0 || pz > bz1) continue;
          }
          if (ball) {
            const ex = (this.x[i] as number) - (sh.wc[0] as number);
            const ey = (this.y[i] as number) - (sh.wc[1] as number);
            const ez = (this.z[i] as number) - (sh.wc[2] as number);
            const ua = this.vx[i] as number;
            const ub = this.vy[i] as number;
            const uc = this.vz[i] as number;
            const vi = Math.sqrt(ua * ua + ub * ub + uc * uc);
            const reach = near0 + 1.5 * hh * vi;
            if (ex * ex + ey * ey + ez * ez > reach * reach) continue;
          }
          if (this.nCand >= this.candS.length) {
            const S = new Int32Array(this.candS.length * 2);
            S.set(this.candS);
            const P = new Int32Array(this.candP.length * 2);
            P.set(this.candP);
            this.candS = S;
            this.candP = P;
          }
          this.candS[this.nCand] = k;
          this.candP[this.nCand] = i;
          this.nCand++;
          // a ball also meets the sheet's faces round the point, so it cannot slip between points
          if (sh.kind === 0 && ci.def.kind === 'sheet') this.addFaces(k, i, ci);
        }
      }
    }
  }

  /** Ball and face pairs this step, each face once a ball (a stamp per face). */
  private nFace = 0;
  private faceS = new Int32Array(256);
  private faceT = new Int32Array(256);
  private faceMark = new Int32Array(0);
  private stamp = 0;

  private addFaces(k: number, i: number, ci: (typeof this.cloths)[number]): void {
    if (this.faceMark.length !== this.ta.length) this.faceMark = new Int32Array(this.ta.length);
    const key = this.stamp * 4096 + k + 1;
    const nu = ci.def.nu;
    const nv = ci.def.nv;
    const pi = (i - ci.p0) % nu;
    const pj = Math.floor((i - ci.p0) / nu);
    for (let cj = pj - 1; cj <= pj; cj++) {
      if (cj < 0 || cj >= nv - 1) continue;
      for (let cx = pi - 1; cx <= pi; cx++) {
        if (cx < 0 || cx >= nu - 1) continue;
        for (let h = 0; h < 2; h++) {
          const t = ci.t0 + 2 * (cj * (nu - 1) + cx) + h;
          if (this.faceMark[t] === key) continue;
          this.faceMark[t] = key;
          if (!this.faceMayMeet(k, t)) continue;
          if (this.nFace >= this.faceS.length) {
            const S = new Int32Array(this.faceS.length * 2);
            S.set(this.faceS);
            const T = new Int32Array(this.faceT.length * 2);
            T.set(this.faceT);
            this.faceS = S;
            this.faceT = T;
          }
          this.faceS[this.nFace] = k;
          this.faceT[this.nFace] = t;
          this.nFace++;
        }
      }
    }
  }

  /**
   * Can ball k meet face t this step? Its centre must come within the face's radius of its plane (the start of the step,
   * plus how far the face and the ball may move in it) over the face. A sheet draped on a ball keeps its points
   * `thickness` out and its faces' middles sag less than half that, so a resting sheet's faces are left out.
   */
  private faceMayMeet(k: number, t: number): boolean {
    const w = this.world as World3;
    const sh = w.shapes[k];
    if (!sh || this.triTorn(t)) return false;
    const ci = this.cloths[this.owner[this.ta[t] as number] as number];
    if (!ci) return false;
    const b = sh.body;
    const dx = (w.p[b * 3] as number) - (this.bp0[b * 3] as number);
    const dy = (w.p[b * 3 + 1] as number) - (this.bp0[b * 3 + 1] as number);
    const dz = (w.p[b * 3 + 2] as number) - (this.bp0[b * 3 + 2] as number);
    const move = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const cx = sh.wc[0] as number;
    const cy = sh.wc[1] as number;
    const cz = sh.wc[2] as number;
    const aq = this.ar;
    aq[18] = cx;
    aq[19] = cy;
    aq[20] = cz;
    this.faceHeight(t, this.x, this.y, this.z);
    const o = this.scratch;
    const s = o[6] as number;
    const nx = o[0] as number;
    const ny = o[1] as number;
    const nz = o[2] as number;
    if (nx === 0 && ny === 0 && nz === 0) return false;
    // how far the face may move this step: its fastest corner's speed (and gravity), not the whole cloth's
    let v2 = 0;
    for (let q = 0; q < 3; q++) {
      const j = q === 0 ? (this.ta[t] as number) : q === 1 ? (this.tb[t] as number) : (this.tc[t] as number);
      const a = this.vx[j] as number;
      const bq = this.vy[j] as number;
      const c = this.vz[j] as number;
      v2 = Math.max(v2, a * a + bq * bq + c * c);
    }
    const h = this.hStep;
    const grab = this.nGrab > 0 ? 0.5 : 0;
    const reach = sh.r + FACE_GAP * ci.def.thickness + 2 * (1.5 * h * Math.sqrt(v2) + 9.8 * h * h + grab) + move;
    if (Math.abs(s) >= reach) return false;
    aq[18] = cx - s * nx;
    aq[19] = cy - s * ny;
    aq[20] = cz - s * nz;
    aq[22] = 0.25;
    return this.footOn(t);
  }

  /** Body b's offset in this small step from its pose now (where the small steps have it less where the world put it). */
  private ob = new Float64Array(3);
  private offs(b: number): Float64Array {
    const w = this.world as World3;
    const c = this.centre(b);
    const o = this.ob;
    o[0] = (c[0] as number) - (w.p[b * 3] as number);
    o[1] = (c[1] as number) - (w.p[b * 3 + 1] as number);
    o[2] = (c[2] as number) - (w.p[b * 3 + 2] as number);
    return o;
  }

  /**
   * A ball against a face: the face's nearest point to the ball's centre is pushed out to the ball's surface (plus the
   * thickness), the corners sharing the move by their weights there. A face the centre has passed (it was on the other
   * side at the start of the step) goes back to its side. The body takes the momentum the corners gained, or, where a
   * corner is held, goes back out itself.
   */
  private hitFace(k: number, t: number): void {
    const hs = this.hsub;
    const w = this.world as World3;
    const sh = w.shapes[k];
    if (!sh || this.triTorn(t)) return;
    const b = sh.body;
    const a = this.ta[t] as number;
    const bb = this.tb[t] as number;
    const e = this.tc[t] as number;
    const ci = this.cloths[this.owner[a] as number];
    if (!ci || ci.asleep) return;
    // a face keeps the ball's surface half the thickness off (its corners keep all of it, as points)
    const R = sh.r + FACE_GAP * ci.def.thickness;
    const ob = this.offs(b);
    const cx = (sh.wc[0] as number) + (ob[0] as number);
    const cy = (sh.wc[1] as number) + (ob[1] as number);
    const cz = (sh.wc[2] as number) + (ob[2] as number);
    // the centre's height over the face now and at the start of the step (against the face as it was then)
    const o = this.scratch;
    const aq = this.ar;
    aq[18] = cx;
    aq[19] = cy;
    aq[20] = cz;
    this.faceHeight(t, this.x, this.y, this.z);
    const s1 = o[6] as number;
    const nx = o[0] as number;
    const ny = o[1] as number;
    const nz = o[2] as number;
    if (nx === 0 && ny === 0 && nz === 0) return;
    if (Math.abs(s1) >= R) return;
    aq[18] = cx - ((w.p[b * 3] as number) - (this.bp0[b * 3] as number));
    aq[19] = cy - ((w.p[b * 3 + 1] as number) - (this.bp0[b * 3 + 1] as number));
    aq[20] = cz - ((w.p[b * 3 + 2] as number) - (this.bp0[b * 3 + 2] as number));
    this.faceHeight(t, this.sx, this.sy, this.sz);
    const s0 = o[6] as number;
    // the foot of the centre on the face: only a face the ball stands over counts (points and edges are the points')
    aq[18] = cx - s1 * nx;
    aq[19] = cy - s1 * ny;
    aq[20] = cz - s1 * nz;
    aq[22] = 0;
    if (!this.footOn(t)) return;
    const side = s0 >= 0 ? 1 : -1;
    // the face must be R below the centre, on the side away from where the centre started
    const depth = R - s1 * side;
    if (!(depth > 0)) return;
    const ba = o[3] as number;
    const bbw = o[4] as number;
    const be = o[5] as number;
    // the face moves along −side n
    const mx = -side * nx;
    const my = -side * ny;
    const mz = -side * nz;
    const held = this.w[a] === 0 || this.w[bb] === 0 || this.w[e] === 0 || this.taut[a] === 1 || this.taut[bb] === 1 || this.taut[e] === 1;
    const moving = this.live(b);
    if (held && moving) {
      aq[0] = mx;
      aq[1] = my;
      aq[2] = mz;
      aq[11] = cx;
      aq[12] = cy;
      aq[13] = cz;
      this.bodyWn(b);
      const wb = aq[21] as number;
      if (!(wb > 0)) return;
      const kk = depth / wb / this.hStep;
      aq[8] = -mx * kk;
      aq[9] = -my * kk;
      aq[10] = -mz * kk;
      aq[11] = cx + mx * sh.r;
      aq[12] = cy + my * sh.r;
      aq[13] = cz + mz * sh.r;
      aq[14] = this.hStep;
      this.give(b, this.owner[a] as number);
      const share = kk * hs;
      aq[15] = mx * share * ba;
      aq[16] = my * share * ba;
      aq[17] = mz * share * ba;
      this.holdPush(a);
      aq[15] = mx * share * bbw;
      aq[16] = my * share * bbw;
      aq[17] = mz * share * bbw;
      this.holdPush(bb);
      aq[15] = mx * share * be;
      aq[16] = my * share * be;
      aq[17] = mz * share * be;
      this.holdPush(e);
      return;
    }
    const W = ba * ba * (this.w[a] as number) + bbw * bbw * (this.w[bb] as number) + be * be * (this.w[e] as number);
    if (!(W > 0)) return;
    const dl = depth / W;
    let jx = 0;
    let jy = 0;
    let jz = 0;
    for (let q = 0; q < 3; q++) {
      const j = q === 0 ? a : q === 1 ? bb : e;
      const bw = q === 0 ? ba : q === 1 ? bbw : be;
      const wj = this.w[j] as number;
      if (wj === 0) continue;
      const d = wj * bw * dl;
      this.x[j] = (this.x[j] as number) + d * mx;
      this.y[j] = (this.y[j] as number) + d * my;
      this.z[j] = (this.z[j] as number) + d * mz;
      // the corner's change of momentum, m Δx / hs, goes back to the body
      jx -= (d * mx) / (wj * hs);
      jy -= (d * my) / (wj * hs);
      jz -= (d * mz) / (wj * hs);
    }
    if (moving) {
      aq[8] = jx;
      aq[9] = jy;
      aq[10] = jz;
      aq[11] = cx + mx * sh.r;
      aq[12] = cy + my * sh.r;
      aq[13] = cz + mz * sh.r;
      aq[14] = 0;
      this.give(b, this.owner[a] as number);
    } else this.markTouch(a, b);
  }

  protected override collide(): void {
    const w = this.world as World3;
    for (let q = 0; q < this.nCand; q++) {
      const k = this.candS[q] as number;
      const i = this.candP[q] as number;
      const sh = w.shapes[k];
      if (!sh) continue;
      if (this.kfn && sh.kind !== 0 && !this.hasBodyPins && sh.faces.length * 4 <= this.hullPl.length) {
        // a hull's points, the run of this shape's candidates, tested in Rust
        q = this.hullRun(q, k, sh) - 1;
        continue;
      }
      const ci = this.cloths[this.owner[i] as number];
      if (!ci) continue;
      const b = sh.body;
      // a point pinned to a body does not hit that body
      const pq = this.pinOf[i] as number;
      if (pq >= 0 && this.pinBody[pq] === b) continue;
      if (this.hasBodyPins) {
        this.ar[6] = 2 * sh.reach + ci.def.thickness;
        if (this.nearBodyPin(i, b)) continue;
      }
      const ac = this.ar;
      if (sh.kind === 0) {
        const ob = this.offs(b);
        ac[0] = (sh.wc[0] as number) + (ob[0] as number);
        ac[1] = (sh.wc[1] as number) + (ob[1] as number);
        ac[2] = (sh.wc[2] as number) + (ob[2] as number);
        ac[3] = sh.r + ci.def.thickness;
        ac[4] = ci.def.friction;
        this.hitSphere(i, b);
      } else {
        ac[4] = ci.def.friction;
        ac[5] = ci.def.thickness;
        this.hitHull(i, k);
      }
    }
    for (let q = 0; q < this.nFace; q++) this.hitFace(this.faceS[q] as number, this.faceT[q] as number);
    for (let q = 0; q < this.nWide; q++) {
      const k = this.wide[q] as number;
      const sh = w.shapes[k];
      if (!sh) continue;
      for (let c = 0; c < this.cloths.length; c++) {
        const ci = this.cloths[c] as (typeof this.cloths)[number];
        if (ci.asleep || ci.unstable) continue;
        const e = ci.p0 + ci.n;
        const th = ci.def.thickness;
        const fr = ci.def.friction;
        if (sh.kind === 2) {
          const nx = sh.lc[0] as number;
          const ny = sh.lc[1] as number;
          const nz = sh.lc[2] as number;
          const d = sh.lc[3] as number;
          // the lowest corner of every point's box this step (padded by how far a point may go): above the plane by the
          // thickness, no point reaches it
          const lowest = nx * (nx > 0 ? this.bx0 : this.bx1) + ny * (ny > 0 ? this.by0 : this.by1) + nz * (nz > 0 ? this.bz0 : this.bz1) - d;
          if (lowest >= th) continue;
          for (let i = ci.p0; i < e; i++) {
            if ((this.w[i] as number) === 0) continue;
            const s = nx * (this.x[i] as number) + ny * (this.y[i] as number) + nz * (this.z[i] as number) - d;
            if (s >= th) continue;
            const ap = this.ar;
            ap[0] = nx;
            ap[1] = ny;
            ap[2] = nz;
            ap[3] = th - s;
            ap[4] = fr;
            this.pushOut(i, -1);
          }
        } else if (sh.hf) {
          const ah = this.ar;
          ah[4] = fr;
          ah[5] = th;
          this.hitTerrain(ci.p0, e, sh.hf);
        }
      }
    }
  }

  /**
   * The run of candidates from `q` that belong to shape k (`prepare` lists a shape's points together), against a hull, with
   * the Rust twin of `hitHull`'s test: it goes through the points until one is inside the hull, `pushOut` runs on it here (it
   * may move the body, so the body's offset is read again), and the test goes on from the next point. The same points meet
   * the same pushes in the same order as the TypeScript loop gives. Returns the index after the run.
   */
  private hullRun(q: number, k: number, sh: { readonly body: number; readonly faces: readonly Int32Array[]; readonly wv: Float64Array; readonly wn: Float64Array }): number {
    const w = this.world as World3;
    const kf = this.kfn as NonNullable<typeof this.kfn>;
    const o = this.ko;
    let e = q;
    while (e < this.nCand && this.candS[e] === k) e++;
    const cnt = e - q;
    const idx = this.hullIdx;
    const cp = this.candP;
    for (let c = 0; c < cnt; c++) idx[c] = cp[q + c] as number;
    const b = sh.body;
    const nf = sh.faces.length;
    const dynamic = w.type[b] !== BodyType3.Static;
    const par = this.hullPar;
    const out = this.hullOut;
    let pos = 0;
    while (pos < cnt) {
      const ci = this.cloths[this.owner[this.hullIdx[pos] as number] as number];
      if (!ci) {
        pos++;
        continue;
      }
      const pl = this.hullPlanes(k, sh, ci.def.thickness);
      const p0 = this.hullOff[k] as number;
      const hp = this.hullPl;
      for (let c = 0; c < nf * 4; c++) hp[c] = pl[p0 + c] as number;
      const ob = this.offs(b);
      par[0] = ob[0] as number;
      par[1] = ob[1] as number;
      par[2] = ob[2] as number;
      par[3] = (w.p[b * 3] as number) - (this.bp0[b * 3] as number);
      par[4] = (w.p[b * 3 + 1] as number) - (this.bp0[b * 3 + 1] as number);
      par[5] = (w.p[b * 3 + 2] as number) - (this.bp0[b * 3 + 2] as number);
      pos = kf.hull_hits(o.hullIdx, pos, cnt, o.x, o.y, o.z, o.sx, o.sy, o.sz, o.owner, o.pinOf, o.pinBody, b, o.hullPl, nf, o.hullPar, o.hullOut);
      if (out[0] === 1) {
        const i = this.hullIdx[pos - 1] as number;
        const ap = this.ar;
        ap[0] = out[1] as number;
        ap[1] = out[2] as number;
        ap[2] = out[3] as number;
        ap[3] = out[4] as number;
        ap[4] = ci.def.friction;
        this.pushOut(i, dynamic ? b : -1);
        if (!dynamic) this.markTouch(i, b);
      }
    }
    return e;
  }

  /**
   * Moves point i out by `depth` along n, sharing the move with body b (−1: a wall) by their masses, then takes off the
   * slide friction allows: at most μ × depth of the point's move along the face this small step, against the body's.
   */
  private pushOut(i: number, b: number): void {
    const hs = this.hsub;
    const aq = this.ar;
    const nx = aq[0] as number;
    const ny = aq[1] as number;
    const nz = aq[2] as number;
    const depth = aq[3] as number;
    const mu = aq[4] as number;
    const wp = this.w[i] as number;
    const x = this.x[i] as number;
    const y = this.y[i] as number;
    const z = this.z[i] as number;
    const moving = b >= 0 && this.live(b);
    if (moving && (wp === 0 || this.taut[i] === 1)) {
      // the cloth holds here (a pin, or a tether at its length): the body goes back out instead, as off a wall, and the
      // push goes on to the pins that hold the point
      aq[11] = x;
      aq[12] = y;
      aq[13] = z;
      this.bodyWn(b);
      const wb = aq[21] as number;
      if (!(wb > 0)) return;
      const dl = depth / wb;
      const k = dl / this.hStep;
      aq[8] = -nx * k;
      aq[9] = -ny * k;
      aq[10] = -nz * k;
      aq[14] = this.hStep;
      this.give(b, this.owner[i] as number);
      aq[15] = nx * k * hs;
      aq[16] = ny * k * hs;
      aq[17] = nz * k * hs;
      this.holdPush(i);
      return;
    }
    if (wp === 0) return;
    let mx = depth * nx;
    let my = depth * ny;
    let mz = depth * nz;
    // friction: the point's slide this small step, against the body's surface
    const o = this.o3;
    if (b >= 0) {
      aq[11] = x;
      aq[12] = y;
      aq[13] = z;
      this.bodyV(b, o);
    } else {
      o[0] = 0;
      o[1] = 0;
      o[2] = 0;
    }
    const rx = x + mx - (this.px[i] as number) - (o[0] as number) * hs;
    const ry = y + my - (this.py[i] as number) - (o[1] as number) * hs;
    const rz = z + mz - (this.pz[i] as number) - (o[2] as number) * hs;
    const rn = rx * nx + ry * ny + rz * nz;
    const tx = rx - rn * nx;
    const ty = ry - rn * ny;
    const tz = rz - rn * nz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl > 1e-15 && mu > 0) {
      const cut = Math.min(1, (mu * depth) / tl);
      mx -= tx * cut;
      my -= ty * cut;
      mz -= tz * cut;
    }
    this.x[i] = x + mx;
    this.y[i] = y + my;
    this.z[i] = z + mz;
    if (moving) {
      // within the cloth's small steps the body holds its pose; it takes back the point's change of momentum, m Δx / hs,
      // at the start of the next step, so momentum is kept and a resting body's weight reaches the pins
      const k = 1 / (wp * hs);
      aq[8] = -mx * k;
      aq[9] = -my * k;
      aq[10] = -mz * k;
      aq[11] = x;
      aq[12] = y;
      aq[13] = z;
      aq[14] = 0;
      this.give(b, this.owner[i] as number);
    } else if (b >= 0) this.markTouch(i, b);
  }

  /** A point against a ball: out along the direction its path met the ball (as the ball moved this step). */
  private hitSphere(i: number, b: number): void {
    const aq = this.ar;
    const cx = aq[0] as number;
    const cy = aq[1] as number;
    const cz = aq[2] as number;
    const R = aq[3] as number;
    const x = this.x[i] as number;
    const y = this.y[i] as number;
    const z = this.z[i] as number;
    const ex = x - cx;
    const ey = y - cy;
    const ez = z - cz;
    const d2 = ex * ex + ey * ey + ez * ez;
    if (d2 >= R * R) return;
    // where the point was against the ball at the start of the step
    const w = this.world as World3;
    const ax = (this.sx[i] as number) - (cx - ((w.p[b * 3] as number) - (this.bp0[b * 3] as number)));
    const ay = (this.sy[i] as number) - (cy - ((w.p[b * 3 + 1] as number) - (this.bp0[b * 3 + 1] as number)));
    const az = (this.sz[i] as number) - (cz - ((w.p[b * 3 + 2] as number) - (this.bp0[b * 3 + 2] as number)));
    let nx: number;
    let ny: number;
    let nz: number;
    let depth: number;
    const a2 = ax * ax + ay * ay + az * az;
    if (a2 >= R * R && ax * ex + ay * ey + az * ez < 0.5 * Math.sqrt(a2 * d2)) {
      // it came in from outside and the ball went far past it: back out where its path met the ball
      const ux = ex - ax;
      const uy = ey - ay;
      const uz = ez - az;
      const A = ux * ux + uy * uy + uz * uz;
      const B = ax * ux + ay * uy + az * uz;
      const C = a2 - R * R;
      const disc = B * B - A * C;
      const t = A > 0 && disc >= 0 ? (-B - Math.sqrt(disc)) / A : 0;
      const hx = ax + t * ux;
      const hy = ay + t * uy;
      const hz = az + t * uz;
      const hl = Math.sqrt(hx * hx + hy * hy + hz * hz) || 1;
      nx = hx / hl;
      ny = hy / hl;
      nz = hz / hl;
      depth = R - (ex * nx + ey * ny + ez * nz);
    } else {
      const d = Math.sqrt(d2);
      if (d > 1e-12) {
        nx = ex / d;
        ny = ey / d;
        nz = ez / d;
      } else {
        nx = 0;
        ny = 0;
        nz = 1;
      }
      depth = R - d;
    }
    if (depth > 0) {
      // the friction (`ar[4]`) stays where it is
      aq[0] = nx;
      aq[1] = ny;
      aq[2] = nz;
      aq[3] = depth;
      this.pushOut(i, w.type[b] === BodyType3.Static ? -1 : b);
    }
    if (w.type[b] === BodyType3.Static) this.markTouch(i, b);
  }

  private markTouch(i: number, b: number): void {
    this.touched[(this.owner[i] as number) * this.bjx.length + b] = 1;
  }

  /** A point against a convex hull: out through the face its path (against the hull as it moved) came in by. */
  private hitHull(i: number, k: number): void {
    const th = (this.ar[5] as number);
    const w = this.world as World3;
    const sh = w.shapes[k];
    if (!sh) return;
    const b = sh.body;
    const nf = sh.faces.length;
    // the hull's face planes, worked out once a world step (the body holds its pose in the small steps; its move this
    // step is the offset below), with the thickness added
    const pl = this.hullPlanes(k, sh, th);
    const p0 = this.hullOff[k] as number;
    // the point against the hull where the body is now (it may have been pushed back this step)
    const ob = this.offs(b);
    const x = (this.x[i] as number) - (ob[0] as number);
    const y = (this.y[i] as number) - (ob[1] as number);
    const z = (this.z[i] as number) - (ob[2] as number);
    let sep = -Infinity;
    let best = 0;
    for (let f = 0; f < nf; f++) {
      const o = p0 + f * 4;
      const s = (pl[o] as number) * x + (pl[o + 1] as number) * y + (pl[o + 2] as number) * z - (pl[o + 3] as number);
      if (s >= 0) return;
      if (s > sep) {
        sep = s;
        best = f;
      }
    }
    // inside every face (pushed out by the thickness): find the face the path came in by
    const ax = (this.sx[i] as number) + ((w.p[b * 3] as number) - (this.bp0[b * 3] as number));
    const ay = (this.sy[i] as number) + ((w.p[b * 3 + 1] as number) - (this.bp0[b * 3 + 1] as number));
    const az = (this.sz[i] as number) + ((w.p[b * 3 + 2] as number) - (this.bp0[b * 3 + 2] as number));
    const ux = x - ax;
    const uy = y - ay;
    const uz = z - az;
    let tIn = -Infinity;
    let inFace = -1;
    for (let f = 0; f < nf; f++) {
      const o = p0 + f * 4;
      const nx = pl[o] as number;
      const ny = pl[o + 1] as number;
      const nz = pl[o + 2] as number;
      const s0 = nx * ax + ny * ay + nz * az - (pl[o + 3] as number);
      const du = nx * ux + ny * uy + nz * uz;
      if (du < 0) {
        const t = -s0 / du;
        if (t > tIn) {
          tIn = t;
          inFace = f;
        }
      }
    }
    const face = p0 + (inFace >= 0 && tIn >= -1e-9 ? inFace : best) * 4;
    const nx = pl[face] as number;
    const ny = pl[face + 1] as number;
    const nz = pl[face + 2] as number;
    const depth = -(nx * x + ny * y + nz * z - (pl[face + 3] as number));
    if (!(depth > 0)) return;
    const dynamic = w.type[b] !== BodyType3.Static;
    const aq = this.ar;
    aq[0] = nx;
    aq[1] = ny;
    aq[2] = nz;
    aq[3] = depth;
    this.pushOut(i, dynamic ? b : -1);
    if (!dynamic) this.markTouch(i, b);
  }

  /** Points under the triangle of their terrain cell (plus the thickness) go up along its normal. */
  private hitTerrain(p0: number, p1: number, f: { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; h: Float64Array }): void {
    const aq = this.ar;
    const th = aq[5] as number;
    const mu = aq[4] as number;
    const stride = f.ny + 1;
    for (let i = p0; i < p1; i++) {
      if ((this.w[i] as number) === 0) continue;
      const fx = ((this.x[i] as number) - f.x0) / f.dx;
      const fy = ((this.y[i] as number) - f.y0) / f.dy;
      if (!(fx >= 0 && fy >= 0 && fx < f.nx && fy < f.ny)) continue;
      const ci = Math.floor(fx);
      const cj = Math.floor(fy);
      const u = fx - ci;
      const v = fy - cj;
      const h00 = f.h[ci * stride + cj] as number;
      const h10 = f.h[(ci + 1) * stride + cj] as number;
      const h11 = f.h[(ci + 1) * stride + cj + 1] as number;
      const h01 = f.h[ci * stride + cj + 1] as number;
      let gx: number;
      let gy: number;
      let zt: number;
      if (u >= v) {
        gx = (h10 - h00) / f.dx;
        gy = (h11 - h10) / f.dy;
        zt = h00 + u * (h10 - h00) + v * (h11 - h10);
      } else {
        gx = (h11 - h01) / f.dx;
        gy = (h01 - h00) / f.dy;
        zt = h00 + u * (h11 - h01) + v * (h01 - h00);
      }
      if (!Number.isFinite(zt)) continue;
      const dz = (this.z[i] as number) - zt;
      if (dz < -0.5) continue;
      const l = Math.sqrt(gx * gx + gy * gy + 1);
      const s = dz / l;
      if (s >= th) continue;
      aq[0] = -gx / l;
      aq[1] = -gy / l;
      aq[2] = 1 / l;
      aq[3] = th - s;
      aq[4] = mu;
      this.pushOut(i, -1);
    }
  }

  /** The give of the base class, with the pins' part kept apart (it counts as tension). */

}
