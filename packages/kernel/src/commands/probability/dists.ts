/**
 * The distribution table (docs/features/probability/design.md 3.2): one entry per distribution with its parameters,
 * support, density or mass, cdf, survival function, quantile and moments. Adding a distribution is one entry.
 *
 * No DOM, no timers, no Date.
 */
import {
  betaI, chiSqQuantile, gammaPQ, lgamma, normalCdf, normalQuantile, normalSf, tCdf, tQuantile, tSf,
} from '../statistics/dist';

declare module '../../contracts/values' {
  interface AreaTypeNames {
    // probability
    Distribution: true;
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
}

export interface DistSpec {
  readonly kind: string;
  readonly discrete: boolean;
  readonly params: readonly ParamDef[];
  readonly support: (p: readonly number[]) => { lo: number; hi: number };
  /** Density, or mass for a discrete distribution. */
  readonly pdf: (p: readonly number[], x: number) => number;
  /** P(X ≤ x). */
  readonly cdf: (p: readonly number[], x: number) => number;
  /** P(X > x), accurate in the upper tail. */
  readonly sf: (p: readonly number[], x: number) => number;
  /** The smallest x with cdf(x) ≥ q. */
  readonly quantile: (p: readonly number[], q: number) => number;
  readonly moments: (p: readonly number[]) => Moments;
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

/** Inverts an increasing cdf on a bracket by bisection. */
function invert(cdf: (x: number) => number, q: number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 400 && cdf(b) < q; i++) b = b <= 0 ? 1 : b * 2;
  for (let i = 0; i < 400 && cdf(a) > q; i++) a = a >= 0 ? -1 : a * 2;
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (m === a || m === b) break;
    if (cdf(m) < q) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** The smallest whole k in [lo, hi] with cdf(k) ≥ q, by bisection on the monotone cdf. */
function discreteQuantile(cdf: (k: number) => number, q: number, lo: number, hi: number): number {
  if (q <= 0) return lo;
  let a = lo;
  let b = hi;
  if (!Number.isFinite(b)) {
    b = Math.max(1, lo);
    while (cdf(b) < q && b < 1e15) b *= 2;
  }
  // allow for rounding in the cdf
  const target = q * (1 - 1e-12);
  while (a < b) {
    const m = Math.floor((a + b) / 2);
    if (cdf(m) >= target) b = m;
    else a = m + 1;
  }
  return a;
}

const lchoose = (n: number, k: number): number => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);

const NORMAL: DistSpec = {
  kind: 'Normal', discrete: false, params: [real('mu'), pos('sigma')],
  support: () => ({ lo: -Infinity, hi: Infinity }),
  pdf: ([m, s], x) => Math.exp(-0.5 * ((x - (m as number)) / (s as number)) ** 2) / ((s as number) * Math.sqrt(2 * Math.PI)),
  cdf: ([m, s], x) => normalCdf((x - (m as number)) / (s as number)),
  sf: ([m, s], x) => normalSf((x - (m as number)) / (s as number)),
  quantile: ([m, s], q) => (m as number) + (s as number) * normalQuantile(q),
  moments: ([m, s]) => ({ mean: m as number, variance: (s as number) ** 2 }),
};

const STUDENT_T: DistSpec = {
  kind: 'StudentT', discrete: false, params: [pos('df')],
  support: () => ({ lo: -Infinity, hi: Infinity }),
  pdf: ([v], x) => {
    const n = v as number;
    return Math.exp(lgamma((n + 1) / 2) - lgamma(n / 2) - 0.5 * Math.log(n * Math.PI) - ((n + 1) / 2) * Math.log1p((x * x) / n));
  },
  cdf: ([v], x) => tCdf(x, v as number),
  sf: ([v], x) => tSf(x, v as number),
  quantile: ([v], q) => tQuantile(q, v as number),
  moments: ([v]) => {
    const n = v as number;
    return { ...(n > 1 ? { mean: 0 } : {}), ...(n > 2 ? { variance: n / (n - 2) } : n > 1 ? { variance: Infinity } : {}) };
  },
};

const chiPdf = (k: number, x: number): number => (x < 0 ? 0 : x === 0 ? (k === 2 ? 0.5 : k < 2 ? Infinity : 0) : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.LN2 - lgamma(k / 2)));

const CHI_SQUARED: DistSpec = {
  kind: 'ChiSquared', discrete: false, params: [pos('df')],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([k], x) => chiPdf(k as number, x),
  cdf: ([k], x) => (x <= 0 ? 0 : gammaPQ((k as number) / 2, x / 2).p),
  sf: ([k], x) => (x <= 0 ? 1 : gammaPQ((k as number) / 2, x / 2).q),
  quantile: ([k], q) => chiSqQuantile(q, k as number),
  moments: ([k]) => ({ mean: k as number, variance: 2 * (k as number) }),
};

const F_DIST: DistSpec = {
  kind: 'FDist', discrete: false, params: [pos('d1'), pos('d2')],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([a, b], x) => {
    const d1 = a as number;
    const d2 = b as number;
    if (x <= 0) return 0;
    const lb = lgamma(d1 / 2) + lgamma(d2 / 2) - lgamma((d1 + d2) / 2);
    return Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - lb);
  },
  cdf: ([a, b], x) => (x <= 0 ? 0 : betaI(((a as number) * x) / ((a as number) * x + (b as number)), (a as number) / 2, (b as number) / 2)),
  sf: ([a, b], x) => (x <= 0 ? 1 : betaI((b as number) / ((b as number) + (a as number) * x), (b as number) / 2, (a as number) / 2)),
  quantile: (p, q) => invert((x) => F_DIST.cdf(p, x), q, 0, 10),
  moments: ([a, b]) => {
    const d1 = a as number;
    const d2 = b as number;
    return { ...(d2 > 2 ? { mean: d2 / (d2 - 2) } : {}), ...(d2 > 4 ? { variance: (2 * d2 * d2 * (d1 + d2 - 2)) / (d1 * (d2 - 2) ** 2 * (d2 - 4)) } : {}) };
  },
};

const EXPONENTIAL: DistSpec = {
  kind: 'Exponential', discrete: false, params: [pos('rate')],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([r], x) => (x < 0 ? 0 : (r as number) * Math.exp(-(r as number) * x)),
  cdf: ([r], x) => (x <= 0 ? 0 : -Math.expm1(-(r as number) * x)),
  sf: ([r], x) => (x <= 0 ? 1 : Math.exp(-(r as number) * x)),
  quantile: ([r], q) => -Math.log1p(-q) / (r as number),
  moments: ([r]) => ({ mean: 1 / (r as number), variance: 1 / (r as number) ** 2 }),
};

const UNIFORM: DistSpec = {
  kind: 'Uniform', discrete: false,
  params: [real('min'), { name: 'max', ok: (v, all) => Number.isFinite(v) && v > (all[0] as number), rule: 'max > min' }],
  support: ([a, b]) => ({ lo: a as number, hi: b as number }),
  pdf: ([a, b], x) => (x < (a as number) || x > (b as number) ? 0 : 1 / ((b as number) - (a as number))),
  cdf: ([a, b], x) => Math.min(1, Math.max(0, (x - (a as number)) / ((b as number) - (a as number)))),
  sf: ([a, b], x) => Math.min(1, Math.max(0, ((b as number) - x) / ((b as number) - (a as number)))),
  quantile: ([a, b], q) => (a as number) + q * ((b as number) - (a as number)),
  moments: ([a, b]) => ({ mean: ((a as number) + (b as number)) / 2, variance: ((b as number) - (a as number)) ** 2 / 12 }),
};

const binomCdf = (n: number, p: number, k: number): number => {
  if (k < 0) return 0;
  if (k >= n) return 1;
  const j = Math.floor(k);
  return betaI(1 - p, n - j, j + 1);
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
  sf: (p, k) => 1 - BINOMIAL.cdf(p, k),
  quantile: (p, q) => discreteQuantile((k) => BINOMIAL.cdf(p, k), q, 0, p[0] as number),
  moments: ([n, p]) => ({ mean: (n as number) * (p as number), variance: (n as number) * (p as number) * (1 - (p as number)) }),
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
  cdf: ([m], k) => (k < 0 ? 0 : (m as number) === 0 ? 1 : gammaPQ(Math.floor(k) + 1, m as number).q),
  sf: ([m], k) => (k < 0 ? 1 : (m as number) === 0 ? 0 : gammaPQ(Math.floor(k) + 1, m as number).p),
  quantile: (p, q) => discreteQuantile((k) => POISSON.cdf(p, k), q, 0, Infinity),
  moments: ([m]) => ({ mean: m as number, variance: m as number }),
};

const BERNOULLI: DistSpec = {
  kind: 'Bernoulli', discrete: true, params: [prob('p')],
  support: () => ({ lo: 0, hi: 1 }),
  pdf: ([p], k) => (k === 1 ? (p as number) : k === 0 ? 1 - (p as number) : 0),
  cdf: ([p], k) => (k < 0 ? 0 : k < 1 ? 1 - (p as number) : 1),
  sf: ([p], k) => (k < 0 ? 1 : k < 1 ? (p as number) : 0),
  quantile: ([p], q) => (q <= 1 - (p as number) ? 0 : 1),
  moments: ([p]) => ({ mean: p as number, variance: (p as number) * (1 - (p as number)) }),
};

const GEOMETRIC: DistSpec = {
  kind: 'Geometric', discrete: true, params: [prob('p', true)],
  support: () => ({ lo: 0, hi: Infinity }),
  pdf: ([p], k) => (!Number.isInteger(k) || k < 0 ? 0 : (p as number) * (1 - (p as number)) ** k),
  cdf: ([p], k) => (k < 0 ? 0 : -Math.expm1((Math.floor(k) + 1) * Math.log1p(-(p as number)))),
  sf: ([p], k) => (k < 0 ? 1 : (1 - (p as number)) ** (Math.floor(k) + 1)),
  quantile: (p, q) => discreteQuantile((k) => GEOMETRIC.cdf(p, k), q, 0, Infinity),
  moments: ([p]) => ({ mean: (1 - (p as number)) / (p as number), variance: (1 - (p as number)) / (p as number) ** 2 }),
};

/** The distributions built so far; the probability area adds the rest of design 3.3 as entries. */
export const DISTRIBUTIONS: readonly DistSpec[] = [NORMAL, STUDENT_T, CHI_SQUARED, F_DIST, EXPONENTIAL, UNIFORM, BINOMIAL, POISSON, BERNOULLI, GEOMETRIC];

export const specOf = (kind: string): DistSpec => DISTRIBUTIONS.find((d) => d.kind === kind) as DistSpec;

/** A distribution value; the caller has checked the parameters. */
export const dist = (kind: string, params: readonly number[]): DistributionValue => ({ kind: 'dist', spec: specOf(kind), params: params.slice() });

/** "Normal(mu = 0, sigma = 1)" */
export function distText(d: DistributionValue): string {
  const fmt = (x: number): string => String(Number(x.toPrecision(6)));
  return `${d.spec.kind}(${d.spec.params.map((p, i) => `${p.name} = ${fmt(d.params[i] as number)}`).join(', ')})`;
}
