/**
 * Built-in functions and constants (docs/features/language/design.md 3.14).
 * All pure and deterministic. Each undefined result records a reason on the environment.
 */
import { fail } from './runtime';
import type { ColorValue, Env } from './runtime';
import type { Pt } from '../contracts/values';
import { createFunctionTable } from './table';
import type { FunctionForm, FunctionSpec, FunctionTable, ParamSpec } from './table';
import { T } from './types';
import type { Ty } from './types';

/* ---------------------------------- MathLib ---------------------------------- */

/** The platform functions the table uses. A bit-exact port can replace them without changing callers. */
export interface MathLib {
  sin(x: number): number;
  cos(x: number): number;
  tan(x: number): number;
  asin(x: number): number;
  acos(x: number): number;
  atan(x: number): number;
  atan2(y: number, x: number): number;
  sinh(x: number): number;
  cosh(x: number): number;
  tanh(x: number): number;
  asinh(x: number): number;
  acosh(x: number): number;
  atanh(x: number): number;
  exp(x: number): number;
  log(x: number): number;
  log2(x: number): number;
  log10(x: number): number;
  pow(x: number, y: number): number;
  sqrt(x: number): number;
  cbrt(x: number): number;
  hypot(x: number, y: number): number;
}

export const PLATFORM_MATH: MathLib = Math;
let M: MathLib = PLATFORM_MATH;

/** Swap the maths library (for example a bit-exact port). Affects all later evaluations. */
export function setMathLib(lib: MathLib): void {
  M = lib;
}
export function getMathLib(): MathLib {
  return M;
}

/* --------------------------------- constants --------------------------------- */

export interface ConstantSpec {
  readonly name: string;
  readonly type: Ty;
  readonly value: unknown;
  readonly unit?: 'angle';
  readonly doc: string;
}

export const BUILTIN_CONSTANTS: readonly ConstantSpec[] = [
  { name: 'pi', type: T.Number, value: Math.PI, doc: '3.14159…' },
  { name: 'tau', type: T.Number, value: 2 * Math.PI, doc: '2 pi' },
  { name: 'e', type: T.Number, value: Math.E, doc: '2.71828…' },
  { name: 'deg', type: T.Number, value: Math.PI / 180, unit: 'angle', doc: 'pi / 180, so 30 deg is 30° in radians' },
  { name: 'inf', type: T.Number, value: Infinity, doc: 'positive infinity; never stored as a result' },
  { name: 'xaxis', type: T.Line, value: { a: 0, b: 1, c: 0 }, doc: 'the line y = 0' },
  { name: 'yaxis', type: T.Line, value: { a: 1, b: 0, c: 0 }, doc: 'the line x = 0' },
];

const CONSTANT_MAP = new Map(BUILTIN_CONSTANTS.map((c) => [c.name, c]));
export const constantByName = (n: string): ConstantSpec | undefined => CONSTANT_MAP.get(n);

/* ------------------------------ number helpers ------------------------------ */

const isInt = (x: number): boolean => Number.isInteger(x);

const FACT: number[] = [1];
for (let i = 1; i <= 170; i++) FACT.push((FACT[i - 1] as number) * i);

function fact(n: number, env: Env): number {
  if (!isInt(n)) {
    fail(env, 'not_integer', `fact(${n})`);
    return NaN;
  }
  if (n < 0) {
    fail(env, 'out_of_domain', `fact(${n})`);
    return NaN;
  }
  if (n > 170) {
    fail(env, 'overflow', `fact(${n})`);
    return NaN;
  }
  return FACT[n] as number;
}

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function lgammaPos(x: number): number {
  // x > 0.5
  const xm = x - 1;
  let a = LANCZOS[0] as number;
  const t = xm + 7.5;
  for (let i = 1; i < 9; i++) a += (LANCZOS[i] as number) / (xm + i);
  return 0.5 * M.log(2 * Math.PI) + (xm + 0.5) * M.log(t) - t + M.log(a);
}

function gamma(x: number, env: Env): number {
  if (isInt(x) && x <= 0) {
    fail(env, 'out_of_domain', `gamma(${x})`);
    return NaN;
  }
  if (isInt(x) && x <= 171) return FACT[x - 1] as number;
  if (x > 171.7) {
    fail(env, 'overflow', `gamma(${x})`);
    return NaN;
  }
  if (x < 0.5) return Math.PI / (M.sin(Math.PI * x) * gamma(1 - x, env));
  return M.exp(lgammaPos(x));
}

function erfSeries(x: number): number {
  let term = x;
  let sum = x;
  const x2 = x * x;
  for (let n = 1; n < 100; n++) {
    term *= -x2 / n;
    const add = term / (2 * n + 1);
    sum += add;
    if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
  }
  return (2 / M.sqrt(Math.PI)) * sum;
}

function erfcLarge(x: number): number {
  // x >= 2.5, continued fraction evaluated backwards
  let f = x;
  for (let k = 60; k >= 1; k--) f = x + (k / 2) / f;
  return M.exp(-x * x) / (M.sqrt(Math.PI) * f);
}

function erf(x: number): number {
  const a = Math.abs(x);
  if (a < 2.5) return erfSeries(x);
  const v = 1 - erfcLarge(a);
  return x < 0 ? -v : v;
}
function erfc(x: number): number {
  if (x >= 2.5) return erfcLarge(x);
  if (x <= -2.5) return 2 - erfcLarge(-x);
  return 1 - erfSeries(x);
}

function roundHalfAway(x: number): number {
  return x < 0 ? -Math.floor(-x + 0.5) : Math.floor(x + 0.5);
}

const gcd = (a: number, b: number): number => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

/* ----------------------------------- noise ----------------------------------- */

const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 0x2545f491;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = p[i] as number;
    p[i] = p[j] as number;
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255] as number;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerpN = (a: number, b: number, t: number): number => a + t * (b - a);
function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}
function noise3(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = (PERM[X] as number) + Y;
  const AA = (PERM[A] as number) + Z;
  const AB = (PERM[A + 1] as number) + Z;
  const B = (PERM[X + 1] as number) + Y;
  const BA = (PERM[B] as number) + Z;
  const BB = (PERM[B + 1] as number) + Z;
  const r = lerpN(
    lerpN(lerpN(grad(PERM[AA] as number, x, y, z), grad(PERM[BA] as number, x - 1, y, z), u), lerpN(grad(PERM[AB] as number, x, y - 1, z), grad(PERM[BB] as number, x - 1, y - 1, z), u), v),
    lerpN(
      lerpN(grad(PERM[AA + 1] as number, x, y, z - 1), grad(PERM[BA + 1] as number, x - 1, y, z - 1), u),
      lerpN(grad(PERM[AB + 1] as number, x, y - 1, z - 1), grad(PERM[BB + 1] as number, x - 1, y - 1, z - 1), u),
      v,
    ),
    w,
  );
  return Math.max(-1, Math.min(1, r));
}

const dv = new DataView(new ArrayBuffer(8));
function randUnit(seed: number): number {
  dv.setFloat64(0, seed + 0, true);
  let h = dv.getUint32(0, true) ^ Math.imul(dv.getUint32(4, true), 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/* ------------------------------- colour helpers ------------------------------- */

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b]: [number, number, number] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  s = clamp(s, 0, 1);
  v = clamp(v, 0, 1);
  const l = v * (1 - s / 2);
  const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return hslToRgb(h, sl, l);
}
const mkColor = (r: number, g: number, b: number, a: number): ColorValue => ({
  r: clamp(r, 0, 255),
  g: clamp(g, 0, 255),
  b: clamp(b, 0, 255),
  a: clamp(a, 0, 1),
});

/* -------------------------------- spec builders -------------------------------- */

const P = (name: string, type = 'Number', extra: Partial<ParamSpec> = {}): ParamSpec => ({ name, type, ...extra });

type N1 = (a: number, env: Env) => number;
type N2 = (a: number, b: number, env: Env) => number;
type N3 = (a: number, b: number, c: number, env: Env) => number;

function f1(name: string, group: string, n1: N1, summary: string, pn = 'x', unit?: 'angle'): FunctionSpec {
  const form: FunctionForm = { params: [P(pn)], returns: 'Number', summary, n1, ...(unit ? { unit } : {}) };
  return { name, group, forms: [form] };
}
function f2(name: string, group: string, n2: N2, summary: string, pa = 'a', pb = 'b'): FunctionSpec {
  return { name, group, forms: [{ params: [P(pa), P(pb)], returns: 'Number', summary, n2 }] };
}
function f3(name: string, group: string, n3: N3, summary: string, ps: [string, string, string]): FunctionSpec {
  return { name, group, forms: [{ params: ps.map((p) => P(p)), returns: 'Number', summary, n3 }] };
}

const recip = (name: string, v: number, env: Env): number => {
  if (v === 0) {
    fail(env, 'division_by_zero', name);
    return NaN;
  }
  return 1 / v;
};

function domain(env: Env, detail: string): number {
  fail(env, 'out_of_domain', detail);
  return NaN;
}

function numList(v: unknown): number[] | undefined {
  if (Array.isArray(v) || v instanceof Float64Array) return Array.from(v as ArrayLike<number>);
  return undefined;
}

const vec = (v: unknown): Pt => v as Pt;

/* ------------------------------------ table ------------------------------------ */

const specs: FunctionSpec[] = [
  // Trig
  f1('sin', 'trig', (x) => M.sin(x), 'sine of an angle in radians'),
  f1('cos', 'trig', (x) => M.cos(x), 'cosine of an angle in radians'),
  f1('tan', 'trig', (x) => M.tan(x), 'tangent of an angle in radians'),
  f1('sec', 'trig', (x, env) => recip('sec', M.cos(x), env), 'secant'),
  f1('csc', 'trig', (x, env) => recip('csc', M.sin(x), env), 'cosecant'),
  f1('cot', 'trig', (x, env) => {
    const s = M.sin(x);
    if (s === 0) {
      fail(env, 'division_by_zero', 'cot');
      return NaN;
    }
    return M.cos(x) / s;
  }, 'cotangent'),
  // Inverse trig
  f1('asin', 'trig', (x, env) => (x < -1 || x > 1 ? domain(env, `asin(${x})`) : M.asin(x)), 'inverse sine, x in [-1, 1]', 'x', 'angle'),
  f1('acos', 'trig', (x, env) => (x < -1 || x > 1 ? domain(env, `acos(${x})`) : M.acos(x)), 'inverse cosine, x in [-1, 1]', 'x', 'angle'),
  f1('atan', 'trig', (x) => M.atan(x), 'inverse tangent', 'x', 'angle'),
  { name: 'atan2', group: 'trig', forms: [{ params: [P('y'), P('x')], returns: 'Number', summary: 'angle of the point (x, y)', unit: 'angle', n2: (y, x, env) => (y === 0 && x === 0 ? domain(env, 'atan2(0, 0)') : M.atan2(y, x)) }] },
  f1('acot', 'trig', (x) => Math.PI / 2 - M.atan(x), 'inverse cotangent, in (0, pi)', 'x', 'angle'),
  // Hyperbolic
  f1('sinh', 'hyperbolic', (x) => M.sinh(x), 'hyperbolic sine'),
  f1('cosh', 'hyperbolic', (x) => M.cosh(x), 'hyperbolic cosine'),
  f1('tanh', 'hyperbolic', (x) => M.tanh(x), 'hyperbolic tangent'),
  f1('sech', 'hyperbolic', (x) => 1 / M.cosh(x), 'hyperbolic secant'),
  f1('csch', 'hyperbolic', (x, env) => recip('csch', M.sinh(x), env), 'hyperbolic cosecant'),
  f1('coth', 'hyperbolic', (x, env) => (x === 0 ? (fail(env, 'division_by_zero', 'coth(0)'), NaN) : 1 / M.tanh(x)), 'hyperbolic cotangent'),
  f1('asinh', 'hyperbolic', (x) => M.asinh(x), 'inverse hyperbolic sine'),
  f1('acosh', 'hyperbolic', (x, env) => (x < 1 ? domain(env, `acosh(${x})`) : M.acosh(x)), 'inverse hyperbolic cosine, x >= 1'),
  f1('atanh', 'hyperbolic', (x, env) => (x <= -1 || x >= 1 ? domain(env, `atanh(${x})`) : M.atanh(x)), 'inverse hyperbolic tangent, |x| < 1'),
  // Powers and roots
  f1('sqrt', 'powers', (x, env) => (x < 0 ? domain(env, `sqrt(${x})`) : M.sqrt(x)), 'square root, x >= 0'),
  f1('cbrt', 'powers', (x) => M.cbrt(x), 'cube root'),
  f2('nroot', 'powers', (x, n, env) => {
    if (!isInt(n) || n === 0) return n === 0 ? (fail(env, 'division_by_zero', 'nroot(x, 0)'), NaN) : (fail(env, 'not_integer', `nroot(x, ${n})`), NaN);
    if (x < 0) {
      if (n % 2 === 0) return domain(env, `nroot(${x}, ${n})`);
      return -M.pow(-x, 1 / n);
    }
    return M.pow(x, 1 / n);
  }, 'the n-th root; odd n gives the real root of a negative', 'x', 'n'),
  f2('hypot', 'powers', (a, b) => M.hypot(a, b), 'sqrt(a^2 + b^2)'),
  f2('pow', 'powers', (a, b, env) => powChecked(a, b, env), 'a to the power b'),
  // Exp and log
  f1('exp', 'exp', (x) => M.exp(x), 'e to the power x'),
  f1('ln', 'exp', (x, env) => (x <= 0 ? domain(env, `ln(${x})`) : M.log(x)), 'natural logarithm, x > 0'),
  f1('log10', 'exp', (x, env) => (x <= 0 ? domain(env, `log10(${x})`) : M.log10(x)), 'base-10 logarithm, x > 0'),
  f1('log2', 'exp', (x, env) => (x <= 0 ? domain(env, `log2(${x})`) : M.log2(x)), 'base-2 logarithm, x > 0'),
  f2('log', 'exp', (b, x, env) => (b <= 0 || b === 1 || x <= 0 ? domain(env, `log(${b}, ${x})`) : M.log(x) / M.log(b)), 'logarithm of x to base b', 'base', 'x'),
  // Rounding
  f1('floor', 'rounding', (x) => Math.floor(x), 'largest whole number not above x'),
  f1('ceil', 'rounding', (x) => Math.ceil(x), 'smallest whole number not below x'),
  {
    name: 'round',
    group: 'rounding',
    forms: [
      { params: [P('x')], returns: 'Number', summary: 'nearest whole number, halves away from zero', n1: (x) => roundHalfAway(x) },
      {
        params: [P('x'), P('digits')],
        returns: 'Number',
        summary: 'round to a number of decimal digits (negative rounds to tens, hundreds)',
        n2: (x, d, env) => {
          if (!isInt(d)) {
            fail(env, 'not_integer', `round(x, ${d})`);
            return NaN;
          }
          const f = 10 ** d;
          return roundHalfAway(x * f) / f;
        },
      },
    ],
  },
  f1('trunc', 'rounding', (x) => Math.trunc(x), 'whole part of x'),
  f1('fract', 'rounding', (x) => x - Math.trunc(x), 'fractional part of x'),
  // Sign and size
  f1('abs', 'size', (x) => Math.abs(x), 'absolute value'),
  f1('sign', 'size', (x) => Math.sign(x), '-1, 0 or 1'),
  {
    name: 'min',
    group: 'size',
    forms: [
      { params: [P('a'), P('b')], rest: P('more'), returns: 'Number', summary: 'smallest of the arguments', call: (_env, a) => Math.min(...(a as number[])) },
      { params: [P('list', 'List<Number>')], returns: 'Number', summary: 'smallest item of a list', call: (env, a) => listExtreme(env, a[0], Math.min) },
    ],
  },
  {
    name: 'max',
    group: 'size',
    forms: [
      { params: [P('a'), P('b')], rest: P('more'), returns: 'Number', summary: 'largest of the arguments', call: (_env, a) => Math.max(...(a as number[])) },
      { params: [P('list', 'List<Number>')], returns: 'Number', summary: 'largest item of a list', call: (env, a) => listExtreme(env, a[0], Math.max) },
    ],
  },
  f3('clamp', 'size', (x, lo, hi, env) => (lo > hi ? domain(env, `clamp(x, ${lo}, ${hi})`) : x < lo ? lo : x > hi ? hi : x), 'x limited to [lo, hi]', ['x', 'lo', 'hi']),
  // Modular
  f2('mod', 'modular', (a, b, env) => {
    if (b === 0) {
      fail(env, 'division_by_zero', 'mod(a, 0)');
      return NaN;
    }
    const r = a % b;
    return r !== 0 && r < 0 !== b < 0 ? r + b : r;
  }, 'remainder with the sign of b'),
  f2('rem', 'modular', (a, b, env) => {
    if (b === 0) {
      fail(env, 'division_by_zero', 'rem(a, 0)');
      return NaN;
    }
    return a % b;
  }, 'remainder with the sign of a'),
  f2('gcd', 'modular', (a, b, env) => (!isInt(a) || !isInt(b) ? (fail(env, 'out_of_domain', 'gcd'), NaN) : gcd(a, b)), 'greatest common divisor'),
  f2('lcm', 'modular', (a, b, env) => {
    if (!isInt(a) || !isInt(b)) {
      fail(env, 'out_of_domain', 'lcm');
      return NaN;
    }
    if (a === 0 || b === 0) return 0;
    return Math.abs((a / gcd(a, b)) * b);
  }, 'least common multiple'),
  // Counting
  f1('fact', 'counting', (n, env) => fact(n, env), 'n factorial', 'n'),
  f2('ncr', 'counting', (n, r, env) => {
    if (!isInt(n) || !isInt(r)) return (fail(env, 'not_integer', 'ncr'), NaN);
    if (n < 0 || r < 0) return domain(env, 'ncr');
    if (r > n) return 0;
    let v = 1;
    const k = Math.min(r, n - r);
    // The partial products never decrease, so the first infinity is final: stop there.
    for (let i = 1; i <= k && Number.isFinite(v); i++) v = (v * (n - k + i)) / i;
    if (!Number.isFinite(v)) {
      fail(env, 'overflow', 'ncr');
      return NaN;
    }
    return Math.round(v);
  }, 'ways to choose r of n', 'n', 'r'),
  f2('npr', 'counting', (n, r, env) => {
    if (!isInt(n) || !isInt(r)) return (fail(env, 'not_integer', 'npr'), NaN);
    if (n < 0 || r < 0) return domain(env, 'npr');
    if (r > n) return 0;
    let v = 1;
    // r values of at least 1 whose product passes 170! overflows, so refuse that up front; the loop is short.
    if (r > 170) {
      fail(env, 'overflow', 'npr');
      return NaN;
    }
    for (let i = 0; i < r && Number.isFinite(v); i++) v *= n - i;
    if (!Number.isFinite(v)) {
      fail(env, 'overflow', 'npr');
      return NaN;
    }
    return v;
  }, 'ordered ways to pick r of n', 'n', 'r'),
  // Special
  f1('gamma', 'special', (x, env) => gamma(x, env), 'the gamma function'),
  f2('beta', 'special', (a, b, env) => {
    if (a <= 0 || b <= 0) return domain(env, 'beta');
    const g = (z: number): number => (z < 0.5 ? lgammaPos(z + 1) - M.log(z) : lgammaPos(z));
    return M.exp(g(a) + g(b) - g(a + b));
  }, 'the beta function'),
  f1('erf', 'special', (x) => erf(x), 'the error function'),
  f1('erfc', 'special', (x) => erfc(x), 'the complementary error function'),
  // Interpolation
  f3('lerp', 'interpolation', (a, b, s) => a + (b - a) * s, 'a + (b - a) s', ['a', 'b', 's']),
  f3('smooth', 'interpolation', (e0, e1, x, env) => {
    if (e0 === e1) {
      fail(env, 'division_by_zero', 'smooth');
      return NaN;
    }
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }, 'smoothstep between e0 and e1', ['e0', 'e1', 'x']),
  f2('step', 'interpolation', (e, x) => (x < e ? 0 : 1), '0 below e, 1 from e', 'e', 'x'),
  // Random
  f1('rand', 'random', (seed, env) => (Number.isFinite(seed) ? randUnit(seed) : (fail(env, 'not_finite', 'rand'), NaN)), 'a fixed number in [0, 1) for each seed', 'seed'),
  {
    name: 'noise',
    group: 'random',
    forms: [
      { params: [P('x')], returns: 'Number', summary: 'smooth noise in [-1, 1]', n1: (x) => noise3(x, 0.5731, 0.2347) },
      { params: [P('x'), P('y')], returns: 'Number', summary: 'smooth noise in [-1, 1]', n2: (x, y) => noise3(x, y, 0.4142) },
      { params: [P('x'), P('y'), P('z')], returns: 'Number', summary: 'smooth noise in [-1, 1]', n3: (x, y, z) => noise3(x, y, z) },
    ],
  },
  // Vector
  { name: 'dot', group: 'vector', forms: [{ params: [P('u', 'Vector'), P('v', 'Vector')], returns: 'Number', summary: 'dot product', call: (_e, a) => vec(a[0]).x * vec(a[1]).x + vec(a[0]).y * vec(a[1]).y }] },
  { name: 'cross', group: 'vector', forms: [{ params: [P('u', 'Vector'), P('v', 'Vector')], returns: 'Number', summary: '2D cross product (a scalar)', call: (_e, a) => vec(a[0]).x * vec(a[1]).y - vec(a[0]).y * vec(a[1]).x }] },
  { name: 'norm', group: 'vector', forms: [{ params: [P('u', 'Vector')], returns: 'Number', summary: 'length of a vector', call: (_e, a) => M.hypot(vec(a[0]).x, vec(a[0]).y) }] },
  {
    name: 'unit',
    group: 'vector',
    forms: [{
      params: [P('u', 'Vector')],
      returns: 'Vector',
      summary: 'the vector scaled to length 1',
      call: (env, a) => {
        const u = vec(a[0]);
        if (u.x - u.x !== 0 || u.y - u.y !== 0) {
          fail(env, 'not_finite', 'unit of an infinite vector');
          return undefined;
        }
        let l = M.hypot(u.x, u.y);
        let sx = u.x;
        let sy = u.y;
        if (l - l !== 0) {
          // the length overflows although the parts are finite: scale first, then measure
          const m = Math.max(Math.abs(u.x), Math.abs(u.y));
          sx = u.x / m;
          sy = u.y / m;
          l = M.hypot(sx, sy);
        }
        if (l === 0) {
          fail(env, 'division_by_zero', 'unit of the zero vector');
          return undefined;
        }
        return { x: sx / l, y: sy / l };
      },
    }],
  },
  { name: 'perp', group: 'vector', forms: [{ params: [P('u', 'Vector')], returns: 'Vector', summary: 'the vector turned 90° anticlockwise', call: (_e, a) => ({ x: -vec(a[0]).y, y: vec(a[0]).x }) }] },
  // Angle
  f1('todeg', 'angle', (x) => (x * 180) / Math.PI, 'radians to degrees'),
  f1('torad', 'angle', (x) => (x * Math.PI) / 180, 'degrees to radians', 'x', 'angle'),
  // Colour
  {
    name: 'rgb',
    group: 'colour',
    forms: [
      { params: [P('r'), P('g'), P('b')], returns: 'Color', summary: 'colour from channels 0..255', call: (_e, a) => mkColor(a[0] as number, a[1] as number, a[2] as number, 1) },
      { params: [P('r'), P('g'), P('b'), P('a')], returns: 'Color', summary: 'colour from channels 0..255 and alpha 0..1', call: (_e, a) => mkColor(a[0] as number, a[1] as number, a[2] as number, a[3] as number) },
    ],
  },
  {
    name: 'hsl',
    group: 'colour',
    forms: [
      { params: [P('h'), P('s'), P('l')], returns: 'Color', summary: 'colour from hue in degrees, saturation and lightness 0..1', call: (_e, a) => { const c = hslToRgb(a[0] as number, a[1] as number, a[2] as number); return mkColor(c[0], c[1], c[2], 1); } },
      { params: [P('h'), P('s'), P('l'), P('a')], returns: 'Color', summary: 'hsl with alpha 0..1', call: (_e, a) => { const c = hslToRgb(a[0] as number, a[1] as number, a[2] as number); return mkColor(c[0], c[1], c[2], a[3] as number); } },
    ],
  },
  {
    name: 'hsv',
    group: 'colour',
    forms: [
      { params: [P('h'), P('s'), P('v')], returns: 'Color', summary: 'colour from hue in degrees, saturation and value 0..1', call: (_e, a) => { const c = hsvToRgb(a[0] as number, a[1] as number, a[2] as number); return mkColor(c[0], c[1], c[2], 1); } },
      { params: [P('h'), P('s'), P('v'), P('a')], returns: 'Color', summary: 'hsv with alpha 0..1', call: (_e, a) => { const c = hsvToRgb(a[0] as number, a[1] as number, a[2] as number); return mkColor(c[0], c[1], c[2], a[3] as number); } },
    ],
  },
  // Text
  { name: 'len', group: 'text', forms: [{ params: [P('text', 'Text')], returns: 'Number', summary: 'number of characters', call: (_e, a) => (a[0] as string).length }] },
  {
    name: 'number',
    group: 'text',
    forms: [{
      params: [P('text', 'Text')],
      returns: 'Number',
      summary: 'parse a decimal number',
      call: (env, a) => {
        const s = (a[0] as string).trim();
        if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(s)) {
          fail(env, 'out_of_domain', `number(${JSON.stringify(a[0])})`);
          return NaN;
        }
        return Number(s);
      },
    }],
  },
];

function powChecked(a: number, b: number, env: Env): number {
  if (a === 0 && b < 0) {
    fail(env, 'division_by_zero', '0 to a negative power');
    return NaN;
  }
  if (a < 0 && !isInt(b)) {
    fail(env, 'out_of_domain', 'negative number to a fractional power');
    return NaN;
  }
  return M.pow(a, b);
}

/** `a ^ b` with reasons; shared with the compiler. */
export const power = powChecked;

function listExtreme(env: Env, list: unknown, fn: (...xs: number[]) => number): number {
  const arr = numList(list);
  if (arr === undefined || arr.length === 0) {
    fail(env, 'empty_list', 'empty list');
    return NaN;
  }
  let v = arr[0] as number;
  for (let i = 1; i < arr.length; i++) v = fn(v, arr[i] as number);
  return v;
}

export const BUILTIN_FUNCTION_SPECS: readonly FunctionSpec[] = specs;
export const BUILTIN_FUNCTIONS: FunctionTable = createFunctionTable(specs);

/** Fixed names of the clock variables, readable in any formula. */
export const CLOCK_NAMES: readonly string[] = ['t', 'bt', 'beat'];

export { fact as factorial };
