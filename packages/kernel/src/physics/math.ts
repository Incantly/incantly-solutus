/**
 * Exact maths for the physics engine (docs/features/physics/design.md 10.2). JavaScript's `+`, `-`, `*`, `/`,
 * `Math.sqrt`, `Math.floor` and `Math.abs` give the same answer in every browser; `Math.sin`, `Math.cos`, `Math.atan2`,
 * `Math.exp` and `Math.pow` need not. These functions use only the first group, so a film plays out the same
 * everywhere. Accuracy is about 1e-15 relative over the ranges physics uses.
 */

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;
/** π/2 split in three parts (Cody and Waite), so `x - k π/2` keeps its digits for |x| up to about 1e9. */
const PIO2_1 = 1.5707963267341256;
const PIO2_2 = 6.077100506506192e-11;
const PIO2_3 = 2.0222662487959506e-21;

/** sin on [-π/4, π/4], Taylor to x^17 (error under 1e-17 there). */
function sinKernel(x: number): number {
  const z = x * x;
  return x * (1 + z * (-1 / 6 + z * (1 / 120 + z * (-1 / 5040 + z * (1 / 362880 + z * (-1 / 39916800 + z * (1 / 6227020800 + z * (-1 / 1307674368000 + z * (1 / 355687428096000)))))))));
}

/** cos on [-π/4, π/4], Taylor to x^18. */
function cosKernel(x: number): number {
  const z = x * x;
  return 1 + z * (-1 / 2 + z * (1 / 24 + z * (-1 / 720 + z * (1 / 40320 + z * (-1 / 3628800 + z * (1 / 479001600 + z * (-1 / 87178291200 + z * (1 / 20922789888000 + z * (-1 / 6402373705728000)))))))));
}

/** Reduces x to r in [-π/4, π/4] and the quadrant k mod 4. */
function reduce(x: number): { r: number; q: number } {
  const k = Math.floor(x / HALF_PI + 0.5);
  const r = x - k * PIO2_1 - k * PIO2_2 - k * PIO2_3;
  const q = ((k % 4) + 4) % 4;
  return { r, q };
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  const { r, q } = reduce(x);
  if (q === 0) return sinKernel(r);
  if (q === 1) return cosKernel(r);
  if (q === 2) return -sinKernel(r);
  return -cosKernel(r);
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  const { r, q } = reduce(x);
  if (q === 0) return cosKernel(r);
  if (q === 1) return -sinKernel(r);
  if (q === 2) return -cosKernel(r);
  return sinKernel(r);
}

/** sin and cos of one angle in one reduction, written into `out` as [sin, cos]. */
export function sincos(x: number, out: Float64Array | number[]): void {
  if (!Number.isFinite(x)) {
    out[0] = Number.NaN;
    out[1] = Number.NaN;
    return;
  }
  const { r, q } = reduce(x);
  const s = sinKernel(r);
  const c = cosKernel(r);
  if (q === 0) {
    out[0] = s;
    out[1] = c;
  } else if (q === 1) {
    out[0] = c;
    out[1] = -s;
  } else if (q === 2) {
    out[0] = -s;
    out[1] = -c;
  } else {
    out[0] = -c;
    out[1] = s;
  }
}

const TAN_PI_12 = 0.2679491924311227; // tan(π/12) = 2 - √3
const PI_6 = 0.5235987755982988;

/** atan on [0, tan(π/12)]: odd Taylor series to x^27, error under 1e-16 there. */
function atanKernel(x: number): number {
  const z = x * x;
  let s = 0;
  for (let n = 13; n >= 1; n--) s = z * (((n & 1) === 1 ? -1 : 1) / (2 * n + 1) + s);
  return x * (1 + s);
}

export function atan(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === Infinity) return HALF_PI;
  if (x === -Infinity) return -HALF_PI;
  const neg = x < 0;
  let a = neg ? -x : x;
  let inv = false;
  if (a > 1) {
    a = 1 / a;
    inv = true;
  }
  let shift = 0;
  if (a > TAN_PI_12) {
    // atan(a) = π/6 + atan((a√3 - 1) / (a + √3))
    const SQRT3 = 1.7320508075688772;
    a = (a * SQRT3 - 1) / (a + SQRT3);
    shift = PI_6;
  }
  let r = shift + atanKernel(a);
  if (inv) r = HALF_PI - r;
  return neg ? -r : r;
}

export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (x === 0 && y === 0) return 0;
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  return y > 0 ? HALF_PI : -HALF_PI;
}

const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const INV_LN2 = 1.4426950408889634;

/** 2^k for an integer k, built by halving or doubling, exact for |k| ≤ 1023. */
function pow2(k: number): number {
  let r = 1;
  let b = k >= 0 ? 2 : 0.5;
  let n = k >= 0 ? k : -k;
  while (n > 0) {
    if ((n & 1) === 1) r *= b;
    b *= b;
    n >>= 1;
  }
  return r;
}

export function exp(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x > 709.78) return Infinity;
  if (x < -745.13) return 0;
  const k = Math.floor(x * INV_LN2 + 0.5);
  const r = x - k * LN2_HI - k * LN2_LO; // |r| ≤ ln2 / 2
  // Taylor to r^14 on |r| ≤ 0.347: error under 1e-17
  let s = 1;
  for (let n = 14; n >= 1; n--) s = 1 + (r / n) * s;
  if (k > 1023) return s * pow2(1023) * pow2(k - 1023);
  if (k < -1022) return s * pow2(-1022) * pow2(k + 1022);
  return s * pow2(k);
}

const SQRT2 = 1.4142135623730951;

/** Natural log. */
export function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return Number.NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  // x = m 2^e with m in [√2/2, √2)
  let e = 0;
  let m = x;
  while (m >= SQRT2) {
    m *= 0.5;
    e++;
  }
  while (m < SQRT2 / 2) {
    m *= 2;
    e--;
  }
  // log(m) = 2 atanh(s), s = (m - 1) / (m + 1), |s| ≤ 0.1716
  const s = (m - 1) / (m + 1);
  const z = s * s;
  let t = 0;
  for (let n = 19; n >= 1; n--) t = z * (1 / (2 * n + 1) + t);
  const lm = 2 * s * (1 + t);
  return e * LN2_HI + (e * LN2_LO + lm);
}

/** x^y. Whole powers multiply exactly; others go through exp and log. */
export function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    let r = 1;
    let b = x;
    let n = Math.abs(y);
    while (n > 0) {
      if ((n & 1) === 1) r *= b;
      b *= b;
      n >>= 1;
    }
    return y < 0 ? 1 / r : r;
  }
  if (x < 0) return Number.isInteger(y) ? (Math.abs(y) % 2 === 1 ? -1 : 1) * exp(y * log(-x)) : Number.NaN;
  if (x === 0) return y > 0 ? 0 : Infinity;
  return exp(y * log(x));
}

/** Length of (x, y) without `Math.hypot`, which is not the same everywhere. */
export function len2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function len3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

export { PI, HALF_PI };
