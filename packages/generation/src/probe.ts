import { createContext, Script } from 'node:vm';
import { compileIsolated, probeScene, type ProbeReport, type ProbeSpec, type ScenePlan, type ValidatedScene } from '@incantly/core';

/** Probes a validated scene against what its plan declares. */
export type SceneProber = (scene: ValidatedScene, spec: ProbeSpec) => Promise<ProbeReport>;

/** What the probe checks from a plan: names and numbers only, so the same spec can go to a learner's device. */
export function probeSpecFor(plan: ScenePlan): ProbeSpec {
  return { parts: [...plan.parts], steps: plan.steps.length, singularPoints: [...(plan.singularPoints ?? [])] };
}

/**
 * The probe outside a browser, for the eval harness and tests: the core
 * probe on a scene compiled in a fresh context that has no Node globals and
 * cannot turn strings into code, after the same validation, instrumentation
 * and wrapper as in the browser. Learners' figures are probed on their own
 * device in the sandbox instead (RP-1).
 */
export const isolatedProbe: SceneProber = (scene, spec) => {
  const context = createContext(Object.create(null) as object, { codeGeneration: { strings: false, wasm: false } });
  let compiled;
  try {
    compiled = compileIsolated(scene, (source, filename) => new Script(source, { filename }).runInContext(context, { timeout: 1000 }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Promise.resolve({
      ok: false,
      failures: [{ check: 'mount', message: `The scene did not compile: ${message}` }],
      stats: { configurations: 0, frames: 0, averageFrameMs: 0, elements: 0, durationMs: 0 },
    });
  }
  return Promise.resolve(probeScene(compiled.scene, { spec, beforeStep: compiled.fuel.refuel, runtime: { locate: compiled.locate } }));
};
