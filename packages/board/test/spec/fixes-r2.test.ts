/**
 * Fix TR-17 of the round 2 review (handoff/teacher/review-r2.md): on an answer that is not 200, `httpAgentTransport` shows
 * the server's own `kind` and `message` when the body is the SDK error shape, and `http_<status>` otherwise.
 */
import { describe, expect, it } from 'vitest';
import { httpAgentTransport } from '../../src/index';
import type { BoardAgentEvent, BoardAgentRequest } from '../../src/index';

const REQUEST: BoardAgentRequest = { kind: 'talk', text: 'hello', items: [], more: 0, page: 'page:1', allowEdit: false };

async function eventsOf(response: Response): Promise<BoardAgentEvent[]> {
  const out: BoardAgentEvent[] = [];
  for await (const ev of httpAgentTransport('http://s', async () => response)(REQUEST, new AbortController().signal)) out.push(ev);
  return out;
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('an HTTP error answer (TR-17)', () => {
  it('a JSON error body of the SDK shape gives its kind and message', async () => {
    const out = await eventsOf(json(429, { ok: false, kind: 'rate_limited', message: 'Too many requests; try again in 12 s.', detail: { retryAfterMs: 12000 } }));
    expect(out).toEqual([{ error: { kind: 'rate_limited', message: 'Too many requests; try again in 12 s.' } }]);
  });

  it('a body that is not JSON keeps http_<status>', async () => {
    expect(await eventsOf(new Response('nope', { status: 503, statusText: 'Unavailable' }))).toEqual([{ error: { kind: 'http_503', message: 'The server answered 503 Unavailable.' } }]);
  });

  it('JSON that is not the error shape keeps http_<status>', async () => {
    for (const body of [{ error: 'x' }, { ok: true, kind: 'x', message: 'y' }, { ok: false, kind: 3, message: 'y' }, { ok: false, kind: 'x' }, [], null]) {
      const out = await eventsOf(json(502, body));
      expect(out, JSON.stringify(body)).toEqual([{ error: { kind: 'http_502', message: 'The server answered 502.' } }]);
    }
  });

  it('an empty body keeps http_<status>', async () => {
    expect(await eventsOf(new Response('', { status: 500 }))).toEqual([{ error: { kind: 'http_500', message: 'The server answered 500.' } }]);
  });
});
