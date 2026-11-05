import { describe, expect, it } from 'vitest';
import {
  compileFilm,
  FilmController,
  PlayerModel,
  SceneRuntime,
  SIXTY_SECOND_FILM,
  THIRTY_SECOND_FILM,
  type Beat,
  type CompiledFilm,
  type FilmSceneInput,
} from '../src/index';
import { trustFixture } from './helpers/film';

/**
 * The player mounts every scene of a film, not scenes[0] only: chapters span
 * scenes, cuts render between them, and single-scene films behave as today.
 */

function stepsOf(film: CompiledFilm): Beat[] {
  return film.beats.map((beat) => ({ ...beat.step }));
}

async function twoSceneFilm(): Promise<{ film: CompiledFilm; scenes: readonly FilmSceneInput[] }> {
  const thirty = await trustFixture(THIRTY_SECOND_FILM);
  const sixty = await trustFixture(SIXTY_SECOND_FILM);
  const second = SIXTY_SECOND_FILM.storyboard.scenes[0]!;
  const spec = {
    film: { id: 'two', title: 'Two scenes', version: 1, lengthTarget: 120 },
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
  if (!result.ok || !result.film) throw new Error(`Two-scene film failed: ${result.diagnostics.map((d) => d.message).join('; ')}`);
  return { film: result.film, scenes: [{ ...thirty.scenes[0]!, id: 's1' }, { ...sixty.scenes[0]!, id: 's2' }] };
}

function mounted(scene: FilmSceneInput): SceneRuntime {
  const runtime = new SceneRuntime({ ...(scene.kits ? { kits: scene.kits } : {}), film: true });
  runtime.mount(scene.scene);
  return runtime;
}

describe('film generate: multi-scene mounting', () => {
  it('mounts all scenes with progressive join as each compiles', async () => {
    const { film, scenes } = await twoSceneFilm();
    expect(film.scenes).toHaveLength(2);
    // Scenes join in order: the first mounts and plays, the second joins.
    const first = mounted(scenes[0]!);
    expect(first.isMounted).toBe(true);
    const second = mounted(scenes[1]!);
    expect(second.isMounted).toBe(true);
    const controller = new FilmController({ runtime: first, runtimes: [first, second], film });
    expect(controller.multiScene).toBe(true);
    expect(controller.sceneIndex).toBe(0);
    controller.seek(film.scenes[1]!.start);
    expect(controller.sceneIndex).toBe(1);
  });

  it('spans chapters across scenes and renders cuts between them', async () => {
    const { film, scenes } = await twoSceneFilm();
    const runtimes = scenes.map(mounted);
    const controller = new FilmController({ runtime: runtimes[0]!, runtimes, film });
    const model = new PlayerModel(controller, film);
    const chapters = model.chapters();
    expect(chapters.map((chapter) => chapter.scene)).toEqual(['s1', 's2']);
    expect(model.seekChapter('s2')).toBe(true);
    expect(controller.sceneIndex).toBe(1);
    expect(model.chapterNow()).toBe('s2');
    const cuts: Array<{ from: string; to: string }> = [];
    controller.on((event) => {
      if (event.type === 'cut') cuts.push({ from: event.from, to: event.to });
    });
    controller.seek(0);
    controller.seek(film.scenes[1]!.start + 0.1);
    expect(cuts).toContainEqual({ from: 's1', to: 's2' });
  });

  it('leaves single-scene films byte-identical to today', async () => {
    const trusted = await trustFixture(THIRTY_SECOND_FILM);
    const runtime = mounted(trusted.scenes[0]!);
    const sources = [{ id: 's1', js: THIRTY_SECOND_FILM.scenes[0]!.js, steps: stepsOf(trusted.film) }];
    const compiled = compileFilm(JSON.parse(JSON.stringify(THIRTY_SECOND_FILM.storyboard)), sources);
    expect(compiled.ok).toBe(true);
    const film = compiled.film!;
    const controller = new FilmController({ runtime, film });
    expect(controller.multiScene).toBe(false);
    expect(controller.sceneIndex).toBe(0);
    expect(controller.duration).toBeCloseTo(film.scenes[0]!.start + film.scenes[0]!.seconds, 9);
    const model = new PlayerModel(controller, film);
    expect(model.chapters()).toHaveLength(1);
    expect(model.chapters()[0]!.scene).toBe('s1');
    // No cut on a single scene: seeking to the end finishes without one.
    const cuts: unknown[] = [];
    controller.on((event) => {
      if (event.type === 'cut') cuts.push(event);
    });
    controller.seek(film.seconds - 0.01);
    expect(cuts).toHaveLength(0);
  });
});
