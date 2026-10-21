import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, CORE_CONTRACT } from '../src/catalog';
import {
  CORE_RULES,
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

const projectile = REFERENCE_SCENES.projectile!.plan;

describe('the generation context', () => {
  it('keeps the core rules under 1,500 tokens', () => {
    expect(estimateTokens(CORE_RULES)).toBeLessThan(1500);
  });

  it('names exactly the SDK tones and the budgets the validator and probe enforce', () => {
    const tones = [...SDK_CONTRACT.Tone!.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(CORE_RULES).toContain(`tones: ${tones.join(', ')}.`);
    expect(CORE_RULES).toContain(`at most ${['zero', 'one', 'two', 'three'][PLAN_LIMITS.params]}`);
    expect(CORE_RULES).toContain('under 300 drawn elements');
    expect(CORE_RULES).toContain('under 500 samples per curve');
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
    const { prompt, example } = scenePrompt(projectile);
    expect(example).toBe('projectile');
    expect(prompt.system[0]).toEqual(coreBlock());
    expect(prompt.system[0]).toEqual(planPrompt({ prompt: 'x' }).system[0]);
    expect(prompt.system.every((block) => block.cache)).toBe(true);
    expect(prompt.system[1]!.text).toContain('interface Graph {');
    expect(prompt.system[1]!.text).toContain(REFERENCE_SCENES.projectile!.js.trim().split('\n')[0]);
    expect(prompt.user).toContain('"concept": "projectile motion"');
  });

  it('can leave the concept’s own example out', () => {
    const { prompt, example } = scenePrompt(projectile, { withhold: ['projectile'] });
    expect(example).not.toBe('projectile');
    expect(prompt.system[1]!.text).not.toContain(REFERENCE_SCENES.projectile!.js.trim());
  });

  it('keeps the whole scene context to a few thousand tokens', () => {
    for (const scene of Object.values(REFERENCE_SCENES)) {
      const { prompt } = scenePrompt(scene.plan);
      const tokens = estimateTokens(prompt.system.map((b) => b.text).join('\n') + prompt.user);
      expect(tokens, scene.id).toBeLessThan(9000);
    }
  });

  it('quotes catalog lines for repair requests', () => {
    expect(catalogLines(['graph2d', 'nonsense', 'readout']).split('\n')).toHaveLength(2);
  });
});
