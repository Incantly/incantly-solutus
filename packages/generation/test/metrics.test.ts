import { describe, expect, it } from 'vitest';
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
  });

  it('takes percentiles of the values it has', () => {
    expect(spread([5, 1, 4, 2, 3])).toEqual({ count: 5, p50: 3, p90: 5, max: 5, mean: 3 });
    expect(spread([])).toEqual({ count: 0, p50: null, p90: null, max: null, mean: null });
  });
});
