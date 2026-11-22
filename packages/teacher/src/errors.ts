/**
 * Errors of the teacher (docs/features/teacher/errors.md): the kernel's error object for what a tool or a turn reports,
 * the SDK shape for what ends a stream, and the notices of a turn's last event. Nothing here throws.
 */
import { err, internalError } from '@incantly/kernel';
import type { ErrorObject } from '@incantly/kernel';
import type { JsonLike } from './tools/types';

/** Errors that end a stream, in the SDK shape (`docs/features/teacher/errors.md`, intro). */
export interface StreamError {
  readonly ok: false;
  readonly kind: string;
  readonly message: string;
  readonly hint?: string;
  readonly detail?: Readonly<Record<string, JsonLike>>;
}

/** A notice in a turn's final event: a fact that does not end the turn (`retry_spent`, `stream_cut`). */
export interface TurnNotice {
  readonly kind: 'retry_spent' | 'stream_cut';
  readonly code: string;
  readonly message: string;
  readonly names?: readonly string[];
}

/** Where a tool-level error points: the call as a whole, not a column. */
const WHOLE = { line: 0, col: 1, endCol: 1 } as const;

/** The SDK-shaped error of a kernel error object, with its code and recovery in `detail`. */
export function streamErrorOf(e: ErrorObject): StreamError {
  return { ok: false, kind: e.kind, message: e.message, ...(e.hint !== undefined ? { hint: e.hint } : {}), detail: { code: e.code, recovery: e.recovery } };
}

/** T003: a turn passed a limit. `what` reads "8 model calls", "24 tool calls" or "60 s". */
export function turnLimitError(what: string): ErrorObject {
  return err('turn_limit', WHOLE, { what }, { token: what, recovery: 'report', fingerprintKey: what, hint: 'What was drawn stays; ask again for the rest.' });
}

/** T004: a call to a tool outside the job's toolset. */
export function toolUnknownError(name: string, tools: readonly string[]): ErrorObject {
  return err('tool_unknown', WHOLE, { name, list: tools.join(', ') }, { token: name, expected: tools, recovery: 'fix_line', fingerprintKey: name, hint: `Use one of: ${tools.join(', ')}.` });
}

/** T005: a line left out after its retries. `line` is its place in the call. */
export function retrySpentError(name: string, line: number, source: string): ErrorObject {
  return err('retry_spent', { line, col: 1, endCol: 1 }, { name }, { token: name, source, recovery: 'skip', fingerprintKey: name, hint: 'Leave this line out and go on.' });
}

/** T006: the answer stopped partway. `n` is how many lines were drawn. */
export function streamCutError(n: number): ErrorObject {
  return err('stream_cut', WHOLE, { n }, { recovery: 'report', fingerprintKey: String(n) });
}

/** The notice of a `retry_spent` or `stream_cut` error. */
export function noticeOf(e: ErrorObject, names?: readonly string[]): TurnNotice {
  return { kind: e.kind === 'stream_cut' ? 'stream_cut' : 'retry_spent', code: e.code, message: e.message, ...(names !== undefined ? { names } : {}) };
}

/** An `internal` error for a fault inside `where`. */
export function faultError(where: string, detail = ''): ErrorObject {
  return internalError(`teacher.${where}`, WHOLE, detail, detail);
}

/**
 * The function a `StateMachine` hears a refused move with (`state-refusal-reported`): the refusal becomes an
 * `internal` error given to `report`. A refused move is a bug in the teacher, never a request error.
 */
export function refusedMove(machine: string, report: (e: ErrorObject) => void): (from: string, event: string) => void {
  return (from, event) => {
    try {
      report(faultError(machine, `${from}.${event}`));
    } catch {
      // the host's report function failed; there is nobody left to tell
    }
  };
}
