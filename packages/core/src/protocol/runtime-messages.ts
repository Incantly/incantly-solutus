import type { SceneCommand } from './scene-commands';
import type { UiState } from './ui';

/** What the renderer asks of the scene runtime. */
export type RendererMessage =
  | { readonly type: 'tick'; readonly dt: number }
  | { readonly type: 'setParam'; readonly name: string; readonly value: number }
  | { readonly type: 'setValues'; readonly values: Readonly<Record<string, number>> }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'restart' }
  | { readonly type: 'reset' }
  | { readonly type: 'speed'; readonly value: number }
  | { readonly type: 'visible'; readonly value: boolean }
  | { readonly type: 'reducedMotion'; readonly value: boolean }
  | { readonly type: 'step'; readonly action: 'enter' | 'next' | 'prev' | 'exit' | 'goto'; readonly index?: number }
  | { readonly type: 'focusPart'; readonly name: string | null }
  | { readonly type: 'destroy' };

export interface RuntimeUpdate {
  /** The scene was rebuilt: the renderer clears its stages before applying commands. */
  readonly reset?: boolean;
  readonly commands: readonly SceneCommand[];
  /** Only the UI sections that changed. */
  readonly ui: Partial<UiState>;
  /** True while the scene is playing, dirty or animating a transition. */
  readonly needsFrame: boolean;
  /** Learner values that changed, for persistence by the host. */
  readonly values?: Readonly<Record<string, number>>;
  /** Teaching-step position when it changed, for persistence. */
  readonly step?: number | null;
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
