/**
 * Fixes of the round 1 review (handoff/teacher/review-r1.md): TR-1 a refused body is read and dropped until it ends, so
 * the client still uploading gets its 413; TR-5 a request that ended without an answer is failed through the job's
 * machine, never from the response's own flags.
 */
import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DROP_LIMIT } from '../../src/index';
import type { Job } from '../../src/index';
import { addRoutes, ask, errorBody, getJson, start } from './helpers';
import type { Running } from './helpers';

const pad = (n: number): string => `{"lines":["${'a'.repeat(n)}"]}`;

describe('a refused body is drained before the answer (TR-1)', () => {
  const holder: { run?: Running } = {};

  beforeAll(async () => {
    holder.run = await start();
  });
  afterAll(async () => {
    await holder.run?.close();
  });

  it('a 10 MB body with a content-length gets 413, five times in a row', async () => {
    const port = (holder.run as Running).port;
    for (let i = 0; i < 5; i++) {
      const r = await ask(port, { method: 'POST', path: '/v1/check', body: pad(10 * 1024 * 1024), headers: { 'content-type': 'application/json' } });
      expect(r.status, `run ${i + 1}`).toBe(413);
      expect(errorBody(r).kind).toBe('payload_too_large');
    }
  });

  it('a 10 MB chunked body gets 413, five times in a row', async () => {
    const port = (holder.run as Running).port;
    for (let i = 0; i < 5; i++) {
      const r = await ask(port, { method: 'POST', path: '/v1/check', body: pad(10 * 1024 * 1024), chunked: true, headers: { 'content-type': 'application/json' } });
      expect(r.status, `run ${i + 1}`).toBe(413);
    }
  });

  it('a body over the drop limit is answered at once and the connection closes; the server keeps serving', async () => {
    const port = (holder.run as Running).port;
    const status = await new Promise<{ code: number; connection: string | undefined }>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, method: 'POST', path: '/v1/check', agent: false, headers: { 'content-type': 'application/json', 'content-length': String(DROP_LIMIT * 4) } },
        (res) => {
          res.resume();
          res.on('end', () => resolve({ code: res.statusCode ?? 0, connection: res.headers['connection'] }));
        },
      );
      req.on('error', (e) => {
        // the server closed after the answer; a reset after the 413 was read is not a failure
        if ((e as NodeJS.ErrnoException).code === 'ECONNRESET' || (e as NodeJS.ErrnoException).code === 'EPIPE') return;
        reject(e);
      });
      req.write(Buffer.alloc(1024, 97));
    });
    expect(status.code).toBe(413);
    expect(status.connection).toBe('close');
    expect((await getJson(port, '/v1/health')).status).toBe(200);
  });

  it('a body just over the limit still gets 413 with the connection kept for the answer', async () => {
    const port = (holder.run as Running).port;
    const r = await ask(port, { method: 'POST', path: '/v1/check', body: pad(256 * 1024 + 10), headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(413);
  });
});

describe('an unanswered request fails through the machine (TR-5)', () => {
  const holder: { run?: Running; undo?: () => void; jobs: Job[]; logs: string[] } = { jobs: [], logs: [] };

  beforeAll(async () => {
    holder.undo = addRoutes([
      {
        method: 'GET',
        path: '/v1/fix/silent',
        bodyLimit: 0,
        handle(ctx) {
          holder.jobs.push(ctx.job);
        },
      },
      {
        method: 'GET',
        path: '/v1/fix/checked',
        bodyLimit: 0,
        handle(ctx) {
          ctx.job.checked();
          holder.jobs.push(ctx.job);
        },
      },
      {
        method: 'GET',
        path: '/v1/fix/streamed',
        bodyLimit: 0,
        handle(ctx) {
          ctx.job.checked();
          ctx.job.event({ say: 'one' });
          holder.jobs.push(ctx.job);
        },
      },
      {
        method: 'GET',
        path: '/v1/fix/answered',
        bodyLimit: 0,
        handle(ctx) {
          ctx.job.checked();
          ctx.job.json(200, { ok: true });
          holder.jobs.push(ctx.job);
        },
      },
    ]);
    holder.run = await start({}, { log: (event) => holder.logs.push(event) });
  });
  afterAll(async () => {
    holder.undo?.();
    await holder.run?.close();
  });

  it('a handler that returns at once is answered as internal, and its job is failed', async () => {
    const r = await getJson((holder.run as Running).port, '/v1/fix/silent');
    expect(r.status).toBe(500);
    expect(errorBody(r).kind).toBe('internal');
    expect((holder.jobs.at(-1) as Job).is('failed')).toBe(true);
  });

  it('a handler that checked and then returned is answered as internal, and its job is failed', async () => {
    const r = await getJson((holder.run as Running).port, '/v1/fix/checked');
    expect(r.status).toBe(500);
    expect((holder.jobs.at(-1) as Job).is('failed')).toBe(true);
  });

  it('a handler that streamed one event and returned ends the stream with an error event; the job is failed', async () => {
    const r = await getJson((holder.run as Running).port, '/v1/fix/streamed');
    expect(r.status).toBe(200);
    const lines = r.text.trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toEqual({ say: 'one' });
    expect(lines.at(-1)).toMatchObject({ error: { ok: false, kind: 'internal' } });
    expect((holder.jobs.at(-1) as Job).is('failed')).toBe(true);
  });

  it('an answered request stays done and reports no refused move', async () => {
    const before = holder.logs.filter((l) => l === 'job.refused').length;
    const r = await getJson((holder.run as Running).port, '/v1/fix/answered');
    expect(r.status).toBe(200);
    expect((holder.jobs.at(-1) as Job).is('done')).toBe(true);
    expect(holder.logs.filter((l) => l === 'job.refused').length).toBe(before);
  });
});
