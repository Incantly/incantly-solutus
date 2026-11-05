import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CARTESIA_API_VERSION,
  CartesiaClient,
  StubNarrator,
  TtsError,
  applyCartesiaSseEvent,
  cartesiaConnection,
  cartesiaHttpError,
  cartesiaRetentionAccepted,
  cartesiaVoiceFromEnv,
  checkCartesiaKey,
  contentHash,
  countSpeechWords,
  estimateWordTimings,
  resolveCartesiaVoice,
  speechCostUsd,
  timingsSeconds,
  validateWordTimings,
  voiceTail,
} from '../src/tts';
import thirty from './fixtures/narration-thirty.json';
import sixty from './fixtures/narration-sixty.json';

interface TimingFixture {
  readonly film: string;
  readonly narrator: string;
  readonly sampleRate: number;
  readonly beats: ReadonlyArray<{
    readonly id: string;
    readonly chars: number;
    readonly seconds: number;
    readonly audioHash: string;
    readonly words: readonly string[];
    readonly starts: readonly number[];
    readonly ends: readonly number[];
  }>;
}

function saysOf(fixture: TimingFixture): string[] {
  return fixture.beats.map((beat) => beat.words.join(' '));
}

describe('tts: stub narrator', () => {
  it('derives words at 2.5 per second from the text', () => {
    const words = estimateWordTimings('one two three');
    expect(words.map((word) => word.word)).toEqual(['one', 'two', 'three']);
    expect(words[0]!.start).toBe(0);
    expect(words[0]!.end).toBeCloseTo(0.36, 12);
    expect(words[1]!.start - words[0]!.start).toBeCloseTo(0.4, 12);
    expect(timingsSeconds(words)).toBeCloseTo(1.16, 12);
    expect(estimateWordTimings('  ')).toEqual([]);
    expect(countSpeechWords('  one   two ')).toBe(2);
  });

  it('speaks deterministic silent audio with the same bytes for the same text', async () => {
    const stub = new StubNarrator();
    const first = await stub.speak({ text: 'A pendulum hangs from its pivot.' });
    const second = await stub.speak({ text: 'A pendulum hangs from its pivot.' });
    expect(first.model).toBe('stub-silent');
    expect(first.chars).toBe('A pendulum hangs from its pivot.'.length);
    expect(first.audio).toEqual(second.audio);
    expect([...first.audio].every((byte) => byte === 0)).toBe(true);
    expect(contentHash(first.audio)).toBe(contentHash(second.audio));
    expect(first.words).toEqual(second.words);
    const different = await stub.speak({ text: 'Something else entirely.' });
    expect(contentHash(different.audio)).not.toBe(contentHash(first.audio));
  });

  it('streams one chunk per word as the line arrives', async () => {
    const stub = new StubNarrator();
    const chunks: Uint8Array[] = [];
    const reply = await stub.speak({ text: 'one two three', onAudio: (chunk) => chunks.push(chunk) });
    expect(chunks.length).toBe(3);
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBe(reply.audio.length);
  });

  it('hashes content with sha256, so collisions cannot serve the wrong clip', () => {
    const bytes = new TextEncoder().encode('A pendulum hangs from its pivot.');
    expect(contentHash(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(contentHash('A pendulum hangs from its pivot.')).toBe(createHash('sha256').update('A pendulum hangs from its pivot.', 'utf8').digest('hex'));
    expect(contentHash(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['thirty', thirty as TimingFixture],
    ['sixty', sixty as TimingFixture],
  ])('matches the checked-in %s word timings exactly', async (_, fixture) => {
    const stub = new StubNarrator();
    expect(fixture.narrator).toBe('stub-silent');
    for (const [i, beat] of fixture.beats.entries()) {
      const reply = await stub.speak({ text: saysOf(fixture)[i]! });
      expect(reply.sampleRate).toBe(fixture.sampleRate);
      expect(reply.chars).toBe(beat.chars);
      expect(reply.words.map((word) => word.word)).toEqual(beat.words);
      expect(reply.words.map((word) => word.start)).toEqual(beat.starts);
      expect(reply.words.map((word) => word.end)).toEqual(beat.ends);
      expect(contentHash(reply.audio)).toBe(beat.audioHash);
    }
  });
});

describe('tts: timing validation', () => {
  const text = 'one two three';

  it('accepts monotonic timings within the audio', () => {
    expect(validateWordTimings(estimateWordTimings(text), 1.16).ok).toBe(true);
  });

  it('rejects timings that run backwards, past the audio, or nowhere', () => {
    expect(validateWordTimings([{ word: 'one', start: 0.4, end: 0.7 }, { word: 'two', start: 0.2, end: 0.5 }], 1).ok).toBe(false);
    expect(validateWordTimings([{ word: 'one', start: 0.3, end: 0.2 }], 1).problems).toHaveLength(1);
    expect(validateWordTimings([{ word: 'one', start: 0, end: 2 }], 1).problems).toHaveLength(1);
    expect(validateWordTimings([{ word: 'one', start: NaN, end: 0.3 }], 1).problems).toHaveLength(1);
    expect(validateWordTimings([{ word: 'one', start: -0.5, end: 0.3 }], 1).problems).toHaveLength(1);
  });
});

describe('tts: speech cost', () => {
  it('prices characters at the list rate', () => {
    expect(speechCostUsd(0)).toBe(0);
    expect(speechCostUsd(100_000)).toBeCloseTo(5, 12);
    expect(speechCostUsd(1_000_000)).toBeCloseTo(50, 12);
  });
});

describe('tts: Cartesia client', () => {
  const sse = (frames: string[]): string => frames.map((frame) => `data: ${frame}\n\n`).join('');

  it('asks for raw PCM with word timestamps', () => {
    const client = new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true });
    expect(client.body('Hello there', 'voice-id')).toEqual({
      model_id: 'sonic-3.6',
      transcript: 'Hello there',
      voice: { id: 'voice-id' },
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
      language: 'en',
      add_timestamps: true,
    });
  });

  it('refuses to construct without a key, with a clear error', () => {
    let error: unknown;
    try {
      new CartesiaClient({ apiKey: '', voice: 'voice-id' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TtsError);
    expect((error as TtsError).kind).toBe('missing-key');
    expect((error as TtsError).message).toMatch(/CARTESIA_API_KEY/);
    expect((error as TtsError).retryable).toBe(false);
  });

  it('refuses real calls unless retention is accepted, and leaves the stub alone', async () => {
    let error: unknown;
    try {
      new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: false });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TtsError);
    expect((error as TtsError).kind).toBe('retention-not-accepted');
    expect((error as TtsError).message).toMatch(/CARTESIA_RETENTION_ACCEPTED/);
    expect((error as TtsError).retryable).toBe(false);
    expect(() => new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true })).not.toThrow();
    await expect(new StubNarrator().speak({ text: 'Hi' })).resolves.toBeDefined();
  });

  it('reads retention acceptance from CARTESIA_RETENTION_ACCEPTED, fail-closed', () => {
    const before = process.env.CARTESIA_RETENTION_ACCEPTED;
    try {
      delete process.env.CARTESIA_RETENTION_ACCEPTED;
      expect(cartesiaRetentionAccepted()).toBe(false);
      expect(() => new CartesiaClient({ apiKey: 'key', voice: 'voice-id' })).toThrowError(TtsError);
      process.env.CARTESIA_RETENTION_ACCEPTED = '1';
      expect(cartesiaRetentionAccepted()).toBe(true);
      expect(() => new CartesiaClient({ apiKey: 'key', voice: 'voice-id' })).not.toThrow();
      process.env.CARTESIA_RETENTION_ACCEPTED = 'yes';
      expect(cartesiaRetentionAccepted()).toBe(false);
    } finally {
      if (before === undefined) delete process.env.CARTESIA_RETENTION_ACCEPTED;
      else process.env.CARTESIA_RETENTION_ACCEPTED = before;
    }
  });

  it('streams audio and timestamps from SSE events', () => {
    const state = { chunks: [], bytes: 0, words: [], done: false };
    const first = applyCartesiaSseEvent(JSON.stringify({ type: 'chunk', data: Buffer.from([1, 2, 3]).toString('base64') }), state);
    expect([...first!]).toEqual([1, 2, 3]);
    expect(applyCartesiaSseEvent(JSON.stringify({ type: 'timestamps', word_timestamps: { words: ['Hi'], start: [0], end: [0.3] } }), state)).toBe(null);
    expect(state.words).toEqual([{ word: 'Hi', start: 0, end: 0.3 }]);
    expect(applyCartesiaSseEvent(JSON.stringify({ type: 'done', done: true }), state)).toBe(null);
    expect(state.done).toBe(true);
    expect(() => applyCartesiaSseEvent('not json', state)).toThrowError(TtsError);
    expect(() => applyCartesiaSseEvent(JSON.stringify({ type: 'error', message: 'bad voice' }), state)).toThrowError(/bad voice/);
  });

  it('speaks through the SSE endpoint with versioned auth', async () => {
    const seen: Request[] = [];
    const fetch = (async (input: string, init?: RequestInit) => {
      seen.push(new Request(input, init));
      return new Response(
        sse([
          JSON.stringify({ type: 'chunk', data: Buffer.from([0, 0, 1, 1]).toString('base64') }),
          JSON.stringify({ type: 'timestamps', word_timestamps: { words: ['Hi', 'there'], start: [0, 0.3], end: [0.25, 0.6] } }),
          JSON.stringify({ type: 'done', done: true }),
        ]),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof globalThis.fetch;
    const client = new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true, fetch });
    const heard: Uint8Array[] = [];
    const reply = await client.speak({ text: 'Hi there', onAudio: (chunk) => heard.push(chunk) });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.cartesia.ai/tts/sse');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer key');
    expect(seen[0]!.headers.get('cartesia-version')).toBe(CARTESIA_API_VERSION);
    expect([...reply.audio]).toEqual([0, 0, 1, 1]);
    expect(reply.sampleRate).toBe(24000);
    expect(reply.words).toEqual([
      { word: 'Hi', start: 0, end: 0.25 },
      { word: 'there', start: 0.3, end: 0.6 },
    ]);
    expect(reply.chars).toBe('Hi there'.length);
    expect(heard).toHaveLength(1);
  });

  it('retries once on a transient fault, then gives up', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ message: 'busy' }), { status: 503 });
      return new Response(sse([JSON.stringify({ type: 'done', done: true })]), { headers: { 'content-type': 'text/event-stream' } });
    }) as typeof globalThis.fetch;
    const client = new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true, fetch });
    const reply = await client.speak({ text: 'Hi' });
    expect(calls).toBe(2);
    expect(reply.words).toEqual([]);
  });

  it('never retries after audio streamed', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return new Response(
        sse([
          JSON.stringify({ type: 'chunk', data: Buffer.from([0, 0]).toString('base64') }),
          JSON.stringify({ type: 'error', message: 'the stream broke' }),
        ]),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    }) as typeof globalThis.fetch;
    const client = new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true, fetch });
    await expect(client.speak({ text: 'Hi' })).rejects.toMatchObject({ name: 'TtsError', kind: 'server' });
    expect(calls).toBe(1);
  });

  it('gives up after one retry on a stubborn fault', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ message: 'busy' }), { status: 503 });
    }) as typeof globalThis.fetch;
    const client = new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true, fetch });
    await expect(client.speak({ text: 'Hi' })).rejects.toMatchObject({ kind: 'overloaded' });
    expect(calls).toBe(2);
  });

  it('clamps retries to one, whatever the caller asks for', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ message: 'busy' }), { status: 503 });
    }) as typeof globalThis.fetch;
    const client = new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true, retries: 5, fetch });
    await expect(client.speak({ text: 'Hi' })).rejects.toMatchObject({ kind: 'overloaded' });
    expect(calls).toBe(2);
  });

  it('gives up on a reply carrying more audio than the cap', async () => {
    const fetch = (async () =>
      new Response(sse([JSON.stringify({ type: 'chunk', data: Buffer.from([0, 0, 1, 1]).toString('base64') })]), {
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof globalThis.fetch;
    const client = new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true, maxAudioBytes: 2, fetch });
    await expect(client.speak({ text: 'Hi' })).rejects.toMatchObject({ name: 'TtsError', kind: 'protocol' });
  });

  it('gives up on a reply stamping more words than the cap', async () => {
    const fetch = (async () =>
      new Response(sse([JSON.stringify({ type: 'timestamps', word_timestamps: { words: ['one', 'two', 'three'], start: [0, 0.4, 0.8], end: [0.3, 0.7, 1.1] } })]), {
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof globalThis.fetch;
    const client = new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true, maxWords: 2, fetch });
    await expect(client.speak({ text: 'Hi' })).rejects.toMatchObject({ name: 'TtsError', kind: 'protocol' });
  });

  it('gives up on an event that never completes within the parse cap', async () => {
    const fetch = (async () =>
      new Response(sse([JSON.stringify({ type: 'chunk', data: Buffer.from([0, 0]).toString('base64') })]), {
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof globalThis.fetch;
    const client = new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true, maxEventBytes: 10, fetch });
    await expect(client.speak({ text: 'Hi' })).rejects.toMatchObject({ name: 'TtsError', kind: 'protocol' });
  });

  it('ends a call past its total timeout even as audio keeps arriving', async () => {
    const fetch = (async () =>
      new Response(sse([JSON.stringify({ type: 'chunk', data: Buffer.from([0, 0]).toString('base64') })]), {
        headers: { 'content-type': 'text/event-stream' },
      })) as typeof globalThis.fetch;
    const client = new CartesiaClient({ apiKey: 'key', voice: 'voice-id', retentionAccepted: true, totalTimeoutMs: 0, fetch });
    await expect(client.speak({ text: 'Hi' })).rejects.toMatchObject({ name: 'TtsError', kind: 'timeout' });
  });

  it('maps HTTP failures onto the error taxonomy', async () => {
    expect((await cartesiaHttpError(new Response('{}', { status: 401 }))).kind).toBe('auth');
    expect((await cartesiaHttpError(new Response('{}', { status: 429 }))).kind).toBe('rate-limited');
    expect((await cartesiaHttpError(new Response('{}', { status: 503 }))).kind).toBe('overloaded');
    expect((await cartesiaHttpError(new Response('{}', { status: 500 }))).kind).toBe('server');
    expect((await cartesiaHttpError(new Response('{}', { status: 400 }))).kind).toBe('invalid-request');
    const error = new TtsError('rate-limited', 'slow down');
    expect(error.retryable).toBe(true);
    expect(new TtsError('auth', 'no').retryable).toBe(false);
  });
});

describe('tts: Cartesia voice default', () => {
  const voiceOf = (requested: string | null, env: NodeJS.ProcessEnv): [string | null, 'entered' | 'env' | 'none'] => {
    const resolved = resolveCartesiaVoice(requested, env);
    return [resolved.voice, resolved.source];
  };

  it('reads the default voice from CARTESIA_VOICE_ID, unset or empty meaning none', () => {
    expect(cartesiaVoiceFromEnv({ CARTESIA_VOICE_ID: 'voice-id' } as NodeJS.ProcessEnv)).toBe('voice-id');
    expect(cartesiaVoiceFromEnv({} as NodeJS.ProcessEnv)).toBe(null);
    expect(cartesiaVoiceFromEnv({ CARTESIA_VOICE_ID: '' } as NodeJS.ProcessEnv)).toBe(null);
    expect(cartesiaVoiceFromEnv({ CARTESIA_VOICE_ID: '   ' } as NodeJS.ProcessEnv)).toBe(null);
  });

  it('reads the process default voice, restored afterwards', () => {
    const before = process.env.CARTESIA_VOICE_ID;
    try {
      delete process.env.CARTESIA_VOICE_ID;
      expect(cartesiaVoiceFromEnv()).toBe(null);
      process.env.CARTESIA_VOICE_ID = 'env-voice';
      expect(cartesiaVoiceFromEnv()).toBe('env-voice');
    } finally {
      if (before === undefined) delete process.env.CARTESIA_VOICE_ID;
      else process.env.CARTESIA_VOICE_ID = before;
    }
  });

  it('lets an entered voice win over the server default', () => {
    const env = { CARTESIA_VOICE_ID: 'env-voice' } as NodeJS.ProcessEnv;
    expect(resolveCartesiaVoice('entered-voice', env)).toEqual({ voice: 'entered-voice', source: 'entered' });
    expect(resolveCartesiaVoice('  entered-voice  ', env)).toEqual({ voice: 'entered-voice', source: 'entered' });
  });

  it('falls back to the server default on an empty field, and to none without it', () => {
    const env = { CARTESIA_VOICE_ID: 'env-voice' } as NodeJS.ProcessEnv;
    expect(resolveCartesiaVoice(null, env)).toEqual({ voice: 'env-voice', source: 'env' });
    expect(resolveCartesiaVoice('', env)).toEqual({ voice: 'env-voice', source: 'env' });
    expect(resolveCartesiaVoice('   ', env)).toEqual({ voice: 'env-voice', source: 'env' });
    expect(resolveCartesiaVoice(undefined, env)).toEqual({ voice: 'env-voice', source: 'env' });
    expect(resolveCartesiaVoice(null, {} as NodeJS.ProcessEnv)).toEqual({ voice: null, source: 'none' });
    expect(resolveCartesiaVoice(null, { CARTESIA_VOICE_ID: '' } as NodeJS.ProcessEnv)).toEqual({ voice: null, source: 'none' });
  });

  it('reports none, partial and full connection states from the two sources', () => {
    const none = { CARTESIA_VOICE_ID: undefined } as unknown as NodeJS.ProcessEnv;
    const voiced = { CARTESIA_VOICE_ID: 'env-voice' } as NodeJS.ProcessEnv;
    // Neither side: nothing to narrate with.
    expect(cartesiaConnection('none', ...voiceOf(null, none))).toEqual({ keySource: 'none', voiceSource: 'none', voiceTail: null, connected: false });
    // One side only: partial, still not connected.
    expect(cartesiaConnection('.env', ...voiceOf(null, none)).connected).toBe(false);
    expect(cartesiaConnection('none', ...voiceOf(null, voiced))).toEqual({ keySource: 'none', voiceSource: 'env', voiceTail: 'oice', connected: false });
    // Both sides, from either origin: connected, with only the voice tail shown.
    expect(cartesiaConnection('.env', ...voiceOf(null, voiced))).toEqual({ keySource: '.env', voiceSource: 'env', voiceTail: 'oice', connected: true });
    expect(cartesiaConnection('entered', ...voiceOf('entered-voice', none))).toEqual({
      keySource: 'entered',
      voiceSource: 'entered',
      voiceTail: 'oice',
      connected: true,
    });
  });

  it('shows only the last four characters of a voice id', () => {
    expect(voiceTail('voice-abcdef')).toBe('cdef');
    expect(voiceTail('abc')).toBe('abc');
    expect(voiceTail(null)).toBe(null);
    expect(voiceTail(undefined)).toBe(null);
  });
});

describe('tts: key check', () => {
  it('says so when there is no key', async () => {
    expect(await checkCartesiaKey('')).toMatchObject({ ok: false });
  });

  it('lists one voice to check the key', async () => {
    const fetch = (async (input: string) => {
      expect(input).toBe('https://api.cartesia.ai/voices?limit=1');
      return new Response(JSON.stringify({ data: [{ id: 'voice-id', name: 'Narrator' }] }));
    }) as typeof globalThis.fetch;
    const checked = await checkCartesiaKey('key', { fetch });
    expect(checked.ok).toBe(true);
    expect(checked.voices).toEqual(['voice-id']);
  });

  it('reports a rejected key', async () => {
    const fetch = (async () => new Response('{}', { status: 401, statusText: 'Unauthorized' })) as typeof globalThis.fetch;
    expect(await checkCartesiaKey('bad', { fetch })).toMatchObject({ ok: false });
  });
});
