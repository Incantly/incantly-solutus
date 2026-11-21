/**
 * R7: collaboration. The script is a plain string attribute; an outside change wins over uncommitted panel edits and
 * the writer sees `collab_conflict` with their lines kept, to re-apply or discard. Docs: design.md 5 and 10, errors.md.
 */
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Viewport, destroyAll, docOf, figureAttrs, figureJson, makeEditor, para, posOf, real, until, lastError } from './helpers';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Viewport);
});
afterEach(() => {
  destroyAll();
  Viewport.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const doc = () => docOf(figureJson({ id: 'fig_c', script: 'a = 1', mode: 'graphing', height: 200 }), para('x'));
const panelOf = (e: Editor): HTMLElement => e.view.dom.querySelector('.inc-tt-panel') as HTMLElement;
const areaOf = (e: Editor): HTMLTextAreaElement => panelOf(e).querySelector('textarea') as HTMLTextAreaElement;
const buttons = (root: ParentNode): HTMLButtonElement[] => Array.from(root.querySelectorAll('button'));

function openPanel(editor: Editor): void {
  editor.commands.setNodeSelection(posOf(editor, 'fig_c'));
  buttons(editor.view.dom.querySelector('[role="toolbar"]') as HTMLElement)
    .find((b) => /edit lines/i.test(b.textContent ?? ''))
    ?.click();
}
function typeLines(editor: Editor, text: string): void {
  const a = areaOf(editor);
  a.value = text;
  a.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('the script is a plain string attribute (R7.1)', () => {
  it('is a string attribute of the node, with a string default', () => {
    const { editor } = makeEditor(doc());
    const spec = editor.schema.nodes['incantlyFigure']?.spec.attrs as Record<string, { default?: unknown }> | undefined;
    expect(spec && 'script' in spec).toBe(true);
    expect(typeof spec?.['script']?.default).toBe('string');
    expect(typeof figureAttrs(editor, 'fig_c')?.script).toBe('string');
  });

  it('syncs through JSON: another editor given the document JSON holds the same script', () => {
    const one = makeEditor(doc());
    one.editor.commands.updateIncantlyFigure('fig_c', { script: 'a = 1\nb = 2' });
    const two = makeEditor(one.editor.getJSON());
    expect(figureAttrs(two.editor, 'fig_c')?.script).toBe('a = 1\nb = 2');
  });
});

describe('an outside change while the writer has uncommitted lines (R7.2, design 10)', () => {
  it('lets the outside script win, keeps the writer\'s lines in the panel and reports collab_conflict', () => {
    const { editor, errors } = makeEditor(doc());
    openPanel(editor);
    typeLines(editor, 'a = 1\nmine = 5');
    editor.commands.updateIncantlyFigure('fig_c', { script: 'a = 1\ntheirs = 9' });
    expect(figureAttrs(editor, 'fig_c')?.script).toBe('a = 1\ntheirs = 9');
    expect(areaOf(editor).value).toBe('a = 1\ntheirs = 9');
    const panel = panelOf(editor);
    expect(panel.textContent).toContain('mine = 5');
    expect(panel.textContent).toMatch(/your lines/i);
    const labels = buttons(panel).map((b) => b.textContent ?? '');
    expect(labels.some((t) => /re-apply/i.test(t))).toBe(true);
    expect(labels.some((t) => /discard/i.test(t))).toBe(true);
    const e = errors.find((x) => x.kind === 'collab_conflict');
    expect(e).toBeDefined();
    expect(e?.ok).toBe(false);
    expect(e?.node).toBe('fig_c');
    expect(lastError(editor)?.kind).toBe('collab_conflict');
  });

  it('does not commit the writer\'s lines later: the 300 ms timer is gone', async () => {
    const { editor } = makeEditor(doc());
    openPanel(editor);
    typeLines(editor, 'a = 1\nmine = 5');
    editor.commands.updateIncantlyFigure('fig_c', { script: 'a = 1\ntheirs = 9' });
    await real(450);
    expect(figureAttrs(editor, 'fig_c')?.script).toBe('a = 1\ntheirs = 9');
  });

  it('Re-apply puts the writer\'s lines back as the script', async () => {
    const { editor } = makeEditor(doc());
    openPanel(editor);
    typeLines(editor, 'a = 1\nmine = 5');
    editor.commands.updateIncantlyFigure('fig_c', { script: 'a = 1\ntheirs = 9' });
    buttons(panelOf(editor)).find((b) => /re-apply/i.test(b.textContent ?? ''))?.click();
    await until(() => figureAttrs(editor, 'fig_c')?.script === 'a = 1\nmine = 5', 'the writer\'s lines to be the script');
    expect(areaOf(editor).value).toBe('a = 1\nmine = 5');
    expect(panelOf(editor).textContent).not.toMatch(/your lines/i);
  });

  it('Discard drops the writer\'s lines and keeps the outside script', async () => {
    const { editor } = makeEditor(doc());
    openPanel(editor);
    typeLines(editor, 'a = 1\nmine = 5');
    editor.commands.updateIncantlyFigure('fig_c', { script: 'a = 1\ntheirs = 9' });
    buttons(panelOf(editor)).find((b) => /discard/i.test(b.textContent ?? ''))?.click();
    await real(450);
    expect(figureAttrs(editor, 'fig_c')?.script).toBe('a = 1\ntheirs = 9');
    expect(areaOf(editor).value).toBe('a = 1\ntheirs = 9');
    expect(panelOf(editor).textContent).not.toContain('mine = 5');
    expect(buttons(panelOf(editor)).some((b) => /re-apply|discard/i.test(b.textContent ?? ''))).toBe(false);
  });

  it('is also a conflict when the change comes from the editor\'s undo', () => {
    const { editor, errors } = makeEditor(doc());
    editor.commands.updateIncantlyFigure('fig_c', { script: 'a = 1\nb = 2' });
    openPanel(editor);
    typeLines(editor, 'a = 1\nb = 2\nmine = 5');
    editor.commands.updateIncantlyFigure('fig_c', { script: 'a = 1\nb = 2\nc = 3' });
    expect(errors.some((e) => e.kind === 'collab_conflict')).toBe(true);
    expect(figureAttrs(editor, 'fig_c')?.script).toBe('a = 1\nb = 2\nc = 3');
  });
});

describe('no conflict without uncommitted lines (R7.2)', () => {
  it('shows an outside script in an open panel with no notice and no error', () => {
    const { editor, errors } = makeEditor(doc());
    openPanel(editor);
    editor.commands.updateIncantlyFigure('fig_c', { script: 'a = 1\ntheirs = 9' });
    expect(areaOf(editor).value).toBe('a = 1\ntheirs = 9');
    expect(errors.filter((e) => e.kind === 'collab_conflict')).toHaveLength(0);
    expect(panelOf(editor).textContent).not.toMatch(/your lines/i);
  });

  it('is not a conflict when the writer\'s own lines were already committed', async () => {
    vi.useFakeTimers();
    const { editor, errors } = makeEditor(doc());
    openPanel(editor);
    typeLines(editor, 'a = 1\nmine = 5');
    await vi.advanceTimersByTimeAsync(300);
    expect(figureAttrs(editor, 'fig_c')?.script).toBe('a = 1\nmine = 5');
    editor.commands.updateIncantlyFigure('fig_c', { script: 'a = 1\nmine = 5\ntheirs = 9' });
    expect(errors.filter((e) => e.kind === 'collab_conflict')).toHaveLength(0);
    expect(areaOf(editor).value).toBe('a = 1\nmine = 5\ntheirs = 9');
  });

  it('is not a conflict when the outside script equals what the writer typed', () => {
    const { editor, errors } = makeEditor(doc());
    openPanel(editor);
    typeLines(editor, 'a = 1\nsame = 5');
    editor.commands.updateIncantlyFigure('fig_c', { script: 'a = 1\nsame = 5' });
    expect(errors.filter((e) => e.kind === 'collab_conflict')).toHaveLength(0);
  });
});
