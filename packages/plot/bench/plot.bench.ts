/**
 * Plot benchmarks. Targets from the docs (mid-range laptop, Node, warm):
 * functions-calculus 9 (smooth < 0.3 ms, tan over 12 poles < 1.5 ms,
 * sin(1/x) < 5 ms, floor < 0.5 ms), curves-loci 5 (heart 0.3 ms, Lissajous
 * 0.8 ms, long spiral 1.5 ms), 6 (circle 2 ms, lemniscate 3 ms, many
 * components 15 ms, draft 4x cheaper) and 7 (half-plane 0.3 ms, disc
 * intersection 1.5 ms, transcendental band 8 ms). Run with `npm run bench`.
 */
import { bench } from 'vitest';
import type { FunctionValue, RelationValue } from '@incantly/kernel';
import { fillRegion, plotFunction, traceImplicit, traceParamCurve } from '../src/index';
import type { ViewBox } from '../src/index';

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

const relation = (residual: (x: number, y: number) => number, test: (x: number, y: number) => boolean | undefined, op: string): RelationValue => ({
  ops: [op],
  residual,
  test,
});

bench('function: smooth sin(x)+x^2/10', () => {
  plotFunction(scalar((x) => Math.sin(x) + (x * x) / 10), view);
});

bench('function: tan(x) over 12 poles', () => {
  plotFunction(scalar((x) => Math.tan(x)), { ...view, x0: -19, x1: 19 });
});

bench('function: sin(1/x)', () => {
  plotFunction(scalar((x) => (x === 0 ? Number.NaN : Math.sin(1 / x))), view);
});

bench('function: floor(x)', () => {
  plotFunction(scalar((x) => Math.floor(x)), view, { breaks: [-4, -3, -2, -1, 0, 1, 2, 3, 4] });
});

bench('param: heart', () => {
  traceParamCurve(
    {
      fn: point((s) => ({ x: 16 * Math.sin(s) ** 3, y: 13 * Math.cos(s) - 5 * Math.cos(2 * s) - 2 * Math.cos(3 * s) - Math.cos(4 * s) })),
      lo: 0,
      hi: Math.PI * 2,
    },
    { x0: -18, x1: 18, y0: -18, y1: 14, widthPx: 1000, heightPx: 700 },
  );
});

bench('param: Lissajous 6 loops', () => {
  traceParamCurve({ fn: point((s) => ({ x: Math.sin(6 * s), y: Math.sin(7 * s) })), lo: 0, hi: Math.PI * 2 }, view);
});

bench('implicit: unit circle', () => {
  traceImplicit({ residual: (x, y) => x * x + y * y - 1 }, view);
});

bench('implicit: lemniscate', () => {
  traceImplicit({ residual: (x, y) => (x * x + y * y) ** 2 - (x * x - y * y) }, view);
});

bench('implicit: sin(x)+sin(y)==sin(x*y)', () => {
  traceImplicit({ residual: (x, y) => Math.sin(x) + Math.sin(y) - Math.sin(x * y) }, view);
});

bench('region: half-plane', () => {
  const rel = relation(
    (x, y) => y - x,
    (x, y) => y > x,
    '>',
  );
  fillRegion({ test: rel.test, boundaries: [{ residual: rel.residual, strict: true }] }, view);
});

bench('region: disc and half-plane', () => {
  fillRegion(
    {
      test: (x, y) => x * x + y * y <= 4 && y > x,
      boundaries: [
        { residual: (x, y) => 4 - x * x - y * y, strict: false },
        { residual: (x, y) => y - x, strict: true },
      ],
    },
    view,
  );
});
