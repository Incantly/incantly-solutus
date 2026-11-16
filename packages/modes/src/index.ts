/** @incantly/modes: App mode records and exam profiles, as data. No DOM. */
export type * from './types';
export { MODES, MODE_IDS, COMMAND_GROUPS } from './modes';
export { EXAM_PROFILES, CALCULUS_TOOLS } from './exam-profiles';
export {
  compilePolicy, getMode, availableModes, allowedInstead, filterCatalogue, allowedGroups, modeCard, modeSummary, closest, apiError,
} from './policy';
export type { CommandRef, CompiledPolicy } from './policy';
export { deriveMode, parseRestrict } from './derive';
export type { KnownNames } from './derive';
export { makeGate, catalogueOf } from './gate';
export type { GateLayer, GateOptions, ForbidReason, ModeForbidsError } from './gate';
export { SETTINGS, STORAGE_KEY, Settings, settingDef, validateSetting, directiveLine, settingFromDirective } from './settings';
export type { SettingDef, SettingType, SettingGroup, SetResult, SettingsProblem, StorageLike, SettingsOptions, Rounding } from './settings';
export { I18n, LOCALES, localeChain, directionOf, normaliseDigits } from './i18n';
export type { Catalogue, Message, I18nOptions } from './i18n';
export { en as EN_MESSAGES } from './locales/en';
export { LAYOUTS, validateLayout, layoutFor, applyKey } from './keyboard';
export type { Key, KeyAction, KeyboardLayout, KeyboardTab, LayoutProblem } from './keyboard';
export { switchMode } from './switch';
export type { ModeChangeResult, DroppedObject, SwitchOptions } from './switch';
export { ExamController, EXAM_NOTE, awayOf } from './exam';
export type { ExamFigure, ExamOptions, ExamAction } from './exam';
export { sha256 } from './sha256';
