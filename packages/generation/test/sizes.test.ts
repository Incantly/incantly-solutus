import { SCENE_LIMITS, SCENE_SIZES, SIZE_BUDGETS, validateScene, type SceneSize } from '@incantly/core';
import { REFERENCE_SCENES } from '@incantly/core/scenes';
import { describe, expect, it } from 'vitest';
import { ScriptedModel } from '../src/models';
import { Generator } from '../src/pipeline';
import { validatePlan } from '../src/plan';
import { isolatedProbe, probeSpecFor } from '../src/probe';

/**
 * Size classes (PL-3): quick, standard and rich each have their own budget of
 * controls, parts, drawn elements and reply tokens, and every check that
 * enforces one reads the plan's size: the plan validator, the scene
 * validator, the probe and the scene call.
 */

const projectile = REFERENCE_SCENES.projectile!.plan;

/** A plan of this size with n parameters and m parts. */
function planOf(size: SceneSize, n: number, m: number) {
  const names = Array.from({ length: n }, (_, i) => `p${i + 1}`);
  return {
    ...structuredClone(projectile),
    size,
    parameters: names.map((name) => ({ name, unit: 'm', min: 0, max: 10, default: 5, why: 'a length the learner can reach' })),
    model: { inputs: names, outputs: [{ name: 'total', dependsOn: names }] },
    parts: Array.from({ length: m }, (_, i) => `Part ${i + 1}`),
  };
}

/** A scene with n sliders and e circles. */
function sceneOf(n: number, e: number) {
  const params = Array.from({ length: n }, (_, i) => `const p${i + 1} = inc.param('p${i + 1}', { min: 0, max: 10, value: 5, label: 'P${i + 1}' });`);
  return {
    html: "<div id='stage'></div>",
    css: '',
    js: [
      "inc.idea('Circles in a row: each slider moves one of them.');",
      ...params,
      "const stage = inc.svg('#stage', { viewBox: [0, 0, 400, 200], title: 'Row' });",
      `for (let i = 0; i < ${e}; i++) stage.circle(10 + (i % 40) * 9, 10 + Math.floor(i / 40) * 9, 3, { tone: 'mid' });`,
      `const dot = stage.circle(200, 100, 6, { tone: 'lit' });`,
      `inc.onFrame(() => dot.set({ cx: 150 + ${n > 0 ? 'p1.value * 10' : '0'} }));`,
      "inc.describe(() => 'A row of circles.');",
    ].join('\n'),
  };
}

describe('size classes (PL-3)', () => {
  it('gives each size its own controls and parts in the plan', () => {
    for (const size of SCENE_SIZES) {
      const { controls, parts } = SIZE_BUDGETS[size];
      expect(validatePlan(planOf(size, controls, parts)).problems, size).toEqual([]);
      expect(validatePlan(planOf(size, controls + 1, parts)).problems.map((p) => p.rule), size).toContain('too-many-params');
      expect(validatePlan(planOf(size, controls, parts + 1)).problems.map((p) => p.rule), size).toContain('too-many-parts');
    }
    // Each size allows more than the one before it.
    expect(SIZE_BUDGETS.quick.controls).toBeLessThan(SIZE_BUDGETS.standard.controls);
    expect(SIZE_BUDGETS.standard.controls).toBeLessThan(SIZE_BUDGETS.rich.controls);
    expect(SIZE_BUDGETS.quick.elements).toBeLessThan(SIZE_BUDGETS.standard.elements);
    expect(SIZE_BUDGETS.standard.elements).toBeLessThan(SIZE_BUDGETS.rich.elements);
  });

  it('lets a scene declare as many controls as its size allows', () => {
    for (const size of SCENE_SIZES) {
      const { controls } = SIZE_BUDGETS[size];
      const limits = { ...SCENE_LIMITS, params: controls };
      expect(validateScene(sceneOf(controls, 4), { limits }).ok, size).toBe(true);
      const over = validateScene(sceneOf(controls + 1, 4), { limits });
      expect(over.ok, size).toBe(false);
    }
  });

  it('probes a scene against the element budget of its size', async () => {
    const between = Math.round((SIZE_BUDGETS.quick.elements + SIZE_BUDGETS.standard.elements) / 2);
    const scene = validateScene(sceneOf(1, between), { limits: { ...SCENE_LIMITS, params: 3 } }).scene!;
    const quick = await isolatedProbe(scene, probeSpecFor({ ...validatePlan(planOf('quick', 1, 1)).plan!, parts: [], steps: [] }));
    const standard = await isolatedProbe(scene, probeSpecFor({ ...validatePlan(planOf('standard', 1, 1)).plan!, parts: [], steps: [] }));
    expect(quick.failures.map((f) => f.check)).toContain('budget');
    expect(standard.failures.map((f) => f.check)).not.toContain('budget');
  });

  it('gives the scene call the reply tokens of the plan’s size', async () => {
    for (const size of SCENE_SIZES) {
      const plan = validatePlan(planOf(size, 2, 2)).plan!;
      const limits: number[] = [];
      const model = new ScriptedModel((call) => {
        if (call.purpose === 'scene') limits.push(call.maxTokens);
        return '```html\n<div id="stage"></div>\n```\n```css\n```\n```js\ninc.idea("x");\n```';
      });
      const generator = new Generator({ model, adapt: false, retrieve: false, maxRepairs: 0 });
      const state = generator.begin();
      state.plan = plan;
      await generator.buildStage(state);
      expect(limits, size).toEqual([SIZE_BUDGETS[size].sceneTokens]);
    }
  });
});
