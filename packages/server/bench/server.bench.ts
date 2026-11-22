/**
 * Server design 9, with a fake model so only our code is measured: the time from the model's line to that line leaving the
 * server (under 5 ms), the server's overhead per request before the model is asked (under 5 ms), and `/v1/check` of 100
 * lines (under 50 ms). The server runs on 127.0.0.1 and the model is a fake `fetch`; no real network.
 *
 * Run: `npx vitest run --config packages/server/bench/vitest.config.ts`. Each case is a test that fails when it misses its
 * target. The numbers are the median and the best of many warm requests, in milliseconds.
 */
import { performance } from 'node:perf_hooks';
import { afterAll, describe, expect, it } from 'vitest';
import { createHeadlessApp } from '@incantly/sdk';
import { clientFor } from '../src/index';
import { SECRET_KEY, openStream, postJson, settingsOf, start } from '../test/spec/helpers';
import type { Running } from '../test/spec/helpers';
import { FakeFetch, controlled, ok, textSse, wait } from '../test/spec/r2-helpers';
import type { Controlled } from '../test/spec/r2-helpers';

const env = { OPENROUTER_API_KEY: SECRET_KEY, RATE_PER_MINUTE: '100000', DAILY_MODEL_CALLS: '1000000' };
const EDIT = { request: 'bench', mode: 'geometry', script: 'a = 1', figure: createHeadlessApp({ mode: 'geometry', script: 'a = 1' }).figureSummary(), before: '', after: '' };
const runs: Running[] = [];
afterAll(async () => {
  for (const r of runs) await r.close();
});

const stats = (xs: readonly number[]): { best: number; median: number } => {
  const sorted = [...xs].sort((a, b) => a - b);
  return { best: sorted[0] ?? 0, median: sorted[Math.floor(sorted.length / 2)] ?? 0 };
};

const report = (name: string, s: { best: number; median: number }, target: number): void => {
  process.stdout.write(`${s.median <= target ? 'ok  ' : 'MISS'}  ${name.padEnd(56)} median ${s.median.toFixed(3).padStart(8)} ms  best ${s.best.toFixed(3).padStart(8)} ms  target ${target} ms\n`);
};

const chunk = (text: string): string => `data: ${JSON.stringify({ model: 'm', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`;

describe('server design 9, fake model', () => {
  it('the model\'s line leaves the server in under 5 ms', async () => {
    const bodies: Controlled[] = [];
    const fake = new FakeFetch(() => {
      const c = controlled();
      bodies.push(c);
      return { kind: 'stream', body: c.body };
    });
    const settings = settingsOf(env);
    const client = clientFor(settings, { fetch: fake.fetch });
    const run = await start(env, client !== undefined ? { client } : {});
    runs.push(run);
    const times: number[] = [];
    // each round: open a request, wait for the model call, send the first line (opens the answer), then time the second line
    for (let i = 0; i < 60; i++) {
      const before = fake.calls.length;
      const opening = openStream(run.port, { method: 'POST', path: '/v1/figure/draw', body: JSON.stringify(EDIT), headers: { 'content-type': 'application/json' } });
      for (let w = 0; fake.calls.length === before && w < 200; w++) await wait(2);
      const c = bodies[bodies.length - 1] as Controlled;
      c.push(chunk(`o${i} = 1\n`));
      const s = await opening;
      expect(await s.next(2000)).toContain(`o${i} = 1`);
      await wait(2);
      const t0 = performance.now();
      c.push(chunk(`p${i} = 2\n`));
      const line = await s.next(2000);
      const ms = performance.now() - t0;
      expect(line).toContain(`p${i} = 2`);
      times.push(ms);
      c.push(`data: ${JSON.stringify({ model: 'm', choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
      c.end();
      while ((await s.next(500)) !== undefined) {
        // drain to the end of the answer
      }
    }
    const warm = times.slice(10);
    const s = stats(warm);
    report('model line to the line leaving the server', s, 5);
    expect(s.median).toBeLessThan(5);
  });

  it('the server\'s own work before the model is asked takes under 5 ms', async () => {
    const stamps: number[] = [];
    const fake = new FakeFetch(() => {
      stamps.push(performance.now());
      return ok(textSse(['b = 2\n']));
    });
    const settings = settingsOf(env);
    const client = clientFor(settings, { fetch: fake.fetch });
    const run = await start(env, client !== undefined ? { client } : {});
    runs.push(run);
    const times: number[] = [];
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now();
      const r = await postJson(run.port, '/v1/figure/draw', EDIT);
      expect(r.status).toBe(200);
      times.push((stamps[stamps.length - 1] ?? 0) - t0);
    }
    const s = stats(times.slice(10));
    report('request to the model call (connection, checks, headless copy)', s, 5);
    expect(s.median).toBeLessThan(5);
  });

  it('/v1/check of 100 lines takes under 50 ms', async () => {
    const run = await start(env);
    runs.push(run);
    const lines = Array.from({ length: 100 }, (_, i) => `n${i} = ${i} + 1`);
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      const r = await postJson(run.port, '/v1/check', { lines, mode: 'graphing' });
      times.push(performance.now() - t0);
      expect(r.status).toBe(200);
    }
    const s = stats(times.slice(5));
    report('/v1/check of 100 lines', s, 50);
    expect(s.median).toBeLessThan(50);
  });
});
