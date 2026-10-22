import { describe, expect, it } from 'vitest';
import type { Inc } from '../src/api/types';
import { SceneRuntime, type RuntimeOptions } from '../src/runtime/runtime';
import { History, MERGE_MS } from '../src/runtime/history';
import { Timeline } from '../src/runtime/timeline';
import { EASINGS } from '../src/runtime/tween';

function run(scene: (inc: Inc) => void, options: RuntimeOptions = {}) {
  const runtime = new SceneRuntime({ autoplay: false, ...options });
  const mount = runtime.mount(scene);
  runtime.tick(0);
  return { runtime, mount };
}

const stage = (inc: Inc) => inc.svg('#s', { viewBox: [0, 0, 100, 100], title: 'Stage' });

describe('controls other than sliders (CT-3)', () => {
  it('holds toggles, choices and colours as numbers, with handles that read naturally', () => {
    const seen: string[] = [];
    const { runtime } = run((inc) => {
      const air = inc.toggle('air', { value: false, label: 'Air resistance' });
      const planet = inc.choice('planet', { options: ['Earth', 'Moon', 'Mars'], value: 1, buttons: true });
      const paint = inc.color('paint', { value: 'b' });
      const s = stage(inc);
      const dot = s.circle(50, 50, 5);
      inc.onFrame(() => {
        dot.tone(paint.tone);
        seen.push(`${air.on}|${planet.selected}|${paint.tone}`);
      });
    });
    expect(seen.at(-1)).toBe('false|Moon|b');
    const params = runtime.uiState().params;
    expect(params.map((p) => [p.name, p.kind, p.value, p.options.length, p.buttons])).toEqual([
      ['air', 'toggle', 0, 0, false],
      ['planet', 'choice', 1, 3, true],
      ['paint', 'color', 1, 4, true],
    ]);
    runtime.setParam('air', 1);
    runtime.setParam('planet', 2);
    runtime.setParam('paint', 3);
    runtime.tick(0);
    expect(seen.at(-1)).toBe('true|Mars|lit');
  });

  it('rejects malformed controls with plain messages', () => {
    const error = (scene: (inc: Inc) => void) => run(scene).mount.ui.error?.message;
    expect(error((inc) => void inc.choice('c', { options: ['only'] }))).toContain('from 2 to 8 options');
    expect(error((inc) => void inc.choice('c', { options: ['a', 'a'] }))).toContain('same option twice');
    expect(error((inc) => void inc.color('c', { value: 'pink' as never }))).toContain('not one of its tones');
    expect(error((inc) => void inc.toggle('t', { value: 1 as never }))).toContain('true or false');
  });
});

describe('buttons, presets and linked parameters (CT-6, CT-8)', () => {
  it('runs buttons, applies presets as one step, and marks the active preset', () => {
    let pressed = 0;
    const { runtime } = run((inc) => {
      inc.param('g', { min: 1, max: 30, step: 0.1, value: 9.8, label: 'Gravity' });
      inc.presets({ Earth: { g: 9.8 }, Moon: { g: 1.6 }, Jupiter: { g: 24.8 } });
      inc.button('Drop', () => {
        pressed++;
        return { g: 20 };
      });
      stage(inc);
    });
    const actions = () => runtime.uiState().actions;
    expect(actions().map((a) => [a.label, a.kind, a.active])).toEqual([
      ['Earth', 'preset', true],
      ['Moon', 'preset', false],
      ['Jupiter', 'preset', false],
      ['Drop', 'button', false],
    ]);
    runtime.action(1);
    expect(runtime.values().g).toBe(1.6);
    expect(actions()[1]!.active).toBe(true);
    runtime.action(3);
    expect(pressed).toBe(1);
    expect(runtime.values().g).toBe(20);
    runtime.undo();
    expect(runtime.values().g).toBe(1.6);
  });

  it('keeps linked parameters in step both ways', () => {
    const { runtime } = run((inc) => {
      inc.param('frequency', { min: 0.5, max: 5, step: 0.01, value: 1 });
      inc.param('period', { min: 0.2, max: 2, step: 0.01, value: 1 });
      inc.link('frequency', 'period', (f) => 1 / f, (p) => 1 / p);
      stage(inc);
    });
    runtime.setParam('frequency', 2);
    expect(runtime.values()).toEqual({ frequency: 2, period: 0.5 });
    runtime.setParam('period', 0.25);
    expect(runtime.values()).toEqual({ frequency: 4, period: 0.25 });
    expect(runtime.uiState().params.map((p) => p.linked)).toEqual(['period', 'frequency']);
  });
});

describe('undo and redo (CT-5)', () => {
  it('merges a run of slider input into one step and undoes resets', () => {
    let now = 0;
    const { runtime } = run(
      (inc) => {
        inc.param('a', { min: 0, max: 10, step: 1, value: 0 });
        stage(inc);
      },
      { now: () => now },
    );
    for (const v of [1, 2, 3, 4]) {
      now += 50;
      runtime.setParam('a', v);
    }
    now += MERGE_MS + 1;
    runtime.setParam('a', 7);
    expect(runtime.uiState().history).toEqual({ undo: true, redo: false });
    runtime.undo();
    expect(runtime.values().a).toBe(4);
    runtime.undo();
    expect(runtime.values().a).toBe(0);
    runtime.redo();
    expect(runtime.values().a).toBe(4);
    runtime.reset();
    expect(runtime.values().a).toBe(0);
    runtime.undo();
    expect(runtime.values().a).toBe(4);
  });

  it('forgets a run of changes that ends where it began', () => {
    let now = 0;
    const history = new History(() => now);
    history.record({ a: 1 }, { a: 2 });
    now += 10;
    history.record({ a: 2 }, { a: 1 });
    expect(history.canUndo).toBe(false);
  });
});

describe('state, hooks and fixed steps (RT-2, RT-3, RT-4, PH-8)', () => {
  it('keeps scene state, calls listeners before the next frame and treats parameters as state', () => {
    const calls: string[] = [];
    const { runtime } = run((inc) => {
      inc.param('k', { min: 0, max: 10, value: 1 });
      inc.state.set('mode', 'idle');
      inc.state.on('mode', (v) => calls.push(`mode=${String(v)}`));
      inc.state.on('k', (v) => calls.push(`k=${String(v)}`));
      inc.onParamChange((name, value) => calls.push(`param ${name}=${value}`));
      inc.onReset(() => calls.push('reset'));
      inc.button('Go', () => inc.state.set('mode', 'running'));
      stage(inc);
    });
    expect(calls).toEqual(['reset']);
    runtime.action(0);
    runtime.setParam('k', 4);
    runtime.tick(0);
    expect(calls).toEqual(['reset', 'mode=running', 'k=4', 'param k=4']);
    expect(runtime.inc.state.get('k')).toBe(4);
    runtime.restart();
    expect(calls.at(-1)).toBe('reset');
  });

  it('calls onStep when the walkthrough moves', () => {
    const steps: Array<number | null> = [];
    const { runtime } = run((inc) => {
      inc.onStep((i) => steps.push(i));
      const s = stage(inc);
      s.part('Dot', s.circle(1, 1, 1));
      inc.steps([{ say: 'One.' }, { say: 'Two.' }]);
    });
    runtime.step('next');
    runtime.tick(0);
    runtime.step('next');
    runtime.tick(0);
    runtime.step('exit');
    runtime.tick(0);
    expect(steps).toEqual([0, 1, null]);
  });

  it('runs simulations in fixed steps whatever the frame rate, only while playing', () => {
    const totals: number[] = [];
    for (const fps of [30, 60, 144]) {
      let steps = 0;
      const { runtime } = run((inc) => {
        inc.simulate(() => {
          steps++;
        }, { step: 1 / 120 });
        stage(inc);
      });
      runtime.play();
      for (let i = 0; i < fps; i++) runtime.tick(1 / fps);
      totals.push(steps);
      runtime.pause();
      runtime.tick(0);
      expect(steps).toBe(totals.at(-1));
    }
    for (const total of totals) expect(Math.abs(total - 120)).toBeLessThanOrEqual(1);
  });
});

describe('the timeline and the timing panel (CT-4)', () => {
  it('drives frame.progress, loops, ping-pongs, plays once and persists the learner’s settings', () => {
    const progress: number[] = [];
    const { runtime } = run((inc) => {
      inc.timeline({ duration: 1, loop: 'once' });
      inc.onFrame(({ progress: p }) => progress.push(p));
      stage(inc);
    });
    runtime.play();
    for (let i = 0; i < 80; i++) runtime.tick(1 / 50);
    expect(progress.at(-1)).toBe(1);
    expect(runtime.playing).toBe(false);
    runtime.setTiming({ duration: 2, loop: 'pingpong', ease: 'inOut' });
    const update = runtime.tick(0);
    expect(update.values).toEqual({ $duration: 2, $loop: 2, $ease: 3 });
    expect(runtime.uiState().timing).toEqual({ duration: 2, loop: 'pingpong', ease: 'inOut' });
    const timeline = new Timeline({ duration: 2, loop: 'pingpong' });
    expect(timeline.progress(1)).toBeCloseTo(0.5);
    expect(timeline.progress(3)).toBeCloseTo(0.5);
    expect(timeline.progress(4)).toBeCloseTo(0);
    expect(Timeline.decode({ $duration: 3, $loop: 0, $ease: 4 })).toEqual({ duration: 3, loop: 'loop', ease: 'spring' });
  });

  it('restores timing settings with the learner’s values', () => {
    const { runtime } = run(
      (inc) => {
        inc.timeline({ duration: 1 });
        stage(inc);
      },
      { values: { $duration: 4, $loop: 1 } },
    );
    expect(runtime.uiState().timing).toEqual({ duration: 4, loop: 'once', ease: 'linear' });
  });

  it('steps one frame while paused', () => {
    const times: number[] = [];
    const { runtime } = run((inc) => {
      inc.onFrame(({ time }) => times.push(time));
      stage(inc);
    });
    runtime.stepFrame();
    runtime.stepFrame();
    expect(times.at(-1)).toBeCloseTo(2 / 60);
  });

  it('eases with a spring that overshoots and settles at 1', () => {
    const spring = EASINGS.spring;
    expect(spring(0)).toBe(0);
    expect(spring(1)).toBe(1);
    expect(Math.max(...[0.2, 0.3, 0.35, 0.4].map(spring))).toBeGreaterThan(1);
  });
});

describe('teaching tools (TE-4, TE-5, FM-2, DG-2)', () => {
  it('asks for a prediction, then reveals the answer by moving to its values', () => {
    const { runtime } = run((inc) => {
      inc.param('angle', { min: 10, max: 80, step: 1, value: 30 });
      inc.predict({ question: 'Which angle goes furthest?', options: ['30°', '45°', '60°'], answer: 1, reveal: { angle: 45 }, explain: () => 'Range peaks at 45 degrees.' });
      stage(inc);
    });
    expect(runtime.uiState().predict).toMatchObject({ chosen: null, revealed: false, answer: null });
    runtime.predict(0, 2);
    runtime.predict(0, 2, true);
    runtime.play();
    for (let i = 0; i < 60; i++) runtime.tick(1 / 50);
    expect(runtime.uiState().predict).toMatchObject({ chosen: 2, revealed: true, answer: 1, explanation: 'Range peaks at 45 degrees.' });
    expect(runtime.values().angle).toBe(45);
  });

  it('keeps faint copies of the curves while comparing', () => {
    const { runtime } = run((inc) => {
      const a = inc.param('a', { min: 1, max: 3, value: 1 });
      const g = inc.graph2d('#g', { x: [0, 1], y: [0, 3], title: 'Line' });
      g.plot((x: number) => a.value * x);
      inc.compare();
    });
    expect(runtime.uiState().compare).toEqual({ available: true, on: false });
    const before = runtime.graph.size;
    runtime.setCompare(true);
    runtime.tick(0);
    const ghosts = [...runtime.graph.nodes.values()].filter((n) => n.extra.includes('inc-ghost'));
    expect(ghosts.length).toBeGreaterThan(0);
    expect(runtime.graph.size).toBeGreaterThan(before);
    runtime.setCompare(false);
    expect(ghosts.every((g) => g.hidden)).toBe(true);
  });

  it('lets a learner edit a formula, keeps the old one on a mistake, and persists the edit', () => {
    let ys: number[] = [];
    const { runtime } = run((inc) => {
      const A = inc.param('A', { min: 1, max: 3, value: 2 });
      const f = inc.formula('A*x', { vars: { A }, editable: true, label: 'Line' });
      inc.onFrame(() => {
        ys = [f(1), f(2)];
      });
      stage(inc);
    });
    expect(ys).toEqual([2, 4]);
    runtime.editFormula(0, 'A*x^2');
    const update = runtime.tick(0);
    expect(ys).toEqual([2, 8]);
    expect(update.formulas).toEqual({ 0: 'A*x^2' });
    runtime.editFormula(0, 'A*(x');
    expect(runtime.tick(0).formulas).toBeUndefined();
    expect(ys).toEqual([2, 8]);
    expect(runtime.uiState().formulas[0]).toMatchObject({ source: 'A*x^2', draft: 'A*(x', editable: true });
    expect(runtime.uiState().formulas[0]!.error).toContain('position');
    // An edit may name any parameter, even one the formula did not bind.
    const restored = run(
      (inc) => {
        inc.param('A', { min: 1, max: 3, value: 2 });
        const B = inc.param('B', { min: 0, max: 5, value: 3 });
        const f = inc.formula('B*x', { vars: { B }, editable: true });
        inc.onFrame(() => {
          ys = [f(1)];
        });
        stage(inc);
      },
      { formulas: { 0: 'A + B*x' } },
    );
    expect(restored.runtime.uiState().formulas[0]!.source).toBe('A + B*x');
    expect(ys).toEqual([5]);
  });

  it('fills tables from the model', () => {
    const { runtime } = run((inc) => {
      const v = inc.param('v', { min: 1, max: 5, value: 2 });
      inc.table({ title: 'Distance', columns: ['t (s)', 'd (m)'], rows: () => [1, 2, 3].map((t) => [t, t * v.value]) });
      stage(inc);
    });
    expect(runtime.uiState().tables).toEqual([{ title: 'Distance', columns: ['t (s)', 'd (m)'], rows: [['1', '2'], ['2', '4'], ['3', '6']] }]);
  });
});

describe('stage helpers (DG-1, SV-6, SV-10, SV-13)', () => {
  it('draws connectors and callouts that follow their elements', () => {
    let lineId = 0;
    let labelId = 0;
    const { runtime } = run((inc) => {
      const y = inc.param('y', { min: 0, max: 50, value: 0 });
      const s = stage(inc);
      const a = s.circle(10, 10, 2);
      const b = s.circle(50, 10, 2);
      inc.onFrame(() => b.at(0, y.value));
      lineId = (s.connector(a, b, { arrow: true }) as unknown as { node: { id: number } }).node.id;
      labelId = (s.callout(b, () => `y = ${y.value}`) as unknown as { node: { id: number } }).node.id;
    });
    expect(runtime.graph.nodes.get(lineId)!.attrs.get('d')).toMatch(/^M10 10L50 10/);
    expect(runtime.graph.nodes.get(labelId)!.text).toBe('y = 0');
    runtime.setParam('y', 30);
    runtime.tick(0);
    expect(runtime.graph.nodes.get(lineId)!.attrs.get('d')).toMatch(/^M10 10L50 40/);
    expect(runtime.graph.nodes.get(labelId)!.text).toBe('y = 30');
  });

  it('repeats an element, flows dashes with time and draws dots on a canvas', () => {
    const { runtime, mount } = run((inc) => {
      const s = stage(inc);
      const ball = s.circle(0, 0, 2, { tone: 'b' });
      const copies = s.repeat(ball, 3);
      copies.forEach((c, i) => c.at(i * 10, 0));
      s.path('M0 50L100 50').flow(20);
      s.dots({ tone: 'a', r: 1.5 }).set([
        [1, 1],
        [2, 2],
      ]);
    });
    const uses = mount.commands.filter((c) => c.op === 'create' && c.kind === 'use');
    expect(uses).toHaveLength(3);
    expect(mount.commands.filter((c) => c.op === 'dots').at(-1)).toMatchObject({ op: 'dots', tone: 'a', r: 1.5, points: [1, 1, 2, 2] });
    runtime.play();
    const update = runtime.tick(0.05);
    expect(update.commands.some((c) => c.op === 'attr' && c.name === 'stroke-dashoffset')).toBe(true);
    expect(runtime.uiState().animated).toBe(true);
  });

  it('lets a scene drag any element and map the pointer to values', () => {
    let id = 0;
    const { runtime, mount } = run((inc) => {
      inc.param('angle', { min: -90, max: 90, step: 1, value: 0 });
      const s = stage(inc);
      const bob = s.circle(50, 90, 5);
      id = (bob as unknown as { node: { id: number } }).node.id;
      s.part('Bob', bob, { label: 'The bob' });
      s.drag(bob, ({ x, y }) => ({ angle: (Math.atan2(x - 50, y - 10) * 180) / Math.PI }));
    });
    expect(mount.commands.find((c) => c.op === 'drag')).toEqual({ op: 'drag', id, label: 'Bob' });
    runtime.drag(id, 'start', 50, 90);
    runtime.drag(id, 'move', 90, 50);
    runtime.drag(id, 'end', 90, 50);
    expect(runtime.values().angle).toBe(45);
    expect(runtime.uiState().card).toEqual({ title: 'Stage', hint: 'Drag Bob or change the values below.' });
  });
});

describe('the idle tour (MO-1, BR-8)', () => {
  const tour = (options: RuntimeOptions = {}) =>
    run((inc) => {
      inc.param('angle', { min: 0, max: 90, value: 45 });
      const s = stage(inc);
      s.circle(50, 50, 5);
      inc.idle({ sweep: 'angle', after: 1, period: 4 });
    }, options);

  it('waits, then sweeps the parameter smoothly from where it is', () => {
    const { runtime } = tour();
    for (let i = 0; i < 20; i++) runtime.tick(0.05);
    expect(runtime.values().angle).toBe(45);
    const seen: number[] = [];
    for (let i = 0; i < 40; i++) {
      runtime.tick(0.05);
      seen.push(runtime.values().angle!);
    }
    // No jump at the start, and it moves.
    expect(Math.abs(seen[0]! - 45)).toBeLessThan(0.5);
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(20);
    // The sweep is not the learner's: nothing to undo, nothing persisted.
    expect(runtime.uiState().history.undo).toBe(false);
  });

  it('stops for good at the first touch, and never runs under reduced motion', () => {
    const { runtime } = tour();
    for (let i = 0; i < 40; i++) runtime.tick(0.05);
    runtime.touched();
    const at = runtime.values().angle;
    for (let i = 0; i < 40; i++) runtime.tick(0.05);
    expect(runtime.values().angle).toBe(at);
    const still = tour({ reducedMotion: true }).runtime;
    for (let i = 0; i < 80; i++) still.tick(0.05);
    expect(still.values().angle).toBe(45);
  });

  it('rejects a tour of something that is not a parameter', () => {
    const error = run((inc) => {
      stage(inc);
      inc.idle({ sweep: 'nothing' });
    }).mount.ui.error?.message;
    expect(error).toContain('"nothing", which is not a parameter declared before it');
  });
});

describe('moves in order and views on one state (C3-8, C3-9)', () => {
  it('queues tweens and plays them one after another, each committing once', () => {
    const log: string[] = [];
    const runtime = new SceneRuntime({ autoplay: false });
    runtime.mount((inc) => {
      inc.svg('#stage', { viewBox: [0, 0, 10, 10], title: 'Moves' });
      for (const name of ['first', 'second', 'third']) {
        inc.tween({ duration: 0.5, apply: (k) => void log.push(`${name} ${k.toFixed(2)}`), commit: () => void log.push(`${name} done`) });
      }
    });
    for (let i = 0; i < 18; i++) runtime.tick(0.1);
    const done = log.filter((l) => l.endsWith('done'));
    expect(done).toEqual(['first done', 'second done', 'third done']);
    // Never two at once: each starts after the one before it committed.
    const starts = ['first', 'second', 'third'].map((name) => log.findIndex((l) => l.startsWith(`${name} `)));
    expect(starts[1]).toBeGreaterThan(log.indexOf('first done'));
    expect(starts[2]).toBeGreaterThan(log.indexOf('second done'));
    // The queue holds sixteen: a seventeenth is a mistake the figure reports.
    const full = new SceneRuntime({ autoplay: false });
    full.mount((inc) => {
      for (let i = 0; i < 17; i++) inc.tween({ duration: 1, apply: () => undefined });
    });
    expect(full.uiState().error?.message).toBe('Too many queued tweens');
  });

  it('keeps two stages in step from one model: a change redraws both', () => {
    const runtime = new SceneRuntime({ autoplay: false });
    let dot = 0;
    let bar = 0;
    runtime.mount((inc) => {
      const height = inc.param('height', { min: 0, max: 10, value: 2, label: 'Height' });
      const model = inc.model((v) => ({ energy: 9.8 * (v.height ?? 0) }));
      const scene = inc.svg('#scene', { viewBox: [0, 0, 100, 100], title: 'Ball' });
      const chart = inc.svg('#chart', { viewBox: [0, 0, 100, 100], title: 'Energy' });
      const ball = scene.circle(50, 90, 4, { tone: 'lit' });
      const column = chart.rect(40, 90, 20, 0, { tone: 'a', fill: true });
      dot = (ball as unknown as { node: { id: number } }).node.id;
      bar = (column as unknown as { node: { id: number } }).node.id;
      inc.onFrame(() => {
        ball.set({ cy: 90 - height.value * 8 });
        column.set({ y: 90 - model.energy / 2, height: model.energy / 2 });
      });
    });
    runtime.tick(0);
    const attr = (id: number, name: string) => Number(runtime.graph.nodes.get(id)!.attrs.get(name));
    expect(runtime.graph.stages).toHaveLength(2);
    expect(attr(dot, 'cy')).toBeCloseTo(74, 6);
    expect(attr(bar, 'height')).toBeCloseTo(9.8, 6);
    runtime.setParam('height', 5);
    runtime.tick(0);
    expect(attr(dot, 'cy')).toBeCloseTo(50, 6);
    expect(attr(bar, 'height')).toBeCloseTo(24.5, 6);
  });
});

