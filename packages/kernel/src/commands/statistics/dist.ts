/**
 * Distribution functions for p-values and critical values (docs/features/statistics/design.md 8.4, 10.3): the normal,
 * Student t, chi-squared and F distributions, from the log-gamma function and the regularised incomplete gamma and beta
 * functions. Survival functions are computed directly so the tails stay accurate. The probability area reuses these.
 */

const LANCZOS = [
  0.9999999999998099, 676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406,
  12.507343278686905, -0.13857109526572012, 9.984369578019572e-06, 1.5056327351493116e-07,
];

/** ln Γ(x) for x > 0 (Lanczos, g = 7). */
export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0] as number;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += (LANCZOS[i] as number) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

const EPS = 1e-16;
const TINY = 1e-300;

/** Regularised lower and upper incomplete gamma P(a, x) and Q(a, x). */
export function gammaPQ(a: number, x: number): { p: number; q: number } {
  if (x <= 0) return { p: 0, q: 1 };
  const lead = -x + a * Math.log(x) - lgamma(a);
  if (x < a + 1) {
    // series
    let ap = a;
    let del = 1 / a;
    let s = del;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      s += del;
      if (Math.abs(del) < Math.abs(s) * EPS) break;
    }
    const p = s * Math.exp(lead);
    return { p, q: 1 - p };
  }
  // continued fraction (modified Lentz)
  let b = x + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  const q = Math.exp(lead) * h;
  return { p: 1 - q, q };
}

function betacf(a: number, b: number, x: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
export function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lead = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x);
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(lead) * betacf(a, b, x)) / a;
  return 1 - (Math.exp(lead) * betacf(b, a, 1 - x)) / b;
}

/** The complementary error function, from Q(1/2, x²). */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x === 0) return 1;
  return gammaPQ(0.5, x * x).q;
}

/* ------------------------------ distributions ------------------------------ */

export const normalCdf = (z: number): number => 0.5 * erfc(-z / Math.SQRT2);
export const normalSf = (z: number): number => 0.5 * erfc(z / Math.SQRT2);
export const normalPdf = (z: number): number => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** The normal quantile (Wichura, AS 241), accurate to about 1e-16. */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    return (q * (((((((r * 2509.0809287301227 + 33430.57558358813) * r + 67265.7709270087) * r + 45921.95393154987) * r + 13731.69376550946) * r + 1971.5909503065513) * r + 133.14166789178438) * r + 3.3871328727963665))
      / (((((((r * 5226.495278852546 + 28729.085735721943) * r + 39307.89580009271) * r + 21213.794301586597) * r + 5394.196021424751) * r + 687.1870074920579) * r + 42.31333070160091) * r + 1);
  }
  let r = q < 0 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let v: number;
  if (r <= 5) {
    r -= 1.6;
    v = (((((((r * 0.0007745450142783414 + 0.022723844989269184) * r + 0.2417807251774506) * r + 1.2704582524523684) * r + 3.6478483247632045) * r + 5.769497221460691) * r + 4.630337846156546) * r + 1.4234371107496835)
      / (((((((r * 1.0507500716444169e-09 + 0.0005475938084995345) * r + 0.015198666563616457) * r + 0.14810397642748008) * r + 0.6897673349851) * r + 1.6763848301838038) * r + 2.053191626637759) * r + 1);
  } else {
    r -= 5;
    v = (((((((r * 2.0103343992922881e-07 + 2.7115555687434876e-05) * r + 0.0012426609473880784) * r + 0.026532189526576124) * r + 0.29656057182850487) * r + 1.7848265399172913) * r + 5.463784911164114) * r + 6.657904643501103)
      / (((((((r * 2.0442631033899397e-15 + 1.421511758316446e-07) * r + 1.8463183175100548e-05) * r + 0.0007868691311456133) * r + 0.014875361290850615) * r + 0.1369298809227358) * r + 0.599832206555888) * r + 1);
  }
  return q < 0 ? -v : v;
}

/** Student t: the probability above |t| on one side. `df` may be fractional (Welch). */
export function tTail(t: number, df: number): number {
  if (!Number.isFinite(df) || df > 1e7) return normalSf(Math.abs(t));
  return 0.5 * betaI(df / (df + t * t), df / 2, 0.5);
}

export const tCdf = (t: number, df: number): number => (t >= 0 ? 1 - tTail(t, df) : tTail(t, df));
export const tSf = (t: number, df: number): number => (t >= 0 ? tTail(t, df) : 1 - tTail(t, df));

export const chiSqSf = (x: number, k: number): number => (x <= 0 ? 1 : gammaPQ(k / 2, x / 2).q);
export const chiSqCdf = (x: number, k: number): number => (x <= 0 ? 0 : gammaPQ(k / 2, x / 2).p);

export const fSf = (x: number, d1: number, d2: number): number => (x <= 0 ? 1 : betaI(d2 / (d2 + d1 * x), d2 / 2, d1 / 2));

/** Inverts an increasing function on a bracket by bisection to full precision. */
function invert(cdf: (x: number) => number, p: number, lo: number, hi: number): number {
  while (cdf(hi) < p) hi *= 2;
  while (cdf(lo) > p) lo = lo < 0 ? lo * 2 : lo - 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (mid === lo || mid === hi) break;
    if (cdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function tQuantile(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;
  if (!Number.isFinite(df) || df > 1e7) return normalQuantile(p);
  const z = normalQuantile(p);
  return invert((t) => tCdf(t, df), p, Math.min(-1, z * 4 - 10), Math.max(1, z * 4 + 10));
}

export function chiSqQuantile(p: number, k: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  return invert((x) => chiSqCdf(x, k), p, 0, Math.max(1, k * 4));
}
