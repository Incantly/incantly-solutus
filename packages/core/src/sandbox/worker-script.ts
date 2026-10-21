import type { KitName } from '../runtime/kits';
import { WORKER_SCRIPT } from './generated/bundles';
import { KIT_SCRIPTS } from './generated/kit-scripts';

/**
 * The Worker script for a scene: the base runtime, then each kit the scene
 * calls. Kit scripts load only when a scene needs them (PRD: "kits load on
 * demand") and register themselves before the scene runs.
 */
export async function workerScriptFor(kits: readonly KitName[]): Promise<string> {
  if (kits.length === 0) return WORKER_SCRIPT;
  const scripts = await Promise.all(
    kits.map((name) => {
      const load = KIT_SCRIPTS[name];
      if (!load) return Promise.reject(new Error(`The ${name} kit is not part of this build`));
      return load();
    }),
  );
  return [WORKER_SCRIPT, ...scripts].join('\n');
}
