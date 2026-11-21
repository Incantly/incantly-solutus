/** Mode switching and exam mode (.kiro/specs/app-modes R4, R5). */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, registerFunctions, registerLists, registerNumbers, registerStatistics } from '@incantly/kernel';
import { EXAM_NOTE, EXAM_PROFILES, ExamController, MODES, Settings, awayOf, catalogueOf, compilePolicy, makeGate, sha256, switchMode } from '../../src/index';
import type { ExamFigure, StorageLike } from '../../src/index';

const REG = (() => {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerLists(r);
  registerStatistics(r);
  return r;
})();
const CAT = catalogueOf(REG.all());

class MemStore implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const graphingFigure = (): Figure => {
  const f = new Figure({ commands: REG });
  for (const l of ['a = 2 in 0..5', 'f(x) = a * x^2', 'd = Derivative(f)', 'T = Tangent(f, 1)', 'n = 3 + 4', 'm = Mean([1, 2, 3])']) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${r.message}`);
  }
  return f;
};

describe('switching modes (R4)', () => {
  it('sha256 matches the standard vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('é π')).toHaveLength(64);
  });

  it('a dry run lists what would be dropped, with reasons, and changes nothing', () => {
    const f = graphingFigure();
    const before = f.toScript();
    const r = switchMode(f, MODES.graphing, MODES.scientific, { catalogue: CAT });
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('mode_switch_loses_objects');
    expect(r.dropped.map((d) => d.name).sort()).toEqual(['T', 'd', 'f']);
    expect(r.dropped.find((d) => d.name === 'd')?.reason).toMatch(/built from f|Derivative is not available/);
    expect(r.dropped.find((d) => d.name === 'f')?.reason).toMatch(/not available in the scientific mode/);
    expect(r.kept).toBe(3);
    expect([...r.viewsChanged].sort()).toEqual(['algebra', 'graphics', 'results']);
    expect(f.toScript()).toBe(before);
  });

  it('with force the objects go in one undo step and the new gate is in', () => {
    const f = graphingFigure();
    const r = switchMode(f, MODES.graphing, MODES.scientific, { catalogue: CAT, force: true });
    expect(r.ok).toBe(true);
    expect(f.get('f')).toBeUndefined();
    expect(f.get('n')).toBeDefined();
    expect(f.apply('c = Circle((0, 0), 1)').ok).toBe(false);
    f.undo();
    expect(f.get('f')).toBeDefined();
    expect(f.get('d')).toBeDefined();
    expect(f.get('T')).toBeDefined();
  });

  it('a switch that loses nothing just applies', () => {
    const f = new Figure({ commands: REG });
    f.apply('A = (1, 2)');
    f.apply('B = (3, 4)');
    f.apply('s = Segment(A, B)');
    const r = switchMode(f, MODES.graphing, MODES.geometry, { catalogue: CAT });
    expect(r).toMatchObject({ ok: true, kept: 3, dropped: [] });
  });

  it('a mode that is not built is refused', () => {
    const f = graphingFigure();
    const r = switchMode(f, MODES.graphing, MODES.notes, { catalogue: CAT });
    expect(r.ok).toBe(false);
    expect(r.error?.kind).toBe('mode_unavailable');
  });

  it('a dry run on 500 objects is quick (design 5: under 30 ms; ceiling for CI 300 ms)', { retry: 2 }, () => {
    const f = new Figure({ commands: REG });
    const lines: string[] = [];
    for (let i = 0; i < 250; i++) lines.push(`pt${i} = (${i}, ${i % 7})`, `md${i} = Midpoint(pt${i}, (0, 0))`);
    for (const l of lines) f.apply(l);
    expect(f.objects()).toHaveLength(500);
    const t0 = performance.now();
    const r = switchMode(f, MODES.geometry, MODES.scientific, { catalogue: CAT, dryRun: true });
    const ms = performance.now() - t0;
    expect(r.dropped.length).toBe(250);
    expect(ms).toBeLessThan(300);
  });
});

function harness(opts: { mode?: typeof MODES.graphing; session?: MemStore } = {}) {
  let t = 1000;
  let wall = 0;
  const mode = opts.mode ?? MODES.graphing;
  const fig = graphingFigure();
  fig.setGate(makeGate({ layers: [{ policy: compilePolicy(mode), reason: 'mode' }], catalogue: CAT }));
  const host: ExamFigure = {
    toScript: () => fig.toScript(),
    objectCount: () => fig.objects().length,
    restore: (s) => {
      for (const o of [...fig.objects()].reverse()) fig.apply(`Delete(${o.name})`);
      fig.append(s);
    },
    setGate: (g) => fig.setGate(g),
  };
  const settings = new Settings({ mode, storage: new MemStore() });
  const session = opts.session ?? new MemStore();
  const make = (): ExamController => new ExamController({ mode, settings, figure: host, catalogue: CAT, now: () => t, wallClock: () => new Date(Date.UTC(2026, 10, 15, 9, 0, 0) + wall).toISOString(), session });
  return {
    fig, settings, session, make,
    tick: (ms: number) => {
      t += ms;
      wall += ms;
    },
  };
}

describe('exam mode (R5)', () => {
  it('has the four profiles', () => {
    expect(Object.keys(EXAM_PROFILES).sort()).toEqual(['basic', 'custom', 'graphing-only', 'no-calculator-tools']);
  });

  it('moves idle -> preparing -> active -> finished -> idle and refuses other steps', () => {
    const h = harness();
    const ex = h.make();
    const states: string[] = [];
    ex.on((s) => states.push(s));
    expect(ex.finish()).toMatchObject({ ok: false, kind: 'exam_wrong_state', detail: { state: 'idle', next: ['prepare'] } });
    expect(ex.start({ fullscreen: true })).toMatchObject({ ok: false, kind: 'exam_wrong_state' });
    expect(ex.prepare('basic').ok).toBe(true);
    expect(ex.prepare('basic')).toMatchObject({ ok: false, kind: 'exam_wrong_state' });
    expect(ex.start({ fullscreen: true }).ok).toBe(true);
    expect(ex.exit()).toMatchObject({ ok: false, kind: 'exam_wrong_state' });
    expect(ex.finish().ok).toBe(true);
    expect(ex.exit().ok).toBe(true);
    expect(states).toEqual(['preparing', 'active', 'finished', 'idle']);
  });

  it('refuses a mode with no exam, and an unknown profile', () => {
    const h = harness({ mode: MODES.figure });
    expect(h.make().prepare('basic')).toMatchObject({ ok: false, kind: 'exam_not_allowed' });
    expect(harness().make().prepare('moon' as never)).toMatchObject({ ok: false, kind: 'exam_profile_invalid' });
    expect(harness({ mode: MODES.scientific }).make().prepare('graphing-only')).toMatchObject({ ok: false, kind: 'exam_profile_invalid' });
  });

  it('needs full screen when the profile watches it', () => {
    const ex = harness().make();
    ex.prepare('basic');
    expect(ex.start({ fullscreen: false })).toMatchObject({ ok: false, kind: 'exam_fullscreen_denied' });
    expect(ex.state).toBe('preparing');
    const custom = { ...EXAM_PROFILES.custom, watch: { ...EXAM_PROFILES.custom.watch, fullscreenExit: false } };
    const ex2 = harness().make();
    ex2.prepare(custom);
    expect(ex2.start({ fullscreen: false }).ok).toBe(true);
  });

  it('during the exam: forbidden lines, locked settings, blocked actions', () => {
    const h = harness();
    const ex = h.make();
    ex.prepare('basic');
    ex.start({ fullscreen: true });
    const r = h.fig.apply('i = Integral(f, 0, 1)', { origin: 'learner' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('mode_forbids');
      expect((r as unknown as { reason: string }).reason).toBe('exam');
      expect((r as unknown as { examProfile: string }).examProfile).toBe('basic');
    }
    expect(h.fig.apply('@angleunit degree', { origin: 'learner' }).ok).toBe(false);
    expect(h.settings.set('angleUnit', 'degree')).toMatchObject({ ok: false, kind: 'setting_locked' });
    expect(h.settings.lockedBy('rounding')).toBe("exam profile 'basic'");
    expect(ex.blocked('share')).toMatchObject({ kind: 'exam_blocked', message: 'Not available in this exam.', detail: { action: 'share' } });
    expect(ex.signals.at(-1)).toMatchObject({ kind: 'command_blocked', detail: 'share' });
    expect(h.fig.get('d')?.cell.defined).toBe(true);
    expect(ex.mode.features.share).toBe(false);
  });

  it('signals use the monotonic clock, at most one a second per kind', () => {
    const h = harness();
    const ex = h.make();
    ex.prepare('basic');
    ex.start({ fullscreen: true });
    h.tick(5000);
    expect(ex.signal('focus_lost')).toBe(true);
    h.tick(300);
    expect(ex.signal('focus_lost')).toBe(false);
    h.tick(13_700);
    expect(ex.signal('focus_back')).toBe(true);
    expect(ex.signals.map((s) => [s.kind, s.at])).toEqual([['focus_lost', 5000], ['focus_back', 19_000]]);
    expect(ex.signal('focus_lost', 'x')).toBe(true);
  });

  it('the summary: time, leaving, flag, blocked commands, hash, note', () => {
    const h = harness();
    const ex = h.make();
    ex.prepare('basic');
    ex.start({ fullscreen: true });
    h.tick(1_200_400);
    ex.signal('focus_lost');
    h.tick(13_700);
    ex.signal('focus_back');
    h.tick(1_075_900);
    ex.signal('fullscreen_exit');
    ex.commandBlocked('Derivative');
    h.tick(2000);
    ex.commandBlocked('Derivative');
    h.tick(1_220_000);
    const s = ex.finish();
    if (!s.ok) throw new Error();
    expect(s.value).toMatchObject({
      profile: 'basic', mode: 'graphing', durationMs: 3_512_000, flagged: true, away: { times: 2, ms: 13_700 },
      blockedCommands: [{ command: 'Derivative', count: 2 }], objectsAtEnd: 6, note: EXAM_NOTE,
      startedAt: '2026-11-15T09:00:00.000Z',
    });
    expect(s.value.figureHash).toBe(sha256(h.fig.toScript()));
    expect(s.value.signals.map((x) => x.kind)).toEqual(['focus_lost', 'focus_back', 'fullscreen_exit', 'command_blocked', 'command_blocked']);
    expect(JSON.parse(JSON.stringify(s.value))).toEqual(s.value);
  });

  it('one short leave is not flagged', () => {
    const h = harness();
    const ex = h.make();
    ex.prepare('basic');
    ex.start({ fullscreen: true });
    ex.signal('focus_lost');
    h.tick(4000);
    ex.signal('focus_back');
    const s = ex.finish();
    expect(s.ok && s.value.flagged).toBe(false);
  });

  it('exit restores settings and the earlier figure', () => {
    const h = harness();
    h.settings.set('textScale', 140);
    const before = h.fig.toScript();
    const ex = h.make();
    ex.prepare('basic');
    ex.start({ fullscreen: true });
    h.fig.apply('E = (9, 9)', { origin: 'learner' });
    ex.finish();
    expect(ex.exit().ok).toBe(true);
    expect(h.fig.toScript()).toBe(before);
    expect(h.settings.get('textScale')).toBe(140);
    expect(h.settings.set('angleUnit', 'degree').ok).toBe(true);
    // the mode's own gate is back: Integral is allowed again in graphing
    expect(h.fig.apply('i = Integral(f, 0, 1)').ok).toBe(true);
  });

  it('exit can keep the exam figure', () => {
    const h = harness();
    const ex = h.make();
    ex.prepare('basic');
    ex.start({ fullscreen: true });
    h.fig.apply('E = (9, 9)');
    ex.finish();
    ex.exit({ keepFigure: true });
    expect(h.fig.get('E')).toBeDefined();
  });

  it('a reload resumes the exam and records it', () => {
    const session = new MemStore();
    const h = harness({ session });
    const ex = h.make();
    ex.prepare('basic');
    ex.start({ fullscreen: true });
    h.tick(60_000);
    ex.signal('focus_lost');
    // the page reloads: a new controller with the same session store
    const again = h.make();
    expect(again.state).toBe('active');
    expect(again.signals.map((s) => s.kind)).toEqual(['focus_lost', 'reload']);
    expect(again.elapsed()).toBe(60_000);
    expect(h.fig.apply('i = Integral(f, 0, 1)').ok).toBe(false);
    again.finish();
    again.exit();
    expect(session.getItem('incantly.exam.v1')).toBeNull();
    expect(h.make().state).toBe('idle');
  });

  it('away time adds up leaving to returning', () => {
    expect(awayOf([{ kind: 'focus_lost', at: 10 }, { kind: 'tab_hidden', at: 12 }, { kind: 'tab_visible', at: 40 }, { kind: 'focus_lost', at: 100 }], 150)).toEqual({ times: 2, ms: 80 });
  });

  it('time left counts down from the duration', () => {
    const h = harness();
    const ex = h.make();
    ex.prepare('basic');
    ex.start({ fullscreen: true });
    h.tick(17 * 60_000 + 50_000);
    expect(ex.timeLeft()).toBe((60 - 17) * 60_000 - 50_000);
  });
});
