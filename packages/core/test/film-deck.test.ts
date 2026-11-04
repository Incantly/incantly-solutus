import { describe, expect, it } from 'vitest';
import {
  askAnchorFor,
  attachAudio,
  beginShowMe,
  compileFilm,
  compileTrusted,
  ExportCancellation,
  ExportCancelledError,
  EXPORT_DECK_MAX_SECONDS,
  exportFrameSize,
  exportSlideFilename,
  exportStepsPerFrame,
  exportTimelineMp4,
  EXPORT_FILENAME_MAX_CHARS,
  EXPORT_SEED,
  FilmController,
  FilmMixer,
  FilmVersionStore,
  flattenFilm,
  FILM_LENGTH_PRESETS,
  filmPresetFor,
  InsertPlayer,
  MemoryMixerBackend,
  planDeckSlides,
  planExportFilm,
  PlayerModel,
  renderDeckSlides,
  renderExportChunk,
  SceneRuntime,
  SIXTY_SECOND_FILM,
  THIRTY_SECOND_FILM,
  validateInsertClip,
  VersionPicker,
  type Beat,
  type CompiledFilm,
  type ExportFrame,
  type ExportSceneInput,
  type FilmEvent,
  type FilmSceneInput,
  type MixerClip,
  type SceneFunction,
} from '../src/index';
import { trustFixture } from './helpers/film';

function mounted(scene: FilmSceneInput, seed = EXPORT_SEED): SceneRuntime {
  const runtime = new SceneRuntime({ ...(scene.kits ? { kits: scene.kits } : {}), film: true, seed });
  runtime.mount(scene.scene);
  return runtime;
}

function snapshot(runtime: SceneRuntime): string {
  const parts = [...runtime.parts.parts.values()]
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((p) => [p.name, p.node.kind, [...p.node.attrs].sort(), p.node.text, p.node.hidden]);
  return JSON.stringify({ parts, values: runtime.values(), focus: runtime.uiState().focus });
}

function stepsOf(film: CompiledFilm): Beat[] {
  return film.beats.map((beat) => ({ ...beat.step }));
}

/** The thirty-second storyboard recompiled with a film-block override, through the real compiler. */
async function compileThirty(over: Record<string, unknown> = {}): Promise<{ film: CompiledFilm; scenes: readonly FilmSceneInput[] }> {
  const base = await trustFixture(THIRTY_SECOND_FILM);
  const spec = JSON.parse(JSON.stringify(THIRTY_SECOND_FILM.storyboard)) as { film: Record<string, unknown> };
  Object.assign(spec.film, over);
  const scene = THIRTY_SECOND_FILM.scenes[0]!;
  const result = compileFilm(spec, [{ id: 's1', js: scene.js, steps: stepsOf(base.film) }]);
  if (!result.ok || !result.film) throw new Error(`Deck storyboard failed: ${result.diagnostics.map((d) => d.message).join('; ')}`);
  return { film: result.film, scenes: base.scenes };
}

function twoSceneSpec(over: Record<string, unknown> = {}): unknown {
  const second = SIXTY_SECOND_FILM.storyboard.scenes[0]!;
  return {
    film: { id: 'two', title: 'Two scenes share one deck', version: 1, lengthTarget: 120, ...over },
    scenes: [
      { ...THIRTY_SECOND_FILM.storyboard.scenes[0]!, durationShare: 0.4 },
      { ...second, id: 's2', beats: second.beats.map((beat, index) => ({ ...beat, id: `s2b${index + 1}` })), durationShare: 0.6 },
    ],
  };
}

async function twoSceneFilm(over: Record<string, unknown> = {}): Promise<{ film: CompiledFilm; scenes: readonly FilmSceneInput[] }> {
  const thirty = await trustFixture(THIRTY_SECOND_FILM);
  const sixty = await trustFixture(SIXTY_SECOND_FILM);
  const sources = [
    { id: 's1', js: THIRTY_SECOND_FILM.scenes[0]!.js, steps: stepsOf(thirty.film) },
    { id: 's2', js: SIXTY_SECOND_FILM.scenes[0]!.js, steps: stepsOf(sixty.film) },
  ];
  const result = compileFilm(JSON.parse(JSON.stringify(twoSceneSpec(over))), sources);
  if (!result.ok || !result.film) throw new Error(`Two-scene deck failed: ${result.diagnostics.map((d) => d.message).join('; ')}`);
  return { film: result.film, scenes: [{ ...thirty.scenes[0]!, id: 's1' }, { ...sixty.scenes[0]!, id: 's2' }] };
}

function toInputs(scenes: readonly FilmSceneInput[]): ExportSceneInput[] {
  return scenes.map((scene) => ({ id: scene.id, scene: scene.scene as SceneFunction, ...(scene.kits ? { kits: scene.kits } : {}) }));
}

/** A mono 16-bit sine clip, like the stub narrator's bytes but local. */
function synthClip(beatId: string, seconds: number, sampleRate = 8000): MixerClip {
  const count = Math.max(1, Math.round(seconds * sampleRate));
  const pcm = new Uint8Array(count * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < count; i++) view.setInt16(i * 2, Math.round(20000 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)), true);
  return { beatId, hash: `stub-${beatId}`, pcm, sampleRate, seconds: count / sampleRate };
}

describe('film deck: advance is additive over the same format', () => {
  it('defaults to time and carries click through the compiler', async () => {
    const { film: timed } = await compileThirty();
    expect(timed.advance).toBe('time');
    const { film: deck } = await compileThirty({ advance: 'click' });
    expect(deck.advance).toBe('click');
    // The same format: everything but the advance is identical.
    const { advance: _t, ...timedRest } = timed;
    const { advance: _c, ...deckRest } = deck;
    void _t;
    void _c;
    expect(deckRest).toEqual(timedRest);
  });

  it('rejects an unknown advance', async () => {
    const base = await trustFixture(THIRTY_SECOND_FILM);
    const scene = THIRTY_SECOND_FILM.scenes[0]!;
    const spec = JSON.parse(JSON.stringify(THIRTY_SECOND_FILM.storyboard)) as { film: Record<string, unknown> };
    spec.film.advance = 'scroll';
    const result = compileFilm(spec, [{ id: 's1', js: scene.js, steps: stepsOf(base.film) }]);
    expect(result.ok).toBe(false);
    expect(result.film).toBeNull();
    expect(result.diagnostics.some((d) => d.severity === 'error' && d.message.includes('time or click'))).toBe(true);
  });

  it('keeps the advance through narration timing and versions', async () => {
    const { film } = await compileThirty({ advance: 'click' });
    const timed = attachAudio(film, 's1b1', { seconds: 3 });
    expect(timed.advance).toBe('click');
    const scene = THIRTY_SECOND_FILM.scenes[0]!;
    const runtime = new SceneRuntime({});
    runtime.mount(compileTrusted(scene.js));
    const store = new FilmVersionStore(timed, [{ id: 's1', js: scene.js, steps: runtime.beats()! }]);
    const appended = store.putPatch({
      film: 'pendulum',
      parent: 1,
      version: 2,
      reason: 'Say what pulls the pendulum down.',
      beats: [{ beat: 's1b1', scene: 's1', say: 'A pendulum hangs from its pivot, pulled down by gravity.' }],
      audio: [],
    });
    expect(appended.ok).toBe(true);
    expect(store.get(2)?.advance).toBe('click');
    expect(store.base.advance).toBe('click');
    runtime.destroy();
  });
});

describe('film deck: click holds beats until the learner advances', () => {
  it('never holds in time mode: the full event stream is unchanged', async () => {
    const { film, scenes } = await compileThirty();
    const runtime = mounted(scenes[0]!);
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime, film, onEvent: (event) => events.push(event) });
    expect(controller.advance).toBe('time');
    controller.play();
    for (let i = 0; i < 30000 && !events.some((e) => e.type === 'end'); i++) {
      if (!controller.isPlaying) controller.play();
      controller.tick(1 / 60);
    }
    expect(events.some((e) => e.type === 'end')).toBe(true);
    expect(events.some((e) => e.type === 'held')).toBe(false);
    expect(events.filter((e) => e.type === 'beat').map((e) => (e as { beat: { id: string } }).beat.id)).toEqual([
      's1b1',
      's1b2',
      's1b3',
      's1b4',
      's1b5',
      's1b6',
    ]);
    controller.destroy();
  });

  it('holds every beat at its opening until clicked', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const runtime = mounted(scenes[0]!);
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime, film, onEvent: (event) => events.push(event) });
    expect(controller.advance).toBe('click');
    controller.play();
    for (let i = 0; i < 1800; i++) controller.tick(1 / 60);
    expect(controller.currentBeat?.id).toBe('s1b1');
    expect(controller.isPlaying).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['beat', 'held', 'play']);
    expect((events[1] as { beat: { id: string } }).beat.id).toBe('s1b1');
    controller.destroy();
  });

  it('steps through the deck paused, finishing at the end instead of wrapping', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const runtime = mounted(scenes[0]!);
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime, film, onEvent: (event) => events.push(event) });
    const model = new PlayerModel(controller, film);
    expect(model.beatPosition()).toBeNull();
    expect(model.nextBeat()).toBe(true);
    expect(model.beatPosition()).toEqual({ index: 0, total: 6 });
    for (const id of ['s1b2', 's1b3', 's1b4', 's1b5', 's1b6']) {
      expect(model.nextBeat()).toBe(true);
      expect(controller.currentBeat?.id).toBe(id);
      expect(controller.isPlaying).toBe(false);
    }
    expect(model.beatPosition()).toEqual({ index: 5, total: 6 });
    // Every arrival emits its beat event, so narration starts as on a played boundary.
    expect(events.filter((e) => e.type === 'beat')).toHaveLength(6);
    expect(model.nextBeat()).toBe(false);
    expect(events.some((e) => e.type === 'end')).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b6');
    expect(model.prevBeat()).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b5');
    expect(controller.isPlaying).toBe(false);
    controller.destroy();
  });

  it('plays to the next boundary then holds, and restarts onto a held first beat', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const runtime = mounted(scenes[0]!);
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime, film, onEvent: (event) => events.push(event) });
    controller.nextBeat();
    controller.nextBeat();
    controller.nextBeat();
    expect(controller.currentBeat?.id).toBe('s1b3');
    controller.play();
    expect(controller.isPlaying).toBe(true);
    for (let i = 0; i < 20000 && controller.isPlaying; i++) controller.tick(1 / 60);
    expect(controller.currentBeat?.id).toBe('s1b4');
    expect(controller.isPlaying).toBe(false);
    expect(events.some((e) => e.type === 'held' && (e as { beat: { id: string } }).beat.id === 's1b4')).toBe(true);
    // To the end, then play restarts onto a held first beat with its narration cue.
    while (controller.nextBeat()) void 0;
    expect(events.some((e) => e.type === 'end')).toBe(true);
    events.length = 0;
    controller.play();
    expect(controller.currentBeat?.id).toBe('s1b1');
    expect(controller.isPlaying).toBe(false);
    expect(events.map((e) => e.type)).toEqual(['seek', 'beat']);
    controller.destroy();
  });

  it('holds seeks where they land', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.play();
    expect(controller.isPlaying).toBe(false);
    controller.seek(film.beats[3]!.start + 0.5);
    expect(controller.currentBeat?.id).toBe('s1b4');
    expect(controller.isPlaying).toBe(false);
    expect(controller.seekBeat('s1b2')).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b2');
    expect(controller.isPlaying).toBe(false);
    controller.destroy();
  });

  it('crosses scenes and chapters on click', async () => {
    const { film, scenes } = await twoSceneFilm({ advance: 'click' });
    const runtimes = scenes.map((scene) => mounted(scene));
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime: runtimes[0]!, film, runtimes, onEvent: (event) => events.push(event) });
    for (let i = 0; i < 6; i++) expect(controller.nextBeat()).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b6');
    expect(controller.sceneIndex).toBe(0);
    expect(controller.nextBeat()).toBe(true);
    expect(controller.currentBeat?.id).toBe('s2b1');
    expect(controller.sceneIndex).toBe(1);
    expect(controller.isPlaying).toBe(false);
    expect(events.some((e) => e.type === 'cut' && (e as { from: string; to: string }).from === 's1' && (e as { from: string; to: string }).to === 's2')).toBe(true);
    expect(controller.prevBeat()).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b6');
    expect(controller.sceneIndex).toBe(0);
    expect(controller.seekChapter('s2')).toBe(true);
    expect(controller.currentBeat?.id).toBe('s2b1');
    expect(controller.isPlaying).toBe(false);
    expect(controller.seekChapter('missing')).toBe(false);
    controller.destroy();
  });

  it('toggles modes on an estimated film with no narration', async () => {
    const { film, scenes } = await compileThirty();
    expect(film.beats.every((beat) => !beat.timed)).toBe(true);
    const runtime = mounted(scenes[0]!);
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime, film, onEvent: (event) => events.push(event) });
    controller.setAdvance('click');
    expect(controller.advance).toBe('click');
    expect(events).toHaveLength(0);
    controller.nextBeat();
    expect(controller.currentBeat?.id).toBe('s1b1');
    controller.setAdvance('time');
    expect(controller.advance).toBe('time');
    controller.setAdvance('bogus' as 'time');
    expect(controller.advance).toBe('time');
    // Entering click mid-play pauses the clock and holds the beat on screen.
    controller.play();
    expect(controller.isPlaying).toBe(true);
    controller.setAdvance('click');
    expect(controller.isPlaying).toBe(false);
    expect(events.some((e) => e.type === 'held')).toBe(true);
    controller.destroy();
  });
});

describe('film deck: narration is optional', () => {
  it('plays arrival narration and never auto-advances past speech', async () => {
    const compiled = await compileThirty({ advance: 'click' });
    const scenes = compiled.scenes;
    let film = compiled.film;
    for (const beat of film.beats) film = attachAudio(film, beat.id, { seconds: 2 });
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const backend = new MemoryMixerBackend();
    const mixer = new FilmMixer(backend);
    for (const beat of film.beats) mixer.attach(synthClip(beat.id, 2));
    mixer.setEnabled(true);
    // The page's wiring: arrivals play their line, held beats never interrupt it.
    controller.on((event) => {
      if (event.type === 'beat' || event.type === 'play') {
        const beat = controller.currentBeat;
        if (beat) mixer.onBeat(beat.id, controller.time - beat.start);
      } else if (event.type === 'pause' || event.type === 'pausePoint' || event.type === 'end' || event.type === 'seek') {
        mixer.onInterrupt();
      }
    });
    controller.nextBeat();
    controller.nextBeat();
    expect(backend.plays().map((play) => play.hash)).toEqual(['stub-s1b1', 'stub-s1b2']);
    // Long past the line and the beat: still held, still silent of motion.
    for (let i = 0; i < 1200; i++) controller.tick(1 / 60);
    expect(controller.currentBeat?.id).toBe('s1b2');
    expect(controller.isPlaying).toBe(false);
    expect(backend.plays()).toHaveLength(2);
    controller.nextBeat();
    expect(backend.plays().map((play) => play.hash)).toEqual(['stub-s1b1', 'stub-s1b2', 'stub-s1b3']);
    controller.destroy();
  });

  it('advances a silent deck on click with captions and transcript', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const model = new PlayerModel(controller, film);
    const mixer = new FilmMixer(new MemoryMixerBackend());
    expect(mixer.isOn).toBe(false);
    model.nextBeat();
    model.nextBeat();
    expect(controller.currentBeat?.id).toBe('s1b2');
    expect(model.state.caption?.say).toBe(film.beats[1]!.step.say);
    expect(model.transcript()).toHaveLength(6);
    model.setCaptions(false);
    expect(model.state.caption).toBeNull();
    model.setCaptions(true);
    expect(model.state.caption?.say).toBe(film.beats[1]!.step.say);
    controller.destroy();
  });

  it('keeps the learner’s toggle when narration arrives later', async () => {
    const { film, scenes } = await compileThirty();
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.setAdvance('click');
    controller.nextBeat();
    controller.attachAudio('s1b1', { seconds: 3 });
    expect(controller.advance).toBe('click');
    expect(controller.currentBeat?.id).toBe('s1b1');
    controller.setAdvance('time');
    controller.attachAudio('s1b2', { seconds: 3 });
    expect(controller.advance).toBe('time');
    controller.destroy();
  });
});

describe('film deck: one still per beat', () => {
  it('points every timeline beat at its opening frame', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const inputs = toInputs(scenes);
    const planned = planExportFilm(film, flattenFilm(film), inputs, {});
    if (!planned.ok) throw new Error('no plan');
    const plan = planned.plan;
    const refs = planDeckSlides(plan);
    expect(refs.map((ref) => ref.beat)).toEqual(film.beats.map((beat) => beat.id));
    expect(new Set(refs.map((ref) => ref.frame)).size).toBe(refs.length);
    const frames: ExportFrame[] = [];
    for (const chunk of plan.chunks) {
      for (const frame of renderExportChunk(chunk, inputs[chunk.chunk]!, new ExportCancellation())) frames.push(frame);
    }
    for (const ref of refs) {
      const frame = frames.find((candidate) => candidate.frame === ref.frame);
      expect(frame?.beatId).toBe(ref.beat);
    }
    const slides = [...renderDeckSlides(plan, inputs, new ExportCancellation())];
    expect(slides.map((slide) => slide.beat)).toEqual(film.beats.map((beat) => beat.id));
    expect(slides[0]?.caption).toBe(film.beats[0]!.step.say);
  });

  it('matches live frames at the same time, inserts included', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const inputs = toInputs(scenes);
    const anchor = askAnchorFor(film, 's1b3', film.beats[2]!.start + 0.6)!;
    const valid = validateInsertClip(
      { id: 'insert-1', anchor, lines: [{ say: 'Here is the step again, slowly.', seconds: 3 }] },
      film,
      new Set(['angle', 'push']),
    );
    if (!valid.ok) throw new Error('no insert');
    const planned = planExportFilm(film, flattenFilm(film, [valid.clip]), inputs, {});
    if (!planned.ok) throw new Error('no plan');
    const plan = planned.plan;
    const refs = planDeckSlides(plan);
    expect(refs).toHaveLength(film.beats.length + 1);
    const seen = new Map<string, string>();
    for (const slide of renderDeckSlides(plan, inputs, new ExportCancellation(), {
      inspect: (runtime, frame) => {
        if (refs.some((ref) => ref.chunk === frame.chunk && ref.frame === frame.frame)) seen.set(`${frame.chunk}:${frame.frame}`, snapshot(runtime));
      },
    })) {
      const chunk = plan.chunks[slide.chunk]!;
      const stepsPerFrame = exportStepsPerFrame(chunk.fps);
      if (stepsPerFrame === null) throw new Error('no lattice');
      // The live comparison: what playback shows at the slide's own time.
      const live = mounted(inputs[slide.chunk]!);
      const controller = new FilmController({ runtime: live, film: chunk.film });
      controller.seek((slide.frame * stepsPerFrame) / 60);
      expect(controller.currentBeat?.id).toBe(slide.beat);
      expect(seen.get(`${slide.chunk}:${slide.frame}`)).toBe(snapshot(live));
      controller.destroy();
    }
    expect(seen.size).toBe(refs.length);
  });

  it('names slides by the export filename conventions', () => {
    expect(exportSlideFilename('pendulum', 1, null, 1, 6, 's1b1')).toBe('pendulum-v1-slide-01-s1b1.png');
    expect(exportSlideFilename('pendulum', 2, 'with-inserts', 3, 8, 'insert-1-l2')).toBe('pendulum-v2-with-inserts-slide-03-insert-1-l2.png');
    expect(exportSlideFilename('pendulum', 1, null, 120, 120, 's9b9')).toBe('pendulum-v1-slide-120-s9b9.png');
    // Hostile segments sanitize to dashes: no slashes, dots or traversal.
    const hostile = exportSlideFilename('../my film!', 1, '../../etc', 1, 6, '..\\s1b1');
    expect(hostile).toBe('---my-film--v1-------etc-slide-01----s1b1.png');
    expect(hostile).not.toMatch(/[/\\]|\.\./);
    // Triple-max segments shave to NAME_MAX; short names stay byte-identical.
    const fat = exportSlideFilename('f'.repeat(80), 1, 'i'.repeat(80), 1, 6, 'b'.repeat(80));
    expect(fat.length).toBeLessThanOrEqual(EXPORT_FILENAME_MAX_CHARS);
    expect(fat.endsWith('.png')).toBe(true);
    expect(exportSlideFilename('pendulum', 1, null, 2, 6, 's1b2')).toBe('pendulum-v1-slide-02-s1b2.png');
  });
});

describe('film deck: slide export refuses runaway timelines', () => {
  // A ~2000 s film would plan ~200 slides over ~60k frames; only the plan's
  // length matters to the refusal, which lands before any frame renders.
  const runaway = { seconds: 2000, fps: 30, chunks: [], frames: 0, timeline: {} } as never;

  it('refuses to plan slides past the deck cap', () => {
    expect(EXPORT_DECK_MAX_SECONDS).toBe(600);
    expect(() => planDeckSlides(runaway)).toThrow('The deck runs 2000 seconds of slides; at most 600');
  });

  it('refuses to render slides past the deck cap, before the first frame', () => {
    const cancel = new ExportCancellation();
    expect(() => [...renderDeckSlides(runaway, [], cancel)]).toThrow('The deck runs 2000 seconds of slides; at most 600');
    expect(cancel.cancelled).toBe(false);
  });

  it('keeps cooperative cancellation on plans within the cap', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const inputs = toInputs(scenes);
    const planned = planExportFilm(film, flattenFilm(film), inputs, {});
    if (!planned.ok) throw new Error('no plan');
    const cancel = new ExportCancellation();
    cancel.cancel();
    expect(() => [...renderDeckSlides(planned.plan, inputs, cancel)]).toThrow(ExportCancelledError);
  });
});

describe('film deck: video export plays the full timed deck', () => {
  it('resolves click advance to the same timed holds as time', async () => {
    const { film: deck, scenes } = await compileThirty({ advance: 'click' });
    const { film: timed } = await compileThirty();
    const inputs = toInputs(scenes);
    const deckPlan = planExportFilm(deck, flattenFilm(deck), inputs, {});
    const timePlan = planExportFilm(timed, flattenFilm(timed), inputs, {});
    if (!deckPlan.ok || !timePlan.ok) throw new Error('no plan');
    expect(deckPlan.plan.frames).toBe(timePlan.plan.frames);
    expect(deckPlan.plan.seconds).toBe(timePlan.plan.seconds);
    expect(deckPlan.plan.chunks).toHaveLength(timePlan.plan.chunks.length);
    expect(deckPlan.plan.chunks.map((chunk) => chunk.film.advance)).toEqual(['time']);
    const beats: string[] = [];
    for (const frame of renderExportChunk(deckPlan.plan.chunks[0]!, inputs[0]!, new ExportCancellation())) {
      if (beats[beats.length - 1] !== frame.beatId) beats.push(frame.beatId);
    }
    expect(beats).toEqual(deck.beats.map((beat) => beat.id));
  });

  it('muxes the whole deck to MP4, silent or narrated', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const inputs = toInputs(scenes);
    const planned = planExportFilm(film, flattenFilm(film), inputs, {});
    if (!planned.ok) throw new Error('no plan');
    const run = async (clips: MixerClip[], audio: boolean) => {
      const captured: ExportFrame[] = [];
      return exportTimelineMp4({
        film,
        timeline: flattenFilm(film),
        scenes: inputs,
        clips,
        size: exportFrameSize(600, 400, 480),
        drivers: {
          openCapture: async () => ({ capture: async (frame: ExportFrame) => void captured.push(frame), destroy: () => undefined }),
          openVideo: async () => {
            const samples: Array<{ data: Uint8Array; keyframe: boolean }> = [];
            return {
              encode: async (_image: unknown, _timestampUs: number, keyFrame: boolean) => void samples.push({ data: new Uint8Array([7]), keyframe: keyFrame }),
              finish: async () => ({ codec: 'avc' as const, description: new Uint8Array([1, 2, 3, 4]), samples }),
              close: () => undefined,
            };
          },
          openAudio: async () =>
            audio
              ? { encode: async () => undefined, finish: async () => ({ description: new Uint8Array([0x12, 0x10]), samples: [new Uint8Array([9])] }), close: () => undefined }
              : null,
        },
      });
    };
    const silent = await run([], false);
    expect(silent.frames).toBe(planned.plan.frames);
    expect(silent.seconds).toBeCloseTo(film.seconds, 1);
    expect(silent.hasAudio).toBe(false);
    const narrated = await run(
      film.beats.map((beat) => synthClip(beat.id, 1)),
      true,
    );
    expect(narrated.frames).toBe(planned.plan.frames);
    expect(narrated.hasAudio).toBe(true);
    expect(narrated.bytes.length).toBeGreaterThan(0);
  });
});

describe('film deck: questions work the same way', () => {
  it('anchors answers by beat id and resolves markers', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    const model = new PlayerModel(controller, film);
    model.nextBeat();
    model.nextBeat();
    model.nextBeat();
    expect(controller.currentBeat?.id).toBe('s1b3');
    const asked = model.ask('What pulls it down?');
    expect(asked?.beat.id).toBe('s1b3');
    expect(asked?.anchor.beat).toBe('s1b3');
    expect(asked?.lines.map((line) => line.beat)).toEqual(['s1b2', 's1b3', 's1b4']);
    model.addMarker(asked!.anchor, 'What pulls it down?');
    expect(model.markers).toHaveLength(1);
    expect(model.markerTimes()).toHaveLength(1);
    expect(model.markersForBeat('s1b3')).toHaveLength(1);
    expect(model.markersForBeat('s1b1')).toHaveLength(0);
    controller.destroy();
  });

  it('replays show-me deterministically and restores the deck', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.nextBeat();
    controller.nextBeat();
    controller.nextBeat();
    const before = snapshot(runtime);
    const shown = beginShowMe(runtime, film.beats[2]!);
    const again = shown.replay();
    expect(JSON.stringify(again)).toBe(JSON.stringify(shown.cues));
    expect(shown.restored).toBe(false);
    shown.restore();
    expect(shown.restored).toBe(true);
    expect(snapshot(runtime)).toBe(before);
    // The deck holds where the question found it.
    expect(controller.currentBeat?.id).toBe('s1b3');
    expect(controller.isPlaying).toBe(false);
    controller.destroy();
  });

  it('plays inserts inside the deck and auto-resumes at the anchor', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.nextBeat();
    controller.nextBeat();
    controller.nextBeat();
    const anchor = askAnchorFor(film, 's1b3', controller.time)!;
    const valid = validateInsertClip(
      { id: 'insert-1', anchor, lines: [{ say: 'Here is the step again, slowly.', seconds: 3 }, { say: 'Watch the bob pass the bottom.', seconds: 2 }] },
      film,
      new Set(['angle', 'push']),
    );
    if (!valid.ok) throw new Error('no insert');
    const resumed: Array<{ anchor: string; seconds: number }> = [];
    const player = new InsertPlayer(controller, film, valid.clip, { onEvent: (event) => void (event.type === 'resume' && resumed.push({ anchor: event.anchor.beat, seconds: event.seconds })) });
    expect(player.play()).toBe(true);
    expect(player.currentLineIndex).toBe(0);
    player.tick(3);
    expect(player.currentLineIndex).toBe(1);
    player.tick(2);
    expect(player.currentPhase).toBe('back');
    player.tick(1.5);
    expect(player.currentPhase).toBe('done');
    // Back at the deck position: the anchor beat, playing on to the next hold.
    expect(resumed).toHaveLength(1);
    expect(resumed[0]?.anchor).toBe('s1b3');
    expect(controller.currentBeat?.id).toBe('s1b3');
    expect(controller.isPlaying).toBe(true);
    for (let i = 0; i < 20000 && controller.isPlaying; i++) controller.tick(1 / 60);
    expect(controller.currentBeat?.id).toBe('s1b4');
    expect(controller.isPlaying).toBe(false);
    controller.destroy();
  });

  it('skips inserts back to the deck position on demand', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const runtime = mounted(scenes[0]!);
    const controller = new FilmController({ runtime, film });
    controller.nextBeat();
    controller.nextBeat();
    const anchor = askAnchorFor(film, 's1b2', controller.time)!;
    const valid = validateInsertClip({ id: 'insert-9', anchor, lines: [{ say: 'Here is the step again, slowly.', seconds: 3 }] }, film, new Set(['angle']));
    if (!valid.ok) throw new Error('no insert');
    const player = new InsertPlayer(controller, film, valid.clip);
    expect(player.play()).toBe(true);
    player.tick(1);
    player.skipToFilm();
    expect(player.currentPhase).toBe('done');
    expect(controller.currentBeat?.id).toBe('s1b2');
    expect(controller.isPlaying).toBe(true);
    controller.destroy();
  });
});

describe('film deck: versions, chapters and presets', () => {
  it('plays every version as a deck', async () => {
    const { film, scenes } = await compileThirty({ advance: 'click' });
    const scene = THIRTY_SECOND_FILM.scenes[0]!;
    const runtime = new SceneRuntime({});
    runtime.mount(compileTrusted(scene.js));
    const store = new FilmVersionStore(film, [{ id: 's1', js: scene.js, steps: runtime.beats()! }]);
    const appended = store.putPatch({
      film: 'pendulum',
      parent: 1,
      version: 2,
      reason: 'Say what pulls the pendulum down.',
      beats: [{ beat: 's1b1', scene: 's1', say: 'A pendulum hangs from its pivot, pulled down by gravity.' }],
      audio: [],
    });
    expect(appended.ok).toBe(true);
    const picker = new VersionPicker(store);
    expect(picker.switchTo(1)?.advance).toBe('click');
    const two = picker.switchTo(2);
    expect(two?.advance).toBe('click');
    const deck = mounted(scenes[0]!);
    const controller = new FilmController({ runtime: deck, film: two! });
    expect(controller.advance).toBe('click');
    controller.nextBeat();
    for (let i = 0; i < 600; i++) controller.tick(1 / 60);
    expect(controller.currentBeat?.id).toBe('s1b1');
    expect(controller.isPlaying).toBe(false);
    expect(controller.currentBeat?.step.say).toBe('A pendulum hangs from its pivot, pulled down by gravity.');
    controller.destroy();
    runtime.destroy();
  });

  it('holds chapters at their first beat', async () => {
    const { film, scenes } = await twoSceneFilm({ advance: 'click' });
    const runtimes = scenes.map((scene) => mounted(scene));
    const controller = new FilmController({ runtime: runtimes[0]!, film, runtimes });
    const model = new PlayerModel(controller, film);
    expect(model.chapters()).toHaveLength(2);
    expect(model.seekChapter('s2')).toBe(true);
    expect(controller.currentBeat?.id).toBe('s2b1');
    expect(controller.isPlaying).toBe(false);
    expect(model.chapterNow()).toBe('s2');
    expect(model.seekChapter('s1')).toBe(true);
    expect(controller.currentBeat?.id).toBe('s1b1');
    controller.destroy();
  });

  it('compiles a deck at every length preset', async () => {
    expect(FILM_LENGTH_PRESETS).toEqual([30, 60, 120, 180, 240]);
    for (const preset of FILM_LENGTH_PRESETS) {
      const { film } = await compileThirty({ advance: 'click', lengthTarget: preset });
      expect(film.advance).toBe('click');
      const table = filmPresetFor(preset);
      expect(table.seconds).toBe(preset);
      expect(table.scenes).toBeGreaterThanOrEqual(1);
    }
  });
});
