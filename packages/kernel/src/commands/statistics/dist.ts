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

/** μ − ln(1 + μ), without the cancellation near 0. */
function log1pmxNeg(mu: number): number {
  if (Math.abs(mu) > 0.01) return mu - Math.log1p(mu);
  // μ²/2 − μ³/3 + μ⁴/4 − …
  let term = mu * mu;
  let s = 0;
  for (let k = 2; k < 30; k++) {
    const add = term / k;
    s += k % 2 === 0 ? add : -add;
    if (Math.abs(add) < Math.abs(s) * EPS) break;
    term *= mu;
  }
  return s;
}

/** ln Γ(a) − ((a − ½) ln a − a + ½ ln 2π), the Stirling correction, for a ≥ 10. */
function stirlingCorr(a: number): number {
  const r = 1 / a;
  const r2 = r * r;
  return r * (1 / 12 - r2 * (1 / 360 - r2 * (1 / 1260 - r2 * (1 / 1680 - r2 / 1188))));
}

/** 18-point Gauss–Legendre nodes and weights on [0, 1], found once by Newton's method on P₁₈. */
const GL = ((): { y: Float64Array; w: Float64Array } => {
  const n = 18;
  const y = new Float64Array(n);
  const w = new Float64Array(n);
  for (let i = 0; i < n / 2; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p1 = 1;
      let p2 = 0;
      for (let j = 1; j <= n; j++) {
        const p3 = p2;
        p2 = p1;
        p1 = ((2 * j - 1) * z * p2 - (j - 1) * p3) / j;
      }
      pp = (n * (z * p1 - p2)) / (z * z - 1);
      const dz = p1 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    y[i] = (1 - z) / 2;
    y[n - 1 - i] = (1 + z) / 2;
    const wi = 1 / ((1 - z * z) * pp * pp);
    w[i] = wi;
    w[n - 1 - i] = wi;
  }
  return { y, w };
})();

/** ∫ f from lo to hi (either order) by 18-point Gauss–Legendre on `panels` equal pieces. */
function glIntegrate(f: (t: number) => number, lo: number, hi: number, panels: number): number {
  const h = (hi - lo) / panels;
  let sum = 0;
  for (let k = 0; k < panels; k++) {
    const left = lo + k * h;
    for (let j = 0; j < 18; j++) sum += (GL.w[j] as number) * f(left + h * (GL.y[j] as number));
  }
  return sum * h;
}

/** Pieces of the quadrature: the integrand spans up to about 16 standard deviations. */
const PANELS = 6;

/** From this shape on, the incomplete gamma is integrated by quadrature: the series needs about √a steps. */
const QUAD_FROM = 100;

/**
 * P(a, x) or Q(a, x), whichever is the small side, for a ≥ 100, by quadrature of the integrand near its peak. The
 * prefactor and the integrand are written in forms that do not cancel for large a (Stirling's series, log1p).
 */
function gammaQuad(a: number, x: number): { p: number; q: number } {
  const a1 = a - 1;
  const s = Math.sqrt(a1);
  const upper = x > a1;
  const xu = upper ? Math.max(a1 + 11.5 * s, x + 6 * s) : Math.max(0, Math.min(a1 - 7.5 * s, x - 5 * s));
  const integral = glIntegrate((t) => Math.exp(-a1 * log1pmxNeg((t - a1) / a1)), x, xu, PANELS);
  // a1^a1 e^−a1 / Γ(a) = 1 / √(2π a1) · e^−corr(a1)
  const ans = integral * Math.exp(-0.5 * Math.log(2 * Math.PI * a1) - stirlingCorr(a1));
  if (upper) return { p: 1 - ans, q: ans };
  return { p: -ans, q: 1 + ans };
}

/**
 * ln(y^(a−1) e^−y / Γ(a)), the log density of Gamma(a, 1) at y > 0. For a large shape the terms of size a ln a are
 * cancelled by hand (Stirling's series), so the result keeps its digits up to a = 1e15.
 */
export function gammaLogDensity(a: number, y: number): number {
  if (a < 100) return (a - 1) * Math.log(y) - y - lgamma(a);
  const a1 = a - 1;
  return -a1 * log1pmxNeg((y - a1) / a1) - 0.5 * Math.log(2 * Math.PI * a1) - stirlingCorr(a1);
}

/** Regularised lower and upper incomplete gamma P(a, x) and Q(a, x). */
export function gammaPQ(a: number, x: number): { p: number; q: number } {
  if (x <= 0) return { p: 0, q: 1 };
  if (a >= QUAD_FROM) return gammaQuad(a, x);
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
  // the fraction needs about √(max(a, b)) terms where the shapes are far apart
  const cap = Math.min(200000, 1000 + Math.ceil(4 * Math.sqrt(Math.max(a, b))));
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < cap; m++) {
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

/** From these shapes on (both), the incomplete beta is integrated by quadrature. */
const BETA_QUAD_FROM = 3000;

/**
 * I_x(a, b) for a, b ≥ 3000 by quadrature near the peak. The exponent's linear terms are summed exactly and the
 * prefactor B(a, b)⁻¹ μ^(a−1) (1−μ)^(b−1) is reduced by Stirling's series, so nothing of size a cancels.
 */
function betaQuad(x: number, a: number, b: number): number {
  const s = a + b;
  const mu = a / s;
  const a1 = a - 1;
  const b1 = b - 1;
  const sd = Math.sqrt((a * b) / (s * s * (s + 1)));
  const upper = x > mu;
  const xu = upper ? Math.min(1, Math.max(mu + 10 * sd, x + 5 * sd)) : Math.max(0, Math.min(mu - 10 * sd, x - 5 * sd));
  const lin = s * (1 / b - 1 / a);
  const integral = glIntegrate((t) => {
    const d = t - mu;
    return Math.exp(d * lin - a1 * log1pmxNeg(d / mu) - b1 * log1pmxNeg(-d / (1 - mu)));
  }, x, xu, PANELS);
  const pre = -0.5 * Math.log(a) - 0.5 * Math.log(b) + 1.5 * Math.log(s) - 0.5 * Math.log(2 * Math.PI)
    + stirlingCorr(s) - stirlingCorr(a) - stirlingCorr(b);
  const ans = integral * Math.exp(pre);
  return ans > 0 ? 1 - ans : -ans;
}

/**
 * Regularised incomplete beta I_x(a, b). `xc` is 1 − x when the caller knows it exactly (a binomial's `p` near 0
 * makes `1 − p` lose the digits of `p`).
 */
export function betaI(x: number, a: number, b: number, xc = 1 - x): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (a >= BETA_QUAD_FROM && b >= BETA_QUAD_FROM) return betaQuad(x, a, b);
  // the logs are taken of whichever of x and 1 − x is small, so a huge shape does not multiply a rounding error
  const lx = xc < 0.5 ? Math.log1p(-xc) : Math.log(x);
  const lxc = x < 0.5 ? Math.log1p(-x) : Math.log(xc);
  const lead = -lbeta(a, b) + a * lx + b * lxc;
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(lead) * betacf(a, b, x)) / a;
  return 1 - (Math.exp(lead) * betacf(b, a, xc)) / b;
}

/**
 * ln B(a, b) = ln Γ(a) + ln Γ(b) − ln Γ(a + b). For a large shape the three log-gammas are of size a ln a and cancel
 * to something of size b ln a, so the difference is formed from Stirling's series directly.
 */
export function lbeta(a: number, b: number): number {
  const big = Math.max(a, b);
  const small = Math.min(a, b);
  if (big < 100) return lgamma(a) + lgamma(b) - lgamma(a + b);
  const s = a + b;
  // ln Γ(big) − ln Γ(s) = −(big − ½) log1p(small / big) − small ln s + small + corr(big) − corr(s)
  const diff = -(big - 0.5) * Math.log1p(small / big) - small * Math.log(s) + small + stirlingCorr(big) - stirlingCorr(s);
  if (small < 10) return lgamma(small) + diff;
  return (small - 0.5) * Math.log(small) - small + 0.5 * Math.log(2 * Math.PI) + stirlingCorr(small) + diff;
}

/** The complementary error function, from Q(1/2, x²). */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x === 0) return 1;
  if (x > 27) return 0;
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
