/** UI state the runtime publishes; the renderer turns it into controls and text. */

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
}

export interface StepsView {
  readonly count: number;
  /** Current step while in step mode, or null outside it. */
  readonly index: number | null;
  readonly say: string | null;
  readonly focus: string | null;
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
};
