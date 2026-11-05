import type { Ease, Waveform } from '../api/types';
import type { SceneCommand } from './scene-commands';
import type { UiState } from './ui';

export type LoopMode = 'loop' | 'once' | 'pingpong';

/** A change of view on one stage, in that stage's own coordinates. */
export type ViewAction =
  /** Zooms about a point: `factor` above 1 zooms in. */
  | { readonly kind: 'zoom'; readonly x: number; readonly y: number; readonly factor: number }
  /** Moves the content by this many stage units. */
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number }
  /** Turns a 3D camera; dx and dy are fractions of the stage size. */
  | { readonly kind: 'orbit'; readonly dx: number; readonly dy: number }
  | { readonly kind: 'reset' }
  /** Fits the axes to what is drawn. */
  | { readonly kind: 'fit' }
  /** A named camera view such as `front` or `iso`. */
  | { readonly kind: 'preset'; readonly name: string };

/** What the renderer asks of the scene runtime. */
export type RendererMessage =
  | { readonly type: 'tick'; readonly dt: number }
  | { readonly type: 'setParam'; readonly name: string; readonly value: number }
  | { readonly type: 'setValues'; readonly values: Readonly<Record<string, number>> }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'restart' }
  | { readonly type: 'reset' }
  /** Films only: restart and replay to this many seconds of scene time (FV-1). */
  | { readonly type: 'seek'; readonly seconds: number }
  | { readonly type: 'speed'; readonly value: number }
  | { readonly type: 'visible'; readonly value: boolean }
  | { readonly type: 'reducedMotion'; readonly value: boolean }
  | { readonly type: 'step'; readonly action: 'enter' | 'next' | 'prev' | 'exit' | 'goto'; readonly index?: number }
  | { readonly type: 'focusPart'; readonly name: string | null }
  /** Films only: a beat's show and hide lists, and its marks, as absolute part visibility. */
  | { readonly type: 'partVisible'; readonly name: string; readonly visible: boolean }
  /** Films only: one note of a beat's named sfx cue, as the cue resolves it. */
  | { readonly type: 'note'; readonly wave: Waveform; readonly frequency: number; readonly duration: number; readonly gain: number }
  /**
   * Films only: a beat's camera. Frames the part on kit-owned stages, back to
   * the wide view first so the move is absolute; null returns every kit-owned
   * stage to the wide view, as beats without a camera do.
   */
  | { readonly type: 'framePart'; readonly part: string | null; readonly zoom: number }
  /** The learner drags an element: the pointer, or a keyboard nudge, in stage coordinates. */
  | { readonly type: 'drag'; readonly id: number; readonly phase: 'start' | 'move' | 'end'; readonly x: number; readonly y: number }
  /** The pointer moves over a stage that listens for hovering, or leaves it (null). */
  | { readonly type: 'hover'; readonly stage: number; readonly x: number | null; readonly y: number | null }
  | { readonly type: 'view'; readonly stage: number; readonly action: ViewAction }
  /** A button or preset was pressed. */
  | { readonly type: 'action'; readonly index: number }
  /** A legend entry was switched on or off. */
  | { readonly type: 'legend'; readonly id: number; readonly visible: boolean }
  /** The learner edited a formula. */
  | { readonly type: 'formula'; readonly index: number; readonly source: string }
  /** The learner chose an answer to a prediction (null clears it), or asked to see what happens. */
  | { readonly type: 'predict'; readonly index: number; readonly choice: number | null; readonly reveal?: boolean }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  /** The timing panel: duration of one cycle, loop mode and easing. */
  | { readonly type: 'timing'; readonly duration?: number; readonly loop?: LoopMode; readonly ease?: Ease }
  /** Advance one frame while paused. */
  | { readonly type: 'frame' }
  /** Hold a ghost of the current drawing to compare against, or let it go. */
  | { readonly type: 'compare'; readonly on: boolean }
  | { readonly type: 'destroy' };

export interface RuntimeUpdate {
  /** The scene was rebuilt: the renderer clears its stages before applying commands. */
  readonly reset?: boolean;
  readonly commands: readonly SceneCommand[];
  /** Only the UI sections that changed. */
  readonly ui: Partial<UiState>;
  /** True while the scene is playing, dirty or animating a transition. */
  readonly needsFrame: boolean;
  /**
   * Learner values that changed, for persistence by the host. Timing settings
   * travel here too, under names that start with `$`.
   */
  readonly values?: Readonly<Record<string, number>>;
  /** Teaching-step position when it changed, for persistence. */
  readonly step?: number | null;
  /** Formulas the learner edited, by formula index, for persistence. */
  readonly formulas?: Readonly<Record<string, string>>;
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** Frame-rate caps the settings panel offers; 0 means none. */
export const FRAME_CAPS = [0, 30, 15] as const;

export const LOOP_MODES: readonly LoopMode[] = ['loop', 'once', 'pingpong'];

export const EASES: readonly Ease[] = ['linear', 'in', 'out', 'inOut', 'spring'];
