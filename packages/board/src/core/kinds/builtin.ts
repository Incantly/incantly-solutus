/** The kinds this build draws, in the order they are registered; a host's own kinds are added to the same registry. */
import type { KindDef } from './def';
import { KindRegistry } from './def';
import { ellipseKind, diamondKind, rectKind, starKind, triangleKind } from './boxes';
import { frameKind, groupKind } from './containers';
import { inkKind } from './ink';
import { arrowKind, lineKind } from './lines';
import { figureKind, imageKind } from './media';
import { stickyKind, textKind } from './texts';

export const BUILT_IN_KINDS: readonly KindDef[] = [
  inkKind as KindDef,
  rectKind as KindDef,
  ellipseKind as KindDef,
  triangleKind as KindDef,
  diamondKind as KindDef,
  starKind as KindDef,
  lineKind as KindDef,
  arrowKind as KindDef,
  textKind as KindDef,
  stickyKind as KindDef,
  frameKind as KindDef,
  imageKind as KindDef,
  figureKind as KindDef,
  groupKind as KindDef,
];

const byName: ReadonlyMap<string, KindDef> = new Map(BUILT_IN_KINDS.map((d) => [d.kind, d]));

/** The built-in definition of a kind name, for code that has no registry at hand. */
export const builtInKind = (kind: string): KindDef | undefined => byName.get(kind);

/** Registers the built-in kinds that a registry does not have yet. */
export function registerBuiltIns(kinds: KindRegistry): void {
  for (const def of BUILT_IN_KINDS) if (!kinds.has(def.kind)) kinds.register(def);
}
