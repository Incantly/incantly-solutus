/**
 * Lesson round 1 (LR-7, review-r1): the studio's client of `/v1/lesson/start`, `/turn` and `/end` (lesson design 7, server
 * errors.md). A fake `fetch` answers; nothing reaches a network. Start and end read one JSON body, a turn reads NDJSON, and an
 * HTTP error body is read as the server's own error.
 */
import { describe, expect, it } from 'vitest';
import { endLesson, parseLessonEvent, startLesson, streamLessonTurn } from '../src/lesson-client';
import type { LessonEvent } from '../src/lesson-client';

const BOARD = { items: [], more: 0, page: 'page:1' };

interface Seen {
  path: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

/** A fetch that records the request and answers with `reply`. */
function fakeFetch(reply: (seen: Seen) => Response | Promise<Response>): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const s: Seen = {
      path: String(input),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      signal: init?.signal ?? undefined,
    };
    seen.push(s);
    return reply(s);
  }) as typeof fetch;
  return { fetch: fn, seen };
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ndjson = (lines: readonly string[]): Response => new Response(lines.map((l) => `${l}\n`).join(''), { status: 200, headers: { 'content-type': 'application/x-ndjson' } });

async function collect(it: AsyncIterable<LessonEvent>): Promise<LessonEvent[]> {
  const out: LessonEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const TURN = { lessonId: 'abc', text: 'Teach me', board: BOARD };

describe('startLesson', () => {
  it('posts JSON to /v1/lesson/start and answers the lesson id', async () => {
    const { fetch, seen } = fakeFetch(() => json(200, { lessonId: 'lesson-1' }));
    const r = await startLesson({ topic: 'Vectors', mode: 'graphing', board: BOARD }, undefined, fetch);
    expect(r).toEqual({ ok: true, lessonId: 'lesson-1' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.path).toBe('/v1/lesson/start');
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.headers['content-type']).toBe('application/json');
    expect(seen[0]?.body).toEqual({ topic: 'Vectors', mode: 'graphing', board: BOARD });
  });

  it('reads a JSON error body as the server\'s error: kind and message', async () => {
    const { fetch } = fakeFetch(() => json(503, { ok: false, kind: 'model_unavailable', message: 'The AI is not set up.' }));
    expect(await startLesson({ board: BOARD }, undefined, fetch)).toEqual({ ok: false, kind: 'model_unavailable', message: 'The AI is not set up.' });
  });

  it('an error that is not JSON is http_<status>', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
    expect(await startLesson({ board: BOARD }, undefined, fetch)).toEqual({ ok: false, kind: 'http_502', message: 'The server answered 502.' });
  });

  it('a 200 with no lesson id is bad_stream', async () => {
    const { fetch } = fakeFetch(() => json(200, { nope: 1 }));
    expect(await startLesson({ board: BOARD }, undefined, fetch)).toMatchObject({ ok: false, kind: 'bad_stream' });
    const second = fakeFetch(() => new Response('not json', { status: 200 }));
    expect(await startLesson({ board: BOARD }, undefined, second.fetch)).toMatchObject({ ok: false, kind: 'bad_stream' });
  });

  it('a network failure is the value `unreachable`; an aborted request is `aborted`; neither throws', async () => {
    const down = fakeFetch(() => {
      throw new TypeError('network down');
    });
    expect(await startLesson({ board: BOARD }, undefined, down.fetch)).toMatchObject({ ok: false, kind: 'unreachable' });
    const controller = new AbortController();
    controller.abort();
    expect(await startLesson({ board: BOARD }, controller.signal, down.fetch)).toMatchObject({ ok: false, kind: 'aborted' });
  });
});

describe('endLesson', () => {
  it('posts the id to /v1/lesson/end and answers ok', async () => {
    const { fetch, seen } = fakeFetch(() => json(200, { ok: true }));
    expect(await endLesson('abc', undefined, fetch)).toEqual({ ok: true });
    expect(seen[0]?.path).toBe('/v1/lesson/end');
    expect(seen[0]?.body).toEqual({ lessonId: 'abc' });
  });

  it('lesson_unknown (404) is read as the server\'s error', async () => {
    const { fetch } = fakeFetch(() => json(404, { ok: false, kind: 'lesson_unknown', message: 'This lesson has ended.' }));
    expect(await endLesson('abc', undefined, fetch)).toEqual({ ok: false, kind: 'lesson_unknown', message: 'This lesson has ended.' });
  });
});

describe('streamLessonTurn', () => {
  it('posts the turn to /v1/lesson/turn and parses each NDJSON line into an event, in order', async () => {
    const { fetch, seen } = fakeFetch(() =>
      ndjson([
        JSON.stringify({ say: 'A vector is an arrow.' }),
        JSON.stringify({ actions: [{ op: 'write', text: 'v' }] }),
        JSON.stringify({ lesson: { plan: ['One', 'Two', 'Three'], step: 1, state: 'teaching' } }),
        JSON.stringify({ done: true }),
      ]),
    );
    const events = await collect(streamLessonTurn(TURN, new AbortController().signal, fetch));
    expect(events).toEqual([
      { say: 'A vector is an arrow.' },
      { actions: [{ op: 'write', text: 'v' }] },
      { lesson: { plan: ['One', 'Two', 'Three'], step: 1, state: 'teaching' } },
      { done: true },
    ]);
    expect(seen[0]?.path).toBe('/v1/lesson/turn');
    expect(seen[0]?.headers['accept']).toBe('application/x-ndjson');
    expect(seen[0]?.body).toEqual(TURN);
  });

  it('a done with ended: true keeps the flag, and a notice-only done is still done', async () => {
    const { fetch } = fakeFetch(() => ndjson([JSON.stringify({ say: "That's the end." }), JSON.stringify({ done: true, ended: true })]));
    const events = await collect(streamLessonTurn(TURN, new AbortController().signal, fetch));
    expect(events[events.length - 1]).toEqual({ done: true, ended: true });
  });

  it('a line cut across two chunks is read whole', async () => {
    const line = `${JSON.stringify({ say: 'Whole sentence.' })}\n${JSON.stringify({ done: true })}\n`;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(line.slice(0, 9)));
        c.enqueue(enc.encode(line.slice(9)));
        c.close();
      },
    });
    const { fetch } = fakeFetch(() => new Response(body, { status: 200 }));
    expect(await collect(streamLessonTurn(TURN, new AbortController().signal, fetch))).toEqual([{ say: 'Whole sentence.' }, { done: true }]);
  });

  it('a last line with no newline is read', async () => {
    const { fetch } = fakeFetch(() => new Response(`${JSON.stringify({ say: 'One.' })}\n${JSON.stringify({ done: true })}`, { status: 200 }));
    expect(await collect(streamLessonTurn(TURN, new AbortController().signal, fetch))).toEqual([{ say: 'One.' }, { done: true }]);
  });

  it('an error event of the stream is passed on as it is', async () => {
    const { fetch } = fakeFetch(() => ndjson([JSON.stringify({ say: 'Half.' }), JSON.stringify({ error: { kind: 'superseded', message: 'A newer request replaced this one.' } })]));
    const events = await collect(streamLessonTurn(TURN, new AbortController().signal, fetch));
    expect(events[events.length - 1]).toEqual({ error: { kind: 'superseded', message: 'A newer request replaced this one.' } });
  });

  it('an HTTP error (a check failed) is one error event with the server\'s kind', async () => {
    const { fetch } = fakeFetch(() => json(409, { ok: false, kind: 'lesson_busy', message: 'The teacher is still answering.' }));
    expect(await collect(streamLessonTurn(TURN, new AbortController().signal, fetch))).toEqual([{ error: { kind: 'lesson_busy', message: 'The teacher is still answering.' } }]);
    const gone = fakeFetch(() => json(404, { ok: false, kind: 'lesson_unknown', message: 'This lesson has ended.' }));
    expect(await collect(streamLessonTurn(TURN, new AbortController().signal, gone.fetch))).toEqual([{ error: { kind: 'lesson_unknown', message: 'This lesson has ended.' } }]);
  });

  it('a line that is not an event is bad_stream, and the stream stops there', async () => {
    const { fetch } = fakeFetch(() => ndjson([JSON.stringify({ say: 'Fine.' }), 'this is not json', JSON.stringify({ done: true })]));
    const events = await collect(streamLessonTurn(TURN, new AbortController().signal, fetch));
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ say: 'Fine.' });
    expect(events[1]).toMatchObject({ error: { kind: 'bad_stream' } });
  });

  it('a network failure is one `unreachable` event; an aborted request ends with no event', async () => {
    const down = fakeFetch(() => {
      throw new TypeError('network down');
    });
    expect(await collect(streamLessonTurn(TURN, new AbortController().signal, down.fetch))).toEqual([{ error: { kind: 'unreachable', message: 'The teacher could not be reached.' } }]);
    const controller = new AbortController();
    controller.abort();
    expect(await collect(streamLessonTurn(TURN, controller.signal, down.fetch))).toEqual([]);
  });

  it('a stream that breaks partway is `stream_cut` after what came before', async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(`${JSON.stringify({ say: 'Before.' })}\n`));
      },
      pull(c) {
        c.error(new Error('connection reset'));
      },
    });
    const { fetch } = fakeFetch(() => new Response(body, { status: 200 }));
    const events = await collect(streamLessonTurn(TURN, new AbortController().signal, fetch));
    expect(events[0]).toEqual({ say: 'Before.' });
    expect(events[events.length - 1]).toMatchObject({ error: { kind: 'stream_cut' } });
  });

  it('passes the caller\'s signal to fetch, so aborting stops the request', async () => {
    const controller = new AbortController();
    const { fetch, seen } = fakeFetch(() => ndjson([JSON.stringify({ done: true })]));
    await collect(streamLessonTurn(TURN, controller.signal, fetch));
    expect(seen[0]?.signal).toBe(controller.signal);
  });
});

describe('parseLessonEvent', () => {
  it('reads each kind of event', () => {
    expect(parseLessonEvent('{"say":"Hi."}')).toEqual({ say: 'Hi.' });
    expect(parseLessonEvent('{"actions":[]}')).toEqual({ actions: [] });
    expect(parseLessonEvent('{"lesson":{"plan":["a","b","c"],"step":2,"state":"teaching"}}')).toEqual({ lesson: { plan: ['a', 'b', 'c'], step: 2, state: 'teaching' } });
    expect(parseLessonEvent('{"done":true}')).toEqual({ done: true });
    expect(parseLessonEvent('{"done":true,"ended":true}')).toEqual({ done: true, ended: true });
    expect(parseLessonEvent('{"error":{"kind":"x","message":"m"}}')).toEqual({ error: { kind: 'x', message: 'm' } });
  });

  it('an error with no kind is kind "error"', () => {
    expect(parseLessonEvent('{"error":{"message":"m"}}')).toEqual({ error: { kind: 'error', message: 'm' } });
  });

  it('anything else is not an event', () => {
    for (const line of ['', 'nope', '[]', '42', '{}', '{"say":1}', '{"done":false}', '{"lesson":{"plan":[1],"step":1,"state":"x"}}', '{"lesson":{"plan":[],"step":"1","state":"x"}}', '{"error":{}}']) {
      expect(parseLessonEvent(line), line).toBeUndefined();
    }
  });
});
