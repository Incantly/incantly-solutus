/**
 * The page's side of the physics worker (docs/features/physics/design.md 9.6, 11.2; errors.md 5, 7): a figure with
 * liquid hands its world to the worker; each frame the page sends the time, the free values that changed and its new
 * `@input` lines, and writes the cells that come back. Without a worker the same steps run on the page, with the notice
 * `worker_unavailable` once; if the worker stops, the page takes the world back from its start (`worker_crashed`).
 * Either way the film is the same.
 */
import { physics, physicsOf, sameValue } from '@incantly/kernel';
import type { Figure, Notice } from '@incantly/kernel';
import type { FromWorker, ToWorker } from './physics-worker';

/** A way to talk to a worker: a real `Worker`, or a channel that runs the handler in the same thread (tests). */
export interface PhysicsChannel {
  post(m: ToWorker): void;
  onMessage(cb: (m: FromWorker) => void): void;
  onError(cb: (why: string) => void): void;
  close(): void;
}

export class PhysicsWorkerHost {
  private channel: PhysicsChannel | undefined;
  private active = false;
  private told = false;
  private version = -1;
  private seq = 0;
  private sent = new Map<string, unknown>();
  private warnings: Notice[] = [];
  /** The time of the last frame the worker answered, and how long the copy of its cells took on the page (ms). */
  lastT = Number.NaN;
  copyMs = 0;

  constructor(private readonly figure: Figure, private readonly makeChannel: () => PhysicsChannel | undefined, private readonly now: () => number = () => 0) {}

  /** True while the world runs in the worker. */
  get running(): boolean {
    return this.active;
  }

  /** Before the page's frame at film time t. */
  frame(t: number): void {
    const f = this.figure;
    const wants = f.objects().some((o) => o.type === 'Liquid');
    const d = physicsOf(f);
    if (!wants) {
      if (this.active) this.stop();
      return;
    }
    if (!this.active) {
      if (this.told && !this.channel) return;
      const ch = this.makeChannel();
      if (!ch) {
        this.told = true;
        this.warnings.push(physics.makeNotice('worker_unavailable', {}, []));
        return;
      }
      this.channel = ch;
      ch.onMessage((m) => this.receive(m));
      ch.onError(() => this.crashed());
      this.active = true;
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
    if (this.waiting) {
      this.wantT = t;
      return;
    }
    this.postFrame(t);
  }

  private waiting = false;
  private wantT: number | undefined;

  private postFrame(t: number): void {
    const f = this.figure;
    const d = physicsOf(f);
    const ch = this.channel as PhysicsChannel;
    const sets: [string, unknown][] = [];
    for (const o of f.objects()) {
      if (!o.free || !o.cell.defined) continue;
      if (this.sent.has(o.name) && sameValue(this.sent.get(o.name), o.cell.value)) continue;
      this.sent.set(o.name, o.cell.value);
      sets.push([o.name, o.cell.value]);
    }
    this.waiting = true;
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
    this.waiting = false;
    this.wantT = undefined;
    if (this.active) physicsOf(this.figure).setRemote(false);
    this.active = false;
  }

  private receive(m: FromWorker): void {
    if (!this.active) return;
    if (m.k === 'error') {
      this.crashed();
      return;
    }
    const t0 = this.now();
    physicsOf(this.figure).accept(m.cells, m.info);
    this.figure.flush(true);
    this.copyMs = this.now() - t0;
    this.lastT = m.t;
    this.warnings.push(...m.warnings);
    if (m.seq === this.seq) this.waiting = false;
    if (!this.waiting && this.wantT !== undefined) this.postFrame(this.wantT);
  }

  private crashed(): void {
    this.stop();
    this.told = true;
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
