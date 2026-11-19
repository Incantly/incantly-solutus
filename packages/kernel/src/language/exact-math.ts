/**
 * The maths of the formulas a user writes, built from the operations every browser gives the same bits for
 * (docs/features/physics/design.md 10.2 item 4): `+ − × ÷`, `Math.sqrt`, `Math.floor`, `Math.abs`, `Math.trunc`,
 * `Math.sign` and comparisons. `Math.sin`, `Math.exp`, `Math.pow` and the rest are allowed to differ between engines in
 * the last bit; a film that reads them would then differ too.
 *
 * `exp` is the engine's own (`physics/math.ts`). The trigonometric functions use its two kernels with an angle reduced by
 * a longer split of π/2 (the engine's is good to 1e-18 in absolute terms, which is a few ulps near a zero of sin). `atan`,
 * `atan2` and `log` are the textbook algorithms (the ones of the C maths library, written out with exact operations),
 * `log1p` gives the inverse hyperbolic functions their digits near 0, and `pow` works in double-double
 * numbers (a pair of doubles, about 106 bits) so that `x ^ y` is not off by the 100 ulps that `exp(y log x)` is for a
 * large `y log x`. Every function gives the platform's answer for NaN, the infinities, the signed zeros and the edges of
 * its domain. Accuracy: `packages/kernel/bench/exact-math.bench.ts` measures each function against `Math` on a sweep.
 */
import { exp as eExp, HALF_PI, PI } from '../physics/math';
import type { MathLib } from './builtins';

const LN2 = 0.6931471805599453;
const INV_LN2 = 1.4426950408889634;
const SQRT_MAX = 1.3407807929942596e154;
const MAX_LOG = 709.782712893384;
const MIN_EXP = -745.1332191019412;
const TWO_28 = 268435456;
const TWO_M28 = 3.725290298461914e-9;

const isNegZero = (x: number): boolean => x === 0 && 1 / x < 0;

/* ------------------------------ trigonometry ------------------------------ */

/** π/2 in pieces of 28 bits (their products with an integer under 2^25 are exact), and in pieces of 20 bits for 2^33. */
const P28_0 = 1.570796325802803;
const P28_1 = 9.920935739593517e-10;
const P28_2 = 5.721188709663575e-18;
const P28_3 = 1.6446256892965207e-26;
const P20_0 = 1.5707950592041016;
const P20_1 = 0.0000012675900507019833;
const P20_2 = 7.443542310303641e-13;
const P20_3 = 5.170176613476942e-19;
const P20_4 = 6.368316315668184e-25;
const P20_5 = 8.47842697846967e-32;

/** The quadrant of the last angle reduced, 0 to 3 (a module's variable, so a reduction makes no object). */
let quadrant = 0;

/** π × 2^1400, made on the first huge angle: Machin's formula in whole numbers (exact, so the same in every browser). */
let bigPiValue: bigint | undefined;
function bigPi(): bigint {
  if (bigPiValue === undefined) {
    const one = 1n << 1464n;
    const arctanOfInverse = (n: bigint): bigint => {
      const n2 = n * n;
      let term = one / n;
      let sum = term;
      let k = 1n;
      let minus = true;
      while (term !== 0n) {
        term /= n2;
        k += 2n;
        sum += minus ? -(term / k) : term / k;
        minus = !minus;
      }
      return sum;
    };
    bigPiValue = (16n * arctanOfInverse(5n) - 4n * arctanOfInverse(239n)) >> 64n;
  }
  return bigPiValue;
}

/** 2^-400, by halving. */
const TWO_M400 = (() => {
  let f = 1;
  for (let i = 0; i < 400; i++) f *= 0.5;
  return f;
})();

/** The reduction of an angle of 1.3e10 or more, in whole numbers: x × 2^1400 is cut by π/2 × 2^1400, exactly. */
function reduceHuge(x: number): number {
  let m = Math.abs(x);
  let e = 0;
  while (m >= 9007199254740992) {
    m *= 0.5;
    e++;
  }
  while (m < 4503599627370496) {
    m *= 2;
    e--;
  }
  const xs = (x < 0 ? -BigInt(m) : BigInt(m)) << BigInt(e + 1400);
  const halfPi = bigPi() >> 1n;
  const num = xs + (halfPi >> 1n);
  let k = num / halfPi;
  if (num % halfPi !== 0n && num < 0n) k -= 1n;
  const rs = xs - k * halfPi;
  const top = rs >> 1000n;
  const hi = Number(top);
  quadrant = Number(((k % 4n) + 4n) % 4n);
  tail = Number(top - BigInt(hi)) * TWO_M400;
  return hi * TWO_M400;
}

/** What the last reduction left over below the double `reduce` returns: the angle is that number plus this one. */
let tail = 0;

/** x minus the nearest multiple of π/2, in about [-π/4, π/4], with the part below its last digit in `tail`; the multiple mod 4 is left in `quadrant`. */
function reduce(x: number): number {
  if (x >= 1.3e10 || x <= -1.3e10) return reduceHuge(x);
  const k = Math.floor(x / HALF_PI + 0.5);
  quadrant = ((k % 4) + 4) % 4;
  // each product k × piece is exact, and each subtraction is done with the rounding error kept
  let h = x - k * P28_0;
  let l: number;
  if (k > -33554432 && k < 33554432) {
    twoSum(h, -(k * P28_1));
    h = rh;
    l = rl;
    twoSum(h, -(k * P28_2));
    h = rh;
    l += rl;
    twoSum(h, -(k * P28_3));
    h = rh;
    l += rl;
  } else {
    h = x - k * P20_0;
    twoSum(h, -(k * P20_1));
    h = rh;
    l = rl;
    twoSum(h, -(k * P20_2));
    h = rh;
    l += rl;
    twoSum(h, -(k * P20_3));
    h = rh;
    l += rl;
    twoSum(h, -(k * P20_4));
    h = rh;
    l += rl;
    twoSum(h, -(k * P20_5));
    h = rh;
    l += rl;
  }
  twoSum(h, l);
  tail = rl;
  return rh;
}

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** sin(x + y) for |x| ≤ π/4 and a tiny y (the C library's kernel). */
function kernelSin(x: number, y: number): number {
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

/** cos(x + y) for |x| ≤ π/4 and a tiny y (the C library's kernel; the 20-bit `qx` makes `1 - qx` exact). */
function kernelCos(x: number, y: number): number {
  const a = Math.abs(x);
  if (a < 7.450580596923828e-9) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (a < 0.3) return 1 - (0.5 * z - (z * r - x * y));
  const qx = Math.floor(0.5 * z * 1048576) / 1048576;
  return 1 - qx - ((0.5 * z - qx) - (z * r - x * y));
}

function sin(x: number): number {
  if (x - x !== 0) return Number.NaN;
  if (x > -0.78 && x < 0.78) return kernelSin(x, 0);
  const r = reduce(x);
  const y = tail;
  const q = quadrant;
  if (q === 0) return kernelSin(r, y);
  if (q === 1) return kernelCos(r, y);
  if (q === 2) return -kernelSin(r, y);
  return -kernelCos(r, y);
}

function cos(x: number): number {
  if (x - x !== 0) return Number.NaN;
  if (x > -0.78 && x < 0.78) return kernelCos(x, 0);
  const r = reduce(x);
  const y = tail;
  const q = quadrant;
  if (q === 0) return kernelCos(r, y);
  if (q === 1) return -kernelSin(r, y);
  if (q === 2) return -kernelCos(r, y);
  return kernelSin(r, y);
}

function tan(x: number): number {
  if (x - x !== 0) return Number.NaN;
  if (x > -0.78 && x < 0.78) return kernelSin(x, 0) / kernelCos(x, 0);
  const r = reduce(x);
  const y = tail;
  const s = kernelSin(r, y);
  const c = kernelCos(r, y);
  return (quadrant & 1) === 0 ? s / c : -c / s;
}

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.570796326794896558];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.11111104054623557880e-1, 9.09088713343650656196e-2,
  -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.65315727442169155270e-2,
  1.62858201153657823623e-2,
];

/** atan of a number that is not NaN or 0, the way the C library does it: four intervals, an odd polynomial in x². */
function atan(x: number): number {
  if (x !== x || x === 0) return x;
  const neg = x < 0;
  let a = neg ? -x : x;
  if (a >= 7.378697629483821e19) return neg ? -(ATAN_HI[3] as number) - (ATAN_LO[3] as number) : (ATAN_HI[3] as number) + (ATAN_LO[3] as number);
  let id: number;
  if (a < 0.4375) {
    if (a < 7.450580596923828e-9) return x;
    id = -1;
  } else if (a < 1.1875) {
    if (a < 0.6875) {
      id = 0;
      a = (2 * a - 1) / (2 + a);
    } else {
      id = 1;
      a = (a - 1) / (a + 1);
    }
  } else if (a < 2.4375) {
    id = 2;
    a = (a - 1.5) / (1 + 1.5 * a);
  } else {
    id = 3;
    a = -1 / a;
  }
  const z = a * a;
  const w = z * z;
  const s1 = z * ((AT[0] as number) + w * ((AT[2] as number) + w * ((AT[4] as number) + w * ((AT[6] as number) + w * ((AT[8] as number) + w * (AT[10] as number))))));
  const s2 = w * ((AT[1] as number) + w * ((AT[3] as number) + w * ((AT[5] as number) + w * ((AT[7] as number) + w * (AT[9] as number)))));
  if (id < 0) {
    const r = a - a * (s1 + s2);
    return neg ? -r : r;
  }
  const r = (ATAN_HI[id] as number) - ((a * (s1 + s2) - (ATAN_LO[id] as number)) - a);
  return neg ? -r : r;
}

const PI_LO = 1.2246467991473532e-16;

function atan2(y: number, x: number): number {
  if (y !== y || x !== x) return Number.NaN;
  if (y === 0) {
    if (x > 0 || (x === 0 && !isNegZero(x))) return y;
    return isNegZero(y) ? -PI : PI;
  }
  if (x === 0) return y > 0 ? HALF_PI : -HALF_PI;
  if (y === Infinity || y === -Infinity) {
    if (x === Infinity) return y > 0 ? PI / 4 : -PI / 4;
    if (x === -Infinity) return y > 0 ? 3 * (PI / 4) : -3 * (PI / 4);
    return y > 0 ? HALF_PI : -HALF_PI;
  }
  if (x === Infinity) return y > 0 ? 0 : -0;
  if (x === -Infinity) return y > 0 ? PI : -PI;
  const ratio = Math.abs(y / x);
  let z: number;
  if (ratio > 1.152921504606847e18) z = HALF_PI + 0.5 * PI_LO;
  else if (x < 0 && ratio < 8.673617379884035e-19) z = 0;
  else z = atan(ratio);
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
}

/** sqrt(1 - x²) for |x| < 1, correctly rounded but for the rarest cases (the square and the difference are kept to double-double). */
function sqrtOneMinusSquare(x: number): number {
  twoProd(x, x);
  const pl = rl;
  twoSum(1, -rh);
  const sh = rh;
  const sl = rl - pl;
  const r = Math.sqrt(sh + sl);
  twoProd(r, r);
  return r + (((sh - rh) - rl) + sl) / (2 * r);
}

function asin(x: number): number {
  const a = Math.abs(x);
  if (!(a <= 1)) return Number.NaN;
  if (a === 0) return x;
  if (a === 1) return x > 0 ? HALF_PI : -HALF_PI;
  return atan2(x, sqrtOneMinusSquare(x));
}

function acos(x: number): number {
  const a = Math.abs(x);
  if (!(a <= 1)) return Number.NaN;
  if (x === 1) return 0;
  if (x === -1) return PI;
  return atan2(sqrtOneMinusSquare(x), x);
}

/* --------------------------- exponential and logarithm --------------------------- */

function exp(x: number): number {
  if (x !== x) return x;
  if (x > MAX_LOG) return Infinity;
  if (x < MIN_EXP) return 0;
  return eExp(x);
}

const LG1 = 6.666666666666735130e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;
const LN2_HI = 6.93147180369123816490e-1;
const LN2_LO = 1.90821492927058770002e-10;

/** Set by `splitFloat`: x = m 2^e. */
let exponentOf = 0;
/** x = m 2^e with m in [√2/2, √2) (x finite, over 0): returns m and leaves e in `exponentOf`, by exact scalings. */
function splitFloat(x: number): number {
  let m = x;
  let e = 0;
  while (m >= 4503599627370496) {
    m *= 2.220446049250313e-16;
    e += 52;
  }
  while (m < 2.220446049250313e-16) {
    m *= 4503599627370496;
    e -= 52;
  }
  while (m >= 1.4142135623730951) {
    m *= 0.5;
    e++;
  }
  while (m < 0.7071067811865476) {
    m *= 2;
    e--;
  }
  exponentOf = e;
  return m;
}

/** log of m in [√2/2, √2) plus k ln 2: the natural logarithm the way the C library works it out. */
function logParts(m: number, k: number): number {
  const f = m - 1;
  if (f === 0 && k === 0) return 0;
  const hfsq = 0.5 * f * f;
  if (Math.abs(f) < 9.5367431640625e-7) {
    if (f === 0) return k * LN2_HI + k * LN2_LO;
    const R = f * f * (0.5 - 0.3333333333333333 * f);
    if (k === 0) return f - R;
    return k * LN2_HI - ((R - k * LN2_LO) - f);
  }
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  // near the top of the interval the correction by f²/2 loses less
  const top = (m >= 1.379997 && m < 1.4142135623730951) || (m >= 0.7071067811865476 && m <= 0.709995);
  if (top) {
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
  }
  if (k === 0) return f - s * (f - R);
  return k * LN2_HI - ((s * (f - R) - k * LN2_LO) - f);
}

function log(x: number): number {
  if (x !== x || x < 0) return Number.NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  const m = splitFloat(x);
  return logParts(m, exponentOf);
}

/** log(1 + u) without losing the digits of a small u (Goldberg's correction of the rounded sum). */
function log1p(u: number): number {
  if (u !== u || u < -1) return Number.NaN;
  if (u === -1) return -Infinity;
  if (u === Infinity) return Infinity;
  const w = 1 + u;
  if (w === 1) return u;
  return (log(w) * u) / (w - 1);
}

const INV_LN10 = 0.4342944819032518;
const LOG10_2_HI = 0.30102999566361177;
const LOG10_2_LO = 3.694239077157482e-13;

function log2(x: number): number {
  if (x !== x || x < 0) return Number.NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  const m = splitFloat(x);
  const e = exponentOf;
  // m = 1 only for a power of two, and the answer is then the integer, as the platform's is
  if (m === 1) return e;
  return e + logParts(m, 0) * INV_LN2;
}

function log10(x: number): number {
  if (x !== x || x < 0) return Number.NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return x;
  const m = splitFloat(x);
  const e = exponentOf;
  const r = e * LOG10_2_HI + (e * LOG10_2_LO + logParts(m, 0) * INV_LN10);
  // a power of ten up to 10^22 is an exact double, and the platform's answer for it is the integer
  const k = Math.floor(r + 0.5);
  if (k >= -22 && k <= 22 && Math.abs(r - k) < 1e-9) {
    let p = 1;
    for (let i = 0; i < Math.abs(k); i++) p *= 10;
    if ((k >= 0 ? p : 1 / p) === x) return k;
  }
  return r;
}

/* ------------------------------ hyperbolic functions ------------------------------ */

/** 1/3!, 1/5!, … and 1/2!, 1/4!, … (a division of two whole numbers is one correctly rounded operation). */
const SH1 = 1 / 6;
const SH2 = 1 / 120;
const SH3 = 1 / 5040;
const SH4 = 1 / 362880;
const SH5 = 1 / 39916800;
const SH6 = 1 / 6227020800;
const SH7 = 1 / 1307674368000;
const SH8 = 1 / 355687428096000;
const SH9 = SH8 / 342;
const CH1 = 1 / 2;
const CH2 = 1 / 24;
const CH3 = 1 / 720;
const CH4 = 1 / 40320;
const CH5 = 1 / 3628800;
const CH6 = 1 / 479001600;
const CH7 = 1 / 87178291200;
const CH8 = 1 / 20922789888000;
const CH9 = 1 / 6402373705728000;

function sinh(x: number): number {
  if (x !== x || x === 0) return x;
  const a = Math.abs(x);
  let r: number;
  if (a < 0.9) {
    // x plus a small series in x²: only the correction is rounded in its own digits
    const z = a * a;
    r = a + a * z * (SH1 + z * (SH2 + z * (SH3 + z * (SH4 + z * (SH5 + z * (SH6 + z * (SH7 + z * (SH8 + z * SH9))))))));
  } else if (a < 709) {
    const t = exp(a);
    r = 0.5 * (t - 1 / t);
  } else if (a <= 710.4758600739439) {
    const h = exp(a * 0.5);
    r = h * 0.5 * h;
  } else r = Infinity;
  return x < 0 ? -r : r;
}

function cosh(x: number): number {
  if (x !== x) return x;
  const a = Math.abs(x);
  if (a < 0.9) {
    const z = a * a;
    return 1 + z * (CH1 + z * (CH2 + z * (CH3 + z * (CH4 + z * (CH5 + z * (CH6 + z * (CH7 + z * (CH8 + z * CH9))))))));
  }
  if (a < 709) {
    const t = exp(a);
    return 0.5 * (t + 1 / t);
  }
  if (a <= 710.4758600739439) {
    const h = exp(a * 0.5);
    return h * 0.5 * h;
  }
  return Infinity;
}

function tanh(x: number): number {
  if (x !== x || x === 0) return x;
  const a = Math.abs(x);
  let r: number;
  if (a > 20) r = 1;
  else if (a < 0.9) r = sinh(a) / cosh(a);
  else {
    const em = exp(2 * a) - 1;
    r = em / (em + 2);
  }
  return x < 0 ? -r : r;
}

function asinh(x: number): number {
  if (x !== x || x === 0 || x === Infinity || x === -Infinity) return x;
  const a = Math.abs(x);
  let r: number;
  if (a < TWO_M28) return x;
  if (a > TWO_28) r = log(a) + LN2;
  else {
    const t = a * a;
    r = log1p(a + t / (1 + Math.sqrt(1 + t)));
  }
  return x < 0 ? -r : r;
}

function acosh(x: number): number {
  if (x !== x || x < 1) return Number.NaN;
  if (x === 1) return 0;
  if (x === Infinity) return x;
  if (x > TWO_28) return log(x) + LN2;
  if (x > 2) {
    const t = x * x;
    return log(2 * x - 1 / (x + Math.sqrt(t - 1)));
  }
  const t = x - 1;
  return log1p(t + Math.sqrt(2 * t + t * t));
}

function atanh(x: number): number {
  if (x !== x) return x;
  const a = Math.abs(x);
  if (a > 1) return Number.NaN;
  if (a === 1) return x > 0 ? Infinity : -Infinity;
  if (a < TWO_M28) return x;
  let r: number;
  if (a < 0.5) {
    const t = a + a;
    r = 0.5 * log1p(t + (t * a) / (1 - a));
  } else r = 0.5 * log1p((a + a) / (1 - a));
  return x < 0 ? -r : r;
}

/* ------------------------------ double-double numbers (for pow) ------------------------------ */

/** The result of the last double-double operation: the value is `rh + rl`, with `rl` under half an ulp of `rh`. */
let rh = 0;
let rl = 0;

/** Veltkamp's split: a number's product with itself or another is then exact in pieces. */
const SPLIT = 134217729;

/** a × b as `rh + rl`, exactly (|a|, |b| under 2^996). */
function twoProd(a: number, b: number): void {
  const p = a * b;
  let t = SPLIT * a;
  const ah = t - (t - a);
  const al = a - ah;
  t = SPLIT * b;
  const bh = t - (t - b);
  const bl = b - bh;
  rl = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  rh = p;
}

/** a + b as `rh + rl`, exactly. */
function twoSum(a: number, b: number): void {
  const s = a + b;
  const v = s - a;
  rl = (a - (s - v)) + (b - v);
  rh = s;
}

/** (ah + al) × (bh + bl). */
function ddMul(ah: number, al: number, bh: number, bl: number): void {
  twoProd(ah, bh);
  const e = rl + (ah * bl + al * bh);
  const hi = rh + e;
  rl = e - (hi - rh);
  rh = hi;
}

/** (ah + al) + (bh + bl). */
function ddAdd(ah: number, al: number, bh: number, bl: number): void {
  twoSum(ah, bh);
  const e = rl + (al + bl);
  const hi = rh + e;
  rl = e - (hi - rh);
  rh = hi;
}

/** 1 / n! as a pair, for n up to 27 (made at load from exact operations only). */
const INV_FACT_H = new Float64Array(28);
const INV_FACT_L = new Float64Array(28);
(() => {
  let h = 1;
  let l = 0;
  INV_FACT_H[0] = 1;
  for (let n = 1; n < 28; n++) {
    // (h + l) / n
    const q1 = h / n;
    twoProd(q1, n);
    const r = ((h - rh) - rl) + l;
    const q2 = r / n;
    const hi = q1 + q2;
    l = q2 - (hi - q1);
    h = hi;
    INV_FACT_H[n] = h;
    INV_FACT_L[n] = l;
  }
})();

/** ln 2 in three pieces of 40 bits: a product with an integer under 2^12 is exact in each. */
const L2_A = 0.6931471805592082;
const L2_B = 7.371002565161996e-13;
const L2_C = 5.80298898359054e-25;

/** exp(zh + zl) for |zh| under 745: the value `eh + el` times 2^k, with k left in `expK`. */
let expK = 0;
let expH = 0;
let expL = 0;
function ddExp(zh: number, zl: number): void {
  const k = Math.floor(zh * INV_LN2 + 0.5);
  // r = z - k ln 2 as a pair
  const a = zh - k * L2_A;
  twoSum(a, -(k * L2_B));
  const bh = rh;
  const bl = rl;
  twoSum(bh, -(k * L2_C));
  const ch = rh;
  const cl = rl + bl + zl;
  twoSum(ch, cl);
  const xh = rh;
  const xl = rl;
  // Taylor series by Horner, 22 terms (|r| ≤ 0.35)
  let sh = INV_FACT_H[22] as number;
  let sl = INV_FACT_L[22] as number;
  for (let n = 21; n >= 0; n--) {
    ddMul(sh, sl, xh, xl);
    ddAdd(rh, rl, INV_FACT_H[n] as number, INV_FACT_L[n] as number);
    sh = rh;
    sl = rl;
  }
  expK = k;
  expH = sh;
  expL = sl;
}

/** x^n for a whole n under 2^30 in absolute value, by squaring in double-double numbers; the value is left in `rh + rl`. */
function ddPowInt(x: number, n: number): void {
  let bh = x;
  let bl = 0;
  let ph = 1;
  let pl = 0;
  let m = Math.abs(n);
  while (m > 0) {
    if (m % 2 === 1) {
      ddMul(ph, pl, bh, bl);
      ph = rh;
      pl = rl;
    }
    m = Math.floor(m / 2);
    if (m > 0) {
      ddMul(bh, bl, bh, bl);
      bh = rh;
      bl = rl;
    }
  }
  if (n < 0) {
    // 1 / (ph + pl)
    const q1 = 1 / ph;
    twoProd(q1, ph);
    const r = ((1 - rh) - rl) - q1 * pl;
    const q2 = r / ph;
    const hi = q1 + q2;
    rl = q2 - (hi - q1);
    rh = hi;
  } else {
    rh = ph;
    rl = pl;
  }
}

/** 2^k for a whole k, in two multiplications so the exponent may reach the subnormals and the overflow. */
function scale2(v: number, k: number): number {
  let r = v;
  let n = k;
  while (n > 1000) {
    r *= 8.98846567431158e307;
    n -= 1023;
  }
  while (n < -1000) {
    r *= 2.2250738585072014e-308;
    n += 1022;
  }
  let p = 1;
  let b = n >= 0 ? 2 : 0.5;
  let c = n >= 0 ? n : -n;
  while (c > 0) {
    if ((c & 1) === 1) p *= b;
    b *= b;
    c >>= 1;
  }
  return r * p;
}

/* ------------------------------ powers and roots ------------------------------ */

function isOddInteger(y: number): boolean {
  return Math.abs(y) < 9007199254740992 && Math.floor(y) === y && Math.abs(y % 2) === 1;
}

function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (x !== x || y !== y) return Number.NaN;
  if (y === Infinity || y === -Infinity) {
    const a = Math.abs(x);
    if (a === 1) return Number.NaN;
    return (a > 1) === (y > 0) ? Infinity : 0;
  }
  if (x === 0) {
    const odd = isOddInteger(y) && isNegZero(x);
    if (y > 0) return odd ? -0 : 0;
    return odd ? -Infinity : Infinity;
  }
  if (x === Infinity) return y > 0 ? Infinity : 0;
  if (x === -Infinity) {
    const odd = isOddInteger(y);
    if (y > 0) return odd ? -Infinity : Infinity;
    return odd ? -0 : 0;
  }
  const whole = Math.floor(y) === y;
  if (x < 0 && !whole) return Number.NaN;
  const negate = x < 0 && isOddInteger(y);
  const a = Math.abs(x);
  let r: number;
  if (a === 1) r = 1;
  else if (y === 1) r = a;
  else if (y === 0.5) r = Math.sqrt(a);
  else if (y === 2) r = a * a;
  else if (y === -1) r = 1 / a;
  else if (whole && y > -65 && y < 65 && a < 1e4 && a > 1e-4) {
    ddPowInt(a, y);
    r = rh + rl;
  } else {
    // log x as a pair: log m from the library's log, corrected by one Newton step done in double-double numbers
    const m = splitFloat(a);
    const e = exponentOf;
    const l0 = logParts(m, 0);
    ddExp(-l0, 0);
    // c = m exp(-l0) - 1 (small), the correction to l0
    ddMul(expH, expL, m, 0);
    const p = scale2(rh, expK);
    const pl = scale2(rl, expK);
    const c = (p - 1) + pl;
    twoSum(l0, c);
    const mh = rh;
    const ml = rl;
    // plus e ln 2, then times y
    twoSum(mh, e * L2_A);
    const lh = rh;
    const ll = rl + ml + e * L2_B + e * L2_C;
    twoSum(lh, ll);
    const th = rh;
    const tl = rl;
    const rough = y * th;
    if (rough > MAX_LOG + 2 || rough < MIN_EXP - 2) return negate ? -(rough > 0 ? Infinity : 0) : rough > 0 ? Infinity : 0;
    twoProd(y, th);
    const zh = rh;
    const zl = rl + y * tl;
    if (zh > MAX_LOG + 1) r = Infinity;
    else if (zh < MIN_EXP - 1) r = 0;
    else {
      ddExp(zh, zl);
      r = scale2(expH + expL, expK);
    }
  }
  return negate ? -r : r;
}

function cbrt(x: number): number {
  if (x !== x || x === 0 || x === Infinity || x === -Infinity) return x;
  const a = Math.abs(x);
  // a first guess from the logarithm, then Newton's steps on y³ = a
  // near the ends of the range the number is scaled by a power of two cubed, so y³ neither underflows nor overflows
  const up = a < 1e-290;
  const down = a > 1e290;
  const v = up ? a * 2.037035976334486e90 : down ? a * 4.909093465297727e-91 : a;
  let y = exp(log(v) / 3);
  y -= (y * y * y - v) / (3 * y * y);
  y -= (y * y * y - v) / (3 * y * y);
  if (up) y *= 7.888609052210118e-31;
  else if (down) y *= 1.2676506002282294e30;
  return x < 0 ? -y : y;
}

function hypot(x: number, y: number): number {
  if (x === Infinity || x === -Infinity || y === Infinity || y === -Infinity) return Infinity;
  if (x !== x || y !== y) return Number.NaN;
  let a = Math.abs(x);
  let b = Math.abs(y);
  if (a < b) {
    const t = a;
    a = b;
    b = t;
  }
  if (a === 0) return 0;
  if (a < SQRT_MAX && a > 1e-150) {
    // the sum of the squares kept to double-double, so the root is the nearest double
    twoProd(a, a);
    const p1 = rh;
    const e1 = rl;
    twoProd(b, b);
    const p2 = rh;
    const e2 = rl;
    twoSum(p1, p2);
    const sh = rh;
    const sl = rl + (e1 + e2);
    const r = Math.sqrt(sh + sl);
    twoProd(r, r);
    return r + (((sh - rh) - rl) + sl) / (2 * r);
  }
  // scaled by a power of two, so the squares neither overflow nor underflow, and the scaling is exact
  const s = a > 1 ? 2.409919865102884e-181 : 4.149515568880993e180;
  const u = a * s;
  const v = b * s;
  return Math.sqrt(u * u + v * v) / s;
}

/**
 * The same maths in every browser: the functions of `MathLib`, from exact operations only. Installed by default
 * (`setExactMath(false)` brings back the platform's, for a test).
 */
export const EXACT_MATH: MathLib = {
  sin,
  cos,
  tan,
  asin,
  acos,
  atan,
  atan2,
  sinh,
  cosh,
  tanh,
  asinh,
  acosh,
  atanh,
  exp,
  log,
  log2,
  log10,
  pow,
  sqrt: Math.sqrt,
  cbrt,
  hypot,
};

