/**
 * Function plotter: sub-pixel oscillation, path emission, result shape, exact band.
 *
 * Docs: `docs/features/functions-calculus/design.md` section 9 steps 6-7
 * (ink columns for oscillation, pixel polylines, y clipped to [-4h, 5h]) and
 * "Interval-arithmetic mode as a user-visible aid" (`with exact = true`).
 */
import { describe, expect, it } from 'vitest';
import { plotFunction } from '@incantly/plot';
import {
  TIMEOUT,
  VIEW,
  VIEW_UNIT,
  boundsOf,
  expectOk,
  fn1,
  holeEnc,
  invEnc,
  pairs,
  pxOf,
  pyOf,
  squareEnc,
  xOfPx,
} from './helpers';

describe('FC9 step 6: sub-pixel oscillation becomes ink columns', () => {
  it('FC9§6: sin(1/x) emits ink columns near 0', () => {
    const p = expectOk(plotFunction(fn1('sin(1/x)'), VIEW_UNIT));
    expect(p.inkColumns.length).toBeGreaterThan(0);
  }, TIMEOUT);

  it('FC9§6: ink columns are clipped to the view', () => {
    const p = expectOk(plotFunction(fn1('sin(1/x)'), VIEW_UNIT));
    for (const c of p.inkColumns) {
      expect(c.x >= 0 && c.x <= VIEW_UNIT.widthPx, `column x=${c.x}`).toBe(true);
      expect(c.y0 <= c.y1, `column [${c.y0}, ${c.y1}]`).toBe(true);
      expect(c.y0 >= 0 && c.y1 <= VIEW_UNIT.heightPx, `column [${c.y0}, ${c.y1}]`).toBe(true);
    }
  }, TIMEOUT);

  it('FC9§6: oscillation columns cluster where the oscillation lives', () => {
    const p = expectOk(plotFunction(fn1('sin(1/x)'), VIEW_UNIT));
    const cx = pxOf(VIEW_UNIT, 0);
    for (const c of p.inkColumns) expect(Math.abs(c.x - cx) < 200, `column at ${c.x}`).toBe(true);
    expect(p.inkColumns.some((c) => Math.abs(c.x - cx) < 20)).toBe(true);
  }, TIMEOUT);

  it('FC9§6: oscillation columns span the amplitude, not a sawtooth', () => {
    const p = expectOk(plotFunction(fn1('sin(1/x)'), VIEW_UNIT));
    const full = Math.abs(pyOf(VIEW_UNIT, 1) - pyOf(VIEW_UNIT, -1));
    for (const c of p.inkColumns) expect(c.y1 - c.y0 <= full + 2, `column height ${c.y1 - c.y0}`).toBe(true);
    expect(p.inkColumns.some((c) => c.y1 - c.y0 >= full / 2)).toBe(true);
  }, TIMEOUT);

  it.each(['abs(x)', 'if(x < 0, -x, x^2)'])('FC9§6: a sharp corner is not oscillation (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    expect(p.inkColumns).toEqual([]);
  }, TIMEOUT);

  it('FC9§6: a smooth curve emits no ink', () => {
    const p = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW));
    expect(p.inkColumns).toEqual([]);
  }, TIMEOUT);

  it('FC9§5+§6: a pole is a break, never oscillation (certain path)', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW, { enclosure: invEnc }));
    expect(p.inkColumns).toEqual([]);
  }, TIMEOUT);
});

describe('FC9 step 7: pixel polylines, y clipped to [-4h, 5h]', () => {
  it('FC9 output: paths are Float64Arrays of x,y pairs', () => {
    const p = expectOk(plotFunction(fn1('x^2 - 2'), VIEW));
    expect(Array.isArray(p.paths)).toBe(true);
    for (const path of p.paths) {
      expect(path).toBeInstanceOf(Float64Array);
      expect(path.length % 2).toBe(0);
      expect(path.length >= 2).toBe(true);
    }
  }, TIMEOUT);

  it.each(['x^4', '-x^4', '1/x', 'tan(x)'])('FC9§7: path y stays inside [-4h, 5h] (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    for (const path of p.paths) {
      for (const pt of pairs(path)) {
        expect(pt.y >= -4 * VIEW.heightPx - 1e-9 && pt.y <= 5 * VIEW.heightPx + 1e-9, `y=${pt.y}`).toBe(true);
      }
    }
  }, TIMEOUT);

  it('FC9§7: deep valleys reach the lower clip bound', () => {
    const p = expectOk(plotFunction(fn1('x^4'), VIEW));
    let min = Infinity;
    for (const path of p.paths) for (const pt of pairs(path)) if (pt.y < min) min = pt.y;
    expect(min <= -4 * VIEW.heightPx + 1, `min y=${min}`).toBe(true);
  }, TIMEOUT);

  it('FC9§7: high peaks reach the upper clip bound', () => {
    const p = expectOk(plotFunction(fn1('-x^4'), VIEW));
    let max = -Infinity;
    for (const path of p.paths) for (const pt of pairs(path)) if (pt.y > max) max = pt.y;
    expect(max >= 5 * VIEW.heightPx - 1, `max y=${max}`).toBe(true);
  }, TIMEOUT);

  it.each(['x^2 - 2', 'sin(x)', 'abs(x)'])('FC9§7: y = f(x) vertices run left to right (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    for (const path of p.paths) {
      const pts = pairs(path);
      for (let i = 1; i < pts.length; i += 1) {
        expect((pts[i]?.x ?? -1) >= (pts[i - 1]?.x ?? 0) - 1e-9).toBe(true);
      }
    }
  }, TIMEOUT);

  it.each(['x^2 - 2', 'sin(x)', 'abs(x)'])('FC9§7: path x stays inside the view (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    for (const path of p.paths) {
      const b = boundsOf(path);
      expect((b?.minX ?? -99) >= -1).toBe(true);
      expect((b?.maxX ?? 1e9) <= VIEW.widthPx + 1).toBe(true);
    }
  }, TIMEOUT);

  it.each(['x^2 - 2', 'sin(x)'])('FC9§3+§7: consecutive samples join with short chords (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    for (const path of p.paths) {
      const pts = pairs(path);
      for (let i = 1; i < pts.length; i += 1) {
        const a = pts[i - 1];
        const b = pts[i];
        if (a === undefined || b === undefined) continue;
        expect(Math.hypot(b.x - a.x, b.y - a.y) <= 9).toBe(true);
      }
    }
  }, TIMEOUT);
});

describe('FC9 output: the PlotResult shape and its stats', () => {
  it('FC9 output: paths, markers, inkColumns and stats are always present', () => {
    const p = expectOk(plotFunction(fn1('x^2 - 2'), VIEW));
    expect(Array.isArray(p.paths)).toBe(true);
    expect(Array.isArray(p.markers)).toBe(true);
    expect(Array.isArray(p.inkColumns)).toBe(true);
    expect(typeof p.stats).toBe('object');
    for (const k of ['evals', 'intervalEvals', 'maxDepth', 'complete', 'capped', 'rigorous', 'samples'] as const) {
      expect(p.stats[k]).not.toBeUndefined();
    }
    expect(Number.isInteger(p.stats.evals) && p.stats.evals >= 0).toBe(true);
    expect(Number.isInteger(p.stats.intervalEvals) && p.stats.intervalEvals >= 0).toBe(true);
    expect(Number.isInteger(p.stats.maxDepth) && p.stats.maxDepth >= 0).toBe(true);
    expect(typeof p.stats.complete).toBe('boolean');
    expect(typeof p.stats.capped).toBe('boolean');
    expect(typeof p.stats.rigorous).toBe('boolean');
    expect(Number.isInteger(p.stats.samples) && p.stats.samples >= 0).toBe(true);
  }, TIMEOUT);

  it.each(['x^2 - 2', 'sin(x)', '1/x'])('FC9 output: stats.samples counts the output points (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    let n = 0;
    for (const path of p.paths) n += path.length / 2;
    expect(p.stats.samples).toBe(n);
  }, TIMEOUT);

  it('FC9 output: stats.evals covers at least the output samples (no seed)', () => {
    const p = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW));
    expect(p.stats.evals).toBeGreaterThanOrEqual(p.stats.samples);
  }, TIMEOUT);

  it.each(['x^2 - 2', '1/x', '(x^2-1)/(x-1)', 'sqrt(x)'])('FC9 output: ordinary plots complete (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    expect(p.stats.complete).toBe(true);
  }, TIMEOUT);

  it.each(['x^2 - 2', '1/x', 'tan(x)'])('FC9 output: no interval work happens without an enclosure (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    expect(p.stats.intervalEvals).toBe(0);
  }, TIMEOUT);

  it('FC9 output: empty plots still carry the full shape', () => {
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { domain: [] }));
    expect(p.paths).toEqual([]);
    expect(p.markers).toEqual([]);
    expect(p.inkColumns).toEqual([]);
    expect(p.stats.complete).toBe(true);
    expect(p.stats.samples).toBe(0);
  }, TIMEOUT);
});

describe('FC9 exact band: with exact = true the enclosure draws instead', () => {
  it('FC9 exact: with an enclosure, columns replace paths', () => {
    const p = expectOk(plotFunction(fn1('x^2 - 2'), VIEW, { exact: true, enclosure: squareEnc }));
    expect(p.paths).toEqual([]);
    expect(p.inkColumns.length).toBeGreaterThan(0);
    expect(p.stats.rigorous).toBe(true);
  }, TIMEOUT);

  it('FC9 exact: band columns are clipped to the view', () => {
    const p = expectOk(plotFunction(fn1('x^2 - 2'), VIEW, { exact: true, enclosure: squareEnc }));
    for (const c of p.inkColumns) {
      expect(c.x >= 0 && c.x <= VIEW.widthPx).toBe(true);
      expect(c.y0 <= c.y1 && c.y0 >= 0 && c.y1 <= VIEW.heightPx).toBe(true);
    }
  }, TIMEOUT);

  it('FC9 exact: the band contains the true curve', () => {
    const p = expectOk(plotFunction(fn1('x^2 - 2'), VIEW, { exact: true, enclosure: squareEnc }));
    let checked = 0;
    for (const c of p.inkColumns) {
      const x = xOfPx(VIEW, c.x);
      const want = pyOf(VIEW, x * x - 2);
      // Clipped columns cannot contain off-view values; only in-view ones must sit inside.
      if (want < 0 || want > VIEW.heightPx) continue;
      checked += 1;
      expect(c.y0 <= want + 1 && want - 1 <= c.y1, `column at px ${c.x}`).toBe(true);
    }
    expect(checked).toBeGreaterThan(0);
  }, TIMEOUT);

  it('FC9 exact: without an enclosure it falls back to the normal curve', () => {
    const p = expectOk(plotFunction(fn1('x^2'), VIEW, { exact: true }));
    expect(p.paths.length).toBe(1);
    expect(p.stats.rigorous).toBe(false);
  }, TIMEOUT);

  it('FC9 exact: the band is off by default', () => {
    const p = expectOk(plotFunction(fn1('x^2'), VIEW));
    expect(p.paths.length).toBe(1);
  }, TIMEOUT);

  it('FC9 exact: a pole shows as full-height band columns', () => {
    const p = expectOk(plotFunction(fn1('1/x'), VIEW, { exact: true, enclosure: invEnc }));
    const near = p.inkColumns.filter((c) => Math.abs(c.x - pxOf(VIEW, 0)) < 2);
    expect(near.length).toBeGreaterThan(0);
    for (const c of near) expect(c.y1 - c.y0 >= 0.8 * VIEW.heightPx).toBe(true);
  }, TIMEOUT);

  it('FC9 exact: a hole band still marks the hole', () => {
    const withBand = expectOk(plotFunction(fn1('(x^2-1)/(x-1)'), VIEW, { exact: true, breaks: [1], enclosure: holeEnc }));
    const plain = expectOk(plotFunction(fn1('(x^2-1)/(x-1)'), VIEW, { breaks: [1], enclosure: holeEnc }));
    expect(withBand.markers).toEqual(plain.markers);
  }, TIMEOUT);
});
