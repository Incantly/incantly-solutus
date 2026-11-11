/**
 * Function plotter: screen-space refinement and suspicious pairs.
 *
 * Docs: `docs/features/functions-calculus/design.md` section 9 steps 3-4
 * (midpoint-to-chord 0.25px, chord length 8px, depth limit 14, evaluation
 * counting, single-evaluation reuse, suspicious-pair criteria).
 */
import { describe, expect, it } from 'vitest';
import { plotFunction } from '@incantly/plot';
import type { ScalarBox, ScalarEnclosure } from '@incantly/plot';
import {
  HEAVY_TIMEOUT,
  TIMEOUT,
  VIEW,
  counted,
  expectOk,
  fn1,
  forgedScalar,
  markersOf,
  maxSegPx,
  pairs,
  pxOf,
  pyOf,
} from './helpers';

const STEEP_SMOOTH = 'atan(50*x)';
const PEAK = 'exp(-80*x^2)';

describe('FC9 step 3: split when the midpoint misses the chord by 0.25px', () => {
  it('FC9§3: a sharp peak refines (deep near the feature, shallow elsewhere)', () => {
    const p = expectOk(plotFunction(fn1(PEAK), VIEW));
    expect(p.stats.maxDepth).toBeGreaterThan(0);
    const pts = pairs(p.paths[0] ?? new Float64Array(0));
    const near = pts.filter((q) => Math.abs(q.x - pxOf(VIEW, 0)) < 20);
    expect(near.length).toBeGreaterThan(10);
  }, TIMEOUT);

  it('FC9§3: a flat stretch is not refined past the chord rule', () => {
    const p = expectOk(plotFunction(fn1('0.1*x+1'), VIEW));
    expect(p.stats.maxDepth).toBe(0);
    expect(p.stats.samples).toBe(200);
  }, TIMEOUT);

  it('FC9§3: a looser bend threshold refines less (chord neutralised)', () => {
    // The peak's 4px-span deviation (~3px) splits at 0.25px but not at 10px.
    const def = expectOk(plotFunction(fn1(PEAK), VIEW, { chordPx: 1000 }));
    const loose = expectOk(plotFunction(fn1(PEAK), VIEW, { chordPx: 1000, bendPx: 10 }));
    expect(loose.stats.samples).toBeLessThan(def.stats.samples);
  }, TIMEOUT);

  it('FC9§3: a tighter bend threshold refines more (chord neutralised)', () => {
    const def = expectOk(plotFunction(fn1(PEAK), VIEW, { chordPx: 1000 }));
    const tight = expectOk(plotFunction(fn1(PEAK), VIEW, { chordPx: 1000, bendPx: 0.01 }));
    expect(tight.stats.samples).toBeGreaterThan(def.stats.samples);
  }, TIMEOUT);

  it('FC9§3: segments are short near a corner and long in flat stretches', () => {
    const p = expectOk(plotFunction(fn1('abs(x)'), VIEW));
    const pts = pairs(p.paths[0] ?? new Float64Array(0));
    const segs: { len: number; mid: number }[] = [];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a === undefined || b === undefined) continue;
      segs.push({ len: Math.hypot(b.x - a.x, b.y - a.y), mid: (a.x + b.x) / 2 });
    }
    const near = segs.filter((s) => Math.abs(s.mid - pxOf(VIEW, 0)) < 8);
    const far = segs.filter((s) => Math.abs(s.mid - pxOf(VIEW, 0)) > 200);
    expect(near.length > 0 && far.length > 0).toBe(true);
    expect(Math.min(...near.map((s) => s.len))).toBeLessThan(Math.max(...far.map((s) => s.len)));
  }, TIMEOUT);

  it('FC9 budgets: a smooth curve costs far below the 20,000 hard-case budget', () => {
    const p = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW));
    expect(p.stats.evals).toBeLessThan(2000);
  }, TIMEOUT);

  it('FC9§3: refinement resolves a narrow peak instead of stepping over it', () => {
    const p = expectOk(plotFunction(fn1(PEAK), VIEW));
    const pts = pairs(p.paths[0] ?? new Float64Array(0));
    const top = pts.reduce((a, b) => ((a?.y ?? Infinity) < (b.y ?? Infinity) ? a : b), pts[0]);
    // The peak value 1 sits 60px above f(±5)≈0; a stepped-over peak would miss it by pixels.
    expect(top).toBeDefined();
    expect(Math.abs((top?.y ?? -1) - pyOf(VIEW, 1)) < 3).toBe(true);
  }, TIMEOUT);

  it('FC9§3: a steep smooth rise refines but stays one connected path', () => {
    const p = expectOk(plotFunction(fn1(STEEP_SMOOTH), VIEW));
    expect(p.paths.length).toBe(1);
    expect(p.stats.maxDepth).toBeGreaterThan(0);
  }, TIMEOUT);
});

describe('FC9 step 3: split when the chord exceeds 8px', () => {
  it.each(['x^2 - 2', 'sin(x)', '0.1*x+1', 'abs(x)'])('FC9§3: output chords stay under the 8px rule (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    for (const path of p.paths) expect(maxSegPx(path) <= 9, `chord ${maxSegPx(path)}px`).toBe(true);
  }, TIMEOUT);

  it('FC9§3: a looser chord threshold refines less (bend neutralised)', () => {
    // 64 coarse spans are ~12.7px: they split at 8px but not at 100px.
    const def = expectOk(plotFunction(fn1(FLAT_FN), VIEW, { coarse: 64, bendPx: 1000 }));
    const loose = expectOk(plotFunction(fn1(FLAT_FN), VIEW, { coarse: 64, bendPx: 1000, chordPx: 100 }));
    expect(loose.stats.samples).toBe(64);
    expect(loose.stats.samples).toBeLessThan(def.stats.samples);
  }, TIMEOUT);

  it('FC9§3: a tighter chord threshold refines more', () => {
    const def = expectOk(plotFunction(fn1(FLAT_FN), VIEW));
    const tight = expectOk(plotFunction(fn1(FLAT_FN), VIEW, { chordPx: 1 }));
    expect(tight.stats.samples).toBeGreaterThan(def.stats.samples);
  }, TIMEOUT);

  it('FC9§3: long coarse spans split down to the chord rule', () => {
    const p = expectOk(plotFunction(fn1(FLAT_FN), VIEW, { coarse: 64 }));
    expect(p.stats.samples).toBeGreaterThan(64);
    for (const path of p.paths) expect(maxSegPx(path) <= 9).toBe(true);
  }, TIMEOUT);

  it('FC9§3: the depth option caps refinement depth', () => {
    const p = expectOk(plotFunction(fn1('sin(1/x)'), { x0: -1, x1: 1, y0: -2, y1: 2, widthPx: 800, heightPx: 600 }, { depth: 2 }));
    expect(p.stats.maxDepth).toBeLessThanOrEqual(2);
  }, TIMEOUT);
});

const FLAT_FN = '0.1*x+1';

describe('FC9 step 3: depth limit 14, counted in evaluations, never time', () => {
  it.each(['sin(1/x)', '1/x', 'tan(x)', 'sqrt(x)', 'floor(x)'])('FC9§3: depth never passes 14 (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    expect(p.stats.maxDepth).toBeLessThanOrEqual(14);
  }, TIMEOUT);

  it('FC9§3: the evaluation count is deterministic (same inputs, same count)', () => {
    const a = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW));
    const b = expectOk(plotFunction(fn1('sin(x) + x^2/10'), VIEW));
    expect(b.stats.evals).toBe(a.stats.evals);
  }, TIMEOUT);

  it('FC9§3: the evaluation count is deterministic on a hard curve', () => {
    const v = { x0: -1, x1: 1, y0: -2, y1: 2, widthPx: 800, heightPx: 600 };
    const a = expectOk(plotFunction(fn1('sin(1/x)'), v));
    const b = expectOk(plotFunction(fn1('sin(1/x)'), v));
    expect(b.stats.evals).toBe(a.stats.evals);
    expect(b.stats.intervalEvals).toBe(a.stats.intervalEvals);
  }, HEAVY_TIMEOUT);

  it('FC9§3: stats.evals honestly counts real evaluations (flat curve)', () => {
    const c = counted(fn1(FLAT_FN));
    const p = expectOk(plotFunction(c.wrapped, VIEW));
    expect(p.stats.evals).toBe(c.counts.call1 + c.counts.batchPoints + c.counts.call);
  }, TIMEOUT);

  it('FC9§3: stats.evals honestly counts real evaluations (refined curve)', () => {
    const c = counted(fn1('sin(x) + x^2/10'));
    const p = expectOk(plotFunction(c.wrapped, VIEW));
    expect(p.stats.evals).toBe(c.counts.call1 + c.counts.batchPoints + c.counts.call);
  }, TIMEOUT);
});

describe('FC9 step 3: each point is evaluated once (stack reuse)', () => {
  it('FC9§3: no x is evaluated twice on a smooth curve', () => {
    const c = counted(fn1('sin(x) + x^2/10'));
    expectOk(plotFunction(c.wrapped, VIEW));
    const all = [...c.xs1, ...c.batchXs];
    expect(new Set(all).size).toBe(all.length);
  }, TIMEOUT);

  it('FC9§1+§3: with breaks, each piece evaluates its own samples once (ends shared at most twice)', () => {
    // Reading: "each piece is plotted on its own" (§1) gives each adjacent piece
    // its own end evaluation, while "evaluating each point once" (§3) holds
    // inside a piece. So break xs appear at most twice, every other x exactly once.
    const breaks = [-1, 2];
    const c = counted(fn1('x^2'));
    expectOk(plotFunction(c.wrapped, VIEW, { breaks }));
    const counts = new Map<number, number>();
    for (const x of [...c.xs1, ...c.batchXs]) counts.set(x, (counts.get(x) ?? 0) + 1);
    for (const [x, n] of counts) {
      const limit = breaks.includes(x) ? 2 : 1;
      expect(n <= limit, `x=${x} evaluated ${n} times`).toBe(true);
    }
  }, TIMEOUT);

  it('FC9§3: no x is evaluated twice under a restricted domain', () => {
    const c = counted(fn1('x^2'));
    expectOk(plotFunction(c.wrapped, VIEW, { domain: [{ lo: -2, hi: 3, loOpen: false, hiOpen: false }] }));
    const all = [...c.xs1, ...c.batchXs];
    expect(new Set(all).size).toBe(all.length);
  }, TIMEOUT);

  it('FC9§3: batch and single evaluations never overlap', () => {
    const c = counted(fn1('sin(1/x)'));
    expectOk(plotFunction(c.wrapped, { x0: -1, x1: 1, y0: -2, y1: 2, widthPx: 800, heightPx: 600 }));
    const singles = new Set(c.xs1);
    for (const x of c.batchXs) expect(singles.has(x), `x=${x} evaluated twice`).toBe(false);
  }, HEAVY_TIMEOUT);
});

describe('FC9 step 4: suspicious pairs (non-finite ends, huge chords, depth limit)', () => {
  // A forged double: x^2 with a NaN hole on [1, 2] (the kernel never yields one
  // stretch of NaN in the middle of a defined function, so this is forged).
  const nanGap = (): { f: ReturnType<typeof forgedScalar>; enc: ScalarEnclosure } => {
    const f = forgedScalar(fn1('x^2'), (x) => (x >= 1 && x <= 2 ? Number.NaN : x * x));
    const enc: ScalarEnclosure = (lo, hi): ScalarBox => {
      if (hi < 1 || lo > 2) {
        const a = lo * lo;
        const b = hi * hi;
        return { lo: Math.min(a, b), hi: Math.max(a, b), def: 2 };
      }
      if (lo >= 1 && hi <= 2) return { lo: 0, hi: 0, def: 0 };
      return { lo: 0, hi: Math.max(lo * lo, hi * hi), def: 1 };
    };
    return { f, enc };
  };

  it('FC9§4+§5: a non-finite stretch with def 0 becomes a gap (two paths)', () => {
    const { f, enc } = nanGap();
    const p = expectOk(plotFunction(f, VIEW, { enclosure: enc }));
    expect(p.paths.length).toBe(2);
    expect(p.stats.rigorous).toBe(true);
  }, TIMEOUT);

  it('FC9§4: a non-finite stretch without an enclosure still completes and says so', () => {
    const { f } = nanGap();
    const p = expectOk(plotFunction(f, VIEW));
    expect(p.stats.complete).toBe(true);
    expect(p.stats.rigorous).toBe(false);
  }, TIMEOUT);

  it('FC9§4: a tall continuous slope is drawn through with no break', () => {
    const p = expectOk(plotFunction(fn1(STEEP_SMOOTH), VIEW));
    expect(p.paths.length).toBe(1);
  }, TIMEOUT);

  it('FC9§4: a tall continuous slope earns no markers', () => {
    const p = expectOk(plotFunction(fn1(STEEP_SMOOTH), VIEW));
    expect(p.markers).toEqual([]);
  }, TIMEOUT);

  it('FC9§4: a tall continuous slope needs no verification (rigorous without enclosure)', () => {
    const p = expectOk(plotFunction(fn1(STEEP_SMOOTH), VIEW));
    expect(p.stats.rigorous).toBe(true);
  }, TIMEOUT);

  it.each(['sin(1/x)', 'tan(x)', '1/x'])('FC9§4: depth-limit spans still complete (%s)', (body) => {
    const p = expectOk(plotFunction(fn1(body), VIEW));
    expect(p.stats.complete).toBe(true);
  }, HEAVY_TIMEOUT);
});
