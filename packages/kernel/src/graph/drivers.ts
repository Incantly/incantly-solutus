/**
 * World drivers (.kiro/specs/physics design, core hook 1): an area that owns a coupled system the object graph cannot
 * express one rule at a time (the physics world) plugs in a driver per figure. After each update pass the driver may
 * write the cells of the objects it owns; the figure then runs one more pass over what reads them.
 */
import type { Notice } from '../contracts/errors';
import type { ObjId } from '../contracts/values';
import type { ObjRec } from './core';
import type { Cell } from './types';

export interface WorldDriver {
  /** After a pass: write the cells of owned objects that changed, and return them. */
  afterPass(): readonly ObjRec[];
  /**
   * A rule run of an object the driver owns: `computed` is the rule's own value (the start); the driver returns the cell
   * the object should hold now, so readers never see the start by mistake mid-film. Absent or `undefined`: keep `computed`.
   */
  onCompute?(rec: ObjRec, computed: Cell): Cell | undefined;
  /** A free value was written (a slider, a drag): restart or log it. */
  noteFree?(rec: ObjRec, was: unknown): void;
  /** One `@input` line: `undefined` when taken, a reason text when refused, `false` when it is not this driver's. */
  inputLine?(words: readonly string[]): string | undefined | false;
  /** The driver is behind the clock and wants frames even while paused. */
  needsFrame?(): boolean;
  catchingUp?(): { readonly from: number; readonly to: number } | undefined;
  /** Warnings since the last call (unstable world, falling behind). */
  takeWarnings?(): Notice[];
  /** The objects it owns, for slices over the clock: the cell each has at a film time. */
  sample?(t: number): readonly (readonly [ObjRec, Cell])[] | undefined;
  /** The objects `sample` gives cells for. */
  sampleRecs?(): readonly ObjRec[];
  owns?(id: ObjId): boolean;
  /** `Restart()`: everything the driver owns goes back to its start at the current time. */
  onRestart?(): void;
  /** After a whole flush, outside any pass: run what the pass found (`on … hit` handlers). */
  afterFlush?(): void;
}

export type WorldDriverFactory = (figure: unknown) => WorldDriver | undefined;

const FACTORIES: WorldDriverFactory[] = [];

/** Registers a driver factory once; every figure makes its driver from it on first use. */
export function registerWorldDriver(factory: WorldDriverFactory): void {
  if (!FACTORIES.includes(factory)) FACTORIES.push(factory);
}

export function worldDriverFactories(): readonly WorldDriverFactory[] {
  return FACTORIES;
}
