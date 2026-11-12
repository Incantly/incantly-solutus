/**
 * Numbers area errors, notices and undefined-reason phrases
 * (numbers-sliders/errors.md, controls-scripting/errors.md).
 *
 * The kernel's error registry has no runtime hook for area kinds, so this module keeps
 * the area's own kind-to-code table and message templates (appended to the language's
 * MESSAGE_TEMPLATES, which areas may extend), builds through the kernel's err(), and
 * then stamps the area code, phase and message on the result. The shape stays the
 * kernel's; only the kind-specific fields are ours.
 */

import type { ErrorKind, ErrorObject, Params, Phase, Recovery, Span } from '../../contracts/errors';
import { err } from '../../errors/table';
import { makeNotice, registerNotice } from '../../errors/notices';
import type { Notice } from '../../contracts/errors';
import { MESSAGE_TEMPLATES } from '../../language/errors';
import { registerReasonPhrase } from '../../errors/phrases';

/* ------------------------------ kinds and codes ------------------------------ */

interface KindMeta {
  readonly code: string;
  readonly phase: Phase;
  readonly recovery: Recovery;
  readonly key: string;
}

const KIND_META: Readonly<Record<string, KindMeta>> = {
  unit_mismatch: { code: 'N101', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.unit_mismatch' },
  not_animatable: { code: 'N102', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.not_animatable' },
  animated_input: { code: 'N103', phase: 'plan', recovery: 'rewrite', key: 'numbers.animated_input' },
  bad_event: { code: 'N104', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.bad_event' },
  unknown_event: { code: 'N105', phase: 'parse', recovery: 'use_suggestion', key: 'numbers.unknown_event' },
  handler_define: { code: 'N106', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.handler_define' },
  handler_structure: { code: 'N107', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.handler_structure' },
  handler_graph_change: { code: 'N108', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.handler_graph_change' },
  handler_cycle: { code: 'N109', phase: 'plan', recovery: 'rewrite', key: 'numbers.handler_cycle' },
  handler_limit: { code: 'N110', phase: 'plan', recovery: 'rewrite', key: 'numbers.handler_limit' },
  bad_step_index: { code: 'N111', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.bad_step_index' },
  bad_input_target: { code: 'N112', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.bad_input_target' },
  bad_choice: { code: 'N113', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.bad_choice' },
  bad_index: { code: 'N114', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.bad_index' },
  input_command: { code: 'N115', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.input_command' },
  input_not_expression: { code: 'N116', phase: 'parse', recovery: 'fix_line', key: 'numbers.input_not_expression' },
  input_too_long: { code: 'N117', phase: 'parse', recovery: 'rewrite', key: 'numbers.input_too_long' },
  input_too_deep: { code: 'N118', phase: 'parse', recovery: 'rewrite', key: 'numbers.input_too_deep' },
  input_value_undefined: { code: 'N119', phase: 'typecheck', recovery: 'fix_line', key: 'numbers.input_value_undefined' },
};

const TEMPLATES: Readonly<Record<string, string>> = {
  'numbers.unit_mismatch': '{name} is an angle in {unit}, but the bounds {bounds} have no unit.',
  'numbers.not_animatable': '{name} cannot animate: {why}.',
  'numbers.animated_input': 'The rate of {rate} reads {slider}, which is animating. Every frame would restart the motion.',
  'numbers.bad_event': '{name} is {what}; it has no {event} event.',
  'numbers.unknown_event': '{event} is not an event.',
  'numbers.handler_define': 'A handler step cannot define {name}. It can set a value.',
  'numbers.handler_structure': 'A handler cannot {what}. It can change values and appearance.',
  'numbers.handler_graph_change': '{property} is a rule, and handlers cannot add rules.',
  'numbers.handler_cycle': '{names} would press itself: {cycle}.',
  'numbers.handler_limit': 'The handler on {name} needed more than {limit} {what}; nothing was changed.',
  'numbers.bad_step_index': 'Step {index} does not exist; the handler has {steps} steps.',
  'numbers.bad_input_target': '{name} cannot be linked to an input box: {why}.',
  'numbers.bad_choice': 'The choice has no usable options: {why}.',
  'numbers.bad_index': 'The choice has {count} options; {index} is out of range.',
  'numbers.input_command': 'Commands are not allowed in an input box. Type a number or a formula.',
  'numbers.input_not_expression': 'Type a value, not a statement.',
  'numbers.input_too_long': 'The text has {got} characters; the limit is {max}.',
  'numbers.input_too_deep': 'The text nests {got} levels deep; the limit is {max}.',
  'numbers.input_value_undefined': 'The text is undefined ({reason}).',
};

export interface NumbersErrArgs {
  readonly token?: string;
  readonly source?: string;
  readonly expected?: readonly string[];
  readonly forms?: readonly string[];
  readonly hint?: string;
  readonly suggest?: readonly string[];
  readonly related?: readonly string[];
  readonly path?: readonly string[];
  readonly fingerprintKey?: string;
}

function fill(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = params[k];
    if (v === undefined) return `{${k}}`;
    return Array.isArray(v) ? v.join(', ') : String(v);
  });
}

/**
 * Builds an error object of an area kind. Core kinds (syntax, unknown_name,
 * type_mismatch, bad_range, not_free, limit, bad_argument, ...) go through the
 * kernel's err() untouched; only the kinds in KIND_META are stamped here.
 */
export function numbersError(kind: string, at: Span, params: Params = {}, extra: NumbersErrArgs = {}): ErrorObject {
  const meta = Object.hasOwn(KIND_META, kind) ? KIND_META[kind] : undefined;
  if (!meta) return err(kind as ErrorKind, at, params, extra);
  const base = err('internal', at, {}, {});
  void base;
  const built = err('internal', at, params, {
    ...(extra.token !== undefined ? { token: extra.token } : {}),
    ...(extra.source !== undefined ? { source: extra.source } : {}),
    ...(extra.expected ? { expected: extra.expected } : {}),
    ...(extra.forms ? { forms: extra.forms } : {}),
    ...(extra.hint !== undefined ? { hint: extra.hint } : {}),
    ...(extra.suggest ? { suggest: extra.suggest } : {}),
    ...(extra.related ? { related: extra.related } : {}),
    ...(extra.path ? { path: extra.path } : {}),
    ...(extra.fingerprintKey !== undefined ? { fingerprintKey: extra.fingerprintKey } : { fingerprintKey: extra.token ?? kind }),
  });
  const template = TEMPLATES[meta.key] ?? meta.key;
  return {
    ...built,
    kind: kind as ErrorKind,
    code: meta.code,
    phase: meta.phase,
    message: fill(template, params),
    messageKey: meta.key,
    params,
    recovery: meta.recovery,
    fingerprint: `${kind}:${extra.fingerprintKey ?? extra.token ?? kind}`,
  };
}

/* ------------------------------ notices ------------------------------ */

const NOTICE_SPECS: Readonly<Record<string, { code: string; severity: 'info' | 'warning'; template: string }>> = {
  snapped: { code: 'N120', severity: 'info', template: '{name} was moved to {value}, the nearest step.' },
  range_kept: { code: 'N121', severity: 'info', template: '{name} kept its range {range}.' },
  unit_inferred: { code: 'N122', severity: 'info', template: '{name} is an angle in {unit}.' },
  step_fallback: { code: 'N123', severity: 'info', template: '{name} uses an automatic step while its step is undefined.' },
  step_below_precision: { code: 'N124', severity: 'warning', template: '{name} was clamped but not snapped: the step is below precision.' },
  handler_steps_broken: { code: 'N125', severity: 'warning', template: 'The handler on {target} {event} named {name}; steps {steps} are now broken.' },
};

/** Builds a notice of an area kind (falls back to the kernel's table for core kinds). */
export function numbersNotice(kind: string, params: Params = {}, names?: readonly string[]): Notice {
  return makeNotice(kind as Parameters<typeof makeNotice>[0], params, names);
}

/* ------------------------------ registration ------------------------------ */

let registered = false;

/** Appends the area's templates, notices and reason phrases to the kernel tables. Idempotent. */
export function registerNumbersErrors(): void {
  if (registered) return;
  registered = true;
  for (const [key, template] of Object.entries(TEMPLATES)) {
    if (!Object.hasOwn(MESSAGE_TEMPLATES, key)) MESSAGE_TEMPLATES[key] = template;
  }
  for (const [kind, spec] of Object.entries(NOTICE_SPECS)) registerNotice(kind, spec);
  registerReasonPhrase('range_undefined', {
    noun: 'undefined range',
    sentence: 'Its slider range is undefined, so it has no value.',
  });
  registerReasonPhrase('empty_range', {
    noun: 'empty range',
    sentence: 'Its slider range is empty: the minimum is not below the maximum.',
  });
  registerReasonPhrase('empty_choice', {
    noun: 'no options',
    sentence: 'The choice has no options.',
  });
  registerReasonPhrase('input_invalid', {
    noun: 'invalid input',
    sentence: 'The text in the input box is not valid.',
  });
  registerReasonPhrase('target_not_free', {
    noun: 'target not free',
    sentence: 'The input box target is computed, so the box is disabled.',
  });
}
