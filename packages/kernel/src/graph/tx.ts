/**
 * The line pipeline (docs/features/kernel/design.md section 5): parse, resolve names, type-check, plan, compute once,
 * commit. Everything before the commit touches nothing; a rejected line leaves the figure, the journal and the clock as
 * they were. Also holds the replay of journal entries, which undo, redo and rollback share.
 */
import type { ErrorKind, ErrorObject, Notice } from '../contracts/errors';
import type { ObjId } from '../contracts/values';
import { err, internalError } from '../errors/table';
import { makeNotice } from '../errors/notices';
import type { JournalEntry, Reanchor, ScriptItem } from '../history/journal';
import type { Expr, LineNode, ParsedLine, StyleItem } from '../language/ast';
import type { CheckedLine } from '../language/check';
import { compileLine, evaluate } from '../language/compile';
import type { CompiledLine } from '../language/compile';
import { closestNames } from '../language/errors';
import { checkLine } from '../language/lines';
import { parseLine } from '../language/parser';
import { printExpr, printLineNode, printRange } from '../language/printer';
import { valueText } from '../language/runtime';
import { SELF_ID } from '../language/table';
import type { TArg, TNode } from '../language/tnode';
import type { Ty } from '../language/types';
import { children } from '../language/relation';
import { FigureBase } from './base';
import { ObjRec } from './core';
import { coerceProp, defaultsFor, isValidKey, validKeysFor } from './props';
import type { ActionRule } from './registry';
import type { ApplyOptions, Cell, ChangeReport, Persist, RateRule, StyleEntry, TxOk, TxOp, TxResult } from './types';
import { sameValue, valueSource } from './values';

const REPEATABLE: ReadonlySet<string> = new Set(['step', 'beat', 'cell', 'colwidth', 'limit']);
export const SCRIPT_VERSION = 1;

export const emptyReport = (): ChangeReport => ({ added: [], removed: [], redefined: [], moved: [], becameUndefined: [], becameDefined: [], warnings: [] });

const stripStyle = (n: LineNode): LineNode => {
  if (n.k !== 'define' && n.k !== 'function') return n;
  const { style, ...rest } = n;
  void style;
  return rest as LineNode;
};

function usesClockNode(n: TNode): boolean {
  if (n.n === 'clock') return true;
  for (const c of children(n)) if (usesClockNode(c)) return true;
  return false;
}

/** What an action handler gets. */
export interface ActionContext {
  readonly parsed: ParsedLine;
  readonly checked: CheckedLine;
  readonly args: readonly TArg[];
  /** The object each argument names, when it is a plain object name. */
  readonly objects: readonly (ObjRec | undefined)[];
  readonly rep: ChangeReport;
  readonly opts: ApplyOptions;
}

export type ActionResult = { readonly summary: string; readonly data?: unknown; readonly op?: TxOp } | ErrorObject;
export type ActionHandler = (ctx: ActionContext) => ActionResult;

type DefLine = Extract<LineNode, { k: 'define' | 'function' | 'defmany' }>;

export class FigureTx extends FigureBase {
  protected readonly actionHandlers = new Map<string, ActionHandler>();
  /** The journal entry the current line recorded, so a fault can take it back. */
  protected txEntry: JournalEntry | undefined;

  /* ------------------------------ errors ------------------------------ */

  protected fail(parsed: ParsedLine | undefined, kind: ErrorKind, params: Record<string, string | number | boolean | readonly string[]>, extra: Parameters<typeof err>[3] = {}, s?: number, e?: number): ErrorObject {
    const sp = this.at(parsed, s, e);
    const source = parsed && parsed.source.length <= 200 ? parsed.source : undefined;
    return err(kind, sp, params, { token: sp.token, ...(source !== undefined ? { source } : {}), ...extra });
  }

  protected isFixed(r: ObjRec): boolean {
    return r.p.style.get('fixed')?.value === true;
  }

  protected lockedError(parsed: ParsedLine | undefined, r: ObjRec, s?: number, e?: number): ErrorObject {
    const line = `${r.p.name} with fixed = false`;
    return this.fail(parsed, 'locked', { name: r.p.name }, { hint: `Unfix it first: ${line}`, suggest: [line], recovery: 'choose', fingerprintKey: r.p.name }, s, e);
  }

  /* ------------------------------ record ------------------------------ */

  protected record(e: JournalEntry): void {
    this.txEntry = e;
    if (!this.replaying) this.journal.record(e);
  }

  /** Takes back the entry the current line recorded (a fault after the commit). */
  protected rollbackTx(): void {
    const e = this.txEntry;
    this.txEntry = undefined;
    if (!e) return;
    this.journal.discard(e);
    this.inPass(() => this.revertEntry(e));
  }

  /* ------------------------------ apply ------------------------------ */

  /**
   * One transaction. Takes the text of a line (or a parsed line) and returns a `TxResult`: the report of what changed, or
   * the error with the figure untouched. With `dryRun` it checks and plans, evaluates the new object, and commits nothing.
   * Never throws.
   */
  apply(input: string | ParsedLine, opts: ApplyOptions = {}): TxResult {
    this.faults = [];
    this.txEntry = undefined;
    const lineNo = opts.line ?? (typeof input === 'string' ? 1 : input.line);
    let result: TxResult;
    try {
      result = this.inPass((pass) => {
        const r = this.applyInner(input, opts, pass);
        if (r.ok === false) return r;
        if (this.faults.length > 0) {
          const bad = this.faults[0] as string;
          if (!opts.dryRun) this.rollbackTx();
          return internalError(bad, { line: lineNo, col: 1, endCol: 1 }, '', bad);
        }
        return r;
      });
    } catch {
      this.rollbackTx();
      result = internalError('the figure', { line: lineNo, col: 1, endCol: 1 }, '', 'apply');
    }
    this.deliver();
    if (result.ok) {
      const failed = this.takeListenerFailures();
      if (failed > 0) (result.notices as Notice[]).push(makeNotice('listener_failed', { where: 'a listener' }));
    }
    return result;
  }

  protected applyInner(input: string | ParsedLine, opts: ApplyOptions, pass: import('./core').Pass): TxResult {
    const lineNo = opts.line ?? (typeof input === 'string' ? 1 : input.line);
    const notices: Notice[] = [];
    let parsed: ParsedLine;
    if (typeof input === 'string') {
      const pr = parseLine(input, {
        line: lineNo,
        isTaken: (n) => this.byNameMap.has(n),
        isObjectCommand: (n) => this.commands.lookup(n)?.kind === 'object',
      });
      if (!pr.ok) return pr;
      parsed = pr.value;
      notices.push(...pr.notices);
    } else parsed = input;
    parsed = this.rewriteRename(parsed);

    const copts = opts.failed ? { failed: opts.failed } : {};
    let cr = checkLine(parsed, this.view, copts);
    let assign = false;
    if (!cr.ok && cr.kind === 'cycle' && this.isSelfAssignment(parsed, cr)) {
      const again = checkLine(parsed, this.view, { ...copts, skipGraphChecks: true });
      if (again.ok) {
        cr = again;
        assign = true;
      }
    }
    if (!cr.ok) return cr;
    notices.push(...cr.notices);
    const checked = cr.value;
    switch (checked.kind) {
      case 'noop':
        return this.applyNoop(parsed, notices, opts);
      case 'directive':
        return this.applyDirective(parsed, checked, notices, opts);
      case 'define':
      case 'function':
      case 'defmany':
        return this.applyDefine(parsed, checked, notices, opts, assign, pass);
      case 'rate':
        return this.applyRate(parsed, checked, notices, opts, pass);
      case 'restyle':
        return this.applyRestyle(parsed, checked, notices, opts, pass);
      case 'rerange':
        return this.applyRerange(parsed, checked, notices, opts, pass);
      case 'action':
        return this.applyAction(parsed, checked, notices, opts, pass);
    }
  }

  /** `Rename(M, N)` with a bare new name is read as `Rename(M, "N")` when no object is called N. */
  protected rewriteRename(parsed: ParsedLine): ParsedLine {
    const n = parsed.node;
    if (n.k !== 'action' || n.expr.callee !== 'Rename' || n.expr.args.length !== 2) return parsed;
    const second = (n.expr.args[1] as { value: Expr }).value;
    if (second.k !== 'name' || this.byNameMap.has(second.name)) return parsed;
    const str: Expr = { k: 'str', parts: [second.name], s: second.s, e: second.e };
    const args = [n.expr.args[0] as (typeof n.expr.args)[number], { ...(n.expr.args[1] as (typeof n.expr.args)[number]), value: str }];
    return { ...parsed, node: { ...n, expr: { ...n.expr, args } } };
  }

  /** `a = a + 1` on a free Number, Point or Bool is an assignment, not a cycle (kernel design 8). */
  protected isSelfAssignment(parsed: ParsedLine, e: ErrorObject): boolean {
    const n = parsed.node;
    if (n.k !== 'define' || !e.path || e.path.length !== 2 || e.path[0] !== n.target.name || e.path[1] !== n.target.name) return false;
    const r = this.byNameMap.get(n.target.name);
    if (!r || r.p.kind !== 'free') return false;
    return r.p.type.k === 'Number' || r.p.type.k === 'Point' || r.p.type.k === 'Bool';
  }

  /* ------------------------------ result builders ------------------------------ */

  protected okResult(parsed: ParsedLine | undefined, op: TxOp, summary: string, rep: ChangeReport, extra: Partial<TxOk> = {}): TxOk {
    return { ok: true, line: parsed?.line ?? 0, op, summary, changed: rep, notices: rep.warnings, ...extra } as TxOk;
  }

  protected summaryOf(r: ObjRec): string {
    const c = r.cell;
    return c.defined ? `${r.p.name} = ${valueText(c.value)}` : `${r.p.name} is undefined (${c.reason})`;
  }

  /* ------------------------------ comments and directives ------------------------------ */

  protected lastObjectId(): ObjId | null {
    const l = this.list[this.list.length - 1];
    return l ? l.id : null;
  }

  protected applyNoop(parsed: ParsedLine, notices: Notice[], opts: ApplyOptions): TxResult {
    const rep = emptyReport();
    rep.warnings = notices;
    const text = parsed.source.trim();
    if (!text.startsWith('#')) return this.okResult(parsed, 'noop', '', rep);
    if (!opts.dryRun) {
      const item: ScriptItem = { text, after: this.lastObjectId(), name: '', words: [] };
      this.insertItem(item, null, this.items.length);
      this.record({ k: 'item', item, was: null, index: this.items.length - 1, label: text });
    }
    return this.okResult(parsed, 'comment', text, rep, opts.dryRun ? { dryRun: true } : {});
  }

  protected insertItem(item: ScriptItem, was: ScriptItem | null, index: number): void {
    if (was) this.items[index] = item;
    else this.items.splice(index, 0, item);
  }

  protected applyDirective(parsed: ParsedLine, checked: CheckedLine, notices: Notice[], opts: ApplyOptions): TxResult {
    const rep = emptyReport();
    rep.warnings = notices;
    const d = checked.directive as { name: string; words: readonly string[] };
    if (d.name === 'fig') {
      const v = Number(d.words[0]);
      if (Number.isFinite(v) && v > SCRIPT_VERSION) {
        return this.fail(parsed, 'version', { v: String(v), list: String(SCRIPT_VERSION) }, { hint: `This build reads version ${SCRIPT_VERSION}.` });
      }
      return this.okResult(parsed, 'noop', '@fig', rep);
    }
    const text = printLineNode(parsed.node);
    if (opts.dryRun) return this.okResult(parsed, 'directive', text, rep, { dryRun: true });
    const item: ScriptItem = { text, after: this.lastObjectId(), name: d.name, words: d.words };
    const at = REPEATABLE.has(d.name) ? -1 : this.items.findIndex((x) => x.name === d.name);
    if (at >= 0) {
      const was = this.items[at] as ScriptItem;
      // a replaced directive keeps its place
      const kept: ScriptItem = { ...item, after: was.after };
      this.insertItem(kept, was, at);
      this.record({ k: 'item', item: kept, was, index: at, label: text });
    } else {
      this.insertItem(item, null, this.items.length);
      this.record({ k: 'item', item, was: null, index: this.items.length - 1, label: text });
    }
    this.queue({ ev: 'directive', name: d.name });
    this.onDirective(d.name);
    return this.okResult(parsed, 'directive', text, rep);
  }

  /** Hook for the clock and solver when a directive changes. */
  protected onDirective(_name: string): void {
    // the motion hooks read the directive items when they need them
  }

  /* ------------------------------ styles ------------------------------ */

  /**
   * Turns the checked `with` items of a line into entries: validated against the object type, constants evaluated once,
   * rules kept as evaluators. The result is the object's style map with these entries on top of `base`.
   */
  protected buildStyle(
    parsed: ParsedLine,
    checked: CheckedLine,
    compiled: CompiledLine,
    ty: Ty,
    ownerId: ObjId,
    free: boolean,
    base: ReadonlyMap<string, StyleEntry>,
    notices: Notice[],
    owner: string,
  ): ErrorObject | Map<string, StyleEntry> {
    const out = new Map(base);
    const items: readonly StyleItem[] = (parsed.node as { style?: readonly StyleItem[] }).style ?? [];
    const defaults = defaultsFor(ty.k, free);
    const cs = checked.style ?? [];
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i] as (typeof cs)[number];
      const item = [...items].reverse().find((x) => x.key === c.key) as StyleItem | undefined;
      if (!item) continue;
      if (!isValidKey(ty.k, c.key)) {
        const valid = validKeysFor(ty.k);
        const near = closestNames(c.key, valid, 1)[0];
        return this.fail(parsed, 'unknown_property', { type: ty.k, key: c.key }, {
          messageKey: 'kernel.unknown_property',
          expected: valid,
          ...(near ? { hint: `Did you mean ${near}?`, suggest: [`${owner} with ${near} = ${printExpr(item.value)}`] } : {}),
          recovery: 'rewrite',
          fingerprintKey: c.key,
        }, item.ks, item.ke);
      }
      const comp = compiled.style[i];
      if (!comp) continue;
      const reads = [...new Set((c.reads ?? []).map((id) => (id === SELF_ID ? ownerId : id)))];
      const usesT = 'word' in c.value ? false : usesClockNode(c.value);
      const text = printExpr(item.value);
      const dynamic = reads.length > 0 || usesT;
      let value: unknown;
      if (comp.word !== undefined) value = comp.word;
      else if (!dynamic && comp.eval) {
        this.env.reason = undefined;
        this.ensureSlots(checked.slots);
        value = comp.eval(this.env);
      }
      if (!dynamic) {
        const co = value === undefined ? { ok: true as const, value } : coerceProp(c.key, value);
        if (!co.ok) {
          return this.fail(parsed, 'bad_property_value', { key: c.key, allowed: co.allowed, token: printExpr(item.value) }, {
            messageKey: 'kernel.bad_property_value',
            recovery: 'fix_line',
            fingerprintKey: c.key,
          }, item.value.s, item.value.e);
        }
        value = co.value;
        const dv = (defaults as unknown as Record<string, unknown>)[c.key];
        if (!out.has(c.key) && dv !== undefined && sameValue(dv, value)) {
          notices.push(makeNotice('shadowed_default', { name: owner, key: c.key, value: text }));
          continue;
        }
      }
      out.set(c.key, {
        key: c.key,
        text,
        item,
        checked: c,
        ...(dynamic && comp.eval ? { eval: comp.eval } : {}),
        ...(comp.word !== undefined ? { word: comp.word } : {}),
        reads,
        usesT,
        ...(!dynamic ? { value } : {}),
      });
    }
    return out;
  }

  /* ------------------------------ define ------------------------------ */

  protected cellsFor(comp: CompiledLine, checked: CheckedLine, count: number): Cell[] {
    this.ensureSlots(checked.slots);
    const res = evaluate(comp, this.env);
    const out: Cell[] = [];
    for (let i = 0; i < count; i++) out.push(this.cellFromResult(res, checked.kind === 'defmany' ? i : undefined));
    return out;
  }

  protected applyDefine(parsed0: ParsedLine, checked0: CheckedLine, notices: Notice[], opts: ApplyOptions, assign: boolean, pass: import('./core').Pass): TxResult {
    let parsed = parsed0;
    let checked = checked0;
    const rep = emptyReport();
    rep.warnings = notices;
    const names = checked.names;
    const exist = names.map((n) => this.byNameMap.get(n));
    const nExist = exist.filter((r) => r !== undefined).length;
    if (nExist > 0 && nExist < names.length) {
      return this.fail(parsed, 'bad_argument', { command: 'redefine', why: 'some of these names exist and some do not; define all of them or none' }, { hint: 'Delete the existing ones first, or give new names to all.', recovery: 'rewrite' });
    }
    const redefine = nExist > 0;
    const existing = exist.filter((r): r is ObjRec => r !== undefined);
    for (const r of existing) if (this.isFixed(r) && !opts.force) return this.lockedError(parsed, r, (parsed.node as { target?: { s: number; e: number } }).target?.s, (parsed.node as { target?: { s: number; e: number } }).target?.e);

    // a free Number redefined to a plain value keeps its slider range (kernel design B2)
    let node = parsed.node as DefLine;
    const old0 = existing[0];
    if (old0 && node.k === 'define' && !node.range && (checked.free || assign) && checked.type?.k === 'Number' && old0.p.node.k === 'define' && old0.p.node.range) {
      const withRange: LineNode = { ...node, range: old0.p.node.range };
      const again = parseLine(printLineNode(withRange), { line: parsed.line, isTaken: (n) => this.byNameMap.has(n) });
      if (again.ok) {
        const c2 = checkLine(again.value, this.view, assign ? { skipGraphChecks: true } : {});
        if (c2.ok) {
          parsed = again.value;
          checked = c2.value;
          node = parsed.node as DefLine;
        }
      }
    }

    const ids: ObjId[] = redefine ? existing.map((r) => r.id) : names.map((_, i) => (this.nextId + i) as ObjId);
    const cr = compileLine(checked, this.compileOptions(ids[0] as ObjId));
    if (!cr.ok) return cr;
    const comp = cr.value;

    // inputs: for the order plan and the cycle test
    const inputs: ObjRec[] = [];
    for (const id of [...checked.reads, ...(checked.rangeReads ?? [])]) {
      const x = this.byIdMap.get(id);
      if (x && !existing.includes(x) && !inputs.includes(x)) inputs.push(x);
    }
    for (const e of existing) {
      for (const x of inputs) {
        if (this.reaches(e, x)) {
          return this.fail(parsed, 'cycle', { name: e.p.name, path: [e.p.name, x.p.name, e.p.name].join(' -> ') }, { path: [e.p.name, x.p.name, e.p.name], recovery: 'rewrite', hint: 'Break the loop by making one of them a plain number.' });
        }
      }
    }
    const insertAt = opts.insertAt;
    if (!redefine && insertAt !== undefined) {
      for (const x of inputs) {
        if (x.order >= insertAt) {
          return this.fail(parsed, 'forward_reference', { name: names[0] as string, input: x.p.name }, { hint: `${x.p.name} is defined later; move it first.`, recovery: 'choose', related: [x.p.name] });
        }
      }
    }

    // types: one per name
    const tys: readonly Ty[] = checked.types ?? [checked.type as Ty];

    // compute once
    let cells: Cell[];
    if (checked.isState) {
      const init = comp.state?.initial;
      this.ensureSlots(checked.slots);
      this.env.reason = undefined;
      const v = init ? init(this.env) : undefined;
      cells = [v === undefined || (typeof v === 'number' && v !== v) ? { defined: false, reason: this.env.reason ?? 'not_set' } : { defined: true, value: v }];
    } else cells = this.cellsFor(comp, checked, names.length);
    if (this.faults.length > 0) return internalError(this.faults[0] as string, this.at(parsed), '', this.faults[0] as string);

    // an assignment (`a = a + 1`) stores the computed value as the object's new free value
    let freeLike = checked.free && !checked.isState;
    let defNode: LineNode = stripStyle(node);
    let defChecked = checked;
    let defComp = comp;
    if (assign) {
      const old = existing[0] as ObjRec;
      const c0 = cells[0] as Cell;
      const lit = c0.defined ? valueSource(old.p.type, c0.value) : 'undefined';
      const range = (node as { range?: unknown }).range ? ` ${printRange((node as Extract<LineNode, { k: 'define' }>).range as never)}` : '';
      const flat = lit !== undefined ? parseLine(`${old.p.name} = ${lit}${range}`, { line: parsed.line }) : undefined;
      if (flat?.ok) {
        const fc = checkLine(flat.value, this.view, { skipGraphChecks: true });
        if (fc.ok) {
          const fcomp = compileLine(fc.value, this.compileOptions(old.id));
          if (fcomp.ok) {
            defNode = stripStyle(flat.value.node);
            defChecked = fc.value;
            defComp = fcomp.value;
            freeLike = true;
          }
        }
      }
    }
    const kind: Persist['kind'] = checked.isState ? 'state' : freeLike ? 'free' : 'rule';

    // styles (a defining line may carry `with`)
    const styleSources: (Map<string, StyleEntry> | ErrorObject)[] = [];
    for (let i = 0; i < names.length; i++) {
      const base = redefine ? (existing[i] as ObjRec).p.style : new Map<string, StyleEntry>();
      styleSources.push(this.buildStyle(parsed, checked, comp, tys[i] as Ty, ids[i] as ObjId, kind === 'free', base, notices, names[i] as string));
    }
    for (const s of styleSources) if (s instanceof Map === false) return s as ErrorObject;

    const persists: Persist[] = names.map((name, i) => {
      const cell = cells[i] as Cell;
      const base: Persist = {
        name,
        type: tys[i] as Ty,
        ...(checked.unit ? { unit: checked.unit } : {}),
        kind,
        node: defNode,
        checked: defChecked,
        compiled: defComp,
        ...(node.k === 'defmany' ? { tupleIndex: i } : {}),
        style: styleSources[i] as Map<string, StyleEntry>,
      };
      if (kind === 'free') return { ...base, value: cell.defined ? cell.value : undefined, ...(cell.defined ? {} : { freeReason: cell.reason }) };
      return base;
    });

    // a redefinition to the same text refreshes the value and nothing else
    if (redefine && !assign && existing.length === 1 && persists.length === 1) {
      const o = existing[0] as ObjRec;
      if (printLineNode(o.p.node) === printLineNode(persists[0]?.node as LineNode) && kind === o.p.kind && styleSources[0] instanceof Map && o.p.style.size === (styleSources[0] as Map<string, StyleEntry>).size && !((node as { style?: readonly unknown[] }).style?.length)) {
        notices.push(makeNotice('redefined_to_same', { name: o.p.name }));
        if (!opts.dryRun) {
          this.markDirty(o);
          o.stale = false;
          this.settle([o]);
          this.diffReport(pass, rep);
        }
        return this.okResult(parsed, 'redefine', this.summaryOf(o), rep, { name: o.p.name, id: o.id, type: o.p.type.k as never, ...(opts.dryRun ? { dryRun: true as const } : {}) });
      }
    }

    // plan the order
    const reorder = redefine ? this.planReorder(existing, inputs) : undefined;
    const label = checked.text;
    const dry = opts.dryRun === true;
    if (dry) {
      const aff = new Set<string>();
      for (const e of existing) for (const o of this.downOf(e)) aff.add((this.list[o] as ObjRec).p.name);
      if (redefine) rep.redefined.push(...names);
      else rep.added.push(...names);
      if (reorder) rep.moved.push(...reorder.moved.map((r) => r.p.name));
      const c0 = cells[0] as Cell;
      const sum = c0.defined ? `${names[0]} = ${valueText(c0.value)}` : `${names[0]} is undefined (${c0.reason})`;
      return this.okResult(parsed, redefine ? 'redefine' : 'add', sum, rep, { name: names[0] as string, type: (tys[0] as Ty).k as never, dryRun: true, affected: [...aff] });
    }

    // commit
    let recs: ObjRec[];
    if (!redefine) {
      recs = persists.map((p, i) => new ObjRec(ids[i] as ObjId, p));
      this.nextId += names.length;
      const pos = insertAt ?? this.list.length;
      this.insertRecs(recs.map((rec, i) => ({ rec, pos: pos + i })));
      for (const r of recs) pass.added.add(r);
      rep.added.push(...names);
      const pre = new Map<ObjRec, Cell>();
      recs.forEach((r, i) => pre.set(r, cells[i] as Cell));
      this.record({ k: 'add', items: recs.map((rec) => ({ rec, pos: rec.order })), label });
      this.settle(recs, pre);
    } else {
      recs = existing;
      const changes = recs.map((rec, i) => ({ rec, before: rec.p, after: persists[i] as Persist }));
      if (reorder) {
        this.applyReorder(reorder.lo, reorder.after);
        rep.moved.push(...reorder.moved.map((r) => r.p.name));
        const mv = makeNotice('moved_for_order', {}, rep.moved);
        notices.push(mv);
      }
      for (const c of changes) this.applyPersist(c.rec, c.after);
      rep.redefined.push(...names);
      this.record({ k: 'sets', changes, ...(reorder ? { reorder } : {}), label });
      const pre = new Map<ObjRec, Cell>();
      recs.forEach((r, i) => pre.set(r, cells[i] as Cell));
      this.settle(recs, pre);
    }
    // clamped sliders
    for (const [i, r] of recs.entries()) {
      const want = persists[i]?.value;
      if (r.p.kind === 'free' && typeof want === 'number' && typeof r.p.value === 'number' && want === want && r.p.value !== want) {
        notices.push(makeNotice('clamped', { name: r.p.name, value: valueText(r.p.value), end: r.p.value > want ? 'low end' : 'high end' }));
      }
    }
    this.diffReport(pass, rep);
    const first = recs[0] as ObjRec;
    return this.okResult(parsed, redefine ? 'redefine' : 'add', this.summaryOf(first), rep, {
      name: first.p.name,
      ...(names.length > 1 ? { names } : {}),
      id: first.id,
      type: first.p.type.k as never,
    });
  }

  /* ------------------------------ restyle, rerange, rate ------------------------------ */

  protected applyRestyle(parsed: ParsedLine, checked: CheckedLine, notices: Notice[], opts: ApplyOptions, pass: import('./core').Pass): TxResult {
    const rep = emptyReport();
    rep.warnings = notices;
    const rec = this.byNameMap.get(checked.names[0] as string) as ObjRec;
    const cr = compileLine(checked, this.compileOptions(rec.id));
    if (!cr.ok) return cr;
    const style = this.buildStyle(parsed, checked, cr.value, rec.p.type, rec.id, rec.p.kind === 'free', rec.p.style, notices, rec.p.name);
    if (style instanceof Map === false) return style as ErrorObject;
    if (opts.dryRun) return this.okResult(parsed, 'restyle', printLineNode(parsed.node), rep, { name: rec.p.name, dryRun: true });
    const before = rec.p;
    const after: Persist = { ...before, style: style as Map<string, StyleEntry> };
    this.applyPersist(rec, after);
    this.record({ k: 'sets', changes: [{ rec, before, after }], label: checked.text });
    this.queue({ ev: 'style', ids: [rec.id] });
    this.pendingStyles.add(rec.id);
    this.diffReport(pass, rep);
    return this.okResult(parsed, 'restyle', printLineNode(parsed.node), rep, { name: rec.p.name, id: rec.id, type: rec.p.type.k as never });
  }

  protected applyRerange(parsed: ParsedLine, checked: CheckedLine, notices: Notice[], opts: ApplyOptions, pass: import('./core').Pass): TxResult {
    const rep = emptyReport();
    rep.warnings = notices;
    const rec = this.byNameMap.get(checked.names[0] as string) as ObjRec;
    if (this.isFixed(rec) && !opts.force) return this.lockedError(parsed, rec);
    const cr = compileLine(checked, this.compileOptions(rec.id));
    if (!cr.ok) return cr;
    const n = parsed.node as Extract<LineNode, { k: 'rerange' }>;
    const before = rec.p;
    if (before.node.k !== 'define') return this.fail(parsed, 'not_free', { name: rec.p.name, inputs: '' }, { recovery: 'choose' });
    const oldC = before.compiled;
    const merged: CompiledLine | undefined = oldC && cr.value.range ? { ...oldC, range: cr.value.range, rangeReads: cr.value.rangeReads, rangeUsesT: cr.value.rangeUsesT } : oldC;
    const mchecked: CheckedLine = {
      ...before.checked,
      ...(checked.range ? { range: checked.range } : {}),
      ...(checked.rangeReads ? { rangeReads: checked.rangeReads } : {}),
      ...(checked.rangeUsesT ? { rangeUsesT: true } : {}),
    };
    const after: Persist = { ...before, node: { ...before.node, range: n.range }, checked: mchecked, compiled: merged };
    if (opts.dryRun) return this.okResult(parsed, 'rerange', printLineNode(parsed.node), rep, { name: rec.p.name, dryRun: true });
    this.applyPersist(rec, after);
    this.record({ k: 'sets', changes: [{ rec, before, after }], label: checked.text });
    const was = rec.p.value;
    this.settle([rec]);
    if (typeof was === 'number' && typeof rec.p.value === 'number' && was !== rec.p.value) notices.push(makeNotice('clamped', { name: rec.p.name, value: valueText(rec.p.value), end: rec.p.value > was ? 'low end' : 'high end' }));
    this.diffReport(pass, rep);
    return this.okResult(parsed, 'rerange', printLineNode(parsed.node), rep, { name: rec.p.name, id: rec.id, type: rec.p.type.k as never });
  }

  protected applyRate(parsed: ParsedLine, checked: CheckedLine, notices: Notice[], opts: ApplyOptions, pass: import('./core').Pass): TxResult {
    const rep = emptyReport();
    rep.warnings = notices;
    const info = checked.rate as { target: ObjId; name: string; order: number };
    const rec = this.byIdMap.get(info.target) as ObjRec;
    const cr = compileLine(checked, this.compileOptions(rec.id));
    if (!cr.ok) return cr;
    const rule: RateRule = { order: info.order, node: parsed.node, checked, compiled: cr.value };
    const rates = new Map(rec.p.rates ?? []);
    rates.set(info.order, rule);
    const after: Persist = { ...rec.p, rates };
    if (opts.dryRun) return this.okResult(parsed, 'rate', printLineNode(parsed.node), rep, { name: rec.p.name, dryRun: true });
    const before = rec.p;
    this.applyPersist(rec, after);
    this.record({ k: 'sets', changes: [{ rec, before, after }], label: checked.text });
    this.onStatesChanged();
    this.diffReport(pass, rep);
    return this.okResult(parsed, 'rate', printLineNode(parsed.node), rep, { name: rec.p.name, id: rec.id, type: rec.p.type.k as never });
  }

  /** The solver restarts when a state or a rate changes. */
  protected onStatesChanged(): void {
    this.markClockDirty();
  }

  /* ------------------------------ actions ------------------------------ */

  protected applyAction(parsed: ParsedLine, checked: CheckedLine, notices: Notice[], opts: ApplyOptions, pass: import('./core').Pass): TxResult {
    const rep = emptyReport();
    rep.warnings = notices;
    const call = checked.expr as Extract<TNode, { n: 'command' }>;
    const objects = call.args.map((a) => (a.expr && a.expr.n === 'ref' ? this.byIdMap.get(a.expr.id) : undefined));
    const ctx: ActionContext = { parsed, checked, args: call.args, objects, rep, opts };
    const name = call.spec.name;
    const handler = this.actionHandlers.get(name);
    if (handler) {
      const r = handler(ctx);
      if ('ok' in r && r.ok === false) return r;
      const out = r as { summary: string; data?: unknown; op?: TxOp };
      this.diffReport(pass, rep);
      return this.okResult(parsed, out.op ?? 'action', out.summary, rep, { ...(out.data !== undefined ? { data: out.data } : {}), ...(opts.dryRun ? { dryRun: true as const } : {}) });
    }
    // an action another area registered
    if (opts.dryRun) return this.okResult(parsed, 'action', printLineNode(parsed.node), rep, { dryRun: true });
    try {
      const rule = call.form.rule(call.args) as ActionRule;
      const values = call.args.map(() => undefined as unknown);
      const out = rule.run({ figure: this as never, spec: call.spec, objects: objects.filter((o): o is ObjRec => o !== undefined).map((o) => o.id), values });
      this.diffReport(pass, rep);
      return this.okResult(parsed, 'action', (out && out.summary) ?? printLineNode(parsed.node), rep, out && out.data !== undefined ? { data: out.data } : {});
    } catch {
      return internalError(name, this.at(parsed), '', name);
    }
  }

  /* ------------------------------ replay (undo, redo, rollback) ------------------------------ */

  /** Takes an entry back. */
  protected revertEntry(e: JournalEntry): void {
    switch (e.k) {
      case 'add': {
        const recs = e.items.map((i) => i.rec);
        const inputs = new Set<ObjRec>();
        for (const r of recs) for (const i of r.inputs) if (!recs.includes(i)) inputs.add(i);
        this.removeRecs(recs);
        void inputs;
        return;
      }
      case 'remove': {
        const sorted = [...e.items].sort((a, b) => a.pos - b.pos);
        for (const it of sorted) it.rec.p = it.persist;
        this.insertRecs(sorted.map((i) => ({ rec: i.rec, pos: i.pos })));
        for (const c of e.detached) this.applyPersist(c.rec, c.before);
        for (const a of e.reanchored) a.item.after = a.from;
        this.settle(sorted.map((i) => i.rec));
        return;
      }
      case 'sets': {
        if (e.reorder) this.applyReorder(e.reorder.lo, e.reorder.before);
        for (const c of e.changes) this.applyPersist(c.rec, c.before);
        this.settle(e.changes.map((c) => c.rec));
        if (e.changes.some((c) => c.after.rates !== c.before.rates)) this.onStatesChanged();
        return;
      }
      case 'item': {
        if (e.was) this.items[e.index] = e.was;
        else this.items.splice(e.index, 1);
        this.queue({ ev: 'directive', name: e.item.name });
        return;
      }
      case 'group': {
        for (let i = e.entries.length - 1; i >= 0; i--) this.revertEntry(e.entries[i] as JournalEntry);
        return;
      }
    }
  }

  /** Does an entry again. */
  protected replayEntry(e: JournalEntry): void {
    switch (e.k) {
      case 'add': {
        this.insertRecs(e.items.map((i) => ({ rec: i.rec, pos: i.pos })));
        this.settle(e.items.map((i) => i.rec));
        return;
      }
      case 'remove': {
        this.performRemove(e.items.map((i) => i.rec), e.detached, e.reanchored);
        return;
      }
      case 'sets': {
        if (e.reorder) this.applyReorder(e.reorder.lo, e.reorder.after);
        for (const c of e.changes) this.applyPersist(c.rec, c.after);
        this.settle(e.changes.map((c) => c.rec));
        if (e.changes.some((c) => c.after.rates !== c.before.rates)) this.onStatesChanged();
        return;
      }
      case 'item': {
        this.insertItem(e.item, e.was, e.index);
        this.queue({ ev: 'directive', name: e.item.name });
        return;
      }
      case 'group': {
        for (const x of e.entries) this.replayEntry(x);
        return;
      }
    }
  }

  /** Removes objects whose readers have already been decided: detaches the property rules and re-anchors the script items. */
  protected performRemove(recs: readonly ObjRec[], detached: readonly { rec: ObjRec; after: Persist }[], reanchored: readonly Reanchor[]): void {
    const survivors = new Set<ObjRec>();
    for (const r of recs) for (const k of r.styleKids) if (!recs.includes(k)) survivors.add(k);
    for (const d of detached) this.applyPersist(d.rec, d.after);
    for (const a of reanchored) a.item.after = a.to;
    this.removeRecs(recs);
    // objects that read the removed ones lose those inputs; objects downstream of removed ones were removed too
    this.flush(true);
  }
}
