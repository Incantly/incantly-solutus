/**
 * 3D scene graph (space-3d design 9.2-9.3): draw items from kernel events,
 * arena batching, per-item bounds, clip-box tests, batch planning, the frame
 * pass plan and mesh level of detail. Pure; the back-ends draw the plan.
 */
import type { ObjId } from '@incantly/kernel';
import type { KernelEvent } from '../contracts';
import {
  frustumContainsSphere, v3Len, v3Sub, type Mat4, type V3,
} from './camera';

export interface LabelSpec {
  readonly text: string;
  readonly math: boolean;
  readonly sizePx: number;
}

export interface LineDash3 {
  readonly pattern: readonly number[];
  readonly phase: number;
}

/** One object's contribution to the 3D frame (design 9.2). */
export type DrawItem =
  | { readonly k: 'points'; readonly pos: Float32Array; readonly size: number; readonly color: number; readonly objId: ObjId }
  | { readonly k: 'lines'; readonly pos: Float32Array; readonly width: number; readonly color: number; readonly dash: LineDash3 | null; readonly closed: boolean; readonly objId: ObjId }
  | { readonly k: 'mesh'; readonly pos: Float32Array; readonly nor: Float32Array; readonly idx: Uint32Array; readonly color: number; readonly alpha: number; readonly closed: boolean; readonly objId: ObjId }
  | { readonly k: 'label'; readonly anchor: V3; readonly text: LabelSpec; readonly objId: ObjId };

export interface Bounds {
  readonly c: V3;
  readonly r: number;
}

/** Bounding sphere of an item's positions (computed once at build). */
export function itemBounds(item: DrawItem): Bounds {
  if (item.k === 'label') return { c: item.anchor, r: 0 };
  const pos = item.pos;
  const n = Math.floor(pos.length / 3);
  if (n === 0) return { c: { x: 0, y: 0, z: 0 }, r: 0 };
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3] ?? 0;
    const y = pos[i * 3 + 1] ?? 0;
    const z = pos[i * 3 + 2] ?? 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  const c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 };
  let r = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot((pos[i * 3] ?? 0) - c.x, (pos[i * 3 + 1] ?? 0) - c.y, (pos[i * 3 + 2] ?? 0) - c.z);
    if (d > r) r = d;
  }
  return { c, r };
}

export function mergeBounds(all: readonly Bounds[]): Bounds {
  if (all.length === 0) return { c: { x: 0, y: 0, z: 0 }, r: 1 };
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const b of all) {
    x0 = Math.min(x0, b.c.x - b.r);
    x1 = Math.max(x1, b.c.x + b.r);
    y0 = Math.min(y0, b.c.y - b.r);
    y1 = Math.max(y1, b.c.y + b.r);
    z0 = Math.min(z0, b.c.z - b.r);
    z1 = Math.max(z1, b.c.z + b.r);
  }
  const c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 };
  return { c, r: Math.max(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2, 1e-9) };
}

/** The 3D draw list, fed by the same kernel events as the 2D list. */
export class SceneIndex {
  /** Insertion-ordered set: removing an id is constant time, not an `indexOf` (VIEW-SM-24). */
  private readonly items = new Set<DrawItem>();
  private itemsCache: DrawItem[] | null = null;
  private boundsCache: Bounds | null = null;
  private readonly byId = new Map<ObjId, DrawItem[]>();
  private readonly bounds = new Map<DrawItem, Bounds>();

  get size(): number {
    return this.items.size;
  }

  all(): readonly DrawItem[] {
    if (this.itemsCache === null) this.itemsCache = [...this.items];
    return this.itemsCache;
  }

  /** The cached bounding sphere of one item, computed once when it was added. */
  boundsOf(item: DrawItem): Bounds | undefined {
    return this.bounds.get(item);
  }

  of(id: ObjId): readonly DrawItem[] {
    return this.byId.get(id) ?? [];
  }

  applyEvent(event: KernelEvent, build: (id: ObjId) => DrawItem[] | null): void {
    switch (event.kind) {
      case 'add':
      case 'update':
      case 'restyle': {
        for (const id of event.ids) {
          this.dropId(id);
          const built = build(id);
          if (built !== null && built.length > 0) {
            this.byId.set(id, built);
            for (const item of built) {
              this.items.add(item);
              this.bounds.set(item, itemBounds(item));
            }
          }
        }
        this.itemsCache = null;
        this.boundsCache = null;
        return;
      }
      case 'remove': {
        for (const id of event.ids) this.dropId(id);
        this.itemsCache = null;
        this.boundsCache = null;
        return;
      }
    }
  }

  private dropId(id: ObjId): void {
    const old = this.byId.get(id);
    if (old === undefined) return;
    this.byId.delete(id);
    for (const item of old) {
      this.bounds.delete(item);
      this.items.delete(item);
    }
  }

  sceneBounds(): Bounds {
    if (this.boundsCache === null) this.boundsCache = mergeBounds([...this.bounds.values()]);
    return this.boundsCache;
  }

  /** Items surviving frustum and clip-box culling. */
  visibleItems(vp: Mat4, clip: ClipBox | null): DrawItem[] {
    const out: DrawItem[] = [];
    for (const item of this.all()) {
      const b = this.bounds.get(item);
      if (b === undefined) continue;
      if (!frustumContainsSphere(vp, b.c, b.r)) continue;
      if (clip !== null && clip.on && !boundsHitClipBox(b, clip)) continue;
      out.push(item);
    }
    return out;
  }
}

export interface ClipBox {
  readonly on: boolean;
  readonly min: V3;
  readonly max: V3;
  readonly caps: boolean;
}

export const CLIP_OFF: ClipBox = {
  on: false,
  min: { x: -5, y: -5, z: -5 },
  max: { x: 5, y: 5, z: 5 },
  caps: false,
};

export type ClipSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge';

const CLIP_SIZE_SCALE: Readonly<Record<ClipSize, number>> = {
  tiny: 0.25,
  small: 0.5,
  medium: 1,
  large: 2,
  huge: 4,
};

/** Preset scalings of the box about its centre (design 8.1). */
export function scaleClipBox(box: ClipBox, size: ClipSize): ClipBox {
  const f = CLIP_SIZE_SCALE[size] ?? 1;
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  const hx = ((box.max.x - box.min.x) / 2) * f;
  const hy = ((box.max.y - box.min.y) / 2) * f;
  const hz = ((box.max.z - box.min.z) / 2) * f;
  return {
    on: box.on,
    min: { x: cx - hx, y: cy - hy, z: cz - hz },
    max: { x: cx + hx, y: cy + hy, z: cz + hz },
    caps: box.caps,
  };
}

function boundsHitClipBox(b: Bounds, clip: ClipBox): boolean {
  return (
    b.c.x + b.r >= clip.min.x && b.c.x - b.r <= clip.max.x &&
    b.c.y + b.r >= clip.min.y && b.c.y - b.r <= clip.max.y &&
    b.c.z + b.r >= clip.min.z && b.c.z - b.r <= clip.max.z
  );
}

/**
 * Offset allocator over one big shared buffer, with a free list (design 9.2).
 * Each object owns a range; restyle rewrites only the colour bytes.
 */
export class ArenaAllocator {
  private readonly freeList: Array<{ off: number; size: number }> = [];
  private end = 0;
  usedBytes = 0;

  constructor(readonly capacityBytes: number) {
    this.freeList.push({ off: 0, size: capacityBytes });
  }

  alloc(sizeBytes: number, align = 4): number {
    if (sizeBytes <= 0) return -1;
    for (let i = 0; i < this.freeList.length; i++) {
      const slot = this.freeList[i];
      if (slot === undefined) continue;
      const aligned = Math.ceil(slot.off / align) * align;
      const pad = aligned - slot.off;
      if (slot.size >= pad + sizeBytes) {
        this.freeList.splice(i, 1);
        if (pad > 0) this.freeList.push({ off: slot.off, size: pad });
        const rest = slot.size - pad - sizeBytes;
        if (rest > 0) this.freeList.push({ off: aligned + sizeBytes, size: rest });
        this.usedBytes += pad + sizeBytes;
        this.end = Math.max(this.end, aligned + sizeBytes);
        return aligned;
      }
    }
    return -1;
  }

  free(off: number, sizeBytes: number): void {
    if (sizeBytes <= 0 || off < 0) return;
    this.freeList.push({ off, size: sizeBytes });
    this.usedBytes = Math.max(0, this.usedBytes - sizeBytes);
    // Coalesce neighbours.
    this.freeList.sort((a, b) => a.off - b.off);
    const merged: Array<{ off: number; size: number }> = [];
    for (const s of this.freeList) {
      const last = merged[merged.length - 1];
      if (last !== undefined && last.off + last.size === s.off) last.size += s.size;
      else merged.push({ off: s.off, size: s.size });
    }
    this.freeList.length = 0;
    this.freeList.push(...merged);
  }
}

export interface BatchPlan {
  readonly opaque: readonly DrawItem[];
  readonly transparent: readonly DrawItem[];
  readonly lines: readonly DrawItem[];
  readonly points: readonly DrawItem[];
  readonly labels: readonly DrawItem[];
}

/** Group items by material class: one draw call per class, not per object. */
export function planBatches(items: readonly DrawItem[]): BatchPlan {
  const opaque: DrawItem[] = [];
  const transparent: DrawItem[] = [];
  const lines: DrawItem[] = [];
  const points: DrawItem[] = [];
  const labels: DrawItem[] = [];
  for (const item of items) {
    switch (item.k) {
      case 'mesh':
        (item.alpha >= 0.999 ? opaque : transparent).push(item);
        break;
      case 'lines': lines.push(item); break;
      case 'points': points.push(item); break;
      case 'label': labels.push(item); break;
    }
  }
  return { opaque, transparent, lines, points, labels };
}

/** Depth key for back-to-front sorting (the no-float-target fallback). */
export function depthKey(item: DrawItem, eye: V3, bounds?: Bounds): number {
  const b = bounds ?? itemBounds(item);
  return v3Len(v3Sub(b.c, eye)) - b.r;
}

export type FramePass =
  | 'hideDepth' | 'opaque' | 'hiddenLines' | 'transparent' | 'wboitComposite' | 'overlay' | 'resolve';

export type HiddenLineMode = 'dashed' | 'faded' | 'off';

export interface FramePlanInput {
  readonly hasClosedTransparent: boolean;
  readonly hidden: HiddenLineMode;
  readonly hasTransparent: boolean;
  readonly floatTargets: boolean;
  readonly stereo: boolean;
}

/** The frame sequence (design 9.3), one pass list per eye. */
export function planFrame(input: FramePlanInput): FramePass[][] {
  const passes: FramePass[] = [];
  if (input.hasClosedTransparent || input.hidden !== 'off') passes.push('hideDepth');
  passes.push('opaque');
  if (input.hidden !== 'off') passes.push('hiddenLines');
  if (input.hasTransparent) {
    passes.push('transparent');
    if (input.floatTargets) passes.push('wboitComposite');
  }
  passes.push('overlay', 'resolve');
  return input.stereo ? [passes, [...passes]] : [passes];
}

/** Facet segments from the on-screen radius (performance 5, LOD). */
export function lodSegments(radiusPx: number, min: number, max: number): number {
  const segs = Math.ceil(Math.max(radiusPx, 1) / 6);
  return Math.min(max, Math.max(min, segs));
}

/** Triangle count of a mesh item (for budgets and the perf panel). */
export function meshTriangles(item: DrawItem): number {
  return item.k === 'mesh' ? Math.floor(item.idx.length / 3) : 0;
}

export function sceneTriangles(items: readonly DrawItem[]): number {
  let total = 0;
  for (const item of items) total += meshTriangles(item);
  return total;
}
