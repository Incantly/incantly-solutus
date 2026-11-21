/**
 * Round-5 rows for the agent tools (docs/features/board/agent.md; design 13 gives no row for them, so the targets here
 * are one frame, 16 ms, for what a model's call does on the main thread): `board_read` on a page of 10,000 shapes, a
 * 20-action answer applied, and placing a shape `near` another with 2,000 shapes around it.
 *
 * Run: `npx vitest run --config packages/board/bench/vitest.config.ts`. Each case is a test that fails when it misses its
 * target; the number is the best of several warm runs. Measured on the core alone (Node, no canvas).
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createBoard, putNewShape } from '../src/index';
import type { Board, BoardResult } from '../src/index';

const must = <T>(r: BoardResult<T>): T => {
  if (!r.ok) throw new Error(`${r.kind}: ${r.message}`);
  return r.value;
};

/** A headless board with `n` rects on its page, in a grid of 100 columns, 60 units apart. */
function boardWith(n: number): Board {
  const board = must(createBoard({ agent: { reducedMotion: true } }));
  const { core } = board;
  const page = core.pages.current as string;
  must(
    core.store.change('host', (tx) => {
      for (let i = 0; i < n; i++) {
        const r = putNewShape(tx, core.store, { kind: 'rect', page, x: (i % 100) * 60, y: Math.floor(i / 100) * 50, props: { w: 40, h: 30 } });
        if (!r.ok) throw new Error(r.message);
      }
    }, { history: false }),
  );
  return board;
}

/** A headless board with `n` rects packed over the view (40 by 30 units, 20 by 15 apart): no spot in view is free. */
function packedBoard(n: number): Board {
  const board = must(createBoard({ agent: { reducedMotion: true } }));
  const { core } = board;
  const page = core.pages.current as string;
  must(
    core.store.change('host', (tx) => {
      for (let i = 0; i < n; i++) {
        const r = putNewShape(tx, core.store, { kind: 'rect', page, x: (i % 64) * 20, y: Math.floor(i / 64) * 15, props: { w: 40, h: 30 } });
        if (!r.ok) throw new Error(r.message);
      }
    }, { history: false }),
  );
  return board;
}

/** Best of `runs` timed calls after `warm` warm-up calls, in ms. */
async function best(fn: () => Promise<void> | void, runs = 12, warm = 3): Promise<number> {
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
  process.stdout.write(`${value <= target ? 'ok  ' : 'MISS'}  ${name.padEnd(46)} ${value.toFixed(3).padStart(10)} ${unit}   target ${target} ${unit}\n`);
};

const FRAME_MS = 16;

describe('board agent tools (agent.md), Node, warm', () => {
  it('board_read of an area holding 10,000 shapes (60 listed, the rest counted) in under 16 ms', async () => {
    const board = boardWith(10_000);
    const runner = board.agent.runner;
    const area = [-10, -10, 7000, 5000];
    const first = must(runner.read({ area }));
    expect(first.items).toHaveLength(60);
    expect(first.more).toBe(9940);
    const ms = await best(() => {
      must(runner.read({ area }));
    });
    report('board_read, 10,000 shapes in the area', ms, 'ms', FRAME_MS);
    expect(ms).toBeLessThan(FRAME_MS);
  });

  it('board_read of the visible part of a page of 10,000 shapes in under 16 ms', async () => {
    const board = boardWith(10_000);
    const runner = board.agent.runner;
    const ms = await best(() => {
      must(runner.read());
    });
    report('board_read, default view, 10,000 shapes on page', ms, 'ms', FRAME_MS);
    expect(ms).toBeLessThan(FRAME_MS);
  });

  it('a 20-action answer applied (one call, 20 transactions) in under 16 ms', async () => {
    const board = boardWith(1000);
    const runner = board.agent.runner;
    const actions: unknown[] = [];
    for (let i = 0; i < 6; i++) actions.push({ op: 'shape', kind: 'rect', at: { x: 7000 + i * 150, y: 100 }, w: 100, h: 60 });
    for (let i = 0; i < 6; i++) actions.push({ op: 'write', text: `step ${i}: $x^2 + ${i}$`, at: { x: 7000 + i * 150, y: 300 }, style: 'typed' });
    for (let i = 0; i < 4; i++) actions.push({ op: 'shape', kind: 'ellipse', at: { x: 7000 + i * 150, y: 500 }, w: 100, h: 60, label: 'e' });
    actions.push({ op: 'mark', target: '$last', how: 'circle' });
    actions.push({ op: 'point', target: '$last' });
    actions.push({ op: 'camera', target: '$last' });
    actions.push({ op: 'shape', kind: 'sticky', at: { near: '$last', side: 'right' }, label: 'done' });
    expect(actions).toHaveLength(20);
    const once = async (): Promise<void> => {
      const results = must(await runner.run({ actions }));
      if (!results.every((r) => r.ok)) throw new Error(`an action failed: ${JSON.stringify(results.find((r) => !r.ok))}`);
      // the answer is taken back so each run starts from the same board
      must(board.core.history.undo());
    };
    const ms = await best(once);
    report('apply a 20-action answer (1,000 shapes on page)', ms, 'ms', FRAME_MS);
    expect(ms).toBeLessThan(FRAME_MS);
  });

  it('placing a shape near another with 2,000 shapes around it in under 16 ms', async () => {
    const board = boardWith(2000);
    const runner = board.agent.runner;
    // the target sits in the middle of the grid, so the right-hand spot is crowded and the search has to slide
    const items = must(runner.read({ area: [1500, 400, 80, 40] })).items;
    const target = items[0];
    if (target === undefined) throw new Error('no shape in the middle of the grid');
    const once = async (): Promise<void> => {
      const results = must(await runner.run({ actions: [{ op: 'shape', kind: 'rect', at: { near: target.id, side: 'right' }, w: 100, h: 60 }] }));
      if (!results[0]?.ok) throw new Error('the placement failed');
      must(board.core.history.undo());
    };
    const ms = await best(once);
    report('place near, 2,000 shapes around', ms, 'ms', FRAME_MS);
    expect(ms).toBeLessThan(FRAME_MS);
  });

  it("placing 'free' in a view with 2,000 shapes around in under 16 ms", async () => {
    const board = boardWith(2000);
    const runner = board.agent.runner;
    const once = async (): Promise<void> => {
      must(await runner.run({ actions: [{ op: 'shape', kind: 'rect', at: 'free', w: 100, h: 60 }] }));
      must(board.core.history.undo());
    };
    const ms = await best(once);
    report("place 'free', 2,000 shapes around", ms, 'ms', FRAME_MS);
    expect(ms).toBeLessThan(FRAME_MS);
  });

  it("placing 'free' in a view packed with 2,000 shapes (no spot left, the whole search runs) in under 16 ms", async () => {
    const board = packedBoard(2000);
    const runner = board.agent.runner;
    const once = async (): Promise<void> => {
      const results = must(await runner.run({ actions: [{ op: 'shape', kind: 'rect', at: 'free', w: 100, h: 60 }] }));
      if (!results[0]?.ok) throw new Error('the placement failed');
      must(board.core.history.undo());
    };
    const ms = await best(once);
    report("place 'free', view packed, 2,000 shapes", ms, 'ms', FRAME_MS);
    expect(ms).toBeLessThan(FRAME_MS);
  });
});
