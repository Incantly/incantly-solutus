import { VALIDATOR_VERSION, mergeStyles, type ErrorView, type ExecutionAdapter, type FigureHandle, type FigureStyle } from '@incantly/core';
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
  readonly signals?: ((signal: FigureSignal) => void) | null | undefined;
  /** The editor's style for every figure; each figure's `look` goes over it. */
  readonly style?: FigureStyle | null | undefined;
  /** Repairs a figure that hit a problem while live (RP-7). */
  readonly repair?: FigureRepair | null | undefined;
}

/** What a background repair is given: the figure as stored, its ticket, and the problem with the learner's state. */
export interface FigureRepairRequest {
  readonly figureId: string;
  readonly generationId?: string;
  readonly fragments: FigureFragments;
  readonly ticket: string;
  readonly error: ErrorView;
  readonly values: Readonly<Record<string, number>>;
  readonly step: number | null;
}

/** A repaired scene that passed its probe on this device, to swap in at the learner's values. */
export interface RepairedFigure {
  readonly fragments: FigureFragments;
  readonly generationId: string | null;
  readonly approvedAt: string;
  readonly ticket: string | null;
}

/** Repairs a figure in the background; null when it could not be repaired. */
export type FigureRepair = (request: FigureRepairRequest, signal: AbortSignal) => Promise<RepairedFigure | null>;

/**
 * What a figure in a note says about how it is used, for the host's product
 * signals: ids, parameter names and numbers only, never note content.
 */
export type FigureSignal =
  | { readonly type: 'figure-shown'; readonly figureId: string; readonly generationId?: string }
  /** From mounting to the first drawing, and to controls that respond. */
  | { readonly type: 'first-paint'; readonly figureId: string; readonly ms: number }
  | { readonly type: 'interactive'; readonly figureId: string; readonly ms: number }
  /** Once per figure and parameter while the note is open. */
  | { readonly type: 'parameter-changed'; readonly figureId: string; readonly parameter: string }
  | { readonly type: 'step-reached'; readonly figureId: string; readonly step: number; readonly count: number }
  | { readonly type: 'steps-completed'; readonly figureId: string; readonly count: number }
  /** The first time a shown figure goes away; abandoned when it was left within a minute without being used. */
  | { readonly type: 'figure-left'; readonly figureId: string; readonly visibleMs: number; readonly interacted: boolean; readonly abandoned: boolean }
  | { readonly type: 'restore-failure'; readonly figureId: string; readonly reason: 'source-missing' | 'invalid' };

/** A figure left within this long without being used counts as abandoned. */
export const ABANDON_MS = 60_000;

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
  formulas?: Record<string, string>;
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
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private notice: string | null = null;
  /** The figure's number in the note, when the editor numbers figures. */
  private number: number | null = null;
  /** A background repair (RP-7): none, running, or one that did not work, which offers the working version. */
  private mending: 'idle' | 'repairing' | 'failed' = 'idle';
  private mendAbort: AbortController | null = null;
  /** Repairs swapped in while the note is open: one at most. */
  private mended = 0;
  /** How the learner used the figure while the note is open, for product signals. */
  private readonly usage = {
    shownAt: null as number | null,
    visibleSince: null as number | null,
    visibleMs: 0,
    interacted: false,
    parameters: new Set<string>(),
    completed: false,
    left: false,
  };

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
    // Focus moving into the live figure is using it.
    this.frame.addEventListener('focusin', () => {
      if (this.state === 'live') this.usage.interacted = true;
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
      // A new look restyles the live figure in place.
      if (JSON.stringify(before.look) !== JSON.stringify(after.look)) this.handle?.setStyle(this.style());
    }
    return true;
  }

  /** The editor's style with this figure's own look over it. */
  private style(): FigureStyle | undefined {
    return mergeStyles(this.options.style ?? undefined, this.attrs.look ?? undefined);
  }

  /** Sets the figure's number in the note; the editor renumbers as figures come and go. */
  setNumber(figureNumber: number | null): void {
    if (figureNumber === this.number) return;
    this.number = figureNumber;
    if (figureNumber === null) delete this.dom.dataset.number;
    else this.dom.dataset.number = String(figureNumber);
    this.handle?.setNumber(figureNumber);
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
    this.mendAbort?.abort();
    this.left();
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
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
        this.signal({ type: 'restore-failure', figureId: this.attrs.figureId, reason: 'source-missing' });
        this.fail({ phase: 'mount', message: 'The figure source is not available' });
        return;
      }
      this.start(fragments);
    });
  }

  pause(): void {
    this.handle?.pause();
    this.hidden();
  }

  resume(): void {
    this.handle?.resume();
    if (this.usage.shownAt !== null && this.usage.visibleSince === null) this.usage.visibleSince = performance.now();
  }

  async suspend(): Promise<void> {
    if (!this.isLive) return;
    this.left();
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
    const formulas = { ...attrs.formulas, ...this.pending.formulas };
    const step = this.pending.step !== undefined ? this.pending.step : attrs.step;
    const style = this.style();
    // The latest problem this instance reported; adapters report it before they change state.
    let reported: ErrorView | null = null;
    this.handle = this.options.adapter.mount(container, fragments, {
      values,
      step,
      ...(Object.keys(formulas).length > 0 ? { formulas } : {}),
      ...(style ? { style } : {}),
      ...(this.number !== null ? { figureNumber: this.number } : {}),
      theme: this.options.theme,
      title: attrs.concept ? `Interactive figure: ${attrs.concept}` : 'Interactive figure',
      onValues: (changed) => {
        scheduler.touch(this);
        this.pending.values = { ...this.pending.values, ...changed };
        this.settle();
        this.used();
        for (const parameter of Object.keys(changed)) {
          if (this.usage.parameters.has(parameter)) continue;
          this.usage.parameters.add(parameter);
          this.signal({ type: 'parameter-changed', figureId: this.attrs.figureId, parameter });
        }
      },
      onStep: (position, count) => {
        scheduler.touch(this);
        this.pending.step = position;
        this.settle();
        this.used();
        if (position === null || !count) return;
        this.signal({ type: 'step-reached', figureId: this.attrs.figureId, step: position, count });
        if (position === count - 1 && !this.usage.completed) {
          this.usage.completed = true;
          this.signal({ type: 'steps-completed', figureId: this.attrs.figureId, count });
        }
      },
      onFormulas: (changed) => {
        scheduler.touch(this);
        this.pending.formulas = { ...this.pending.formulas, ...changed };
        this.settle();
        this.used();
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
        queueMicrotask(() => {
          const fatal = this.state === 'failed';
          this.report(error, fatal);
          if (!fatal) void this.mend(error);
        });
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
      if (this.state === 'mounting') {
        this.signal({ type: 'restore-failure', figureId: this.attrs.figureId, reason: 'invalid' });
        this.fail(reported ?? { phase: 'mount', message: 'The figure did not pass validation' }, reported);
      }
      return;
    }
    this.state = 'live';
    this.dom.dataset.state = 'live';
    this.renderStatus();
    const generation = this.generation;
    void handle.ready.then((state) => {
      if (state !== 'live' || this.state !== 'live' || generation !== this.generation) return;
      const now = performance.now();
      this.options.scheduler.recordReady(now - this.mountedAt);
      this.shown(now);
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
    this.left();
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

  /**
   * The live figure hit a problem and froze at its last good frame (RP-7).
   * With a repairer and the figure's ticket, a quiet line says it is being
   * fixed while the repair runs; a repair that passed on this device is
   * swapped in at the learner's values. Otherwise, or when the repair does
   * not work, the line offers the working version.
   */
  private async mend(error: ErrorView): Promise<void> {
    if (this.mending !== 'idle' || this.state !== 'live') return;
    const attrs = this.attrs;
    const repair = this.options.repair;
    const ticket = attrs.meta.ticket;
    if (!repair || !ticket || this.mended > 0) {
      this.mending = 'failed';
      this.renderStatus();
      return;
    }
    const fragments = await this.fragments();
    if (!fragments || this.state !== 'live') return;
    this.mending = 'repairing';
    this.renderStatus();
    const abort = new AbortController();
    this.mendAbort = abort;
    const values = { ...attrs.values, ...this.pending.values };
    const step = this.pending.step !== undefined ? this.pending.step : attrs.step;
    let repaired: RepairedFigure | null;
    try {
      repaired = await repair(
        { figureId: attrs.figureId, ...(attrs.meta.generationId ? { generationId: attrs.meta.generationId } : {}), fragments, ticket, error, values, step },
        abort.signal,
      );
    } catch {
      repaired = null;
    }
    this.mendAbort = null;
    // The figure may have been suspended or deleted while the repair ran.
    if (abort.signal.aborted || (this.state as FigureViewState) === 'destroyed') return;
    if (!repaired) {
      this.mending = 'failed';
      this.renderStatus();
      return;
    }
    this.mended++;
    this.mending = 'idle';
    this.swapIn(repaired);
  }

  /** Puts a repaired scene in the note, out of the undo history; the figure remounts at the learner's values. */
  private swapIn(repaired: RepairedFigure): void {
    // The learner's latest values go into the node first, so the new scene starts from them.
    this.flush();
    if (this.editor.isDestroyed) return;
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    const view = this.editor.view;
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type !== this.node.type) return;
    const meta = {
      ...(node.attrs as FigureAttributes).meta,
      ...(repaired.generationId ? { generationId: repaired.generationId } : {}),
      approvedAt: repaired.approvedAt,
      validatorVersion: VALIDATOR_VERSION,
      ...(repaired.ticket ? { ticket: repaired.ticket } : {}),
    };
    const tr = view.state.tr.setNodeAttribute(pos, 'fragments', repaired.fragments).setNodeAttribute(pos, 'fragmentsRef', null).setNodeAttribute(pos, 'meta', meta);
    view.dispatch(tr.setMeta('addToHistory', false).setMeta(FIGURE_TRANSACTION, 'repaired'));
    this.renderStatus();
  }

  /** Goes back to the version that passed: the figure's own starting values, at no step, with its own formulas. */
  resetToWorking(): void {
    if (this.state === 'destroyed') return;
    this.mendAbort?.abort();
    this.mendAbort = null;
    this.mending = 'idle';
    this.pending = {};
    if (!this.editor.isDestroyed) {
      const pos = this.getPos();
      const node = typeof pos === 'number' ? this.editor.view.state.doc.nodeAt(pos) : null;
      if (typeof pos === 'number' && node && node.type === this.node.type) {
        const attrs = node.attrs as FigureAttributes;
        const tr = this.editor.view.state.tr.setNodeAttribute(pos, 'values', { ...attrs.defaults }).setNodeAttribute(pos, 'step', null).setNodeAttribute(pos, 'formulas', {});
        this.editor.view.dispatch(tr.setMeta('addToHistory', false).setMeta(FIGURE_TRANSACTION, 'persist'));
      }
    }
    this.teardown();
    this.state = 'placeholder';
    this.failure = null;
    this.renderPlaceholder();
    this.options.scheduler.activate(this);
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
    if (pending.formulas) {
      const formulas = { ...attrs.formulas, ...pending.formulas };
      if (JSON.stringify(formulas) !== JSON.stringify(attrs.formulas)) changes.push(['formulas', formulas]);
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
    this.renderStatus();
  }

  // -------------------------------------------------------------------------
  // Product signals and notices
  // -------------------------------------------------------------------------

  private signal(signal: FigureSignal): void {
    try {
      this.options.signals?.(signal);
    } catch {
      // A host's signals must never break the note.
    }
  }

  private shown(now: number): void {
    const figureId = this.attrs.figureId;
    const ms = Math.round(now - this.mountedAt);
    if (this.usage.shownAt === null) {
      this.usage.shownAt = now;
      const generationId = this.attrs.meta.generationId;
      this.signal({ type: 'figure-shown', figureId, ...(generationId ? { generationId } : {}) });
    }
    this.usage.visibleSince ??= now;
    this.signal({ type: 'first-paint', figureId, ms });
    this.signal({ type: 'interactive', figureId, ms });
  }

  private used(): void {
    this.usage.interacted = true;
    this.clearNotice();
  }

  private hidden(): void {
    if (this.usage.visibleSince === null) return;
    this.usage.visibleMs += performance.now() - this.usage.visibleSince;
    this.usage.visibleSince = null;
  }

  /** The first time a shown figure goes away: suspended, failed, deleted or the note closed. */
  private left(): void {
    if (this.usage.shownAt === null || this.usage.left) return;
    this.hidden();
    this.usage.left = true;
    const visibleMs = Math.round(this.usage.visibleMs);
    this.signal({
      type: 'figure-left',
      figureId: this.attrs.figureId,
      visibleMs,
      interacted: this.usage.interacted,
      abandoned: !this.usage.interacted && visibleMs < ABANDON_MS,
    });
  }

  /** Shows one quiet line under the figure for a while, such as that it is a standard version. */
  notify(message: string, ms = 10_000): void {
    if (this.noticeTimer !== null) clearTimeout(this.noticeTimer);
    this.notice = message;
    this.noticeTimer = setTimeout(() => this.clearNotice(), ms);
    this.renderStatus();
  }

  private clearNotice(): void {
    if (this.noticeTimer === null) return;
    clearTimeout(this.noticeTimer);
    this.noticeTimer = null;
    this.notice = null;
    this.renderStatus();
  }

  /** The line under the figure: why it failed, that it is being fixed, the way back to the working version, or a passing notice. */
  private renderStatus(): void {
    if (this.state !== 'failed' && this.mending === 'failed') {
      if (!this.status.querySelector('button')) {
        const doc = this.status.ownerDocument;
        const reset = doc.createElement('button');
        reset.type = 'button';
        reset.className = 'incantly-figure__reset';
        reset.textContent = 'Reset to the working version';
        reset.addEventListener('click', () => this.resetToWorking());
        this.status.replaceChildren(doc.createTextNode('This figure hit a problem. '), reset);
      }
      this.status.hidden = false;
      return;
    }
    const text =
      this.state === 'failed'
        ? 'This figure could not be shown. Its description is below.'
        : this.mending === 'repairing'
          ? 'This figure hit a problem and is being fixed.'
          : (this.notice ?? '');
    if (this.status.textContent !== text || this.status.querySelector('button')) this.status.textContent = text;
    this.status.hidden = text === '';
  }

  /** The last problem the figure ran into, fatal or not. */
  get lastError(): ErrorView | null {
    return this.failure;
  }
}

function sameError(a: ErrorView, b: ErrorView): boolean {
  return a.phase === b.phase && a.message === b.message && a.line === b.line && a.column === b.column;
}
