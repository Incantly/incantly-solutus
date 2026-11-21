/**
 * The selection as a frame with handles (design 7.4): where the 8 resize handles, the rotate handle and the kind's own
 * handles are on the page, and how the painter shows them. The select tool hit-tests the same handles it draws. A
 * shape alone in the selection is framed by its own turned box; several shapes are framed by the box that holds them.
 * No DOM, no timers.
 */
import type { BoardCore } from './board';
import { shapeGeometry } from './geometry';
import type { OverlayHandle, SelectionView } from './draw';
import { layoutBox } from './edit';
import { rotateAbout } from './math2d';
import { shapeOf } from './shapes';
import type { ShapeRecord } from './types';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** A handle's id: a resize side, `rotate`, or `k:<id>` for a handle of the kind. */
export type HandleId = ResizeHandle | 'rotate' | `k:${string}`;

export interface SelectionFrame {
  /** The middle of the frame on the page. */
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  readonly rotation: number;
  /** The selected shapes the frame holds (groups left out). */
  readonly shapes: readonly ShapeRecord[];
  /** The shape when exactly one is selected. */
  readonly single: ShapeRecord | undefined;
}

export interface FrameHandle {
  readonly id: HandleId;
  readonly kind: OverlayHandle['kind'];
  readonly x: number;
  readonly y: number;
}

/** The distance of the rotate handle from the frame, in screen pixels. */
export const ROTATE_OFFSET_PX = 26;
/** How near a pointer must be to grab a handle, in screen pixels. */
export const HANDLE_GRAB_PX = 9;

/** The frame round the shapes with these ids, or undefined when none has a geometry. */
export function frameOf(core: BoardCore, ids: readonly string[]): SelectionFrame | undefined {
  const shapes: ShapeRecord[] = [];
  for (const id of ids) {
    const s = shapeOf(core.store, id);
    if (s !== undefined && s.kind !== 'group' && shapeGeometry(s, core.store.kinds) !== undefined) shapes.push(s);
  }
  if (shapes.length === 0) return undefined;
  if (shapes.length === 1) {
    const s = shapes[0] as ShapeRecord;
    const g = shapeGeometry(s, core.store.kinds);
    if (g === undefined) return undefined;
    return { cx: g.pageCx, cy: g.pageCy, w: g.box.maxX - g.box.minX, h: g.box.maxY - g.box.minY, rotation: s.rotation, shapes, single: s };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of shapes) {
    const b = layoutBox(core, s);
    if (b === undefined) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY, rotation: 0, shapes, single: undefined };
}

/** The corners of a frame on the page, 8 numbers: top-left, top-right, bottom-right, bottom-left. */
export function frameCorners(f: SelectionFrame): number[] {
  const out: number[] = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const p = rotateAbout(f.cx + (sx * f.w) / 2, f.cy + (sy * f.h) / 2, f.cx, f.cy, f.rotation);
    out.push(p.x, p.y);
  }
  return out;
}

const SIDES: readonly (readonly [ResizeHandle, number, number])[] = [
  ['nw', -1, -1], ['n', 0, -1], ['ne', 1, -1], ['e', 1, 0], ['se', 1, 1], ['s', 0, 1], ['sw', -1, 1], ['w', -1, 0],
];

/**
 * The handles of a frame at this zoom. A shape alone whose kind has its own handles shows those (and the rotate handle)
 * and no resize handles; a shape whose size is fixed shows only the rotate handle; every locked shape shows none.
 */
export function handlesOf(core: BoardCore, f: SelectionFrame, zoom: number): FrameHandle[] {
  if (f.shapes.every((s) => s.locked)) return [];
  const out: FrameHandle[] = [];
  const at = (lx: number, ly: number): { x: number; y: number } => rotateAbout(f.cx + lx, f.cy + ly, f.cx, f.cy, f.rotation);
  const def = f.single === undefined ? undefined : core.store.kinds.get(f.single.kind);
  const own = f.single !== undefined && def?.handles !== undefined ? def.handles(f.single) : undefined;
  const geometry = f.single === undefined ? undefined : shapeGeometry(f.single, core.store.kinds);
  if (own !== undefined && geometry !== undefined) {
    for (const h of own) {
      const p = geometry.toPage(h.x, h.y);
      out.push({ id: `k:${h.id}`, kind: 'kind', x: p.x, y: p.y });
    }
    return out;
  }
  if (def?.fixedSize !== true) {
    for (const [id, sx, sy] of SIDES) {
      const p = at((sx * f.w) / 2, (sy * f.h) / 2);
      out.push({ id, kind: 'resize', x: p.x, y: p.y });
    }
  }
  const r = at(0, -f.h / 2 - ROTATE_OFFSET_PX / zoom);
  out.push({ id: 'rotate', kind: 'rotate', x: r.x, y: r.y });
  return out;
}

/** The handle under a page point, or undefined; `zoom` turns the grab radius from screen pixels into page units. */
export function handleAt(handles: readonly FrameHandle[], x: number, y: number, zoom: number): FrameHandle | undefined {
  const r = HANDLE_GRAB_PX / zoom;
  let best: FrameHandle | undefined;
  let bestD = r * r;
  for (const h of handles) {
    const d = (h.x - x) ** 2 + (h.y - y) ** 2;
    if (d <= bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** The selection as the painter shows it, or null when nothing is selected. */
export function selectionView(core: BoardCore, zoom: number): SelectionView | null {
  const ids = core.selection.ids;
  if (ids.length === 0) return null;
  const f = frameOf(core, ids);
  if (f === undefined) return null;
  const outlines = f.shapes.map((s) => shapeGeometry(s, core.store.kinds)?.outline ?? []);
  const own = f.single !== undefined && core.store.kinds.get(f.single.kind)?.handles !== undefined;
  return {
    outlines,
    frame: own ? null : frameCorners(f),
    handles: handlesOf(core, f, zoom).map((h) => ({ id: h.id, kind: h.kind, x: h.x, y: h.y })),
  };
}
