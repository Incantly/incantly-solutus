/**
 * Values of the physics area (docs/features/physics/design.md 2.2): bodies, the world, joints. Plain data: the driver
 * (`./driver`) writes a body's pose into its value after each pass.
 */
import type {} from '../../contracts/values';
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

/** The typed arrays inside a cell's value, to move to the page from the physics worker instead of copying (design 9.6). */
export function collectBuffers(v: unknown, out: ArrayBuffer[], depth: number): void {
  if (depth > 3 || typeof v !== 'object' || v === null) return;
  if (ArrayBuffer.isView(v)) {
    const b = v.buffer;
    if (b instanceof ArrayBuffer && !out.includes(b)) out.push(b);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectBuffers(x, out, depth + 1);
    return;
  }
  for (const k of ['forces', 'xs', 'ys', 'zs', 'heights', 'density', 'temp'] as const) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== undefined) collectBuffers(x, out, depth + 1);
  }
}
