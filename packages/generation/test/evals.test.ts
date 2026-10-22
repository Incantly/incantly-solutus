import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { loadEvalPrompts } from '../src/eval-prompts';
import { checkExpectations, planTrials, runEvals, summaryMarkdown, wilson } from '../src/evals';
import { Generator } from '../src/pipeline';
import { isolatedProbe } from '../src/probe';
import { JsonlRecords, MemoryRecords, failureRecord } from '../src/records';
import { FAULTS, conceptFor, referenceModel } from '../src/reference-model';

const prompts = loadEvalPrompts();

describe('pass-rate intervals', () => {
  it('computes the Wilson score interval', () => {
    const r = wilson(85, 100);
    expect(r.rate).toBe(0.85);
    expect(r.low).toBeCloseTo(0.7672, 3);
    expect(r.high).toBeCloseTo(0.9069, 3);
    expect(wilson(0, 0)).toMatchObject({ low: 0, high: 1 });
    expect(wilson(10, 10).high).toBe(1);
  });

  it('narrows from about ±9 points at 60 trials to about ±4 at 300, as the plan says', () => {
    const sixty = wilson(51, 60);
    const three = wilson(255, 300);
    expect((sixty.high - sixty.low) / 2).toBeCloseTo(0.09, 1);
    expect((three.high - three.low) / 2).toBeCloseTo(0.04, 1);
  });
});

describe('the eval trials', () => {
  it('plans 100 trials per concept in each condition, cycling through the phrasings', () => {
    const trials = planTrials(prompts, { trialsPerConcept: 100, conditions: ['with-example', 'example-withheld'] });
    // The twelve launch concepts (PRD 17.8, EX-2).
    expect(prompts.concepts).toHaveLength(12);
    expect(trials).toHaveLength(2400);
    const withheld = trials.filter((t) => t.condition === 'example-withheld');
    expect(withheld).toHaveLength(1200);
    const sine = trials.filter((t) => t.concept.id === 'sine-wave' && t.condition === 'with-example');
    expect(new Set(sine.map((t) => t.phrasing)).size).toBe(prompts.concepts.find((c) => c.id === 'sine-wave')!.phrasings.length);
  });

  it('checks a plan against what the eval set expects of its concept', () => {
    for (const concept of prompts.concepts) {
      const scene = REFERENCE_SCENES[concept.example]!;
      expect(checkExpectations(scene.plan, concept, scene.js), concept.id).toEqual([]);
    }
    const lens = prompts.concepts.find((c) => c.id === 'thin-lens')!;
    const plan = { ...REFERENCE_SCENES['thin-lens']!.plan, singularPoints: [] };
    expect(checkExpectations(plan, lens, '')).toEqual(['no readout of image distance or v or di', 'no singular point declared']);
    expect(checkExpectations(null, lens, null)).toEqual(['no plan']);
  });
});

describe('running the evals', () => {
  it('uses a reference model that reads every eval phrasing as its concept', () => {
    for (const concept of prompts.concepts) {
      for (const phrasing of concept.phrasings) expect(conceptFor(phrasing)?.id, phrasing).toBe(concept.example);
    }
  });

  it('reports pass rates, latency and tokens, with each concept withheld from its own context', async () => {
    const seen: number[] = [];
    const { trials, summary } = await runEvals({
      model: referenceModel(),
      trialsPerConcept: 1,
      concurrency: 3,
      onTrial: (_, done) => seen.push(done),
    });
    const total = prompts.concepts.length * 2;
    expect(trials).toHaveLength(total);
    expect(seen).toHaveLength(total);
    expect(summary.firstAttempt).toMatchObject({ passed: total, total, rate: 1 });
    expect(summary.postRepair.rate).toBe(1);
    expect(summary.brokenShown).toBe(0);
    expect(summary.gate).toEqual({ firstAttempt: true, postRepair: true, noBrokenFigures: true, confident: false });
    expect(Object.keys(summary.byConcept).sort()).toEqual(prompts.concepts.map((c) => c.id).sort());
    expect(Object.keys(summary.byCondition).sort()).toEqual(['example-withheld', 'with-example']);
    expect(summary.expectations.rate).toBe(1);
    // Every approved figure passes the offline checks: no 3D overlap out of order, no line end in mid-air (CH-2).
    expect(summary.offline).toEqual({ checked: total, depth: 0, looseEnds: 0 });
    expect(summary.tokens.perTrial).toBeGreaterThan(0);
    for (const trial of trials.filter((t) => t.condition === 'example-withheld')) {
      expect(trial.record.example).not.toBe(prompts.concepts.find((c) => c.id === trial.concept)!.example);
    }
  }, 60_000);

  it('shows no broken figure under fault injection, and counts every fallback', async () => {
    // Every trial carries a fault; every third repair changes nothing, so that trial must fall back.
    const fault = (trial: number) => FAULTS[trial % FAULTS.length]!;
    const { trials, summary } = await runEvals({
      model: referenceModel({ fault, stubborn: (trial) => trial % 3 === 2 }),
      trialsPerConcept: 9,
      conditions: ['with-example'],
      concepts: ['sine-wave', 'projectile-motion', 'thin-lens'],
      concurrency: 1,
    });
    expect(summary.brokenShown).toBe(0);
    expect(trials.every((t) => !t.broken)).toBe(true);
    // Only a bad plan is fixed before the scene, so it alone can pass first time.
    expect(trials.filter((t) => t.firstAttempt).every((t) => t.record.planProblems.length === 0)).toBe(true);
    const stubborn = trials.filter((t) => t.index % 3 === 2 && FAULTS[t.index % FAULTS.length] !== 'bad-plan');
    for (const trial of stubborn) expect(trial.passed, `${trial.index}`).toBe(false);
    expect(trials.every((t) => t.repairs <= 1)).toBe(true);
    expect(summary.postRepair.passed).toBe(trials.filter((t) => t.passed).length);
    expect(Object.values(summary.failures).reduce((a, b) => a + b, 0)).toBe(trials.filter((t) => !t.passed).length);
    expect(summary.gate.postRepair).toBe(false);
  }, 30_000);

  it('writes a readable summary', async () => {
    const { summary } = await runEvals({ model: referenceModel(), trialsPerConcept: 1, conditions: ['with-example'] });
    const text = summaryMarkdown(summary);
    expect(text).toContain('# Generation evals: reference, prompts v1');
    expect(text).toContain('| First attempt | 100.0% (95% CI ');
    expect(text).toContain('| Broken figures shown | 0 | none |');
    expect(text).toMatch(/\| Offline checks \(CH-2\) \| of \d+ approved figures, 0 drew a 3D overlap out of order and 0 left a line end in mid-air \| reported \|/);
    // The stand-in model reports no cache use; the real one reports it in its usage fields.
    expect(text).toContain('Prompt cache: the fixed context was read from the cache in 0.0% of trials.');
  });
});

describe('offline checks in the evals (CH-2)', () => {
  it('counts the approved figures the offline checks find fault with, without failing them', async () => {
    const at: readonly [number, number] = [10, 20];
    const { trials, summary } = await runEvals({
      model: referenceModel(),
      trialsPerConcept: 2,
      conditions: ['with-example'],
      concepts: ['sine-wave'],
      offline: async (_, plan) => ({
        ok: false,
        turns: 60,
        violations: [{ under: 'a solid', over: 'a sphere', area: 12, at, stage: 1, turn: { yaw: 30, pitch: 45 } }],
        crossing: 0,
        ring: 0,
        looseEnds: plan.kind === 'diagram' ? [] : [{ stage: 1, element: 4, kind: 'line', at }],
      }),
    });
    expect(trials.every((t) => t.passed)).toBe(true);
    expect(trials.map((t) => t.offline)).toEqual([
      { depth: 1, looseEnds: 1 },
      { depth: 1, looseEnds: 1 },
    ]);
    expect(summary.offline).toEqual({ checked: 2, depth: 2, looseEnds: 2 });
    // Skipped, they report nothing.
    const skipped = await runEvals({ model: referenceModel(), trialsPerConcept: 1, conditions: ['with-example'], concepts: ['sine-wave'], offline: null });
    expect(skipped.trials[0]!.offline).toBeNull();
    expect(skipped.summary.offline).toEqual({ checked: 0, depth: 0, looseEnds: 0 });
  }, 30_000);
});

describe('failure records', () => {
  it('keep the plan, the fragments before and after, the reports and the outcome, and never the request', async () => {
    const prompt = 'My notes say the vertical velocity is zero at the top. Show me that.';
    const state = await new Generator({ model: referenceModel({ fault: 'frame-throw' }), probe: isolatedProbe }).generate({ prompt });
    const record = failureRecord(state, 'process', new Date('2026-10-21T10:00:00Z'));
    expect(record).toMatchObject({ outcome: 'repaired', probedOn: 'process', concept: 'projectile motion', repairs: 1, at: '2026-10-21T10:00:00.000Z' });
    expect(record.before?.js).toContain('recent[2].at(0, 0)');
    expect(record.after?.js).toBe(REFERENCE_SCENES.projectile!.js);
    expect(record.reports.map((r) => r.check)).toEqual(['runs']);
    expect(record.models).toEqual(['reference-plan', 'reference-scene', 'reference-repair']);
    expect(JSON.stringify(record)).not.toContain('vertical velocity is zero at the top');
  });

  it('records a clean first attempt without fragments', async () => {
    const state = await new Generator({ model: referenceModel(), probe: isolatedProbe }).generate({ prompt: 'sine wave' });
    const record = failureRecord(state, 'process');
    expect(record).toMatchObject({ outcome: 'first-attempt', before: null, after: null, reports: [] });
    const sink = new MemoryRecords();
    await sink.write(record);
    expect(sink.records).toHaveLength(1);
  });

  it('are kept as daily JSON lines for the retention period, then purged', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'incantly-records-'));
    const sink = new JsonlRecords(directory, 30);
    const state = await new Generator({ model: referenceModel(), probe: isolatedProbe }).generate({ prompt: 'thin lens' });
    await sink.write(failureRecord(state, 'process', new Date('2026-10-21T08:00:00Z')));
    await sink.write(failureRecord(state, 'process', new Date('2026-10-21T09:00:00Z')));
    await writeFile(join(directory, 'records-2026-08-01.jsonl'), '{}\n');
    await writeFile(join(directory, 'notes.txt'), 'not a record');
    const lines = (await readFile(join(directory, 'records-2026-10-21.jsonl'), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ concept: 'thin lens' });
    expect(await sink.purge(new Date('2026-10-21T12:00:00Z'))).toEqual(['records-2026-08-01.jsonl']);
    expect((await readdir(directory)).sort()).toEqual(['notes.txt', 'records-2026-10-21.jsonl']);
  });
});
