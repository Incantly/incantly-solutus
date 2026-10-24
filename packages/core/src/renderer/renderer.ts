import { animationFrameClock, type FrameClock } from '../engine/clock';
import type { RuntimeChannel } from '../engine/channel';
import type { RuntimeUpdate } from '../protocol/runtime-messages';
import type { ErrorView, UiState } from '../protocol/ui';
import { EMPTY_UI } from '../protocol/ui';
import { ControlsView, ReadoutsView } from './controls';
import { SceneDom } from './dom-scene';
import { FormulasPanel, HeaderView, LegendPanel, PredictPanel, TablesPanel } from './panels';
import { PointerController } from './pointer';
import { isSoundCommand, SoundPlayer, type AudioContextFactory } from './sound';
import { applySlotClasses, applyStyle, clearStyle, resolveStyle, type FigureStyle, type ResolvedStyle } from './style';
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
  /** How the integrator styles the figure. */
  readonly style?: FigureStyle;
  /** The figure's number in its document, for the card's title. */
  readonly figureNumber?: number;
  readonly onValues?: (values: Readonly<Record<string, number>>) => void;
  readonly onFormulas?: (formulas: Readonly<Record<string, string>>) => void;
  /** The teaching position, and how many steps the figure has. */
  readonly onStep?: (step: number | null, count?: number) => void;
  readonly onError?: (error: ErrorView) => void;
  readonly onUpdate?: (update: RuntimeUpdate, ui: UiState) => void;
  /** Makes the page's audio context; tests pass a stand-in. */
  readonly audio?: AudioContextFactory;
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

/** UI sections whose change rebuilds DOM, so integrator classes are applied again. */
const STRUCTURAL: ReadonlyArray<keyof UiState> = ['params', 'actions', 'legend', 'formulas', 'tables', 'predict', 'steps', 'readouts'];

/**
 * Turns runtime updates into DOM and owns the figure's only animation loop.
 * Event handlers send messages and never draw; the next frame draws once.
 */
export class FigureRenderer {
  readonly root: HTMLElement;
  readonly scene: SceneDom;
  readonly pointer: PointerController;
  readonly sound: SoundPlayer;
  /** The style now applied, checked. */
  style: ResolvedStyle;
  readonly stats: RendererStats = { frameRequests: 0, loopStarts: 0, ticksSent: 0, updates: 0, workMs: 0, workFrames: 0 };
  ui: UiState = EMPTY_UI;

  private readonly clock: FrameClock;
  private readonly controller = new AbortController();
  private readonly controls: ControlsView;
  private readonly readouts: ReadoutsView;
  private readonly teaching: TeachingView;
  private readonly header: HeaderView;
  private readonly legend: LegendPanel;
  private readonly formulas: FormulasPanel;
  private readonly predict: PredictPanel;
  private readonly tables: TablesPanel;
  private readonly idea: HTMLElement;
  private readonly errorBanner: HTMLElement;
  private readonly announcer: HTMLElement;
  private announceTimer: ReturnType<typeof setTimeout> | null = null;
  private announceBaseline = '';
  private readonly unsubscribe: () => void;
  private observer: IntersectionObserver | null = null;
  private resizer: ResizeObserver | null = null;
  private frameHandle: number | null = null;
  private lastTime: number | null = null;
  private running = false;
  private awaiting = false;
  private tickStart: number | null = null;
  private destroyed = false;
  private onScreen = true;
  /** In sight, as the renderer or its host last said. */
  private visible = true;
  /** Time held back by a frame-rate cap, in seconds. */
  private capped = 0;

  constructor(private readonly options: RendererOptions) {
    this.root = options.root;
    this.clock = options.clock ?? animationFrameClock;
    this.style = resolveStyle(options.style);
    const doc = this.root.ownerDocument;
    const signal = this.controller.signal;
    this.root.classList.add('inc-figure');

    const sceneRoot = this.root.querySelector<HTMLElement>('.inc-scene');
    if (!sceneRoot) throw new Error('The figure root needs an .inc-scene element');
    this.scene = new SceneDom(sceneRoot, options.scope);

    this.header = new HeaderView(doc);
    this.header.setNumber(options.figureNumber ?? null);
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
    const show = this.style.show;
    this.controls = new ControlsView(doc, options.scope, send, signal, {
      transport: show.transport,
      speed: show.speed,
      settings: show.settings,
      undo: show.undo,
      fullscreen: show.fullscreen,
    });
    this.controls.onFullscreen = () => this.toggleFullscreen();
    this.sound = new SoundPlayer(options.audio);
    this.controls.onSound = (on) => {
      this.sound.setEnabled(on);
      this.controls.setSound(true, this.sound.isOn);
    };
    this.controls.onFrameCap = () => {
      this.capped = 0;
    };
    this.teaching = new TeachingView({
      doc,
      scope: options.scope,
      send,
      signal,
      scene: this.scene,
      figureRoot: this.root,
      sceneRoot,
    });
    this.legend = new LegendPanel(doc, send, signal, (part) => send({ type: 'focusPart', name: part }));
    this.formulas = new FormulasPanel(doc, options.scope, send, signal);
    this.predict = new PredictPanel(doc, send, signal);
    this.tables = new TablesPanel(doc);
    this.pointer = new PointerController({ doc, sceneRoot, scene: this.scene, send, signal, clock: this.clock, zoombar: show.zoom });
    this.scene.onStage = (stage) => this.pointer.stageChanged(stage);

    // The card: header and idea, then the drawing beside or above a panel of
    // everything the learner reads and changes (placed by the style's layout).
    const body = doc.createElement('div');
    body.className = 'inc-body';
    const panel = doc.createElement('div');
    panel.className = 'inc-panel';
    sceneRoot.before(this.header.element, this.idea, body);
    body.append(sceneRoot, panel);
    panel.append(
      this.errorBanner,
      this.teaching.partInfoElement,
      this.legend.element,
      this.readouts.element,
      this.tables.element,
      this.formulas.element,
      this.predict.element,
      this.teaching.element,
      this.controls.element,
    );
    body.after(this.teaching.descriptionElement, this.announcer);
    applyStyle(this.root, this.style);

    this.unsubscribe = options.channel.onUpdate((update) => this.apply(update));

    if ((options.visibility ?? 'observe') === 'observe') this.observeVisibility(doc, signal);
    this.observeReducedMotion(doc, signal);
    // The full-screen button says whether the figure fills the screen, however it got there or left (VI-6).
    doc.addEventListener('fullscreenchange', () => this.controls.setFullscreen(doc.fullscreenElement === this.root), { signal });
    this.observeSize();
  }

  /**
   * Restyles the figure in place, keeping the learner's values and position:
   * preset, tokens, slot classes, layout and which parts show.
   */
  setStyle(style: FigureStyle | undefined): void {
    if (this.destroyed) return;
    clearStyle(this.root, this.style);
    this.style = resolveStyle(style);
    applyStyle(this.root, this.style);
    const show = this.style.show;
    this.controls.setShow({ transport: show.transport, speed: show.speed, settings: show.settings, undo: show.undo, fullscreen: show.fullscreen });
  }

  /** The figure's number in its document, or null for none; documents renumber as figures come and go. */
  setNumber(figureNumber: number | null): void {
    if (!this.destroyed) this.header.setNumber(figureNumber);
  }

  /** Switches between the light and dark themes, or back to following the system. */
  setTheme(theme: 'light' | 'dark' | 'auto'): void {
    if (theme === 'light' || theme === 'dark') this.root.dataset.theme = theme;
    else delete this.root.dataset.theme;
  }

  /** Sends a message to the runtime. Never draws. */
  readonly send = (message: Parameters<RuntimeChannel['send']>[0]): void => {
    if (this.destroyed) return;
    if (message.type === 'setParam' || message.type === 'setValues' || message.type === 'reset' || message.type === 'drag' || message.type === 'action') {
      this.armAnnouncement();
    }
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
    if (update.reset) {
      this.scene.clear();
      this.pointer.reset();
      this.sound.clear();
    }
    const sounds = update.commands.filter(isSoundCommand);
    if (sounds.length > 0) {
      const had = this.sound.hasSound;
      this.sound.apply(sounds);
      if (!had && this.sound.hasSound) this.controls.setSound(true, this.sound.isOn);
      this.scene.apply(update.commands.filter((c) => !isSoundCommand(c)));
    } else {
      this.scene.apply(update.commands);
    }
    const ui = update.ui;
    this.ui = { ...this.ui, ...ui };
    if (ui.idea !== undefined) {
      this.idea.textContent = ui.idea ?? '';
      this.idea.hidden = !ui.idea;
    }
    if (ui.card !== undefined) this.header.update(ui.card);
    if (ui.params !== undefined) this.controls.setParams(ui.params);
    if (ui.playing !== undefined) this.controls.setPlaying(ui.playing);
    if (ui.animated !== undefined) this.controls.setAnimated(ui.animated);
    if (ui.playing !== undefined || ui.animated !== undefined) this.updateAudible();
    if (ui.speed !== undefined) this.controls.setSpeed(ui.speed);
    if (ui.actions !== undefined) this.controls.setActions(ui.actions);
    if (ui.history !== undefined) this.controls.setHistory(ui.history);
    if (ui.timing !== undefined) this.controls.setTiming(ui.timing);
    if (ui.compare !== undefined) this.controls.setCompare(ui.compare);
    if (ui.panels !== undefined) {
      const sceneRoot = this.root.querySelector<HTMLElement>('.inc-scene');
      if (sceneRoot && ui.panels) sceneRoot.dataset.panels = ui.panels;
      else if (sceneRoot) delete sceneRoot.dataset.panels;
    }
    if (ui.readouts !== undefined) this.readouts.update(ui.readouts);
    if (ui.legend !== undefined) this.legend.update(ui.legend);
    if (ui.formulas !== undefined) this.formulas.update(ui.formulas);
    if (ui.predict !== undefined) this.predict.update(ui.predict);
    if (ui.tables !== undefined) this.tables.update(ui.tables);
    if (ui.views !== undefined) this.pointer.setViews(ui.views);
    this.teaching.update(ui, this.ui, update.reset === true);
    if (ui.error !== undefined) {
      this.errorBanner.hidden = ui.error === null;
      this.errorBanner.textContent = ui.error ? 'This figure hit a problem and paused. Try changing a value or Restart.' : '';
      if (ui.error) this.options.onError?.(ui.error);
    }
    if (update.reset || update.commands.some((c) => c.op === 'stage') || STRUCTURAL.some((key) => ui[key] !== undefined)) {
      applySlotClasses(this.root, this.style);
    }
    if (update.values) this.options.onValues?.(update.values);
    if (update.formulas) this.options.onFormulas?.(update.formulas);
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
    this.visible = visible;
    this.updateAudible();
    this.send({ type: 'visible', value: visible });
  }

  /** A figure sounds while it plays, or while it is still with nothing to play, and only in sight. */
  private updateAudible(): void {
    this.sound.setAudible(this.visible && (this.ui.playing || this.ui.animated === false));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.options.channel.send({ type: 'destroy' });
    this.destroyed = true;
    this.controller.abort();
    this.pointer.destroy();
    this.sound.destroy();
    if (this.announceTimer !== null) clearTimeout(this.announceTimer);
    this.announceTimer = null;
    this.observer?.disconnect();
    this.observer = null;
    this.resizer?.disconnect();
    this.resizer = null;
    if (this.frameHandle !== null) this.clock.cancel(this.frameHandle);
    this.frameHandle = null;
    this.unsubscribe();
  }

  get isRunning(): boolean {
    return this.frameHandle !== null;
  }

  private toggleFullscreen(): void {
    const doc = this.root.ownerDocument;
    if (doc.fullscreenElement) void doc.exitFullscreen?.();
    else void this.root.requestFullscreen?.().catch(() => undefined);
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
    let dt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (this.awaiting) {
      // The previous tick has not been answered yet (a Worker is busy): try next frame.
      this.capped += dt;
      this.schedule();
      return;
    }
    const cap = this.controls.frameCap;
    if (cap > 0) {
      // A frame-rate cap: hold time back until a whole capped frame has passed.
      this.capped += dt;
      if (this.capped < 1 / cap - 0.002) {
        this.schedule();
        return;
      }
      dt = this.capped;
      this.capped = 0;
    } else if (this.capped > 0) {
      dt += this.capped;
      this.capped = 0;
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

  /** Canvas layers follow the drawing's size. */
  private observeSize(): void {
    const view = this.root.ownerDocument.defaultView;
    if (!view || !('ResizeObserver' in view)) return;
    this.resizer = new view.ResizeObserver(() => this.scene.repaintDots());
    this.resizer.observe(this.root);
  }

  private seen(visible: boolean): void {
    this.visible = visible;
    this.updateAudible();
    this.send({ type: 'visible', value: visible });
  }

  private observeVisibility(doc: Document, signal: AbortSignal): void {
    const view = doc.defaultView;
    if (view && 'IntersectionObserver' in view) {
      this.observer = new view.IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        this.onScreen = entry.isIntersecting;
        this.seen(this.onScreen && doc.visibilityState !== 'hidden');
      });
      this.observer.observe(this.root);
    }
    doc.addEventListener(
      'visibilitychange',
      () => this.seen(this.onScreen && doc.visibilityState !== 'hidden'),
      { signal },
    );
  }
}
