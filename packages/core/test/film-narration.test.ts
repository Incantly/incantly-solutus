import { describe, expect, it } from 'vitest';
import {
  attachAudio,
  FilmController,
  FilmMixer,
  MemoryMixerBackend,
  PlayerModel,
  probeFilm,
  sanitizeWordStarts,
  SceneRuntime,
  THIRTY_SECOND_FILM,
  wordStarts,
  BED_DUCKED_LEVEL,
  BED_LEVEL,
  FILM_BEAT_HOLD_SECONDS,
  type BeatAudio,
  type CompiledFilm,
  type FilmEvent,
  type MixerClip,
} from '../src/index';
import { trustFixture } from './helpers/film';

async function setup() {
  const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
  const runtime = new SceneRuntime({ ...(scenes[0]!.kits ? { kits: scenes[0]!.kits } : {}), film: true });
  runtime.mount(scenes[0]!.scene);
  const controller = new FilmController({ runtime, film });
  const model = new PlayerModel(controller, film);
  return { film, runtime, controller, model };
}

/** Narration audio for a beat's words: one word every 0.4 s, like the stub. */
function audioFor(film: CompiledFilm, beatId: string): BeatAudio {
  const beat = film.beats.find((candidate) => candidate.id === beatId)!;
  const words = beat.words.map((_, i) => i * 0.4);
  return { seconds: (beat.words.length - 1) * 0.4 + 0.36, words };
}

describe('film narration: audio clock', () => {
  it('takes the audio length plus the hold, keeping estimates until audio arrives', async () => {
    const { film } = await setup();
    expect(film.beats.every((beat) => !beat.timed)).toBe(true);
    const retimed = attachAudio(film, 's1b2', audioFor(film, 's1b2'));
    const beat = retimed.beats[1]!;
    expect(beat.timed).toBe(true);
    expect(beat.seconds).toBeCloseTo(audioFor(film, 's1b2').seconds + FILM_BEAT_HOLD_SECONDS, 9);
    expect(retimed.beats[0]!.timed).toBe(false);
  });

  it('ticks words from the audio once it arrives', async () => {
    const { film } = await setup();
    const retimed = attachAudio(film, 's1b1', audioFor(film, 's1b1'));
    const beat = retimed.beats[0]!;
    expect(wordStarts(beat)).toEqual(beat.audioStarts!.map((start) => beat.start + start));
    expect(beat.audioStarts![1]! - beat.audioStarts![0]!).toBeCloseTo(0.4, 12);
  });

  it('drops invalid word starts and ticks from the estimate', async () => {
    const { film } = await setup();
    const beat = film.beats[0]!;
    const count = beat.words.length;
    const audioSeconds = 5;
    expect(sanitizeWordStarts([0, 0.4, 0.2], 3, audioSeconds)).toBe(undefined);
    expect(sanitizeWordStarts([0, 6], 2, audioSeconds)).toBe(undefined);
    expect(sanitizeWordStarts([0], 2, audioSeconds)).toBe(undefined);
    expect(sanitizeWordStarts([0, NaN], 2, audioSeconds)).toBe(undefined);
    expect(sanitizeWordStarts(undefined, 2, audioSeconds)).toBe(undefined);
    const retimed = attachAudio(film, beat.id, { seconds: audioSeconds, words: [0.4, 0.2, ...Array(count - 2).fill(0.5)] });
    const timed = retimed.beats[0]!;
    expect(timed.timed).toBe(true);
    expect(timed.audioStarts).toBe(undefined);
    expect(wordStarts(timed)[1]! - wordStarts(timed)[0]!).toBeCloseTo(0.4, 12);
  });

  it('re-times the controller in place as audio arrives, keeping the beat', async () => {
    const { film, controller } = await setup();
    const events: FilmEvent[] = [];
    controller.on((event) => events.push(event));
    controller.play();
    expect(controller.currentBeat!.id).toBe('s1b1');
    const before = controller.duration;
    controller.attachAudio('s1b1', audioFor(film, 's1b1'));
    expect(controller.currentBeat!.id).toBe('s1b1');
    expect(events.some((event) => event.type === 'retime')).toBe(true);
    // The controller consumes the real length: the duration moved with it.
    const retimed = attachAudio(film, 's1b1', audioFor(film, 's1b1'));
    expect(controller.duration).toBeCloseTo(retimed.scenes[0]!.seconds, 9);
    expect(controller.duration).not.toBe(before);
  });
});

describe('film narration: captions', () => {
  it('carries words with their starts for the karaoke highlight', async () => {
    const { film, model } = await setup();
    model.play();
    const caption = model.state.caption!;
    expect(caption.words).toEqual(film.beats[0]!.words);
    expect(caption.wordStarts).toHaveLength(film.beats[0]!.words.length);
    expect(caption.wordStarts[0]).toBe(caption.start);
  });

  it('finds the word sounding at a film time', async () => {
    const { film, model } = await setup();
    const beat = film.beats[0]!;
    expect(model.wordIndexAt(beat.id, beat.start - 0.01)).toBe(-1);
    expect(model.wordIndexAt(beat.id, beat.start)).toBe(0);
    expect(model.wordIndexAt(beat.id, beat.start + 0.41)).toBe(1);
    expect(model.wordIndexAt('missing', 0)).toBe(-1);
  });

  it('keeps audio and captions within one frame', async () => {
    const { film } = await setup();
    let retimed = film;
    for (const beat of film.beats) retimed = attachAudio(retimed, beat.id, audioFor(film, beat.id));
    const { controller } = await setup();
    const model = new PlayerModel(controller, retimed);
    const frame = 1 / 60;
    for (const beat of retimed.beats) {
      const starts = wordStarts(beat);
      starts.forEach((start, i) => {
        // Half a frame after a word starts, the highlight shows it; half a
        // frame before, it still shows the word ahead.
        expect(model.wordIndexAt(beat.id, start + frame / 2)).toBe(i);
        expect(model.wordIndexAt(beat.id, start - frame / 2)).toBe(i - 1);
      });
    }
  });
});

describe('film narration: checks', () => {
  it('passes audio sync on timed beats and counts speech chars', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    let retimed = film;
    for (const beat of film.beats) retimed = attachAudio(retimed, beat.id, audioFor(film, beat.id));
    const report = probeFilm({ film: retimed, scenes });
    expect(report.failures).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.stats.speechChars).toBe(film.beats.reduce((sum, beat) => sum + beat.step.say.length, 0));
    console.log(`[film-bench] narration: ${report.stats.speechChars} speech chars on the 30 s film`);
  });

  it('fails audio sync on corrupt word starts', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const beat = film.beats[0]!;
    const corrupt: CompiledFilm = {
      ...film,
      beats: film.beats.map((candidate, i) => (i === 0 ? { ...candidate, timed: true as const, audioStarts: [0.4, 0.2, ...candidate.words.slice(2).map((_, j) => 0.5 + j * 0.4)] } : candidate)),
    };
    expect(beat.words.length).toBeGreaterThan(2);
    const report = probeFilm({ film: corrupt, scenes });
    expect(report.failures.some((failure) => failure.check === 'audio-sync')).toBe(true);
  });

  it('still warns while any beat stays estimated', async () => {
    const { film, scenes } = await trustFixture(THIRTY_SECOND_FILM);
    const report = probeFilm({ film, scenes });
    expect(report.warnings).toHaveLength(1);
    expect(report.stats.speechChars).toBeGreaterThan(0);
  });
});

describe('film narration: mixing', () => {
  const clip = (beatId: string): MixerClip => ({ beatId, hash: `hash-${beatId}`, pcm: new Uint8Array([0, 0]), sampleRate: 8000, seconds: 1 });

  it('stays silent until the viewer turns sound on', () => {
    const backend = new MemoryMixerBackend();
    const mixer = new FilmMixer(backend);
    mixer.attach(clip('s1b1'));
    mixer.onBeat('s1b1');
    expect(backend.plays()).toEqual([]);
    mixer.setEnabled(true);
    mixer.onBeat('s1b1');
    expect(backend.plays()).toEqual([{ type: 'play', hash: 'hash-s1b1', offset: 0 }]);
  });

  it('ducks the bed under speech and brings it back after', () => {
    const backend = new MemoryMixerBackend();
    const mixer = new FilmMixer(backend);
    mixer.setEnabled(true);
    mixer.attach(clip('s1b1'));
    mixer.onBeat('s1b1', 0.5);
    expect(backend.plays()).toEqual([{ type: 'play', hash: 'hash-s1b1', offset: 0.5 }]);
    expect(backend.events.filter((event) => event.type === 'bed').at(-1)).toEqual({ type: 'bed', level: BED_DUCKED_LEVEL });
    mixer.onLineEnd();
    expect(backend.events.filter((event) => event.type === 'bed').at(-1)).toEqual({ type: 'bed', level: BED_LEVEL });
  });

  it('stops the line on seeks and pauses, and leaves beats without clips silent', () => {
    const backend = new MemoryMixerBackend();
    const mixer = new FilmMixer(backend);
    mixer.setEnabled(true);
    mixer.attach(clip('s1b1'));
    mixer.onBeat('s1b1');
    mixer.onInterrupt();
    expect(backend.events.filter((event) => event.type === 'stop')).toHaveLength(1);
    mixer.onBeat('s1b2');
    expect(backend.plays()).toHaveLength(1);
    mixer.setVolume(0.8);
    expect(backend.events.filter((event) => event.type === 'volume')).toEqual([{ type: 'volume', level: 0.8 }]);
    mixer.setEnabled(false);
    expect(mixer.isOn).toBe(false);
  });

  it('clamps offsets into the clip', () => {
    const backend = new MemoryMixerBackend();
    const mixer = new FilmMixer(backend);
    mixer.setEnabled(true);
    mixer.attach(clip('s1b1'));
    mixer.onBeat('s1b1', 99);
    expect(backend.plays()).toEqual([{ type: 'play', hash: 'hash-s1b1', offset: 1 }]);
  });
});
