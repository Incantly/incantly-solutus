/**
 * Shared geometry value model (docs/features/points-lines/design.md section 3,
 * docs/features/conics/design.md section 3, docs/features/polygons-transforms/design.md
 * sections 3 and 6). Plain data only; no DOM, no clock, no randomness.
 */
import type {} from '../../contracts/values';

/* Area registries: appended entries only (AGENTS.md). These names become part of
 * `TypeName` and `UndefReason` for the whole program once this module compiles. */
declare module '../../contracts/values' {
  interface AreaTypeNames {
    Conic: true;
    Sector: true;
    Polyline: true;
    Transform: true;
  }
  interface AreaUndefReasons {
    outside_path: true;
    too_far: true;
    zero_length: true;
    coincident_points: true;
    collinear: true;
    not_collinear: true;
    vertical: true;
    inside: true;
    on_conic: true;
    no_tangent: true;
    at_infinity: true;
    straight: true;
    singular_point: true;
    negative_radius: true;
    too_short: true;
    too_long: true;
    non_positive: true;
    focus_on_directrix: true;
    degenerate_conic: true;
    degenerate_points: true;
    wrong_kind: true;
    not_circle: true;
    not_hyperbola: true;
    no_center: true;
    no_directrix: true;
    unbounded: true;
    too_few_points: true;
    too_few_sides: true;
    not_whole: true;
    zero_area: true;
    not_simple: true;
    has_hole: true;
    singular_transform: true;
    crosses_horizon: true;
    not_affine: true;
    no_dependency: true;
    not_quadratic: true;
    not_polynomial: true;
    bad_equation: true;
  }
}

/** A finite point or vector in the figure's maths units. */
export interface V2 {
  readonly x: number;
  readonly y: number;
}

/** A point in homogeneous form. w = 0 is a point at infinity. Never stored as an object value. */
export interface HPoint {
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

/**
 * Line a*x + b*y = c with a^2 + b^2 = 1 (the kernel `LineValue` convention;
 * the design's HLine uses a*x + b*y + c = 0, so c here is -c there).
 */
export interface HLine {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  /** First defining point, when the line was built from points or a point and a vector (the origin of `PointOn`). */
  readonly p?: V2;
  /** Length of the defining vector (the unit of the `PointOn` parameter). */
  readonly len?: number;
}

export type PathKind =
  | 'line'
  | 'ray'
  | 'segment'
  | 'circle'
  | 'ellipse'
  | 'parabola'
  | 'hyperbola'
  | 'arc'
  | 'polyline'
  | 'polygon'
  | 'function'
  | 'curve'
  | 'implicit';

/** All curves a point can ride, or an intersection can be filtered by (points-lines 3.2). */
export interface Path {
  readonly kind: PathKind;
  readonly closed: boolean;
  /** Raw parameter domain, possibly infinite. */
  readonly domain: readonly [number, number];
  /** Position at raw parameter s. Defined for every s in domain. */
  at(s: number): V2;
  /** Unit tangent at s, or undefined at corners and cusps. */
  tangent(s: number): V2 | undefined;
  /** Nearest raw parameter to p. `hint` picks among ties and stays continuous. */
  project(p: V2, hint?: number): { s: number; dist: number };
  /** Map raw parameter to the stable 0..1 range shown to users, and back. */
  norm(s: number): number;
  unnorm(u: number): number;
}

/** Relative tolerances (points-lines 3.3). Resolved from the rule context, never invented. */
export interface Tol {
  readonly eq: number;
  readonly on: number;
  readonly parallel: number;
  readonly far: number;
}

export const DEFAULT_TOL: Tol = { eq: 1e-9, on: 1e-9, parallel: 1e-9, far: 1e14 };

/* ------------------------------ conics (conics 3.1) ------------------------------ */

export type ConicKind =
  | 'circle'
  | 'ellipse'
  | 'hyperbola'
  | 'parabola'
  | 'lines'
  | 'parallel'
  | 'double'
  | 'point'
  | 'line'
  | 'empty';

/** Symmetric 3x3 coefficient matrix of A x^2 + B xy + C y^2 + D x + E y + F = 0. */
export interface Quad {
  readonly A: number;
  readonly B: number;
  readonly C: number;
  readonly D: number;
  readonly E: number;
  readonly F: number;
}

/** Where a central conic sits. u points along the major (transverse) axis. */
export interface CentralFrame {
  readonly cx: number;
  readonly cy: number;
  readonly ux: number;
  readonly uy: number;
  readonly a: number;
  readonly b: number;
}

export interface ParabolaFrame {
  readonly vx: number;
  readonly vy: number;
  /** Axis direction, from vertex toward focus. */
  readonly ux: number;
  readonly uy: number;
  /** Focus-to-directrix distance (p > 0). */
  readonly p: number;
}

export interface ConicValue {
  /** Always present; normalised to unit Frobenius norm of the 3x3 matrix. */
  readonly q: Quad;
  readonly kind: ConicKind;
  /** Present for circle, ellipse, hyperbola, parabola. */
  readonly frame?: CentralFrame | ParabolaFrame;
  /** Distance to the nearest other kind (0 = exactly on a boundary). */
  readonly margin: number;
  readonly lines?: readonly [HLine, HLine?];
  readonly point?: V2;
}

/** Arcs and sectors (conics 3.1). Sectors share the shape; the object type differs. */
export interface ArcValue {
  /** Circle or ellipse. */
  readonly conic: ConicValue;
  /** Polar angle about the centre, radians. */
  readonly from: number;
  /** 0 <= sweep <= 2*pi, counter-clockwise from `from`. */
  readonly sweep: number;
  /** True when the stored counter-clockwise arc runs from C to A (ArcThrough clockwise case). */
  readonly reversed?: true;
}

/* ------------------------------ polygons (polygons-transforms 3.1) ------------------------------ */

/** n >= 3, in order; the closing edge is implied. */
export interface PolygonValue {
  readonly pts: readonly V2[];
  /** Shoelace, compensated, in coordinates relative to the first vertex. */
  readonly signedArea: number;
  /** From signedArea and orient, 0 if degenerate. */
  readonly orientation: -1 | 0 | 1;
  /** Bit set: simple, convex, checked (computed on demand, cached). See FLAG_* below. */
  readonly flags: number;
}

export const FLAG_SIMPLE = 1;
export const FLAG_CONVEX = 2;
export const FLAG_CHECKED = 4;

/** n >= 2, open. Distinguished from a polygon by the absence of `signedArea`. */
export interface PolylineValue {
  readonly pts: readonly V2[];
}

/* ------------------------------ transforms (polygons-transforms 6.1) ------------------------------ */

export type TfKind =
  | 'translate'
  | 'rotate'
  | 'reflectLine'
  | 'reflectPoint'
  | 'dilate'
  | 'shear'
  | 'stretch'
  | 'linear'
  | 'projective'
  | 'inversion';

export interface Affine2 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/**
 * Stored transform values are plain data (no closures, so value equality is
 * stable). `materialize` in transforms.ts builds the design's `Tf` from one.
 */
export type StoredTransform =
  | { readonly tag: 'transform'; readonly kind: 'translate'; readonly vx: number; readonly vy: number }
  | { readonly tag: 'transform'; readonly kind: 'rotate'; readonly angle: number; readonly cx: number; readonly cy: number }
  | { readonly tag: 'transform'; readonly kind: 'reflectLine'; readonly nx: number; readonly ny: number; readonly c0: number }
  | { readonly tag: 'transform'; readonly kind: 'reflectPoint'; readonly cx: number; readonly cy: number }
  | { readonly tag: 'transform'; readonly kind: 'dilate'; readonly k: number; readonly cx: number; readonly cy: number }
  | {
      readonly tag: 'transform';
      readonly kind: 'shear';
      readonly dx: number;
      readonly dy: number;
      readonly nx: number;
      readonly ny: number;
      readonly c0: number;
      readonly ratio: number;
    }
  | {
      readonly tag: 'transform';
      readonly kind: 'stretch';
      readonly nx: number;
      readonly ny: number;
      readonly c0: number;
      readonly ratio: number;
    }
  | { readonly tag: 'transform'; readonly kind: 'linear'; readonly m: readonly [number, number, number, number, number, number] }
  | {
      readonly tag: 'transform';
      readonly kind: 'projective';
      readonly h: readonly [number, number, number, number, number, number, number, number, number];
    }
  | { readonly tag: 'transform'; readonly kind: 'inversion'; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly tag: 'transform'; readonly kind: 'then'; readonly steps: readonly StoredTransform[] };

/* ------------------------------ provisional curves ------------------------------ */

/**
 * The curve values this area produces (loci, function images under
 * non-function-preserving maps). Provisional until the curves area defines the
 * shared shape: see "Needs the integrator" in the builder notes.
 */
export interface GeomCurveValue {
  readonly tag: 'geomCurve';
  readonly pieces: readonly (readonly V2[])[];
  readonly closed: boolean;
  readonly exact?: {
    readonly fx: (t: number) => number;
    readonly fy: (t: number) => number;
    readonly from: number;
    readonly to: number;
  };
}

/* ------------------------------ parameter unions ------------------------------ */

/** Line-likes: forms that say `Line` accept Segment and Ray (points-lines 9). */
export const T_LINE_LIKE = 'Line|Segment|Ray';
/** Line-likes and vectors (perpendicular/parallel/normal carriers). */
export const T_LINE_LIKE_VEC = 'Line|Segment|Ray|Vector';
/** Conics and circles (Circle is a subtype of Conic). */
export const T_CONIC_LIKE = 'Conic|Circle';
/** Everything a point can ride (functions of one number only). */
export const T_PATH =
  'Line|Segment|Ray|Circle|Conic|Arc|Polygon|Polyline|Function<Number>(1)|Curve';
/** Everything with an interior a point can be placed in. */
export const T_REGION = 'Polygon|Circle|Conic|Sector';
/**
 * Every shape a transformation maps (polygons-transforms 6.5), except Vector:
 * {x, y} cannot tell a Point from a Vector at run time, so vector forms are
 * declared separately with vector-specific rules.
 */
export const T_SHAPEN =
  'Point|Segment|Ray|Line|Circle|Conic|Arc|Sector|Polygon|Polyline|Function<Number>(1)|Curve|List';
/** Shapes except Vector and Function. */
export const T_SHAPEN_NF =
  'Point|Segment|Ray|Line|Circle|Conic|Arc|Sector|Polygon|Polyline|Curve|List';
/** Shapes except Vector, Circle and Function. */
export const T_SHAPEN_NCF =
  'Point|Segment|Ray|Line|Conic|Arc|Sector|Polygon|Polyline|Curve|List';

/** Type names this area adds. Pass to `registry.problems({ types })` with the full table. */
export const GEOMETRY_TYPES: readonly string[] = ['Conic', 'Sector', 'Polyline', 'Transform'];

/* ------------------------------ runtime shape guards ------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

const isNum = (v: unknown): v is number => typeof v === 'number';

export const isPt = (v: unknown): v is V2 =>
  isObj(v) && isNum(v['x']) && isNum(v['y']);

export const isLineV = (v: unknown): v is HLine =>
  isObj(v) && isNum(v['a']) && isNum(v['b']) && isNum(v['c']);

export const isSegmentV = (v: unknown): v is { a: V2; b: V2 } =>
  isObj(v) && isPt(v['a']) && isPt(v['b']);

export const isRayV = (v: unknown): v is { from: V2; dir: V2 } =>
  isObj(v) && isPt(v['from']) && isPt(v['dir']);

export const isCircleV = (v: unknown): v is { cx: number; cy: number; r: number } =>
  isObj(v) && isNum(v['cx']) && isNum(v['cy']) && isNum(v['r']);

export const isConicV = (v: unknown): v is ConicValue =>
  isObj(v) && isObj(v['q']) && typeof v['kind'] === 'string';

export const isArcV = (v: unknown): v is ArcValue =>
  isObj(v) && isConicV(v['conic']) && isNum(v['from']) && isNum(v['sweep']);

export const isPolygonV = (v: unknown): v is PolygonValue =>
  isObj(v) && Array.isArray(v['pts']) && isNum(v['signedArea']);

export const isPolylineV = (v: unknown): v is PolylineValue =>
  isObj(v) && Array.isArray(v['pts']) && !('signedArea' in v);

export const isTransformV = (v: unknown): v is StoredTransform =>
  isObj(v) && v['tag'] === 'transform' && typeof v['kind'] === 'string';

export const isGeomCurveV = (v: unknown): v is GeomCurveValue =>
  isObj(v) && v['tag'] === 'geomCurve' && Array.isArray(v['pieces']);

export const isRelationV = (v: unknown): v is import('../../language/runtime').RelationValue =>
  isObj(v) && typeof v['residual'] === 'function' && typeof v['test'] === 'function';

export const isFunctionV = (v: unknown): v is import('../../language/runtime').FunctionValue =>
  isObj(v) && typeof v['call'] === 'function' && isNum(v['arity']);
