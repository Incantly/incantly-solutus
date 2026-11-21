/**
 * Undo and redo (design 4). One stack per document. A transaction is one step unless it was made with
 * `history: false`; writes in a row with the same `mergeKey` are one step, so a stroke's samples or a drag's moves
 * undo together. A step holds, for each record it changed, the record before and after, so undo and redo write them
 * back as one transaction. The history's states are `HISTORY_MACHINE` (docs/state-machines.md, B2).
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { boardError, ok, refusedMove } from './errors';
import type { BoardResult } from './errors';
import type { Store } from './store';
import type { BoardRecord, Diff, Origin } from './types';

type HistoryState = 'recording' | 'undoing' | 'redoing';
type HistoryEvent = 'undo' | 'redo' | 'done';

export const HISTORY_MACHINE: MachineTable<HistoryState, HistoryEvent> = {
  recording: { undo: 'undoing', redo: 'redoing' },
  undoing: { done: 'recording' },
  redoing: { done: 'recording' },
};

export interface HistoryOptions {
  /** The most undo steps kept; the oldest go first. Default 1,000. */
  readonly maxSteps?: number;
}

/** The record as it was and as it became; `undefined` is "no such record". */
interface Entry {
  before: BoardRecord | undefined;
  after: BoardRecord | undefined;
}

interface Step {
  readonly entries: Map<string, Entry>;
  mergeKey: string | null;
}

const DEFAULT_MAX_STEPS = 1000;

/** True when two values are the same number, string or object with the same fields and the same bytes in its typed arrays. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const k of keys) if (!Object.hasOwn(y, k) || !sameValue(x[k], y[k])) return false;
  return true;
}

export type HistoryListener = () => void;

export class History {
  readonly #store: Store;
  readonly #machine = new StateMachine(HISTORY_MACHINE, 'recording', refusedMove('history', () => this.#store.sink));
  readonly #undo: Step[] = [];
  readonly #redo: Step[] = [];
  readonly #maxSteps: number;
  #listeners: readonly HistoryListener[] = [];
  readonly #stop: () => void;

  constructor(store: Store, options: HistoryOptions = {}) {
    this.#store = store;
    const max = options.maxSteps;
    this.#maxSteps = typeof max === 'number' && Number.isInteger(max) && max > 0 ? max : DEFAULT_MAX_STEPS;
    this.#stop = store.on((diff) => this.#record(diff));
  }

  /** Stops listening to the store. */
  dispose(): void {
    this.#stop();
    this.#listeners = [];
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  /** The number of undo steps. */
  get undoSteps(): number {
    return this.#undo.length;
  }

  get redoSteps(): number {
    return this.#redo.length;
  }

  /** Calls `listener` after every change to the stacks. Returns the function that stops it. */
  on(listener: HistoryListener): () => void {
    this.#listeners = [...this.#listeners, listener];
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  /** The next write with a merge key starts a new step even when its key matches the last one. */
  seal(): void {
    const top = this.#undo[this.#undo.length - 1];
    if (top !== undefined) top.mergeKey = null;
  }

  /** Forgets every step. */
  clear(): void {
    if (this.#undo.length === 0 && this.#redo.length === 0) return;
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#notify();
  }

  /** Writes back the last step. Returns the diff of that write, or `nothing_to_undo`. */
  undo(origin: Origin = 'user'): BoardResult<Diff> {
    return this.#replay('undo', origin);
  }

  redo(origin: Origin = 'user'): BoardResult<Diff> {
    return this.#replay('redo', origin);
  }

  #replay(event: 'undo' | 'redo', origin: Origin): BoardResult<Diff> {
    const from = event === 'undo' ? this.#undo : this.#redo;
    const step = from[from.length - 1];
    if (step === undefined) {
      return boardError('nothing_to_undo', event === 'undo' ? 'Nothing to undo.' : 'Nothing to redo.', { detail: { direction: event } });
    }
    if (!this.#machine.send(event)) {
      return boardError('bad_argument', `${event === 'undo' ? 'Undo' : 'Redo'} cannot start while another one is running.`, { detail: { field: event } });
    }
    // the stacks move first, so a listener of the write already sees them as they will be; a refusal moves them back
    const to = event === 'undo' ? this.#redo : this.#undo;
    from.pop();
    to.push(step);
    const result = this.#store.change(
      origin,
      (tx) => {
        for (const [id, entry] of step.entries) {
          const target = event === 'undo' ? entry.before : entry.after;
          if (target === undefined) tx.remove(id);
          else tx.put(target);
        }
      },
      { history: false, allowUnknownKinds: true },
    );
    this.#machine.send('done');
    if (!result.ok) {
      to.pop();
      from.push(step);
      return result;
    }
    step.mergeKey = null;
    this.#notify();
    return ok(result.value.diff);
  }

  #record(diff: Diff): void {
    if (!diff.history || !this.#machine.is('recording')) return;
    const top = this.#undo[this.#undo.length - 1];
    const merges = top !== undefined && diff.mergeKey !== null && top.mergeKey === diff.mergeKey;
    const step: Step = merges ? top : { entries: new Map(), mergeKey: diff.mergeKey };
    const note = (id: string, before: BoardRecord | undefined, after: BoardRecord | undefined): void => {
      const entry = step.entries.get(id);
      if (entry === undefined) step.entries.set(id, { before, after });
      else entry.after = after;
    };
    for (const r of diff.added) note(r.id, undefined, r);
    for (const u of diff.updated) note(u.after.id, u.before, u.after);
    for (const r of diff.removed) note(r.id, r, undefined);
    // a record that was added and removed inside one merged step, or ended as it began, is no part of the step; a record
    // a write put back (a cancelled gesture) is a new object with the same values, so the records this write touched
    // are compared by value
    for (const [id, entry] of step.entries) {
      if (entry.before === entry.after) step.entries.delete(id);
    }
    if (merges) {
      for (const r of [...diff.added, ...diff.updated.map((u) => u.after)]) {
        const entry = step.entries.get(r.id);
        if (entry?.before !== undefined && entry.after !== undefined && sameValue(entry.before, entry.after)) step.entries.delete(r.id);
      }
    }
    this.#redo.length = 0;
    if (!merges) {
      if (step.entries.size === 0) return;
      this.#undo.push(step);
      if (this.#undo.length > this.#maxSteps) this.#undo.shift();
    } else if (step.entries.size === 0) {
      this.#undo.pop();
    }
    this.#notify();
  }

  #notify(): void {
    for (const l of this.#listeners) {
      try {
        l();
      } catch {
        // a listener's failure does not stop the history
      }
    }
  }
}
