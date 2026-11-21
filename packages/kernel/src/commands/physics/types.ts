/**
 * Values of the physics area (docs/features/physics/design.md 2.2): bodies, the world, joints. Plain data: the driver
 * (`./driver`) writes a body's pose into its value after each pass.
 */
import type {} from '../../contracts/values';
import type { Cell } from '../../graph/types';
import type { ShapeDef2 } from '../../physics/world2';

declare module '../../contracts/values' {
  interface AreaTypeNames {
    Body: true;
    World: true;
    Joint: true;
    Wheel: true;
    Wheel3: true;
    Vehicle: true;
  }
  interface AreaUndefReasons {
    self_crossing: true;
    unstable_world: true;
    broken: true;
    left_world: true;
  }
}

export interface Pt2 {
  readonly x: number;
  readonly y: number;
}

/** What a body is drawn as and what `b.shape` gives, at the start (world space). */
export type Outline =
  | { readonly kind: 'polygon'; readonly pts: readonly Pt2[] }
  | { readonly kind: 'circle'; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly kind: 'ellipse'; readonly pts: readonly Pt2[]; readonly cx: number; readonly cy: number; readonly ux: number; readonly uy: number; readonly a: number; readonly b: number };

/** The start of a body: what it is made of and how it starts. Equal specs give the same film. */
export interface BodySpec {
  readonly shapes: readonly ShapeDef2[];
  readonly outline: Outline;
  /** Convex parts the shape was split into. */
  readonly parts: number;
  readonly mass?: number;
  readonly density: number;
  readonly vx: number;
  readonly vy: number;
  readonly spin: number;
  readonly bounce: number;
  readonly friction: number;
  readonly turns: boolean;
  readonly bullet: boolean;
  readonly fixed: boolean;
  readonly group: number;
  readonly charge: number;
  /** Seconds the body burns (design 9.7); left out when it does not burn, so such a body has its old spec. */
  readonly burns?: number;
  /** °C above the air at which it lights (150 to 1,000); left out with `burns`. */
  readonly ignite?: number;
  /** Centre of mass and mass at the start. */
  readonly cx: number;
  readonly cy: number;
  readonly massNow: number;
}

/** A body's value: its start, and where it is now. */
export interface BodyValue {
  readonly schema: 'Body';
  readonly spec: BodySpec;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
  readonly vx: number;
  readonly vy: number;
  readonly spin: number;
  readonly asleep: boolean;
  readonly mass: number;
  readonly inertia: number;
  readonly energy: number;
  readonly kinetic: number;
  readonly potential: number;
  /** Forces by kind in the last step, as x and y pairs in the order of `FORCE_KINDS`. */
  readonly forces?: Float64Array;
  /** Names of what it touches now. */
  readonly touching: readonly string[];
  /** False while the film has not reached a step (the start). */
  readonly moving: boolean;
  /** A body that burns (design 9.7): its temperature (°C above the air), how much of it has burnt (0 to 1), and whether it burns now. */
  readonly temperature?: number;
  readonly burnt?: number;
  readonly burning?: boolean;
}

export function isBodyValue(v: unknown): v is BodyValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Body';
}

/** The world's settings and readouts (design 2.3). */
export interface WorldValue {
  readonly schema: 'World';
  readonly gx: number;
  readonly gy: number;
  /** Gravity in space: written in three numbers, or the flat gravity turned so its y is down the z axis. */
  readonly gz: number;
  readonly g3: boolean;
  readonly air: number;
  readonly passes: number;
  /** Steps per second (the step is 1/rate). */
  readonly rate: number;
  readonly sleep: boolean;
  readonly range: number;
  readonly show: string;
  /** Moving air, m/s (design 2.3): smoke feels it at its grid's edges; z for cloth in space. */
  readonly windX: number;
  readonly windY: number;
  readonly windZ: number;
  readonly time: number;
  readonly energy: number;
  readonly momentumX: number;
  readonly momentumY: number;
  readonly awake: number;
  readonly contacts: number;
}

export function isWorldValue(v: unknown): v is WorldValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'World';
}

export const DEFAULT_WORLD: WorldValue = Object.freeze({
  schema: 'World', gx: 0, gy: -9.8, gz: -9.8, g3: false, air: 0, passes: 8, rate: 120, sleep: true, range: 50, show: 'bodies', windX: 0, windY: 0, windZ: 0, time: 0, energy: 0, momentumX: 0, momentumY: 0, awake: 0, contacts: 0,
});

export const SHOW_WORDS = ['bodies', 'forces', 'speeds', 'contacts', 'none'] as const;

const BUFFER_KEYS = ['forces', 'xs', 'ys', 'zs', 'heights', 'density', 'temp'] as const;

/**
 * A copy of a cell's value for the physics worker's reply (design 9.6): every typed array in it is copied, the copy's
 * buffer is added to `out` to move to the page, and the worker's own arrays stay whole (a cell that did not change
 * is sent again next frame, and the worker reads it). A value with no typed array is returned as it is.
 */
export function copyForMove(v: unknown, out: ArrayBuffer[], depth: number): unknown {
  if (depth > 3 || typeof v !== 'object' || v === null) return v;
  if (ArrayBuffer.isView(v)) {
    if (v instanceof DataView) return v;
    const copy = (v as unknown as { slice(): ArrayBufferView }).slice();
    const b = copy.buffer;
    if (b instanceof ArrayBuffer) out.push(b);
    return copy;
  }
  if (Array.isArray(v)) {
    let list: unknown[] | undefined;
    for (let i = 0; i < v.length; i++) {
      const x = copyForMove(v[i], out, depth + 1);
      if (x !== v[i]) {
        list ??= v.slice();
        list[i] = x;
      }
    }
    return list ?? v;
  }
  let made: Record<string, unknown> | undefined;
  const o = v as Record<string, unknown>;
  for (const k of BUFFER_KEYS) {
    const x = o[k];
    if (x === undefined) continue;
    const y = copyForMove(x, out, depth + 1);
    if (y !== x) {
      made ??= { ...o };
      made[k] = y;
    }
  }
  return made ?? v;
}

/** The cell as the worker sends it: a defined cell's value copied by `copyForMove`, its buffers added to `out`. */
export function cellForMove(c: Cell, out: ArrayBuffer[]): Cell {
  if (!c.defined) return c;
  const value = copyForMove(c.value, out, 0);
  return value === c.value ? c : { defined: true, value };
}
