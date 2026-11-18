/**
 * The one-time registration of fire (docs/features/physics/design.md 2.4, 9.7; ui.md 6 and 7; errors.md 3 and 5): readouts
 * `f.temperature(x, y)`, `f.burning`, `f.fuel` and every smoke readout, the row text, the default look, the notices
 * `burnt` and `fire_out`, the reason `burnt`, and the errors `not_burnable` and `no_fire_grid`.
 */
import { registerNotice } from '../../errors/notices';
import { registerReasonPhrase } from '../../errors/phrases';
import { registerTypeStyle } from '../../graph/props';
import { registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { registerValueText } from '../../language/runtime';
import { T } from '../../language/types';
import type { Ty } from '../../language/types';
import { smokeAt } from './smoke-reg';
import { isFireValue, isSmokeValue } from './smoke';
import type { FireValue } from './smoke';

const FIRE_FIELDS: Readonly<Record<string, Ty>> = {
  mass: T.Number, speed: T.Number, n: T.Number, at: { k: 'Function', ret: 'Number', arity: 2 } as Ty,
  temperature: { k: 'Function', ret: 'Number', arity: 2 } as Ty, burning: T.Bool, fuel: T.Number,
};

const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(2))) : 'undefined');

/** The temperature at a point: the cell it is in, 0 outside the box (°C above the air). */
export function temperatureAt(v: FireValue, x: number, y: number): number {
  const s = v.spec;
  if (!(x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1)) return 0;
  const i = Math.min(s.n - 1, Math.floor(((x - s.x0) / (s.x1 - s.x0)) * s.n));
  const j = Math.min(s.n - 1, Math.floor(((y - s.y0) / (s.y1 - s.y0)) * s.n));
  return v.temp[j * s.n + i] as number;
}

export function registerFire(): void {
  registerFieldNames('Fire', () => Object.keys(FIRE_FIELDS));
  registerFieldTyper('Fire', (field) => FIRE_FIELDS[field]);
  registerFieldReader('Fire', (field, v) => {
    if (!isSmokeValue(v)) return undefined;
    if (field === 'mass') return v.mass;
    if (field === 'speed') return v.speed;
    if (field === 'n') return v.spec.n;
    if (field === 'at') {
      return {
        arity: 2,
        call: (x: unknown, y: unknown) => (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? smokeAt(v, x, y) : undefined),
      };
    }
    if (!isFireValue(v)) return undefined;
    if (field === 'temperature') {
      return {
        arity: 2,
        call: (x: unknown, y: unknown) => (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? temperatureAt(v, x, y) : undefined),
      };
    }
    if (field === 'burning') return v.burning;
    if (field === 'fuel') return v.fuel;
    return undefined;
  });
  registerValueText((v) => (isFireValue(v) ? `fire, ${v.spec.n} by ${v.spec.n}, up to ${fmt(v.hottest)} °C, ${v.burning ? 'burning' : 'out'}` : undefined));
  registerTypeStyle('Fire', { defaults: { color: '#e8742a', width: 1, opacity: 0.8 } });
  registerReasonPhrase('burnt', { noun: 'burnt away', sentence: 'It burnt away, so it no longer takes part.' });
  registerNotice('burnt', { code: 'B115', severity: 'info', template: '{name} burnt away at t = {t} s.' });
  registerNotice('fire_out', { code: 'B116', severity: 'info', template: '{name} went out at t = {t} s.' });
}
