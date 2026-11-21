/**
 * R4.1 and R4.2: the three commands, the slash menu, and how errors are reported (design.md section 6, ui.md Writing).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { figuresIn, resolveOptions } from '../../src/index';
import { Viewport, attrsOf, destroyAll, docOf, figureAttrs, figureJson, makeEditor, para, undoOnce, undoSteps, lastError } from './helpers';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Viewport);
});
afterEach(() => {
  destroyAll();
  Viewport.reset();
  vi.unstubAllGlobals();
});

describe('insertIncantlyFigure (R4.1)', () => {
  it('inserts a figure with the given script, mode and height', () => {
    const { editor } = makeEditor();
    expect(editor.commands.insertIncantlyFigure({ script: 'A = (1, 2)', mode: 'geometry', height: 240 })).toBe(true);
    expect(attrsOf(editor)[0]).toMatchObject({ script: 'A = (1, 2)', mode: 'geometry', height: 240 });
  });

  it('works with no argument: an empty figure with the defaults', () => {
    const { editor } = makeEditor();
    expect(editor.commands.insertIncantlyFigure()).toBe(true);
    expect(attrsOf(editor)[0]).toMatchObject({ script: '', mode: 'figure', height: 360, width: 'full' });
  });

  it('takes the mode from the script header when no mode is given, and the explicit mode over the header', () => {
    const { editor } = makeEditor();
    editor.commands.insertIncantlyFigure({ script: '# incantly 1 mode=graphing\nf(x) = x' });
    editor.commands.focus('end');
    editor.commands.insertIncantlyFigure({ script: '# incantly 1 mode=graphing\ng(x) = x', mode: 'geometry' });
    const modes = attrsOf(editor).map((a) => a['mode']);
    expect(modes).toEqual(['graphing', 'geometry']);
  });

  it('takes the mode from the header over the defaultMode option', () => {
    const { editor } = makeEditor(undefined, { defaultMode: 'geometry' });
    editor.commands.insertIncantlyFigure({ script: '# incantly 1 mode=graphing\nf(x) = x' });
    expect(attrsOf(editor)[0]?.['mode']).toBe('graphing');
  });

  it('takes an id and a caption from a host that makes its own', () => {
    const { editor } = makeEditor();
    editor.commands.insertIncantlyFigure({ id: 'fig_host', caption: 'From the host', script: 'a = 1' });
    expect(attrsOf(editor)[0]).toMatchObject({ id: 'fig_host', caption: 'From the host' });
  });

  it('is one undo step', () => {
    const { editor } = makeEditor();
    const before = undoSteps(editor);
    editor.commands.insertIncantlyFigure({ script: 'a = 1' });
    expect(undoSteps(editor)).toBe(before + 1);
    undoOnce(editor);
    expect(attrsOf(editor)).toHaveLength(0);
  });

  it('refuses a bad script size with bad_attrs, inserts nothing and reports it', () => {
    const { editor, errors } = makeEditor();
    expect(editor.commands.insertIncantlyFigure({ script: 'a'.repeat(65 * 1024) })).toBe(false);
    expect(attrsOf(editor)).toHaveLength(0);
    expect(errors.map((e) => e.kind)).toContain('bad_attrs');
  });
});

describe('updateIncantlyFigure (R4.1, design 6)', () => {
  const setup = () => makeEditor(docOf(figureJson({ id: 'fig_u', script: 'a = 1', caption: 'one' }), para('text')));

  it('merges the patch into the node attributes and keeps the rest', () => {
    const { editor } = setup();
    expect(editor.commands.updateIncantlyFigure('fig_u', { script: 'a = 2', height: 200 })).toBe(true);
    expect(figureAttrs(editor, 'fig_u')).toMatchObject({ script: 'a = 2', height: 200, caption: 'one', mode: 'figure', id: 'fig_u' });
  });

  it('checks the result as for the load: a bad patch returns false, changes nothing and reports bad_attrs', () => {
    const { editor, errors } = setup();
    const before = figureAttrs(editor, 'fig_u');
    expect(editor.commands.updateIncantlyFigure('fig_u', { height: 'tall' as unknown as number })).toBe(false);
    expect(editor.commands.updateIncantlyFigure('fig_u', { script: 'x'.repeat(65 * 1024) })).toBe(false);
    expect(editor.commands.updateIncantlyFigure('fig_u', { mode: 'nope' as never })).toBe(false);
    expect(figureAttrs(editor, 'fig_u')).toEqual(before);
    expect(errors.filter((e) => e.kind === 'bad_attrs')).toHaveLength(3);
    expect(errors.every((e) => e.node === 'fig_u')).toBe(true);
  });

  it('returns false for an unknown id, changes nothing and reports an error', () => {
    const { editor, errors } = setup();
    const before = editor.getJSON();
    expect(editor.commands.updateIncantlyFigure('fig_missing', { script: 'b = 2' })).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.ok).toBe(false);
  });

  it('cannot change the id', () => {
    const { editor, errors } = setup();
    expect(editor.commands.updateIncantlyFigure('fig_u', { id: 'fig_other' })).toBe(false);
    expect(figureAttrs(editor, 'fig_u')?.id).toBe('fig_u');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('is an undo step for a script change, and not for a picture-only patch', () => {
    const { editor } = setup();
    const n = undoSteps(editor);
    editor.commands.updateIncantlyFigure('fig_u', { picture: 'data:image/svg+xml;base64,PHN2Zy8+' });
    expect(undoSteps(editor)).toBe(n);
    editor.commands.updateIncantlyFigure('fig_u', { caption: 'two' });
    expect(undoSteps(editor)).toBe(n + 1);
  });
});

describe('errors reach onError and storage (design 6)', () => {
  it('gives every reported error to onError and keeps the last in storage.incantly.lastError', () => {
    const onError = vi.fn();
    const { editor } = makeEditor(docOf(figureJson({ id: 'fig_e' }), para('t')), { onError });
    expect(lastError(editor)).toBeNull();
    editor.commands.updateIncantlyFigure('fig_e', { height: 'x' as unknown as number });
    expect(onError).toHaveBeenCalledTimes(1);
    const e = onError.mock.calls[0]?.[0];
    expect(e).toMatchObject({ ok: false, kind: 'bad_attrs', node: 'fig_e' });
    expect(lastError(editor)).toEqual(e);
  });
});

describe('askIncantly command without a server (R4.1, R6.1)', () => {
  it('returns false with ai_unavailable and nothing changes', () => {
    const { editor, errors } = makeEditor(docOf(figureJson({ id: 'fig_a', script: 'a = 1' }), para('t')));
    const before = editor.getJSON();
    expect(editor.commands.askIncantly('fig_a', 'draw a circle')).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    const e = errors.find((x) => x.kind === 'ai_unavailable');
    expect(e).toBeDefined();
    expect(e?.message.length).toBeGreaterThan(0);
    expect(lastError(editor)?.kind).toBe('ai_unavailable');
  });

  it('returns true when a transport is set', () => {
    const transport = async function* () {
      yield { done: true as const };
    };
    const { editor } = makeEditor(docOf(figureJson({ id: 'fig_a', script: 'a = 1' }), para('t')), { aiTransport: transport });
    expect(editor.commands.askIncantly('fig_a', 'draw a circle')).toBe(true);
  });
});

describe('extension options (R4.4)', () => {
  it('fills the defaults: liveLimit 3, defaultMode figure, readOnly off, sound off', () => {
    const o = resolveOptions({});
    expect(o.liveLimit).toBe(3);
    expect(o.defaultMode).toBe('figure');
    expect(o.readOnly).toBe(false);
    expect(o.sound).toBe(false);
  });

  it('keeps the values it is given', () => {
    const o = resolveOptions({ liveLimit: 5, defaultMode: 'graphing', readOnly: true, sound: true, server: 'http://x' });
    expect(o).toMatchObject({ liveLimit: 5, defaultMode: 'graphing', readOnly: true, sound: true, server: 'http://x' });
  });
});

describe('the slash menu (R4.2, ui.md Writing)', () => {
  const typeSlash = (query = ''): ReturnType<typeof makeEditor> => {
    const o = makeEditor(docOf(para('')));
    o.editor.commands.focus();
    o.editor.view.dom.focus();
    o.editor.commands.insertContent(`/${query}`);
    return o;
  };
  const items = (): string[] =>
    Array.from(document.querySelectorAll('[role="option"]'))
      .filter((x) => !x.closest('[hidden]'))
      .map((x) => x.textContent ?? '');

  it('offers the four items after a slash', () => {
    typeSlash();
    expect(items()).toEqual(['Incantly figure', 'Incantly graph', 'Incantly 3D', 'Ask AI for a figure']);
  });

  it('filters by what is typed after the slash', () => {
    typeSlash('graph');
    expect(items()).toContain('Incantly graph');
    expect(items()).not.toContain('Incantly 3D');
  });

  it('inserts a graphing figure for "Incantly graph" and a graphing3d figure for "Incantly 3D"', () => {
    const { editor } = typeSlash();
    const pick = (label: string): void => {
      const el = Array.from(document.querySelectorAll('[role="option"]')).find((x) => x.textContent === label) as HTMLElement;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    };
    pick('Incantly graph');
    expect(attrsOf(editor).map((a) => a['mode'])).toEqual(['graphing']);
    // the slash text is gone
    expect(editor.getText()).not.toContain('/');

    editor.commands.focus('end');
    editor.commands.insertContent('/');
    pick('Incantly 3D');
    expect(attrsOf(editor).map((a) => a['mode'])).toEqual(['graphing', 'graphing3d']);
  });

  it('inserts a figure in the default mode for "Incantly figure"', () => {
    const { editor } = typeSlash();
    const el = Array.from(document.querySelectorAll('[role="option"]')).find((x) => x.textContent === 'Incantly figure') as HTMLElement;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(attrsOf(editor)).toHaveLength(1);
    expect(attrsOf(editor)[0]?.['mode']).toBe('figure');
  });

  it('inserts a figure for "Ask AI for a figure" and opens the AI box on it', () => {
    const transport = async function* () {
      yield { done: true as const };
    };
    const { editor } = makeEditor(docOf(para('')), { aiTransport: transport });
    editor.commands.focus();
    editor.view.dom.focus();
    editor.commands.insertContent('/');
    const el = Array.from(document.querySelectorAll('[role="option"]')).find((x) => x.textContent === 'Ask AI for a figure') as HTMLElement;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(figuresIn(editor.state.doc)).toHaveLength(1);
    const input = editor.view.dom.querySelector<HTMLInputElement>('input[aria-label="Ask the AI"], .inc-tt-ai-in');
    expect(input).not.toBeNull();
  });

  it('shows no item in a read-only editor', () => {
    const { editor } = makeEditor(docOf(para('')), { readOnly: true });
    editor.commands.focus();
    editor.view.dom.focus();
    editor.commands.insertContent('/');
    expect(Array.from(document.querySelectorAll('[role="option"]')).filter((x) => !(x.closest('[hidden]')))).toHaveLength(0);
  });
});
