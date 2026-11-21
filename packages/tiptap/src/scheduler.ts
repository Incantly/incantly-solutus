/**
 * One scheduler per editor: a `SchedulerHost` from the view package, the node views it orders, and a hard cap on how
 * many figures hold a mounted app (`liveLimit`). The host decides who is near, live, paused or saved
 * (docs/design/performance.md section 4); this file routes its orders to node views.
 */
import { DEFAULT_SCHEDULER_CONFIG, SchedulerHost } from '@incantly/view';
import type { FigureRecord, SchedulerAction } from '@incantly/view';

/** What the scheduler needs from a node view. */
export interface SchedulerView {
  readonly dom: HTMLElement;
  /** True while the view holds, or is about to hold, a mounted app. */
  readonly wantsMount: boolean;
  /** Mount if there is room, then wait for a live order. */
  build(): void;
  goLive(): void;
  pause(): void;
  /** Take the picture, keep the state, free the app. */
  save(): void;
  /** Mount again from the saved state. */
  restore(): void;
}

export class EditorScheduler {
  readonly host: SchedulerHost;
  private readonly views = new Map<string, SchedulerView>();
  private readonly doc: Document;
  private seq = 0;
  private disposed = false;
  private readonly fallback: boolean;
  private fallbackTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly liveLimit: number, doc: Document = document) {
    this.doc = doc;
    this.host = new SchedulerHost({ ...DEFAULT_SCHEDULER_CONFIG, maxLive: liveLimit }, { onAction: (a, r) => this.route(a, r) });
    this.fallback = typeof IntersectionObserver === 'undefined';
    this.host.start();
    this.doc.addEventListener('scroll', this.onScroll, true);
    if (this.fallback) this.doc.defaultView?.addEventListener('resize', this.onScroll);
  }

  /** Registers a node view; returns its key in the scheduler. */
  register(view: SchedulerView): string {
    const key = `fig${++this.seq}`;
    this.views.set(key, view);
    if (this.disposed) return key;
    if (this.fallback) {
      this.host.register(key);
      this.measure();
    } else this.host.observe(key, view.dom);
    return key;
  }

  unregister(key: string, view: SchedulerView): void {
    if (this.views.get(key) !== view) return;
    this.views.delete(key);
    try {
      this.host.unobserve(view.dom);
    } catch {
      // not observed (the fallback path)
    }
    this.host.unregister(key);
    if (this.fallback) this.measure();
  }

  /** True while another figure may take a mounted app. */
  hasRoom(me?: SchedulerView): boolean {
    return this.mountedCount(me) < this.liveLimit;
  }

  /**
   * Makes room for `me` to mount: while the cap is reached, the least recently used mounted figure that is not live
   * saves its state and frees its app. Returns `false` when every mounted figure is live.
   */
  makeRoom(me: SchedulerView): boolean {
    for (let guard = 0; guard < this.views.size + 1; guard++) {
      if (this.hasRoom(me)) return true;
      let victim: { key: string; view: SchedulerView; used: number } | undefined;
      for (const [key, view] of this.views) {
        if (view === me || !view.wantsMount) continue;
        const rec = this.host.state.figures.get(key);
        if (rec?.state === 'live') continue;
        const used = rec?.lastUsedMs ?? 0;
        if (!victim || used < victim.used) victim = { key, view, used };
      }
      if (!victim) return false;
      victim.view.save();
    }
    return this.hasRoom(me);
  }

  mountedCount(except?: SchedulerView): number {
    let n = 0;
    for (const v of this.views.values()) if (v !== except && v.wantsMount) n++;
    return n;
  }

  keyOf(view: SchedulerView): string | undefined {
    for (const [k, v] of this.views) if (v === view) return k;
    return undefined;
  }

  stateOf(view: SchedulerView): FigureRecord | undefined {
    const k = this.keyOf(view);
    return k === undefined ? undefined : this.host.state.figures.get(k);
  }

  /** Runs one scheduler tick now (tests, and hosts that move figures without a scroll). */
  tick(): void {
    if (this.fallback) this.measure();
    this.host.tick();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.doc.removeEventListener('scroll', this.onScroll, true);
    this.doc.defaultView?.removeEventListener('resize', this.onScroll);
    if (this.fallbackTimer !== undefined) clearTimeout(this.fallbackTimer);
    this.host.stop();
    this.views.clear();
  }

  private route(action: SchedulerAction, _record: FigureRecord): void {
    if (this.disposed) return;
    const view = this.views.get(action.id);
    if (!view) return;
    try {
      if (action.k === 'build') view.build();
      else if (action.k === 'goLive') view.goLive();
      else if (action.k === 'pause') view.pause();
      else if (action.k === 'save') view.save();
      else view.restore();
    } catch {
      // an order a node view cannot follow never stops the others
    }
  }

  private readonly onScroll = (): void => {
    if (this.disposed) return;
    this.host.noteScroll();
    if (this.fallback) {
      if (this.fallbackTimer !== undefined) clearTimeout(this.fallbackTimer);
      this.fallbackTimer = setTimeout(() => this.measure(), 50);
    }
  };

  /** Without IntersectionObserver: which figures are in view or near it, from their boxes. */
  private measure(): void {
    const view = this.doc.defaultView;
    const vh = view?.innerHeight ?? 0;
    const near = DEFAULT_SCHEDULER_CONFIG.nearPx;
    const visible = new Set<string>();
    const nearSet = new Set<string>();
    for (const [key, v] of this.views) {
      const r = v.dom.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.bottom > 0 && r.top < vh) visible.add(key);
      if (r.bottom > -near && r.top < vh + near) nearSet.add(key);
    }
    this.host.setVisible(visible);
    this.host.setNear(nearSet);
    this.host.tick();
  }
}
