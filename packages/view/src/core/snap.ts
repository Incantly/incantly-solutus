/**
 * Snapping (graphics-view design 13): modes, the snap algorithm with
 * hysteresis, and snapping along a path.
 */
import type { ObjId } from '@incantly/kernel';
import type { MathsPoint } from './coords';
import type { PixelMetric } from './drag';

export type SnapMode = 'off' | 'grid' | 'points' | 'auto' | 'grid+points';

export type SnapSource =
  | { readonly k: 'none' }
  | { readonly k: 'grid' }
  | { readonly k: 'point'; readonly id: ObjId }
  | { readonly k: 'intersection' };

export interface SnapResult {
  readonly position: MathsPoint;
  readonly source: SnapSource;
}

export interface SnapPoint {
  readonly id: ObjId;
  readonly x: number;
  readonly y: number;
}

export interface SnapContext {
  readonly mode: SnapMode;
  readonly gridVisible: boolean;
  /** Active major/minor step per axis in maths units, or null when off. */
  readonly stepX: number | null;
  readonly stepY: number | null;
  readonly metric: PixelMetric;
  readonly snapRadiusPx: number;
  /** Points within reach from the hit index (already excluding the dragged object). */
  readonly points: readonly SnapPoint[];
  /** Pair intersections of objects under the pointer, in maths units. */
  readonly intersections: readonly MathsPoint[];
}

function toPxPair(x: number, y: number, metric: PixelMetric): { x: number; y: number } {
  return { x: x * metric.scaleX, y: y * metric.scaleY };
}

/**
 * Snap algorithm (13.2): points first, then intersections, then the grid.
 * `auto` is grid when the grid is visible, else points.
 */
export function snapPosition(p: MathsPoint, ctx: SnapContext): SnapResult {
  const plain: SnapResult = { position: p, source: { k: 'none' } };
  if (ctx.mode === 'off') return plain;
  const wantPoints = ctx.mode === 'points' || ctx.mode === 'grid+points' ||
    (ctx.mode === 'auto' && !ctx.gridVisible);
  const wantGrid = ctx.mode === 'grid' || ctx.mode === 'grid+points' ||
    (ctx.mode === 'auto' && ctx.gridVisible);
  const px = toPxPair(p.x as number, p.y as number, ctx.metric);
  if (wantPoints) {
    let best: SnapPoint | null = null;
    let bestD = ctx.snapRadiusPx;
    for (const q of ctx.points) {
      const qq = toPxPair(q.x, q.y, ctx.metric);
      const d = Math.hypot(qq.x - px.x, qq.y - px.y);
      if (d <= bestD) {
        bestD = d;
        best = q;
      }
    }
    if (best !== null) {
      return {
        position: { x: best.x as never, y: best.y as never },
        source: { k: 'point', id: best.id },
      };
    }
    for (const q of ctx.intersections) {
      const qq = toPxPair(q.x as number, q.y as number, ctx.metric);
      if (Math.hypot(qq.x - px.x, qq.y - py(q, ctx.metric)) <= ctx.snapRadiusPx) {
        return { position: q, source: { k: 'intersection' } };
      }
    }
  }
  if (wantGrid && ctx.stepX !== null && ctx.stepY !== null && ctx.stepX > 0 && ctx.stepY > 0) {
    const gx = Math.round((p.x as number) / ctx.stepX) * ctx.stepX;
    const gy = Math.round((p.y as number) / ctx.stepY) * ctx.stepY;
    const gp = toPxPair(gx, gy, ctx.metric);
    if (Math.hypot(gp.x - px.x, gp.y - py(p, ctx.metric)) <= ctx.snapRadiusPx) {
      return { position: { x: gx as never, y: gy as never }, source: { k: 'grid' } };
    }
  }
  return plain;
}

function py(p: MathsPoint, metric: PixelMetric): number {
  return (p.y as number) * metric.scaleY;
}

export interface SnapMemory {
  /** Currently snapped target in maths units, or null. */
  target: MathsPoint | null;
  radiusPx: number;
}

export function createSnapMemory(radiusPx: number): SnapMemory {
  return { target: null, radiusPx };
}

/**
 * Hysteresis (13.3): once snapped, stay snapped until the pointer leaves
 * `radius * 1.5`. Returns the position to use and updates the memory.
 */
export function snapWithHysteresis(
  p: MathsPoint,
  ctx: SnapContext,
  memory: SnapMemory,
): SnapResult {
  const t = memory.target;
  if (t !== null) {
    const a = toPxPair(p.x as number, p.y as number, ctx.metric);
    const b = toPxPair(t.x as number, t.y as number, ctx.metric);
    if (Math.hypot(a.x - b.x, a.y - b.y) <= memory.radiusPx * 1.5) {
      const fresh = snapPosition(p, ctx);
      if (fresh.source.k !== 'none') {
        memory.target = fresh.position;
        return fresh;
      }
      return { position: t, source: { k: 'grid' } };
    }
  }
  const r = snapPosition(p, ctx);
  memory.target = r.source.k === 'none' ? null : r.position;
  return r;
}

/**
 * Snap along a path (13.4): the nearest grid intersection that lies on the
 * path within the radius, else null. The point never leaves the path.
 */
export function snapParamToGrid(
  samples: Float64Array,
  stepX: number,
  stepY: number,
  metric: PixelMetric,
  radiusPx: number,
): { s: number; point: MathsPoint } | null {
  if (!(stepX > 0) || !(stepY > 0)) return null;
  const n = Math.floor(samples.length / 2);
  let best: { s: number; point: MathsPoint } | null = null;
  let bestD = radiusPx;
  for (let i = 0; i < n; i++) {
    const x = samples[i * 2] ?? 0;
    const y = samples[i * 2 + 1] ?? 0;
    const gx = Math.round(x / stepX) * stepX;
    const gy = Math.round(y / stepY) * stepY;
    const d = Math.hypot((gx - x) * metric.scaleX, (gy - y) * metric.scaleY);
    if (d <= bestD) {
      bestD = d;
      best = { s: n > 1 ? i / (n - 1) : 0, point: { x: gx as never, y: gy as never } };
    }
  }
  return best;
}

/** Shift-limits a drag angle to 15 degrees about the anchor (design 13.1). */
export function limitAngle(
  anchor: MathsPoint,
  p: MathsPoint,
  stepDeg = 15,
): MathsPoint {
  const dx = (p.x as number) - (anchor.x as number);
  const dy = (p.y as number) - (anchor.y as number);
  const len = Math.hypot(dx, dy);
  if (len === 0) return p;
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: ((anchor.x as number) + len * Math.cos(a)) as never,
    y: ((anchor.y as number) + len * Math.sin(a)) as never,
  };
}
