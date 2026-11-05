import { describe, expect, it } from 'vitest';
import { FilmController, PlayerModel, SceneRuntime, THIRTY_SECOND_FILM, TIMELINE_WORD_TICKS_PER_BEAT, type PlayerEvent } from '../src/index';
import { trustFixture } from './helpers/film';

async function setup() {
  const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
  const runtime = new SceneRuntime({ ...(scenes[0]!.kits ? { kits: scenes[0]!.kits } : {}), film: true });
  runtime.mount(scenes[0]!.scene);
  const controller = new FilmController({ runtime, film });
  const model = new PlayerModel(controller, film);
  return { film, runtime, controller, model };
}

describe('film player: transport', () => {
  it('plays, pauses and seeks with captions following the beat', async () => {
    const { film, model, controller } = await setup();
    const events: PlayerEvent[] = [];
    model.on((event) => events.push(event));
    expect(model.state.playing).toBe(false);
    expect(model.state.caption).toBe(null);
    model.play();
    expect(model.state.playing).toBe(true);
    expect(model.state.caption?.beat).toBe('s1b1');
    expect(model.state.caption?.say).toBe(film.beats[0]!.step.say);
    model.seek(film.beats[4]!.start);
    expect(model.state.beat).toBe('s1b5');
    expect(model.state.caption?.beat).toBe('s1b5');
    model.pause();
    expect(model.state.playing).toBe(false);
    expect(events.some((event) => event.type === 'seek')).toBe(true);
    controller.destroy();
  });

  it('steps beats and reports progress', async () => {
    const { film, model, controller } = await setup();
    model.play();
    expect(model.progress).toBe(0);
    expect(model.nextBeat()).toBe(true);
    expect(model.state.beat).toBe('s1b2');
    expect(model.progress).toBeCloseTo(film.beats[1]!.start / film.seconds, 6);
    expect(model.prevBeat()).toBe(true);
    expect(model.state.beat).toBe('s1b1');
    // The last beat has no next.
    model.seekBeat('s1b6');
    expect(model.nextBeat()).toBe(false);
    controller.destroy();
  });

  it('toggles captions, size, speed and volume', async () => {
    const { model, controller } = await setup();
    model.play();
    model.setCaptions(false);
    expect(model.state.caption).toBe(null);
    model.setCaptions(true);
    expect(model.state.caption?.beat).toBe('s1b1');
    model.setCaptionSize('lg');
    expect(model.state.captionSize).toBe('lg');
    model.setSpeed(2);
    expect(model.state.speed).toBe(2);
    model.setVolume(0.8);
    expect(model.state.volume).toBe(0.8);
    controller.destroy();
  });
});

describe('film player: transcript and timeline', () => {
  it('reads the transcript and chapters and selects beats', async () => {
    const { model, controller } = await setup();
    expect(model.transcript().length).toBe(6);
    expect(model.chapters().length).toBe(1);
    model.play();
    expect(model.selectedBeat?.id).toBe('s1b1');
    model.seekBeat('s1b4');
    expect(model.selectedBeat?.id).toBe('s1b4');
    model.selectBeat('s1b2');
    expect(model.selectedBeat?.id).toBe('s1b2');
    model.selectBeat(null);
    expect(model.selectedBeat?.id).toBe('s1b4');
    controller.destroy();
  });

  it('ticks words and spaces thumbnails across the film', async () => {
    const { film, model, controller } = await setup();
    const ticks = model.wordTicks('s1b1');
    expect(ticks.length).toBe(film.beats[0]!.words.length);
    expect(ticks[0]).toBe(0);
    expect(model.wordTicks('missing')).toEqual([]);
    const thumbs = model.thumbTimes(5);
    expect(thumbs.length).toBe(5);
    expect(thumbs[0]).toBeGreaterThan(0);
    expect(thumbs[4]).toBeLessThan(film.seconds);
    expect(model.thumbTimes(0)).toEqual([]);
    controller.destroy();
  });

  it('caps the timeline ticks of a runaway beat', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const words = Array.from({ length: TIMELINE_WORD_TICKS_PER_BEAT + 300 }, (_, i) => `w${i}`);
    const beats = film.beats.map((beat, i) => (i === 0 ? { ...beat, words } : beat));
    const runtime = new SceneRuntime({ ...(scenes[0]!.kits ? { kits: scenes[0]!.kits } : {}), film: true });
    runtime.mount(scenes[0]!.scene);
    const controller = new FilmController({ runtime, film: { ...film, beats } });
    const model = new PlayerModel(controller, { ...film, beats });
    expect(model.wordTicks('s1b1').length).toBe(TIMELINE_WORD_TICKS_PER_BEAT);
    expect(model.wordTicks('missing')).toEqual([]);
    controller.destroy();
  });

  it('asks through the controller anchor', async () => {
    const { model, controller } = await setup();
    model.play();
    model.seekBeat('s1b3');
    const asked = model.ask('What does it trade?');
    expect(asked?.anchor.beat).toBe('s1b3');
    controller.destroy();
  });
});
