/**
 * OpenRouter's speech models (docs/features/server/design.md 6, teacher design 8; R7.5): `POST /api/v1/audio/speech` with a
 * sentence, answered with audio. The voices are tried in order like the chat models: a voice passes the call on at HTTP 429,
 * 5xx, another failure, a network error or no first byte within 15 s; a voice that gave 429 is skipped for 60 s; all busy is
 * `model_busy` with `retryAfterMs`. One call is one field over `CALL_MACHINE` (docs/state-machines.md SV3, the table of SV2).
 *
 * `speak` resolves once the first byte of audio is in hand, so the route can still answer with an HTTP error when no voice
 * works (nothing was sent yet). The rest of the audio is a generator the route copies to the client as it comes.
 * The key goes only in the `Authorization` header; a provider's own text never leaves in an error.
 */
import { StateMachine } from '@incantly/kernel';
import { fromStreamError, serverError } from '../errors';
import type { ServerError } from '../errors';
import { CALL_MACHINE, FIRST_BYTE_MS, SKIP_MS, exhausted } from './fallback';
import type { CallMove, CallState, Pass } from './fallback';
import { OPENROUTER_REFERER, OPENROUTER_TITLE, OPENROUTER_URL } from './openrouter';

export interface SpeechRequest {
  /** One sentence, at most 500 characters. */
  readonly text: string;
  /** How to say it (a voice model that takes delivery instructions uses them; the others ignore them). */
  readonly instructions?: string;
}

/** The sample rate of PCM audio when the provider does not say (teacher design 8). */
export const DEFAULT_SAMPLE_RATE = 24_000;

export type AudioFormat = 'audio/mpeg' | 'audio/pcm';

export interface SpeechAudio {
  readonly ok: true;
  readonly contentType: AudioFormat;
  /** Samples a second, for PCM; undefined for MP3. */
  readonly sampleRate?: number;
  /** The voice that answered. */
  readonly model: string;
  /** The first bytes, already read. */
  readonly first: Uint8Array;
  /** The rest of the audio as it comes. Returns `'end'` when the provider ended it, `'cut'` when it broke or the call was aborted. Never throws. */
  readonly rest: AsyncGenerator<Uint8Array, 'end' | 'cut'>;
}

export interface SpeechClient {
  /** The audio, or the error to answer with (`model_busy`, `model_timeout`, `model_unavailable`). Never throws. */
  speak(request: SpeechRequest, signal: AbortSignal): Promise<SpeechAudio | ServerError>;
}

export interface OpenRouterSpeechOptions {
  /** The key, read when a request starts. */
  readonly apiKey: () => string | undefined;
  /** Free voice-model ids, tried in order. */
  readonly models: readonly string[];
  /** The voice to name for models that need one (HeyGen). */
  readonly voice: string;
  /** The network. Default: the global `fetch`. Tests pass their own. */
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  /** The clock in milliseconds, for the 60 s skip. Default `Date.now`. */
  readonly now?: () => number;
  readonly firstByteMs?: number;
  readonly skipMs?: number;
  /** Hears a refused move of a call's machine (a bug). Default: nobody. */
  readonly onFault?: (from: string, event: string) => void;
}

/** HeyGen's voice models answer PCM only and need a voice named; the others answer MP3. */
const isPcm = (model: string): boolean => model.startsWith('heygen/');

const TIMED_OUT: unique symbol = Symbol('timed out');
const STOPPED: unique symbol = Symbol('stopped');

/** A voice that answered: its first bytes and the reader of the rest. */
interface Opened {
  readonly format: AudioFormat;
  readonly sampleRate?: number;
  readonly first: Uint8Array;
  readonly reader: ReadableStreamDefaultReader<Uint8Array>;
}

/** The sample rate the provider names in `x-sample-rate` or in the content type (`rate=`), else the default. */
function sampleRateOf(res: Response): number {
  const header = Number(res.headers.get('x-sample-rate'));
  if (Number.isInteger(header) && header >= 8000 && header <= 192_000) return header;
  const m = /rate=(\d+)/i.exec(res.headers.get('content-type') ?? '');
  const fromType = m === null ? 0 : Number(m[1]);
  return fromType >= 8000 && fromType <= 192_000 ? fromType : DEFAULT_SAMPLE_RATE;
}

export class OpenRouterSpeech implements SpeechClient {
  /** Voice id to the time its 429 skip ends. */
  private readonly skipUntil = new Map<string, number>();
  private readonly now: () => number;
  private readonly firstByteMs: number;
  private readonly skipMs: number;
  private readonly base: string;

  constructor(private readonly options: OpenRouterSpeechOptions) {
    this.now = options.now ?? Date.now;
    this.firstByteMs = options.firstByteMs ?? FIRST_BYTE_MS;
    this.skipMs = options.skipMs ?? SKIP_MS;
    this.base = (options.baseUrl ?? OPENROUTER_URL).replace(/\/+$/, '');
  }

  /** Milliseconds until `model` may be tried again after a 429, or 0. */
  skipLeft(model: string): number {
    const until = this.skipUntil.get(model);
    return until === undefined ? 0 : Math.max(0, until - this.now());
  }

  async speak(request: SpeechRequest, signal: AbortSignal): Promise<SpeechAudio | ServerError> {
    const machine = new StateMachine(CALL_MACHINE, 'trying', (from, event) => this.options.onFault?.(from, event));
    const passes: Pass[] = [];
    const stopped = new Promise<typeof STOPPED>((resolve) => {
      if (signal.aborted) resolve(STOPPED);
      else signal.addEventListener('abort', () => resolve(STOPPED), { once: true });
    });
    for (const model of this.options.models) {
      if (signal.aborted) {
        machine.send('abort');
        return serverError('model_unavailable', 'The voice was stopped.');
      }
      const left = this.skipLeft(model);
      if (left > 0) {
        passes.push({ why: 'busy', retryAfterMs: left });
        machine.send('passOn');
        continue;
      }
      const attempt = new AbortController();
      let keep = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const late = new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), this.firstByteMs);
        });
        const work = this.open(model, request, AbortSignal.any([signal, attempt.signal]));
        work.catch(() => undefined);
        const got = await Promise.race([work, late, stopped]);
        if (got === STOPPED || signal.aborted) {
          machine.send('abort');
          return serverError('model_unavailable', 'The voice was stopped.');
        }
        if (got === TIMED_OUT) {
          passes.push({ why: 'timeout' });
          machine.send('passOn');
          continue;
        }
        if ('why' in got) {
          if (got.why === 'busy') this.skipUntil.set(model, this.now() + this.skipMs);
          passes.push(got);
          machine.send('passOn');
          continue;
        }
        // the first byte is in hand: this voice stays to the end
        machine.send('output');
        keep = true;
        return {
          ok: true,
          contentType: got.format,
          ...(got.sampleRate !== undefined ? { sampleRate: got.sampleRate } : {}),
          model,
          first: got.first,
          rest: this.copy(got.reader, machine, signal, attempt),
        };
      } finally {
        clearTimeout(timer);
        if (!keep) attempt.abort();
      }
    }
    machine.send('exhaust');
    return fromStreamError(exhausted(passes, this.skipMs));
  }

  /** Asks one voice for the sentence and reads its first bytes. A refusal or failure is a `Pass`, never a throw. */
  private async open(model: string, request: SpeechRequest, signal: AbortSignal): Promise<Opened | Pass> {
    const key = this.options.apiKey();
    if (key === undefined || key === '') return { why: 'failed' };
    const pcm = isPcm(model);
    const body = {
      model,
      input: request.text,
      response_format: pcm ? 'pcm' : 'mp3',
      ...(pcm ? { voice: this.options.voice } : {}),
      ...(!pcm && request.instructions !== undefined && request.instructions !== '' ? { instructions: request.instructions } : {}),
    };
    let res: Response;
    try {
      const send = this.options.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init));
      res = await send(`${this.base}/audio/speech`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
          accept: 'audio/*',
          'http-referer': OPENROUTER_REFERER,
          'x-title': OPENROUTER_TITLE,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      return { why: 'failed' };
    }
    if (!res.ok || res.body === null || /json|text/i.test(res.headers.get('content-type') ?? '')) {
      try {
        await res.body?.cancel();
      } catch {
        // the body was already closed
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('retry-after'));
        return { why: 'busy', retryAfterMs: Number.isFinite(wait) && wait > 0 ? Math.min(wait, 3600) * 1000 : this.skipMs };
      }
      return { why: 'failed' };
    }
    const reader = res.body.getReader();
    try {
      for (;;) {
        const step = await reader.read();
        if (step.done) return { why: 'failed' };
        if (step.value.length > 0) {
          return pcm ? { format: 'audio/pcm', sampleRate: sampleRateOf(res), first: step.value, reader } : { format: 'audio/mpeg', first: step.value, reader };
        }
      }
    } catch {
      try {
        await reader.cancel();
      } catch {
        // nothing to free
      }
      return { why: 'failed' };
    }
  }

  /** The audio after its first bytes, as the provider sends it. Ends the call's machine and frees the request. */
  private async *copy(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    machine: StateMachine<CallState, CallMove>,
    signal: AbortSignal,
    attempt: AbortController,
  ): AsyncGenerator<Uint8Array, 'end' | 'cut'> {
    try {
      for (;;) {
        const step = await reader.read();
        if (step.done) {
          if (machine.can('finish')) machine.send('finish');
          return 'end';
        }
        if (step.value.length > 0) yield step.value;
      }
    } catch {
      if (machine.can(signal.aborted ? 'abort' : 'fail')) machine.send(signal.aborted ? 'abort' : 'fail');
      return 'cut';
    } finally {
      // a consumer that stops early (the client left) ends here too
      if (machine.can('abort')) machine.send('abort');
      attempt.abort();
      try {
        await reader.cancel();
      } catch {
        // already closed
      }
    }
  }
}

/** The OpenRouter voices in order, for the settings' free speech models. */
export function openRouterSpeech(options: OpenRouterSpeechOptions): SpeechClient {
  return new OpenRouterSpeech(options);
}
