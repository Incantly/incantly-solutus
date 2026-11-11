/** TEMP PROBE 3 - deleted before commit. Observable quantities. */
import { describe, expect, it } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';
import type { FunctionValue } from '@incantly/kernel';
import { plotFunction } from '@incantly/plot';

const fig = new ScratchFigure();
const fn = (body: string): FunctionValue => {
  const name = `f${Math.floor(Math.random() * 1e9).toString(36)}`;
  const r = fig.apply(`${name}(x) = ${body}`);
  if (!r.ok) throw new Error(`${body}: ${r.kind} ${r.message}`);
  return fig.valueOf(name) as FunctionValue;
};

describe('probe3', () => {
  it('coarse counts for linear fn', () => {
    for (const w of [100, 400, 800, 2000]) {
      const v = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: w, heightPx: 600 };
      const p = plotFunction(fn('2*x + 1'), v);
      if (p.ok) console.log(`w=${w} evals=${p.value.stats.evals} samples=${p.value.stats.samples} maxDepth=${p.value.stats.maxDepth} paths=${p.value.paths.length}`);
      else console.log(`w=${w} ERR ${p.kind}`);
    }
    expect(true).toBe(true);
  });
  it('markers for pole/hole/jump', () => {
    const v = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
    for (const body of ['1/x', '(x^2-1)/(x-1)', 'floor(x)', 'sqrt(x)', 'abs(x)', 'tan(x)']) {
      const p = plotFunction(fn(body), v);
      if (p.ok) {
        console.log(`${body}: paths=${p.value.paths.length} markers=${JSON.stringify(p.value.markers.map((m) => [m.kind, +m.x.toFixed(4), +m.y.toFixed(4), +m.px.toFixed(1), +m.py.toFixed(1)]))} ink=${p.value.inkColumns.length} evals=${p.value.stats.evals} rigorous=${String(p.value.stats.rigorous)}`);
      } else console.log(`${body} ERR ${p.kind}`);
    }
    expect(true).toBe(true);
  });
  it('domain/breaks/exact/clip', () => {
    const v = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
    const d = plotFunction(fn('x^2'), v, { domain: [{ lo: -2, hi: 3, loOpen: false, hiOpen: true }] });
    if (d.ok) console.log(`domain: paths=${d.value.paths.length} markers=${JSON.stringify(d.value.markers.map((m) => [m.kind, +m.x.toFixed(3)]))} first=${d.value.paths[0]?.slice(0, 4)} last=${d.value.paths[0]?.slice(-4)}`);
    const b = plotFunction(fn('if(x < 0, -x, x^2)'), v, { breaks: [0] });
    if (b.ok) console.log(`breaks: paths=${b.value.paths.length} markers=${JSON.stringify(b.value.markers.map((m) => [m.kind, +m.x.toFixed(3)]))} evals=${b.value.stats.evals}`);
    const e = plotFunction(fn('x^2'), v, { exact: true });
    if (e.ok) console.log(`exact-no-enclosure: paths=${e.value.paths.length} ink=${e.value.inkColumns.length} rigorous=${String(e.value.stats.rigorous)}`);
    const e2 = plotFunction(fn('x^2'), v, { exact: true, enclosure: (lo, hi) => ({ lo: lo * lo, hi: hi * hi, def: 2 }) });
    if (e2.ok) console.log(`exact-enclosure: paths=${e2.value.paths.length} ink=${e2.value.inkColumns.length} rigorous=${String(e2.value.stats.rigorous)}`);
    const c = plotFunction(fn('x^2'), v);
    if (c.ok) {
      const ys: number[] = [];
      for (const path of c.value.paths) for (let i = 1; i < path.length; i += 2) ys.push(path[i] ?? 0);
      console.log(`clip: minY=${Math.min(...ys)} maxY=${Math.max(...ys)} h=${v.heightPx} bounds=[${-4 * v.heightPx},${5 * v.heightPx}]`);
    }
    const s = plotFunction(fn('sin(1/x)'), { x0: -1, x1: 1, y0: -2, y1: 2, widthPx: 800, heightPx: 600 });
    if (s.ok) console.log(`sin(1/x): paths=${s.value.paths.length} ink=${s.value.inkColumns.length} evals=${s.value.stats.evals} maxDepth=${s.value.stats.maxDepth}`);
    expect(true).toBe(true);
  });
});
