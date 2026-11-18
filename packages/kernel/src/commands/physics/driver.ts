/**
 * The physics driver of a figure (docs/features/physics/design.md 5 and 10; .kiro/specs/physics core hooks 1 to 5).
 *
 * After each update pass it reads the figure's bodies, solid shapes and `world`, builds the world when any of them
 * changed, steps it on a fixed grid to the clock (from the nearest checkpoint), and writes each body's pose into its
 * cell, so other lines can read it. Inputs that change during the film (a mover that reads `t`, a property formula, a
 * slider logged with `rerun = continue`, a grab, a push) are evaluated or applied at each step time, so a replay, a seek
 * and a reload all give the same film.
 */
import type { Notice } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import { makeNotice } from '../../errors/notices';
import type { ObjRec } from '../../graph/core';
import type { WorldDriver } from '../../graph/drivers';
import type { DriverAccess, Figure } from '../../graph/figure';
import type { Cell, StyleEntry } from '../../graph/types';
import { sameValue } from '../../graph/values';
import type { BodyDef2, ShapeDef2 } from '../../physics/world2';
import { BodyType, FK, FORCE_KINDS, World2 } from '../../physics/world2';
import { atan2, cos, sin } from '../../physics/math';
import { solidShapeOf } from './shapes';
import type { BodySpec, BodyValue, WorldValue } from './types';
import { DEFAULT_WORLD, collectBuffers, isBodyValue, isWorldValue } from './types';
import type { JointEnd, JointValue } from './joints';
import { isJointValue } from './joints';
import type { JointMember } from './jointbuild';
import { buildJoint, jointKey, jointNow, specKey } from './jointbuild';
import type { Hinge2, Slider2, Grab2 } from '../../physics/joints2';
import { Wheel2, localAnchor } from '../../physics/joints2';
import type { VehicleValue, WheelValue } from './vehicle';
import { isVehicleValue, isWheelValue } from './vehicle';
import { isSpaceWorld } from './driver3';
import { getStoredHandler } from '../numbers/handlers';
import { runHandler } from '../numbers/run';
import type { DropSource2 } from '../../physics/fluid2';
import { DEFAULT_SPACING, Fluid2, fillRegion, spacingFor } from '../../physics/fluid2';
import type { Water2 } from '../../physics/water2';
import { WaterForces, waterClip } from '../../physics/water2';
import type { LiquidValue, WaterValue, WavesValue } from './liquid';
import { isLiquidValue, isWaterValue, isWavesValue } from './liquid';
import { WaveGrid } from '../../physics/waves';
import type { Smoke2 } from '../../physics/smoke2';
import type { SmokeValue } from './smoke';
import { isSmokeValue, smokeGrid, smokeValue } from './smoke';
import { Cloth2 } from '../../physics/cloth2';
import type { PinDef } from '../../physics/cloth';
import type { ClothSpec, ClothValue } from './cloth';
import { clothDef, isClothValue, isPinValue } from './cloth';

/** Smoke steps 60 times a second of film, whatever the bodies' step (design 9.4). */
const SMOKE_RATE = 60;

/** Checkpoints every half second of film (design 10.3). */
const CHECKPOINT_SECONDS = 0.5;
/** With cloth, a checkpoint every 0.25 s (design 10.3). */
const CLOTH_CHECKPOINT_SECONDS = 0.25;
/** Memory for checkpoints per figure, in bytes (design 10.3). */
export const CHECKPOINT_BYTES = 32 * 1024 * 1024;
/** Body steps one pass may take before it shows where it got to and catches up on the next frames (design 10.4). */
const STEP_BUDGET = 60000;
const BLOW_UP = 1e6;

export type LogEntry =
  | { readonly kind: 'push'; readonly n: number; readonly id: ObjId; readonly item?: number; readonly x: number; readonly y: number; readonly ax?: number; readonly ay?: number }
  | { readonly kind: 'grab'; readonly n: number; readonly id: ObjId; readonly item?: number; readonly x: number; readonly y: number; readonly ax: number; readonly ay: number }
  | { readonly kind: 'release'; readonly n: number; readonly id: ObjId; readonly item?: number }
  | { readonly kind: 'set'; readonly n: number; readonly id: ObjId; readonly value: unknown }
  | { readonly kind: 'reset'; readonly n: number }
  | { readonly kind: 'cgrab'; readonly n: number; readonly id: ObjId; readonly point: number; readonly x: number; readonly y: number }
  | { readonly kind: 'crelease'; readonly n: number; readonly id: ObjId; readonly point: number };

/** Body properties a `with` line may set (design 2.4). */
export const BODY_PROPS = ['bounce', 'friction', 'force', 'torque', 'bullet', 'group', 'charge'] as const;

interface Member {
  readonly rec: ObjRec;
  readonly role: 'body' | 'solid' | 'wheel';
  /** Index in the world. */
  readonly index: number;
  readonly spec?: BodySpec;
  /** A solid's shape count, to tell whether a new shape fits in place. */
  readonly shapeCount?: number;
  /** True when a solid's shape changes during the film. */
  readonly moving: boolean;
  /** For a body in a list of bodies: its place in the list, and the list's length. */
  readonly item?: number;
  readonly items?: number;
}

interface Grab {
  x: number;
  y: number;
  ax: number;
  ay: number;
}

export class PhysicsDriver implements WorldDriver {
  private readonly acc: DriverAccess;
  private version = -1;
  private bodyRecs: ObjRec[] = [];
  private solidRecs: ObjRec[] = [];
  private jointRecs: ObjRec[] = [];
  private wheelRecs: ObjRec[] = [];
  private vehicleRecs: ObjRec[] = [];
  private wheelSpecs = new Map<ObjId, (WheelValue | undefined)[]>();
  private vehicleSpecs = new Map<ObjId, VehicleValue>();
  wheelMembers: { readonly rec: ObjRec; readonly item?: number; readonly value: WheelValue; readonly index: number; readonly chassis: number; readonly joint: Wheel2 }[] = [];
  private vehicleInputs = new Set<ObjId>();
  /** The value each joint's rule gave (its start), or each item of a list of joints. */
  private jointSpecs = new Map<ObjId, (JointValue | undefined)[]>();
  jointMembers: (JointMember & { readonly rec: ObjRec })[] = [];
  private worldRec: ObjRec | undefined;
  /** Liquids and still water (design 9.1, 9.2), the start each liquid's rule gave, and the drops of the world. */
  private liquidRecs: ObjRec[] = [];
  private waterRecs: ObjRec[] = [];
  private liquidSpecs = new Map<ObjId, LiquidValue>();
  fluid: Fluid2 | undefined;
  /** Each liquid object and its owner number in the drops. */
  liquidMembers: { readonly rec: ObjRec; readonly owner: number; readonly value: LiquidValue }[] = [];
  private waters: Water2[] = [];
  private waterForces = new WaterForces();
  /** Waves in the plane (round 7, design 9.3): a line of heights along a segment. */
  private wavesRecs: ObjRec[] = [];
  private wavesSpecs = new Map<ObjId, WavesValue>();
  waveMembers: { readonly rec: ObjRec; readonly value: WavesValue; readonly grid: WaveGrid }[] = [];
  /** Smoke grids (design 9.4): the start each smoke's rule gave, and each grid, in figure order. */
  private smokeRecs: ObjRec[] = [];
  private smokeSpecs = new Map<ObjId, SmokeValue>();
  smokeMembers: { readonly rec: ObjRec; value: SmokeValue; readonly grid: Smoke2 }[] = [];
  /** Bodies' steps per smoke step. */
  private smokeEvery = 2;
  /** The value each body's rule gave (its start), kept because the cell holds the pose. */
  private specs = new Map<ObjId, BodyValue>();
  private worldSettings: WorldValue | undefined;
  private written = new Set<ObjId>();
  private sig: unknown[] | undefined;
  world: World2 | undefined;
  members: Member[] = [];
  private byId = new Map<ObjId, Member>();
  private nameOfIndex: string[] = [];
  private rate = 120;
  private t0 = 0;
  /** Steps the world has taken. */
  n = 0;
  private prevX = new Float64Array(0);
  private prevY = new Float64Array(0);
  private prevA = new Float64Array(0);
  private checkpoints = new Map<number, Float64Array>();
  private cpStride = 60;
  private cpBytes = 0;
  private log: LogEntry[] = [];
  private base = new Map<ObjId, unknown>();
  private grabs = new Map<number, Grab>();
  /** Objects whose values change during the film, in order: recomputed at each step time. */
  private cone: ObjRec[] = [];
  private varyingStyle: { member: Member; entry: StyleEntry }[] = [];
  private varyingWorld = false;
  private readsBodies = false;
  private short = false;
  private catching: { from: number; to: number } | undefined;
  private warnings: Notice[] = [];
  private warned = new Set<string>();
  private failedAt = new Map<number, number>();
  private leftAt = new Map<number, number>();
  /** Hits of the steps taken in the last pass, for `on … hit` handlers. */
  hits: { readonly t: number; readonly a: string; readonly b: string; readonly speed: number; readonly x: number; readonly y: number; readonly impulse: number }[] = [];
  /** Time of the last step taken, so hits are reported once. */
  private sampling = false;
  private pendingHits: PhysicsDriver['hits'] = [];
  private brokeAt = new WeakMap<object, number>();
  /** Joints that broke, for the teacher's `figure` result. */
  events: { readonly t: number; readonly kind: 'broken' | 'torn'; readonly name: string; readonly links?: number }[] = [];
  /* cloth in the plane (round 9; design 9.5, 9.6) */
  private clothRecs: ObjRec[] = [];
  private pinRecs: ObjRec[] = [];
  private clothSpecs = new Map<ObjId, ClothValue>();
  cloth: Cloth2 | undefined;
  clothMembers: { readonly rec: ObjRec; readonly value: ClothValue; readonly index: number }[] = [];
  private pinMembers: ObjRec[] = [];
  /** The furthest step ever taken: hits beyond it fire `on … hit` handlers, a replay before it does not fire them again. */
  frontier = 0;

  constructor(readonly figure: Figure) {
    this.acc = figure.driverAccess();
  }

  /* ------------------------------ the driver hooks ------------------------------ */

  onCompute(rec: ObjRec, computed: Cell): Cell | undefined {
    if (isWheelRec(rec)) {
      this.wheelSpecs.set(rec.id, computed.defined ? (Array.isArray(computed.value) ? (computed.value as unknown[]) : [computed.value]).map((v) => (isWheelValue(v) ? v : undefined)) : []);
      const last = this.lastCells.get(rec.id);
      return last && computed.defined && this.live() ? last : undefined;
    }
    if (rec.p.type.k === 'Vehicle') {
      if (computed.defined && isVehicleValue(computed.value)) this.vehicleSpecs.set(rec.id, computed.value);
      else this.vehicleSpecs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      return last && computed.defined && this.live() ? last : undefined;
    }
    if (isJointRec(rec)) {
      this.jointSpecs.set(rec.id, computed.defined ? (Array.isArray(computed.value) ? (computed.value as unknown[]) : [computed.value]).map((v) => (isJointValue(v) ? v : undefined)) : []);
      const last = this.lastCells.get(rec.id);
      return last && computed.defined && this.live() ? last : undefined;
    }
    if (rec.p.type.k === 'List' && rec.p.type.of?.k === 'Body') {
      if (computed.defined && Array.isArray(computed.value)) this.listSpecs.set(rec.id, (computed.value as unknown[]).map((v) => (isBodyValue(v) ? v : undefined)));
      else this.listSpecs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      if (last && computed.defined && this.live() && last.defined && Array.isArray(last.value) && Array.isArray(computed.value) && last.value.length === computed.value.length && (last.value as unknown[]).every((v, i) => sameSpec({ defined: true, value: v }, (computed.value as unknown[])[i]))) return last;
      return undefined;
    }
    if (rec.p.type.k === 'Body') {
      if (computed.defined && isBodyValue(computed.value)) this.specs.set(rec.id, computed.value);
      else this.specs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      if (last && computed.defined && this.live() && sameSpec(last, computed.value)) return last;
      return undefined;
    }
    if (rec.p.type.k === 'Cloth') {
      if (computed.defined && isClothValue(computed.value)) this.clothSpecs.set(rec.id, computed.value);
      else this.clothSpecs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      if (last && computed.defined && this.live() && last.defined && isClothValue(last.value) && isClothValue(computed.value) && sameValue(last.value.spec, computed.value.spec)) return last;
      return undefined;
    }
    if (rec.p.type.k === 'Smoke') {
      if (computed.defined && isSmokeValue(computed.value)) this.smokeSpecs.set(rec.id, computed.value);
      else this.smokeSpecs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      if (last && computed.defined && this.live() && last.defined && isSmokeValue(last.value) && isSmokeValue(computed.value) && sameValue(last.value.spec, computed.value.spec)) return last;
      return undefined;
    }
    if (rec.p.type.k === 'Liquid') {
      if (computed.defined && isLiquidValue(computed.value)) this.liquidSpecs.set(rec.id, computed.value);
      else this.liquidSpecs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      if (last && computed.defined && this.live() && last.defined && isLiquidValue(last.value) && isLiquidValue(computed.value) && sameValue(last.value.spec, computed.value.spec)) return last;
      return undefined;
    }
    if (rec.p.type.k === 'Waves') {
      if (computed.defined && isWavesValue(computed.value)) this.wavesSpecs.set(rec.id, computed.value);
      else this.wavesSpecs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      if (last && computed.defined && this.live() && last.defined && isWavesValue(last.value) && isWavesValue(computed.value) && sameValue(wavesKey2(last.value), wavesKey2(computed.value))) return last;
      return undefined;
    }
    if (rec.p.type.k === 'World') {
      if (computed.defined && isWorldValue(computed.value)) this.worldSettings = computed.value;
      const last = this.lastCells.get(rec.id);
      return last && computed.defined ? last : undefined;
    }
    return undefined;
  }

  private lastCells = new Map<ObjId, Cell>();

  noteFree(rec: ObjRec, was: unknown): void {
    if (!this.world) return;
    const t = this.acc.clockT();
    if (t <= this.t0 + 1e-12) return;
    if (!this.inputs.has(rec.id)) return;
    // a mover's point moves the mover from now on; a slider follows its rerun policy
    const policy = (this.moverInputs.has(rec.id) || this.vehicleInputs.has(rec.id)) && !this.startInputs.has(rec.id) ? 'continue' : this.acc.rerunOf(rec);
    if (policy !== 'continue' || this.startInputs.has(rec.id)) return;
    if (!this.base.has(rec.id)) this.base.set(rec.id, was);
    this.addEntry({ kind: 'set', n: this.gridAt(t), id: rec.id, value: rec.p.value });
    this.logged.add(rec.id);
    this.coneDirty = true;
  }

  inputLine(words: readonly string[]): string | undefined | false {
    if (words[0] !== 'physics') return false;
    if (isSpaceWorld(this.acc.list)) return false;
    const kind = words[1];
    const at = Number(words[words.length - 1]);
    if (words[words.length - 2] !== 'at' || !Number.isFinite(at)) return 'a time at the end: @input physics push b 1 0 at 2.5';
    const n = Math.max(0, Math.round((at - this.t0) * this.rate));
    if (kind === 'reset') {
      this.addEntry({ kind: 'reset', n });
      return undefined;
    }
    const nameWord = words[2] ?? '';
    const listed = /^(.+)\[(\d+)\]$/.exec(nameWord);
    const rec = this.acc.byName(listed ? (listed[1] as string) : nameWord);
    if (!rec) return `an object named ${nameWord}`;
    if (rec.p.type.k === 'Cloth') {
      const cn = words.slice(3, -2).map(Number);
      const point = cn[0];
      if (point === undefined || !Number.isInteger(point) || point < 0 || cn.some((x) => !Number.isFinite(x))) return 'a point index: @input physics grab rope 12 1 2 at 2.5';
      if (kind === 'grab' && cn.length >= 3) this.addEntry({ kind: 'cgrab', n, id: rec.id, point, x: cn[1] as number, y: cn[2] as number });
      else if (kind === 'release') this.addEntry({ kind: 'crelease', n, id: rec.id, point });
      else return 'grab or release, with the point index and two numbers';
      return undefined;
    }
    const item = listed ? Number(listed[2]) - 1 : undefined;
    const it = item !== undefined ? { item } : {};
    const isBase = words[3] === 'base';
    const nums = words.slice(isBase ? 4 : 3, -2).map(Number);
    if (nums.some((x) => !Number.isFinite(x))) return 'numbers';
    if (kind === 'push' && nums.length >= 2) this.addEntry({ kind: 'push', n, id: rec.id, ...it, x: nums[0] as number, y: nums[1] as number, ...(nums.length >= 4 ? { ax: nums[2] as number, ay: nums[3] as number } : {}) });
    else if (kind === 'grab' && nums.length >= 4) this.addEntry({ kind: 'grab', n, id: rec.id, ...it, x: nums[0] as number, y: nums[1] as number, ax: nums[2] as number, ay: nums[3] as number });
    else if (kind === 'release') this.addEntry({ kind: 'release', n, id: rec.id, ...it });
    else if (kind === 'set' && nums.length >= 1) {
      const value = nums.length >= 2 ? { x: nums[0] as number, y: nums[1] as number } : nums[0];
      if (isBase) this.base.set(rec.id, value);
      else {
        if (!this.base.has(rec.id)) this.base.set(rec.id, rec.p.value);
        this.addEntry({ kind: 'set', n, id: rec.id, value });
        this.logged.add(rec.id);
        this.coneDirty = true;
      }
    } else return 'push, grab, release, set or reset';
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
    if (this.remote) return this.remoteCells.has(this.acc.byId(id)?.p.name ?? '');
    return this.byId.has(id) || this.worldRec?.id === id || this.liquidMembers.some((l) => l.rec.id === id) || this.waveMembers.some((m) => m.rec.id === id) || this.smokeMembers.some((s) => s.rec.id === id) || this.clothMembers.some((c) => c.rec.id === id) || this.pinMembers.some((r) => r.id === id);
  }

  sampleRecs(): readonly ObjRec[] {
    return [...new Set(this.members.filter((m) => m.role === 'body').map((m) => m.rec))];
  }

  /** The bodies' cells at a film time, without moving the film (traces and `ValueAt` read it). */
  sample(t: number): readonly (readonly [ObjRec, Cell])[] | undefined {
    if (!this.world) return undefined;
    const keep = this.saveState();
    const keepN = this.n;
    this.sampling = true;
    const kx = Float64Array.from(this.prevX);
    const ky = Float64Array.from(this.prevY);
    const ka = Float64Array.from(this.prevA);
    try {
      const { nTarget, alpha } = this.gridFor(t);
      this.advance(nTarget, Infinity);
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
      this.loadState(keep);
      this.n = keepN;
      this.prevX = kx;
      this.prevY = ky;
      this.prevA = ka;
    }
  }

  /* ------------------------------ after each pass ------------------------------ */

  afterPass(): readonly ObjRec[] {
    this.scan();
    if (this.remote) return this.writeRemote();
    if (this.bodyRecs.length === 0 && this.solidRecs.length === 0 && this.liquidRecs.length === 0 && this.wavesRecs.length === 0 && this.smokeRecs.length === 0 && this.clothRecs.length === 0 && !this.world) return [];
    if (this.coneDirty) this.findCone();
    const sig = this.signature();
    if (!this.sig || !sameValue(this.sig, sig)) {
      this.sig = sig;
      this.build();
    }
    if (!this.world) return this.writeEmpty();
    const { nTarget, alpha } = this.gridFor(this.acc.clockT());
    this.hits = [];
    this.advance(nTarget, STEP_BUDGET);
    return this.writeCells(this.short ? 1 : alpha);
  }

  /** The step the clock is in and how far through it the clock is. */
  private gridFor(t: number): { nTarget: number; alpha: number } {
    const ft = Math.max(0, (t - this.t0) * this.rate);
    const nTarget = Math.max(0, Math.ceil(ft - 1e-9));
    const alpha = nTarget === 0 ? 1 : Math.min(1, Math.max(0, ft - (nTarget - 1)));
    return { nTarget, alpha };
  }

  private gridAt(t: number): number {
    return Math.max(0, Math.ceil((t - this.t0) * this.rate - 1e-9));
  }

  /** Reads which objects take part. Cheap when the figure's structure has not changed. */
  private scan(): void {
    const v = this.acc.version();
    if (v === this.version) return;
    this.version = v;
    this.bodyRecs = [];
    this.solidRecs = [];
    this.jointRecs = [];
    this.wheelRecs = [];
    this.vehicleRecs = [];
    this.liquidRecs = [];
    this.waterRecs = [];
    this.wavesRecs = [];
    this.smokeRecs = [];
    this.clothRecs = [];
    this.pinRecs = [];
    this.worldRec = undefined;
    this.coneDirty = true;
    // a figure with a body in space is a world in space: its driver takes the world, the ground and the solids
    if (isSpaceWorld(this.acc.list)) return;
    for (const r of this.acc.list) {
      const k = r.p.type.k;
      if (k === 'Liquid') this.liquidRecs.push(r);
      else if (k === 'Cloth') this.clothRecs.push(r);
      else if (k === 'Pin') this.pinRecs.push(r);
      else if (k === 'Smoke') this.smokeRecs.push(r);
      else if (k === 'Water') this.waterRecs.push(r);
      else if (k === 'Waves') this.wavesRecs.push(r);
      else if (isJointRec(r)) this.jointRecs.push(r);
      else if (isWheelRec(r)) this.wheelRecs.push(r);
      else if (k === 'Vehicle') this.vehicleRecs.push(r);
      else if (k === 'Body' || (k === 'List' && r.p.type.of?.k === 'Body')) this.bodyRecs.push(r);
      else if (k === 'World') this.worldRec = r;
      else if (r.p.style.has('solid') || isGround(r)) this.solidRecs.push(r);
    }
    this.coneDirty = true;
  }

  private coneDirty = true;
  private logged = new Set<ObjId>();
  /** Free objects any physics input reads, those that set the start, and those that only move a solid. */
  private inputs = new Set<ObjId>();
  private startInputs = new Set<ObjId>();
  private moverInputs = new Set<ObjId>();

  /** Is the solid on now (`with solid = true`, or a formula)? */
  private solidOn(r: ObjRec): boolean {
    const e = r.p.style.get('solid');
    if (!e) return isGround(r);
    if (e.eval === undefined) return e.value === true || e.word === 'true';
    this.acc.ensureSlots(r.p.checked.slots);
    this.acc.env.reason = undefined;
    return e.eval(this.acc.env) === true;
  }

  private specOf(r: ObjRec): BodyValue | undefined {
    const s = this.specs.get(r.id);
    if (s) return s;
    if (!this.written.has(r.id) && r.cell.defined && isBodyValue(r.cell.value)) {
      this.specs.set(r.id, r.cell.value);
      return r.cell.value;
    }
    return undefined;
  }

  /** The bodies of a list of bodies (`Bodies(...)`), each its start; undefined items stay out. */
  private specsOfList(r: ObjRec): (BodyValue | undefined)[] {
    const s = this.listSpecs.get(r.id);
    if (s) return s;
    if (!this.written.has(r.id) && r.cell.defined && Array.isArray(r.cell.value)) {
      const list = (r.cell.value as unknown[]).map((v) => (isBodyValue(v) ? v : undefined));
      this.listSpecs.set(r.id, list);
      return list;
    }
    return [];
  }

  private listSpecs = new Map<ObjId, (BodyValue | undefined)[]>();

  private wheelsOf(r: ObjRec): (WheelValue | undefined)[] {
    const s = this.wheelSpecs.get(r.id);
    if (s) return s;
    if (this.written.has(r.id) || !r.cell.defined) return [];
    const list = (Array.isArray(r.cell.value) ? (r.cell.value as unknown[]) : [r.cell.value]).map((v) => (isWheelValue(v) ? v : undefined));
    this.wheelSpecs.set(r.id, list);
    return list;
  }

  private vehicleOf(r: ObjRec): VehicleValue | undefined {
    const s = this.vehicleSpecs.get(r.id);
    if (s) return s;
    if (!this.written.has(r.id) && r.cell.defined && isVehicleValue(r.cell.value)) {
      this.vehicleSpecs.set(r.id, r.cell.value);
      return r.cell.value;
    }
    return undefined;
  }

  /** The joints of a joint object (one, or each of a list), as their rules gave them. */
  private jointsOf(r: ObjRec): (JointValue | undefined)[] {
    const s = this.jointSpecs.get(r.id);
    if (s) return s;
    if (this.written.has(r.id) || !r.cell.defined) return [];
    const list = (Array.isArray(r.cell.value) ? (r.cell.value as unknown[]) : [r.cell.value]).map((v) => (isJointValue(v) ? v : undefined));
    this.jointSpecs.set(r.id, list);
    return list;
  }

  /** A liquid's start, as its rule gave it. */
  private liquidOf(r: ObjRec): LiquidValue | undefined {
    const s = this.liquidSpecs.get(r.id);
    if (s) return s;
    if (!this.written.has(r.id) && r.cell.defined && isLiquidValue(r.cell.value)) {
      this.liquidSpecs.set(r.id, r.cell.value);
      return r.cell.value;
    }
    return undefined;
  }

  private wavesOf(r: ObjRec): WavesValue | undefined {
    const s = this.wavesSpecs.get(r.id);
    const v = s ?? (!this.written.has(r.id) && r.cell.defined && isWavesValue(r.cell.value) ? r.cell.value : undefined);
    if (!v || v.space) return undefined;
    if (!s) this.wavesSpecs.set(r.id, v);
    return v;
  }

  /** A smoke grid's start, as its rule gave it. */
  private smokeOf(r: ObjRec): SmokeValue | undefined {
    const s = this.smokeSpecs.get(r.id);
    if (s) return s;
    if (!this.written.has(r.id) && r.cell.defined && isSmokeValue(r.cell.value)) {
      this.smokeSpecs.set(r.id, r.cell.value);
      return r.cell.value;
    }
    return undefined;
  }

  private waterOf(r: ObjRec): WaterValue | undefined {
    return r.cell.defined && isWaterValue(r.cell.value) ? r.cell.value : undefined;
  }

  private settings(): WorldValue {
    if (!this.worldRec) return DEFAULT_WORLD;
    if (this.worldSettings) return this.worldSettings;
    const c = this.worldRec.cell;
    return c.defined && isWorldValue(c.value) ? c.value : DEFAULT_WORLD;
  }

  /** What the world is built from: when it changes, the film starts again from its start. */
  private signature(): unknown[] {
    const sig: unknown[] = [this.acc.t0(), this.acc.solverStepsPerSecond()];
    const w = this.settings();
    sig.push(this.varyingWorld ? 'varying' : [w.gx, w.gy, w.air, w.passes, w.rate, w.sleep, w.range, w.windX, w.windY]);
    for (const r of this.bodyRecs) {
      if (r.p.type.k === 'List') {
        sig.push(r.id, this.bodyVaries.has(r) ? this.members.filter((m) => m.rec === r).map((m) => m.spec) : this.specsOfList(r).map((b) => (b ? b.spec : null)));
        continue;
      }
      const frozen = this.bodyVaries.has(r) ? this.byId.get(r.id)?.spec : undefined;
      const s = frozen ? undefined : this.specOf(r);
      sig.push(r.id, frozen ?? (s ? s.spec : null));
      for (const k of BODY_PROPS) {
        const e = r.p.style.get(k);
        if (!e) continue;
        sig.push(k, e.text, this.isVarying(e) ? 'varying' : this.evalStyle(r, e));
      }
    }
    for (const r of this.solidRecs) {
      const on = this.solidOn(r);
      sig.push(r.id, on);
      if (!on) continue;
      sig.push(this.varySet.has(r) ? 'moving' : r.cell.defined ? r.cell.value : null);
      for (const k of ['bounce', 'friction'] as const) {
        const e = r.p.style.get(k);
        if (e) sig.push(k, e.text, this.isVarying(e) ? 'varying' : this.evalStyle(r, e));
      }
    }
    for (const r of this.wheelRecs) sig.push(r.id, this.wheelsOf(r).map((w) => (w ? [w.chassis.spec ? specKey(w.chassis.spec) : w.chassis.id, w.at.x, w.at.y, w.r, w.spring, w.damping, w.travel, w.grip, w.drive, w.breaks, w.mass] : null)));
    for (const r of this.vehicleRecs) {
      const v = this.vehicleOf(r);
      sig.push(r.id, this.varySet.has(r) ? 'varying' : v ? [v.motor, v.brake, v.power, v.wheels.length] : null);
    }
    for (const r of this.jointRecs) {
      // a joint whose motor or target moves during the film is rebuilt only when its line changes
      if (this.varySet.has(r)) {
        sig.push(r.id, 'varying', r.p.compiled);
        continue;
      }
      sig.push(r.id, this.jointsOf(r).map((j) => (j ? jointKey(j) : null)));
    }
    for (const r of this.liquidRecs) sig.push(r.id, this.liquidOf(r)?.spec ?? null);
    // a smoke whose source or heat moves during the film is read at each step, and rebuilt only when its line changes
    for (const r of this.clothRecs) sig.push(r.id, this.clothOf(r)?.spec ?? null);
    for (const r of this.pinRecs) {
      const v = r.cell.defined && isPinValue(r.cell.value) ? r.cell.value : undefined;
      sig.push(r.id, v ? [v.point, v.cloth, v.body ? specKey(v.body as BodySpec) : null] : null);
    }
    for (const r of this.smokeRecs) {
      const sv = this.smokeOf(r);
      sig.push(r.id, this.varySet.has(r) ? ['varying', r.p.compiled, sv?.spec.n ?? null, sv?.spec.x0 ?? null, sv?.spec.y0 ?? null, sv?.spec.x1 ?? null, sv?.spec.y1 ?? null] : sv?.spec ?? null);
    }
    for (const r of this.waterRecs) {
      const wv = this.waterOf(r);
      sig.push(r.id, this.varySet.has(r) ? ['varying', r.p.compiled] : wv ? [wv.level, wv.region ?? null] : null);
    }
    for (const r of this.wavesRecs) {
      const v = this.wavesOf(r);
      sig.push(r.id, v ? wavesKey2(v) : null);
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

  /* ------------------------------ building the world ------------------------------ */

  private build(): void {
    const w = this.settings();
    this.rate = this.stepRate(w.rate);
    this.t0 = this.acc.t0();
    const defs: BodyDef2[] = [];
    const members: Member[] = [];
    // walls and bodies in figure order, so the order never depends on how the figure was built
    const recs = [...this.bodyRecs, ...this.solidRecs].sort((a, b) => a.order - b.order);
    for (const r of recs) {
      if (r.p.type.k === 'Body' || r.p.type.k === 'List') {
        const list = r.p.type.k === 'List' ? this.specsOfList(r) : [this.specOf(r)];
        for (let item = 0; item < list.length; item++) {
        const s = list[item];
        if (!s) continue;
        const sp = s.spec;
        const props = this.liveProps(r, sp);
        defs.push({
          type: sp.fixed ? BodyType.Static : BodyType.Dynamic,
          shapes: sp.shapes,
          ...(sp.mass !== undefined ? { mass: sp.mass } : {}),
          density: sp.density,
          vx: sp.vx,
          vy: sp.vy,
          w: sp.spin,
          friction: props.friction,
          bounce: props.bounce,
          turns: sp.turns,
          bullet: props.bullet,
          group: props.group,
          charge: props.charge,
        });
        members.push({ rec: r, role: 'body', index: defs.length - 1, spec: sp, moving: false, ...(r.p.type.k === 'List' ? { item, items: list.length } : {}) });
        }
      } else {
        if (!this.solidOn(r) || !r.cell.defined) continue;
        const sh = solidShapeOf(r.cell.value, w.range);
        if (!sh || sh.shapes.length === 0) continue;
        if (sh.sampled) this.warnOnce(`ground:${r.id}`, makeNotice('ground_sampled', { name: r.p.name, range: w.range }, [r.p.name]));
        // a solid without its own friction takes the body's (design 6.5); without its own bounce it adds none
        const fr = this.styleNumber(r, 'friction', Number.NaN);
        const bo = this.styleNumber(r, 'bounce', 0);
        defs.push({ type: BodyType.Kinematic, shapes: sh.shapes, friction: fr, bounce: bo });
        members.push({ rec: r, role: 'solid', index: defs.length - 1, shapeCount: sh.shapes.length, moving: false });
      }
    }
    // wheels: a round body each, on its chassis (design 8)
    const wheelDefs: { rec: ObjRec; item?: number; value: WheelValue; index: number; chassis: number }[] = [];
    for (const r of this.wheelRecs) {
      const list = this.wheelsOf(r);
      for (let item = 0; item < list.length; item++) {
        const wv = list[item];
        if (!wv) continue;
        const chassis = this.endIndex(wv.chassis, members);
        if (chassis === undefined) continue;
        const cm = members.find((m) => m.index === chassis)?.spec?.massNow ?? 10;
        defs.push({ type: BodyType.Dynamic, shapes: [{ kind: 'circle', x: wv.at.x, y: wv.at.y, r: wv.r }], mass: wv.mass ?? Math.max(0.5, cm * 0.04), friction: wv.grip, bounce: 0.1 });
        const index = defs.length - 1;
        members.push({ rec: r, role: 'wheel', index, moving: false, ...(r.p.type.k === 'List' ? { item } : {}) });
        wheelDefs.push({ rec: r, ...(r.p.type.k === 'List' ? { item } : {}), value: wv, index, chassis });
      }
    }
    if (defs.length === 0 && !this.liquidRecs.some((r) => this.liquidOf(r) !== undefined) && !this.wavesRecs.some((r) => this.wavesOf(r) !== undefined) && !this.smokeRecs.some((r) => this.smokeOf(r) !== undefined) && !this.clothRecs.some((r) => this.clothOf(r) !== undefined)) {
      this.world = undefined;
      this.fluid = undefined;
      this.cloth = undefined;
      this.clothMembers = [];
      this.smokeMembers = [];
      this.liquidMembers = [];
      this.waveMembers = [];
      this.members = [];
      this.byId = new Map();
      return;
    }
    const world = new World2(defs);
    world.gx = w.gx;
    world.gy = w.gy;
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
      const la = localAnchor(world, wd.chassis, wd.value.at.x, wd.value.at.y);
      const joint = new Wheel2(world, wd.chassis, wd.index, la, [0, -1], { spring: wd.value.spring, damping: wd.value.damping, travel: wd.value.travel });
      if (wd.value.breaks > 0) (joint as { breaks: number }).breaks = wd.value.breaks;
      world.joints.push(joint);
      this.wheelMembers.push({ ...wd, joint });
      this.nameOfIndex[wd.index] = wd.item !== undefined ? `${wd.rec.p.name}[${wd.item + 1}]` : wd.rec.p.name;
    }
    for (const m of members) if (m.role === 'body' && m.spec && m.spec.parts > 1) this.warnOnce(`split:${m.rec.id}:${m.spec.parts}`, makeNotice('split_shape', { name: m.rec.p.name, parts: m.spec.parts }, [m.rec.p.name]));
    this.buildWaves(world);
    this.buildFluid();
    this.buildSmoke(w);
    this.buildCloth(world, members);
    this.n = 0;
    this.prevX = Float64Array.from(world.px);
    this.prevY = Float64Array.from(world.py);
    this.prevA = Float64Array.from(world.ang);
    this.checkpoints = new Map();
    this.cpStride = Math.max(1, this.cloth ? Math.floor(CLOTH_CHECKPOINT_SECONDS * this.rate) : Math.round(CHECKPOINT_SECONDS * this.rate));
    this.cpBytes = 0;
    this.failedAt = new Map();
    this.leftAt = new Map();
    this.grabs = new Map();
    this.findCone();
    this.applyStatic();
    this.saveCheckpoint(0);
  }

  /**
   * The drops of the world (design 9.1): one drop size for every liquid, set by the first `Liquid` (the spacing that
   * fills its region with its count), or 0.1 m with only taps. Each liquid owns its drops, in figure order.
   */
  private buildFluid(): void {
    this.liquidMembers = [];
    this.fluid = undefined;
    this.refreshWaters(true);
    const list: { rec: ObjRec; v: LiquidValue }[] = [];
    for (const r of this.liquidRecs) {
      const v = this.liquidOf(r);
      if (v) list.push({ rec: r, v });
    }
    if (list.length === 0) return;
    const first = list.find((l) => l.v.spec.kind === 'fill' && l.v.spec.region);
    const region = first?.v.spec.region;
    const d = first && region ? spacingFor(region, first.v.spec.count) : DEFAULT_SPACING;
    const sources: DropSource2[] = [];
    let total = 0;
    list.forEach(({ rec, v }, owner) => {
      this.liquidMembers.push({ rec, owner, value: v });
      const s = v.spec;
      if (s.kind === 'fill' && s.region) {
        const f = fillRegion(s.region, Math.max(0, Math.min(s.count, 2000 - total)), d);
        total += f.xs.length;
        sources.push({ owner, viscosity: s.viscosity, density: s.density, start: f });
      } else if (s.at) {
        sources.push({ owner, viscosity: s.viscosity, density: s.density, pour: { x: s.at.x, y: s.at.y, vx: s.vx ?? 0, vy: s.vy ?? 0, rate: s.rate ?? 0, max: s.count } });
      }
    });
    this.fluid = new Fluid2(d, sources, list.length);
  }

  /** `w.level` in the plane: the rest level raised by the water the bodies over it move aside (as in space). */
  private wavesLevel(v: WavesValue): number {
    const w = this.world as World2;
    const g = Math.sqrt(w.gx * w.gx + w.gy * w.gy);
    if (!(g > 0)) return v.level;
    const kb = FORCE_KINDS.indexOf('buoyancy');
    let moved = 0;
    for (let i = 0; i < w.n; i++) {
      if (w.type[i] !== BodyType.Dynamic || w.gone.has(i)) continue;
      const x = w.px[i] as number;
      if (!(x >= v.x0 && x <= v.x0 + v.nx * v.dx)) continue;
      const o = (i * FORCE_KINDS.length + kb) * 2;
      const fx = w.forces[o] as number;
      const fy = w.forces[o + 1] as number;
      moved += Math.sqrt(fx * fx + fy * fy) / g;
    }
    return v.level + moved / (v.nx * v.dx);
  }

  /** Each wave line's heights, stepped with the world's step and its gravity (design 9.3). */
  private buildWaves(world: World2): void {
    this.waveMembers = [];
    const g = Math.sqrt(world.gx * world.gx + world.gy * world.gy);
    for (const r of this.wavesRecs) {
      const v = this.wavesOf(r);
      if (!v) continue;
      const grid = new WaveGrid({ nx: v.nx, ny: 1, x0: v.x0, y0: 0, dx: v.dx, dy: 1, level: v.level, depth: v.depth, damping: v.damping }, g, 1 / this.rate);
      this.waveMembers.push({ rec: r, value: v, grid });
    }
  }

  /** Still water as the step reads it: the level of each `Water` now (a formula of `t` is read at each step), and waves. */
  private refreshWaters(all: boolean): void {
    if (!all && !this.waterRecs.some((r) => this.varySet.has(r))) return;
    const out: Water2[] = [];
    for (const r of this.waterRecs) {
      const wv = this.waterOf(r);
      if (!wv) continue;
      out.push({ level: wv.level, density: wv.density, ...(wv.region ? { clip: waterClip(wv.region) } : {}) });
    }
    for (const wm of this.waveMembers) {
      const grid = wm.grid;
      out.push({ level: wm.value.level, density: 1, local: (x, line) => grid.line2(x, line) });
    }
    this.waters = out;
  }

  /** The smoke grids (design 9.4): each starts with the air moving with its wind, the source full of smoke. */
  private buildSmoke(w: WorldValue): void {
    this.smokeMembers = [];
    // 60 smoke steps a second: with the default 1/120 s step, one smoke step of 1/60 s every second step
    this.smokeEvery = Math.max(1, Math.round(this.rate / SMOKE_RATE));
    for (const r of this.smokeRecs) {
      const v = this.smokeOf(r);
      if (!v) continue;
      const grid = smokeGrid(v.spec, v.spec.wind?.x ?? w.windX, v.spec.wind?.y ?? w.windY);
      if (this.world) grid.markSolids(this.world);
      this.smokeMembers.push({ rec: r, value: v, grid });
    }
  }

  /**
   * Everything a step reads, bodies, drops and smoke, as one array (a checkpoint): the bodies alone when there is
   * nothing else, or a header of the parts' lengths and the parts.
   */
  private saveState(): Float64Array {
    const ws = (this.world as World2).save();
    if (!this.fluid && this.smokeMembers.length === 0 && this.waveMembers.length === 0 && !this.cloth) return ws;
    const parts = [ws, ...(this.fluid ? [this.fluid.save()] : []), ...this.smokeMembers.map((s) => s.grid.save()), ...this.waveMembers.map((m) => m.grid.save()), ...(this.cloth ? [this.cloth.save()] : [])];
    let len = 1 + parts.length;
    for (const p of parts) len += p.length;
    const out = new Float64Array(len);
    out[0] = parts.length;
    let k = 1 + parts.length;
    parts.forEach((p, i) => {
      out[1 + i] = p.length;
      out.set(p, k);
      k += p.length;
    });
    return out;
  }

  private loadState(s: Float64Array): void {
    const w = this.world as World2;
    if (!this.fluid && this.smokeMembers.length === 0 && this.waveMembers.length === 0 && !this.cloth) {
      w.load(s);
      return;
    }
    const count = s[0] as number;
    let k = 1 + count;
    const part = (i: number): Float64Array => {
      const n = s[1 + i] as number;
      const p = s.subarray(k, k + n);
      k += n;
      return p;
    };
    let i = 0;
    w.load(part(i++));
    if (this.fluid) this.fluid.load(part(i++));
    for (const sm of this.smokeMembers) sm.grid.load(part(i++));
    for (const m of this.waveMembers) m.grid.load(part(i++));
    if (this.cloth) this.cloth.load(part(i));
  }

  /** A hash of everything a step reads (FNV-1a over the bytes): equal films have equal hashes at every step. */
  worldHash(): string {
    if (!this.world) return '0';
    const s = this.saveState();
    const b = new Uint8Array(s.buffer, s.byteOffset, s.byteLength);
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (let i = 0; i < b.length; i++) {
      h1 = Math.imul(h1 ^ (b[i] as number), 0x01000193);
      h2 = Math.imul(h2 ^ (b[i] as number), 0x5bd1e995);
    }
    return `${this.n}:${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}`;
  }

  /** The world index of a joint's end: a body by its start, or an object by id. */
  private endIndex(e: JointEnd, members: readonly Member[]): number | undefined {
    if (e.spec) {
      const key = specKey(e.spec);
      for (const m of members) if (m.spec && specKey(m.spec) === key) return m.index;
    }
    if (e.id !== undefined) for (const m of members) if (m.rec.id === e.id && m.item === undefined) return m.index;
    return undefined;
  }

  private buildJoints(world: World2, members: readonly Member[]): void {
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
        if (a === undefined || b === undefined) continue;
        const built = buildJoint(world, j, a, b);
        if (!built) continue;
        world.joints.push(built.joint);
        this.jointMembers.push({ rec: r, value: j, joint: built.joint, la: built.la, lb: built.lb, ...(isList ? { item } : {}) });
      }
    }
  }

  private stepRate(rate: number): number {
    const solver = this.acc.solverStepsPerSecond();
    const r = Number.isFinite(rate) && rate > 0 ? Math.round(rate) : 120;
    // the physics step must be a whole number of solver steps (design 10.1); the line check refuses others
    return solver % r === 0 ? r : 120;
  }

  private styleNumber(r: ObjRec, key: string, fallback: number): number {
    const e = r.p.style.get(key);
    if (!e) return fallback;
    const v = this.evalStyle(r, e);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  /** A body's properties: its `with` values over its named arguments. */
  private liveProps(r: ObjRec, sp: BodySpec): { friction: number; bounce: number; bullet: boolean; group: number; charge: number } {
    const num = (k: string, d: number): number => {
      const e = r.p.style.get(k);
      if (!e || this.isVarying(e)) return d;
      const v = this.evalStyle(r, e);
      return typeof v === 'number' && Number.isFinite(v) ? v : d;
    };
    const bool = (k: string, d: boolean): boolean => {
      const e = r.p.style.get(k);
      if (!e) return d;
      const v = this.evalStyle(r, e);
      return typeof v === 'boolean' ? v : d;
    };
    return { friction: clamp(num('friction', sp.friction), 0, 2), bounce: clamp(num('bounce', sp.bounce), 0, 1), bullet: bool('bullet', sp.bullet), group: Math.round(num('group', sp.group)), charge: num('charge', sp.charge) };
  }

  /** Steady inputs that do not change during the film: forces and torques set once. */
  private applyStatic(): void {
    const w = this.world as World2;
    for (const m of this.members) {
      if (m.role !== 'body') continue;
      const i = m.index;
      const f = this.styleVector(m.rec, 'force', false);
      if (f) {
        w.fx[i] = f.x;
        w.fy[i] = f.y;
      }
      const tq = this.styleNumberIf(m.rec, 'torque', false);
      if (tq !== undefined) w.torque[i] = tq;
    }
  }

  private styleVector(r: ObjRec, key: string, varying: boolean): { x: number; y: number } | undefined {
    const e = r.p.style.get(key);
    if (!e || this.isVarying(e) !== varying) return undefined;
    const v = this.evalStyle(r, e) as { x?: unknown; y?: unknown } | undefined;
    return v && typeof v.x === 'number' && typeof v.y === 'number' && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : undefined;
  }

  private styleNumberIf(r: ObjRec, key: string, varying: boolean): number | undefined {
    const e = r.p.style.get(key);
    if (!e || this.isVarying(e) !== varying) return undefined;
    const v = this.evalStyle(r, e);
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }

  /* ------------------------------ what changes during the film ------------------------------ */

  /** Objects that change with time, with a logged input, or with a body: they are recomputed at each step time. */
  private varySet = new Set<ObjRec>();
  /** Bodies whose rule reads the clock: their start is taken once, when the world is built. */
  private bodyVaries = new Set<ObjRec>();

  private findCone(): void {
    this.coneDirty = false;
    const bodies = new Set(this.bodyRecs);
    // what physics reads: solid shapes, the world, and the reads of body and solid properties
    const targets: ObjRec[] = [...this.solidRecs, ...this.jointRecs, ...this.vehicleRecs, ...this.waterRecs, ...this.smokeRecs];
    if (this.worldRec) targets.push(this.worldRec);
    for (const r of [...this.bodyRecs, ...this.solidRecs]) {
      for (const k of [...BODY_PROPS, 'solid']) {
        const e = r.p.style.get(k);
        if (!e) continue;
        for (const id of e.reads) {
          const x = this.acc.byId(id);
          if (x && x !== r) targets.push(x);
        }
      }
    }
    const anc = this.acc.ancestorRecs(targets);
    const all = [...new Set([...anc, ...targets])].sort((a, b) => a.order - b.order);
    const vary = new Set<ObjRec>();
    for (const r of all) {
      if (bodies.has(r)) continue;
      // a joint reads its bodies only for its start, so a moving body does not make it change
      const joint = isJointRec(r);
      const v = r.usesClock || this.logged.has(r.id) || r.inputs.some((i) => vary.has(i) || (bodies.has(i) && !joint));
      if (v) vary.add(r);
    }
    this.varySet = vary;
    this.bodyVaries = new Set(this.bodyRecs.filter((r) => r.usesClock || r.inputs.some((i) => vary.has(i))));
    this.cone = all.filter((r) => vary.has(r) && r.p.kind === 'rule' && !bodies.has(r));
    this.readsBodies = all.some((r) => vary.has(r) && !isJointRec(r) && r.inputs.some((i) => bodies.has(i)));
    // the free inputs: of the start (body shapes and named arguments), and of movers
    this.inputs = new Set();
    this.startInputs = new Set();
    this.moverInputs = new Set();
    for (const r of anc) if (r.p.kind === 'free') this.inputs.add(r.id);
    for (const r of this.acc.ancestorRecs(this.bodyRecs)) if (r.p.kind === 'free') {
      this.inputs.add(r.id);
      this.startInputs.add(r.id);
    }
    for (const r of this.acc.ancestorRecs(this.solidRecs)) if (r.p.kind === 'free') this.moverInputs.add(r.id);
    // a car's pedal and wheel are driven while the film plays: they always go on from now (design 8, ui.md 9)
    this.vehicleInputs = new Set();
    for (const r of this.acc.ancestorRecs(this.vehicleRecs)) if (r.p.kind === 'free') {
      this.vehicleInputs.add(r.id);
      this.inputs.add(r.id);
    }
    // members whose solid moves, and property formulas that change
    this.members = this.members.map((m) => (m.role === 'solid' ? { ...m, moving: vary.has(m.rec) } : m));
    this.byId = new Map();
    for (const m of this.members) if (!this.byId.has(m.rec.id)) this.byId.set(m.rec.id, m);
    this.varyingStyle = [];
    for (const m of this.members) {
      for (const k of BODY_PROPS) {
        const e = m.rec.p.style.get(k);
        if (e && this.isVarying(e)) this.varyingStyle.push({ member: m, entry: e });
      }
      if (m.role === 'solid') for (const k of ['bounce', 'friction']) {
        const e = m.rec.p.style.get(k);
        if (e && this.isVarying(e)) this.varyingStyle.push({ member: m, entry: e });
      }
    }
    if (this.readsBodies) for (const m of this.members) {
      // a formula that reads a body is evaluated with the body where it is at each step
      for (const k of BODY_PROPS) {
        const e = m.rec.p.style.get(k);
        if (e && !this.varyingStyle.some((s) => s.entry === e) && e.reads.some((id) => bodies.has(this.acc.byId(id) as ObjRec))) this.varyingStyle.push({ member: m, entry: e });
      }
    }
    for (const m of this.members) {
      for (const k of BODY_PROPS) {
        const e = m.rec.p.style.get(k);
        if (e && !this.varyingStyle.some((s) => s.entry === e) && e.reads.some((id) => bodies.has(this.acc.byId(id) as ObjRec))) this.varyingStyle.push({ member: m, entry: e });
      }
    }
    this.varyingWorld = this.worldRec !== undefined && vary.has(this.worldRec);
  }

  /* ------------------------------ stepping ------------------------------ */

  private advance(nTarget: number, budget: number): void {
    const w = this.world as World2;
    this.short = false;
    // the nearest checkpoint at least one step before the target, so the pose before the last step is known
    const want = Math.max(0, nTarget - 1);
    let best = -1;
    for (const k of this.checkpoints.keys()) if (k <= want && k > best) best = k;
    if (this.n > nTarget || this.prevStale || best > this.n) {
      if (best < 0) best = 0;
      const cp = this.checkpoints.get(best);
      if (cp) {
        this.loadState(cp);
        this.n = best;
      }
      this.prevX.set(w.px);
      this.prevY.set(w.py);
      this.prevA.set(w.ang);
      this.prevStale = false;
    }
    if (this.n >= nTarget) {
      this.catching = undefined;
      return;
    }
    // a drop costs about a quarter of an awake body
    // a drop costs about a quarter of an awake body, a smoke cell about a sixteenth (it steps every second step)
    let cells = 0;
    for (const s of this.smokeMembers) cells += s.grid.n * s.grid.n;
    const perStep = Math.max(1, w.awakeCount() + 1 + Math.ceil((this.fluid?.ps.n ?? 0) / 4) + Math.ceil(cells / 16) + Math.ceil((this.cloth?.n ?? 0) / 8));
    let steps = Math.max(2, Math.floor(budget / perStep));
    const varying = this.cone.length > 0 || this.varyingStyle.length > 0 || this.base.size > 0;
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

  /** The pose before the last step is not the one before the current step (after a jump to a checkpoint). */
  private prevStale = false;

  private stepOnce(varying: boolean): void {
    const w = this.world as World2;
    const n = this.n;
    const h = 1 / this.rate;
    this.applyLog(n);
    if (varying) this.stepInputs(n);
    // the air at the film's start, from the wind and the source at its first step, not at the time the grid was built
    if (n === 0) this.startSmoke();
    this.applyGrabs();
    this.applyVehicles();
    if (n === 0) {
      // leapfrog start: the first small step takes half a small step of the forces off the start speed, so a body in
      // free flight follows x0 + v0 t + a t² / 2 exactly at every step (design 11.5, projectile)
      const hs = h / w.substeps;
      for (const m of this.members) {
        const i = m.index;
        if (m.role !== 'body' || w.type[i] !== BodyType.Dynamic) continue;
        const im = w.invM[i] as number;
        w.vx[i] = (w.vx[i] as number) - 0.5 * hs * (w.gx + im * (w.fx[i] as number));
        w.vy[i] = (w.vy[i] as number) - 0.5 * hs * (w.gy + im * (w.fy[i] as number));
      }
    }
    // design 9.6: the drops' push of the last step, and still water's buoyancy and drag at the pose now, go in first
    const fl = this.fluid;
    if (fl) fl.applyImpulses(w);
    if (this.waveMembers.length > 0) {
      for (let i = 0; i < w.n; i++) if (w.type[i] === BodyType.Dynamic && !w.gone.has(i)) w.updateShapes(i);
      for (const wm of this.waveMembers) {
        wm.grid.pressBodies2(w);
        wm.grid.step();
      }
    }
    // and the air's drag from the last smoke step
    for (const sm of this.smokeMembers) sm.grid.applyImpulses(w, h);
    if (this.waters.length > 0) {
      this.refreshWaters(false);
      this.waterForces.apply(w, this.waters, h);
    }
    const cl = this.cloth;
    if (cl) cl.applyImpulses(w);
    this.prevX.set(w.px);
    this.prevY.set(w.py);
    this.prevA.set(w.ang);
    w.step(h);
    this.n = n + 1;
    this.prevStale = false;
    if (this.waters.length > 0) this.waterForces.account(w);
    if (cl) cl.account(w, h);
    if (fl || cl) for (let i = 0; i < w.n; i++) if (w.type[i] !== BodyType.Static && !w.gone.has(i)) w.updateShapes(i);
    if (fl) {
      fl.account(w, h);
      // then the drops take their step against the bodies where they are now (they meet the cloth in its step)
      fl.step(w, h, w.range);
      for (const owner of fl.left) {
        const lm = this.liquidMembers[owner];
        if (lm) this.warnOnce(`drops:${lm.rec.id}`, makeNotice('left_world', { name: `drops of ${lm.rec.p.name}`, t: Number((this.t0 + this.n / this.rate).toFixed(3)) }, [lm.rec.p.name]));
      }
      if (fl.unstable) for (const lm of this.liquidMembers) this.warnOnce(`unstable-liquid:${lm.rec.id}`, makeNotice('unstable_world', { name: lm.rec.p.name, t: Number((this.t0 + this.n / this.rate).toFixed(3)), hint: 'make the liquid less viscous or use world with timestep = 1/240' }, [lm.rec.p.name]));
    }
    if (this.smokeMembers.length > 0) this.stepSmoke(w, h);
    if (cl) {
      cl.useDrops(fl);
      this.stepCloth(cl, w, h);
    }
    this.checkHealth();
    for (const i of w.left) if (!this.leftAt.has(i)) this.leftAt.set(i, this.n);
    for (const jm of [...this.jointMembers, ...this.wheelMembers]) {
      if (!jm.joint.broken) continue;
      const name = jm.item !== undefined ? `${jm.rec.p.name}[${jm.item + 1}]` : jm.rec.p.name;
      const t = Number((this.t0 + this.n / this.rate).toFixed(3));
      if (!this.brokeAt.has(jm.joint)) {
        this.brokeAt.set(jm.joint, this.n);
        this.events.push({ t: this.t0 + this.n / this.rate, kind: 'broken', name });
        this.warnOnce(`broken:${name}:${this.n}`, makeNotice('broken', { name, t }, [name]));
      }
    }
    if (!this.sampling) {
      const fresh = this.n > this.frontier;
      for (const hit of w.hits) {
        const e = { t: this.t0 + this.n / this.rate, a: this.nameOfIndex[hit.a] ?? '', b: this.nameOfIndex[hit.b] ?? '', speed: hit.speed, x: hit.x, y: hit.y, impulse: hit.impulse };
        this.hits.push(e);
        // handlers run once per hit: a replay or a seek back over it does not run them again
        if (fresh) this.pendingHits.push(e);
      }
      if (fresh) this.frontier = this.n;
    }
    if (this.n % this.cpStride === 0 && !this.checkpoints.has(this.n)) this.saveCheckpoint(this.n);
  }

  /**
   * Sets each smoke grid to its start, as the first step reads it: a grid is built at whatever time the figure is
   * shown, and a wind or a source that changes with t must not make the start depend on that time (seek == play).
   */
  private startSmoke(): void {
    for (const sm of this.smokeMembers) {
      if (this.varySet.has(sm.rec)) {
        const c = sm.rec.cell;
        if (c.defined && isSmokeValue(c.value)) sm.value = c.value;
      }
      const spec = sm.value.spec;
      sm.grid.setSource(spec.source);
      sm.grid.heat = spec.heat;
      sm.grid.making = spec.until > 0;
      const ws = spec.wind ?? this.windNow();
      sm.grid.start(ws.x, ws.y);
      sm.grid.settle(this.world);
    }
  }

  /** The world's wind at the step being taken (a formula of t was evaluated for it). */
  private windNow(): { x: number; y: number } {
    const ws = this.varyingWorld && this.worldRec?.cell.defined && isWorldValue(this.worldRec.cell.value) ? this.worldRec.cell.value : this.settings();
    return { x: ws.windX, y: ws.windY };
  }

  /**
   * Smoke after the bodies' step (design 9.6): its drag is counted on every step, and every `smokeEvery` steps the
   * grids step once, by that many steps' time, against the bodies where they are now.
   */
  private stepSmoke(w: World2, h: number): void {
    const t = this.t0 + this.n / this.rate;
    const due = this.n % this.smokeEvery === 0;
    for (const sm of this.smokeMembers) {
      sm.grid.account(w);
      if (!due) continue;
      // a source or heat that changes during the film is read at each smoke step (the rule ran for this step's time)
      if (this.varySet.has(sm.rec)) {
        const c = sm.rec.cell;
        if (c.defined && isSmokeValue(c.value) && !sameValue(c.value.spec, sm.value.spec)) {
          const nv = c.value;
          if (!sameValue(nv.spec.source, sm.value.spec.source)) sm.grid.setSource(nv.spec.source);
          sm.grid.heat = nv.spec.heat;
          sm.value = nv;
        }
      }
      const spec = sm.value.spec;
      // the source makes smoke while the film is before `until`
      sm.grid.making = t - this.smokeEvery * h < spec.until - 1e-9;
      if (!spec.wind) {
        const ws = this.windNow();
        sm.grid.windX = ws.x;
        sm.grid.windY = ws.y;
      }
      const was = sm.grid.unstable;
      sm.grid.step(w, this.smokeEvery * h);
      if (sm.grid.unstable && !was) this.warnOnce(`unstable-smoke:${sm.rec.id}`, makeNotice('unstable_world', { name: sm.rec.p.name, t: Number(t.toFixed(3)), hint: 'a body moved through the smoke too fast; use slower bodies or a coarser grid' }, [sm.rec.p.name]));
    }
  }

  private saveCheckpoint(n: number): void {
    const s = this.saveState();
    this.checkpoints.set(n, s);
    this.cpBytes += s.byteLength;
    if (this.cpBytes > CHECKPOINT_BYTES) {
      // keep every second one and double the spacing (design 10.3)
      this.cpStride *= 2;
      this.cpBytes = 0;
      for (const [k, v] of [...this.checkpoints]) {
        if (k !== 0 && k % this.cpStride !== 0) this.checkpoints.delete(k);
        else this.cpBytes += v.byteLength;
      }
      this.warnOnce(`thin:${this.cpStride}`, makeNotice('checkpoints_thinned', { seconds: this.cpStride / this.rate }, []));
    }
  }

  /** A body that blows up stops with its island; the others go on (design 4, `unstable_world`). */
  private checkHealth(): void {
    const w = this.world as World2;
    for (const m of this.members) {
      if (m.role !== 'body') continue;
      const i = m.index;
      if (w.type[i] !== BodyType.Dynamic) continue;
      const bad = !Number.isFinite(w.px[i] as number) || !Number.isFinite(w.py[i] as number) || !Number.isFinite(w.vx[i] as number) || !Number.isFinite(w.vy[i] as number) || Math.abs(w.vx[i] as number) > BLOW_UP || Math.abs(w.vy[i] as number) > BLOW_UP || Math.abs(w.w[i] as number) > BLOW_UP;
      if (!bad) continue;
      this.failedAt.set(i, this.n);
      w.removeBody(i);
      const t = Number((this.t0 + this.n / this.rate).toFixed(3));
      this.warnOnce(`unstable:${i}:${this.n}`, makeNotice('unstable_world', { name: m.rec.p.name, t, hint: 'lower the spring k, add damping, or use world with timestep = 1/240' }, [m.rec.p.name]));
    }
  }

  private warnOnce(key: string, n: Notice): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.warnings.push(n);
  }

  /* ------------------------------ the input log ------------------------------ */

  private addEntry(e: LogEntry): void {
    if (e.kind === 'set') {
      const later = this.log.filter((x) => x.kind === 'set' && x.id === e.id && x.n >= e.n);
      if (later.length > 0) this.log = this.log.filter((x) => !later.includes(x));
    }
    this.log.push(e);
    this.log.sort((a, b) => a.n - b.n);
    for (const k of [...this.checkpoints.keys()]) if (k > e.n) this.checkpoints.delete(k);
    this.cpBytes = 0;
    for (const v of this.checkpoints.values()) this.cpBytes += v.byteLength;
    if (this.n > e.n) this.prevStale = true;
    if (this.n > e.n) {
      // the world is past the entry: go back to a checkpoint before it on the next pass
      let best = 0;
      for (const k of this.checkpoints.keys()) if (k <= e.n && k > best) best = k;
      const cp = this.checkpoints.get(best);
      if (cp && this.world) {
        this.loadState(cp);
        this.n = best;
      }
    }
  }

  /** The log as `@input physics …` lines, saved with the script. */
  inputLines(): string[] {
    if (this.remote) return [...this.remoteLog];
    const out: string[] = [];
    const t = (n: number): string => String(Number((this.t0 + n / this.rate).toFixed(6)));
    const name = (id: ObjId): string | undefined => this.acc.byId(id)?.p.name;
    for (const [id, v] of this.base) {
      const nm = name(id);
      const w = numWords(v);
      if (nm && w) out.push(`@input physics set ${nm} base ${w} at 0`);
    }
    for (const e of this.log) {
      if (e.kind === 'reset') {
        out.push(`@input physics reset at ${t(e.n)}`);
        continue;
      }
      const base = name(e.id);
      if (!base) continue;
      if (e.kind === 'cgrab') {
        out.push(`@input physics grab ${base} ${e.point} ${num(e.x)} ${num(e.y)} at ${t(e.n)}`);
        continue;
      }
      if (e.kind === 'crelease') {
        out.push(`@input physics release ${base} ${e.point} at ${t(e.n)}`);
        continue;
      }
      const nm = e.kind !== 'set' && e.item !== undefined ? `${base}[${e.item + 1}]` : base;
      if (e.kind === 'push') out.push(`@input physics push ${nm} ${num(e.x)} ${num(e.y)}${e.ax !== undefined ? ` ${num(e.ax)} ${num(e.ay ?? 0)}` : ''} at ${t(e.n)}`);
      else if (e.kind === 'grab') out.push(`@input physics grab ${nm} ${num(e.x)} ${num(e.y)} ${num(e.ax)} ${num(e.ay)} at ${t(e.n)}`);
      else if (e.kind === 'release') out.push(`@input physics release ${nm} at ${t(e.n)}`);
      else {
        const w = numWords(e.value);
        if (w) out.push(`@input physics set ${nm} ${w} at ${t(e.n)}`);
      }
    }
    return out;
  }

  private applyLog(n: number): void {
    const w = this.world as World2;
    for (const e of this.log) {
      if (e.n !== n) continue;
      if (e.kind === 'reset') {
        const cp = this.checkpoints.get(0);
        if (cp) {
          const keepStep = w.stepIndex;
          this.loadState(cp);
          w.stepIndex = keepStep;
        }
        this.grabs.clear();
        continue;
      }
      if (e.kind === 'cgrab' || e.kind === 'crelease') continue;
      const m = e.kind === 'set' ? undefined : this.memberOf(e.id, e.item);
      if (!m && e.kind !== 'set') continue;
      if (e.kind === 'push' && m) {
        const i = m.index;
        w.jx[i] = (w.jx[i] as number) + e.x;
        w.jy[i] = (w.jy[i] as number) + e.y;
        if (e.ax !== undefined && e.ay !== undefined) {
          const rx = e.ax - (w.px[i] as number);
          const ry = e.ay - (w.py[i] as number);
          w.jt[i] = (w.jt[i] as number) + rx * e.y - ry * e.x;
        }
      } else if (e.kind === 'grab' && m) {
        const g = this.grabs.get(m.index);
        if (g) {
          g.x = e.x;
          g.y = e.y;
        } else this.grabs.set(m.index, { x: e.x, y: e.y, ax: e.ax, ay: e.ay });
        w.wakeBody(m.index);
      } else if (e.kind === 'release' && m) this.grabs.delete(m.index);
    }
  }

  /** The value of a logged input at step n. */
  private inputAt(id: ObjId, n: number): unknown {
    let v: unknown = this.base.has(id) ? this.base.get(id) : this.acc.byId(id)?.p.value;
    for (const e of this.log) if (e.kind === 'set' && e.id === id && e.n <= n) v = e.value;
    return v;
  }

  /**
   * A grab pulls the body toward the pointer with a stiff, damped spring at the point where it was taken
   * (design 2.4 `Grab`): five oscillations a second, near critical damping, scaled by the mass so any body follows.
   */
  private applyGrabs(): void {
    if (this.grabs.size === 0) return;
    const w = this.world as World2;
    const omega = 2 * Math.PI * 5;
    for (const [i, g] of this.grabs) {
      if (w.type[i] !== BodyType.Dynamic) continue;
      const m = w.mass[i] as number;
      // the grabbed point, carried with the body: ax, ay are in the body frame
      const c = w.qc[i] as number;
      const s = w.qs[i] as number;
      const px = (w.px[i] as number) + c * g.ax - s * g.ay;
      const py = (w.py[i] as number) + s * g.ax + c * g.ay;
      const vx = (w.vx[i] as number) - (w.w[i] as number) * (s * g.ax + c * g.ay);
      const vy = (w.vy[i] as number) + (w.w[i] as number) * (c * g.ax - s * g.ay);
      const k = m * omega * omega;
      const d = 2 * 0.9 * m * omega;
      const fx = k * (g.x - px) - d * vx - m * w.gx;
      const fy = k * (g.y - py) - d * vy - m * w.gy;
      const h = 1 / this.rate;
      w.jx[i] = (w.jx[i] as number) + fx * h;
      w.jy[i] = (w.jy[i] as number) + fy * h;
      const rx = px - (w.px[i] as number);
      const ry = py - (w.py[i] as number);
      w.jt[i] = (w.jt[i] as number) + (rx * fy - ry * fx) * h * 0.2;
      w.account(i, FK.applied, fx, fy);
      w.wakeBody(i);
    }
  }

  /** Each vehicle drives its wheels marked `drive` and brakes them all (design 8). */
  private applyVehicles(): void {
    if (this.vehicleRecs.length === 0 || this.wheelMembers.length === 0) return;
    const w = this.world as World2;
    for (const r of this.vehicleRecs) {
      const c = this.varySet.has(r) ? r.cell : { defined: true, value: this.vehicleOf(r) };
      const v = c.defined && isVehicleValue(c.value) ? c.value : this.vehicleOf(r);
      if (!v) continue;
      const ck = v.chassis.spec ? specKey(v.chassis.spec) : undefined;
      for (const wm of this.wheelMembers) {
        if (wm.value.chassis.spec && ck !== undefined && specKey(wm.value.chassis.spec) !== ck) continue;
        const spin = Math.abs(w.w[wm.index] as number);
        const mass = Math.max(1, (w.mass[wm.chassis] as number) + 0);
        if (v.brake > 0) {
          wm.joint.opts = { ...wm.joint.opts, motor: 0, torque: v.brake * mass * 9.8 * wm.value.r * 1.5 };
        } else if (wm.value.drive && v.motor !== 0) {
          // full pedal turns the wheels at 40 rad/s, with the torque the power gives at that spin
          wm.joint.opts = { ...wm.joint.opts, motor: -v.motor * 40, torque: Math.min(v.power / Math.max(1, spin), mass * 9.8 * wm.value.r * 3) };
        } else {
          wm.joint.opts = { spring: wm.joint.opts.spring, damping: wm.joint.opts.damping, travel: wm.joint.opts.travel };
        }
        if (v.motor !== 0 || v.brake > 0) {
          w.wakeBody(wm.index);
          w.wakeBody(wm.chassis);
        }
      }
    }
  }

  /* ------------------------------ inputs at each step ------------------------------ */

  private saveCells(): { recs: ObjRec[]; cells: Cell[]; t: number } {
    const recs = [...this.cone, ...this.bodyRecs, ...[...this.base.keys()].map((id) => this.acc.byId(id)).filter((r): r is ObjRec => r !== undefined)];
    return { recs, cells: recs.map((r) => r.cell), t: this.acc.env.t };
  }

  private restoreCells(s: { recs: ObjRec[]; cells: Cell[]; t: number }): void {
    s.recs.forEach((r, i) => {
      r.cell = s.cells[i] as Cell;
    });
    this.acc.env.t = s.t;
  }

  /** Evaluates what changes during the film at the time of step n, and puts it into the world. */
  private stepInputs(n: number): void {
    const w = this.world as World2;
    const env = this.acc.env;
    const h = 1 / this.rate;
    env.t = this.t0 + n * h;
    for (const id of this.base.keys()) {
      const r = this.acc.byId(id);
      if (!r) continue;
      const v = this.inputAt(id, n);
      r.cell = v === undefined ? { defined: false, reason: 'explicit' } : { defined: true, value: v };
    }
    if (this.readsBodies) {
      const lists = new Map<ObjRec, unknown[]>();
      for (const m of this.members) {
        if (m.role !== 'body') continue;
        if (m.item === undefined) m.rec.cell = { defined: true, value: this.liveValue(m) };
        else {
          const arr = lists.get(m.rec) ?? [];
          arr[m.item] = this.liveValue(m);
          lists.set(m.rec, arr);
        }
      }
      for (const [r, arr] of lists) r.cell = { defined: true, value: arr };
    }
    for (const r of this.cone) r.cell = this.acc.compute(r);
    // movers: the new shape, and the speed of its move
    for (const m of this.members) {
      if (m.role !== 'solid' || !m.moving) continue;
      const c = m.rec.cell;
      if (!c.defined) continue;
      const sh = solidShapeOf(c.value, w.range);
      if (!sh) continue;
      const i = m.index;
      const old = this.shapesNow(i);
      if (!w.setStaticShapes(i, sh.shapes)) continue;
      // smoke marks its walls again
      for (const s of this.smokeMembers) s.grid.staticDirty = true;
      // At the first step there is no step before it: the world was built from the shape at whatever time the figure
      // showed (t = 0 when played, the seek's time when sought), so its move from there is not a speed. It starts at
      // rest, in every case (seek == play).
      const mv = n === 0 ? REST : rigidMotion(old, sh.shapes, h);
      w.vx[i] = mv.vx;
      w.vy[i] = mv.vy;
      w.w[i] = mv.w;
    }
    for (const { member: m, entry: e } of this.varyingStyle) {
      const v = this.evalStyle(m.rec, e);
      const i = m.index;
      switch (e.key) {
        case 'force': {
          const p = v as { x?: number; y?: number } | undefined;
          w.fx[i] = typeof p?.x === 'number' && Number.isFinite(p.x) ? p.x : 0;
          w.fy[i] = typeof p?.y === 'number' && Number.isFinite(p.y) ? p.y : 0;
          if (p === undefined) this.warnOnce(`undef:${m.rec.id}:force`, makeNotice('input_undefined', { name: m.rec.p.name, what: 'force', t: Number(env.t.toFixed(3)) }, [m.rec.p.name]));
          break;
        }
        case 'torque':
          w.torque[i] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
          break;
        case 'friction':
          if (typeof v === 'number' && Number.isFinite(v)) w.fric[i] = clamp(v, 0, 2);
          break;
        case 'bounce':
          if (typeof v === 'number' && Number.isFinite(v)) w.rest[i] = clamp(v, 0, 1);
          break;
        case 'charge':
          if (typeof v === 'number' && Number.isFinite(v)) w.charge[i] = v;
          break;
        default:
          break;
      }
    }
    // joints whose motor, limits or target change during the film
    for (const jm of this.jointMembers) {
      if (!this.varySet.has(jm.rec)) continue;
      const c = jm.rec.cell;
      if (!c.defined) continue;
      const v = Array.isArray(c.value) ? (c.value as unknown[])[jm.item ?? 0] : c.value;
      if (!isJointValue(v)) continue;
      if (v.kind === 'hinge') (jm.joint as Hinge2).opts = { ...(v.motor !== undefined ? { motor: v.motor } : {}), ...(v.torque !== undefined ? { torque: v.torque } : {}), ...(v.min !== undefined ? { min: v.min } : {}), ...(v.max !== undefined ? { max: v.max } : {}) };
      else if (v.kind === 'slider') (jm.joint as Slider2).opts = { ...(jm.joint as Slider2).opts, ...(v.motor !== undefined ? { motor: v.motor } : {}), ...(v.torque !== undefined ? { force: v.torque } : {}) };
      else if (v.kind === 'grab' && v.target) {
        (jm.joint as Grab2).tx = v.target.x;
        (jm.joint as Grab2).ty = v.target.y;
        w.wakeBody(jm.joint.b);
      }
    }
    if (this.varyingWorld && this.worldRec) {
      const c = this.worldRec.cell;
      if (c.defined && isWorldValue(c.value)) {
        w.gx = c.value.gx;
        w.gy = c.value.gy;
        w.air = c.value.air;
      }
    }
  }

  private shapesNow(i: number): ShapeDef2[] {
    const w = this.world as World2;
    const out: ShapeDef2[] = [];
    const s0 = w.shape0[i] as number;
    for (let k = s0; k < s0 + (w.shapeN[i] as number); k++) {
      const s = w.shapes[k];
      if (!s) continue;
      if (s.kind === 0) out.push({ kind: 'circle', x: s.wcx, y: s.wcy, r: s.radius });
      else {
        const pts = [];
        for (let q = 0; q < s.lx.length; q++) pts.push({ x: s.lx[q] as number, y: s.ly[q] as number });
        out.push({ kind: 'poly', pts });
      }
    }
    return out;
  }

  /* ------------------------------ writing the cells ------------------------------ */

  private liveValue(m: Member, alpha = 1): BodyValue {
    const w = this.world as World2;
    const i = m.index;
    const sp = m.spec as BodySpec;
    const lerp = (a: number, b: number): number => a + (b - a) * alpha;
    const x = lerp(this.prevX[i] as number, w.px[i] as number);
    const y = lerp(this.prevY[i] as number, w.py[i] as number);
    const angle = lerp(this.prevA[i] as number, w.ang[i] as number);
    // the speed is the one of the last step (leapfrog), so the height is taken in the middle of that step: then a
    // body in free flight keeps its energy exactly, and an oscillator to O((ω h)²)
    const ke = w.kinetic(i);
    const pe = this.midPotential(i);
    return {
      schema: 'Body', spec: sp, x, y, angle, vx: w.vx[i] as number, vy: w.vy[i] as number, spin: w.w[i] as number, asleep: w.type[i] === BodyType.Dynamic && w.awake[i] === 0,
      mass: sp.fixed ? Infinity : (w.mass[i] as number), inertia: w.inertia[i] as number, energy: ke + pe, kinetic: ke, potential: pe, touching: [], moving: this.n > 0,
    };
  }

  private midPotential(i: number): number {
    const w = this.world as World2;
    // the speed is the last small step's, so the height is taken in the middle of that small step
    const hs = 1 / this.rate / w.substeps;
    const mx = (w.px[i] as number) - 0.5 * hs * (w.vx[i] as number);
    const my = (w.py[i] as number) - 0.5 * hs * (w.vy[i] as number);
    return -(w.mass[i] as number) * (w.gx * mx + w.gy * my);
  }

  /** Energy of the springs in the middle of the last step (as `midPotential`). */
  private springEnergy(): number {
    const w = this.world as World2;
    if (!w.joints.some((j) => !j.broken && j.energy(w) !== 0)) return 0;
    const kx = Float64Array.from(w.px);
    const ky = Float64Array.from(w.py);
    const ka = Float64Array.from(w.ang);
    // the middle of the last small step: the speeds are that small step's
    const hs = 1 / this.rate / w.substeps;
    for (let i = 0; i < w.n; i++) {
      if (w.type[i] !== BodyType.Dynamic) continue;
      w.px[i] = (kx[i] as number) - 0.5 * hs * (w.vx[i] as number);
      w.py[i] = (ky[i] as number) - 0.5 * hs * (w.vy[i] as number);
      w.ang[i] = (ka[i] as number) - 0.5 * hs * (w.w[i] as number);
      w.setRot(i);
    }
    let e = 0;
    for (const j of w.joints) if (!j.broken) e += j.energy(w);
    w.px.set(kx);
    w.py.set(ky);
    w.ang.set(ka);
    for (let i = 0; i < w.n; i++) if (w.type[i] === BodyType.Dynamic) w.setRot(i);
    return e;
  }

  private bodyCell(m: Member, alpha: number): Cell {
    const i = m.index;
    if (this.failedAt.has(i)) return { defined: false, reason: 'unstable_world' };
    if (this.leftAt.has(i)) return { defined: false, reason: 'left_world' };
    const w = this.world as World2;
    const v = this.liveValue(m, alpha);
    const forces = new Float64Array(FORCE_KINDS.length * 2);
    forces.set(w.forces.subarray(i * FORCE_KINDS.length * 2, (i + 1) * FORCE_KINDS.length * 2));
    if (v.asleep) {
      // at rest the forces balance
      forces[FK.net * 2] = 0;
      forces[FK.net * 2 + 1] = 0;
    }
    const touching = (this.touchLists[i] ?? []).map((k) => this.nameOfIndex[k] ?? '').filter((s) => s !== '');
    return { defined: true, value: { ...v, forces, touching } };
  }

  private touchLists: number[][] = [];

  private writeCells(alpha: number): ObjRec[] {
    const w = this.world as World2;
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
      this.lastCells.set(m.rec.id, cell);
      this.written.add(m.rec.id);
      if (this.acc.write(m.rec, cell)) changed.push(m.rec);
    }
    for (const [rec, arr] of lists) {
      const cell: Cell = { defined: true, value: arr };
      this.lastCells.set(rec.id, cell);
      this.written.add(rec.id);
      if (this.acc.write(rec, cell)) changed.push(rec);
    }
    // wheels: where they are and how far they have turned; vehicles: their speed
    const wl = new Map<ObjRec, unknown[]>();
    for (const wm of this.wheelMembers) {
      const i = wm.index;
      const lerpA = (this.prevA[i] as number) + ((w.ang[i] as number) - (this.prevA[i] as number)) * alpha;
      const value: WheelValue = { ...wm.value, x: (this.prevX[i] as number) + ((w.px[i] as number) - (this.prevX[i] as number)) * alpha, y: (this.prevY[i] as number) + ((w.py[i] as number) - (this.prevY[i] as number)) * alpha, angle: lerpA, spin: w.w[i] as number, broken: wm.joint.broken };
      if (wm.item === undefined) {
        const cell: Cell = { defined: true, value };
        this.lastCells.set(wm.rec.id, cell);
        this.written.add(wm.rec.id);
        if (this.acc.write(wm.rec, cell)) changed.push(wm.rec);
      } else {
        const arr = wl.get(wm.rec) ?? (this.wheelsOf(wm.rec) as unknown[]).slice();
        arr[wm.item] = value;
        wl.set(wm.rec, arr);
      }
    }
    for (const [rec, arr] of wl) {
      const cell: Cell = { defined: true, value: arr };
      this.lastCells.set(rec.id, cell);
      this.written.add(rec.id);
      if (this.acc.write(rec, cell)) changed.push(rec);
    }
    for (const r of this.vehicleRecs) {
      const v = this.vehicleOf(r);
      if (!v) continue;
      const ci = v.chassis.spec ? this.members.find((m) => m.spec === v.chassis.spec)?.index : undefined;
      const speed = ci === undefined ? 0 : (w.qc[ci] as number) * (w.vx[ci] as number) + (w.qs[ci] as number) * (w.vy[ci] as number);
      const cell: Cell = { defined: true, value: { ...v, speedometer: speed } };
      this.lastCells.set(r.id, cell);
      this.written.add(r.id);
      if (this.acc.write(r, cell)) changed.push(r);
    }
    // joints: what they carry, how long they are, where their ends are
    const h = 1 / this.rate;
    const jl = new Map<ObjRec, unknown[]>();
    for (const jm of this.jointMembers) {
      const v = jointNow(w, jm, h);
      if (jm.item === undefined) {
        const cell: Cell = { defined: true, value: v };
        this.lastCells.set(jm.rec.id, cell);
        this.written.add(jm.rec.id);
        if (this.acc.write(jm.rec, cell)) changed.push(jm.rec);
        continue;
      }
      const arr = jl.get(jm.rec) ?? (this.jointsOf(jm.rec) as unknown[]).slice();
      arr[jm.item] = v;
      jl.set(jm.rec, arr);
    }
    for (const [rec, arr] of jl) {
      const cell: Cell = { defined: true, value: arr };
      this.lastCells.set(rec.id, cell);
      this.written.add(rec.id);
      if (this.acc.write(rec, cell)) changed.push(rec);
    }
    // liquids: where each drop is (between the last two steps, as bodies), how many, and the surface
    const fl = this.fluid;
    if (fl) {
      const ps = fl.ps;
      for (const lm of this.liquidMembers) {
        let cell: Cell;
        if (fl.unstable) cell = { defined: false, reason: 'unstable_world' };
        else {
          const count = fl.countOf(lm.owner);
          const xs = new Float32Array(count);
          const ys = new Float32Array(count);
          let k = 0;
          for (let i = 0; i < ps.n; i++) {
            if (ps.owner[i] !== lm.owner) continue;
            const x0 = ps.x0[i] as number;
            const y0 = ps.y0[i] as number;
            xs[k] = x0 + ((ps.x[i] as number) - x0) * alpha;
            ys[k] = y0 + ((ps.y[i] as number) - y0) * alpha;
            k++;
          }
          cell = { defined: true, value: { ...lm.value, count, level: fl.levelOf(lm.owner), xs, ys, size: fl.d } satisfies LiquidValue };
        }
        this.lastCells.set(lm.rec.id, cell);
        this.written.add(lm.rec.id);
        if (this.acc.write(lm.rec, cell)) changed.push(lm.rec);
      }
    }
    // waves in the plane: the height of each point
    for (const wm of this.waveMembers) {
      const g = wm.grid;
      let ok = true;
      const heights = new Float32Array(g.n);
      for (let k = 0; k < g.n; k++) {
        // the water's level as it shows: the surface, and under a body the level its push holds the water at
        const u = (g.u[k] as number) + (g.P[k] as number);
        if (!(Math.abs(u) < BLOW_UP)) ok = false;
        heights[k] = u;
      }
      const cell: Cell = ok ? { defined: true, value: { ...wm.value, heights, speed: g.c, mean: this.wavesLevel(wm.value) } satisfies WavesValue } : { defined: false, reason: 'unstable_world' };
      this.lastCells.set(wm.rec.id, cell);
      this.written.add(wm.rec.id);
      if (this.acc.write(wm.rec, cell)) changed.push(wm.rec);
    }
    // smoke: the density of each cell after the last smoke step (drawn as one image a frame, ui.md 7)
    for (const sm of this.smokeMembers) {
      const cell: Cell = sm.grid.unstable ? { defined: false, reason: 'unstable_world' } : { defined: true, value: smokeValue(sm.value.spec, sm.grid) };
      this.lastCells.set(sm.rec.id, cell);
      this.written.add(sm.rec.id);
      if (this.acc.write(sm.rec, cell)) changed.push(sm.rec);
    }
    this.writeCloth(alpha, changed);
    // bodies whose start is undefined stay as their rule left them
    if (this.worldRec) {
      const s = this.settings();
      let energy = 0;
      let px = 0;
      let py = 0;
      for (const m of this.members) {
        if (m.role !== 'body' || w.type[m.index] !== BodyType.Dynamic) continue;
        energy += w.kinetic(m.index) + this.midPotential(m.index);
        px += (w.mass[m.index] as number) * (w.vx[m.index] as number);
        py += (w.mass[m.index] as number) * (w.vy[m.index] as number);
      }
      energy += this.springEnergy();
      const cell: Cell = { defined: true, value: { ...s, time: this.t0 + this.n / this.rate, energy, momentumX: px, momentumY: py, awake: w.awakeCount(), contacts: w.contactCount } satisfies WorldValue };
      this.lastCells.set(this.worldRec.id, cell);
      this.written.add(this.worldRec.id);
      if (this.acc.write(this.worldRec, cell)) changed.push(this.worldRec);
    }
    return changed;
  }

  private writeEmpty(): ObjRec[] {
    this.lastCells.clear();
    return [];
  }

  /* ------------------------------ cloth (round 9; design 9.5, 9.6) ------------------------------ */

  private clothOf(r: ObjRec): ClothValue | undefined {
    const s = this.clothSpecs.get(r.id);
    const v = s ?? (!this.written.has(r.id) && r.cell.defined && isClothValue(r.cell.value) ? r.cell.value : undefined);
    if (!v || v.spec.space) return undefined;
    if (!s) this.clothSpecs.set(r.id, v);
    return v;
  }

  /** Every cloth of the world in one set, in figure order, with its `pins` and the `Pin` lines on it. */
  private buildCloth(world: World2, members: readonly Member[]): void {
    this.cloth = undefined;
    this.clothMembers = [];
    this.pinMembers = [];
    const list: { rec: ObjRec; v: ClothValue }[] = [];
    for (const r of this.clothRecs) {
      const v = this.clothOf(r);
      if (v) list.push({ rec: r, v });
    }
    if (list.length === 0) return;
    const extra = new Map<ClothSpec, PinDef[]>();
    for (const r of this.pinRecs) {
      const pv = r.cell.defined && isPinValue(r.cell.value) ? r.cell.value : undefined;
      if (!pv || pv.space) continue;
      let body = -1;
      if (pv.body) {
        const b = this.endIndex({ spec: pv.body as BodySpec } as JointEnd, members);
        if (b === undefined) continue;
        body = b;
      }
      const key = list.find((l) => l.v.spec === pv.cloth || sameValue(l.v.spec, pv.cloth))?.v.spec;
      if (!key) continue;
      const arr = extra.get(key) ?? [];
      arr.push({ point: pv.point, body });
      extra.set(key, arr);
      this.pinMembers.push(r);
    }
    const c = new Cloth2(list.map(({ v }) => clothDef(v.spec, extra.get(v.spec) ?? [])));
    c.sleeping = world.sleeping;
    c.smokes = this.smokeMembers.map((sm) => sm.grid);
    c.attach(world);
    this.cloth = c;
    this.clothMembers = list.map(({ rec, v }, index) => ({ rec, value: v, index }));
  }

  /** The wind of this step (a formula of `t` is read at each step) and the grabs the log holds at step n. */
  private clothInputs(c: Cloth2, n: number): void {
    const wv = this.varySet.has(this.worldRec as ObjRec) && this.worldRec?.cell.defined && isWorldValue(this.worldRec.cell.value) ? this.worldRec.cell.value : this.settings();
    c.windX = wv.windX;
    c.windY = wv.windY;
    c.windZ = 0;
    c.releaseAll();
    if (!this.log.some((e) => e.kind === 'cgrab')) return;
    const held = new Map<string, { x: number; y: number } | undefined>();
    for (const e of this.log) {
      if (e.n > n) break;
      if (e.kind === 'cgrab') held.set(`${e.id}:${e.point}`, { x: e.x, y: e.y });
      else if (e.kind === 'crelease') held.set(`${e.id}:${e.point}`, undefined);
      else if (e.kind === 'reset') held.clear();
    }
    for (const [key, to] of held) {
      if (!to) continue;
      const [id, point] = key.split(':');
      const m = this.clothMembers.find((cm) => String(cm.rec.id) === id);
      const info = m ? c.cloths[m.index] : undefined;
      if (!info) continue;
      const i = info.p0 + Number(point);
      if (i < info.p0 + info.n) c.grab(i, to.x, to.y, 0);
    }
  }

  private stepCloth(c: Cloth2, w: World2, h: number): void {
    this.clothInputs(c, this.n - 1);
    c.sleeping = w.sleeping;
    c.step(w, h);
    const t = Number((this.t0 + this.n / this.rate).toFixed(3));
    for (const cm of this.clothMembers) {
      const info = c.cloths[cm.index];
      if (!info) continue;
      const torn = c.tornNow[cm.index] as number;
      if (torn > 0 && !this.sampling && this.n > this.frontier) {
        this.events.push({ t: this.t0 + this.n / this.rate, kind: 'torn', name: cm.rec.p.name, links: torn });
        this.warnOnce(`torn:${cm.rec.id}`, makeNotice('torn', { name: cm.rec.p.name, t, links: info.torn }, [cm.rec.p.name]));
      }
      if (info.unstable) this.warnOnce(`unstable-cloth:${cm.rec.id}`, makeNotice('unstable_world', { name: cm.rec.p.name, t, hint: 'lower stretch a little, or add damping' }, [cm.rec.p.name]));
    }
  }

  /** Each cloth's points where they are (between the last two steps), and its readouts. */
  private writeCloth(alpha: number, changed: ObjRec[]): void {
    const c = this.cloth;
    if (!c) return;
    for (const cm of this.clothMembers) {
      const info = c.cloths[cm.index];
      if (!info) continue;
      let cell: Cell;
      if (info.unstable) cell = { defined: false, reason: 'unstable_world' };
      else {
        const n = info.n;
        const xs = new Float64Array(n);
        const ys = new Float64Array(n);
        const zs = new Float64Array(n);
        for (let k = 0; k < n; k++) {
          const i = info.p0 + k;
          const sx = c.sx[i] as number;
          const sy = c.sy[i] as number;
          xs[k] = sx + ((c.x[i] as number) - sx) * alpha;
          ys[k] = sy + ((c.y[i] as number) - sy) * alpha;
        }
        const cut = c.threadCuts(cm.index);
        const pinsAt: number[] = [];
        for (let q = info.pin0; q < info.pin0 + info.pinN; q++) {
          const i = (c.pinPoint[q] as number) - info.p0;
          pinsAt.push(xs[i] as number, ys[i] as number, 0);
        }
        const touching = c.touching(cm.index).map((b) => this.nameOfIndex[b] ?? '').filter((s) => s !== '');
        cell = { defined: true, value: { ...cm.value, xs, ys, zs, cut, torn: info.torn, stretchMax: c.stretchMax(cm.index), energy: c.energy(cm.index), asleep: info.asleep, touching, pinsAt } satisfies ClothValue };
      }
      this.lastCells.set(cm.rec.id, cell);
      this.written.add(cm.rec.id);
      if (this.acc.write(cm.rec, cell)) changed.push(cm.rec);
    }
  }

  /** The point of a cloth nearest a point now (for a drag). */
  clothPointNear(id: ObjId, x: number, y: number): number | undefined {
    const m = this.clothMembers.find((cm) => cm.rec.id === id);
    if (m && this.cloth) {
      const info = this.cloth.cloths[m.index];
      if (info) return this.cloth.nearest(m.index, x, y, 0) - info.p0;
    }
    const r = this.acc.byId(id);
    const v = r?.cell.defined && isClothValue(r.cell.value) ? r.cell.value : undefined;
    if (!v) return undefined;
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < v.xs.length; k++) {
      const d = ((v.xs[k] as number) - x) ** 2 + ((v.ys[k] as number) - y) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    return best;
  }

  /** The learner takes hold of point `point` of a cloth and moves it to (x, y) (logged with the point's index, ui.md 4). */
  grabCloth(id: ObjId, point: number, x: number, y: number): boolean {
    if (this.remote) return this.sendInput(id, undefined, 'grab', [point, x, y]);
    if (!this.clothMembers.some((cm) => cm.rec.id === id)) return false;
    this.addEntry({ kind: 'cgrab', n: this.gridAt(this.acc.clockT()), id, point, x, y });
    return true;
  }

  releaseCloth(id: ObjId, point: number): void {
    if (this.remote) {
      this.sendInput(id, undefined, 'release', [point]);
      return;
    }
    if (!this.clothMembers.some((cm) => cm.rec.id === id)) return;
    this.addEntry({ kind: 'crelease', n: this.gridAt(this.acc.clockT()), id, point });
  }

  /** The forces the pins of a cloth carry now (N), summed. */
  pinForce(id: ObjId): { x: number; y: number } | undefined {
    const m = this.clothMembers.find((cm) => cm.rec.id === id);
    if (!m || !this.cloth) return undefined;
    const f = this.cloth.pinForce3(m.index);
    return { x: f.x, y: f.y };
  }

  /* ------------------------------ for actions ------------------------------ */

  /** The body of an object, or of one item of a list of bodies (0-based). */
  memberOf(id: ObjId, item?: number): Member | undefined {
    for (const m of this.members) if (m.rec.id === id && m.item === item) return m;
    return undefined;
  }

  /** Which object (and list item) a body value belongs to, from its start. */
  ownerOf(spec: BodySpec): { id: ObjId; item?: number } | undefined {
    for (const m of this.members) if (m.spec === spec) return { id: m.rec.id, ...(m.item !== undefined ? { item: m.item } : {}) };
    return undefined;
  }

  /** Push(b, impulse, at?): logged at the next step (design 5.4). */
  push(id: ObjId, x: number, y: number, at?: { x: number; y: number }, item?: number): boolean {
    if (this.remote) return this.sendInput(id, item, 'push', [x, y, ...(at ? [at.x, at.y] : [])]);
    if (!this.memberOf(id, item)) return false;
    const n = this.gridAt(this.acc.clockT());
    this.addEntry({ kind: 'push', n, id, ...(item !== undefined ? { item } : {}), x, y, ...(at ? { ax: at.x, ay: at.y } : {}) });
    return true;
  }

  /** The learner takes hold of a body at a point (world space) and moves the pointer. */
  grab(id: ObjId, x: number, y: number, at?: { x: number; y: number }, item?: number): boolean {
    if (this.remote) return this.remoteGrab(id, x, y, at, item);
    const m = this.memberOf(id, item);
    if (!m || !this.world) return false;
    const w = this.world;
    const i = m.index;
    const n = this.gridAt(this.acc.clockT());
    const mine = (e: LogEntry): boolean => (e.kind === 'grab' || e.kind === 'release') && e.id === id && e.item === item;
    const g = this.log.filter((e) => e.kind === 'grab' && mine(e)).at(-1) as (LogEntry & { kind: 'grab' }) | undefined;
    const released = this.log.filter(mine).at(-1)?.kind !== 'grab';
    let ax: number;
    let ay: number;
    if (g && !released) {
      ax = g.ax;
      ay = g.ay;
    } else {
      const p = at ?? { x, y };
      const c = w.qc[i] as number;
      const s = w.qs[i] as number;
      const dx = p.x - (w.px[i] as number);
      const dy = p.y - (w.py[i] as number);
      // rounded as the `@input` line writes it, so the film plays the same after a reload (a body resting a hair into
      // the ground gave an anchor with more digits than the line keeps)
      ax = Number(num(c * dx + s * dy));
      ay = Number(num(-s * dx + c * dy));
    }
    this.addEntry({ kind: 'grab', n, id, ...(item !== undefined ? { item } : {}), x: Number(num(x)), y: Number(num(y)), ax, ay });
    return true;
  }

  release(id: ObjId, item?: number): void {
    if (this.remote) {
      this.sendInput(id, item, 'release', []);
      this.grabAnchor.delete(`${id}:${item ?? ''}`);
      return;
    }
    if (!this.memberOf(id, item)) return;
    this.addEntry({ kind: 'release', n: this.gridAt(this.acc.clockT()), id, ...(item !== undefined ? { item } : {}) });
  }

  restart(): void {
    if (this.remote) {
      this.queueLine(`@input physics reset at ${String(Number(this.acc.clockT().toFixed(6)))}`);
      return;
    }
    this.addEntry({ kind: 'reset', n: this.gridAt(this.acc.clockT()) });
  }

  onRestart(): void {
    if (this.world) this.restart();
  }

  /**
   * After the flush: each new hit runs the `on … hit` handlers of both objects, with `speed`, `other`, `point` and
   * `impulse` (design 2.4). At most 24 runs a film second, as sounds are limited.
   */
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
        runHandler(this.figure, target, 'hit', { by: 'host', extra: { speed: h.speed, other: other.replace(/\[\d+\]$/, ''), point: { x: h.x, y: h.y }, impulse: h.impulse } }, 'host');
      }
    }
  }

  wake(id: ObjId, awake: boolean, item?: number): boolean {
    const m = this.memberOf(id, item);
    if (!m || !this.world) return false;
    if (awake) this.world.wakeBody(m.index);
    else this.world.sleepBody(m.index);
    return true;
  }

  /* ------------------------------ in a worker (design 9.6; core hook 7) ------------------------------ */

  /** True while the world runs in a worker: this driver writes the cells it is sent and steps nothing. */
  remote = false;
  private remoteCells = new Map<string, Cell>();
  /** `@input` lines made on the page (pushes, grabs, restarts) not yet sent to the worker, and all of them, for saving. */
  private outbox: string[] = [];
  private remoteLog: string[] = [];
  private grabAnchor = new Map<string, { ax: number; ay: number }>();
  /** The world in the worker: drops and steps, for the time bar readout. */
  remoteInfo: { drops: number; awake: number; contacts: number; hash: string; cloth?: number } = { drops: 0, awake: 0, contacts: 0, hash: '' };

  /** Hands the world to a worker (or takes it back: then it is built again here, from its start). */
  setRemote(on: boolean): void {
    if (this.remote === on) return;
    this.remote = on;
    this.remoteCells = new Map();
    this.outbox = [];
    if (!on) {
      // the page's own log is the worker's: each line goes back in, then the film is built and played here
      const lines = this.remoteLog;
      this.remoteLog = [];
      // the worker's log already holds the page's earlier entries: start the log afresh, or each would count twice
      this.log = [];
      this.base = new Map();
      this.logged = new Set();
      this.sig = undefined;
      this.version = -1;
      for (const l of lines) this.inputLine(l.replace(/^@input\s+/, '').split(/\s+/));
    } else {
      this.remoteLog = this.inputLines();
      this.world = undefined;
      this.fluid = undefined;
      this.waveMembers = [];
      this.smokeMembers = [];
      this.sig = undefined;
    }
  }

  /** The cells the worker computed for a frame: they are written on the next pass. */
  accept(cells: readonly (readonly [string, Cell])[], info?: { drops: number; awake: number; contacts: number; hash: string; cloth?: number }, log?: readonly string[]): void {
    for (const [name, cell] of cells) this.remoteCells.set(name, cell);
    if (info) this.remoteInfo = info;
    // the worker's own log holds what it logged itself (a slider moved while the film played, round 6's carry-over): it,
    // plus the page's lines not sent yet, is the film's, so a reload of the script in the worker keeps them (round 7)
    if (log) this.remoteLog = [...log, ...this.outbox.filter((l) => !log.includes(l))];
  }

  /** The page's new `@input` lines for the worker, once. */
  takeOutbox(): string[] {
    return this.outbox.splice(0, this.outbox.length);
  }

  /** Forgets the lines not yet sent: a fresh copy of the script, which holds them, goes to the worker. */
  clearOutbox(): void {
    this.outbox = [];
  }

  /** The cells of every object the world owns now, by name, for the page (and the typed arrays in them to move). */
  ownedCells(): { cells: [string, Cell][]; transfer: ArrayBuffer[] } {
    const cells: [string, Cell][] = [];
    const transfer: ArrayBuffer[] = [];
    const seen = new Set<ObjId>();
    const add = (rec: ObjRec): void => {
      if (seen.has(rec.id)) return;
      seen.add(rec.id);
      const c = this.lastCells.get(rec.id);
      if (!c) return;
      cells.push([rec.p.name, c]);
      collectBuffers(c.defined ? c.value : undefined, transfer, 0);
    };
    for (const m of this.members) if (m.role === 'body') add(m.rec);
    for (const j of this.jointMembers) add(j.rec);
    for (const w of this.wheelMembers) add(w.rec);
    for (const r of this.vehicleRecs) add(r);
    for (const l of this.liquidMembers) add(l.rec);
    for (const m of this.waveMembers) add(m.rec);
    for (const s of this.smokeMembers) add(s.rec);
    for (const c of this.clothMembers) add(c.rec);
    if (this.worldRec) add(this.worldRec);
    return { cells, transfer };
  }

  private queueLine(line: string): void {
    this.outbox.push(line);
    this.remoteLog.push(line);
  }

  private sendInput(id: ObjId, item: number | undefined, kind: string, nums: readonly number[]): boolean {
    const base = this.acc.byId(id)?.p.name;
    if (!base || !this.remoteCells.has(base)) return false;
    const nm = item !== undefined ? `${base}[${item + 1}]` : base;
    const t = String(Number(this.acc.clockT().toFixed(6)));
    this.queueLine(`@input physics ${kind} ${nm}${nums.map((x) => ` ${num(x)}`).join('')} at ${t}`);
    return true;
  }

  /** A grab while the worker has the world: the point taken, in the body's frame, from the pose the page shows now. */
  private remoteGrab(id: ObjId, x: number, y: number, at: { x: number; y: number } | undefined, item: number | undefined): boolean {
    const base = this.acc.byId(id)?.p.name;
    const c = base ? this.remoteCells.get(base) : undefined;
    const v = c?.defined ? (item !== undefined && Array.isArray(c.value) ? (c.value as unknown[])[item] : c.value) : undefined;
    if (!isBodyValue(v)) return false;
    const key = `${id}:${item ?? ''}`;
    let a = this.grabAnchor.get(key);
    if (!a) {
      const p = at ?? { x, y };
      const cs = cos(v.angle);
      const sn = sin(v.angle);
      const dx = p.x - v.x;
      const dy = p.y - v.y;
      a = { ax: cs * dx + sn * dy, ay: -sn * dx + cs * dy };
      this.grabAnchor.set(key, a);
    }
    return this.sendInput(id, item, 'grab', [x, y, a.ax, a.ay]);
  }

  private writeRemote(): ObjRec[] {
    const changed: ObjRec[] = [];
    for (const [name, cell] of this.remoteCells) {
      const r = this.acc.byName(name);
      if (!r) continue;
      this.lastCells.set(r.id, cell);
      this.written.add(r.id);
      if (this.acc.write(r, cell)) changed.push(r);
    }
    return changed;
  }

  /** The world is built (or held by a worker): a rule run of an owned object keeps the pose. */
  private live(): boolean {
    return this.world !== undefined || this.remote;
  }

  /** The index of an object in the world, for drawing and tests. */
  indexOf(id: ObjId): number | undefined {
    return this.byId.get(id)?.index;
  }

  /** Contact points now, for `world with show = "contacts"`. */
  contactPoints(): { x: number; y: number; nx: number; ny: number }[] {
    return this.world ? this.world.contactPoints() : [];
  }

  /** The solid shapes' walls now (world space), for drawing movers where the physics has them. */
  stepsPerSecond(): number {
    return this.rate;
  }
}

/** A wheel, or a list of wheels. */
function isWheelRec(r: ObjRec): boolean {
  const t = r.p.type;
  return t.k === 'Wheel' || (t.k === 'List' && t.of?.k === 'Wheel');
}

/** A joint, or a list of joints (`Seq(Rope(…), k, 1, 5)`). */
function isJointRec(r: ObjRec): boolean {
  const t = r.p.type;
  return t.k === 'Joint' || (t.k === 'List' && t.of?.k === 'Joint');
}

/** `g = Ground()` is solid without saying so. */
function isGround(r: ObjRec): boolean {
  const n = r.p.node;
  return n.k === 'define' && n.expr.k === 'call' && n.expr.callee === 'Ground';
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

const num = (x: number): string => String(Number(x.toPrecision(10)));

function numWords(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return num(v);
  if (typeof v === 'object' && v !== null && typeof (v as { x?: unknown }).x === 'number' && typeof (v as { y?: unknown }).y === 'number') return `${num((v as { x: number }).x)} ${num((v as { y: number }).y)}`;
  return undefined;
}

function sameSpec(cell: Cell, computed: unknown): boolean {
  return cell.defined && isBodyValue(cell.value) && isBodyValue(computed) && (cell.value.spec === computed.spec || sameValue(cell.value.spec, computed.spec));
}

/** The translation and turn that carry one set of shapes to another with the same corners (a moving solid). */
const REST = Object.freeze({ vx: 0, vy: 0, w: 0 });

function rigidMotion(a: readonly ShapeDef2[], b: readonly ShapeDef2[], h: number): { vx: number; vy: number; w: number } {
  const pa: { x: number; y: number }[] = [];
  const pb: { x: number; y: number }[] = [];
  for (let k = 0; k < a.length && k < b.length; k++) {
    const sa = a[k] as ShapeDef2;
    const sb = b[k] as ShapeDef2;
    if (sa.kind === 'circle' && sb.kind === 'circle') {
      pa.push({ x: sa.x, y: sa.y });
      pb.push({ x: sb.x, y: sb.y });
    } else if (sa.kind === 'poly' && sb.kind === 'poly') {
      for (let q = 0; q < sa.pts.length && q < sb.pts.length; q++) {
        pa.push(sa.pts[q] as { x: number; y: number });
        pb.push(sb.pts[q] as { x: number; y: number });
      }
    }
  }
  if (pa.length === 0) return { vx: 0, vy: 0, w: 0 };
  let ax = 0;
  let ay = 0;
  let bx = 0;
  let by = 0;
  for (let k = 0; k < pa.length; k++) {
    ax += (pa[k] as { x: number }).x;
    ay += (pa[k] as { y: number }).y;
    bx += (pb[k] as { x: number }).x;
    by += (pb[k] as { y: number }).y;
  }
  ax /= pa.length;
  ay /= pa.length;
  bx /= pa.length;
  by /= pa.length;
  let sxy = 0;
  let sxx = 0;
  for (let k = 0; k < pa.length; k++) {
    const ux = (pa[k] as { x: number }).x - ax;
    const uy = (pa[k] as { y: number }).y - ay;
    const vx = (pb[k] as { x: number }).x - bx;
    const vy = (pb[k] as { y: number }).y - by;
    sxy += ux * vy - uy * vx;
    sxx += ux * vx + uy * vy;
  }
  const th = pa.length > 1 && (sxx !== 0 || sxy !== 0) ? atan2(sxy, sxx) : 0;
  const w = th / h;
  const vcx = (bx - ax) / h;
  const vcy = (by - ay) / h;
  // the world frame of a solid is the origin: carry the centre's speed to it
  return { vx: vcx + w * ay, vy: vcy - w * ax, w };
}

/** What a wave line is built from (not its heights): equal keys give the same film. */
function wavesKey2(v: WavesValue): unknown[] {
  return [v.space, v.nx, v.x0, v.dx, v.level, v.depth, v.damping];
}
