import type { ProbeReport, ProbeSpec } from '../probe/probe';
import { parseFrameMessage, type FrameMessage, type HostMessageBody, type LiveOptions, type ProbeRequest } from '../protocol/bridge';
import type { ErrorView } from '../protocol/ui';
import { validateScene, type SceneFragments, type SceneValidation, type ValidatedScene } from '../validation';
import { WORKER_SCRIPT } from './generated/bundles';
import { buildShell, newChannelId } from './shell';

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
  readonly onStep?: (step: number | null) => void;
  readonly onError?: (error: ErrorView) => void;
  readonly onState?: (state: FigureState) => void;
  /** The text alternative changed. */
  readonly onDescription?: (text: string) => void;
  /** Keyboard focus is leaving the figure. */
  readonly onEscape?: (direction: 'out' | 'forward' | 'backward') => void;
}

export interface MountOptions extends LiveOptions, FigureCallbacks {
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
  /** Moves keyboard focus into the figure. */
  focus(edge?: 'first' | 'last'): void;
  snapshot(): Promise<string | null>;
  destroy(): void;
}

export interface ExecutionAdapter {
  readonly name: string;
  mount(container: HTMLElement, fragments: SceneFragments, options?: MountOptions): FigureHandle;
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
    scene: ValidatedScene,
    private readonly channel: string,
    private readonly handlers: ConnectionHandlers,
    options: { readonly title: string; readonly hidden?: boolean; readonly lang?: string },
  ) {
    const doc = container.ownerDocument;
    const frame = doc.createElement('iframe');
    // allow-scripts only: an opaque origin with no access to the host, its storage or its cookies.
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = options.title;
    frame.style.border = '0';
    frame.style.display = 'block';
    frame.style.width = '100%';
    frame.style.colorScheme = 'normal';
    if (options.hidden) {
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.position = 'absolute';
      frame.style.left = '-10000px';
      frame.style.top = '0';
      frame.style.width = '760px';
      frame.style.height = '480px';
      frame.style.visibility = 'hidden';
    }
    frame.addEventListener('load', () => this.onLoad());
    frame.srcdoc = buildShell({ html: scene.html, css: scene.css, channel, ...(options.lang ? { lang: options.lang } : {}) });
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

function initMessage(scene: ValidatedScene, mode: 'live' | 'probe', extra: { live?: LiveOptions; probe?: ProbeRequest }): HostMessageBody {
  return {
    type: 'init',
    mode,
    worker: WORKER_SCRIPT,
    scene: scene.instrumented.code,
    shifts: scene.instrumented.shifts,
    ...(extra.live ? { live: extra.live } : {}),
    ...(extra.probe ? { probe: extra.probe } : {}),
  };
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
  private snapshots = new Map<number, (png: string | null) => void>();
  private snapshotId = 0;
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
      this.fail({ phase: 'mount', message: 'The figure did not pass validation' });
      return;
    }
    const channel = newChannelId();
    const live: LiveOptions = {
      ...(options.values ? { values: options.values } : {}),
      ...(options.step !== undefined ? { step: options.step } : {}),
      ...(options.autoplay !== undefined ? { autoplay: options.autoplay } : {}),
      ...(options.reducedMotion !== undefined ? { reducedMotion: options.reducedMotion } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.theme ? { theme: options.theme } : {}),
    };
    this.connection = new FrameConnection(
      container,
      scene,
      channel,
      {
        onMessage: (message) => this.onMessage(message, scene, live),
        onNavigate: () => this.fail({ phase: 'unresponsive', message: 'The figure tried to navigate and was removed' }),
      },
      { title: options.title ?? 'Interactive figure', ...(options.lang ? { lang: options.lang } : {}) },
    );
    this.mountTimer = setTimeout(() => this.fail({ phase: 'unresponsive', message: 'The figure did not start in time' }), this.deadlines.mountMs);
    this.doc.addEventListener('visibilitychange', this.onVisibility);
  }

  private onMessage(message: FrameMessage, scene: ValidatedScene, live: LiveOptions): void {
    switch (message.type) {
      case 'ready':
        this.connection?.post(initMessage(scene, 'live', { live }));
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
      case 'step':
        this.options.onStep?.(message.step);
        break;
      case 'description':
        this.options.onDescription?.(message.text);
        break;
      case 'escape':
        this.options.onEscape?.(message.direction);
        break;
      case 'resize':
        if (this.connection) this.connection.frame.style.height = `${Math.min(message.height, 4000)}px`;
        break;
      case 'snapshot':
        this.snapshots.get(message.id)?.(message.png);
        this.snapshots.delete(message.id);
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
  }

  private fail(error: ErrorView, report = true): void {
    if (this.state === 'failed' || this.state === 'destroyed') return;
    this.teardown();
    this.setState('failed');
    if (report) this.options.onError?.(error);
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

  focus(edge: 'first' | 'last' = 'first'): void {
    if (!this.connection) return;
    // The frame element takes focus first, so the browser lets the frame move it inside.
    this.connection.frame.focus();
    this.connection.post({ type: 'focus', edge });
  }

  snapshot(): Promise<string | null> {
    if (!this.connection || this.state !== 'live') return Promise.resolve(null);
    const id = ++this.snapshotId;
    return new Promise((resolve) => {
      this.snapshots.set(id, resolve);
      this.connection?.post({ type: 'snapshot', id });
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
    scene: { html: fragments.html, css: fragments.css, js: fragments.js, instrumented: { code: fragments.js, shifts: {} } },
    info: { paramCount: 0, stages: [], parts: [], stepCount: null, hasIdea: false, hasDescribe: false, hasExplain: false },
  };
  return new SandboxedFigure(container, validation, options);
}

/** Security tests only: the probe without the validator. */
export function probeUnvalidated(fragments: SceneFragments, options: SandboxProbeOptions = {}): Promise<ProbeOutcome> {
  return runProbe(
    {
      ok: true,
      diagnostics: [],
      scene: { html: fragments.html, css: fragments.css, js: fragments.js, instrumented: { code: fragments.js, shifts: {} } },
      info: { paramCount: 0, stages: [], parts: [], stepCount: null, hasIdea: false, hasDescribe: false, hasExplain: false },
    },
    options,
  );
}

export const sandboxAdapter: ExecutionAdapter = { name: 'sandbox', mount: mountSandboxed };

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
  const scene = validation.scene;
  if (!scene) return Promise.resolve({ ok: false, validation, report: null });
  const container = options.container ?? document.body;
  const deadline = options.deadlineMs ?? DEFAULT_DEADLINES.probeMs;
  const started = performance.now();

  return new Promise((resolve) => {
    let connection: FrameConnection | null = null;
    let done = false;
    const finish = (report: ProbeReport) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      connection?.close();
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
    connection = new FrameConnection(
      container,
      scene,
      newChannelId(),
      {
        onMessage: (message) => {
          if (message.type === 'ready') connection?.post(initMessage(scene, 'probe', { probe }));
          else if (message.type === 'probe') finish(message.report);
          else if (message.type === 'error') finish(failedReport('mount', message.error.message, performance.now() - started));
        },
        onNavigate: () => finish(failedReport('mount', 'The scene tried to navigate', performance.now() - started)),
      },
      { title: 'Figure check', hidden: true },
    );
  });
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
