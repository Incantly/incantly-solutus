/**
 * Shared helpers for the plot spec tests.
 *
 * Built from the docs and the public APIs only:
 * - `docs/features/functions-calculus/design.md` section 9 (function plotter),
 * - `docs/features/curves-loci/design.md` sections 5-7 (tracers, filler),
 * - `docs/design/performance.md` section 5 (budgets),
 * - the `@incantly/plot` entry plus `contracts.ts` (shapes, constants),
 * - the `@incantly/kernel` entry (compiled `FunctionValue` / `RelationValue`
 *   inputs, used exactly as the kernel's own spec tests use them).
 *
 * Every enclosure/helper below is a SOUND test double: interval enclosures
 * contain every true value of the named function over the box, and tri-state
 * doubles answer 'maybe' whenever certainty fails. Failing tests therefore
 * blame the tracer, never the double.
 */
import { expect } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';
import type { FunctionValue, RelationValue, Result } from '@incantly/kernel';
import type {
  FieldEnclosure,
  FunctionPlot,
  MarkerKind,
  ParamEnclosure,
  PlotMarker,
  PredicateEnclosure,
  ScalarBox,
  ScalarEnclosure,
  ScalarTriState,
  ViewBox,
} from '@incantly/plot';

// --------------------------------------------------------------------------------------------
// Timeouts: every spec passes an explicit hard limit so nothing can hang silently.
// --------------------------------------------------------------------------------------------

export const TIMEOUT = 20_000;
export const HEAVY_TIMEOUT = 60_000;

// --------------------------------------------------------------------------------------------
// Views.
// --------------------------------------------------------------------------------------------

export const VIEW: ViewBox = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
export const VIEW_SQ: ViewBox = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 600, heightPx: 600 };
export const VIEW_UNIT: ViewBox = { x0: -1, x1: 1, y0: -2, y1: 2, widthPx: 800, heightPx: 600 };

export const viewWidth = (widthPx: number, heightPx = 600): ViewBox => ({
  x0: -5,
  x1: 5,
  y0: -5,
  y1: 5,
  widthPx,
  heightPx,
});

// Documented pixel mapping (maths x grows right, maths y grows up, pixels y down).
export const pxOf = (v: ViewBox, x: number): number => ((x - v.x0) / (v.x1 - v.x0)) * v.widthPx;
export const pyOf = (v: ViewBox, y: number): number => ((v.y1 - y) / (v.y1 - v.y0)) * v.heightPx;
export const xOfPx = (v: ViewBox, px: number): number => v.x0 + (px / v.widthPx) * (v.x1 - v.x0);
export const yOfPy = (v: ViewBox, py: number): number => v.y1 - (py / v.heightPx) * (v.y1 - v.y0);

// --------------------------------------------------------------------------------------------
// Kernel inputs, via the kernel's public entry only.
// --------------------------------------------------------------------------------------------

const fig = new ScratchFigure();
let seq = 0;

const define = (makeLine: (name: string) => string): string => {
  seq += 1;
  const name = `p${seq}`;
  const line = makeLine(name);
  const r = fig.apply(line);
  if (!r.ok) throw new Error(`setup line "${line}" failed: ${r.kind}: ${r.message}`);
  return name;
};

/** A one-variable scalar function, e.g. `fn1('x^2 - 2')`. Throws when the line fails. */
export const fn1 = (body: string): FunctionValue => {
  const name = define((n) => `${n}(x) = ${body}`);
  return fig.valueOf(name) as FunctionValue;
};

/** A one-parameter point-valued function for parametric curves. */
export const pointFn = (xb: string, yb: string): FunctionValue => {
  const name = define((n) => `${n}(s) = (${xb}, ${yb})`);
  return fig.valueOf(name) as FunctionValue;
};

const isRelation = (v: unknown): v is RelationValue => {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r['test'] === 'function' && typeof r['residual'] === 'function';
};

/** A relation in the implicit binders x, y, e.g. `rel2('x^2 + y^2 == 4')`. */
export const rel2 = (text: string): RelationValue => {
  const name = define((n) => `${n} = ${text}`);
  const v: unknown = fig.valueOf(name);
  if (!isRelation(v)) throw new Error(`"${text}" did not evaluate to a relation`);
  return v;
};

// --------------------------------------------------------------------------------------------
// Result unwrapping (errors/design.md 5: Result<T>, never throws).
// --------------------------------------------------------------------------------------------

export const expectOk = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(`expected success, got ${r.kind} (${r.code}): ${r.message} [hint: ${r.hint ?? ''}]`);
  expect(r.notices).toEqual([]);
  return r.value;
};

export const expectErr = (r: Result<unknown>): Extract<Result<unknown>, { ok: false }> => {
  if (r.ok) throw new Error('expected an error but the call passed');
  return r;
};

// --------------------------------------------------------------------------------------------
// Paths and markers.
// --------------------------------------------------------------------------------------------

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export const pairs = (path: Float64Array): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < path.length; i += 2) out.push({ x: path[i] ?? 0, y: path[i + 1] ?? 0 });
  return out;
};

export const boundsOf = (path: Float64Array): { minX: number; maxX: number; minY: number; maxY: number } | undefined => {
  if (path.length < 2) return undefined;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < path.length; i += 2) {
    const x = path[i] ?? 0;
    const y = path[i + 1] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
};

/** Longest segment of a pixel polyline, in pixels. */
export const maxSegPx = (path: Float64Array): number => {
  let m = 0;
  for (let i = 2; i + 1 < path.length; i += 2) {
    const dx = (path[i] ?? 0) - (path[i - 2] ?? 0);
    const dy = (path[i + 1] ?? 0) - (path[i - 1] ?? 0);
    const d = Math.hypot(dx, dy);
    if (d > m) m = d;
  }
  return m;
};

/** Distance from (x, y) to the closest vertex of a pixel polyline. */
export const nearestVertexPx = (path: Float64Array, x: number, y: number): number => {
  let m = Infinity;
  for (let i = 0; i + 1 < path.length; i += 2) {
    const d = Math.hypot((path[i] ?? 0) - x, (path[i + 1] ?? 0) - y);
    if (d < m) m = d;
  }
  return m;
};

export const markersOf = (ms: readonly PlotMarker[], kind: MarkerKind): PlotMarker[] => ms.filter((m) => m.kind === kind);

/** Every marker carries finite maths AND pixel coordinates (undrawable otherwise). */
export const expectFiniteMarkers = (plot: FunctionPlot | { readonly markers: readonly PlotMarker[] }): void => {
  for (const m of plot.markers) {
    expect(Number.isFinite(m.x), `marker ${m.kind} x`).toBe(true);
    expect(Number.isFinite(m.y), `marker ${m.kind} y`).toBe(true);
    expect(Number.isFinite(m.px), `marker ${m.kind} px`).toBe(true);
    expect(Number.isFinite(m.py), `marker ${m.kind} py`).toBe(true);
  }
};

/**
 * Marker pixel coordinates agree with the maths coordinates through the view
 * mapping: absolute within 1.5px for sane values, relative (1e-9) where float
 * noise dominates at astronomic magnitudes.
 */
export const expectMarkerMapping = (v: ViewBox, m: PlotMarker, tolPx = 1.5): void => {
  const wx = pxOf(v, m.x);
  const wy = pyOf(v, m.y);
  expect(Math.abs(m.px - wx) < Math.max(tolPx, 1e-9 * Math.abs(wx)), `marker ${m.kind} px mapping`).toBe(true);
  expect(Math.abs(m.py - wy) < Math.max(tolPx, 1e-9 * Math.abs(wy)), `marker ${m.kind} py mapping`).toBe(true);
};

// --------------------------------------------------------------------------------------------
// Region areas (pixels).
// --------------------------------------------------------------------------------------------

export const rectsAreaPx = (rects: Float64Array): number => {
  let a = 0;
  for (let i = 0; i + 3 < rects.length; i += 4) {
    a += Math.abs((rects[i + 2] ?? 0) - (rects[i] ?? 0)) * Math.abs((rects[i + 3] ?? 0) - (rects[i + 1] ?? 0));
  }
  return a;
};

export const polyAreaPx = (poly: Float64Array): number => {
  let a = 0;
  const n = Math.floor(poly.length / 2);
  for (let i = 0; i < n; i += 1) {
    const x0 = poly[(2 * i) % poly.length] ?? 0;
    const y0 = poly[(2 * i + 1) % poly.length] ?? 0;
    const x1 = poly[(2 * i + 2) % poly.length] ?? 0;
    const y1 = poly[(2 * i + 3) % poly.length] ?? 0;
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
};

// --------------------------------------------------------------------------------------------
// Sound scalar enclosures (functions-calculus 5: IvSet with def 0|1|2).
// --------------------------------------------------------------------------------------------

const box = (lo: number, hi: number, def: 0 | 1 | 2): ScalarBox => ({ lo, hi, def });

/** Exact enclosure of x^2 - 2 over [lo, hi]. */
export const squareEnc: ScalarEnclosure = (lo, hi) => {
  if (lo >= 0) return box(lo * lo - 2, hi * hi - 2, 2);
  if (hi <= 0) return box(hi * hi - 2, lo * lo - 2, 2);
  return box(-2, Math.max(lo * lo, hi * hi) - 2, 2);
};

/** Sound enclosure of 1/x: unbounded with def 1 across 0, exact elsewhere. */
export const invEnc: ScalarEnclosure = (lo, hi) => {
  if (lo === 0 && hi === 0) return box(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 0);
  if (hi < 0 || lo > 0) return box(1 / hi, 1 / lo, 2);
  return box(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 1);
};

/** Sound enclosure of tan(x): unbounded with def 1 across any pole, exact elsewhere. */
export const tanEnc: ScalarEnclosure = (lo, hi) => {
  for (let k = -400; k <= 400; k += 1) {
    const c = Math.PI / 2 + k * Math.PI;
    if (lo <= c && c <= hi) return box(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, 1);
  }
  return box(Math.tan(lo), Math.tan(hi), 2);
};

/** Sound enclosure of floor(x): exact integer range, defined everywhere. */
export const floorEnc: ScalarEnclosure = (lo, hi) => box(Math.floor(lo), Math.floor(hi), 2);

/** Sound enclosure of (x^2-1)/(x-1): the line x+1 with def 1 across the hole at 1. */
export const holeEnc: ScalarEnclosure = (lo, hi) => {
  if (lo <= 1 && 1 <= hi) return box(lo + 1, hi + 1, 1);
  return box(lo + 1, hi + 1, 2);
};

/** Sound enclosure of sqrt(x): def 0 below 0, def 1 across 0, exact above. */
export const sqrtEnc: ScalarEnclosure = (lo, hi) => {
  if (hi < 0) return box(0, 0, 0);
  if (lo < 0) return box(0, Math.sqrt(hi), 1);
  return box(Math.sqrt(lo), Math.sqrt(hi), 2);
};

/** Sound enclosure of atan(50x): steep but bounded and everywhere defined. */
export const steepEnc: ScalarEnclosure = (lo, hi) => box(Math.atan(50 * lo), Math.atan(50 * hi), 2);

/** Sound enclosure of sin(x): coarse but valid ([-1, 1], defined everywhere). */
export const sinEnc: ScalarEnclosure = (_lo, _hi) => box(-1, 1, 2);

// --------------------------------------------------------------------------------------------
// Sound field / predicate / parametric enclosures (curves-loci 5-7).
// --------------------------------------------------------------------------------------------

/** Exact range of x^2 + y^2 - r^2 over a box; the field is defined everywhere. */
export const circleFieldEnc = (r: number): FieldEnclosure => (x0, x1, y0, y1) => {
  const x2lo = x0 <= 0 && 0 <= x1 ? 0 : Math.min(x0 * x0, x1 * x1);
  const x2hi = Math.max(x0 * x0, x1 * x1);
  const y2lo = y0 <= 0 && 0 <= y1 ? 0 : Math.min(y0 * y0, y1 * y1);
  const y2hi = Math.max(y0 * y0, y1 * y1);
  return box(x2lo + y2lo - r * r, x2hi + y2hi - r * r, 2);
};

/** Exact tri-state of x^2 + y^2 < r^2 (strict) or <= r^2 over a box. */
export const discTri = (r: number, strict: boolean): PredicateEnclosure => (x0, x1, y0, y1) => {
  const f = circleFieldEnc(r)(x0, x1, y0, y1);
  // margin m = r^2 - x^2 - y^2; inside when m > 0 (strict) or m >= 0.
  const mlo = -f.hi;
  const mhi = -f.lo;
  if (strict) {
    if (mlo > 0) return 'true';
    if (mhi <= 0) return 'false';
    return 'maybe';
  }
  if (mlo >= 0) return 'true';
  if (mhi < 0) return 'false';
  return 'maybe';
};

/** Exact tri-state of the half-plane x > 0 (strict) or x >= 0 over a box. */
export const halfTri = (strict: boolean): PredicateEnclosure => (x0, x1, _y0, _y1) => {
  if (strict) {
    if (x0 > 0) return 'true';
    if (x1 <= 0) return 'false';
    return 'maybe';
  }
  if (x0 >= 0) return 'true';
  if (x1 < 0) return 'false';
  return 'maybe';
};

const trigRange = (f: 'cos' | 'sin', s0: number, s1: number): { lo: number; hi: number } => {
  // Critical points of cos are k*pi, of sin pi/2 + k*pi.
  const pts = [s0, s1];
  const phase = f === 'cos' ? 0 : Math.PI / 2;
  const k0 = Math.ceil((s0 - phase) / Math.PI);
  const k1 = Math.floor((s1 - phase) / Math.PI);
  for (let k = k0; k <= k1; k += 1) pts.push(phase + k * Math.PI);
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of pts) {
    const v = f === 'cos' ? Math.cos(s) : Math.sin(s);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return { lo, hi };
};

/** Exact bounding box of (rx*cos(s), ry*sin(s)) over [s0, s1]; defined everywhere. */
export const ellipseParamEnc = (rx: number, ry: number): ParamEnclosure => (s0, s1) => {
  const cx = trigRange('cos', Math.min(s0, s1), Math.max(s0, s1));
  const cy = trigRange('sin', Math.min(s0, s1), Math.max(s0, s1));
  const xs = [cx.lo * rx, cx.hi * rx].sort((a, b) => a - b);
  const ys = [cy.lo * ry, cy.hi * ry].sort((a, b) => a - b);
  return { x0: xs[0] ?? 0, x1: xs[1] ?? 0, y0: ys[0] ?? 0, y1: ys[1] ?? 0, def: 2 };
};

/** Exact tri-state of the 1D predicate x^2 > 4 over [lo, hi]. */
export const outsideTri: ScalarTriState = (lo, hi) => {
  const mlo = Math.min(lo * lo, hi * hi) - 4;
  const mhi = Math.max(lo * lo, hi * hi) - 4;
  // margin m = x^2 - 4 covers [mlo, mhi] except across 0, where the true min is -4.
  const trueLo = lo <= 0 && 0 <= hi ? -4 : mlo;
  if (trueLo > 0) return 'true';
  if (mhi <= 0) return 'false';
  return 'maybe';
};

// --------------------------------------------------------------------------------------------
// Evaluation counting and forged doubles (used only where the kernel cannot go:
// budgets, single-evaluation checks, ±inf samples, throwing callbacks).
// --------------------------------------------------------------------------------------------

export interface EvalCounts {
  call: number;
  call1: number;
  batch: number;
  batchPoints: number;
}

export interface CountedFn {
  readonly wrapped: FunctionValue;
  readonly counts: EvalCounts;
  readonly xs1: number[];
  readonly batchXs: number[];
}

/** Wraps a real compiled function, forwarding every call while recording it. */
export const counted = (fn: FunctionValue): CountedFn => {
  const rec = fn as unknown as Record<string, unknown>;
  const call = rec['call'];
  const call1 = rec['call1'];
  const batch = rec['batch'];
  if (typeof call !== 'function' || typeof call1 !== 'function' || typeof batch !== 'function') {
    throw new Error('counted() needs a scalar one-variable function with call/call1/batch');
  }
  const counts: EvalCounts = { call: 0, call1: 0, batch: 0, batchPoints: 0 };
  const xs1: number[] = [];
  const batchXs: number[] = [];
  const wrapped = {
    ...rec,
    call: (...args: never[]): unknown => {
      counts.call += 1;
      return (call as (...a: never[]) => unknown)(...args);
    },
    call1: (x: number): number => {
      counts.call1 += 1;
      xs1.push(x);
      return (call1 as (x: number) => number)(x);
    },
    batch: (xs: Float64Array, out: Float64Array): void => {
      counts.batch += 1;
      counts.batchPoints += xs.length;
      for (const x of xs) batchXs.push(x);
      (batch as (xs: Float64Array, out: Float64Array) => void)(xs, out);
    },
  } as unknown as FunctionValue;
  return { wrapped, counts, xs1, batchXs };
};

/**
 * A consistent forged scalar function: call, call1 and batch all compute `f`.
 * Used only for behaviours the kernel cannot produce (NaN/+inf/-inf samples,
 * throwing callbacks). Marked as forged in every test that uses it.
 */
export const forgedScalar = (base: FunctionValue, f: (x: number) => number): FunctionValue =>
  ({
    ...(base as unknown as Record<string, unknown>),
    call: (x: number): number => f(x),
    call1: (x: number): number => f(x),
    batch: (xs: Float64Array, out: Float64Array): void => {
      for (let i = 0; i < xs.length; i += 1) out[i] = f(xs[i] ?? 0);
    },
  }) as unknown as FunctionValue;
