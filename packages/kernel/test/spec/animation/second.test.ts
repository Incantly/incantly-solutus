/**
 * The second round of animation-time (tasks 10 to 16): traces of states after a seek, drag traces, the saved input log,
 * catching up, the stiffness warning, paths over states, Gradient, px sizes and layers, and load shedding. Built from
 * docs/features/animation-time (design 7, 8, 9, 10; errors 3) and the public API.
 */
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry,
  Figure,
  MIN_QUALITY,
  ParticleShedder,
  isParticlesValue,
  makeParticleBatch,
  playerOf,
  registerAnimation,
  registerFunctions,
  traceDragPoints,
  tracePoints,
  traceSnapshots,
} from '@incantly/kernel';
import type { ObjId, ParticlesValue } from '@incantly/kernel';
import { bad, fig, manualClock, ok, registry } from './helpers';

const idOf = (f: Figure, name: string): ObjId => {
  const o = f.get(name);
  if (!o) throw new Error(`no object ${name}`);
  return o.id;
};
const DECAY = ['@clock 0..60', 'θ = state(1)', "θ' = -θ", 'P = (θ, 0)'];
const PENDULUM = ['@clock 0..30', 'g = 9.8', 'L = 1 in 0.5..2', 'θ = state(0.6, 0)', "θ'' = -g / L * sin(θ)", 'L with rerun = continue'];

function systemOf(f: Figure, name: string): ParticlesValue {
  const v = f.value(name);
  if (!isParticlesValue(v)) throw new Error(`${name} is not a particle system`);
  return v;
}

describe('9.4 traces of objects that move through states', () => {
  it('a seek rebuilds the trace from the solver: each sample is the state at its own time', () => {
    const f = fig(DECAY);
    ok(f.apply('Trace(P)'));
    playerOf(f).seek(2);
    const xy = Array.from(tracePoints(f, idOf(f, 'P')) ?? []);
    expect(xy.length / 2).toBe(121);
    expect(xy[0]).toBeCloseTo(1, 6);
    expect(xy[2 * 60]).toBeCloseTo(Math.exp(-1), 6);
    expect(xy.at(-2)).toBeCloseTo(Math.exp(-2), 6);
  });
  it('a point that is itself a state is traced over time too', () => {
    const f = fig(['@clock 0..10', 'Q = state((1, 0))', "Q' = (0, 1)"]);
    ok(f.apply('Trace(Q)'));
    playerOf(f).seek(1);
    const xy = Array.from(tracePoints(f, idOf(f, 'Q')) ?? []);
    expect(xy[1]).toBeCloseTo(0, 9);
    expect(xy.at(-1)).toBeCloseTo(1, 6);
  });
  it('sampling leaves the live figure as it was', () => {
    const f = fig(DECAY);
    const p = playerOf(f);
    p.seek(1);
    const before = f.value('θ');
    ok(f.apply('Trace(P)'));
    expect(f.value('θ')).toBe(before);
  });
});

describe('9.5 drag traces', () => {
  it('each drag step adds the traced point where it is; a seek does not replay them', () => {
    const f = fig(['A = (0, 0)', 'P = (A.x + 1, A.y)']);
    ok(f.apply('Trace(P)'));
    for (const x of [1, 2, 3]) {
      const r = f.drag(f.dragPlan('A', { x, y: 0 }));
      expect(r.ok).toBe(true);
    }
    const d = Array.from(traceDragPoints(f, idOf(f, 'P')) ?? []);
    expect(d).toEqual([2, 0, 3, 0, 4, 0]);
    playerOf(f).seek(0);
    expect(Array.from(traceDragPoints(f, idOf(f, 'P')) ?? [])).toEqual([2, 0, 3, 0, 4, 0]);
  });
  it('ClearTrace forgets them, and so does a redefinition of the traced object', () => {
    const f = fig(['A = (0, 0)', 'P = (A.x + 1, A.y)']);
    ok(f.apply('Trace(P)'));
    f.drag(f.dragPlan('A', { x: 1, y: 0 }));
    ok(f.apply('ClearTrace(P)'));
    expect(traceDragPoints(f, idOf(f, 'P'))).toHaveLength(0);
    f.drag(f.dragPlan('A', { x: 2, y: 0 }));
    ok(f.apply('P = (A.x + 2, A.y)'));
    f.drag(f.dragPlan('A', { x: 3, y: 0 }));
    expect(Array.from(traceDragPoints(f, idOf(f, 'P')) ?? [])).toEqual([5, 0]);
  });
  it('the view value puts the drag samples after the time samples, with a gap between', () => {
    const f = fig(['@clock 0..10', 'A = (0, 0)', 'P = (A.x + t, A.y)']);
    ok(f.apply('Trace(P)'));
    playerOf(f).seek(1 / 60);
    f.drag(f.dragPlan('A', { x: 5, y: 0 }));
    const xy = Array.from(tracePoints(f, idOf(f, 'P')) ?? []);
    expect(xy.length / 2).toBe(2 + 1 + 1);
    expect(Number.isNaN(xy[4])).toBe(true);
  });
  it('a shape keeps a snapshot per drag step', () => {
    const f = fig(['A = (0, 0)', 'B = (1, 0)', 's = Segment(A, B)']);
    ok(f.apply('Trace(s)'));
    f.drag(f.dragPlan('A', { x: 0, y: 1 }));
    f.drag(f.dragPlan('A', { x: 0, y: 2 }));
    expect(traceSnapshots(f, idOf(f, 's'))?.length).toBe(1);
  });
});

describe('8.2 the input log is saved with the script (R4.6)', () => {
  it('the script ends with @input lines: the value before the first change, then each entry', () => {
    const f = fig(PENDULUM);
    playerOf(f).seek(4);
    f.setFree('L', 2, 'api');
    const lines = f.toScript().trim().split('\n');
    expect(lines.slice(-2)).toEqual(['@input L 1 base', '@input L 2 at 4']);
  });
  it('a film loaded from that script replays the same motion', () => {
    const a = fig(PENDULUM);
    playerOf(a).seek(4);
    a.setFree('L', 2, 'api');
    a.flush();
    playerOf(a).seek(9);
    const want = a.value('θ');
    const b = new Figure({ commands: registry });
    const rep = b.append(a.toScript());
    expect(rep.ok).toBe(true);
    expect(b.solver.inputLog).toHaveLength(1);
    playerOf(b).seek(9);
    expect(b.value('θ')).toBe(want);
    playerOf(b).seek(2);
    playerOf(a).seek(2);
    expect(b.value('θ')).toBe(a.value('θ'));
  });
  it('Restart() is saved as @input reset at t', () => {
    const f = fig(PENDULUM);
    playerOf(f).seek(3);
    ok(f.apply('Restart()'));
    expect(f.toScript()).toContain('@input reset at 3');
  });
  it('a malformed @input line is bad_directive', () => {
    bad(fig(PENDULUM).apply('@input L at'), 'bad_directive');
    bad(fig(PENDULUM).apply('@input nothing 2 at 1'), 'bad_directive');
  });
});

describe('8.5 catching up', () => {
  it('a seek too far for one pass reports catching_up, and the player keeps asking for frames until it is done', () => {
    const f = fig(['@clock 0..4000', 'w = state(0)', "w' = 1"]);
    const p = playerOf(f, manualClock());
    p.seek(3000);
    expect(f.solver.catchingUp).toBeDefined();
    expect(f.takeWarnings().some((n) => n.kind === 'catching_up')).toBe(true);
    expect(p.needsFrame()).toBe(true);
    for (let k = 0; k < 4 && p.needsFrame(); k++) p.frame();
    expect(p.needsFrame()).toBe(false);
    expect(f.value('w')).toBeCloseTo(3000, 6);
  });
});

describe('errors 3: stiff_system', () => {
  it('a rate too fast for the step warns before it blows up', () => {
    const f = fig(['@clock 0..10', 'w = state(1)', "w' = -2000 w"]);
    playerOf(f).seek(0.1);
    const w = f.takeWarnings().find((n) => n.kind === 'stiff_system');
    expect(w).toBeDefined();
    expect(f.solver.lastOmega).toBeGreaterThan(1000);
  });
  it('an oscillator is measured by its frequency, not its stiffness', () => {
    const f = fig(['@clock 0..10', 'w = state(1, 0)', "w'' = -100 w"]);
    playerOf(f).seek(0.1);
    expect(f.solver.lastOmega).toBeCloseTo(10, 0);
    expect(f.takeWarnings().some((n) => n.kind === 'stiff_system')).toBe(false);
  });
});

describe('9.8 Path over states', () => {
  it('Path of a state-driven point follows the solver', () => {
    // Path belongs to the functions area
    const reg = new CommandRegistry();
    registerFunctions(reg);
    registerAnimation(reg);
    const f = new Figure({ commands: reg });
    for (const l of [...DECAY, 'c = Path(P, 0, 2)']) ok(f.apply(l));
    const v = f.value('c') as { pieces?: Float64Array[] } | undefined;
    const piece = v?.pieces?.[0];
    expect(piece).toBeDefined();
    const xs = Array.from(piece ?? []).filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBeCloseTo(1, 6);
    expect(Math.min(...xs)).toBeCloseTo(Math.exp(-2), 4);
  });
});

describe('10.2 Gradient, px sizes and layers', () => {
  it('Gradient runs evenly through its colours', () => {
    const f = fig(['c = Gradient(0.5, rgb(0, 0, 0), rgb(200, 100, 0))', 'd = Gradient(0.75, rgb(0, 0, 0), rgb(100, 0, 0), rgb(100, 200, 0))', 'k = Gradient(2, rgb(0, 0, 0), rgb(10, 20, 30))']);
    expect(f.value('c')).toMatchObject({ r: 100, g: 50, b: 0 });
    expect(f.value('d')).toMatchObject({ r: 100, g: 100, b: 0 });
    expect(f.value('k')).toMatchObject({ r: 10, g: 20, b: 30 });
  });
  it('a Gradient colour works in particles on the CPU and the GPU', () => {
    const s = systemOf(fig(['p = Particles(count = 4, life = 1, pos = (u, v), color = Gradient(ph, rgb(255, 0, 0), rgb(0, 0, 255)))']), 'p');
    expect(s.program.gpuOk).toBe(true);
    expect(s.program.gpuSource().vertexGlsl).toContain('mix(');
    const b = makeParticleBatch(4);
    s.program.evalCpu(3.25, 0, b);
    expect(Array.from(b.rgba).every((c) => (c & 0xff) === 0xff)).toBe(true);
  });
  it('size = px(...) is a size in pixels, saved as sizeUnit = "px"; a plain size is in maths units', () => {
    const f = fig(['p = Particles(count = 4, life = 1, pos = (u, v), size = px(3 (1 - ph)))']);
    expect(systemOf(f, 'p').spec.sizeIsPx).toBe(true);
    expect(f.toScript()).toContain('sizeUnit = "px")');
    expect(systemOf(fig(f.toScript().trim().split('\n')), 'p').spec.sizeIsPx).toBe(true);
    expect(systemOf(fig(['p = Particles(count = 4, life = 1, pos = (u, v), size = 0.1)']), 'p').spec.sizeIsPx).toBe(false);
  });
  it('layer is kept, and a layer outside 0..9 is bad_particle_value', () => {
    expect(systemOf(fig(['p = Particles(count = 4, life = 1, pos = (u, v), layer = 3)']), 'p').spec.layer).toBe(3);
    bad(fig().apply('p = Particles(count = 4, life = 1, pos = (u, v), layer = 12)'), 'bad_particle_value');
  });
});

describe('10.6 load shedding', () => {
  it('five slow frames drop a quarter, down to 25%; sixty good frames bring a quarter back', () => {
    const s = new ParticleShedder();
    for (let k = 0; k < 4; k++) expect(s.frame(20, 'fire')).toBeUndefined();
    const n = s.frame(20, 'fire');
    expect(n?.kind).toBe('particle_shed');
    expect(s.quality).toBe(0.75);
    for (let k = 0; k < 50; k++) s.frame(30);
    expect(s.quality).toBe(MIN_QUALITY);
    expect(s.drawCount(1000)).toBe(250);
    expect(s.scale()).toBe(2);
    for (let k = 0; k < 60; k++) s.frame(5);
    expect(s.quality).toBe(0.5);
  });
});

describe('5 slider animation is the numbers area\'s, on the player\'s clock', () => {
  it('Animate(s) with loop and period moves the slider when the player plays or seeks', () => {
    const f = fig(['s = 0 in 0..2 pi', 's with loop = up, period = 6', 'P = (2 cos(s), 2 sin(s))']);
    ok(f.apply('Animate(s)'));
    const clock = manualClock();
    const p = playerOf(f, clock);
    p.seek(1.5);
    expect(f.value('s')).toBeCloseTo(Math.PI / 2, 2);
    p.play();
    clock.set(0);
    p.frame();
    clock.set(0.05);
    p.frame();
    expect(f.value('s')).toBeCloseTo(((1.55 / 6) * 2 * Math.PI) % (2 * Math.PI), 2);
    ok(f.apply('Animate(s, false)'));
  });
  it('the words of the early draft (animate, seconds) are not slider properties', () => {
    expect(fig(['a = 0 in 0..10']).apply('a with animate = bounce').ok).toBe(false);
  });
});
