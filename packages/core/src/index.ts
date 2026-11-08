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
export { FilmController, applyBeatCues, applyShowHide, beatTitle, beginShowMe, cueSfx, framePart, isPausePoint, partBox, partBoxes, sfxNames, SFX_CUES } from './runtime/film';
export type { AppliedCues, AskContext, FilmChapter, FilmControllerOptions, FilmEvent, FilmTransport, FramingIntent, ShowMeSession, TranscriptLine } from './runtime/film';
export {
  anchorWords,
  askAnchorFor,
  askContextLine,
  askWordIndex,
  AskReturnStack,
  InsertPlayer,
  markerSeconds,
  resolveAskAnchor,
  routeQuestion,
  validateInsertClip,
  ASK_RETURN_STACK_MAX,
  BACK_TO_FILM_SECONDS,
  INSERT_MAX_LINES,
  INSERT_MAX_LINE_SECONDS,
  INSERT_MIN_LINE_SECONDS,
} from './film/ask';
export type { AskAnchor, AskMarker, AskReadout, AskRung, AskSnapshot, InsertClip, InsertEvent, InsertHost, InsertLine, InsertPhase } from './film/ask';
export {
  anchorFor,
  attachAudio,
  compileFilm,
  countWords,
  estimateBeatSeconds,
  readFilmContext,
  resolveAnchor,
  sanitizeWordStarts,
  splitWords,
  wordStarts,
  EMPTY_FILM_CONTEXT,
  FILM_BEAT_HOLD_SECONDS,
  FILM_BEAT_MAX_SECONDS,
  FILM_BEAT_MIN_SECONDS,
  FILM_MAX_DIAGNOSTICS,
  FILM_MAX_SCENES,
  FILM_READING_WPS_LIMIT,
  FILM_SCENE_MAX_SECONDS,
  FILM_WORDS_PER_SECOND,
} from './film/storyboard';
export type { BeatAudio, CompiledBeat, CompiledFilm, CompiledFilmResult, CompiledScene, FilmAdvance, FilmAnchor, FilmContext, FilmDiagnostic, FilmSceneSource, SourceMapEntry, StoryboardBeat, StoryboardScene, StoryboardSpec } from './film/storyboard';
export { fallbackWidth, fontsReady, measureFilmText, solveCallouts, solveCaption, titleCardRect, wrapText, CAPTION_MAX_LINES, CAPTION_MIN_PX, CAPTION_MIN_STAGE_SHARE, FILM_FONT_STACK, SAFE_MARGIN_SHARE } from './film/solver';
export type { CalloutInput, CalloutPlacement, CalloutRequest, CaptionInput, CaptionLayout, MeasureText } from './film/solver';
export { checkSceneContext, contrastRatio, luminance, probeFilm, probeFilmAsync, probeFilmStatic, FILM_CONTRAST_MIN, FILM_PLAIN_TONE_MAX_WORDS, FILM_TOKENS } from './film/checks';
export type { FilmCheck, FilmFailure, FilmPoint, FilmReport, FilmReportStats, FilmSceneInput, FilmTheme, FilmTokens, ProbeFilmOptions, ProbeFilmStaticOptions } from './film/checks';
export { applyCueState, beatCueState, buildStubScene, mountStubRuntime, pushAbsoluteState, sanitizeProbedSnapshot, SandboxFilmMirror } from './film/sandbox';
export type { BeatCueState, SanitizedSceneSnapshot, SandboxFilmScene } from './film/sandbox';
export { PlayerModel, CAPTION_SCALES, TIMELINE_WORD_TICKS_PER_BEAT } from './film/player';
export type { CaptionSize, FilmBookmark, PlayerCaption, PlayerEvent, PlayerState } from './film/player';
export { bindPlayerFullscreen, isFullscreenEnabled, isPlayerFullscreen, refreshPlayerFullscreenVisibility, syncPlayerFullscreenButton, togglePlayerFullscreen } from './film/fullscreen';
export { examplePinSeconds, exampleReturnSeconds, SideClipPlayer, validateExampleClip, EXAMPLE_MAX_CAPTION_CHARS } from './film/example';
export type { ExampleClip, SideClipEvent, SideClipPhase } from './film/example';
export { applyFilmPatch, insertBeatId, patchAudioProblems, patchSummary, promoteInsertClip, sanitizeFilmPatch, FILM_PATCH_LIMITS } from './film/versions';
export type { FilmPatchAudio, FilmPatchBeat, FilmPatchInsert, FilmPatchInsertLine, FilmVersionPatch } from './film/versions';
export type { LiveEvent, LiveSetup, LiveToolDeclaration, LiveVoice } from './film/live-voice';
export { FakeLiveVoice } from './film/live-fake';
export { LIVE_TEACHER_INSTRUCTION, LiveDriver } from './film/live-driver';
export type { LiveDriverEvent, LiveDriverOptions, LiveDriverState } from './film/live-driver';
export { defaultShowMeBinding, liveToolDeclarations, LiveToolDispatcher, resolveBeat } from './film/live-tools';
export type { LiveMakeExample, LiveShowMe, LiveToolDeps, LiveToolResult } from './film/live-tools';
export {
  askerHashOf,
  FilmVersionStore,
  flattenFilm,
  flattenInsert,
  flattenTranscript,
  insertIndexKey,
  insertRecordKey,
  PrivateInsertStore,
  reanchorAskAnchor,
  sanitizeStoredInsert,
  VersionPicker,
  FILM_LIBRARY_LIMITS,
} from './film/library';
export type { FilmVersionCard, FlattenedBeat, FlattenedTimeline, StoredInsert, VersionChoice } from './film/library';
export { formatFilmLink, parseFilmLink, resolveFilmLink, resolveFilmPosition, resumeKey, ResumeStore, shortcutFor, SHORTCUTS } from './film/controls';
export type { FilmLink, FilmPosition, PlayerShortcut, ResumeStorage, ShortcutAction } from './film/controls';
export { FILM_FIXTURES, SIXTY_SECOND_FILM, THIRTY_SECOND_FILM } from './film/fixtures';
export type { FilmFixture, FilmFixtureScene } from './film/fixtures';
export { filmDeadlineMs, filmPlanTokens, filmPresetFor, filmScenesFor, FILM_GENERATION_CEILING_MS, FILM_LENGTH_PRESETS, FILM_PLAN_BASE_TOKENS, FILM_PLAN_TOKENS_PER_SCENE, FILM_PRESET_SCENE_MAX_SECONDS } from './film/presets';
export type { FilmPreset } from './film/presets';
export { FilmMixer, MemoryMixerBackend, WebAudioMixerBackend, BED_DUCKED_LEVEL, BED_LEVEL, NARRATION_LEVEL } from './film/mixer';
export type { MixerBackend, MixerClip, MixerEvent } from './film/mixer';
export {
  assembleExportAudio,
  ExportCancellation,
  ExportCancelledError,
  ExportError,
  exportAvSyncBound,
  exportFrameSize,
  exportStepsPerFrame,
  exportSyncReport,
  exportSlideFilename,
  exportTimelineFallback,
  exportTimelineMp4,
  exportVideoFilename,
  planDeckSlides,
  planExportFilm,
  renderDeckSlides,
  renderExportChunk,
  resampleMono16,
  sanitizeExportFilenameSegment,
  EXPORT_AUDIO_FRAME_SAMPLES,
  EXPORT_DECK_MAX_SECONDS,
  EXPORT_FILENAME_MAX_CHARS,
  EXPORT_FILENAME_SEGMENT_CHARS,
  EXPORT_FPS_DEFAULT,
  EXPORT_HEIGHTS,
  EXPORT_KEYFRAME_EVERY,
  EXPORT_MAX_AUDIO_SECONDS,
  EXPORT_MAX_DIMENSION,
  EXPORT_MAX_SAMPLE_RATE,
  EXPORT_MIN_SAMPLE_RATE,
  EXPORT_SAMPLE_RATE,
  EXPORT_SEED,
} from './film/export';
export type {
  AssembledExportAudio,
  DeckSlide,
  DeckSlideRef,
  ExportAudioSink,
  ExportCaptureSession,
  ExportDrivers,
  ExportFallbackOptions,
  ExportFallbackResult,
  ExportFrame,
  ExportFrameSize,
  ExportPhase,
  ExportPlan,
  ExportPlanChunk,
  ExportProgress,
  ExportSceneInput,
  ExportSyncLine,
  ExportSyncReport,
  ExportVideoOptions,
  ExportVideoResult,
  ExportVideoSample,
  ExportVideoSink,
  FallbackClock,
  FallbackRecorder,
  FallbackSession,
  PlanExportOptions,
  RenderExportHooks,
} from './film/export';
export { listTopLevelBoxes, muxMp4, MP4_MVHD_TIMESCALE, MP4_VIDEO_TIMESCALE } from './film/mp4';
export type { Mp4AudioTrack, Mp4Box, Mp4VideoCodec, Mp4VideoSample, Mp4VideoTrack } from './film/mp4';
export {
  createBrowserFallbackRig,
  createSandboxedFallbackRig,
  fallbackRecorderType,
  hashPixels,
  meanPixelDifference,
  openBrowserCapture,
  openSandboxedCapture,
  openWebCodecsAudio,
  openWebCodecsVideo,
  paintExportCaption,
  probeExportCodecs,
  renderLiveExportPixels,
  renderSandboxedLivePixels,
  resumeFallbackPlayback,
  exportBitrate,
  EXPORT_AUDIO_BITRATE,
  EXPORT_AUDIO_CODEC,
} from './film/webcodecs';
export type { BrowserCaptureEnv, ExportCodecSupport, FallbackRigEnv, LiveExportFrameEnv, PixelMap, SandboxedCaptureEnv, SandboxedFallbackRigEnv, SandboxedLiveFrameEnv } from './film/webcodecs';
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
export type { IsolatedScene, ProbedParam, ProbedSnapshot, ProbeCheck, ProbeError, ProbeFailure, ProbeOptions, ProbeReport, ProbeSpec, ProbeStats, ScriptEvaluator } from './probe';
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
