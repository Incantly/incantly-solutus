import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CLOSED_CLASSES, closureFor } from '../src/closed';
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
    expect(board.recurring[0]).toMatchObject({ closures: [], open: 2 });
    expect(text).toMatch(/\| runs \| 2 \| projectile motion \| .* \| open \|/);
    expect(text).toContain('Open: runs. Close each with a kit function');
  });

  it('marks a recurring failure by what closed its class, failure by failure (RP-12)', () => {
    const record = (check: string, words: string): FailureRecord =>
      ({ ...failureRecordOf(), reports: [{ check, summary: `${check}: ${words}`, kind: 'probe', text: `FAILURE  ${check}: ${words}` }] }) as unknown as FailureRecord;
    // An engine behaviour closed the whole class.
    const paused = dashboard([record('paused-change', 'the drawing did not change'), record('paused-change', 'the drawing did not change')]);
    expect(paused.recurring[0]).toMatchObject({ open: 0, closures: [{ closure: { by: 'engine', check: 'paused-change' }, count: 2 }] });
    expect(dashboardText(paused)).toContain('| closed by engine: A parameter changed while paused redraws once with dt = 0');
    expect(dashboardText(paused)).toContain('Every recurring failure has a kit function or an engine behaviour against it');
    // A broad check is closed only for the failures a closure names: mount covers every throw at mount.
    const mount = dashboard([
      record('mount', 'That element can already be dragged at js:12:3'),
      record('mount', "Cannot read properties of undefined (reading 'x') at js:20:5"),
      record('mount', "Cannot read properties of undefined (reading 'y') at js:21:5"),
    ]);
    expect(mount.recurring[0]).toMatchObject({ count: 3, open: 2, closures: [{ count: 1 }] });
    expect(dashboardText(mount)).toContain('| partly closed by engine (1 of 3): A later drag on an element says how it drags');
    expect(dashboardText(mount)).toContain('Open: mount.');
    const throws = dashboard([record('mount', 'Cannot read properties of undefined at js:2:1'), record('mount', 'x is not a function at js:3:1')]);
    expect(dashboardText(throws)).toMatch(/\| mount \| 2 \| .* \| open \|/);
    // A rule names a class but does not close it.
    const calls = dashboard([record('unknown-sdk-call', 'inc.calc.integrate is not part of the SDK'), record('unknown-sdk-call', 'inc.draw is not part of the SDK')]);
    expect(calls.recurring[0]).toMatchObject({ open: 2 });
    expect(dashboardText(calls)).toContain('| open, rule: Rule 13');
    expect(dashboardText(calls)).toContain('Open: unknown-sdk-call.');
  });

  it('keeps each closed class with the test that keeps it closed', () => {
    const packages = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    for (const closed of CLOSED_CLASSES) {
      const file = join(packages, closed.test.file);
      expect(existsSync(file), closed.test.file).toBe(true);
      expect(readFileSync(file, 'utf8'), closed.check).toContain(`it('${closed.test.name}'`);
    }
    expect(closureFor({ check: 'unknown-tone', summary: 'unknown-tone at js:4:30', text: 'ERROR    js:4:30 "water" is not a tone; use one of lo, mid' })).toMatchObject({ by: 'kit' });
    expect(closureFor({ check: 'unknown-tone', summary: 'unknown-tone at js:4:30', text: 'ERROR    js:4:30 "pink" is not a tone' })).toBeNull();
    expect(closureFor({ check: 'no-such-check', summary: '' })).toBeNull();
  });

  it('takes percentiles of the values it has', () => {
    expect(spread([5, 1, 4, 2, 3])).toEqual({ count: 5, p50: 3, p90: 5, max: 5, mean: 3 });
    expect(spread([])).toEqual({ count: 0, p50: null, p90: null, max: null, mean: null });
  });
});
