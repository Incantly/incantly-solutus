/**
 * The physics area, kernel side (docs/features/physics; .kiro/specs/physics R1, R2, R8): `Body`, `Bodies`, `Box`,
 * `Ground`, the reserved `world` object, `with solid = true` on any flat shape, body readouts, the actions `Push`,
 * `Wake` and `Sleep`, the line checks, and the per-figure driver that steps the world.
 *
 * Plug in with `registerPhysics(registry)`.
 */
import type { ErrorObject } from '../../contracts/errors';
import type { ObjId } from '../../contracts/values';
import { err } from '../../errors/table';
import { registerNotice } from '../../errors/notices';
import { registerReasonPhrase } from '../../errors/phrases';
import { registerWorldDriver } from '../../graph/drivers';
import type { Figure } from '../../graph/figure';
import { registerPropertyTypes, registerTypeStyle } from '../../graph/props';
import type { ActionCall, ActionOutcome, CommandRegistry, LineRewrite, RuleCall } from '../../graph/registry';
import { registerLineCheck, registerLineRewriter, registerScriptTail } from '../../graph/registry';
import type { CheckedLine } from '../../language/check';
import { registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { PROPERTIES } from '../../language/props';
import type { PropSpec } from '../../language/props';
import { registerValueText } from '../../language/runtime';
import type { CallCheck, CommandSpec, FormCheck, ParamSpec, Refusal } from '../../language/table';
import { T } from '../../language/types';
import type { Ty } from '../../language/types';
import { makePolygon } from '../geometry/polygons';
import { polygonMass } from '../../physics/geom2';
import { cos, sin } from '../../physics/math';
import { FORCE_KINDS } from '../../physics/world2';
import { PhysicsDriver } from './driver';
import { bodyShapeOf } from './shapes';
import { JOINT_COMMANDS, MEASURE_COMMANDS, isJointValue } from './joints';
import { VEHICLE_COMMANDS, isVehicleValue, isWheelValue } from './vehicle';
import type { BodySpec, BodyValue, Outline, WorldValue } from './types';
import { DEFAULT_WORLD, SHOW_WORDS, isBodyValue, isWorldValue } from './types';

export { PhysicsDriver } from './driver';
export type { BodySpec, BodyValue, Outline, WorldValue } from './types';
export { isBodyValue, isWorldValue, DEFAULT_WORLD } from './types';
export { bodyShapeOf, solidShapeOf } from './shapes';
export { isJointValue } from './joints';
export { dragBody, draggingBody } from './drag';
export { isVehicleValue, isWheelValue } from './vehicle';
export type { VehicleValue, WheelValue } from './vehicle';
export type { JointValue, JointKind } from './joints';

/** The limits of design 11.3, the same on every computer. */
export const PHYSICS_LIMITS = Object.freeze({ bodies: 1000, joints: 1000, liquid: 2000, grid: 64, groundPieces: 2000, contactPoints: 4000 });

const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const named = (name: string, type: string): ParamSpec => P(name, type, { optional: true, named: true });
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

/* ------------------------------ the physics driver of each figure ------------------------------ */

const DRIVERS = new WeakMap<object, PhysicsDriver>();

/** The figure's physics driver (made on first use). */
export function physicsOf(figure: Figure): PhysicsDriver {
  for (const d of figure.worldDrivers()) if (d instanceof PhysicsDriver) return d;
  // registered after the figure made its drivers: make it now
  let d = DRIVERS.get(figure);
  if (!d) {
    d = new PhysicsDriver(figure);
    DRIVERS.set(figure, d);
  }
  return d;
}

/* ------------------------------ Body ------------------------------ */

const BODY_NAMED = [
  named('mass', 'Number'), named('density', 'Number'), named('speed', 'Vector|Point'), named('spin', 'Number'), named('bounce', 'Number'), named('friction', 'Number'),
  named('turns', 'Bool'), named('bullet', 'Bool'), named('fixed', 'Bool'), named('group', 'Number'), named('charge', 'Number'),
];
const BODY_SHAPES = 'Polygon|Circle|Conic|Polyline';

/** Literal values that can never work (errors B004). */
function checkBodyArgs(c: FormCheck, first: number): Refusal | undefined {
  const bad = (i: number, key: string, allowed: string, hint: string): Refusal => ({ kind: 'bad_property_value', message: `${key} must be ${allowed}.`, hint, param: i, params: { key, allowed } });
  for (let k = 0; k < BODY_NAMED.length; k++) {
    const a = c.args[first + k];
    if (!a || a.omitted || typeof a.literal !== 'number') continue;
    const key = (BODY_NAMED[k] as ParamSpec).name;
    const n = a.literal;
    if ((key === 'mass' || key === 'density') && !(n > 0)) return bad(first + k, key, 'above 0', `A body needs some ${key}. Try ${key} = 1.`);
    if (key === 'bounce' && (n < 0 || n > 1)) return bad(first + k, key, 'between 0 and 1', '0 is no bounce, 1 is a perfect bounce.');
    if (key === 'friction' && (n < 0 || n > 2)) return bad(first + k, key, 'between 0 and 2', 'Ice is about 0.05, rubber on concrete about 1.');
  }
  return undefined;
}

/** `Body(p)` where `p` is a polygon whose edges cross now and whose corners are all fixed numbers (errors B002). */
function checkCrossing(c: FormCheck): Refusal | undefined {
  const a = c.args[0];
  if (!a || a.omitted) return undefined;
  const fixed = a.source !== undefined && !/[A-Za-z_]\w*\s*[,)]|\bt\b/.test(a.source.replace(/^[^=]*=\s*Polygon\(/, '('));
  const pts = a.value !== undefined && typeof a.value === 'object' && a.value !== null && Array.isArray((a.value as { pts?: unknown }).pts) ? ((a.value as { pts: { x: number; y: number }[] }).pts) : undefined;
  if (!pts || !fixed) return undefined;
  const s = bodyShapeOf(a.value);
  if (s.ok || s.why !== 'self_crossing' || !s.edges) return undefined;
  return {
    kind: 'self_crossing',
    message: `Body(${a.text}): edges ${s.edges[0] + 1} and ${s.edges[1] + 1} of ${a.text} cross, so it has no inside to fill with mass.`,
    hint: 'Put the corners in order round the shape, so no two edges cross.',
    param: 0,
    params: { why: `edges ${s.edges[0] + 1} and ${s.edges[1] + 1} cross` },
  };
}

function bodyRule(): { run(call: RuleCall): unknown } {
  return {
    run(call) {
      const [shape, mass, density, speed, spin, bounce, friction, turns, bullet, fixed, group, charge] = call.values;
      const s = bodyShapeOf(shape);
      if (!s.ok) return call.fail(s.why === 'self_crossing' ? 'self_crossing' : s.why === 'degenerate' ? 'degenerate' : 'input_undefined', s.detail);
      const v = speed as { x?: number; y?: number } | undefined;
      const spec = makeSpec(s.shapes, s.outline, s.parts, {
        ...(typeof mass === 'number' && mass > 0 ? { mass } : {}),
        density: num(density, 1) > 0 ? num(density, 1) : 1,
        vx: num(v?.x, 0), vy: num(v?.y, 0), spin: num(spin, 0),
        bounce: Math.min(1, Math.max(0, num(bounce, 0.2))), friction: Math.min(2, Math.max(0, num(friction, 0.4))),
        turns: bool(turns, true), bullet: bool(bullet, false), fixed: bool(fixed, false), group: Math.round(num(group, 0)), charge: num(charge, 0),
      });
      return startValue(spec);
    },
  };
}

type SpecProps = Omit<BodySpec, 'shapes' | 'outline' | 'parts' | 'cx' | 'cy' | 'massNow'>;

function makeSpec(shapes: BodySpec['shapes'], outline: Outline, parts: number, p: SpecProps): BodySpec {
  // centre of mass and mass at the start, from the convex parts
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const s of shapes) {
    if (s.kind === 'circle') {
      const a = Math.PI * s.r * s.r;
      area += a;
      cx += a * s.x;
      cy += a * s.y;
    } else {
      const m = polygonMass(s.pts);
      area += m.area;
      cx += m.area * m.cx;
      cy += m.area * m.cy;
    }
  }
  if (area > 0) {
    cx /= area;
    cy /= area;
  }
  const massNow = p.mass ?? p.density * area;
  return { shapes, outline, parts, ...p, cx, cy, massNow };
}

function startValue(spec: BodySpec): BodyValue {
  return {
    schema: 'Body', spec, x: spec.cx, y: spec.cy, angle: 0, vx: spec.vx, vy: spec.vy, spin: spec.spin, asleep: false, mass: spec.fixed ? Infinity : spec.massNow, inertia: 0,
    energy: 0, kinetic: 0.5 * spec.massNow * (spec.vx * spec.vx + spec.vy * spec.vy), potential: 0, touching: [], moving: false,
  };
}

/** `Body(L)` with a line: no area, so it cannot be a body; the fix is to make it solid (errors B001). */
function refuseBody(c: CallCheck): Refusal | undefined {
  const a = c.args[0];
  if (!a || a.omitted) return undefined;
  const t = a.type;
  if (/^(Line|Ray|Segment|Function|Curve|Arc|Polyline)/.test(t)) {
    const name = /^[A-Za-z]\w*$/.test(a.text) ? a.text : undefined;
    return {
      kind: 'not_a_body_shape',
      message: `Body(${a.text}): ${a.text} is a ${t.replace(/<.*$/, '').toLowerCase()}, and it has no area, so it cannot have a mass.`,
      hint: name ? `To make it a solid floor that bodies hit, write ${name} with solid = true.` : 'Give Body a closed shape: a polygon, a box, a circle or an ellipse.',
      param: 0,
      params: { why: `${a.text} has no area` },
      ...(name ? { suggest: [`${name} with solid = true`] } : {}),
    };
  }
  return undefined;
}

/* ------------------------------ Box and Ground ------------------------------ */

function boxRule(): { run(call: RuleCall): unknown } {
  return {
    run(call) {
      const [c, w, h, a] = call.values as [{ x: number; y: number }, number, number, number | undefined];
      if (!(w > 0) || !(h > 0)) return call.fail('degenerate', 'a box needs a width and a height above 0');
      const ang = num(a, 0);
      const cs = cos(ang);
      const sn = sin(ang);
      const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as const;
      return makePolygon(corners.map(([x, y]) => ({ x: c.x + cs * x - sn * y, y: c.y + sn * x + cs * y })));
    },
  };
}

function groundRule(): { run(call: RuleCall): unknown } {
  return {
    run(call) {
      const y = num(call.values[0], 0);
      // the line 0 x + 1 y = y
      return { a: 0, b: 1, c: y, p: { x: 0, y }, len: 1 };
    },
  };
}

/* ------------------------------ the world ------------------------------ */

const WORLD_PROPS: readonly (readonly [string, string])[] = [['gravity', 'Vector|Point'], ['air', 'Number'], ['passes', 'Number'], ['timestep', 'Number'], ['sleep', 'Bool'], ['range', 'Number'], ['show', 'Text']];

function worldRule(): { run(call: RuleCall): unknown } {
  return {
    run(call) {
      const [g, air, passes, step, sleep, range, show] = call.values;
      const gv = g as { x?: number; y?: number } | undefined;
      const st = num(step, 1 / 120);
      const v: WorldValue = {
        ...DEFAULT_WORLD,
        gx: num(gv?.x, 0), gy: num(gv?.y, -9.8), air: Math.min(10, Math.max(0, num(air, 0))), passes: Math.min(20, Math.max(1, Math.round(num(passes, 8)))),
        rate: st > 0 ? Math.round(1 / st) : 120, sleep: bool(sleep, true), range: Math.max(1, num(range, 50)),
        show: typeof show === 'string' && (SHOW_WORDS as readonly string[]).includes(show) ? show : 'bodies',
      };
      return v;
    },
  };
}

/** `world with timestep = 1/100` and other values that can never work (errors B004, B005). */
function checkWorld(c: FormCheck): Refusal | undefined {
  const bad = (i: number, key: string, allowed: string, hint: string, suggest?: string): Refusal => ({ kind: 'bad_property_value', message: `${key} must be ${allowed}.`, hint, param: i, params: { key, allowed }, ...(suggest ? { suggest: [suggest] } : {}) });
  for (let i = 0; i < WORLD_PROPS.length; i++) {
    const a = c.args[i];
    if (!a || a.omitted) continue;
    const [key] = WORLD_PROPS[i] as readonly [string, string];
    if (key === 'show' && typeof a.literal === 'string' && !(SHOW_WORDS as readonly string[]).includes(a.literal)) return bad(i, key, SHOW_WORDS.join(', '), 'Write world with show = "forces".');
    const n = typeof a.literal === 'number' ? a.literal : fraction(a.text);
    if (n === undefined) continue;
    if (key === 'passes' && (n < 1 || n > 20 || !Number.isInteger(n))) return bad(i, key, 'a whole number from 1 to 20', 'More passes make stacks steadier but cost time. 8 is the default.');
    if (key === 'air' && (n < 0 || n > 10)) return bad(i, key, 'between 0 and 10', 'Air drag per second; 0.1 is a light breeze.');
    if (key === 'range' && !(n >= 1)) return bad(i, key, 'at least 1', 'The world reaches this far from the origin each way. 50 is the default.');
    if (key === 'timestep') {
      const rate = n > 0 ? 1 / n : 0;
      const whole = Math.abs(rate - Math.round(rate)) < 1e-9 ? Math.round(rate) : 0;
      if (whole < 60 || whole > 480) return bad(i, key, '1/n with n from 60 to 480', 'Use 1/120 (the default) or 1/240 for stiff springs.', 'world with timestep = 1/120');
      if (240 % whole !== 0 && whole % 240 !== 0) return bad(i, key, 'a step that divides the solver\'s 1/240 s steps evenly', 'Use 1/120 (the default) or 1/240 for stiff springs.', 'world with timestep = 1/120');
    }
  }
  return undefined;
}

function fraction(text: string): number | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (m) return Number(m[1]) / Number(m[2]);
  const k = /^\s*-?\d+(?:\.\d+)?\s*$/.exec(text);
  return k ? Number(text) : undefined;
}

/* ------------------------------ actions ------------------------------ */

function bodyArg(call: ActionCall, k = 0): { id: ObjId; item?: number } | { error: ErrorObject } {
  const id = call.refs?.[k] ?? call.objects[k];
  const at = { line: 0, col: 1, endCol: 1 };
  const o = id !== undefined ? call.figure.get(id) : undefined;
  // a body of a list (`balls[1]`) is found by its start
  const v = call.values[k];
  if (!o && isBodyValue(v)) {
    call.figure.flush();
    const owner = physicsOf(call.figure).ownerOf(v.spec);
    if (owner) return owner;
  }
  if (!o || o.type !== 'Body') {
    const name = o?.name ?? 'it';
    return { error: err('not_a_body', at, { why: `${name} is not a body` }, { hint: `Make it a body first: b = Body(${name}, mass = 1).`, suggest: o ? [`b = Body(${o.name}, mass = 1)`] : [], recovery: 'use_suggestion', fingerprintKey: `push:${name}` }) };
  }
  return { id: o.id };
}

function pushRun(call: ActionCall): ActionOutcome {
  const b = bodyArg(call);
  if ('error' in b) return { error: b.error };
  const j = call.values[1] as { x?: number; y?: number } | undefined;
  const at = call.values[2] as { x?: number; y?: number } | undefined;
  if (typeof j?.x !== 'number' || typeof j.y !== 'number') return { summary: 'nothing to push with' };
  const d = physicsOf(call.figure);
  call.figure.flush();
  d.push(b.id, j.x, j.y, typeof at?.x === 'number' && typeof at.y === 'number' ? { x: at.x, y: at.y } : undefined, b.item);
  call.figure.flush(true);
  return { summary: `pushed ${call.figure.get(b.id)?.name ?? ''}` };
}

function wakeRun(awake: boolean): (call: ActionCall) => ActionOutcome {
  return (call) => {
    const b = bodyArg(call);
    if ('error' in b) return { error: b.error };
    call.figure.flush();
    physicsOf(call.figure).wake(b.id, awake, b.item);
    call.figure.flush(true);
    return { summary: awake ? 'woken' : 'put to sleep' };
  };
}

const action = (name: string, forms: readonly { params: readonly ParamSpec[]; summary: string }[], run: (call: ActionCall) => ActionOutcome): CommandSpec => ({
  name,
  kind: 'action',
  group: 'physics',
  forms: forms.map((f) => ({ params: f.params, returns: null, summary: f.summary, rule: () => ({ run }) })),
});

/* ------------------------------ the commands ------------------------------ */

export const PHYSICS_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'Body',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('shape', BODY_SHAPES), ...BODY_NAMED],
      returns: 'Body',
      rule: bodyRule,
      summary: 'a body that falls, slides and bounces, made from a closed shape',
      explain: '{name} is a body made from {0}',
      check: (c) => checkCrossing(c) ?? checkBodyArgs(c, 1),
    }],
    refuse: refuseBody,
  },
  {
    name: 'Bodies',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('shapes', 'List'), ...BODY_NAMED],
      returns: 'List<Body>',
      rule: () => ({
        run(call: RuleCall) {
          const list = call.values[0];
          const items = Array.isArray(list) ? list : [];
          const one = bodyRule();
          return items.map((s) => {
            const r = one.run({ ...call, values: [s, ...call.values.slice(1)], fail: () => undefined } as RuleCall);
            return r;
          });
        },
      }),
      summary: 'a body for each shape in a list, all with the same settings',
      check: (c) => checkBodyArgs(c, 1),
    }],
  },
  {
    name: 'Box',
    kind: 'object',
    group: 'physics',
    forms: [{ params: [P('centre', 'Point'), P('w', 'Number'), P('h', 'Number'), named('angle', 'Number')], returns: 'Polygon', rule: boxRule, summary: 'a box of width w and height h about its centre' }],
  },
  {
    name: 'Ground',
    kind: 'object',
    group: 'physics',
    forms: [
      { params: [], returns: 'Line', rule: groundRule, summary: 'the ground: the line y = 0, solid' },
      { params: [P('y', 'Number')], returns: 'Line', rule: groundRule, summary: 'the ground at height y, solid' },
    ],
  },
  {
    name: 'World',
    kind: 'object',
    group: 'physics',
    forms: [{ params: WORLD_PROPS.map(([k, t]) => named(k, t)), returns: 'World', rule: worldRule, summary: 'the physics world: only as world = World(...), written world with gravity = (0, -9.8)', check: checkWorld }],
  },
  action('Push', [
    { params: [P('b', 'Any'), P('impulse', 'Vector|Point')], summary: 'kick a body at its centre (N s)' },
    { params: [P('b', 'Any'), P('impulse', 'Vector|Point'), P('at', 'Point')], summary: 'kick a body at a point, so it also turns' },
  ], pushRun),
  action('Wake', [{ params: [P('b', 'Any')], summary: 'wake a sleeping body' }], wakeRun(true)),
  action('Sleep', [{ params: [P('b', 'Any')], summary: 'put a body to sleep until something touches it' }], wakeRun(false)),
];

/* ------------------------------ readouts ------------------------------ */

const BODY_FIELDS: Readonly<Record<string, Ty>> = {
  pos: T.Point, x: T.Number, y: T.Number, angle: T.Number, speed: T.Vector, v: T.Number, spin: T.Number, energy: T.Number, kinetic: T.Number, potential: T.Number,
  momentum: T.Vector, mass: T.Number, asleep: T.Bool, shape: { k: 'Polygon' }, touching: { k: 'List', of: T.Text },
  force: { k: 'Function', ret: 'Vector', arity: 1, textArgs: true } as Ty,
};

const WORLD_FIELDS: Readonly<Record<string, Ty>> = { time: T.Number, energy: T.Number, momentum: T.Vector, awake: T.Number, contacts: T.Number, gravity: T.Vector };

/** The shape of a body where it is now. */
export function shapeNow(b: BodyValue): unknown {
  const o = b.spec.outline;
  const c = cos(b.angle);
  const s = sin(b.angle);
  const tx = (x: number, y: number): { x: number; y: number } => {
    const dx = x - b.spec.cx;
    const dy = y - b.spec.cy;
    return { x: b.x + c * dx - s * dy, y: b.y + s * dx + c * dy };
  };
  if (o.kind === 'circle') {
    const p = tx(o.cx, o.cy);
    return { cx: p.x, cy: p.y, r: o.r };
  }
  return makePolygon(o.pts.map((p) => tx(p.x, p.y)));
}

function readBody(field: string, v: unknown): unknown {
  if (!isBodyValue(v)) return undefined;
  switch (field) {
    case 'pos':
      return { x: v.x, y: v.y };
    case 'x':
      return v.x;
    case 'y':
      return v.y;
    case 'angle':
      return v.angle;
    case 'speed':
      return { x: v.vx, y: v.vy };
    case 'v':
      return Math.sqrt(v.vx * v.vx + v.vy * v.vy);
    case 'spin':
      return v.spin;
    case 'energy':
      return v.energy;
    case 'kinetic':
      return v.kinetic;
    case 'potential':
      return v.potential;
    case 'momentum':
      return Number.isFinite(v.mass) ? { x: v.mass * v.vx, y: v.mass * v.vy } : { x: 0, y: 0 };
    case 'mass':
      return v.mass;
    case 'asleep':
      return v.asleep;
    case 'shape':
      return shapeNow(v);
    case 'touching':
      return v.touching;
    case 'force':
      return {
        arity: 1,
        call: (kind: unknown) => {
          const k = FORCE_KINDS.indexOf(String(kind) as (typeof FORCE_KINDS)[number]);
          if (k < 0) return undefined;
          const f = v.forces;
          return f ? { x: f[k * 2] as number, y: f[k * 2 + 1] as number } : { x: 0, y: 0 };
        },
      };
    default:
      return undefined;
  }
}

function readWorld(field: string, v: unknown): unknown {
  if (!isWorldValue(v)) return undefined;
  switch (field) {
    case 'time':
      return v.time;
    case 'energy':
      return v.energy;
    case 'momentum':
      return { x: v.momentumX, y: v.momentumY };
    case 'awake':
      return v.awake;
    case 'contacts':
      return v.contacts;
    case 'gravity':
      return { x: v.gx, y: v.gy };
    default:
      return undefined;
  }
}

const JOINT_FIELDS: Readonly<Record<string, Ty>> = { force: T.Number, length: T.Number, angle: T.Number, broken: T.Bool };

function readJoint(field: string, v: unknown): unknown {
  if (!isJointValue(v)) return undefined;
  switch (field) {
    case 'force':
      return v.force;
    case 'length':
      return v.lengthNow;
    case 'angle':
      return v.angleNow;
    case 'broken':
      return v.broken;
    default:
      return undefined;
  }
}

const WHEEL_FIELDS: Readonly<Record<string, Ty>> = { spin: T.Number, broken: T.Bool, pos: T.Point };
const VEHICLE_FIELDS: Readonly<Record<string, Ty>> = { speedometer: T.Number };

function readWheel(field: string, v: unknown): unknown {
  if (!isWheelValue(v)) return undefined;
  return field === 'spin' ? v.spin : field === 'broken' ? v.broken : field === 'pos' ? { x: v.x, y: v.y } : undefined;
}

function readVehicle(field: string, v: unknown): unknown {
  return isVehicleValue(v) && field === 'speedometer' ? v.speedometer : undefined;
}

/* ------------------------------ line checks and rewrites ------------------------------ */

const WITH_WORLD = /^\s*world\s+with\s+([\s\S]+)$/;
const RESERVED = new Set(['world', 'hit']);
const READ_ONLY = new Set(['pos', 'x', 'y', 'angle', 'v', 'energy', 'momentum', 'asleep', 'touching', 'kinetic', 'potential']);

/** Splits `a = 1, b = f(2, 3)` at the top-level commas. */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = '';
  for (const ch of s) {
    if (ch === '"') quote = !quote;
    if (!quote && (ch === '(' || ch === '[' || ch === '{')) depth++;
    if (!quote && (ch === ')' || ch === ']' || ch === '}')) depth--;
    if (!quote && depth === 0 && ch === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

interface FigureLike {
  get(name: string): { type: string; definition: string } | undefined;
}

/** `world with gravity = (0, -5)` is the line `world = World(...)` with that property set and the others kept. */
export function worldRewrite(figure: unknown, text: string): LineRewrite | undefined {
  const w = WITH_WORLD.exec(text);
  if (!w) return undefined;
  const fig = figure as FigureLike;
  const args = new Map<string, string>();
  const def = fig.get('world')?.definition ?? '';
  const m = /^\s*(?:world\s*=\s*)?World\((.*)\)\s*$/s.exec(def);
  if (m) for (const item of splitTop(m[1] as string)) {
    const kv = /^([A-Za-z]\w*)\s*=\s*([\s\S]+)$/.exec(item);
    if (kv) args.set(kv[1] as string, (kv[2] as string).trim());
  }
  for (const item of splitTop(w[1] as string)) {
    const kv = /^([A-Za-z]\w*)\s*=\s*([\s\S]+)$/.exec(item);
    if (!kv) return undefined;
    const key = kv[1] as string;
    let value = (kv[2] as string).trim();
    if (key === 'show' && /^[A-Za-z]+$/.test(value)) value = `"${value}"`;
    if (['time', 'energy', 'momentum', 'awake', 'contacts'].includes(key)) {
      return { error: err('read_only', { line: 1, col: 1, endCol: text.length + 1 }, { name: `world.${key}` }, { hint: `world.${key} is measured by the physics; it cannot be set.`, recovery: 'rewrite', fingerprintKey: `world:${key}` }) };
    }
    args.set(key, value);
  }
  const order = WORLD_PROPS.map(([k]) => k);
  const ordered = order.filter((k) => args.has(k)).map((k) => `${k} = ${args.get(k) as string}`);
  const unknown = [...args.keys()].filter((k) => !order.includes(k)).map((k) => `${k} = ${args.get(k) as string}`);
  return { text: `world = World(${[...ordered, ...unknown].join(', ')})` };
}

/** `b with pos = (1, 2)` on a body: the physics owns where it is (errors B007). */
export function bodyWithRewrite(figure: unknown, text: string): LineRewrite | undefined {
  const m = /^\s*([A-Za-z]\w*)\s+with\s+([\s\S]+)$/.exec(text);
  if (!m) return undefined;
  const fig = figure as FigureLike;
  const o = fig.get(m[1] as string);
  if (!o || o.type !== 'Body') return undefined;
  for (const item of splitTop(m[2] as string)) {
    const kv = /^([A-Za-z]\w*)\s*=/.exec(item);
    const key = kv?.[1];
    if (key && READ_ONLY.has(key)) {
      return {
        error: err('read_only', { line: 1, col: 1, endCol: text.length + 1 }, { name: `${m[1] as string}.${key}` }, {
          hint: `The physics moves ${m[1] as string}. To move where it starts, change its shape. To give it a kick while it moves, use Push.`,
          suggest: [`Push(${m[1] as string}, (2, 0))`], recovery: 'use_suggestion', fingerprintKey: `read_only:${key}`,
        }),
      };
    }
  }
  return undefined;
}

export function physicsLineCheck(_figure: unknown, line: CheckedLine): ErrorObject | undefined {
  const expr = line.expr as { n?: string; spec?: { name?: string } } | undefined;
  const isWorld = expr?.n === 'command' && expr.spec?.name === 'World';
  const at = { line: line.line, col: 1, endCol: 1 };
  if (isWorld && (line.names.length !== 1 || line.names[0] !== 'world')) {
    return err('reserved_name', at, { name: 'World(...)', group: 'the physics world, which only world can be' }, { hint: 'Write world with gravity = (0, -9.8), or world = World(gravity = (0, -9.8)).', suggest: [], recovery: 'rewrite', fingerprintKey: 'world' });
  }
  if (!isWorld && (line.op === 'add' || line.op === 'redefine')) {
    for (const n of line.names) {
      if (RESERVED.has(n)) {
        return err('reserved_name', at, { name: n, group: n === 'world' ? 'the physics world' : 'the hit in an on … hit handler' }, { hint: n === 'world' ? 'Pick another name. To change the world, write world with gravity = (0, -5).' : 'Pick another name.', suggest: [], recovery: 'rewrite', fingerprintKey: n });
      }
    }
  }
  return undefined;
}

/* ------------------------------ registration ------------------------------ */

let registered = false;

export function registerPhysics(registry: CommandRegistry): void {
  registry.registerAll([...PHYSICS_COMMANDS, ...JOINT_COMMANDS, ...MEASURE_COMMANDS, ...VEHICLE_COMMANDS]);
  if (registered) return;
  registered = true;
  registerWorldDriver((figure) => {
    const f = figure as Figure;
    const old = DRIVERS.get(f);
    if (old) return old;
    const d = new PhysicsDriver(f);
    DRIVERS.set(f, d);
    return d;
  });
  for (const [type, fields, reader] of [['Body', BODY_FIELDS, readBody], ['World', WORLD_FIELDS, readWorld], ['Joint', JOINT_FIELDS, readJoint], ['Wheel', WHEEL_FIELDS, readWheel], ['Vehicle', VEHICLE_FIELDS, readVehicle]] as const) {
    registerFieldNames(type, () => Object.keys(fields));
    registerFieldTyper(type, (field) => fields[field]);
    registerFieldReader(type, (field, v) => reader(field, v));
  }
  registerValueText((v) => {
    if (isBodyValue(v)) return `body at (${fmt(v.x)}, ${fmt(v.y)}), ${fmt(Math.sqrt(v.vx * v.vx + v.vy * v.vy))} m/s${v.asleep ? ', asleep' : ''}`;
    if (isWorldValue(v)) return `world, gravity (${fmt(v.gx)}, ${fmt(v.gy)})`;
    if (isJointValue(v)) return `${v.kind}${v.broken ? ', broken' : `, ${fmt(v.force)} N`}`;
    if (isWheelValue(v)) return `wheel, ${fmt(Math.abs(v.spin))} rad/s${v.broken ? ', broken off' : ''}`;
    if (isVehicleValue(v)) return `vehicle, ${fmt(v.speedometer)} m/s`;
    return undefined;
  });
  registerTypeStyle('Body', { defaults: { color: '#c0602a', width: 2, opacity: 0.35 }, keys: ['bounce', 'friction', 'force', 'torque', 'bullet', 'group', 'charge', 'show'] });
  registerTypeStyle('World', { drawable: false });
  registerTypeStyle('Joint', { defaults: { color: '#555555', width: 1.5 } });
  registerTypeStyle('Wheel', { defaults: { color: '#2b2f36', width: 2 } });
  registerTypeStyle('Vehicle', { drawable: false });
  // `with solid = true` on every flat shape, and the material of solids and bodies
  const PROPS: Readonly<Record<string, PropSpec>> = {
    solid: { kind: 'bool', allowed: 'true or false', expr: true },
    bounce: { kind: 'number', min: 0, max: 1, allowed: 'a number from 0 to 1', expr: true },
    friction: { kind: 'number', min: 0, max: 2, allowed: 'a number from 0 to 2', expr: true },
    force: { kind: 'point', allowed: 'a force such as (0, -5)', expr: true },
    torque: { kind: 'number', allowed: 'a number', expr: true },
    bullet: { kind: 'bool', allowed: 'true or false' },
    group: { kind: 'int', min: 0, allowed: 'a whole number from 0' },
    charge: { kind: 'number', allowed: 'a number', expr: true },
    show: { kind: 'enum', values: ['forces', 'speeds', 'none'], allowed: 'forces, speeds or none' },
  };
  for (const [k, spec] of Object.entries(PROPS)) if (!Object.hasOwn(PROPERTIES, k)) PROPERTIES[k] = spec;
  const SOLID_TYPES = ['Polygon', 'Circle', 'Conic', 'Segment', 'Line', 'Ray', 'Arc', 'Sector', 'Polyline', 'Curve', 'Function'];
  registerPropertyTypes('solid', SOLID_TYPES);
  registerPropertyTypes('bounce', [...SOLID_TYPES, 'Body']);
  registerPropertyTypes('friction', [...SOLID_TYPES, 'Body']);
  for (const k of ['force', 'torque', 'bullet', 'group', 'charge', 'show']) registerPropertyTypes(k, ['Body']);
  registerLineCheck(physicsLineCheck);
  registerLineRewriter(worldRewrite);
  registerLineRewriter(bodyWithRewrite);
  registerScriptTail((figure) => physicsOf(figure as Figure).inputLines());
  registerReasonPhrase('self_crossing', { noun: 'crossing edges', sentence: 'Its edges cross, so it has no inside to fill with mass.' });
  registerReasonPhrase('unstable_world', { noun: 'an unstable world', sentence: 'The physics went unstable: a spring was too stiff or a force too large for the step.' });
  registerReasonPhrase('broken', { noun: 'a broken joint', sentence: 'The joint broke: the force on it went over its limit.' });
  registerReasonPhrase('left_world', { noun: 'out of the world', sentence: 'It left the world, so it no longer takes part.' });
  registerNotice('split_shape', { code: 'B101', severity: 'info', template: '{name} was split into {parts} parts to make it solid.' });
  registerNotice('shape_approximated', { code: 'B102', severity: 'info', template: '{name} hits as a {sides}-sided shape.' });
  registerNotice('left_world', { code: 'B103', severity: 'info', template: '{name} left the world at t = {t} s.' });
  registerNotice('contacts_dropped', { code: 'B104', severity: 'warning', template: 'Too many touching points: {max} kept.' });
  registerNotice('checkpoints_thinned', { code: 'B105', severity: 'info', template: 'The film now keeps a checkpoint every {seconds} s, so far seeks may take longer.' });
  registerNotice('ground_sampled', { code: 'B106', severity: 'info', template: '{name} is solid between -{range} and {range}.' });
  registerNotice('input_undefined', { code: 'B107', severity: 'warning', template: "{name}'s {what} was undefined at t = {t} s and was taken as 0." });
  registerNotice('worker_unavailable', { code: 'B108', severity: 'info', template: 'Liquids run on the page, so they may slow it down.' });
  registerNotice('unstable_world', { code: 'B109', severity: 'warning', template: '{name} became unstable at t = {t} s: {hint}.' });
  registerNotice('physics_behind', { code: 'B110', severity: 'info', template: 'The film plays slower than real time on this computer; it is the same film.' });
  registerNotice('broken', { code: 'B111', severity: 'info', template: '{name} broke at t = {t} s.' });
}

const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(3))) : String(x));

export type { CheckedLine };
