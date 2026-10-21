import type { ErrorView, ExecutionAdapter, FigureHandle } from '@incantly/core';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import { DEFAULT_ASPECT, type FigureAttributes, type FigureFragments } from './attributes';
import type { LiveFigureScheduler, ScheduledFigure } from './scheduler';
import type { FigureStore } from './store';

/** Transactions this extension dispatches carry this meta key, with the cause as its value. */
export const FIGURE_TRANSACTION = 'incantlyFigure';

export type FigureViewState = 'placeholder' | 'mounting' | 'live' | 'suspending' | 'failed' | 'destroyed';

export interface FigureViewOptions {
  readonly adapter: ExecutionAdapter;
  readonly store: FigureStore | null;
  readonly scheduler: LiveFigureScheduler;
  /** Persist learner changes this long after the last one. */
  readonly settleMs: number;
  readonly theme: 'light' | 'dark' | 'auto';
  readonly onError?: ((report: FigureErrorReport) => void) | null | undefined;
}

/**
 * A problem a figure in a note ran into, for the host's own reporting: the
 * failure kind and the learner state it happened in (RP-11). It carries no
 * note content: no fragments, description or concept.
 */
export interface FigureErrorReport {
  readonly figureId: string;
  /** The server-side generation record, when the figure was generated. */
  readonly generationId?: string;
  readonly error: ErrorView;
  /** True when the figure could not run at all; false when it ran and paused itself. */
  readonly fatal: boolean;
  readonly values: Readonly<Record<string, number>>;
  readonly step: number | null;
}

/** Node views by their DOM, so editor commands can reach the view of a selected node. */
export const figureViews = new WeakMap<Element, FigureNodeView>();

interface Pending {
  values?: Record<string, number>;
  step?: number | null;
  description?: string;
  snapshot?: string;
  aspect?: number;
}

/**
 * The figure's node view. It renders a lightweight placeholder, which the
 * scheduler may turn into a live figure through the execution adapter, and
 * back. Learner values, step position and the text alternative are saved to
 * the node when interaction settles, outside the undo history.
 */
export class FigureNodeView implements NodeView, ScheduledFigure {
  readonly dom: HTMLElement;
  readonly element: HTMLElement;
  state: FigureViewState = 'placeholder';
  private readonly frame: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly status: HTMLElement;
  private handle: FigureHandle | null = null;
  private pending: Pending = {};
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotUrl: string | undefined;
  private failure: ErrorView | null = null;
  private focusOnLive: 'first' | 'last' | null = null;
  private mountedAt = 0;
  private generation = 0;

  constructor(
    private node: ProseMirrorNode,
    private readonly editor: Editor,
    private readonly getPos: () => number | undefined,
    private readonly options: FigureViewOptions,
  ) {
    // Node views are built while the editor view is still being created, so use the host's document.
    const host = editor.options.element;
    const doc = host instanceof Element ? host.ownerDocument : document;
    this.dom = doc.createElement('figure');
    this.dom.className = 'incantly-figure';
    this.dom.contentEditable = 'false';
    this.element = this.dom;
    this.frame = doc.createElement('div');
    this.frame.className = 'incantly-figure__frame';
    this.status = doc.createElement('p');
    this.status.className = 'incantly-figure__status';
    this.status.hidden = true;
    this.caption = doc.createElement('figcaption');
    this.caption.className = 'incantly-figure__description';
    this.dom.append(this.frame, this.status, this.caption);
    figureViews.set(this.dom, this);

    // A click on a placeholder asks for the live figure.
    this.frame.addEventListener('click', () => {
      if (this.state === 'placeholder') this.options.scheduler.activate(this);
    });
    this.renderPlaceholder();
    this.options.scheduler.register(this);
  }

  private get attrs(): FigureAttributes {
    return this.node.attrs as FigureAttributes;
  }

  get isLive(): boolean {
    return this.state === 'mounting' || this.state === 'live';
  }

  get holdsInstance(): boolean {
    return this.isLive || this.state === 'suspending';
  }

  get canRun(): boolean {
    return this.state !== 'failed' && this.state !== 'destroyed' && (this.attrs.fragments !== null || this.attrs.fragmentsRef !== null);
  }

  // -------------------------------------------------------------------------
  // ProseMirror node view contract
  // -------------------------------------------------------------------------

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    const before = this.attrs;
    this.node = node;
    const after = this.attrs;
    const sourceChanged =
      JSON.stringify(before.fragments) !== JSON.stringify(after.fragments) || before.fragmentsRef !== after.fragmentsRef;
    if (sourceChanged && (this.isLive || this.state === 'failed')) {
      // New fragments (a regenerated figure, or undo of one): rebuild from the stored state. A failed figure gets a new chance.
      this.teardown();
      this.state = 'placeholder';
      this.failure = null;
      this.renderPlaceholder();
      this.options.scheduler.evaluate();
    } else if (!this.holdsInstance) {
      this.renderPlaceholder();
    } else {
      this.renderCaption();
    }
    return true;
  }

  /** Events inside the live figure belong to it; the shell and caption stay with the editor. */
  stopEvent(event: Event): boolean {
    const target = event.target as Node | null;
    return this.isLive && !!target && this.frame.contains(target);
  }

  /** The DOM here is the view's own. Selection changes still go to the editor. */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type !== 'selection';
  }

  selectNode(): void {
    this.dom.classList.add('is-selected');
  }

  deselectNode(): void {
    this.dom.classList.remove('is-selected');
  }

  destroy(): void {
    if (this.state === 'destroyed') return;
    this.flush();
    this.options.scheduler.unregister(this);
    this.teardown();
    this.state = 'destroyed';
    this.dom.dataset.state = 'destroyed';
  }

  // -------------------------------------------------------------------------
  // Scheduler contract
  // -------------------------------------------------------------------------

  mount(): void {
    if (this.isLive || this.state === 'destroyed' || this.state === 'failed') return;
    this.state = 'mounting';
    this.dom.dataset.state = 'mounting';
    this.mountedAt = performance.now();
    const generation = ++this.generation;
    void this.fragments().then((fragments) => {
      // The node may have been suspended, destroyed or remounted while the fragments loaded.
      if (generation !== this.generation || this.state !== 'mounting') return;
      if (!fragments) {
        this.fail({ phase: 'mount', message: 'The figure source is not available' });
        return;
      }
      this.start(fragments);
    });
  }

  pause(): void {
    this.handle?.pause();
  }

  resume(): void {
    this.handle?.resume();
  }

  async suspend(): Promise<void> {
    if (!this.isLive) return;
    const handle = this.handle;
    this.state = 'suspending';
    this.dom.dataset.state = 'suspending';
    this.generation++;
    // Keep the reserved size, so the placeholder takes exactly the live figure's place.
    const size = handle?.measure() ?? null;
    let snapshotRef: string | null = null;
    if (handle && handle.state === 'live' && this.options.store) {
      const png = await handle.snapshot();
      if (png) {
        try {
          snapshotRef = await this.options.store.putSnapshot(png);
          this.snapshotUrl = png;
        } catch {
          snapshotRef = null;
        }
      }
    }
    if (this.state !== 'suspending') return;
    if (snapshotRef) this.pending.snapshot = snapshotRef;
    if (size) this.pending.aspect = Math.round((size.height / size.width) * 1000) / 1000;
    this.teardown();
    this.state = 'placeholder';
    this.flush();
    this.renderPlaceholder();
  }

  // -------------------------------------------------------------------------
  // Keyboard entry and exit
  // -------------------------------------------------------------------------

  /** Moves keyboard focus into the figure, starting it first if needed. */
  enter(edge: 'first' | 'last' = 'first'): void {
    if (this.state === 'live' && this.handle) {
      this.handle.focus(edge);
      return;
    }
    this.focusOnLive = edge;
    this.options.scheduler.activate(this);
  }

  private onEscape(direction: 'out' | 'forward' | 'backward'): void {
    const pos = this.getPos();
    if (typeof pos !== 'number' || this.editor.isDestroyed) return;
    const { state } = this.editor.view;
    const selection =
      direction === 'out'
        ? NodeSelection.create(state.doc, pos)
        : TextSelection.near(state.doc.resolve(direction === 'forward' ? pos + this.node.nodeSize : pos), direction === 'forward' ? 1 : -1);
    this.editor.view.dispatch(state.tr.setSelection(selection).setMeta(FIGURE_TRANSACTION, 'focus'));
    this.editor.view.focus();
  }

  // -------------------------------------------------------------------------
  // Live instance
  // -------------------------------------------------------------------------

  private async fragments(): Promise<FigureFragments | null> {
    const attrs = this.attrs;
    if (attrs.fragments) return attrs.fragments;
    if (attrs.fragmentsRef && this.options.store) return (await this.options.store.getFragments(attrs.fragmentsRef)) ?? null;
    return null;
  }

  private start(fragments: FigureFragments): void {
    const doc = this.dom.ownerDocument;
    const container = doc.createElement('div');
    // Invisible over the placeholder until the figure has drawn, so nothing jumps while it boots.
    container.className = 'incantly-figure__live is-booting';
    this.frame.append(container);
    const attrs = this.attrs;
    const scheduler = this.options.scheduler;
    // Values the learner changed since the last save win over the stored ones.
    const values = { ...attrs.values, ...this.pending.values };
    const step = this.pending.step !== undefined ? this.pending.step : attrs.step;
    // The latest problem this instance reported; adapters report it before they change state.
    let reported: ErrorView | null = null;
    this.handle = this.options.adapter.mount(container, fragments, {
      values,
      step,
      theme: this.options.theme,
      title: attrs.concept ? `Interactive figure: ${attrs.concept}` : 'Interactive figure',
      onValues: (changed) => {
        scheduler.touch(this);
        this.pending.values = { ...this.pending.values, ...changed };
        this.settle();
      },
      onStep: (position) => {
        scheduler.touch(this);
        this.pending.step = position;
        this.settle();
      },
      onDescription: (text) => {
        this.pending.description = text;
        this.settle();
      },
      onEscape: (direction) => this.onEscape(direction),
      onError: (error) => {
        // A figure that keeps hitting the same problem, say while a slider crosses a singular point, reports it once.
        if (reported && sameError(reported, error)) return;
        reported = error;
        // Adapters report a problem just before they fail on it, so by the next microtask it is known whether it was fatal.
        queueMicrotask(() => this.report(error, this.state === 'failed'));
      },
      onState: (state) => {
        if (state === 'failed' && this.state === 'live') this.fail(reported ?? { phase: 'mount', message: 'The figure stopped working' }, reported);
      },
    });
    const handle = this.handle;
    if (handle.state === 'failed' || this.state !== 'mounting') {
      // The adapter refused the scene (for example, it failed validation) before returning.
      handle.destroy();
      container.remove();
      if (this.state === 'mounting') this.fail(reported ?? { phase: 'mount', message: 'The figure did not pass validation' }, reported);
      return;
    }
    this.state = 'live';
    this.dom.dataset.state = 'live';
    this.status.hidden = true;
    const generation = this.generation;
    void handle.ready.then((state) => {
      if (state !== 'live' || this.state !== 'live' || generation !== this.generation) return;
      this.options.scheduler.recordReady(performance.now() - this.mountedAt);
      container.classList.remove('is-booting');
      for (const child of [...this.frame.children]) if (child !== container) child.remove();
      this.frame.classList.add('is-live');
      this.frame.style.aspectRatio = '';
      if (this.focusOnLive !== null) {
        const edge = this.focusOnLive;
        this.focusOnLive = null;
        handle.focus(edge);
      }
    });
  }

  /**
   * Gives up on the figure: it stays a placeholder with its description until
   * its source is replaced. `reported` is the same problem when the adapter
   * reported it, which is then passed on to the host already, so the host
   * hears about each problem once.
   */
  private fail(error: ErrorView, reported: ErrorView | null = null): void {
    if (this.state === 'destroyed' || this.state === 'failed') return;
    if (reported === error) this.failure = error;
    else this.report(error, true);
    this.teardown();
    this.state = 'failed';
    this.renderPlaceholder();
    this.options.scheduler.evaluate();
  }

  /** Records a problem and tells the host, with the learner state it happened in. */
  private report(error: ErrorView, fatal: boolean): void {
    this.failure = error;
    const onError = this.options.onError;
    if (!onError) return;
    const attrs = this.attrs;
    const report: FigureErrorReport = {
      figureId: attrs.figureId,
      ...(attrs.meta.generationId ? { generationId: attrs.meta.generationId } : {}),
      error,
      fatal,
      values: { ...attrs.values, ...this.pending.values },
      step: this.pending.step !== undefined ? this.pending.step : attrs.step,
    };
    try {
      onError(report);
    } catch {
      // A host's reporting must never break the note.
    }
  }

  /** Ends the live instance, if any. */
  private teardown(): void {
    this.generation++;
    this.handle?.destroy();
    this.handle = null;
    this.frame.classList.remove('is-live');
    this.frame.querySelector('.incantly-figure__live')?.remove();
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private settle(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.flush();
    }, this.options.settleMs);
  }

  /** Saves pending learner state to the node in one transaction, outside the undo history. */
  flush(): void {
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    const pending = this.pending;
    this.pending = {};
    if (this.editor.isDestroyed) return;
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    const view = this.editor.view;
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== this.node.type) return;
    const attrs = node.attrs as FigureAttributes;
    const changes: Array<[keyof FigureAttributes, unknown]> = [];
    if (pending.values) {
      const values = { ...attrs.values, ...pending.values };
      if (JSON.stringify(values) !== JSON.stringify(attrs.values)) changes.push(['values', values]);
    }
    if (pending.step !== undefined && pending.step !== attrs.step) changes.push(['step', pending.step]);
    if (pending.description !== undefined && pending.description !== attrs.description) changes.push(['description', pending.description]);
    if (pending.snapshot !== undefined && pending.snapshot !== attrs.snapshotRef) changes.push(['snapshotRef', pending.snapshot]);
    if (pending.aspect !== undefined && Math.abs(pending.aspect - attrs.aspect) > 0.005) changes.push(['aspect', pending.aspect]);
    if (changes.length === 0) return;
    let tr = view.state.tr;
    for (const [name, value] of changes) tr = tr.setNodeAttribute(pos, name, value);
    // Exploring a figure is not editing the note: it never enters the undo history.
    view.dispatch(tr.setMeta('addToHistory', false).setMeta(FIGURE_TRANSACTION, 'persist'));
  }

  // -------------------------------------------------------------------------
  // Placeholder
  // -------------------------------------------------------------------------

  private renderCaption(): void {
    const description = this.pending.description ?? this.attrs.description;
    if (this.caption.textContent !== description) this.caption.textContent = description;
    const label = `Interactive figure${this.attrs.concept ? `: ${this.attrs.concept}` : ''}. Press Enter to use it.`;
    if (this.dom.getAttribute('aria-label') !== label) this.dom.setAttribute('aria-label', label);
  }

  private renderPlaceholder(): void {
    const attrs = this.attrs;
    this.dom.dataset.state = this.state;
    this.dom.dataset.figureId = attrs.figureId;
    this.renderCaption();
    const aspect = attrs.aspect > 0 ? attrs.aspect : DEFAULT_ASPECT;
    this.frame.style.aspectRatio = `1 / ${aspect}`;
    if (this.isLive) return;
    const doc = this.dom.ownerDocument;
    const ref = attrs.snapshotRef;
    const image = doc.createElement('img');
    image.className = 'incantly-figure__snapshot';
    image.alt = '';
    const skeleton = doc.createElement('div');
    skeleton.className = 'incantly-figure__skeleton';
    if (this.snapshotUrl && ref) image.src = this.snapshotUrl;
    this.frame.replaceChildren(this.snapshotUrl && ref ? image : skeleton);
    if (ref && this.options.store && !this.snapshotUrl) {
      const generation = this.generation;
      void this.options.store.getSnapshot(ref).then((url) => {
        if (!url || generation !== this.generation || this.isLive || this.attrs.snapshotRef !== ref) return;
        this.snapshotUrl = url;
        image.src = url;
        this.frame.replaceChildren(image);
      });
    }
    this.status.hidden = this.state !== 'failed';
    this.status.textContent = this.state === 'failed' ? 'This figure could not be shown. Its description is below.' : '';
  }

  /** The last problem the figure ran into, fatal or not. */
  get lastError(): ErrorView | null {
    return this.failure;
  }
}

function sameError(a: ErrorView, b: ErrorView): boolean {
  return a.phase === b.phase && a.message === b.message && a.line === b.line && a.column === b.column;
}
