/**
 * R1.1, R1.4 and R1.5: the figure node's attributes, their defaults, and `bad_attrs`.
 * Docs: docs/features/tiptap/design.md section 2, errors.md (bad_attrs row), .kiro/specs/tiptap/requirements.md R1.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIGURE_DEFAULTS, SCRIPT_LIMIT, checkAttrs, isTiptapError, newFigureId } from '../../src/index';
import { Viewport, attrsOf, boxOf, destroyAll, docOf, figureAttrs, figureJson, makeEditor, para, undoOnce, undoSteps, lastError } from './helpers';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Viewport);
});
afterEach(() => {
  destroyAll();
  Viewport.reset();
  vi.unstubAllGlobals();
});

const good = { id: 'fig_x', script: 'a = 1', mode: 'figure', width: 'full', height: 360, caption: '', picture: null, version: 1 };

describe('figure node attributes (R1.1)', () => {
  it('knows the defaults: mode figure, width full, height 360, empty caption, picture null, version 1', () => {
    expect(FIGURE_DEFAULTS.mode).toBe('figure');
    expect(FIGURE_DEFAULTS.width).toBe('full');
    expect(FIGURE_DEFAULTS.height).toBe(360);
    expect(FIGURE_DEFAULTS.caption).toBe('');
    expect(FIGURE_DEFAULTS.picture).toBeNull();
    expect(FIGURE_DEFAULTS.version).toBe(1);
  });

  it('fills missing optional attributes with the defaults when checking', () => {
    const r = checkAttrs({ id: 'fig_x', script: 'a = 1' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(good);
  });

  it('an inserted figure holds id, script, mode, width, height, caption, picture and version with the defaults', () => {
    const { editor } = makeEditor();
    expect(editor.commands.insertIncantlyFigure({ script: 'a = 1' })).toBe(true);
    const [a] = attrsOf(editor);
    expect(typeof a?.['id']).toBe('string');
    expect(a?.['id']).not.toBe('');
    expect(a).toMatchObject({ script: 'a = 1', mode: 'figure', width: 'full', height: 360, caption: '', picture: null, version: 1 });
  });

  it('takes the default mode from the defaultMode option', () => {
    const { editor } = makeEditor(undefined, { defaultMode: 'graphing' });
    editor.commands.insertIncantlyFigure({ script: 'a = 1' });
    expect(attrsOf(editor)[0]?.['mode']).toBe('graphing');
  });

  it('creates a different id on every insert', () => {
    const { editor } = makeEditor();
    editor.commands.insertIncantlyFigure({ script: 'a = 1' });
    editor.commands.focus('end');
    editor.commands.insertIncantlyFigure({ script: 'b = 2' });
    const ids = attrsOf(editor).map((a) => a['id']);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(newFigureId()).not.toBe(newFigureId());
  });

  it('is an atom block: the editor treats it as one unit', () => {
    const { editor } = makeEditor(docOf(para('a'), figureJson({ script: 'a = 1' }), para('b')));
    const type = editor.schema.nodes['incantlyFigure'];
    expect(type?.isAtom).toBe(true);
    expect(type?.isBlock).toBe(true);
    expect(type?.isLeaf).toBe(true);
  });
});

describe('attribute checks give bad_attrs (R1.4)', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['a script over 64 KB', { script: 'a'.repeat(64 * 1024 + 1) }],
    ['a script that is not text', { script: 42 }],
    ['a height that is not a number', { height: 'tall' }],
    ['a width that is neither a number nor "full"', { width: 'wide' }],
    ['a caption that is not text', { caption: 7 }],
    ['an unknown mode', { mode: 'not-a-mode' }],
    ['an unknown version', { version: 2 }],
    ['a picture that is not an image URL', { picture: 12 }],
  ];

  for (const [name, patch] of cases) {
    it(`rejects ${name}, naming the figure in "node"`, () => {
      const r = checkAttrs({ ...good, ...patch });
      expect(r.ok).toBe(false);
      expect(isTiptapError(r)).toBe(true);
      if (!r.ok) {
        expect(r.kind).toBe('bad_attrs');
        expect(r.node).toBe('fig_x');
        expect(r.message.length).toBeGreaterThan(0);
        expect(r.hint?.length ?? 0).toBeGreaterThan(0);
      }
    });
  }

  it('accepts a script of exactly 64 KB and refuses one byte more', () => {
    expect(SCRIPT_LIMIT).toBe(64 * 1024);
    expect(checkAttrs({ ...good, script: 'a'.repeat(SCRIPT_LIMIT) }).ok).toBe(true);
    expect(checkAttrs({ ...good, script: 'a'.repeat(SCRIPT_LIMIT + 1) }).ok).toBe(false);
  });

  it('names the size in the message for a script over the limit', () => {
    const r = checkAttrs({ ...good, script: 'a'.repeat(80 * 1024) });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toMatch(/80 KB/);
      expect(r.message).toMatch(/64 KB/);
    }
  });

  it('accepts a pixel width', () => {
    const r = checkAttrs({ ...good, width: 480 });
    expect(r.ok && r.value.width).toBe(480);
  });
});

describe('a loaded node with bad attributes (R1.4, errors.md bad_attrs)', () => {
  const big = 'x = 1\n'.repeat(15000); // ~90 KB

  const badOnes: [string, Record<string, unknown>][] = [
    ['an 80 KB script', { id: 'fig_big', script: big }],
    ['a height of the wrong type', { id: 'fig_h', script: 'a = 1', height: 'tall' }],
    ['an unknown version', { id: 'fig_v', script: 'a = 1', version: 7 }],
  ];

  for (const [name, attrs] of badOnes) {
    it(`keeps the raw attributes and shows "This figure could not be loaded" for ${name}`, () => {
      const { editor, errors } = makeEditor(docOf(para('before'), figureJson(attrs), para('after')));
      const id = attrs['id'] as string;
      // nothing is lost: the raw attributes stay in the document
      const kept = attrsOf(editor)[0];
      expect(kept?.['script']).toBe(attrs['script']);
      for (const k of Object.keys(attrs)) expect(kept?.[k]).toBe(attrs[k]);
      // the error is reported once in the errors.md format, with the figure's id
      const e = errors.find((x) => x.kind === 'bad_attrs');
      expect(e).toBeDefined();
      expect(e?.ok).toBe(false);
      expect(e?.node).toBe(id);
      expect(lastError(editor)?.kind).toBe('bad_attrs');
      // the reader sees the message, and the editor still works
      const box = boxOf(editor, id);
      expect(box?.textContent).toContain('This figure could not be loaded');
      expect(editor.commands.insertContent('still typing')).toBe(true);
    });
  }

  it('offers a writer the code panel to fix the script, and nothing to a read-only reader', () => {
    const w = makeEditor(docOf(figureJson({ id: 'fig_big', script: big })));
    const writerBox = boxOf(w.editor, 'fig_big');
    const edit = Array.from(writerBox?.querySelectorAll('button') ?? []).find((b) => /edit lines/i.test(b.textContent ?? ''));
    expect(edit).toBeDefined();
    edit?.click();
    const panel = w.editor.view.dom.querySelector<HTMLElement>('.inc-tt-panel');
    expect(panel?.hidden).toBe(false);
    expect(panel?.querySelector('textarea')?.value).toBe(big);

    const r = makeEditor(docOf(figureJson({ id: 'fig_big', script: big })), { readOnly: true });
    const readerBox = boxOf(r.editor, 'fig_big');
    expect(readerBox?.textContent).toContain('This figure could not be loaded');
    expect(Array.from(readerBox?.querySelectorAll('button') ?? []).some((b) => /edit lines/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('loads again once a writer replaces the bad script', async () => {
    const { editor } = makeEditor(docOf(figureJson({ id: 'fig_big', script: big })));
    expect(editor.commands.updateIncantlyFigure('fig_big', { script: 'a = 1' })).toBe(true);
    expect(figureAttrs(editor, 'fig_big')?.script).toBe('a = 1');
    expect(boxOf(editor, 'fig_big')?.textContent).not.toContain('This figure could not be loaded');
  });
});

describe('the document stores the script, never computed values (R1.5)', () => {
  it('keeps only the eight attributes and nothing computed', () => {
    const { editor } = makeEditor(docOf(figureJson({ script: 'a = 2\nb = a * 3' })));
    expect(Object.keys(attrsOf(editor)[0] ?? {}).sort()).toEqual(['caption', 'height', 'id', 'mode', 'picture', 'script', 'version', 'width']);
  });

  it('updating only the picture is not an undo step; updating the script is', () => {
    const { editor } = makeEditor(docOf(figureJson({ id: 'fig_p', script: 'a = 1' }), para('x')));
    const before = undoSteps(editor);
    expect(editor.commands.updateIncantlyFigure('fig_p', { picture: 'data:image/svg+xml;base64,PHN2Zy8+' })).toBe(true);
    expect(undoSteps(editor)).toBe(before);
    expect(editor.commands.updateIncantlyFigure('fig_p', { script: 'a = 2' })).toBe(true);
    expect(undoSteps(editor)).toBe(before + 1);
    expect(undoOnce(editor)).toBe(true);
    expect(figureAttrs(editor, 'fig_p')?.script).toBe('a = 1');
  });
});
