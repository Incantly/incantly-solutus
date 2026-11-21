/** The mode records, compiled policies, derived modes and the model's view of a mode (.kiro/specs/app-modes R1, R2, R10.6). */
import { describe, expect, it } from 'vitest';
import {
  I18n, MODES, MODE_IDS, EXAM_PROFILES, allowedInstead, availableModes, compilePolicy, deriveMode, filterCatalogue, getMode, modeCard, modeSummary, parseRestrict,
} from '../../src/index';
import type { CommandRef, ModeConfig } from '../../src/index';

const CAT: CommandRef[] = [
  { name: 'Point', group: 'geometry' }, { name: 'Midpoint', group: 'geometry' }, { name: 'Circle', group: 'conics' }, { name: 'Ellipse', group: 'conics' },
  { name: 'Polygon', group: 'polygons' }, { name: 'Rotate', group: 'transforms' }, { name: 'Derivative', group: 'functions' }, { name: 'Integral', group: 'functions' },
  { name: 'Tangent', group: 'functions' }, { name: 'Root', group: 'functions' }, { name: 'Extremum', group: 'functions' }, { name: 'Mean', group: 'stats' },
  { name: 'Median', group: 'stats' }, { name: 'Histogram', group: 'charts' }, { name: 'Normal', group: 'distributions' }, { name: 'Prob', group: 'probability' },
  { name: 'Factor', group: 'symbolic' }, { name: 'Delete', group: 'figure' }, { name: 'Seq', group: 'lists' }, { name: 'Button', group: 'controls' },
];

describe('the mode records (R1)', () => {
  it('has the nine modes, each JSON data with no functions', () => {
    expect(MODE_IDS.sort()).toEqual(['cas', 'classic', 'figure', 'geometry', 'graphing', 'graphing3d', 'notes', 'probability', 'scientific']);
    for (const m of Object.values(MODES)) {
      expect(JSON.parse(JSON.stringify(m))).toEqual(m);
      expect(m.views.initial.every((v) => m.views.available.includes(v))).toBe(true);
    }
  });

  it('follows the mode table', () => {
    expect(MODES.geometry.defaults.angleUnit).toBe('degree');
    expect(MODES.geometry.defaults.axes).toBe(false);
    expect(MODES.geometry.defaults.previewPoints).toBe(true);
    expect(MODES.graphing.defaults.autoSliders).toBe(true);
    expect(MODES.graphing.views.initial).toEqual(['algebra', 'graphics']);
    expect(MODES.scientific.views.initial).toEqual(['results']);
    expect(MODES.scientific.features.ansButton).toBe(true);
    expect(MODES.scientific.keyboard).toBe('scientific');
    expect(MODES.figure.ui.inputBar).toBe(false);
    expect(MODES.cas.views.initial).toEqual(['cas']);
    expect(MODES.cas.features.inputBar).toBe(false);
    expect(MODES.classic.features.scripting).toBe(true);
    expect(MODES.probability.views.initial).toEqual(['distribution', 'graphics']);
  });

  it('the board (notes) and 3D are available', () => {
    expect(getMode('graphing3d').ok).toBe(true);
    expect(getMode('notes').ok).toBe(true);
    expect(availableModes().map((m) => m.id)).toContain('notes');
  });

  it('gives the closest id for an unknown mode', () => {
    const r = getMode('geometri');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('unknown_mode');
    expect(r.hint).toContain("'geometry'");
  });

  it('checks commands by group, add and deny', () => {
    const g = compilePolicy(MODES.geometry);
    expect(g.command('Midpoint', 'geometry')).toBe(true);
    expect(g.command('Root', 'functions')).toBe(true);
    expect(g.command('Derivative', 'functions')).toBe(false);
    const s = compilePolicy(MODES.scientific);
    expect(s.command('Mean', 'stats')).toBe(true);
    expect(s.command('Median', 'stats')).toBe(true);
    expect(s.command('Circle', 'conics')).toBe(false);
    expect(compilePolicy(MODES.figure).command('Anything', 'whatever')).toBe(true);
    expect(compilePolicy(MODES.scientific)).toBe(s);
  });

  it('checks tools and views', () => {
    const g = compilePolicy(MODES.graphing);
    expect(g.tool('point', 'point')).toBe(true);
    expect(g.tool('tangents', 'special-line')).toBe(true);
    expect(g.tool('angle-bisector', 'special-line')).toBe(false);
    expect(g.tool('polyline', 'line')).toBe(false);
    expect(compilePolicy(MODES.scientific).tool('point', 'point')).toBe(false);
    expect(g.view('sheet')).toBe(true);
    expect(g.view('cas')).toBe(false);
  });

  it('a check is a set lookup (design 5: under 5 µs)', { retry: 2 }, () => {
    const p = compilePolicy(MODES.graphing);
    const t0 = performance.now();
    let n = 0;
    for (let i = 0; i < 100_000; i++) if (p.command(i % 2 ? 'Derivative' : 'Circle', i % 2 ? 'functions' : 'conics')) n++;
    const per = ((performance.now() - t0) / 100_000) * 1000;
    expect(n).toBeGreaterThan(0);
    expect(per).toBeLessThan(5);
  });
});

describe('deriving a mode (R2)', () => {
  it('narrows: commands, views, tools, features', () => {
    const r = deriveMode(MODES.graphing, { base: 'graphing', hideViews: ['algebra'], denyCommands: ['Derivative'], denyTools: ['slider'], features: { share: false } }, { commands: CAT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = r.value;
    expect(m.derivedFrom).toBe('graphing');
    expect(m.views.initial).toEqual(['graphics']);
    expect(m.features.share).toBe(false);
    const p = compilePolicy(m);
    expect(p.command('Derivative', 'functions')).toBe(false);
    expect(p.command('Integral', 'functions')).toBe(true);
    expect(p.tool('slider', 'action')).toBe(false);
    expect(MODES.graphing.features.share).toBe(true);
  });

  it('never widens: a feature turned on and an allow-only name the base forbids are ignored with warnings', () => {
    const r = deriveMode(MODES.geometry, { base: 'geometry', features: { cas: true }, allowOnlyCommands: ['Midpoint', 'Derivative'], defaults: { autoSliders: true } }, { commands: CAT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.features.cas).toBe(false);
    expect(r.value.defaults.autoSliders).toBe(false);
    expect(r.warnings?.map((w) => w.kind)).toEqual(['restriction_widens', 'restriction_widens', 'restriction_widens']);
    const p = compilePolicy(r.value);
    expect(p.command('Midpoint', 'geometry')).toBe(true);
    expect(p.command('Derivative', 'functions')).toBe(false);
    expect(p.command('Circle', 'conics')).toBe(false);
  });

  it('a derived mode never exceeds its base, for every mode and a deny of everything in the catalogue', () => {
    for (const base of Object.values(MODES)) {
      const r = deriveMode(base, { base: base.id, allowOnlyCommands: CAT.map((c) => c.name), features: Object.fromEntries(Object.keys(base.features).map((k) => [k, true])) }, { commands: CAT });
      if (!r.ok) throw new Error(r.message);
      const a = compilePolicy(base);
      const b = compilePolicy(r.value);
      for (const c of CAT) if (b.command(c.name, c.group)) expect(a.command(c.name, c.group)).toBe(true);
      for (const [k, v] of Object.entries(r.value.features)) if (v) expect(base.features[k as keyof typeof base.features]).toBe(true);
    }
  });

  it('reports unknown names as restriction_invalid', () => {
    const r = deriveMode(MODES.graphing, { base: 'graphing', denyCommands: ['Derivatve'], hideViews: ['moon' as never] }, { commands: CAT });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings?.filter((w) => w.kind === 'restriction_invalid').flatMap((w) => w.names)).toEqual(['moon', 'Derivatve']);
  });

  it('refuses a restriction of another mode', () => {
    const r = deriveMode(MODES.graphing, { base: 'geometry' });
    expect(r.ok).toBe(false);
  });

  it('a derived mode can be derived again and stays narrow', () => {
    const one = deriveMode(MODES.graphing, { base: 'graphing', allowOnlyCommands: ['Derivative', 'Integral', 'Tangent'] }, { commands: CAT });
    if (!one.ok) throw new Error();
    const two = deriveMode(one.value, { base: 'graphing', allowOnlyCommands: ['Derivative', 'Mean'] }, { commands: CAT });
    if (!two.ok) throw new Error();
    expect(two.value.commands.only).toEqual(['Derivative']);
  });

  it('reads @restrict words', () => {
    const r = parseRestrict(MODES.graphing, ['hide=algebra', 'deny=Derivative,Integral', 'off=share']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ base: 'graphing', hideViews: ['algebra'], denyCommands: ['Derivative', 'Integral'], features: { share: false } });
    expect(parseRestrict(MODES.graphing, ['colour=red']).ok).toBe(false);
  });

  it('every exam profile narrows every mode that allows exams', () => {
    for (const m of Object.values(MODES) as ModeConfig[]) {
      for (const id of m.exam.profiles) {
        const r = deriveMode(m, { base: m.id, ...EXAM_PROFILES[id].restrict });
        expect(r.ok).toBe(true);
      }
    }
  });
});

describe('what the model sees (R10.6)', () => {
  it('the catalogue has only permitted commands', () => {
    const names = filterCatalogue(compilePolicy(MODES.scientific), CAT).map((c) => c.name);
    expect(names).toEqual(['Mean', 'Median']);
    expect(filterCatalogue(compilePolicy(MODES.figure), CAT)).toHaveLength(CAT.length);
  });

  it('allowedInstead picks permitted commands of the same group first', () => {
    const r = deriveMode(MODES.graphing, { base: 'graphing', denyCommands: ['Derivative', 'Integral'] }, { commands: CAT });
    if (!r.ok) throw new Error();
    const alt = allowedInstead(compilePolicy(r.value), { name: 'Derivative', group: 'functions' }, CAT);
    expect(alt.slice(0, 3).sort()).toEqual(['Extremum', 'Root', 'Tangent']);
    expect(alt).not.toContain('Integral');
    expect(alt.length).toBeLessThanOrEqual(5);
  });

  it('the mode card is two short lines', () => {
    const card = modeCard(MODES.geometry);
    expect(card).toBe('mode: geometry   angle: degree   window: -8 8 -5 5 (1:1)   axes: off   grid: off\nlabels: all objects   dragging: free and dependent points   exam: off');
    expect(card.split(/\s+/).length).toBeLessThan(45);
  });

  it('the figure summary', () => {
    const s = modeSummary(compilePolicy(MODES.geometry), CAT);
    expect(s.mode).toBe('geometry');
    expect(s.angleUnit).toBe('degree');
    expect(s.allowedGroups).toContain('conics');
    expect(s.allowedGroups).not.toContain('stats');
  });
});

describe('the notes mode shows the board (design 3.2 row notes; ui 1 and 2; board design 15)', () => {
  it('is available, and its only view is the board: available, initial, on its own, not toggled', () => {
    const r = getMode('notes');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.available).toBe(true);
    expect(r.value.views).toEqual({ available: ['board'], initial: ['board'], layout: 'single', canToggle: false });
    expect(availableModes().map((m) => m.id)).toContain('notes');
    expect(modeSummary(compilePolicy(r.value), CAT).mode).toBe('notes');
  });

  it('has no maths commands of its own (design 3.2: "Cmd groups: none")', () => {
    const p = compilePolicy(MODES.notes);
    for (const c of CAT) expect(p.command(c.name, c.group), c.name).toBe(false);
    expect(p.view('board')).toBe(true);
    expect(p.view('graphics')).toBe(false);
    expect(p.view('algebra')).toBe(false);
  });

  it('has pages and file operations (design 3.2: "Pages, undo, sharing")', () => {
    expect(MODES.notes.features.pageSet).toBe(true);
    expect(MODES.notes.features.fileOps).toBe(true);
    expect(MODES.notes.features.share).toBe(true);
    expect(MODES.notes.ui.algebra).toBe(false);
    expect(MODES.notes.ui.inputBar).toBe(false);
  });

  it('is a record of plain data, as every mode is (R1)', () => {
    expect(JSON.parse(JSON.stringify(MODES.notes))).toEqual(MODES.notes);
  });

  it('is named Board on its tile, with the purpose "write and draw" (app-modes ui 1)', () => {
    const i18n = new I18n({ locale: 'en' });
    expect(i18n.t(MODES.notes.title)).toBe('Board');
    expect(i18n.t(MODES.notes.purpose)).toBe('write and draw');
  });

  it('a mistyped id gets the closest mode, notes', () => {
    const r = getMode('note');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('unknown_mode');
    expect(r.hint).toContain("'notes'");
  });
});
