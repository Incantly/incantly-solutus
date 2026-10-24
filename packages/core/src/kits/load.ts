import type { KitName, KitRegistry } from '../runtime/kits';
import { KIT_MODULES } from './generated';

/**
 * Loads the kits a scene calls, as modules in this realm: for figures mounted
 * in the page (trusted scenes) and for the probe outside a browser. Each kit
 * is its own chunk, so a page that never draws in 3D never downloads it.
 */
export async function loadKitModules(names: readonly KitName[]): Promise<KitRegistry> {
  const entries = await Promise.all(
    names.map(async (name) => {
      const load = KIT_MODULES[name];
      if (!load) throw new Error(`The ${name} kit is not part of this build`);
      return [name, await load()] as const;
    }),
  );
  return Object.freeze(Object.fromEntries(entries)) as KitRegistry;
}

/** The kits this build has. */
export function availableKits(): KitName[] {
  return Object.keys(KIT_MODULES) as KitName[];
}
