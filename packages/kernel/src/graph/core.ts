/**
 * The object store, the dependency graph and the update pass (docs/features/kernel/design.md sections 4 and 6,
 * docs/design/performance.md section 3).
 *
 * Rules: only objects downstream of a change run; an object runs only when an input really changed its value (early
 * cut-off); one pass per flush, in ascending order, so inputs are final when a rule runs; values of objects nobody
 * looks at can be left stale and are computed when read (`setDemand`). No DOM, no timers, no wall clock.
 */
import type { ErrorKind, ErrorObject, Notice, NoticeKind } from '../contracts/errors';
import { makeNotice } from '../errors/notices';
import { err } from '../errors/table';
import type { Name, ObjId, UndefReason } from '../contracts/values';
import { resolveLimits } from '../errors/limits';
import type { Limits } from '../errors/limits';
import type { LangLimits } from '../language/source';
import { evaluate, compileLine } from '../language/compile';
import type { CompileOptions, CompiledArg, CompiledLine } from '../language/compile';
import { createEnv } from '../language/runtime';
import type { Env } from '../language/runtime';
import { printLineNode } from '../language/printer';
import { SELF_ID } from '../language/table';
import type { CommandForm, CommandSpec, CommandTable, FigureView, FunctionTable, ObjectInfo } from '../language/table';
import { PROPERTIES, own } from '../language/props';
import { NOT_SET } from './types';
import type { Cell, EffectiveStyle, FigureEvent, FrameDelta, Persist, Props, Slice, StyleEntry, UndefChange } from './types';
import { sameValue } from './values';
import { KERNEL_ACTIONS } from './actions';
import { CommandRegistry, RuleUndefined } from './registry';
import type { CommandRule, RuleCall, RuleWork } from './registry';
import { coerceDynamic, defaultsFor, setProp, toEffective } from './props';

/* ------------------------------ the object record ------------------------------ */

export class ObjRec {
  /** Position in the figure: `list[order] === this`. */
  order = 0;
  cell: Cell = NOT_SET;
  /** The flush epoch in which the value last changed (or the object was written as a source). */
  changedAt = 0;
  /** True when a value change upstream has not been computed yet (lazy mode). */
  stale = false;
  /** Objects that read this one through their value or slider range. */
  kids: ObjRec[] = [];
  /** Objects whose property rules read this one. */
  styleKids: ObjRec[] = [];
  /** Inputs of the value and the range, resolved. */
  inputs: ObjRec[] = [];
  valueIn: ObjRec[] = [];
  rangeIn: ObjRec[] = [];
  styleIn: ObjRec[] = [];
  /** Evaluated slider range, when the object has one and it is valid. */
  range: { min: number; max: number; step?: number } | undefined;
  /** The cached closure of dependents (orders, ascending), valid for `downVersion`. */
  down: Int32Array | undefined;
  downVersion = -1;
  styleCache: EffectiveStyle | undefined;
  infoCache: ObjectInfo | undefined;

  constructor(
    readonly id: ObjId,
    public p: Persist,
  ) {}

  get name(): Name {
    return this.p.name;
  }
  get free(): boolean {
    return this.p.kind === 'free';
  }
  get usesClock(): boolean {
    return this.p.checked.usesT || this.p.checked.rangeUsesT === true;
  }
}

export type Listener = (ev: FigureEvent) => void;

/** The most rule faults kept for one operation. */
const MAX_FAULTS = 100;

export interface FigureOptions {
  /** Commands from the areas; the kernel's own actions are always added. */
  commands?: CommandRegistry | readonly CommandSpec[] | CommandTable;
  functions?: FunctionTable;
  /** Directive names beyond the language's own. */
  directives?: readonly string[];
  limits?: Partial<Limits>;
  /** A monotonic clock in milliseconds, for the profiler only (`slowRules`). The kernel never reads the wall clock. */
  now?: () => number;
  /** The tolerance rules see (`RuleCall.tol`) when the figure has no `@tol` directive. Default `1e-9`. */
  tolerance?: number;
}

/** The tolerance for equality tests when nothing says otherwise (errors design 8). */
export const DEFAULT_TOLERANCE = 1e-9;

export interface SlowRule {
  readonly id: ObjId;
  readonly name: Name;
  readonly ms: number;
}

/** Tracks what one operation changed, for the change report. */
export interface Pass {
  /** The first cell each existing object had in this pass. */
  readonly before: Map<ObjRec, Cell>;
  readonly added: Set<ObjRec>;
}

export const cellsEqual = (a: Cell, b: Cell): boolean => {
  if (a === b) return true;
  if (a.defined !== b.defined) return false;
  if (a.defined && b.defined) return sameValue(a.value, b.value);
  if (!a.defined && !b.defined) return a.reason === b.reason && a.cause === b.cause && a.detail === b.detail;
  return false;
};

export class FigureCore {
  /** Notices that rules raised with `call.notify` since the last report; the next report carries them. */
  protected ruleNotices: Notice[] = [];
  readonly registry: CommandRegistry;
  readonly functions: FunctionTable | undefined;
  readonly directives: readonly string[] | undefined;
  readonly limits: Limits;
  /** The limits the line parser and checker honour. */
  readonly langLimits: LangLimits;

  readonly byIdMap = new Map<ObjId, ObjRec>();
  readonly byNameMap = new Map<Name, ObjRec>();
  /** The same records by lower-case name, to find names that differ only by case without scanning the figure (KERN-SM-17). */
  protected readonly byLowerMap = new Map<string, Set<ObjRec>>();
  readonly list: ObjRec[] = [];
  protected nextId = 1;
  /** Bumped by every change of structure; cached closures older than this are rebuilt. */
  structureVersion = 0;

  readonly env: Env;
  readonly clockState = { t: 0, bt: 0, beat: 0 };

  protected dirty = new Set<ObjRec>();
  protected clockDirty = false;
  protected epoch = 0;
  /** Lazy mode: ids the host reads. `null` means everything (eager). */
  protected demand: Set<ObjId> | null = null;
  protected needed: Uint8Array | null = null;
  protected neededVersion = -1;
  protected clockDownCache: Int32Array | undefined;
  protected clockDownVersion = -1;
  protected clockStyleCache: ObjRec[] | undefined;

  /** Commands whose rules threw during the current operation. */
  protected faults: string[] = [];
  /** How many rules are running now. A figure operation called from inside a rule is refused with `tool_busy` (KERN-SM-8). */
  protected ruleDepth = 0;
  protected readonly ruleCache = new WeakMap<readonly CompiledArg[], CommandRule>();
  protected pass: Pass | null = null;
  protected readonly listeners = new Set<Listener>();
  protected pendingValues = new Set<ObjId>();
  protected pendingStyles = new Set<ObjId>();
  protected pendingEvents: FigureEvent[] = [];
  protected opDepth = 0;
  /** Listener failures since the last `takeListenerFailures`. */
  protected listenerFailures = 0;
  readonly slowRules: SlowRule[] = [];
  protected readonly now: (() => number) | undefined;
  protected readonly tolOption: number;
  /** Set by the state solver: advances the states to the clock and returns the state objects whose value changed. */
  protected stateDriver: (() => ObjRec[]) | undefined;

  constructor(opts: FigureOptions = {}) {
    if (typeof opts !== 'object' || opts === null) opts = {};
    const c = opts.commands;
    // The figure owns its registry: a registry the host passes is copied, never written to (KERN-SM-3). The kernel's own
    // actions are added once per figure by `FigureBase`, so a copy leaves out any the host's registry already holds.
    this.registry =
      c instanceof CommandRegistry
        ? new CommandRegistry(c.all().filter((s) => !KERNEL_ACTIONS.includes(s.name) || s.kind !== 'action'))
        : new CommandRegistry(Array.isArray(c) ? (c as readonly CommandSpec[]) : []);
    if (c && !(c instanceof CommandRegistry) && !Array.isArray(c)) {
      const t = c as CommandTable;
      for (const n of t.names()) this.registry.register(t.lookup(n) as CommandSpec);
    }
    this.functions = opts.functions;
    this.directives = opts.directives;
    this.limits = resolveLimits(opts.limits);
    this.now = opts.now;
    this.tolOption = typeof opts.tolerance === 'number' && Number.isFinite(opts.tolerance) && opts.tolerance > 0 ? opts.tolerance : DEFAULT_TOLERANCE;
    this.env = createEnv({ read: (id) => this.readValue(id), slots: 16 });
    this.env.maxList = this.limits.listSize;
    this.env.host = this;
    this.langLimits = Object.freeze({ objects: this.limits.objects, exprNodes: this.limits.exprNodes, lineLength: this.limits.lineLength, listSize: this.limits.listSize, depth: this.limits.depth });
    const me = (): FigureCore => this;
    this.view = {
      lookup: (n) => this.lookup(n),
      byId: (id) => this.byId(id),
      names: () => this.names(),
      inputsOf: (id) => this.inputsOf(id),
      dependentsOf: (id) => this.dependentInfos(id),
      styleRulesReading: (id) => this.styleRulesReading(id),
      get commands() {
        return me().commands;
      },
      get functions() {
        return me().functions;
      },
      get directives() {
        return me().directives;
      },
      get size() {
        return me().list.length;
      },
      read: (id) => this.readValue(id),
      clock: () => this.clockState,
    };
  }

  /* ------------------------------ FigureView ------------------------------ */

  get commands(): CommandTable {
    return this.registry.table();
  }

  get size(): number {
    return this.list.length;
  }

  infoOf(rec: ObjRec): ObjectInfo {
    if (rec.infoCache && rec.infoCache.type === rec.p.type && rec.infoCache.name === rec.p.name) {
      const c = rec.infoCache;
      if ((c.free === true) === rec.free) return c;
    }
    const p = rec.p;
    const info: ObjectInfo = {
      id: rec.id,
      name: p.name,
      type: p.type,
      ...(p.unit ? { unit: p.unit } : {}),
      free: p.kind === 'free',
      ...(p.node.k === 'define' && p.node.range ? { slider: true } : {}),
      ...(p.kind === 'state' ? { state: true } : {}),
      source: printLineNode(p.node),
    };
    rec.infoCache = info;
    return info;
  }

  lookup(name: string): ObjectInfo | undefined {
    const r = this.byNameMap.get(name);
    return r ? this.infoOf(r) : undefined;
  }
  byId(id: ObjId): ObjectInfo | undefined {
    if (id === SELF_ID) return undefined;
    const r = this.byIdMap.get(id);
    return r ? this.infoOf(r) : undefined;
  }
  names(): readonly string[] {
    return this.list.map((r) => r.p.name);
  }
  inputsOf(id: ObjId): readonly ObjId[] {
    const r = this.byIdMap.get(id);
    return r ? r.inputs.map((i) => i.id) : [];
  }
  dependentInfos(id: ObjId): readonly ObjectInfo[] {
    const r = this.byIdMap.get(id);
    return r ? r.kids.map((k) => this.infoOf(k)) : [];
  }
  styleRulesReading(id: ObjId): readonly { readonly name: string; readonly source: string }[] {
    const r = this.byIdMap.get(id);
    if (!r) return [];
    const out: { name: string; source: string }[] = [];
    for (const owner of r.styleKids) {
      for (const e of owner.p.style.values()) if (e.reads.includes(id)) out.push({ name: owner.p.name, source: `${owner.p.name} with ${e.key} = ${e.text}` });
    }
    return out;
  }
  read(id: ObjId): unknown {
    return this.readValue(id);
  }
  clock(): { t: number; bt: number; beat: number } {
    return this.clockState;
  }

  /** The read-only interface the language checks lines against. */
  readonly view: FigureView;

  /* ------------------------------ values ------------------------------ */

  /** The value of an object, computing it first when it is stale. `undefined` when the object is undefined. */
  readValue(id: ObjId): unknown {
    const r = this.byIdMap.get(id);
    if (!r) return undefined;
    if (r.stale) this.pull(r);
    return r.cell.defined ? r.cell.value : undefined;
  }

  /** The cell of an object (computed first when stale). */
  cellOfRec(r: ObjRec): Cell {
    if (r.stale) this.pull(r);
    return r.cell;
  }

  /**
   * Computes a stale object and the stale objects it reads. Iterative: the stale ancestors are collected with a stack and
   * computed in ascending order (inputs first), so a chain of any length is safe (KERN-SM-6).
   */
  protected pull(r: ObjRec): void {
    if (!r.stale) return;
    const todo: ObjRec[] = [];
    const seen = new Set<ObjRec>();
    const stack: ObjRec[] = [r];
    while (stack.length > 0) {
      const x = stack.pop() as ObjRec;
      if (seen.has(x) || !x.stale) continue;
      seen.add(x);
      todo.push(x);
      for (const i of x.inputs) if (i.stale && !seen.has(i)) stack.push(i);
    }
    if (todo.length > 1) todo.sort((a, b) => a.order - b.order);
    for (const x of todo) {
      x.stale = false;
      if (x.p.kind === 'rule') this.setCell(x, this.compute(x));
      if (x.range !== undefined || x.rangeIn.length > 0) this.updateRange(x);
    }
  }

  protected setCell(r: ObjRec, cell: Cell): boolean {
    if (cellsEqual(r.cell, cell)) return false;
    if (this.pass && !this.pass.before.has(r) && !this.pass.added.has(r)) this.pass.before.set(r, r.cell);
    r.cell = cell;
    r.changedAt = this.epoch;
    this.pendingValues.add(r.id);
    return true;
  }

  /* ------------------------------ rule evaluation ------------------------------ */

  protected ensureSlots(n: number): void {
    const l = this.env.locals;
    if (l.length < n) l.length = n;
  }

  /** Computes the cell of a rule object from its inputs now. Never throws. */
  compute(r: ObjRec): Cell {
    const p = r.p;
    const compiled = p.compiled;
    if (!compiled) return NOT_SET;
    this.ensureSlots(p.checked.slots);
    const start = this.now?.();
    const res = evaluate(compiled, this.env);
    if (start !== undefined && this.now) {
      const ms = this.now() - start;
      if (ms > this.limits.ruleBudgetMs) this.slowRules.push({ id: r.id, name: p.name, ms });
    }
    return this.cellFromResult(res, p.tupleIndex);
  }

  protected cellFromResult(res: ReturnType<typeof evaluate>, tupleIndex?: number): Cell {
    if (!res.defined) {
      return { defined: false, reason: res.reason, ...(res.detail !== undefined ? { detail: res.detail } : {}), ...(res.cause !== undefined ? { cause: res.cause } : {}) };
    }
    if (tupleIndex === undefined) return this.sizeChecked(res.value);
    const arr = res.value as readonly unknown[];
    const v = Array.isArray(arr) ? arr[tupleIndex] : undefined;
    if (v instanceof RuleUndefined) return { defined: false, reason: v.reason, ...(v.detail !== undefined ? { detail: v.detail } : {}) };
    if (v === undefined || (typeof v === 'number' && v !== v)) return { defined: false, reason: 'not_finite' };
    return this.sizeChecked(v);
  }

  /** A defined cell, or undefined with reason `limit` when the value is a list longer than `listSize` (errors design 9). */
  protected sizeChecked(v: unknown): Cell {
    const n = ArrayBuffer.isView(v) ? (v as unknown as { length: number }).length : Array.isArray(v) ? v.length : 0;
    if (n > this.limits.listSize) return { defined: false, reason: 'limit', detail: `${n} items` };
    return { defined: true, value: v };
  }

  /** The `runCommand` hook given to the compiler: evaluates arguments, finds the rule and runs it. */
  readonly runCommand = (spec: CommandSpec, form: CommandForm, args: readonly CompiledArg[], env: Env): unknown => {
    this.ruleDepth++;
    try {
      let rule = this.ruleCache.get(args);
      if (!rule) {
        rule = form.rule(args.map((a) => ({ param: a.param, omitted: a.omitted, ...(a.binder !== undefined ? { binder: a.binder } : {}), ...(a.value !== undefined ? { value: a.value } : {}) }))) as CommandRule;
        if (!rule || typeof rule.run !== 'function') throw new Error('the rule factory returned no rule');
        this.ruleCache.set(args, rule);
      }
      const values: unknown[] = new Array<unknown>(args.length);
      let undefinedInput = false;
      for (let i = 0; i < args.length; i++) {
        const a = args[i] as CompiledArg;
        const kind = a.param.kind ?? 'value';
        if (kind !== 'value') continue;
        if (a.omitted || !a.eval) {
          values[i] = a.value;
          continue;
        }
        const v = a.eval(env);
        // a Number that is undefined is computed as NaN; rules that accept undefined see `undefined`
        const gone = v === undefined || (typeof v === 'number' && v !== v);
        values[i] = gone ? undefined : v;
        if (gone) undefinedInput = true;
      }
      if (undefinedInput && !rule.acceptsUndefined && !form.acceptsUndefined) {
        if (env.reason === undefined) env.reason = 'input_undefined';
        return undefined;
      }
      let used = 0;
      const cap = this.limits.ruleWork;
      const work: RuleWork = {
        limit: cap,
        get used() {
          return used;
        },
        get left() {
          return Math.max(0, cap - used);
        },
        spend: (n = 1) => {
          if (used > cap) return false;
          used += typeof n === 'number' && n > 0 ? n : 1;
          return used <= cap;
        },
      };
      const call: RuleCall = {
        env,
        spec,
        form,
        args,
        values,
        t: env.t,
        ids: args.map((a) => a.ref),
        tol: this.tolerance(),
        work,
        limits: this.limits,
        inputsOf: (id) => {
          const rec = this.byIdMap.get(id);
          return rec ? rec.valueIn.map((i) => ({ id: i.id, name: i.p.name, value: i.cell.defined ? i.cell.value : undefined })) : [];
        },
        argsOf: (id) => {
          const cmd = this.byIdMap.get(id)?.p.compiled?.command;
          if (!cmd) return [];
          const saved = { reason: env.reason, cause: env.cause, detail: env.detail };
          const out = cmd.args.map((a) => {
            if (!a.eval || (a.param.kind ?? 'value') !== 'value') return undefined;
            try {
              const v = a.eval(env);
              return typeof v === 'number' && v !== v ? undefined : v;
            } catch {
              return undefined;
            }
          });
          env.reason = saved.reason;
          env.cause = saved.cause;
          env.detail = saved.detail;
          return out;
        },
        slice: (source, target, opts) => {
          const tgt = this.byIdMap.get(target);
          if (!tgt) return err('unknown_name', { line: 0, col: 1, endCol: 1 }, { name: String(target) }, { recovery: 'fix_line', fingerprintKey: 'slice' });
          const src = source === 't' ? undefined : this.byIdMap.get(source);
          if (source !== 't' && !src) return err('unknown_name', { line: 0, col: 1, endCol: 1 }, { name: String(source) }, { recovery: 'fix_line', fingerprintKey: 'slice' });
          return this.sliceRecs(src, tgt, work, opts?.override === true);
        },
        fail: (reason, detail) => {
          if (env.reason === undefined) {
            env.reason = reason;
            if (detail !== undefined) env.detail = detail;
          }
          return undefined;
        },
        notify: (kind, params) => {
          // one notice per kind and line is enough: a rule may run many times in one pass
          if (this.ruleNotices.length >= 32 || this.ruleNotices.some((n) => n.kind === kind)) return;
          this.ruleNotices.push(makeNotice(kind as NoticeKind, params ?? {}));
        },
        evalArg: (i) => {
          const f = args[i]?.eval;
          if (!f) return undefined;
          const v = f(env);
          return typeof v === 'number' && v !== v ? undefined : v;
        },
      };
      const out = rule.run(call);
      if ((out === undefined || (typeof out === 'number' && out !== out)) && env.reason === undefined) env.reason = 'not_finite';
      return out;
    } catch {
      if (this.faults.length < MAX_FAULTS) this.faults.push(spec.name);
      if (env.reason === undefined) env.reason = 'not_finite';
      return undefined;
    } finally {
      this.ruleDepth--;
    }
  };

  /** The tolerance rules see. `FigureTx` reads `@tol` first. */
  protected tolerance(): number {
    return this.tolOption;
  }

  /**
   * The scratch evaluation behind `Figure.slice` and `RuleCall.slice`. `source` is a free object, or undefined for the clock.
   * Safe inside a running rule: it saves and restores the environment (reason, clock, locals) as well as the cells.
   * With `work`, each value costs one step plus one per rule run, and a spent budget leaves `timeout` cells.
   */
  protected sliceRecs(src: ObjRec | undefined, t: ObjRec, work?: RuleWork, override = false): Slice | ErrorObject {
    if (src && src.p.kind !== 'free' && !override) {
      return err('not_free', { line: 0, col: 1, endCol: 1 }, { name: src.p.name, inputs: src.valueIn.map((i) => i.p.name).join(', ') }, { recovery: 'choose', fingerprintKey: src.p.name });
    }
    if (this.ruleDepth > this.limits.depth) {
      return err('limit', { line: 0, col: 1, endCol: 1 }, { limit: 'depth', max: this.limits.depth, got: this.ruleDepth, what: 'nested rule runs' }, { recovery: 'rewrite', fingerprintKey: 'depth' });
    }
    const downIdx = new Set<number>();
    if (src) for (const o of this.downOf(src)) downIdx.add(o);
    else for (const o of this.clockDown()) downIdx.add(o);
    const anc = this.ancestorRecs([t]);
    const chain = anc.filter((r) => downIdx.has(r.order) && r.p.kind === 'rule');
    const touched = src ? [src, ...chain] : chain;
    const env = this.env;
    return {
      chain: chain.map((r) => r.p.name),
      run: (values) => {
        const saved = touched.map((r) => r.cell);
        const stale = touched.map((r) => r.stale);
        const savedClock = { ...this.clockState };
        const savedEnv = { t: env.t, bt: env.bt, beat: env.beat, reason: env.reason, cause: env.cause, detail: env.detail };
        const savedLocals = env.locals.slice();
        const out: Cell[] = [];
        const spent: Cell = { defined: false, reason: 'timeout' };
        try {
          for (const r of touched) r.stale = false;
          for (const v of values) {
            if (work && !work.spend(1 + chain.length)) {
              out.push(spent);
              continue;
            }
            if (src) src.cell = v === undefined || (typeof v === 'number' && v !== v) ? { defined: false, reason: 'explicit' } : { defined: true, value: v };
            else {
              env.t = v as number;
              env.bt = v as number;
              this.clockState.t = v as number;
            }
            for (const r of chain) r.cell = this.compute(r);
            out.push(t.cell);
          }
        } finally {
          touched.forEach((r, i) => {
            r.cell = saved[i] as Cell;
            r.stale = stale[i] as boolean;
          });
          this.clockState.t = savedClock.t;
          this.clockState.bt = savedClock.bt;
          this.clockState.beat = savedClock.beat;
          env.t = savedEnv.t;
          env.bt = savedEnv.bt;
          env.beat = savedEnv.beat;
          env.reason = savedEnv.reason;
          env.cause = savedEnv.cause;
          env.detail = savedEnv.detail;
          for (let i = 0; i < savedLocals.length; i++) env.locals[i] = savedLocals[i];
        }
        return out;
      },
    };
  }

  /** True while a rule runs: the figure is mid-update, so an operation called now would change what the update walks. */
  protected get busy(): boolean {
    return this.ruleDepth > 0;
  }

  /** The error an operation returns when called from inside a rule. */
  protected busyError(tool: string): ErrorObject {
    return err('tool_busy', { line: 0, col: 1, endCol: 1 }, {}, { hint: `${tool} cannot run while a rule is running; a rule must not change the figure.`, fingerprintKey: tool });
  }

  /** Compile options every line is compiled with. */
  compileOptions(selfId: ObjId): CompileOptions {
    return { selfId, runCommand: this.runCommand };
  }

  protected compileFor(line: Persist['checked'], selfId: ObjId): CompiledLine | undefined {
    const r = compileLine(line, this.compileOptions(selfId));
    return r.ok ? r.value : undefined;
  }

  /* ------------------------------ slider ranges ------------------------------ */

  /** Evaluates a slider's range and clamps its free value into it. Returns true when the value changed. */
  protected updateRange(r: ObjRec): boolean {
    const c = r.p.compiled;
    if (!c?.range) {
      r.range = undefined;
      return false;
    }
    this.ensureSlots(r.p.checked.slots);
    const min = c.range.min(this.env) as number;
    const max = c.range.max(this.env) as number;
    const step = c.range.step ? (c.range.step(this.env) as number) : undefined;
    const bounds = typeof min === 'number' && typeof max === 'number' && Number.isFinite(min) && Number.isFinite(max);
    const stepOk = step === undefined || (step === step && step > 0 && Number.isFinite(step));
    const ok = bounds && stepOk && min < max;
    const before = r.range;
    r.range = ok ? { min, max, ...(step !== undefined ? { step } : {}) } : undefined;
    if (r.p.kind !== 'free') return false;
    // a bound that is undefined or crosses makes the slider undefined; it keeps its last value for when the range returns
    // (numbers-sliders design 3.4)
    if (!ok) {
      const reason = bounds && stepOk ? 'empty_range' : 'range_undefined';
      if (!r.cell.defined && r.cell.reason === reason) return false;
      if (typeof r.p.value !== 'number') return false;
      return this.setCell(r, { defined: false, reason });
    }
    const last = r.cell.defined ? r.cell.value : (r.cell.reason === 'range_undefined' || r.cell.reason === 'empty_range') ? r.p.value : undefined;
    if (typeof last !== 'number') return false;
    let c2 = Math.min(max, Math.max(min, last));
    // a step that changed re-snaps the value to the new grid
    if (step !== undefined && before?.step !== undefined && before.step !== step) {
      const q = min + Math.round((c2 - min) / step) * step;
      c2 = Math.min(max, Math.max(min, Number(q.toPrecision(12))));
    }
    if (c2 === last && r.cell.defined) return false;
    r.p = { ...r.p, value: c2 };
    this.setCell(r, { defined: true, value: c2 });
    return true;
  }

  /* ------------------------------ graph wiring ------------------------------ */

  protected static uniq(xs: ObjRec[]): ObjRec[] {
    return xs.length < 2 ? xs : [...new Set(xs)];
  }

  /** Rebuilds the edges of an object from its persisted definition and registers it with its inputs. */
  wire(r: ObjRec): void {
    const ch = r.p.checked;
    const pick = (ids: readonly ObjId[] | undefined, own: ObjRec): ObjRec[] => {
      const out: ObjRec[] = [];
      for (const id of ids ?? []) {
        const x = this.byIdMap.get(id);
        if (x && x !== own) out.push(x);
      }
      return FigureCore.uniq(out);
    };
    r.valueIn = r.p.kind === 'free' ? [] : pick(ch.reads, r);
    r.rangeIn = pick(ch.rangeReads, r);
    r.inputs = FigureCore.uniq([...r.valueIn, ...r.rangeIn]);
    const sIn: ObjRec[] = [];
    for (const e of r.p.style.values()) for (const id of e.reads) {
      const x = this.byIdMap.get(id);
      if (x) sIn.push(x);
    }
    r.styleIn = FigureCore.uniq(sIn);
    for (const i of r.inputs) i.kids.push(r);
    for (const i of r.styleIn) i.styleKids.push(r);
    this.structureVersion++;
  }

  unwire(r: ObjRec): void {
    for (const i of r.inputs) removeOne(i.kids, r);
    for (const i of r.styleIn) removeOne(i.styleKids, r);
    r.inputs = [];
    r.valueIn = [];
    r.rangeIn = [];
    r.styleIn = [];
    this.structureVersion++;
  }

  renumber(from = 0): void {
    for (let i = from; i < this.list.length; i++) (this.list[i] as ObjRec).order = i;
    this.structureVersion++;
  }

  /** Every object that reads `r`, directly or not, as ascending order indices. */
  downOf(r: ObjRec): Int32Array {
    if (r.down && r.downVersion === this.structureVersion) return r.down;
    const seen = new Set<ObjRec>();
    const stack: ObjRec[] = [...r.kids];
    while (stack.length > 0) {
      const x = stack.pop() as ObjRec;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const k of x.kids) if (!seen.has(k)) stack.push(k);
    }
    const arr = new Int32Array(seen.size);
    let n = 0;
    for (const x of seen) arr[n++] = x.order;
    arr.sort();
    r.down = arr;
    r.downVersion = this.structureVersion;
    return arr;
  }

  /** The objects that read the clock, and everything downstream of them, as ascending order indices (the time set). */
  clockDown(): Int32Array {
    if (this.clockDown_ && this.clockDownVersion === this.structureVersion) return this.clockDown_;
    const seen = new Set<number>();
    for (const r of this.list) {
      if (r.p.kind === 'rule' && r.usesClock) {
        seen.add(r.order);
        for (const o of this.downOf(r)) seen.add(o);
      } else if (r.p.kind === 'free' && r.p.checked.rangeUsesT) {
        seen.add(r.order);
        for (const o of this.downOf(r)) seen.add(o);
      }
    }
    const arr = Int32Array.from(seen);
    arr.sort();
    this.clockDown_ = arr;
    this.clockDownVersion = this.structureVersion;
    this.clockStyleCache = this.list.filter((r) => [...r.p.style.values()].some((e) => e.usesT));
    return arr;
  }
  private clockDown_: Int32Array | undefined;

  /** True when `target` is reachable from `from` through value or range edges (a membership test on the cached closure). */
  reaches(from: ObjRec, target: ObjRec): boolean {
    if (from === target) return true;
    const d = this.downOf(from);
    let lo = 0;
    let hi = d.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = d[mid] as number;
      if (v === target.order) return true;
      if (v < target.order) lo = mid + 1;
      else hi = mid - 1;
    }
    return false;
  }

  /** The ancestors (through value and range edges) of `seeds` with order at least `minOrder`, including the seeds. */
  ancestorRecs(seeds: readonly ObjRec[], minOrder = 0): ObjRec[] {
    const seen = new Set<ObjRec>();
    const stack = [...seeds];
    while (stack.length > 0) {
      const x = stack.pop() as ObjRec;
      if (seen.has(x) || x.order < minOrder) continue;
      seen.add(x);
      for (const i of x.inputs) stack.push(i);
    }
    return [...seen].sort((a, b) => a.order - b.order);
  }

  /* ------------------------------ demand (lazy values) ------------------------------ */

  /**
   * Lazy mode: the ids the host reads (visible drawables, readouts). The pass computes those and what they read; the
   * rest is marked stale and computed when read. `null` returns to eager mode.
   */
  setDemand(ids: Iterable<ObjId> | null): void {
    this.demand = ids === null || ids === undefined || typeof (ids as Iterable<ObjId>)[Symbol.iterator] !== 'function' ? null : new Set(ids);
    this.neededVersion = -1;
    if (this.demand !== null) return;
    for (const r of this.list) if (r.stale) this.pull(r);
  }

  protected neededArray(): Uint8Array | null {
    if (this.demand === null) return null;
    if (this.needed && this.neededVersion === this.structureVersion) return this.needed;
    const n = new Uint8Array(this.list.length);
    const seeds: ObjRec[] = [];
    for (const id of this.demand) {
      const r = this.byIdMap.get(id);
      if (r) seeds.push(r);
    }
    for (const r of this.ancestorRecs(seeds)) n[r.order] = 1;
    this.needed = n;
    this.neededVersion = this.structureVersion;
    return n;
  }

  /* ------------------------------ the update pass ------------------------------ */

  /** Marks a free object or state as written; the next `flush` updates what reads it. */
  markDirty(r: ObjRec): void {
    this.dirty.add(r);
  }

  markClockDirty(): void {
    this.clockDirty = true;
  }

  /**
   * One pass over everything marked since the last flush: the merged downstream sets of the dirty sources, in ascending
   * order, each rule once, and only when an input actually changed value.
   */
  flush(force = false): FrameDelta {
    if (this.busy) return { valueIds: [], styleIds: [], undefinedChanges: [], ran: 0 };
    const drivers = this.stateDriver ? this.stateDriver() : [];
    for (const s of drivers) this.dirty.add(s);
    if (this.dirty.size === 0 && !this.clockDirty && !force) return { valueIds: [], styleIds: [], undefinedChanges: [], ran: 0 };
    this.epoch++;
    const epoch = this.epoch;
    const sources = [...this.dirty];
    this.dirty.clear();
    const clockChanged = this.clockDirty;
    this.clockDirty = false;
    for (const s of sources) s.changedAt = epoch;

    // 1. candidates
    const cand: number[] = [];
    const mark = this.markArray();
    const take = (arr: Int32Array): void => {
      for (let i = 0; i < arr.length; i++) {
        const o = arr[i] as number;
        if (mark[o] !== epoch) {
          mark[o] = epoch;
          cand.push(o);
        }
      }
    };
    for (const s of sources) take(this.downOf(s));
    if (clockChanged) take(this.clockDown());
    const order = Int32Array.from(cand);
    order.sort();

    // 2. walk
    const needed = this.neededArray();
    const valueIds: ObjId[] = [];
    const styleSet = new Set<ObjRec>();
    const changes: UndefChange[] = [];
    let ran = 0;
    for (let k = 0; k < order.length; k++) {
      const r = this.list[order[k] as number] as ObjRec;
      let go = clockChanged && r.usesClock;
      if (!go) for (const i of r.inputs) if (i.changedAt === epoch || i.stale) { go = true; break; }
      if (!go) continue;
      if (needed !== null && needed[r.order] !== 1 && !this.forceAll) {
        r.stale = true;
        continue;
      }
      r.stale = false;
      const wasCell = r.cell;
      let changed = false;
      if (r.p.kind === 'rule') {
        ran++;
        changed = this.setCell(r, this.compute(r));
      }
      if (r.rangeIn.length > 0 || (clockChanged && r.p.checked.rangeUsesT)) {
        if (this.updateRange(r)) changed = true;
      } else if (r.p.kind === 'free' && r.p.compiled?.range && changed === false && r.range === undefined) {
        this.updateRange(r);
      }
      if (changed) {
        valueIds.push(r.id);
        if (!wasCell.defined || !r.cell.defined) changes.push({ id: r.id, name: r.p.name, now: r.cell, was: wasCell });
      }
    }
    // 3. style rules that read something that changed
    for (const s of sources) for (const o of s.styleKids) styleSet.add(o);
    for (const id of valueIds) for (const o of (this.byIdMap.get(id) as ObjRec).styleKids) styleSet.add(o);
    if (clockChanged) {
      this.clockDown();
      for (const o of this.clockStyleCache ?? []) styleSet.add(o);
    }
    for (const o of styleSet) {
      o.styleCache = undefined;
      this.pendingStyles.add(o.id);
    }
    for (const s of sources) valueIds.unshift(s.id);
    const styleIds = [...styleSet].map((o) => o.id);
    return { valueIds, styleIds, undefinedChanges: changes, ran };
  }

  /** Set during an operation that must report on every downstream object, whatever the demand. */
  protected forceAll = false;

  private markBuf = new Uint32Array(0);
  private markArray(): Uint32Array {
    if (this.markBuf.length < this.list.length) this.markBuf = new Uint32Array(Math.max(this.list.length * 2, 64));
    return this.markBuf;
  }

  /* ------------------------------ style ------------------------------ */

  /** The static properties of an object: the type defaults with its constant `with` values on top. */
  propsOf(r: ObjRec): Props {
    const onPath = r.p.node.k === 'define' && r.p.node.expr.k === 'call' && r.p.node.expr.callee === 'PointOn';
    const base = defaultsFor(r.p.type.k, r.p.kind === 'free', onPath);
    for (const e of r.p.style.values()) {
      const v = e.word ?? e.value;
      if (e.eval === undefined && v !== undefined) {
        const c = coerceStatic(e.key, v);
        if (c.ok) setProp(base, e.key, c.value);
      }
    }
    return base;
  }

  /** What a view draws: static properties with the property rules evaluated now. Rules that fail leave the static value. */
  styleOf(id: ObjId): EffectiveStyle | undefined {
    const r = this.byIdMap.get(id);
    if (!r) return undefined;
    if (r.styleCache && !(this.hasClockStyle(r) && r.styleCache !== undefined && this.styleClockStamp.get(r) !== this.clockStamp())) return r.styleCache;
    const props = this.propsOf(r);
    let showIf: boolean | undefined | 'none' = 'none';
    let showText: string | undefined;
    this.ensureSlots(r.p.checked.slots);
    for (const e of r.p.style.values()) {
      if (e.key === 'showIf') {
        showText = e.text;
        if (e.eval === undefined) showIf = typeof e.value === 'boolean' ? e.value : 'none';
        else {
          this.env.reason = undefined;
          const v = e.eval(this.env);
          showIf = typeof v === 'boolean' ? v : undefined;
        }
        continue;
      }
      if (e.eval === undefined) continue;
      this.env.reason = undefined;
      this.env.cause = undefined;
      const raw = e.eval(this.env);
      if (own(PROPERTIES, e.key) === undefined) {
        setProp(props, e.key, raw);
        continue;
      }
      const v = coerceDynamic(e.key, raw);
      // a rule that is undefined leaves the static value and raises no warning (design 9.4)
      if (v !== undefined) setProp(props, e.key, v);
    }
    const eff = toEffective(props, showIf, showText);
    r.styleCache = eff;
    this.styleClockStamp.set(r, this.clockStamp());
    return eff;
  }

  private readonly styleClockStamp = new Map<ObjRec, number>();
  private hasClockStyle(r: ObjRec): boolean {
    for (const e of r.p.style.values()) if (e.usesT) return true;
    return false;
  }
  protected clockStamp(): number {
    return this.clockState.t * 1e6 + this.clockState.beat + this.clockState.bt * 1e-3;
  }

  /* ------------------------------ events ------------------------------ */

  /** Subscribe to figure events. Returns the function that unsubscribes. */
  on(listener: Listener): () => void {
    if (typeof listener !== 'function') return () => false;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected queue(ev: FigureEvent): void {
    this.pendingEvents.push(ev);
  }

  /** True while listeners are being called: an operation a listener makes queues its events for the running delivery. */
  protected delivering = false;

  /**
   * Delivers the queued events once, batched: one `value` and one `style` event per round. Listener faults are counted,
   * never thrown. A listener may call the figure: the events that causes are queued and delivered after the current ones,
   * so every listener sees the events in the order the figure changed (KERN-SM-15).
   */
  protected deliver(): void {
    if (this.opDepth > 0 || this.delivering) return;
    this.delivering = true;
    try {
      for (let round = 0; round < 1000; round++) {
        const evs = this.pendingEvents;
        this.pendingEvents = [];
        if (this.pendingValues.size > 0) evs.push({ ev: 'value', ids: [...this.pendingValues] });
        if (this.pendingStyles.size > 0) evs.push({ ev: 'style', ids: [...this.pendingStyles] });
        this.pendingValues = new Set();
        this.pendingStyles = new Set();
        if (evs.length === 0 || this.listeners.size === 0) return;
        for (const ev of evs) {
          for (const l of [...this.listeners]) {
            try {
              l(ev);
            } catch {
              this.listenerFailures++;
            }
          }
        }
      }
    } finally {
      this.delivering = false;
    }
  }

  /** Listener faults since the last call (they become a `listener_failed` notice). */
  takeListenerFailures(): number {
    const n = this.listenerFailures;
    this.listenerFailures = 0;
    return n;
  }

  /* ------------------------------ queries ------------------------------ */

  /** The object ids a name or id refers to. */
  recOf(x: Name | ObjId): ObjRec | undefined {
    return typeof x === 'string' ? this.byNameMap.get(x) : this.byIdMap.get(x);
  }

  /** Follows `cause` links to the root undefined object; returns the chain of cells' reasons. */
  rootOf(r: ObjRec): { rec: ObjRec; reason: UndefReason } | undefined {
    let cur: ObjRec = r;
    for (let guard = 0; guard < this.list.length + 1; guard++) {
      const c = this.cellOfRec(cur);
      if (c.defined) return undefined;
      if (c.reason !== 'input_undefined' || c.cause === undefined) return { rec: cur, reason: c.reason };
      const next = this.byIdMap.get(c.cause);
      if (!next) return { rec: cur, reason: c.reason };
      cur = next;
    }
    return undefined;
  }

  protected errorKindOf(kind: ErrorKind): ErrorKind {
    return kind;
  }
}

function removeOne<T>(arr: T[], x: T): void {
  const i = arr.indexOf(x);
  if (i >= 0) arr.splice(i, 1);
}

function coerceStatic(key: string, v: unknown): { ok: boolean; value?: unknown } {
  const spec = own(PROPERTIES, key);
  if (!spec) return { ok: true, value: v };
  if (spec.kind === 'number' && typeof v === 'number' && v === v) return { ok: true, value: Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, v)) };
  const c = coerceDynamic(key, v);
  return c === undefined ? { ok: false } : { ok: true, value: c };
}

export type { StyleEntry };
