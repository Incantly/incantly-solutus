/**
 * The scheduler host: one per page (per editor in TipTap). Wires the pure
 * scheduler state machine to IntersectionObserver, scroll settling, tab
 * visibility and a slow tick for the 8 s picture rule.
 */
import {
  DEFAULT_SCHEDULER_CONFIG, noteFirstDraw, noteMounted, registerFigure, schedulerTick,
  setPlaying, touchFigure, unregisterFigure,
  type FigureRecord, type SchedulerAction, type SchedulerConfig, type SchedulerStats,
} from '../core/scheduler';
import { SchedulerState } from '../core/scheduler';

export interface SchedulerCallbacks {
  readonly onAction: (action: SchedulerAction, record: FigureRecord) => void;
}

export class SchedulerHost {
  readonly state = new SchedulerState();
  private readonly visible = new Set<string>();
  private readonly near = new Set<string>();
  private scrollSettled = true;
  private tabVisible = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private buildTimer: ReturnType<typeof setTimeout> | null = null;
  private ticking = false;
  private again = false;
  private viewObserver: IntersectionObserver | null = null;
  private nearObserver: IntersectionObserver | null = null;

  constructor(
    readonly config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
    readonly callbacks: SchedulerCallbacks = { onAction: (): void => undefined },
  ) {}

  register(id: string): void {
    registerFigure(this.state, id);
  }

  unregister(id: string): void {
    this.visible.delete(id);
    this.near.delete(id);
    unregisterFigure(this.state, id);
  }

  touch(id: string): void {
    touchFigure(this.state, id, Date.now());
    this.tick();
  }

  setPlaying(id: string, playing: boolean): void {
    setPlaying(this.state, id, playing);
    this.tick();
  }

  noteMounted(id: string): void {
    noteMounted(this.state, id, Date.now());
  }

  noteFirstDraw(id: string): void {
    noteFirstDraw(this.state, id, Date.now());
  }

  setVisible(ids: ReadonlySet<string>): void {
    this.visible.clear();
    for (const id of ids) this.visible.add(id);
  }

  setNear(ids: ReadonlySet<string>): void {
    this.near.clear();
    for (const id of ids) this.near.add(id);
  }

  /** Call on every scroll event; settling is detected after `settleMs` idle. */
  noteScroll(): void {
    this.scrollSettled = false;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.scrollSettled = true;
      this.tick();
    }, this.config.settleMs);
  }

  setTabVisible(visible: boolean): void {
    this.tabVisible = visible;
    this.tick();
  }

  /** Run one tick now; also called by the interval timer. */
  tick(): SchedulerAction[] {
    // A tick requested from inside an action callback (a touch, a play toggle)
    // does not run nested: the outer tick finishes dispatching the actions it
    // produced, then runs once more (V1, actions match the state they came from).
    if (this.ticking) {
      this.again = true;
      return [];
    }
    this.ticking = true;
    const all: SchedulerAction[] = [];
    try {
      let rounds = 0;
      do {
        this.again = false;
        const actions = schedulerTick(this.state, {
          nowMs: Date.now(),
          visible: this.visible,
          near: this.near,
          scrollSettled: this.scrollSettled,
          tabVisible: this.tabVisible,
        }, this.config);
        for (const a of actions) {
          const record = this.state.figures.get(a.id);
          if (record !== undefined) this.callbacks.onAction(a, record);
        }
        all.push(...actions);
        rounds++;
      } while (this.again && rounds < 4);
    } finally {
      this.ticking = false;
      this.again = false;
    }
    this.armBuildTimer();
    return all;
  }

  /**
   * A figure that became near is built `settleMs` later, not at the next
   * 500 ms interval tick (VIEW-SM-26): arm one timer for the earliest
   * pending build.
   */
  private armBuildTimer(): void {
    if (this.buildTimer !== null) {
      clearTimeout(this.buildTimer);
      this.buildTimer = null;
    }
    if (!this.scrollSettled) return;
    const now = Date.now();
    let wait = Number.POSITIVE_INFINITY;
    for (const f of this.state.figures.values()) {
      if ((f.state === 'placeholder' || f.state === 'saved') && f.near && f.nearSinceMs !== null) {
        const remaining = f.nearSinceMs + this.config.settleMs - now;
        if (remaining > 0 && remaining < wait) wait = remaining;
      }
    }
    if (!Number.isFinite(wait)) return;
    this.buildTimer = setTimeout(() => {
      this.buildTimer = null;
      this.tick();
    }, wait + 1);
  }

  stats(): SchedulerStats {
    return { ...this.state.stats, mountToFirstMs: [...this.state.stats.mountToFirstMs] };
  }

  /** Observe an element for in-view and near-view membership. */
  observe(id: string, el: Element): void {
    this.register(id);
    if (typeof IntersectionObserver === 'undefined') {
      this.visible.add(id);
      this.near.add(id);
      this.tick();
      return;
    }
    if (this.viewObserver === null || this.nearObserver === null) {
      this.viewObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset['figureId'];
          if (key === undefined) continue;
          if (e.isIntersecting) this.visible.add(key);
          else this.visible.delete(key);
        }
        this.tick();
      }, { threshold: 0 });
      this.nearObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).dataset['figureId'];
          if (key === undefined) continue;
          if (e.isIntersecting) this.near.add(key);
          else this.near.delete(key);
        }
        this.tick();
      }, { rootMargin: `${this.config.nearPx}px` });
    }
    (el as HTMLElement).dataset['figureId'] = id;
    this.viewObserver.observe(el);
    this.nearObserver.observe(el);
  }

  unobserve(el: Element): void {
    const key = (el as HTMLElement).dataset['figureId'];
    if (key !== undefined) {
      this.visible.delete(key);
      this.near.delete(key);
    }
    this.viewObserver?.unobserve(el);
    this.nearObserver?.unobserve(el);
  }

  /** Slow tick for the 8 s rule; figures never poll faster than this. */
  start(intervalMs = 500): void {
    this.stop();
    this.timer = setInterval(() => this.tick(), intervalMs);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    if (this.buildTimer !== null) {
      clearTimeout(this.buildTimer);
      this.buildTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    this.viewObserver?.disconnect();
    this.viewObserver = null;
    this.nearObserver?.disconnect();
    this.nearObserver = null;
  }

  private readonly onVisibility = (): void => {
    this.setTabVisible(typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  };
}
