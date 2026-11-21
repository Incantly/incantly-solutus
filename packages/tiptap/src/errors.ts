/**
 * The errors of the extension (docs/features/tiptap/errors.md): data in the format of docs/features/errors/design.md,
 * never thrown. A figure's error never breaks the document.
 */

export type TiptapErrorKind =
  | 'bad_attrs'
  | 'mount_failed'
  | 'context_lost'
  | 'restore_failed'
  | 'ai_unavailable'
  | 'ai_partial'
  | 'collab_conflict'
  /** A command named a figure the document does not hold. */
  | 'figure_not_found'
  /** A figure's picture could not be made. */
  | 'export_failed'
  /** A formula's expression failed. */
  | 'formula_failed';

export interface TiptapError {
  readonly ok: false;
  readonly kind: TiptapErrorKind;
  readonly message: string;
  readonly hint?: string;
  /** The id of the figure the error is about. */
  readonly node?: string;
  /** Facts a host may use: the lines that failed, the lines kept, the reason. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface TiptapOk<T> {
  readonly ok: true;
  readonly value: T;
  readonly notices: readonly never[];
}

export type TiptapResult<T> = TiptapOk<T> | TiptapError;

export const ok = <T>(value: T): TiptapOk<T> => ({ ok: true, value, notices: [] });

export function tiptapError(
  kind: TiptapErrorKind,
  message: string,
  extra: { readonly hint?: string; readonly node?: string; readonly detail?: Readonly<Record<string, unknown>> } = {},
): TiptapError {
  return {
    ok: false,
    kind,
    message,
    ...(extra.hint !== undefined ? { hint: extra.hint } : {}),
    ...(extra.node !== undefined ? { node: extra.node } : {}),
    ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
  };
}

export const isTiptapError = (x: unknown): x is TiptapError =>
  typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false && typeof (x as { kind?: unknown }).kind === 'string';
