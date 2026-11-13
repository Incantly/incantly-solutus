/**
 * Statistics benchmarks against the targets of docs/features/statistics/design.md 7.3, 9 and 10.4 (Node, warm).
 *
 * Run: `npx vitest run --config packages/kernel/bench/vitest.config.ts`. Vitest 5 has no `bench` export and no bench
 * runner may be added, so each case is a test: 2 warm-up runs, then repeated runs until 50 ms have passed (5 to 200
 * runs); the number is the mean ms per run. A case fails when it misses its target. Rules are called directly, the way
 * the kernel calls them, so the numbers are the algorithms' cost without parsing.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { CHART_COMMANDS, DESCRIBE_COMMANDS, FIT_COMMANDS } from '../src/index';
import type { CommandSpec, RuleCall } from '../src/index';

/** Calls form `form` of a command with these argument values; returns the value or throws with the reason. */
function invoke(table: readonly CommandSpec[], name: string, form: number, values: readonly unknown[]): unknown {
  const spec = table.find((s) => s.name === name) as CommandSpec;
  const f = spec.forms[form];
  if (!f) throw new Error(`${name} has no form ${form}`);
  const vals = f.params.map((p, i) => (i < values.length ? values[i] : p.default));
  let why = '';
  const call = {
    values: vals,
    args: f.params.map((_, i) => ({ omitted: i >= values.length })),
    fail: (reason: string, detail?: string) => {
      why = `${reason}: ${detail ?? ''}`;
      return undefined;
    },
    notify: () => undefined,
    work: { spend: () => true },
  } as unknown as RuleCall;
  const rule = f.rule([]) as { run: (c: RuleCall) => unknown };
  const v = rule.run(call);
  if (v === undefined) throw new Error(`${name} is undefined (${why})`);
  return v;
}

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

/** Deterministic data: a hash of the position, scaled. */
function data(n: number, scale = 100): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.sin((i + 1) * 12.9898) * 43758.5453;
    out[i] = (s - Math.floor(s)) * scale;
  }
  return out;
}

function points(n: number, f: (x: number) => number): { x: number; y: number }[] {
  const noise = data(n, 1);
  return Array.from({ length: n }, (_, i) => {
    const x = (i / (n - 1)) * 10;
    return { x, y: f(x) * (1 + 0.05 * ((noise[i] as number) - 0.5)) };
  });
}

const results: [string, number, number][] = [];

function check(label: string, target: number, run: () => void): void {
  const ms = time(run);
  results.push([label, ms, target]);
  expect(ms, `${label}: ${ms.toFixed(2)} ms, target ${target} ms`).toBeLessThan(target);
}

describe('statistics speed targets', () => {
  const M = data(1_000_000);
  const HK = data(100_000);

  it('histogram of 1e6 values < 15 ms (design 10.4)', () => {
    const edges = Float64Array.from({ length: 21 }, (_, i) => i * 5);
    check('Histogram, 1e6 values, 20 classes', 15, () => invoke(CHART_COMMANDS, 'Histogram', 2, [edges, M]));
  });

  it('class edits recompute a histogram of 1e5 values in < 5 ms (design 9)', () => {
    let k = 10;
    check('Histogram, 1e5 values, changed bins', 5, () => invoke(CHART_COMMANDS, 'Histogram', 1, [HK, (k = (k % 40) + 5)]));
  });

  it('box plot of 1e6 values < 40 ms, sort included (design 10.4)', () => {
    check('BoxPlot, 1e6 values, fresh list each run', 40, () => invoke(CHART_COMMANDS, 'BoxPlot', 0, [0, 1, Float64Array.from(M)]));
  });

  it('median of 1e6 values < 25 ms on a fresh list (design 10.1)', () => {
    check('Median, 1e6 values, fresh list each run', 25, () => invoke(DESCRIBE_COMMANDS, 'Median', 0, [Float64Array.from(M)]));
  });

  it('mean and variance of 1e6 values', () => {
    check('Variance, 1e6 values', 15, () => invoke(DESCRIBE_COMMANDS, 'Variance', 0, [M]));
  });

  it('Levenberg–Marquardt: 1,000 points, 4 parameters < 5 ms; 10,000 < 40 ms (design 7.3)', () => {
    const p1k = points(1_000, (x) => 1 + 2 * Math.sin(1.3 * x + 0.5));
    const p10k = points(10_000, (x) => 1 + 2 * Math.sin(1.3 * x + 0.5));
    const model = { arity: 5, ret: 'Number', call: (x: number, a: number, b: number, c: number, d: number) => a + b * Math.sin(c * x + d) };
    check('FitModel sine, 1,000 points', 5, () => invoke(FIT_COMMANDS, 'FitModel', 0, [p1k, model, Float64Array.of(1.1, 1.9, 1.28, 0.45)]));
    check('FitModel sine, 10,000 points', 40, () => invoke(FIT_COMMANDS, 'FitModel', 0, [p10k, model, Float64Array.of(1.1, 1.9, 1.28, 0.45)]));
  });

  it('a model toggle re-runs one fit of 1,000 points in < 20 ms (design 9)', () => {
    const p1k = points(1_000, (x) => 3 * Math.exp(0.2 * x));
    check('FitExp, 1,000 points', 20, () => invoke(FIT_COMMANDS, 'FitExp', 0, [p1k]));
    check('FitPoly degree 3, 1,000 points', 20, () => invoke(FIT_COMMANDS, 'FitPoly', 0, [p1k, 3]));
    check('FitSin, 1,000 points (scan and refine)', 20, () => invoke(FIT_COMMANDS, 'FitSin', 0, [points(1_000, (x) => 1 + 2 * Math.sin(1.3 * x + 0.5))]));
  });

  it('prints the table', () => {
    const w = Math.max(...results.map((r) => r[0].length));
    const lines = results.map(([l, ms, t]) => `${l.padEnd(w)}  ${ms.toFixed(2).padStart(8)} ms  target ${String(t).padStart(3)} ms  ${ms < t ? 'ok' : 'MISSED'}`);
    process.stdout.write(`\n${lines.join('\n')}\n`);
    expect(results.length).toBeGreaterThan(0);
  });
});
