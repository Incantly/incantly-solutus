/**
 * Round-1 rows of teacher design 10, with the fake model so only our code is measured: build a prompt (catalogue cached
 * per mode) in under 2 ms, the overhead of `draw` over the kernel for 5 lines in under 0.2 ms, the loop's overhead per
 * model call in under 1 ms.
 *
 * Run: `npx vitest run --config packages/teacher/bench/vitest.config.ts`. Each case is a test that fails when it misses
 * its target; the number is the best of several warm runs. Node, no network.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createHeadlessApp } from '@incantly/sdk';
import { buildPrompt, catalogueFor, fakeModel, figureTarget, runTurn, toolset } from '../src/index';
import type { JobId, RecordedReply, TurnRequest } from '../src/index';

type Mode = NonNullable<NonNullable<Parameters<typeof createHeadlessApp>[0]>['mode']>;

/** Best of `runs` timed calls after `warm` warm-up calls, in ms. */
async function best(fn: () => Promise<void> | void, runs = 30, warm = 5): Promise<number> {
  for (let i = 0; i < warm; i++) await fn();
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    min = Math.min(min, performance.now() - t0);
  }
  return min;
}

const report = (name: string, value: number, unit: string, target: number): void => {
  process.stdout.write(`${value <= target ? 'ok  ' : 'MISS'}  ${name.padEnd(52)} ${value.toFixed(4).padStart(10)} ${unit}   target ${target} ${unit}\n`);
};

const must = <T>(r: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

describe('teacher design 10, Node, warm, fake model', () => {
  const request: TurnRequest = { text: 'Take a circle of radius 2 and a point on it.' };

  for (const job of ['live', 'figure', 'circle', 'talk'] as const satisfies readonly JobId[]) {
    for (const mode of ['graphing', 'geometry'] as const satisfies readonly Mode[]) {
      it(`build a ${job} prompt in ${mode} mode (catalogue cached) in under 2 ms`, async () => {
        const target = figureTarget(createHeadlessApp({ mode }));
        must(catalogueFor(mode));
        const ms = await best(() => {
          must(buildPrompt(job, target, request, { tools: ['draw', 'figure'] }));
        });
        report(`buildPrompt ${job} / ${mode}`, ms, 'ms', 2);
        expect(ms).toBeLessThan(2);
      });
    }
  }

  it('draw of 5 lines: tool overhead over the kernel in under 0.2 ms', async () => {
    const lines = ['a = 1', 'b = a + 1', 'c = b * 2', 'd = c - a', 'e = d / 2'];
    const raw = figureTarget(createHeadlessApp({ mode: 'graphing' }));
    const tooled = figureTarget(createHeadlessApp({ mode: 'graphing' }));
    const set = must(toolset(['draw']));
    const kernelMs = await best(() => {
      raw.run(lines);
    }, 200, 20);
    const toolMs = await best(() => {
      set.call(tooled, 'draw', { lines });
    }, 200, 20);
    const overhead = Math.max(0, toolMs - kernelMs);
    report('draw(5 lines) minus the kernel run', overhead, 'ms', 0.2);
    process.stdout.write(`      kernel ${kernelMs.toFixed(4)} ms, draw ${toolMs.toFixed(4)} ms\n`);
    expect(overhead).toBeLessThan(0.2);
  });

  it('loop overhead per model call (prompt build excluded) in under 1 ms', async () => {
    const calls = 7;
    const replies: RecordedReply[] = [...Array.from({ length: calls }, () => ({ toolCalls: [{ name: 'figure', args: {} }] })), { text: 'Done.' }];
    const set = must(toolset(['draw', 'figure']));
    const turn = async (): Promise<void> => {
      const target = figureTarget(createHeadlessApp({ mode: 'graphing' }));
      for await (const e of runTurn({ job: 'live', client: fakeModel(replies), toolset: set, target, request, now: () => 0 })) void e;
    };
    const target = figureTarget(createHeadlessApp({ mode: 'graphing' }));
    const buildMs = await best(() => {
      must(buildPrompt('live', target, request, { tools: ['draw', 'figure'] }));
    });
    const turnMs = await best(turn, 30, 5);
    const perCall = Math.max(0, turnMs - buildMs) / (calls + 1);
    report('runTurn overhead per model call', perCall, 'ms', 1);
    expect(perCall).toBeLessThan(1);
  });
});
