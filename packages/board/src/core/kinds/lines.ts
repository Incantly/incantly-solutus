/**
 * `line` (two or more points, open or closed) and `arrow` (a start, an end and a bend, with heads) (design 7.1). Both
 * keep their points in the shape's own coordinates, as plain numbers, and show them as handles. An arrow's ends stick
 * to shapes through bindings (`core/bindings.ts`); the bend is the distance of the curve's middle from the straight line.
 */
import { boardError, ok } from '../errors';
import type { BoardResult } from '../errors';
import { distToPath, inPolygon, pointsBox } from '../math2d';
import { DASHES, cssOrNull, dashFor, pathPart, polygonPath, polylinePath, PATH_LINE, PATH_MOVE } from '../paint';
import type { Dash, Part } from '../paint';
import type { Bounds, ShapeRecord } from '../types';
import type { DrawLod, Handle, KindDef, KindGeometry, StylePatch } from './def';
import { SIZE_MAX, bagOf, failed, firstError, readColor, readEnum, readFill, readNumber, readNumbers, readPoint } from './props';

// ---------------------------------------------------------------------------------------------------------------
// line

export interface LineProps {
  /** `[x0, y0, x1, y1, …]`, at least two points. */
  readonly points: readonly number[];
  readonly closed: boolean;
  readonly fill: string;
  readonly stroke: string;
  readonly dash: Dash;
  readonly size: number;
}

export const LINE_POINTS_MAX = 2000;

export const LINE_DEFAULTS: LineProps = Object.freeze({ points: Object.freeze([0, 0, 120, 0]), closed: false, fill: 'none', stroke: '#1f2430', dash: 'solid', size: 3 });

/** Takes the style bar's patch for a shape that has a line colour, a fill, a dash and a size. */
function lineStyle<P extends { readonly stroke: string; readonly fill?: string; readonly dash: Dash; readonly size: number }>(style: StylePatch): Partial<P> {
  const patch: Record<string, unknown> = {};
  if (style.color !== undefined) patch['stroke'] = style.color;
  if (style.fill !== undefined) patch['fill'] = style.fill;
  if (style.dash !== undefined) patch['dash'] = style.dash;
  if (style.size !== undefined) patch['size'] = Math.min(SIZE_MAX, Math.max(0.5, style.size));
  return patch as Partial<P>;
}

/** The points of `points` mapped from the box `from` into the box `to`; a side with no length is only moved. */
export function mapPoints(points: readonly number[], from: Bounds, to: Bounds): number[] {
  const fw = from.maxX - from.minX;
  const fh = from.maxY - from.minY;
  const sx = fw > 0 ? (to.maxX - to.minX) / fw : 1;
  const sy = fh > 0 ? (to.maxY - to.minY) / fh : 1;
  const out: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push(to.minX + ((points[i] as number) - from.minX) * sx, to.minY + ((points[i + 1] as number) - from.minY) * sy);
  }
  return out;
}

export const lineKind: KindDef<LineProps> = {
  kind: 'line',
  defaults: LINE_DEFAULTS,
  check(props: unknown): BoardResult<LineProps> {
    const p = bagOf(props, 'A line');
    if (failed(p)) return p;
    const points = readNumbers(p, 'points', LINE_DEFAULTS.points, 2, LINE_POINTS_MAX);
    const closedRaw = p['closed'] ?? false;
    const fill = readFill(p, 'fill', 'none');
    const stroke = readColor(p, 'stroke', LINE_DEFAULTS.stroke);
    const dash = readEnum(p, 'dash', 'solid', DASHES);
    const size = readNumber(p, 'size', LINE_DEFAULTS.size, 0.5, SIZE_MAX);
    const error = firstError(points, fill, stroke, dash, size);
    if (error !== undefined) return error;
    if (typeof closedRaw !== 'boolean') return boardError('record_invalid', 'closed must be true or false.', { detail: { field: 'props.closed' } });
    return ok({ points, closed: closedRaw, fill, stroke, dash, size } as LineProps);
  },
  geometry(shape: ShapeRecord<string, LineProps>): KindGeometry {
    const { points, closed, fill, size } = shape.props;
    return {
      box: pointsBox(points),
      pad: size / 2 + 1,
      ...(closed ? { poly: points } : {}),
      hit: (x, y, tol) => distToPath(x, y, points, closed) <= size / 2 + tol || (closed && fill !== 'none' && inPolygon(x, y, points)),
    };
  },
  draw(shape: ShapeRecord<string, LineProps>, lod: DrawLod): readonly Part[] {
    const { points, closed, fill, stroke, dash, size } = shape.props;
    const d = closed ? polygonPath(points) : polylinePath(points);
    return [pathPart(d, closed ? cssOrNull(fill) : null, stroke, size, lod === 'full' ? dashFor(dash, size) : [])];
  },
  handles(shape): readonly Handle[] {
    const out: Handle[] = [];
    const { points } = shape.props;
    for (let i = 0; i + 1 < points.length; i += 2) out.push({ id: `p${i / 2}`, x: points[i] as number, y: points[i + 1] as number });
    return out;
  },
  moveHandle(shape, handle, x, y): Partial<LineProps> {
    const i = Number(handle.slice(1));
    const { points } = shape.props;
    if (!Number.isInteger(i) || i < 0 || i * 2 + 1 >= points.length) return {};
    const next = [...points];
    next[i * 2] = x;
    next[i * 2 + 1] = y;
    return { points: next };
  },
  onResize: (shape, box) => ({ points: mapPoints(shape.props.points, pointsBox(shape.props.points), box) }),
  applyStyle: (_props, style) => lineStyle<LineProps>(style),
  flip(shape, axis): Partial<LineProps> {
    const b = pointsBox(shape.props.points);
    const out = [...shape.props.points];
    for (let i = 0; i + 1 < out.length; i += 2) {
      if (axis === 'x') out[i] = b.minX + b.maxX - (out[i] as number);
      else out[i + 1] = b.minY + b.maxY - (out[i + 1] as number);
    }
    return { points: out };
  },
};

// ---------------------------------------------------------------------------------------------------------------
// arrow

export type ArrowHead = 'none' | 'arrow' | 'triangle';
export const ARROW_HEADS: readonly ArrowHead[] = ['none', 'arrow', 'triangle'];

export interface ArrowProps {
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
  /** The distance of the curve's middle from the straight line; positive turns left of the direction of travel. */
  readonly bend: number;
  readonly startHead: ArrowHead;
  readonly endHead: ArrowHead;
  readonly stroke: string;
  readonly dash: Dash;
  readonly size: number;
}

export const ARROW_DEFAULTS: ArrowProps = Object.freeze({
  start: Object.freeze([0, 0]) as readonly [number, number],
  end: Object.freeze([120, 0]) as readonly [number, number],
  bend: 0,
  startHead: 'none',
  endHead: 'arrow',
  stroke: '#1f2430',
  dash: 'solid',
  size: 3,
});

export const BEND_MAX = 100_000;
const CURVE_STEPS = 24;

/** The control point of the arrow's curve and the unit normal of its chord (left of the direction of travel). */
export function arrowControl(p: Pick<ArrowProps, 'start' | 'end' | 'bend'>): { cx: number; cy: number; nx: number; ny: number; mx: number; my: number } {
  const dx = p.end[0] - p.start[0];
  const dy = p.end[1] - p.start[1];
  const len = Math.hypot(dx, dy);
  const nx = len > 0 ? dy / len : 0;
  const ny = len > 0 ? -dx / len : -1;
  const mx = (p.start[0] + p.end[0]) / 2;
  const my = (p.start[1] + p.end[1]) / 2;
  return { cx: mx + 2 * p.bend * nx, cy: my + 2 * p.bend * ny, nx, ny, mx, my };
}

/** The curve as `[x0, y0, …]`: the start, points along the quadratic, the end. A straight arrow has two points. */
export function arrowCurve(p: Pick<ArrowProps, 'start' | 'end' | 'bend'>): number[] {
  if (p.bend === 0) return [p.start[0], p.start[1], p.end[0], p.end[1]];
  const { cx, cy } = arrowControl(p);
  const out: number[] = [];
  for (let i = 0; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    out.push(u * u * p.start[0] + 2 * u * t * cx + t * t * p.end[0], u * u * p.start[1] + 2 * u * t * cy + t * t * p.end[1]);
  }
  return out;
}

/** The length of an arrow's head for a line of width `size`. */
export const headLength = (size: number): number => Math.max(10, size * 3.5);

/** The wing tips of a head at `tip` for a line arriving along `(dx, dy)`. */
function wings(tipX: number, tipY: number, dx: number, dy: number, len: number): [number, number, number, number] {
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d;
  const uy = dy / d;
  const a = (26 * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    tipX - len * (ux * c - uy * s), tipY - len * (ux * s + uy * c),
    tipX - len * (ux * c + uy * s), tipY - len * (-ux * s + uy * c),
  ];
}

function headPart(kind: ArrowHead, tipX: number, tipY: number, dx: number, dy: number, stroke: string, size: number): Part[] {
  if (kind === 'none') return [];
  const len = headLength(size);
  const [ax, ay, bx, by] = wings(tipX, tipY, dx, dy, len);
  if (kind === 'triangle') return [pathPart(polygonPath([tipX, tipY, ax, ay, bx, by]), stroke, stroke, size * 0.5, [], 'round')];
  return [pathPart([PATH_MOVE, ax, ay, PATH_LINE, tipX, tipY, PATH_LINE, bx, by], null, stroke, size)];
}

export const arrowKind: KindDef<ArrowProps> = {
  kind: 'arrow',
  defaults: ARROW_DEFAULTS,
  check(props: unknown): BoardResult<ArrowProps> {
    const p = bagOf(props, 'An arrow');
    if (failed(p)) return p;
    const start = readPoint(p, 'start', ARROW_DEFAULTS.start);
    const end = readPoint(p, 'end', ARROW_DEFAULTS.end);
    const bend = readNumber(p, 'bend', 0, -BEND_MAX, BEND_MAX);
    const startHead = readEnum(p, 'startHead', 'none', ARROW_HEADS);
    const endHead = readEnum(p, 'endHead', 'arrow', ARROW_HEADS);
    const stroke = readColor(p, 'stroke', ARROW_DEFAULTS.stroke);
    const dash = readEnum(p, 'dash', 'solid', DASHES);
    const size = readNumber(p, 'size', ARROW_DEFAULTS.size, 0.5, SIZE_MAX);
    const error = firstError(start, end, bend, startHead, endHead, stroke, dash, size);
    if (error !== undefined) return error;
    return ok({ start, end, bend, startHead, endHead, stroke, dash, size } as ArrowProps);
  },
  geometry(shape: ShapeRecord<string, ArrowProps>): KindGeometry {
    const p = shape.props;
    const curve = arrowCurve(p);
    return {
      box: pointsBox(curve),
      pad: p.size / 2 + (p.startHead === 'none' && p.endHead === 'none' ? 1 : headLength(p.size)),
      hit: (x, y, tol) => distToPath(x, y, curve, false) <= p.size / 2 + tol,
    };
  },
  draw(shape: ShapeRecord<string, ArrowProps>, lod: DrawLod): readonly Part[] {
    const p = shape.props;
    const curve = arrowCurve(p);
    const parts: Part[] = [pathPart(polylinePath(curve), null, p.stroke, p.size, lod === 'full' ? dashFor(p.dash, p.size) : [])];
    if (lod === 'skip') return parts;
    const n = curve.length;
    const [ex, ey] = p.end;
    const [sx, sy] = p.start;
    parts.push(...headPart(p.endHead, ex, ey, ex - (curve[n - 4] as number), ey - (curve[n - 3] as number), p.stroke, p.size));
    parts.push(...headPart(p.startHead, sx, sy, sx - (curve[2] as number), sy - (curve[3] as number), p.stroke, p.size));
    return parts;
  },
  handles(shape): readonly Handle[] {
    const p = shape.props;
    const { mx, my, nx, ny } = arrowControl(p);
    return [
      { id: 'start', x: p.start[0], y: p.start[1] },
      { id: 'end', x: p.end[0], y: p.end[1] },
      { id: 'bend', x: mx + p.bend * nx, y: my + p.bend * ny },
    ];
  },
  moveHandle(shape, handle, x, y): Partial<ArrowProps> {
    const p = shape.props;
    if (handle === 'start') return { start: [x, y] };
    if (handle === 'end') return { end: [x, y] };
    if (handle === 'bend') {
      const { mx, my, nx, ny } = arrowControl(p);
      const bend = (x - mx) * nx + (y - my) * ny;
      return { bend: Math.max(-BEND_MAX, Math.min(BEND_MAX, Math.abs(bend) < 3 ? 0 : bend)) };
    }
    return {};
  },
  onResize(shape, box): Partial<ArrowProps> {
    const p = shape.props;
    const from = pointsBox(arrowCurve(p));
    const [s0, s1, e0, e1] = mapPoints([...p.start, ...p.end], from, box) as [number, number, number, number];
    const fw = from.maxX - from.minX;
    const fh = from.maxY - from.minY;
    const sx = fw > 0 ? (box.maxX - box.minX) / fw : 1;
    const sy = fh > 0 ? (box.maxY - box.minY) / fh : 1;
    return { start: [s0, s1], end: [e0, e1], bend: p.bend * Math.sqrt(Math.abs(sx * sy)) };
  },
  applyStyle: (_props, style) => lineStyle<ArrowProps & { fill?: string }>(style) as Partial<ArrowProps>,
  flip(shape, axis): Partial<ArrowProps> {
    const p = shape.props;
    const b = pointsBox(arrowCurve(p));
    const mirror = (pt: readonly [number, number]): [number, number] => (axis === 'x' ? [b.minX + b.maxX - pt[0], pt[1]] : [pt[0], b.minY + b.maxY - pt[1]]);
    return { start: mirror(p.start), end: mirror(p.end), bend: -p.bend };
  },
};
