/**
 * The one-time registration of liquids, water and waves (docs/features/physics/design.md 2.4, 9.3; ui.md 6 and 7;
 * errors.md 5, 7): readouts `l.count`, `l.level`, `wa.level`, `w.level`, `w.speed`, `w.height(p)`, the algebra row
 * text, the default look, the drop limit and the notices.
 */
import { registerNotice } from '../../errors/notices';
import { registerTypeStyle } from '../../graph/props';
import { registerLineCheck } from '../../graph/registry';
import { registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { registerValueText } from '../../language/runtime';
import { T } from '../../language/types';
import type { Ty } from '../../language/types';
import type { WavesValue } from './liquid';
import { isLiquidValue, isWaterValue, isWavesValue, liquidLineCheck } from './liquid';

const LIQUID_FIELDS: Readonly<Record<string, Ty>> = { count: T.Number, level: T.Number };
const WATER_FIELDS: Readonly<Record<string, Ty>> = { level: T.Number };
const WAVES_FIELDS: Readonly<Record<string, Ty>> = { level: T.Number, speed: T.Number, height: { k: 'Function', ret: 'Number', arity: 1 } as Ty };

/** The mean height of a wave surface (the rest level plus what bodies moved aside). */
function meanLevel(v: WavesValue): number {
  let s = 0;
  for (let k = 0; k < v.heights.length; k++) s += v.heights[k] as number;
  return v.level + (v.heights.length > 0 ? s / v.heights.length : 0);
}

/** The height of the surface at a point (its x and y) or at x in the plane: bilinear over the cell centres. */
export function waveHeightAt(v: WavesValue, x: number, y: number): number | undefined {
  if (!(x >= v.x0 && x <= v.x0 + v.nx * v.dx)) return undefined;
  if (v.space && !(y >= v.y0 && y <= v.y0 + v.ny * v.dy)) return undefined;
  const fx = Math.min(v.nx - 1, Math.max(0, (x - v.x0) / v.dx - 0.5));
  const i = Math.min(Math.floor(fx), Math.max(0, v.nx - 2));
  const tx = v.nx > 1 ? fx - i : 0;
  const i1 = Math.min(v.nx - 1, i + 1);
  const h = v.heights;
  if (!v.space || v.ny === 1) return v.level + (h[i] as number) + ((h[i1] as number) - (h[i] as number)) * tx;
  const fy = Math.min(v.ny - 1, Math.max(0, (y - v.y0) / v.dy - 0.5));
  const j = Math.min(Math.floor(fy), Math.max(0, v.ny - 2));
  const ty = fy - j;
  const j1 = Math.min(v.ny - 1, j + 1);
  const a = h[j * v.nx + i] as number;
  const b = h[j * v.nx + i1] as number;
  const c = h[j1 * v.nx + i] as number;
  const d = h[j1 * v.nx + i1] as number;
  return v.level + a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(2))) : 'undefined');

export function registerLiquids(): void {
  registerFieldNames('Liquid', () => Object.keys(LIQUID_FIELDS));
  registerFieldTyper('Liquid', (field) => LIQUID_FIELDS[field]);
  registerFieldReader('Liquid', (field, v) => {
    if (!isLiquidValue(v)) return undefined;
    if (field === 'count') return v.count;
    // no drops: no surface
    if (field === 'level') return Number.isFinite(v.level) ? v.level : undefined;
    return undefined;
  });
  registerFieldNames('Water', () => Object.keys(WATER_FIELDS));
  registerFieldTyper('Water', (field) => WATER_FIELDS[field]);
  registerFieldReader('Water', (field, v) => (isWaterValue(v) && field === 'level' ? v.level : undefined));
  registerFieldNames('Waves', () => Object.keys(WAVES_FIELDS));
  registerFieldTyper('Waves', (field) => WAVES_FIELDS[field]);
  registerFieldReader('Waves', (field, v) => {
    if (!isWavesValue(v)) return undefined;
    if (field === 'level') return meanLevel(v);
    if (field === 'speed') return v.speed;
    if (field === 'height') {
      return {
        arity: 1,
        call: (p: unknown) => {
          const q = p as { x?: unknown; y?: unknown } | number | undefined;
          const x = typeof q === 'number' ? q : typeof q?.x === 'number' ? q.x : Number.NaN;
          const y = typeof q === 'object' && typeof q.y === 'number' ? q.y : 0;
          return Number.isFinite(x) && Number.isFinite(y) ? waveHeightAt(v, x, y) : undefined;
        },
      };
    }
    return undefined;
  });
  registerValueText((v) => {
    if (isWavesValue(v)) return `waves, ${v.space ? `${v.nx} by ${v.ny} cells` : `${v.nx} points`}, level ${fmt(meanLevel(v))}, ${fmt(v.speed)} m/s`;
    if (isLiquidValue(v)) return `liquid, ${v.count} drops${Number.isFinite(v.level) ? `, level ${fmt(v.level)}` : ''}`;
    if (isWaterValue(v)) return `water, level ${fmt(v.level)}`;
    return undefined;
  });
  registerTypeStyle('Liquid', { defaults: { color: '#4a9fe0', width: 1, opacity: 0.85 } });
  registerTypeStyle('Water', { defaults: { color: '#2f7fc1', width: 2, opacity: 0.3 } });
  registerTypeStyle('Waves', { defaults: { color: '#2f7fc1', width: 2, opacity: 0.75 } });
  registerLineCheck(liquidLineCheck);
  registerNotice('worker_crashed', { code: 'B112', severity: 'info', template: 'The physics worker stopped, so the film goes on here on the page. It is the same film.' });
}
