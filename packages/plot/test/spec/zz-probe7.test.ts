/** TEMP PROBE 7 - deleted before commit. batch shape. */
import { describe, expect, it } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';

describe('probe7', () => {
  it('batch shape', () => {
    const fig = new ScratchFigure();
    const r = fig.apply('f(x) = x^2 + 1');
    if (!r.ok) throw new Error('def failed');
    const f = fig.valueOf('f') as unknown as Record<string, unknown>;
    const batch = f['batch'] as (...a: never[]) => unknown;
    console.log(`batch.length=${String(batch.length)}`);
    const xs = new Float64Array([1, 2, 3]);
    const out = new Float64Array(3);
    try {
      const ret = batch(xs, out) as unknown;
      console.log(`batch(xs,out) ret=${JSON.stringify(ret)} out=${JSON.stringify(Array.from(out))}`);
    } catch (e) {
      console.log(`batch(xs,out) throws: ${String(e).slice(0, 150)}`);
    }
    try {
      const ret2 = batch(xs) as unknown;
      console.log(`batch(xs) ret=${JSON.stringify(ret2)}`);
    } catch (e) {
      console.log(`batch(xs) throws: ${String(e).slice(0, 150)}`);
    }
    expect(true).toBe(true);
  });
});
