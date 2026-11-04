/**
 * Text to speech for film narration. The pipeline talks to a `Narrator`; the
 * Cartesia client streams from the TTS SSE endpoint with word timestamps, and
 * the stub narrator stands in for it in every test and E2E run with
 * deterministic silent audio and timings derived from the text.
 *
 * Spike verdict (November 2026, docs.cartesia.ai): ACCEPT the SSE interface.
 * Word timestamps come from `add_timestamps` as `timestamps` events carrying
 * word_timestamps { words, start, end } in seconds
 * (api-reference/tts/sse); the same flag exists on the WebSocket
 * (api-reference/tts/websocket). Voices list at GET /voices
 * (api-reference/voices/list) and are passed as an id string or { id }.
 * Auth is `Authorization: Bearer` with a `Cartesia-Version` date header
 * (use-the-api/api-conventions); a failed request consumes no credits and a
 * stream is cancelled by aborting it (pricing.md). TTS costs ~1 credit per
 * character on every endpoint (pricing.md); plans run Free $0/20K credits,
 * Pro $5/100K, Startup $49/1.25M, Scale $299/8M (cartesia.ai/pricing), so a
 * character costs roughly $37-50 per million.
 *
 * Data retention is the open vendor decision, and real Cartesia calls stay
 * fail-closed behind it: only Enterprise Zero Data Retention is documented to
 * keep no TTS text or audio (enterprise/zero-data-retention), the docs state
 * no default retention period for other plans, and metadata is retained even
 * under ZDR. Until the operator confirms retention terms, the Cartesia client
 * refuses to construct unless retention is explicitly accepted
 * (CARTESIA_RETENTION_ACCEPTED=1, see cartesiaRetentionAccepted) and the stub
 * narrates everything. The key check needs no acceptance: it lists one voice
 * and sends no learner text.
 */

import { createHash } from 'node:crypto';

/** Words per second the stub and the estimates assume. Matches the film compiler's FILM_WORDS_PER_SECOND. */
export const NARRATION_WORDS_PER_SECOND = 2.5;

/** Sample rate of the stub's silent audio: mono 16-bit PCM, small enough to hold a film in memory. */
export const STUB_SAMPLE_RATE = 8000;

export type TtsErrorKind =
  | 'timeout'
  | 'aborted'
  | 'overloaded'
  | 'rate-limited'
  | 'auth'
  | 'invalid-request'
  | 'server'
  | 'network'
  | 'protocol'
  | 'missing-key'
  | 'retention-not-accepted';

export class TtsError extends Error {
  constructor(
    readonly kind: TtsErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TtsError';
  }

  /** Worth one more try: the provider was busy, or the connection dropped. */
  get retryable(): boolean {
    return this.kind === 'overloaded' || this.kind === 'rate-limited' || this.kind === 'server' || this.kind === 'network';
  }
}

/** One word's timing in seconds from the start of the audio. */
export interface WordTiming {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

export interface SpeakRequest {
  readonly text: string;
  /** Voice id. Defaults to the client's voice. */
  readonly voice?: string;
  readonly signal?: AbortSignal;
  /** Audio bytes as they stream in. */
  readonly onAudio?: (chunk: Uint8Array) => void;
}

export interface SpeakReply {
  /** Mono 16-bit PCM at sampleRate. */
  readonly audio: Uint8Array;
  readonly sampleRate: number;
  readonly words: readonly WordTiming[];
  /** Characters billed: the transcript's length. */
  readonly chars: number;
  readonly ms: number;
  /** Milliseconds from the request to the first audio: the provider's wait, apart from its speaking. */
  readonly firstAudioMs?: number;
  readonly model: string;
}

export interface Narrator {
  readonly name: string;
  speak(request: SpeakRequest): Promise<SpeakReply>;
}

export function countSpeechWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '').length;
}

export function splitSpeechWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '');
}

/**
 * Word timings derived from text alone: words evenly spaced at 2.5 per
 * second, each sounding for nine tenths of its slot. The stub speaks these,
 * and failed or invalid provider timings fall back to them, so captions
 * always have something within a frame of the truth.
 */
export function estimateWordTimings(text: string, wps: number = NARRATION_WORDS_PER_SECOND): WordTiming[] {
  const words = splitSpeechWords(text);
  const slot = 1 / wps;
  return words.map((word, i) => ({ word, start: i * slot, end: i * slot + slot * 0.9 }));
}

/** Seconds of audio the timings imply: the last word's end, or 0 for silence. */
export function timingsSeconds(words: readonly WordTiming[]): number {
  return words.length === 0 ? 0 : words[words.length - 1]!.end;
}

/**
 * Validates provider word timings before they drive anything: starts
 * monotonic, every end at or after its start, everything inside the audio.
 * Word counts may legitimately differ after the provider's normalization, so
 * a mismatch is not a failure.
 */
export function validateWordTimings(words: readonly WordTiming[], audioSeconds: number): { readonly ok: boolean; readonly problems: readonly string[] } {
  const problems: string[] = [];
  if (!Number.isFinite(audioSeconds) || audioSeconds < 0) problems.push('The audio length is not a number of seconds');
  let lastStart = -Infinity;
  words.forEach((timing, i) => {
    if (!Number.isFinite(timing.start) || !Number.isFinite(timing.end)) {
      problems.push(`Word ${i + 1} ("${timing.word}") has no timing`);
      return;
    }
    if (timing.start < -1e-6) problems.push(`Word ${i + 1} ("${timing.word}") starts before the audio`);
    if (timing.start + 1e-9 < lastStart) problems.push(`Word ${i + 1} ("${timing.word}") starts before the word ahead of it`);
    lastStart = Math.max(lastStart, timing.start);
    if (timing.end + 1e-9 < timing.start) problems.push(`Word ${i + 1} ("${timing.word}") ends before it starts`);
    if (timing.end - 1e-6 > audioSeconds) problems.push(`Word ${i + 1} ("${timing.word}") ends past the audio`);
  });
  return { ok: problems.length === 0, problems };
}

/** SHA-256 over bytes or text, hex: a content hash for the audio store and the text cache, like the gallery and ticket ids. */
export function contentHash(content: Uint8Array | string): string {
  return createHash('sha256')
    .update(content)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/** Cartesia TTS credits per character (pricing.md: ~1 on every endpoint). */
export const SPEECH_CREDITS_PER_CHAR = 1;

/**
 * US dollars per million speech characters, estimated from the list plans
 * (cartesia.ai/pricing, November 2026): Pro $5 for 100K credits is $50/M,
 * Startup and Scale work out cheaper per credit. Override it when prices
 * change; the bench reports through speechCostUsd so one number moves all of it.
 */
export const CARTESIA_USD_PER_MILLION_CHARS = 50;

/** What narration cost in US dollars. The stub costs nothing. */
export function speechCostUsd(chars: number, usdPerMillionChars: number = CARTESIA_USD_PER_MILLION_CHARS): number {
  return (Math.max(0, chars) * usdPerMillionChars) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Cartesia
// ---------------------------------------------------------------------------

/** API version header, the date the integration was tested (api-conventions). */
export const CARTESIA_API_VERSION = '2026-08-14';

export const DEFAULT_CARTESIA_MODEL = 'sonic-3.6';

/** Sample rate requested from Cartesia: mono 16-bit PCM. */
export const CARTESIA_SAMPLE_RATE = 24000;

/** Most audio one reply may carry: 24 MB of mono 16-bit PCM at 24 kHz is over eight minutes of speech. */
export const CARTESIA_MAX_AUDIO_BYTES = 24 * 1024 * 1024;

/** Most words one reply may stamp. */
export const CARTESIA_MAX_WORDS = 10_000;

/** Most bytes one SSE event may span before the parse buffer gives up. */
export const CARTESIA_MAX_EVENT_BYTES = 1024 * 1024;

/** Longest one speak call may run, however steadily audio arrives. */
export const CARTESIA_TOTAL_TIMEOUT_MS = 300_000;

export interface CartesiaOptions {
  /** From CARTESIA_API_KEY only (cartesiaKeyFromEnv); empty is a missing-key error, never a silent default. */
  readonly apiKey: string;
  /** Voice id from the Voice Library or List Voices; required, since voices are per-account. */
  readonly voice: string;
  readonly model?: string;
  readonly baseUrl?: string;
  /** Per silent gap: each stream read resets it, so only a quiet stream gets cut. The total timeout still bounds the call. */
  readonly timeoutMs?: number;
  /** Longest one speak call may run, however steadily audio arrives. Default CARTESIA_TOTAL_TIMEOUT_MS. */
  readonly totalTimeoutMs?: number;
  /** Most audio bytes one reply may carry. Default CARTESIA_MAX_AUDIO_BYTES. */
  readonly maxAudioBytes?: number;
  /** Most words one reply may stamp. Default CARTESIA_MAX_WORDS. */
  readonly maxWords?: number;
  /** Most bytes one SSE event may span. Default CARTESIA_MAX_EVENT_BYTES. */
  readonly maxEventBytes?: number;
  /** Tries after a busy or dropped response that streamed no audio yet. Default 1; larger values clamp to 1: at most one retry, never in a loop. */
  readonly retries?: number;
  /**
   * Retention acceptance for real TTS calls. Defaults to cartesiaRetentionAccepted():
   * fail-closed unless the operator sets CARTESIA_RETENTION_ACCEPTED=1. Tests pass true.
   */
  readonly retentionAccepted?: boolean;
  readonly fetch?: typeof fetch;
}

/** The Cartesia key from the environment, and only there. */
export function cartesiaKeyFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.CARTESIA_API_KEY;
  return key && key.trim() !== '' ? key : null;
}

/**
 * Whether the operator accepts Cartesia's data retention for real TTS calls.
 * Fail-closed: only CARTESIA_RETENTION_ACCEPTED=1 accepts. The vendor decision
 * stays open (see the header): the default retention period is unstated, ZDR
 * is Enterprise-only opt-in, and metadata is retained even under ZDR.
 */
export function cartesiaRetentionAccepted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CARTESIA_RETENTION_ACCEPTED === '1';
}

interface CartesiaStreamState {
  chunks: Uint8Array[];
  bytes: number;
  words: WordTiming[];
  done: boolean;
}

/**
 * Applies one SSE frame's JSON to the stream state. Chunk events carry
 * base64 audio, timestamps events carry word_timestamps { words, start, end },
 * done ends the stream, error fails it.
 */
export function applyCartesiaSseEvent(data: string, state: CartesiaStreamState): Uint8Array | null {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(data) as Record<string, unknown>;
  } catch {
    throw new TtsError('protocol', 'Cartesia sent an unreadable event');
  }
  switch (event.type) {
    case 'chunk': {
      if (typeof event.data !== 'string') throw new TtsError('protocol', 'Cartesia sent audio without data');
      const binary = atob(event.data);
      const chunk = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) chunk[i] = binary.charCodeAt(i);
      state.chunks.push(chunk);
      state.bytes += chunk.length;
      return chunk;
    }
    case 'timestamps': {
      const stamped = event.word_timestamps as { words?: unknown; start?: unknown; end?: unknown } | undefined;
      if (!Array.isArray(stamped?.words) || !Array.isArray(stamped?.start) || !Array.isArray(stamped?.end)) {
        throw new TtsError('protocol', 'Cartesia sent timestamps without words');
      }
      if (stamped.words.length !== stamped.start.length || stamped.words.length !== stamped.end.length) {
        throw new TtsError('protocol', 'Cartesia sent timestamps of different lengths');
      }
      const starts = stamped.start as unknown[];
      const ends = stamped.end as unknown[];
      stamped.words.forEach((word, i) => {
        state.words.push({ word: String(word), start: Number(starts[i]), end: Number(ends[i]) });
      });
      return null;
    }
    case 'phoneme_timestamps':
      return null;
    case 'done':
      state.done = true;
      return null;
    case 'error': {
      const message = typeof event.message === 'string' ? event.message : 'Cartesia reported an error';
      throw new TtsError('server', message);
    }
    default:
      return null;
  }
}

export class CartesiaClient implements Narrator {
  readonly name = 'cartesia';
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: CartesiaOptions) {
    if (!options.apiKey) throw new TtsError('missing-key', 'Set CARTESIA_API_KEY to narrate with Cartesia; without it films generate silent with estimated lengths.');
    if (!options.voice) throw new TtsError('invalid-request', 'A Cartesia voice id is required');
    // Fail-closed on the open retention decision: no real calls until the operator accepts the vendor's terms.
    if (!(options.retentionAccepted ?? cartesiaRetentionAccepted())) {
      throw new TtsError('retention-not-accepted', 'Set CARTESIA_RETENTION_ACCEPTED=1 to narrate with Cartesia; without it films generate silent with estimated lengths.');
    }
    this.fetcher = options.fetch ?? fetch;
  }

  model(): string {
    return this.options.model ?? DEFAULT_CARTESIA_MODEL;
  }

  /** The request body for a speak call: the whole transcript, one voice, raw PCM with word timestamps. */
  body(text: string, voice: string): Record<string, unknown> {
    return {
      model_id: this.model(),
      transcript: text,
      voice: { id: voice },
      output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: CARTESIA_SAMPLE_RATE },
      language: 'en',
      add_timestamps: true,
    };
  }

  async speak(request: SpeakRequest): Promise<SpeakReply> {
    const attempts = 1 + Math.max(0, Math.min(1, this.options.retries ?? 1));
    let last: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      let streamed = false;
      try {
        return await this.once(request, () => (streamed = true));
      } catch (error) {
        last = error;
        if (!(error instanceof TtsError) || !error.retryable || streamed || attempt === attempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
      }
    }
    throw last;
  }

  private async once(request: SpeakRequest, onFirstAudio: () => void): Promise<SpeakReply> {
    const started = Date.now();
    const timeoutMs = this.options.timeoutMs ?? 60_000;
    const totalTimeoutMs = this.options.totalTimeoutMs ?? CARTESIA_TOTAL_TIMEOUT_MS;
    const maxAudioBytes = this.options.maxAudioBytes ?? CARTESIA_MAX_AUDIO_BYTES;
    const maxWords = this.options.maxWords ?? CARTESIA_MAX_WORDS;
    const maxEventBytes = this.options.maxEventBytes ?? CARTESIA_MAX_EVENT_BYTES;
    const timeout = new AbortController();
    let gap = setTimeout(() => timeout.abort(), timeoutMs);
    const reopenGap = (): void => {
      clearTimeout(gap);
      gap = setTimeout(() => timeout.abort(), timeoutMs);
    };
    const signal = request.signal ? AbortSignal.any([request.signal, timeout.signal]) : timeout.signal;
    const abortError = () =>
      timeout.signal.aborted ? new TtsError('timeout', `Cartesia went silent for over ${timeoutMs} ms`) : new TtsError('aborted', 'The narration was cancelled');
    let response: Response;
    try {
      response = await this.fetcher(`${this.options.baseUrl ?? 'https://api.cartesia.ai'}/tts/sse`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
          'cartesia-version': CARTESIA_API_VERSION,
        },
        body: JSON.stringify(this.body(request.text, request.voice ?? this.options.voice)),
        signal,
      });
    } catch (error) {
      clearTimeout(gap);
      if (signal.aborted) throw abortError();
      throw new TtsError('network', `Cartesia could not be reached: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
      clearTimeout(gap);
      throw await cartesiaHttpError(response);
    }
    if (!response.body) {
      clearTimeout(gap);
      throw new TtsError('protocol', 'Cartesia sent no body');
    }
    const state: CartesiaStreamState = { chunks: [], bytes: 0, words: [], done: false };
    let firstAudioMs: number | undefined;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const take = (event: string): void => {
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trimStart();
        if (!data) continue;
        const chunk = applyCartesiaSseEvent(data, state);
        if (state.bytes > maxAudioBytes) throw new TtsError('protocol', `Cartesia sent more than ${maxAudioBytes} audio bytes`);
        if (state.words.length > maxWords) throw new TtsError('protocol', `Cartesia stamped more than ${maxWords} words`);
        if (chunk) {
          if (firstAudioMs === undefined) {
            firstAudioMs = Date.now() - started;
            onFirstAudio();
          }
          request.onAudio?.(chunk);
        }
      }
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        reopenGap();
        // The gap only bounds silence: a stream that keeps arriving still ends here.
        if (Date.now() - started >= totalTimeoutMs) throw new TtsError('timeout', `Cartesia took over ${totalTimeoutMs} ms`);
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
        if (buffer.length > maxEventBytes) throw new TtsError('protocol', `Cartesia sent an event spanning over ${maxEventBytes} bytes`);
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          take(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (signal.aborted) throw abortError();
      if (error instanceof TtsError) throw error;
      throw new TtsError('network', `The stream broke off: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      reader.releaseLock();
      clearTimeout(gap);
    }
    if (buffer.trim()) take(buffer);
    const audio = new Uint8Array(state.bytes);
    let at = 0;
    for (const chunk of state.chunks) {
      audio.set(chunk, at);
      at += chunk.length;
    }
    return {
      audio,
      sampleRate: CARTESIA_SAMPLE_RATE,
      words: state.words,
      chars: request.text.length,
      ms: Date.now() - started,
      model: this.model(),
      ...(firstAudioMs !== undefined ? { firstAudioMs } : {}),
    };
  }
}

/** A Cartesia failed response as a TtsError: structured errors carry error_code, title and message. */
export async function cartesiaHttpError(response: Response): Promise<TtsError> {
  let detail = '';
  try {
    const payload = (await response.json()) as { message?: unknown; title?: unknown; error?: { message?: unknown } };
    const message = payload.message ?? payload.title ?? payload.error?.message;
    detail = typeof message === 'string' ? message : '';
  } catch {
    // Not JSON.
  }
  const status = response.status;
  const message = `Cartesia returned ${status}${detail ? `: ${detail}` : ''}`;
  if (status === 401 || status === 403) return new TtsError('auth', message, status);
  if (status === 429) return new TtsError('rate-limited', message, status);
  if (status === 503) return new TtsError('overloaded', message, status);
  if (status >= 500) return new TtsError('server', message, status);
  return new TtsError('invalid-request', message, status);
}

/**
 * The cheap boot key-check, in the spirit of the Gemini list-models check:
 * one page of one voice. Voices (rather than a synthesis) so the check costs
 * nothing and touches no learner text, which is why the retention gate does
 * not apply to it.
 */
export async function checkCartesiaKey(apiKey: string, options: { readonly fetch?: typeof fetch; readonly baseUrl?: string } = {}): Promise<{
  readonly ok: boolean;
  readonly message: string;
  readonly voices?: readonly string[];
}> {
  if (!apiKey || apiKey.trim() === '') return { ok: false, message: 'No key to check: paste a Cartesia key or set CARTESIA_API_KEY on the server.' };
  try {
    const answer = await (options.fetch ?? fetch)(`${options.baseUrl ?? 'https://api.cartesia.ai'}/voices?limit=1`, {
      headers: { authorization: `Bearer ${apiKey.trim()}`, 'cartesia-version': CARTESIA_API_VERSION },
      signal: AbortSignal.timeout(15_000),
    });
    if (!answer.ok) return { ok: false, message: `Cartesia answered ${answer.status} (${answer.statusText || 'request failed'}) for that key.` };
    const payload = (await answer.json()) as { data?: Array<{ id?: unknown; name?: unknown }> };
    const voices = (payload.data ?? []).map((voice) => String(voice.id ?? voice.name ?? '')).filter((id) => id !== '');
    return { ok: true, message: `Key works: the voice library answers.`, voices };
  } catch (error) {
    return { ok: false, message: `Could not reach Cartesia: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

/**
 * The stub narrator: deterministic silent audio with word timings derived
 * from the text. The default for every test and E2E run: no key, no network,
 * no cost, and the same bytes for the same text every time.
 */
export class StubNarrator implements Narrator {
  readonly name = 'stub';

  async speak(request: SpeakRequest): Promise<SpeakReply> {
    const started = Date.now();
    const words = estimateWordTimings(request.text);
    const seconds = timingsSeconds(words);
    const samples = Math.round(seconds * STUB_SAMPLE_RATE);
    const audio = new Uint8Array(samples * 2);
    if (request.onAudio && audio.length > 0 && words.length > 0) {
      // One chunk per word, as a stream would arrive: fan-out reads narration as it comes.
      for (let i = 0; i < words.length; i++) {
        request.onAudio(audio.slice(Math.floor((audio.length * i) / words.length), Math.floor((audio.length * (i + 1)) / words.length)));
      }
    }
    return { audio, sampleRate: STUB_SAMPLE_RATE, words, chars: request.text.length, ms: Date.now() - started, model: 'stub-silent' };
  }
}
