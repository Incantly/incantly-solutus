/**
 * R11: speed. A document with 50 figures opens with at most liveLimit mounted and no frames for still figures;
 * inserting a figure and a code-panel commit each cost under 16 ms of main-thread work (median of several runs, in
 * happy-dom, which is slower than a browser at DOM work).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { figuresIn } from '../../src/index';
import { Viewport, boxes, destroyAll, docOf, figureJson, liveBoxes, makeEditor, para, posOf, real, until } from './helpers';

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Viewport);
});
afterEach(() => {
  destroyAll();
  Viewport.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const fifty = () =>
  docOf(
    ...Array.from({ length: 50 }, (_, i) => figureJson({ id: `fig_${String(i).padStart(3, '0')}`, script: `a = ${i}\nP = (${i % 5}, 1)\nc = Circle(P, 1)`, mode: 'graphing', height: 300, width: 600 })),
    para('end'),
  );

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;

describe('a document of 50 figures (R11.1)', () => {
  it('opens with at most liveLimit mounted', async () => {
    const { editor } = makeEditor(fifty());
    expect(boxes(editor)).toHaveLength(50);
    expect(figuresIn(editor.state.doc)).toHaveLength(50);
    await until(() => liveBoxes(editor).length >= 3, 'three live figures');
    await real(600);
    expect(liveBoxes(editor).length).toBeLessThanOrEqual(3);
  });

  it('draws no frames for figures that are still', async () => {
    const { editor } = makeEditor(fifty());
    await until(() => liveBoxes(editor).length === 3, 'three live figures');
    await real(600);
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame');
    await real(500);
    expect(raf).not.toHaveBeenCalled();
  });
});

describe('main-thread cost (R11.2)', () => {
  it('inserting a figure costs under 16 ms', () => {
    const { editor } = makeEditor(fifty());
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      editor.commands.focus('end');
      const t0 = performance.now();
      editor.commands.insertIncantlyFigure({ script: `z = ${i}` });
      times.push(performance.now() - t0);
    }
    expect(median(times)).toBeLessThan(16);
  });

  it('a code-panel commit 300 ms after the last key costs under 16 ms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { editor } = makeEditor(fifty());
    editor.commands.setNodeSelection(posOf(editor, 'fig_010'));
    const toolbar = editor.view.dom.querySelector('[role="toolbar"]:not([hidden])') as HTMLElement;
    Array.from(toolbar.querySelectorAll('button')).find((b) => /edit lines/i.test(b.textContent ?? ''))?.click();
    const area = editor.view.dom.querySelector('.inc-tt-panel:not([hidden]) textarea') as HTMLTextAreaElement;
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      area.value = `a = 10\nP = (0, 1)\nc = Circle(P, 1)\nd = ${i}`;
      area.dispatchEvent(new Event('input', { bubbles: true }));
      const t0 = performance.now();
      await vi.advanceTimersByTimeAsync(300);
      times.push(performance.now() - t0);
    }
    expect(median(times)).toBeLessThan(16);
  });
});
