/**
 * The physics world in space (docs/features/physics/design.md 7): rigid bodies of spheres and convex solids (boxes,
 * prisms, pyramids; cylinders and cones as 24-sided solids), the floor plane, and terrain as triangle slabs. Sweep and
 * prune, separating-axis tests with face clipping (at most 4 points a pair), speculative contacts, sequential impulses
 * with two friction directions and warm starting, bounce from the speed before the step, a position pass, quaternion
 * turns with world inertia tensors, sleeping islands, per-kind forces and checkpoints. Exact maths only.
 */
import { sincos } from './math';

export const BodyType3 = { Static: 0, Kinematic: 1, Dynamic: 2 } as const;
export type BodyType3 = (typeof BodyType3)[keyof typeof BodyType3];

export interface P3 {
  x: number;
  y: number;
  z: number;
}

export type ShapeDef3 =
  | { readonly kind: 'sphere'; readonly c: P3; readonly r: number }
  | { readonly kind: 'hull'; readonly verts: readonly P3[]; readonly faces: readonly (readonly number[])[] }
  | { readonly kind: 'plane'; readonly n: P3; readonly d: number }
  /**
   * Terrain `z = f(x, y)` on an nx × ny grid from (x0, y0) in steps dx, dy: heights at the (nx + 1) × (ny + 1) corners,
   * index i (ny + 1) + j, NaN where f is undefined. Each cell is two triangles, (i, j) (i+1, j) (i+1, j+1) and
   * (i, j) (i+1, j+1) (i, j+1), each the top of a slab half a unit deep; only the cells under a shape are tested.
   */
  | { readonly kind: 'heightfield'; readonly x0: number; readonly y0: number; readonly dx: number; readonly dy: number; readonly nx: number; readonly ny: number; readonly h: Float64Array };

export interface BodyDef3 {
  readonly type: BodyType3;
  readonly shapes: readonly ShapeDef3[];
  readonly mass?: number;
  readonly density?: number;
  readonly v?: P3;
  readonly w?: P3;
  readonly friction?: number;
  readonly bounce?: number;
  readonly group?: number;
  /** A body that takes no part until `activate` (a wheel that may come off). */
  readonly off?: boolean;
}

/** A force kind index, as in the plane (`FORCE_KINDS` of world2). */
export const FK3 = { gravity: 0, normal: 1, friction: 2, tension: 3, spring: 4, buoyancy: 5, drag: 6, electric: 7, applied: 8, net: 9 } as const;
const NK = 10;

interface Heightfield {
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
  readonly nx: number;
  readonly ny: number;
  readonly h: Float64Array;
  /**
   * The one slab shape a terrain triangle is written into when it is met (`slabOf`), reused for every triangle, so a
   * long drive over new ground keeps no shape a triangle and leaves nothing for the young collector to copy.
   */
  slab?: Shape3 | undefined;
}

type Found3 = { nx: number; ny: number; nz: number; pts: { x: number; y: number; z: number; s: number }[] };

/** Which method a pair of kinds takes: the lower one is A. */
const PRI: readonly number[] = [2, 1, 0, -1];

interface Shape3 {
  readonly kind: 0 | 1 | 2 | 3; // sphere, hull, plane, heightfield
  readonly hf?: Heightfield;
  readonly body: number;
  readonly r: number;
  /** Sphere centre, body frame; plane normal and offset in world. */
  readonly lc: Float64Array;
  /** Hull corners (x, y, z packed), body frame, and in world. */
  readonly lv: Float64Array;
  readonly wv: Float64Array;
  /** Faces: corner indices, and outward normals (body frame, world). */
  readonly faces: readonly Int32Array[];
  readonly ln: Float64Array;
  readonly wn: Float64Array;
  /** Unique edge directions (body frame, world), for edge–edge axes, and the edges as corner pairs. */
  readonly le: Float64Array;
  readonly we: Float64Array;
  readonly edges: Int32Array;
  wc: Float64Array;
  /** Half the largest distance across, for margins. */
  readonly reach: number;
}

interface CPoint {
  /** Anchors in the frames of A and B. */
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  s: number;
  ni: number;
  t1i: number;
  t2i: number;
  // solver data
  rax: number;
  ray: number;
  raz: number;
  rbx: number;
  rby: number;
  rbz: number;
  nm: number;
  t1m: number;
  t2m: number;
  rv: number;
  max: number;
  /** Soft step: the step's impulses added up over its small steps (for the force readouts and hits). */
  tn: number;
  t1t: number;
  t2t: number;
  /** Soft step: closing speed before and after the small step's forces, the gap then, the bounce given, and if it bounced. */
  sv: number;
  sf: number;
  sg: number;
  bi: number;
  bounced: number;
}

interface Contact3 {
  /** The step this contact was last met in (`updateContacts`); one not met is dropped, or kept while its bodies sleep. */
  stamp: number;
  key: number;
  a: number;
  b: number;
  sa: number;
  sb: number;
  nx: number;
  ny: number;
  nz: number;
  pts: CPoint[];
  friction: number;
  restitution: number;
  pushed: boolean;
  touching: boolean;
  t1x: number;
  t1y: number;
  t1z: number;
  t2x: number;
  t2y: number;
  t2z: number;
}

export interface Hit3 {
  readonly a: number;
  readonly b: number;
  readonly speed: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly impulse: number;
}

/** What a joint in space must do for the solver. */
export interface Joint3 {
  readonly a: number;
  readonly b: number;
  broken: boolean;
  readonly kind: number;
  readonly breaks: number;
  impulse: number;
  initVelocity(w: World3, h: number): void;
  solveVelocity(w: World3, h: number): void;
  solvePosition(w: World3): boolean;
  energy(w: World3): number;
  /** Adds the forces it gave its bodies this step to their counts (`b.force(kind)`). */
  account?(w: World3, inv_h: number): void;
  save(out: number[]): void;
  load(s: Float64Array, k: number): number;
}

const SLOP = 0.005;
const RESTITUTION_THRESHOLD = 1;
/** Soft contacts (design 6.5): stiffness in Hz, damping ratio, and the fastest push-out of an overlap, m/s. */
const CONTACT_HERTZ = 30;
const CONTACT_DAMPING = 10;
const MAX_PUSH_OUT = 3;
const HIT_THRESHOLD = 0.05;
const SLEEP_LIN = 0.01;
const SLEEP_ANG = 0.03;
const TIME_TO_SLEEP = 0.5;

export class World3 {
  n = 0;
  type = new Uint8Array(0);
  /** Position, quaternion (w, x, y, z), velocity and turning speed. */
  p = new Float64Array(0);
  q = new Float64Array(0);
  v = new Float64Array(0);
  w = new Float64Array(0);
  /** Rotation matrix of each body (row major) and its world inverse inertia. */
  R = new Float64Array(0);
  invIw = new Float64Array(0);
  invIl = new Float64Array(0);
  invM = new Float64Array(0);
  /** The inverse masses and body-frame inverse inertias the bodies were made with, for a body that comes back. */
  private invM0 = new Float64Array(0);
  private invIl0 = new Float64Array(0);
  /** Triangles of the largest terrain, for contact keys. */
  private triMax = 1;
  mass = new Float64Array(0);
  /** The inertia tensor in the body frame, for kinetic energy. */
  Il = new Float64Array(0);
  fric = new Float64Array(0);
  rest = new Float64Array(0);
  group = new Int32Array(0);
  awake = new Uint8Array(0);
  sleepTime = new Float64Array(0);
  force = new Float64Array(0);
  torque = new Float64Array(0);
  impulse = new Float64Array(0);
  forces = new Float64Array(0);

  /**
   * The weight in this step's force readout of body i, from its mass now: a body that burns has its mass made smaller
   * after the bodies' step (design 9.8), and its weight is read with the mass it has (gravity moves every mass alike).
   */
  weighNow(i: number): void {
    const f = i * NK * 3 + FK3.gravity * 3;
    if (f + 2 >= this.forces.length) return;
    const m = this.mass[i] as number;
    this.forces[f] = m * this.gx;
    this.forces[f + 1] = m * this.gy;
    this.forces[f + 2] = m * this.gz;
  }
  reach = new Float64Array(0);
  shape0 = new Int32Array(0);
  shapeN = new Int32Array(0);
  shapes: Shape3[] = [];
  lo = new Float64Array(0);
  hi = new Float64Array(0);
  private sap = new Int32Array(0);
  private fixedSorted = new Int32Array(0);
  private fixedLo = new Float64Array(0);
  private fixedBig = new Int32Array(0);
  private fixedWidth = 0;
  joints: Joint3[] = [];
  private contacts: Contact3[] = [];
  private contactMap = new ContactTable3();
  private contactStamp = 0;
  /** Contacts and points that left, kept to be used again: a step makes none of its own (design 11.4). */
  private contactPool: Contact3[] = [];
  private pointPool: CPoint[] = [];
  /** Scratch the solver hands numbers through (a number passed to or returned from a call that is not inlined is a heap number): a point in 0 to 2 and out 3 to 5, an effective mass 6, a closing speed 7, a gap 8, an impulse 9 to 11, last step's points 12 on. */
  private sc = new Float64Array(16);
  private oldPts = new Float64Array(48);
  private pairs = new Float64Array(256);
  private pairCount = 0;
  hits: Hit3[] = [];
  left: number[] = [];
  gone = new Set<number>();
  stepIndex = 0;
  gx = 0;
  gy = 0;
  gz = -9.8;
  air = 0;
  passes = 8;
  sleeping = true;
  range = 50;
  private pv = new Float64Array(0);
  private pw = new Float64Array(0);

  constructor(defs: readonly BodyDef3[]) {
    const n = defs.length;
    this.n = n;
    this.type = new Uint8Array(n);
    this.p = new Float64Array(n * 3);
    this.q = new Float64Array(n * 4);
    this.v = new Float64Array(n * 3);
    this.w = new Float64Array(n * 3);
    this.R = new Float64Array(n * 9);
    this.invIw = new Float64Array(n * 9);
    this.invIl = new Float64Array(n * 9);
    this.Il = new Float64Array(n * 9);
    this.invM = new Float64Array(n);
    this.mass = new Float64Array(n);
    this.fric = new Float64Array(n);
    this.rest = new Float64Array(n);
    this.group = new Int32Array(n);
    this.awake = new Uint8Array(n).fill(1);
    this.sleepTime = new Float64Array(n);
    this.force = new Float64Array(n * 3);
    this.torque = new Float64Array(n * 3);
    this.impulse = new Float64Array(n * 3);
    this.forces = new Float64Array(n * NK * 3);
    this.reach = new Float64Array(n);
    this.shape0 = new Int32Array(n);
    this.shapeN = new Int32Array(n);
    for (let i = 0; i < n; i++) this.addBody(i, defs[i] as BodyDef3);
    const ns = this.shapes.length;
    this.lo = new Float64Array(ns * 3);
    this.hi = new Float64Array(ns * 3);
    for (let i = 0; i < n; i++) {
      this.setRot(i);
      this.updateShapes(i);
    }
    this.invM0 = Float64Array.from(this.invM);
    this.invIl0 = Float64Array.from(this.invIl);
    for (const s of this.shapes) if (s.hf) this.triMax = Math.max(this.triMax, s.hf.nx * s.hf.ny * 2);
    // the shapes of fixed bodies never move: they are sorted once and searched, so terrain of thousands of slabs costs
    // only the slabs under each moving shape; endless ones (planes) are tried against every moving shape
    const moving: number[] = [];
    const fixed: number[] = [];
    const big: number[] = [];
    for (let k = 0; k < ns; k++) {
      const s = this.shapes[k] as Shape3;
      if (this.type[s.body] !== BodyType3.Static) moving.push(k);
      else if (s.kind === 2 || s.kind === 3 || !((this.hi[k * 3] as number) - (this.lo[k * 3] as number) < 20)) big.push(k);
      else fixed.push(k);
    }
    fixed.sort((a, b) => (this.lo[a * 3] as number) - (this.lo[b * 3] as number) || a - b);
    this.sap = Int32Array.from(moving);
    this.fixedSorted = Int32Array.from(fixed);
    this.fixedLo = Float64Array.from(fixed.map((k) => this.lo[k * 3] as number));
    this.fixedBig = Int32Array.from(big);
    let w = 0;
    for (const k of fixed) w = Math.max(w, (this.hi[k * 3] as number) - (this.lo[k * 3] as number));
    this.fixedWidth = w;
    // bodies that wait (a wheel that may come off) are out of the world until they are let in
    for (let i = 0; i < n; i++) if ((defs[i] as BodyDef3).off) this.removeBody(i);
  }

  /**
   * Lets a waiting body in (or one that was removed), at a pose with a speed and a turning speed: a wheel that came off
   * (design 8). It keeps the mass it was made with.
   */
  activate(i: number, p: P3, q: readonly [number, number, number, number], v: P3, w: P3): void {
    this.gone.delete(i);
    this.type[i] = BodyType3.Dynamic;
    this.invM[i] = this.invM0[i] as number;
    this.invIl.set(this.invIl0.subarray(i * 9, i * 9 + 9), i * 9);
    this.p[i * 3] = p.x;
    this.p[i * 3 + 1] = p.y;
    this.p[i * 3 + 2] = p.z;
    this.q.set(q, i * 4);
    this.v[i * 3] = v.x;
    this.v[i * 3 + 1] = v.y;
    this.v[i * 3 + 2] = v.z;
    this.w[i * 3] = w.x;
    this.w[i * 3 + 1] = w.y;
    this.w[i * 3 + 2] = w.z;
    this.awake[i] = 1;
    this.sleepTime[i] = 0;
    this.setRot(i);
    this.updateShapes(i);
  }

  /** Adds a force of a kind to what body i felt this step (joints and wheels count theirs here). */
  account(i: number, k: number, x: number, y: number, z: number): void {
    if (this.type[i] !== BodyType3.Dynamic || this.awake[i] === 0) return;
    const o = i * NK * 3 + k * 3;
    this.forces[o] = (this.forces[o] as number) + x;
    this.forces[o + 1] = (this.forces[o + 1] as number) + y;
    this.forces[o + 2] = (this.forces[o + 2] as number) + z;
  }

  /** A joint is solved while one of its bodies moves. */
  private live(j: Joint3): boolean {
    if (j.broken) return false;
    return (this.type[j.a] === BodyType3.Dynamic && this.awake[j.a] === 1) || (this.type[j.b] === BodyType3.Dynamic && this.awake[j.b] === 1);
  }

  /**
   * The first hit of the ray o + t d (d of length 1), 0 ≤ t ≤ maxT, on any shape whose body `skip` does not refuse:
   * the floor, terrain, solids and bodies. A ray that starts inside a shape hits it at t = 0. Undefined when it misses.
   */
  rayCast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, skip: (body: number) => boolean): { t: number; nx: number; ny: number; nz: number; body: number } | undefined {
    const ex = ox + dx * maxT;
    const ey = oy + dy * maxT;
    const ez = oz + dz * maxT;
    const lx = Math.min(ox, ex);
    const ly = Math.min(oy, ey);
    const lz = Math.min(oz, ez);
    const hx = Math.max(ox, ex);
    const hy = Math.max(oy, ey);
    const hz = Math.max(oz, ez);
    let best: { t: number; nx: number; ny: number; nz: number; body: number } | undefined;
    let bt = maxT;
    for (let k = 0; k < this.shapes.length; k++) {
      const s = this.shapes[k] as Shape3;
      if (hx < (this.lo[k * 3] as number) || lx > (this.hi[k * 3] as number) || hy < (this.lo[k * 3 + 1] as number) || ly > (this.hi[k * 3 + 1] as number) || hz < (this.lo[k * 3 + 2] as number) || lz > (this.hi[k * 3 + 2] as number)) continue;
      if (this.gone.has(s.body) || skip(s.body)) continue;
      const r = rayShape(s, ox, oy, oz, dx, dy, dz, bt);
      if (r && r.t <= bt) {
        bt = r.t;
        best = { ...r, body: s.body };
      }
    }
    return best;
  }

  /* ------------------------------ building ------------------------------ */

  private addBody(i: number, d: BodyDef3): void {
    this.type[i] = d.type;
    this.q[i * 4] = 1;
    this.fric[i] = d.friction ?? (d.type === BodyType3.Dynamic ? 0.4 : Number.NaN);
    this.rest[i] = d.bounce ?? (d.type === BodyType3.Dynamic ? 0.2 : 0);
    this.group[i] = d.group ?? 0;
    let vol = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    // second moments about the origin, summed over the shapes (for density 1)
    const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    // fixed bodies have no mass: their moments are not needed
    for (const s of d.type === BodyType3.Dynamic ? d.shapes : []) {
      if (s.kind === 'plane' || s.kind === 'heightfield') continue;
      if (s.kind === 'sphere') {
        const v = (4 / 3) * Math.PI * s.r * s.r * s.r;
        vol += v;
        cx += v * s.c.x;
        cy += v * s.c.y;
        cz += v * s.c.z;
        const k = (v * s.r * s.r) / 5;
        // ∫x x dV about the origin: the sphere's own part plus its centre
        const cc = [s.c.x, s.c.y, s.c.z];
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a * 3 + b] = (C[a * 3 + b] as number) + (a === b ? k : 0) + v * (cc[a] as number) * (cc[b] as number);
      } else {
        const m = hullMoments(s.verts, s.faces);
        vol += m.vol;
        cx += m.vol * m.cx;
        cy += m.vol * m.cy;
        cz += m.vol * m.cz;
        for (let a = 0; a < 9; a++) C[a] = (C[a] as number) + (m.C[a] as number);
      }
    }
    let ox = 0;
    let oy = 0;
    let oz = 0;
    if (d.type === BodyType3.Dynamic && vol > 0) {
      ox = cx / vol;
      oy = cy / vol;
      oz = cz / vol;
      const density = d.mass !== undefined && d.mass > 0 ? d.mass / vol : (d.density ?? 1);
      const m = density * vol;
      this.mass[i] = m;
      this.invM[i] = 1 / m;
      // covariance about the centre of mass, then the inertia tensor I = tr(C) E - C
      const o = [ox, oy, oz];
      const Cc: number[] = [];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) Cc.push(density * ((C[a * 3 + b] as number) - vol * (o[a] as number) * (o[b] as number)));
      const tr = (Cc[0] as number) + (Cc[4] as number) + (Cc[8] as number);
      const I = Cc.map((c, k) => (k % 4 === 0 ? tr - c : -c));
      this.Il.set(I, i * 9);
      const inv = inv3(I);
      if (inv) this.invIl.set(inv, i * 9);
    }
    this.p[i * 3] = ox;
    this.p[i * 3 + 1] = oy;
    this.p[i * 3 + 2] = oz;
    this.v[i * 3] = d.v?.x ?? 0;
    this.v[i * 3 + 1] = d.v?.y ?? 0;
    this.v[i * 3 + 2] = d.v?.z ?? 0;
    this.w[i * 3] = d.w?.x ?? 0;
    this.w[i * 3 + 1] = d.w?.y ?? 0;
    this.w[i * 3 + 2] = d.w?.z ?? 0;
    this.shape0[i] = this.shapes.length;
    let reach = 0;
    for (const s of d.shapes) {
      const sh = makeShape3(i, s, ox, oy, oz);
      this.shapes.push(sh);
      reach = Math.max(reach, sh.reach);
    }
    this.shapeN[i] = d.shapes.length;
    this.reach[i] = reach;
  }

  setRot(i: number): void {
    const o = i * 4;
    let qw = this.q[o] as number;
    let qx = this.q[o + 1] as number;
    let qy = this.q[o + 2] as number;
    let qz = this.q[o + 3] as number;
    const l = Math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz) || 1;
    qw /= l;
    qx /= l;
    qy /= l;
    qz /= l;
    this.q[o] = qw;
    this.q[o + 1] = qx;
    this.q[o + 2] = qy;
    this.q[o + 3] = qz;
    const r = i * 9;
    const R = this.R;
    R[r] = 1 - 2 * (qy * qy + qz * qz);
    R[r + 1] = 2 * (qx * qy - qw * qz);
    R[r + 2] = 2 * (qx * qz + qw * qy);
    R[r + 3] = 2 * (qx * qy + qw * qz);
    R[r + 4] = 1 - 2 * (qx * qx + qz * qz);
    R[r + 5] = 2 * (qy * qz - qw * qx);
    R[r + 6] = 2 * (qx * qz - qw * qy);
    R[r + 7] = 2 * (qy * qz + qw * qx);
    R[r + 8] = 1 - 2 * (qx * qx + qy * qy);
    // world inverse inertia: R I⁻¹ Rᵀ
    const A = this.invIl;
    const out = this.invIw;
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        let s = 0;
        for (let k = 0; k < 3; k++) for (let m = 0; m < 3; m++) s += (R[r + a * 3 + k] as number) * (A[r + k * 3 + m] as number) * (R[r + b * 3 + m] as number);
        out[r + a * 3 + b] = s;
      }
    }
  }

  /** World corners, normals and edges of the shapes of body i, and their fat boxes. */
  updateShapes(i: number): void {
    const R = this.R;
    const r = i * 9;
    const px = this.p[i * 3] as number;
    const py = this.p[i * 3 + 1] as number;
    const pz = this.p[i * 3 + 2] as number;
    const sp = Math.sqrt((this.v[i * 3] as number) ** 2 + (this.v[i * 3 + 1] as number) ** 2 + (this.v[i * 3 + 2] as number) ** 2);
    const wm = Math.sqrt((this.w[i * 3] as number) ** 2 + (this.w[i * 3 + 1] as number) ** 2 + (this.w[i * 3 + 2] as number) ** 2);
    const margin = 4 * SLOP + (1 / 120) * (sp + wm * (this.reach[i] as number));
    const s0 = this.shape0[i] as number;
    for (let k = s0; k < s0 + (this.shapeN[i] as number); k++) {
      const s = this.shapes[k] as Shape3;
      let lx = Infinity;
      let ly = Infinity;
      let lz = Infinity;
      let hx = -Infinity;
      let hy = -Infinity;
      let hz = -Infinity;
      if (s.kind === 3) {
        // terrain never moves: its box is the grid, from half a unit under its lowest corner to its highest
        const f = s.hf as Heightfield;
        lx = f.x0;
        ly = f.y0;
        hx = f.x0 + f.nx * f.dx;
        hy = f.y0 + f.ny * f.dy;
        for (let q = 0; q < f.h.length; q++) {
          const z = f.h[q] as number;
          if (z < lz) lz = z;
          if (z > hz) hz = z;
        }
        lz -= 0.5;
      } else if (s.kind === 2) {
        lx = ly = lz = -1e9;
        hx = hy = hz = 1e9;
        // a plane: everything on its back side; a floor z = d gives a box below d
        if (Math.abs((s.lc[2] as number) - 1) < 1e-12) hz = s.lc[3] as number;
      } else if (s.kind === 0) {
        const c = s.lc;
        const x = px + (R[r] as number) * (c[0] as number) + (R[r + 1] as number) * (c[1] as number) + (R[r + 2] as number) * (c[2] as number);
        const y = py + (R[r + 3] as number) * (c[0] as number) + (R[r + 4] as number) * (c[1] as number) + (R[r + 5] as number) * (c[2] as number);
        const z = pz + (R[r + 6] as number) * (c[0] as number) + (R[r + 7] as number) * (c[1] as number) + (R[r + 8] as number) * (c[2] as number);
        s.wc[0] = x;
        s.wc[1] = y;
        s.wc[2] = z;
        lx = x - s.r;
        ly = y - s.r;
        lz = z - s.r;
        hx = x + s.r;
        hy = y + s.r;
        hz = z + s.r;
      } else {
        const lv = s.lv;
        const wv = s.wv;
        for (let j = 0; j < lv.length; j += 3) {
          const a = lv[j] as number;
          const b = lv[j + 1] as number;
          const c = lv[j + 2] as number;
          const x = px + (R[r] as number) * a + (R[r + 1] as number) * b + (R[r + 2] as number) * c;
          const y = py + (R[r + 3] as number) * a + (R[r + 4] as number) * b + (R[r + 5] as number) * c;
          const z = pz + (R[r + 6] as number) * a + (R[r + 7] as number) * b + (R[r + 8] as number) * c;
          wv[j] = x;
          wv[j + 1] = y;
          wv[j + 2] = z;
          if (x < lx) lx = x;
          if (y < ly) ly = y;
          if (z < lz) lz = z;
          if (x > hx) hx = x;
          if (y > hy) hy = y;
          if (z > hz) hz = z;
        }
        turnAll(s.ln, s.wn, R, r);
        turnAll(s.le, s.we, R, r);
      }
      this.lo[k * 3] = lx - margin;
      this.lo[k * 3 + 1] = ly - margin;
      this.lo[k * 3 + 2] = lz - margin;
      this.hi[k * 3] = hx + margin;
      this.hi[k * 3 + 1] = hy + margin;
      this.hi[k * 3 + 2] = hz + margin;
    }
  }

  /* ------------------------------ the step ------------------------------ */

  /** The step's length: set by the driver before `step` (a field, not an argument: a number passed in a call is a heap number, design 11.4). */
  hStep = 1 / 120;
  /** Scratch a step keeps: the speeds at its start, and the joints it solves. */
  private v0 = new Float64Array(0);
  private liveJoints: Joint3[] = [];

  step(): void {
    const h = this.hStep;
    const n = this.n;
    this.hits.length = 0;
    this.left.length = 0;
    if (this.pv.length !== n * 3) {
      this.pv = new Float64Array(n * 3);
      this.pw = new Float64Array(n * 3);
    }
    this.pv.set(this.v);
    this.pw.set(this.w);
    for (let i = 0; i < n; i++) if (this.type[i] !== BodyType3.Dynamic || this.awake[i] === 1) this.forces.fill(0, i * NK * 3, (i + 1) * NK * 3);
    // pushes and steady forces wake a body; the speeds at the start with this step's pushes, for the net force
    if (this.v0.length !== this.v.length) this.v0 = new Float64Array(this.v.length);
    const v0 = this.v0;
    v0.set(this.v);
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType3.Dynamic) continue;
      const pushed = this.force[i * 3] !== 0 || this.force[i * 3 + 1] !== 0 || this.force[i * 3 + 2] !== 0 || this.impulse[i * 3] !== 0 || this.impulse[i * 3 + 1] !== 0 || this.impulse[i * 3 + 2] !== 0 || this.torque[i * 3] !== 0 || this.torque[i * 3 + 1] !== 0 || this.torque[i * 3 + 2] !== 0;
      if (pushed && this.awake[i] === 0) this.wakeBody(i);
      for (let a = 0; a < 3; a++) v0[i * 3 + a] = (v0[i * 3 + a] as number) + (this.invM[i] as number) * (this.impulse[i * 3 + a] as number);
    }
    for (let i = 0; i < n; i++) if ((this.type[i] !== BodyType3.Static || this.stepIndex === 0) && !this.gone.has(i)) this.updateShapes(i);
    this.findPairs();
    this.updateContacts();
    this.wakeTouched();
    this.initContacts();
    // the soft step (design 6.5), as in the plane: small steps of forces, bounce, warm start, solve, move, relax
    // (indexed loops and fields throughout: an iterator or a number passed in a call is garbage in every step, design 11.4)
    const live = this.liveJoints;
    while (live.length > 0) live.pop();
    for (let k = 0; k < this.joints.length; k++) {
      const j = this.joints[k] as Joint3;
      if (this.live(j)) live.push(j);
    }
    const S = this.substeps;
    const hs = h / S;
    const inv_hs = 1 / hs;
    this.hsNow = hs;
    this.invHs = inv_hs;
    this.beginSoft();
    for (let s = 0; s < S; s++) {
      this.pfv.set(this.v);
      this.pfw.set(this.w);
      this.integrateForces(s === 0, S);
      if (s === S - 1) this.impulse.fill(0);
      this.closingSpeeds();
      this.bounceWalls();
      for (let k = 0; k < live.length; k++) {
        const j = live[k] as Joint3;
        if (!j.broken) j.initVelocity(this, hs);
      }
      this.warmStart();
      for (let k = 0; k < live.length; k++) {
        const j = live[k] as Joint3;
        if (!j.broken) j.solveVelocity(this, hs);
      }
      this.solveSoft(true);
      this.integratePositions();
      for (let k = 0; k < live.length; k++) {
        const j = live[k] as Joint3;
        if (!j.broken) j.solveVelocity(this, hs);
      }
      this.solveSoft(false);
      this.bounceBodies();
      this.addUpImpulses();
    }
    // joints only: contacts need no position pass, their soft push-out took the overlap
    if (live.length > 0) {
      for (let it = 0; it < 3; it++) {
        let ok = true;
        for (let k = 0; k < live.length; k++) {
          const j = live[k] as Joint3;
          if (!j.broken) ok = j.solvePosition(this) && ok;
        }
        if (ok) break;
      }
    }
    this.countForces(v0);
    this.collectHits();
    if (this.sleeping) this.sleepIslands();
    const range = this.range;
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType3.Dynamic || this.gone.has(i)) continue;
      if (Math.abs(this.p[i * 3] as number) > range || Math.abs(this.p[i * 3 + 1] as number) > range || Math.abs(this.p[i * 3 + 2] as number) > range) this.left.push(i);
    }
    for (let k = 0; k < this.left.length; k++) this.removeBody(this.left[k] as number);
    this.stepIndex++;
  }

  /**
   * Wakes the sleeping bodies whose boxes meet body `i`'s, called just before `i` leaves the world (a burnt body or shape):
   * what it held up falls (the plane's `wakeAround`). A sleeping body is not woken by a wall that goes away on its own.
   */
  wakeAround(i: number): void {
    const s0 = this.shape0[i] as number;
    const sn = this.shapeN[i] as number;
    const lo = this.lo;
    const hi = this.hi;
    for (let j = 0; j < this.n; j++) {
      if (j === i || this.type[j] !== BodyType3.Dynamic || this.awake[j] === 1 || this.gone.has(j)) continue;
      const t0 = this.shape0[j] as number;
      const tn = this.shapeN[j] as number;
      let meets = false;
      for (let k = s0; k < s0 + sn && !meets; k++) {
        for (let q = t0; q < t0 + tn && !meets; q++) {
          let apart = false;
          for (let a = 0; a < 3 && !apart; a++) if ((hi[k * 3 + a] as number) < (lo[q * 3 + a] as number) || (hi[q * 3 + a] as number) < (lo[k * 3 + a] as number)) apart = true;
          if (!apart) meets = true;
        }
      }
      if (meets) this.wakeBody(j);
    }
  }

  removeBody(i: number): void {
    this.type[i] = BodyType3.Static;
    this.invM[i] = 0;
    this.invIw.fill(0, i * 9, i * 9 + 9);
    this.invIl.fill(0, i * 9, i * 9 + 9);
    this.v.fill(0, i * 3, i * 3 + 3);
    this.w.fill(0, i * 3, i * 3 + 3);
    this.awake[i] = 0;
    this.gone.add(i);
    const s0 = this.shape0[i] as number;
    for (let k = s0; k < s0 + (this.shapeN[i] as number); k++) {
      this.lo[k * 3] = Infinity;
      this.hi[k * 3] = -Infinity;
    }
  }

  /* ------------------------------ broad phase ------------------------------ */

  private findPairs(): void {
    const sap = this.sap;
    const lo = this.lo;
    const ns = sap.length;
    for (let i = 1; i < ns; i++) {
      const k = sap[i] as number;
      const v = lo[k * 3] as number;
      let j = i - 1;
      while (j >= 0 && ((lo[(sap[j] as number) * 3] as number) > v || ((lo[(sap[j] as number) * 3] as number) === v && (sap[j] as number) > k))) {
        sap[j + 1] = sap[j] as number;
        j--;
      }
      sap[j + 1] = k;
    }
    this.pairCount = 0;
    const hi = this.hi;
    const fs = this.fixedSorted;
    const flo = this.fixedLo;
    const nf = fs.length;
    for (let i = 0; i < ns; i++) {
      const s1 = sap[i] as number;
      const lx = lo[s1 * 3] as number;
      const hx = hi[s1 * 3] as number;
      if (!(hx >= lx)) continue;
      const b1 = (this.shapes[s1] as Shape3).body;
      // moving against moving: sweep and prune
      for (let j = i + 1; j < ns; j++) {
        const s2 = sap[j] as number;
        if ((lo[s2 * 3] as number) > hx) break;
        if (this.overlapYZ(s1, s2)) this.addPair(s1, s2, b1);
      }
      // a sleeping body only meets fixed shapes when it wakes
      if (this.type[b1] === BodyType3.Dynamic && this.awake[b1] === 0) continue;
      for (let j = 0; j < this.fixedBig.length; j++) {
        const s2 = this.fixedBig[j] as number;
        if ((hi[s2 * 3] as number) >= lx && (lo[s2 * 3] as number) <= hx && this.overlapYZ(s1, s2)) this.addPair(s1, s2, b1);
      }
      // the fixed shapes whose left edge is within the widest fixed shape of this one's left edge
      let a = 0;
      let b = nf;
      const from = lx - this.fixedWidth;
      while (a < b) {
        const m = (a + b) >> 1;
        if ((flo[m] as number) < from) a = m + 1;
        else b = m;
      }
      for (let j = a; j < nf; j++) {
        if ((flo[j] as number) > hx) break;
        const s2 = fs[j] as number;
        if ((hi[s2 * 3] as number) >= lx && this.overlapYZ(s1, s2)) this.addPair(s1, s2, b1);
      }
    }
    const np = this.pairCount;
    if (np > 16) {
      // the whole array is sorted with Infinity after the pairs: `subarray` would make a typed-array view every step
      this.pairs.fill(Infinity, np);
      this.pairs.sort();
    } else {
      // a few pairs (a quiet world): insertion sort, and no typed-array view made for the engine's sort
      const pairs = this.pairs;
      for (let i = 1; i < np; i++) {
        const key = pairs[i] as number;
        let j = i - 1;
        while (j >= 0 && (pairs[j] as number) > key) {
          pairs[j + 1] = pairs[j] as number;
          j--;
        }
        pairs[j + 1] = key;
      }
    }
  }

  /** Do the boxes of shapes a and b overlap in y and z (the sweep has settled x)? */
  private overlapYZ(a: number, b: number): boolean {
    const lo = this.lo;
    const hi = this.hi;
    return !((hi[a * 3 + 1] as number) < (lo[b * 3 + 1] as number) || (hi[b * 3 + 1] as number) < (lo[a * 3 + 1] as number) || (hi[a * 3 + 2] as number) < (lo[b * 3 + 2] as number) || (hi[b * 3 + 2] as number) < (lo[a * 3 + 2] as number));
  }

  /** Lists the pair of shapes s1 and s2 (of bodies b1 and the other) when the bodies may hit. */
  private addPair(s1: number, s2: number, b1: number): void {
    const b2 = (this.shapes[s2] as Shape3).body;
    if (b1 === b2 || !this.mayHit(b1, b2)) return;
    if (this.pairCount === this.pairs.length) {
      const p = new Float64Array(this.pairs.length * 2);
      p.set(this.pairs);
      this.pairs = p;
    }
    const all = this.shapes.length;
    this.pairs[this.pairCount++] = (s1 < s2 ? s1 : s2) * all + (s1 < s2 ? s2 : s1);
  }

  private mayHit(a: number, b: number): boolean {
    const ta = this.type[a] as number;
    const tb = this.type[b] as number;
    if (ta !== BodyType3.Dynamic && tb !== BodyType3.Dynamic) return false;
    const aw = ta === BodyType3.Dynamic && this.awake[a] === 1;
    const bw = tb === BodyType3.Dynamic && this.awake[b] === 1;
    if (!aw && !bw) {
      const moving = (ta === BodyType3.Kinematic && this.isMoving(a)) || (tb === BodyType3.Kinematic && this.isMoving(b));
      if (!moving) return false;
    }
    const ga = this.group[a] as number;
    if (ga !== 0 && ga === this.group[b]) return false;
    for (let k = 0; k < this.joints.length; k++) {
      const j = this.joints[k] as Joint3;
      if (!j.broken && ((j.a === a && j.b === b) || (j.a === b && j.b === a))) return false;
    }
    return true;
  }

  private isMoving(i: number): boolean {
    for (let a = 0; a < 3; a++) if (this.v[i * 3 + a] !== 0 || this.w[i * 3 + a] !== 0) return true;
    return false;
  }

  /* ------------------------------ narrow phase ------------------------------ */

  /** The contact table and list the next step fills (the last step's are swapped with them: a step makes no new table or list). */
  private spareMap = new ContactTable3();
  private spareList: Contact3[] = [];

  private stillBody(i: number): boolean {
    return this.type[i] !== BodyType3.Dynamic || (this.awake[i] === 0 && !this.gone.has(i));
  }

  /** The margin a pair is made within (both bodies' over this step's length), into `FS[S_MARGIN]`. */
  private pairMargin(a: number, b: number): void {
    const h = this.hStep;
    const spa = Math.sqrt((this.v[a * 3] as number) ** 2 + (this.v[a * 3 + 1] as number) ** 2 + (this.v[a * 3 + 2] as number) ** 2);
    const wma = Math.sqrt((this.w[a * 3] as number) ** 2 + (this.w[a * 3 + 1] as number) ** 2 + (this.w[a * 3 + 2] as number) ** 2);
    const spb = Math.sqrt((this.v[b * 3] as number) ** 2 + (this.v[b * 3 + 1] as number) ** 2 + (this.v[b * 3 + 2] as number) ** 2);
    const wmb = Math.sqrt((this.w[b * 3] as number) ** 2 + (this.w[b * 3 + 1] as number) ** 2 + (this.w[b * 3 + 2] as number) ** 2);
    FS[S_MARGIN] = 2 * SLOP + h * (spa + wma * (this.reach[a] as number)) + (2 * SLOP + h * (spb + wmb * (this.reach[b] as number)));
  }

  private updateContacts(): void {
    const old = this.contactMap;
    const next = this.spareMap;
    const list = this.spareList;
    // (emptied with `pop`: `length = 0` frees the store and the pushes below make one again, every step)
    while (list.length > 0) list.pop();
    const stamp = ++this.contactStamp;
    const ns = this.shapes.length;
    for (let p = 0; p < this.pairCount; p++) {
      const key = this.pairs[p] as number;
      let sa = Math.floor(key / ns);
      let sb = key - sa * ns;
      let A = this.shapes[sa] as Shape3;
      let B = this.shapes[sb] as Shape3;
      // order: terrain, then plane, hull, sphere, so each pair has one method
      if ((PRI[A.kind] as number) > (PRI[B.kind] as number)) {
        const t = sa;
        sa = sb;
        sb = t;
        const T = A;
        A = B;
        B = T;
      }
      this.pairMargin(A.body, B.body);
      if (A.kind === 3) {
        const margin = FS[S_MARGIN] as number;
        // terrain: only the cells under the other shape, each triangle a slab of its own with its own touch
        const hf = A.hf as Heightfield;
        const base = ns * ns + (sb * ns + sa) * this.triMax;
        const i0 = Math.max(0, Math.floor(((this.lo[sb * 3] as number) - margin - hf.x0) / hf.dx));
        const i1 = Math.min(hf.nx - 1, Math.floor(((this.hi[sb * 3] as number) + margin - hf.x0) / hf.dx));
        const j0 = Math.max(0, Math.floor(((this.lo[sb * 3 + 1] as number) - margin - hf.y0) / hf.dy));
        const j1 = Math.min(hf.ny - 1, Math.floor(((this.hi[sb * 3 + 1] as number) + margin - hf.y0) / hf.dy));
        const zlo = (this.lo[sb * 3 + 2] as number) - margin;
        const found: { tri: number; f: Found3; s: number }[] = [];
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            for (let t = 0; t < 2; t++) {
              const top = triTop(hf, i, j, t);
              // a triangle wholly under the shape's box, or whose top plane the shape is clear of (a separating axis
              // of the slab), cannot touch it
              if (!(top >= zlo) || clearOfTri(hf, i, j, t, B, margin)) continue;
              const slab = slabOf(hf, A.body, i, j, t);
              if (!slab) continue;
              collideShapes(slab, B);
              if (FD.n === 0) continue;
              const f = snapshotFound();
              let s = Infinity;
              for (const q of f.pts) s = Math.min(s, q.s);
              found.push({ tri: (i * hf.ny + j) * 2 + t, f, s });
            }
          }
        }
        // a shape resting on fine terrain is near many triangles: the closest few carry it (a ball needs one or two)
        found.sort((x, y) => x.s - y.s || x.tri - y.tri);
        const keep = found.slice(0, 4).sort((x, y) => x.tri - y.tri);
        for (const c of keep) {
          restoreFound(c.f);
          this.meet(base + c.tri, sa, sb, A, B, old, next, list, stamp);
        }
        continue;
      }
      collideShapes(A, B);
      this.meet(key, sa, sb, A, B, old, next, list, stamp);
    }
    // a sleeping body keeps its touches (and what it reads of them) until it wakes; they are not solved. A contact that is
    // neither met nor kept is dropped, and kept to be made again (its points too).
    for (let q = 0; q < old.size; q++) {
      const c = old.list[q] as Contact3;
      if (c.stamp === stamp) continue;
      if (c.touching && this.stillBody(c.a) && this.stillBody(c.b)) next.set(c);
      else this.dropContact(c);
    }
    old.clear();
    this.spareMap = old;
    this.spareList = this.contacts;
    this.contactMap = next;
    this.contacts = list;
  }

  /** A contact that is no more: its points and itself go to the pools. */
  private dropContact(c: Contact3): void {
    while (c.pts.length > 0) this.pointPool.push(c.pts.pop() as CPoint);
    this.contactPool.push(c);
  }

  /** The contact of one pair of shapes (or one terrain triangle and a shape) from what `collideShapes` left in `FD` and `FP`, keeping last step's impulses. */
  private meet(key: number, sa: number, sb: number, A: Shape3, B: Shape3, old: ContactTable3, next: ContactTable3, list: Contact3[], stamp: number): void {
    const prev = old.get(key);
    const n = FD.n;
    if (n === 0) {
      if (prev) {
        while (prev.pts.length > 0) this.pointPool.push(prev.pts.pop() as CPoint);
        prev.pushed = false;
        prev.touching = false;
        prev.stamp = stamp;
        next.set(prev);
      }
      return;
    }
    let c: Contact3;
    if (prev) c = prev;
    else {
      const pooled = this.contactPool.pop();
      if (pooled) {
        c = pooled;
        c.key = key;
        c.pushed = false;
        c.touching = false;
        c.t1x = c.t1y = c.t1z = c.t2x = c.t2y = c.t2z = 0;
      } else c = { stamp, key, a: A.body, b: B.body, sa, sb, nx: 0, ny: 0, nz: 0, pts: [], friction: 0, restitution: 0, pushed: false, touching: false, t1x: 0, t1y: 0, t1z: 0, t2x: 0, t2y: 0, t2z: 0 };
    }
    c.stamp = stamp;
    c.a = A.body;
    c.b = B.body;
    c.sa = sa;
    c.sb = sb;
    c.nx = FD.nx;
    c.ny = FD.ny;
    c.nz = FD.nz;
    const pts = c.pts;
    // last step's points: where they are on B, and what they carried, for the warm start
    const no = pts.length;
    if (this.oldPts.length < no * 6) this.oldPts = new Float64Array(no * 12);
    const olds = this.oldPts;
    for (let k = 0; k < no; k++) {
      const o = pts[k] as CPoint;
      olds[k * 6] = o.bx;
      olds[k * 6 + 1] = o.by;
      olds[k * 6 + 2] = o.bz;
      olds[k * 6 + 3] = o.ni;
      olds[k * 6 + 4] = o.t1i;
      olds[k * 6 + 5] = o.t2i;
    }
    while (pts.length > n) this.pointPool.push(pts.pop() as CPoint);
    while (pts.length < n) pts.push(this.pointPool.pop() ?? newPoint());
    const sc = this.sc;
    for (let k = 0; k < n; k++) {
      const qx = FP[k * 4] as number;
      const qy = FP[k * 4 + 1] as number;
      const qz = FP[k * 4 + 2] as number;
      const qs = FP[k * 4 + 3] as number;
      // the point on A's surface and on B's: q is on B's, q - s n on A's
      sc[0] = qx - qs * c.nx;
      sc[1] = qy - qs * c.ny;
      sc[2] = qz - qs * c.nz;
      this.loc(c.a);
      const cp = pts[k] as CPoint;
      cp.ax = sc[3] as number;
      cp.ay = sc[4] as number;
      cp.az = sc[5] as number;
      sc[0] = qx;
      sc[1] = qy;
      sc[2] = qz;
      this.loc(c.b);
      cp.bx = sc[3] as number;
      cp.by = sc[4] as number;
      cp.bz = sc[5] as number;
      cp.s = qs;
      cp.ni = 0;
      cp.t1i = 0;
      cp.t2i = 0;
      cp.rax = cp.ray = cp.raz = cp.rbx = cp.rby = cp.rbz = 0;
      cp.nm = cp.t1m = cp.t2m = cp.rv = cp.max = cp.tn = cp.t1t = cp.t2t = cp.sv = cp.sf = cp.sg = cp.bi = cp.bounced = 0;
      // warm start from the old point nearest on B
      let best = -1;
      let bd = 0.04 * 0.04;
      for (let o = 0; o < no; o++) {
        const d = ((olds[o * 6] as number) - cp.bx) ** 2 + ((olds[o * 6 + 1] as number) - cp.by) ** 2 + ((olds[o * 6 + 2] as number) - cp.bz) ** 2;
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best >= 0) {
        cp.ni = olds[best * 6 + 3] as number;
        cp.t1i = olds[best * 6 + 4] as number;
        cp.t2i = olds[best * 6 + 5] as number;
      }
    }
    const fa = this.fric[c.a] as number;
    const fb = this.fric[c.b] as number;
    c.friction = Number.isNaN(fa) ? (Number.isNaN(fb) ? 0.4 : fb) : Number.isNaN(fb) ? fa : Math.sqrt(fa * fb);
    c.restitution = Math.max(this.rest[c.a] as number, this.rest[c.b] as number);
    next.set(c);
    list.push(c);
  }

  /** The world point in `sc[0..2]` in body i's frame, into `sc[3..5]` (`toLocal` without the array). */
  private loc(i: number): void {
    const sc = this.sc;
    const R = this.R;
    const r = i * 9;
    const dx = (sc[0] as number) - (this.p[i * 3] as number);
    const dy = (sc[1] as number) - (this.p[i * 3 + 1] as number);
    const dz = (sc[2] as number) - (this.p[i * 3 + 2] as number);
    sc[3] = (R[r] as number) * dx + (R[r + 3] as number) * dy + (R[r + 6] as number) * dz;
    sc[4] = (R[r + 1] as number) * dx + (R[r + 4] as number) * dy + (R[r + 7] as number) * dz;
    sc[5] = (R[r + 2] as number) * dx + (R[r + 5] as number) * dy + (R[r + 8] as number) * dz;
  }

  /** The point in body i's frame in `sc[0..2]` in world, into `sc[3..5]` (`toWorld` without the array). */
  private wor(i: number): void {
    const sc = this.sc;
    const R = this.R;
    const r = i * 9;
    const x = sc[0] as number;
    const y = sc[1] as number;
    const z = sc[2] as number;
    sc[3] = (this.p[i * 3] as number) + (R[r] as number) * x + (R[r + 1] as number) * y + (R[r + 2] as number) * z;
    sc[4] = (this.p[i * 3 + 1] as number) + (R[r + 3] as number) * x + (R[r + 4] as number) * y + (R[r + 5] as number) * z;
    sc[5] = (this.p[i * 3 + 2] as number) + (R[r + 6] as number) * x + (R[r + 7] as number) * y + (R[r + 8] as number) * z;
  }

  /** The two shapes of a contact key: a pair of shapes, or a terrain triangle and a shape. */
  private shapesOfKey(key: number): [number, number] {
    const ns = this.shapes.length;
    if (key < ns * ns) {
      const sa = Math.floor(key / ns);
      return [sa, key - sa * ns];
    }
    const k = Math.floor((key - ns * ns) / this.triMax);
    return [k % ns, Math.floor(k / ns)];
  }

  /** World point to body frame. */
  toLocal(i: number, x: number, y: number, z: number): [number, number, number] {
    const R = this.R;
    const r = i * 9;
    const dx = x - (this.p[i * 3] as number);
    const dy = y - (this.p[i * 3 + 1] as number);
    const dz = z - (this.p[i * 3 + 2] as number);
    return [
      (R[r] as number) * dx + (R[r + 3] as number) * dy + (R[r + 6] as number) * dz,
      (R[r + 1] as number) * dx + (R[r + 4] as number) * dy + (R[r + 7] as number) * dz,
      (R[r + 2] as number) * dx + (R[r + 5] as number) * dy + (R[r + 8] as number) * dz,
    ];
  }

  /** Body frame to world. */
  toWorld(i: number, x: number, y: number, z: number): [number, number, number] {
    const R = this.R;
    const r = i * 9;
    return [
      (this.p[i * 3] as number) + (R[r] as number) * x + (R[r + 1] as number) * y + (R[r + 2] as number) * z,
      (this.p[i * 3 + 1] as number) + (R[r + 3] as number) * x + (R[r + 4] as number) * y + (R[r + 5] as number) * z,
      (this.p[i * 3 + 2] as number) + (R[r + 6] as number) * x + (R[r + 7] as number) * y + (R[r + 8] as number) * z,
    ];
  }

  /* ------------------------------ solver ------------------------------ */

  private initContacts(): void {
    const v = this.pv;
    const w = this.pw;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      // two friction directions across the normal
      const nx = c.nx;
      const ny = c.ny;
      const nz = c.nz;
      if (Math.abs(nx) > 0.57) {
        const l = Math.sqrt(ny * ny + nx * nx);
        c.t1x = ny / l;
        c.t1y = -nx / l;
        c.t1z = 0;
      } else {
        const l = Math.sqrt(nz * nz + ny * ny);
        c.t1x = 0;
        c.t1y = nz / l;
        c.t1z = -ny / l;
      }
      c.t2x = ny * c.t1z - nz * c.t1y;
      c.t2y = nz * c.t1x - nx * c.t1z;
      c.t2z = nx * c.t1y - ny * c.t1x;
      let touching = false;
      const sc = this.sc;
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        sc[0] = p.ax;
        sc[1] = p.ay;
        sc[2] = p.az;
        this.wor(c.a);
        const wax = sc[3] as number;
        const way = sc[4] as number;
        const waz = sc[5] as number;
        sc[0] = p.bx;
        sc[1] = p.by;
        sc[2] = p.bz;
        this.wor(c.b);
        const wbx = sc[3] as number;
        const wby = sc[4] as number;
        const wbz = sc[5] as number;
        p.s = nx * (wbx - wax) + ny * (wby - way) + nz * (wbz - waz);
        if (p.s < 2 * SLOP) touching = true;
        const mx = 0.5 * (wax + wbx);
        const my = 0.5 * (way + wby);
        const mz = 0.5 * (waz + wbz);
        p.rax = mx - (this.p[c.a * 3] as number);
        p.ray = my - (this.p[c.a * 3 + 1] as number);
        p.raz = mz - (this.p[c.a * 3 + 2] as number);
        p.rbx = mx - (this.p[c.b * 3] as number);
        p.rby = my - (this.p[c.b * 3 + 1] as number);
        p.rbz = mz - (this.p[c.b * 3 + 2] as number);
        this.effM(c, p, 0);
        p.nm = (sc[6] as number) > 0 ? 1 / (sc[6] as number) : 0;
        this.effM(c, p, 1);
        p.t1m = (sc[6] as number) > 0 ? 1 / (sc[6] as number) : 0;
        this.effM(c, p, 2);
        p.t2m = (sc[6] as number) > 0 ? 1 / (sc[6] as number) : 0;
        // the approach speed before the step's forces, for bounces and hits
        this.rel(c, p, 0, v, w);
        p.rv = sc[7] as number;
        p.max = 0;
      }
      c.touching = touching;
    }
  }

  /**
   * 1/m_a + 1/m_b + n·((I_a⁻¹ (r_a × n)) × r_a) + the same for b, into `sc[6]`; n is the contact's normal (d = 0) or one
   * of its two friction directions (1, 2). (Numbers go through `sc`, not through arguments and results: design 11.4.)
   */
  private effM(c: Contact3, p: CPoint, d: number): void {
    const nx = d === 0 ? c.nx : d === 1 ? c.t1x : c.t2x;
    const ny = d === 0 ? c.ny : d === 1 ? c.t1y : c.t2y;
    const nz = d === 0 ? c.nz : d === 1 ? c.t1z : c.t2z;
    const I = this.invIw;
    let o = c.a * 9;
    let rx = p.rax;
    let ry = p.ray;
    let rz = p.raz;
    let cx = ry * nz - rz * ny;
    let cy = rz * nx - rx * nz;
    let cz = rx * ny - ry * nx;
    let ix = (I[o] as number) * cx + (I[o + 1] as number) * cy + (I[o + 2] as number) * cz;
    let iy = (I[o + 3] as number) * cx + (I[o + 4] as number) * cy + (I[o + 5] as number) * cz;
    let iz = (I[o + 6] as number) * cx + (I[o + 7] as number) * cy + (I[o + 8] as number) * cz;
    const ta = cx * ix + cy * iy + cz * iz;
    o = c.b * 9;
    rx = p.rbx;
    ry = p.rby;
    rz = p.rbz;
    cx = ry * nz - rz * ny;
    cy = rz * nx - rx * nz;
    cz = rx * ny - ry * nx;
    ix = (I[o] as number) * cx + (I[o + 1] as number) * cy + (I[o + 2] as number) * cz;
    iy = (I[o + 3] as number) * cx + (I[o + 4] as number) * cy + (I[o + 5] as number) * cz;
    iz = (I[o + 6] as number) * cx + (I[o + 7] as number) * cy + (I[o + 8] as number) * cz;
    const tb = cx * ix + cy * iy + cz * iz;
    this.sc[6] = (this.invM[c.a] as number) + (this.invM[c.b] as number) + ta + tb;
  }

  /** The closing speed of point p of contact c along its normal (d = 0) or a friction direction (1, 2), from speeds `v` and `w`, into `sc[7]`. */
  private rel(c: Contact3, p: CPoint, d: number, v: Float64Array, w: Float64Array): void {
    const a = c.a;
    const b = c.b;
    const nx = d === 0 ? c.nx : d === 1 ? c.t1x : c.t2x;
    const ny = d === 0 ? c.ny : d === 1 ? c.t1y : c.t2y;
    const nz = d === 0 ? c.nz : d === 1 ? c.t1z : c.t2z;
    const vax = (v[a * 3] as number) + (w[a * 3 + 1] as number) * p.raz - (w[a * 3 + 2] as number) * p.ray;
    const vay = (v[a * 3 + 1] as number) + (w[a * 3 + 2] as number) * p.rax - (w[a * 3] as number) * p.raz;
    const vaz = (v[a * 3 + 2] as number) + (w[a * 3] as number) * p.ray - (w[a * 3 + 1] as number) * p.rax;
    const vbx = (v[b * 3] as number) + (w[b * 3 + 1] as number) * p.rbz - (w[b * 3 + 2] as number) * p.rby;
    const vby = (v[b * 3 + 1] as number) + (w[b * 3 + 2] as number) * p.rbx - (w[b * 3] as number) * p.rbz;
    const vbz = (v[b * 3 + 2] as number) + (w[b * 3] as number) * p.rby - (w[b * 3 + 1] as number) * p.rbx;
    this.sc[7] = nx * (vbx - vax) + ny * (vby - vay) + nz * (vbz - vaz);
  }

  /** The impulse in `sc[9..11]` applied at point p of contact c: −λ on a, +λ on b (`applyAt` with the numbers in slots). */
  private pushAt(c: Contact3, p: CPoint): void {
    const sc = this.sc;
    const a = c.a;
    const b = c.b;
    const x = sc[9] as number;
    const y = sc[10] as number;
    const z = sc[11] as number;
    const ma = this.invM[a] as number;
    const mb = this.invM[b] as number;
    const v = this.v;
    v[a * 3] = (v[a * 3] as number) - ma * x;
    v[a * 3 + 1] = (v[a * 3 + 1] as number) - ma * y;
    v[a * 3 + 2] = (v[a * 3 + 2] as number) - ma * z;
    v[b * 3] = (v[b * 3] as number) + mb * x;
    v[b * 3 + 1] = (v[b * 3 + 1] as number) + mb * y;
    v[b * 3 + 2] = (v[b * 3 + 2] as number) + mb * z;
    const I = this.invIw;
    const w = this.w;
    let tx = p.ray * z - p.raz * y;
    let ty = p.raz * x - p.rax * z;
    let tz = p.rax * y - p.ray * x;
    let o = a * 9;
    w[a * 3] = (w[a * 3] as number) + -1 * ((I[o] as number) * tx + (I[o + 1] as number) * ty + (I[o + 2] as number) * tz);
    w[a * 3 + 1] = (w[a * 3 + 1] as number) + -1 * ((I[o + 3] as number) * tx + (I[o + 4] as number) * ty + (I[o + 5] as number) * tz);
    w[a * 3 + 2] = (w[a * 3 + 2] as number) + -1 * ((I[o + 6] as number) * tx + (I[o + 7] as number) * ty + (I[o + 8] as number) * tz);
    tx = p.rby * z - p.rbz * y;
    ty = p.rbz * x - p.rbx * z;
    tz = p.rbx * y - p.rby * x;
    o = b * 9;
    w[b * 3] = (w[b * 3] as number) + 1 * ((I[o] as number) * tx + (I[o + 1] as number) * ty + (I[o + 2] as number) * tz);
    w[b * 3 + 1] = (w[b * 3 + 1] as number) + 1 * ((I[o + 3] as number) * tx + (I[o + 4] as number) * ty + (I[o + 5] as number) * tz);
    w[b * 3 + 2] = (w[b * 3 + 2] as number) + 1 * ((I[o + 6] as number) * tx + (I[o + 7] as number) * ty + (I[o + 8] as number) * tz);
  }

  /** Applies impulse λ along (x, y, z) at a point: −λ on a, +λ on b. */
  applyAt(a: number, b: number, rax: number, ray: number, raz: number, rbx: number, rby: number, rbz: number, x: number, y: number, z: number): void {
    const ma = this.invM[a] as number;
    const mb = this.invM[b] as number;
    this.v[a * 3] = (this.v[a * 3] as number) - ma * x;
    this.v[a * 3 + 1] = (this.v[a * 3 + 1] as number) - ma * y;
    this.v[a * 3 + 2] = (this.v[a * 3 + 2] as number) - ma * z;
    this.v[b * 3] = (this.v[b * 3] as number) + mb * x;
    this.v[b * 3 + 1] = (this.v[b * 3 + 1] as number) + mb * y;
    this.v[b * 3 + 2] = (this.v[b * 3 + 2] as number) + mb * z;
    turn(this.invIw, this.w, a, -1, ray * z - raz * y, raz * x - rax * z, rax * y - ray * x);
    turn(this.invIw, this.w, b, 1, rby * z - rbz * y, rbz * x - rbx * z, rbx * y - rby * x);
  }

  private warmStart(): void {
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        const x = p.ni * c.nx + p.t1i * c.t1x + p.t2i * c.t2x;
        const y = p.ni * c.ny + p.t1i * c.t1y + p.t2i * c.t2y;
        const z = p.ni * c.nz + p.t1i * c.t1z + p.t2i * c.t2z;
        if (x !== 0 || y !== 0 || z !== 0) {
          this.sc[9] = x;
          this.sc[10] = y;
          this.sc[11] = z;
          this.pushAt(c, p);
        }
      }
    }
  }

  /* ------------------------------ the soft step (design 6.5) ------------------------------ */

  /** Small steps a step: half the passes, rounded up (4 at the default 8). */
  get substeps(): number {
    return Math.max(1, Math.ceil(this.passes / 2));
  }

  /** The speeds before a small step's forces (for the bounces), and the soft contact numbers of the small steps. */
  private pfv = new Float64Array(0);
  private pfw = new Float64Array(0);
  private softBias = 0;
  private softMass = 1;
  private softImp = 0;
  private wallBias = 0;
  private wallMass = 1;
  private wallImp = 0;

  /** The small step's length and its inverse, set by `step` (fields, not arguments). */
  private hsNow = 0;
  private invHs = 0;

  private beginSoft(): void {
    const hs = this.hsNow;
    if (this.pfv.length !== this.v.length) {
      this.pfv = new Float64Array(this.v.length);
      this.pfw = new Float64Array(this.w.length);
    }
    // a contact is a stiff, heavily damped spring: 30 Hz (at most a quarter of the small steps' rate), damping ratio 10
    // (the numbers of a spring of frequency f are worked out in line, twice: no closure, no array, no call)
    const hz = Math.min(CONTACT_HERTZ, 0.25 / hs);
    const om1 = 2 * Math.PI * hz;
    const a11 = 2 * CONTACT_DAMPING + hs * om1;
    const a21 = hs * om1 * a11;
    const a31 = 1 / (1 + a21);
    this.softBias = om1 / a11;
    this.softMass = a21 * a31;
    this.softImp = a31;
    const om2 = 2 * Math.PI * (2 * hz);
    const a12 = 2 * CONTACT_DAMPING + hs * om2;
    const a22 = hs * om2 * a12;
    const a32 = 1 / (1 + a22);
    this.wallBias = om2 / a12;
    this.wallMass = a22 * a32;
    this.wallImp = a32;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        p.tn = p.t1t = p.t2t = 0;
        p.max = 0;
        p.bounced = 0;
      }
    }
  }

  /** Gravity, steady forces, torques, drag, and the step's pushes spread over its small steps, into the speeds. */
  private integrateForces(first: boolean, S: number): void {
    const hs = this.hsNow;
    const n = this.n;
    const damp = 1 / (1 + hs * this.air);
    const g0 = this.gx;
    const g1 = this.gy;
    const g2 = this.gz;
    const I = this.invIw;
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType3.Dynamic || this.awake[i] === 0) continue;
      const m = this.mass[i] as number;
      const im = this.invM[i] as number;
      for (let a = 0; a < 3; a++) {
        const o = i * 3 + a;
        const g = a === 0 ? g0 : a === 1 ? g1 : g2;
        const f = i * NK * 3;
        if (first) {
          this.forces[f + FK3.gravity * 3 + a] = m * g;
          this.forces[f + FK3.applied * 3 + a] = this.force[o] as number;
        }
        let vv = (this.v[o] as number) + hs * (g + im * (this.force[o] as number)) + (im * (this.impulse[o] as number)) / S;
        if (this.air > 0) {
          // the drag force, the mean over the small steps
          this.forces[f + FK3.drag * 3 + a] = (first ? 0 : (this.forces[f + FK3.drag * 3 + a] as number)) + (m * vv * (damp - 1)) / hs / S;
          vv *= damp;
        }
        this.v[o] = vv;
      }
      // turning: ω += hs I⁻¹ τ
      const tx = this.torque[i * 3] as number;
      const ty = this.torque[i * 3 + 1] as number;
      const tz = this.torque[i * 3 + 2] as number;
      for (let a = 0; a < 3; a++) {
        const s = (I[i * 9 + a * 3] as number) * tx + (I[i * 9 + a * 3 + 1] as number) * ty + (I[i * 9 + a * 3 + 2] as number) * tz;
        this.w[i * 3 + a] = ((this.w[i * 3 + a] as number) + hs * s) * (this.air > 0 ? damp : 1);
      }
    }
  }

  /** Positions and turns move by speed times the small step. */
  private integratePositions(): void {
    const hs = this.hsNow;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType3.Dynamic || this.awake[i] === 0) continue;
      for (let a = 0; a < 3; a++) this.p[i * 3 + a] = (this.p[i * 3 + a] as number) + hs * (this.v[i * 3 + a] as number);
      const o = i * 4;
      const wx = this.w[i * 3] as number;
      const wy = this.w[i * 3 + 1] as number;
      const wz = this.w[i * 3 + 2] as number;
      const qw = this.q[o] as number;
      const qx = this.q[o + 1] as number;
      const qy = this.q[o + 2] as number;
      const qz = this.q[o + 3] as number;
      const k = 0.5 * hs;
      this.q[o] = qw + k * (-wx * qx - wy * qy - wz * qz);
      this.q[o + 1] = qx + k * (wx * qw + wy * qz - wz * qy);
      this.q[o + 2] = qy + k * (-wx * qz + wy * qw + wz * qx);
      this.q[o + 3] = qz + k * (wx * qy - wy * qx + wz * qw);
      this.setRot(i);
    }
  }

  /** Point p's gap now: its two anchors at the bodies' poses now, along the contact's normal; into `sc[8]`. */
  private gapOf(c: Contact3, p: CPoint): void {
    const R = this.R;
    const a = c.a;
    const b = c.b;
    const ra = a * 9;
    const rb = b * 9;
    const ax = (this.p[a * 3] as number) + (R[ra] as number) * p.ax + (R[ra + 1] as number) * p.ay + (R[ra + 2] as number) * p.az;
    const ay = (this.p[a * 3 + 1] as number) + (R[ra + 3] as number) * p.ax + (R[ra + 4] as number) * p.ay + (R[ra + 5] as number) * p.az;
    const az = (this.p[a * 3 + 2] as number) + (R[ra + 6] as number) * p.ax + (R[ra + 7] as number) * p.ay + (R[ra + 8] as number) * p.az;
    const bx = (this.p[b * 3] as number) + (R[rb] as number) * p.bx + (R[rb + 1] as number) * p.by + (R[rb + 2] as number) * p.bz;
    const by = (this.p[b * 3 + 1] as number) + (R[rb + 3] as number) * p.bx + (R[rb + 4] as number) * p.by + (R[rb + 5] as number) * p.bz;
    const bz = (this.p[b * 3 + 2] as number) + (R[rb + 6] as number) * p.bx + (R[rb + 7] as number) * p.by + (R[rb + 8] as number) * p.bz;
    this.sc[8] = c.nx * (bx - ax) + c.ny * (by - ay) + c.nz * (bz - az);
  }

  /** Each point's closing speed after the small step's forces; for a point fast enough to bounce, before them and its gap. */
  private closingSpeeds(): void {
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      if (c.restitution === 0) continue;
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        this.rel(c, p, 0, this.v, this.w);
        p.sf = this.sc[7] as number;
        if (p.sf <= -RESTITUTION_THRESHOLD) {
          this.rel(c, p, 0, this.pfv, this.pfw);
          p.sv = this.sc[7] as number;
          this.gapOf(c, p);
          p.sg = this.sc[8] as number;
        } else {
          p.sv = p.sf;
          p.sg = 0;
        }
      }
    }
  }

  /**
   * One pass over the contacts in a small step: friction first, then the push of each point. With `bias`, a point that
   * overlaps is pushed out softly (at most 3 m/s); without (the relax pass), only to a standstill. A point with a gap may
   * close it within the small step, but not go below zero (speculative).
   */
  private solveSoft(bias: boolean): void {
    const inv_hs = this.invHs;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      const wall = this.type[c.a] !== BodyType3.Dynamic || this.type[c.b] !== BodyType3.Dynamic;
      const sBias = wall ? this.wallBias : this.softBias;
      const sMass = wall ? this.wallMass : this.softMass;
      const sImp = wall ? this.wallImp : this.softImp;
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        // friction in two directions, a box of μ times the push
        const maxF = c.friction * p.ni;
        {
          this.rel(c, p, 1, this.v, this.w);
          const vt = this.sc[7] as number;
          const old = p.t1i;
          const nw = Math.max(-maxF, Math.min(maxF, old - p.t1m * vt));
          const d = nw - old;
          p.t1i = nw;
          if (d !== 0) {
            this.sc[9] = d * c.t1x;
            this.sc[10] = d * c.t1y;
            this.sc[11] = d * c.t1z;
            this.pushAt(c, p);
          }
        }
        {
          this.rel(c, p, 2, this.v, this.w);
          const vt = this.sc[7] as number;
          const old = p.t2i;
          const nw = Math.max(-maxF, Math.min(maxF, old - p.t2m * vt));
          const d = nw - old;
          p.t2i = nw;
          if (d !== 0) {
            this.sc[9] = d * c.t2x;
            this.sc[10] = d * c.t2y;
            this.sc[11] = d * c.t2z;
            this.pushAt(c, p);
          }
        }
      }
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        this.gapOf(c, p);
        const s = this.sc[8] as number;
        this.rel(c, p, 0, this.v, this.w);
        const vn = this.sc[7] as number;
        // the relax pass leaves a fast point with a gap to a wall alone if it bounces: it meets in the next small step
        // and bounces there with its full speed
        if (!bias && wall && s > 0 && c.restitution > 0 && vn <= -RESTITUTION_THRESHOLD) continue;
        let bv = 0;
        let ms = 1;
        let is = 0;
        if (s > 0) bv = s * inv_hs;
        else if (bias) {
          bv = Math.max(sBias * s, -MAX_PUSH_OUT);
          ms = sMass;
          is = sImp;
        }
        const old = p.ni;
        const nw = Math.max(0, old - p.nm * ms * (vn + bv) - is * old);
        p.ni = nw;
        const d = nw - old;
        if (d !== 0) {
          this.sc[9] = d * c.nx;
          this.sc[10] = d * c.ny;
          this.sc[11] = d * c.nz;
          this.pushAt(c, p);
        }
      }
    }
  }

  /**
   * Bounces of contact c's points that qualify: each point's speed apart reaches `bounce` × its closing speed before
   * the small step's forces. The points of a face are solved together by a few passes over them with the bounce
   * impulses added up and kept at zero or more (one pass, point after point, gave the first corner the bounce and set a
   * landing box spinning). The bounce is not kept for warm starting.
   */
  private bounceContact(c: Contact3, wallStep: boolean): void {
    let any = false;
    for (let kp = 0; kp < c.pts.length; kp++) {
      const p = c.pts[kp] as CPoint;
      p.bi = 0;
      const q = p.bounced === 0 && (wallStep ? p.sf <= -RESTITUTION_THRESHOLD && p.sg + this.hsNow * p.sf < 0 : p.sv <= -RESTITUTION_THRESHOLD && p.ni > 0);
      if (q) {
        p.bounced = 2;
        any = true;
      }
    }
    if (!any) return;
    for (let it = 0; it < 8; it++) {
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        if (p.bounced !== 2) continue;
        this.rel(c, p, 0, this.v, this.w);
        const vn = this.sc[7] as number;
        const target = -c.restitution * p.sv;
        const nw = Math.max(0, p.bi + p.nm * (target - vn));
        const d = nw - p.bi;
        p.bi = nw;
        if (d !== 0) {
          this.sc[9] = d * c.nx;
          this.sc[10] = d * c.ny;
          this.sc[11] = d * c.nz;
          this.pushAt(c, p);
        }
      }
    }
    for (let kp = 0; kp < c.pts.length; kp++) {
      const p = c.pts[kp] as CPoint;
      if (p.bounced !== 2) continue;
      p.bounced = 1;
      p.tn += p.bi;
      if (p.bi > p.max) p.max = p.bi;
    }
  }

  /** Off a wall: a point that would go through its gap in this small step turns back now, before it moves. */
  private bounceWalls(): void {
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      if (c.restitution === 0) continue;
      if (this.type[c.a] === BodyType3.Dynamic && this.type[c.b] === BodyType3.Dynamic) continue;
      this.bounceContact(c, true);
    }
  }

  /** Between two bodies: after the relax pass of the small step where a point first pushes (turning back before the move let a falling stack sink and fall over). */
  private bounceBodies(): void {
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      if (c.restitution === 0 || this.type[c.a] !== BodyType3.Dynamic || this.type[c.b] !== BodyType3.Dynamic) continue;
      this.bounceContact(c, false);
    }
  }

  /** After a small step: its impulses go into the step's totals and the largest push. */
  private addUpImpulses(): void {
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        p.tn += p.ni;
        p.t1t += p.t1i;
        p.t2t += p.t2i;
        if (p.ni > p.max) p.max = p.ni;
      }
    }
  }

  /** A position-pass impulse: moves and turns a and b without touching their speeds. */
  movePose(a: number, b: number, q: { rax: number; ray: number; raz: number; rbx: number; rby: number; rbz: number }, x: number, y: number, z: number): void {
    for (const [i, sgn, rx, ry, rz] of [[a, -1, q.rax, q.ray, q.raz], [b, 1, q.rbx, q.rby, q.rbz]] as const) {
      if (this.type[i] !== BodyType3.Dynamic) continue;
      const m = this.invM[i] as number;
      this.p[i * 3] = (this.p[i * 3] as number) + sgn * m * x;
      this.p[i * 3 + 1] = (this.p[i * 3 + 1] as number) + sgn * m * y;
      this.p[i * 3 + 2] = (this.p[i * 3 + 2] as number) + sgn * m * z;
      // a small turn by I⁻¹ (r × P)
      const tx = ry * z - rz * y;
      const ty = rz * x - rx * z;
      const tz = rx * y - ry * x;
      const I = this.invIw;
      const o = i * 9;
      const dx = sgn * ((I[o] as number) * tx + (I[o + 1] as number) * ty + (I[o + 2] as number) * tz);
      const dy = sgn * ((I[o + 3] as number) * tx + (I[o + 4] as number) * ty + (I[o + 5] as number) * tz);
      const dz = sgn * ((I[o + 6] as number) * tx + (I[o + 7] as number) * ty + (I[o + 8] as number) * tz);
      const k = i * 4;
      const qw = this.q[k] as number;
      const qx = this.q[k + 1] as number;
      const qy = this.q[k + 2] as number;
      const qz = this.q[k + 3] as number;
      this.q[k] = qw + 0.5 * (-dx * qx - dy * qy - dz * qz);
      this.q[k + 1] = qx + 0.5 * (dx * qw + dy * qz - dz * qy);
      this.q[k + 2] = qy + 0.5 * (-dx * qz + dy * qw + dz * qx);
      this.q[k + 3] = qz + 0.5 * (dx * qy - dy * qx + dz * qw);
      this.setRot(i);
    }
  }

  /* ------------------------------ sleep, forces, hits ------------------------------ */

  private parent = new Int32Array(0);

  private find(i: number): number {
    const p = this.parent;
    let r = i;
    while (p[r] !== r) r = p[r] as number;
    while (p[i] !== r) {
      const nx = p[i] as number;
      p[i] = r;
      i = nx;
    }
    return r;
  }

  private islands(): void {
    const n = this.n;
    if (this.parent.length !== n) this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
    for (let k = 0; k < this.contacts.length; k++) {
      const c = this.contacts[k] as Contact3;
      if (c.pts.length > 0) this.join(c.a, c.b);
    }
    for (let k = 0; k < this.joints.length; k++) {
      const j = this.joints[k] as Joint3;
      if (!j.broken) this.join(j.a, j.b);
    }
  }

  /** Puts the islands of bodies a and b together (two dynamic bodies only). */
  private join(a: number, b: number): void {
    if (this.type[a] !== BodyType3.Dynamic || this.type[b] !== BodyType3.Dynamic) return;
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }

  /** Scratch of the sleep passes: which islands are awake, and each island's least sleep time. */
  private awakeIsland = new Uint8Array(0);
  private minT = new Float64Array(0);

  private wakeTouched(): void {
    if (!this.sleeping) return;
    this.islands();
    const n = this.n;
    if (this.awakeIsland.length !== n) this.awakeIsland = new Uint8Array(n);
    const awakeIsland = this.awakeIsland;
    awakeIsland.fill(0);
    for (let i = 0; i < n; i++) if (this.type[i] === BodyType3.Dynamic && this.awake[i] === 1) awakeIsland[this.find(i)] = 1;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      if (this.type[c.a] === BodyType3.Kinematic && this.isMoving(c.a) && this.type[c.b] === BodyType3.Dynamic) awakeIsland[this.find(c.b)] = 1;
      if (this.type[c.b] === BodyType3.Kinematic && this.isMoving(c.b) && this.type[c.a] === BodyType3.Dynamic) awakeIsland[this.find(c.a)] = 1;
    }
    for (let i = 0; i < n; i++) if (this.type[i] === BodyType3.Dynamic && this.awake[i] === 0 && awakeIsland[this.find(i)] === 1) this.wakeBody(i);
  }

  wakeBody(i: number): void {
    if (this.type[i] !== BodyType3.Dynamic) return;
    this.awake[i] = 1;
    this.sleepTime[i] = 0;
  }

  sleepBody(i: number): void {
    if (this.type[i] !== BodyType3.Dynamic) return;
    this.awake[i] = 0;
    this.sleepTime[i] = TIME_TO_SLEEP;
    this.v.fill(0, i * 3, i * 3 + 3);
    this.w.fill(0, i * 3, i * 3 + 3);
  }

  private sleepIslands(): void {
    const h = this.hStep;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType3.Dynamic || this.awake[i] === 0) continue;
      const v2 = (this.v[i * 3] as number) ** 2 + (this.v[i * 3 + 1] as number) ** 2 + (this.v[i * 3 + 2] as number) ** 2;
      const w2 = (this.w[i * 3] as number) ** 2 + (this.w[i * 3 + 1] as number) ** 2 + (this.w[i * 3 + 2] as number) ** 2;
      const pushed = this.force[i * 3] !== 0 || this.force[i * 3 + 1] !== 0 || this.force[i * 3 + 2] !== 0;
      if (v2 > SLEEP_LIN * SLEEP_LIN || w2 > SLEEP_ANG * SLEEP_ANG || pushed) this.sleepTime[i] = 0;
      else this.sleepTime[i] = (this.sleepTime[i] as number) + h;
    }
    this.islands();
    if (this.minT.length !== n) this.minT = new Float64Array(n);
    const minT = this.minT;
    minT.fill(Infinity);
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType3.Dynamic || this.awake[i] === 0) continue;
      const r = this.find(i);
      minT[r] = Math.min(minT[r] as number, this.sleepTime[i] as number);
    }
    for (let i = 0; i < n; i++) if (this.type[i] === BodyType3.Dynamic && this.awake[i] === 1 && (minT[this.find(i)] as number) >= TIME_TO_SLEEP) this.sleepBody(i);
  }

  private countForces(v0: Float64Array): void {
    const inv_h = 1 / this.hStep;
    const inv_hs = this.invHs;
    const forces = this.forces;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      let ni = 0;
      let f1 = 0;
      let f2 = 0;
      // the step's impulses, added up over its small steps
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        ni += p.tn;
        f1 += p.t1t;
        f2 += p.t2t;
      }
      const nx = ni * c.nx * inv_h;
      const ny = ni * c.ny * inv_h;
      const nz = ni * c.nz * inv_h;
      const fx = (f1 * c.t1x + f2 * c.t2x) * inv_h;
      const fy = (f1 * c.t1y + f2 * c.t2y) * inv_h;
      const fz = (f1 * c.t1z + f2 * c.t2z) * inv_h;
      // each body that is awake and dynamic gets its part of the normal and friction forces (in line: a call with these numbers makes heap numbers)
      if (this.type[c.b] === BodyType3.Dynamic && this.awake[c.b] !== 0) {
        const o = c.b * NK * 3 + FK3.normal * 3;
        forces[o] = (forces[o] as number) + nx;
        forces[o + 1] = (forces[o + 1] as number) + ny;
        forces[o + 2] = (forces[o + 2] as number) + nz;
      }
      if (this.type[c.a] === BodyType3.Dynamic && this.awake[c.a] !== 0) {
        const o = c.a * NK * 3 + FK3.normal * 3;
        forces[o] = (forces[o] as number) + -nx;
        forces[o + 1] = (forces[o + 1] as number) + -ny;
        forces[o + 2] = (forces[o + 2] as number) + -nz;
      }
      if (this.type[c.b] === BodyType3.Dynamic && this.awake[c.b] !== 0) {
        const o = c.b * NK * 3 + FK3.friction * 3;
        forces[o] = (forces[o] as number) + fx;
        forces[o + 1] = (forces[o + 1] as number) + fy;
        forces[o + 2] = (forces[o + 2] as number) + fz;
      }
      if (this.type[c.a] === BodyType3.Dynamic && this.awake[c.a] !== 0) {
        const o = c.a * NK * 3 + FK3.friction * 3;
        forces[o] = (forces[o] as number) + -fx;
        forces[o + 1] = (forces[o + 1] as number) + -fy;
        forces[o + 2] = (forces[o + 2] as number) + -fz;
      }
    }
    for (let k = 0; k < this.joints.length; k++) {
      const j = this.joints[k] as Joint3;
      if (j.broken) continue;
      if (j.breaks > 0 && Math.abs(j.impulse) * inv_hs > j.breaks) j.broken = true;
      else j.account?.(this, inv_hs);
    }
    for (let i = 0; i < this.n; i++) {
      if (this.type[i] !== BodyType3.Dynamic || this.awake[i] === 0) continue;
      const m = this.mass[i] as number;
      for (let a = 0; a < 3; a++) {
        const o = i * NK * 3;
        this.forces[o + FK3.net * 3 + a] = m * ((this.v[i * 3 + a] as number) - (v0[i * 3 + a] as number)) * inv_h;
      }
    }
  }

  private collectHits(): void {
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      let pushing = false;
      let rv = 0;
      let imp = 0;
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        if (p.max > 0) pushing = true;
        if (p.rv < rv) rv = p.rv;
        imp += p.tn;
      }
      const was = c.pushed;
      c.pushed = pushing;
      if (!pushing || was || !(-rv > HIT_THRESHOLD)) continue;
      const p0 = c.pts[0] as CPoint;
      const wb = this.toWorld(c.b, p0.bx, p0.by, p0.bz);
      this.hits.push({ a: c.a, b: c.b, speed: -rv, x: wb[0], y: wb[1], z: wb[2], impulse: imp });
    }
  }

  /**
   * Keeps what the cloth did to body b this step out of the fixed shapes (ground, terrain, static or kinematic bodies) it
   * touches, from the contacts the world found this step (design 9.5). `io` holds the cloth's move of the body in 0..2 and
   * its speed in 3..5. For each touching contact, in the world's order, with the normal n out of the fixed shape: the part of
   * the move along -n and of the speed along -n is taken out. Returns true if it changed `io`.
   */
  keepOut(b: number, io: Float64Array): boolean {
    let changed = false;
    const cs = this.contacts;
    // (indexed: a `for … of` makes an iterator on the heap, garbage, in every step before the engine optimises it)
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k] as (typeof cs)[number];
      if (!c.touching) continue;
      let s: number;
      if (c.b === b && this.type[c.a] !== BodyType3.Dynamic) s = 1;
      else if (c.a === b && this.type[c.b] !== BodyType3.Dynamic) s = -1;
      else continue;
      const nx = s * c.nx;
      const ny = s * c.ny;
      const nz = s * c.nz;
      const dn = (io[0] as number) * nx + (io[1] as number) * ny + (io[2] as number) * nz;
      if (dn < 0) {
        io[0] = (io[0] as number) - dn * nx;
        io[1] = (io[1] as number) - dn * ny;
        io[2] = (io[2] as number) - dn * nz;
        changed = true;
      }
      const vn = (io[3] as number) * nx + (io[4] as number) * ny + (io[5] as number) * nz;
      if (vn < 0) {
        io[3] = (io[3] as number) - vn * nx;
        io[4] = (io[4] as number) - vn * ny;
        io[5] = (io[5] as number) - vn * nz;
        changed = true;
      }
    }
    return changed;
  }

  /** Each body's touching bodies, ascending. The lists are the world's own and are refilled by the next call: read them before it. */
  private touchLists: number[][] = [];

  /** Adds a touching contact's two bodies to each other's list (`Map.forEach` with a closure made once: no iterator). */
  private readonly addTouch = (c: Contact3): void => {
    if (!c.touching) return;
    const out = this.touchLists;
    const la = out[c.a] as number[];
    const lb = out[c.b] as number[];
    if (!la.includes(c.b)) la.push(c.b);
    if (!lb.includes(c.a)) lb.push(c.a);
  };

  touchingAll(): number[][] {
    const out = this.touchLists;
    while (out.length < this.n) out.push([]);
    out.length = this.n;
    for (let i = 0; i < this.n; i++) (out[i] as number[]).length = 0;
    for (let q = 0; q < this.contactMap.size; q++) this.addTouch(this.contactMap.list[q] as Contact3);
    for (let i = 0; i < this.n; i++) {
      const l = out[i] as number[];
      if (l.length > 1) l.sort(ascending);
    }
    return out;
  }

  private contactTotal = 0;
  private readonly countContact = (c: Contact3): void => {
    if (c.touching) this.contactTotal += c.pts.length;
  };

  get contactCount(): number {
    this.contactTotal = 0;
    for (let q = 0; q < this.contactMap.size; q++) this.countContact(this.contactMap.list[q] as Contact3);
    return this.contactTotal;
  }

  awakeCount(): number {
    let k = 0;
    for (let i = 0; i < this.n; i++) if (this.type[i] === BodyType3.Dynamic && this.awake[i] === 1) k++;
    return k;
  }

  kinetic(i: number): number {
    const m = this.mass[i] as number;
    let ke = 0.5 * m * ((this.v[i * 3] as number) ** 2 + (this.v[i * 3 + 1] as number) ** 2 + (this.v[i * 3 + 2] as number) ** 2);
    // ½ ωᵀ I ω with I in world: R I_l Rᵀ, so ½ (Rᵀω)ᵀ I_l (Rᵀω)
    const R = this.R;
    const r = i * 9;
    const wx = this.w[i * 3] as number;
    const wy = this.w[i * 3 + 1] as number;
    const wz = this.w[i * 3 + 2] as number;
    const lw = [(R[r] as number) * wx + (R[r + 3] as number) * wy + (R[r + 6] as number) * wz, (R[r + 1] as number) * wx + (R[r + 4] as number) * wy + (R[r + 7] as number) * wz, (R[r + 2] as number) * wx + (R[r + 5] as number) * wy + (R[r + 8] as number) * wz];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) ke += 0.5 * (lw[a] as number) * (this.Il[r + a * 3 + b] as number) * (lw[b] as number);
    return ke;
  }

  forceOf(i: number, k: number): [number, number, number] {
    const o = i * NK * 3 + k * 3;
    return [this.forces[o] as number, this.forces[o + 1] as number, this.forces[o + 2] as number];
  }

  contactPoints(): { x: number; y: number; z: number; nx: number; ny: number; nz: number }[] {
    const out: { x: number; y: number; z: number; nx: number; ny: number; nz: number }[] = [];
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact3;
      if (!c.touching) continue;
      for (let kp = 0; kp < c.pts.length; kp++) {
        const p = c.pts[kp] as CPoint;
        const wb = this.toWorld(c.b, p.bx, p.by, p.bz);
        out.push({ x: wb[0], y: wb[1], z: wb[2], nx: c.nx, ny: c.ny, nz: c.nz });
      }
    }
    return out;
  }

  /** Corners of a hull shape of body i in world space (for drawing); empty for spheres and planes. */
  hullOf(i: number): { verts: Float64Array; faces: readonly Int32Array[] } | undefined {
    const s = this.shapes[this.shape0[i] as number];
    if (!s || s.kind !== 1) return undefined;
    return { verts: s.wv, faces: s.faces };
  }

  /* ------------------------------ checkpoints ------------------------------ */

  save(): Float64Array {
    const out: number[] = [this.stepIndex, this.n];
    for (let i = 0; i < this.n; i++) {
      for (let a = 0; a < 3; a++) out.push(this.p[i * 3 + a] as number);
      for (let a = 0; a < 4; a++) out.push(this.q[i * 4 + a] as number);
      for (let a = 0; a < 3; a++) out.push(this.v[i * 3 + a] as number);
      for (let a = 0; a < 3; a++) out.push(this.w[i * 3 + a] as number);
      out.push(this.sleepTime[i] as number, this.awake[i] as number, this.type[i] as number);
    }
    out.push(this.contactMap.size);
    for (let q = 0; q < this.contactMap.size; q++) {
      const c = this.contactMap.list[q] as Contact3;
      out.push(c.key, c.pts.length, (c.pushed ? 2 : 0) + (c.touching ? 1 : 0), c.nx, c.ny, c.nz);
      for (const p of c.pts) out.push(p.ax, p.ay, p.az, p.bx, p.by, p.bz, p.ni, p.t1i, p.t2i);
    }
    out.push(this.joints.length);
    for (const j of this.joints) {
      out.push(j.broken ? 1 : 0);
      j.save(out);
    }
    out.push(this.gone.size, ...[...this.gone].sort((x, y) => x - y));
    return Float64Array.from(out);
  }

  load(s: Float64Array): void {
    let k = 0;
    this.stepIndex = s[k++] as number;
    const n = s[k++] as number;
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 3; a++) this.p[i * 3 + a] = s[k++] as number;
      for (let a = 0; a < 4; a++) this.q[i * 4 + a] = s[k++] as number;
      for (let a = 0; a < 3; a++) this.v[i * 3 + a] = s[k++] as number;
      for (let a = 0; a < 3; a++) this.w[i * 3 + a] = s[k++] as number;
      this.sleepTime[i] = s[k++] as number;
      this.awake[i] = s[k++] as number;
      this.type[i] = s[k++] as number;
    }
    this.contactMap = new ContactTable3();
    this.contacts = [];
    const nc = s[k++] as number;
    for (let i = 0; i < nc; i++) {
      const key = s[k++] as number;
      const np = s[k++] as number;
      const flags = s[k++] as number;
      const [sa, sb] = this.shapesOfKey(key);
      const c: Contact3 = { stamp: 0, key, a: (this.shapes[sa] as Shape3).body, b: (this.shapes[sb] as Shape3).body, sa, sb, nx: s[k++] as number, ny: s[k++] as number, nz: s[k++] as number, pts: [], friction: 0, restitution: 0, pushed: (flags & 2) === 2, touching: (flags & 1) === 1, t1x: 0, t1y: 0, t1z: 0, t2x: 0, t2y: 0, t2z: 0 };
      for (let q = 0; q < np; q++) {
        c.pts.push({ ax: s[k++] as number, ay: s[k++] as number, az: s[k++] as number, bx: s[k++] as number, by: s[k++] as number, bz: s[k++] as number, s: 0, ni: s[k++] as number, t1i: s[k++] as number, t2i: s[k++] as number, rax: 0, ray: 0, raz: 0, rbx: 0, rby: 0, rbz: 0, nm: 0, t1m: 0, t2m: 0, rv: 0, max: 0, tn: 0, t1t: 0, t2t: 0, sv: 0, sf: 0, sg: 0, bi: 0, bounced: 0 });
      }
      this.contactMap.set(c);
    }
    const nj = s[k++] as number;
    for (let i = 0; i < nj && i < this.joints.length; i++) {
      const j = this.joints[i] as Joint3;
      j.broken = s[k++] === 1;
      k = j.load(s, k);
    }
    const ng = s[k++] as number;
    this.gone = new Set();
    for (let i = 0; i < ng; i++) this.gone.add(s[k++] as number);
    // a body that left, broke loose or blew up later in the film is back with its mass; one gone by now has none
    for (let i = 0; i < this.n; i++) {
      const out = this.gone.has(i);
      this.invM[i] = out ? 0 : (this.invM0[i] as number);
      if (out) this.invIl.fill(0, i * 9, i * 9 + 9);
      else this.invIl.set(this.invIl0.subarray(i * 9, i * 9 + 9), i * 9);
      this.setRot(i);
      if (out) {
        const s0 = this.shape0[i] as number;
        for (let q = s0; q < s0 + (this.shapeN[i] as number); q++) {
          this.lo[q * 3] = Infinity;
          this.hi[q * 3] = -Infinity;
        }
      } else this.updateShapes(i);
    }
  }
}

/* ------------------------------ helpers ------------------------------ */

const ascending = (x: number, y: number): number => x - y;

/** A contact point with nothing in it. */
function newPoint(): CPoint {
  return { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, s: 0, ni: 0, t1i: 0, t2i: 0, rax: 0, ray: 0, raz: 0, rbx: 0, rby: 0, rbz: 0, nm: 0, t1m: 0, t2m: 0, rv: 0, max: 0, tn: 0, t1t: 0, t2t: 0, sv: 0, sf: 0, sg: 0, bi: 0, bounced: 0 };
}

/**
 * The contacts by key, in the order they were put (the order a checkpoint saves them in). A `Map` that is cleared every
 * step makes a new table each time (design 11.4); this one is two arrays, written over (the plane's `ContactTable`).
 */
class ContactTable3 {
  /** The contacts in the order put; `size` of them. */
  readonly list: Contact3[] = [];
  size = 0;
  private slots = new Int32Array(64);
  private mask = 63;

  private slotOf(key: number): number {
    let s = Math.imul(key | 0, 0x9e3779b1) >>> 0;
    s = (s ^ (s >>> 15)) & this.mask;
    return s;
  }

  get(key: number): Contact3 | undefined {
    let s = this.slotOf(key);
    for (;;) {
      const at = this.slots[s] as number;
      if (at === 0) return undefined;
      const c = this.list[at - 1] as Contact3;
      if (c.key === key) return c;
      s = (s + 1) & this.mask;
    }
  }

  /** Puts a contact (its `key` set); a key already there is not expected (a step puts each pair once). */
  set(c: Contact3): void {
    if ((this.size + 1) * 2 > this.mask + 1) this.grow();
    let s = this.slotOf(c.key);
    while ((this.slots[s] as number) !== 0) s = (s + 1) & this.mask;
    this.list[this.size++] = c;
    this.slots[s] = this.size;
  }

  private grow(): void {
    const cap = (this.mask + 1) * 2;
    this.slots = new Int32Array(cap);
    this.mask = cap - 1;
    for (let i = 0; i < this.size; i++) {
      let s = this.slotOf((this.list[i] as Contact3).key);
      while ((this.slots[s] as number) !== 0) s = (s + 1) & this.mask;
      this.slots[s] = i + 1;
    }
  }

  /** Empties the table; the arrays stay. */
  clear(): void {
    if (this.size === 0) return;
    this.slots.fill(0);
    this.size = 0;
  }
}

/** The directions in `src` (x, y, z packed) turned by the rotation at row `r` of `R` (row major), into `dst`. */
function turnAll(src: Float64Array, dst: Float64Array, R: Float64Array, r: number): void {
  for (let j = 0; j < src.length; j += 3) {
    const a = src[j] as number;
    const b = src[j + 1] as number;
    const c = src[j + 2] as number;
    dst[j] = (R[r] as number) * a + (R[r + 1] as number) * b + (R[r + 2] as number) * c;
    dst[j + 1] = (R[r + 3] as number) * a + (R[r + 4] as number) * b + (R[r + 5] as number) * c;
    dst[j + 2] = (R[r + 6] as number) * a + (R[r + 7] as number) * b + (R[r + 8] as number) * c;
  }
}

/** ω_i += sgn I⁻¹ τ. */
function turn(I: Float64Array, w: Float64Array, i: number, sgn: number, tx: number, ty: number, tz: number): void {
  const o = i * 9;
  w[i * 3] = (w[i * 3] as number) + sgn * ((I[o] as number) * tx + (I[o + 1] as number) * ty + (I[o + 2] as number) * tz);
  w[i * 3 + 1] = (w[i * 3 + 1] as number) + sgn * ((I[o + 3] as number) * tx + (I[o + 4] as number) * ty + (I[o + 5] as number) * tz);
  w[i * 3 + 2] = (w[i * 3 + 2] as number) + sgn * ((I[o + 6] as number) * tx + (I[o + 7] as number) * ty + (I[o + 8] as number) * tz);
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

/** Volume and centre of a set of shapes (spheres and hulls), for a body's start. */
export function volumeOf3(shapes: readonly ShapeDef3[]): { vol: number; cx: number; cy: number; cz: number } {
  let vol = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const s of shapes) {
    if (s.kind === 'plane' || s.kind === 'heightfield') continue;
    if (s.kind === 'sphere') {
      const v = (4 / 3) * Math.PI * s.r ** 3;
      vol += v;
      cx += v * s.c.x;
      cy += v * s.c.y;
      cz += v * s.c.z;
    } else {
      const m = hullMoments(s.verts, s.faces);
      vol += m.vol;
      cx += m.vol * m.cx;
      cy += m.vol * m.cy;
      cz += m.vol * m.cz;
    }
  }
  return vol > 0 ? { vol, cx: cx / vol, cy: cy / vol, cz: cz / vol } : { vol: 0, cx: 0, cy: 0, cz: 0 };
}

/** Volume, centroid and ∫ x xᵀ dV about the origin of a closed convex hull (tetrahedra from its first corner). */
function hullMoments(verts: readonly P3[], faces: readonly (readonly number[])[]): { vol: number; cx: number; cy: number; cz: number; C: number[] } {
  const o = verts[0] as P3;
  let vol = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const f of faces) {
    for (let k = 1; k + 1 < f.length; k++) {
      const a = verts[f[0] as number] as P3;
      const b = verts[f[k] as number] as P3;
      const c = verts[f[k + 1] as number] as P3;
      const pts = [o, a, b, c];
      // signed volume of the tetrahedron o a b c
      const ax = a.x - o.x;
      const ay = a.y - o.y;
      const az = a.z - o.z;
      const bx = b.x - o.x;
      const by = b.y - o.y;
      const bz = b.z - o.z;
      const qx = c.x - o.x;
      const qy = c.y - o.y;
      const qz = c.z - o.z;
      const v = (ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx)) / 6;
      vol += v;
      const sx = (o.x + a.x + b.x + c.x) / 4;
      const sy = (o.y + a.y + b.y + c.y) / 4;
      const sz = (o.z + a.z + b.z + c.z) / 4;
      cx += v * sx;
      cy += v * sy;
      cz += v * sz;
      // ∫ x_i x_j over a tetrahedron = V/20 (Σ p_i p_j + (Σ p)_i (Σ p)_j)
      const S = [0, 0, 0];
      for (const p of pts) {
        S[0] = (S[0] as number) + p.x;
        S[1] = (S[1] as number) + p.y;
        S[2] = (S[2] as number) + p.z;
      }
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          let s = 0;
          for (const p of pts) s += [p.x, p.y, p.z][i] as number * ([p.x, p.y, p.z][j] as number);
          C[i * 3 + j] = (C[i * 3 + j] as number) + (v / 20) * (s + (S[i] as number) * (S[j] as number));
        }
      }
    }
  }
  if (!(Math.abs(vol) > 1e-15)) return { vol: 0, cx: o.x, cy: o.y, cz: o.z, C };
  return { vol, cx: cx / vol, cy: cy / vol, cz: cz / vol, C };
}

function makeShape3(body: number, d: ShapeDef3, ox: number, oy: number, oz: number): Shape3 {
  const z = new Float64Array(0);
  const noFaces: Int32Array[] = [];
  if (d.kind === 'sphere') {
    return { kind: 0, body, r: d.r, lc: Float64Array.of(d.c.x - ox, d.c.y - oy, d.c.z - oz), lv: z, wv: z, faces: noFaces, ln: z, wn: z, le: z, we: z, edges: new Int32Array(0), wc: new Float64Array(3), reach: Math.sqrt((d.c.x - ox) ** 2 + (d.c.y - oy) ** 2 + (d.c.z - oz) ** 2) + d.r };
  }
  if (d.kind === 'heightfield') {
    const hf: Heightfield = { x0: d.x0, y0: d.y0, dx: d.dx, dy: d.dy, nx: d.nx, ny: d.ny, h: d.h };
    return { kind: 3, hf, body, r: 0, lc: z, lv: z, wv: z, faces: noFaces, ln: z, wn: z, le: z, we: z, edges: new Int32Array(0), wc: new Float64Array(3), reach: 0 };
  }
  if (d.kind === 'plane') {
    const l = Math.sqrt(d.n.x * d.n.x + d.n.y * d.n.y + d.n.z * d.n.z) || 1;
    return { kind: 2, body, r: 0, lc: Float64Array.of(d.n.x / l, d.n.y / l, d.n.z / l, d.d / l), lv: z, wv: z, faces: noFaces, ln: z, wn: z, le: z, we: z, edges: new Int32Array(0), wc: new Float64Array(3), reach: 0 };
  }
  const nv = d.verts.length;
  const lv = new Float64Array(nv * 3);
  let reach = 0;
  d.verts.forEach((p, i) => {
    lv[i * 3] = p.x - ox;
    lv[i * 3 + 1] = p.y - oy;
    lv[i * 3 + 2] = p.z - oz;
    reach = Math.max(reach, Math.sqrt((p.x - ox) ** 2 + (p.y - oy) ** 2 + (p.z - oz) ** 2));
  });
  const faces = d.faces.map((f) => Int32Array.from(f));
  const ln = new Float64Array(faces.length * 3);
  faces.forEach((f, k) => {
    // Newell's normal: robust for any flat polygon
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < f.length; i++) {
      const a = (f[i] as number) * 3;
      const b = (f[(i + 1) % f.length] as number) * 3;
      nx += ((lv[a + 1] as number) - (lv[b + 1] as number)) * ((lv[a + 2] as number) + (lv[b + 2] as number));
      ny += ((lv[a + 2] as number) - (lv[b + 2] as number)) * ((lv[a] as number) + (lv[b] as number));
      nz += ((lv[a] as number) - (lv[b] as number)) * ((lv[a + 1] as number) + (lv[b + 1] as number));
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    ln[k * 3] = nx / l;
    ln[k * 3 + 1] = ny / l;
    ln[k * 3 + 2] = nz / l;
  });
  // unique edges, and their unique directions
  const seen = new Set<number>();
  const edges: number[] = [];
  for (const f of faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i] as number;
      const b = f[(i + 1) % f.length] as number;
      const key = Math.min(a, b) * 100000 + Math.max(a, b);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(a, b);
    }
  }
  const dirs: number[] = [];
  for (let e = 0; e < edges.length; e += 2) {
    const a = (edges[e] as number) * 3;
    const b = (edges[e + 1] as number) * 3;
    let dx = (lv[b] as number) - (lv[a] as number);
    let dy = (lv[b + 1] as number) - (lv[a + 1] as number);
    let dz = (lv[b + 2] as number) - (lv[a + 2] as number);
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(l > 1e-12)) continue;
    dx /= l;
    dy /= l;
    dz /= l;
    let dup = false;
    for (let k = 0; k < dirs.length; k += 3) {
      const c = Math.abs(dx * (dirs[k] as number) + dy * (dirs[k + 1] as number) + dz * (dirs[k + 2] as number));
      if (c > 1 - 1e-9) {
        dup = true;
        break;
      }
    }
    if (!dup) dirs.push(dx, dy, dz);
  }
  return { kind: 1, body, r: 0, lc: z, lv, wv: new Float64Array(nv * 3), faces, ln, wn: new Float64Array(ln.length), le: Float64Array.from(dirs), we: new Float64Array(dirs.length), edges: Int32Array.from(edges), wc: new Float64Array(3), reach };
}

/* ------------------------------ the narrow phase ------------------------------ */

/*
 * The narrow phase writes what it finds into scratch that lives as long as the module, not into objects and arrays, and
 * takes its numbers from slots of `FS`, not from arguments: an object a pair, an array a point, and a number passed to or
 * returned from a call that is not inlined are all garbage in every step (design 11.4, PH-53). `FD` holds the normal and
 * how many points were found, `FP` the points (x, y, z and the separation, four numbers each). The arithmetic is that of
 * the versions that made objects, in the same order.
 */
const FD = { nx: 0, ny: 0, nz: 0, n: 0 };
let FP = new Float64Array(1024);
/** The margin the pair is made within: set by the caller before `collideShapes`. */
const S_MARGIN = 0;
/** A normal (1 to 3), a point in (4 to 6), a point out (7 to 9), the two hulls' centres (10 to 12, 13 to 15), an axis (16 to 18), a plane's offset (19). */
const S_N = 1;
const S_PT = 4;
const S_OUT = 7;
const S_CA = 10;
const S_CB = 13;
const S_AXIS = 16;
const S_OFF = 19;
const FS = new Float64Array(24);
/** The best axis of a hull pair so far: separation, the axis (1 to 3), its kind and its face index. */
const HS = new Float64Array(8);
/** Four points for `reduce4` to put in order. */
const FT = new Float64Array(16);
/** The polygons a face is clipped through, ping-ponged: three numbers a point. */
let PA = new Float64Array(768);
let PB = new Float64Array(768);

function ensureFP(points: number): void {
  if (FP.length < points * 4) FP = new Float64Array(points * 8);
}

/** The found points of the last `collideShapes` as a new object (terrain keeps several of them until it has chosen). */
function snapshotFound(): Found3 {
  const pts: { x: number; y: number; z: number; s: number }[] = [];
  for (let k = 0; k < FD.n; k++) pts.push({ x: FP[k * 4] as number, y: FP[k * 4 + 1] as number, z: FP[k * 4 + 2] as number, s: FP[k * 4 + 3] as number });
  return { nx: FD.nx, ny: FD.ny, nz: FD.nz, pts };
}

/** Puts a snapshot back as the found points. */
function restoreFound(f: Found3): void {
  ensureFP(f.pts.length);
  for (let k = 0; k < f.pts.length; k++) {
    const q = f.pts[k] as { x: number; y: number; z: number; s: number };
    FP[k * 4] = q.x;
    FP[k * 4 + 1] = q.y;
    FP[k * 4 + 2] = q.z;
    FP[k * 4 + 3] = q.s;
  }
  FD.nx = f.nx;
  FD.ny = f.ny;
  FD.nz = f.nz;
  FD.n = f.pts.length;
}

/** At most four of the `n` points in `FP`: the deepest, the furthest from it, then the two that widen the patch most. Returns how many are left. */
function reduce4(n: number): number {
  if (n <= 4) return n;
  const P = FP;
  let a = 0;
  for (let i = 0; i < n; i++) if ((P[i * 4 + 3] as number) < (P[a * 4 + 3] as number)) a = i;
  const ax = P[a * 4] as number;
  const ay = P[a * 4 + 1] as number;
  const az = P[a * 4 + 2] as number;
  let b = a;
  let bd = -1;
  for (let i = 0; i < n; i++) {
    const d = ((P[i * 4] as number) - ax) ** 2 + ((P[i * 4 + 1] as number) - ay) ** 2 + ((P[i * 4 + 2] as number) - az) ** 2;
    if (d > bd) {
      bd = d;
      b = i;
    }
  }
  // the point furthest from the line a b
  const ux = (P[b * 4] as number) - ax;
  const uy = (P[b * 4 + 1] as number) - ay;
  const uz = (P[b * 4 + 2] as number) - az;
  let c = a;
  let cd = -1;
  for (let i = 0; i < n; i++) {
    const vx = (P[i * 4] as number) - ax;
    const vy = (P[i * 4 + 1] as number) - ay;
    const vz = (P[i * 4 + 2] as number) - az;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const d = cx * cx + cy * cy + cz * cz;
    if (d > cd) {
      cd = d;
      c = i;
    }
  }
  // the point furthest from the middle of a, b, c on the other side
  const mx = (ax + (P[b * 4] as number) + (P[c * 4] as number)) / 3;
  const my = (ay + (P[b * 4 + 1] as number) + (P[c * 4 + 1] as number)) / 3;
  const mz = (az + (P[b * 4 + 2] as number) + (P[c * 4 + 2] as number)) / 3;
  let d4 = a;
  let dd = -1;
  for (let i = 0; i < n; i++) {
    if (i === a || i === b || i === c) continue;
    const d = ((P[i * 4] as number) - mx) ** 2 + ((P[i * 4 + 1] as number) - my) ** 2 + ((P[i * 4 + 2] as number) - mz) ** 2;
    if (d > dd) {
      dd = d;
      d4 = i;
    }
  }
  // a, b, c, d4 in that order, without repeats
  let k = 0;
  for (let q = 0; q < 4; q++) {
    const i = q === 0 ? a : q === 1 ? b : q === 2 ? c : d4;
    if (q === 1 && i === a) continue;
    if (q === 2 && (i === a || i === b)) continue;
    if (q === 3 && (i === a || i === b || i === c)) continue;
    FT[k * 4] = P[i * 4] as number;
    FT[k * 4 + 1] = P[i * 4 + 1] as number;
    FT[k * 4 + 2] = P[i * 4 + 2] as number;
    FT[k * 4 + 3] = P[i * 4 + 3] as number;
    k++;
  }
  for (let j = 0; j < k * 4; j++) P[j] = FT[j] as number;
  return k;
}

/** What shapes A and B touch in, into `FD` and `FP` (the margin in `FS[S_MARGIN]`): the contact normal from A to B and the points on B's surface. A is the plane, or the hull of a hull–sphere pair. */
function collideShapes(A: Shape3, B: Shape3): void {
  FD.n = 0;
  const margin = FS[S_MARGIN] as number;
  if (A.kind === 2) {
    const nx = A.lc[0] as number;
    const ny = A.lc[1] as number;
    const nz = A.lc[2] as number;
    const d = A.lc[3] as number;
    if (B.kind === 0) {
      const s = nx * (B.wc[0] as number) + ny * (B.wc[1] as number) + nz * (B.wc[2] as number) - d - B.r;
      if (s > margin) return;
      FD.nx = nx;
      FD.ny = ny;
      FD.nz = nz;
      FP[0] = (B.wc[0] as number) - B.r * nx;
      FP[1] = (B.wc[1] as number) - B.r * ny;
      FP[2] = (B.wc[2] as number) - B.r * nz;
      FP[3] = s;
      FD.n = 1;
      return;
    }
    if (B.kind === 1) {
      const wv = B.wv;
      ensureFP(wv.length / 3);
      const P = FP;
      let k = 0;
      for (let j = 0; j < wv.length; j += 3) {
        const s = nx * (wv[j] as number) + ny * (wv[j + 1] as number) + nz * (wv[j + 2] as number) - d;
        if (s <= margin) {
          P[k * 4] = wv[j] as number;
          P[k * 4 + 1] = wv[j + 1] as number;
          P[k * 4 + 2] = wv[j + 2] as number;
          P[k * 4 + 3] = s;
          k++;
        }
      }
      FD.nx = nx;
      FD.ny = ny;
      FD.nz = nz;
      FD.n = reduce4(k);
    }
    return;
  }
  if (A.kind === 0 && B.kind === 0) {
    const dx = (B.wc[0] as number) - (A.wc[0] as number);
    const dy = (B.wc[1] as number) - (A.wc[1] as number);
    const dz = (B.wc[2] as number) - (A.wc[2] as number);
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const s = l - A.r - B.r;
    if (s > margin) return;
    const nx = l > 1e-12 ? dx / l : 0;
    const ny = l > 1e-12 ? dy / l : 0;
    const nz = l > 1e-12 ? dz / l : 1;
    FD.nx = nx;
    FD.ny = ny;
    FD.nz = nz;
    FP[0] = (B.wc[0] as number) - B.r * nx;
    FP[1] = (B.wc[1] as number) - B.r * ny;
    FP[2] = (B.wc[2] as number) - B.r * nz;
    FP[3] = s;
    FD.n = 1;
    return;
  }
  if (A.kind === 1 && B.kind === 0) hullSphere(A, B);
  else if (A.kind === 1 && B.kind === 1) hullHull(A, B);
}

/** A hull against a sphere: the closest point of the hull to the sphere's centre. */
function hullSphere(A: Shape3, B: Shape3): void {
  const margin = FS[S_MARGIN] as number;
  const cx = B.wc[0] as number;
  const cy = B.wc[1] as number;
  const cz = B.wc[2] as number;
  const v = A.wv;
  let have = false;
  let qbx = 0;
  let qby = 0;
  let qbz = 0;
  let bd = Infinity;
  let deepest = -Infinity;
  let deepFace = 0;
  for (let k = 0; k < A.faces.length; k++) {
    const f = A.faces[k] as Int32Array;
    const nx = A.wn[k * 3] as number;
    const ny = A.wn[k * 3 + 1] as number;
    const nz = A.wn[k * 3 + 2] as number;
    const o = (f[0] as number) * 3;
    const dist = nx * (cx - (v[o] as number)) + ny * (cy - (v[o + 1] as number)) + nz * (cz - (v[o + 2] as number));
    if (dist > deepest) {
      deepest = dist;
      deepFace = k;
    }
    if (dist <= 0) continue;
    FS[S_N] = nx;
    FS[S_N + 1] = ny;
    FS[S_N + 2] = nz;
    FS[S_PT] = cx;
    FS[S_PT + 1] = cy;
    FS[S_PT + 2] = cz;
    closestOnFace(v, f);
    const qx = FS[S_OUT] as number;
    const qy = FS[S_OUT + 1] as number;
    const qz = FS[S_OUT + 2] as number;
    const d = (qx - cx) ** 2 + (qy - cy) ** 2 + (qz - cz) ** 2;
    if (d < bd) {
      bd = d;
      qbx = qx;
      qby = qy;
      qbz = qz;
      have = true;
    }
  }
  if (have) {
    const d = Math.sqrt(bd);
    const s = d - B.r;
    if (s > margin) return;
    const nx = d > 1e-12 ? (cx - qbx) / d : (A.wn[deepFace * 3] as number);
    const ny = d > 1e-12 ? (cy - qby) / d : (A.wn[deepFace * 3 + 1] as number);
    const nz = d > 1e-12 ? (cz - qbz) / d : (A.wn[deepFace * 3 + 2] as number);
    FD.nx = nx;
    FD.ny = ny;
    FD.nz = nz;
    FP[0] = cx - B.r * nx;
    FP[1] = cy - B.r * ny;
    FP[2] = cz - B.r * nz;
    FP[3] = s;
    FD.n = 1;
    return;
  }
  // the centre is inside: push out through the nearest face
  const nx = A.wn[deepFace * 3] as number;
  const ny = A.wn[deepFace * 3 + 1] as number;
  const nz = A.wn[deepFace * 3 + 2] as number;
  FD.nx = nx;
  FD.ny = ny;
  FD.nz = nz;
  FP[0] = cx - B.r * nx;
  FP[1] = cy - B.r * ny;
  FP[2] = cz - B.r * nz;
  FP[3] = deepest - B.r;
  FD.n = 1;
}

/** The point of a flat convex face nearest to the point in `FS[S_PT]`, with the face's normal in `FS[S_N]`: into `FS[S_OUT]`. */
function closestOnFace(v: Float64Array, f: Int32Array): void {
  const nx = FS[S_N] as number;
  const ny = FS[S_N + 1] as number;
  const nz = FS[S_N + 2] as number;
  const x = FS[S_PT] as number;
  const y = FS[S_PT + 1] as number;
  const z = FS[S_PT + 2] as number;
  const o = (f[0] as number) * 3;
  const d = nx * (x - (v[o] as number)) + ny * (y - (v[o + 1] as number)) + nz * (z - (v[o + 2] as number));
  const px = x - d * nx;
  const py = y - d * ny;
  const pz = z - d * nz;
  // inside every edge?
  let inside = true;
  for (let i = 0; i < f.length; i++) {
    const a = (f[i] as number) * 3;
    const b = (f[(i + 1) % f.length] as number) * 3;
    const ex = (v[b] as number) - (v[a] as number);
    const ey = (v[b + 1] as number) - (v[a + 1] as number);
    const ez = (v[b + 2] as number) - (v[a + 2] as number);
    // edge × normal points out of the face
    const ox = ey * nz - ez * ny;
    const oy = ez * nx - ex * nz;
    const oz = ex * ny - ey * nx;
    if (ox * (px - (v[a] as number)) + oy * (py - (v[a + 1] as number)) + oz * (pz - (v[a + 2] as number)) > 0) {
      inside = false;
      break;
    }
  }
  if (inside) {
    FS[S_OUT] = px;
    FS[S_OUT + 1] = py;
    FS[S_OUT + 2] = pz;
    return;
  }
  let bqx = v[o] as number;
  let bqy = v[o + 1] as number;
  let bqz = v[o + 2] as number;
  let bd = Infinity;
  for (let i = 0; i < f.length; i++) {
    const a = (f[i] as number) * 3;
    const b = (f[(i + 1) % f.length] as number) * 3;
    const ax = v[a] as number;
    const ay = v[a + 1] as number;
    const az = v[a + 2] as number;
    const ex = (v[b] as number) - ax;
    const ey = (v[b + 1] as number) - ay;
    const ez = (v[b + 2] as number) - az;
    const l2 = ex * ex + ey * ey + ez * ez;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / l2)) : 0;
    const qx = ax + t * ex;
    const qy = ay + t * ey;
    const qz = az + t * ez;
    const dd = (qx - x) ** 2 + (qy - y) ** 2 + (qz - z) ** 2;
    if (dd < bd) {
      bd = dd;
      bqx = qx;
      bqy = qy;
      bqz = qz;
    }
  }
  FS[S_OUT] = bqx;
  FS[S_OUT + 1] = bqy;
  FS[S_OUT + 2] = bqz;
}

/** The mean of a hull's world corners, into `FS` at `slot`. */
function centreInto(s: Shape3, slot: number): void {
  const v = s.wv;
  let x = 0;
  let y = 0;
  let z = 0;
  const n = v.length / 3;
  for (let j = 0; j < v.length; j += 3) {
    x += v[j] as number;
    y += v[j + 1] as number;
    z += v[j + 2] as number;
  }
  FS[slot] = x / n;
  FS[slot + 1] = y / n;
  FS[slot + 2] = z / n;
}

/** The corner of a hull furthest along the axis in `FS[S_AXIS]` (its index in the corners, times three). */
function supportOf(s: Shape3): number {
  const x = FS[S_AXIS] as number;
  const y = FS[S_AXIS + 1] as number;
  const z = FS[S_AXIS + 2] as number;
  const v = s.wv;
  let best = 0;
  let bd = -Infinity;
  for (let j = 0; j < v.length; j += 3) {
    const d = (v[j] as number) * x + (v[j + 1] as number) * y + (v[j + 2] as number) * z;
    if (d > bd) {
      bd = d;
      best = j;
    }
  }
  return best;
}

/**
 * One separating axis, in `FS[S_AXIS]`, of kind k (1 a face of A, 2 a face of B, 3 an edge pair, `i` the face or the pair):
 * false when the hulls are apart along it by more than the margin, else the axis is kept in `HS` if it is the best so far.
 */
function satAxis(A: Shape3, B: Shape3, k: number, i: number): boolean {
  const x = FS[S_AXIS] as number;
  const y = FS[S_AXIS + 1] as number;
  const z = FS[S_AXIS + 2] as number;
  let a0 = Infinity;
  let a1 = -Infinity;
  const va = A.wv;
  for (let j = 0; j < va.length; j += 3) {
    const d = (va[j] as number) * x + (va[j + 1] as number) * y + (va[j + 2] as number) * z;
    if (d < a0) a0 = d;
    if (d > a1) a1 = d;
  }
  let b0 = Infinity;
  let b1 = -Infinity;
  const vb = B.wv;
  for (let j = 0; j < vb.length; j += 3) {
    const d = (vb[j] as number) * x + (vb[j + 1] as number) * y + (vb[j + 2] as number) * z;
    if (d < b0) b0 = d;
    if (d > b1) b1 = d;
  }
  // a face's own outward normal: how far the other hull is beyond that face (never turned round, so the face found
  // is the one the other hull rests on); an edge axis points from A toward B
  let sep: number;
  let sx = x;
  let sy = y;
  let sz = z;
  if (k === 1) sep = b0 - a1;
  else if (k === 2) {
    sep = a0 - b1;
    sx = -x;
    sy = -y;
    sz = -z;
  } else if (((FS[S_CB] as number) - (FS[S_CA] as number)) * x + ((FS[S_CB + 1] as number) - (FS[S_CA + 1] as number)) * y + ((FS[S_CB + 2] as number) - (FS[S_CA + 2] as number)) * z >= 0) sep = b0 - a1;
  else {
    sep = a0 - b1;
    sx = -x;
    sy = -y;
    sz = -z;
  }
  if (sep > (FS[S_MARGIN] as number)) return false;
  // edge axes win only when clearly better, so resting faces keep face contacts
  const bias = k === 1 ? 0 : k === 2 ? 1e-4 : 0.01;
  if (sep - bias > (HS[0] as number)) {
    HS[0] = sep - bias;
    HS[1] = sx;
    HS[2] = sy;
    HS[3] = sz;
    HS[4] = k;
    HS[5] = i;
  }
  return true;
}

/** Keeps the part of the polygon `src` (`n` points, x, y, z packed) where axis · p ≤ off (`FS[S_AXIS]`, `FS[S_OFF]`), into `dst`; returns how many points. */
function clipPoly(src: Float64Array, n: number, dst: Float64Array): number {
  const nx = FS[S_AXIS] as number;
  const ny = FS[S_AXIS + 1] as number;
  const nz = FS[S_AXIS + 2] as number;
  const off = FS[S_OFF] as number;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = i * 3;
    const b = ((i + 1) % n) * 3;
    const da = nx * (src[a] as number) + ny * (src[a + 1] as number) + nz * (src[a + 2] as number) - off;
    const db = nx * (src[b] as number) + ny * (src[b + 1] as number) + nz * (src[b + 2] as number) - off;
    if (da <= 0) {
      dst[m * 3] = src[a] as number;
      dst[m * 3 + 1] = src[a + 1] as number;
      dst[m * 3 + 2] = src[a + 2] as number;
      m++;
    }
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      dst[m * 3] = (src[a] as number) + t * ((src[b] as number) - (src[a] as number));
      dst[m * 3 + 1] = (src[a + 1] as number) + t * ((src[b + 1] as number) - (src[a + 1] as number));
      dst[m * 3 + 2] = (src[a + 2] as number) + t * ((src[b + 2] as number) - (src[a + 2] as number));
      m++;
    }
  }
  return m;
}

/**
 * Two hulls: separating axes (face normals of both, then cross products of their edge directions). The axis of least
 * overlap gives the normal; a face axis gives points by clipping the other hull's most opposed face to the face's
 * sides, an edge axis the nearest points of the two edges.
 */
function hullHull(A: Shape3, B: Shape3): void {
  const margin = FS[S_MARGIN] as number;
  centreInto(A, S_CA);
  centreInto(B, S_CB);
  HS[0] = -Infinity;
  HS[1] = 0;
  HS[2] = 0;
  HS[3] = 0;
  HS[4] = 0;
  HS[5] = -1;
  for (let k = 0; k < A.faces.length; k++) {
    FS[S_AXIS] = A.wn[k * 3] as number;
    FS[S_AXIS + 1] = A.wn[k * 3 + 1] as number;
    FS[S_AXIS + 2] = A.wn[k * 3 + 2] as number;
    if (!satAxis(A, B, 1, k)) return;
  }
  for (let k = 0; k < B.faces.length; k++) {
    FS[S_AXIS] = B.wn[k * 3] as number;
    FS[S_AXIS + 1] = B.wn[k * 3 + 1] as number;
    FS[S_AXIS + 2] = B.wn[k * 3 + 2] as number;
    if (!satAxis(A, B, 2, k)) return;
  }
  for (let i = 0; i < A.we.length; i += 3) {
    for (let j = 0; j < B.we.length; j += 3) {
      const ux = A.we[i] as number;
      const uy = A.we[i + 1] as number;
      const uz = A.we[i + 2] as number;
      const vx = B.we[j] as number;
      const vy = B.we[j + 1] as number;
      const vz = B.we[j + 2] as number;
      let x = uy * vz - uz * vy;
      let y = uz * vx - ux * vz;
      let z = ux * vy - uy * vx;
      const l = Math.sqrt(x * x + y * y + z * z);
      // nearly parallel edges give an axis that is mostly noise: the face axes cover that case
      if (l < 0.02) continue;
      x /= l;
      y /= l;
      z /= l;
      FS[S_AXIS] = x;
      FS[S_AXIS + 1] = y;
      FS[S_AXIS + 2] = z;
      if (!satAxis(A, B, 3, i * 100000 + j)) return;
    }
  }
  const bestSep = HS[0] as number;
  const bx = HS[1] as number;
  const by = HS[2] as number;
  const bz = HS[3] as number;
  const kind = HS[4] as number;
  const index = HS[5] as number;
  if (kind === 3) {
    // the deepest corner of B along -n and of A along n give the two edges' region: take the corner pair midpoint
    FS[S_AXIS] = bx;
    FS[S_AXIS + 1] = by;
    FS[S_AXIS + 2] = bz;
    const ia = supportOf(A);
    FS[S_AXIS] = -bx;
    FS[S_AXIS + 1] = -by;
    FS[S_AXIS + 2] = -bz;
    const ib = supportOf(B);
    const s = bestSep + 0.002;
    FD.nx = bx;
    FD.ny = by;
    FD.nz = bz;
    FP[0] = 0.5 * ((A.wv[ia] as number) + (B.wv[ib] as number) + s * bx);
    FP[1] = 0.5 * ((A.wv[ia + 1] as number) + (B.wv[ib + 1] as number) + s * by);
    FP[2] = 0.5 * ((A.wv[ia + 2] as number) + (B.wv[ib + 2] as number) + s * bz);
    FP[3] = s;
    FD.n = 1;
    return;
  }
  // reference face on A (kind 1) or on B (kind 2)
  const ref = kind === 1 ? A : B;
  const inc = kind === 1 ? B : A;
  // the reference normal points from the reference hull toward the other
  const rnx = kind === 1 ? bx : -bx;
  const rny = kind === 1 ? by : -by;
  const rnz = kind === 1 ? bz : -bz;
  const rf = ref.faces[index] as Int32Array;
  // the incident face: the one most against the reference normal
  let inF = 0;
  let minDot = Infinity;
  for (let k = 0; k < inc.faces.length; k++) {
    const d = (inc.wn[k * 3] as number) * rnx + (inc.wn[k * 3 + 1] as number) * rny + (inc.wn[k * 3 + 2] as number) * rnz;
    if (d < minDot) {
      minDot = d;
      inF = k;
    }
  }
  const f = inc.faces[inF] as Int32Array;
  // a convex face clipped by a plane keeps at most one point more: room for every cut
  const room = (f.length + rf.length + 2) * 3;
  if (PA.length < room) {
    PA = new Float64Array(room * 2);
    PB = new Float64Array(room * 2);
  }
  let cur = PA;
  let oth = PB;
  let pn = f.length;
  for (let i = 0; i < f.length; i++) {
    const o = (f[i] as number) * 3;
    cur[i * 3] = inc.wv[o] as number;
    cur[i * 3 + 1] = inc.wv[o + 1] as number;
    cur[i * 3 + 2] = inc.wv[o + 2] as number;
  }
  // clip to the side planes of the reference face
  const rv = ref.wv;
  for (let i = 0; i < rf.length && pn > 0; i++) {
    const a = (rf[i] as number) * 3;
    const b = (rf[(i + 1) % rf.length] as number) * 3;
    const ex = (rv[b] as number) - (rv[a] as number);
    const ey = (rv[b + 1] as number) - (rv[a + 1] as number);
    const ez = (rv[b + 2] as number) - (rv[a + 2] as number);
    // outward side normal: edge × face normal (faces are counter-clockwise from outside)
    const fnx = ref.wn[index * 3] as number;
    const fny = ref.wn[index * 3 + 1] as number;
    const fnz = ref.wn[index * 3 + 2] as number;
    const sx = ey * fnz - ez * fny;
    const sy = ez * fnx - ex * fnz;
    const sz = ex * fny - ey * fnx;
    const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
    // a little past the face's edge, so corners that lie on it (two equal boxes stacked) are kept
    FS[S_OFF] = (sx * (rv[a] as number) + sy * (rv[a + 1] as number) + sz * (rv[a + 2] as number)) / sl + 2 * SLOP;
    FS[S_AXIS] = sx / sl;
    FS[S_AXIS + 1] = sy / sl;
    FS[S_AXIS + 2] = sz / sl;
    pn = clipPoly(cur, pn, oth);
    const t = cur;
    cur = oth;
    oth = t;
  }
  const fo = (rf[0] as number) * 3;
  const plane = rnx * (rv[fo] as number) + rny * (rv[fo + 1] as number) + rnz * (rv[fo + 2] as number);
  ensureFP(pn);
  const P = FP;
  let k = 0;
  for (let i = 0; i < pn; i++) {
    const x = cur[i * 3] as number;
    const y = cur[i * 3 + 1] as number;
    const z = cur[i * 3 + 2] as number;
    const s = rnx * x + rny * y + rnz * z - plane;
    if (s > margin) continue;
    if (kind === 1) {
      P[k * 4] = x;
      P[k * 4 + 1] = y;
      P[k * 4 + 2] = z;
    } else {
      // the point on B's surface: on the reference face, and the normal from A to B
      P[k * 4] = x - s * rnx;
      P[k * 4 + 1] = y - s * rny;
      P[k * 4 + 2] = z - s * rnz;
    }
    P[k * 4 + 3] = s;
    k++;
  }
  FD.nx = bx;
  FD.ny = by;
  FD.nz = bz;
  FD.n = reduce4(k);
}

/** A quaternion for a turn of `angle` about a unit axis (exact maths). */
export function quatAxis(x: number, y: number, z: number, angle: number): [number, number, number, number] {
  const sc = new Float64Array(2);
  sincos(angle / 2, sc);
  return [sc[1] as number, x * (sc[0] as number), y * (sc[0] as number), z * (sc[0] as number)];
}

/* ------------------------------ terrain and rays ------------------------------ */

/** The corners of triangle t of cell (i, j), as height indices. */
function triCorners(f: Heightfield, i: number, j: number, t: number): [number, number, number] {
  const m = f.ny + 1;
  const a = i * m + j;
  const b = (i + 1) * m + j;
  const c = (i + 1) * m + j + 1;
  const d = i * m + j + 1;
  return t === 0 ? [a, b, c] : [a, c, d];
}

/** The highest corner of a terrain triangle (NaN when a corner is undefined). */
function triTop(f: Heightfield, i: number, j: number, t: number): number {
  const [a, b, c] = triCorners(f, i, j, t);
  return Math.max(f.h[a] as number, f.h[b] as number, f.h[c] as number);
}

/** True when shape B is more than `margin` above the plane of a terrain triangle's top (or the triangle is undefined). */
function clearOfTri(f: Heightfield, i: number, j: number, t: number, B: Shape3, margin: number): boolean {
  const [ia, ib, ic] = triCorners(f, i, j, t);
  const m = f.ny + 1;
  const xa = f.x0 + f.dx * Math.floor(ia / m);
  const ya = f.y0 + f.dy * (ia % m);
  const za = f.h[ia] as number;
  const ux = f.x0 + f.dx * Math.floor(ib / m) - xa;
  const uy = f.y0 + f.dy * (ib % m) - ya;
  const uz = (f.h[ib] as number) - za;
  const vx = f.x0 + f.dx * Math.floor(ic / m) - xa;
  const vy = f.y0 + f.dy * (ic % m) - ya;
  const vz = (f.h[ic] as number) - za;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!(l > 0)) return true;
  nx /= l;
  ny /= l;
  nz /= l;
  if (B.kind === 0) {
    const cx = B.wc[0] as number;
    const cy = B.wc[1] as number;
    const cz = B.wc[2] as number;
    if (nx * (cx - xa) + ny * (cy - ya) + nz * (cz - za) - B.r > margin) return true;
    // the triangle's box is a bound from below on its distance: a ball on flat ground is near only the cells under it
    const gap = (c: number, a: number, b: number, d: number): number => {
      const lo = Math.min(a, b, d);
      const hi = Math.max(a, b, d);
      return c < lo ? lo - c : c > hi ? c - hi : 0;
    };
    const gx = gap(cx, xa, xa + ux, xa + vx);
    const gy = gap(cy, ya, ya + uy, ya + vy);
    const gz = gap(cz, za, za + uz, za + vz);
    const reach = B.r + margin;
    return gx * gx + gy * gy + gz * gz > reach * reach;
  }
  const v = B.wv;
  let near = false;
  for (let q = 0; q < v.length; q += 3) {
    if (nx * ((v[q] as number) - xa) + ny * ((v[q + 1] as number) - ya) + nz * ((v[q + 2] as number) - za) <= margin) {
      near = true;
      break;
    }
  }
  if (!near) return true;
  // the hull's own faces are separating axes too: a slab wholly outside one face cannot touch (a tilted car over hills)
  const px = [xa, xa + ux, xa + vx];
  const py = [ya, ya + uy, ya + vy];
  const pz = [za, za + uz, za + vz];
  for (let k = 0; k < B.faces.length; k++) {
    const fx = B.wn[k * 3] as number;
    const fy = B.wn[k * 3 + 1] as number;
    const fz = B.wn[k * 3 + 2] as number;
    const o = ((B.faces[k] as Int32Array)[0] as number) * 3;
    const off = fx * (v[o] as number) + fy * (v[o + 1] as number) + fz * (v[o + 2] as number) + margin;
    let out = true;
    for (let c = 0; c < 3 && out; c++) {
      const d = fx * (px[c] as number) + fy * (py[c] as number) + fz * (pz[c] as number);
      // the slab's corner on top, and the one half a unit under it
      if (d <= off || d - 0.5 * fz <= off) out = false;
    }
    if (out) return true;
  }
  return false;
}

/** A new slab shape under a triangle a b c, made as any hull is: top counter-clockwise from above, bottom the other way, three sides. */
function newSlab(body: number, a: P3, b: P3, c: P3): Shape3 {
  const low = (s: P3): P3 => ({ x: s.x, y: s.y, z: s.z - 0.5 });
  const s = makeShape3(body, { kind: 'hull', verts: [a, b, c, low(a), low(b), low(c)], faces: [[0, 1, 2], [3, 5, 4], [0, 3, 4, 1], [1, 4, 5, 2], [2, 5, 3, 0]] }, 0, 0, 0);
  // terrain never moves: its world corners are its own
  s.wv.set(s.lv);
  s.wn.set(s.ln);
  s.we.set(s.le);
  return s;
}

/** The corner q of a terrain grid (row-major by x, ny + 1 a row), into out at k. */
function cornerInto(f: Heightfield, q: number, out: Float64Array, k: number): void {
  const ii = Math.floor(q / (f.ny + 1));
  out[k] = f.x0 + f.dx * ii;
  out[k + 1] = f.y0 + f.dy * (q - ii * (f.ny + 1));
  out[k + 2] = f.h[q] as number;
}

/**
 * The slab under a terrain triangle for the step that asks, undefined where the terrain is undefined. Every triangle
 * is written into the terrain's one slab shape, with the arithmetic of `makeShape3` in its order, so it is to the last
 * bit the slab a new hull would be; it holds until the next call. Keeping a shape for each triangle met made a long
 * drive keep about 14 KB of new shapes a frame, which the young collector copied every collection (1 to 2 ms frames).
 */
function slabOf(f: Heightfield, body: number, i: number, j: number, t: number): Shape3 | undefined {
  const [qa, qb, qc] = triCorners(f, i, j, t);
  if (!Number.isFinite(f.h[qa] as number) || !Number.isFinite(f.h[qb] as number) || !Number.isFinite(f.h[qc] as number)) return undefined;
  const s = f.slab;
  if (!s || s.body !== body) {
    const at = (q: number): P3 => {
      const ii = Math.floor(q / (f.ny + 1));
      return { x: f.x0 + f.dx * ii, y: f.y0 + f.dy * (q - ii * (f.ny + 1)), z: f.h[q] as number };
    };
    const made = newSlab(body, at(qa), at(qb), at(qc));
    // a slab has the four edge directions of a prism (the triangle's three and the upright); reuse needs that shape
    if (made.le.length === 12) f.slab = made;
    return made;
  }
  const lv = s.lv;
  cornerInto(f, qa, lv, 0);
  cornerInto(f, qb, lv, 3);
  cornerInto(f, qc, lv, 6);
  for (let k = 0; k < 9; k += 3) {
    lv[k + 9] = lv[k] as number;
    lv[k + 10] = lv[k + 1] as number;
    lv[k + 11] = (lv[k + 2] as number) - 0.5;
  }
  let reach = 0;
  for (let k = 0; k < 18; k += 3) reach = Math.max(reach, Math.sqrt((lv[k] as number) ** 2 + (lv[k + 1] as number) ** 2 + (lv[k + 2] as number) ** 2));
  const ln = s.ln;
  for (let k = 0; k < s.faces.length; k++) {
    const fc = s.faces[k] as Int32Array;
    // Newell's normal, as makeShape3
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let q = 0; q < fc.length; q++) {
      const a = (fc[q] as number) * 3;
      const b = (fc[(q + 1) % fc.length] as number) * 3;
      nx += ((lv[a + 1] as number) - (lv[b + 1] as number)) * ((lv[a + 2] as number) + (lv[b + 2] as number));
      ny += ((lv[a + 2] as number) - (lv[b + 2] as number)) * ((lv[a] as number) + (lv[b] as number));
      nz += ((lv[a] as number) - (lv[b] as number)) * ((lv[a + 1] as number) + (lv[b + 1] as number));
    }
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    ln[k * 3] = nx / l;
    ln[k * 3 + 1] = ny / l;
    ln[k * 3 + 2] = nz / l;
  }
  // the unique edge directions, as makeShape3 finds them; a triangle that does not give four is made new
  const le = s.le;
  const edges = s.edges;
  let nd = 0;
  for (let e = 0; e < edges.length; e += 2) {
    const a = (edges[e] as number) * 3;
    const b = (edges[e + 1] as number) * 3;
    let dx = (lv[b] as number) - (lv[a] as number);
    let dy = (lv[b + 1] as number) - (lv[a + 1] as number);
    let dz = (lv[b + 2] as number) - (lv[a + 2] as number);
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(l > 1e-12)) continue;
    dx /= l;
    dy /= l;
    dz /= l;
    let dup = false;
    for (let k = 0; k < nd * 3; k += 3) {
      if (Math.abs(dx * (le[k] as number) + dy * (le[k + 1] as number) + dz * (le[k + 2] as number)) > 1 - 1e-9) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    if (nd === 4) {
      nd = -1;
      break;
    }
    le[nd * 3] = dx;
    le[nd * 3 + 1] = dy;
    le[nd * 3 + 2] = dz;
    nd++;
  }
  if (nd !== 4) {
    // not a prism with four directions (never for a real triangle): a new shape, the reused one made whole again later
    f.slab = undefined;
    return slabOf(f, body, i, j, t);
  }
  (s as { reach: number }).reach = reach;
  s.wv.set(lv);
  s.wn.set(ln);
  s.we.set(le);
  return s;
}

/** For tests: the slab of a triangle as `slabOf` writes it into a reused shape, or as a new hull (corners as wv). */
export function terrainSlabForTest(d: { x0: number; y0: number; dx: number; dy: number; nx: number; ny: number; h: Float64Array }, i: number, j: number, t: number, reuse: boolean): { wv: number[]; wn: number[]; we: number[]; edges: number[]; reach: number } | undefined {
  const f: Heightfield = { ...d };
  let s: Shape3 | undefined;
  if (reuse) {
    // first another triangle, so this one is written over it
    slabOf(f, 0, i + 1 < f.nx ? i + 1 : i - 1, j, 1 - t);
    s = slabOf(f, 0, i, j, t);
  } else {
    const [qa, qb, qc] = triCorners(f, i, j, t);
    const at = (q: number): P3 => {
      const ii = Math.floor(q / (f.ny + 1));
      return { x: f.x0 + f.dx * ii, y: f.y0 + f.dy * (q - ii * (f.ny + 1)), z: f.h[q] as number };
    };
    if ([qa, qb, qc].every((q) => Number.isFinite(f.h[q] as number))) s = newSlab(0, at(qa), at(qb), at(qc));
  }
  return s ? { wv: [...s.wv], wn: [...s.wn], we: [...s.we], edges: [...s.edges], reach: s.reach } : undefined;
}

type RayHit = { t: number; nx: number; ny: number; nz: number };

/** A ray against one shape in world space (d of length 1), up to maxT. */
function rayShape(s: Shape3, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | undefined {
  if (s.kind === 0) {
    const cx = ox - (s.wc[0] as number);
    const cy = oy - (s.wc[1] as number);
    const cz = oz - (s.wc[2] as number);
    const b = cx * dx + cy * dy + cz * dz;
    const c = cx * cx + cy * cy + cz * cz - s.r * s.r;
    if (c <= 0) {
      const l = Math.sqrt(cx * cx + cy * cy + cz * cz) || 1;
      return { t: 0, nx: cx / l, ny: cy / l, nz: cz / l };
    }
    const disc = b * b - c;
    if (b > 0 || disc < 0) return undefined;
    const t = -b - Math.sqrt(disc);
    if (t > maxT) return undefined;
    const r = 1 / s.r;
    return { t, nx: (cx + t * dx) * r, ny: (cy + t * dy) * r, nz: (cz + t * dz) * r };
  }
  if (s.kind === 2) {
    const nx = s.lc[0] as number;
    const ny = s.lc[1] as number;
    const nz = s.lc[2] as number;
    const dist = nx * ox + ny * oy + nz * oz - (s.lc[3] as number);
    if (dist <= 0) return { t: 0, nx, ny, nz };
    const den = nx * dx + ny * dy + nz * dz;
    if (den >= 0) return undefined;
    const t = -dist / den;
    return t <= maxT ? { t, nx, ny, nz } : undefined;
  }
  if (s.kind === 1) return rayHull(s, ox, oy, oz, dx, dy, dz, maxT);
  // terrain: the triangles of the cells the ray passes over, from above
  const f = s.hf as Heightfield;
  const ex = ox + dx * maxT;
  const ey = oy + dy * maxT;
  const i0 = Math.max(0, Math.floor((Math.min(ox, ex) - f.x0) / f.dx));
  const i1 = Math.min(f.nx - 1, Math.floor((Math.max(ox, ex) - f.x0) / f.dx));
  const j0 = Math.max(0, Math.floor((Math.min(oy, ey) - f.y0) / f.dy));
  const j1 = Math.min(f.ny - 1, Math.floor((Math.max(oy, ey) - f.y0) / f.dy));
  let best: RayHit | undefined;
  let bt = maxT;
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      for (let t = 0; t < 2; t++) {
        const slab = slabOf(f, s.body, i, j, t);
        if (!slab) continue;
        const r = rayHull(slab, ox, oy, oz, dx, dy, dz, bt);
        if (r && r.t <= bt) {
          bt = r.t;
          best = r;
        }
      }
    }
  }
  return best;
}

/** A ray against a convex hull: the last face plane it enters before it leaves any (the slab method). */
function rayHull(s: Shape3, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | undefined {
  let t0 = 0;
  let t1 = maxT;
  let face = -1;
  let deepest = -Infinity;
  let deepFace = 0;
  const v = s.wv;
  for (let k = 0; k < s.faces.length; k++) {
    const nx = s.wn[k * 3] as number;
    const ny = s.wn[k * 3 + 1] as number;
    const nz = s.wn[k * 3 + 2] as number;
    const o = ((s.faces[k] as Int32Array)[0] as number) * 3;
    const dist = nx * (ox - (v[o] as number)) + ny * (oy - (v[o + 1] as number)) + nz * (oz - (v[o + 2] as number));
    if (dist > deepest) {
      deepest = dist;
      deepFace = k;
    }
    const den = nx * dx + ny * dy + nz * dz;
    if (den === 0) {
      if (dist > 0) return undefined;
      continue;
    }
    const t = -dist / den;
    if (den < 0) {
      if (t > t0) {
        t0 = t;
        face = k;
      }
    } else if (t < t1) t1 = t;
    if (t0 > t1) return undefined;
  }
  // the start is inside: out through the nearest face
  const k = face < 0 ? deepFace : face;
  if (face < 0 && deepest > 0) return undefined;
  return { t: face < 0 ? 0 : t0, nx: s.wn[k * 3] as number, ny: s.wn[k * 3 + 1] as number, nz: s.wn[k * 3 + 2] as number };
}
