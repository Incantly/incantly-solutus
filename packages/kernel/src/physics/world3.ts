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
  private contactMap = new Map<number, Contact3>();
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
    const on = (i: number): boolean => this.type[i] === BodyType3.Dynamic && this.awake[i] === 1;
    return on(j.a) || on(j.b);
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
        for (const [src, dst] of [[s.ln, s.wn], [s.le, s.we]] as const) {
          for (let j = 0; j < src.length; j += 3) {
            const a = src[j] as number;
            const b = src[j + 1] as number;
            const c = src[j + 2] as number;
            dst[j] = (R[r] as number) * a + (R[r + 1] as number) * b + (R[r + 2] as number) * c;
            dst[j + 1] = (R[r + 3] as number) * a + (R[r + 4] as number) * b + (R[r + 5] as number) * c;
            dst[j + 2] = (R[r + 6] as number) * a + (R[r + 7] as number) * b + (R[r + 8] as number) * c;
          }
        }
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

  step(h: number): void {
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
    const v0 = new Float64Array(this.v);
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType3.Dynamic) continue;
      const pushed = this.force[i * 3] !== 0 || this.force[i * 3 + 1] !== 0 || this.force[i * 3 + 2] !== 0 || this.impulse[i * 3] !== 0 || this.impulse[i * 3 + 1] !== 0 || this.impulse[i * 3 + 2] !== 0 || this.torque[i * 3] !== 0 || this.torque[i * 3 + 1] !== 0 || this.torque[i * 3 + 2] !== 0;
      if (pushed && this.awake[i] === 0) this.wakeBody(i);
      for (let a = 0; a < 3; a++) v0[i * 3 + a] = (v0[i * 3 + a] as number) + (this.invM[i] as number) * (this.impulse[i * 3 + a] as number);
    }
    for (let i = 0; i < n; i++) if ((this.type[i] !== BodyType3.Static || this.stepIndex === 0) && !this.gone.has(i)) this.updateShapes(i);
    this.findPairs();
    this.updateContacts(h);
    this.wakeTouched();
    this.initContacts();
    // the soft step (design 6.5), as in the plane: small steps of forces, bounce, warm start, solve, move, relax
    const live = this.joints.filter((j) => this.live(j));
    const S = this.substeps;
    const hs = h / S;
    const inv_hs = 1 / hs;
    this.beginSoft(hs);
    for (let s = 0; s < S; s++) {
      this.pfv.set(this.v);
      this.pfw.set(this.w);
      this.integrateForces(hs, s === 0, S);
      if (s === S - 1) this.impulse.fill(0);
      this.closingSpeeds(hs);
      this.bounceWalls();
      for (const j of live) if (!j.broken) j.initVelocity(this, hs);
      this.warmStart();
      for (const j of live) if (!j.broken) j.solveVelocity(this, hs);
      this.solveSoft(inv_hs, true);
      this.integratePositions(hs);
      for (const j of live) if (!j.broken) j.solveVelocity(this, hs);
      this.solveSoft(inv_hs, false);
      this.bounceBodies();
      this.addUpImpulses();
    }
    // joints only: contacts need no position pass, their soft push-out took the overlap
    if (live.length > 0) {
      for (let it = 0; it < 3; it++) {
        let ok = true;
        for (const j of live) if (!j.broken) ok = j.solvePosition(this) && ok;
        if (ok) break;
      }
    }
    this.countForces(h, v0, inv_hs);
    this.collectHits();
    if (this.sleeping) this.sleepIslands(h);
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType3.Dynamic || this.gone.has(i)) continue;
      if (Math.abs(this.p[i * 3] as number) > this.range || Math.abs(this.p[i * 3 + 1] as number) > this.range || Math.abs(this.p[i * 3 + 2] as number) > this.range) this.left.push(i);
    }
    for (const i of this.left) this.removeBody(i);
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
    const all = this.shapes.length;
    const overlapYZ = (a: number, b: number): boolean =>
      !((hi[a * 3 + 1] as number) < (lo[b * 3 + 1] as number) || (hi[b * 3 + 1] as number) < (lo[a * 3 + 1] as number) || (hi[a * 3 + 2] as number) < (lo[b * 3 + 2] as number) || (hi[b * 3 + 2] as number) < (lo[a * 3 + 2] as number));
    const add = (s1: number, s2: number, b1: number): void => {
      const b2 = (this.shapes[s2] as Shape3).body;
      if (b1 === b2 || !this.mayHit(b1, b2)) return;
      if (this.pairCount === this.pairs.length) {
        const p = new Float64Array(this.pairs.length * 2);
        p.set(this.pairs);
        this.pairs = p;
      }
      this.pairs[this.pairCount++] = (s1 < s2 ? s1 : s2) * all + (s1 < s2 ? s2 : s1);
    };
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
        if (overlapYZ(s1, s2)) add(s1, s2, b1);
      }
      // a sleeping body only meets fixed shapes when it wakes
      if (this.type[b1] === BodyType3.Dynamic && this.awake[b1] === 0) continue;
      for (let j = 0; j < this.fixedBig.length; j++) {
        const s2 = this.fixedBig[j] as number;
        if ((hi[s2 * 3] as number) >= lx && (lo[s2 * 3] as number) <= hx && overlapYZ(s1, s2)) add(s1, s2, b1);
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
        if ((hi[s2 * 3] as number) >= lx && overlapYZ(s1, s2)) add(s1, s2, b1);
      }
    }
    this.pairs.subarray(0, this.pairCount).sort();
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
    for (const j of this.joints) if (!j.broken && ((j.a === a && j.b === b) || (j.a === b && j.b === a))) return false;
    return true;
  }

  private isMoving(i: number): boolean {
    for (let a = 0; a < 3; a++) if (this.v[i * 3 + a] !== 0 || this.w[i * 3 + a] !== 0) return true;
    return false;
  }

  /* ------------------------------ narrow phase ------------------------------ */

  private updateContacts(h: number): void {
    const old = this.contactMap;
    const next = new Map<number, Contact3>();
    const list: Contact3[] = [];
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
      const margin = this.marginOf(A.body, h) + this.marginOf(B.body, h);
      if (A.kind === 3) {
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
              const f = slab ? this.collide(slab, B, margin) : undefined;
              if (!f || f.pts.length === 0) continue;
              let s = Infinity;
              for (const q of f.pts) s = Math.min(s, q.s);
              found.push({ tri: (i * hf.ny + j) * 2 + t, f, s });
            }
          }
        }
        // a shape resting on fine terrain is near many triangles: the closest few carry it (a ball needs one or two)
        found.sort((x, y) => x.s - y.s || x.tri - y.tri);
        const keep = found.slice(0, 4).sort((x, y) => x.tri - y.tri);
        for (const c of keep) this.meet(base + c.tri, sa, sb, A, B, c.f, old, next, list);
        continue;
      }
      this.meet(key, sa, sb, A, B, this.collide(A, B, margin), old, next, list);
    }
    // a sleeping body keeps its touches (and what it reads of them) until it wakes; they are not solved
    for (const [key, c] of old) {
      const still = (i: number): boolean => this.type[i] !== BodyType3.Dynamic || (this.awake[i] === 0 && !this.gone.has(i));
      if (c.touching && still(c.a) && still(c.b)) next.set(key, c);
    }
    this.contactMap = next;
    this.contacts = list;
  }

  /** The contact of one pair of shapes (or one terrain triangle and a shape), keeping last step's impulses. */
  private meet(key: number, sa: number, sb: number, A: Shape3, B: Shape3, found: Found3 | undefined, old: Map<number, Contact3>, next: Map<number, Contact3>, list: Contact3[]): void {
    const prev = old.get(key);
    if (prev) old.delete(key);
    if (!found || found.pts.length === 0) {
      if (prev) {
        prev.pts = [];
        prev.pushed = false;
        prev.touching = false;
        next.set(key, prev);
      }
      return;
    }
    const c: Contact3 = prev ?? { key, a: A.body, b: B.body, sa, sb, nx: 0, ny: 0, nz: 0, pts: [], friction: 0, restitution: 0, pushed: false, touching: false, t1x: 0, t1y: 0, t1z: 0, t2x: 0, t2y: 0, t2z: 0 };
    c.a = A.body;
    c.b = B.body;
    c.sa = sa;
    c.sb = sb;
    c.nx = found.nx;
    c.ny = found.ny;
    c.nz = found.nz;
    const olds = c.pts;
    const pts: CPoint[] = [];
    for (const q of found.pts) {
      // the point on A's surface and on B's: q is on B's, q - s n on A's
      const ax = q.x - q.s * c.nx;
      const ay = q.y - q.s * c.ny;
      const az = q.z - q.s * c.nz;
      const la = this.toLocal(c.a, ax, ay, az);
      const lb = this.toLocal(c.b, q.x, q.y, q.z);
      const cp: CPoint = { ax: la[0], ay: la[1], az: la[2], bx: lb[0], by: lb[1], bz: lb[2], s: q.s, ni: 0, t1i: 0, t2i: 0, rax: 0, ray: 0, raz: 0, rbx: 0, rby: 0, rbz: 0, nm: 0, t1m: 0, t2m: 0, rv: 0, max: 0, tn: 0, t1t: 0, t2t: 0, sv: 0, sf: 0, sg: 0, bi: 0, bounced: 0 };
      // warm start from the old point nearest on B
      let best: CPoint | undefined;
      let bd = 0.04 * 0.04;
      for (const o of olds) {
        const d = (o.bx - cp.bx) ** 2 + (o.by - cp.by) ** 2 + (o.bz - cp.bz) ** 2;
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        cp.ni = best.ni;
        cp.t1i = best.t1i;
        cp.t2i = best.t2i;
      }
      pts.push(cp);
    }
    c.pts = pts;
    const fa = this.fric[c.a] as number;
    const fb = this.fric[c.b] as number;
    c.friction = Number.isNaN(fa) ? (Number.isNaN(fb) ? 0.4 : fb) : Number.isNaN(fb) ? fa : Math.sqrt(fa * fb);
    c.restitution = Math.max(this.rest[c.a] as number, this.rest[c.b] as number);
    next.set(key, c);
    list.push(c);
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

  private marginOf(i: number, h: number): number {
    const sp = Math.sqrt((this.v[i * 3] as number) ** 2 + (this.v[i * 3 + 1] as number) ** 2 + (this.v[i * 3 + 2] as number) ** 2);
    const wm = Math.sqrt((this.w[i * 3] as number) ** 2 + (this.w[i * 3 + 1] as number) ** 2 + (this.w[i * 3 + 2] as number) ** 2);
    return 2 * SLOP + h * (sp + wm * (this.reach[i] as number));
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

  /**
   * Contact points of two shapes within `margin`, on B's surface, with their separations, and the normal from A to B.
   * A is the plane, or the hull of a hull–sphere pair.
   */
  private collide(A: Shape3, B: Shape3, margin: number): { nx: number; ny: number; nz: number; pts: { x: number; y: number; z: number; s: number }[] } | undefined {
    if (A.kind === 2) {
      const nx = A.lc[0] as number;
      const ny = A.lc[1] as number;
      const nz = A.lc[2] as number;
      const d = A.lc[3] as number;
      if (B.kind === 0) {
        const s = nx * (B.wc[0] as number) + ny * (B.wc[1] as number) + nz * (B.wc[2] as number) - d - B.r;
        if (s > margin) return undefined;
        return { nx, ny, nz, pts: [{ x: (B.wc[0] as number) - B.r * nx, y: (B.wc[1] as number) - B.r * ny, z: (B.wc[2] as number) - B.r * nz, s }] };
      }
      if (B.kind === 1) {
        const pts: { x: number; y: number; z: number; s: number }[] = [];
        const wv = B.wv;
        for (let j = 0; j < wv.length; j += 3) {
          const s = nx * (wv[j] as number) + ny * (wv[j + 1] as number) + nz * (wv[j + 2] as number) - d;
          if (s <= margin) pts.push({ x: wv[j] as number, y: wv[j + 1] as number, z: wv[j + 2] as number, s });
        }
        return { nx, ny, nz, pts: reduce4(pts) };
      }
      return undefined;
    }
    if (A.kind === 0 && B.kind === 0) {
      const dx = (B.wc[0] as number) - (A.wc[0] as number);
      const dy = (B.wc[1] as number) - (A.wc[1] as number);
      const dz = (B.wc[2] as number) - (A.wc[2] as number);
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const s = l - A.r - B.r;
      if (s > margin) return undefined;
      const nx = l > 1e-12 ? dx / l : 0;
      const ny = l > 1e-12 ? dy / l : 0;
      const nz = l > 1e-12 ? dz / l : 1;
      return { nx, ny, nz, pts: [{ x: (B.wc[0] as number) - B.r * nx, y: (B.wc[1] as number) - B.r * ny, z: (B.wc[2] as number) - B.r * nz, s }] };
    }
    if (A.kind === 1 && B.kind === 0) return hullSphere(A, B, margin);
    if (A.kind === 1 && B.kind === 1) return hullHull(A, B, margin);
    return undefined;
  }

  /* ------------------------------ solver ------------------------------ */

  private initContacts(): void {
    const v = this.pv;
    const w = this.pw;
    for (const c of this.contacts) {
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
      for (const p of c.pts) {
        const wa = this.toWorld(c.a, p.ax, p.ay, p.az);
        const wb = this.toWorld(c.b, p.bx, p.by, p.bz);
        p.s = nx * (wb[0] - wa[0]) + ny * (wb[1] - wa[1]) + nz * (wb[2] - wa[2]);
        if (p.s < 2 * SLOP) touching = true;
        const mx = 0.5 * (wa[0] + wb[0]);
        const my = 0.5 * (wa[1] + wb[1]);
        const mz = 0.5 * (wa[2] + wb[2]);
        p.rax = mx - (this.p[c.a * 3] as number);
        p.ray = my - (this.p[c.a * 3 + 1] as number);
        p.raz = mz - (this.p[c.a * 3 + 2] as number);
        p.rbx = mx - (this.p[c.b * 3] as number);
        p.rby = my - (this.p[c.b * 3 + 1] as number);
        p.rbz = mz - (this.p[c.b * 3 + 2] as number);
        p.nm = inverseOrZero(this.effMass(c.a, c.b, p, nx, ny, nz));
        p.t1m = inverseOrZero(this.effMass(c.a, c.b, p, c.t1x, c.t1y, c.t1z));
        p.t2m = inverseOrZero(this.effMass(c.a, c.b, p, c.t2x, c.t2y, c.t2z));
        // the approach speed before the step's forces, for bounces and hits
        p.rv = this.relV(c.a, c.b, p, nx, ny, nz, v, w);
        p.max = 0;
      }
      c.touching = touching;
    }
  }

  /** 1/m_a + 1/m_b + n·((I_a⁻¹ (r_a × n)) × r_a) + the same for b. */
  private effMass(a: number, b: number, p: CPoint, nx: number, ny: number, nz: number): number {
    return (this.invM[a] as number) + (this.invM[b] as number) + angTerm(this.invIw, a, p.rax, p.ray, p.raz, nx, ny, nz) + angTerm(this.invIw, b, p.rbx, p.rby, p.rbz, nx, ny, nz);
  }

  private relV(a: number, b: number, p: CPoint, nx: number, ny: number, nz: number, v = this.v, w = this.w): number {
    const vax = (v[a * 3] as number) + (w[a * 3 + 1] as number) * p.raz - (w[a * 3 + 2] as number) * p.ray;
    const vay = (v[a * 3 + 1] as number) + (w[a * 3 + 2] as number) * p.rax - (w[a * 3] as number) * p.raz;
    const vaz = (v[a * 3 + 2] as number) + (w[a * 3] as number) * p.ray - (w[a * 3 + 1] as number) * p.rax;
    const vbx = (v[b * 3] as number) + (w[b * 3 + 1] as number) * p.rbz - (w[b * 3 + 2] as number) * p.rby;
    const vby = (v[b * 3 + 1] as number) + (w[b * 3 + 2] as number) * p.rbx - (w[b * 3] as number) * p.rbz;
    const vbz = (v[b * 3 + 2] as number) + (w[b * 3] as number) * p.rby - (w[b * 3 + 1] as number) * p.rbx;
    return nx * (vbx - vax) + ny * (vby - vay) + nz * (vbz - vaz);
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
    for (const c of this.contacts) {
      for (const p of c.pts) {
        const x = p.ni * c.nx + p.t1i * c.t1x + p.t2i * c.t2x;
        const y = p.ni * c.ny + p.t1i * c.t1y + p.t2i * c.t2y;
        const z = p.ni * c.nz + p.t1i * c.t1z + p.t2i * c.t2z;
        if (x !== 0 || y !== 0 || z !== 0) this.applyAt(c.a, c.b, p.rax, p.ray, p.raz, p.rbx, p.rby, p.rbz, x, y, z);
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

  private beginSoft(hs: number): void {
    if (this.pfv.length !== this.v.length) {
      this.pfv = new Float64Array(this.v.length);
      this.pfw = new Float64Array(this.w.length);
    }
    // a contact is a stiff, heavily damped spring: 30 Hz (at most a quarter of the small steps' rate), damping ratio 10
    const hz = Math.min(CONTACT_HERTZ, 0.25 / hs);
    const soft = (f: number): [number, number, number] => {
      const om = 2 * Math.PI * f;
      const a1 = 2 * CONTACT_DAMPING + hs * om;
      const a2 = hs * om * a1;
      const a3 = 1 / (1 + a2);
      return [om / a1, a2 * a3, a3];
    };
    [this.softBias, this.softMass, this.softImp] = soft(hz);
    [this.wallBias, this.wallMass, this.wallImp] = soft(2 * hz);
    for (const c of this.contacts) {
      for (const p of c.pts) {
        p.tn = p.t1t = p.t2t = 0;
        p.max = 0;
        p.bounced = 0;
      }
    }
  }

  /** Gravity, steady forces, torques, drag, and the step's pushes spread over its small steps, into the speeds. */
  private integrateForces(hs: number, first: boolean, S: number): void {
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
  private integratePositions(hs: number): void {
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

  /** Point p's gap now: its two anchors at the bodies' poses now, along the contact's normal. */
  private gapOf(c: Contact3, p: CPoint): number {
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
    return c.nx * (bx - ax) + c.ny * (by - ay) + c.nz * (bz - az);
  }

  /** Each point's closing speed after the small step's forces; for a point fast enough to bounce, before them and its gap. */
  private closingSpeeds(hs: number): void {
    this.hsNow = hs;
    for (const c of this.contacts) {
      if (c.restitution === 0) continue;
      for (const p of c.pts) {
        p.sf = this.relV(c.a, c.b, p, c.nx, c.ny, c.nz);
        if (p.sf <= -RESTITUTION_THRESHOLD) {
          p.sv = this.relV(c.a, c.b, p, c.nx, c.ny, c.nz, this.pfv, this.pfw);
          p.sg = this.gapOf(c, p);
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
  private solveSoft(inv_hs: number, bias: boolean): void {
    for (const c of this.contacts) {
      const wall = this.type[c.a] !== BodyType3.Dynamic || this.type[c.b] !== BodyType3.Dynamic;
      const sBias = wall ? this.wallBias : this.softBias;
      const sMass = wall ? this.wallMass : this.softMass;
      const sImp = wall ? this.wallImp : this.softImp;
      for (const p of c.pts) {
        // friction in two directions, a box of μ times the push
        const maxF = c.friction * p.ni;
        {
          const vt = this.relV(c.a, c.b, p, c.t1x, c.t1y, c.t1z);
          const old = p.t1i;
          const nw = Math.max(-maxF, Math.min(maxF, old - p.t1m * vt));
          const d = nw - old;
          p.t1i = nw;
          if (d !== 0) this.applyAt(c.a, c.b, p.rax, p.ray, p.raz, p.rbx, p.rby, p.rbz, d * c.t1x, d * c.t1y, d * c.t1z);
        }
        {
          const vt = this.relV(c.a, c.b, p, c.t2x, c.t2y, c.t2z);
          const old = p.t2i;
          const nw = Math.max(-maxF, Math.min(maxF, old - p.t2m * vt));
          const d = nw - old;
          p.t2i = nw;
          if (d !== 0) this.applyAt(c.a, c.b, p.rax, p.ray, p.raz, p.rbx, p.rby, p.rbz, d * c.t2x, d * c.t2y, d * c.t2z);
        }
      }
      for (const p of c.pts) {
        const s = this.gapOf(c, p);
        const vn = this.relV(c.a, c.b, p, c.nx, c.ny, c.nz);
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
        if (d !== 0) this.applyAt(c.a, c.b, p.rax, p.ray, p.raz, p.rbx, p.rby, p.rbz, d * c.nx, d * c.ny, d * c.nz);
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
    for (const p of c.pts) {
      p.bi = 0;
      const q = p.bounced === 0 && (wallStep ? p.sf <= -RESTITUTION_THRESHOLD && p.sg + this.hsNow * p.sf < 0 : p.sv <= -RESTITUTION_THRESHOLD && p.ni > 0);
      if (q) {
        p.bounced = 2;
        any = true;
      }
    }
    if (!any) return;
    for (let it = 0; it < 8; it++) {
      for (const p of c.pts) {
        if (p.bounced !== 2) continue;
        const vn = this.relV(c.a, c.b, p, c.nx, c.ny, c.nz);
        const target = -c.restitution * p.sv;
        const nw = Math.max(0, p.bi + p.nm * (target - vn));
        const d = nw - p.bi;
        p.bi = nw;
        if (d !== 0) this.applyAt(c.a, c.b, p.rax, p.ray, p.raz, p.rbx, p.rby, p.rbz, d * c.nx, d * c.ny, d * c.nz);
      }
    }
    for (const p of c.pts) {
      if (p.bounced !== 2) continue;
      p.bounced = 1;
      p.tn += p.bi;
      if (p.bi > p.max) p.max = p.bi;
    }
  }

  private hsNow = 0;

  /** Off a wall: a point that would go through its gap in this small step turns back now, before it moves. */
  private bounceWalls(): void {
    for (const c of this.contacts) {
      if (c.restitution === 0) continue;
      if (this.type[c.a] === BodyType3.Dynamic && this.type[c.b] === BodyType3.Dynamic) continue;
      this.bounceContact(c, true);
    }
  }

  /** Between two bodies: after the relax pass of the small step where a point first pushes (turning back before the move let a falling stack sink and fall over). */
  private bounceBodies(): void {
    for (const c of this.contacts) {
      if (c.restitution === 0 || this.type[c.a] !== BodyType3.Dynamic || this.type[c.b] !== BodyType3.Dynamic) continue;
      this.bounceContact(c, false);
    }
  }

  /** After a small step: its impulses go into the step's totals and the largest push. */
  private addUpImpulses(): void {
    for (const c of this.contacts) {
      for (const p of c.pts) {
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
    const join = (a: number, b: number): void => {
      if (this.type[a] !== BodyType3.Dynamic || this.type[b] !== BodyType3.Dynamic) return;
      const ra = this.find(a);
      const rb = this.find(b);
      if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
    };
    for (const c of this.contacts) if (c.pts.length > 0) join(c.a, c.b);
    for (const j of this.joints) if (!j.broken) join(j.a, j.b);
  }

  private wakeTouched(): void {
    if (!this.sleeping) return;
    this.islands();
    const n = this.n;
    const awakeIsland = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (this.type[i] === BodyType3.Dynamic && this.awake[i] === 1) awakeIsland[this.find(i)] = 1;
    for (const c of this.contacts) {
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

  private sleepIslands(h: number): void {
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
    const minT = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType3.Dynamic || this.awake[i] === 0) continue;
      const r = this.find(i);
      minT[r] = Math.min(minT[r] as number, this.sleepTime[i] as number);
    }
    for (let i = 0; i < n; i++) if (this.type[i] === BodyType3.Dynamic && this.awake[i] === 1 && (minT[this.find(i)] as number) >= TIME_TO_SLEEP) this.sleepBody(i);
  }

  private countForces(h: number, v0: Float64Array, inv_hs: number): void {
    const inv_h = 1 / h;
    const add = (i: number, k: number, x: number, y: number, z: number): void => {
      if (this.type[i] !== BodyType3.Dynamic || this.awake[i] === 0) return;
      const o = i * NK * 3 + k * 3;
      this.forces[o] = (this.forces[o] as number) + x;
      this.forces[o + 1] = (this.forces[o + 1] as number) + y;
      this.forces[o + 2] = (this.forces[o + 2] as number) + z;
    };
    for (const c of this.contacts) {
      let ni = 0;
      let f1 = 0;
      let f2 = 0;
      // the step's impulses, added up over its small steps
      for (const p of c.pts) {
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
      add(c.b, FK3.normal, nx, ny, nz);
      add(c.a, FK3.normal, -nx, -ny, -nz);
      add(c.b, FK3.friction, fx, fy, fz);
      add(c.a, FK3.friction, -fx, -fy, -fz);
    }
    for (const j of this.joints) {
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
    for (const c of this.contacts) {
      let pushing = false;
      let rv = 0;
      let imp = 0;
      for (const p of c.pts) {
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

  touchingAll(): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.n; i++) out.push([]);
    for (const c of this.contactMap.values()) {
      if (!c.touching) continue;
      if (!(out[c.a] as number[]).includes(c.b)) (out[c.a] as number[]).push(c.b);
      if (!(out[c.b] as number[]).includes(c.a)) (out[c.b] as number[]).push(c.a);
    }
    for (const l of out) l.sort((x, y) => x - y);
    return out;
  }

  get contactCount(): number {
    let k = 0;
    for (const c of this.contactMap.values()) if (c.touching) k += c.pts.length;
    return k;
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
    for (const c of this.contacts) {
      if (!c.touching) continue;
      for (const p of c.pts) {
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
    for (const c of this.contactMap.values()) {
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
    this.contactMap = new Map();
    this.contacts = [];
    const nc = s[k++] as number;
    for (let i = 0; i < nc; i++) {
      const key = s[k++] as number;
      const np = s[k++] as number;
      const flags = s[k++] as number;
      const [sa, sb] = this.shapesOfKey(key);
      const c: Contact3 = { key, a: (this.shapes[sa] as Shape3).body, b: (this.shapes[sb] as Shape3).body, sa, sb, nx: s[k++] as number, ny: s[k++] as number, nz: s[k++] as number, pts: [], friction: 0, restitution: 0, pushed: (flags & 2) === 2, touching: (flags & 1) === 1, t1x: 0, t1y: 0, t1z: 0, t2x: 0, t2y: 0, t2z: 0 };
      for (let q = 0; q < np; q++) {
        c.pts.push({ ax: s[k++] as number, ay: s[k++] as number, az: s[k++] as number, bx: s[k++] as number, by: s[k++] as number, bz: s[k++] as number, s: 0, ni: s[k++] as number, t1i: s[k++] as number, t2i: s[k++] as number, rax: 0, ray: 0, raz: 0, rbx: 0, rby: 0, rbz: 0, nm: 0, t1m: 0, t2m: 0, rv: 0, max: 0, tn: 0, t1t: 0, t2t: 0, sv: 0, sf: 0, sg: 0, bi: 0, bounced: 0 });
      }
      this.contactMap.set(key, c);
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

function inverseOrZero(k: number): number {
  return k > 0 ? 1 / k : 0;
}

/** n · ((I⁻¹ (r × n)) × r) for body i. */
function angTerm(I: Float64Array, i: number, rx: number, ry: number, rz: number, nx: number, ny: number, nz: number): number {
  const cx = ry * nz - rz * ny;
  const cy = rz * nx - rx * nz;
  const cz = rx * ny - ry * nx;
  const o = i * 9;
  const ix = (I[o] as number) * cx + (I[o + 1] as number) * cy + (I[o + 2] as number) * cz;
  const iy = (I[o + 3] as number) * cx + (I[o + 4] as number) * cy + (I[o + 5] as number) * cz;
  const iz = (I[o + 6] as number) * cx + (I[o + 7] as number) * cy + (I[o + 8] as number) * cz;
  return cx * ix + cy * iy + cz * iz;
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

/** At most four points: the deepest, the furthest from it, then the two that widen the patch most. */
function reduce4<T extends { x: number; y: number; z: number; s: number }>(pts: T[]): T[] {
  if (pts.length <= 4) return pts;
  let a = pts[0] as T;
  for (const p of pts) if (p.s < a.s) a = p;
  let b = a;
  let bd = -1;
  for (const p of pts) {
    const d = (p.x - a.x) ** 2 + (p.y - a.y) ** 2 + (p.z - a.z) ** 2;
    if (d > bd) {
      bd = d;
      b = p;
    }
  }
  // the point furthest from the line a b
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  let c = a;
  let cd = -1;
  for (const p of pts) {
    const vx = p.x - a.x;
    const vy = p.y - a.y;
    const vz = p.z - a.z;
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const d = cx * cx + cy * cy + cz * cz;
    if (d > cd) {
      cd = d;
      c = p;
    }
  }
  // the point furthest from the middle of a, b, c on the other side
  const mx = (a.x + b.x + c.x) / 3;
  const my = (a.y + b.y + c.y) / 3;
  const mz = (a.z + b.z + c.z) / 3;
  let d4 = a;
  let dd = -1;
  for (const p of pts) {
    if (p === a || p === b || p === c) continue;
    const d = (p.x - mx) ** 2 + (p.y - my) ** 2 + (p.z - mz) ** 2;
    if (d > dd) {
      dd = d;
      d4 = p;
    }
  }
  return [a, b, c, d4].filter((p, i, arr) => arr.indexOf(p) === i);
}

/** Projection of a hull's world corners on an axis: [min, max]. */
function project(s: Shape3, x: number, y: number, z: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const v = s.wv;
  for (let j = 0; j < v.length; j += 3) {
    const d = (v[j] as number) * x + (v[j + 1] as number) * y + (v[j + 2] as number) * z;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

/** A hull against a sphere: the closest point of the hull to the sphere's centre. */
function hullSphere(A: Shape3, B: Shape3, margin: number): { nx: number; ny: number; nz: number; pts: { x: number; y: number; z: number; s: number }[] } | undefined {
  const cx = B.wc[0] as number;
  const cy = B.wc[1] as number;
  const cz = B.wc[2] as number;
  const v = A.wv;
  let best: [number, number, number] | undefined;
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
    const q = closestOnFace(v, f, nx, ny, nz, cx, cy, cz);
    const d = (q[0] - cx) ** 2 + (q[1] - cy) ** 2 + (q[2] - cz) ** 2;
    if (d < bd) {
      bd = d;
      best = q;
    }
  }
  if (best) {
    const d = Math.sqrt(bd);
    const s = d - B.r;
    if (s > margin) return undefined;
    const nx = d > 1e-12 ? (cx - best[0]) / d : (A.wn[deepFace * 3] as number);
    const ny = d > 1e-12 ? (cy - best[1]) / d : (A.wn[deepFace * 3 + 1] as number);
    const nz = d > 1e-12 ? (cz - best[2]) / d : (A.wn[deepFace * 3 + 2] as number);
    return { nx, ny, nz, pts: [{ x: cx - B.r * nx, y: cy - B.r * ny, z: cz - B.r * nz, s }] };
  }
  // the centre is inside: push out through the nearest face
  const nx = A.wn[deepFace * 3] as number;
  const ny = A.wn[deepFace * 3 + 1] as number;
  const nz = A.wn[deepFace * 3 + 2] as number;
  return { nx, ny, nz, pts: [{ x: cx - B.r * nx, y: cy - B.r * ny, z: cz - B.r * nz, s: deepest - B.r }] };
}

/** The point of a flat convex face nearest to (x, y, z). */
function closestOnFace(v: Float64Array, f: Int32Array, nx: number, ny: number, nz: number, x: number, y: number, z: number): [number, number, number] {
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
  if (inside) return [px, py, pz];
  let best: [number, number, number] = [v[o] as number, v[o + 1] as number, v[o + 2] as number];
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
      best = [qx, qy, qz];
    }
  }
  return best;
}

/**
 * Two hulls: separating axes (face normals of both, then cross products of their edge directions). The axis of least
 * overlap gives the normal; a face axis gives points by clipping the other hull's most opposed face to the face's
 * sides, an edge axis the nearest points of the two edges.
 */
function hullHull(A: Shape3, B: Shape3, margin: number): { nx: number; ny: number; nz: number; pts: { x: number; y: number; z: number; s: number }[] } | undefined {
  const ca = centre(A);
  const cb = centre(B);
  let bestSep = -Infinity;
  let bx = 0;
  let by = 0;
  let bz = 0;
  let kind = 0; // 1 face of A, 2 face of B, 3 edges
  let index = -1;
  const test = (x: number, y: number, z: number, k: number, i: number, bias = 0): boolean => {
    const [a0, a1] = project(A, x, y, z);
    const [b0, b1] = project(B, x, y, z);
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
    } else if ((cb[0] - ca[0]) * x + (cb[1] - ca[1]) * y + (cb[2] - ca[2]) * z >= 0) sep = b0 - a1;
    else {
      sep = a0 - b1;
      sx = -x;
      sy = -y;
      sz = -z;
    }
    if (sep > margin) return false;
    if (sep - bias > bestSep) {
      bestSep = sep - bias;
      bx = sx;
      by = sy;
      bz = sz;
      kind = k;
      index = i;
    }
    return true;
  };
  for (let k = 0; k < A.faces.length; k++) if (!test(A.wn[k * 3] as number, A.wn[k * 3 + 1] as number, A.wn[k * 3 + 2] as number, 1, k)) return undefined;
  for (let k = 0; k < B.faces.length; k++) if (!test(B.wn[k * 3] as number, B.wn[k * 3 + 1] as number, B.wn[k * 3 + 2] as number, 2, k, 1e-4)) return undefined;
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
      // edge axes win only when clearly better, so resting faces keep face contacts
      if (!test(x, y, z, 3, i * 100000 + j, 0.01)) return undefined;
    }
  }
  if (kind === 3) {
    // the deepest corner of B along -n and of A along n give the two edges' region: take the corner pair midpoint
    const pa = support(A, bx, by, bz);
    const pb = support(B, -bx, -by, -bz);
    const s = bestSep + 0.002;
    const qx = 0.5 * (pa[0] + pb[0] + s * bx);
    const qy = 0.5 * (pa[1] + pb[1] + s * by);
    const qz = 0.5 * (pa[2] + pb[2] + s * bz);
    return { nx: bx, ny: by, nz: bz, pts: [{ x: qx, y: qy, z: qz, s }] };
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
  let poly: number[] = [];
  const f = inc.faces[inF] as Int32Array;
  for (let i = 0; i < f.length; i++) {
    const o = (f[i] as number) * 3;
    poly.push(inc.wv[o] as number, inc.wv[o + 1] as number, inc.wv[o + 2] as number);
  }
  // clip to the side planes of the reference face
  const rv = ref.wv;
  for (let i = 0; i < rf.length && poly.length > 0; i++) {
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
    const off = (sx * (rv[a] as number) + sy * (rv[a + 1] as number) + sz * (rv[a + 2] as number)) / sl + 2 * SLOP;
    poly = clipPoly(poly, sx / sl, sy / sl, sz / sl, off);
  }
  const fo = (rf[0] as number) * 3;
  const plane = rnx * (rv[fo] as number) + rny * (rv[fo + 1] as number) + rnz * (rv[fo + 2] as number);
  const pts: { x: number; y: number; z: number; s: number }[] = [];
  for (let i = 0; i < poly.length; i += 3) {
    const x = poly[i] as number;
    const y = poly[i + 1] as number;
    const z = poly[i + 2] as number;
    const s = rnx * x + rny * y + rnz * z - plane;
    if (s > margin) continue;
    if (kind === 1) pts.push({ x, y, z, s });
    else {
      // the point on B's surface: on the reference face, and the normal from A to B
      pts.push({ x: x - s * rnx, y: y - s * rny, z: z - s * rnz, s });
    }
  }
  return { nx: bx, ny: by, nz: bz, pts: reduce4(pts) };
}

function centre(s: Shape3): [number, number, number] {
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
  return [x / n, y / n, z / n];
}

function support(s: Shape3, x: number, y: number, z: number): [number, number, number] {
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
  return [v[best] as number, v[best + 1] as number, v[best + 2] as number];
}

/** Keeps the part of a polygon (packed x, y, z) where n · p ≤ off. */
function clipPoly(poly: number[], nx: number, ny: number, nz: number, off: number): number[] {
  const out: number[] = [];
  const n = poly.length / 3;
  for (let i = 0; i < n; i++) {
    const a = i * 3;
    const b = ((i + 1) % n) * 3;
    const da = nx * (poly[a] as number) + ny * (poly[a + 1] as number) + nz * (poly[a + 2] as number) - off;
    const db = nx * (poly[b] as number) + ny * (poly[b + 1] as number) + nz * (poly[b + 2] as number) - off;
    if (da <= 0) out.push(poly[a] as number, poly[a + 1] as number, poly[a + 2] as number);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push((poly[a] as number) + t * ((poly[b] as number) - (poly[a] as number)), (poly[a + 1] as number) + t * ((poly[b + 1] as number) - (poly[a + 1] as number)), (poly[a + 2] as number) + t * ((poly[b + 2] as number) - (poly[a + 2] as number)));
    }
  }
  return out;
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
