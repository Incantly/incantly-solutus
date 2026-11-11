/** TEMP PROBE - deleted before commit. Learns kernel input shapes + plot runtime. */
import { describe, expect, it } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';
import {
  fieldFromRelation,
  fillPredicate1D,
  fillRegion,
  plotFunction,
  predicateFromRelation,
  traceImplicit,
  traceParamCurve,
} from '@incantly/plot';

const show = (label: string, v: unknown): void => {
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    console.log(`${label}: keys=[${keys.join(',')}] proto=${String(Object.getPrototypeOf(v)?.constructor?.name)}`);
    for (const k of keys) {
      const val = (v as Record<string, unknown>)[k];
      if (typeof val === 'function') console.log(`  ${k}: function`);
      else console.log(`  ${k}: ${JSON.stringify(val)?.slice(0, 120)}`);
    }
  } else {
    console.log(`${label}: ${String(v)}`);
  }
};

describe('probe', () => {
  it('builds figures and functions', () => {
    let fig: ScratchFigure | undefined;
    try {
      fig = new ScratchFigure();
      console.log('new ScratchFigure() ok');
    } catch (e) {
      console.log(`new ScratchFigure() throws: ${String(e).slice(0, 200)}`);
    }
    expect(true).toBe(true);
    if (fig === undefined) return;
    for (const line of ['f(x) = x^2 - 2', 'g(x, y) = x^2 - y^2', 'c(s) = (cos(s), sin(s))', 'rel = x^2 + y^2 == 4', 'q = x^2 + y^2 < 4', 'p1(x) = x^2 > 4']) {
      const r = fig.apply(line);
      console.log(`${line} -> ${r.ok ? `ok ${JSON.stringify(r.value).slice(0, 160)}` : `ERR ${r.kind}: ${r.message.slice(0, 120)}`}`);
    }
    show('f', fig.valueOf('f'));
    show('g', fig.valueOf('g'));
    show('c', fig.valueOf('c'));
    show('rel', fig.valueOf('rel'));
    show('q', fig.valueOf('q'));
    show('p1', fig.valueOf('p1'));
    const f = fig.valueOf('f') as unknown as Record<string, unknown>;
    if (f !== null && typeof f === 'object') {
      for (const m of ['call', 'call1', 'call2', 'batch', 'batch1']) {
        const fn = f[m];
        if (typeof fn === 'function') {
          try {
            const out = (fn as (...a: number[]) => unknown).call(f, 3);
            console.log(`f.${m}(3) = ${JSON.stringify(out)}`);
          } catch (e) {
            console.log(`f.${m}(3) throws: ${String(e).slice(0, 120)}`);
          }
        }
      }
    }
  });

  it('calls plot entry points', () => {
    const fig = new ScratchFigure();
    const rf = fig.apply('f(x) = x^2 - 2');
    if (!rf.ok) {
      console.log(`f def failed: ${rf.kind}`);
      return;
    }
    const fn = fig.valueOf('f') as never;
    const view = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };
    try {
      const p = plotFunction(fn, view);
      console.log(`plotFunction: ${p.ok ? `ok paths=${p.value.paths.length} stats=${JSON.stringify(p.value.stats)}` : `ERR ${p.kind}: ${p.message.slice(0, 160)}`}`);
    } catch (e) {
      console.log(`plotFunction throws: ${String(e).slice(0, 300)}`);
    }
    const rr = fig.apply('rel = x^2 + y^2 == 4');
    console.log(`rel def: ${rr.ok ? 'ok' : `ERR ${rr.kind}`}`);
    if (rr.ok) {
      const rel = fig.valueOf('rel') as never;
      const fr = fieldFromRelation(rel);
      console.log(`fieldFromRelation: ${fr.ok ? 'ok' : `ERR ${fr.kind}`}`);
      if (fr.ok) {
        const t = traceImplicit(fr.value, view);
        console.log(`traceImplicit: ${t.ok ? `ok paths=${t.value.paths.length} stats=${JSON.stringify(t.value.stats)}` : `ERR ${t.kind}`}`);
      }
      const pr = predicateFromRelation(rel);
      console.log(`predicateFromRelation: ${pr.ok ? 'ok' : `ERR ${pr.kind}`}`);
      if (pr.ok) {
        const fl = fillRegion(pr.value, view);
        console.log(`fillRegion: ${fl.ok ? `ok rects=${fl.value.rects.length / 4} polys=${fl.value.polygons.length} borders=${fl.value.borders.length}` : `ERR ${fl.kind}`}`);
      }
    }
    const fc = fig.apply('c(s) = (cos(s), sin(s))');
    console.log(`c def: ${fc.ok ? 'ok' : `ERR ${(fc as { kind?: string }).kind ?? '?'}`}`);
    if (fc.ok) {
      const c = fig.valueOf('c') as never;
      try {
        const t = traceParamCurve({ fn: c, lo: 0, hi: 6.283185307179586 }, view);
        console.log(`traceParamCurve: ${t.ok ? `ok paths=${t.value.paths.length} stats=${JSON.stringify(t.value.stats)}` : `ERR ${t.kind}`}`);
      } catch (e) {
        console.log(`traceParamCurve throws: ${String(e).slice(0, 300)}`);
      }
    }
    const fp = fillPredicate1D({ test: (x: number) => x * x > 4 }, view);
    console.log(`fillPredicate1D: ${fp.ok ? `ok bands=${fp.value.bands.length / 4} intervals=${Array.from(fp.value.intervals)}` : `ERR ${fp.kind}`}`);
    expect(true).toBe(true);
  });
});
