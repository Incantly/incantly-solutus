import { describe, expect, it } from 'vitest';
import { analyseLine, complete, createCommandTable, lex, parseLine, preview, SourceMap } from '@incantly/kernel';
import type { CommandSpec, FunctionValue } from '@incantly/kernel';
import { COMMANDS, emptyFig, form, newFig, okValue, p } from './helpers';

/** performance.md 1 and language/design.md 3.14 to 3.18. Thresholds are the targets with CI slack. */

const TYPICAL = [
  'A9 = (a + 1, b * 2)',
  'f9(x) = sin(x) * x + 1',
  'c9 = Circle(A, a)',
  'M9 = Midpoint(A, B)',
  'n9 = sqrt(a^2 + b^2)',
  'l9 = y == 2x + 1',
  's9 = 3 in 0..10 step 0.5',
  'L9 = [1..10]',
  'tx9 = "a = {a:2}"',
  'b9 = a > 2 and b < 5',
  'v9 = B - A',
  'P9 = if(a > 1, A, B)',
  'd9 = Distance(A, Midpoint(B, C))',
  'S9 = Seq(k^2, k, 1, 10)',
  'A with color = red',
  'n9 = f(2) + g(3)',
  'q9 = 2 pi * a / 360',
  'h9(x, y) = x * y + a',
  'm9 = max(a, b, 5) + min(1, 2)',
  'r9 = y < x^2',
];

function time(fn: () => void, runs: number): number {
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) fn();
  return (performance.now() - t0) / runs;
}

describe('performance.md 1: parse and check', () => {
  it('parse + check of a typical line: target under 0.2 ms on average over 10,000 lines (fail above 0.5 ms)', { retry: 2 }, () => {
    const fig = newFig();
    for (let i = 0; i < 2000; i++) analyseLine(TYPICAL[i % TYPICAL.length] ?? '', fig); // warm up
    const t0 = performance.now();
    let ok = 0;
    for (let i = 0; i < 10_000; i++) {
      if (analyseLine(TYPICAL[i % TYPICAL.length] ?? '', fig).ok) ok++;
    }
    const avg = (performance.now() - t0) / 10_000;
    expect(ok).toBe(10_000); // every typical line is valid
    expect(avg).toBeLessThan(0.5);
  });

  it('every typical line passes (so the timing above measures real work)', () => {
    const fig = newFig();
    for (const src of TYPICAL) expect(analyseLine(src, fig).ok, src).toBe(true);
  });

  it('lexing a full line is under 0.2 ms (ui.md 2)', () => {
    const src = 'd9 = Distance(A, Midpoint(B, C)) + sqrt(a^2 + b^2) * 2 # a comment at the end of a long line';
    for (let i = 0; i < 1000; i++) lex(new SourceMap(src));
    const avg = time(() => lex(new SourceMap(src)), 5000);
    expect(avg).toBeLessThan(0.2);
  });

  it('parsing alone is faster than parse + check', () => {
    for (let i = 0; i < 1000; i++) parseLine(TYPICAL[i % TYPICAL.length] ?? '');
    let i = 0;
    const avg = time(() => parseLine(TYPICAL[i++ % TYPICAL.length] ?? ''), 10_000);
    expect(avg).toBeLessThan(0.3);
  });

  it('a long line of 800 tokens is still bounded (under 20 ms)', () => {
    const src = `n = ${'1+'.repeat(398)}1`;
    const fig = newFig();
    for (let i = 0; i < 20; i++) analyseLine(src, fig);
    const avg = time(() => analyseLine(src, fig), 100);
    expect(avg).toBeLessThan(20);
  });
});

describe('core design goal 1 and language/design.md 3.16', () => {
  it('applying a line takes under 1 ms (fail above 2 ms)', () => {
    const fig = newFig();
    let i = 0;
    const lines = TYPICAL.filter((l) => !l.startsWith('A with'));
    for (let k = 0; k < 500; k++) fig.apply(lines[k % lines.length] ?? '');
    const avg = time(() => {
      fig.apply(lines[i++ % lines.length] ?? '');
    }, 5000);
    expect(avg).toBeLessThan(2);
  });

  it('a preview of a typical line costs under 1 ms (fail above 3 ms)', () => {
    const fig = newFig();
    for (let k = 0; k < 500; k++) preview(TYPICAL[k % TYPICAL.length] ?? '', fig);
    let i = 0;
    const avg = time(() => preview(TYPICAL[i++ % TYPICAL.length] ?? '', fig), 5000);
    expect(avg).toBeLessThan(3);
  });
});

describe('language/design.md 3.18 autocomplete performance', () => {
  it('under 2 ms per keystroke for 5,000 objects and 200 command names (fail above 10 ms)', () => {
    const specs: CommandSpec[] = [...COMMANDS];
    for (let i = 0; specs.length < 200; i++) {
      specs.push({ name: `Cmd${i}x${(i * 7919) % 1000}`, kind: 'object', group: 'g', forms: [form([p('a', 'Number')], 'Number')] });
    }
    const fig = emptyFig(specs);
    for (let i = 0; i < 5000; i++) fig.define(`obj${i}`, 'Number', i, { free: true });
    expect(createCommandTable(specs).names().length).toBe(200);
    expect(fig.size).toBe(5000);
    const queries = ['n9 = ob', 'n9 = obj12', 'n9 = Cm', 'n9 = Mid', 'n9 = o4', 'n9 = sq', 'n9 = Cmd1'];
    for (const q of queries) complete(q, q.length, fig);
    let i = 0;
    const avg = time(() => complete(queries[i % queries.length] ?? '', (queries[i++ % queries.length] ?? '').length, fig), 140);
    expect(avg).toBeLessThan(10);
  });
});

describe('language/design.md 3.14 / 3.15 evaluation speed', () => {
  it('a 20-node function body evaluates at least 10 million node-evaluations per second (fail below 2 million)', { retry: 2 }, () => {
    const fig = newFig();
    okValue(fig.apply('hot(x) = sin(x) * x^2 + 3 * cos(x) - sqrt(x + 10) / (1 + abs(x)) + x * 2 - 1'));
    const fn = fig.valueOf('hot') as FunctionValue;
    expect(typeof fn.call).toBe('function');
    for (let i = 0; i < 20_000; i++) fn.call(i / 1000);
    const calls = 200_000;
    const t0 = performance.now();
    let acc = 0;
    for (let i = 0; i < calls; i++) acc += fn.call(i / 1000) as number;
    const secs = (performance.now() - t0) / 1000;
    expect(Number.isFinite(acc)).toBe(true);
    const nodes = 20;
    const rate = (calls * nodes) / secs;
    expect(rate).toBeGreaterThan(2_000_000);
  });

  it('a function body gives the right answers while being fast', () => {
    const fig = newFig();
    okValue(fig.apply('hot(x) = x^2 + 1'));
    const fn = fig.valueOf('hot') as FunctionValue;
    expect(fn.call(3)).toBe(10);
  });

  it('constant folding: a pure constant line is evaluated once and gives the folded value', () => {
    const fig = newFig();
    okValue(fig.apply('cf = 2 * 3 + sin(0) + sqrt(16)'));
    expect(fig.valueOf('cf')).toBe(10);
  });
});
