/**
 * `Figure`: the public class of the kernel (docs/features/kernel/design.md section 4.5). It adds to the line pipeline,
 * history and drag services the clock, the state solver, the step list, saving and loading, and read-only views.
 */
import type { ErrorObject, Notice, Span } from '../contracts/errors';
import type { Name, ObjId, TypeName, UndefReason } from '../contracts/values';
import { StateSolver } from '../clock/solver';
import { err } from '../errors/table';
import { makeNotice } from '../errors/notices';
import type { ParsedLine } from '../language/ast';
import { targetNamesOf } from '../language/figure';
import { printExpr, printLineNode } from '../language/printer';
import { valueText } from '../language/runtime';
import { splitLogicalLines } from '../language/source';
import { sameValue, valueSource } from './values';
import { ObjRec } from './core';
import type { FigureOptions } from './core';
import { FigureHist, merge } from './hist';
import { SCRIPT_VERSION, emptyReport } from './tx';
import { defaultsFor } from './props';
import { scriptTails } from './registry';
import type { WorldDriver } from './drivers';
import { worldDriverFactories } from './drivers';
import type { Cell, ChangeReport, EffectiveStyle, FrameDelta, Slice, StyleEntry, TxResult } from './types';

export type { FigureOptions, Slice };

/** What a world driver inside the kernel may use of its figure (`Figure.driverAccess`). */
export interface DriverAccess {
  readonly list: readonly ObjRec[];
  readonly env: import('../language/runtime').Env;
  readonly byId: (id: ObjId) => ObjRec | undefined;
  readonly byName: (name: Name) => ObjRec | undefined;
  readonly version: () => number;
  readonly clockT: () => number;
  readonly t0: () => number;
  readonly solverStepsPerSecond: () => number;
  readonly ancestorRecs: (seeds: readonly ObjRec[]) => ObjRec[];
  readonly downOf: (r: ObjRec) => Int32Array;
  readonly compute: (r: ObjRec) => Cell;
  readonly ensureSlots: (n: number) => void;
  readonly write: (r: ObjRec, c: Cell) => boolean;
  readonly styleOf: (id: ObjId) => EffectiveStyle | undefined;
  readonly rerunOf: (r: ObjRec) => 'continue' | 'restart';
  readonly sliceClock: (target: ObjRec) => Slice | ErrorObject;
}
export { SCRIPT_VERSION };

/** One row of the build list (kernel design 12.1). */
export interface Step {
  readonly index: number;
  readonly id: ObjId;
  readonly name: Name;
  readonly type: TypeName;
  readonly definition: string;
  readonly valueText: string;
  readonly sentence: string;
  readonly group?: { readonly title: string; readonly breakpoint: true };
  readonly visible: boolean;
}

export interface LoadOpts extends FigureOptions {
  /** `lenient` (default) keeps going past a failed line; `strict` is all or nothing. */
  mode?: 'lenient' | 'strict';
}

export interface LoadReport {
  readonly ok: boolean;
  readonly applied: number;
  readonly skipped: number;
  /** Every failed line, with its line number in the file. */
  readonly errors: readonly ErrorObject[];
  readonly warnings: readonly Notice[];
}

export interface ScriptOpts {
  /** Print the header `@fig 1` (default true). */
  header?: boolean;
}

/** A read-only view of one object for lists, readouts and the teacher's `figure` tool. */
export interface ObjectView {
  readonly id: ObjId;
  readonly name: Name;
  readonly type: TypeName;
  readonly typeText: string;
  readonly order: number;
  readonly cell: Cell;
  readonly free: boolean;
  readonly state: boolean;
  readonly range?: { readonly min: number; readonly max: number; readonly step?: number };
  readonly definition: string;
  readonly inputs: readonly ObjId[];
  readonly style: EffectiveStyle;
}

export class Figure extends FigureHist {
  readonly solver: StateSolver;
  protected beatStarts: number[] = [];

  constructor(opts: FigureOptions = {}) {
    super(opts);
    if (opts.gate) this.setGate(opts.gate);
    this.solver = new StateSolver({
      list: this.list,
      states: () => this.stateRecs,
      env: this.env,
      byId: (id) => this.byIdMap.get(id),
      version: () => this.structureVersion,
      clockT: () => this.clockState.t,
      t0: () => this.clockRange().from,
      stepsPerSecond: () => this.directiveStepRate(),
      ancestorRecs: (seeds) => this.ancestorRecs(seeds),
      downOf: (r) => this.downOf(r),
      compute: (r) => this.compute(r),
      ensureSlots: (n) => this.ensureSlots(n),
      write: (r, c) => this.writeCell(r, c),
      rerunOf: (r) => {
        const e = r.p.style.get('rerun');
        // the default is restart (kernel ruling K12); an input opts in to continue
        return e?.word === 'continue' || e?.text === 'continue' ? 'continue' : 'restart';
      },
    });
    this.stateDriver = () => (this.solver.active ? this.solver.sync() : []);
    this.stateSampler = {
      recs: () => {
        const own = this.solver.active ? this.solver.stateObjects() : [];
        const drv = this.worldDrivers();
        if (drv.length === 0) return own;
        const extra: ObjRec[] = [];
        for (const d of drv) extra.push(...(d.sampleRecs?.() ?? []));
        return [...own, ...extra];
      },
      at: (t) => {
        const own = this.solver.active ? this.solver.statesAt(t) : undefined;
        const drv = this.worldDrivers();
        if (drv.length === 0) return own;
        const out: (readonly [ObjRec, Cell])[] = [...(own ?? [])];
        for (const d of drv) out.push(...(d.sample?.(t) ?? []));
        return out;
      },
    };
  }

  /* ------------------------------ world drivers ------------------------------ */

  private drivers: WorldDriver[] = [];
  private driverFactoryCount = 0;

  /** The figure's world drivers (core hook 1), made on first use from the registered factories. */
  worldDrivers(): readonly WorldDriver[] {
    const fs = worldDriverFactories();
    while (this.driverFactoryCount < fs.length) {
      const d = (fs[this.driverFactoryCount++] as (f: unknown) => WorldDriver | undefined)(this);
      if (d) this.drivers.push(d);
    }
    return this.drivers;
  }

  protected override drivenCell(r: ObjRec, c: Cell): Cell {
    for (const d of this.drivers) {
      const k = d.onCompute?.(r, c);
      if (k) return k;
    }
    return c;
  }

  /**
   * What a world driver may use of the figure: its records and the evaluation services the state solver uses. Only for
   * drivers inside the kernel.
   */
  driverAccess(): DriverAccess {
    return {
      list: this.list,
      env: this.env,
      byId: (id) => this.byIdMap.get(id),
      byName: (name) => this.byNameMap.get(name),
      version: () => this.structureVersion,
      clockT: () => this.clockState.t,
      t0: () => this.clockRange().from,
      solverStepsPerSecond: () => this.directiveStepRate(),
      ancestorRecs: (seeds) => this.ancestorRecs(seeds),
      downOf: (r) => this.downOf(r),
      compute: (r) => this.compute(r),
      ensureSlots: (n) => this.ensureSlots(n),
      write: (r, c) => this.writeCell(r, c),
      styleOf: (id) => this.styleOf(id),
      rerunOf: (r) => {
        const e = r.p.style.get('rerun');
        return e?.word === 'continue' || e?.text === 'continue' ? 'continue' : 'restart';
      },
      sliceClock: (target) => this.sliceRecs(undefined, target),
    };
  }

  protected writeCell(r: ObjRec, c: Cell): boolean {
    return this.setCell(r, c);
  }

  /* ------------------------------ update ------------------------------ */

  /** Runs one pass over everything marked since the last flush, then delivers the batched events. */
  override flush(force = false): FrameDelta {
    if (this.busy) return { valueIds: [], styleIds: [], undefinedChanges: [], ran: 0 };
    // a frame outside any operation starts with no faults, so a rule that throws every frame cannot grow the list
    if (this.opDepth > 0) return this.flushNow(force);
    this.faults = [];
    this.listenerFailures = 0;
    let d: FrameDelta;
    try {
      d = this.flushNow(force);
    } catch {
      // a frame that fails halfway must not take the host down; the next pass recomputes everything the clock reads
      this.markClockDirty();
      d = { valueIds: [], styleIds: [], undefinedChanges: [], ran: 0 };
    }
    this.deliver();
    const failed = this.takeListenerFailures();
    return failed > 0 ? { ...d, listenerFailures: failed } : d;
  }

  private flushNow(force: boolean): FrameDelta {
    let d = super.flush(force);
    const drv = this.worldDrivers();
    if (drv.length === 0) return d;
    // core hook 1: the drivers write what they own, then one more pass runs over what reads it
    const owned: ObjRec[] = [];
    for (const w of drv) owned.push(...w.afterPass());
    if (owned.length === 0) return d;
    for (const r of owned) this.markDirty(r);
    const d2 = super.flush(false);
    const seen = new Set(d.valueIds);
    const valueIds = [...d.valueIds];
    for (const id of d2.valueIds) if (!seen.has(id)) valueIds.push(id);
    const styleIds = [...new Set([...d.styleIds, ...d2.styleIds])];
    d = { valueIds, styleIds, undefinedChanges: [...d.undefinedChanges, ...d2.undefinedChanges], ran: d.ran + d2.ran };
    return d;
  }

  protected override onFreeWritten(rec: ObjRec, was?: unknown): void {
    this.solver.noteFree(rec, was);
    for (const w of this.drivers) w.noteFree?.(rec, was);
  }

  protected override onInputLine(words: readonly string[]): string | undefined {
    for (const w of this.worldDrivers()) {
      const r = w.inputLine?.(words);
      if (r !== false && r !== undefined) return r;
      if (r === undefined && w.inputLine) return undefined;
    }
    if (words[0] === 'reset') {
      this.solver.restoreEntry({ kind: 'reset', t: Number(words[2]) });
      return undefined;
    }
    const rec = this.byNameMap.get(words[0] as string);
    if (!rec || rec.p.kind !== 'free') return `a free object named ${words[0] ?? ''}`;
    const base = words[words.length - 1] === 'base';
    const nums = words.slice(1, words.length - (base ? 1 : 2)).map(Number);
    const value = nums.length === 2 ? { x: nums[0] as number, y: nums[1] as number } : (nums[0] as number);
    if (base) this.solver.restoreBase(rec.id, value);
    else this.solver.restoreEntry({ kind: 'set', t: Number(words[words.length - 1]), id: rec.id, value });
    return undefined;
  }

  protected override onDirective(name: string): void {
    super.onDirective(name);
    if (name === 'clock' || name === 'solver') {
      this.structureVersion++;
      this.markClockDirty();
    }
  }

  /* ------------------------------ the clock ------------------------------ */

  /** The words of a directive the figure has (`@sheet 26 100` gives `['26', '100']`), or `undefined`. */
  directive(name: string): readonly string[] | undefined {
    return this.directiveItem(name)?.words;
  }

  /** The words of every line of a directive that may be written many times (`@cell`), in order. */
  directiveLines(name: string): readonly (readonly string[])[] {
    return this.items.filter((it) => it.name === name).map((it) => it.words);
  }

  /** The film range from `@clock a..b`: `0..Infinity` without the directive. */
  clockRange(): { from: number; to: number } {
    const d = this.directiveItem('clock');
    const m = d ? /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(d.words[0] ?? '') : null;
    return m ? { from: Number(m[1]), to: Number(m[2]) } : { from: 0, to: Infinity };
  }

  protected directiveStepRate(): number {
    const d = this.directiveItem('solver');
    const m = d ? /^1\/(\d+)$/.exec(d.words[1] ?? '') : null;
    return m ? Number(m[1]) : 240;
  }

  /** The beat start times the figure was given, in seconds (ascending). */
  beats(): readonly number[] {
    return this.beatStarts;
  }

  /** Beat start times in seconds, from the film. With none, `bt` equals `t` and `beat` is 0. */
  setBeats(starts: readonly number[]): void {
    if (!Array.isArray(starts)) return;
    this.beatStarts = [...starts].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    this.setClock(this.clockState.t);
  }

  /**
   * Moves the clock and runs one pass (a seek is one update pass). `t` is clamped to the film range. `bt` and `beat` follow
   * from the beat starts unless given. Only `t`, `bt` and `beat` change; the view, the selection and history are untouched.
   */
  setClock(t: number, opts: { bt?: number; beat?: number; flush?: boolean } = {}): FrameDelta | ErrorObject {
    if (this.busy) return this.busyError('setClock');
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      return err('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'setClock', why: 'the time must be a finite number' }, { recovery: 'fix_line', fingerprintKey: 'setClock' });
    }
    if (typeof opts !== 'object' || opts === null) opts = {};
    const { from, to } = this.clockRange();
    const tt = Math.min(to, Math.max(from, t));
    let beat = 0;
    for (let i = 0; i < this.beatStarts.length; i++) if ((this.beatStarts[i] as number) <= tt) beat = i;
    const start = this.beatStarts.length > 0 ? (this.beatStarts[beat] as number) : 0;
    const c = this.clockState;
    const nb = typeof opts.beat === 'number' && opts.beat === opts.beat ? opts.beat : beat;
    const nbt = typeof opts.bt === 'number' && opts.bt === opts.bt ? opts.bt : tt - start;
    if (c.t === tt && c.bt === nbt && c.beat === nb) return { valueIds: [], styleIds: [], undefinedChanges: [], ran: 0 };
    c.t = tt;
    c.bt = nbt;
    c.beat = nb;
    this.env.t = tt;
    this.env.bt = nbt;
    this.env.beat = nb;
    this.markClockDirty();
    this.queue({ ev: 'clock', t: tt });
    if (opts.flush === false) return { valueIds: [], styleIds: [], undefinedChanges: [], ran: 0 };
    return this.flush();
  }

  /** Problems the figure can only know later: states without a rate (`missing_rate`). */
  problems(): ErrorObject[] {
    const out: ErrorObject[] = [];
    void this.solver.active;
    for (const name of this.solver.missing) {
      out.push(err('missing_rate', { line: 0, col: 1, endCol: 1 }, { name }, { token: name, hint: `Add ${name}' = ...`, suggest: [`${name}' = 0`], recovery: 'create_first', fingerprintKey: name }));
    }
    return out;
  }

  /** Warnings the solver raised (an unstable state) since the last call. */
  takeWarnings(): Notice[] {
    const out = this.solver.warnings.splice(0, this.solver.warnings.length);
    for (const w of this.drivers) out.push(...(w.takeWarnings?.() ?? []));
    return out;
  }

  /** `Restart()` for the world drivers (the physics world goes back to its start at the current time). */
  restartDrivers(): void {
    for (const w of this.worldDrivers()) w.onRestart?.();
  }

  /** True while a world driver is behind the clock and wants frames even when paused. */
  driversNeedFrames(): boolean {
    return this.drivers.some((w) => w.needsFrame?.() === true);
  }

  /* ------------------------------ read-only views ------------------------------ */

  protected viewOf(r: ObjRec): ObjectView {
    return {
      id: r.id,
      name: r.p.name,
      type: r.p.type.k as TypeName,
      typeText: tyText(r),
      order: r.order,
      cell: this.cellOfRec(r),
      free: r.p.kind === 'free',
      state: r.p.kind === 'state',
      ...(r.range ? { range: r.range } : {}),
      definition: printedLine(r.p.node),
      inputs: r.inputs.map((i) => i.id),
      style: this.styleOf(r.id) as EffectiveStyle,
    };
  }

  /** True when an object has this name (cheaper than `get`, which builds the whole view). */
  has(name: Name): boolean {
    return this.byNameMap.has(name);
  }

  /** One object by name or id. */
  get(x: Name | ObjId): ObjectView | undefined {
    const r = this.recOf(x);
    return r ? this.viewOf(r) : undefined;
  }

  /** Every object in order. */
  objects(): ObjectView[] {
    return this.list.map((r) => this.viewOf(r));
  }

  /** The cell of an object, computing it first when it is stale. */
  cellOf(x: Name | ObjId): Cell | undefined {
    const r = this.recOf(x);
    return r ? this.cellOfRec(r) : undefined;
  }

  /** The value of an object, or `undefined` when it is undefined or does not exist. */
  value(x: Name | ObjId): unknown {
    const c = this.cellOf(x);
    return c && c.defined ? c.value : undefined;
  }

  /** Follows `cause` links from an undefined object to the root: the reason and the object. */
  rootCause(x: Name | ObjId): { name: Name; reason: UndefReason } | undefined {
    const r = this.recOf(x);
    const root = r ? this.rootOf(r) : undefined;
    return root ? { name: root.rec.p.name, reason: root.reason } : undefined;
  }

  /** The number of objects. */
  get count(): number {
    return this.list.length;
  }

  /* ------------------------------ slice ------------------------------ */

  /**
   * Evaluates the rules between `source` (a free object, or `'t'` for the clock) and `target` on a scratch copy: for each
   * value the source is set, the objects that depend on it and that the target reads run in order, and the target's cell
   * is returned. Nothing is journalled, no event is sent, and every cell is put back.
   */
  slice(source: Name | ObjId | 't', target: Name | ObjId): Slice | ErrorObject {
    const tgt = this.need(target);
    if (tgt instanceof ObjRec === false) return tgt as ErrorObject;
    if (source === 't') return this.sliceRecs(undefined, tgt as ObjRec);
    const s = this.need(source);
    if (s instanceof ObjRec === false) return s as ErrorObject;
    return this.sliceRecs(s as ObjRec, tgt as ObjRec);
  }

  /* ------------------------------ steps ------------------------------ */

  /** The build list: one row per object (helpers hidden unless asked for), with the `@step` stops. */
  steps(opts: { helpers?: boolean } = {}): Step[] {
    const titles = new Map<ObjId, string>();
    for (const it of this.items) {
      if (it.name !== 'step') continue;
      const next = it.after === null ? this.list[0] : this.list[(this.byIdMap.get(it.after)?.order ?? -1) + 1];
      if (next) titles.set(next.id, it.words[0] ?? '');
    }
    const out: Step[] = [];
    const cursor = this.stepCursor ?? this.list.length;
    for (const r of this.list) {
      const st = this.styleOf(r.id) as EffectiveStyle;
      if (st.aux && !opts.helpers) continue;
      const c = this.cellOfRec(r);
      const title = titles.get(r.id);
      out.push({
        index: out.length,
        id: r.id,
        name: r.p.name,
        type: r.p.type.k as TypeName,
        definition: printedLine(r.p.node),
        valueText: c.defined ? valueText(c.value) : `undefined (${c.reason})`,
        sentence: this.sentence(r),
        ...(title !== undefined ? { group: { title, breakpoint: true as const } } : {}),
        visible: st.shown && r.order < cursor,
      });
    }
    return out;
  }

  /** The plain-language sentence of a step, from the command form's `explain` template. */
  protected sentence(r: ObjRec): string {
    const expr = r.p.checked.expr;
    const node = r.p.node;
    if (expr && expr.n === 'command' && expr.form.explain && node.k === 'define' && node.expr.k === 'call') {
      const args = node.expr.args.map((a) => printExpr(a.value));
      return expr.form.explain.replace(/\{(\w+)\}/g, (_m, k: string) => (k === 'name' ? r.p.name : (args[Number(k)] ?? `{${k}}`)));
    }
    const c = r.cell;
    if (r.p.kind === 'free' && c.defined) {
      const t = r.p.type.k;
      if (t === 'Point') return `${r.p.name} is a free point at ${valueText(c.value)}`;
      if (t === 'Number') return `${r.p.name} is a number, ${valueText(c.value)}`;
    }
    return `${r.p.name} = ${printLineNode(r.p.node).replace(/^[^=]*=\s*/, '')}`;
  }

  /**
   * Reveals the first `n` steps (kernel design 12.2). `n` counts the steps as `steps()` lists them, so a helper (`aux`) object
   * does not use one up. Objects at or after the cursor still exist, hold values and update; views filter by the cursor.
   * One `step` event.
   */
  stepTo(n: number): void {
    if (typeof n !== 'number' || n !== n || this.busy) return;
    const rows = this.listedRecs();
    const k = Math.max(0, Math.min(rows.length, Math.floor(n)));
    // inside, the cursor is the list position of the first hidden object; at the end every object is shown
    const first = rows[k];
    this.stepCursor = first === undefined ? undefined : first.order;
    this.queue({ ev: 'step', n: k });
    this.listenerFailures = 0;
    this.deliver();
    this.takeListenerFailures();
  }

  /** The objects the build list shows (helpers left out), in order. */
  protected listedRecs(): ObjRec[] {
    return this.list.filter((r) => !(this.styleOf(r.id) as EffectiveStyle).aux);
  }

  /** The reveal cursor: the number of steps shown, counted as `steps()` lists them. */
  get cursor(): number {
    const c = this.stepCursor;
    const rows = this.listedRecs();
    return c === undefined ? rows.length : rows.filter((r) => r.order < c).length;
  }

  /* ------------------------------ saving ------------------------------ */

  /** The text of one object: its line, with its `with` list. Free values print as their current value. */
  protected objectLine(r: ObjRec): string {
    const p = r.p;
    let base = printedLine(p.node);
    if (p.kind === 'free') {
      const lit = valueSource(p.type, p.value);
      if (lit !== undefined && p.node.k === 'define') {
        const range = base.slice(base.indexOf(' in ') >= 0 && p.node.range ? base.indexOf(' in ') : base.length);
        base = `${p.name} = ${lit}${p.node.range ? range : ''}`;
      }
    }
    const withs: string[] = [];
    const defaults = defaultsFor(p.type.k, p.kind === 'free');
    for (const e of p.style.values()) {
      if (e.eval === undefined && e.value !== undefined && e.word === undefined) {
        const dv = (defaults as unknown as Record<string, unknown>)[e.key];
        if (dv !== undefined && sameValue(dv, e.value)) continue;
      }
      withs.push(`${e.key} = ${e.text}`);
    }
    return withs.length > 0 ? `${base} with ${withs.join(', ')}` : base;
  }

  /**
   * The figure as a script: the current definition of every object in order, free objects with their current value,
   * comments and directives where they were written, rate rules after the objects. Dependent values are never stored.
   */
  toScript(opts: ScriptOpts = {}): string {
    if (typeof opts !== 'object' || opts === null) opts = {};
    const lines: string[] = [];
    if (opts.header !== false) lines.push(`@fig ${SCRIPT_VERSION}`);
    const byAnchor = new Map<ObjId | null, string[]>();
    for (const it of this.items) {
      const a = it.after !== null && !this.byIdMap.has(it.after) ? null : it.after;
      const arr = byAnchor.get(a) ?? [];
      arr.push(it.text);
      byAnchor.set(a, arr);
    }
    lines.push(...(byAnchor.get(null) ?? []));
    let printed: unknown;
    for (const r of this.list) {
      if (r.p.checked !== printed || r.p.tupleIndex === undefined) lines.push(this.objectLine(r));
      printed = r.p.tupleIndex !== undefined ? r.p.checked : undefined;
      lines.push(...(byAnchor.get(r.id) ?? []));
    }
    for (const r of this.list) {
      if (r.p.kind !== 'state' || !r.p.rates) continue;
      for (const o of [1, 2]) {
        const rr = r.p.rates.get(o);
        if (rr) lines.push(printLineNode(rr.node));
      }
    }
    lines.push(...scriptTails(this));
    return lines.join('\n') + '\n';
  }

  /**
   * Loads a script into a new figure. `lenient` keeps going past a failed line and says what is missing (a later line
   * that read a failed name gets `blockedBy`); `strict` discards the figure on the first error. A file newer than this
   * build refuses with `version`.
   */
  static fromScript(text: string, opts: LoadOpts = {}): { figure: Figure; report: LoadReport } {
    if (typeof opts !== 'object' || opts === null) opts = {};
    const figure = new Figure(opts);
    const report = figure.load(text, opts.mode ?? 'lenient');
    if (!report.ok && (opts.mode ?? 'lenient') === 'strict') return { figure: new Figure(opts), report };
    figure.journal.clear();
    return { figure, report };
  }

  /** Loads a script into this figure as one undo group. */
  append(text: string, opts: { mode?: 'lenient' | 'strict' } = {}): LoadReport {
    return this.load(text, (typeof opts === 'object' && opts !== null ? opts.mode : undefined) === 'strict' ? 'strict' : 'lenient');
  }

  protected load(text: string, mode: 'lenient' | 'strict'): LoadReport {
    const at: Span = { line: 1, col: 1, endCol: 1 };
    if (this.busy) return { ok: false, applied: 0, skipped: 0, errors: [this.busyError('load')], warnings: [] };
    if (typeof text !== 'string') {
      const e = err('tool_input', at, { tool: 'load', expected: 'the text of a script' }, { recovery: 'fix_line', fingerprintKey: 'load' });
      return { ok: false, applied: 0, skipped: 0, errors: [e], warnings: [] };
    }
    if (text.length > this.limits.fileSize) {
      const e = err('limit', at, { limit: 'file_size', max: this.limits.fileSize, got: text.length, what: 'characters in a file' }, { recovery: 'rewrite', fingerprintKey: 'file_size' });
      return { ok: false, applied: 0, skipped: 0, errors: [e], warnings: [] };
    }
    const lines = splitLogicalLines(text).filter((l) => l.text.trim() !== '');
    if (lines.length > this.limits.lines) {
      const e = err('limit', at, { limit: 'lines', max: this.limits.lines, got: lines.length, what: 'lines in a file' }, { recovery: 'rewrite', fingerprintKey: 'lines' });
      return { ok: false, applied: 0, skipped: 0, errors: [e], warnings: [] };
    }
    const head = /^\s*@fig\s+(\d+)/.exec(lines[0]?.text ?? '');
    if (head && Number(head[1]) > SCRIPT_VERSION) {
      const e = err('version', { line: lines[0]?.firstLine ?? 1, col: 1, endCol: 1 }, { v: String(head[1]), list: String(SCRIPT_VERSION) }, { hint: `Supported versions: ${SCRIPT_VERSION}.`, recovery: 'report', fingerprintKey: String(head[1]) });
      return { ok: false, applied: 0, skipped: 0, errors: [e], warnings: [] };
    }
    const errors: ErrorObject[] = [];
    const warnings: Notice[] = [];
    let applied = 0;
    const failed = new Map<string, { line: number; kind: import('../contracts/errors').ErrorKind }>();
    const run = (): void => {
      for (const l of lines) {
        const r = this.apply(l.text, { line: l.firstLine, failed });
        if (r.ok) {
          applied++;
          warnings.push(...r.notices);
        } else {
          errors.push(r);
          for (const n of targetNamesOf(l.text)) failed.set(n, { line: l.firstLine, kind: r.kind });
          if (mode === 'strict') return;
        }
      }
    };
    this.commitDrag();
    const unit = this.beginUnit('load');
    this.inPass(() => run());
    if (mode === 'strict' && errors.length > 0) {
      // all or nothing: take back what was applied, restore both stacks and the events not yet delivered
      this.inPass((pass) => this.rollbackUnit(unit, pass));
      applied = 0;
    } else this.journal.end();
    this.deliver();
    const total = lines.length;
    const e0 = errors.length;
    const out: ErrorObject[] = errors;
    if (e0 > 0 && mode === 'strict') {
      const lf = err('load_failed', at, { n: e0 }, { recovery: 'report', fingerprintKey: 'strict', cause: errors[0] as ErrorObject });
      return { ok: false, applied, skipped: total - applied, errors: [lf, ...out], warnings };
    }
    return { ok: e0 === 0, applied, skipped: total - applied, errors: out, warnings };
  }
}

/**
 * The printed text of a parsed line, kept per node. Nodes are never edited in place (a redefine, rename or range
 * change makes a new one), so the text of a node never changes; `objects()` on 5,000 objects stops printing them all.
 */
const PRINTED = new WeakMap<object, string>();
function printedLine(node: Parameters<typeof printLineNode>[0]): string {
  let s = PRINTED.get(node);
  if (s === undefined) {
    s = printLineNode(node);
    PRINTED.set(node, s);
  }
  return s;
}

function tyText(r: ObjRec): string {
  const t = r.p.type;
  return t.k === 'List' && t.of ? `List<${t.of.k}>` : t.k === 'Function' ? `Function<${t.ret ?? 'Number'}>${t.arity && t.arity > 1 ? `(${t.arity})` : ''}` : t.k;
}

export type { ChangeReport, StyleEntry, TxResult, ParsedLine };
void merge;
void emptyReport;
void makeNotice;
