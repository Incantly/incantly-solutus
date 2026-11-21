/**
 * Resizing shapes (design 7.4). A kind says what its props become when its box becomes another box (`onResize`); the
 * core then moves the shape so the new box lands where it was asked to. A shape turns about the middle of its box, so
 * the middle of the new box on the page fixes the new `x, y` whatever the turn is. No DOM, no timers.
 */
import type { BoardCore } from './board';
import type { ShapePatch } from './edit';
import { shapeGeometry } from './geometry';
import { boxCx, boxCy, rotateAbout } from './math2d';
import type { Bounds, ShapeRecord } from './types';

/**
 * The patch that gives `shape` the box `nb` (in the shape's own coordinates, as they are now), or undefined when the
 * kind cannot be resized or the result fails its check.
 */
export function resizePatch(core: BoardCore, shape: ShapeRecord, nb: Bounds): ShapePatch | undefined {
  const def = core.store.kinds.get(shape.kind);
  const g = shapeGeometry(shape, core.store.kinds);
  if (def?.onResize === undefined || g === undefined) return undefined;
  if (![nb.minX, nb.minY, nb.maxX, nb.maxY].every(Number.isFinite)) return undefined;
  let patch: Partial<unknown>;
  try {
    patch = def.onResize(shape, nb);
  } catch {
    return undefined;
  }
  const checked = def.check({ ...(shape.props as object), ...patch });
  if (!checked.ok) return undefined;
  const candidate: ShapeRecord = { ...shape, props: checked.value };
  const g2 = shapeGeometry(candidate, core.store.kinds);
  if (g2 === undefined) return undefined;
  // the middle of the new box, on the page, as the old turn puts it
  const centre = g.toPage(boxCx(nb), boxCy(nb));
  return { x: centre.x - g2.cx, y: centre.y - g2.cy, props: patch as Record<string, unknown> };
}

/**
 * The patches that scale a group of shapes about the page point `ax, ay` by `sx, sy`. A shape that is not turned is
 * resized to its scaled box; a turned shape is scaled by the smaller of the two factors and moved with its middle.
 */
export function scalePatches(core: BoardCore, shapes: readonly ShapeRecord[], ax: number, ay: number, sx: number, sy: number): Map<string, ShapePatch> {
  const out = new Map<string, ShapePatch>();
  for (const s of shapes) {
    if (s.locked) continue;
    const g = shapeGeometry(s, core.store.kinds);
    if (g === undefined) continue;
    const w = g.box.maxX - g.box.minX;
    const h = g.box.maxY - g.box.minY;
    const turned = s.rotation !== 0;
    const fx = turned ? Math.min(Math.abs(sx), Math.abs(sy)) : Math.abs(sx);
    const fy = turned ? fx : Math.abs(sy);
    // where the middle of the shape goes on the page, and the size of its new box
    const pc = { x: ax + (g.pageCx - ax) * sx, y: ay + (g.pageCy - ay) * sy };
    const nw = Math.max(1e-3, w * fx);
    const nh = Math.max(1e-3, h * fy);
    // the new box has the same middle in the shape's own coordinates as far as the old turn is concerned
    const local = rotateAbout(pc.x, pc.y, g.pageCx, g.pageCy, -s.rotation);
    const cx = g.cx + (local.x - g.pageCx);
    const cy = g.cy + (local.y - g.pageCy);
    const patch = resizePatch(core, s, { minX: cx - nw / 2, minY: cy - nh / 2, maxX: cx + nw / 2, maxY: cy + nh / 2 });
    if (patch !== undefined) out.set(s.id, patch);
    else out.set(s.id, { x: s.x + (pc.x - g.pageCx), y: s.y + (pc.y - g.pageCy) });
  }
  return out;
}
