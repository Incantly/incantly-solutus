import type { RuntimeChannel } from '../engine/channel';
import { parseConnect, parseHostMessage, type FrameMessageBody, type HostMessage, type InitMessage } from '../protocol/bridge';
import type { RendererMessage, RuntimeUpdate } from '../protocol/runtime-messages';
import type { ErrorView } from '../protocol/ui';
import { FigureRenderer } from '../renderer/renderer';
import { wrapSceneSource, WRAPPER_LINES_BEFORE } from './scene-wrapper';
import { snapshotStage } from './snapshot';
import type { WorkerInbound, WorkerOutbound } from './worker-protocol';

/**
 * The frame side of the sandbox: runs in the sandboxed iframe, with the
 * trusted renderer and the validated scene HTML and CSS. It accepts one port
 * from its parent, starts the scene's Worker, draws what the Worker sends and
 * terminates the Worker if it stops answering.
 */

/** A Worker that has not answered for this long is terminated. */
const WORKER_DEADLINE_MS = 2500;
/** Values are reported to the host at most this often per figure (EN-8). */
const VALUES_INTERVAL_MS = 100;

const doc = document;
const root = doc.querySelector<HTMLElement>('.inc-root');
const channelId = doc.documentElement.dataset.channel ?? '';
let port: MessagePort | null = null;

function send(body: FrameMessageBody): void {
  port?.postMessage({ v: 1, channel: channelId, ...body });
}

window.addEventListener('message', function connect(event: MessageEvent) {
  if (port || event.source !== window.parent || !parseConnect(event.data, channelId) || event.ports.length !== 1) return;
  window.removeEventListener('message', connect);
  port = event.ports[0]!;
  port.onmessage = (message) => {
    const parsed = parseHostMessage(message.data, channelId);
    if (parsed) onHostMessage(parsed);
  };
  send({ type: 'ready' });
});

/** Talks to the scene's Worker and watches it. */
class WorkerChannel implements RuntimeChannel {
  private readonly listeners = new Set<(update: RuntimeUpdate) => void>();
  private outstanding = 0;
  private waitingSince = 0;
  private readonly timer: ReturnType<typeof setInterval>;
  private dead = false;

  constructor(
    private readonly worker: Worker,
    private readonly onHang: () => void,
  ) {
    this.timer = setInterval(() => {
      if (!this.dead && this.outstanding > 0 && performance.now() - this.waitingSince > WORKER_DEADLINE_MS) this.hang();
    }, 500);
  }

  send(message: RendererMessage): void {
    if (this.dead) return;
    if (message.type !== 'destroy') this.expectAnswer();
    this.post({ type: 'message', message });
  }

  /** Every message but destroy is answered by exactly one update. */
  expectAnswer(): void {
    if (this.outstanding === 0) this.waitingSince = performance.now();
    this.outstanding++;
  }

  post(message: WorkerInbound): void {
    if (!this.dead) this.worker.postMessage(message);
  }

  receive(update: RuntimeUpdate): void {
    if (this.dead) return;
    this.outstanding = Math.max(0, this.outstanding - 1);
    this.waitingSince = performance.now();
    for (const listener of this.listeners) listener(update);
  }

  onUpdate(listener: (update: RuntimeUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hang(): void {
    this.close();
    this.onHang();
  }

  close(): void {
    if (this.dead) return;
    this.dead = true;
    clearInterval(this.timer);
    this.worker.terminate();
  }
}

let channel: WorkerChannel | null = null;
let renderer: FigureRenderer | null = null;
let hostVisible = true;
let onScreen = true;
let mountedSent = false;
let pendingValues: Record<string, number> | null = null;
let pendingDescription: string | null = null;
let valuesTimer: ReturnType<typeof setTimeout> | null = null;
let lastHeight = -1;
const observers: Array<{ disconnect(): void }> = [];

function onHostMessage(message: HostMessage): void {
  switch (message.type) {
    case 'init':
      if (!channel) start(message);
      break;
    case 'pause':
      hostVisible = false;
      updateVisibility();
      break;
    case 'resume':
      hostVisible = true;
      updateVisibility();
      break;
    case 'setValues':
      renderer?.send({ type: 'setValues', values: message.values });
      break;
    case 'step':
      renderer?.send(message.step === null ? { type: 'step', action: 'exit' } : { type: 'step', action: 'goto', index: message.step });
      break;
    case 'reducedMotion':
      renderer?.send({ type: 'reducedMotion', value: message.value });
      break;
    case 'snapshot': {
      const svg = root?.querySelector<SVGSVGElement>('svg.inc-stage') ?? null;
      void snapshotStage(svg).then((png) => send({ type: 'snapshot', id: message.id, png }));
      break;
    }
    case 'ping':
      send({ type: 'pong', id: message.id });
      break;
    case 'focus': {
      const targets = focusable();
      (message.edge === 'first' ? targets[0] : targets[targets.length - 1])?.focus();
      break;
    }
    case 'destroy':
      destroy();
      break;
  }
}

function start(init: InitMessage): void {
  if (!root) return;
  const prefix = `${init.worker}\n__incRegister(`;
  const wrapped = wrapSceneSource(init.scene);
  const blob = new Blob([prefix, wrapped, ');\n'], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  const lineOffset = prefix.split('\n').length - 1 + WRAPPER_LINES_BEFORE;
  const sceneLines = init.scene.split('\n').length;

  let worker: Worker;
  try {
    worker = new Worker(url);
  } catch {
    URL.revokeObjectURL(url);
    fail({ phase: 'mount', message: 'The figure could not start' });
    return;
  }
  const workerChannel = new WorkerChannel(worker, () => fail({ phase: 'unresponsive', message: 'The figure stopped responding and was stopped' }));
  channel = workerChannel;
  worker.onerror = (event) => {
    event.preventDefault();
    fail({ phase: 'mount', message: 'The figure could not start' });
  };
  worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
    const data = event.data;
    switch (data?.type) {
      case 'alive':
        URL.revokeObjectURL(url);
        break;
      case 'update':
        try {
          workerChannel.receive(data.update);
        } catch {
          // A malformed update is the Worker's fault; stop it rather than draw garbage.
          fail({ phase: 'frame', message: 'The figure could not be drawn' });
        }
        break;
      case 'probe':
        send({ type: 'probe', report: data.report });
        workerChannel.close();
        break;
      case 'fatal':
        fail(data.error);
        break;
    }
  };

  const boot: WorkerInbound = {
    type: 'boot',
    mode: init.mode,
    lineOffset,
    sceneLines,
    shifts: init.shifts,
    ...(init.live ? { live: init.live } : {}),
    ...(init.probe ? { probe: init.probe } : {}),
  };
  if (init.mode === 'probe') {
    workerChannel.post(boot);
    return;
  }

  if (init.live?.theme === 'light' || init.live?.theme === 'dark') root.dataset.theme = init.live.theme;
  renderer = new FigureRenderer({
    root,
    channel: workerChannel,
    scope: 'incfig',
    visibility: 'external',
    onValues: (values) => queueReport(values, null),
    onStep: (step) => send({ type: 'step', step }),
    onError: (error) => send({ type: 'error', error }),
    onUpdate: (update) => {
      if (!mountedSent) {
        mountedSent = true;
        send({ type: 'mounted' });
      }
      if (typeof update.ui.description === 'string') queueReport(null, update.ui.description);
    },
  });
  // The mount update answers the boot message.
  workerChannel.expectAnswer();
  workerChannel.post(boot);
  observe();
}

/** Values and the text alternative go to the host at most every 100 ms, always ending with the latest. */
function queueReport(values: Readonly<Record<string, number>> | null, description: string | null): void {
  if (values) pendingValues = { ...pendingValues, ...values };
  if (description !== null) pendingDescription = description;
  if (valuesTimer !== null) return;
  valuesTimer = setTimeout(() => {
    valuesTimer = null;
    if (pendingValues) send({ type: 'values', values: pendingValues });
    if (pendingDescription !== null) send({ type: 'description', text: pendingDescription.slice(0, 2000) });
    pendingValues = null;
    pendingDescription = null;
  }, VALUES_INTERVAL_MS);
}

const FOCUSABLE = 'button, input, select, summary, [tabindex="0"]';

/** The figure's keyboard stops, in order, skipping anything hidden. */
function focusable(): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest('[hidden]') && !(el as HTMLButtonElement).disabled,
  );
}

// Escape, or Tab past either end, hands keyboard focus back to the host document.
doc.addEventListener('keydown', (event) => {
  if (!port) return;
  if (event.key === 'Escape' && !event.defaultPrevented) {
    send({ type: 'escape', direction: 'out' });
    return;
  }
  if (event.key !== 'Tab') return;
  const targets = focusable();
  const active = doc.activeElement;
  if (!event.shiftKey && active === targets[targets.length - 1]) {
    event.preventDefault();
    send({ type: 'escape', direction: 'forward' });
  } else if (event.shiftKey && active === targets[0]) {
    event.preventDefault();
    send({ type: 'escape', direction: 'backward' });
  }
});

function updateVisibility(): void {
  renderer?.setVisible(hostVisible && onScreen && doc.visibilityState !== 'hidden');
}

function observe(): void {
  if (!root) return;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      onScreen = entry.isIntersecting;
      updateVisibility();
    });
    io.observe(root);
    observers.push(io);
  }
  const onVisibility = () => updateVisibility();
  doc.addEventListener('visibilitychange', onVisibility);
  observers.push({ disconnect: () => doc.removeEventListener('visibilitychange', onVisibility) });
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      const height = Math.ceil(doc.documentElement.getBoundingClientRect().height);
      if (height !== lastHeight) {
        lastHeight = height;
        send({ type: 'resize', height });
      }
    });
    ro.observe(doc.documentElement);
    observers.push(ro);
  }
}

/** Stops the Worker but keeps the last good frame on screen, with the engine's own message. */
function fail(error: ErrorView): void {
  channel?.close();
  renderer?.apply({ commands: [], ui: { error, playing: false }, needsFrame: false });
  send({ type: 'error', error });
}

function destroy(): void {
  renderer?.destroy();
  renderer = null;
  channel?.close();
  channel = null;
  for (const observer of observers.splice(0)) observer.disconnect();
  if (valuesTimer !== null) clearTimeout(valuesTimer);
  port?.close();
  port = null;
}
