/**
 * The geometry command table: every form of points-lines, conics and
 * polygons-transforms (docs/features/points-lines, conics, polygons-transforms
 * design.md section 1). All parameters are required (variants differ by arity,
 * never by optionals), so no two forms of a command are ambiguous.
 */
import type { CommandForm, CommandSpec, ParamSpec } from '../../language/table';
import type { CommandRule } from '../../graph/registry';
import { formCheckFor, refuseFor } from './checks';
import { T_CONIC_LIKE, T_LINE_LIKE, T_LINE_LIKE_VEC, T_PATH, T_REGION, T_SHAPEN, T_SHAPEN_NCF, T_SHAPEN_NF } from './types';

const T_LL = T_LINE_LIKE;
const T_LLV = T_LINE_LIKE_VEC;
const T_CONIC = T_CONIC_LIKE;
const T_FN1 = 'Function<Number>(1)';

const p = (name: string, type: string): ParamSpec => ({ name, type });

interface FormDef {
  readonly params: readonly ParamSpec[];
  readonly rest?: ParamSpec;
  readonly returns: string;
  readonly summary: string;
  readonly rule: CommandRule;
  readonly unit?: 'angle';
  readonly explain?: string;
}

const cmd = (name: string, group: string, forms: readonly FormDef[]): CommandSpec => {
  const refuse = refuseFor(name);
  return {
    name,
    kind: 'object',
    group,
    forms: forms.map((f): CommandForm => {
      const check = formCheckFor(name, f.params);
      return {
        params: f.params,
        ...(f.rest ? { rest: f.rest } : {}),
        returns: f.returns,
        rule: () => f.rule,
        summary: f.summary,
        ...(f.unit ? { unit: f.unit } : {}),
        ...(f.explain ? { explain: f.explain } : {}),
        ...(check ? { check } : {}),
      };
    }),
    ...(refuse ? { refuse } : {}),
  };
};

import * as P from './points';
import * as C from './conicrules';
import * as G from './polygons';
import * as T from './transforms';
import * as L from './locus';

/* ------------------------------ points and lines ------------------------------ */

const pointCommands: readonly CommandSpec[] = [
  cmd('Point', 'geometry', [
    { params: [p('coords', 'List<Number>')], returns: 'Point', summary: 'point from a list of two numbers', rule: P.pointListRule },
    { params: [p('a', 'Point'), p('v', 'Vector')], returns: 'Point', summary: 'point moved by a vector', rule: P.pointPlusVectorRule },
  ]),
  cmd('PointOn', 'geometry', [
    { params: [p('path', T_PATH)], returns: 'Point', summary: 'draggable point at the middle of a path', rule: P.pointOnDefaultRule },
    { params: [p('path', T_PATH), p('param', 'Number')], returns: 'Point', summary: 'draggable point at parameter 0..1 of a path', rule: P.pointOnRule },
  ]),
  cmd('PointIn', 'geometry', [
    { params: [p('region', T_REGION)], returns: 'Point', summary: 'draggable point at the centre of a region', rule: P.pointInDefaultRule },
    { params: [p('region', T_REGION), p('u', 'Number'), p('v', 'Number')], returns: 'Point', summary: 'draggable point at (u, v) in a region', rule: P.pointInRule },
  ]),
  cmd('Midpoint', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Point', summary: 'midpoint of two points', rule: P.midpointPPRule, explain: '{name} is the midpoint of {0} and {1}' },
    { params: [p('s', 'Segment')], returns: 'Point', summary: 'midpoint of a segment', rule: P.midpointSegRule },
    { params: [p('a', 'Arc')], returns: 'Point', summary: 'middle of an arc, on the arc', rule: P.midpointArcRule },
  ]),
  cmd('Vertex', 'geometry', [
    { params: [p('s', 'Segment'), p('index', 'Number')], returns: 'Point', summary: 'end point 1 or 2 of a segment', rule: P.vertexSegRule },
    { params: [p('r', 'Ray')], returns: 'Point', summary: 'start of a ray', rule: P.vertexRayRule },
    { params: [p('poly', 'Polygon'), p('index', 'Number')], returns: 'Point', summary: 'corner k of a polygon', rule: G.vertexPolyRule },
    { params: [p('line', 'Polyline'), p('index', 'Number')], returns: 'Point', summary: 'joint k of a polyline', rule: G.vertexPolyRule },
    { params: [p('c', T_CONIC)], returns: 'List<Point>', summary: 'vertices of a conic', rule: C.vertexConicRule },
  ]),
  cmd('Closest', 'geometry', [
    { params: [p('path', T_PATH), p('p', 'Point')], returns: 'Point', summary: 'nearest point of a path', rule: P.closestPathRule },
    { params: [p('l', T_LL), p('m', T_LL)], returns: 'Point', summary: 'point of the first line nearest the second', rule: P.closestLLRule },
    { params: [p('region', 'Sector'), p('p', 'Point')], returns: 'Point', summary: 'nearest point of a closed sector', rule: P.closestRegionRule },
  ]),
  cmd('Along', 'geometry', [
    { params: [p('path', T_PATH), p('param', 'Number')], returns: 'Point', summary: 'point on a path, not draggable', rule: P.alongRule },
  ]),
  cmd('ParamOf', 'geometry', [
    { params: [p('p', 'Point')], returns: 'Number', summary: "a point's path parameter (needs the path)", rule: P.paramOfRule },
    { params: [p('p', 'Point'), p('path', T_PATH)], returns: 'Number', summary: 'normalised path parameter 0..1', rule: P.paramOfPathRule },
  ]),
  cmd('RandomIn', 'geometry', [
    { params: [p('region', T_REGION), p('seed', 'Number')], returns: 'Point', summary: 'pure seeded point in a region', rule: P.randomInRegionRule },
    {
      params: [p('x0', 'Number'), p('x1', 'Number'), p('y0', 'Number'), p('y1', 'Number'), p('seed', 'Number')],
      returns: 'Point',
      summary: 'pure seeded point in a rectangle',
      rule: P.randomInRectRule,
    },
  ]),
  cmd('Barycenter', 'geometry', [
    { params: [p('points', 'List<Point>'), p('weights', 'List<Number>')], returns: 'Point', summary: 'weighted mean of points', rule: P.barycenterRule },
  ]),
  cmd('Centroid', 'geometry', [
    { params: [p('points', 'List<Point>')], returns: 'Point', summary: 'mean of points', rule: P.centroidListRule },
    { params: [p('poly', 'Polygon')], returns: 'Point', summary: 'area centroid of a polygon', rule: G.centroidPolyRule },
  ]),
  cmd('TriangleCenter', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point'), p('n', 'Number')], returns: 'Point', summary: 'triangle centre n (1..13)', rule: P.triangleCenterRule },
  ]),
  cmd('Trilinear', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point'), p('x', 'Number'), p('y', 'Number'), p('z', 'Number')], returns: 'Point', summary: 'point from trilinear coordinates', rule: P.trilinearRule },
  ]),
  cmd('Intersect', 'geometry', [
    { params: [p('a', T_LL), p('b', T_LL)], returns: 'Point', summary: 'crossing of two line-likes', rule: P.intersectLLRule, explain: '{name} is where {0} meets {1}' },
    { params: [p('a', T_LL), p('b', T_LL), p('index', 'Number')], returns: 'Point', summary: 'slot 1 of two line-likes', rule: P.intersectLLIndexRule },
    { params: [p('a', T_LL), p('b', T_LL), p('near', 'Point')], returns: 'Point', summary: 'crossing of two line-likes', rule: P.intersectLLNearRule },
    { params: [p('a', T_LL), p('b', T_LL), p('extend', 'Bool')], returns: 'Point', summary: 'crossing of the carriers', rule: P.intersectLLExtendRule },
    { params: [p('a', T_LL), p('b', T_LL), p('near', 'Point'), p('extend', 'Bool')], returns: 'Point', summary: 'crossing of the carriers', rule: P.intersectLLComboRule },
    { params: [p('a', T_PATH), p('b', T_PATH)], returns: 'List<Point>', summary: 'all crossings in canonical order', rule: P.intersectListRule },
    { params: [p('a', T_PATH), p('b', T_PATH), p('index', 'Number')], returns: 'Point', summary: 'slot k of the crossings', rule: P.intersectIndexRule },
    { params: [p('a', T_PATH), p('b', T_PATH), p('near', 'Point')], returns: 'Point', summary: 'crossing nearest P', rule: P.intersectNearRule },
    { params: [p('a', T_PATH), p('b', T_PATH), p('extend', 'Bool')], returns: 'Point', summary: 'crossing of the carriers, nearest slot', rule: P.intersectExtendRule },
    { params: [p('a', T_PATH), p('b', T_PATH), p('near', 'Point'), p('extend', 'Bool')], returns: 'Point', summary: 'carrier crossing nearest P', rule: P.intersectComboRule },
    { params: [p('f', T_FN1), p('g', T_FN1), p('near', 'Point')], returns: 'Point', summary: 'function crossing by Newton from P', rule: P.intersectNearFnRule },
    { params: [p('f', T_FN1), p('g', T_FN1), p('from', 'Number'), p('to', 'Number')], returns: 'List<Point>', summary: 'function crossings on an interval', rule: P.intersectFFIntervalRule },
    { params: [p('f', T_FN1), p('l', T_LL), p('from', 'Number'), p('to', 'Number')], returns: 'List<Point>', summary: 'function-line crossings on an interval', rule: P.intersectFLineIntervalRule },
  ]),
  cmd('Line', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Line', summary: 'line through two points', rule: P.linePPRule, explain: '{name} is the line through {0} and {1}' },
    { params: [p('p', 'Point'), p('v', 'Vector')], returns: 'Line', summary: 'line through a point along a vector', rule: P.linePVRule },
    { params: [p('p', 'Point'), p('l', T_LL)], returns: 'Line', summary: 'parallel through a point', rule: P.lineParallelRule },
    { params: [p('equation', 'Relation')], returns: 'Line', summary: 'line from an equation', rule: P.lineEqRule },
  ]),
  cmd('Segment', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Segment', summary: 'segment between two points', rule: P.segmentPPRule },
    { params: [p('a', 'Point'), p('length', 'Number')], returns: 'Segment', summary: 'segment along +x', rule: P.segmentLenRule },
  ]),
  cmd('Ray', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Ray', summary: 'ray from A through B', rule: P.rayPPRule },
    { params: [p('a', 'Point'), p('v', 'Vector')], returns: 'Ray', summary: 'ray from A along v', rule: P.rayPVRule },
  ]),
  cmd('Vector', 'geometry', [
    { params: [p('x', 'Number'), p('y', 'Number')], returns: 'Vector', summary: 'vector from components', rule: P.vectorNNRule },
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Vector', summary: 'vector from A to B', rule: P.vectorPPRule },
    { params: [p('p', 'Point')], returns: 'Vector', summary: 'position vector', rule: P.vectorPRule },
  ]),
  cmd('Perpendicular', 'geometry', [
    { params: [p('through', 'Point'), p('to', T_LLV)], returns: 'Line', summary: 'perpendicular line through a point', rule: P.perpendicularRule },
  ]),
  cmd('Parallel', 'geometry', [
    { params: [p('through', 'Point'), p('to', T_LLV)], returns: 'Line', summary: 'parallel line through a point', rule: P.parallelRule },
  ]),
  cmd('Bisector', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Line', summary: 'perpendicular bisector', rule: P.bisectorPPRule },
    { params: [p('s', 'Segment')], returns: 'Line', summary: 'perpendicular bisector of a segment', rule: P.bisectorSegRule },
    { params: [p('a', 'Point'), p('apex', 'Point'), p('c', 'Point')], returns: 'Line', summary: 'angle bisector at the middle point', rule: P.bisectorAPEXRule },
    { params: [p('l', T_LL), p('m', T_LL)], returns: 'List<Line>', summary: 'the two bisectors of two lines', rule: P.bisectorLLRule },
  ]),
  cmd('Direction', 'geometry', [
    { params: [p('l', 'Line|Segment|Ray')], returns: 'Vector', summary: 'unit direction', rule: P.directionRule },
  ]),
  cmd('Normal', 'geometry', [
    { params: [p('l', 'Line|Segment|Vector')], returns: 'Vector', summary: 'unit left normal', rule: P.normalRule },
  ]),
  cmd('UnitVector', 'geometry', [
    { params: [p('v', 'Vector|Line|Segment')], returns: 'Vector', summary: 'unit vector', rule: P.unitVectorRule },
  ]),
  cmd('PerpVector', 'geometry', [
    { params: [p('v', 'Vector|Line|Segment')], returns: 'Vector', summary: 'same length, turned 90 degrees', rule: P.perpVectorRule },
  ]),
  cmd('UnitPerpVector', 'geometry', [
    { params: [p('v', 'Vector|Line|Segment')], returns: 'Vector', summary: 'unit left normal', rule: P.unitPerpVectorRule },
  ]),
  cmd('Dot', 'geometry', [
    { params: [p('u', 'Vector'), p('v', 'Vector')], returns: 'Number', summary: 'scalar product', rule: P.dotRule },
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Number', summary: 'scalar product of position vectors', rule: P.dotRule },
  ]),
  cmd('Cross', 'geometry', [
    { params: [p('u', 'Vector'), p('v', 'Vector')], returns: 'Number', summary: 'signed area', rule: P.crossRule },
  ]),
  cmd('Length', 'geometry', [
    { params: [p('s', 'Vector|Point|Segment|Ray|Polyline|Arc')], returns: 'Number', summary: 'length', rule: G.lengthRule, explain: '{name} is the length of {0}' },
  ]),
  cmd('ToPolar', 'geometry', [
    { params: [p('v', 'Vector|Point')], returns: 'List<Number>', summary: '[r, theta]', rule: P.toPolarRule },
  ]),
  cmd('FromPolar', 'geometry', [
    { params: [p('r', 'Number'), p('theta', 'Number')], returns: 'Point', summary: 'point from polar coordinates', rule: P.fromPolarRule },
  ]),
  cmd('Distance', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Number', summary: 'distance between two points', rule: P.distancePPRule, explain: '{name} is the distance from {0} to {1}' },
    { params: [p('p', 'Point'), p('o', 'Line|Segment|Ray|Conic|Circle|Polygon|Function<Number>(1)|Curve')], returns: 'Number', summary: 'distance to a path', rule: P.distancePPathRule },
    { params: [p('l', T_LL), p('m', T_LL)], returns: 'Number', summary: 'distance between two lines', rule: P.distanceLLRule },
  ]),
  cmd('Slope', 'geometry', [
    { params: [p('l', 'Line|Segment|Ray|Vector')], returns: 'Number', summary: 'rise over run', rule: P.slopeRule },
  ]),
  cmd('Angle', 'geometry', [
    { params: [p('a', 'Point'), p('vertex', 'Point'), p('c', 'Point')], returns: 'Number', summary: 'angle at the middle point', rule: P.anglePPPRule, unit: 'angle' },
    { params: [p('l', T_LL), p('m', T_LL)], returns: 'Number', summary: 'angle between lines', rule: P.angleLLRule, unit: 'angle' },
    { params: [p('u', 'Vector'), p('v', 'Vector')], returns: 'Number', summary: 'angle between vectors', rule: P.angleVVRule, unit: 'angle' },
    { params: [p('v', 'Vector')], returns: 'Number', summary: 'angle from the x-axis', rule: P.angleVRule, unit: 'angle' },
    { params: [p('p', 'Point')], returns: 'Number', summary: 'angle of a position vector', rule: P.angleVRule, unit: 'angle' },
    { params: [p('a', 'Number')], returns: 'Number', summary: 'wrap into one turn', rule: P.angleNRule, unit: 'angle' },
  ]),
  cmd('AffineRatio', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], returns: 'Number', summary: 'lambda with C = A + lambda AB', rule: P.affineRatioRule },
  ]),
  cmd('CrossRatio', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point'), p('d', 'Point')], returns: 'Number', summary: 'cross ratio of four collinear points', rule: P.crossRatioRule },
  ]),
  cmd('Relation', 'geometry', [
    { params: [p('a', 'Any'), p('b', 'Any')], returns: 'Text', summary: 'parallel, perpendicular, incident, ...', rule: P.relationRule },
  ]),
  cmd('AreCollinear', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], returns: 'Bool', summary: 'on one line', rule: P.areCollinearRule },
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point'), p('tol', 'Number')], returns: 'Bool', summary: 'on one line (own tolerance)', rule: P.areCollinearRule },
  ]),
  cmd('AreConcurrent', 'geometry', [
    { params: [p('l', T_LL), p('m', T_LL), p('n', T_LL)], returns: 'Bool', summary: 'through one point', rule: P.areConcurrentRule },
    { params: [p('l', T_LL), p('m', T_LL), p('n', T_LL), p('tol', 'Number')], returns: 'Bool', summary: 'through one point (own tolerance)', rule: P.areConcurrentRule },
  ]),
  cmd('AreParallel', 'geometry', [
    { params: [p('l', T_LL), p('m', T_LL)], returns: 'Bool', summary: 'parallel', rule: P.areParallelRule },
    { params: [p('l', T_LL), p('m', T_LL), p('tol', 'Number')], returns: 'Bool', summary: 'parallel (own tolerance)', rule: P.areParallelRule },
  ]),
  cmd('ArePerpendicular', 'geometry', [
    { params: [p('l', T_LL), p('m', T_LL)], returns: 'Bool', summary: 'perpendicular', rule: P.arePerpendicularRule },
    { params: [p('l', T_LL), p('m', T_LL), p('tol', 'Number')], returns: 'Bool', summary: 'perpendicular (own tolerance)', rule: P.arePerpendicularRule },
  ]),
  cmd('AreConcyclic', 'geometry', [
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point'), p('d', 'Point')], returns: 'Bool', summary: 'on one circle', rule: P.areConcyclicRule },
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point'), p('d', 'Point'), p('tol', 'Number')], returns: 'Bool', summary: 'on one circle (own tolerance)', rule: P.areConcyclicRule },
  ]),
  cmd('AreEqual', 'geometry', [
    { params: [p('a', 'Any'), p('b', 'Any')], returns: 'Bool', summary: 'same value', rule: P.areEqualRule },
    { params: [p('a', 'Any'), p('b', 'Any'), p('tol', 'Number')], returns: 'Bool', summary: 'same value (own tolerance)', rule: P.areEqualRule },
  ]),
  cmd('AreCongruent', 'geometry', [
    { params: [p('a', 'Any'), p('b', 'Any')], returns: 'Bool', summary: 'same shape and size', rule: P.areCongruentRule },
    { params: [p('a', 'Any'), p('b', 'Any'), p('tol', 'Number')], returns: 'Bool', summary: 'same shape and size (own tolerance)', rule: P.areCongruentRule },
  ]),
  cmd('OnPath', 'geometry', [
    { params: [p('p', 'Point'), p('path', T_PATH)], returns: 'Bool', summary: 'point on path', rule: P.onPathRule },
    { params: [p('p', 'Point'), p('path', T_PATH), p('tol', 'Number')], returns: 'Bool', summary: 'point on path (own tolerance)', rule: P.onPathRule },
  ]),
  cmd('InRegion', 'geometry', [
    { params: [p('p', 'Point'), p('region', T_REGION)], returns: 'Bool', summary: 'point in a region', rule: P.inRegionRule },
    { params: [p('p', 'Point'), p('region', T_REGION), p('tol', 'Number')], returns: 'Bool', summary: 'point in a region (own tolerance)', rule: P.inRegionRule },
  ]),
  cmd('Locus', 'geometry', [
    { params: [p('tracer', 'Point'), p('mover', 'Point')], returns: 'Curve', summary: 'locus over a point on a path', rule: L.locusMoverRule },
    { params: [p('tracer', 'Point'), p('s', 'Number'), p('from', 'Number'), p('to', 'Number')], returns: 'Curve', summary: 'locus over a free number', rule: L.locusSweepRule },
  ]),
];

/* ------------------------------ conics ------------------------------ */

const conicCommands: readonly CommandSpec[] = [
  cmd('Circle', 'conics', [
    { params: [p('center', 'Point'), p('radius', 'Number')], returns: 'Circle', summary: 'circle by centre and radius', rule: C.circleCRRule, explain: '{name} is the circle about {0} with radius {1}' },
    { params: [p('center', 'Point'), p('through', 'Point')], returns: 'Circle', summary: 'circle through a point', rule: C.circleCPRule },
    { params: [p('center', 'Point'), p('seg', 'Segment')], returns: 'Circle', summary: 'circle with a segment as radius', rule: C.circleCSegRule },
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], returns: 'Circle', summary: 'circle through three points', rule: C.circle3Rule },
  ]),
  cmd('Incircle', 'conics', [
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], returns: 'Circle', summary: 'inscribed circle', rule: C.incircleRule },
  ]),
  cmd('Semicircle', 'conics', [
    { params: [p('a', 'Point'), p('b', 'Point')], returns: 'Arc', summary: 'half disc left of A->B', rule: C.semicircleRule },
  ]),
  cmd('Arc', 'conics', [
    { params: [p('center', 'Point'), p('radius', 'Number'), p('from', 'Number'), p('to', 'Number')], returns: 'Arc', summary: 'circular arc by angles', rule: C.arcCNNRule },
    { params: [p('center', 'Point'), p('start', 'Point'), p('end', 'Point')], returns: 'Arc', summary: 'circular arc by points', rule: C.arcCSERule },
    { params: [p('c', T_CONIC), p('from', 'Number'), p('to', 'Number')], returns: 'Arc', summary: 'conic arc by angles', rule: C.arcConicNNRule },
    { params: [p('c', T_CONIC), p('p', 'Point'), p('q', 'Point')], returns: 'Arc', summary: 'conic arc by points', rule: C.arcConicPQRule },
  ]),
  cmd('ArcThrough', 'conics', [
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], returns: 'Arc', summary: 'arc from A through B to C', rule: C.arcThroughRule },
  ]),
  cmd('Sector', 'conics', [
    { params: [p('center', 'Point'), p('radius', 'Number'), p('from', 'Number'), p('to', 'Number')], returns: 'Sector', summary: 'circular sector by angles', rule: C.sectorCNNRule },
    { params: [p('c', T_CONIC), p('from', 'Number'), p('to', 'Number')], returns: 'Sector', summary: 'conic sector by angles', rule: C.sectorConicNNRule },
    { params: [p('c', T_CONIC), p('p', 'Point'), p('q', 'Point')], returns: 'Sector', summary: 'conic sector by points', rule: C.sectorConicPQRule },
    { params: [p('center', 'Point'), p('start', 'Point'), p('end', 'Point')], returns: 'Sector', summary: 'circular sector by points', rule: C.sectorCSERule },
  ]),
  cmd('SectorThrough', 'conics', [
    { params: [p('a', 'Point'), p('b', 'Point'), p('c', 'Point')], returns: 'Sector', summary: 'sector from A through B to C', rule: C.sectorThroughRule },
  ]),
  cmd('Conic', 'conics', [
    { params: [p('p1', 'Point'), p('p2', 'Point'), p('p3', 'Point'), p('p4', 'Point'), p('p5', 'Point')], returns: 'Conic', summary: 'conic through five points', rule: C.conic5Rule },
    { params: [p('a', 'Number'), p('b', 'Number'), p('c', 'Number'), p('d', 'Number'), p('e', 'Number'), p('f', 'Number')], returns: 'Conic', summary: 'conic from six coefficients', rule: C.conic6Rule },
    { params: [p('coeffs', 'List<Number>')], returns: 'Conic', summary: 'conic from a list of six', rule: C.conicListRule },
    { params: [p('equation', 'Relation')], returns: 'Conic', summary: 'conic from an equation', rule: C.conicEqRule },
  ]),
  cmd('Ellipse', 'conics', [
    { params: [p('f1', 'Point'), p('f2', 'Point'), p('a', 'Number')], returns: 'Conic', summary: 'ellipse from foci and semi-major axis', rule: C.ellipseFociLengthRule },
    { params: [p('f1', 'Point'), p('f2', 'Point'), p('seg', 'Segment')], returns: 'Conic', summary: 'ellipse from foci and a segment', rule: C.ellipseFociSegmentRule },
    { params: [p('f1', 'Point'), p('f2', 'Point'), p('p', 'Point')], returns: 'Conic', summary: 'ellipse through a point', rule: C.ellipseFociPointRule },
  ]),
  cmd('Hyperbola', 'conics', [
    { params: [p('f1', 'Point'), p('f2', 'Point'), p('a', 'Number')], returns: 'Conic', summary: 'hyperbola from foci and transverse axis', rule: C.hyperbolaFociLengthRule },
    { params: [p('f1', 'Point'), p('f2', 'Point'), p('seg', 'Segment')], returns: 'Conic', summary: 'hyperbola from foci and a segment', rule: C.hyperbolaFociSegmentRule },
    { params: [p('f1', 'Point'), p('f2', 'Point'), p('p', 'Point')], returns: 'Conic', summary: 'hyperbola through a point', rule: C.hyperbolaFociPointRule },
  ]),
  cmd('Parabola', 'conics', [
    { params: [p('focus', 'Point'), p('directrix', T_LL)], returns: 'Conic', summary: 'parabola from focus and directrix', rule: C.parabolaRule },
  ]),
  cmd('Center', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Point', summary: 'centre of a conic', rule: C.centerRule },
  ]),
  cmd('Radius', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Number', summary: 'radius of a circle', rule: C.radiusRule },
  ]),
  cmd('SemiMajor', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Number', summary: 'semi-major axis', rule: C.semiMajorRule },
  ]),
  cmd('SemiMinor', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Number', summary: 'semi-minor axis', rule: C.semiMinorRule },
  ]),
  cmd('Eccentricity', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Number', summary: 'eccentricity', rule: C.eccentricityRule },
  ]),
  cmd('LinearEccentricity', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Number', summary: 'centre to focus', rule: C.linearEccentricityRule },
  ]),
  cmd('Focus', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'List<Point>', summary: 'foci of a conic', rule: C.focusRule },
  ]),
  cmd('Directrix', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'List<Line>', summary: 'directrices of a conic', rule: C.directrixRule },
  ]),
  cmd('MajorAxis', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Line', summary: 'major axis', rule: C.majorAxisRule },
  ]),
  cmd('MinorAxis', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Line', summary: 'minor axis', rule: C.minorAxisRule },
  ]),
  cmd('Axes', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'List<Line>', summary: 'major and minor axes', rule: C.axesRule },
  ]),
  cmd('Tilt', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Number', summary: 'major-axis direction', rule: C.tiltRule, unit: 'angle' },
  ]),
  cmd('Parameter', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Number', summary: 'focus-to-directrix distance', rule: C.parameterRule },
  ]),
  cmd('Coefficients', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'List<Number>', summary: '[A, B, C, D, E, F], monic', rule: C.coefficientsRule },
  ]),
  cmd('Equation', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Text', summary: 'readable equation', rule: C.equationRule },
  ]),
  cmd('Type', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'Text', summary: 'kind of conic', rule: C.conicTypeRule },
  ]),
  cmd('Tangent', 'conics', [
    { params: [p('p', 'Point'), p('c', T_CONIC)], returns: 'List<Line>', summary: 'tangents through a point', rule: C.tangentPRule },
    { params: [p('l', T_LL), p('c', T_CONIC)], returns: 'List<Line>', summary: 'tangents parallel to a line', rule: C.tangentLRule },
    { params: [p('c1', T_CONIC), p('c2', T_CONIC)], returns: 'List<Line>', summary: 'common tangents', rule: C.tangentCCRule },
  ]),
  cmd('Polar', 'conics', [
    { params: [p('p', 'Point'), p('c', T_CONIC)], returns: 'Line', summary: 'polar line', rule: C.polarRule },
  ]),
  cmd('Pole', 'conics', [
    { params: [p('l', T_LL), p('c', T_CONIC)], returns: 'Point', summary: 'pole of a line', rule: C.poleRule },
  ]),
  cmd('ConjugateDiameter', 'conics', [
    { params: [p('d', 'Line|Segment|Ray|Vector'), p('c', T_CONIC)], returns: 'Line', summary: 'conjugate diameter', rule: C.conjugateDiameterRule },
  ]),
  cmd('Asymptote', 'conics', [
    { params: [p('c', T_CONIC)], returns: 'List<Line>', summary: 'asymptotes of a hyperbola', rule: C.asymptoteRule },
  ]),
  cmd('IsTangent', 'conics', [
    { params: [p('l', T_LL), p('c', T_CONIC)], returns: 'Bool', summary: 'is the line tangent', rule: C.isTangentRule },
  ]),
  cmd('Curvature', 'conics', [
    { params: [p('p', 'Point'), p('c', T_CONIC)], returns: 'Number', summary: 'signed curvature', rule: C.curvatureRule },
  ]),
  cmd('CurvatureVector', 'conics', [
    { params: [p('p', 'Point'), p('c', T_CONIC)], returns: 'Vector', summary: 'curvature vector', rule: C.curvatureVectorRule },
  ]),
  cmd('OsculatingCircle', 'conics', [
    { params: [p('p', 'Point'), p('c', T_CONIC)], returns: 'Circle', summary: 'kissing circle', rule: C.osculatingCircleRule },
  ]),
];

/* ------------------------------ polygons ------------------------------ */

const polygonCommands: readonly CommandSpec[] = [
  cmd('Polygon', 'polygons', [
    { params: [p('p1', 'Point'), p('p2', 'Point'), p('p3', 'Point')], rest: p('rest', 'Point'), returns: 'Polygon', summary: 'polygon through points', rule: G.polygonPtsRule, explain: '{name} is the polygon through {0}, {1} and {2}' },
    { params: [p('points', 'List<Point>')], returns: 'Polygon', summary: 'polygon from a list', rule: G.polygonListRule },
    { params: [p('center', 'Point'), p('radius', 'Number'), p('sides', 'Number')], returns: 'Polygon', summary: 'regular polygon about a centre', rule: G.polygonCenterRule },
    { params: [p('center', 'Point'), p('radius', 'Number'), p('sides', 'Number'), p('start', 'Number')], returns: 'Polygon', summary: 'regular polygon with a start angle', rule: G.polygonCenterRule },
    { params: [p('p', 'Point'), p('q', 'Point'), p('sides', 'Number')], returns: 'Polygon', summary: 'regular polygon on an edge', rule: G.polygonEdgeRule },
    { params: [p('start', 'Point'), p('v1', 'Vector')], rest: p('rest', 'Vector'), returns: 'Polygon', summary: 'head-to-tail vector polygon', rule: G.polygonVectorRule },
  ]),
  cmd('Polyline', 'polygons', [
    { params: [p('p1', 'Point'), p('p2', 'Point')], rest: p('rest', 'Point'), returns: 'Polyline', summary: 'open polyline', rule: G.polylinePtsRule },
    { params: [p('points', 'List<Point>')], returns: 'Polyline', summary: 'polyline from a list', rule: G.polylineListRule },
    { params: [p('start', 'Point'), p('v1', 'Vector')], rest: p('rest', 'Vector'), returns: 'Polyline', summary: 'head-to-tail vector polyline', rule: G.polylineVectorRule },
  ]),
  cmd('Rigid', 'polygons', [
    { params: [p('poly', 'Polygon')], returns: 'Polygon', summary: 'rigid copy on top of the source', rule: G.rigidRule },
    { params: [p('poly', 'Polygon'), p('dx', 'Number'), p('dy', 'Number')], returns: 'Polygon', summary: 'rigid copy with an offset', rule: G.rigidOffsetRule },
    { params: [p('p1', 'Point'), p('p2', 'Point'), p('p3', 'Point')], rest: p('rest', 'Point'), returns: 'Polygon', summary: 'rigid polygon from points', rule: G.rigidPtsRule },
  ]),
  cmd('Vertices', 'polygons', [
    { params: [p('poly', 'Polygon|Polyline')], returns: 'List<Point>', summary: 'all corners', rule: G.verticesRule },
  ]),
  cmd('Side', 'polygons', [
    { params: [p('poly', 'Polygon'), p('index', 'Number')], returns: 'Segment', summary: 'side k (wrapping)', rule: G.sideRule },
  ]),
  cmd('Sides', 'polygons', [
    { params: [p('poly', 'Polygon|Polyline')], returns: 'List<Segment>', summary: 'all sides', rule: G.sidesRule },
  ]),
  cmd('Convex', 'polygons', [
    { params: [p('poly', 'Polygon')], returns: 'Bool', summary: 'is convex', rule: G.convexRule },
  ]),
  cmd('Simple', 'polygons', [
    { params: [p('poly', 'Polygon')], returns: 'Bool', summary: 'has no self-crossing', rule: G.simpleRule },
  ]),
  cmd('Area', 'polygons', [
    { params: [p('poly', 'Polygon')], returns: 'Number', summary: 'area of a polygon', rule: G.areaPolyRule, explain: '{name} is the area of {0}' },
    { params: [p('p1', 'Point'), p('p2', 'Point'), p('p3', 'Point')], rest: p('rest', 'Point'), returns: 'Number', summary: 'area of the polygon through points', rule: G.areaPtsRule },
    { params: [p('s', 'Sector')], returns: 'Number', summary: 'area of a sector', rule: G.areaSectorRule },
    { params: [p('c', T_CONIC)], returns: 'Number', summary: 'area of a circle or ellipse', rule: G.areaConicRule },
  ]),
  cmd('SignedArea', 'polygons', [
    { params: [p('poly', 'Polygon')], returns: 'Number', summary: 'signed area (CCW positive)', rule: G.signedAreaRule },
  ]),
  cmd('Perimeter', 'polygons', [
    { params: [p('s', 'Polygon|Polyline|Conic|Circle|Sector')], returns: 'Number', summary: 'perimeter', rule: G.perimeterRule },
  ]),
  cmd('Circumference', 'polygons', [
    { params: [p('c', T_CONIC)], returns: 'Number', summary: 'circumference of a circle or ellipse', rule: G.circumferenceRule },
  ]),
  cmd('InteriorAngles', 'polygons', [
    { params: [p('poly', 'Polygon')], returns: 'List<Number>', summary: 'one angle per vertex', rule: G.interiorAnglesRule, unit: 'angle' },
  ]),
  cmd('IntersectPath', 'polygons', [
    { params: [p('l', T_LL), p('poly', 'Polygon')], returns: 'List<Segment>', summary: 'parts of a line inside a polygon', rule: G.intersectPathLineRule },
    { params: [p('a', 'Polygon'), p('b', 'Polygon')], returns: 'List<Polygon>', summary: 'common area', rule: G.intersectPathPolyRule },
  ]),
  cmd('Union', 'polygons', [
    { params: [p('a', 'Polygon'), p('b', 'Polygon')], returns: 'List<Polygon>', summary: 'union', rule: G.unionRule },
  ]),
  cmd('Difference', 'polygons', [
    { params: [p('a', 'Polygon'), p('b', 'Polygon')], returns: 'List<Polygon>', summary: 'difference', rule: G.differenceRule },
  ]),
];

/* ------------------------------ transforms ------------------------------ */

const transformCommands: readonly CommandSpec[] = [
  cmd('Translate', 'transforms', [
    { params: [p('shape', T_SHAPEN), p('v', 'Vector')], returns: '=shape', summary: 'slide along a vector', rule: T.translateRule, explain: '{name} is {0} moved by {1}' },
    { params: [p('shape', T_SHAPEN), p('v', 'Vector'), p('progress', 'Number')], returns: '=shape', summary: 'slide, shown partway', rule: T.translateProgressRule },
    { params: [p('shape', 'Vector'), p('v', 'Vector')], returns: 'Vector', summary: 'translate a vector', rule: T.translateVectorRule },
    { params: [p('shape', 'Vector'), p('v', 'Vector'), p('progress', 'Number')], returns: 'Vector', summary: 'translate a vector, shown partway', rule: T.translateVectorProgressRule },
    { params: [p('v', 'Vector'), p('at', 'Point')], returns: 'Vector', summary: 'vector placed at a point', rule: T.translatePlaceRule },
  ]),
  cmd('Rotate', 'transforms', [
    { params: [p('shape', T_SHAPEN_NF), p('angle', 'Number')], returns: '=shape', summary: 'turn about the origin', rule: T.rotateRule },
    { params: [p('shape', T_SHAPEN_NF), p('angle', 'Number'), p('progress', 'Number')], returns: '=shape', summary: 'turn about the origin, shown partway', rule: T.rotateProgressRule },
    { params: [p('shape', T_SHAPEN_NF), p('angle', 'Number'), p('center', 'Point')], returns: '=shape', summary: 'turn about a point', rule: T.rotateRule, explain: '{name} is {0} turned by {1} about {2}' },
    { params: [p('shape', T_SHAPEN_NF), p('angle', 'Number'), p('center', 'Point'), p('progress', 'Number')], returns: '=shape', summary: 'turn about a point, shown partway', rule: T.rotateCenterProgressRule },
    { params: [p('shape', 'Vector'), p('angle', 'Number')], returns: 'Vector', summary: 'turn a vector', rule: T.rotateVectorRule },
    { params: [p('shape', 'Vector'), p('angle', 'Number'), p('progress', 'Number')], returns: 'Vector', summary: 'turn a vector, shown partway', rule: T.rotateVectorProgressRule },
    { params: [p('shape', 'Vector'), p('angle', 'Number'), p('center', 'Point')], returns: 'Vector', summary: 'turn a vector', rule: T.rotateVectorRule },
    { params: [p('shape', 'Vector'), p('angle', 'Number'), p('center', 'Point'), p('progress', 'Number')], returns: 'Vector', summary: 'turn a vector, shown partway', rule: T.rotateVectorProgressRule },
    { params: [p('shape', T_FN1), p('angle', 'Number')], returns: 'Curve', summary: 'turn a function about the origin', rule: T.rotateFuncRule },
    { params: [p('shape', T_FN1), p('angle', 'Number'), p('progress', 'Number')], returns: 'Curve', summary: 'turn a function, shown partway', rule: T.rotateFuncRule },
    { params: [p('shape', T_FN1), p('angle', 'Number'), p('center', 'Point')], returns: 'Curve', summary: 'turn a function about a point', rule: T.rotateFuncRule },
    { params: [p('shape', T_FN1), p('angle', 'Number'), p('center', 'Point'), p('progress', 'Number')], returns: 'Curve', summary: 'turn a function about a point, shown partway', rule: T.rotateFuncRule },
  ]),
  cmd('Reflect', 'transforms', [
    { params: [p('shape', T_SHAPEN_NF), p('mirror', T_LL)], returns: '=shape', summary: 'flip across a line', rule: T.reflectLineRule, explain: '{name} is {0} reflected in {1}' },
    { params: [p('shape', T_SHAPEN_NF), p('mirror', T_LL), p('progress', 'Number')], returns: '=shape', summary: 'flip across a line, shown partway', rule: T.reflectLineProgressRule },
    { params: [p('shape', T_FN1), p('mirror', T_LL)], returns: 'Curve', summary: 'flip a function across a line', rule: T.reflectLineFuncRule },
    { params: [p('shape', T_FN1), p('mirror', T_LL), p('progress', 'Number')], returns: 'Curve', summary: 'flip a function across a line, shown partway', rule: T.reflectLineFuncRule },
    { params: [p('shape', T_SHAPEN), p('center', 'Point')], returns: '=shape', summary: 'flip about a point', rule: T.reflectPointRule },
    { params: [p('shape', T_SHAPEN), p('center', 'Point'), p('progress', 'Number')], returns: '=shape', summary: 'flip about a point, shown partway', rule: T.reflectPointProgressRule },
    { params: [p('shape', 'Vector'), p('mirror', T_LL)], returns: 'Vector', summary: 'flip a vector across a line', rule: T.reflectLineVectorRule },
    { params: [p('shape', 'Vector'), p('mirror', T_LL), p('progress', 'Number')], returns: 'Vector', summary: 'flip a vector, shown partway', rule: T.reflectLineVectorProgressRule },
    { params: [p('shape', 'Vector'), p('center', 'Point')], returns: 'Vector', summary: 'flip a vector about a point', rule: T.reflectPointVectorRule },
    { params: [p('shape', 'Vector'), p('center', 'Point'), p('progress', 'Number')], returns: 'Vector', summary: 'flip a vector, shown partway', rule: T.reflectPointVectorProgressRule },
    { params: [p('shape', 'Point'), p('circle', 'Circle')], returns: 'Point', summary: 'invert a point in a circle', rule: T.invertPointRule },
    { params: [p('shape', 'Line'), p('circle', 'Circle')], returns: 'Conic', summary: 'invert a line in a circle', rule: T.invertLineRule },
    { params: [p('shape', 'Circle'), p('circle', 'Circle')], returns: 'Conic', summary: 'invert a circle in a circle', rule: T.invertCircleRule },
    { params: [p('shape', 'List<Point>'), p('circle', 'Circle')], returns: 'List<Point>', summary: 'invert points in a circle', rule: T.invertListRule },
  ]),
  cmd('Dilate', 'transforms', [
    { params: [p('shape', T_SHAPEN), p('factor', 'Number')], returns: '=shape', summary: 'grow from the origin', rule: T.dilateRule },
    { params: [p('shape', T_SHAPEN), p('factor', 'Number'), p('progress', 'Number')], returns: '=shape', summary: 'grow from the origin, shown partway', rule: T.dilateProgressRule },
    { params: [p('shape', T_SHAPEN), p('factor', 'Number'), p('center', 'Point')], returns: '=shape', summary: 'grow from a centre', rule: T.dilateRule, explain: '{name} is {0} enlarged by {1} from {2}' },
    { params: [p('shape', T_SHAPEN), p('factor', 'Number'), p('center', 'Point'), p('progress', 'Number')], returns: '=shape', summary: 'grow from a centre, shown partway', rule: T.dilateCenterProgressRule },
    { params: [p('shape', 'Vector'), p('factor', 'Number')], returns: 'Vector', summary: 'scale a vector', rule: T.dilateVectorRule },
    { params: [p('shape', 'Vector'), p('factor', 'Number'), p('progress', 'Number')], returns: 'Vector', summary: 'scale a vector, shown partway', rule: T.dilateVectorProgressRule },
    { params: [p('shape', 'Vector'), p('factor', 'Number'), p('center', 'Point')], returns: 'Vector', summary: 'scale a vector', rule: T.dilateVectorRule },
    { params: [p('shape', 'Vector'), p('factor', 'Number'), p('center', 'Point'), p('progress', 'Number')], returns: 'Vector', summary: 'scale a vector, shown partway', rule: T.dilateVectorProgressRule },
  ]),
  cmd('Shear', 'transforms', [
    { params: [p('shape', T_SHAPEN_NCF), p('line', T_LL), p('ratio', 'Number')], returns: '=shape', summary: 'shear along a line', rule: T.shearRule },
    { params: [p('shape', T_SHAPEN_NCF), p('line', T_LL), p('ratio', 'Number'), p('progress', 'Number')], returns: '=shape', summary: 'shear, shown partway', rule: T.shearProgressRule },
    { params: [p('shape', 'Vector'), p('line', T_LL), p('ratio', 'Number')], returns: 'Vector', summary: 'shear a vector', rule: T.shearVectorRule },
    { params: [p('shape', 'Vector'), p('line', T_LL), p('ratio', 'Number'), p('progress', 'Number')], returns: 'Vector', summary: 'shear a vector, shown partway', rule: T.shearVectorProgressRule },
    { params: [p('shape', 'Circle'), p('line', T_LL), p('ratio', 'Number')], returns: 'Conic', summary: 'shear a circle', rule: T.shearCircleRule },
    { params: [p('shape', 'Circle'), p('line', T_LL), p('ratio', 'Number'), p('progress', 'Number')], returns: 'Conic', summary: 'shear a circle, shown partway', rule: T.shearCircleProgressRule },
    { params: [p('shape', T_FN1), p('line', T_LL), p('ratio', 'Number')], returns: 'Curve', summary: 'shear a function', rule: T.shearFuncRule },
    { params: [p('shape', T_FN1), p('line', T_LL), p('ratio', 'Number'), p('progress', 'Number')], returns: 'Curve', summary: 'shear a function, shown partway', rule: T.shearFuncProgressRule },
  ]),
  cmd('Stretch', 'transforms', [
    { params: [p('shape', T_SHAPEN_NCF), p('line', T_LL), p('ratio', 'Number')], returns: '=shape', summary: 'stretch across a line', rule: T.stretchLineRule },
    { params: [p('shape', T_SHAPEN_NCF), p('line', T_LL), p('ratio', 'Number'), p('progress', 'Number')], returns: '=shape', summary: 'stretch across a line, shown partway', rule: T.stretchLineProgressRule },
    { params: [p('shape', T_SHAPEN_NCF), p('v', 'Vector')], returns: '=shape', summary: 'stretch along a vector', rule: T.stretchVecRule },
    { params: [p('shape', T_SHAPEN_NCF), p('v', 'Vector'), p('progress', 'Number')], returns: '=shape', summary: 'stretch along a vector, shown partway', rule: T.stretchVecProgressRule },
    { params: [p('shape', 'Vector'), p('line', T_LL), p('ratio', 'Number')], returns: 'Vector', summary: 'stretch a vector', rule: T.stretchVectorRule },
    { params: [p('shape', 'Vector'), p('line', T_LL), p('ratio', 'Number'), p('progress', 'Number')], returns: 'Vector', summary: 'stretch a vector, shown partway', rule: T.stretchVectorProgressRule },
    { params: [p('shape', 'Vector'), p('v', 'Vector')], returns: 'Vector', summary: 'stretch a vector along a vector', rule: T.stretchVectorRule },
    { params: [p('shape', 'Vector'), p('v', 'Vector'), p('progress', 'Number')], returns: 'Vector', summary: 'stretch a vector, shown partway', rule: T.stretchVectorVecProgressRule },
    { params: [p('shape', 'Circle'), p('line', T_LL), p('ratio', 'Number')], returns: 'Conic', summary: 'stretch a circle', rule: T.stretchCircleRule },
    { params: [p('shape', 'Circle'), p('line', T_LL), p('ratio', 'Number'), p('progress', 'Number')], returns: 'Conic', summary: 'stretch a circle, shown partway', rule: T.stretchCircleProgressRule },
    { params: [p('shape', 'Circle'), p('v', 'Vector')], returns: 'Conic', summary: 'stretch a circle along a vector', rule: T.stretchCircleVecRule },
    { params: [p('shape', 'Circle'), p('v', 'Vector'), p('progress', 'Number')], returns: 'Conic', summary: 'stretch a circle, shown partway', rule: T.stretchCircleVecProgressRule },
    { params: [p('shape', T_FN1), p('line', T_LL), p('ratio', 'Number')], returns: 'Curve', summary: 'stretch a function', rule: T.stretchFuncRule },
    { params: [p('shape', T_FN1), p('line', T_LL), p('ratio', 'Number'), p('progress', 'Number')], returns: 'Curve', summary: 'stretch a function, shown partway', rule: T.stretchFuncProgressRule },
    { params: [p('shape', T_FN1), p('v', 'Vector')], returns: 'Curve', summary: 'stretch a function along a vector', rule: T.stretchFuncVecRule },
    { params: [p('shape', T_FN1), p('v', 'Vector'), p('progress', 'Number')], returns: 'Curve', summary: 'stretch a function, shown partway', rule: T.stretchFuncVecProgressRule },
  ]),
  cmd('ApplyMatrix', 'transforms', [
    { params: [p('m', 'Matrix|List'), p('shape', T_SHAPEN_NCF)], returns: '=shape', summary: 'map by a matrix', rule: T.applyMatrixRule },
    { params: [p('m', 'Matrix|List'), p('shape', 'Vector')], returns: 'Vector', summary: 'map a vector by a matrix', rule: T.applyMatrixVectorRule },
    { params: [p('m', 'Matrix|List'), p('shape', 'Circle')], returns: 'Conic', summary: 'map a circle by a matrix', rule: T.applyMatrixCircleRule },
    { params: [p('m', 'Matrix|List'), p('shape', T_FN1)], returns: 'Curve', summary: 'map a function by a matrix', rule: T.applyMatrixFuncRule },
  ]),
  cmd('Shift', 'transforms', [
    { params: [p('v', 'Vector')], returns: 'Transform', summary: 'translation as a value', rule: T.shiftRule },
  ]),
  cmd('Turn', 'transforms', [
    { params: [p('angle', 'Number'), p('center', 'Point')], returns: 'Transform', summary: 'rotation as a value', rule: T.turnRule },
  ]),
  cmd('Mirror', 'transforms', [
    { params: [p('mirror', T_LL)], returns: 'Transform', summary: 'reflection as a value', rule: T.mirrorRule },
  ]),
  cmd('Scale', 'transforms', [
    { params: [p('factor', 'Number'), p('center', 'Point')], returns: 'Transform', summary: 'dilation as a value', rule: T.scaleRule },
  ]),
  cmd('ShearBy', 'transforms', [
    { params: [p('line', T_LL), p('ratio', 'Number')], returns: 'Transform', summary: 'shear as a value', rule: T.shearByRule },
  ]),
  cmd('StretchBy', 'transforms', [
    { params: [p('line', T_LL), p('ratio', 'Number')], returns: 'Transform', summary: 'stretch as a value', rule: T.stretchByRule },
  ]),
  cmd('Linear', 'transforms', [
    { params: [p('m', 'Matrix|List')], returns: 'Transform', summary: 'matrix map as a value', rule: T.linearRule },
  ]),
  cmd('Then', 'transforms', [
    { params: [p('first', 'Transform'), p('second', 'Transform')], rest: p('rest', 'Transform'), returns: 'Transform', summary: 'compose transforms', rule: T.thenRule },
  ]),
  cmd('Inverse', 'transforms', [
    { params: [p('t', 'Transform')], returns: 'Transform', summary: 'inverse transform', rule: T.inverseRule },
  ]),
  cmd('Move', 'transforms', [
    { params: [p('shape', T_SHAPEN_NCF), p('t', 'Transform')], returns: '=shape', summary: 'image under a transform', rule: T.moveRule },
    { params: [p('shape', 'Vector'), p('t', 'Transform')], returns: 'Vector', summary: 'vector under a transform', rule: T.moveVectorRule },
    { params: [p('shape', 'Circle'), p('t', 'Transform')], returns: 'Conic', summary: 'circle under a transform', rule: T.moveCircleRule },
    { params: [p('shape', T_FN1), p('t', 'Transform')], returns: 'Curve', summary: 'function under a transform', rule: T.moveFuncRule },
  ]),
];

/** Every geometry command spec, for the registry and the studio handover. */
export const GEOMETRY_COMMANDS: readonly CommandSpec[] = [...pointCommands, ...conicCommands, ...polygonCommands, ...transformCommands];
