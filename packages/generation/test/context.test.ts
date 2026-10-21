import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CORE_CONTRACT } from '../src/catalog';
import {
  CORE_RULES,
  PLAN_FORMAT,
  REQUEST_LIMITS,
  catalogLines,
  contractFor,
  coreBlock,
  estimateTokens,
  nearestExample,
  planPrompt,
  scenePrompt,
} from '../src/context';
import { SDK_CONTRACT } from '../src/generated/contract';
import { PLAN_LIMITS } from '../src/plan';
import { SIZE_BUDGETS } from '@incantly/core';

const projectile = REFERENCE_SCENES.projectile!.plan;

describe('the generation context', () => {
  it('keeps the core rules under 1,500 tokens', () => {
    expect(estimateTokens(CORE_RULES)).toBeLessThan(1500);
  });

  it('names exactly the SDK tones and the budgets the validator and probe enforce', () => {
    const tones = [...SDK_CONTRACT.Tone!.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(CORE_RULES).toContain(`tones: ${tones.join(', ')}.`);
    expect(CORE_RULES).toContain(`a quick figure is about ${SIZE_BUDGETS.quick.lines} lines`);
    expect(CORE_RULES).toContain('under 500 samples per curve');
    expect(PLAN_FORMAT).toContain(`up to ${PLAN_LIMITS.params} controls and ${PLAN_LIMITS.parts} parts`);
  });

  it('maps every capability to declarations that exist in the SDK contract', () => {
    for (const name of CORE_CONTRACT) expect(SDK_CONTRACT[name], name).toBeTypeOf('string');
    for (const entry of CAPABILITIES) {
      for (const name of entry.contract) expect(SDK_CONTRACT[name], `${entry.name}: ${name}`).toBeTypeOf('string');
    }
  });

  it('sends only the declarations a plan needs', () => {
    const graph = contractFor(['graph2d', 'readout']);
    expect(graph).toContain('interface Inc {');
    expect(graph).toContain('interface Graph {');
    expect(graph).not.toContain('interface GeometryHelpers');
    expect(graph).not.toContain('export ');
    const lens = contractFor(REFERENCE_SCENES['thin-lens']!.plan.capabilities);
    expect(lens).toContain('interface GeometryHelpers');
    expect(lens.indexOf('interface Inc {')).toBe(lens.lastIndexOf('interface Inc {'));
  });

  it('picks the nearest reviewed example, or the next one when it is withheld', () => {
    expect(nearestExample(projectile)?.id).toBe('projectile');
    expect(nearestExample({ concept: 'thin lens', idea: 'Rays through a convex lens meet at the image.', capabilities: ['svg'] })?.id).toBe(
      'thin-lens',
    );
    const withheld = nearestExample(projectile, { withhold: ['projectile'] });
    expect(withheld?.id).not.toBe('projectile');
    expect(nearestExample(projectile, { withhold: Object.keys(REFERENCE_SCENES) })).toBeNull();
  });

  it('builds the plan call from the request, clipping what the learner sent', () => {
    const prompt = planPrompt({ prompt: 'Why does a ball thrown at 45 degrees go the furthest?', noteContext: 'x'.repeat(5000) });
    expect(prompt.user).toContain('"Why does a ball thrown at 45 degrees go the furthest?"');
    const context = /Text near the request in their note: "([^"]*)"/.exec(prompt.user)![1]!;
    expect(context.length).toBeLessThanOrEqual(REQUEST_LIMITS.noteContext);
    expect(prompt.system[1]!.text).toContain('"singularPoints"');
  });

  it('quotes the rejected plan and its problems in a re-plan', () => {
    const prompt = planPrompt({ prompt: 'projectiles' }, { previous: '{"concept":"x"}', problems: '- unclear-idea at idea: too short' });
    expect(prompt.user).toContain('{"concept":"x"}');
    expect(prompt.user).toContain('- unclear-idea at idea: too short');
  });

  it('builds the scene call from the plan, the contract and the example, after the same cached prefix as the plan call', () => {
    const { prompt, example, mode } = scenePrompt({ ...projectile, concept: 'ball thrown on another planet' }, { adapt: false });
    expect(mode).toBe('write');
    expect(example).toBe('projectile');
    expect(prompt.system[0]).toEqual(coreBlock());
    expect(prompt.system[0]).toEqual(planPrompt({ prompt: 'x' }).system[0]);
    expect(prompt.system.every((block) => block.cache)).toBe(true);
    expect(prompt.system[1]!.text).toContain('This is the BUILD call');
    expect(prompt.system[1]!.text).toContain('interface Graph {');
    expect(prompt.system[1]!.text).toContain(REFERENCE_SCENES.projectile!.js.trim().split('\n')[0]);
    expect(prompt.user).toContain('"concept": "ball thrown on another planet"');
    expect(prompt.user).toContain('Size: quick');
  });

  it('asks only for edits when a reviewed scene of the same concept exists (PRD 25.5)', () => {
    const { prompt, example, mode, start } = scenePrompt(projectile);
    expect(mode).toBe('adapt');
    expect(example).toBe('projectile');
    expect(start?.id).toBe('projectile');
    // The starting scene is in the cached prefix, so every request for the concept shares it.
    expect(prompt.system[1]!.cache).toBe(true);
    expect(prompt.system[1]!.text).toContain('EDIT format');
    expect(prompt.system[1]!.text).toContain(REFERENCE_SCENES.projectile!.js.trim());
    expect(prompt.user).toContain('Adapt the starting scene to this plan.');
    expect(prompt.user).not.toContain(REFERENCE_SCENES.projectile!.js.trim());
    // Not when its stage is of another kind, nor when the example is withheld.
    expect(scenePrompt({ ...projectile, capabilities: ['svg', 'describe'] }).mode).toBe('write');
    expect(scenePrompt(projectile, { withhold: ['projectile'] }).mode).toBe('write');
  });

  it('keeps the whole scene context to a few thousand tokens, most of it cached', () => {
    for (const scene of Object.values(REFERENCE_SCENES)) {
      for (const adapt of [true, false]) {
        const { prompt } = scenePrompt(scene.plan, { adapt });
        const tokens = estimateTokens(prompt.system.map((b) => b.text).join('\n') + prompt.user);
        expect(tokens, `${scene.id} ${adapt}`).toBeLessThan(12_000);
        // What changes per request, outside the cached prefix, is only the plan.
        expect(estimateTokens(prompt.user), `${scene.id} ${adapt}`).toBeLessThan(800);
      }
    }
  });

  it('quotes catalog lines for repair requests', () => {
    expect(catalogLines(['graph2d', 'nonsense', 'readout']).split('\n')).toHaveLength(2);
  });
});
