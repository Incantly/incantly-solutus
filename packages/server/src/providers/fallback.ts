/**
 * Models in order (docs/features/server/design.md 4, R3.2): a model passes the call to the next on HTTP 429, 5xx, another
 * failure, a network error, no first byte within 15 s, or an error before any output. A model that gave 429 is skipped
 * for 60 s. When every model is busy, the answer is `model_busy` with `retryAfterMs`. A model never changes once its
 * first event reached the caller. One call is one field over `CALL_MACHINE` (docs/state-machines.md SV2); the skip list
 * is data shared by every call.
 */
import { StateMachine } from '@incantly/kernel';
import type { MachineTable } from '@incantly/kernel';
import type { ChatEvent, ChatRequest, ModelClient, StreamError } from '@incantly/teacher';
import { modelBusy, modelTimeout, serverError, toStreamError } from '../errors';

/** Opens one model: its events, with an `error` event (never a throw) for a status or a network failure. */
export type ModelOpener = (model: string, request: ChatRequest, signal: AbortSignal) => AsyncIterable<ChatEvent>;

export const FIRST_BYTE_MS = 15_000;
export const SKIP_MS = 60_000;

export type CallState = 'trying' | 'streaming' | 'done' | 'failed' | 'stopped';
export type CallMove = 'passOn' | 'output' | 'finish' | 'exhaust' | 'fail' | 'abort';

/** docs/state-machines.md SV2. The last three states take no event. */
export const CALL_MACHINE: MachineTable<CallState, CallMove> = {
  trying: { passOn: 'trying', output: 'streaming', finish: 'done', exhaust: 'failed', abort: 'stopped' },
  streaming: { finish: 'done', fail: 'failed', abort: 'stopped' },
  done: {},
  failed: {},
  stopped: {},
};

export interface FallbackOptions {
  /** Free model ids for a request with no picture, tried in order. */
  readonly textModels: readonly string[];
  /** Free model ids for a request with a picture. */
  readonly visionModels: readonly string[];
  readonly open: ModelOpener;
  /** The clock in milliseconds, for the 60 s skip. Default `Date.now`. */
  readonly now?: () => number;
  readonly firstByteMs?: number;
  readonly skipMs?: number;
  /** Hears a refused move of a call's machine (a bug). Default: nobody. */
  readonly onFault?: (from: string, event: string) => void;
}

/** Why a model passed the call on. */
export type Pass = { readonly why: 'busy'; readonly retryAfterMs: number } | { readonly why: 'timeout' } | { readonly why: 'failed' };

const TIMED_OUT: unique symbol = Symbol('timed out');
const STOPPED: unique symbol = Symbol('stopped');

const retryAfterOf = (e: StreamError, fallback: number): number => {
  const ms = e.detail?.['retryAfterMs'];
  return typeof ms === 'number' && ms > 0 ? ms : fallback;
};

/** The error that ends a call no model answered. */
export function exhausted(passes: readonly Pass[], skipMs: number): StreamError {
  if (passes.length > 0 && passes.every((p) => p.why === 'busy')) {
    const waits = passes.map((p) => (p.why === 'busy' ? p.retryAfterMs : skipMs));
    return toStreamError(modelBusy(Math.min(...waits)));
  }
  if (passes.length > 0 && passes.every((p) => p.why === 'timeout')) return toStreamError(modelTimeout());
  return toStreamError(serverError('model_unavailable', 'The AI is not available right now.', { hint: 'Try again in a moment.' }));
}

export class FallbackClient implements ModelClient {
  /** Model id to the time its 429 skip ends. */
  private readonly skipUntil = new Map<string, number>();
  private readonly now: () => number;
  private readonly firstByteMs: number;
  private readonly skipMs: number;

  constructor(private readonly options: FallbackOptions) {
    this.now = options.now ?? Date.now;
    this.firstByteMs = options.firstByteMs ?? FIRST_BYTE_MS;
    this.skipMs = options.skipMs ?? SKIP_MS;
  }

  /** Milliseconds until `model` may be tried again after a 429, or 0. */
  skipLeft(model: string): number {
    const until = this.skipUntil.get(model);
    return until === undefined ? 0 : Math.max(0, until - this.now());
  }

  async *chat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
    const machine = new StateMachine(CALL_MACHINE, 'trying', (from, event) => this.options.onFault?.(from, event));
    const models = request.vision === true ? this.options.visionModels : this.options.textModels;
    const passes: Pass[] = [];
    const stopped = new Promise<typeof STOPPED>((resolve) => {
      if (signal.aborted) resolve(STOPPED);
      else signal.addEventListener('abort', () => resolve(STOPPED), { once: true });
    });
    for (const model of models) {
      if (signal.aborted) {
        machine.send('abort');
        return;
      }
      const left = this.skipLeft(model);
      if (left > 0) {
        passes.push({ why: 'busy', retryAfterMs: left });
        machine.send('passOn');
        continue;
      }
      const attempt = new AbortController();
      const it = this.options.open(model, request, AbortSignal.any([signal, attempt.signal]))[Symbol.asyncIterator]();
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const late = new Promise<typeof TIMED_OUT>((resolve) => {
          timer = setTimeout(() => resolve(TIMED_OUT), this.firstByteMs);
        });
        const pending = it.next();
        pending.catch(() => undefined);
        let first: IteratorResult<ChatEvent> | typeof TIMED_OUT | typeof STOPPED | undefined;
        try {
          first = await Promise.race([pending, late, stopped]);
        } catch {
          first = undefined;
        } finally {
          clearTimeout(timer);
        }
        if (first === STOPPED || signal.aborted) {
          machine.send('abort');
          return;
        }
        if (first === TIMED_OUT) {
          passes.push({ why: 'timeout' });
          machine.send('passOn');
          continue;
        }
        if (first === undefined || first.done === true) {
          passes.push({ why: 'failed' });
          machine.send('passOn');
          continue;
        }
        const event = first.value;
        if ('error' in event) {
          if (event.error.kind === 'model_busy') {
            const wait = retryAfterOf(event.error, this.skipMs);
            this.skipUntil.set(model, this.now() + this.skipMs);
            passes.push({ why: 'busy', retryAfterMs: wait });
          } else {
            passes.push({ why: event.error.kind === 'model_timeout' ? 'timeout' : 'failed' });
          }
          machine.send('passOn');
          continue;
        }
        // the first event reached the caller: this model stays to the end
        if ('done' in event) {
          machine.send('finish');
          yield event;
          return;
        }
        machine.send('output');
        yield event;
        for (;;) {
          const next = it.next();
          next.catch(() => undefined);
          let step: IteratorResult<ChatEvent> | typeof STOPPED;
          try {
            step = await Promise.race([next, stopped]);
          } catch {
            step = { done: true, value: undefined };
          }
          if (step === STOPPED || signal.aborted) {
            machine.send('abort');
            return;
          }
          if (step.done === true) {
            machine.send('fail');
            yield { error: { ok: false, kind: 'stream_cut', message: 'The answer stopped partway.' } };
            return;
          }
          if ('error' in step.value) {
            machine.send('fail');
            yield step.value;
            return;
          }
          if ('done' in step.value) {
            machine.send('finish');
            yield step.value;
            return;
          }
          yield step.value;
        }
      } finally {
        attempt.abort();
        void Promise.resolve(it.return?.()).catch(() => undefined);
      }
    }
    machine.send('exhaust');
    yield { error: exhausted(passes, this.skipMs) };
  }
}

/** A model client that tries `options.textModels` (or the vision list) in order through `options.open`. */
export function fallbackClient(options: FallbackOptions): FallbackClient {
  return new FallbackClient(options);
}
