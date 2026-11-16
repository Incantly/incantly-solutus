/**
 * Function plotter: sample and evaluation budgets, suspend/resume,
 * determinism, and the doc's time targets (as hang limits plus eval budgets).
 *
 * Docs: `docs/features/functions-calculus/design.md` section 9
 * ("Budgets", "`stats.complete` + frame budget", "Output stability for
 * films"); `docs/design/performance.md` section 5 (4,000 curve samples).
 */
import { describe, expect, it } from 'vitest';
import { plotFunction, resumeFunctionPlot } from '@incantly/plot';
import {
  HEAVY_TIMEOUT,
  TIMEOUT,
  VIEW,
  expectOk,
  fn1,
  invEnc,
  squareEnc,
} from './helpers';

describe('FC9 budgets: at most 4,000 samples per curve on screen', () => {
  it.each([50, 100])('FC9 budgets: maxSamples %s caps the output there', (cap) => {
    const p = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW, { maxSamples: cap }));
    expect(p.stats.samples).toBeLessThanOrEqual(cap);
    expect(p.stats.capped).toBe(true);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('FC9 budgets: a cap above the natural count binds nothing', () => {
    const p = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW, { maxSamples: 500 }));
    expect(p.stats.samples).toBeLessThanOrEqual(500);
    expect(p.stats.capped).toBe(false);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('FC9 budgets: the default cap is 4,000 samples', () => {
    const p = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW, { coarse: 5000 }));
    expect(p.stats.samples).toBeLessThanOrEqual(4000);
    expect(p.stats.capped).toBe(true);
    expect(p.stats.complete).toBe(true);
  }, HEAVY_TIMEOUT);

  it('FC9 budgets: ordinary plots are not capped', () => {
    const p = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW));
    expect(p.stats.capped).toBe(false);
  }, TIMEOUT);
});

describe('FC9 budgets: at most 20,000 evaluations for a hard curve', () => {
  it.each(['sin(1/x)', 'tan(x)', '1/x', 'floor(x)', 'sin(1000*x)'])('FC9 budgets: hard curves stay within 20,000 evals (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    expect(p.stats.evals).toBeLessThanOrEqual(20000);
  }, HEAVY_TIMEOUT);

  it('FC9 budgets: a smooth 1,000px curve costs about 1,200 evals', () => {
    const v = { ...VIEW, widthPx: 1000 };
    const p = expectOk(plotFunction(fn1('sin(x) + x^2/10'), v));
    expect(p.stats.evals).toBeGreaterThanOrEqual(250);
    expect(p.stats.evals).toBeLessThanOrEqual(3000);
  }, TIMEOUT);

  it('FC9 budgets: interval work on a typical curve stays within a handful', () => {
    const p = expectOk(plotFunction(fn1('tan(x)'), VIEW, { enclosure: (lo, hi) => {
      for (let k = -3; k <= 3; k += 1) {
        const c = Math.PI / 2 + k * Math.PI;
        if (lo <= c && c <= hi) return { lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY, def: 1 as const };
      }
      return { lo: Math.tan(lo), hi: Math.tan(hi), def: 2 as const };
    } }));
    expect(p.stats.intervalEvals).toBeLessThanOrEqual(50);
  }, TIMEOUT);
});

describe('FC9 frame budget: suspend with a token, resume with a fresh budget', () => {
  it.each([300, 1000])('FC9 frame: a tiny budget suspends with empty output (maxEvals %s)', (maxEvals) => {
    const p = expectOk(plotFunction(fn1('sin(1/x)'), VIEW, { maxEvals }));
    expect(p.stats.complete).toBe(false);
    expect(p.paths).toEqual([]);
    expect(p.markers).toEqual([]);
    expect(p.inkColumns).toEqual([]);
    expect(p.resume).toBeDefined();
    expect(p.stats.evals).toBeLessThanOrEqual(maxEvals);
  }, TIMEOUT);

  it('FC9 frame: resume finishes the plot', () => {
    const f = fn1('sin(1/x)');
    const first = expectOk(plotFunction(f, VIEW, { maxEvals: 300 }));
    expect(first.resume).toBeDefined();
    if (first.resume === undefined) throw new Error('no resume token');
    const done = expectOk(resumeFunctionPlot(first.resume, f, { maxEvals: 50000 }));
    expect(done.stats.complete).toBe(true);
    expect(done.resume).toBeUndefined();
    expect(done.paths.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it.each([300, 1000, 5000])('FC9 frame: the finished plot is identical however sliced (maxEvals %s)', (maxEvals) => {
    const f = fn1('sin(1/x)');
    const direct = expectOk(plotFunction(f, VIEW));
    // Resume continues the same work, so it must finish within the direct cost
    // plus a few slices of per-call overhead - never spin without converging.
    const maxSlices = Math.ceil(direct.stats.evals / maxEvals) + 5;
    let cur = expectOk(plotFunction(f, VIEW, { maxEvals }));
    let guard = 0;
    while (!cur.stats.complete) {
      guard += 1;
      expect(guard < maxSlices, `resume did not converge within ${maxSlices} slices`).toBe(true);
      if (cur.resume === undefined) throw new Error('incomplete without a token');
      cur = expectOk(resumeFunctionPlot(cur.resume, f, { maxEvals }));
    }
    expect(cur.paths.length).toBe(direct.paths.length);
    for (let i = 0; i < direct.paths.length; i += 1) {
      expect(Array.from(cur.paths[i] ?? [])).toEqual(Array.from(direct.paths[i] ?? []));
    }
    expect(cur.markers).toEqual(direct.markers);
    expect(cur.inkColumns).toEqual(direct.inkColumns);
  }, HEAVY_TIMEOUT);

  it('FC9 frame: resume carries the enclosure across the suspension', () => {
    const f = fn1('1/x');
    const direct = expectOk(plotFunction(f, VIEW, { enclosure: invEnc }));
    const first = expectOk(plotFunction(f, VIEW, { enclosure: invEnc, maxEvals: 300 }));
    expect(first.stats.complete).toBe(false);
    if (first.resume === undefined) throw new Error('no resume token');
    const done = expectOk(resumeFunctionPlot(first.resume, f, { enclosure: invEnc, maxEvals: 50000 }));
    expect(done.stats.complete).toBe(true);
    expect(done.paths.length).toBe(direct.paths.length);
    for (let i = 0; i < direct.paths.length; i += 1) {
      expect(Array.from(done.paths[i] ?? [])).toEqual(Array.from(direct.paths[i] ?? []));
    }
    expect(done.markers).toEqual(direct.markers);
  }, TIMEOUT);

  it('FC9 frame: resumed work accumulates past the first slice', () => {
    const f = fn1('sin(1/x)');
    const first = expectOk(plotFunction(f, VIEW, { maxEvals: 300 }));
    if (first.resume === undefined) throw new Error('no resume token');
    const done = expectOk(resumeFunctionPlot(first.resume, f, { maxEvals: 50000 }));
    expect(done.stats.evals).toBeGreaterThanOrEqual(first.stats.evals);
  }, TIMEOUT);

  it('FC9 frame: the resume token survives structured cloning (worker story)', () => {
    const f = fn1('sin(1/x)');
    const first = expectOk(plotFunction(f, VIEW, { maxEvals: 300 }));
    if (first.resume === undefined) throw new Error('no resume token');
    const clone = structuredClone(first.resume);
    const done = expectOk(resumeFunctionPlot(clone, f, { maxEvals: 50000 }));
    expect(done.stats.complete).toBe(true);
  }, TIMEOUT);

  it('FC9 frame: suspension is deterministic (same budget, same stop)', () => {
    const f = fn1('sin(1/x)');
    const a = expectOk(plotFunction(f, VIEW, { maxEvals: 300 }));
    const b = expectOk(plotFunction(f, VIEW, { maxEvals: 300 }));
    expect(b.stats.evals).toBe(a.stats.evals);
    expect(b.resume).toEqual(a.resume);
  }, TIMEOUT);
});

describe('FC9 output stability: a pure function of version, view and pixels', () => {
  it.each(['x^2 - 2', '1/x', 'sin(1/x)'])('FC9 stability: repeat runs are identical (%s)', (body) => {
    const a = expectOk(plotFunction(fn1(body), VIEW));
    const b = expectOk(plotFunction(fn1(body), VIEW));
    expect(b.stats).toEqual(a.stats);
    expect(b.paths.length).toBe(a.paths.length);
    for (let i = 0; i < a.paths.length; i += 1) {
      expect(Array.from(b.paths[i] ?? [])).toEqual(Array.from(a.paths[i] ?? []));
    }
    expect(b.markers).toEqual(a.markers);
    expect(b.inkColumns).toEqual(a.inkColumns);
  }, HEAVY_TIMEOUT);

  it('FC9 stability: identical with an enclosure', () => {
    const a = expectOk(plotFunction(fn1('x^2 - 2'), VIEW, { enclosure: squareEnc }));
    const b = expectOk(plotFunction(fn1('x^2 - 2'), VIEW, { enclosure: squareEnc }));
    expect(b.stats).toEqual(a.stats);
    expect(b.markers).toEqual(a.markers);
  }, TIMEOUT);

  it('FC9 stability: identical with a seed', () => {
    const v = VIEW;
    const m = Math.max(64, v.widthPx / 4);
    const xs = new Float64Array(m);
    for (let i = 0; i < m; i += 1) xs[i] = v.x0 + ((v.x1 - v.x0) * i) / (m - 1);
    const probe = fn1('sin(x)');
    const ys = new Float64Array(m);
    (probe as unknown as { batch: (xs: Float64Array, out: Float64Array) => void }).batch(xs, ys);
    const a = expectOk(plotFunction(fn1('sin(x)'), v, { seed: { xs, ys } }));
    const b = expectOk(plotFunction(fn1('sin(x)'), v, { seed: { xs, ys } }));
    expect(b.stats).toEqual(a.stats);
    expect(b.paths.length).toBe(a.paths.length);
  }, TIMEOUT);

  it('FC9 stability: inputs are never mutated', () => {
    const view = { ...VIEW };
    const options = { breaks: [0.5], enclosure: squareEnc, maxSamples: 4000 as const };
    const viewBefore = JSON.stringify(view);
    const breaksBefore = JSON.stringify(options.breaks);
    expectOk(plotFunction(fn1('x^2 - 2'), view, options));
    expect(JSON.stringify(view)).toBe(viewBefore);
    expect(JSON.stringify(options.breaks)).toBe(breaksBefore);
    expect(options.enclosure).toBe(squareEnc);
    expect(options.maxSamples).toBe(4000);
  }, TIMEOUT);
});

describe('FC9 targets: doc timing cases complete fast (hang limits + eval budgets)', () => {
  // The millisecond targets are machine-dependent, so the suite asserts what is
  // deterministic (completion, eval budgets) plus a generous hang limit. The
  // measured means on the test machine go in handoff/plot/test-report.md.
  it.each([
    ['smooth sin(x)+x^2/10 (target 0.3ms)', 'sin(x) + x^2/10', VIEW],
    ['tan(x) (target 1.5ms)', 'tan(x)', VIEW],
    ['floor(x) (target 0.5ms)', 'floor(x)', VIEW],
  ])('FC9 targets: %s completes within budget', (_label, body, view) => {
    const t0 = performance.now();
    const p = expectOk(plotFunction(fn1(body), view));
    const ms = performance.now() - t0;
    expect(p.stats.complete).toBe(true);
    expect(p.stats.evals).toBeLessThanOrEqual(20000);
    expect(ms).toBeLessThan(5000);
  }, HEAVY_TIMEOUT);

  it('FC9 targets: sin(1/x) (target 5ms) completes within budget', { retry: 2, timeout: HEAVY_TIMEOUT }, () => {
    const t0 = performance.now();
    const p = expectOk(plotFunction(fn1('sin(1/x)'), VIEW));
    const ms = performance.now() - t0;
    expect(p.stats.complete).toBe(true);
    expect(p.stats.evals).toBeLessThanOrEqual(20000);
    expect(ms).toBeLessThan(5000);
  });
});
