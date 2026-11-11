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
}

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

  /** A free value that a rate or an initial value may read changed: restart. */
  noteFree(rec: ObjRec): void {
    if (this.inputs.has(rec.id)) this.dirtyInputs = true;
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
    for (const r of anc) if (r.p.kind === 'free') this.inputs.add(r.id);
    const ancStates = this.fig.ancestorRecs(this.layout.map((l) => l.rec));
    for (const r of ancStates) if (r.p.kind === 'free') this.inputs.add(r.id);
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
      deps: recs.map((rec) => ({ rec, free: rec.p.kind === 'free', value: rec.p.kind === 'free' ? rec.p.value : rec.p.compiled, rates: rec.p.rates })),
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
    if (this.y0 === undefined) this.y0 = this.initial();
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
    this.rebuild();
    if (this.layout.length === 0) return [];
    const saved = this.cone.map((r) => r.cell);
    const stateCells = this.layout.map((l) => l.rec.cell);
    const t = Math.max(this.t0, this.fig.clockT());
    const pos = (t - this.t0) / this.h;
    const n = Math.floor(pos + 1e-9);
    const frac = pos - n;
    const between = frac > 1e-9;
    let result: Float64Array;
    let behind = false;
    try {
      const yn = this.at(n);
      behind = this.short;
      if (behind) result = yn;
      else if (between) {
        // cubic Hermite between grid points n and n+1
        const d0 = new Float64Array(this.dim);
        const d1 = new Float64Array(this.dim);
        const y1 = Float64Array.from(yn);
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
    }
    const changed: ObjRec[] = [];
    if (behind) {
      // the target is further than one call goes: the states are undefined (timeout) until later calls catch up
      for (const l of this.layout) if (this.fig.write(l.rec, { defined: false, reason: 'timeout' })) changed.push(l.rec);
      return changed;
    }
    const out = new Set<number>();
    this.groupNames.forEach((names, g) => {
      const at = this.failedAt[g] as number;
      if (at > n + (between ? 1 : 0)) return;
      out.add(g);
      if (at > 0) {
        const key = `${names.join(',')}@${at}`;
        if (!this.warnedAt.has(key)) {
          this.warnedAt.add(key);
          this.warnings.push(makeNotice('unstable_state', { t: Number((this.t0 + at * this.h).toFixed(4)), hint: 'lower the stiffness, add damping, or use @solver step 1/960' }, names));
        }
      }
    });
    for (const l of this.layout) {
      if (out.has(l.group)) {
        if (this.fig.write(l.rec, { defined: false, reason: 'not_finite' })) changed.push(l.rec);
        continue;
      }
      const v = l.point ? { x: result[l.offset] as number, y: result[l.offset + 1] as number } : (result[l.offset] as number);
      if (this.fig.write(l.rec, { defined: true, value: v })) changed.push(l.rec);
    }
    return changed;
  }

  private readonly warnedAt = new Set<string>();
}

function sameSignature(a: Signature, b: Signature): boolean {
  if (a.h !== b.h || a.t0 !== b.t0 || a.deps.length !== b.deps.length) return false;
  for (let i = 0; i < a.deps.length; i++) {
    const x = a.deps[i] as Signature['deps'][number];
    const y = b.deps[i] as Signature['deps'][number];
    if (x.rec !== y.rec || x.free !== y.free || x.rates !== y.rates || (x.free ? !sameValue(x.value, y.value) : x.value !== y.value)) return false;
  }
  return true;
}
