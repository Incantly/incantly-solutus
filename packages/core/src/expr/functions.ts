export interface FunctionSpec {
  readonly arity: number | readonly [min: number, max: number];
  readonly fn: (...args: number[]) => number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/**
 * Functions a formula may call. Built with a null prototype so names like
 * `constructor` or `__proto__` can never resolve to anything.
 */
export const FUNCTIONS: Readonly<Record<string, FunctionSpec>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, FunctionSpec>, {
    sin: { arity: 1, fn: Math.sin },
    cos: { arity: 1, fn: Math.cos },
    tan: { arity: 1, fn: Math.tan },
    asin: { arity: 1, fn: Math.asin },
    acos: { arity: 1, fn: Math.acos },
    atan: { arity: 1, fn: Math.atan },
    atan2: { arity: 2, fn: Math.atan2 },
    sinh: { arity: 1, fn: Math.sinh },
    cosh: { arity: 1, fn: Math.cosh },
    tanh: { arity: 1, fn: Math.tanh },
    sqrt: { arity: 1, fn: Math.sqrt },
    cbrt: { arity: 1, fn: Math.cbrt },
    exp: { arity: 1, fn: Math.exp },
    ln: { arity: 1, fn: Math.log },
    log: { arity: 1, fn: Math.log },
    log10: { arity: 1, fn: Math.log10 },
    log2: { arity: 1, fn: Math.log2 },
    abs: { arity: 1, fn: Math.abs },
    sign: { arity: 1, fn: Math.sign },
    floor: { arity: 1, fn: Math.floor },
    ceil: { arity: 1, fn: Math.ceil },
    round: { arity: 1, fn: Math.round },
    min: { arity: [1, 16], fn: Math.min },
    max: { arity: [1, 16], fn: Math.max },
    pow: { arity: 2, fn: Math.pow },
    hypot: { arity: [1, 16], fn: Math.hypot },
    clamp: { arity: 3, fn: clamp },
    step: { arity: 1, fn: (x: number) => (x < 0 ? 0 : 1) },
  } satisfies Record<string, FunctionSpec>),
);

export const CONSTANTS: Readonly<Record<string, number>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, number>, {
    pi: Math.PI,
    PI: Math.PI,
    tau: 2 * Math.PI,
    e: Math.E,
  }),
);

export function isReservedName(name: string): boolean {
  return Object.hasOwn(FUNCTIONS, name) || Object.hasOwn(CONSTANTS, name);
}
