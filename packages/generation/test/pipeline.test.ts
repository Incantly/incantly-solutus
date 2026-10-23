import { SIZE_BUDGETS } from '@incantly/core';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { ModelError, NO_USAGE, ScriptedModel, type CallPurpose, type ModelCall, type ModelClient } from '../src/models';
import { scenePrompt } from '../src/context';
import { DEFAULT_MAX_TOKENS, MAX_REPLY_TOKENS, Generator, conceptAndIdea, planHead, standardFigure, type FailedCheck } from '../src/pipeline';
import { validatePlan } from '../src/plan';
import { isolatedProbe } from '../src/probe';
import { faultyScript, referenceModel, type Fault } from '../src/reference-model';

const REQUESTS = {
  'sine-wave': 'Show me how amplitude and frequency change a sine wave.',
  projectile: 'Explain projectile motion for a physics student.',
  'thin-lens': 'How does a convex lens form an image?',
} as const;

function generator(
  fault: Fault = 'none',
  options: { stubborn?: boolean; maxRepairs?: number; probe?: boolean; withhold?: string[]; adapt?: boolean; retrieve?: boolean } = {},
) {
  const model = referenceModel({ fault, ...(options.stubborn !== undefined ? { stubborn: options.stubborn } : {}) });
  const generate = new Generator({
    model,
    probe: options.probe === false ? null : isolatedProbe,
    ...(options.maxRepairs !== undefined ? { maxRepairs: options.maxRepairs } : {}),
    ...(options.withhold ? { withhold: options.withhold } : {}),
    ...(options.adapt !== undefined ? { adapt: options.adapt } : {}),
    ...(options.retrieve !== undefined ? { retrieve: options.retrieve } : {}),
  });
  return { model, generate };
}

describe('the generation pipeline', () => {
  it('plans, builds and approves each concept on the first attempt', async () => {
    for (const [id, prompt] of Object.entries(REQUESTS)) {
      const { model, generate } = generator('none', { retrieve: false });
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
    const { model, generate } = generator('bad-plan', { retrieve: false });
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
    const { model, generate } = generator('frame-throw', { probe: false, retrieve: false });
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
    expect(state.calls.find((c) => c.purpose === 'scene')?.error).toContain('overloaded');
  });

  it('asks for the rest of a scene call cut off at max_tokens, keeping what already streamed', async () => {
    // Written whole: the first reply stops inside the js block, as a real cut-off does, and the next call writes only the rest.
    const scene = REFERENCE_SCENES.projectile!;
    const whole = `\`\`\`html\n${scene.html}\n\`\`\`\n\`\`\`css\n${scene.css}\n\`\`\`\n\`\`\`js\n${scene.js}\n\`\`\`\n`;
    const cut = Math.floor(whole.length * 0.6);
    const sceneCalls: ModelCall[] = [];
    const model = new ScriptedModel((call) => {
      if (call.purpose === 'plan') return `Here is the plan.\n\`\`\`json\n${JSON.stringify(scene.plan)}\n\`\`\`\n`;
      sceneCalls.push(call);
      return sceneCalls.length === 1 ? { text: whole.slice(0, cut), stopReason: 'max_tokens' } : whole.slice(cut);
    });
    const state = await new Generator({ model, probe: isolatedProbe, adapt: false, retrieve: false }).generate({ prompt: REQUESTS.projectile });
    expect(state.status).toBe('approved');
    expect(state.firstAttemptPassed).toBe(true);
    expect(sceneCalls).toHaveLength(2);
    expect(sceneCalls[1]!.continueFrom).toBe(whole.slice(0, cut));
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]!.fragments.js).toBe(`${scene.js}\n`);
    expect(state.calls.map((c) => c.maxTokens)).toEqual([DEFAULT_MAX_TOKENS.plan, SIZE_BUDGETS.quick.sceneTokens, SIZE_BUDGETS.quick.sceneTokens * 2]);
    expect(state.calls.filter((c) => c.truncated)).toHaveLength(1);
    expect(state.attempts[0]!.report).toBeNull();
  });

  it('drops the stretch a continuation restates before going on', async () => {
    const scene = REFERENCE_SCENES.projectile!;
    const whole = `\`\`\`html\n${scene.html}\n\`\`\`\n\`\`\`css\n${scene.css}\n\`\`\`\n\`\`\`js\n${scene.js}\n\`\`\`\n`;
    const cut = Math.floor(whole.length * 0.6);
    let scenes = 0;
    const model = new ScriptedModel((call) => {
      if (call.purpose === 'plan') return `Here is the plan.\n\`\`\`json\n${JSON.stringify(scene.plan)}\n\`\`\`\n`;
      scenes++;
      // The continuation starts 80 characters back, repeating the end of what was written.
      return scenes === 1 ? { text: whole.slice(0, cut), stopReason: 'max_tokens' } : whole.slice(cut - 80);
    });
    const state = await new Generator({ model, probe: isolatedProbe, adapt: false, retrieve: false }).generate({ prompt: REQUESTS.projectile });
    expect(state.status).toBe('approved');
    expect(state.attempts[0]!.fragments.js).toBe(`${scene.js}\n`);
  });

  it('asks again whole when a call was cut off before it wrote anything', async () => {
    const scene = REFERENCE_SCENES.projectile!;
    const whole = `\`\`\`html\n${scene.html}\n\`\`\`\n\`\`\`css\n${scene.css}\n\`\`\`\n\`\`\`js\n${scene.js}\n\`\`\`\n`;
    const sceneCalls: ModelCall[] = [];
    const model = new ScriptedModel((call) => {
      if (call.purpose === 'plan') return `Here is the plan.\n\`\`\`json\n${JSON.stringify(scene.plan)}\n\`\`\`\n`;
      sceneCalls.push(call);
      // Its thinking ate the whole cap.
      return sceneCalls.length === 1 ? { text: '', stopReason: 'max_tokens' } : whole;
    });
    const state = await new Generator({ model, probe: isolatedProbe, adapt: false, retrieve: false }).generate({ prompt: REQUESTS.projectile });
    expect(state.status).toBe('approved');
    expect(sceneCalls[1]!.continueFrom).toBeUndefined();
    expect(sceneCalls[1]!.maxTokens).toBe(SIZE_BUDGETS.quick.sceneTokens * 2);
  });

  it('gives a probe failure its own repair after a repair spent on validation', async () => {
    // The scene fails validation; its repair validates but throws in a frame; the probe's own repair fixes that.
    const scene = REFERENCE_SCENES.projectile!;
    const fenced = (js: string) => `\`\`\`html\n${scene.html}\n\`\`\`\n\`\`\`css\n${scene.css}\n\`\`\`\n\`\`\`js\n${js}\n\`\`\`\n`;
    let repairs = 0;
    const model = new ScriptedModel((call) => {
      if (call.purpose === 'plan') return `Here is the plan.\n\`\`\`json\n${JSON.stringify(scene.plan)}\n\`\`\`\n`;
      if (call.purpose === 'scene') return fenced(faultyScript(scene, 'forbidden-call'));
      repairs++;
      return `\`\`\`js\n${repairs === 1 ? faultyScript(scene, 'frame-throw') : scene.js}\n\`\`\`\n`;
    });
    const state = await new Generator({ model, probe: isolatedProbe, adapt: false, retrieve: false }).generate({ prompt: REQUESTS.projectile });
    expect(state.attempts.map((a) => a.failed)).toEqual(['validation', 'probe', null]);
    expect(state.repairsFor).toEqual({ static: 1, probe: 1 });
    expect(state.status).toBe('approved');
  });

  it('still allows one repair of each kind: a second validation failure falls back', async () => {
    const scene = REFERENCE_SCENES.projectile!;
    const fenced = (js: string) => `\`\`\`html\n${scene.html}\n\`\`\`\n\`\`\`css\n${scene.css}\n\`\`\`\n\`\`\`js\n${js}\n\`\`\`\n`;
    const model = new ScriptedModel((call) => {
      if (call.purpose === 'plan') return `Here is the plan.\n\`\`\`json\n${JSON.stringify(scene.plan)}\n\`\`\`\n`;
      if (call.purpose === 'scene') return fenced(faultyScript(scene, 'forbidden-call'));
      return `\`\`\`js\n${faultyScript(scene, 'unknown-call')}\n\`\`\`\n`;
    });
    const state = await new Generator({ model, probe: isolatedProbe, adapt: false, retrieve: false }).generate({ prompt: REQUESTS.projectile });
    expect(state.status).toBe('failed');
    expect(model.calls.filter((c) => c.purpose === 'repair')).toHaveLength(1);
  });

  it('takes a reply still cut off at the ceiling as a reply-format failure, and reports it for repair', async () => {
    const scene = REFERENCE_SCENES.projectile!;
    const whole = `\`\`\`html\n${scene.html}\n\`\`\`\n\`\`\`css\n${scene.css}\n\`\`\`\n\`\`\`js\n${scene.js}\n\`\`\`\n`;
    const model = new ScriptedModel((call) => {
      if (call.purpose === 'plan') return `Here is the plan.\n\`\`\`json\n${JSON.stringify(scene.plan)}\n\`\`\`\n`;
      // Cut at every scene or repair call: the doubling reaches the ceiling and the reply stays unreadable.
      return { text: whole.slice(0, Math.floor(whole.length * 0.6)), stopReason: 'max_tokens' };
    });
    const state = await new Generator({ model, probe: isolatedProbe, adapt: false, retrieve: false }).generate({ prompt: REQUESTS.projectile });
    expect(state.status).toBe('failed');
    expect(state.failure?.stage).toBe('scene');
    expect(state.attempts.map((a) => a.failed)).toEqual(['reply', 'reply']);
    // scene: budget, twice it, the ceiling; repair: the scene budget, twice it, the ceiling.
    expect(state.calls.filter((c) => c.purpose === 'scene' && c.truncated).map((c) => c.maxTokens)).toEqual([SIZE_BUDGETS.quick.sceneTokens, SIZE_BUDGETS.quick.sceneTokens * 2, MAX_REPLY_TOKENS]);
    expect(state.calls.filter((c) => c.purpose === 'repair' && c.truncated).map((c) => c.maxTokens)).toEqual([SIZE_BUDGETS.quick.sceneTokens, SIZE_BUDGETS.quick.sceneTokens * 2, MAX_REPLY_TOKENS]);
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
    const { model, generate } = generator('none', { retrieve: false });
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

  /** A model whose calls take the given time on a clock that moves only when a call finishes. */
  function timedModel(took: Record<string, number>, fault: Fault) {
    let clock = 0;
    const inner = referenceModel({ fault });
    const calls: ModelCall[] = [];
    const model = {
      name: inner.name,
      calls,
      modelFor: (purpose: CallPurpose) => inner.modelFor(purpose),
      complete: async (call: ModelCall) => {
        calls.push(call);
        const reply = await inner.complete(call);
        clock += took[call.purpose]!;
        return { ...reply, ms: took[call.purpose]! };
      },
    };
    return { model, now: () => clock };
  }

  it('skips a repair that would end after the build deadline, so the caller falls back in time', async () => {
    // The build starts at 0 with a 14 s scene; 2 s are left, and a repair needs about 4.3 s.
    const { model, now } = timedModel({ plan: 0, scene: 14_000, repair: 3_000 }, 'frame-throw');
    const generate = new Generator({ model, probe: isolatedProbe, deadlineMs: 16_000, now, adapt: false });
    const state = await generate.generate({ prompt: REQUESTS.projectile });
    expect(state.deadlineSkipped).toBe(true);
    expect(state.status).toBe('failed');
    expect(model.calls.filter((c) => c.purpose === 'repair')).toHaveLength(0);
  });

  it('still repairs when an edit fits before the build deadline: repairs take a fraction of the scene call', async () => {
    const { model, now } = timedModel({ plan: 2_000, scene: 14_000, repair: 3_000 }, 'frame-throw');
    const generate = new Generator({ model, probe: isolatedProbe, deadlineMs: 25_000, now, adapt: false });
    const state = await generate.generate({ prompt: REQUESTS.projectile });
    expect(state.deadlineSkipped).toBe(false);
    expect(state.status).toBe('approved');
    expect(state.repairsUsed).toBe(1);
  });

  it('starts the build deadline when the build starts, so a long plan does not eat the scene time', async () => {
    // The plan takes 200 s, far past any build deadline counted from the request; the build still gets its full 5 minutes.
    const { model, now } = timedModel({ plan: 200_000, scene: 14_000, repair: 3_000 }, 'none');
    const generate = new Generator({ model, probe: isolatedProbe, deadlineMs: 300_000, now, adapt: false });
    const state = await generate.generate({ prompt: REQUESTS.projectile });
    expect(state.status).toBe('approved');
    expect(state.deadlineHit).toBe(false);
    expect(state.buildStartedAt).toBe(200_000);
  });

  it('marks a build cut off by its deadline, so the service reports a timeout', async () => {
    // A scene that takes longer than the whole build deadline: the deadline cancels it.
    const model = new ScriptedModel(async (call) => {
      if (call.purpose === 'plan') return `\`\`\`json\n${JSON.stringify(REFERENCE_SCENES.projectile!.plan)}\n\`\`\``;
      await new Promise((_, reject) => call.signal?.addEventListener('abort', () => reject(new ModelError('aborted', 'The call was cancelled'))));
      return '';
    });
    const generate = new Generator({ model, probe: isolatedProbe, deadlineMs: 80, adapt: false, retrieve: false });
    const state = await generate.generate({ prompt: REQUESTS.projectile });
    expect(state.status).toBe('failed');
    expect(state.deadlineHit).toBe(true);
  });


  it('starts adapting the reviewed scene a request names at once, with the plan call beside it only to confirm (PRD 25.5)', async () => {
    for (const [id, prompt] of Object.entries(REQUESTS)) {
      const { model, generate } = generator();
      const plans: string[] = [];
      const state = await generate.generate({ prompt }, { onPlan: (plan) => plans.push(plan.concept) });
      expect(state.status, id).toBe('approved');
      expect(state.retrieved).toBe(id);
      expect(state.mode).toBe('adapt');
      expect(state.scene?.js).toBe(REFERENCE_SCENES[id]!.js);
      // The scene call goes first; the skeleton is the reviewed plan, at once.
      expect(model.calls.map((c) => c.purpose)).toEqual(['scene', 'plan']);
      expect(model.calls[0]!.prompt.system[1]!.text).toContain('LIBRARY format');
      expect(model.calls[0]!.prompt.user).toContain(prompt);
      expect(plans).toEqual([REFERENCE_SCENES[id]!.plan.concept]);
      expect(state.calls).toHaveLength(2);
    }
  });

  it("confirms a library build from the plan's first words, and stops the plan once the build is in (PRD 25.5)", async () => {
    const projectile = REFERENCE_SCENES.projectile!;
    let planStopped = false;
    const model: ModelClient = {
      name: 'test',
      modelFor: (purpose) => `test-${purpose}`,
      complete: async (call) => {
        if (call.purpose === 'plan') {
          // The concept and idea stream in; the rest of the plan would take longer than the build.
          const text = '```json\n' + JSON.stringify(projectile.plan) + '\n```';
          call.onText?.(text.slice(0, text.indexOf('"kind"')));
          await new Promise((_, reject) =>
            call.signal?.addEventListener('abort', () => {
              planStopped = true;
              reject(new ModelError('aborted', 'stopped'));
            }),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { text: '```edit js\n```', model: 'test-scene', usage: NO_USAGE, stopReason: 'end_turn', ms: 5 };
      },
    };
    const state = await new Generator({ model, probe: isolatedProbe }).generate({ prompt: REQUESTS.projectile });
    expect(state.status, state.failure?.reason).toBe('approved');
    expect(state.retrieved).toBe('projectile');
    // The learner never waited for the plan's last words: the call was stopped once the build was in.
    expect(planStopped).toBe(true);
    expect(state.calls.find((c) => c.purpose === 'plan')?.error).toMatch(/^aborted/);
    expect(state.timings.planMs).toBeLessThan(state.timings.totalMs!);
  });

  it('applies the validator\'s certain fixes itself, so a capped loop needs no repair call', async () => {
    const sine = REFERENCE_SCENES['sine-wave']!;
    const js = `${sine.js.trim()}\nlet count = 3;\nfor (let i = 0; i < count; i++) { count += 0; }\n`;
    const model = new ScriptedModel((call) =>
      call.purpose === 'plan'
        ? '```json\n' + JSON.stringify(sine.plan) + '\n```'
        : ['```html', sine.html.trim(), '```', '```css', sine.css.trim(), '```', '```js', js, '```'].join('\n'),
    );
    const state = await new Generator({ model, probe: isolatedProbe, adapt: false, retrieve: false }).generate({ prompt: 'Show me a sine wave.' });
    expect(state.status, state.failure?.reason).toBe('approved');
    expect(state.firstAttemptPassed).toBe(true);
    expect(state.repairsUsed).toBe(0);
    expect(model.calls.map((c) => c.purpose)).toEqual(['plan', 'scene']);
    expect(state.attempts[0]!.fixed).toEqual(['capped a loop at Math.min(count, 5000)']);
    expect(state.scene!.js).toContain('i < Math.min(count, 5000)');
  });

  it('reads a streaming plan\'s concept and idea once both are complete', () => {
    expect(conceptAndIdea('```json\n{ "concept": "projectile mot')).toBeNull();
    expect(conceptAndIdea('{ "concept": "projectile motion", "idea": "A ball')).toBeNull();
    expect(conceptAndIdea('{ "concept": "projectile motion", "idea": "A ball \\"flies\\" in an arc.", "ki')).toEqual({ concept: 'projectile motion', idea: 'A ball "flies" in an arc.' });
  });

  it('reads a streaming plan\'s head, which gives the scene call the same prefix as the whole plan', () => {
    for (const scene of Object.values(REFERENCE_SCENES)) {
      const plan = validatePlan(scene.plan).plan!;
      for (const text of [JSON.stringify(plan), JSON.stringify(plan, null, 2)]) {
        const reply = '```json\n' + text + '\n```';
        const cut = reply.indexOf('"model"');
        expect(planHead(reply.slice(0, cut + 5)), scene.id).toBeNull();
        const head = planHead(reply.slice(0, cut + 12));
        expect(head, scene.id).not.toBeNull();
        expect(scenePrompt(head!).prompt.system, scene.id).toEqual(scenePrompt(plan).prompt.system);
      }
    }
    expect(planHead('{"concept": "a", "idea": "unfinished')).toBeNull();
  });

  it('writes the scene call\'s prefix while the plan streams, before the plan ends', async () => {
    const sine = REFERENCE_SCENES['sine-wave']!;
    const events: string[] = [];
    let warmed: ModelCall['prompt'] | null = null;
    const scripted = new ScriptedModel((call) => {
      events.push(`${call.purpose} reply`);
      return call.purpose === 'plan' ? '```json\n' + JSON.stringify(sine.plan) + '\n```' : '```edit js\n```';
    }, { chunk: 16 });
    const model: ModelClient = {
      name: 'warming',
      modelFor: (purpose: CallPurpose) => scripted.modelFor(purpose),
      complete: (call: ModelCall) =>
        scripted.complete({
          ...call,
          ...(call.onText ? { onText: (delta: string) => { call.onText!(delta); if (call.purpose === 'plan' && delta.includes('}],"steps"')) events.push('plan streaming'); } } : {}),
        }),
      warm: async (call) => {
        events.push(`warm ${call.purpose}`);
        warmed = call.prompt;
        return { ...NO_USAGE, cacheWriteTokens: 9000 };
      },
    };
    const state = await new Generator({ model, probe: isolatedProbe, retrieve: false }).generate({ prompt: 'Show me a sine wave.' });
    expect(state.status, state.failure?.reason).toBe('approved');
    expect(events.indexOf('warm scene')).toBeGreaterThan(-1);
    expect(events.indexOf('warm scene')).toBeLessThan(events.indexOf('scene reply'));
    // The prefix it wrote is the scene call's own.
    expect(warmed!.system).toEqual(scenePrompt(state.plan!).prompt.system);
    expect(state.usage.cacheWriteTokens).toBeGreaterThanOrEqual(9000);
    // Off, or with a client that cannot warm, nothing is written ahead.
    const off = await new Generator({ model, probe: isolatedProbe, retrieve: false, warm: false }).generate({ prompt: 'Show me a sine wave.' });
    expect(off.warmed).toBeNull();
  });

  it('stops the library build when the plan names another concept, and goes on from that plan', async () => {
    const sine = REFERENCE_SCENES['sine-wave']!;
    const model = new ScriptedModel(async (call) => {
      if (call.purpose === 'plan') return '```json\n' + JSON.stringify(sine.plan) + '\n```';
      if (call.prompt.system[1]!.text.includes('LIBRARY format')) {
        // A slow library build, stopped when the plan disagrees.
        await new Promise((_, reject) => call.signal?.addEventListener('abort', () => reject(new ModelError('aborted', 'stopped'))));
      }
      return '```edit js\n```';
    });
    const plans: string[] = [];
    const state = await new Generator({ model, probe: isolatedProbe }).generate({ prompt: REQUESTS.projectile }, { onPlan: (plan) => plans.push(plan.concept) });
    expect(model.calls.map((c) => c.purpose)).toEqual(['scene', 'plan', 'scene']);
    expect(plans).toEqual(['projectile motion', 'sine wave']);
    expect(state.retrieved).toBeNull();
    expect(state.example).toBe('sine-wave');
    expect(state.status).toBe('approved');
    expect(state.scene?.js).toBe(sine.js);
  });

  it('keeps the library build when the plan names the same concept in its own words', async () => {
    const normal = REFERENCE_SCENES.normal!;
    const model = new ScriptedModel((call) => {
      if (call.purpose === 'plan') {
        const plan = { ...normal.plan, concept: '68-95-99.7 rule', idea: 'Shading the bell curve within one, two and three standard deviations of the mean shows where 68%, 95% and 99.7% of values fall.' };
        return '```json\n' + JSON.stringify(plan) + '\n```';
      }
      return '```edit js\n```';
    });
    const state = await new Generator({ model, probe: isolatedProbe }).generate({ prompt: 'Show the 68-95-99.7 rule on a bell curve' });
    expect(model.calls.map((c) => c.purpose)).toEqual(['scene', 'plan']);
    expect(state.retrieved).toBe('normal');
    expect(state.status, state.failure?.reason).toBe('approved');
  });

  it('takes a plan the library reply adds, when the request needed other names', async () => {
    const projectile = REFERENCE_SCENES.projectile!;
    const plan = { ...projectile.plan, steps: projectile.plan.steps.slice(0, 3) };
    const js = projectile.js.replace(/\n {2}\{ say: 'Stronger gravity[^\n]*\n/, '\n');
    const model = new ScriptedModel((call) => {
      if (call.purpose === 'plan') return '```json\n' + JSON.stringify(projectile.plan) + '\n```';
      return '```js\n' + js + '```\n```json\n' + JSON.stringify(plan) + '\n```';
    });
    const state = await new Generator({ model, probe: isolatedProbe }).generate({ prompt: REQUESTS.projectile });
    expect(state.status, state.failure?.reason).toBe('approved');
    expect(state.plan?.steps).toHaveLength(3);
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

  it('matches concepts on the words that name them, never on "the" or "how"', () => {
    const withoutSeasons = Object.fromEntries(Object.entries(REFERENCE_SCENES).filter(([id]) => id !== 'seasons'));
    // Once "the seasons" shared "the" with "the Magnus effect", and a plan for the seasons adapted the Magnus scene.
    expect(standardFigure('the seasons', withoutSeasons)).toBeNull();
    expect(standardFigure('the seasons')?.id).toBe('seasons');
    expect(standardFigure('the Magnus effect')?.id).toBe('magnus');
    expect(standardFigure('how the seasons work')?.id).toBe('seasons');
    for (const scene of Object.values(REFERENCE_SCENES)) expect(standardFigure(scene.plan.concept)?.id, scene.id).toBe(scene.id);
  });
});
