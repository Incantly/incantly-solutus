import type { ExecutionAdapter, FigureHandle, FigureState, MountOptions } from '@incantly/core';
import { Editor, type JSONContent } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { DOMParser as ProseMirrorDOMParser, Slice } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import * as prosemirrorView from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIGURE_TRANSACTION,
  FigureNode,
  MemoryFigureStore,
  createFixtureDocument,
  figureScheduler,
  figureViews,
  type FigureErrorReport,
  type FigureNodeView,
  type ObserverFactory,
} from '../src';

// prosemirror-view exports its clipboard parser for tests, without a type declaration.
const parseFromClipboard = (prosemirrorView as unknown as {
  __parseFromClipboard: (view: Editor['view'], text: string, html: string, plain: boolean, $context: unknown) => Slice;
}).__parseFromClipboard;

const FRAGMENTS = { html: "<div id='stage'></div>", css: '', js: "inc.idea('A test figure.');" };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** An execution adapter that records what the node view asks of it. */
class FakeFigure implements FigureHandle {
  state: FigureState = 'live';
  readonly ready: Promise<FigureState>;
  paused = false;
  focused: string[] = [];
  constructor(
    readonly fragments: { html: string; css: string; js: string },
    readonly options: MountOptions,
    fail = false,
  ) {
    if (fail) {
      // Like the real adapters: the cause first, then the state.
      options.onError?.({ phase: 'mount', message: 'The figure did not pass validation (unknown-sdk-call in js)', line: 1, column: 5 });
      this.state = 'failed';
      options.onState?.('failed');
    }
    this.ready = Promise.resolve(this.state);
  }
  /** The scene hit a problem and paused itself; the figure stays live. */
  hit(message: string) {
    this.options.onError?.({ phase: 'frame', message });
  }
  /** The figure stopped responding and the adapter removed it. */
  crash() {
    this.options.onError?.({ phase: 'unresponsive', message: 'The figure stopped responding and was removed' });
    this.state = 'failed';
    this.options.onState?.('failed');
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  setValues() {}
  restore() {}
  setReducedMotion() {}
  focus(edge: 'first' | 'last' = 'first') {
    this.focused.push(edge);
  }
  measure() {
    return { width: 760, height: 800 };
  }
  snapshot() {
    return Promise.resolve(PNG);
  }
  destroy() {
    this.state = 'destroyed';
  }
}

function fakeAdapter(fail = false) {
  const mounts: FakeFigure[] = [];
  const control = { fail };
  const adapter: ExecutionAdapter = {
    name: 'fake',
    mount(container, fragments, options = {}) {
      const figure = new FakeFigure(fragments, options, control.fail);
      container.append(document.createElement('div'));
      mounts.push(figure);
      return figure;
    },
  };
  return { adapter, mounts, control, live: () => mounts.filter((m) => m.state === 'live') };
}

/** An observer the test drives: figures are near the viewport only when the test says so. */
function fakeObserver() {
  let callback: Parameters<ObserverFactory>[0] = () => undefined;
  const observed = new Set<Element>();
  const factory: ObserverFactory = (cb) => {
    callback = cb;
    return {
      observe: (el) => observed.add(el),
      unobserve: (el) => observed.delete(el),
      disconnect: () => observed.clear(),
    };
  };
  return {
    factory,
    observed,
    set(elements: Element[], near: boolean) {
      callback(elements.map((target) => ({ target, isIntersecting: near })));
    },
  };
}

const editors: Editor[] = [];

function setup(
  options: {
    content?: JSONContent;
    fail?: boolean;
    limit?: number;
    store?: MemoryFigureStore;
    onError?: (report: FigureErrorReport) => void;
  } = {},
) {
  const fake = fakeAdapter(options.fail);
  const observer = fakeObserver();
  const store = options.store ?? new MemoryFigureStore();
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      Image,
      FigureNode.configure({
        adapter: fake.adapter,
        store,
        settleMs: 500,
        scheduler: { limit: options.limit ?? 3, settleMs: 100, suspendAfterMs: 2000, createObserver: observer.factory },
        onError: options.onError ?? null,
      }),
    ],
    content: options.content ?? createFixtureDocument({ figures: 6, figure: () => ({ fragments: FRAGMENTS }) }),
  });
  editors.push(editor);
  const figures = () => [...editor.view.dom.querySelectorAll<HTMLElement>('figure.incantly-figure')];
  const view = (i: number) => figureViews.get(figures()[i]!)! as FigureNodeView;
  const attrs = (i: number) => {
    const found: Array<Record<string, unknown>> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'incantlyFigure') found.push(node.attrs);
    });
    return found[i]!;
  };
  return { editor, fake, observer, store, figures, view, attrs };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('live figures: the scheduler', () => {
  it('mounts nothing until figures come near the viewport, then waits for the scroll to settle', async () => {
    const { fake, observer, figures } = setup();
    expect(observer.observed.size).toBe(6);
    expect(fake.mounts).toHaveLength(0);
    observer.set(figures().slice(0, 2), true);
    expect(fake.mounts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.mounts).toHaveLength(2);
    expect(figures()[0]!.dataset.state).toBe('live');
  });

  it('never runs more than the limit, even when more figures are near', async () => {
    const { editor, fake, observer, figures } = setup();
    observer.set(figures(), true);
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.live()).toHaveLength(3);
    expect(figureScheduler(editor)!.stats.peakLive).toBe(3);
  });

  it('does not mount anything during a fast scroll past figures', async () => {
    const { fake, observer, figures } = setup();
    for (const figure of figures()) {
      observer.set([figure], true);
      await vi.advanceTimersByTimeAsync(20);
      observer.set([figure], false);
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(fake.mounts).toHaveLength(0);
  });

  it('pauses a figure that leaves at once, and suspends it after the grace period with a snapshot', async () => {
    const { fake, observer, figures, attrs, store } = setup();
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    const live = fake.mounts[0]!;
    observer.set([figures()[0]!], false);
    expect(live.paused).toBe(true);
    expect(live.state).toBe('live');
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(live.paused).toBe(false);
    observer.set([figures()[0]!], false);
    await vi.advanceTimersByTimeAsync(2100);
    expect(live.state).toBe('destroyed');
    expect(figures()[0]!.dataset.state).toBe('placeholder');
    expect(attrs(0).snapshotRef).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(attrs(0).aspect).toBeCloseTo(800 / 760, 3);
    expect(await store.getSnapshot(attrs(0).snapshotRef as string)).toBe(PNG);
    expect(figures()[0]!.querySelector('img.incantly-figure__snapshot')?.getAttribute('src')).toBe(PNG);
  });

  it('frees a slot from a figure that went away when a new one arrives', async () => {
    const { fake, observer, figures } = setup();
    observer.set(figures().slice(0, 3), true);
    await vi.advanceTimersByTimeAsync(100);
    observer.set([figures()[0]!], false);
    observer.set([figures()[3]!], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.mounts[0]!.state).toBe('destroyed');
    expect(fake.live()).toHaveLength(3);
    expect(figures()[3]!.dataset.state).toBe('live');
  });

  it('starts a figure the learner clicks, even at the limit', async () => {
    const { fake, observer, figures } = setup();
    observer.set(figures(), true);
    await vi.advanceTimersByTimeAsync(100);
    figures()[5]!.querySelector<HTMLElement>('.incantly-figure__frame')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(figures()[5]!.dataset.state).toBe('live');
    expect(fake.live()).toHaveLength(3);
  });
});

describe('live figures: persistence', () => {
  it('saves values, step and description once interaction settles, in one transaction outside history', async () => {
    const { editor, fake, observer, figures, attrs } = setup();
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    const options = fake.mounts[0]!.options;
    const persisted: string[] = [];
    editor.on('transaction', ({ transaction }) => {
      const cause = transaction.getMeta(FIGURE_TRANSACTION);
      if (cause) persisted.push(`${cause}:${transaction.getMeta('addToHistory')}`);
    });
    for (let i = 1; i <= 20; i++) {
      options.onValues?.({ k: i });
      await vi.advanceTimersByTimeAsync(50);
    }
    options.onStep?.(1);
    options.onDescription?.('A figure at k = 20.');
    expect(persisted).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(persisted).toEqual(['persist:false']);
    expect(attrs(0)).toMatchObject({ values: { k: 20 }, step: 1, description: 'A figure at k = 20.' });
  });

  it('keeps learner values out of undo, while undo still works for prose', async () => {
    const { editor, fake, observer, figures, attrs } = setup();
    editor.commands.setTextSelection(1);
    editor.commands.insertContent('Edited ');
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    fake.mounts[0]!.options.onValues?.({ k: 7 });
    await vi.advanceTimersByTimeAsync(600);
    expect(attrs(0).values).toEqual({ k: 7 });
    editor.commands.undo();
    expect(editor.getText()).not.toContain('Edited ');
    expect(attrs(0).values).toEqual({ k: 7 });
    editor.commands.redo();
    expect(editor.getText()).toContain('Edited ');
  });

  it('dispatches nothing when nothing changed', async () => {
    const { editor, fake, observer, figures } = setup({
      content: createFixtureDocument({ figures: 1, figure: () => ({ fragments: FRAGMENTS, values: { k: 3 } }) }),
    });
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    const spy = vi.fn();
    editor.on('transaction', spy);
    fake.mounts[0]!.options.onValues?.({ k: 3 });
    await vi.advanceTimersByTimeAsync(600);
    expect(spy).not.toHaveBeenCalled();
  });

  it('restores values and step position when the note is reopened', async () => {
    const first = setup();
    first.observer.set([first.figures()[1]!], true);
    await vi.advanceTimersByTimeAsync(100);
    first.fake.mounts[0]!.options.onValues?.({ amplitude: 3.5 });
    first.fake.mounts[0]!.options.onStep?.(2);
    await vi.advanceTimersByTimeAsync(600);
    const saved = first.editor.getJSON();

    const reopened = setup({ content: saved });
    reopened.observer.set([reopened.figures()[1]!], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(reopened.fake.mounts[0]!.options).toMatchObject({ values: { amplitude: 3.5 }, step: 2 });
  });

  it('saves pending changes when the editor is destroyed', async () => {
    const { editor, fake, observer, figures } = setup();
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    fake.mounts[0]!.options.onValues?.({ k: 9 });
    editor.destroy();
    let values: unknown;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'incantlyFigure' && values === undefined) values = node.attrs.values;
    });
    expect(values).toEqual({ k: 9 });
    expect(fake.mounts[0]!.state).toBe('destroyed');
  });

  it('loads fragments stored by reference', async () => {
    const store = new MemoryFigureStore();
    const ref = await store.putFragments(FRAGMENTS);
    const { fake, observer, figures } = setup({
      store,
      content: createFixtureDocument({ figures: 1, figure: () => ({ fragments: null, fragmentsRef: ref }) }),
    });
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.mounts[0]!.fragments).toEqual(FRAGMENTS);
  });

  it('shows the description and a quiet message when a figure cannot run', async () => {
    const { fake, observer, figures, view } = setup({ fail: true });
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.mounts).toHaveLength(1);
    expect(figures()[0]!.dataset.state).toBe('failed');
    expect(view(0).canRun).toBe(false);
    expect(figures()[0]!.querySelector('.incantly-figure__status')?.textContent).toContain('could not be shown');
    expect(figures()[0]!.querySelector('figcaption')?.textContent).toBeTruthy();
  });
});

describe('live figures: lifecycle', () => {
  it('deleting a live figure ends its instance and releases its observer slot', async () => {
    const { editor, fake, observer, figures } = setup();
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    const live = fake.mounts[0]!;
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos < 0 && node.type.name === 'incantlyFigure') pos = p;
    });
    editor.commands.setNodeSelection(pos);
    editor.commands.deleteSelection();
    expect(live.state).toBe('destroyed');
    expect(observer.observed.size).toBe(5);
    expect(figureScheduler(editor)!.stats.registered).toBe(5);
  });

  it('treats repeated pause, resume, mount and suspend as no-ops', async () => {
    const { fake, observer, figures, view } = setup();
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    view(0).mount();
    view(0).mount();
    expect(fake.mounts).toHaveLength(1);
    view(0).pause();
    view(0).pause();
    view(0).resume();
    await Promise.all([view(0).suspend(), view(0).suspend()]);
    expect(fake.mounts[0]!.state).toBe('destroyed');
    await view(0).suspend();
    expect(figures()[0]!.dataset.state).toBe('placeholder');
  });
});

describe('live figures: problems', () => {
  const content = createFixtureDocument({
    figures: 2,
    figure: () => ({ fragments: FRAGMENTS, values: { k: 3 }, meta: { generationId: 'gen-7' } }),
  });

  it('tells the host once about a figure that cannot run, with the learner state and no note content', async () => {
    const reports: FigureErrorReport[] = [];
    const { observer, figures, attrs } = setup({ fail: true, content, onError: (r) => reports.push(r) });
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(figures()[0]!.dataset.state).toBe('failed');
    expect(reports).toEqual([
      {
        figureId: attrs(0).figureId,
        generationId: 'gen-7',
        error: { phase: 'mount', message: 'The figure did not pass validation (unknown-sdk-call in js)', line: 1, column: 5 },
        fatal: true,
        values: { k: 3 },
        step: null,
      },
    ]);
  });

  it('tells the host about a problem a live figure paused on, once per problem, and keeps it live', async () => {
    const reports: FigureErrorReport[] = [];
    const { fake, observer, figures, view } = setup({ content, onError: (r) => reports.push(r) });
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    const figure = fake.mounts[0]!;
    figure.options.onValues?.({ k: 4 });
    figure.hit('Math.sqrt(-1) is not a number');
    figure.hit('Math.sqrt(-1) is not a number');
    await vi.advanceTimersByTimeAsync(0);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ fatal: false, error: { phase: 'frame' }, values: { k: 4 } });
    expect(figures()[0]!.dataset.state).toBe('live');
    expect(view(0).lastError?.phase).toBe('frame');
    figure.hit('Division by zero');
    await vi.advanceTimersByTimeAsync(0);
    expect(reports.map((r) => r.error.message)).toEqual(['Math.sqrt(-1) is not a number', 'Division by zero']);
  });

  it('tells the host about a figure that stopped responding, as fatal, once', async () => {
    const reports: FigureErrorReport[] = [];
    const { fake, observer, figures } = setup({ content, onError: (r) => reports.push(r) });
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    fake.mounts[0]!.crash();
    await vi.advanceTimersByTimeAsync(0);
    expect(figures()[0]!.dataset.state).toBe('failed');
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ fatal: true, error: { phase: 'unresponsive' } });
  });

  it('gives a failed figure a new chance when its source is replaced', async () => {
    const { editor, fake, observer, figures } = setup({ fail: true, content });
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(figures()[0]!.dataset.state).toBe('failed');
    fake.control.fail = false;
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos < 0 && node.type.name === 'incantlyFigure') pos = p;
    });
    // A regenerated figure replaces its fragments in an ordinary, undoable edit.
    editor.view.dispatch(editor.state.tr.setNodeAttribute(pos, 'fragments', { ...FRAGMENTS, js: `${FRAGMENTS.js}\n// repaired` }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.mounts).toHaveLength(2);
    expect(fake.mounts[1]!.fragments.js).toContain('repaired');
    expect(figures()[0]!.dataset.state).toBe('live');
  });

  it('keeps the note working when the host reporting throws', async () => {
    const { observer, figures } = setup({
      fail: true,
      content,
      onError: () => {
        throw new Error('the host reporting is broken');
      },
    });
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(figures()[0]!.dataset.state).toBe('failed');
  });
});

describe('live figures: editor integration', () => {
  it('Enter on a selected figure starts it and moves keyboard focus inside', async () => {
    const { editor, fake, figures } = setup();
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos < 0 && node.type.name === 'incantlyFigure') pos = p;
    });
    editor.commands.setNodeSelection(pos);
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })));
    await vi.advanceTimersByTimeAsync(0);
    expect(figures()[0]!.dataset.state).toBe('live');
    expect(fake.mounts[0]!.focused).toEqual(['first']);
  });

  it('hands focus back to the editor on Escape and Tab', async () => {
    const { editor, fake, observer, figures } = setup();
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    const options = fake.mounts[0]!.options;
    options.onEscape?.('out');
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe('incantlyFigure');
    options.onEscape?.('forward');
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    const after = editor.state.selection.from;
    options.onEscape?.('backward');
    expect(editor.state.selection.from).toBeLessThan(after);
  });

  it('owns events inside the live figure and leaves the rest to the editor', async () => {
    const { observer, figures, view } = setup();
    observer.set([figures()[0]!], true);
    await vi.advanceTimersByTimeAsync(100);
    const inside = figures()[0]!.querySelector('.incantly-figure__live')!;
    const caption = figures()[0]!.querySelector('figcaption')!;
    expect(view(0).stopEvent({ target: inside } as unknown as Event)).toBe(true);
    expect(view(0).stopEvent({ target: caption } as unknown as Event)).toBe(false);
    expect(view(1).stopEvent({ target: figures()[1] } as unknown as Event)).toBe(false);
    expect(view(0).ignoreMutation({ type: 'attributes', target: inside } as unknown as MutationRecord)).toBe(true);
    expect(view(0).ignoreMutation({ type: 'selection', target: inside })).toBe(false);
  });

  it('copies and pastes a figure with every attribute, under a new id', () => {
    const { editor } = setup({
      content: createFixtureDocument({
        figures: 1,
        figure: () => ({ fragments: FRAGMENTS, values: { k: 2 }, step: 1, snapshotRef: `sha256:${'a'.repeat(64)}`, meta: { generationId: 'gen-1' } }),
      }),
    });
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos < 0 && node.type.name === 'incantlyFigure') pos = p;
    });
    const node = editor.state.doc.nodeAt(pos)!;
    const { dom, text } = editor.view.serializeForClipboard(new Slice(editor.state.doc.slice(pos, pos + node.nodeSize).content, 0, 0));
    const slice = parseFromClipboard(editor.view, text, dom.innerHTML, false, editor.state.doc.resolve(1));
    const pasted = slice.content.firstChild!;
    expect(pasted.attrs).toEqual(node.attrs);
    editor.view.dispatch(editor.state.tr.insert(editor.state.doc.content.size, slice.content));
    const ids: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'incantlyFigure') ids.push(n.attrs.figureId);
    });
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('drops anything a pasted figure should not carry', () => {
    const { editor } = setup({ content: { type: 'doc', content: [{ type: 'paragraph' }] } });
    const html =
      '<figure data-incantly-figure="" data-figure-id="fig-x" data-values=\'{"k":2,"bad":"x","inf":1e999}\' ' +
      'data-meta=\'{"generationId":"gen-2","prompt":"secret","model":"m"}\' data-snapshot-ref="javascript:alert(1)" ' +
      'data-fragments=\'{"html":1}\'><figcaption>Pasted</figcaption></figure>';
    const element = document.createElement('div');
    element.innerHTML = html;
    const doc = ProseMirrorDOMParser.fromSchema(editor.schema).parse(element);
    const attrs = doc.firstChild!.attrs;
    expect(attrs.values).toEqual({ k: 2 });
    expect(attrs.meta).toEqual({ generationId: 'gen-2' });
    expect(attrs.snapshotRef).toBeNull();
    expect(attrs.fragments).toBeNull();
  });
});
