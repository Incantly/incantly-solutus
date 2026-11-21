/**
 * R8: the `incantlyFormula` node. Docs: design.md section 1.8 and 11, requirements R8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessApp } from '@incantly/sdk';
import { FORMAT_WORDS, evaluateExpr, parseFormat } from '../../src/index';
import { Viewport, destroyAll, docOf, figureJson, makeEditor, until } from './helpers';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Viewport);
});
afterEach(() => {
  destroyAll();
  Viewport.reset();
  vi.unstubAllGlobals();
});

const formulaJson = (attrs: Record<string, unknown>) => ({ type: 'incantlyFormula', attrs });
const withFormula = (formula: Record<string, unknown>, script = 'a = 2\nb = 1/3\nr = 0.25') =>
  docOf(figureJson({ id: 'fig_f', script, mode: 'graphing', height: 200 }), { type: 'paragraph', content: [{ type: 'text', text: 'The value is ' }, formulaJson(formula), { type: 'text', text: '.' }] });
const formulaEls = (editor: { view: { dom: HTMLElement } }): HTMLElement[] => Array.from(editor.view.dom.querySelectorAll<HTMLElement>('.inc-tt-formula'));
const shown = (editor: { view: { dom: HTMLElement } }): string => (formulaEls(editor)[0]?.textContent ?? '').trim();

describe('the node (R8)', () => {
  it('is an inline atom with expr, figure and format', () => {
    const { editor } = makeEditor(withFormula({ expr: 'a + 1', figure: 'fig_f', format: '' }));
    const type = editor.schema.nodes['incantlyFormula'];
    expect(type?.isInline).toBe(true);
    expect(type?.isAtom).toBe(true);
    const attrs = Object.keys(type?.spec.attrs ?? {}).sort();
    expect(attrs).toEqual(expect.arrayContaining(['expr', 'figure', 'format']));
  });

  it('insertIncantlyFormula inserts it with the given attributes', () => {
    const { editor } = makeEditor(withFormula({ expr: 'a + 1', figure: 'fig_f', format: '' }));
    editor.commands.focus('end');
    expect(editor.commands.insertIncantlyFormula({ expr: 'b', figure: 'fig_f', format: '2' })).toBe(true);
    const found: Record<string, unknown>[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'incantlyFormula') found.push({ ...n.attrs });
      return true;
    });
    expect(found).toHaveLength(2);
    expect(found[1]).toMatchObject({ expr: 'b', figure: 'fig_f', format: '2' });
  });

  it('writes <span data-incantly-formula data-expr data-figure data-format> and reads it back', () => {
    const one = makeEditor(withFormula({ expr: 'a + b', figure: 'fig_f', format: '2' }));
    const html = one.editor.getHTML();
    const span = new DOMParser().parseFromString(html, 'text/html').querySelector('span[data-incantly-formula]');
    expect(span).not.toBeNull();
    expect(span?.getAttribute('data-expr')).toBe('a + b');
    expect(span?.getAttribute('data-figure')).toBe('fig_f');
    expect(span?.getAttribute('data-format')).toBe('2');
    expect(span?.textContent).toContain('a + b');
    const two = makeEditor(html);
    expect(two.editor.getJSON()).toEqual(one.editor.getJSON());
  });
});

describe('the value of a figure (R8.1)', () => {
  it('shows the live value of expr read from the figure, as text', async () => {
    const { editor } = makeEditor(withFormula({ expr: 'a + 1', figure: 'fig_f', format: '' }));
    await until(() => shown(editor) === '3', 'the value 3');
    expect(formulaEls(editor)).toHaveLength(1);
  });

  it('adds no object to the figure', async () => {
    const { editor } = makeEditor(withFormula({ expr: 'a * 10', figure: 'fig_f', format: '' }));
    await until(() => shown(editor) === '20', 'the value 20');
    const script = (editor.getJSON().content?.[0]?.attrs as { script: string }).script;
    expect(script).toBe('a = 2\nb = 1/3\nr = 0.25');
  });

  it('follows the figure\'s changes', async () => {
    const { editor } = makeEditor(withFormula({ expr: 'a + 1', figure: 'fig_f', format: '' }));
    await until(() => shown(editor) === '3', 'the first value');
    editor.commands.updateIncantlyFigure('fig_f', { script: 'a = 41\nb = 1/3\nr = 0.25' });
    await until(() => shown(editor) === '42', 'the new value');
  });

  it('shows the value of an object of the figure named on its own (R8.1: the live value of expr read from the figure)', async () => {
    const { editor } = makeEditor(withFormula({ expr: 'a', figure: 'fig_f', format: 'auto' }));
    await until(() => shown(editor) === '2', 'the value 2');
  });

  it('applies a decimals format', async () => {
    const { editor } = makeEditor(withFormula({ expr: 'b * 1', figure: 'fig_f', format: '2' }));
    await until(() => shown(editor) === '0.33', 'two decimals');
  });

  it('applies the 3sf format', async () => {
    const { editor } = makeEditor(withFormula({ expr: 'b * 1', figure: 'fig_f', format: '3sf' }));
    await until(() => shown(editor) === '0.333', 'three significant figures');
  });

  it('applies the pct format', async () => {
    const { editor } = makeEditor(withFormula({ expr: 'r * 1', figure: 'fig_f', format: 'pct' }));
    await until(() => /^25(\.0+)?\s?%$/.test(shown(editor)), 'a percentage');
  });
});

describe('no figure (R8.2)', () => {
  it('shows expr as maths text, drawn as SVG or as text containing the expression', () => {
    const { editor } = makeEditor(withFormula({ expr: 'x^2 + 1', figure: '', format: '' }));
    const el = formulaEls(editor)[0] as HTMLElement;
    expect(el).toBeDefined();
    const hasSvg = el.querySelector('svg') !== null;
    expect(hasSvg || (el.textContent ?? '').includes('x')).toBe(true);
    expect(el.classList.contains('inc-tt-formula-bad')).toBe(false);
  });
});

describe('an expression that fails (R8.3)', () => {
  it('shows the expression with an error mark and the message on hover (title)', async () => {
    const { editor } = makeEditor(withFormula({ expr: 'a +* (', figure: 'fig_f', format: '' }));
    await until(() => formulaEls(editor)[0]?.querySelector('[title]') || formulaEls(editor)[0]?.getAttribute('title'), 'an error title');
    const el = formulaEls(editor)[0] as HTMLElement;
    const title = el.getAttribute('title') ?? el.querySelector('[title]')?.getAttribute('title') ?? '';
    expect(title.length).toBeGreaterThan(0);
    expect(el.textContent).toContain('a +* (');
  });

  it('shows an unknown name as an error, not as a value', async () => {
    const { editor } = makeEditor(withFormula({ expr: 'nothere + 1', figure: 'fig_f', format: '' }));
    await until(() => formulaEls(editor)[0]?.getAttribute('title') || formulaEls(editor)[0]?.querySelector('[title]'), 'an error title');
    expect(formulaEls(editor)[0]?.textContent).toContain('nothere');
  });

  it('never throws out of the extension and the editor keeps working', async () => {
    const { editor } = makeEditor(withFormula({ expr: '((((', figure: 'fig_missing', format: 'bogus' }));
    await until(() => formulaEls(editor).length === 1, 'the formula to draw');
    expect(editor.commands.insertContent('typing on')).toBe(true);
    expect(() => editor.getHTML()).not.toThrow();
  });
});

describe('formats and evaluation (design 11)', () => {
  it('parseFormat knows decimals, 3sf, deg, deg2, pct, sci, frac and auto, and refuses another word', () => {
    for (const w of ['2', '0', '3sf', 'deg', 'deg2', 'pct', 'sci', 'frac', 'auto']) expect(parseFormat(w), w).toBeDefined();
    expect(parseFormat('bogus')).toBeUndefined();
    for (const w of ['3sf', 'deg', 'deg2', 'pct', 'sci', 'frac', 'auto']) expect(FORMAT_WORDS).toContain(w);
  });

  it('evaluateExpr returns the text of an expression read against a figure', () => {
    const app = createHeadlessApp({ mode: 'graphing', script: 'a = 2\nb = 1/3' });
    const ok = evaluateExpr(app, 'a + 1', 'auto');
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.text).toBe('3');
    const two = evaluateExpr(app, 'b * 1', '2');
    expect(two.ok && two.text).toBe('0.33');
    expect(app.list().map((o) => o.name)).toEqual(['a', 'b']);
    app.destroy();
  });

  it('evaluateExpr reads the value of an object named on its own', () => {
    const app = createHeadlessApp({ mode: 'graphing', script: 'a = 2' });
    const r = evaluateExpr(app, 'a', 'auto');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe('2');
    app.destroy();
  });

  it('evaluateExpr gives a formula_failed error for a format word that is not one, and for an expression that fails', () => {
    const app = createHeadlessApp({ mode: 'graphing', script: 'a = 2' });
    const badFormat = evaluateExpr(app, 'a', 'bogus', 'fig_f');
    expect(badFormat.ok).toBe(false);
    if (!badFormat.ok) {
      expect(badFormat.error.kind).toBe('formula_failed');
      expect(badFormat.error.node).toBe('fig_f');
    }
    const badExpr = evaluateExpr(app, 'nothere + 1', 'auto', 'fig_f');
    expect(badExpr.ok).toBe(false);
    if (!badExpr.ok) expect(badExpr.error.message.length).toBeGreaterThan(0);
    app.destroy();
  });
});
