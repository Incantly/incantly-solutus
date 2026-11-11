/**
 * The functions area: function and curve commands on the kernel
 * (docs/features/functions-calculus, docs/features/curves-loci).
 *
 * Areas plug in through `registerFunctions`, which registers every command spec,
 * the area's undefined-reason phrases and the `Field` type style. The plotter
 * reads `CurveData`, `RegionData` and `FieldData`; the points area drives `PointOn`
 * through `curveAt01` and `closestOnCurve`.
 */
import type { CommandRegistry } from '../../graph/registry';
import { registerReasonPhrase } from '../../errors/phrases';
import type { ReasonPhrase } from '../../errors/phrases';
import { registerTypeStyle } from '../../graph/props';
import { FUNCTIONS_SPECS } from './specs-functions';
import { CURVE_COMMANDS, LOCUS_COMMANDS } from './specs-curves';

export { FUNCTIONS_SPECS } from './specs-functions';
export { CURVE_COMMANDS, LOCUS_COMMANDS } from './specs-curves';
export { FUNCTIONS_TYPES, FUNCTIONS_REASONS } from './types';
export type {
  CurveData, ParamCurveData, ImplicitCurveData, PiecewiseCurveData, SampledCurveData,
  RegionData, FieldData, Coef2, PolyPiece, Line3, Circle3,
} from './types';
export { isCurveData, isRegionData, isFieldData, isFunctionValue, isRelationValue, isPt, isLine3, isCircle3 } from './types';
export type { Fn1, Fn2, Sampled1 } from './sample';
export type { AnyCurve, ClosestOut } from './curves';
export {
  asCurve, relationCurve, isEquation, curvePoint, curveVel, curveAcc, curveRange, curveAt01,
  curveBbox, projectImplicit, closestOnCurve,
} from './curves';

const PHRASES: Readonly<Record<string, ReasonPhrase>> = {
  empty_interval: { noun: 'empty interval', sentence: 'The interval is empty: both ends are the same.' },
  no_extremum: { noun: 'no extremum', sentence: 'The function has no highest or lowest point on this interval.' },
  no_limit: { noun: 'no limit', sentence: 'The two sides head to different values, so the limit does not exist.' },
  diverges: { noun: 'divergent integral', sentence: 'The integral is infinite or does not settle.' },
  step_limit: { noun: 'step limit', sentence: 'The work budget ran out; this is the best estimate so far.' },
  blowup: { noun: 'blow-up', sentence: 'The solution reaches infinity here.' },
  stiff: { noun: 'stiff equation', sentence: 'The steps are forced extremely small; shorten the interval.' },
  corner: { noun: 'corner', sentence: 'The graph has a corner here, so the slope is undefined.' },
  identically_zero: { noun: 'identically zero', sentence: 'Every input is a root.' },
  bad_argument: { noun: 'bad argument', sentence: 'An argument is out of range.' },
  unbounded_search: { noun: 'unbounded search', sentence: 'The search interval is too large to decide.' },
  curve_undefined_at_param: { noun: 'curve gap', sentence: 'The curve is not defined at that parameter.' },
  out_of_range: { noun: 'out of range', sentence: "The parameter is outside the curve's range." },
  singular_point: { noun: 'singular point', sentence: 'The curve stops or pinches here, so the direction is undefined.' },
  infinite_radius: { noun: 'straight curve', sentence: 'The curve is straight here, so the osculating circle is infinite.' },
  not_on_curve: { noun: 'off the curve', sentence: 'The point is not on the curve.' },
  degenerate_points: { noun: 'degenerate points', sentence: 'The points do not determine one curve.' },
  no_algebraic_equation: { noun: 'no algebraic equation', sentence: 'The locus has no polynomial equation of degree 8 or less.' },
  no_dependency: { noun: 'no dependency', sentence: 'The point does not depend on the mover.' },
  empty_region: { noun: 'empty region', sentence: 'Nothing satisfies the inequality here.' },
  unbounded: { noun: 'unbounded', sentence: 'The range or length is infinite.' },
  identically_true: { noun: 'identically true', sentence: 'The whole plane satisfies it.' },
  unsupported_family: { noun: 'unsupported family', sentence: 'Only lines, segments, rays and circles are supported here.' },
  not_a_mover: { noun: 'not a mover', sentence: 'The point is not on a path, so it cannot move along one.' },
  needs_interval: { noun: 'needs an interval', sentence: 'This needs an interval unless the function is a polynomial.' },
  not_differentiable: { noun: 'not differentiable', sentence: 'The function has no derivative rule here.' },
  sample_cap: { noun: 'sample cap', sentence: 'The path needed more samples than the cap allows, so it stops where the cap was reached.' },
  missing_range: { noun: 'missing range', sentence: 'A parametric curve needs a finite range.' },
};

/** Registers every command, reason phrase and type style of the functions area. */
export function registerFunctions(registry: CommandRegistry): void {
  registry.registerAll(FUNCTIONS_SPECS);
  registry.registerAll(CURVE_COMMANDS);
  registry.registerAll(LOCUS_COMMANDS);
  for (const [reason, phrase] of Object.entries(PHRASES)) registerReasonPhrase(reason, phrase);
  registerTypeStyle('Field', { defaults: { color: '#64748b', width: 1.2, label: 'none' } });
}
