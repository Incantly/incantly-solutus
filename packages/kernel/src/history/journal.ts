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

function sizeOf(e: JournalEntry): number {
  switch (e.k) {
    case 'add':
      return 80 + e.items.length * 120;
    case 'remove':
      return 80 + e.items.length * 200 + e.detached.length * 100;
    case 'sets':
      return 80 + e.changes.length * 200 + (e.reorder ? e.reorder.after.length * 8 : 0);
    case 'item':
      return 80 + e.item.text.length * 2;
    case 'group':
      return 40 + e.entries.reduce((n, x) => n + sizeOf(x), 0);
  }
}

export function entryLabel(e: JournalEntry): string {
  return e.label;
}

export class Journal {
  readonly stack: JournalEntry[] = [];
  readonly redoStack: JournalEntry[] = [];
  private open: { label: string; entries: JournalEntry[] } | null = null;
  private dropped = 0;
  private bytes = 0;

  constructor(
    private capacity: number,
    private maxBytes: number,
  ) {}

  setCapacity(entries: number, bytes: number): void {
    this.capacity = entries;
    this.maxBytes = bytes;
    this.trim();
  }

  /** Starts collecting the entries of several lines as one undo step. Nested groups join the outer one. */
  begin(label: string): void {
    if (!this.open) this.open = { label, entries: [] };
  }

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** Closes the group. An empty group leaves no step. Returns the group entry when one was made. */
  end(): JournalEntry | undefined {
    const g = this.open;
    this.open = null;
    if (!g || g.entries.length === 0) return undefined;
    const entry: JournalEntry = g.entries.length === 1 && g.label === (g.entries[0] as JournalEntry).label ? (g.entries[0] as JournalEntry) : { k: 'group', label: g.label, entries: g.entries };
    this.push(entry);
    return entry;
  }

  /** Throws the open group away and returns its entries, newest last (the caller undoes them). */
  abandon(): JournalEntry[] {
    const g = this.open;
    this.open = null;
    return g ? g.entries : [];
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
      this.bytes -= sizeOf(e);
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
    if (this.open) this.open.entries.push(e);
    else this.push(e);
  }

  private push(e: JournalEntry): void {
    this.stack.push(e);
    this.bytes += sizeOf(e);
    this.trim();
  }

  private trim(): void {
    while (this.stack.length > this.capacity || (this.bytes > this.maxBytes && this.stack.length > 1)) {
      const old = this.stack.shift() as JournalEntry;
      this.bytes -= sizeOf(old);
      this.dropped++;
    }
  }

  /**
   * Takes the entry to undo: the whole top entry (`group`), or only the last line of it (`line`).
   * The caller reverts it and then calls `pushRedo` with what it took.
   */
  takeUndo(unit: 'group' | 'line'): JournalEntry | undefined {
    const top = this.stack[this.stack.length - 1];
    if (!top) return undefined;
    if (unit === 'line' && top.k === 'group' && top.entries.length > 1) {
      const last = top.entries.pop() as JournalEntry;
      this.bytes -= sizeOf(last);
      return last;
    }
    this.stack.pop();
    this.bytes -= sizeOf(top);
    return top;
  }

  pushRedo(e: JournalEntry): void {
    this.redoStack.push(e);
  }

  takeRedo(): JournalEntry | undefined {
    return this.redoStack.pop();
  }

  /** Puts a redone entry back on the undo stack without clearing the redo stack. */
  pushUndo(e: JournalEntry): void {
    this.push(e);
  }

  info(): UndoInfo {
    const top = this.stack[this.stack.length - 1];
    return { depth: this.stack.length, redoDepth: this.redoStack.length, dropped: this.dropped, capacity: this.capacity, next: top?.label };
  }

  clear(): void {
    this.stack.length = 0;
    this.redoStack.length = 0;
    this.open = null;
    this.bytes = 0;
  }
}
