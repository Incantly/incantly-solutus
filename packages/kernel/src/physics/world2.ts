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
const BAUMGARTE = 0.2;
const MAX_CORRECTION = 0.2;
const RESTITUTION_THRESHOLD = 1;
const HIT_THRESHOLD = 0.05;
const SLEEP_LIN = 0.01;
const SLEEP_ANG = 0.02;
const TIME_TO_SLEEP = 0.5;
const MAX_TRANSLATION = 50;
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
  private contactMap = new Map<number, Contact>();
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

  step(h: number): void {
    this.hits.length = 0;
    this.left.length = 0;
    const n = this.n;
    const inv_h = 1 / h;
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
    // 1. forces and Push impulses into speeds (semi-implicit Euler)
    const damp = 1 / (1 + h * this.air);
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic) continue;
      const hasPush = this.jx[i] !== 0 || this.jy[i] !== 0 || this.jt[i] !== 0;
      const pushed = hasPush || this.fx[i] !== 0 || this.fy[i] !== 0 || this.torque[i] !== 0;
      if (pushed && this.awake[i] === 0) this.wakeBody(i);
      if (this.awake[i] === 0) continue;
      const m = this.mass[i] as number;
      const im = this.invM[i] as number;
      const ii = this.invI[i] as number;
      const f = i * NK * 2;
      this.forces[f + FK.gravity * 2] = m * this.gx;
      this.forces[f + FK.gravity * 2 + 1] = m * this.gy;
      this.forces[f + FK.applied * 2] = this.fx[i] as number;
      this.forces[f + FK.applied * 2 + 1] = this.fy[i] as number;
      let vx = (this.vx[i] as number) + h * (this.gx + im * (this.fx[i] as number)) + im * (this.jx[i] as number);
      let vy = (this.vy[i] as number) + h * (this.gy + im * (this.fy[i] as number)) + im * (this.jy[i] as number);
      let wv = (this.w[i] as number) + h * ii * (this.torque[i] as number) + ii * (this.jt[i] as number);
      if (this.air > 0) {
        this.forces[f + FK.drag * 2] = (m * vx * (damp - 1)) / h;
        this.forces[f + FK.drag * 2 + 1] = (m * vy * (damp - 1)) / h;
        vx *= damp;
        vy *= damp;
        wv *= damp;
      }
      this.vx[i] = vx;
      this.vy[i] = vy;
      this.w[i] = wv;
      this.jx[i] = 0;
      this.jy[i] = 0;
      this.jt[i] = 0;
    }
    this.electric(h);
    // keep the speeds before the solve, for the net force
    const v0x = this.scratchA(n);
    const v0y = this.scratchB(n);
    for (let i = 0; i < n; i++) {
      v0x[i] = this.vx[i] as number;
      v0y[i] = this.vy[i] as number;
    }
    // 2. boxes, pairs, contacts
    for (let i = 0; i < n; i++) if ((this.type[i] !== BodyType.Static || this.stepIndex === 0) && !this.gone.has(i)) this.updateShapes(i);
    if (this.joints.length > 0) this.noteJointPairs();
    this.findPairs();
    this.updateContacts(h);
    // 3. islands: wake what a moving body touches, put still islands to sleep later
    this.wakeTouched();
    // 4. velocity passes
    this.initContacts(h);
    for (const j of this.joints) if (!j.broken && this.active(j.a, j.b)) j.initVelocity(this, h);
    this.warmStart();
    for (const j of this.joints) if (!j.broken && this.active(j.a, j.b)) j.warmStart(this);
    for (let it = 0; it < this.passes; it++) {
      for (const j of this.joints) if (!j.broken && this.active(j.a, j.b)) j.solveVelocity(this, h);
      this.solveContacts(inv_h);
    }
    this.applyRestitution();
    // 5. move
    for (let i = 0; i < n; i++) {
      // walls and movers are placed by the driver; only bodies move here
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) continue;
      let vx = this.vx[i] as number;
      let vy = this.vy[i] as number;
      const tr2 = (vx * vx + vy * vy) * h * h;
      if (tr2 > MAX_TRANSLATION * MAX_TRANSLATION) {
        const r = MAX_TRANSLATION / Math.sqrt(tr2);
        vx *= r;
        vy *= r;
        this.vx[i] = vx;
        this.vy[i] = vy;
      }
      const ox = this.px[i] as number;
      const oy = this.py[i] as number;
      this.px[i] = ox + h * vx;
      this.py[i] = oy + h * vy;
      this.ang[i] = (this.ang[i] as number) + h * (this.w[i] as number);
      this.setRot(i);
      if (this.type[i] === BodyType.Dynamic && (this.bullet[i] === 1 || Math.sqrt(tr2) > 0.5 * (this.extent[i] as number))) this.sweep(i, ox, oy);
    }
    // 6. position passes (only bodies, never adds speed)
    for (let it = 0; it < 3; it++) {
      let ok = this.solvePositions();
      for (const j of this.joints) if (!j.broken && this.active(j.a, j.b)) ok = j.solvePosition(this) && ok;
      if (ok) break;
    }
    // 7. forces by kind, hits, sleep, bodies that left the world
    this.countForces(h, v0x, v0y);
    this.collectHits();
    if (this.sleeping) this.sleepIslands(h);
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic) continue;
      if (Math.abs(this.px[i] as number) > this.range || Math.abs(this.py[i] as number) > this.range) {
        if (this.awake[i] === 1 || this.invM[i] !== 0) this.left.push(i);
      }
    }
    for (const i of this.left) this.removeBody(i);
    this.stepIndex++;
  }

  private active(a: number, b: number): boolean {
    return (this.type[a] === BodyType.Dynamic && this.awake[a] === 1) || (this.type[b] === BodyType.Dynamic && this.awake[b] === 1);
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
  private electric(h: number): void {
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
        this.addForce(i, -fx, -fy, h);
        this.addForce(j, fx, fy, h);
      }
    }
  }

  private addForce(i: number, fx: number, fy: number, h: number): void {
    if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) return;
    const o = i * NK * 2 + FK.electric * 2;
    this.forces[o] = (this.forces[o] as number) + fx;
    this.forces[o + 1] = (this.forces[o + 1] as number) + fy;
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
    this.pairs.subarray(0, this.pairCount).sort();
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

  private updateContacts(h: number): void {
    const old = this.contactMap;
    const next = new Map<number, Contact>();
    const list: Contact[] = [];
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
        c.m.count = 0;
      } else old.delete(key);
      c.sa = sa;
      c.sb = sb;
      c.a = A.body;
      c.b = B.body;
      const margin = this.marginOf(A.body) + this.marginOf(B.body, h);
      const oldCount = c.m.count;
      const o0 = c.m.id0;
      const o1 = c.m.id1;
      const n0 = c.ni0;
      const t0 = c.ti0;
      const n1 = c.ni1;
      const t1 = c.ti1;
      if (A.kind === 0) collideCircles(this, A, B, margin, c.m);
      else if (B.kind === 0) collidePolygonCircle(this, A, B, margin, c.m);
      else collidePolygons(this, A, B, margin, c.m);
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
        next.set(key, c);
        continue;
      }
      if (points + c.m.count > MAX_CONTACT_POINTS) {
        this.contactsDropped = true;
        c.m.count = 0;
        c.touching = false;
        next.set(key, c);
        continue;
      }
      points += c.m.count;
      c.friction = mixFriction(this.fric[c.a] as number, this.fric[c.b] as number);
      c.restitution = Math.max(this.rest[c.a] as number, this.rest[c.b] as number);
      next.set(key, c);
      list.push(c);
    }
    for (const c of old.values()) this.pool.push(c);
    this.contactMap = next;
    this.contacts = list;
  }

  private marginOf(b: number, h = 1 / 120): number {
    return 2 * LINEAR_SLOP + h * (Math.sqrt((this.vx[b] as number) ** 2 + (this.vy[b] as number) ** 2) + Math.abs(this.w[b] as number) * (this.reach[b] as number));
  }

  private radiusOf(s: number): number {
    return (this.shapes[s] as Shape2).radius;
  }

  private initContacts(h: number): void {
    const wm = this.wm;
    for (const c of this.contacts) {
      const a = c.a;
      const b = c.b;
      worldManifold(this, c.m, a, this.radiusOf(c.sa), b, this.radiusOf(c.sb), wm);
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
    void h;
  }

  private applyImpulse(a: number, b: number, rAx: number, rAy: number, rBx: number, rBy: number, Px: number, Py: number): void {
    this.vx[a] = (this.vx[a] as number) - (this.invM[a] as number) * Px;
    this.vy[a] = (this.vy[a] as number) - (this.invM[a] as number) * Py;
    this.w[a] = (this.w[a] as number) - (this.invI[a] as number) * (rAx * Py - rAy * Px);
    this.vx[b] = (this.vx[b] as number) + (this.invM[b] as number) * Px;
    this.vy[b] = (this.vy[b] as number) + (this.invM[b] as number) * Py;
    this.w[b] = (this.w[b] as number) + (this.invI[b] as number) * (rBx * Py - rBy * Px);
  }

  private warmStart(): void {
    for (const c of this.contacts) {
      const tx = c.ny;
      const ty = -c.nx;
      for (let k = 0; k < c.m.count; k++) {
        const ni = k === 0 ? c.ni0 : c.ni1;
        const ti = k === 0 ? c.ti0 : c.ti1;
        if (ni === 0 && ti === 0) continue;
        const Px = ni * c.nx + ti * tx;
        const Py = ni * c.ny + ti * ty;
        if (k === 0) this.applyImpulse(c.a, c.b, c.rAx0, c.rAy0, c.rBx0, c.rBy0, Px, Py);
        else this.applyImpulse(c.a, c.b, c.rAx1, c.rAy1, c.rBx1, c.rBy1, Px, Py);
      }
    }
  }

  private solveContacts(inv_h: number): void {
    const vx = this.vx;
    const vy = this.vy;
    const w = this.w;
    for (const c of this.contacts) {
      const a = c.a;
      const b = c.b;
      const tx = c.ny;
      const ty = -c.nx;
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
        if (d !== 0) this.applyImpulse(a, b, rAx, rAy, rBx, rBy, d * tx, d * ty);
      }
      if (c.block) {
        this.solveBlock(c, inv_h);
        continue;
      }
      for (let k = 0; k < c.m.count; k++) {
        const rAx = k === 0 ? c.rAx0 : c.rAx1;
        const rAy = k === 0 ? c.rAy0 : c.rAy1;
        const rBx = k === 0 ? c.rBx0 : c.rBx1;
        const rBy = k === 0 ? c.rBy0 : c.rBy1;
        const dvx = (vx[b] as number) - (w[b] as number) * rBy - (vx[a] as number) + (w[a] as number) * rAy;
        const dvy = (vy[b] as number) + (w[b] as number) * rBx - (vy[a] as number) - (w[a] as number) * rAx;
        const vn = dvx * c.nx + dvy * c.ny;
        const s = k === 0 ? c.s0 : c.s1;
        // a speculative point may close its gap this step, but not more
        const bias = s > 0 ? s * inv_h : 0;
        const nm = k === 0 ? c.nm0 : c.nm1;
        const old = k === 0 ? c.ni0 : c.ni1;
        let ni = old - nm * (vn + bias);
        if (ni < 0) ni = 0;
        const d = ni - old;
        if (k === 0) {
          c.ni0 = ni;
          if (ni > c.max0) c.max0 = ni;
        } else {
          c.ni1 = ni;
          if (ni > c.max1) c.max1 = ni;
        }
        if (d !== 0) this.applyImpulse(a, b, rAx, rAy, rBx, rBy, d * c.nx, d * c.ny);
      }
    }
  }

  /**
   * The two normal impulses of a two-point contact at once: the 2×2 linear complementarity problem solved by trying the
   * four cases in turn (both push, only the first, only the second, neither), as Box2D's block solver does.
   */
  private solveBlock(c: Contact, inv_h: number): void {
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
    // the speed each point must reach: 0, or the speculative gap closed this step
    const b1 = dv1x * c.nx + dv1y * c.ny + (c.s0 > 0 ? c.s0 * inv_h : 0) - (c.k11 * a1 + c.k12 * a2);
    const b2 = dv2x * c.nx + dv2y * c.ny + (c.s1 > 0 ? c.s1 * inv_h : 0) - (c.k12 * a1 + c.k22 * a2);
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
    if (x1 > c.max0) c.max0 = x1;
    if (x2 > c.max1) c.max1 = x2;
    if (d1 !== 0) this.applyImpulse(a, b, c.rAx0, c.rAy0, c.rBx0, c.rBy0, d1 * c.nx, d1 * c.ny);
    if (d2 !== 0) this.applyImpulse(a, b, c.rAx1, c.rAy1, c.rBx1, c.rBy1, d2 * c.nx, d2 * c.ny);
  }

  /** Bounce after the velocity passes, from the speed each point had before them (so speculative points bounce too). */
  private applyRestitution(): void {
    const vx = this.vx;
    const vy = this.vy;
    const w = this.w;
    for (const c of this.contacts) {
      if (c.restitution === 0) continue;
      for (let k = 0; k < c.m.count; k++) {
        const rv = k === 0 ? c.rv0 : c.rv1;
        const mx = k === 0 ? c.max0 : c.max1;
        if (rv > -RESTITUTION_THRESHOLD || mx === 0) continue;
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
        if (d !== 0) this.applyImpulse(c.a, c.b, rAx, rAy, rBx, rBy, d * c.nx, d * c.ny);
      }
    }
  }

  /** One pass of overlap removal on positions (Box2D's non-linear Gauss–Seidel). True when every overlap is small. */
  private solvePositions(): boolean {
    const wm = this.wm;
    let minSep = 0;
    for (const c of this.contacts) {
      const a = c.a;
      const b = c.b;
      const mA = this.invM[a] as number;
      const mB = this.invM[b] as number;
      const iA = this.invI[a] as number;
      const iB = this.invI[b] as number;
      if (mA + mB === 0) continue;
      for (let k = 0; k < c.m.count; k++) {
        worldManifold(this, c.m, a, this.radiusOf(c.sa), b, this.radiusOf(c.sb), wm);
        const x = k === 0 ? wm.x0 : wm.x1;
        const y = k === 0 ? wm.y0 : wm.y1;
        const s = k === 0 ? wm.s0 : wm.s1;
        if (s < minSep) minSep = s;
        const C = Math.max(-MAX_CORRECTION, Math.min(0, BAUMGARTE * (s + LINEAR_SLOP)));
        if (C === 0) continue;
        const rAx = x - (this.px[a] as number);
        const rAy = y - (this.py[a] as number);
        const rBx = x - (this.px[b] as number);
        const rBy = y - (this.py[b] as number);
        const rnA = rAx * wm.ny - rAy * wm.nx;
        const rnB = rBx * wm.ny - rBy * wm.nx;
        const K = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
        const imp = K > 0 ? -C / K : 0;
        const Px = imp * wm.nx;
        const Py = imp * wm.ny;
        this.px[a] = (this.px[a] as number) - mA * Px;
        this.py[a] = (this.py[a] as number) - mA * Py;
        this.ang[a] = (this.ang[a] as number) - iA * (rAx * Py - rAy * Px);
        this.px[b] = (this.px[b] as number) + mB * Px;
        this.py[b] = (this.py[b] as number) + mB * Py;
        this.ang[b] = (this.ang[b] as number) + iB * (rBx * Py - rBy * Px);
        if (iA !== 0) this.setRot(a);
        if (iB !== 0) this.setRot(b);
      }
    }
    return minSep >= -3 * LINEAR_SLOP;
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
        if (A.kind === 0 && B.kind === 0) collideCircles(this, A, B, 0, m);
        else if (A.kind === 0) collidePolygonCircle(this, B, A, 0, m);
        else if (B.kind === 0) collidePolygonCircle(this, A, B, 0, m);
        else collidePolygons(this, A, B, 0, m);
        if (m.count > 0) {
          const ra = A.kind === 0 && B.kind === 1 ? B.radius : A.radius;
          worldManifold(this, m, A.kind === 0 && B.kind === 1 ? B.body : A.body, ra, A.kind === 0 && B.kind === 1 ? A.body : B.body, A.kind === 0 && B.kind === 1 ? A.radius : B.radius, this.wm);
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
    const join = (a: number, b: number): void => {
      if (this.type[a] !== BodyType.Dynamic || this.type[b] !== BodyType.Dynamic) return;
      const ra = this.find(a);
      const rb = this.find(b);
      if (ra !== rb) this.parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
    };
    for (const c of this.contacts) if (c.m.count > 0) join(c.a, c.b);
    for (const j of this.joints) if (!j.broken) join(j.a, j.b);
  }

  /** Wakes a sleeping body that an awake one, or a moving mover, touches; and its whole island. */
  private wakeTouched(): void {
    if (!this.sleeping) return;
    this.islands();
    const n = this.n;
    const islandAwake = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (this.type[i] === BodyType.Dynamic && this.awake[i] === 1) islandAwake[this.find(i)] = 1;
    for (const c of this.contacts) {
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

  private sleepIslands(h: number): void {
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
    const minT = new Float64Array(n).fill(Infinity);
    for (let i = 0; i < n; i++) {
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) continue;
      const r = this.find(i);
      if ((this.sleepTime[i] as number) < (minT[r] as number)) minT[r] = this.sleepTime[i] as number;
    }
    // an island touching a moving mover stays awake
    for (const c of this.contacts) {
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

  private countForces(h: number, v0x: Float64Array, v0y: Float64Array): void {
    const inv_h = 1 / h;
    for (const c of this.contacts) {
      const tx = c.ny;
      const ty = -c.nx;
      let ni = 0;
      let ti = 0;
      for (let k = 0; k < c.m.count; k++) {
        ni += k === 0 ? c.ni0 : c.ni1;
        ti += k === 0 ? c.ti0 : c.ti1;
      }
      const nfx = ni * c.nx * inv_h;
      const nfy = ni * c.ny * inv_h;
      const ffx = ti * tx * inv_h;
      const ffy = ti * ty * inv_h;
      this.addKind(c.b, FK.normal, nfx, nfy);
      this.addKind(c.a, FK.normal, -nfx, -nfy);
      this.addKind(c.b, FK.friction, ffx, ffy);
      this.addKind(c.a, FK.friction, -ffx, -ffy);
    }
    for (const j of this.joints) {
      if (j.broken) continue;
      const fx = j.impulseX * inv_h;
      const fy = j.impulseY * inv_h;
      this.addKind(j.b, j.kind, fx, fy);
      this.addKind(j.a, j.kind, -fx, -fy);
      if (j.breaks > 0 && fx * fx + fy * fy > j.breaks * j.breaks) j.broken = true;
    }
    for (let i = 0; i < this.n; i++) {
      if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) continue;
      const m = this.mass[i] as number;
      // the net force from the change in speed over the step (gravity and forces included)
      const o = i * NK * 2 + FK.net * 2;
      const g = i * NK * 2 + FK.gravity * 2;
      const a = i * NK * 2 + FK.applied * 2;
      const e = i * NK * 2 + FK.electric * 2;
      const d = i * NK * 2 + FK.drag * 2;
      this.forces[o] = (m * ((this.vx[i] as number) - (v0x[i] as number))) * inv_h + (this.forces[g] as number) + (this.forces[a] as number) + (this.forces[e] as number) + (this.forces[d] as number);
      this.forces[o + 1] = (m * ((this.vy[i] as number) - (v0y[i] as number))) * inv_h + (this.forces[g + 1] as number) + (this.forces[a + 1] as number) + (this.forces[e + 1] as number) + (this.forces[d + 1] as number);

    }
  }

  private addKind(i: number, kind: number, fx: number, fy: number): void {
    if (this.type[i] !== BodyType.Dynamic || this.awake[i] === 0) return;
    const o = i * NK * 2 + kind * 2;
    this.forces[o] = (this.forces[o] as number) + fx;
    this.forces[o + 1] = (this.forces[o + 1] as number) + fy;
  }

  /** Adds a force of a kind to a body's account (water, springs outside the solver). */
  account(i: number, kind: number, fx: number, fy: number): void {
    this.addKind(i, kind, fx, fy);
  }

  forceOf(i: number, kind: number): { x: number; y: number } {
    const o = i * NK * 2 + kind * 2;
    return { x: this.forces[o] as number, y: this.forces[o + 1] as number };
  }

  private collectHits(): void {
    for (const c of this.contacts) {
      if (!c.touching || c.wasTouching) continue;
      const speed = -Math.min(c.rv0, c.m.count > 1 ? c.rv1 : c.rv0);
      if (!(speed > HIT_THRESHOLD)) continue;
      this.hits.push({ a: c.a, b: c.b, speed, x: c.px0, y: c.py0, impulse: c.ni0 + (c.m.count > 1 ? c.ni1 : 0) });
    }
  }

  /** The bodies body i touches now, in body order. */
  touching(i: number): number[] {
    const out = new Set<number>();
    for (const c of this.contacts) {
      if (!c.touching) continue;
      if (c.a === i) out.add(c.b);
      else if (c.b === i) out.add(c.a);
    }
    return [...out].sort((x, y) => x - y);
  }

  /** For every body, the bodies it touches now, in body order (one pass over the contacts). */
  touchingAll(): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < this.n; i++) out.push([]);
    for (const c of this.contacts) {
      if (!c.touching) continue;
      const la = out[c.a] as number[];
      const lb = out[c.b] as number[];
      if (!la.includes(c.b)) la.push(c.b);
      if (!lb.includes(c.a)) lb.push(c.a);
    }
    for (const l of out) l.sort((x, y) => x - y);
    return out;
  }

  contactPoints(): { x: number; y: number; nx: number; ny: number }[] {
    const out: { x: number; y: number; nx: number; ny: number }[] = [];
    for (const c of this.contacts) {
      if (!c.touching) continue;
      worldManifold(this, c.m, c.a, this.radiusOf(c.sa), c.b, this.radiusOf(c.sb), this.wm);
      out.push({ x: this.wm.x0, y: this.wm.y0, nx: this.wm.nx, ny: this.wm.ny });
      if (c.m.count > 1) out.push({ x: this.wm.x1, y: this.wm.y1, nx: this.wm.nx, ny: this.wm.ny });
    }
    return out;
  }

  get contactCount(): number {
    let k = 0;
    for (const c of this.contacts) if (c.touching) k += c.m.count;
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
    const out: number[] = [this.stepIndex, this.n];
    for (let i = 0; i < this.n; i++) {
      out.push(this.px[i] as number, this.py[i] as number, this.ang[i] as number, this.vx[i] as number, this.vy[i] as number, this.w[i] as number, this.sleepTime[i] as number, this.awake[i] as number, this.type[i] as number);
    }
    out.push(this.contactMap.size);
    for (const c of this.contactMap.values()) {
      out.push(c.key, c.m.count, c.touching ? 1 : 0, c.m.id0, c.ni0, c.ti0, c.m.id1, c.ni1, c.ti1);
    }
    out.push(this.joints.length);
    for (const j of this.joints) {
      out.push(j.broken ? 1 : 0);
      j.save(out);
    }
    out.push(this.gone.size, ...[...this.gone].sort((a, b) => a - b));
    return Float64Array.from(out);
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
    for (const c of this.contactMap.values()) this.pool.push(c);
    this.contactMap = new Map();
    this.contacts = [];
    const nc = s[k++] as number;
    for (let i = 0; i < nc; i++) {
      const c = this.pool.pop() ?? newContact();
      c.key = s[k++] as number;
      c.m.count = s[k++] as number;
      c.touching = s[k++] === 1;
      c.m.id0 = s[k++] as number;
      c.ni0 = s[k++] as number;
      c.ti0 = s[k++] as number;
      c.m.id1 = s[k++] as number;
      c.ni1 = s[k++] as number;
      c.ti1 = s[k++] as number;
      this.contactMap.set(c.key, c);
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

function newContact(): Contact {
  return {
    key: 0, sa: 0, sb: 0, a: 0, b: 0, m: newManifold(), ni0: 0, ti0: 0, ni1: 0, ti1: 0, friction: 0, restitution: 0, touching: false, wasTouching: false,
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
