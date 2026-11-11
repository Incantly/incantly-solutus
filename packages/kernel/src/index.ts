/** @incantly/kernel: language, types, commands, rules, graph, clock, solver and errors. No DOM. */
export type * from './contracts/errors';
export type * from './contracts/values';

// language
export * from './language/index';

// errors: registry, constructor, notices, phrases, limits
export * from './errors/index';

// the figure: store, graph, transactions, history
export { Figure } from './graph/figure';
export type { FigureOptions } from './graph/core';
