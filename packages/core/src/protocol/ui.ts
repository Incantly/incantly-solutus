import type { Ease, FormulaInput, Tone } from '../api/types';
import type { LoopMode } from './runtime-messages';

/** UI state the runtime publishes; the renderer turns it into controls and text. */

export type ControlKind = 'slider' | 'toggle' | 'choice' | 'color';

export interface ParamView {
  readonly name: string;
  readonly label: string;
  readonly unit: string;
  readonly note: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly defaultValue: number;
  /** How the control looks; every kind holds a number. */
  readonly kind: ControlKind;
  /** Option labels of a choice, or the tone names of a colour. */
  readonly options: readonly string[];
  /** A choice drawn as a row of buttons rather than a menu. */
  readonly buttons: boolean;
  /** Changing it also changes another parameter (CT-8). */
  readonly linked: string | null;
}

export interface ReadoutView {
  readonly label: string;
  readonly text: string;
}

export interface PartView {
  readonly name: string;
  readonly label: string;
  readonly info: string;
  /** Scene element id of the part, for highlighting. */
  readonly id: number;
  readonly tone: Tone | null;
}

export interface StepsView {
  readonly count: number;
  /** Current step while in step mode, or null outside it. */
  readonly index: number | null;
  readonly say: string | null;
  readonly focus: string | null;
}

/** A button or a preset (a named set of values). */
export interface ActionView {
  readonly index: number;
  readonly label: string;
  readonly kind: 'button' | 'preset';
  /** A preset whose values are all current. */
  readonly active: boolean;
}

/** One legend entry: a labelled series or a toned part. */
export interface LegendView {
  readonly id: number;
  readonly label: string;
  readonly tone: Tone | null;
  readonly visible: boolean;
  /** Whether the learner may hide it. */
  readonly toggle: boolean;
  /** The part it names, for highlighting on hover. */
  readonly part: string | null;
  readonly dashed: boolean;
}

export interface FormulaView {
  readonly index: number;
  readonly label: string;
  readonly source: string;
  readonly editable: boolean;
  /** Its own variable, which sets what it is written as: y = f(x), x = f(y), r = f(theta). */
  readonly input: FormulaInput;
  /** Why the learner's last edit was not accepted; the figure keeps the previous formula. */
  readonly error: string | null;
  /** The text the learner is editing when it differs from `source` (an edit that failed). */
  readonly draft: string | null;
}

export interface PredictView {
  readonly index: number;
  readonly question: string;
  readonly options: readonly string[];
  readonly chosen: number | null;
  readonly revealed: boolean;
  /** The answer, once revealed. */
  readonly answer: number | null;
  readonly explanation: string | null;
}

export interface TableView {
  readonly title: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface TimingView {
  /** Seconds per cycle. */
  readonly duration: number;
  readonly loop: LoopMode;
  readonly ease: Ease;
}

export interface StageView {
  readonly id: number;
  /** The view differs from where it started, so a reset is offered. */
  readonly changed: boolean;
}

export type ErrorPhase =
  | 'mount'
  | 'frame'
  | 'model'
  | 'readout'
  | 'explain'
  | 'describe'
  | 'tween'
  | 'plot'
  | 'drag'
  | 'action'
  | 'hook'
  | 'runaway'
  | 'unresponsive';

export interface ErrorView {
  readonly phase: ErrorPhase;
  readonly message: string;
  /** Fragment-relative location when it could be mapped. */
  readonly line?: number;
  readonly column?: number;
}

export interface UiState {
  readonly params: readonly ParamView[];
  readonly readouts: readonly ReadoutView[];
  readonly parts: readonly PartView[];
  readonly playing: boolean;
  /**
   * Whether anything in the scene follows time: true once a frame reads time,
   * false when the first frame did not, null before any frame. A still scene
   * gets no play controls and does no work while "playing".
   */
  readonly animated: boolean | null;
  readonly speed: number;
  readonly idea: string | null;
  readonly explanation: string | null;
  readonly description: string | null;
  readonly steps: StepsView | null;
  /** Part directed at by the current step or by learner focus. */
  readonly focus: string | null;
  readonly error: ErrorView | null;
  readonly actions: readonly ActionView[];
  readonly legend: readonly LegendView[];
  readonly formulas: readonly FormulaView[];
  readonly predict: PredictView | null;
  readonly tables: readonly TableView[];
  /** The timing panel, when the scene has a timeline (CT-4). */
  readonly timing: TimingView | null;
  readonly history: { readonly undo: boolean; readonly redo: boolean };
  /** The card's title and a hint on how to use the figure (BR-7). */
  readonly card: { readonly title: string | null; readonly hint: string | null };
  /** Stages whose view the kit controls (graph zoom, 3D camera). */
  readonly views: readonly StageView[];
  /** Whether a ghost of an earlier state is shown, when the scene offers one (TE-5). */
  readonly compare: { readonly available: boolean; readonly on: boolean };
  /** How the scene's panels sit together, when it has more than one (VI-7). */
  readonly panels: 'row' | 'column' | 'grid' | null;
}

export const EMPTY_UI: UiState = {
  params: [],
  readouts: [],
  parts: [],
  playing: false,
  animated: null,
  speed: 1,
  idea: null,
  explanation: null,
  description: null,
  steps: null,
  focus: null,
  error: null,
  actions: [],
  legend: [],
  formulas: [],
  predict: null,
  tables: [],
  timing: null,
  history: { undo: false, redo: false },
  card: { title: null, hint: null },
  views: [],
  compare: { available: false, on: false },
  panels: null,
};
