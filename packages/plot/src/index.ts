/**
 * @incantly/plot: browser-free curve and function sampling. Adaptive tracing
 * of `y = f(x)`, parametric curves, implicit curves and inequality regions,
 * with breaks at discontinuities, level of detail by zoom, sample budgets,
 * and plain polyline/region output the renderer draws. No DOM, no timers, no
 * randomness: every tracer is a pure function of its inputs and runs in Node,
 * a worker and on mobile.
 *
 * Functions arrive as the language's compiled values (`FunctionValue` with
 * `call1`/`batch`, `RelationValue` with `residual`/`test`); the shapes the
 * kernel's calculus layer will add later (domains, breaks, interval
 * enclosures) are declared in `contracts.ts` and listed in the builder notes
 * under "Kernel handoff".
 */
export {
  DEFAULT_MAX_EVALS_FUNCTION,
  DEFAULT_MAX_EVALS_IMPLICIT,
  DEFAULT_MAX_EVALS_PARAM,
  DEFAULT_MAX_EVALS_REGION,
  HARD_MAX_EVALS,
  HARD_MAX_SAMPLES,
  MAX_SAMPLES_PER_CURVE,
  MAX_VIEW_AREA_PX,
  MAX_VIEW_SIDE_PX,
  REFINE_BEND_PX,
  REFINE_CHORD_PX,
  REFINE_MAX_DEPTH,
  REFINE_TURN_DEGREES,
} from './contracts';
export type {
  BoundaryInput,
  Definedness,
  DomainSpan,
  FieldEnclosure,
  FunctionPlot,
  FunctionPlotOptions,
  FunctionResume,
  FunctionResumeSpan,
  ImplicitFieldInput,
  ImplicitPlot,
  ImplicitPlotOptions,
  InkColumn,
  MarkerKind,
  ParamBox,
  ParamCurveInput,
  ParamEnclosure,
  ParamPlot,
  ParamPlotOptions,
  ParamSeed,
  PieceEndKind,
  PlotMarker,
  PlotStats,
  Predicate1DInput,
  Predicate1DOptions,
  Predicate1DPlot,
  PredicateEnclosure,
  PredicateInput,
  RegionBorder,
  RegionPlot,
  RegionPlotOptions,
  ReplayBox,
  ResumePiece,
  SampleSeed,
  ScalarBox,
  ScalarEnclosure,
  ScalarTriState,
  TraceQuality,
  TriState,
  ViewBox,
} from './contracts';

export { plotFunction, resumeFunctionPlot } from './function';
export type { ResumeFunctionOptions } from './function';

export { traceParamCurve } from './param';

export { fieldFromRelation, traceImplicit } from './implicit';

export { fillPredicate1D, fillRegion, predicateFromRelation } from './region';

export { cacheKey, createSampleCache } from './cache';
export type { CachedParamSamples, CachedSamples, SampleCache } from './cache';

export { createView, pointToChordPx, turnDegrees } from './view';
export type { PlotView } from './view';
