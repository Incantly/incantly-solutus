/**
 * The command table of every area built so far: geometry, numbers, functions, animation, lists, statistics, probability,
 * text and logic, and the CAS. The CAS catalogue is data; the algebra engine itself loads on demand (`loadCasEngine`).
 */
import {
  CommandRegistry, casEngineReady, geometry, registerAnimation, registerCas, registerFunctions, registerLists, registerNumbers, registerProbability,
  registerStatistics, registerText, setCasEngine,
} from '@incantly/kernel';
import { SYMBOLIC_COMMANDS } from '@incantly/symbolic/catalogue';
import { startCasLanes } from './caslane';

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
  registerCas(r, SYMBOLIC_COMMANDS);
  shared = r;
  return r;
}

let loading: Promise<boolean> | undefined;
const answerListeners = new Set<() => void>();

/** Runs `f` each time the CAS worker answers a job. */
export function onCasAnswer(f: () => void): () => void {
  answerListeners.add(f);
  return () => answerListeners.delete(f);
}

/**
 * Loads the algebra engine (its own chunk) and hands it to the kernel. Resolves true once it is in. A figure with no
 * algebra never waits for it; objects made before it arrived are `pending` until the session refreshes them.
 */
export function loadCasEngine(): Promise<boolean> {
  if (casEngineReady()) return Promise.resolve(true);
  loading ??= import('@incantly/symbolic')
    .then((m) => {
      setCasEngine(m.casEngine);
      // heavy calls past a few milliseconds go to a worker (design 5.13); its answers recompute the waiting objects
      startCasLanes(() => {
        for (const f of [...answerListeners]) f();
      });
      return true;
    })
    .catch(() => false);
  return loading;
}
