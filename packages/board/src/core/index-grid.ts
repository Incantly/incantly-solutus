/**
 * The spatial index of the current page (design 9): a sparse grid of 512-unit cells, each holding the ids of the
 * shapes whose bounds touch it. Insert, move and remove cost the cells a shape touches; a query reads only the cells
 * it covers. A shape that touches more than 1,024 cells is kept in a short list tested by every query, so one huge
 * frame does not fill the grid. Queries give the shapes whose bounds meet the region; the exact test (a stroke's
 * points, a shape's outline) belongs to the caller. No DOM, no timers.
 */
import { boardError, DONE } from './errors';
import type { BoardResult } from './errors';
import type { Bounds } from './types';

/** The side of one cell, in page units. */
export const CELL_SIZE = 512;

/** A shape that touches more cells than this is kept outside the grid. */
const BIG_CELLS = 1024;

// cell numbers stay inside ±2^21, so a cell key is one integer below 2^44
const OFFSET = 1 << 21;
const SPAN = 1 << 22;

const cellOf = (v: number): number => {
  const c = Math.floor(v / CELL_SIZE);
  return c < 1 - OFFSET ? 1 - OFFSET : c > OFFSET - 2 ? OFFSET - 2 : c;
};
const keyOf = (cx: number, cy: number): number => (cx + OFFSET) * SPAN + (cy + OFFSET);

class Entry {
  cx0 = 0;
  cy0 = 0;
  cx1 = 0;
  cy1 = 0;
  big = false;
  /** The query that last saw this entry, so a shape in many cells is given once. */
  stamp = 0;

  constructor(
    public minX: number,
    public minY: number,
    public maxX: number,
    public maxY: number,
  ) {}
}

const validBounds = (b: Bounds): boolean =>
  typeof b === 'object' &&
  b !== null &&
  Number.isFinite(b.minX) &&
  Number.isFinite(b.minY) &&
  Number.isFinite(b.maxX) &&
  Number.isFinite(b.maxY) &&
  b.minX <= b.maxX &&
  b.minY <= b.maxY;

const meets = (e: Entry, minX: number, minY: number, maxX: number, maxY: number): boolean =>
  e.minX <= maxX && e.maxX >= minX && e.minY <= maxY && e.maxY >= minY;

export class IndexGrid {
  readonly #cells = new Map<number, Set<string>>();
  readonly #entries = new Map<string, Entry>();
  readonly #big = new Set<string>();
  #stamp = 0;

  /** The number of shapes in the index. */
  get size(): number {
    return this.#entries.size;
  }

  /** The number of cells that hold a shape. */
  get cellCount(): number {
    return this.#cells.size;
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  /** The bounds the index holds for a shape. */
  boundsOf(id: string): Bounds | undefined {
    const e = this.#entries.get(id);
    return e === undefined ? undefined : { minX: e.minX, minY: e.minY, maxX: e.maxX, maxY: e.maxY };
  }

  clear(): void {
    this.#cells.clear();
    this.#entries.clear();
    this.#big.clear();
  }

  /** Adds a shape with its bounds; an id that is already in the index moves instead. */
  insert(id: string, bounds: Bounds): BoardResult<undefined> {
    if (!validBounds(bounds)) return boardError('bad_argument', `The bounds of "${id}" must be finite, with min not above max.`, { detail: { record: id } });
    if (this.#entries.has(id)) return this.move(id, bounds);
    const e = new Entry(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    this.#range(e);
    this.#entries.set(id, e);
    this.#addCells(id, e);
    return DONE;
  }

  /** Gives a shape new bounds, touching only the cells that differ. */
  move(id: string, bounds: Bounds): BoardResult<undefined> {
    const e = this.#entries.get(id);
    if (e === undefined) return boardError('bad_argument', `"${id}" is not in the index.`, { detail: { record: id } });
    if (!validBounds(bounds)) return boardError('bad_argument', `The bounds of "${id}" must be finite, with min not above max.`, { detail: { record: id } });
    const [cx0, cy0, cx1, cy1, big] = [e.cx0, e.cy0, e.cx1, e.cy1, e.big];
    e.minX = bounds.minX;
    e.minY = bounds.minY;
    e.maxX = bounds.maxX;
    e.maxY = bounds.maxY;
    this.#range(e);
    if (big !== e.big) {
      this.#dropCells(id, cx0, cy0, cx1, cy1, big);
      this.#addCells(id, e);
    } else if (!big && (cx0 !== e.cx0 || cy0 !== e.cy0 || cx1 !== e.cx1 || cy1 !== e.cy1)) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          if (cx < e.cx0 || cx > e.cx1 || cy < e.cy0 || cy > e.cy1) this.#leave(keyOf(cx, cy), id);
        }
      }
      for (let cx = e.cx0; cx <= e.cx1; cx++) {
        for (let cy = e.cy0; cy <= e.cy1; cy++) {
          if (cx < cx0 || cx > cx1 || cy < cy0 || cy > cy1) this.#join(keyOf(cx, cy), id);
        }
      }
    }
    return DONE;
  }

  /** Takes a shape out. Returns false when it was not in the index. */
  remove(id: string): boolean {
    const e = this.#entries.get(id);
    if (e === undefined) return false;
    this.#dropCells(id, e.cx0, e.cy0, e.cx1, e.cy1, e.big);
    this.#entries.delete(id);
    return true;
  }

  /** Ids of the shapes whose bounds meet the box (inclusive). Appends to `out` and returns it. */
  queryBox(box: Bounds, out: string[] = []): string[] {
    if (!validBounds(box)) return out;
    this.#collect(box.minX, box.minY, box.maxX, box.maxY, undefined, out);
    return out;
  }

  /** The same as `queryBox`: the shapes to draw for a viewport (grown by the culling margin by the caller). */
  queryViewport(box: Bounds, out: string[] = []): string[] {
    return this.queryBox(box, out);
  }

  /** Ids of the shapes whose bounds hold the point, or come within `tolerance` page units of it. */
  queryPoint(x: number, y: number, tolerance = 0, out: string[] = []): string[] {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(tolerance) || tolerance < 0) return out;
    this.#collect(x - tolerance, y - tolerance, x + tolerance, y + tolerance, undefined, out);
    return out;
  }

  /**
   * Ids of the shapes whose bounds meet a polygon, given as `[x0, y0, x1, y1, …]` (at least 3 points). A shape
   * whose bounds only meet the polygon's own box is left out.
   */
  queryLasso(polygon: readonly number[], out: string[] = []): string[] {
    const n = polygon.length;
    if (n < 6 || n % 2 !== 0) return out;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i += 2) {
      const x = polygon[i] as number;
      const y = polygon[i + 1] as number;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return out;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.#collect(minX, minY, maxX, maxY, (e) => (polygonMeetsBox(polygon, e.minX, e.minY, e.maxX, e.maxY) ? 1 : 0), out);
    return out;
  }

  /**
   * Like `queryLasso`, and tells for each id (`whole[i]` for `out[i]`, both appended) whether the shape's bounds lie
   * wholly inside the polygon, so the caller needs no point test for it (BR-15). The polygon's own box is tested
   * first, then only the shapes whose bounds meet that box are tested against the polygon.
   */
  queryLassoSplit(polygon: readonly number[], out: string[], whole: boolean[]): void {
    const n = polygon.length;
    if (n < 6 || n % 2 !== 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i += 2) {
      const x = polygon[i] as number;
      const y = polygon[i + 1] as number;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    this.#collect(
      minX,
      minY,
      maxX,
      maxY,
      (e) => {
        // a box wholly inside the polygon: no edge touches it and a corner is inside
        if (e.minX >= minX && e.maxX <= maxX && e.minY >= minY && e.maxY <= maxY && !polygonTouchesBoxEdge(polygon, e.minX, e.minY, e.maxX, e.maxY)) {
          // nothing of the polygon is in or on the box, so every point of the box is on the same side
          return pointInPolygon(e.minX, e.minY, polygon) ? 2 : 0;
        }
        return polygonMeetsBox(polygon, e.minX, e.minY, e.maxX, e.maxY) ? 1 : 0;
      },
      out,
      whole,
    );
  }

  #range(e: Entry): void {
    e.cx0 = cellOf(e.minX);
    e.cy0 = cellOf(e.minY);
    e.cx1 = cellOf(e.maxX);
    e.cy1 = cellOf(e.maxY);
    e.big = (e.cx1 - e.cx0 + 1) * (e.cy1 - e.cy0 + 1) > BIG_CELLS;
  }

  #addCells(id: string, e: Entry): void {
    if (e.big) {
      this.#big.add(id);
      return;
    }
    for (let cx = e.cx0; cx <= e.cx1; cx++) for (let cy = e.cy0; cy <= e.cy1; cy++) this.#join(keyOf(cx, cy), id);
  }

  #dropCells(id: string, cx0: number, cy0: number, cx1: number, cy1: number, big: boolean): void {
    if (big) {
      this.#big.delete(id);
      return;
    }
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) this.#leave(keyOf(cx, cy), id);
  }

  #join(key: number, id: string): void {
    let set = this.#cells.get(key);
    if (set === undefined) this.#cells.set(key, (set = new Set()));
    set.add(id);
  }

  #leave(key: number, id: string): void {
    const set = this.#cells.get(key);
    if (set === undefined) return;
    set.delete(id);
    if (set.size === 0) this.#cells.delete(key);
  }

  /**
   * The ids of the entries whose box meets the region and that `classify` keeps: 0 leaves it out, 1 keeps it, 2 keeps
   * it and tells `whole` (when given) that the entry lies wholly inside what the caller asked for.
   */
  #collect(minX: number, minY: number, maxX: number, maxY: number, classify: ((e: Entry) => 0 | 1 | 2) | undefined, out: string[], whole?: boolean[]): void {
    const stamp = ++this.#stamp;
    const visit = (id: string): void => {
      const e = this.#entries.get(id);
      if (e === undefined || e.stamp === stamp) return;
      e.stamp = stamp;
      if (!meets(e, minX, minY, maxX, maxY)) return;
      const kind = classify === undefined ? 1 : classify(e);
      if (kind === 0) return;
      out.push(id);
      whole?.push(kind === 2);
    };
    const cx0 = cellOf(minX);
    const cy0 = cellOf(minY);
    const cx1 = cellOf(maxX);
    const cy1 = cellOf(maxY);
    const covered = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    if (covered <= this.#cells.size) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const set = this.#cells.get(keyOf(cx, cy));
          if (set !== undefined) for (const id of set) visit(id);
        }
      }
    } else {
      // the query covers more cells than the index holds: read the held cells instead
      for (const [key, set] of this.#cells) {
        const cx = Math.floor(key / SPAN) - OFFSET;
        const cy = (key % SPAN) - OFFSET;
        if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1) for (const id of set) visit(id);
      }
    }
    for (const id of this.#big) visit(id);
  }
}

/** True when the point is inside the polygon (even-odd rule). */
export function pointInPolygon(x: number, y: number, polygon: readonly number[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = polygon[i] as number;
    const yi = polygon[i + 1] as number;
    const xj = polygon[j] as number;
    const yj = polygon[j + 1] as number;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0);
}

/** Like `segmentsCross`, and true for collinear segments too: a wrong yes only sends a shape to the point test. */
function segmentsTouch(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

/**
 * True when an edge of the polygon touches the outline of the box, or a vertex of the polygon is inside the box. When
 * it is false the box is wholly inside the polygon or wholly outside it (all its corners agree), so one corner tells.
 * An edge whose own box does not meet the box is skipped at once.
 */
function polygonTouchesBoxEdge(polygon: readonly number[], minX: number, minY: number, maxX: number, maxY: number): boolean {
  const n = polygon.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ax = polygon[j] as number;
    const ay = polygon[j + 1] as number;
    const bx = polygon[i] as number;
    const by = polygon[i + 1] as number;
    if ((ax < minX && bx < minX) || (ax > maxX && bx > maxX) || (ay < minY && by < minY) || (ay > maxY && by > maxY)) continue;
    if (bx >= minX && bx <= maxX && by >= minY && by <= maxY) return true;
    if (
      segmentsTouch(ax, ay, bx, by, minX, minY, maxX, minY) ||
      segmentsTouch(ax, ay, bx, by, maxX, minY, maxX, maxY) ||
      segmentsTouch(ax, ay, bx, by, maxX, maxY, minX, maxY) ||
      segmentsTouch(ax, ay, bx, by, minX, maxY, minX, minY)
    ) {
      return true;
    }
  }
  return false;
}

/** True when the polygon and the box share a point. */
export function polygonMeetsBox(polygon: readonly number[], minX: number, minY: number, maxX: number, maxY: number): boolean {
  const n = polygon.length;
  for (let i = 0; i < n; i += 2) {
    const x = polygon[i] as number;
    const y = polygon[i + 1] as number;
    if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
  }
  if (pointInPolygon(minX, minY, polygon) || pointInPolygon(maxX, minY, polygon) || pointInPolygon(maxX, maxY, polygon) || pointInPolygon(minX, maxY, polygon)) {
    return true;
  }
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ax = polygon[j] as number;
    const ay = polygon[j + 1] as number;
    const bx = polygon[i] as number;
    const by = polygon[i + 1] as number;
    if (
      segmentsCross(ax, ay, bx, by, minX, minY, maxX, minY) ||
      segmentsCross(ax, ay, bx, by, maxX, minY, maxX, maxY) ||
      segmentsCross(ax, ay, bx, by, maxX, maxY, minX, maxY) ||
      segmentsCross(ax, ay, bx, by, minX, maxY, minX, minY)
    ) {
      return true;
    }
  }
  return false;
}
