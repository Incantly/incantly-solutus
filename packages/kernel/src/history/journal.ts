/**
 * The undo journal (docs/features/kernel/design.md section 11): small inverse entries, never whole-figure snapshots.
 * An entry holds references to the object records and to their immutable `Persist` before and after, so undo is exact
 * and ids stay stable.
 */
import type { ObjId } from '../contracts/values';
import type { ObjRec } from '../graph/core';
import type { Persist } from '../graph/types';

/** A reorder of a stretch of the object list: the objects at `lo..lo+before.length-1` before and after. */
export interface Reorder {
  readonly lo: number;
  readonly before: readonly ObjRec[];
  readonly after: readonly ObjRec[];
  /** The objects that moved earlier, in their new order. */
  readonly moved: readonly ObjRec[];
}

export interface Change {
  readonly rec: ObjRec;
  readonly before: Persist;
  readonly after: Persist;
}

export interface Reanchor {
  readonly item: ScriptItem;
  readonly from: ObjId | null;
  readonly to: ObjId | null;
}

/** A comment or directive kept in place in the script, after the object `after` (or at the top when `null`). */
export interface ScriptItem {
  text: string;
  after: ObjId | null;
  /** The directive name, or `''` for a comment. */
  name: string;
  words: readonly string[];
}

export type JournalEntry =
  | { readonly k: 'add'; readonly items: readonly { readonly rec: ObjRec; readonly pos: number }[]; readonly label: string }
  | {
      readonly k: 'remove';
      readonly items: readonly { readonly rec: ObjRec; readonly pos: number; readonly persist: Persist }[];
      /** Property rules of surviving objects that read a removed object and were detached. */
      readonly detached: readonly Change[];
      readonly reanchored: readonly Reanchor[];
      readonly label: string;
    }
  | { readonly k: 'sets'; readonly changes: readonly Change[]; readonly reorder?: Reorder; readonly label: string }
  | { readonly k: 'item'; readonly item: ScriptItem; readonly was: ScriptItem | null; readonly index: number; readonly label: string }
  | { readonly k: 'group'; readonly label: string; readonly entries: JournalEntry[] };

export interface UndoInfo {
  /** Entries that undo can step back through. */
  readonly depth: number;
  /** Entries that redo can step forward through. */
  readonly redoDepth: number;
  /** Entries dropped from the old end because a capacity was reached. */
  readonly dropped: number;
  readonly capacity: number;
  /** Label of the entry undo would take back. */
  readonly next: string | undefined;
}

/** An estimate of what a stored state holds: a fixed part, the definition text, and the free value. */
function persistSize(p: Persist): number {
  const v = p.value;
  const value = typeof v === 'string' ? v.length * 2 : Array.isArray(v) ? v.length * 16 : ArrayBuffer.isView(v) ? (v as unknown as { byteLength: number }).byteLength : 16;
  return 100 + p.checked.text.length * 2 + value;
}

/** The size of an entry from what it holds (its texts and values), not a flat guess, so the byte cap means something. */
function sizeOf(e: JournalEntry, measure: (x: JournalEntry) => number): number {
  switch (e.k) {
    case 'add':
      return 80 + e.label.length * 2 + e.items.reduce((n, i) => n + 40 + persistSize(i.rec.p), 0);
    case 'remove':
      return 80 + e.label.length * 2 + e.items.reduce((n, i) => n + 40 + persistSize(i.persist), 0) + e.detached.length * 100;
    case 'sets':
      return 80 + e.label.length * 2 + e.changes.reduce((n, c) => n + persistSize(c.before) + persistSize(c.after), 0) + (e.reorder ? e.reorder.after.length * 8 : 0);
    case 'item':
      return 80 + e.item.text.length * 2 + (e.was ? e.was.text.length * 2 : 0);
    case 'group':
      return 40 + e.entries.reduce((n, x) => n + measure(x), 0);
  }
}

export function entryLabel(e: JournalEntry): string {
  return e.label;
}

export class Journal {
  readonly stack: JournalEntry[] = [];
  readonly redoStack: JournalEntry[] = [];
  /**
   * The group being collected. `depth` counts nested `begin` calls, so only the opener closes it. `redo` holds what an
   * `Undo()` inside the group took back, so a `Redo()` inside it replays only that; it is dropped when the group closes.
   */
  private open: { label: string; entries: JournalEntry[]; redo: JournalEntry[]; depth: number } | null = null;
  /** Where the entry the last `takeUndo` or `takeRedo` came from, so a faulty step can be put back. */
  private taken: { e: JournalEntry; dir: 'undo' | 'redo'; from: 'stack' | 'group' | 'open'; group?: JournalEntry & { k: 'group' } } | undefined;
  private dropped = 0;
  private bytes = 0;
  /** The size of each entry when it was first measured: a record can change later, the bytes must still add up. */
  private readonly sizes = new WeakMap<JournalEntry, number>();

  constructor(
    private capacity: number,
    private maxBytes: number,
  ) {}

  setCapacity(entries: number, bytes: number): void {
    this.capacity = entries;
    this.maxBytes = bytes;
    this.trim();
  }

  /**
   * Starts collecting the entries of several lines as one undo step. A nested call joins the open group and does not close
   * it. Returns the mark to give `abandon`: how many entries the group held before this call.
   */
  begin(label: string): number {
    if (!this.open) {
      this.open = { label, entries: [], redo: [], depth: 1 };
      return 0;
    }
    this.open.depth++;
    return this.open.entries.length;
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** Closes one level of the group. The outermost call closes it; an empty group leaves no step. Returns the entry made. */
  end(): JournalEntry | undefined {
    const g = this.open;
    if (!g) return undefined;
    g.depth--;
    if (g.depth > 0) return undefined;
    this.open = null;
    this.taken = undefined;
    if (g.entries.length === 0) return undefined;
    const entry: JournalEntry = g.entries.length === 1 && g.label === (g.entries[0] as JournalEntry).label ? (g.entries[0] as JournalEntry) : { k: 'group', label: g.label, entries: g.entries };
    this.push(entry);
    return entry;
  }

  /**
   * Gives up one level of the open group and returns the entries recorded since `mark`, newest last (the caller undoes
   * them). The group closes when its opener gives up.
   */
  abandon(mark = 0): JournalEntry[] {
    const g = this.open;
    if (!g) return [];
    const gone = g.entries.splice(mark);
    g.depth--;
    if (g.depth <= 0) {
      this.open = null;
      this.taken = undefined;
    }
    return gone;
  }

  /** A copy of both stacks, to restore after a rollback. */
  snapshot(): { stack: JournalEntry[]; redo: JournalEntry[] } {
    return { stack: [...this.stack], redo: [...this.redoStack] };
  }

  /** Puts both stacks back as `snapshot` saw them. */
  restore(snap: { stack: JournalEntry[]; redo: JournalEntry[] }): void {
    this.stack.length = 0;
    this.stack.push(...snap.stack);
    this.redoStack.length = 0;
    this.redoStack.push(...snap.redo);
    this.bytes = this.stack.reduce((n, e) => n + this.measure(e), 0);
  }

  /** True when `takeUndo` (or `takeRedo`) would find an entry: inside an open group only the group's own entries count. */
  canTake(dir: 'undo' | 'redo'): boolean {
    if (this.open) return (dir === 'undo' ? this.open.entries : this.open.redo).length > 0;
    return (dir === 'undo' ? this.stack : this.redoStack).length > 0;
  }

  /** Removes an entry that was just recorded (a rollback). Returns true when it was found at the end. */
  discard(e: JournalEntry): boolean {
    if (this.open) {
      const last = this.open.entries[this.open.entries.length - 1];
      if (last === e) {
        this.open.entries.pop();
        return true;
      }
      return false;
    }
    const top = this.stack[this.stack.length - 1];
    if (top === e) {
      this.stack.pop();
      this.bytes -= this.measure(e);
      return true;
    }
    return false;
  }

  /** The entries recorded in the open group so far. */
  get pending(): readonly JournalEntry[] {
    return this.open ? this.open.entries : [];
  }

  /** Records one accepted line. A new entry clears the redo stack. */
  record(e: JournalEntry): void {
    this.redoStack.length = 0;
    if (this.open) {
      this.open.redo.length = 0;
      this.open.entries.push(e);
    } else this.push(e);
  }

  private measure(e: JournalEntry): number {
    let n = this.sizes.get(e);
    if (n === undefined) {
      n = sizeOf(e, (x) => this.measure(x));
      this.sizes.set(e, n);
    }
    return n;
  }

  private push(e: JournalEntry): void {
    this.stack.push(e);
    this.bytes += this.measure(e);
    this.trim();
  }

  private trim(): void {
    while (this.stack.length > this.capacity || (this.bytes > this.maxBytes && this.stack.length > 1)) {
      const old = this.stack.shift() as JournalEntry;
      this.bytes -= this.measure(old);
      this.dropped++;
    }
  }

  /**
   * Takes the entry to undo: the whole top entry (`group`), or only the last line of it (`line`). Inside an open group it
   * is the group's last entry and nothing outside the group is touched (KERN-SM-9). The caller reverts it and then calls
   * `pushRedo` with what it took.
   */
  takeUndo(unit: 'group' | 'line'): JournalEntry | undefined {
    if (this.open) {
      const last = this.open.entries.pop();
      if (last) this.taken = { e: last, dir: 'undo', from: 'open' };
      return last;
    }
    const top = this.stack[this.stack.length - 1];
    if (!top) return undefined;
    if (unit === 'line' && top.k === 'group' && top.entries.length > 1) {
      const last = top.entries.pop() as JournalEntry;
      const n = this.measure(last);
      this.bytes -= n;
      this.sizes.set(top, this.measure(top) - n);
      this.taken = { e: last, dir: 'undo', from: 'group', group: top };
      return last;
    }
    this.stack.pop();
    this.bytes -= this.measure(top);
    this.taken = { e: top, dir: 'undo', from: 'stack' };
    return top;
  }

  pushRedo(e: JournalEntry): void {
    if (this.open) this.open.redo.push(e);
    else this.redoStack.push(e);
  }

  takeRedo(): JournalEntry | undefined {
    if (this.open) {
      const e = this.open.redo.pop();
      if (e) this.taken = { e, dir: 'redo', from: 'open' };
      return e;
    }
    const e = this.redoStack.pop();
    if (e) this.taken = { e, dir: 'redo', from: 'stack' };
    return e;
  }

  /** Puts a redone entry back on the undo stack without clearing the redo stack. */
  pushUndo(e: JournalEntry): void {
    if (this.open) this.open.entries.push(e);
    else this.push(e);
  }

  /**
   * Undoes `takeUndo` or `takeRedo` of `e` after its replay failed: the entry goes back where it came from (a line taken
   * out of a group goes back into the group).
   */
  putBack(e: JournalEntry): void {
    const t = this.taken;
    if (!t || t.e !== e) return;
    this.taken = undefined;
    if (t.dir === 'undo') {
      const redo = this.open ? this.open.redo : this.redoStack;
      if (redo[redo.length - 1] === e) redo.pop();
      if (t.from === 'open') (this.open as NonNullable<typeof this.open>).entries.push(e);
      else if (t.from === 'group') {
        const g = t.group as JournalEntry & { k: 'group' };
        g.entries.push(e);
        const n = this.measure(e);
        this.bytes += n;
        this.sizes.set(g, this.measure(g) + n);
      } else {
        this.stack.push(e);
        this.bytes += this.measure(e);
      }
    } else {
      if (t.from === 'open') {
        const g = this.open as NonNullable<typeof this.open>;
        if (g.entries[g.entries.length - 1] === e) g.entries.pop();
        g.redo.push(e);
      } else {
        if (this.stack[this.stack.length - 1] === e) {
          this.stack.pop();
          this.bytes -= this.measure(e);
        }
        this.redoStack.push(e);
      }
    }
  }

  info(): UndoInfo {
    const top = this.stack[this.stack.length - 1];
    return { depth: this.stack.length, redoDepth: this.redoStack.length, dropped: this.dropped, capacity: this.capacity, next: top?.label };
  }

  clear(): void {
    this.taken = undefined;
    this.stack.length = 0;
    this.redoStack.length = 0;
    this.open = null;
    this.bytes = 0;
  }
}
