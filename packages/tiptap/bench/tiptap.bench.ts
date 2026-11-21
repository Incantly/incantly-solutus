/**
 * Tiptap benchmarks against the targets of .kiro/specs/tiptap/requirements.md R11 (happy-dom, warm).
 *
 * Run: `npx vitest run --config packages/tiptap/bench/vitest.config.ts`. Each case is a test that fails when it misses
 * its target. Every figure is placed on screen, which is the worst case for the scheduler.
 */
import { performance } from 'node:perf_hooks';
import { Editor, Node } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Incantly } from '../src/index';
import { peekRuntime } from '../src/runtime';

const Doc = Node.create({ name: 'doc', topNode: true, content: 'block+' });
const Paragraph = Node.create({ name: 'paragraph', group: 'block', content: 'inline*', parseHTML: () => [{ tag: 'p' }], renderHTML: () => ['p', 0] });
const Text = Node.create({ name: 'text', group: 'inline' });

const LIVE_LIMIT = 3;
const FIGURES = 50;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function document50(): JSONContent {
  const content: JSONContent[] = [];
  for (let i = 0; i < FIGURES; i++) {
    content.push({ type: 'paragraph', content: [{ type: 'text', text: `Figure ${i + 1}` }] });
    content.push({
      type: 'incantlyFigure',
      attrs: { id: `fig_${String(i).padStart(8, '0')}`, mode: 'graphing', height: 300, width: 600, script: `f(x) = x^2 + ${i}\nP = (${i % 5}, 1)\nc = Circle(P, 1)` },
    });
  }
  return { type: 'doc', content };
}

function open(content: JSONContent): Editor {
  const element = document.createElement('div');
  document.body.append(element);
  return new Editor({ element, extensions: [Doc, Paragraph, Text, Incantly.configure({ liveLimit: LIVE_LIMIT })], content });
}

const liveBoxes = (editor: Editor): number => editor.view.dom.querySelectorAll('.inc-tt-box[data-state="live"]').length;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[xs.length >> 1] as number;

let restore: (() => void) | undefined;

/** An observer that reports every element it is given as in view: happy-dom has no layout. */
class EverythingInView {
  constructor(private readonly callback: (entries: { target: Element; isIntersecting: boolean }[]) => void) {}
  observe(target: Element): void {
    queueMicrotask(() => this.callback([{ target, isIntersecting: true }]));
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  const g = globalThis as { IntersectionObserver?: unknown };
  const original = g.IntersectionObserver;
  g.IntersectionObserver = EverythingInView;
  restore = (): void => {
    g.IntersectionObserver = original;
  };
});

afterAll(() => restore?.());

describe('a document of 50 figures (R11.1)', () => {
  it('opens with at most liveLimit mounted', async () => {
    const t0 = performance.now();
    const editor = open(document50());
    const opened = performance.now() - t0;
    await sleep(900);
    const live = liveBoxes(editor);
    const boxes = editor.view.dom.querySelectorAll('.inc-tt-box').length;
    console.log(`open ${FIGURES} figures: ${opened.toFixed(1)} ms, ${boxes} boxes, ${live} live (limit ${LIVE_LIMIT})`);
    expect(boxes).toBe(FIGURES);
    expect(live).toBeLessThanOrEqual(LIVE_LIMIT);
    expect(opened).toBeLessThan(1000);
    editor.destroy();
  });
});

describe('editing (R11.2: under 16 ms of main-thread work outside the figure\'s own apply)', () => {
  it('inserting a figure under 16 ms', async () => {
    const editor = open(document50());
    await sleep(300);
    const samples: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t = performance.now();
      editor.commands.insertIncantlyFigure({ script: '', id: `fig_ins${String(i).padStart(5, '0')}` });
      samples.push(performance.now() - t);
    }
    const m = median(samples);
    console.log(`insert a figure in a document of ${FIGURES}: median ${m.toFixed(2)} ms, worst ${Math.max(...samples).toFixed(2)} ms`);
    expect(m).toBeLessThan(16);
    editor.destroy();
  });

  it('a code-panel commit under 16 ms', async () => {
    const editor = open(document50());
    // the last figure is far down the page and stays a picture or an empty box: the commit costs no figure apply
    const id = `fig_${String(FIGURES - 1).padStart(8, '0')}`;
    await sleep(900);
    const view = peekRuntime(editor)?.viewOf(id);
    expect(view).toBeDefined();
    const samples: number[] = [];
    for (let i = 0; i < 15; i++) {
      const t = performance.now();
      view?.commitScript(`f(x) = x^2 + ${i}\nP = (1, 1)\nc = Circle(P, ${i + 1})`);
      await Promise.resolve();
      samples.push(performance.now() - t);
    }
    const m = median(samples);
    console.log(`code-panel commit: median ${m.toFixed(2)} ms, worst ${Math.max(...samples).toFixed(2)} ms`);
    expect(m).toBeLessThan(16);
    editor.destroy();
  });
});
