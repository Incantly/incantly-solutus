/**
 * A small in-memory figure for tools, previews and experiments: it implements `FigureView` and
 * can apply simple definition lines (numbers, points, texts, lists, functions, relations).
 * It is NOT the kernel: it has no undo, no ordering moves, no commands, no states stepping.
 * The kernel area provides the real `FigureView`.
 */
import type { ErrorKind, Notice, Result } from '../contracts/errors';
import type { ObjId, UndefReason } from '../contracts/values';
import { checkLine } from './lines';
import type { CheckedLine } from './check';
import { compileLine, evaluate } from './compile';
import type { CompiledLine } from './compile';
import { EMPTY_COMMANDS, createCommandTable } from './table';
import type { CommandSpec, CommandTable, FigureView, FunctionTable, ObjectInfo } from './table';
import { parseLine } from './parser';
import { createEnv, valueText } from './runtime';
import type { Env } from './runtime';
import { parseTy } from './types';
import type { Ty } from './types';

export interface DefineOptions {
  source?: string;
  inputs?: readonly string[];
  free?: boolean;
  slider?: boolean;
  state?: boolean;
  unit?: 'angle';
}

export interface Applied {
  readonly name: string;
  readonly names: readonly string[];
  readonly type: Ty | undefined;
  readonly kind: CheckedLine['kind'];
  readonly op: CheckedLine['op'];
  /** Compact value text, or `undefined (reason)`. */
  readonly summary: string;
  readonly defined: boolean;
  readonly reason?: UndefReason;
}

interface Entry {
  info: ObjectInfo;
  value: unknown;
  inputs: ObjId[];
  compiled?: CompiledLine;
  env?: Env;
  reason?: UndefReason | undefined;
}

export class ScratchFigure implements FigureView {
  readonly commands: CommandTable;
  readonly functions?: FunctionTable | undefined;
  readonly directives?: readonly string[] | undefined;
  private readonly byName = new Map<string, Entry>();
  private readonly byIdMap = new Map<ObjId, Entry>();
  private order: string[] = [];
  private nextId = 1;
  private clockState = { t: 0, bt: 0, beat: 0 };

  constructor(opts: { commands?: CommandTable | readonly CommandSpec[]; functions?: FunctionTable } = {}) {
    const c = opts.commands;
    this.commands = c === undefined ? EMPTY_COMMANDS : Array.isArray(c) ? createCommandTable(c as readonly CommandSpec[]) : (c as CommandTable);
    this.functions = opts.functions;
  }

  get size(): number {
    return this.order.length;
  }

  lookup(name: string): ObjectInfo | undefined {
    return this.byName.get(name)?.info;
  }
  byId(id: ObjId): ObjectInfo | undefined {
    return this.byIdMap.get(id)?.info;
  }
  names(): readonly string[] {
    return this.order;
  }
  inputsOf(id: ObjId): readonly ObjId[] {
    return this.byIdMap.get(id)?.inputs ?? [];
  }
  dependentsOf(id: ObjId): readonly ObjectInfo[] {
    const out: ObjectInfo[] = [];
    for (const n of this.order) {
      const e = this.byName.get(n) as Entry;
      if (e.inputs.includes(id)) out.push(e.info);
    }
    return out;
  }
  read(id: ObjId): unknown {
    return this.byIdMap.get(id)?.value;
  }
  clock(): { t: number; bt: number; beat: number } {
    return this.clockState;
  }
  setClock(t: number, bt = 0, beat = 0): void {
    this.clockState = { t, bt, beat };
    this.recompute();
  }

  /** An environment that reads this figure's values. */
  env(slots = 16): Env {
    return createEnv({ ...this.clockState, read: (id) => this.read(id), slots });
  }

  /** Add or replace an object with a given type and value (type text such as `Number` or `List<Point>`). */
  define(name: string, type: Ty | string, value: unknown, opts: DefineOptions = {}): ObjectInfo {
    const ty = typeof type === 'string' ? (parseTy(type) as Ty) : type;
    const existing = this.byName.get(name);
    const id = existing ? existing.info.id : (this.nextId++ as ObjId);
    // an input name the figure does not know is skipped: this method returns the object, it never throws
    const inputs: ObjId[] = [];
    for (const n of opts.inputs ?? []) {
      const dep = this.byName.get(n);
      if (dep) inputs.push(dep.info.id);
    }
    const info: ObjectInfo = {
      id,
      name,
      type: ty,
      ...(opts.unit ? { unit: opts.unit } : {}),
      free: opts.free ?? inputs.length === 0,
      ...(opts.slider ? { slider: true } : {}),
      ...(opts.state ? { state: true } : {}),
      ...(opts.source !== undefined ? { source: opts.source } : {}),
    };
    const entry: Entry = { info, value, inputs };
    this.byName.set(name, entry);
    this.byIdMap.set(id, entry);
    if (!existing) this.order.push(name);
    return info;
  }

  /** Set the value of a free object, then recompute everything after it. */
  setValue(name: string, value: unknown): void {
    const e = this.byName.get(name);
    if (!e) return;
    e.value = value;
    this.recompute();
  }

  valueOf(name: string): unknown {
    return this.byName.get(name)?.value;
  }

  /** Re-evaluate every object that has a compiled rule, in creation order. */
  recompute(): void {
    const env = this.env();
    for (const n of this.order) {
      const e = this.byName.get(n) as Entry;
      if (!e.compiled || e.info.free) continue;
      const r = evaluate(e.compiled, e.env ?? env);
      if (r.defined) {
        e.value = r.value;
        e.reason = undefined;
      } else {
        e.value = undefined;
        e.reason = r.reason;
      }
    }
  }

  /** Apply one definition line: parse, check, compile, evaluate, store. Returns the error on failure. */
  apply(source: string, opts: { line?: number; failed?: ReadonlyMap<string, { line: number; kind: ErrorKind }> } = {}): Result<Applied> {
    const parsed = parseLine(source, {
      ...(opts.line !== undefined ? { line: opts.line } : {}),
      isTaken: (n) => this.lookup(n) !== undefined,
    });
    if (!parsed.ok) return parsed;
    const checked = checkLine(parsed.value, this, opts.failed ? { failed: opts.failed } : {});
    if (!checked.ok) return checked;
    const line = checked.value;
    const notices: Notice[] = [...parsed.notices, ...checked.notices];
    const base = { names: line.names, type: line.type, kind: line.kind, op: line.op };
    if ((line.kind !== 'define' && line.kind !== 'function') || !line.expr) {
      return { ok: true, value: { name: line.names[0] ?? '', ...base, summary: line.text, defined: true }, notices };
    }
    const compiled = compileLine(line);
    if (!compiled.ok) return compiled;
    const name = line.names[0] as string;
    const env = this.env(Math.max(line.slots, 4));
    const r = evaluate(compiled.value, env);
    const inputs = line.reads;
    const info = this.define(name, line.type as Ty, r.defined ? r.value : undefined, {
      source: line.text,
      inputs: [],
      free: line.free,
      slider: line.range !== undefined,
      state: line.isState,
      ...(line.unit ? { unit: line.unit } : {}),
    });
    const entry = this.byName.get(name) as Entry;
    entry.inputs = [...inputs];
    entry.compiled = compiled.value;
    entry.env = env;
    entry.reason = r.defined ? undefined : r.reason;
    void info;
    const summary = r.defined ? `${name} = ${valueText(r.value)}` : `${name} = undefined (${r.reason})`;
    return {
      ok: true,
      value: { name, ...base, summary, defined: r.defined, ...(r.defined ? {} : { reason: r.reason }) },
      notices,
    };
  }

  /** Apply several lines in order. A line that reads a name made by a failed line is marked `blockedBy`. */
  applyAll(lines: readonly string[]): Result<Applied>[] {
    const failed = new Map<string, { line: number; kind: ErrorKind }>();
    return lines.map((src, i) => {
      const r = this.apply(src, { line: i + 1, failed });
      if (!r.ok) {
        for (const n of targetNamesOf(src)) failed.set(n, { line: i + 1, kind: r.kind });
      }
      return r;
    });
  }
}

/**
 * The names a definition line would create, read from the text alone (so it works for lines that
 * fail to parse): `A = …`, `f(x) = …`, `A, B = …`, `v' = …` gives nothing.
 */
// a name may carry a braced subscript, `P_{1}`, which is stored as the lexer reads it: `P_1`
const TARGET_NAME = String.raw`[A-Za-z\u0370-\u03FF][A-Za-z0-9_\u0370-\u03FF]*(?:(?<=_)\{[A-Za-z0-9,]+\})?`;
const TARGET_LINE = new RegExp(String.raw`^\s*(${TARGET_NAME}(?:\s*,\s*${TARGET_NAME})*)\s*(?:\([^)]*\))?\s*=(?!=)`);
const TARGET_EACH = new RegExp(TARGET_NAME, 'g');

export function targetNamesOf(source: string): string[] {
  const m = TARGET_LINE.exec(source);
  if (!m) return [];
  return (m[1] as string).match(TARGET_EACH)?.map((n) => n.replace(/^(.*)_\{([A-Za-z0-9]+)\}$/, '$1_$2')) ?? [];
}
