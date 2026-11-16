/** Settings, languages and keyboard layouts (.kiro/specs/app-modes R6, R7, R8.1, R8.2). */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, registerFunctions, registerNumbers, registerProbability, registerStatistics } from '@incantly/kernel';
import {
  EN_MESSAGES, I18n, LAYOUTS, MODES, SETTINGS, STORAGE_KEY, Settings, applyKey, catalogueOf, compilePolicy, deriveMode, directionOf, layoutFor, localeChain, normaliseDigits, validateLayout,
} from '../../src/index';
import type { Key, StorageLike } from '../../src/index';

class MemStore implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

describe('the settings registry (R6.1, R6.2)', () => {
  it('has every setting of the table with a scope, a group and a label in the catalogue', () => {
    const ids = SETTINGS.map((s) => s.id);
    for (const id of ['angleUnit', 'rounding', 'coordinates', 'undoLimit', 'axes', 'grid', 'keepRatio', 'snapToGrid', 'pointSnap', 'showLabels', 'defaultLineWidth', 'defaultPointSize', 'fontSize', 'sort', 'description', 'keyboard', 'keyboardLayout', 'reducedMotion', 'highContrast', 'textScale', 'screenReaderMode', 'language', 'decimalSeparator']) {
      expect(ids).toContain(id);
    }
    for (const s of SETTINGS) expect(EN_MESSAGES[s.label]).toBeTruthy();
    for (const m of Object.values(MODES)) for (const id of m.settings) expect(ids).toContain(id);
  });

  it('defaults come from the mode', () => {
    const s = new Settings({ mode: MODES.geometry, storage: new MemStore() });
    expect(s.get('angleUnit')).toBe('degree');
    expect(s.get('axes')).toBe(false);
    expect(s.get('undoLimit')).toBe(200);
    s.setMode(MODES.graphing);
    expect(s.get('angleUnit')).toBe('radian');
  });

  it('validates values', () => {
    const s = new Settings({ mode: MODES.graphing, storage: new MemStore() });
    expect(s.set('rounding', { mode: 'decimals', digits: 16 })).toMatchObject({ ok: false, kind: 'setting_invalid' });
    expect(s.set('textScale', 500)).toMatchObject({ ok: false, kind: 'setting_invalid', message: 'textScale must be a whole number from 80 to 200.' });
    expect(s.set('angleUnit', 'gradian')).toMatchObject({ ok: false, kind: 'setting_invalid', allowed: ['radian', 'degree'] });
    expect(s.set('angleUnits', 'degree')).toMatchObject({ ok: false, kind: 'unknown_setting', hint: 'Did you mean angleUnit?' });
    expect(s.set('rounding', { mode: 'sig', digits: 4 })).toEqual({ ok: true, changed: true });
    expect(s.set('rounding', { mode: 'sig', digits: 4 })).toEqual({ ok: true, changed: false });
  });

  it('tells listeners, resets a group to the mode defaults, marks changed values', () => {
    const s = new Settings({ mode: MODES.graphing, storage: new MemStore() });
    const seen: string[] = [];
    s.onChange('*', (id, v) => seen.push(`${id}=${JSON.stringify(v)}`));
    s.set('axes', false);
    s.set('grid', 'minor');
    s.set('angleUnit', 'degree');
    expect(s.isChanged('axes')).toBe(true);
    s.reset('graphics');
    expect(s.get('axes')).toBe(true);
    expect(s.get('grid')).toBe('major');
    expect(s.get('angleUnit')).toBe('degree');
    expect(seen).toEqual(['axes=false', 'grid="minor"', 'angleUnit="degree"', 'axes=true', 'grid="major"']);
  });

  it('locked settings refuse, show who locked them, and survive reset', () => {
    const s = new Settings({ mode: MODES.graphing, storage: new MemStore() });
    s.set('angleUnit', 'degree');
    s.lock(['angleUnit'], "exam profile 'basic'");
    expect(s.set('angleUnit', 'radian')).toMatchObject({ ok: false, kind: 'setting_locked', message: "angleUnit is locked by exam profile 'basic'." });
    s.reset();
    expect(s.get('angleUnit')).toBe('degree');
    s.unlock();
    expect(s.set('angleUnit', 'radian').ok).toBe(true);
  });

  it('snapshot and restore', () => {
    const s = new Settings({ mode: MODES.graphing, storage: new MemStore() });
    s.set('textScale', 150);
    const snap = s.snapshot();
    s.set('textScale', 90);
    s.set('highContrast', true);
    s.restore(snap);
    expect(s.get('textScale')).toBe(150);
    expect(s.get('highContrast')).toBe(false);
  });

  it('the panel offers only the mode\'s settings', () => {
    const sci = new Settings({ mode: MODES.scientific, storage: new MemStore() }).panel();
    const ids = sci.flatMap((g) => g.defs.map((d) => d.id));
    expect(ids).toContain('angleUnit');
    expect(ids).not.toContain('axes');
    expect(sci.map((g) => g.group)).not.toContain('graphics');
  });
});

describe('persistence (R6.3)', () => {
  it('user settings go to storage; file settings do not', () => {
    const store = new MemStore();
    const s = new Settings({ mode: MODES.graphing, storage: store });
    s.set('textScale', 120);
    s.set('angleUnit', 'degree');
    const saved = JSON.parse(store.getItem(STORAGE_KEY) ?? '{}') as { v: number; values: Record<string, unknown> };
    expect(saved).toEqual({ v: 1, values: { textScale: 120 } });
    expect(new Settings({ mode: MODES.graphing, storage: store }).get('textScale')).toBe(120);
  });

  it('bad or future data gives defaults and keeps the record under another key', () => {
    for (const raw of ['{not json', JSON.stringify({ v: 9, values: {} })]) {
      const store = new MemStore();
      store.setItem(STORAGE_KEY, raw);
      const s = new Settings({ mode: MODES.graphing, storage: store });
      expect(s.get('textScale')).toBe(100);
      expect(s.problems.map((p) => p.kind)).toEqual(['storage_corrupt']);
      expect(store.getItem(`${STORAGE_KEY}.bad`)).toBe(raw);
    }
  });

  it('a stored value of the wrong type is dropped', () => {
    const store = new MemStore();
    store.setItem(STORAGE_KEY, JSON.stringify({ v: 1, values: { textScale: 900, highContrast: true, angleUnit: 'degree' } }));
    const s = new Settings({ mode: MODES.graphing, storage: store });
    expect(s.get('textScale')).toBe(100);
    expect(s.get('highContrast')).toBe(true);
    expect(s.get('angleUnit')).toBe('radian');
  });

  it('no storage keeps settings in memory and says so once', () => {
    const s = new Settings({ mode: MODES.graphing, storage: null });
    expect(s.set('textScale', 140).ok).toBe(true);
    expect(s.get('textScale')).toBe(140);
    expect(s.problems).toEqual([{ kind: 'storage_unavailable', message: 'Settings will not be saved on this device.' }]);
    const broken: StorageLike = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => undefined };
    const t = new Settings({ mode: MODES.graphing, storage: broken });
    t.set('textScale', 130);
    expect(t.get('textScale')).toBe(130);
    expect(t.problems.map((p) => p.kind)).toEqual(['storage_unavailable']);
  });
});

describe('file settings are lines (R6.4)', () => {
  it('writes and reads directive lines that the kernel accepts', () => {
    const s = new Settings({ mode: MODES.graphing, storage: new MemStore() });
    s.set('angleUnit', 'degree');
    s.set('rounding', { mode: 'sig', digits: 4 });
    s.set('coordinates', 'polar');
    s.set('axes', false);
    s.set('textScale', 150);
    const lines = s.toDirectives();
    expect(lines).toEqual(['@angleunit degree', '@rounding 4s', '@coords polar', '@axes off']);
    const r = new CommandRegistry();
    registerNumbers(r);
    const f = new Figure({ commands: r });
    for (const l of lines) expect(f.apply(l).ok).toBe(true);
    const t = new Settings({ mode: MODES.graphing, storage: new MemStore() });
    expect(t.fromDirectives(f.toScript().split('\n'))).toEqual(['angleUnit', 'rounding', 'coordinates', 'axes']);
    expect(t.get('rounding')).toEqual({ mode: 'sig', digits: 4 });
    expect(t.toDirectives()).toEqual(lines);
  });
});

describe('languages (R7)', () => {
  it('falls back fr-CA -> fr -> en', () => {
    expect(localeChain('fr-CA')).toEqual(['fr-CA', 'fr', 'en']);
    expect(localeChain('en')).toEqual(['en']);
  });

  it('loads a locale on demand and shows its text, with English for missing keys, warned once', async () => {
    const missing: string[] = [];
    const i = new I18n({ onMissing: (k, l) => missing.push(`${l}:${k}`) });
    expect(i.t('mode.geometry.title')).toBe('Geometry');
    const r = await i.setLocale('fr-CA');
    expect(r.used).toBe('fr');
    expect(i.t('mode.geometry.title')).toBe('Géométrie');
    expect(i.t('kb.square')).toBe('squared');
    i.t('kb.square');
    expect(missing).toEqual(['fr-CA:kb.square']);
    expect(i.t('no.such.key')).toBe('no.such.key');
  });

  it('an unknown locale falls back to English', async () => {
    const i = new I18n();
    const r = await i.setLocale('xx');
    expect(r).toEqual({ used: 'en', fellBack: true, error: 'locale_unavailable' });
  });

  it('plurals and parameters', async () => {
    const i = new I18n();
    expect(i.t('app.switchLoses', { n: 1 })).toBe("1 object can't be used there and will be removed:");
    expect(i.t('app.switchLoses', { n: 12 })).toBe("12 objects can't be used there and will be removed:");
    await i.setLocale('fr');
    expect(i.t('app.switchLoses', { n: 1 })).toMatch(/^1 objet ne peut/);
    expect(i.t('app.switchTitle', { mode: 'Scientifique' })).toBe('Passer à Scientifique ?');
  });

  it('numbers follow the locale for display; lines keep the point', async () => {
    const i = new I18n();
    expect(i.formatNumber(2.5)).toBe('2.5');
    await i.setLocale('fr');
    expect(i.formatNumber(2.5)).toBe('2,5');
    expect(i.decimalMark()).toBe(',');
    expect(i.formatNumber(2.5, { decimalSeparator: '.' })).toBe('2.5');
  });

  it('right-to-left locales', async () => {
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('ar-EG')).toBe('rtl');
    expect(directionOf('fr')).toBe('ltr');
    const i = new I18n();
    await i.setLocale('ar');
    expect(i.dir).toBe('rtl');
    expect(i.t('settings.title')).toBe('الإعدادات');
  });

  it('other digit scripts become Latin digits', () => {
    expect(normaliseDigits('٣٫٥ + ۴')).toBe('3.5 + 4');
    expect(normaliseDigits('२ * ३')).toBe('2 * 3');
    expect(normaliseDigits('x = 12')).toBe('x = 12');
  });
});

describe('keyboard layouts (R8.1, R8.2)', () => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerStatistics(r);
  registerProbability(r);
  const CAT = catalogueOf(r.all());
  const names = CAT.map((c) => c.name);

  it('every layout is valid: spoken names in the catalogue, unique ids, known commands', () => {
    for (const l of Object.values(LAYOUTS)) expect(validateLayout(l, { commands: names, messages: EN_MESSAGES })).toEqual([]);
  });

  it('the validator catches a key with no spoken name, a duplicate id and an unknown command', () => {
    const bad = { id: 'standard' as const, tabs: [{ id: 't', label: 't', aria: 'kb.tab.main', rows: [[{ id: 'a', label: 'a', aria: '', action: { kind: 'insert', text: 'a' } }, { id: 'a', label: 'b', aria: 'kb.plus', action: { kind: 'command', name: 'Nope' } }] as Key[]] }] };
    expect(validateLayout(bad, { commands: names }).map((p) => p.why)).toEqual(['no spoken name', 'key a appears twice in tab t', 'unknown command Nope']);
  });

  it('keys for forbidden commands are not built', () => {
    const geo = layoutFor('standard', compilePolicy(MODES.geometry), CAT).layout;
    const fx = geo.tabs.find((t) => t.id === 'fx');
    const ids = fx?.rows.flat().map((k) => k.id) ?? [];
    expect(ids).toContain('cmd-Root');
    expect(ids).not.toContain('cmd-Derivative');
    expect(ids).not.toContain('cmd-Integral');
    const exam = deriveMode(MODES.scientific, { base: 'scientific', denyFunctions: ['ln'] });
    if (!exam.ok) throw new Error();
    const sci = layoutFor('scientific', compilePolicy(exam.value), CAT).layout;
    expect(sci.tabs[0]?.rows.flat().map((k) => k.id)).not.toContain('fn-ln');
  });

  it('an unknown layout falls back to standard', () => {
    const r2 = layoutFor('moon', compilePolicy(MODES.graphing), CAT);
    expect(r2.fellBack).toBe(true);
    expect(r2.layout.id).toBe('standard');
  });

  it('keys edit a line', () => {
    expect(applyKey({ kind: 'insert', text: 'sin()', cursor: 4 }, 'x + ', 4)).toEqual({ text: 'x + sin()', caret: 8 });
    expect(applyKey({ kind: 'template', template: 'fraction' }, '', 0)).toEqual({ text: '()/()', caret: 1 });
    expect(applyKey({ kind: 'template', template: 'root' }, '2', 0, 1)).toEqual({ text: 'sqrt(2)', caret: 6 });
    expect(applyKey({ kind: 'template', template: 'square' }, 'x', 1)).toEqual({ text: 'x^2', caret: 3 });
    expect(applyKey({ kind: 'command', name: 'Midpoint' }, '', 0)).toEqual({ text: 'Midpoint()', caret: 9 });
    expect(applyKey({ kind: 'edit', op: 'backspace' }, 'abc', 2)).toEqual({ text: 'ac', caret: 1 });
    expect(applyKey({ kind: 'edit', op: 'enter' }, 'abc', 2)).toEqual({ done: 'enter' });
    expect(applyKey({ kind: 'edit', op: 'clear' }, 'abc', 2)).toEqual({ text: '', caret: 0 });
  });

  it('the scientific page has shift functions and Ans', () => {
    const keys = LAYOUTS.scientific.tabs[0]?.rows.flat() ?? [];
    expect(keys.find((k) => k.id === 'fn-sin')?.shifted?.label).toBe('sin⁻¹');
    expect(keys.some((k) => k.id === 'ans')).toBe(true);
    expect(keys.some((k) => k.id === 'sd')).toBe(true);
  });
});
