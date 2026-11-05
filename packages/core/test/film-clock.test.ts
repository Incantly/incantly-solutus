import { describe, expect, it } from 'vitest';
import type { Inc } from '../src/api/types';
import { ManualClock } from '../src/engine/clock';
import { compileTrusted } from '../src/engine/mount';
import { loadKitModules } from '../src/kits/load';
import { probeScene } from '../src/probe';
import type { SceneCommand } from '../src/protocol/scene-commands';
import type { KitRegistry } from '../src/runtime/kits';
import {
  FILM_LENGTH_CAP_SECONDS,
  FILM_STEP_SECONDS,
  SceneRuntime,
  type SceneFunction,
} from '../src/runtime/runtime';
import { REFERENCE_SCENES } from '../src/scenes';
import { validateScene } from '../src/validation';
import { compileValidated } from './helpers/compile';

const FRAME = 1 / 60;

/** A ball moved by scene time, with a readout counting the frames run. */
function latticeScene(log: Array<{ time: number; dt: number }>) {
  return (inc: Inc) => {
    const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Lattice' });
    const ball = stage.circle(10, 50, 4, { tone: 'hi' });
    stage.part('Ball', ball, { label: 'Ball', info: 'Moves with time.' });
    inc.onFrame(({ time, dt }) => {
      log.push({ time, dt });
      ball.at(10 + time * 10, 0);
    });
    inc.readout({ Frames: () => String(log.length) });
  };
}

/**
 * Drives a runtime through a ManualClock the way the renderer does: one
 * animation frame per gap, each ticking the real gap since the last frame.
 */
function pumpGaps(runtime: SceneRuntime, gapsMs: number[]): number {
  const clock = new ManualClock();
  let last = 0;
  let ticks = 0;
  expect(clock.pendingCount).toBe(0);
  for (const ms of gapsMs) {
    clock.request((now) => {
      const dt = (now - last) / 1000;
      last = now;
      runtime.tick(dt);
      ticks++;
    });
    clock.advance(ms);
  }
  expect(clock.pendingCount).toBe(0);
  return ticks;
}

function partSnapshot(runtime: SceneRuntime): string {
  return JSON.stringify(
    [...runtime.parts.parts.values()]
      .sort((a, b) => (a.name < b.name ? -1 : 1))
      .map((p) => [p.name, p.node.kind, [...p.node.attrs].sort(), p.node.text]),
  );
}

describe('film clock: fixed steps', () => {
  // Binary-exact gaps under the 0.1 s cap, totalling 0.46875 s: 28 lattice steps.
  const GAPS = [62.5, 31.25, 15.625, 7.8125, 62.5, 31.25, 15.625, 7.8125, 62.5, 31.25, 15.625, 7.8125, 62.5, 31.25, 15.625, 7.8125];

  it('advances scene time in fixed 1/60 s steps whatever the real gaps', () => {
    const log: Array<{ time: number; dt: number }> = [];
    const runtime = new SceneRuntime({ film: true });
    expect(runtime.isFilm).toBe(true);
    runtime.mount(latticeScene(log));
    const ticks = pumpGaps(runtime, GAPS);
    expect(ticks).toBe(GAPS.length);
    expect(log.length).toBe(28);
    for (const frame of log) {
      expect(frame.dt).toBe(FILM_STEP_SECONDS);
      expect(frame.time * 60).toBeCloseTo(Math.round(frame.time * 60), 9);
    }
    expect(runtime.time * 60).toBeCloseTo(28, 9);
  });

  it('draws fewer frames on a slow device, never different ones', () => {
    const irregular = new SceneRuntime({ film: true });
    const irregularLog: Array<{ time: number; dt: number }> = [];
    irregular.mount(latticeScene(irregularLog));
    const irregularCommands: SceneCommand[] = [];
    const clock = new ManualClock();
    let last = 0;
    for (const ms of GAPS) {
      clock.request((now) => {
        const dt = (now - last) / 1000;
        last = now;
        irregularCommands.push(...irregular.tick(dt).commands);
      });
      clock.advance(ms);
    }

    const regular = new SceneRuntime({ film: true });
    const regularLog: Array<{ time: number; dt: number }> = [];
    regular.mount(latticeScene(regularLog));
    const regularCommands = [];
    for (let i = 0; i < 28; i++) regularCommands.push(...regular.tick(FRAME).commands);

    // 16 ragged ticks against 28 exact ones, yet the same lattice frames.
    expect(irregularLog).toEqual(regularLog);
    expect(irregularCommands).toEqual(regularCommands);
    expect(irregular.uiState().readouts).toEqual(regular.uiState().readouts);
    expect(partSnapshot(irregular)).toBe(partSnapshot(regular));
  });

  it('matches non-film play tick for tick on a perfect display', () => {
    const filmLog: Array<{ time: number; dt: number }> = [];
    const film = new SceneRuntime({ film: true });
    film.mount(latticeScene(filmLog));
    const filmCommands = [];
    for (let i = 0; i < 30; i++) filmCommands.push(...film.tick(FRAME).commands);

    const plainLog: Array<{ time: number; dt: number }> = [];
    const plain = new SceneRuntime();
    plain.mount(latticeScene(plainLog));
    const plainCommands = [];
    for (let i = 0; i < 30; i++) plainCommands.push(...plain.tick(FRAME).commands);

    expect(filmLog).toEqual(plainLog);
    expect(filmCommands).toEqual(plainCommands);
    expect(film.uiState().readouts).toEqual(plain.uiState().readouts);
  });
});

describe('film clock: non-film behaviour unchanged', () => {
  it('is off by default and advances by the real gap', () => {
    const log: Array<{ time: number; dt: number }> = [];
    const runtime = new SceneRuntime();
    expect(runtime.isFilm).toBe(false);
    runtime.mount(latticeScene(log));
    runtime.tick(0.05);
    expect(runtime.time).toBeCloseTo(0.05, 12);
    expect(log[log.length - 1]?.dt).toBe(0.05);
    expect(log[log.length - 1]?.time).toBeCloseTo(0.05, 12);
    runtime.tick(0.03);
    expect(runtime.time).toBeCloseTo(0.08, 12);
    expect(log[log.length - 1]?.dt).toBe(0.03);
  });

  it('toggles with setFilm without leaking wall time across the switch', () => {
    const log: Array<{ time: number; dt: number }> = [];
    const runtime = new SceneRuntime();
    runtime.mount(latticeScene(log));
    runtime.setFilm(true);
    expect(runtime.isFilm).toBe(true);
    runtime.tick(FRAME);
    expect(log.length).toBe(1);
    expect(log[0]?.dt).toBe(FILM_STEP_SECONDS);
    expect(log[0]?.time).toBeCloseTo(FRAME, 12);
    runtime.setFilm(false);
    expect(runtime.isFilm).toBe(false);
    runtime.tick(0.05);
    expect(log[log.length - 1]?.dt).toBe(0.05);
  });
});

describe.each([
  ['sine-wave', 'graph'],
  ['cells', 'diagram'],
  ['buoyancy', 'physics2d'],
  ['seasons', 'space3d'],
] as const)('film clock: seek equals play on %s (%s)', (id, kind) => {
  async function setup() {
    const source = REFERENCE_SCENES[id]!;
    // The label names what the scene must exercise, so a scene that drifts fails loudly.
    if (kind === 'graph' || kind === 'diagram') expect(source.plan.kind).toBe(kind);
    else expect(validateScene(source).scene?.kits).toContain(kind);
    const kits: KitRegistry = await loadKitModules(validateScene(source).scene?.kits ?? []);
    const scene = compileTrusted(source.js);
    const play = (seconds: number) => {
      const runtime = new SceneRuntime({ kits });
      runtime.mount(scene);
      const frames = Math.round(seconds / FRAME);
      for (let i = 0; i < frames; i++) runtime.tick(FRAME);
      return runtime;
    };
    const seek = (seconds: number) => {
      const runtime = new SceneRuntime({ kits });
      runtime.mount(scene);
      const update = runtime.seek(seconds);
      return { runtime, update };
    };
    return { play, seek };
  }

  it.each([0.5, 1, 2])('seeking to %s s draws what playing there draws', async (seconds) => {
    const { play, seek } = await setup();
    const played = play(seconds);
    const { runtime: sought, update } = seek(seconds);
    expect(update.reset).toBe(true);
    expect(sought.time).toBeCloseTo(played.time, 9);
    expect(sought.uiState().readouts).toEqual(played.uiState().readouts);
    expect(partSnapshot(sought)).toBe(partSnapshot(played));
    // The single drawing update rebuilds the final state exactly.
    expect(update.commands).toEqual(played.fullState().commands);
    expect(played.errors).toEqual([]);
    expect(sought.errors).toEqual([]);
  });

  it('keeps a paused figure paused at the new time', async () => {
    const { play } = await setup();
    const played = play(1);
    const source = REFERENCE_SCENES[id]!;
    const kits: KitRegistry = await loadKitModules(validateScene(source).scene?.kits ?? []);
    const runtime = new SceneRuntime({ kits });
    runtime.mount(compileTrusted(source.js));
    runtime.pause();
    runtime.seek(1);
    expect(runtime.playing).toBe(false);
    expect(runtime.time).toBeCloseTo(played.time, 9);
    expect(partSnapshot(runtime)).toBe(partSnapshot(played));
  });
});

describe('film clock: seek cap and hooks', () => {
  it('clamps to the scene-length cap of 60 s', () => {
    expect(FILM_LENGTH_CAP_SECONDS).toBe(60);
    const runtime = new SceneRuntime();
    runtime.mount(latticeScene([]));
    runtime.seek(120);
    expect(runtime.time).toBeCloseTo(60, 9);
  });

  it('clamps nonsense targets to the start', () => {
    const runtime = new SceneRuntime();
    runtime.mount(latticeScene([]));
    runtime.seek(-3);
    expect(runtime.time).toBe(0);
    runtime.seek(Number.NaN);
    expect(runtime.time).toBe(0);
  });

  it('lets the host tune the cap', () => {
    const runtime = new SceneRuntime({ filmCapSeconds: 10 });
    runtime.mount(latticeScene([]));
    runtime.seek(120);
    expect(runtime.time).toBeCloseTo(10, 9);
    const invalid = new SceneRuntime({ filmCapSeconds: Number.NaN });
    invalid.mount(latticeScene([]));
    invalid.seek(120);
    expect(invalid.time).toBeCloseTo(60, 9);
  });

  it('refuels before the restart and every replayed step', () => {
    const runtime = new SceneRuntime();
    runtime.mount(latticeScene([]));
    let calls = 0;
    runtime.seek(0.5, { beforeStep: () => calls++ });
    expect(calls).toBe(1 + Math.round(0.5 / FILM_STEP_SECONDS));
  });

  it('does nothing without a scene', () => {
    const runtime = new SceneRuntime();
    expect(runtime.seek(1).commands).toEqual([]);
  });
});

describe('film clock: probe seek check', () => {
  const HTML = "<div id='stage'></div>";

  function healthy(): string {
    return [
      "inc.idea('A taller bar means a bigger number.');",
      "const h = inc.param('height', { min: 1, max: 9, step: 1, value: 4, label: 'Height' });",
      "const stage = inc.svg('#stage', { viewBox: [0, 0, 100, 100], title: 'Bar', description: 'One bar.' });",
      "const bar = stage.rect(40, 50, 20, 40, { tone: 'lit' });",
      "stage.part('Bar', bar, { label: 'Bar', info: 'Its height is the number.' });",
      'inc.onFrame(() => { bar.set({ y: 90 - h.value * 10, height: h.value * 10 }); });',
      "inc.describe(() => 'A bar ' + h.value + ' units tall.');",
      "inc.steps([{ say: 'Look at the bar.', focus: 'Bar' }, { say: 'Make it taller.', set: { height: 8 } }]);",
    ].join('\n');
  }

  /** State outside the SDK: the seek's restart does not reset it, so replayed frames drift. */
  function outsideStateScene(): SceneFunction {
    let frames = 0;
    return (inc: Inc) => {
      const h = inc.param('height', { min: 1, max: 9, step: 1, value: 4, label: 'Height' });
      inc.idea('A ball drifts right as time passes.');
      const stage = inc.svg('#stage', { viewBox: [0, 0, 400, 100], title: 'Drift', description: 'A drifting ball.' });
      const ball = stage.circle(10, 50, 4, { tone: 'hi' });
      stage.part('Ball', ball, { label: 'Ball', info: 'Drifts with time.' });
      inc.onFrame(() => {
        frames++;
        ball.at(((frames * 10) % 380) + 10, h.value * 5);
      });
      inc.describe(() => 'A drifting ball.');
      inc.steps([{ say: 'Watch it drift.', focus: 'Ball' }]);
    };
  }

  it('passes a healthy scene', () => {
    const { scene, fuel } = compileValidated({ html: HTML, css: '', js: healthy() });
    const report = probeScene(scene, { beforeStep: fuel.refuel, spec: { parts: ['Bar'], steps: 2 } });
    expect(report.failures).toEqual([]);
  });

  it('fails a scene that keeps state outside the SDK', () => {
    const report = probeScene(outsideStateScene(), { spec: { parts: ['Ball'], steps: 1 } });
    expect(report.ok).toBe(false);
    expect(report.failures.length).toBeGreaterThan(0);
    expect(report.failures.every((f) => f.check === 'seek')).toBe(true);
    expect(report.failures[0]?.time).toBe(0.5);
  });
});

describe('film clock: bench', () => {
  it(
    'seeking a 60 s physics scene and a 60 s 3D scene',
    async () => {
      // Sine-wave replays every step (it reads time); the others idle when their frames stop changing.
      for (const id of ['buoyancy', 'seasons', 'sine-wave'] as const) {
        const source = REFERENCE_SCENES[id]!;
        const kits: KitRegistry = await loadKitModules(validateScene(source).scene?.kits ?? []);
        const scene = compileTrusted(source.js);
        const played = new SceneRuntime({ kits });
        played.mount(scene);
        for (let i = 0; i < 3600; i++) played.tick(FRAME);
        const runtime = new SceneRuntime({ kits });
        runtime.mount(scene);
        const start = performance.now();
        runtime.seek(60);
        const ms = performance.now() - start;
        console.log(`[film-bench] seek 60 s ${id}: ${ms.toFixed(1)} ms`);
        expect(runtime.time).toBeCloseTo(played.time, 6);
        expect(partSnapshot(runtime)).toBe(partSnapshot(played));
        expect(runtime.errors).toEqual([]);
      }
    },
    120000,
  );
});
