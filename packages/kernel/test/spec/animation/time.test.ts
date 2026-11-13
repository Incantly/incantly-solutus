/**
 * Time helpers (design 6), the input log and the rerun policies (design 8, kernel ruling K12), and Restart (7.5).
 */
import { describe, expect, it } from 'vitest';
import { playerOf } from '@incantly/kernel';
import { fig, num, ok } from './helpers';

describe('6 time helpers', () => {
  it('pingpong is a triangle wave: 0 at 0, len at len, back to 0 at 2 len', () => {
    const f = fig(['a = pingpong(0, 2)', 'b = pingpong(2, 2)', 'c = pingpong(3, 2)', 'd = pingpong(4, 2)', 'e1 = pingpong(-1, 2)']);
    expect([num(f, 'a'), num(f, 'b'), num(f, 'c'), num(f, 'd'), num(f, 'e1')]).toEqual([0, 2, 1, 0, 1]);
  });
  it('ramp is 0 before a, 1 after b, and linear between', () => {
    const f = fig(['a = ramp(0, 1, 3)', 'b = ramp(2, 1, 3)', 'c = ramp(9, 1, 3)']);
    expect([num(f, 'a'), num(f, 'b'), num(f, 'c')]).toEqual([0, 0.5, 1]);
  });
  it('ease is a smooth step clamped to 0..1', () => {
    const f = fig(['a = ease(-1)', 'b = ease(0.5)', 'c = ease(2)']);
    expect([num(f, 'a'), num(f, 'b'), num(f, 'c')]).toEqual([0, 0.5, 1]);
  });
  it('a formula of t follows the player', () => {
    const f = fig(['@clock 0..10', 'k = pingpong(t, 3)']);
    playerOf(f).seek(4);
    expect(num(f, 'k')).toBeCloseTo(2, 12);
  });
});

const PENDULUM = ['@clock 0..30', 'g = 9.8', 'L = 1 in 0.5..2', 'θ = state(0.6, 0)', "θ'' = -g / L * sin(θ)"];

describe('8.3 rerun = restart, the default (kernel ruling K12)', () => {
  it('a change while the film runs rewrites history: the motion before it changes too', () => {
    const f = fig(PENDULUM);
    const p = playerOf(f);
    p.seek(2);
    const before = num(f, 'θ');
    p.seek(5);
    ok(f.apply('SetValue(L, 2)'));
    p.seek(2);
    expect(num(f, 'θ')).not.toBeCloseTo(before, 6);
    expect(f.solver.inputLog).toHaveLength(0);
  });
});

describe('8.2 and 8.3 rerun = continue: the input log', () => {
  const CONT = [...PENDULUM, 'L with rerun = continue'];
  it('a change takes effect from that time on; seeking back shows the old motion', () => {
    const f = fig(CONT);
    const p = playerOf(f);
    p.seek(2);
    const at2 = num(f, 'θ');
    p.seek(6);
    const at6 = num(f, 'θ');
    p.seek(4);
    f.setFree('L', 2, 'api');
    f.flush();
    p.seek(2);
    expect(num(f, 'θ')).toBe(at2);
    p.seek(6);
    expect(num(f, 'θ')).not.toBeCloseTo(at6, 6);
  });
  it('the change is logged with its time and value', () => {
    const f = fig(CONT);
    playerOf(f).seek(4);
    f.setFree('L', 2, 'api');
    const log = f.solver.inputLog;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: 'set', t: 4, value: 2 });
  });
  it('the result does not depend on how the film got to its time (8.2: deterministic)', () => {
    const a = fig(CONT);
    playerOf(a).seek(4);
    a.setFree('L', 2, 'api');
    playerOf(a).seek(9);
    const b = fig(CONT);
    playerOf(b).seek(4);
    b.setFree('L', 2, 'api');
    for (let k = 1; k <= 10; k++) playerOf(b).seek(4 + k / 2);
    expect(num(a, 'θ')).toBe(num(b, 'θ'));
  });
  it('a new change at an earlier time removes the later ones for that input and says so (8.4)', () => {
    const f = fig(CONT);
    const p = playerOf(f);
    p.seek(6);
    f.setFree('L', 2, 'api');
    p.seek(3);
    f.setFree('L', 1.5, 'api');
    expect(f.solver.inputLog.map((e) => (e.kind === 'set' ? e.value : 'reset'))).toEqual([1.5]);
    expect(f.takeWarnings().map((n) => n.kind)).toContain('log_rewrite');
  });
  it('before the film starts a change is not logged: it is the starting value', () => {
    const f = fig(CONT);
    f.setFree('L', 2, 'api');
    expect(f.solver.inputLog).toHaveLength(0);
  });
});

describe('7.5 Restart()', () => {
  it('puts the states back to their initial values from the current time, and logs a reset', () => {
    const f = fig(PENDULUM);
    const p = playerOf(f);
    p.seek(3);
    ok(f.apply('Restart()'));
    expect(f.solver.inputLog.map((e) => e.kind)).toEqual(['reset']);
    p.seek(3 + 1e-9);
    expect(num(f, 'θ')).toBeCloseTo(0.6, 3);
  });
  it('the motion before the restart is unchanged', () => {
    const f = fig(PENDULUM);
    const p = playerOf(f);
    p.seek(2);
    const at2 = num(f, 'θ');
    p.seek(3);
    ok(f.apply('Restart()'));
    p.seek(2);
    expect(num(f, 'θ')).toBe(at2);
  });
});
