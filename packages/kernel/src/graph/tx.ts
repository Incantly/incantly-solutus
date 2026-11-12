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
import { BUILTIN_FUNCTIONS } from '../language/builtins';
import { compileLine, compileNode, evaluate } from '../language/compile';
import type { CompiledLine } from '../language/compile';
import { closestNames } from '../language/errors';
import { nameProblem, reservedGroup } from '../language/names';
import { defineLine } from '../errors/suggest';
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
import { runLineChecks, runLineHandlers, runLineRewriters } from './registry';
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

export type LogItem = { readonly k: 'rec'; readonly e: JournalEntry } | { readonly k: 'hist'; readonly dir: 'undo' | 'redo'; readonly e: JournalEntry };

type DefLine = Extract<LineNode, { k: 'define' | 'function' | 'defmany' }>;

export class FigureTx extends FigureBase {
  protected readonly actionHandlers = new Map<string, ActionHandler>();
  /**
   * What the current line did to the journal and the history, in order, so a failure can take all of it back
   * (KERN-SM-10): the entries it recorded and the undo or redo steps it took.
   */
  protected log: LogItem[] = [];
  /** How many `apply` calls are running; the log is kept only inside one. */
  protected applyDepth = 0;

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
    if (this.replaying) return;
    this.journal.record(e);
    if (this.applyDepth > 0) this.log.push({ k: 'rec', e });
  }

  /** Notes that the line took an undo or redo step, so a failure can put it back. */
  protected logHistory(dir: 'undo' | 'redo', e: JournalEntry): void {
    if (this.applyDepth > 0) this.log.push({ k: 'hist', dir, e });
  }

  /**
   * Takes back everything the current line did, newest first: the entries it recorded leave the journal and are reverted, an
   * undo or redo step it took is reversed and its entry goes back where it came from. Used when the line fails after a change.
   */
  protected rollbackTx(): void {
    const items = this.log;
    this.log = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i] as LogItem;
      if (it.k === 'rec') {
        this.journal.discard(it.e);
        this.inPass(() => this.revertEntry(it.e));
      } else {
        this.inPass(() => (it.dir === 'undo' ? this.replayEntry(it.e) : this.revertEntry(it.e)));
        this.journal.putBack(it.e);
      }
    }
  }

  /* ------------------------------ apply ------------------------------ */

  /**
   * One transaction. Takes the text of a line (or a parsed line) and returns a `TxResult`: the report of what changed, or
   * the error with the figure untouched. With `dryRun` it checks and plans, evaluates the new object, and commits nothing.
   * Never throws.
   */
  apply(input: string | ParsedLine, opts: ApplyOptions = {}): TxResult {
    if (typeof input !== 'string' && (typeof input !== 'object' || input === null || typeof (input as ParsedLine).sm !== 'object' || (input as ParsedLine).node === undefined)) {
      return err('tool_input', { line: 0, col: 1, endCol: 1 }, { tool: 'apply', expected: 'a line of text' }, { recovery: 'fix_line', fingerprintKey: 'apply' });
    }
    if (typeof opts !== 'object' || opts === null) opts = {};
    if (this.busy) return this.busyError('apply');
    // a gesture still open is one step that happened before this line: it goes into the journal first (KERN-SM-11)
    if (!opts.dryRun) this.commitDrag();
    if (this.opDepth === 0) this.listenerFailures = 0;
    this.faults = [];
    const outerLog = this.log;
    this.log = [];
    this.applyDepth++;
    const evMark = this.pendingEvents.length;
    // a dry run commits and then takes everything back; what the commit could touch outside the journal is saved first
    const dry = opts.dryRun === true;
    const save = dry ? { values: new Set(this.pendingValues), styles: new Set(this.pendingStyles), nextId: this.nextId, stepCursor: this.stepCursor, redo: this.journal.saveRedo() } : undefined;
    const lineNo = opts.line ?? (typeof input === 'string' ? 1 : input.line);
    let result: TxResult;
    try {
      result = this.inPass((pass) => {
        const r = this.applyInner(input, opts, pass);
        if (r.ok === false) {
          // a rejected line changes nothing, also when an action changed things before it failed
          if (this.log.length > 0) this.rollbackTx();
          return r;
        }
        if (this.faults.length > 0) {
          const bad = this.faults[0] as string;
          this.rollbackTx();
          return internalError(bad, { line: lineNo, col: 1, endCol: 1 }, '', bad);
        }
        return r;
      });
    } catch {
      this.rollbackTx();
      result = internalError('the figure', { line: lineNo, col: 1, endCol: 1 }, '', 'apply');
    }
    if (save) {
      if (this.log.length > 0) this.rollbackTx();
      this.nextId = save.nextId;
      this.stepCursor = save.stepCursor;
      this.pendingValues = save.values;
      this.pendingStyles = save.styles;
      this.journal.restoreRedo(save.redo);
      this.pendingEvents.length = Math.min(this.pendingEvents.length, evMark);
    }
    this.applyDepth--;
    if (result.ok) outerLog.push(...this.log);
    else if (this.pendingEvents.length > evMark) this.pendingEvents.length = evMark;
    this.log = outerLog;
    if (!result.ok && !this.vetting && !opts.dryRun) result = this.repaired(result);
    this.deliver();
    if (result.ok) {
      const failed = this.takeListenerFailures();
      if (failed > 0) (result.notices as Notice[]).push(makeNotice('listener_failed', { where: 'a listener' }));
    }
    return result;
  }

  /** True while suggested lines are being tried, so a failed try is not repaired in turn. */
  protected vetting = false;

  /**
   * The repairs every error gets before it leaves the kernel (errors design 7): an unknown name offers the line that
   * defines it, and every suggested line is tried with a dry run, so a suggestion that would fail is not offered.
   */
  protected repaired(e: ErrorObject): ErrorObject {
    try {
      let suggest = [...e.suggest];
      let hint = e.hint;
      let define: string | undefined;
      if (e.kind === 'unknown_name' && e.blockedBy === undefined && e.token !== '') {
        const name = e.token;
        // the line that defines the name as the type its argument needs (a Point for Midpoint); a Number when the language did not say
        const want = typeof e.params['type'] === 'string' ? e.params['type'] : 'Number';
        if (!nameProblem(name) && !reservedGroup(name, this.commands, this.functions ?? BUILTIN_FUNCTIONS)) define = defineLine(name, want);
      }
      if (suggest.length === 0 && define === undefined) return e;
      const kept: string[] = [];
      this.vetting = true;
      try {
        // a rewrite with a name that exists comes first; the define line is the fallback
        for (const s of define !== undefined ? [...suggest, define] : suggest) {
          if (kept.includes(s)) continue;
          const r = this.apply(s, { dryRun: true });
          if (r.ok) kept.push(s);
        }
      } finally {
        this.vetting = false;
      }
      suggest = kept.slice(0, 3);
      let recovery = e.recovery;
      if (e.kind === 'unknown_name' && define !== undefined) {
        const near = suggest.some((s) => s !== define);
        // a hint that names the variable of the command's own expression is more exact than a list of names
        if (!near && !/^The variable here is /.test(hint ?? '')) hint = `Define it first, or use a name that exists: ${this.names().slice(0, 8).join(', ')}.`;
        else recovery = 'use_suggestion';
      }
      const { fix, ...rest } = e as ErrorObject & { fix?: string };
      const out: Record<string, unknown> = { ...rest, suggest, recovery, ...(hint !== undefined ? { hint } : {}) };
      if (fix !== undefined && suggest.includes(fix)) out['fix'] = fix;
      return out as unknown as ErrorObject;
    } catch {
      this.vetting = false;
      return e;
    }
  }

  protected applyInner(input: string | ParsedLine, opts: ApplyOptions, pass: import('./core').Pass): TxResult {
    const lineNo = opts.line ?? (typeof input === 'string' ? 1 : input.line);
    const notices: Notice[] = [];
    let parsed: ParsedLine;
    if (typeof input === 'string') {
      // a line kind an area owns outright (an `on` line) is carried out by the area, as one undo entry
      const handled = runLineHandlers(this, input, { dryRun: opts.dryRun === true, line: lineNo });
      if (handled) {
        if ('ok' in handled) return { ...handled, line: lineNo, source: input } as TxResult;
        if (!opts.dryRun) this.record({ k: 'ext', label: input, undo: handled.undo, redo: handled.redo });
        const rep = emptyReport();
        rep.warnings.push(...(handled.notices ?? []));
        return this.okResult(undefined, 'action', handled.summary, rep, { line: lineNo, ...(opts.dryRun ? { dryRun: true as const } : {}) });
      }
      // an area's own reading of the line comes first: it may stand for another line, or be refused
      const rw = runLineRewriters(this, input);
      if (rw?.error) return { ...rw.error, line: lineNo, source: input } as TxResult;
      if (rw?.notices) notices.push(...rw.notices);
      if (rw?.text !== undefined) input = rw.text;
      if (rw?.dropRange) opts = { ...opts, dropRange: true };
      const pr = parseLine(input, {
        line: lineNo,
        isTaken: (n) => this.byNameMap.has(n),
        isObjectCommand: (n) => this.commands.lookup(n)?.kind === 'object',
        limits: this.langLimits,
      });
      if (!pr.ok) return pr;
      parsed = pr.value;
      notices.push(...pr.notices);
    } else parsed = input;
    parsed = this.rewriteRename(parsed);

    const copts = { limits: this.langLimits, propertyKeys: validKeysFor, ...(opts.failed ? { failed: opts.failed } : {}) };
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
    // an area's own refusal of the line, before anything changes
    const refused = runLineChecks(this, checked, parsed);
    if (refused) {
      const at = this.at(parsed);
      const placed = refused.line > 0 && refused.col > 1 ? {} : { line: at.line, col: at.col, endCol: at.endCol };
      return { ...refused, ...placed, source: parsed.sm.raw ?? parsed.sm.text } as TxResult;
    }
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
    if (second.k !== 'name') return parsed;
    // an object that holds a Text is an expression (the checked form); any other name is the new name
    if (this.byNameMap.get(second.name)?.p.type.k === 'Text') return parsed;
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
    // a bound that reads its own slider is a real cycle: only the value may read the old value
    if (n.range) {
      const text = parsed.sm.text.slice(n.range.s, n.range.e);
      const name = n.target.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^\\p{L}\\p{N}_])${name}($|[^\\p{L}\\p{N}_])`, 'u').test(text)) return false;
    }
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
    const over = this.itemBudget(parsed);
    if (over) return over;
    if (!opts.dryRun) {
      const item: ScriptItem = { text, after: this.lastObjectId(), name: '', words: [] };
      this.insertItem(item, null, this.items.length);
      this.record({ k: 'item', item, was: null, index: this.items.length - 1, label: text });
    }
    return this.okResult(parsed, 'comment', text, rep, opts.dryRun ? { dryRun: true } : {});
  }

  /** The `limit` error when one more comment or directive would pass the `items` budget (KERN-SM-1). */
  protected itemBudget(parsed: ParsedLine): ErrorObject | undefined {
    const max = this.limits.items;
    if (this.items.length < max) return undefined;
    return this.fail(parsed, 'limit', { limit: 'items', max, got: this.items.length + 1, what: 'comments and directives in a figure' }, { recovery: 'rewrite', hint: 'Remove comments or directives you do not need.', fingerprintKey: 'items' });
  }

  protected insertItem(item: ScriptItem, was: ScriptItem | null, index: number): void {
    if (was) {
      this.items[index] = item;
      return;
    }
    this.items.splice(index, 0, item);
    if (index !== this.items.length - 1) this.reindexItems();
    else if (item.name !== '' && !REPEATABLE.has(item.name) && !this.directiveAt.has(item.name)) this.directiveAt.set(item.name, index);
  }

  /** Takes the item at `index` out of the script (undo of an insertion). */
  protected removeItem(index: number): void {
    const last = index === this.items.length - 1;
    const gone = this.items.splice(index, 1)[0];
    if (!last) this.reindexItems();
    else if (gone && this.directiveAt.get(gone.name) === index) this.directiveAt.delete(gone.name);
  }

  /** `@tol N` (or `@tolerance N`) when the figure has one, else the option or `1e-9`. */
  protected override tolerance(): number {
    const w = (this.directiveItem('tol') ?? this.directiveItem('tolerance'))?.words[0];
    const n = w === undefined ? NaN : Number(w);
    return Number.isFinite(n) && n > 0 ? n : this.tolOption;
  }

  /** The first item of a non-repeatable directive, by name (a map lookup, not a scan). */
  protected directiveItem(name: string): ScriptItem | undefined {
    const i = this.directiveAt.get(name);
    return i === undefined ? undefined : this.items[i];
  }

  private reindexItems(): void {
    this.directiveAt.clear();
    this.items.forEach((it, i) => {
      if (it.name !== '' && !REPEATABLE.has(it.name) && !this.directiveAt.has(it.name)) this.directiveAt.set(it.name, i);
    });
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
    const at = REPEATABLE.has(d.name) ? -1 : (this.directiveAt.get(d.name) ?? -1);
    if (at < 0) {
      const over = this.itemBudget(parsed);
      if (over) return over;
    }
    if (opts.dryRun) return this.okResult(parsed, 'directive', text, rep, { dryRun: true });
    const item: ScriptItem = { text, after: this.lastObjectId(), name: d.name, words: d.words };
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
  protected onDirective(name: string): void {
    // the motion hooks read the directive items when they need them
    this.tolDirectiveChanged(name);
  }

  /** The rules read the tolerance when they run, so a new `@tol` runs them all again (also on undo and redo). */
  protected tolDirectiveChanged(name: string): void {
    if (name !== 'tol' && name !== 'tolerance') return;
    this.settle(this.list.filter((r) => r.p.kind === 'rule'));
  }

  /**
   * One `clamped` notice per slider (KERN-SM-20). The checker says "outside the range" for a literal it can see; the kernel
   * says what the value became, for any way the value got there, so its notice replaces the checker's.
   */
  protected noteClamped(notices: Notice[], name: string, now: number, want: number): void {
    for (let i = notices.length - 1; i >= 0; i--) {
      const n = notices[i] as Notice;
      if (n.kind === 'clamped' && (n.params as Record<string, unknown>)['name'] === undefined) notices.splice(i, 1);
    }
    notices.push(makeNotice('clamped', { name, value: valueText(now), end: now > want ? 'low end' : 'high end', from: want, to: now }));
  }

  /** The object a `@step` title marks: the one right after its anchor. */
  protected markedObject(item: ScriptItem): ObjRec | undefined {
    return item.after === null ? this.list[0] : this.list[(this.byIdMap.get(item.after)?.order ?? -1) + 1];
  }

  /**
   * Reorders a stretch of the list and anchors each `@step` title again so it stays in front of the object it marked. Returns
   * the re-anchors, which the journal entry keeps for undo and redo.
   */
  protected reorderKeepingSteps(lo: number, after: readonly ObjRec[]): Reanchor[] {
    const steps = this.items.filter((i) => i.name === 'step');
    const marked = steps.map((it) => this.markedObject(it));
    this.applyReorder(lo, after);
    const out: Reanchor[] = [];
    steps.forEach((it, i) => {
      const m = marked[i];
      if (!m) return;
      const prev = m.order > 0 ? (this.list[m.order - 1] as ObjRec).id : null;
      if (prev !== it.after) {
        out.push({ item: it, from: it.after, to: prev });
        it.after = prev;
      }
    });
    return out;
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
    for (const r of existing) if (this.isFixed(r) && !opts.force) return this.lockedError(parsed, r);

    // a free Number redefined to a plain value keeps its slider range (kernel design B2)
    let node = parsed.node as DefLine;
    const old0 = existing[0];
    if (old0 && !opts.dropRange && node.k === 'define' && !node.range && (checked.free || assign) && checked.type?.k === 'Number' && old0.p.node.k === 'define' && old0.p.node.range) {
      const withRange: LineNode = { ...node, range: old0.p.node.range };
      const again = parseLine(printLineNode(withRange), { line: parsed.line, isTaken: (n) => this.byNameMap.has(n), limits: this.langLimits });
      if (again.ok) {
        const c2 = checkLine(again.value, this.view, assign ? { skipGraphChecks: true, limits: this.langLimits, propertyKeys: validKeysFor } : { limits: this.langLimits, propertyKeys: validKeysFor });
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
          return this.fail(parsed, 'forward_reference', { name: names[0] as string, input: x.p.name }, { hint: `${x.p.name} is defined later; move it first, or add this line after it.`, suggest: [printLineNode(parsed.node)], recovery: 'choose', related: [x.p.name] });
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
        const fc = checkLine(flat.value, this.view, { skipGraphChecks: true, limits: this.langLimits });
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
      if (printLineNode(o.p.node) === printLineNode(persists[0]?.node as LineNode) && !opts.dropRange && kind === o.p.kind && styleSources[0] instanceof Map && o.p.style.size === (styleSources[0] as Map<string, StyleEntry>).size && !((node as { style?: readonly unknown[] }).style?.length)) {
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
    // a dry run does everything a commit does and `apply` takes it all back afterwards, so its summary, report and notices are exactly the commit's
    const dry = opts.dryRun === true;
    const aff = new Set<string>();
    if (dry) for (const e of existing) for (const o of this.downOf(e)) aff.add((this.list[o] as ObjRec).p.name);

    // commit
    let recs: ObjRec[];
    if (!redefine) {
      recs = persists.map((p, i) => new ObjRec(ids[i] as ObjId, p));
      this.nextId += names.length;
      // the reveal cursor: at the end it follows the new object, elsewhere the object is added after the step being viewed
      if (this.stepCursor !== undefined) {
        if (this.stepCursor >= this.list.length) this.stepCursor = undefined;
        else notices.push(makeNotice('step_hidden', { name: names[0] as string }));
      }
      const pos = insertAt ?? this.list.length;
      // an object put in front of a `@step` title takes the place before it: the title stays in front of the object it marked
      const reanchored: Reanchor[] = [];
      if (pos < this.list.length) {
        const prev = pos > 0 ? (this.list[pos - 1] as ObjRec).id : null;
        const last = ids[names.length - 1] as ObjId;
        for (const item of this.items) if (item.name === 'step' && item.after === prev) reanchored.push({ item, from: prev, to: last });
        for (const a of reanchored) a.item.after = a.to;
      }
      this.insertRecs(recs.map((rec, i) => ({ rec, pos: pos + i })));
      for (const r of recs) pass.added.add(r);
      rep.added.push(...names);
      for (const n of names) {
        for (const o of this.confusablesOf(n, recs)) notices.push(makeNotice('confusable_name', { name: n, other: o.p.name }));
      }
      const pre = new Map<ObjRec, Cell>();
      recs.forEach((r, i) => pre.set(r, cells[i] as Cell));
      this.record({ k: 'add', items: recs.map((rec) => ({ rec, pos: rec.order })), label, ...(reanchored.length > 0 ? { reanchored } : {}) });
      this.settle(recs, pre);
    } else {
      recs = existing;
      const changes = recs.map((rec, i) => ({ rec, before: rec.p, after: persists[i] as Persist }));
      if (reorder) {
        reorder.reanchored = this.reorderKeepingSteps(reorder.lo, reorder.after);
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
        this.noteClamped(notices, r.p.name, r.p.value, want);
      }
    }
    this.diffReport(pass, rep);
    const first = recs[0] as ObjRec;
    return this.okResult(parsed, redefine ? 'redefine' : 'add', this.summaryOf(first), rep, {
      name: first.p.name,
      ...(names.length > 1 ? { names } : {}),
      id: first.id,
      type: first.p.type.k as never,
      ...(dry ? { dryRun: true as const, affected: [...aff] } : {}),
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
    const before = rec.p;
    const after: Persist = { ...before, style: style as Map<string, StyleEntry> };
    this.applyPersist(rec, after);
    this.record({ k: 'sets', changes: [{ rec, before, after }], label: checked.text });
    this.pendingStyles.add(rec.id);
    this.diffReport(pass, rep);
    return this.okResult(parsed, 'restyle', printLineNode(parsed.node), rep, { name: rec.p.name, id: rec.id, type: rec.p.type.k as never, ...(opts.dryRun ? { dryRun: true as const } : {}) });
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
    this.applyPersist(rec, after);
    this.record({ k: 'sets', changes: [{ rec, before, after }], label: checked.text });
    const was = rec.p.value;
    this.settle([rec]);
    if (typeof was === 'number' && typeof rec.p.value === 'number' && was !== rec.p.value) this.noteClamped(notices, rec.p.name, rec.p.value, was);
    this.diffReport(pass, rep);
    return this.okResult(parsed, 'rerange', printLineNode(parsed.node), rep, { name: rec.p.name, id: rec.id, type: rec.p.type.k as never, ...(opts.dryRun ? { dryRun: true as const } : {}) });
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
    const before = rec.p;
    this.applyPersist(rec, after);
    this.record({ k: 'sets', changes: [{ rec, before, after }], label: checked.text });
    this.onStatesChanged();
    this.settle([rec]);
    this.diffReport(pass, rep);
    return this.okResult(parsed, 'rate', printLineNode(parsed.node), rep, { name: rec.p.name, id: rec.id, type: rec.p.type.k as never, ...(opts.dryRun ? { dryRun: true as const } : {}) });
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
      // the value of each argument that is not a plain object name, evaluated now (objects are in `objects`)
      const values = call.args.map((a) => {
        if (!a.expr || a.expr.n === 'ref' || (a.param.kind ?? 'value') !== 'value') return a.value as unknown;
        try {
          this.ensureSlots(checked.slots);
          const r = evaluate(compileNode(a.expr, this.compileOptions(SELF_ID)), this.env);
          return r.defined ? r.value : undefined;
        } catch {
          return undefined;
        }
      });
      const out = rule.run({ figure: this as never, spec: call.spec, objects: objects.filter((o): o is ObjRec => o !== undefined).map((o) => o.id), values });
      if (out && out.error) {
        // the action's own refusal, placed on the line that called it
        const at = this.at(parsed);
        return { ...out.error, line: at.line, col: at.col, endCol: at.endCol, source: parsed.sm.raw ?? parsed.sm.text } as TxResult;
      }
      this.diffReport(pass, rep);
      if (out && out.notices) for (const n of out.notices) if (!rep.warnings.some((w) => w.kind === n.kind)) rep.warnings.push(n);
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
        this.removeRecs(recs);
        for (const a of e.reanchored ?? []) a.item.after = a.from;
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
        if (e.reorder) {
          this.applyReorder(e.reorder.lo, e.reorder.before);
          for (const a of e.reorder.reanchored ?? []) a.item.after = a.from;
        }
        for (const c of e.changes) this.applyPersist(c.rec, c.before);
        this.settle(e.changes.map((c) => c.rec));
        if (e.changes.some((c) => c.after.rates !== c.before.rates)) this.onStatesChanged();
        return;
      }
      case 'item': {
        if (e.was) this.items[e.index] = e.was;
        else this.removeItem(e.index);
        this.queue({ ev: 'directive', name: e.item.name });
        this.tolDirectiveChanged(e.item.name);
        return;
      }
      case 'group': {
        for (let i = e.entries.length - 1; i >= 0; i--) this.revertEntry(e.entries[i] as JournalEntry);
        return;
      }
      case 'ext':
        e.undo();
        return;
    }
  }

  /** Does an entry again. */
  protected replayEntry(e: JournalEntry): void {
    switch (e.k) {
      case 'add': {
        for (const a of e.reanchored ?? []) a.item.after = a.to;
        this.insertRecs(e.items.map((i) => ({ rec: i.rec, pos: i.pos })));
        this.settle(e.items.map((i) => i.rec));
        return;
      }
      case 'remove': {
        this.performRemove(e.items.map((i) => i.rec), e.detached, e.reanchored);
        return;
      }
      case 'sets': {
        if (e.reorder) {
          this.applyReorder(e.reorder.lo, e.reorder.after);
          for (const a of e.reorder.reanchored ?? []) a.item.after = a.to;
        }
        for (const c of e.changes) this.applyPersist(c.rec, c.after);
        this.settle(e.changes.map((c) => c.rec));
        if (e.changes.some((c) => c.after.rates !== c.before.rates)) this.onStatesChanged();
        return;
      }
      case 'item': {
        this.insertItem(e.item, e.was, e.index);
        this.queue({ ev: 'directive', name: e.item.name });
        this.tolDirectiveChanged(e.item.name);
        return;
      }
      case 'group': {
        for (const x of e.entries) this.replayEntry(x);
        return;
      }
      case 'ext':
        e.redo();
        return;
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
