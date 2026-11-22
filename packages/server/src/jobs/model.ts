/**
 * What every model job shares (docs/features/server/design.md 7): the signal that carries the turn limit, and the client
 * that counts each model call against the day.
 */
import type { ChatEvent, ChatRequest, ModelClient } from '@incantly/teacher';
import { toStreamError } from '../errors';
import type { RateLimiter } from '../limits/rate';

/** The whole turn, in milliseconds (design 7). */
export const TURN_MS = 60_000;

/**
 * The job's signal (TR-6): aborted when the client closes, when a newer request of the same client arrives, or when the
 * turn passes `TURN_MS` (with a `TimeoutError` reason, so the turn ends as `turn_limit`, not as a stop). It holds even
 * while a model sends nothing, since the loop races every wait for the model against it.
 */
export function jobSignal(clientClosed: AbortSignal, superseded: AbortSignal, turnMs: number = TURN_MS): AbortSignal {
  return AbortSignal.any([clientClosed, superseded, AbortSignal.timeout(turnMs)]);
}

/** A client that takes one model call from the day's budget before each call; at the limit the call is a `daily_budget` error. */
export function meteredClient(client: ModelClient, limiter: RateLimiter): ModelClient {
  return {
    async *chat(request: ChatRequest, signal: AbortSignal): AsyncGenerator<ChatEvent> {
      const taken = limiter.takeModelCall();
      if (!taken.ok) {
        yield { error: toStreamError(taken) };
        return;
      }
      yield* client.chat(request, signal);
    },
  };
}
