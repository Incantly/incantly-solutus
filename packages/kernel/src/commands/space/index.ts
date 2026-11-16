/**
 * The space area, kernel side (docs/features/space-3d; .kiro/specs/space-3d R1): points, vectors, lines and planes in
 * space, their measures and intersections, as forms of the shared commands. Plug in with `registerSpace(registry)`.
 */
import { registerTypeStyle } from '../../graph/props';
import type { CommandRegistry, CommandRule } from '../../graph/registry';
import { registerFreeType } from '../../graph/values';
import { numberSource } from '../../graph/values';
import { registerReasonPhrase } from '../../errors/phrases';
import { registerFieldNames, registerFieldTyper, registerTupleType } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { formatNumber, registerValueText } from '../../language/runtime';
import type { CallCheck, CommandForm, CommandSpec, ParamSpec, Refusal } from '../../language/table';
import { T, registerBinaryOp, registerTypeAlias, registerUnaryOp } from '../../language/types';
import type { Ty } from '../../language/types';
import * as R from './rules';
import { FLAT_OF, SPACE_OF, shape3Of } from './types';
import type { Plane3, Polygon3, Segment3 } from './types';
import type { V3 } from './v3';
import { add, isV3, len, scale, sub } from './v3';

export * from './types';
export * from './v3';
export { lineLike, newell, plane3, polygon3 } from './rules';

const GROUP = 'space';
const LL = 'LineLike3';
const p = (name: string, type: string): ParamSpec => ({ name, type });

interface FormDef {
  readonly params: readonly ParamSpec[];
  readonly rest?: ParamSpec;
  readonly returns: string;
  readonly summary: string;
  readonly rule: CommandRule;
  readonly unit?: 'angle';
}

const cmd = (name: string, forms: readonly FormDef[]): CommandSpec => ({
  name,
  kind: 'object',
  group: GROUP,
  forms: forms.map((f): CommandForm => ({
    params: f.params,
    ...(f.rest ? { rest: f.rest } : {}),
    returns: f.returns,
    rule: () => f.rule,
    summary: f.summary,
    ...(f.unit ? { unit: f.unit } : {}),
  })),
  refuse: mixedDimension(name),
});

/* ------------------------------ mixed_dimension (S001) ------------------------------ */

const isSpaceType = (t: string): boolean => Object.hasOwn(FLAT_OF, t) || t === 'Plane' || t === 'Polyhedron' || t === 'Sphere' || t === 'Cylinder' || t === 'Cone';
const isFlatType = (t: string): boolean => Object.hasOwn(SPACE_OF, t);

/** A call that mixes flat and space values fits no form: say which argument is which, and how to lift it (errors 3.1). */
function mixedDimension(command: string): (c: CallCheck) => Refusal | undefined {
  return (c) => {
    const flat = c.args.findIndex((a) => isFlatType(a.type));
    const space = c.args.findIndex((a) => isSpaceType(a.type));
    if (flat < 0 || space < 0) return undefined;
    const a = c.args[flat] as CallCheck['args'][number];
    const b = c.args[space] as CallCheck['args'][number];
    const lit = a.literal as { x?: number; y?: number } | undefined;
    const lifted = a.type === 'Point' && lit && typeof lit.x === 'number' ? `(${numberSource(lit.x)}, ${numberSource(lit.y as number)}, 0)` : a.type === 'Point' ? `(${a.text}.x, ${a.text}.y, 0)` : undefined;
    return {
      kind: 'mixed_dimension',
      message: `${command}(${c.args.map((x) => x.text).join(', ')}): ${a.text} is a flat ${a.type} but ${b.text} is a ${b.type} in space.`,
      hint: a.type === 'Point' ? `Both points need the same number of coordinates. Give ${a.text} a z value: (x, y, 0).` : `Use the ${SPACE_OF[a.type] ?? a.type} form of ${a.text}, built from points with three coordinates.`,
      param: flat,
      params: { why: `${command}: ${a.text} is a flat ${a.type} but ${b.text} is a ${b.type} in space.` },
      ...(lifted ? { replaceArg: lifted } : {}),
    };
  };
}

/* ------------------------------ the table ------------------------------ */

export const SPACE_COMMANDS: readonly CommandSpec[] = [
  cmd('Vector', [
    { params: [p('x', 'Number'), p('y', 'Number'), p('z', 'Number')], returns: 'Vector3', summary: 'vector in space from three numbers', rule: R.vectorXYZ },
    { params: [p('from', 'Point3'), p('to', 'Point3')], returns: 'Vector3', summary: 'vector from one point in space to another', rule: R.vectorPQ },
  ]),
  cmd('Point', [
    { params: [p('a', 'Point3'), p('v', 'Vector3')], returns: 'Point3', summary: 'point in space moved by a vector', rule: R.pointPlusVector },
  ]),
  cmd('Segment', [{ params: [p('a', 'Point3'), p('b', 'Point3')], returns: 'Segment3', summary: 'segment in space', rule: R.segment }]),
  cmd('Line', [
    { params: [p('a', 'Point3'), p('b', 'Point3')], returns: 'Line3', summary: 'line in space through two points', rule: R.linePQ },
    { params: [p('a', 'Point3'), p('direction', 'Vector3')], returns: 'Line3', summary: 'line in space through a point along a vector', rule: R.lineDir },
  ]),
  cmd('Ray', [
    { params: [p('start', 'Point3'), p('through', 'Point3')], returns: 'Ray3', summary: 'ray in space through a point', rule: R.rayPQ },
    { params: [p('start', 'Point3'), p('direction', 'Vector3')], returns: 'Ray3', summary: 'ray in space along a vector', rule: R.rayDir },
  ]),
  cmd('Midpoint', [
    { params: [p('a', 'Point3'), p('b', 'Point3')], returns: 'Point3', summary: 'midpoint of two points in space', rule: R.midpointPP },
    { params: [p('s', 'Segment3')], returns: 'Point3', summary: 'midpoint of a segment in space', rule: R.midpointSeg },
  ]),
  cmd('Plane', [
    { params: [p('a', 'Point3'), p('b', 'Point3'), p('c', 'Point3')], returns: 'Plane', summary: 'plane through three points', rule: R.planePQR },
    { params: [p('point', 'Point3'), p('normal', 'Vector3')], returns: 'Plane', summary: 'plane through a point with a normal vector', rule: R.planePN },
    { params: [p('point', 'Point3'), p('line', LL)], returns: 'Plane', summary: 'plane through a point and a line', rule: R.planePL },
    { params: [p('polygon', 'Polygon3')], returns: 'Plane', summary: 'plane of a flat polygon', rule: R.planeOfPolygon },
  ]),
  cmd('Polygon', [
    { params: [p('p1', 'Point3'), p('p2', 'Point3'), p('p3', 'Point3')], rest: p('rest', 'Point3'), returns: 'Polygon3', summary: 'flat polygon through points in space', rule: R.polygonPts },
    { params: [p('points', 'List<Point3>')], returns: 'Polygon3', summary: 'flat polygon from a list of points in space', rule: R.polygonList },
  ]),
  cmd('Dot', [{ params: [p('u', 'Vector3'), p('v', 'Vector3')], returns: 'Number', summary: 'dot product of vectors in space', rule: R.dotRule }]),
  cmd('Cross', [{ params: [p('u', 'Vector3'), p('v', 'Vector3')], returns: 'Vector3', summary: 'cross product of vectors in space', rule: R.crossRule }]),
  cmd('UnitVector', [{ params: [p('v', 'Vector3')], returns: 'Vector3', summary: 'unit vector in space', rule: R.unitVector }]),
  cmd('Direction', [{ params: [p('l', LL)], returns: 'Vector3', summary: 'unit direction of a line in space', rule: R.directionRule }]),
  cmd('Normal', [
    { params: [p('plane', 'Plane')], returns: 'Vector3', summary: 'unit normal of a plane', rule: R.normalRule },
    { params: [p('polygon', 'Polygon3')], returns: 'Vector3', summary: 'unit normal of a flat polygon', rule: R.normalRule },
  ]),
  cmd('Distance', [
    { params: [p('a', 'Point3'), p('b', 'Point3')], returns: 'Number', summary: 'distance between points in space', rule: R.distancePP },
    { params: [p('a', 'Point3'), p('l', LL)], returns: 'Number', summary: 'distance from a point to a line in space', rule: R.distancePL },
    { params: [p('a', 'Point3'), p('plane', 'Plane')], returns: 'Number', summary: 'distance from a point to a plane', rule: R.distancePPlane },
    { params: [p('l', LL), p('m', LL)], returns: 'Number', summary: 'shortest distance between two lines in space', rule: R.distanceLL },
    { params: [p('l', LL), p('plane', 'Plane')], returns: 'Number', summary: 'distance from a line to a plane (0 when they meet)', rule: R.distanceLPlane },
    { params: [p('a', 'Plane'), p('b', 'Plane')], returns: 'Number', summary: 'distance between planes (0 when they meet)', rule: R.distancePlanePlane },
  ]),
  cmd('Angle', [
    { params: [p('u', 'Vector3'), p('v', 'Vector3')], returns: 'Number', summary: 'angle between vectors in space', rule: R.angleVV, unit: 'angle' },
    { params: [p('a', 'Point3'), p('vertex', 'Point3'), p('c', 'Point3')], returns: 'Number', summary: 'angle at the middle point, in space', rule: R.anglePVQ, unit: 'angle' },
    { params: [p('l', LL), p('m', LL)], returns: 'Number', summary: 'angle between lines in space', rule: R.angleLL, unit: 'angle' },
    { params: [p('l', LL), p('plane', 'Plane')], returns: 'Number', summary: 'angle between a line and a plane', rule: R.angleLPlane, unit: 'angle' },
    { params: [p('a', 'Plane'), p('b', 'Plane')], returns: 'Number', summary: 'angle between planes', rule: R.anglePlanePlane, unit: 'angle' },
  ]),
  cmd('Length', [
    { params: [p('v', 'Vector3')], returns: 'Number', summary: 'length of a vector in space', rule: R.lengthVector },
    { params: [p('s', 'Segment3')], returns: 'Number', summary: 'length of a segment in space', rule: R.lengthSegment },
  ]),
  cmd('Area', [{ params: [p('polygon', 'Polygon3')], returns: 'Number', summary: 'area of a flat polygon in space', rule: R.areaPolygon }]),
  cmd('Intersect', [
    { params: [p('l', LL), p('m', LL)], returns: 'Point3', summary: 'meeting point of two lines in space', rule: R.intersectLL },
    { params: [p('l', LL), p('plane', 'Plane')], returns: 'Point3', summary: 'where a line meets a plane', rule: R.intersectLPlane },
    { params: [p('plane', 'Plane'), p('l', LL)], returns: 'Point3', summary: 'where a plane meets a line', rule: R.intersectLPlane },
    { params: [p('a', 'Plane'), p('b', 'Plane')], returns: 'Line3', summary: 'line where two planes meet', rule: R.intersectPlanePlane },
    { params: [p('l', LL), p('polygon', 'Polygon3')], returns: 'Point3', summary: 'where a line meets a flat polygon', rule: R.intersectLPolygon },
  ]),
];

/* ------------------------------ operators, fields, texts ------------------------------ */

const P3: Ty = { k: 'Point3' };
const V3T: Ty = { k: 'Vector3' };

/** `(x, y, z)` with three Numbers is a point in space (design 15.2). */
function tupleRow(items: readonly Ty[]): { result: Ty; impl: (v: readonly unknown[]) => unknown } | undefined {
  if (items.length !== 3 || !items.every((t) => t.k === 'Number')) return undefined;
  return { result: P3, impl: (v) => ({ x: v[0] as number, y: v[1] as number, z: v[2] as number }) };
}

type Bin = { result: Ty; impl: (a: unknown, b: unknown) => unknown };

function binaryRow(op: string, l: Ty, r: Ty): Bin | undefined {
  const A = l.k;
  const B = r.k;
  const v = (f: (a: V3, b: V3) => V3, result: Ty): Bin => ({ result, impl: (a, b) => f(a as V3, b as V3) });
  if (op === '+' && A === 'Point3' && B === 'Vector3') return v(add, P3);
  if (op === '-' && A === 'Point3' && B === 'Vector3') return v(sub, P3);
  if (op === '-' && A === 'Point3' && B === 'Point3') return v(sub, V3T);
  if (op === '+' && A === 'Vector3' && B === 'Vector3') return v(add, V3T);
  if (op === '-' && A === 'Vector3' && B === 'Vector3') return v(sub, V3T);
  if (op === '*' && A === 'Number' && B === 'Vector3') return { result: V3T, impl: (a, b) => scale(b as V3, a as number) };
  if (op === '*' && A === 'Vector3' && B === 'Number') return { result: V3T, impl: (a, b) => scale(a as V3, b as number) };
  if (op === '/' && A === 'Vector3' && B === 'Number') return { result: V3T, impl: (a, b) => scale(a as V3, 1 / (b as number)) };
  return undefined;
}

function unaryRow(op: string, a: Ty): { result: Ty; impl: (a: unknown) => unknown } | undefined {
  if (op === '-' && a.k === 'Vector3') return { result: V3T, impl: (x) => scale(x as V3, -1) };
  return undefined;
}

const f6 = (x: number): string => formatNumber(x);
const pt = (q: V3): string => `(${f6(q.x)}, ${f6(q.y)}, ${f6(q.z)})`;

/** Row text of a value of the area (`plane 2x + 3y − z = 4`, `polygon of 4 points, area 6`). */
export function spaceText(v: unknown): string | undefined {
  if (isV3(v)) return pt(v);
  switch (shape3Of(v)) {
    case 'Line3': {
      const l = v as { o: V3; d: V3 };
      return `line through ${pt(l.o)} along ${pt(l.d)}`;
    }
    case 'Ray3': {
      const l = v as { o: V3; d: V3 };
      return `ray from ${pt(l.o)} along ${pt(l.d)}`;
    }
    case 'Segment3': {
      const s = v as Segment3;
      return `segment length ${f6(len(sub(s.b, s.a)))}`;
    }
    case 'Plane': {
      const pl = v as Plane3;
      const terms: string[] = [];
      for (const [k, c] of [['x', pl.n.x], ['y', pl.n.y], ['z', pl.n.z]] as const) {
        if (Math.abs(c) < 1e-12) continue;
        const a = f6(Math.abs(c));
        terms.push(`${terms.length === 0 ? (c < 0 ? '−' : '') : c < 0 ? ' − ' : ' + '}${a === '1' ? '' : a}${k}`);
      }
      return `plane ${terms.join('')} = ${f6(Math.abs(pl.c) < 1e-12 ? 0 : pl.c)}`;
    }
    case 'Polygon3': {
      const g = v as Polygon3;
      return `polygon of ${g.pts.length} points, area ${f6(len(R.newell(g.pts)) / 2)}`;
    }
    default:
      return undefined;
  }
}

let registered = false;

/** Registers the area's commands into the registry, and its language rows once. */
export function registerSpace(registry: CommandRegistry): void {
  registry.registerAll(SPACE_COMMANDS);
  if (registered) return;
  registered = true;
  registerTypeAlias(LL, ['Line3', 'Segment3', 'Ray3']);
  registerTupleType(tupleRow);
  registerBinaryOp(binaryRow);
  registerUnaryOp(unaryRow);
  for (const type of ['Point3', 'Vector3'] as const) {
    const fields = type === 'Point3' ? ['x', 'y', 'z'] : ['x', 'y', 'z', 'length'];
    registerFieldNames(type, () => fields);
    registerFieldTyper(type, (field) => (fields.includes(field) ? T.Number : undefined));
    registerFieldReader(type, (field, value) => {
      if (!isV3(value)) return undefined;
      if (field === 'length') return len(value);
      return field === 'x' || field === 'y' || field === 'z' ? value[field] : undefined;
    });
  }
  registerFreeType('Point3', {
    source: (v) => (isV3(v) ? `(${numberSource(v.x)}, ${numberSource(v.y)}, ${numberSource(v.z)})` : undefined),
    fits: (v) => isV3(v) && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
    own: (v) => (isV3(v) ? { x: v.x, y: v.y, z: v.z } : v),
  });
  registerValueText((v) => spaceText(v));
  // the look of ui.md 7: points dark blue, lines dark gray, planes light blue and faint, polygons pastel
  registerTypeStyle('Point3', { defaults: { color: '#1f4fa3', pointSize: 4, label: 'name' }, freeDefaults: { pointSize: 5 } });
  registerTypeStyle('Vector3', { defaults: { color: '#3d4451', width: 2, label: 'none' } });
  for (const t of ['Line3', 'Segment3', 'Ray3']) registerTypeStyle(t, { defaults: { color: '#3d4451', width: 2, label: 'none' } });
  registerTypeStyle('Plane', { defaults: { color: '#7fa7e0', opacity: 0.25, label: 'none' } });
  registerTypeStyle('Polygon3', { defaults: { color: '#e9a23b', opacity: 0.4, width: 2, label: 'none' } });
  registerReasonPhrase('skew', { noun: 'skew lines', sentence: 'The lines are skew: they pass each other without meeting.' });
  registerReasonPhrase('not_coplanar', { noun: 'not flat', sentence: 'The points are not on one plane, so they make no flat polygon.' });
  registerReasonPhrase('not_closed', { noun: 'not closed', sentence: 'The solid has a hole, so it has no volume.' });
}
