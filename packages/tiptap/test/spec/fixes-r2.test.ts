/**
 * Fix TR-17 of the round 2 review (handoff/teacher/review-r2.md): on an answer that is not 200, `httpTransport` shows the
 * server's own `kind` and `message` when the body is the SDK error shape, and `http_<status>` otherwise.
 */
import { describe, expect, it } from 'vitest';
import { httpTransport } from '../../src/index';
import type { AiEvent, AiRequest } from '../../src/index';

const REQUEST: AiRequest = { request: 'a circle', mode: 'geometry', script: '', figure: null, before: '', after: '' };

async function eventsOf(response: Response): Promise<AiEvent[]> {
  const out: AiEvent[] = [];
  for await (const ev of httpTransport('http://s', async () => response)(REQUEST, new AbortController().signal)) out.push(ev);
  return out;
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('an HTTP error answer (TR-17)', () => {
  it('a JSON error body of the SDK shape gives its kind and message', async () => {
    const out = await eventsOf(json(429, { ok: false, kind: 'rate_limited', message: 'Too many requests; try again in 12 s.', detail: { retryAfterMs: 12000 } }));
    expect(out).toEqual([{ error: { kind: 'rate_limited', message: 'Too many requests; try again in 12 s.' } }]);
  });

  it('the kinds of errors.md that answer with a status all pass through', async () => {
    for (const [status, kind, message] of [
      [503, 'model_unavailable', 'The AI is not set up.'],
      [429, 'daily_budget', 'The AI has done its work for today.'],
      [403, 'origin_blocked', 'This site may not use the server.'],
      [413, 'payload_too_large', 'The text is over the limit of 4000.'],
    ] as const) {
      expect(await eventsOf(json(status, { ok: false, kind, message })), kind).toEqual([{ error: { kind, message } }]);
    }
  });

  it('a body that is not JSON keeps http_<status>', async () => {
    expect(await eventsOf(new Response('server error', { status: 500, statusText: 'Internal' }))).toEqual([{ error: { kind: 'http_500', message: 'The server answered 500 Internal.' } }]);
  });

  it('JSON that is not the error shape keeps http_<status>', async () => {
    for (const body of [{ error: 'x' }, { ok: true, kind: 'x', message: 'y' }, { ok: false, kind: 3, message: 'y' }, { ok: false, kind: 'x' }, [], null, 'text']) {
      const out = await eventsOf(json(502, body));
      expect(out, JSON.stringify(body)).toEqual([{ error: { kind: 'http_502', message: 'The server answered 502.' } }]);
    }
  });

  it('an empty body keeps http_<status>', async () => {
    expect(await eventsOf(new Response('', { status: 504 }))).toEqual([{ error: { kind: 'http_504', message: 'The server answered 504.' } }]);
  });
});
