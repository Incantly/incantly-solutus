/** The command table of every area built so far: geometry, numbers, functions, animation, lists, statistics, probability, text and logic. */
import {
  CommandRegistry, geometry, registerAnimation, registerFunctions, registerLists, registerNumbers, registerProbability, registerStatistics, registerText,
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
  registerText(r);
  shared = r;
  return r;
}
