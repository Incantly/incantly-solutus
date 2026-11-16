/** The algebra view's model (docs/features/algebra-view/design.md 3.2, 3.6, 3.7, 3.13, 3.15), on a real figure. */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, registerFunctions, registerLists, registerNumbers } from '@incantly/kernel';
import { DEFAULT_PREFS, algebraRows, prefsFromScript, suggestionsFor } from '../src/index';
import type { AlgebraObject, AlgebraPrefs } from '../src/index';

const registry = new CommandRegistry();
geometry.registerGeometry(registry);
registerNumbers(registry);
registerFunctions(registry);
registerLists(registry);

const fig = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: registry });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${r.message}`);
  }
  return f;
};
const objs = (f: Figure): AlgebraObject[] => f.objects() as unknown as AlgebraObject[];
const rows = (f: Figure, p: Partial<AlgebraPrefs> = {}) => algebraRows(objs(f), { ...DEFAULT_PREFS, ...p });

const LINES = ['a = 3 in 0..10', 'A = (1, 2)', 'B = (5, 2)', 'M = Midpoint(A, B)', 'c = Circle(M, a)', 'h = a + 1', 'f(x) = x^2 - 2', 'L = Line(A, B)', 'Z = Intersect(L, Line((0, 0), (1, 0)))'];

describe('rows and display modes (3.2)', () => {
  it('definition and value: a second row only when it adds something', () => {
    const r = rows(fig(LINES)).rows;
    const by = (n: string) => r.find((x) => x.name === n);
    expect(by('A')?.lines).toEqual(['A = (1, 2)', null]);
    expect(by('M')?.lines).toEqual(['M = Midpoint(A, B)', '= (3, 2)']);
    expect(by('c')?.lines).toEqual(['c = Circle(M, a)', '(x − 3)² + (y − 2)² = 9']);
    expect(by('f')?.lines).toEqual(['f(x) = x² − 2', null]);
    expect(by('a')?.slider).toEqual({ min: 0, max: 10, step: 0.1, value: 3 });
  });
  it('value, definition and description modes', () => {
    const f = fig(LINES);
    expect(rows(f, { mode: 'value' }).rows.find((x) => x.name === 'M')?.lines).toEqual(['M = (3, 2)', null]);
    expect(rows(f, { mode: 'definition' }).rows.find((x) => x.name === 'M')?.lines).toEqual(['M = Midpoint(A, B)', null]);
    expect(rows(f, { mode: 'description' }).rows.find((x) => x.name === 'M')?.lines).toEqual(['M: Midpoint of A and B', '(3, 2)']);
  });
  it('rounding follows the format', () => {
    const f = fig(['k = 1 / 3']);
    // a constant is a free number, shown by its value
    expect(rows(f).rows[0]?.lines[0]).toBe('k = 0.33');
    expect(rows(f, { format: { ...DEFAULT_PREFS.format, decimals: 4 } }).rows[0]?.lines[0]).toBe('k = 0.3333');
    expect(rows(f).rows[0]?.approx).toBe(true);
  });
});

describe('sorting, groups, filters and helpers (3.6)', () => {
  it('creation order by default; type, dependency and name sorts', () => {
    const f = fig(LINES);
    expect(rows(f).rows.map((r) => r.name)).toEqual(['a', 'A', 'B', 'M', 'c', 'h', 'f', 'L', 'Z']);
    expect(rows(f, { sort: 'type' }).groups.map((g) => g.label)).toEqual(['Numbers and sliders', 'Points and vectors', 'Lines and segments', 'Circles and conics', 'Functions and curves']);
    const dep = rows(f, { sort: 'dependency' }).groups;
    expect(dep.map((g) => g.label)).toEqual(['Free', 'Dependent']);
    // by depth (a function of x only has depth 0), then by creation
    expect(dep[1]?.rows.map((r) => r.name)).toEqual(['f', 'M', 'h', 'L', 'c', 'Z']);
    expect(rows(fig(['P_10 = (0, 0)', 'P_2 = (1, 1)', 'p = 1']), { sort: 'name' }).rows.map((r) => r.name)).toEqual(['p', 'P_2', 'P_10']);
  });
  it('filter by text, undefined only, hidden only; helpers hidden unless asked', () => {
    const f = fig([...LINES, 'B with visible = false', 'h with aux = true']);
    expect(rows(f, { filter: { text: 'circle', onlyUndefined: false, onlyHidden: false } }).rows.map((r) => r.name)).toEqual(['c']);
    expect(rows(f, { filter: { text: '', onlyUndefined: true, onlyHidden: false } }).rows.map((r) => r.name)).toEqual(['Z']);
    expect(rows(f, { filter: { text: '', onlyUndefined: false, onlyHidden: true } }).rows.map((r) => r.name)).toEqual(['B']);
    expect(rows(f).rows.some((r) => r.name === 'h')).toBe(false);
    expect(rows(f, { showAux: true }).rows.some((r) => r.name === 'h')).toBe(true);
  });
});

describe('dependency expansion and the undefined chain (3.7)', () => {
  it('made from, used by and why it is undefined', () => {
    const f = fig([...LINES, 'W = Midpoint(Z, A)']);
    const by = (n: string) => rows(f).rows.find((x) => x.name === n);
    expect(by('M')?.madeFrom).toEqual(['A', 'B']);
    expect(by('M')?.usedBy).toEqual(['c']);
    expect(by('W')?.undefinedInfo?.chain).toEqual(['W: an input is undefined', 'Z: the lines are parallel']);
    expect(by('M')?.descriptionText).toBe('Midpoint of A and B');
  });
});

describe('@algebra directives (3.15) and next-step cards (3.13)', () => {
  it('directives set the mode, sort, rounding, helpers and input', () => {
    const p = prefsFromScript('@algebra mode value\n@algebra sort type\n@algebra round 4\n@algebra aux show\n@algebra input Midpoint Segment');
    expect([p.mode, p.sort, p.format.decimals, p.showAux, p.input]).toEqual(['value', 'type', 4, true, { kind: 'commands', names: ['Midpoint', 'Segment'] }]);
    expect(prefsFromScript('@algebra input off').input).toEqual({ kind: 'off' });
  });
  it('cards for a new function and a line meeting a circle, not when already done', () => {
    const f = fig(LINES);
    const r = rows(f).rows;
    const names = ['r1', 'r2', 'r3'];
    const free = (): string => names.shift() as string;
    expect(suggestionsFor(r.find((x) => x.name === 'f')!, objs(f), { x0: -5, x1: 5 }, free)[0]?.lines).toEqual(['r1 = Roots(f, -5, 5)']);
    expect(suggestionsFor(r.find((x) => x.name === 'L')!, objs(f), { x0: -5, x1: 5 }, () => 'P')[0]?.text).toBe('Mark where L and c meet');
    const g = fig([...LINES, 'rs = Roots(f, -5, 5)']);
    expect(suggestionsFor(rows(g).rows.find((x) => x.name === 'f')!, objs(g), { x0: -5, x1: 5 }, () => 'q')[0]?.id).toBe('extremum');
  });
});

describe('speed (3.16)', () => {
  it('rows for 2,000 objects', { retry: 2 }, () => {
    const lines = ['a = 1 in 0..10'];
    for (let i = 0; i < 1000; i++) lines.push(`P${i} = (${i % 50}, ${Math.floor(i / 50)})`, `Q${i} = Midpoint(P${i}, (a, 0))`);
    const f = fig(lines);
    const o = objs(f);
    algebraRows(o);
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) algebraRows(o);
    const ms = (performance.now() - t0) / 5;
    process.stdout.write(`algebra rows, 2,001 objects: ${ms.toFixed(2)} ms\n`);
    expect(ms).toBeLessThan(40);
  });
});
