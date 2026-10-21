/**
 * The live-figure scheduler (HO-4 to HO-6). One per editor. It watches every
 * figure node with one shared observer and decides which may be live: those
 * near the viewport, at most `limit` at a time, the most recently used first.
 * A live figure that leaves the viewport is paused at once and, after a grace
 * period, suspended: snapshot taken, state saved, instance destroyed.
 */

export interface ObserverLike {
  observe(element: Element): void;
  unobserve(element: Element): void;
  disconnect(): void;
}

export type ObserverFactory = (
  callback: (entries: ReadonlyArray<{ readonly target: Element; readonly isIntersecting: boolean }>) => void,
  rootMargin: string,
) => ObserverLike;

export interface SchedulerOptions {
  /** Most figures live at once. */
  readonly limit?: number;
  /** How far beyond the viewport a figure may prepare. */
  readonly rootMargin?: string;
  /** Eligibility changes wait this long, so a fast scroll mounts nothing. */
  readonly settleMs?: number;
  /** A paused, off-screen live figure is suspended after this long. */
  readonly suspendAfterMs?: number;
  readonly createObserver?: ObserverFactory;
  readonly now?: () => number;
}

/** What the scheduler needs from a node view. */
export interface ScheduledFigure {
  readonly element: Element;
  /** Starting or running: the scheduler may pause, resume or suspend it. */
  readonly isLive: boolean;
  /** Starting, running or still shutting down: it holds an execution instance and counts against the limit. */
  readonly holdsInstance: boolean;
  /** False when the figure cannot run (no fragments, failed): it stays a placeholder. */
  readonly canRun: boolean;
  mount(): void;
  pause(): void;
  resume(): void;
  suspend(): Promise<void>;
}

export interface SchedulerStats {
  registered: number;
  near: number;
  live: number;
  mounts: number;
  suspends: number;
  /** Highest number of live figures seen at once. */
  peakLive: number;
  /** Figures that drew, and how long from mount to first drawing, in milliseconds. */
  ready: number;
  readyMsTotal: number;
  readyMsMax: number;
}

const defaultObserver: ObserverFactory = (callback, rootMargin) => new IntersectionObserver((entries) => callback(entries), { rootMargin });

export class LiveFigureScheduler {
  readonly stats: SchedulerStats = {
    registered: 0,
    near: 0,
    live: 0,
    mounts: 0,
    suspends: 0,
    peakLive: 0,
    ready: 0,
    readyMsTotal: 0,
    readyMsMax: 0,
  };
  private readonly figures = new Map<Element, ScheduledFigure>();
  private readonly near = new Set<ScheduledFigure>();
  private readonly lastUsed = new Map<ScheduledFigure, number>();
  private readonly awaySince = new Map<ScheduledFigure, number>();
  private readonly pinned = new Set<ScheduledFigure>();
  private readonly observer: ObserverLike;
  private readonly limit: number;
  private readonly settleMs: number;
  private readonly suspendAfterMs: number;
  private readonly now: () => number;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(options: SchedulerOptions = {}) {
    this.limit = Math.max(1, options.limit ?? 3);
    this.settleMs = options.settleMs ?? 150;
    this.suspendAfterMs = options.suspendAfterMs ?? 8000;
    this.now = options.now ?? (() => performance.now());
    this.observer = (options.createObserver ?? defaultObserver)((entries) => this.onEntries(entries), options.rootMargin ?? '300px 0px');
  }

  register(figure: ScheduledFigure): void {
    if (this.destroyed || this.figures.has(figure.element)) return;
    this.figures.set(figure.element, figure);
    this.stats.registered = this.figures.size;
    this.observer.observe(figure.element);
  }

  unregister(figure: ScheduledFigure): void {
    if (!this.figures.delete(figure.element)) return;
    this.observer.unobserve(figure.element);
    this.near.delete(figure);
    this.lastUsed.delete(figure);
    this.awaySince.delete(figure);
    this.pinned.delete(figure);
    this.stats.registered = this.figures.size;
    this.schedule();
  }

  /** The learner used this figure: it is the last to be suspended. */
  touch(figure: ScheduledFigure): void {
    this.lastUsed.set(figure, this.now());
  }

  /** The learner asked for this figure (a click or Enter): mount it as soon as a slot is free. */
  activate(figure: ScheduledFigure): void {
    if (!this.figures.has(figure.element) || !figure.canRun) return;
    this.touch(figure);
    this.pinned.add(figure);
    if (!figure.holdsInstance) this.evaluate();
  }

  /** A mounted figure drew for the first time, `ms` after it was mounted. */
  recordReady(ms: number): void {
    this.stats.ready++;
    this.stats.readyMsTotal += ms;
    this.stats.readyMsMax = Math.max(this.stats.readyMsMax, ms);
  }

  isNear(figure: ScheduledFigure): boolean {
    return this.near.has(figure);
  }

  /** Runs the placement decision now instead of after the settle delay. */
  evaluate(): void {
    if (this.destroyed) return;
    const now = this.now();
    const live = this.live();
    // Live figures that went away pause now and are suspended after the grace period.
    for (const figure of live) {
      if (this.near.has(figure)) {
        if (this.awaySince.delete(figure)) figure.resume();
      } else if (!this.awaySince.has(figure)) {
        this.awaySince.set(figure, now);
        this.pinned.delete(figure);
        figure.pause();
      }
    }
    // Near or requested figures that can run: requested first, then most recently used, then in document order.
    const order = [...this.figures.values()];
    const candidates = order
      .filter((f) => (this.near.has(f) || this.pinned.has(f)) && !f.holdsInstance && f.canRun)
      .sort(
        (a, b) =>
          Number(this.pinned.has(b)) - Number(this.pinned.has(a)) ||
          (this.lastUsed.get(b) ?? 0) - (this.lastUsed.get(a) ?? 0) ||
          order.indexOf(a) - order.indexOf(b),
      );
    for (const figure of candidates) {
      if (this.occupied() < this.limit) {
        this.start(figure);
        continue;
      }
      // A slot frees only once a suspension has finished; evaluation runs again then.
      this.makeRoom(figure);
      break;
    }
    this.scheduleSuspensions();
  }

  /** Starts suspending one figure to make room for `forFigure`, if any may give up its slot. */
  private makeRoom(forFigure: ScheduledFigure): void {
    if (this.suspending > 0) return;
    const victim = this.live()
      .filter((f) => f !== forFigure && !this.pinned.has(f))
      .sort((a, b) => {
        // Away before near, then least recently used.
        const away = Number(this.near.has(a)) - Number(this.near.has(b));
        return away || (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0);
      })[0];
    // Only an away figure, or a near one displaced by an explicit request, gives up its slot.
    if (!victim || (this.near.has(victim) && !this.pinned.has(forFigure))) return;
    void this.suspend(victim);
  }

  private occupied(): number {
    let count = 0;
    for (const figure of this.figures.values()) if (figure.holdsInstance) count++;
    return count;
  }

  private start(figure: ScheduledFigure): void {
    this.awaySince.delete(figure);
    figure.mount();
    this.stats.mounts++;
    this.updateLiveStats();
  }

  private suspending = 0;

  private async suspend(figure: ScheduledFigure): Promise<void> {
    this.awaySince.delete(figure);
    this.pinned.delete(figure);
    this.stats.suspends++;
    this.suspending++;
    try {
      await figure.suspend();
    } finally {
      this.suspending--;
      this.updateLiveStats();
      // A slot may be free now.
      if (!this.destroyed) this.evaluate();
    }
  }

  private live(): ScheduledFigure[] {
    return [...this.figures.values()].filter((f) => f.isLive);
  }

  private updateLiveStats(): void {
    this.stats.live = this.occupied();
    this.stats.near = this.near.size;
    this.stats.peakLive = Math.max(this.stats.peakLive, this.stats.live);
  }

  private onEntries(entries: ReadonlyArray<{ readonly target: Element; readonly isIntersecting: boolean }>): void {
    for (const entry of entries) {
      const figure = this.figures.get(entry.target);
      if (!figure) continue;
      if (entry.isIntersecting) this.near.add(figure);
      else this.near.delete(figure);
    }
    this.stats.near = this.near.size;
    // Leaving is acted on at once (pause), arriving waits for the scroll to settle.
    for (const figure of this.live()) {
      if (!this.near.has(figure) && !this.awaySince.has(figure)) {
        this.awaySince.set(figure, this.now());
        this.pinned.delete(figure);
        figure.pause();
      }
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.destroyed) return;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.evaluate();
    }, this.settleMs);
  }

  private scheduleSuspensions(): void {
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
    if (this.awaySince.size === 0) return;
    const now = this.now();
    let next = Infinity;
    for (const [figure, since] of this.awaySince) {
      const due = since + this.suspendAfterMs;
      if (due <= now) void this.suspend(figure);
      else next = Math.min(next, due);
    }
    if (Number.isFinite(next)) {
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        this.scheduleSuspensions();
      }, next - now);
    }
  }

  /** Suspends every live figure (saving state), for example before the editor goes away. */
  async suspendAll(): Promise<void> {
    await Promise.all(this.live().map((figure) => this.suspend(figure)));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.observer.disconnect();
    this.figures.clear();
    this.near.clear();
    this.awaySince.clear();
    this.pinned.clear();
    this.lastUsed.clear();
  }
}
