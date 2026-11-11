/**
 * The figure scheduler's state machine (performance design 4): placeholder,
 * ready, live, paused and saved-as-a-picture, with the live cap of 3, the
 * 8 s picture rule and the scroll-settle gate. Pure: the host passes
 * timestamps and visibility; this file never reads a clock or a timer.
 */

export type FigureState = 'placeholder' | 'ready' | 'live' | 'paused' | 'saved';

export interface SchedulerConfig {
  /** At most 3 live figures at once. */
  readonly maxLive: number;
  /** A figure within 300 px of the viewport is "near". */
  readonly nearPx: number;
  /** State changes wait for the scroll to settle for 150 ms. */
  readonly settleMs: number;
  /** Paused and off screen for 8 s, a figure is saved as a picture. */
  readonly saveMs: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  maxLive: 3,
  nearPx: 300,
  settleMs: 150,
  saveMs: 8000,
};

export interface FigureRecord {
  readonly id: string;
  state: FigureState;
  /** Last learner touch (pointer, keyboard); MRU order pauses the oldest. */
  lastUsedMs: number;
  /** Since when the figure has been continuously near (for the settle gate). */
  nearSinceMs: number | null;
  /** Since when paused and off screen (for the 8 s rule). */
  pausedOffscreenSinceMs: number | null;
  /** A figure playing a film is pinned while in view. */
  playing: boolean;
  inView: boolean;
  near: boolean;
  mountedAtMs: number | null;
  firstDrawMs: number | null;
}

export interface SchedulerStats {
  registered: number;
  near: number;
  live: number;
  peakLive: number;
  mounts: number;
  saves: number;
  /** Time from mount to first drawing per figure, in ms. */
  mountToFirstMs: number[];
}

export function createSchedulerStats(): SchedulerStats {
  return { registered: 0, near: 0, live: 0, peakLive: 0, mounts: 0, saves: 0, mountToFirstMs: [] };
}

export class SchedulerState {
  readonly figures = new Map<string, FigureRecord>();
  readonly stats: SchedulerStats = createSchedulerStats();
}

export type SchedulerAction =
  | { readonly k: 'build'; readonly id: string }
  | { readonly k: 'goLive'; readonly id: string }
  | { readonly k: 'pause'; readonly id: string }
  | { readonly k: 'save'; readonly id: string }
  | { readonly k: 'restore'; readonly id: string };

export function registerFigure(state: SchedulerState, id: string): void {
  if (state.figures.has(id)) return;
  state.figures.set(id, {
    id,
    state: 'placeholder',
    lastUsedMs: 0,
    nearSinceMs: null,
    pausedOffscreenSinceMs: null,
    playing: false,
    inView: false,
    near: false,
    mountedAtMs: null,
    firstDrawMs: null,
  });
  state.stats.registered = state.figures.size;
}

export function unregisterFigure(state: SchedulerState, id: string): void {
  state.figures.delete(id);
  state.stats.registered = state.figures.size;
}

export function touchFigure(state: SchedulerState, id: string, nowMs: number): void {
  const f = state.figures.get(id);
  if (f !== undefined) f.lastUsedMs = nowMs;
}

export function setPlaying(state: SchedulerState, id: string, playing: boolean): void {
  const f = state.figures.get(id);
  if (f !== undefined) f.playing = playing;
}

export function noteMounted(state: SchedulerState, id: string, nowMs: number): void {
  const f = state.figures.get(id);
  if (f === undefined || f.mountedAtMs !== null) return;
  f.mountedAtMs = nowMs;
  state.stats.mounts++;
}

export function noteFirstDraw(state: SchedulerState, id: string, nowMs: number): void {
  const f = state.figures.get(id);
  if (f === undefined || f.mountedAtMs === null || f.firstDrawMs !== null) return;
  f.firstDrawMs = nowMs;
  state.stats.mountToFirstMs.push(nowMs - f.mountedAtMs);
}

export interface TickInput {
  readonly nowMs: number;
  /** Figures currently in the viewport. */
  readonly visible: ReadonlySet<string>;
  /** Figures within `nearPx` of the viewport. */
  readonly near: ReadonlySet<string>;
  /** True once the scroll has settled for `settleMs`. */
  readonly scrollSettled: boolean;
  readonly tabVisible: boolean;
}

/**
 * One scheduler tick. Applies, in order: visibility updates, immediate leaves
 * (viewport exit, hidden tab), the settle-gated build to `ready`, MRU-capped
 * promotion to `live`, and the 8 s save rule. Returns host actions.
 */
export function schedulerTick(
  state: SchedulerState,
  input: TickInput,
  config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG,
): SchedulerAction[] {
  const actions: SchedulerAction[] = [];
  // 1. Visibility bookkeeping.
  for (const f of state.figures.values()) {
    f.inView = input.visible.has(f.id);
    const wasNear = f.near;
    f.near = input.near.has(f.id) || f.inView;
    if (f.near && !wasNear) f.nearSinceMs = input.nowMs;
    if (!f.near) f.nearSinceMs = null;
  }
  // 2. Immediate leaves: a figure leaves `live` at once when it leaves the
  // viewport or the tab is hidden.
  for (const f of state.figures.values()) {
    if (f.state === 'live' && (!f.inView || !input.tabVisible)) {
      f.state = 'paused';
      f.pausedOffscreenSinceMs = !f.inView ? input.nowMs : null;
      actions.push({ k: 'pause', id: f.id });
    }
  }
  // 3. Settle-gated builds: placeholder/saved and near, after the scroll
  // settles, become ready. A fast scroll past many figures builds none.
  if (input.scrollSettled) {
    for (const f of state.figures.values()) {
      if ((f.state === 'placeholder' || f.state === 'saved') && f.near &&
        f.nearSinceMs !== null && input.nowMs - f.nearSinceMs >= config.settleMs) {
        const wasSaved = f.state === 'saved';
        f.state = 'ready';
        f.pausedOffscreenSinceMs = null;
        actions.push(wasSaved ? { k: 'restore', id: f.id } : { k: 'build', id: f.id });
      }
    }
  }
  // 4. Promotion to `live`: in view, ready or paused, among the MRU cap.
  // Playing figures are pinned while in view.
  const liveNow = [...state.figures.values()].filter((f) => f.state === 'live');
  const wantLive = [...state.figures.values()].filter(
    (f) => f.inView && input.tabVisible && (f.state === 'ready' || f.state === 'paused'),
  );
  wantLive.sort((a, b) => {
    if (a.playing !== b.playing) return a.playing ? -1 : 1;
    return b.lastUsedMs - a.lastUsedMs;
  });
  for (const f of wantLive) {
    const liveCount = [...state.figures.values()].filter((g) => g.state === 'live').length;
    if (liveCount >= config.maxLive) {
      // Pause the least-recently-used live figure that is not pinned.
      const pausable = [...state.figures.values()]
        .filter((g) => g.state === 'live' && !(g.playing && g.inView))
        .sort((a, b) => a.lastUsedMs - b.lastUsedMs);
      const victim = pausable[0];
      if (victim === undefined) break;
      // A figure the learner touched last is the last to be paused.
      if (victim.lastUsedMs > f.lastUsedMs && !f.playing) break;
      victim.state = 'paused';
      victim.pausedOffscreenSinceMs = !victim.inView ? input.nowMs : null;
      actions.push({ k: 'pause', id: victim.id });
    }
    f.state = 'live';
    f.pausedOffscreenSinceMs = null;
    actions.push({ k: 'goLive', id: f.id });
  }
  void liveNow;
  // 5. The 8 s picture rule, for every figure, 2D and 3D.
  for (const f of state.figures.values()) {
    if (f.state !== 'paused' || f.inView) {
      if (f.inView) f.pausedOffscreenSinceMs = null;
      continue;
    }
    if (f.pausedOffscreenSinceMs === null) f.pausedOffscreenSinceMs = input.nowMs;
    if (input.nowMs - f.pausedOffscreenSinceMs >= config.saveMs) {
      f.state = 'saved';
      f.pausedOffscreenSinceMs = null;
      state.stats.saves++;
      actions.push({ k: 'save', id: f.id });
    }
  }
  // 6. Stats.
  const near = [...state.figures.values()].filter((f) => f.near).length;
  const live = [...state.figures.values()].filter((f) => f.state === 'live').length;
  state.stats.near = near;
  state.stats.live = live;
  if (live > state.stats.peakLive) state.stats.peakLive = live;
  return actions;
}
