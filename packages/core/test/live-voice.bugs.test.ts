/**
 * Bug-hunt probes for live voice (stage E). Each `it` demonstrates one real
 * defect in `LiveDriver` / `LiveToolDispatcher`; each currently FAILS.
 * Read-only: no file under src/ is touched.
 */
import { describe, expect, it } from 'vitest';
import {
  compileFilm,
  FakeLiveVoice,
  FilmController,
  LiveDriver,
  SceneRuntime,
  SIXTY_SECOND_FILM,
  THIRTY_SECOND_FILM,
  type Beat,
  type CompiledFilm,
  type FilmSceneInput,
  type LiveDriverEvent,
  type LiveMakeExample,
  type LiveVoice,
  type StoryboardSpec,
} from '../src/index';
import { trustFixture } from './helpers/film';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The live utterance id of the nth line the voice was asked to say. */
function saidId(voice: FakeLiveVoice, index: number): string {
  return voice.said[index]!.turnId;
}

/** The beat an utterance id names; turn ids are opaque on the wire. */
function saidBeat(turnId: string): string {
  return turnId.split('#')[0]!;
}

/** A genuine spoken barge-in: learner speech, then the provider's cut-off. */
function interruptAsLearner(voice: FakeLiveVoice, text = 'Wait, what does that mean?'): void {
  voice.emit({ type: 'learner-transcript', text });
  voice.emit({ type: 'interrupted' });
}

async function fixture(): Promise<{ readonly film: CompiledFilm; readonly scenes: readonly FilmSceneInput[] }> {
  return trustFixture(THIRTY_SECOND_FILM);
}

function mounted(scene: FilmSceneInput): SceneRuntime {
  const runtime = new SceneRuntime({ ...(scene.kits ? { kits: scene.kits } : {}), film: true });
  runtime.mount(scene.scene);
  return runtime;
}

function stepsOf(film: CompiledFilm): Beat[] {
  return film.beats.map((beat) => ({ ...beat.step }));
}

/** Two-scene film (scene 2 holds s2b1..s2b8), wired with one runtime per scene. */
async function twoSceneSetup(): Promise<{
  film: CompiledFilm;
  controller: FilmController;
  voice: FakeLiveVoice;
  driver: LiveDriver;
  events: LiveDriverEvent[];
}> {
  const thirty = await trustFixture(THIRTY_SECOND_FILM);
  const sixty = await trustFixture(SIXTY_SECOND_FILM);
  const second = SIXTY_SECOND_FILM.storyboard.scenes[0]!;
  const spec: StoryboardSpec = {
    film: {
      id: 'two',
      title: 'Two scenes',
      version: 1,
      lengthTarget: 120,
      context: { palette: 'default', parts: ['Pivot', 'Bob', 'Rod', 'Wave'], notation: '', units: { angle: 'rad' }, tone: 'plain' },
    },
    scenes: [
      { ...THIRTY_SECOND_FILM.storyboard.scenes[0]!, durationShare: 0.4 },
      { ...second, id: 's2', beats: second.beats.map((beat, index) => ({ ...beat, id: `s2b${index + 1}` })), durationShare: 0.6 },
    ],
  };
  const sources = [
    { id: 's1', js: THIRTY_SECOND_FILM.scenes[0]!.js, steps: stepsOf(thirty.film) },
    { id: 's2', js: SIXTY_SECOND_FILM.scenes[0]!.js, steps: stepsOf(sixty.film) },
  ];
  const result = compileFilm(JSON.parse(JSON.stringify(spec)), sources);
  if (!result.ok || !result.film) throw new Error('Two-scene film failed to compile');
  const film = result.film;
  const scenes = [{ ...thirty.scenes[0]!, id: 's1' }, { ...sixty.scenes[0]!, id: 's2' }];
  const runtime1 = mounted(scenes[0]!);
  const runtime2 = mounted(scenes[1]!);
  const controller = new FilmController({ runtime: runtime1, film, runtimes: [runtime1, runtime2] });
  const voice = new FakeLiveVoice();
  const events: LiveDriverEvent[] = [];
  const driver = new LiveDriver({ controller, film, voice, runtime: runtime1, onEvent: (event) => events.push(event) });
  return { film, controller, voice, driver, events };
}

/** A voice whose connect never succeeds, for start-failure paths. */
class RejectVoice extends FakeLiveVoice {
  override connect(): Promise<void> {
    return Promise.reject(new Error('setup refused'));
  }
}

async function setup(voice?: FakeLiveVoice): Promise<{
  film: CompiledFilm;
  controller: FilmController;
  voice: FakeLiveVoice;
  driver: LiveDriver;
  events: LiveDriverEvent[];
}> {
  const { film, scenes } = await fixture();
  const runtime = mounted(scenes[0]!);
  const controller = new FilmController({ runtime, film });
  const v = voice ?? new FakeLiveVoice();
  const events: LiveDriverEvent[] = [];
  const driver = new LiveDriver({ controller, film, voice: v, runtime, onEvent: (event) => events.push(event) });
  return { film, controller, voice: v, driver, events };
}

describe('live voice bugs: turn identity', () => {
  it('ignores the cut-off turn closing after resume has re-read the beat', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    voice.emit({ type: 'transcript', text: 'Pull the bob aside', turnId: saidId(voice, 1) });
    interruptAsLearner(voice);
    const cutOff = saidId(voice, 1);
    // The resume is scheduled; the tool answers but nothing is said yet.
    voice.emit({ type: 'tool-call', callId: 'r', name: 'resume', args: {} });
    await flush();
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2']);
    // The cut-off turn's close arrives while paused: stale, the film holds.
    voice.emit({ type: 'turn-complete', turnId: cutOff });
    expect(controller.currentBeat?.id).toBe('s1b2');
    // The model's reply turn ends: the re-read starts as its own utterance.
    voice.emit({ type: 'speaking', turnId: null });
    voice.emit({ type: 'turn-complete', turnId: null });
    await flush();
    const reread = saidId(voice, 2);
    expect(reread).not.toBe(cutOff);
    expect(saidBeat(voice.said[voice.said.length - 1]!.turnId)).toBe('s1b2');
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1', 's1b2', 's1b2']);
    controller.destroy();
  });
});

describe('live voice bugs: start/stop lifecycle', () => {
  it('restores the advance mode when connect fails', async () => {
    const { film, scenes } = await fixture();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const voice = new RejectVoice();
    const driver = new LiveDriver({ controller, film, voice: voice as LiveVoice, runtime });
    await expect(driver.start()).rejects.toThrow('setup refused');
    expect(driver.driverState).toBe('idle');
    // The film was switched to click before connect ran; the failed start
    // leaves normal time playback broken.
    expect(controller.advance).toBe('time');
    controller.destroy();
  });

  it('starts only once when start() is called twice concurrently', async () => {
    const { film, scenes } = await fixture();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const voice = new FakeLiveVoice();
    const driver = new LiveDriver({ controller, film, voice, runtime });
    await Promise.all([driver.start(), driver.start()]);
    expect(voice.setups).toHaveLength(1);
    expect(voice.said.map((line) => saidBeat(line.turnId))).toEqual(['s1b1']);
    controller.destroy();
  });

  it('honours stop() while start() is still connecting', async () => {
    const { film, scenes } = await fixture();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const voice = new FakeLiveVoice();
    const driver = new LiveDriver({ controller, film, voice, runtime });
    const started = driver.start();
    driver.stop();
    await started;
    await flush();
    expect(driver.driverState).toBe('idle');
    expect(voice.said).toHaveLength(0);
    controller.destroy();
  });
});

describe('live voice bugs: failed tools must not move the film', () => {
  it('a make_example with no host neither pauses nor pins an anchor', async () => {
    const { film, scenes } = await fixture();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const voice = new FakeLiveVoice();
    // No makeExample host: the call must fail cleanly.
    const driver = new LiveDriver({ controller, film, voice, runtime });
    await driver.start();
    controller.play();
    expect(controller.isPlaying).toBe(true);
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'make_example', args: { request: 'Another swing' } });
    await flush();
    await flush();
    const result = voice.answers.find((answer) => answer.callId === 'c1')?.result as { ok: boolean };
    expect(result?.ok).toBe(false);
    // Rejected before any side effect: still playing, nothing pinned.
    expect(controller.isPlaying).toBe(true);
    expect(driver.lastAnchor).toBeNull();
    controller.destroy();
  });
});

describe('live voice bugs: late and stale results', () => {
  it('drops a make_example result that resolves after stop()', async () => {
    let resolveHost!: (value: unknown) => void;
    const { film, scenes } = await fixture();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const voice = new FakeLiveVoice();
    const events: LiveDriverEvent[] = [];
    const driver = new LiveDriver({
      controller,
      film,
      voice,
      runtime,
      makeExample: (() => new Promise<unknown>((resolve) => { resolveHost = resolve; })) as LiveMakeExample,
      onEvent: (event) => events.push(event),
    });
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    interruptAsLearner(voice);
    voice.emit({ type: 'tool-call', callId: 'c1', name: 'make_example', args: { request: 'Another swing' } });
    await flush();
    driver.stop();
    const atStop = events.length;
    expect(events[events.length - 1]).toEqual({ type: 'stopped' });
    resolveHost({ clipId: 'clip-1' });
    await flush();
    await flush();
    // The session is over: no tool answer may be emitted past 'stopped'.
    expect(events.slice(atStop)).toEqual([]);
    expect(voice.answers.find((answer) => answer.callId === 'c1')).toBeUndefined();
    controller.destroy();
  });

  it('clears transcripts on restart so captions do not show the old session', async () => {
    const { film, scenes } = await fixture();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const voice = new FakeLiveVoice();
    const driver = new LiveDriver({ controller, film, voice, runtime });
    await driver.start();
    voice.emit({ type: 'transcript', text: 'A pendulum hangs partway', turnId: 's1b1' });
    expect(driver.caption()).toBe('A pendulum hangs partway');
    driver.stop();
    await driver.start();
    // A fresh session has said nothing yet: the caption is the beat text.
    expect(driver.caption()).toBe(film.beats[0]!.step.say);
    controller.destroy();
  });

  it('answers one host call per tool-call id, even when the id repeats', async () => {
    let calls = 0;
    const { film, scenes } = await fixture();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const voice = new FakeLiveVoice();
    const driver = new LiveDriver({
      controller,
      film,
      voice,
      runtime,
      makeExample: (async () => { calls += 1; return { clipId: `clip-${calls}` }; }) as LiveMakeExample,
    });
    await driver.start();
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 0) });
    interruptAsLearner(voice);
    voice.emit({ type: 'tool-call', callId: 'dup', name: 'make_example', args: { request: 'Another swing' } });
    voice.emit({ type: 'tool-call', callId: 'dup', name: 'make_example', args: { request: 'Another swing' } });
    await flush();
    await flush();
    expect(calls).toBe(1);
    expect(voice.answers.filter((answer) => answer.callId === 'dup')).toHaveLength(1);
    controller.destroy();
  });
});

describe('live voice bugs: resume anchors', () => {
  it('does not teleport back to a stale anchor after seek_beat moved on', async () => {
    const { controller, voice, driver } = await twoSceneSetup();
    await driver.start();
    for (let i = 0; i < 6; i++) voice.emit({ type: 'turn-complete', turnId: saidId(voice, i) });
    expect(controller.currentBeat?.id).toBe('s2b1');
    voice.emit({ type: 'transcript', text: 'Second scene opens', turnId: 's2b1' });
    interruptAsLearner(voice);
    expect(driver.lastAnchor?.beat).toBe('s2b1');
    voice.emit({ type: 'tool-call', callId: 'seek', name: 'seek_beat', args: { beat: 's1b2' } });
    await flush();
    expect(controller.currentBeat?.id).toBe('s1b2');
    // The film deliberately moved on; resume must not drag it back to the
    // pre-seek pin in another scene.
    voice.emit({ type: 'tool-call', callId: 'resume', name: 'resume', args: {} });
    await flush();
    expect(controller.currentBeat?.id).toBe('s1b2');
    expect(driver.lastAnchor?.beat).toBe('s1b2');
    controller.destroy();
  });

  it('resume after the film is done does not strand the driver in done', async () => {
    const { controller, voice, driver } = await setup();
    await driver.start();
    voice.emit({ type: 'transcript', text: 'A pendulum', turnId: saidId(voice, 0) });
    interruptAsLearner(voice);
    voice.emit({ type: 'tool-call', callId: 'seek', name: 'seek_beat', args: { beat: 's1b6' } });
    await flush();
    expect(controller.currentBeat?.id).toBe('s1b6');
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 1) });
    expect(driver.driverState).toBe('done');
    voice.emit({ type: 'tool-call', callId: 'resume', name: 'resume', args: {} });
    await flush();
    // It answered ok and re-read beat 1, so the driver must be live again
    // and the re-read's completion must advance; stuck-in-done strands it.
    expect(driver.driverState).toBe('live');
    voice.emit({ type: 'turn-complete', turnId: saidId(voice, 2) });
    expect(controller.currentBeat?.id).toBe('s1b2');
    controller.destroy();
  });
});
