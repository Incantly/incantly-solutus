import { beforeAll, describe, expect, it } from 'vitest';
import { compileTrusted } from '../src/engine/mount';
import { loadKitModules } from '../src/kits/load';
import { SIZE_BUDGETS } from '../src/protocol/plan';
import type { KitRegistry } from '../src/runtime/kits';
import { SceneRuntime } from '../src/runtime/runtime';
import { REFERENCE_SCENES, referenceSceneIds } from '../src/scenes';
import { validateScene } from '../src/validation';

const FRAME = 1 / 60;

describe.each(referenceSceneIds())('reference scene %s', (id) => {
  const scene = REFERENCE_SCENES[id]!;
  const budget = SIZE_BUDGETS[scene.plan.size ?? 'quick'];
  let kits: KitRegistry = {};

  beforeAll(async () => {
    kits = await loadKitModules(validateScene(scene).scene?.kits ?? []);
  });

  function mount(values?: Record<string, number>) {
    const runtime = new SceneRuntime({ autoplay: false, kits, ...(values ? { values } : {}) });
    const first = runtime.mount(compileTrusted(scene.js));
    runtime.tick(FRAME);
    return { runtime, first };
  }

  it('mounts without errors and declares what its plan promises', () => {
    const { runtime, first } = mount();
    expect(first.ui.error).toBeNull();
    const ui = runtime.uiState();
    expect(ui.params.map((p) => p.name)).toEqual(scene.plan.parameters.map((p) => p.name));
    for (const p of scene.plan.parameters) {
      expect(ui.params.find((v) => v.name === p.name)).toMatchObject({ min: p.min, max: p.max, defaultValue: p.default });
    }
    expect(ui.parts.map((p) => p.name).sort()).toEqual([...scene.plan.parts].sort());
    expect(ui.idea).toBe(scene.plan.idea);
    expect(ui.description).toBeTruthy();
    expect(ui.explanation).toBeTruthy();
    expect(ui.steps?.count).toBe(scene.plan.steps.length);
  });

  it('stays within the budgets for its size', () => {
    const { runtime } = mount();
    expect(runtime.graph.size).toBeLessThanOrEqual(budget.elements);
    expect(runtime.uiState().params.length).toBeLessThanOrEqual(budget.controls);
    expect(scene.plan.parts.length).toBeLessThanOrEqual(budget.parts);
    // Reviewed scenes are the examples generation follows and adapts, and replies grow
    // like their examples, so each stays well inside the reply budget for its size.
    expect(Math.ceil(scene.js.length / 3.5)).toBeLessThanOrEqual(budget.sceneTokens * 0.6);
  });

  it('is finite and error-free at every parameter minimum, default and maximum', () => {
    for (const p of scene.plan.parameters) {
      for (const value of [p.min, p.default, p.max]) {
        const { runtime } = mount({ [p.name]: value });
        for (let i = 0; i < 30; i++) {
          runtime.play();
          runtime.tick(FRAME);
        }
        expect(runtime.errors, `${p.name}=${value}`).toEqual([]);
        expect(runtime.graph.diagnostics.filter((d) => d.kind === 'non-finite'), `${p.name}=${value}`).toEqual([]);
        expect(runtime.uiState().readouts.every((r) => r.text !== '—'), `${p.name}=${value}`).toBe(true);
      }
    }
  });

  it('changes its drawing when each parameter changes while paused', () => {
    for (const p of scene.plan.parameters) {
      const { runtime } = mount();
      runtime.setParam(p.name, p.default === p.max ? p.min : p.max);
      const update = runtime.tick(FRAME);
      const changed = update.commands.length > 0 || update.ui.readouts !== undefined;
      expect(changed, p.name).toBe(true);
    }
  });
});
