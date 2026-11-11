/**
 * The error registry and the one constructor: kinds, codes, phases, recovery defaults, templates, fallbacks.
 * Docs: errors/design.md 3 to 5; errors/errors.md 1 (the catalogue), 6 (errors in the error system).
 */
import { describe, expect, it } from 'vitest';
import { checkErrorTable, err, errorTable, fallbackInternal, internalError, isErrorObject, placeholdersOf, renderMessage } from '@incantly/kernel';
import type { ErrorKind, Recovery } from '@incantly/kernel';

const at = { line: 3, col: 5, endCol: 9 };

/** errors.md section 1: kind -> [code, default recovery]. */
const CATALOGUE: [ErrorKind, string, Recovery][] = [
  ['syntax', 'L001', 'fix_line'],
  ['unbalanced', 'L002', 'use_suggestion'],
  ['bad_number', 'L003', 'fix_line'],
  ['unterminated_string', 'L004', 'use_suggestion'],
  ['bad_character', 'L005', 'use_suggestion'],
  ['unknown_directive', 'L006', 'fix_line'],
  ['bad_directive', 'L007', 'fix_line'],
  ['unknown_name', 'K001', 'create_first'],
  ['unknown_command', 'K002', 'use_suggestion'],
  ['reserved_name', 'K003', 'rewrite'],
  ['bad_name', 'K004', 'rewrite'],
  ['name_taken', 'K005', 'rewrite'],
  ['unnamed_object', 'K006', 'use_suggestion'],
  ['duplicate_param', 'K007', 'fix_line'],
  ['not_callable', 'K008', 'fix_line'],
  ['unknown_property', 'K020', 'use_suggestion'],
  ['bad_property_value', 'K021', 'fix_line'],
  ['cycle', 'K010', 'rewrite'],
  ['type_change', 'K011', 'rewrite'],
  ['forward_reference', 'K012', 'choose'],
  ['not_free', 'K013', 'choose'],
  ['locked', 'K014', 'choose'],
  ['missing_rate', 'K015', 'create_first'],
  ['nothing_to_undo', 'K030', 'skip'],
  ['no_matching_form', 'C001', 'choose_form'],
  ['arg_count', 'C002', 'fix_line'],
  ['type_mismatch', 'C003', 'rewrite'],
  ['bad_argument', 'C004', 'fix_line'],
  ['bad_range', 'C005', 'fix_line'],
  ['limit', 'K040', 'rewrite'],
  ['load_failed', 'K041', 'report'],
  ['version', 'K042', 'report'],
  ['tool_input', 'T001', 'fix_line'],
  ['tool_busy', 'T002', 'skip'],
  ['internal', 'K999', 'skip'],
];

const ALL_KINDS: ErrorKind[] = [
  'syntax', 'unbalanced', 'bad_number', 'unterminated_string', 'bad_character', 'unknown_directive', 'bad_directive',
  'unknown_name', 'unknown_command', 'unknown_property', 'reserved_name', 'bad_name', 'name_taken', 'unnamed_object', 'duplicate_param', 'not_callable',
  'no_matching_form', 'arg_count', 'type_mismatch', 'type_change', 'bad_property_value', 'bad_range', 'bad_argument',
  'cycle', 'forward_reference', 'locked', 'not_free', 'missing_rate',
  'nothing_to_undo', 'limit', 'load_failed', 'version', 'tool_input', 'tool_busy', 'internal',
];

describe('the registry (errors design 5)', () => {
  it('passes its own self-test: every kind has a code, no code is shared, every template uses declared params', () => {
    expect(checkErrorTable()).toEqual([]);
  });

  it('has an entry for every kind in the kind list (design section 4)', () => {
    for (const k of ALL_KINDS) expect(errorTable[k], k).toBeDefined();
  });

  it('every entry is complete: kind, code, phase, recovery, message key, params, forms flag, description', () => {
    for (const [kind, spec] of Object.entries(errorTable)) {
      expect(spec.kind, kind).toBe(kind);
      expect(spec.code, kind).toMatch(/^[A-Z]\d{3}$/);
      expect(typeof spec.phase, kind).toBe('string');
      expect(typeof spec.recovery, kind).toBe('string');
      expect(spec.messageKey.length, kind).toBeGreaterThan(0);
      expect(Array.isArray(spec.params), kind).toBe(true);
      expect(typeof spec.forms, kind).toBe('boolean');
      expect(spec.description.length, kind).toBeGreaterThan(0);
    }
  });

  it('no two kinds share a code', () => {
    const codes = Object.values(errorTable).map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(CATALOGUE)('%s has code %s and default recovery %s (errors.md 1)', (kind, code, recovery) => {
    expect(errorTable[kind].code).toBe(code);
    expect(errorTable[kind].recovery).toBe(recovery);
  });

  it('the code letter names the area: L language, K kernel, C command table, T tools', () => {
    for (const [kind, code] of CATALOGUE.map(([k, c]) => [k, c] as const)) {
      const letter = code[0];
      if (['syntax', 'unbalanced', 'bad_number', 'unterminated_string', 'bad_character', 'unknown_directive', 'bad_directive'].includes(kind)) expect(letter).toBe('L');
      if (['no_matching_form', 'arg_count', 'type_mismatch', 'bad_argument', 'bad_range'].includes(kind)) expect(letter).toBe('C');
      if (['tool_input', 'tool_busy'].includes(kind)) expect(letter).toBe('T');
    }
  });

  it('phases follow the catalogue: lex and parse, resolve, plan, load, tool, commit', () => {
    expect(errorTable.syntax.phase).toBe('parse');
    expect(errorTable.unknown_name.phase).toBe('resolve');
    expect(errorTable.unknown_command.phase).toBe('resolve');
    expect(errorTable.cycle.phase).toBe('plan');
    expect(errorTable.locked.phase).toBe('plan');
    expect(errorTable.limit.phase).toBe('plan');
    expect(errorTable.unknown_property.phase).toBe('typecheck');
    expect(errorTable.bad_property_value.phase).toBe('typecheck');
    expect(errorTable.no_matching_form.phase).toBe('typecheck');
    expect(errorTable.load_failed.phase).toBe('load');
    expect(errorTable.version.phase).toBe('load');
    expect(errorTable.tool_input.phase).toBe('tool');
    expect(errorTable.internal.phase).toBe('commit');
  });

  it('only the kinds the docs name may carry forms', () => {
    expect(errorTable.no_matching_form.forms).toBe(true);
    expect(errorTable.arg_count.forms).toBe(true);
    expect(errorTable.cycle.forms).toBe(false);
  });
});

describe('err(kind, at, params, extra)', () => {
  it('fills code, phase, recovery, message, messageKey and fingerprint from the registry', () => {
    const e = err('unknown_name', at, { name: 'k' }, { token: 'k' });
    expect(e.ok).toBe(false);
    expect(e.committed).toBe(false);
    expect(e.severity).toBe('error');
    expect(e.kind).toBe('unknown_name');
    expect(e.code).toBe('K001');
    expect(e.phase).toBe('resolve');
    expect(e.recovery).toBe('create_first');
    expect(e.message).toBe('k is not defined.');
    expect(e.messageKey).toBe(errorTable.unknown_name.messageKey);
    expect(e.fingerprint.startsWith('unknown_name')).toBe(true);
    expect(e.params).toEqual({ name: 'k' });
  });

  it('keeps the span: line, col, endCol and token', () => {
    const e = err('unknown_name', at, { name: 'k' }, { token: 'kk' });
    expect([e.line, e.col, e.endCol, e.token]).toEqual([3, 5, 9, 'kk']);
  });

  it('a zero-width error has endCol equal to col and an empty token', () => {
    const e = err('syntax', { line: 1, col: 12, endCol: 12 }, { token: '', expected: ['a number'] });
    expect(e.endCol).toBe(e.col);
    expect(e.token).toBe('');
  });

  it('carries the extras: expected, forms, hint, suggest, related, path, blockedBy, cause, source, recovery', () => {
    const cause = err('type_mismatch', at, { op: '+', left: 'Point', right: 'Point' }, { token: 'A + B' });
    const e = err(
      'no_matching_form',
      at,
      { command: 'Circle', given: 'Point, Point, Number' },
      {
        token: 'Circle(O, P, 2)',
        source: 'c = Circle(O, P, 2)',
        expected: ['a number'],
        forms: ['Circle(center: Point, radius: Number) -> Circle'],
        hint: 'Remove one argument.',
        suggest: ['c = Circle(O, P)'],
        related: ['O', 'P'],
        path: ['a', 'b', 'a'],
        blockedBy: { line: 2, kind: 'unknown_name' },
        cause,
        recovery: 'use_suggestion',
      },
    );
    expect(e.expected).toEqual(['a number']);
    expect(e.forms).toEqual(['Circle(center: Point, radius: Number) -> Circle']);
    expect(e.hint).toBe('Remove one argument.');
    expect(e.suggest).toEqual(['c = Circle(O, P)']);
    expect(e.related).toEqual(['O', 'P']);
    expect(e.path).toEqual(['a', 'b', 'a']);
    expect(e.blockedBy).toEqual({ line: 2, kind: 'unknown_name' });
    expect(e.cause?.kind).toBe('type_mismatch');
    expect(e.source).toBe('c = Circle(O, P, 2)');
    expect(e.recovery).toBe('use_suggestion');
  });

  it('defaults for the list fields are empty arrays, never undefined', () => {
    const e = err('cycle', at, { name: 'A', path: 'A -> M -> A' }, { token: 'A' });
    expect(e.expected).toEqual([]);
    expect(e.forms).toEqual([]);
    expect(e.suggest).toEqual([]);
  });

  it('the fingerprint is stable: the same kind and key give the same text, another key another text', () => {
    const a = err('unknown_name', at, { name: 'k' }, { token: 'k' });
    const b = err('unknown_name', { line: 9, col: 1, endCol: 2 }, { name: 'k' }, { token: 'k' });
    const c = err('unknown_name', at, { name: 'm' }, { token: 'm' });
    expect(a.fingerprint).toBe(b.fingerprint); // position does not matter
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });

  it('fingerprintKey sets the stable part after the kind', () => {
    const a = err('limit', at, { limit: 'objects', max: 5, got: 6, what: 'objects' }, { fingerprintKey: 'objects' });
    expect(a.fingerprint).toBe('limit:objects');
  });

  it('messageKey can be overridden', () => {
    const e = err('syntax', at, { token: ')', expected: ['a name'] }, { messageKey: 'lang.syntax_end' });
    expect(e.messageKey).toBe('lang.syntax_end');
  });

  it('never throws, even with missing params or junk input', () => {
    for (const kind of ALL_KINDS) {
      expect(() => err(kind, at), kind).not.toThrow();
      expect(() => err(kind, at, {}), kind).not.toThrow();
      expect(() => err(kind, { line: -1, col: NaN, endCol: Infinity }, { x: 1 } as never), kind).not.toThrow();
    }
  });

  it('every kind builds a one-sentence message from its template', () => {
    for (const kind of ALL_KINDS) {
      const params: Record<string, string | number | boolean | string[]> = {};
      for (const p of errorTable[kind].params) params[p] = `<${p}>`;
      const e = err(kind, at, params);
      expect(e.message.length, kind).toBeGreaterThan(0);
      expect(e.message, kind).not.toContain('{');
      expect(e.message.endsWith('.'), `${kind}: "${e.message}"`).toBe(true);
      expect(e.message, kind).not.toMatch(/!|\bplease\b/i);
    }
  });

  it('the result is plain JSON data: no undefined values, functions or Error instances', () => {
    for (const kind of ALL_KINDS) {
      const e = err(kind, at, {}, { token: 'x', hint: 'h', suggest: ['a'], forms: ['f'], expected: ['e'] });
      const json = JSON.stringify(e);
      expect(JSON.parse(json), kind).toEqual(e);
      for (const v of Object.values(e)) expect(v, kind).not.toBeUndefined();
      expect(JSON.stringify(e)).not.toContain('"stack"');
    }
  });

  it('unbalanced is detected while lexing (errors.md 2 and example 5.2)', () => {
    expect(errorTable.unbalanced.phase).toBe('lex');
    expect(err('unbalanced', at, { open: '(' }).phase).toBe('lex');
  });

  it('no_matching_form reads "{command} has no form ({given})." (design 3.4, errors.md 1.4 and 5.4)', () => {
    expect(err('no_matching_form', at, { command: 'Circle', given: 'Point, Point, Number' }).message).toBe('Circle has no form (Point, Point, Number).');
  });

  it('message templates, from the catalogue', () => {
    expect(err('cycle', at, { name: 'A', path: 'A -> M -> A' }).message).toBe('A would depend on itself: A -> M -> A.');
    expect(err('type_change', at, { name: 'c', from: 'Number', to: 'Circle' }).message).toBe('c is a Number; this line would make it a Circle.');
    expect(err('locked', at, { name: 'P' }).message).toBe('P is fixed and cannot be changed by a line.');
    expect(err('limit', at, { limit: 'list_size', max: 100000, got: 1000000, what: 'list items' }).message).toBe('That would exceed the limit of 100000 list items.');
    expect(err('unknown_command', at, { name: 'Midpont' }).message).toBe('Midpont is not a command.');
    expect(err('bad_range', at, { why: 'The range 5..0 is empty' }).message).toContain('5..0');
    expect(err('nothing_to_undo', at, { what: 'undo' }).message).toBe('There is nothing to undo.');
    expect(err('nothing_to_undo', at, { what: 'redo' }).message).toBe('There is nothing to redo.');
    expect(err('not_free', at, { name: 'M', inputs: 'A and B' }).message).toBe('M is computed from A and B; it has no value of its own to set.');
  });
});

describe('internal errors and the fallback (errors.md 6)', () => {
  it('internalError names the place and says nothing changed', () => {
    const e = internalError('Integral', at, 'q = Integral(f, 0, 1)', 'Integral:3f9c', 'q = Integral(f, 0, 1)');
    expect(e.kind).toBe('internal');
    expect(e.code).toBe('K999');
    expect(e.message).toBe('Something went wrong inside Integral; nothing was changed.');
    expect(e.recovery).toBe('skip');
    expect(e.phase).toBe('commit');
    expect(e.fingerprint.startsWith('internal:')).toBe(true);
    expect(e.committed).toBe(false);
  });

  it('never leaks a stack or the thrown text', () => {
    const e = internalError('Integral', at, 'x');
    expect(JSON.stringify(e)).not.toMatch(/\bat \w+ \(|\.ts:\d+/);
  });

  it('fallbackInternal is the hard-coded object: K999, "Something went wrong.", fingerprint internal:error-build', () => {
    const e = fallbackInternal();
    expect(e.ok).toBe(false);
    expect(e.kind).toBe('internal');
    expect(e.code).toBe('K999');
    expect(e.message).toBe('Something went wrong.');
    expect(e.fingerprint).toBe('internal:error-build');
    expect(e.committed).toBe(false);
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
    expect(fallbackInternal(7).line).toBe(7);
  });
});

describe('helpers', () => {
  it('placeholdersOf lists the names a template uses', () => {
    expect(placeholdersOf('{a} and {b} and {a}')).toEqual(expect.arrayContaining(['a', 'b']));
    expect(placeholdersOf('no placeholders')).toEqual([]);
  });

  it('renderMessage builds the sentence of a key and params', () => {
    const key = errorTable.unknown_name.messageKey;
    expect(renderMessage(key, { name: 'zz' })).toBe('zz is not defined.');
  });

  it('isErrorObject is true for the failing half of a Result and false for anything else', () => {
    expect(isErrorObject(err('syntax', at))).toBe(true);
    expect(isErrorObject({ ok: true, value: 1, notices: [] })).toBe(false);
    expect(isErrorObject(null)).toBe(false);
    expect(isErrorObject(undefined)).toBe(false);
    expect(isErrorObject(42)).toBe(false);
    expect(isErrorObject({ ok: false })).toBe(false);
  });
});
