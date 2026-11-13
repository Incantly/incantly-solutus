/**
 * States and rates (core design 7.2, docs/features/animation-time/design.md section 7): the solver advances every
 * `state(...)` object with fixed-step fourth-order Runge-Kutta, so results do not depend on frame rate or seek path.
 *
 * Step 1/240 s (or `@solver step 1/n`), checkpoints every 120 steps (0.5 s), cubic Hermite dense output between grid
 * points. A seek restores the latest checkpoint at or before the target and integrates forward. A value or a line that
 * changes what a rate reads restarts the states from their initial values and replays to the current time.
 * Deterministic: no wall clock, no random source.
 */
import type { Notice } from '../contracts/errors';
import type { ObjId } from '../contracts/values';
import { makeNotice } from '../errors/notices';
import type { ObjRec } from '../graph/core';
import type { Cell } from '../graph/types';
import { sameValue } from '../graph/values';
import { evaluate } from '../language/compile';
import type { Env } from '../language/runtime';

/** What the solver needs from the figure. */
export interface SolverAccess {
  readonly list: readonly ObjRec[];
  /** The state objects (any order). */
  readonly states: () => ReadonlySet<ObjRec>;
  readonly env: Env;
  readonly byId: (id: ObjId) => ObjRec | undefined;
  readonly version: () => number;
  readonly clockT: () => number;
  /** The film start (`@clock a..b`), default 0. */
  readonly t0: () => number;
  /** The step as `1/n` (`@solver step 1/480`), default 240. */
  readonly stepsPerSecond: () => number;
  readonly ancestorRecs: (seeds: readonly ObjRec[]) => ObjRec[];
  readonly downOf: (r: ObjRec) => Int32Array;
  readonly compute: (r: ObjRec) => Cell;
  readonly ensureSlots: (n: number) => void;
  /** Writes a cell without events or change tracking beyond what a normal write does. */
  readonly write: (r: ObjRec, c: Cell) => boolean;
  /** What a change of this input does while a film runs (design 8.3): `continue` from now on, or `restart` the film. */
  readonly rerunOf?: (r: ObjRec) => 'continue' | 'restart';
}

/** One change of a solver input while a film runs (design 8.2). Applied at grid step `n`, the first at or after `t`. */
export type LogEntry =
  | { readonly kind: 'set'; readonly t: number; readonly n: number; readonly id: ObjId; readonly value: unknown }
  | { readonly kind: 'reset'; readonly t: number; readonly n: number };

/** The most entries the input log keeps (errors 6). The oldest go first. */
export const MAX_LOG_ENTRIES = 10000;

interface Layout {
  readonly rec: ObjRec;
  readonly offset: number;
  readonly point: boolean;
  readonly order: number;
  /** The connected group of states this one belongs to (states whose rates read each other, directly or not). */
  group: number;
}

const CHECKPOINT_STEPS = 120;
const BLOW_UP = 1e9;
/** The most grid steps one `sync` takes. A seek further than this finishes over the next calls (KERN-SM-5). */
export const MAX_SEEK_STEPS = 400000;
/** The most checkpoints kept; beyond it every second one is dropped and the spacing doubles. */
const MAX_CHECKPOINTS = 2000;

/** What the integration depends on, to tell whether a structure change leaves it valid (KERN-SM-16). */
interface Signature {
  readonly h: number;
  readonly t0: number;
  readonly deps: readonly { readonly rec: ObjRec; readonly free: boolean; readonly value: unknown; readonly rates: unknown }[];
}

export class StateSolver {
  private version = -1;
  private layout: Layout[] = [];
  private dim = 0;
  private cone: ObjRec[] = [];
  private inputs = new Set<ObjId>();
  /** Free objects the rates read (design 8.2): their changes are logged. */
  private rateInputs = new Set<ObjId>();
  /** Free objects the initial values read: a change restarts the film. */
  private initInputs = new Set<ObjId>();
  private log: LogEntry[] = [];
  /** The value each logged input had before its first entry. */
  private base = new Map<ObjId, unknown>();
  private y0: Float64Array | undefined;
  private checkpoints = new Map<number, Float64Array>();
  /** Grid steps between checkpoints; doubles each time the cap is reached. */
  private cpStride = CHECKPOINT_STEPS;
  /** True when the last `at` stopped at the step budget before reaching its target. */
  private short = false;
  private sig: Signature | undefined;
  private curN = -1;
  private curY: Float64Array | undefined;
  /** For each group, the grid step at which it became undefined; `Infinity` while it is healthy. */
  private failedAt: number[] = [];
  private groupNames: string[][] = [];
  /** Groups that failed during the stage or step being computed. */
  private stageBad: boolean[] = [];
  /** The grid step the derivative is being computed for: a group that failed at or before it is frozen. */
  private stepIdx = 0;
  private h = 1 / 240;
  private t0 = 0;
  private dirtyInputs = false;
  readonly warnings: Notice[] = [];
  /** States without a rate rule, by name. */
  missing: string[] = [];

  constructor(private readonly fig: SolverAccess) {}

  /**
   * A free value that a rate or an initial value reads changed. Before the film has started, for an initial value, or with
   * `rerun = restart` (the default, kernel ruling K12), the film restarts with the new value. With `rerun = continue` the
   * change is logged at the current time: the motion before it stays as it was, and it takes effect from that time on.
   */
  noteFree(rec: ObjRec, was?: unknown): void {
    if (!this.inputs.has(rec.id)) return;
    const t = this.fig.clockT();
    const policy = this.fig.rerunOf?.(rec) ?? 'restart';
    if (!this.rateInputs.has(rec.id) || this.initInputs.has(rec.id) || t <= this.t0 + 1e-12 || policy === 'restart') {
      // a restart rewrites the whole history of this input
      if (this.log.some((e) => e.kind === 'set' && e.id === rec.id)) {
        this.log = this.log.filter((e) => !(e.kind === 'set' && e.id === rec.id));
        this.base.delete(rec.id);
      }
      this.dirtyInputs = true;
      return;
    }
    if (!this.base.has(rec.id)) this.base.set(rec.id, was);
    this.addEntry({ kind: 'set', t, n: this.gridAt(t), id: rec.id, value: rec.p.value });
  }

  /** `Restart()`: the states go back to their initial values at the current time (design 7.5). */
  restartStates(): void {
    const t = this.fig.clockT();
    this.addEntry({ kind: 'reset', t, n: this.gridAt(t) });
  }

  /** A saved log entry, read back with the script (`@input`): it goes in as it was, at its grid step. */
  restoreEntry(e: { kind: 'set'; t: number; id: ObjId; value: unknown } | { kind: 'reset'; t: number }): void {
    if (!Number.isFinite(e.t)) return;
    if (e.kind === 'set') {
      if (!this.base.has(e.id)) this.base.set(e.id, this.fig.byId(e.id)?.p.value);
      this.addEntry({ kind: 'set', t: e.t, n: this.gridAt(e.t), id: e.id, value: e.value });
    } else this.addEntry({ kind: 'reset', t: e.t, n: this.gridAt(e.t) });
  }

  /** A saved input's value before its first entry. */
  restoreBase(id: ObjId, value: unknown): void {
    this.base.set(id, value);
    this.dirtyInputs = true;
  }

  /** Each logged input's value before its first entry, for saving. */
  get inputBase(): ReadonlyMap<ObjId, unknown> {
    return this.base;
  }

  /** The input log, oldest first (design 8.2). */
  get inputLog(): readonly LogEntry[] {
    return this.log;
  }

  /** The value an input had at grid step n: its latest logged value at or before n, else its value before the first. */
  private inputAt(id: ObjId, n: number): unknown {
    let v: unknown = this.base.has(id) ? this.base.get(id) : this.fig.byId(id)?.p.value;
    for (const e of this.log) if (e.kind === 'set' && e.id === id && e.n <= n) v = e.value;
    return v;
  }

  private gridAt(t: number): number {
    return Math.max(0, Math.ceil((t - this.t0) / this.h - 1e-9));
  }

  /** Adds an entry: later entries for the same input are its old future, and go (design 8.4); later checkpoints go too. */
  private addEntry(e: LogEntry): void {
    this.rebuild();
    if (e.kind === 'set') {
      const later = this.log.filter((x) => x.kind === 'set' && x.id === e.id && x.n >= e.n);
      if (later.length > 0) {
        this.log = this.log.filter((x) => !later.includes(x));
        const name = this.fig.byId(e.id)?.p.name ?? '';
        this.warnings.push(makeNotice('log_rewrite', { name, from: Number(e.t.toFixed(4)), count: later.length }, [name]));
      }
    }
    this.log.push(e);
    this.log.sort((a, b) => a.n - b.n);
    if (this.log.length > MAX_LOG_ENTRIES) this.log.splice(0, this.log.length - MAX_LOG_ENTRIES);
    for (const k of [...this.checkpoints.keys()]) if (k > e.n) this.checkpoints.delete(k);
    if (this.curN > e.n) {
      this.curN = -1;
      this.curY = undefined;
    }
  }

  /** Puts the logged inputs' values for grid step n into their cells, and applies a reset due at n. */
  private enter(y: Float64Array, n: number): void {
    for (const id of this.base.keys()) {
      const r = this.fig.byId(id);
      if (!r) continue;
      const v = this.inputAt(id, n);
      r.cell = v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? { defined: false, reason: 'explicit' } : { defined: true, value: v };
    }
    for (const e of this.log) if (e.kind === 'reset' && e.n === n && this.y0) y.set(this.y0);
  }

  /** True when the figure has states at all (a cheap check for the frame loop). */
  get active(): boolean {
    this.rebuild();
    return this.layout.length > 0;
  }

  /** Reads the figure's states and rates when the structure changed. */
  private rebuild(): void {
    if (this.version === this.fig.version() && !this.dirtyInputs) return;
    const rebuilt = this.version !== this.fig.version();
    const restart = this.dirtyInputs;
    this.version = this.fig.version();
    this.dirtyInputs = false;
    const keep = rebuilt && !restart && this.sig !== undefined ? { checkpoints: this.checkpoints, stride: this.cpStride, curN: this.curN, curY: this.curY, y0: this.y0, failedAt: this.failedAt } : undefined;
    this.checkpoints = new Map();
    this.cpStride = CHECKPOINT_STEPS;
    this.curN = -1;
    this.curY = undefined;
    this.short = false;
    this.failedAt = this.failedAt.map(() => Infinity);
    this.y0 = undefined;
    if (!rebuilt) return;
    const states = [...this.fig.states()].sort((a, b) => a.order - b.order);
    this.layout = [];
    this.missing = [];
    let off = 0;
    for (const s of states) {
      const point = s.p.type.k === 'Point';
      const second = s.p.rates?.has(2) === true || s.p.checked.state?.velocity !== undefined;
      const order = second ? 2 : 1;
      this.layout.push({ rec: s, offset: off, point, order, group: 0 });
      off += (point ? 2 : 1) * order;
      if (!s.p.rates?.has(order)) this.missing.push(s.p.name);
    }
    this.dim = off;
    this.h = 1 / Math.max(60, Math.min(4800, this.fig.stepsPerSecond()));
    this.t0 = this.fig.t0();
    // the rate cone: objects between the states and the rate expressions
    const reads: ObjRec[] = [];
    this.inputs = new Set();
    for (const l of this.layout) {
      for (const rr of l.rec.p.rates?.values() ?? []) for (const id of rr.checked.reads) {
        const r = this.fig.byId(id);
        if (r) reads.push(r);
      }
      for (const id of l.rec.p.checked.reads) this.inputs.add(id);
    }
    const anc = this.fig.ancestorRecs(reads);
    const downOfStates = new Set<number>();
    for (const l of this.layout) for (const o of this.fig.downOf(l.rec)) downOfStates.add(o);
    this.cone = anc.filter((r) => r.p.kind === 'rule' && downOfStates.has(r.order));
    this.rateInputs = new Set();
    this.initInputs = new Set();
    for (const r of anc) if (r.p.kind === 'free') {
      this.inputs.add(r.id);
      this.rateInputs.add(r.id);
    }
    const ancStates = this.fig.ancestorRecs(this.layout.map((l) => l.rec));
    for (const r of ancStates) if (r.p.kind === 'free' && !this.layout.some((l) => l.rec === r)) {
      this.inputs.add(r.id);
      this.initInputs.add(r.id);
    }
    // an input that is gone from the rates is gone from the log
    for (const id of [...this.base.keys()]) if (!this.rateInputs.has(id)) {
      this.base.delete(id);
      this.log = this.log.filter((e) => !(e.kind === 'set' && e.id === id));
    }
    this.formGroups();
    // the integration depends on the states, their rates, and everything those read: when none of it changed (a line about
    // some other object), the checkpoints stay and the next seek does not start over
    const sig = this.signatureOf([...new Set([...anc, ...ancStates])]);
    if (keep && this.layout.length > 0 && sameSignature(this.sig as Signature, sig) && keep.failedAt.length === this.failedAt.length) {
      this.checkpoints = keep.checkpoints;
      this.cpStride = keep.stride;
      this.curN = keep.curN;
      this.curY = keep.curY;
      this.y0 = keep.y0;
      this.failedAt = keep.failedAt;
    }
    this.sig = sig;
  }

  private signatureOf(recs: readonly ObjRec[]): Signature {
    return {
      h: this.h,
      t0: this.t0,
      deps: recs.map((rec) => ({ rec, free: rec.p.kind === 'free', value: rec.p.kind === 'free' ? (this.base.has(rec.id) ? this.base.get(rec.id) : rec.p.value) : rec.p.compiled, rates: rec.p.rates })),
    };
  }

  /** Connected groups: two states are in one group when the rates of one read the other, directly or through objects. */
  private formGroups(): void {
    const n = this.layout.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const find = (i: number): number => {
      let r = i;
      while (parent[r] !== r) r = parent[r] as number;
      while (parent[i] !== r) {
        const nx = parent[i] as number;
        parent[i] = r;
        i = nx;
      }
      return r;
    };
    const indexOf = new Map<ObjRec, number>();
    this.layout.forEach((l, i) => indexOf.set(l.rec, i));
    this.layout.forEach((l, i) => {
      const seeds: ObjRec[] = [];
      for (const rr of l.rec.p.rates?.values() ?? []) for (const id of rr.checked.reads) {
        const r = this.fig.byId(id);
        if (r) seeds.push(r);
      }
      for (const a of this.fig.ancestorRecs(seeds)) {
        const j = indexOf.get(a);
        if (j !== undefined) parent[find(j)] = find(i);
      }
    });
    const ids = new Map<number, number>();
    this.groupNames = [];
    this.layout.forEach((l, i) => {
      const root = find(i);
      let g = ids.get(root);
      if (g === undefined) {
        g = this.groupNames.length;
        ids.set(root, g);
        this.groupNames.push([]);
      }
      l.group = g;
      (this.groupNames[g] as string[]).push(l.rec.p.name);
    });
    this.failedAt = this.groupNames.map(() => Infinity);
    this.stageBad = this.groupNames.map(() => false);
  }

  private num(v: unknown): number {
    return typeof v === 'number' ? v : Number.NaN;
  }

  /** Initial state vector at the film start. A state whose initial value is undefined puts its group out at step 0. */
  private initial(): Float64Array {
    const env = this.fig.env;
    const y = new Float64Array(this.dim);
    const saved = env.t;
    env.t = this.t0;
    try {
      for (const l of this.layout) {
        const c = l.rec.p.compiled?.state;
        if (!c) {
          this.failedAt[l.group] = 0;
          continue;
        }
        this.fig.ensureSlots(l.rec.p.checked.slots);
        const v = c.initial(env);
        const w = c.velocity ? c.velocity(env) : l.point ? { x: 0, y: 0 } : 0;
        const comps = l.point ? 2 : 1;
        if (l.point) {
          const p = v as { x: number; y: number } | undefined;
          const q = w as { x: number; y: number } | undefined;
          if (!p || !q) {
            this.failedAt[l.group] = 0;
            continue;
          }
          y[l.offset] = p.x;
          y[l.offset + 1] = p.y;
          if (l.order === 2) {
            y[l.offset + comps] = q.x;
            y[l.offset + comps + 1] = q.y;
          }
        } else {
          y[l.offset] = this.num(v);
          if (l.order === 2) y[l.offset + comps] = this.num(w);
        }
      }
    } finally {
      env.t = saved;
    }
    for (const l of this.layout) {
      const width = (l.point ? 2 : 1) * l.order;
      for (let k = 0; k < width; k++) {
        if (!Number.isFinite(y[l.offset + k])) {
          y[l.offset + k] = 0;
          this.failedAt[l.group] = 0;
        }
      }
    }
    return y;
  }

  /** Puts a state vector into the state objects' cells (used while integrating, and for the final result). */
  private load(y: Float64Array): void {
    for (const l of this.layout) {
      const v = l.point ? { x: y[l.offset] as number, y: y[l.offset + 1] as number } : (y[l.offset] as number);
      l.rec.cell = { defined: true, value: v };
    }
  }

  /** The derivative of the whole vector at `y` and time `t`. */
  private deriv(y: Float64Array, t: number, out: Float64Array): void {
    const env = this.fig.env;
    this.load(y);
    const savedT = env.t;
    env.t = t;
    try {
      for (const r of this.cone) r.cell = this.fig.compute(r);
      for (const l of this.layout) {
        const comps = l.point ? 2 : 1;
        const rate = l.rec.p.rates?.get(l.order);
        if (l.order === 2) {
          for (let k = 0; k < comps; k++) out[l.offset + k] = y[l.offset + comps + k] as number;
        }
        const base = l.offset + (l.order === 2 ? comps : 0);
        if ((this.failedAt[l.group] as number) <= this.stepIdx) {
          for (let k = 0; k < comps; k++) out[base + k] = 0;
          continue;
        }
        if (!rate) {
          for (let k = 0; k < comps; k++) out[base + k] = 0;
          continue;
        }
        this.fig.ensureSlots(rate.checked.slots);
        const res = evaluate(rate.compiled, env);
        const v = res.defined ? (res.value as unknown) : undefined;
        if (l.point) {
          const p = v as { x?: number; y?: number } | undefined;
          if (typeof p?.x !== 'number' || typeof p.y !== 'number') {
            this.stageBad[l.group] = true;
            for (let k = 0; k < comps; k++) out[base + k] = 0;
            continue;
          }
          out[base] = p.x;
          out[base + 1] = p.y;
        } else {
          if (typeof v !== 'number') {
            this.stageBad[l.group] = true;
            out[base] = 0;
            continue;
          }
          out[base] = v;
        }
      }
    } finally {
      env.t = savedT;
    }
  }

  private k1 = new Float64Array(0);
  private k2 = new Float64Array(0);
  private k3 = new Float64Array(0);
  private k4 = new Float64Array(0);
  private tmp = new Float64Array(0);

  /**
   * One RK4 step from grid index n. A group whose state blows up or whose rate is undefined is put out at step n + 1 and
   * keeps its last values; every other group steps on.
   */
  private step(y: Float64Array, n: number): void {
    const d = this.dim;
    if (this.k1.length !== d) {
      this.k1 = new Float64Array(d);
      this.k2 = new Float64Array(d);
      this.k3 = new Float64Array(d);
      this.k4 = new Float64Array(d);
      this.tmp = new Float64Array(d);
    }
    const h = this.h;
    const t = this.t0 + n * h;
    const { k1, k2, k3, k4, tmp } = this;
    this.stageBad.fill(false);
    this.stepIdx = n;
    this.deriv(y, t, k1);
    for (let i = 0; i < d; i++) tmp[i] = (y[i] as number) + (h / 2) * (k1[i] as number);
    this.deriv(tmp, t + h / 2, k2);
    for (let i = 0; i < d; i++) tmp[i] = (y[i] as number) + (h / 2) * (k2[i] as number);
    this.deriv(tmp, t + h / 2, k3);
    for (let i = 0; i < d; i++) tmp[i] = (y[i] as number) + h * (k3[i] as number);
    this.deriv(tmp, t + h, k4);
    for (const l of this.layout) {
      const g = l.group;
      if ((this.failedAt[g] as number) <= n) continue;
      const width = (l.point ? 2 : 1) * l.order;
      const next: number[] = [];
      let bad = this.stageBad[g] === true;
      for (let k = 0; k < width && !bad; k++) {
        const i = l.offset + k;
        const v = (y[i] as number) + (h / 6) * ((k1[i] as number) + 2 * (k2[i] as number) + 2 * (k3[i] as number) + (k4[i] as number));
        if (!Number.isFinite(v) || Math.abs(v) > BLOW_UP) bad = true;
        next.push(v);
      }
      if (bad) {
        this.stageBad[g] = true;
        this.failedAt[g] = Math.min(this.failedAt[g] as number, n + 1);
        continue;
      }
      for (let k = 0; k < width; k++) y[l.offset + k] = next[k] as number;
    }
  }

  /**
   * The state vector at grid index n (an integer step count from the film start). A group that failed at or before n
   * holds its last values here; `sync` reports it as undefined.
   */
  private at(n: number): Float64Array {
    this.short = false;
    if (this.y0 === undefined) {
      this.y0 = this.initial();
      this.checkStiffness(this.y0);
    }
    let from: number;
    let y: Float64Array;
    if (this.curY !== undefined && this.curN >= 0 && this.curN <= n) {
      from = this.curN;
      y = Float64Array.from(this.curY);
    } else {
      let best = 0;
      for (const k of this.checkpoints.keys()) if (k <= n && k > best) best = k;
      from = best;
      y = Float64Array.from(best === 0 ? this.y0 : (this.checkpoints.get(best) as Float64Array));
    }
    // a budget per call: a far seek (or an open-ended film) cannot hang the host; the rest follows on the next calls
    let i = from;
    for (let steps = 0; i < n && steps < MAX_SEEK_STEPS; i++, steps++) {
      this.enter(y, i);
      this.step(y, i);
      const m = i + 1;
      if (m % this.cpStride === 0 && !this.checkpoints.has(m)) {
        this.checkpoints.set(m, Float64Array.from(y));
        if (this.checkpoints.size > MAX_CHECKPOINTS) this.thin();
      }
    }
    this.short = i < n;
    this.curN = i;
    this.curY = Float64Array.from(y);
    return y;
  }

  /** Keeps every second checkpoint and doubles the spacing, so memory stays bounded however long the film runs. */
  private thin(): void {
    this.cpStride *= 2;
    for (const k of [...this.checkpoints.keys()]) if (k % this.cpStride !== 0) this.checkpoints.delete(k);
  }

  /**
   * Advances the states to the clock and returns the state objects whose cell changed. Called by the update pass.
   * Cone cells that the integration used are put back before it returns. A group of connected states that blew up is
   * undefined; the other groups keep stepping.
   */
  sync(): ObjRec[] {
    const target = this.fig.clockT();
    const r = this.statesAt(target);
    if (!r) {
      this.catching = undefined;
      return [];
    }
    // design 8.5: a far seek or a replay after a log change finishes over the next calls; say so once while it lasts
    if (this.short) {
      const from = Number((this.t0 + this.curN * this.h).toFixed(3));
      if (!this.catching) this.warnings.push(makeNotice('catching_up', { from, to: Number(target.toFixed(3)) }, this.layout.map((l) => l.rec.p.name)));
      this.catching = { from, to: target };
    } else this.catching = undefined;
    const changed: ObjRec[] = [];
    for (const [rec, cell] of r) if (this.fig.write(rec, cell)) changed.push(rec);
    return changed;
  }

  private catching: { from: number; to: number } | undefined;

  /** While the states are behind the clock (a replay in slices): how far they have got and where they are going. */
  get catchingUp(): { readonly from: number; readonly to: number } | undefined {
    return this.catching;
  }

  /** The state objects, in layout order. */
  stateObjects(): ObjRec[] {
    this.rebuild();
    return this.layout.map((l) => l.rec);
  }

  /**
   * The cell each state has at film time `time`, without writing anything: from the dense output (checkpoints and the
   * Hermite step between grid points). Undefined when there are no states. The figure's slice over the clock reads it, so
   * a trace or a path of a state-driven object is right for any time, not only the current one.
   */
  statesAt(time: number): (readonly [ObjRec, Cell])[] | undefined {
    this.rebuild();
    if (this.layout.length === 0) return undefined;
    const saved = this.cone.map((r) => r.cell);
    const stateCells = this.layout.map((l) => l.rec.cell);
    const logged = [...this.base.keys()].map((id) => this.fig.byId(id)).filter((r): r is ObjRec => r !== undefined);
    const loggedCells = logged.map((r) => r.cell);
    const t = Math.max(this.t0, time);
    const pos = (t - this.t0) / this.h;
    const n = Math.floor(pos + 1e-9);
    const frac = pos - n;
    const between = frac > 1e-9;
    let result: Float64Array;
    let behind: boolean;
    try {
      const yn = this.at(n);
      behind = this.short;
      if (behind) result = yn;
      else if (between) {
        // cubic Hermite between grid points n and n+1
        const d0 = new Float64Array(this.dim);
        const d1 = new Float64Array(this.dim);
        const y1 = Float64Array.from(yn);
        this.enter(y1, n);
        yn.set(y1);
        this.stepIdx = n;
        this.deriv(yn, this.t0 + n * this.h, d0);
        this.step(y1, n);
        this.stepIdx = n + 1;
        this.deriv(y1, this.t0 + (n + 1) * this.h, d1);
        const h = this.h;
        const s = frac;
        const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
        const h10 = s ** 3 - 2 * s ** 2 + s;
        const h01 = -2 * s ** 3 + 3 * s ** 2;
        const h11 = s ** 3 - s ** 2;
        result = new Float64Array(this.dim);
        for (let i = 0; i < this.dim; i++) result[i] = h00 * (yn[i] as number) + h10 * h * (d0[i] as number) + h01 * (y1[i] as number) + h11 * h * (d1[i] as number);
      } else result = yn;
    } finally {
      this.cone.forEach((r, i) => {
        r.cell = saved[i] as Cell;
      });
      this.layout.forEach((l, i) => {
        l.rec.cell = stateCells[i] as Cell;
      });
      logged.forEach((r, i) => {
        r.cell = loggedCells[i] as Cell;
      });
    }
    const out: (readonly [ObjRec, Cell])[] = [];
    if (behind) {
      // the target is further than one call goes: the states are undefined (timeout) until later calls catch up
      for (const l of this.layout) out.push([l.rec, { defined: false, reason: 'timeout' }]);
      return out;
    }
    const bad = new Set<number>();
    this.groupNames.forEach((names, g) => {
      const at = this.failedAt[g] as number;
      if (at > n + (between ? 1 : 0)) return;
      bad.add(g);
      if (at > 0) {
        const key = `${names.join(',')}@${at}`;
        if (!this.warnedAt.has(key)) {
          this.warnedAt.add(key);
          this.warnings.push(makeNotice('unstable_state', { t: Number((this.t0 + at * this.h).toFixed(4)), hint: 'lower the stiffness, add damping, or use @solver step 1/960' }, names));
        }
      }
    });
    for (const l of this.layout) {
      if (bad.has(l.group)) {
        out.push([l.rec, { defined: false, reason: 'not_finite' }]);
        continue;
      }
      const v = l.point ? { x: result[l.offset] as number, y: result[l.offset + 1] as number } : (result[l.offset] as number);
      out.push([l.rec, { defined: true, value: v }]);
    }
    return out;
  }

  private readonly warnedAt = new Set<string>();

  /**
   * Warns (`stiff_system`) when the fastest motion at the start is too fast for the step: an estimate of the Jacobian's
   * spectral radius ω from a few power-iteration steps on finite differences of the rates, warned when ω h > 2. RK4 goes
   * unstable a little above that, so the warning comes before `unstable_state`.
   */
  private checkStiffness(y: Float64Array): void {
    const dim = this.dim;
    if (dim === 0) return;
    const savedBad = this.stageBad.slice();
    const savedIdx = this.stepIdx;
    try {
      this.stepIdx = 0;
      const f0 = new Float64Array(dim);
      const f1 = new Float64Array(dim);
      const yp = new Float64Array(dim);
      this.deriv(y, this.t0, f0);
      let v = new Float64Array(dim);
      for (let i = 0; i < dim; i++) v[i] = (i % 2 === 0 ? 1 : -0.5) / Math.sqrt(dim);
      let yn = 0;
      for (let i = 0; i < dim; i++) yn = Math.max(yn, Math.abs(y[i] as number));
      const eps = 1e-6 * Math.max(1, yn);
      const logs: number[] = [];
      for (let k = 0; k < STIFF_ITERATIONS; k++) {
        for (let i = 0; i < dim; i++) yp[i] = (y[i] as number) + eps * (v[i] as number);
        this.deriv(yp, this.t0, f1);
        let nrm = 0;
        const jv = new Float64Array(dim);
        for (let i = 0; i < dim; i++) {
          jv[i] = ((f1[i] as number) - (f0[i] as number)) / eps;
          nrm += (jv[i] as number) ** 2;
        }
        nrm = Math.sqrt(nrm);
        if (!(nrm > 0) || !Number.isFinite(nrm)) break;
        logs.push(Math.log(nrm));
        for (let i = 0; i < dim; i++) jv[i] = (jv[i] as number) / nrm;
        v = jv;
      }
      // the geometric mean over an even number of steps: an oscillation's steps alternate between k and 1, so the mean is
      // its frequency √k
      const m = logs.length - (logs.length % 2);
      if (m < 2) return;
      let sum = 0;
      for (let i = 0; i < m; i++) sum += logs[i] as number;
      const omega = Math.exp(sum / m);
      this.lastOmega = omega;
      if (omega * this.h <= 2) return;
      const names = this.layout.map((l) => l.rec.p.name);
      const key = `stiff:${names.join(',')}:${this.h}`;
      if (this.warnedAt.has(key)) return;
      this.warnedAt.add(key);
      this.warnings.push(makeNotice('stiff_system', { states: names.join(', '), omega: Number(omega.toPrecision(3)), hint: 'lower the stiffness, add damping, or use @solver step 1/960' }, names));
    } finally {
      this.stageBad = savedBad;
      this.stepIdx = savedIdx;
    }
  }

  /** The last estimate of the fastest rate (1/s), for tests and the player bar. */
  lastOmega = 0;
}

/** Power-iteration steps of the stiffness estimate (even). */
const STIFF_ITERATIONS = 8;

function sameSignature(a: Signature, b: Signature): boolean {
  if (a.h !== b.h || a.t0 !== b.t0 || a.deps.length !== b.deps.length) return false;
  for (let i = 0; i < a.deps.length; i++) {
    const x = a.deps[i] as Signature['deps'][number];
    const y = b.deps[i] as Signature['deps'][number];
    if (x.rec !== y.rec || x.free !== y.free || x.rates !== y.rates || (x.free ? !sameValue(x.value, y.value) : x.value !== y.value)) return false;
  }
  return true;
}
