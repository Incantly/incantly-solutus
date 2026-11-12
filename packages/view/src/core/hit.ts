/**
 * Hit testing (graphics-view design 10): candidates, slack, the uniform grid
 * index, ranking, cycling through overlaps and tool filtering.
 */
import type { ObjId, TypeName } from '@incantly/kernel';
import type { PxPoint, PxRect } from './coords';

export type HitPart = 'body' | 'edge' | 'fill' | 'label' | 'handle' | 'thumb';

export interface HitCandidate {
  readonly id: ObjId;
  readonly part: HitPart;
  /** Pixels from the pointer to the nearest part of the shape. */
  readonly distance: number;
  /** Lower wins: label 0, point 1, text/widget 2, edge 3, fill 4, image 5. */
  readonly priority: number;
  /** For edges: the path parameter of the nearest point. */
  readonly param?: number;
}

export interface HitList {
  readonly at: PxPoint;
  /** Already sorted, best first. */
  readonly candidates: readonly HitCandidate[];
}

export type PointerKind = 'mouse' | 'pen' | 'touch';

/**
 * Slack in view pixels (design 10.2). Hover uses the mouse slack; touch draws
 * the hit area at `max(r, 12)` without changing the drawn size.
 */
export function slackFor(pointer: PointerKind, target: 'point' | 'edge' | 'fill', radius: number): number {
  if (target === 'fill') return 0;
  if (target === 'point') {
    switch (pointer) {
      case 'mouse': return radius + 3;
      case 'pen': return radius + 5;
      case 'touch': return Math.max(radius, 12) + 4;
    }
  }
  switch (pointer) {
    case 'mouse': return 3;
    case 'pen': return 5;
    case 'touch': return 12;
  }
}

/** Cell size of the uniform hit grid (design 10.3). */
export const HIT_CELL_PX = 64;

/**
 * Uniform grid over the canvas: drawable ids by the cells their bbox overlaps.
 * A query reads one cell (plus neighbours when slack reaches them), then the
 * host calls `hit` on those few drawables.
 */
export class HitIndex {
  private readonly cells = new Map<string, Set<ObjId>>();
  private readonly boxes = new Map<ObjId, PxRect>();

  get size(): number {
    return this.boxes.size;
  }

  private static key(cx: number, cy: number): string {
    return `${cx},${cy}`;
  }

  private cellsFor(box: PxRect): string[] {
    const x0 = Math.floor((box.x0 as number) / HIT_CELL_PX);
    const x1 = Math.floor((box.x1 as number) / HIT_CELL_PX);
    const y0 = Math.floor((box.y0 as number) / HIT_CELL_PX);
    const y1 = Math.floor((box.y1 as number) / HIT_CELL_PX);
    const keys: string[] = [];
    // Guard against a degenerate box covering the world (clamp span).
    if (x1 - x0 > 512 || y1 - y0 > 512) return keys;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) keys.push(HitIndex.key(cx, cy));
    }
    return keys;
  }

  insert(id: ObjId, box: PxRect | null): void {
    this.remove(id);
    if (box === null) return;
    this.boxes.set(id, box);
    for (const key of this.cellsFor(box)) {
      let set = this.cells.get(key);
      if (set === undefined) {
        set = new Set<ObjId>();
        this.cells.set(key, set);
      }
      set.add(id);
    }
  }

  remove(id: ObjId): void {
    const box = this.boxes.get(id);
    if (box === undefined) return;
    this.boxes.delete(id);
    for (const key of this.cellsFor(box)) {
      const set = this.cells.get(key);
      if (set === undefined) continue;
      set.delete(id);
      if (set.size === 0) this.cells.delete(key);
    }
  }

  update(id: ObjId, box: PxRect | null): void {
    this.insert(id, box);
  }

  /** Rebuild from scratch after a viewport change (cost O(n)). */
  rebuild(entries: ReadonlyArray<{ id: ObjId; box: PxRect | null }>): void {
    this.cells.clear();
    this.boxes.clear();
    for (const e of entries) this.insert(e.id, e.box);
  }

  query(at: PxPoint, slackPx: number): ObjId[] {
    const x = at.x as number;
    const y = at.y as number;
    const reach = Math.ceil(slackPx / HIT_CELL_PX);
    const cx = Math.floor(x / HIT_CELL_PX);
    const cy = Math.floor(y / HIT_CELL_PX);
    const out = new Set<ObjId>();
    for (let ix = cx - reach; ix <= cx + reach; ix++) {
      for (let iy = cy - reach; iy <= cy + reach; iy++) {
        const set = this.cells.get(HitIndex.key(ix, iy));
        if (set === undefined) continue;
        for (const id of set) out.add(id);
      }
    }
    return [...out];
  }
}

/**
 * Rank hits (design 10.4): priority, then distance, then later in draw order
 * (on top) wins. `drawRank` is the drawable's index in the sorted draw list.
 */
export function rankCandidates(
  candidates: readonly HitCandidate[],
  drawRank: (id: ObjId) => number,
): HitCandidate[] {
  return [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return drawRank(b.id) - drawRank(a.id);
  });
}

export interface ToolFilter {
  readonly types: readonly TypeName[];
  readonly parts?: readonly HitPart[];
  readonly exclude?: readonly ObjId[];
}

/** Drop candidates the current tool does not want (design 10.6). */
export function filterCandidates(
  candidates: readonly HitCandidate[],
  filter: ToolFilter,
  typeOf: (id: ObjId) => TypeName | undefined,
): HitCandidate[] {
  const excluded = new Set(filter.exclude ?? []);
  const wanted = new Set(filter.types);
  const parts = filter.parts === undefined ? null : new Set(filter.parts);
  return candidates.filter((c) => {
    if (excluded.has(c.id)) return false;
    const t = typeOf(c.id);
    if (t === undefined || !wanted.has(t)) return false;
    if (parts !== null && !parts.has(c.part)) return false;
    return true;
  });
}

export interface CycleState {
  lastX: number;
  lastY: number;
  lastTimeMs: number;
  index: number;
}

export function createCycleState(): CycleState {
  return { lastX: 0, lastY: 0, lastTimeMs: -10000, index: 0 };
}

export interface CyclePick {
  readonly candidate: HitCandidate;
  /** 1-based position in the candidate list. */
  readonly position: number;
  readonly total: number;
  readonly state: CycleState;
}

/**
 * Step through overlapping candidates: a repeat click within 3 px and 800 ms
 * moves to the next one (design 10.5). Keyboard users get the same list.
 */
export function cyclePick(
  state: CycleState,
  sorted: readonly HitCandidate[],
  x: number,
  y: number,
  nowMs: number,
): CyclePick | null {
  if (sorted.length === 0) return null;
  const first = sorted[0];
  if (first === undefined) return null;
  const sameSpot = Math.hypot(x - state.lastX, y - state.lastY) <= 3 && nowMs - state.lastTimeMs <= 800;
  const index = sameSpot ? (state.index + 1) % sorted.length : 0;
  const candidate = sorted[index] ?? first;
  const next: CycleState = { lastX: x, lastY: y, lastTimeMs: nowMs, index };
  return { candidate, position: index + 1, total: sorted.length, state: next };
}

/** Tooltip for a cycled pick: `2 of 3: a`. */
export function cycleTooltip(pick: CyclePick, names: readonly string[]): string {
  if (pick.total <= 1) return names[0] ?? '';
  return `${pick.position} of ${pick.total}: ${names.join(', ')}`;
}
