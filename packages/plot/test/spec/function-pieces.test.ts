/**
 * Function plotter: pieces (domain spans + breaks) and coarse samples.
 *
 * Docs: `docs/features/functions-calculus/design.md` section 9 steps 1-2 and
 * "Cache and incremental update"; `docs/features/functions-calculus/design.md`
 * section 4 (Domain spans) and section 6 (break points); output marker kinds
 * from section 9 ("markers: hole, closedEnd, openEnd, pole (x), jump").
 */
import { describe, expect, it } from 'vitest';
import { cacheKey, createSampleCache, plotFunction } from '@incantly/plot';
import type { DomainSpan, SampleSeed } from '@incantly/plot';
import {
  TIMEOUT,
  VIEW,
  boundsOf,
  counted,
  expectFiniteMarkers,
  expectMarkerMapping,
  expectOk,
  floorEnc,
  fn1,
  markersOf,
  pairs,
  pxOf,
  viewWidth,
  xOfPx,
} from './helpers';

const FLAT = '0.1*x+1';

describe('FC9 step 1: pieces split the visible range by domain spans and breaks', () => {
  it('FC9§1: default domain is the whole line; a smooth curve spans the view', () => {
    const p = expectOk(plotFunction(fn1('x^2 - 2'), VIEW));
    expect(p.paths.length).toBe(1);
    const b = boundsOf(p.paths[0] ?? new Float64Array(0));
    expect(b).toBeDefined();
    expect(Math.abs((b?.minX ?? -1) - 0) < 1).toBe(true);
    expect(Math.abs((b?.maxX ?? -1) - VIEW.widthPx) < 1).toBe(true);
  }, TIMEOUT);

  it('FC9§1: a closed domain span draws closedEnd markers at both bounds', () => {
    const domain: DomainSpan[] = [{ lo: -2, hi: 3, loOpen: false, hiOpen: false }];
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { domain }));
    expect(p.paths.length).toBe(1);
    const closed = markersOf(p.markers, 'closedEnd');
    expect(closed.length).toBe(2);
    const xs = closed.map((m) => m.x).sort((a, b) => a - b);
    expect(Math.abs((xs[0] ?? 99) - -2) < 1e-6).toBe(true);
    expect(Math.abs((xs[1] ?? 99) - 3) < 1e-6).toBe(true);
    for (const m of closed) expectMarkerMapping(VIEW, m);
    expectFiniteMarkers(p);
  }, TIMEOUT);

  it('FC9§1: an open domain span draws openEnd markers at both bounds', () => {
    const domain: DomainSpan[] = [{ lo: -2, hi: 3, loOpen: true, hiOpen: true }];
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { domain }));
    const open = markersOf(p.markers, 'openEnd');
    expect(open.length).toBe(2);
    expect(markersOf(p.markers, 'closedEnd').length).toBe(0);
    for (const m of open) expectMarkerMapping(VIEW, m);
  }, TIMEOUT);

  it.each([
    ['closed lo, open hi', false, true],
    ['open lo, closed hi', true, false],
  ])('FC9§1: mixed openness %s marks each end on its own', (_label, loOpen, hiOpen) => {
    const domain: DomainSpan[] = [{ lo: -2, hi: 3, loOpen, hiOpen }];
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { domain }));
    expect(markersOf(p.markers, loOpen ? 'openEnd' : 'closedEnd').some((m) => Math.abs(m.x - -2) < 1e-6)).toBe(true);
    expect(markersOf(p.markers, hiOpen ? 'openEnd' : 'closedEnd').some((m) => Math.abs(m.x - 3) < 1e-6)).toBe(true);
  }, TIMEOUT);

  it('FC9§1: two domain spans give two paths with a gap between them', () => {
    const domain: DomainSpan[] = [
      { lo: -4, hi: -1, loOpen: false, hiOpen: false },
      { lo: 1, hi: 4, loOpen: false, hiOpen: false },
    ];
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { domain }));
    expect(p.paths.length).toBe(2);
    for (const path of p.paths) {
      for (const pt of pairs(path)) {
        const x = xOfPx(VIEW, pt.x);
        expect(x < -1 + 1e-9 || x > 1 - 1e-9, `vertex inside the gap at x=${x}`).toBe(true);
      }
    }
  }, TIMEOUT);

  it('FC9§1: three domain spans give three paths', () => {
    const domain: DomainSpan[] = [
      { lo: -4.5, hi: -3, loOpen: false, hiOpen: false },
      { lo: -1, hi: 1, loOpen: false, hiOpen: false },
      { lo: 3, hi: 4.5, loOpen: false, hiOpen: false },
    ];
    const p = expectOk(plotFunction(fn1('sin(x)'), VIEW, { domain }));
    expect(p.paths.length).toBe(3);
  }, TIMEOUT);

  it('FC4: an empty domain [] draws nothing and still completes', () => {
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { domain: [] }));
    expect(p.paths.length).toBe(0);
    expect(p.markers.length).toBe(0);
    expect(p.inkColumns.length).toBe(0);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('FC9§1: a domain fully outside the view draws nothing and still completes', () => {
    const domain: DomainSpan[] = [{ lo: 100, hi: 200, loOpen: false, hiOpen: false }];
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { domain }));
    expect(p.paths.length).toBe(0);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('FC9§1: a domain bound past the view edge clips at the view edge', () => {
    const domain: DomainSpan[] = [{ lo: -100, hi: 100, loOpen: false, hiOpen: false }];
    const p = expectOk(plotFunction(fn1(FLAT), VIEW, { domain }));
    expect(p.paths.length).toBe(1);
    const b = boundsOf(p.paths[0] ?? new Float64Array(0));
    expect(Math.abs((b?.minX ?? -1) - 0) < 1).toBe(true);
    expect(Math.abs((b?.maxX ?? -1) - VIEW.widthPx) < 1).toBe(true);
  }, TIMEOUT);

  it('FC9§1: a degenerate single-point domain completes without hanging', () => {
    const domain: DomainSpan[] = [{ lo: 2, hi: 2, loOpen: false, hiOpen: false }];
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { domain }));
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('FC9§1: exact samples are placed at both ends of a domain piece', () => {
    const domain: DomainSpan[] = [{ lo: -2, hi: 3, loOpen: false, hiOpen: false }];
    const p = expectOk(plotFunction(fn1(FLAT), VIEW, { domain }));
    const pts = pairs(p.paths[0] ?? new Float64Array(0));
    const loPx = pxOf(VIEW, -2);
    const hiPx = pxOf(VIEW, 3);
    expect(Math.min(...pts.map((q) => Math.abs(q.x - loPx))) < 1e-6).toBe(true);
    expect(Math.min(...pts.map((q) => Math.abs(q.x - hiPx))) < 1e-6).toBe(true);
  }, TIMEOUT);

  it('FC9§1 + FC6: a break puts an exact sample at the break x', () => {
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { breaks: [0.5] }));
    const pts = pairs(p.paths[0] ?? new Float64Array(0));
    const bx = pxOf(VIEW, 0.5);
    // A coarse neighbour sits ~4px away, so 1e-6px proves an exact sample.
    expect(Math.min(...pts.map((q) => Math.abs(q.x - bx))) < 1e-6).toBe(true);
  }, TIMEOUT);

  it('FC9§1 + FC6: both sides of a jump break are sampled exactly (open left, closed right)', () => {
    const p = expectOk(plotFunction(fn1('floor(x)'), VIEW, { breaks: [0], enclosure: floorEnc }));
    // floor(0) = 0 belongs to the right side, so the left end is open there.
    const open = markersOf(p.markers, 'openEnd').filter((m) => Math.abs(m.x - 0) < 1e-9);
    const closed = markersOf(p.markers, 'closedEnd').filter((m) => Math.abs(m.x - 0) < 1e-9);
    expect(open.length).toBe(1);
    expect(closed.length).toBe(1);
  }, TIMEOUT);

  it('FC9§1: a continuous function joins across its breaks into one path', () => {
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { breaks: [-1, 2] }));
    expect(p.paths.length).toBe(1);
    expect(markersOf(p.markers, 'jump').length).toBe(0);
    expect(markersOf(p.markers, 'pole').length).toBe(0);
    expect(markersOf(p.markers, 'hole').length).toBe(0);
  }, TIMEOUT);

  it('FC9§1: exact samples land on every one of several breaks', () => {
    const breaks = [-3, -0.5, 2.5];
    const p = expectOk(plotFunction(fn1('sin(x)'), VIEW, { breaks }));
    const pts = pairs(p.paths[0] ?? new Float64Array(0));
    for (const b of breaks) {
      const bx = pxOf(VIEW, b);
      expect(Math.min(...pts.map((q) => Math.abs(q.x - bx))) < 1e-6, `break at x=${b}`).toBe(true);
    }
  }, TIMEOUT);

  it('FC9§1: a break outside the view leaves the output identical', () => {
    const plain = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW));
    const withBreak = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW, { breaks: [50, -60] }));
    expect(withBreak.paths.length).toBe(plain.paths.length);
    for (let i = 0; i < plain.paths.length; i += 1) {
      expect(Array.from(withBreak.paths[i] ?? [])).toEqual(Array.from(plain.paths[i] ?? []));
    }
    expect(withBreak.markers).toEqual(plain.markers);
  }, TIMEOUT);

  it('FC9§1: breaks combine with a domain; pieces stay inside the domain', () => {
    const domain: DomainSpan[] = [{ lo: 0, hi: 4, loOpen: false, hiOpen: false }];
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { domain, breaks: [1, 2, 3] }));
    expect(p.paths.length).toBe(1);
    for (const pt of pairs(p.paths[0] ?? new Float64Array(0))) {
      const x = xOfPx(VIEW, pt.x);
      expect(x >= -1e-9 && x <= 4 + 1e-9, `vertex outside domain at x=${x}`).toBe(true);
    }
  }, TIMEOUT);

  it.each(['x^2 - 2', 'sin(x)', '1/x', 'floor(x)', 'sqrt(x)', 'abs(x)'])(
    'FC9 output: function markers are only hole, closedEnd, openEnd, pole or jump (%s)',
    (body) => {
      const p = expectOk(plotFunction(fn1(body), VIEW));
      for (const m of p.markers) {
        expect(['hole', 'closedEnd', 'openEnd', 'pole', 'jump'].includes(m.kind), `kind ${m.kind}`).toBe(true);
      }
    },
    TIMEOUT,
  );

  it.each(['x^2 - 2', 'sin(x) + x^2/10'])('FC9§1: a smooth full-range curve has no markers (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    expect(p.markers).toEqual([]);
  }, TIMEOUT);
});

describe('FC9 step 2: coarse samples are max(64, widthPx/4), evenly spaced', () => {
  it.each([
    [64, 64],
    [100, 64],
    [200, 64],
    [400, 100],
    [800, 200],
    [1600, 400],
    [2000, 500],
  ])('FC9§2: width %spx starts from %s coarse samples', (widthPx, coarse) => {
    const p = expectOk(plotFunction(fn1(FLAT), viewWidth(widthPx)));
    expect(p.stats.samples).toBe(coarse);
    expect(p.stats.maxDepth).toBe(0);
  }, TIMEOUT);

  it.each([400, 800])('FC9§2: coarse samples are evenly spaced (%spx)', (widthPx) => {
    const v = viewWidth(widthPx);
    const p = expectOk(plotFunction(fn1(FLAT), v));
    const pts = pairs(p.paths[0] ?? new Float64Array(0));
    expect(pts.length).toBe(Math.max(64, widthPx / 4));
    const dxs = pts.slice(1).map((q, i) => q.x - (pts[i]?.x ?? 0));
    for (const dx of dxs) expect(Math.abs(dx - (dxs[0] ?? 0)) < 1e-9).toBe(true);
  }, TIMEOUT);

  it('FC9§2: an explicit coarse count overrides the default', () => {
    // Chords here are 4px and 2px, under the 8px chord rule, so no refinement adds samples.
    const a = expectOk(plotFunction(fn1(FLAT), VIEW, { coarse: 200 }));
    expect(a.stats.samples).toBe(200);
    const b = expectOk(plotFunction(fn1(FLAT), VIEW, { coarse: 400 }));
    expect(b.stats.samples).toBe(400);
  }, TIMEOUT);

  it('FC9§2: every coarse sample is evaluated (evals cover the coarse set)', () => {
    const c = counted(fn1(FLAT));
    const p = expectOk(plotFunction(c.wrapped, VIEW));
    expect(p.stats.evals).toBeGreaterThanOrEqual(200);
    expect(c.counts.batchPoints + c.counts.call1).toBeGreaterThanOrEqual(200);
  }, TIMEOUT);

  it('FC9 inputs: devicePixelRatio raises the sampling density', () => {
    const css = expectOk(plotFunction(fn1(FLAT), VIEW));
    const retina = expectOk(plotFunction(fn1(FLAT), { ...VIEW, devicePixelRatio: 2 }));
    expect(retina.stats.samples).toBeGreaterThan(css.stats.samples);
  }, TIMEOUT);

  it('FC9 output: paths stay in CSS pixels when devicePixelRatio is 2', () => {
    const p = expectOk(plotFunction(fn1('x^2 - 2'), { ...VIEW, devicePixelRatio: 2 }));
    for (const path of p.paths) {
      const b = boundsOf(path);
      expect((b?.minX ?? -1) >= -1e-9).toBe(true);
      expect((b?.maxX ?? 1e9) <= VIEW.widthPx + 1e-9).toBe(true);
    }
  }, TIMEOUT);
});

describe('FC9 cache and incremental update: pans reuse samples, versions discard', () => {
  it('FC9§2: cacheKey is stable for the same inputs', () => {
    expect(cacheKey(7, -5, 5, 800)).toBe(cacheKey(7, -5, 5, 800));
  }, TIMEOUT);

  it.each([
    ['version', 8, -5, 5, 800],
    ['x0', 7, -4, 5, 800],
    ['x1', 7, -5, 6, 800],
    ['widthPx', 7, -5, 5, 801],
  ] as [string, number, number, number, number][])('FC9§2: cacheKey changes when %s changes', (_label, v, a, b, w) => {
    expect(cacheKey(v, a, b, w)).not.toBe(cacheKey(7, -5, 5, 800));
  }, TIMEOUT);

  it('FC9 cache: overlapping samples come back as a seed for a pan', () => {
    const cache = createSampleCache();
    const xs = new Float64Array([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
    const ys = new Float64Array([16, 9, 4, 1, 0, 1, 4, 9, 16]);
    cache.put(cacheKey(1, -5, 5, 800), 1, xs, ys);
    expect(cache.size).toBe(1);
    const seed = cache.seedForRange(1, -1, 5);
    expect(seed).toBeDefined();
    for (const x of seed?.xs ?? []) expect(x >= -1 - 1e-12 && x <= 5 + 1e-12).toBe(true);
  }, TIMEOUT);

  it('FC9 cache: a range with no overlap gives no seed', () => {
    const cache = createSampleCache();
    cache.put(cacheKey(1, -5, 5, 800), 1, new Float64Array([-4, 0, 4]), new Float64Array([16, 0, 16]));
    expect(cache.seedForRange(1, 10, 20)).toBeUndefined();
  }, TIMEOUT);

  it('FC9 cache: a version change discards (no seed for another version)', () => {
    const cache = createSampleCache();
    cache.put(cacheKey(1, -5, 5, 800), 1, new Float64Array([0]), new Float64Array([0]));
    expect(cache.seedForRange(2, -5, 5)).toBeUndefined();
  }, TIMEOUT);

  it('FC9 cache: clear drops every entry', () => {
    const cache = createSampleCache();
    cache.put('a', 1, new Float64Array([0]), new Float64Array([0]));
    cache.put('b', 1, new Float64Array([1]), new Float64Array([1]));
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.seedForRange(1, -5, 5)).toBeUndefined();
  }, TIMEOUT);

  it('FC9 cache: at most capacity keys are kept', () => {
    const cache = createSampleCache(2);
    cache.put('a', 1, new Float64Array([0]), new Float64Array([0]));
    cache.put('b', 1, new Float64Array([1]), new Float64Array([1]));
    cache.put('c', 1, new Float64Array([2]), new Float64Array([4]));
    expect(cache.size).toBeLessThanOrEqual(2);
  }, TIMEOUT);

  it('FC9 cache: parametric samples round-trip for a pan', () => {
    const cache = createSampleCache();
    cache.putParam('k', 3, new Float64Array([0, 1, 2]), new Float64Array([1, 0, 0, 1, -1, 0]));
    const seed = cache.paramSeedForRange(3, 0, 2);
    expect(seed).toBeDefined();
    expect(cache.paramSeedForRange(4, 0, 2)).toBeUndefined();
    expect(cache.paramSeedForRange(3, 5, 6)).toBeUndefined();
  }, TIMEOUT);

  it('FC9 cache: a pan reuses seed samples without re-evaluation', () => {
    const v = VIEW;
    const m = Math.max(64, v.widthPx / 4);
    const f = fn1(FLAT);
    const xs = new Float64Array(m);
    for (let i = 0; i < m; i += 1) xs[i] = v.x0 + ((v.x1 - v.x0) * i) / (m - 1);
    const ys = new Float64Array(m);
    (f as unknown as { batch: (xs: Float64Array, out: Float64Array) => void }).batch(xs, ys);
    const seed: SampleSeed = { xs, ys };
    const seeded = counted(fn1(FLAT));
    const withSeed = expectOk(plotFunction(seeded.wrapped, v, { seed }));
    const plain = counted(fn1(FLAT));
    const withoutSeed = expectOk(plotFunction(plain.wrapped, v));
    const saved = withoutSeed.stats.evals - withSeed.stats.evals;
    expect(saved >= m - 1 && saved <= m + 1, `saved ${saved} of ${m} coarse evals`).toBe(true);
    for (const x of xs) {
      expect(seeded.xs1.includes(x), `seed x=${x} re-evaluated via call1`).toBe(false);
      expect(seeded.batchXs.includes(x), `seed x=${x} re-evaluated via batch`).toBe(false);
    }
  }, TIMEOUT);

  it('FC9 cache: seeding changes no geometry (paths identical with and without)', () => {
    const v = VIEW;
    const m = Math.max(64, v.widthPx / 4);
    const f = fn1('sin(x) + x^2/10');
    const xs = new Float64Array(m);
    for (let i = 0; i < m; i += 1) xs[i] = v.x0 + ((v.x1 - v.x0) * i) / (m - 1);
    const ys = new Float64Array(m);
    (f as unknown as { batch: (xs: Float64Array, out: Float64Array) => void }).batch(xs, ys);
    const a = expectOk(plotFunction(fn1('sin(x) + x^2/10'), v, { seed: { xs, ys } }));
    const b = expectOk(plotFunction(fn1('sin(x) + x^2/10'), v));
    expect(a.paths.length).toBe(b.paths.length);
    for (let i = 0; i < a.paths.length; i += 1) {
      expect(Array.from(a.paths[i] ?? [])).toEqual(Array.from(b.paths[i] ?? []));
    }
    expect(a.markers).toEqual(b.markers);
  }, TIMEOUT);
});
