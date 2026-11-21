/**
 * The errors of the board (docs/features/board/errors.md): data in the format of docs/features/errors/design.md, never
 * thrown. A refused transaction changes nothing.
 */

export type BoardErrorKind =
  /** A file or pasted JSON fails the checks. */
  | 'board_invalid'
  /** The file's `version` is newer than this app knows. */
  | 'board_too_new'
  /** A write gives a record a shape its kind or its type refuses. */
  | 'record_invalid'
  /** A record names a kind that is not registered. */
  | 'kind_unknown'
  /** Over a page, shape, ink point or asset limit. */
  | 'limit'
  /** Removing the only page. */
  | 'last_page'
  /** An asset is not accepted. */
  | 'asset_invalid'
  /** A call named something that does not exist, or came at the wrong moment. */
  | 'bad_argument'
  /** Undo or redo with an empty stack. */
  | 'nothing_to_undo'
  /** A callback threw, or a bug in the board. */
  | 'internal';

export interface BoardError {
  readonly ok: false;
  readonly kind: BoardErrorKind;
  readonly message: string;
  readonly hint?: string;
  /** Facts a host may use: the record and field, the limit, the page. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface BoardOk<T> {
  readonly ok: true;
  readonly value: T;
  readonly notices: readonly never[];
}

export type BoardResult<T> = BoardOk<T> | BoardError;

export const ok = <T>(value: T): BoardOk<T> => ({ ok: true, value, notices: [] });

/** The result of a call that has nothing to give back. */
export const DONE: BoardOk<undefined> = Object.freeze({ ok: true, value: undefined, notices: Object.freeze([]) as readonly never[] });

export function boardError(
  kind: BoardErrorKind,
  message: string,
  extra: { readonly hint?: string; readonly detail?: Readonly<Record<string, unknown>> } = {},
): BoardError {
  return {
    ok: false,
    kind,
    message,
    ...(extra.hint !== undefined ? { hint: extra.hint } : {}),
    ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
  };
}

export const isBoardError = (x: unknown): x is BoardError =>
  typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false && typeof (x as { kind?: unknown }).kind === 'string';

/** The same error with more facts in `detail` (the facts already there win). */
export function withDetail(error: BoardError, detail: Readonly<Record<string, unknown>>): BoardError {
  return { ...error, detail: { ...detail, ...error.detail } };
}

/** A record that fails a check: names the record and the field. */
export function recordInvalid(record: string, field: string, message: string, hint?: string): BoardError {
  return boardError('record_invalid', message, { ...(hint !== undefined ? { hint } : {}), detail: { record, field } });
}

/** The text of a thrown value, for an `internal` error. */
export const describeThrown = (e: unknown): string => (e instanceof Error ? e.message : String(e));
