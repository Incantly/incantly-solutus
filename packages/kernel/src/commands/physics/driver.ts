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
import { atan2 } from '../../physics/math';
import { solidShapeOf } from './shapes';
import type { BodySpec, BodyValue, WorldValue } from './types';
import { DEFAULT_WORLD, isBodyValue, isWorldValue } from './types';

/** Checkpoints every half second of film (design 10.3). */
const CHECKPOINT_SECONDS = 0.5;
/** Memory for checkpoints per figure, in bytes (design 10.3). */
export const CHECKPOINT_BYTES = 32 * 1024 * 1024;
/** Body steps one pass may take before it shows where it got to and catches up on the next frames (design 10.4). */
const STEP_BUDGET = 60000;
const BLOW_UP = 1e6;

export type LogEntry =
  | { readonly kind: 'push'; readonly n: number; readonly id: ObjId; readonly x: number; readonly y: number; readonly ax?: number; readonly ay?: number }
  | { readonly kind: 'grab'; readonly n: number; readonly id: ObjId; readonly x: number; readonly y: number; readonly ax: number; readonly ay: number }
  | { readonly kind: 'release'; readonly n: number; readonly id: ObjId }
  | { readonly kind: 'set'; readonly n: number; readonly id: ObjId; readonly value: unknown }
  | { readonly kind: 'reset'; readonly n: number };

/** Body properties a `with` line may set (design 2.4). */
export const BODY_PROPS = ['bounce', 'friction', 'force', 'torque', 'bullet', 'group', 'charge'] as const;

interface Member {
  readonly rec: ObjRec;
  readonly role: 'body' | 'solid';
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
  private worldRec: ObjRec | undefined;
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
  private hitN = 0;

  constructor(readonly figure: Figure) {
    this.acc = figure.driverAccess();
  }

  /* ------------------------------ the driver hooks ------------------------------ */

  onCompute(rec: ObjRec, computed: Cell): Cell | undefined {
    if (rec.p.type.k === 'List' && rec.p.type.of?.k === 'Body') {
      if (computed.defined && Array.isArray(computed.value)) this.listSpecs.set(rec.id, (computed.value as unknown[]).map((v) => (isBodyValue(v) ? v : undefined)));
      else this.listSpecs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      if (last && computed.defined && this.world && last.defined && Array.isArray(last.value) && Array.isArray(computed.value) && last.value.length === computed.value.length && (last.value as unknown[]).every((v, i) => sameSpec({ defined: true, value: v }, (computed.value as unknown[])[i]))) return last;
      return undefined;
    }
    if (rec.p.type.k === 'Body') {
      if (computed.defined && isBodyValue(computed.value)) this.specs.set(rec.id, computed.value);
      else this.specs.delete(rec.id);
      const last = this.lastCells.get(rec.id);
      if (last && computed.defined && this.world && sameSpec(last, computed.value)) return last;
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
    const policy = this.moverInputs.has(rec.id) && !this.startInputs.has(rec.id) ? 'continue' : this.acc.rerunOf(rec);
    if (policy !== 'continue' || this.startInputs.has(rec.id)) return;
    if (!this.base.has(rec.id)) this.base.set(rec.id, was);
    this.addEntry({ kind: 'set', n: this.gridAt(t), id: rec.id, value: rec.p.value });
    this.logged.add(rec.id);
    this.coneDirty = true;
  }

  inputLine(words: readonly string[]): string | undefined | false {
    if (words[0] !== 'physics') return false;
    const kind = words[1];
    const at = Number(words[words.length - 1]);
    if (words[words.length - 2] !== 'at' || !Number.isFinite(at)) return 'a time at the end: @input physics push b 1 0 at 2.5';
    const n = Math.max(0, Math.round((at - this.t0) * this.rate));
    if (kind === 'reset') {
      this.addEntry({ kind: 'reset', n });
      return undefined;
    }
    const rec = this.acc.byName(words[2] ?? '');
    if (!rec) return `an object named ${words[2] ?? ''}`;
    const isBase = words[3] === 'base';
    const nums = words.slice(isBase ? 4 : 3, -2).map(Number);
    if (nums.some((x) => !Number.isFinite(x))) return 'numbers';
    if (kind === 'push' && nums.length >= 2) this.addEntry({ kind: 'push', n, id: rec.id, x: nums[0] as number, y: nums[1] as number, ...(nums.length >= 4 ? { ax: nums[2] as number, ay: nums[3] as number } : {}) });
    else if (kind === 'grab' && nums.length >= 4) this.addEntry({ kind: 'grab', n, id: rec.id, x: nums[0] as number, y: nums[1] as number, ax: nums[2] as number, ay: nums[3] as number });
    else if (kind === 'release') this.addEntry({ kind: 'release', n, id: rec.id });
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
    return this.byId.has(id) || this.worldRec?.id === id;
  }

  sampleRecs(): readonly ObjRec[] {
    return [...new Set(this.members.filter((m) => m.role === 'body').map((m) => m.rec))];
  }

  /** The bodies' cells at a film time, without moving the film (traces and `ValueAt` read it). */
  sample(t: number): readonly (readonly [ObjRec, Cell])[] | undefined {
    if (!this.world) return undefined;
    const keep = this.world.save();
    const keepN = this.n;
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
      this.world.load(keep);
      this.n = keepN;
      this.prevX = kx;
      this.prevY = ky;
      this.prevA = ka;
    }
  }

  /* ------------------------------ after each pass ------------------------------ */

  afterPass(): readonly ObjRec[] {
    this.scan();
    if (this.bodyRecs.length === 0 && this.solidRecs.length === 0 && !this.world) return [];
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
    this.worldRec = undefined;
    for (const r of this.acc.list) {
      const k = r.p.type.k;
      if (k === 'Body' || (k === 'List' && r.p.type.of?.k === 'Body')) this.bodyRecs.push(r);
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
    sig.push(this.varyingWorld ? 'varying' : [w.gx, w.gy, w.air, w.passes, w.rate, w.sleep, w.range]);
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
    if (defs.length === 0) {
      this.world = undefined;
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
    for (const m of members) if (m.role === 'body' && m.spec && m.spec.parts > 1) this.warnOnce(`split:${m.rec.id}:${m.spec.parts}`, makeNotice('split_shape', { name: m.rec.p.name, parts: m.spec.parts }, [m.rec.p.name]));
    this.n = 0;
    this.prevX = Float64Array.from(world.px);
    this.prevY = Float64Array.from(world.py);
    this.prevA = Float64Array.from(world.ang);
    this.checkpoints = new Map();
    this.cpStride = Math.max(1, Math.round(CHECKPOINT_SECONDS * this.rate));
    this.cpBytes = 0;
    this.failedAt = new Map();
    this.leftAt = new Map();
    this.grabs = new Map();
    this.hitN = 0;
    this.findCone();
    this.applyStatic();
    this.saveCheckpoint(0);
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
    const targets: ObjRec[] = [...this.solidRecs];
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
      const v = r.usesClock || this.logged.has(r.id) || r.inputs.some((i) => vary.has(i) || bodies.has(i));
      if (v) vary.add(r);
    }
    this.varySet = vary;
    this.bodyVaries = new Set(this.bodyRecs.filter((r) => r.usesClock || r.inputs.some((i) => vary.has(i))));
    this.cone = all.filter((r) => vary.has(r) && r.p.kind === 'rule' && !bodies.has(r));
    this.readsBodies = all.some((r) => vary.has(r) && r.inputs.some((i) => bodies.has(i)));
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
        w.load(cp);
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
    const perStep = Math.max(1, w.awakeCount() + 1);
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
    this.applyGrabs();
    if (n === 0) {
      // leapfrog start: the first step takes half a step of the forces off the start speed, so a body in free flight
      // follows x0 + v0 t + a t² / 2 exactly at every step (design 11.5, projectile)
      for (const m of this.members) {
        const i = m.index;
        if (m.role !== 'body' || w.type[i] !== BodyType.Dynamic) continue;
        const im = w.invM[i] as number;
        w.vx[i] = (w.vx[i] as number) - 0.5 * h * (w.gx + im * (w.fx[i] as number));
        w.vy[i] = (w.vy[i] as number) - 0.5 * h * (w.gy + im * (w.fy[i] as number));
      }
    }
    this.prevX.set(w.px);
    this.prevY.set(w.py);
    this.prevA.set(w.ang);
    w.step(h);
    this.n = n + 1;
    this.prevStale = false;
    this.checkHealth();
    for (const i of w.left) if (!this.leftAt.has(i)) this.leftAt.set(i, this.n);
    if (this.n > this.hitN) {
      for (const hit of w.hits) this.hits.push({ t: this.t0 + this.n / this.rate, a: this.nameOfIndex[hit.a] ?? '', b: this.nameOfIndex[hit.b] ?? '', speed: hit.speed, x: hit.x, y: hit.y, impulse: hit.impulse });
      this.hitN = this.n;
    }
    if (this.n % this.cpStride === 0 && !this.checkpoints.has(this.n)) this.saveCheckpoint(this.n);
  }

  private saveCheckpoint(n: number): void {
    const s = (this.world as World2).save();
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
        this.world.load(cp);
        this.n = best;
      }
    }
  }

  /** The log as `@input physics …` lines, saved with the script. */
  inputLines(): string[] {
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
      const nm = name(e.id);
      if (!nm) continue;
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
          w.load(cp);
          w.stepIndex = keepStep;
        }
        this.grabs.clear();
        continue;
      }
      const m = this.byId.get(e.id);
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
      const mv = rigidMotion(old, sh.shapes, h);
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
    const ke = w.kinetic(i);
    const pe = w.potential(i);
    return {
      schema: 'Body', spec: sp, x, y, angle, vx: w.vx[i] as number, vy: w.vy[i] as number, spin: w.w[i] as number, asleep: w.type[i] === BodyType.Dynamic && w.awake[i] === 0,
      mass: sp.fixed ? Infinity : (w.mass[i] as number), inertia: w.inertia[i] as number, energy: ke + pe, kinetic: ke, potential: pe, touching: [], moving: this.n > 0,
    };
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
    // bodies whose start is undefined stay as their rule left them
    if (this.worldRec) {
      const s = this.settings();
      let energy = 0;
      let px = 0;
      let py = 0;
      for (const m of this.members) {
        if (m.role !== 'body' || w.type[m.index] !== BodyType.Dynamic) continue;
        energy += w.kinetic(m.index) + w.potential(m.index);
        px += (w.mass[m.index] as number) * (w.vx[m.index] as number);
        py += (w.mass[m.index] as number) * (w.vy[m.index] as number);
      }
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

  /* ------------------------------ for actions ------------------------------ */

  /** Push(b, impulse, at?): logged at the next step (design 5.4). */
  push(id: ObjId, x: number, y: number, at?: { x: number; y: number }): boolean {
    if (!this.byId.has(id)) return false;
    const n = this.gridAt(this.acc.clockT());
    this.addEntry({ kind: 'push', n, id, x, y, ...(at ? { ax: at.x, ay: at.y } : {}) });
    return true;
  }

  /** The learner takes hold of a body at a point (world space) and moves the pointer. */
  grab(id: ObjId, x: number, y: number, at?: { x: number; y: number }): boolean {
    const m = this.byId.get(id);
    if (!m || !this.world) return false;
    const w = this.world;
    const i = m.index;
    const n = this.gridAt(this.acc.clockT());
    const g = this.log.filter((e) => e.kind === 'grab' && e.id === id).at(-1) as (LogEntry & { kind: 'grab' }) | undefined;
    const released = this.log.filter((e) => (e.kind === 'release' || e.kind === 'grab') && e.id === id).at(-1)?.kind !== 'grab';
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
      ax = c * dx + s * dy;
      ay = -s * dx + c * dy;
    }
    this.addEntry({ kind: 'grab', n, id, x, y, ax, ay });
    return true;
  }

  release(id: ObjId): void {
    if (!this.byId.has(id)) return;
    this.addEntry({ kind: 'release', n: this.gridAt(this.acc.clockT()), id });
  }

  restart(): void {
    this.addEntry({ kind: 'reset', n: this.gridAt(this.acc.clockT()) });
  }

  onRestart(): void {
    if (this.world) this.restart();
  }

  wake(id: ObjId, awake: boolean): boolean {
    const m = this.byId.get(id);
    if (!m || !this.world) return false;
    if (awake) this.world.wakeBody(m.index);
    else this.world.sleepBody(m.index);
    return true;
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
