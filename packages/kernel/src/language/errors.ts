/**
 * Error construction for the language (docs/features/errors/design.md sections 3 to 5,
 * docs/features/language/errors.md). Every error is data in the unified `ErrorObject` format,
 * with the language's extra fields (`fix`, `quickFixes`, `more`, `problems`, ...).
 */
import type { ErrorKind, ErrorObject, Notice, NoticeKind, Params, Phase, Recovery } from '../contracts/errors';
import type { SourceMap } from './source';

export interface ArgProblem {
  /** Index of the argument; -1 when an argument is missing; args.length when extra. */
  readonly argIndex: number;
  readonly param?: string;
  readonly expected: string;
  readonly got: string;
  readonly col: number;
  readonly endCol: number;
}

export interface QuickFix {
  readonly label: string;
  readonly lines: readonly string[];
}

/** An `ErrorObject` plus the optional fields the language adds. */
export interface LanguageError extends ErrorObject {
  /** One complete replacement line that is safe to apply. */
  readonly fix?: string;
  /** Multi-line repairs for the input bar. */
  readonly quickFixes?: readonly QuickFix[];
  /** Further independent errors found in the same line (resolve and check steps only). */
  readonly more?: readonly LanguageError[];
  /** Per-argument diagnosis of a `no_matching_form`. */
  readonly problems?: readonly ArgProblem[];
  readonly left?: string;
  readonly right?: string;
  readonly limit?: { readonly name: string; readonly max: number; readonly got: number };
  /** The index of the earlier failed line in a batch that caused this one. */
  readonly after?: number;
}

interface KindSpec {
  readonly code: string;
  readonly phase: Phase;
  readonly recovery: Recovery;
}

/** Codes follow docs/features/errors/errors.md; kinds the language adds take the next free L numbers. */
export const ERROR_KINDS: Readonly<Record<string, KindSpec>> = {
  syntax: { code: 'L001', phase: 'parse', recovery: 'fix_line' },
  unbalanced: { code: 'L002', phase: 'parse', recovery: 'use_suggestion' },
  bad_number: { code: 'L003', phase: 'lex', recovery: 'fix_line' },
  unterminated_string: { code: 'L004', phase: 'lex', recovery: 'use_suggestion' },
  bad_character: { code: 'L005', phase: 'lex', recovery: 'use_suggestion' },
  unknown_directive: { code: 'L006', phase: 'parse', recovery: 'fix_line' },
  bad_directive: { code: 'L007', phase: 'parse', recovery: 'fix_line' },
  bad_escape: { code: 'L008', phase: 'lex', recovery: 'fix_line' },
  bad_format: { code: 'L009', phase: 'lex', recovery: 'fix_line' },
  missing_operator: { code: 'L010', phase: 'parse', recovery: 'use_suggestion' },
  ambiguous_implicit: { code: 'L011', phase: 'parse', recovery: 'choose' },
  chained_comparison: { code: 'L012', phase: 'parse', recovery: 'fix_line' },
  assign_in_expr: { code: 'L013', phase: 'parse', recovery: 'use_suggestion' },
  unknown_function: { code: 'L014', phase: 'resolve', recovery: 'use_suggestion' },
  free_variable: { code: 'L015', phase: 'resolve', recovery: 'use_suggestion' },
  breaks_dependents: { code: 'L016', phase: 'plan', recovery: 'choose' },
  empty_list_type: { code: 'L017', phase: 'typecheck', recovery: 'fix_line' },
  duplicate_arg: { code: 'L018', phase: 'typecheck', recovery: 'fix_line' },
  not_a_binder: { code: 'L019', phase: 'typecheck', recovery: 'fix_line' },
  unnamed_object: { code: 'K006', phase: 'parse', recovery: 'use_suggestion' },
  unknown_name: { code: 'K001', phase: 'resolve', recovery: 'create_first' },
  unknown_command: { code: 'K002', phase: 'resolve', recovery: 'use_suggestion' },
  reserved_name: { code: 'K003', phase: 'resolve', recovery: 'rewrite' },
  bad_name: { code: 'K004', phase: 'resolve', recovery: 'rewrite' },
  name_taken: { code: 'K005', phase: 'resolve', recovery: 'rewrite' },
  duplicate_param: { code: 'K007', phase: 'resolve', recovery: 'fix_line' },
  not_callable: { code: 'K008', phase: 'resolve', recovery: 'fix_line' },
  cycle: { code: 'K010', phase: 'plan', recovery: 'rewrite' },
  type_change: { code: 'K011', phase: 'plan', recovery: 'rewrite' },
  missing_rate: { code: 'K015', phase: 'plan', recovery: 'create_first' },
  unknown_property: { code: 'K020', phase: 'typecheck', recovery: 'use_suggestion' },
  bad_property_value: { code: 'K021', phase: 'typecheck', recovery: 'fix_line' },
  limit: { code: 'K040', phase: 'plan', recovery: 'rewrite' },
  no_matching_form: { code: 'C001', phase: 'typecheck', recovery: 'choose_form' },
  arg_count: { code: 'C002', phase: 'typecheck', recovery: 'fix_line' },
  type_mismatch: { code: 'C003', phase: 'typecheck', recovery: 'rewrite' },
  bad_argument: { code: 'C004', phase: 'typecheck', recovery: 'fix_line' },
  bad_range: { code: 'C005', phase: 'typecheck', recovery: 'fix_line' },
  forward_reference: { code: 'K012', phase: 'plan', recovery: 'choose' },
  not_free: { code: 'K013', phase: 'plan', recovery: 'choose' },
  locked: { code: 'K014', phase: 'plan', recovery: 'choose' },
  nothing_to_undo: { code: 'K030', phase: 'plan', recovery: 'skip' },
  load_failed: { code: 'K041', phase: 'load', recovery: 'report' },
  version: { code: 'K042', phase: 'load', recovery: 'report' },
  tool_input: { code: 'T001', phase: 'tool', recovery: 'fix_line' },
  tool_busy: { code: 'T002', phase: 'tool', recovery: 'skip' },
  internal: { code: 'K999', phase: 'commit', recovery: 'skip' },
};

/** English templates; `{name}` is replaced from `params`. The key, not the sentence, is the identity. */
export const MESSAGE_TEMPLATES: Record<string, string> = {
  'lang.syntax': 'Unexpected {token}. Expected {expected}.',
  'lang.syntax_end': 'The line ends too soon. Expected {expected}.',
  'lang.syntax_call': 'Unexpected {token} in a call to {command}: {why}.',
  'lang.colon_label': "A name is given to an object with '=', not ':'.",
  'lang.unbalanced_open': '{open} on column {col} is never closed.',
  'lang.unbalanced_close': 'Unmatched {close}.',
  'lang.unbalanced_mismatch': '{open} on column {col} is closed by {close}; expected {want}.',
  'lang.bad_number': '{token} is not a valid number: {why}.',
  'lang.unterminated_string': 'The text starting at column {col} has no closing quote.',
  'lang.bad_escape': '\\{ch} is not a valid escape in text.',
  'lang.bad_format': '{fmt} is not a text format.',
  'lang.bad_character': 'The character {token} ({cp}) is not part of the language.',
  'lang.bad_character_look': 'The character {token} ({cp}, {script}) is not allowed in a name.',
  'lang.bad_character_digit': 'The digit {token} ({cp}) is not an ASCII digit.',
  'lang.unknown_directive': '{token} is not a directive.',
  'lang.bad_directive': '{directive} needs {need}.',
  'lang.missing_operator': 'Two values touch with no operator between them.',
  'lang.ambiguous_implicit': "'{text}' can mean {a} or {b}.",
  'lang.chained_comparison': '{why}.',
  'lang.assign_in_expr': "A line defines one object with '='; {why}.",
  'lang.unnamed_object': 'Give the result a name: Name = {line}.',
  'lang.unknown_name': '{name} is not defined.',
  'lang.unknown_command': '{name} is not a command.',
  'lang.unknown_function': '{name} is not a function.',
  'lang.not_callable': '{name} is a {type}, not a function or command.',
  'lang.free_variable': '{name} is only available inside a function or an equation, and {owner} is a plain {type}.',
  'lang.reserved_name': '{name} is reserved ({group}) and cannot name an object.',
  'lang.bad_name': '{name} cannot be a name: {why}.',
  'lang.name_taken': '{name} is already used by a {type}.',
  'lang.duplicate_param': 'The parameter {name} appears twice.',
  'lang.duplicate_arg': 'The argument {name} is given more than once.',
  'lang.not_a_binder': 'This position takes a bare name, not an expression.',
  'lang.no_matching_form': '{command} has no form for ({given}).',
  'lang.arg_count': '{name} takes {n} argument(s); got {m}.',
  'lang.type_mismatch': 'Cannot {op} a {left} and a {right}.',
  'lang.type_mismatch_unary': 'Cannot apply {op} to a {left}.',
  'lang.type_mismatch_where': '{why}.',
  'lang.type_change': '{name} is a {from}; this line would make it a {to}.',
  'lang.cycle': '{name} would depend on itself: {path}.',
  'lang.breaks_dependents': 'Changing {name} would break {n} object(s) that read it.',
  'lang.empty_list_type': 'An empty list needs a type; nothing here says what it holds.',
  'lang.bad_range': '{why}.',
  'lang.bad_argument': '{command}: {why}.',
  'lang.unknown_property': '{key} is not a property.',
  'lang.bad_property_value': '{key} must be {allowed}.',
  'lang.limit': 'That would exceed the limit of {max} {what}.',
  'lang.missing_rate': '{name} is a state but has no rate.',
  'lang.internal': 'Something went wrong inside {where}; nothing was changed.',
  'kernel.forward_reference': '{name} needs {input}, which is defined later.',
  'kernel.not_free': '{name} is computed from {inputs}; it has no value of its own to set.',
  'kernel.locked': '{name} is fixed and cannot be changed by a line.',
  'kernel.nothing_to_undo': 'There is nothing to {what}.',
  'kernel.load_failed': 'The file could not be loaded: {n} line(s) failed.',
  'kernel.version': 'This file is version {v}; supported: {list}.',
  'kernel.tool_input': '{tool} needs {expected}.',
  'kernel.tool_busy': 'The figure is busy; try again.',
  'kernel.unknown_property': '{type} has no property {key}.',
  'kernel.bad_property_value': '{key} must be {allowed}; got {token}.',
  'kernel.state_owned': '{name} is a state; the solver owns its value.',
  'kernel.bad_value': '{name} holds a {type}; {why}.',
  'kernel.wrong_value': '{name} holds a {type}; {why}.',
};

export function render(key: string, params: Params): string {
  const tpl = MESSAGE_TEMPLATES[key];
  if (tpl === undefined) return key;
  return tpl.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) return `{${name}}`;
    return Array.isArray(v) ? v.join(', ') : String(v);
  });
}

export interface ErrorExtra {
  expected?: readonly string[];
  forms?: readonly string[];
  formsOmitted?: number;
  hint?: string;
  suggest?: readonly string[];
  recovery?: Recovery;
  related?: readonly string[];
  path?: readonly string[];
  blockedBy?: { line: number; kind: ErrorKind };
  cause?: ErrorObject;
  fix?: string;
  quickFixes?: readonly QuickFix[];
  more?: readonly LanguageError[];
  problems?: readonly ArgProblem[];
  left?: string;
  right?: string;
  limit?: { name: string; max: number; got: number };
  after?: number;
  message?: string;
  fingerprintKey?: string;
}

/** Builds errors for one source line (or logical line), converting offsets to line and columns. */
export class Diag {
  constructor(readonly sm: SourceMap) {}

  /** Error at the normalised range [s, e). */
  at(kind: string, s: number, e: number, key: string, params: Params, extra: ErrorExtra = {}): LanguageError {
    const sp = this.sm.span(s, e);
    return buildError(kind, key, params, sp.line, sp.col, sp.endCol, sp.token, this.sm.raw, extra);
  }
}

export function buildError(
  kind: string,
  key: string,
  params: Params,
  line: number,
  col: number,
  endCol: number,
  token: string,
  source: string | undefined,
  extra: ErrorExtra = {},
): LanguageError {
  const spec = ERROR_KINDS[kind] ?? ERROR_KINDS['internal'] as KindSpec;
  const suggest = (extra.suggest ?? []).slice(0, 3);
  const message = extra.message ?? render(key, params);
  const fix = extra.fix ?? (suggest.length === 1 && !extra.quickFixes ? suggest[0] : undefined);
  const forms = extra.forms ?? [];
  const shownForms = forms.slice(0, 6);
  const o: Record<string, unknown> = {
    ok: false,
    committed: false,
    kind: kind as ErrorKind,
    code: spec.code,
    phase: spec.phase,
    message,
    messageKey: key,
    params,
    line,
    col,
    endCol,
    token,
    expected: (extra.expected ?? []).slice(0, 8),
    forms: shownForms,
    suggest,
    recovery: extra.recovery ?? (suggest.length > 0 && spec.recovery === 'fix_line' ? 'use_suggestion' : spec.recovery),
    fingerprint: `${kind}:${extra.fingerprintKey ?? token}`,
    severity: 'error',
  };
  if (source !== undefined && source.length <= 200) o['source'] = source;
  if (forms.length > shownForms.length) o['formsOmitted'] = forms.length - shownForms.length;
  o['hint'] = extra.hint !== undefined && extra.hint.trim() !== '' ? extra.hint : defaultHint(kind, extra.expected ?? [], suggest);
  if (extra.related !== undefined) o['related'] = extra.related;
  if (extra.path !== undefined) o['path'] = extra.path;
  if (extra.blockedBy !== undefined) o['blockedBy'] = extra.blockedBy;
  if (extra.cause !== undefined) o['cause'] = extra.cause;
  if (fix !== undefined) o['fix'] = fix;
  if (extra.quickFixes !== undefined) o['quickFixes'] = extra.quickFixes;
  if (extra.more !== undefined && extra.more.length > 0) o['more'] = extra.more;
  if (extra.problems !== undefined) o['problems'] = extra.problems;
  if (extra.left !== undefined) o['left'] = extra.left;
  if (extra.right !== undefined) o['right'] = extra.right;
  if (extra.limit !== undefined) o['limit'] = extra.limit;
  if (extra.after !== undefined) o['after'] = extra.after;
  return o as unknown as LanguageError;
}

/** A hint for the errors that did not get a specific one: the hint is always present and never empty. */
function defaultHint(kind: string, expected: readonly string[], suggest: readonly string[]): string {
  if (suggest.length > 0) return 'Try the suggested line.';
  if (expected.length > 0) return `Expected ${typeList(expected.slice(0, 4).map((e) => (e.length > 0 ? e : 'more input')))} at this point.`;
  switch (kind) {
    case 'syntax':
      return 'Check the line near the marked column; operators need a value on both sides.';
    case 'internal':
      return 'Report this; nothing was changed.';
    default:
      return 'Check the marked part of the line.';
  }
}

/** Same error with `more` attached. */
export function withMore(first: LanguageError, rest: readonly LanguageError[]): LanguageError {
  if (rest.length === 0) return first;
  return { ...first, more: rest.slice(0, 7) };
}

/* ------------------------------ notices ------------------------------ */

const NOTICE_CODES: Readonly<Record<string, string>> = {
  shadowed: 'L201',
  index_literal: 'L202',
  precision_loss: 'L203',
  clamped: 'L204',
  unused_binder: 'L205',
};

export function notice(kind: NoticeKind, severity: 'info' | 'warning', message: string, params: Params, names?: readonly string[]): Notice {
  const n: Record<string, unknown> = { severity, code: NOTICE_CODES[kind] ?? 'L200', kind, message, params };
  if (names !== undefined) n['names'] = names;
  return n as unknown as Notice;
}

/* --------------------------- suggestion helpers --------------------------- */

/** Edit distance with adjacent transpositions (optimal string alignment). */
export function editDistance(a: string, b: string, cap = 8): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > cap) return cap + 1;
  let prev2: number[] = [];
  let prev: number[] = [];
  for (let j = 0; j <= lb; j++) prev.push(j);
  for (let i = 1; i <= la; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, (prev2[j - 2] as number) + 1);
      }
      cur.push(v);
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[lb] as number;
}

/**
 * The closest names, at most `k`. Threshold is max(1, floor(len / 3)). Case-insensitive; an exact
 * match ignoring case ranks first.
 */
export function closestNames(name: string, candidates: Iterable<string>, k = 3): string[] {
  const lower = name.toLowerCase();
  const limit = Math.max(1, Math.floor(name.length / 3));
  const scored: { c: string; d: number }[] = [];
  for (const c of candidates) {
    if (c === name) continue;
    const cl = c.toLowerCase();
    let d = cl === lower ? 0 : editDistance(lower, cl, limit + 1);
    if (d > limit) continue;
    if (cl === lower) d = 0;
    scored.push({ c, d: d + (c === name ? 0 : 0) });
  }
  scored.sort((x, y) => x.d - y.d || (x.c < y.c ? -1 : x.c > y.c ? 1 : 0));
  return scored.slice(0, k).map((s) => s.c);
}

export function typeList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1];
}
