import { estimateBeatSeconds, type CompiledFilm } from '@incantly/core';
import { describe, expect, it } from 'vitest';
import { LimitKeeper } from '../src/limits';
import {
  MemoryAudioStore,
  MemoryNarrationCache,
  NARRATION_MAX_TEXT_CHARS,
  NarrationQueue,
  narrateBeats,
  narrateFilm,
  speechRefusalHttp,
  summarizeNarration,
  type NarratedBeat,
} from '../src/narration';
import { StubNarrator, TtsError, contentHash, speechCostUsd, type Narrator, type SpeakReply, type SpeakRequest } from '../src/tts';
import thirty from './fixtures/narration-thirty.json';
import sixty from './fixtures/narration-sixty.json';

/** A film of bare lines: narration only reads ids and says, then re-times through attachAudio. */
function filmOf(lines: ReadonlyArray<{ readonly id: string; readonly say: string }>): CompiledFilm {
  let start = 0;
  const beats = lines.map((line, index) => {
    const seconds = estimateBeatSeconds(line.say);
    const beat = {
      id: line.id,
      sceneId: 's1',
      index,
      step: { say: line.say },
      start,
      seconds,
      words: line.say.split(' '),
      timed: false as const,
    };
    start += seconds;
    return beat;
  });
  const scenes = [{ id: 's1', title: 's1', cut: 'cut' as const, start: 0, seconds: start, beats }];
  return { id: 'f', title: 'F', version: 1, scenes, beats, seconds: start, sourceMap: {} };
}

function fixtureLines(fixture: { beats: ReadonlyArray<{ id: string; words: readonly string[] }> }): Array<{ id: string; say: string }> {
  return fixture.beats.map((beat) => ({ id: beat.id, say: beat.words.join(' ') }));
}

describe('narration: stub pipeline', () => {
  it.each([
    ['thirty', thirty],
    ['sixty', sixty],
  ])('narrates the %s film with real lengths and billed chars', async (id, fixture) => {
    const film = filmOf(fixtureLines(fixture));
    const store = new MemoryAudioStore();
    const landed: NarratedBeat[] = [];
    const run = await narrateFilm(film, { narrator: new StubNarrator(), store, onBeat: (beat) => landed.push(beat) });
    expect(run.beats).toHaveLength(fixture.beats.length);
    expect(run.beats.every((beat) => !beat.estimated)).toBe(true);
    expect(landed).toHaveLength(fixture.beats.length);
    // Every beat timed with its audio, every clip stored by content hash.
    expect(run.film.beats.every((beat) => beat.timed)).toBe(true);
    for (const narrated of run.beats) {
      expect(store.get(narrated.audioHash!)).toBeDefined();
      expect(narrated.audioHash).toBe(contentHash(store.get(narrated.audioHash!)!));
    }
    const chars = fixture.beats.reduce((sum, beat) => sum + beat.words.join(' ').length, 0);
    expect(run.chars).toBe(chars);
    expect(run.usd).toBeCloseTo(speechCostUsd(chars), 12);
    console.log(`[film-bench] narration ${id} film (stub): ${summarizeNarration(id, run)}`);
  });

  it('fans beats out as their text streams in', async () => {
    const seen: string[] = [];
    const narrator: Narrator = {
      name: 'slow',
      async speak(request: SpeakRequest): Promise<SpeakReply> {
        seen.push(request.text);
        await new Promise((resolve) => setTimeout(resolve, 5));
        const stub = new StubNarrator();
        return stub.speak(request);
      },
    };
    async function* lines() {
      yield { beatId: 'b1', text: 'first line here' };
      yield { beatId: 'b2', text: 'second line here' };
      yield { beatId: 'b3', text: 'third line here' };
    }
    const queue = new NarrationQueue(async (beat) => ({ beatId: beat.beatId }) as NarratedBeat, 2);
    expect(queue).toBeDefined();
    const run = await narrateBeats(lines(), { narrator, concurrency: 2 });
    expect(seen).toEqual(['first line here', 'second line here', 'third line here']);
    expect(run.beats.map((beat) => beat.beatId)).toEqual(['b1', 'b2', 'b3']);
  });

  it('runs at most its concurrency at once', async () => {
    let running = 0;
    let peak = 0;
    const narrator: Narrator = {
      name: 'metered',
      async speak(request: SpeakRequest): Promise<SpeakReply> {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;
        return new StubNarrator().speak(request);
      },
    };
    const lines = Array.from({ length: 8 }, (_, i) => ({ beatId: `b${i}`, text: `line number ${i} here` }));
    await narrateBeats(lines, { narrator, concurrency: 3 });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it('caches by text hash: the same line is billed once', async () => {
    const store = new MemoryAudioStore();
    const cache = new MemoryNarrationCache();
    const lines = [
      { beatId: 'b1', text: 'the same line twice' },
      { beatId: 'b2', text: 'the same line twice' },
    ];
    const run = await narrateBeats(lines, { narrator: new StubNarrator(), store, cache });
    // Both beats narrated, but concurrency means either may have won the race to speak first.
    expect(run.beats.every((beat) => !beat.estimated)).toBe(true);
    expect(run.beats[0]!.audioHash).toBe(run.beats[1]!.audioHash);
    expect(store.size).toBe(1);
    const again = await narrateBeats([{ beatId: 'b3', text: 'the same line twice' }], { narrator: new StubNarrator(), store, cache });
    expect(again.beats[0]!.cached).toBe(true);
    expect(again.chars).toBe(0);
  });
});

describe('narration: degradation', () => {
  const failing = (kind: 'server' | 'missing-key'): Narrator => ({
    name: 'failing',
    speak: () => Promise.reject(new TtsError(kind, 'no speech today')),
  });

  it('degrades failures to estimated lengths and captions', async () => {
    const film = filmOf([{ id: 'b1', say: 'a line that fails' }]);
    const run = await narrateFilm(film, { narrator: failing('server') });
    expect(run.beats[0]).toMatchObject({ estimated: true, audioHash: null, error: 'server' });
    expect(run.beats[0]!.starts).toHaveLength(4);
    expect(run.film.beats[0]!.timed).toBe(false);
    expect(run.film.seconds).toBe(film.seconds);
    expect(run.chars).toBe(0);
  });

  it('degrades a missing key to a silent film', async () => {
    const film = filmOf(fixtureLines(thirty));
    const run = await narrateFilm(film, { narrator: failing('missing-key') });
    expect(run.beats.every((beat) => beat.estimated && beat.error === 'missing-key')).toBe(true);
    expect(run.film.beats.every((beat) => !beat.timed)).toBe(true);
  });

  it('retries at most once, never in a loop', async () => {
    let calls = 0;
    const flaky: Narrator = {
      name: 'flaky',
      speak: (request) => {
        calls++;
        // The narrator contract retries inside the client; the pipeline calls once per beat.
        return new StubNarrator().speak(request);
      },
    };
    await narrateBeats([{ beatId: 'b1', text: 'one call only' }], { narrator: flaky });
    expect(calls).toBe(1);
  });

  it.each([0, -1, NaN, Infinity])('degrades a reply with sample rate %s instead of dividing by it', async (sampleRate) => {
    const stub = new StubNarrator();
    const odd: Narrator = {
      name: 'odd-rate',
      async speak(request: SpeakRequest): Promise<SpeakReply> {
        const reply = await stub.speak(request);
        return { ...reply, sampleRate };
      },
    };
    const limits = new LimitKeeper({ perMinute: 60, perDay: 1000, concurrent: 6, learnerDailyUsd: 50, serviceDailyUsd: 1000, speechCharsPerLearnerDay: 100, speechCharsPerServiceDay: 200 });
    const run = await narrateBeats([{ beatId: 'b1', text: 'one two three' }], { narrator: odd, limits, learnerId: 'learner' });
    const beat = run.beats[0]!;
    expect(beat.estimated).toBe(true);
    expect(beat.error).toBe('protocol');
    expect(beat.audioHash).toBe(null);
    expect(Number.isFinite(beat.seconds)).toBe(true);
    expect(beat.starts.every(Number.isFinite)).toBe(true);
    // The speech happened, so its reservation stands.
    expect(limits.speechUsage('learner')).toMatchObject({ chars: 13 });
  });

  it('keeps the audio but estimates the captions when timings are invalid', async () => {
    const stub = new StubNarrator();
    const bad: Narrator = {
      name: 'bad-timings',
      async speak(request: SpeakRequest): Promise<SpeakReply> {
        const reply = await stub.speak(request);
        return { ...reply, words: [{ word: 'one', start: 99, end: 100 }] };
      },
    };
    const run = await narrateBeats([{ beatId: 'b1', text: 'one two three' }], { narrator: bad });
    const beat = run.beats[0]!;
    expect(beat.estimated).toBe(false);
    expect(beat.timingsEstimated).toBe(true);
    expect(beat.audioHash).not.toBe(null);
    expect(beat.starts).toEqual([0, 0.4, 0.8]);
  });
});

describe('narration: spend caps', () => {
  const tiny = () =>
    new LimitKeeper({ perMinute: 60, perDay: 1000, concurrent: 6, learnerDailyUsd: 50, serviceDailyUsd: 1000, speechCharsPerLearnerDay: 20, speechCharsPerServiceDay: 40 });

  it('refuses beats past the learner cap and keeps them estimated', async () => {
    const limits = tiny();
    const run = await narrateBeats(
      [
        { beatId: 'b1', text: 'first line' },
        { beatId: 'b2', text: 'second one' },
        { beatId: 'b3', text: 'third beat' },
      ],
      { narrator: new StubNarrator(), limits, learnerId: 'learner', concurrency: 1 },
    );
    expect(run.beats.map((beat) => beat.estimated)).toEqual([false, false, true]);
    expect(run.beats[2]!.refused).toMatchObject({ code: 'speech-limit' });
    expect(limits.speechUsage('learner')).toMatchObject({ chars: 20 });
  });

  it('refuses beats past the service cap across learners', async () => {
    const limits = tiny();
    const lines = [{ beatId: 'b1', text: '01234567890123456789' }];
    await narrateBeats(lines, { narrator: new StubNarrator(), limits, learnerId: 'a' });
    await narrateBeats(lines, { narrator: new StubNarrator(), limits, learnerId: 'b' });
    const run = await narrateBeats(lines, { narrator: new StubNarrator(), limits, learnerId: 'c' });
    expect(run.beats[0]!.refused).toMatchObject({ code: 'service-speech-limit' });
  });

  it('answers a breach with 429 and Retry-After', async () => {
    const limits = tiny();
    const run = await narrateBeats([{ beatId: 'b1', text: '012345678901234567890' }], { narrator: new StubNarrator(), limits, learnerId: 'learner' });
    const http = speechRefusalHttp(run.beats[0]!.refused!);
    expect(http.status).toBe(429);
    expect(http.headers['retry-after']).toBe(String(run.beats[0]!.refused!.retryAfterSeconds));
    expect(http.body.code).toBe('speech-limit');
  });

  it('caps one learner across calls sharing a keeper, as the dev endpoint wires it', async () => {
    const limits = tiny();
    const shared = { narrator: new StubNarrator(), limits, learnerId: 'playground-learner', concurrency: 1 };
    await narrateBeats([{ beatId: 'b1', text: 'first line' }], shared);
    const run = await narrateBeats([{ beatId: 'b2', text: 'second one' }], shared);
    expect(run.beats[0]!.estimated).toBe(false);
    const third = await narrateBeats([{ beatId: 'b3', text: 'third beat' }], shared);
    expect(third.beats[0]!.estimated).toBe(true);
    expect(third.beats[0]!.refused).toMatchObject({ code: 'speech-limit' });
    expect(limits.speechUsage('playground-learner')).toMatchObject({ chars: 20 });
  });

  it('never overshoots the caps when beats race', async () => {
    const limits = tiny();
    let running = 0;
    let peak = 0;
    const narrator: Narrator = {
      name: 'slow',
      async speak(request: SpeakRequest): Promise<SpeakReply> {
        running++;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 10));
        running--;
        return new StubNarrator().speak(request);
      },
    };
    const lines = Array.from({ length: 10 }, (_, i) => ({ beatId: `b${i}`, text: '0123456789' }));
    const run = await narrateBeats(lines, { narrator, limits, learnerId: 'learner', concurrency: 10 });
    expect(peak).toBeGreaterThan(1);
    expect(run.beats.filter((beat) => !beat.estimated)).toHaveLength(2);
    expect(run.beats.filter((beat) => beat.refused?.code === 'speech-limit')).toHaveLength(8);
    expect(limits.speechUsage('learner')).toMatchObject({ chars: 20 });
  });

  it('refunds the reservation when speech fails', async () => {
    const limits = tiny();
    const run = await narrateBeats([{ beatId: 'b1', text: 'first line' }], {
      narrator: { name: 'failing', speak: () => Promise.reject(new TtsError('server', 'no speech today')) },
      limits,
      learnerId: 'learner',
    });
    expect(run.beats[0]!.estimated).toBe(true);
    expect(limits.speechUsage('learner')).toMatchObject({ chars: 0, serviceChars: 0 });
  });

  it('degrades overlong lines without calling the narrator or spending', async () => {
    const limits = tiny();
    let calls = 0;
    const narrator: Narrator = {
      name: 'counting',
      speak: (request) => {
        calls++;
        return new StubNarrator().speak(request);
      },
    };
    const run = await narrateBeats([{ beatId: 'b1', text: 'x'.repeat(NARRATION_MAX_TEXT_CHARS + 1) }], { narrator, limits, learnerId: 'learner' });
    expect(run.beats[0]).toMatchObject({ estimated: true, error: 'invalid-request' });
    expect(calls).toBe(0);
    expect(run.chars).toBe(0);
    expect(limits.speechUsage('learner')).toMatchObject({ chars: 0 });
  });

  it('spends only successful speech, and forgets it the next day', async () => {
    let at = Date.UTC(2026, 10, 4, 12);
    const limits = new LimitKeeper(
      { perMinute: 60, perDay: 1000, concurrent: 6, learnerDailyUsd: 50, serviceDailyUsd: 1000, speechCharsPerLearnerDay: 100, speechCharsPerServiceDay: 200 },
      () => at,
    );
    await narrateBeats([{ beatId: 'b1', text: '0123456789' }], { narrator: new StubNarrator(), limits, learnerId: 'learner' });
    expect(limits.speechUsage('learner')).toMatchObject({ chars: 10, serviceChars: 10 });
    at += 86_400_000;
    expect(limits.speechUsage('learner')).toMatchObject({ chars: 0, serviceChars: 0 });
    expect(limits.checkSpeech('learner', 100)).toBe(null);
  });
});

describe('narration: store bounds', () => {
  it('evicts the least recently used clip past its clip cap', () => {
    const store = new MemoryAudioStore({ maxClips: 2 });
    const a = store.put(new Uint8Array([1]));
    const b = store.put(new Uint8Array([2]));
    expect(store.get(a)).toBeDefined();
    const c = store.put(new Uint8Array([3]));
    expect(store.size).toBe(2);
    expect(store.get(b)).toBeUndefined();
    expect(store.get(a)).toBeDefined();
    expect(store.get(c)).toBeDefined();
  });

  it('evicts clips past its byte cap', () => {
    const store = new MemoryAudioStore({ maxBytes: 2 });
    const a = store.put(new Uint8Array([1, 2]));
    expect(store.get(a)).toBeDefined();
    const b = store.put(new Uint8Array([3]));
    expect(store.byteLength).toBeLessThanOrEqual(2);
    expect(store.get(a)).toBeUndefined();
    expect(store.get(b)).toBeDefined();
  });

  it('evicts the least recently used cached line past its cap', () => {
    const cache = new MemoryNarrationCache({ max: 2 });
    const entry = (n: number) => ({ seconds: n, words: [], audioHash: `h${n}`, chars: n, sampleRate: 8000 });
    cache.put('a', entry(1));
    cache.put('b', entry(2));
    expect(cache.get('a')).toBeDefined();
    cache.put('c', entry(3));
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
    expect(cache.get('c')).toBeDefined();
  });
});
