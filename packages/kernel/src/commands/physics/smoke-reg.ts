/**
 * The one-time registration of smoke (docs/features/physics/design.md 2.4; ui.md 6 and 7; errors.md 3): readouts
 * `sm.mass`, `sm.speed` and `sm.at(P)` (`sm.at(x, y, z)` for a grid in space), the algebra row text, the default look and
 * the cell limits.
 */
import { registerTypeStyle } from '../../graph/props';
import { registerLineCheck } from '../../graph/registry';
import { registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { registerValueText } from '../../language/runtime';
import type { FigureView } from '../../language/table';
import type { TNode } from '../../language/tnode';
import { T } from '../../language/types';
import type { Ty } from '../../language/types';
import { isSmokeValue, smokeLineCheck, spaceSmokeLineCheck } from './smoke';
import type { SmokeValue } from './smoke';

const smokeFields = (space: boolean): Readonly<Record<string, Ty>> => ({ mass: T.Number, speed: T.Number, n: T.Number, at: { k: 'Function', ret: 'Number', arity: space ? 3 : 2 } as Ty });

const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(2))) : 'undefined');

/** Do the first parenthesis group of a text hold three top-level parts (a point of three numbers)? */
function threeNumbers(s: string): boolean {
  let depth = 0;
  let commas = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) break;
    } else if (ch === ',' && depth === 1) commas++;
  }
  return commas === 2;
}

/**
 * Is the smoke or fire a target names in space? Told by its value when it has one, else by its line: the first argument
 * a solid in space (`Box((0, 0, 1), 4, 4, 3)`, a name of a `Point3` or a `Polyhedron`) or a point of three numbers.
 */
export function smokeInSpaceByLine(target: TNode, fig: FigureView): boolean {
  if (target.n !== 'ref') return false;
  const v = fig.read?.(target.id);
  if (isSmokeValue(v)) return v.spec.space === true;
  const src = fig.byId(target.id)?.source ?? '';
  const m = /(?:Smoke|Fire)\s*\(\s*(.*)$/.exec(src);
  if (!m) return false;
  const rest = m[1] as string;
  if (rest.startsWith('(')) return threeNumbers(rest);
  const call = /^[A-Za-z_]\w*\s*\((.*)$/.exec(rest);
  if (call) return (call[1] as string).startsWith('(') && threeNumbers(call[1] as string);
  const name = /^[A-Za-z_]\w*/.exec(rest)?.[0];
  const t = name !== undefined ? fig.lookup(name)?.type.k : undefined;
  return t === 'Point3' || t === 'Polyhedron';
}

/** The smoke at a point: the density of the cell it is in, 0 outside the box. */
export function smokeAt(v: SmokeValue, x: number, y: number): number {
  const s = v.spec;
  if (!(x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1)) return 0;
  const i = Math.min(s.n - 1, Math.floor(((x - s.x0) / (s.x1 - s.x0)) * s.n));
  const j = Math.min(s.n - 1, Math.floor(((y - s.y0) / (s.y1 - s.y0)) * s.n));
  return v.density[j * s.n + i] as number;
}

/** The index of the cell a point is in, for a grid in space, or −1 outside the box. */
export function cellOf3(s: SmokeValue['spec'], x: number, y: number, z: number): number {
  const z0 = s.z0 ?? 0;
  const z1 = s.z1 ?? 1;
  if (!(x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1 && z >= z0 && z <= z1)) return -1;
  const n = s.n;
  const i = Math.min(n - 1, Math.floor(((x - s.x0) / (s.x1 - s.x0)) * n));
  const j = Math.min(n - 1, Math.floor(((y - s.y0) / (s.y1 - s.y0)) * n));
  const k = Math.min(n - 1, Math.floor(((z - z0) / (z1 - z0)) * n));
  return (k * n + j) * n + i;
}

/** The smoke at a point in space: the density of the cell it is in, 0 outside the box. */
export function smokeAt3(v: SmokeValue, x: number, y: number, z: number): number {
  const c = cellOf3(v.spec, x, y, z);
  return c < 0 ? 0 : (v.density[c] as number);
}

export function registerSmoke(): void {
  registerFieldNames('Smoke', () => Object.keys(smokeFields(false)));
  registerFieldTyper('Smoke', (field, target, fig) => smokeFields(smokeInSpaceByLine(target, fig))[field]);
  registerFieldReader('Smoke', (field, v) => {
    if (!isSmokeValue(v)) return undefined;
    if (field === 'mass') return v.mass;
    if (field === 'speed') return v.speed;
    if (field === 'n') return v.spec.n;
    if (field === 'at') {
      // sm.at(x, y), or sm.at(x, y, z) in space: numbers, as c.at(i, j) of a cloth
      if (v.spec.space) {
        return {
          arity: 3,
          call: (x: unknown, y: unknown, z: unknown) => (typeof x === 'number' && typeof y === 'number' && typeof z === 'number' && Number.isFinite(x + y + z) ? smokeAt3(v, x, y, z) : undefined),
        };
      }
      return {
        arity: 2,
        call: (x: unknown, y: unknown) => (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y) ? smokeAt(v, x, y) : undefined),
      };
    }
    return undefined;
  });
  registerValueText((v) => (isSmokeValue(v) && !v.spec.fire ? `smoke, ${v.spec.n} by ${v.spec.n}${v.spec.space ? ` by ${v.spec.n}` : ''}, ${fmt(v.mass)} ${v.spec.space ? 'm³' : 'm²'} of smoke, air up to ${fmt(v.speed)} m/s` : undefined));
  registerTypeStyle('Smoke', { defaults: { color: '#5f6670', width: 1, opacity: 0.8 } });
  registerLineCheck(smokeLineCheck);
  registerLineCheck(spaceSmokeLineCheck);
}
