/**
 * View error construction (docs/features/errors/design.md sections 3 to 5).
 *
 * Every fallible public function in this package returns `Result<T>` and never
 * throws across the package boundary. Only `CoreErrorKind`s are used here; the
 * graphics-view study also names `bad_layer`, `bad_export`, `conflicting_style`
 * and `property_not_for_type`, which the kernel area owns as registry entries.
 * Until the integrator appends them, this package reports those cases with the
 * closest core kind and a stable `view.*` message key (see builder notes).
 */
import type { ErrorKind, ErrorObject, Notice, Params, Phase, Recovery, Result } from '@incantly/kernel';

interface KindSpec {
  readonly code: string;
  readonly phase: Phase;
  readonly recovery: Recovery;
}

/** Stable machine codes for the view area (letter V). */
export const VIEW_ERROR_CODES: Readonly<Record<string, KindSpec>> = {
  limit: { code: 'V001', phase: 'plan', recovery: 'rewrite' },
  bad_directive: { code: 'V002', phase: 'parse', recovery: 'fix_line' },
  bad_property_value: { code: 'V003', phase: 'typecheck', recovery: 'fix_line' },
  unknown_property: { code: 'V004', phase: 'typecheck', recovery: 'use_suggestion' },
  bad_argument: { code: 'V005', phase: 'typecheck', recovery: 'fix_line' },
  internal: { code: 'V999', phase: 'runtime-host', recovery: 'skip' },
};

export const VIEW_MESSAGE_TEMPLATES: Readonly<Record<string, string>> = {
  'view.limit': 'That would exceed the limit of {max} {what}.',
  'view.bad_directive': '{directive} needs {need}.',
  'view.bad_property_value': '{key} must be {allowed}.',
  'view.unknown_property': '{key} is not a property.',
  'view.bad_argument': '{what}: {why}.',
  'view.internal': 'Something went wrong inside {where}; nothing was changed.',
};

export function renderViewMessage(key: string, params: Params): string {
  const tpl = VIEW_MESSAGE_TEMPLATES[key];
  if (tpl === undefined) return key;
  return tpl.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v: unknown = params[name];
    if (v === undefined) return `{${name}}`;
    return Array.isArray(v) ? v.join(', ') : String(v);
  });
}

export interface ViewErrorInput {
  readonly kind: ErrorKind;
  readonly messageKey: string;
  readonly params: Params;
  readonly line?: number;
  readonly col?: number;
  readonly endCol?: number;
  readonly token?: string;
  readonly expected?: readonly string[];
  readonly forms?: readonly string[];
  readonly hint?: string;
  readonly suggest?: readonly string[];
  readonly related?: readonly string[];
}

/** Build an `ErrorObject` for the view area, filling code, phase and recovery. */
export function viewError(input: ViewErrorInput): ErrorObject {
  const spec = VIEW_ERROR_CODES[input.kind] ?? VIEW_ERROR_CODES['internal'];
  const safe = spec ?? { code: 'V999', phase: 'runtime-host', recovery: 'skip' };
  const col = input.col ?? 1;
  return {
    ok: false,
    committed: false,
    kind: input.kind,
    code: safe.code,
    phase: safe.phase,
    message: renderViewMessage(input.messageKey, input.params),
    messageKey: input.messageKey,
    params: input.params,
    line: input.line ?? 1,
    col,
    endCol: input.endCol ?? col,
    token: input.token ?? '',
    expected: input.expected ?? [],
    forms: input.forms ?? [],
    suggest: input.suggest ?? [],
    recovery: safe.recovery,
    ...(input.hint === undefined ? {} : { hint: input.hint }),
    ...(input.related === undefined ? {} : { related: input.related }),
    fingerprint: `${input.kind}:${input.messageKey}`,
    severity: 'error',
  };
}

/** Success helper so call sites always attach the notices array. */
export function okResult<T>(value: T, notices: readonly Notice[] = []): Result<T> {
  return { ok: true, value, notices };
}

/**
 * Run `fn` and convert an accidental throw into an `internal` error.
 * Public entry points that touch the GPU or the DOM use this wrapper so
 * nothing ever throws across the package boundary.
 */
export function guard<T>(where: string, fn: () => T): Result<T> {
  try {
    return okResult(fn());
  } catch {
    return viewError({
      kind: 'internal',
      messageKey: 'view.internal',
      params: { where },
      token: where,
    });
  }
}

/** Build a view notice (mesh truncated, labels hidden, ...). */
export function viewNotice(
  severity: 'info' | 'warning',
  code: string,
  message: string,
  params: Params = {},
  names?: readonly string[],
): Notice {
  return {
    severity,
    code,
    kind: 'clamped',
    message,
    params,
    ...(names === undefined ? {} : { names }),
  };
}
