/**
 * Vehicles (docs/features/physics/design.md 2.4, 8): `Wheel(chassis, at, r)` and `Vehicle(chassis, wheels, motor = …)`.
 * In the plane a wheel is a round body on a suspension joint fixed in the chassis; the vehicle drives the wheels marked
 * `drive` and brakes them all. The driver builds both into the world (`./driver`).
 */
import type { ObjId } from '../../contracts/values';
import type { RuleCall } from '../../graph/registry';
import type { CallCheck, CommandForm, CommandSpec, ParamSpec, Refusal } from '../../language/table';
import type { JointEnd, JointEnd3 } from './joints';
import { mixedRefusal } from './joints';
import { isBodyValue } from './types';
import { isBody3Value } from './body3';

export interface WheelValue {
  readonly schema: 'Wheel';
  readonly chassis: JointEnd;
  /** Where the wheel's centre is at the start, and its radius. */
  readonly at: { readonly x: number; readonly y: number };
  readonly r: number;
  readonly spring: number;
  readonly damping: number;
  readonly travel: number;
  readonly grip: number;
  readonly drive: boolean;
  readonly steers: boolean;
  readonly breaks: number;
  readonly mass?: number;
  /** Written by the driver: where the wheel is and how far it has turned. */
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly spin: number;
  readonly broken: boolean;
}

export interface VehicleValue {
  readonly schema: 'Vehicle';
  readonly chassis: JointEnd;
  /** The wheels by object (and item), as the driver finds them. */
  readonly wheels: readonly { readonly id?: ObjId; readonly at: { readonly x: number; readonly y: number } }[];
  readonly motor: number;
  readonly steer: number;
  readonly brake: number;
  readonly power: number;
  /** Written by the driver: forward speed, m/s. */
  readonly speedometer: number;
}

export function isWheelValue(v: unknown): v is WheelValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Wheel';
}

/** A wheel of a car in space (design 8): a ray wheel on its chassis. */
export interface Wheel3Value {
  readonly schema: 'Wheel3';
  readonly chassis: JointEnd3;
  /** Where the wheel's centre is at the start, with its spring at full travel, and its radius. */
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
  readonly r: number;
  readonly spring: number;
  readonly damping: number;
  readonly travel: number;
  readonly grip: number;
  readonly drive: boolean;
  readonly steers: boolean;
  readonly breaks: number;
  readonly mass: number;
  /** Written by the driver: the centre now, the axle, a spoke (so its turn shows), its spin and its spring's push. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly axle: { readonly x: number; readonly y: number; readonly z: number };
  readonly spoke: { readonly x: number; readonly y: number; readonly z: number };
  readonly spin: number;
  readonly push: number;
  readonly touching: boolean;
}

/** A car in space: its chassis, its wheels, the pedals; the driver writes its speed and any wheel that came off. */
export interface Vehicle3Value {
  readonly schema: 'Vehicle';
  readonly space: true;
  readonly chassis: JointEnd3;
  readonly wheels: readonly { readonly at: { readonly x: number; readonly y: number; readonly z: number } }[];
  readonly motor: number;
  readonly steer: number;
  readonly brake: number;
  readonly power: number;
  readonly speedometer: number;
  /** Wheels that came off, where they are now (drawn as free wheels). */
  readonly loose: readonly LooseWheel[];
}

export interface LooseWheel {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly axle: { readonly x: number; readonly y: number; readonly z: number };
  readonly spoke: { readonly x: number; readonly y: number; readonly z: number };
  readonly r: number;
}

export function isWheel3Value(v: unknown): v is Wheel3Value {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Wheel3';
}

export function isVehicle3Value(v: unknown): v is Vehicle3Value {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Vehicle' && (v as { space?: unknown }).space === true;
}

export function isVehicleValue(v: unknown): v is VehicleValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Vehicle';
}

const P = (name: string, type: string, extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });
const named = (name: string, type: string): ParamSpec => P(name, type, { optional: true, named: true });
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const pt = (v: unknown): { x: number; y: number } | undefined => {
  const p = v as { x?: unknown; y?: unknown } | undefined;
  return p && typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : undefined;
};

function chassisOf(call: RuleCall): JointEnd | undefined {
  const v = call.values[0];
  if (!isBodyValue(v)) return undefined;
  const id = call.ids[0];
  return { ...(id !== undefined ? { id } : {}), spec: v.spec, x: v.spec.cx, y: v.spec.cy, body: true };
}

function chassis3Of(call: RuleCall): JointEnd3 | undefined {
  const v = call.values[0];
  if (!isBody3Value(v)) return undefined;
  const id = call.ids[0];
  return { ...(id !== undefined ? { id } : {}), spec: v.spec, x: v.spec.cx, y: v.spec.cy, z: v.spec.cz, body: true };
}

const pt3 = (v: unknown): { x: number; y: number; z: number } | undefined => {
  const p = v as { x?: unknown; y?: unknown; z?: unknown } | undefined;
  return p && typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number' && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? { x: p.x, y: p.y, z: p.z } : undefined;
};

/** A car in the plane with a wheel in space, or the reverse (errors B010). */
function mixedCar(command: string): (c: CallCheck) => Refusal | undefined {
  return (c) => mixedRefusal(command, c, [0, 1]);
}

/** `Wheel(chassis, at, r)` on a body in space: a ray wheel (design 8). `at` is its centre at the start, its spring at full travel. */
const WHEEL3_FORM: CommandForm = {
  params: [P('chassis', 'Body3'), P('at', 'Point3'), P('r', 'Number'), named('spring', 'Number'), named('damping', 'Number'), named('travel', 'Number'), named('grip', 'Number'), named('drive', 'Bool'), named('steers', 'Bool'), named('breaks', 'Number'), named('mass', 'Number')],
  returns: 'Wheel3',
  summary: 'a ray wheel of radius r on a chassis in space, its centre at a point, on a spring',
  check: (c) => {
    const r = c.args[2];
    if (r && typeof r.literal === 'number' && !(r.literal > 0)) return { kind: 'bad_argument', message: 'A wheel needs a radius above 0.', param: 2, params: { command: 'Wheel', why: 'the radius must be above 0' } };
    return undefined;
  },
  rule: () => ({
    run(call: RuleCall) {
      const ch = chassis3Of(call);
      const at = pt3(call.values[1]);
      const r = num(call.values[2], 0);
      if (!ch || !at) return call.fail('input_undefined', 'the chassis or the wheel point is undefined');
      if (!(r > 0)) return call.fail('degenerate', 'a wheel needs a radius above 0');
      const [, , , spring, damping, travel, grip, drive, steers, breaks, mass] = call.values;
      const cm = Math.max(1, ch.spec?.massNow ?? 1);
      const v: Wheel3Value = {
        schema: 'Wheel3', chassis: ch, at, r,
        // four wheels hold the chassis a few centimetres down at rest, damped to about half of critical
        spring: Math.max(0, num(spring, 30 * cm)), damping: Math.max(0, num(damping, (2 * Math.sqrt(30) * cm) / 4)),
        travel: Math.max(0.01, num(travel, Math.max(0.1, r * 0.6))), grip: Math.max(0, num(grip, 1)), drive: bool(drive, true), steers: bool(steers, false),
        breaks: Math.max(0, num(breaks, 0)), mass: num(mass, 0) > 0 ? num(mass, 0) : Math.max(0.5, cm * 0.04),
        x: at.x, y: at.y, z: at.z, axle: { x: 0, y: 1, z: 0 }, spoke: { x: 0, y: 0, z: 1 }, spin: 0, push: 0, touching: false,
      };
      return v;
    },
  }),
};

/** `Vehicle(chassis, wheels)` on a body in space: the pedals and the steering of its wheels. */
const VEHICLE3_FORM: CommandForm = {
  params: [P('chassis', 'Body3'), P('wheels', 'List'), named('motor', 'Number'), named('steer', 'Number'), named('brake', 'Number'), named('power', 'Number')],
  returns: 'Vehicle',
  summary: 'a car in space: the chassis and its wheels; motor (−1 to 1), steer (an angle, left is positive), brake (0 to 1) and power (W)',
  rule: () => ({
    run(call: RuleCall) {
      const ch = chassis3Of(call);
      const list = call.values[1];
      if (!ch || !Array.isArray(list)) return call.fail('input_undefined', 'the chassis or the wheels are undefined');
      const wheels = list.filter(isWheel3Value).map((w) => ({ at: w.at }));
      if (wheels.length === 0) return call.fail('empty_list', 'a vehicle needs at least one wheel');
      const [, , motor, steer, brake, power] = call.values;
      const v: Vehicle3Value = {
        schema: 'Vehicle', space: true, chassis: ch, wheels, motor: Math.max(-1, Math.min(1, num(motor, 0))), steer: Math.max(-1.2, Math.min(1.2, num(steer, 0))), brake: Math.max(0, Math.min(1, num(brake, 0))),
        power: Math.max(0, num(power, 20 * Math.max(1, ch.spec?.massNow ?? 1))), speedometer: 0, loose: [],
      };
      return v;
    },
  }),
};

export const VEHICLE_COMMANDS: readonly CommandSpec[] = [
  {
    name: 'Wheel',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('chassis', 'Body'), P('at', 'Point'), P('r', 'Number'), named('spring', 'Number'), named('damping', 'Number'), named('travel', 'Number'), named('grip', 'Number'), named('drive', 'Bool'), named('steers', 'Bool'), named('breaks', 'Number'), named('mass', 'Number')],
      returns: 'Wheel',
      summary: 'a wheel of radius r on the chassis at a point, on a spring',
      check: (c) => {
        const r = c.args[2];
        if (r && typeof r.literal === 'number' && !(r.literal > 0)) return { kind: 'bad_argument', message: 'A wheel needs a radius above 0.', param: 2, params: { command: 'Wheel', why: 'the radius must be above 0' } };
        return undefined;
      },
      rule: () => ({
        run(call: RuleCall) {
          const ch = chassisOf(call);
          const at = pt(call.values[1]);
          const r = num(call.values[2], 0);
          if (!ch || !at) return call.fail('input_undefined', 'the chassis or the wheel point is undefined');
          if (!(r > 0)) return call.fail('degenerate', 'a wheel needs a radius above 0');
          const [, , , spring, damping, travel, grip, drive, steers, breaks, mass] = call.values;
          const m = num(mass, 0);
          const v: WheelValue = {
            schema: 'Wheel', chassis: ch, at, r,
            spring: Math.max(0, num(spring, 30 * Math.max(1, ch.spec?.massNow ?? 1))), damping: Math.max(0, num(damping, 2 * Math.sqrt(30) * Math.max(1, ch.spec?.massNow ?? 1) / 4)),
            travel: Math.max(0.01, num(travel, Math.max(0.1, r * 0.6))), grip: Math.max(0, num(grip, 1)), drive: bool(drive, true), steers: bool(steers, false),
            breaks: Math.max(0, num(breaks, 0)), ...(m > 0 ? { mass: m } : {}),
            x: at.x, y: at.y, angle: 0, spin: 0, broken: false,
          };
          return v;
        },
      }),
    }, WHEEL3_FORM],
    refuse: mixedCar('Wheel'),
  },
  {
    name: 'Vehicle',
    kind: 'object',
    group: 'physics',
    forms: [{
      params: [P('chassis', 'Body'), P('wheels', 'List'), named('motor', 'Number'), named('steer', 'Number'), named('brake', 'Number'), named('power', 'Number')],
      returns: 'Vehicle',
      summary: 'a car: the chassis and its wheels; motor (−1 to 1), steer, brake (0 to 1) and power are usually sliders',
      rule: () => ({
        run(call: RuleCall) {
          const ch = chassisOf(call);
          const list = call.values[1];
          if (!ch || !Array.isArray(list)) return call.fail('input_undefined', 'the chassis or the wheels are undefined');
          const wheels = list.filter(isWheelValue).map((w) => ({ at: w.at }));
          if (wheels.length === 0) return call.fail('empty_list', 'a vehicle needs at least one wheel');
          const [, , motor, steer, brake, power] = call.values;
          const v: VehicleValue = {
            schema: 'Vehicle', chassis: ch, wheels, motor: Math.max(-1, Math.min(1, num(motor, 0))), steer: num(steer, 0), brake: Math.max(0, Math.min(1, num(brake, 0))),
            power: Math.max(0, num(power, 20 * Math.max(1, ch.spec?.massNow ?? 1))), speedometer: 0,
          };
          return v;
        },
      }),
    }, VEHICLE3_FORM],
    refuse: mixedCar('Vehicle'),
  },
];
