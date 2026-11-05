import type { ProbeReport, ProbeSpec } from '../probe/probe';
import { frameLang, parseFrameMessage, type ArrivingFragments, type FrameMessage, type HostMessageBody, type LiveOptions, type ProbeRequest } from '../protocol/bridge';
import type { ErrorView } from '../protocol/ui';
import { hostCss, styleForBridge, type FigureStyle } from '../renderer/style';
import { validateScene, type SceneFragments, type SceneValidation, type ValidatedScene } from '../validation';
import type { KitName } from '../runtime/kits';
import { clipSettings, type ClipOptions } from './clip';
import { preloadKits, workerScriptFor } from './worker-script';
import { buildShell, newChannelId, newNonce } from './shell';

/**
 * The host side of the sandbox execution adapter (ADR 002). It validates the
 * fragments, builds the frame, connects the bridge, and enforces the mount,
 * heartbeat and probe deadlines. A frame that misses one, or loads a second
 * time, is removed; the host then shows its snapshot and text alternative.
 */

export type FigureState = 'booting' | 'live' | 'failed' | 'destroyed';

export interface Deadlines {
  /** From inserting the frame to the first drawn update. */
  readonly mountMs: number;
  /** Ping interval; a ping unanswered by the next one fails the figure. */
  readonly heartbeatMs: number;
  /** A probe must report within this (RP-10). */
  readonly probeMs: number;
}

export const DEFAULT_DEADLINES: Deadlines = { mountMs: 4000, heartbeatMs: 2000, probeMs: 3000 };

export interface FigureCallbacks {
  readonly onValues?: (values: Readonly<Record<string, number>>) => void;
  /** Formulas the learner edited, by index. */
  readonly onFormulas?: (formulas: Readonly<Record<string, string>>) => void;
  /** The teaching position, and how many steps the figure has. */
  readonly onStep?: (step: number | null, count?: number) => void;
  readonly onError?: (error: ErrorView) => void;
  readonly onState?: (state: FigureState) => void;
  /** The text alternative changed. */
  readonly onDescription?: (text: string) => void;
  /** Keyboard focus is leaving the figure. */
  readonly onEscape?: (direction: 'out' | 'forward' | 'backward') => void;
}

export interface MountOptions extends Omit<LiveOptions, 'style'>, FigureCallbacks {
  /** How the integrator styles the figure, including trusted CSS of their own. */
  readonly style?: FigureStyle;
  /** Accessible name of the frame. */
  readonly title?: string;
  readonly lang?: string;
  readonly deadlines?: Partial<Deadlines>;
}

/** What every execution adapter returns: the contract in docs/architecture/sandbox.md. */
export interface FigureHandle {
  readonly state: FigureState;
  /** Resolves with 'live' once the figure has drawn, or 'failed'. */
  readonly ready: Promise<FigureState>;
  pause(): void;
  resume(): void;
  setValues(values: Readonly<Record<string, number>>): void;
  /** Returns the figure to saved learner values and teaching position. */
  restore(state: { readonly values?: Readonly<Record<string, number>>; readonly step?: number | null }): void;
  setReducedMotion(value: boolean): void;
  /** Films only: seeks the scene to this many seconds of scene time (FV-1). */
  seek(seconds: number): void;
  /**
   * Restyles the live figure without remounting it: preset, tokens, slot
   * classes, layout and which parts show. Trusted CSS is part of the frame
   * document, so a change to `css` needs a new mount.
   */
  setStyle(style: FigureStyle | undefined): void;
  setTheme(theme: 'light' | 'dark' | 'auto'): void;
  /** The figure's number in its document, shown in the card; null for none. */
  setNumber(figureNumber: number | null): void;
  /** Moves keyboard focus into the figure. */
  focus(edge?: 'first' | 'last'): void;
  /** The figure's laid-out size, once it has one. Browsers do not lay out off-screen frames. */
  measure(): { readonly width: number; readonly height: number } | null;
  /** The drawing as a PNG data URL (6.10a): every panel of a figure laid out in panels, each where it sits. */
  snapshot(): Promise<string | null>;
  /**
   * The drawing as an SVG image with the theme written in, as a data URL
   * (SV-14), every panel where it sits. Show it in an <img> or offer it as a
   * download; do not paste it into a page as markup.
   */
  exportSvg(): Promise<string | null>;
  /**
   * A short video of the drawing as it plays (6.10b), every panel where it
   * sits, WebM or MP4 as the browser records it; a still figure that is
   * paused plays while it records. Null where the browser cannot record a
   * canvas.
   */
  exportClip(options?: ClipOptions): Promise<Blob | null>;
  destroy(): void;
}

export interface ExecutionAdapter {
  readonly name: string;
  mount(container: HTMLElement, fragments: SceneFragments, options?: MountOptions): FigureHandle;
  /**
   * Boots what the next figure needs before its scene exists, such as while
   * it is being made (PRD 25.4), for as long as the lease is held. Adapters
   * with nothing to boot leave it out.
   */
  prewarm?(options?: PrewarmOptions): WarmLease;
}

export interface PrewarmOptions {
  /** Where the frame waits, hidden, until a figure takes it. Default the document body. */
  readonly container?: HTMLElement;
  /** Drawing kits to fetch alongside, when the plan has named them. */
  readonly kits?: readonly KitName[];
}

/** A hold on a warm frame: while any is held, one live frame stays booted for the next figure. */
export interface WarmLease {
  release(): void;
}

// ---------------------------------------------------------------------------
// The frame and its bridge
// ---------------------------------------------------------------------------

interface ConnectionHandlers {
  readonly onMessage: (message: FrameMessage) => void;
  readonly onNavigate: () => void;
}

/** One sandboxed iframe and the port to it. Messages are checked against the channel id. */
class FrameConnection {
  readonly frame: HTMLIFrameElement;
  private port: MessagePort | null = null;
  private loads = 0;
  private closed = false;

  constructor(
    container: HTMLElement,
    /** The markup and styles the frame document carries: a validated scene's, or none for a probe. */
    shell: { readonly html: string; readonly css: string },
    private readonly channel: string,
    private readonly handlers: ConnectionHandlers,
    options: { readonly title: string; readonly hidden?: boolean; readonly lang?: string; readonly hostCss?: string; readonly nonce?: string },
  ) {
    const doc = container.ownerDocument;
    const frame = doc.createElement('iframe');
    // allow-scripts only: an opaque origin with no access to the host, its storage or its cookies.
    frame.setAttribute('sandbox', 'allow-scripts');
    // Full screen is asked for by the trusted renderer on a learner's tap; scene code has no DOM to ask with.
    frame.setAttribute('allow', 'fullscreen');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = options.title;
    frame.style.border = '0';
    frame.style.display = 'block';
    frame.style.width = '100%';
    frame.style.colorScheme = 'normal';
    if (options.hidden) {
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      // Parked above the page, where nothing scrolls to it, whichever way the page's text runs.
      frame.style.position = 'absolute';
      frame.style.left = '0';
      frame.style.top = '-10000px';
      frame.style.width = '760px';
      frame.style.height = '480px';
      frame.style.visibility = 'hidden';
    }
    frame.addEventListener('load', () => this.onLoad());
    frame.srcdoc = buildShell({
      html: shell.html,
      css: shell.css,
      channel,
      ...(options.lang ? { lang: options.lang } : {}),
      ...(options.hostCss ? { hostCss: options.hostCss } : {}),
      ...(options.nonce ? { nonce: options.nonce } : {}),
    });
    this.frame = frame;
    container.append(frame);
  }

  private onLoad(): void {
    if (this.closed) return;
    this.loads++;
    if (this.loads > 1) {
      // The frame navigated or reloaded itself: never trust it again.
      this.handlers.onNavigate();
      return;
    }
    const window = this.frame.contentWindow;
    if (!window) return;
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    port1.onmessage = (event) => {
      const message = parseFrameMessage(event.data, this.channel);
      if (message && !this.closed) this.handlers.onMessage(message);
    };
    window.postMessage({ incantly: 'connect', v: 1, channel: this.channel }, '*', [port2]);
  }

  post(body: HostMessageBody): void {
    if (!this.closed) this.port?.postMessage({ v: 1, channel: this.channel, ...body });
  }

  close(): void {
    if (this.closed) return;
    this.post({ type: 'destroy' });
    this.closed = true;
    this.port?.close();
    this.port = null;
    this.frame.remove();
  }
}

function initMessage(
  scene: ValidatedScene,
  worker: string,
  mode: 'live' | 'probe',
  extra: { live?: LiveOptions; probe?: ProbeRequest; fragments?: ArrivingFragments },
): HostMessageBody {
  return {
    type: 'init',
    mode,
    worker,
    scene: scene.instrumented.code,
    shifts: scene.instrumented.shifts,
    ...(extra.live ? { live: extra.live } : {}),
    ...(extra.probe ? { probe: extra.probe } : {}),
    ...(extra.fragments ? { fragments: extra.fragments } : {}),
  };
}

// ---------------------------------------------------------------------------
// Warm frames (PRD 25.4)
// ---------------------------------------------------------------------------

/** After the last lease goes, a warm frame no figure took waits this long for one, then closes. */
const WARM_IDLE_MS = 15_000;

/**
 * A live figure's frame booted before its scene exists: the shell, the theme
 * and the frame script, under a policy that lets in styles carrying its
 * nonce. A figure takes it where it will show and hands it the scene's
 * markup, styles and script by message.
 */
class WarmFrame {
  readonly connection: FrameConnection;
  readonly nonce = newNonce();
  ready = false;
  private navigated = false;
  private listener: ConnectionHandlers | null = null;

  constructor(container: HTMLElement) {
    this.connection = new FrameConnection(
      container,
      { html: '', css: '' },
      newChannelId(),
      {
        onMessage: (message) => {
          if (message.type === 'ready') this.ready = true;
          this.listener?.onMessage(message);
        },
        onNavigate: () => {
          this.navigated = true;
          this.listener?.onNavigate();
        },
      },
      { title: 'Interactive figure', hidden: true, nonce: this.nonce },
    );
  }

  /** Whether this frame can be moved into the container as it is, without loading again. */
  fits(container: HTMLElement): boolean {
    const frame = this.connection.frame;
    if (this.navigated || !frame.isConnected || !container.isConnected || frame.ownerDocument !== container.ownerDocument) return false;
    return frame.parentElement === container || canMove(container);
  }

  /**
   * Moves the frame into the container with its document intact, shows it,
   * and hands its messages to the figure from now on. Moving any other way
   * would load the frame again, which the bridge takes for a navigation.
   */
  adopt(container: HTMLElement, title: string, listener: ConnectionHandlers): void {
    const frame = this.connection.frame;
    if (frame.parentElement !== container) (container as unknown as Movable).moveBefore(frame, null);
    frame.title = title;
    frame.removeAttribute('aria-hidden');
    frame.removeAttribute('tabindex');
    for (const name of ['position', 'left', 'top', 'height', 'visibility']) frame.style.removeProperty(name);
    frame.style.width = '100%';
    this.listener = listener;
  }

  close(): void {
    this.listener = null;
    this.connection.close();
  }
}

interface Movable {
  moveBefore(node: Node, child: Node | null): void;
}

/** Whether the browser moves an element, a frame among them, without loading it again (moveBefore). */
function canMove(element: Element): boolean {
  return typeof (element as unknown as Partial<Movable>).moveBefore === 'function';
}

/** The warm frame waiting for the next figure, and who wants one kept. */
const warm: { frame: WarmFrame | null; holder: HTMLElement | null; leases: number; idle: ReturnType<typeof setTimeout> | null } = {
  frame: null,
  holder: null,
  leases: 0,
  idle: null,
};

/** Warms the next frame, while a lease is still held. */
function warmAnother(): void {
  if (warm.frame || warm.leases === 0 || !warm.holder?.isConnected) return;
  warm.frame = new WarmFrame(warm.holder);
}

/**
 * Keeps one live figure's frame booted with the shell and engine while the
 * lease is held, such as while a figure is being made (PRD 25.4). The next
 * figure mounted takes it and gets its markup, styles and script by message
 * instead of booting a frame of its own, and another is warmed behind it.
 * A frame waiting in the document body is moved into its figure with
 * moveBefore, which keeps its document; where the browser has no such move,
 * only a frame warmed in the figure's own container is used.
 */
export function prewarmFigure(options: PrewarmOptions = {}): WarmLease {
  if (options.kits) preloadKits(options.kits);
  const holder = options.container ?? (typeof document === 'undefined' ? null : document.body);
  if (!holder || (!options.container && !canMove(holder))) return { release: () => undefined };
  warm.leases++;
  if (warm.idle !== null) clearTimeout(warm.idle);
  warm.idle = null;
  if (warm.holder !== holder) {
    warm.frame?.close();
    warm.frame = null;
    warm.holder = holder;
  }
  warmAnother();
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      warm.leases--;
      if (warm.leases > 0) return;
      warm.idle = setTimeout(() => {
        warm.idle = null;
        if (warm.leases > 0) return;
        warm.frame?.close();
        warm.frame = null;
        warm.holder = null;
      }, WARM_IDLE_MS);
    },
  };
}

/**
 * The warm frame, if one is waiting and can be moved into the container.
 * While leases are held another is warmed behind it, unless it was warmed in
 * the figure's own container, which is the figure's now.
 */
function takeWarmFrame(container: HTMLElement): WarmFrame | null {
  const frame = warm.frame;
  if (!frame) return null;
  warm.frame = null;
  const fits = frame.fits(container);
  if (!fits) frame.close();
  if (warm.holder === container) warm.holder = null;
  else if (warm.leases > 0) queueMicrotask(warmAnother);
  return fits ? frame : null;
}

// ---------------------------------------------------------------------------
// Live figures
// ---------------------------------------------------------------------------

class SandboxedFigure implements FigureHandle {
  state: FigureState = 'booting';
  readonly ready: Promise<FigureState>;
  private settle!: (state: FigureState) => void;
  private connection: FrameConnection | null = null;
  private mountTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private pingId = 0;
  private awaitingPong: number | null = null;
  private snapshots = new Map<number, (picture: string | null) => void>();
  private clips = new Map<number, (video: Blob | null) => void>();
  private laidOut = false;
  private snapshotId = 0;
  /** Style and theme asked for before the frame was ready; they go with the init message. */
  private early: { style?: FigureStyle | undefined; theme?: 'light' | 'dark' | 'auto'; figureNumber?: number | null } = {};
  /** The frame was booted before this scene existed and taken over (PRD 25.4). */
  warmed = false;
  private readonly deadlines: Deadlines;
  private readonly doc: Document;
  private readonly onVisibility = () => {
    // Hidden pages throttle or suspend timers: forget pings sent before that.
    if (this.doc.visibilityState === 'visible') this.awaitingPong = null;
  };

  constructor(
    container: HTMLElement,
    validation: SceneValidation,
    private readonly options: MountOptions,
  ) {
    this.ready = new Promise((resolve) => (this.settle = resolve));
    this.doc = container.ownerDocument;
    this.deadlines = { ...DEFAULT_DEADLINES, ...options.deadlines };
    const scene = validation.scene;
    if (!scene) {
      // The first error names the failure kind; the fragments themselves are never echoed back.
      const first = validation.diagnostics.find((d) => d.severity === 'error');
      this.fail({
        phase: 'mount',
        message: `The figure did not pass validation${first ? ` (${first.rule} in ${first.fragment})` : ''}`,
        ...(first ? { line: first.line, column: first.column } : {}),
      });
      return;
    }
    const channel = newChannelId();
    const style = styleForBridge(options.style);
    const live: LiveOptions = {
      ...(options.values ? { values: options.values } : {}),
      ...(options.formulas ? { formulas: options.formulas } : {}),
      ...(options.step !== undefined ? { step: options.step } : {}),
      ...(options.autoplay !== undefined ? { autoplay: options.autoplay } : {}),
      ...(options.reducedMotion !== undefined ? { reducedMotion: options.reducedMotion } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.theme ? { theme: options.theme } : {}),
      ...(style ? { style } : {}),
      ...(options.figureNumber !== undefined ? { figureNumber: options.figureNumber } : {}),
    };
    const css = hostCss(options.style);
    // Kit scripts load while the frame boots.
    const worker = workerScriptFor(scene.kits);
    worker.catch(() => this.fail({ phase: 'mount', message: 'A drawing kit this figure needs could not be loaded' }));
    const title = options.title ?? 'Interactive figure';
    // A frame booted before this scene existed takes its markup and styles by message (PRD 25.4).
    const warmed = takeWarmFrame(container);
    // A tag a frame cannot carry is left out, as a frame made with its scene falls back to its own.
    const lang = frameLang(options.lang);
    const arriving: ArrivingFragments | undefined = warmed
      ? { html: scene.html, css: scene.css, ...(css ? { hostCss: css } : {}), nonce: warmed.nonce, ...(lang ? { lang } : {}) }
      : undefined;
    const navigated = () => this.fail({ phase: 'unresponsive', message: 'The figure tried to navigate and was removed' });
    // A frame of its own, made with the scene's markup and styles.
    const own = () =>
      new FrameConnection(
        container,
        scene,
        channel,
        { onMessage: (message) => this.onMessage(message, scene, live, worker, undefined), onNavigate: navigated },
        { title, ...(lang ? { lang } : {}), ...(css ? { hostCss: css } : {}) },
      );
    if (warmed) {
      warmed.adopt(container, title, {
        onMessage: (message) => this.onMessage(message, scene, live, worker, arriving),
        onNavigate: () => {
          // A warm frame that loads again was not moved whole: before the scene runs, it gets a frame of its own instead.
          if (this.state !== 'booting' || !this.warmed) return navigated();
          this.warmed = false;
          this.connection?.close();
          this.connection = own();
        },
      });
      this.connection = warmed.connection;
      this.warmed = true;
      if (warmed.ready) this.begin(scene, live, worker, arriving);
    } else {
      this.connection = own();
    }
    this.mountTimer = setTimeout(() => this.fail({ phase: 'unresponsive', message: 'The figure did not start in time' }), this.deadlines.mountMs);
    this.doc.addEventListener('visibilitychange', this.onVisibility);
  }

  /**
   * The frame is ready: the scene goes in once its kits have loaded, with any
   * style or theme set meanwhile, and with its markup and styles if the frame
   * was warmed without them.
   */
  private begin(scene: ValidatedScene, live: LiveOptions, worker: Promise<string>, fragments: ArrivingFragments | undefined): void {
    void worker.then(
      (code) => this.connection?.post(initMessage(scene, code, 'live', { live: this.withEarly(live), ...(fragments ? { fragments } : {}) })),
      () => undefined,
    );
  }

  private onMessage(message: FrameMessage, scene: ValidatedScene, live: LiveOptions, worker: Promise<string>, fragments: ArrivingFragments | undefined): void {
    switch (message.type) {
      case 'ready':
        this.begin(scene, live, worker, fragments);
        break;
      case 'mounted':
        if (this.state !== 'booting') break;
        this.clearMountTimer();
        this.setState('live');
        this.settle('live');
        this.startHeartbeat();
        break;
      case 'error':
        this.options.onError?.(message.error);
        if (message.error.phase === 'unresponsive' || this.state === 'booting') this.fail(message.error, false);
        break;
      case 'values':
        this.options.onValues?.(message.values);
        break;
      case 'formulas':
        this.options.onFormulas?.(message.formulas);
        break;
      case 'step':
        this.options.onStep?.(message.step, message.count);
        break;
      case 'description':
        this.options.onDescription?.(message.text);
        break;
      case 'escape':
        this.options.onEscape?.(message.direction);
        break;
      case 'resize':
        if (this.connection) {
          this.connection.frame.style.height = `${Math.min(message.height, 4000)}px`;
          this.laidOut = true;
        }
        break;
      case 'snapshot':
        this.snapshots.get(message.id)?.(message.svg !== undefined ? message.svg : message.png);
        this.snapshots.delete(message.id);
        break;
      case 'clip':
        this.clips.get(message.id)?.(message.video);
        this.clips.delete(message.id);
        break;
      case 'pong':
        if (message.id === this.awaitingPong) this.awaitingPong = null;
        break;
      default:
        break;
    }
  }

  private startHeartbeat(): void {
    this.heartbeat = setInterval(() => {
      if (this.doc.visibilityState !== 'visible') return;
      if (this.awaitingPong !== null) {
        this.fail({ phase: 'unresponsive', message: 'The figure stopped responding and was removed' });
        return;
      }
      this.awaitingPong = ++this.pingId;
      this.connection?.post({ type: 'ping', id: this.pingId });
    }, this.deadlines.heartbeatMs);
  }

  private clearMountTimer(): void {
    if (this.mountTimer !== null) clearTimeout(this.mountTimer);
    this.mountTimer = null;
  }

  private setState(state: FigureState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onState?.(state);
  }

  private teardown(): void {
    this.clearMountTimer();
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.connection?.close();
    this.connection = null;
    for (const resolve of this.snapshots.values()) resolve(null);
    this.snapshots.clear();
    for (const resolve of this.clips.values()) resolve(null);
    this.clips.clear();
  }

  private fail(error: ErrorView, report = true): void {
    if (this.state === 'failed' || this.state === 'destroyed') return;
    this.teardown();
    // The cause is reported before the state changes, as the in-thread adapter does, so a state listener knows why.
    if (report) this.options.onError?.(error);
    if (this.state !== 'booting' && this.state !== 'live') return;
    this.setState('failed');
    this.settle('failed');
  }

  pause(): void {
    this.connection?.post({ type: 'pause' });
  }

  resume(): void {
    this.connection?.post({ type: 'resume' });
  }

  setValues(values: Readonly<Record<string, number>>): void {
    this.connection?.post({ type: 'setValues', values });
  }

  restore(state: { readonly values?: Readonly<Record<string, number>>; readonly step?: number | null }): void {
    if (state.values) this.setValues(state.values);
    if (state.step !== undefined) this.connection?.post({ type: 'step', step: state.step });
  }

  setReducedMotion(value: boolean): void {
    this.connection?.post({ type: 'reducedMotion', value });
  }

  seek(seconds: number): void {
    if (typeof seconds === 'number' && Number.isFinite(seconds)) this.connection?.post({ type: 'seek', seconds });
  }

  setStyle(style: FigureStyle | undefined): void {
    if (this.state === 'booting') this.early = { ...this.early, style };
    // An empty style restores the defaults; the frame checks it again either way.
    this.connection?.post({ type: 'style', style: styleForBridge(style) ?? {} });
  }

  setTheme(theme: 'light' | 'dark' | 'auto'): void {
    if (this.state === 'booting') this.early = { ...this.early, theme };
    this.connection?.post({ type: 'theme', theme });
  }

  setNumber(figureNumber: number | null): void {
    if (this.state === 'booting') this.early = { ...this.early, figureNumber };
    this.connection?.post({ type: 'number', figureNumber });
  }

  /** The live options with any style or theme set while the frame was starting. */
  private withEarly(live: LiveOptions): LiveOptions {
    const style = 'style' in this.early ? styleForBridge(this.early.style) : live.style;
    const theme = this.early.theme ?? live.theme;
    const figureNumber = 'figureNumber' in this.early ? this.early.figureNumber : live.figureNumber;
    const { style: _style, theme: _theme, figureNumber: _number, ...rest } = live;
    return { ...rest, ...(style ? { style } : {}), ...(theme ? { theme } : {}), ...(typeof figureNumber === 'number' ? { figureNumber } : {}) };
  }

  measure(): { width: number; height: number } | null {
    if (!this.connection || !this.laidOut) return null;
    const rect = this.connection.frame.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : null;
  }

  focus(edge: 'first' | 'last' = 'first'): void {
    if (!this.connection) return;
    // The frame element takes focus first, so the browser lets the frame move it inside.
    this.connection.frame.focus();
    this.connection.post({ type: 'focus', edge });
  }

  snapshot(): Promise<string | null> {
    return this.picture('png');
  }

  exportSvg(): Promise<string | null> {
    return this.picture('svg');
  }

  exportClip(options: ClipOptions = {}): Promise<Blob | null> {
    if (!this.connection || this.state !== 'live') return Promise.resolve(null);
    const { seconds, fps } = clipSettings(options);
    const id = ++this.snapshotId;
    return new Promise((resolve) => {
      this.clips.set(id, resolve);
      this.connection?.post({ type: 'clip', id, seconds, fps });
      // The recording itself, then as long as a mount may take to hand it over.
      setTimeout(() => {
        if (this.clips.delete(id)) resolve(null);
      }, seconds * 1000 + this.deadlines.mountMs);
    });
  }

  private picture(format: 'png' | 'svg'): Promise<string | null> {
    if (!this.connection || this.state !== 'live') return Promise.resolve(null);
    const id = ++this.snapshotId;
    return new Promise((resolve) => {
      this.snapshots.set(id, resolve);
      this.connection?.post({ type: 'snapshot', id, ...(format === 'svg' ? { format } : {}) });
      setTimeout(() => {
        if (this.snapshots.delete(id)) resolve(null);
      }, this.deadlines.mountMs);
    });
  }

  destroy(): void {
    if (this.state === 'destroyed') return;
    this.teardown();
    this.setState('destroyed');
    this.settle('destroyed');
  }
}

/** Validates a scene and runs it in a sandboxed frame. */
export function mountSandboxed(container: HTMLElement, fragments: SceneFragments, options: MountOptions = {}): FigureHandle {
  return new SandboxedFigure(container, validateScene(fragments), options);
}

/**
 * Security tests only: runs fragments in the sandbox WITHOUT the validator, so
 * the layers beneath it (wrapper, Worker, frame policy, watchdogs) can be shown
 * to hold on their own. Exported from @incantly/core/testing, never from the
 * package root.
 */
export function mountUnvalidated(container: HTMLElement, fragments: SceneFragments, options: MountOptions = {}): FigureHandle {
  const validation: SceneValidation = {
    ok: true,
    diagnostics: [],
    scene: { html: fragments.html, css: fragments.css, js: fragments.js, instrumented: { code: fragments.js, shifts: {} }, kits: [] },
    info: { paramCount: 0, stages: [], parts: [], stepCount: null, hasIdea: false, hasDescribe: false, hasExplain: false, kits: [] },
  };
  return new SandboxedFigure(container, validation, options);
}

/** Security tests only: the probe without the validator. */
export function probeUnvalidated(fragments: SceneFragments, options: SandboxProbeOptions = {}): Promise<ProbeOutcome> {
  return runProbe(
    {
      ok: true,
      diagnostics: [],
      scene: { html: fragments.html, css: fragments.css, js: fragments.js, instrumented: { code: fragments.js, shifts: {} }, kits: [] },
      info: { paramCount: 0, stages: [], parts: [], stepCount: null, hasIdea: false, hasDescribe: false, hasExplain: false, kits: [] },
    },
    options,
  );
}

export const sandboxAdapter: ExecutionAdapter = { name: 'sandbox', mount: mountSandboxed, prewarm: prewarmFigure };

// ---------------------------------------------------------------------------
// The probe, in a fresh hidden frame through the same adapter
// ---------------------------------------------------------------------------

export interface ProbeOutcome {
  readonly ok: boolean;
  readonly validation: SceneValidation;
  /** Absent when validation failed. */
  readonly report: ProbeReport | null;
}

export interface SandboxProbeOptions {
  readonly spec?: ProbeSpec;
  readonly seed?: number;
  /** Where the hidden frame lives while it runs; defaults to the document body. */
  readonly container?: HTMLElement;
  readonly deadlineMs?: number;
}

function failedReport(check: 'timeout' | 'mount', message: string, durationMs: number): ProbeReport {
  return {
    ok: false,
    failures: [{ check, message }],
    stats: { configurations: 0, frames: 0, averageFrameMs: 0, elements: 0, durationMs },
  };
}

/** Runs the probe on a scene in a hidden sandboxed frame. Nothing is shown. */
export function probeSandboxed(fragments: SceneFragments, options: SandboxProbeOptions = {}): Promise<ProbeOutcome> {
  return runProbe(validateScene(fragments), options);
}

function runProbe(validation: SceneValidation, options: SandboxProbeOptions): Promise<ProbeOutcome> {
  if (!validation.scene) return Promise.resolve({ ok: false, validation, report: null });
  return new ProbeFrame(options.container ?? document.body).run(validation, options);
}

/**
 * A probe frame booted before its scene exists (PRD 25.4). The frame and its
 * script load while the scene is still being written, and the drawing kits
 * the plan names with them, so the check starts the moment the fragments
 * arrive. A probe needs no markup or styles, so the frame is the same for
 * every scene. Each warm frame checks one scene, then closes.
 */
export interface WarmProbe {
  /** Checks a scene in the warm frame; a second call gets a fresh frame. */
  probe(fragments: SceneFragments, options?: Omit<SandboxProbeOptions, 'container'>): Promise<ProbeOutcome>;
  /** Closes the frame if it was never used. */
  dispose(): void;
}

export function warmProbe(options: { readonly container?: HTMLElement; readonly kits?: readonly KitName[] } = {}): WarmProbe {
  const container = options.container ?? document.body;
  if (options.kits) preloadKits(options.kits);
  let frame: ProbeFrame | null = new ProbeFrame(container);
  return {
    probe(fragments, probeOptions = {}) {
      const validation = validateScene(fragments);
      const current = frame ?? new ProbeFrame(container);
      frame = null;
      if (!validation.scene) {
        current.close();
        return Promise.resolve({ ok: false, validation, report: null });
      }
      return current.run(validation, probeOptions);
    },
    dispose() {
      frame?.close();
      frame = null;
    },
  };
}

/** One hidden frame that boots on its own and then checks one validated scene. */
class ProbeFrame {
  private readonly connection: FrameConnection;
  private ready = false;
  private navigated = false;
  private listener: { onReady(): void; onMessage(message: FrameMessage): void; onNavigate(): void } | null = null;

  constructor(container: HTMLElement) {
    this.connection = new FrameConnection(
      container,
      { html: '', css: '' },
      newChannelId(),
      {
        onMessage: (message) => {
          if (message.type === 'ready') {
            this.ready = true;
            this.listener?.onReady();
          } else this.listener?.onMessage(message);
        },
        onNavigate: () => {
          this.navigated = true;
          this.listener?.onNavigate();
        },
      },
      { title: 'Figure check', hidden: true },
    );
  }

  close(): void {
    this.listener = null;
    this.connection.close();
  }

  run(validation: SceneValidation, options: SandboxProbeOptions): Promise<ProbeOutcome> {
    const scene = validation.scene!;
    const deadline = options.deadlineMs ?? DEFAULT_DEADLINES.probeMs;
    const started = performance.now();
    return new Promise((resolve) => {
      let done = false;
      const finish = (report: ProbeReport) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.close();
        resolve({ ok: report.ok, validation, report });
      };
      const timer = setTimeout(
        () => finish(failedReport('timeout', `The probe did not finish within ${deadline} ms; the scene probably never stops`, deadline)),
        deadline,
      );
      const probe: ProbeRequest = {
        ...(options.spec ? { spec: options.spec } : {}),
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
      };
      const worker = workerScriptFor(scene.kits);
      worker.catch(() => finish(failedReport('mount', 'A drawing kit this scene needs could not be loaded', performance.now() - started)));
      const send = () =>
        void worker.then(
          (code) => this.connection.post(initMessage(scene, code, 'probe', { probe })),
          () => undefined,
        );
      this.listener = {
        onReady: send,
        onMessage: (message) => {
          if (message.type === 'probe') finish(message.report);
          else if (message.type === 'error') finish(failedReport('mount', message.error.message, performance.now() - started));
        },
        onNavigate: () => finish(failedReport('mount', 'The scene tried to navigate', performance.now() - started)),
      };
      if (this.navigated) finish(failedReport('mount', 'The scene tried to navigate', 0));
      else if (this.ready) send();
    });
  }
}

export type PresentResult =
  | { readonly status: 'live'; readonly figure: FigureHandle; readonly probe: ProbeOutcome }
  | { readonly status: 'rejected'; readonly probe: ProbeOutcome };

/**
 * The learner-facing path for a newly generated scene (PRD 27.1): probe it
 * hidden first, and mount it only if it passes. A rejected scene is never shown.
 */
export async function presentScene(
  container: HTMLElement,
  fragments: SceneFragments,
  options: MountOptions & { readonly spec?: ProbeSpec } = {},
): Promise<PresentResult> {
  const probe = await probeSandboxed(fragments, {
    ...(options.spec ? { spec: options.spec } : {}),
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
    container,
  });
  if (!probe.ok) return { status: 'rejected', probe };
  const figure = mountSandboxed(container, fragments, options);
  return { status: 'live', figure, probe };
}
