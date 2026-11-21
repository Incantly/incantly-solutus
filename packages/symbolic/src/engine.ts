/**
 * @incantly/symbolic/engine: the whole CAS engine, for this package's own tests and benches (`incantly.internal` in
 * package.json; other packages may not import it). Its functions throw `Unsupported`, `LimitExceeded` and
 * `BudgetExceeded` to unwind deep work; `run` in the package's main entry catches them and returns a `Result`.
 * Pure TypeScript: no DOM, timers, network or wall clock.
 */
export * from './contracts';
export * from './node';
export * from './num';
export * from './assume';
export * from './poly';
export * from './print';
export * from './parse';
export * from './rules';
export * from './solve';
export * from './calc';
export * from './equiv';
export * from './matrix';
export * from './steps';
export * from './run';
export * from './worker';
export * from './bridge';
export * from './ops';
export { casEngine, heldOf, setCasLanes } from './kernel-engine';
export type { LaneJob } from './kernel-engine';

export type { ErrorObject, Notice, ObjId, Result } from '@incantly/kernel';

import { arena as symbolicArena } from './node';

// Constants made by any module while loading are part of the arena's base set.
symbolicArena.markBase();
