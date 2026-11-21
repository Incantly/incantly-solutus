/**
 * @incantly/symbolic: the CAS layer, loaded on demand. Exact expressions, simplify, expand, factor, solve, derivative,
 * integral, limits, steps and whole-number tools, all through `run` (one operation under a budget, as a `Result`), the
 * worker lane and the kernel's engine hook. Nothing throws across this boundary. The engine's inner functions, which
 * unwind with exceptions, are in `./engine` for this package's tests only.
 * Pure TypeScript: no DOM, timers, network or wall clock.
 */
// loads every module and marks the arena's base set, as the engine entry does
import './engine';

export * from './contracts';
export { ENGINE_VERSION, acceptWorkerResult, clearCache, run, seedCache } from './run';
export type { RunOptions, RunSuccess } from './run';
export * from './worker';
export { casEngine, heldOf, setCasLanes } from './kernel-engine';
export type { LaneJob } from './kernel-engine';

// the engine's types stay public: they describe what `run` takes and gives
export type * from './node';
export type * from './num';
export type * from './assume';
export type * from './poly';
export type * from './print';
export type * from './parse';
export type * from './rules';
export type * from './solve';
export type * from './calc';
export type * from './equiv';
export type * from './matrix';
export type * from './steps';
export type * from './run';
export type * from './bridge';
export type * from './ops';

export type { ErrorObject, Notice, ObjId, Result } from '@incantly/kernel';
