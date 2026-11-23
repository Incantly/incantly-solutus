/** Finding shapes on the current page: under a point, in a box. Reads the page's spatial index, then the shapes' own hit tests. */
import type { BoardCore } from './board';
import { shapeGeometry } from './geometry';
import { boxesMeet } from './math2d';
import type { Bounds, ShapeRecord } from './types';

const layerOf = (s: ShapeRecord): number => (s.kind === 'ink' && (s.props as { nib?: string }).nib === 'highlighter' ? 0 : 1);

/** The topmost shape under the page point, to within `tol` page units, or undefined. Highlighter ink lies under the rest. */
export function pickShape(core: BoardCore, x: number, y: number, tol: number, skip?: ReadonlySet<string>): ShapeRecord | undefined {
  const ids = core.index.grid.queryPoint(x, y, tol);
  let best: ShapeRecord | undefined;
  for (const id of ids) {
    if (skip?.has(id) === true) continue;
    const s = core.index.shape(id);
    if (s === undefined || s.kind === 'group') continue;
    const g = shapeGeometry(s, core.store.kinds);
    if (g === undefined || !g.hit(x, y, tol)) continue;
    if (best === undefined || layerOf(s) > layerOf(best) || (layerOf(s) === layerOf(best) && (s.index > best.index || (s.index === best.index && s.id > best.id)))) best = s;
  }
  return best;
}

/** The unlocked shapes whose boxes meet `box`; a frame only when the box holds all of it (so a box drawn inside a frame selects what is in it). */
export function pickInBox(core: BoardCore, box: Bounds): ShapeRecord[] {
  const out: ShapeRecord[] = [];
  for (const id of core.index.grid.queryBox(box)) {
    const s = core.index.shape(id);
    if (s === undefined || s.locked || s.kind === 'group') continue;
    const g = shapeGeometry(s, core.store.kinds);
    if (g === undefined || !boxesMeet(g.bounds, box)) continue;
    if (s.kind === 'frame' && !(g.bounds.minX >= box.minX && g.bounds.maxX <= box.maxX && g.bounds.minY >= box.minY && g.bounds.maxY <= box.maxY)) continue;
    out.push(s);
  }
  return out;
}
