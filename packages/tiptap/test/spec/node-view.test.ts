/**
 * R2 (node view and scheduler), R3 (editing), R5 (read-only) and R11.1 (50 figures).
 * Docs: design.md sections 3, 4, 7; ui.md; requirements R2, R3, R5, R11.
 */
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MountedApp } from '@incantly/sdk';
import { figuresIn } from '../../src/index';
import { Viewport, boxOf, boxes, destroyAll, docOf, figureAttrs, figureJson, liveBoxes, makeEditor, para, posOf, real, undoOnce, undoSteps, until } from './helpers';

const probe = vi.hoisted(() => ({ apps: [] as MountedApp[], options: [] as Record<string, unknown>[] }));

vi.mock('@incantly/sdk', async (original) => {
  const sdk = await original<typeof import('@incantly/sdk')>();
  return {
    ...sdk,
    createApp: async (o: Parameters<typeof sdk.createApp>[0]) => {
      probe.options.push(o as unknown as Record<string, unknown>);
      const app = await sdk.createApp(o);
      probe.apps.push(app);
      return app;
    },
  };
});

beforeEach(() => {
  probe.apps = [];
  probe.options = [];
  vi.stubGlobal('IntersectionObserver', Viewport);
});
afterEach(() => {
  destroyAll();
  Viewport.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const mounted = (): MountedApp[] => probe.apps.filter((a) => !a.destroyed);
const fig = (n: number, extra: Record<string, unknown> = {}) =>
  figureJson({ id: `fig_${String(n).padStart(3, '0')}`, script: `a = ${n}\nb = a + 1`, mode: 'graphing', height: 200, ...extra });

const buttonNamed = (root: ParentNode, text: RegExp): HTMLButtonElement | undefined =>
  Array.from(root.querySelectorAll('button')).find((b) => text.test(b.textContent ?? '') || text.test(b.getAttribute('aria-label') ?? ''));

const select = (editor: Editor, id: string): void => {
  editor.commands.setNodeSelection(posOf(editor, id));
};
const toolbarOf = (editor: Editor): HTMLElement | null => editor.view.dom.querySelector<HTMLElement>('[role="toolbar"]');
const panelOf = (editor: Editor): HTMLElement | null => editor.view.dom.querySelector<HTMLElement>('.inc-tt-panel');
const areaOf = (editor: Editor): HTMLTextAreaElement => {
  const a = panelOf(editor)?.querySelector('textarea');
  if (!a) throw new Error('no code panel');
  return a;
};
const type = (editor: Editor, text: string): void => {
  const a = areaOf(editor);
  a.value = text;
  a.dispatchEvent(new Event('input', { bubbles: true }));
};
const openLines = (editor: Editor, id: string): void => {
  select(editor, id);
  const b = buttonNamed(toolbarOf(editor) as HTMLElement, /edit lines/i);
  if (!b) throw new Error('no Edit lines button');
  b.click();
};

describe('placeholder first (R2.1)', () => {
  it('shows each figure as a box of its exact size before the scheduler orders a mount', () => {
    const { editor } = makeEditor(docOf(fig(1, { width: 480, height: 222 }), fig(2), para('x')));
    const bs = boxes(editor);
    expect(bs).toHaveLength(2);
    expect(bs.every((b) => b.dataset['state'] !== 'live')).toBe(true);
    expect(bs[0]?.style.height).toBe('222px');
    expect(bs[0]?.style.width).toBe('480px');
    expect(bs[1]?.style.height).toBe('200px');
  });

  it('shows the picture at the node size when there is one, else the caption in a sized box', () => {
    const pic = 'data:image/svg+xml;base64,PHN2Zy8+';
    const { editor } = makeEditor(docOf(fig(1, { picture: pic, caption: 'With picture' }), fig(2, { caption: 'No picture' }), para('x')));
    const [a, b] = boxes(editor);
    expect(a?.querySelector('img')?.getAttribute('src')).toBe(pic);
    expect(b?.querySelector('img')).toBeNull();
    expect(editor.view.dom.textContent).toContain('No picture');
  });
});

describe('the scheduler and the live limit (R2.1, R2.2, R4.4, R11.1)', () => {
  it('has at most 3 figures live out of 6 that are all in view', async () => {
    const { editor } = makeEditor(docOf(...[1, 2, 3, 4, 5, 6].map((n) => fig(n)), para('x')));
    await until(() => liveBoxes(editor).length >= 3, 'three live figures');
    await real(400);
    expect(liveBoxes(editor)).toHaveLength(3);
    expect(mounted().length).toBeLessThanOrEqual(3);
  });

  it('never holds more than 3 mounted figures at once, even when the others scroll in', async () => {
    const { editor } = makeEditor(docOf(...[1, 2, 3, 4, 5, 6].map((n) => fig(n)), para('x')));
    await until(() => liveBoxes(editor).length >= 3, 'three live figures');
    for (const b of boxes(editor).slice(0, 3)) Viewport.set(b, false);
    await real(600);
    expect(mounted().length).toBeLessThanOrEqual(3);
    expect(liveBoxes(editor).length).toBeLessThanOrEqual(3);
  });

  it('follows the liveLimit option', async () => {
    const { editor } = makeEditor(docOf(...[1, 2, 3, 4].map((n) => fig(n)), para('x')), { liveLimit: 1 });
    await until(() => liveBoxes(editor).length >= 1, 'one live figure');
    await real(400);
    expect(liveBoxes(editor)).toHaveLength(1);
    expect(mounted()).toHaveLength(1);
  });

  it('lets a higher liveLimit mount more', async () => {
    const { editor } = makeEditor(docOf(...[1, 2, 3, 4, 5].map((n) => fig(n)), para('x')), { liveLimit: 5 });
    await until(() => liveBoxes(editor).length >= 5, 'five live figures');
    expect(liveBoxes(editor).length).toBeLessThanOrEqual(5);
  });

  it('opens a document of 50 figures with at most liveLimit mounted', async () => {
    const { editor } = makeEditor(docOf(...Array.from({ length: 50 }, (_, i) => fig(i + 1)), para('x')));
    expect(boxes(editor)).toHaveLength(50);
    await until(() => liveBoxes(editor).length >= 3, 'three live figures');
    await real(500);
    expect(liveBoxes(editor).length).toBeLessThanOrEqual(3);
    expect(mounted().length).toBeLessThanOrEqual(3);
    expect(figuresIn(editor.state.doc)).toHaveLength(50);
  });

  it('does not mount a figure that is out of view', async () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    const box = boxes(editor)[0] as HTMLElement;
    Viewport.set(box, false);
    await real(500);
    expect(liveBoxes(editor)).toHaveLength(0);
  });
});

describe('mounting a live figure (R2.3)', () => {
  it('creates the figure in the node mode with figure-mode UI: no menu, pan and zoom on', async () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const app = mounted()[0] as MountedApp;
    expect(app.mode).toBe('graphing');
    expect(app.ui.panAndZoom).toBe(true);
    expect(app.ui.menu).toBe(false);
    expect(app.value('b')).toBe(2);
  });

  it('shows the clock bar only for a figure that has a clock', async () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const clock = mounted()[0]?.element.querySelector<HTMLElement>('.inc-clock') ?? null;
    expect(clock === null || clock.hidden).toBe(true);
  });

  it('lets a reader drag and zoom in a read-only page', async () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')), { readOnly: true });
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const app = mounted()[0] as MountedApp;
    expect(app.ui.dragPoints).toBe(true);
    expect(app.ui.panAndZoom).toBe(true);
  });
});

describe('script changes from outside (R2.4)', () => {
  it('applies an outside change of the script to the live figure', async () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const app = mounted()[0] as MountedApp;
    editor.commands.updateIncantlyFigure('fig_001', { script: 'a = 10\nb = a + 5\nc = 7' });
    await until(() => app.value('c') === 7, 'the new line in the live figure');
    expect(app.value('b')).toBe(15);
  });

  it('applies an undo of the script to the live figure', async () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const app = mounted()[0] as MountedApp;
    editor.commands.updateIncantlyFigure('fig_001', { script: 'a = 10\nb = a + 5\nc = 7' });
    await until(() => app.value('c') === 7, 'the new line');
    expect(undoOnce(editor)).toBe(true);
    await until(() => app.value('b') === 2, 'the old script back in the live figure');
  });

  it('does not re-apply a change the node view made itself (panel commit)', async () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const app = mounted()[0] as MountedApp;
    openLines(editor, 'fig_001');
    const seen: string[] = [];
    for (const t of ['loaded', 'cleared', 'added', 'removed', 'redefined'] as const) app.on(t, () => seen.push(t));
    type(editor, 'a = 1\nb = a + 1\nc = 3');
    await until(() => figureAttrs(editor, 'fig_001')?.script === 'a = 1\nb = a + 1\nc = 3', 'the committed script');
    await real(200);
    expect(app.value('c')).toBe(3);
    expect(seen).not.toContain('cleared');
    expect(seen).not.toContain('loaded');
    expect(seen.filter((t) => t === 'added')).toHaveLength(1);
  });
});

describe('destroy (R2.6)', () => {
  it('frees every live figure when the editor is destroyed', async () => {
    const { editor } = makeEditor(docOf(fig(1), fig(2), para('x')));
    await until(() => liveBoxes(editor).length === 2, 'two live figures');
    editor.destroy();
    await real(100);
    expect(mounted()).toHaveLength(0);
  });

  it('frees the figure of a deleted node, and its room goes to another figure', async () => {
    const { editor } = makeEditor(docOf(...[1, 2, 3, 4].map((n) => fig(n)), para('x')));
    await until(() => liveBoxes(editor).length === 3, 'three live figures');
    const live = liveBoxes(editor)[0] as HTMLElement;
    const id = (live.closest('[data-id]') as HTMLElement).dataset['id'] as string;
    editor.commands.setNodeSelection(posOf(editor, id));
    editor.commands.deleteSelection();
    await until(() => liveBoxes(editor).length === 3 && mounted().length === 3, 'the fourth figure to take the room');
    expect(boxOf(editor, id)).toBeUndefined();
    expect(probe.apps.filter((a) => a.destroyed)).toHaveLength(1);
  });
});

describe('the toolbar (R3.1)', () => {
  it('shows when a figure is selected, with Edit lines, AI, Mode, Size, Caption and Delete', () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')), { aiTransport: async function* () { yield { done: true as const }; } });
    select(editor, 'fig_001');
    const bar = toolbarOf(editor) as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.hidden).toBe(false);
    expect(buttonNamed(bar, /edit lines/i)).toBeDefined();
    expect(buttonNamed(bar, /^AI$|ask the ai/i)).toBeDefined();
    expect(bar.querySelector('select[aria-label="Mode"], [aria-label="Mode"]')).not.toBeNull();
    expect(bar.querySelector('[aria-label="Width in pixels"]')).not.toBeNull();
    expect(bar.querySelector('[aria-label="Caption"]')).not.toBeNull();
    expect(buttonNamed(bar, /delete/i)).toBeDefined();
  });

  it('hides when the figure is not selected', () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    select(editor, 'fig_001');
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    const bar = toolbarOf(editor);
    expect(bar === null || bar.hidden).toBe(true);
  });

  it('Delete removes the figure', () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    select(editor, 'fig_001');
    buttonNamed(toolbarOf(editor) as HTMLElement, /delete/i)?.click();
    expect(figuresIn(editor.state.doc)).toHaveLength(0);
  });

  it('Mode changes the figure mode', async () => {
    const { editor } = makeEditor(docOf(fig(1, { mode: 'figure' }), para('x')));
    select(editor, 'fig_001');
    const sel = toolbarOf(editor)?.querySelector<HTMLSelectElement>('select[aria-label="Mode"]') as HTMLSelectElement;
    const other = Array.from(sel.options).find((o) => o.value === 'geometry');
    expect(other).toBeDefined();
    sel.value = 'geometry';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await real(5);
    expect(figureAttrs(editor, 'fig_001')?.mode).toBe('geometry');
  });

  it('Caption sets the caption when the writer presses Enter', async () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    select(editor, 'fig_001');
    const input = toolbarOf(editor)?.querySelector<HTMLInputElement>('[aria-label="Caption"]') as HTMLInputElement;
    input.value = 'A new caption';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await real(5);
    expect(figureAttrs(editor, 'fig_001')?.caption).toBe('A new caption');
  });

  it('Size switches between a pixel width and full width', async () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    select(editor, 'fig_001');
    const w = toolbarOf(editor)?.querySelector<HTMLInputElement>('[aria-label="Width in pixels"]') as HTMLInputElement;
    w.value = '480';
    w.dispatchEvent(new Event('input', { bubbles: true }));
    w.dispatchEvent(new Event('change', { bubbles: true }));
    await real(5);
    expect(figureAttrs(editor, 'fig_001')?.width).toBe(480);
    const full = buttonNamed(toolbarOf(editor) as HTMLElement, /full/i);
    expect(full).toBeDefined();
    full?.click();
    await real(5);
    expect(figureAttrs(editor, 'fig_001')?.width).toBe('full');
  });

  it('the bottom edge changes the height', async () => {
    const { editor } = makeEditor(docOf(fig(1, { height: 300 }), para('x')));
    const handle = editor.view.dom.querySelector<HTMLElement>('[aria-label="Figure height"]');
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute('role')).toBe('slider');
    handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await real(5);
    expect(figureAttrs(editor, 'fig_001')?.height).toBeGreaterThan(300);
  });
});

describe('the code panel (R3.2, R3.3)', () => {
  it('opens under the figure with the script, one row per line', () => {
    const { editor } = makeEditor(docOf(fig(1, { script: 'f(x) = x^2 - 2x - 3\nr2 = Rootz(f)\nc = 3' }), para('x')));
    openLines(editor, 'fig_001');
    const panel = panelOf(editor) as HTMLElement;
    expect(panel.hidden).toBe(false);
    expect(areaOf(editor).value).toBe('f(x) = x^2 - 2x - 3\nr2 = Rootz(f)\nc = 3');
    const rows = Array.from(panel.querySelectorAll('ol li')).map((l) => l.textContent ?? '').filter((t) => /[✓✗]/.test(t));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatch(/^✓ /);
    // an error row shows the message and the hint
    expect(rows[1]).toMatch(/^✗ /);
    expect(rows[1]).toMatch(/Root/);
    expect(rows[2]).toMatch(/^✓ /);
  });

  it('shows the value of a point as its result', () => {
    const { editor } = makeEditor(docOf(fig(1, { script: 'P = (1, 2)' }), para('x')));
    openLines(editor, 'fig_001');
    expect(panelOf(editor)?.textContent).toMatch(/\(1, 2\)/);
  });

  it('applies the lines 300 ms after the last key, with fake timers', async () => {
    vi.useFakeTimers();
    const { editor } = makeEditor(docOf(fig(1, { script: 'a = 1' }), para('x')));
    openLines(editor, 'fig_001');
    type(editor, 'a = 1\nb = 2');
    await vi.advanceTimersByTimeAsync(299);
    expect(figureAttrs(editor, 'fig_001')?.script).toBe('a = 1');
    await vi.advanceTimersByTimeAsync(1);
    expect(figureAttrs(editor, 'fig_001')?.script).toBe('a = 1\nb = 2');
  });

  it('restarts the 300 ms wait at every key, and commits one transaction for the batch', async () => {
    vi.useFakeTimers();
    const { editor } = makeEditor(docOf(fig(1, { script: 'a = 1' }), para('x')));
    openLines(editor, 'fig_001');
    let scriptChanges = 0;
    editor.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) scriptChanges++;
    });
    const before = scriptChanges;
    type(editor, 'a = 1\nb');
    await vi.advanceTimersByTimeAsync(200);
    type(editor, 'a = 1\nb = 2');
    await vi.advanceTimersByTimeAsync(200);
    type(editor, 'a = 1\nb = 2\nc = 3');
    await vi.advanceTimersByTimeAsync(299);
    expect(figureAttrs(editor, 'fig_001')?.script).toBe('a = 1');
    expect(scriptChanges).toBe(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(figureAttrs(editor, 'fig_001')?.script).toBe('a = 1\nb = 2\nc = 3');
    expect(scriptChanges - before).toBe(1);
  });

  it('is undone by one editor undo', async () => {
    vi.useFakeTimers();
    const { editor } = makeEditor(docOf(fig(1, { script: 'a = 1' }), para('x')));
    openLines(editor, 'fig_001');
    const steps = undoSteps(editor);
    type(editor, 'a = 1\nb = 2\nc = 3');
    await vi.advanceTimersByTimeAsync(300);
    expect(undoSteps(editor)).toBe(steps + 1);
    expect(undoOnce(editor)).toBe(true);
    expect(figureAttrs(editor, 'fig_001')?.script).toBe('a = 1');
  });

  it('commits the lines even when some lines have errors', async () => {
    vi.useFakeTimers();
    const { editor } = makeEditor(docOf(fig(1, { script: 'a = 1' }), para('x')));
    openLines(editor, 'fig_001');
    type(editor, 'a = 1\nb = Nope(((');
    await vi.advanceTimersByTimeAsync(300);
    expect(figureAttrs(editor, 'fig_001')?.script).toBe('a = 1\nb = Nope(((');
    expect(panelOf(editor)?.textContent).toMatch(/✗/);
  });

  it('closes with the Close button', () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')));
    openLines(editor, 'fig_001');
    buttonNamed(panelOf(editor) as HTMLElement, /close/i)?.click();
    expect(panelOf(editor)?.hidden).toBe(true);
  });
});

describe('line errors (R3.5, errors.md line errors)', () => {
  const script = 'f(x) = x^2\nr = Rootz(f)\nc = 3';

  it('draws the good lines and shows an error badge', async () => {
    const { editor } = makeEditor(docOf(fig(1, { script }), para('x')));
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const app = mounted()[0] as MountedApp;
    const names = app.list().map((o) => o.name);
    expect(names).toContain('f');
    expect(names).toContain('c');
    expect(names).not.toContain('r');
    const badge = editor.view.dom.querySelector<HTMLElement>('.inc-tt-badge');
    expect(badge).not.toBeNull();
    expect(badge?.hidden).toBe(false);
  });

  it('opens the code panel at the first bad line when the badge is used', async () => {
    const { editor } = makeEditor(docOf(fig(1, { script }), para('x')));
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const badge = editor.view.dom.querySelector<HTMLElement>('.inc-tt-badge') as HTMLElement;
    badge.click();
    expect(panelOf(editor)?.hidden).toBe(false);
    const a = areaOf(editor);
    expect(a.selectionStart).toBe('f(x) = x^2\n'.length);
  });

  it('shows no badge for a figure whose lines all work', async () => {
    const { editor } = makeEditor(docOf(fig(1, { script: 'a = 1\nb = 2' }), para('x')));
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const badge = editor.view.dom.querySelector<HTMLElement>('.inc-tt-badge');
    expect(badge === null || badge.hidden).toBe(true);
  });

  it('keeps the document as it was: a bad line is never removed from the script', async () => {
    const { editor } = makeEditor(docOf(fig(1, { script }), para('x')));
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    expect(figureAttrs(editor, 'fig_001')?.script).toBe(script);
  });
});

describe('read-only (R5.1, R5.2)', () => {
  it('shows no toolbar and no code panel for a selected figure', () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')), { readOnly: true });
    select(editor, 'fig_001');
    const bar = toolbarOf(editor);
    expect(bar === null || bar.hidden).toBe(true);
    const panel = panelOf(editor);
    expect(panel === null || panel.hidden).toBe(true);
  });

  it('shows no height handle that changes the figure', () => {
    const { editor } = makeEditor(docOf(fig(1, { height: 300 }), para('x')), { readOnly: true });
    const handle = editor.view.dom.querySelector<HTMLElement>('[aria-label="Figure height"]');
    handle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(figureAttrs(editor, 'fig_001')?.height).toBe(300);
  });

  it('still mounts and shows the live figure', async () => {
    const { editor } = makeEditor(docOf(fig(1), para('x')), { readOnly: true });
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
  });

  it('puts the caption on the figure for screen readers, then the object list', async () => {
    const { editor } = makeEditor(docOf(fig(1, { caption: 'A pair of numbers' }), para('x')), { readOnly: true });
    const box = boxOf(editor, 'fig_001') as HTMLElement;
    expect(box.getAttribute('aria-label')).toContain('A pair of numbers');
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const list = editor.view.dom.querySelector('[aria-label="Objects in the figure"]');
    expect(list).not.toBeNull();
    await until(() => (list?.textContent ?? '').includes('b'), 'the object list');
  });

  it('lets Tab reach the figure and Escape return focus to the document', async () => {
    const { editor } = makeEditor(docOf(para('before'), fig(1), para('after')), { readOnly: true });
    await until(() => liveBoxes(editor).length === 1, 'a live figure');
    const box = boxOf(editor, 'fig_001') as HTMLElement;
    const focusable = [box, ...Array.from(box.querySelectorAll<HTMLElement>('[tabindex], canvas, button'))].find((e) => e.tabIndex >= 0);
    expect(focusable).toBeDefined();
    focusable?.focus();
    expect(document.activeElement).toBe(focusable);
    focusable?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const active = document.activeElement;
    expect(active === editor.view.dom || editor.view.dom.contains(active) && !box.contains(active)).toBe(true);
  });
});
