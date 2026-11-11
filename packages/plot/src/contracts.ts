/**
 * @incantly/plot contracts: the plain-data shapes the plotter consumes and emits.
 *
 * Functions arrive as the language's compiled values (`FunctionValue`, `RelationValue`
 * from `@incantly/kernel`); everything the kernel's calculus layer will hand us later
 * (domains, break points, interval enclosures) is declared here as small plain callbacks
 * and listed in `handoff/plot/builder-notes.md` under "Kernel handoff". All output is
 * plain data (Float64Array paths, marker records) that the renderer draws and that
 * survives structured cloning into a worker.
 *
 * Follows `docs/features/functions-calculus/design.md` section 9 (the hybrid function
 * plotter), `docs/features/curves-loci/design.md` sections 5 to 7 (parametric tracer,
 * implicit tracer, inequality filler) and `docs/design/performance.md` section 5
 * (budgets). No DOM, no timers, no randomness: every tracer is a pure function of its
 * inputs, so the same inputs give the same paths on every machine.
 */
import type { FunctionValue } from '@incantly/kernel';

/* ---------------------------------- view ---------------------------------- */

/**
 * The visible region in maths units plus the pixel size it is drawn at.
 * `widthPx`/`heightPx` are CSS pixels; `devicePixelRatio` raises the sampling
 * density (paths are still emitted in CSS pixels).
 */
export interface ViewBox {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly devicePixelRatio?: number;
}

/** Draft or final quality for the grid tracers (curves-loci 6 and 7). Never derived from a clock. */
export type TraceQuality = 'draft' | 'final';

/* --------------------------------- budgets --------------------------------- */

/** Curve samples per curve on screen (`docs/design/performance.md` section 5). */
export const MAX_SAMPLES_PER_CURVE = 4000;
/** Default evaluation budgets (functions-calculus 9, curves-loci 5 to 7). */
export const DEFAULT_MAX_EVALS_FUNCTION = 20000;
export const DEFAULT_MAX_EVALS_PARAM = 20000;
export const DEFAULT_MAX_EVALS_IMPLICIT = 200000;
export const DEFAULT_MAX_EVALS_REGION = 200000;
/** Hard caps: larger requests are refused with `limit`. */
export const HARD_MAX_SAMPLES = 65536;
export const HARD_MAX_EVALS = 10000000;
/** Largest view side in pixels and largest view area; larger views are refused with `limit`. */
export const MAX_VIEW_SIDE_PX = 16384;
export const MAX_VIEW_AREA_PX = 16777216;

/** Screen-space refinement thresholds (functions-calculus 9, curves-loci 5). */
export const REFINE_BEND_PX = 0.25;
export const REFINE_CHORD_PX = 8;
export const REFINE_TURN_DEGREES = 12;
export const REFINE_MAX_DEPTH = 14;

/* ------------------------- kernel-handoff enclosures ------------------------ */

/**
 * Definedness of a function over a box (functions-calculus 5): 0 means undefined
 * everywhere on the box, 1 means maybe undefined somewhere, 2 means defined
 * everywhere. The kernel's Interval algebra reports this; the tracers use it to
 * tell poles from gaps from steep rises.
 */
export type Definedness = 0 | 1 | 2;

/** Guaranteed enclosure of every value a function takes over a box. `lo`/`hi` may be infinite. */
export interface ScalarBox {
  readonly lo: number;
  readonly hi: number;
  readonly def: Definedness;
}

/** Interval enclosure of a one-variable function over `[lo, hi]`. Kernel handoff. */
export type ScalarEnclosure = (lo: number, hi: number) => ScalarBox;

/** Interval enclosure of a two-variable field over a box. Kernel handoff. */
export type FieldEnclosure = (x0: number, x1: number, y0: number, y1: number) => ScalarBox;

/** Interval bounding box of a parametric curve over `[s0, s1]`. Kernel handoff. */
export interface ParamBox {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly def: Definedness;
}

/** Interval enclosure of a parametric curve over a parameter box. Kernel handoff. */
export type ParamEnclosure = (s0: number, s1: number) => ParamBox;

/** Three-valued truth of a predicate body over a box (functions-calculus 5). Kernel handoff. */
export type TriState = 'true' | 'false' | 'maybe';

/** Three-valued evaluation of a predicate body over a box. Kernel handoff. */
export type PredicateEnclosure = (x0: number, x1: number, y0: number, y1: number) => TriState;

/* ------------------------------ functions (1D) ------------------------------ */

/** One span of x values (functions-calculus 4). Whole line is `[{lo:-inf, hi:inf, ...}]`. */
export interface DomainSpan {
  readonly lo: number;
  readonly hi: number;
  readonly loOpen: boolean;
  readonly hiOpen: boolean;
}

/** Cached samples a caller reuses across a pan (functions-calculus 9, cache). */
export interface SampleSeed {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
}

export interface FunctionPlotOptions {
  /** Restriction of the domain; default is the whole line. Kernel handoff. */
  readonly domain?: readonly DomainSpan[];
  /** x values where the formula may change form, sorted; the plotter samples both sides. Kernel handoff. */
  readonly breaks?: readonly number[];
  /** Interval enclosure for classifying poles, holes and jumps. Kernel handoff. */
  readonly enclosure?: ScalarEnclosure;
  /** Samples kept from an earlier view (a pan); reused without re-evaluation. */
  readonly seed?: SampleSeed;
  /** Output sample cap, default 4000 (`docs/design/performance.md` 5). */
  readonly maxSamples?: number;
  /** Evaluation budget for this call, default 20000 (functions-calculus 9). */
  readonly maxEvals?: number;
  /** Coarse samples; default `max(64, widthPx / 4)` (functions-calculus 9). */
  readonly coarse?: number;
  /** Refinement depth limit, default 14 (functions-calculus 9). */
  readonly depth?: number;
  /** Midpoint-to-chord split threshold in pixels, default 0.25. */
  readonly bendPx?: number;
  /** Chord-length split threshold in pixels, default 8. */
  readonly chordPx?: number;
  /**
   * `with exact = true` (functions-calculus 9): draw the enclosure band instead
   * of the curve. Needs `enclosure`; without it the plot falls back to the normal
   * curve and reports `rigorous: false`.
   */
  readonly exact?: boolean;
}

/** Opaque suspended state of `plotFunction`; plain data, safe to clone into a worker. */
export interface FunctionResume {
  readonly kind: 'function-plot';
  readonly pending: readonly FunctionResumeSpan[];
  readonly accepted: readonly FunctionResumeSpan[];
  readonly suspicious: readonly FunctionResumeSpan[];
  readonly samples: SampleSeed;
  readonly defined: readonly number[];
  readonly markers: readonly PlotMarker[];
  readonly inkColumns: readonly InkColumn[];
  readonly evals: number;
  readonly intervalEvals: number;
  readonly maxDepthSeen: number;
  readonly rigorous: boolean;
  readonly capped: boolean;
  readonly phase: 'setup' | 'refine' | 'classify' | 'band';
  readonly pieces: readonly ResumePiece[];
  readonly breaks: readonly number[];
  readonly coarseXs: readonly number[];
  readonly coarseDone: number;
  readonly view: ViewBox;
  readonly depth: number;
  readonly bendPx: number;
  readonly chordPx: number;
  readonly maxSamples: number;
  readonly exact: boolean;
}

/** One plotted piece: a domain span clipped to the view and split at breaks. */
export interface ResumePiece {
  readonly lo: number;
  readonly hi: number;
  readonly loKind: PieceEndKind;
  readonly hiKind: PieceEndKind;
}

/** How a piece ends: clipped by the view, a closed/open domain bound, or a break. */
export type PieceEndKind = 'view' | 'closed' | 'open' | 'break';

/** One pending, accepted or suspicious x-span of the function refiner. */
export interface FunctionResumeSpan {
  readonly xl: number;
  readonly xr: number;
  readonly depth: number;
}

/* ------------------------------ output shapes ------------------------------- */

export type MarkerKind =
  | 'hole'
  | 'openEnd'
  | 'closedEnd'
  | 'pole'
  | 'jump'
  | 'cusp'
  | 'singular'
  | 'isolated'
  | 'end';

/**
 * A point of interest on a plot. `x`/`y` are maths units, `px`/`py` pixels.
 * A `pole` marker sits at the pole's x with y at the view's vertical centre;
 * the renderer draws the dashed vertical from it.
 */
export interface PlotMarker {
  readonly kind: MarkerKind;
  readonly x: number;
  readonly y: number;
  readonly px: number;
  readonly py: number;
}

/** Sub-pixel oscillation (functions-calculus 9): a vertical hairline in pixels. */
export interface InkColumn {
  readonly x: number;
  readonly y0: number;
  readonly y1: number;
}

export interface PlotStats {
  /** Real-function evaluations spent. */
  readonly evals: number;
  /** Interval-enclosure evaluations spent. */
  readonly intervalEvals: number;
  /** Deepest refinement depth reached. */
  readonly maxDepth: number;
  /** False when the evaluation budget ran out before the plot finished. */
  readonly complete: boolean;
  /** True when the sample cap stopped refinement (functions-calculus 9) or the performance budget did. */
  readonly capped: boolean;
  /**
   * False when a classification needed an interval enclosure that was not
   * supplied, so sampling heuristics were used instead. The kernel reports this
   * as `rigorous: false`.
   */
  readonly rigorous: boolean;
  /** Output points across all paths. */
  readonly samples: number;
}

export interface FunctionPlot {
  /** Polylines in pixel coordinates, one array per connected piece: x0,y0,x1,y1,... */
  readonly paths: readonly Float64Array[];
  readonly markers: readonly PlotMarker[];
  readonly inkColumns: readonly InkColumn[];
  readonly stats: PlotStats;
  /** Present exactly when `stats.complete` is false; continue with `resumeFunctionPlot`. */
  readonly resume?: FunctionResume;
}

/* ---------------------------- parametric curves ----------------------------- */

export interface ParamCurveInput {
  /** One-parameter point-valued function (`Function<Point>(1)`). */
  readonly fn: FunctionValue;
  /** Finite parameter range, `lo < hi`. */
  readonly lo: number;
  readonly hi: number;
  /** Interval enclosure for culling off-screen boxes. Kernel handoff. */
  readonly enclosure?: ParamEnclosure;
  /** Samples kept from an earlier view, as s values with x/y pairs. */
  readonly seed?: ParamSeed;
}

/** Cached parametric samples: `ss[i]` evaluated to (`xys[2i]`, `xys[2i+1]`). */
export interface ParamSeed {
  readonly ss: Float64Array;
  readonly xys: Float64Array;
}

export interface ParamPlotOptions {
  readonly maxSamples?: number;
  readonly maxEvals?: number;
  readonly coarse?: number;
  readonly depth?: number;
  readonly bendPx?: number;
  readonly chordPx?: number;
  /** Turning-angle split threshold in degrees, default 12 (curves-loci 5). */
  readonly turnDegrees?: number;
}

export interface ParamPlot {
  readonly paths: readonly Float64Array[];
  /** Parallel to `paths`: true when the piece is closed. */
  readonly closed: readonly boolean[];
  readonly markers: readonly PlotMarker[];
  readonly stats: PlotStats;
}

/* ----------------------------- implicit curves ------------------------------ */

export interface ImplicitFieldInput {
  /** `F(x, y)` whose level set is traced; NaN where undefined. */
  readonly residual: (x: number, y: number) => number;
  /** Level traced, default 0. */
  readonly level?: number;
  /** Interval enclosure of the field. Kernel handoff. */
  readonly enclosure?: FieldEnclosure;
}

export interface ImplicitPlotOptions {
  /** Draft (6 px leaves) or final (2 px leaves), default final (curves-loci 6). */
  readonly quality?: TraceQuality;
  readonly maxSamples?: number;
  readonly maxEvals?: number;
}

export interface ImplicitPlot {
  readonly paths: readonly Float64Array[];
  /** Parallel to `paths`: true when the chain is closed. */
  readonly closed: readonly boolean[];
  readonly markers: readonly PlotMarker[];
  readonly stats: PlotStats;
}

/* ------------------------------- inequalities ------------------------------- */

export interface BoundaryInput {
  /**
   * Margin whose zero set bounds the region (`margin > 0`, or `>= 0` when not
   * strict, is inside). For `==` boundaries the zero set itself is the border.
   */
  readonly residual: (x: number, y: number) => number;
  /** Strict inequalities draw dashed borders. */
  readonly strict: boolean;
  /** True for an `==` boundary (kept where the body holds on it). */
  readonly equality?: boolean;
  /** Interval enclosure of this margin. Kernel handoff. */
  readonly enclosure?: FieldEnclosure;
}

export interface PredicateInput {
  /** Full body: true inside, false outside, undefined where undecided. */
  readonly test: (x: number, y: number) => boolean | undefined;
  /** Comparison primitives that may bound the region. Kernel handoff. */
  readonly boundaries?: readonly BoundaryInput[];
  /** Three-valued evaluation of the body over a box. Kernel handoff. */
  readonly enclosure?: PredicateEnclosure;
}

export interface RegionPlotOptions {
  /** Draft (6 px leaves) or final (2 px leaves), default final (curves-loci 7). */
  readonly quality?: TraceQuality;
  readonly maxSamples?: number;
  readonly maxEvals?: number;
}

export interface RegionBorder {
  readonly path: Float64Array;
  readonly strict: boolean;
}

export interface RegionPlot {
  /** Filled rectangles in pixels: x0,y0,x1,y1 per entry, merged by rows. */
  readonly rects: Float64Array;
  /** Filled boundary polygons in pixels: x0,y0,... per entry (implicitly closed). */
  readonly polygons: readonly Float64Array[];
  readonly borders: readonly RegionBorder[];
  readonly markers: readonly PlotMarker[];
  readonly stats: PlotStats;
}

export interface Predicate1DPlot {
  /** Vertical bands in pixels spanning the view height: x0,y0,x1,y1 per entry. */
  readonly bands: Float64Array;
  /** True intervals on the axis in maths units: lo,hi per entry. */
  readonly intervals: Float64Array;
  readonly stats: PlotStats;
}

/** Three-valued evaluation of a one-variable predicate over `[lo, hi]`. Kernel handoff. */
export type ScalarTriState = (lo: number, hi: number) => TriState;

export interface Predicate1DInput {
  /** Body: true inside, false outside, undefined where undecided. */
  readonly test: (x: number) => boolean | undefined;
  /** Three-valued evaluation of the body over an interval. Kernel handoff. */
  readonly enclosure?: ScalarTriState;
}

export interface Predicate1DOptions {
  readonly maxEvals?: number;
  readonly coarse?: number;
}
