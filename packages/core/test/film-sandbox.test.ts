import { describe, expect, it } from 'vitest';
import {
  applyCueState,
  beatCueState,
  compileFilm,
  compileTrusted,
  FilmController,
  handleRendererMessage,
  mountStubRuntime,
  probeFilmStatic,
  probeScene,
  pushAbsoluteState,
  sanitizeProbedSnapshot,
  SandboxFilmMirror,
  SceneRuntime,
  SIXTY_SECOND_FILM,
  THIRTY_SECOND_FILM,
  type Beat,
  type CompiledFilm,
  type FigureHandle,
  type FigureState,
  type SanitizedSceneSnapshot,
} from '../src/index';
import { parseHostMessage } from '../src/protocol/bridge';
import { trustFixture } from './helpers/film';

/**
 * Generated films play sandboxed: beats come from the probe's snapshot, a
 * stand-in runtime keeps the film clock on the host, and the mirror plays
 * every cue into the figure. The scene's script never runs on the host.
 */

async function snapshotOf(fixture: typeof THIRTY_SECOND_FILM): Promise<{ film: CompiledFilm; snapshots: SanitizedSceneSnapshot[] }> {
  const trusted = await trustFixture(fixture);
  const snapshots: SanitizedSceneSnapshot[] = [];
  for (const scene of trusted.scenes) {
    const report = probeScene(scene.scene, { seed: 1 });
    expect(report.ok).toBe(true);
    expect(report.snapshot).toBeDefined();
    const sanitized = sanitizeProbedSnapshot(report.snapshot);
    if (!sanitized) throw new Error('The fixture snapshot did not sanitize');
    snapshots.push(sanitized);
  }
  return { film: trusted.film, snapshots };
}

function mountedStub(snapshot: SanitizedSceneSnapshot): SceneRuntime {
  const runtime = mountStubRuntime(snapshot, { seed: 1 });
  expect(runtime.isMounted).toBe(true);
  return runtime;
}

class RecordingHandle implements FigureHandle {
  state: FigureState = 'live';
  readonly ready = Promise.resolve<FigureState>('live');
  readonly calls: Array<{ readonly method: string; readonly args: readonly unknown[] }> = [];
  pause(): void {
    this.calls.push({ method: 'pause', args: [] });
  }
  resume(): void {
    this.calls.push({ method: 'resume', args: [] });
  }
  setValues(values: Readonly<Record<string, number>>): void {
    this.calls.push({ method: 'setValues', args: [{ ...values }] });
  }
  restore(state: { readonly values?: Readonly<Record<string, number>>; readonly step?: number | null }): void {
    this.calls.push({ method: 'restore', args: [{ ...state }] });
  }
  setReducedMotion(value: boolean): void {
    this.calls.push({ method: 'setReducedMotion', args: [value] });
  }
  seek(seconds: number): void {
    this.calls.push({ method: 'seek', args: [seconds] });
  }
  setPlaying(value: boolean): void {
    this.calls.push({ method: 'setPlaying', args: [value] });
  }
  setSpeed(value: number): void {
    this.calls.push({ method: 'setSpeed', args: [value] });
  }
  focusPart(name: string | null): void {
    this.calls.push({ method: 'focusPart', args: [name] });
  }
  setPartVisible(name: string, visible: boolean): void {
    this.calls.push({ method: 'setPartVisible', args: [name, visible] });
  }
  note(note: { readonly wave: 'sine'; readonly frequency: number; readonly duration: number; readonly gain: number }): void {
    this.calls.push({ method: 'note', args: [{ ...note }] });
  }
  framePart(part: string | null, zoom?: number): void {
    this.calls.push({ method: 'framePart', args: [part, zoom] });
  }
  setStyle(): void {}
  setTheme(): void {}
  setNumber(): void {}
  focus(): void {}
  measure(): null {
    return null;
  }
  snapshot(): Promise<null> {
    return Promise.resolve(null);
  }
  exportSvg(): Promise<null> {
    return Promise.resolve(null);
  }
  exportClip(): Promise<null> {
    return Promise.resolve(null);
  }
  destroy(): void {
    this.state = 'destroyed';
  }
  of(method: string): Array<readonly unknown[]> {
    return this.calls.filter((call) => call.method === method).map((call) => call.args);
  }
}

describe('film sandbox: snapshots', () => {
  it('captures a scene as data at mount, before the probe moves anything', async () => {
    const { snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const snapshot = snapshots[0]!;
    expect(snapshot.steps.length).toBeGreaterThan(0);
    expect(snapshot.steps.every((step) => typeof step.say === 'string' && step.say !== '')).toBe(true);
    expect(snapshot.params.length).toBeGreaterThan(0);
    expect(snapshot.parts).toContain('Pivot');
    expect(snapshot.stage).toEqual({ width: 600, height: 400 });
  });

  it('compiles the same film from snapshots as from mounted scenes', async () => {
    const trusted = await trustFixture(THIRTY_SECOND_FILM);
    const { snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const sources = snapshots.map((snapshot, index) => ({
      id: trusted.scenes[index]!.id,
      js: THIRTY_SECOND_FILM.scenes[index]!.js,
      steps: [...snapshot.steps],
    }));
    const compiled = compileFilm(JSON.parse(JSON.stringify(THIRTY_SECOND_FILM.storyboard)), sources);
    expect(compiled.ok).toBe(true);
    const film = compiled.film!;
    expect(film.beats.map((beat) => [beat.id, beat.start, beat.seconds])).toEqual(
      trusted.film.beats.map((beat) => [beat.id, beat.start, beat.seconds]),
    );
    expect(film.beats.map((beat) => beat.step)).toEqual(trusted.film.beats.map((beat) => beat.step));
  });

  it('rejects snapshots that smuggle code, shapes or ranges across', async () => {
    const { snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const honest = JSON.parse(JSON.stringify(snapshots[0])) as Record<string, unknown>;
    const mutate = (fn: (copy: Record<string, unknown>) => void): unknown => {
      const copy = JSON.parse(JSON.stringify(honest)) as Record<string, unknown>;
      fn(copy);
      return copy;
    };
    expect(sanitizeProbedSnapshot(mutate((c) => ((c.steps as Record<string, unknown>[])[0]!.say = 42)))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => ((c.steps as Record<string, unknown>[])[0]!.say = 'x'.repeat(2001))))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => ((c.steps as Record<string, unknown>[])[0]!.set = { angle: Number.NaN })))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => ((c.steps as Record<string, unknown>[])[0]!.cam = { to: 'Bob', zoom: 'near' })))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => ((c.steps as Record<string, unknown>[])[0]!.mark = [{ type: 'zap', part: 'Bob' }])))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => ((c.steps as Record<string, unknown>[])[0]!.view = 'behind')))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.steps = [])))).toBeNull();
    expect(
      sanitizeProbedSnapshot(mutate((c) => {
        c.steps = Array.from({ length: 9 }, () => ({ say: 'Too many steps' }));
      })),
    ).toBeNull();
    const firstParam = (c: Record<string, unknown>): Record<string, unknown> => (c.params as Array<Record<string, unknown>>)[0]!;
    const stepParamMin = (c: Record<string, unknown>): void => {
      firstParam(c).min = 5;
    };
    const stepParamValue = (c: Record<string, unknown>): void => {
      firstParam(c).value = 999;
    };
    expect(sanitizeProbedSnapshot(mutate(stepParamMin))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate(stepParamValue))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.hidden = ['NoSuchPart'])))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.stage = { width: -3, height: 400 })))).toBeNull();
    expect(sanitizeProbedSnapshot(mutate((c) => (c.parts = ['a', 'a'])))).toBeNull();
    expect(sanitizeProbedSnapshot({})).toBeNull();
    expect(sanitizeProbedSnapshot(null)).toBeNull();
  });

  it('keeps a prediction without a crossable answer as a pause point', async () => {
    const { snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const honest = JSON.parse(JSON.stringify(snapshots[0])) as { steps: Array<Record<string, unknown>> };
    honest.steps[0]!.predict = { question: 'Which way?', options: ['Left', 'Right'] };
    const sanitized = sanitizeProbedSnapshot(honest);
    expect(sanitized?.steps[0]?.predict).toMatchObject({ question: 'Which way?', answer: -1 });
  });
});

describe('film sandbox: stand-ins', () => {
  it('mounts the same beats, params and parts the scene registered', async () => {
    const { snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const runtime = mountedStub(snapshots[0]!);
    expect(runtime.beats()?.map((step) => step.say)).toEqual(snapshots[0]!.steps.map((step) => step.say));
    expect(runtime.values()).toEqual(Object.fromEntries(snapshots[0]!.params.map((p) => [p.name, p.value])));
    expect([...runtime.parts.parts.keys()].sort()).toEqual([...snapshots[0]!.parts].sort());
    for (const name of snapshots[0]!.hidden) expect(runtime.parts.parts.get(name)?.node.hidden).toBe(true);
  });

  it('steps, focuses and shows like the scene for the controller', async () => {
    const { film, snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const runtime = mountedStub(snapshots[0]!);
    const controller = new FilmController({ runtime, film });
    expect(controller.duration).toBeCloseTo(film.seconds, 9);
    controller.seek(film.beats[2]!.start);
    expect(controller.currentBeat?.id).toBe(film.beats[2]!.id);
    expect(runtime.currentStep).toBe(film.beats[2]!.index);
  });
});

describe('film sandbox: cue messages', () => {
  it('applies part visibility, notes and framing through the shared channel', async () => {
    const { snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const runtime = mountedStub(snapshots[0]!);
    const before = runtime.parts.parts.get('Pivot')!.node.hidden;
    handleRendererMessage(runtime, { type: 'partVisible', name: 'Pivot', visible: !before });
    expect(runtime.parts.parts.get('Pivot')!.node.hidden).toBe(!(!before));
    handleRendererMessage(runtime, { type: 'partVisible', name: 'NoSuchPart', visible: true });
    const noted = handleRendererMessage(runtime, { type: 'note', wave: 'sine', frequency: 660, duration: 0.12, gain: 0.5 });
    expect(noted?.commands.some((command) => command.op === 'note')).toBe(true);
    // A stand-in owns no kit cameras, so framing is a silent no-op rather than a throw.
    expect(() => handleRendererMessage(runtime, { type: 'framePart', part: 'Pivot', zoom: 1.5 })).not.toThrow();
    expect(() => handleRendererMessage(runtime, { type: 'framePart', part: null, zoom: 1 })).not.toThrow();
  });

  it('validates the film bridge messages and rejects malformed ones', () => {
    const channel = 'test-channel';
    expect(parseHostMessage({ v: 1, channel, type: 'playing', value: true }, channel)?.type).toBe('playing');
    expect(parseHostMessage({ v: 1, channel, type: 'speed', value: 2 }, channel)?.type).toBe('speed');
    expect(parseHostMessage({ v: 1, channel, type: 'focusPart', name: 'Bob' }, channel)?.type).toBe('focusPart');
    expect(parseHostMessage({ v: 1, channel, type: 'partVisible', name: 'Bob', visible: true }, channel)?.type).toBe('partVisible');
    expect(
      parseHostMessage({ v: 1, channel, type: 'note', wave: 'sine', frequency: 660, duration: 0.12, gain: 0.5 }, channel)?.type,
    ).toBe('note');
    expect(parseHostMessage({ v: 1, channel, type: 'frame', part: 'Bob', zoom: 1.5 }, channel)?.type).toBe('frame');
    expect(parseHostMessage({ v: 1, channel, type: 'playing', value: 'yes' }, channel)).toBeNull();
    expect(parseHostMessage({ v: 1, channel, type: 'speed', value: Number.NaN }, channel)).toBeNull();
    expect(parseHostMessage({ v: 1, channel, type: 'focusPart', name: 42 }, channel)).toBeNull();
    expect(parseHostMessage({ v: 1, channel, type: 'partVisible', name: 'x'.repeat(61), visible: true }, channel)).toBeNull();
    expect(
      parseHostMessage({ v: 1, channel, type: 'note', wave: 'scream', frequency: 660, duration: 0.12, gain: 0.5 }, channel),
    ).toBeNull();
    expect(
      parseHostMessage({ v: 1, channel, type: 'note', wave: 'sine', frequency: -5, duration: 0.12, gain: 0.5 }, channel),
    ).toBeNull();
    expect(parseHostMessage({ v: 1, channel, type: 'frame', part: 'Bob', zoom: Number.POSITIVE_INFINITY }, channel)).toBeNull();
    expect(parseHostMessage({ v: 1, channel, type: 'playing', value: true }, 'other-channel')).toBeNull();
  });
});

describe('film sandbox: the mirror', () => {
  async function mirrored(): Promise<{ film: CompiledFilm; controller: FilmController; mirror: SandboxFilmMirror; handle: RecordingHandle }> {
    const { film, snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const stub = mountedStub(snapshots[0]!);
    const handle = new RecordingHandle();
    const current = film;
    const controller = new FilmController({ runtime: stub, film });
    const mirror = new SandboxFilmMirror(controller, [{ id: 's1', stub, handle }], () => current);
    return { film, controller, mirror, handle };
  }

  it('plays beats as steps, focus, visibility, camera and sound', async () => {
    const { film, controller, mirror, handle } = await mirrored();
    controller.play();
    expect(handle.of('setPlaying')).toContainEqual([true]);
    // The focused first beat lands its step and focus.
    expect(handle.of('restore').some((args) => (args[0] as { step?: number }).step === 0)).toBe(true);
    expect(handle.of('focusPart')).toContainEqual(['Pivot']);
    // The camera beat frames its part; a seek elsewhere sends no new framing.
    controller.seek(film.beats[2]!.start);
    expect(handle.of('framePart')).toContainEqual(['Bob', 1.5]);
    const framed = handle.of('framePart').length;
    controller.seek(film.beats[3]!.start);
    expect(handle.of('framePart')).toHaveLength(framed);
    // Playing forward out of the camera beat, the next beat returns to wide.
    controller.seek(film.beats[2]!.start);
    controller.play();
    for (let i = 0; i < 600 && controller.currentBeat?.id === film.beats[2]!.id; i++) controller.tick(1 / 30);
    expect(controller.currentBeat?.id).toBe(film.beats[3]!.id);
    expect(handle.of('framePart').slice(-1)).toEqual([[null, undefined]]);
    // The sfx beat sounds its cue as notes.
    const notesBefore = handle.of('note').length;
    controller.seek(film.beats[4]!.start);
    controller.play();
    controller.tick(0.01);
    expect(handle.of('note').length).toBeGreaterThanOrEqual(notesBefore);
    // The show beat brings its part in.
    expect(handle.of('setPartVisible')).toContainEqual(['Push', true]);
    mirror.destroy();
  });

  it('seeks as a seek plus the full state, silently', async () => {
    const { film, controller, mirror, handle } = await mirrored();
    controller.seek(film.beats[2]!.start);
    expect(handle.of('seek')).toContainEqual([film.beats[2]!.start - film.scenes[0]!.start]);
    expect(handle.of('restore').some((args) => (args[0] as { step?: number }).step === film.beats[2]!.index)).toBe(true);
    expect(handle.of('note')).toHaveLength(0);
    expect(handle.of('setPlaying')).toContainEqual([false]);
    mirror.destroy();
  });

  it('forwards speed and volume, and restores the controller on destroy', async () => {
    const { controller, mirror, handle } = await mirrored();
    controller.setSpeed(2);
    expect(handle.of('setSpeed')).toContainEqual([2]);
    controller.setVolume(0.25);
    expect(handle.of('setValues')).toContainEqual([{ $volume: 0.25 }]);
    const speed = controller.setSpeed;
    const volume = controller.setVolume;
    mirror.destroy();
    expect(controller.setSpeed).not.toBe(speed);
    expect(controller.setVolume).not.toBe(volume);
  });

  it('syncs direct ask writes without a renderer', async () => {
    const { controller, mirror, handle } = await mirrored();
    const stub = (mirror as unknown as { scenes: Array<{ stub: SceneRuntime }> }).scenes[0]!.stub;
    stub.setValues({ angle: 0.9 });
    mirror.syncScene(0);
    expect(handle.of('setValues')).toContainEqual([{ angle: 0.9 }]);
    // Unchanged state sends nothing.
    const calls = handle.calls.length;
    mirror.syncScene(0);
    expect(handle.calls.length).toBe(calls);
    controller.setSpeed(1);
    mirror.destroy();
  });
});

describe('film sandbox: absolute cue state', () => {
  it('accumulates show and hide across beats from authored visibility', async () => {
    const { film, snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const authored = new Set(snapshots[0]!.hidden);
    const sceneId = film.scenes[0]!.id;
    const at = (index: number): ReadonlyMap<string, boolean> => beatCueState(film, sceneId, index, authored)!.visible;
    // The show beat brings Push in; nothing before it touches Push.
    expect(at(4).get('Push')).toBe(true);
    expect(beatCueState(film, sceneId, 4, authored)!.step).toBe(4);
    expect(beatCueState(film, sceneId, 2, authored)!.frame).toEqual({ part: 'Bob', zoom: 1.5 });
    expect(beatCueState(film, sceneId, 3, authored)!.frame).toBeNull();
    expect(beatCueState(film, sceneId, 0, authored)!.focus).toBe('Pivot');
    expect(beatCueState(film, 'nope', 0, authored)).toBeNull();
  });

  it('plays the absolute state into a handle, silently', async () => {
    const { film, snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const state = beatCueState(film, film.scenes[0]!.id, 4, new Set(snapshots[0]!.hidden))!;
    const handle = new RecordingHandle();
    applyCueState(handle, state);
    expect(handle.of('restore')).toContainEqual([{ step: 4 }]);
    expect(handle.of('setPartVisible')).toContainEqual(['Push', true]);
    expect(handle.of('note')).toHaveLength(0);
  });
});

describe('film sandbox: absolute state', () => {
  it('lands a stand-in seek on a handle, silently', async () => {
    const { snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const stub = mountedStub(snapshots[0]!);
    const param = snapshots[0]!.params[0]!;
    stub.setValues({ [param.name]: param.max });
    stub.step('goto', 2);
    const handle = new RecordingHandle();
    pushAbsoluteState(handle, stub, { to: 'Bob', zoom: 1.5 });
    expect(handle.of('restore')).toContainEqual([{ step: 2 }]);
    expect(handle.of('setValues')).toContainEqual([{ ...stub.values() }]);
    expect(handle.of('setValues')[0]?.[0]).toMatchObject({ [param.name]: param.max });
    expect(handle.of('focusPart')).toContainEqual([stub.uiState().focus ?? null]);
    for (const [name, record] of stub.parts.parts) expect(handle.of('setPartVisible')).toContainEqual([name, !record.node.hidden]);
    expect(handle.of('framePart')).toContainEqual(['Bob', 1.5]);
    expect(handle.of('note')).toHaveLength(0);
  });

  it('returns to wide when the beat carries no camera', async () => {
    const { snapshots } = await snapshotOf(THIRTY_SECOND_FILM);
    const stub = mountedStub(snapshots[0]!);
    const handle = new RecordingHandle();
    pushAbsoluteState(handle, stub, null);
    expect(handle.of('framePart')).toContainEqual([null, undefined]);
    pushAbsoluteState(handle, stub, undefined);
    expect(handle.of('framePart')).toHaveLength(2);
  });
});

describe('film sandbox: static checks', () => {
  it('passes an honest film and names its skipped geometry', async () => {
    const trusted = await trustFixture(SIXTY_SECOND_FILM);
    const report = probeFilmStatic({ film: trusted.film, js: { s1: SIXTY_SECOND_FILM.scenes[0]!.js } });
    expect(report.ok).toBe(true);
    expect(report.stats.beats).toBe(trusted.film.beats.length);
    expect(report.warnings.some((warning) => warning.includes('sandbox probe'))).toBe(true);
  });

  it('flags bad reading speed, sfx names and tone without a scene', async () => {
    const trusted = await trustFixture(THIRTY_SECOND_FILM);
    const bad: CompiledFilm = {
      ...trusted.film,
      beats: trusted.film.beats.map((beat, index) =>
        index === 0
          ? { ...beat, seconds: 0.5, step: { ...beat.step, say: 'one two three four five six seven eight nine ten', sfx: 'klaxon' } }
          : beat,
      ),
    };
    const report = probeFilmStatic({ film: bad });
    expect(report.ok).toBe(false);
    expect(report.failures.map((failure) => failure.check).sort()).toEqual(['reading-speed', 'sfx']);
  });
});

describe('film sandbox: trusted scenes still compile directly', () => {
  it('leaves compileTrusted mounts byte-identical', async () => {
    const trusted = await trustFixture(THIRTY_SECOND_FILM);
    const runtime = new SceneRuntime({ ...(trusted.scenes[0]!.kits ? { kits: trusted.scenes[0]!.kits } : {}), film: true });
    runtime.mount(compileTrusted(THIRTY_SECOND_FILM.scenes[0]!.js));
    expect(runtime.isMounted).toBe(true);
    const steps = runtime.beats() as readonly Beat[] | null;
    expect(steps?.map((step) => step.say)).toEqual(trusted.film.beats.map((beat) => beat.step.say));
  });
});
