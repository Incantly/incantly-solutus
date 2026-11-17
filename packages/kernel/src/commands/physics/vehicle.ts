/**
 * Vehicles (docs/features/physics/design.md 2.4, 8): `Wheel(chassis, at, r)` and `Vehicle(chassis, wheels, motor = …)`.
 * In the plane a wheel is a round body on a suspension joint fixed in the chassis; the vehicle drives the wheels marked
 * `drive` and brakes them all. The driver builds both into the world (`./driver`).
 */
import type { ObjId } from '../../contracts/values';
import type { RuleCall } from '../../graph/registry';
import type { CommandSpec, ParamSpec } from '../../language/table';
import type { JointEnd } from './joints';
import { isBodyValue } from './types';

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
    }],
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
    }],
  },
];
