/**
 * Value shapes and registries of the functions area (docs/features/functions-calculus,
 * docs/features/curves-loci). Function objects themselves are the language's `FunctionValue`
 * closures; this module adds the shapes the plotter reads (`CurveData`, `RegionData`,
 * `FieldData`), the area's undefined reasons, and the `Field` type name.
 *
 * No DOM, no timers, no Date: this runs in Node, a worker and on mobile.
 */
import type { UndefReason } from '../../contracts/values';
import type { FunctionValue, RelationValue } from '../../language/runtime';
import type { Pt } from '../../contracts/values';

/* ------------------------- area registries (append-only) ------------------------- */

declare module '../../contracts/values' {
  interface AreaTypeNames {
    // functions: SlopeField results carry the field and its options; the view samples them.
    Field: true;
  }
  interface AreaUndefReasons {
    // functions-calculus
    empty_interval: true;
    no_extremum: true;
    no_limit: true;
    diverges: true;
    step_limit: true;
    blowup: true;
    stiff: true;
    corner: true;
    identically_zero: true;
    bad_argument: true;
    unbounded_search: true;
    // curves-loci
    curve_undefined_at_param: true;
    out_of_range: true;
    singular_point: true;
    infinite_radius: true;
    not_on_curve: true;
    degenerate_points: true;
    no_algebraic_equation: true;
    no_dependency: true;
    empty_region: true;
    unbounded: true;
    identically_true: true;
    unsupported_family: true;
    not_a_mover: true;
    needs_interval: true;
    not_differentiable: true;
    missing_range: true;
  }
}

/** Type names this area adds. Pass to `registry.problems({ types: FUNCTIONS_TYPES })`. */
export const FUNCTIONS_TYPES: readonly string[] = ['Field'];

/** Every undefined reason this area's rules can report. */
export const FUNCTIONS_REASONS: readonly UndefReason[] = [
  'empty_interval', 'no_extremum', 'no_limit', 'diverges', 'step_limit', 'blowup', 'stiff',
  'corner', 'identically_zero', 'bad_argument', 'unbounded_search', 'curve_undefined_at_param',
  'out_of_range', 'singular_point', 'infinite_radius', 'not_on_curve', 'degenerate_points',
  'no_algebraic_equation', 'no_dependency', 'empty_region', 'unbounded', 'identically_true',
  'unsupported_family', 'not_a_mover', 'needs_interval', 'not_differentiable', 'missing_range',
];

/* ------------------------------ curve values ------------------------------ */

/** Coefficient of x^i y^j in an implicit polynomial (curves design 4). */
export interface Coef2 {
  readonly i: number;
  readonly j: number;
  readonly c: number;
}

/** One polynomial piece of a Bezier or spline curve, power basis in s (curves design 4). */
export interface PolyPiece {
  readonly s0: number;
  readonly s1: number;
  readonly cx: Float64Array;
  readonly cy: Float64Array;
}

/**
 * A parametric curve `c(s) = (fx(s), fy(s))` on `[lo, hi]`. The closures return NaN
 * where the curve is undefined. Pure function of the figure state they close over.
 */
export interface ParamCurveData {
  readonly kind: 'curve';
  readonly curve: 'param';
  readonly fx: (s: number) => number;
  readonly fy: (s: number) => number;
  readonly lo: number;
  readonly hi: number;
  readonly closed: boolean;
}

/** An implicit curve `f(x, y) = level`, with polynomial coefficients when known. */
export interface ImplicitCurveData {
  readonly kind: 'curve';
  readonly curve: 'implicit';
  readonly f: (x: number, y: number) => number;
  readonly level: number;
  readonly poly?: readonly Coef2[];
  /** Printed equation, for example `x^2 - 8 y = 0`. */
  readonly text?: string;
}

/** A Bezier or spline curve: exact polynomial pieces. */
export interface PiecewiseCurveData {
  readonly kind: 'curve';
  readonly curve: 'piecewise';
  readonly pieces: readonly PolyPiece[];
  readonly lo: number;
  readonly hi: number;
  readonly closed: boolean;
}

/**
 * A sampled curve: plain polyline data from `Locus`, `Path`, `Envelope` or parametric
 * `SolveODE` (curves design 4). Each piece is `x0,y0,x1,y1,...`.
 */
export interface SampledCurveData {
  readonly kind: 'curve';
  readonly curve: 'sampled';
  readonly pieces: readonly Float64Array[];
  readonly closed: readonly boolean[];
  readonly origin: 'locus' | 'ode' | 'envelope' | 'path';
}

/** Every curve shape this area's commands return. Implicit curves from `Name = F == G` lines stay `RelationValue`. */
export type CurveData = ParamCurveData | ImplicitCurveData | PiecewiseCurveData | SampledCurveData;

/* ------------------------------ region values ------------------------------ */

/**
 * A shaded region from `AreaUnder` or `Riemann` (functions design 4). `value` is the
 * signed integral (or sum), `area` the unsigned one. The plotter samples `f` (and `g`).
 */
export interface RegionData {
  readonly kind: 'region';
  readonly shape:
    | { readonly t: 'under'; readonly a: number; readonly b: number }
    | { readonly t: 'bars'; readonly a: number; readonly b: number; readonly n: number; readonly rule: string; readonly offset: number };
  readonly value: number;
  readonly area: number;
  readonly f: (x: number) => number;
  readonly g: ((x: number) => number) | null;
}

/* ------------------------------ field values ------------------------------ */

/**
 * A slope field from `SlopeField` (functions design 8.10). The view samples `slope`
 * on its grid; `rect` null means the current view. `slope` returns NaN where undefined.
 */
export interface FieldData {
  readonly kind: 'field';
  readonly slope: (x: number, y: number) => number;
  readonly n: number;
  readonly length: number;
  readonly rect: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number } | null;
}

/* ------------------------------ guards ------------------------------ */

export function isCurveData(v: unknown): v is CurveData {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'curve';
}

export function isRegionData(v: unknown): v is RegionData {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'region';
}

export function isFieldData(v: unknown): v is FieldData {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'field';
}

export function isFunctionValue(v: unknown): v is FunctionValue {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['arity'] === 'number' && typeof o['call'] === 'function' && (o['ret'] === 'Number' || o['ret'] === 'Point');
}

export function isRelationValue(v: unknown): v is RelationValue {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o['ops']) && typeof o['residual'] === 'function' && typeof o['test'] === 'function';
}

export function isPt(v: unknown): v is Pt {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['x'] === 'number' && typeof o['y'] === 'number' && Object.keys(o).length === 2;
}

/** A `Line` value `{a, b, c}` with `ax + by = c` (also the shape of `xaxis`/`yaxis`). */
export interface Line3 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

export function isLine3(v: unknown): v is Line3 {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['a'] === 'number' && typeof o['b'] === 'number' && typeof o['c'] === 'number' && Object.keys(o).length === 3;
}

export interface Circle3 {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export function isCircle3(v: unknown): v is Circle3 {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['cx'] === 'number' && typeof o['cy'] === 'number' && typeof o['r'] === 'number';
}
