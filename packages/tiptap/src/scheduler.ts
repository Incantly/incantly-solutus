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
  /** True while an execution instance exists or is starting. */
  readonly isLive: boolean;
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
}

const defaultObserver: ObserverFactory = (callback, rootMargin) => new IntersectionObserver((entries) => callback(entries), { rootMargin });

export class LiveFigureScheduler {
  readonly stats: SchedulerStats = { registered: 0, near: 0, live: 0, mounts: 0, suspends: 0, peakLive: 0 };
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

  /** The learner asked for this figure (a click or Enter): mount it now, making room if needed. */
  activate(figure: ScheduledFigure): void {
    if (!this.figures.has(figure.element) || !figure.canRun) return;
    this.touch(figure);
    this.pinned.add(figure);
    if (!figure.isLive) {
      this.makeRoom(1, figure);
      this.start(figure);
    }
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
    // Near figures that can run, most recently used first, then in document order.
    const order = [...this.figures.values()];
    const candidates = order
      .filter((f) => this.near.has(f) && !f.isLive && f.canRun)
      .sort((a, b) => (this.lastUsed.get(b) ?? 0) - (this.lastUsed.get(a) ?? 0) || order.indexOf(a) - order.indexOf(b));
    for (const figure of candidates) {
      if (this.live().length >= this.limit && !this.makeRoom(1, figure)) break;
      this.start(figure);
    }
    this.scheduleSuspensions();
  }

  /** Suspends away figures to free `count` slots for `forFigure`. Returns false if it cannot. */
  private makeRoom(count: number, forFigure: ScheduledFigure): boolean {
    let free = this.limit - this.live().length;
    if (free >= count) return true;
    const victims = this.live()
      .filter((f) => f !== forFigure && !this.pinned.has(f))
      .sort((a, b) => {
        // Away before near, then least recently used.
        const away = Number(this.near.has(a)) - Number(this.near.has(b));
        return away || (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0);
      });
    for (const victim of victims) {
      if (free >= count) break;
      // Only away figures, or near ones displaced by an explicit activation, give up their slot.
      if (this.near.has(victim) && !this.pinned.has(forFigure)) break;
      void this.suspend(victim);
      free++;
    }
    return free >= count;
  }

  private start(figure: ScheduledFigure): void {
    this.awaySince.delete(figure);
    figure.mount();
    this.stats.mounts++;
    this.updateLiveStats();
  }

  private async suspend(figure: ScheduledFigure): Promise<void> {
    this.awaySince.delete(figure);
    this.pinned.delete(figure);
    this.stats.suspends++;
    const done = figure.suspend();
    this.updateLiveStats();
    await done;
    this.updateLiveStats();
  }

  private live(): ScheduledFigure[] {
    return [...this.figures.values()].filter((f) => f.isLive);
  }

  private updateLiveStats(): void {
    this.stats.live = this.live().length;
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
