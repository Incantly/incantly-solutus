/**
 * The distribution table (docs/features/probability/design.md 3.2): one entry per distribution with its parameters,
 * support, density or mass, cdf, survival function, quantile, moments and sampler. Adding a distribution is one entry.
 *
 * No DOM, no timers, no Date.
 */
import {
  betaI, chiSqQuantile, gammaPQ, lgamma, normalCdf, normalQuantile, normalSf, tCdf, tQuantile, tSf,
} from '../statistics/dist';

declare module '../../contracts/values' {
  interface AreaTypeNames {
    // probability: `Distribution` is a parameter alias of these two
    ContinuousDistribution: true;
    DiscreteDistribution: true;
  }
}

export interface ParamDef {
  readonly name: string;
  /** True when the value is allowed. */
  readonly ok: (v: number, all: readonly number[]) => boolean;
  /** The rule in words, for `bad_parameter`: "sigma > 0". */
  readonly rule: string;
}

export interface Moments {
  readonly mean?: number;
  readonly variance?: number;
  readonly skewness?: number;
  /** Excess kurtosis (0 for a normal). */
  readonly kurtosis?: number;
  readonly median?: number;
  readonly mode?: readonly number[];
}

type MutableMoments = { -readonly [k in keyof Moments]: Moments[k] };

/** A source of uniform numbers strictly between 0 and 1. */
export type Uniform01 = () => number;

export interface DistSpec {
  readonly kind: string;
  readonly discrete: boolean;
  readonly params: readonly ParamDef[];
  readonly support: (p: readonly number[]) => { lo: number; hi: number };
  /** Density, or mass for a discrete distribution. */
  readonly pdf: (p: readonly number[], x: number) => number;
  /** Log of the density, accurate where `pdf` underflows (absent: the log of `pdf`). */
  readonly logpdf?: (p: readonly number[], x: number) => number;
  /** P(X ≤ x). */
  readonly cdf: (p: readonly number[], x: number) => number;
  /** P(X < x) for a discrete distribution; on a whole-number lattice `cdf(ceil(x) - 1)`. */
  readonly cdfBelow?: (p: readonly number[], x: number) => number;
  /** P(X > x), accurate in the upper tail. */
  readonly sf: (p: readonly number[], x: number) => number;
  /** The smallest x with cdf(x) ≥ q. */
  readonly quantile: (p: readonly number[], q: number) => number;
  /** The smallest x with sf(x) ≤ q, precise for tiny q (absent: found from `sf`). */
  readonly quantileUpper?: (p: readonly number[], q: number) => number;
  readonly moments: (p: readonly number[]) => Moments;
  /** One draw; absent: the quantile of one uniform. */
  readonly sample?: (p: readonly number[], u: Uniform01) => number;
  /** Values of a `Discrete(values, probs)`, for the summary and the fields. */
  readonly atoms?: { readonly values: Float64Array; readonly probs: Float64Array };
}

/** A distribution value: its spec and parameters. Fields read from `moments`. */
export interface DistributionValue {
  readonly kind: 'dist';
  readonly spec: DistSpec;
  readonly params: readonly number[];
}

export function isDist(v: unknown): v is DistributionValue {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'dist';
}

const pos = (name: string): ParamDef => ({ name, ok: (v) => v > 0 && Number.isFinite(v), rule: `${name} > 0` });
const real = (name: string): ParamDef => ({ name, ok: Number.isFinite, rule: `${name} is a number` });
const prob = (name: string, open = false): ParamDef => ({ name, ok: (v) => (open ? v > 0 : v >= 0) && v <= 1, rule: open ? `0 < ${name} ≤ 1` : `0 ≤ ${name} ≤ 1` });
const whole = (name: string, min: number): ParamDef => ({ name, ok: (v) => Number.isInteger(v) && v >= min, rule: `${name} is a whole number from ${min}` });

const LN_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);
const gammaFn = (x: number): number => Math.exp(lgamma(x));
const lchoose = (n: number, k: number): number => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

/* ------------------------------ solvers ------------------------------ */

/**
 * Solves g(x) = target for an increasing g by safeguarded Newton (design 5.2): a bracket is kept, and a step that leaves
 * it, or two steps that do not halve it, are replaced by bisection. `dg` is the derivative (the density).
 */
export function solveIncreasing(g: (x: number) => number, dg: (x: number) => number, target: number, lo: number, hi: number, x0: number): number {
  let a = lo;
  let b = hi;
  const start = Number.isFinite(x0) ? x0 : 0;
  if (!Number.isFinite(a)) {
    let step = Math.max(1, Math.abs(start));
    a = Math.min(start, Number.isFinite(b) ? b : start) - step;
    for (let i = 0; i < 2000 && g(a) > target; i++) {
      step *= 2;
      a -= step;
    }
  }
  if (!Number.isFinite(b)) {
    let step = Math.max(1, Math.abs(start));
    b = Math.max(start, a) + step;
    for (let i = 0; i < 2000 && g(b) < target; i++) {
      step *= 2;
      b += step;
    }
  }
  let x = start > a && start < b ? start : (a + b) / 2;
  let width = b - a;
  for (let i = 0; i < 200; i++) {
    const f = g(x) - target;
    if (f === 0) return x;
    if (f < 0) a = x;
    else b = x;
    if (b - a <= 4e-16 * Math.max(Math.abs(a), Math.abs(b)) || b - a < 1e-300) return (a + b) / 2;
    const d = dg(x);
    let nx = x - f / d;
    if (!(nx > a && nx < b) || (i % 2 === 1 && b - a > width / 2)) nx = (a + b) / 2;
    if (i % 2 === 1) width = b - a;
    if (Math.abs(nx - x) <= 4e-16 * Math.abs(x)) return nx;
    x = nx;
  }
  return x;
}

/** The smallest whole k in [lo, hi] with cdf(k) ≥ q, by bisection on the monotone cdf; a 4-ulp allowance for rounding. */
function discreteQuantile(cdf: (k: number) => number, q: number, lo: number, hi: number): number {
  if (q <= 0) return lo;
  let a = lo;
  let b = hi;
  if (!Number.isFinite(b)) {
    b = Math.max(1, lo + 1);
    while (cdf(b) < q && b < 1e15) b = b * 2 + 1;
  }
  // the incomplete beta and gamma routines are good to about 1e-13, so a relative slack of 1e-12 (design 5.2 says 4 eps)
  const target = q * (1 - 1e-12);
  while (a < b) {
    const m = Math.floor((a + b) / 2);
    if (cdf(m) >= target) b = m;
    else a = m + 1;
  }
  return a;
}

/** The smallest whole k in [lo, hi] with sf(k) ≤ q. */
export function discreteQuantileUpper(sf: (k: number) => number, q: number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  if (!Number.isFinite(b)) {
    b = Math.max(1, lo + 1);
    while (sf(b) > q && b < 1e15) b = b * 2 + 1;
  }
  const target = q * (1 + 1e-12);
  while (a < b) {
    const m = Math.floor((a + b) / 2);
    if (sf(m) <= target) b = m;
    else a = m + 1;
  }
  return a;
}

/* ------------------------------ samplers ------------------------------ */

const stdNormal = (u: Uniform01): number => normalQuantile(u());

/** Marsaglia–Tsang squeeze for Gamma(shape, 1); a shape below 1 by boosting (design 6.4). */
export function gammaDraw(shape: number, u: Uniform01): number {
  if (shape < 1) return gammaDraw(shape + 1, u) * Math.pow(u(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let i = 0; i < 1000; i++) {
    const x = stdNormal(u);
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const w = u();
    const x2 = x * x;
    if (w < 1 - 0.0331 * x2 * x2) return d * v;
    if (Math.log(w) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v;
  }
  return d;
}

/** Poisson: multiplication for small means, PTRS (Hörmann) from 10. */
export function poissonDraw(lam: number, u: Uniform01): number {
  if (lam <= 0) return 0;
  if (lam < 10) {
    const L = Math.exp(-lam);
    let k = 0;
    let prod = u();
    while (prod > L && k < 1000) {
      k++;
      prod *= u();
    }
    return k;
  }
  const slam = Math.sqrt(lam);
  const loglam = Math.log(lam);
  const b = 0.931 + 2.53 * slam;
  const a = -0.059 + 0.02483 * b;
  const invalpha = 1.1239 + 1.1328 / (b - 3.4);
  const vr = 0.9277 - 3.6224 / (b - 2);
  for (let i = 0; i < 1000; i++) {
    const U = u() - 0.5;
    const V = u();
    const us = 0.5 - Math.abs(U);
    const k = Math.floor(((2 * a) / us + b) * U + lam + 0.43);
    if (us >= 0.07 && V <= vr) return k;
    if (k < 0 || (us < 0.013 && V > us)) continue;
    if (Math.log(V) + Math.log(invalpha) - Math.log(a / (us * us) + b) <= -lam + k * loglam - lgamma(k + 1)) return k;
  }
  return Math.round(lam);
}

interface Btrs {
  readonly n: number;
  readonly p: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly vr: number;
  readonly alpha: number;
  readonly lpq: number;
  readonly m: number;
  readonly h: number;
}

let lastBtrs: Btrs | undefined;

/** The constants of BTRS for (n, p), kept for the last pair so a sample pays for them once. */
function btrsSetup(n: number, p: number): Btrs {
  if (lastBtrs && lastBtrs.n === n && lastBtrs.p === p) return lastBtrs;
  const q = 1 - p;
  const spq = Math.sqrt(n * p * q);
  const b = 1.15 + 2.53 * spq;
  const m = Math.floor((n + 1) * p);
  lastBtrs = {
    n, p, b, a: -0.0873 + 0.0248 * b + 0.01 * p, c: n * p + 0.5, vr: 0.92 - 4.2 / b, alpha: (2.83 + 5.1 / b) * spq,
    lpq: Math.log(p / q), m, h: lgamma(m + 1) + lgamma(n - m + 1),
  };
  return lastBtrs;
}

/** Binomial: inversion by the pmf recurrence for small n·min(p, q), BTRS (Hörmann) otherwise. */
export function binomialDraw(n: number, p: number, u: Uniform01): number {
  if (p <= 0 || n === 0) return 0;
  if (p >= 1) return n;
  if (p > 0.5) return n - binomialDraw(n, 1 - p, u);
  const q = 1 - p;
  if (n * p < 14) {
    const s = p / q;
    const a = (n + 1) * s;
    let r = Math.pow(q, n);
    let w = u();
    let x = 0;
    while (w > r && x < n) {
      w -= r;
      x++;
      r *= a / x - s;
    }
    return x;
  }
  const { a, b, c, vr, alpha, lpq, m, h } = btrsSetup(n, p);
  for (let i = 0; i < 1000; i++) {
    const U = u() - 0.5;
    let V = u();
    const us = 0.5 - Math.abs(U);
    const k = Math.floor(((2 * a) / us + b) * U + c);
    if (k < 0 || k > n) continue;
    if (us >= 0.07 && V <= vr) return k;
    V = Math.log((V * alpha) / (a / (us * us) + b));
    if (V <= h - lgamma(k + 1) - lgamma(n - k + 1) + (k - m) * lpq) return k;
  }
  return Math.round(n * p);
}

/* ------------------------------ continuous ------------------------------ */

const NORMAL: DistSpec = {
  kind: 'Normal', discrete: false, params: [real('mu'), pos('sigma')],
  support: () => ({ lo: -Infinity, hi: Infinity }),
  pdf: ([m, s], x) => Math.exp(-0.5 * ((x - (m as number)) / (s as number)) ** 2) / ((s as number) * Math.sqrt(2 * Math.PI)),
  logpdf: ([m, s], x) => -0.5 * ((x - (m as number)) / (s as number)) ** 2 - Math.log(s as number) - LN_SQRT_2PI,
  cdf: ([m, s], x) => normalCdf((x - (m as number)) / (s as number)),
  sf: ([m, s], x) => normalSf((x - (m as number)) / (s as number)),
  quantile: ([m, s], q) => (m as number) + (s as number) * normalQuantile(q),
  quantileUpper: ([m, s], q) => (m as number) - (s as number) * normalQuantile(q),
  moments: ([m, s]) => ({ mean: m as number, variance: (s as number) ** 2, skewness: 0, kurtosis: 0, median: m as number, mode: [m as number] }),
  sample: ([m, s], u) => (m as number) + (s as number) * normalQuantile(u()),
};

const tLog = (n: number, x: number): number => lgamma((n + 1) / 2) - lgamma(n / 2) - 0.5 * Math.log(n * Math.PI) - ((n + 1) / 2) * Math.log1p((x * x) / n);

const STUDENT_T: DistSpec = {
  kind: 'StudentT', discrete: false, params: [pos('df')],
  support: () => ({ lo: -Infinity, hi: Infinity }),
  pdf: ([v], x) => Math.exp(tLog(v as number, x)),
  logpdf: ([v], x) => tLog(v as number, x),
  cdf: ([v], x) => tCdf(x, v as number),
  sf: ([v], x) => tSf(x, v as number),
  quantile: ([v], q) => tQuantile(q, v as number),
  quantileUpper: ([v], q) => -tQuantile(q, v as number),
  moments: ([v]) => {
    const n = v as number;
    return {
      ...(n > 1 ? { mean: 0 } : {}),
      ...(n > 2 ? { variance: n / (n - 2) } : n > 1 ? { variance: Infinity } : {}),
      ...(n > 3 ? { skewness: 0 } : {}),
      ...(n > 4 ? { kurtosis: 6 / (n - 4) } : n > 2 ? { kurtosis: Infinity } : {}),
      median: 0, mode: [0],
    };
  },
  sample: ([v], u) => {
    const n = v as number;
    return stdNormal(u) / Math.sqrt((2 * gammaDraw(n / 2, u)) / n);
  },
};

const gammaLog = (a: number, r: number, x: number): number => a * Math.log(r) + (a - 1) * Math.log(x) - r * x - lgamma(a);
const gammaPdf = (a: number, r: number, x: number): number => (x < 0 ? 0 : x === 0 ? (a === 1 ? r : a < 1 ? Infinity : 0) : Math.exp(gammaLog(a, r, x)));

/** A gamma-family entry with shape and rate taken from the parameters. */
function gammaFamily(kind: string, params: readonly ParamDef[], shapeRate: (p: readonly number[]) => [number, number]): DistSpec {
  const self: DistSpec = {
    kind, discrete: false, params,
    support: () => ({ lo: 0, hi: Infinity }),
    pdf: (p, x) => {
      const [a, r] = shapeRate(p);
      return gammaPdf(a, r, x);
    },
    logpdf: (p, x) => {
      const [a, r] = shapeRate(p);
      return x <= 0 ? -Infinity : gammaLog(a, r, x);
    },
    cdf: (p, x) => {
      const [a, r] = shapeRate(p);
      return x <= 0 ? 0 : gammaPQ(a, r * x).p;
    },
    sf: (p, x) => {
      const [a, r] = shapeRate(p);
      return x <= 0 ? 1 : gammaPQ(a, r * x).q;
    },
    quantile: (p, q) => {
      const [a, r] = shapeRate(p);
      const x0 = chiSqQuantile(q, 2 * a) / (2 * r);
      return solveIncreasing((x) => (x <= 0 ? 0 : gammaPQ(a, r * x).p), (x) => gammaPdf(a, r, x), q, 0, Infinity, x0);
    },
    quantileUpper: (p, q) => {
      const [a, r] = shapeRate(p);
      const x0 = chiSqQuantile(Math.max(0, 1 - q), 2 * a) / (2 * r);
      return solveIncreasing((x) => (x <= 0 ? -1 : -gammaPQ(a, r * x).q), (x) => gammaPdf(a, r, x), -q, 0, Infinity, x0);
    },
    moments: (p) => {
      const [a, r] = shapeRate(p);
      return { mean: a / r, variance: a / (r * r), skewness: 2 / Math.sqrt(a), kurtosis: 6 / a, median: self.quantile(p, 0.5), mode: [a >= 1 ? (a - 1) / r : 0] };
    },
    sample: (p, u) => {
      const [a, r] = shapeRate(p);
      return gammaDraw(a, u) / r;
    },
  };
  return self;
}

const CHI_SQUARED = gammaFamily('ChiSquared', [pos('df')], ([k]) => [(k as number) / 2, 0.5]);
const GAMMA = gammaFamily('Gamma', [pos('shape'), pos('rate')], ([a, r]) => [a as number, r as number]);
const ERLANG = gammaFamily('Erlang', [whole('k', 1), pos('rate')], ([k, r]) => [k as number, r as number]);

const fLog = (d1: number, d2: number, x: number): number => {
  const lb = lgamma(d1 / 2) + lgamma(d2 / 2) - lgamma((d1 + d2) / 2);
  return 0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - lb;
};

const F_DIST: DistSpec = {
  kind: 'FDist', discrete: false, params: [pos('d1'), pos('d2')],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([a, b], x) => (x < 0 ? 0 : x === 0 ? ((a as number) === 2 ? 1 : (a as number) < 2 ? Infinity : 0) : Math.exp(fLog(a as number, b as number, x))),
  logpdf: ([a, b], x) => (x <= 0 ? -Infinity : fLog(a as number, b as number, x)),
  cdf: ([a, b], x) => (x <= 0 ? 0 : betaI(((a as number) * x) / ((a as number) * x + (b as number)), (a as number) / 2, (b as number) / 2)),
  sf: ([a, b], x) => (x <= 0 ? 1 : betaI((b as number) / ((b as number) + (a as number) * x), (b as number) / 2, (a as number) / 2)),
  quantile: (p, q) => solveIncreasing((x) => F_DIST.cdf(p, x), (x) => F_DIST.pdf(p, x), q, 0, Infinity, 1),
  moments: ([a, b]) => {
    const d1 = a as number;
    const d2 = b as number;
    return {
      ...(d2 > 2 ? { mean: d2 / (d2 - 2) } : {}),
      ...(d2 > 4 ? { variance: (2 * d2 * d2 * (d1 + d2 - 2)) / (d1 * (d2 - 2) ** 2 * (d2 - 4)) } : {}),
      ...(d2 > 6 ? { skewness: ((2 * d1 + d2 - 2) * Math.sqrt(8 * (d2 - 4))) / ((d2 - 6) * Math.sqrt(d1 * (d1 + d2 - 2))) } : {}),
      ...(d2 > 8 ? { kurtosis: (12 * (d1 * (5 * d2 - 22) * (d1 + d2 - 2) + (d2 - 4) * (d2 - 2) ** 2)) / (d1 * (d2 - 6) * (d2 - 8) * (d1 + d2 - 2)) } : {}),
      median: F_DIST.quantile([d1, d2], 0.5),
      mode: [d1 > 2 ? ((d1 - 2) / d1) * (d2 / (d2 + 2)) : 0],
    };
  },
  sample: ([a, b], u) => {
    const d1 = a as number;
    const d2 = b as number;
    return (gammaDraw(d1 / 2, u) / d1) / (gammaDraw(d2 / 2, u) / d2);
  },
};

const EXPONENTIAL: DistSpec = {
  kind: 'Exponential', discrete: false, params: [pos('rate')],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([r], x) => (x < 0 ? 0 : (r as number) * Math.exp(-(r as number) * x)),
  logpdf: ([r], x) => (x < 0 ? -Infinity : Math.log(r as number) - (r as number) * x),
  cdf: ([r], x) => (x <= 0 ? 0 : -Math.expm1(-(r as number) * x)),
  sf: ([r], x) => (x <= 0 ? 1 : Math.exp(-(r as number) * x)),
  quantile: ([r], q) => -Math.log1p(-q) / (r as number),
  quantileUpper: ([r], q) => -Math.log(q) / (r as number),
  moments: ([r]) => ({ mean: 1 / (r as number), variance: 1 / (r as number) ** 2, skewness: 2, kurtosis: 6, median: Math.LN2 / (r as number), mode: [0] }),
};

const betaLog = (a: number, b: number, x: number): number => (a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - (lgamma(a) + lgamma(b) - lgamma(a + b));

const BETA: DistSpec = {
  kind: 'Beta', discrete: false, params: [pos('a'), pos('b')],
  support: () => ({ lo: 0, hi: 1 }),
  pdf: ([a, b], x) => {
    const A = a as number;
    const B = b as number;
    if (x < 0 || x > 1) return 0;
    if (x === 0) return A === 1 ? B : A < 1 ? Infinity : 0;
    if (x === 1) return B === 1 ? A : B < 1 ? Infinity : 0;
    return Math.exp(betaLog(A, B, x));
  },
  logpdf: ([a, b], x) => (x <= 0 || x >= 1 ? -Infinity : betaLog(a as number, b as number, x)),
  cdf: ([a, b], x) => (x <= 0 ? 0 : x >= 1 ? 1 : betaI(x, a as number, b as number)),
  sf: ([a, b], x) => (x <= 0 ? 1 : x >= 1 ? 0 : betaI(1 - x, b as number, a as number)),
  quantile: (p, q) => solveIncreasing((x) => BETA.cdf(p, x), (x) => BETA.pdf(p, x), q, 0, 1, (p[0] as number) / ((p[0] as number) + (p[1] as number))),
  quantileUpper: (p, q) => 1 - BETA.quantile([p[1] as number, p[0] as number], q),
  moments: ([a, b]) => {
    const A = a as number;
    const B = b as number;
    const s = A + B;
    const mode = A > 1 && B > 1 ? [(A - 1) / (s - 2)] : A < 1 && B < 1 ? [0, 1] : A <= 1 && B > 1 ? [0] : A > 1 && B <= 1 ? [1] : undefined;
    return {
      mean: A / s, variance: (A * B) / (s * s * (s + 1)),
      skewness: (2 * (B - A) * Math.sqrt(s + 1)) / ((s + 2) * Math.sqrt(A * B)),
      kurtosis: (6 * ((A - B) ** 2 * (s + 1) - A * B * (s + 2))) / (A * B * (s + 2) * (s + 3)),
      median: BETA.quantile([A, B], 0.5),
      ...(mode ? { mode } : {}),
    };
  },
  sample: ([a, b], u) => {
    const x = gammaDraw(a as number, u);
    const y = gammaDraw(b as number, u);
    return x / (x + y);
  },
};

const CAUCHY: DistSpec = {
  kind: 'Cauchy', discrete: false, params: [real('median'), pos('scale')],
  support: () => ({ lo: -Infinity, hi: Infinity }),
  pdf: ([m, s], x) => 1 / (Math.PI * (s as number) * (1 + ((x - (m as number)) / (s as number)) ** 2)),
  cdf: ([m, s], x) => 0.5 + Math.atan((x - (m as number)) / (s as number)) / Math.PI,
  sf: ([m, s], x) => 0.5 - Math.atan((x - (m as number)) / (s as number)) / Math.PI,
  quantile: ([m, s], q) => (m as number) + (s as number) * Math.tan(Math.PI * (q - 0.5)),
  quantileUpper: ([m, s], q) => (m as number) - (s as number) * Math.tan(Math.PI * (q - 0.5)),
  moments: ([m]) => ({ median: m as number, mode: [m as number] }),
};

const WEIBULL: DistSpec = {
  kind: 'Weibull', discrete: false, params: [pos('shape'), pos('scale')],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([k, l], x) => {
    const K = k as number;
    const L = l as number;
    if (x < 0) return 0;
    if (x === 0) return K === 1 ? 1 / L : K < 1 ? Infinity : 0;
    return (K / L) * Math.pow(x / L, K - 1) * Math.exp(-Math.pow(x / L, K));
  },
  cdf: ([k, l], x) => (x <= 0 ? 0 : -Math.expm1(-Math.pow(x / (l as number), k as number))),
  sf: ([k, l], x) => (x <= 0 ? 1 : Math.exp(-Math.pow(x / (l as number), k as number))),
  quantile: ([k, l], q) => (l as number) * Math.pow(-Math.log1p(-q), 1 / (k as number)),
  quantileUpper: ([k, l], q) => (l as number) * Math.pow(-Math.log(q), 1 / (k as number)),
  moments: ([k, l]) => {
    const K = k as number;
    const L = l as number;
    const r = (i: number): number => L ** i * gammaFn(1 + i / K);
    const m = r(1);
    const v = r(2) - m * m;
    const sd = Math.sqrt(v);
    const m3 = r(3) - 3 * m * r(2) + 2 * m ** 3;
    const m4 = r(4) - 4 * m * r(3) + 6 * m * m * r(2) - 3 * m ** 4;
    return {
      mean: m, variance: v, skewness: m3 / sd ** 3, kurtosis: m4 / (v * v) - 3,
      median: L * Math.pow(Math.LN2, 1 / K), mode: [K > 1 ? L * Math.pow((K - 1) / K, 1 / K) : 0],
    };
  },
};

const LOG_NORMAL: DistSpec = {
  kind: 'LogNormal', discrete: false, params: [real('mu'), pos('sigma')],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([m, s], x) => (x <= 0 ? 0 : Math.exp(-0.5 * ((Math.log(x) - (m as number)) / (s as number)) ** 2) / (x * (s as number) * Math.sqrt(2 * Math.PI))),
  logpdf: ([m, s], x) => (x <= 0 ? -Infinity : -0.5 * ((Math.log(x) - (m as number)) / (s as number)) ** 2 - Math.log(x * (s as number)) - LN_SQRT_2PI),
  cdf: ([m, s], x) => (x <= 0 ? 0 : normalCdf((Math.log(x) - (m as number)) / (s as number))),
  sf: ([m, s], x) => (x <= 0 ? 1 : normalSf((Math.log(x) - (m as number)) / (s as number))),
  quantile: ([m, s], q) => Math.exp((m as number) + (s as number) * normalQuantile(q)),
  quantileUpper: ([m, s], q) => Math.exp((m as number) - (s as number) * normalQuantile(q)),
  moments: ([m, s]) => {
    const M = m as number;
    const s2 = (s as number) ** 2;
    const e = Math.exp(s2);
    return {
      mean: Math.exp(M + s2 / 2), variance: (e - 1) * Math.exp(2 * M + s2), skewness: (e + 2) * Math.sqrt(e - 1),
      kurtosis: Math.exp(4 * s2) + 2 * Math.exp(3 * s2) + 3 * Math.exp(2 * s2) - 6, median: Math.exp(M), mode: [Math.exp(M - s2)],
    };
  },
};

const LOGISTIC: DistSpec = {
  kind: 'Logistic', discrete: false, params: [real('mu'), pos('scale')],
  support: () => ({ lo: -Infinity, hi: Infinity }),
  pdf: ([m, s], x) => {
    const e = Math.exp(-Math.abs((x - (m as number)) / (s as number)));
    return e / ((s as number) * (1 + e) ** 2);
  },
  cdf: ([m, s], x) => 1 / (1 + Math.exp(-(x - (m as number)) / (s as number))),
  sf: ([m, s], x) => 1 / (1 + Math.exp((x - (m as number)) / (s as number))),
  quantile: ([m, s], q) => (m as number) + (s as number) * Math.log(q / (1 - q)),
  quantileUpper: ([m, s], q) => (m as number) + (s as number) * Math.log((1 - q) / q),
  moments: ([m, s]) => ({ mean: m as number, variance: ((s as number) * Math.PI) ** 2 / 3, skewness: 0, kurtosis: 1.2, median: m as number, mode: [m as number] }),
};

const TRIANGULAR: DistSpec = {
  kind: 'Triangular', discrete: false,
  params: [
    real('min'),
    { name: 'mode', ok: (v, all) => Number.isFinite(v) && v >= (all[0] as number), rule: 'min ≤ mode ≤ max' },
    { name: 'max', ok: (v, all) => Number.isFinite(v) && v > (all[0] as number) && v >= (all[1] as number), rule: 'min < max and mode ≤ max' },
  ],
  support: ([a, , b]) => ({ lo: a as number, hi: b as number }),
  pdf: ([a, c, b], x) => {
    const A = a as number;
    const B = b as number;
    const C = c as number;
    if (x < A || x > B) return 0;
    if (x < C) return (2 * (x - A)) / ((B - A) * (C - A));
    if (x === C) return 2 / (B - A);
    return (2 * (B - x)) / ((B - A) * (B - C));
  },
  cdf: ([a, c, b], x) => {
    const A = a as number;
    const B = b as number;
    const C = c as number;
    if (x <= A) return 0;
    if (x >= B) return 1;
    if (x <= C) return (x - A) ** 2 / ((B - A) * (C - A));
    return 1 - (B - x) ** 2 / ((B - A) * (B - C));
  },
  sf: ([a, c, b], x) => {
    const A = a as number;
    const B = b as number;
    const C = c as number;
    if (x <= A) return 1;
    if (x >= B) return 0;
    if (x > C) return (B - x) ** 2 / ((B - A) * (B - C));
    return 1 - (x - A) ** 2 / ((B - A) * (C - A));
  },
  quantile: ([a, c, b], q) => {
    const A = a as number;
    const B = b as number;
    const C = c as number;
    return q < (C - A) / (B - A) ? A + Math.sqrt(q * (B - A) * (C - A)) : B - Math.sqrt((1 - q) * (B - A) * (B - C));
  },
  moments: ([a, c, b]) => {
    const A = a as number;
    const B = b as number;
    const C = c as number;
    const t = A * A + B * B + C * C - A * B - A * C - B * C;
    return {
      mean: (A + B + C) / 3, variance: t / 18,
      skewness: (Math.SQRT2 * (A + B - 2 * C) * (2 * A - B - C) * (A - 2 * B + C)) / (5 * Math.pow(t, 1.5)),
      kurtosis: -0.6,
      median: C >= (A + B) / 2 ? A + Math.sqrt(((B - A) * (C - A)) / 2) : B - Math.sqrt(((B - A) * (B - C)) / 2),
      mode: [C],
    };
  },
};

const UNIFORM: DistSpec = {
  kind: 'Uniform', discrete: false,
  params: [real('min'), { name: 'max', ok: (v, all) => Number.isFinite(v) && v > (all[0] as number), rule: 'max > min' }],
  support: ([a, b]) => ({ lo: a as number, hi: b as number }),
  pdf: ([a, b], x) => (x < (a as number) || x > (b as number) ? 0 : 1 / ((b as number) - (a as number))),
  cdf: ([a, b], x) => Math.min(1, Math.max(0, (x - (a as number)) / ((b as number) - (a as number)))),
  sf: ([a, b], x) => Math.min(1, Math.max(0, ((b as number) - x) / ((b as number) - (a as number)))),
  quantile: ([a, b], q) => (a as number) + q * ((b as number) - (a as number)),
  quantileUpper: ([a, b], q) => (b as number) - q * ((b as number) - (a as number)),
  moments: ([a, b]) => ({ mean: ((a as number) + (b as number)) / 2, variance: ((b as number) - (a as number)) ** 2 / 12, skewness: 0, kurtosis: -1.2, median: ((a as number) + (b as number)) / 2 }),
};

/* ------------------------------ discrete ------------------------------ */

/** P(X < x) on a whole-number lattice. */
const lattice = (spec: () => DistSpec) => (p: readonly number[], x: number): number => spec().cdf(p, Math.ceil(x) - 1);

const binomCdf = (n: number, p: number, k: number): number => {
  if (k < 0) return 0;
  if (k >= n) return 1;
  const j = Math.floor(k);
  return betaI(1 - p, n - j, j + 1);
};
const binomSf = (n: number, p: number, k: number): number => {
  if (k < 0) return 1;
  if (k >= n) return 0;
  const j = Math.floor(k);
  return betaI(p, j + 1, n - j);
};

const BINOMIAL: DistSpec = {
  kind: 'Binomial', discrete: true, params: [whole('n', 0), prob('p')],
  support: ([n]) => ({ lo: 0, hi: n as number }),
  pdf: ([n, p], k) => {
    const N = n as number;
    const P = p as number;
    if (!Number.isInteger(k) || k < 0 || k > N) return 0;
    if (P === 0) return k === 0 ? 1 : 0;
    if (P === 1) return k === N ? 1 : 0;
    return Math.exp(lchoose(N, k) + k * Math.log(P) + (N - k) * Math.log1p(-P));
  },
  cdf: ([n, p], k) => ((p as number) === 0 ? (k >= 0 ? 1 : 0) : (p as number) === 1 ? (k >= (n as number) ? 1 : 0) : binomCdf(n as number, p as number, k)),
  cdfBelow: lattice(() => BINOMIAL),
  sf: ([n, p], k) => ((p as number) === 0 ? (k >= 0 ? 0 : 1) : (p as number) === 1 ? (k >= (n as number) ? 0 : 1) : binomSf(n as number, p as number, k)),
  quantile: (p, q) => discreteQuantile((k) => BINOMIAL.cdf(p, k), q, 0, p[0] as number),
  quantileUpper: (p, q) => discreteQuantileUpper((k) => BINOMIAL.sf(p, k), q, 0, p[0] as number),
  moments: ([n, p]) => {
    const N = n as number;
    const P = p as number;
    const v = N * P * (1 - P);
    const t = (N + 1) * P;
    const mode = P === 0 ? [0] : P === 1 ? [N] : Number.isInteger(t) && t >= 1 && t <= N ? [t - 1, t] : [Math.min(N, Math.floor(t))];
    return {
      mean: N * P, variance: v, ...(v > 0 ? { skewness: (1 - 2 * P) / Math.sqrt(v), kurtosis: (1 - 6 * P * (1 - P)) / v } : {}),
      median: BINOMIAL.quantile([N, P], 0.5), mode,
    };
  },
  sample: ([n, p], u) => binomialDraw(n as number, p as number, u),
};

const POISSON: DistSpec = {
  kind: 'Poisson', discrete: true, params: [{ name: 'mean', ok: (v) => v >= 0 && Number.isFinite(v), rule: 'mean ≥ 0' }],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([m], k) => {
    const l = m as number;
    if (!Number.isInteger(k) || k < 0) return 0;
    if (l === 0) return k === 0 ? 1 : 0;
    return Math.exp(k * Math.log(l) - l - lgamma(k + 1));
  },
  logpdf: ([m], k) => (!Number.isInteger(k) || k < 0 ? -Infinity : (m as number) === 0 ? (k === 0 ? 0 : -Infinity) : k * Math.log(m as number) - (m as number) - lgamma(k + 1)),
  cdf: ([m], k) => (k < 0 ? 0 : (m as number) === 0 ? 1 : gammaPQ(Math.floor(k) + 1, m as number).q),
  cdfBelow: lattice(() => POISSON),
  sf: ([m], k) => (k < 0 ? 1 : (m as number) === 0 ? 0 : gammaPQ(Math.floor(k) + 1, m as number).p),
  quantile: (p, q) => discreteQuantile((k) => POISSON.cdf(p, k), q, 0, Infinity),
  quantileUpper: (p, q) => discreteQuantileUpper((k) => POISSON.sf(p, k), q, 0, Infinity),
  moments: ([m]) => {
    const l = m as number;
    const mode = l === 0 ? [0] : Number.isInteger(l) ? [l - 1, l] : [Math.floor(l)];
    return { mean: l, variance: l, ...(l > 0 ? { skewness: 1 / Math.sqrt(l), kurtosis: 1 / l } : {}), median: POISSON.quantile([l], 0.5), mode };
  },
  sample: ([m], u) => poissonDraw(m as number, u),
};

const BERNOULLI: DistSpec = {
  kind: 'Bernoulli', discrete: true, params: [prob('p')],
  support: () => ({ lo: 0, hi: 1 }),
  pdf: ([p], k) => (k === 1 ? (p as number) : k === 0 ? 1 - (p as number) : 0),
  cdf: ([p], k) => (k < 0 ? 0 : k < 1 ? 1 - (p as number) : 1),
  cdfBelow: lattice(() => BERNOULLI),
  sf: ([p], k) => (k < 0 ? 1 : k < 1 ? (p as number) : 0),
  quantile: ([p], q) => (q <= (1 - (p as number)) * (1 + 4 * Number.EPSILON) ? 0 : 1),
  moments: ([p]) => {
    const P = p as number;
    const v = P * (1 - P);
    return {
      mean: P, variance: v, ...(v > 0 ? { skewness: (1 - 2 * P) / Math.sqrt(v), kurtosis: (1 - 6 * v) / v } : {}),
      median: P <= 0.5 ? 0 : 1, mode: P < 0.5 ? [0] : P > 0.5 ? [1] : [0, 1],
    };
  },
};

const GEOMETRIC: DistSpec = {
  kind: 'Geometric', discrete: true, params: [prob('p', true)],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([p], k) => (!Number.isInteger(k) || k < 0 ? 0 : (p as number) * (1 - (p as number)) ** k),
  cdf: ([p], k) => (k < 0 ? 0 : -Math.expm1((Math.floor(k) + 1) * Math.log1p(-(p as number)))),
  cdfBelow: lattice(() => GEOMETRIC),
  sf: ([p], k) => (k < 0 ? 1 : (1 - (p as number)) ** (Math.floor(k) + 1)),
  quantile: (p, q) => discreteQuantile((k) => GEOMETRIC.cdf(p, k), q, 0, Infinity),
  quantileUpper: (p, q) => discreteQuantileUpper((k) => GEOMETRIC.sf(p, k), q, 0, Infinity),
  moments: ([p]) => {
    const P = p as number;
    const Q = 1 - P;
    return {
      mean: Q / P, variance: Q / (P * P), ...(Q > 0 ? { skewness: (2 - P) / Math.sqrt(Q), kurtosis: 6 + (P * P) / Q } : {}),
      median: GEOMETRIC.quantile([P], 0.5), mode: [0],
    };
  },
  sample: ([p], u) => ((p as number) >= 1 ? 0 : Math.floor(Math.log(u()) / Math.log1p(-(p as number)))),
};

const NEG_BINOMIAL: DistSpec = {
  kind: 'NegBinomial', discrete: true, params: [pos('r'), prob('p', true)],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([r, p], k) => {
    const R = r as number;
    const P = p as number;
    if (!Number.isInteger(k) || k < 0) return 0;
    if (P === 1) return k === 0 ? 1 : 0;
    return Math.exp(lgamma(k + R) - lgamma(k + 1) - lgamma(R) + R * Math.log(P) + k * Math.log1p(-P));
  },
  cdf: ([r, p], k) => (k < 0 ? 0 : (p as number) === 1 ? 1 : betaI(p as number, r as number, Math.floor(k) + 1)),
  cdfBelow: lattice(() => NEG_BINOMIAL),
  sf: ([r, p], k) => (k < 0 ? 1 : (p as number) === 1 ? 0 : betaI(1 - (p as number), Math.floor(k) + 1, r as number)),
  quantile: (p, q) => discreteQuantile((k) => NEG_BINOMIAL.cdf(p, k), q, 0, Infinity),
  quantileUpper: (p, q) => discreteQuantileUpper((k) => NEG_BINOMIAL.sf(p, k), q, 0, Infinity),
  moments: ([r, p]) => {
    const R = r as number;
    const P = p as number;
    const Q = 1 - P;
    return {
      mean: (R * Q) / P, variance: (R * Q) / (P * P),
      ...(Q > 0 ? { skewness: (2 - P) / Math.sqrt(R * Q), kurtosis: 6 / R + (P * P) / (R * Q) } : {}),
      median: NEG_BINOMIAL.quantile([R, P], 0.5), mode: [R > 1 ? Math.floor(((R - 1) * Q) / P) : 0],
    };
  },
  sample: ([r, p], u) => ((p as number) >= 1 ? 0 : poissonDraw((gammaDraw(r as number, u) * (1 - (p as number))) / (p as number), u)),
};

const hyperLo = (N: number, K: number, n: number): number => Math.max(0, n - (N - K));
const hyperHi = (K: number, n: number): number => Math.min(n, K);
const hyperLog = (N: number, K: number, n: number, k: number): number => lchoose(K, k) + lchoose(N - K, n - k) - lchoose(N, n);

/** Sums the pmf of the hypergeometric over [from, to]. */
function hyperSum(N: number, K: number, n: number, from: number, to: number): number {
  let s = 0;
  for (let k = from; k <= to; k++) s += Math.exp(hyperLog(N, K, n, k));
  return Math.min(1, s);
}

const HYPER_GEOMETRIC: DistSpec = {
  kind: 'HyperGeometric', discrete: true,
  params: [
    whole('N', 0),
    { name: 'K', ok: (v, all) => Number.isInteger(v) && v >= 0 && v <= (all[0] as number), rule: 'K is a whole number from 0 to N' },
    { name: 'n', ok: (v, all) => Number.isInteger(v) && v >= 0 && v <= (all[0] as number), rule: 'n is a whole number from 0 to N' },
  ],
  support: ([N, K, n]) => ({ lo: hyperLo(N as number, K as number, n as number), hi: hyperHi(K as number, n as number) }),
  pdf: ([N, K, n], k) => {
    if (!Number.isInteger(k) || k < hyperLo(N as number, K as number, n as number) || k > hyperHi(K as number, n as number)) return 0;
    return Math.exp(hyperLog(N as number, K as number, n as number, k));
  },
  cdf: ([N, K, n], x) => {
    const lo = hyperLo(N as number, K as number, n as number);
    const hi = hyperHi(K as number, n as number);
    const k = Math.floor(x);
    if (k < lo) return 0;
    if (k >= hi) return 1;
    // sum the shorter side
    return k - lo <= hi - k ? hyperSum(N as number, K as number, n as number, lo, k) : 1 - hyperSum(N as number, K as number, n as number, k + 1, hi);
  },
  cdfBelow: lattice(() => HYPER_GEOMETRIC),
  sf: ([N, K, n], x) => {
    const lo = hyperLo(N as number, K as number, n as number);
    const hi = hyperHi(K as number, n as number);
    const k = Math.floor(x);
    if (k < lo) return 1;
    if (k >= hi) return 0;
    return hi - k <= k - lo ? hyperSum(N as number, K as number, n as number, k + 1, hi) : 1 - hyperSum(N as number, K as number, n as number, lo, k);
  },
  quantile: (p, q) => discreteQuantile((k) => HYPER_GEOMETRIC.cdf(p, k), q, hyperLo(p[0] as number, p[1] as number, p[2] as number), hyperHi(p[1] as number, p[2] as number)),
  quantileUpper: (p, q) => discreteQuantileUpper((k) => HYPER_GEOMETRIC.sf(p, k), q, hyperLo(p[0] as number, p[1] as number, p[2] as number), hyperHi(p[1] as number, p[2] as number)),
  moments: ([N0, K0, n0]) => {
    const N = N0 as number;
    const K = K0 as number;
    const n = n0 as number;
    const mean = N > 0 ? (n * K) / N : 0;
    const variance = N > 1 ? (n * (K / N) * ((N - K) / N) * (N - n)) / (N - 1) : 0;
    const out: MutableMoments = { mean, variance, median: HYPER_GEOMETRIC.quantile([N, K, n], 0.5), mode: [Math.floor(((n + 1) * (K + 1)) / (N + 2))] };
    if (variance > 0 && N > 2) out.skewness = ((N - 2 * K) * Math.sqrt(N - 1) * (N - 2 * n)) / (Math.sqrt(n * K * (N - K) * (N - n)) * (N - 2));
    if (variance > 0 && N > 3) {
      out.kurtosis = ((N - 1) * N * N * (N * (N + 1) - 6 * K * (N - K) - 6 * n * (N - n)) + 6 * n * K * (N - K) * (N - n) * (5 * N - 6)) / (n * K * (N - K) * (N - n) * (N - 2) * (N - 3));
    }
    return out;
  },
};

/** The cumulative table of a Zipf distribution, kept for the last few parameter pairs. */
const zipfCache = new Map<string, Float64Array>();
function zipfTable(s: number, N: number): Float64Array {
  const key = `${s},${N}`;
  const hit = zipfCache.get(key);
  if (hit) return hit;
  const c = new Float64Array(N);
  let acc = 0;
  for (let k = 1; k <= N; k++) {
    acc += Math.pow(k, -s);
    c[k - 1] = acc;
  }
  for (let k = 0; k < N; k++) c[k] = (c[k] as number) / acc;
  if (zipfCache.size >= 8) zipfCache.delete(zipfCache.keys().next().value as string);
  zipfCache.set(key, c);
  return c;
}

const ZIPF: DistSpec = {
  kind: 'Zipf', discrete: true,
  params: [{ name: 's', ok: (v) => v >= 0 && Number.isFinite(v), rule: 's ≥ 0' }, { name: 'N', ok: (v) => Number.isInteger(v) && v >= 1 && v <= 1e6, rule: 'N is a whole number from 1 to 1,000,000' }],
  support: ([, N]) => ({ lo: 1, hi: N as number }),
  pdf: ([s, N], k) => {
    if (!Number.isInteger(k) || k < 1 || k > (N as number)) return 0;
    const c = zipfTable(s as number, N as number);
    return (c[k - 1] as number) - (k > 1 ? (c[k - 2] as number) : 0);
  },
  cdf: ([s, N], x) => {
    const k = Math.floor(x);
    if (k < 1) return 0;
    if (k >= (N as number)) return 1;
    return zipfTable(s as number, N as number)[k - 1] as number;
  },
  cdfBelow: lattice(() => ZIPF),
  sf: (p, x) => 1 - ZIPF.cdf(p, x),
  quantile: (p, q) => discreteQuantile((k) => ZIPF.cdf(p, k), q, 1, p[1] as number),
  moments: ([s, N]) => {
    const S = s as number;
    const n = N as number;
    const raw = [0, 0, 0, 0, 0];
    let h = 0;
    for (let k = 1; k <= n; k++) {
      const w = Math.pow(k, -S);
      h += w;
      for (let i = 1; i <= 4; i++) raw[i] = (raw[i] as number) + w * k ** i;
    }
    const r = raw.map((x) => x / h);
    const m = r[1] as number;
    const v = (r[2] as number) - m * m;
    const out: MutableMoments = { mean: m, variance: v, median: ZIPF.quantile([S, n], 0.5) };
    if (S > 0 || n === 1) out.mode = [1];
    if (v > 0) {
      const m3 = (r[3] as number) - 3 * m * (r[2] as number) + 2 * m ** 3;
      const m4 = (r[4] as number) - 4 * m * (r[3] as number) + 6 * m * m * (r[2] as number) - 3 * m ** 4;
      out.skewness = m3 / v ** 1.5;
      out.kurtosis = m4 / (v * v) - 3;
    }
    return out;
  },
};

const DISCRETE_UNIFORM: DistSpec = {
  kind: 'DiscreteUniform', discrete: true,
  params: [{ name: 'lo', ok: Number.isInteger, rule: 'lo is a whole number' }, { name: 'hi', ok: (v, all) => Number.isInteger(v) && v >= (all[0] as number), rule: 'hi is a whole number, at least lo' }],
  support: ([a, b]) => ({ lo: a as number, hi: b as number }),
  pdf: ([a, b], k) => (!Number.isInteger(k) || k < (a as number) || k > (b as number) ? 0 : 1 / ((b as number) - (a as number) + 1)),
  cdf: ([a, b], x) => Math.min(1, Math.max(0, (Math.floor(x) - (a as number) + 1) / ((b as number) - (a as number) + 1))),
  cdfBelow: lattice(() => DISCRETE_UNIFORM),
  sf: (p, x) => 1 - DISCRETE_UNIFORM.cdf(p, x),
  quantile: ([a, b], q) => (a as number) + Math.max(0, Math.ceil(q * ((b as number) - (a as number) + 1) * (1 - 4 * Number.EPSILON)) - 1),
  moments: ([a, b]) => {
    const A = a as number;
    const n = (b as number) - A + 1;
    return {
      mean: (A + (b as number)) / 2, variance: (n * n - 1) / 12, skewness: 0,
      ...(n > 1 ? { kurtosis: (-6 * (n * n + 1)) / (5 * (n * n - 1)) } : { mode: [A] }),
      median: DISCRETE_UNIFORM.quantile([A, b as number], 0.5),
    };
  },
  sample: ([a, b], u) => (a as number) + Math.floor(u() * ((b as number) - (a as number) + 1)),
};

/**
 * `Discrete(values, probs)`: a spec of its own, made for the values (design 3.3). Equal values are merged; the caller has
 * checked the probabilities and scaled them to sum to 1.
 */
export function discreteSpec(values: ArrayLike<number>, probs: ArrayLike<number>): DistSpec {
  const idx = Array.from({ length: values.length }, (_, i) => i).sort((i, j) => (values[i] as number) - (values[j] as number));
  const vs: number[] = [];
  const ps: number[] = [];
  for (const i of idx) {
    const v = values[i] as number;
    const w = probs[i] as number;
    if (vs.length > 0 && vs[vs.length - 1] === v) ps[ps.length - 1] = (ps[ps.length - 1] as number) + w;
    else {
      vs.push(v);
      ps.push(w);
    }
  }
  const V = Float64Array.from(vs);
  const P = Float64Array.from(ps);
  const n = V.length;
  const C = new Float64Array(n);
  const S = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += P[i] as number;
    C[i] = acc;
  }
  acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    S[i] = acc;
    acc += P[i] as number;
  }
  /** The number of values ≤ x, or < x when `strict`. */
  const count = (x: number, strict: boolean): number => {
    let a = 0;
    let b = n;
    while (a < b) {
      const m = (a + b) >> 1;
      const v = V[m] as number;
      if (strict ? v < x : v <= x) a = m + 1;
      else b = m;
    }
    return a;
  };
  const cum = (k: number): number => (k === 0 ? 0 : k === n ? 1 : (C[k - 1] as number));
  const spec: DistSpec = {
    kind: 'Discrete', discrete: true, params: [], atoms: { values: V, probs: P },
    support: () => ({ lo: V[0] as number, hi: V[n - 1] as number }),
    pdf: (_p, x) => {
      const k = count(x, false);
      return k > 0 && V[k - 1] === x ? (P[k - 1] as number) : 0;
    },
    cdf: (_p, x) => cum(count(x, false)),
    cdfBelow: (_p, x) => cum(count(x, true)),
    sf: (_p, x) => {
      const k = count(x, false);
      return k === 0 ? 1 : (S[k - 1] as number);
    },
    quantile: (_p, q) => {
      const target = q * (1 - 4 * Number.EPSILON);
      let a = 0;
      let b = n - 1;
      while (a < b) {
        const m = (a + b) >> 1;
        if ((C[m] as number) >= target) b = m;
        else a = m + 1;
      }
      return V[a] as number;
    },
    moments: () => {
      let m = 0;
      for (let i = 0; i < n; i++) m += (P[i] as number) * (V[i] as number);
      let m2 = 0;
      let m3 = 0;
      let m4 = 0;
      let top = 0;
      for (let i = 0; i < n; i++) {
        const d = (V[i] as number) - m;
        const w = P[i] as number;
        m2 += w * d * d;
        m3 += w * d * d * d;
        m4 += w * d * d * d * d;
        if (w > top) top = w;
      }
      const mode: number[] = [];
      for (let i = 0; i < n; i++) if ((P[i] as number) >= top * (1 - 1e-12)) mode.push(V[i] as number);
      return {
        mean: m, variance: m2, ...(m2 > 0 ? { skewness: m3 / m2 ** 1.5, kurtosis: m4 / (m2 * m2) - 3 } : {}),
        median: spec.quantile([], 0.5), ...(mode.length < n || n === 1 ? { mode } : {}),
      };
    },
  };
  return spec;
}

/** The distributions whose constructors take numbers; `Discrete(values, probs)` is made by `discreteSpec`. */
export const DISTRIBUTIONS: readonly DistSpec[] = [
  NORMAL, STUDENT_T, CHI_SQUARED, F_DIST, EXPONENTIAL, GAMMA, ERLANG, BETA, CAUCHY, WEIBULL, LOG_NORMAL, LOGISTIC, TRIANGULAR, UNIFORM,
  BINOMIAL, BERNOULLI, GEOMETRIC, NEG_BINOMIAL, POISSON, HYPER_GEOMETRIC, ZIPF, DISCRETE_UNIFORM,
];

export const specOf = (kind: string): DistSpec => DISTRIBUTIONS.find((d) => d.kind === kind) as DistSpec;

/** A distribution value; the caller has checked the parameters. */
export const dist = (kind: string, params: readonly number[]): DistributionValue => ({ kind: 'dist', spec: specOf(kind), params: params.slice() });

/** The type name of a distribution value. */
export const distType = (d: DistSpec): string => (d.discrete ? 'DiscreteDistribution' : 'ContinuousDistribution');

const fmt = (x: number): string => String(Number(x.toPrecision(6)));

/** "Normal(mu = 0, sigma = 1)" */
export function distText(d: DistributionValue): string {
  const a = d.spec.atoms;
  if (a) {
    const show = Math.min(a.values.length, 6);
    const pairs = Array.from({ length: show }, (_, i) => `${fmt(a.values[i] as number)}: ${fmt(a.probs[i] as number)}`);
    return `Discrete(${pairs.join(', ')}${a.values.length > show ? ', …' : ''})`;
  }
  const text = `${d.spec.kind}(${d.spec.params.map((p, i) => `${p.name} = ${fmt(d.params[i] as number)}`).join(', ')})`;
  if (d.spec.kind === 'NegBinomial') return `${text}, failures before the r-th success`;
  if (d.spec.kind === 'Geometric') return `${text}, failures before the first success`;
  return text;
}

/** True for a distribution whose plot window should be the central 98 % (design 4.2). */
export function heavyTailed(d: DistributionValue): boolean {
  const m = d.spec.moments(d.params);
  return m.variance === undefined || !Number.isFinite(m.variance) || (d.spec.kind === 'StudentT' && (d.params[0] as number) < 3);
}
