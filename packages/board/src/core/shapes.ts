/**
 * Helpers for shapes as a tree and a stack: which shapes a frame or group holds, which group a click belongs to, the
 * order key for a new shape, and making a shape from a kind's defaults. Reads go to the store; writes go through a `Tx`
 * the caller owns, so a command can do all its writes as one transaction. No DOM, no timers.
 */
import type { BoardError, BoardResult } from './errors';
import { boardError, ok } from './errors';
import { keyBetween } from './fractional';
import { shapeGeometry } from './geometry';
import type { KindRegistry } from './kinds/def';
import type { Store, Tx } from './store';
import type { ShapeRecord } from './types';
import { isShape } from './types';

/** The shape with this id, from the store. */
export function shapeOf(store: Store, id: string): ShapeRecord | undefined {
  const r = store.get(id);
  return r !== undefined && isShape(r) ? r : undefined;
}

/** The shape with this id as the transaction sees it. */
export function txShape(tx: Tx, id: string): ShapeRecord | undefined {
  const r = tx.get(id);
  return r !== undefined && isShape(r) ? r : undefined;
}

/** The direct children of a frame or group. */
export function childrenOf(store: Store, page: string, parent: string): ShapeRecord[] {
  return store.shapesOn(page).filter((s) => s.parent === parent);
}

/** Every shape inside the given shapes, at any depth (not the shapes themselves). */
export function descendantsOf(store: Store, page: string, ids: Iterable<string>): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const s of store.shapesOn(page)) {
    if (s.parent === null) continue;
    const list = byParent.get(s.parent);
    if (list === undefined) byParent.set(s.parent, [s.id]);
    else list.push(s.id);
  }
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    for (const child of byParent.get(id) ?? []) {
      if (out.has(child)) continue;
      out.add(child);
      stack.push(child);
    }
  }
  return out;
}

/** The shapes a click on `id` selects: the shape, or every leaf of the topmost group it belongs to. */
export function selectionFor(store: Store, id: string): string[] {
  const start = shapeOf(store, id);
  if (start === undefined) return [id];
  let top = start;
  for (let depth = 0; depth < 32 && top.parent !== null; depth++) {
    const parent = shapeOf(store, top.parent);
    if (parent === undefined) break;
    if (parent.kind === 'group') top = parent;
    else break;
  }
  if (top.kind !== 'group') return [top.id];
  return [...leavesOf(store, top)];
}

/** The shapes under a group that are not groups themselves. */
export function leavesOf(store: Store, group: ShapeRecord): string[] {
  const all = descendantsOf(store, group.page, [group.id]);
  const out: string[] = [];
  for (const id of all) {
    const s = shapeOf(store, id);
    if (s !== undefined && s.kind !== 'group') out.push(id);
  }
  return out;
}

/** Selection ids with every group replaced by its leaves, and shapes of a group that are alone completed to the whole group. */
export function expandGroups(store: Store, ids: readonly string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) for (const s of selectionFor(store, id)) out.add(s);
  return [...out];
}

/** The last order key among a page's shapes, or null for an empty page. */
export function topKey(store: Store, page: string): string | null {
  let last: string | null = null;
  for (const s of store.shapesOn(page)) if (last === null || s.index > last) last = s.index;
  return last;
}

/** The first order key among a page's shapes, or null for an empty page. */
export function bottomKey(store: Store, page: string): string | null {
  let first: string | null = null;
  for (const s of store.shapesOn(page)) if (first === null || s.index < first) first = s.index;
  return first;
}

/** The order key that puts a shape above every shape of the page. */
export function keyOnTop(store: Store, page: string): BoardResult<string> {
  return keyBetween(topKey(store, page), null);
}

/** The shapes of a page from the back to the front. */
export function stackOf(store: Store, page: string): ShapeRecord[] {
  return [...store.shapesOn(page)].sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id < b.id ? -1 : 1));
}

/** The topmost frame whose box holds the page point, other than the shapes in `skip`. */
export function frameAt(store: Store, kinds: KindRegistry, page: string, x: number, y: number, skip: ReadonlySet<string>): ShapeRecord | undefined {
  let found: ShapeRecord | undefined;
  for (const s of store.shapesOn(page)) {
    if (s.kind !== 'frame' || skip.has(s.id)) continue;
    const g = shapeGeometry(s, kinds);
    if (g === undefined) continue;
    const l = g.toLocal(x, y);
    if (l.x < g.box.minX || l.x > g.box.maxX || l.y < g.box.minY || l.y > g.box.maxY) continue;
    if (found === undefined || s.index > found.index) found = s;
  }
  return found;
}

export interface NewShape {
  readonly kind: string;
  readonly page: string;
  readonly x: number;
  readonly y: number;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly rotation?: number;
  readonly parent?: string | null;
  readonly index?: string;
}

/** Adds a shape of a kind, with the kind's defaults under `props`, on top of the page. Returns the stored record. */
export function putNewShape(tx: Tx, store: Store, spec: NewShape): BoardResult<ShapeRecord> {
  const def = store.kinds.get(spec.kind);
  if (def === undefined) return boardError('kind_unknown', `The kind "${spec.kind}" is not registered.`, { detail: { kind: spec.kind } });
  let index = spec.index;
  if (index === undefined) {
    const key = keyOnTop(store, spec.page);
    if (!key.ok) return key;
    index = key.value;
  }
  const put = tx.put({
    id: tx.newId('shape'),
    page: spec.page,
    kind: spec.kind,
    x: spec.x,
    y: spec.y,
    rotation: spec.rotation ?? 0,
    parent: spec.parent ?? null,
    index,
    locked: false,
    opacity: 1,
    props: { ...(def.defaults as object), ...spec.props },
    meta: {},
  });
  if (!put.ok) return put;
  return ok(put.value as ShapeRecord);
}

/** The error to give when a shape named by a call is not on the board. */
export const noShape = (id: string): BoardError => boardError('bad_argument', `There is no shape "${id}".`, { detail: { record: id } });
