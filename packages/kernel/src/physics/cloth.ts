/**
 * Cloth (docs/features/physics/design.md 9.5, 9.6, 10.3, 11.3): sheets, ropes and nets of points joined by links,
 * stepped by extended position-based dynamics (XPBD) with small steps.
 *
 * One world step of `h` is 4 small steps of `h / 4`. Each small step moves the points by their speed, gravity and the
 * air, pulls every link back toward its length once in a fixed order (stretch links in red-black order, then shear,
 * then bend), holds the pins, pulls points back within reach of their pins (tethers, below), pushes the points out of
 * solids and bodies with friction, and sets each point's speed from how far it moved, less the damping. After the small
 * steps the links that stretched past `tears` break in id order, the cloth meets itself and other cloths once, and the
 * cloth may fall asleep.
 *
 * Bodies and cloth push each other both ways (design 9.6): a pin to a body and a touch between a point and a body are
 * constraints between the point and the body, with the body's inverse mass at that point. What the body would have
 * moved is added up over the small steps and given to it at the start of the next step, as a push and as a move (the
 * position-based rule: the place and the speed both change), so a ball rests on a sheet and a rope holds a weight.
 *
 * Tethers (round 9): with no `tears`, every point keeps within its start distance (times the stretch's slack) of its
 * two nearest pins. A one-way length limit per point and pin, found by builders of games for a long time, it stops a
 * hanging sheet from stretching under its own weight with one pass a small step; links still carry the shape.
 *
 * Everything is plain arithmetic on typed arrays made when the cloth is built: a step makes no garbage. Every loop runs
 * in index order, so the film is the same on every computer.
 */
import { NeighbourGrid3 } from './grid3';

/** Small steps per world step (design 9.5). */
export const SUBSTEPS = 4;
/** The most points of one sheet, of one rope, and of every cloth of a figure (design 11.3). */
export const MAX_SHEET_U = 64;
export const MAX_SHEET_V = 32;
export const MAX_SHEET = MAX_SHEET_U * MAX_SHEET_V;
export const MAX_ROPE = 400;
export const MAX_CLOTH_POINTS = 4096;
export const MAX_PINS = 64;
/** Defaults of the named arguments (design 2.4). */
export const CLOTH_DEFAULTS = Object.freeze({ mass: 1, stretch: 1, bend: 0.1, damping: 0.02, thickness: 0.02, friction: 0.4 });
/** A cloth whose points all move under 1 mm/s for 0.5 s sleeps (design 9.5). */
const SLEEP_SPEED = 0.001;
const SLEEP_TIME = 0.5;
const BLOW_UP = 1e6;
/** Air density, kg/m³, and the skin drag of air along a face, as a part of its push through it. */
const AIR = 1.2;
const SKIN = 0.1;
/** The width of a thread in the plane that the air pushes on, m (a rope or a net seen from the side). */
const THREAD_WIDTH = 0.05;
/** How fast stretch and bend stiffness rise with `stretch` and `bend`: rad/s of a point between two links. */
const STRETCH_OMEGA = 400;
const BEND_OMEGA = 200;
/** The grab's pull per small step: part of the way to the pointer (a stiff spring, as for bodies). */
const GRAB_PULL = 0.35;
const MAX_GRABS = 8;

export type ClothKind = 'sheet' | 'rope' | 'net';

/** The drops as the cloth meets them (the liquid's particle store). */
export interface DropsView {
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly x0: Float64Array;
  readonly y0: Float64Array;
  readonly z0: Float64Array;
  readonly owner: Int32Array;
}
export const LinkKind = { stretch: 0, shear: 1, bend: 2 } as const;

/** A pin: a point held still (body −1) or held to a body, at a point of the body's own frame. */
export interface PinDef {
  readonly point: number;
  readonly body: number;
}

/** What one cloth is made of. Points are row by row: index j × nu + i, i along u (or along the rope). */
export interface ClothDef {
  readonly kind: ClothKind;
  readonly nu: number;
  readonly nv: number;
  /** Start places, x y z for each point (z is 0 in the plane). */
  readonly pos: Float64Array;
  readonly mass: number;
  readonly stretch: number;
  readonly bend: number;
  readonly damping: number;
  /** A link breaks past this many times its length; 0: never. */
  readonly tears: number;
  readonly self: boolean;
  readonly thickness: number;
  readonly friction: number;
  readonly pins: readonly PinDef[];
}

/** One cloth's place in the shared arrays and its state. */
export interface ClothInfo {
  readonly def: ClothDef;
  readonly p0: number;
  readonly n: number;
  readonly l0: number;
  readonly ln: number;
  readonly t0: number;
  readonly tn: number;
  readonly pin0: number;
  readonly pinN: number;
  readonly te0: number;
  readonly teN: number;
  /** A rope's first entry in the chain table. */
  readonly ch0: number;
  readonly mPt: number;
  asleep: boolean;
  sleepTime: number;
  torn: number;
  unstable: boolean;
  /** Wind seen when it fell asleep: a change wakes it. */
  windX: number;
  windY: number;
  windZ: number;
}

export class ClothSet {
  readonly dim: 2 | 3;
  readonly cloths: ClothInfo[] = [];
  /** Points: place, place at the start of the small step, place at the start of the world step, speed, inverse mass. */
  n = 0;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  px: Float64Array;
  py: Float64Array;
  pz: Float64Array;
  sx: Float64Array;
  sy: Float64Array;
  sz: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  vz: Float64Array;
  w: Float64Array;
  /** The inverse mass of each point when free (a pinned point has w = 0 or its body's). */
  w0: Float64Array;
  owner: Int32Array;
  /** Links: ends, length, compliance, kind, broken. In solve order. */
  la: Int32Array;
  lb: Int32Array;
  rest: Float64Array;
  alpha: Float64Array;
  kind: Uint8Array;
  broken: Uint8Array;
  /** The link's id (row order in its cloth), for tearing in id order and for checkpoints. */
  lid: Int32Array;
  /** Triangles (in the plane, segments: tc = −1) and the stretch links on their sides (−1 when none). */
  ta: Int32Array;
  tb: Int32Array;
  tc: Int32Array;
  te: Int32Array;
  /** Pins: point, body (−1 the world), where it is held (the world) or the point in the body's frame. */
  pinPoint: Int32Array;
  pinBody: Int32Array;
  pinX: Float64Array;
  pinY: Float64Array;
  pinZ: Float64Array;
  /** The force each pin carried in the last step (N), averaged over the small steps. */
  pinFx: Float64Array;
  pinFy: Float64Array;
  pinFz: Float64Array;
  /** The pin each point is held by, or −1. */
  pinOf: Int32Array;
  /** Tethers: point, pin, length. */
  tePoint: Int32Array;
  tePin: Int32Array;
  teRest: Float64Array;
  gx = 0;
  gy = 0;
  gz = -9.8;
  windX = 0;
  windY = 0;
  windZ = 0;
  /** Pushes owed to bodies (applied at the start of the next step), their turning parts and the moves. */
  bjx = new Float64Array(0);
  bjy = new Float64Array(0);
  bjz = new Float64Array(0);
  btx = new Float64Array(0);
  bty = new Float64Array(0);
  btz = new Float64Array(0);
  /** The moves bodies made in this step's small steps: tests see the body there. */
  bdx = new Float64Array(0);
  bdy = new Float64Array(0);
  bdz = new Float64Array(0);
  /** The push given at the start of this step, for the force count. */
  applied = new Float64Array(0);
  /** Which bodies each cloth touched in the last step (a mark per cloth and body). */
  touched = new Uint8Array(0);
  /** Grabbed points and where the pointer is (at most MAX_GRABS at once). */
  nGrab = 0;
  readonly grabI = new Int32Array(MAX_GRABS);
  readonly grabX = new Float64Array(MAX_GRABS);
  readonly grabY = new Float64Array(MAX_GRABS);
  readonly grabZ = new Float64Array(MAX_GRABS);
  /** How far a point may move in this step (its speed, the grabs), for the searches of `prepare`. */
  protected pad = 0;
  /** Links that tore in the last step, per cloth. */
  tornNow: Int32Array;
  steps = 0;
  readonly grid = new NeighbourGrid3();
  /** Scratch for the drops' pass. */
  protected scratch = new Float64Array(16);

  constructor(defs: readonly ClothDef[], dim: 2 | 3) {
    this.dim = dim;
    let np = 0;
    let nl = 0;
    let nt = 0;
    let npin = 0;
    let nte = 0;
    for (const d of defs) {
      const n = d.nu * d.nv;
      np += n;
      nl += countLinks(d);
      nt += dim === 2 ? d.nv * (d.nu - 1) + d.nu * (d.nv - 1) : 2 * (d.nu - 1) * (d.nv - 1);
      npin += d.pins.length;
      if (d.tears === 0 && d.pins.length > 0) nte += n * Math.min(2, d.pins.length);
    }
    const F = (k: number): Float64Array => new Float64Array(k);
    const I = (k: number): Int32Array => new Int32Array(k);
    this.x = F(np);
    this.y = F(np);
    this.z = F(np);
    this.px = F(np);
    this.py = F(np);
    this.pz = F(np);
    this.sx = F(np);
    this.sy = F(np);
    this.sz = F(np);
    this.vx = F(np);
    this.vy = F(np);
    this.vz = F(np);
    this.w = F(np);
    this.w0 = F(np);
    this.owner = I(np);
    this.pinOf = I(np).fill(-1);
    this.la = I(nl);
    this.lb = I(nl);
    this.rest = F(nl);
    this.alpha = F(nl);
    this.kind = new Uint8Array(nl);
    this.broken = new Uint8Array(nl);
    this.lid = I(nl);
    this.ta = I(nt);
    this.tb = I(nt);
    this.tc = I(nt);
    this.te = I(nt * 3).fill(-1);
    this.pinPoint = I(npin);
    this.pinBody = I(npin);
    this.pinX = F(npin);
    this.pinY = F(npin);
    this.pinZ = F(npin);
    this.pinFx = F(npin);
    this.pinFy = F(npin);
    this.pinFz = F(npin);
    this.tePoint = I(nte);
    this.tePin = I(nte);
    this.teRest = F(nte);
    this.tornNow = I(defs.length);
    let p = 0;
    let l = 0;
    let t = 0;
    let pin = 0;
    let te = 0;
    defs.forEach((d, c) => {
      const n = d.nu * d.nv;
      const mPt = d.mass / n;
      const info: ClothInfo = {
        def: d, p0: p, n, l0: l, ln: 0, t0: t, tn: 0, pin0: pin, pinN: d.pins.length, te0: te, teN: 0, ch0: 0, mPt,
        asleep: false, sleepTime: 0, torn: 0, unstable: false, windX: 0, windY: 0, windZ: 0,
      };
      for (let k = 0; k < n; k++) {
        const i = p + k;
        this.x[i] = d.pos[k * 3] as number;
        this.y[i] = d.pos[k * 3 + 1] as number;
        this.z[i] = d.pos[k * 3 + 2] as number;
        this.w[i] = 1 / mPt;
        this.w0[i] = 1 / mPt;
        this.owner[i] = c;
      }
      l = this.buildLinks(d, p, l, mPt);
      (info as { ln: number }).ln = l - info.l0;
      t = this.buildTris(d, p, t, info.l0, l);
      (info as { tn: number }).tn = t - info.t0;
      for (const pd of d.pins) {
        const i = p + pd.point;
        this.pinPoint[pin] = i;
        this.pinBody[pin] = pd.body;
        this.pinX[pin] = this.x[i] as number;
        this.pinY[pin] = this.y[i] as number;
        this.pinZ[pin] = this.z[i] as number;
        this.pinOf[i] = pin;
        if (pd.body < 0) this.w[i] = 0;
        pin++;
      }
      if (d.tears === 0 && d.pins.length > 0) {
        // each free point keeps within reach of its two nearest pins (by the start distance)
        const slack = 1 + 2 * (1 - Math.min(1, Math.max(0, d.stretch)));
        for (let k = 0; k < n; k++) {
          const i = p + k;
          if (this.pinOf[i] !== -1 && this.pinBody[this.pinOf[i] as number] === -1) continue;
          let b1 = -1;
          let b2 = -1;
          let d1 = Infinity;
          let d2 = Infinity;
          for (let q = info.pin0; q < info.pin0 + info.pinN; q++) {
            const j = this.pinPoint[q] as number;
            if (j === i) continue;
            const dd = dist(this.x, this.y, this.z, i, j);
            if (dd < d1) {
              d2 = d1;
              b2 = b1;
              d1 = dd;
              b1 = q;
            } else if (dd < d2) {
              d2 = dd;
              b2 = q;
            }
          }
          for (const [q, dd] of [[b1, d1], [b2, d2]] as const) {
            if (q < 0) continue;
            this.tePoint[te] = i;
            this.tePin[te] = q;
            this.teRest[te] = dd * slack;
            te++;
          }
        }
      }
      (info as { teN: number }).teN = te - info.te0;
      this.cloths.push(info);
      p += n;
      pin += d.pins.length;
    });
    this.n = p;
    this.buildChains();
    this.px.set(this.x);
    this.py.set(this.y);
    this.pz.set(this.z);
    this.sx.set(this.x);
    this.sy.set(this.y);
    this.sz.set(this.z);
    let longest = 0;
    for (let k = 0; k < l; k++) if (this.kind[k] === LinkKind.stretch) longest = Math.max(longest, this.rest[k] as number);
    this.grid.setSize(Math.max(0.02, 1.5 * longest));
  }

  /** The chain table of every rope: its stretch links in order along it. */
  private buildChains(): void {
    let total = 0;
    let longest = 0;
    for (const c of this.cloths) {
      if (c.def.kind !== 'rope') continue;
      (c as { ch0: number }).ch0 = total;
      total += c.n - 1;
      longest = Math.max(longest, c.n);
    }
    this.chain = new Int32Array(total);
    for (const c of this.cloths) {
      if (c.def.kind !== 'rope') continue;
      for (let l = c.l0; l < c.l0 + c.ln; l++) {
        if (this.kind[l] !== LinkKind.stretch) continue;
        const a = Math.min(this.la[l] as number, this.lb[l] as number);
        this.chain[c.ch0 + a - c.p0] = l;
      }
    }
    const F = (): Float64Array<ArrayBuffer> => new Float64Array(longest);
    this.chNx = F();
    this.chNy = F();
    this.chNz = F();
    this.chD = F();
    this.chU = F();
    this.chR = F();
  }

  /** The links of a cloth, in the order they are solved: stretch red-black, then shear, then bend. */
  private buildLinks(d: ClothDef, p: number, l: number, mPt: number): number {
    const { nu, nv } = d;
    const s = Math.min(1, Math.max(0, d.stretch));
    const b = Math.min(1, Math.max(0, d.bend));
    const aS = s >= 1 ? 0 : (1 - s) / (Math.max(s, 0.01) * mPt * STRETCH_OMEGA * STRETCH_OMEGA);
    const aB = b >= 1 ? 0 : (1 - b) / (Math.max(b, 1e-3) * mPt * BEND_OMEGA * BEND_OMEGA);
    const at = (i: number, j: number): number => p + j * nu + i;
    let id = 0;
    const add = (a: number, c: number, kind: number, alpha: number): void => {
      this.la[l] = a;
      this.lb[l] = c;
      this.rest[l] = dist(this.x, this.y, this.z, a, c);
      this.alpha[l] = alpha;
      this.kind[l] = kind;
      this.lid[l] = id++;
      l++;
    };
    // stretch along u, even then odd; then along v, even then odd: no two links of one batch share a point
    for (let par = 0; par < 2; par++) for (let j = 0; j < nv; j++) for (let i = par; i + 1 < nu; i += 2) add(at(i, j), at(i + 1, j), LinkKind.stretch, aS);
    for (let par = 0; par < 2; par++) for (let j = par; j + 1 < nv; j += 2) for (let i = 0; i < nu; i++) add(at(i, j), at(i, j + 1), LinkKind.stretch, aS);
    if (nv > 1) {
      for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++) add(at(i, j), at(i + 1, j + 1), LinkKind.shear, aS);
      for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++) add(at(i + 1, j), at(i, j + 1), LinkKind.shear, aS);
    }
    if (b > 0) {
      for (let j = 0; j < nv; j++) for (let i = 0; i + 2 < nu; i++) add(at(i, j), at(i + 2, j), LinkKind.bend, aB);
      for (let j = 0; j + 2 < nv; j++) for (let i = 0; i < nu; i++) add(at(i, j), at(i, j + 2), LinkKind.bend, aB);
    }
    return l;
  }

  /** Triangles of a sheet (two a cell) or segments of a rope, with the stretch links on their sides. */
  private buildTris(d: ClothDef, p: number, t: number, l0: number, l1: number): number {
    const { nu, nv } = d;
    const linkOf = new Map<number, number>();
    for (let k = l0; k < l1; k++) {
      if (this.kind[k] === LinkKind.bend) continue;
      const a = this.la[k] as number;
      const b = this.lb[k] as number;
      linkOf.set(Math.min(a, b) * 8192 + Math.max(a, b), k);
    }
    const edge = (a: number, b: number): number => linkOf.get(Math.min(a, b) * 8192 + Math.max(a, b)) ?? -1;
    for (const [k, v] of linkOf) if (this.kind[v] === LinkKind.stretch) this.stretchAt.set(k, v);
    if (this.dim === 2) {
      // in the plane, the threads: every stretch link is a segment the air and the drops meet
      for (let k = l0; k < l1; k++) {
        if (this.kind[k] !== LinkKind.stretch) continue;
        this.ta[t] = this.la[k] as number;
        this.tb[t] = this.lb[k] as number;
        this.tc[t] = -1;
        this.te[t * 3] = k;
        t++;
      }
      return t;
    }
    for (let j = 0; j + 1 < nv; j++) {
      for (let i = 0; i + 1 < nu; i++) {
        const a = p + j * nu + i;
        const b = a + 1;
        const c = a + nu + 1;
        const e = a + nu;
        // two triangles a cell, split along the diagonal a–c
        this.ta[t] = a;
        this.tb[t] = b;
        this.tc[t] = c;
        this.te[t * 3] = edge(a, b);
        this.te[t * 3 + 1] = edge(b, c);
        this.te[t * 3 + 2] = edge(a, c);
        t++;
        this.ta[t] = a;
        this.tb[t] = c;
        this.tc[t] = e;
        this.te[t * 3] = edge(a, c);
        this.te[t * 3 + 1] = edge(c, e);
        this.te[t * 3 + 2] = edge(e, a);
        t++;
      }
    }
    return t;
  }

  /** True when the triangle (or segment) t has a torn side. */
  triTorn(t: number): boolean {
    for (let k = 0; k < 3; k++) {
      const e = this.te[t * 3 + k] as number;
      if (e >= 0 && this.broken[e] === 1) return true;
    }
    return false;
  }

  /** Makes room for pushes owed to `nb` bodies. */
  protected sizeBodies(nb: number): void {
    if (this.bjx.length === nb) return;
    const F = (): Float64Array<ArrayBuffer> => new Float64Array(nb);
    this.bjx = F();
    this.bjy = F();
    this.bjz = F();
    this.btx = F();
    this.bty = F();
    this.btz = F();
    this.bdx = F();
    this.bdy = F();
    this.bdz = F();
    this.applied = new Float64Array(nb * 3);
    this.touched = new Uint8Array(nb * Math.max(1, this.cloths.length));
  }

  /* ------------------------------ hooks for the world (in the plane or in space) ------------------------------ */

  /** Where a body pin holds its point now (the body at its pose plus what it moved this step), into `out`. */
  protected anchor(_pin: number, out: Float64Array): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }

  /** The inverse mass of body b felt at a point (its turn included), or 0 for a wall. */
  protected bodyW(_b: number, _x: number, _y: number, _z: number): number {
    return 0;
  }

  /** The body's speed at a point, into `out`. */
  protected bodyV(_b: number, _x: number, _y: number, _z: number, out: Float64Array): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }

  /** Before the small steps: which points may touch which shapes this step. */
  protected prepare(_h: number): void {}

  /** Pushes the points of awake cloths out of solids and bodies, with friction (one small step). */
  protected collide(_hs: number): void {}

  /** Is any body near cloth c awake and moving (it wakes the cloth)? */
  protected bodiesStir(_c: number): boolean {
    return false;
  }

  /** The air's speed at a point: the world's wind (in the plane, smoke's flow too), into `out`. */
  protected airAt(_x: number, _y: number, out: Float64Array): void {
    out[0] = this.windX;
    out[1] = this.windY;
    out[2] = this.windZ;
  }

  /**
   * A point and a body met (or a pin pulled): the point took Δλ along n, the body takes −Δλ n as a push J = −Δλ n / hs
   * at (x, y, z), and moves by its share now, so the next small steps see it there.
   */
  protected give(b: number, c: number, jx: number, jy: number, jz: number, x: number, y: number, z: number, hs: number): void {
    this.bjx[b] = (this.bjx[b] as number) + jx;
    this.bjy[b] = (this.bjy[b] as number) + jy;
    this.bjz[b] = (this.bjz[b] as number) + jz;
    const r = this.scratch;
    this.bodyArm(b, x, y, z, r);
    const rx = r[0] as number;
    const ry = r[1] as number;
    const rz = r[2] as number;
    this.btx[b] = (this.btx[b] as number) + ry * jz - rz * jy;
    this.bty[b] = (this.bty[b] as number) + rz * jx - rx * jz;
    this.btz[b] = (this.btz[b] as number) + rx * jy - ry * jx;
    const im = this.bodyInvMass(b);
    this.bdx[b] = (this.bdx[b] as number) + im * jx * hs;
    this.bdy[b] = (this.bdy[b] as number) + im * jy * hs;
    this.bdz[b] = (this.bdz[b] as number) + im * jz * hs;
    if (c >= 0) this.touched[c * this.bjx.length + b] = 1;
  }

  /** The arm from body b's centre to a point, into `out`. */
  protected bodyArm(_b: number, _x: number, _y: number, _z: number, out: Float64Array): void {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
  }

  protected bodyInvMass(_b: number): number {
    return 0;
  }

  /* ------------------------------ the step ------------------------------ */

  /** One world step of h: 4 small steps of the cloth against the bodies where they are now (design 9.5, 9.6). */
  stepCloth(h: number): void {
    this.steps++;
    this.bdx.fill(0);
    this.bdy.fill(0);
    this.bdz.fill(0);
    this.touched.fill(0);
    this.tornNow.fill(0);
    this.pinFx.fill(0);
    this.pinFy.fill(0);
    this.pinFz.fill(0);
    const n = this.n;
    this.sx.set(this.x.subarray(0, n));
    this.sy.set(this.y.subarray(0, n));
    this.sz.set(this.z.subarray(0, n));
    this.wakeCheck();
    let awake = false;
    for (let c = 0; c < this.cloths.length; c++) {
      const ci = this.cloths[c] as ClothInfo;
      if (!ci.asleep && !ci.unstable) awake = true;
    }
    if (!awake) return;
    // how far a point may go this step: its speed, and a grab's pull
    let v2 = 0;
    for (let i = 0; i < n; i++) {
      const a = this.vx[i] as number;
      const b = this.vy[i] as number;
      const d = this.vz[i] as number;
      const s2 = a * a + b * b + d * d;
      if (s2 > v2) v2 = s2;
    }
    this.pad = 1.5 * h * Math.sqrt(v2) + 9.8 * h * h + (this.nGrab > 0 ? 0.5 : 0);
    this.grid.build(this.x, this.y, this.z, n);
    this.prepare(h);
    this.prepareSelf();
    const hs = h / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) this.substep(hs);
    // the forces on the pins, averaged over the small steps
    const inv = 1 / (SUBSTEPS * hs * hs);
    for (let q = 0; q < this.pinFx.length; q++) {
      this.pinFx[q] = (this.pinFx[q] as number) * inv;
      this.pinFy[q] = (this.pinFy[q] as number) * inv;
      this.pinFz[q] = (this.pinFz[q] as number) * inv;
      if (q < this.dropPinX.length) {
        // drops resting on a pinned corner push on its pin
        this.pinFx[q] = (this.pinFx[q] as number) + (this.dropPinX[q] as number);
        this.pinFy[q] = (this.pinFy[q] as number) + (this.dropPinY[q] as number);
        this.pinFz[q] = (this.pinFz[q] as number) + (this.dropPinZ[q] as number);
      }
    }
    this.tear();
    this.settle(h);
  }

  private substep(hs: number): void {
    const { x, y, z, px, py, pz, vx, vy, vz, w } = this;
    const out = this.scratch;
    // 1. move by speed, gravity and the air
    for (const c of this.cloths) {
      if (c.asleep || c.unstable) continue;
      this.airForces(c, hs);
      const e = c.p0 + c.n;
      for (let i = c.p0; i < e; i++) {
        const xi = x[i] as number;
        const yi = y[i] as number;
        const zi = z[i] as number;
        px[i] = xi;
        py[i] = yi;
        pz[i] = zi;
        if (w[i] === 0) continue;
        const pin = this.pinOf[i] as number;
        if (pin >= 0) continue;
        const nvx = (vx[i] as number) + hs * this.gx;
        const nvy = (vy[i] as number) + hs * this.gy;
        const nvz = (vz[i] as number) + hs * this.gz;
        vx[i] = nvx;
        vy[i] = nvy;
        vz[i] = nvz;
        x[i] = xi + hs * nvx;
        y[i] = yi + hs * nvy;
        z[i] = zi + hs * nvz;
      }
    }
    // the pins: a world pin holds its place, a body pin goes where the body is now
    for (let q = 0; q < this.pinPoint.length; q++) {
      const i = this.pinPoint[q] as number;
      const c = this.cloths[this.owner[i] as number] as ClothInfo;
      if (c.asleep || c.unstable) continue;
      if ((this.pinBody[q] as number) < 0) {
        x[i] = this.pinX[q] as number;
        y[i] = this.pinY[q] as number;
        z[i] = this.pinZ[q] as number;
      } else {
        this.anchor(q, out);
        x[i] = out[0] as number;
        y[i] = out[1] as number;
        z[i] = out[2] as number;
        // the point stands for the body in the links: it moves as the body would
        w[i] = this.bodyW(this.pinBody[q] as number, out[0] as number, out[1] as number, out[2] as number);
      }
    }
    // grabbed points are pulled toward the pointer
    for (let g = 0; g < this.nGrab; g++) {
      const i = this.grabI[g] as number;
      if ((w[i] as number) === 0) continue;
      x[i] = (x[i] as number) + ((this.grabX[g] as number) - (x[i] as number)) * GRAB_PULL;
      y[i] = (y[i] as number) + ((this.grabY[g] as number) - (y[i] as number)) * GRAB_PULL;
      z[i] = (z[i] as number) + ((this.grabZ[g] as number) - (z[i] as number)) * GRAB_PULL;
    }
    // 2. the links, once each, in order
    const inv2 = 1 / (hs * hs);
    for (const c of this.cloths) {
      if (c.asleep || c.unstable) continue;
      if (c.def.kind === 'rope') {
        // a rope's stretch links are one chain: solved together along it, then its bend links once each
        this.solveChain(c, inv2);
        this.solveLinks(c.l0 + c.n - 1, c.l0 + c.ln, inv2);
      } else this.solveLinks(c.l0, c.l0 + c.ln, inv2);
      this.solveTethers(c.te0, c.te0 + c.teN);
    }
    // 3. body pins: what the point moved, the body moves (a push now, a move at the next step)
    for (let q = 0; q < this.pinPoint.length; q++) {
      const b = this.pinBody[q] as number;
      if (b < 0) continue;
      const i = this.pinPoint[q] as number;
      const c = this.owner[i] as number;
      const ci = this.cloths[c] as ClothInfo;
      if (ci.asleep || ci.unstable) continue;
      this.anchor(q, out);
      const dx = (x[i] as number) - (out[0] as number);
      const dy = (y[i] as number) - (out[1] as number);
      const dz = (z[i] as number) - (out[2] as number);
      const wb = w[i] as number;
      if (wb > 0 && (dx !== 0 || dy !== 0 || dz !== 0)) {
        // Δx = w Δλ: the body's push is Δλ / hs = Δx / (w hs)
        const k = 1 / (wb * hs);
        this.give(b, c, dx * k, dy * k, dz * k, out[0] as number, out[1] as number, out[2] as number, hs);
        this.pinFx[q] = (this.pinFx[q] as number) + dx / wb;
        this.pinFy[q] = (this.pinFy[q] as number) + dy / wb;
        this.pinFz[q] = (this.pinFz[q] as number) + dz / wb;
      }
      this.anchor(q, out);
      x[i] = out[0] as number;
      y[i] = out[1] as number;
      z[i] = out[2] as number;
      w[i] = 0;
    }
    // 4. solids and bodies, then the cloth against itself and other cloths
    this.collide(hs);
    if (this.nSelf > 0) this.solveSelf();
    // 5. speeds from the moves, less damping
    for (const c of this.cloths) {
      if (c.asleep || c.unstable) continue;
      const keep = 1 / (1 + Math.min(1, Math.max(0, c.def.damping)) * hs);
      const e = c.p0 + c.n;
      const ih = 1 / hs;
      for (let i = c.p0; i < e; i++) {
        vx[i] = ((x[i] as number) - (px[i] as number)) * ih * keep;
        vy[i] = ((y[i] as number) - (py[i] as number)) * ih * keep;
        vz[i] = ((z[i] as number) - (pz[i] as number)) * ih * keep;
      }
    }
  }

  /**
   * A rope's stretch links in one pass along the whole rope: the links' equations, made linear about the places now,
   * form a three-band system (each link shares a point with the one before and the one after), solved exactly in linear
   * time. One pass then reaches from one end to the other, so a rope of 400 points holds its length as a short one does
   * and carries a body a hundred times heavier than itself (a pass link by link needs hundreds of passes for both).
   */
  private solveChain(c: ClothInfo, inv2: number): void {
    const { x, y, z, w, rest, alpha, broken } = this;
    const m = c.n - 1;
    const ch = this.chain;
    const nx = this.chNx;
    const ny = this.chNy;
    const nz = this.chNz;
    const dg = this.chD;
    const up = this.chU;
    const rhs = this.chR;
    const p0 = c.p0;
    for (let k = 0; k < m; k++) {
      const l = ch[c.ch0 + k] as number;
      const a = p0 + k;
      const b = a + 1;
      const dx = (x[b] as number) - (x[a] as number);
      const dy = (y[b] as number) - (y[a] as number);
      const dz = (z[b] as number) - (z[a] as number);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ws = (w[a] as number) + (w[b] as number);
      if (broken[l] === 1 || !(d > 1e-12) || ws === 0) {
        // a torn (or unmovable) link: its row stands alone and moves nothing
        nx[k] = 0;
        ny[k] = 0;
        nz[k] = 0;
        dg[k] = 1;
        rhs[k] = 0;
        continue;
      }
      nx[k] = dx / d;
      ny[k] = dy / d;
      nz[k] = dz / d;
      dg[k] = ws + (alpha[l] as number) * inv2;
      rhs[k] = (rest[l] as number) - d;
    }
    // the band beside the diagonal: links k and k + 1 share point k + 1
    for (let k = 0; k + 1 < m; k++) {
      const wb = w[p0 + k + 1] as number;
      up[k] = -wb * ((nx[k] as number) * (nx[k + 1] as number) + (ny[k] as number) * (ny[k + 1] as number) + (nz[k] as number) * (nz[k + 1] as number));
    }
    // forward sweep, then back (the Thomas method); the system is symmetric and diagonally dominant
    for (let k = 1; k < m; k++) {
      const f = (up[k - 1] as number) / (dg[k - 1] as number);
      dg[k] = (dg[k] as number) - f * (up[k - 1] as number);
      rhs[k] = (rhs[k] as number) - f * (rhs[k - 1] as number);
    }
    rhs[m - 1] = (rhs[m - 1] as number) / (dg[m - 1] as number);
    for (let k = m - 2; k >= 0; k--) rhs[k] = ((rhs[k] as number) - (up[k] as number) * (rhs[k + 1] as number)) / (dg[k] as number);
    // each point moves by its links' Δλ along their directions: Δx_k = w_k (n_{k−1} Δλ_{k−1} − n_k Δλ_k)
    for (let k = 0; k <= m; k++) {
      const i = p0 + k;
      const lb = k > 0 ? (rhs[k - 1] as number) : 0;
      const la = k < m ? (rhs[k] as number) : 0;
      const ex = (k > 0 ? (nx[k - 1] as number) * lb : 0) - (k < m ? (nx[k] as number) * la : 0);
      const ey = (k > 0 ? (ny[k - 1] as number) * lb : 0) - (k < m ? (ny[k] as number) * la : 0);
      const ez = (k > 0 ? (nz[k - 1] as number) * lb : 0) - (k < m ? (nz[k] as number) * la : 0);
      const wi = w[i] as number;
      if (wi > 0) {
        x[i] = (x[i] as number) + wi * ex;
        y[i] = (y[i] as number) + wi * ey;
        z[i] = (z[i] as number) + wi * ez;
      } else this.pinForce(i, ex, ey, ez);
    }
  }

  /** Each rope's stretch links by place along it (segment k joins points k and k + 1), and the chain solve's scratch. */
  private chain = new Int32Array(0);
  private chNx = new Float64Array(0);
  private chNy = new Float64Array(0);
  private chNz = new Float64Array(0);
  private chD = new Float64Array(0);
  private chU = new Float64Array(0);
  private chR = new Float64Array(0);

  /** One pass over links [l0, l1): XPBD with the multiplier started at 0 each small step. */
  private solveLinks(l0: number, l1: number, inv2: number): void {
    const { x, y, z, w, la, lb, rest, alpha, broken } = this;
    for (let k = l0; k < l1; k++) {
      if (broken[k] === 1) continue;
      const a = la[k] as number;
      const b = lb[k] as number;
      const wa = w[a] as number;
      const wb = w[b] as number;
      const ws = wa + wb;
      if (ws === 0) continue;
      const dx = (x[a] as number) - (x[b] as number);
      const dy = (y[a] as number) - (y[b] as number);
      const dz = (z[a] as number) - (z[b] as number);
      const d2 = dx * dx + dy * dy + dz * dz;
      if (!(d2 > 1e-24)) continue;
      const d = Math.sqrt(d2);
      const C = d - (rest[k] as number);
      const dl = -C / (ws + (alpha[k] as number) * inv2);
      const s = dl / d;
      const ex = dx * s;
      const ey = dy * s;
      const ez = dz * s;
      if (wa > 0) {
        x[a] = (x[a] as number) + wa * ex;
        y[a] = (y[a] as number) + wa * ey;
        z[a] = (z[a] as number) + wa * ez;
      } else this.pinForce(a, ex, ey, ez);
      if (wb > 0) {
        x[b] = (x[b] as number) - wb * ex;
        y[b] = (y[b] as number) - wb * ey;
        z[b] = (z[b] as number) - wb * ez;
      } else this.pinForce(b, -ex, -ey, -ez);
    }
  }

  /** The pull Δλ ∇C on a point held by a world pin, added up (a force once over hs²). */
  private pinForce(i: number, ex: number, ey: number, ez: number): void {
    const q = this.pinOf[i] as number;
    if (q < 0) return;
    this.pinFx[q] = (this.pinFx[q] as number) + ex;
    this.pinFy[q] = (this.pinFy[q] as number) + ey;
    this.pinFz[q] = (this.pinFz[q] as number) + ez;
  }

  /** Each point keeps within its tether of its pins: a one-way limit that moves only the point. */
  private solveTethers(t0: number, t1: number): void {
    const { x, y, z, w } = this;
    for (let k = t0; k < t1; k++) {
      const i = this.tePoint[k] as number;
      const wi = w[i] as number;
      if (wi === 0) continue;
      const q = this.tePin[k] as number;
      const j = this.pinPoint[q] as number;
      const dx = (x[i] as number) - (x[j] as number);
      const dy = (y[i] as number) - (y[j] as number);
      const dz = (z[i] as number) - (z[j] as number);
      const d2 = dx * dx + dy * dy + dz * dz;
      const L = this.teRest[k] as number;
      if (d2 <= L * L) continue;
      const d = Math.sqrt(d2);
      const wj = w[j] as number;
      // the far end moves, and a body pin's point too, as it stands for its body
      const f = (d - L) / (d * (wi + wj));
      x[i] = (x[i] as number) - wi * f * dx;
      y[i] = (y[i] as number) - wi * f * dy;
      z[i] = (z[i] as number) - wi * f * dz;
      if (wj > 0) {
        x[j] = (x[j] as number) + wj * f * dx;
        y[j] = (y[j] as number) + wj * f * dy;
        z[j] = (z[j] as number) + wj * f * dz;
      } else {
        this.pinFx[q] = (this.pinFx[q] as number) + f * dx;
        this.pinFy[q] = (this.pinFy[q] as number) + f * dy;
        this.pinFz[q] = (this.pinFz[q] as number) + f * dz;
      }
    }
  }

  /**
   * The air on each face (in the plane, each thread): a push along its normal from how fast the air goes through it,
   * ½ ρ A (u·n)|u·n|, plus a little skin drag along it, shared by its corners. u is the air's speed less the face's.
   */
  private airForces(c: ClothInfo, hs: number): void {
    const { x, y, z, vx, vy, vz, w, ta, tb, tc } = this;
    const air = this.scratch;
    const t1 = c.t0 + c.tn;
    const calm = this.windX === 0 && this.windY === 0 && this.windZ === 0 && !this.hasFlow();
    if (calm && !this.stillAir) return;
    for (let t = c.t0; t < t1; t++) {
      if (this.triTorn(t)) continue;
      const a = ta[t] as number;
      const b = tb[t] as number;
      const e = tc[t] as number;
      let nx: number;
      let ny: number;
      let nz: number;
      let ux: number;
      let uy: number;
      let uz: number;
      let share: number;
      if (e < 0) {
        // a thread in the plane: its normal in the plane, as long as it is, as wide as a thread
        const dx = (x[b] as number) - (x[a] as number);
        const dy = (y[b] as number) - (y[a] as number);
        nx = -dy * THREAD_WIDTH;
        ny = dx * THREAD_WIDTH;
        nz = 0;
        this.airAt(0.5 * ((x[a] as number) + (x[b] as number)), 0.5 * ((y[a] as number) + (y[b] as number)), air);
        ux = (air[0] as number) - 0.5 * ((vx[a] as number) + (vx[b] as number));
        uy = (air[1] as number) - 0.5 * ((vy[a] as number) + (vy[b] as number));
        uz = 0;
        share = 0.5;
      } else {
        const abx = (x[b] as number) - (x[a] as number);
        const aby = (y[b] as number) - (y[a] as number);
        const abz = (z[b] as number) - (z[a] as number);
        const acx = (x[e] as number) - (x[a] as number);
        const acy = (y[e] as number) - (y[a] as number);
        const acz = (z[e] as number) - (z[a] as number);
        // twice the area, along the normal
        nx = 0.5 * (aby * acz - abz * acy);
        ny = 0.5 * (abz * acx - abx * acz);
        nz = 0.5 * (abx * acy - aby * acx);
        this.airAt((x[a] as number), (y[a] as number), air);
        ux = (air[0] as number) - ((vx[a] as number) + (vx[b] as number) + (vx[e] as number)) / 3;
        uy = (air[1] as number) - ((vy[a] as number) + (vy[b] as number) + (vy[e] as number)) / 3;
        uz = (air[2] as number) - ((vz[a] as number) + (vz[b] as number) + (vz[e] as number)) / 3;
        share = 1 / 3;
      }
      // N = A n̂: the push is ½ ρ (u·N)|u·N| N / |N|³ × |N|² ... = ½ ρ (u·N)|u·N| / |N|² × N
      const A2 = nx * nx + ny * ny + nz * nz;
      if (!(A2 > 1e-20)) continue;
      const un = ux * nx + uy * ny + uz * nz;
      const k = (0.5 * AIR * un * Math.abs(un)) / A2;
      let fx = k * nx;
      let fy = k * ny;
      let fz = k * nz;
      // skin drag along the face: ½ ρ SKIN A |u_t| u_t
      const A = Math.sqrt(A2);
      const s = un / A2;
      const tx = ux - s * nx;
      const ty = uy - s * ny;
      const tz = uz - s * nz;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const ks = 0.5 * AIR * SKIN * A * tl;
      fx += ks * tx;
      fy += ks * ty;
      fz += ks * tz;
      fx *= share * hs;
      fy *= share * hs;
      fz *= share * hs;
      for (let k = 0; k < 3; k++) {
        const i = k === 0 ? a : k === 1 ? b : e;
        if (i < 0) continue;
        const wi = w[i] as number;
        if (wi === 0 || (this.pinOf[i] as number) >= 0) continue;
        vx[i] = (vx[i] as number) + wi * fx;
        vy[i] = (vy[i] as number) + wi * fy;
        vz[i] = (vz[i] as number) + wi * fz;
      }
    }
  }

  /* ------------------------------ the cloth against itself and other cloths (design 9.6) ------------------------------ */

  /** Point and face pairs that may meet this step (found once a step on the grid), and the side each point was on. */
  protected nSelf = 0;
  private selfP = new Int32Array(0);
  private selfT = new Int32Array(0);
  private selfS = new Float64Array(0);
  private selfH = new Float64Array(0);

  private pushSelf(i: number, t: number, side: number, th: number): void {
    if (this.nSelf >= this.selfP.length) {
      const cap = Math.max(256, this.selfP.length * 2);
      const P = new Int32Array(cap);
      P.set(this.selfP);
      const T = new Int32Array(cap);
      T.set(this.selfT);
      const S = new Float64Array(cap);
      S.set(this.selfS);
      const Th = new Float64Array(cap);
      Th.set(this.selfH);
      this.selfP = P;
      this.selfT = T;
      this.selfS = S;
      this.selfH = Th;
    }
    this.selfP[this.nSelf] = i;
    this.selfT[this.nSelf] = t;
    this.selfS[this.nSelf] = side;
    this.selfH[this.nSelf] = th;
    this.nSelf++;
  }

  /** Is point i one of face t's corners, or (same cloth) beside them on the grid, so it never counts as a hit? */
  private nearOwn(i: number, t: number, c: ClothInfo): boolean {
    const a = this.ta[t] as number;
    const b = this.tb[t] as number;
    const e = this.tc[t] as number;
    if (i === a || i === b || i === e) return true;
    if ((this.owner[i] as number) !== (this.owner[a] as number)) return false;
    const nu = c.def.nu;
    const pi = (i - c.p0) % nu;
    const pj = Math.floor((i - c.p0) / nu);
    const lo = Math.min(a, b, e < 0 ? a : e) - c.p0;
    const hi = Math.max(a, b, e) - c.p0;
    const i0 = Math.min(lo % nu, hi % nu);
    const i1 = Math.max(lo % nu, hi % nu);
    const j0 = Math.floor(lo / nu);
    const j1 = Math.floor(hi / nu);
    return pi >= i0 - 1 && pi <= i1 + 1 && pj >= j0 - 1 && pj <= j1 + 1;
  }

  /** The point and face pairs of this step: self hits on a cloth with `self`, and every pair of different cloths. */
  private prepareSelf(): void {
    this.nSelf = 0;
    const count = this.cloths.length;
    let any = false;
    for (let c = 0; c < count; c++) if ((this.cloths[c] as ClothInfo).def.self) any = true;
    if (!any && count < 2) return;
    const { x, y, z, sx, sy, sz } = this;
    const found = this.grid.found;
    for (let c = 0; c < count; c++) {
      const A = this.cloths[c] as ClothInfo;
      if (A.unstable) continue;
      const t1 = A.t0 + A.tn;
      const reach = A.def.thickness + this.pad + 0.05;
      for (let t = A.t0; t < t1; t++) {
        if (this.triTorn(t)) continue;
        const a = this.ta[t] as number;
        const b = this.tb[t] as number;
        const e = this.tc[t] as number;
        const ee = e < 0 ? b : e;
        const m = this.grid.inBox(
          Math.min(x[a] as number, x[b] as number, x[ee] as number) - reach, Math.min(y[a] as number, y[b] as number, y[ee] as number) - reach, Math.min(z[a] as number, z[b] as number, z[ee] as number) - reach,
          Math.max(x[a] as number, x[b] as number, x[ee] as number) + reach, Math.max(y[a] as number, y[b] as number, y[ee] as number) + reach, Math.max(z[a] as number, z[b] as number, z[ee] as number) + reach,
          this.n,
        );
        for (let q = 0; q < m; q++) {
          const i = found[q] as number;
          const oc = this.owner[i] as number;
          if (oc === c && !A.def.self) continue;
          const B = this.cloths[oc] as ClothInfo;
          if ((A.asleep && B.asleep) || B.unstable) continue;
          if (oc === c && this.nearOwn(i, t, A)) continue;
          if ((this.w[i] as number) === 0 && (this.w[a] as number) === 0 && (this.w[b] as number) === 0 && (e < 0 || (this.w[e] as number) === 0)) continue;
          const th = 0.5 * (A.def.thickness + B.def.thickness);
          // the side of the face the point was on at the start of the step
          const s0 = this.faceHeight(t, sx[i] as number, sy[i] as number, sz[i] as number, sx, sy, sz);
          if (Math.abs(s0) > th + 2 * this.pad + 0.05) continue;
          this.pushSelf(i, t, s0 >= 0 ? 1 : -1, th);
        }
      }
    }
  }

  /** Face t's unit normal (a segment's, in the plane) into scratch 0..2, and the height of a point over it. */
  protected faceHeight(t: number, px: number, py: number, pz: number, X: Float64Array, Y: Float64Array, Z: Float64Array): number {
    const a = this.ta[t] as number;
    const b = this.tb[t] as number;
    const e = this.tc[t] as number;
    const o = this.scratch;
    const ax = X[a] as number;
    const ay = Y[a] as number;
    const az = Z[a] as number;
    let nx: number;
    let ny: number;
    let nz: number;
    if (e < 0) {
      nx = -((Y[b] as number) - ay);
      ny = (X[b] as number) - ax;
      nz = 0;
    } else {
      const ux = (X[b] as number) - ax;
      const uy = (Y[b] as number) - ay;
      const uz = (Z[b] as number) - az;
      const vx = (X[e] as number) - ax;
      const vy = (Y[e] as number) - ay;
      const vz = (Z[e] as number) - az;
      nx = uy * vz - uz * vy;
      ny = uz * vx - ux * vz;
      nz = ux * vy - uy * vx;
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(l > 1e-18)) {
      o[0] = 0;
      o[1] = 0;
      o[2] = 0;
      return 0;
    }
    o[0] = nx / l;
    o[1] = ny / l;
    o[2] = nz / l;
    return (o[0] as number) * (px - ax) + (o[1] as number) * (py - ay) + (o[2] as number) * (pz - az);
  }

  /** The corners' weights of a point on face t's plane (into scratch 3..5), true when it is on the face. */
  protected footOn(t: number, px: number, py: number, pz: number, margin: number): boolean {
    const { x, y, z } = this;
    const o = this.scratch;
    const a = this.ta[t] as number;
    const b = this.tb[t] as number;
    const e = this.tc[t] as number;
    const qx = px - (x[a] as number);
    const qy = py - (y[a] as number);
    const qz = pz - (z[a] as number);
    const ux = (x[b] as number) - (x[a] as number);
    const uy = (y[b] as number) - (y[a] as number);
    const uz = (z[b] as number) - (z[a] as number);
    if (e < 0) {
      const l2 = ux * ux + uy * uy + uz * uz;
      if (!(l2 > 0)) return false;
      const f = (qx * ux + qy * uy + qz * uz) / l2;
      o[3] = 1 - f;
      o[4] = f;
      o[5] = 0;
      return f >= -margin && f <= 1 + margin;
    }
    const vx = (x[e] as number) - (x[a] as number);
    const vy = (y[e] as number) - (y[a] as number);
    const vz = (z[e] as number) - (z[a] as number);
    const d00 = ux * ux + uy * uy + uz * uz;
    const d01 = ux * vx + uy * vy + uz * vz;
    const d11 = vx * vx + vy * vy + vz * vz;
    const d20 = qx * ux + qy * uy + qz * uz;
    const d21 = qx * vx + qy * vy + qz * vz;
    const den = d00 * d11 - d01 * d01;
    if (!(den > 0)) return false;
    const fb = (d11 * d20 - d01 * d21) / den;
    const fe = (d00 * d21 - d01 * d20) / den;
    o[3] = 1 - fb - fe;
    o[4] = fb;
    o[5] = fe;
    return fb >= -margin && fe >= -margin && fb + fe <= 1 + margin;
  }

  /**
   * Each point keeps `thickness` from the faces near it, on the side it started the step on, so a falling sheet folds
   * over itself instead of passing through: the point and the face's corners move apart by their masses.
   */
  private solveSelf(): void {
    const { x, y, z, w } = this;
    const o = this.scratch;
    for (let k = 0; k < this.nSelf; k++) {
      const i = this.selfP[k] as number;
      const t = this.selfT[k] as number;
      const side = this.selfS[k] as number;
      const th = this.selfH[k] as number;
      const s = this.faceHeight(t, x[i] as number, y[i] as number, z[i] as number, x, y, z);
      const nx = o[0] as number;
      const ny = o[1] as number;
      const nz = o[2] as number;
      if (nx === 0 && ny === 0 && nz === 0) continue;
      const C = th - s * side;
      if (!(C > 0)) continue;
      // the foot of the point must be on the face (a neighbouring face takes it otherwise)
      if (!this.footOn(t, (x[i] as number) - s * nx, (y[i] as number) - s * ny, (z[i] as number) - s * nz, 1e-9)) continue;
      const a = this.ta[t] as number;
      const b = this.tb[t] as number;
      const e = this.tc[t] as number;
      const ba = o[3] as number;
      const bb = o[4] as number;
      const be = o[5] as number;
      const wi = w[i] as number;
      const W = wi + ba * ba * (w[a] as number) + bb * bb * (w[b] as number) + (e >= 0 ? be * be * (w[e] as number) : 0);
      if (!(W > 0)) continue;
      const dl = (C / W) * side;
      if (wi > 0) {
        x[i] = (x[i] as number) + wi * dl * nx;
        y[i] = (y[i] as number) + wi * dl * ny;
        z[i] = (z[i] as number) + wi * dl * nz;
      }
      for (let q = 0; q < 3; q++) {
        const j = q === 0 ? a : q === 1 ? b : e;
        const bj = q === 0 ? ba : q === 1 ? bb : be;
        if (j < 0) continue;
        const wj = w[j] as number;
        if (wj === 0) continue;
        x[j] = (x[j] as number) - wj * bj * dl * nx;
        y[j] = (y[j] as number) - wj * bj * dl * ny;
        z[j] = (z[j] as number) - wj * bj * dl * nz;
      }
    }
  }

  /* ------------------------------ liquid drops against the cloth (design 9.6) ------------------------------ */

  /** Which cloths drops met in the last liquid step (it wakes them). */
  private wet = new Uint8Array(0);
  /** The pushes drops gave pinned corners in the last liquid step (N), counted in the pins' forces. */
  dropPinX = new Float64Array(0);
  dropPinY = new Float64Array(0);
  dropPinZ = new Float64Array(0);

  /**
   * Drops against the cloth's faces (in the plane, its threads), called by the liquid in its step after the drops met
   * the bodies. A drop that came within `r + thickness` of a face, or crossed it, goes back to the side it started the
   * step on; the drop and the face's corners move apart by their masses, the cloth's share as a change of speed (it moves
   * in its own step next), so a sheet holds water and the water weighs it down. `box` finds the drops near a box on the
   * liquid's grid; `found` is that grid's list.
   */
  meetDrops(ps: DropsView, box: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => number, found: () => Int32Array, r: number, spacing: number, mass: Float64Array, h: number): void {
    if (this.wet.length !== this.cloths.length) this.wet = new Uint8Array(this.cloths.length);
    this.wet.fill(0);
    if (this.dropPinX.length !== this.pinPoint.length) {
      this.dropPinX = new Float64Array(this.pinPoint.length);
      this.dropPinY = new Float64Array(this.pinPoint.length);
      this.dropPinZ = new Float64Array(this.pinPoint.length);
    }
    this.dropPinX.fill(0);
    this.dropPinY.fill(0);
    this.dropPinZ.fill(0);
    const { x, y, z, vx, vy, vz, w } = this;
    const o = this.scratch;
    const inv = 1 / h;
    for (let c = 0; c < this.cloths.length; c++) {
      const ci = this.cloths[c] as ClothInfo;
      if (ci.unstable) continue;
      const reach = r + ci.def.thickness;
      const pad = reach + 2 * spacing;
      const t1 = ci.t0 + ci.tn;
      for (let t = ci.t0; t < t1; t++) {
        if (this.triTorn(t)) continue;
        const a = this.ta[t] as number;
        const b = this.tb[t] as number;
        const e = this.tc[t] as number;
        const ee = e < 0 ? b : e;
        const m = box(
          Math.min(x[a] as number, x[b] as number, x[ee] as number) - pad, Math.min(y[a] as number, y[b] as number, y[ee] as number) - pad, Math.min(z[a] as number, z[b] as number, z[ee] as number) - pad,
          Math.max(x[a] as number, x[b] as number, x[ee] as number) + pad, Math.max(y[a] as number, y[b] as number, y[ee] as number) + pad, Math.max(z[a] as number, z[b] as number, z[ee] as number) + pad,
        );
        if (m === 0) continue;
        const list = found();
        for (let q = 0; q < m; q++) {
          const d = list[q] as number;
          const dx = ps.x[d] as number;
          const dy = ps.y[d] as number;
          const dz = ps.z[d] as number;
          const s1 = this.faceHeight(t, dx, dy, dz, x, y, z);
          const nx = o[0] as number;
          const ny = o[1] as number;
          const nz = o[2] as number;
          if (nx === 0 && ny === 0 && nz === 0) continue;
          const s0 = nx * ((ps.x0[d] as number) - (x[a] as number)) + ny * ((ps.y0[d] as number) - (y[a] as number)) + nz * ((ps.z0[d] as number) - (z[a] as number));
          const crossed = s0 * s1 < 0;
          const side = s0 >= 0 ? 1 : -1;
          const C = reach - s1 * side;
          if (!(C > 0)) continue;
          // a drop under the face by more than its reach that did not cross it belongs to the other side
          if (!crossed && s1 * side < 0) continue;
          // the foot of the drop on the face: where its path crossed it, or straight below it
          let fx: number;
          let fy: number;
          let fz: number;
          if (crossed) {
            const f = s0 / (s0 - s1);
            fx = (ps.x0[d] as number) + f * (dx - (ps.x0[d] as number));
            fy = (ps.y0[d] as number) + f * (dy - (ps.y0[d] as number));
            fz = (ps.z0[d] as number) + f * (dz - (ps.z0[d] as number));
          } else {
            fx = dx - s1 * nx;
            fy = dy - s1 * ny;
            fz = dz - s1 * nz;
          }
          if (!this.footOn(t, fx, fy, fz, 1e-6)) continue;
          const ba = o[3] as number;
          const bb = o[4] as number;
          const be = o[5] as number;
          const wd = 1 / (mass[ps.owner[d] as number] as number);
          const wc = ba * ba * (w[a] as number) + bb * bb * (w[b] as number) + (e >= 0 ? be * be * (w[e] as number) : 0);
          const dl = (C / (wd + wc)) * side;
          ps.x[d] = dx + wd * dl * nx;
          ps.y[d] = dy + wd * dl * ny;
          ps.z[d] = dz + wd * dl * nz;
          this.wet[c] = 1;
          for (let k = 0; k < 3; k++) {
            const j = k === 0 ? a : k === 1 ? b : e;
            const bj = k === 0 ? ba : k === 1 ? bb : be;
            if (j < 0) continue;
            const wj = w[j] as number;
            if (wj === 0) {
              // a pinned corner: its pin carries the drop's push
              const pq = this.pinOf[j] as number;
              if (pq >= 0) {
                this.dropPinX[pq] = (this.dropPinX[pq] as number) - bj * dl * nx * inv * inv;
                this.dropPinY[pq] = (this.dropPinY[pq] as number) - bj * dl * ny * inv * inv;
                this.dropPinZ[pq] = (this.dropPinZ[pq] as number) - bj * dl * nz * inv * inv;
              }
              continue;
            }
            vx[j] = (vx[j] as number) - wj * bj * dl * nx * inv;
            vy[j] = (vy[j] as number) - wj * bj * dl * ny * inv;
            vz[j] = (vz[j] as number) - wj * bj * dl * nz * inv;
          }
        }
      }
    }
  }

  /** Smoke's flow blows cloth in the plane (design 9.5): the world in the plane says when it has smoke. */
  protected hasFlow(): boolean {
    return false;
  }

  /** Still air slows the faces too (set when the world has `air` over 0). */
  stillAir = false;

  /** Links stretched past `tears` times their length break for good, in id order (design 9.5). */
  private tear(): void {
    const { x, y, z, la, lb, rest, broken } = this;
    for (let ci = 0; ci < this.cloths.length; ci++) {
      const c = this.cloths[ci] as ClothInfo;
      const k = c.def.tears;
      if (!(k > 0) || c.asleep || c.unstable) continue;
      const k2 = k * k;
      let torn = 0;
      for (let l = c.l0; l < c.l0 + c.ln; l++) {
        if (broken[l] === 1 || this.kind[l] === LinkKind.bend) continue;
        const a = la[l] as number;
        const b = lb[l] as number;
        const dx = (x[a] as number) - (x[b] as number);
        const dy = (y[a] as number) - (y[b] as number);
        const dz = (z[a] as number) - (z[b] as number);
        const r = rest[l] as number;
        if (dx * dx + dy * dy + dz * dz > k2 * r * r) {
          broken[l] = 1;
          torn++;
        }
      }
      if (torn === 0) continue;
      // a bend link across a torn stretch link goes too, so the torn edge hangs free
      for (let l = c.l0; l < c.l0 + c.ln; l++) {
        if (this.kind[l] !== LinkKind.bend || broken[l] === 1) continue;
        if (this.bendCrossesTorn(l, c)) broken[l] = 1;
      }
      c.torn += torn;
      this.tornNow[ci] = torn;
    }
  }

  /** A bend link joins a, m, b along a thread: is either stretch link a–m or m–b torn? */
  private bendCrossesTorn(l: number, _c: ClothInfo): boolean {
    const a = this.la[l] as number;
    const b = this.lb[l] as number;
    const m = (a + b) / 2;
    const k1 = this.stretchAt.get(Math.min(a, m) * 8192 + Math.max(a, m));
    const k2 = this.stretchAt.get(Math.min(m, b) * 8192 + Math.max(m, b));
    return (k1 !== undefined && this.broken[k1] === 1) || (k2 !== undefined && this.broken[k2] === 1);
  }

  /** Stretch links by their two points (a × 8192 + b, a < b), for tearing. */
  private readonly stretchAt = new Map<number, number>();


  /** Sleep: a cloth whose points all move under 1 mm/s for 0.5 s; blow-up: a place or a speed not finite or over 1e6. */
  private settle(h: number): void {
    const { x, y, z, vx, vy, vz } = this;
    for (const c of this.cloths) {
      if (c.asleep || c.unstable) continue;
      let fast = false;
      let bad = false;
      const e = c.p0 + c.n;
      const s2 = SLEEP_SPEED * SLEEP_SPEED;
      for (let i = c.p0; i < e; i++) {
        const a = vx[i] as number;
        const b = vy[i] as number;
        const d = vz[i] as number;
        const v2 = a * a + b * b + d * d;
        if (v2 > s2) fast = true;
        if (!(v2 < BLOW_UP * BLOW_UP) || !(Math.abs(x[i] as number) < BLOW_UP && Math.abs(y[i] as number) < BLOW_UP && Math.abs(z[i] as number) < BLOW_UP)) bad = true;
      }
      if (bad) {
        c.unstable = true;
        continue;
      }
      if (fast || this.grabsOn(c)) c.sleepTime = 0;
      else c.sleepTime += h;
      if (c.sleepTime >= SLEEP_TIME && this.sleeping) {
        c.asleep = true;
        c.windX = this.windX;
        c.windY = this.windY;
        c.windZ = this.windZ;
        for (let i = c.p0; i < e; i++) {
          vx[i] = 0;
          vy[i] = 0;
          vz[i] = 0;
        }
      }
    }
  }

  /** The world's `sleep` setting. */
  sleeping = true;

  private grabsOn(c: ClothInfo): boolean {
    for (let g = 0; g < this.nGrab; g++) {
      const i = this.grabI[g] as number;
      if (i >= c.p0 && i < c.p0 + c.n) return true;
    }
    return false;
  }

  /** A sleeping cloth wakes when the wind changes, a body near it moves, it is grabbed, or a drop comes near. */
  private wakeCheck(): void {
    for (let ci = 0; ci < this.cloths.length; ci++) {
      const c = this.cloths[ci] as ClothInfo;
      if (!c.asleep) continue;
      if (c.windX !== this.windX || c.windY !== this.windY || c.windZ !== this.windZ || this.grabsOn(c) || this.bodiesStir(ci) || this.dropsNear(ci)) this.wake(ci);
    }
  }

  /** Did drops meet cloth c in the last liquid step? */
  protected dropsNear(c: number): boolean {
    return this.wet[c] === 1;
  }

  wake(c: number): void {
    const ci = this.cloths[c];
    if (!ci) return;
    ci.asleep = false;
    ci.sleepTime = 0;
  }

  /** Before the next step: wakes sleeping cloths that something stirs (called by the world before stepping). */
  wakeIfStirred(): void {
    this.wakeCheck();
  }

  /* ------------------------------ readouts ------------------------------ */

  /** The most stretched link of cloth c, as its length over its rest length (stretch and shear links). */
  stretchMax(c: number): number {
    const ci = this.cloths[c] as ClothInfo;
    let m = 0;
    const { x, y, z } = this;
    for (let l = ci.l0; l < ci.l0 + ci.ln; l++) {
      if (this.broken[l] === 1 || this.kind[l] !== LinkKind.stretch) continue;
      const a = this.la[l] as number;
      const b = this.lb[l] as number;
      const dx = (x[a] as number) - (x[b] as number);
      const dy = (y[a] as number) - (y[b] as number);
      const dz = (z[a] as number) - (z[b] as number);
      const r = Math.sqrt(dx * dx + dy * dy + dz * dz) / (this.rest[l] as number);
      if (r > m) m = r;
    }
    return m;
  }

  /** Kinetic plus potential energy of cloth c (the potential from gravity, 0 at the origin). */
  energy(c: number): number {
    const ci = this.cloths[c] as ClothInfo;
    const m = ci.mPt;
    let e = 0;
    for (let i = ci.p0; i < ci.p0 + ci.n; i++) {
      const a = this.vx[i] as number;
      const b = this.vy[i] as number;
      const d = this.vz[i] as number;
      e += 0.5 * m * (a * a + b * b + d * d) - m * (this.gx * (this.x[i] as number) + this.gy * (this.y[i] as number) + this.gz * (this.z[i] as number));
    }
    return e;
  }

  /** The sum of the forces the world pins of cloth c carry (N). */
  pinForce3(c: number): { x: number; y: number; z: number } {
    const ci = this.cloths[c] as ClothInfo;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    for (let q = ci.pin0; q < ci.pin0 + ci.pinN; q++) {
      fx += this.pinFx[q] as number;
      fy += this.pinFy[q] as number;
      fz += this.pinFz[q] as number;
    }
    return { x: fx, y: fy, z: fz };
  }

  /** The bodies cloth c touched in the last step (world indices, in order). */
  touching(c: number): number[] {
    const nb = this.bjx.length;
    const out: number[] = [];
    for (let b = 0; b < nb; b++) if (this.touched[c * nb + b] === 1) out.push(b);
    return out;
  }

  /** Takes hold of a point (or moves the hold) and pulls it toward (x, y, z). */
  grab(i: number, x: number, y: number, z: number): void {
    let g = 0;
    while (g < this.nGrab && this.grabI[g] !== i) g++;
    if (g === this.nGrab) {
      if (g >= MAX_GRABS) return;
      this.nGrab++;
    }
    this.grabI[g] = i;
    this.grabX[g] = x;
    this.grabY[g] = y;
    this.grabZ[g] = z;
    this.wake(this.owner[i] as number);
  }

  release(i: number): void {
    for (let g = 0; g < this.nGrab; g++) {
      if (this.grabI[g] !== i) continue;
      this.nGrab--;
      this.grabI[g] = this.grabI[this.nGrab] as number;
      this.grabX[g] = this.grabX[this.nGrab] as number;
      this.grabY[g] = this.grabY[this.nGrab] as number;
      this.grabZ[g] = this.grabZ[this.nGrab] as number;
      return;
    }
  }

  /** Lets go of every point. */
  releaseAll(): void {
    this.nGrab = 0;
  }

  /** The point of cloth c nearest (x, y, z). */
  nearest(c: number, x: number, y: number, z: number): number {
    const ci = this.cloths[c] as ClothInfo;
    let best = ci.p0;
    let bd = Infinity;
    for (let i = ci.p0; i < ci.p0 + ci.n; i++) {
      const dx = (this.x[i] as number) - x;
      const dy = (this.y[i] as number) - y;
      const dz = (this.z[i] as number) - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /* ------------------------------ checkpoints (design 10.3) ------------------------------ */

  /**
   * Everything the next step reads: each point's place and speed, the torn links as bits, the pins, each cloth's sleep,
   * and the pushes still owed to bodies.
   */
  save(): Float64Array {
    const n = this.n;
    const nl = this.la.length;
    const words = Math.ceil(nl / 32);
    const nb = this.bjx.length;
    const np = this.pinPoint.length;
    const nc = this.cloths.length;
    const per = this.dim === 3 ? 6 : 4;
    const out = new Float64Array(3 + nc * 7 + np * 3 + 1 + 9 * nb + words + per * n);
    let k = 0;
    out[k++] = n;
    out[k++] = this.steps;
    out[k++] = nb;
    for (const c of this.cloths) {
      out[k++] = c.asleep ? 1 : 0;
      out[k++] = c.sleepTime;
      out[k++] = c.torn;
      out[k++] = c.unstable ? 1 : 0;
      out[k++] = c.windX;
      out[k++] = c.windY;
      out[k++] = c.windZ;
    }
    for (let q = 0; q < np; q++) {
      out[k++] = this.pinX[q] as number;
      out[k++] = this.pinY[q] as number;
      out[k++] = this.pinZ[q] as number;
    }
    out[k++] = words;
    for (const a of [this.bjx, this.bjy, this.bjz, this.btx, this.bty, this.btz, this.bdx, this.bdy, this.bdz]) {
      out.set(a, k);
      k += nb;
    }
    // the torn links, 32 to a number
    for (let wd = 0; wd < words; wd++) {
      let bits = 0;
      let bit = 1;
      for (let b = 0; b < 32; b++) {
        const l = wd * 32 + b;
        if (l < nl && this.broken[l] === 1) bits += bit;
        bit *= 2;
      }
      out[k++] = bits;
    }
    const arrays = this.dim === 3 ? [this.x, this.y, this.z, this.vx, this.vy, this.vz] : [this.x, this.y, this.vx, this.vy];
    for (const a of arrays) {
      out.set(a.subarray(0, n), k);
      k += n;
    }
    return out;
  }

  load(s: Float64Array): void {
    let k = 0;
    const n = s[k++] as number;
    this.steps = s[k++] as number;
    const nb = s[k++] as number;
    this.sizeBodies(nb);
    for (const c of this.cloths) {
      c.asleep = s[k++] === 1;
      c.sleepTime = s[k++] as number;
      c.torn = s[k++] as number;
      c.unstable = s[k++] === 1;
      c.windX = s[k++] as number;
      c.windY = s[k++] as number;
      c.windZ = s[k++] as number;
    }
    for (let q = 0; q < this.pinPoint.length; q++) {
      this.pinX[q] = s[k++] as number;
      this.pinY[q] = s[k++] as number;
      this.pinZ[q] = s[k++] as number;
    }
    const words = s[k++] as number;
    for (const a of [this.bjx, this.bjy, this.bjz, this.btx, this.bty, this.btz, this.bdx, this.bdy, this.bdz]) {
      a.set(s.subarray(k, k + nb));
      k += nb;
    }
    const nl = this.la.length;
    for (let wd = 0; wd < words; wd++) {
      let bits = s[k++] as number;
      for (let b = 0; b < 32; b++) {
        const l = wd * 32 + b;
        const on = bits % 2;
        bits = (bits - on) / 2;
        if (l < nl) this.broken[l] = on === 1 ? 1 : 0;
      }
    }
    const arrays = this.dim === 3 ? [this.x, this.y, this.z, this.vx, this.vy, this.vz] : [this.x, this.y, this.vx, this.vy];
    for (const a of arrays) {
      a.set(s.subarray(k, k + n));
      k += n;
    }
    this.sx.set(this.x.subarray(0, n));
    this.sy.set(this.y.subarray(0, n));
    this.sz.set(this.z.subarray(0, n));
    this.tornNow.fill(0);
  }
}

/** How many links a cloth has. */
export function countLinks(d: { readonly nu: number; readonly nv: number; readonly bend: number }): number {
  const { nu, nv } = d;
  let n = nv * (nu - 1) + nu * (nv - 1);
  if (nv > 1) n += 2 * (nu - 1) * (nv - 1);
  if (d.bend > 0) n += nv * Math.max(0, nu - 2) + nu * Math.max(0, nv - 2);
  return n;
}

function dist(x: Float64Array, y: Float64Array, z: Float64Array, a: number, b: number): number {
  const dx = (x[a] as number) - (x[b] as number);
  const dy = (y[a] as number) - (y[b] as number);
  const dz = (z[a] as number) - (z[b] as number);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** The points of a cloth's grid at the start, row by row (design 2.4). */
export function sheetPoints(cx: number, cy: number, cz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, nu: number, nv: number): Float64Array {
  const out = new Float64Array(nu * nv * 3);
  for (let j = 0; j < nv; j++) {
    const r = nv > 1 ? j / (nv - 1) : 0;
    for (let i = 0; i < nu; i++) {
      const s = nu > 1 ? i / (nu - 1) : 0;
      const k = (j * nu + i) * 3;
      out[k] = cx + s * ux + r * vx;
      out[k + 1] = cy + s * uy + r * vy;
      out[k + 2] = cz + s * uz + r * vz;
    }
  }
  return out;
}

/**
 * The points a `pins` word names (design 2.4): `"top"` the edge highest up, `"left"` the edge furthest to −x,
 * `"corners"` the four corners (a rope's two ends), `"top corners"` the ends of the top edge. Indices into the grid.
 */
export function pinWord(word: string, pos: Float64Array, nu: number, nv: number, dim: 2 | 3): number[] | undefined {
  const up = dim === 3 ? 2 : 1;
  const at = (i: number, j: number): number => j * nu + i;
  const edges: { pts: number[]; ends: [number, number] }[] = [];
  if (nv === 1) {
    edges.push({ pts: [0], ends: [0, 0] }, { pts: [nu - 1], ends: [nu - 1, nu - 1] });
  } else {
    const row = (j: number): number[] => Array.from({ length: nu }, (_, i) => at(i, j));
    const col = (i: number): number[] => Array.from({ length: nv }, (_, j) => at(i, j));
    edges.push({ pts: row(0), ends: [at(0, 0), at(nu - 1, 0)] }, { pts: row(nv - 1), ends: [at(0, nv - 1), at(nu - 1, nv - 1)] }, { pts: col(0), ends: [at(0, 0), at(0, nv - 1)] }, { pts: col(nu - 1), ends: [at(nu - 1, 0), at(nu - 1, nv - 1)] });
  }
  const mean = (pts: number[], k: number): number => pts.reduce((s, p) => s + (pos[p * 3 + k] as number), 0) / pts.length;
  const pick = (score: (e: { pts: number[] }) => number): { pts: number[]; ends: [number, number] } => {
    let best = edges[0] as { pts: number[]; ends: [number, number] };
    let bs = -Infinity;
    for (const e of edges) {
      const s = score(e);
      if (s > bs + 1e-9) {
        bs = s;
        best = e;
      }
    }
    return best;
  };
  const w = word.trim().toLowerCase().replace(/\s+/g, ' ');
  if (w === 'top') return nv === 1 ? [pick((e) => mean(e.pts, up)).pts[0] as number] : pick((e) => mean(e.pts, up)).pts;
  if (w === 'left') return nv === 1 ? [pick((e) => -mean(e.pts, 0)).pts[0] as number] : pick((e) => -mean(e.pts, 0)).pts;
  if (w === 'corners') return nv === 1 ? [0, nu - 1] : [at(0, 0), at(nu - 1, 0), at(0, nv - 1), at(nu - 1, nv - 1)];
  if (w === 'top corners') {
    if (nv === 1) return [0, nu - 1];
    const e = pick((x) => mean(x.pts, up));
    return e.ends[0] === e.ends[1] ? [e.ends[0]] : [...e.ends];
  }
  return undefined;
}
