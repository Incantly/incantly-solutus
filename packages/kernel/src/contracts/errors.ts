/**
 * The one error format every package returns (docs/features/errors/design.md, sections 3 to 5).
 * Owned by the kernel area. Other areas may only append entries to the registries below
 * (`AreaErrorKinds`, `AreaNoticeKinds`); they never change these shapes.
 */

export type Phase = 'lex' | 'parse' | 'resolve' | 'typecheck' | 'plan' | 'commit' | 'load' | 'tool' | 'runtime-host';

export type Recovery =
  | 'fix_line'
  | 'use_suggestion'
  | 'choose_form'
  | 'create_first'
  | 'fix_earlier'
  | 'choose'
  | 'rewrite'
  | 'skip'
  | 'report';

/** Kinds shared by every area. Area kinds are added to `AreaErrorKinds` by declaration merging. */
export type CoreErrorKind =
  | 'syntax' | 'unbalanced' | 'bad_number' | 'unterminated_string' | 'bad_character'
  | 'unknown_directive' | 'bad_directive'
  | 'unknown_name' | 'unknown_command' | 'unknown_property' | 'reserved_name' | 'bad_name'
  | 'name_taken' | 'unnamed_object' | 'duplicate_param' | 'not_callable'
  | 'no_matching_form' | 'arg_count' | 'type_mismatch' | 'type_change' | 'bad_property_value'
  | 'bad_range' | 'bad_argument'
  | 'cycle' | 'forward_reference' | 'locked' | 'not_free' | 'missing_rate'
  | 'nothing_to_undo'
  | 'limit' | 'load_failed' | 'version'
  | 'tool_input' | 'tool_busy'
  | 'internal';

/**
 * Area kinds, append-only. Each area adds its kinds under its own comment line, one per line,
 * for example `mixed_dimension: true;` under `// space-3d`. Never remove or rename an entry.
 */
export interface AreaErrorKinds {
  // language
  bad_escape: true;
  bad_format: true;
  missing_operator: true;
  ambiguous_implicit: true;
  chained_comparison: true;
  assign_in_expr: true;
  unknown_function: true;
  free_variable: true;
  breaks_dependents: true;
  empty_list_type: true;
  duplicate_arg: true;
  not_a_binder: true;
  // geometry (codes C010 to C029)
  not_a_path: true;
  not_a_region: true;
  too_few_points: true;
  not_supported: true;
  not_a_transform: true;
  not_quadratic: true;
  not_polynomial: true;
  bad_equation: true;
  no_dependency: true;
  // functions (codes C030 to C049)
  needs_interval: true;
  not_differentiable: true;
  missing_range: true;
}

export type ErrorKind = CoreErrorKind | Extract<keyof AreaErrorKinds, string>;

export type Params = Readonly<Record<string, string | number | boolean | readonly string[]>>;

export interface ErrorObject {
  readonly ok: false;
  /** Always false: a failing line changes nothing. */
  readonly committed: false;
  readonly kind: ErrorKind;
  /** Stable machine code: area letter and three digits, such as "L003". */
  readonly code: string;
  readonly phase: Phase;
  /** One plain sentence, built from messageKey and params. */
  readonly message: string;
  readonly messageKey: string;
  readonly params: Params;

  /** 1-based line in the submitted batch or file. */
  readonly line: number;
  /** 1-based column in UTF-16 code units. */
  readonly col: number;
  /** Exclusive. Equal to col for a zero-width error. */
  readonly endCol: number;
  readonly token: string;
  readonly source?: string;

  readonly expected: readonly string[];
  readonly forms: readonly string[];
  readonly formsOmitted?: number;
  readonly hint?: string;
  /** Up to 3 complete replacement lines likely to pass. */
  readonly suggest: readonly string[];
  readonly recovery: Recovery;
  readonly related?: readonly string[];
  readonly path?: readonly string[];
  readonly blockedBy?: { readonly line: number; readonly kind: ErrorKind };
  readonly cause?: ErrorObject;
  readonly fingerprint: string;
  readonly severity: 'error';
}

/** Notice kinds shared by every area. Area notice kinds are added to `AreaNoticeKinds`, append-only. */
export type CoreNoticeKind = 'became_undefined' | 'dependents_removed' | 'property_detached' | 'clamped' | 'shadowed' | 'precision_loss';

export interface AreaNoticeKinds {
  // language
  index_literal: true;
  unused_binder: true;
  // kernel
  became_defined: true;
  moved_for_order: true;
  confusable_name: true;
  redefined_to_same: true;
  listener_failed: true;
  step_hidden: true;
  shadowed_default: true;
  unstable_state: true;
}

export type NoticeKind = CoreNoticeKind | Extract<keyof AreaNoticeKinds, string>;

/** A success that carries a fact the caller should know. Never an error. */
export interface Notice {
  readonly severity: 'info' | 'warning';
  readonly code: string;
  readonly kind: NoticeKind;
  readonly message: string;
  readonly params: Params;
  readonly names?: readonly string[];
}

/** Every public function returns this; nothing throws across a package boundary. */
export type Result<T> = { readonly ok: true; readonly value: T; readonly notices: readonly Notice[] } | ErrorObject;

/** A source span, 1-based, end exclusive. */
export interface Span {
  readonly line: number;
  readonly col: number;
  readonly endCol: number;
}
