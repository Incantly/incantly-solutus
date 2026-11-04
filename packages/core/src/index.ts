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
export type { RuntimeOptions, RuntimeStats, SceneErrorRecord, SceneFunction, SeekOptions } from './runtime/runtime';
export { FilmController, applyBeatCues, applyShowHide, beatTitle, cueSfx, framePart, isPausePoint, partBox, partBoxes, sfxNames, SFX_CUES } from './runtime/film';
export type { AppliedCues, AskContext, FilmChapter, FilmControllerOptions, FilmEvent, FilmTransport, FramingIntent, TranscriptLine } from './runtime/film';
export {
  anchorFor,
  attachAudio,
  compileFilm,
  countWords,
  estimateBeatSeconds,
  resolveAnchor,
  splitWords,
  wordStarts,
  FILM_BEAT_HOLD_SECONDS,
  FILM_BEAT_MAX_SECONDS,
  FILM_BEAT_MIN_SECONDS,
  FILM_MAX_DIAGNOSTICS,
  FILM_MAX_SCENES,
  FILM_READING_WPS_LIMIT,
  FILM_WORDS_PER_SECOND,
} from './film/storyboard';
export type { BeatAudio, CompiledBeat, CompiledFilm, CompiledFilmResult, CompiledScene, FilmAnchor, FilmDiagnostic, FilmSceneSource, SourceMapEntry, StoryboardBeat, StoryboardScene, StoryboardSpec } from './film/storyboard';
export { fallbackWidth, fontsReady, measureFilmText, solveCallouts, solveCaption, titleCardRect, wrapText, CAPTION_MAX_LINES, CAPTION_MIN_PX, CAPTION_MIN_STAGE_SHARE, FILM_FONT_STACK, SAFE_MARGIN_SHARE } from './film/solver';
export type { CalloutInput, CalloutPlacement, CalloutRequest, CaptionInput, CaptionLayout, MeasureText } from './film/solver';
export { contrastRatio, luminance, probeFilm, probeFilmAsync, FILM_CONTRAST_MIN, FILM_TOKENS } from './film/checks';
export type { FilmCheck, FilmFailure, FilmPoint, FilmReport, FilmReportStats, FilmSceneInput, FilmTheme, FilmTokens, ProbeFilmOptions } from './film/checks';
export { PlayerModel, CAPTION_SCALES, TIMELINE_WORD_TICKS_PER_BEAT } from './film/player';
export type { CaptionSize, PlayerCaption, PlayerEvent, PlayerState } from './film/player';
export { FILM_FIXTURES, SIXTY_SECOND_FILM, THIRTY_SECOND_FILM } from './film/fixtures';
export type { FilmFixture, FilmFixtureScene } from './film/fixtures';
export { KIT_NAMES, KIT_OF, kitsFor } from './runtime/kits';
export type { KitCall, KitEntry, KitModule, KitName, KitRegistry } from './runtime/kits';
export { availableKits, loadKitModules } from './kits/load';

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
export { STYLE_SLOTS, applySlotClasses, applyStyle, checkStyle, clearStyle, mergeStyles, resolveStyle } from './renderer/style';
export type { ControlsPlacement, FigureLayout, FigureStyle, ShowPart, StylePreset, StyleSlot } from './renderer/style';

export { fixScene, validateScene, validateSceneCss, validateSceneHtml, validateSceneJs, formatDiagnostic, hasErrors, SCENE_LIMITS, VALIDATOR_VERSION } from './validation';
export type { Diagnostic, FixedScene, SceneFragments, SceneLimits, SceneValidation, ValidatedScene } from './validation';

export { compileIsolated, ISOLATED_SCRIPT_NAME, probeScene } from './probe';
export type { IsolatedScene, ProbeCheck, ProbeError, ProbeFailure, ProbeOptions, ProbeReport, ProbeSpec, ProbeStats, ScriptEvaluator } from './probe';
export { AUDIT_TURNS, auditDepthOf, looseLineEnds, offlineChecks } from './probe';
export type { DepthFinding, LooseEnd, OfflineOptions, OfflineReport } from './probe';
export type { AuditTurn, DepthAudit, DepthViolation } from './runtime/kit';

export type { ControlKind, PlanOutput, PlanParameter, SceneKind, ScenePlan, SceneSize, SingularPoint, SizeBudget } from './protocol/plan';
export { SCENE_SIZES, SIZE_BUDGETS } from './protocol/plan';

export { BRIDGE_VERSION } from './protocol/bridge';
export type { FrameMessage, HostMessage } from './protocol/bridge';

export { DEFAULT_DEADLINES, mountSandboxed, presentScene, prewarmFigure, probeSandboxed, sandboxAdapter, warmProbe } from './sandbox/adapter';
export { preloadKits } from './sandbox/worker-script';
export type {
  Deadlines,
  ExecutionAdapter,
  FigureCallbacks,
  FigureHandle,
  FigureState,
  MountOptions,
  PresentResult,
  PrewarmOptions,
  ProbeOutcome,
  SandboxProbeOptions,
  WarmLease,
  WarmProbe,
} from './sandbox/adapter';
export { inThreadAdapter, mountInThread } from './engine/in-thread-adapter';
export { CLIP_LIMITS, clipSettings, clipType } from './sandbox/clip';
export type { ClipOptions } from './sandbox/clip';
export { contentRef } from './sandbox/sha256';
