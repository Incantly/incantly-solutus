/**
 * The figure: the object store with transactions, history, batches, actions, queries and the hooks of the clock,
 * the solver, drag plans and saving (docs/features/kernel/design.md).
 *
 * `FigureCore` (core.ts) holds the graph and the update pass. This class adds the line pipeline (parse, resolve,
 * check, plan, compute once, commit), the journal and the services built on them. Each accepted line is one journal
 * entry; a rejected line changes nothing.
 */
import type { Span } from '../contracts/errors';
import type { Name, ObjId, TypeName, UndefReason } from '../contracts/values';
import { becameUndefinedNotice, makeNotice } from '../errors/notices';
import { Journal } from '../history/journal';
import type { Reorder, ScriptItem } from '../history/journal';
import type { ParsedLine } from '../language/ast';
import { kernelActionSpecs } from './actions';
import { FigureCore, ObjRec, cellsEqual } from './core';
import type { FigureOptions, Pass } from './core';
import { NOT_SET } from './types';
import type { Cell, ChangeReport, FrameDelta, Persist } from './types';

export type { FigureOptions };

export class FigureBase extends FigureCore {
  readonly journal: Journal;
  /** Comments and directives, kept in place. */
  items: ScriptItem[] = [];
  /** Index in `items` of each non-repeatable directive, by name (kept by `insertItem` and `removeItem`). */
  protected readonly directiveAt = new Map<string, number>();
  /** The reveal cursor of the step list; `undefined` means every step is shown. */
  stepCursor: number | undefined;
  /** Gesture writes waiting for `commitDrag`: the persisted state each object had when the gesture began. */
  protected gesture = new Map<ObjRec, Persist>();
  /** When true, `apply` skips the redo-clearing journal record (replay of undo/redo). */
  protected replaying = false;
  protected passDepth = 0;

  constructor(opts: FigureOptions = {}) {
    super(opts);
    this.registry.registerAll(kernelActionSpecs());
    this.journal = new Journal(this.limits.journalEntries, this.limits.journalBytes);
  }

  /* ------------------------------ small helpers ------------------------------ */

  protected whole(parsed: ParsedLine): Span & { token: string } {
    const t = parsed.sm.text;
    let s = 0;
    while (s < t.length && /\s/.test(t[s] as string)) s++;
    let e = t.length;
    while (e > s && /\s/.test(t[e - 1] as string)) e--;
    return parsed.sm.span(s, e);
  }

  protected at(parsed: ParsedLine | undefined, s?: number, e?: number): Span & { token: string } {
    if (!parsed) return { line: 0, col: 1, endCol: 1, token: '' };
    return s === undefined || e === undefined ? this.whole(parsed) : parsed.sm.span(s, e);
  }

  protected nameOf(id: ObjId | undefined): Name | undefined {
    return id === undefined ? undefined : this.byIdMap.get(id)?.p.name;
  }

  protected typeName(r: ObjRec): TypeName {
    return r.p.type.k as TypeName;
  }

  /** The cell of a free object from its persisted value. */
  protected freeCell(p: Persist): Cell {
    const v = p.value;
    if (v === undefined || (typeof v === 'number' && v !== v)) return { defined: false, reason: p.freeReason ?? 'explicit' };
    return { defined: true, value: v };
  }

  /* ------------------------------ passes ------------------------------ */

  /** Runs `fn` as one operation: events are delivered once at the end, faults are collected, changes are tracked. */
  protected inPass<T>(fn: (pass: Pass) => T): T {
    const outer = this.pass;
    // a nested operation tracks its own changes (so its report is its own) and hands them to the outer one when it ends
    const pass: Pass = { before: new Map(), added: new Set() };
    this.pass = pass;
    this.opDepth++;
    this.passDepth++;
    const wasForce = this.forceAll;
    this.forceAll = true;
    try {
      return fn(pass);
    } finally {
      this.forceAll = wasForce;
      this.passDepth--;
      this.opDepth--;
      this.pass = outer;
      if (outer) {
        for (const [r, c] of pass.before) if (!outer.before.has(r) && !outer.added.has(r)) outer.before.set(r, c);
        for (const r of pass.added) outer.added.add(r);
      }
    }
  }

  /** Builds the part of the change report that the cells tell: what became undefined or defined. */
  protected diffReport(pass: Pass, rep: ChangeReport): void {
    const undef: { rec: ObjRec; cell: Cell & { defined: false } }[] = [];
    const entries = [...pass.before.entries()].filter(([r]) => this.byIdMap.get(r.id) === r).sort((a, b) => a[0].order - b[0].order);
    for (const [r, was] of entries) {
      const now = r.cell;
      if (was.defined && !now.defined) undef.push({ rec: r, cell: now });
      else if (!was.defined && now.defined) rep.becameDefined.push(r.p.name);
    }
    for (const r of [...pass.added].filter((x) => this.byIdMap.get(x.id) === x).sort((a, b) => a.order - b.order)) {
      if (!r.cell.defined) undef.push({ rec: r, cell: r.cell });
    }
    const groups = new Map<UndefReason, string[]>();
    for (const u of undef) {
      const c = u.cell;
      const cause = this.nameOf(c.cause);
      rep.becameUndefined.push({ name: u.rec.p.name, reason: c.reason, ...(c.detail !== undefined ? { detail: c.detail } : {}), ...(cause !== undefined ? { cause } : {}) });
      const g = groups.get(c.reason) ?? [];
      g.push(u.rec.p.name);
      groups.set(c.reason, g);
    }
    for (const [reason, names] of groups) rep.warnings.push(becameUndefinedNotice(names, reason));
    if (rep.becameDefined.length > 0) rep.warnings.push(makeNotice('became_defined', {}, rep.becameDefined));
  }

  /* ------------------------------ structural primitives ------------------------------ */

  /** Replaces what is persisted for an object, rewiring its edges and the name table. */
  protected applyPersist(r: ObjRec, p: Persist): void {
    const old = r.p;
    this.unwire(r);
    if (old.name !== p.name) {
      if (this.byNameMap.get(old.name) === r) this.byNameMap.delete(old.name);
      this.byNameMap.set(p.name, r);
    }
    r.p = p;
    r.infoCache = undefined;
    r.styleCache = undefined;
    r.down = undefined;
    this.wire(r);
    this.pendingStyles.add(r.id);
  }

  /** Puts objects into the list at their positions (ascending), registers them and wires their edges. */
  protected insertRecs(items: readonly { rec: ObjRec; pos: number }[]): void {
    for (const { rec, pos } of items) {
      this.list.splice(Math.min(pos, this.list.length), 0, rec);
      this.byIdMap.set(rec.id, rec);
      this.byNameMap.set(rec.p.name, rec);
    }
    this.renumber(0);
    for (const { rec } of items) {
      rec.infoCache = undefined;
      rec.styleCache = undefined;
      this.wire(rec);
      this.queue({ ev: 'add', id: rec.id });
    }
  }

  /** Takes objects out of the list, unwires them and frees their names. */
  protected removeRecs(recs: readonly ObjRec[]): void {
    for (const r of recs) {
      this.unwire(r);
      this.byIdMap.delete(r.id);
      if (this.byNameMap.get(r.p.name) === r) this.byNameMap.delete(r.p.name);
      this.dirty.delete(r);
      this.gesture.delete(r);
      this.queue({ ev: 'remove', id: r.id, name: r.p.name });
    }
    const gone = new Set(recs);
    let w = 0;
    for (let i = 0; i < this.list.length; i++) {
      const x = this.list[i] as ObjRec;
      if (!gone.has(x)) this.list[w++] = x;
    }
    this.list.length = w;
    this.renumber(0);
  }

  protected applyReorder(lo: number, recs: readonly ObjRec[]): void {
    for (let i = 0; i < recs.length; i++) this.list[lo + i] = recs[i] as ObjRec;
    this.renumber(lo);
    this.queue({ ev: 'reorder', ids: recs.map((r) => r.id) });
  }

  /** The reorder that puts the ancestors of `inputs` before `anchor` (kernel design 6.1), or undefined when none is needed. */
  protected planReorder(anchors: readonly ObjRec[], inputs: readonly ObjRec[]): Reorder | undefined {
    if (anchors.length === 0) return undefined;
    const anchor = anchors.reduce((a, b) => (a.order <= b.order ? a : b));
    const targets = new Set(anchors);
    const need = this.ancestorRecs(inputs, anchor.order).filter((r) => r.order > anchor.order && !targets.has(r));
    if (need.length === 0) return undefined;
    const hi = need[need.length - 1] as ObjRec;
    const lo = anchor.order;
    const before = this.list.slice(lo, hi.order + 1);
    const lateSet = new Set(need);
    const after = [...need, ...before.filter((r) => !lateSet.has(r))];
    return { lo, before, after, moved: need };
  }

  /**
   * Computes the cells of objects after a structural change, in ascending order, then runs one pass over what reads them.
   * The objects are the sources of the pass.
   */
  protected settle(recs: readonly ObjRec[], precomputed?: ReadonlyMap<ObjRec, Cell>): FrameDelta {
    const sorted = [...recs].filter((r) => this.byIdMap.get(r.id) === r).sort((a, b) => a.order - b.order);
    this.epoch++;
    for (const r of sorted) {
      r.stale = false;
      this.ensureSlots(r.p.checked.slots);
      let cell: Cell;
      const pre = precomputed?.get(r);
      if (pre) cell = pre;
      else if (r.p.kind === 'free') cell = this.freeCell(r.p);
      else if (r.p.kind === 'state') cell = this.stateInitial(r);
      else cell = this.compute(r);
      if (this.pass && !this.pass.before.has(r) && !this.pass.added.has(r)) this.pass.before.set(r, r.cell);
      if (!cellsEqual(r.cell, cell)) {
        r.cell = cell;
        this.pendingValues.add(r.id);
      }
      r.range = undefined;
      if (r.p.compiled?.range) this.updateRange(r);
      this.dirty.add(r);
    }
    return this.flush(true);
  }

  /** The initial value of a state, evaluated now. */
  protected stateInitial(r: ObjRec): Cell {
    const c = r.p.compiled;
    if (!c?.state) return NOT_SET;
    this.env.reason = undefined;
    this.env.cause = undefined;
    this.env.detail = undefined;
    const v = c.state.initial(this.env);
    if (v === undefined || (typeof v === 'number' && v !== v)) return { defined: false, reason: this.env.reason ?? 'not_set' };
    return { defined: true, value: v };
  }
}
