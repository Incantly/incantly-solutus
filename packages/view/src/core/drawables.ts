/**
 * Drawables, the draw list and the paint phases (graphics-view design 6-8).
 *
 * One drawable per kernel object. A drawable caches screen geometry and
 * rebuilds it only when its value, style or the viewport demands it. Frames
 * run in three phases: update (rebuild dirty), layout (labels), paint.
 */
import type { ObjId } from '@incantly/kernel';
import type { KernelEvent, KernelView, ValueOrUndef, ViewObjectHead } from '../contracts';
import type { PxPoint, PxRect, Viewport } from './coords';
import type { HitCandidate } from './hit';
import type { AuthoredStyle, ResolvedStyle, StyleEvaluator, Theme } from './styles';
import { resolveStyle } from './styles';
import { rectsOverlap, type Surface } from './surface';

export type PaintKind =
  | 'region' | 'curve' | 'line' | 'segment' | 'vector' | 'arc' | 'angle'
  | 'point' | 'text' | 'widget' | 'particles' | 'image';

/** Type rank, low to high (design 8). Particles sit at 5 with points. */
export const TYPE_RANK: Readonly<Record<PaintKind, number>> = {
  image: 0,
  region: 1,
  curve: 2,
  arc: 2,
  line: 3,
  segment: 3,
  vector: 3,
  angle: 4,
  point: 5,
  particles: 5,
  text: 6,
  widget: 7,
};

export interface SortKey {
  readonly layer: number;
  readonly rank: number;
  readonly order: number;
}

export function compareSortKey(a: SortKey, b: SortKey): number {
  if (a.layer !== b.layer) return a.layer - b.layer;
  if (a.rank !== b.rank) return a.rank - b.rank;
  return a.order - b.order;
}

export type OutlineMode = 'hover' | 'selected' | 'focus' | 'pulse';

export interface PaintContext {
  readonly view: Viewport;
  readonly theme: Theme;
  readonly selected: ReadonlySet<ObjId>;
  readonly hovered: ObjId | null;
  readonly focused: ObjId | null;
  readonly reducedMotion: boolean;
  /** Film time in seconds, for dash-phase and pulse effects. */
  readonly t: number;
}

export interface DrawableInput {
  readonly head: ViewObjectHead;
  readonly value: ValueOrUndef;
}

export interface Drawable {
  readonly id: ObjId;
  readonly kind: PaintKind;
  readonly rank: number;
  readonly bbox: PxRect | null;
  readonly sortKey: SortKey;
  /** Recompute geometry; false when there is nothing to draw. */
  update(input: DrawableInput, view: Viewport, style: ResolvedStyle): boolean;
  paint(s: Surface, ctx: PaintContext): void;
  /** Labels paint in a per-layer text pass, after shapes (design 8). */
  paintLabel(s: Surface, ctx: PaintContext): void;
  hit(p: PxPoint, slack: number): HitCandidate | null;
  outline(s: Surface, mode: OutlineMode): void;
  describe(): string;
}

/** Drawables whose geometry depends on the viewport, not just the value (7.2). */
export const VIEWPORT_DEPENDENT: Readonly<Set<PaintKind>> = new Set<PaintKind>([
  'line', 'curve', 'arc', 'text', 'particles',
]);

export interface DrawListEntry {
  readonly drawable: Drawable;
  valueDirty: boolean;
  viewDirty: boolean;
}

/**
 * The sorted draw list. Insertions find their sort position by binary search;
 * removals report the last bbox as damaged.
 */
export class DrawList {
  private readonly entries: DrawListEntry[] = [];
  private readonly byId = new Map<ObjId, DrawListEntry>();

  get size(): number {
    return this.entries.length;
  }

  ids(): ObjId[] {
    return this.entries.map((e) => e.drawable.id);
  }

  get(id: ObjId): DrawListEntry | undefined {
    return this.byId.get(id);
  }

  sorted(): readonly DrawListEntry[] {
    return this.entries;
  }

  add(drawable: Drawable): void {
    const entry: DrawListEntry = { drawable, valueDirty: true, viewDirty: true };
    const key = drawable.sortKey;
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const cur = this.entries[mid];
      if (cur === undefined) break;
      if (compareSortKey(cur.drawable.sortKey, key) < 0) lo = mid + 1;
      else hi = mid;
    }
    this.entries.splice(lo, 0, entry);
    this.byId.set(drawable.id, entry);
  }

  /** Remove ids; returns the damaged bboxes of what was covered. */
  remove(ids: readonly ObjId[]): PxRect[] {
    const damaged: PxRect[] = [];
    for (const id of ids) {
      const entry = this.byId.get(id);
      if (entry === undefined) continue;
      this.byId.delete(id);
      const at = this.entries.indexOf(entry);
      if (at >= 0) this.entries.splice(at, 1);
      if (entry.drawable.bbox !== null) damaged.push(entry.drawable.bbox);
    }
    return damaged;
  }

  /** Reinsert a drawable whose sort key changed (layer or order moved). */
  resort(id: ObjId): void {
    const entry = this.byId.get(id);
    if (entry === undefined) return;
    const at = this.entries.indexOf(entry);
    if (at >= 0) this.entries.splice(at, 1);
    this.byId.delete(id);
    this.add(entry.drawable);
    const back = this.byId.get(id);
    if (back !== undefined) {
      back.valueDirty = entry.valueDirty;
      back.viewDirty = entry.viewDirty;
    }
  }

  /** Apply one kernel event: create, mark dirty, or drop (design 7.1). */
  applyEvent(event: KernelEvent, create: (id: ObjId) => Drawable | null): PxRect[] {
    switch (event.kind) {
      case 'add': {
        for (const id of event.ids) {
          if (this.byId.has(id)) continue;
          const d = create(id);
          if (d !== null) this.add(d);
        }
        return [];
      }
      case 'update':
      case 'restyle': {
        for (const id of event.ids) {
          const entry = this.byId.get(id);
          if (entry !== undefined) {
            entry.valueDirty = true;
            entry.viewDirty = true;
          }
        }
        return [];
      }
      case 'remove':
        return this.remove(event.ids);
    }
  }

  markViewDirtyAll(): void {
    for (const e of this.entries) e.viewDirty = true;
  }

  /**
   * Pan-only optimisation (7.2): translation shifts cached pixels; only
   * clip-dependent drawables rebuild. Drawables that support shifting expose
   * `shiftPixels`; the rest are marked view-dirty.
   */
  markPanDirty(dxPx: number, dyPx: number): void {
    for (const e of this.entries) {
      const d = e.drawable as Drawable & { shiftPixels?: (dx: number, dy: number) => boolean };
      if (typeof d.shiftPixels === 'function' && d.shiftPixels(dxPx, dyPx)) continue;
      e.viewDirty = true;
    }
  }

  activeIds(): ObjId[] {
    return this.entries.filter((e) => e.valueDirty || e.viewDirty).map((e) => e.drawable.id);
  }
}

/** Where the view reads authored styles and evaluates style references. */
export interface StyleStore {
  readonly authoredOf: (id: ObjId) => { kind: PaintKind; free: boolean; style: AuthoredStyle } | undefined;
  readonly evaluator: StyleEvaluator;
}

export interface UpdateStores {
  readonly kernel: KernelView;
  readonly styles: StyleStore;
}

export interface UpdateReport {
  readonly rebuilt: number;
  readonly hidden: number;
}

/**
 * Update phase: rebuild every dirty drawable in draw order (design 7.3).
 * Undefined, invisible and show-if-false objects keep their slot with no
 * geometry, so becoming defined again is instant.
 */
export function updateDrawables(
  list: DrawList,
  stores: UpdateStores,
  view: Viewport,
  onBbox: (id: ObjId, bbox: PxRect | null) => void,
): UpdateReport {
  let rebuilt = 0;
  let hidden = 0;
  for (const entry of list.sorted()) {
    if (!entry.valueDirty && !entry.viewDirty) continue;
    const head = stores.kernel.head(entry.drawable.id);
    const authored = stores.styles.authoredOf(entry.drawable.id);
    if (head === undefined || authored === undefined) {
      entry.valueDirty = false;
      entry.viewDirty = false;
      hidden++;
      onBbox(entry.drawable.id, null);
      continue;
    }
    const value = stores.kernel.valueOf(entry.drawable.id);
    const style = resolveStyle(authored.kind, authored.free, authored.style, stores.styles.evaluator);
    if (!style.ok) {
      entry.valueDirty = false;
      entry.viewDirty = false;
      hidden++;
      onBbox(entry.drawable.id, null);
      continue;
    }
    const drawable = entry.drawable;
    const drew = drawable.update({ head, value }, view, style.value);
    entry.valueDirty = false;
    entry.viewDirty = false;
    rebuilt++;
    if (!drew) hidden++;
    onBbox(drawable.id, drawable.bbox);
  }
  return { rebuilt, hidden };
}

/** True when a drawable is culled for this frame (design 7.5). */
export function isCulled(bbox: PxRect | null, viewRect: PxRect): boolean {
  return bbox !== null && !rectsOverlap(bbox, viewRect);
}

/**
 * Paint phase with the per-layer text pass: for each layer, shapes first,
 * then that layer's labels, so a label is never hidden by a later line in
 * the same layer (design 8).
 */
export function paintDrawables(
  list: DrawList,
  s: Surface,
  ctx: PaintContext,
  viewRect: PxRect,
): { painted: number; labels: number } {
  let painted = 0;
  let labels = 0;
  const sorted = list.sorted();
  let i = 0;
  while (i < sorted.length) {
    const layer = sorted[i]?.drawable.sortKey.layer ?? 0;
    let j = i;
    while (j < sorted.length && (sorted[j]?.drawable.sortKey.layer ?? -1) === layer) j++;
    for (let k = i; k < j; k++) {
      const d = sorted[k]?.drawable;
      if (d === undefined || isCulled(d.bbox, viewRect)) continue;
      d.paint(s, ctx);
      painted++;
    }
    for (let k = i; k < j; k++) {
      const d = sorted[k]?.drawable;
      if (d === undefined || isCulled(d.bbox, viewRect)) continue;
      d.paintLabel(s, ctx);
      labels++;
    }
    i = j;
  }
  return { painted, labels };
}

export interface RepaintSplit {
  readonly lower: readonly DrawListEntry[];
  readonly middle: readonly DrawListEntry[];
  readonly upper: readonly DrawListEntry[];
}

/**
 * Partial repaint split (7.4): paint `lower` and `upper` once to offscreen
 * bitmaps and only `middle` live. Returns null when the split is not worth
 * it (`middle` holds more than half the list).
 */
export function splitForActive(list: DrawList, active: ReadonlySet<ObjId>): RepaintSplit | null {
  const sorted = list.sorted();
  let first = -1;
  let last = -1;
  for (let i = 0; i < sorted.length; i++) {
    const id = sorted[i]?.drawable.id;
    if (id !== undefined && active.has(id)) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return { lower: sorted, middle: [], upper: [] };
  const middle = sorted.slice(first, last + 1);
  if (middle.length > 0.5 * sorted.length) return null;
  return { lower: sorted.slice(0, first), middle, upper: sorted.slice(last + 1) };
}

export type DetailLevel = 0 | 1 | 2;

/**
 * Adaptive quality (7.3): after three overrunning frames in a row, lower the
 * curve resolution one level (max 2); raise it after 30 good frames.
 */
export class ResolutionController {
  private overruns = 0;
  private good = 0;
  level: DetailLevel = 0;

  noteFrame(overBudget: boolean): DetailLevel {
    if (overBudget) {
      this.overruns++;
      this.good = 0;
      if (this.overruns >= 3 && this.level < 2) {
        this.level = (this.level + 1) as DetailLevel;
        this.overruns = 0;
      }
    } else {
      this.good++;
      this.overruns = 0;
      if (this.good >= 30 && this.level > 0) {
        this.level = (this.level - 1) as DetailLevel;
        this.good = 0;
      }
    }
    return this.level;
  }
}

/** Quantised zoom class so curve caches survive small zooms (within 2x). */
export function zoomClass(scale: number): number {
  return Math.round(Math.log2(Math.max(scale, 1e-300)));
}

/** Cache key for viewport-dependent geometry: `(object version, zoom class)`. */
export function geometryCacheKey(version: number, scaleX: number, scaleY: number, detail: DetailLevel): string {
  return `${version}:zx${zoomClass(scaleX)}:zy${zoomClass(scaleY)}:d${detail}`;
}
