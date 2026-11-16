/**
 * The shapes of app modes, restrictions, exam profiles and settings (app-modes design 3.1, 3.3, 3.7, 3.8). Plain data:
 * every value here can be written as JSON. No DOM.
 */

export type AppModeId =
  | 'figure' | 'graphing' | 'geometry' | 'classic' | 'scientific'
  | 'probability' | 'notes' | 'cas' | 'graphing3d';

/** A key into the UI text catalogue (`i18n.ts`). */
export type LocaleKey = string;

export type ViewKind =
  | 'graphics' | 'algebra' | 'sheet' | 'cas' | 'graphics3d'
  | 'distribution' | 'results' | 'board' | 'clock' | 'datalab' | 'script';

/** Tool groups of the tools-2d area, plus the board and 3D groups of later areas. */
export type ToolGroupId =
  | 'move' | 'point' | 'line' | 'special-line' | 'polygon' | 'circle-arc' | 'conic' | 'measure' | 'transform'
  | 'action' | 'general' | 'board' | 'space';

export type ToolId = string;
/** The `group` of a command spec in the command table (`geometry`, `functions`, `stats`, …). */
export type CommandGroupId = string;
export type KeyboardId = 'standard' | 'scientific' | 'notes' | 'geometry' | 'probability';
export type ExamProfileId = 'basic' | 'no-calculator-tools' | 'graphing-only' | 'custom';
export type SettingId = string;
export type PointStyle = 'dot' | 'cross' | 'ring' | 'square' | 'diamond';

export interface ViewPolicy {
  readonly available: readonly ViewKind[];
  /** Shown at start, in order. */
  readonly initial: readonly ViewKind[];
  readonly layout: 'split' | 'single' | 'tabs';
  /** May the learner show and hide views. */
  readonly canToggle: boolean;
}

export interface ToolPolicy {
  readonly groups: readonly ToolGroupId[];
  readonly toolbar: 'full' | 'compact' | 'none';
  /** Single tools taken out of the groups. */
  readonly deny?: readonly ToolId[];
  /** Single tools of other groups let in (the curve tools of graphing). */
  readonly add?: readonly ToolId[];
  readonly customTools: boolean;
}

/** A form of a command the mode only allows in a narrower way (design 3.1, errors 1 `no_matching_form`). */
export interface ArgumentRule {
  readonly command: string;
  /** The first argument must be an object the learner defined as a function (not an expression). */
  readonly firstArg: 'user-function';
  readonly hint: string;
}

export interface CommandPolicy {
  readonly allow: 'all' | readonly CommandGroupId[];
  readonly add?: readonly string[];
  readonly deny?: readonly string[];
  /** When set, only these commands (a restriction or an exam narrowed the mode to them). */
  readonly only?: readonly string[];
  readonly argumentRules?: readonly ArgumentRule[];
}

export interface ExpressionPolicy {
  /** Built-in functions allowed (`sin`, `ln`, …). */
  readonly functions: 'all' | readonly string[];
  readonly operators: 'all' | readonly string[];
  /** Built-in functions taken out even when `functions` is `all`. */
  readonly denyFunctions?: readonly string[];
  /** Lines like `x^2 + y^2 == 4`. */
  readonly allowImplicitEquations: boolean;
  /** Lines like `f(x) = x^2` (off in the scientific calculator). Default true. */
  readonly allowUserFunctions?: boolean;
  readonly allowTextObjects: boolean;
  readonly allowLists: boolean;
  /** `state()` and rates (physics). */
  readonly allowStates: boolean;
  readonly allowParticles: boolean;
}

export interface ModeDefaults {
  readonly angleUnit: 'radian' | 'degree';
  readonly rounding: { readonly mode: 'decimals' | 'sig'; readonly digits: number };
  readonly view: { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number; readonly keepRatio: boolean };
  readonly axes: boolean;
  readonly grid: 'none' | 'major' | 'minor';
  /** Offer the "Create slider" chip for an unknown name a human typed (design 3.4). */
  readonly autoSliders: boolean;
  readonly autoLabels: 'all' | 'points' | 'none' | 'new-points-only';
  readonly pointStyle: PointStyle;
  readonly pointSize: number;
  readonly lineWidth: number;
  readonly dragDependent: boolean;
  readonly previewPoints: boolean;
  readonly greekAngleLabels: boolean;
  readonly equationForm: 'implicit' | 'explicit' | 'general';
  readonly coordinates: 'cartesian' | 'polar';
  /** Symbolic rows show exact answers first (cas). */
  readonly exact?: boolean;
}

export interface FeatureFlags {
  readonly sheet: boolean;
  readonly cas: boolean;
  readonly threeD: boolean;
  readonly scripting: boolean;
  readonly inputBar: boolean;
  readonly menu: boolean;
  readonly fileOps: boolean;
  readonly share: boolean;
  readonly export: boolean;
  readonly suggestions: boolean;
  readonly ansButton: boolean;
  readonly statistics: boolean;
  readonly clockBar: boolean;
  readonly undoRedo: boolean;
  readonly pageSet: boolean;
}

export type FeatureId = keyof FeatureFlags;

/** Defaults for the embed `ui` options (sdk). */
export interface UiOptions {
  readonly menu: boolean;
  readonly toolbar: boolean;
  readonly algebra: boolean;
  readonly inputBar: boolean;
  readonly zoomButtons: boolean;
  readonly fullscreenButton: boolean;
}

export interface ExamSupport {
  readonly allowed: boolean;
  readonly profiles: readonly ExamProfileId[];
}

export interface ModeConfig {
  readonly id: AppModeId;
  readonly title: LocaleKey;
  /** A one-line purpose, for the start tile. */
  readonly purpose: LocaleKey;
  /** When it ships; informative. */
  readonly stage: 1 | 2 | 3;
  /** False while the views it needs are not in this build. */
  readonly available: boolean;
  /** Why it is not available, when it is not. */
  readonly unavailableReason?: string;
  readonly views: ViewPolicy;
  readonly tools: ToolPolicy;
  readonly commands: CommandPolicy;
  readonly expressions: ExpressionPolicy;
  readonly defaults: ModeDefaults;
  readonly features: FeatureFlags;
  readonly keyboard: KeyboardId;
  /** The settings the panel offers. */
  readonly settings: readonly SettingId[];
  readonly ui: UiOptions;
  readonly exam: ExamSupport;
  /** Set on a mode made by `deriveMode`: the mode it narrows. */
  readonly derivedFrom?: AppModeId;
}

export interface ModeRestriction {
  readonly base: AppModeId;
  readonly hideViews?: readonly ViewKind[];
  readonly denyTools?: readonly ToolId[];
  readonly denyCommands?: readonly string[];
  /** Intersected with the base policy. */
  readonly allowOnlyCommands?: readonly string[];
  /** Built-in functions taken out (`sin`, `ln`). */
  readonly denyFunctions?: readonly string[];
  /** May only turn things off. */
  readonly features?: Partial<FeatureFlags>;
  readonly defaults?: Partial<ModeDefaults>;
}

/** A non-fatal problem found while deriving a mode (errors 2). */
export interface ModeWarning {
  readonly kind: 'restriction_widens' | 'restriction_invalid';
  readonly message: string;
  readonly field: string;
  readonly names?: readonly string[];
}

/** The error shape of the app layer (embed design `ApiError`). */
export interface ApiError {
  readonly ok: false;
  readonly area: 'api';
  readonly kind: string;
  readonly message: string;
  readonly hint?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type ApiResult<T> = { readonly ok: true; readonly value: T; readonly warnings?: readonly ModeWarning[] } | ApiError;

/* ------------------------------- exam ------------------------------- */

export type SettingValues = Readonly<Record<SettingId, unknown>>;

/** How results show during an exam: `decimals-only` hides exact forms (fractions, roots, π). */
export type OutputRule = 'decimals-only' | 'no-symbolic';

export interface ExamProfile {
  readonly id: ExamProfileId;
  readonly title: LocaleKey;
  /** Plain-language lines shown before the start (ui 5). */
  readonly rules: readonly LocaleKey[];
  /** Narrows the current mode; `base` is filled in with the mode at start. */
  readonly restrict: Omit<ModeRestriction, 'base'>;
  readonly lockSettings: readonly SettingId[];
  readonly forceSettings: SettingValues;
  readonly outputRules: readonly OutputRule[];
  readonly block: {
    readonly share: boolean; readonly export: boolean; readonly fileOpen: boolean; readonly fileSave: boolean;
    readonly network: boolean; readonly paste: boolean; readonly clipboardImages: boolean;
  };
  readonly watch: { readonly focusLoss: boolean; readonly fullscreenExit: boolean; readonly visibilityHidden: boolean; readonly multiWindow: boolean };
  readonly durationMinutes?: number;
  /** `flagged` when the learner left the window more than this many times, or for longer than `flagSeconds` in all. */
  readonly flagAfter: { readonly times: number; readonly seconds: number };
  /** Keep the exam figure on exit (otherwise the learner's earlier figure comes back). */
  readonly keepFigure: boolean;
}

export type ExamState = 'idle' | 'preparing' | 'active' | 'finished';

export type ExamSignalKind =
  | 'focus_lost' | 'focus_back' | 'fullscreen_exit' | 'tab_hidden' | 'tab_visible' | 'paste_blocked' | 'command_blocked' | 'reload';

export interface ExamSignal {
  readonly kind: ExamSignalKind;
  /** Milliseconds since the exam started. */
  readonly at: number;
  readonly detail?: string;
}

export interface ExamSummary {
  readonly profile: ExamProfileId;
  readonly mode: AppModeId;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
  readonly signals: readonly ExamSignal[];
  /** Times and total milliseconds away from the window. */
  readonly away: { readonly times: number; readonly ms: number };
  readonly flagged: boolean;
  readonly blockedCommands: readonly { readonly command: string; readonly count: number }[];
  readonly objectsAtEnd: number;
  readonly figureHash: string;
  /** The honesty note (design 3.7). */
  readonly note: string;
}
