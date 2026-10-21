import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, capabilityNames, catalogText } from '../src/catalog';
import { PLAN_LIMITS, formatPlanProblems, unclearIdea, validatePlan, type PlanRule } from '../src/plan';

const projectile = REFERENCE_SCENES.projectile!.plan;

/** The projectile plan with some fields replaced. */
function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(projectile), ...overrides } as Record<string, unknown>;
}

function rules(input: unknown): PlanRule[] {
  return validatePlan(input).problems.map((p) => p.rule);
}

describe('the plan validator', () => {
  it('accepts every reviewed reference plan', () => {
    for (const [id, scene] of Object.entries(REFERENCE_SCENES)) {
      const result = validatePlan(scene.plan);
      expect(result.problems, id).toEqual([]);
      expect(result.plan?.parameters, id).toEqual(scene.plan.parameters);
    }
  });

  it('rejects anything that is not a plan object', () => {
    expect(rules(null)).toEqual(['schema']);
    expect(rules('a plan')).toEqual(['schema']);
    expect(rules([])).toEqual(['schema']);
  });

  it('rejects capabilities that are not in the catalog, naming the ones that are', () => {
    const result = validatePlan(plan({ capabilities: ['graph2d', 'physics2d'] }));
    expect(result.problems.map((p) => p.rule)).toEqual(['unknown-capability']);
    expect(result.problems[0]!.message).toContain('physics2d');
    expect(result.problems[0]!.message).toContain(capabilityNames().join(', '));
    expect(rules(plan({ capabilities: ['graph2d', 'readout'] }))).toEqual([]);
  });

  it('needs something to draw on', () => {
    expect(rules(plan({ capabilities: ['readout', 'steps'] }))).toEqual(['no-stage']);
    expect(rules(plan({ capabilities: ['svg', 'readout', 'steps'] }))).toEqual([]);
  });

  it('allows at most three parameters, and at least one', () => {
    const fourth = { name: 'height', unit: 'm', min: 0, max: 10, default: 0, why: 'Launch from the ground or a cliff.' };
    const params = projectile.parameters;
    const inputs = [...projectile.model.inputs, 'height'];
    expect(rules(plan({ parameters: [...params, fourth], model: { ...projectile.model, inputs } }))).toEqual(['too-many-params']);
    expect(rules(plan({ parameters: [], model: { inputs: [], outputs: [] } }))).toContain('no-params');
  });

  it('rejects invalid bounds, and accepts their valid twins', () => {
    const withSpeed = (speed: Record<string, unknown>) => plan({ parameters: [{ ...projectile.parameters[0], ...speed }, ...projectile.parameters.slice(1)] });
    expect(rules(withSpeed({ min: 20, max: 5 }))).toEqual(['invalid-bounds']);
    expect(rules(withSpeed({ min: 5, max: 5 }))).toEqual(['invalid-bounds']);
    expect(rules(withSpeed({ default: 25 }))).toEqual(['invalid-bounds']);
    expect(rules(withSpeed({ max: Number.POSITIVE_INFINITY }))).toEqual(['invalid-bounds']);
    expect(rules(withSpeed({ min: '5' }))).toEqual(['invalid-bounds']);
    expect(rules(withSpeed({ default: 20 }))).toEqual([]);
    expect(rules(withSpeed({ default: 5 }))).toEqual([]);
  });

  it('asks for a justification of every parameter range', () => {
    const speed = { ...projectile.parameters[0], why: '' };
    expect(rules(plan({ parameters: [speed, ...projectile.parameters.slice(1)] }))).toEqual(['missing-justification']);
  });

  it('wants parameter names a scene can use', () => {
    const speed = { ...projectile.parameters[0], name: 'launch speed' };
    const inputs = ['launch speed', 'angle', 'gravity'];
    expect(rules(plan({ parameters: [speed, ...projectile.parameters.slice(1)], model: { ...projectile.model, inputs } }))).toContain('schema');
  });

  it('rejects outputs that no input can change', () => {
    const outputs = [...projectile.model.outputs, { name: 'mass', dependsOn: [] }];
    expect(rules(plan({ model: { ...projectile.model, outputs } }))).toEqual(['unreachable-output']);
    const unknown = [...projectile.model.outputs, { name: 'drag', dependsOn: ['airDensity'] }];
    expect(rules(plan({ model: { ...projectile.model, outputs: unknown } }))).toEqual(['unreachable-output']);
    const twin = [...projectile.model.outputs, { name: 'drag', dependsOn: ['speed'] }];
    expect(rules(plan({ model: { ...projectile.model, outputs: twin } }))).toEqual([]);
  });

  it('rejects inputs that are not parameters, and parameters that are not inputs', () => {
    expect(rules(plan({ model: { ...projectile.model, inputs: [...projectile.model.inputs, 'time'] } }))).toEqual(['unknown-input']);
    expect(rules(plan({ model: { ...projectile.model, inputs: ['speed', 'angle'] } }))).toContain('unused-parameter');
  });

  it('rejects an unclear idea', () => {
    expect(rules(plan({ idea: '' }))).toEqual(['schema']);
    expect(rules(plan({ idea: 'Projectiles.' }))).toEqual(['unclear-idea']);
    expect(rules(plan({ idea: 'Why does a ball thrown at 45 degrees go the furthest?' }))).toEqual(['unclear-idea']);
    expect(rules(plan({ idea: 'A ball flies. Gravity pulls it down, so its path curves into a parabola.' }))).toEqual(['unclear-idea']);
    expect(rules(plan({ idea: 'x'.repeat(PLAN_LIMITS.ideaMax + 1) }))).toEqual(['unclear-idea']);
    expect(rules(plan({ idea: 'Gravity bends a thrown ball into a parabola while its horizontal speed stays the same.' }))).toEqual([]);
  });

  it('keeps parts and steps within the size budget', () => {
    const parts = Array.from({ length: PLAN_LIMITS.parts + 1 }, (_, i) => `Part ${i + 1}`);
    expect(rules(plan({ parts }))).toEqual(['too-many-parts']);
    expect(rules(plan({ parts: [] }))).toEqual(['schema']);
    expect(rules(plan({ parts: ['Ball', 'Ball'] }))).toEqual(['duplicate-name']);
    const steps = Array.from({ length: PLAN_LIMITS.steps + 1 }, (_, i) => `Step ${i + 1}`);
    expect(rules(plan({ steps }))).toEqual(['too-many-steps']);
  });

  it('checks declared singular points against the parameters', () => {
    const lens = REFERENCE_SCENES['thin-lens']!.plan;
    const withPoints = (singularPoints: unknown) => ({ ...structuredClone(lens), singularPoints });
    expect(rules(withPoints([{ objectDistance: 8, focalLength: 8 }]))).toEqual([]);
    expect(rules(withPoints([{ distance: 8 }]))).toEqual(['invalid-singular-point']);
    expect(rules(withPoints([{ objectDistance: 1000 }]))).toEqual(['invalid-singular-point']);
    expect(rules(withPoints([{}]))).toEqual(['invalid-singular-point']);
  });

  it('normalizes what it can: whitespace, a missing describe capability, steps without the steps capability', () => {
    const result = validatePlan(plan({ concept: '  projectile   motion ', capabilities: ['graph2d', 'readout'] }));
    expect(result.plan?.concept).toBe('projectile motion');
    expect(result.plan?.capabilities).toEqual(['graph2d', 'readout', 'describe', 'steps']);
  });

  it('quotes its problems one per line for the re-plan request', () => {
    const { problems } = validatePlan(plan({ capabilities: ['graph2d', 'physics2d'], idea: 'Projectiles.' }));
    const text = formatPlanProblems(problems);
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toMatch(/^- unclear-idea at idea: /m);
    expect(text).toMatch(/^- unknown-capability at capabilities\[1\]: /m);
  });

  it('explains why an idea is unclear', () => {
    expect(unclearIdea('Amplitude sets how tall a sine wave is; frequency sets how often it repeats.')).toBeNull();
    expect(unclearIdea('What happens to a wave when its frequency doubles?')).toMatch(/question/);
    expect(unclearIdea('A wave.')).toMatch(/shorter/);
  });
});

describe('the capability catalog', () => {
  it('lists every capability the reference plans use', () => {
    for (const scene of Object.values(REFERENCE_SCENES)) {
      for (const name of scene.plan.capabilities) expect(capabilityNames(), `${scene.id}: ${name}`).toContain(name);
    }
  });

  it('is one short line per capability', () => {
    const lines = catalogText().split('\n');
    expect(lines).toHaveLength(CAPABILITIES.length);
    for (const line of lines) expect(line.length).toBeLessThan(200);
  });
});
