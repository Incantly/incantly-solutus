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
import { EMPTY_COMMANDS, SELF_ID, createCommandTable } from './table';
import type { CommandSpec, CommandTable, FigureView, FunctionTable, ObjectInfo } from './table';
import { parseLine } from './parser';
import { printLineNode, printStyle } from './printer';
import type { LineNode, StyleItem } from './ast';
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

/**
 * One property rule of an object (`opacity = f(1)`): kernel design 9.2 makes it an edge from the objects it reads.
 * It is kept per property, whether it came from the defining line or from a later `P with ...` line, so the next
 * rule for the same property replaces it and its reads stop being edges. `source` is a restyle line that re-checks
 * only this rule.
 */
interface StyleRule {
  readonly source: string;
  readonly reads: readonly ObjId[];
}

interface Entry {
  info: ObjectInfo;
  value: unknown;
  /** Value and slider-bound reads: the edges of the cycle test (`inputsOf`). */
  inputs: ObjId[];
  /**
   * The property rules that read objects, by property name. They are not cycle edges (kernel design 9.2, ruling SM-23),
   * but they are readers for the dependents test. A rule that reads nothing is not stored.
   */
  styleRules?: Map<string, StyleRule>;
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
  styleRulesReading(id: ObjId): readonly { readonly name: string; readonly source: string }[] {
    const out: { name: string; source: string }[] = [];
    for (const n of this.order) {
      const e = this.byName.get(n) as Entry;
      for (const r of e.styleRules?.values() ?? []) if (r.reads.includes(id)) out.push({ name: n, source: r.source });
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
    // a replaced object keeps its property rules (language design 3.12 step 6: style is kept)
    if (existing?.styleRules) entry.styleRules = existing.styleRules;
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
    if (line.kind === 'restyle') this.recordStyleRules(line, parsed.value.node);
    if ((line.kind !== 'define' && line.kind !== 'function') || !line.expr) {
      return { ok: true, value: { name: line.names[0] ?? '', ...base, summary: line.text, defined: true }, notices };
    }
    const compiled = compileLine(line, { selfId: this.byName.get(line.names[0] as string)?.info.id ?? (this.nextId as ObjId) });
    if (!compiled.ok) return compiled;
    const name = line.names[0] as string;
    const env = this.env(Math.max(line.slots, 4));
    const r = evaluate(compiled.value, env);
    // the cycle graph holds value and range edges (ruling SM-23); style edges are not part of it (kernel design 9.2),
    // but they are kept apart so that a redefinition still re-checks the styles that read the object
    const inputs = new Set<ObjId>([...line.reads, ...(line.rangeReads ?? [])]);
    const info = this.define(name, line.type as Ty, r.defined ? r.value : undefined, {
      // the object's own rule only: its property rules are stored per property and re-checked on their own
      source: printLineNode(withoutStyle(parsed.value.node)),
      inputs: [],
      free: line.free,
      slider: line.range !== undefined,
      state: line.isState,
      ...(line.unit ? { unit: line.unit } : {}),
    });
    const entry = this.byName.get(name) as Entry;
    entry.inputs = [...inputs];
    this.recordStyleRules(line, parsed.value.node);
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

  /**
   * Store the property rules a line sets on its target (the `with` list of a definition or of a `P with ...` line).
   * A rule for a property replaces the earlier rule for that property, wherever the earlier one came from, so the
   * reads of the replaced rule stop being edges. A rule that reads nothing only removes the earlier one.
   */
  private recordStyleRules(line: CheckedLine, node: LineNode): void {
    const e = this.byName.get(line.names[0] as string);
    if (!e) return;
    const items = styleItemsOf(node);
    for (const st of line.style ?? []) {
      const rules = e.styleRules ?? new Map<string, StyleRule>();
      rules.delete(st.key);
      // LANG-SM-33: the object's own id replaces SELF_ID, so a style that reads the object keeps its self link
      const own = this.byName.get(line.names[0] as string)?.info.id;
      const reads = (st.reads ?? []).map((id) => (id === SELF_ID && own !== undefined ? own : id)).filter((id) => id !== SELF_ID);
      const item = [...items].reverse().find((i) => i.key === st.key);
      if (reads.length > 0 && item) rules.set(st.key, { source: `${line.names[0]} ${printStyle([item])}`, reads });
      if (rules.size > 0) e.styleRules = rules;
      else delete e.styleRules;
    }
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

function styleItemsOf(node: LineNode): readonly StyleItem[] {
  return node.k === 'define' || node.k === 'function' || node.k === 'restyle' ? (node.style ?? []) : [];
}

/** The line without its `with` list: the object's own rule. */
function withoutStyle(node: LineNode): LineNode {
  if (node.k !== 'define' && node.k !== 'function') return node;
  const { style, ...rest } = node;
  void style;
  return rest;
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
