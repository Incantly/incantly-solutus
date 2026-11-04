import { describe, expect, it } from 'vitest';
import {
  compileFilm,
  checkSceneContext,
  EMPTY_FILM_CONTEXT,
  FILM_SCENE_MAX_SECONDS,
  FilmController,
  filmDeadlineMs,
  filmPlanTokens,
  filmPresetFor,
  filmScenesFor,
  FILM_GENERATION_CEILING_MS,
  FILM_LENGTH_PRESETS,
  ManualClock,
  PlayerModel,
  probeFilm,
  readFilmContext,
  SceneRuntime,
  SIXTY_SECOND_FILM,
  THIRTY_SECOND_FILM,
  type Beat,
  type CompiledFilm,
  type FilmEvent,
  type FilmSceneInput,
  type StoryboardSpec,
} from '../src/index';
import { trustFixture } from './helpers/film';

const CONTEXT = { palette: 'default', parts: ['Pivot', 'Bob', 'Rod'], notation: 'si', units: { angle: 'rad' }, tone: 'plain' };

function twoSceneSpec(): StoryboardSpec {
  const second = SIXTY_SECOND_FILM.storyboard.scenes[0]!;
  // The fixtures say "miles", so the shared notation stays everyday words, not SI.
  return {
    film: { id: 'two', title: 'Two scenes share one context', version: 1, lengthTarget: 120, context: { ...CONTEXT, notation: '', parts: [...CONTEXT.parts, 'Wave'] } },
    scenes: [
      { ...THIRTY_SECOND_FILM.storyboard.scenes[0]!, durationShare: 0.4 },
      { ...second, id: 's2', beats: second.beats.map((beat, index) => ({ ...beat, id: `s2b${index + 1}` })), durationShare: 0.6 },
    ],
  };
}

async function twoSceneFilm(): Promise<{ film: CompiledFilm; scenes: readonly FilmSceneInput[] }> {
  const thirty = await trustFixture(THIRTY_SECOND_FILM);
  const sixty = await trustFixture(SIXTY_SECOND_FILM);
  const spec = twoSceneSpec();
  const runtime1 = new SceneRuntime({});
  const sources = [
    { id: 's1', js: THIRTY_SECOND_FILM.scenes[0]!.js, steps: stepsOf(thirty.film) },
    { id: 's2', js: SIXTY_SECOND_FILM.scenes[0]!.js, steps: stepsOf(sixty.film) },
  ];
  void runtime1;
  const result = compileFilm(JSON.parse(JSON.stringify(spec)), sources);
  if (!result.ok || !result.film) throw new Error(`Two-scene film failed to compile: ${result.diagnostics.map((d) => d.message).join('; ')}`);
  return { film: result.film, scenes: [{ ...thirty.scenes[0]!, id: 's1' }, { ...sixty.scenes[0]!, id: 's2' }] };
}

function stepsOf(film: CompiledFilm): Beat[] {
  return film.beats.map((beat) => ({ ...beat.step }));
}

function mounted(scene: FilmSceneInput): SceneRuntime {
  const runtime = new SceneRuntime({ ...(scene.kits ? { kits: scene.kits } : {}), film: true });
  runtime.mount(scene.scene);
  return runtime;
}

describe('film storyboard: scenes plus a shared context', () => {
  it('carries the shared context and duration shares through the compiler', async () => {
    const { film } = await twoSceneFilm();
    expect(film.scenes).toHaveLength(2);
    expect(film.context).toMatchObject({ palette: 'default', tone: 'plain' });
    expect(film.context?.parts).toContain('Pivot');
    expect(film.scenes[0]!.beats).toHaveLength(6);
    expect(film.scenes[1]!.beats).toHaveLength(8);
  });

  it('reads the context out of a storyboard film block', () => {
    expect(readFilmContext({ title: 'No context' })).toBeNull();
    expect(readFilmContext({ title: 'T', context: CONTEXT })).toMatchObject({ palette: 'default', parts: ['Pivot', 'Bob', 'Rod'] });
    expect(readFilmContext({ title: 'T', context: { palette: 'default' } })).toBeNull();
    expect(EMPTY_FILM_CONTEXT).toEqual({ palette: '', parts: [], notation: '', units: {}, tone: '' });
  });

  it('rejects a malformed context, duplicate scenes and bad shares', async () => {
    const thirty = await trustFixture(THIRTY_SECOND_FILM);
    const sources = [{ id: 's1', js: THIRTY_SECOND_FILM.scenes[0]!.js, steps: stepsOf(thirty.film) }];
    const base = THIRTY_SECOND_FILM.storyboard.scenes[0]!;
    const badContext = compileFilm({ film: { title: 'T', context: { palette: 'default' } }, scenes: [base] }, sources);
    expect(badContext.ok).toBe(false);
    const twice = compileFilm({ film: { title: 'T' }, scenes: [base, base] }, sources);
    expect(twice.ok).toBe(false);
    expect(twice.diagnostics.some((d) => d.message.includes('used twice'))).toBe(true);
    const share = compileFilm({ film: { title: 'T' }, scenes: [{ ...base, durationShare: 2 }] }, sources);
    expect(share.ok).toBe(false);
  });

  it('warns when shares miss 1 and when a scene runs past the cap', async () => {
    const thirty = await trustFixture(THIRTY_SECOND_FILM);
    const base = THIRTY_SECOND_FILM.storyboard.scenes[0]!;
    const sources = [{ id: 's1', js: THIRTY_SECOND_FILM.scenes[0]!.js, steps: stepsOf(thirty.film) }];
    const shares = compileFilm({ film: { title: 'T' }, scenes: [{ ...base, durationShare: 0.2 }] }, sources);
    expect(shares.ok).toBe(true);
    expect(shares.diagnostics.some((d) => d.message.includes('sum to'))).toBe(true);
    expect(FILM_SCENE_MAX_SECONDS).toBe(60);
    const longBeats = Array.from({ length: 20 }, (_, i) => ({ id: `b${i + 1}`, say: 'A pendulum hangs from its pivot, pulled straight down by gravity, swinging on and on without ever stopping at all.' }));
    const longSteps = longBeats.map((beat) => ({ say: beat.say }));
    const over = compileFilm({ film: { title: 'T' }, scenes: [{ id: 's1', beats: longBeats }] }, [{ id: 's1', js: '', steps: longSteps }]);
    expect(over.ok).toBe(true);
    expect(over.diagnostics.some((d) => d.message.includes('at most 60 s'))).toBe(true);
  });
});

describe('film presets: lengths, scenes and deadlines from the bench', () => {
  it('maps 30s and 1min to one scene and longer films to one scene per minute', () => {
    expect(FILM_LENGTH_PRESETS).toEqual([30, 60, 120, 180, 240]);
    expect(filmScenesFor(30)).toBe(1);
    expect(filmScenesFor(60)).toBe(1);
    expect(filmScenesFor(120)).toBe(2);
    expect(filmScenesFor(180)).toBe(3);
    expect(filmScenesFor(240)).toBe(4);
  });

  it('keeps every whole-film deadline within the 3-minute ceiling', () => {
    for (const length of FILM_LENGTH_PRESETS) {
      const deadline = filmDeadlineMs(length);
      expect(deadline).toBeGreaterThan(0);
      expect(deadline).toBeLessThanOrEqual(FILM_GENERATION_CEILING_MS);
    }
    expect(FILM_GENERATION_CEILING_MS).toBe(180_000);
    expect(filmPresetFor(45).seconds).toBe(60);
    expect(filmPresetFor(300).seconds).toBe(240);
  });

  it('sizes the plan cap by scene count from the bench rate', () => {
    expect(filmPlanTokens(1)).toBe(1500 + 700);
    expect(filmPlanTokens(4)).toBe(1500 + 2800);
    expect(filmPresetFor(120).planTokens).toBe(filmPlanTokens(2));
  });
});

describe('film context check: the drift defence', () => {
  it('passes a scene that keeps the context', () => {
    const js = THIRTY_SECOND_FILM.scenes[0]!.js;
    expect(checkSceneContext(js, 'A pendulum hangs from its pivot.', ['Pivot'], CONTEXT)).toEqual([]);
  });

  it('fails palette, parts, units, notation and tone breaches', () => {
    expect(checkSceneContext("const accent = '#ff3300';", 'A line.', [], CONTEXT)).toHaveLength(1);
    expect(checkSceneContext("stage.part('pivot', x);", 'A line.', [], CONTEXT)[0]).toContain('Pivot');
    expect(checkSceneContext('A line.', 'A line.', ['pivot'], CONTEXT)[0]).toContain('Pivot');
    const units = checkSceneContext("inc.param('angle', { min: 0, max: 1, value: 0.5, unit: 'deg' });", 'A line.', [], CONTEXT);
    expect(units[0]).toContain('rad');
    expect(checkSceneContext('', 'The rod is twelve inches long.', [], CONTEXT)[0]).toContain('inches');
    const long = Array(45).fill('word').join(' ');
    expect(checkSceneContext('', long, [], CONTEXT)[0]).toContain('40');
    expect(checkSceneContext('', 'One idea; another idea.', [], CONTEXT)[0]).toContain('semicolon');
  });

  it('constrains nothing when the context is empty', () => {
    expect(checkSceneContext("const accent = '#ff3300';", 'Twelve inches; ' + Array(50).fill('word').join(' '), ['anything'], EMPTY_FILM_CONTEXT)).toEqual([]);
  });

  it(
    'runs per beat inside the film checks when the film carries a context',
    async () => {
      const { film, scenes } = await twoSceneFilm();
      const js: Record<string, string> = { s1: THIRTY_SECOND_FILM.scenes[0]!.js, s2: SIXTY_SECOND_FILM.scenes[0]!.js };
      const report = probeFilm({ film, scenes, js, widths: [640], themes: ['light'] });
      expect(report.failures.filter((f) => f.check === 'context')).toEqual([]);
      const drifted = probeFilm({ film, scenes, js: { ...js, s1: `${js.s1}\nconst accent = '#ff3300';\n` }, widths: [640], themes: ['light'] });
      const contextFailures = drifted.failures.filter((f) => f.check === 'context');
      expect(contextFailures.length).toBeGreaterThan(0);
      expect(contextFailures.every((f) => f.scene === 's1')).toBe(true);
    },
    30_000,
  );
});

describe('film chapters: scenes as jump targets', () => {
  it('surfaces every scene as a chapter with its title and start', async () => {
    const { film, scenes } = await twoSceneFilm();
    const controller = new FilmController({ runtime: mounted(scenes[0]!), film, runtimes: [mounted(scenes[0]!), mounted(scenes[1]!)] });
    const chapters = controller.chapters();
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toMatchObject({ scene: 's1', start: 0 });
    expect(chapters[0]!.title).toContain('pendulum');
    expect(chapters[1]!.scene).toBe('s2');
    expect(chapters[1]!.start).toBeGreaterThan(0);
    expect(chapters[1]!.beats).toHaveLength(8);
    const transcript = controller.transcript();
    expect(transcript).toHaveLength(14);
    expect(transcript.filter((line) => line.scene === 's2')).toHaveLength(8);
    controller.destroy();
  });

  it('jumps across scenes through the controller and the player', async () => {
    const { film, scenes } = await twoSceneFilm();
    const controller = new FilmController({ runtime: mounted(scenes[0]!), film, runtimes: [mounted(scenes[0]!), mounted(scenes[1]!)] });
    const model = new PlayerModel(controller, film);
    expect(model.chapters()).toHaveLength(2);
    expect(controller.seekChapter('s2')).toBe(true);
    expect(controller.currentBeat?.sceneId).toBe('s2');
    expect(controller.currentBeat?.id).toBe('s2b1');
    expect(model.seekChapter('s1')).toBe(true);
    expect(model.chapterNow()).toBe('s1');
    expect(controller.seekChapter('missing')).toBe(false);
    expect(controller.seekBeat('s2b5')).toBe(true);
    expect(controller.currentBeat?.id).toBe('s2b5');
    controller.destroy();
  });

  it('sequences across scenes while playing, emitting the cut', async () => {
    const { film, scenes } = await twoSceneFilm();
    const events: FilmEvent[] = [];
    const controller = new FilmController({ runtime: mounted(scenes[0]!), film, runtimes: [mounted(scenes[0]!), mounted(scenes[1]!)], onEvent: (event) => events.push(event) });
    expect(controller.multiScene).toBe(true);
    expect(controller.duration).toBe(film.seconds);
    controller.seek(film.scenes[1]!.start - 0.05);
    controller.play();
    for (let i = 0; i < 600 && controller.sceneIndex === 0; i++) controller.tick(1 / 60);
    expect(controller.sceneIndex).toBe(1);
    expect(events.some((event) => event.type === 'cut')).toBe(true);
    controller.destroy();
  });

  it('keeps one-scene controllers on their scene', async () => {
    const { film, scenes } = await twoSceneFilm();
    const controller = new FilmController({ runtime: mounted(scenes[0]!), film });
    expect(controller.multiScene).toBe(false);
    expect(controller.seekChapter('s2')).toBe(false);
    expect(controller.seekBeat('s2b1')).toBe(false);
    controller.setRuntimes([mounted(scenes[0]!), mounted(scenes[1]!)]);
    expect(controller.multiScene).toBe(true);
    expect(controller.seekChapter('s2')).toBe(true);
    controller.destroy();
  });

  it('retimes across scenes as narration audio arrives', async () => {
    const { film, scenes } = await twoSceneFilm();
    const clock = new ManualClock();
    const controller = new FilmController({ runtime: mounted(scenes[0]!), film, runtimes: [mounted(scenes[0]!), mounted(scenes[1]!)], clock });
    controller.seekChapter('s2');
    controller.attachAudio('s1b1', { seconds: 12 });
    expect(controller.currentBeat?.id).toBe('s2b1');
    expect(controller.chapters()[1]!.start).toBeGreaterThan(film.scenes[1]!.start);
    controller.destroy();
    void clock;
  });
});
