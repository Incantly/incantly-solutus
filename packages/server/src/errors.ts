/**
 * The server's errors (docs/features/server/errors.md): the SDK shape `{ ok: false, kind, message, hint?, detail? }`.
 * Before a stream starts they are the JSON body of an HTTP error; after it starts they are the last event. Nothing in
 * an error holds a key, a request body or a provider's raw answer.
 */
import { createHash } from 'node:crypto';
import type { JsonLike, StreamError } from '@incantly/teacher';

export type ServerErrorKind =
  | 'config_invalid'
  | 'bad_request'
  | 'payload_too_large'
  | 'picture_invalid'
  | 'origin_blocked'
  | 'rate_limited'
  | 'daily_budget'
  | 'model_unavailable'
  | 'model_busy'
  | 'model_timeout'
  | 'model_bad_output'
  | 'not_found'
  | 'internal';

export interface ServerError {
  readonly ok: false;
  readonly kind: ServerErrorKind;
  readonly message: string;
  readonly hint?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** The HTTP status of each kind before a stream starts. `config_invalid` never reaches HTTP: the server does not start. */
export const STATUS: Readonly<Record<ServerErrorKind, number>> = {
  config_invalid: 500,
  bad_request: 400,
  payload_too_large: 413,
  picture_invalid: 400,
  origin_blocked: 403,
  rate_limited: 429,
  daily_budget: 429,
  model_unavailable: 503,
  model_busy: 503,
  model_timeout: 504,
  model_bad_output: 502,
  not_found: 404,
  internal: 500,
};

export interface ErrorExtra {
  readonly hint?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export function serverError(kind: ServerErrorKind, message: string, extra: ErrorExtra = {}): ServerError {
  return { ok: false, kind, message, ...(extra.hint !== undefined ? { hint: extra.hint } : {}), ...(extra.detail !== undefined ? { detail: extra.detail } : {}) };
}

export const isServerError = (x: unknown): x is ServerError =>
  typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false && typeof (x as { kind?: unknown }).kind === 'string' && Object.hasOwn(STATUS, (x as { kind: string }).kind);

/** Seconds a client waits, rounded up, for a retry-after header and a message. */
const seconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

export const rateLimited = (retryAfterMs: number): ServerError =>
  serverError('rate_limited', `Too many requests; try again in ${seconds(retryAfterMs)} s.`, { detail: { retryAfterMs } });

export const dailyBudget = (retryAfterMs: number): ServerError =>
  serverError('daily_budget', 'The AI has done its work for today.', { hint: 'It starts again at midnight UTC.', detail: { retryAfterMs } });

export const modelUnavailable = (): ServerError => serverError('model_unavailable', 'The AI is not set up.', { hint: 'Set the provider key in packages/server/.env.' });

export const modelBusy = (retryAfterMs: number): ServerError =>
  serverError('model_busy', `The AI is busy; try again in ${seconds(retryAfterMs)} s.`, { detail: { retryAfterMs } });

export const originBlocked = (): ServerError => serverError('origin_blocked', 'This site may not use the server.', { hint: 'Add its origin to ALLOWED_ORIGINS.' });

export const modelTimeout = (): ServerError => serverError('model_timeout', 'The AI took too long.', { hint: 'Try again.' });

export const modelBadOutput = (): ServerError => serverError('model_bad_output', 'The AI could not draw this.', { hint: 'Say it in other words.' });

/**
 * An error as the teacher's stream carries it (the SDK shape with plain-data `detail`). The server's own error and the
 * teacher's stream error have the same fields; this keeps only the `detail` values that survive JSON.
 */
export function toStreamError(e: ServerError): StreamError {
  const detail: Record<string, JsonLike> = {};
  for (const [k, v] of Object.entries(e.detail ?? {})) {
    if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') detail[k] = v;
  }
  return { ok: false, kind: e.kind, message: e.message, ...(e.hint !== undefined ? { hint: e.hint } : {}), ...(Object.keys(detail).length > 0 ? { detail } : {}) };
}

/**
 * The server's error for an error event that came out of the teacher's stream. The kinds of `errors.md` pass through;
 * `turn_limit` (the turn passed 60 s) is `model_timeout`; anything else is `internal` with a fingerprint of its kind.
 */
export function fromStreamError(e: StreamError): ServerError {
  if (e.kind === 'turn_limit') return modelTimeout();
  if (Object.hasOwn(STATUS, e.kind)) {
    const detail = e.detail === undefined ? undefined : { ...e.detail };
    return serverError(e.kind as ServerErrorKind, e.message, { ...(e.hint !== undefined ? { hint: e.hint } : {}), ...(detail !== undefined ? { detail } : {}) });
  }
  return internalError(`internal:stream.${e.kind.slice(0, 40)}`);
}

export const notFound = (routes: readonly string[]): ServerError => serverError('not_found', `There is no such route. The routes are: ${routes.join(', ')}.`, { detail: { routes } });

export const badRequest = (message: string, hint?: string): ServerError => serverError('bad_request', message, hint !== undefined ? { hint } : {});

export const tooLarge = (what: string, max: number): ServerError => serverError('payload_too_large', `${what} is over the limit of ${max}.`, { detail: { limit: max } });

/** A short fingerprint of a fault, so the log line and the answer can be matched without the answer holding a stack. */
export function fingerprintOf(e: unknown): string {
  const text = e instanceof Error ? `${e.name}:${e.message}:${(e.stack ?? '').split('\n')[1] ?? ''}` : String(e);
  return `internal:${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;
}

export const internalError = (fingerprint: string): ServerError =>
  serverError('internal', 'Something went wrong in the server; nothing was changed.', { detail: { fingerprint } });

/** The seconds for a `retry-after` header from an error's `detail.retryAfterMs`, or undefined. */
export function retryAfterSeconds(e: ServerError): number | undefined {
  const ms = e.detail?.['retryAfterMs'];
  return typeof ms === 'number' ? seconds(ms) : undefined;
}
