/** TEMP PROBE 10 - deleted before commit. Param heuristic markers. */
import { describe, expect, it } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';
import { traceParamCurve } from '@incantly/plot';

describe('probe10', () => {
  it('marker data', () => {
    const fig = new ScratchFigure();
    fig.apply('a(s) = (1/s, s)');
    fig.apply('b(s) = (sqrt(s), s)');
    const V = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
    for (const [n, lo, hi] of [['a', -2, 2], ['b', -2, 2]] as const) {
      const p = traceParamCurve({ fn: fig.valueOf(n) as never, lo, hi }, V);
      if (!p.ok) {
        console.log(n, 'ERR', p.kind);
        continue;
      }
      const kinds: Record<string, number> = {};
      for (const m of p.value.markers) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
      console.log(`${n} paths=${p.value.paths.length} markers=${JSON.stringify(kinds)} rigorous=${String(p.value.stats.rigorous)} evals=${p.value.stats.evals}`);
    }
    expect(true).toBe(true);
  });
});
