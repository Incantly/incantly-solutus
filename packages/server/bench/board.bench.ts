/**
 * `POST /v1/board/ask` with a fake model (server design 9): the server's own work before the model is asked (under 5 ms,
 * here with 60 items and a picture), and the time from the model's tool call to the actions leaving the server (under 5 ms).
 * The server runs on 127.0.0.1 and the model is a fake `fetch`; no real network.
 *
 * Run: `npx vitest run --config packages/server/bench/vitest.config.ts`.
 */
import { performance } from 'node:perf_hooks';
import { afterAll, describe, expect, it } from 'vitest';
import { clientFor } from '../src/index';
import { SECRET_KEY, openStream, postJson, settingsOf, start } from '../test/spec/helpers';
import type { Running } from '../test/spec/helpers';
import { FIGURE, PNG_8, boardOnce, circle } from '../test/spec/board-helpers';
import { FakeFetch, finishChunk, sseOf, toolChunk, usageChunk, wait } from '../test/spec/r2-helpers';

const env = { OPENROUTER_API_KEY: SECRET_KEY, RATE_PER_MINUTE: '100000', DAILY_MODEL_CALLS: '1000000' };
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

const items = (n: number): unknown[] => Array.from({ length: n }, (_v, i) => ({ id: `shape:i${i + 1}`, kind: 'text', box: [0, i * 60, 100, 50], text: `note number ${i}` }));

describe('server design 9, /v1/board/ask, fake model', () => {
  it('the server\'s own work before the model is asked takes under 5 ms (60 items and a picture)', async () => {
    const stamps: number[] = [];
    const answer = boardOnce([FIGURE]);
    const fake = new FakeFetch((call, i) => {
      stamps.push(performance.now());
      return answer(call, i % 2);
    });
    const settings = settingsOf(env);
    const client = clientFor(settings, { fetch: fake.fetch });
    const run = await start(env, client !== undefined ? { client } : {});
    runs.push(run);
    const times: number[] = [];
    for (let i = 0; i < 60; i++) {
      const before = stamps.length;
      const t0 = performance.now();
      const r = await postJson(run.port, '/v1/board/ask', circle({ items: items(60), picture: PNG_8 }));
      expect(r.status).toBe(200);
      times.push((stamps[before] ?? 0) - t0);
    }
    const s = stats(times.slice(10));
    report('request to the model call (60 items, a picture)', s, 5);
    expect(s.median).toBeLessThan(5);
  });

  it('the model\'s tool call to the actions leaving the server takes under 5 ms (a figure card of 1 line)', async () => {
    const times: number[] = [];
    let release: (() => void) | undefined;
    const fake = new FakeFetch((_call, i) => {
      if (i % 2 === 1) return boardOnce([FIGURE])(_call, 1);
      const json = JSON.stringify({ actions: [FIGURE] });
      return {
        kind: 'stream',
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode(sseOf([toolChunk(0, { id: 'c1', name: 'board', arguments: '' })], 'none')));
            release = () => {
              controller.enqueue(enc.encode(sseOf([toolChunk(0, { arguments: json }), finishChunk('tool_calls'), usageChunk(10, 5)])));
              controller.close();
            };
          },
        }),
      };
    });
    const settings = settingsOf(env);
    const client = clientFor(settings, { fetch: fake.fetch });
    const run = await start(env, client !== undefined ? { client } : {});
    runs.push(run);
    for (let i = 0; i < 40; i++) {
      const s = await openStream(run.port, { method: 'POST', path: '/v1/board/ask', body: JSON.stringify(circle()), headers: { 'content-type': 'application/json' } });
      for (let w = 0; release === undefined && w < 200; w++) await wait(2);
      await wait(2);
      const t0 = performance.now();
      release?.();
      release = undefined;
      const line = await s.next(2000);
      times.push(performance.now() - t0);
      expect(line).toContain('"actions"');
      while ((await s.next(500)) !== undefined) {
        // drain to the end of the answer
      }
    }
    const s = stats(times.slice(10));
    report('tool call complete to actions leaving the server', s, 5);
    expect(s.median).toBeLessThan(5);
  });

  it('the answer of a whole circle turn, two model calls, with a fake model in under 25 ms', async () => {
    const fake = new FakeFetch((call, i) => boardOnce([FIGURE])(call, i % 2));
    const settings = settingsOf(env);
    const client = clientFor(settings, { fetch: fake.fetch });
    const run = await start(env, client !== undefined ? { client } : {});
    runs.push(run);
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      const r = await postJson(run.port, '/v1/board/ask', circle());
      times.push(performance.now() - t0);
      expect(r.status).toBe(200);
    }
    const s = stats(times.slice(10));
    report('whole circle turn (2 fake model calls)', s, 25);
    expect(s.median).toBeLessThan(25);
  });
});
