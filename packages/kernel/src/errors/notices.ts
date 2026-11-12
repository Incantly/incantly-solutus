/**
 * Notices: successes that carry a fact the caller should know (docs/features/errors/errors.md section 4,
 * docs/features/kernel/errors.md section 3). They never block and are never confused with errors.
 */
import type { Notice, NoticeKind, Params } from '../contracts/errors';
import type { UndefReason } from '../contracts/values';
import { reasonPhrase } from './phrases';

interface NoticeSpec {
  readonly code: string;
  readonly severity: 'info' | 'warning';
  readonly template: string;
}

export const NOTICE_TABLE: Readonly<Record<string, NoticeSpec>> = Object.freeze({
  became_undefined: { code: 'K101', severity: 'warning', template: '{names} became undefined: {phrase}.' },
  became_defined: { code: 'K102', severity: 'info', template: '{names} are defined again.' },
  dependents_removed: { code: 'K103', severity: 'warning', template: 'Also removed: {names}.' },
  moved_for_order: { code: 'K104', severity: 'info', template: 'Moved {names} earlier.' },
  property_detached: { code: 'K105', severity: 'warning', template: "{name}'s {prop} followed {input}; it now uses the plain {prop}." },
  confusable_name: { code: 'K106', severity: 'warning', template: '{name} differs from {other} only by case.' },
  redefined_to_same: { code: 'K107', severity: 'info', template: '{name} was already defined that way.' },
  listener_failed: { code: 'K108', severity: 'warning', template: 'A view failed to update; the figure is fine.' },
  step_hidden: { code: 'K109', severity: 'info', template: '{name} is added after the step you are viewing.' },
  clamped: { code: 'K110', severity: 'info', template: '{name} was moved to {value}, the {end} of its range.' },
  shadowed_default: { code: 'K111', severity: 'info', template: '{name}: {key} is already {value}.' },
  unstable_state: { code: 'K112', severity: 'warning', template: 'The state {names} became unstable at t = {t}.' },
  // animation-time
  seek_clamped: { code: 'A101', severity: 'info', template: 'The time {asked} is outside the film; the player went to {used}.' },
  behind_audio: { code: 'A102', severity: 'warning', template: 'The figure fell {lag} s behind the voice.' },
  log_rewrite: { code: 'A103', severity: 'info', template: 'Entries after t = {from} s for {name} were replaced ({count}).' },
  trace_decimated: { code: 'A104', severity: 'info', template: 'The trace of {name} passed {points} points; older parts are coarser now.' },
  gpu_unsupported: { code: 'A105', severity: 'info', template: '{name} is drawn on the CPU: {reason}.' },
});

const AREA_NOTICES = new Map<string, NoticeSpec>();

/**
 * An area adds a notice of its own (README decision 4). The code must be new and look like `K1xx` or `A` followed by digits;
 * the same kind with the same spec again is accepted. Returns false when the kind or code is taken or the spec is malformed.
 */
export function registerNotice(kind: string, spec: { code: string; severity: 'info' | 'warning'; template: string }): boolean {
  if (typeof kind !== 'string' || kind === '' || typeof spec !== 'object' || spec === null) return false;
  if (typeof spec.code !== 'string' || !/^(K1\d\d|[A-Z]\d{3})$/.test(spec.code) || typeof spec.template !== 'string') return false;
  if (spec.severity !== 'info' && spec.severity !== 'warning') return false;
  if (Object.hasOwn(NOTICE_TABLE, kind)) return false;
  const old = AREA_NOTICES.get(kind);
  if (old) return old.code === spec.code && old.severity === spec.severity && old.template === spec.template;
  const codes = new Set([...Object.values(NOTICE_TABLE), ...AREA_NOTICES.values()].map((x) => x.code));
  if (codes.has(spec.code)) return false;
  AREA_NOTICES.set(kind, { code: spec.code, severity: spec.severity, template: spec.template });
  return true;
}

function fill(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const v = params[k];
    if (v === undefined) return `{${k}}`;
    return Array.isArray(v) ? joinNames(v as readonly string[]) : String(v);
  });
}

/** `A`, `A and B`, `A, B and C`. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/** Builds a notice of a registered kind. An unregistered kind gets code K100 and the kind as its message. */
export function makeNotice(kind: NoticeKind, params: Params = {}, names?: readonly string[]): Notice {
  const spec = typeof kind === 'string' ? (Object.hasOwn(NOTICE_TABLE, kind) ? NOTICE_TABLE[kind] : AREA_NOTICES.get(kind)) : undefined;
  const message = spec ? fill(spec.template, names ? { ...params, names } : params) : String(kind);
  const out: Record<string, unknown> = {
    severity: spec?.severity ?? 'info',
    code: spec?.code ?? 'K100',
    kind,
    message,
    params,
  };
  if (names !== undefined) out['names'] = names;
  return out as unknown as Notice;
}

/** `became_undefined` for objects that share one reason. */
export function becameUndefinedNotice(names: readonly string[], reason: UndefReason): Notice {
  return makeNotice('became_undefined', { phrase: reasonPhrase(reason).noun, reason }, names);
}
