/**
 * SDK benchmarks against the targets of docs/features/embed-files-export/design.md 10 (Node, warm).
 *
 * Run: `npx vitest run --config packages/sdk/bench/vitest.config.ts`. Each case is a test that fails when it misses its
 * target; the number is the best of several warm runs. PNG export needs a canvas and is measured in the browser.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { connectApp, createHeadlessApp, serveApp } from '../src/index';
import type { MessageHost, MessageLike, MessageTarget } from '../src/index';

/** 500 objects: 200 free points, 100 midpoints, 100 segments and 100 circles. */
function script500(): string {
  const lines: string[] = [];
  for (let i = 0; i < 200; i++) lines.push(`P${i} = (${(i % 20) - 10}, ${Math.floor(i / 20) - 5})`);
  for (let i = 0; i < 100; i++) lines.push(`M${i} = Midpoint(P${2 * i}, P${2 * i + 1})`);
  for (let i = 0; i < 100; i++) lines.push(`s${i} = Segment(P${i}, P${i + 100})`);
  for (let i = 0; i < 100; i++) lines.push(`c${i} = Circle(M${i}, 0.4)`);
  return lines.join('\n');
}

const best = (runs: number, fn: () => void): number => {
  let b = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    b = Math.min(b, performance.now() - t);
  }
  return b;
};

const bestAsync = async (runs: number, fn: () => Promise<unknown>): Promise<number> => {
  let b = Infinity;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    await fn();
    b = Math.min(b, performance.now() - t);
  }
  return b;
};

describe('the embed API (design 10)', () => {
  const app = createHeadlessApp({ mode: 'classic', script: script500(), size: { width: 1200, height: 800 } });

  it('holds 500 objects', () => {
    expect(app.list()).toHaveLength(500);
  });

  it('run of one line: the API adds under 0.2 ms to the core', () => {
    let k = 0;
    // the core alone: the kernel figure's own apply of the same kind of line
    const core = best(200, () => void app.figure.apply(`P0 = (${(k++ % 7) - 3}, 1)`));
    const api = best(200, () => void app.run(`P0 = (${(k++ % 7) - 3}, 1)`));
    console.log(`run: core ${core.toFixed(3)} ms, API ${api.toFixed(3)} ms, overhead ${(api - core).toFixed(3)} ms`);
    expect(api).toBeLessThan(1.2);
    expect(api - core).toBeLessThan(0.2);
  });

  it('list() of 500 objects under 1 ms', () => {
    const t = best(50, () => void app.list());
    console.log(`list(): ${t.toFixed(3)} ms`);
    expect(t).toBeLessThan(1);
  });

  it('saveText() of 500 objects under 5 ms', () => {
    const t = best(20, () => void app.saveText());
    console.log(`saveText(): ${t.toFixed(3)} ms, ${(app.saveText().length / 1024).toFixed(1)} KB`);
    expect(t).toBeLessThan(5);
  });

  it('load of 500 objects under 60 ms', () => {
    const text = app.saveText();
    const other = createHeadlessApp({ mode: 'classic' });
    const t = best(10, () => {
      const r = other.load(text);
      if (!('applied' in r) || r.applied !== 500) throw new Error('load failed');
    });
    console.log(`load: ${t.toFixed(3)} ms`);
    expect(t).toBeLessThan(60);
  });

  it('SVG export of 500 objects under 50 ms', async () => {
    const t = await bestAsync(10, async () => {
      const r = await app.export({ format: 'svg', region: 'all' });
      if (!r.ok) throw new Error(r.message);
    });
    console.log(`SVG export: ${t.toFixed(3)} ms`);
    expect(t).toBeLessThan(50);
  });
});

describe('frames (design 10)', () => {
  it('a call across the frame and back under 3 ms', async () => {
    const PAGE = 'https://school.example';
    const FRAME = 'https://figures.example';
    const pageL = new Set<(e: MessageLike) => void>();
    const frameL = new Set<(e: MessageLike) => void>();
    const host = (set: Set<(e: MessageLike) => void>): MessageHost => ({ addEventListener: (_t, fn) => void set.add(fn), removeEventListener: (_t, fn) => void set.delete(fn) });
    // a message is copied as postMessage copies it, and arrives on a later task
    const pageWin: MessageTarget = { postMessage: (msg) => void setTimeout(() => pageL.forEach((f) => f({ data: structuredClone(msg), origin: FRAME, source: frameWin })), 0) };
    const frameWin: MessageTarget = { postMessage: (msg) => void setTimeout(() => frameL.forEach((f) => f({ data: structuredClone(msg), origin: PAGE, source: pageWin })), 0) };
    const app = createHeadlessApp({ mode: 'classic', script: script500() });
    serveApp(app, { host: host(frameL), selfOrigin: FRAME, allowOrigins: [PAGE] });
    const client = connectApp(frameWin, { origin: FRAME, host: host(pageL), timeoutMs: 1000 });
    await client.value('P0');
    const t = await bestAsync(50, async () => {
      expect(await client.value('M3')).toBeTypeOf('object');
    });
    console.log(`frame round trip: ${t.toFixed(3)} ms`);
    expect(t).toBeLessThan(3);
  });
});
