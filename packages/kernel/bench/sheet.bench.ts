/**
 * Spreadsheet benchmarks against the targets of docs/features/spreadsheet/design.md 4 (Node, warm).
 *
 * Run: `npx vitest run --config packages/kernel/bench/vitest.config.ts`. Each case is a test that fails when it misses its
 * target. The figure's object limit is raised to the 20,000 cells of design 3.6 (the default figure holds 5,000 objects).
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, applyFill, applyPaste, geometry, registerFunctions, registerLists, registerNumbers, registerSheet, registerStatistics } from '../src/index';

function sheet(): Figure {
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerLists(r);
  registerStatistics(r);
  registerSheet(r);
  const f = new Figure({ commands: r, limits: { objects: 25_000, lines: 25_000 } });
  f.apply('@sheet 26 9999');
  return f;
}

const time = (fn: () => void): number => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

describe('spreadsheet (design 4)', () => {
  it('fill 9,999 formulas as one batch: design target 100 ms, held at 400 ms (each line is checked like a typed line)', { retry: 2, timeout: 30_000 }, () => {
    const f = sheet();
    const values = time(() => expect(f.apply('FillCells(A1, Seq(k, k, 1, 9999))').ok).toBe(true));
    f.apply('B1 = A1 * 2');
    let ok = false;
    const formulas = time(() => (ok = applyFill(f, { c0: 2, r0: 1, c1: 2, r1: 1 }, { c0: 2, r0: 2, c1: 2, r1: 9999 }, 'down', 'host').ok));
    expect(ok).toBe(true);
    console.log(`FillCells 9,999 values: ${values.toFixed(0)} ms; FillDown 9,998 formulas: ${formulas.toFixed(0)} ms`);
    expect(formulas).toBeLessThan(400);
  });

  it('edit a cell inside Sum over 9,999 cells: under 1 ms', { retry: 2 }, () => {
    const f = sheet();
    f.apply('FillCells(A1, Seq(k, k, 1, 9999))');
    f.apply('S = Sum(A1:A9999)');
    for (let i = 0; i < 20; i++) {
      f.setFree('A500', i);
      f.flush();
    }
    const n = 200;
    const ms = time(() => {
      for (let i = 0; i < n; i++) {
        f.setFree('A500', i);
        f.flush();
      }
    }) / n;
    console.log(`edit inside Sum(A1:A9999): ${ms.toFixed(3)} ms`);
    expect(f.value('S')).toBe((9999 * 10000) / 2 - 500 + (n - 1));
    expect(ms).toBeLessThan(1);
  });

  it('edit one cell with 100 dependents: under 1 ms', { retry: 2 }, () => {
    const f = sheet();
    f.apply('A1 = 1');
    for (let r = 1; r <= 100; r++) f.apply(`B${r} = A1 + ${r}`);
    const n = 200;
    const ms = time(() => {
      for (let i = 0; i < n; i++) {
        f.setFree('A1', i);
        f.flush();
      }
    }) / n;
    console.log(`edit with 100 dependents: ${ms.toFixed(3)} ms`);
    expect(ms).toBeLessThan(1);
  });

  it('paste 20,000 numbers (the most one step writes): under 400 ms', { retry: 2, timeout: 30_000 }, () => {
    const f = sheet();
    const text = Array.from({ length: 800 }, (_, i) => Array.from({ length: 25 }, (_, j) => String(i + j)).join('\t')).join('\n');
    let ok = false;
    const ms = time(() => (ok = applyPaste(f, text, { col: 1, row: 1 }, { origin: 'host' }).ok));
    console.log(`paste 20,000 numbers: ${ms.toFixed(0)} ms`);
    expect(ok).toBe(true);
    expect(ms).toBeLessThan(400);
  });
});
