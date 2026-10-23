import type { ArrowPoints, PathHelpers, Vec2 } from '../api/types';
import { SceneApiError } from './errors';
import { fmt } from './format';

/** The scoped SVG contract caps every plotted curve at 500 samples. */
export const MAX_SAMPLES = 500;
export const DEFAULT_SAMPLES = 200;

export type CapReporter = (requested: number) => void;

function clampSteps(steps: number | undefined, report?: CapReporter): number {
  const requested = Math.floor(steps ?? DEFAULT_SAMPLES);
  if (!Number.isFinite(requested) || requested < 1) return 1;
  if (requested > MAX_SAMPLES) {
    report?.(requested);
    return MAX_SAMPLES;
  }
  return requested;
}

/**
 * Joins points into path data. A non-finite point ends the current subpath,
 * so discontinuities such as 1/x at zero are never bridged.
 */
export function polylinePath(points: Iterable<Vec2>): string {
  let d = '';
  let pen = false;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : d ? ' M' : 'M'}${fmt(x)} ${fmt(y)}`;
    pen = true;
  }
  return d;
}

export function samplePoints(
  fn: (x: number) => number,
  x0: number,
  x1: number,
  steps: number,
  map: (x: number, y: number) => Vec2,
): Vec2[] {
  const points: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = fn(x);
    points.push(Number.isFinite(y) ? map(x, y) : [Number.NaN, Number.NaN]);
  }
  return points;
}

/**
 * An arrow's start and offset from either form: { from, to } or { from, by },
 * or the older (x, y, dx, dy) that saved figures still use.
 */
function arrowSpan(args: readonly unknown[]): { x: number; y: number; dx: number; dy: number; head: unknown } {
  const [first] = args;
  if (typeof first !== 'object' || first === null) {
    const [x, y, dx, dy, head] = args as number[];
    return { x: Number(x), y: Number(y), dx: Number(dx), dy: Number(dy), head };
  }
  const points = first as Partial<Record<'from' | 'to' | 'by', Vec2>>;
  const pair = (value: unknown): value is Vec2 => Array.isArray(value) && value.length === 2;
  if (!pair(points.from) || pair(points.to) === pair(points.by)) {
    throw new SceneApiError('path.arrow takes { from: [x, y], to: [x, y] } or { from: [x, y], by: [dx, dy] }');
  }
  const [x, y] = points.from;
  const [dx, dy] = pair(points.to) ? [points.to[0] - x, points.to[1] - y] : points.by!;
  return { x, y, dx, dy, head: args[1] };
}

export function createPathHelpers(report?: CapReporter): PathHelpers {
  return {
    line: (points) => polylinePath(points),
    polyline: (points) => polylinePath(points),
    curve(fn, x0, x1, steps, map = (x, y) => [x, y]) {
      return polylinePath(samplePoints(fn, x0, x1, clampSteps(steps, report), map));
    },
    param(fx, fy, t0, t1, steps) {
      const n = clampSteps(steps, report);
      const points: Vec2[] = [];
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        points.push([fx(t), fy(t)]);
      }
      return polylinePath(points);
    },
    arc(cx, cy, r, a0, a1) {
      const segments = Math.min(180, Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 36))));
      const points: Vec2[] = [];
      for (let i = 0; i <= segments; i++) {
        const a = a0 + ((a1 - a0) * i) / segments;
        points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      return polylinePath(points);
    },
    arrow(...args: [ArrowPoints, number?]) {
      const { x, y, dx, dy, head: asked } = arrowSpan(args);
      const head = typeof asked === 'number' ? asked : 9;
      const ex = x + dx;
      const ey = y + dy;
      if (![x, y, ex, ey].every(Number.isFinite)) return '';
      const length = Math.hypot(dx, dy);
      if (length === 0) return '';
      const size = Math.min(head, length * 0.6);
      const angle = Math.atan2(dy, dx);
      const left: Vec2 = [ex - size * Math.cos(angle - 0.45), ey - size * Math.sin(angle - 0.45)];
      const right: Vec2 = [ex - size * Math.cos(angle + 0.45), ey - size * Math.sin(angle + 0.45)];
      return `M${fmt(x)} ${fmt(y)}L${fmt(ex)} ${fmt(ey)} M${fmt(left[0])} ${fmt(left[1])}L${fmt(ex)} ${fmt(ey)}L${fmt(right[0])} ${fmt(right[1])}`;
    },
  };
}
