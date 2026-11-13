/**
 * Probability benchmarks against the targets of docs/features/probability/design.md 5.2 and 6.4 (Node, warm).
 *
 * Run: `npx vitest run --config packages/kernel/bench/vitest.config.ts`. Each case is a test: 2 warm-up runs, then
 * repeated runs until 50 ms have passed (5 to 200 runs); the number is the mean ms per run. A case fails when it misses
 * its target.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { dist } from '../src/commands/probability/dists';
import type { DistributionValue } from '../src/commands/probability/dists';
import { keyOf, streamFor } from '../src/commands/probability/random';

function time(run: () => void): number {
  run();
  run();
  let n = 0;
  const t0 = performance.now();
  let t = t0;
  while ((t - t0 < 50 || n < 5) && n < 200) {
    run();
    n++;
    t = performance.now();
  }
  return (t - t0) / n;
}

const key = keyOf({ seed: 1, owner: 'xs', site: 5, count: 0, reroll: 0 }, 0);

function draws(d: DistributionValue, n: number): Float64Array {
  const out = new Float64Array(n);
  const s = d.spec.sample;
  for (let i = 0; i < n; i++) {
    const u = streamFor(key, i);
    out[i] = s ? s(d.params, u) : d.spec.quantile(d.params, u());
  }
  return out;
}

const report = (name: string, ms: number, target: number): void => {
  process.stdout.write(`${name}: ${ms.toFixed(3)} ms (target ${target} ms)\n`);
  expect(ms).toBeLessThan(target);
};

describe('sampling (design 6.4)', () => {
  it('1e6 normal draws under 150 ms', () => report('normal 1e6', time(() => draws(dist('Normal', [0, 1]), 1e6)), 150));
  it('1e6 gamma draws under 250 ms', () => report('gamma 1e6', time(() => draws(dist('Gamma', [2.5, 1]), 1e6)), 250));
  it('1e6 Binomial(100, 0.3) draws under 200 ms', () => report('binomial 1e6', time(() => draws(dist('Binomial', [100, 0.3]), 1e6)), 200));
});

describe('evaluation (design 5.2)', () => {
  it('2,000 density points under 0.5 ms', () => {
    const d = dist('Normal', [0, 1]);
    const out = new Float64Array(2000);
    report('pdf batch 2000', time(() => {
      for (let i = 0; i < 2000; i++) out[i] = d.spec.pdf(d.params, -4 + i * 0.004);
    }), 0.5);
  });
  it('gamma cdf under 2 µs, quantile under 50 µs', () => {
    const d = dist('Gamma', [3.7, 1.3]);
    const n = 10_000;
    const cdf = time(() => {
      for (let i = 0; i < n; i++) d.spec.cdf(d.params, 0.01 + i * 0.001);
    }) / n;
    report('gamma cdf (per call)', cdf, 0.002);
    const q = time(() => {
      for (let i = 1; i < 1000; i++) d.spec.quantile(d.params, i / 1000);
    }) / 999;
    report('gamma quantile (per call)', q, 0.05);
  });
  it('a PdfTable of 10,000 rows under 15 ms', () => {
    const d = dist('Poisson', [5000]);
    report('pdf table 10,000 rows', time(() => {
      let c = d.spec.cdf(d.params, 4000 - 1);
      for (let k = 4000; k < 14000; k++) {
        const m = d.spec.pdf(d.params, k);
        c += m;
      }
      if (c < 0) throw new Error('impossible');
    }), 15);
  });
});
