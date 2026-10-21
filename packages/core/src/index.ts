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

export { validateScene, formatDiagnostic, hasErrors, SCENE_LIMITS } from './validation';
export type { Diagnostic, SceneFragments, SceneLimits, SceneValidation, ValidatedScene } from './validation';

export { probeScene } from './probe';
export type { ProbeCheck, ProbeFailure, ProbeOptions, ProbeReport, ProbeSpec } from './probe';

export { BRIDGE_VERSION } from './protocol/bridge';
export type { FrameMessage, HostMessage } from './protocol/bridge';

export { DEFAULT_DEADLINES, mountSandboxed, presentScene, probeSandboxed, sandboxAdapter } from './sandbox/adapter';
export type {
  Deadlines,
  ExecutionAdapter,
  FigureCallbacks,
  FigureHandle,
  FigureState,
  MountOptions,
  PresentResult,
  ProbeOutcome,
  SandboxProbeOptions,
} from './sandbox/adapter';
export { inThreadAdapter, mountInThread } from './engine/in-thread-adapter';
