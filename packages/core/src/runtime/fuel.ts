/**
 * Loop fuel. Instrumented scene code burns one unit at the start of every loop
 * body and function body (see validation/instrument.ts). The Worker refuels
 * before each message, so a loop that never ends fails within milliseconds
 * with a precise message, long before the watchdog would have to step in.
 */

/** Fuel for one message: one mount, one frame or one probe step. */
export const FUEL_PER_STEP = 250_000;

export class RunawayError extends Error {
  constructor(limit: number) {
    super(
      `The scene ran more than ${limit.toLocaleString('en-US')} loop iterations or calls in one step; ` +
        'a loop or chain of calls never finishes',
    );
    this.name = 'RunawayError';
  }
}

export interface FuelTank {
  /** Called by instrumented code. Throws once the tank is empty. */
  readonly burn: () => void;
  readonly refuel: () => void;
  readonly remaining: () => number;
}

export function createFuel(limit: number = FUEL_PER_STEP): FuelTank {
  let left = limit;
  return {
    burn: () => {
      if (--left < 0) throw new RunawayError(limit);
    },
    refuel: () => {
      left = limit;
    },
    remaining: () => Math.max(0, left),
  };
}

export function isRunaway(error: unknown): boolean {
  return error instanceof RunawayError || (isErrorLike(error) && error.name === 'RunawayError');
}

export interface ErrorLike {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/**
 * Whether a thrown value looks like an Error. Scenes can run in another realm
 * (a Worker, or the isolated context of the eval probe), where `instanceof
 * Error` is false for the errors they throw.
 */
export function isErrorLike(error: unknown): error is ErrorLike {
  if (typeof error !== 'object' || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return typeof message === 'string' && typeof name === 'string';
}
