import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLOSED_CLASSES, closureOf } from '../src/closed';
import { dashboard, dashboardText, spread } from '../src/metrics';
import { Generator } from '../src/pipeline';
import { isolatedProbe } from '../src/probe';
import { failureRecord, type FailureRecord } from '../src/records';
import { referenceModel, type Fault } from '../src/reference-model';

async function records(faults: readonly Fault[]): Promise<FailureRecord[]> {
  const out: FailureRecord[] = [];
  for (const fault of faults) {
    const generate = new Generator({ model: referenceModel({ fault }), probe: isolatedProbe });
    const state = await generate.generate({ prompt: 'Explain projectile motion for a physics student.' });
    out.push(failureRecord(state, 'process'));
  }
  return out;
}

/** A settled record with nothing in it but what the dashboard reads. */
function failureRecordOf(): Record<string, unknown> {
  return { outcome: 'repaired', repairs: 1, mode: 'adapt', concept: 'pendulum', timings: {}, lines: null, cost: 0, deadlineSkipped: false };
}

describe('the generation dashboard (RP-13, PRD 25.7)', () => {
  it('summarises outcomes, modes, timings, lines and recurring failures', async () => {
    const list = await records(['none', 'none', 'frame-throw', 'frame-throw', 'colour']);
    const board = dashboard(list);
    expect(board.generations).toBe(5);
    expect(board.outcomes['first-attempt']).toBe(2);
    expect(board.outcomes.repaired).toBe(3);
    expect(board.firstAttemptRate).toBeCloseTo(0.4, 9);
    expect(board.repairShare).toBeCloseTo(0.6, 9);
    expect(board.adaptRate).toBe(1);
    expect(board.timings.totalMs.count).toBe(5);
    expect(board.lines.p50).toBeGreaterThan(20);
    // The frame fault happened twice: a candidate for a kit function or a rule (RP-12).
    expect(board.recurring.map((r) => r.check)).toEqual(['runs']);
    expect(board.recurring[0]).toMatchObject({ count: 2, concepts: ['projectile motion'] });
    const text = dashboardText(board);
    expect(text).toContain('First attempt passed: 40%');
    expect(text).toContain('| runs | 2 | projectile motion |');
    // Nothing has closed that class yet: it is the next to close (RP-12).
    expect(board.recurring[0]!.closed).toBeNull();
    expect(text).toMatch(/\| runs \| 2 \| projectile motion \| .* \| open \|/);
    expect(text).toContain('Open: runs. Close each with a kit function');
  });

  it('marks a recurring failure whose class a kit function, engine behaviour or rule has closed (RP-12)', () => {
    const record = (check: string): FailureRecord =>
      ({ ...failureRecordOf(), reports: [{ check, summary: `${check}: an example`, kind: 'probe', rules: [] }] }) as unknown as FailureRecord;
    const board = dashboard([record('paused-change'), record('paused-change')]);
    expect(board.recurring[0]!.closed).toMatchObject({ by: 'engine', check: 'paused-change' });
    const text = dashboardText(board);
    expect(text).toContain('| engine: A parameter changed while paused redraws once with dt = 0');
    expect(text).toContain('Every recurring failure has a kit function, an engine behaviour or a rule against it');
  });

  it('keeps each closed class with the test that keeps it closed', () => {
    const packages = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    expect(new Set(CLOSED_CLASSES.map((c) => c.check)).size).toBe(CLOSED_CLASSES.length);
    for (const closed of CLOSED_CLASSES) {
      const file = join(packages, closed.test.file);
      expect(existsSync(file), closed.test.file).toBe(true);
      expect(readFileSync(file, 'utf8'), closed.check).toContain(`it('${closed.test.name}'`);
      expect(closureOf(closed.check)).toBe(closed);
    }
    expect(closureOf('no-such-check')).toBeNull();
  });

  it('takes percentiles of the values it has', () => {
    expect(spread([5, 1, 4, 2, 3])).toEqual({ count: 5, p50: 3, p90: 5, max: 5, mean: 3 });
    expect(spread([])).toEqual({ count: 0, p50: null, p90: null, max: null, mean: null });
  });
});
