/**
 * The exact maths of compiled formulas (docs/features/physics/design.md 10.2 item 4, "Exact on every computer";
 * .kiro/specs/physics/tasks.md 10.5; handoff/physics/plan-10-speed.md 10.5).
 *
 * What the docs promise and these tests check, from the public API only (`EXACT_MATH`, `PLATFORM_MATH`, `getMathLib`,
 * `setExactMath`, `Figure`):
 * - "Since round 10 the compiled functions run `exact-math.ts` (installed by default; `setExactMath(false)` brings back `Math`
 *   for a test)."
 * - "Each function is within 1 ulp of `Math` (`tan`, `asin`, `acos`, the hyperbolic functions and `hypot` within 2 to 3) and
 *   gives `Math`'s answer for NaN, the infinities, the signed zeros and the edges of its domain." The ranges swept are the ones
 *   of handoff/physics/builder-notes.md "10.5: error against `Math`", 20,000 seeded inputs in each.
 * - "The exact results stay exact" (`log2` of a power of two, `log10` of a power of ten up to 10^22, the cube root of a perfect
 *   cube, `pow(2, k)`, `hypot(3, 4)`).
 * - A figure whose formula reads `sin(t)` gives the same values on every fresh figure with the exact maths (the point of
 *   10.2 item 4), and the values move only within the ulp bound when the maths is switched.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  CommandRegistry,
  EXACT_MATH,
  Figure,
  PLATFORM_MATH,
  geometry,
  getMathLib,
  registerNumbers,
  setExactMath,
} from '../../src/index';
import type { MathLib } from '../../src/index';

afterEach(() => {
  setExactMath(true);
});

/* ------------------------------------------------------------------------------------------------
 * ulp distance, from the bits
 * ---------------------------------------------------------------------------------------------- */

const f64 = new Float64Array(1);
const i64 = new BigInt64Array(f64.buffer);
const MIN_I64 = -(2n ** 63n);

/** The bits of a double as an integer that grows with the number: neighbours differ by 1, and -0 and +0 are both 0. */
function ordered(x: number): bigint {
  f64[0] = x;
  const b = i64[0];
  return b < 0n ? MIN_I64 - b : b;
}

/** How many doubles lie between a and b (0 when equal). Infinity if either is NaN or the finiteness differs. */
function ulpDistance(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Object.is(a, b) ? 0 : Infinity;
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  const d = ordered(a) - ordered(b);
  return Number(d < 0n ? -d : d);
}

describe('the ulp distance used below', () => {
  it('counts neighbours, and treats the zeros as equal', () => {
    expect(ulpDistance(1, 1)).toBe(0);
    expect(ulpDistance(1, 1 + Number.EPSILON)).toBe(1);
    expect(ulpDistance(1, 1 - Number.EPSILON / 2)).toBe(1);
    expect(ulpDistance(-1, -1 - Number.EPSILON)).toBe(1);
    expect(ulpDistance(0, -0)).toBe(0);
    expect(ulpDistance(Number.MIN_VALUE, -Number.MIN_VALUE)).toBe(2);
    expect(ulpDistance(1, 1 + 3 * Number.EPSILON)).toBe(3);
    expect(ulpDistance(1, Infinity)).toBe(Infinity);
    expect(ulpDistance(NaN, 1)).toBe(Infinity);
  });
});

/**
 * Does the exact answer agree with Math's? NaN, the infinities and the zeros (signed) must be identical, as the docs say;
 * any other answer must be within the bound.
 */
function agrees(exact: number, platform: number, bound: number): boolean {
  if (Number.isNaN(platform) || platform === 0 || !Number.isFinite(platform)) return Object.is(exact, platform);
  return ulpDistance(exact, platform) <= bound;
}

/* ------------------------------------------------------------------------------------------------
 * Seeded inputs
 * ---------------------------------------------------------------------------------------------- */

/** mulberry32: a small seeded generator, so a failing input is the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const uniform = (lo: number, hi: number) => (r: Rng) => lo + (hi - lo) * r();
/** Log-uniform in [lo, hi], lo > 0. */
const logUniform = (lo: number, hi: number) => {
  const a = Math.log(lo);
  const b = Math.log(hi);
  return (r: Rng) => Math.min(hi, Math.max(lo, Math.exp(a + (b - a) * r())));
};
/** Log-uniform magnitude in [lo, hi] with a random sign. */
const signedLog = (lo: number, hi: number) => {
  const m = logUniform(lo, hi);
  return (r: Rng) => (r() < 0.5 ? -1 : 1) * m(r);
};
/** A whole number in [lo, hi]. */
const whole = (lo: number, hi: number) => (r: Rng) => lo + Math.floor(r() * (hi - lo + 1));

const N = 20_000;

interface Sweep {
  readonly fn: keyof MathLib;
  readonly range: string;
  readonly bound: number;
  readonly sample: (r: Rng) => number[];
}

const one = (draw: (r: Rng) => number) => (r: Rng) => [draw(r)];
const two = (a: (r: Rng) => number, b: (r: Rng) => number) => (r: Rng) => [a(r), b(r)];

/**
 * The functions of the docs and the ranges of builder-notes "10.5: error against `Math`". The bounds are those of design 10.2:
 * 1 ulp for eleven functions, "2 to 3" (3 here) for `tan`, `asin`, `acos`, the hyperbolic functions and `hypot`.
 */
const SWEEPS: readonly Sweep[] = [
  { fn: 'sin', range: '[-1000, 1000]', bound: 1, sample: one(uniform(-1000, 1000)) },
  { fn: 'sin', range: '[-1e6, 1e6]', bound: 1, sample: one(uniform(-1e6, 1e6)) },
  { fn: 'cos', range: '[-1000, 1000]', bound: 1, sample: one(uniform(-1000, 1000)) },
  { fn: 'cos', range: '[-1e6, 1e6]', bound: 1, sample: one(uniform(-1e6, 1e6)) },
  { fn: 'tan', range: '[-1000, 1000]', bound: 3, sample: one(uniform(-1000, 1000)) },
  { fn: 'asin', range: '[-1, 1]', bound: 3, sample: one(uniform(-1, 1)) },
  { fn: 'acos', range: '[-1, 1]', bound: 3, sample: one(uniform(-1, 1)) },
  { fn: 'atan', range: '±[1e-8, 1e8]', bound: 1, sample: one(signedLog(1e-8, 1e8)) },
  { fn: 'atan2', range: 'y, x in [-100, 100]', bound: 1, sample: two(uniform(-100, 100), uniform(-100, 100)) },
  { fn: 'sinh', range: '[-20, 20]', bound: 3, sample: one(uniform(-20, 20)) },
  { fn: 'sinh', range: '±[1e-8, 1]', bound: 3, sample: one(signedLog(1e-8, 1)) },
  { fn: 'cosh', range: '[-20, 20]', bound: 3, sample: one(uniform(-20, 20)) },
  { fn: 'tanh', range: '[-10, 10]', bound: 3, sample: one(uniform(-10, 10)) },
  { fn: 'tanh', range: '±[1e-8, 1]', bound: 3, sample: one(signedLog(1e-8, 1)) },
  { fn: 'asinh', range: '±[1e-10, 1e10]', bound: 3, sample: one(signedLog(1e-10, 1e10)) },
  { fn: 'acosh', range: '[1, 1e10] (log-spaced)', bound: 3, sample: one(logUniform(1, 1e10)) },
  { fn: 'acosh', range: '[1, 2]', bound: 3, sample: one(uniform(1, 2)) },
  { fn: 'atanh', range: '[-1, 1]', bound: 3, sample: one(uniform(-1, 1)) },
  { fn: 'exp', range: '[-700, 700]', bound: 1, sample: one(uniform(-700, 700)) },
  { fn: 'exp', range: '[-20, 20]', bound: 1, sample: one(uniform(-20, 20)) },
  { fn: 'log', range: '[1e-300, 1e300]', bound: 1, sample: one(logUniform(1e-300, 1e300)) },
  { fn: 'log', range: '[0.1, 10]', bound: 1, sample: one(uniform(0.1, 10)) },
  { fn: 'log2', range: '[1e-300, 1e300]', bound: 1, sample: one(logUniform(1e-300, 1e300)) },
  { fn: 'log10', range: '[1e-300, 1e300]', bound: 1, sample: one(logUniform(1e-300, 1e300)) },
  { fn: 'pow', range: 'x in [0.01, 100], y in [-20, 20]', bound: 1, sample: two(uniform(0.01, 100), uniform(-20, 20)) },
  { fn: 'pow', range: 'x in [-100, 100], whole y in [-20, 20]', bound: 1, sample: two(uniform(-100, 100), whole(-20, 20)) },
  { fn: 'sqrt', range: '[0, 1e6]', bound: 1, sample: one(uniform(0, 1e6)) },
  { fn: 'sqrt', range: '[1e-300, 1e300]', bound: 1, sample: one(logUniform(1e-300, 1e300)) },
  { fn: 'cbrt', range: '±[1e-100, 1e100]', bound: 1, sample: one(signedLog(1e-100, 1e100)) },
  { fn: 'hypot', range: 'both ±[1e-100, 1e100]', bound: 3, sample: two(signedLog(1e-100, 1e100), signedLog(1e-100, 1e100)) },
];

const call = (lib: MathLib, fn: keyof MathLib, args: readonly number[]): number =>
  (lib[fn] as (...a: number[]) => number)(...args);

/* ------------------------------------------------------------------------------------------------
 * The default and the switch
 * ---------------------------------------------------------------------------------------------- */

describe('the exact maths is the default (design 10.2 item 4)', () => {
  it('the installed library is the exact one, not the platform\u2019s', () => {
    expect(getMathLib()).toBe(EXACT_MATH);
    expect(getMathLib()).not.toBe(PLATFORM_MATH);
  });

  it('the exact library has every function the docs list', () => {
    const names = [
      'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
      'exp', 'log', 'log2', 'log10', 'pow', 'sqrt', 'cbrt', 'hypot',
    ] as const;
    for (const n of names) expect(typeof EXACT_MATH[n], n).toBe('function');
  });

  it('the platform library is Math', () => {
    expect(PLATFORM_MATH).toBe(Math);
  });

  it('setExactMath(false) brings back the platform\u2019s, setExactMath(true) the exact one', () => {
    setExactMath(false);
    expect(getMathLib()).toBe(PLATFORM_MATH);
    setExactMath(true);
    expect(getMathLib()).toBe(EXACT_MATH);
    setExactMath(false);
    setExactMath(false);
    expect(getMathLib()).toBe(PLATFORM_MATH);
    setExactMath(true);
    setExactMath(true);
    expect(getMathLib()).toBe(EXACT_MATH);
  });
});

/* ------------------------------------------------------------------------------------------------
 * Within the ulp bound over seeded sweeps
 * ---------------------------------------------------------------------------------------------- */

describe('each function is within its ulp bound of Math (design 10.2 item 4)', () => {
  for (const [k, s] of SWEEPS.entries()) {
    it(`${s.fn} on ${s.range}: ${N.toLocaleString('en')} seeded inputs within ${s.bound} ulp`, () => {
      const rng = seeded(0x1c0de + k * 7919);
      let worst = 0;
      let worstInput: number[] = [];
      let bad = 0;
      let firstBad = '';
      for (let i = 0; i < N; i++) {
        const args = s.sample(rng);
        const got = call(EXACT_MATH, s.fn, args);
        const want = call(Math, s.fn, args);
        const d = ulpDistance(got, want);
        if (Number.isFinite(d) && d > worst) {
          worst = d;
          worstInput = args;
        }
        if (!agrees(got, want, s.bound)) {
          bad++;
          if (!firstBad) firstBad = `${s.fn}(${args.join(', ')}) gave ${got}, Math gave ${want} (${d} ulp)`;
        }
      }
      expect(bad, `${bad} of ${N} over ${s.bound} ulp; first: ${firstBad}; worst finite distance ${worst} at ${worstInput.join(', ')}`).toBe(0);
    });
  }

  it('every one of the 21 functions has at least one sweep', () => {
    const covered = new Set(SWEEPS.map((s) => s.fn));
    for (const n of [
      'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
      'exp', 'log', 'log2', 'log10', 'pow', 'sqrt', 'cbrt', 'hypot',
    ]) {
      expect(covered.has(n as keyof MathLib), n).toBe(true);
    }
  });

  it('the same seed gives the same exact answers twice', () => {
    for (const s of SWEEPS) {
      const a = seeded(99);
      const b = seeded(99);
      for (let i = 0; i < 200; i++) {
        const x = s.sample(a);
        const y = s.sample(b);
        expect(Object.is(call(EXACT_MATH, s.fn, x), call(EXACT_MATH, s.fn, y))).toBe(true);
      }
    }
  });
});

/* ------------------------------------------------------------------------------------------------
 * Special cases equal Math's
 * ---------------------------------------------------------------------------------------------- */

const UNARY = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'exp', 'log', 'log2', 'log10', 'sqrt', 'cbrt'] as const;
const BOUND_OF: Record<string, number> = Object.fromEntries(SWEEPS.map((s) => [s.fn, s.bound]));

/** NaN, the infinities, the signed zeros, the edges of the domains and the extreme sizes. */
const EDGE_INPUTS: readonly number[] = [
  NaN, Infinity, -Infinity, 0, -0,
  1, -1, 2, -2, 0.5, -0.5,
  1.0000001, -1.0000001, 0.9999999, -0.9999999, 1 + Number.EPSILON, 1 - Number.EPSILON / 2, -1 + Number.EPSILON / 2,
  Number.MIN_VALUE, -Number.MIN_VALUE, 1e-320, -1e-320, 1e-300, 2.2250738585072014e-308,
  Number.MAX_VALUE, -Number.MAX_VALUE, 1e308, -1e308,
  709.782712893384, 709.78, 710, 711, -700, -745.13, -745.2, -746, 1e22, -1e22,
  Math.PI, -Math.PI, Math.PI / 2, -Math.PI / 2, 2 * Math.PI, 1e-8, -1e-8, 20, -20, 1e10,
];

describe('special cases equal Math\u2019s (design 10.2 item 4: NaN, the infinities, the signed zeros, the edges of the domain)', () => {
  for (const fn of UNARY) {
    it(`${fn}: NaN, ±Infinity, ±0 and the domain edges`, () => {
      const bad: string[] = [];
      for (const x of EDGE_INPUTS) {
        const got = call(EXACT_MATH, fn, [x]);
        const want = call(Math, fn, [x]);
        if (!agrees(got, want, BOUND_OF[fn])) bad.push(`${fn}(${Object.is(x, -0) ? '-0' : x}) gave ${Object.is(got, -0) ? '-0' : got}, Math gave ${Object.is(want, -0) ? '-0' : want}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('the named edges: asin(1.0000001), acos(-1.0000001), acosh(0.9999999), atanh(1.0000001) are NaN; log(0) is -Infinity; log(-1) is NaN', () => {
    expect(EXACT_MATH.asin(1.0000001)).toBeNaN();
    expect(EXACT_MATH.acos(-1.0000001)).toBeNaN();
    expect(EXACT_MATH.acosh(0.9999999)).toBeNaN();
    expect(EXACT_MATH.atanh(1.0000001)).toBeNaN();
    expect(EXACT_MATH.log(0)).toBe(-Infinity);
    expect(EXACT_MATH.log(-0)).toBe(-Infinity);
    expect(EXACT_MATH.log(-1)).toBeNaN();
    expect(EXACT_MATH.log2(0)).toBe(-Infinity);
    expect(EXACT_MATH.log10(-1)).toBeNaN();
    expect(EXACT_MATH.sqrt(-1)).toBeNaN();
    expect(Object.is(EXACT_MATH.sqrt(-0), -0)).toBe(true);
    expect(EXACT_MATH.atanh(1)).toBe(Infinity);
    expect(EXACT_MATH.atanh(-1)).toBe(-Infinity);
    expect(EXACT_MATH.acosh(1)).toBe(0);
    expect(EXACT_MATH.exp(710)).toBe(Infinity);
    expect(EXACT_MATH.exp(-Infinity)).toBe(0);
    expect(EXACT_MATH.exp(Infinity)).toBe(Infinity);
    expect(EXACT_MATH.sin(Infinity)).toBeNaN();
    expect(EXACT_MATH.cos(-Infinity)).toBeNaN();
    expect(Object.is(EXACT_MATH.sin(-0), -0)).toBe(true);
    expect(Object.is(EXACT_MATH.tan(-0), -0)).toBe(true);
    expect(Object.is(EXACT_MATH.atan(-0), -0)).toBe(true);
    expect(Object.is(EXACT_MATH.asin(-0), -0)).toBe(true);
    expect(Object.is(EXACT_MATH.sinh(-0), -0)).toBe(true);
    expect(Object.is(EXACT_MATH.tanh(-0), -0)).toBe(true);
    expect(Object.is(EXACT_MATH.asinh(-0), -0)).toBe(true);
    expect(Object.is(EXACT_MATH.atanh(-0), -0)).toBe(true);
    expect(Object.is(EXACT_MATH.cbrt(-0), -0)).toBe(true);
    expect(EXACT_MATH.atan(Infinity)).toBe(Math.atan(Infinity));
    expect(EXACT_MATH.tanh(Infinity)).toBe(1);
    expect(EXACT_MATH.tanh(-Infinity)).toBe(-1);
  });

  const PAIR_VALUES: readonly number[] = [NaN, Infinity, -Infinity, 0, -0, 1, -1, 2, -2, 0.5, -0.5, 3, -8, 1e-320, 1e308, -1e308, 1e22, Number.MIN_VALUE];
  const PAIRS: ReadonlyArray<readonly [number, number]> = (() => {
    const out: Array<readonly [number, number]> = [];
    for (const a of PAIR_VALUES) for (const b of PAIR_VALUES) out.push([a, b]);
    return out;
  })();
  const label = (n: number): string => (Object.is(n, -0) ? '-0' : String(n));

  for (const fn of ['atan2', 'pow', 'hypot'] as const) {
    it(`${fn}: every pair of NaN, ±Infinity, ±0, signs and extremes`, () => {
      const bad: string[] = [];
      for (const [a, b] of PAIRS) {
        const got = call(EXACT_MATH, fn, [a, b]);
        const want = call(Math, fn, [a, b]);
        if (!agrees(got, want, BOUND_OF[fn])) bad.push(`${fn}(${label(a)}, ${label(b)}) gave ${label(got)}, Math gave ${label(want)}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('pow: the named edges pow(0, 0), pow(-8, 1/3), pow(0, -1), pow(-0, -3), pow(1, NaN), pow(-1, ±Infinity)', () => {
    const cases: ReadonlyArray<readonly [number, number]> = [
      [0, 0], [-0, 0], [NaN, 0], [0, -0], [-8, 1 / 3], [-8, 3], [-8, 2], [-8, -3], [8, 1 / 3], [0, -1], [-0, -1], [-0, -3], [0, 3], [-0, 3], [0, 0.5],
      [1, NaN], [1, Infinity], [1, -Infinity], [-1, Infinity], [-1, -Infinity], [0.5, Infinity], [2, Infinity], [2, -Infinity], [0.5, -Infinity],
      [Infinity, 0], [-Infinity, 3], [-Infinity, 2], [-Infinity, -3], [Infinity, -1],
      [2, 1023], [2, 1024], [2, -1074], [2, -1075], [10, 308], [10, 309], [10, -323], [10, -324], [-2, 1024], [-2, 1023],
      [1e308, 2], [1e-320, 2], [2, 0.5], [4, 0.5], [7, 1], [7, -1], [7, 2], [NaN, 1],
    ];
    const bad: string[] = [];
    for (const [x, y] of cases) {
      const got = EXACT_MATH.pow(x, y);
      const want = Math.pow(x, y);
      if (!agrees(got, want, 1)) bad.push(`pow(${label(x)}, ${label(y)}) gave ${label(got)}, Math gave ${label(want)}`);
    }
    expect(bad).toEqual([]);
    expect(EXACT_MATH.pow(0, 0)).toBe(1);
    expect(EXACT_MATH.pow(-8, 1 / 3)).toBeNaN();
  });

  it('atan2: the quadrant and zero cases', () => {
    const bad: string[] = [];
    for (const y of [0, -0, 1, -1, Infinity, -Infinity, NaN]) {
      for (const x of [0, -0, 1, -1, Infinity, -Infinity, NaN]) {
        const got = EXACT_MATH.atan2(y, x);
        const want = Math.atan2(y, x);
        if (!agrees(got, want, 1)) bad.push(`atan2(${label(y)}, ${label(x)}) gave ${label(got)}, Math gave ${label(want)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('hypot: an infinity wins over NaN, as Math has it', () => {
    expect(EXACT_MATH.hypot(Infinity, NaN)).toBe(Math.hypot(Infinity, NaN));
    expect(EXACT_MATH.hypot(NaN, -Infinity)).toBe(Math.hypot(NaN, -Infinity));
    expect(EXACT_MATH.hypot(NaN, 1)).toBeNaN();
    expect(EXACT_MATH.hypot(0, 0)).toBe(0);
    expect(EXACT_MATH.hypot(-0, -0)).toBe(0);
    expect(EXACT_MATH.hypot(1e308, 1e308)).toBe(Math.hypot(1e308, 1e308));
    expect(EXACT_MATH.hypot(1e-320, 1e-320)).toBe(Math.hypot(1e-320, 1e-320));
  });
});

describe('the exact results stay exact (design 10.2 item 4)', () => {
  it('log2 of a power of two is the exponent', () => {
    const bad: string[] = [];
    for (let k = -1074; k <= 1023; k++) {
      const x = Math.pow(2, k);
      const got = EXACT_MATH.log2(x);
      if (got !== k) bad.push(`log2(2^${k}) gave ${got}`);
    }
    expect(bad).toEqual([]);
  });

  it('log10 of a power of ten up to 10^22 is the exponent', () => {
    const bad: string[] = [];
    for (let k = 0; k <= 22; k++) {
      const got = EXACT_MATH.log10(Number(`1e${k}`));
      if (got !== k) bad.push(`log10(1e${k}) gave ${got}`);
    }
    expect(bad).toEqual([]);
  });

  it('the cube root of a perfect cube is the whole number, with its sign', () => {
    const bad: string[] = [];
    for (let n = -2000; n <= 2000; n++) {
      const got = EXACT_MATH.cbrt(n * n * n);
      if (!Object.is(got, n === 0 ? 0 : n)) bad.push(`cbrt(${n * n * n}) gave ${got}`);
    }
    expect(bad).toEqual([]);
  });

  it('pow(2, k) is 2^k, and the small whole exponents are exact', () => {
    const bad: string[] = [];
    for (let k = -1074; k <= 1023; k++) {
      const got = EXACT_MATH.pow(2, k);
      if (got !== Math.pow(2, k)) bad.push(`pow(2, ${k}) gave ${got}`);
    }
    for (let n = -50; n <= 50; n++) {
      if (EXACT_MATH.pow(n, 2) !== n * n) bad.push(`pow(${n}, 2) gave ${EXACT_MATH.pow(n, 2)}`);
      if (EXACT_MATH.pow(n, 1) !== n) bad.push(`pow(${n}, 1)`);
      if (EXACT_MATH.pow(n, 3) !== n * n * n) bad.push(`pow(${n}, 3) gave ${EXACT_MATH.pow(n, 3)}`);
    }
    expect(bad.slice(0, 4), `${bad.length} wrong answers in all`).toEqual([]);
    expect(EXACT_MATH.pow(9, 0.5)).toBe(3);
    expect(EXACT_MATH.pow(2, -1)).toBe(0.5);
  });

  it('hypot(3, 4) is 5, and the other whole triples are exact', () => {
    expect(EXACT_MATH.hypot(3, 4)).toBe(5);
    expect(EXACT_MATH.hypot(-3, 4)).toBe(5);
    expect(EXACT_MATH.hypot(5, 12)).toBe(13);
    expect(EXACT_MATH.hypot(8, 15)).toBe(17);
    expect(EXACT_MATH.hypot(7, 24)).toBe(25);
  });

  it('sqrt is correctly rounded: perfect squares are exact', () => {
    for (let n = 0; n <= 3000; n++) expect(EXACT_MATH.sqrt(n * n)).toBe(n);
  });
});

/* ------------------------------------------------------------------------------------------------
 * A figure's formulas
 * ---------------------------------------------------------------------------------------------- */

const REG = (() => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  return r;
})();

const FORMULAS: ReadonlyArray<{ readonly name: string; readonly line: string; readonly of: (lib: MathLib, t: number) => number }> = [
  { name: 'ys', line: 'ys = sin(t)', of: (m, t) => m.sin(t) },
  { name: 'yc', line: 'yc = cos(2 t)', of: (m, t) => m.cos(2 * t) },
  { name: 'ye', line: 'ye = exp(t / 3)', of: (m, t) => m.exp(t / 3) },
  { name: 'yp', line: 'yp = 5 + 3 sin(2 t)', of: (m, t) => 5 + 3 * m.sin(2 * t) },
];

const TIMES: readonly number[] = (() => {
  const r = seeded(2026);
  const out = [0, 0.25, 1, 1 / 3, Math.PI, 7.7];
  for (let i = 0; i < 60; i++) out.push(r() * 120);
  return out;
})();

function figureWith(lines: readonly string[]): Figure {
  const g = new Figure({ commands: REG });
  for (const l of lines) {
    const res = g.apply(l);
    if (!res.ok) throw new Error(`${l}: ${(res as { message: string }).message}`);
  }
  return g;
}

/** Every formula's value at every time, read from the figure. */
function film(g: Figure): number[] {
  const out: number[] = [];
  for (const t of TIMES) {
    g.setClock(t);
    for (const f of FORMULAS) out.push(g.value(f.name) as number);
  }
  return out;
}

describe('a figure\u2019s formulas with the exact maths (design 10.2 item 4)', () => {
  const LINES = FORMULAS.map((f) => f.line);

  it('a formula that reads sin(t) gives the exact library\u2019s values', () => {
    const g = figureWith(LINES);
    for (const t of TIMES) {
      g.setClock(t);
      for (const f of FORMULAS) {
        expect(Object.is(g.value(f.name), f.of(EXACT_MATH, t)), `${f.line} at t = ${t}`).toBe(true);
      }
    }
  });

  it('two fresh figures give the same values to the last bit (determinism)', () => {
    const a = film(figureWith(LINES));
    const b = film(figureWith(LINES));
    expect(a.length).toBe(TIMES.length * FORMULAS.length);
    for (let i = 0; i < a.length; i++) expect(Object.is(a[i], b[i]), `value ${i}`).toBe(true);
  });

  it('the same figure played twice, and sought back, gives the same values', () => {
    const g = figureWith(LINES);
    const first = film(g);
    const again = film(g);
    for (let i = 0; i < first.length; i++) expect(Object.is(first[i], again[i]), `value ${i}`).toBe(true);
  });

  it('with the platform\u2019s maths a fresh figure gives Math\u2019s values', () => {
    setExactMath(false);
    const g = figureWith(LINES);
    for (const t of TIMES) {
      g.setClock(t);
      for (const f of FORMULAS) {
        expect(Object.is(g.value(f.name), f.of(PLATFORM_MATH, t)), `${f.line} at t = ${t}`).toBe(true);
      }
    }
  });

  it('switching the maths moves a value only within the ulp bound', () => {
    const exact = film(figureWith(LINES));
    setExactMath(false);
    const platform = film(figureWith(LINES));
    setExactMath(true);
    const exactAgain = film(figureWith(LINES));
    expect(exactAgain.length).toBe(exact.length);
    const bad: string[] = [];
    for (let i = 0; i < exact.length; i++) {
      const f = FORMULAS[i % FORMULAS.length];
      const t = TIMES[Math.floor(i / FORMULAS.length)];
      // 5 + 3 sin(2 t) carries the sine's ulp error, scaled by 3 and rounded, so it gets a few more ulp.
      const bound = f.name === 'yp' ? 4 : 1;
      if (ulpDistance(exact[i], platform[i]) > bound) bad.push(`${f.line} at t = ${t}: ${exact[i]} against ${platform[i]}`);
      expect(Object.is(exact[i], exactAgain[i]), `back on the exact maths, value ${i}`).toBe(true);
    }
    expect(bad).toEqual([]);
  });

  it('a figure built before the switch uses the installed maths from its next evaluation', () => {
    const g = figureWith(['ys = sin(t)']);
    g.setClock(1.5);
    expect(Object.is(g.value('ys'), EXACT_MATH.sin(1.5))).toBe(true);
    setExactMath(false);
    g.setClock(2.5);
    expect(Object.is(g.value('ys'), Math.sin(2.5))).toBe(true);
    setExactMath(true);
    g.setClock(3.5);
    expect(Object.is(g.value('ys'), EXACT_MATH.sin(3.5))).toBe(true);
  });

  it('a formula with a constant argument follows the switch too, as it is not folded away', () => {
    const exactOf = (): number => figureWith(['val = pow(2, 0.37) + atan2(1, 3)']).value('val') as number;
    const a = exactOf();
    expect(Object.is(a, EXACT_MATH.pow(2, 0.37) + EXACT_MATH.atan2(1, 3))).toBe(true);
    setExactMath(false);
    const b = exactOf();
    expect(Object.is(b, Math.pow(2, 0.37) + Math.atan2(1, 3))).toBe(true);
    expect(ulpDistance(a, b)).toBeLessThanOrEqual(2);
  });
});
