/**
 * Numbers, sliders, booleans, controls and scripting: public API.
 *
 * Register with `registerNumbers(registry)`, then build figures with the
 * registry (and `withNumbersFunctions()` for the sig/snap/wrap/approx group).
 * Registration only appends to the kernel's area hooks; nothing else changes.
 */

import type { CommandRegistry } from '../../graph/registry';
import { registerClockDriven, registerDeleteNotes, registerLineCheck, registerLineHandler, registerLineRewriter, registerScriptTail } from '../../graph/registry';
import { numbersLineRewrite } from './rewrite';
import { numbersLineCheck } from './linecheck';
import { handlerDeleteNotes, handlerScriptLines, numbersLineHandler } from './handlers';
import { isAnimating, registerNumbersCommands } from './commands';
import { inputTextOf, inputValidOf } from './input';
import { registerNumbersErrors } from './errors';
import { registerNumbersProperties, setFieldHooks } from './props';
import { registerFrameTicker } from '../../clock/player';
import type { Figure } from '../../graph/figure';
import type { ObjId } from '../../contracts/values';
import { animatingIds, getAnchor, sliderValueAt, tickAnimations } from './animate';

/**
 * Animated sliders follow the player's clock (animation-time 5: one way to write slider animation): each frame and each
 * seek writes their values for the new time, before the other areas' per-frame work reads them.
 */
const sliderTicker = (figure: Figure, t: number): void => {
  if (animatingIds(figure).length > 0) tickAnimations(figure, t);
};

/** Register every command, property, field, notice and phrase of this area. Idempotent. */
export function registerNumbers(registry: CommandRegistry): void {
  registerNumbersErrors();
  registerNumbersProperties();
  setFieldHooks({ animating: isAnimating, text: inputTextOf, valid: inputValidOf });
  registerNumbersCommands(registry);
  registerLineCheck(numbersLineCheck);
  registerLineRewriter(numbersLineRewrite);
  registerLineHandler(numbersLineHandler);
  registerScriptTail(handlerScriptLines);
  registerDeleteNotes(handlerDeleteNotes);
  registerFrameTicker(sliderTicker);
  registerClockDriven(animatedSliders);
}

/** Animated sliders as functions of film time, for a replay over the clock (a trace rebuilt on a seek, ValueAt). */
const animatedSliders = (host: unknown): { id: ObjId; at: (t: number) => unknown }[] => {
  const figure = host as Figure;
  return animatingIds(figure).map((id) => ({
    id,
    at: (t: number) => {
      const anchor = getAnchor(figure, id);
      if (!anchor) return figure.value(id);
      const r = sliderValueAt(figure, id, anchor, t);
      return r.ok ? r.value : undefined;
    },
  }));
};

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
