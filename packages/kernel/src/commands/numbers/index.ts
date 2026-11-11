/**
 * Numbers, sliders, booleans, controls and scripting: public API.
 *
 * Register with `registerNumbers(registry)`, then build figures with the
 * registry (and `withNumbersFunctions()` for the sig/snap/wrap/approx group).
 * Registration only appends to the kernel's area hooks; nothing else changes.
 */

import type { CommandRegistry } from '../../graph/registry';
import { registerNumbersCommands } from './commands';
import { registerNumbersErrors } from './errors';
import { registerNumbersProperties } from './props';

/** Register every command, property, field, notice and phrase of this area. Idempotent. */
export function registerNumbers(registry: CommandRegistry): void {
  registerNumbersErrors();
  registerNumbersProperties();
  registerNumbersCommands(registry);
}

export type {
  AngleUnit,
  NumberDisplay,
  Bound,
  LoopMode,
  SliderSpec,
  AnimAnchor,
  NumberObject,
  BoolObject,
  Placement,
  SliderView,
  BoolView,
  ButtonValue,
  ChoiceValue,
  InputValue,
  HandlerEvent,
  SkipReason,
  StepResult,
  HandlerRun,
  ControlEvent,
} from './types';
export { NUMBERS_LIMITS } from './types';

export { numbersError, numbersNotice, registerNumbersErrors } from './errors';

export { unitScale, decimals, nice, autoStep, commit, validateSliderRange } from './commit';
export type { CommitSource, CommitOpts, CommitResult, RangeCheck } from './commit';

export {
  animRandom,
  animFraction,
  onceFinished,
  onceEndTime,
  startDir,
  animationValueAt,
  getAnchor,
  animatingIds,
  lastTickT,
  setAnchor,
  clearAnchor,
  pauseAnimation,
  resumeAnimation,
  tickAnimations,
} from './animate';
export type { AnimationValueOpts, TickReport } from './animate';

export {
  DASH,
  DEGREE,
  formatDisplayNumber,
  formatAuralNumber,
  ACCEPTED_SPECS,
  parseFormatSpec,
  formatWithSpec,
  setFigureDefaults,
  resolveDisplay,
  formatObjectNumber,
} from './format';
export type { FormatSpec, FigureDefaults } from './format';

export { TURN, GRAD, sigNumber, snapNumber, wrapNumber, approxNumber, numbersFunctionSpecs, withNumbersFunctions, constantsAgree } from './maths';

export {
  registerNumbersProperties,
  placementOf,
  parsePlacement,
  labelOf,
  buttonLabelOf,
  captionsOf,
  isClickable,
  resumeOf,
  loopOf,
  periodOf,
  seedOf,
  inferUnitFromDefinition,
  displayUnitOf,
  minOf,
  maxOf,
  stepOf,
  orientationOf,
  lengthOf,
} from './props';

export { checkProbeLine, evalTNode, substituteLine, valueLiteralText, valueLiteralExpr, numLiteral, boolLiteral, textLiteral, pointLiteral } from './eval';
export type { Binding, ProbeOptions, EvalOutcome } from './eval';

export {
  onControlEvent,
  emitControlEvent,
  parseHandlerLine,
  addHandler,
  clearHandler,
  listHandlers,
  lastRuns,
  brokenSteps,
  stepsMentioning,
  rewriteStepsForRename,
  handlersToScript,
  loadHandlers,
  getStoredHandler,
  recordRun,
  expansionProbeName,
} from './handlers';
export type { ControlListener, StoredStep, StoredHandler, ParsedHandler, AddHandlerValue } from './handlers';

export {
  pushActionOutcome,
  drainActionOutcomes,
  ensureResetTracking,
  initialOf,
  runHandler,
  runLoadHandlers,
  clickButton,
} from './run';
export type { ActionOutcomeRecord, RunPayload, RunTrigger } from './run';

export {
  clearInputState,
  inputTargetOf,
  checkInputTarget,
  targetTextOf,
  inputTextOf,
  inputValidOf,
  inputErrorOf,
  typeInputText,
  commitInputText,
} from './input';
export type { InputState, CommitInputValue } from './input';

export {
  writeNumberValue,
  writeSimpleValue,
  toggleValue,
  choiceStateOf,
  defaultCaption,
  setChoiceIndex,
  setChoiceCaption,
  setListElement,
} from './valuewrite';
export type { WriteOk, ChoiceState } from './valuewrite';

export {
  NUMBERS_TYPE_NAMES,
  numbersCommandSpecs,
  registerNumbersCommands,
  startAnimation,
  stopAnimation,
  setValue,
  setListElementByName,
  toggleCheckbox,
  animateSlider,
  animateAll,
  isAnimating,
  resetObjects,
  countControls,
  summarizeControl,
  choiceValueOf,
  choiceIndexOf,
  choiceCountOf,
  choiceOptionsOf,
  checkSliderLineUnits,
  applySliderRange,
} from './commands';
export type { StartResult, SliderRange } from './commands';
