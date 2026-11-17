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
}

export function isBodyValue(v: unknown): v is BodyValue {
  return typeof v === 'object' && v !== null && (v as { schema?: unknown }).schema === 'Body';
}

/** The world's settings and readouts (design 2.3). */
export interface WorldValue {
  readonly schema: 'World';
  readonly gx: number;
  readonly gy: number;
  readonly air: number;
  readonly passes: number;
  /** Steps per second (the step is 1/rate). */
  readonly rate: number;
  readonly sleep: boolean;
  readonly range: number;
  readonly show: string;
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
  schema: 'World', gx: 0, gy: -9.8, air: 0, passes: 8, rate: 120, sleep: true, range: 50, show: 'bodies', time: 0, energy: 0, momentumX: 0, momentumY: 0, awake: 0, contacts: 0,
});

export const SHOW_WORDS = ['bodies', 'forces', 'speeds', 'contacts', 'none'] as const;
