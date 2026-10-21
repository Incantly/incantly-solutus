/**
 * Undo and redo of the learner's own changes (CT-5). A drag or one run of
 * slider input is one entry: changes to the same parameters close together
 * in time merge into the entry before them.
 */

export interface HistoryEntry {
  readonly before: Readonly<Record<string, number>>;
  after: Record<string, number>;
  at: number;
  /** Closed entries never merge: a drag ended, or an undo happened. */
  closed: boolean;
}

export const MERGE_MS = 700;
const MAX_ENTRIES = 50;

export class History {
  private readonly past: HistoryEntry[] = [];
  private readonly future: HistoryEntry[] = [];

  constructor(private readonly now: () => number) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Records a change from `before` to `after` (the values of the parameters it touched). */
  record(before: Readonly<Record<string, number>>, after: Readonly<Record<string, number>>, close = false): void {
    const names = Object.keys(after);
    if (names.length === 0 || names.every((name) => before[name] === after[name])) return;
    this.future.length = 0;
    const at = this.now();
    const last = this.past.at(-1);
    const sameNames = last && !last.closed && names.every((name) => name in last.after) && Object.keys(last.after).every((name) => name in after);
    if (last && sameNames && at - last.at <= MERGE_MS) {
      Object.assign(last.after, after);
      last.at = at;
      if (close) last.closed = true;
      // A run of changes that ends where it began undoes nothing.
      if (Object.keys(last.before).every((name) => last.before[name] === last.after[name])) this.past.pop();
      return;
    }
    this.past.push({ before: { ...before }, after: { ...after }, at, closed: close });
    if (this.past.length > MAX_ENTRIES) this.past.shift();
  }

  /** Ends merging into the latest entry. */
  close(): void {
    const last = this.past.at(-1);
    if (last) last.closed = true;
  }

  /** The values to go back to, or null. */
  undo(): Readonly<Record<string, number>> | null {
    const entry = this.past.pop();
    if (!entry) return null;
    entry.closed = true;
    this.future.push(entry);
    return entry.before;
  }

  redo(): Readonly<Record<string, number>> | null {
    const entry = this.future.pop();
    if (!entry) return null;
    this.past.push(entry);
    return entry.after;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}
