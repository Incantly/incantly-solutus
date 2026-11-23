/**
 * Round 2 row of teacher design 10, with the fake model so only our code is measured: the splitter and the apply, per
 * streamed line, in under 1 ms with the kernel's line (the line is applied at its newline).
 *
 * Run: `npx vitest run --config packages/teacher/bench/vitest.config.ts`. Each case is a test that fails when it misses
 * its target; the number is the best of several warm runs. Node, no network.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createHeadlessApp } from '@incantly/sdk';
import { LineSplitter, fakeModel, figureTarget, splitLines, streamFigure } from '../src/index';

type Mode = NonNullable<NonNullable<Parameters<typeof createHeadlessApp>[0]>['mode']>;

const report = (name: string, value: number, unit: string, target: number): void => {
  process.stdout.write(`${value <= target ? 'ok  ' : 'MISS'}  ${name.padEnd(52)} ${value.toFixed(4).padStart(10)} ${unit}   target ${target} ${unit}\n`);
};

const LINES = 40;
const lines = Array.from({ length: LINES }, (_, i) => `n${i} = ${i} + 1`);

async function drain(mode: Mode, pieces: readonly string[]): Promise<number> {
  const target = figureTarget(createHeadlessApp({ mode }));
  const client = fakeModel([{ pieces }]);
  const t0 = performance.now();
  let count = 0;
  for await (const ev of streamFigure({ client, target, request: { text: 'bench' }, now: () => 0, plan: 'never' })) if ('lines' in ev) count += ev.lines.length;
  const ms = performance.now() - t0;
  expect(count).toBe(LINES);
  return ms;
}

async function best(run: () => Promise<number>, runs = 15, warm = 3): Promise<number> {
  for (let i = 0; i < warm; i++) await run();
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) min = Math.min(min, await run());
  return min;
}

describe('teacher design 10: splitter and apply per streamed line, fake model', () => {
  for (const mode of ['graphing', 'geometry'] as const satisfies readonly Mode[]) {
    it(`a line a piece, ${mode}: under 1 ms a line`, async () => {
      const ms = await best(() => drain(mode, lines.map((l) => `${l}\n`)));
      report(`splitter + apply per line (${mode}, piece a line)`, ms / LINES, 'ms', 1);
      expect(ms / LINES).toBeLessThan(1);
    });

    it(`pieces of 3 characters, ${mode}: under 1 ms a line`, async () => {
      const text = `${lines.join('\n')}\n`;
      const pieces = text.match(/[\s\S]{1,3}/g) ?? [];
      const ms = await best(() => drain(mode, pieces));
      report(`splitter + apply per line (${mode}, 3-char pieces)`, ms / LINES, 'ms', 1);
      expect(ms / LINES).toBeLessThan(1);
    });
  }

  it('the splitter alone: 10,000 lines of 40 characters in under 1 ms a line', () => {
    const text = `${'a = b + c * d - e / f + g;'.padEnd(39, ' ')}\n`.repeat(10_000);
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      expect(splitLines(text)).toHaveLength(10_000);
      min = Math.min(min, performance.now() - t0);
    }
    report('splitter alone, per line', min / 10_000, 'ms', 1);
    expect(min / 10_000).toBeLessThan(1);
  });

  it('the splitter takes a piece in a constant time however long the line pending is', () => {
    const s = new LineSplitter();
    const t0 = performance.now();
    for (let i = 0; i < 20_000; i++) s.push('x');
    const ms = performance.now() - t0;
    report('20,000 one-character pieces of one line', ms, 'ms', 200);
    expect(ms).toBeLessThan(200);
  });
});
