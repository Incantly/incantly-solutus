/**
 * Round 4, the sentence splitter per streamed piece (teacher design 8, and design 10's splitter row: under 1 ms with the
 * fake model, so only our code is measured). Pieces of 3 characters are the worst case a stream can send; the splitter is run
 * over a lesson's worth of words.
 *
 * Run: `npx vitest run --config packages/teacher/bench/vitest.config.ts`. Each case is a test that fails when it misses its
 * target; the number is the best of several warm runs. Node, no network.
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { createHeadlessApp } from '@incantly/sdk';
import { SentenceSplitter, fakeModel, liveTurn } from '../src/index';

const report = (name: string, value: number, unit: string, target: number): void => {
  process.stdout.write(`${value <= target ? 'ok  ' : 'MISS'}  ${name.padEnd(52)} ${value.toFixed(5).padStart(10)} ${unit}   target ${target} ${unit}\n`);
};

const SENTENCES = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} says that x = ${i}.5, e.g. a decimal, and Dr. Lee agrees!`);
const TEXT = SENTENCES.join(' ');

const best = (run: () => number, runs = 25, warm = 5): number => {
  for (let i = 0; i < warm; i++) run();
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) min = Math.min(min, run());
  return min;
};

function splitIn(piece: number): { ms: number; pieces: number; sentences: number } {
  const pieces = TEXT.match(new RegExp(`[\\s\\S]{1,${piece}}`, 'g')) ?? [];
  const s = new SentenceSplitter();
  let count = 0;
  const t0 = performance.now();
  for (const p of pieces) count += s.push(p).length;
  count += s.flush().length;
  return { ms: performance.now() - t0, pieces: pieces.length, sentences: count };
}

describe('teacher design 8 and 10: the sentence splitter per piece', () => {
  for (const size of [3, 12, 60]) {
    it(`pieces of ${size} characters: under 1 ms a piece, and every sentence found`, () => {
      const probe = splitIn(size);
      expect(probe.sentences).toBe(SENTENCES.length);
      const ms = best(() => splitIn(size).ms);
      report(`sentence splitter per piece (${size} characters)`, ms / probe.pieces, 'ms', 1);
      expect(ms / probe.pieces).toBeLessThan(1);
    });
  }

  it('one very long text with no end, in pieces of 3 characters: no piece takes 1 ms (no quadratic rescan)', () => {
    const long = 'word '.repeat(4000);
    const pieces = long.match(/[\s\S]{1,3}/g) ?? [];
    const s = new SentenceSplitter();
    const t0 = performance.now();
    for (const p of pieces) s.push(p);
    s.flush();
    const per = (performance.now() - t0) / pieces.length;
    report('splitter, 20,000 characters with no end, 3-char pieces', per, 'ms', 1);
    expect(per).toBeLessThan(1);
  });

  it('liveTurn over a fake model, one model call of 30 sentences: under 5 ms in all', async () => {
    const run = async (): Promise<number> => {
      const app = createHeadlessApp({ mode: 'graphing' });
      const client = fakeModel([{ pieces: TEXT.match(/[\s\S]{1,5}/g) ?? [] }]);
      const t0 = performance.now();
      let said = 0;
      for await (const ev of liveTurn({ client, app, text: 'bench', now: () => 0 })) if ('say' in ev) said += 1;
      const ms = performance.now() - t0;
      expect(said).toBe(SENTENCES.length);
      return ms;
    };
    for (let i = 0; i < 5; i++) await run();
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 15; i++) min = Math.min(min, await run());
    report('liveTurn, one model call, 30 sentences', min, 'ms', 5);
    expect(min).toBeLessThan(5);
  });
});
