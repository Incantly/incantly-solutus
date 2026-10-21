import { createFuel, type FuelTank } from '../../src/runtime/fuel';
import type { SceneFunction } from '../../src/runtime/runtime';
import { bindScene, wrapSceneSource, type SceneFactory } from '../../src/sandbox/scene-wrapper';
import { formatDiagnostic, validateScene } from '../../src/validation';

export interface CompiledScene {
  readonly scene: SceneFunction;
  readonly fuel: FuelTank;
}

/**
 * Validates, instruments and wraps a scene exactly as the Worker does, then
 * compiles it with new Function. Tests only: the Worker never uses eval.
 */
export function compileValidated(fragments: { html: string; css: string; js: string }, fuelLimit?: number): CompiledScene {
  const result = validateScene(fragments);
  if (!result.ok || !result.scene) {
    throw new Error(`Scene failed validation:\n${result.diagnostics.map(formatDiagnostic).join('\n')}`);
  }
  const factory = new Function(`return ${wrapSceneSource(result.scene.instrumented.code)}`)() as SceneFactory;
  const fuel = createFuel(fuelLimit);
  return { scene: bindScene(factory, fuel.burn), fuel };
}
