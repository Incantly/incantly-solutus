/**
 * The plane physics world (docs/features/physics/design.md 6): rigid bodies of circles and convex polygons, sweep and
 * prune, speculative contacts, sequential impulses with warm starting, restitution after the velocity passes, a
 * non-linear position pass that adds no energy, Coulomb friction, sleeping islands, bullets, per-kind force accounting,
 * and checkpoints that hold everything a step reads.
 *
 * Deterministic: a fixed step, exact maths (`./math`), and every loop in a fixed order (pairs sorted by key).
 */
import type { Manifold, Poses, Shape2, WorldManifold } from './collide2';
import { collideCircles, collidePolygonCircle, collidePolygons, newManifold, newWorldManifold, worldManifold } from './collide2';
import type { Pt } from './geom2';
import { sincos } from './math';

export const BodyType = { Static: 0, Kinematic: 1, Dynamic: 2 } as const;
export type BodyType = (typeof BodyType)[keyof typeof BodyType];

/** Force kinds counted per body (design 2.4, `b.force(kind)`). */
export const FORCE_KINDS = ['gravity', 'normal', 'friction', 'tension', 'spring', 'buoyancy', 'drag', 'electric', 'applied', 'net'] as const;
export type ForceKind = (typeof FORCE_KINDS)[number];
export const FK = { gravity: 0, normal: 1, friction: 2, tension: 3, spring: 4, buoyancy: 5, drag: 6, electric: 7, applied: 8, net: 9 } as const;
const NK = FORCE_KINDS.length;

export type ShapeDef2 = { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number } | { readonly kind: 'poly'; readonly pts: readonly Pt[] };

/** One body as the driver builds it. Shapes are in world space at the start; the world moves them to the body frame. */
export interface BodyDef2 {
  readonly type: BodyType;
  readonly shapes: readonly ShapeDef2[];
  /** Total mass (dynamic); from `density` and the area when absent. */
  readonly mass?: number;
  readonly density?: number;
  readonly vx?: number;
  readonly vy?: number;
  readonly w?: number;
  readonly friction?: number;
  readonly bounce?: number;
  readonly turns?: boolean;
  readonly bullet?: boolean;
  readonly group?: number;
  readonly charge?: number;
  /** For a body: the centre of mass and the angle are found from the shapes; for a wall the frame is the world. */
}

/** What a joint must do for the solver (round 2 adds the kinds). */
export interface Joint2 {
  readonly a: number;
  readonly b: number;
  broken: boolean;
  initVelocity(w: World2, h: number): void;
  warmStart(w: World2): void;
  solveVelocity(w: World2, h: number): void;
  /** True when the joint is within tolerance. */
  solvePosition(w: World2): boolean;
  /** The impulse it applied this step on b (to count tension and spring forces), as x, y and the kind index. */
  readonly kind: number;
  impulseX: number;
  impulseY: number;
  /** The joint's own state for checkpoints. */
  save(out: number[]): void;
  load(src: Float64Array, at: number): number;
  /** Potential energy stored (springs). */
  energy(w: World2): number;
  /** Breaks when the force goes over this. */
  readonly breaks: number;
}

interface Contact {
  /** The step (`contactStamp`) that last met this contact's pair: one the new step did not meet goes back to the pool. */
  stamp: number;
  key: number;
  sa: number;
  sb: number;
  a: number;
  b: number;
  m: Manifold;
  /** Accumulated impulses of the two points, kept for warm starting, matched by id. */
  ni0: number;
  ti0: number;
  ni1: number;
  ti1: number;
  friction: number;
  restitution: number;
  touching: boolean;
  wasTouching: boolean;
  /** The contact pushed in the last step (for hits). */
  pushed: boolean;
  /** Soft step: each point's gap at the narrow phase less its anchors' gap then, so a small step's gap is this plus the anchors' gap now. */
  adj0: number;
  adj1: number;
  /** Soft step: the impulses of the whole step (the small steps' added up), for the force readouts and hits. */
  tn0: number;
  tn1: number;
  tt0: number;
  tt1: number;
  /** Soft step: each point's closing speed at the start of this small step (before its forces), and whether it bounced. */
  sv0: number;
  sv1: number;
  /** The gap at the start of the small step, and the closing speed after its forces. */
  sg0: number;
  sg1: number;
  sf0: number;
  sf1: number;
  bounced0: boolean;
  bounced1: boolean;
  // solver data
  nx: number;
  ny: number;
  rAx0: number;
  rAy0: number;
  rBx0: number;
  rBy0: number;
  rAx1: number;
  rAy1: number;
  rBx1: number;
  rBy1: number;
  nm0: number;
  tm0: number;
  nm1: number;
  tm1: number;
  rv0: number;
  rv1: number;
  s0: number;
  s1: number;
  max0: number;
  max1: number;
  px0: number;
  py0: number;
  /** Block solver data for two points. */
  block: boolean;
  k11: number;
  k22: number;
  k12: number;
  i11: number;
  i22: number;
  i12: number;
}

/** A new touch faster than 0.05 m/s (design 2.4, events). */
export interface Hit2 {
  readonly a: number;
  readonly b: number;
  readonly speed: number;
  readonly x: number;
  readonly y: number;
  readonly impulse: number;
}

export const LINEAR_SLOP = 0.005;
const RESTITUTION_THRESHOLD = 1;
const HIT_THRESHOLD = 0.05;
const SLEEP_LIN = 0.01;
const SLEEP_ANG = 0.02;
const TIME_TO_SLEEP = 0.5;
const MAX_TRANSLATION = 50;
/** Soft contacts (design 6.5): stiffness in Hz, damping ratio, and the fastest push-out of an overlap, m/s. */
const CONTACT_HERTZ = 30;
const CONTACT_DAMPING = 10;
const MAX_PUSH_OUT = 3;
export const MAX_CONTACT_POINTS = 4000;

export class World2 implements Poses {
  /** Bodies. */
  n = 0;
  type = new Uint8Array(0);
  px = new Float64Array(0);
  py = new Float64Array(0);
  ang = new Float64Array(0);
  qc = new Float64Array(0);
  qs = new Float64Array(0);
  vx = new Float64Array(0);
  vy = new Float64Array(0);
  w = new Float64Array(0);
  invM = new Float64Array(0);
  invI = new Float64Array(0);
  mass = new Float64Array(0);
  inertia = new Float64Array(0);
  fric = new Float64Array(0);
  rest = new Float64Array(0);
  charge = new Float64Array(0);
  group = new Int32Array(0);
  bullet = new Uint8Array(0);
  awake = new Uint8Array(0);
  sleepTime = new Float64Array(0);
  /** Steady forces and torques set each step by the driver. */
  fx = new Float64Array(0);
  fy = new Float64Array(0);
  torque = new Float64Array(0);
  /** Impulses to apply at the next step (Push), and at which point. */
  jx = new Float64Array(0);
  jy = new Float64Array(0);
  jt = new Float64Array(0);
  /** Forces by kind in the last step: x then y for each kind. */
  forces = new Float64Array(0);
  /** Smallest extent of each body, for the bullet test. */
  extent = new Float64Array(0);
  /** Largest distance from the centre to a corner, for the speculative margin. */
  reach = new Float64Array(0);
  /** First shape and number of shapes of each body. */
  shape0 = new Int32Array(0);
  shapeN = new Int32Array(0);

  shapes: Shape2[] = [];
  /** Fat boxes of the shapes. */
  minX = new Float64Array(0);
  minY = new Float64Array(0);
  maxX = new Float64Array(0);
  maxY = new Float64Array(0);
  private sap = new Int32Array(0);

  joints: Joint2[] = [];
  private contacts: Contact[] = [];
  private contactMap = new ContactTable();
  private contactStamp = 0;
  private pool: Contact[] = [];
  private pairs = new Float64Array(256);
  private pairCount = 0;
  hits: Hit2[] = [];
  /** Number of steps taken since the start. */
  stepIndex = 0;
  contactsDropped = false;

  gx = 0;
  gy = -9.8;
  air = 0;
  passes = 8;
  sleeping = true;
  /** Bodies outside this square (half size) are taken out: `world.range`. */
  range = 50;
  left: number[] = [];

  private wm: WorldManifold = newWorldManifold();
  private pvx = new Float64Array(0);
  private pvy = new Float64Array(0);
  private pw = new Float64Array(0);
  private sc = new Float64Array(2);

  constructor(defs: readonly BodyDef2[]) {
    this.build(defs);
  }

  /* ------------------------------ building ------------------------------ */

  private build(defs: readonly BodyDef2[]): void {
    const n = defs.length;
    this.n = n;
    this.type = new Uint8Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.ang = new Float64Array(n);
    this.qc = new Float64Array(n).fill(1);
    this.qs = new Float64Array(n);
    this.vx = new Float64Array(n);
    this.vy = new Float64Array(n);
    this.w = new Float64Array(n);
    this.invM = new Float64Array(n);
    this.invI = new Float64Array(n);
    this.mass = new Float64Array(n);
    this.inertia = new Float64Array(n);
    this.fric = new Float64Array(n);
    this.rest = new Float64Array(n);
    this.charge = new Float64Array(n);
    this.group = new Int32Array(n);
    this.bullet = new Uint8Array(n);
    this.awake = new Uint8Array(n).fill(1);
    this.sleepTime = new Float64Array(n);
    this.fx = new Float64Array(n);
    this.fy = new Float64Array(n);
    this.torque = new Float64Array(n);
    this.jx = new Float64Array(n);
    this.jy = new Float64Array(n);
    this.jt = new Float64Array(n);
    this.forces = new Float64Array(n * NK * 2);
    this.extent = new Float64Array(n);
    this.reach = new Float64Array(n);
    this.shape0 = new Int32Array(n);
    this.shapeN = new Int32Array(n);
    this.shapes = [];
    for (let i = 0; i < n; i++) this.addBody(i, defs[i] as BodyDef2);
    const ns = this.shapes.length;
    this.minX = new Float64Array(ns);
    this.minY = new Float64Array(ns);
    this.maxX = new Float64Array(ns);
    this.maxY = new Float64Array(ns);
    this.sap = new Int32Array(ns);
    for (let i = 0; i < ns; i++) this.sap[i] = i;
    for (let b = 0; b < n; b++) this.updateShapes(b);
  }

  private addBody(i: number, d: BodyDef2): void {
    this.type[i] = d.type;
    this.fric[i] = d.friction ?? (d.type === BodyType.Dynamic ? 0.4 : Number.NaN);
    this.rest[i] = d.bounce ?? (d.type === BodyType.Dynamic ? 0.2 : 0);
    this.charge[i] = d.charge ?? 0;
    this.group[i] = d.group ?? 0;
    this.bullet[i] = d.bullet === true ? 1 : 0;
    // mass properties from the shapes, in world space at the start
    let area = 0;
    let cx = 0;
    let cy = 0;
    let I0 = 0;
    const parts: { m: number; x: number; y: number; i: number }[] = [];
    for (const s of d.shapes) {
      if (s.kind === 'circle') {
        const a = Math.PI * s.r * s.r;
        parts.push({ m: a, x: s.x, y: s.y, i: 0.5 * a * s.r * s.r });
      } else {
        const mp = polyMass(s.pts);
        parts.push({ m: mp.area, x: mp.cx, y: mp.cy, i: mp.inertia });
      }
    }
    for (const p of parts) {
      area += p.m;
      cx += p.m * p.x;
      cy += p.m * p.y;
    }
    if (d.type === BodyType.Dynamic && area > 0) {
      cx /= area;
      cy /= area;
      for (const p of parts) I0 += p.i + p.m * ((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
      const density = d.mass !== undefined && d.mass > 0 ? d.mass / area : (d.density ?? 1);
      const mass = density * area;
      const inertia = density * I0;
      this.mass[i] = mass;
      this.inertia[i] = inertia;
      this.invM[i] = mass > 0 ? 1 / mass : 0;
      this.invI[i] = d.turns === false || !(inertia > 0) ? 0 : 1 / inertia;
    } else {
      // walls and movers keep the world as their frame
      cx = 0;
      cy = 0;
    }
    this.px[i] = cx;
    this.py[i] = cy;
    this.vx[i] = d.vx ?? 0;
    this.vy[i] = d.vy ?? 0;
    this.w[i] = d.w ?? 0;
    this.shape0[i] = this.shapes.length;
    let ext = Infinity;
    let reach = 0;
    for (const s of d.shapes) {
      const sh = makeShape(i, s, cx, cy);
      this.shapes.push(sh);
      if (sh.kind === 0) {
        ext = Math.min(ext, 2 * sh.radius);
        reach = Math.max(reach, Math.sqrt(sh.lcx * sh.lcx + sh.lcy * sh.lcy) + sh.radius);
      } else {
        for (let k = 0; k < sh.lx.length; k++) reach = Math.max(reach, Math.sqrt((sh.lx[k] as number) ** 2 + (sh.ly[k] as number) ** 2));
        ext = Math.min(ext, polyWidth(sh));
      }
    }
    this.shapeN[i] = d.shapes.length;
    this.extent[i] = Number.isFinite(ext) ? ext : 0;
    this.reach[i] = reach;
  }

  /** Replaces the shapes of a wall or mover (a mover that changed shape), keeping its frame the world. */
  setStaticShapes(b: number, defs: readonly ShapeDef2[]): boolean {
    if (defs.length !== this.shapeN[b]) return false;
    const s0 = this.shape0[b] as number;
    for (let k = 0; k < defs.length; k++) {
      const d = defs[k] as ShapeDef2;
      const old = this.shapes[s0 + k] as Shape2;
      const sh = makeShape(b, d, 0, 0);
      if (sh.kind !== old.kind || sh.lx.length !== old.lx.length) return false;
      this.shapes[s0 + k] = sh;
    }
    this.updateShapes(b);
    return true;
  }

  /** World-space corners and normals and the fat box of each shape of body b. */
  updateShapes(b: number): void {
    const c = this.qc[b] as number;
    const s = this.qs[b] as number;
    const x = this.px[b] as number;
    const y = this.py[b] as number;
    const h = 1 / 120;
    const margin = 4 * LINEAR_SLOP + h * (Math.sqrt((this.vx[b] as number) ** 2 + (this.vy[b] as number) ** 2) + Math.abs(this.w[b] as number) * (this.reach[b] as number));
    const s0 = this.shape0[b] as number;
    const sn = this.shapeN[b] as number;
    for (let k = s0; k < s0 + sn; k++) {
      const sh = this.shapes[k] as Shape2;
      let mnx: number;
      let mny: number;
      let mxx: number;
      let mxy: number;
      if (sh.kind === 0) {
        sh.wcx = x + c * sh.lcx - s * sh.lcy;
        sh.wcy = y + s * sh.lcx + c * sh.lcy;
        mnx = sh.wcx - sh.radius;
        mxx = sh.wcx + sh.radius;
        mny = sh.wcy - sh.radius;
        mxy = sh.wcy + sh.radius;
      } else {
        mnx = Infinity;
        mny = Infinity;
        mxx = -Infinity;
        mxy = -Infinity;
        const nv = sh.lx.length;
        for (let i = 0; i < nv; i++) {
          const lx = sh.lx[i] as number;
          const ly = sh.ly[i] as number;
          const wx = x + c * lx - s * ly;
          const wy = y + s * lx + c * ly;
          sh.wx[i] = wx;
          sh.wy[i] = wy;
          const nx = sh.lnx[i] as number;
          const ny = sh.lny[i] as number;
          sh.wnx[i] = c * nx - s * ny;
          sh.wny[i] = s * nx + c * ny;
          if (wx < mnx) mnx = wx;
          if (wx > mxx) mxx = wx;
          if (wy < mny) mny = wy;
          if (wy > mxy) mxy = wy;
        }
      }
      this.minX[k] = mnx - margin;
      this.minY[k] = mny - margin;
      this.maxX[k] = mxx + margin;
      this.maxY[k] = mxy + margin;
    }
  }

  /** Sets the pose of a wall or mover for the next step, with the speed implied by the move over `h`. */
  moveKinematic(b: number, x: number, y: number, a: number, h: number): void {
    this.vx[b] = (x - (this.px[b] as number)) / h;
    this.vy[b] = (y - (this.py[b] as number)) / h;
    this.w[b] = (a - (this.ang[b] as number)) / h;
  }

  /* ------------------------------ the step ------------------------------ */

  /**
   * The step's length, set by the driver before `step` (a field, not an argument: a number passed in a call is a heap
   * number, garbage in every step, design 11.4), and the small step's length and its inverse, set by `step`.
   */
  hStep = 1 / 120;
  private hsNow = 0;
  private invHs = 0;

  step(): void {
    const h = this.hStep;
    this.hits.length = 0;
    this.left.length = 0;
    const n = this.n;
    // a sleeping body keeps the forces of its last step: at rest they balance, and its arrows stay
    for (let i = 0; i < n; i++) if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 1) this.forces.fill(0, i * NK * 2, (i + 1) * NK * 2);
    // the speeds before this step's forces: a bounce sends back the speed the body came in with, so it adds no energy
    if (this.pvx.length !== n) {
      this.pvx = new Float64Array(n);
      this.pvy = new Float64Array(n);
      this.pw = new Float64Array(n);
    }
    this.pvx.set(this.vx);
    this.pvy.set(this.vy);
    this.pw.set(this.w);
    // pushes and steady forces wake a body
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 1) continue;
      const pushed = this.jx[i] !== 0 || this.jy[i] !== 0 || this.jt[i] !== 0 || this.fx[i] !== 0 || this.fy[i] !== 0 || this.torque[i] !== 0;
      if (pushed) this.wakeBody(i);
    }
    // the speeds at the start of the step with this step's pushes, for the net force (a push is not a force)
    const v0x = this.scratchA(n);
    const v0y = this.scratchB(n);
    for (let i = 0; i < n; i++) {
      v0x[i] = (this.vx[i] as number) + (this.invM[i] as number) * (this.jx[i] as number);
      v0y[i] = (this.vy[i] as number) + (this.invM[i] as number) * (this.jy[i] as number);
    }
    // 1. boxes, pairs, contacts (once a step)
    for (let i = 0; i < n; i++) if ((this.type[i] !== BodyType.Static || this.stepIndex === 0) && !this.gone.has(i)) this.updateShapes(i);
    if (this.joints.length > 0) this.noteJointPairs();
    this.findPairs();
    this.updateContacts();
    // 2. islands: wake what a moving body touches, put still islands to sleep later
    this.wakeTouched();
    // 3. the soft step (design 6.5): small steps of forces, warm start, one solve, move, one relax
    // (indexed loops and fields throughout: an iterator or a number passed in a call is garbage in every step, design 11.4)
    const S = this.substeps;
    const hs = h / S;
    const joints = this.joints;
    this.hsNow = hs;
    this.invHs = 1 / hs;
    this.initContacts();
    this.beginSoft();
    for (let s = 0; s < S; s++) {
      // the speeds before the small step's forces, for the bounces' closing speeds
      this.pfx.set(this.vx);
      this.pfy.set(this.vy);
      this.pfw.set(this.w);
      this.integrateForces(s === 0, S);
      if (s === S - 1) {
        this.jx.fill(0);
        this.jy.fill(0);
        this.jt.fill(0);
      }
      this.closingSpeeds();
      // a point that would go through its gap in this small step bounces now, before it moves (design 6.5)
      this.bounce();
      for (let q = 0; q < joints.length; q++) {
        const j = joints[q] as Joint2;
        if (!j.broken && this.active(j.a, j.b)) j.initVelocity(this, hs);
      }
      this.warmStart();
      for (let q = 0; q < joints.length; q++) {
        const j = joints[q] as Joint2;
        if (!j.broken && this.active(j.a, j.b)) j.warmStart(this);
      }
      for (let q = 0; q < joints.length; q++) {
        const j = joints[q] as Joint2;
        if (!j.broken && this.active(j.a, j.b)) j.solveVelocity(this, hs);
      }
      this.solveSoft(true);
      this.integratePositions();
      for (let q = 0; q < joints.length; q++) {
        const j = joints[q] as Joint2;
        if (!j.broken && this.active(j.a, j.b)) j.solveVelocity(this, hs);
      }
      this.solveSoft(false);
      this.bounceBodies();
      this.addUpImpulses();
    }
    // 5. fast bodies: swept against walls over the whole step
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) continue;
      const ox = this.sx0[i] as number;
      const oy = this.sy0[i] as number;
      const d2 = ((this.px[i] as number) - ox) ** 2 + ((this.py[i] as number) - oy) ** 2;
      if (this.bullet[i] === 1 || Math.sqrt(d2) > 0.5 * (this.extent[i] as number)) this.sweep(i, ox, oy);
    }
    // 6. joint position passes (never add speed); contacts need none, their soft push-out took the overlap
    if (joints.length > 0) {
      for (let it = 0; it < 3; it++) {
        let ok = true;
        for (let q = 0; q < joints.length; q++) {
          const j = joints[q] as Joint2;
          if (!j.broken && this.active(j.a, j.b)) ok = j.solvePosition(this) && ok;
        }
        if (ok) break;
      }
    }
    // 7. forces by kind, hits, sleep, bodies that left the world
    this.countForces(v0x, v0y);
    this.collectHits();
    if (this.sleeping) this.sleepIslands();
    const range = this.range;
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic) continue;
      if (Math.abs(this.px[i] as number) > range || Math.abs(this.py[i] as number) > range) {
        if (this.awake[i] === 1 || this.invM[i] !== 0) this.left.push(i);
      }
    }
    for (let q = 0; q < this.left.length; q++) this.removeBody(this.left[q] as number);
    this.stepIndex++;
  }

  private active(a: number, b: number): boolean {
    return (this.type[a] === BodyType.Dynamic && this.awake[a] === 1) || (this.type[b] === BodyType.Dynamic && this.awake[b] === 1);
  }

  /**
   * Wakes the sleeping dynamic bodies whose boxes meet those of body i (the boxes hold the contact margin): used before a
   * body leaves, so what it held up falls. A sleeping body is not woken by a wall that goes away.
   */
  wakeAround(i: number): void {
    const s0 = this.shape0[i] as number;
    const sn = this.shapeN[i] as number;
    for (let j = 0; j < this.n; j++) {
      if (j === i || this.type[j] !== BodyType.Dynamic || this.awake[j] === 1) continue;
      const t0 = this.shape0[j] as number;
      const tn = this.shapeN[j] as number;
      let meets = false;
      for (let k = s0; k < s0 + sn && !meets; k++) {
        for (let q = t0; q < t0 + tn && !meets; q++) {
          if ((this.maxX[k] as number) < (this.minX[q] as number) || (this.maxX[q] as number) < (this.minX[k] as number)) continue;
          if ((this.maxY[k] as number) < (this.minY[q] as number) || (this.maxY[q] as number) < (this.minY[k] as number)) continue;
          meets = true;
        }
      }
      if (meets) this.wakeBody(j);
    }
  }

  /** A body that left the world stops taking part: it no longer moves or hits anything. */
  removeBody(i: number): void {
    this.type[i] = BodyType.Static;
    this.invM[i] = 0;
    this.invI[i] = 0;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.w[i] = 0;
    this.awake[i] = 0;
    const s0 = this.shape0[i] as number;
    for (let k = s0; k < s0 + (this.shapeN[i] as number); k++) {
      this.minX[k] = Infinity;
      this.maxX[k] = -Infinity;
    }
    this.gone.add(i);
  }

  gone = new Set<number>();

  setRot(i: number): void {
    sincos(this.ang[i] as number, this.sc);
    this.qs[i] = this.sc[0] as number;
    this.qc[i] = this.sc[1] as number;
  }

  private sa = new Float64Array(0);
  private sb = new Float64Array(0);
  private scratchA(n: number): Float64Array {
    if (this.sa.length < n) this.sa = new Float64Array(n * 2);
    return this.sa;
  }
  private scratchB(n: number): Float64Array {
    if (this.sb.length < n) this.sb = new Float64Array(n * 2);
    return this.sb;
  }

  /** Coulomb forces between charged bodies (`charge`), as forces on their speeds. */
  private electric(S = 1): void {
    const h = this.hsNow;
    const K = 8.9875517923e9;
    const n = this.n;
    let any = false;
    for (let i = 0; i < n; i++) if (this.charge[i] !== 0 && this.type[i] === BodyType.Dynamic) any = true;
    if (!any) return;
    for (let i = 0; i < n; i++) {
      const qi = this.charge[i] as number;
      if (qi === 0) continue;
      for (let j = i + 1; j < n; j++) {
        const qj = this.charge[j] as number;
        if (qj === 0) continue;
        const dx = (this.px[j] as number) - (this.px[i] as number);
        const dy = (this.py[j] as number) - (this.py[i] as number);
        const r2 = dx * dx + dy * dy + 1e-6;
        const r = Math.sqrt(r2);
        const f = (K * qi * qj) / r2;
        const fx = (f * dx) / r;
        const fy = (f * dy) / r;
        // positive f pushes them apart
        this.addForce(i, -fx, -fy, h, S);
        this.addForce(j, fx, fy, h, S);
      }
    }
  }

  private addForce(i: number, fx: number, fy: number, h: number, S = 1): void {
    if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) return;
    const o = i * NK * 2 + FK.electric * 2;
    // the force's mean over the small steps
    this.forces[o] = (this.forces[o] as number) + fx / S;
    this.forces[o + 1] = (this.forces[o + 1] as number) + fy / S;
    this.vx[i] = (this.vx[i] as number) + h * (this.invM[i] as number) * fx;
    this.vy[i] = (this.vy[i] as number) + h * (this.invM[i] as number) * fy;
  }

  /* ------------------------------ broad phase ------------------------------ */

  private findPairs(): void {
    const sap = this.sap;
    const minX = this.minX;
    const ns = sap.length;
    // insertion sort by the left edge: nearly free when little moved since the last step
    for (let i = 1; i < ns; i++) {
      const k = sap[i] as number;
      const v = minX[k] as number;
      let j = i - 1;
      while (j >= 0 && ((minX[sap[j] as number] as number) > v || ((minX[sap[j] as number] as number) === v && (sap[j] as number) > k))) {
        sap[j + 1] = sap[j] as number;
        j--;
      }
      sap[j + 1] = k;
    }
    this.pairCount = 0;
    for (let i = 0; i < ns; i++) {
      const s1 = sap[i] as number;
      const mx = this.maxX[s1] as number;
      if (!(mx >= (minX[s1] as number))) continue;
      const b1 = (this.shapes[s1] as Shape2).body;
      for (let j = i + 1; j < ns; j++) {
        const s2 = sap[j] as number;
        if ((minX[s2] as number) > mx) break;
        if ((this.maxY[s1] as number) < (this.minY[s2] as number) || (this.maxY[s2] as number) < (this.minY[s1] as number)) continue;
        const b2 = (this.shapes[s2] as Shape2).body;
        if (b1 === b2 || !this.mayHit(b1, b2)) continue;
        if (this.pairCount === this.pairs.length) {
          const p = new Float64Array(this.pairs.length * 2);
          p.set(this.pairs);
          this.pairs = p;
        }
        const lo = s1 < s2 ? s1 : s2;
        const hi = s1 < s2 ? s2 : s1;
        this.pairs[this.pairCount++] = lo * ns + hi;
      }
    }
    const np = this.pairCount;
    if (np > 16) this.pairs.subarray(0, np).sort();
    else {
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

  private mayHit(a: number, b: number): boolean {
    const ta = this.type[a] as number;
    const tb = this.type[b] as number;
    if (ta !== BodyType.Dynamic && tb !== BodyType.Dynamic) return false;
    const aw = ta === BodyType.Dynamic ? this.awake[a] === 1 : tb === BodyType.Dynamic ? false : false;
    const bw = tb === BodyType.Dynamic ? this.awake[b] === 1 : false;
    if (!aw && !bw) {
      // both asleep (or asleep against a wall): nothing to do unless a mover moves
      const moving = (ta === BodyType.Kinematic && this.isMoving(a)) || (tb === BodyType.Kinematic && this.isMoving(b));
      if (!moving) return false;
    }
    const ga = this.group[a] as number;
    if (ga !== 0 && ga === this.group[b]) return false;
    if (this.jointPairs.size > 0 && this.jointPairs.has(a < b ? a * this.n + b : b * this.n + a)) return false;
    return true;
  }

  /** Bodies joined by a joint do not hit each other. */
  private jointPairs = new Set<number>();

  private noteJointPairs(): void {
    this.jointPairs.clear();
    for (const j of this.joints) {
      if (j.broken || (j as { collide?: boolean }).collide === true) continue;
      this.jointPairs.add(j.a < j.b ? j.a * this.n + j.b : j.b * this.n + j.a);
    }
  }

  private isMoving(i: number): boolean {
    return this.vx[i] !== 0 || this.vy[i] !== 0 || this.w[i] !== 0;
  }

  /* ------------------------------ contacts ------------------------------ */

  /** The contact table and list the next step fills (the last step's are swapped with them: a step makes no new map or list). */
  private spareMap = new ContactTable();
  private spareList: Contact[] = [];

  private updateContacts(): void {
    const old = this.contactMap;
    const next = this.spareMap;
    const list = this.spareList;
    list.length = 0;
    const stamp = ++this.contactStamp;
    const ns = this.shapes.length;
    let points = 0;
    this.contactsDropped = false;
    for (let p = 0; p < this.pairCount; p++) {
      const key = this.pairs[p] as number;
      let sa = Math.floor(key / ns);
      let sb = key - sa * ns;
      let A = this.shapes[sa] as Shape2;
      let B = this.shapes[sb] as Shape2;
      // a circle against a polygon: the polygon is A
      if (A.kind === 0 && B.kind === 1) {
        const t = sa;
        sa = sb;
        sb = t;
        const T = A;
        A = B;
        B = T;
      }
      let c = old.get(key);
      if (c === undefined) {
        c = this.pool.pop() ?? newContact();
        c.key = key;
        c.ni0 = c.ti0 = c.ni1 = c.ti1 = 0;
        c.wasTouching = false;
        c.touching = false;
        c.pushed = false;
        c.m.count = 0;
      }
      c.stamp = stamp;
      c.sa = sa;
      c.sb = sb;
      c.a = A.body;
      c.b = B.body;
      // (the margin in a field the narrow phase reads: a number passed in a call is a heap number)
      this.setMargin(A.body, B.body);
      const oldCount = c.m.count;
      const o0 = c.m.id0;
      const o1 = c.m.id1;
      const n0 = c.ni0;
      const t0 = c.ti0;
      const n1 = c.ni1;
      const t1 = c.ti1;
      if (A.kind === 0) collideCircles(this, A, B, c.m);
      else if (B.kind === 0) collidePolygonCircle(this, A, B, c.m);
      else collidePolygons(this, A, B, c.m);
      // warm start: keep the impulse of a point with the same feature
      c.ni0 = c.ti0 = c.ni1 = c.ti1 = 0;
      for (let k = 0; k < c.m.count; k++) {
        const id = k === 0 ? c.m.id0 : c.m.id1;
        let ni = 0;
        let ti = 0;
        if (oldCount > 0 && id === o0) {
          ni = n0;
          ti = t0;
        } else if (oldCount > 1 && id === o1) {
          ni = n1;
          ti = t1;
        }
        if (k === 0) {
          c.ni0 = ni;
          c.ti0 = ti;
        } else {
          c.ni1 = ni;
          c.ti1 = ti;
        }
      }
      c.wasTouching = c.touching;
      if (c.m.count === 0) {
        c.touching = false;
        c.pushed = false;
        next.set(c);
        continue;
      }
      if (points + c.m.count > MAX_CONTACT_POINTS) {
        this.contactsDropped = true;
        c.m.count = 0;
        c.touching = false;
        next.set(c);
        continue;
      }
      points += c.m.count;
      // (`mixFriction` written out: a number returned from a call that is not inlined is a heap number)
      const fa = this.fric[c.a] as number;
      const fb = this.fric[c.b] as number;
      if (Number.isNaN(fa)) c.friction = Number.isNaN(fb) ? 0.4 : fb;
      else if (Number.isNaN(fb)) c.friction = fa;
      else c.friction = Math.sqrt(fa * fb);
      c.restitution = Math.max(this.rest[c.a] as number, this.rest[c.b] as number);
      next.set(c);
      list.push(c);
    }
    // a contact the new step did not meet goes back to the pool
    for (let q = 0; q < old.size; q++) {
      const c = old.list[q] as Contact;
      if (c.stamp !== stamp) this.pool.push(c);
    }
    old.clear();
    this.spareMap = old;
    this.spareList = this.contacts;
    this.contactMap = next;
    this.contacts = list;
  }

  /** The margin the narrow phase is asked for (read by `collideCircles` and the others from here). */
  margin = 0;
  /** The two radii `worldManifold` reads (the shapes of A and B). */
  radA = 0;
  radB = 0;

  /**
   * The margin the narrow phase is asked for, into `margin`: the first body's over a step of 1/120 s (as it always was)
   * and the second's over this step's length. Written to a field, not returned: a number returned from a call that is not
   * inlined is a heap number.
   */
  private setMargin(a: number, b: number): void {
    const ma = 2 * LINEAR_SLOP + (1 / 120) * (Math.sqrt((this.vx[a] as number) ** 2 + (this.vy[a] as number) ** 2) + Math.abs(this.w[a] as number) * (this.reach[a] as number));
    const mb = 2 * LINEAR_SLOP + this.hStep * (Math.sqrt((this.vx[b] as number) ** 2 + (this.vy[b] as number) ** 2) + Math.abs(this.w[b] as number) * (this.reach[b] as number));
    this.margin = ma + mb;
  }

  private radiusOf(s: number): number {
    return (this.shapes[s] as Shape2).radius;
  }

  private initContacts(): void {
    const wm = this.wm;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      const a = c.a;
      const b = c.b;
      this.radA = this.radiusOf(c.sa);
      this.radB = this.radiusOf(c.sb);
      worldManifold(this, c.m, a, b, wm);
      c.nx = wm.nx;
      c.ny = wm.ny;
      c.touching = wm.s0 < LINEAR_SLOP * 2 || (c.m.count > 1 && wm.s1 < LINEAR_SLOP * 2);
      const mA = this.invM[a] as number;
      const mB = this.invM[b] as number;
      const iA = this.invI[a] as number;
      const iB = this.invI[b] as number;
      const tx = c.ny;
      const ty = -c.nx;
      for (let k = 0; k < c.m.count; k++) {
        const x = k === 0 ? wm.x0 : wm.x1;
        const y = k === 0 ? wm.y0 : wm.y1;
        const rAx = x - (this.px[a] as number);
        const rAy = y - (this.py[a] as number);
        const rBx = x - (this.px[b] as number);
        const rBy = y - (this.py[b] as number);
        const rnA = rAx * c.ny - rAy * c.nx;
        const rnB = rBx * c.ny - rBy * c.nx;
        const kN = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
        const rtA = rAx * ty - rAy * tx;
        const rtB = rBx * ty - rBy * tx;
        const kT = mA + mB + iA * rtA * rtA + iB * rtB * rtB;
        const dvx = (this.pvx[b] as number) - (this.pw[b] as number) * rBy - (this.pvx[a] as number) + (this.pw[a] as number) * rAy;
        const dvy = (this.pvy[b] as number) + (this.pw[b] as number) * rBx - (this.pvy[a] as number) - (this.pw[a] as number) * rAx;
        const rv = dvx * c.nx + dvy * c.ny;
        if (k === 0) {
          c.rAx0 = rAx;
          c.rAy0 = rAy;
          c.rBx0 = rBx;
          c.rBy0 = rBy;
          c.nm0 = kN > 0 ? 1 / kN : 0;
          c.tm0 = kT > 0 ? 1 / kT : 0;
          c.rv0 = rv;
          c.s0 = wm.s0;
          c.max0 = 0;
          c.px0 = x;
          c.py0 = y;
        } else {
          c.rAx1 = rAx;
          c.rAy1 = rAy;
          c.rBx1 = rBx;
          c.rBy1 = rBy;
          c.nm1 = kN > 0 ? 1 / kN : 0;
          c.tm1 = kT > 0 ? 1 / kT : 0;
          c.rv1 = rv;
          c.s1 = wm.s1;
          c.max1 = 0;
        }
      }
      // two points are solved together (Box2D's block solver), so a box resting on a face does not rock
      c.block = false;
      if (c.m.count === 2) {
        const rn1A = c.rAx0 * c.ny - c.rAy0 * c.nx;
        const rn1B = c.rBx0 * c.ny - c.rBy0 * c.nx;
        const rn2A = c.rAx1 * c.ny - c.rAy1 * c.nx;
        const rn2B = c.rBx1 * c.ny - c.rBy1 * c.nx;
        const k11 = mA + mB + iA * rn1A * rn1A + iB * rn1B * rn1B;
        const k22 = mA + mB + iA * rn2A * rn2A + iB * rn2B * rn2B;
        const k12 = mA + mB + iA * rn1A * rn2A + iB * rn1B * rn2B;
        const det = k11 * k22 - k12 * k12;
        if (k11 * k11 < 1000 * det && det !== 0) {
          c.block = true;
          c.k11 = k11;
          c.k22 = k22;
          c.k12 = k12;
          const id = 1 / det;
          c.i11 = k22 * id;
          c.i22 = k11 * id;
          c.i12 = -k12 * id;
        }
      }
    }
  }

  /** The impulse `applyAt` applies, set by the caller (a field: two numbers passed in a call are two heap numbers when it is not inlined, design 11.4). */
  private ipx = 0;
  private ipy = 0;
  /** The gap `gapAt` worked out (a field, for the same reason as the impulse). */
  private gap = 0;

  /** The impulse (`ipx`, `ipy`) at point k of contact c, on its two bodies. */
  private applyAt(c: Contact, k: number): void {
    const a = c.a;
    const b = c.b;
    const rAx = k === 0 ? c.rAx0 : c.rAx1;
    const rAy = k === 0 ? c.rAy0 : c.rAy1;
    const rBx = k === 0 ? c.rBx0 : c.rBx1;
    const rBy = k === 0 ? c.rBy0 : c.rBy1;
    const Px = this.ipx;
    const Py = this.ipy;
    this.vx[a] = (this.vx[a] as number) - (this.invM[a] as number) * Px;
    this.vy[a] = (this.vy[a] as number) - (this.invM[a] as number) * Py;
    this.w[a] = (this.w[a] as number) - (this.invI[a] as number) * (rAx * Py - rAy * Px);
    this.vx[b] = (this.vx[b] as number) + (this.invM[b] as number) * Px;
    this.vy[b] = (this.vy[b] as number) + (this.invM[b] as number) * Py;
    this.w[b] = (this.w[b] as number) + (this.invI[b] as number) * (rBx * Py - rBy * Px);
  }

  private warmStart(): void {
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      const tx = c.ny;
      const ty = -c.nx;
      for (let k = 0; k < c.m.count; k++) {
        const ni = k === 0 ? c.ni0 : c.ni1;
        const ti = k === 0 ? c.ti0 : c.ti1;
        if (ni === 0 && ti === 0) continue;
        const Px = ni * c.nx + ti * tx;
        const Py = ni * c.ny + ti * ty;
        this.ipx = Px;
        this.ipy = Py;
        this.applyAt(c, k);
      }
    }
  }

  /* ------------------------------ the soft step (design 6.5) ------------------------------ */

  /** Small steps a step: half the passes, rounded up (4 at the default 8). */
  get substeps(): number {
    return Math.max(1, Math.ceil(this.passes / 2));
  }

  /** Where each body started the step (for the contacts' gaps and the sweep), and the contacts' soft data. */
  private sx0 = new Float64Array(0);
  private sy0 = new Float64Array(0);
  private sc0 = new Float64Array(0);
  private ss0 = new Float64Array(0);
  /** The soft contact numbers of a small step: against a moving body, and against a wall (twice as stiff). */
  private softBias = 0;
  private softMass = 1;
  private softImp = 0;
  private wallBias = 0;
  private wallMass = 1;
  private wallImp = 0;

  private beginSoft(): void {
    const hs = this.hsNow;
    const n = this.n;
    if (this.sx0.length !== n) {
      this.sx0 = new Float64Array(n);
      this.sy0 = new Float64Array(n);
      this.sc0 = new Float64Array(n);
      this.ss0 = new Float64Array(n);
    }
    this.sx0.set(this.px);
    this.sy0.set(this.py);
    this.sc0.set(this.qc);
    this.ss0.set(this.qs);
    if (this.ddx.length !== n) {
      this.ddx = new Float64Array(n);
      this.ddy = new Float64Array(n);
      this.dca = new Float64Array(n);
      this.dsa = new Float64Array(n);
      this.pfx = new Float64Array(n);
      this.pfy = new Float64Array(n);
      this.pfw = new Float64Array(n);
    }
    this.ddx.fill(0);
    this.ddy.fill(0);
    this.dca.fill(1);
    this.dsa.fill(0);
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
      const c = this.contacts[kc] as Contact;
      // the gap at the narrow phase less the anchors' gap then: a small step's gap is this plus the anchors' gap now
      c.adj0 = c.s0 - ((c.rBx0 - c.rAx0) * c.nx + (c.rBy0 - c.rAy0) * c.ny);
      c.adj1 = c.m.count > 1 ? c.s1 - ((c.rBx1 - c.rAx1) * c.nx + (c.rBy1 - c.rAy1) * c.ny) : 0;
      c.tn0 = c.tn1 = c.tt0 = c.tt1 = 0;
      c.max0 = c.max1 = 0;
      c.bounced0 = c.bounced1 = false;
    }
  }

  /** Gravity, steady forces, drag and charges into the speeds over one small step; pushes in the first only. */
  private integrateForces(first: boolean, S: number): void {
    const hs = this.hsNow;
    const n = this.n;
    const damp = 1 / (1 + hs * this.air);
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) continue;
      const m = this.mass[i] as number;
      const im = this.invM[i] as number;
      const ii = this.invI[i] as number;
      const f = i * NK * 2;
      let vx = (this.vx[i] as number) + hs * (this.gx + im * (this.fx[i] as number));
      let vy = (this.vy[i] as number) + hs * (this.gy + im * (this.fy[i] as number));
      let wv = (this.w[i] as number) + hs * ii * (this.torque[i] as number);
      if (first) {
        this.forces[f + FK.gravity * 2] = m * this.gx;
        this.forces[f + FK.gravity * 2 + 1] = m * this.gy;
        this.forces[f + FK.applied * 2] = this.fx[i] as number;
        this.forces[f + FK.applied * 2 + 1] = this.fy[i] as number;
      }
      // pushes (Push, a grab, still water, drops, the air) are spread over the small steps: an impulse over a step is a
      // force over it. All at the first small step, a floating body was lifted and dropped inside every step and never
      // slept
      vx += (im * (this.jx[i] as number)) / S;
      vy += (im * (this.jy[i] as number)) / S;
      wv += (ii * (this.jt[i] as number)) / S;
      if (this.air > 0) {
        // the drag force, the mean over the small steps
        this.forces[f + FK.drag * 2] = (first ? 0 : (this.forces[f + FK.drag * 2] as number)) + (m * vx * (damp - 1)) / hs / S;
        this.forces[f + FK.drag * 2 + 1] = (first ? 0 : (this.forces[f + FK.drag * 2 + 1] as number)) + (m * vy * (damp - 1)) / hs / S;
        vx *= damp;
        vy *= damp;
        wv *= damp;
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.w[i] = wv;
    }
    this.electric(S);
  }

  /** Positions and angles move by speed times the small step (walls and movers are placed by the driver). */
  private integratePositions(): void {
    const hs = this.hsNow;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) continue;
      let vx = this.vx[i] as number;
      let vy = this.vy[i] as number;
      const tr2 = (vx * vx + vy * vy) * hs * hs;
      if (tr2 > MAX_TRANSLATION * MAX_TRANSLATION) {
        const r = MAX_TRANSLATION / Math.sqrt(tr2);
        vx *= r;
        vy *= r;
        this.vx[i] = vx;
        this.vy[i] = vy;
      }
      this.px[i] = (this.px[i] as number) + hs * vx;
      this.py[i] = (this.py[i] as number) + hs * vy;
      this.ang[i] = (this.ang[i] as number) + hs * (this.w[i] as number);
      this.setRot(i);
      this.dMove(i);
    }
  }

  /** Body i's anchor r (in the world at the step's start) where the body is now: r turned by its turn since. */
  private gapAt(c: Contact, k: number): void {
    const a = c.a;
    const b = c.b;
    const rAx = k === 0 ? c.rAx0 : c.rAx1;
    const rAy = k === 0 ? c.rAy0 : c.rAy1;
    const rBx = k === 0 ? c.rBx0 : c.rBx1;
    const rBy = k === 0 ? c.rBy0 : c.rBy1;
    const nx = c.nx;
    const ny = c.ny;
    const adj = k === 0 ? c.adj0 : c.adj1;
    // each body's move and turn since the start of the step, kept up to date by the small steps (dMove)
    const { ddx, ddy, dca, dsa } = this;
    const ca = dca[a] as number;
    const sa = dsa[a] as number;
    const cb = dca[b] as number;
    const sb = dsa[b] as number;
    const pax = (ddx[a] as number) + ca * rAx - sa * rAy;
    const pay = (ddy[a] as number) + sa * rAx + ca * rAy;
    const pbx = (ddx[b] as number) + cb * rBx - sb * rBy;
    const pby = (ddy[b] as number) + sb * rBx + cb * rBy;
    this.gap = (pbx - pax) * nx + (pby - pay) * ny + adj;
  }

  /** Each body's move since the start of the step, and its turn since (cos, sin): updated after each small step's move. */
  private ddx = new Float64Array(0);
  private ddy = new Float64Array(0);
  private dca = new Float64Array(0);
  private dsa = new Float64Array(0);

  private dMove(i: number): void {
    this.ddx[i] = (this.px[i] as number) - (this.sx0[i] as number);
    this.ddy[i] = (this.py[i] as number) - (this.sy0[i] as number);
    // its rotation now times the start's rotation back
    const c = this.qc[i] as number;
    const s = this.qs[i] as number;
    const c0 = this.sc0[i] as number;
    const s0 = this.ss0[i] as number;
    this.dca[i] = c * c0 + s * s0;
    this.dsa[i] = s * c0 - c * s0;
  }

  /**
   * One pass over the contacts in a small step: friction first, then the push of each point. With `bias`, a point that
   * overlaps is pushed out softly (at most 3 m/s); without (the relax pass), only to a standstill. A point with a gap may
   * close it within the small step, but not go below zero (speculative).
   */
  private solveSoft(bias: boolean): void {
    const inv_hs = this.invHs;
    const vx = this.vx;
    const vy = this.vy;
    const w = this.w;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      const a = c.a;
      const b = c.b;
      const tx = c.ny;
      const ty = -c.nx;
      const wall = this.type[a] !== BodyType.Dynamic || this.type[b] !== BodyType.Dynamic;
      const sBias = wall ? this.wallBias : this.softBias;
      const sMass = wall ? this.wallMass : this.softMass;
      const sImp = wall ? this.wallImp : this.softImp;
      // friction first, so the normal impulse has the last word
      for (let k = 0; k < c.m.count; k++) {
        const rAx = k === 0 ? c.rAx0 : c.rAx1;
        const rAy = k === 0 ? c.rAy0 : c.rAy1;
        const rBx = k === 0 ? c.rBx0 : c.rBx1;
        const rBy = k === 0 ? c.rBy0 : c.rBy1;
        const dvx = (vx[b] as number) - (w[b] as number) * rBy - (vx[a] as number) + (w[a] as number) * rAy;
        const dvy = (vy[b] as number) + (w[b] as number) * rBx - (vy[a] as number) - (w[a] as number) * rAx;
        const vt = dvx * tx + dvy * ty;
        const tm = k === 0 ? c.tm0 : c.tm1;
        const ni = k === 0 ? c.ni0 : c.ni1;
        const old = k === 0 ? c.ti0 : c.ti1;
        const maxF = c.friction * ni;
        let nt = old - tm * vt;
        if (nt > maxF) nt = maxF;
        else if (nt < -maxF) nt = -maxF;
        const d = nt - old;
        if (k === 0) c.ti0 = nt;
        else c.ti1 = nt;
        if (d !== 0) {
          this.ipx = d * tx;
          this.ipy = d * ty;
          this.applyAt(c, k);
        }
      }
      if (c.block && this.softBlock(c, bias)) continue;
      for (let k = 0; k < c.m.count; k++) {
        const rAx = k === 0 ? c.rAx0 : c.rAx1;
        const rAy = k === 0 ? c.rAy0 : c.rAy1;
        const rBx = k === 0 ? c.rBx0 : c.rBx1;
        const rBy = k === 0 ? c.rBy0 : c.rBy1;
        this.gapAt(c, k);
        const s = this.gap;
        let bv = 0;
        let ms = 1;
        let is = 0;
        if (s > 0) bv = s * inv_hs;
        else if (bias) {
          bv = Math.max(sBias * s, -MAX_PUSH_OUT);
          ms = sMass;
          is = sImp;
        }
        const dvx = (vx[b] as number) - (w[b] as number) * rBy - (vx[a] as number) + (w[a] as number) * rAy;
        const dvy = (vy[b] as number) + (w[b] as number) * rBx - (vy[a] as number) - (w[a] as number) * rAx;
        const vn = dvx * c.nx + dvy * c.ny;
        // the relax pass leaves a fast point with a gap alone if it bounces: it meets in the next small step and bounces
        // there with its full speed (slowing it to the gap here took the speed its bounce needs)
        if (!bias && wall && s > 0 && c.restitution > 0 && vn <= -RESTITUTION_THRESHOLD) continue;
        const nm = k === 0 ? c.nm0 : c.nm1;
        const old = k === 0 ? c.ni0 : c.ni1;
        let ni = old - nm * ms * (vn + bv) - is * old;
        if (ni < 0) ni = 0;
        const d = ni - old;
        if (k === 0) c.ni0 = ni;
        else c.ni1 = ni;
        if (d !== 0) {
          this.ipx = d * c.nx;
          this.ipy = d * c.ny;
          this.applyAt(c, k);
        }
      }
    }
  }

  /**
   * A face resting on a face: both points pushed in one 2 × 2 solve, softly. One point after the other gave the first
   * point more than its share, which turned the box a little each small step: a tall stack of soft contacts leaned
   * more and more and fell over. Used when both points overlap (or both have a gap) and both stay pushing; false
   * otherwise, and the points are solved one by one.
   */
  private softBlock(c: Contact, bias: boolean): boolean {
    const a = c.a;
    const b = c.b;
    // (the soft constants of the contact, as `solveSoft` takes them; they are fields, not arguments)
    const inv_hs = this.invHs;
    const wall = this.type[a] !== BodyType.Dynamic || this.type[b] !== BodyType.Dynamic;
    const sBias = wall ? this.wallBias : this.softBias;
    const sMass = wall ? this.wallMass : this.softMass;
    const sImp = wall ? this.wallImp : this.softImp;
    this.gapAt(c, 0);
    const s1 = this.gap;
    this.gapAt(c, 1);
    const s2 = this.gap;
    if (s1 > 0 !== s2 > 0) return false;
    // a face falling onto a wall with a bounce: the point-by-point relax pass leaves it its speed (see solveSoft)
    if (!bias && s1 > 0 && c.restitution > 0 && (this.type[a] !== BodyType.Dynamic || this.type[b] !== BodyType.Dynamic)) return false;
    let b1 = 0;
    let b2 = 0;
    let ms = 1;
    let is = 0;
    if (s1 > 0) {
      b1 = s1 * inv_hs;
      b2 = s2 * inv_hs;
    } else if (bias) {
      b1 = Math.max(sBias * s1, -MAX_PUSH_OUT);
      b2 = Math.max(sBias * s2, -MAX_PUSH_OUT);
      ms = sMass;
      is = sImp;
    }
    const vx = this.vx;
    const vy = this.vy;
    const w = this.w;
    const v1 = ((vx[b] as number) - (w[b] as number) * c.rBy0 - (vx[a] as number) + (w[a] as number) * c.rAy0) * c.nx + ((vy[b] as number) + (w[b] as number) * c.rBx0 - (vy[a] as number) - (w[a] as number) * c.rAx0) * c.ny;
    const v2 = ((vx[b] as number) - (w[b] as number) * c.rBy1 - (vx[a] as number) + (w[a] as number) * c.rAy1) * c.nx + ((vy[b] as number) + (w[b] as number) * c.rBx1 - (vy[a] as number) - (w[a] as number) * c.rAx1) * c.ny;
    const r1 = v1 + b1;
    const r2 = v2 + b2;
    const o1 = c.ni0;
    const o2 = c.ni1;
    const n1 = o1 - ms * (c.i11 * r1 + c.i12 * r2) - is * o1;
    const n2 = o2 - ms * (c.i12 * r1 + c.i22 * r2) - is * o2;
    if (!(n1 >= 0 && n2 >= 0)) return false;
    c.ni0 = n1;
    c.ni1 = n2;
    const d1 = n1 - o1;
    const d2 = n2 - o2;
    if (d1 !== 0) {
      this.ipx = d1 * c.nx;
      this.ipy = d1 * c.ny;
      this.applyAt(c, 0);
    }
    if (d2 !== 0) {
      this.ipx = d2 * c.nx;
      this.ipy = d2 * c.ny;
      this.applyAt(c, 1);
    }
    return true;
  }

  /** After a small step: its impulses go into the step's totals and the largest push. */
  private addUpImpulses(): void {
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      c.tn0 += c.ni0;
      c.tt0 += c.ti0;
      if (c.ni0 > c.max0) c.max0 = c.ni0;
      if (c.m.count > 1) {
        c.tn1 += c.ni1;
        c.tt1 += c.ti1;
        if (c.ni1 > c.max1) c.max1 = c.ni1;
      }
    }
  }


  /**
   * Each point's closing speed after a small step's forces and, for a point closing fast enough to bounce, its closing
   * speed before them and its gap at the start of the small step.
   */
  private closingSpeeds(): void {
    const { vx, vy, w, pfx, pfy, pfw } = this;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      if (c.restitution === 0) continue;
      const a = c.a;
      const b = c.b;
      for (let k = 0; k < c.m.count; k++) {
        const rAx = k === 0 ? c.rAx0 : c.rAx1;
        const rAy = k === 0 ? c.rAy0 : c.rAy1;
        const rBx = k === 0 ? c.rBx0 : c.rBx1;
        const rBy = k === 0 ? c.rBy0 : c.rBy1;
        const dvx = (vx[b] as number) - (w[b] as number) * rBy - (vx[a] as number) + (w[a] as number) * rAy;
        const dvy = (vy[b] as number) + (w[b] as number) * rBx - (vy[a] as number) - (w[a] as number) * rAx;
        const vf = dvx * c.nx + dvy * c.ny;
        // only a point closing fast enough to bounce needs its speed before the forces and its gap
        let v0 = vf;
        let g = 0;
        if (vf <= -RESTITUTION_THRESHOLD) {
          const ex = (pfx[b] as number) - (pfw[b] as number) * rBy - (pfx[a] as number) + (pfw[a] as number) * rAy;
          const ey = (pfy[b] as number) + (pfw[b] as number) * rBx - (pfy[a] as number) - (pfw[a] as number) * rAx;
          v0 = ex * c.nx + ey * c.ny;
          this.gapAt(c, k);
          g = this.gap;
        }
        if (k === 0) {
          c.sf0 = vf;
          c.sv0 = v0;
          c.sg0 = g;
        } else {
          c.sf1 = vf;
          c.sv1 = v0;
          c.sg1 = g;
        }
      }
    }
  }

  /** The speeds before a small step's forces. */
  private pfx = new Float64Array(0);
  private pfy = new Float64Array(0);
  private pfw = new Float64Array(0);

  /**
   * Bounce (design 6.5). A point bounces in the small step it would go through its gap: its closing speed after the
   * small step's forces would close the gap and more. Before it moves, its speed apart is set to `bounce` × its closing
   * speed at the start of the small step (before the forces), so it turns back where it is, short of the touch, as the
   * one-step solver did: with semi-implicit Euler that keeps a perfect bounce's energy exactly. The two points of a face
   * bounce together (one 2 × 2 solve), so a landing box does not spin. The bounce's impulse is not kept for warm
   * starting, so the later passes, which see the point moving apart, leave it alone. Once a step per point.
   */
  /**
   * Bounce between two bodies, after the relax pass of the small step where a point first pushes: its speed apart
   * becomes `bounce` × its closing speed at the start of that small step. Turning back before the move (as off a wall)
   * let a box sink into the one under it in a falling stack and the stack fell over, so here the point meets first;
   * a little energy is lost, never gained. Both points of a face bounce in one solve, so a landing box does not spin.
   */
  private bounceBodies(): void {
    const vx = this.vx;
    const vy = this.vy;
    const w = this.w;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      if (c.restitution === 0 || this.type[c.a] !== BodyType.Dynamic || this.type[c.b] !== BodyType.Dynamic) continue;
      const q0 = !c.bounced0 && c.sv0 <= -RESTITUTION_THRESHOLD && c.ni0 > 0;
      const q1 = c.m.count > 1 && !c.bounced1 && c.sv1 <= -RESTITUTION_THRESHOLD && c.ni1 > 0;
      if (!q0 && !q1) continue;
      if (q0) c.bounced0 = true;
      if (q1) c.bounced1 = true;
      if (c.block) {
        this.blockTo(c, q0 ? c.restitution * c.sv0 : 0, q1 ? c.restitution * c.sv1 : 0);
        continue;
      }
      for (let k = 0; k < c.m.count; k++) {
        if (k === 0 ? !q0 : !q1) continue;
        const rv = k === 0 ? c.sv0 : c.sv1;
        const rAx = k === 0 ? c.rAx0 : c.rAx1;
        const rAy = k === 0 ? c.rAy0 : c.rAy1;
        const rBx = k === 0 ? c.rBx0 : c.rBx1;
        const rBy = k === 0 ? c.rBy0 : c.rBy1;
        const dvx = (vx[c.b] as number) - (w[c.b] as number) * rBy - (vx[c.a] as number) + (w[c.a] as number) * rAy;
        const dvy = (vy[c.b] as number) + (w[c.b] as number) * rBx - (vy[c.a] as number) - (w[c.a] as number) * rAx;
        const vn = dvx * c.nx + dvy * c.ny;
        const nm = k === 0 ? c.nm0 : c.nm1;
        const old = k === 0 ? c.ni0 : c.ni1;
        let ni = old - nm * (vn + c.restitution * rv);
        if (ni < 0) ni = 0;
        const d = ni - old;
        if (k === 0) c.ni0 = ni;
        else c.ni1 = ni;
        if (d !== 0) {
          this.ipx = d * c.nx;
          this.ipy = d * c.ny;
          this.applyAt(c, k);
        }
      }
    }
  }

  /**
   * The block solve of a two-point contact with each point's normal speed kept at least −bias (here e × the closing
   * speed for a bounce): the 2×2 linear complementarity problem solved by trying the four cases in turn (both push,
   * only the first, only the second, neither), as Box2D's block solver does.
   */
  private blockTo(c: Contact, bias1: number, bias2: number): void {
    const vx = this.vx;
    const vy = this.vy;
    const w = this.w;
    const a = c.a;
    const b = c.b;
    const dv1x = (vx[b] as number) - (w[b] as number) * c.rBy0 - (vx[a] as number) + (w[a] as number) * c.rAy0;
    const dv1y = (vy[b] as number) + (w[b] as number) * c.rBx0 - (vy[a] as number) - (w[a] as number) * c.rAx0;
    const dv2x = (vx[b] as number) - (w[b] as number) * c.rBy1 - (vx[a] as number) + (w[a] as number) * c.rAy1;
    const dv2y = (vy[b] as number) + (w[b] as number) * c.rBx1 - (vy[a] as number) - (w[a] as number) * c.rAx1;
    const a1 = c.ni0;
    const a2 = c.ni1;
    const b1 = dv1x * c.nx + dv1y * c.ny + bias1 - (c.k11 * a1 + c.k12 * a2);
    const b2 = dv2x * c.nx + dv2y * c.ny + bias2 - (c.k12 * a1 + c.k22 * a2);
    let x1 = -(c.i11 * b1 + c.i12 * b2);
    let x2 = -(c.i12 * b1 + c.i22 * b2);
    if (!(x1 >= 0 && x2 >= 0)) {
      x1 = -c.nm0 * b1;
      x2 = 0;
      const vn2 = c.k12 * x1 + b2;
      if (!(x1 >= 0 && vn2 >= 0)) {
        x1 = 0;
        x2 = -c.nm1 * b2;
        const vn1 = c.k12 * x2 + b1;
        if (!(x2 >= 0 && vn1 >= 0)) {
          x1 = 0;
          x2 = 0;
          if (!(b1 >= 0 && b2 >= 0)) return;
        }
      }
    }
    const d1 = x1 - a1;
    const d2 = x2 - a2;
    c.ni0 = x1;
    c.ni1 = x2;
    if (d1 !== 0) {
      this.ipx = d1 * c.nx;
      this.ipy = d1 * c.ny;
      this.applyAt(c, 0);
    }
    if (d2 !== 0) {
      this.ipx = d2 * c.nx;
      this.ipy = d2 * c.ny;
      this.applyAt(c, 1);
    }
  }

  /** The speed apart (along the normal) of point k of contact c now. */
  private normalSpeed(c: Contact, k: number): void {
    const vx = this.vx;
    const vy = this.vy;
    const w = this.w;
    const a = c.a;
    const b = c.b;
    const rAx = k === 0 ? c.rAx0 : c.rAx1;
    const rAy = k === 0 ? c.rAy0 : c.rAy1;
    const rBx = k === 0 ? c.rBx0 : c.rBx1;
    const rBy = k === 0 ? c.rBy0 : c.rBy1;
    const dvx = (vx[b] as number) - (w[b] as number) * rBy - (vx[a] as number) + (w[a] as number) * rAy;
    const dvy = (vy[b] as number) + (w[b] as number) * rBx - (vy[a] as number) - (w[a] as number) * rAx;
    this.speed = dvx * c.nx + dvy * c.ny;
  }

  /** What `normalSpeed` found (a field: a number returned from a call that is not inlined is a heap number). */
  private speed = 0;

  private bounce(): void {
    const hs = this.hsNow;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      if (c.restitution === 0) continue;
      // off walls only; two bodies bounce after the relax pass (bounceBodies)
      if (this.type[c.a] === BodyType.Dynamic && this.type[c.b] === BodyType.Dynamic) continue;
      const q0 = !c.bounced0 && c.sf0 <= -RESTITUTION_THRESHOLD && c.sg0 + hs * c.sf0 < 0;
      const q1 = c.m.count > 1 && !c.bounced1 && c.sf1 <= -RESTITUTION_THRESHOLD && c.sg1 + hs * c.sf1 < 0;
      if (!q0 && !q1) continue;
      // each point's speed apart now (`normalSpeed`), and the speed it must reach
      let x0 = 0;
      let x1 = 0;
      const t0 = -c.restitution * c.sv0;
      const t1 = -c.restitution * c.sv1;
      if (q0 && q1 && c.block) {
        // both points of a face: K x = target − v, in one solve
        this.normalSpeed(c, 0);
        const d0 = t0 - this.speed;
        this.normalSpeed(c, 1);
        const d1 = t1 - this.speed;
        x0 = c.i11 * d0 + c.i12 * d1;
        x1 = c.i12 * d0 + c.i22 * d1;
        if (!(x0 >= 0 && x1 >= 0)) {
          x0 = Math.max(0, c.nm0 * d0);
          x1 = 0;
        }
      } else if (q0) {
        this.normalSpeed(c, 0);
        x0 = Math.max(0, c.nm0 * (t0 - this.speed));
      } else {
        this.normalSpeed(c, 1);
        x1 = Math.max(0, c.nm1 * (t1 - this.speed));
      }
      if (q0) c.bounced0 = true;
      if (q1) c.bounced1 = true;
      if (x0 > 0) {
        this.ipx = x0 * c.nx;
        this.ipy = x0 * c.ny;
        this.applyAt(c, 0);
        c.tn0 += x0;
        if (x0 > c.max0) c.max0 = x0;
      }
      if (x1 > 0) {
        this.ipx = x1 * c.nx;
        this.ipy = x1 * c.ny;
        this.applyAt(c, 1);
        c.tn1 += x1;
        if (x1 > c.max1) c.max1 = x1;
      }
    }
  }


  /* ------------------------------ fast bodies ------------------------------ */

  /**
   * A body that moved more than half its size this step is swept against walls: the first pose along the move where it
   * overlaps a wall is found by bisection, and the body stops just before it (design 6.6).
   */
  private sweep(i: number, ox: number, oy: number): void {
    const nx = this.px[i] as number;
    const ny = this.py[i] as number;
    const dist = Math.sqrt((nx - ox) ** 2 + (ny - oy) ** 2);
    const ext = Math.max(this.extent[i] as number, 1e-3);
    const samples = Math.min(64, Math.ceil(dist / (0.25 * ext)));
    let safe = 0;
    let hit = -1;
    for (let k = 1; k <= samples; k++) {
      const t = k / samples;
      if (this.overlapsWallAt(i, ox + t * (nx - ox), oy + t * (ny - oy))) {
        hit = t;
        break;
      }
      safe = t;
    }
    if (hit < 0) {
      this.updateShapes(i);
      return;
    }
    let lo = safe;
    let hi = hit;
    for (let k = 0; k < 12; k++) {
      const mid = 0.5 * (lo + hi);
      if (this.overlapsWallAt(i, ox + mid * (nx - ox), oy + mid * (ny - oy))) hi = mid;
      else lo = mid;
    }
    this.px[i] = ox + lo * (nx - ox);
    this.py[i] = oy + lo * (ny - oy);
    this.updateShapes(i);
  }

  private probe = newManifold();

  private overlapsWallAt(i: number, x: number, y: number): boolean {
    const sx = this.px[i] as number;
    const sy = this.py[i] as number;
    this.px[i] = x;
    this.py[i] = y;
    this.updateShapes(i);
    let hit = false;
    const s0 = this.shape0[i] as number;
    const sn = this.shapeN[i] as number;
    for (let k = s0; k < s0 + sn && !hit; k++) {
      const A = this.shapes[k] as Shape2;
      for (let s = 0; s < this.shapes.length && !hit; s++) {
        const B = this.shapes[s] as Shape2;
        if (this.type[B.body] === BodyType.Dynamic || B.body === i) continue;
        if ((this.maxX[k] as number) < (this.minX[s] as number) || (this.maxX[s] as number) < (this.minX[k] as number)) continue;
        if ((this.maxY[k] as number) < (this.minY[s] as number) || (this.maxY[s] as number) < (this.minY[k] as number)) continue;
        const m = this.probe;
        this.margin = 0;
        if (A.kind === 0 && B.kind === 0) collideCircles(this, A, B, m);
        else if (A.kind === 0) collidePolygonCircle(this, B, A, m);
        else if (B.kind === 0) collidePolygonCircle(this, A, B, m);
        else collidePolygons(this, A, B, m);
        if (m.count > 0) {
          this.radA = A.kind === 0 && B.kind === 1 ? B.radius : A.radius;
          this.radB = A.kind === 0 && B.kind === 1 ? A.radius : B.radius;
          worldManifold(this, m, A.kind === 0 && B.kind === 1 ? B.body : A.body, A.kind === 0 && B.kind === 1 ? A.body : B.body, this.wm);
          if (this.wm.s0 < -LINEAR_SLOP || (m.count > 1 && this.wm.s1 < -LINEAR_SLOP)) hit = true;
        }
      }
    }
    this.px[i] = sx;
    this.py[i] = sy;
    return hit;
  }

  /* ------------------------------ islands and sleep ------------------------------ */

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
      const c = this.contacts[k] as Contact;
      if (c.m.count > 0) this.join(c.a, c.b);
    }
    for (let k = 0; k < this.joints.length; k++) {
      const j = this.joints[k] as Joint2;
      if (!j.broken) this.join(j.a, j.b);
    }
  }

  /** Puts the islands of bodies a and b together (two dynamic bodies only). */
  private join(a: number, b: number): void {
    if (this.type[a] !== BodyType.Dynamic || this.type[b] !== BodyType.Dynamic) return;
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
  }

  /** Scratch of the sleep passes: which islands are awake, and each island's least sleep time. */
  private awakeIsland = new Uint8Array(0);
  private minT = new Float64Array(0);

  /** Wakes a sleeping body that an awake one, or a moving mover, touches; and its whole island. */
  private wakeTouched(): void {
    if (!this.sleeping) return;
    this.islands();
    const n = this.n;
    if (this.awakeIsland.length !== n) this.awakeIsland = new Uint8Array(n);
    const islandAwake = this.awakeIsland;
    islandAwake.fill(0);
    for (let i = 0; i < n; i++) if (this.type[i] === BodyType.Dynamic && this.awake[i] === 1) islandAwake[this.find(i)] = 1;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      if (c.m.count === 0) continue;
      const ka = this.type[c.a] === BodyType.Kinematic && this.isMoving(c.a);
      const kb = this.type[c.b] === BodyType.Kinematic && this.isMoving(c.b);
      if (ka && this.type[c.b] === BodyType.Dynamic) islandAwake[this.find(c.b)] = 1;
      if (kb && this.type[c.a] === BodyType.Dynamic) islandAwake[this.find(c.a)] = 1;
    }
    for (let i = 0; i < n; i++) if (this.type[i] === BodyType.Dynamic && this.awake[i] === 0 && islandAwake[this.find(i)] === 1) this.wakeBody(i);
  }

  wakeBody(i: number): void {
    if (this.type[i] !== BodyType.Dynamic) return;
    this.awake[i] = 1;
    this.sleepTime[i] = 0;
  }

  sleepBody(i: number): void {
    if (this.type[i] !== BodyType.Dynamic) return;
    this.awake[i] = 0;
    this.sleepTime[i] = TIME_TO_SLEEP;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.w[i] = 0;
  }

  private sleepIslands(): void {
    const h = this.hStep;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) continue;
      const v2 = (this.vx[i] as number) ** 2 + (this.vy[i] as number) ** 2;
      const w2 = (this.w[i] as number) ** 2;
      const pushed = this.fx[i] !== 0 || this.fy[i] !== 0 || this.torque[i] !== 0;
      if (v2 > SLEEP_LIN * SLEEP_LIN || w2 > SLEEP_ANG * SLEEP_ANG || pushed) this.sleepTime[i] = 0;
      else this.sleepTime[i] = (this.sleepTime[i] as number) + h;
    }
    this.islands();
    if (this.minT.length !== n) this.minT = new Float64Array(n);
    const minT = this.minT;
    minT.fill(Infinity);
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) continue;
      const r = this.find(i);
      if ((this.sleepTime[i] as number) < (minT[r] as number)) minT[r] = this.sleepTime[i] as number;
    }
    // an island touching a moving mover stays awake
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      if (c.m.count === 0) continue;
      if (this.type[c.a] === BodyType.Kinematic && this.isMoving(c.a) && this.type[c.b] === BodyType.Dynamic) minT[this.find(c.b)] = 0;
      if (this.type[c.b] === BodyType.Kinematic && this.isMoving(c.b) && this.type[c.a] === BodyType.Dynamic) minT[this.find(c.a)] = 0;
    }
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) continue;
      if ((minT[this.find(i)] as number) >= TIME_TO_SLEEP) this.sleepBody(i);
    }
  }

  /* ------------------------------ forces, hits, readouts ------------------------------ */

  private countForces(v0x: Float64Array, v0y: Float64Array): void {
    const inv_h = 1 / this.hStep;
    const inv_hs = this.invHs;
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      const tx = c.ny;
      const ty = -c.nx;
      let ni = 0;
      let ti = 0;
      for (let k = 0; k < c.m.count; k++) {
        // the step's impulse, added up over its small steps
        ni += k === 0 ? c.tn0 : c.tn1;
        ti += k === 0 ? c.tt0 : c.tt1;
      }
      const nfx = ni * c.nx * inv_h;
      const nfy = ni * c.ny * inv_h;
      const ffx = ti * tx * inv_h;
      const ffy = ti * ty * inv_h;
      this.kx = nfx;
      this.ky = nfy;
      this.addKindNow(c.b, FK.normal);
      this.kx = -nfx;
      this.ky = -nfy;
      this.addKindNow(c.a, FK.normal);
      this.kx = ffx;
      this.ky = ffy;
      this.addKindNow(c.b, FK.friction);
      this.kx = -ffx;
      this.ky = -ffy;
      this.addKindNow(c.a, FK.friction);
    }
    for (let q = 0; q < this.joints.length; q++) {
      const j = this.joints[q] as Joint2;
      if (j.broken) continue;
      // a joint's impulse is the last small step's
      const fx = j.impulseX * inv_hs;
      const fy = j.impulseY * inv_hs;
      this.kx = fx;
      this.ky = fy;
      this.addKindNow(j.b, j.kind);
      this.kx = -fx;
      this.ky = -fy;
      this.addKindNow(j.a, j.kind);
      if (j.breaks > 0 && fx * fx + fy * fy > j.breaks * j.breaks) j.broken = true;
    }
    for (let i = 0; i < this.n; i++) {
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) continue;
      const m = this.mass[i] as number;
      // the net force from the change in speed over the step: the small steps put gravity, forces and drag in too
      const o = i * NK * 2 + FK.net * 2;
      this.forces[o] = m * ((this.vx[i] as number) - (v0x[i] as number)) * inv_h;
      this.forces[o + 1] = m * ((this.vy[i] as number) - (v0y[i] as number)) * inv_h;
    }
  }

  /** The force `addKindNow` adds (a field: two numbers passed in a call are two heap numbers when it is not inlined, design 11.4). */
  private kx = 0;
  private ky = 0;

  private addKindNow(i: number, kind: number): void {
    if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) return;
    const o = i * NK * 2 + kind * 2;
    this.forces[o] = (this.forces[o] as number) + this.kx;
    this.forces[o + 1] = (this.forces[o + 1] as number) + this.ky;
  }

  /** Adds a force of a kind to a body's account (water, springs outside the solver). */
  account(i: number, kind: number, fx: number, fy: number): void {
    this.kx = fx;
    this.ky = fy;
    this.addKindNow(i, kind);
  }

  forceOf(i: number, kind: number): { x: number; y: number } {
    const o = i * NK * 2 + kind * 2;
    return { x: this.forces[o] as number, y: this.forces[o + 1] as number };
  }

  /**
   * A hit is the first step a contact pushes (a speculative contact pushes the step before the shapes meet), when the
   * two came together faster than 0.05 m/s.
   */
  private collectHits(): void {
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      const pushing = c.max0 > 0 || (c.m.count > 1 && c.max1 > 0);
      const was = c.pushed;
      c.pushed = pushing;
      if (!pushing || was) continue;
      const speed = -Math.min(c.rv0, c.m.count > 1 ? c.rv1 : c.rv0);
      if (!(speed > HIT_THRESHOLD)) continue;
      this.hits.push({ a: c.a, b: c.b, speed, x: c.px0, y: c.py0, impulse: c.tn0 + (c.m.count > 1 ? c.tn1 : 0) });
    }
  }

  /** The bodies body i touches now, in body order. */
  touching(i: number): number[] {
    const out = new Set<number>();
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      if (!c.touching) continue;
      if (c.a === i) out.add(c.b);
      else if (c.b === i) out.add(c.a);
    }
    return [...out].sort((x, y) => x - y);
  }

  /**
   * Keeps what the cloth did to body b this step out of the fixed shapes (ground, static or kinematic bodies) it touches,
   * from the contacts the world found this step (design 9.5). `io` holds the cloth's move of the body in 0..1 and its speed
   * in 3..4 (2 and 5 are not used). For each touching contact, in the world's order, with the normal n out of the fixed
   * shape: the part of the move and of the speed along -n is taken out. Returns true if it changed `io`.
   */
  keepOut(b: number, io: Float64Array): boolean {
    let changed = false;
    const cs = this.contacts;
    // (indexed: a `for … of` makes an iterator on the heap, garbage, in every step before the engine optimises it)
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k] as (typeof cs)[number];
      if (!c.touching) continue;
      let s: number;
      if (c.b === b && this.type[c.a] !== BodyType.Dynamic) s = 1;
      else if (c.a === b && this.type[c.b] !== BodyType.Dynamic) s = -1;
      else continue;
      const nx = s * c.nx;
      const ny = s * c.ny;
      const dn = (io[0] as number) * nx + (io[1] as number) * ny;
      if (dn < 0) {
        io[0] = (io[0] as number) - dn * nx;
        io[1] = (io[1] as number) - dn * ny;
        changed = true;
      }
      const vn = (io[3] as number) * nx + (io[4] as number) * ny;
      if (vn < 0) {
        io[3] = (io[3] as number) - vn * nx;
        io[4] = (io[4] as number) - vn * ny;
        changed = true;
      }
    }
    return changed;
  }

  /** For every body, the bodies it touches now, in body order (one pass over the contacts). */
  /** Each body's touching bodies, ascending. The lists are the world's own and are refilled by the next call: read them before it. */
  private touchLists: number[][] = [];

  touchingAll(): number[][] {
    const out = this.touchLists;
    while (out.length < this.n) out.push([]);
    out.length = this.n;
    // (a list is emptied with `pop`: `length = 0` frees its store and the next push makes one; `sort` with a comparator makes a copy, so the short lists are sorted by insertion)
    for (let i = 0; i < this.n; i++) {
      const l = out[i] as number[];
      while (l.length > 0) l.pop();
    }
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      if (!c.touching) continue;
      const la = out[c.a] as number[];
      const lb = out[c.b] as number[];
      if (!la.includes(c.b)) la.push(c.b);
      if (!lb.includes(c.a)) lb.push(c.a);
    }
    for (let i = 0; i < this.n; i++) {
      const l = out[i] as number[];
      for (let p = 1; p < l.length; p++) {
        const v = l[p] as number;
        let q = p - 1;
        while (q >= 0 && (l[q] as number) > v) {
          l[q + 1] = l[q] as number;
          q--;
        }
        l[q + 1] = v;
      }
    }
    return out;
  }

  contactPoints(): { x: number; y: number; nx: number; ny: number }[] {
    const out: { x: number; y: number; nx: number; ny: number }[] = [];
    for (let kc = 0; kc < this.contacts.length; kc++) {
      const c = this.contacts[kc] as Contact;
      if (!c.touching) continue;
      this.radA = this.radiusOf(c.sa);
      this.radB = this.radiusOf(c.sb);
      worldManifold(this, c.m, c.a, c.b, this.wm);
      out.push({ x: this.wm.x0, y: this.wm.y0, nx: this.wm.nx, ny: this.wm.ny });
      if (c.m.count > 1) out.push({ x: this.wm.x1, y: this.wm.y1, nx: this.wm.nx, ny: this.wm.ny });
    }
    return out;
  }

  get contactCount(): number {
    let k = 0;
    for (let q = 0; q < this.contacts.length; q++) {
      const c = this.contacts[q] as Contact;
      if (c.touching) k += c.m.count;
    }
    return k;
  }

  kinetic(i: number): number {
    return 0.5 * (this.mass[i] as number) * ((this.vx[i] as number) ** 2 + (this.vy[i] as number) ** 2) + (this.invI[i] !== 0 ? 0.5 * (this.inertia[i] as number) * (this.w[i] as number) ** 2 : 0);
  }

  potential(i: number): number {
    return -(this.mass[i] as number) * (this.gx * (this.px[i] as number) + this.gy * (this.py[i] as number));
  }

  awakeCount(): number {
    let k = 0;
    for (let i = 0; i < this.n; i++) if (this.type[i] === BodyType.Dynamic && this.awake[i] === 1) k++;
    return k;
  }

  /* ------------------------------ checkpoints ------------------------------ */

  /** Everything a step reads that changes: bodies, contacts with their impulses, joints. */
  save(): Float64Array {
    // (no joints: the array is made at its size and written, with no list of numbers made first and copied)
    if (this.joints.length === 0) return this.saveFlat();
    const out: number[] = [this.stepIndex, this.n];
    for (let i = 0; i < this.n; i++) {
      out.push(this.px[i] as number, this.py[i] as number, this.ang[i] as number, this.vx[i] as number, this.vy[i] as number, this.w[i] as number, this.sleepTime[i] as number, this.awake[i] as number, this.type[i] as number);
    }
    out.push(this.contactMap.size);
    for (let q = 0; q < this.contactMap.size; q++) {
      const c = this.contactMap.list[q] as Contact;
      out.push(c.key, c.m.count, (c.touching ? 1 : 0) + (c.pushed ? 2 : 0), c.m.id0, c.ni0, c.ti0, c.m.id1, c.ni1, c.ti1);
    }
    out.push(this.joints.length);
    for (const j of this.joints) {
      out.push(j.broken ? 1 : 0);
      j.save(out);
    }
    out.push(this.gone.size, ...[...this.gone].sort((a, b) => a - b));
    return Float64Array.from(out);
  }

  /** `save` for a world with no joints: the same numbers in the same order. */
  private saveFlat(): Float64Array {
    const n = this.n;
    const cm = this.contactMap;
    const out = new Float64Array(2 + 9 * n + 1 + 9 * cm.size + 2 + this.gone.size);
    out[0] = this.stepIndex;
    out[1] = n;
    let k = 2;
    for (let i = 0; i < n; i++) {
      out[k++] = this.px[i] as number;
      out[k++] = this.py[i] as number;
      out[k++] = this.ang[i] as number;
      out[k++] = this.vx[i] as number;
      out[k++] = this.vy[i] as number;
      out[k++] = this.w[i] as number;
      out[k++] = this.sleepTime[i] as number;
      out[k++] = this.awake[i] as number;
      out[k++] = this.type[i] as number;
    }
    out[k++] = cm.size;
    for (let q = 0; q < cm.size; q++) {
      const c = cm.list[q] as Contact;
      out[k++] = c.key;
      out[k++] = c.m.count;
      out[k++] = (c.touching ? 1 : 0) + (c.pushed ? 2 : 0);
      out[k++] = c.m.id0;
      out[k++] = c.ni0;
      out[k++] = c.ti0;
      out[k++] = c.m.id1;
      out[k++] = c.ni1;
      out[k++] = c.ti1;
    }
    // no joints; the bodies gone, in ascending order
    out[k++] = 0;
    out[k++] = this.gone.size;
    if (this.gone.size > 0) {
      const from = k;
      this.gone.forEach((b) => {
        out[k++] = b;
      });
      out.subarray(from, k).sort();
    }
    return out;
  }

  load(s: Float64Array): void {
    let k = 0;
    this.stepIndex = s[k++] as number;
    const n = s[k++] as number;
    for (let i = 0; i < n; i++) {
      this.px[i] = s[k++] as number;
      this.py[i] = s[k++] as number;
      this.ang[i] = s[k++] as number;
      this.vx[i] = s[k++] as number;
      this.vy[i] = s[k++] as number;
      this.w[i] = s[k++] as number;
      this.sleepTime[i] = s[k++] as number;
      this.awake[i] = s[k++] as number;
      this.type[i] = s[k++] as number;
      this.setRot(i);
    }
    for (let q = 0; q < this.contactMap.size; q++) this.pool.push(this.contactMap.list[q] as Contact);
    this.contactMap.clear();
    this.contacts = [];
    const nc = s[k++] as number;
    for (let i = 0; i < nc; i++) {
      const c = this.pool.pop() ?? newContact();
      c.key = s[k++] as number;
      c.m.count = s[k++] as number;
      const flags = s[k++] as number;
      c.touching = (flags & 1) === 1;
      c.pushed = (flags & 2) === 2;
      c.m.id0 = s[k++] as number;
      c.ni0 = s[k++] as number;
      c.ti0 = s[k++] as number;
      c.m.id1 = s[k++] as number;
      c.ni1 = s[k++] as number;
      c.ti1 = s[k++] as number;
      this.contactMap.set(c);
    }
    const nj = s[k++] as number;
    for (let i = 0; i < nj && i < this.joints.length; i++) {
      const j = this.joints[i] as Joint2;
      j.broken = s[k++] === 1;
      k = j.load(s, k);
    }
    const ng = s[k++] as number;
    this.gone = new Set();
    for (let i = 0; i < ng; i++) {
      const b = s[k++] as number;
      this.gone.add(b);
      this.invM[b] = 0;
      this.invI[b] = 0;
      const s0 = this.shape0[b] as number;
      for (let q = s0; q < s0 + (this.shapeN[b] as number); q++) {
        this.minX[q] = Infinity;
        this.maxX[q] = -Infinity;
      }
    }
    for (let i = 0; i < this.n; i++) if (!this.gone.has(i)) this.updateShapes(i);
  }
}

/**
 * The friction of a pair: `sqrt(μa μb)` (design 6.5). A wall or mover with no friction of its own (NaN) takes the
 * body's, so a lesson that sets only the body's μ gets that μ.
 */
export function mixFriction(a: number, b: number): number {
  if (Number.isNaN(a)) return Number.isNaN(b) ? 0.4 : b;
  if (Number.isNaN(b)) return a;
  return Math.sqrt(a * b);
}

/**
 * The contacts by pair key, in the order they were put (the order a checkpoint saves them in). A `Map` that is cleared or
 * has its entries deleted every step makes a new table each time (design 11.4); this one is two arrays, written over.
 */
class ContactTable {
  /** The contacts in the order put; `size` of them. */
  readonly list: Contact[] = [];
  size = 0;
  private slots = new Int32Array(64);
  private mask = 63;

  private slotOf(key: number): number {
    let s = Math.imul(key | 0, 0x9e3779b1) >>> 0;
    s = (s ^ (s >>> 15)) & this.mask;
    return s;
  }

  get(key: number): Contact | undefined {
    let s = this.slotOf(key);
    for (;;) {
      const at = this.slots[s] as number;
      if (at === 0) return undefined;
      const c = this.list[at - 1] as Contact;
      if (c.key === key) return c;
      s = (s + 1) & this.mask;
    }
  }

  /** Puts a contact (its `key` set); a key already there is not expected (a step puts each pair once). */
  set(c: Contact): void {
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
      let s = this.slotOf((this.list[i] as Contact).key);
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

function newContact(): Contact {
  return {
    stamp: 0,
    key: 0, sa: 0, sb: 0, a: 0, b: 0, m: newManifold(), ni0: 0, ti0: 0, ni1: 0, ti1: 0, friction: 0, restitution: 0, touching: false, wasTouching: false, pushed: false, adj0: 0, adj1: 0, tn0: 0, tn1: 0, tt0: 0, tt1: 0, sv0: 0, sv1: 0, sg0: 0, sg1: 0, sf0: 0, sf1: 0, bounced0: false, bounced1: false,
    nx: 0, ny: 0, rAx0: 0, rAy0: 0, rBx0: 0, rBy0: 0, rAx1: 0, rAy1: 0, rBx1: 0, rBy1: 0, nm0: 0, tm0: 0, nm1: 0, tm1: 0, rv0: 0, rv1: 0, s0: 0, s1: 0, max0: 0, max1: 0, px0: 0, py0: 0,
    block: false, k11: 0, k22: 0, k12: 0, i11: 0, i22: 0, i12: 0,
  };
}

function polyMass(pts: readonly Pt[]): { area: number; cx: number; cy: number; inertia: number } {
  const o = pts[0] as Pt;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let I = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const e1x = (pts[i] as Pt).x - o.x;
    const e1y = (pts[i] as Pt).y - o.y;
    const e2x = (pts[i + 1] as Pt).x - o.x;
    const e2y = (pts[i + 1] as Pt).y - o.y;
    const D = e1x * e2y - e1y * e2x;
    const a = 0.5 * D;
    area += a;
    cx += (a * (e1x + e2x)) / 3;
    cy += (a * (e1y + e2y)) / 3;
    I += (D / 12) * (e1x * e1x + e2x * e1x + e2x * e2x + e1y * e1y + e2y * e1y + e2y * e2y);
  }
  if (!(area > 0)) return { area: 0, cx: o.x, cy: o.y, inertia: 0 };
  cx /= area;
  cy /= area;
  return { area, cx: cx + o.x, cy: cy + o.y, inertia: I - area * (cx * cx + cy * cy) };
}

function makeShape(body: number, d: ShapeDef2, cx: number, cy: number): Shape2 {
  if (d.kind === 'circle') {
    const z = new Float64Array(0);
    return { kind: 0, body, radius: d.r, lcx: d.x - cx, lcy: d.y - cy, lx: z, ly: z, lnx: z, lny: z, wx: z, wy: z, wnx: z, wny: z, wcx: d.x, wcy: d.y };
  }
  const n = d.pts.length;
  const lx = new Float64Array(n);
  const ly = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lx[i] = (d.pts[i] as Pt).x - cx;
    ly[i] = (d.pts[i] as Pt).y - cy;
  }
  const lnx = new Float64Array(n);
  const lny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = (lx[j] as number) - (lx[i] as number);
    const ey = (ly[j] as number) - (ly[i] as number);
    const l = Math.sqrt(ex * ex + ey * ey);
    lnx[i] = l > 0 ? ey / l : 0;
    lny[i] = l > 0 ? -ex / l : 0;
  }
  return { kind: 1, body, radius: 0, lcx: 0, lcy: 0, lx, ly, lnx, lny, wx: new Float64Array(n), wy: new Float64Array(n), wnx: new Float64Array(n), wny: new Float64Array(n), wcx: 0, wcy: 0 };
}

/** The smallest width of a convex polygon (over its edge normals). */
function polyWidth(s: Shape2): number {
  const n = s.lx.length;
  if (n < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const nx = s.lnx[i] as number;
    const ny = s.lny[i] as number;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < n; k++) {
      const d = nx * (s.lx[k] as number) + ny * (s.ly[k] as number);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    if (hi - lo < best) best = hi - lo;
  }
  return best;
}
