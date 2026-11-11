/**
 * Notices (successes that carry facts) and the plain-language phrase table for undefined reasons.
 * Docs: errors/errors.md 3 and 4; errors/design.md 3.1 and 3.2; kernel/errors.md 2 and 3; README decisions 2 and 4.
 */
import { describe, expect, it } from 'vitest';
import { NOTICE_TABLE, becameUndefinedNotice, joinNames, makeNotice, phraseReasons, reasonPhrase, registerReasonPhrase } from '@incantly/kernel';
import type { NoticeKind } from '@incantly/kernel';

describe('notices (errors.md 4)', () => {
  // kind -> [code, severity]
  const TABLE: [NoticeKind, string, 'info' | 'warning'][] = [
    ['became_undefined', 'K101', 'warning'],
    ['became_defined', 'K102', 'info'],
    ['dependents_removed', 'K103', 'warning'],
    ['moved_for_order', 'K104', 'info'],
    ['property_detached', 'K105', 'warning'],
    ['confusable_name', 'K106', 'warning'],
    ['redefined_to_same', 'K107', 'info'],
    ['listener_failed', 'K108', 'warning'],
    ['step_hidden', 'K109', 'info'],
  ];

  it.each(TABLE)('%s has code %s', (kind, code) => {
    expect(NOTICE_TABLE[kind]?.code).toBe(code);
  });

  it.each(TABLE)('%s builds a notice with that code, kind and a severity of info or warning', (kind, code) => {
    const n = makeNotice(kind, { names: 'A', name: 'A', other: 'a', phrase: 'parallel lines', prop: 'color', input: 'a', where: 'view' }, ['A']);
    expect(n.code).toBe(code);
    expect(n.kind).toBe(kind);
    expect(['info', 'warning']).toContain(n.severity);
    expect(n.message.length).toBeGreaterThan(0);
    expect(n.message).not.toContain('{');
    expect(n.names).toEqual(['A']);
  });

  it('severity of the ones the docs call warnings: they report the figure changed under the caller', () => {
    expect(makeNotice('became_undefined', { names: 'I', phrase: 'x' }).severity).toBe('warning');
    expect(makeNotice('dependents_removed', { names: 'N' }).severity).toBe('warning');
    expect(makeNotice('property_detached', { name: 'P', prop: 'color', input: 'a' }).severity).toBe('warning');
  });

  it('codes are unique', () => {
    const codes = Object.values(NOTICE_TABLE).map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('message templates', () => {
    expect(makeNotice('dependents_removed', { names: 'N and G' }, ['N', 'G']).message).toBe('Also removed: N and G.');
    expect(makeNotice('moved_for_order', { names: 'R' }, ['R']).message).toBe('Moved R earlier.');
    expect(makeNotice('confusable_name', { name: 'b', other: 'B' }).message).toBe('b differs from B only by case.');
    expect(makeNotice('redefined_to_same', { name: 'M' }).message).toBe('M was already defined that way.');
    expect(makeNotice('listener_failed', { where: 'view' }).message).toBe('A view failed to update; the figure is fine.');
    expect(makeNotice('step_hidden', { name: 'P' }).message).toBe('P is added after the step you are viewing.');
    expect(makeNotice('property_detached', { name: 'P', prop: 'color', input: 'a' }).message).toBe("P's color followed a; it now uses the plain color.");
    expect(makeNotice('became_defined', { names: 'I' }, ['I']).message).toBe('I are defined again.');
  });

  it('an unregistered kind gets code K100 and never throws', () => {
    const n = makeNotice('totally_new_kind' as NoticeKind);
    expect(n.code).toBe('K100');
    expect(n.kind).toBe('totally_new_kind');
    expect(n.message.length).toBeGreaterThan(0);
  });

  it('becameUndefinedNotice joins the names and uses the noun phrase of the reason', () => {
    const n = becameUndefinedNotice(['I'], 'parallel');
    expect(n.kind).toBe('became_undefined');
    expect(n.message).toBe('I became undefined: parallel lines.');
    expect(n.names).toEqual(['I']);
    expect(becameUndefinedNotice(['I', 'T', 'U'], 'parallel').message).toBe('I, T and U became undefined: parallel lines.');
  });

  it('joinNames: A / A and B / A, B and C', () => {
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinNames([])).toBe('');
  });

  it('a notice is plain JSON data', () => {
    const n = makeNotice('became_undefined', { names: 'I', phrase: 'parallel lines' }, ['I']);
    expect(JSON.parse(JSON.stringify(n))).toEqual(n);
  });
});

describe('the phrase table for undefined reasons (errors.md 3)', () => {
  const PHRASES: [string, string, string][] = [
    ['parallel', 'parallel lines', 'These lines are parallel, so they never meet.'],
    ['coincident', 'the same line', 'These are the same line, so there is no single crossing.'],
    ['no_intersection', 'no crossing', "They don't touch each other."],
    ['out_of_domain', 'outside the allowed values', "That input isn't allowed there, for example the square root of a negative number."],
    ['division_by_zero', 'division by zero', 'That divides by zero.'],
    ['no_root', 'no zero in range', "The graph doesn't cross zero in this range."],
    ['not_finite', 'not a number', "That value can't be worked out."],
    ['overflow', 'too large', 'That number is too big to show.'],
    ['degenerate', 'degenerate shape', 'The points line up (or coincide), so there is no shape.'],
    ['index_out_of_range', 'no such item', 'There is no item at that position.'],
    ['empty_list', 'empty list', 'The list has nothing in it.'],
    ['no_convergence', 'no result found', "The search didn't settle on an answer."],
    ['timeout', 'too slow', 'That took too long to work out.'],
    ['not_set', 'not set', 'This has no value yet.'],
    ['limit', 'too big', 'That would be too large.'],
  ];

  it.each(PHRASES)('%s: noun and sentence match the table', (reason, noun, sentence) => {
    const p = reasonPhrase(reason);
    expect(p.noun).toBe(noun);
    expect(p.sentence).toBe(sentence);
  });

  it('input_undefined says the object depends on something that is undefined', () => {
    // The table fills {cause} and the root phrase in at the call site; the flat phrase must at least say this much.
    const p = reasonPhrase('input_undefined');
    expect(p.noun).toContain('depends on');
    expect(p.noun.toLowerCase()).toContain('undefined');
    expect(p.sentence.toLowerCase()).toContain('depends on');
  });

  it('every reason of the kernel registry has a phrase', () => {
    const reasons = [
      'parallel', 'coincident', 'no_intersection', 'out_of_domain', 'division_by_zero', 'no_root', 'not_finite', 'overflow',
      'degenerate', 'index_out_of_range', 'empty_list', 'no_convergence', 'timeout', 'input_undefined', 'not_set', 'limit',
    ];
    const known = phraseReasons();
    for (const r of reasons) expect(known, r).toContain(r);
  });

  it('every sentence is a sentence: it ends with a full stop and starts with a capital', () => {
    for (const r of phraseReasons()) {
      const p = reasonPhrase(r);
      expect(p.sentence.endsWith('.'), r).toBe(true);
      expect(p.sentence[0], r).toBe((p.sentence[0] as string).toUpperCase());
      expect(p.noun.length, r).toBeGreaterThan(0);
    }
  });

  it('areas append their reasons; an unknown reason falls back to its own code', () => {
    expect(['zzz_unknown', 'zzz unknown']).toContain(reasonPhrase('zzz_unknown').noun);
    registerReasonPhrase('zzz_unknown', { noun: 'a made-up reason', sentence: 'Something made up happened.' });
    expect(reasonPhrase('zzz_unknown').noun).toBe('a made-up reason');
    expect(phraseReasons()).toContain('zzz_unknown');
  });

  it('the area reasons the language registered have phrases too', () => {
    for (const r of ['explicit', 'not_integer', 'no_value_yet', 'condition_false']) {
      expect(reasonPhrase(r).noun.length, r).toBeGreaterThan(0);
    }
  });
});
