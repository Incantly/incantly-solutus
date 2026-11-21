/**
 * Spreadsheet benchmarks against the targets of docs/features/spreadsheet/design.md 4 (Node, warm).
 *
 * Run: `npx vitest run --config packages/kernel/bench/vitest.config.ts`. Each case is a test that fails when it misses its
 * target. Warm cases take the best of several runs. The figure's object limit is raised to the 20,000 cells of design 3.6 (the default figure holds 5,000 objects).
 */
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, applyPaste, applyPlan, planFill, geometry, registerFunctions, registerLists, registerNumbers, registerSheet, registerStatistics } from '../src/index';

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
  it('fill 9,999 cells as one batch (design 3.9, 4): planning under 20 ms, applying under 100 ms', { retry: 2, timeout: 60_000 }, () => {
    const best = { values: Infinity, plan: Infinity, apply: Infinity };
    // warm runs on fresh figures; the number is the best run, as for the other benches
    for (let run = 0; run < 12; run++) {
      const f = sheet();
      best.values = Math.min(best.values, time(() => expect(f.apply('FillCells(A1, Seq(k, k, 1, 9999))').ok).toBe(true)));
      f.apply('B1 = A1 * 2');
      let plan: ReturnType<typeof planFill> | undefined;
      best.plan = Math.min(best.plan, time(() => (plan = planFill(f, { c0: 2, r0: 1, c1: 2, r1: 1 }, { c0: 2, r0: 2, c1: 2, r1: 9999 }, 'down'))));
      let ok = false;
      best.apply = Math.min(best.apply, time(() => (ok = applyPlan(f, (plan as ReturnType<typeof planFill>).lines, 'FillDown', 'filled').ok)));
      expect(ok).toBe(true);
      expect(f.value('B9999')).toBe(19998);
    }
    console.log(`FillCells 9,999 values: ${best.values.toFixed(0)} ms; FillDown 9,998 formulas: plan ${best.plan.toFixed(0)} ms, apply ${best.apply.toFixed(0)} ms`);
    expect(best.values).toBeLessThan(100);
    expect(best.plan).toBeLessThan(20);
    expect(best.apply).toBeLessThan(100);
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
