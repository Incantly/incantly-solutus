import type { Body2D, ForceKind, Joint2D, Live, Vec2 } from '../../api/types';
import { SceneApiError } from '../../scene/errors';
import { collide, LINEAR_SLOP, overlaps, positionManifold, worldManifold, type Manifold, type ManifoldPoint } from './collide';
import { areaAndCentroid, clip, cross, extent, massOf, outline, radiusOf, toLocal, toWorld, type Frame, type Rot, type Shape, type V2 } from './geometry';

/**
 * The simulation: rigid bodies with an impulse solver in the manner of Box2D
 * (sequential impulses with warm starting for velocities, then a
 * non-linear Gauss-Seidel pass for positions, which adds no energy), joints
 * as constraints, liquids by clipping each body against the surface, and
 * per-kind force accounting so the figure can draw the forces that actually
 * acted. Everything steps at a fixed rate, so results do not depend on the
 * frame rate (PH-8).
 */

export const FORCE_KINDS: readonly ForceKind[] = ['gravity', 'normal', 'friction', 'tension', 'spring', 'buoyancy', 'drag', 'electric', 'magnetic', 'applied', 'net'];
const KINDS = FORCE_KINDS.length;
const index = Object.fromEntries(FORCE_KINDS.map((kind, i) => [kind, i])) as Record<ForceKind, number>;
const NET = index.net;

export function isForceKind(value: unknown): value is ForceKind {
  return typeof value === 'string' && Object.hasOwn(index, value);
}

/** Seconds per step. */
export const STEP = 1 / 120;
const VELOCITY_ITERATIONS = 10;
const POSITION_ITERATIONS = 4;
const BAUMGARTE = 0.2;
const MAX_CORRECTION = 0.2;
/** Slower approaches than this do not bounce, so resting bodies settle. */
const RESTITUTION_THRESHOLD = 0.5;
const MAX_TRANSLATION = 2;
const MAX_ROTATION = 0.5 * Math.PI;
/** Coulomb's constant, N·m²/C². */
const COULOMB = 8.99e9;
/** Liquid drag per second, as a share of the displaced liquid's mass. */
const LIQUID_DRAG = 5;
/** The learner's grip on a dragged body: a stiff, well damped spring. */
const GRIP_HZ = 4;
const GRIP_DAMPING = 0.9;
/** Hits slower than this are contact settling, not collisions. */
const HIT_SPEED = 0.05;

export const MAX_BODIES = 60;
export const MAX_JOINTS = 60;

export type BodyKind = 'ball' | 'box' | 'polygon' | 'ramp' | 'wall';

export function read<T>(value: Live<T> | undefined, fallback: T): T {
  return typeof value === 'function' ? (value as () => T)() : (value ?? fallback);
}

/** What a body is made from; restarting reads its live values again. */
export interface BodySpec {
  readonly kind: BodyKind;
  readonly fixed: boolean;
  readonly sensor: boolean;
  /** The shape around its centre of mass, and where that centre is from the given position. */
  readonly shape: () => { shape: Shape; centroid: V2 };
  readonly at: Live<Vec2>;
  readonly angle?: Live<number> | undefined;
  readonly mass?: Live<number> | undefined;
  readonly density?: Live<number> | undefined;
  readonly velocity?: Live<Vec2> | undefined;
  readonly spin?: Live<number> | undefined;
  readonly friction?: Live<number> | undefined;
  readonly bounce?: Live<number> | undefined;
  readonly charge?: Live<number> | undefined;
  readonly magnet?: Live<number> | undefined;
  readonly name: string;
}

export function finitePoint(value: unknown, what: string): V2 {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    throw new SceneApiError(`${what} must be a point [x, y] of finite numbers, in metres`);
  }
  return [value[0] as number, value[1] as number];
}

export function finiteNumber(value: unknown, what: string, ok: (n: number) => boolean = () => true, need = 'a finite number'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !ok(value)) throw new SceneApiError(`${what} must be ${need}, got ${String(value)}`);
  return value;
}

export class Body implements Frame {
  shape: Shape = { type: 'circle', r: 1 };
  extent = 1;
  area = 1;
  x = 0;
  y = 0;
  a = 0;
  q: Rot = { c: 1, s: 0 };
  vx = 0;
  vy = 0;
  w = 0;
  m = 0;
  invM = 0;
  I = 0;
  invI = 0;
  /** Null defers to what it touches: walls and ramps take the moving body's friction. */
  friction: number | null = null;
  bounce = 0;
  /** Coulombs. */
  charge = 0;
  magnet = 0;
  /** Half the distance between the magnet's poles. */
  poles = 0;
  push: V2 = [0, 0];
  /** Hidden bodies leave the simulation until shown again. */
  active = true;
  fx = 0;
  fy = 0;
  torque = 0;
  minX = 0;
  minY = 0;
  maxX = 0;
  maxY = 0;
  /** Forces of each kind this step, newtons, as x and y pairs. */
  readonly stepForce = new Float64Array(2 * KINDS);
  /** Impulse of each kind over the frame so far. */
  readonly frameImpulse = new Float64Array(2 * KINDS);
  /** Average force of each kind over the last frame: what readouts and arrows show. */
  readonly shown = new Float64Array(2 * KINDS);
  /** Changes made before the world first stepped: part of the initial state. */
  readonly start: { at?: V2; angle?: number; velocity?: V2; spin?: number; push?: V2 } = {};
  handle!: Body2D;

  constructor(
    readonly id: number,
    readonly spec: BodySpec,
  ) {}

  get fixed(): boolean {
    return this.spec.fixed;
  }

  get sensor(): boolean {
    return this.spec.sensor;
  }

  get dynamic(): boolean {
    return !this.spec.fixed;
  }

  setAngle(a: number): void {
    this.a = a;
    this.q = { c: Math.cos(a), s: Math.sin(a) };
  }

  /** Reads the spec: shape, mass, materials and the starting state. */
  setup(): void {
    const { spec } = this;
    const { shape, centroid } = spec.shape();
    this.shape = shape;
    this.extent = extent(shape);
    const mass = massOf(shape);
    this.area = mass.area;
    const angle = finiteNumber(read(spec.angle, 0), `${spec.name}: angle`);
    const at = finitePoint(read(spec.at, [0, 0]), `${spec.name}: at`);
    const a = ((this.start.angle ?? angle) * Math.PI) / 180;
    this.setAngle(a);
    // A polygon's points are around the given position; the body turns about its centre of mass.
    const base = this.start.at ?? at;
    this.x = base[0] + this.q.c * centroid[0] - this.q.s * centroid[1];
    this.y = base[1] + this.q.s * centroid[0] + this.q.c * centroid[1];
    if (spec.fixed) {
      this.m = this.invM = this.I = this.invI = 0;
    } else {
      const given = spec.mass !== undefined ? finiteNumber(read(spec.mass, 1), `${spec.name}: mass`, (n) => n > 0, 'above 0 kg') : null;
      const density = spec.density !== undefined ? finiteNumber(read(spec.density, 1000), `${spec.name}: density`, (n) => n > 0, 'above 0 kg/m³') : null;
      this.m = given ?? (density !== null ? density * mass.area : 1);
      this.invM = 1 / this.m;
      this.I = (this.m * mass.inertia) / mass.area;
      this.invI = this.I > 0 ? 1 / this.I : 0;
    }
    this.friction =
      spec.friction !== undefined
        ? finiteNumber(read(spec.friction, 0.3), `${spec.name}: friction`, (n) => n >= 0 && n <= 10, 'from 0 to 10')
        : spec.fixed
          ? null
          : 0.3;
    this.bounce = spec.bounce !== undefined ? finiteNumber(read(spec.bounce, 0.2), `${spec.name}: bounce`, (n) => n >= 0 && n <= 1, 'from 0 to 1') : spec.fixed ? 0 : 0.2;
    this.charge = spec.charge !== undefined ? finiteNumber(read(spec.charge, 0), `${spec.name}: charge`) * 1e-6 : 0;
    this.magnet = spec.magnet !== undefined ? finiteNumber(read(spec.magnet, 0), `${spec.name}: magnet`) : 0;
    this.poles = shape.type === 'circle' ? 0.6 * shape.r : 0.8 * Math.max(...shape.verts.map((v) => Math.abs(v[0])));
    const velocity = this.start.velocity ?? (spec.velocity !== undefined ? finitePoint(read(spec.velocity, [0, 0]), `${spec.name}: velocity`) : [0, 0]);
    const spin = this.start.spin ?? (spec.spin !== undefined ? finiteNumber(read(spec.spin, 0), `${spec.name}: spin`) : 0);
    this.vx = spec.fixed ? 0 : velocity[0];
    this.vy = spec.fixed ? 0 : velocity[1];
    this.w = spec.fixed ? 0 : (spin * Math.PI) / 180;
    this.push = this.start.push ? [...this.start.push] : [0, 0];
    this.stepForce.fill(0);
    this.frameImpulse.fill(0);
    this.shown.fill(0);
    this.bounds();
  }

  bounds(): void {
    if (this.shape.type === 'circle') {
      const r = this.shape.r;
      this.minX = this.x - r;
      this.maxX = this.x + r;
      this.minY = this.y - r;
      this.maxY = this.y + r;
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [lx, ly] of this.shape.verts) {
      const [wx, wy] = toWorld(this, lx, ly);
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
    }
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  /** Adds a force this step, at a world point when it turns the body. */
  apply(kind: ForceKind, fx: number, fy: number, px?: number, py?: number): void {
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) return;
    const i = index[kind] * 2;
    this.stepForce[i] = this.stepForce[i]! + fx;
    this.stepForce[i + 1] = this.stepForce[i + 1]! + fy;
    if (this.fixed) return;
    this.fx += fx;
    this.fy += fy;
    if (px !== undefined && py !== undefined) this.torque += cross(px - this.x, py - this.y, fx, fy);
  }

  /** Records a force the solver applied as an impulse (contacts, joints): it is already in the velocity. */
  record(kind: ForceKind, fx: number, fy: number): void {
    const i = index[kind] * 2;
    this.stepForce[i] = this.stepForce[i]! + fx;
    this.stepForce[i + 1] = this.stepForce[i + 1]! + fy;
  }

  /** The shown force of one kind; `net` is the sum of the others. */
  force(kind: ForceKind): Vec2 {
    if (kind !== 'net') return [this.shown[index[kind] * 2]!, this.shown[index[kind] * 2 + 1]!];
    let fx = 0;
    let fy = 0;
    for (let k = 0; k < KINDS; k++) {
      if (k === NET) continue;
      fx += this.shown[k * 2]!;
      fy += this.shown[k * 2 + 1]!;
    }
    return [fx, fy];
  }

  /** Velocity of a world point on the body. */
  velocityAt(px: number, py: number): V2 {
    return [this.vx - this.w * (py - this.y), this.vy + this.w * (px - this.x)];
  }
}

export type JointKind = 'spring' | 'rope' | 'rod' | 'hinge' | 'pulley';

export interface JointSpec {
  readonly kind: JointKind;
  readonly a: Body | null;
  readonly b: Body | null;
  /** On A in its frame, or a fixed world point when A is null; the same for B. */
  readonly anchorA: V2;
  readonly anchorB: V2;
  readonly length?: Live<number> | undefined;
  readonly stiffness?: Live<number> | undefined;
  readonly damping?: Live<number> | undefined;
  readonly motor?: Live<number> | undefined;
  readonly torque?: number | undefined;
  /** Pulleys: the wheel's centre and radius. */
  readonly wheel?: { readonly at: V2; readonly r: number };
  readonly name: string;
}

export class Joint {
  length = 0;
  stiffness = 0;
  damping = 0;
  /** Radians per second, or null without a motor. */
  motor: number | null = null;
  maxTorque = 100;
  active = true;
  /** The rest length the scene changed to with setLength, kept on restart. */
  setLengthTo: number | null = null;
  // Solver state
  impulse = 0;
  impulseX = 0;
  impulseY = 0;
  motorImpulse = 0;
  mass = 0;
  motorMass = 0;
  ux = 0;
  uy = 0;
  ubx = 0;
  uby = 0;
  rAx = 0;
  rAy = 0;
  rBx = 0;
  rBy = 0;
  current = 0;
  gamma = 0;
  bias = 0;
  k11 = 0;
  k12 = 0;
  k22 = 0;
  /** Springs soft enough to integrate as forces stay accurate; stiff ones become soft constraints. */
  explicit = false;
  gA: V2 = [0, 0];
  gB: V2 = [0, 0];
  /** Pull along the joint this step, newtons. */
  stepTension = 0;
  frameImpulse = 0;
  tension = 0;
  handle!: Joint2D;

  constructor(readonly spec: JointSpec) {}

  get kind(): JointKind {
    return this.spec.kind;
  }

  get a(): Body | null {
    return this.spec.a;
  }

  get b(): Body | null {
    return this.spec.b;
  }

  /** Whether the joint takes part: it and both its bodies are shown. */
  get live(): boolean {
    return this.active && (this.a?.active ?? true) && (this.b?.active ?? true);
  }

  anchorA(): V2 {
    return this.a ? toWorld(this.a, this.spec.anchorA[0], this.spec.anchorA[1]) : this.spec.anchorA;
  }

  anchorB(): V2 {
    return this.b ? toWorld(this.b, this.spec.anchorB[0], this.spec.anchorB[1]) : this.spec.anchorB;
  }

  /** Length now: between the anchors, or both rope lengths of a pulley. */
  measure(): number {
    const pA = this.anchorA();
    const pB = this.anchorB();
    if (this.kind === 'pulley') return Math.hypot(pA[0] - this.gA[0], pA[1] - this.gA[1]) + Math.hypot(pB[0] - this.gB[0], pB[1] - this.gB[1]);
    return Math.hypot(pB[0] - pA[0], pB[1] - pA[1]);
  }

  setup(): void {
    const { spec } = this;
    if (spec.wheel) {
      const { at, r } = spec.wheel;
      const pA = this.anchorA();
      const pB = this.anchorB();
      // Each rope hangs from the side of the wheel nearer its body.
      const aLeft = pA[0] <= pB[0];
      this.gA = [at[0] + (aLeft ? -r : r), at[1]];
      this.gB = [at[0] + (aLeft ? r : -r), at[1]];
    }
    const measured = this.measure();
    this.length =
      this.setLengthTo ?? (spec.length !== undefined ? finiteNumber(read(spec.length, measured), `${spec.name}: length`, (n) => n >= 0 && n <= 1000, 'from 0 to 1000 metres') : measured);
    this.stiffness = spec.stiffness !== undefined ? finiteNumber(read(spec.stiffness, 50), `${spec.name}: stiffness`, (n) => n > 0, 'above 0 N/m') : 50;
    this.damping = spec.damping !== undefined ? finiteNumber(read(spec.damping, 0.5), `${spec.name}: damping`, (n) => n >= 0, '0 or more N per m/s') : 0.5;
    this.motor = spec.motor !== undefined ? (finiteNumber(read(spec.motor, 0), `${spec.name}: motor`) * Math.PI) / 180 : null;
    this.maxTorque = spec.torque !== undefined ? finiteNumber(spec.torque, `${spec.name}: torque`, (n) => n >= 0, '0 or more N·m') : 100;
    this.impulse = this.impulseX = this.impulseY = this.motorImpulse = 0;
    this.stepTension = this.frameImpulse = this.tension = 0;
  }
}

export interface TankSpec {
  readonly x: number;
  readonly w: number;
  readonly depth: Live<number>;
  readonly h: number | undefined;
  readonly density: Live<number> | undefined;
}

export class Tank {
  depth = 0;
  density = 1000;
  level = 0;
  displaced = 0;
  height = 0;
  readonly walls: Body[] = [];

  constructor(readonly spec: TankSpec) {}

  get x0(): number {
    return this.spec.x;
  }

  get x1(): number {
    return this.spec.x + this.spec.w;
  }

  setup(): void {
    this.depth = finiteNumber(read(this.spec.depth, 1), 'tank: depth', (n) => n >= 0 && n <= 1000, 'from 0 to 1000 metres');
    this.density = this.spec.density !== undefined ? finiteNumber(read(this.spec.density, 1000), 'tank: density', (n) => n > 0, 'above 0 kg/m³') : 1000;
    this.level = this.depth;
    this.displaced = 0;
  }

  /** The part of a body below the surface and between the walls: area and centre. */
  submerged(body: Body, level = this.level): { area: number; x: number; y: number } {
    if (body.maxX <= this.x0 || body.minX >= this.x1 || body.minY >= level) return { area: 0, x: 0, y: 0 };
    let points = outline(body.shape, body, 32);
    points = clip(points, (p) => level - p[1]);
    points = clip(points, (p) => p[0] - this.x0);
    points = clip(points, (p) => this.x1 - p[0]);
    return areaAndCentroid(points);
  }
}

interface ContactPoint {
  rAx: number;
  rAy: number;
  rBx: number;
  rBy: number;
  normalMass: number;
  tangentMass: number;
  velocityBias: number;
}

class Contact {
  nx = 0;
  ny = 0;
  friction = 0;
  restitution = 0;
  /** Fastest approach along the normal when the contact was made, m/s. */
  approach = 0;
  solver: ContactPoint[] = [];

  constructor(
    readonly a: Body,
    readonly b: Body,
    public manifold: Manifold,
  ) {}
}

export interface HitEvent {
  readonly a: Body;
  readonly b: Body;
  readonly speed: number;
}

function mixFriction(a: Body, b: Body): number {
  if (a.friction === null && b.friction === null) return 0.3;
  if (a.friction === null) return b.friction!;
  if (b.friction === null) return a.friction;
  return Math.sqrt(a.friction * b.friction);
}

const pairKey = (a: Body, b: Body): number => (a.id < b.id ? a.id * 4096 + b.id : b.id * 4096 + a.id);

export interface WorldSettings {
  /** m/s², read every step. */
  gravity(): number;
  /** N per m/s, read every step. */
  air(): number;
}

export class World {
  readonly bodies: Body[] = [];
  readonly joints: Joint[] = [];
  readonly tanks: Tank[] = [];
  readonly fields: Array<(body: Body) => void> = [];
  private contacts = new Map<number, Contact>();
  /** Pairs a joint connects, which do not collide. */
  private connected = new Set<number>();
  private touching = new Map<Body, Set<Body>>();
  /** Contacts made this step, which become hit events once their speed is known. */
  private pendingHits: Contact[] = [];
  readonly hits: HitEvent[] = [];
  readonly touches: Array<{ sensor: Body; body: Body }> = [];
  time = 0;
  /** Seconds simulated since the last frame was drawn. */
  frameTime = 0;
  /** Whether the world has stepped since it last (re)started. */
  started = false;
  stepsSinceDraw = 0;
  grip: { body: Body; local: V2; target: V2; steps: number } | null = null;
  private nextId = 1;

  constructor(readonly settings: WorldSettings) {}

  newBodyId(): number {
    return this.nextId++;
  }

  addBody(body: Body): void {
    this.bodies.push(body);
  }

  addJoint(joint: Joint): void {
    this.joints.push(joint);
    if (joint.a && joint.b) this.connected.add(pairKey(joint.a, joint.b));
  }

  /** Back to the initial state, reading every live value again. */
  restart(): void {
    for (const body of this.bodies) body.setup();
    for (const joint of this.joints) joint.setup();
    for (const tank of this.tanks) tank.setup();
    this.contacts.clear();
    this.touching.clear();
    this.hits.length = 0;
    this.touches.length = 0;
    this.time = 0;
    this.frameTime = 0;
    this.started = false;
    this.grip = null;
    this.showStartForces();
  }

  /** Before the first step: the forces acting at the start, so arrows and readouts show them before play. */
  showStartForces(): void {
    this.computeForces();
    for (const body of this.bodies) body.shown.set(body.stepForce);
    for (const joint of this.joints) joint.tension = joint.stepTension;
  }

  /** Bodies that take part in collisions and forces now. */
  private *live(): Iterable<Body> {
    for (const body of this.bodies) if (body.active) yield body;
  }

  // -------------------------------------------------------------------------
  // Forces
  // -------------------------------------------------------------------------

  /** Every force that is not a constraint: gravity, drag, pushes, fields, charges, magnets, liquids, soft springs. */
  computeForces(): void {
    const g = this.settings.gravity();
    const air = this.settings.air();
    for (const body of this.bodies) {
      body.fx = body.fy = body.torque = 0;
      body.stepForce.fill(0);
    }
    for (const joint of this.joints) joint.stepTension = 0;
    const live = [...this.live()];
    for (const body of live) {
      if (body.fixed) continue;
      body.apply('gravity', 0, -body.m * g);
      if (air > 0) {
        body.apply('drag', -air * body.vx, -air * body.vy);
        body.torque -= (air * body.w * body.I) / body.m;
      }
      if (body.push[0] !== 0 || body.push[1] !== 0) body.apply('applied', body.push[0], body.push[1]);
      for (const field of this.fields) field(body);
    }
    if (this.grip && this.grip.body.active && !this.grip.body.fixed) this.applyGrip(this.grip);
    this.electric(live);
    this.magnetic(live);
    this.liquids(live, g);
    for (const joint of this.joints) if (joint.kind === 'spring' && joint.live) this.springForce(joint);
  }

  private applyGrip(grip: { body: Body; local: V2; target: V2 }): void {
    const { body } = grip;
    const omega = 2 * Math.PI * GRIP_HZ;
    const k = body.m * omega * omega;
    const c = 2 * body.m * GRIP_DAMPING * omega;
    const [px, py] = toWorld(body, grip.local[0], grip.local[1]);
    const [vx, vy] = body.velocityAt(px, py);
    let fx = k * (grip.target[0] - px) - c * vx;
    let fy = k * (grip.target[1] - py) - c * vy;
    // A grip, not a cannon: at most fifty times the body's weight.
    const max = 50 * body.m * Math.max(9.8, Math.abs(this.settings.gravity()));
    const size = Math.hypot(fx, fy);
    if (size > max) {
      fx *= max / size;
      fy *= max / size;
    }
    body.apply('applied', fx, fy, px, py);
    // Damp spin so a grabbed body does not keep whirling about the hand.
    body.torque -= 0.5 * c * body.w * (body.I / body.m);
  }

  private electric(live: readonly Body[]): void {
    const charged = live.filter((b) => b.charge !== 0);
    for (let i = 0; i < charged.length; i++) {
      for (let j = i + 1; j < charged.length; j++) {
        const a = charged[i]!;
        const b = charged[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minimum = 0.5 * (a.extent + b.extent);
        const r2 = Math.max(dx * dx + dy * dy, minimum * minimum);
        const r = Math.sqrt(r2);
        // Positive pushes them apart.
        const f = (COULOMB * a.charge * b.charge) / r2;
        const ux = dx / (r || 1);
        const uy = dy / (r || 1);
        b.apply('electric', f * ux, f * uy);
        a.apply('electric', -f * ux, -f * uy);
      }
    }
  }

  /** Magnets as two poles each (Gilbert's model): like poles repel, and the forces also turn them. */
  private magnetic(live: readonly Body[]): void {
    const magnets = live.filter((b) => b.magnet !== 0);
    const poles = (b: Body): Array<{ x: number; y: number; q: number }> => {
      const [nx, ny] = toWorld(b, b.poles, 0);
      const [sx, sy] = toWorld(b, -b.poles, 0);
      return [
        { x: nx, y: ny, q: b.magnet },
        { x: sx, y: sy, q: -b.magnet },
      ];
    };
    for (let i = 0; i < magnets.length; i++) {
      for (let j = i + 1; j < magnets.length; j++) {
        const a = magnets[i]!;
        const b = magnets[j]!;
        for (const pa of poles(a)) {
          for (const pb of poles(b)) {
            const dx = pb.x - pa.x;
            const dy = pb.y - pa.y;
            const r2 = dx * dx + dy * dy + 0.05 * 0.05;
            const r = Math.sqrt(r2);
            const f = (pa.q * pb.q) / r2;
            const fx = (f * dx) / r;
            const fy = (f * dy) / r;
            b.apply('magnetic', fx, fy, pb.x, pb.y);
            a.apply('magnetic', -fx, -fy, pa.x, pa.y);
          }
        }
      }
    }
  }

  /** Finds each liquid's level with what is in it now: a few rounds, as the level and the displacement depend on each other. */
  updateLevels(): void {
    for (const tank of this.tanks) {
      const width = tank.x1 - tank.x0;
      let displaced = 0;
      // Each round shrinks the error by about the share of the surface the bodies cover.
      for (let round = 0; round < 24; round++) {
        displaced = 0;
        for (const body of this.live()) {
          if (body.sensor || body.spec.kind === 'wall') continue;
          displaced += tank.submerged(body).area;
        }
        const level = tank.depth + displaced / width;
        const settled = Math.abs(level - tank.level) < 1e-7;
        tank.level = level;
        if (settled) break;
      }
      tank.displaced = displaced;
    }
  }

  private liquids(live: readonly Body[], g: number): void {
    if (this.tanks.length === 0) return;
    this.updateLevels();
    for (const tank of this.tanks) {
      for (const body of live) {
        if (body.fixed || body.sensor) continue;
        const part = tank.submerged(body);
        if (part.area <= 0) continue;
        // Archimedes: the weight of the liquid pushed aside, acting at its centre.
        body.apply('buoyancy', 0, tank.density * g * part.area, part.x, part.y);
        const [vx, vy] = body.velocityAt(part.x, part.y);
        const k = LIQUID_DRAG * tank.density * part.area;
        body.apply('drag', -k * vx, -k * vy, part.x, part.y);
        body.torque -= 0.5 * LIQUID_DRAG * (part.area / body.area) * body.I * body.w;
      }
    }
  }

  private springForce(joint: Joint): void {
    const { a, b } = joint;
    const pA = joint.anchorA();
    const pB = joint.anchorB();
    const dx = pB[0] - pA[0];
    const dy = pB[1] - pA[1];
    const length = Math.hypot(dx, dy);
    const ux = length > 1e-9 ? dx / length : 0;
    const uy = length > 1e-9 ? dy / length : 0;
    const rAx = a ? pA[0] - a.x : 0;
    const rAy = a ? pA[1] - a.y : 0;
    const rBx = b ? pB[0] - b.x : 0;
    const rBy = b ? pB[1] - b.y : 0;
    const crA = cross(rAx, rAy, ux, uy);
    const crB = cross(rBx, rBy, ux, uy);
    const invMass = (a?.invM ?? 0) + (a?.invI ?? 0) * crA * crA + (b?.invM ?? 0) + (b?.invI ?? 0) * crB * crB;
    // Soft springs keep their exact period as forces; stiff ones would blow up that way and become soft constraints.
    joint.explicit = Math.sqrt(joint.stiffness * invMass) * STEP < 0.5 && joint.damping * invMass * STEP < 0.5;
    if (!joint.explicit) return;
    joint.impulse = 0;
    const [vAx, vAy] = a ? a.velocityAt(pA[0], pA[1]) : [0, 0];
    const [vBx, vBy] = b ? b.velocityAt(pB[0], pB[1]) : [0, 0];
    const stretch = length - joint.length;
    const rate = (vBx - vAx) * ux + (vBy - vAy) * uy;
    const pull = joint.stiffness * stretch + joint.damping * rate;
    joint.stepTension = pull;
    b?.apply('spring', -pull * ux, -pull * uy, pB[0], pB[1]);
    a?.apply('spring', pull * ux, pull * uy, pA[0], pA[1]);
  }

  // -------------------------------------------------------------------------
  // The step
  // -------------------------------------------------------------------------

  step(h: number): void {
    this.started = true;
    this.computeForces();
    for (const body of this.bodies) {
      if (body.fixed || !body.active) continue;
      body.vx += h * body.fx * body.invM;
      body.vy += h * body.fy * body.invM;
      body.w += h * body.torque * body.invI;
    }
    if (this.grip) this.grip.steps++;
    this.updateContacts();
    for (const contact of this.contacts.values()) this.initContact(contact, h);
    for (const contact of this.contacts.values()) this.warmStart(contact);
    const joints = this.joints.filter((j) => j.live && !(j.kind === 'spring' && j.explicit));
    for (const joint of joints) this.initJoint(joint, h);
    for (let i = 0; i < VELOCITY_ITERATIONS; i++) {
      for (const joint of joints) this.solveJoint(joint, h);
      for (const contact of this.contacts.values()) this.solveContact(contact);
    }
    this.recordImpulses(joints, h);
    for (const body of this.bodies) {
      if (body.fixed || !body.active) continue;
      let tx = h * body.vx;
      let ty = h * body.vy;
      const travel = Math.hypot(tx, ty);
      if (travel > MAX_TRANSLATION) {
        body.vx *= MAX_TRANSLATION / travel;
        body.vy *= MAX_TRANSLATION / travel;
        tx = h * body.vx;
        ty = h * body.vy;
      }
      let turn = h * body.w;
      if (Math.abs(turn) > MAX_ROTATION) {
        body.w *= MAX_ROTATION / Math.abs(turn);
        turn = h * body.w;
      }
      body.x += tx;
      body.y += ty;
      body.setAngle(body.a + turn);
    }
    for (let i = 0; i < POSITION_ITERATIONS; i++) {
      let ok = true;
      for (const contact of this.contacts.values()) ok = this.correctContact(contact) && ok;
      for (const joint of joints) ok = this.correctJoint(joint) && ok;
      if (ok) break;
    }
    for (const body of this.bodies) if (body.active) body.bounds();
    this.sensors();
    this.time += h;
    this.frameTime += h;
    this.stepsSinceDraw++;
    for (const body of this.bodies) {
      for (let k = 0; k < 2 * KINDS; k++) body.frameImpulse[k] = body.frameImpulse[k]! + body.stepForce[k]! * h;
    }
    for (const joint of this.joints) joint.frameImpulse += joint.stepTension * h;
  }

  /** Whether every body is still finite: a blown-up simulation restarts instead of drawing NaN. */
  finite(): boolean {
    return this.bodies.every((b) => Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.a) && Number.isFinite(b.vx) && Number.isFinite(b.vy) && Number.isFinite(b.w));
  }

  /** Averages the forces over the steps since the last frame, for drawing and readouts. */
  settleFrame(): void {
    if (this.frameTime <= 0) return;
    for (const body of this.bodies) {
      for (let k = 0; k < 2 * KINDS; k++) body.shown[k] = body.frameImpulse[k]! / this.frameTime;
      body.frameImpulse.fill(0);
    }
    for (const joint of this.joints) {
      joint.tension = joint.frameImpulse / this.frameTime;
      joint.frameImpulse = 0;
    }
    this.frameTime = 0;
  }

  // -------------------------------------------------------------------------
  // Contacts
  // -------------------------------------------------------------------------

  private updateContacts(): void {
    const previous = this.contacts;
    const next = new Map<number, Contact>();
    const bodies = this.bodies.filter((b) => b.active && !b.sensor);
    for (const body of bodies) body.bounds();
    for (let i = 0; i < bodies.length; i++) {
      const p = bodies[i]!;
      for (let j = i + 1; j < bodies.length; j++) {
        const q = bodies[j]!;
        if (p.fixed && q.fixed) continue;
        if (p.maxX + LINEAR_SLOP < q.minX || q.maxX + LINEAR_SLOP < p.minX || p.maxY + LINEAR_SLOP < q.minY || q.maxY + LINEAR_SLOP < p.minY) continue;
        const key = pairKey(p, q);
        if (this.connected.has(key)) continue;
        const hit = collide(p.shape, p, q.shape, q);
        if (!hit) continue;
        const [a, b] = hit.swapped ? [q, p] : [p, q];
        const old = previous.get(key);
        if (old && old.a === a) {
          // Warm start: the same touching features keep last step's impulses.
          for (const point of hit.manifold.points) {
            const match = old.manifold.points.find((o: ManifoldPoint) => o.id === point.id);
            if (match) {
              point.normalImpulse = match.normalImpulse;
              point.tangentImpulse = match.tangentImpulse;
            }
          }
        }
        const contact = new Contact(a, b, hit.manifold);
        next.set(key, contact);
        if (!old) this.pendingHits.push(contact);
      }
    }
    this.contacts = next;
  }

  private initContact(contact: Contact, h: number): void {
    const { a, b, manifold } = contact;
    const world = worldManifold(manifold, a, radiusOf(a.shape), b, radiusOf(b.shape));
    const [nx, ny] = world.normal;
    contact.nx = nx;
    contact.ny = ny;
    contact.friction = mixFriction(a, b);
    contact.restitution = Math.max(a.bounce, b.bounce);
    const tx = ny;
    const ty = -nx;
    contact.solver = [];
    let approach = 0;
    world.points.forEach(([px, py], i) => {
      const rAx = px - a.x;
      const rAy = py - a.y;
      const rBx = px - b.x;
      const rBy = py - b.y;
      const rnA = cross(rAx, rAy, nx, ny);
      const rnB = cross(rBx, rBy, nx, ny);
      const kNormal = a.invM + b.invM + a.invI * rnA * rnA + b.invI * rnB * rnB;
      const rtA = cross(rAx, rAy, tx, ty);
      const rtB = cross(rBx, rBy, tx, ty);
      const kTangent = a.invM + b.invM + a.invI * rtA * rtA + b.invI * rtB * rtB;
      const dvx = b.vx - b.w * rBy - a.vx + a.w * rAy;
      const dvy = b.vy + b.w * rBx - a.vy - a.w * rAx;
      const vRel = dvx * nx + dvy * ny;
      approach = Math.max(approach, -vRel);
      contact.solver.push({
        rAx,
        rAy,
        rBx,
        rBy,
        normalMass: kNormal > 0 ? 1 / kNormal : 0,
        tangentMass: kTangent > 0 ? 1 / kTangent : 0,
        velocityBias: this.bias(vRel, world.separations[i]!, contact.restitution, h),
      });
    });
    contact.approach = approach;
  }

  /**
   * The normal speed a contact point aims for: a fast approach bounces back
   * by the restitution; a slow one still a little apart may close the gap
   * this step but no further, so bodies settle touching rather than hovering
   * inside the contact margin.
   */
  private bias(vRel: number, separation: number, restitution: number, h: number): number {
    if (vRel < -RESTITUTION_THRESHOLD) return -restitution * vRel;
    return separation > 0 ? -separation / h : 0;
  }

  /** Starts from the impulses the same points carried last step, so stacks settle in few iterations. */
  private warmStart(contact: Contact): void {
    const { a, b, nx, ny } = contact;
    contact.solver.forEach((cp, i) => {
      const point = contact.manifold.points[i]!;
      const Px = point.normalImpulse * nx + point.tangentImpulse * ny;
      const Py = point.normalImpulse * ny - point.tangentImpulse * nx;
      this.impulse(a, b, cp.rAx, cp.rAy, cp.rBx, cp.rBy, Px, Py);
    });
  }

  private impulse(a: Body, b: Body, rAx: number, rAy: number, rBx: number, rBy: number, Px: number, Py: number): void {
    a.vx -= a.invM * Px;
    a.vy -= a.invM * Py;
    a.w -= a.invI * cross(rAx, rAy, Px, Py);
    b.vx += b.invM * Px;
    b.vy += b.invM * Py;
    b.w += b.invI * cross(rBx, rBy, Px, Py);
  }

  private solveContact(contact: Contact): void {
    const { a, b, manifold, nx, ny } = contact;
    const tx = ny;
    const ty = -nx;
    contact.solver.forEach((cp, i) => {
      const point = manifold.points[i]!;
      const dvx = b.vx - b.w * cp.rBy - a.vx + a.w * cp.rAy;
      const dvy = b.vy + b.w * cp.rBx - a.vy - a.w * cp.rAx;
      const vt = dvx * tx + dvy * ty;
      const maxFriction = contact.friction * point.normalImpulse;
      const old = point.tangentImpulse;
      point.tangentImpulse = Math.max(-maxFriction, Math.min(maxFriction, old - cp.tangentMass * vt));
      const lambda = point.tangentImpulse - old;
      this.impulse(a, b, cp.rAx, cp.rAy, cp.rBx, cp.rBy, lambda * tx, lambda * ty);
    });
    contact.solver.forEach((cp, i) => {
      const point = manifold.points[i]!;
      const dvx = b.vx - b.w * cp.rBy - a.vx + a.w * cp.rAy;
      const dvy = b.vy + b.w * cp.rBx - a.vy - a.w * cp.rAx;
      const vn = dvx * nx + dvy * ny;
      const old = point.normalImpulse;
      point.normalImpulse = Math.max(old - cp.normalMass * (vn - cp.velocityBias), 0);
      const lambda = point.normalImpulse - old;
      this.impulse(a, b, cp.rAx, cp.rAy, cp.rBx, cp.rBy, lambda * nx, lambda * ny);
    });
  }

  /** Pushes overlapping bodies apart without changing their velocities. */
  private correctContact(contact: Contact): boolean {
    const { a, b, manifold } = contact;
    let minSeparation = 0;
    for (let i = 0; i < manifold.points.length; i++) {
      const { normal, point, separation } = positionManifold(manifold, a, radiusOf(a.shape), b, radiusOf(b.shape), i);
      const rAx = point[0] - a.x;
      const rAy = point[1] - a.y;
      const rBx = point[0] - b.x;
      const rBy = point[1] - b.y;
      minSeparation = Math.min(minSeparation, separation);
      const C = Math.max(-MAX_CORRECTION, Math.min(0, BAUMGARTE * (separation + LINEAR_SLOP)));
      const rnA = cross(rAx, rAy, normal[0], normal[1]);
      const rnB = cross(rBx, rBy, normal[0], normal[1]);
      const K = a.invM + b.invM + a.invI * rnA * rnA + b.invI * rnB * rnB;
      const impulse = K > 0 ? -C / K : 0;
      const Px = impulse * normal[0];
      const Py = impulse * normal[1];
      a.x -= a.invM * Px;
      a.y -= a.invM * Py;
      if (a.invI) a.setAngle(a.a - a.invI * cross(rAx, rAy, Px, Py));
      b.x += b.invM * Px;
      b.y += b.invM * Py;
      if (b.invI) b.setAngle(b.a + b.invI * cross(rBx, rBy, Px, Py));
    }
    return minSeparation >= -3 * LINEAR_SLOP;
  }

  /** New contacts become hit events; contact and joint impulses become the forces they were. */
  private recordImpulses(joints: readonly Joint[], h: number): void {
    for (const contact of this.contacts.values()) {
      const { a, b, nx, ny } = contact;
      const tx = ny;
      const ty = -nx;
      let normal = 0;
      let tangent = 0;
      for (const point of contact.manifold.points) {
        normal += point.normalImpulse;
        tangent += point.tangentImpulse;
      }
      b.record('normal', (normal * nx) / h, (normal * ny) / h);
      a.record('normal', (-normal * nx) / h, (-normal * ny) / h);
      b.record('friction', (tangent * tx) / h, (tangent * ty) / h);
      a.record('friction', (-tangent * tx) / h, (-tangent * ty) / h);
    }
    for (const contact of this.pendingHits) {
      if (contact.approach >= HIT_SPEED && this.contacts.get(pairKey(contact.a, contact.b)) === contact) {
        this.hits.push({ a: contact.a, b: contact.b, speed: contact.approach });
      }
    }
    this.pendingHits = [];
    for (const joint of joints) {
      const { a, b } = joint;
      let fx = 0;
      let fy = 0;
      let kind: ForceKind = 'tension';
      switch (joint.kind) {
        case 'rod':
        case 'rope':
        case 'spring':
          fx = (joint.impulse * joint.ux) / h;
          fy = (joint.impulse * joint.uy) / h;
          joint.stepTension = -joint.impulse / h;
          if (joint.kind === 'spring') kind = 'spring';
          break;
        case 'hinge':
          fx = joint.impulseX / h;
          fy = joint.impulseY / h;
          joint.stepTension = Math.hypot(fx, fy);
          break;
        case 'pulley': {
          joint.stepTension = -joint.impulse / h;
          // The rope pulls each body toward its side of the wheel.
          a?.record('tension', (joint.impulse * joint.ux) / h, (joint.impulse * joint.uy) / h);
          b?.record('tension', (joint.impulse * joint.ubx) / h, (joint.impulse * joint.uby) / h);
          continue;
        }
      }
      b?.record(kind, fx, fy);
      a?.record(kind, -fx, -fy);
    }
  }

  // -------------------------------------------------------------------------
  // Joints
  // -------------------------------------------------------------------------

  private initJoint(joint: Joint, h: number): void {
    const { a, b } = joint;
    const pA = joint.anchorA();
    const pB = joint.anchorB();
    joint.rAx = a ? pA[0] - a.x : 0;
    joint.rAy = a ? pA[1] - a.y : 0;
    joint.rBx = b ? pB[0] - b.x : 0;
    joint.rBy = b ? pB[1] - b.y : 0;
    const mA = a?.invM ?? 0;
    const iA = a?.invI ?? 0;
    const mB = b?.invM ?? 0;
    const iB = b?.invI ?? 0;
    switch (joint.kind) {
      case 'rod':
      case 'rope':
      case 'spring': {
        const dx = pB[0] - pA[0];
        const dy = pB[1] - pA[1];
        const length = Math.hypot(dx, dy);
        joint.current = length;
        joint.ux = length > 1e-9 ? dx / length : 0;
        joint.uy = length > 1e-9 ? dy / length : 0;
        const crA = cross(joint.rAx, joint.rAy, joint.ux, joint.uy);
        const crB = cross(joint.rBx, joint.rBy, joint.ux, joint.uy);
        let invMass = mA + iA * crA * crA + mB + iB * crB * crB;
        if (joint.kind === 'spring') {
          // A soft constraint: the spring and damper integrated implicitly, stable at any stiffness.
          const C = length - joint.length;
          const k = joint.stiffness;
          const gamma = h * (joint.damping + h * k);
          joint.gamma = gamma > 0 ? 1 / gamma : 0;
          joint.bias = C * h * k * joint.gamma;
          invMass += joint.gamma;
        }
        joint.mass = invMass > 0 ? 1 / invMass : 0;
        if (joint.kind === 'rope' && length < joint.length - LINEAR_SLOP) joint.impulse = 0;
        const Px = joint.impulse * joint.ux;
        const Py = joint.impulse * joint.uy;
        this.jointImpulse(joint, Px, Py);
        break;
      }
      case 'hinge': {
        const { rAx, rAy, rBx, rBy } = joint;
        joint.k11 = mA + mB + iA * rAy * rAy + iB * rBy * rBy;
        joint.k12 = -iA * rAx * rAy - iB * rBx * rBy;
        joint.k22 = mA + mB + iA * rAx * rAx + iB * rBx * rBx;
        joint.motorMass = iA + iB > 0 ? 1 / (iA + iB) : 0;
        if (joint.motor === null) joint.motorImpulse = 0;
        this.jointImpulse(joint, joint.impulseX, joint.impulseY);
        if (a) a.w -= iA * joint.motorImpulse;
        if (b) b.w += iB * joint.motorImpulse;
        break;
      }
      case 'pulley': {
        let uAx = pA[0] - joint.gA[0];
        let uAy = pA[1] - joint.gA[1];
        let uBx = pB[0] - joint.gB[0];
        let uBy = pB[1] - joint.gB[1];
        const lengthA = Math.hypot(uAx, uAy);
        const lengthB = Math.hypot(uBx, uBy);
        uAx = lengthA > 1e-9 ? uAx / lengthA : 0;
        uAy = lengthA > 1e-9 ? uAy / lengthA : 0;
        uBx = lengthB > 1e-9 ? uBx / lengthB : 0;
        uBy = lengthB > 1e-9 ? uBy / lengthB : 0;
        joint.ux = uAx;
        joint.uy = uAy;
        joint.ubx = uBx;
        joint.uby = uBy;
        joint.current = lengthA + lengthB;
        const ruA = cross(joint.rAx, joint.rAy, uAx, uAy);
        const ruB = cross(joint.rBx, joint.rBy, uBx, uBy);
        const invMass = mA + iA * ruA * ruA + mB + iB * ruB * ruB;
        joint.mass = invMass > 0 ? 1 / invMass : 0;
        if (joint.current < joint.length - LINEAR_SLOP) joint.impulse = 0;
        this.pulleyImpulse(joint, joint.impulse);
        break;
      }
    }
  }

  /** Applies an impulse along a joint: minus to A, plus to B, at their anchors. */
  private jointImpulse(joint: Joint, Px: number, Py: number): void {
    const { a, b } = joint;
    if (a) {
      a.vx -= a.invM * Px;
      a.vy -= a.invM * Py;
      a.w -= a.invI * cross(joint.rAx, joint.rAy, Px, Py);
    }
    if (b) {
      b.vx += b.invM * Px;
      b.vy += b.invM * Py;
      b.w += b.invI * cross(joint.rBx, joint.rBy, Px, Py);
    }
  }

  private pulleyImpulse(joint: Joint, lambda: number): void {
    const { a, b } = joint;
    if (a) {
      a.vx += a.invM * joint.ux * lambda;
      a.vy += a.invM * joint.uy * lambda;
      a.w += a.invI * cross(joint.rAx, joint.rAy, joint.ux, joint.uy) * lambda;
    }
    if (b) {
      b.vx += b.invM * joint.ubx * lambda;
      b.vy += b.invM * joint.uby * lambda;
      b.w += b.invI * cross(joint.rBx, joint.rBy, joint.ubx, joint.uby) * lambda;
    }
  }

  private anchorVelocities(joint: Joint): [number, number, number, number] {
    const { a, b } = joint;
    const vAx = a ? a.vx - a.w * joint.rAy : 0;
    const vAy = a ? a.vy + a.w * joint.rAx : 0;
    const vBx = b ? b.vx - b.w * joint.rBy : 0;
    const vBy = b ? b.vy + b.w * joint.rBx : 0;
    return [vAx, vAy, vBx, vBy];
  }

  private solveJoint(joint: Joint, h: number): void {
    switch (joint.kind) {
      case 'rod':
      case 'rope':
      case 'spring': {
        const [vAx, vAy, vBx, vBy] = this.anchorVelocities(joint);
        let Cdot = (vBx - vAx) * joint.ux + (vBy - vAy) * joint.uy;
        let lambda: number;
        if (joint.kind === 'spring') {
          lambda = -joint.mass * (Cdot + joint.bias + joint.gamma * joint.impulse);
          joint.impulse += lambda;
        } else if (joint.kind === 'rope') {
          // Slack rope: the ends may close the gap this step, but no more.
          const C = joint.current - joint.length;
          if (C < 0) Cdot += C / h;
          const old = joint.impulse;
          joint.impulse = Math.min(0, old - joint.mass * Cdot);
          lambda = joint.impulse - old;
        } else {
          lambda = -joint.mass * Cdot;
          joint.impulse += lambda;
        }
        this.jointImpulse(joint, lambda * joint.ux, lambda * joint.uy);
        break;
      }
      case 'hinge': {
        const { a, b } = joint;
        if (joint.motor !== null && joint.motorMass > 0) {
          const Cdot = (b?.w ?? 0) - (a?.w ?? 0) - joint.motor;
          const old = joint.motorImpulse;
          const max = joint.maxTorque * h;
          joint.motorImpulse = Math.max(-max, Math.min(max, old - joint.motorMass * Cdot));
          const lambda = joint.motorImpulse - old;
          if (a) a.w -= a.invI * lambda;
          if (b) b.w += b.invI * lambda;
        }
        const [vAx, vAy, vBx, vBy] = this.anchorVelocities(joint);
        const cx = vBx - vAx;
        const cy = vBy - vAy;
        const det = joint.k11 * joint.k22 - joint.k12 * joint.k12;
        if (Math.abs(det) < 1e-12) break;
        // λ = -K⁻¹ Cdot
        const lx = -(joint.k22 * cx - joint.k12 * cy) / det;
        const ly = -(joint.k11 * cy - joint.k12 * cx) / det;
        joint.impulseX += lx;
        joint.impulseY += ly;
        this.jointImpulse(joint, lx, ly);
        break;
      }
      case 'pulley': {
        const [vAx, vAy, vBx, vBy] = this.anchorVelocities(joint);
        let Cdot = joint.ux * vAx + joint.uy * vAy + joint.ubx * vBx + joint.uby * vBy;
        const C = joint.current - joint.length;
        if (C < 0) Cdot += C / h;
        const old = joint.impulse;
        joint.impulse = Math.min(0, old - joint.mass * Cdot);
        this.pulleyImpulse(joint, joint.impulse - old);
        break;
      }
    }
  }

  private moveBy(body: Body | null, dx: number, dy: number, da: number): void {
    if (!body || body.fixed) return;
    body.x += dx;
    body.y += dy;
    if (da !== 0) body.setAngle(body.a + da);
  }

  /** Pulls a stretched joint back to its length by moving the bodies (no velocity change). */
  private correctJoint(joint: Joint): boolean {
    const { a, b } = joint;
    const mA = a?.invM ?? 0;
    const iA = a?.invI ?? 0;
    const mB = b?.invM ?? 0;
    const iB = b?.invI ?? 0;
    const pA = joint.anchorA();
    const pB = joint.anchorB();
    const rAx = a ? pA[0] - a.x : 0;
    const rAy = a ? pA[1] - a.y : 0;
    const rBx = b ? pB[0] - b.x : 0;
    const rBy = b ? pB[1] - b.y : 0;
    switch (joint.kind) {
      case 'spring':
        return true;
      case 'rod':
      case 'rope': {
        const dx = pB[0] - pA[0];
        const dy = pB[1] - pA[1];
        const length = Math.hypot(dx, dy);
        if (length < 1e-9) return true;
        const ux = dx / length;
        const uy = dy / length;
        let C = length - joint.length;
        if (joint.kind === 'rope') {
          if (C <= LINEAR_SLOP) return true;
          C = Math.min(C - LINEAR_SLOP, MAX_CORRECTION);
        } else {
          C = Math.max(-MAX_CORRECTION, Math.min(MAX_CORRECTION, C));
        }
        const crA = cross(rAx, rAy, ux, uy);
        const crB = cross(rBx, rBy, ux, uy);
        const K = mA + iA * crA * crA + mB + iB * crB * crB;
        if (K <= 0) return true;
        const impulse = -C / K;
        const Px = impulse * ux;
        const Py = impulse * uy;
        this.moveBy(a, -mA * Px, -mA * Py, -iA * cross(rAx, rAy, Px, Py));
        this.moveBy(b, mB * Px, mB * Py, iB * cross(rBx, rBy, Px, Py));
        return Math.abs(length - joint.length) < LINEAR_SLOP || (joint.kind === 'rope' && length < joint.length);
      }
      case 'hinge': {
        const cx = pB[0] - pA[0];
        const cy = pB[1] - pA[1];
        const k11 = mA + mB + iA * rAy * rAy + iB * rBy * rBy;
        const k12 = -iA * rAx * rAy - iB * rBx * rBy;
        const k22 = mA + mB + iA * rAx * rAx + iB * rBx * rBx;
        const det = k11 * k22 - k12 * k12;
        if (Math.abs(det) < 1e-12) return true;
        const Px = -(k22 * cx - k12 * cy) / det;
        const Py = -(k11 * cy - k12 * cx) / det;
        this.moveBy(a, -mA * Px, -mA * Py, -iA * cross(rAx, rAy, Px, Py));
        this.moveBy(b, mB * Px, mB * Py, iB * cross(rBx, rBy, Px, Py));
        return Math.hypot(cx, cy) < LINEAR_SLOP;
      }
      case 'pulley': {
        let uAx = pA[0] - joint.gA[0];
        let uAy = pA[1] - joint.gA[1];
        let uBx = pB[0] - joint.gB[0];
        let uBy = pB[1] - joint.gB[1];
        const lengthA = Math.hypot(uAx, uAy);
        const lengthB = Math.hypot(uBx, uBy);
        const C = lengthA + lengthB - joint.length;
        if (C <= LINEAR_SLOP) return true;
        uAx = lengthA > 1e-9 ? uAx / lengthA : 0;
        uAy = lengthA > 1e-9 ? uAy / lengthA : 0;
        uBx = lengthB > 1e-9 ? uBx / lengthB : 0;
        uBy = lengthB > 1e-9 ? uBy / lengthB : 0;
        const ruA = cross(rAx, rAy, uAx, uAy);
        const ruB = cross(rBx, rBy, uBx, uBy);
        const K = mA + iA * ruA * ruA + mB + iB * ruB * ruB;
        if (K <= 0) return true;
        const impulse = -Math.min(C - LINEAR_SLOP, MAX_CORRECTION) / K;
        this.moveBy(a, mA * uAx * impulse, mA * uAy * impulse, iA * ruA * impulse);
        this.moveBy(b, mB * uBx * impulse, mB * uBy * impulse, iB * ruB * impulse);
        return false;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Sensors, energy
  // -------------------------------------------------------------------------

  private sensors(): void {
    for (const sensor of this.bodies) {
      if (!sensor.sensor || !sensor.active) continue;
      const inside = this.touching.get(sensor) ?? new Set<Body>();
      const now = new Set<Body>();
      for (const body of this.bodies) {
        if (body === sensor || body.sensor || !body.active || body.fixed) continue;
        if (body.maxX < sensor.minX || sensor.maxX < body.minX || body.maxY < sensor.minY || sensor.maxY < body.minY) continue;
        if (overlaps(sensor.shape, sensor, body.shape, body)) {
          now.add(body);
          if (!inside.has(body)) this.touches.push({ sensor, body });
        }
      }
      this.touching.set(sensor, now);
    }
  }

  energy(): { kinetic: number; potential: number; elastic: number; total: number } {
    const g = this.settings.gravity();
    let kinetic = 0;
    let potential = 0;
    let elastic = 0;
    for (const body of this.bodies) {
      if (body.fixed || !body.active) continue;
      kinetic += 0.5 * body.m * (body.vx * body.vx + body.vy * body.vy) + 0.5 * body.I * body.w * body.w;
      potential += body.m * g * body.y;
    }
    for (const joint of this.joints) {
      if (joint.kind !== 'spring' || !joint.live) continue;
      const stretch = joint.measure() - joint.length;
      elastic += 0.5 * joint.stiffness * stretch * stretch;
    }
    return { kinetic, potential, elastic, total: kinetic + potential + elastic };
  }

  /** The local point on a body under a world point. */
  localPoint(body: Body, x: number, y: number): V2 {
    return toLocal(body, x, y);
  }
}
