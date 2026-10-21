import { VALIDATOR_VERSION, type ExecutionAdapter, type FigureHandle, type FigureState, type MountOptions } from '@incantly/core';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FigureGeneration,
  FigureNode,
  MemoryFigureStore,
  createFixtureDocument,
  figureViews,
  pendingFigures,
  type FigureGenerate,
  type FigureGenerationResult,
  type FigureSignal,
  type ObserverFactory,
} from '../src';

const FRAGMENTS = { html: "<div id='stage'></div>", css: '', js: "inc.idea('A generated figure.');" };

/** A generate function the test resolves by hand. */
function controlled() {
  const calls: Array<{
    prompt: string;
    hooks: Parameters<FigureGenerate>[1];
    resolve: (result: FigureGenerationResult) => void;
  }> = [];
  const generate: FigureGenerate = (request, hooks) =>
    new Promise((resolve) => {
      calls.push({ prompt: request.prompt, hooks, resolve });
    });
  return { generate, calls };
}

class FakeFigure implements FigureHandle {
  state: FigureState = 'live';
  readonly ready = Promise.resolve<FigureState>('live');
  constructor(readonly options: MountOptions) {}
  pause() {}
  resume() {}
  setValues() {}
  restore() {}
  setReducedMotion() {}
  focus() {}
  measure() {
    return { width: 760, height: 480 };
  }
  snapshot() {
    return Promise.resolve('data:image/png;base64,iVBORw0KGgo=');
  }
  destroy() {
    this.state = 'destroyed';
  }
}

const editors: Editor[] = [];

function setup(generate: FigureGenerate, options: { signals?: (s: FigureSignal) => void; figures?: number } = {}) {
  const mounts: FakeFigure[] = [];
  const adapter: ExecutionAdapter = {
    name: 'fake',
    mount(container, _fragments, mountOptions = {}) {
      container.append(document.createElement('div'));
      const figure = new FakeFigure(mountOptions);
      mounts.push(figure);
      return figure;
    },
  };
  let near: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void = () => undefined;
  const createObserver: ObserverFactory = (callback) => {
    near = callback;
    return { observe: () => undefined, unobserve: () => undefined, disconnect: () => undefined };
  };
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      FigureNode.configure({
        adapter,
        store: new MemoryFigureStore(),
        scheduler: { settleMs: 10, createObserver },
        ...(options.signals ? { signals: options.signals } : {}),
      }),
      FigureGeneration.configure({ generate }),
    ],
    content: createFixtureDocument({ figures: options.figures ?? 0, figure: () => ({ fragments: FRAGMENTS }) }),
  });
  editors.push(editor);
  const figures = () => editor.getJSON().content?.filter((n) => n.type === 'incantlyFigure') ?? [];
  const card = () => editor.view.dom.querySelector<HTMLElement>('figure.incantly-figure--generating');
  const show = (dom: Element) => near([{ target: dom, isIntersecting: true }]);
  return { editor, figures, card, mounts, show };
}

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

const SKELETON = {
  concept: 'projectile motion',
  parameters: [
    { name: 'speed', unit: 'm/s', min: 5, max: 20, default: 18 },
    { name: 'angle', unit: 'degrees', min: 10, max: 80, default: 45 },
    { name: 'gravity', min: 5, max: 20, default: 9.8 },
  ],
  steps: 4,
};

const FIGURE = { fragments: FRAGMENTS, concept: 'projectile motion', description: 'A thrown ball follows a parabola.', generationId: 'gen-1', approvedAt: '2026-10-21T10:00:00.000Z' };

describe('making a figure in a note', () => {
  it('shows a skeleton card, drawn from the plan, and stores nothing until the figure is approved', () => {
    const { generate, calls } = controlled();
    const { editor, figures, card } = setup(generate);
    expect(editor.commands.generateFigure({ prompt: 'Explain projectile motion' })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(card()?.getAttribute('aria-busy')).toBe('true');
    expect(card()?.querySelector('.incantly-figure__status')?.textContent).toBe('Planning the figure…');
    expect(figures()).toHaveLength(0);

    calls[0]!.hooks.onSkeleton(SKELETON);
    calls[0]!.hooks.onStage('building');
    expect(card()?.querySelector('.incantly-skeleton__title')?.textContent).toBe('projectile motion');
    expect(card()?.getAttribute('aria-label')).toBe('Making a figure: projectile motion');
    const sliders = [...card()!.querySelectorAll<HTMLInputElement>('input[type=range]')];
    expect(sliders.map((s) => [s.disabled, s.value])).toEqual([
      [true, '18'],
      [true, '45'],
      [true, '9.8'],
    ]);
    expect(card()?.textContent).toContain('speed (m/s)');
    expect(card()?.querySelector('.incantly-figure__status')?.textContent).toBe('Drawing the figure…');
    expect(figures()).toHaveLength(0);
    expect(pendingFigures(editor.view)).toBe(1);
  });

  it('inserts the approved figure where the card is, after edits around it, as an undoable edit', async () => {
    const { generate, calls } = controlled();
    const { editor, figures, card } = setup(generate);
    editor.commands.setTextSelection(1);
    editor.commands.generateFigure({ prompt: 'Explain projectile motion' });
    // The learner keeps writing above the card.
    editor.commands.insertContentAt(0, '<p>A new first line.</p>');
    calls[0]!.resolve({ kind: 'figure', figure: FIGURE });
    await vi.runAllTimersAsync();
    expect(card()).toBeNull();
    const [figure] = figures();
    expect(figure?.attrs).toMatchObject({
      concept: 'projectile motion',
      fragments: FRAGMENTS,
      description: 'A thrown ball follows a parabola.',
      meta: { generationId: 'gen-1', approvedAt: '2026-10-21T10:00:00.000Z', validatorVersion: VALIDATOR_VERSION },
    });
    expect(String(figure?.attrs?.figureId)).toMatch(/^fig-/);
    const content = editor.getJSON().content!;
    expect((content[0]!.content?.[0] as { text?: string } | undefined)?.text).toBe('A new first line.');
    // Right after the block that held the selection, which is now the second.
    expect(content.findIndex((n) => n.type === 'incantlyFigure')).toBe(2);
    editor.commands.undo();
    expect(figures()).toHaveLength(0);
    expect(pendingFigures(editor.view)).toBe(0);
  });

  it('shows the notice of a standard figure under it', async () => {
    const { generate, calls } = controlled();
    const { editor, show } = setup(generate);
    editor.commands.generateFigure({ prompt: 'Explain projectile motion' });
    calls[0]!.resolve({ kind: 'figure', figure: { ...FIGURE, generationId: null }, notice: 'This is a standard version of this figure.' });
    // Let the result arrive, without running the notice's own timer.
    await vi.advanceTimersByTimeAsync(0);
    const dom = editor.view.dom.querySelector('figure.incantly-figure')!;
    expect(dom.querySelector('.incantly-figure__status')?.textContent).toBe('This is a standard version of this figure.');
    show(dom);
    expect(figureViews.get(dom)).toBeDefined();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(dom.querySelector('.incantly-figure__status')?.textContent).toBe('');
  });

  it('says in one line when a figure cannot be built, and offers Retry and Dismiss', async () => {
    const { generate, calls } = controlled();
    const { editor, figures, card } = setup(generate);
    editor.commands.generateFigure({ prompt: 'Explain photosynthesis' });
    calls[0]!.resolve({ kind: 'failed', message: 'This figure could not be built.' });
    await vi.runAllTimersAsync();
    expect(card()?.classList.contains('is-failed')).toBe(true);
    expect(card()?.querySelector('.incantly-figure__status')?.textContent).toBe('This figure could not be built.');
    expect(card()?.querySelector('.incantly-skeleton__request')?.textContent).toBe('Explain photosynthesis');
    expect(figures()).toHaveLength(0);

    const button = (name: string) => [...card()!.querySelectorAll('button')].find((b) => b.textContent === name)!;
    button('Retry').click();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.prompt).toBe('Explain photosynthesis');
    expect(card()?.classList.contains('is-failed')).toBe(false);
    calls[1]!.resolve({ kind: 'failed', message: 'This figure could not be built.' });
    await vi.runAllTimersAsync();
    button('Dismiss').click();
    expect(card()).toBeNull();
    expect(pendingFigures(editor.view)).toBe(0);
  });

  it('cancels the figures still being made when the note closes', () => {
    const { generate, calls } = controlled();
    const { editor } = setup(generate);
    editor.commands.generateFigure({ prompt: 'one' });
    editor.commands.generateFigure({ prompt: 'two' });
    editor.destroy();
    expect(calls.map((c) => c.hooks.signal.aborted)).toEqual([true, true]);
  });

  it('does nothing without a generator or a request', () => {
    const { generate } = controlled();
    const { editor } = setup(generate);
    expect(editor.commands.generateFigure({ prompt: '   ' })).toBe(false);
    const bare = new Editor({ element: document.createElement('div'), extensions: [StarterKit, FigureGeneration] });
    editors.push(bare);
    expect(bare.commands.generateFigure({ prompt: 'sine wave' })).toBe(false);
  });
});

describe('product signals from figures in a note', () => {
  it('reports showing, parameter changes once each, steps and completing the walkthrough', async () => {
    const signals: FigureSignal[] = [];
    const { generate } = controlled();
    const { editor, mounts, show } = setup(generate, { figures: 1, signals: (s) => signals.push(s) });
    const dom = editor.view.dom.querySelector('figure.incantly-figure')!;
    show(dom);
    await vi.advanceTimersByTimeAsync(20);
    const figureId = String(editor.getJSON().content?.find((n) => n.type === 'incantlyFigure')?.attrs?.figureId);
    expect(signals.map((s) => s.type)).toEqual(['figure-shown', 'first-paint', 'interactive']);
    const live = mounts[0]!;
    live.options.onValues?.({ speed: 12 });
    live.options.onValues?.({ speed: 13, angle: 30 });
    live.options.onStep?.(0, 3);
    live.options.onStep?.(2, 3);
    live.options.onStep?.(2, 3);
    expect(signals.slice(3)).toEqual([
      { type: 'parameter-changed', figureId, parameter: 'speed' },
      { type: 'parameter-changed', figureId, parameter: 'angle' },
      { type: 'step-reached', figureId, step: 0, count: 3 },
      { type: 'step-reached', figureId, step: 2, count: 3 },
      { type: 'steps-completed', figureId, count: 3 },
      { type: 'step-reached', figureId, step: 2, count: 3 },
    ]);
    editor.destroy();
    expect(signals.at(-1)).toMatchObject({ type: 'figure-left', figureId, interacted: true, abandoned: false });
  });

  it('counts a figure left within a minute without being used as abandoned', async () => {
    const signals: FigureSignal[] = [];
    const { generate } = controlled();
    const { editor, show } = setup(generate, { figures: 1, signals: (s) => signals.push(s) });
    show(editor.view.dom.querySelector('figure.incantly-figure')!);
    await vi.advanceTimersByTimeAsync(20);
    editor.destroy();
    expect(signals.at(-1)).toMatchObject({ type: 'figure-left', interacted: false, abandoned: true });
  });

  it('reports a stored figure whose source is missing as a restore failure', async () => {
    const signals: FigureSignal[] = [];
    const { generate } = controlled();
    const ref = `sha256:${'0'.repeat(64)}`;
    const { editor, show } = setup(generate, { signals: (s) => signals.push(s) });
    editor.commands.insertContent({ type: 'incantlyFigure', attrs: { figureId: 'fig-stored', fragments: null, fragmentsRef: ref } });
    show(editor.view.dom.querySelector('figure.incantly-figure')!);
    await vi.advanceTimersByTimeAsync(20);
    expect(signals).toContainEqual({ type: 'restore-failure', figureId: 'fig-stored', reason: 'source-missing' });
  });
});
