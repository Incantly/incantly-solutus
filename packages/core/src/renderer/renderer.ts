import { animationFrameClock, type FrameClock } from '../engine/clock';
import type { RuntimeChannel } from '../engine/channel';
import type { RuntimeUpdate } from '../protocol/runtime-messages';
import type { ErrorView, UiState } from '../protocol/ui';
import { EMPTY_UI } from '../protocol/ui';
import { ControlsView, ReadoutsView } from './controls';
import { SceneDom } from './dom-scene';
import { TeachingView } from './teaching';

export interface RendererOptions {
  /** Figure root. Must contain an element with class `inc-scene` holding the scene HTML. */
  readonly root: HTMLElement;
  readonly channel: RuntimeChannel;
  /** Prefix for every generated id, unique per figure. */
  readonly scope: string;
  readonly clock?: FrameClock;
  /**
   * `observe`: the renderer pauses the figure itself when it leaves the viewport
   * or the tab is hidden. `external`: the host decides (the TipTap node view).
   */
  readonly visibility?: 'observe' | 'external';
  readonly onValues?: (values: Readonly<Record<string, number>>) => void;
  /** The teaching position, and how many steps the figure has. */
  readonly onStep?: (step: number | null, count?: number) => void;
  readonly onError?: (error: ErrorView) => void;
  readonly onUpdate?: (update: RuntimeUpdate, ui: UiState) => void;
}

/** How long after a learner's last change the new readouts are announced. */
export const SETTLE_ANNOUNCE_MS = 750;

export interface RendererStats {
  /** Animation frames requested. */
  frameRequests: number;
  /** Times the loop went from idle to running. */
  loopStarts: number;
  ticksSent: number;
  updates: number;
  /** Milliseconds from sending a tick until its update was applied, summed. */
  workMs: number;
  /** Ticks whose round trip was measured. */
  workFrames: number;
}

/**
 * Turns runtime updates into DOM and owns the figure's only animation loop.
 * Event handlers send messages and never draw; the next frame draws once.
 */
export class FigureRenderer {
  readonly root: HTMLElement;
  readonly scene: SceneDom;
  readonly stats: RendererStats = { frameRequests: 0, loopStarts: 0, ticksSent: 0, updates: 0, workMs: 0, workFrames: 0 };
  ui: UiState = EMPTY_UI;

  private readonly clock: FrameClock;
  private readonly controller = new AbortController();
  private readonly controls: ControlsView;
  private readonly readouts: ReadoutsView;
  private readonly teaching: TeachingView;
  private readonly idea: HTMLElement;
  private readonly errorBanner: HTMLElement;
  private readonly announcer: HTMLElement;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  private announceBaseline = '';
  private readonly unsubscribe: () => void;
  private observer: IntersectionObserver | null = null;
  private frameHandle: number | null = null;
  private lastTime: number | null = null;
  private running = false;
  private awaiting = false;
  private tickStart: number | null = null;
  private destroyed = false;
  private onScreen = true;

  constructor(private readonly options: RendererOptions) {
    this.root = options.root;
    this.clock = options.clock ?? animationFrameClock;
    const doc = this.root.ownerDocument;
    const signal = this.controller.signal;
    this.root.classList.add('inc-figure');

    const sceneRoot = this.root.querySelector<HTMLElement>('.inc-scene');
    if (!sceneRoot) throw new Error('The figure root needs an .inc-scene element');
    this.scene = new SceneDom(sceneRoot, options.scope);

    this.idea = doc.createElement('p');
    this.idea.className = 'inc-idea';
    this.idea.hidden = true;
    this.errorBanner = doc.createElement('div');
    this.errorBanner.className = 'inc-error';
    this.errorBanner.setAttribute('role', 'alert');
    this.errorBanner.hidden = true;
    this.announcer = doc.createElement('p');
    this.announcer.className = 'inc-visually-hidden';
    this.announcer.setAttribute('aria-live', 'polite');
    this.announcer.setAttribute('aria-atomic', 'true');
    this.readouts = new ReadoutsView(doc);
    const send = this.send;
    this.controls = new ControlsView(doc, options.scope, send, signal);
    this.teaching = new TeachingView({
      doc,
      scope: options.scope,
      send,
      signal,
      scene: this.scene,
      figureRoot: this.root,
      sceneRoot,
    });

    sceneRoot.before(this.idea);
    sceneRoot.after(
      this.errorBanner,
      this.teaching.partInfoElement,
      this.readouts.element,
      this.teaching.element,
      this.controls.element,
      this.teaching.descriptionElement,
      this.announcer,
    );

    this.unsubscribe = options.channel.onUpdate((update) => this.apply(update));

    if ((options.visibility ?? 'observe') === 'observe') this.observeVisibility(doc, signal);
    this.observeReducedMotion(doc, signal);
  }

  /** Sends a message to the runtime. Never draws. */
  readonly send = (message: Parameters<RuntimeChannel['send']>[0]): void => {
    if (this.destroyed) return;
    if (message.type === 'setParam' || message.type === 'setValues' || message.type === 'reset') this.armAnnouncement();
    this.options.channel.send(message);
  };

  /** Waits for the learner to stop changing values, then says what the readouts now show. */
  private armAnnouncement(): void {
    if (this.announceTimer === null) this.announceBaseline = this.summary();
    else clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => {
      this.announceTimer = null;
      if (this.destroyed) return;
      const text = this.summary();
      if (text === '' || text === this.announceBaseline) return;
      this.announcer.textContent = text;
    }, SETTLE_ANNOUNCE_MS);
  }

  /** Readouts in one sentence, or the explanation when the figure has no readouts. */
  private summary(): string {
    const readouts = this.ui.readouts.map((r) => `${r.label} ${r.text}`).join('. ');
    return readouts ? `${readouts}.` : (this.ui.explanation ?? '');
  }

  apply(update: RuntimeUpdate): void {
    if (this.destroyed) return;
    this.awaiting = false;
    this.stats.updates++;
    const tickStart = this.tickStart;
    this.tickStart = null;
    if (update.reset) this.scene.clear();
    this.scene.apply(update.commands);
    const ui = update.ui;
    this.ui = { ...this.ui, ...ui };
    if (ui.idea !== undefined) {
      this.idea.textContent = ui.idea ?? '';
      this.idea.hidden = !ui.idea;
    }
    if (ui.params !== undefined) this.controls.setParams(ui.params);
    if (ui.playing !== undefined) this.controls.setPlaying(ui.playing);
    if (ui.animated !== undefined) this.controls.setAnimated(ui.animated);
    if (ui.speed !== undefined) this.controls.setSpeed(ui.speed);
    if (ui.readouts !== undefined) this.readouts.update(ui.readouts);
    this.teaching.update(ui, this.ui, update.reset === true);
    if (ui.error !== undefined) {
      this.errorBanner.hidden = ui.error === null;
      this.errorBanner.textContent = ui.error ? 'This figure hit a problem and paused. Try changing a value or Restart.' : '';
      if (ui.error) this.options.onError?.(ui.error);
    }
    if (update.values) this.options.onValues?.(update.values);
    if (update.step !== undefined) this.options.onStep?.(update.step, this.ui.steps?.count);
    this.options.onUpdate?.(update, this.ui);
    if (tickStart !== null) {
      this.stats.workMs += performance.now() - tickStart;
      this.stats.workFrames++;
    }

    if (update.needsFrame) this.schedule();
    else this.idle();
  }

  /** Visibility decided by the host (TipTap node view, sandbox adapter). */
  setVisible(visible: boolean): void {
    this.send({ type: 'visible', value: visible });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.options.channel.send({ type: 'destroy' });
    this.destroyed = true;
    this.controller.abort();
    if (this.announceTimer !== null) clearTimeout(this.announceTimer);
    this.announceTimer = null;
    this.observer?.disconnect();
    this.observer = null;
    if (this.frameHandle !== null) this.clock.cancel(this.frameHandle);
    this.frameHandle = null;
    this.unsubscribe();
  }

  get isRunning(): boolean {
    return this.frameHandle !== null;
  }

  private schedule(): void {
    if (this.destroyed || this.frameHandle !== null) return;
    if (!this.running) {
      this.running = true;
      this.stats.loopStarts++;
    }
    this.stats.frameRequests++;
    this.frameHandle = this.clock.request(this.loop);
  }

  private idle(): void {
    this.running = false;
    this.lastTime = null;
  }

  private readonly loop = (now: number): void => {
    this.frameHandle = null;
    if (this.destroyed) return;
    const dt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (this.awaiting) {
      // The previous tick has not been answered yet (a Worker is busy): try next frame.
      this.schedule();
      return;
    }
    this.awaiting = true;
    this.stats.ticksSent++;
    this.tickStart = performance.now();
    this.send({ type: 'tick', dt });
  };

  /** The starting preference is passed at mount; this follows changes while the figure is open. */
  private observeReducedMotion(doc: Document, signal: AbortSignal): void {
    const query = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query || typeof query.addEventListener !== 'function') return;
    query.addEventListener('change', (event) => this.send({ type: 'reducedMotion', value: event.matches }), { signal });
  }

  private observeVisibility(doc: Document, signal: AbortSignal): void {
    const view = doc.defaultView;
    if (view && 'IntersectionObserver' in view) {
      this.observer = new view.IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        this.onScreen = entry.isIntersecting;
        this.send({ type: 'visible', value: this.onScreen && doc.visibilityState !== 'hidden' });
      });
      this.observer.observe(this.root);
    }
    doc.addEventListener(
      'visibilitychange',
      () => this.send({ type: 'visible', value: this.onScreen && doc.visibilityState !== 'hidden' }),
      { signal },
    );
  }
}
