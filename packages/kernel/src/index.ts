/** @incantly/kernel: language, types, commands, rules, graph, clock, solver and errors. No DOM. */
export type * from './contracts/errors';
export type * from './contracts/values';

// language
export * from './language/index';

// errors: registry, constructor, notices, phrases, limits
export * from './errors/index';

// the figure: store, graph, transactions, history
export { Figure, SCRIPT_VERSION } from './graph/figure';
export type { Step, LoadOpts, LoadReport, ScriptOpts, ObjectView, Slice } from './graph/figure';
export type { FigureOptions } from './graph/core';

// command registry: the hooks the command areas plug into
export { CommandRegistry, RuleUndefined, undef } from './graph/registry';
export type { CommandRule, RuleCall, InvertCall, ActionRule, ActionCall, ActionOutcome } from './graph/registry';
export { KERNEL_ACTIONS, kernelActionSpecs } from './graph/actions';

// figure shapes
export type {
  Cell, ColorSpec, Props, EffectiveStyle, StyleEntry, FigureEvent, FrameDelta, UndefChange, ChangeReport, UndefinedName,
  TxOk, TxOp, TxResult, ApplyOptions, BatchOptions, BatchResult, Description,
} from './graph/types';
export type { WriteWhy, WriteResult, SetFreeOptions, DragPlan, DragWrite, MovePlan, UndoUnit, FrameDeltaResult } from './graph/hist';
export type { UndoInfo } from './history/journal';
export { defaultsFor, colorFromWord, colorHex, toColor, validKeysFor, registerPropertyTypes, registerTypeStyle } from './graph/props';
export type { TypeStyle } from './graph/props';
export { sameValue, valueSource, numberSource } from './graph/values';
export { StateSolver } from './clock/solver';
export * as geometry from './commands/geometry/index';
export * from './commands/numbers/index';
export * from './commands/functions/index';
export * from './commands/animation/index';
export * from './commands/lists/index';
export * from './commands/statistics/index';
export * from './commands/probability/index';
export { DEFAULT_FORMAT, describeObject, formatNumber, fractionOf, lineEquation, niceRange, prettyText, speechText, summarize, valueTextOf } from './algebra/format';
export type { ObjectFacts, Summary, ValueFormat } from './algebra/format';
