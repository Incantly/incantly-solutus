/** @incantly/kernel: language, types, commands, rules, graph, clock, solver and errors. No DOM. */
export type * from './contracts/errors';
export type * from './contracts/values';
export { StateMachine, canTransition, transition } from './contracts/state-machine';
export type { MachineTable } from './contracts/state-machine';

// language
export * from './language/index';

// errors: registry, constructor, notices, phrases, limits
export * from './errors/index';

// the figure: store, graph, transactions, history
export { Figure, SCRIPT_VERSION } from './graph/figure';
export type { Step, LoadOpts, LoadReport, ScriptOpts, ObjectView, Slice } from './graph/figure';
export type { FigureOptions } from './graph/core';

// command registry: the hooks the command areas plug into
export { CommandRegistry, RuleUndefined, undef, formGroup } from './graph/registry';
export type { CommandRule, RuleCall, InvertCall, ActionRule, ActionCall, ActionOutcome } from './graph/registry';
export { KERNEL_ACTIONS, kernelActionSpecs } from './graph/actions';

// figure shapes
export type {
  Cell, ColorSpec, Props, EffectiveStyle, StyleEntry, FigureEvent, FrameDelta, UndefChange, ChangeReport, UndefinedName,
  TxOk, TxOp, TxResult, ApplyOptions, BatchOptions, BatchResult, Description, LineGate, GateCall, LineOrigin,
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
export * as text from './commands/text/index';
export { registerSound, soundsAt, soundEvents, clearSoundEvents, isMuted, setMuted, isSoundValue, soundText, SOUND_LIMITS, SOUND_SPECS, WAVES, NOISE_COLORS } from './commands/sound/index';
export type { SoundValue, SoundEvent, SoundFrame, PlayingSound, Wave, NoiseColor } from './commands/sound/index';
export * as space from './commands/space/index';
export { registerSpace } from './commands/space/index';
export * as physics from './commands/physics/index';
export { registerPhysics, physicsOf, physics3Of, worldDriverOf, physicsKernelsActive, physicsGridSimd } from './commands/physics/index';
export * as physicsMath from './physics/math';
export { setPhysicsKernels, setPhysicsGridSimd, physicsKernelsOn, initPhysicsKernels } from './physics/wasm/kernels';
export { noteFrequency, midiOfNote, midiToFrequency, semitonesUp } from './language/notes';
export {
  registerSheet, sheetSize, rangeReadersOf, undefinedCode, UNDEFINED_CODES, SHEET_LIMITS, SHEET_SPECS, shiftRefs, shiftLine, planFill, planClear, applyPlan, applyFill, cellMarks,
  setSheetLocks, sheetLocksOn, literalOf, PASTE_LIMITS, splitDelimited, pasteSeparator, detectSeparator, parseField, planPaste, planImport, planPasteCells,
  copyText, applyPaste, applyImport, applyPasteCells,
} from './commands/sheet/index';
export type {
  ShiftResult, FillPlan, FillDirection, CellMark, SheetWrite, Separator, Field, PastePlan, ImportOptions, CellClip, PasteCellsOptions, PasteResult,
} from './commands/sheet/index';
export * from './language/cells';
export { registerText } from './commands/text/index';
export { CAS_COMMAND_NAMES, CAS_TYPE_NAMES, casCalculus, casEngineReady, isCasForm, isSymValue, onCasEngine, registerCas, setCasEngine } from './commands/cas/index';
export type { CasArgIn, CasCalculus, CasCommand, CasEngine, CasForm, CasHost, CasOut, CasParam, SymPlot, SymValue } from './commands/cas/index';
export { DEFAULT_FORMAT, describeObject, formatNumber, fractionOf, lineEquation, niceRange, prettyText, speechText, summarize, valueTextOf } from './algebra/format';
export type { ObjectFacts, Summary, ValueFormat } from './algebra/format';
