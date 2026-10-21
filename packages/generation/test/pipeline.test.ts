import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { ModelError, ScriptedModel } from '../src/models';
import { Generator, standardFigure, type FailedCheck } from '../src/pipeline';
import { isolatedProbe } from '../src/probe';
import { faultyScript, referenceModel, type Fault } from '../src/reference-model';

const REQUESTS = {
  'sine-wave': 'Show me how amplitude and frequency change a sine wave.',
  projectile: 'Explain projectile motion for a physics student.',
  'thin-lens': 'How does a convex lens form an image?',
} as const;

function generator(fault: Fault = 'none', options: { stubborn?: boolean; maxRepairs?: number; probe?: boolean; withhold?: string[]; adapt?: boolean } = {}) {
  const model = referenceModel({ fault, ...(options.stubborn !== undefined ? { stubborn: options.stubborn } : {}) });
  const generate = new Generator({
    model,
    probe: options.probe === false ? null : isolatedProbe,
    ...(options.maxRepairs !== undefined ? { maxRepairs: options.maxRepairs } : {}),
    ...(options.withhold ? { withhold: options.withhold } : {}),
    ...(options.adapt !== undefined ? { adapt: options.adapt } : {}),
  });
  return { model, generate };
}

describe('the generation pipeline', () => {
  it('plans, builds and approves each concept on the first attempt', async () => {
    for (const [id, prompt] of Object.entries(REQUESTS)) {
      const { model, generate } = generator();
      const state = await generate.generate({ prompt });
      expect(state.status, id).toBe('approved');
      expect(state.firstAttemptPassed).toBe(true);
      expect(state.plan?.concept).toBe(REFERENCE_SCENES[id]!.plan.concept);
      expect(state.example).toBe(id);
      expect(state.scene?.js).toBe(REFERENCE_SCENES[id]!.js);
      expect(state.attempts[0]!.probe?.ok).toBe(true);
      expect(model.calls.map((c) => c.purpose)).toEqual(['plan', 'scene']);
      expect(state.usage.outputTokens).toBeGreaterThan(0);
      expect(state.timings.totalMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('re-plans once with the problems when the plan is rejected', async () => {
    const { model, generate } = generator('bad-plan');
    const state = await generate.generate({ prompt: REQUESTS.projectile });
    expect(state.status).toBe('approved');
    expect(model.calls.map((c) => c.purpose)).toEqual(['plan', 'plan', 'scene']);
    expect(model.calls[1]!.prompt.user).toContain('- too-many-params at parameters:');
  });

  it('fails at the plan, without a scene call, when no plan passes', async () => {
    const { model, generate } = generator();
    const state = await generate.generate({ prompt: 'Explain photosynthesis in a leaf.' });
    expect(state.status).toBe('failed');
    expect(state.failure?.stage).toBe('plan');
    expect(model.calls.map((c) => c.purpose)).toEqual(['plan', 'plan']);
  });

  const cases: Array<[Fault, FailedCheck, string]> = [
    ['forbidden-call', 'validation', 'forbidden-global'],
    ['unknown-call', 'validation', 'unknown-sdk-call'],
    ['colour', 'validation', 'hard-coded-colour'],
    ['frame-throw', 'probe', 'runs'],
    ['non-finite', 'probe', 'numbers'],
    ['missing-part', 'probe', 'parts'],
    ['runaway', 'probe', 'runs'],
    ['cut-off', 'reply', 'reply'],
  ];

  for (const [fault, failed, check] of cases) {
    it(`repairs a scene that fails ${failed} (${fault}) once, and checks the repair completely before approving it`, async () => {
      // Written whole, so each fault reaches the checks as a complete scene.
      const { model, generate } = generator(fault, { adapt: false });
      const state = await generate.generate({ prompt: REQUESTS.projectile });
      const [first, repaired] = state.attempts;
      expect(first).toMatchObject({ passed: false, failed, report: { check } });
      expect(state.repairsUsed).toBe(1);
      expect(repaired).toMatchObject({ purpose: 'repair', passed: true, changed: ['js'] });
      // The repaired scene went through the validator and the whole probe again.
      expect(repaired!.scene).not.toBeNull();
      expect(repaired!.probe?.ok).toBe(true);
      expect(state.status).toBe('approved');
      expect(state.firstAttemptPassed).toBe(false);
      const repair = model.calls.find((c) => c.purpose === 'repair')!;
      expect(repair.prompt.user).toContain(first!.report!.text);
    });
  }

  it('makes no more than one automatic repair', async () => {
    const { model, generate } = generator('frame-throw', { stubborn: true });
    const state = await generate.generate({ prompt: REQUESTS['sine-wave'] });
    expect(state.status).toBe('failed');
    expect(state.failure?.stage).toBe('scene');
    expect(model.calls.filter((c) => c.purpose === 'repair')).toHaveLength(1);
  });

  it('allows a second repair only when the first changed something (RP-4)', async () => {
    const unchanged = generator('frame-throw', { stubborn: true, maxRepairs: 2 });
    await unchanged.generate.generate({ prompt: REQUESTS['sine-wave'] });
    expect(unchanged.model.calls.filter((c) => c.purpose === 'repair')).toHaveLength(1);

    // A cut-off reply repaired with a script that is different but still broken.
    const changed = generator('cut-off', { stubborn: true, maxRepairs: 2, adapt: false });
    const state = await changed.generate.generate({ prompt: REQUESTS['sine-wave'] });
    expect(changed.model.calls.filter((c) => c.purpose === 'repair')).toHaveLength(2);
    expect(state.attempts.map((a) => a.failed)).toEqual(['reply', 'validation', 'validation']);
  });

  it('stops at validation without a probe, and repairs a failed device probe on request', async () => {
    const { model, generate } = generator('frame-throw', { probe: false });
    const state = await generate.generate({ prompt: REQUESTS.projectile });
    expect(state.status).toBe('validated');
    expect(model.calls.map((c) => c.purpose)).toEqual(['plan', 'scene']);

    // The learner's device probes the validated scene, and it fails.
    const device = await isolatedProbe(state.scene!, { parts: state.plan!.parts, steps: state.plan!.steps.length });
    expect(device.ok).toBe(false);
    const report = generate.deviceFailed(state, device);
    expect(report.text).toContain('FAILURE  runs');
    expect(generate.canRepair(state)).toBe(true);
    await generate.repair(state, report);
    generate.settle(state);
    expect(state.status).toBe('validated');
    expect(state.scene?.js).toBe(REFERENCE_SCENES.projectile!.js);
    expect(generate.canRepair(state)).toBe(false);
  });

  it('records a model failure', async () => {
    const model = new ScriptedModel((call) => {
      if (call.purpose === 'scene') throw new ModelError('overloaded', 'Overloaded');
      return referenceModel().complete(call).then((r) => r.text);
    });
    const state = await new Generator({ model, probe: isolatedProbe }).generate({ prompt: REQUESTS.projectile });
    expect(state.status).toBe('failed');
    expect(state.failure).toEqual({ stage: 'model', reason: 'overloaded: Overloaded' });
    expect(state.calls.at(-1)?.error).toContain('overloaded');
  });

  it('reports the plan and each fragment as it streams, checked on its own', async () => {
    const { generate } = generator('forbidden-call', { adapt: false });
    const events: string[] = [];
    const state = await generate.generate(
      { prompt: REQUESTS['thin-lens'] },
      { onPlan: (plan) => events.push(`plan:${plan.concept}`), onFragment: (name, ok) => events.push(`${name}:${ok}`) },
    );
    expect(events).toEqual(['plan:thin lens', 'html:true', 'css:true', 'js:false']);
    expect(state.timings.firstFragmentMs).toBeGreaterThanOrEqual(0);
  });

  it('adapts the reviewed scene of the same concept with edits: few output tokens, the same checks', async () => {
    const { model, generate } = generator();
    const state = await generate.generate({ prompt: REQUESTS.projectile });
    expect(state.mode).toBe('adapt');
    expect(state.status).toBe('approved');
    expect(state.scene?.js).toBe(REFERENCE_SCENES.projectile!.js);
    expect(model.calls.map((c) => c.purpose)).toEqual(['plan', 'scene']);
    // Nothing to change: the reply is one empty edit block.
    const reply = await referenceModel().complete(model.calls[1]!);
    expect(reply.text.trim()).toBe('```edit js\n```');
  });

  it('repairs a fault that an edit brought in, and an edit reply that was cut off', async () => {
    for (const fault of ['frame-throw', 'forbidden-call', 'cut-off'] as const) {
      const { generate } = generator(fault);
      const state = await generate.generate({ prompt: REQUESTS['thin-lens'] });
      expect(state.mode, fault).toBe('adapt');
      expect(state.attempts[0]!.passed, fault).toBe(false);
      expect(state.status, fault).toBe('approved');
      expect(state.scene?.js, fault).toBe(REFERENCE_SCENES['thin-lens']!.js);
    }
  });

  it('skips a repair that would end after the deadline, so the caller falls back in time', async () => {
    let clock = 0;
    const model = referenceModel({ fault: 'frame-throw' });
    const generate = new Generator({ model, probe: isolatedProbe, deadlineMs: 25_000, now: () => (clock += 6_000) });
    const state = await generate.generate({ prompt: REQUESTS.projectile });
    expect(state.deadlineSkipped).toBe(true);
    expect(state.status).toBe('failed');
    expect(model.calls.filter((c) => c.purpose === 'repair')).toHaveLength(0);
  });

  it('can leave the concept’s own example out of the context', async () => {
    const { generate } = generator('none', { withhold: ['projectile'] });
    const state = await generate.generate({ prompt: REQUESTS.projectile });
    expect(state.example).not.toBe('projectile');
  });

  it('builds the faults it injects as described', () => {
    const scene = REFERENCE_SCENES['thin-lens']!;
    expect(faultyScript(scene, 'frame-throw')).toMatch(/inc\.onFrame\(\(\) => \{\n {2}const recent = \[\];/);
    expect(faultyScript(scene, 'non-finite')).toContain('lens.handle.set({ opacity: 1 / (objectDistance.max - objectDistance.value) });');
    expect(faultyScript(scene, 'none')).toBe(scene.js);
  });
});

describe('the standard figure fallback', () => {
  it('finds the reviewed figure for the same concept only', () => {
    expect(standardFigure('Projectile motion')?.id).toBe('projectile');
    expect(standardFigure('thin lens ray diagram')?.id).toBe('thin-lens');
    expect(standardFigure('Sine waves')?.id).toBe('sine-wave');
    expect(standardFigure('photosynthesis')).toBeNull();
    expect(standardFigure('')).toBeNull();
  });
});
