/**
 * R1.2, R1.3 and R4.3: unique ids, the HTML form (round trip), and paste.
 * Docs: design.md sections 2, 12; requirements R1, R4.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { headerMode, scriptOfPaste } from '../../src/index';
import { Viewport, attrsOf, destroyAll, docOf, figureAttrs, figureJson, makeEditor, para, pastePlain } from './helpers';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Viewport);
});
afterEach(() => {
  destroyAll();
  Viewport.reset();
  vi.unstubAllGlobals();
});

const PIC = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';

const full = { id: 'fig_html', script: '# incantly 1 mode=graphing\nf(x) = x^2 - 2x - 3\nr = Root(f, -5, 1)', mode: 'graphing', width: 480, height: 300, caption: 'A parabola', picture: PIC, version: 1 };

describe('HTML form (R1.3)', () => {
  it('writes <figure data-incantly-figure> with the picture as an <img> and the script as text', () => {
    const { editor } = makeEditor(docOf(figureJson(full), para('after')));
    const dom = new DOMParser().parseFromString(editor.getHTML(), 'text/html');
    const fig = dom.querySelector('figure[data-incantly-figure]');
    expect(fig).not.toBeNull();
    expect(fig?.querySelector('img')?.getAttribute('src')).toBe(PIC);
    expect(fig?.textContent).toContain('f(x) = x^2 - 2x - 3');
    expect(fig?.textContent).toContain('r = Root(f, -5, 1)');
  });

  it('writes the other attributes as data attributes', () => {
    const { editor } = makeEditor(docOf(figureJson(full), para('after')));
    const fig = new DOMParser().parseFromString(editor.getHTML(), 'text/html').querySelector('figure[data-incantly-figure]');
    const values = Array.from(fig?.attributes ?? [])
      .filter((a) => a.name.startsWith('data-'))
      .map((a) => a.value);
    for (const v of ['fig_html', 'graphing', '480', '300', '1']) expect(values).toContain(v);
  });

  it('writes a figure without a picture with no <img>, keeping the script', () => {
    const { editor } = makeEditor(docOf(figureJson({ id: 'fig_np', script: 'a = 1', picture: null }), para('x')));
    const fig = new DOMParser().parseFromString(editor.getHTML(), 'text/html').querySelector('figure[data-incantly-figure]');
    expect(fig?.querySelector('img')).toBeNull();
    expect(fig?.textContent).toContain('a = 1');
  });

  it('round-trips: html from one editor loads into another with the same attributes', () => {
    const one = makeEditor(docOf(para('intro'), figureJson(full), para('after')));
    const html = one.editor.getHTML();
    const two = makeEditor(html);
    expect(attrsOf(two.editor)).toEqual(attrsOf(one.editor));
    expect(two.editor.getHTML()).toBe(html);
  });

  it('round-trips a figure with width "full", no caption and no picture', () => {
    const one = makeEditor(docOf(figureJson({ id: 'fig_rt', script: 'A = (1, 2)\nB = (3, 4)', width: 'full', caption: '', picture: null }), para('x')));
    const two = makeEditor(one.editor.getHTML());
    expect(attrsOf(two.editor)).toEqual(attrsOf(one.editor));
  });

  it('keeps a script with several lines, symbols and angle brackets intact', () => {
    const script = 'a = 1\nt = "x < y && z > 1"\n# a comment';
    const one = makeEditor(docOf(figureJson({ id: 'fig_sym', script }), para('x')));
    const two = makeEditor(one.editor.getHTML());
    expect(attrsOf(two.editor)[0]?.['script']).toBe(script);
  });

  it('keeps the script when a figure is pasted as HTML into another document', () => {
    const one = makeEditor(docOf(figureJson(full), para('x')));
    const other = makeEditor(docOf(para('target')));
    other.editor.view.pasteHTML(one.editor.getHTML());
    const got = attrsOf(other.editor).find((a) => a['script'] === full.script);
    expect(got).toBeDefined();
    // another document does not hold the id yet, so the id is kept
    expect(got?.['id']).toBe('fig_html');
    expect(got?.['mode']).toBe('graphing');
    expect(got?.['caption']).toBe('A parabola');
  });
});

describe('ids (R1.2)', () => {
  it('gives a pasted figure whose id is already in the document a new id and keeps its script', () => {
    const { editor } = makeEditor(docOf(figureJson({ id: 'fig_dup', script: 'a = 1' }), para('x')));
    const html = editor.getHTML();
    editor.commands.focus('end');
    editor.view.pasteHTML(html);
    const all = attrsOf(editor);
    expect(all).toHaveLength(2);
    const ids = all.map((a) => a['id']);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('fig_dup');
    expect(all.every((a) => a['script'] === 'a = 1')).toBe(true);
    // the figure that was already there keeps its id
    expect(figureAttrs(editor, 'fig_dup')?.script).toBe('a = 1');
  });

  it('gives each of three pastes of the same figure its own id', () => {
    const { editor } = makeEditor(docOf(figureJson({ id: 'fig_dup', script: 'a = 1' }), para('x')));
    const html = editor.getHTML();
    editor.commands.focus('end');
    editor.view.pasteHTML(html);
    editor.commands.focus('end');
    editor.view.pasteHTML(html);
    const ids = attrsOf(editor).map((a) => a['id']);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('gives new ids when two figures with the same id are loaded', () => {
    const { editor } = makeEditor(docOf(figureJson({ id: 'fig_same', script: 'a = 1' }), figureJson({ id: 'fig_same', script: 'b = 2' }), para('x')));
    // the document is made to hold unique ids once it changes
    editor.commands.insertContentAt(editor.state.doc.content.size, 'x');
    const all = attrsOf(editor);
    expect(new Set(all.map((a) => a['id'])).size).toBe(all.length);
    expect(all.map((a) => a['script']).sort()).toEqual(['a = 1', 'b = 2']);
  });
});

describe('paste of a plain script (R4.3)', () => {
  it('inserts a figure for text that starts with the "# incantly 1" header', () => {
    const { editor } = makeEditor(docOf(para('')));
    const text = '# incantly 1 mode=graphing\nf(x) = x^2';
    pastePlain(editor, text);
    const figs = attrsOf(editor);
    expect(figs).toHaveLength(1);
    expect(figs[0]?.['script']).toContain('f(x) = x^2');
    expect(figs[0]?.['mode']).toBe('graphing');
  });

  it('inserts a figure for text where every line checks without error', () => {
    const { editor } = makeEditor(docOf(para('')));
    pastePlain(editor, 'A = (1, 2)\nB = (3, 4)\ns = Segment(A, B)');
    const figs = attrsOf(editor);
    expect(figs).toHaveLength(1);
    expect(figs[0]?.['script']).toContain('s = Segment(A, B)');
  });

  it('pastes ordinary prose as text, with no figure', () => {
    const { editor } = makeEditor(docOf(para('')));
    pastePlain(editor, 'Meet me at noon, and bring the notes.');
    expect(attrsOf(editor)).toHaveLength(0);
    expect(editor.getText()).toContain('Meet me at noon');
  });

  it('pastes text with one bad line as text, with no figure', () => {
    const { editor } = makeEditor(docOf(para('')));
    pastePlain(editor, 'A = (1, 2)\nB = Nope((');
    expect(attrsOf(editor)).toHaveLength(0);
  });

  it('does not insert a figure in a read-only editor', () => {
    const { editor } = makeEditor(docOf(para('')), { readOnly: true });
    pastePlain(editor, '# incantly 1\nA = (1, 2)');
    expect(attrsOf(editor)).toHaveLength(0);
  });

  it('exposes the same decision as scriptOfPaste', () => {
    expect(scriptOfPaste('# incantly 1 mode=geometry\nA = (0, 0)')?.mode).toBe('geometry');
    expect(scriptOfPaste('A = (1, 2)\nB = (3, 4)')?.script).toContain('B = (3, 4)');
    expect(scriptOfPaste('Hello there, how are you today?')).toBeUndefined();
    expect(scriptOfPaste('')).toBeUndefined();
  });

  it('reads the mode from the script header', () => {
    expect(headerMode('# incantly 1 mode=graphing3d\nA = (1, 2, 3)')).toBe('graphing3d');
    expect(headerMode('A = (1, 2)')).toBeUndefined();
  });
});
