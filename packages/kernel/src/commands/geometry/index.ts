/**
 * Plane geometry: points, lines, conics, polygons and transformations
 * (docs/features/points-lines, conics, polygons-transforms). Register with
 * `registerGeometry(registry)`, then build the figure from the registry.
 */
import { CommandRegistry } from '../../graph/registry';
import { registerPropertyTypes, registerTypeStyle } from '../../graph/props';
import { registerReasonPhrase } from '../../errors/phrases';
import { CORE_TYPE_NAMES } from '../../language/types';
import { PROPERTIES } from '../../language/props';
import { GEOMETRY_COMMANDS } from './commands';
import { SHARED_WITH_GEOMETRY } from '../functions/specs-functions';
import { GEOMETRY_TYPES } from './types';

export { GEOMETRY_COMMANDS } from './commands';
export { GEOMETRY_TYPES } from './types';
export type {
  V2,
  HPoint,
  HLine,
  Path,
  PathKind,
  Tol,
  ConicKind,
  Quad,
  CentralFrame,
  ParabolaFrame,
  ConicValue,
  ArcValue,
  PolygonValue,
  PolylineValue,
  TfKind,
  Affine2,
  StoredTransform,
  GeomCurveValue,
} from './types';
export { DEFAULT_TOL, FLAG_SIMPLE, FLAG_CONVEX, FLAG_CHECKED } from './types';
export { T_LINE_LIKE, T_LINE_LIKE_VEC, T_CONIC_LIKE, T_PATH, T_REGION, T_SHAPEN, T_SHAPEN_NF, T_SHAPEN_NCF } from './types';
export type { Slot, LineSlot, LineLike } from './intersect';

const done = new WeakSet<CommandRegistry>();

/**
 * Plug every geometry command into a registry, with the types' styles, `with`
 * keys and undefined-reason phrases. Idempotent per registry.
 */
export function registerGeometry(registry: CommandRegistry): void {
  if (done.has(registry)) return;
  done.add(registry);
  registry.registerAll(GEOMETRY_COMMANDS);
  // the function forms of Asymptote and of curvature at a point come from the functions area (merged by the registry)
  registry.registerAll(SHARED_WITH_GEOMETRY);

  registerTypeStyle('Conic', { defaults: { color: '#111827', width: 2, opacity: 0, label: 'none' } });
  registerTypeStyle('Sector', { defaults: { color: '#111827', width: 2, opacity: 0.16, label: 'none', fill: 'solid' } });
  registerTypeStyle('Polyline', { defaults: { color: '#111827', width: 2, label: 'none' } });
  registerTypeStyle('Transform', { drawable: false });

  PROPERTIES['vertexlabels'] = { kind: 'enum', values: ['none', 'names', 'prime'], allowed: 'none, names or prime' };
  PROPERTIES['fillRule'] = { kind: 'enum', values: ['evenodd', 'nonzero'], allowed: 'evenodd or nonzero' };
  registerPropertyTypes('vertexlabels', ['Polygon', 'Polyline']);
  registerPropertyTypes('fillRule', ['Polygon']);

  for (const [reason, phrase] of REASON_PHRASES) registerReasonPhrase(reason, phrase);

  // The table check learns the new type names (Matrix is borrowed until the
  // numbers area owns it; ApplyMatrix and Linear already take it).
  const names = CORE_TYPE_NAMES as unknown as string[];
  for (const t of [...GEOMETRY_TYPES, 'Matrix']) {
    if (!names.includes(t)) names.push(t);
  }
}

const REASON_PHRASES: ReadonlyArray<readonly [string, { noun: string; sentence: string }]> = [
  ['outside_path', { noun: 'outside the object', sentence: 'The carriers meet, but not within the segment, ray or arc.' }],
  ['too_far', { noun: 'off the page', sentence: 'The meeting point is too far away to show.' }],
  ['zero_length', { noun: 'zero length', sentence: 'That segment, vector or arm has zero length.' }],
  ['coincident_points', { noun: 'the same point twice', sentence: 'The two defining points are the same.' }],
  ['collinear', { noun: 'points on one line', sentence: 'Those points are on a line, where a triangle is needed.' }],
  ['not_collinear', { noun: 'points off one line', sentence: 'Those points are not on one line.' }],
  ['vertical', { noun: 'a vertical line', sentence: 'A vertical line has no slope.' }],
  ['inside', { noun: 'inside the conic', sentence: 'The point is inside the conic, so there is no tangent.' }],
  ['on_conic', { noun: 'one tangent', sentence: 'The point is on the conic, so there is only one tangent.' }],
  ['no_tangent', { noun: 'no tangent', sentence: 'There is no tangent line of that direction.' }],
  ['at_infinity', { noun: 'at infinity', sentence: 'The answer is a point or line at infinity.' }],
  ['straight', { noun: 'zero curvature', sentence: 'The curve is straight there, so there is no kissing circle.' }],
  ['singular_point', { noun: 'a singular point', sentence: "The curve's gradient vanishes there." }],
  ['negative_radius', { noun: 'a negative radius', sentence: 'A radius cannot be negative.' }],
  ['too_short', { noun: 'too short a major axis', sentence: 'The major axis must be longer than the distance between the foci.' }],
  ['too_long', { noun: 'too long a transverse axis', sentence: 'The transverse axis must be shorter than the distance between the foci.' }],
  ['non_positive', { noun: 'not a positive length', sentence: 'That length must be positive.' }],
  ['focus_on_directrix', { noun: 'focus on directrix', sentence: 'The focus lies on the directrix.' }],
  ['degenerate_conic', { noun: 'a degenerate conic', sentence: 'The conic has no regular shape (0 = 0, or a singular matrix).' }],
  ['degenerate_points', { noun: 'points fixing no conic', sentence: 'Those five points do not fix one conic.' }],
  ['wrong_kind', { noun: 'the wrong kind of conic', sentence: 'That property needs another kind of conic.' }],
  ['not_circle', { noun: 'not a circle', sentence: 'That needs a circle.' }],
  ['not_hyperbola', { noun: 'not a hyperbola', sentence: 'That needs a hyperbola.' }],
  ['no_center', { noun: 'no centre', sentence: 'A parabola has no centre.' }],
  ['no_directrix', { noun: 'no directrix', sentence: 'A circle has no directrix.' }],
  ['unbounded', { noun: 'unbounded', sentence: 'That has no finite area or length.' }],
  ['too_few_points', { noun: 'too few points', sentence: 'That needs at least 3 points.' }],
  ['too_few_sides', { noun: 'too few sides', sentence: 'A regular polygon needs at least 3 sides.' }],
  ['not_whole', { noun: 'not a whole number', sentence: 'That count needs a whole number.' }],
  ['zero_area', { noun: 'zero area', sentence: 'The polygon has zero area.' }],
  ['not_simple', { noun: 'a self-crossing polygon', sentence: 'That needs a polygon that does not cross itself.' }],
  ['has_hole', { noun: 'a hole', sentence: 'The result would have a hole, which polygons cannot hold yet.' }],
  ['singular_transform', { noun: 'a squashed figure', sentence: 'The transformation squashes the figure flat.' }],
  ['crosses_horizon', { noun: 'across the horizon', sentence: 'Part of the figure maps to infinity.' }],
  ['not_affine', { noun: 'needs an affine map', sentence: 'That needs the linear part of an affine map.' }],
  ['no_dependency', { noun: 'no dependency', sentence: 'The tracer does not depend on the mover.' }],
  ['not_quadratic', { noun: 'not quadratic', sentence: 'That equation has degree above 2, so it is not a conic.' }],
  ['not_polynomial', { noun: 'not polynomial', sentence: 'Conic needs x and y only in sums, products and powers.' }],
  ['bad_equation', { noun: 'not an equation', sentence: 'That is not a single == equation.' }],
];
