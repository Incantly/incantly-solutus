/** TEMP PROBE 5 - deleted before commit. With-enclosure verdicts + error shape. */
import { describe, expect, it } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';
import type { FunctionValue } from '@incantly/kernel';
import { createView, plotFunction } from '@incantly/plot';
import type { FunctionPlot, ScalarEnclosure } from '@incantly/plot';

const fig = new ScratchFigure();
let n = 100;
const fn = (body: string): FunctionValue => {
  n += 1;
  const name = `h${n}`;
  const r = fig.apply(`${name}(x) = ${body}`);
  if (!r.ok) throw new Error(`${body}: ${r.kind} ${r.message}`);
  return fig.valueOf(name) as FunctionValue;
};
const V = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
const hist = (p: FunctionPlot): string => {
  const kinds = new Map<string, number>();
  for (const m of p.markers) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
  const finite = p.markers.every((m) => Number.isFinite(m.x) && Number.isFinite(m.y) && Number.isFinite(m.px) && Number.isFinite(m.py));
  const xs = p.markers.slice(0, 6).map((m) => `${m.kind}@${m.x.toFixed(3)},${m.y.toFixed(2)}`);
  return `paths=${p.paths.length} markers=${p.markers.length}[${[...kinds.entries()].map(([k, c]) => `${k}:${c}`).join(',')}] finite=${String(finite)} ink=${p.inkColumns.length} evals=${p.stats.evals} iEvals=${p.stats.intervalEvals} rigorous=${String(p.stats.rigorous)} ${xs.join(' ')}`;
};
const invEnc: ScalarEnclosure = (lo, hi) => {
  if (hi < 0 || lo > 0) return { lo: 1 / hi, hi: 1 / lo, def: 2 };
  return { lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY, def: 1 };
};
const floorEnc: ScalarEnclosure = (lo, hi) => {
  const a = Math.floor(lo);
  const b = Math.floor(hi);
  if (a === b && !Number.isInteger(lo)) return { lo: a, hi: a, def: 2 };
  if (a === b) return { lo: a, hi: a, def: 2 };
  return { lo: a, hi: b, def: 2 };
};
const holeEnc: ScalarEnclosure = (lo, hi) => {
  if (lo <= 1 && 1 <= hi) return { lo: 1.5, hi: 2.5, def: 1 };
  const f = (x: number): number => (x * x - 1) / (x - 1);
  return { lo: Math.min(f(lo), f(hi)), hi: Math.max(f(lo), f(hi)), def: 2 };
};
const sqrtEnc: ScalarEnclosure = (lo, hi) => {
  if (hi < 0) return { lo: 0, hi: 0, def: 0 };
  if (lo < 0) return { lo: 0, hi: Math.sqrt(hi), def: 1 };
  return { lo: Math.sqrt(lo), hi: Math.sqrt(hi), def: 2 };
};

describe('probe5', () => {
  it('verdicts with enclosure', () => {
    const p1 = plotFunction(fn('1/x'), V, { enclosure: invEnc });
    console.log(`inv: ${p1.ok ? hist(p1.value) : `ERR ${p1.kind}`}`);
    const p2 = plotFunction(fn('floor(x)'), V, { breaks: [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5], enclosure: floorEnc });
    console.log(`floor: ${p2.ok ? hist(p2.value) : `ERR ${p2.kind}`}`);
    const p3 = plotFunction(fn('(x^2-1)/(x-1)'), V, { breaks: [1], enclosure: holeEnc });
    console.log(`hole: ${p3.ok ? hist(p3.value) : `ERR ${p3.kind}`}`);
    const p4 = plotFunction(fn('sqrt(x)'), V, { enclosure: sqrtEnc });
    console.log(`sqrt: ${p4.ok ? hist(p4.value) : `ERR ${p4.kind}`}`);
    const p5 = plotFunction(fn('tan(x)'), V, {
      enclosure: (lo, hi) => {
        for (let k = -3; k <= 3; k += 1) {
          const c = Math.PI / 2 + k * Math.PI;
          if (lo <= c && c <= hi) return { lo: Number.NEGATIVE_INFINITY, hi: Number.POSITIVE_INFINITY, def: 1 };
        }
        return { lo: Math.tan(lo), hi: Math.tan(hi), def: 2 };
      },
    });
    console.log(`tan: ${p5.ok ? hist(p5.value) : `ERR ${p5.kind}`}`);
    expect(true).toBe(true);
  });
  it('error shape', () => {
    const e = createView({ x0: 5, x1: -5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 });
    if (!e.ok) console.log(`ERROBJ: ${JSON.stringify(e)}`);
    const f = fn('x^2');
    const e2 = plotFunction(f, V, { maxSamples: 100000 });
    if (!e2.ok) console.log(`LIMITOBJ: ${JSON.stringify(e2)}`);
    expect(true).toBe(true);
  });
});
