/**
 * The physics driver of a figure in space (docs/features/physics/design.md 7 and 10; .kiro/specs/physics R5).
 *
 * A figure with any `Body3` is a world in space: this driver reads its bodies, its solid space shapes (`with solid =
 * true` on polyhedra, spheres, cylinders, cones and planes), `Ground()` as the floor `z = h`, a solid `z = f(x, y)` as
 * terrain over the clip box, and `world`. It steps the world on the same fixed grid as the plane driver, from the
 * nearest checkpoint, and writes each body's pose and its solid where it is now. Pushes, grabs and releases are logged
 * as `@input physics …` lines with three numbers, so a replay, a seek and a reload give the same film.
 */
import type { Notice } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import { makeNotice } from '../../errors/notices';
import type { ObjRec } from '../../graph/core';
import type { WorldDriver } from '../../graph/drivers';
import type { DriverAccess, Figure } from '../../graph/figure';
import type { Cell, StyleEntry } from '../../graph/types';
import { sameValue } from '../../graph/values';
import type { BodyDef3, ShapeDef3 } from '../../physics/world3';
import { BodyType3, FK3, World3, quatAxis } from '../../physics/world3';
import { Distance3, Hinge3, Slider3, Weld3, Wheel3 } from '../../physics/joints3';
import type { JointValue3 } from './joints';
import { isJoint3Value } from './joints';
import type { LooseWheel, Vehicle3Value, Wheel3Value } from './vehicle';
import { isVehicle3Value, isWheel3Value } from './vehicle';
import { ROUND_SIDES } from './body3';
import { FORCE_KINDS } from '../../physics/world2';
import type { Body3Value, BodySpec3 } from './body3';
import { isBody3Value, solid3Of, solidNow, terrainOf } from './body3';
import { specKey } from './jointbuild';
import type { WorldValue } from './types';
import { DEFAULT_WORLD, isWorldValue } from './types';
import { getStoredHandler } from '../numbers/handlers';
import { cos, sin } from '../../physics/math';
import { runHandler } from '../numbers/run';

const CHECKPOINT_SECONDS = 0.5;
const CHECKPOINT_BYTES = 32 * 1024 * 1024;
const STEP_BUDGET = 60000;
const BLOW_UP = 1e6;
const NK = FORCE_KINDS.length;
/** Cells a side of terrain (design 7: at most 128 over the clip box). */
export const TERRAIN_CELLS = 128;

type V3 = { x: number; y: number; z: number };

export type LogEntry3 =
  | { readonly kind: 'push'; readonly n: number; readonly id: ObjId; readonly item?: number; readonly j: V3; readonly at?: V3 }
  | { readonly kind: 'grab'; readonly n: number; readonly id: ObjId; readonly item?: number; readonly to: V3; readonly a: V3 }
  | { readonly kind: 'release'; readonly n: number; readonly id: ObjId; readonly item?: number }
  | { readonly kind: 'reset'; readonly n: number }
  | { readonly kind: 'set'; readonly n: number; readonly id: ObjId; readonly value: unknown };

type AnyJoint3 = Hinge3 | Distance3 | Weld3 | Slider3;

interface JointMember3 {
  readonly rec: ObjRec;
  readonly item?: number;
  readonly value: JointValue3;
  readonly joint: AnyJoint3;
}

interface WheelMember3 {
  readonly rec: ObjRec;
  readonly item?: number;
  readonly value: Wheel3Value;
  readonly joint: Wheel3;
  readonly chassis: number;
}

interface Member3 {
  readonly rec: ObjRec;
  readonly role: 'body' | 'solid';
  readonly index: number;
  readonly spec?: BodySpec3;
  readonly item?: number;
}

/** True when the figure holds a body in space: then it is a world in space. */
export function isSpaceWorld(list: readonly ObjRec[]): boolean {
  for (const r of list) if (isBody3Rec(r)) return true;
  return false;
}

export function isBody3Rec(r: ObjRec): boolean {
  const t = r.p.type;
  return t.k === 'Body3' || (t.k === 'List' && t.of?.k === 'Body3');
}

export class Physics3Driver implements WorldDriver {
  private readonly acc: DriverAccess;
  private version = -1;
  private bodyRecs: ObjRec[] = [];
  private solidRecs: ObjRec[] = [];
  private worldRec: ObjRec | undefined;
  private spaceRec: ObjRec | undefined;
  private specs = new Map<ObjId, Body3Value>();
  private listSpecs = new Map<ObjId, (Body3Value | undefined)[]>();
  private worldSettings: WorldValue | undefined;
  private written = new Set<ObjId>();
  private lastCells = new Map<ObjId, Cell>();
  private sig: unknown[] | undefined;
  world: World3 | undefined;
  members: Member3[] = [];
  private byId = new Map<ObjId, Member3>();
  private nameOfIndex: string[] = [];
  private rate = 120;
  private t0 = 0;
  n = 0;
  private prevP = new Float64Array(0);
  private prevQ = new Float64Array(0);
  private checkpoints = new Map<number, Float64Array>();
  private cpStride = 60;
  private cpBytes = 0;
  private log: LogEntry3[] = [];
  private grabs = new Map<number, { to: V3; a: V3 }>();
  private cone: ObjRec[] = [];
  private varySet = new Set<ObjRec>();
  private varyingStyle: { member: Member3; entry: StyleEntry }[] = [];
  private varyingWorld = false;
  private coneDirty = true;
  private short = false;
  private catching: { from: number; to: number } | undefined;
  private warnings: Notice[] = [];
  private warned = new Set<string>();
  private failedAt = new Map<number, number>();
  private leftAt = new Map<number, number>();
  private prevStale = false;
  private sampling = false;
  private touchLists: number[][] = [];
  hits: { readonly t: number; readonly a: string; readonly b: string; readonly speed: number; readonly x: number; readonly y: number; readonly z: number; readonly impulse: number }[] = [];
  private pendingHits: Physics3Driver['hits'] = [];
  frontier = 0;
  /* joints, wheels and cars (round 5) */
  private jointRecs: ObjRec[] = [];
  private wheelRecs: ObjRec[] = [];
  private vehicleRecs: ObjRec[] = [];
  private jointSpecs = new Map<ObjId, (JointValue3 | undefined)[]>();
  private wheelSpecs = new Map<ObjId, (Wheel3Value | undefined)[]>();
  private vehicleSpecs = new Map<ObjId, Vehicle3Value>();
  jointMembers: JointMember3[] = [];
  private carWheels = new Map<ObjId, WheelMember3[]>();
  wheelMembers: WheelMember3[] = [];
  /** Logged free values (a car's pedals while the film plays): their value before the first entry. */
  private base = new Map<ObjId, unknown>();
  private logged = new Set<ObjId>();
  private vehicleInputs = new Set<ObjId>();
  private startInputs = new Set<ObjId>();
  private brokeAt = new WeakMap<object, number>();
  /** Joints and wheels that broke, for the teacher's `figure` result. */
  events: { readonly t: number; readonly kind: 'broken'; readonly name: string }[] = [];
  /** Terrain heights, kept while the function, the box and the grid stay the same (a body line does not remeasure it). */
  private terrainCache = new Map<ObjId, { key: unknown[]; shapes: ShapeDef3[] }>();

  constructor(readonly figure: Figure) {
    this.acc = figure.driverAccess();
  }

  /* ------------------------------ the driver hooks ------------------------------ */

  onCompute(rec: ObjRec, computed: Cell): Cell | undefined {
    const k = rec.p.type.k;
    // a wheel, a car or a joint reads its bodies only for their start: a body that left the world or blew up during
    // the film leaves them as they were built, so the world is not rebuilt from the start mid-film
    if (!computed.defined && this.world && this.lastCells.has(rec.id) && (isWheel3Rec(rec) || k === 'Vehicle' || isJointRec(rec)) && rec.inputs.some((r) => this.written.has(r.id) && !r.cell.defined)) return this.lastCells.get(rec.id);
    if (isWheel3Rec(rec)) {
      this.wheelSpecs.set(rec.id, computed.defined ? (Array.isArray(computed.value) ? (computed.value as unknown[]) : [computed.value]).map((v) => (isWheel3Value(v) ? v : undefined)) : []);
      const last = this.lastCells.get(rec.id);
      return last && this.world ? last : undefined;
    }
    if (k === 'Vehicle' && computed.defined && isVehicle3Value(computed.value)) {
      this.vehicleSpecs.set(rec.id, computed.value);
      const last = this.lastCells.get(rec.id);
      return last && this.world ? last : undefined;
    }
    if (isJointRec(rec) && this.bodyRecs.length > 0) {
      this.jointSpecs.set(rec.id, computed.defined ? (Array.isArray(computed.value) ? (computed.value as unknown[]) : [computed.value]).map((v) => (isJoint3Value(v) ? v : undefined)) : []);
      const last = this.lastCells.get(rec.id);
      return last && computed.defined && this.world ? last : undefined;
    }
    if (k === 'List' && rec.p.type.of?.k === 'Body3') {
      if (computed.defined && Array.isArray(computed.value)) this.listSpecs.set(rec.id, (computed.value as unknown[]).map((v) => (isBody3Value(v) ? v : undefined)));
      else this.listSpecs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      if (last && computed.defined && this.world && last.defined && Array.isArray(last.value) && Array.isArray(computed.value) && last.value.length === computed.value.length && (last.value as unknown[]).every((v, i) => sameSpec3(v, (computed.value as unknown[])[i]))) return last;
      return undefined;
    }
    if (k === 'Body3') {
      if (computed.defined && isBody3Value(computed.value)) this.specs.set(rec.id, computed.value);
      else this.specs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      if (last && computed.defined && this.world && last.defined && sameSpec3(last.value, computed.value)) return last;
      return undefined;
    }
    if (k === 'World' && this.bodyRecs.length > 0) {
      if (computed.defined && isWorldValue(computed.value)) this.worldSettings = computed.value;
      const last = this.lastCells.get(rec.id);
      return last && computed.defined ? last : undefined;
    }
    return undefined;
  }

  /**
   * A free value was written. A car's pedals and wheel (what a vehicle reads) go on from now while the film plays, logged
   * so the replay is the same (ui.md 9); other inputs restart the film when the world they build changes.
   */
  noteFree(rec: ObjRec, was: unknown): void {
    if (!this.world) return;
    const t = this.acc.clockT();
    if (t <= this.t0 + 1e-12) return;
    if (this.coneDirty) this.findCone();
    if (!this.vehicleInputs.has(rec.id) || this.startInputs.has(rec.id)) return;
    if (!this.base.has(rec.id)) this.base.set(rec.id, was);
    this.addEntry({ kind: 'set', n: this.gridAt(t), id: rec.id, value: rec.p.value });
    this.logged.add(rec.id);
    this.coneDirty = true;
  }

  inputLine(words: readonly string[]): string | undefined | false {
    if (words[0] !== 'physics') return false;
    this.scan();
    if (this.bodyRecs.length === 0) return false;
    const kind = words[1];
    const at = Number(words[words.length - 1]);
    if (words[words.length - 2] !== 'at' || !Number.isFinite(at)) return 'a time at the end: @input physics push b 1 0 0 at 2.5';
    const n = Math.max(0, Math.round((at - this.acc.t0()) * this.stepRate(this.settings().rate)));
    if (kind === 'reset') {
      this.addEntry({ kind: 'reset', n });
      return undefined;
    }
    const nameWord = words[2] ?? '';
    const listed = /^(.+)\[(\d+)\]$/.exec(nameWord);
    const rec = this.acc.byName(listed ? (listed[1] as string) : nameWord);
    if (!rec) return `an object named ${nameWord}`;
    if (kind === 'set') {
      // a pedal or the steering, written while the film played
      const isBase = words[3] === 'base';
      const nums = words.slice(isBase ? 4 : 3, -2).map(Number);
      if (nums.length === 0 || nums.some((x) => !Number.isFinite(x))) return 'a number: @input physics set gas 1 at 2.5';
      const value = nums.length >= 2 ? { x: nums[0] as number, y: nums[1] as number } : nums[0];
      if (isBase) this.base.set(rec.id, value);
      else {
        if (!this.base.has(rec.id)) this.base.set(rec.id, rec.p.value);
        this.addEntry({ kind: 'set', n, id: rec.id, value });
        this.logged.add(rec.id);
        this.coneDirty = true;
      }
      return undefined;
    }
    if (!isBody3Rec(rec)) return false;
    const item = listed ? Number(listed[2]) - 1 : undefined;
    const it = item !== undefined ? { item } : {};
    const nums = words.slice(3, -2).map(Number);
    if (nums.some((x) => !Number.isFinite(x))) return 'numbers';
    const v = (k: number): V3 => ({ x: nums[k] as number, y: nums[k + 1] as number, z: nums[k + 2] as number });
    if (kind === 'push' && nums.length >= 3) this.addEntry({ kind: 'push', n, id: rec.id, ...it, j: v(0), ...(nums.length >= 6 ? { at: v(3) } : {}) });
    else if (kind === 'grab' && nums.length >= 6) this.addEntry({ kind: 'grab', n, id: rec.id, ...it, to: v(0), a: v(3) });
    else if (kind === 'release') this.addEntry({ kind: 'release', n, id: rec.id, ...it });
    else return 'push, grab, release or reset, with three numbers a vector';
    return undefined;
  }

  needsFrame(): boolean {
    return this.short;
  }

  catchingUp(): { from: number; to: number } | undefined {
    return this.catching;
  }

  takeWarnings(): Notice[] {
    return this.warnings.splice(0, this.warnings.length);
  }

  owns(id: ObjId): boolean {
    if (this.byId.has(id) || (this.bodyRecs.length > 0 && this.worldRec?.id === id)) return true;
    return this.world !== undefined && [...this.jointRecs, ...this.wheelRecs, ...this.vehicleRecs].some((r) => r.id === id);
  }

  sampleRecs(): readonly ObjRec[] {
    return [...new Set(this.members.filter((m) => m.role === 'body').map((m) => m.rec))];
  }

  sample(t: number): readonly (readonly [ObjRec, Cell])[] | undefined {
    if (!this.world) return undefined;
    const keep = this.world.save();
    const keepN = this.n;
    const kp = Float64Array.from(this.prevP);
    const kq = Float64Array.from(this.prevQ);
    this.sampling = true;
    try {
      const { nTarget, alpha } = this.gridFor(t);
      this.advance(nTarget, Infinity);
      this.touchLists = this.world.touchingAll();
      const out: (readonly [ObjRec, Cell])[] = [];
      const lists = new Map<ObjRec, unknown[]>();
      for (const m of this.members) {
        if (m.role !== 'body') continue;
        const c = this.bodyCell(m, alpha);
        if (m.item === undefined) out.push([m.rec, c]);
        else {
          const arr = lists.get(m.rec) ?? (this.specsOfList(m.rec) as unknown[]).slice();
          arr[m.item] = c.defined ? c.value : undefined;
          lists.set(m.rec, arr);
        }
      }
      for (const [r, arr] of lists) out.push([r, { defined: true, value: arr }]);
      return out;
    } finally {
      this.sampling = false;
      this.world.load(keep);
      this.n = keepN;
      this.prevP = kp;
      this.prevQ = kq;
    }
  }

  afterPass(): readonly ObjRec[] {
    this.scan();
    if (this.bodyRecs.length === 0) {
      if (this.world) {
        this.world = undefined;
        this.members = [];
        this.byId = new Map();
        this.sig = undefined;
      }
      return [];
    }
    if (this.coneDirty) this.findCone();
    const sig = this.signature();
    if (!this.sig || !sameValue(this.sig, sig)) {
      this.sig = sig;
      this.build();
    }
    if (!this.world) return [];
    const { nTarget, alpha } = this.gridFor(this.acc.clockT());
    this.hits = [];
    this.advance(nTarget, STEP_BUDGET);
    return this.writeCells(this.short ? 1 : alpha);
  }

  afterFlush(): void {
    if (this.pendingHits.length === 0) return;
    const hits = this.pendingHits.splice(0, this.pendingHits.length);
    let runs = 0;
    for (const h of hits) {
      for (const [self, other] of [[h.a, h.b], [h.b, h.a]] as const) {
        const target = self.replace(/\[\d+\]$/, '');
        if (!getStoredHandler(this.figure, target, 'hit')) continue;
        if (runs >= 24) return;
        runs++;
        runHandler(this.figure, target, 'hit', { by: 'host', extra: { speed: h.speed, other: other.replace(/\[\d+\]$/, ''), point: { x: h.x, y: h.y, z: h.z }, impulse: h.impulse } }, 'host');
      }
    }
  }

  onRestart(): void {
    if (this.world) this.restart();
  }

  /* ------------------------------ reading the figure ------------------------------ */

  private gridFor(t: number): { nTarget: number; alpha: number } {
    const ft = Math.max(0, (t - this.t0) * this.rate);
    const nTarget = Math.max(0, Math.ceil(ft - 1e-9));
    const alpha = nTarget === 0 ? 1 : Math.min(1, Math.max(0, ft - (nTarget - 1)));
    return { nTarget, alpha };
  }

  private gridAt(t: number): number {
    return Math.max(0, Math.ceil((t - this.t0) * this.rate - 1e-9));
  }

  private scan(): void {
    const v = this.acc.version();
    if (v === this.version) return;
    this.version = v;
    this.bodyRecs = [];
    this.solidRecs = [];
    this.jointRecs = [];
    this.wheelRecs = [];
    this.vehicleRecs = [];
    this.worldRec = undefined;
    this.spaceRec = undefined;
    for (const r of this.acc.list) {
      const k = r.p.type.k;
      if (isBody3Rec(r)) this.bodyRecs.push(r);
      else if (isJointRec(r)) this.jointRecs.push(r);
      else if (isWheel3Rec(r)) this.wheelRecs.push(r);
      else if (k === 'Vehicle') this.vehicleRecs.push(r);
      else if (k === 'World') this.worldRec = r;
      else if (k === 'View3') this.spaceRec = r;
      else if (r.p.style.has('solid') || isGround(r)) this.solidRecs.push(r);
    }
    this.coneDirty = true;
  }

  private solidOn(r: ObjRec): boolean {
    const e = r.p.style.get('solid');
    if (!e) return isGround(r);
    if (e.eval === undefined) return e.value === true || e.word === 'true';
    return this.evalStyle(r, e) === true;
  }

  private specOf(r: ObjRec): Body3Value | undefined {
    const s = this.specs.get(r.id);
    if (s) return s;
    if (!this.written.has(r.id) && r.cell.defined && isBody3Value(r.cell.value)) {
      this.specs.set(r.id, r.cell.value);
      return r.cell.value;
    }
    return undefined;
  }

  private specsOfList(r: ObjRec): (Body3Value | undefined)[] {
    const s = this.listSpecs.get(r.id);
    if (s) return s;
    if (!this.written.has(r.id) && r.cell.defined && Array.isArray(r.cell.value)) {
      const list = (r.cell.value as unknown[]).map((v) => (isBody3Value(v) ? v : undefined));
      this.listSpecs.set(r.id, list);
      return list;
    }
    return [];
  }

  private jointsOf(r: ObjRec): (JointValue3 | undefined)[] {
    const s = this.jointSpecs.get(r.id);
    if (s) return s;
    if (this.written.has(r.id) || !r.cell.defined) return [];
    const list = (Array.isArray(r.cell.value) ? (r.cell.value as unknown[]) : [r.cell.value]).map((v) => (isJoint3Value(v) ? v : undefined));
    this.jointSpecs.set(r.id, list);
    return list;
  }

  private wheelsOf(r: ObjRec): (Wheel3Value | undefined)[] {
    const s = this.wheelSpecs.get(r.id);
    if (s) return s;
    if (this.written.has(r.id) || !r.cell.defined) return [];
    const list = (Array.isArray(r.cell.value) ? (r.cell.value as unknown[]) : [r.cell.value]).map((v) => (isWheel3Value(v) ? v : undefined));
    this.wheelSpecs.set(r.id, list);
    return list;
  }

  private vehicleOf(r: ObjRec): Vehicle3Value | undefined {
    const s = this.vehicleSpecs.get(r.id);
    if (s) return s;
    if (!this.written.has(r.id) && r.cell.defined && isVehicle3Value(r.cell.value)) {
      this.vehicleSpecs.set(r.id, r.cell.value);
      return r.cell.value;
    }
    return undefined;
  }

  private settings(): WorldValue {
    if (!this.worldRec) return DEFAULT_WORLD;
    if (this.worldSettings) return this.worldSettings;
    const c = this.worldRec.cell;
    return c.defined && isWorldValue(c.value) ? c.value : DEFAULT_WORLD;
  }

  /** The box terrain is meshed over: the clip box of `space`, or 10 units across the origin. */
  private terrainBox(): { min: V3; max: V3 } {
    const c = this.spaceRec?.cell;
    const v = c?.defined ? (c.value as { clipMin?: V3; clipMax?: V3 }) : undefined;
    if (v?.clipMin && v.clipMax) return { min: v.clipMin, max: v.clipMax };
    return { min: { x: -5, y: -5, z: -5 }, max: { x: 5, y: 5, z: 5 } };
  }

  private signature(): unknown[] {
    const sig: unknown[] = [this.acc.t0(), this.acc.solverStepsPerSecond()];
    const w = this.settings();
    sig.push(this.varyingWorld ? 'varying' : [w.gx, w.gy, w.gz, w.g3, w.air, w.passes, w.rate, w.sleep, w.range]);
    for (const r of this.bodyRecs) {
      if (r.p.type.k === 'List') {
        sig.push(r.id, this.specsOfList(r).map((b) => (b ? b.spec : null)));
        continue;
      }
      const s = this.specOf(r);
      sig.push(r.id, s ? s.spec : null);
      for (const k of BODY3_PROPS) {
        const e = r.p.style.get(k);
        if (e) sig.push(k, e.text, this.isVarying(e) ? 'varying' : this.evalStyle(r, e));
      }
    }
    let terrain = false;
    for (const r of this.solidRecs) {
      const on = this.solidOn(r);
      sig.push(r.id, on);
      if (!on) continue;
      // a solid that moves during the film is taken where it starts (round 5 moves solids in space)
      sig.push(this.varySet.has(r) ? 'moving' : r.cell.defined ? r.cell.value : null);
      if (r.p.type.k === 'Function') terrain = true;
      for (const k of ['bounce', 'friction'] as const) {
        const e = r.p.style.get(k);
        if (e) sig.push(k, e.text, this.evalStyle(r, e));
      }
    }
    if (terrain) sig.push(this.terrainBox());
    for (const r of this.jointRecs) {
      // a joint whose motor moves during the film is rebuilt only when its line changes
      if (this.varySet.has(r)) sig.push(r.id, 'varying', r.p.compiled);
      else sig.push(r.id, this.jointsOf(r).map((j) => (j ? jointKey3(j) : null)));
    }
    for (const r of this.wheelRecs) sig.push(r.id, this.wheelsOf(r).map((w) => (w ? [w.chassis.spec ? specKey(w.chassis.spec) : w.chassis.id, w.at.x, w.at.y, w.at.z, w.r, w.spring, w.damping, w.travel, w.grip, w.drive, w.steers, w.breaks, w.mass] : null)));
    for (const r of this.vehicleRecs) {
      const v = this.vehicleOf(r);
      sig.push(r.id, this.varySet.has(r) ? 'varying' : v ? [v.motor, v.steer, v.brake, v.power, v.wheels.length, v.chassis.spec ? specKey(v.chassis.spec) : null] : null);
    }
    return sig;
  }

  private isVarying(e: StyleEntry): boolean {
    if (e.usesT) return true;
    for (const id of e.reads) {
      const r = this.acc.byId(id);
      if (r && this.varySet.has(r)) return true;
    }
    return false;
  }

  private evalStyle(r: ObjRec, e: StyleEntry): unknown {
    if (e.eval === undefined) return e.word !== undefined ? (e.word === 'true' ? true : e.word === 'false' ? false : e.word) : e.value;
    this.acc.ensureSlots(r.p.checked.slots);
    this.acc.env.reason = undefined;
    try {
      return e.eval(this.acc.env);
    } catch {
      return undefined;
    }
  }

  private styleNumber(r: ObjRec, key: string, fallback: number): number {
    const e = r.p.style.get(key);
    if (!e || this.isVarying(e)) return fallback;
    const v = this.evalStyle(r, e);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  private styleV3(r: ObjRec, key: string): V3 | undefined {
    const e = r.p.style.get(key);
    if (!e) return undefined;
    return asV3(this.evalStyle(r, e));
  }

  /* ------------------------------ building ------------------------------ */

  private stepRate(rate: number): number {
    const solver = this.acc.solverStepsPerSecond();
    const r = Number.isFinite(rate) && rate > 0 ? Math.round(rate) : 120;
    return solver % r === 0 ? r : 120;
  }

  private build(): void {
    const w = this.settings();
    this.rate = this.stepRate(w.rate);
    this.t0 = this.acc.t0();
    const defs: BodyDef3[] = [];
    const members: Member3[] = [];
    const recs = [...this.bodyRecs, ...this.solidRecs].sort((a, b) => a.order - b.order);
    for (const r of recs) {
      if (isBody3Rec(r)) {
        const list = r.p.type.k === 'List' ? this.specsOfList(r) : [this.specOf(r)];
        for (let item = 0; item < list.length; item++) {
          const s = list[item];
          if (!s) continue;
          const sp = s.spec;
          defs.push({
            type: sp.fixed ? BodyType3.Static : BodyType3.Dynamic,
            shapes: sp.shapes,
            ...(sp.mass !== undefined ? { mass: sp.mass } : {}),
            density: sp.density,
            v: sp.v,
            w: sp.w,
            friction: clamp(this.styleNumber(r, 'friction', sp.friction), 0, 2),
            bounce: clamp(this.styleNumber(r, 'bounce', sp.bounce), 0, 1),
            group: Math.round(this.styleNumber(r, 'group', sp.group)),
          });
          members.push({ rec: r, role: 'body', index: defs.length - 1, spec: sp, ...(r.p.type.k === 'List' ? { item } : {}) });
        }
        continue;
      }
      if (!this.solidOn(r) || !r.cell.defined) continue;
      const shapes = this.solidShapes(r);
      if (!shapes || shapes.length === 0) continue;
      defs.push({ type: BodyType3.Static, shapes, friction: this.styleNumber(r, 'friction', Number.NaN), bounce: this.styleNumber(r, 'bounce', 0) });
      members.push({ rec: r, role: 'solid', index: defs.length - 1 });
    }
    if (!members.some((m) => m.role === 'body')) {
      this.world = undefined;
      this.members = [];
      this.byId = new Map();
      return;
    }
    // wheels: a ray each on its chassis; one that may come off waits in the world as a free round slab (design 8)
    const wheelDefs: { rec: ObjRec; item?: number; value: Wheel3Value; chassis: number; body: number }[] = [];
    for (const r of this.wheelRecs) {
      const list = this.wheelsOf(r);
      for (let item = 0; item < list.length; item++) {
        const wv = list[item];
        if (!wv) continue;
        const chassis = this.endIndex(wv.chassis, members);
        if (chassis === undefined) continue;
        let body = -1;
        if (wv.breaks > 0) {
          const width = Math.min(0.4, wv.r * 0.6);
          const c = { x: wv.at.x, y: wv.at.y, z: wv.at.z };
          defs.push({ type: BodyType3.Dynamic, shapes: [wheelSlab(c, wv.r, width)], mass: wv.mass, friction: wv.grip, bounce: 0.2, group: (defs[chassis] as BodyDef3).group ?? 0, off: true });
          body = defs.length - 1;
        }
        wheelDefs.push({ rec: r, ...(r.p.type.k === 'List' ? { item } : {}), value: wv, chassis, body });
      }
    }
    const world = new World3(defs);
    world.gx = w.g3 ? w.gx : 0;
    world.gy = w.g3 ? w.gy : 0;
    world.gz = w.gz;
    world.air = w.air;
    world.passes = w.passes;
    world.sleeping = w.sleep;
    world.range = w.range;
    this.world = world;
    this.members = members;
    this.byId = new Map();
    for (const m of members) if (!this.byId.has(m.rec.id)) this.byId.set(m.rec.id, m);
    this.nameOfIndex = [];
    for (const m of members) this.nameOfIndex[m.index] = m.item !== undefined ? `${m.rec.p.name}[${m.item + 1}]` : m.rec.p.name;
    this.buildJoints(world, members);
    this.wheelMembers = [];
    for (const wd of wheelDefs) {
      const v = wd.value;
      // the mount: the wheel's centre at the start, up by its travel (the chassis's own up is z at the start)
      const mount = world.toLocal(wd.chassis, v.at.x, v.at.y, v.at.z + v.travel);
      const group = world.group[wd.chassis] as number;
      const chassis = wd.chassis;
      const own = wd.body;
      const skip = (i: number): boolean => i === chassis || i === own || (group !== 0 && world.group[i] === group);
      const joint = new Wheel3(chassis, mount, { r: v.r, spring: v.spring, damping: v.damping, travel: v.travel, grip: v.grip, drive: v.drive, steers: v.steers, breaks: v.breaks, mass: v.mass }, own, skip);
      world.joints.push(joint);
      const name = wd.item !== undefined ? `${wd.rec.p.name}[${wd.item + 1}]` : wd.rec.p.name;
      if (own >= 0) this.nameOfIndex[own] = name;
      this.wheelMembers.push({ rec: wd.rec, ...(wd.item !== undefined ? { item: wd.item } : {}), value: v, joint, chassis });
    }
    // each car's wheels: those on its chassis
    this.carWheels = new Map();
    for (const r of this.vehicleRecs) {
      const v = this.vehicleOf(r);
      const c = v ? this.endIndex(v.chassis, members) : undefined;
      this.carWheels.set(r.id, c === undefined ? [] : this.wheelMembers.filter((wm) => wm.chassis === c));
    }
    this.n = 0;
    this.prevP = Float64Array.from(world.p);
    this.prevQ = Float64Array.from(world.q);
    this.checkpoints = new Map();
    this.cpStride = Math.max(1, Math.round(CHECKPOINT_SECONDS * this.rate));
    this.cpBytes = 0;
    this.failedAt = new Map();
    this.leftAt = new Map();
    this.grabs = new Map();
    this.prevStale = false;
    this.findCone();
    this.applyStatic();
    this.saveCheckpoint(0);
  }

  /** The world index of a joint's end: a body by its start, or a solid by id. */
  private endIndex(e: { readonly id?: ObjId; readonly spec?: BodySpec3 }, members: readonly Member3[]): number | undefined {
    if (e.spec) for (const m of members) if (m.spec === e.spec || (m.spec && sameValue(m.spec, e.spec))) return m.index;
    if (e.id !== undefined) for (const m of members) if (m.rec.id === e.id && m.item === undefined) return m.index;
    return undefined;
  }

  private buildJoints(world: World3, members: readonly Member3[]): void {
    this.jointMembers = [];
    world.joints = [];
    for (const r of this.jointRecs) {
      const list = this.jointsOf(r);
      const isList = r.p.type.k === 'List';
      for (let item = 0; item < list.length; item++) {
        const j = list[item];
        if (!j) continue;
        const a = this.endIndex(j.a, members);
        const b = this.endIndex(j.b, members);
        if (a === undefined || b === undefined || a === b) continue;
        const joint = buildJoint3(world, j, a, b);
        world.joints.push(joint);
        this.jointMembers.push({ rec: r, value: j, joint, ...(isList ? { item } : {}) });
      }
    }
  }

  /** A solid's walls: the floor of `Ground()`, terrain of `z = f(x, y)`, or the shape itself. */
  private solidShapes(r: ObjRec): ShapeDef3[] | undefined {
    if (!r.cell.defined) return undefined;
    const v = r.cell.value;
    if (isGround(r)) {
      const g = v as { c?: number };
      return [{ kind: 'plane', n: { x: 0, y: 0, z: 1 }, d: typeof g.c === 'number' ? g.c : 0 }];
    }
    if (r.p.type.k === 'Function') {
      const fn = v as { arity?: number; call?: (...xs: number[]) => unknown };
      if (fn.arity !== 2 || typeof fn.call !== 'function') return undefined;
      const box = this.terrainBox();
      this.warnOnce(`ground:${r.id}`, makeNotice('ground_sampled', { name: r.p.name, range: Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2 }, [r.p.name]));
      const call = fn.call;
      const key: unknown[] = [v, box.min.x, box.max.x, box.min.y, box.max.y, TERRAIN_CELLS];
      const had = this.terrainCache.get(r.id);
      if (had && had.key.length === key.length && had.key.every((k, i) => k === key[i])) return had.shapes;
      const shapes = terrainOf((x, y) => call(x, y), box.min.x, box.max.x, box.min.y, box.max.y, TERRAIN_CELLS);
      this.terrainCache.set(r.id, { key, shapes });
      return shapes;
    }
    return solid3Of(v);
  }

  private applyStatic(): void {
    const w = this.world as World3;
    for (const m of this.members) {
      if (m.role !== 'body') continue;
      const i = m.index;
      const f = this.staticV3(m.rec, 'force');
      if (f) w.force.set([f.x, f.y, f.z], i * 3);
      const tq = this.staticV3(m.rec, 'torque');
      if (tq) w.torque.set([tq.x, tq.y, tq.z], i * 3);
    }
  }

  private staticV3(r: ObjRec, key: string): V3 | undefined {
    const e = r.p.style.get(key);
    if (!e || this.isVarying(e)) return undefined;
    return this.styleV3(r, key);
  }

  /** What changes during the film: property formulas of `t`, and the world's settings. */
  private findCone(): void {
    this.coneDirty = false;
    const bodies = new Set(this.bodyRecs);
    const targets: ObjRec[] = [];
    if (this.worldRec) targets.push(this.worldRec);
    for (const r of this.bodyRecs) {
      for (const k of BODY3_PROPS) {
        const e = r.p.style.get(k);
        if (!e) continue;
        for (const id of e.reads) {
          const x = this.acc.byId(id);
          if (x && x !== r) targets.push(x);
        }
      }
    }
    for (const r of this.solidRecs) targets.push(r);
    targets.push(...this.jointRecs, ...this.vehicleRecs);
    const anc = this.acc.ancestorRecs(targets);
    const all = [...new Set([...anc, ...targets])].sort((a, b) => a.order - b.order);
    const vary = new Set<ObjRec>();
    const joints = new Set(this.jointRecs);
    for (const r of all) {
      if (bodies.has(r)) continue;
      // a joint reads its bodies only for its start, so a moving body does not make it change
      if (r.usesClock || this.logged.has(r.id) || r.inputs.some((i) => vary.has(i) || (bodies.has(i) && !joints.has(r)))) vary.add(r);
    }
    this.varySet = vary;
    this.cone = all.filter((r) => vary.has(r) && r.p.kind === 'rule' && !bodies.has(r) && !this.solidRecs.includes(r));
    // a car's pedals and wheel are driven while the film plays: they always go on from now (design 8, ui.md 9)
    this.vehicleInputs = new Set();
    for (const r of this.acc.ancestorRecs(this.vehicleRecs)) if (r.p.kind === 'free') this.vehicleInputs.add(r.id);
    this.startInputs = new Set();
    for (const r of this.acc.ancestorRecs(this.bodyRecs)) if (r.p.kind === 'free') this.startInputs.add(r.id);
    this.varyingStyle = [];
    for (const m of this.members) {
      if (m.role !== 'body') continue;
      for (const k of BODY3_PROPS) {
        const e = m.rec.p.style.get(k);
        if (e && (this.isVarying(e) || e.reads.some((id) => bodies.has(this.acc.byId(id) as ObjRec)))) this.varyingStyle.push({ member: m, entry: e });
      }
    }
    this.varyingWorld = this.worldRec !== undefined && vary.has(this.worldRec);
  }

  /* ------------------------------ stepping ------------------------------ */

  private advance(nTarget: number, budget: number): void {
    const w = this.world as World3;
    this.short = false;
    const want = Math.max(0, nTarget - 1);
    let best = -1;
    for (const k of this.checkpoints.keys()) if (k <= want && k > best) best = k;
    if (this.n > nTarget || this.prevStale || best > this.n) {
      if (best < 0) best = 0;
      const cp = this.checkpoints.get(best);
      if (cp) {
        w.load(cp);
        this.n = best;
      }
      this.prevP.set(w.p);
      this.prevQ.set(w.q);
      this.prevStale = false;
    }
    if (this.n >= nTarget) {
      this.catching = undefined;
      return;
    }
    const perStep = Math.max(1, w.awakeCount() + 1);
    let steps = Math.max(2, Math.floor(budget / perStep));
    const varying = this.cone.length > 0 || this.varyingStyle.length > 0 || this.varyingWorld || this.base.size > 0;
    const saved = varying ? this.saveCells() : undefined;
    try {
      while (this.n < nTarget && steps-- > 0) this.stepOnce(varying);
    } finally {
      if (saved) this.restoreCells(saved);
    }
    if (this.n < nTarget) {
      this.short = true;
      const from = this.t0 + this.n / this.rate;
      if (!this.catching) this.warnings.push(makeNotice('catching_up', { from: Number(from.toFixed(3)), to: Number((this.t0 + nTarget / this.rate).toFixed(3)) }, this.members.map((m) => m.rec.p.name)));
      this.catching = { from, to: this.t0 + nTarget / this.rate };
    } else this.catching = undefined;
  }

  private stepOnce(varying: boolean): void {
    const w = this.world as World3;
    const n = this.n;
    const h = 1 / this.rate;
    this.applyLog(n);
    if (varying) this.stepInputs(n);
    this.applyGrabs();
    this.applyVehicles();
    if (n === 0) {
      // leapfrog start (as the plane driver): free flight follows x0 + v0 t + a t² / 2 at every step
      for (const m of this.members) {
        const i = m.index;
        if (m.role !== 'body' || w.type[i] !== BodyType3.Dynamic) continue;
        const im = w.invM[i] as number;
        const g = [w.gx, w.gy, w.gz];
        for (let a = 0; a < 3; a++) w.v[i * 3 + a] = (w.v[i * 3 + a] as number) - 0.5 * h * ((g[a] as number) + im * (w.force[i * 3 + a] as number));
      }
    }
    this.prevP.set(w.p);
    this.prevQ.set(w.q);
    w.step(h);
    this.n = n + 1;
    this.checkHealth();
    for (const jm of [...this.jointMembers, ...this.wheelMembers]) {
      if (!jm.joint.broken || this.brokeAt.has(jm.joint)) continue;
      const name = jm.item !== undefined ? `${jm.rec.p.name}[${jm.item + 1}]` : jm.rec.p.name;
      this.brokeAt.set(jm.joint, this.n);
      this.events.push({ t: this.t0 + this.n / this.rate, kind: 'broken', name });
      this.warnOnce(`broken:${name}:${this.n}`, makeNotice('broken', { name, t: Number((this.t0 + this.n / this.rate).toFixed(3)) }, [name]));
    }
    for (const i of w.left) if (!this.leftAt.has(i)) {
      this.leftAt.set(i, this.n);
      const name = this.nameOfIndex[i] ?? '';
      this.warnOnce(`left:${i}`, makeNotice('left_world', { name, t: Number((this.t0 + this.n / this.rate).toFixed(3)), range: w.range }, [name]));
    }
    if (!this.sampling) {
      const fresh = this.n > this.frontier;
      for (const hit of w.hits) {
        const e = { t: this.t0 + this.n / this.rate, a: this.nameOfIndex[hit.a] ?? '', b: this.nameOfIndex[hit.b] ?? '', speed: hit.speed, x: hit.x, y: hit.y, z: hit.z, impulse: hit.impulse };
        this.hits.push(e);
        if (fresh) this.pendingHits.push(e);
      }
      if (fresh) this.frontier = this.n;
    }
    if (this.n % this.cpStride === 0 && !this.checkpoints.has(this.n)) this.saveCheckpoint(this.n);
  }

  private saveCheckpoint(n: number): void {
    const s = (this.world as World3).save();
    this.checkpoints.set(n, s);
    this.cpBytes += s.byteLength;
    if (this.cpBytes > CHECKPOINT_BYTES) {
      this.cpStride *= 2;
      this.cpBytes = 0;
      for (const [k, v] of [...this.checkpoints]) {
        if (k !== 0 && k % this.cpStride !== 0) this.checkpoints.delete(k);
        else this.cpBytes += v.byteLength;
      }
      this.warnOnce(`thin:${this.cpStride}`, makeNotice('checkpoints_thinned', { seconds: this.cpStride / this.rate }, []));
    }
  }

  private checkHealth(): void {
    const w = this.world as World3;
    for (const m of this.members) {
      if (m.role !== 'body') continue;
      const i = m.index;
      if (w.type[i] !== BodyType3.Dynamic) continue;
      let bad = false;
      for (let a = 0; a < 3; a++) {
        const p = w.p[i * 3 + a] as number;
        const v = w.v[i * 3 + a] as number;
        const s = w.w[i * 3 + a] as number;
        if (!Number.isFinite(p) || !Number.isFinite(v) || Math.abs(v) > BLOW_UP || Math.abs(s) > BLOW_UP) bad = true;
      }
      if (!bad) continue;
      this.failedAt.set(i, this.n);
      w.removeBody(i);
      const t = Number((this.t0 + this.n / this.rate).toFixed(3));
      this.warnOnce(`unstable:${i}:${this.n}`, makeNotice('unstable_world', { name: m.rec.p.name, t, hint: 'use world with timestep = 1/240, or make the bodies less heavy against each other' }, [m.rec.p.name]));
    }
  }

  private warnOnce(key: string, n: Notice): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnings.push(n);
  }

  /* ------------------------------ inputs ------------------------------ */

  private saveCells(): { recs: ObjRec[]; cells: Cell[]; t: number } {
    const recs = [...this.cone, ...this.bodyRecs, ...(this.worldRec ? [this.worldRec] : []), ...[...this.base.keys()].map((id) => this.acc.byId(id)).filter((r): r is ObjRec => r !== undefined)];
    return { recs, cells: recs.map((r) => r.cell), t: this.acc.env.t };
  }

  private restoreCells(s: { recs: ObjRec[]; cells: Cell[]; t: number }): void {
    s.recs.forEach((r, i) => {
      r.cell = s.cells[i] as Cell;
    });
    this.acc.env.t = s.t;
  }

  private stepInputs(n: number): void {
    const w = this.world as World3;
    const env = this.acc.env;
    env.t = this.t0 + n / this.rate;
    // logged free values (the pedals) as they were at this step
    for (const id of this.base.keys()) {
      const r = this.acc.byId(id);
      if (!r) continue;
      const v = this.inputAt(id, n);
      r.cell = v === undefined ? { defined: false, reason: 'explicit' } : { defined: true, value: v };
    }
    // formulas that read a body read it where it is at this step
    const lists = new Map<ObjRec, unknown[]>();
    for (const m of this.members) {
      if (m.role !== 'body') continue;
      if (m.item === undefined) m.rec.cell = { defined: true, value: this.liveValue(m, 1) };
      else {
        const arr = lists.get(m.rec) ?? [];
        arr[m.item] = this.liveValue(m, 1);
        lists.set(m.rec, arr);
      }
    }
    for (const [r, arr] of lists) r.cell = { defined: true, value: arr };
    for (const r of this.cone) r.cell = this.acc.compute(r);
    // joints whose motor or limits change during the film
    for (const jm of this.jointMembers) {
      if (!this.varySet.has(jm.rec)) continue;
      const c = jm.rec.cell;
      if (!c.defined) continue;
      const v = Array.isArray(c.value) ? (c.value as unknown[])[jm.item ?? 0] : c.value;
      if (!isJoint3Value(v)) continue;
      const o = <K extends string>(k: K, x: number | undefined): Partial<Record<K, number>> => (x === undefined ? {} : ({ [k]: x } as Record<K, number>));
      if (jm.joint instanceof Hinge3) jm.joint.opts = { ...o('motor', v.motor), ...o('torque', v.torque), ...o('min', v.min), ...o('max', v.max) };
      else if (jm.joint instanceof Slider3) jm.joint.opts = { ...o('min', v.min), ...o('max', v.max), ...o('motor', v.motor), ...o('force', v.torque) };
      if (v.motor !== undefined) {
        w.wakeBody(jm.joint.a);
        w.wakeBody(jm.joint.b);
      }
    }
    if (this.varyingWorld && this.worldRec) {
      const c = this.worldRec.cell;
      if (c.defined && isWorldValue(c.value)) {
        w.gx = c.value.g3 ? c.value.gx : 0;
        w.gy = c.value.g3 ? c.value.gy : 0;
        w.gz = c.value.gz;
        w.air = c.value.air;
      }
    }
    for (const { member: m, entry: e } of this.varyingStyle) {
      const v = this.evalStyle(m.rec, e);
      const i = m.index;
      switch (e.key) {
        case 'force':
        case 'torque': {
          const p = asV3(v);
          (e.key === 'force' ? w.force : w.torque).set(p ? [p.x, p.y, p.z] : [0, 0, 0], i * 3);
          if (!p) this.warnOnce(`undef:${m.rec.id}:${e.key}`, makeNotice('input_undefined', { name: m.rec.p.name, what: e.key, t: Number(env.t.toFixed(3)) }, [m.rec.p.name]));
          if (p && (p.x !== 0 || p.y !== 0 || p.z !== 0)) w.wakeBody(i);
          break;
        }
        case 'friction':
          if (typeof v === 'number' && Number.isFinite(v)) w.fric[i] = clamp(v, 0, 2);
          break;
        case 'bounce':
          if (typeof v === 'number' && Number.isFinite(v)) w.rest[i] = clamp(v, 0, 1);
          break;
        default:
          break;
      }
    }
  }

  private addEntry(e: LogEntry3): void {
    if (e.kind === 'set') this.log = this.log.filter((x) => !(x.kind === 'set' && x.id === e.id && x.n >= e.n));
    this.log.push(e);
    this.log.sort((a, b) => a.n - b.n);
    for (const k of [...this.checkpoints.keys()]) if (k > e.n) this.checkpoints.delete(k);
    this.cpBytes = 0;
    for (const v of this.checkpoints.values()) this.cpBytes += v.byteLength;
    if (this.n > e.n) {
      this.prevStale = true;
      let best = 0;
      for (const k of this.checkpoints.keys()) if (k <= e.n && k > best) best = k;
      const cp = this.checkpoints.get(best);
      if (cp && this.world) {
        this.world.load(cp);
        this.n = best;
      }
    }
  }

  inputLines(): string[] {
    const out: string[] = [];
    const t = (n: number): string => String(Number((this.t0 + n / this.rate).toFixed(6)));
    const v3 = (p: V3): string => `${num(p.x)} ${num(p.y)} ${num(p.z)}`;
    for (const [id, v] of this.base) {
      const nm = this.acc.byId(id)?.p.name;
      const w = numWords(v);
      if (nm && w) out.push(`@input physics set ${nm} base ${w} at 0`);
    }
    for (const e of this.log) {
      if (e.kind === 'reset') {
        out.push(`@input physics reset at ${t(e.n)}`);
        continue;
      }
      const base = this.acc.byId(e.id)?.p.name;
      if (!base) continue;
      if (e.kind === 'set') {
        const w = numWords(e.value);
        if (w) out.push(`@input physics set ${base} ${w} at ${t(e.n)}`);
        continue;
      }
      const nm = e.item !== undefined ? `${base}[${e.item + 1}]` : base;
      if (e.kind === 'push') out.push(`@input physics push ${nm} ${v3(e.j)}${e.at ? ` ${v3(e.at)}` : ''} at ${t(e.n)}`);
      else if (e.kind === 'grab') out.push(`@input physics grab ${nm} ${v3(e.to)} ${v3(e.a)} at ${t(e.n)}`);
      else out.push(`@input physics release ${nm} at ${t(e.n)}`);
    }
    return out;
  }

  private applyLog(n: number): void {
    const w = this.world as World3;
    for (const e of this.log) {
      if (e.n !== n) continue;
      if (e.kind === 'reset') {
        const cp = this.checkpoints.get(0);
        if (cp) {
          const keep = w.stepIndex;
          w.load(cp);
          w.stepIndex = keep;
        }
        this.grabs.clear();
        continue;
      }
      if (e.kind === 'set') continue;
      const m = this.memberOf(e.id, e.item);
      if (!m) continue;
      const i = m.index;
      if (e.kind === 'push') {
        this.impulseAt(i, e.j.x, e.j.y, e.j.z, e.at);
        w.wakeBody(i);
      } else if (e.kind === 'grab') {
        const g = this.grabs.get(i);
        if (g) g.to = e.to;
        else this.grabs.set(i, { to: e.to, a: e.a });
        w.wakeBody(i);
      } else this.grabs.delete(i);
    }
  }

  /** An impulse J at a world point (or the centre): Δv = J / m, Δω = I⁻¹ (r × J). */
  private impulseAt(i: number, jx: number, jy: number, jz: number, at?: V3, turn = 1): void {
    const w = this.world as World3;
    if (w.type[i] !== BodyType3.Dynamic) return;
    const im = w.invM[i] as number;
    w.v[i * 3] = (w.v[i * 3] as number) + im * jx;
    w.v[i * 3 + 1] = (w.v[i * 3 + 1] as number) + im * jy;
    w.v[i * 3 + 2] = (w.v[i * 3 + 2] as number) + im * jz;
    if (!at) return;
    const rx = at.x - (w.p[i * 3] as number);
    const ry = at.y - (w.p[i * 3 + 1] as number);
    const rz = at.z - (w.p[i * 3 + 2] as number);
    const t = [ry * jz - rz * jy, rz * jx - rx * jz, rx * jy - ry * jx];
    for (let a = 0; a < 3; a++) {
      let s = 0;
      for (let b = 0; b < 3; b++) s += (w.invIw[i * 9 + a * 3 + b] as number) * (t[b] as number);
      w.w[i * 3 + a] = (w.w[i * 3 + a] as number) + turn * s;
    }
  }

  /** The value of a logged input at step n. */
  private inputAt(id: ObjId, n: number): unknown {
    let v: unknown = this.base.has(id) ? this.base.get(id) : this.acc.byId(id)?.p.value;
    for (const e of this.log) if (e.kind === 'set' && e.id === id && e.n <= n) v = e.value;
    return v;
  }

  /** Each car tells its wheels the pedals and the steering of this step (design 8). */
  private applyVehicles(): void {
    if (this.vehicleRecs.length === 0 || this.wheelMembers.length === 0) return;
    const w = this.world as World3;
    for (const r of this.vehicleRecs) {
      // pedals that change during the film: the car as computed at this step's time
      const c = this.varySet.has(r) ? r.cell : undefined;
      const v = c?.defined && isVehicle3Value(c.value) ? c.value : this.vehicleOf(r);
      if (!v) continue;
      const mine = this.carWheels.get(r.id) ?? [];
      const share = Math.max(1, mine.filter((wm) => wm.value.drive && !wm.joint.broken).length);
      for (const wm of mine) {
        const j = wm.joint;
        j.motor = v.motor;
        j.steer = v.steer;
        j.brake = v.brake;
        j.power = v.power;
        j.share = share;
      }
      const ch = mine[0]?.chassis;
      if (ch !== undefined && (v.motor !== 0 || v.brake > 0 || v.steer !== 0)) w.wakeBody(ch);
    }
  }

  /** A grab pulls the taken point toward the pointer with a stiff, damped spring (as in the plane). */
  private applyGrabs(): void {
    if (this.grabs.size === 0) return;
    const w = this.world as World3;
    const omega = 2 * Math.PI * 5;
    const h = 1 / this.rate;
    for (const [i, g] of this.grabs) {
      if (w.type[i] !== BodyType3.Dynamic) continue;
      const m = w.mass[i] as number;
      const [px, py, pz] = w.toWorld(i, g.a.x, g.a.y, g.a.z);
      const rx = px - (w.p[i * 3] as number);
      const ry = py - (w.p[i * 3 + 1] as number);
      const rz = pz - (w.p[i * 3 + 2] as number);
      const wx = w.w[i * 3] as number;
      const wy = w.w[i * 3 + 1] as number;
      const wz = w.w[i * 3 + 2] as number;
      const vx = (w.v[i * 3] as number) + wy * rz - wz * ry;
      const vy = (w.v[i * 3 + 1] as number) + wz * rx - wx * rz;
      const vz = (w.v[i * 3 + 2] as number) + wx * ry - wy * rx;
      const k = m * omega * omega;
      const d = 2 * 0.9 * m * omega;
      const fx = k * (g.to.x - px) - d * vx - m * w.gx;
      const fy = k * (g.to.y - py) - d * vy - m * w.gy;
      const fz = k * (g.to.z - pz) - d * vz - m * w.gz;
      this.impulseAt(i, fx * h, fy * h, fz * h, { x: px, y: py, z: pz }, 0.2);
      w.wakeBody(i);
    }
  }

  /* ------------------------------ writing the cells ------------------------------ */

  private pose(i: number, alpha: number): { p: V3; q: [number, number, number, number] } {
    const w = this.world as World3;
    const L = (a: number, b: number): number => a + (b - a) * alpha;
    const p = { x: L(this.prevP[i * 3] as number, w.p[i * 3] as number), y: L(this.prevP[i * 3 + 1] as number, w.p[i * 3 + 1] as number), z: L(this.prevP[i * 3 + 2] as number, w.p[i * 3 + 2] as number) };
    let q0 = this.prevQ[i * 4] as number;
    let q1 = this.prevQ[i * 4 + 1] as number;
    let q2 = this.prevQ[i * 4 + 2] as number;
    let q3 = this.prevQ[i * 4 + 3] as number;
    const c0 = w.q[i * 4] as number;
    const c1 = w.q[i * 4 + 1] as number;
    const c2 = w.q[i * 4 + 2] as number;
    const c3 = w.q[i * 4 + 3] as number;
    // the shorter way round
    const s = q0 * c0 + q1 * c1 + q2 * c2 + q3 * c3 < 0 ? -1 : 1;
    q0 = L(q0 * s, c0);
    q1 = L(q1 * s, c1);
    q2 = L(q2 * s, c2);
    q3 = L(q3 * s, c3);
    const l = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3) || 1;
    return { p, q: [q0 / l, q1 / l, q2 / l, q3 / l] };
  }

  private midPotential(i: number): number {
    const w = this.world as World3;
    const m = w.mass[i] as number;
    const mx = 0.5 * ((this.prevP[i * 3] as number) + (w.p[i * 3] as number));
    const my = 0.5 * ((this.prevP[i * 3 + 1] as number) + (w.p[i * 3 + 1] as number));
    const mz = 0.5 * ((this.prevP[i * 3 + 2] as number) + (w.p[i * 3 + 2] as number));
    return -m * (w.gx * mx + w.gy * my + w.gz * mz);
  }

  private liveValue(m: Member3, alpha: number): Body3Value {
    const w = this.world as World3;
    const i = m.index;
    const sp = m.spec as BodySpec3;
    const { p, q } = this.pose(i, alpha);
    const dynamic = w.type[i] === BodyType3.Dynamic;
    const ke = dynamic ? w.kinetic(i) : 0;
    const pe = dynamic ? this.midPotential(i) : 0;
    return {
      schema: 'Body3', spec: sp, x: p.x, y: p.y, z: p.z, q,
      v: { x: w.v[i * 3] as number, y: w.v[i * 3 + 1] as number, z: w.v[i * 3 + 2] as number },
      spin: { x: w.w[i * 3] as number, y: w.w[i * 3 + 1] as number, z: w.w[i * 3 + 2] as number },
      asleep: dynamic && w.awake[i] === 0, mass: sp.fixed ? Infinity : (w.mass[i] as number), energy: ke + pe, kinetic: ke, potential: pe, touching: [],
      now: solidNow(sp.solid, { x: sp.cx, y: sp.cy, z: sp.cz }, p, q),
    };
  }

  private bodyCell(m: Member3, alpha: number): Cell {
    const i = m.index;
    if (this.failedAt.has(i)) return { defined: false, reason: 'unstable_world' };
    if (this.leftAt.has(i)) return { defined: false, reason: 'left_world' };
    const w = this.world as World3;
    const v = this.liveValue(m, alpha);
    const forces = Float64Array.from(w.forces.subarray(i * NK * 3, (i + 1) * NK * 3));
    if (v.asleep) forces.fill(0, FK3.net * 3, FK3.net * 3 + 3);
    const touching = (this.touchLists[i] ?? []).map((k) => this.nameOfIndex[k] ?? '').filter((s) => s !== '');
    return { defined: true, value: { ...v, forces, touching } };
  }

  private writeCells(alpha: number): ObjRec[] {
    const w = this.world as World3;
    const changed: ObjRec[] = [];
    this.touchLists = w.touchingAll();
    const lists = new Map<ObjRec, unknown[]>();
    for (const m of this.members) {
      if (m.role !== 'body') continue;
      const cell = this.bodyCell(m, alpha);
      if (m.item !== undefined) {
        let arr = lists.get(m.rec);
        if (!arr) {
          arr = (this.specsOfList(m.rec) as unknown[]).slice();
          lists.set(m.rec, arr);
        }
        arr[m.item] = cell.defined ? cell.value : undefined;
        continue;
      }
      this.put(m.rec, cell, changed);
    }
    for (const [rec, arr] of lists) this.put(rec, { defined: true, value: arr }, changed);
    this.writeLinks(alpha, changed);
    if (this.worldRec) {
      const s = this.settings();
      let energy = 0;
      let px = 0;
      let py = 0;
      for (const m of this.members) {
        const i = m.index;
        if (m.role !== 'body' || w.type[i] !== BodyType3.Dynamic) continue;
        energy += w.kinetic(i) + this.midPotential(i);
        px += (w.mass[i] as number) * (w.v[i * 3] as number);
        py += (w.mass[i] as number) * (w.v[i * 3 + 1] as number);
      }
      for (const j of w.joints) if (!j.broken) energy += j.energy(w);
      const cell: Cell = { defined: true, value: { ...s, time: this.t0 + this.n / this.rate, energy, momentumX: px, momentumY: py, awake: w.awakeCount(), contacts: w.contactCount } satisfies WorldValue };
      this.put(this.worldRec, cell, changed);
    }
    return changed;
  }

  /** A point of body i in its frame, in the world at the drawn pose. */
  private drawnPoint(i: number, l: readonly number[], alpha: number): V3 {
    const { p, q } = this.pose(i, alpha);
    const [x, y, z] = rotate(q, l[0] as number, l[1] as number, l[2] as number);
    return { x: p.x + x, y: p.y + y, z: p.z + z };
  }

  /** Joints: what they carry and where their ends are; wheels: where they are and how they turn; cars: their speed. */
  private writeLinks(alpha: number, changed: ObjRec[]): void {
    const w = this.world as World3;
    const h = 1 / this.rate;
    const put = (rec: ObjRec, item: number | undefined, value: unknown, groups: Map<ObjRec, unknown[]>, all: () => unknown[]): void => {
      if (item === undefined) {
        this.put(rec, value === undefined ? { defined: false, reason: 'broken' } : { defined: true, value }, changed);
        return;
      }
      const arr = groups.get(rec) ?? all().slice();
      arr[item] = value;
      groups.set(rec, arr);
    };
    const jl = new Map<ObjRec, unknown[]>();
    for (const jm of this.jointMembers) {
      const j = jm.joint;
      const a = this.drawnPoint(j.a, j.la, alpha);
      const b = this.drawnPoint(j.b, j.lb, alpha);
      const value: JointValue3 = {
        ...jm.value, force: j.broken ? 0 : j.force(h), lengthNow: jm.value.kind === 'hinge' || jm.value.kind === 'weld' ? 0 : j.length(w), angleNow: j instanceof Hinge3 ? j.angle(w) : 0, broken: j.broken,
        ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z,
      };
      put(jm.rec, jm.item, value, jl, () => this.jointsOf(jm.rec));
    }
    for (const [rec, arr] of jl) this.put(rec, { defined: true, value: arr }, changed);
    const wl = new Map<ObjRec, unknown[]>();
    for (const wm of this.wheelMembers) {
      const j = wm.joint;
      if (j.broken) {
        // a wheel that came off is no longer a wheel: its value is undefined, and the car draws it where it is
        const t = this.brokeAt.get(j);
        const detail = `it came off at t = ${t === undefined ? '?' : Number((this.t0 + t / this.rate).toFixed(3))} s, when its spring pushed over ${num(wm.value.breaks)} N`;
        if (wm.item === undefined) this.put(wm.rec, { defined: false, reason: 'broken', detail }, changed);
        else put(wm.rec, wm.item, undefined, wl, () => this.wheelsOf(wm.rec));
        continue;
      }
      const d = j.spec.steers ? j.steer : 0;
      const cd = d === 0 ? 1 : cos(d);
      const sd = d === 0 ? 0 : sin(d);
      const l = Math.max(0, j.susp);
      const m = j.mount;
      const c = this.drawnPoint(wm.chassis, [m[0] as number, m[1] as number, (m[2] as number) - l], alpha);
      const { q } = this.pose(wm.chassis, alpha);
      const ct = cos(j.turn);
      const st = sin(j.turn);
      const [ax, ay, az] = rotate(q, -sd, cd, 0);
      const [sx, sy, sz] = rotate(q, st * cd, st * sd, ct);
      const value: Wheel3Value = { ...wm.value, x: c.x, y: c.y, z: c.z, axle: { x: ax, y: ay, z: az }, spoke: { x: sx, y: sy, z: sz }, spin: j.spin, push: j.push, touching: j.touching };
      put(wm.rec, wm.item, value, wl, () => this.wheelsOf(wm.rec));
    }
    for (const [rec, arr] of wl) this.put(rec, { defined: true, value: arr }, changed);
    for (const r of this.vehicleRecs) {
      const v = this.vehicleOf(r);
      if (!v) continue;
      const wheels = this.carWheels.get(r.id) ?? [];
      const c = wheels[0]?.chassis ?? this.endIndex(v.chassis, this.members);
      let speed = 0;
      if (c !== undefined) {
        const f = rotate([w.q[c * 4] as number, w.q[c * 4 + 1] as number, w.q[c * 4 + 2] as number, w.q[c * 4 + 3] as number], 1, 0, 0);
        speed = f[0] * (w.v[c * 3] as number) + f[1] * (w.v[c * 3 + 1] as number) + f[2] * (w.v[c * 3 + 2] as number);
      }
      const loose: LooseWheel[] = [];
      for (const wm of wheels) {
        const b = wm.joint.body;
        if (!wm.joint.broken || b < 0 || w.gone.has(b)) continue;
        const { p, q } = this.pose(b, alpha);
        const [ax, ay, az] = rotate(q, 0, 1, 0);
        const [sx, sy, sz] = rotate(q, 0, 0, 1);
        loose.push({ x: p.x, y: p.y, z: p.z, axle: { x: ax, y: ay, z: az }, spoke: { x: sx, y: sy, z: sz }, r: wm.value.r });
      }
      this.put(r, { defined: true, value: { ...v, speedometer: speed, loose } satisfies Vehicle3Value }, changed);
    }
  }

  private put(rec: ObjRec, cell: Cell, changed: ObjRec[]): void {
    this.lastCells.set(rec.id, cell);
    this.written.add(rec.id);
    if (this.acc.write(rec, cell)) changed.push(rec);
  }

  /* ------------------------------ for actions ------------------------------ */

  memberOf(id: ObjId, item?: number): Member3 | undefined {
    for (const m of this.members) if (m.rec.id === id && m.item === item && m.role === 'body') return m;
    return undefined;
  }

  ownerOf(spec: BodySpec3): { id: ObjId; item?: number } | undefined {
    for (const m of this.members) if (m.spec === spec) return { id: m.rec.id, ...(m.item !== undefined ? { item: m.item } : {}) };
    return undefined;
  }

  push(id: ObjId, j: V3, at?: V3, item?: number): boolean {
    if (!this.memberOf(id, item)) return false;
    this.addEntry({ kind: 'push', n: this.gridAt(this.acc.clockT()), id, ...(item !== undefined ? { item } : {}), j, ...(at ? { at } : {}) });
    return true;
  }

  /** The learner takes hold of a body at a point in space (or keeps the point taken) and moves it to `to`. */
  grab(id: ObjId, to: V3, at?: V3, item?: number): boolean {
    const m = this.memberOf(id, item);
    if (!m || !this.world) return false;
    const mine = (e: LogEntry3): boolean => (e.kind === 'grab' || e.kind === 'release') && e.id === id && e.item === item;
    const last = this.log.filter(mine).at(-1);
    let a: V3;
    if (last && last.kind === 'grab') a = last.a;
    else {
      const p = at ?? to;
      const l = this.world.toLocal(m.index, p.x, p.y, p.z);
      a = { x: l[0], y: l[1], z: l[2] };
    }
    this.addEntry({ kind: 'grab', n: this.gridAt(this.acc.clockT()), id, ...(item !== undefined ? { item } : {}), to, a });
    return true;
  }

  release(id: ObjId, item?: number): void {
    if (!this.memberOf(id, item)) return;
    this.addEntry({ kind: 'release', n: this.gridAt(this.acc.clockT()), id, ...(item !== undefined ? { item } : {}) });
  }

  restart(): void {
    this.addEntry({ kind: 'reset', n: this.gridAt(this.acc.clockT()) });
  }

  wake(id: ObjId, awake: boolean, item?: number): boolean {
    const m = this.memberOf(id, item);
    if (!m || !this.world) return false;
    if (awake) this.world.wakeBody(m.index);
    else this.world.sleepBody(m.index);
    return true;
  }

  indexOf(id: ObjId): number | undefined {
    return this.byId.get(id)?.index;
  }

  contactPoints(): { x: number; y: number; z: number; nx: number; ny: number; nz: number }[] {
    return this.world ? this.world.contactPoints() : [];
  }

  stepsPerSecond(): number {
    return this.rate;
  }
}

/** A wheel, or a list of wheels, in space. */
function isWheel3Rec(r: ObjRec): boolean {
  const t = r.p.type;
  return t.k === 'Wheel3' || (t.k === 'List' && t.of?.k === 'Wheel3');
}

/** A joint, or a list of joints. */
function isJointRec(r: ObjRec): boolean {
  const t = r.p.type;
  return t.k === 'Joint' || (t.k === 'List' && t.of?.k === 'Joint');
}

/** What a joint in space is built from: equal keys give the same joint. */
function jointKey3(j: JointValue3): unknown[] {
  const end = (e: JointValue3['a']): unknown => (e.spec ? `s${specKey(e.spec)}` : `i${e.id ?? -1}`);
  return [j.kind, end(j.a), end(j.b), j.pa.x, j.pa.y, j.pa.z, j.pb.x, j.pb.y, j.pb.z, j.axis?.x, j.axis?.y, j.axis?.z, j.length, j.k, j.rest, j.damping, j.motor, j.torque, j.min, j.max, j.breaks];
}

/** A joint in space between world bodies a and b, its anchors taken where they are at the start. */
function buildJoint3(w: World3, j: JointValue3, a: number, b: number): AnyJoint3 {
  const la = w.toLocal(a, j.pa.x, j.pa.y, j.pa.z);
  const lb = w.toLocal(b, j.pb.x, j.pb.y, j.pb.z);
  const ax: [number, number, number] = [j.axis?.x ?? 1, j.axis?.y ?? 0, j.axis?.z ?? 0];
  const o = <K extends string>(k: K, v: number | undefined): Partial<Record<K, number>> => (v === undefined ? {} : ({ [k]: v } as Record<K, number>));
  let joint: AnyJoint3;
  switch (j.kind) {
    case 'hinge':
      joint = new Hinge3(w, a, b, la, lb, ax, { ...o('motor', j.motor), ...o('torque', j.torque), ...o('min', j.min), ...o('max', j.max) });
      break;
    case 'spring':
      joint = new Distance3(a, b, la, lb, 'spring', j.rest ?? 0, j.k ?? 50, j.damping ?? 0);
      break;
    case 'rope':
      joint = new Distance3(a, b, la, lb, 'rope', j.length ?? 1);
      break;
    case 'rod':
      joint = new Distance3(a, b, la, lb, 'rod', j.length ?? 1);
      break;
    case 'slider':
      joint = new Slider3(w, a, b, la, lb, ax, { ...o('min', j.min), ...o('max', j.max), ...o('motor', j.motor), ...o('force', j.torque) });
      break;
    default:
      joint = new Weld3(w, a, b, la, lb, j.breaks ?? 0);
      break;
  }
  if (j.breaks !== undefined && j.kind !== 'weld') joint.breaks = j.breaks;
  return joint;
}

/** A wheel as a free body: a round slab of `ROUND_SIDES` sides about the y axis, centred at c. */
function wheelSlab(c: V3, r: number, width: number): ShapeDef3 {
  const n = ROUND_SIDES;
  const verts: V3[] = [];
  for (const y of [c.y - width / 2, c.y + width / 2]) {
    for (let k = 0; k < n; k++) {
      // the corners by the exact maths: the turn about y of the unit x axis
      const q = quatAxis(0, 1, 0, (2 * Math.PI * k) / n);
      const cs = q[0] * q[0] - q[2] * q[2];
      const sn = 2 * q[0] * q[2];
      verts.push({ x: c.x + r * cs, y, z: c.z - r * sn });
    }
  }
  const faces: number[][] = [];
  // the side at −y seen from outside, then the one at +y, then the rim
  faces.push(Array.from({ length: n }, (_, k) => n - 1 - k));
  faces.push(Array.from({ length: n }, (_, k) => n + k));
  for (let k = 0; k < n; k++) faces.push([k, (k + 1) % n, n + ((k + 1) % n), n + k]);
  return { kind: 'hull', verts, faces };
}

/** Body properties a `with` line may set on a body in space. */
export const BODY3_PROPS = ['bounce', 'friction', 'force', 'torque', 'group'] as const;

function isGround(r: ObjRec): boolean {
  const n = r.p.node;
  return n.k === 'define' && n.expr.k === 'call' && n.expr.callee === 'Ground';
}

function asV3(v: unknown): V3 | undefined {
  const p = v as { x?: unknown; y?: unknown; z?: unknown } | undefined;
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') return undefined;
  const z = typeof p.z === 'number' ? p.z : 0;
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(z) ? { x: p.x, y: p.y, z } : undefined;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

const num = (x: number): string => String(Number(x.toPrecision(10)));

/** A vector turned by the quaternion q (w, x, y, z). */
function rotate(q: readonly number[], x: number, y: number, z: number): [number, number, number] {
  const [qw, qx, qy, qz] = q as [number, number, number, number];
  return [
    (1 - 2 * (qy * qy + qz * qz)) * x + 2 * (qx * qy - qw * qz) * y + 2 * (qx * qz + qw * qy) * z,
    2 * (qx * qy + qw * qz) * x + (1 - 2 * (qx * qx + qz * qz)) * y + 2 * (qy * qz - qw * qx) * z,
    2 * (qx * qz - qw * qy) * x + 2 * (qy * qz + qw * qx) * y + (1 - 2 * (qx * qx + qy * qy)) * z,
  ];
}

function numWords(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return num(v);
  const p = v as { x?: unknown; y?: unknown } | undefined;
  if (p && typeof p.x === 'number' && typeof p.y === 'number') return `${num(p.x)} ${num(p.y)}`;
  return undefined;
}

function sameSpec3(a: unknown, b: unknown): boolean {
  return isBody3Value(a) && isBody3Value(b) && (a.spec === b.spec || sameValue(a.spec, b.spec));
}
