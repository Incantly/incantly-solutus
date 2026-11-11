/**
 * Plot benchmarks. Targets from the docs (mid-range laptop, Node, warm):
 * functions-calculus 9 (smooth < 0.3 ms, tan over 12 poles < 1.5 ms,
 * sin(1/x) < 5 ms, floor < 0.5 ms), curves-loci 5 (heart 0.3 ms, Lissajous
 * 0.8 ms, long spiral 1.5 ms), 6 (circle 2 ms, lemniscate 3 ms, many
 * components 15 ms, draft 4x cheaper) and 7 (half-plane 0.3 ms, disc
 * intersection 1.5 ms, transcendental band 8 ms).
 *
 * Plain script on purpose: this repo pins Vitest 5, which has no `bench`
 * export, and no bench runner may be added. Run it with any TS runner, e.g.
 * `npx tsx packages/plot/bench/plot.bench.ts`. Method: 2 warmup runs, then
 * repeated runs until at least 25 ms total (at least 5 runs, at most 500);
 * the reported number is the mean ms per run. One extra run supplies the
 * stats columns. Exit code is 1 when a case errors or misses its target.
 */
import { performance } from 'node:perf_hooks';
import type { FunctionValue, RelationValue, Result } from '@incantly/kernel';
import { fillRegion, plotFunction, traceImplicit, traceParamCurve } from '../src/index';
import type { PlotStats, ViewBox } from '../src/index';

const view: ViewBox = { x0: -5, x1: 5, y0: -3, y1: 3, widthPx: 1000, heightPx: 600 };

const scalar = (f: (x: number) => number): FunctionValue => ({
  arity: 1,
  ret: 'Number',
  call: (x: number) => f(x),
  call1: (x: number) => f(x),
  batch: (xs: Float64Array, out: Float64Array): void => {
    for (let i = 0; i < xs.length; i++) out[i] = f(xs[i] as number);
  },
});

const point = (f: (s: number) => { x: number; y: number } | undefined): FunctionValue => ({
  arity: 1,
  ret: 'Point',
  call: (s: number) => f(s),
});

const relation = (
  residual: (x: number, y: number) => number,
  test: (x: number, y: number) => boolean | undefined,
  op: string,
): RelationValue => ({
  ops: [op],
  residual,
  test,
});

interface HasStats {
  readonly stats: PlotStats;
}

interface BenchCase {
  readonly name: string;
  readonly targetMs: number;
  readonly run: () => Result<HasStats>;
}

const cases: readonly BenchCase[] = [
  {
    name: 'function: smooth sin(x)+x^2/10',
    targetMs: 0.3,
    run: () => plotFunction(scalar((x) => Math.sin(x) + (x * x) / 10), view),
  },
  {
    name: 'function: tan(x) over 12 poles',
    targetMs: 1.5,
    run: () => plotFunction(scalar((x) => Math.tan(x)), { ...view, x0: -19, x1: 19 }),
  },
  {
    name: 'function: sin(1/x)',
    targetMs: 5,
    run: () => plotFunction(scalar((x) => (x === 0 ? Number.NaN : Math.sin(1 / x))), view),
  },
  {
    name: 'function: floor(x)',
    targetMs: 0.5,
    run: () => plotFunction(scalar((x) => Math.floor(x)), view, { breaks: [-4, -3, -2, -1, 0, 1, 2, 3, 4] }),
  },
  {
    name: 'param: heart',
    targetMs: 0.3,
    run: () =>
      traceParamCurve(
        {
          fn: point((s) => ({
            x: 16 * Math.sin(s) ** 3,
            y: 13 * Math.cos(s) - 5 * Math.cos(2 * s) - 2 * Math.cos(3 * s) - Math.cos(4 * s),
          })),
          lo: 0,
          hi: Math.PI * 2,
        },
        { x0: -18, x1: 18, y0: -18, y1: 14, widthPx: 1000, heightPx: 700 },
      ),
  },
  {
    name: 'param: Lissajous 6 loops',
    targetMs: 0.8,
    run: () => traceParamCurve({ fn: point((s) => ({ x: Math.sin(6 * s), y: Math.sin(7 * s) })), lo: 0, hi: Math.PI * 2 }, view),
  },
  {
    name: 'param: spiral s in 0..1000',
    targetMs: 1.5,
    run: () =>
      traceParamCurve(
        { fn: point((s) => ({ x: (s / 100) * Math.cos(s), y: (s / 100) * Math.sin(s) })), lo: 0, hi: 1000 },
        { x0: -11, x1: 11, y0: -11, y1: 11, widthPx: 1000, heightPx: 700 },
      ),
  },
  {
    name: 'implicit: unit circle',
    targetMs: 2,
    run: () => traceImplicit({ residual: (x, y) => x * x + y * y - 1 }, view),
  },
  {
    name: 'implicit: lemniscate',
    targetMs: 3,
    run: () => traceImplicit({ residual: (x, y) => (x * x + y * y) ** 2 - (x * x - y * y) }, view),
  },
  {
    name: 'implicit: sin(x)+sin(y)==sin(x*y)',
    targetMs: 15,
    run: () => traceImplicit({ residual: (x, y) => Math.sin(x) + Math.sin(y) - Math.sin(x * y) }, view),
  },
  {
    name: 'implicit: unit circle (draft)',
    targetMs: 0.5,
    run: () => traceImplicit({ residual: (x, y) => x * x + y * y - 1 }, view, { quality: 'draft' }),
  },
  {
    name: 'region: half-plane',
    targetMs: 0.3,
    run: () => {
      const rel = relation(
        (x, y) => y - x,
        (x, y) => y > x,
        '>',
      );
      return fillRegion({ test: rel.test, boundaries: [{ residual: rel.residual, strict: true }] }, view);
    },
  },
  {
    name: 'region: disc and half-plane',
    targetMs: 1.5,
    run: () =>
      fillRegion(
        {
          test: (x, y) => x * x + y * y <= 4 && y > x,
          boundaries: [
            { residual: (x, y) => 4 - x * x - y * y, strict: false },
            { residual: (x, y) => y - x, strict: true },
          ],
        },
        view,
      ),
  },
  {
    name: 'region: sin(x)*y>1 band',
    targetMs: 8,
    run: () =>
      fillRegion(
        {
          test: (x, y) => Math.sin(x) * y > 1,
          boundaries: [{ residual: (x, y) => Math.sin(x) * y - 1, strict: true }],
        },
        view,
      ),
  },
];

function timeMeanMs(fn: () => unknown): { ms: number; iters: number } {
  fn();
  fn();
  let iters = 0;
  let total = 0;
  while (iters < 5 || (total < 25 && iters < 500)) {
    const t0 = performance.now();
    fn();
    total += performance.now() - t0;
    iters += 1;
  }
  return { ms: total / iters, iters };
}

function describe(result: Result<HasStats>): string {
  if (!result.ok) return `ERROR ${JSON.stringify(result)}`;
  const s = result.value.stats;
  return `evals=${s.evals} interval=${s.intervalEvals} samples=${s.samples} complete=${String(s.complete)} rigorous=${String(s.rigorous)} capped=${String(s.capped)}`;
}

let failed = 0;
console.log(`plot bench (${process.version}, ${process.platform} ${process.arch}): mean ms/run after 2 warmup runs`);
for (const c of cases) {
  const timed = timeMeanMs(c.run);
  const probe = c.run();
  const pass = probe.ok && timed.ms <= c.targetMs;
  if (!pass) failed += 1;
  console.log(
    `${c.name.padEnd(36)} ${timed.ms.toFixed(3).padStart(8)} ms (n=${timed.iters}, target <${c.targetMs} ms) ${pass ? 'PASS' : 'FAIL'} ${describe(probe)}`,
  );
}
if (failed > 0) {
  console.log(`${failed} case(s) missed their target or errored`);
  process.exitCode = 1;
} else {
  console.log('all cases within target');
}
