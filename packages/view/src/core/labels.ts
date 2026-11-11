/**
 * Label layout (graphics-view design 9.7): preferred offsets, user offsets in
 * view pixels, auto-placement over 8 candidates with hysteresis, and the
 * per-frame cost bound. Runs in the layout phase between update and paint.
 */
import type { ObjId } from '@incantly/kernel';

/** At most 200 labels auto-place per frame; the rest keep position (9.7). */
export const MAX_AUTO_LABELS_PER_FRAME = 200;
/** A label that fit keeps its spot unless the score worsens by 25%+. */
export const LABEL_HYSTERESIS = 0.25;
/** A leader line appears past 20 px from the object (ui.md 3). */
export const LEADER_LINE_PX = 20;

export interface LabelInput {
  readonly id: ObjId;
  /** Anchor in view pixels. */
  readonly anchorX: number;
  readonly anchorY: number;
  readonly widthPx: number;
  readonly heightPx: number;
  /** User-dragged offset in view pixels; set means auto-placement is off. */
  readonly userDx: number | null;
  readonly userDy: number | null;
  /** Last frame's offset, for hysteresis. */
  readonly prevDx: number | null;
  readonly prevDy: number | null;
  readonly prevScore: number | null;
}

export interface LabelMarker {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export interface LabelPlacement {
  readonly id: ObjId;
  /** Chosen top-left offset from the anchor, in view pixels. */
  readonly dx: number;
  readonly dy: number;
  readonly score: number;
  readonly leader: boolean;
}

/** Eight candidate positions around the anchor (top-left offsets). */
function candidates(w: number, h: number): Array<readonly [number, number]> {
  const g = 6;
  return [
    [g, -h - g],
    [-w - g, -h - g],
    [g, g],
    [-w - g, g],
    [g, -h / 2],
    [-w - g, -h / 2],
    [-w / 2, -h - g],
    [-w / 2, g],
  ];
}

function overlapArea(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): number {
  const ox = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
  const oy = Math.min(ay + ah, by + bh) - Math.max(ay, by);
  return ox > 0 && oy > 0 ? ox * oy : 0;
}

export interface PlacedRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const CELL_PX = 64;
/** A rectangle covering more cells than this is kept on a short list checked by every query. */
const MAX_CELLS_PER_ITEM = 256;

/**
 * Uniform grid over rectangles, so a candidate label tests only the placed
 * labels and markers near it instead of all of them (VIEW-SM-21).
 */
class CellIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly big: number[] = [];

  private static key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }

  private static cell(v: number): number {
    return Math.max(-32000, Math.min(32000, Math.floor(v / CELL_PX)));
  }

  insert(i: number, x0: number, y0: number, x1: number, y1: number): void {
    const cx0 = CellIndex.cell(x0);
    const cx1 = CellIndex.cell(x1);
    const cy0 = CellIndex.cell(y0);
    const cy1 = CellIndex.cell(y1);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELLS_PER_ITEM) {
      this.big.push(i);
      return;
    }
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = CellIndex.key(cx, cy);
        const list = this.cells.get(k);
        if (list === undefined) this.cells.set(k, [i]);
        else list.push(i);
      }
    }
  }

  /** Indices of items whose cells meet the rectangle, ascending and unique. */
  query(x0: number, y0: number, x1: number, y1: number): number[] {
    const seen = new Set<number>(this.big);
    const cx0 = CellIndex.cell(x0);
    const cx1 = CellIndex.cell(x1);
    const cy0 = CellIndex.cell(y0);
    const cy1 = CellIndex.cell(y1);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const list = this.cells.get(CellIndex.key(cx, cy));
        if (list === undefined) continue;
        for (const i of list) seen.add(i);
      }
    }
    return [...seen].sort((a, b) => a - b);
  }
}

/**
 * Place labels in order. Labels beyond the cost bound keep their previous
 * offset (or the default candidate when new).
 */
export function placeLabels(
  labels: readonly LabelInput[],
  markers: readonly LabelMarker[],
  maxAuto: number = MAX_AUTO_LABELS_PER_FRAME,
): LabelPlacement[] {
  const placed: PlacedRect[] = [];
  const placedIndex = new CellIndex();
  const markerIndex = new CellIndex();
  markers.forEach((m, i) => {
    const reach = 6 + m.r;
    markerIndex.insert(i, m.x - reach, m.y - reach, m.x + reach, m.y + reach);
  });
  const place = (r: PlacedRect): void => {
    placed.push(r);
    placedIndex.insert(placed.length - 1, r.x, r.y, r.x + r.w, r.y + r.h);
  };
  const out: LabelPlacement[] = [];
  let autoCount = 0;
  for (const label of labels) {
    if (label.userDx !== null && label.userDy !== null) {
      const dx = label.userDx;
      const dy = label.userDy;
      place({ x: label.anchorX + dx, y: label.anchorY + dy, w: label.widthPx, h: label.heightPx });
      out.push({ id: label.id, dx, dy, score: 0, leader: Math.hypot(dx, dy) > LEADER_LINE_PX });
      continue;
    }
    if (autoCount >= maxAuto) {
      const dx = label.prevDx ?? candidates(label.widthPx, label.heightPx)[0]?.[0] ?? 6;
      const dy = label.prevDy ?? candidates(label.widthPx, label.heightPx)[0]?.[1] ?? -6;
      place({ x: label.anchorX + dx, y: label.anchorY + dy, w: label.widthPx, h: label.heightPx });
      out.push({ id: label.id, dx, dy, score: label.prevScore ?? 0, leader: Math.hypot(dx, dy) > LEADER_LINE_PX });
      continue;
    }
    autoCount++;
    let bestDx = 0;
    let bestDy = 0;
    let bestScore = Infinity;
    for (const [dx, dy] of candidates(label.widthPx, label.heightPx)) {
      const x = label.anchorX + dx;
      const y = label.anchorY + dy;
      let score = 0;
      for (const i of placedIndex.query(x, y, x + label.widthPx, y + label.heightPx)) {
        const p = placed[i];
        if (p !== undefined) score += overlapArea(x, y, label.widthPx, label.heightPx, p.x, p.y, p.w, p.h);
      }
      for (const i of markerIndex.query(x, y, x + label.widthPx, y + label.heightPx)) {
        const m = markers[i];
        if (m === undefined) continue;
        const cx = Math.min(Math.max(m.x, x), x + label.widthPx);
        const cy = Math.min(Math.max(m.y, y), y + label.heightPx);
        if (Math.hypot(m.x - cx, m.y - cy) < 6 + m.r) score += 500;
      }
      // Prefer the default (first) candidate on ties, for stability.
      if (score < bestScore) {
        bestScore = score;
        bestDx = dx;
        bestDy = dy;
      }
    }
    if (label.prevDx !== null && label.prevDy !== null && label.prevScore !== null &&
      label.prevScore <= bestScore * (1 + LABEL_HYSTERESIS)) {
      bestDx = label.prevDx;
      bestDy = label.prevDy;
      bestScore = label.prevScore;
    }
    place({ x: label.anchorX + bestDx, y: label.anchorY + bestDy, w: label.widthPx, h: label.heightPx });
    out.push({ id: label.id, dx: bestDx, dy: bestDy, score: bestScore, leader: Math.hypot(bestDx, bestDy) > LEADER_LINE_PX });
  }
  return out;
}
