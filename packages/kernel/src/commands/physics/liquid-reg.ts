/**
 * The one-time registration of liquids and water (docs/features/physics/design.md 2.4; ui.md 6 and 7; errors.md 5, 7):
 * readouts `l.count`, `l.level`, `wa.level`, the algebra row text, the default look, the drop limit and the notices.
 */
import { registerNotice } from '../../errors/notices';
import { registerTypeStyle } from '../../graph/props';
import { registerLineCheck } from '../../graph/registry';
import { registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { registerValueText } from '../../language/runtime';
import { T } from '../../language/types';
import type { Ty } from '../../language/types';
import { isLiquidValue, isWaterValue, liquidLineCheck } from './liquid';

const LIQUID_FIELDS: Readonly<Record<string, Ty>> = { count: T.Number, level: T.Number };
const WATER_FIELDS: Readonly<Record<string, Ty>> = { level: T.Number };

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
  registerValueText((v) => {
    if (isLiquidValue(v)) return `liquid, ${v.count} drops${Number.isFinite(v.level) ? `, level ${fmt(v.level)}` : ''}`;
    if (isWaterValue(v)) return `water, level ${fmt(v.level)}`;
    return undefined;
  });
  registerTypeStyle('Liquid', { defaults: { color: '#4a9fe0', width: 1, opacity: 0.85 } });
  registerTypeStyle('Water', { defaults: { color: '#2f7fc1', width: 2, opacity: 0.3 } });
  registerLineCheck(liquidLineCheck);
  registerNotice('worker_crashed', { code: 'B112', severity: 'info', template: 'The physics worker stopped, so the film goes on here on the page from its last checkpoint. It is the same film.' });
}
