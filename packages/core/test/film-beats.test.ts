import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  attachAudio,
  compileFilm,
  countWords,
  estimateBeatSeconds,
  FILM_BEAT_HOLD_SECONDS,
  FILM_BEAT_MAX_SECONDS,
  FILM_MAX_DIAGNOSTICS,
  FILM_MAX_SCENES,
  resolveAnchor,
  SIXTY_SECOND_FILM,
  THIRTY_SECOND_FILM,
  wordStarts,
  type Beat,
} from '../src/index';
import { compileFixture } from './helpers/film';

describe('film compiler: estimates', () => {
  it('counts words and estimates 2.5 words per second plus the hold', () => {
    expect(countWords('  one   two three\nfour ')).toBe(4);
    expect(estimateBeatSeconds('one two three four')).toBeCloseTo(4 / 2.5 + FILM_BEAT_HOLD_SECONDS, 12);
  });

  it('never estimates under the two-second minimum', () => {
    expect(estimateBeatSeconds('Go.')).toBe(2);
  });
});

describe('film compiler: fixtures', () => {
  it('compiles the 30 s silent film near 30 s', async () => {
    const { film, diagnostics } = await compileFixture(THIRTY_SECOND_FILM);
    expect(film.beats.length).toBe(6);
    expect(film.beats.map((beat) => beat.id)).toEqual(['s1b1', 's1b2', 's1b3', 's1b4', 's1b5', 's1b6']);
    expect(film.seconds).toBeGreaterThan(27);
    expect(film.seconds).toBeLessThan(33);
    // Beats run back to back from the film's start.
    expect(film.beats[0]!.start).toBe(0);
    film.beats.forEach((beat, i) => {
      if (i === 0) return;
      expect(beat.start).toBeCloseTo(film.beats[i - 1]!.start + film.beats[i - 1]!.seconds, 9);
    });
    expect(film.seconds).toBeCloseTo(film.beats.reduce((total, beat) => total + beat.seconds, 0), 9);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('compiles the 1 min silent film near 60 s', async () => {
    const { film } = await compileFixture(SIXTY_SECOND_FILM);
    expect(film.beats.length).toBe(8);
    expect(film.seconds).toBeGreaterThan(54);
    expect(film.seconds).toBeLessThan(66);
  });

  it('keeps the scene cut per scene', async () => {
    const { film } = await compileFixture(THIRTY_SECOND_FILM);
    expect(film.scenes[0]!.cut).toBe('fade');
  });
});

describe('film compiler: source map and anchors', () => {
  it('maps each beat to scene lines and parts', async () => {
    const { film } = await compileFixture(THIRTY_SECOND_FILM);
    const entry = film.sourceMap['s1b3']!;
    expect(entry.beat).toBe('s1b3');
    expect(entry.scene).toBe('s1');
    expect(entry.parts).toContain('Bob');
    expect(entry.lines.length).toBeGreaterThan(0);
    for (const line of entry.lines) {
      expect(Number.isInteger(line)).toBe(true);
      expect(line).toBeGreaterThan(0);
    }
    // Every beat maps somewhere.
    for (const beat of film.beats) expect(film.sourceMap[beat.id]).toBeDefined();
  });

  it('anchors beats by id, never seconds', async () => {
    const { film } = await compileFixture(THIRTY_SECOND_FILM);
    const anchor = anchorFor(film, 's1b2', 1500)!;
    expect(anchor).toMatchObject({ film: 'pendulum', version: 1, scene: 's1', beat: 's1b2', offsetMs: 1500 });
    expect(anchorFor(film, 'missing')).toBe(null);
    const beat = film.beats[1]!;
    expect(resolveAnchor(film, anchor)).toBeCloseTo(beat.start + 1.5, 9);
    // Another film or version does not resolve.
    expect(resolveAnchor(film, { ...anchor, film: 'other' })).toBe(null);
    expect(resolveAnchor(film, { ...anchor, version: 2 })).toBe(null);
  });

  it('re-times what follows when audio arrives', async () => {
    const { film } = await compileFixture(THIRTY_SECOND_FILM);
    const before = film.beats[2]!.start;
    const retimed = attachAudio(film, 's1b2', { seconds: 10 });
    expect(retimed.beats[1]!.seconds).toBeCloseTo(10 + FILM_BEAT_HOLD_SECONDS, 9);
    expect(retimed.beats[1]!.timed).toBe(true);
    expect(retimed.beats[0]!.timed).toBe(false);
    expect(retimed.beats[2]!.start).toBeCloseTo(before + (10 + FILM_BEAT_HOLD_SECONDS - film.beats[1]!.seconds), 9);
    expect(retimed.seconds).toBeCloseTo(film.seconds + (10 + FILM_BEAT_HOLD_SECONDS - film.beats[1]!.seconds), 9);
    // Anchors survive the re-time: the same beat still resolves.
    expect(resolveAnchor(retimed, anchorFor(retimed, 's1b3')!)).toBeCloseTo(retimed.beats[2]!.start, 9);
    expect(attachAudio(film, 'missing', { seconds: 3 })).toBe(film);
  });

  it('clamps narration audio past the beat maximum', async () => {
    const { film } = await compileFixture(THIRTY_SECOND_FILM);
    const retimed = attachAudio(film, 's1b2', { seconds: 1e9 });
    expect(retimed.beats[1]!.seconds).toBe(FILM_BEAT_MAX_SECONDS);
    expect(retimed.beats[1]!.timed).toBe(true);
  });

  it('ticks words at 2.5 per second until audio arrives', async () => {
    const { film } = await compileFixture(THIRTY_SECOND_FILM);
    const beat = film.beats[0]!;
    const ticks = wordStarts(beat);
    expect(ticks.length).toBe(beat.words.length);
    expect(ticks[0]).toBe(beat.start);
    expect(ticks[1]! - ticks[0]!).toBeCloseTo(1 / 2.5, 12);
  });
});

describe('film compiler: diagnostics', () => {
  const steps = (says: string[]): Beat[] => says.map((say) => ({ say }));

  it('fails a storyboard whose beats disagree with the scene', () => {
    const spec = {
      film: { id: 'f', title: 'F' },
      scenes: [{ id: 's1', beats: [{ id: 'b1', say: 'Something else entirely' }] }],
    };
    const result = compileFilm(spec, [{ id: 's1', js: 'inc.steps([{ say: "Hello there" }]);', steps: steps(['Hello there']) }]);
    expect(result.ok).toBe(false);
    expect(result.film).toBe(null);
    expect(result.diagnostics.some((d) => d.message.includes('says') && d.beat === 'b1')).toBe(true);
  });

  it('fails a beat count mismatch and a bad cut', () => {
    const spec = {
      film: { id: 'f', title: 'F' },
      scenes: [{ id: 's1', cut: 'explode', beats: [{ id: 'b1', say: 'Hello there' }] }],
    };
    const result = compileFilm(spec, [{ id: 's1', js: '', steps: steps(['Hello there', 'And more']) }]);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.message.includes('storyboard beats'))).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes('cuts with'))).toBe(true);
  });

  it('fails a storyboard with no film or scenes', () => {
    expect(compileFilm({}, []).ok).toBe(false);
    expect(compileFilm({ film: { title: 'F' }, scenes: [] }, []).ok).toBe(false);
  });

  it('warns where the storyboard drifted from the scene', () => {
    const spec = {
      film: { id: 'f', title: 'F' },
      scenes: [{ id: 's1', beats: [{ id: 'b1', say: 'Hello there', focus: 'Old' }] }],
    };
    const result = compileFilm(spec, [{ id: 's1', js: "stage.part('New', x);", steps: [{ say: 'Hello there', focus: 'New' }] }]);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('drifted'))).toBe(true);
  });

  it('warns where predict drifted from the scene', () => {
    const spec = {
      film: { id: 'f', title: 'F' },
      scenes: [{ id: 's1', beats: [{ id: 'b1', say: 'Hello there', predict: { question: 'Old?', options: ['a', 'b'], answer: 0 } }] }],
    };
    const steps: Beat[] = [{ say: 'Hello there', predict: { question: 'New?', options: ['a', 'b'], answer: 1 } }];
    const result = compileFilm(spec, [{ id: 's1', js: '', steps }]);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('predict drifted'))).toBe(true);
  });

  it('rejects a storyboard past the scene cap', () => {
    const scenes = Array.from({ length: FILM_MAX_SCENES + 1 }, (_, i) => ({ id: `s${i}`, beats: [{ id: `b${i}`, say: 'Hello there' }] }));
    const sources = scenes.map((scene) => ({ id: scene.id, js: '', steps: [{ say: 'Hello there' }] }));
    const result = compileFilm({ film: { id: 'f', title: 'F' }, scenes }, sources);
    expect(result.ok).toBe(false);
    expect(result.film).toBe(null);
    expect(result.diagnostics.some((d) => d.message.includes('scenes'))).toBe(true);
  });

  it('caps the diagnostics a hostile storyboard can grow', () => {
    const beats = Array.from({ length: 150 }, (_, i) => ({ id: `b${i}`, say: `Say number ${i} here`, focus: 'Old' }));
    const steps: Beat[] = beats.map((beat) => ({ say: beat.say, focus: 'New' }));
    const result = compileFilm({ film: { id: 'f', title: 'F' }, scenes: [{ id: 's1', beats }] }, [{ id: 's1', js: '', steps }]);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.length).toBe(FILM_MAX_DIAGNOSTICS);
  });

  it('compares drift fields that JSON refuses, without throwing', () => {
    const cyclic: Record<string, unknown> = { question: 'Loop?' };
    cyclic.self = cyclic;
    const spec = { film: { id: 'f', title: 'F' }, scenes: [{ id: 's1', beats: [{ id: 'b1', say: 'Hello there', predict: cyclic }] }] };
    const steps: Beat[] = [{ say: 'Hello there', predict: { question: 'Other?', options: ['a'], answer: 0 } }];
    const result = compileFilm(spec, [{ id: 's1', js: '', steps }]);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes('predict drifted'))).toBe(true);
  });

  it('excerpts huge say text in mismatch errors', () => {
    const longSay = 'word '.repeat(20000).trim();
    const spec = { film: { id: 'f', title: 'F' }, scenes: [{ id: 's1', beats: [{ id: 'b1', say: longSay }] }] };
    const result = compileFilm(spec, [{ id: 's1', js: '', steps: [{ say: 'Hello there' }] }]);
    expect(result.ok).toBe(false);
    const message = result.diagnostics.find((d) => d.beat === 'b1')!.message;
    expect(message.length).toBeLessThan(1000);
    expect(message).toContain('…');
  });

  it('excerpts huge ids and cuts in diagnostics', () => {
    const longBeat = `b-${'x'.repeat(2000)}`;
    const longScene = `s-${'z'.repeat(2000)}`;
    const spec = {
      film: { id: 'f', title: 'F' },
      scenes: [
        { id: 's1', cut: `explode-${'y'.repeat(2000)}`, beats: [{ id: longBeat, say: 'Hello there' }, { id: longBeat, say: 'Hello again' }] },
        { id: longScene, beats: [{ id: 'b9', say: 'Hi' }] },
      ],
    };
    const result = compileFilm(spec, [{ id: 's1', js: '', steps: [{ say: 'Hello there' }, { say: 'Hello again' }] }]);
    expect(result.ok).toBe(false);
    for (const diagnostic of result.diagnostics) expect(diagnostic.message.length).toBeLessThan(1000);
    expect(result.diagnostics.some((d) => d.message.includes('is used twice') && d.message.includes('…'))).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes('cuts with') && d.message.includes('…'))).toBe(true);
    expect(result.diagnostics.some((d) => d.message.includes('has no source') && d.message.includes('…'))).toBe(true);
    // The structured fields keep the full ids for machines.
    expect(result.diagnostics.some((d) => d.beat === longBeat)).toBe(true);
    expect(result.diagnostics.some((d) => d.scene === longScene)).toBe(true);
  });
});
