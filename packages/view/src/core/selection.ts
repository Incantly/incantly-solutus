/**
 * Selection (graphics-view design 11). Selection lives in the view, is never
 * part of the figure, and is not saved or replayed.
 */
import type { ObjId } from '@incantly/kernel';
import type { PxRect } from './coords';
import { pointInPolygon } from './geometry';

export interface SelectionState {
  readonly ids: ReadonlySet<ObjId>;
  readonly anchor: ObjId | null;
  readonly focus: ObjId | null;
}

export function emptySelection(): SelectionState {
  return { ids: new Set<ObjId>(), anchor: null, focus: null };
}

function withIds(sel: SelectionState, ids: ReadonlySet<ObjId>, anchor: ObjId | null, focus: ObjId | null): SelectionState {
  return { ids, anchor, focus };
}

/** Click: select one; shift/ctrl toggles; click on empty space clears. */
export function clickSelect(sel: SelectionState, hit: ObjId | null, additive: boolean, selectable: (id: ObjId) => boolean): SelectionState {
  if (hit === null) return additive ? sel : emptySelection();
  if (!selectable(hit)) return sel;
  if (!additive) return withIds(sel, new Set([hit]), hit, hit);
  const next = new Set(sel.ids);
  if (next.has(hit)) next.delete(hit);
  else next.add(hit);
  return withIds(sel, next, hit, hit);
}

/** Ctrl+A: all visible selectable objects. */
export function selectAll(ids: readonly ObjId[], selectable: (id: ObjId) => boolean): SelectionState {
  const next = new Set<ObjId>();
  for (const id of ids) if (selectable(id)) next.add(id);
  return { ids: next, anchor: null, focus: null };
}

export interface RubberBandShape {
  readonly id: ObjId;
  /** Stroked runs in view pixels. */
  readonly strokes: readonly Float32Array[];
  /** Filled rings in view pixels. */
  readonly fills: readonly Float32Array[];
}

function segmentIntersectsRect(ax: number, ay: number, bx: number, by: number, band: PxRect): boolean {
  const x0 = band.x0 as number;
  const x1 = band.x1 as number;
  const y0 = band.y0 as number;
  const y1 = band.y1 as number;
  if (ax >= x0 && ax <= x1 && ay >= y0 && ay <= y1) return true;
  if (bx >= x0 && bx <= x1 && by >= y0 && by <= y1) return true;
  // Segment vs the four band edges.
  const edges: ReadonlyArray<readonly [number, number, number, number]> = [
    [x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0],
  ];
  const orient = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number =>
    (qy - py) * (rx - qx) - (qx - px) * (ry - qy);
  for (const [ex0, ey0, ex1, ey1] of edges) {
    const d1 = orient(ex0, ey0, ex1, ey1, ax, ay);
    const d2 = orient(ex0, ey0, ex1, ey1, bx, by);
    const d3 = orient(ax, ay, bx, by, ex0, ey0);
    const d4 = orient(ax, ay, bx, by, ex1, ey1);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  }
  return false;
}

function runIntersectsBand(run: Float32Array, band: PxRect): boolean {
  for (let i = 0; i + 3 < run.length; i += 2) {
    if (segmentIntersectsRect(run[i] ?? 0, run[i + 1] ?? 0, run[i + 2] ?? 0, run[i + 3] ?? 0, band)) return true;
  }
  return false;
}

function bandStrictlyInsideFill(fills: readonly Float32Array[], band: PxRect): boolean {
  const corners: ReadonlyArray<readonly [number, number]> = [
    [band.x0 as number, band.y0 as number],
    [band.x1 as number, band.y0 as number],
    [band.x1 as number, band.y1 as number],
    [band.x0 as number, band.y1 as number],
  ];
  return fills.some((ring) => corners.every(([cx, cy]) => pointInPolygon(ring, cx, cy)));
}

/**
 * Rubber-band rule (design 11): an object is included if its shape intersects
 * the band; a band lying strictly inside a big fill does not select it.
 */
export function rubberBandSelect(shapes: readonly RubberBandShape[], band: PxRect, selectable: (id: ObjId) => boolean): ObjId[] {
  const out: ObjId[] = [];
  for (const s of shapes) {
    if (!selectable(s.id)) continue;
    let hit = false;
    for (const run of s.strokes) {
      if (runIntersectsBand(run, band)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      for (const ring of s.fills) {
        if (runIntersectsBand(ring, band)) {
          hit = true;
          break;
        }
      }
    }
    if (!hit && s.fills.length > 0 && bandStrictlyInsideFill(s.fills, band)) {
      hit = false;
    } else if (!hit && s.fills.length > 0) {
      // A fill fully inside the band (no edge contact) still counts.
      const inside = s.fills.some((ring) => {
        for (let i = 0; i + 1 < ring.length; i += 2) {
          const x = ring[i] ?? 0;
          const y = ring[i + 1] ?? 0;
          if (x >= (band.x0 as number) && x <= (band.x1 as number) && y >= (band.y0 as number) && y <= (band.y1 as number)) return true;
        }
        return false;
      });
      if (inside) hit = true;
    }
    if (hit) out.push(s.id);
  }
  return out;
}
