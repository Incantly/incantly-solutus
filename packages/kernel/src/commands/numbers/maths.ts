/**
 * Number maths functions (numbers-sliders/design.md 3.1, 9.1): sig, snap, wrap,
 * approx, and the turn/grad constants. round(x, n) already exists as a built-in;
 * deg exists as a constant and turn equals the tau constant.
 *
 * Each function has a pure number implementation plus a FunctionSpec so hosts can
 * add the group to the language through FigureOptions.functions (there is no
 * registry hook for built-in functions).
 */

import { BUILTIN_FUNCTION_SPECS, constantByName } from '../../language/builtins';
import { fail } from '../../language/runtime';
import type { Env } from '../../language/runtime';
import { createFunctionTable } from '../../language/table';
import type { FunctionSpec, FunctionTable, ParamSpec } from '../../language/table';
import { numberSource } from '../../graph/values';
import { decimals } from './commit';

/** τ: one turn in radians. Same value as the tau constant. */
export const TURN = 2 * Math.PI;
/** One gradian in radians: π/200. */
export const GRAD = Math.PI / 200;

const roundHalfAway = (x: number): number => (x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5));

/**
 * Round to n significant figures (half away from zero on the decimal expansion).
 * Returns NaN for a bad n (non-integer or < 1); the spec wrapper records the reason.
 */
export function sigNumber(x: number, n: number): number {
  if (typeof x !== 'number' || typeof n !== 'number') return NaN;
  if (!Number.isInteger(n) || n < 1) return NaN;
  if (x === 0) return 0;
  if (!Number.isFinite(x)) return x;
  const sign = x < 0 ? '-' : '';
  const s = String(Math.abs(x));
  const e = s.indexOf('e');
  const mantissa = e < 0 ? s : s.slice(0, e);
  const exp10 = e < 0 ? 0 : Number(s.slice(e + 1));
  const dot = mantissa.indexOf('.');
  const intPart = dot < 0 ? mantissa : mantissa.slice(0, dot);
  const fracPart = dot < 0 ? '' : mantissa.slice(dot + 1);
  const stripped = (intPart + fracPart).replace(/^0+/, '');
  if (stripped === '') return 0;
  const exp = exp10 - fracPart.length + stripped.length;
  let digits = stripped;
  let outExp = exp;
  if (digits.length > n) {
    const head = BigInt(digits.slice(0, n));
    const tailLen = digits.length - n;
    const tail = BigInt(digits.slice(n));
    const r = tail * 2n >= 10n ** BigInt(tailLen) ? head + 1n : head;
    digits = r.toString();
    if (digits.length > n) {
      digits = '1' + '0'.repeat(n - 1);
      outExp += 1;
    }
  }
  // 0.digits * 10^outExp as a decimal string, parsed back once.
  const e1 = outExp - 1;
  let text: string;
  if (e1 >= 0 && e1 < digits.length) {
    text = `${digits.slice(0, e1 + 1)}.${digits.slice(e1 + 1)}`;
  } else if (e1 >= digits.length) {
    text = digits + '0'.repeat(e1 - digits.length + 1);
  } else if (e1 >= -6) {
    text = `0.${'0'.repeat(-e1 - 1)}${digits}`;
  } else {
    text = `${digits[0]}.${digits.slice(1) || '0'}e${e1}`;
  }
  const v = Number(sign + text);
  return Object.is(v, -0) ? 0 : v;
}

/** Snap x to a multiple of step counted from 0, with decimal repair. NaN for a bad step. */
export function snapNumber(x: number, step: number): number {
  if (typeof x !== 'number' || typeof step !== 'number') return NaN;
  if (!Number.isFinite(x) || !Number.isFinite(step) || !(step > 0)) return NaN;
  const k = roundHalfAway(x / step);
  const d = Math.min(12, Math.max(decimals(step), 0));
  return Number((k * step).toFixed(d));
}

/** Wrap x into [lo, hi). NaN for a bad range or non-finite x. */
export function wrapNumber(x: number, lo: number, hi: number): number {
  if (typeof x !== 'number' || typeof lo !== 'number' || typeof hi !== 'number') return NaN;
  if (!Number.isFinite(x) || !Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) return NaN;
  const w = hi - lo;
  let r = (x - lo) % w;
  if (r < 0) r += w;
  if (Object.is(r, -0)) r = 0;
  return lo + r;
}

/** Loose equality: |a - b| <= eps. */
export function approxNumber(a: number, b: number, eps: number): boolean {
  if (typeof a !== 'number' || typeof b !== 'number' || typeof eps !== 'number') return false;
  if (!(eps >= 0) || !Number.isFinite(eps)) return false;
  const d = Math.abs(a - b);
  if (Number.isNaN(d)) return false;
  return d <= eps;
}

/* ------------------------------ language specs ------------------------------ */

const P = (name: string, type = 'Number', extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });

const notInt = (env: Env, detail: string): number => {
  fail(env, 'not_integer', detail);
  return NaN;
};

const domain = (env: Env, detail: string): number => {
  fail(env, 'out_of_domain', detail);
  return NaN;
};

const sigSpec: FunctionSpec = {
  name: 'sig',
  group: 'rounding',
  forms: [
    {
      params: [P('x'), P('n')],
      returns: 'Number',
      summary: 'x rounded to n significant figures, halves away from zero',
      n2: (x, n, env) => {
        if (!Number.isInteger(n)) return notInt(env, `sig(x, ${n})`);
        if (n < 1) return domain(env, `sig(x, ${n})`);
        if (typeof x !== 'number' || Number.isNaN(x)) {
          fail(env, 'not_finite', 'sig of a value that is not a number');
          return NaN;
        }
        if (!Number.isFinite(x)) return x;
        return sigNumber(x, n);
      },
    },
  ],
};

const snapSpec: FunctionSpec = {
  name: 'snap',
  group: 'rounding',
  forms: [
    {
      params: [P('x'), P('step')],
      returns: 'Number',
      summary: 'x snapped to a multiple of step counted from 0',
      n2: (x, step, env) => {
        if (!Number.isFinite(step) || !(step > 0)) return domain(env, `snap(x, ${step})`);
        if (typeof x !== 'number' || !Number.isFinite(x)) {
          fail(env, 'not_finite', 'snap of a value that is not finite');
          return NaN;
        }
        return snapNumber(x, step);
      },
    },
  ],
};

const wrapSpec: FunctionSpec = {
  name: 'wrap',
  group: 'rounding',
  forms: [
    {
      params: [P('x'), P('lo'), P('hi')],
      returns: 'Number',
      summary: 'x wrapped into [lo, hi)',
      n3: (x, lo, hi, env) => {
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) return domain(env, `wrap(x, ${lo}, ${hi})`);
        if (typeof x !== 'number' || !Number.isFinite(x)) {
          fail(env, 'not_finite', 'wrap of a value that is not finite');
          return NaN;
        }
        return wrapNumber(x, lo, hi);
      },
    },
  ],
};

const approxSpec: FunctionSpec = {
  name: 'approx',
  group: 'size',
  forms: [
    {
      params: [P('a'), P('b')],
      returns: 'Bool',
      summary: 'whether a and b differ by at most 1e-9',
      call: (env, args) => {
        const a = args[0] as number;
        const b = args[1] as number;
        if (typeof a !== 'number' || typeof b !== 'number' || Number.isNaN(a) || Number.isNaN(b)) {
          fail(env, 'not_finite', 'approx of values that are not numbers');
          return undefined;
        }
        return approxNumber(a, b, 1e-9);
      },
    },
    {
      params: [P('a'), P('b'), P('eps')],
      returns: 'Bool',
      summary: 'whether a and b differ by at most eps',
      call: (env, args) => {
        const a = args[0] as number;
        const b = args[1] as number;
        const eps = args[2] as number;
        if (typeof a !== 'number' || typeof b !== 'number' || Number.isNaN(a) || Number.isNaN(b)) {
          fail(env, 'not_finite', 'approx of values that are not numbers');
          return undefined;
        }
        if (typeof eps !== 'number' || !(eps >= 0) || !Number.isFinite(eps)) {
          fail(env, 'out_of_domain', `approx(a, b, ${String(eps)})`);
          return undefined;
        }
        return approxNumber(a, b, eps);
      },
    },
  ],
};

/** `screen(x, y)` and `at(x, y)`: the value of `place` (numbers-sliders 3.2), as the text `placementOf` reads. */
const placeSpec = (name: 'screen' | 'at', summary: string): FunctionSpec => ({
  name,
  group: 'controls',
  forms: [
    {
      params: [P('x'), P('y')],
      returns: 'Text',
      summary,
      call: (env, args) => {
        const x = args[0] as number;
        const y = args[1] as number;
        if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
          fail(env, 'not_finite', `${name}(x, y) needs finite numbers`);
          return undefined;
        }
        return `${name}(${numberSource(x)}, ${numberSource(y)})`;
      },
    },
  ],
});

/** The function specs this area adds: sig, snap, wrap, approx, screen, at. */
export function numbersFunctionSpecs(): readonly FunctionSpec[] {
  return [sigSpec, snapSpec, wrapSpec, approxSpec, placeSpec('screen', 'a place in screen pixels, from a corner'), placeSpec('at', 'a place at a point of the maths plane')];
}

/**
 * The built-in function table plus this area's group. Hosts pass it as
 * FigureOptions.functions so the new functions check and compile.
 */
export function withNumbersFunctions(): FunctionTable {
  return createFunctionTable([...BUILTIN_FUNCTION_SPECS, ...numbersFunctionSpecs()]);
}

/** True when the language's deg/tau constants match this area's unit scales. */
export function constantsAgree(): boolean {
  return constantByName('deg')?.value === Math.PI / 180 && constantByName('tau')?.value === 2 * Math.PI;
}
