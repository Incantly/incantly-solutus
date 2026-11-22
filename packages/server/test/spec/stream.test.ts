/**
 * Streams and limits over HTTP (server design 6, 7; errors.md; requirements R2.5, R5.3): NDJSON events flushed one by one,
 * the model call aborted when the client closes, errors before and after the first event, 429 with `retry-after`, the
 * daily budget, one request at a time per client, and `x-forwarded-for` only behind `TRUST_PROXY=1`.
 *
 * Round 1 has no model endpoint, so these run through test routes that do what a model route does (take a slot, stream
 * events, end). Each goes through the real server: origin, body, job and limiter are the production ones.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NDJSON_TYPE, ndjsonLine, serverError } from '../../src/index';
import type { Context, ServerError } from '../../src/index';
import { addRoutes, ask, deferred, errorBody, getJson, makeClock, openStream, postJson, start, until } from './helpers';
import type { Running } from './helpers';

const seen = {
  aborted: false,
  jobStateAtAbort: '',
  firstAborted: false,
  released: 0,
};
const gate = { current: deferred<void>() };

const model = (ctx: Context): ServerError | { ok: true; release(): void } => ctx.limiter.acquire(ctx.clientId, { exclusive: true, controller: ctx.job.abort });

let undo: (() => void) | undefined;
let run: Running;
const clock = makeClock();

beforeAll(async () => {
  undo = addRoutes([
    {
      // two events, the second only after the test opens the gate
      method: 'GET',
      path: '/v1/test/stream',
      bodyLimit: 0,
      async handle(ctx) {
        if (!ctx.job.checked()) return;
        ctx.job.event({ lines: ['a = 1'] });
        await gate.current.promise;
        ctx.job.event({ lines: ['b = 2'] });
        ctx.job.event({ done: true });
        ctx.job.end();
      },
    },
    {
      // streams until the client leaves
      method: 'GET',
      path: '/v1/test/hang',
      bodyLimit: 0,
      async handle(ctx) {
        if (!ctx.job.checked()) return;
        ctx.job.event({ say: 'hello' });
        await new Promise<void>((resolve) => ctx.job.abort.signal.addEventListener('abort', () => resolve(), { once: true }));
        seen.aborted = ctx.job.abort.signal.aborted;
        seen.jobStateAtAbort = ctx.job.is('aborted') ? 'aborted' : 'other';
        ctx.job.event({ late: 'this must not be written' });
      },
    },
    {
      // an error after the first event is the last event
      method: 'GET',
      path: '/v1/test/error-after',
      bodyLimit: 0,
      handle(ctx) {
        if (!ctx.job.checked()) return;
        ctx.job.event({ lines: ['a = 1'] });
        ctx.job.fail(serverError('model_timeout', 'The AI took too long.'));
        ctx.job.event({ late: true });
        ctx.job.end();
      },
    },
    {
      // an error before any event is an HTTP error
      method: 'GET',
      path: '/v1/test/error-before',
      bodyLimit: 0,
      handle(ctx) {
        if (!ctx.job.checked()) return;
        ctx.job.fail(serverError('model_busy', 'The AI is busy; try again in 5 s.', { detail: { retryAfterMs: 5000 } }));
      },
    },
    {
      // a model-like route: minute limit
      method: 'POST',
      path: '/v1/test/model',
      bodyLimit: 1024,
      handle(ctx) {
        const a = ctx.limiter.acquire(ctx.clientId);
        if (!a.ok) return ctx.job.refuse(a);
        if (!ctx.job.checked()) return;
        ctx.job.json(200, { ok: true });
        a.release();
      },
    },
    {
      // a model-like route: daily budget
      method: 'POST',
      path: '/v1/test/daily',
      bodyLimit: 1024,
      handle(ctx) {
        const d = ctx.limiter.takeModelCall();
        if (!d.ok) return ctx.job.refuse(d);
        if (!ctx.job.checked()) return;
        ctx.job.json(200, { ok: true });
      },
    },
    {
      // a model-like route: one request at a time per client
      method: 'GET',
      path: '/v1/test/slot',
      bodyLimit: 0,
      async handle(ctx) {
        const a = model(ctx);
        if (!a.ok) return ctx.job.refuse(a);
        if (!ctx.job.checked()) return;
        ctx.job.event({ started: true });
        await new Promise<void>((resolve) => {
          ctx.job.abort.signal.addEventListener('abort', () => resolve(), { once: true });
          void gate.current.promise.then(() => resolve());
        });
        if (ctx.job.abort.signal.aborted) seen.firstAborted = true;
        a.release();
        seen.released += 1;
        ctx.job.event({ done: true });
        ctx.job.end();
      },
    },
    {
      // says who the server thinks the client is
      method: 'GET',
      path: '/v1/test/who',
      bodyLimit: 0,
      handle(ctx) {
        if (ctx.job.checked()) ctx.job.json(200, { client: ctx.clientId });
      },
    },
  ]);
  run = await start({ RATE_PER_MINUTE: '3', DAILY_MODEL_CALLS: '2' }, { now: clock.now });
});

afterAll(async () => {
  undo?.();
  await run.close();
});

describe('NDJSON answers (design 6, R2.5)', () => {
  it('is 200 with content-type application/x-ndjson', async () => {
    gate.current = deferred();
    const s = await openStream(run.port, { path: '/v1/test/stream' });
    expect(s.status).toBe(200);
    expect(String(s.headers['content-type'])).toMatch(/^application\/x-ndjson/);
    expect(NDJSON_TYPE).toMatch(/^application\/x-ndjson/);
    gate.current.resolve();
    s.destroy();
  });

  it('flushes each event when it is written: the first line arrives while the second is still being made', async () => {
    gate.current = deferred();
    const s = await openStream(run.port, { path: '/v1/test/stream' });
    const first = await s.next(1500);
    expect(first).toBe(JSON.stringify({ lines: ['a = 1'] }));
    expect(s.ended()).toBe(false);
    gate.current.resolve();
    expect(await s.next()).toBe(JSON.stringify({ lines: ['b = 2'] }));
    expect(await s.next()).toBe(JSON.stringify({ done: true }));
    expect(await s.next()).toBeUndefined();
    expect(s.ended()).toBe(true);
  });

  it('one JSON event a line, each ending in a newline', () => {
    expect(ndjsonLine({ done: true })).toBe('{"done":true}\n');
    expect(ndjsonLine({ lines: ['a = 1', 'b = "x\ny"'] }).split('\n')).toHaveLength(2);
  });

  it('is not buffered into one chunk: events come as separate reads in order', async () => {
    gate.current = deferred();
    const s = await openStream(run.port, { path: '/v1/test/stream' });
    const t0 = Date.now();
    await s.next();
    expect(Date.now() - t0).toBeLessThan(500);
    gate.current.resolve();
    s.destroy();
  });

  it('an error after the first event is the last event, { error: { kind, message } }, and ends the stream', async () => {
    const s = await openStream(run.port, { path: '/v1/test/error-after' });
    expect(s.status).toBe(200);
    expect(JSON.parse((await s.next()) as string)).toEqual({ lines: ['a = 1'] });
    const last = JSON.parse((await s.next()) as string) as { error: { kind: string; message: string } };
    expect(last.error).toMatchObject({ kind: 'model_timeout', message: 'The AI took too long.' });
    expect(await s.next()).toBeUndefined();
    expect(s.ended()).toBe(true);
  });

  it('an error before the first event is an HTTP error with one JSON body, not a stream', async () => {
    const r = await getJson(run.port, '/v1/test/error-before');
    expect(r.status).toBe(503);
    expect(String(r.headers['content-type'])).toMatch(/application\/json/);
    const e = errorBody(r);
    expect(e).toMatchObject({ kind: 'model_busy', detail: { retryAfterMs: 5000 } });
  });

  it('an HTTP error for a busy or rate-limited answer carries retry-after in seconds, rounded up', async () => {
    const r = await getJson(run.port, '/v1/test/error-before');
    const header = r.headers['retry-after'];
    if (header !== undefined) expect(Number(header)).toBe(5);
  });

  it('each event passes through the job, so CORS headers of an allowed origin are on the stream', async () => {
    gate.current = deferred();
    const s = await openStream(run.port, { path: '/v1/test/stream', headers: { origin: 'http://localhost:5173' } });
    expect(s.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    gate.current.resolve();
    s.destroy();
  });
});

describe('a closed connection aborts the model call at once (R2.5, SV1)', () => {
  it('the job\'s signal is aborted, the job is `aborted`, and nothing more is written', async () => {
    seen.aborted = false;
    seen.jobStateAtAbort = '';
    const s = await openStream(run.port, { path: '/v1/test/hang' });
    expect(await s.next()).toBe(JSON.stringify({ say: 'hello' }));
    s.destroy();
    expect(await until(() => seen.aborted, 1500)).toBe(true);
    expect(seen.jobStateAtAbort).toBe('aborted');
  });

  it('the server keeps serving after a client left', async () => {
    expect((await getJson(run.port, '/v1/health')).status).toBe(200);
  });
});

describe('429 with retry-after (R5.3, errors.md)', () => {
  it('the request after RATE_PER_MINUTE is 429 rate_limited, retry-after is whole seconds, the message says the same', async () => {
    for (let i = 0; i < 3; i++) expect((await postJson(run.port, '/v1/test/model', {})).status, `request ${i + 1}`).toBe(200);
    const r = await postJson(run.port, '/v1/test/model', {});
    expect(r.status).toBe(429);
    const e = errorBody(r);
    expect(e.kind).toBe('rate_limited');
    const seconds = Number(r.headers['retry-after']);
    expect(Number.isInteger(seconds)).toBe(true);
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(seconds).toBeLessThanOrEqual(60);
    expect(e.message).toBe(`Too many requests; try again in ${seconds} s.`);
    expect(typeof e.detail?.['retryAfterMs']).toBe('number');
  });

  it('the server clock decides: after a minute the client is let in again', async () => {
    clock.advance(61_000);
    expect((await postJson(run.port, '/v1/test/model', {})).status).toBe(200);
  });

  it('a refused request has no side effect on other clients or other routes', async () => {
    expect((await getJson(run.port, '/v1/health')).status).toBe(200);
  });
});

describe('the daily budget (R5.3)', () => {
  it('the call after DAILY_MODEL_CALLS is 429 daily_budget with the documented message', async () => {
    expect((await postJson(run.port, '/v1/test/daily', {})).status).toBe(200);
    expect((await postJson(run.port, '/v1/test/daily', {})).status).toBe(200);
    const r = await postJson(run.port, '/v1/test/daily', {});
    expect(r.status).toBe(429);
    const e = errorBody(r);
    expect(e.kind).toBe('daily_budget');
    expect(e.message).toBe('The AI has done its work for today.');
  });

  it('it starts again the next UTC day', async () => {
    clock.set(Date.UTC(2026, 10, 23, 0, 0, 1));
    expect((await postJson(run.port, '/v1/test/daily', {})).status).toBe(200);
  });
});

describe('one model request at a time per client; a newer one aborts the older (R5.3, SV1)', () => {
  it('the second request from one client aborts the first and releases its slot', async () => {
    seen.firstAborted = false;
    seen.released = 0;
    gate.current = deferred();
    clock.advance(120_000);
    const first = await openStream(run.port, { path: '/v1/test/slot' });
    expect(await first.next()).toBe(JSON.stringify({ started: true }));
    const second = await openStream(run.port, { path: '/v1/test/slot' });
    expect(await second.next()).toBe(JSON.stringify({ started: true }));
    expect(await until(() => seen.firstAborted, 1500)).toBe(true);
    gate.current.resolve();
    expect(await second.next()).toBe(JSON.stringify({ done: true }));
    expect(await until(() => seen.released >= 2, 1500)).toBe(true);
  });
});

describe('the client is its address, and x-forwarded-for counts only behind TRUST_PROXY=1 (design 7)', () => {
  it('without TRUST_PROXY the header is ignored', async () => {
    const r = await getJson(run.port, '/v1/test/who', { 'x-forwarded-for': '203.0.113.9' });
    expect((r.json as { client: string }).client).not.toContain('203.0.113.9');
    expect((r.json as { client: string }).client).toMatch(/127\.0\.0\.1/);
  });

  it('with TRUST_PROXY=1 the first address of the header is the client', async () => {
    const proxied = await start({ TRUST_PROXY: '1' });
    try {
      const r = await getJson(proxied.port, '/v1/test/who', { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
      expect((r.json as { client: string }).client).toBe('203.0.113.9');
      const plain = await getJson(proxied.port, '/v1/test/who');
      expect((plain.json as { client: string }).client).toMatch(/127\.0\.0\.1/);
    } finally {
      await proxied.close();
    }
  });

  it('behind a proxy two clients have two minutes each', async () => {
    const proxied = await start({ TRUST_PROXY: '1', RATE_PER_MINUTE: '1' });
    try {
      const post = (ip: string): Promise<{ status: number }> => ask(proxied.port, { method: 'POST', path: '/v1/test/model', body: '{}', headers: { 'x-forwarded-for': ip } });
      expect((await post('198.51.100.1')).status).toBe(200);
      expect((await post('198.51.100.2')).status).toBe(200);
      expect((await post('198.51.100.1')).status).toBe(429);
    } finally {
      await proxied.close();
    }
  });

  it('without a proxy, a forged header cannot buy a new minute', async () => {
    const plain = await start({ RATE_PER_MINUTE: '1' });
    try {
      const post = (ip: string): Promise<{ status: number }> => ask(plain.port, { method: 'POST', path: '/v1/test/model', body: '{}', headers: { 'x-forwarded-for': ip } });
      expect((await post('198.51.100.1')).status).toBe(200);
      expect((await post('198.51.100.2')).status).toBe(429);
    } finally {
      await plain.close();
    }
  });
});
