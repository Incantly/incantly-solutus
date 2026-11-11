/**
 * @incantly/symbolic: the CAS layer, loaded on demand. Exact expressions, simplify,
 * expand, factor, solve, derivative, integral, limits, steps and whole-number tools.
 * Pure TypeScript: no DOM, timers, network or wall clock. Nothing throws across this
 * boundary: public functions return `Result<T>`.
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

export type { ErrorObject, Notice, ObjId, Result } from '@incantly/kernel';
