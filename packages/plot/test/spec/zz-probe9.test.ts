/** TEMP PROBE 9 - deleted before commit. Resume convergence + cap hitters. */
import { describe, expect, it } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';
import type { FunctionValue } from '@incantly/kernel';
import { plotFunction, resumeFunctionPlot } from '@incantly/plot';

describe('probe9', () => {
  it('resume data', () => {
    const fig = new ScratchFigure();
    const r = fig.apply('f(x) = sin(1/x)');
    if (!r.ok) throw new Error('def failed');
    const f = fig.valueOf('f') as FunctionValue;
    const v = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
    const direct = plotFunction(f, v);
    if (direct.ok) console.log(`direct: evals=${direct.value.stats.evals} paths=${direct.value.paths.length} ink=${direct.value.inkColumns.length} markers=${direct.value.markers.length}`);
    let cur = plotFunction(f, v, { maxEvals: 300 });
    for (let i = 0; i < 12; i += 1) {
      if (!cur.ok) { console.log(`slice ${i}: ERR`); break; }
      console.log(`slice ${i}: complete=${String(cur.value.stats.complete)} evals=${cur.value.stats.evals} pending=${cur.value.resume === undefined ? 0 : cur.value.resume.pending.length}`);
      if (cur.value.stats.complete || cur.value.resume === undefined) break;
      cur = resumeFunctionPlot(cur.value.resume, f, { maxEvals: 300 });
    }
    expect(true).toBe(true);
  });
  it('cap hitters', () => {
    const fig = new ScratchFigure();
    const t = fig.apply('tn(x) = tan(x)');
    if (!t.ok) throw new Error('def failed');
    const tan = fig.valueOf('tn') as FunctionValue;
    const wide = { x0: -40, x1: 40, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
    const p = plotFunction(tan, wide, { maxSamples: 60000 });
    console.log(`tan-wide uncapped: ${p.ok ? `samples=${p.value.stats.samples} evals=${p.value.stats.evals} complete=${String(p.value.stats.complete)}` : `ERR ${p.kind}`}`);
    const s = fig.apply('sm(x) = sin(x) + x^2/10');
    if (!s.ok) throw new Error('def failed');
    const sm = fig.valueOf('sm') as FunctionValue;
    const v = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
    const c = plotFunction(sm, v, { coarse: 5000 });
    console.log(`coarse5000: ${c.ok ? `samples=${c.value.stats.samples} capped=${String(c.value.stats.capped)} complete=${String(c.value.stats.complete)}` : `ERR ${c.kind}`}`);
    expect(true).toBe(true);
  });
});
