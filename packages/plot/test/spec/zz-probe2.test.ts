/** TEMP PROBE 2 - deleted before commit. */
import { describe, expect, it } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';
import { createView, plotFunction, resumeFunctionPlot } from '@incantly/plot';

describe('probe2', () => {
  it('learns more kernel shapes', () => {
    const fig = new ScratchFigure();
    const lines = [
      'c(s) = (cos(s), sin(s))',
      'g(x, y) = x^2 - y^2',
      'pw(x) = if(x < 0, -x, x^2)',
      'ab(x) = abs(x)',
      'fl(x) = floor(x)',
      'md(x) = mod(x, 2)',
      'sq(x) = sqrt(x)',
      'iv(x) = 1 / x',
      'pw0(x) = 0^x',
      'ch = 1 < x^2 + y^2 < 4',
      'both = x^2 + y^2 <= 4 and y > x',
      'neg = not(x > 0)',
      'pp(x) = x > 2',
      'rx = x^2 == 4',
    ];
    for (const line of lines) {
      const r = fig.apply(line);
      console.log(`${line} -> ${r.ok ? `ok ${JSON.stringify(r.value).slice(0, 140)}` : `ERR ${r.kind}: ${r.message.slice(0, 100)}`}`);
    }
    const show = (name: string): void => {
      const v = fig.valueOf(name) as unknown as Record<string, unknown> | undefined;
      if (v === undefined) {
        console.log(`${name}: undefined`);
        return;
      }
      if (v !== null && typeof v === 'object' && 'call' in v) {
        const call = v['call'] as (...a: number[]) => unknown;
        try {
          console.log(`${name}.call(0)=${JSON.stringify(call.call(v, 0))} call(1,2)=${JSON.stringify((v['call'] as (...a: number[]) => unknown).call(v, 1, 2))}`);
        } catch (e) {
          console.log(`${name}.call throws: ${String(e).slice(0, 120)}`);
        }
        console.log(`${name} keys=${Object.keys(v).join(',')}`);
      } else if (v !== null && typeof v === 'object' && 'test' in v) {
        const t = v['test'] as (x: number, y: number) => unknown;
        const res = v['residual'] as (x: number, y: number) => unknown;
        console.log(`${name}: ops=${JSON.stringify(v['ops'])} test(2,0)=${String(t.call(v, 2, 0))} residual(2,0)=${String(res.call(v, 2, 0))} test(1,1)=${String(t.call(v, 1, 1))}`);
      } else {
        console.log(`${name}: ${JSON.stringify(v)?.slice(0, 160)}`);
      }
    };
    for (const n of ['c', 'g', 'pw', 'ab', 'fl', 'md', 'sq', 'iv', 'pw0', 'ch', 'both', 'neg', 'rx']) show(n);
    // sample behavior of tricky functions
    const iv = fig.valueOf('iv') as unknown as { call1: (x: number) => number };
    console.log(`iv.call1(0)=${String(iv.call1(0))} call1(-0.0)=${String(iv.call1(-0))}`);
    const sq = fig.valueOf('sq') as unknown as { call1: (x: number) => number };
    console.log(`sq.call1(-1)=${String(sq.call1(-1))}`);
    expect(true).toBe(true);
  });

  it('learns resume + view validation', () => {
    const fig = new ScratchFigure();
    const rf = fig.apply('f(x) = sin(1/x)');
    if (!rf.ok) {
      console.log('sin(1/x) def failed');
      return;
    }
    const fn = fig.valueOf('f') as never;
    const view = { x0: -1, x1: 1, y0: -2, y1: 2, widthPx: 800, heightPx: 600 };
    const p = plotFunction(fn, view, { maxEvals: 300 });
    if (p.ok) {
      console.log(`small budget: complete=${String(p.value.stats.complete)} paths=${p.value.paths.length} resume=${p.value.resume === undefined ? 'none' : 'present'}`);
      if (!p.value.stats.complete && p.value.resume !== undefined) {
        const r2 = resumeFunctionPlot(p.value.resume, fn, { maxEvals: 50000 });
        console.log(`resume: ${r2.ok ? `ok complete=${String(r2.value.stats.complete)} paths=${r2.value.paths.length} evals=${r2.value.stats.evals}` : `ERR ${r2.kind}`}`);
      }
    } else console.log(`plotFunction ERR ${p.kind}`);
    const badViews = [
      { x0: 5, x1: -5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 },
      { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 0, heightPx: 600 },
      { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: -2 },
      { x0: Number.NaN, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 },
    ];
    for (const v of badViews) {
      const c = createView(v);
      console.log(`createView(${JSON.stringify(v)}) -> ${c.ok ? 'ok' : `${c.kind}: ${c.message.slice(0, 100)}`}`);
    }
    const vok = createView(view);
    if (vok.ok) {
      const pv = vok.value;
      console.log(`view scales sx=${pv.sx} sy=${pv.sy} toPx(0)=${pv.toPx(0)} toPy(0)=${pv.toPy(0)} toX(400)=${pv.toX(400)}`);
    }
    expect(true).toBe(true);
  });
});
