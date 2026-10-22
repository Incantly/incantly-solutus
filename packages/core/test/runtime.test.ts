import { describe, expect, it } from 'vitest';
import type { Inc } from '../src/api/types';
import { SceneRuntime, type RuntimeOptions } from '../src/runtime/runtime';

const FRAME = 1 / 60;

function mount(scene: (inc: Inc) => void, options: RuntimeOptions = {}) {
  const runtime = new SceneRuntime(options);
  const first = runtime.mount((inc) => scene(inc));
  return { runtime, first };
}

/** A small scene: one parameter, a model, a ball moved by onFrame and a readout. */
function ballScene(log: { frames: Array<{ time: number; dt: number }>; model: number }) {
  return (inc: Inc) => {
    const speed = inc.param('speed', { min: 0, max: 10, step: 0.5, value: 2, unit: 'm/s' });
    const model = inc.model(({ speed: v = 0 }) => {
      log.model++;
      return { v, x: (t: number) => v * t };
    });
    const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Ball' });
    const ball = stage.circle(0, 50, 4, { tone: 'hi' });
    inc.onFrame(({ time, dt }) => {
      log.frames.push({ time, dt });
      ball.at(model.x(time), 0);
    });
    inc.readout({ Speed: () => speed.value.toFixed(1) + ' m/s' });
  };
}

describe('scene runtime: mounting', () => {
  it('declares parameters, stages and readouts when the scene starts', () => {
    const log = { frames: [] as Array<{ time: number; dt: number }>, model: 0 };
    const { first } = mount(ballScene(log));
    expect(first.commands[0]).toMatchObject({ op: 'stage', selector: '#stage' });
    expect(first.ui.params).toEqual([
      expect.objectContaining({ name: 'speed', min: 0, max: 10, step: 0.5, value: 2, defaultValue: 2, unit: 'm/s' }),
    ]);
    expect(first.needsFrame).toBe(true);
    expect(log.frames).toEqual([]);
  });

  it('records a mount error and stops drawing', () => {
    const { runtime, first } = mount(() => {
      throw new Error('boom');
    });
    expect(first.ui.error).toEqual({ phase: 'mount', message: 'boom' });
    expect(runtime.needsFrame()).toBe(false);
    expect(runtime.isMounted).toBe(false);
  });

  it('allows at most eight controls, or fewer when the host says so', () => {
    const { first } = mount((inc) => {
      for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) inc.param(name, { min: 0, max: 1, value: 0 });
    });
    expect(first.ui.error?.message).toBe('A figure has at most 8 adjustable parameters');
    const small = new SceneRuntime({ maxParams: 3 });
    const update = small.mount((inc) => {
      for (const name of ['a', 'b', 'c', 'd']) inc.param(name, { min: 0, max: 1, value: 0 });
    });
    expect(update.ui.error?.message).toBe('A figure has at most 3 adjustable parameters');
  });

  it.each([
    [{ min: 1, max: 0, value: 0 }, 'needs min < max'],
    [{ min: 0, max: 1, value: 2 }, 'outside [0, 1]'],
    [{ min: 0, max: Number.NaN, value: 0 }, 'needs finite'],
    [{ min: 0, max: 1, value: 0, step: -1 }, 'positive step'],
  ])('rejects invalid parameter options %j', (options, message) => {
    const { first } = mount((inc) => {
      inc.param('p', options);
    });
    expect(first.ui.error?.message).toContain(message);
  });

  it('enforces the one-model rule and mount-only declarations', () => {
    expect(
      mount((inc) => {
        inc.model(() => ({}));
        inc.model(() => ({}));
      }).first.ui.error?.message,
    ).toContain('exactly one model');

    const { runtime } = mount((inc) => {
      inc.onFrame(() => inc.param('late', { min: 0, max: 1, value: 0 }));
    });
    const update = runtime.tick(FRAME);
    expect(update.ui.error).toEqual({ phase: 'frame', message: 'inc.param must be called when the scene starts, not later' });
  });

  it('restores learner values instead of defaults', () => {
    const { runtime } = mount(ballScene({ frames: [], model: 0 }), { values: { speed: 7.3 } });
    expect(runtime.values()).toEqual({ speed: 7.5 });
  });
});

describe('scene runtime: one loop and dirty rendering', () => {
  it('advances time only while playing, with dt capped', () => {
    const log = { frames: [] as Array<{ time: number; dt: number }>, model: 0 };
    const { runtime } = mount(ballScene(log));
    runtime.tick(FRAME);
    runtime.tick(5); // a backgrounded tab: capped at maxDt
    expect(log.frames.map((f) => f.dt)).toEqual([FRAME, 0.05]);
    expect(runtime.time).toBeCloseTo(FRAME + 0.05, 12);
  });

  it('does no work while paused and clean', () => {
    const log = { frames: [] as Array<{ time: number; dt: number }>, model: 0 };
    const { runtime } = mount(ballScene(log));
    runtime.tick(FRAME);
    runtime.pause();
    expect(runtime.needsFrame()).toBe(false);
    const before = log.frames.length;
    for (let i = 0; i < 10; i++) expect(runtime.tick(FRAME).commands).toEqual([]);
    expect(log.frames.length).toBe(before);
    expect(runtime.stats.idleTicks).toBe(10);
  });

  it('redraws once with dt = 0 when a parameter changes while paused', () => {
    const log = { frames: [] as Array<{ time: number; dt: number }>, model: 0 };
    const { runtime } = mount(ballScene(log), { autoplay: false });
    runtime.tick(FRAME); // the initial still frame
    expect(runtime.needsFrame()).toBe(false);
    const time = runtime.time;

    runtime.setParam('speed', 6);
    expect(runtime.needsFrame()).toBe(true);
    const update = runtime.tick(FRAME);
    expect(log.frames.at(-1)).toEqual({ time, dt: 0 });
    expect(runtime.time).toBe(time);
    expect(update.values).toEqual({ speed: 6 });
    expect(update.ui.readouts).toEqual([{ label: 'Speed', text: '6.0 m/s' }]);
    expect(runtime.needsFrame()).toBe(false);
  });

  it('coalesces many parameter changes into one paused redraw', () => {
    const log = { frames: [] as Array<{ time: number; dt: number }>, model: 0 };
    const { runtime } = mount(ballScene(log), { autoplay: false });
    runtime.tick(FRAME);
    const frames = log.frames.length;
    for (const v of [1, 2, 3, 4, 5]) runtime.setParam('speed', v);
    runtime.tick(FRAME);
    expect(log.frames.length).toBe(frames + 1);
  });

  it('clamps and snaps parameter values to the declared step', () => {
    const { runtime } = mount(ballScene({ frames: [], model: 0 }));
    runtime.setParam('speed', 3.26);
    expect(runtime.values().speed).toBe(3.5);
    runtime.setParam('speed', 99);
    expect(runtime.values().speed).toBe(10);
    runtime.setParam('speed', Number.NaN);
    runtime.setParam('missing', 1);
    expect(runtime.values()).toEqual({ speed: 10 });
  });

  it('applies speed to scene time', () => {
    const log = { frames: [] as Array<{ time: number; dt: number }>, model: 0 };
    const { runtime } = mount(ballScene(log));
    runtime.setSpeed(2);
    runtime.tick(0.01);
    expect(runtime.time).toBeCloseTo(0.02, 12);
    runtime.setSpeed(3.5); // not an offered speed: snaps to the nearest one
    expect(runtime.speed).toBe(4);
  });

  it('stops drawing off-screen and redraws when visible again', () => {
    const { runtime } = mount(ballScene({ frames: [], model: 0 }));
    runtime.tick(FRAME);
    runtime.setVisible(false);
    expect(runtime.needsFrame()).toBe(false);
    runtime.setVisible(true);
    runtime.pause();
    expect(runtime.needsFrame()).toBe(true);
  });

  it('starts paused in a still state under reduced motion', () => {
    const log = { frames: [] as Array<{ time: number; dt: number }>, model: 0 };
    const { runtime, first } = mount(ballScene(log), { reducedMotion: true });
    expect(first.ui.playing).toBe(false);
    runtime.tick(FRAME);
    expect(log.frames).toEqual([{ time: 0, dt: 0 }]);
    expect(runtime.needsFrame()).toBe(false);
  });

  it('does nothing after destroy', () => {
    const log = { frames: [] as Array<{ time: number; dt: number }>, model: 0 };
    const { runtime } = mount(ballScene(log));
    runtime.destroy();
    expect(runtime.needsFrame()).toBe(false);
    runtime.tick(FRAME);
    expect(log.frames).toEqual([]);
  });
});

describe('scene runtime: model and readouts', () => {
  it('recomputes the model only when a parameter changes', () => {
    const log = { frames: [] as Array<{ time: number; dt: number }>, model: 0 };
    const { runtime } = mount(ballScene(log));
    for (let i = 0; i < 5; i++) runtime.tick(FRAME);
    expect(log.model).toBe(1);
    runtime.setParam('speed', 3);
    runtime.tick(FRAME);
    expect(log.model).toBe(2);
  });

  it('keeps the model read-only', () => {
    const { first } = mount((inc) => {
      const model = inc.model(() => ({ a: 1 }));
      (model as { a: number }).a = 2;
    });
    expect(first.ui.error?.message).toContain('read-only');
  });

  it('publishes readouts only when their text changes', () => {
    const { runtime } = mount(ballScene({ frames: [], model: 0 }));
    expect(runtime.tick(FRAME).ui.readouts).toEqual([{ label: 'Speed', text: '2.0 m/s' }]);
    expect(runtime.tick(FRAME).ui.readouts).toBeUndefined();
  });

  it('shows a dash and records a diagnostic for a non-finite readout', () => {
    const { runtime } = mount((inc) => {
      inc.readout({ Ratio: () => 1 / 0 });
    });
    expect(runtime.tick(FRAME).ui.readouts).toEqual([{ label: 'Ratio', text: '—' }]);
    expect(runtime.graph.diagnostics[0]?.message).toContain('Readout "Ratio" is Infinity');
  });
});

describe('scene runtime: error boundary', () => {
  it('pauses on a frame error, keeps controls, and recovers on a good frame', () => {
    const { runtime } = mount((inc) => {
      const p = inc.param('p', { min: 0, max: 1, step: 1, value: 0 });
      inc.onFrame(() => {
        if (p.value === 1) throw new TypeError('bad frame');
      });
    });
    runtime.setParam('p', 1);
    const failed = runtime.tick(FRAME);
    expect(failed.ui.error).toEqual({ phase: 'frame', message: 'bad frame' });
    expect(runtime.playing).toBe(false);
    expect(runtime.uiState().params).toHaveLength(1);

    runtime.setParam('p', 0);
    const recovered = runtime.tick(FRAME);
    expect(recovered.ui.error).toBeNull();
  });
});

describe('scene runtime: determinism, restart and reset', () => {
  function randomScene(inc: Inc) {
    const stage = inc.svg('#s', { viewBox: [0, 0, 100, 100], title: 'Dots' });
    const dot = stage.circle(inc.random() * 100, inc.random() * 100, 2);
    inc.onFrame(({ time }) => dot.at(Math.sin(time) * 10, inc.random()));
  }

  it('produces identical commands for the same seed and ticks', () => {
    const run = (seed: number) => {
      const runtime = new SceneRuntime({ seed });
      const out = [runtime.mount(randomScene).commands];
      for (let i = 0; i < 30; i++) out.push(runtime.tick(FRAME).commands);
      return JSON.stringify(out);
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(8));
  });

  it('restarts at time zero with the learner values kept', () => {
    const { runtime } = mount(ballScene({ frames: [], model: 0 }));
    runtime.setParam('speed', 4);
    for (let i = 0; i < 10; i++) runtime.tick(FRAME);
    const update = runtime.restart();
    expect(update.reset).toBe(true);
    expect(update.commands[0]).toMatchObject({ op: 'stage' });
    expect(runtime.time).toBe(0);
    expect(runtime.values()).toEqual({ speed: 4 });
  });

  it('resets to the authored defaults and reports them for persistence', () => {
    const { runtime } = mount(ballScene({ frames: [], model: 0 }));
    runtime.setParam('speed', 9);
    const update = runtime.reset();
    expect(runtime.values()).toEqual({ speed: 2 });
    expect(update.values).toEqual({ speed: 2 });
  });
});

describe('formulas and tweens', () => {
  it('binds formula variables to parameters and keeps the source', () => {
    let wave: ReturnType<Inc['formula']> | undefined;
    const { runtime } = mount((inc) => {
      const A = inc.param('A', { min: 0, max: 4, step: 0.1, value: 2 });
      wave = inc.formula('A*sin(x - t)', { vars: { A } });
    });
    expect(wave?.source).toBe('A*sin(x - t)');
    expect(wave?.variables).toEqual(['A', 'x', 't']);
    expect(wave?.(Math.PI / 2, 0)).toBeCloseTo(2, 12);
    runtime.setParam('A', 3);
    expect(wave?.(Math.PI / 2, 0)).toBeCloseTo(3, 12);
    expect(wave?.evaluate({ x: Math.PI / 2, t: 0, A: 1 })).toBeCloseTo(1, 12);
  });

  it('reports formula errors with their position', () => {
    const { first } = mount((inc) => {
      inc.formula('A*sin(x)', { vars: {} });
    });
    expect(first.ui.error?.message).toBe('Formula "A*sin(x)": Unknown variable "A" at position 0. Use a parameter by its own name, or bind it: { vars: { A: aParameter } }');
    // A parameter is a formula variable by its own name.
    let law: ReturnType<Inc['formula']> | undefined;
    const named = mount((inc) => {
      inc.param('temperature', { min: 200, max: 600, value: 300 });
      inc.param('volume', { min: 1, max: 5, value: 2 });
      law = inc.formula('0.8314*temperature/volume');
      inc.formula('T/V');
    });
    expect(law?.(0)).toBeCloseTo((0.8314 * 300) / 2, 9);
    expect(named.first.ui.error?.message).toBe('Formula "T/V": Unknown variable "T" at position 0. Use a parameter by its own name (temperature, volume), or bind it: { vars: { T: aParameter } }');
    expect(
      mount((inc) => {
        inc.formula('sin(x', {});
      }).first.ui.error?.message,
    ).toBe('Formula "sin(x": Expected ")" to close the call to sin at position 5');
    expect(
      mount((inc) => {
        inc.formula('x', { vars: { t: 1 } });
      }).first.ui.error?.message,
    ).toContain('"t" is reserved');
    expect(
      mount((inc) => {
        inc.formula('x*k', { vars: { k: {} as never } });
      }).first.ui.error?.message,
    ).toContain('must be a parameter or a finite number');
  });

  it('drives frames while a tween runs, even when paused, then commits', () => {
    const ks: number[] = [];
    let committed = false;
    const { runtime } = mount(
      (inc) => {
        inc.tween({ duration: 0.1, ease: 'linear', apply: (k) => ks.push(k), commit: () => (committed = true) });
      },
      { autoplay: false },
    );
    runtime.tick(0.05);
    expect(runtime.needsFrame()).toBe(true);
    runtime.tick(0.05);
    expect(ks).toEqual([0.5, 1]);
    expect(committed).toBe(true);
    expect(runtime.needsFrame()).toBe(false);
  });
});

describe('scene runtime: still scenes', () => {
  const still = (inc: Inc) => {
    const k = inc.param('k', { min: 0, max: 10, value: 2 });
    const stage = inc.svg('#s', { viewBox: [0, 0, 100, 100], title: 'Still' });
    const bar = stage.line(0, 0, 0, 0);
    inc.onFrame(() => bar.set({ x2: k.value * 10 }));
  };

  it('stops asking for frames once a playing scene shows it never reads time', () => {
    const runtime = new SceneRuntime({ autoplay: true });
    expect(runtime.mount(still).ui.animated).toBeNull();
    expect(runtime.tick(FRAME).ui.animated).toBe(false);
    expect(runtime.playing).toBe(true);
    expect(runtime.needsFrame()).toBe(false);
    runtime.tick(FRAME);
    expect(runtime.stats.idleTicks).toBe(1);
    runtime.setParam('k', 5);
    expect(runtime.needsFrame()).toBe(true);
    runtime.tick(FRAME);
    expect(runtime.needsFrame()).toBe(false);
  });

  it('keeps animating a scene whose frames read time, or whose plot follows t', () => {
    const reads = new SceneRuntime();
    reads.mount((inc) => {
      const stage = inc.svg('#s', { viewBox: [0, 0, 1, 1], title: 'T' });
      const dot = stage.circle(0, 0, 1);
      inc.onFrame(({ time }) => dot.at(time, 0));
    });
    expect(reads.tick(FRAME).ui.animated).toBe(true);
    expect(reads.needsFrame()).toBe(true);

    const plots = new SceneRuntime();
    plots.mount((inc) => {
      const g = inc.graph2d('#g', { x: [0, 1], y: [-1, 1], title: 'G' });
      g.plot(inc.formula('sin(x - t)'));
    });
    plots.tick(FRAME);
    expect(plots.uiState().animated).toBe(true);
    expect(plots.needsFrame()).toBe(true);
  });

  it('forgets what it learned when the scene is rebuilt', () => {
    const runtime = new SceneRuntime({ autoplay: true });
    runtime.mount(still);
    runtime.tick(FRAME);
    expect(runtime.restart().ui.animated).toBeNull();
  });
});
