/**
 * Services built on the line pipeline: delete with cascade, rename, visibility, undo and redo, batches, free-value
 * writes with gestures, drag plans, ordering moves and queries (docs/features/kernel/design.md sections 7, 11, 12, 14).
 */
import type { ErrorObject, Notice } from '../contracts/errors';
import type { Name, ObjId, TypeName } from '../contracts/values';
import { err } from '../errors/table';
import { joinNames, makeNotice } from '../errors/notices';
import type { Change, JournalEntry, Reanchor, Reorder, UndoInfo } from '../history/journal';
import type { ParsedLine } from '../language/ast';
import { compileLine } from '../language/compile';
import { checkLine } from '../language/lines';
import { nameProblem, reservedGroup, reservedGroupText, suggestName as languageSuggestName } from '../language/names';
import { parseLine } from '../language/parser';
import { printExpr, printLineNode, printStyle } from '../language/printer';
import { valueText } from '../language/runtime';
import { targetNamesOf } from '../language/figure';
import type { TNode } from '../language/tnode';
import { FigureTx, emptyReport } from './tx';
import type { ActionContext, ActionResult } from './tx';
import { ObjRec } from './core';
import { lineRefStarts, refStarts, renameNode, renameStyleItem } from './rename';
import type { ApplyOptions, BatchOptions, BatchResult, ChangeReport, Description, Persist, RateRule, StyleEntry, TxOk, TxResult } from './types';
import { fitsType, sameValue, valueSource } from './values';
import type { InvertCall } from './registry';
import { deleteNotes, runDragListeners } from './registry';
import { toEffective, validKeysFor } from './props';

/**
 * Why a free value is written. `drag` and `slider` join a gesture (one undo entry on `commitDrag`); `show_me` and `api` are
 * journalled at once; `solver` (states only) and `animation` (the clock or a player writing a free value each frame) are
 * never journalled and never join a gesture.
 */
export type WriteWhy = 'drag' | 'slider' | 'show_me' | 'api' | 'solver' | 'anim';

const WRITE_WHYS: readonly string[] = ['drag', 'slider', 'show_me', 'api', 'solver', 'anim'];

export interface SetFreeOptions {
  /** Change a fixed object (the teacher's tool passes this only when it says so). */
  force?: boolean;
  /** Why the value is undefined, when the write leaves it undefined (a slider given inf is `not_finite`). */
  reason?: import('../contracts/values').UndefReason;
}

/** What a free-value write reports. */
export type WriteResult = { readonly ok: true; readonly changed: boolean } | ErrorObject;

export interface DragWrite {
  readonly id: ObjId;
  readonly name: Name;
  readonly value: unknown;
  /**
   * Set when the write is to a number written in the object's own line, such as the `0.25` of `P = PointOn(c, 0.25)`:
   * the index of that argument. The drag rewrites the number; undo puts the old line back.
   */
  readonly param?: number;
}

/** The answer of `dragPlan`: the free writes that would move the object, or why none exist. */
export interface DragPlan {
  readonly writes: readonly DragWrite[];
  /** Set when `writes` is empty. */
  readonly reason?: 'unknown_object' | 'locked' | 'owned_by_solver' | 'not_draggable' | 'undefined' | 'bad_target';
  /** `free` (the object itself), `path` (a point on a path) or `inverted` (through its parents). */
  readonly kind?: 'free' | 'path' | 'inverted';
}

export interface MovePlan {
  readonly ok: boolean;
  /** Objects that must move together with the one asked for, in their new order. */
  readonly alsoMove: readonly Name[];
}

export type UndoUnit = 'group' | 'line';

/** What `beginUnit` notes for `rollbackUnit`. */
export interface Unit {
  readonly mark: number;
  readonly snap: { stack: JournalEntry[]; redo: JournalEntry[] };
  readonly evMark: number;
  readonly valMark: Set<ObjId>;
  readonly styMark: Set<ObjId>;
}

export class FigureHist extends FigureTx {
  constructor(opts: import('./core').FigureOptions = {}) {
    super(opts);
    const h = this.actionHandlers;
    h.set('Show', (c) => this.setVisible(c, true));
    h.set('Hide', (c) => this.setVisible(c, false));
    h.set('Delete', (c) => this.actionDelete(c));
    h.set('Rename', (c) => this.actionRename(c));
    h.set('Undo', (c) => this.actionHistory(c, 'undo'));
    h.set('Redo', (c) => this.actionHistory(c, 'redo'));
    h.set('Describe', (c) => this.actionDescribe(c));
    h.set('DependsOn', (c) => this.actionList(c, 'DependsOn'));
    h.set('Uses', (c) => this.actionList(c, 'Uses'));
  }

  /* ------------------------------ lookups ------------------------------ */

  /** The object a name or id refers to, or an `unknown_name` error. */
  protected need(x: Name | ObjId): ObjRec | ErrorObject {
    const r = this.recOf(x);
    if (r) return r;
    const name = String(x);
    const near = closestOf(name, this.list.map((o) => o.p.name));
    return err('unknown_name', { line: 0, col: 1, endCol: 1 }, { name }, { token: name, hint: near.length ? `Did you mean ${near[0]}?` : 'No object has that name.', suggest: [], recovery: 'use_suggestion', fingerprintKey: name });
  }

  protected argObjects(c: ActionContext, action: string): ObjRec[] | ErrorObject {
    const recs: ObjRec[] = [];
    for (let i = 0; i < c.args.length; i++) {
      const o = c.objects[i];
      if (!o) {
        const a = c.args[i] as { expr?: { s: number; e: number } };
        return this.fail(c.parsed, 'bad_argument', { command: action, why: 'give the name of an object' }, { recovery: 'fix_line' }, a.expr?.s, a.expr?.e);
      }
      recs.push(o);
    }
    return recs;
  }

  /* ------------------------------ queries ------------------------------ */

  /** Every object that depends on `x`, directly or not, in order. */
  dependentsOf(x: Name | ObjId): readonly ObjId[] {
    const r = this.recOf(x);
    if (!r) return [];
    return [...this.downOf(r)].map((o) => (this.list[o] as ObjRec).id);
  }

  /** Every object `x` depends on, in order. */
  ancestorsOf(x: Name | ObjId): readonly ObjId[] {
    const r = this.recOf(x);
    if (!r) return [];
    return this.ancestorRecs(r.inputs).filter((a) => a !== r).map((a) => a.id);
  }

  /** What a `Delete` would take with it: the object and everything built from it, in deletion order. */
  deletePlan(x: Name | ObjId): readonly Name[] {
    const r = this.recOf(x);
    return r ? this.cascade(r).map((o) => o.p.name) : [];
  }

  protected cascade(r: ObjRec): ObjRec[] {
    return [r, ...[...this.downOf(r)].map((o) => this.list[o] as ObjRec)];
  }

  /** A description of one object for the teacher. */
  describe(x: Name | ObjId): Description | ErrorObject {
    const r = this.need(x);
    if (r instanceof ObjRec === false) return r as ErrorObject;
    const rec = r as ObjRec;
    const c = this.cellOfRec(rec);
    const st = this.styleOf(rec.id);
    const root = !c.defined ? this.rootOf(rec) : undefined;
    const cause = !c.defined && c.cause !== undefined ? this.nameOf(c.cause) : undefined;
    return {
      name: rec.p.name,
      id: rec.id,
      type: rec.p.type.k,
      definition: this.definitionText(rec),
      value: c.defined ? valueText(c.value) : 'undefined',
      defined: c.defined,
      ...(!c.defined ? { undefined: { reason: c.reason, ...(cause !== undefined ? { cause } : {}), ...(root && root.rec !== rec ? { root: root.reason } : {}) } } : {}),
      free: rec.p.kind === 'free',
      visible: st?.visible ?? true,
      shown: st?.shown ?? true,
      ...(st?.why !== undefined ? { why: st.why } : {}),
      fixed: st?.fixed ?? false,
      aux: st?.aux ?? false,
      layer: st?.layer ?? 0,
      inputs: rec.inputs.map((i) => i.p.name),
      dependents: rec.kids.map((k) => k.p.name),
    };
  }

  /** The defining line of an object, as written, with its `with` list. */
  definitionText(rec: ObjRec): string {
    const base = printLineNode(rec.p.node);
    return base;
  }

  /* ------------------------------ delete ------------------------------ */

  /** Removes an object and everything built from it. */
  delete(x: Name | ObjId, opts: ApplyOptions = {}): TxResult {
    if (this.busy) return this.busyError('delete');
    const r = this.need(x);
    if (r instanceof ObjRec === false) return r as ErrorObject;
    this.faults = [];
    if (!opts.dryRun) this.commitDrag();
    const res = this.inPass((pass) => this.doDelete(r as ObjRec, undefined, opts, pass));
    this.deliver();
    return res.ok || this.vetting ? res : this.repaired(res);
  }

  protected doDelete(rec: ObjRec, parsed: ParsedLine | undefined, opts: ApplyOptions, pass: import('./core').Pass): TxResult {
    const rep = emptyReport();
    const set = this.cascade(rec);
    if (!opts.force) {
      for (const o of set) if (this.isFixed(o)) return this.lockedError(parsed, o);
    }
    const names = set.map((o) => o.p.name);
    rep.warnings.push(...deleteNotes(this, names));
    if (opts.dryRun) {
      rep.removed.push(...names);
      return this.okResult(parsed, 'delete', `deleted ${names.join(', ')}`, rep, { dryRun: true, affected: names.slice(1) });
    }
    const gone = new Set(set);
    // property rules and rates of survivors that read a removed object are detached
    const detached: Change[] = [];
    const survivors = new Set<ObjRec>();
    for (const o of set) for (const k of o.styleKids) if (!gone.has(k)) survivors.add(k);
    for (const s of this.list) if (!gone.has(s) && s.p.rates && [...s.p.rates.values()].some((rr) => rr.checked.reads.some((id) => gone.has(this.byIdMap.get(id) as ObjRec)))) survivors.add(s);
    for (const s of survivors) {
      const style = new Map(s.p.style);
      for (const [k, e] of s.p.style) {
        const hit = e.reads.map((id) => this.byIdMap.get(id)).find((x) => x && gone.has(x));
        if (hit) {
          style.delete(k);
          rep.warnings.push(makeNotice('property_detached', { name: s.p.name, prop: k, input: hit.p.name }));
        }
      }
      let rates = s.p.rates;
      if (rates) {
        const keep = new Map<number, RateRule>();
        for (const [o, rr] of rates) {
          if (rr.checked.reads.some((id) => gone.has(this.byIdMap.get(id) as ObjRec))) rep.warnings.push(makeNotice('property_detached', { name: s.p.name, prop: `rate ${o}`, input: 'a removed object' }));
          else keep.set(o, rr);
        }
        rates = keep;
      }
      detached.push({ rec: s, before: s.p, after: { ...s.p, style, ...(rates ? { rates } : {}) } });
    }
    // script items anchored after a removed object move to the nearest object that stays
    const reanchored: Reanchor[] = [];
    for (const item of this.items) {
      if (item.after === null) continue;
      const a = this.byIdMap.get(item.after);
      if (!a || !gone.has(a)) continue;
      let i = a.order - 1;
      while (i >= 0 && gone.has(this.list[i] as ObjRec)) i--;
      reanchored.push({ item, from: item.after, to: i >= 0 ? (this.list[i] as ObjRec).id : null });
    }
    const items = set.map((o) => ({ rec: o, pos: o.order, persist: o.p }));
    this.performRemove(set, detached, reanchored);
    this.record({ k: 'remove', items, detached, reanchored, label: `Delete(${rec.p.name})` });
    rep.removed.push(...names);
    if (names.length > 1) rep.warnings.push(makeNotice('dependents_removed', {}, names.slice(1)));
    if (detached.length > 0) this.onStatesChanged();
    this.diffReport(pass, rep);
    return this.okResult(parsed, 'delete', `deleted ${names.join(', ')}`, rep);
  }

  protected actionDelete(c: ActionContext): ActionResult {
    const recs = this.argObjects(c, 'Delete');
    if (!Array.isArray(recs)) return recs as ErrorObject;
    const r = this.doDelete(recs[0] as ObjRec, c.parsed, c.opts, this.pass as import('./core').Pass);
    if (!r.ok) return r;
    merge(c.rep, r.changed);
    return { summary: r.summary, op: 'delete' };
  }

  /* ------------------------------ rename ------------------------------ */

  /** Changes the name of an object. Definition texts that mention it are regenerated from their trees. */
  rename(x: Name | ObjId, to: Name, opts: ApplyOptions = {}): TxResult {
    if (this.busy) return this.busyError('rename');
    const r = this.need(x);
    if (r instanceof ObjRec === false) return r as ErrorObject;
    this.faults = [];
    if (!opts.dryRun) this.commitDrag();
    const res = this.inPass((pass) => this.doRename(r as ObjRec, to, undefined, opts, pass));
    this.deliver();
    return res.ok || this.vetting ? res : this.repaired(res);
  }

  protected doRename(rec: ObjRec, to: Name, parsed: ParsedLine | undefined, opts: ApplyOptions, pass: import('./core').Pass, s?: number, e?: number): TxResult {
    const rep = emptyReport();
    const from = rec.p.name;
    const why = nameProblem(to);
    if (why) return this.fail(parsed, 'bad_name', { name: to, why }, { hint: 'Use letters, digits and _, starting with a letter; at most 32 characters.', recovery: 'rewrite', fingerprintKey: to }, s, e);
    const group = reservedGroup(to, this.commands, this.functions ?? emptyFunctions());
    if (group) {
      return this.fail(parsed, 'reserved_name', { name: to, group: reservedGroupText(group) }, { hint: `Pick another name, such as ${to}1.`, suggest: [`Rename(${from}, "${to}1")`], recovery: 'rewrite', fingerprintKey: to }, s, e);
    }
    const holder = this.byNameMap.get(to);
    if (holder && holder !== rec) {
      return this.fail(parsed, 'name_taken', { name: to, type: holder.p.type.k }, { related: [holder.p.name], hint: `${to} is already a ${holder.p.type.k}. Choose another name.`, recovery: 'rewrite', fingerprintKey: to }, s, e);
    }
    if (holder === rec) return this.okResult(parsed, 'rename', `${from} already has that name`, rep, { name: from, id: rec.id });
    for (const o of this.confusablesOf(to, [rec])) rep.warnings.push(makeNotice('confusable_name', { name: to, other: o.p.name }));
    if (opts.dryRun) return this.okResult(parsed, 'rename', `${from} -> ${to}`, rep, { name: from, dryRun: true, affected: rec.kids.map((k) => k.p.name) });

    // who has to be rewritten: the object, the readers of its value, the owners of rules that read it, states whose rates read it
    const group2 = new Set<ObjRec>([rec]);
    for (const o of this.list) if (o !== rec && o.p.checked === rec.p.checked) group2.add(o);
    const affected = new Set<ObjRec>(group2);
    for (const k of rec.kids) affected.add(k);
    for (const k of rec.styleKids) affected.add(k);
    for (const s2 of this.list) if (s2.p.rates && [...s2.p.rates.values()].some((rr) => rr.checked.reads.includes(rec.id))) affected.add(s2);
    const changes: Change[] = [];
    for (const o of [...affected].sort((a, b) => a.order - b.order)) {
      const own = group2.has(o);
      const p = o.p;
      const starts = lineRefStarts(p.checked, rec.id, own);
      const node = renameNode(p.node, starts, from, to, own);
      let style = p.style;
      let changedStyle = false;
      const ns = new Map<string, StyleEntry>();
      for (const [k, en] of p.style) {
        if ('word' in en.checked.value) {
          ns.set(k, en);
          continue;
        }
        const st = refStarts(en.checked.value, rec.id);
        if (own) refStarts(en.checked.value, -1 as ObjId, st);
        if (st.size === 0) {
          ns.set(k, en);
          continue;
        }
        const item = renameStyleItem(en.item, st, from, to);
        ns.set(k, { ...en, item, text: printExpr(item.value) });
        changedStyle = true;
      }
      if (changedStyle) style = ns;
      let rates = p.rates;
      if (rates) {
        const nr = new Map<number, RateRule>();
        for (const [ord, rr] of rates) {
          const st = lineRefStarts(rr.checked, rec.id, own);
          nr.set(ord, st.size > 0 || own ? { ...rr, node: renameNode(rr.node, st, from, to, own) } : rr);
        }
        rates = nr;
      }
      const after: Persist = { ...p, name: own && o === rec ? to : p.name, node, style, ...(rates ? { rates } : {}) };
      changes.push({ rec: o, before: p, after });
    }
    for (const ch of changes) this.applyPersist(ch.rec, ch.after);
    this.record({ k: 'sets', changes, label: `Rename(${from}, "${to}")` });
    this.queue({ ev: 'rename', id: rec.id, from, to });
    this.diffReport(pass, rep);
    return this.okResult(parsed, 'rename', `${from} is now ${to}`, rep, { name: to, id: rec.id, type: rec.p.type.k as TypeName });
  }

  protected actionRename(c: ActionContext): ActionResult {
    const o = c.objects[0];
    const a1 = c.args[1] as { expr?: TNode } | undefined;
    if (!o) return this.fail(c.parsed, 'bad_argument', { command: 'Rename', why: 'give the name of an object' }, { recovery: 'fix_line' });
    const t = a1?.expr;
    const newName = t && t.n === 'text' && t.parts.length === 1 && typeof t.parts[0] === 'string' ? (t.parts[0] as string) : t && t.n === 'text' && t.parts.length === 0 ? '' : undefined;
    if (newName === undefined) return this.fail(c.parsed, 'bad_argument', { command: 'Rename', why: 'the new name must be a plain text' }, { recovery: 'fix_line' }, t?.s, t?.e);
    const r = this.doRename(o, newName, c.parsed, c.opts, this.pass as import('./core').Pass, t?.s, t?.e);
    if (!r.ok) return r;
    merge(c.rep, r.changed);
    c.rep.warnings.push(...r.notices);
    return { summary: r.summary, op: 'rename' };
  }

  /* ------------------------------ visibility ------------------------------ */

  protected setVisible(c: ActionContext, visible: boolean): ActionResult {
    const action = visible ? 'Show' : 'Hide';
    const recs = this.argObjects(c, action);
    if (!Array.isArray(recs)) return recs as ErrorObject;
    const names = recs.map((r) => r.p.name);
    if (c.opts.dryRun) return { summary: `${action} ${names.join(', ')}` };
    const pr = parseLine(`${names[0]} with visible = ${visible}`, { line: c.parsed.line });
    if (!pr.ok) return pr;
    const ck = checkLine(pr.value, this.view);
    if (!ck.ok) return ck;
    const comp = compileLine(ck.value, this.compileOptions((recs[0] as ObjRec).id));
    if (!comp.ok) return comp;
    const changes: Change[] = [];
    for (const r of recs) {
      const style = this.buildStyle(pr.value, ck.value, comp.value, r.p.type, r.id, r.p.kind === 'free', r.p.style, c.rep.warnings, r.p.name);
      if (style instanceof Map === false) return style as ErrorObject;
      const sm = style as Map<string, StyleEntry>;
      const prev = r.p.style.get('visible');
      if (sm.get('visible')?.value === prev?.value && sm.size === r.p.style.size) continue;
      changes.push({ rec: r, before: r.p, after: { ...r.p, style: sm } });
    }
    for (const ch of changes) {
      this.applyPersist(ch.rec, ch.after);
    }
    if (changes.length > 0) this.record({ k: 'sets', changes, label: c.checked.text });
    return { summary: `${visible ? 'showed' : 'hid'} ${names.join(', ')}`, op: 'restyle' };
  }

  /* ------------------------------ undo and redo ------------------------------ */

  /** Entries that undo can step back through, honestly counted (dropped entries are reported). */
  undoInfo(): UndoInfo {
    return this.journal.info();
  }

  /** Takes back the last group (the learner's button) or the last line (the teacher's `Undo()`). */
  undo(opts: { unit?: UndoUnit } = {}): TxResult {
    return this.stepHistory('undo', typeof opts === 'object' && opts !== null && opts.unit === 'line' ? 'line' : 'group');
  }

  redo(): TxResult {
    return this.stepHistory('redo', 'group');
  }

  protected stepHistory(dir: 'undo' | 'redo', unit: UndoUnit, parsed?: ParsedLine): TxResult {
    if (this.busy) return this.busyError(dir);
    this.commitDrag();
    const e = dir === 'undo' ? this.journal.takeUndo(unit) : this.journal.takeRedo();
    if (!e) return this.fail(parsed, 'nothing_to_undo', { what: dir }, { recovery: 'skip', hint: dir === 'undo' ? 'Nothing has been done yet.' : 'Nothing has been undone.', fingerprintKey: dir });
    if (this.opDepth === 0) this.faults = [];
    const rep = emptyReport();
    this.inPass((pass) => {
      this.replaying = true;
      try {
        if (dir === 'undo') {
          this.revertEntry(e);
          this.journal.pushRedo(e);
        } else {
          this.replayEntry(e);
          this.journal.pushUndo(e);
        }
      } finally {
        this.replaying = false;
      }
      this.logHistory(dir, e);
      this.effectOf(e, dir, rep);
      this.diffReport(pass, rep);
      this.queue({ ev: dir, group: e.label });
    });
    this.deliver();
    return this.okResult(parsed, dir, `${dir === 'undo' ? 'Undid' : 'Redid'}: ${e.label}`, rep);
  }

  /** What an entry did, as names: used for the report of an undo or redo. */
  protected effectOf(e: JournalEntry, dir: 'undo' | 'redo', rep: ChangeReport): void {
    const flip = dir === 'undo';
    switch (e.k) {
      case 'add':
        (flip ? rep.removed : rep.added).push(...e.items.map((i) => i.rec.p.name));
        return;
      case 'remove':
        (flip ? rep.added : rep.removed).push(...e.items.map((i) => (flip ? i.persist.name : i.rec.p.name)));
        return;
      case 'sets':
        rep.redefined.push(...e.changes.map((c) => (flip ? c.before.name : c.after.name)));
        if (e.reorder) rep.moved.push(...e.reorder.moved.map((r) => r.p.name));
        return;
      case 'group':
        for (const x of e.entries) this.effectOf(x, dir, rep);
        return;
      default:
        return;
    }
  }

  protected actionHistory(c: ActionContext, dir: 'undo' | 'redo'): ActionResult {
    if (c.opts.dryRun) {
      return this.journal.canTake(dir) ? { summary: dir } : this.fail(c.parsed, 'nothing_to_undo', { what: dir }, { recovery: 'skip', fingerprintKey: dir });
    }
    const r = this.stepHistory(dir, 'line', c.parsed);
    if (!r.ok) return r;
    merge(c.rep, r.changed);
    c.rep.warnings.push(...r.notices);
    return { summary: r.summary, op: dir };
  }

  /* ------------------------------ batches ------------------------------ */

  /**
   * Applies several lines as one undo step. `atomic` (the default) is all lines or none: the first failure takes back the
   * lines before it. `independent` applies every line on its own, and a line that reads the name of a failed one gets
   * `blockedBy`. Events are delivered once at the end.
   */
  applyBatch(lines: readonly (string | ParsedLine)[], opts: BatchOptions): BatchResult {
    if (typeof opts !== 'object' || opts === null) opts = { group: 'batch' };
    if (!Array.isArray(lines)) {
      const e = err('tool_input', { line: 0, col: 1, endCol: 1 }, { tool: 'applyBatch', expected: 'a list of lines' }, { recovery: 'fix_line', fingerprintKey: 'applyBatch' });
      return { ok: false, results: [e], applied: 0, rolledBack: false, changed: emptyReport(), notices: [] };
    }
    const over = this.batchBudget(lines);
    if (over) return { ok: false, results: [over], applied: 0, rolledBack: false, changed: emptyReport(), notices: [] };
    if (this.busy) return { ok: false, results: [this.busyError('applyBatch')], applied: 0, rolledBack: false, changed: emptyReport(), notices: [] };
    const dry = opts.dryRun === true;
    // a dry run leaves an open gesture as it is: the lines see its values, and it is put back afterwards
    const held = dry ? [...this.gesture] : [];
    if (dry) this.gesture.clear();
    else this.commitDrag();
    const mark = dry ? { nextId: this.nextId, stepCursor: this.stepCursor } : undefined;
    const mode = opts.mode ?? 'atomic';
    const failed = new Map<string, { line: number; kind: import('../contracts/errors').ErrorKind }>();
    const results: TxResult[] = [];
    const rep = emptyReport();
    if (this.opDepth === 0) this.listenerFailures = 0;
    const unit = this.beginUnit(opts.group);
    let rolledBack = false;
    let applied = 0;
    this.inPass((pass) => {
      for (let i = 0; i < lines.length; i++) {
        const input = lines[i] as string | ParsedLine;
        const r = this.apply(input, { line: opts.lines?.[i] ?? i + 1, failed, ...(opts.force ? { force: true } : {}), ...(opts.origin ? { origin: opts.origin } : {}), ...(opts.rebind ? { rebind: true } : {}) });
        results.push(r);
        if (r.ok) {
          applied++;
          merge(rep, r.changed, true);
          continue;
        }
        if (mode === 'atomic') {
          this.rollbackUnit(unit, pass);
          rolledBack = true;
          applied = 0;
          return;
        }
        if (typeof input === 'string') for (const n of targetNamesOf(input)) failed.set(n, { line: i + 1, kind: r.kind });
      }
      if (dry) {
        // the report is read while the lines are in, then everything is taken back
        this.diffReport(pass, rep);
        this.rollbackUnit(unit, pass);
        return;
      }
      this.journal.end();
      this.diffReport(pass, rep);
    });
    if (mark) {
      this.nextId = mark.nextId;
      this.stepCursor = mark.stepCursor;
      for (const [rec, before] of held) this.gesture.set(rec, before);
    }
    this.deliver();
    const failures = dry ? 0 : this.takeListenerFailures();
    if (failures > 0) rep.warnings.push(makeNotice('listener_failed', { where: 'a listener' }));
    if (dry) {
      const marked = results.map((r) => (r.ok ? ({ ...r, dryRun: true } as const) : r));
      return { ok: marked.every((r) => r.ok), results: marked, applied, rolledBack, changed: rep, notices: rep.warnings, dryRun: true };
    }
    return { ok: results.every((r) => r.ok), results, applied, rolledBack, changed: rep, notices: rep.warnings };
  }

  /**
   * Opens a journal group and notes what a rollback has to restore: the group mark, both stacks and the event queues. Shared
   * by `applyBatch` and `load`, so every atomic failure puts back the same things (KERN-SM-15).
   */
  protected beginUnit(label: string): Unit {
    return { mark: this.journal.begin(label), snap: this.journal.snapshot(), evMark: this.pendingEvents.length, valMark: new Set(this.pendingValues), styMark: new Set(this.pendingStyles) };
  }

  /** Gives up the group and takes back every entry it holds, newest first; both stacks and the pending events are as `beginUnit` saw them. */
  protected rollbackUnit(u: Unit, pass?: import('./core').Pass): void {
    const entries = this.journal.abandon(u.mark);
    this.replaying = true;
    try {
      for (let k = entries.length - 1; k >= 0; k--) this.revertEntry(entries[k] as JournalEntry);
    } finally {
      this.replaying = false;
    }
    this.journal.restore(u.snap);
    this.pendingEvents.length = Math.min(this.pendingEvents.length, u.evMark);
    this.pendingValues = u.valMark;
    this.pendingStyles = u.styMark;
    if (pass) {
      pass.before.clear();
      pass.added.clear();
    }
  }

  /** The `limit` error when a batch has too many lines or too much text (the same budgets a loaded file has, KERN-SM-1). */
  protected batchBudget(lines: readonly (string | ParsedLine)[]): ErrorObject | undefined {
    const at = { line: 0, col: 1, endCol: 1 };
    if (lines.length > this.limits.lines) {
      return err('limit', at, { limit: 'lines', max: this.limits.lines, got: lines.length, what: 'lines in one batch' }, { recovery: 'rewrite', fingerprintKey: 'lines' });
    }
    let chars = 0;
    for (const l of lines) {
      if (typeof l === 'string') chars += l.length + 1;
      if (chars > this.limits.fileSize) {
        return err('limit', at, { limit: 'file_size', max: this.limits.fileSize, got: chars, what: 'characters in a batch' }, { recovery: 'rewrite', fingerprintKey: 'file_size' });
      }
    }
    return undefined;
  }

  /* ------------------------------ free values ------------------------------ */

  /**
   * Writes the value of a free object. Many writes may come between two flushes; the last one wins. Writes with `why`
   * `drag` and `slider` belong to a gesture and are journalled as one entry by `commitDrag`; `show_me` and `api` writes are
   * journalled at once; `solver` and `anim` writes are not journalled and join no gesture (the clock does not touch undo).
   */
  setFree(x: Name | ObjId, value: unknown, why: WriteWhy = 'api', opts: SetFreeOptions = {}): WriteResult {
    const res = this.writeFree(x, value, why, opts);
    return res.ok || this.vetting ? res : this.repaired(res);
  }

  protected writeFree(x: Name | ObjId, value: unknown, why: WriteWhy, opts: SetFreeOptions): WriteResult {
    if (this.busy) return this.busyError('setFree');
    const r = this.need(x);
    if (r instanceof ObjRec === false) return r as ErrorObject;
    const rec = r as ObjRec;
    const at = { line: 0, col: 1, endCol: 1 };
    // `why` decides authorisation and history: only the six reasons exist, and `solver` belongs to the states it drives
    if (typeof why !== 'string' || !WRITE_WHYS.includes(why) || (why === 'solver' && rec.p.kind !== 'state')) {
      return err('bad_argument', at, { command: 'setFree', why: why === 'solver' ? 'the solver writes only states' : 'the reason must be drag, slider, show_me, api or anim' }, { recovery: 'fix_line', fingerprintKey: 'why' });
    }
    // a stored value is the figure's own: copy it once, inside a try, so a getter that throws or a later change by the caller cannot reach it
    let v: unknown;
    try {
      v = ownValue(rec.p.type.k, value);
    } catch {
      return err('bad_argument', at, { command: 'setFree', why: `the value of ${rec.p.name} could not be read` }, { hint: `Give a ${rec.p.type.k}.`, recovery: 'fix_line', fingerprintKey: rec.p.name });
    }
    if (rec.p.kind === 'state' && why !== 'solver') {
      return err('not_free', at, { name: rec.p.name, inputs: 'the solver' }, { messageKey: 'kernel.state_owned', hint: 'The solver owns the value of a state.', recovery: 'choose', related: [rec.p.name], fingerprintKey: 'state:' + rec.p.name });
    }
    if (rec.p.kind !== 'free' && rec.p.kind !== 'state') {
      const ins = rec.valueIn.map((i) => i.p.name);
      const lit = valueSource(rec.p.type, v) ?? (rec.cell.defined ? valueSource(rec.p.type, rec.cell.value) : undefined);
      const line = lit !== undefined && lit !== 'undefined' && lit.length <= 200 ? `${rec.p.name} = ${lit}` : undefined;
      return err('not_free', at, { name: rec.p.name, inputs: joinNames(ins) }, { hint: `Redefine it as a plain value${line ? ` (${line})` : ''} or change ${ins.join(', ')}.`, ...(line ? { suggest: [line] } : {}), recovery: 'choose', related: ins, fingerprintKey: rec.p.name });
    }
    // the player of an animation is not the learner: a fixed slider still plays
    if (this.isFixed(rec) && why !== 'solver' && why !== 'anim' && !opts.force) {
      return err('locked', at, { name: rec.p.name }, { hint: `Unfix it first: ${rec.p.name} with fixed = false`, suggest: [`${rec.p.name} with fixed = false`], recovery: 'choose', fingerprintKey: rec.p.name });
    }
    if (rec.p.type.k === 'Number' && (v === undefined || (typeof v === 'number' && v !== v))) v = undefined;
    else if (!fitsType(rec.p.type, v)) {
      return err('bad_argument', at, { command: 'setFree', why: `${rec.p.name} holds a ${rec.p.type.k}` }, { hint: `Give a ${rec.p.type.k}.`, recovery: 'fix_line', fingerprintKey: rec.p.name });
    }
    if (typeof v === 'string' && v.length > this.limits.textLength) {
      return err('limit', at, { limit: 'text_length', max: this.limits.textLength, got: v.length, what: 'characters in a text' }, { recovery: 'rewrite', fingerprintKey: 'text_length' });
    }
    if (typeof v === 'string') {
      // a free Text is saved as `name = "..."` on one line; it must read back as the same text (KERN-SM-12)
      const back = this.textReadsBack(rec.p.name, v);
      if (back !== true) return back;
    }
    if (typeof v === 'number') {
      const rg = rec.range;
      if (rg) {
        v = Math.min(rg.max, Math.max(rg.min, v));
        if (rg.step !== undefined && why !== 'api' && why !== 'solver') {
          const steps = Math.round(((v as number) - rg.min) / rg.step);
          const q = rg.min + steps * rg.step;
          const dec = Math.max(decimals(rg.step), decimals(rg.min));
          v = Math.min(rg.max, Math.max(rg.min, Number(q.toFixed(Math.min(dec, 12)))));
        }
      }
    }
    const reason = opts.reason ?? 'explicit';
    const cell = v === undefined ? ({ defined: false, reason } as const) : ({ defined: true, value: v } as const);
    if (rec.cell.defined === cell.defined && (!cell.defined || sameValue((rec.cell as { value: unknown }).value, v)) && (cell.defined || !rec.cell.defined)) {
      return { ok: true, changed: false };
    }
    // a write that is journalled now comes after the gesture that was still open (KERN-SM-11)
    if (why === 'show_me' || why === 'api') this.commitDrag();
    const before = rec.p;
    const after: Persist = { ...before, ...(v === undefined ? { freeReason: reason } : {}), value: v };
    if (why === 'drag' || why === 'slider') {
      if (!this.gesture.has(rec)) this.gesture.set(rec, before);
    }
    rec.p = after;
    rec.infoCache = undefined;
    this.epoch++;
    if (this.pass && !this.pass.before.has(rec) && !this.pass.added.has(rec)) this.pass.before.set(rec, rec.cell);
    rec.cell = cell;
    rec.changedAt = this.epoch;
    this.pendingValues.add(rec.id);
    for (const k of rec.styleKids) {
      k.styleCache = undefined;
      this.pendingStyles.add(k.id);
    }
    this.markDirty(rec);
    this.onFreeWritten(rec, before.value);
    if (why === 'show_me' || why === 'api') {
      this.record({ k: 'sets', changes: [{ rec, before, after }], label: `${rec.p.name} = ${valueText(v)}` });
    }
    return { ok: true, changed: true };
  }

  /**
   * True when the saved line of a free Text reads back as the same text; else the error to return. The language has no escape
   * for a typographic quote or a carriage return, and a line is capped at `lineLength`, so such a Text could be saved but not loaded.
   */
  protected textReadsBack(name: string, v: string): true | ErrorObject {
    const at = { line: 0, col: 1, endCol: 1 };
    const pr = parseLine(`${name} = ${valueSource({ k: 'Text' } as never, v) as string}`, { line: 1, limits: this.langLimits });
    if (!pr.ok) {
      if (pr.kind === 'limit') {
        return err('limit', at, { limit: 'line_length', max: this.limits.lineLength, got: v.length, what: 'characters in the saved line of a text' }, { recovery: 'rewrite', fingerprintKey: 'line_length' });
      }
      return err('bad_argument', at, { command: 'setFree', why: `${name} cannot hold this text: a script cannot store one of its characters` }, { hint: 'Leave out typographic quotes and line breaks other than \n.', recovery: 'fix_line', fingerprintKey: name });
    }
    const n = pr.value.node;
    const e = n.k === 'define' ? n.expr : undefined;
    if (e && e.k === 'str' && (v === '' ? e.parts.length === 0 : e.parts.length === 1 && e.parts[0] === v)) return true;
    return err('bad_argument', at, { command: 'setFree', why: `${name} cannot hold this text: a script cannot store one of its characters` }, { hint: 'Leave out typographic quotes and line breaks other than \n.', recovery: 'fix_line', fingerprintKey: name });
  }

  /** Hook for the solver: a free value that a rate may read changed. */
  protected onFreeWritten(_rec: ObjRec, _was?: unknown): void {
    // the solver checks its inputs when it syncs
  }

  /** Journals the gesture writes since the last commit as one entry (first value to last). */
  override commitDrag(): { committed: number } {
    if (this.busy || this.gesture.size === 0) return { committed: 0 };
    const changes: Change[] = [];
    for (const [rec, before] of this.gesture) {
      if (this.byIdMap.get(rec.id) !== rec) continue;
      const after = rec.p;
      const same = before.node === after.node && sameValue(before.value, after.value) && before.freeReason === after.freeReason;
      if (!same) changes.push({ rec, before, after });
    }
    this.gesture.clear();
    if (changes.length === 0) return { committed: 0 };
    this.record({ k: 'sets', changes, label: `moved ${changes.map((c) => c.rec.p.name).join(', ')}` });
    return { committed: changes.length };
  }

  /* ------------------------------ drag plans ------------------------------ */

  /**
   * The free writes that would move `x` to `target` (kernel design 7). A free point or slider writes itself; a dependent
   * object writes its free parents when its rule can be inverted (`PointOn`, `Midpoint`, `Translate` once those areas
   * declare `invert`). `null` writes with a reason otherwise.
   */
  dragPlan(x: Name | ObjId, target: unknown): DragPlan {
    const rec = this.recOf(x);
    if (!rec) return { writes: [], reason: 'unknown_object' };
    return this.planDrag(rec, target, 0);
  }

  protected planDrag(rec: ObjRec, target: unknown, depth: number): DragPlan {
    if (this.isFixed(rec)) return { writes: [], reason: 'locked' };
    if (rec.p.kind === 'state') return { writes: [], reason: 'owned_by_solver' };
    if (rec.p.kind === 'free') {
      const k = rec.p.type.k;
      if (k !== 'Point' && k !== 'Number' && k !== 'Bool') return { writes: [], reason: 'not_draggable' };
      if (!fitsType(rec.p.type, target)) return { writes: [], reason: 'bad_target' };
      return { writes: [{ id: rec.id, name: rec.p.name, value: target }], kind: 'free' };
    }
    if (depth > 8) return { writes: [], reason: 'not_draggable' };
    const expr = rec.p.checked.expr;
    const comp = rec.p.compiled?.command;
    if (!expr || expr.n !== 'command' || !comp) return { writes: [], reason: 'not_draggable' };
    let rule = this.ruleCache.get(comp.args);
    if (!rule) {
      try {
        rule = comp.form.rule(comp.args.map((a) => ({ param: a.param, omitted: a.omitted, ...(a.binder !== undefined ? { binder: a.binder } : {}), ...(a.value !== undefined ? { value: a.value } : {}), ...(a.tree !== undefined ? { expr: a.tree } : {}) }))) as import('./registry').CommandRule;
      } catch {
        return { writes: [], reason: 'not_draggable' };
      }
    }
    if (!rule?.invert) return { writes: [], reason: 'not_draggable' };
    if (!rec.cell.defined) return { writes: [], reason: 'undefined' };
    this.ensureSlots(rec.p.checked.slots);
    const values = comp.args.map((a) => {
      const v = a.eval && (a.param.kind ?? 'value') === 'value' ? a.eval(this.env) : a.value;
      return typeof v === 'number' && v !== v ? undefined : v;
    });
    const call: InvertCall = { values, ids: comp.args.map((a) => a.ref), tol: this.tolerance(), form: comp.form, spec: comp.spec };
    let out: ReturnType<NonNullable<typeof rule.invert>>;
    try {
      out = rule.invert(target, call);
    } catch {
      return { writes: [], reason: 'not_draggable' };
    }
    if (!out || out.length === 0) return { writes: [], reason: 'not_draggable' };
    const writes: DragWrite[] = [];
    for (const w of out) {
      const arg = expr.args[w.param];
      const parent = arg?.expr && arg.expr.n === 'ref' ? this.byIdMap.get(arg.expr.id) : undefined;
      // a number written in the line itself is rewritten (dragging P = PointOn(c, 0.25) changes the 0.25)
      if (!parent && arg?.expr?.n === 'num' && typeof w.value === 'number' && Number.isFinite(w.value)) {
        writes.push({ id: rec.id, name: rec.p.name, value: w.value, param: w.param });
        continue;
      }
      if (!parent) return { writes: [], reason: 'not_draggable' };
      const sub = this.planDrag(parent, w.value, depth + 1);
      if (sub.writes.length === 0) return { writes: [], ...(sub.reason ? { reason: sub.reason } : {}) };
      writes.push(...sub.writes);
    }
    return { writes, kind: rec.p.node.k === 'define' && rec.p.node.expr.k === 'call' && rec.p.node.expr.callee === 'PointOn' ? 'path' : 'inverted' };
  }

  /** Applies the writes of a plan as part of a drag gesture, then runs one pass. Call `commitDrag` on release. */
  drag(plan: DragPlan): FrameDeltaResult {
    if (typeof plan !== 'object' || plan === null || !Array.isArray(plan.writes)) return { ok: false, reason: 'not_draggable' };
    if (plan.writes.length === 0) return { ok: false, reason: plan.reason ?? 'not_draggable' };
    for (const w of plan.writes) {
      if (w.param !== undefined) {
        if (!this.writeLiteral(w.id, w.param, w.value as number)) return { ok: false, reason: 'not_draggable' };
        continue;
      }
      const r = this.setFree(w.id, w.value, 'drag');
      if (!r.ok) return { ok: false, reason: r.kind };
    }
    const delta = this.flush();
    runDragListeners(this, delta.valueIds);
    return { ok: true, delta };
  }

  /** Rewrites the number given as argument `param` in the object's line, as part of the drag gesture. */
  protected writeLiteral(id: ObjId, param: number, value: number): boolean {
    const rec = this.byIdMap.get(id);
    if (!rec || this.busy) return false;
    const node = rec.p.node;
    const expr = rec.p.checked.expr;
    if (node.k !== 'define' || node.expr.k !== 'call' || !expr || expr.n !== 'command') return false;
    const t = expr.args[param]?.expr;
    if (!t) return false;
    const i = node.expr.args.findIndex((a) => a.value.s === t.s && a.value.e === t.e);
    const old = node.expr.args[i];
    if (!old) return false;
    const v = Number(value.toPrecision(15));
    const num = { k: 'num' as const, v, text: String(v), int: Number.isInteger(v), s: old.value.s, e: old.value.e };
    const changed = { ...node, expr: { ...node.expr, args: node.expr.args.map((a, j) => (j === i ? { ...a, value: num } : a)) } };
    const pr = parseLine(printLineNode(changed), { line: 1, isTaken: (n) => this.byNameMap.has(n), limits: this.langLimits });
    if (!pr.ok || pr.value.node.k !== 'define') return false;
    const c = checkLine(pr.value, this.view, { limits: this.langLimits, propertyKeys: validKeysFor });
    if (!c.ok) return false;
    const comp = this.compileFor(c.value, rec.id);
    if (!comp) return false;
    if (!this.gesture.has(rec)) this.gesture.set(rec, rec.p);
    this.applyPersist(rec, { ...rec.p, node: { ...pr.value.node, ...(node.style ? { style: node.style } : {}) } as typeof node, checked: c.value, compiled: comp });
    this.settle([rec]);
    return true;
  }

  /* ------------------------------ ordering moves ------------------------------ */

  /** The objects that must move with `x` to put it at `to` without breaking an order. */
  movePlan(x: Name | ObjId, to: number): MovePlan {
    const rec = this.recOf(x);
    if (!rec || to < 0 || to >= this.list.length) return { ok: false, alsoMove: [] };
    const group = this.moveGroup(rec, to);
    return { ok: group.length === 1, alsoMove: group.filter((g) => g !== rec).map((g) => g.p.name) };
  }

  protected moveGroup(rec: ObjRec, to: number): ObjRec[] {
    if (to > rec.order) {
      const deps = [...this.downOf(rec)].filter((o) => o <= to).map((o) => this.list[o] as ObjRec);
      return [rec, ...deps];
    }
    if (to < rec.order) {
      const anc = this.ancestorRecs(rec.inputs, to).filter((a) => a.order < rec.order);
      return [...anc, rec];
    }
    return [rec];
  }

  /** Moves an object to an order index. Without `withInputs` a move that would break an order is `forward_reference`. */
  move(x: Name | ObjId, to: number, opts: { withDependencies?: boolean } = {}): TxResult {
    if (this.busy) return this.busyError('move');
    const r = this.need(x);
    if (r instanceof ObjRec === false) return r as ErrorObject;
    const rec = r as ObjRec;
    const rep = emptyReport();
    if (to < 0 || to >= this.list.length) return this.fail(undefined, 'bad_argument', { command: 'move', why: 'the position is outside the figure' }, { recovery: 'fix_line' });
    const group = this.moveGroup(rec, to);
    if (group.length > 1 && !opts.withDependencies) {
      const other = group.find((g) => g !== rec) as ObjRec;
      return this.fail(undefined, 'forward_reference', { name: rec.p.name, input: other.p.name }, { related: group.filter((g) => g !== rec).map((g) => g.p.name), hint: `${other.p.name} has to move with ${rec.p.name}.`, recovery: 'choose' });
    }
    if (group.length === 1 && to === rec.order) return this.okResult(undefined, 'noop', 'already there', rep);
    const lo = Math.min(rec.order, to, ...group.map((g) => g.order));
    const hi = Math.max(rec.order, to, ...group.map((g) => g.order));
    const before = this.list.slice(lo, hi + 1);
    const inGroup = new Set(group);
    const rest = before.filter((b) => !inGroup.has(b));
    const sortedGroup = [...group].sort((a, b) => a.order - b.order);
    const after = to > rec.order ? [...rest, ...sortedGroup] : [...sortedGroup, ...rest];
    const reorder: Reorder = { lo, before, after, moved: group };
    this.faults = [];
    this.commitDrag();
    const res = this.inPass((pass) => {
      reorder.reanchored = this.reorderKeepingSteps(lo, after);
      this.record({ k: 'sets', changes: [], reorder, label: `move ${rec.p.name}` });
      rep.moved.push(...group.map((g) => g.p.name));
      this.diffReport(pass, rep);
      return this.okResult(undefined, 'redefine', `moved ${group.map((g) => g.p.name).join(', ')}`, rep, { name: rec.p.name, id: rec.id });
    });
    this.deliver();
    return res;
  }

  /** Adds a line at an order index: its inputs must come earlier, else `forward_reference`. */
  insertAt(index: number, line: string | ParsedLine, opts: ApplyOptions = {}): TxResult {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > this.list.length) {
      return err('bad_argument', { line: 0, col: 1, endCol: 1 }, { command: 'insertAt', why: `the position must be a whole number from 0 to ${this.list.length}` }, { recovery: 'fix_line', fingerprintKey: 'insertAt' });
    }
    return this.apply(line, { ...(typeof opts === 'object' && opts !== null ? opts : {}), insertAt: index });
  }

  /* ------------------------------ Describe, DependsOn, Uses ------------------------------ */

  protected actionDescribe(c: ActionContext): ActionResult {
    const recs = this.argObjects(c, 'Describe');
    if (!Array.isArray(recs)) return recs as ErrorObject;
    const d = this.describe((recs[0] as ObjRec).id);
    if ('ok' in d) return d as ErrorObject;
    return { summary: `${d.name}: ${d.type}, ${d.defined ? d.value : 'undefined'}`, data: d, op: 'action' };
  }

  protected actionList(c: ActionContext, which: 'DependsOn' | 'Uses'): ActionResult {
    const recs = this.argObjects(c, which);
    if (!Array.isArray(recs)) return recs as ErrorObject;
    const rec = recs[0] as ObjRec;
    const ids = which === 'DependsOn' ? this.ancestorsOf(rec.id) : this.dependentsOf(rec.id);
    const names = ids.map((id) => (this.byIdMap.get(id) as ObjRec).p.name);
    return { summary: `${rec.p.name} ${which === 'DependsOn' ? 'depends on' : 'is used by'}: ${names.length ? names.join(', ') : 'nothing'}`, data: names, op: 'action' };
  }

  /* ------------------------------ naming ------------------------------ */

  /** A free name for a new object of this type (points A, B, ... numbers a, b, ... functions f, g, h). */
  suggestName(type: TypeName | string, hint?: string): Name {
    if (typeof type !== 'string') type = 'Number';
    if (typeof hint !== 'string') hint = undefined;
    if (hint && !this.byNameMap.has(hint) && !nameProblem(hint) && !reservedGroup(hint, this.commands, this.functions ?? emptyFunctions())) return hint;
    return languageSuggestName(type, (n) => this.byNameMap.has(n), { commands: this.commands, ...(this.functions ? { functions: this.functions } : {}) });
  }
}

export interface FrameDeltaResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly delta?: import('./types').FrameDelta;
}

/** A copy of a point or vector value with plain numbers; every other value is returned as it is. Reading may throw. */
function ownValue(type: string, v: unknown): unknown {
  if ((type === 'Point' || type === 'Vector') && typeof v === 'object' && v !== null) {
    const o = v as { x?: unknown; y?: unknown };
    const x = o.x;
    const y = o.y;
    return typeof x === 'number' && typeof y === 'number' ? { x, y } : v;
  }
  return v;
}

function decimals(x: number): number {
  const s = String(x);
  const i = s.indexOf('.');
  if (s.includes('e-')) return Number(s.split('e-')[1]) + (i >= 0 ? s.split('e-')[0]!.length - i - 1 : 0);
  return i < 0 ? 0 : s.length - i - 1;
}

import { closestNames } from '../language/errors';
import { createFunctionTable } from '../language/table';
import type { FunctionTable } from '../language/table';
import { BUILTIN_FUNCTIONS } from '../language/builtins';

function closestOf(name: string, candidates: string[]): string[] {
  return closestNames(name, candidates, 1);
}

function emptyFunctions(): FunctionTable {
  return BUILTIN_FUNCTIONS ?? createFunctionTable([]);
}

/** Adds the names of a report to another. */
export function merge(into: ChangeReport, from: ChangeReport, withDiff = false): void {
  into.added.push(...from.added);
  into.removed.push(...from.removed);
  into.redefined.push(...from.redefined);
  into.moved.push(...from.moved);
  if (!withDiff) {
    into.becameUndefined.push(...from.becameUndefined);
    into.becameDefined.push(...from.becameDefined);
  }
  for (const w of from.warnings) if (!into.warnings.includes(w) && w.kind !== 'became_undefined' && w.kind !== 'became_defined') into.warnings.push(w);
}

export type { Notice, TxOk, Description, StyleEntry, BatchOptions, BatchResult };
void toEffective;
void printStyle;
