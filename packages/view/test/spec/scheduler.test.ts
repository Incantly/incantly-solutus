/**
 * performance.md 4 (many figures on one page): the figure states, the cap of
 * 3 live figures, the 150 ms settle gate, the 8 s picture rule, pinned
 * playing figures, and the scheduler stats of section 6.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULER_CONFIG,
  SchedulerState,
  noteFirstDraw,
  noteMounted,
  registerFigure,
  schedulerTick,
  setPlaying,
  touchFigure,
  unregisterFigure,
} from '@incantly/view';
import type { SchedulerAction, TickInput } from '@incantly/view';

function setOf(...ids: string[]): ReadonlySet<string> {
  return new Set(ids);
}

function tick(
  state: SchedulerState,
  nowMs: number,
  over: Partial<TickInput> = {},
): SchedulerAction[] {
  return schedulerTick(state, {
    nowMs, visible: setOf(), near: setOf(), scrollSettled: true, tabVisible: true, ...over,
  });
}

const stateOf = (s: SchedulerState, id: string): string | undefined => s.figures.get(id)?.state;

/** Bring figures to `live` by ticking with them visible (and near). */
function goLive(s: SchedulerState, ids: string[], nowMs: number): void {
  for (let i = 0; i < 4; i += 1) {
    tick(s, nowMs + i * 200, { visible: new Set(ids), near: new Set(ids) });
  }
}

describe('performance 4 configuration', () => {
  it('4 defaults: 3 live figures, 300 px near, 150 ms settle, 8 s to save', () => {
    expect(DEFAULT_SCHEDULER_CONFIG.maxLive).toBe(3);
    expect(DEFAULT_SCHEDULER_CONFIG.nearPx).toBe(300);
    expect(DEFAULT_SCHEDULER_CONFIG.settleMs).toBe(150);
    expect(DEFAULT_SCHEDULER_CONFIG.saveMs).toBe(8000);
  });
});

describe('performance 4 figure states', () => {
  it('4 a figure starts as a placeholder holding the saved picture', () => {
    const s = new SchedulerState();
    registerFigure(s, 'f1');
    expect(stateOf(s, 'f1')).toBe('placeholder');
    expect(tick(s, 0)).toEqual([]);
    expect(stateOf(s, 'f1')).toBe('placeholder');
  });

  it('4 registering twice keeps one record; unregistering removes it', () => {
    const s = new SchedulerState();
    registerFigure(s, 'f1');
    registerFigure(s, 'f1');
    expect(s.figures.size).toBe(1);
    unregisterFigure(s, 'f1');
    expect(s.figures.size).toBe(0);
  });

  it('4 near the viewport with a settled scroll builds the figure (ready)', () => {
    const s = new SchedulerState();
    registerFigure(s, 'f1');
    const actions = [...tick(s, 0, { near: setOf('f1') }), ...tick(s, 200, { near: setOf('f1') })];
    expect(actions.some((a) => a.k === 'build' && a.id === 'f1')).toBe(true);
    expect(stateOf(s, 'f1')).toBe('ready');
  });

  it('4 a fast scroll past a figure builds none of them while the scroll is unsettled', () => {
    const s = new SchedulerState();
    for (const id of ['a', 'b', 'c', 'd', 'e']) registerFigure(s, id);
    for (let t = 0; t < 600; t += 50) {
      const actions = tick(s, t, { near: setOf('a', 'b', 'c', 'd', 'e'), scrollSettled: false });
      expect(actions.filter((a) => a.k === 'build')).toEqual([]);
    }
    for (const id of ['a', 'b', 'c', 'd', 'e']) expect(stateOf(s, id)).toBe('placeholder');
  });

  it('4 once the scroll settles the near figures are built', () => {
    const s = new SchedulerState();
    registerFigure(s, 'a');
    tick(s, 0, { near: setOf('a'), scrollSettled: false });
    expect(stateOf(s, 'a')).toBe('placeholder');
    tick(s, 400, { near: setOf('a'), scrollSettled: true });
    expect(stateOf(s, 'a')).not.toBe('placeholder');
  });

  it('4 a figure that is in view and recently used becomes live', () => {
    const s = new SchedulerState();
    registerFigure(s, 'f1');
    goLive(s, ['f1'], 0);
    expect(stateOf(s, 'f1')).toBe('live');
  });

  it('4 live is issued as a goLive action, once', () => {
    const s = new SchedulerState();
    registerFigure(s, 'f1');
    const all: SchedulerAction[] = [];
    for (let i = 0; i < 6; i += 1) all.push(...tick(s, i * 200, { visible: setOf('f1'), near: setOf('f1') }));
    expect(all.filter((a) => a.k === 'goLive' && a.id === 'f1')).toHaveLength(1);
    expect(all.filter((a) => a.k === 'build' && a.id === 'f1')).toHaveLength(1);
  });

  it('4 a live figure that leaves the viewport is paused at once', () => {
    const s = new SchedulerState();
    registerFigure(s, 'f1');
    goLive(s, ['f1'], 0);
    const actions = tick(s, 2000, { visible: setOf(), near: setOf() });
    expect(actions.some((a) => a.k === 'pause' && a.id === 'f1')).toBe(true);
    expect(stateOf(s, 'f1')).toBe('paused');
  });

  it('4 a live figure is paused at once when the tab is hidden', () => {
    const s = new SchedulerState();
    registerFigure(s, 'f1');
    goLive(s, ['f1'], 0);
    const actions = tick(s, 2000, { visible: setOf('f1'), near: setOf('f1'), tabVisible: false });
    expect(actions.some((a) => a.k === 'pause' && a.id === 'f1')).toBe(true);
    expect(stateOf(s, 'f1')).toBe('paused');
  });

  it('4 leaving the viewport does not wait for the scroll to settle', () => {
    const s = new SchedulerState();
    registerFigure(s, 'f1');
    goLive(s, ['f1'], 0);
    tick(s, 2000, { visible: setOf(), near: setOf(), scrollSettled: false });
    expect(stateOf(s, 'f1')).toBe('paused');
  });
});

describe('performance 4 the live cap', () => {
  function fourVisible(): SchedulerState {
    const s = new SchedulerState();
    for (const id of ['a', 'b', 'c', 'd']) registerFigure(s, id);
    return s;
  }

  it('4 at most 3 figures are live at once, however many are visible', () => {
    const s = fourVisible();
    goLive(s, ['a', 'b', 'c', 'd'], 0);
    const live = [...s.figures.values()].filter((f) => f.state === 'live');
    expect(live.length).toBeLessThanOrEqual(3);
    expect(live.length).toBe(3);
  });

  it('4 the stats track the peak number of live figures (never above 3)', () => {
    const s = fourVisible();
    goLive(s, ['a', 'b', 'c', 'd'], 0);
    expect(s.stats.peakLive).toBe(3);
    expect(s.stats.live).toBe(3);
  });

  it('4 the least recently used live figure is paused when a 4th becomes live', () => {
    const s = fourVisible();
    touchFigure(s, 'a', 100);
    touchFigure(s, 'b', 200);
    touchFigure(s, 'c', 300);
    goLive(s, ['a', 'b', 'c'], 400);
    expect(['a', 'b', 'c'].map((id) => stateOf(s, id))).toEqual(['live', 'live', 'live']);
    touchFigure(s, 'd', 5000);
    const actions: SchedulerAction[] = [];
    for (let i = 0; i < 4; i += 1) {
      actions.push(...tick(s, 5100 + i * 200, { visible: setOf('a', 'b', 'c', 'd'), near: setOf('a', 'b', 'c', 'd') }));
    }
    expect(stateOf(s, 'd')).toBe('live');
    expect(stateOf(s, 'a')).toBe('paused');
    expect(actions.some((a) => a.k === 'pause' && a.id === 'a')).toBe(true);
  });

  it('4 the figure the learner touched last is the last to be paused', () => {
    const s = fourVisible();
    goLive(s, ['a', 'b', 'c'], 0);
    touchFigure(s, 'a', 3000);
    touchFigure(s, 'd', 3100);
    for (let i = 0; i < 4; i += 1) {
      tick(s, 3200 + i * 200, { visible: setOf('a', 'b', 'c', 'd'), near: setOf('a', 'b', 'c', 'd') });
    }
    expect(stateOf(s, 'a')).toBe('live');
    expect(stateOf(s, 'd')).toBe('live');
    // b and c were not touched, so the oldest of them is the one that gave way.
    expect([stateOf(s, 'b'), stateOf(s, 'c')].filter((x) => x === 'paused')).toHaveLength(1);
  });

  it('4 a figure that is playing a film is pinned and is not paused for the limit', () => {
    const s = fourVisible();
    goLive(s, ['a', 'b', 'c'], 0);
    setPlaying(s, 'a', true);
    touchFigure(s, 'a', 0);
    touchFigure(s, 'b', 2900);
    touchFigure(s, 'c', 2950);
    touchFigure(s, 'd', 3000);
    for (let i = 0; i < 4; i += 1) {
      tick(s, 3100 + i * 200, { visible: setOf('a', 'b', 'c', 'd'), near: setOf('a', 'b', 'c', 'd') });
    }
    expect(stateOf(s, 'a')).toBe('live');
  });

  it('4 a playing figure that leaves the view is still paused (pinned only while in view)', () => {
    const s = fourVisible();
    goLive(s, ['a'], 0);
    setPlaying(s, 'a', true);
    tick(s, 2000, { visible: setOf(), near: setOf() });
    expect(stateOf(s, 'a')).toBe('paused');
  });
});

describe('performance 4 saving as a picture', () => {
  function pausedFigure(): SchedulerState {
    const s = new SchedulerState();
    registerFigure(s, 'f1');
    goLive(s, ['f1'], 0);
    tick(s, 2000, { visible: setOf(), near: setOf() });
    expect(stateOf(s, 'f1')).toBe('paused');
    return s;
  }

  it('4 paused and off screen for under 8 s stays paused', () => {
    const s = pausedFigure();
    const actions = tick(s, 2000 + 7900, { visible: setOf(), near: setOf() });
    expect(actions.filter((a) => a.k === 'save')).toEqual([]);
    expect(stateOf(s, 'f1')).toBe('paused');
  });

  it('4 paused and off screen for 8 s is saved as a picture (every figure, 2D and 3D)', () => {
    const s = pausedFigure();
    tick(s, 2100, { visible: setOf(), near: setOf() });
    const actions = tick(s, 2100 + 8000, { visible: setOf(), near: setOf() });
    expect(actions.some((a) => a.k === 'save' && a.id === 'f1')).toBe(true);
    expect(stateOf(s, 'f1')).toBe('saved');
    expect(s.stats.saves).toBe(1);
  });

  it('4 saving happens once, not on every later tick', () => {
    const s = pausedFigure();
    tick(s, 2100, { visible: setOf(), near: setOf() });
    tick(s, 11000, { visible: setOf(), near: setOf() });
    const later = tick(s, 20000, { visible: setOf(), near: setOf() });
    expect(later.filter((a) => a.k === 'save')).toEqual([]);
    expect(s.stats.saves).toBe(1);
  });

  it('4 a saved figure that returns to view is restored before it draws live', () => {
    const s = pausedFigure();
    tick(s, 2100, { visible: setOf(), near: setOf() });
    tick(s, 11000, { visible: setOf(), near: setOf() });
    expect(stateOf(s, 'f1')).toBe('saved');
    const all: SchedulerAction[] = [];
    for (let i = 0; i < 5; i += 1) {
      all.push(...tick(s, 12000 + i * 200, { visible: setOf('f1'), near: setOf('f1') }));
    }
    const kinds = all.filter((a) => a.id === 'f1').map((a) => a.k);
    expect(kinds).toContain('restore');
    expect(kinds).toContain('goLive');
    expect(kinds.indexOf('restore')).toBeLessThan(kinds.indexOf('goLive'));
    expect(stateOf(s, 'f1')).toBe('live');
  });

  it('4 a paused figure that comes back before 8 s resumes live without a restore', () => {
    const s = pausedFigure();
    const all: SchedulerAction[] = [];
    for (let i = 0; i < 4; i += 1) {
      all.push(...tick(s, 3000 + i * 200, { visible: setOf('f1'), near: setOf('f1') }));
    }
    expect(all.some((a) => a.k === 'restore')).toBe(false);
    expect(stateOf(s, 'f1')).toBe('live');
  });

  it('4 a paused figure still in view (tab hidden) is not saved after 8 s on screen', () => {
    const s = new SchedulerState();
    registerFigure(s, 'f1');
    goLive(s, ['f1'], 0);
    tick(s, 2000, { visible: setOf('f1'), near: setOf('f1'), tabVisible: false });
    const actions = tick(s, 20000, { visible: setOf('f1'), near: setOf('f1'), tabVisible: false });
    expect(actions.filter((a) => a.k === 'save')).toEqual([]);
  });
});

describe('performance 6 scheduler stats', () => {
  it('6 stats count registered, near and live figures', () => {
    const s = new SchedulerState();
    for (const id of ['a', 'b', 'c']) registerFigure(s, id);
    expect(s.stats.registered).toBe(3);
    tick(s, 0, { near: setOf('a', 'b'), visible: setOf('a') });
    expect(s.stats.near).toBeGreaterThanOrEqual(2);
    unregisterFigure(s, 'c');
    expect(s.stats.registered).toBe(2);
  });

  it('6 mounts are counted when a figure is mounted', () => {
    const s = new SchedulerState();
    registerFigure(s, 'a');
    noteMounted(s, 'a', 10);
    expect(s.stats.mounts).toBe(1);
  });

  it('6 the time from mount to first drawing is recorded in ms', () => {
    const s = new SchedulerState();
    registerFigure(s, 'a');
    noteMounted(s, 'a', 1000);
    noteFirstDraw(s, 'a', 1042);
    expect(s.stats.mountToFirstMs).toEqual([42]);
  });

  it('6 only the first drawing after a mount is timed', () => {
    const s = new SchedulerState();
    registerFigure(s, 'a');
    noteMounted(s, 'a', 1000);
    noteFirstDraw(s, 'a', 1042);
    noteFirstDraw(s, 'a', 1100);
    expect(s.stats.mountToFirstMs).toEqual([42]);
  });

  it('1 a still figure costs no actions at all once settled (zero frames after first drawing)', () => {
    const s = new SchedulerState();
    registerFigure(s, 'a');
    goLive(s, ['a'], 0);
    const quiet = tick(s, 5000, { visible: setOf('a'), near: setOf('a') });
    expect(quiet).toEqual([]);
  });
});
