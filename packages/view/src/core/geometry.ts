/**
 * Geometry builders: one per drawable family (graphics-view design 6).
 *
 * Curves, regions and conics store shapes as `Float32Array` of x,y pairs in
 * view pixels; a bounding box is computed once per update. `update` stays pure
 * in (object value, viewport, resolved style).
 */
import type { ObjId } from '@incantly/kernel';
import type { ViewValue } from '../contracts';
import { clipSegmentToRect, createMapper, px, type Mapper, type PxPoint, type PxRect, type Viewport } from './coords';
import type { PaintKind } from './drawables';
import type { HitCandidate } from './hit';
import type { PointShape, ResolvedStyle } from './styles';
import { expandRect, pathBounds, unionRect } from './surface';

/** Pixel-space LOD tolerance for curve reduction (design 7.5). */
export const CURVE_TOLERANCE_PX = 0.3;
/** Max on-screen samples per curve (performance design 5). */
export const MAX_CURVE_SAMPLES = 4000;

export interface BuiltGeometry {
  /** Stroked polylines in view pixels. */
  readonly strokes: readonly Float32Array[];
  /** Filled rings in view pixels. */
  readonly fills: readonly Float32Array[];
  /** Screen bounds including line width and label, or null when culled. */
  readonly bbox: PxRect | null;
  /** Anchor for the label / hit fallback. */
  readonly anchor: PxPoint;
  /** Extra label text (angle values); null for the default name/value label. */
  readonly labelText: string | null;
  /** Marker centre for points (equals anchor) and marker radius. */
  readonly markerRadius: number;
}

export interface TextMeasure {
  (text: string, sizePx: number): { width: number; height: number };
}

export interface BuildInput {
  readonly mapper: Mapper;
  readonly view: Viewport;
  readonly viewRect: PxRect;
  readonly measure: TextMeasure;
  /** Adaptive detail level 0..2 (0 is full; each level halves samples). */
  readonly detail: 0 | 1 | 2;
  readonly traceJoin: boolean;
}

export function buildInput(view: Viewport, measure: TextMeasure, detail: 0 | 1 | 2 = 0, traceJoin = false): BuildInput {
  return {
    mapper: createMapper(view),
    view,
    viewRect: { x0: px(0), x1: view.width, y0: px(0), y1: view.height },
    measure,
    detail,
    traceJoin,
  };
}

function emptyGeom(anchor: PxPoint): BuiltGeometry {
  return { strokes: [], fills: [], bbox: null, anchor, labelText: null, markerRadius: 0 };
}

/** Map a maths polyline to a pixel polyline, dropping non-finite runs. */
export function mapPolyline(pts: Float64Array, mapper: Mapper): Float32Array[] {
  const runs: Float32Array[] = [];
  let cur: number[] = [];
  const flush = (): void => {
    if (cur.length >= 4) runs.push(new Float32Array(cur));
    cur = [];
  };
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const x = pts[i] ?? 0;
    const y = pts[i + 1] ?? 0;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      flush();
      continue;
    }
    const p = mapper.toPx({ x: x as never, y: y as never });
    cur.push(p.x as number, p.y as number);
  }
  flush();
  return runs;
}

/** Iterative Ramer-Douglas-Peucker on a pixel polyline. */
export function rdpSimplify(pts: Float32Array, tolerance: number): Float32Array {
  const n = Math.floor(pts.length / 2);
  if (n < 3 || tolerance <= 0) return pts;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  while (stack.length >= 2) {
    const last = stack.pop() ?? 0;
    const first = stack.pop() ?? 0;
    const ax = pts[first * 2] ?? 0;
    const ay = pts[first * 2 + 1] ?? 0;
    const bx = pts[last * 2] ?? 0;
    const by = pts[last * 2 + 1] ?? 0;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tolerance;
    for (let i = first + 1; i < last; i++) {
      const pxv = (pts[i * 2] ?? 0) - ax;
      const pyv = (pts[i * 2 + 1] ?? 0) - ay;
      const t = len2 > 0 ? (pxv * dx + pyv * dy) / len2 : 0;
      const cx = ax + t * dx;
      const cy = ay + t * dy;
      const d = Math.hypot(pxv + ax - cx, pyv + ay - cy);
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push(first, best, best, last);
    }
  }
  let count = 0;
  for (let i = 0; i < n; i++) if (keep[i] === 1) count++;
  const out = new Float32Array(count * 2);
  let w = 0;
  for (let i = 0; i < n; i++) {
    if (keep[i] === 1) {
      out[w++] = pts[i * 2] ?? 0;
      out[w++] = pts[i * 2 + 1] ?? 0;
    }
  }
  return out;
}

export function pathLengthPx(pts: Float32Array): number {
  let len = 0;
  for (let i = 2; i + 1 < pts.length; i += 2) {
    len += Math.hypot((pts[i] ?? 0) - (pts[i - 2] ?? 0), (pts[i + 1] ?? 0) - (pts[i - 1] ?? 0));
  }
  return len;
}

/** Cap a run to the sample budget by even decimation. */
export function capSamples(pts: Float32Array, max = MAX_CURVE_SAMPLES): Float32Array {
  const n = Math.floor(pts.length / 2);
  if (n <= max) return pts;
  const out = new Float32Array(max * 2);
  for (let i = 0; i < max; i++) {
    const src = Math.round((i * (n - 1)) / (max - 1));
    out[i * 2] = pts[src * 2] ?? 0;
    out[i * 2 + 1] = pts[src * 2 + 1] ?? 0;
  }
  return out;
}

/** Reduce a pixel run: RDP at 0.3 px when denser than 4 pts per px of length. */
export function reduceRun(pts: Float32Array): Float32Array {
  const n = Math.floor(pts.length / 2);
  if (n < 3) return pts;
  const len = Math.max(pathLengthPx(pts), 1);
  if (n / len <= 4) return pts;
  return rdpSimplify(pts, CURVE_TOLERANCE_PX);
}

/** Polyline point count chosen by screen radius, halved per detail level. */
export function conicSegmentCount(radiusPx: number, detail: 0 | 1 | 2): number {
  const full = Math.min(512, Math.max(12, Math.ceil((2 * Math.PI * Math.max(radiusPx, 1)) / 4)));
  return Math.max(8, full >> detail);
}

function circleRun(cx: number, cy: number, r: number, from: number, to: number, segments: number): Float32Array {
  const out = new Float32Array((segments + 1) * 2);
  for (let i = 0; i <= segments; i++) {
    const a = from + ((to - from) * i) / segments;
    out[i * 2] = cx + r * Math.cos(a);
    out[i * 2 + 1] = cy - r * Math.sin(a);
  }
  return out;
}

/** Sutherland-Hodgman clip of a ring to the view rect. */
export function clipRingToRect(ring: Float32Array, rect: PxRect): Float32Array {
  let pts = ring;
  const edges: ReadonlyArray<{ inside: (x: number, y: number) => boolean; cross: (ax: number, ay: number, bx: number, by: number) => [number, number] }> = [
    { inside: (x) => x >= (rect.x0 as number), cross: (ax, ay, bx, by) => { const t = ((rect.x0 as number) - ax) / (bx - ax); return [(rect.x0 as number), ay + t * (by - ay)]; } },
    { inside: (x) => x <= (rect.x1 as number), cross: (ax, ay, bx, by) => { const t = ((rect.x1 as number) - ax) / (bx - ax); return [(rect.x1 as number), ay + t * (by - ay)]; } },
    { inside: (_x, y) => y >= (rect.y0 as number), cross: (ax, ay, bx, by) => { const t = ((rect.y0 as number) - ay) / (by - ay); return [ax + t * (bx - ax), (rect.y0 as number)]; } },
    { inside: (_x, y) => y <= (rect.y1 as number), cross: (ax, ay, bx, by) => { const t = ((rect.y1 as number) - ay) / (by - ay); return [ax + t * (bx - ax), (rect.y1 as number)]; } },
  ];
  for (const e of edges) {
    const n = Math.floor(pts.length / 2);
    if (n === 0) return new Float32Array(0);
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2] ?? 0;
      const ay = pts[i * 2 + 1] ?? 0;
      const bx = pts[j * 2] ?? 0;
      const by = pts[j * 2 + 1] ?? 0;
      const ain = e.inside(ax, ay);
      const bin = e.inside(bx, by);
      if (ain && bin) out.push(bx, by);
      else if (ain) out.push(...e.cross(ax, ay, bx, by));
      else if (bin) out.push(...e.cross(ax, ay, bx, by), bx, by);
    }
    pts = new Float32Array(out);
  }
  return pts;
}

function ringAreaPx(ring: Float32Array): number {
  let a = 0;
  const n = Math.floor(ring.length / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += (ring[i * 2] ?? 0) * (ring[j * 2 + 1] ?? 0) - (ring[j * 2] ?? 0) * (ring[i * 2 + 1] ?? 0);
  }
  return Math.abs(a) / 2;
}

function finish(strokes: Float32Array[], fills: Float32Array[], anchor: PxPoint, style: ResolvedStyle, markerRadius: number, labelText: string | null = null): BuiltGeometry {
  let bbox: PxRect | null = null;
  for (const r of strokes) bbox = unionRect(bbox, pathBounds(r));
  for (const r of fills) bbox = unionRect(bbox, pathBounds(r));
  if (bbox !== null) bbox = expandRect(bbox, Math.max(style.width / 2, markerRadius) + 1);
  return { strokes, fills, bbox, anchor, labelText, markerRadius };
}

/**
 * Build pixel geometry for one value. Pure in (value, viewport, style);
 * returns null when there is nothing to draw (undefined is handled by the
 * caller, which keeps the slot with `bbox = null`).
 */
export function buildGeometry(value: ViewValue, input: BuildInput, style: ResolvedStyle): BuiltGeometry | null {
  const { mapper, viewRect } = input;
  switch (value.k) {
    case 'number':
    case 'bool':
      return null;
    case 'point': {
      const c = mapper.toPx({ x: value.x as never, y: value.y as never });
      return finish([], [], c, style, style.pointSize);
    }
    case 'vector': {
      const a = mapper.toPx({ x: value.ox as never, y: value.oy as never });
      const b = mapper.toPx({ x: (value.ox + value.dx) as never, y: (value.oy + value.dy) as never });
      const clipped = clipSegmentToRect(a.x as number, a.y as number, b.x as number, b.y as number, viewRect);
      if (clipped === null) return emptyGeom(a);
      return finish([new Float32Array(clipped)], [], b, style, 0);
    }
    case 'segment': {
      const a = mapper.toPx({ x: value.ax as never, y: value.ay as never });
      const b = mapper.toPx({ x: value.bx as never, y: value.by as never });
      const clipped = clipSegmentToRect(a.x as number, a.y as number, b.x as number, b.y as number, viewRect);
      if (clipped === null) {
        return emptyGeom({ x: px(((a.x as number) + (b.x as number)) / 2), y: px(((a.y as number) + (b.y as number)) / 2) });
      }
      return finish(
        [new Float32Array(clipped)],
        [],
        { x: px((clipped[0]! + clipped[2]!) / 2), y: px((clipped[1]! + clipped[3]!) / 2) },
        style, 0,
      );
    }
    case 'ray':
    case 'line': {
      // Lines and rays are never stored as long segments; they clip to the view.
      const o = mapper.toPx({ x: value.ox as never, y: value.oy as never });
      const len = Math.hypot(value.dx * input.view.scaleX, value.dy * input.view.scaleY) || 1;
      const ux = (value.dx * input.view.scaleX) / len;
      const uy = -(value.dy * input.view.scaleY) / len;
      const diag = Math.hypot(viewRect.x1 as number, viewRect.y1 as number) + 4;
      const t0 = value.k === 'line' ? -diag : 0;
      const clipped = clipSegmentToRect(
        (o.x as number) + ux * t0, (o.y as number) + uy * t0,
        (o.x as number) + ux * diag, (o.y as number) + uy * diag, viewRect,
      );
      if (clipped === null) return emptyGeom(o);
      return finish(
        [new Float32Array(clipped)], [],
        { x: px((clipped[0]! + clipped[2]!) / 2), y: px((clipped[1]! + clipped[3]!) / 2) },
        style, 0,
      );
    }
    case 'circle':
    case 'arc': {
      const c = mapper.toPx({ x: value.cx as never, y: value.cy as never });
      const r = Math.min(input.view.scaleX, input.view.scaleY) * value.r;
      if (!(r > 0)) return emptyGeom(c);
      const segs = conicSegmentCount(r, input.detail);
      const from = value.k === 'arc' ? value.from : 0;
      const to = value.k === 'arc' ? value.to : 2 * Math.PI;
      return finish([circleRun(c.x as number, c.y as number, r, from, to, segs)], [], c, style, 0);
    }
    case 'polygon': {
      const runs = mapPolyline(value.pts, mapper);
      const fills: Float32Array[] = [];
      const strokes: Float32Array[] = [];
      for (const run of runs) {
        const clipped = clipRingToRect(run, viewRect);
        if (clipped.length < 6 || ringAreaPx(clipped) < 0.5) continue;
        fills.push(clipped);
        strokes.push(clipped);
      }
      if (fills.length === 0) {
        const first = runs[0];
        const anchor: PxPoint = first !== undefined && first.length >= 2
          ? { x: px(first[0] ?? 0), y: px(first[1] ?? 0) }
          : { x: px(0), y: px(0) };
        return emptyGeom(anchor);
      }
      const a0 = fills[0];
      const anchor: PxPoint = a0 !== undefined ? { x: px(a0[0] ?? 0), y: px(a0[1] ?? 0) } : { x: px(0), y: px(0) };
      return finish(strokes, fills, anchor, style, 0);
    }
    case 'polyline': {
      const runs = mapPolyline(value.pts, mapper).map(reduceRun);
      const strokes = runs.filter((r) => r.length >= 4);
      const first = strokes[0];
      const anchor: PxPoint = first !== undefined ? { x: px(first[0] ?? 0), y: px(first[1] ?? 0) } : { x: px(0), y: px(0) };
      if (strokes.length === 0) return emptyGeom(anchor);
      return finish(strokes, value.closed ? strokes : [], anchor, style, 0);
    }
    case 'curve': {
      const strokes: Float32Array[] = [];
      for (const run of value.runs) {
        for (const mapped of mapPolyline(run, mapper)) {
          const c = capSamples(input.detail === 0 ? mapped : capSamples(mapped, MAX_CURVE_SAMPLES >> input.detail));
          const r = reduceRun(c);
          if (r.length >= 4) strokes.push(r);
        }
      }
      const first = strokes[0];
      const anchor: PxPoint = first !== undefined ? { x: px(first[0] ?? 0), y: px(first[first.length - 2] ?? 0) } : { x: px(0), y: px(0) };
      if (strokes.length === 0) return emptyGeom(anchor);
      return finish(strokes, [], anchor, style, 0);
    }
    case 'region': {
      const fills: Float32Array[] = [];
      const strokes: Float32Array[] = [];
      for (const ring of value.rings) {
        for (const mapped of mapPolyline(ring, mapper)) {
          const clipped = clipRingToRect(mapped, viewRect);
          if (clipped.length < 6) continue;
          fills.push(clipped);
          strokes.push(clipped);
        }
      }
      const first = fills[0];
      const anchor: PxPoint = first !== undefined ? { x: px(first[0] ?? 0), y: px(first[1] ?? 0) } : { x: px(0), y: px(0) };
      if (fills.length === 0) return emptyGeom(anchor);
      return finish(strokes, fills, anchor, style, 0);
    }
    case 'angle': {
      const c = mapper.toPx({ x: value.cx as never, y: value.cy as never });
      const r = Math.min(input.view.scaleX, input.view.scaleY) * value.r;
      if (value.right) {
        const x0 = c.x as number;
        const y0 = c.y as number;
        const s = Math.max(r, 8);
        const sq = new Float32Array([x0 + s, y0, x0 + s, y0 - s, x0, y0 - s]);
        return finish([sq], [], c, style, 0, '90°');
      }
      const segs = Math.max(8, conicSegmentCount(r, input.detail) >> 2);
      const run = circleRun(c.x as number, c.y as number, r, value.from, value.to, segs);
      const deg = Math.round((((value.to - value.from) * 180) / Math.PI) * 10) / 10;
      return finish([run], [run], c, style, 0, `${deg}°`);
    }
    case 'text': {
      const anchor: PxPoint = value.screen
        ? { x: px(value.atX), y: px(value.atY) }
        : mapper.toPx({ x: value.atX as never, y: value.atY as never });
      return finish([], [], anchor, style, 0, value.text);
    }
    case 'slider': {
      return finish([], [], { x: px(0), y: px(0) }, style, 0, null);
    }
    case 'trace': {
      const strokes: Float32Array[] = [];
      for (const mapped of mapPolyline(value.pts, mapper)) {
        if (input.traceJoin) {
          if (mapped.length >= 4) strokes.push(mapped);
          continue;
        }
        // Break at jumps beyond 25% of the view diagonal (animation-time 9.4).
        const diag = Math.hypot((viewRect.x1 as number) - (viewRect.x0 as number), (viewRect.y1 as number) - (viewRect.y0 as number));
        const limit = diag * 0.25;
        let cur: number[] = [];
        const flush = (): void => {
          if (cur.length >= 4) strokes.push(new Float32Array(cur));
          cur = [];
        };
        for (let i = 0; i + 1 < mapped.length; i += 2) {
          if (i >= 2) {
            const jump = Math.hypot((mapped[i] ?? 0) - (mapped[i - 2] ?? 0), (mapped[i + 1] ?? 0) - (mapped[i - 1] ?? 0));
            if (jump > limit) flush();
          }
          cur.push(mapped[i] ?? 0, mapped[i + 1] ?? 0);
        }
        flush();
      }
      const first = strokes[0];
      const anchor: PxPoint = first !== undefined ? { x: px(first[0] ?? 0), y: px(first[1] ?? 0) } : { x: px(0), y: px(0) };
      if (strokes.length === 0) return emptyGeom(anchor);
      return finish(strokes, [], anchor, style, 0);
    }
    case 'particles':
    case 'point3':
    case 'mesh':
    case 'meshref':
      // Particles draw through the particle renderer; 3D through the scene.
      return null;
  }
}

/** Shift cached pixel geometry after a pan (design 7.2). */
export function shiftGeometry(g: BuiltGeometry, dx: number, dy: number): BuiltGeometry {
  const shift = (run: Float32Array): Float32Array => {
    const out = new Float32Array(run.length);
    for (let i = 0; i + 1 < run.length; i += 2) {
      out[i] = (run[i] ?? 0) + dx;
      out[i + 1] = (run[i + 1] ?? 0) + dy;
    }
    return out;
  };
  const bbox = g.bbox === null
    ? null
    : {
      x0: px((g.bbox.x0 as number) + dx),
      x1: px((g.bbox.x1 as number) + dx),
      y0: px((g.bbox.y0 as number) + dy),
      y1: px((g.bbox.y1 as number) + dy),
    };
  return {
    strokes: g.strokes.map(shift),
    fills: g.fills.map(shift),
    bbox,
    anchor: { x: px((g.anchor.x as number) + dx), y: px((g.anchor.y as number) + dy) },
    labelText: g.labelText,
    markerRadius: g.markerRadius,
  };
}

/* ---------------- hit-test maths (design 10.7) ---------------- */

export function pointSegmentDistance(pxv: number, pyv: number, ax: number, ay: number, bx: number, by: number): { dist: number; t: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((pxv - ax) * dx + (pyv - ay) * dy) / len2)) : 0;
  return { dist: Math.hypot(pxv - (ax + t * dx), pyv - (ay + t * dy)), t };
}

/**
 * Nearest point on a cached pixel polyline: nearest vertex, then a
 * perpendicular-distance refine on the best segment (design 10.7).
 */
export function nearestOnPolyline(run: Float32Array, pxv: number, pyv: number): { dist: number; param: number } {
  const n = Math.floor(run.length / 2);
  if (n === 0) return { dist: Infinity, param: 0 };
  if (n === 1) return { dist: Math.hypot(pxv - (run[0] ?? 0), pyv - (run[1] ?? 0)), param: 0 };
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(pxv - (run[i * 2] ?? 0), pyv - (run[i * 2 + 1] ?? 0));
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  let best = bd;
  let param = bi / Math.max(n - 1, 1);
  for (const j of [bi - 1, bi]) {
    if (j < 0 || j + 1 >= n) continue;
    const r = pointSegmentDistance(pxv, pyv, run[j * 2] ?? 0, run[j * 2 + 1] ?? 0, run[j * 2 + 2] ?? 0, run[j * 2 + 3] ?? 0);
    if (r.dist < best) {
      best = r.dist;
      param = (j + r.t) / Math.max(n - 1, 1);
    }
  }
  return { dist: best, param };
}

/** Even-odd point-in-polygon test in pixels (design 10.7). */
export function pointInPolygon(ring: Float32Array, pxv: number, pyv: number): boolean {
  const n = Math.floor(ring.length / 2);
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2] ?? 0;
    const yi = ring[i * 2 + 1] ?? 0;
    const xj = ring[j * 2] ?? 0;
    const yj = ring[j * 2 + 1] ?? 0;
    if (yi > pyv !== yj > pyv && pxv < ((xj - xi) * (pyv - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Hit-test cached geometry in view pixels. Ranking priorities come from
 * design 10.4 (label 0, point 1, text/widget 2, edge 3, fill 4, image 5).
 */
export function hitGeometry(
  id: ObjId,
  kind: PaintKind,
  geom: BuiltGeometry,
  p: PxPoint,
  slack: number,
): HitCandidate | null {
  const x = p.x as number;
  const y = p.y as number;
  switch (kind) {
    case 'point': {
      const d = Math.hypot(x - (geom.anchor.x as number), y - (geom.anchor.y as number));
      if (d <= geom.markerRadius + slack) {
        return { id, part: 'body', distance: d, priority: 1 };
      }
      return null;
    }
    case 'text':
    case 'widget': {
      if (geom.bbox === null) return null;
      const inside =
        x >= (geom.bbox.x0 as number) - 2 && x <= (geom.bbox.x1 as number) + 2 &&
        y >= (geom.bbox.y0 as number) - 2 && y <= (geom.bbox.y1 as number) + 2;
      return inside ? { id, part: 'body', distance: 0, priority: 2 } : null;
    }
    case 'image': {
      if (geom.bbox === null) return null;
      const inside =
        x >= (geom.bbox.x0 as number) && x <= (geom.bbox.x1 as number) &&
        y >= (geom.bbox.y0 as number) && y <= (geom.bbox.y1 as number);
      return inside ? { id, part: 'fill', distance: 0, priority: 5 } : null;
    }
    case 'particles':
      return null;
    default: {
      let best: HitCandidate | null = null;
      for (const run of geom.strokes) {
        const r = nearestOnPolyline(run, x, y);
        if (r.dist <= slack && (best === null || r.dist < best.distance)) {
          best = { id, part: 'edge', distance: r.dist, priority: 3, param: r.param };
        }
      }
      if (best !== null) return best;
      for (const ring of geom.fills) {
        if (pointInPolygon(ring, x, y)) {
          return { id, part: 'fill', distance: 0, priority: 4 };
        }
      }
      return null;
    }
  }
}

/** Marker outline in pixels for a point shape (for paint and halo). */
export function markerStroke(shape: PointShape, x: number, y: number, r: number): Array<readonly [number, number, number, number]> {
  switch (shape) {
    case 'cross': return [[x - r, y - r, x + r, y + r], [x - r, y + r, x + r, y - r]];
    case 'plus': return [[x - r, y, x + r, y], [x, y - r, x, y + r]];
    case 'square':
    case 'square-open':
      return [[x - r, y - r, x + r, y - r], [x + r, y - r, x + r, y + r], [x + r, y + r, x - r, y + r], [x - r, y + r, x - r, y - r]];
    case 'diamond':
    case 'diamond-open':
      return [[x, y - r, x + r, y], [x + r, y, x, y + r], [x, y + r, x - r, y], [x - r, y, x, y - r]];
    case 'triangle-up': return [[x, y - r, x + r, y + r], [x + r, y + r, x - r, y + r], [x - r, y + r, x, y - r]];
    case 'triangle-down': return [[x, y + r, x + r, y - r], [x + r, y - r, x - r, y - r], [x - r, y - r, x, y + r]];
    case 'triangle-left': return [[x - r, y, x + r, y - r], [x + r, y - r, x + r, y + r], [x + r, y + r, x - r, y]];
    case 'triangle-right': return [[x + r, y, x - r, y - r], [x - r, y - r, x - r, y + r], [x - r, y + r, x + r, y]];
    default: return [];
  }
}

/** True for shapes drawn as an open outline rather than a filled disc. */
export function markerIsOpen(shape: PointShape): boolean {
  return shape === 'ring' || shape === 'cross' || shape === 'plus' || shape.endsWith('-open');
}
