/**
 * The phrase table for undefined reasons (docs/features/errors/errors.md section 3). One source for the object list,
 * the screen reader and the teacher's speech. Areas append their reasons with `registerReasonPhrase`.
 */
import type { UndefReason } from '../contracts/values';

export interface ReasonPhrase {
  /** A noun form: "parallel lines". */
  readonly noun: string;
  /** A sentence for speech: "These lines are parallel, so they never meet." */
  readonly sentence: string;
}

const PHRASES: Record<string, ReasonPhrase> = {
  parallel: { noun: 'parallel lines', sentence: 'These lines are parallel, so they never meet.' },
  coincident: { noun: 'the same line', sentence: 'These are the same line, so there is no single crossing.' },
  no_intersection: { noun: 'no crossing', sentence: "They don't touch each other." },
  out_of_domain: { noun: 'outside the allowed values', sentence: "That input isn't allowed there, for example the square root of a negative number." },
  division_by_zero: { noun: 'division by zero', sentence: 'That divides by zero.' },
  no_root: { noun: 'no zero in range', sentence: "The graph doesn't cross zero in this range." },
  not_finite: { noun: 'not a number', sentence: "That value can't be worked out." },
  overflow: { noun: 'too large', sentence: 'That number is too big to show.' },
  degenerate: { noun: 'degenerate shape', sentence: 'The points line up (or coincide), so there is no shape.' },
  index_out_of_range: { noun: 'no such item', sentence: 'There is no item at that position.' },
  empty_list: { noun: 'empty list', sentence: 'The list has nothing in it.' },
  no_convergence: { noun: 'no result found', sentence: "The search didn't settle on an answer." },
  timeout: { noun: 'too slow', sentence: 'That took too long to work out.' },
  input_undefined: { noun: 'depends on an undefined object', sentence: 'It depends on something that is undefined.' },
  not_set: { noun: 'not set', sentence: 'This has no value yet.' },
  limit: { noun: 'too big', sentence: 'That would be too large.' },
  condition_false: { noun: 'no condition holds', sentence: 'None of the conditions holds, so there is no value.' },
  explicit: { noun: 'set to undefined', sentence: 'This was set to undefined on purpose.' },
  not_integer: { noun: 'not a whole number', sentence: 'That needs a whole number.' },
  no_value_yet: { noun: 'no value yet', sentence: 'The value is not known yet.' },
};

/** Adds or replaces the phrase of a reason an area registered. */
export function registerReasonPhrase(reason: string, phrase: ReasonPhrase): void {
  if (reason === '__proto__') return;
  PHRASES[reason] = phrase;
}

/** The phrases of a reason. An unknown reason gets its own code as a noun. */
export function reasonPhrase(reason: UndefReason | string): ReasonPhrase {
  return (typeof reason === 'string' && Object.hasOwn(PHRASES, reason) ? PHRASES[reason] : undefined) ?? { noun: String(reason).replace(/_/g, ' '), sentence: `It is undefined (${String(reason).replace(/_/g, ' ')}).` };
}

/** Every reason with a phrase, for the registry test. */
export function phraseReasons(): readonly string[] {
  return Object.keys(PHRASES);
}
