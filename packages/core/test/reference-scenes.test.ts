import { describe, expect, it } from 'vitest';
import { compileTrusted } from '../src/engine/mount';
import { SceneRuntime } from '../src/runtime/runtime';
import { REFERENCE_SCENES, referenceSceneIds } from '../src/scenes';

const FRAME = 1 / 60;

describe.each(referenceSceneIds())('reference scene %s', (id) => {
  const scene = REFERENCE_SCENES[id]!;

  function mount(values?: Record<string, number>) {
    const runtime = new SceneRuntime({ autoplay: false, ...(values ? { values } : {}) });
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
    expect(ui.steps?.count).toBeGreaterThanOrEqual(2);
  });

  it('stays within the v0.1 budgets', () => {
    const { runtime } = mount();
    expect(runtime.graph.size).toBeLessThanOrEqual(300);
    expect(runtime.uiState().params.length).toBeLessThanOrEqual(3);
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
