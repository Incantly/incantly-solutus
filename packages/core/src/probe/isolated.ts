import { createFuel, isErrorLike, type FuelTank } from '../runtime/fuel';
import type { SceneFunction } from '../runtime/runtime';
import { bindScene, wrapSceneSource, WRAPPER_LINES_BEFORE, type SceneFactory } from '../sandbox/scene-wrapper';
import { locateInStack, type SceneLocation } from '../sandbox/stack';
import type { ValidatedScene } from '../validation';

/** The script name isolated scenes are compiled under, so stack frames can be told apart from the host's. */
export const ISOLATED_SCRIPT_NAME = 'incantly-agent-scene.js';

/**
 * Evaluates a script in an isolated context and returns its completion value:
 * in Node, `new vm.Script(source, { filename }).runInContext(context)`.
 */
export type ScriptEvaluator = (source: string, filename: string) => unknown;

export interface IsolatedScene {
  readonly scene: SceneFunction;
  /** Refuel before every runtime step, as the Worker does before every message. */
  readonly fuel: FuelTank;
  /** Maps an error the scene threw back to the agent's own line and column. */
  readonly locate: (error: unknown) => SceneLocation | null;
}

/**
 * Compiles validated, instrumented scene code with the evaluator of an
 * isolated context, for probing outside a browser: the offline eval harness
 * runs generated scenes this way. Browsers never use it; they run scenes only
 * in the sandboxed Worker. The scene is wrapped exactly as in the Worker, so
 * it sees the same five names and the same fuel and key guards.
 */
export function compileIsolated(scene: ValidatedScene, evaluate: ScriptEvaluator): IsolatedScene {
  const factory = evaluate(wrapSceneSource(scene.instrumented.code), ISOLATED_SCRIPT_NAME);
  if (typeof factory !== 'function') throw new TypeError('The scene did not compile to a function');
  const fuel = createFuel();
  const map = {
    lineOffset: WRAPPER_LINES_BEFORE,
    sceneLines: scene.instrumented.code.split('\n').length,
    shifts: scene.instrumented.shifts,
    file: ISOLATED_SCRIPT_NAME,
  };
  return {
    scene: bindScene(factory as SceneFactory, fuel.burn),
    fuel,
    locate: (error) => (isErrorLike(error) && typeof error.stack === 'string' ? locateInStack(error.stack, map) : null),
  };
}
