/**
 * The clock (t, bt, beat), seeking, states with rates and the solver.
 * Docs: kernel/design.md 10; core design 7.1 and 7.2; animation-time/design.md 3.1, 3.3 and 7 (the solver, checkpoints,
 * accuracy targets, stability); README decisions 18 and 19; kernel rulings K10.
 */
import { describe, expect, it } from 'vitest';
import { bad, figure, idOf, must, newFigure, ok, recordEvents, resetRuns, runs, snap, expectUnchanged, timed } from './helpers';

const PENDULUM = ['g = 9.8', 'L = 1 in 0.5..2', 'th = state(0.6)', 'w = state(0)', "th' = w", "w' = -g / L * sin(th)"];

describe('t, bt and beat', () => {
  it('start at 0', () => {
    expect(newFigure().clock()).toEqual({ t: 0, bt: 0, beat: 0 });
  });

  it('setClock moves t; with no beats bt equals t and beat is 0', () => {
    const f = figure(['x1 = t']);
    f.setClock(2.5);
    expect(f.clock()).toEqual({ t: 2.5, bt: 2.5, beat: 0 });
    expect(f.value('x1')).toBe(2.5);
  });

  it('setClock returns the frame delta and runs one pass: only t readers change', () => {
    const f = figure(['A = (0, 0)', 'B = (1, 1)', 'M = Midpoint(A, B)', 'x1 = 2 * t', 'x2 = x1 + 1']);
    resetRuns();
    const d = f.setClock(3);
    expect('valueIds' in d).toBe(true);
    if ('valueIds' in d) {
      expect(d.valueIds).toEqual(expect.arrayContaining([idOf(f, 'x1'), idOf(f, 'x2')]));
      expect(d.valueIds).not.toContain(idOf(f, 'M'));
    }
    expect(runs.get('Midpoint') ?? 0).toBe(0);
  });

  it('sends a clock event', () => {
    const f = figure(['x1 = t']);
    const rec = recordEvents(f);
    f.setClock(1.5);
    expect(rec.events.filter((e) => e.ev === 'clock')).toEqual([{ ev: 'clock', t: 1.5 }]);
  });

  it('bt and beat follow the beat table (README decision 18)', () => {
    const f = figure(['b1 = bt', 'b2 = beat', 'x1 = t']);
    f.setBeats([0, 5, 12]);
    f.setClock(7);
    expect(f.clock()).toEqual({ t: 7, bt: 2, beat: 1 });
    expect(f.value('b1')).toBe(2);
    expect(f.value('b2')).toBe(1);
    f.setClock(12);
    expect(f.clock()).toEqual({ t: 12, bt: 0, beat: 2 });
    f.setClock(4.999);
    expect(f.clock().beat).toBe(0);
    expect(f.clock().bt).toBeCloseTo(4.999, 12);
    f.setClock(100);
    expect(f.clock().beat).toBe(2);
    expect(f.clock().bt).toBeCloseTo(88, 12);
  });

  it('the beat can be given explicitly with the seek', () => {
    const f = figure(['b1 = bt', 'b2 = beat']);
    f.setClock(3, { bt: 0.5, beat: 4 });
    expect(f.clock()).toEqual({ t: 3, bt: 0.5, beat: 4 });
    expect(f.value('b2')).toBe(4);
  });

  it('t, bt and beat are reserved names and cannot be defined', () => {
    const f = figure([]);
    for (const n of ['t', 'bt', 'beat']) {
      const before = snap(f);
      bad(f.apply(`${n} = 3`), 'reserved_name');
      expectUnchanged(f, before);
    }
  });

  it('with @clock a..b the film range is a..b and t never goes outside it', () => {
    const f = figure(['@clock 0..30', 'x1 = t']);
    expect(f.clockRange()).toEqual({ from: 0, to: 30 });
    f.setClock(40);
    expect(f.clock().t).toBe(30);
    f.setClock(-5);
    expect(f.clock().t).toBe(0);
  });

  it('without @clock the range is open ended', () => {
    const f = figure(['x1 = t']);
    expect(f.clockRange()).toEqual({ from: 0, to: Infinity });
    f.setClock(1e6);
    expect(f.clock().t).toBe(1e6);
  });

  it('a non-finite time never gets into the clock', () => {
    const f = figure(['x1 = t']);
    f.setClock(2);
    for (const v of [NaN, -Infinity]) {
      const r = f.setClock(v);
      void r; // either an error object or a clamped delta: docs are silent
      expect(Number.isFinite(f.clock().t), String(v)).toBe(true);
      expect(f.clock().t).toBeGreaterThanOrEqual(0);
    }
  });

  it('the clock is not part of undo history or of the script', () => {
    const f = figure(['x1 = t']);
    const depth = f.undoInfo().depth;
    f.setClock(9);
    expect(f.undoInfo().depth).toBe(depth);
    expect(f.toScript()).not.toContain('9');
  });

  it('seeking is deterministic: the same t gives the same value, whatever the path', () => {
    const f = figure(['x1 = sin(t) * 3', 'x2 = x1 * x1']);
    f.setClock(1.7);
    const a = f.value('x2');
    f.setClock(50);
    f.setClock(0);
    f.setClock(1.7);
    expect(f.value('x2')).toBe(a);
  });
});

describe('states and rates (core design 7.2, animation-time 7)', () => {
  it('a state is a Number object whose value is the initial value at the start', () => {
    const f = figure(PENDULUM);
    expect(must(f.get('th')).type).toBe('Number');
    expect(must(f.get('th')).state).toBe(true);
    expect(f.value('th')).toBeCloseTo(0.6, 15);
    expect(f.value('w')).toBe(0);
  });

  it('a constant rate integrates exactly', () => {
    const f = figure(['x1 = state(2)', "x1' = 3"]);
    f.setClock(2);
    expect(f.value('x1')).toBeCloseTo(8, 9);
    f.setClock(0.25);
    expect(f.value('x1')).toBeCloseTo(2.75, 9);
  });

  it('a state is initialised from other numbers: state(L0)', () => {
    const f = figure(['L0 = 5', 'x1 = state(L0)', "x1' = 0"]);
    expect(f.value('x1')).toBe(5);
    f.setClock(3);
    expect(f.value('x1')).toBe(5);
  });

  it('a rate rule is not an object and can be replaced', () => {
    const f = figure(['x1 = state(1)', "x1' = 1"]);
    expect(f.names()).toEqual(['x1']);
    f.setClock(2);
    expect(f.value('x1')).toBeCloseTo(3, 9);
    ok(f.apply("x1' = 2"));
    expect(f.names()).toEqual(['x1']);
    f.setClock(2);
    expect(f.value('x1')).toBeCloseTo(5, 9);
  });

  it('rates may read t (a driven oscillator): the stage time is seen', () => {
    const f = figure(['x1 = state(0)', "x1' = cos(t)"]);
    f.setClock(1.2);
    expect(f.value('x1')).toBeCloseTo(Math.sin(1.2), 8);
  });

  it('a state can drive other objects and be read by formulas', () => {
    const f = figure([...PENDULUM, 'bob = (L * sin(th), -L * cos(th))', 'dist = Distance(bob, bob)']);
    f.setClock(1);
    const th = f.value('th') as number;
    const bob = f.value('bob') as { x: number; y: number };
    expect(bob.x).toBeCloseTo(Math.sin(th), 12);
    expect(bob.y).toBeCloseTo(-Math.cos(th), 12);
  });

  it('a Point state: the rate is a Vector (a pair in a rate rule)', () => {
    const f = figure(['p = state((3, 0))', "p' = (0, 1)"]);
    expect(must(f.get('p')).type).toBe('Point');
    f.setClock(2);
    const p = f.value('p') as { x: number; y: number };
    expect(p.x).toBeCloseTo(3, 9);
    expect(p.y).toBeCloseTo(2, 9);
  });

  it('second order sugar: th = state(0.6, 0) and th\'\' = ... equals the first order system', () => {
    const f1 = figure(PENDULUM);
    const f2 = figure(['g = 9.8', 'L = 1 in 0.5..2', 'th = state(0.6, 0)', "th'' = -g / L * sin(th)"]);
    for (const t of [0.5, 1, 2.75, 6]) {
      f1.setClock(t);
      f2.setClock(t);
      expect(f2.value('th') as number).toBeCloseTo(f1.value('th') as number, 9);
    }
  });

  it('a state cannot be dragged or set by show_me', () => {
    const f = figure(PENDULUM);
    expect(f.dragPlan('th', 1).reason).toBe('owned_by_solver');
    const r = f.setFree('th', 1, 'show_me');
    expect(r.ok).toBe(false);
  });

  it('the solver\'s own writes are not journalled (kernel design 10)', () => {
    const f = figure(PENDULUM);
    const depth = f.undoInfo().depth;
    for (let i = 0; i < 40; i++) f.setClock(i / 10);
    expect(f.undoInfo().depth).toBe(depth);
  });

  it('deletes with the state: Delete(th) removes its readers and the rate attaches to nothing', () => {
    const f = figure([...PENDULUM, 'bob = (L * sin(th), -L * cos(th))']);
    const r = ok(f.apply('Delete(th)'));
    // Docs are silent on `w`, whose rate reads th: it may stay (with its rate detached) or go. th and bob must go.
    expect(r.changed.removed).toEqual(expect.arrayContaining(['th', 'bob']));
    expect(f.get('th')).toBeUndefined();
    expect(() => f.setClock(1)).not.toThrow();
    expect(() => f.problems()).not.toThrow();
  });
});

describe('missing_rate (errors K015)', () => {
  it('is not raised when the state line is applied (the rate usually follows)', () => {
    const f = newFigure();
    const r = ok(f.apply('th = state(0.6)'));
    expect(r.ok).toBe(true);
  });

  it('is reported by problems(), by name, with a suggestion', () => {
    const f = figure(['th = state(0.6)']);
    const ps = f.problems();
    expect(ps.length).toBe(1);
    const e = ps[0];
    expect(e?.kind).toBe('missing_rate');
    expect(e?.code).toBe('K015');
    expect(e?.token).toContain('th');
    expect(e?.recovery).toBe('create_first');
    expect(e?.suggest).toContain("th' = 0");
    expect(e?.message).toContain('th');
  });

  it('goes away when the rate is added', () => {
    const f = figure(['th = state(0.6)']);
    ok(f.apply("th' = 0"));
    expect(f.problems()).toEqual([]);
  });

  it('a figure with complete states has no problems', () => {
    expect(figure(PENDULUM).problems()).toEqual([]);
  });
});

describe('determinism and seeking', () => {
  it('the same time gives the bitwise same state by any seek path (fixed step, checkpoints)', () => {
    const lines = [...PENDULUM, 'g2 = th * 2'];
    const direct = figure(lines);
    direct.setClock(3.1);
    const wander = figure(lines);
    for (const t of [1, 2, 8, 0.2, 5.5, 0, 3.1]) wander.setClock(t);
    const backwards = figure(lines);
    backwards.setClock(9);
    backwards.setClock(3.1);
    expect(wander.value('th')).toBe(direct.value('th'));
    expect(backwards.value('th')).toBe(direct.value('th'));
    expect(backwards.value('g2')).toBe(direct.value('g2'));
    expect(wander.value('w')).toBe(direct.value('w'));
  });

  it('is independent of how the time is approached (one jump or many small steps)', () => {
    const a = figure(PENDULUM);
    const b = figure(PENDULUM);
    a.setClock(4);
    for (let i = 1; i <= 40; i++) b.setClock(i / 10);
    expect(b.value('th')).toBe(a.value('th'));
  });

  it('seeking back to 0 shows the initial state again', () => {
    const f = figure(PENDULUM);
    f.setClock(5);
    f.setClock(0);
    expect(f.value('th')).toBeCloseTo(0.6, 15);
    expect(f.value('w')).toBeCloseTo(0, 15);
  });

  it('two figures built from the same script agree at every sampled time', () => {
    const a = figure(PENDULUM);
    const b = figure(PENDULUM);
    for (const t of [0.01, 0.5, 1, 7.77, 20]) {
      a.setClock(t);
      b.setClock(t);
      expect(a.value('th')).toBe(b.value('th'));
    }
  });

  it('changing a slider that a rate reads restarts the states from their initial values and replays to now', () => {
    const f = figure(PENDULUM);
    f.setClock(3);
    f.setFree('L', 2, 'slider');
    f.flush();
    const fresh = figure(PENDULUM);
    fresh.setFree('L', 2, 'slider');
    fresh.flush();
    fresh.setClock(3);
    expect(f.value('th')).toBe(fresh.value('th'));
  });

  it('a seek is fast once the integration has been done (target 50 ms; limit 500 ms)', { retry: 2 }, () => {
    const f = figure(['@clock 0..60', ...PENDULUM]);
    f.setClock(59); // the first seek integrates the whole film
    const { ms } = timed(() => {
      for (const t of [10, 33.3, 5, 58, 1, 44]) f.setClock(t);
    });
    expect(ms / 6).toBeLessThan(500);
  });
});

describe('accuracy targets (animation-time 7.3)', () => {
  it('harmonic oscillator, 100 periods, step 1/240: amplitude error under 1e-9', () => {
    const f = figure(['p = state(1)', 'q = state(0)', "p' = q", "q' = -p"]);
    f.setClock(100 * 2 * Math.PI);
    const p = f.value('p') as number;
    const q = f.value('q') as number;
    expect(Math.abs(Math.hypot(p, q) - 1)).toBeLessThan(1e-9);
  }, 60_000);

  it('damped oscillator against the closed form: error under 1e-10', () => {
    // x'' = -2 k x' - w0^2 x with x(0) = 1, x'(0) = 0.
    const k = 0.3;
    const w0 = 2;
    const wd = Math.sqrt(w0 * w0 - k * k);
    const f = figure(['x1 = state(1)', 'v1 = state(0)', "x1' = v1", `v1' = -${2 * k} * v1 - ${w0 * w0} * x1`]);
    for (const t of [1, 3.3, 7, 10]) {
      f.setClock(t);
      const exact = Math.exp(-k * t) * (Math.cos(wd * t) + (k / wd) * Math.sin(wd * t));
      expect(Math.abs((f.value('x1') as number) - exact), `t=${t}`).toBeLessThan(1e-10);
    }
  }, 30_000);

  it('pendulum period matches the series value within 1e-6 relative (amplitude 0.6 rad)', () => {
    // T = 2 pi sqrt(L/g) * (1 + a^2/16 + 11 a^4/3072 + 173 a^6 / 737280 + ...), a = amplitude.
    const a = 0.6;
    const g = 9.8;
    const series = 1 + (a * a) / 16 + (11 * a ** 4) / 3072 + (173 * a ** 6) / 737280 + (22931 * a ** 8) / 1321205760;
    const T = 2 * Math.PI * Math.sqrt(1 / g) * series;
    const f = figure(PENDULUM);
    f.setClock(T);
    expect(Math.abs((f.value('th') as number) - 0.6)).toBeLessThan(1e-6);
    f.setClock(T / 2);
    expect(Math.abs((f.value('th') as number) + 0.6)).toBeLessThan(1e-6);
  });

  it('a chaotic double pendulum is the same on every run (determinism, not accuracy)', () => {
    const lines = [
      'a1 = state(2)', 'a2 = state(2.5)', 'b1 = state(0)', 'b2 = state(0)',
      "a1' = b1", "a2' = b2",
      "b1' = (-9.8 * 3 * sin(a1) - 9.8 * sin(a1 - 2 * a2) - 2 * sin(a1 - a2) * (b2^2 + b1^2 * cos(a1 - a2))) / (3 - cos(2 * a1 - 2 * a2))",
      "b2' = (2 * sin(a1 - a2) * (2 * b1^2 + 2 * 9.8 * cos(a1) + b2^2 * cos(a1 - a2))) / (3 - cos(2 * a1 - 2 * a2))",
    ];
    const f1 = figure(lines);
    const f2 = figure(lines);
    f1.setClock(15);
    f2.setClock(7);
    f2.setClock(15);
    expect(f2.value('a1')).toBe(f1.value('a1'));
    expect(f2.value('b2')).toBe(f1.value('b2'));
  });
});

describe('stability and failure (animation-time 7.8)', () => {
  // x' = 1000 x is far past the RK4 stability bound (|lambda| h < 2.78 at h = 1/240), so it grows without limit.
  const BLOWUP = ['x1 = state(1)', "x1' = 1000 * x1", 'y1 = x1 + 1', 'free1 = 5', 'z1 = free1 * 2'];

  it('a state that blows up becomes undefined with reason not_finite, and downstream follows', () => {
    const f = figure(BLOWUP);
    f.setClock(1);
    const c = must(f.cellOf('x1'));
    expect(c.defined).toBe(false);
    expect(c.defined === false && c.reason).toBe('not_finite');
    const y = must(f.cellOf('y1'));
    expect(y.defined === false && y.reason).toBe('input_undefined');
    expect(f.rootCause('y1')?.name).toBe('x1');
    // the figure keeps running: unrelated objects are fine
    expect(f.value('z1')).toBe(10);
  });

  it('raises an unstable_state warning with the time and a hint', () => {
    const f = figure(BLOWUP);
    f.setClock(1);
    const w = f.takeWarnings();
    expect(w.length).toBeGreaterThan(0);
    const n = w.find((x) => x.kind === 'unstable_state');
    expect(n).toBeDefined();
    expect(n?.message).toContain('x1');
    // taking them clears them
    expect(f.takeWarnings().filter((x) => x.kind === 'unstable_state')).toEqual([]);
  });

  it('a seek to a time before the failure shows valid values again', () => {
    const f = figure(BLOWUP);
    f.setClock(1);
    f.setClock(0.004);
    const c = must(f.cellOf('x1'));
    expect(c.defined).toBe(true);
    expect(f.value('x1') as number).toBeGreaterThan(1);
    expect(f.value('x1') as number).toBeLessThan(1e9);
    expect(must(f.cellOf('y1')).defined).toBe(true);
  });

  it('a stable system never warns', () => {
    const f = figure(PENDULUM);
    f.setClock(30);
    expect(f.takeWarnings()).toEqual([]);
  });

  it('a stable state next to a blown-up one keeps stepping', () => {
    const f = figure([...BLOWUP, 'ok1 = state(0)', "ok1' = 1"]);
    f.setClock(1);
    expect(f.value('ok1')).toBeCloseTo(1, 9);
  });
});

describe('@solver and @clock directives', () => {
  it('@solver step 1/480 keeps the system correct and deterministic', () => {
    const f = figure(['@solver step 1/480', ...PENDULUM]);
    f.setClock(3);
    const g = figure(PENDULUM);
    g.setClock(3);
    expect(Math.abs((f.value('th') as number) - (g.value('th') as number))).toBeLessThan(1e-6);
  });

  it('the directives are kept in the script where they were written', () => {
    const f = figure(['@clock 0..30', '@solver step 1/480', 'x1 = t']);
    const s = f.toScript();
    expect(s.indexOf('@clock 0..30')).toBeLessThan(s.indexOf('@solver step 1/480'));
    expect(s.indexOf('@solver step 1/480')).toBeLessThan(s.indexOf('x1 = t'));
  });

  it('a directive sends a directive event', () => {
    const f = newFigure();
    const rec = recordEvents(f);
    ok(f.apply('@clock 0..10'));
    expect(rec.events.some((e) => e.ev === 'directive')).toBe(true);
  });
});
