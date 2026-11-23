/**
 * Arrow bindings (design 4 and 7.1): an arrow's end sticks to a shape through a `binding` record
 * `{ kind: 'arrow', from: <arrow>, to: <shape>, props: { end, anchor } }`. `anchor` is where on the target's box the
 * arrow aims (0 to 1 of each side); the arrow's end sits on the line from the other end to that point, `ARROW_GAP` (8
 * units) short of where that line first meets the target's outline. `followBindings` runs inside the transaction that
 * moves, resizes, turns or removes a shape, so the arrow and the shape change together and undo restores both. No DOM,
 * no timers.
 */
import type { BoardResult } from './errors';
import { boardError, DONE } from './errors';
import { shapeGeometry } from './geometry';
import type { Geometry } from './geometry';
import { firstCrossing } from './math2d';
import { txShape } from './shapes';
import type { Store, Tx } from './store';
import { isBinding } from './types';
import type { BindingRecord, ShapeRecord } from './types';

export type ArrowEnd = 'start' | 'end';

export interface BindingProps {
  readonly end: ArrowEnd;
  /** The aimed point as a fraction of the target's box: `[0.5, 0.5]` is the middle. */
  readonly anchor: readonly [number, number];
}

const isEnd = (v: unknown): v is ArrowEnd => v === 'start' || v === 'end';

/** The props of a binding record when they are the shape this module writes, or undefined. */
export function bindingProps(b: BindingRecord): BindingProps | undefined {
  const p = b.props as { end?: unknown; anchor?: unknown } | null;
  if (p === null || typeof p !== 'object' || !isEnd(p.end) || !Array.isArray(p.anchor) || p.anchor.length !== 2) return undefined;
  const [ax, ay] = p.anchor as unknown[];
  if (typeof ax !== 'number' || typeof ay !== 'number') return undefined;
  return { end: p.end, anchor: [ax, ay] };
}

/** Every binding record of the store. */
export function allBindings(store: Store): BindingRecord[] {
  return store.all('binding').filter(isBinding);
}

/** The bindings of one arrow. */
export function bindingsOfArrow(store: Store, arrow: string): BindingRecord[] {
  return allBindings(store).filter((b) => b.from === arrow);
}

/** The bindings that name a shape as their target. */
export function bindingsOnTarget(store: Store, target: string): BindingRecord[] {
  return allBindings(store).filter((b) => b.to === target);
}

/** The shape an arrow end sticks to, or undefined. */
export function boundTarget(store: Store, arrow: string, end: ArrowEnd): string | undefined {
  return bindingsOfArrow(store, arrow).find((b) => bindingProps(b)?.end === end)?.to;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** How far an arrow's end stops short of its target's outline, in page units, so the head shows beside the target. */
export const ARROW_GAP = 8;

/** The page point a binding aims at on its target. */
function anchorPoint(target: Geometry, anchor: readonly [number, number]): { x: number; y: number } {
  const { box } = target;
  return target.toPage(box.minX + clamp01(anchor[0]) * (box.maxX - box.minX), box.minY + clamp01(anchor[1]) * (box.maxY - box.minY));
}

/**
 * Puts an arrow's bound ends where their targets are now. The arrow is written only when an end moved. An end whose
 * target is gone loses its binding and stays where it was. The arrow is left turned by 0: its ends are written as page
 * points relative to its origin. `added` are bindings this transaction put that the store does not list yet; bindings the
 * transaction removed do not count.
 */
export function followArrow(tx: Tx, store: Store, arrowId: string, added: readonly BindingRecord[] = []): void {
  const arrow = txShape(tx, arrowId);
  if (arrow === undefined || arrow.kind !== 'arrow') return;
  const geometry = shapeGeometry(arrow, store.kinds);
  if (geometry === undefined) return;
  const props = arrow.props as { start: readonly [number, number]; end: readonly [number, number] };
  const own = (end: ArrowEnd): { x: number; y: number } => {
    const p = end === 'start' ? props.start : props.end;
    return geometry.toPage(p[0], p[1]);
  };
  const aimed: Partial<Record<ArrowEnd, { x: number; y: number }>> = {};
  const targets: Partial<Record<ArrowEnd, Geometry>> = {};
  const listed = allBindings(store).filter((x) => x.from === arrowId && tx.get(x.id) !== undefined);
  for (const b of [...listed, ...added]) {
    const bp = bindingProps(b);
    if (bp === undefined) continue;
    const target = txShape(tx, b.to);
    const g = target === undefined ? undefined : shapeGeometry(target, store.kinds);
    if (g === undefined) {
      tx.remove(b.id);
      continue;
    }
    targets[bp.end] = g;
    aimed[bp.end] = anchorPoint(g, bp.anchor);
  }
  if (targets.start === undefined && targets.end === undefined) return;
  // each bound end stops at its target's outline, on the line from the other end (or from the other target's middle)
  const from = (end: ArrowEnd): { x: number; y: number } => {
    const other: ArrowEnd = end === 'start' ? 'end' : 'start';
    const otherTarget = targets[other];
    return otherTarget !== undefined ? { x: otherTarget.pageCx, y: otherTarget.pageCy } : own(other);
  };
  const place = (end: ArrowEnd): { x: number; y: number } => {
    const target = targets[end];
    const aim = aimed[end];
    if (target === undefined || aim === undefined) return own(end);
    const origin = from(end);
    const cross = firstCrossing(target.outline, origin.x, origin.y, aim.x, aim.y);
    if (cross === null) return aim;
    // stop ARROW_GAP short of the outline on the way in (at most half the way, so a short arrow keeps its direction)
    const length = Math.hypot(cross.x - origin.x, cross.y - origin.y);
    if (length === 0) return cross;
    const back = Math.min(ARROW_GAP, length / 2) / length;
    return { x: cross.x + (origin.x - cross.x) * back, y: cross.y + (origin.y - cross.y) * back };
  };
  const start = place('start');
  const end = place('end');
  const next = { start: [start.x - arrow.x, start.y - arrow.y] as [number, number], end: [end.x - arrow.x, end.y - arrow.y] as [number, number] };
  const same = (a: readonly [number, number], b: readonly [number, number]): boolean => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  if (arrow.rotation === 0 && same(next.start, props.start) && same(next.end, props.end)) return;
  tx.update(arrowId, { rotation: 0, props: next });
}

/** Moves the arrows bound to any of `changed` (a shape that moved, resized, turned or went), and the arrows in `changed`. */
export function followBindings(tx: Tx, store: Store, changed: ReadonlySet<string>): void {
  const arrows = new Set<string>();
  for (const b of allBindings(store)) if (changed.has(b.to) || changed.has(b.from)) arrows.add(b.from);
  for (const id of arrows) followArrow(tx, store, id);
}

/** Removes the bindings of shapes that are going: those that stick an arrow to them, and those of arrows that are going. */
export function dropBindingsOf(tx: Tx, store: Store, going: ReadonlySet<string>): void {
  for (const b of allBindings(store)) if (going.has(b.to) || going.has(b.from)) tx.remove(b.id);
}

/**
 * Sticks one end of an arrow to a shape, aiming at the page point `at`. A binding the end had is replaced. The arrow
 * follows at once.
 */
export function bindEnd(tx: Tx, store: Store, arrowId: string, end: ArrowEnd, targetId: string, at: { readonly x: number; readonly y: number }): BoardResult<undefined> {
  const arrow = txShape(tx, arrowId);
  const target = txShape(tx, targetId);
  if (arrow === undefined || arrow.kind !== 'arrow') return boardError('bad_argument', `"${arrowId}" is not an arrow.`, { detail: { record: arrowId } });
  if (target === undefined) return boardError('bad_argument', `There is no shape "${targetId}".`, { detail: { record: targetId } });
  if (targetId === arrowId || target.kind === 'group') return boardError('bad_argument', 'An arrow cannot stick to itself or to a group.', { detail: { record: targetId } });
  const g = shapeGeometry(target, store.kinds);
  if (g === undefined) return boardError('bad_argument', `The shape "${targetId}" has no geometry to stick to.`, { detail: { record: targetId } });
  const local = g.toLocal(at.x, at.y);
  const w = g.box.maxX - g.box.minX;
  const h = g.box.maxY - g.box.minY;
  const anchor: [number, number] = [w > 0 ? clamp01((local.x - g.box.minX) / w) : 0.5, h > 0 ? clamp01((local.y - g.box.minY) / h) : 0.5];
  const failed = unbindEnd(tx, store, arrowId, end);
  if (!failed.ok) return failed;
  const put = tx.put({ id: tx.newId('binding'), kind: 'arrow', from: arrowId, to: targetId, props: { end, anchor } });
  if (!put.ok) return put;
  followArrow(tx, store, arrowId, isBinding(put.value) ? [put.value] : []);
  return DONE;
}

/** Frees one end of an arrow; it stays where it is. */
export function unbindEnd(tx: Tx, store: Store, arrowId: string, end: ArrowEnd): BoardResult<undefined> {
  for (const b of allBindings(store)) {
    if (b.from !== arrowId || bindingProps(b)?.end !== end) continue;
    const removed = tx.remove(b.id);
    if (!removed.ok) return removed;
  }
  return DONE;
}

/** The shape under a page point that an arrow end may stick to (not the arrow, not a group, not a locked shape's frame), topmost first. */
export function bindTargetAt(store: Store, page: string, x: number, y: number, tol: number, skip: ReadonlySet<string>): ShapeRecord | undefined {
  let best: ShapeRecord | undefined;
  for (const s of store.shapesOn(page)) {
    if (skip.has(s.id) || s.kind === 'group' || s.kind === 'arrow' || s.kind === 'line' || s.kind === 'ink') continue;
    const g = shapeGeometry(s, store.kinds);
    if (g === undefined) continue;
    const l = g.toLocal(x, y);
    const inside = l.x >= g.box.minX - tol && l.x <= g.box.maxX + tol && l.y >= g.box.minY - tol && l.y <= g.box.maxY + tol;
    if (inside && (best === undefined || s.index > best.index)) best = s;
  }
  return best;
}
