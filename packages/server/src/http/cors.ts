/**
 * Origins (docs/features/server/design.md 7): a browser request must come from `ALLOWED_ORIGINS`. A request with no
 * `Origin` header passes: it is not from a browser.
 */
import { originBlocked } from '../errors';
import type { ServerError } from '../errors';

/** `origin_blocked` when the request names an origin outside `allowed`; undefined when it passes. */
export function checkOrigin(origin: string | undefined, allowed: readonly string[]): ServerError | undefined {
  if (origin === undefined) return undefined;
  return allowed.includes(origin) ? undefined : originBlocked();
}

/** The CORS headers for an allowed origin (none when the request has no origin). */
export function corsHeaders(origin: string | undefined, allowed: readonly string[]): Record<string, string> {
  if (origin === undefined || !allowed.includes(origin)) return {};
  return { 'access-control-allow-origin': origin, vary: 'origin' };
}

/** The headers of an answer to a preflight request from an allowed origin. */
export function preflightHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}
