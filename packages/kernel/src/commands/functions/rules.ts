/**
 * Shared rule helpers of the functions area: spec builders, `FunctionValue`
 * constructors with per-evaluation reasons, and line constructors.
 */
import type { UndefReason } from '../../contracts/values';
import type { RuleCall } from '../../graph/registry';
import { formatNumber } from '../../language/runtime';
import type { FunctionValue } from '../../language/runtime';
import type { CommandForm, CommandSpec, ParamSpec } from '../../language/table';
import type { Line3 } from './types';

export const p = (name: string, type: string, extra?: Partial<ParamSpec>): ParamSpec => ({ name, type, ...(extra ?? {}) });

export function form(params: readonly ParamSpec[], returns: string, run: (call: RuleCall) => unknown, summary: string): CommandForm {
  return { params, returns, rule: () => ({ run }), summary };
}

export function objSpec(name: string, forms: readonly CommandForm[]): CommandSpec {
  return { name, kind: 'object', group: 'functions', forms };
}

/** A one-variable `FunctionValue` whose undefined reason comes from `reasonOf` per call. Never throws. */
export function fn1Value(f: (x: number) => number, reasonOf: () => UndefReason | undefined): FunctionValue {
  const fv: FunctionValue = {
    arity: 1,
    ret: 'Number',
    reason: undefined,
    call: (...xs: number[]) => {
      const x = xs[0];
      let v: number;
      try {
        v = typeof x === 'number' ? f(x) : Number.NaN;
      } catch {
        v = Number.NaN;
      }
      if (typeof v !== 'number') v = Number.NaN;
      fv.reason = v !== v ? reasonOf() : undefined;
      return v;
    },
  };
  fv.call1 = (x: number): number => {
    let v: number;
    try {
      v = f(x);
    } catch {
      v = Number.NaN;
    }
    if (typeof v !== 'number') v = Number.NaN;
    fv.reason = v !== v ? reasonOf() : undefined;
    return v;
  };
  fv.batch = (xs: Float64Array, out: Float64Array): void => {
    for (let i = 0; i < xs.length; i++) {
      let v: number;
      try {
        v = f(xs[i] as number);
      } catch {
        v = Number.NaN;
      }
      out[i] = typeof v === 'number' ? v : Number.NaN;
    }
  };
  return fv;
}

/** A two-variable `FunctionValue` with per-call reasons. Never throws. */
export function fn2Value(f: (x: number, y: number) => number, reasonOf: () => UndefReason | undefined): FunctionValue {
  const fv: FunctionValue = {
    arity: 2,
    ret: 'Number',
    reason: undefined,
    call: (...xs: number[]) => {
      const x = xs[0];
      const y = xs[1];
      let v: number;
      try {
        v = typeof x === 'number' && typeof y === 'number' ? f(x, y) : Number.NaN;
      } catch {
        v = Number.NaN;
      }
      if (typeof v !== 'number') v = Number.NaN;
      fv.reason = v !== v ? reasonOf() : undefined;
      return v;
    },
  };
  return fv;
}

/**
 * A normalized line `ax + by = c` through `(px, py)` with direction `(dx, dy)`.
 * Null when the direction is zero. Canonical sign: the first nonzero of (a, b)
 * is positive, so the same line always compares equal.
 */
export function lineFromPointDir(px: number, py: number, dx: number, dy: number): Line3 | null {
  const n = Math.hypot(dx, dy);
  if (!(n > 0) || px !== px || py !== py || dx !== dx || dy !== dy) return null;
  let a = dy / n;
  let b = -dx / n;
  let c = a * px + b * py;
  if (a < 0 || (a === 0 && b < 0)) {
    a = -a;
    b = -b;
    c = -c;
  }
  return { a, b, c };
}

/** A normalized line through `(px, py)` with slope `m` (vertical when not finite). */
export function lineFromPointSlope(px: number, py: number, m: number): Line3 | null {
  if (m !== m) return null;
  if (m === Infinity || m === -Infinity) return { a: 1, b: 0, c: px };
  return lineFromPointDir(px, py, 1, m);
}

/** Short text of a number for undefined details. */
export function fmt(v: number): string {
  return formatNumber(v);
}

/** True for an integer in `[lo, hi]`. */
export function intIn(v: number, lo: number, hi: number): boolean {
  return Number.isInteger(v) && v >= lo && v <= hi;
}
