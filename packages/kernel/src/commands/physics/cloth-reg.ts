/**
 * The one-time registration of cloth (docs/features/physics/design.md 2.4; ui.md 6, 7 and 10; errors.md 3, 5):
 * readouts `c.count`, `c.torn`, `c.stretchMax`, `c.energy`, `c.at(i, j)`, `c.asleep`, `c.touching`, the algebra row
 * text, the default look, the limits and the notices.
 */
import { registerNotice } from '../../errors/notices';
import { registerTypeStyle } from '../../graph/props';
import { registerLineCheck } from '../../graph/registry';
import { registerFieldNames, registerFieldTyper } from '../../language/check';
import { registerFieldReader } from '../../language/compile';
import { registerValueText } from '../../language/runtime';
import type { FigureView } from '../../language/table';
import type { TNode } from '../../language/tnode';
import { T } from '../../language/types';
import type { Ty } from '../../language/types';
import type { ClothValue } from './cloth';
import { clothLineCheck, isClothValue, isPinValue } from './cloth';

const fmt = (x: number): string => (Number.isFinite(x) ? String(Number(x.toFixed(2))) : 'undefined');

/** Is the cloth a target names in space (a sheet)? Told by its line: the first argument a point of three numbers. */
function inSpaceByLine(target: TNode, fig: FigureView): boolean {
  if (target.n !== 'ref') return false;
  const src = fig.byId(target.id)?.source ?? '';
  const m = /Cloth\s*\(\s*(.*)$/.exec(src);
  if (!m) return false;
  const s = m[1] as string;
  if (s.startsWith('(')) {
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
  const name = /^[A-Za-z_]\w*/.exec(s)?.[0];
  return name !== undefined && fig.lookup(name)?.type.k === 'Point3';
}

/** The point (i, j) of a cloth now, counted from 1 along u and v (a rope's j is not read). */
export function clothAt(v: ClothValue, i: number, j: number): { x: number; y: number; z?: number } | undefined {
  const { nu, nv } = v.spec;
  const a = Math.round(i) - 1;
  const b = v.spec.nv === 1 ? 0 : Math.round(j) - 1;
  if (!(a >= 0 && a < nu && b >= 0 && b < nv)) return undefined;
  const k = b * nu + a;
  return v.spec.space ? { x: v.xs[k] as number, y: v.ys[k] as number, z: v.zs[k] as number } : { x: v.xs[k] as number, y: v.ys[k] as number };
}

/** The algebra row's live line (ui.md 6) and the hidden list's sentence (ui.md 10). */
export function clothRow(v: ClothValue, name: string): { grid: string; live: string; spoken: string } {
  const s = v.spec;
  const grid = s.kind === 'rope' ? `${s.nu} points` : `${s.nu} by ${s.nv}`;
  const pins = s.pinWords === '' ? 'free' : /^\d/.test(s.pinWords) ? `pinned at ${s.pinWords}` : s.pinWords === 'top' || s.pinWords === 'left' ? `pinned on the ${s.pinWords}` : `pinned at the ${s.pinWords}`;
  const live = `most stretched ${Math.max(0, Math.round((v.stretchMax - 1) * 100))}%, ${v.torn} torn`;
  const moving = v.asleep ? 'still' : 'waving';
  const spoken = `Cloth ${name}, ${s.kind === 'rope' ? `a rope of ${s.nu} points` : `${s.nu} by ${s.nv} points`}, ${pins}, ${moving}, ${v.torn} torn`;
  return { grid, live, spoken };
}

export function registerCloth(): void {
  const fields = (space: boolean): Readonly<Record<string, Ty>> => ({
    count: T.Number, torn: T.Number, stretchMax: T.Number, energy: T.Number, asleep: T.Bool, touching: { k: 'List', of: T.Text } as Ty, burnt: T.Number,
    at: { k: 'Function', ret: space ? 'Point3' : 'Point', arity: 2 } as Ty,
  });
  registerFieldNames('Cloth', () => Object.keys(fields(false)));
  registerFieldTyper('Cloth', (field, target, fig) => fields(inSpaceByLine(target, fig))[field]);
  registerFieldReader('Cloth', (field, v) => {
    if (!isClothValue(v)) return undefined;
    switch (field) {
      case 'count':
        return v.spec.nu * v.spec.nv;
      case 'torn':
        return v.torn;
      case 'stretchMax':
        return v.stretchMax;
      case 'energy':
        return v.energy;
      case 'asleep':
        return v.asleep;
      case 'touching':
        return [...v.touching];
      case 'burnt':
        return v.burnt ?? 0;
      case 'at':
        return { arity: 2, call: (i: unknown, j: unknown) => (typeof i === 'number' && typeof j === 'number' ? clothAt(v, i, j) : undefined) };
      default:
        return undefined;
    }
  });
  registerFieldNames('Pin', () => []);
  registerValueText((v) => {
    if (isClothValue(v)) {
      const r = clothRow(v, '');
      return `cloth, ${r.grid}${v.spec.pinWords ? `, ${v.spec.pinWords === 'top' || v.spec.pinWords === 'left' ? `pinned on the ${v.spec.pinWords}` : `pinned at ${v.spec.pinWords}`}` : ''}, ${r.live}${v.asleep ? ', asleep' : ''}`;
    }
    if (isPinValue(v)) return `pin at (${fmt(v.at.x)}, ${fmt(v.at.y)}${v.space ? `, ${fmt(v.at.z)}` : ''})${v.body ? ', to a body' : ''}`;
    return undefined;
  });
  registerTypeStyle('Cloth', { defaults: { color: '#e8a25a', width: 1, opacity: 0.9 } });
  registerTypeStyle('Pin', { defaults: { color: '#2b2f36', width: 2 } });
  registerLineCheck(clothLineCheck);
  registerNotice('torn', { code: 'B113', severity: 'info', template: '{name} tore at t = {t} s: {links} links.' });
  registerNotice('cloth_drawn_coarse', { code: 'B114', severity: 'info', template: '{name} is drawn coarser on this computer; it moves the same.' });
}
