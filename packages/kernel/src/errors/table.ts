/**
 * The registry of error kinds and the one constructor for the unified error object
 * (docs/features/errors/design.md sections 3 to 5, docs/features/errors/errors.md).
 *
 * Every kind has an entry: code, phase, default recovery, message key and template. Call sites state only what is
 * specific (the span, the params, `forms`, `expected`, `suggest`). Nothing here throws: a failure while building an
 * error returns the hard-coded `internal` object of errors.md section 6.
 */
import type { ErrorKind, ErrorObject, Params, Phase, Recovery, Span } from '../contracts/errors';
import { ERROR_KINDS, MESSAGE_TEMPLATES, buildError, messageKeyFor, render } from '../language/errors';
import type { ErrorExtra } from '../language/errors';

export interface ErrorSpec {
  readonly kind: ErrorKind;
  /** Stable machine code: area letter and three digits. Never changes once released. */
  readonly code: string;
  readonly phase: Phase;
  readonly recovery: Recovery;
  /** The identity of the sentence; the English template lives in `MESSAGE_TEMPLATES`. */
  readonly messageKey: string;
  /** The params the template may use. */
  readonly params: readonly string[];
  /** True when the kind may carry `forms`. */
  readonly forms: boolean;
  readonly description: string;
}

interface Meta {
  readonly key: string;
  readonly params: readonly string[];
  readonly forms?: boolean;
  readonly description: string;
}

const META: Record<ErrorKind, Meta> = {
  syntax: { key: 'lang.syntax', params: ['token', 'expected'], forms: true, description: 'The parser stopped at a token that cannot continue the line.' },
  unbalanced: { key: 'lang.unbalanced_open', params: ['open', 'col'], description: 'A bracket was opened and never closed, or closed and never opened.' },
  bad_number: { key: 'lang.bad_number', params: ['token', 'why'], description: 'A number written in a form the language does not accept.' },
  unterminated_string: { key: 'lang.unterminated_string', params: ['col'], description: 'A text has no closing quote.' },
  bad_character: { key: 'lang.bad_character', params: ['token', 'cp'], description: 'A character the language never uses.' },
  unknown_directive: { key: 'lang.unknown_directive', params: ['token'], description: 'An @word that is not a directive.' },
  bad_directive: { key: 'lang.bad_directive', params: ['directive', 'need'], forms: true, description: 'A directive with the wrong arguments.' },
  unknown_name: { key: 'lang.unknown_name', params: ['name'], description: 'A name that does not exist.' },
  unknown_command: { key: 'lang.unknown_command', params: ['name'], description: 'A capitalised word that is not a command.' },
  unknown_property: { key: 'lang.unknown_property', params: ['type', 'key'], description: 'A `with` key the object type does not have.' },
  reserved_name: { key: 'lang.reserved_name', params: ['name', 'group'], description: 'A command, function, constant or keyword used as an object name.' },
  bad_name: { key: 'lang.bad_name', params: ['name', 'why'], description: 'A name with invalid characters, a leading digit, or a bad length.' },
  name_taken: { key: 'lang.name_taken', params: ['name', 'type'], description: 'A rename to a name another object holds.' },
  unnamed_object: { key: 'lang.unnamed_object', params: ['line'], description: 'An object command written without a name.' },
  duplicate_param: { key: 'lang.duplicate_param', params: ['name'], description: 'A parameter or result name that appears twice.' },
  not_callable: { key: 'lang.not_callable', params: ['name', 'type'], description: 'A call of a name that is not a function or command.' },
  no_matching_form: { key: 'lang.no_matching_form', params: ['command', 'given'], forms: true, description: 'The arguments fit no form of the command.' },
  arg_count: { key: 'lang.arg_count', params: ['name', 'n', 'm'], forms: true, description: 'A function or single-form command called with the wrong number of arguments.' },
  type_mismatch: { key: 'lang.type_mismatch', params: ['op', 'left', 'right'], description: 'An operator applied to types it does not accept.' },
  type_change: { key: 'lang.type_change', params: ['name', 'from', 'to'], description: 'A redefinition that would change the type of an object.' },
  bad_property_value: { key: 'lang.bad_property_value', params: ['key', 'allowed', 'token'], description: 'A property value of the wrong type or outside its range.' },
  bad_range: { key: 'lang.bad_range', params: ['why'], description: 'A slider range that is empty or has a bad step.' },
  bad_argument: { key: 'lang.bad_argument', params: ['command', 'why'], description: 'A well-typed argument with a value known to be impossible at plan time.' },
  cycle: { key: 'lang.cycle', params: ['name', 'path'], description: 'A redefinition that would make an object depend on itself.' },
  forward_reference: { key: 'kernel.forward_reference', params: ['name', 'input'], description: 'An insert or move that places an object before one of its inputs.' },
  locked: { key: 'kernel.locked', params: ['name'], description: 'A change, delete or drag of a fixed object.' },
  not_free: { key: 'kernel.not_free', params: ['name', 'inputs'], description: 'A value set on a dependent object.' },
  missing_rate: { key: 'lang.missing_rate', params: ['name'], description: 'A state with no rate rule.' },
  nothing_to_undo: { key: 'kernel.nothing_to_undo', params: ['what'], description: 'Undo or Redo with an empty history.' },
  limit: { key: 'lang.limit', params: ['max', 'what'], description: 'A size budget exceeded.' },
  load_failed: { key: 'kernel.load_failed', params: ['n'], description: 'A strict load found a failing line, or the file is unreadable.' },
  version: { key: 'kernel.version', params: ['v', 'list'], description: 'A file newer than the loader supports.' },
  tool_input: { key: 'tool.input', params: ['tool', 'expected'], forms: true, description: 'A tool called with a malformed or empty request.' },
  tool_busy: { key: 'tool.busy', params: [], description: 'A tool call that arrived while the previous one still runs on the same figure.' },
  internal: { key: 'lang.internal', params: ['where'], description: 'A bug: an exception inside a rule, tool or listener.' },
  bad_escape: { key: 'lang.bad_escape', params: ['ch'], description: 'An escape the text syntax does not have.' },
  bad_format: { key: 'lang.bad_format', params: ['fmt'], description: 'A text format the language does not have.' },
  missing_operator: { key: 'lang.missing_operator', params: [], description: 'Two values that touch with no operator between them.' },
  ambiguous_implicit: { key: 'lang.ambiguous_implicit', params: ['text', 'a', 'b'], description: 'An implicit product that can be read two ways.' },
  chained_comparison: { key: 'lang.chained_comparison', params: ['why'], description: 'A chain of comparisons that mixes directions.' },
  assign_in_expr: { key: 'lang.assign_in_expr', params: ['why'], description: 'An assignment inside an expression.' },
  unknown_function: { key: 'lang.unknown_function', params: ['name'], description: 'A lower-case name called as a function that does not exist.' },
  free_variable: { key: 'lang.free_variable', params: ['name', 'owner', 'type'], description: 'x or y used where no function or equation binds it.' },
  breaks_dependents: { key: 'lang.breaks_dependents', params: ['name', 'n'], description: 'A redefinition that would break objects that read the object.' },
  empty_list_type: { key: 'lang.empty_list_type', params: [], description: 'An empty list whose element type nothing fixes.' },
  duplicate_arg: { key: 'lang.duplicate_arg', params: ['name'], description: 'A named argument given twice.' },
  not_a_binder: { key: 'lang.not_a_binder', params: [], description: 'An expression where a bare binder name is required.' },
  not_a_path: { key: 'lang.not_a_path', params: ['command', 'why'], description: 'A value that is not a path where a command needs one.' },
  not_a_region: { key: 'lang.not_a_region', params: ['command', 'why'], description: 'A value that is not a region where a command needs one.' },
  too_few_points: { key: 'lang.too_few_points', params: ['command', 'why'], description: 'A shape written with fewer points than it needs.' },
  not_supported: { key: 'lang.not_supported', params: ['command', 'why'], description: 'A combination of arguments the command has no result for.' },
  not_a_transform: { key: 'lang.not_a_transform', params: ['command', 'why'], description: 'A value that is not a transform where a command needs one.' },
  not_quadratic: { key: 'lang.not_quadratic', params: ['command', 'why'], description: 'An equation of degree above 2 where a conic is needed.' },
  not_polynomial: { key: 'lang.not_polynomial', params: ['command', 'why'], description: 'An equation that is not a polynomial in x and y where a conic is needed.' },
  bad_equation: { key: 'lang.bad_equation', params: ['command', 'why'], description: 'An expression with no == where an equation is needed.' },
  no_dependency: { key: 'lang.no_dependency', params: ['command', 'why'], description: 'A locus whose traced point does not depend on the mover.' },
  needs_interval: { key: 'lang.needs_interval', params: ['command', 'why'], description: 'A command that needs an interval unless its function is a polynomial.' },
  not_differentiable: { key: 'lang.not_differentiable', params: ['command', 'why'], description: 'A function whose body has no derivative rule.' },
  missing_range: { key: 'lang.missing_range', params: ['command', 'why'], description: 'A parametric curve written without a finite range.' },
};

function buildTable(): Record<ErrorKind, ErrorSpec> {
  const out = {} as Record<ErrorKind, ErrorSpec>;
  for (const kind of Object.keys(META) as ErrorKind[]) {
    const m = META[kind];
    const base = ERROR_KINDS[kind];
    out[kind] = {
      kind,
      code: base?.code ?? 'K999',
      // bracket counting happens while lexing (errors.md 2 and example 5.2)
      phase: kind === 'unbalanced' ? 'lex' : (base?.phase ?? 'commit'),
      recovery: base?.recovery ?? 'skip',
      messageKey: messageKeyFor(kind, m.key),
      params: m.params,
      forms: m.forms === true,
      description: m.description,
    };
  }
  return out;
}

/** One entry per error kind. */
export const errorTable: Readonly<Record<ErrorKind, ErrorSpec>> = Object.freeze(buildTable());

/** The names a template uses. */
export function placeholdersOf(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(/\{(\w+)\}/g)) out.push(m[1] as string);
  return out;
}

export interface TableProblem {
  readonly kind: string;
  readonly message: string;
}

/**
 * The registry self-test (errors/design.md section 5): every kind has a code, no two kinds share one, every message key
 * has a template, and no template uses a param its kind does not declare.
 */
export function checkErrorTable(): TableProblem[] {
  const problems: TableProblem[] = [];
  const codes = new Map<string, string>();
  for (const spec of Object.values(errorTable)) {
    if (!/^[A-Z]\d{3}$/.test(spec.code) || (ERROR_KINDS[spec.kind] === undefined)) problems.push({ kind: spec.kind, message: `${spec.kind} has no valid code.` });
    const other = codes.get(spec.code);
    if (other !== undefined) problems.push({ kind: spec.kind, message: `${spec.kind} and ${other} share the code ${spec.code}.` });
    codes.set(spec.code, spec.kind);
    const tpl = MESSAGE_TEMPLATES[spec.messageKey];
    if (tpl === undefined) {
      problems.push({ kind: spec.kind, message: `${spec.kind}: the message key ${spec.messageKey} has no template.` });
      continue;
    }
    for (const p of placeholdersOf(tpl)) {
      if (!spec.params.includes(p)) problems.push({ kind: spec.kind, message: `${spec.kind}: the template uses {${p}}, which the kind does not declare.` });
    }
  }
  return problems;
}

/** What a call site may add to an error. */
export interface ErrArgs {
  /** The offending text. */
  readonly token?: string;
  /** The full line, when short. */
  readonly source?: string;
  readonly expected?: readonly string[];
  readonly forms?: readonly string[];
  readonly hint?: string;
  readonly suggest?: readonly string[];
  readonly recovery?: Recovery;
  readonly related?: readonly string[];
  readonly path?: readonly string[];
  readonly blockedBy?: { readonly line: number; readonly kind: ErrorKind };
  readonly cause?: ErrorObject;
  /** The stable part of the fingerprint after the kind. Defaults to the token. */
  readonly fingerprintKey?: string;
  /** Use another message key than the kind's own. */
  readonly messageKey?: string;
}

/**
 * Builds the error object of `kind` at `at`. `code`, `phase`, `message`, `messageKey`, `recovery` and `fingerprint` come
 * from the registry. Never throws.
 */
export function err(kind: ErrorKind, at: Span, params: Params = {}, extra: ErrArgs = {}): ErrorObject {
  try {
    const spec = Object.hasOwn(errorTable, kind) ? errorTable[kind] : errorTable.internal;
    params = clipParams(params);
    extra = clipExtra(extra);
    const e: ErrorExtra = {
      ...(extra.expected ? { expected: extra.expected } : {}),
      ...(extra.forms ? { forms: extra.forms } : {}),
      ...(extra.hint !== undefined ? { hint: extra.hint } : {}),
      ...(extra.suggest ? { suggest: extra.suggest } : {}),
      ...(extra.recovery ? { recovery: extra.recovery } : {}),
      ...(extra.related ? { related: extra.related } : {}),
      ...(extra.path ? { path: extra.path } : {}),
      ...(extra.blockedBy ? { blockedBy: extra.blockedBy } : {}),
      ...(extra.cause ? { cause: extra.cause } : {}),
      uncapped: true,
      phase: spec.phase,
      ...(extra.fingerprintKey !== undefined ? { fingerprintKey: extra.fingerprintKey } : {}),
    };
    const key = extra.messageKey ?? spec.messageKey;
    return buildError(kind, key, params, at.line, at.col, at.endCol, extra.token ?? '', extra.source, e);
  } catch {
    return fallbackInternal(at.line);
  }
}

/** The longest caller text an error repeats in its params, token, key or related names (KERN-SM-2). */
export const ERROR_TEXT_MAX = 100;
/** The longest hint an error carries. */
export const ERROR_HINT_MAX = 300;

/** Cuts `s` to `max` characters, ending in an ellipsis when something was cut. */
export function clipText(s: string, max = ERROR_TEXT_MAX): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)) + '\u2026';
}

function clipParams(params: Params): Params {
  const out: Record<string, string | number | boolean | readonly string[]> = {};
  for (const k of Object.keys(params)) {
    const v = params[k] as string | number | boolean | readonly string[];
    out[k] = typeof v === 'string' ? clipText(v) : Array.isArray(v) ? (v as readonly string[]).map((x) => (typeof x === 'string' ? clipText(x) : x)) : v;
  }
  return out;
}

function clipExtra(extra: ErrArgs): ErrArgs {
  const out: { -readonly [K in keyof ErrArgs]: ErrArgs[K] } = { ...extra };
  if (typeof out.token === 'string') out.token = clipText(out.token);
  if (typeof out.fingerprintKey === 'string') out.fingerprintKey = clipText(out.fingerprintKey);
  if (typeof out.hint === 'string') out.hint = clipText(out.hint, ERROR_HINT_MAX);
  if (out.related) out.related = out.related.map((x) => clipText(x));
  return out;
}

/** The error that stands in when building an error fails. */
export function fallbackInternal(line = 0): ErrorObject {
  return {
    ok: false,
    committed: false,
    kind: 'internal',
    code: 'K999',
    phase: 'commit',
    message: 'Something went wrong.',
    messageKey: 'kernel.internal',
    params: {},
    line,
    col: 1,
    endCol: 1,
    token: '',
    expected: [],
    forms: [],
    suggest: [],
    recovery: 'report',
    fingerprint: 'internal:error-build',
    severity: 'error',
  };
}

/** An `internal` error for a fault inside `where` (a rule, a listener, a command). Nothing was changed. */
export function internalError(where: string, at: Span, token = '', fingerprintKey = where, source?: string): ErrorObject {
  return err('internal', at, { where }, { token, fingerprintKey: `${where}:${fingerprintKey}`, recovery: 'skip', hint: 'Try a simpler form of this line, or skip it.', ...(source !== undefined ? { source } : {}) });
}

/** The sentence of a key and params, for callers that format their own text. */
export function renderMessage(key: string, params: Params): string {
  return render(key, params);
}

/** True for the failing half of a `Result`. */
export function isErrorObject(x: unknown): x is ErrorObject {
  return typeof x === 'object' && x !== null && (x as { ok?: unknown }).ok === false && typeof (x as { kind?: unknown }).kind === 'string';
}
