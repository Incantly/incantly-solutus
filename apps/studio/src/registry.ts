/** The command table of every area built so far: geometry, numbers, functions, animation, lists, statistics, probability. */
import {
  CommandRegistry, geometry, registerAnimation, registerFunctions, registerLists, registerNumbers, registerProbability, registerStatistics,
} from '@incantly/kernel';

let shared: CommandRegistry | undefined;

export function studioRegistry(): CommandRegistry {
  if (shared) return shared;
  const r = new CommandRegistry();
  geometry.registerGeometry(r);
  registerNumbers(r);
  registerFunctions(r);
  registerAnimation(r);
  registerLists(r);
  registerStatistics(r);
  registerProbability(r);
  shared = r;
  return r;
}
