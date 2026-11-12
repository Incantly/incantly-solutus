/**
 * Sampling of function closures inside rules. Everything here saves and restores the
 * shared environment (locals and the undefined reason), so sampling never disturbs the
 * evaluation in progress and stays correct inside `slice` runs.
 */
import type { UndefReason } from '../../contracts/values';
import type { Env, FunctionValue } from '../../language/runtime';
import type { RuleCall } from '../../graph/registry';

/** A scalar function that never throws; NaN means undefined there. */
export type Fn1 = (x: number) => number;

/** A scalar function of two variables that never throws; NaN means undefined there. */
export type Fn2 = (x: number, y: number) => number;

/** One-variable view of a `FunctionValue`, with the reason of the last undefined sample. */
export interface Sampled1 {
  readonly f: Fn1;
  /** Reason of the last undefined result, for rules that propagate why `f` failed. */
  lastReason: UndefReason | undefined;
}

function numOrNaN(v: unknown): number {
  return typeof v === 'number' ? v : Number.NaN;
}

/** Wraps a one-variable `FunctionValue` as a plain sampler. Never throws. */
export function sample1(fv: FunctionValue): Sampled1 {
  const out: Sampled1 = {
    lastReason: undefined,
    f: (x: number): number => {
      if (x !== x) {
        out.lastReason = 'not_finite';
        return Number.NaN;
      }
      let v: number | object | boolean | undefined;
      try {
        v = fv.call1 ? fv.call1(x) : fv.call(x);
      } catch {
        out.lastReason = 'not_finite';
        return Number.NaN;
      }
      const n = numOrNaN(v);
      out.lastReason = n !== n ? (fv.reason ?? 'not_finite') : undefined;
      return n;
    },
  };
  return out;
}

/** Wraps a two-variable `FunctionValue` as a plain sampler. Never throws. */
export function sample2(fv: FunctionValue): { readonly f: Fn2; lastReason: UndefReason | undefined } {
  const out: { f: Fn2; lastReason: UndefReason | undefined } = {
    lastReason: undefined,
    f: (x: number, y: number): number => {
      if (x !== x || y !== y) {
        out.lastReason = 'not_finite';
        return Number.NaN;
      }
      let v: number | object | boolean | undefined;
      try {
        v = fv.call(x, y);
      } catch {
        out.lastReason = 'not_finite';
        return Number.NaN;
      }
      const n = numOrNaN(v);
      out.lastReason = n !== n ? (fv.reason ?? 'not_finite') : undefined;
      return n;
    },
  };
  return out;
}

/** Wraps an n-ary `FunctionValue` (for ODE right-hand sides). Never throws. */
export function sampleN(fv: FunctionValue): { readonly f: (xs: readonly number[]) => number; lastReason: UndefReason | undefined } {
  const out: { f: (xs: readonly number[]) => number; lastReason: UndefReason | undefined } = {
    lastReason: undefined,
    f: (xs: readonly number[]): number => {
      let v: number | object | boolean | undefined;
      try {
        v = fv.call(...xs);
      } catch {
        out.lastReason = 'not_finite';
        return Number.NaN;
      }
      const n = numOrNaN(v);
      out.lastReason = n !== n ? (fv.reason ?? 'not_finite') : undefined;
      return n;
    },
  };
  return out;
}

/**
 * A body argument (`Curve(x(s), y(s), s, a, b)`) as a sampler over the binder's slot.
 * Returns null when the argument has no evaluator. Never throws.
 */
export function sampleBody(call: RuleCall, arg: number, slot: number): Fn1 | null {
  const ev = call.args[arg]?.eval;
  if (!ev) return null;
  const env: Env = call.env;
  return (s: number): number => {
    if (s !== s) return Number.NaN;
    const saveLocal: unknown = env.locals[slot];
    const saveReason = env.reason;
    const saveCause = env.cause;
    const saveDetail = env.detail;
    env.locals[slot] = s;
    env.reason = undefined;
    env.cause = undefined;
    env.detail = undefined;
    let v: unknown;
    try {
      v = ev(env);
    } catch {
      v = Number.NaN;
    }
    env.locals[slot] = saveLocal;
    env.reason = saveReason;
    env.cause = saveCause;
    env.detail = saveDetail;
    return numOrNaN(v);
  };
}

/** Reads a Number argument; undefined when it is missing or not a number. */
export function numArg(call: RuleCall, i: number): number | undefined {
  const v = call.values[i];
  return typeof v === 'number' ? v : undefined;
}

/** True for a finite number. */
export function isFin(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
