/**
 * Marker bookkeeping shared by every tracer: repeats of one kind within a
 * pixel collapse to one marker, found through a hash of pixel cells so each
 * insert looks at 9 cells instead of every kept marker, and the count is
 * capped (performance.md 5), so work and output follow the cap, not the leaf
 * count squared.
 */
import type { MarkerKind, PlotMarker } from './contracts';
import type { PlotView } from './view';

/** Cells beyond this many pixels from the origin share one clamped cell. */
const CELL_LIMIT = 1 << 24;
const CELL_SPAN = 2 * CELL_LIMIT + 1;

function cellOf(v: number): number {
  const c = Math.floor(v);
  return c < -CELL_LIMIT ? -CELL_LIMIT : c > CELL_LIMIT ? CELL_LIMIT : c;
}

function cellKey(cx: number, cy: number): number {
  return (cx + CELL_LIMIT) * CELL_SPAN + (cy + CELL_LIMIT);
}

/** Markers de-duplicated by pixel cell and capped at `cap`. */
export class MarkerSet {
  readonly list: PlotMarker[] = [];
  /** True once a marker was dropped because the cap was reached. */
  dropped = false;
  private readonly cells = new Map<MarkerKind, Map<number, PlotMarker[]>>();

  constructor(private readonly cap: number) {}

  get size(): number {
    return this.list.length;
  }

  /** Adds a marker unless one of its kind sits within a pixel; false when it was not kept. */
  add(marker: PlotMarker): boolean {
    const { px, py } = marker;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    let byCell = this.cells.get(marker.kind);
    if (byCell === undefined) {
      byCell = new Map();
      this.cells.set(marker.kind, byCell);
    }
    const cx = cellOf(px);
    const cy = cellOf(py);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = byCell.get(cellKey(cx + dx, cy + dy));
        if (bucket === undefined) continue;
        for (const o of bucket) if (Math.hypot(o.px - px, o.py - py) < 1) return false;
      }
    }
    if (this.list.length >= this.cap) {
      this.dropped = true;
      return false;
    }
    const key = cellKey(cx, cy);
    const bucket = byCell.get(key);
    if (bucket === undefined) byCell.set(key, [marker]);
    else bucket.push(marker);
    this.list.push(marker);
    return true;
  }

  /** The kept markers sorted by position. */
  sorted(): PlotMarker[] {
    return [...this.list].sort((a, b) => a.x - b.x || a.y - b.y);
  }
}

/**
 * Builds a marker at (x, y), or undefined when it cannot be drawn: non-finite
 * coordinates, or a pixel position outside the clip box the paths use,
 * `[-4w, 5w] x [-4h, 5h]` (a marker that far off screen is never seen). A
 * `pole` is the exception: it marks where a branch leaves to infinity, so it
 * is moved onto the clip box edge along the way out.
 */
export function makeMarker(pv: PlotView, kind: MarkerKind, x: number, y: number): PlotMarker | undefined {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  let px = pv.toPx(x);
  let py = pv.toPy(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return undefined;
  const w = pv.box.widthPx;
  const h = pv.box.heightPx;
  if (px >= -4 * w && px <= 5 * w && py >= -4 * h && py <= 5 * h) return { kind, x, y, px, py };
  if (kind !== 'pole') return undefined;
  px = px < -4 * w ? -4 * w : px > 5 * w ? 5 * w : px;
  py = py < -4 * h ? -4 * h : py > 5 * h ? 5 * h : py;
  return { kind, x: pv.toX(px), y: pv.toY(py), px, py };
}
