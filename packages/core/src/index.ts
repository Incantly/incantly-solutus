export type * from './api/types';
export {
  ALLOWED_GLOBALS,
  ALLOWED_MATH,
  ALLOWED_NUMBER,
  HANDLES,
  INC_FUNCTIONS,
  INC_NAMESPACES,
  SCENE_SCHEMA_VERSION,
  SDK_VERSION,
} from './api/surface';
export type { HandleKind, HandleSpec, Returns } from './api/surface';

export { compileExpression, tryCompileExpression, ExpressionError } from './expr';
export type { CompiledExpression } from './expr';

export { SceneRuntime } from './runtime/runtime';
export type { RuntimeOptions, RuntimeStats, SceneErrorRecord, SceneFunction } from './runtime/runtime';

export type { RendererMessage, RuntimeUpdate } from './protocol/runtime-messages';
export type { SceneCommand } from './protocol/scene-commands';
export type { ErrorView, ParamView, ReadoutView, StepsView, UiState } from './protocol/ui';

export { animationFrameClock, ManualClock } from './engine/clock';
export type { FrameClock } from './engine/clock';
export { InThreadChannel, handleRendererMessage } from './engine/channel';
export type { RuntimeChannel } from './engine/channel';
export { compileTrusted, ensureTheme, mountTrusted } from './engine/mount';
export type { Fragments, MountedFigure, TrustedMountOptions } from './engine/mount';

export { FigureRenderer } from './renderer/renderer';
export type { RendererOptions } from './renderer/renderer';
export { THEME_CSS } from './renderer/theme';
