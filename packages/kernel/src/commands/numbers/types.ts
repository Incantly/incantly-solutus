/**
 * Numbers, sliders, booleans, controls and scripting: public types
 * (docs/features/numbers-sliders/design.md 3.1, docs/features/controls-scripting/design.md 3.1, 3.4).
 *
 * This folder is the numbers area. It plugs into the finished kernel only through the
 * kernel's own hooks (CommandRegistry, registerTypeStyle, registerPropertyTypes, PROPERTIES,
 * FIELDS, registerNotice, registerReasonPhrase) and the public Figure API.
 */

import type { ErrorObject } from '../../contracts/errors';
import type { Name, ObjId } from '../../contracts/values';

/* ------------------------------ area registries ------------------------------ */

declare module '../../contracts/values' {
  interface AreaTypeNames {
    // numbers-sliders + controls-scripting
    Button: true;
    Choice: true;
    Input: true;
  }
  interface AreaUndefReasons {
    // numbers-sliders
    range_undefined: true;
    empty_range: true;
    // controls-scripting
    empty_choice: true;
    input_invalid: true;
    target_not_free: true;
  }
}

// NOTE: AreaErrorKinds is deliberately NOT extended here. The kernel's META table is
// typed Record<ErrorKind, Meta>, so extending the kind union breaks typechecking of
// kernel code this area may not edit (kernel gap KG-ERR). Area kinds travel as
// strings and are stamped onto error objects by numbersError() instead.
declare module '../../contracts/errors' {
  interface AreaNoticeKinds {
    // numbers-sliders
    snapped: true;
    range_kept: true;
    unit_inferred: true;
    step_fallback: true;
    step_below_precision: true;
    // controls-scripting
    handler_steps_broken: true;
  }
}

/* ------------------------------ numbers (3.1) ------------------------------ */

/** Display unit of a Number. The stored value is always radians for angle units. */
export type AngleUnit = 'rad' | 'deg' | 'turn' | 'grad';

/** Display-only formatting of a Number. Maths never reads it. */
export interface NumberDisplay {
  /** 'none' is a plain number with no symbol. */
  readonly unit: AngleUnit | 'none';
  readonly format:
    | { readonly mode: 'auto' }
    | { readonly mode: 'decimals'; readonly n: number }
    | { readonly mode: 'sig'; readonly n: number };
  readonly trim: boolean;
}

/** A slider bound: a constant, or a rule that follows other objects. */
export type Bound = { readonly kind: 'const'; readonly value: number } | { readonly kind: 'rule'; readonly ruleId: ObjId };

export type LoopMode = 'bounce' | 'up' | 'down' | 'once' | 'random';

/** The whole animation is a pure function of t and this anchor. */
export interface AnimAnchor {
  /** Film/clock time at which the anchor was set. */
  readonly t0: number;
  /** Value at t0 (stored value, radians for angles). */
  readonly v0: number;
  /** Direction at t0 for bounce. */
  readonly dir: 1 | -1;
}

export interface SliderSpec {
  readonly min: Bound;
  readonly max: Bound;
  /** In display-unit coordinates. */
  readonly step: number | 'auto';
  readonly loop: LoopMode;
  /** Seconds for one sweep from min to max. */
  readonly period: number;
  /** For loop = 'random'. */
  readonly seed: number;
  /** Null when not animating. */
  readonly anim: AnimAnchor | null;
  readonly orientation: 'horizontal' | 'vertical';
  /** CSS pixels when placed on screen. */
  readonly length: number;
}

export interface NumberObject {
  readonly type: 'Number';
  readonly value: number | undefined;
  /** Only on a free Number. */
  readonly slider: SliderSpec | null;
  readonly display: NumberDisplay;
}

export interface BoolObject {
  readonly type: 'Bool';
  readonly value: boolean | undefined;
  /** Checkbox caption; null means use the name. */
  readonly label: string | null;
}

export type Placement =
  | { readonly kind: 'dock' }
  | { readonly kind: 'screen'; readonly x: number; readonly y: number; readonly anchor: 'tl' | 'tr' | 'bl' | 'br' }
  | { readonly kind: 'at'; readonly x: number; readonly y: number };

/** What the view receives per slider (3.8). The kernel formats `text`. */
export interface SliderView {
  readonly id: ObjId;
  readonly name: string;
  readonly label: string;
  readonly value: number | undefined;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: AngleUnit | 'none';
  readonly text: string;
  readonly animating: boolean;
  readonly loop: LoopMode;
  readonly orientation: 'horizontal' | 'vertical';
  readonly length: number;
  readonly place: Placement;
}

export interface BoolView {
  readonly id: ObjId;
  readonly name: string;
  readonly label: string;
  readonly value: boolean | undefined;
  readonly place: Placement;
}

/* ------------------------------ controls (3.1) ------------------------------ */

/** Runtime value of a Choice object, computed by its rule from options and index. */
export interface ChoiceValue {
  /** The live options (a reference to the evaluated list, never copied). */
  readonly options: readonly unknown[];
  /** 1-based selected position. */
  readonly index: number;
  /** options[index - 1]; undefined when the choice is empty. */
  readonly value: unknown;
  readonly count: number;
}

/** Runtime value of an Input object: the target's current text. */
export interface InputValue {
  /** What is in the box: the target's value as text. */
  readonly text: string;
  /** A rule-computed text is always valid; learner typing state lives beside it. */
  readonly valid: boolean;
  /** The linked target's id. */
  readonly target: ObjId;
}

/** Runtime value of a Button object. The style caption may override the label. */
export interface ButtonValue {
  readonly label: string;
}

/* ------------------------------ handlers (3.3, 3.4) ------------------------------ */

export type HandlerEvent = 'click' | 'change' | 'input' | 'dragend' | 'load';

export type SkipReason = 'guard_false' | 'undefined_argument' | 'out_of_range' | 'loop_range' | 'broken';

export type StepResult =
  | { readonly step: number; readonly status: 'done'; readonly wrote?: readonly { readonly name: string; readonly from: string; readonly to: string }[] }
  | { readonly step: number; readonly status: 'skipped'; readonly reason: SkipReason };

export interface HandlerRun {
  readonly handler: { readonly target: string; readonly event: string };
  readonly trigger: 'learner' | 'host' | 'click_call';
  /** False when aborted by a limit; then nothing was applied. */
  readonly ok: boolean;
  readonly stepsUsed: number;
  readonly results: readonly StepResult[];
  readonly error?: ErrorObject;
  /** Events dropped while this run was queued (always 0: runs are synchronous). */
  readonly dropped: number;
}

/** Host listener event (3.6): figure files never carry listeners. */
export interface ControlEvent {
  readonly event: string;
  readonly name: string;
  readonly type: string;
  readonly value?: string;
  readonly index?: number;
  readonly by: 'learner' | 'host';
}

/* ------------------------------ limits ------------------------------ */

/** Budgets from numbers-sliders 3.3/4/errors.md and controls-scripting 3.9/errors.md. */
export const NUMBERS_LIMITS = Object.freeze({
  /** Largest (max - min) / step a slider accepts. */
  sliderSteps: 1000000,
  /** Smallest step relative to the range. */
  minStepOfRange: 1e-12,
  /** Sliders animating at once per figure. */
  animating: 500,
  /** Longest control label in characters. */
  labelLength: 120,
  /** Steps stored per handler. */
  stepsPerHandler: 50,
  /** Handlers per figure. */
  handlersPerFigure: 200,
  /** Step executions per run. */
  stepsPerRun: 2000,
  /** Loop iterations per step. */
  loopIterations: 1000,
  /** Click nesting depth. */
  clickDepth: 8,
  /** Learner input text length in characters. */
  inputLength: 500,
  /** Learner input expression nodes. */
  inputNodes: 2000,
  /** Learner input nesting depth. */
  inputDepth: 16,
  /** Choice options. */
  choiceOptions: 1000,
  /** Buttons + Inputs + Choices per figure. */
  controlsPerFigure: 100,
  /** Handler events queued per handler (runs are synchronous, so the queue never fills). */
  queuedEvents: 20,
});

export type { Name };
