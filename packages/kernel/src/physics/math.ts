/**
 * Exact maths for the physics engine (docs/features/physics/design.md 10.2). JavaScript's `+`, `-`, `*`, `/`,
 * `Math.sqrt`, `Math.floor` and `Math.abs` give the same answer in every browser; `Math.sin`, `Math.cos`, `Math.atan2`,
 * `Math.exp` and `Math.pow` need not. These functions use only the first group, so a film plays out the same
 * everywhere. Accuracy is about 1e-15 relative over the ranges physics uses.
 */

const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;

/*
 * sin and cos (PH-52). The angle is cut by multiples of π/2 with π/2 in pieces short enough that each product with the
 * whole number k is exact (28 bits for k under 2^25, which is |x| under 5e7; 20 bits up to |x| of 1.3e10, past which the
 * products round and the answer is good only to the digits the angle itself has), and each subtraction keeps its rounding
 * error, so the reduced angle is a double and a tail below its last digit. The two kernels are the C library's (odd and
 * even polynomials in the angle with the tail added in), which are within 1 ulp. The earlier version split π/2 in three
 * with a third piece that was the tail of a different second piece: up to 1,308 ulp near a zero of sin.
 * Seven pieces of 28 bits (196 bits of π/2) and nine of 20 bits are enough for an angle to land within 1e-19 of a multiple of
 * π/2 and still have its sine to the last digit.
 * Only `+ − × ÷` and `Math.floor` and `Math.abs` are used.
 */

/** π/2 in pieces of 28 bits, each rounded to nearest (so signed): the sum is π/2 to 1e-58. */
const PIECES_28 = Float64Array.of(1.570796325802803, 9.920935808982456e-10, -1.2177051813189564e-18, 3.521559869972398e-27, -4.789197941557448e-36, -1.7504543305126363e-44, -4.2044856437608114e-54);
/** π/2 in pieces of 20 bits, for k from 2^25 up. */
const PIECES_20 = Float64Array.of(1.5707969665527344, -6.397585821105167e-7, 7.443550983921021e-13, -3.503432494600968e-19, -1.9034898098620926e-25, 8.47842697846967e-32, 6.81898737670971e-39, 4.916229952449383e-45, 2.167418113251577e-51);

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

/**
 * What the reduction and the kernels hand each other (numbers in a call that is not inlined are heap numbers, and the
 * world calls `sincos` for every body in every step): 0 the tail, 1 the quadrant, 2 the reduced angle, 3 its sine, 4 its cosine, 5 the angle given to `prepare` and `reduce`.
 */
const K = new Float64Array(8);


/** `K[5]` minus the nearest multiple of π/2, in about [-π/4, π/4], into `K[2]`, with the part below its last digit in `K[0]` and the multiple mod 4 in `K[1]`. */
function reduce(): void {
  const x = K[5] as number;
  const k = Math.floor(x / HALF_PI + 0.5);
  K[1] = ((k % 4) + 4) % 4;
  // each product k × piece is exact, and each subtraction is done with its rounding error kept
  const P = k > -33554432 && k < 33554432 ? PIECES_28 : PIECES_20;
  let h = x - k * (P[0] as number);
  let l = 0;
  for (let i = 1; i < P.length; i++) {
    const b = -(k * (P[i] as number));
    const s = h + b;
    const v = s - h;
    l += h - (s - v) + (b - v);
    h = s;
  }
  const s = h + l;
  const v = s - h;
  K[0] = h - (s - v) + (l - v);
  K[2] = s;
}

/** sin(x + y) into `K[3]`, for x = `K[2]` with |x| up to π/4 and a tiny y = `K[0]`. */
function kernelSin(): void {
  const x = K[2] as number;
  const y = K[0] as number;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  K[3] = x - (z * (0.5 * y - v * r) - y - v * S1);
}

/** cos(x + y) into `K[4]`, for x = `K[2]` and y = `K[0]` (the 20-bit `qx` makes `1 - qx` exact). */
function kernelCos(): void {
  const x = K[2] as number;
  const y = K[0] as number;
  const a = Math.abs(x);
  if (a < 7.450580596923828e-9) {
    K[4] = 1;
    return;
  }
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (a < 0.3) {
    K[4] = 1 - (0.5 * z - (z * r - x * y));
    return;
  }
  const qx = Math.floor(0.5 * z * 1048576) / 1048576;
  K[4] = 1 - qx - (0.5 * z - qx - (z * r - x * y));
}

/** The angle for the kernels: x itself when it is within about π/4, else reduced (tail in `K[0]`, quadrant in `K[1]`). */
function prepare(): void {
  const x = K[5] as number;
  if (x > -0.78 && x < 0.78) {
    K[0] = 0;
    K[1] = 0;
    K[2] = x;
  } else reduce();
}

export function sin(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  K[5] = x;
  prepare();
  const q = K[1] as number;
  if (q === 0) {
    kernelSin();
    return K[3] as number;
  }
  if (q === 1) {
    kernelCos();
    return K[4] as number;
  }
  if (q === 2) {
    kernelSin();
    return -(K[3] as number);
  }
  kernelCos();
  return -(K[4] as number);
}

export function cos(x: number): number {
  if (!Number.isFinite(x)) return Number.NaN;
  K[5] = x;
  prepare();
  const q = K[1] as number;
  if (q === 0) {
    kernelCos();
    return K[4] as number;
  }
  if (q === 1) {
    kernelSin();
    return -(K[3] as number);
  }
  if (q === 2) {
    kernelCos();
    return -(K[4] as number);
  }
  kernelSin();
  return K[3] as number;
}

/** sin and cos of one angle in one reduction, written into `out` as [sin, cos]. */
export function sincos(x: number, out: Float64Array | number[]): void {
  K[5] = x;
  sincosOfK(out);
}

/**
 * `sincos` of `angles[i]`. The angle is read here and not passed: a number passed to a call that is not inlined is a heap
 * number, and the plane's world asks for the turn of every body in every small step (design 11.4).
 */
export function sincosAt(angles: Float64Array, i: number, out: Float64Array | number[]): void {
  K[5] = angles[i] as number;
  sincosOfK(out);
}

/** sin and cos of `K[5]` into `out`. */
function sincosOfK(out: Float64Array | number[]): void {
  if (!Number.isFinite(K[5])) {
    out[0] = Number.NaN;
    out[1] = Number.NaN;
    return;
  }
  prepare();
  const q = K[1] as number;
  kernelSin();
  kernelCos();
  const s = K[3] as number;
  const c = K[4] as number;
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
  // the edges of the platform's `Math.exp`: the largest argument with a finite answer, the smallest with a non-zero one
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019412) return 0;
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
