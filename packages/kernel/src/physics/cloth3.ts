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
  /** Planes of the hull being tested (scratch). */
  private planes = new Float64Array(64);
  private o3 = new Float64Array(8);
  /** The push the bodies took at the start of this step, as normal force and pin tension (for the force count). */
  private appliedN = new Float64Array(0);
  private appliedT = new Float64Array(0);
  /** The part of the owed pushes that came through pins. */
  private pjx = new Float64Array(0);
  private pjy = new Float64Array(0);
  private pjz = new Float64Array(0);
  private attached = false;

  constructor(defs: readonly ClothDef[]) {
    super(defs, 3);
  }

  /** Binds the cloth to its world once it is built: body pins are held at their points in the bodies' own frames. */
  attach(w: World3): void {
    this.world = w;
    this.sizeBodies(w.n);
    if (this.bp0.length !== w.n * 3) this.bp0 = Float64Array.from(w.p);
    if (this.pjx.length !== w.n) {
      this.pjx = new Float64Array(w.n);
      this.pjy = new Float64Array(w.n);
      this.pjz = new Float64Array(w.n);
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
        const im = w.invM[i] as number;
        w.v[i * 3] = (w.v[i * 3] as number) + im * jx;
        w.v[i * 3 + 1] = (w.v[i * 3 + 1] as number) + im * jy;
        w.v[i * 3 + 2] = (w.v[i * 3 + 2] as number) + im * jz;
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
    this.attach(w);
    this.gx = w.gx;
    this.gy = w.gy;
    this.gz = w.gz;
    this.stepCloth(h);
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
    out[0] = (w.p[b * 3] as number) + (this.bdx[b] as number) + (R[o] as number) * lx + (R[o + 1] as number) * ly + (R[o + 2] as number) * lz;
    out[1] = (w.p[b * 3 + 1] as number) + (this.bdy[b] as number) + (R[o + 3] as number) * lx + (R[o + 4] as number) * ly + (R[o + 5] as number) * lz;
    out[2] = (w.p[b * 3 + 2] as number) + (this.bdz[b] as number) + (R[o + 6] as number) * lx + (R[o + 7] as number) * ly + (R[o + 8] as number) * lz;
  }

  /**
   * A body's inverse mass felt at a point, for a pin (any direction): 1/m plus the most its turn can add, |r|² times the
   * largest row sum of I⁻¹ (an upper bound, so a light, small body never takes more than it can).
   */
  protected override bodyW(b: number, x: number, y: number, z: number): number {
    if (!this.live(b)) return 0;
    const w = this.world as World3;
    const rx = x - (w.p[b * 3] as number);
    const ry = y - (w.p[b * 3 + 1] as number);
    const rz = z - (w.p[b * 3 + 2] as number);
    const I = w.invIw;
    const o = b * 9;
    let most = 0;
    for (let a = 0; a < 3; a++) {
      const s = Math.abs(I[o + a * 3] as number) + Math.abs(I[o + a * 3 + 1] as number) + Math.abs(I[o + a * 3 + 2] as number);
      if (s > most) most = s;
    }
    return (w.invM[b] as number) + (rx * rx + ry * ry + rz * rz) * most;
  }

  /** The inverse mass of body b along n at a point: 1/m + (r × n)·I⁻¹(r × n). */
  private bodyWn(b: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    if (!this.live(b)) return 0;
    const w = this.world as World3;
    const rx = x - (w.p[b * 3] as number);
    const ry = y - (w.p[b * 3 + 1] as number);
    const rz = z - (w.p[b * 3 + 2] as number);
    const cx = ry * nz - rz * ny;
    const cy = rz * nx - rx * nz;
    const cz = rx * ny - ry * nx;
    const I = w.invIw;
    const o = b * 9;
    const ix = (I[o] as number) * cx + (I[o + 1] as number) * cy + (I[o + 2] as number) * cz;
    const iy = (I[o + 3] as number) * cx + (I[o + 4] as number) * cy + (I[o + 5] as number) * cz;
    const iz = (I[o + 6] as number) * cx + (I[o + 7] as number) * cy + (I[o + 8] as number) * cz;
    return (w.invM[b] as number) + cx * ix + cy * iy + cz * iz;
  }

  protected override bodyV(b: number, x: number, y: number, z: number, out: Float64Array): void {
    const w = this.world as World3;
    if (w.type[b] === BodyType3.Static || w.gone.has(b)) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return;
    }
    const rx = x - (w.p[b * 3] as number);
    const ry = y - (w.p[b * 3 + 1] as number);
    const rz = z - (w.p[b * 3 + 2] as number);
    const wx = w.w[b * 3] as number;
    const wy = w.w[b * 3 + 1] as number;
    const wz = w.w[b * 3 + 2] as number;
    out[0] = (w.v[b * 3] as number) + wy * rz - wz * ry;
    out[1] = (w.v[b * 3 + 1] as number) + wz * rx - wx * rz;
    out[2] = (w.v[b * 3 + 2] as number) + wx * ry - wy * rx;
  }

  protected override bodyArm(b: number, x: number, y: number, z: number, out: Float64Array): void {
    const w = this.world as World3;
    out[0] = x - (w.p[b * 3] as number);
    out[1] = y - (w.p[b * 3 + 1] as number);
    out[2] = z - (w.p[b * 3 + 2] as number);
  }

  protected override bodyInvMass(b: number): number {
    return this.live(b) ? ((this.world as World3).invM[b] as number) : 0;
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
  protected override prepare(_h: number): void {
    const w = this.world as World3;
    this.nCand = 0;
    this.nWide = 0;
    this.nFace = 0;
    this.stamp = (this.stamp + 1) % 500000;
    const found = this.grid.found;
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
        const m = this.grid.inBox(
          (w.lo[k * 3] as number) - pad + Math.min(0, -dx), (w.lo[k * 3 + 1] as number) - pad + Math.min(0, -dy), (w.lo[k * 3 + 2] as number) - pad + Math.min(0, -dz),
          (w.hi[k * 3] as number) + pad + Math.max(0, -dx), (w.hi[k * 3 + 1] as number) + pad + Math.max(0, -dy), (w.hi[k * 3 + 2] as number) + pad + Math.max(0, -dz),
          this.n,
        );
        for (let q = 0; q < m; q++) {
          const i = found[q] as number;
          const ci = this.cloths[this.owner[i] as number];
          if (!ci || ci.asleep || ci.unstable) continue;
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
   * A ball against a face: the face's nearest point to the ball's centre is pushed out to the ball's surface (plus the
   * thickness), the corners sharing the move by their weights there. A face the centre has passed (it was on the other
   * side at the start of the step) goes back to its side. The body takes the momentum the corners gained, or, where a
   * corner is held, goes back out itself.
   */
  private hitFace(k: number, t: number, hs: number): void {
    const w = this.world as World3;
    const sh = w.shapes[k];
    if (!sh || this.triTorn(t)) return;
    const b = sh.body;
    const a = this.ta[t] as number;
    const bb = this.tb[t] as number;
    const e = this.tc[t] as number;
    const ci = this.cloths[this.owner[a] as number];
    if (!ci || ci.asleep) return;
    const R = sh.r + ci.def.thickness;
    const cx = (sh.wc[0] as number) + (this.bdx[b] as number);
    const cy = (sh.wc[1] as number) + (this.bdy[b] as number);
    const cz = (sh.wc[2] as number) + (this.bdz[b] as number);
    // the centre's height over the face now and at the start of the step (against the face as it was then)
    const o = this.scratch;
    const s1 = this.faceHeight(t, cx, cy, cz, this.x, this.y, this.z);
    const nx = o[0] as number;
    const ny = o[1] as number;
    const nz = o[2] as number;
    if (nx === 0 && ny === 0 && nz === 0) return;
    if (Math.abs(s1) >= R) return;
    const s0 = this.faceHeight(t, cx - ((w.p[b * 3] as number) - (this.bp0[b * 3] as number)), cy - ((w.p[b * 3 + 1] as number) - (this.bp0[b * 3 + 1] as number)), cz - ((w.p[b * 3 + 2] as number) - (this.bp0[b * 3 + 2] as number)), this.sx, this.sy, this.sz);
    // the foot of the centre on the face: only a face the ball stands over counts (points and edges are the points')
    if (!this.footOn(t, cx - s1 * nx, cy - s1 * ny, cz - s1 * nz, 0)) return;
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
      const wb = this.bodyWn(b, cx, cy, cz, mx, my, mz);
      if (!(wb > 0)) return;
      const kk = depth / wb / this.hStep;
      this.give(b, this.owner[a] as number, -mx * kk, -my * kk, -mz * kk, cx + mx * sh.r, cy + my * sh.r, cz + mz * sh.r, this.hStep);
      const share = kk * hs;
      this.holdPush(a, mx * share * ba, my * share * ba, mz * share * ba);
      this.holdPush(bb, mx * share * bbw, my * share * bbw, mz * share * bbw);
      this.holdPush(e, mx * share * be, my * share * be, mz * share * be);
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
    if (moving) this.give(b, this.owner[a] as number, jx, jy, jz, cx + mx * sh.r, cy + my * sh.r, cz + mz * sh.r, 0);
    else this.markTouch(a, b);
  }

  protected override collide(hs: number): void {
    const w = this.world as World3;
    for (let q = 0; q < this.nCand; q++) {
      const k = this.candS[q] as number;
      const i = this.candP[q] as number;
      const sh = w.shapes[k];
      if (!sh) continue;
      const ci = this.cloths[this.owner[i] as number];
      if (!ci) continue;
      const b = sh.body;
      // a point pinned to a body does not hit that body
      const pq = this.pinOf[i] as number;
      if (pq >= 0 && this.pinBody[pq] === b) continue;
      if (sh.kind === 0) this.hitSphere(i, b, (sh.wc[0] as number) + (this.bdx[b] as number), (sh.wc[1] as number) + (this.bdy[b] as number), (sh.wc[2] as number) + (this.bdz[b] as number), sh.r + ci.def.thickness, ci.def.friction, hs);
      else this.hitHull(i, k, ci.def.thickness, ci.def.friction, hs);
    }
    for (let q = 0; q < this.nFace; q++) this.hitFace(this.faceS[q] as number, this.faceT[q] as number, hs);
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
          for (let i = ci.p0; i < e; i++) {
            if ((this.w[i] as number) === 0) continue;
            const s = nx * (this.x[i] as number) + ny * (this.y[i] as number) + nz * (this.z[i] as number) - d;
            if (s >= th) continue;
            this.pushOut(i, -1, nx, ny, nz, th - s, fr, hs);
          }
        } else if (sh.hf) this.hitTerrain(ci.p0, e, sh.hf, th, fr, hs);
      }
    }
  }

  /**
   * Moves point i out by `depth` along n, sharing the move with body b (−1: a wall) by their masses, then takes off the
   * slide friction allows: at most μ × depth of the point's move along the face this small step, against the body's.
   */
  private pushOut(i: number, b: number, nx: number, ny: number, nz: number, depth: number, mu: number, hs: number): void {
    const wp = this.w[i] as number;
    const x = this.x[i] as number;
    const y = this.y[i] as number;
    const z = this.z[i] as number;
    const moving = b >= 0 && this.live(b);
    if (moving && (wp === 0 || this.taut[i] === 1)) {
      // the cloth holds here (a pin, or a tether at its length): the body goes back out instead, as off a wall, and the
      // push goes on to the pins that hold the point
      const wb = this.bodyWn(b, x, y, z, nx, ny, nz);
      if (!(wb > 0)) return;
      const dl = depth / wb;
      const k = dl / this.hStep;
      this.give(b, this.owner[i] as number, -nx * k, -ny * k, -nz * k, x, y, z, this.hStep);
      this.holdPush(i, nx * k * hs, ny * k * hs, nz * k * hs);
      return;
    }
    if (wp === 0) return;
    let mx = depth * nx;
    let my = depth * ny;
    let mz = depth * nz;
    // friction: the point's slide this small step, against the body's surface
    const o = this.o3;
    if (b >= 0) this.bodyV(b, x, y, z, o);
    else {
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
    let fx = 0;
    let fy = 0;
    let fz = 0;
    if (tl > 1e-15 && mu > 0) {
      const cut = Math.min(1, (mu * depth) / tl);
      fx = -tx * cut;
      fy = -ty * cut;
      fz = -tz * cut;
      mx += fx;
      my += fy;
      mz += fz;
    }
    this.x[i] = x + mx;
    this.y[i] = y + my;
    this.z[i] = z + mz;
    if (moving) {
      // within the cloth's small steps the body holds its pose; it takes back the point's change of momentum, m Δx / hs,
      // at the start of the next step, so momentum is kept and a resting body's weight reaches the pins
      const k = 1 / (wp * hs);
      this.give(b, this.owner[i] as number, -mx * k, -my * k, -mz * k, x, y, z, 0);
    } else if (b >= 0) this.markTouch(i, b);
  }

  /** A push (in the pins' Δλ units) a held point passes on: to its own pin, or shared by the pins its tethers reach. */
  private holdPush(i: number, ex: number, ey: number, ez: number): void {
    const q = this.pinOf[i] as number;
    if (q >= 0 && (this.pinBody[q] as number) < 0) {
      this.pinFx[q] = (this.pinFx[q] as number) + ex;
      this.pinFy[q] = (this.pinFy[q] as number) + ey;
      this.pinFz[q] = (this.pinFz[q] as number) + ez;
      return;
    }
    const ci = this.cloths[this.owner[i] as number];
    if (!ci) return;
    let n = 0;
    for (let k = ci.te0; k < ci.te0 + ci.teN; k++) if (this.tePoint[k] === i) n++;
    if (n === 0) return;
    for (let k = ci.te0; k < ci.te0 + ci.teN; k++) {
      if (this.tePoint[k] !== i) continue;
      const p = this.tePin[k] as number;
      this.pinFx[p] = (this.pinFx[p] as number) + ex / n;
      this.pinFy[p] = (this.pinFy[p] as number) + ey / n;
      this.pinFz[p] = (this.pinFz[p] as number) + ez / n;
    }
  }

  /** A point against a ball: out along the direction its path met the ball (as the ball moved this step). */
  private hitSphere(i: number, b: number, cx: number, cy: number, cz: number, R: number, mu: number, hs: number): void {
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
    if (depth > 0) this.pushOut(i, w.type[b] === BodyType3.Static ? -1 : b, nx, ny, nz, depth, mu, hs);
    if (w.type[b] === BodyType3.Static) this.markTouch(i, b);
  }

  private markTouch(i: number, b: number): void {
    this.touched[(this.owner[i] as number) * this.bjx.length + b] = 1;
  }

  /** A point against a convex hull: out through the face its path (against the hull as it moved) came in by. */
  private hitHull(i: number, k: number, th: number, mu: number, hs: number): void {
    const w = this.world as World3;
    const sh = w.shapes[k];
    if (!sh) return;
    const b = sh.body;
    const nf = sh.faces.length;
    if (this.planes.length < nf * 4) this.planes = new Float64Array(nf * 8);
    const pl = this.planes;
    const wv = sh.wv;
    const wn = sh.wn;
    // the point against the hull where the body is now (it may have been pushed back this step)
    const x = (this.x[i] as number) - (this.bdx[b] as number);
    const y = (this.y[i] as number) - (this.bdy[b] as number);
    const z = (this.z[i] as number) - (this.bdz[b] as number);
    let sep = -Infinity;
    let best = 0;
    for (let f = 0; f < nf; f++) {
      const c0 = (sh.faces[f] as Int32Array)[0] as number;
      const nx = wn[f * 3] as number;
      const ny = wn[f * 3 + 1] as number;
      const nz = wn[f * 3 + 2] as number;
      pl[f * 4] = nx;
      pl[f * 4 + 1] = ny;
      pl[f * 4 + 2] = nz;
      const d = nx * (wv[c0 * 3] as number) + ny * (wv[c0 * 3 + 1] as number) + nz * (wv[c0 * 3 + 2] as number) + th;
      pl[f * 4 + 3] = d;
      const s = nx * x + ny * y + nz * z - d;
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
      const nx = pl[f * 4] as number;
      const ny = pl[f * 4 + 1] as number;
      const nz = pl[f * 4 + 2] as number;
      const s0 = nx * ax + ny * ay + nz * az - (pl[f * 4 + 3] as number);
      const du = nx * ux + ny * uy + nz * uz;
      if (du < 0) {
        const t = -s0 / du;
        if (t > tIn) {
          tIn = t;
          inFace = f;
        }
      }
    }
    const face = inFace >= 0 && tIn >= -1e-9 ? inFace : best;
    const nx = pl[face * 4] as number;
    const ny = pl[face * 4 + 1] as number;
    const nz = pl[face * 4 + 2] as number;
    const depth = -(nx * x + ny * y + nz * z - (pl[face * 4 + 3] as number));
    if (!(depth > 0)) return;
    const dynamic = w.type[b] !== BodyType3.Static;
    this.pushOut(i, dynamic ? b : -1, nx, ny, nz, depth, mu, hs);
    if (!dynamic) this.markTouch(i, b);
  }

  /** Points under the triangle of their terrain cell (plus the thickness) go up along its normal. */
  private hitTerrain(p0: number, p1: number, f: { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; h: Float64Array }, th: number, mu: number, hs: number): void {
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
      this.pushOut(i, -1, -gx / l, -gy / l, 1 / l, th - s, mu, hs);
    }
  }

  /** The give of the base class, with the pins' part kept apart (it counts as tension). */
  protected override give(b: number, c: number, jx: number, jy: number, jz: number, x: number, y: number, z: number, hs: number): void {
    super.give(b, c, jx, jy, jz, x, y, z, hs);
    if (this.inPins) {
      this.pjx[b] = (this.pjx[b] as number) + jx;
      this.pjy[b] = (this.pjy[b] as number) + jy;
      this.pjz[b] = (this.pjz[b] as number) + jz;
    }
  }
}
