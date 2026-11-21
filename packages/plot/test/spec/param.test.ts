/**
 * Parametric curve tracer.
 *
 * Docs: `docs/features/curves-loci/design.md` section 5 (definition and
 * range, closed curves within 1e-9 of the scale, the tracer: culling,
 * max(64, widthPx/6) coarse samples, chord/bend/12-degree refinement to
 * depth 14, gap/pole/hole verdicts, cusps past 120 degrees, markers for
 * cusp/end/singular points, output stability, time targets).
 * Queries (Derivative, Slope, Tangent, Length, Closest, ...) are kernel-side
 * and not plotted here; see the test report.
 */
import { describe, expect, it } from 'vitest';
import { traceParamCurve } from '@incantly/plot';
import type { ParamBox, ParamEnclosure } from '@incantly/plot';
import {
  HEAVY_TIMEOUT,
  TIMEOUT,
  VIEW,
  boundsOf,
  ellipseParamEnc,
  expectFiniteMarkers,
  expectMarkerMapping,
  expectOk,
  markersOf,
  pairs,
  pointFn,
  pxOf,
  pyOf,
  viewWidth,
  xOfPx,
  yOfPy,
} from './helpers';

const TAU = 2 * Math.PI;
const HEART_X = '16*sin(s)^3/4';
const HEART_Y = '(13*cos(s)-5*cos(2*s)-2*cos(3*s)-cos(4*s))/4';

describe('CL5 definition: ranges, polar form, closed curves', () => {
  it('CL5: a circle over 0..tau is flagged closed', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 0, hi: TAU }, VIEW));
    expect(p.paths.length).toBe(1);
    expect(p.closed).toEqual([true]);
  }, TIMEOUT);

  it('CL5: ends meeting within 1e-9 of the scale still close', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 0, hi: TAU + 1e-10 }, VIEW));
    expect(p.closed).toEqual([true]);
  }, TIMEOUT);

  it('CL5: ends further apart than 1e-9 of the scale stay open', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 0, hi: TAU + 1e-6 }, VIEW));
    expect(p.closed).toEqual([false]);
  }, TIMEOUT);

  it('CL5: an open spiral is not closed', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('s*cos(s)/10', 's*sin(s)/10'), lo: 0, hi: 20 }, VIEW));
    expect(p.closed).toEqual([false]);
  }, TIMEOUT);

  it('CL5 Polar: a rose closes over one turn', () => {
    // Polar(sin(3t), t, 0, tau) rewritten as a pair, per the design.
    const p = expectOk(traceParamCurve({ fn: pointFn('sin(3*s)*cos(s)', 'sin(3*s)*sin(s)'), lo: 0, hi: TAU }, VIEW));
    expect(p.closed).toEqual([true]);
  }, TIMEOUT);

  it('CL5 Polar: the rose reaches its full extent', () => {
    // r = sin(3t) peaks at radius 1 (at t = pi/6, ...); petals pass through the pole.
    const p = expectOk(traceParamCurve({ fn: pointFn('sin(3*s)*cos(s)', 'sin(3*s)*sin(s)'), lo: 0, hi: TAU }, VIEW));
    let maxR = 0;
    let minR = Infinity;
    for (const pt of pairs(p.paths[0] ?? new Float64Array(0))) {
      const r = Math.hypot(xOfPx(VIEW, pt.x), yOfPy(VIEW, pt.y));
      if (r > maxR) maxR = r;
      if (r < minR) minR = r;
    }
    expect(maxR).toBeGreaterThan(0.95);
    expect(minR).toBeLessThan(0.05);
  }, TIMEOUT);

  it('CL5 Polar: a negative radius passes through the pole without breaking', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('sin(3*s)*cos(s)', 'sin(3*s)*sin(s)'), lo: 0, hi: TAU }, VIEW));
    expect(p.paths.length).toBe(1);
  }, TIMEOUT);

  it('CL5 output: one closed flag per path', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 0, hi: TAU }, VIEW));
    expect(p.closed.length).toBe(p.paths.length);
    for (const c of p.closed) expect(typeof c).toBe('boolean');
  }, TIMEOUT);

  it('CL5: an open range marks both ends', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('s', '0.1*s'), lo: -5, hi: 5 }, VIEW));
    const ends = markersOf(p.markers, 'end');
    expect(ends.length).toBe(2);
    expect(ends.some((m) => Math.abs(m.px - pxOf(VIEW, -5)) < 1)).toBe(true);
    expect(ends.some((m) => Math.abs(m.px - pxOf(VIEW, 5)) < 1)).toBe(true);
    for (const m of ends) expectMarkerMapping(VIEW, m);
  }, TIMEOUT);

  it('CL5 + ui§1: a closed curve has no end markers', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: 0, hi: TAU }, VIEW));
    expect(markersOf(p.markers, 'end')).toEqual([]);
  }, TIMEOUT);

  it('CL5 seed: kept samples are reused without re-evaluation', () => {
    const v = VIEW;
    const m = Math.max(64, Math.floor(v.widthPx / 6));
    const ss = new Float64Array(m);
    for (let i = 0; i < m; i += 1) ss[i] = (-5 + (10 * i) / (m - 1));
    const f = pointFn('cos(s)', 'sin(s)');
    const call = (f as unknown as { call: (s: number) => { x: number; y: number } }).call.bind(f);
    const xys = new Float64Array(2 * m);
    for (let i = 0; i < m; i += 1) {
      const q = call(ss[i] ?? 0);
      xys[2 * i] = q.x;
      xys[2 * i + 1] = q.y;
    }
    const seeded = expectOk(traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: -5, hi: 5, seed: { ss, xys } }, v));
    const plain = expectOk(traceParamCurve({ fn: pointFn('cos(s)', 'sin(s)'), lo: -5, hi: 5 }, v));
    expect(seeded.stats.evals).toBeLessThan(plain.stats.evals);
    expect(seeded.paths.length).toBe(plain.paths.length);
  }, TIMEOUT);
});

describe('CL5 tracer: culling drops off-screen boxes before sampling', () => {
  const FAR: typeof VIEW = { x0: 100, x1: 110, y0: 100, y1: 110, widthPx: 800, heightPx: 600 };

  it('CL5§1: a culled curve draws nothing and completes', () => {
    const p = expectOk(traceParamCurve(
      { fn: pointFn('2*cos(s)', 'sin(s)'), lo: 0, hi: TAU, enclosure: ellipseParamEnc(2, 1) },
      FAR,
    ));
    expect(p.paths).toEqual([]);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL5§1: culled boxes cost almost no real evaluations', () => {
    const p = expectOk(traceParamCurve(
      { fn: pointFn('2*cos(s)', 'sin(s)'), lo: 0, hi: TAU, enclosure: ellipseParamEnc(2, 1) },
      FAR,
    ));
    expect(p.stats.evals).toBeLessThanOrEqual(10);
    expect(p.stats.intervalEvals).toBeGreaterThan(0);
  }, TIMEOUT);

  it('CL5§1: culling keeps the on-screen part of a wild curve', () => {
    const spiralEnc: ParamEnclosure = (s0, s1): ParamBox => {
      const r = Math.max(Math.abs(s0), Math.abs(s1)) / 100;
      return { x0: -r, x1: r, y0: -r, y1: r, def: 2 };
    };
    const p = expectOk(traceParamCurve(
      { fn: pointFn('s*cos(s)/100', 's*sin(s)/100'), lo: 0, hi: 1000, enclosure: spiralEnc },
      VIEW,
    ));
    expect(p.stats.complete).toBe(true);
    let near = false;
    for (const path of p.paths) {
      for (const pt of pairs(path)) {
        if (Math.hypot(pt.x - pxOf(VIEW, 0), pt.y - pyOf(VIEW, 0)) < 50) near = true;
      }
    }
    expect(near).toBe(true);
  }, HEAVY_TIMEOUT);

  it('CL5§1: a huge range stays within the evaluation budget', () => {
    const spiralEnc: ParamEnclosure = (s0, s1): ParamBox => {
      const r = Math.max(Math.abs(s0), Math.abs(s1)) / 100;
      return { x0: -r, x1: r, y0: -r, y1: r, def: 2 };
    };
    const p = expectOk(traceParamCurve(
      { fn: pointFn('s*cos(s)/100', 's*sin(s)/100'), lo: 0, hi: 1000, enclosure: spiralEnc },
      VIEW,
    ));
    expect(p.stats.evals).toBeLessThanOrEqual(20000);
  }, HEAVY_TIMEOUT);

  it('CL5§1: without an enclosure the on-screen part is still found', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('s*cos(s)/100', 's*sin(s)/100'), lo: 0, hi: 100 }, VIEW));
    let near = false;
    for (const path of p.paths) {
      for (const pt of pairs(path)) {
        if (Math.hypot(pt.x - pxOf(VIEW, 0), pt.y - pyOf(VIEW, 0)) < 50) near = true;
      }
    }
    expect(near).toBe(true);
    expect(p.stats.complete).toBe(true);
  }, HEAVY_TIMEOUT);
});

describe('CL5 tracer: max(64, widthPx/6) coarse samples, then chord/bend/12-degree refinement', () => {
  it.each([
    [100, 64],
    [400, 67],
    [800, 133],
    [2000, 333],
  ])('CL5§2: width %spx starts from %s coarse samples', (widthPx, coarse) => {
    const p = expectOk(traceParamCurve({ fn: pointFn('s', '0.1*s'), lo: -5, hi: 5 }, viewWidth(widthPx)));
    expect(p.stats.samples).toBe(coarse);
    expect(p.stats.maxDepth).toBe(0);
  }, TIMEOUT);

  it('CL5§2: a curvy heart refines past coarse', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn(HEART_X, HEART_Y), lo: 0, hi: TAU }, VIEW));
    expect(p.stats.maxDepth).toBeGreaterThan(0);
    expect(p.stats.complete).toBe(true);
    expect(p.paths.length).toBe(1);
    expect(p.closed).toEqual([true]);
  }, TIMEOUT);

  it('CL5§2: a wide turn threshold refines less than a tight one', () => {
    const loose = expectOk(traceParamCurve(
      { fn: pointFn(HEART_X, HEART_Y), lo: 0, hi: TAU }, VIEW,
      { chordPx: 1000, bendPx: 1000, turnDegrees: 90 },
    ));
    const tight = expectOk(traceParamCurve(
      { fn: pointFn(HEART_X, HEART_Y), lo: 0, hi: TAU }, VIEW,
      { chordPx: 1000, bendPx: 1000, turnDegrees: 1 },
    ));
    expect(loose.stats.samples).toBeLessThan(tight.stats.samples);
  }, TIMEOUT);

  it('CL5§2: explicit default thresholds reproduce the default run', () => {
    const def = expectOk(traceParamCurve({ fn: pointFn(HEART_X, HEART_Y), lo: 0, hi: TAU }, VIEW));
    const exp = expectOk(traceParamCurve(
      { fn: pointFn(HEART_X, HEART_Y), lo: 0, hi: TAU }, VIEW,
      { bendPx: 0.25, chordPx: 8, turnDegrees: 12, depth: 14, coarse: Math.max(64, Math.floor(VIEW.widthPx / 6)) },
    ));
    expect(exp.stats.samples).toBe(def.stats.samples);
    expect(exp.paths.length).toBe(def.paths.length);
    for (let i = 0; i < def.paths.length; i += 1) {
      expect(Array.from(exp.paths[i] ?? [])).toEqual(Array.from(def.paths[i] ?? []));
    }
  }, TIMEOUT);

  it.each(['(cos(s), sin(s))', 'heart', 'spiral'])('CL5§2: depth never passes 14 (%s)', (which) => {
    const fn = which === 'heart'
      ? pointFn(HEART_X, HEART_Y)
      : which === 'spiral' ? pointFn('s*cos(s)/10', 's*sin(s)/10') : pointFn('cos(s)', 'sin(s)');
    const hi = which === 'spiral' ? 100 : TAU;
    const p = expectOk(traceParamCurve({ fn, lo: 0, hi }, VIEW));
    expect(p.stats.maxDepth).toBeLessThanOrEqual(14);
  }, HEAVY_TIMEOUT);
});

describe('CL5 tracer: undefined values break or mark the curve', () => {
  const invParamEnc: ParamEnclosure = (s0, s1): ParamBox => {
    if (s1 < 0 || s0 > 0) {
      const a = 1 / s0;
      const b = 1 / s1;
      return { x0: Math.min(a, b), x1: Math.max(a, b), y0: Math.min(s0, s1), y1: Math.max(s0, s1), def: 2 };
    }
    return { x0: Number.NEGATIVE_INFINITY, x1: Number.POSITIVE_INFINITY, y0: Math.min(s0, s1), y1: Math.max(s0, s1), def: 1 };
  };

  it('CL5§3: an unbounded enclosure breaks the curve and marks the pole', () => {
    const p = expectOk(traceParamCurve(
      { fn: pointFn('1/s', 's'), lo: -2, hi: 2, enclosure: invParamEnc }, VIEW,
    ));
    expect(p.paths.length).toBeGreaterThanOrEqual(2);
    expect(markersOf(p.markers, 'pole').length).toBeGreaterThanOrEqual(1);
    expect(p.stats.rigorous).toBe(true);
    expectFiniteMarkers(p);
  }, TIMEOUT);

  it('CL5§3: an infinite branch continues to the view edge', () => {
    const p = expectOk(traceParamCurve(
      { fn: pointFn('1/s', 's'), lo: -2, hi: 2, enclosure: invParamEnc }, VIEW,
    ));
    const reachesEdge = p.paths.some((path) => {
      const b = boundsOf(path);
      return b !== undefined && (b.minX <= 1 || b.maxX >= VIEW.widthPx - 1 || b.minY <= 1 || b.maxY >= VIEW.heightPx - 1);
    });
    expect(reachesEdge).toBe(true);
  }, TIMEOUT);

  it('CL5§3: without an enclosure the infinite branch still breaks honestly', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('1/s', 's'), lo: -2, hi: 2 }, VIEW));
    expect(p.stats.complete).toBe(true);
    expect(p.paths.length).toBeGreaterThanOrEqual(2);
    expect(p.stats.rigorous).toBe(false);
    expectFiniteMarkers(p);
  }, TIMEOUT);

  const sqrtParamEnc: ParamEnclosure = (s0, s1): ParamBox => {
    if (s1 < 0) return { x0: 0, x1: 0, y0: s0, y1: s1, def: 0 };
    if (s0 < 0) return { x0: 0, x1: Math.sqrt(s1), y0: s0, y1: s1, def: 1 };
    return { x0: Math.sqrt(s0), x1: Math.sqrt(s1), y0: s0, y1: s1, def: 2 };
  };

  it('CL5§3: def 0 leaves a gap (sqrt draws only for s >= 0)', () => {
    const p = expectOk(traceParamCurve(
      { fn: pointFn('sqrt(s)', 's'), lo: -2, hi: 2, enclosure: sqrtParamEnc }, VIEW,
    ));
    for (const path of p.paths) {
      for (const pt of pairs(path)) expect(yOfPy(VIEW, pt.y) >= -0.05, `vertex at y=${yOfPy(VIEW, pt.y)}`).toBe(true);
    }
    expect(p.stats.rigorous).toBe(true);
  }, TIMEOUT);

  it('CL5§3: the sqrt gap holds without an enclosure, honestly flagged', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('sqrt(s)', 's'), lo: -2, hi: 2 }, VIEW));
    for (const path of p.paths) {
      for (const pt of pairs(path)) expect(yOfPy(VIEW, pt.y) >= -0.05, `vertex at y=${yOfPy(VIEW, pt.y)}`).toBe(true);
    }
    expect(p.stats.rigorous).toBe(false);
  }, TIMEOUT);

  it('CL5§3: a hole-like point joins with a marker', () => {
    const holeParamEnc: ParamEnclosure = (s0, s1): ParamBox => {
      if (s0 <= 1 && 1 <= s1) return { x0: s0 + 1, x1: s1 + 1, y0: s0, y1: s1, def: 1 };
      return { x0: s0 + 1, x1: s1 + 1, y0: s0, y1: s1, def: 2 };
    };
    const p = expectOk(traceParamCurve(
      { fn: pointFn('(s^2-1)/(s-1)', 's'), lo: -2, hi: 3, enclosure: holeParamEnc }, VIEW,
    ));
    expect(p.paths.length).toBe(1);
    const holes = markersOf(p.markers, 'hole');
    expect(holes.length).toBe(1);
    expect(Math.abs((holes[0]?.x ?? 99) - 2) < 0.05 && Math.abs((holes[0]?.y ?? 99) - 1) < 0.05).toBe(true);
  }, TIMEOUT);
});

describe('CL5 tracer: cusps, loops, stability, markers', () => {
  it('CL5§4: a cusp past 120 degrees is marked', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('s^2', 's^3'), lo: -2, hi: 2 }, VIEW));
    const cusps = markersOf(p.markers, 'cusp');
    expect(cusps.length).toBe(1);
    expect(Math.abs((cusps[0]?.x ?? 99) - 0) < 0.05 && Math.abs((cusps[0]?.y ?? 99) - 0) < 0.05).toBe(true);
    expect(p.paths.length).toBe(1);
  }, TIMEOUT);

  it('CL5§5: overlapping loops all stay in the path', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('4*sin(3*s)', '3*sin(4*s)'), lo: 0, hi: TAU }, VIEW));
    const b = boundsOf(p.paths[0] ?? new Float64Array(0));
    expect(Math.abs(xOfPx(VIEW, b?.minX ?? 99) - -4) < 0.2).toBe(true);
    expect(Math.abs(xOfPx(VIEW, b?.maxX ?? -99) - 4) < 0.2).toBe(true);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL5§6: repeat traces are identical', () => {
    const a = expectOk(traceParamCurve({ fn: pointFn('2*cos(s)', 'sin(s)'), lo: 0, hi: TAU }, VIEW));
    const b = expectOk(traceParamCurve({ fn: pointFn('2*cos(s)', 'sin(s)'), lo: 0, hi: TAU }, VIEW));
    expect(b.stats).toEqual(a.stats);
    expect(b.closed).toEqual(a.closed);
    expect(b.markers).toEqual(a.markers);
    for (let i = 0; i < a.paths.length; i += 1) {
      expect(Array.from(b.paths[i] ?? [])).toEqual(Array.from(a.paths[i] ?? []));
    }
  }, TIMEOUT);

  it('CL5§6: repeat traces are identical with an enclosure', () => {
    const input = { fn: pointFn('2*cos(s)', 'sin(s)'), lo: 0, hi: TAU, enclosure: ellipseParamEnc(2, 1) } as const;
    const a = expectOk(traceParamCurve(input, VIEW));
    const b = expectOk(traceParamCurve(input, VIEW));
    expect(b.stats).toEqual(a.stats);
    expect(b.paths.length).toBe(a.paths.length);
  }, TIMEOUT);

  it.each(['circle', 'cusp', 'line'])('CL5 markers stay finite and mapped (%s)', (which) => {
    const fn = which === 'cusp' ? pointFn('s^2', 's^3') : which === 'line' ? pointFn('s', '0.1*s') : pointFn('cos(s)', 'sin(s)');
    const p = expectOk(traceParamCurve({ fn, lo: which === 'line' ? -5 : 0, hi: which === 'line' ? 5 : TAU }, VIEW));
    expectFiniteMarkers(p);
    for (const m of p.markers) expectMarkerMapping(VIEW, m);
  }, TIMEOUT);

  it('CL5 markers: a stalling curve marks the stall as a cusp or singular point', () => {
    // Docs list both kinds without pinning the trigger; either marks the stall honestly.
    const p = expectOk(traceParamCurve({ fn: pointFn('s^3', 's^3'), lo: -2, hi: 2 }, VIEW));
    expect(p.paths.length).toBe(1);
    const near = p.markers.filter(
      (m) => (m.kind === 'cusp' || m.kind === 'singular') && Math.abs(m.x) < 0.1 && Math.abs(m.y) < 0.1,
    );
    expect(near.length).toBeGreaterThanOrEqual(1);
  }, TIMEOUT);

  it('CL5: smooth traces without verdicts are rigorous', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn('2*cos(s)', 'sin(s)'), lo: 0, hi: TAU }, VIEW));
    expect(p.stats.rigorous).toBe(true);
  }, TIMEOUT);
});

describe('CL5 budgets, exhaustion and targets', () => {
  it('CL5 budgets: an explicit sample cap binds the output', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn(HEART_X, HEART_Y), lo: 0, hi: TAU }, VIEW, { maxSamples: 100 }));
    expect(p.stats.samples).toBeLessThanOrEqual(100);
    expect(p.stats.capped).toBe(true);
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it('CL5 budgets: the default cap is 4,000 samples', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn(HEART_X, HEART_Y), lo: 0, hi: TAU }, VIEW, { coarse: 5000 }));
    expect(p.stats.samples).toBeLessThanOrEqual(4000);
    expect(p.stats.capped).toBe(true);
  }, TIMEOUT);

  it('CL5 budgets: exhausting maxEvals reports incomplete with empty output', () => {
    const p = expectOk(traceParamCurve({ fn: pointFn(HEART_X, HEART_Y), lo: 0, hi: TAU }, VIEW, { maxEvals: 100 }));
    expect(p.stats.complete).toBe(false);
    expect(p.paths).toEqual([]);
  }, TIMEOUT);

  it('CL5 budgets: a larger budget completes after exhaustion', () => {
    const first = expectOk(traceParamCurve({ fn: pointFn(HEART_X, HEART_Y), lo: 0, hi: TAU }, VIEW, { maxEvals: 100 }));
    expect(first.stats.complete).toBe(false);
    const done = expectOk(traceParamCurve({ fn: pointFn(HEART_X, HEART_Y), lo: 0, hi: TAU }, VIEW, { maxEvals: 50000 }));
    expect(done.stats.complete).toBe(true);
    expect(done.paths.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it.each([
    ['heart (target 0.3ms)', HEART_X, HEART_Y, 0, TAU],
    ['Lissajous, 6 loops (target 0.8ms)', '4*sin(3*s)', '3*sin(2*s)', 0, TAU],
  ])('CL5 targets: %s completes within budget', (_label, xb, yb, lo, hi) => {
    const t0 = performance.now();
    const p = expectOk(traceParamCurve({ fn: pointFn(xb, yb), lo, hi }, VIEW));
    const ms = performance.now() - t0;
    expect(p.stats.complete).toBe(true);
    expect(p.stats.evals).toBeLessThanOrEqual(20000);
    expect(ms).toBeLessThan(5000);
  }, HEAVY_TIMEOUT);

  it('CL5 targets: s in 0..1000 spiral (target 1.5ms) completes within budget', { retry: 2, timeout: HEAVY_TIMEOUT }, () => {
    const spiralEnc: ParamEnclosure = (s0, s1): ParamBox => {
      const r = Math.max(Math.abs(s0), Math.abs(s1)) / 100;
      return { x0: -r, x1: r, y0: -r, y1: r, def: 2 };
    };
    const t0 = performance.now();
    const p = expectOk(traceParamCurve(
      { fn: pointFn('s*cos(s)/100', 's*sin(s)/100'), lo: 0, hi: 1000, enclosure: spiralEnc }, VIEW,
    ));
    const ms = performance.now() - t0;
    expect(p.stats.complete).toBe(true);
    expect(p.stats.evals).toBeLessThanOrEqual(20000);
    expect(ms).toBeLessThan(5000);
  });
});
