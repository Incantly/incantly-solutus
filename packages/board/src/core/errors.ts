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
  /** The tool id is not registered. */
  | 'tool_unknown'
  /** Two actions got the same key; the later one has no key. */
  | 'shortcut_conflict'
  /** A custom SVG icon has script, event attributes or outside links; the default icon is used. */
  | 'icon_invalid'
  /** A figure card's script fails or its mount fails; the card keeps its picture and shows a small error badge. */
  | 'figure_failed'
  /** WebGL 2 is not available or its context cannot come back: the board draws with Canvas 2D. */
  | 'render_failed'
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

/** A success that carries a fact the caller should know (errors.md): `record_kept_raw`. */
export interface BoardNotice {
  readonly severity: 'info' | 'warning';
  readonly kind: 'record_kept_raw';
  readonly message: string;
  /** Facts a host may use: the records, each with its field and why. */
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface BoardOk<T> {
  readonly ok: true;
  readonly value: T;
  readonly notices: readonly BoardNotice[];
}

export type BoardResult<T> = BoardOk<T> | BoardError;

export const ok = <T>(value: T): BoardOk<T> => ({ ok: true, value, notices: [] });

/** A success with notices. */
export const okWith = <T>(value: T, notices: readonly BoardNotice[]): BoardOk<T> => ({ ok: true, value, notices });

/** The result of a call that has nothing to give back. */
export const DONE: BoardOk<undefined> = Object.freeze({ ok: true, value: undefined, notices: Object.freeze([]) as readonly BoardNotice[] });

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

/** Where a board error goes: the board's `onError`. */
export type ErrorSink = (error: BoardError) => void;

/**
 * The `onRefused` of a state machine (docs/state-machines.md, how to read): a move the table refuses is told to the
 * board's `onError` as `internal`, with the machine, the state and the event. `sink` is read when a move is refused, so
 * the owner may set it after the machine is made.
 */
export function refusedMove(machine: string, sink: () => ErrorSink | undefined): (from: string, event: string) => void {
  return (from, event) => {
    try {
      sink()?.(boardError('internal', `The ${machine} machine refused "${event}" in the state "${from}".`, { detail: { machine, state: from, event } }));
    } catch {
      // the host's error handler failed; there is nobody left to tell
    }
  };
}

/** The text of a thrown value, for an `internal` error. */
export const describeThrown = (e: unknown): string => (e instanceof Error ? e.message : String(e));
