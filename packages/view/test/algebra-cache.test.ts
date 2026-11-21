/** The row cache of the algebra view (docs/features/algebra-view/design.md 3.16): rows are made again only when they change. */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, registerNumbers } from '@incantly/kernel';
import { AlgebraCache, DEFAULT_PREFS, algebraRows, refreshAlgebraRows } from '../src/index';
import type { AlgebraObject } from '../src/index';

const registry = new CommandRegistry();
registerNumbers(registry);
const fig = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: registry });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${r.message}`);
  }
  return f;
};
const objs = (f: Figure): AlgebraObject[] => f.objects() as unknown as AlgebraObject[];

describe('AlgebraCache', () => {
  it('reuses rows that did not change and remakes the ones that did', () => {
    const f = fig(['a = 1 in 0..10', 'b = a + 1', 'c = 5']);
    const cache = new AlgebraCache();
    const first = algebraRows(objs(f), DEFAULT_PREFS, cache).rows;
    expect(cache.made).toBe(3);
    f.setFree('a', 4, 'slider');
    f.flush();
    const next = algebraRows(objs(f), DEFAULT_PREFS, cache).rows;
    expect(cache.made).toBe(2);
    expect(cache.reused).toBe(1);
    expect(next.find((r) => r.name === 'c')).toBe(first.find((r) => r.name === 'c'));
    expect(next.find((r) => r.name === 'b')?.lines[1]).toBe('= 5');
  });

  it('cached rows read the same as fresh ones', () => {
    const f = fig(['a = 2', 'b = a * 3', 'c = b + a']);
    const cache = new AlgebraCache();
    algebraRows(objs(f), DEFAULT_PREFS, cache);
    const cached = algebraRows(objs(f), DEFAULT_PREFS, cache).rows.map((r) => JSON.stringify(r));
    const fresh = algebraRows(objs(f), DEFAULT_PREFS).rows.map((r) => JSON.stringify(r));
    expect(cached).toEqual(fresh);
  });

  it('a new reader shows in "used by" of a reused row', () => {
    const f = fig(['a = 1', 'b = a + 1']);
    const cache = new AlgebraCache();
    algebraRows(objs(f), DEFAULT_PREFS, cache);
    f.apply('c = 2 a');
    const a = algebraRows(objs(f), DEFAULT_PREFS, cache).rows.find((r) => r.name === 'a');
    expect(a?.usedBy).toEqual(['b', 'c']);
  });

  it('a change of display mode remakes every row', () => {
    const f = fig(['a = 1', 'b = a + 1']);
    const cache = new AlgebraCache();
    algebraRows(objs(f), DEFAULT_PREFS, cache);
    algebraRows(objs(f), { ...DEFAULT_PREFS, mode: 'value' }, cache);
    expect(cache.made).toBe(2);
  });

  it('refreshAlgebraRows remakes only the objects whose value moved', () => {
    const f = fig(['a = 1 in 0..10', 'b = a + 1', 'c = 5']);
    const cache = new AlgebraCache();
    algebraRows(objs(f), DEFAULT_PREFS, cache);
    f.setFree('a', 6, 'slider');
    f.flush();
    const b = f.get('b') as unknown as AlgebraObject;
    const c = f.get('c') as unknown as AlgebraObject;
    const [rb, rc] = refreshAlgebraRows([b, c], DEFAULT_PREFS, cache) ?? [];
    expect(rb?.valueText).toBe('7');
    expect(rc).toBe(cache.rows.get(c.id)?.row);
  });

  it('refreshAlgebraRows declines without an earlier full call', () => {
    const f = fig(['a = 1']);
    expect(refreshAlgebraRows(objs(f), DEFAULT_PREFS, new AlgebraCache())).toBeUndefined();
  });
});
