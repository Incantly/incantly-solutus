/**
 * The one-time registration of fire (docs/features/physics/design.md 2.4, 9.7; ui.md 6 and 7; errors.md 3 and 5): readouts
 * `f.temperature(x, y)` (`f.temperature(x, y, z)` for a fire in space), `f.burning`, `f.fuel` and every smoke readout,
 * the row text, the default look, the notices `burnt` and `fire_out`, the reason `burnt`, and the errors `not_burnable` and
 * `no_fire_grid`.
 */
import { registerNotice } from '../../errors/notices';
import { registerReasonPhrase } from '../../errors/phrases';
import { registerTypeStyle } from '../../graph/props';
import { registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { registerValueText } from '../../language/runtime';
import { T } from '../../language/types';
import type { Ty } from '../../language/types';
import { cellOf3, smokeAt, smokeAt3, smokeInSpaceByLine } from './smoke-reg';
import { isFireValue, isSmokeValue } from './smoke';
import type { FireValue } from './smoke';

const fireFields = (space: boolean): Readonly<Record<string, Ty>> => {
  const fn = { k: 'Function', ret: 'Number', arity: space ? 3 : 2 } as Ty;
  return { mass: T.Number, speed: T.Number, n: T.Number, at: fn, temperature: fn, burning: T.Bool, fuel: T.Number };
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

/** The temperature at a point in space: the cell it is in, 0 outside the box. */
export function temperatureAt3(v: FireValue, x: number, y: number, z: number): number {
  const c = cellOf3(v.spec, x, y, z);
  return c < 0 ? 0 : (v.temp[c] as number);
}

export function registerFire(): void {
  registerFieldNames('Fire', () => Object.keys(fireFields(false)));
  registerFieldTyper('Fire', (field, target, fig) => fireFields(smokeInSpaceByLine(target, fig))[field]);
  registerFieldReader('Fire', (field, v) => {
    if (!isSmokeValue(v)) return undefined;
    if (field === 'mass') return v.mass;
    if (field === 'speed') return v.speed;
    if (field === 'n') return v.spec.n;
    const space = v.spec.space === true;
    const finite3 = (x: unknown, y: unknown, z: unknown): boolean => typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && Number.isFinite(x + y + z);
    const finite2 = (x: unknown, y: unknown): boolean => typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y);
    if (field === 'at') {
      if (space) return { arity: 3, call: (x: unknown, y: unknown, z: unknown) => (finite3(x, y, z) ? smokeAt3(v, x as number, y as number, z as number) : undefined) };
      return { arity: 2, call: (x: unknown, y: unknown) => (finite2(x, y) ? smokeAt(v, x as number, y as number) : undefined) };
    }
    if (!isFireValue(v)) return undefined;
    if (field === 'temperature') {
      if (space) return { arity: 3, call: (x: unknown, y: unknown, z: unknown) => (finite3(x, y, z) ? temperatureAt3(v, x as number, y as number, z as number) : undefined) };
      return { arity: 2, call: (x: unknown, y: unknown) => (finite2(x, y) ? temperatureAt(v, x as number, y as number) : undefined) };
    }
    if (field === 'burning') return v.burning;
    if (field === 'fuel') return v.fuel;
    return undefined;
  });
  registerValueText((v) => (isFireValue(v) ? `fire, ${v.spec.n} by ${v.spec.n}${v.spec.space ? ` by ${v.spec.n}` : ''}, up to ${fmt(v.hottest)} °C, ${v.burning ? 'burning' : 'out'}` : undefined));
  registerTypeStyle('Fire', { defaults: { color: '#e8742a', width: 1, opacity: 0.8 } });
  registerReasonPhrase('burnt', { noun: 'burnt away', sentence: 'It burnt away, so it no longer takes part.' });
  registerNotice('burnt', { code: 'B115', severity: 'info', template: '{name} burnt away at t = {t} s.' });
  registerNotice('fire_out', { code: 'B116', severity: 'info', template: '{name} went out at t = {t} s.' });
}
