/**
 * Joints and measures (docs/features/physics/design.md 2.4, 2.5; .kiro/specs/physics R3): `Hinge`, `Spring`, `Rope`,
 * `Rod`, `Weld`, `Slider`, `Pulley`, `Grab`, and `Energy`, `Momentum`, `KineticEnergy`, `PotentialEnergy`, `Forces`.
 * A joint's value is its start (what it links and where); the driver builds it into the world and writes its force,
 * length and angle after each pass.
 */
import type { ObjId } from '../../contracts/values';
import type { RuleCall } from '../../graph/registry';
import type { CallCheck, CommandForm, CommandSpec, FormCheck, ParamSpec, Refusal } from '../../language/table';
import type { BodySpec3 } from './body3';
import { isBody3Value } from './body3';
import { FORCE_KINDS } from '../../physics/world2';
import type { BodySpec, BodyValue, WorldValue } from './types';
import { isBodyValue, isWorldValue } from './types';

export type JointKind = 'hinge' | 'spring' | 'rope' | 'rod' | 'weld' | 'slider' | 'pulley' | 'grab';

/** One end of a joint: an object by id, or a body of a list by its start. */
export interface JointEnd {
  readonly id?: ObjId;
  readonly spec?: BodySpec;
  /** A point of the end at the start (its centre of mass for a body). */
  readonly x: number;
  readonly y: number;
  readonly body: boolean;
}

export interface JointValue {
  readonly schema: 'Joint';
  readonly kind: JointKind;
  readonly a: JointEnd;
  readonly b: JointEnd;
  /** Anchors at the start, world space. */
  readonly pa: { readonly x: number; readonly y: number };
  readonly pb: { readonly x: number; readonly y: number };
  readonly length?: number;
  readonly k?: number;
  readonly rest?: number;
  readonly damping?: number;
  readonly motor?: number;
  readonly torque?: number;
  readonly min?: number;
  readonly max?: number;
  readonly breaks?: number;
  readonly axis?: { readonly x: number; readonly y: number };
  readonly ga?: { readonly x: number; readonly y: number };
  readonly gb?: { readonly x: number; readonly y: number };
  readonly ratio?: number;
  readonly target?: { readonly x: number; readonly y: number };
  /** Written by the driver. */
  readonly force: number;
  readonly lengthNow: number;
  readonly angleNow: number;
  readonly broken: boolean;
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
}

export function isJointValue(v: unknown): v is JointValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Joint';
}

const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const named = (name: string, type: string): ParamSpec => P(name, type, { optional: true, named: true });
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** A named number when it is one, for spreading into a joint value. */
const opt = (k: string, v: unknown): Partial<JointValue> => {
  const n = num(v);
  return (n === undefined ? {} : { [k]: n }) as Partial<JointValue>;
};
const pt = (v: unknown): { x: number; y: number } | undefined => {
  const p = v as { x?: unknown; y?: unknown } | undefined;
  return p && typeof p.x === 'number' && typeof p.y === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : undefined;
};

/** A point inside a shape value, for a joint end that is a solid shape with no anchor given. */
function centreOf(v: unknown): { x: number; y: number } | undefined {
  const o = v as Record<string, unknown>;
  if (!o || typeof o !== 'object') return undefined;
  if (typeof o['cx'] === 'number' && typeof o['cy'] === 'number') return { x: o['cx'] as number, y: o['cy'] as number };
  if (Array.isArray(o['pts'])) {
    const pts = o['pts'] as { x: number; y: number }[];
    let x = 0;
    let y = 0;
    for (const p of pts) {
      x += p.x;
      y += p.y;
    }
    return pts.length > 0 ? { x: x / pts.length, y: y / pts.length } : undefined;
  }
  const a = pt(o['a']);
  const b = pt(o['b']);
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const p = pt(o['p']);
  return p ?? pt(o['from']);
}

function endOf(call: RuleCall, k: number): JointEnd | undefined {
  const v = call.values[k];
  const id = call.ids[k];
  if (isBodyValue(v)) return { ...(id !== undefined ? { id } : {}), spec: v.spec, x: v.spec.cx, y: v.spec.cy, body: true };
  const c = centreOf(v);
  if (!c) return undefined;
  return { ...(id !== undefined ? { id } : {}), x: c.x, y: c.y, body: false };
}

function jointValue(kind: JointKind, a: JointEnd, b: JointEnd, pa: { x: number; y: number }, pb: { x: number; y: number }, extra: Partial<JointValue>): JointValue {
  const len = Math.sqrt((pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2);
  return { schema: 'Joint', kind, a, b, pa, pb, force: 0, lengthNow: len, angleNow: 0, broken: false, ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, ...extra };
}

function sameEnd(a: JointEnd, b: JointEnd): boolean {
  return (a.id !== undefined && a.id === b.id) || (a.spec !== undefined && a.spec === b.spec);
}

/** Both ends present and different; a reason otherwise. */
function ends(call: RuleCall): { a: JointEnd; b: JointEnd } | undefined {
  const a = endOf(call, 0);
  const b = endOf(call, 1);
  if (!a || !b) return call.fail('input_undefined', 'an end of the joint is undefined') as undefined;
  if (sameEnd(a, b)) return call.fail('degenerate', 'a joint links two different bodies') as undefined;
  if (!a.body && !b.body) return call.fail('degenerate', 'at least one end must be a body') as undefined;
  return { a, b };
}

const rule = (run: (call: RuleCall) => unknown): (() => { run(call: RuleCall): unknown }) => () => ({ run });

const END = 'Body|Polygon|Circle|Conic|Segment|Line|Ray|Polyline|Point';

/** `Hinge(a, a, P)`: the same body twice (errors B009). */
function checkSame(c: FormCheck): Refusal | undefined {
  const a = c.args[0];
  const b = c.args[1];
  if (a && b && !a.omitted && !b.omitted && a.text === b.text && /^[A-Za-z]\w*$/.test(a.text)) {
    return { kind: 'same_body', message: `${c.command}(${a.text}, ${b.text}, …) links ${a.text} to itself.`, hint: 'A joint links two different bodies, or a body and a solid shape.', param: 1, params: { why: 'both ends are the same' } };
  }
  return undefined;
}

/** A joint end that is not a body nor a shape (a number, a text) (errors B008). */
function refuseEnds(c: CallCheck): Refusal | undefined {
  const mixed = mixedRefusal(c.command, c, [0, 1, 2, 3]);
  if (mixed) return mixed;
  for (let k = 0; k < 2; k++) {
    const a = c.args[k];
    if (!a || a.omitted) continue;
    if (/^(Number|Text|Bool|List|Function)/.test(a.type)) {
      return {
        kind: 'not_a_body', message: `${c.command}: ${a.text} is a ${a.type.replace(/<.*$/, '').toLowerCase()}, not a body or a solid shape.`, param: k,
        hint: 'Link two bodies, or a body and a solid shape: b = Body(p, mass = 1), wall with solid = true.', params: { why: `${a.text} is not a body` },
      };
    }
  }
  return undefined;
}

const spec = (name: string, forms: readonly { params: readonly ParamSpec[]; summary: string; run: (call: RuleCall) => unknown }[], space: readonly CommandForm[] = []): CommandSpec => ({
  name,
  kind: 'object',
  group: 'physics',
  forms: [...forms.map((f) => ({ params: f.params, returns: 'Joint', rule: rule(f.run), summary: f.summary, check: checkSame })), ...space],
  refuse: refuseEnds,
});

function anchors(call: RuleCall, e: { a: JointEnd; b: JointEnd }, ia: number, ib: number): { pa: { x: number; y: number }; pb: { x: number; y: number } } {
  return { pa: pt(call.values[ia]) ?? { x: e.a.x, y: e.a.y }, pb: pt(call.values[ib]) ?? { x: e.b.x, y: e.b.y } };
}

/* ------------------------------ joints in space ------------------------------ */

type P3v = { readonly x: number; readonly y: number; readonly z: number };

/** One end of a joint in space: a body by its start, or a solid by id. */
export interface JointEnd3 {
  readonly id?: ObjId;
  readonly spec?: BodySpec3;
  /** A point of the end at the start (its centre of mass for a body). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly body: boolean;
}

/** A joint in space: its start (what it links, where, about which axis) and, written by the driver, what it does now. */
export interface JointValue3 {
  readonly schema: 'Joint';
  readonly space: true;
  readonly kind: JointKind;
  readonly a: JointEnd3;
  readonly b: JointEnd3;
  readonly pa: P3v;
  readonly pb: P3v;
  readonly axis?: P3v;
  readonly length?: number;
  readonly k?: number;
  readonly rest?: number;
  readonly damping?: number;
  readonly motor?: number;
  readonly torque?: number;
  readonly min?: number;
  readonly max?: number;
  readonly breaks?: number;
  readonly force: number;
  readonly lengthNow: number;
  readonly angleNow: number;
  readonly broken: boolean;
  /** The two anchors now. */
  readonly ax: number;
  readonly ay: number;
  readonly az: number;
  readonly bx: number;
  readonly by: number;
  readonly bz: number;
}

export function isJoint3Value(v: unknown): v is JointValue3 {
  return isJointValue(v) && (v as { space?: unknown }).space === true;
}

const pt3 = (v: unknown): P3v | undefined => {
  const p = v as { x?: unknown; y?: unknown; z?: unknown } | undefined;
  return p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? { x: p.x, y: p.y, z: p.z } : undefined;
};

/** A point inside a solid value: a sphere's centre, the middle of a cylinder's axis, the mean of a polyhedron's corners. */
function centre3(v: unknown): P3v | undefined {
  const o = v as Record<string, unknown> | undefined;
  if (!o || typeof o !== 'object') return undefined;
  const c = pt3(o['c']);
  if (c && typeof o['r'] === 'number') return c;
  const a = pt3(o['a']);
  const b = pt3(o['b']);
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  if (Array.isArray(o['verts'])) {
    const vs = o['verts'] as P3v[];
    let x = 0;
    let y = 0;
    let z = 0;
    for (const p of vs) {
      x += p.x;
      y += p.y;
      z += p.z;
    }
    return vs.length > 0 ? { x: x / vs.length, y: y / vs.length, z: z / vs.length } : undefined;
  }
  // a plane n · p = c: its point nearest the origin
  const n = pt3(o['n']);
  if (n && typeof o['c'] === 'number') return { x: n.x * o['c'], y: n.y * o['c'], z: n.z * o['c'] };
  return undefined;
}

function endOf3(call: RuleCall, k: number): JointEnd3 | undefined {
  const v = call.values[k];
  const id = call.ids[k];
  if (isBody3Value(v)) return { ...(id !== undefined ? { id } : {}), spec: v.spec, x: v.spec.cx, y: v.spec.cy, z: v.spec.cz, body: true };
  const c = centre3(v);
  if (!c) return undefined;
  return { ...(id !== undefined ? { id } : {}), ...c, body: false };
}

function ends3(call: RuleCall): { a: JointEnd3; b: JointEnd3 } | undefined {
  const a = endOf3(call, 0);
  const b = endOf3(call, 1);
  if (!a || !b) return call.fail('input_undefined', 'an end of the joint is undefined') as undefined;
  if ((a.id !== undefined && a.id === b.id) || (a.spec !== undefined && a.spec === b.spec)) return call.fail('degenerate', 'a joint links two different bodies') as undefined;
  if (!a.body && !b.body) return call.fail('degenerate', 'at least one end must be a body') as undefined;
  return { a, b };
}

function jointValue3(kind: JointKind, a: JointEnd3, b: JointEnd3, pa: P3v, pb: P3v, extra: Partial<JointValue3>): JointValue3 {
  const len = Math.sqrt((pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2 + (pb.z - pa.z) ** 2);
  return { schema: 'Joint', space: true, kind, a, b, pa, pb, force: 0, lengthNow: len, angleNow: 0, broken: false, ax: pa.x, ay: pa.y, az: pa.z, bx: pb.x, by: pb.y, bz: pb.z, ...extra };
}

const opt3 = (k: string, v: unknown): Partial<JointValue3> => {
  const n = num(v);
  return (n === undefined ? {} : { [k]: n }) as Partial<JointValue3>;
};

const END3 = 'Body3|Polyhedron|Sphere|Cylinder|Cone|Plane';
const AXIS3 = 'Vector3|Point3';

const form3 = (params: readonly ParamSpec[], summary: string, run: (call: RuleCall) => unknown): CommandForm => ({ params, returns: 'Joint', rule: rule(run), summary, check: checkSame });

function anchors3(call: RuleCall, e: { a: JointEnd3; b: JointEnd3 }, ia: number, ib: number): { pa: P3v; pb: P3v } {
  return { pa: pt3(call.values[ia]) ?? { x: e.a.x, y: e.a.y, z: e.a.z }, pb: pt3(call.values[ib]) ?? { x: e.b.x, y: e.b.y, z: e.b.z } };
}

const HINGE3 = form3([P('a', END3), P('b', END3), P('at', 'Point3'), P('axis', AXIS3), named('motor', 'Number'), named('torque', 'Number'), named('min', 'Number'), named('max', 'Number')], 'a and b turn about a shared point and axis in space: a door, a lid, an axle', (call) => {
  const e = ends3(call);
  const at = pt3(call.values[2]);
  const ax = pt3(call.values[3]);
  if (!e || !at || !ax) return e ? call.fail('input_undefined', 'the hinge point or axis is undefined') : undefined;
  if (ax.x === 0 && ax.y === 0 && ax.z === 0) return call.fail('degenerate', 'the axis has no direction');
  const [, , , , motor, torque, min, max] = call.values;
  return jointValue3('hinge', e.a, e.b, at, at, { axis: ax, ...opt3('motor', motor), ...opt3('torque', torque), ...opt3('min', min), ...opt3('max', max) });
});

const SPRING3 = form3([P('a', END3), P('b', END3), P('k', 'Number', { optional: true }), P('rest', 'Number', { optional: true }), named('damping', 'Number'), named('pa', 'Point3'), named('pb', 'Point3')], 'a spring of stiffness k (N/m) between a and b in space', (call) => {
  const e = ends3(call);
  if (!e) return undefined;
  const { pa, pb } = anchors3(call, e, 5, 6);
  const k = num(call.values[2]) ?? 50;
  if (!(k > 0)) return call.fail('degenerate', 'a spring needs a stiffness above 0');
  const rest = num(call.values[3]) ?? Math.sqrt((pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2 + (pb.z - pa.z) ** 2);
  return jointValue3('spring', e.a, e.b, pa, pb, { k, rest: Math.max(0, rest), damping: Math.max(0, num(call.values[4]) ?? 0) });
});

const ROPE3 = form3([P('a', END3), P('b', END3), P('length', 'Number'), named('pa', 'Point3'), named('pb', 'Point3')], 'a and b in space can be at most length apart', (call) => {
  const e = ends3(call);
  if (!e) return undefined;
  const L = num(call.values[2]);
  if (L === undefined || !(L > 0)) return call.fail('degenerate', 'a rope needs a length above 0');
  const { pa, pb } = anchors3(call, e, 3, 4);
  return jointValue3('rope', e.a, e.b, pa, pb, { length: L });
});

const ROD3 = form3([P('a', END3), P('b', END3), named('pa', 'Point3'), named('pb', 'Point3')], 'a and b in space stay the same distance apart', (call) => {
  const e = ends3(call);
  if (!e) return undefined;
  const { pa, pb } = anchors3(call, e, 2, 3);
  return jointValue3('rod', e.a, e.b, pa, pb, { length: Math.sqrt((pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2 + (pb.z - pa.z) ** 2) });
});

const WELD3 = form3([P('a', END3), P('b', END3), named('breaks', 'Number')], 'a and b in space move as one; it breaks above breaks newtons', (call) => {
  const e = ends3(call);
  if (!e) return undefined;
  const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2, z: (e.a.z + e.b.z) / 2 };
  const br = num(call.values[2]);
  return jointValue3('weld', e.a, e.b, mid, mid, br !== undefined && br > 0 ? { breaks: br } : {});
});

const SLIDER3 = form3([P('a', END3), P('b', END3), P('axis', AXIS3), named('min', 'Number'), named('max', 'Number'), named('motor', 'Number'), named('force', 'Number')], 'b slides along a line fixed in a, in space: a piston', (call) => {
  const e = ends3(call);
  const ax = pt3(call.values[2]);
  if (!e || !ax) return e ? call.fail('input_undefined', 'the axis is undefined') : undefined;
  if (ax.x === 0 && ax.y === 0 && ax.z === 0) return call.fail('degenerate', 'the axis has no direction');
  const [, , , min, max, motor, force] = call.values;
  const at = { x: e.b.x, y: e.b.y, z: e.b.z };
  return jointValue3('slider', e.a, e.b, at, at, { axis: ax, ...opt3('min', min), ...opt3('max', max), ...opt3('motor', motor), ...opt3('torque', force) });
});

/* ------------------------------ a flat end and an end in space (errors B010) ------------------------------ */

const FLAT_ENDS = /^(Body|Polygon|Circle|Conic|Segment|Line|Ray|Polyline|Point|Vector)$/;
const SPACE_ENDS = /^(Body3|Polyhedron|Sphere|Cylinder|Cone|Plane|Point3|Vector3)$/;

/** Two of the arguments at `which` are one flat and one in space: the line mixes the plane and space. */
export function mixedRefusal(command: string, c: CallCheck, which: readonly number[]): Refusal | undefined {
  let flat = -1;
  let deep = -1;
  for (const k of which) {
    const a = c.args[k];
    if (!a || a.omitted) continue;
    const t = a.type.replace(/<.*$/, '');
    if (FLAT_ENDS.test(t) && flat < 0) flat = k;
    if (SPACE_ENDS.test(t) && deep < 0) deep = k;
  }
  if (flat < 0 || deep < 0) return undefined;
  const a = c.args[flat] as CallCheck['args'][number];
  const b = c.args[deep] as CallCheck['args'][number];
  const why = `${command}: ${a.text} is a flat ${a.type} but ${b.text} is a ${b.type} in space.`;
  return {
    kind: 'mixed_dimension',
    message: `${command}(${c.args.filter((x) => !x.omitted).map((x) => x.text).join(', ')}): ${a.text} is in the plane but ${b.text} is in space.`,
    hint: a.type === 'Body' ? `A joint links two bodies of one world. Make ${a.text} from a solid, such as Body(Sphere((0, 0, 1), 0.5)).` : `Use the form of ${a.text} in space, with points of three numbers.`,
    param: flat,
    params: { why },
  };
}

export const JOINT_COMMANDS: readonly CommandSpec[] = [
  spec('Hinge', [{
    params: [P('a', END), P('b', END), P('at', 'Point'), named('motor', 'Number'), named('torque', 'Number'), named('min', 'Number'), named('max', 'Number')],
    summary: 'a and b turn about a shared point: a door, a see-saw, an arm',
    run: (call) => {
      const e = ends(call);
      const at = pt(call.values[2]);
      if (!e || !at) return e ? call.fail('input_undefined', 'the hinge point is undefined') : undefined;
      const [, , , motor, torque, min, max] = call.values;
      return jointValue('hinge', e.a, e.b, at, at, {
        ...opt('motor', motor), ...opt('torque', torque),
        ...opt('min', min), ...opt('max', max),
      });
    },
  }], [HINGE3]),
  spec('Spring', [{
    params: [P('a', END), P('b', END), P('k', 'Number', { optional: true }), P('rest', 'Number', { optional: true }), named('damping', 'Number'), named('pa', 'Point'), named('pb', 'Point')],
    summary: 'a spring of stiffness k (N/m) between a and b',
    run: (call) => {
      const e = ends(call);
      if (!e) return undefined;
      const { pa, pb } = anchors(call, e, 5, 6);
      const k = num(call.values[2]) ?? 50;
      if (!(k > 0)) return call.fail('degenerate', 'a spring needs a stiffness above 0');
      const rest = num(call.values[3]) ?? Math.sqrt((pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2);
      return jointValue('spring', e.a, e.b, pa, pb, { k, rest: Math.max(0, rest), damping: Math.max(0, num(call.values[4]) ?? 0) });
    },
  }], [SPRING3]),
  spec('Rope', [{
    params: [P('a', END), P('b', END), P('length', 'Number'), named('pa', 'Point'), named('pb', 'Point')],
    summary: 'a and b can be at most length apart',
    run: (call) => {
      const e = ends(call);
      if (!e) return undefined;
      const L = num(call.values[2]);
      if (L === undefined || !(L > 0)) return call.fail('degenerate', 'a rope needs a length above 0');
      const { pa, pb } = anchors(call, e, 3, 4);
      return jointValue('rope', e.a, e.b, pa, pb, { length: L });
    },
  }], [ROPE3]),
  spec('Rod', [{
    params: [P('a', END), P('b', END), named('pa', 'Point'), named('pb', 'Point')],
    summary: 'a and b stay the same distance apart',
    run: (call) => {
      const e = ends(call);
      if (!e) return undefined;
      const { pa, pb } = anchors(call, e, 2, 3);
      return jointValue('rod', e.a, e.b, pa, pb, { length: Math.sqrt((pb.x - pa.x) ** 2 + (pb.y - pa.y) ** 2) });
    },
  }], [ROD3]),
  spec('Weld', [{
    params: [P('a', END), P('b', END), named('breaks', 'Number')],
    summary: 'a and b move as one; it breaks above breaks newtons',
    run: (call) => {
      const e = ends(call);
      if (!e) return undefined;
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      const br = num(call.values[2]);
      return jointValue('weld', e.a, e.b, mid, mid, br !== undefined && br > 0 ? { breaks: br } : {});
    },
  }], [WELD3]),
  spec('Slider', [{
    params: [P('a', END), P('b', END), P('axis', 'Vector|Point'), named('min', 'Number'), named('max', 'Number'), named('motor', 'Number'), named('force', 'Number')],
    summary: 'b slides along a line fixed in a: a piston',
    run: (call) => {
      const e = ends(call);
      const ax = pt(call.values[2]);
      if (!e || !ax) return e ? call.fail('input_undefined', 'the axis is undefined') : undefined;
      if (ax.x === 0 && ax.y === 0) return call.fail('degenerate', 'the axis has no direction');
      const [, , , min, max, motor, force] = call.values;
      return jointValue('slider', e.a, e.b, { x: e.b.x, y: e.b.y }, { x: e.b.x, y: e.b.y }, {
        axis: ax, ...opt('min', min), ...opt('max', max),
        ...opt('motor', motor), ...opt('torque', force),
      });
    },
  }], [SLIDER3]),
  spec('Pulley', [{
    params: [P('a', END), P('b', END), P('P', 'Point'), P('Q', 'Point'), P('ratio', 'Number', { optional: true })],
    summary: 'a rope over two fixed points P and Q between a and b',
    run: (call) => {
      const e = ends(call);
      const ga = pt(call.values[2]);
      const gb = pt(call.values[3]);
      if (!e || !ga || !gb) return e ? call.fail('input_undefined', 'a pulley point is undefined') : undefined;
      const ratio = num(call.values[4]) ?? 1;
      if (!(ratio > 0)) return call.fail('degenerate', 'the ratio must be above 0');
      return jointValue('pulley', e.a, e.b, { x: e.a.x, y: e.a.y }, { x: e.b.x, y: e.b.y }, { ga, gb, ratio });
    },
  }]),
  {
    name: 'Grab',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('b', 'Body'), P('target', 'Point')],
      returns: 'Joint',
      summary: 'a stiff spring that pulls b toward a moving point',
      rule: rule((call) => {
        const v = call.values[0];
        const t = pt(call.values[1]);
        if (!isBodyValue(v) || !t) return call.fail('input_undefined', 'the body or the target is undefined');
        const id = call.ids[0];
        const b: JointEnd = { ...(id !== undefined ? { id } : {}), spec: v.spec, x: v.spec.cx, y: v.spec.cy, body: true };
        return jointValue('grab', b, b, { x: v.spec.cx, y: v.spec.cy }, { x: v.spec.cx, y: v.spec.cy }, { target: t });
      }),
    }],
  },
];

/* ------------------------------ measures ------------------------------ */

const measure = (name: string, returns: string, summary: string, f: (v: BodyValue | WorldValue) => unknown): CommandSpec => ({
  name,
  kind: 'object',
  group: 'physics',
  forms: [{
    params: [P('of', 'Body|World')],
    returns,
    summary,
    rule: rule((call) => {
      const v = call.values[0];
      if (!isBodyValue(v) && !isWorldValue(v)) return call.fail('input_undefined', 'it is not a body or the world');
      return f(v);
    }),
  }],
});

export const MEASURE_COMMANDS: readonly CommandSpec[] = [
  measure('Energy', 'Number', 'kinetic plus potential (plus spring) energy, J', (v) => v.energy),
  measure('KineticEnergy', 'Number', 'energy of motion, J', (v) => (isBodyValue(v) ? v.kinetic : (v as WorldValue & { kinetic?: number }).kinetic ?? 0)),
  measure('PotentialEnergy', 'Number', 'energy of height (and springs), J', (v) => (isBodyValue(v) ? v.potential : v.energy - ((v as WorldValue & { kinetic?: number }).kinetic ?? 0))),
  measure('Momentum', 'Vector', 'mass times speed, N s', (v) => (isBodyValue(v) ? (Number.isFinite(v.mass) ? { x: v.mass * v.vx, y: v.mass * v.vy } : { x: 0, y: 0 }) : { x: v.momentumX, y: v.momentumY })),
  {
    name: 'Forces',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('b', 'Body')],
      returns: 'List<Vector>',
      summary: 'the forces that acted on b in the last step, one per kind that acted (gravity, normal, friction, …)',
      rule: rule((call) => {
        const v = call.values[0];
        if (!isBodyValue(v)) return call.fail('input_undefined', 'it is not a body');
        const out: { x: number; y: number }[] = [];
        const f = v.forces;
        if (!f) return out;
        for (let k = 0; k < FORCE_KINDS.length - 1; k++) {
          const x = f[k * 2] as number;
          const y = f[k * 2 + 1] as number;
          if (Math.abs(x) + Math.abs(y) > 1e-9) out.push({ x, y });
        }
        return out;
      }),
    }],
  },
];
