/**
 * Round-3 rows for the board jobs (teacher design 10), fake model only. The docs give no budget for `board_read` or for the
 * checks of a `board` call, so these use the design 10 numbers that apply (a prompt in under 2 ms, loop overhead per model
 * call under 1 ms) and a loose 1 ms and 2 ms for the two tools; the numbers are printed so a later round can tighten them.
 *
 * Run: `npx vitest run --config packages/teacher/bench/vitest.config.ts`. Node, no network.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import type { AgentItem } from '@incantly/board/core';
import { boardTarget, boardTurn, buildPrompt, catalogueFor, fakeModel, toolset } from '../src/index';
import type { RecordedReply } from '../src/index';

async function best(fn: () => Promise<void> | void, runs = 50, warm = 10): Promise<number> {
  for (let i = 0; i < warm; i++) await fn();
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    await fn();
    min = Math.min(min, performance.now() - t0);
  }
  return min;
}

const report = (name: string, value: number, target: number): void => {
  process.stdout.write(`${value <= target ? 'ok  ' : 'MISS'}  ${name.padEnd(56)} ${value.toFixed(4).padStart(10)} ms   target ${target} ms\n`);
};

const must = <T>(r: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

const items = (n: number): AgentItem[] => Array.from({ length: n }, (_v, i) => ({ id: `shape:i${i + 1}`, kind: i % 3 === 0 ? 'text' : 'rect', box: [0, i * 60, 100, 50] as const, ...(i % 3 === 0 ? { text: `note number ${i}` } : {}) }));

const WRITES = Array.from({ length: 20 }, (_v, i) => ({ op: 'write', text: `n${i}`, at: { near: 'shape:i1', side: 'right' } }));

describe('board jobs, Node, warm, fake model', () => {
  const set = must(toolset(['board_read', 'board']));

  it('board_read of 60 items in under 1 ms', async () => {
    const target = boardTarget({ page: 'page:1', items: items(60), more: 0 });
    const ms = await best(() => {
      set.call(target, 'board_read', {});
    });
    report('board_read, 60 items', ms, 1);
    expect(ms).toBeLessThan(1);
  });

  it('board_read of an area of 600 items (cut at 60) in under 1 ms', async () => {
    const target = boardTarget({ page: 'page:1', items: items(600), more: 0 });
    const ms = await best(() => {
      set.call(target, 'board_read', { area: [-10, -10, 200, 100_000] });
    });
    report('board_read, 600 items in the area', ms, 1);
    expect(ms).toBeLessThan(1);
  });

  it('the checks of a board call of 20 actions in under 2 ms', async () => {
    const target = boardTarget({ page: 'page:1', items: items(60), more: 0 });
    const ms = await best(() => {
      set.call(target, 'board', { actions: WRITES });
    });
    report('board, 20 write actions checked', ms, 2);
    expect(ms).toBeLessThan(2);
  });

  it('the checks of a board call of 20 actions with edit refusals in under 2 ms', async () => {
    const target = boardTarget({ page: 'page:1', items: items(60), more: 0 });
    const actions = Array.from({ length: 20 }, (_v, i) => (i % 2 === 0 ? { op: 'delete', id: `shape:i${i + 1}` } : { op: 'mark', target: `shape:i${i + 1}`, how: 'circle' }));
    const ms = await best(() => {
      set.call(target, 'board', { actions });
    });
    report('board, 20 actions, half refused', ms, 2);
    expect(ms).toBeLessThan(2);
  });

  it('a figure action of 5 lines on a headless app in under 5 ms', async () => {
    const target = boardTarget({ page: 'page:1', items: items(5), more: 0 });
    const action = { op: 'figure', lines: ['a = 1', 'b = a + 1', 'f(x) = x^2', 'g(x) = f(x) + b', 'c = Circle((0, 0), 2)'], mode: 'graphing', at: 'free' };
    const ms = await best(() => {
      set.call(target, 'board', { actions: [action] });
    }, 30, 5);
    report('board, one figure of 5 lines', ms, 5);
    expect(ms).toBeLessThan(5);
  });

  for (const job of ['circle', 'talk'] as const) {
    it(`build a ${job} prompt with 60 items (catalogue cached) in under 2 ms`, async () => {
      must(catalogueFor('graphing'));
      const target = boardTarget({ page: 'page:1', items: items(60), more: 0 });
      const ms = await best(() => {
        must(buildPrompt(job, target, { text: 'Graph what is circled.', instruction: 'Graph it.' }, { tools: ['board_read', 'board'] }));
      });
      report(`buildPrompt ${job} / 60 items`, ms, 2);
      expect(ms).toBeLessThan(2);
    });
  }

  it('boardTurn overhead per model call (prompt build excluded) in under 1 ms', async () => {
    const calls = 7;
    const replies: RecordedReply[] = [...Array.from({ length: calls }, () => ({ toolCalls: [{ name: 'board_read', args: {} }] })), { toolCalls: [{ name: 'board', args: { actions: [WRITES[0]] } }] }, { text: 'Done.' }];
    const request = { kind: 'talk' as const, text: 'Hello', items: items(60), more: 0, page: 'page:1', allowEdit: false };
    const turn = async (): Promise<void> => {
      for await (const e of boardTurn({ client: fakeModel(replies), request, now: () => 0, limits: { modelCalls: 20 } })) void e;
    };
    const target = boardTarget({ page: 'page:1', items: request.items, more: 0 });
    const buildMs = await best(() => {
      must(buildPrompt('talk', target, { text: 'Hello' }, { tools: ['board_read', 'board'] }));
    });
    const turnMs = await best(turn, 30, 5);
    const perCall = Math.max(0, turnMs - buildMs) / (calls + 2);
    report('boardTurn overhead per model call', perCall, 1);
    expect(perCall).toBeLessThan(1);
  });
});
