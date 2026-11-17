/**
 * Cloth in the plane against the world (docs/features/physics/design.md 9.5, 9.6): ropes and nets against bodies,
 * solid shapes and thin walls, pins to bodies, and smoke's flow as wind.
 *
 * As in space (`./cloth3`): the pairs that may touch are found once a step; a point goes out of a shape the way its
 * path came in (against the body as it moved this step), so a thin wall never lets a rope through; a ball also meets
 * the threads between points. Within the cloth's small steps a body holds its pose: it takes back the momentum the
 * points gained from it, or, where the cloth holds (a pin, a tether at its length), goes back out itself.
 */
import type { ClothDef } from './cloth';
import { ClothSet } from './cloth';
import type { Smoke2 } from './smoke2';
import type { World2 } from './world2';
import { BodyType, FK } from './world2';

const NK = 10;

export class Cloth2 extends ClothSet {
  private world: World2 | undefined;
  /** Smoke grids whose flow is the air the cloth feels (design 9.5). */
  smokes: readonly Smoke2[] = [];
  private nCand = 0;
  private candS = new Int32Array(1024);
  private candP = new Int32Array(1024);
  private nSeg = 0;
  private segS = new Int32Array(256);
  private segT = new Int32Array(256);
  private segMark = new Int32Array(0);
  private stamp = 0;
  private bp0 = new Float64Array(0);
  private appliedN = new Float64Array(0);
  private appliedT = new Float64Array(0);
  private attached = false;
  private o2 = new Float64Array(4);

  constructor(defs: readonly ClothDef[]) {
    super(defs, 2);
    this.gz = 0;
    this.gy = -9.8;
  }

  attach(w: World2): void {
    this.world = w;
    this.sizeBodies(w.n);
    if (this.bp0.length !== w.n * 2) {
      this.bp0 = new Float64Array(w.n * 2);
      this.appliedN = new Float64Array(w.n * 2);
      this.appliedT = new Float64Array(w.n * 2);
      for (let i = 0; i < w.n; i++) {
        this.bp0[i * 2] = w.px[i] as number;
        this.bp0[i * 2 + 1] = w.py[i] as number;
      }
    }
    if (this.attached) return;
    this.attached = true;
    for (let q = 0; q < this.pinPoint.length; q++) {
      const b = this.pinBody[q] as number;
      if (b < 0) continue;
      // the point in the body's own frame
      const dx = (this.pinX[q] as number) - (w.px[b] as number);
      const dy = (this.pinY[q] as number) - (w.py[b] as number);
      const c = w.qc[b] as number;
      const s = w.qs[b] as number;
      this.pinX[q] = c * dx + s * dy;
      this.pinY[q] = -s * dx + c * dy;
      this.pinZ[q] = 0;
    }
  }

  /** Before the body step: last step's pushes go in as speed, turn and place (design 9.6). */
  applyImpulses(w: World2): void {
    this.attach(w);
    for (let i = 0; i < w.n; i++) {
      const jx = this.bjx[i] as number;
      const jy = this.bjy[i] as number;
      this.appliedT[i * 2] = this.pjx[i] as number;
      this.appliedT[i * 2 + 1] = this.pjy[i] as number;
      this.appliedN[i * 2] = jx - (this.pjx[i] as number);
      this.appliedN[i * 2 + 1] = jy - (this.pjy[i] as number);
      if ((jx !== 0 || jy !== 0) && w.type[i] === BodyType.Dynamic && !w.gone.has(i) && w.awake[i] === 1) {
        const im = w.invM[i] as number;
        // the pins' part is already in the body's speed: it took the small steps with the cloth
        w.vx[i] = (w.vx[i] as number) + im * (jx - (this.pjx[i] as number));
        w.vy[i] = (w.vy[i] as number) + im * (jy - (this.pjy[i] as number));
        w.w[i] = (w.w[i] as number) + (w.invI[i] as number) * (this.btz[i] as number);
        w.px[i] = (w.px[i] as number) + (this.bdx[i] as number);
        w.py[i] = (w.py[i] as number) + (this.bdy[i] as number);
      }
      this.bjx[i] = 0;
      this.bjy[i] = 0;
      this.bjz[i] = 0;
      this.btx[i] = 0;
      this.bty[i] = 0;
      this.btz[i] = 0;
      this.pjx[i] = 0;
      this.pjy[i] = 0;
      this.bp0[i * 2] = w.px[i] as number;
      this.bp0[i * 2 + 1] = w.py[i] as number;
    }
    if (this.bv0.length !== w.n * 2) this.bv0 = new Float64Array(w.n * 2);
    for (let i = 0; i < w.n; i++) {
      this.bv0[i * 2] = w.vx[i] as number;
      this.bv0[i * 2 + 1] = w.vy[i] as number;
    }
  }

  private bv0 = new Float64Array(0);

  protected override bodyStep(b: number, out: Float64Array): void {
    const w = this.world as World2;
    out[0] = this.bp0[b * 2] as number;
    out[1] = this.bp0[b * 2 + 1] as number;
    out[2] = 0;
    out[3] = this.bv0[b * 2] as number;
    out[4] = this.bv0[b * 2 + 1] as number;
    out[5] = 0;
    out[6] = w.px[b] as number;
    out[7] = w.py[b] as number;
    out[8] = 0;
    out[9] = w.vx[b] as number;
    out[10] = w.vy[b] as number;
    out[11] = 0;
  }

  protected override setBody(b: number, x: number, y: number, _z: number, vx: number, vy: number): void {
    const w = this.world as World2;
    w.px[b] = x;
    w.py[b] = y;
    w.vx[b] = vx;
    w.vy[b] = vy;
    w.updateShapes(b);
  }

  private c2 = new Float64Array(3);
  /** Body b's centre in the cloth's small steps. */
  private centre(b: number): Float64Array {
    const c = this.c2;
    if (this.subAt(b, c)) return c;
    const w = this.world as World2;
    c[0] = (w.px[b] as number) + (this.bdx[b] as number);
    c[1] = (w.py[b] as number) + (this.bdy[b] as number);
    c[2] = 0;
    return c;
  }

  account(w: World2, h: number): void {
    const inv = 1 / h;
    for (let i = 0; i < w.n && i * 2 < this.appliedN.length; i++) {
      if (w.type[i] !== BodyType.Dynamic || w.awake[i] === 0) continue;
      const o = i * NK * 2;
      for (let a = 0; a < 2; a++) {
        w.forces[o + FK.normal * 2 + a] = (w.forces[o + FK.normal * 2 + a] as number) + (this.appliedN[i * 2 + a] as number) * inv;
        w.forces[o + FK.tension * 2 + a] = (w.forces[o + FK.tension * 2 + a] as number) + (this.appliedT[i * 2 + a] as number) * inv;
      }
    }
  }

  step(w: World2, h: number): void {
    this.attach(w);
    this.gx = w.gx;
    this.gy = w.gy;
    this.gz = 0;
    this.stepCloth(h);
  }

  /* ------------------------------ hooks ------------------------------ */

  protected override hasFlow(): boolean {
    return this.smokes.length > 0;
  }

  protected override airAt(x: number, y: number, out: Float64Array): void {
    out[0] = this.windX;
    out[1] = this.windY;
    out[2] = 0;
    for (let k = 0; k < this.smokes.length; k++) {
      const s = this.smokes[k] as Smoke2;
      if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) continue;
      out[0] = s.sampleU(x, y);
      out[1] = s.sampleV(x, y);
      return;
    }
  }

  /** Where body b is in this small step against its pose now (as in space). */
  private off(a: 'x' | 'y', b: number): number {
    const w = this.world as World2;
    const now = a === 'x' ? (w.px[b] as number) : (w.py[b] as number);
    return (this.centre(b)[a === 'x' ? 0 : 1] as number) - now;
  }

  private live(b: number): boolean {
    const w = this.world as World2;
    return w.type[b] === BodyType.Dynamic && !w.gone.has(b) && w.awake[b] === 1;
  }

  protected override anchor(q: number, out: Float64Array): void {
    const w = this.world as World2;
    const b = this.pinBody[q] as number;
    const c = w.qc[b] as number;
    const s = w.qs[b] as number;
    const lx = this.pinX[q] as number;
    const ly = this.pinY[q] as number;
    const p = this.centre(b);
    out[0] = (p[0] as number) + c * lx - s * ly;
    out[1] = (p[1] as number) + s * lx + c * ly;
    out[2] = 0;
  }

  protected override bodyW(b: number, x: number, y: number): number {
    if (!this.live(b)) return 0;
    const w = this.world as World2;
    const rx = x - (this.centre(b)[0] as number);
    const ry = y - (this.centre(b)[1] as number);
    return (w.invM[b] as number) + (rx * rx + ry * ry) * (w.invI[b] as number);
  }

  private bodyWn(b: number, x: number, y: number, nx: number, ny: number): number {
    if (!this.live(b)) return 0;
    const w = this.world as World2;
    const rx = x - (this.centre(b)[0] as number);
    const ry = y - (this.centre(b)[1] as number);
    const rn = rx * ny - ry * nx;
    return (w.invM[b] as number) + rn * rn * (w.invI[b] as number);
  }

  protected override bodyV(b: number, x: number, y: number, _z: number, out: Float64Array): void {
    const w = this.world as World2;
    if (w.type[b] === BodyType.Static || w.gone.has(b)) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return;
    }
    const om = w.w[b] as number;
    out[0] = (w.vx[b] as number) - om * (y - (w.py[b] as number));
    out[1] = (w.vy[b] as number) + om * (x - (w.px[b] as number));
    out[2] = 0;
  }

  protected override bodyArm(b: number, x: number, y: number, _z: number, out: Float64Array): void {
    out[0] = x - (this.centre(b)[0] as number);
    out[1] = y - (this.centre(b)[1] as number);
    out[2] = 0;
  }

  protected override bodyInvMass(b: number): number {
    return this.live(b) ? ((this.world as World2).invM[b] as number) : 0;
  }

  protected override bodiesStir(c: number): boolean {
    const w = this.world;
    const ci = this.cloths[c];
    if (!w || !ci) return false;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = ci.p0; i < ci.p0 + ci.n; i++) {
      x0 = Math.min(x0, this.x[i] as number);
      x1 = Math.max(x1, this.x[i] as number);
      y0 = Math.min(y0, this.y[i] as number);
      y1 = Math.max(y1, this.y[i] as number);
    }
    const m = ci.def.thickness + 0.05;
    for (let b = 0; b < w.n; b++) {
      if (!this.live(b)) continue;
      for (let k = w.shape0[b] as number; k < (w.shape0[b] as number) + (w.shapeN[b] as number); k++) {
        if ((w.minX[k] as number) <= x1 + m && (w.maxX[k] as number) >= x0 - m && (w.minY[k] as number) <= y1 + m && (w.maxY[k] as number) >= y0 - m) return true;
      }
    }
    return false;
  }

  protected override prepare(_h: number): void {
    const w = this.world as World2;
    this.nCand = 0;
    this.nSeg = 0;
    this.stamp = (this.stamp + 1) % 500000;
    if (this.segMark.length !== this.ta.length) this.segMark = new Int32Array(this.ta.length);
    let thick = 0;
    for (let c = 0; c < this.cloths.length; c++) thick = Math.max(thick, (this.cloths[c] as (typeof this.cloths)[number]).def.thickness);
    const pad = thick + this.pad + 0.01;
    for (let b = 0; b < w.n; b++) {
      if (w.gone.has(b)) continue;
      const dx = (w.px[b] as number) - (this.bp0[b * 2] as number);
      const dy = (w.py[b] as number) - (this.bp0[b * 2 + 1] as number);
      for (let k = w.shape0[b] as number; k < (w.shape0[b] as number) + (w.shapeN[b] as number); k++) {
        const sh = w.shapes[k];
        if (!sh) continue;
        const m = this.inGrid((w.minX[k] as number) - pad + Math.min(0, -dx), (w.minY[k] as number) - pad + Math.min(0, -dy), -1, (w.maxX[k] as number) + pad + Math.max(0, -dx), (w.maxY[k] as number) + pad + Math.max(0, -dy), 1);
        const found = this.grid.found;
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
          // a round shape also meets the threads at the point, so it cannot slip between two points
          if (sh.kind === 0) this.addThreads(k, i, ci);
        }
      }
    }
  }

  /** The threads (segments) that end at point i, once each for shape k. */
  private addThreads(k: number, i: number, ci: (typeof this.cloths)[number]): void {
    const key = this.stamp * 4096 + k + 1;
    for (let t = ci.t0; t < ci.t0 + ci.tn; t++) {
      if (this.ta[t] !== i && this.tb[t] !== i) continue;
      if (this.segMark[t] === key) continue;
      this.segMark[t] = key;
      if (this.nSeg >= this.segS.length) {
        const S = new Int32Array(this.segS.length * 2);
        S.set(this.segS);
        const T = new Int32Array(this.segT.length * 2);
        T.set(this.segT);
        this.segS = S;
        this.segT = T;
      }
      this.segS[this.nSeg] = k;
      this.segT[this.nSeg] = t;
      this.nSeg++;
    }
  }

  protected override collide(hs: number): void {
    const w = this.world as World2;
    for (let q = 0; q < this.nCand; q++) {
      const k = this.candS[q] as number;
      const i = this.candP[q] as number;
      const sh = w.shapes[k];
      if (!sh) continue;
      const ci = this.cloths[this.owner[i] as number];
      if (!ci) continue;
      const b = sh.body;
      const pq = this.pinOf[i] as number;
      if (pq >= 0 && this.pinBody[pq] === b) continue;
      const th = ci.def.thickness;
      if (this.hasBodyPins && this.nearBodyPin(i, b, 2 * reach2(sh) + th)) continue;
      const fr = ci.def.friction;
      if (sh.kind === 0) this.hitCircle(i, b, sh.wcx + this.off("x", b), sh.wcy + this.off("y", b), sh.radius + th, fr, hs);
      else if (sh.wx.length === 2) this.hitWall(i, b, sh.wx, sh.wy, th, fr, hs);
      else this.hitPoly(i, b, sh.wx, sh.wy, sh.wnx, sh.wny, th, fr, hs);
    }
    for (let q = 0; q < this.nSeg; q++) this.hitThread(this.segS[q] as number, this.segT[q] as number, hs);
  }

  /** The path's start against body b: the point at the start of the step, moved as the body moved. */
  private startX(i: number, b: number): number {
    const w = this.world as World2;
    return (this.sx[i] as number) + (w.px[b] as number) - (this.bp0[b * 2] as number);
  }

  private startY(i: number, b: number): number {
    const w = this.world as World2;
    return (this.sy[i] as number) + (w.py[b] as number) - (this.bp0[b * 2 + 1] as number);
  }

  private hitCircle(i: number, b: number, cx: number, cy: number, R: number, mu: number, hs: number): void {
    const ex = (this.x[i] as number) - cx;
    const ey = (this.y[i] as number) - cy;
    const d2 = ex * ex + ey * ey;
    if (d2 >= R * R) return;
    const ax = this.startX(i, b) - cx;
    const ay = this.startY(i, b) - cy;
    let nx: number;
    let ny: number;
    let depth: number;
    const a2 = ax * ax + ay * ay;
    if (a2 >= R * R && ax * ex + ay * ey < 0.5 * Math.sqrt(a2 * d2)) {
      const ux = ex - ax;
      const uy = ey - ay;
      const A = ux * ux + uy * uy;
      const B = ax * ux + ay * uy;
      const disc = B * B - A * (a2 - R * R);
      const t = A > 0 && disc >= 0 ? (-B - Math.sqrt(disc)) / A : 0;
      const hx = ax + t * ux;
      const hy = ay + t * uy;
      const hl = Math.sqrt(hx * hx + hy * hy) || 1;
      nx = hx / hl;
      ny = hy / hl;
      depth = R - (ex * nx + ey * ny);
    } else {
      const d = Math.sqrt(d2);
      nx = d > 1e-12 ? ex / d : 0;
      ny = d > 1e-12 ? ey / d : 1;
      depth = R - d;
    }
    if (depth > 0) this.pushOut(i, b, nx, ny, depth, mu, hs);
  }

  /** A thin wall: the point stays on the side it started the step on, `th` off the wall, round its ends. */
  private hitWall(i: number, b: number, wx: Float64Array, wy: Float64Array, th: number, mu: number, hs: number): void {
    const bx = this.off("x", b);
    const by = this.off("y", b);
    const ax = (wx[0] as number) + bx;
    const ay = (wy[0] as number) + by;
    const ex = (wx[1] as number) + bx - ax;
    const ey = (wy[1] as number) + by - ay;
    const l2 = ex * ex + ey * ey;
    if (!(l2 > 0)) return;
    const l = Math.sqrt(l2);
    const nx = -ey / l;
    const ny = ex / l;
    const xi = this.x[i] as number;
    const yi = this.y[i] as number;
    const s0 = nx * (this.startX(i, b) - ax) + ny * (this.startY(i, b) - ay);
    const s1 = nx * (xi - ax) + ny * (yi - ay);
    const side = s0 >= 0 ? 1 : -1;
    const t = ((xi - ax) * ex + (yi - ay) * ey) / l2;
    if (s0 * s1 < 0) {
      const f = s0 / (s0 - s1);
      const mx = this.startX(i, b) + f * (xi - this.startX(i, b));
      const my = this.startY(i, b) + f * (yi - this.startY(i, b));
      const tm = ((mx - ax) * ex + (my - ay) * ey) / l2;
      if (tm >= 0 && tm <= 1) {
        this.pushOut(i, b, nx * side, ny * side, th - s1 * side, mu, hs);
        return;
      }
    }
    if (t >= 0 && t <= 1) {
      if (s1 * side >= th) return;
      this.pushOut(i, b, nx * side, ny * side, th - s1 * side, mu, hs);
      return;
    }
    // past an end: round the corner
    const tc = t < 0 ? 0 : 1;
    const cx = xi - (ax + tc * ex);
    const cy = yi - (ay + tc * ey);
    const d = Math.sqrt(cx * cx + cy * cy);
    if (d >= th || !(d > 1e-12)) return;
    this.pushOut(i, b, cx / d, cy / d, th - d, mu, hs);
  }

  /** A convex polygon: out through the edge the path came in by (Cyrus and Beck), else the nearest edge. */
  private hitPoly(i: number, b: number, wx: Float64Array, wy: Float64Array, wnx: Float64Array, wny: Float64Array, th: number, mu: number, hs: number): void {
    const n = wx.length;
    const bx = this.off("x", b);
    const by = this.off("y", b);
    const x = (this.x[i] as number) - bx;
    const y = (this.y[i] as number) - by;
    let sep = -Infinity;
    let best = 0;
    for (let e = 0; e < n; e++) {
      const s = (wnx[e] as number) * (x - (wx[e] as number)) + (wny[e] as number) * (y - (wy[e] as number)) - th;
      if (s >= 0) return;
      if (s > sep) {
        sep = s;
        best = e;
      }
    }
    const ax = this.startX(i, b) - bx;
    const ay = this.startY(i, b) - by;
    const ux = x - ax;
    const uy = y - ay;
    let tIn = -Infinity;
    let inEdge = -1;
    for (let e = 0; e < n; e++) {
      const nx = wnx[e] as number;
      const ny = wny[e] as number;
      const s0 = nx * (ax - (wx[e] as number)) + ny * (ay - (wy[e] as number)) - th;
      const du = nx * ux + ny * uy;
      if (du < 0) {
        const t = -s0 / du;
        if (t > tIn) {
          tIn = t;
          inEdge = e;
        }
      }
    }
    const e = inEdge >= 0 && tIn >= -1e-9 ? inEdge : best;
    const nx = wnx[e] as number;
    const ny = wny[e] as number;
    const depth = -(nx * (x - (wx[e] as number)) + ny * (y - (wy[e] as number)) - th);
    if (depth > 0) this.pushOut(i, b, nx, ny, depth, mu, hs);
  }

  /** A thread against a round shape: its nearest point to the centre goes out to the rim, the ends sharing the move. */
  private hitThread(k: number, t: number, hs: number): void {
    const w = this.world as World2;
    const sh = w.shapes[k];
    if (!sh || this.triTorn(t)) return;
    const b = sh.body;
    const a = this.ta[t] as number;
    const e = this.tb[t] as number;
    const ci = this.cloths[this.owner[a] as number];
    if (!ci || ci.asleep) return;
    const R = sh.radius + ci.def.thickness;
    const cx = sh.wcx + this.off("x", b);
    const cy = sh.wcy + this.off("y", b);
    const ax = this.x[a] as number;
    const ay = this.y[a] as number;
    const ex = (this.x[e] as number) - ax;
    const ey = (this.y[e] as number) - ay;
    const l2 = ex * ex + ey * ey;
    if (!(l2 > 0)) return;
    const f = ((cx - ax) * ex + (cy - ay) * ey) / l2;
    // only where the centre stands over the thread (its ends are the points' own tests)
    if (!(f > 0 && f < 1)) return;
    const l = Math.sqrt(l2);
    let nx = -ey / l;
    let ny = ex / l;
    const s1 = nx * (cx - ax) + ny * (cy - ay);
    // the side the centre was on at the start of the step, against the thread then
    const dbx = (w.px[b] as number) - (this.bp0[b * 2] as number);
    const dby = (w.py[b] as number) - (this.bp0[b * 2 + 1] as number);
    const sax = this.sx[a] as number;
    const say = this.sy[a] as number;
    const sex = (this.sx[e] as number) - sax;
    const sey = (this.sy[e] as number) - say;
    const s0 = -sey * (cx - dbx - sax) + sex * (cy - dby - say);
    const side = s0 >= 0 ? 1 : -1;
    const depth = R - s1 * side;
    if (!(depth > 0) || depth > 2 * R) return;
    // the thread moves away from the centre: along −side n
    nx = -side * nx;
    ny = -side * ny;
    const wa = this.w[a] as number;
    const we = this.w[e] as number;
    const held = wa === 0 || we === 0 || this.taut[a] === 1 || this.taut[e] === 1;
    if (held && this.live(b)) {
      const wb = this.bodyWn(b, cx, cy, nx, ny);
      if (!(wb > 0)) return;
      const kk = depth / wb / this.hStep;
      this.give(b, this.owner[a] as number, -nx * kk, -ny * kk, 0, cx + nx * sh.radius, cy + ny * sh.radius, 0, this.hStep);
      return;
    }
    const W = (1 - f) * (1 - f) * wa + f * f * we;
    if (!(W > 0)) return;
    const dl = depth / W;
    let jx = 0;
    let jy = 0;
    if (wa > 0) {
      const d = wa * (1 - f) * dl;
      this.x[a] = ax + d * nx;
      this.y[a] = ay + d * ny;
      jx -= (d * nx) / (wa * hs);
      jy -= (d * ny) / (wa * hs);
    }
    if (we > 0) {
      const d = we * f * dl;
      this.x[e] = (this.x[e] as number) + d * nx;
      this.y[e] = (this.y[e] as number) + d * ny;
      jx -= (d * nx) / (we * hs);
      jy -= (d * ny) / (we * hs);
    }
    if (this.live(b)) this.give(b, this.owner[a] as number, jx, jy, 0, cx + nx * sh.radius, cy + ny * sh.radius, 0, 0);
    else this.touched[(this.owner[a] as number) * this.bjx.length + b] = 1;
  }



  /** As in space: a free point moves out (the body takes its momentum); a held one pushes the body back out. */
  private pushOut(i: number, b: number, nx: number, ny: number, depth: number, mu: number, hs: number): void {
    const wp = this.w[i] as number;
    const x = this.x[i] as number;
    const y = this.y[i] as number;
    const moving = this.live(b);
    if (moving && (wp === 0 || this.taut[i] === 1)) {
      const wb = this.bodyWn(b, x, y, nx, ny);
      if (!(wb > 0)) return;
      const k = depth / wb / this.hStep;
      this.give(b, this.owner[i] as number, -nx * k, -ny * k, 0, x, y, 0, this.hStep);
      return;
    }
    if (wp === 0) return;
    let mx = depth * nx;
    let my = depth * ny;
    const o = this.o2;
    if (moving) this.bodyV(b, x, y, 0, this.scratch);
    o[0] = moving ? (this.scratch[0] as number) : 0;
    o[1] = moving ? (this.scratch[1] as number) : 0;
    const rx = x + mx - (this.px[i] as number) - (o[0] as number) * hs;
    const ry = y + my - (this.py[i] as number) - (o[1] as number) * hs;
    const rn = rx * nx + ry * ny;
    const tx = rx - rn * nx;
    const ty = ry - rn * ny;
    const tl = Math.sqrt(tx * tx + ty * ty);
    if (tl > 1e-15 && mu > 0) {
      const cut = Math.min(1, (mu * depth) / tl);
      mx -= tx * cut;
      my -= ty * cut;
    }
    this.x[i] = x + mx;
    this.y[i] = y + my;
    if (moving) {
      const k = 1 / (wp * hs);
      this.give(b, this.owner[i] as number, -mx * k, -my * k, 0, x, y, 0, 0);
    } else this.touched[(this.owner[i] as number) * this.bjx.length + b] = 1;
  }
}

/** Half the largest distance across a shape in the plane (a circle's radius; a polygon's half diagonal). */
function reach2(sh: { readonly kind: number; readonly radius: number; readonly wx: Float64Array; readonly wy: Float64Array }): number {
  if (sh.kind === 0) return sh.radius;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let k = 0; k < sh.wx.length; k++) {
    x0 = Math.min(x0, sh.wx[k] as number);
    x1 = Math.max(x1, sh.wx[k] as number);
    y0 = Math.min(y0, sh.wy[k] as number);
    y1 = Math.max(y1, sh.wy[k] as number);
  }
  return 0.5 * Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
}
