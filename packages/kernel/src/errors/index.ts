/** The unified error system: registry, constructor, notices, phrases, limits, compaction and repair helpers. */
export { errorTable, checkErrorTable, err, internalError, fallbackInternal, placeholdersOf, renderMessage, isErrorObject } from './table';
export type { ErrorSpec, ErrArgs, TableProblem as ErrorTableProblem } from './table';
export { makeNotice, becameUndefinedNotice, joinNames, NOTICE_TABLE } from './notices';
export { reasonPhrase, registerReasonPhrase, phraseReasons } from './phrases';
export type { ReasonPhrase } from './phrases';
export { DEFAULT_LIMITS, resolveLimits } from './limits';
export type { Limits } from './limits';
export { compactError, COMPACT_LIMIT } from './compact';
export type { CompactError } from './compact';
export { nearestNames, defineLine } from './suggest';
