/** TEMP PROBE 6 - deleted before commit. Path geometry + param/implicit/region basics. */
import { describe, expect, it } from 'vitest';
import { ScratchFigure } from '@incantly/kernel';
import type { FunctionValue, RelationValue } from '@incantly/kernel';
import { fieldFromRelation, fillPredicate1D, fillRegion, plotFunction, predicateFromRelation, traceImplicit, traceParamCurve } from '@incantly/plot';

const fig = new ScratchFigure();
let n = 200;
const def = (line: string): string => {
  n += 1;
  const name = `q${n}`;
  const r = fig.apply(line.replaceAll('QQ', name));
  if (!r.ok) throw new Error(`${line}: ${r.kind} ${r.message}`);
  return name;
};
const V = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: 800, heightPx: 600 };

describe('probe6', () => {
  it('floor path geometry', () => {
    const name = def('QQ(x) = floor(x)');
    const f = fig.valueOf(name) as FunctionValue;
    const p = plotFunction(f, V, { breaks: [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5] });
    if (p.ok) {
      for (const path of p.value.paths) {
        const segs: string[] = [];
        for (let i = 0; i < Math.min(path.length, 40); i += 2) segs.push(`(${(path[i] ?? 0).toFixed(1)},${(path[i + 1] ?? 0).toFixed(1)})`);
        console.log(`path len=${path.length / 2}: ${segs.join(' ')}...`);
      }
    }
    expect(true).toBe(true);
  });
  it('param basics', () => {
    const circ = def('QQ(s) = (2*cos(s), sin(s))');
    const c = fig.valueOf(circ) as FunctionValue;
    const t = traceParamCurve({ fn: c, lo: 0, hi: 2 * Math.PI }, V);
    console.log(`ellipse: ${t.ok ? `paths=${t.value.paths.length} closed=${JSON.stringify(t.value.closed)} markers=${t.value.markers.length} evals=${t.value.stats.evals} samples=${t.value.stats.samples} rigorous=${String(t.value.stats.rigorous)}` : `ERR ${t.kind}`}`);
    const line = def('QQ(s) = (s, 0.1*s)');
    const l = fig.valueOf(line) as FunctionValue;
    for (const w of [100, 800, 2000]) {
      const v = { x0: -5, x1: 5, y0: -5, y1: 5, widthPx: w, heightPx: 600 };
      const t2 = traceParamCurve({ fn: l, lo: -5, hi: 5 }, v);
      console.log(`flatline w=${w}: ${t2.ok ? `evals=${t2.value.stats.evals} samples=${t2.value.stats.samples} depth=${t2.value.stats.maxDepth}` : `ERR ${t2.kind}`}`);
    }
    const cusp = def('QQ(s) = (s^2, s^3)');
    const cu = fig.valueOf(cusp) as FunctionValue;
    const t3 = traceParamCurve({ fn: cu, lo: -2, hi: 2 }, V);
    console.log(`cusp: ${t3.ok ? `paths=${t3.value.paths.length} markers=${JSON.stringify(t3.value.markers.map((m) => [m.kind, +m.x.toFixed(3), +m.y.toFixed(3)]))}` : `ERR ${t3.kind}`}`);
    expect(true).toBe(true);
  });
  it('implicit basics', () => {
    const rel = fig.valueOf(def('QQ = x^2 + y^2 == 4')) as unknown as RelationValue;
    const fr = fieldFromRelation(rel);
    console.log(`fieldFromRelation(==): ${fr.ok ? 'ok' : `ERR ${fr.kind}`}`);
    if (fr.ok) {
      const t = traceImplicit(fr.value, V);
      console.log(`circle final: ${t.ok ? `paths=${t.value.paths.length} closed=${JSON.stringify(t.value.closed)} markers=${t.value.markers.length} evals=${t.value.stats.evals} samples=${t.value.stats.samples} rigorous=${String(t.value.stats.rigorous)}` : `ERR ${t.kind}`}`);
      const td = traceImplicit(fr.value, V, { quality: 'draft' });
      console.log(`circle draft: ${td.ok ? `paths=${td.value.paths.length} evals=${td.value.stats.evals} samples=${td.value.stats.samples}` : `ERR ${td.kind}`}`);
      if (t.ok && t.value.paths.length > 0) {
        const p0 = t.value.paths[0] ?? new Float64Array(0);
        console.log(`first path head: ${Array.from(p0.slice(0, 8)).map((v) => v.toFixed(1)).join(',')} len=${p0.length / 2}`);
      }
    }
    const lt = fig.valueOf(def('QQ = x^2 + y^2 < 4')) as unknown as RelationValue;
    const fr2 = fieldFromRelation(lt);
    console.log(`fieldFromRelation(<): ${fr2.ok ? 'ok' : `ERR ${(fr2 as { kind: string }).kind}`}`);
    expect(true).toBe(true);
  });
  it('region basics', () => {
    const disc = fig.valueOf(def('QQ = x^2 + y^2 <= 4')) as unknown as RelationValue;
    const pr = predicateFromRelation(disc);
    console.log(`predicateFromRelation(<=): ${pr.ok ? 'ok' : `ERR ${(pr as { kind: string }).kind}`}`);
    if (pr.ok) {
      const f = fillRegion(pr.value, V);
      if (f.ok) {
        let area = 0;
        for (let i = 0; i < f.value.rects.length; i += 4) area += Math.abs((f.value.rects[i + 2] ?? 0) - (f.value.rects[i] ?? 0)) * Math.abs((f.value.rects[i + 3] ?? 0) - (f.value.rects[i + 1] ?? 0));
        console.log(`disc: rects=${f.value.rects.length / 4} polys=${f.value.polygons.length} borders=${f.value.borders.length} strict=${JSON.stringify(f.value.borders.map((b) => b.strict))} markers=${f.value.markers.length} rectAreaPx=${area.toFixed(0)} evals=${f.value.stats.evals} rigorous=${String(f.value.stats.rigorous)}`);
      } else console.log(`disc fill ERR ${f.kind}`);
    }
    const eq = fig.valueOf(def('QQ = x^2 + y^2 == 4')) as unknown as RelationValue;
    const pr2 = predicateFromRelation(eq);
    if (pr2.ok) {
      const f2 = fillRegion(pr2.value, V);
      console.log(`eq fill: ${f2.ok ? `rects=${f2.value.rects.length / 4} polys=${f2.value.polygons.length} borders=${f2.value.borders.length}` : `ERR ${f2.kind}`}`);
    } else console.log(`predicateFromRelation(==): ERR ${(pr2 as { kind: string }).kind}`);
    const hp = fillRegion({ test: (x, _y) => x > 0 }, V);
    console.log(`halfplane hand: ${hp.ok ? `rects=${hp.value.rects.length / 4} polys=${hp.value.polygons.length} borders=${hp.value.borders.length} evals=${hp.value.stats.evals}` : `ERR ${hp.kind}`}`);
    const p1 = fillPredicate1D({ test: (x) => x * x > 4 }, V);
    if (p1.ok) console.log(`1d: bands=${p1.value.bands.length / 4} band0=${Array.from(p1.value.bands.slice(0, 4)).map((v) => v.toFixed(1))} intervals=${Array.from(p1.value.intervals).map((v) => v.toFixed(4))}`);
    expect(true).toBe(true);
  });
});
