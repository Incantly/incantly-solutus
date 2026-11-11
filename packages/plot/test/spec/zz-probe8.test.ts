/** TEMP PROBE 8 - deleted before commit. Jump marker values, heuristic 1/x. */
import { describe, expect, it } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';
import type { FunctionValue } from '@incantly/kernel';
import { plotFunction } from '@incantly/plot';

describe('probe8', () => {
  it('jump values', () => {
    const fig = new ScratchFigure();
    const r = fig.apply('f(x) = 1/x');
    if (!r.ok) throw new Error('def failed');
    const f = fig.valueOf('f') as FunctionValue;
    const v = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
    const p = plotFunction(f, v);
    if (!p.ok) throw new Error('plot failed');
    const jumps = p.value.markers.filter((m) => m.kind === 'jump').slice(0, 8);
    for (const m of jumps) {
      const wantPy = ((v.y1 - m.y) / (v.y1 - v.y0)) * v.heightPx;
      console.log(`jump x=${m.x} y=${m.y} px=${m.px} py=${m.py} wantPy=${wantPy}`);
    }
    const opens = p.value.markers.filter((m) => m.kind === 'openEnd').slice(0, 4);
    for (const m of opens) {
      const wantPy = ((v.y1 - m.y) / (v.y1 - v.y0)) * v.heightPx;
      console.log(`open x=${m.x} y=${m.y} px=${m.px} py=${m.py} wantPy=${wantPy}`);
    }
    expect(true).toBe(true);
  });
});
