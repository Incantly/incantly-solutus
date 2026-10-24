import { createContext, Script } from 'node:vm';
import {
  compileIsolated,
  loadKitModules,
  offlineChecks,
  probeScene,
  SIZE_BUDGETS,
  type OfflineReport,
  type ProbeReport,
  type ProbeSpec,
  type ScenePlan,
  type ValidatedScene,
} from '@incantly/core';

/** Probes a validated scene against what its plan declares. */
export type SceneProber = (scene: ValidatedScene, spec: ProbeSpec) => Promise<ProbeReport>;

/** What the probe checks from a plan: names and numbers only, so the same spec can go to a learner's device. */
export function probeSpecFor(plan: ScenePlan): ProbeSpec {
  return { parts: [...plan.parts], steps: plan.steps.length, singularPoints: [...(plan.singularPoints ?? [])], elements: SIZE_BUDGETS[plan.size ?? 'quick'].elements };
}

/**
 * The probe outside a browser, for the eval harness and tests: the core
 * probe on a scene compiled in a fresh context that has no Node globals and
 * cannot turn strings into code, after the same validation, instrumentation
 * and wrapper as in the browser. Learners' figures are probed on their own
 * device in the sandbox instead (RP-1).
 */
export const isolatedProbe: SceneProber = async (scene, spec) => {
  let compiled;
  try {
    compiled = compile(scene);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      failures: [{ check: 'mount', message: `The scene did not compile: ${message}` }],
      stats: { configurations: 0, frames: 0, averageFrameMs: 0, elements: 0, durationMs: 0 },
    };
  }
  const kits = await loadKitModules(scene.kits);
  return probeScene(compiled.scene, { spec, beforeStep: compiled.fuel.refuel, runtime: { locate: compiled.locate, kits } });
};

/** A scene compiled in a fresh context that has no Node globals and cannot turn strings into code. */
function compile(scene: ValidatedScene) {
  const context = createContext(Object.create(null) as object, { codeGeneration: { strings: false, wasm: false } });
  return compileIsolated(scene, (source, filename) => new Script(source, { filename }).runInContext(context, { timeout: 1000 }));
}

/** Runs the offline checks on an approved scene: the depth-order audit, and for a diagram the line-end check. */
export type OfflineChecker = (scene: ValidatedScene, plan: ScenePlan) => Promise<OfflineReport>;

/**
 * The offline checks (CH-2) outside a browser, for the eval harness: the
 * depth-order audit of every 3D stage at every turn, and the line-end check
 * when the plan is a diagram. They report; they never stop a learner's figure.
 */
export const isolatedOffline: OfflineChecker = async (scene, plan) => {
  let compiled;
  try {
    compiled = compile(scene);
  } catch (error) {
    return { ok: false, turns: 0, violations: [], crossing: 0, ring: 0, looseEnds: [], error: error instanceof Error ? error.message : String(error) };
  }
  const kits = await loadKitModules(scene.kits);
  return offlineChecks(compiled.scene, { runtime: { locate: compiled.locate, kits }, beforeStep: compiled.fuel.refuel, lineEnds: plan.kind === 'diagram' });
};
