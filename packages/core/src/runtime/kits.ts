import type { ViewBox } from '../api/types';
import type { KitContext } from './kit';

/**
 * Kits are drawing modules the base runtime does not carry: 3D, physics,
 * charts, flowcharts and chemistry (PRD 30: "kits load on demand"; DG-6). The validator
 * records which a scene calls; the host then loads only those, as modules on
 * the page or as scripts joined to the sandbox Worker ahead of the scene.
 */
export type KitName = 'space3d' | 'physics2d' | 'chart' | 'flow' | 'chemistry';

/** The inc calls kits answer. */
export type KitCall = 'space3d' | 'graph3d' | 'physics2d' | 'chart' | 'flow' | 'chemistry';

export const KIT_NAMES: readonly KitName[] = ['space3d', 'physics2d', 'chart', 'flow', 'chemistry'];

/** The kit behind each call. */
export const KIT_OF: Readonly<Record<KitCall, KitName>> = Object.freeze({
  space3d: 'space3d',
  graph3d: 'space3d',
  physics2d: 'physics2d',
  chart: 'chart',
  flow: 'flow',
  chemistry: 'chemistry',
});

export function isKitCall(name: string): name is KitCall {
  return Object.hasOwn(KIT_OF, name);
}

/** One inc call a kit answers. */
export interface KitEntry {
  /** Checks the call's options and returns the stage's size and clip. */
  layout(options: unknown): { readonly viewBox: ViewBox; readonly clip?: ViewBox };
  /** Builds what the call returns, on the stage the runtime made for it. */
  create(ctx: KitContext, options: unknown): unknown;
}

export interface KitModule {
  readonly name: KitName;
  readonly calls: Readonly<Partial<Record<KitCall, KitEntry>>>;
}

export type KitRegistry = Readonly<Partial<Record<KitName, KitModule>>>;

/** Where kit scripts joined to the sandbox Worker register themselves before the scene runs. */
export const KIT_GLOBAL = '__incKits';

/** The kits a list of calls needs, each once, in a stable order. */
export function kitsFor(calls: Iterable<string>): KitName[] {
  const needed = new Set<KitName>();
  for (const call of calls) if (isKitCall(call)) needed.add(KIT_OF[call]);
  return KIT_NAMES.filter((name) => needed.has(name));
}

export function isKitModule(value: unknown): value is KitModule {
  if (typeof value !== 'object' || value === null) return false;
  const { name, calls } = value as { name?: unknown; calls?: unknown };
  return typeof name === 'string' && (KIT_NAMES as readonly string[]).includes(name) && typeof calls === 'object' && calls !== null;
}
