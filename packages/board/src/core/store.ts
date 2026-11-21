/**
 * The store (design 4): records by id, and `change(origin, fn)`, the only way to write. The writes of one transaction
 * are staged, then every record is checked, the links between records and the limits are tested, and only then are
 * the records changed, together, and one diff goes to the listeners. A transaction that fails any test changes nothing.
 * The transaction's states are `TX_MACHINE` (docs/state-machines.md, B1). No DOM, no timers, no `Date`.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import { checkRecord } from './check';
import { boardError, describeThrown, ok, recordInvalid } from './errors';
import type { BoardError, BoardResult } from './errors';
import { KindRegistry } from './kinds/def';
import { DEFAULT_LIMITS, ORIGINS, RECORD_TYPES, isCamera, isPage, isShape, recordTypeOf } from './types';
import type { BoardRecord, Diff, Limits, Origin, RecordType, ShapeRecord, Update } from './types';

type TxState = 'idle' | 'open' | 'notifying' | 'nested';
type TxEvent = 'begin' | 'commit' | 'abort' | 'drained';

/** B1: the store is idle, a callback is writing (open), diffs are going out (notifying), or a listener writes (nested). */
export const TX_MACHINE: MachineTable<TxState, TxEvent> = {
  idle: { begin: 'open' },
  open: { commit: 'notifying', abort: 'idle' },
  notifying: { drained: 'idle', begin: 'nested' },
  nested: { commit: 'notifying', abort: 'notifying' },
};

type HandleState = 'live' | 'closed';

/** The `Tx` a callback holds works until the callback returns. */
export const HANDLE_MACHINE: MachineTable<HandleState, 'close'> = {
  live: { close: 'closed' },
  closed: {},
};

export interface ChangeOptions {
  /** False for a change that is not an undo step: camera, selection, pictures. Default true. */
  readonly history?: boolean;
  /** Writes in a row with the same key are one undo step: a stroke's samples, a drag's moves. */
  readonly mergeKey?: string;
  /** Keep shapes of kinds that are not registered, as they are (load, undo of a delete). */
  readonly allowUnknownKinds?: boolean;
}

export interface Changed<T> {
  /** What the callback returned. */
  readonly value: T;
  /** What the transaction changed; empty when it changed nothing (no listener was called). */
  readonly diff: Diff;
}

/** The handle `change` gives its callback. A write that fails fails the whole transaction. */
export interface Tx {
  /** A record as this transaction sees it: its own writes first. */
  get(id: string): BoardRecord | undefined;
  /** Adds the record, or replaces the one with the same id. */
  put(record: BoardRecord): BoardResult<BoardRecord>;
  /**
   * Changes fields of a record. `props` and `meta` in the patch are merged into the old ones, one level deep; every
   * other field is replaced. The id cannot change.
   */
  update(id: string, patch: Readonly<Record<string, unknown>>): BoardResult<BoardRecord>;
  /** Removes the record and gives it back. */
  remove(id: string): BoardResult<BoardRecord>;
  /** An id nobody uses yet: `shape:1`, `shape:2`, … from a counter, so the same steps give the same ids. */
  newId(type: RecordType): string;
}

export type StoreListener = (diff: Diff) => void;

export interface StoreOptions {
  readonly kinds?: KindRegistry;
  readonly limits?: Partial<Limits>;
  /** Called with what a listener threw. */
  readonly onError?: (error: BoardError) => void;
}

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);

function sameRecord(a: BoardRecord, b: BoardRecord): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  for (const k of ka) if (!Object.is(x[k], y[k])) return false;
  return true;
}

const thousands = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

class StagedTx implements Tx {
  readonly #handle = new StateMachine(HANDLE_MACHINE, 'live');
  readonly staged = new Map<string, BoardRecord | null>();
  failure: BoardError | undefined;

  constructor(
    private readonly store: Store,
    private readonly options: ChangeOptions,
  ) {}

  close(): void {
    this.#handle.send('close');
  }

  #fail(error: BoardError): BoardError {
    this.failure ??= error;
    return error;
  }

  #closedError(): BoardError {
    return this.#fail(boardError('bad_argument', 'This transaction has ended; start another with change().', { detail: { field: 'tx' } }));
  }

  get(id: string): BoardRecord | undefined {
    if (this.staged.has(id)) return this.staged.get(id) ?? undefined;
    return this.store.get(id);
  }

  put(record: BoardRecord): BoardResult<BoardRecord> {
    if (!this.#handle.is('live')) return this.#closedError();
    const checked = checkRecord(record, this.store.kinds, { allowUnknownKinds: this.options.allowUnknownKinds === true });
    if (!checked.ok) return this.#fail(checked);
    this.staged.set(checked.value.id, checked.value);
    return checked;
  }

  update(id: string, patch: Readonly<Record<string, unknown>>): BoardResult<BoardRecord> {
    if (!this.#handle.is('live')) return this.#closedError();
    const current = this.get(id);
    if (current === undefined) return this.#fail(boardError('bad_argument', `There is no record "${id}" to change.`, { detail: { record: id } }));
    if (!isPlain(patch)) return this.#fail(recordInvalid(id, 'record', 'A patch must be an object.'));
    if ('id' in patch && patch['id'] !== id) return this.#fail(recordInvalid(id, 'id', 'The id of a record cannot change.'));
    const base = current as unknown as Record<string, unknown>;
    const next: Record<string, unknown> = { ...base, ...patch };
    for (const field of ['props', 'meta']) {
      const was = base[field];
      const now = patch[field];
      if (field in patch && isPlain(was) && isPlain(now)) next[field] = { ...was, ...now };
    }
    return this.put(next as unknown as BoardRecord);
  }

  remove(id: string): BoardResult<BoardRecord> {
    if (!this.#handle.is('live')) return this.#closedError();
    const current = this.get(id);
    if (current === undefined) return this.#fail(boardError('bad_argument', `There is no record "${id}" to remove.`, { detail: { record: id } }));
    this.staged.set(id, null);
    return ok(current);
  }

  newId(type: RecordType): string {
    for (;;) {
      const id = this.store.mintId(type);
      if (!this.staged.has(id)) return id;
    }
  }
}

export class Store {
  readonly kinds: KindRegistry;
  readonly limits: Limits;

  readonly #records = new Map<string, BoardRecord>();
  readonly #byType: Readonly<Record<RecordType, Map<string, BoardRecord>>> = {
    shape: new Map(),
    page: new Map(),
    camera: new Map(),
    binding: new Map(),
    asset: new Map(),
  };
  /** Shape ids of each page, and the ink points of each page: kept up to date for the limits. */
  readonly #shapesByPage = new Map<string, Set<string>>();
  readonly #pointsByPage = new Map<string, number>();
  #assetBytes = 0;
  #serial = 0;

  readonly #machine = new StateMachine(TX_MACHINE, 'idle');
  readonly #queue: Diff[] = [];
  #listeners: readonly StoreListener[] = [];
  readonly #onError: ((error: BoardError) => void) | undefined;

  constructor(options: StoreOptions = {}) {
    this.kinds = options.kinds ?? new KindRegistry();
    const limits: Record<string, number> = { ...DEFAULT_LIMITS };
    for (const [key, value] of Object.entries(options.limits ?? {})) {
      if (key in limits && typeof value === 'number' && Number.isFinite(value) && value >= 0) limits[key] = value;
    }
    this.limits = Object.freeze(limits as unknown as Limits);
    this.#onError = options.onError;
  }

  // reading

  get(id: string): BoardRecord | undefined {
    return this.#records.get(id);
  }

  has(id: string): boolean {
    return this.#records.has(id);
  }

  /** The number of records. */
  get size(): number {
    return this.#records.size;
  }

  /**
   * Every record, or the ones of one kind: a record type (`'page'`, `'shape'`, …) or a kind name (`'rect'`, `'ink'`),
   * which gives the shapes and bindings of that kind. A new array each call, in the order the records were added.
   */
  all(kind?: string): readonly BoardRecord[] {
    if (kind === undefined) return [...this.#records.values()];
    if ((RECORD_TYPES as readonly string[]).includes(kind)) return [...this.#byType[kind as RecordType].values()];
    const out: BoardRecord[] = [];
    for (const r of this.#byType.shape.values()) if ((r as ShapeRecord).kind === kind) out.push(r);
    for (const r of this.#byType.binding.values()) if ((r as { kind: string }).kind === kind) out.push(r);
    return out;
  }

  /** The shapes of one page, in the order they were added. */
  shapesOn(page: string): readonly ShapeRecord[] {
    const out: ShapeRecord[] = [];
    for (const id of this.#shapesByPage.get(page) ?? []) {
      const r = this.#records.get(id);
      if (r !== undefined) out.push(r as ShapeRecord);
    }
    return out;
  }

  /** How many shapes a page holds. */
  shapeCount(page: string): number {
    return this.#shapesByPage.get(page)?.size ?? 0;
  }

  /** How many ink points a page holds. */
  inkPoints(page: string): number {
    return this.#pointsByPage.get(page) ?? 0;
  }

  /** The bytes of every asset. */
  get assetBytes(): number {
    return this.#assetBytes;
  }

  /** The next id of a type that no record uses. */
  mintId(type: RecordType): string {
    for (;;) {
      const id = `${type}:${(++this.#serial).toString(36)}`;
      if (!this.#records.has(id)) return id;
    }
  }

  // listening

  /** Calls `listener` with every committed diff, in order. Returns the function that stops it. */
  on(listener: StoreListener): () => void {
    this.#listeners = [...this.#listeners, listener];
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  // writing

  /**
   * Runs `fn` with a `Tx`, then applies all its writes together and sends one diff. Returns what `fn` returned and
   * the diff. When a record fails its check, a link or a limit fails, or `fn` throws, nothing is applied and the error
   * is returned. A listener may call `change` (its transaction is applied at once and its diff follows); `fn` may not.
   */
  change<T>(origin: Origin, fn: (tx: Tx) => T, options: ChangeOptions = {}): BoardResult<Changed<T>> {
    if (!ORIGINS.includes(origin)) return boardError('bad_argument', `"${String(origin)}" is not an origin.`, { detail: { origin: String(origin) } });
    if (typeof fn !== 'function') return boardError('bad_argument', 'change() needs a function.', { detail: { field: 'fn' } });
    const owner = this.#machine.is('idle');
    if (!this.#machine.send('begin')) {
      return boardError('bad_argument', 'A change is already open; write through its tx instead of starting another.', { detail: { field: 'change' } });
    }
    const tx = new StagedTx(this, options);
    let value: T;
    try {
      value = fn(tx);
    } catch (e) {
      tx.close();
      this.#machine.send('abort');
      return boardError('internal', `A change function threw: ${describeThrown(e)}`, { detail: { origin } });
    }
    tx.close();
    if (tx.failure !== undefined) {
      this.#machine.send('abort');
      return tx.failure;
    }
    const diff = this.#diffOf(origin, tx.staged, options);
    const refused = this.#verify(diff, tx.staged);
    if (refused !== undefined) {
      this.#machine.send('abort');
      return refused;
    }
    this.#apply(diff);
    this.#machine.send('commit');
    if (diff.added.length + diff.updated.length + diff.removed.length > 0) this.#queue.push(diff);
    if (owner) this.#pump();
    return ok({ value, diff });
  }

  /** The net effect of the staged writes on the committed records. */
  #diffOf(origin: Origin, staged: ReadonlyMap<string, BoardRecord | null>, options: ChangeOptions): Diff {
    const added: BoardRecord[] = [];
    const updated: Update[] = [];
    const removed: BoardRecord[] = [];
    for (const [id, next] of staged) {
      const prev = this.#records.get(id);
      if (next === null) {
        if (prev !== undefined) removed.push(prev);
      } else if (prev === undefined) {
        added.push(next);
      } else if (prev !== next && !sameRecord(prev, next)) {
        updated.push({ before: prev, after: next });
      }
    }
    return Object.freeze({
      origin,
      added: Object.freeze(added),
      updated: Object.freeze(updated),
      removed: Object.freeze(removed),
      history: options.history !== false,
      mergeKey: options.mergeKey ?? null,
    });
  }

  /** Tests the links between records and the limits on the records as they would be. Returns the first problem. */
  #verify(diff: Diff, staged: ReadonlyMap<string, BoardRecord | null>): BoardError | undefined {
    const after = (id: string): BoardRecord | undefined => (staged.has(id) ? (staged.get(id) ?? undefined) : this.#records.get(id));

    // links: a shape and a camera need their page; a page that goes needs no shape or camera left
    const linked = [...diff.added, ...diff.updated.map((u) => u.after)];
    for (const r of linked) {
      if (!isShape(r) && !isCamera(r)) continue;
      const page = after(r.page);
      if (page === undefined || !isPage(page)) {
        return recordInvalid(r.id, 'page', `The ${isShape(r) ? 'shape' : 'camera'} "${r.id}" is on "${r.page}", which is not a page of this board.`, 'Add the page in the same change, or use a page that exists.');
      }
    }
    for (const r of diff.removed) {
      if (!isPage(r)) continue;
      for (const sid of this.#shapesByPage.get(r.id) ?? []) {
        if (after(sid) !== undefined) {
          return recordInvalid(sid, 'page', `The page "${r.id}" cannot go while the shape "${sid}" is on it.`, 'Remove its shapes in the same change.');
        }
      }
      for (const c of this.#byType.camera.values()) {
        if ((c as { page: string }).page === r.id && after(c.id) !== undefined) {
          return recordInvalid(c.id, 'page', `The page "${r.id}" cannot go while the camera "${c.id}" is saved for it.`, 'Remove its camera in the same change.');
        }
      }
    }

    // limits: only what grows is tested, so a transaction that removes things is never refused
    let pages = 0;
    let assets = 0;
    const shapes = new Map<string, number>();
    const points = new Map<string, number>();
    const count = (r: BoardRecord, sign: 1 | -1): void => {
      if (isShape(r)) {
        shapes.set(r.page, (shapes.get(r.page) ?? 0) + sign);
        const n = this.#pointsOf(r);
        if (n !== 0) points.set(r.page, (points.get(r.page) ?? 0) + sign * n);
      } else if (isPage(r)) {
        pages += sign;
      } else if (recordTypeOf(r.id) === 'asset') {
        assets += sign * (r as { size: number }).size;
      }
    };
    for (const r of diff.added) count(r, 1);
    for (const r of diff.removed) count(r, -1);
    for (const u of diff.updated) {
      count(u.before, -1);
      count(u.after, 1);
    }
    const { limits } = this;
    if (pages > 0 && this.#byType.page.size + pages > limits.pages) {
      return boardError('limit', `This board has ${thousands(limits.pages)} pages, which is the limit.`, {
        hint: 'Remove a page you do not need.',
        detail: { limit: limits.pages, what: 'pages' },
      });
    }
    for (const [page, d] of shapes) {
      if (d > 0 && this.shapeCount(page) + d > limits.shapesPerPage) {
        return boardError('limit', `This page has ${thousands(limits.shapesPerPage)} shapes, which is the limit.`, {
          hint: 'Add a page, or group strokes into a frame on a new page.',
          detail: { page, limit: limits.shapesPerPage, what: 'shapes' },
        });
      }
    }
    for (const [page, d] of points) {
      if (d > 0 && this.inkPoints(page) + d > limits.inkPointsPerPage) {
        return boardError('limit', `This page has ${thousands(limits.inkPointsPerPage)} ink points, which is the limit.`, {
          hint: 'Add a page.',
          detail: { page, limit: limits.inkPointsPerPage, what: 'ink points' },
        });
      }
    }
    if (assets > 0 && this.#assetBytes + assets > limits.assetBytes) {
      return boardError('limit', `The images of this board are ${thousands(limits.assetBytes)} bytes, which is the limit.`, {
        hint: 'Remove an image you no longer use.',
        detail: { limit: limits.assetBytes, what: 'asset bytes' },
      });
    }
    return undefined;
  }

  #pointsOf(r: ShapeRecord): number {
    const def = this.kinds.get(r.kind);
    if (def?.points === undefined) return 0;
    try {
      const n = def.points(r.props);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  }

  #apply(diff: Diff): void {
    for (const r of diff.removed) this.#drop(r);
    for (const u of diff.updated) {
      this.#unindex(u.before);
      this.#set(u.after);
    }
    for (const r of diff.added) this.#set(r);
  }

  #drop(r: BoardRecord): void {
    this.#unindex(r);
    this.#records.delete(r.id);
    const type = recordTypeOf(r.id);
    if (type !== undefined) this.#byType[type].delete(r.id);
  }

  #set(r: BoardRecord): void {
    this.#records.set(r.id, r);
    const type = recordTypeOf(r.id);
    if (type !== undefined) this.#byType[type].set(r.id, r);
    if (isShape(r)) {
      let ids = this.#shapesByPage.get(r.page);
      if (ids === undefined) this.#shapesByPage.set(r.page, (ids = new Set()));
      ids.add(r.id);
      const n = this.#pointsOf(r);
      if (n !== 0) this.#pointsByPage.set(r.page, (this.#pointsByPage.get(r.page) ?? 0) + n);
    } else if (recordTypeOf(r.id) === 'asset') {
      this.#assetBytes += (r as { size: number }).size;
    }
  }

  #unindex(r: BoardRecord): void {
    if (isShape(r)) {
      const ids = this.#shapesByPage.get(r.page);
      ids?.delete(r.id);
      if (ids?.size === 0) this.#shapesByPage.delete(r.page);
      const n = this.#pointsOf(r);
      if (n !== 0) {
        const left = (this.#pointsByPage.get(r.page) ?? 0) - n;
        if (left > 0) this.#pointsByPage.set(r.page, left);
        else this.#pointsByPage.delete(r.page);
      }
    } else if (recordTypeOf(r.id) === 'asset') {
      this.#assetBytes -= (r as { size: number }).size;
    }
  }

  /** Delivers the queued diffs in order; a listener's own change adds to the queue and is delivered after. */
  #pump(): void {
    for (let diff = this.#queue.shift(); diff !== undefined; diff = this.#queue.shift()) {
      for (const listener of this.#listeners) {
        try {
          listener(diff);
        } catch (e) {
          this.#report(boardError('internal', `A listener threw: ${describeThrown(e)}`, { detail: { origin: diff.origin } }));
        }
      }
    }
    this.#machine.send('drained');
  }

  #report(error: BoardError): void {
    try {
      this.#onError?.(error);
    } catch {
      // the host's error handler failed; there is nobody left to tell
    }
  }
}
