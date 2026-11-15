/**
 * Probability leftovers (docs/features/probability: design 5.2 and 6.2, errors.md 2 and 3): renamed commands, the
 * accurate range, large parameters, quantiles of HyperGeometric and Zipf, and a Kolmogorov–Smirnov check of every sampler.
 */
import { describe, expect, it } from 'vitest';
import { dist } from '@incantly/kernel';
import { bad, fig, num, nums, undef, val } from '../statistics/helpers';

const close = (a: number, b: number, tol: number): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1e-300, Math.abs(b)));
};

describe('renamed commands answer with the replacement (errors.md 2)', () => {
  it.each([
    ['v = RandomNormal(0, 1)', 'Sample(Normal(mu, sigma), n)'],
    ['v = InverseNormal(0, 1, 0.9)', 'Quantile(Normal(mu, sigma), p)'],
    ['v = NormalPdf(0, 1, 0.5)', 'Pdf(Normal(mu, sigma), x)'],
    ['v = Pascal(3, 0.5)', 'NegBinomial(r, p)'],
    ['v = BinomialDist(10, 0.5)', 'Binomial(n, p)'],
  ])('%s', (line, replacement) => {
    const e = bad(fig().apply(line), 'unknown_command');
    expect(e.hint).toContain(replacement);
    expect(e.forms?.length ?? 0).toBeGreaterThan(0);
  });
  it('RandomNormal also names Draw for one value', () => {
    expect(bad(fig().apply('v = RandomNormal(0, 1)'), 'unknown_command').hint).toContain('Draw(Normal(mu, sigma))');
  });
  it('an object of the same name is not a rename', () => {
    const e = bad(fig(['Pascal = 3']).apply('v = Pascal(3, 0.5)'), 'unknown_command');
    expect(e.hint).not.toContain('NegBinomial');
  });
});

describe('the accurate range (design 5.2, errors.md 3 not_accurate)', () => {
  it('a shape above 1e15 is not_accurate for evaluations', () => {
    expect(undef([], 'v = Cdf(Gamma(3e15, 1), 3e15)')).toBe('not_accurate');
    expect(undef([], 'v = Pdf(Binomial(1e16, 0.5), 5e15)')).toBe('not_accurate');
    expect(undef([], 'v = Quantile(ChiSquared(2e15), 0.5)')).toBe('not_accurate');
  });
  it('closed-form moments and NormalApprox stay defined there', () => {
    expect(num([], 'v = Mean(Gamma(3e15, 1))')).toBe(3e15);
    expect(num([], 'v = Mean(NormalApprox(Gamma(3e15, 1)))')).toBe(3e15);
  });
  it('a location or scale does not limit accuracy', () => {
    close(num([], 'v = Cdf(Normal(1e20, 1e18), 1e20)'), 0.5, 1e-12);
  });
});

describe('large parameters keep their digits (design 5.2 targets)', () => {
  it('Gamma(k, 1) at its mean, k up to 1e14', () => {
    for (const k of [1e3, 1e6, 1e10, 1e14]) {
      // P(k, k) = 1/2 + 1/(3 sqrt(2 pi k)) + O(1/k^(3/2))
      const want = 0.5 + 1 / (3 * Math.sqrt(2 * Math.PI * k));
      close(num([], `v = Cdf(Gamma(${k}, 1), ${k})`), want, 1e-7 + 1 / k);
    }
  });
  it('the Gamma density at its peak is e^(-1/12m) / sqrt(2 pi m), m = k - 1', () => {
    for (const k of [1e6, 1e10, 1e14]) {
      const m = k - 1;
      close(num([], `v = Pdf(Gamma(${k}, 1), ${m})`), Math.exp(-1 / (12 * m)) / Math.sqrt(2 * Math.PI * m), 1e-9);
    }
  });
  it('a symmetric Beta is 1/2 at 1/2', () => {
    for (const a of [1e4, 1e8, 1e12]) close(num([], `v = Cdf(Beta(${a}, ${a}), 0.5)`), 0.5, 1e-10);
  });
  it('Binomial(n, 10/n) tends to Poisson(10)', () => {
    const pois = num([], 'v = Cdf(Poisson(10), 8)');
    for (const n of [1e9, 1e12, 1e14]) close(num([], `v = Cdf(Binomial(${n}, ${10 / n}), 8)`), pois, 1e-7);
  });
  it('cdf and sf add to one for mixed shapes', () => {
    for (const [a, b] of [[1e7, 5], [1e9, 2], [1e12, 0.5]] as const) {
      const d = dist('Beta', [a, b]);
      const x = a / (a + b);
      close(d.spec.cdf(d.params, x) + d.spec.sf(d.params, x), 1, 1e-12);
    }
  });
  it('StudentT with a large df tends to the normal', () => {
    close(num([], 'v = Cdf(StudentT(1e9), 1)'), num([], 'v = Cdf(Normal(0, 1), 1)'), 1e-9);
  });
});

describe('discrete quantiles (design 5.2)', () => {
  const smallest = (cdf: (k: number) => number, q: number, lo: number, hi: number): number => {
    for (let k = lo; k <= hi; k++) if (cdf(k) >= q * (1 - 1e-12)) return k;
    return hi;
  };
  it('HyperGeometric walks from the mode to the same answer as a scan', () => {
    for (const [N, K, n] of [[50, 20, 10], [1000, 300, 200], [20, 20, 5], [100000, 5000, 3000]] as const) {
      const d = dist('HyperGeometric', [N, K, n]);
      const lo = Math.max(0, n - (N - K));
      const hi = Math.min(K, n);
      for (const q of [1e-9, 0.01, 0.1, 0.5, 0.623, 0.9, 0.999, 1 - 1e-9]) {
        expect(d.spec.quantile(d.params, q)).toBe(smallest((k) => d.spec.cdf(d.params, k), q, lo, hi));
      }
    }
  });
  it('HyperGeometric upper quantiles: the smallest k with sf(k) ≤ q', () => {
    const d = dist('HyperGeometric', [1000, 300, 200]);
    for (const q of [1e-6, 0.005, 0.05, 0.5, 0.95]) {
      const k = d.spec.quantileUpper?.(d.params, q) as number;
      expect(d.spec.sf(d.params, k)).toBeLessThanOrEqual(q * (1 + 1e-9));
      expect(d.spec.sf(d.params, k - 1)).toBeGreaterThan(q * (1 - 1e-9));
    }
  });
  it('Zipf searches its cumulative table', () => {
    for (const [s, N] of [[1, 10], [1.5, 1000], [0, 7]] as const) {
      const d = dist('Zipf', [s, N]);
      for (const q of [0.001, 0.2, 0.5, 0.8, 0.999999]) {
        expect(d.spec.quantile(d.params, q)).toBe(smallest((k) => d.spec.cdf(d.params, k), q, 1, N));
      }
    }
  });
});

describe('every sampler passes a Kolmogorov–Smirnov test (design 6.2)', () => {
  // n = 20,000 draws: D above sqrt(ln(2 / 1e-6) / 2n) ≈ 0.0190 has probability under 1e-6
  const n = 20000;
  const crit = Math.sqrt(Math.log(2 / 1e-6) / (2 * n));
  const ks = (expr: string, kind: string, params: number[]): number => {
    const xs = nums(val([], `xs = Sample(${expr}, ${n}, seed = 11)`)).sort((a, b) => a - b);
    const d = dist(kind, params);
    let D = 0;
    for (let i = 0; i < n; ) {
      const x = xs[i] as number;
      let j = i;
      while (j < n && xs[j] === x) j++;
      const F = d.spec.cdf(d.params, x);
      const below = d.spec.discrete ? d.spec.cdf(d.params, x - 1) : F;
      D = Math.max(D, Math.abs(j / n - F), Math.abs(i / n - below));
      i = j;
    }
    return D;
  };
  it.each([
    ['Normal(2, 3)', 'Normal', [2, 3]], ['StudentT(3)', 'StudentT', [3]], ['StudentT(0.7)', 'StudentT', [0.7]],
    ['ChiSquared(4)', 'ChiSquared', [4]], ['FDist(5, 10)', 'FDist', [5, 10]], ['Exponential(2)', 'Exponential', [2]],
    ['Gamma(0.3, 1)', 'Gamma', [0.3, 1]], ['Gamma(7, 2)', 'Gamma', [7, 2]], ['Erlang(3, 1)', 'Erlang', [3, 1]],
    ['Beta(0.5, 0.5)', 'Beta', [0.5, 0.5]], ['Beta(2, 5)', 'Beta', [2, 5]], ['Cauchy(0, 1)', 'Cauchy', [0, 1]],
    ['Weibull(1.5, 2)', 'Weibull', [1.5, 2]], ['LogNormal(0, 0.5)', 'LogNormal', [0, 0.5]], ['Logistic(1, 2)', 'Logistic', [1, 2]],
    ['Triangular(0, 1, 3)', 'Triangular', [0, 1, 3]], ['Uniform(-1, 4)', 'Uniform', [-1, 4]],
    ['Binomial(30, 0.3)', 'Binomial', [30, 0.3]], ['Binomial(1000, 0.6)', 'Binomial', [1000, 0.6]], ['Bernoulli(0.3)', 'Bernoulli', [0.3]],
    ['Geometric(0.2)', 'Geometric', [0.2]], ['NegBinomial(2.5, 0.4)', 'NegBinomial', [2.5, 0.4]], ['Poisson(3)', 'Poisson', [3]],
    ['Poisson(250)', 'Poisson', [250]], ['HyperGeometric(50, 20, 10)', 'HyperGeometric', [50, 20, 10]], ['Zipf(1.2, 50)', 'Zipf', [1.2, 50]],
    ['DiscreteUniform(1, 6)', 'DiscreteUniform', [1, 6]],
  ] as [string, string, number[]][])('%s', (expr, kind, params) => {
    expect(ks(expr, kind, params)).toBeLessThan(crit);
  });
});
