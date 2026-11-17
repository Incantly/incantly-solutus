/**
 * The one-time registration of smoke (docs/features/physics/design.md 2.4; ui.md 6 and 7; errors.md 3): readouts
 * `sm.mass`, `sm.speed` and `sm.at(P)`, the algebra row text, the default look and the cell limit.
 */
import { registerTypeStyle } from '../../graph/props';
import { registerLineCheck } from '../../graph/registry';
import { registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { registerValueText } from '../../language/runtime';
import { T } from '../../language/types';
import type { Ty } from '../../language/types';
import { isSmokeValue, smokeLineCheck } from './smoke';
import type { SmokeValue } from './smoke';

const SMOKE_FIELDS: Readonly<Record<string, Ty>> = { mass: T.Number, speed: T.Number, n: T.Number, at: { k: 'Function', ret: 'Number', arity: 1 } as Ty };

const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(2))) : 'undefined');

/** The smoke at a point: the density of the cell it is in, 0 outside the box. */
export function smokeAt(v: SmokeValue, x: number, y: number): number {
  const s = v.spec;
  if (!(x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1)) return 0;
  const i = Math.min(s.n - 1, Math.floor(((x - s.x0) / (s.x1 - s.x0)) * s.n));
  const j = Math.min(s.n - 1, Math.floor(((y - s.y0) / (s.y1 - s.y0)) * s.n));
  return v.density[j * s.n + i] as number;
}

export function registerSmoke(): void {
  registerFieldNames('Smoke', () => Object.keys(SMOKE_FIELDS));
  registerFieldTyper('Smoke', (field) => SMOKE_FIELDS[field]);
  registerFieldReader('Smoke', (field, v) => {
    if (!isSmokeValue(v)) return undefined;
    if (field === 'mass') return v.mass;
    if (field === 'speed') return v.speed;
    if (field === 'n') return v.spec.n;
    if (field === 'at') {
      return {
        arity: 1,
        call: (p: unknown) => {
          const q = p as { x?: unknown; y?: unknown } | undefined;
          return typeof q?.x === 'number' && typeof q.y === 'number' ? smokeAt(v, q.x, q.y) : undefined;
        },
      };
    }
    return undefined;
  });
  registerValueText((v) => (isSmokeValue(v) ? `smoke, ${v.spec.n} by ${v.spec.n}, ${fmt(v.mass)} m² of smoke, air up to ${fmt(v.speed)} m/s` : undefined));
  registerTypeStyle('Smoke', { defaults: { color: '#5f6670', width: 1, opacity: 0.8 } });
  registerLineCheck(smokeLineCheck);
}
