/**
 * Traces (animation-time design 9): the trail a moving object leaves, kept as data in maths coordinates so zoom and pan
 * never erase it, and rebuilt on a seek so it is the same however the film got to its time.
 *
 * A point's trace is a polyline sampled every 1/60 s of film time; an undefined sample is a gap (`NaN, NaN`). Other
 * traceable objects keep snapshots of their value every 1/30 s, which the view draws as faded copies. The samples come
 * from the kernel slice over the clock, so sampling never disturbs the live figure.
 */
import type { ObjId } from '../../contracts/values';
import type { Notice } from '../../contracts/errors';
import { makeNotice } from '../../errors/notices';
import type { Figure } from '../../graph/figure';

/** Film-time spacing of point samples and of shape snapshots. */
export const POINT_DT = 1 / 60;
export const SHAPE_DT = 1 / 30;
/** Caps (design 9.4, 9.6; errors 6). */
export const MAX_TRACE_POINTS = 5000;
export const MAX_SHAPE_SNAPSHOTS = 300;
export const MAX_TRACES = 20;
/** At most this many samples per frame; a longer gap is filled on the next seek. */
const MAX_SAMPLES_PER_FRAME = 6;

/** Types whose trail is a polyline, and types whose trail is a set of snapshots. */
export const POINT_TRACE_TYPES: ReadonlySet<string> = new Set(['Point']);
export const SHAPE_TRACE_TYPES: ReadonlySet<string> = new Set(['Segment', 'Line', 'Ray', 'Vector', 'Circle', 'Polygon', 'Arc', 'Conic']);

export interface TraceOptions {
  /** Keep only the last this many seconds; `undefined` keeps the whole history. */
  readonly window?: number;
  /** Older parts fade (the view's job; kept here so it saves with the trace). */
  readonly fade: boolean;
  /** Join samples across a jump instead of breaking the line. */
  readonly join: boolean;
}

interface TraceData {
  options: TraceOptions;
  kind: 'point' | 'shape';
  /** Film times of the samples, oldest first. */
  times: number[];
  /** Point samples (x, y), or `NaN` for a gap. */
  xs: number[];
  ys: number[];
  /** Shape snapshots: the object's value at each time (`undefined` for a gap). */
  shots: unknown[];
  /** The spacing now: it doubles each time a trace without a window is thinned. */
  dt: number;
  /** The film time up to which the trace is filled. */
  until: number;
  /** Drag samples (design 9.5): appended on each drag step, never rebuilt by a seek. */
  drag: { xs: number[]; ys: number[]; shots: unknown[]; every: number; seen: number };
  /** The object's definition when tracing started: a redefinition forgets the drag samples (its meaning changed). */
  definition: string;
}

const emptyDrag = (): TraceData['drag'] => ({ xs: [], ys: [], shots: [], every: 1, seen: 0 });

const STORES = new WeakMap<Figure, Map<ObjId, TraceData>>();

function storeOf(figure: Figure): Map<ObjId, TraceData> {
  let s = STORES.get(figure);
  if (!s) {
    s = new Map();
    STORES.set(figure, s);
  }
  return s;
}

/** True when the type can leave a trace. */
export function isTraceable(type: string): boolean {
  return POINT_TRACE_TYPES.has(type) || SHAPE_TRACE_TYPES.has(type);
}

/** Starts (or restarts with new options) the trace of an object, filled for the time before now. */
export function startTrace(figure: Figure, id: ObjId, options: TraceOptions): Notice[] {
  const view = figure.get(id);
  if (!view || !isTraceable(view.type)) return [];
  const kind = POINT_TRACE_TYPES.has(view.type) ? 'point' : 'shape';
  const data: TraceData = { options, kind, times: [], xs: [], ys: [], shots: [], dt: kind === 'point' ? POINT_DT : SHAPE_DT, until: Number.NEGATIVE_INFINITY, drag: emptyDrag(), definition: view.definition };
  storeOf(figure).set(id, data);
  return rebuild(figure, id, data, figure.clock().t);
}

/** Stops tracing and forgets the history. */
export function stopTrace(figure: Figure, id: ObjId): boolean {
  return storeOf(figure).delete(id);
}

/** Keeps tracing but forgets the history so far. */
export function clearTrace(figure: Figure, id: ObjId): boolean {
  const d = storeOf(figure).get(id);
  if (!d) return false;
  d.times = [];
  d.xs = [];
  d.ys = [];
  d.shots = [];
  d.dt = d.kind === 'point' ? POINT_DT : SHAPE_DT;
  d.until = figure.clock().t;
  d.drag = emptyDrag();
  return true;
}

export function isTraced(figure: Figure, id: ObjId): boolean {
  return storeOf(figure).has(id);
}

export function traceCount(figure: Figure): number {
  return storeOf(figure).size;
}

export function traceOptionsOf(figure: Figure, id: ObjId): TraceOptions | undefined {
  return storeOf(figure).get(id)?.options;
}

/**
 * A point's trace as packed `x, y` pairs in maths coordinates (`NaN, NaN` for a gap): the view's `trace` value. The time
 * samples come first; drag samples, if any, follow after a gap.
 */
export function tracePoints(figure: Figure, id: ObjId): Float64Array | undefined {
  const d = storeOf(figure).get(id);
  if (!d || d.kind !== 'point') return undefined;
  const nd = d.drag.xs.length;
  const sep = nd > 0 && d.xs.length > 0 ? 1 : 0;
  const out = new Float64Array((d.xs.length + sep + nd) * 2);
  let k = 0;
  const put = (x: number, y: number): void => {
    out[k++] = x;
    out[k++] = y;
  };
  for (let i = 0; i < d.xs.length; i++) put(d.xs[i] as number, d.ys[i] as number);
  if (sep) put(Number.NaN, Number.NaN);
  for (let i = 0; i < nd; i++) put(d.drag.xs[i] as number, d.drag.ys[i] as number);
  return out;
}

/** A point's drag samples only, as packed `x, y` pairs. */
export function traceDragPoints(figure: Figure, id: ObjId): Float64Array | undefined {
  const d = storeOf(figure).get(id);
  if (!d || d.kind !== 'point') return undefined;
  const out = new Float64Array(d.drag.xs.length * 2);
  d.drag.xs.forEach((x, i) => {
    out[2 * i] = x;
    out[2 * i + 1] = d.drag.ys[i] as number;
  });
  return out;
}

/** A shape's drag snapshots, oldest first. */
export function traceDragSnapshots(figure: Figure, id: ObjId): readonly unknown[] | undefined {
  const d = storeOf(figure).get(id);
  if (!d || d.kind !== 'shape') return undefined;
  return d.drag.shots.slice();
}

/**
 * The drag listener (design 9.5): each drag step appends the current value of every traced object it changed. Drag
 * samples are capped like time samples (thinned by 2 past the cap) and are not replayed by a seek. A redefinition of the
 * traced object forgets them.
 */
export function traceDragStep(figure: Figure, changed: readonly ObjId[]): void {
  const store = storeOf(figure);
  if (store.size === 0) return;
  for (const id of changed) {
    const d = store.get(id);
    if (!d) continue;
    const view = figure.get(id);
    if (!view) {
      store.delete(id);
      continue;
    }
    if (view.definition !== d.definition) {
      d.definition = view.definition;
      d.drag = emptyDrag();
    }
    const g = d.drag;
    // after thinning, keep only every `every`-th step so the spacing stays even
    g.seen++;
    if ((g.seen - 1) % g.every !== 0) continue;
    const c = figure.cellOf(id) as { defined: boolean; value?: unknown } | undefined;
    if (d.kind === 'point') {
      const p = c?.defined ? (c.value as { x?: unknown; y?: unknown }) : undefined;
      const ok = typeof p?.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y);
      g.xs.push(ok ? (p.x as number) : Number.NaN);
      g.ys.push(ok ? (p.y as number) : Number.NaN);
      if (g.xs.length > MAX_TRACE_POINTS) {
        const keep = (_: unknown, i: number): boolean => i % 2 === 0;
        g.xs = g.xs.filter(keep);
        g.ys = g.ys.filter(keep);
        g.every *= 2;
      }
    } else {
      g.shots.push(c?.defined ? c.value : undefined);
      if (g.shots.length > MAX_SHAPE_SNAPSHOTS) {
        g.shots = g.shots.filter((_, i) => i % 2 === 0);
        g.every *= 2;
      }
    }
  }
}

/** A shape's snapshots with their film times, oldest first (`value` is `undefined` for a gap). */
export function traceSnapshots(figure: Figure, id: ObjId): readonly { readonly t: number; readonly value: unknown }[] | undefined {
  const d = storeOf(figure).get(id);
  if (!d || d.kind !== 'shape') return undefined;
  return d.shots.map((value, i) => ({ t: d.times[i] as number, value }));
}

/** Every traced object, for the view and for saving. */
export function tracedIds(figure: Figure): readonly ObjId[] {
  return [...storeOf(figure).keys()];
}

/**
 * The player's per-frame work: a frame adds the samples since the last one (a few at most); a seek rebuilds each trace
 * for the time before `t`. A traced object that was deleted drops its trace.
 */
export function tickTraces(figure: Figure, t: number, how: 'frame' | 'seek'): Notice[] {
  const notices: Notice[] = [];
  const store = storeOf(figure);
  for (const [id, d] of store) {
    const view = figure.get(id);
    if (!view) {
      store.delete(id);
      continue;
    }
    if (view.definition !== d.definition) {
      d.definition = view.definition;
      d.drag = emptyDrag();
    }
    const far = t < d.until || t - d.until > MAX_SAMPLES_PER_FRAME * d.dt;
    if (how === 'seek' || far) notices.push(...rebuild(figure, id, d, t));
    else notices.push(...extend(figure, id, d, t));
  }
  return notices;
}

/* ------------------------------ inside ------------------------------ */

/** The window's start, or the film start. */
function startOf(figure: Figure, d: TraceData, t: number): number {
  const from = figure.clockRange().from;
  return d.options.window !== undefined ? Math.max(from, t - d.options.window) : from;
}

function rebuild(figure: Figure, id: ObjId, d: TraceData, t: number): Notice[] {
  d.times = [];
  d.xs = [];
  d.ys = [];
  d.shots = [];
  const base = d.kind === 'point' ? POINT_DT : SHAPE_DT;
  const from = startOf(figure, d, t);
  const cap = d.kind === 'point' ? MAX_TRACE_POINTS : MAX_SHAPE_SNAPSHOTS;
  // without a window a long history is sampled more coarsely, so it keeps its whole shape within the cap
  d.dt = base;
  while ((t - from) / d.dt + 1 > cap) d.dt *= 2;
  const times: number[] = [];
  for (let k = 0; ; k++) {
    const tk = from + k * d.dt;
    if (tk > t + 1e-9) break;
    times.push(tk);
  }
  if (times.length === 0 || (times[times.length - 1] as number) < t - 1e-9) times.push(t);
  sampleInto(figure, id, d, times);
  d.until = t;
  return d.dt > base ? [makeNotice('trace_decimated', { name: figure.get(id)?.name ?? '', points: cap }, [figure.get(id)?.name ?? ''])] : [];
}

function extend(figure: Figure, id: ObjId, d: TraceData, t: number): Notice[] {
  const times: number[] = [];
  let tk = d.until + d.dt;
  while (tk <= t + 1e-9 && times.length < MAX_SAMPLES_PER_FRAME) {
    times.push(tk);
    tk += d.dt;
  }
  if (times.length === 0) return [];
  sampleInto(figure, id, d, times);
  d.until = times[times.length - 1] as number;
  return trim(figure, id, d, t);
}

/** Drops what is outside the window, or thins a history past its cap. */
function trim(figure: Figure, id: ObjId, d: TraceData, t: number): Notice[] {
  if (d.options.window !== undefined) {
    const from = t - d.options.window;
    let k = 0;
    while (k < d.times.length && (d.times[k] as number) < from - 1e-9) k++;
    if (k > 0) cut(d, k);
  }
  const cap = d.kind === 'point' ? MAX_TRACE_POINTS : MAX_SHAPE_SNAPSHOTS;
  if (d.times.length <= cap) return [];
  if (d.options.window !== undefined) {
    cut(d, d.times.length - cap);
    return [];
  }
  const keep = (_: unknown, i: number): boolean => i % 2 === 0;
  d.times = d.times.filter(keep);
  d.xs = d.xs.filter(keep);
  d.ys = d.ys.filter(keep);
  d.shots = d.shots.filter(keep);
  d.dt *= 2;
  const name = figure.get(id)?.name ?? '';
  return [makeNotice('trace_decimated', { name, points: cap }, [name])];
}

function cut(d: TraceData, k: number): void {
  d.times.splice(0, k);
  if (d.kind === 'point') {
    d.xs.splice(0, k);
    d.ys.splice(0, k);
  } else d.shots.splice(0, k);
}

/** Samples the object at the given film times, through the slice over the clock when it moves with time. */
function sampleInto(figure: Figure, id: ObjId, d: TraceData, times: readonly number[]): void {
  const slice = figure.slice('t', id);
  let cells: { defined: boolean; value?: unknown }[];
  if ('run' in slice && (slice.chain.length > 0 || (slice.states?.length ?? 0) > 0)) cells = slice.run(times) as { defined: boolean; value?: unknown }[];
  else {
    // it does not move with time (it moves only through drags): every sample is its value now
    const c = figure.cellOf(id);
    cells = times.map(() => (c ? (c as { defined: boolean; value?: unknown }) : { defined: false }));
  }
  times.forEach((tk, i) => {
    const c = cells[i];
    d.times.push(tk);
    if (d.kind === 'point') {
      const p = c?.defined ? (c.value as { x?: unknown; y?: unknown }) : undefined;
      const ok = typeof p?.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y);
      d.xs.push(ok ? (p.x as number) : Number.NaN);
      d.ys.push(ok ? (p.y as number) : Number.NaN);
    } else d.shots.push(c?.defined ? c.value : undefined);
  });
}
