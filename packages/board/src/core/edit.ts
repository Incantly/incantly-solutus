/**
 * The editing commands of the board (design 7.4): move, resize and turn writes, delete, align, distribute, order,
 * group, ungroup, lock, flip, style. Each command is one transaction, so it is one undo step, and every write to a
 * shape also moves the arrows stuck to it (`core/bindings.ts`). Locked shapes are never changed except by `setLocked`.
 * Commands take the ids of the shapes to change; a group or frame brings its members along. A drag writes its commands
 * through a `Gesture` (`beginGesture`), which keeps what every write changed so a cancel can put it all back (B25).
 * No DOM, no timers.
 */
import { StateMachine } from '@incantly/kernel';
import { sendIfAble } from './machine';
import type { MachineTable } from '@incantly/kernel';
import { dropBindingsOf, followBindings } from './bindings';
import type { BoardCore } from './board';
import type { BoardResult } from './errors';
import { boardError, ok, refusedMove } from './errors';
import { keyBetween } from './fractional';
import { shapeGeometry } from './geometry';
import type { StylePatch } from './kinds/def';
import { boxCx, boxCy, rotateAbout, wrapAngle } from './math2d';
import { bottomKey, descendantsOf, expandGroups, frameAt, keyOnTop, shapeOf, stackOf, txShape } from './shapes';
import type { Store, Tx } from './store';
import type { BoardRecord, Bounds, Origin, ShapeRecord } from './types';

/** A change to one shape. `props` is merged into the shape's props (the kind checks the result). */
export interface ShapePatch {
  readonly x?: number;
  readonly y?: number;
  readonly rotation?: number;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly parent?: string | null;
  readonly index?: string;
  readonly locked?: boolean;
}

export interface WriteOptions {
  readonly origin?: Origin;
  /** Writes in a row with the same key are one undo step (a drag). */
  readonly mergeKey?: string;
  /** The gesture the write belongs to: it supplies the origin and the merge key, and a cancel puts the write back. */
  readonly gesture?: Gesture;
}

type GestureState = 'open' | 'committed' | 'cancelled';
type GestureEvent = 'write' | 'commit' | 'cancel';

/** B25: a gesture takes writes until it is committed or cancelled; both end it, and a later write is refused. */
export const GESTURE_MACHINE: MachineTable<GestureState, GestureEvent> = {
  open: { write: 'open', commit: 'committed', cancel: 'cancelled' },
  committed: {},
  cancelled: {},
};

/** One gesture count for each store, so every gesture of a board has a merge key of its own. */
const gestureCount = new WeakMap<Store, number>();

/**
 * The writes of one pointer gesture (a drag, a resize, a stroke of the shape tool). Every write is one store
 * transaction with the gesture's merge key, so the whole gesture is one undo step. The gesture keeps what each record
 * was before its first write, read from the store's own diffs, so `cancel` puts back every record any write changed:
 * the shapes, the bindings they dragged, the arrows that followed them. A tool never has to list what to restore.
 */
export class Gesture {
  readonly #core: BoardCore;
  readonly #origin: Origin;
  readonly #key: string;
  readonly #machine = new StateMachine(GESTURE_MACHINE, 'open', refusedMove('gesture', () => this.#core.store.sink));
  /** Each record a write changed, as it was before the gesture (`undefined`: the gesture added it). */
  readonly #before = new Map<string, BoardRecord | undefined>();
  #writes = 0;

  constructor(core: BoardCore, origin: Origin) {
    this.#core = core;
    this.#origin = origin;
    const n = (gestureCount.get(core.store) ?? 0) + 1;
    gestureCount.set(core.store, n);
    this.#key = `gesture:${n}`;
  }

  /** The merge key of every write of this gesture. */
  get mergeKey(): string {
    return this.#key;
  }

  /** The gesture's own state: `open`, `committed` or `cancelled`. */
  get state(): string {
    return this.#machine.state;
  }

  /** The writes that were accepted so far. */
  get writes(): number {
    return this.#writes;
  }

  /** Runs `fn` as one transaction of this gesture. A refused write changes nothing and is not counted. */
  write<T>(fn: (tx: Tx) => T): BoardResult<T> {
    if (!this.#machine.send('write')) return boardError('bad_argument', 'This gesture has ended; begin another with beginGesture().', { detail: { field: 'gesture' } });
    const done = this.#core.store.change(this.#origin, fn, { mergeKey: this.#key });
    if (!done.ok) return done;
    const { diff } = done.value;
    for (const r of diff.added) if (!this.#before.has(r.id)) this.#before.set(r.id, undefined);
    for (const u of diff.updated) if (!this.#before.has(u.before.id)) this.#before.set(u.before.id, u.before);
    for (const r of diff.removed) if (!this.#before.has(r.id)) this.#before.set(r.id, r);
    // a person's drag moves its shapes on the overlay until it ends (BR-82); the model's writes are drawn by its hand
    if (this.#origin === 'user') this.#core.lift.take(diff);
    this.#writes++;
    return ok(done.value.value);
  }

  /** The gesture is finished: its writes stay, and the next write with any key starts a new undo step. */
  commit(): void {
    if (!sendIfAble(this.#machine, 'commit')) return;
    this.#core.history.seal();
    if (this.#origin === 'user') this.#core.lift.release();
  }

  /** The gesture is dropped: every record any write changed is put back, and the undo step it made is gone. */
  cancel(): void {
    if (!this.#machine.send('cancel')) return;
    if (this.#before.size > 0) {
      const before = this.#before;
      // the same merge key, so the step holds no change and the history drops it
      this.#core.store.change(
        this.#origin,
        (tx) => {
          for (const [id, record] of before) {
            if (record !== undefined) tx.put(record);
            else if (tx.get(id) !== undefined) tx.remove(id);
          }
        },
        { mergeKey: this.#key, allowUnknownKinds: true },
      );
    }
    this.#core.history.seal();
    if (this.#origin === 'user') this.#core.lift.release();
  }
}

/** Starts a gesture on the board. Write through it, then `commit` or `cancel`. */
export function beginGesture(core: BoardCore, origin: Origin = 'user'): Gesture {
  return new Gesture(core, origin);
}

/** One write of a command: through its gesture when it has one, else one transaction with its own origin and merge key. */
function writeVia<T>(core: BoardCore, options: WriteOptions, fn: (tx: Tx) => T): BoardResult<T> {
  if (options.gesture !== undefined) return options.gesture.write(fn);
  const done = core.store.change(options.origin ?? 'user', fn, options.mergeKey !== undefined ? { mergeKey: options.mergeKey } : {});
  return done.ok ? ok(done.value.value) : done;
}

/** The shapes among `ids` that are on the board, with a frame's or group's members, each once. */
export function withMembers(core: BoardCore, ids: readonly string[]): ShapeRecord[] {
  const page = core.pages.current;
  const out = new Map<string, ShapeRecord>();
  const first: ShapeRecord[] = [];
  for (const id of ids) {
    const s = shapeOf(core.store, id);
    if (s !== undefined) first.push(s);
  }
  for (const s of first) out.set(s.id, s);
  if (page !== null) {
    for (const id of descendantsOf(core.store, page, first.map((s) => s.id))) {
      const s = shapeOf(core.store, id);
      if (s !== undefined) out.set(id, s);
    }
  }
  return [...out.values()];
}

/** The page box of a shape's own box (without the pad of its line): what align, distribute and snap use. */
export function layoutBox(core: BoardCore, shape: ShapeRecord): Bounds | undefined {
  const g = shapeGeometry(shape, core.store.kinds);
  if (g === undefined) return undefined;
  const xs = [g.corners[0], g.corners[2], g.corners[4], g.corners[6]] as number[];
  const ys = [g.corners[1], g.corners[3], g.corners[5], g.corners[7]] as number[];
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * Writes the patches in one transaction, then moves the arrows stuck to the shapes that changed. A locked shape is
 * skipped unless the patch only sets `locked`. Nothing is written when any write is refused.
 */
export function patchShapes(core: BoardCore, patches: ReadonlyMap<string, ShapePatch>, options: WriteOptions = {}): BoardResult<undefined> {
  if (patches.size === 0) return ok(undefined);
  const { store } = core;
  const changed = new Set<string>();
  const written = writeVia(
    core,
    options,
    (tx) => {
      for (const [id, patch] of patches) {
        const shape = txShape(tx, id);
        if (shape === undefined) continue;
        const onlyLock = patch.locked !== undefined && Object.keys(patch).length === 1;
        if (shape.locked && !onlyLock) continue;
        const fields: Record<string, unknown> = {};
        for (const key of ['x', 'y', 'rotation', 'parent', 'index', 'locked'] as const) if (patch[key] !== undefined) fields[key] = patch[key];
        if (patch.props !== undefined) fields['props'] = patch.props;
        if (Object.keys(fields).length === 0) continue;
        tx.update(id, fields);
        changed.add(id);
      }
      followBindings(tx, store, changed);
    },
  );
  return written.ok ? ok(undefined) : written;
}

/** Moves shapes (and what a frame or group holds) by `dx, dy`. */
export function translateShapes(core: BoardCore, ids: readonly string[], dx: number, dy: number, options: WriteOptions = {}): BoardResult<undefined> {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return boardError('bad_argument', 'A move needs finite numbers.', { detail: { field: 'dx' } });
  const patches = new Map<string, ShapePatch>();
  for (const s of withMembers(core, ids)) if (!s.locked) patches.set(s.id, { x: s.x + dx, y: s.y + dy });
  return patchShapes(core, patches, options);
}

/** Moves each shape out of or into the frame its middle is over, after a drag; a shape goes on top of the frame it joins. */
export function settleParents(core: BoardCore, ids: readonly string[], options: WriteOptions = {}): BoardResult<undefined> {
  const page = core.pages.current;
  if (page === null) return ok(undefined);
  const { store } = core;
  const members = descendantsOf(store, page, ids);
  const written = writeVia(
    core,
    options,
    (tx) => {
      for (const id of ids) {
        const s = txShape(tx, id);
        if (s === undefined || s.locked || members.has(id)) continue;
        // a shape inside a group keeps the group; the group itself is not moved by its members' frames
        const parent = s.parent === null ? undefined : txShape(tx, s.parent);
        if (parent?.kind === 'group') continue;
        const g = shapeGeometry(s, store.kinds);
        if (g === undefined) continue;
        const skip = new Set<string>([id, ...descendantsOf(store, page, [id])]);
        const frame = frameAt(store, store.kinds, page, g.pageCx, g.pageCy, skip);
        const want = frame?.id ?? null;
        if (want === s.parent) continue;
        const patch: Record<string, unknown> = { parent: want };
        if (want !== null) {
          const key = keyOnTop(store, page);
          if (key.ok) patch['index'] = key.value;
        }
        tx.update(id, patch);
      }
    },
  );
  return written.ok ? ok(undefined) : written;
}

/** Removes shapes and what they hold, and the bindings that name them. Locked shapes stay. */
export function deleteShapes(core: BoardCore, ids: readonly string[], options: WriteOptions = {}): BoardResult<undefined> {
  const going = new Set(withMembers(core, ids).filter((s) => !s.locked).map((s) => s.id));
  // a group whose members are all going goes with them
  for (const s of core.store.all('shape')) {
    if ((s as ShapeRecord).kind !== 'group' || going.has(s.id)) continue;
    const kids = core.store.shapesOn((s as ShapeRecord).page).filter((k) => k.parent === s.id);
    if (kids.length > 0 && kids.every((k) => going.has(k.id))) going.add(s.id);
  }
  if (going.size === 0) return ok(undefined);
  const written = writeVia(
    core,
    options,
    (tx) => {
      dropBindingsOf(tx, core.store, going);
      for (const id of going) tx.remove(id);
    },
  );
  return written.ok ? ok(undefined) : written;
}

export type AlignHow = 'left' | 'centerX' | 'right' | 'top' | 'middleY' | 'bottom';

/** Lines the shapes up with the edge or the middle of the box that holds them all. */
export function alignShapes(core: BoardCore, ids: readonly string[], how: AlignHow, options: WriteOptions = {}): BoardResult<undefined> {
  const items = ids.map((id) => shapeOf(core.store, id)).filter((s): s is ShapeRecord => s !== undefined && !s.locked);
  const boxes = items.map((s) => ({ s, b: layoutBox(core, s) })).filter((e): e is { s: ShapeRecord; b: Bounds } => e.b !== undefined);
  if (boxes.length < 2) return ok(undefined);
  const all = {
    minX: Math.min(...boxes.map((e) => e.b.minX)),
    minY: Math.min(...boxes.map((e) => e.b.minY)),
    maxX: Math.max(...boxes.map((e) => e.b.maxX)),
    maxY: Math.max(...boxes.map((e) => e.b.maxY)),
  };
  const patches = new Map<string, ShapePatch>();
  for (const { s, b } of boxes) {
    let dx = 0;
    let dy = 0;
    if (how === 'left') dx = all.minX - b.minX;
    else if (how === 'right') dx = all.maxX - b.maxX;
    else if (how === 'centerX') dx = boxCx(all) - boxCx(b);
    else if (how === 'top') dy = all.minY - b.minY;
    else if (how === 'bottom') dy = all.maxY - b.maxY;
    else dy = boxCy(all) - boxCy(b);
    for (const m of withMembers(core, [s.id])) if (!m.locked) patches.set(m.id, { x: m.x + dx, y: m.y + dy });
  }
  return patchShapes(core, patches, options);
}

/** Spaces three or more shapes so the gaps between neighbours are equal; the first and the last stay. */
export function distributeShapes(core: BoardCore, ids: readonly string[], axis: 'x' | 'y', options: WriteOptions = {}): BoardResult<undefined> {
  const items = ids.map((id) => shapeOf(core.store, id)).filter((s): s is ShapeRecord => s !== undefined && !s.locked);
  const boxes = items.map((s) => ({ s, b: layoutBox(core, s) })).filter((e): e is { s: ShapeRecord; b: Bounds } => e.b !== undefined);
  if (boxes.length < 3) return ok(undefined);
  const lo = (b: Bounds): number => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: Bounds): number => (axis === 'x' ? b.maxX : b.maxY);
  boxes.sort((a, b) => lo(a.b) - lo(b.b));
  const first = boxes[0] as { s: ShapeRecord; b: Bounds };
  const last = boxes[boxes.length - 1] as { s: ShapeRecord; b: Bounds };
  const total = boxes.reduce((n, e) => n + (hi(e.b) - lo(e.b)), 0);
  const gap = (hi(last.b) - lo(first.b) - total) / (boxes.length - 1);
  const patches = new Map<string, ShapePatch>();
  let at = hi(first.b) + gap;
  for (let i = 1; i < boxes.length - 1; i++) {
    const e = boxes[i] as { s: ShapeRecord; b: Bounds };
    const d = at - lo(e.b);
    for (const m of withMembers(core, [e.s.id])) if (!m.locked) patches.set(m.id, axis === 'x' ? { x: m.x + d } : { y: m.y + d });
    at += hi(e.b) - lo(e.b) + gap;
  }
  return patchShapes(core, patches, options);
}

export type OrderHow = 'front' | 'back' | 'forward' | 'backward';

/** Changes the stacking of shapes with new fractional order keys, so no other shape is rewritten. */
export function orderShapes(core: BoardCore, ids: readonly string[], how: OrderHow, options: WriteOptions = {}): BoardResult<undefined> {
  const page = core.pages.current;
  if (page === null) return ok(undefined);
  const { store } = core;
  const chosen = new Set(ids);
  const stack = stackOf(store, page);
  const picked = stack.filter((s) => chosen.has(s.id) && !s.locked);
  if (picked.length === 0) return ok(undefined);
  const written = writeVia(
    core,
    options,
    (tx) => {
      let list = stack.filter((s) => !chosen.has(s.id) || s.locked);
      // the shapes are placed one at a time, and a selection keeps its own order (design 7.4): the ones that go up are
      // placed from the lowest, the ones that go down from the highest, and a shape never goes past one placed before it
      const placed = new Set<string>();
      for (const s of how === 'front' || how === 'forward' ? picked : [...picked].reverse()) {
        // place the shape in the stack without the chosen shapes, by its place among the others
        let at: number;
        const bounds = layoutBox(core, s);
        if (how === 'front') at = list.length;
        else if (how === 'back') {
          const parent = s.parent === null ? undefined : shapeOf(store, s.parent);
          // a member of a frame goes no lower than the frame, or it would hide behind the frame's fill
          at = parent?.kind === 'frame' ? list.findIndex((o) => o.id === parent.id) + 1 : 0;
        } else {
          const here = stack.findIndex((o) => o.id === s.id);
          const pool = how === 'forward' ? stack.slice(here + 1) : stack.slice(0, here).reverse();
          // the next shape that overlaps this one in the direction asked
          const hit = pool.find((o) => {
            if (chosen.has(o.id)) return false;
            const ob = layoutBox(core, o);
            return ob !== undefined && bounds !== undefined && ob.minX <= bounds.maxX && ob.maxX >= bounds.minX && ob.minY <= bounds.maxY && ob.maxY >= bounds.minY;
          });
          if (hit === undefined) at = how === 'forward' ? list.length : 0;
          else {
            const i = list.findIndex((o) => o.id === hit.id);
            at = how === 'forward' ? i + 1 : i;
            while (how === 'forward' && placed.has(list[at]?.id ?? '')) at++;
            while (how === 'backward' && placed.has(list[at - 1]?.id ?? '')) at--;
          }
        }
        placed.add(s.id);
        const key = keyBetween(list[at - 1]?.index ?? null, list[at]?.index ?? null);
        if (!key.ok) continue;
        tx.update(s.id, { index: key.value });
        list = [...list.slice(0, at), { ...s, index: key.value }, ...list.slice(at)];
      }
    },
  );
  return written.ok ? ok(undefined) : written;
}

/** The topmost group a shape belongs to (or the shape itself when it is in none). */
function groupRootOf(core: BoardCore, s: ShapeRecord): ShapeRecord {
  let top = s;
  for (let depth = 0; depth < 32 && top.parent !== null; depth++) {
    const parent = shapeOf(core.store, top.parent);
    if (parent === undefined || parent.kind !== 'group') break;
    top = parent;
  }
  return top;
}

/** Makes one group of the shapes (two or more units). Returns the shapes the selection should hold: the leaves. */
export function groupShapes(core: BoardCore, ids: readonly string[], options: WriteOptions = {}): BoardResult<string[]> {
  const page = core.pages.current;
  const { store } = core;
  const leaves = expandGroups(store, ids).filter((id) => {
    const s = shapeOf(store, id);
    return s !== undefined && !s.locked;
  });
  const units = new Map<string, ShapeRecord>();
  for (const id of leaves) {
    const s = shapeOf(store, id) as ShapeRecord;
    const root = groupRootOf(core, s);
    units.set(root.id, root);
  }
  if (page === null || units.size < 2) return ok(leaves);
  const parents = new Set([...units.values()].map((u) => u.parent));
  const parent = parents.size === 1 ? ([...parents][0] ?? null) : null;
  const written = writeVia(
    core,
    options,
    (tx) => {
      const key = keyOnTop(store, page);
      if (!key.ok) return;
      const id = tx.newId('shape');
      tx.put({ id, page, kind: 'group', x: 0, y: 0, rotation: 0, parent, index: key.value, locked: false, opacity: 1, props: {}, meta: {} });
      for (const u of units.values()) tx.update(u.id, { parent: id });
    },
  );
  return written.ok ? ok(leaves) : written;
}

/** Takes the topmost group of each selected shape apart; its members join the group's own parent. Returns the leaves. */
export function ungroupShapes(core: BoardCore, ids: readonly string[], options: WriteOptions = {}): BoardResult<string[]> {
  const { store } = core;
  const leaves = expandGroups(store, ids);
  const groups = new Map<string, ShapeRecord>();
  for (const id of leaves) {
    const s = shapeOf(store, id);
    if (s === undefined) continue;
    const root = groupRootOf(core, s);
    if (root.kind === 'group') groups.set(root.id, root);
  }
  if (groups.size === 0) return ok(leaves);
  const written = writeVia(
    core,
    options,
    (tx) => {
      for (const g of groups.values()) {
        for (const kid of store.shapesOn(g.page)) if (kid.parent === g.id) tx.update(kid.id, { parent: g.parent });
        tx.remove(g.id);
      }
    },
  );
  return written.ok ? ok(leaves) : written;
}

/** Locks or unlocks shapes (and what they hold). With no `locked`, shapes that are all locked are unlocked and the rest are locked. */
export function setLocked(core: BoardCore, ids: readonly string[], locked?: boolean, options: WriteOptions = {}): BoardResult<undefined> {
  const list = withMembers(core, ids);
  if (list.length === 0) return ok(undefined);
  const value = locked ?? !list.every((s) => s.locked);
  const patches = new Map<string, ShapePatch>();
  for (const s of list) if (s.locked !== value) patches.set(s.id, { locked: value });
  return patchShapes(core, patches, options);
}

/** Mirrors shapes across the vertical (`x`) or horizontal (`y`) middle line of the box that holds them. */
export function flipShapes(core: BoardCore, ids: readonly string[], axis: 'x' | 'y', options: WriteOptions = {}): BoardResult<undefined> {
  const items = withMembers(core, ids).filter((s) => !s.locked && s.kind !== 'group');
  const boxes = items.map((s) => layoutBox(core, s)).filter((b): b is Bounds => b !== undefined);
  if (boxes.length === 0) return ok(undefined);
  const mx = (Math.min(...boxes.map((b) => b.minX)) + Math.max(...boxes.map((b) => b.maxX))) / 2;
  const my = (Math.min(...boxes.map((b) => b.minY)) + Math.max(...boxes.map((b) => b.maxY))) / 2;
  const { store } = core;
  const patches = new Map<string, ShapePatch>();
  for (const s of items) {
    const g = shapeGeometry(s, store.kinds);
    if (g === undefined) continue;
    const def = store.kinds.get(s.kind);
    const own = def?.flip?.(s, axis);
    // a shape that looks the same mirrored: mirroring across x only turns it the other way; across y it also turns half a circle
    const rotation = own !== undefined || axis === 'x' ? wrapAngle(-s.rotation) : wrapAngle(Math.PI - s.rotation);
    // the middle of the box lands on the mirror image of the middle; the new box (own flip keeps its size) has the same middle
    const cx = axis === 'x' ? 2 * mx - g.pageCx : g.pageCx;
    const cy = axis === 'y' ? 2 * my - g.pageCy : g.pageCy;
    const props = own ?? {};
    patches.set(s.id, { rotation, x: cx - g.cx, y: cy - g.cy, ...(own !== undefined ? { props } : {}) });
  }
  return patchShapes(core, patches, options);
}

/** Applies the style bar's patch to the shapes that can take it. */
export function styleShapes(core: BoardCore, ids: readonly string[], style: StylePatch, options: WriteOptions = {}): BoardResult<undefined> {
  const patches = new Map<string, ShapePatch>();
  for (const id of ids) {
    const s = shapeOf(core.store, id);
    if (s === undefined || s.locked) continue;
    const props = core.store.kinds.get(s.kind)?.applyStyle?.(s.props, style);
    if (props !== undefined && Object.keys(props).length > 0) patches.set(id, { props: props as Record<string, unknown> });
  }
  return patchShapes(core, patches, options);
}

/** Turns shapes by `delta` radians about the page point `cx, cy`. */
export function turnShapes(core: BoardCore, originals: readonly ShapeRecord[], delta: number, cx: number, cy: number, options: WriteOptions = {}): BoardResult<undefined> {
  const patches = new Map<string, ShapePatch>();
  for (const s of originals) {
    if (s.locked) continue;
    const g = shapeGeometry(s, core.store.kinds);
    if (g === undefined) continue;
    const c = rotateAbout(g.pageCx, g.pageCy, cx, cy, delta);
    patches.set(s.id, { rotation: wrapAngle(s.rotation + delta), x: c.x - g.cx, y: c.y - g.cy });
  }
  return patchShapes(core, patches, options);
}

/** The error for a command that needs shapes and was given none. */
export const nothingChosen = (): ReturnType<typeof boardError> => boardError('bad_argument', 'No shapes were chosen.', { detail: { field: 'ids' } });

/** The lowest order key on the page (for a shape that goes behind the rest). */
export const backKey = (core: BoardCore, page: string): BoardResult<string> => keyBetween(null, bottomKey(core.store, page));
