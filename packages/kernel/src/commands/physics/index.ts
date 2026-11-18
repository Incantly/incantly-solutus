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
import { polyhedron } from '../space/solids';
import { polygonMass } from '../../physics/geom2';
import { cos, sin } from '../../physics/math';
import { FORCE_KINDS } from '../../physics/world2';
import { PhysicsDriver } from './driver';
import { Physics3Driver, isSpaceWorld } from './driver3';
import { bodyShapeOf } from './shapes';
import { body3ShapeOf, isBody3Value, startOf3 } from './body3';
import type { Body3Value, BodySpec3 } from './body3';
import { JOINT_COMMANDS, MEASURE_COMMANDS, isJointValue } from './joints';
import { VEHICLE_COMMANDS, isVehicleValue, isWheel3Value, isWheelValue } from './vehicle';
import { registerLiquids } from './liquid-reg';
import { LIQUID_COMMANDS } from './liquid';
import { registerSmoke } from './smoke-reg';
import { SMOKE_COMMANDS, SMOKE_MAX_WIND } from './smoke';
import { CLOTH_COMMANDS } from './cloth';
import { registerCloth } from './cloth-reg';
import type { BodySpec, BodyValue, Outline, WorldValue } from './types';
import { DEFAULT_WORLD, SHOW_WORDS, isBodyValue, isWorldValue } from './types';

export { PhysicsDriver } from './driver';
export type { BodySpec, BodyValue, Outline, WorldValue } from './types';
export { isBodyValue, isWorldValue, DEFAULT_WORLD } from './types';
export { bodyShapeOf, solidShapeOf } from './shapes';
export { isJointValue } from './joints';
export { dragBody, dragBody3, dragCloth, draggingBody, draggingCloth } from './drag';
export { carKey, carPedals, carPose } from './drive';
export type { CarPedals } from './drive';
export { isVehicleValue, isWheelValue, isWheel3Value, isVehicle3Value } from './vehicle';
export { isJoint3Value } from './joints';
export type { JointValue3, JointEnd3 } from './joints';
export type { Wheel3Value, Vehicle3Value, LooseWheel } from './vehicle';
export { isBody3Value, solidNow } from './body3';
export type { Body3Value, BodySpec3 } from './body3';
export type { VehicleValue, WheelValue } from './vehicle';
export type { JointValue, JointKind } from './joints';
export { inSpace, isLiquidValue, isWaterValue, isWavesValue } from './liquid';
export { waveHeightAt } from './liquid-reg';
export { Physics3Driver } from './driver3';
/** Notices of the physics area for hosts (the worker's `worker_unavailable`, `worker_crashed`). */
export { makeNotice } from '../../errors/notices';
export type { LiquidValue, LiquidSpec, WaterValue, WavesValue } from './liquid';
export { isSmokeValue } from './smoke';
export { isClothValue, isPinValue } from './cloth';
export type { ClothValue, ClothSpec, PinValue } from './cloth';
export { clothAt, clothRow } from './cloth-reg';
export type { SmokeValue, SmokeSpec } from './smoke';

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

/**
 * The driver that holds the figure's world: the space driver when the figure has a body, a liquid or waves in space,
 * else the plane driver. The physics worker and its host talk to this one (design 9.6).
 */
export function worldDriverOf(figure: Figure): PhysicsDriver | Physics3Driver {
  return isSpaceWorld(figure.driverAccess().list) ? physics3Of(figure) : physicsOf(figure);
}

const DRIVERS3 = new WeakMap<object, Physics3Driver>();

/**
 * Do the figure's cloth and liquid solvers run the Rust loops (design 11.6)? `true` when every solver the figure has now
 * does, `false` when one runs the TypeScript loops (kernels off, WebAssembly missing or failed to load, a solver built
 * before they were ready), `undefined` when the figure has no cloth or liquid solver yet. A figure whose physics runs in
 * a worker has no solver on its page: ask the worker's own figure (its reply carries the answer, `remoteInfo.kernels`).
 */
export function physicsKernelsActive(figure: Figure): boolean | undefined {
  const drivers = [...figure.worldDrivers(), DRIVERS.get(figure), DRIVERS3.get(figure)];
  let answer: boolean | undefined;
  for (const d of drivers) {
    if (!(d instanceof PhysicsDriver) && !(d instanceof Physics3Driver)) continue;
    const sets: { readonly usesKernels: boolean }[] = [];
    if (d.cloth) sets.push(d.cloth);
    if (d instanceof Physics3Driver && d.fluid) sets.push(d.fluid);
    for (const s of sets) answer = (answer ?? true) && s.usesKernels;
  }
  return answer;
}

/** The figure's physics driver in space (made on first use). */
export function physics3Of(figure: Figure): Physics3Driver {
  for (const d of figure.worldDrivers()) if (d instanceof Physics3Driver) return d;
  let d = DRIVERS3.get(figure);
  if (!d) {
    d = new Physics3Driver(figure);
    DRIVERS3.set(figure, d);
  }
  return d;
}

/* ------------------------------ Body ------------------------------ */

const BODY_NAMED = [
  named('mass', 'Number'), named('density', 'Number'), named('speed', 'Vector|Point'), named('spin', 'Number'), named('bounce', 'Number'), named('friction', 'Number'),
  named('turns', 'Bool'), named('bullet', 'Bool'), named('fixed', 'Bool'), named('group', 'Number'), named('charge', 'Number'),
];
const BODY_SHAPES = 'Polygon|Circle|Conic|Polyline';
const BODY3_NAMED = [named('mass', 'Number'), named('density', 'Number'), named('speed', 'Vector3|Point3'), named('spin', 'Vector3|Point3'), named('bounce', 'Number'), named('friction', 'Number'), named('fixed', 'Bool'), named('group', 'Number')];

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

/** `Body(s)` on a solid with dents (errors B003). */
function checkConvex3(c: FormCheck): Refusal | undefined {
  const a = c.args[0];
  if (!a || a.omitted || a.value === undefined) return undefined;
  const s = body3ShapeOf(a.value);
  if (s.ok || s.why !== 'not_convex') return undefined;
  return { kind: 'not_convex_3d', message: `Body(${a.text}): ${a.text} has dents.`, hint: 'Bodies in space must have no dents. Split it into convex parts and Weld them.', param: 0, params: { why: `${a.text} has dents` } };
}

/** `Bodies(list)` of solids, one with dents (errors B003). */
function checkConvexList3(c: FormCheck): Refusal | undefined {
  const a = c.args[0];
  if (!a || a.omitted || !Array.isArray(a.value)) return undefined;
  const k = (a.value as unknown[]).findIndex((s) => {
    const r = body3ShapeOf(s);
    return !r.ok && r.why === 'not_convex';
  });
  if (k < 0) return undefined;
  return { kind: 'not_convex_3d', message: `Bodies(${a.text}): solid ${k + 1} has dents.`, hint: 'Bodies in space must have no dents. Split it into convex parts and Weld them.', param: 0, params: { why: `solid ${k + 1} has dents` } };
}

function body3Rule(): { run(call: RuleCall): unknown } {
  return {
    run(call) {
      const [solid, mass, density, speed, spin, bounce, friction, fixed, group] = call.values;
      const s = body3ShapeOf(solid);
      if (!s.ok) return call.fail(s.why === 'not_convex' ? 'degenerate' : 'degenerate', s.detail);
      const v3 = (x: unknown): { x: number; y: number; z: number } => {
        const p = x as { x?: number; y?: number; z?: number } | undefined;
        return { x: num(p?.x, 0), y: num(p?.y, 0), z: num(p?.z, 0) };
      };
      const d = num(density, 1) > 0 ? num(density, 1) : 1;
      const m = typeof mass === 'number' && mass > 0 ? mass : undefined;
      const st = startOf3(s.shapes, m, d);
      const spec: BodySpec3 = {
        shapes: s.shapes, solid: s.solid, ...(m !== undefined ? { mass: m } : {}), density: d, v: v3(speed), w: v3(spin),
        bounce: Math.min(1, Math.max(0, num(bounce, 0.2))), friction: Math.min(2, Math.max(0, num(friction, 0.4))), fixed: bool(fixed, false), group: Math.round(num(group, 0)), ...st,
      };
      const value: Body3Value = {
        schema: 'Body3', spec, x: st.cx, y: st.cy, z: st.cz, q: [1, 0, 0, 0], v: spec.v, spin: spec.w, asleep: false, mass: spec.fixed ? Infinity : st.massNow,
        energy: 0, kinetic: 0, potential: 0, touching: [], now: s.solid,
      };
      return value;
    },
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

function box3Rule(): { run(call: RuleCall): unknown } {
  return {
    run(call) {
      const [c, w, d, h, a] = call.values as [{ x: number; y: number; z: number }, number, number, number, number | undefined];
      if (!(w > 0) || !(d > 0) || !(h > 0)) return call.fail('degenerate', 'a box needs a width, a depth and a height above 0');
      if (![c.x, c.y, c.z].every(Number.isFinite)) return call.fail('input_undefined', 'the centre is undefined');
      const ang = num(a, 0);
      const cs = cos(ang);
      const sn = sin(ang);
      const at = (x: number, y: number, z: number): { x: number; y: number; z: number } => ({ x: c.x + cs * x - sn * y, y: c.y + sn * x + cs * y, z: c.z + z });
      const verts = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([x, y, z]) => at(((x as number) * w) / 2, ((y as number) * d) / 2, ((z as number) * h) / 2));
      const loops = [[0, 1, 2, 3], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]];
      return polyhedron(verts, loops, 'prism', h);
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

const WORLD_PROPS: readonly (readonly [string, string])[] = [['gravity', 'Vector|Point|Vector3|Point3'], ['air', 'Number'], ['passes', 'Number'], ['timestep', 'Number'], ['sleep', 'Bool'], ['range', 'Number'], ['show', 'Text'], ['wind', 'Vector|Point|Vector3|Point3']];

function worldRule(): { run(call: RuleCall): unknown } {
  return {
    run(call) {
      const [g, air, passes, step, sleep, range, show, wind] = call.values;
      const gv = g as { x?: number; y?: number; z?: number } | undefined;
      const wv = wind as { x?: number; y?: number; z?: number } | undefined;
      const wpart = (x: unknown): number => Math.min(SMOKE_MAX_WIND, Math.max(-SMOKE_MAX_WIND, num(x, 0)));
      const st = num(step, 1 / 120);
      const g3 = typeof gv?.z === 'number';
      const v: WorldValue = {
        ...DEFAULT_WORLD,
        gx: num(gv?.x, 0), gy: num(gv?.y, -9.8), gz: g3 ? num(gv?.z, -9.8) : num(gv?.y, -9.8), g3, air: Math.min(10, Math.max(0, num(air, 0))), passes: Math.min(20, Math.max(1, Math.round(num(passes, 8)))),
        rate: st > 0 ? Math.round(1 / st) : 120, sleep: bool(sleep, true), range: Math.max(1, num(range, 50)),
        show: typeof show === 'string' && (SHOW_WORDS as readonly string[]).includes(show) ? show : 'bodies',
        windX: wpart(wv?.x), windY: wpart(wv?.y), windZ: wpart(wv?.z),
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
    if (key === 'wind') {
      // any finite vector (design 2.3), each part at most 100 m/s
      if (typeof a.literal === 'number') return bad(i, key, 'a vector such as (3, 0)', 'wind is the speed of the air in m/s: (3, 0) blows to the right.', 'world with wind = (3, 0)');
      // a vector written in the line is its literal; a bare name, its value now
      const v = (a.literal ?? a.value) as { x?: unknown; y?: unknown; z?: unknown } | undefined;
      const parts = [v?.x, v?.y, v?.z].filter((x): x is number => typeof x === 'number');
      if (parts.some((x) => !(Math.abs(x) <= SMOKE_MAX_WIND))) return bad(i, key, `a vector with each part at most ${SMOKE_MAX_WIND} m/s`, 'A strong wind is 10 m/s; a hurricane about 70.');
      continue;
    }
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

function bodyArg(call: ActionCall, k = 0): { id: ObjId; item?: number; space?: boolean } | { error: ErrorObject } {
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
  if (!o && isBody3Value(v)) {
    call.figure.flush();
    const owner = physics3Of(call.figure).ownerOf(v.spec);
    if (owner) return { ...owner, space: true };
  }
  if (o?.type === 'Body3') return { id: o.id, space: true };
  if (!o || o.type !== 'Body') {
    const name = o?.name ?? 'it';
    return { error: err('not_a_body', at, { why: `${name} is not a body` }, { hint: `Make it a body first: b = Body(${name}, mass = 1).`, suggest: o ? [`b = Body(${o.name}, mass = 1)`] : [], recovery: 'use_suggestion', fingerprintKey: `push:${name}` }) };
  }
  return { id: o.id };
}

function pushRun(call: ActionCall): ActionOutcome {
  const b = bodyArg(call);
  if ('error' in b) return { error: b.error };
  const j = call.values[1] as { x?: number; y?: number; z?: number } | undefined;
  const at = call.values[2] as { x?: number; y?: number; z?: number } | undefined;
  if (typeof j?.x !== 'number' || typeof j.y !== 'number') return { summary: 'nothing to push with' };
  if (b.space) {
    const d3 = physics3Of(call.figure);
    call.figure.flush();
    const z = (p: { z?: number }): number => (typeof p.z === 'number' ? p.z : 0);
    d3.push(b.id, { x: j.x, y: j.y, z: z(j) }, typeof at?.x === 'number' && typeof at.y === 'number' ? { x: at.x, y: at.y, z: z(at) } : undefined, b.item);
    call.figure.flush(true);
    return { summary: `pushed ${call.figure.get(b.id)?.name ?? ''}` };
  }
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
    if (b.space) physics3Of(call.figure).wake(b.id, awake, b.item);
    else physicsOf(call.figure).wake(b.id, awake, b.item);
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
    }, {
      params: [P('solid', 'Polyhedron|Sphere|Cylinder|Cone'), ...BODY3_NAMED],
      returns: 'Body3',
      rule: body3Rule,
      summary: 'a body in space that falls, rolls and bounces, made from a solid',
      explain: '{name} is a body made from {0}',
      check: (c) => checkConvex3(c),
    }],
    refuse: refuseBody,
  },
  {
    name: 'Bodies',
    kind: 'object',
    group: 'physics',
    forms: [{
      // first, so a list of solids in space makes bodies in space
      params: [P('solids', 'List<Polyhedron>|List<Sphere>|List<Cylinder>|List<Cone>'), ...BODY3_NAMED],
      returns: 'List<Body3>',
      rule: () => ({
        run(call: RuleCall) {
          const list = call.values[0];
          const one = body3Rule();
          return (Array.isArray(list) ? list : []).map((s) => one.run({ ...call, values: [s, ...call.values.slice(1)], fail: () => undefined } as RuleCall));
        },
      }),
      summary: 'a body in space for each solid in a list, all with the same settings',
      check: (c) => checkConvexList3(c),
    }, {
      // any list; the plane's shapes are named so the form of solids in space (fewer types) is chosen for those
      params: [P('shapes', 'List<Polygon>|List<Circle>|List<Conic>|List<Polyline>|List<Point>|List'), ...BODY_NAMED],
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
    forms: [
      { params: [P('centre', 'Point'), P('w', 'Number'), P('h', 'Number'), named('angle', 'Number')], returns: 'Polygon', rule: boxRule, summary: 'a box of width w and height h about its centre' },
      { params: [P('centre', 'Point3'), P('w', 'Number'), P('d', 'Number'), P('h', 'Number'), named('angle', 'Number')], returns: 'Polyhedron', rule: box3Rule, summary: 'a box in space, w along x, d along y and h along z about its centre, turned by angle about the up axis' },
    ],
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
    { params: [P('b', 'Any'), P('impulse', 'Vector3|Point3')], summary: 'kick a body in space at its centre (N s)' },
    { params: [P('b', 'Any'), P('impulse', 'Vector3|Point3'), P('at', 'Point3')], summary: 'kick a body in space at a point, so it also turns' },
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

const WORLD_FIELDS: Readonly<Record<string, Ty>> = { time: T.Number, energy: T.Number, momentum: T.Vector, awake: T.Number, contacts: T.Number, gravity: T.Vector, wind: T.Vector };

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
    case 'wind':
      return { x: v.windX, y: v.windY };
    default:
      return undefined;
  }
}

const V3T: Ty = { k: 'Vector3' } as Ty;
const BODY3_FIELDS: Readonly<Record<string, Ty>> = {
  pos: { k: 'Point3' } as Ty, x: T.Number, y: T.Number, z: T.Number, speed: V3T, v: T.Number, spin: V3T, energy: T.Number, kinetic: T.Number, potential: T.Number,
  momentum: V3T, mass: T.Number, asleep: T.Bool, touching: { k: 'List', of: T.Text },
  force: { k: 'Function', ret: 'Vector3', arity: 1, textArgs: true } as Ty,
};

function readBody3(field: string, v: unknown): unknown {
  if (!isBody3Value(v)) return undefined;
  switch (field) {
    case 'pos':
      return { x: v.x, y: v.y, z: v.z };
    case 'x':
      return v.x;
    case 'y':
      return v.y;
    case 'z':
      return v.z;
    case 'speed':
      return v.v;
    case 'v':
      return Math.sqrt(v.v.x * v.v.x + v.v.y * v.v.y + v.v.z * v.v.z);
    case 'spin':
      return v.spin;
    case 'energy':
      return v.energy;
    case 'kinetic':
      return v.kinetic;
    case 'potential':
      return v.potential;
    case 'momentum':
      return Number.isFinite(v.mass) ? { x: v.mass * v.v.x, y: v.mass * v.v.y, z: v.mass * v.v.z } : { x: 0, y: 0, z: 0 };
    case 'mass':
      return v.mass;
    case 'asleep':
      return v.asleep;
    case 'touching':
      return v.touching;
    case 'force':
      return {
        arity: 1,
        call: (kind: unknown) => {
          const k = FORCE_KINDS.indexOf(String(kind) as (typeof FORCE_KINDS)[number]);
          const f = v.forces;
          if (k < 0) return undefined;
          return f ? { x: f[k * 3] as number, y: f[k * 3 + 1] as number, z: f[k * 3 + 2] as number } : { x: 0, y: 0, z: 0 };
        },
      };
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

const WHEEL3_FIELDS: Readonly<Record<string, Ty>> = { spin: T.Number, pos: { k: 'Point3' } as Ty, force: T.Number, touching: T.Bool };

function readWheel3(field: string, v: unknown): unknown {
  if (!isWheel3Value(v)) return undefined;
  switch (field) {
    case 'spin':
      return v.spin;
    case 'pos':
      return { x: v.x, y: v.y, z: v.z };
    case 'force':
      return v.push;
    case 'touching':
      return v.touching;
    default:
      return undefined;
  }
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
  registry.registerAll(LIQUID_COMMANDS);
  registry.registerAll(SMOKE_COMMANDS);
  registry.registerAll(CLOTH_COMMANDS);
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
  registerWorldDriver((figure) => {
    const f = figure as Figure;
    const old = DRIVERS3.get(f);
    if (old) return old;
    const d = new Physics3Driver(f);
    DRIVERS3.set(f, d);
    return d;
  });
  for (const [type, fields, reader] of [['Body', BODY_FIELDS, readBody], ['World', WORLD_FIELDS, readWorld], ['Joint', JOINT_FIELDS, readJoint], ['Wheel', WHEEL_FIELDS, readWheel], ['Vehicle', VEHICLE_FIELDS, readVehicle], ['Body3', BODY3_FIELDS, readBody3], ['Wheel3', WHEEL3_FIELDS, readWheel3]] as const) {
    registerFieldNames(type, () => Object.keys(fields));
    registerFieldTyper(type, (field) => fields[field]);
    registerFieldReader(type, (field, v) => reader(field, v));
  }
  registerValueText((v) => {
    if (isBodyValue(v)) return `body at (${fmt(v.x)}, ${fmt(v.y)}), ${fmt(Math.sqrt(v.vx * v.vx + v.vy * v.vy))} m/s${v.asleep ? ', asleep' : ''}`;
    if (isBody3Value(v)) return `body at (${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)}), ${fmt(Math.sqrt(v.v.x ** 2 + v.v.y ** 2 + v.v.z ** 2))} m/s${v.asleep ? ', asleep' : ''}`;
    if (isWorldValue(v)) return `world, gravity (${fmt(v.gx)}, ${fmt(v.gy)})`;
    if (isJointValue(v)) return `${v.kind}${v.broken ? ', broken' : `, ${fmt(v.force)} N`}`;
    if (isWheelValue(v)) return `wheel, ${fmt(Math.abs(v.spin))} rad/s${v.broken ? ', broken off' : ''}`;
    if (isWheel3Value(v)) return `wheel at (${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)}), ${fmt(Math.abs(v.spin))} rad/s${v.touching ? `, ${fmt(v.push)} N` : ', in the air'}`;
    if (isVehicleValue(v)) return `vehicle, ${fmt(v.speedometer)} m/s`;
    return undefined;
  });
  registerTypeStyle('Body3', { lists: true, defaults: { color: '#c0602a', width: 2, opacity: 0.85 }, keys: ['bounce', 'friction', 'force', 'torque', 'group', 'show'] });
  registerTypeStyle('Body', { lists: true, defaults: { color: '#c0602a', width: 2, opacity: 0.35 }, keys: ['bounce', 'friction', 'force', 'torque', 'bullet', 'group', 'charge', 'show'] });
  registerTypeStyle('World', { drawable: false });
  registerTypeStyle('Joint', { defaults: { color: '#555555', width: 1.5 } });
  registerTypeStyle('Wheel', { defaults: { color: '#2b2f36', width: 2 } });
  registerTypeStyle('Wheel3', { lists: true, defaults: { color: '#2b2f36', width: 2 } });
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
  const SOLID3 = ['Polyhedron', 'Sphere', 'Cylinder', 'Cone', 'Plane'];
  registerPropertyTypes('solid', SOLID3);
  registerPropertyTypes('bounce', [...SOLID_TYPES, ...SOLID3, 'Body', 'Body3']);
  registerPropertyTypes('friction', [...SOLID_TYPES, ...SOLID3, 'Body', 'Body3']);
  registerPropertyTypes('show', ['Body3']);
  for (const k of ['force', 'torque', 'bullet', 'group', 'charge', 'show']) registerPropertyTypes(k, ['Body']);
  for (const k of ['force', 'torque', 'group']) registerPropertyTypes(k, ['Body3']);
  registerLineCheck(physicsLineCheck);
  registerLineRewriter(worldRewrite);
  registerLineRewriter(bodyWithRewrite);
  registerScriptTail((figure) => [...physicsOf(figure as Figure).inputLines(), ...physics3Of(figure as Figure).inputLines()]);
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
  registerNotice('worker_unavailable', { code: 'B108', severity: 'info', template: 'Liquids and cloth run on the page, so the film may play slower here. It is the same film.' });
  registerNotice('unstable_world', { code: 'B109', severity: 'warning', template: '{name} became unstable at t = {t} s: {hint}.' });
  registerNotice('physics_behind', { code: 'B110', severity: 'info', template: 'The film plays slower than real time on this computer; it is the same film.' });
  registerNotice('broken', { code: 'B111', severity: 'info', template: '{name} broke at t = {t} s.' });
  registerLiquids();
  registerSmoke();
  registerCloth();
}

const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(3))) : String(x));

export type { CheckedLine };
