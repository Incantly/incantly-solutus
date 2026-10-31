import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, capabilityNames, catalogText } from '../src/catalog';
import { PLAN_LIMITS, formatPlanProblems, identifierFrom, singularPointList, unclearIdea, validatePlan, type PlanRule } from '../src/plan';

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
    const result = validatePlan(plan({ capabilities: ['graph2d', 'hologram'] }));
    expect(result.problems.map((p) => p.rule)).toEqual(['unknown-capability']);
    expect(result.problems[0]!.message).toContain('hologram');
    expect(result.problems[0]!.message).toContain(capabilityNames().join(', '));
    expect(rules(plan({ capabilities: ['graph2d', 'readout'] }))).toEqual([]);
  });

  it('passes over core calls listed as capabilities, which every scene has, rather than re-plan', () => {
    const result = validatePlan(plan({ capabilities: ['graph2d', 'idea', 'model', 'readout'] }));
    expect(result.problems).toEqual([]);
    expect(result.plan!.capabilities).not.toContain('idea');
    expect(result.plan!.capabilities).not.toContain('model');
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

  it('turns names a scene cannot use into identifiers everywhere they appear, and rejects names with no letters', () => {
    const speed = { ...projectile.parameters[0], name: 'launch speed' };
    const inputs = ['launch speed', 'angle', 'gravity'];
    const outputs = projectile.model.outputs.map((o) => ({
      name: o.name === 'range' ? 'range (m)' : o.name,
      dependsOn: o.dependsOn.map((d) => (d === 'speed' ? 'launch speed' : d)),
    }));
    const result = validatePlan(plan({ parameters: [speed, ...projectile.parameters.slice(1)], model: { inputs, outputs } }));
    expect(result.problems).toEqual([]);
    expect(result.plan!.parameters[0]!.name).toBe('launchSpeed');
    expect(result.plan!.model.inputs).toContain('launchSpeed');
    expect(result.plan!.model.outputs.map((o) => o.name)).toContain('range');
    expect(identifierFrom('moles of H+ or OH- remaining')).toBe('molesOfHOrOHRemaining');
    expect(identifierFrom('pH')).toBe('pH');
    expect(identifierFrom('equivalence volume (mL)')).toBe('equivalenceVolume');
    expect(identifierFrom('2nd harmonic')).toBe('v2ndHarmonic');
    const bad = { ...projectile.parameters[0], name: '???' };
    expect(rules(plan({ parameters: [bad, ...projectile.parameters.slice(1)] }))).toContain('schema');
  });

  it('reads the other ways models write singular points', () => {
    expect(singularPointList(undefined)).toEqual([]);
    expect(singularPointList({})).toEqual([]);
    expect(singularPointList({ f: [] })).toEqual([]);
    expect(singularPointList({ f: 8 })).toEqual([{ f: 8 }]);
    expect(singularPointList({ f: [8, 10] })).toEqual([{ f: 8 }, { f: 10 }]);
    expect(singularPointList([{ f: [8] }, { u: 8, f: 8 }])).toEqual([{ f: 8 }, { u: 8, f: 8 }]);
    expect(singularPointList('none')).toBeNull();
    const lens = plan({ singularPoints: { angle: 45 } });
    expect(validatePlan(lens).plan!.singularPoints).toEqual([{ angle: 45 }]);
  });

  it('clips long guidance instead of asking for a new plan', () => {
    const long = 'The ball flies along its path and the arrows ride with it while the vertical arrow shrinks to zero at the very top of the arc. '.repeat(4);
    const result = validatePlan(plan({ moves: long, steps: [long, 'Gravity changes the vertical velocity'] }));
    expect(result.problems).toEqual([]);
    expect(result.plan!.moves.length).toBeLessThanOrEqual(PLAN_LIMITS.text);
    expect(result.plan!.moves.endsWith('…')).toBe(true);
    expect(result.plan!.steps[0]!.length).toBeLessThanOrEqual(PLAN_LIMITS.text);
  });

  it('rejects outputs that no input can change, and drops one declared constant', () => {
    // A constant such as φ, declared with no dependencies, is dropped rather than worth a re-plan; an output that
    // depends on it and on an input stays.
    const outputs = [...projectile.model.outputs, { name: 'phi', dependsOn: [] }, { name: 'error', dependsOn: ['range', 'phi'] }];
    const constant = validatePlan(plan({ model: { ...projectile.model, outputs } }));
    expect(constant.problems).toEqual([]);
    expect(constant.plan!.model.outputs.map((o) => o.name)).toEqual([...projectile.model.outputs.map((o) => o.name), 'error']);
    const onlyConstant = [...projectile.model.outputs, { name: 'phi', dependsOn: [] }, { name: 'area', dependsOn: ['phi'] }];
    expect(rules(plan({ model: { ...projectile.model, outputs: onlyConstant } }))).toEqual(['unreachable-output']);
    const unknown = [...projectile.model.outputs, { name: 'drag', dependsOn: ['airDensity'] }];
    expect(rules(plan({ model: { ...projectile.model, outputs: unknown } }))).toEqual(['unreachable-output']);
    const twin = [...projectile.model.outputs, { name: 'drag', dependsOn: ['speed'] }];
    expect(rules(plan({ model: { ...projectile.model, outputs: twin } }))).toEqual([]);
  });

  it('lets an output depend on another output, and so on the inputs that one depends on', () => {
    // Once a plan for active transport was rejected twice: its gradient depended on the inside concentration, an output.
    const outputs = [
      { name: 'gradient', dependsOn: ['speed', 'range'] },
      { name: 'range', dependsOn: ['speed', 'angle', 'gravity'] },
      { name: 'spread', dependsOn: ['gradient'] },
    ];
    const result = validatePlan(plan({ model: { ...projectile.model, outputs } }));
    expect(result.problems).toEqual([]);
    expect(result.plan!.model.outputs).toEqual([
      { name: 'gradient', dependsOn: ['speed', 'angle', 'gravity'] },
      { name: 'range', dependsOn: ['speed', 'angle', 'gravity'] },
      { name: 'spread', dependsOn: ['speed', 'angle', 'gravity'] },
    ]);
    // Outputs that only depend on each other reach no input.
    const loop = [...projectile.model.outputs, { name: 'a', dependsOn: ['b'] }, { name: 'b', dependsOn: ['a'] }];
    expect(rules(plan({ model: { ...projectile.model, outputs: loop } }))).toEqual(['unreachable-output', 'unreachable-output']);
    // A name that is neither an input nor an output is still named.
    const stranger = [...projectile.model.outputs, { name: 'drag', dependsOn: ['speed', 'airDensity'] }];
    const named = validatePlan(plan({ model: { ...projectile.model, outputs: stranger } }));
    expect(named.problems.map((p) => p.rule)).toEqual(['unknown-input']);
    expect(named.problems[0]!.message).toContain('airDensity, which is neither an input nor an output');
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
    // A longer walkthrough keeps its first steps rather than going back for a re-plan: GLM 4.7 Flash wrote seven, twice.
    const steps = Array.from({ length: PLAN_LIMITS.steps + 2 }, (_, i) => `Step ${i + 1}`);
    const result = validatePlan(plan({ steps }));
    expect(result.problems).toEqual([]);
    expect(result.plan!.steps).toEqual(steps.slice(0, PLAN_LIMITS.steps));
  });

  it('keeps the singular points a learner can reach and drops the rest without a re-plan', () => {
    const lens = REFERENCE_SCENES['thin-lens']!.plan;
    const points = (singularPoints: unknown) => {
      const result = validatePlan({ ...structuredClone(lens), singularPoints });
      expect(result.problems).toEqual([]);
      return result.plan!.singularPoints;
    };
    expect(points([{ objectDistance: 8, focalLength: 8 }])).toEqual([{ objectDistance: 8, focalLength: 8 }]);
    expect(points([{ distance: 8 }])).toEqual([]);
    expect(points([{ objectDistance: 1000 }])).toEqual([]);
    expect(points([{}, 'f = 0', null])).toEqual([]);
    expect(points({ focalLength: 0, objectDistance: 0 })).toEqual([]);
    expect(points([{ objectDistance: 8, focalLength: 8 }, { objectDistance: 8, focalLength: 8 }])).toHaveLength(1);
  });

  it('normalizes what it can: whitespace, a missing describe capability, steps without the steps capability', () => {
    const result = validatePlan(plan({ concept: '  projectile   motion ', capabilities: ['graph2d', 'readout'] }));
    expect(result.plan?.concept).toBe('projectile motion');
    expect(result.plan?.capabilities).toEqual(['graph2d', 'readout', 'describe', 'steps']);
  });

  it('quotes its problems one per line for the re-plan request', () => {
    const { problems } = validatePlan(plan({ capabilities: ['graph2d', 'hologram'], idea: 'Projectiles.' }));
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
