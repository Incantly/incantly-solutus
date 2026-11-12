/**
 * Regression round: one or more tests per checker finding PLOT-SM-1 to PLOT-SM-16.
 *
 * Source of truth: `handoff/plot/findings.md` (each finding's observed behaviour and
 * its broken invariant; the code references there were not followed), the docs, the
 * public entry `@incantly/plot` and `packages/plot/src/contracts.ts`. Nothing under
 * `packages/plot/src/` other than those two files was read.
 *
 * Every test is written to FAIL on the defect and PASS once it is fixed. Slow cases use
 * small inputs plus an explicit wall-clock ceiling measured after the call (a
 * synchronous hang cannot be interrupted by the runner, so the inputs are sized so the
 * defective code still returns within a few seconds) and a vitest timeout as a backstop.
 *
 * Forged inputs (`fnOf`) follow the findings' own repros: `{ arity: 1, ret: 'Number',
 * call, call1, batch }`. Enclosures are the sound doubles from `./helpers`, or small
 * sound ones defined below.
 */
import { describe, expect, it } from 'vitest';
import {
  createSampleCache,
  fieldFromRelation,
  fillRegion,
  plotFunction,
  predicateFromRelation,
  resumeFunctionPlot,
  traceImplicit,
  traceParamCurve,
} from '@incantly/plot';
import type {
  FunctionPlot,
  FunctionPlotOptions,
  FunctionResume,
  ParamEnclosure,
  PlotMarker,
  RegionPlot,
  ResumeFunctionOptions,
  ScalarEnclosure,
  ViewBox,
} from '@incantly/plot';
import type { FunctionValue, Result } from '@incantly/kernel';
import {
  TIMEOUT,
  VIEW,
  circleFieldEnc,
  discTri,
  expectErr,
  expectOk,
  halfTri,
  holeEnc,
  invEnc,
  maxSegPx,
  pointFn,
  rel2,
  sinEnc,
  sqrtEnc,
  xOfPx,
  yOfPy,
} from './helpers';

/* ------------------------------ shared helpers ------------------------------ */

/** A forged one-variable function, shaped like the findings' repros. */
const fnOf = (f: (x: number) => number): FunctionValue =>
  ({
    arity: 1,
    ret: 'Number',
    call: f,
    call1: f,
    batch: (xs: Float64Array, out: Float64Array): void => {
      for (let i = 0; i < xs.length; i += 1) out[i] = f(xs[i] ?? 0);
    },
  }) as unknown as FunctionValue;

/** A forged function that also records every x it is asked for. */
const recordingFn = (f: (x: number) => number): { readonly fn: FunctionValue; readonly xs: number[] } => {
  const xs: number[] = [];
  const fn = {
    arity: 1,
    ret: 'Number',
    call: (x: number): number => {
      xs.push(x);
      return f(x);
    },
    call1: (x: number): number => {
      xs.push(x);
      return f(x);
    },
    batch: (a: Float64Array, out: Float64Array): void => {
      for (let i = 0; i < a.length; i += 1) {
        xs.push(a[i] ?? 0);
        out[i] = f(a[i] ?? 0);
      }
    },
  } as unknown as FunctionValue;
  return { fn, xs };
};

const V: ViewBox = VIEW; // x, y in [-5, 5], 800 x 600 px.
const sqView = (n: number): ViewBox => ({ x0: -5, x1: 5, y0: -5, y1: 5, widthPx: n, heightPx: n });
const BENCH_VIEW: ViewBox = { x0: -5, x1: 5, y0: -3, y1: 3, widthPx: 1000, heightPx: 600 };

/** Wall-clock milliseconds of one run (measured after the call returns). */
const timeIt = <T>(run: () => T): { readonly value: T; readonly ms: number } => {
  const t0 = performance.now();
  const value = run();
  return { value, ms: performance.now() - t0 };
};

/** Best (smallest) wall-clock time of `n` runs, which resists scheduler noise. */
const bestMs = (n: number, run: () => unknown): number => {
  let best = Infinity;
  for (let i = 0; i < n; i += 1) best = Math.min(best, timeIt(run).ms);
  return best;
};

const countKinds = (ms: readonly PlotMarker[], kinds: readonly string[]): number =>
  ms.filter((m) => kinds.includes(m.kind)).length;

const samePath = (a: Float64Array | undefined, b: Float64Array | undefined): boolean => {
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
};

/** Same geometry: paths, markers and ink columns identical. */
const expectSamePlot = (got: FunctionPlot, want: FunctionPlot): void => {
  expect(got.paths.length).toBe(want.paths.length);
  for (let i = 0; i < want.paths.length; i += 1) {
    expect(samePath(got.paths[i], want.paths[i]), `path ${i}`).toBe(true);
  }
  expect(got.markers).toEqual(want.markers);
  expect(got.inkColumns).toEqual(want.inkColumns);
};

const hash = (x: number): number => {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

const tokenOf = (p: FunctionPlot): FunctionResume => {
  if (p.resume === undefined) throw new Error('expected a resume token');
  return p.resume;
};

/** Total output points of a region plot: rectangle corners, polygon and border vertices. */
const emittedPoints = (p: RegionPlot): number =>
  p.rects.length +
  p.polygons.reduce((a, q) => a + q.length / 2, 0) +
  p.borders.reduce((a, b) => a + b.path.length / 2, 0);

const rectsArea = (rects: Float64Array): number => {
  let a = 0;
  for (let i = 0; i + 3 < rects.length; i += 4) {
    a += Math.abs((rects[i + 2] ?? 0) - (rects[i] ?? 0)) * Math.abs((rects[i + 3] ?? 0) - (rects[i + 1] ?? 0));
  }
  return a;
};

/** Share of sampled filled pixels (3 px grid inside rectangles) where `test` is not true. */
const falseFillShare = (rects: Float64Array, v: ViewBox, test: (x: number, y: number) => boolean): number => {
  let total = 0;
  let bad = 0;
  for (let i = 0; i + 3 < rects.length; i += 4) {
    const x0 = rects[i] ?? 0;
    const y0 = rects[i + 1] ?? 0;
    const x1 = rects[i + 2] ?? 0;
    const y1 = rects[i + 3] ?? 0;
    for (let px = x0 + 1.5; px < x1; px += 3) {
      for (let py = y0 + 1.5; py < y1; py += 3) {
        total += 1;
        if (!test(xOfPx(v, px), yOfPy(v, py))) bad += 1;
      }
    }
  }
  return total === 0 ? 0 : bad / total;
};

const checker = (x: number, y: number): boolean => (Math.floor(x) + Math.floor(y)) % 2 === 0;
/** Checkerboard view with 6 px cells. */
const checkerView = (wPx: number, hPx: number): ViewBox => ({ x0: 0, x1: wPx / 6, y0: 0, y1: hPx / 6, widthPx: wPx, heightPx: hPx });

/* ================================ PLOT-SM-1 ================================ */

describe('PLOT-SM-1: marker de-duplication stays linear and markers are capped', () => {
  const zeroField = {
    residual: (): number => 0,
    enclosure: (): { lo: number; hi: number; def: 2 } => ({ lo: 0, hi: 0, def: 2 }),
  };

  it('implicit: markers never exceed an explicit maxSamples', () => {
    const p = expectOk(traceImplicit(zeroField, sqView(100), { maxEvals: 1e7, maxSamples: 200 }));
    expect(p.markers.length).toBeLessThanOrEqual(200);
  }, TIMEOUT);

  it('implicit: markers never exceed the default 4,000 cap', () => {
    const p = expectOk(traceImplicit(zeroField, sqView(100), { maxEvals: 1e7 }));
    expect(p.markers.length).toBeLessThanOrEqual(4000);
  }, TIMEOUT);

  it('implicit: dropping markers at the cap sets capped', () => {
    const p = expectOk(traceImplicit(zeroField, sqView(100), { maxEvals: 1e7, maxSamples: 200 }));
    expect(p.markers.length).toBeLessThanOrEqual(200);
    if (p.markers.length >= 200) expect(p.stats.capped).toBe(true);
  }, TIMEOUT);

  it('implicit: 200 px square finishes quickly (no quadratic marker scan)', () => {
    const { value, ms } = timeIt(() => expectOk(traceImplicit(zeroField, sqView(200), { maxEvals: 1e7 })));
    expect(value.markers.length).toBeLessThanOrEqual(4000);
    expect(ms, `took ${ms.toFixed(0)} ms`).toBeLessThan(1000);
  }, TIMEOUT);

  it('implicit: no two markers share a kind and a pixel cell', () => {
    const p = expectOk(traceImplicit(zeroField, sqView(60), { maxEvals: 1e7 }));
    const seen = new Set<string>();
    for (const m of p.markers) {
      const key = `${m.kind}:${Math.round(m.px)}:${Math.round(m.py)}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  }, TIMEOUT);

  it('region: a checkerboard keeps markers within an explicit maxSamples', () => {
    const p = expectOk(fillRegion({ test: checker }, checkerView(150, 102), { maxEvals: 1e7, maxSamples: 100 }));
    expect(p.markers.length).toBeLessThanOrEqual(100);
  }, TIMEOUT);

  it('region: diagonal-touching checkerboard cells are not isolated points', () => {
    const p = expectOk(fillRegion({ test: checker }, checkerView(150, 102), { maxEvals: 1e7 }));
    expect(countKinds(p.markers, ['isolated'])).toBe(0);
  }, TIMEOUT);

  it('region: 300 x 204 checkerboard finishes quickly', () => {
    const { value, ms } = timeIt(() => expectOk(fillRegion({ test: checker }, checkerView(300, 204), { maxEvals: 1e7 })));
    expect(value.markers.length).toBeLessThanOrEqual(4000);
    expect(ms, `took ${ms.toFixed(0)} ms`).toBeLessThan(600);
  }, TIMEOUT);

  it('region: a real isolated point is still marked', () => {
    const v: ViewBox = { x0: -3, x1: 3, y0: -3, y1: 3, widthPx: 300, heightPx: 300 };
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('x^2 + y^2 <= 0'))), v));
    expect(countKinds(p.markers, ['isolated'])).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-2 ================================ */

describe('PLOT-SM-2: the implicit tracer refuses grids it cannot hold', () => {
  const sinField = { residual: (x: number, y: number): number => Math.sin(10 * x) + Math.sin(10 * y) };
  const mk = (widthPx: number, heightPx: number, devicePixelRatio: number): ViewBox => ({
    x0: -5,
    x1: 5,
    y0: -5,
    y1: 5,
    widthPx,
    heightPx,
    devicePixelRatio,
  });
  // Views the region filler refuses with `limit` (device-pixel leaf cells over the cap).
  const bigViews: ViewBox[] = [mk(4096, 4096, 4), mk(4096, 4096, 3), mk(3000, 3000, 4), mk(16384, 1024, 4)];

  it('precondition: the region filler refuses every one of these views with limit', () => {
    for (const v of bigViews) {
      const r = fillRegion({ test: (x, y) => x * x + y * y < 4 }, v, { maxEvals: 20000 });
      expect(expectErr(r).kind).toBe('limit');
    }
  }, TIMEOUT);

  it.each(bigViews)('traceImplicit refuses the same view with limit, quickly %#', (v) => {
    const { value, ms } = timeIt(() => traceImplicit(sinField, v, { maxEvals: 20000 }));
    expect(expectErr(value).kind).toBe('limit');
    expect(ms, `took ${ms.toFixed(0)} ms`).toBeLessThan(1000);
  }, TIMEOUT);

  it('ordinary views at devicePixelRatio 2 are still accepted', () => {
    const v: ViewBox = { ...V, devicePixelRatio: 2 };
    const input = { residual: (x: number, y: number): number => x * x + y * y - 4, enclosure: circleFieldEnc(2) };
    const p = expectOk(traceImplicit(input, v, { maxEvals: 200000 }));
    expect(p.paths.length).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-3 ================================ */

describe('PLOT-SM-3: partner and fallback lookups do not scan every sample', () => {
  it('sin(1/x) on the bench view runs in a few milliseconds (best of 5)', () => {
    const f = fnOf((x) => Math.sin(1 / x));
    const best = bestMs(5, () => plotFunction(f, BENCH_VIEW));
    expect(best, `best ${best.toFixed(1)} ms`).toBeLessThan(25);
  }, TIMEOUT);

  it('a NaN storm at 70,000 evaluations is not quadratic', () => {
    const f = fnOf((x) => (hash(x) < 0.5 ? NaN : Math.sin(x)));
    const { value, ms } = timeIt(() => plotFunction(f, V, { maxEvals: 70000, maxSamples: 65536 }));
    expect(value.ok).toBe(true);
    expect(ms, `took ${ms.toFixed(0)} ms`).toBeLessThan(500);
  }, TIMEOUT);

  it('a parametric curve with many undefined stretches is not quadratic', () => {
    const fn = pointFn('s/10', 'sqrt(sin(100*s))');
    const { value, ms } = timeIt(() =>
      traceParamCurve({ fn, lo: -40, hi: 40 }, V, { maxEvals: 400000, maxSamples: 65536 }),
    );
    expect(value.ok).toBe(true);
    expect(ms, `took ${ms.toFixed(0)} ms`).toBeLessThan(450);
  }, TIMEOUT);

  it('sin(1/x) still plots to completion with paths and ink', () => {
    const p = expectOk(plotFunction(fnOf((x) => Math.sin(1 / x)), BENCH_VIEW));
    expect(p.stats.complete).toBe(true);
    expect(p.paths.length).toBeGreaterThan(0);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-4 ================================ */

describe('PLOT-SM-4: a budget stop inside the undefined-edge refinement neither spins nor corrupts', () => {
  const sliceSizes = [16, 17, 20, 50, 100, 233, 300];
  const SLICE_CALL_LIMIT_MS = 40;

  /** Runs a plot in slices of `maxEvals`, returning the final plot, the call count and the slowest call. */
  const sliced = (
    f: FunctionValue,
    maxEvals: number,
  ): { readonly plot: FunctionPlot; readonly calls: number; readonly worstMs: number; readonly tokens: FunctionResume[] } => {
    const tokens: FunctionResume[] = [];
    const first = timeIt(() => expectOk(plotFunction(f, V, { maxEvals })));
    let cur = first.value;
    let worstMs = first.ms;
    let calls = 1;
    while (!cur.stats.complete) {
      expect(calls, 'resume did not converge').toBeLessThan(500);
      const token = tokenOf(cur);
      tokens.push(token);
      const step = timeIt(() => expectOk(resumeFunctionPlot(token, f, { maxEvals })));
      cur = step.value;
      worstMs = Math.max(worstMs, step.ms);
      calls += 1;
    }
    return { plot: cur, calls, worstMs, tokens };
  };

  const edgeFn = (): FunctionValue => fnOf((x) => Math.sqrt(-x) + Math.sin(4 * x));

  it.each(sliceSizes)('sqrt(-x) + sin(4x): sliced by %s evals gives the direct plot', (maxEvals) => {
    const f = edgeFn();
    const direct = expectOk(plotFunction(f, V));
    const s = sliced(f, maxEvals);
    expectSamePlot(s.plot, direct);
    expect(s.plot.stats.capped).toBe(direct.stats.capped);
    expect(s.plot.stats.rigorous).toBe(direct.stats.rigorous);
    expect(s.plot.stats.samples).toBe(direct.stats.samples);
  }, TIMEOUT);

  it.each([16, 50, 300])('sqrt(-x) + sin(4x): no slice of %s evals stalls a frame', (maxEvals) => {
    const s = sliced(edgeFn(), maxEvals);
    expect(s.worstMs, `slowest call ${s.worstMs.toFixed(0)} ms`).toBeLessThan(SLICE_CALL_LIMIT_MS);
  }, TIMEOUT);

  it.each([16, 100])('sqrt(-x) + sin(4x): a suspension (slice %s) never sets capped or drops rigor', (maxEvals) => {
    const f = edgeFn();
    const s = sliced(f, maxEvals);
    expect(s.tokens.length).toBeGreaterThan(0);
    for (const t of s.tokens) {
      expect(t.capped).toBe(false);
      expect(t.rigorous).toBe(true);
    }
  }, TIMEOUT);

  it.each([16, 50])('sqrt(x) + sin(4x): sliced by %s evals gives the direct plot', (maxEvals) => {
    const f = fnOf((x) => Math.sqrt(x) + Math.sin(4 * x));
    const direct = expectOk(plotFunction(f, V));
    const s = sliced(f, maxEvals);
    expectSamePlot(s.plot, direct);
    expect(s.plot.stats.capped).toBe(direct.stats.capped);
  }, TIMEOUT);

  it('log-like edge sqrt(x + 2) * sin(3x) sliced by 17 evals gives the direct plot', () => {
    const f = fnOf((x) => Math.sqrt(x + 2) * Math.sin(3 * x));
    const direct = expectOk(plotFunction(f, V));
    expectSamePlot(sliced(f, 17).plot, direct);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-5 ================================ */

describe('PLOT-SM-5: a resume token is tied to a function version', () => {
  const withVersion = (version: number, extra: FunctionPlotOptions = {}): FunctionPlotOptions =>
    ({ ...extra, version }) as FunctionPlotOptions;
  const resumeWithVersion = (version: number, extra: ResumeFunctionOptions = {}): ResumeFunctionOptions =>
    ({ ...extra, version }) as ResumeFunctionOptions;

  /** The resumed result either refuses or equals the direct plot of the new function. */
  const expectRefusedOrDirect = (r: Result<FunctionPlot>, direct: FunctionPlot): void => {
    if (!r.ok) {
      expect(['bad_argument', 'limit']).toContain(r.kind);
      return;
    }
    expect(r.value.stats.complete).toBe(true);
    expectSamePlot(r.value, direct);
  };

  it('the findings repro: x resumed as x + 3 is never stitched', () => {
    const first = expectOk(plotFunction(fnOf((x) => x), V, { maxEvals: 100 }));
    const g = fnOf((x) => x + 3);
    const direct = expectOk(plotFunction(g, V));
    expectRefusedOrDirect(resumeFunctionPlot(tokenOf(first), g, { maxEvals: 1e6 }), direct);
  }, TIMEOUT);

  it('a bumped version refuses or restarts, and never mixes samples', () => {
    const first = expectOk(plotFunction(fnOf((x) => x), V, withVersion(1, { maxEvals: 100 })));
    const g = fnOf((x) => x + 3);
    const direct = expectOk(plotFunction(g, V));
    expectRefusedOrDirect(resumeFunctionPlot(tokenOf(first), g, resumeWithVersion(2, { maxEvals: 1e6 })), direct);
  }, TIMEOUT);

  it('the stitched garbage (many paths, hundreds of markers) cannot appear', () => {
    const first = expectOk(plotFunction(fnOf((x) => x), V, withVersion(1, { maxEvals: 100 })));
    const r = resumeFunctionPlot(tokenOf(first), fnOf((x) => x + 3), resumeWithVersion(2, { maxEvals: 1e6 }));
    if (r.ok) {
      expect(r.value.paths.length).toBe(1);
      expect(r.value.markers.length).toBe(0);
    }
  }, TIMEOUT);

  it('the same version resumes and equals the direct plot', () => {
    const f = fnOf((x) => Math.sin(3 * x));
    const direct = expectOk(plotFunction(f, V, withVersion(7)));
    const first = expectOk(plotFunction(f, V, withVersion(7, { maxEvals: 100 })));
    const done = expectOk(resumeFunctionPlot(tokenOf(first), f, resumeWithVersion(7, { maxEvals: 1e6 })));
    expect(done.stats.complete).toBe(true);
    expectSamePlot(done, direct);
  }, TIMEOUT);

  it('a film: each frame bumps the version and resumes the previous token without mixing', () => {
    let token: FunctionResume | undefined;
    for (let frame = 0; frame < 4; frame += 1) {
      const f = fnOf((x) => Math.sin(x + frame));
      const direct = expectOk(plotFunction(f, V));
      if (token !== undefined) {
        expectRefusedOrDirect(resumeFunctionPlot(token, f, resumeWithVersion(frame, { maxEvals: 1e6 })), direct);
      }
      token = tokenOf(expectOk(plotFunction(f, V, withVersion(frame, { maxEvals: 100 }))));
    }
  }, TIMEOUT);

  it('a token made with a version cannot be resumed with another function and no version', () => {
    const first = expectOk(plotFunction(fnOf((x) => x), V, withVersion(1, { maxEvals: 100 })));
    const g = fnOf((x) => x + 3);
    const direct = expectOk(plotFunction(g, V));
    expectRefusedOrDirect(resumeFunctionPlot(tokenOf(first), g, { maxEvals: 1e6 }), direct);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-6 ================================ */

describe('PLOT-SM-6: a seed only saves evaluations and does not count against the cap', () => {
  const g = (x: number): number => Math.sin(3 * x);
  const PAN: ViewBox = { x0: -4.5, x1: 5.5, y0: -2, y1: 2, widthPx: 800, heightPx: 600 };

  const bigSeed = (): { xs: Float64Array; ys: Float64Array } => {
    const cache = createSampleCache();
    const xs = new Float64Array(5000);
    const ys = new Float64Array(5000);
    for (let i = 0; i < 5000; i += 1) {
      xs[i] = -6 + (12 * i) / 4999;
      ys[i] = g(xs[i] ?? 0);
    }
    cache.put('big', 1, xs, ys);
    const seed = cache.seedForRange(1, PAN.x0, PAN.x1);
    if (seed === undefined) throw new Error('no seed');
    return seed;
  };

  it('a cached seed above 4,000 samples does not mark the plot capped', () => {
    const seed = bigSeed();
    expect(seed.xs.length).toBeGreaterThan(4000);
    const p = expectOk(plotFunction(fnOf(g), PAN, { seed }));
    expect(p.stats.capped).toBe(false);
  }, TIMEOUT);

  it('a big seed still gets refined to the chord threshold', () => {
    const p = expectOk(plotFunction(fnOf(g), PAN, { seed: bigSeed() }));
    for (const path of p.paths) expect(maxSegPx(path)).toBeLessThanOrEqual(9);
  }, TIMEOUT);

  it('a big seed gives the same number of paths as no seed and costs no more evaluations', () => {
    const plain = expectOk(plotFunction(fnOf(g), PAN));
    const seeded = expectOk(plotFunction(fnOf(g), PAN, { seed: bigSeed() }));
    expect(seeded.paths.length).toBe(plain.paths.length);
    expect(seeded.stats.evals).toBeLessThanOrEqual(plain.stats.evals);
    expect(seeded.stats.capped).toBe(plain.stats.capped);
  }, TIMEOUT);

  it.each([0.25, 0.5, 1])('a pan of %s reuses the cached coarse grid values', (dx) => {
    const v1: ViewBox = { x0: -4.93, x1: 5.07, y0: -2, y1: 2, widthPx: 800, heightPx: 400 };
    const rec = recordingFn(g);
    expectOk(plotFunction(rec.fn, v1));
    const xs = Float64Array.from(rec.xs);
    const ys = xs.map(g);
    const pan: ViewBox = { ...v1, x0: v1.x0 + dx, x1: v1.x1 + dx };
    const plain = expectOk(plotFunction(fnOf(g), pan));
    const seeded = expectOk(plotFunction(fnOf(g), pan, { seed: { xs, ys } }));
    const steps = dx / 0.05;
    const saved = plain.stats.evals - seeded.stats.evals;
    expect(saved, `saved ${saved} of ${plain.stats.evals}`).toBeGreaterThanOrEqual(0.7 * (201 - steps));
  }, TIMEOUT);

  it('parametric: a 5,000-sample seed does not mark the circle capped', () => {
    const n = 5000;
    const ss = new Float64Array(n);
    const xys = new Float64Array(2 * n);
    for (let i = 0; i < n; i += 1) {
      const s = (2 * Math.PI * i) / (n - 1);
      ss[i] = s;
      xys[2 * i] = 4 * Math.cos(s);
      xys[2 * i + 1] = 4 * Math.sin(s);
    }
    const fn = pointFn('4*cos(s)', '4*sin(s)');
    const p = expectOk(traceParamCurve({ fn, lo: 0, hi: 2 * Math.PI, seed: { ss, xys } }, V));
    expect(p.stats.capped).toBe(false);
    for (const path of p.paths) expect(maxSegPx(path)).toBeLessThanOrEqual(9);
  }, TIMEOUT);

  it('parametric: a seed larger than an explicit maxSamples does not skip refinement', () => {
    const n = 1500;
    const ss = new Float64Array(n);
    const xys = new Float64Array(2 * n);
    for (let i = 0; i < n; i += 1) {
      const s = (2 * Math.PI * i) / (n - 1);
      ss[i] = s;
      xys[2 * i] = 4 * Math.cos(s);
      xys[2 * i + 1] = 4 * Math.sin(s);
    }
    const fn = pointFn('4*cos(s)', '4*sin(s)');
    const p = expectOk(traceParamCurve({ fn, lo: 0, hi: 2 * Math.PI, seed: { ss, xys } }, V, { maxSamples: 1000 }));
    expect(p.stats.capped).toBe(false);
    for (const path of p.paths) expect(maxSegPx(path)).toBeLessThanOrEqual(9);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-7 ================================ */

describe('PLOT-SM-7: ordinary regions and curves finish at the default budget without enclosures', () => {
  const v: ViewBox = BENCH_VIEW; // 1000 x 600 px, 100 px per unit horizontally and vertically.

  const fillOf = (relation: string, quality?: 'draft' | 'final'): RegionPlot =>
    expectOk(
      fillRegion(
        expectOk(predicateFromRelation(rel2(relation))),
        v,
        quality === undefined ? {} : { quality },
      ),
    );

  it('half-plane x > 0 completes with about half the view filled', () => {
    const p = fillOf('x > 0');
    expect(p.stats.complete).toBe(true);
    expect(rectsArea(p.rects)).toBeGreaterThan(0.45 * 600000);
    expect(rectsArea(p.rects)).toBeLessThan(0.55 * 600000);
  }, TIMEOUT);

  it('disc x^2 + y^2 <= 4 completes with non-empty output', () => {
    const p = fillOf('x^2 + y^2 <= 4');
    expect(p.stats.complete).toBe(true);
    expect(p.rects.length + p.polygons.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('sin(x) * y > 1 completes with non-empty output', () => {
    const p = fillOf('sin(x) * y > 1');
    expect(p.stats.complete).toBe(true);
    expect(p.rects.length + p.polygons.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('a half-plane completes with a budget of 100,000 evaluations by degrading, not failing', () => {
    const p = expectOk(
      fillRegion(expectOk(predicateFromRelation(rel2('x > 0'))), v, { maxEvals: 100000 }),
    );
    expect(p.stats.complete).toBe(true);
    expect(rectsArea(p.rects)).toBeGreaterThan(0.4 * 600000);
  }, TIMEOUT);

  it('implicit sin(x) + sin(y) == sin(x*y) completes at the default budget', () => {
    const field = expectOk(fieldFromRelation(rel2('sin(x) + sin(y) == sin(x*y)')));
    const p = expectOk(traceImplicit(field, v));
    expect(p.stats.complete).toBe(true);
    expect(p.paths.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('implicit circle x^2 + y^2 == 4 without an enclosure completes with a closed path', () => {
    const field = expectOk(fieldFromRelation(rel2('x^2 + y^2 == 4')));
    const p = expectOk(traceImplicit(field, v));
    expect(p.stats.complete).toBe(true);
    expect(p.closed.some((c) => c)).toBe(true);
  }, TIMEOUT);

  it('a genuinely starved budget still reports complete: false', () => {
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('x > 0'))), v, { maxEvals: 50 }));
    expect(p.stats.complete).toBe(false);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-8 ================================ */

describe('PLOT-SM-8: a verdict that costs more than one call budget still completes', () => {
  interface Case {
    readonly name: string;
    readonly f: (x: number) => number;
    readonly enc: ScalarEnclosure;
  }
  const cases: Case[] = [
    { name: 'sqrt', f: Math.sqrt, enc: sqrtEnc },
    { name: '1/x', f: (x) => 1 / x, enc: invEnc },
    { name: 'hole', f: (x) => (x === 1 ? NaN : (x * x - 1) / (x - 1)), enc: holeEnc },
  ];

  /** Runs to completion in slices; returns undefined when the budget is refused up front. */
  const drain = (
    c: Case,
    maxEvals: number,
    base: FunctionPlotOptions,
    maxCalls: number,
  ): { plot: FunctionPlot; calls: number } | 'refused' => {
    const f = fnOf(c.f);
    const first = plotFunction(f, V, { ...base, enclosure: c.enc, maxEvals });
    if (!first.ok) {
      expect(first.kind).toBe('bad_argument');
      return 'refused';
    }
    let cur = first.value;
    let calls = 1;
    while (!cur.stats.complete) {
      if (calls >= maxCalls) throw new Error(`still incomplete after ${calls} calls`);
      const r = resumeFunctionPlot(tokenOf(cur), f, { enclosure: c.enc, maxEvals });
      if (!r.ok) {
        expect(r.kind).toBe('bad_argument');
        return 'refused';
      }
      cur = r.value;
      calls += 1;
    }
    return { plot: cur, calls };
  };

  it.each([16, 20, 32])('sqrt, depth 1, coarse 2: slices of %s evals complete', (maxEvals) => {
    const out = drain(cases[0] as Case, maxEvals, { depth: 1, coarse: 2 }, 300);
    if (out === 'refused') return;
    expect(out.plot.stats.complete).toBe(true);
  }, TIMEOUT);

  it.each(cases.slice(1))('$name: depth 1, coarse 2, slices of 16 evals complete', (c) => {
    const out = drain(c, 16, { depth: 1, coarse: 2 }, 300);
    if (out !== 'refused') expect(out.plot.stats.complete).toBe(true);
  }, TIMEOUT);

  it('the sliced sqrt plot equals the direct plot with the same options', () => {
    const c = cases[0] as Case;
    const out = drain(c, 16, { depth: 1, coarse: 2 }, 300);
    if (out === 'refused') return;
    const direct = expectOk(plotFunction(fnOf(c.f), V, { enclosure: c.enc, depth: 1, coarse: 2 }));
    expect(out.plot.paths.length).toBe(direct.paths.length);
    expect(out.plot.markers.length).toBe(direct.markers.length);
  }, TIMEOUT);

  it('a completed resume leaves no token behind', () => {
    const c = cases[0] as Case;
    const out = drain(c, 20, { depth: 1, coarse: 2 }, 300);
    if (out !== 'refused') expect(out.plot.resume).toBeUndefined();
  }, TIMEOUT);
});

/* ================================ PLOT-SM-9 ================================ */

describe('PLOT-SM-9: an exact-mode run resumed without its enclosure is not reported complete', () => {
  const f = fnOf(Math.sin);
  const direct = (): FunctionPlot => expectOk(plotFunction(f, V, { exact: true, enclosure: sinEnc }));

  const toBand = (): FunctionPlot => {
    let cur = expectOk(plotFunction(f, V, { exact: true, enclosure: sinEnc, maxEvals: 300 }));
    let n = 0;
    while (cur.resume !== undefined && cur.resume.phase !== 'band' && n < 100) {
      cur = expectOk(resumeFunctionPlot(cur.resume, f, { enclosure: sinEnc, maxEvals: 300 }));
      n += 1;
    }
    return cur;
  };

  it('precondition: the exact plot has a full band of ink columns and no path', () => {
    const d = direct();
    expect(d.inkColumns.length).toBe(800);
    expect(d.paths.length).toBe(0);
  }, TIMEOUT);

  it('in the band phase, a resume without the enclosure never completes with a partial band', () => {
    const cur = toBand();
    expect(cur.resume?.phase).toBe('band');
    const r = resumeFunctionPlot(tokenOf(cur), f, { maxEvals: 1e6 });
    if (r.ok && r.value.stats.complete) {
      expect(r.value.inkColumns.length).toBe(800);
      expect(r.value.paths.length).toBe(0);
    }
  }, TIMEOUT);

  it('in the band phase, a resume without the enclosure is refused or restarted', () => {
    const cur = toBand();
    const r = resumeFunctionPlot(tokenOf(cur), f, { maxEvals: 1e6 });
    if (!r.ok) expect(r.kind).toBe('bad_argument');
    else {
      expect(r.value.stats.complete).toBe(true);
      expect(r.value.inkColumns.length).toBe(800);
    }
  }, TIMEOUT);

  it('an early-phase exact token resumed without the enclosure is refused or finished correctly', () => {
    const first = expectOk(plotFunction(f, V, { exact: true, enclosure: sinEnc, maxEvals: 100 }));
    const r = resumeFunctionPlot(tokenOf(first), f, { maxEvals: 1e6 });
    if (!r.ok) expect(r.kind).toBe('bad_argument');
    else if (r.value.stats.complete) {
      expect(r.value.inkColumns.length).toBe(800);
      expect(r.value.paths.length).toBe(0);
    }
  }, TIMEOUT);

  it('resumed with the enclosure, the band run equals the direct run', () => {
    const cur = toBand();
    const done = expectOk(resumeFunctionPlot(tokenOf(cur), f, { enclosure: sinEnc, maxEvals: 1e6 }));
    expect(done.stats.complete).toBe(true);
    expect(done.inkColumns.length).toBe(800);
    expect(done.paths.length).toBe(0);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-10 ================================ */

describe('PLOT-SM-10: the sample cache keeps one value per x and evicts least recently used', () => {
  const grid = (n: number, step = 0.1, offset = 0): Float64Array => Float64Array.from({ length: n }, (_, i) => offset + i * step);

  it('two functions at one version never leave duplicate x values in a seed', () => {
    const cache = createSampleCache();
    const xs = grid(100);
    cache.put('f', 1, xs, xs.map((x) => Math.sin(x)));
    cache.put('g', 1, xs, xs.map((x) => x * x));
    const seed = cache.seedForRange(1, 0, 10);
    const got = Array.from(seed?.xs ?? []);
    expect(new Set(got).size).toBe(got.length);
  }, TIMEOUT);

  it('partly overlapping puts leave one value per x', () => {
    const cache = createSampleCache();
    cache.put('f', 1, grid(100), grid(100));
    cache.put('g', 1, grid(100, 0.1, 5), grid(100, 0.1, 5).map((x) => -x));
    const got = Array.from(cache.seedForRange(1, 0, 20)?.xs ?? []);
    expect(new Set(got).size).toBe(got.length);
  }, TIMEOUT);

  it('seed x values come back ascending', () => {
    const cache = createSampleCache();
    cache.put('b', 1, grid(20, 0.1, 5), grid(20));
    cache.put('a', 1, grid(20, 0.1, 0), grid(20));
    const got = Array.from(cache.seedForRange(1, 0, 20)?.xs ?? []);
    expect(got).toEqual([...got].sort((p, q) => p - q));
  }, TIMEOUT);

  it('re-putting a key refreshes it, so the older key is evicted (capacity 2)', () => {
    const cache = createSampleCache(2);
    cache.put('hot', 1, new Float64Array([0]), new Float64Array([0]));
    cache.put('b', 1, new Float64Array([1]), new Float64Array([1]));
    cache.put('hot', 1, new Float64Array([0]), new Float64Array([0]));
    cache.put('c', 1, new Float64Array([2]), new Float64Array([2]));
    const got = Array.from(cache.seedForRange(1, -10, 10)?.xs ?? []);
    expect(got).toContain(0);
    expect(got).toContain(2);
    expect(got).not.toContain(1);
  }, TIMEOUT);

  it('the capacity is still respected after refreshes', () => {
    const cache = createSampleCache(2);
    for (const key of ['a', 'b', 'a', 'c', 'a', 'd']) cache.put(key, 1, new Float64Array([0]), new Float64Array([0]));
    expect(cache.size).toBeLessThanOrEqual(2);
  }, TIMEOUT);

  it('parametric entries refresh on re-put too (capacity 2)', () => {
    const cache = createSampleCache(2);
    const put = (key: string, s: number): void =>
      cache.putParam(key, 1, new Float64Array([s]), new Float64Array([s, s]));
    put('hot', 0);
    put('b', 1);
    put('hot', 0);
    put('c', 2);
    const got = Array.from(cache.paramSeedForRange(1, -10, 10)?.ss ?? []);
    expect(got).toContain(0);
    expect(got).not.toContain(1);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-11 ================================ */

describe('PLOT-SM-11: the parametric hole search has a bounded cost', () => {
  const sinRange = (a: number, b: number): { lo: number; hi: number } => {
    const pts = [a, b];
    const k0 = Math.ceil((a - Math.PI / 2) / Math.PI);
    const k1 = Math.floor((b - Math.PI / 2) / Math.PI);
    for (let k = k0; k <= k1; k += 1) pts.push(Math.PI / 2 + k * Math.PI);
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of pts) {
      lo = Math.min(lo, Math.sin(s));
      hi = Math.max(hi, Math.sin(s));
    }
    return { lo, hi };
  };

  /** Sound box for (s/10, sqrt(sin(k s))): def by the sign range of sin. */
  const holeEnc =
    (k: number): ParamEnclosure =>
    (s0, s1) => {
      const r = sinRange(k * s0, k * s1);
      const def = r.lo >= 0 ? 2 : r.hi < 0 ? 0 : 1;
      return { x0: s0 / 10, x1: s1 / 10, y0: 0, y1: Math.sqrt(Math.max(r.hi, 0)), def };
    };
  /** Loose but sound: always "maybe undefined". */
  const looseEnc: ParamEnclosure = (s0, s1) => ({ x0: s0 / 10, x1: s1 / 10, y0: 0, y1: 1, def: 1 });

  const run = (k: number, enclosure?: ParamEnclosure) =>
    traceParamCurve({ fn: pointFn('s/10', `sqrt(sin(${k}*s))`), lo: -40, hi: 40, ...(enclosure === undefined ? {} : { enclosure }) }, V);

  it('k = 20 with a sound enclosure completes at the default budget', () => {
    const p = expectOk(run(20, holeEnc(20)));
    expect(p.stats.complete).toBe(true);
    expect(p.paths.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('k = 20 spends at most half of the default budget on interval evaluations', () => {
    const p = expectOk(run(20, holeEnc(20)));
    expect(p.stats.intervalEvals).toBeLessThanOrEqual(10000);
  }, TIMEOUT);

  it('k = 20 with an enclosure draws about what the unenclosed trace draws', () => {
    const plain = expectOk(run(20));
    const enc = expectOk(run(20, holeEnc(20)));
    expect(enc.paths.length).toBeGreaterThanOrEqual(Math.floor(plain.paths.length / 2));
  }, TIMEOUT);

  it('a loose enclosure that answers maybe-undefined everywhere still completes', () => {
    const p = expectOk(run(20, looseEnc));
    expect(p.stats.complete).toBe(true);
    expect(p.paths.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('k = 5 completes within 5,000 interval evaluations', () => {
    const p = expectOk(run(5, holeEnc(5)));
    expect(p.stats.complete).toBe(true);
    expect(p.stats.intervalEvals).toBeLessThanOrEqual(5000);
  }, TIMEOUT);

  it('a loose enclosure never leaves the trace emptier than no enclosure', () => {
    const plain = expectOk(run(2));
    const loose = expectOk(run(2, looseEnc));
    expect(loose.stats.complete).toBe(true);
    expect(loose.paths.length).toBeGreaterThanOrEqual(Math.floor(plain.paths.length / 2));
  }, TIMEOUT);
});

/* ================================ PLOT-SM-12 ================================ */

describe('PLOT-SM-12: the region sample cap counts output points and never over-fills', () => {
  const sinSinTest = (x: number, y: number): boolean => Math.sin(8 * x) * Math.sin(8 * y) > 0;
  const sinSinInput = {
    test: sinSinTest,
    boundaries: [{ residual: (x: number, y: number): number => Math.sin(8 * x) * Math.sin(8 * y), strict: true }],
  };
  const SMALL: ViewBox = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 200, heightPx: 150 };
  const SLACK = 64;

  it('dense path: a 500-point cap bounds the emitted points', () => {
    const p = expectOk(fillRegion(sinSinInput, SMALL, { maxEvals: 1e7, maxSamples: 500 }));
    expect(emittedPoints(p)).toBeLessThanOrEqual(500 + SLACK);
  }, TIMEOUT);

  it('dense path: stats.samples respects the cap and capped is set', () => {
    const p = expectOk(fillRegion(sinSinInput, SMALL, { maxEvals: 1e7, maxSamples: 500 }));
    expect(p.stats.samples).toBeLessThanOrEqual(500 + SLACK);
    expect(p.stats.capped).toBe(true);
  }, TIMEOUT);

  const maybeAll = { test: checker, enclosure: (): 'maybe' => 'maybe' };
  const cView = checkerView(150, 102);
  const cArea = 150 * 102;

  it('an all-maybe enclosure with a tiny cap does not fill the whole view', () => {
    const p = expectOk(fillRegion(maybeAll, cView, { maxEvals: 1e7, maxSamples: 100 }));
    expect(rectsArea(p.rects)).toBeLessThanOrEqual(0.65 * cArea);
  }, TIMEOUT);

  it('a capped checkerboard fill claims little area the predicate does not hold', () => {
    const p = expectOk(fillRegion(maybeAll, cView, { maxEvals: 1e7, maxSamples: 100 }));
    expect(falseFillShare(p.rects, cView, checker)).toBeLessThanOrEqual(0.25);
  }, TIMEOUT);

  it('a capped disc fill claims no more than about the disc area', () => {
    const v: ViewBox = { x0: -3, x1: 3, y0: -3, y1: 3, widthPx: 600, heightPx: 600 };
    const f = circleFieldEnc(2);
    const input = {
      test: (x: number, y: number): boolean => x * x + y * y <= 4,
      enclosure: discTri(2, false),
      boundaries: [
        {
          residual: (x: number, y: number): number => 4 - x * x - y * y,
          strict: false,
          enclosure: (x0: number, x1: number, y0: number, y1: number) => {
            const q = f(x0, x1, y0, y1);
            return { lo: -q.hi, hi: -q.lo, def: 2 as const };
          },
        },
      ],
    };
    const p = expectOk(fillRegion(input, v, { maxSamples: 300 }));
    expect(emittedPoints(p)).toBeLessThanOrEqual(300 + SLACK);
    expect(rectsArea(p.rects)).toBeLessThanOrEqual(Math.PI * 4 * 10000 * 1.05);
  }, TIMEOUT);

  it('a small disc is not capped at the default cap', () => {
    const v: ViewBox = { x0: -3, x1: 3, y0: -3, y1: 3, widthPx: 600, heightPx: 600 };
    const p = expectOk(fillRegion(expectOk(predicateFromRelation(rel2('x^2 + y^2 <= 0.25'))), v));
    expect(p.stats.capped).toBe(false);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-13 ================================ */

describe('PLOT-SM-13: region borders reuse the fill instead of a second trace', () => {
  const v = BENCH_VIEW;
  const halfEnc = (x0: number, x1: number): { lo: number; hi: number; def: 2 } => ({ lo: x0, hi: x1, def: 2 });
  const withBorder = {
    test: (x: number): boolean => x > 0,
    enclosure: halfTri(true),
    boundaries: [{ residual: (x: number): number => x, strict: true, enclosure: halfEnc }],
  };
  const noBorder = { test: (x: number): boolean => x > 0, enclosure: halfTri(true) };

  it('the half-plane border costs at most about twice the fill alone in evaluations', () => {
    const border = expectOk(fillRegion(withBorder, v));
    const bare = expectOk(fillRegion(noBorder, v));
    expect(border.stats.evals).toBeLessThanOrEqual(2 * bare.stats.evals + 1000);
  }, TIMEOUT);

  it('the half-plane border is spent under 8,000 evaluations', () => {
    const border = expectOk(fillRegion(withBorder, v));
    expect(border.stats.evals).toBeLessThanOrEqual(8000);
  }, TIMEOUT);

  it('the border still lies on x = 0 (pixel 500) and is dashed', () => {
    const border = expectOk(fillRegion(withBorder, v));
    expect(border.borders.length).toBeGreaterThanOrEqual(1);
    for (const b of border.borders) {
      expect(b.strict).toBe(true);
      for (let i = 0; i + 1 < b.path.length; i += 2) expect(Math.abs((b.path[i] ?? 0) - 500)).toBeLessThanOrEqual(2);
    }
  }, TIMEOUT);
});

/* ================================ PLOT-SM-14 ================================ */

describe('PLOT-SM-14: oscillation becomes ink, not hundreds of markers', () => {
  const noisyKinds = ['hole', 'openEnd', 'jump'];
  const views: [string, ViewBox][] = [
    ['the default view', V],
    ['the bench view', BENCH_VIEW],
  ];

  it.each(views)('sin(1/x) on %s records at most 100 hole, open-end and jump markers', (_n, view) => {
    const p = expectOk(plotFunction(fnOf((x) => Math.sin(1 / x)), view));
    expect(countKinds(p.markers, noisyKinds)).toBeLessThanOrEqual(100);
  }, TIMEOUT);

  it('sin(1/x) keeps its ink columns', () => {
    const p = expectOk(plotFunction(fnOf((x) => Math.sin(1 / x)), V));
    expect(p.inkColumns.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('no hole, open-end or jump marker sits inside an ink column', () => {
    const p = expectOk(plotFunction(fnOf((x) => Math.sin(1 / x)), V));
    const ink = p.inkColumns.map((c) => c.x);
    const clash = p.markers.filter(
      (m) => noisyKinds.includes(m.kind) && ink.some((x) => Math.abs(x - m.px) <= 1.5),
    );
    expect(clash.length).toBe(0);
  }, TIMEOUT);

  it('sin(10/x) records at most 100 noisy markers', () => {
    const p = expectOk(plotFunction(fnOf((x) => Math.sin(10 / x)), V));
    expect(countKinds(p.markers, noisyKinds)).toBeLessThanOrEqual(100);
  }, TIMEOUT);

  it('x * sin(1/x) stays quiet (at most 5 noisy markers)', () => {
    const p = expectOk(plotFunction(fnOf((x) => x * Math.sin(1 / x)), V));
    expect(countKinds(p.markers, noisyKinds)).toBeLessThanOrEqual(5);
  }, TIMEOUT);
});

/* ================================ PLOT-SM-15 ================================ */

describe('PLOT-SM-15: resume tokens are validated like fresh options', () => {
  const f = fnOf(Math.sin);
  const token = (): FunctionResume => tokenOf(expectOk(plotFunction(f, V, { maxEvals: 150 })));
  const mutated = (m: Record<string, unknown>): Result<FunctionPlot> =>
    resumeFunctionPlot({ ...token(), ...m } as unknown as FunctionResume, f, { maxEvals: 1000 });
  const refused = (r: Result<FunctionPlot>, kinds: readonly string[] = ['bad_argument']): void => {
    expect(r.ok, 'a malformed token must be refused').toBe(false);
    if (!r.ok) expect(kinds).toContain(r.kind);
  };

  it('precondition: the token carries a pending list, pieces and coarse grid', () => {
    const t = token();
    expect(t.pending.length).toBeGreaterThan(0);
    expect(t.pieces.length).toBeGreaterThan(0);
    expect(t.coarseXs.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('an untouched token survives a structured clone and resumes', () => {
    const r = expectOk(resumeFunctionPlot(structuredClone(token()), f, { maxEvals: 1e6 }));
    expect(r.stats.complete).toBe(true);
  }, TIMEOUT);

  it('the findings repro (maxSamples 1e9, bendPx 1e-9, depth 60) is refused', () => {
    refused(mutated({ maxSamples: 1e9, bendPx: 1e-9, depth: 60 }), ['bad_argument', 'limit']);
  }, TIMEOUT);

  it.each([1e9, 70000])('maxSamples %s is refused (limit)', (value) => {
    refused(mutated({ maxSamples: value }), ['limit', 'bad_argument']);
  }, TIMEOUT);

  it.each([0, Number.NaN])('maxSamples %s is refused', (value) => {
    refused(mutated({ maxSamples: value }));
  }, TIMEOUT);

  it.each([60, -1])('depth %s is refused', (value) => {
    refused(mutated({ depth: value }));
  }, TIMEOUT);

  it.each([0, Number.NaN])('bendPx %s is refused', (value) => {
    refused(mutated({ bendPx: value }));
  }, TIMEOUT);

  it.each([-1, Number.POSITIVE_INFINITY])('chordPx %s is refused', (value) => {
    refused(mutated({ chordPx: value }));
  }, TIMEOUT);

  it('a pending span with a hugely negative depth is refused', () => {
    const t = token();
    refused(mutated({ pending: t.pending.map((s) => ({ ...s, depth: -1e9 })) }));
  }, TIMEOUT);

  it('a pending span deeper than the token depth limit is refused', () => {
    const t = token();
    refused(mutated({ pending: t.pending.map((s) => ({ ...s, depth: 99 })) }));
  }, TIMEOUT);

  it('a non-finite coarse grid value is refused', () => {
    const t = token();
    refused(mutated({ coarseXs: [Number.NaN, ...t.coarseXs.slice(1)] }));
  }, TIMEOUT);

  it('a piece whose lo exceeds its hi is refused', () => {
    refused(mutated({ pieces: [{ lo: 5, hi: -5, loKind: 'view', hiKind: 'view' }] }));
  }, TIMEOUT);

  it('a piece with an unknown end kind is refused', () => {
    refused(mutated({ pieces: [{ lo: -5, hi: 5, loKind: 'zzz', hiKind: 'view' }] }));
  }, TIMEOUT);

  it('a non-boolean exact flag is refused', () => {
    refused(mutated({ exact: 'yes' }));
  }, TIMEOUT);
});

/* ================================ PLOT-SM-16 ================================ */

describe('PLOT-SM-16: parametric markers are drawable and inside the clip box', () => {
  const clipOk = (m: PlotMarker, v: ViewBox): boolean =>
    Number.isFinite(m.px) &&
    Number.isFinite(m.py) &&
    m.px >= -4 * v.widthPx &&
    m.px <= 5 * v.widthPx &&
    m.py >= -4 * v.heightPx &&
    m.py <= 5 * v.heightPx;

  const curves: [string, string, number, number][] = [
    ['1e300*s', '1/s', -1, 1],
    ['s', 'tan(s)', -3, 3],
    ['1/s', '1/s', -1, 1],
    ['s', '1e200/s', -1, 1],
    ['s', 'sqrt(s)/s', -1, 1],
  ];

  it.each(curves)('(%s, %s) on [%s, %s]: every marker is finite and within the clip box', (xb, yb, lo, hi) => {
    const p = expectOk(traceParamCurve({ fn: pointFn(xb, yb), lo, hi }, V));
    const bad = p.markers.filter((m) => !clipOk(m, V));
    expect(bad.map((m) => `${m.kind}@${m.px},${m.py}`)).toEqual([]);
  }, TIMEOUT);

  it('the findings repro keeps no astronomical end markers', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('1e300*s', '1/s'), lo: -1, hi: 1 }, V));
    for (const m of p.markers) {
      expect(Math.abs(m.px)).toBeLessThan(1e6);
      expect(Math.abs(m.py)).toBeLessThan(1e6);
    }
  }, TIMEOUT);

  it('a well-behaved circle keeps its markers inside the view (no regression)', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('3*cos(s)', '3*sin(s)'), lo: 0, hi: 2 * Math.PI }, V));
    for (const m of p.markers) expect(clipOk(m, V)).toBe(true);
  }, TIMEOUT);
});
