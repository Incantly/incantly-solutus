/**
 * The page's side of the physics worker (docs/features/physics/design.md 9.6, 11.2; errors.md 5, 7): a figure with
 * liquid, waves or cloth, in the plane or in space, hands its world to the worker; each frame the page sends the time, the free values that changed and its new
 * `@input` lines, and writes the cells that come back. Without a worker the same steps run on the page, with the notice
 * `worker_unavailable` once; if the worker stops, the page takes the world back from its start (`worker_crashed`).
 * Either way the film is the same.
 */
import { StateMachine, physics, sameValue, worldDriverOf } from '@incantly/kernel';
import type { Figure, MachineTable, Notice } from '@incantly/kernel';
import type { FromWorker, ToWorker } from './physics-worker';

/**
 * - `off`: the page plays the world itself; a worker may start.
 * - `idle`: the world runs in the worker, no frame in flight.
 * - `waiting`: one frame is in flight (a slow worker makes the film slower, never a longer queue).
 * - `failed`: no worker could be made, or it crashed; the page keeps the world for good.
 */
export type WorkerLife = 'off' | 'idle' | 'waiting' | 'failed';
export type WorkerLifeEvent = 'start' | 'post' | 'answer' | 'stop' | 'fail';

export const WORKER_MACHINE: MachineTable<WorkerLife, WorkerLifeEvent> = {
  off: { start: 'idle', stop: 'off', fail: 'failed' },
  idle: { post: 'waiting', answer: 'idle', stop: 'off', fail: 'failed' },
  waiting: { answer: 'idle', stop: 'off', fail: 'failed' },
  failed: { stop: 'failed', fail: 'failed' },
};

/** A way to talk to a worker: a real `Worker`, or a channel that runs the handler in the same thread (tests). */
export interface PhysicsChannel {
  post(m: ToWorker): void;
  onMessage(cb: (m: FromWorker) => void): void;
  onError(cb: (why: string) => void): void;
  close(): void;
}

export class PhysicsWorkerHost {
  private channel: PhysicsChannel | undefined;
  readonly life = new StateMachine(WORKER_MACHINE, 'off');
  private version = -1;
  private seq = 0;
  private sent = new Map<string, unknown>();
  /** The driver that handed its world to the worker (the plane's or the space's). */
  private driver: ReturnType<typeof worldDriverOf> | undefined;
  private warnings: Notice[] = [];
  /** The time of the last frame the worker answered, and how long the copy of its cells took on the page (ms). */
  lastT = Number.NaN;
  copyMs = 0;

  constructor(private readonly figure: Figure, private readonly makeChannel: () => PhysicsChannel | undefined, private readonly now: () => number = () => 0) {}

  /** True while the world runs in the worker. */
  get running(): boolean {
    return this.active;
  }

  private get active(): boolean {
    return this.life.is('idle', 'waiting');
  }

  /** Before the page's frame at film time t. */
  frame(t: number): void {
    const f = this.figure;
    // a world with liquid, waves or cloth runs whole in the worker (design 9.6, round 9 for cloth)
    const d = worldDriverOf(f);
    // and a smoke or fire grid in space (a grid in the plane stays on the page, design 9.4)
    const wants = f.objects().some((o) => o.type === 'Liquid' || o.type === 'Waves' || o.type === 'Cloth') || ('hasSmokeGrid' in d && d.hasSmokeGrid());
    // a line moved the world between the plane and space: the old driver takes its world back first
    if (!wants || (this.active && this.driver !== d)) {
      if (this.active) this.stop();
      if (!wants) return;
    }
    if (!this.active) {
      if (this.life.is('failed')) return;
      const ch = this.makeChannel();
      if (!ch) {
        this.life.send('fail');
        this.warnings.push(physics.makeNotice('worker_unavailable', {}, []));
        return;
      }
      this.channel = ch;
      ch.onMessage((m) => this.receive(m));
      ch.onError(() => this.crashed());
      this.life.send('start');
      this.driver = d;
      d.setRemote(true);
      this.version = -1;
    }
    const ch = this.channel as PhysicsChannel;
    const v = f.driverAccess().version();
    if (v !== this.version) {
      // the lines changed: the worker gets the whole script, its `@input` log included
      this.version = v;
      d.clearOutbox();
      this.sent = new Map();
      for (const o of f.objects()) if (o.free && o.cell.defined) this.sent.set(o.name, o.cell.value);
      ch.post({ k: 'load', seq: ++this.seq, script: f.toScript() });
    }
    // one frame in flight at a time: a slow worker makes the film slower, never longer queues (design 10.5)
    if (this.life.is('waiting')) {
      this.wantT = t;
      return;
    }
    this.postFrame(t);
  }

  private wantT: number | undefined;

  private postFrame(t: number): void {
    const f = this.figure;
    const d = this.driver ?? worldDriverOf(f);
    const ch = this.channel as PhysicsChannel;
    const sets: [string, unknown][] = [];
    for (const o of f.objects()) {
      if (!o.free || !o.cell.defined) continue;
      if (this.sent.has(o.name) && sameValue(this.sent.get(o.name), o.cell.value)) continue;
      this.sent.set(o.name, o.cell.value);
      sets.push([o.name, o.cell.value]);
    }
    this.life.send('post');
    this.wantT = undefined;
    ch.post({ k: 'frame', seq: ++this.seq, t, sets, lines: d.takeOutbox() });
  }

  takeWarnings(): Notice[] {
    return this.warnings.splice(0, this.warnings.length);
  }

  /** Stops the worker; the page plays the world itself again. */
  stop(): void {
    this.channel?.close();
    this.channel = undefined;
    this.wantT = undefined;
    if (this.active) (this.driver ?? worldDriverOf(this.figure)).setRemote(false);
    this.driver = undefined;
    this.life.send('stop');
  }

  private receive(m: FromWorker): void {
    if (!this.active) return;
    if (m.k === 'error') {
      this.crashed();
      return;
    }
    const t0 = this.now();
    (this.driver ?? worldDriverOf(this.figure)).accept(m.cells, m.info, m.log);
    this.figure.flush(true);
    this.copyMs = this.now() - t0;
    this.lastT = m.t;
    this.warnings.push(...m.warnings);
    if (m.seq === this.seq) this.life.send('answer');
    if (!this.life.is('waiting') && this.wantT !== undefined) this.postFrame(this.wantT);
  }

  private crashed(): void {
    this.stop();
    this.life.send('fail');
    this.warnings.push(physics.makeNotice('worker_crashed', {}, []));
  }
}

/** A channel to the real worker, or `undefined` where the page has none. */
export function browserPhysicsChannel(): PhysicsChannel | undefined {
  const W = (globalThis as { Worker?: new (url: URL, opts: { type: 'module' }) => Worker }).Worker;
  if (typeof W !== 'function') return undefined;
  let w: Worker;
  try {
    w = new W(new URL('./physics.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return undefined;
  }
  return {
    post: (m) => w.postMessage(m),
    onMessage: (cb) => {
      w.onmessage = (e: MessageEvent<FromWorker>): void => cb(e.data);
    },
    onError: (cb) => {
      w.onerror = (e): void => cb(e.message);
    },
    close: () => w.terminate(),
  };
}
