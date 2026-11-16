/**
 * Every command area in one table, for apps the SDK makes. The CAS catalogue is data; its engine loads on demand where
 * the host wires it (the studio does).
 */
import {
  CommandRegistry, geometry, registerAnimation, registerCas, registerFunctions, registerLists, registerNumbers, registerProbability, registerSheet,
  registerSound, registerSpace, registerStatistics, registerText,
} from '@incantly/kernel';
import { SYMBOLIC_COMMANDS } from '@incantly/symbolic/catalogue';

let shared: CommandRegistry | undefined;

/** The shared table of every area (one per page: the areas register their hooks once). */
export function sdkRegistry(): CommandRegistry {
  if (shared) return shared;
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerLists(r);
  registerStatistics(r);
  registerProbability(r);
  registerText(r);
  registerSound(r);
  registerSpace(r);
  registerSheet(r);
  registerCas(r, SYMBOLIC_COMMANDS);
  shared = r;
  return r;
}
