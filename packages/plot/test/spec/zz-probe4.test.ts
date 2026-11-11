/** TEMP PROBE 4 - deleted before commit. Compact histograms. */
import { describe, expect, it } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';
import type { FunctionValue } from '@incantly/kernel';
import { plotFunction } from '@incantly/plot';
import type { FunctionPlot } from '@incantly/plot';

const fig = new ScratchFigure();
let n = 0;
const fn = (body: string): FunctionValue => {
  n += 1;
  const name = `g${n}`;
  const r = fig.apply(`${name}(x) = ${body}`);
  if (!r.ok) throw new Error(`${body}: ${r.kind} ${r.message}`);
  return fig.valueOf(name) as FunctionValue;
};
const V = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
const hist = (p: FunctionPlot): string => {
  const kinds = new Map<string, number>();
  for (const m of p.markers) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
  const finite = p.markers.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.px) && Number.isFinite(m.py));
  return `paths=${p.paths.length} markers=${p.markers.length}[${[...kinds.entries()].map(([k, c]) => `${k}:${c}`).join(',')}] finite=${String(finite)} ink=${p.inkColumns.length} evals=${p.stats.evals} samples=${p.stats.samples} maxDepth=${p.stats.maxDepth} rigorous=${String(p.stats.rigorous)} complete=${String(p.valueOf === undefined ? '?' : p.stats.complete)}`;
};

describe('probe4', () => {
  it('histograms', () => {
    for (const body of ['1/x', '(x^2-1)/(x-1)', 'floor(x)', 'sqrt(x)', 'abs(x)', 'tan(x)', '0.1*x+1']) {
      const p = plotFunction(fn(body), V);
      console.log(`${body}: ${p.ok ? hist(p.value) : `ERR ${p.kind}`}`);
    }
    expect(true).toBe(true);
  });
  it('flat coarse + domain + breaks + exact + clip + sin', () => {
    for (const w of [64, 100, 400, 800, 2000]) {
      const v = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: w, heightPx: 600 };
      const p = plotFunction(fn('0.1*x+1'), v);
      console.log(`flat w=${w}: ${p.ok ? `evals=${p.value.stats.evals} samples=${p.value.stats.samples} depth=${p.value.stats.maxDepth}` : `ERR ${p.kind}`}`);
    }
    const d = plotFunction(fn('x^2'), V, { domain: [{ lo: -2, hi: 3, loOpen: false, hiOpen: true }] });
    console.log(`domain: ${d.ok ? hist(d.value) : `ERR ${d.kind}`}`);
    const b = plotFunction(fn('if(x < 0, -x, x^2)'), V, { breaks: [0] });
    console.log(`breaks: ${b.ok ? hist(b.value) : `ERR ${b.kind}`}`);
    const e = plotFunction(fn('x^2'), V, { exact: true });
    console.log(`exact-noenc: ${e.ok ? hist(e.value) : `ERR ${e.kind}`}`);
    const e2 = plotFunction(fn('x^2'), V, { exact: true, enclosure: (lo, hi) => ({ lo: Math.min(lo * lo, hi * hi), hi: Math.max(lo * lo, hi * hi), def: 2 }) });
    console.log(`exact-enc: ${e2.ok ? hist(e2.value) : `ERR ${e2.kind}`}`);
    const c = plotFunction(fn('x^2'), V);
    if (c.ok) {
      let mn = Infinity;
      let mx = -Infinity;
      for (const path of c.value.paths) for (let i = 1; i < path.length; i += 2) {
        const y = path[i] ?? 0;
        if (y < mn) mn = y;
        if (y > mx) mx = y;
      }
      console.log(`clip: minY=${mn} maxY=${mx} bounds=[${-4 * 600},${5 * 600}]`);
    }
    const s = plotFunction(fn('sin(1/x)'), { x0: -1, x1: 1, y0: -2, y1: 2, widthPx: 800, heightPx: 600 });
    console.log(`sin(1/x): ${s.ok ? hist(s.value) : `ERR ${s.kind}`}`);
    expect(true).toBe(true);
  });
  it('refusals + forged doubles', () => {
    const f = fn('x^2');
    const over1 = plotFunction(f, V, { maxSamples: 100000 });
    console.log(`maxSamples 100000: ${over1.ok ? 'ok' : over1.kind}`);
    const over2 = plotFunction(f, V, { maxEvals: 20000000 });
    console.log(`maxEvals 20000000: ${over2.ok ? 'ok' : over2.kind}`);
    const big = plotFunction(f, { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 20000, heightPx: 600 });
    console.log(`width 20000: ${big.ok ? 'ok' : big.kind}`);
    const throwing = { ...f, call1: (_x: number): number => { throw new Error('boom'); }, batch: (_xs: Float64Array): Float64Array => { throw new Error('boom'); } } as unknown as FunctionValue;
    try {
      const t = plotFunction(throwing, V);
      console.log(`throwing: ${t.ok ? 'ok' : t.kind}`);
    } catch (e) {
      console.log(`throwing THROWS: ${String(e).slice(0, 100)}`);
    }
    const infy = { ...f, call1: (x: number): number => (x > 0 ? Number.POSITIVE_INFINITY : -x), batch: (xs: Float64Array): Float64Array => Float64Array.from(xs, (x) => (x > 0 ? Number.POSITIVE_INFINITY : -x)) } as unknown as FunctionValue;
    try {
      const t2 = plotFunction(infy, V);
      console.log(`infy: ${t2.ok ? hist(t2.value) : t2.kind}`);
    } catch (e) {
      console.log(`infy THROWS: ${String(e).slice(0, 100)}`);
    }
    expect(true).toBe(true);
  });
});
