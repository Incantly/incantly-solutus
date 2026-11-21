/**
 * Where an agent action puts a thing (agent.md 2, `Place`): at a point, near a shape or an area on one side, or at the
 * nearest empty spot in view. `near` and `free` never cover another shape: a spot that does is slid outward along the
 * side, then along it, until a free one is found. The answer is where the new thing's box begins, in page units; the
 * caller turns it into the shape's origin. No DOM, no timers, no `Date`.
 */
import type { BoardCore } from './board';
import type { BoardError, BoardResult } from './errors';
import { boardError, ok } from './errors';
import { shapeBounds } from './geometry';
import { boundsOfBox } from './agent-read';
import type { Place, Side, Target } from './agent-types';
import { isShape } from './types';
import type { Bounds } from './types';

/** The space kept between a new thing and what it is placed beside. */
export const PLACE_GAP = 40;
/** The air kept round other shapes: a spot closer than this to one counts as covering it. */
const AIR = 6;
/** How far a spot is slid outward, in steps of the thing's own size, before the last resort. */
const OUT_STEPS = 8;
const ACROSS = [0, 1, -1, 2, -2, 3, -3] as const;

export const LAST = '$last';

export interface PlaceEnv {
  /** The part of the current page on screen. */
  readonly view: Bounds;
  /** The id of the shape the previous action of the call made. */
  readonly last: string | undefined;
  /** Shapes that do not count as in the way (the one being moved). */
  readonly skip?: ReadonlySet<string>;
}

/** The refusal for a shape that is not on the current page (gone, or on another page). */
export const goneShape = (id: string): BoardError => boardError('agent_refused', `There is no shape "${id}" on this page.`, { hint: 'Read the board again with board_read.', detail: { record: id } });

/** The page box a target names: a shape's, an area, or the previous action's shape (`$last`). */
export function targetBounds(core: BoardCore, target: Target, env: Pick<PlaceEnv, 'last'>): BoardResult<{ readonly bounds: Bounds; readonly id?: string }> {
  if (typeof target !== 'string') return ok({ bounds: boundsOfBox(target) });
  let id = target;
  if (id === LAST) {
    if (env.last === undefined) return boardError('agent_refused', '$last names the shape the previous action made, and there is none.', { detail: { record: LAST } });
    id = env.last;
  }
  const page = core.pages.current;
  const shape = core.store.get(id);
  if (page === null || shape === undefined || !isShape(shape) || shape.page !== page) return goneShape(id);
  const bounds = shapeBounds(shape, core.store.kinds);
  if (bounds === undefined) return goneShape(id);
  return ok({ bounds, id });
}

const overlaps = (a: Bounds, b: Bounds): boolean => a.minX < b.maxX + AIR && a.maxX > b.minX - AIR && a.minY < b.maxY + AIR && a.maxY > b.minY - AIR;

/** The boxes on the current page a new thing must not cover: every shape but frames and groups (a thing may sit in a frame). */
export function occupiedBoxes(core: BoardCore, skip?: ReadonlySet<string>): Bounds[] {
  const page = core.pages.current;
  if (page === null) return [];
  const out: Bounds[] = [];
  for (const s of core.store.shapesOn(page)) {
    if (s.kind === 'group' || s.kind === 'frame' || skip?.has(s.id) === true) continue;
    const b = shapeBounds(s, core.store.kinds);
    if (b !== undefined) out.push(b);
  }
  return out;
}

const boxAt = (x: number, y: number, w: number, h: number): Bounds => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });
const isFree = (box: Bounds, occupied: readonly Bounds[]): boolean => !occupied.some((o) => overlaps(box, o));

/** The box a thing of `size` has on `side` of `near`, before any sliding, and the directions to slide. */
function beside(near: Bounds, side: Side, w: number, h: number): { x: number; y: number; out: readonly [number, number]; across: readonly [number, number] } {
  const cx = (near.minX + near.maxX) / 2;
  const cy = (near.minY + near.maxY) / 2;
  switch (side) {
    case 'right':
      return { x: near.maxX + PLACE_GAP, y: cy - h / 2, out: [1, 0], across: [0, 1] };
    case 'left':
      return { x: near.minX - PLACE_GAP - w, y: cy - h / 2, out: [-1, 0], across: [0, 1] };
    case 'above':
      return { x: cx - w / 2, y: near.minY - PLACE_GAP - h, out: [0, -1], across: [1, 0] };
    case 'below':
      return { x: cx - w / 2, y: near.maxY + PLACE_GAP, out: [0, 1], across: [1, 0] };
  }
}

function nearSpot(near: Bounds, side: Side, w: number, h: number, occupied: readonly Bounds[]): { x: number; y: number } {
  const base = beside(near, side, w, h);
  const horizontal = base.out[0] !== 0;
  const outStep = (horizontal ? w : h) + PLACE_GAP;
  const acrossStep = (horizontal ? h : w) + PLACE_GAP;
  for (let k = 0; k <= OUT_STEPS; k++) {
    for (const j of ACROSS) {
      const x = base.x + base.out[0] * k * outStep + base.across[0] * j * acrossStep;
      const y = base.y + base.out[1] * k * outStep + base.across[1] * j * acrossStep;
      if (isFree(boxAt(x, y, w, h), occupied)) return { x, y };
    }
  }
  // nothing near is free: past everything, on the same side
  let far = near;
  for (const o of occupied) far = { minX: Math.min(far.minX, o.minX), minY: Math.min(far.minY, o.minY), maxX: Math.max(far.maxX, o.maxX), maxY: Math.max(far.maxY, o.maxY) };
  return beside(far, side, w, h);
}

/** The nearest empty spot to the middle of the view that lies wholly in view; below all content when the view is full. */
function freeSpot(view: Bounds, w: number, h: number, occupied: readonly Bounds[]): { x: number; y: number } {
  const vw = view.maxX - view.minX;
  const vh = view.maxY - view.minY;
  const step = Math.max(24, vw / 40, vh / 40);
  const cx = (view.minX + view.maxX) / 2;
  const cy = (view.minY + view.maxY) / 2;
  const spots: { x: number; y: number; d: number }[] = [];
  for (let y = view.minY + PLACE_GAP; y + h <= view.maxY - PLACE_GAP + 0.001; y += step) {
    for (let x = view.minX + PLACE_GAP; x + w <= view.maxX - PLACE_GAP + 0.001; x += step) spots.push({ x, y, d: Math.hypot(x + w / 2 - cx, y + h / 2 - cy) });
  }
  spots.sort((a, b) => a.d - b.d);
  for (const s of spots) if (isFree(boxAt(s.x, s.y, w, h), occupied)) return { x: s.x, y: s.y };
  let bottom = view.maxY;
  for (const o of occupied) bottom = Math.max(bottom, o.maxY);
  return { x: view.minX + PLACE_GAP, y: bottom + PLACE_GAP };
}

/** Where the box of a thing of `size` begins. `agent_refused` when `near` names a shape that is gone. */
export function resolvePlace(core: BoardCore, place: Place, size: { readonly w: number; readonly h: number }, env: PlaceEnv): BoardResult<{ readonly x: number; readonly y: number }> {
  if (place === 'free') return ok(freeSpot(env.view, size.w, size.h, occupiedBoxes(core, env.skip)));
  if ('near' in place) {
    const near = targetBounds(core, place.near, env);
    if (!near.ok) return near;
    return ok(nearSpot(near.value.bounds, place.side, size.w, size.h, occupiedBoxes(core, env.skip)));
  }
  return ok({ x: place.x, y: place.y });
}
