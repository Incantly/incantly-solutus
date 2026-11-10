import { describe, expect, it } from 'vitest';
import { COLOR_WORDS, DIRECTIVES, ERROR_KINDS, MESSAGE_TEMPLATES, PROPERTIES, analyseLine, parseLine, parseProgram, tokenize } from '@incantly/kernel';
import { check, checked, compact, emptyFig, errOf, expectAt, expectFixPasses, expectWellFormed, failure, hasHint, newFig } from './helpers';

// Every language error kind listed in docs/features/language/errors.md, with one input that raises it.
// `col` / `endCol` are 1-based UTF-16 columns of the text as typed (endCol exclusive).
interface Case {
  readonly kind: string;
  readonly phase: string;
  readonly src: string;
  readonly col: number;
  readonly endCol: number;
  readonly token: string;
  /** The doc does not say whether the span is the name or the whole call; only the start column is checked. */
  readonly loose?: boolean;
}

const CASES: Case[] = [
  // lex (errors.md 2)
  { kind: 'bad_character', phase: 'lex', src: 'n = 3 $ 4', col: 7, endCol: 8, token: '$' },
  { kind: 'bad_character', phase: 'lex', src: '\u0430rea = 1', col: 1, endCol: 2, token: '\u0430' },
  { kind: 'bad_character', phase: 'lex', src: 'n = \u{1F600}', col: 5, endCol: 7, token: '\u{1F600}' },
  { kind: 'bad_number', phase: 'lex', src: 'n = 1__0', col: 5, endCol: 9, token: '1__0', loose: true },
  { kind: 'unterminated_string', phase: 'lex', src: 'n = "abc', col: 5, endCol: 6, token: '"' },
  // parse (errors.md 3)
  { kind: 'syntax', phase: 'parse', src: 'c: x^2 + y^2 = 4', col: 2, endCol: 3, token: ':' },
  { kind: 'syntax', phase: 'parse', src: 'n = (1 + )', col: 10, endCol: 11, token: ')' },
  { kind: 'syntax', phase: 'parse', src: 'n = * 2', col: 5, endCol: 6, token: '*' },
  { kind: 'unbalanced', phase: 'parse', src: 'n = (1 + 2', col: 5, endCol: 6, token: '(' },
  { kind: 'unbalanced', phase: 'parse', src: 'n = 1 + 2)', col: 10, endCol: 11, token: ')' },
  { kind: 'unnamed_object', phase: 'parse', src: 'Circle(A, 2)', col: 1, endCol: 13, token: 'Circle(A, 2)' },
  { kind: 'missing_operator', phase: 'parse', src: 'n = a b', col: 7, endCol: 8, token: 'b', loose: true },
  { kind: 'ambiguous_implicit', phase: 'parse', src: 'n = 1/2a', col: 7, endCol: 9, token: '2a' },
  { kind: 'chained_comparison', phase: 'parse', src: 'b9 = 1 < 5 > 0', col: 12, endCol: 13, token: '>' },
  { kind: 'assign_in_expr', phase: 'parse', src: 'f9(x) = x = 2', col: 11, endCol: 12, token: '=' },
  // resolve (errors.md 4)
  { kind: 'unknown_name', phase: 'resolve', src: 'n = zzz', col: 5, endCol: 8, token: 'zzz' },
  { kind: 'unknown_command', phase: 'resolve', src: 'c9 = Cirle(A, 2)', col: 6, endCol: 11, token: 'Cirle', loose: true },
  { kind: 'unknown_function', phase: 'resolve', src: 'n = foo(2)', col: 5, endCol: 8, token: 'foo', loose: true },
  { kind: 'not_callable', phase: 'resolve', src: 'n = a(2)', col: 5, endCol: 6, token: 'a', loose: true },
  { kind: 'free_variable', phase: 'resolve', src: 'n = x + 1', col: 5, endCol: 6, token: 'x' },
  { kind: 'reserved_name', phase: 'resolve', src: 'pi = 3', col: 1, endCol: 3, token: 'pi' },
  { kind: 'bad_name', phase: 'resolve', src: 'a_ = 3', col: 1, endCol: 3, token: 'a_' },
  { kind: 'duplicate_param', phase: 'resolve', src: 'h9(x, x) = x', col: 7, endCol: 8, token: 'x' },
  // typecheck (errors.md 5)
  { kind: 'type_mismatch', phase: 'typecheck', src: 'w9 = 2 * A', col: 6, endCol: 11, token: '2 * A' },
  { kind: 'empty_list_type', phase: 'typecheck', src: 'L9 = []', col: 6, endCol: 8, token: '[]' },
];

describe('language/errors.md: one input per kind, with phase, code, line, col, endCol and token', () => {
  it.each(CASES)('$kind: $src', (c) => {
    const e = failure(c.src);
    expect(e.kind).toBe(c.kind);
    expect(e.phase).toBe(c.phase);
    expectWellFormed(e);
    if (c.loose) expectAt(e, { col: c.col });
    else expectAt(e, { col: c.col, endCol: c.endCol, token: c.token });
  });

  it('errors.md 1: hint is always present and never empty', () => {
    const missing = CASES.filter((c) => !hasHint(failure(c.src))).map((c) => `${c.kind}: ${c.src}`);
    expect(missing).toEqual([]);
  });

  it('errors.md 1 / errors/design.md 3: an error carries committed:false, ok:false, severity error and a stable code', () => {
    for (const c of CASES) {
      const e = failure(c.src);
      expect(e.ok).toBe(false);
      expect(e.committed).toBe(false);
      expect(e.severity).toBe('error');
      expect(e.code, c.src).toMatch(/^[A-Z]\d{3}$/);
    }
  });

  it('errors/design.md 5: the same kind always has the same code, different kinds have different codes', () => {
    const byKind = new Map<string, string>();
    const byCode = new Map<string, string>();
    for (const c of CASES) {
      const e = failure(c.src);
      if (byKind.has(e.kind)) expect(e.code).toBe(byKind.get(e.kind));
      byKind.set(e.kind, e.code);
      if (byCode.has(e.code)) expect(e.kind, e.code).toBe(byCode.get(e.code));
      byCode.set(e.code, e.kind);
    }
  });

  it('errors/design.md 5: the registry gives every kind a unique code, a phase and a recovery', () => {
    const kinds = [
      'bad_character', 'bad_number', 'unterminated_string', 'bad_escape', 'bad_format', 'syntax', 'unbalanced', 'unnamed_object',
      'missing_operator', 'ambiguous_implicit', 'chained_comparison', 'assign_in_expr', 'bad_range', 'bad_directive',
      'unknown_name', 'unknown_command', 'unknown_function', 'not_callable', 'free_variable', 'reserved_name', 'bad_name',
      'duplicate_param', 'duplicate_arg', 'not_a_binder', 'type_mismatch', 'no_matching_form', 'type_change', 'cycle',
      'breaks_dependents', 'empty_list_type', 'limit',
    ];
    const codes = new Map<string, string>();
    for (const k of kinds) {
      const spec = ERROR_KINDS[k];
      expect(spec, k).toBeDefined();
      if (!spec) continue;
      expect(spec.code, k).toMatch(/^[A-Z]\d{3}$/);
      expect(codes.has(spec.code), `${k} shares ${spec.code} with ${codes.get(spec.code) ?? ''}`).toBe(false);
      codes.set(spec.code, k);
      expect(typeof spec.phase).toBe('string');
      expect(typeof spec.recovery).toBe('string');
    }
  });

  it('errors/design.md 3.4: every produced message is built from a template in the table', () => {
    for (const c of CASES) {
      const e = failure(c.src);
      expect(MESSAGE_TEMPLATES[e.messageKey], `${c.kind} ${e.messageKey}`).toEqual(expect.any(String));
      expect(e.message, c.src).not.toMatch(/\{[a-z_]+\}/);
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it('errors/design.md 3.4: one sentence, no exclamation marks, no "please"', () => {
    for (const c of CASES) {
      const m = failure(c.src).message;
      expect(m, c.src).not.toContain('!');
      expect(m.toLowerCase(), c.src).not.toContain('please');
    }
  });

  it('errors/design.md 3.3: endCol - col equals the token length when the token is not empty', () => {
    for (const c of CASES) {
      const e = failure(c.src);
      if (e.token !== '') expect(e.endCol - e.col, c.src).toBe(e.token.length);
      else expect(e.endCol, c.src).toBe(e.col);
    }
  });

  it('errors/design.md 3.3: the token is the text at [col, endCol) of the line as typed', () => {
    for (const c of CASES) {
      const e = failure(c.src);
      expect(c.src.slice(e.col - 1, e.endCol - 1), c.src).toBe(e.token);
    }
  });

  it('errors/design.md 3.3: a zero-width error (something is missing) has endCol === col and an empty token', () => {
    const e = failure('f9(x) =');
    expect(e.kind).toBe('syntax');
    expect(e.endCol).toBe(e.col);
    expect(e.expected).toContain('expression');
  });

  it('errors/design.md 3: source holds the full line when it is short', () => {
    const e = failure('n = 3 $ 4');
    expect(e.source).toBe('n = 3 $ 4');
    const long = `n = ${'1 + '.repeat(60)}$`;
    expect(long.length).toBeGreaterThan(200);
    expect(failure(long).source).toBeUndefined();
  });

  it('errors.md 1 / errors/design.md 3.1: an error with a fix also lists it in suggest [doc-question: relation not stated]', () => {
    const e = failure('n = a b');
    expect(e.fix).toBe('n = a * b');
    expect(e.suggest).toContain('n = a * b');
    expect(e.suggest.length).toBeLessThanOrEqual(3);
  });

  it('errors/design.md 3.1: fingerprint is stable for the same error and differs between kinds', () => {
    const a1 = failure('n = zzz');
    const a2 = failure('n = zzz');
    expect(a1.fingerprint).toBe(a2.fingerprint);
    expect(failure('n = a b').fingerprint).not.toBe(a1.fingerprint);
  });

  it('errors/design.md 6: recovery says what to do next', () => {
    expect(failure('c9 = Circle(A, B, 2)').recovery).toBe('choose_form');
    expect(['fix_line', 'use_suggestion']).toContain(failure('n = a b').recovery);
    expect(['create_first', 'fix_line', 'use_suggestion', 'rewrite']).toContain(failure('n = zzz').recovery);
    expect(['choose', 'rewrite']).toContain(failure('A = 3').recovery);
    expect(['rewrite', 'skip']).toContain(failure('L9 = [1..1000000]').recovery);
  });

  it('errors.md 1 / errors/design.md 5.2: all cases pass the same "expected / forms / suggest" caps', () => {
    for (const c of CASES) {
      const e = failure(c.src);
      expect(e.expected.length, c.src).toBeLessThanOrEqual(8);
      expect(e.suggest.length, c.src).toBeLessThanOrEqual(3);
      expect(e.forms.length, c.src).toBeLessThanOrEqual(6);
    }
  });
});

describe('language/errors.md 1: fix is something that would pass the same checks', () => {
  it.each([
    ['n = a b'],
    ['n = 2 3'],
    ['n = ab'],
    ['x = A.x'],
    ['n = x + 1'],
    ['3x + 4y = 12'],
    ['Circle(A, 2)'],
    ['n = (1 + 2'],
    ['c9 = Circle(A, 2'],
    ['A9: (1, 2)'],
    ['s9 = 3 in 10..0'],
    ['n = a(2)'],
  ])('%s', (src) => {
    const fig = newFig();
    const e = errOf(analyseLine(src, fig), src);
    expect(e.fix, src).toBeDefined();
    expectFixPasses(e, fig);
  });

  it('errors.md 1: when two readings exist there are quickFixes and no fix', () => {
    const e = failure('h = 1/2a');
    expect(e.fix).toBeUndefined();
    expect((e.quickFixes ?? []).length).toBeGreaterThanOrEqual(2);
    for (const q of e.quickFixes ?? []) {
      expect(q.label.length).toBeGreaterThan(0);
      expect(q.lines.length).toBeGreaterThan(0);
    }
  });

  it('errors.md 1: message never repeats the whole forms list', () => {
    const e = failure('c9 = Circle(A, B, 2)');
    const forms = e.forms;
    expect(forms.length).toBeGreaterThanOrEqual(3);
    expect(forms.filter((f) => e.message.includes(f)).length).toBeLessThan(2);
  });
});

describe('errors/design.md 3.5: the compact form is about 800 characters', () => {
  it.each([
    'n = zzz',
    'n = a b',
    'n = 3 $ 4',
    'c9 = Circle(A, B, 2)',
    'c9 = Circle(A, 2, 3)',
    'w9 = 2 * A',
    'pi = 3',
    'q9 = Many(A)',
    'h = 1/2a',
    'A = 3',
  ])('%s', (src) => {
    const e = failure(src);
    expect(compact(e).length).toBeLessThanOrEqual(900);
  });

  it('forms are capped at 6 with formsOmitted counting the rest', () => {
    const e = failure('q9 = Many(A)');
    expect(e.forms.length).toBeLessThanOrEqual(6);
    expect(e.forms.length + (e.formsOmitted ?? 0)).toBe(8);
  });
});

describe('errors.md 2: lexical errors', () => {
  it('bad_character: message names the character and its code point; hint names the Latin letter', () => {
    const e = failure('\u0430rea = 1');
    expect(e.message).toContain('U+0430');
    expect(e.hint).toMatch(/letter/i);
  });

  it('bad_character: token carries the character', () => {
    expect(failure('n = 1 \u00a7 2').token).toBe('\u00a7');
    expect(failure('n = 1 ~ 2').kind).toBe('bad_character');
    expect(failure('n = 1 ` 2').kind).toBe('bad_character');
  });

  it.each([
    ['n = 1.2.3', /decimal|point/i],
    ['n = 1__0', /underscore|_/i],
    ['n = 1e999', /range/i],
    ['n = 1e400', /range/i],
  ])('bad_number: %s says why', (src, why) => {
    const e = failure(src);
    expect(e.kind).toBe('bad_number');
    expect(e.line).toBe(1);
    expect(e.message).toMatch(why);
  });

  it('bad_number: a lone point', () => {
    expect(failure('n = .').kind).toBe('bad_number');
  });

  it('[doc-question: 3.3 reads "1e+" as 1 times e then a dangling +] bad_number: an exponent with no digits', () => {
    expect(failure('n = 1e+').kind).toBe('bad_number');
  });

  it('bad_number: 1.2.3 points inside the literal', () => {
    const e = failure('n = 1.2.3');
    expect(e.col).toBeGreaterThanOrEqual(5);
    expect(e.endCol).toBeLessThanOrEqual(10);
    expect(e.token).toContain('.');
  });

  it('unterminated_string: points at the opening quote and expects a quote', () => {
    const e = failure('n = "abc');
    expect(e.kind).toBe('unterminated_string');
    expect(e.col).toBe(5);
    expect(e.expected).toEqual(['"']);
  });

  it('unterminated_string: a newline ends the string', () => {
    const rs = parseProgram('n = "abc\nm = 1');
    const first = rs[0]?.result;
    expect(first?.ok).toBe(false);
    if (first && !first.ok) expect(first.kind).toBe('unterminated_string');
    expect(rs[1]?.result.ok).toBe(true);
  });

  it('bad_escape: lists the legal escapes', () => {
    const e = failure('n = "a\\qb"');
    expect(e.kind).toBe('bad_escape');
    expect(e.col).toBe(7);
    for (const x of ['\\"', '\\\\', '\\n', '\\{', '\\}']) expect(e.expected, x).toContain(x);
  });

  it('bad_format: lists the formats', () => {
    const e = failure('n = "{a:q}"');
    expect(e.kind).toBe('bad_format');
    expect(e.phase).toBe('lex');
    for (const x of ['2', '.3', 'd', 'f', '%']) expect(e.expected).toContain(x);
  });

  it('limit: a line over 2,000 characters is a limit error naming the limit', () => {
    const ok = `n = 1 #${'x'.repeat(1993)}`;
    expect(ok.length).toBe(2000);
    expect(check(ok).ok).toBe(true);
    const long = `n = 1 #${'x'.repeat(2100)}`;
    const e = failure(long);
    expect(e.kind).toBe('limit');
    expect(e.limit?.max).toBe(2000);
    expect(e.limit?.got).toBe(long.length);
    expect(e.hint).toMatch(/split/i);
    const e2 = failure(`n = 1 #${'x'.repeat(1994)}`);
    expect(e2.kind).toBe('limit');
    expect(e2.limit?.got).toBe(2001);
  });

  it('limit: more than 800 tokens in a line', () => {
    const src = `n = ${'1+'.repeat(500)}1`;
    expect(src.length).toBeLessThan(2000);
    const e = failure(src);
    expect(e.kind).toBe('limit');
    expect(e.limit?.max).toBe(800);
    expect(check(`n = ${'1+'.repeat(300)}1`).ok).toBe(true);
  });

  it('limit: nesting deeper than 64 is refused before recursion', () => {
    const nest = (d: number): string => `n = ${'('.repeat(d)}1${')'.repeat(d)}`;
    expect(check(nest(60)).ok).toBe(true);
    expect(check(nest(64)).ok).toBe(true);
    const e = failure(nest(65));
    expect(e.kind).toBe('limit');
    expect(e.limit?.max).toBe(64);
    expect(failure(nest(200)).kind).toBe('limit');
    const calls = `n = ${'abs('.repeat(70)}1${')'.repeat(70)}`;
    expect(failure(calls).kind).toBe('limit');
  });

  it('[doc-question: design 3.1 names kinds too_long and too_deep; the shared ErrorKind list has only limit]', () => {
    const e = failure(`n = 1 #${'x'.repeat(2100)}`);
    expect(['limit', 'too_long']).toContain(e.kind);
  });

  it('limit: 5,000 objects', () => {
    const fig = emptyFig();
    for (let i = 0; i < 5000; i++) fig.define(`n${i}`, 'Number', i, { free: true });
    expect(fig.size).toBe(5000);
    const e = errOf(analyseLine('zz = 1', fig));
    expect(e.kind).toBe('limit');
    expect(e.limit?.max).toBe(5000);
  });
});

describe('errors.md 3: syntax details', () => {
  it('syntax: expected lists token classes, at most 8, and the token is the offender', () => {
    const e = failure('n = (1 + )');
    expect(e.kind).toBe('syntax');
    expect(e.expected.length).toBeGreaterThan(0);
    expect(e.expected.length).toBeLessThanOrEqual(8);
    expect(e.expected).toContain('expression');
  });

  it('syntax: the end of the line is reported when the line stops too early', () => {
    const e = failure('n = 1 +');
    expect(e.kind).toBe('syntax');
    expect(e.expected).toContain('expression');
    expect(e.col).toBeGreaterThanOrEqual(8);
  });

  it('syntax: a keyword where an expression is expected', () => {
    expect(failure('n = and').kind).toBe('syntax');
    expect(failure('n = 1 and').kind).toBe('syntax');
    expect(failure('n = with').kind).toBe('syntax');
  });

  it('syntax: stray operators and punctuation', () => {
    for (const src of ['n = 1 +* 2', 'n = , 2', 'n = 1 ,', 'n = )', 'n = 1 2 3 +', 'n == 3', '= 3', 'n = =', 'n = [1, ]', 'n = (,)']) {
      const r = check(src);
      expect(r.ok, src).toBe(false);
    }
  });

  it('syntax: a rate rule needs a name before the tick', () => {
    expect(check("' = 3").ok).toBe(false);
    expect(check("3' = 3").ok).toBe(false);
  });

  it('syntax: with and in need their parts', () => {
    expect(check('A with').ok).toBe(false);
    expect(check('A with color').ok).toBe(false);
    expect(check('A with color =').ok).toBe(false);
    expect(check('s1 = 3 in').ok).toBe(false);
    expect(check('s1 = 3 in 0..').ok).toBe(false);
    expect(check('s1 = 3 in 0 10').ok).toBe(false);
  });

  it('assign_in_expr: the second = is the offender and the expected token is ==', () => {
    const e = failure('f9(x) = x = 2');
    expect(e.expected).toContain('==');
  });

  it('chained_comparison: hint says to use and', () => {
    expect(failure('b9 = 1 < 5 > 0').hint).toMatch(/\band\b/);
  });

  it('unnamed_object: refuses a bare object command, a value and an expression, and its fix names the object', () => {
    const fig = emptyFig();
    expect(errOf(analyseLine('(1, 2)', fig)).kind).toBe('unnamed_object');
    expect(errOf(analyseLine('3 + 4', fig)).kind).toBe('unnamed_object');
    expect(errOf(analyseLine('"hi"', fig)).kind).toBe('unnamed_object');
    expect(errOf(analyseLine('[1, 2]', fig)).kind).toBe('unnamed_object');
    expect(errOf(analyseLine('sin(1)', fig)).kind).toBe('unnamed_object');
  });

  it('unknown directive and malformed directives', () => {
    expect(['unknown_directive', 'bad_directive']).toContain(failure('@zoom 3').kind);
    expect(failure('@view 1 2 3').kind).toBe('bad_directive');
    expect(check('@grid on').ok).toBe(true);
    expect(check('@axes off').ok).toBe(true);
    expect(check('@clock 0..30').ok).toBe(true);
    expect(check('@beat intro "A title"').ok).toBe(true);
  });
});

describe('errors.md 4-5: name, type and redefinition errors', () => {
  it('unknown_name: hint is never empty, token is the name', () => {
    const e = failure('n = zzz');
    expect(e.hint).toBeTruthy();
    expect(e.token).toBe('zzz');
  });

  it('free_variable: the message names the variable and the type of the object', () => {
    const e = failure('v9 = x + 1');
    expect(e.message).toContain('x');
  });

  it('type_mismatch: left and right are type names', () => {
    const e = failure('w9 = 2 * A');
    expect(e.left).toBe('Number');
    expect(e.right).toBe('Point');
  });

  it('type_change: both types are in the message and the hint says Delete', () => {
    const e = failure('A = 3');
    expect(e.kind).toBe('type_change');
    expect(e.message).toContain('Point');
    expect(e.message).toContain('Number');
    expect(e.hint).toMatch(/Delete|different name/);
  });

  it('type_change: Line to Circle, Function<Number> to Function<Point>, List<Number> to List<Point>', () => {
    const fig = newFig();
    fig.apply('l9 = y == 2x + 1');
    expect(errOf(fig.apply('l9 = x^2 + y^2 == 4')).kind).toBe('type_change');
    expect(errOf(fig.apply('f(x) = (x, x)')).kind).toBe('type_change');
    expect(errOf(fig.apply('L = [(0, 0), (1, 1)]')).kind).toBe('type_change');
    expect(check('L = [4, 5]', fig).ok).toBe(true);
    expect(check('l9 = y == 3', fig).ok).toBe(true);
  });

  it('empty_list_type: the hint mentions Seq or a first element', () => {
    expect(failure('L9 = []').hint).toMatch(/Seq|first element/);
  });

  it('bad_range: the message names which test failed', () => {
    const e = failure('s9 = 3 in 10..0');
    expect(e.kind).toBe('bad_range');
    expect(e.message).toMatch(/lower|upper|bound|above|empty|10\.\.0/i);
    const e2 = failure('s9 = 3 in 0..10 step 0');
    expect(e2.message).toMatch(/step/i);
  });

  it('breaks_dependents: lists each dependent and changes nothing', () => {
    const fig = newFig();
    okApply(fig, 'g2(x) = f(x) + 1');
    okApply(fig, 'T9 = f(2)');
    const before = fig.lookup('f');
    const e = errOf(fig.apply('f(x, y) = x*y'));
    expect(e.kind).toBe('breaks_dependents');
    expect(e.committed).toBe(false);
    const names = [...(e.related ?? []), ...(e.path ?? [])].join(' ') + JSON.stringify(e);
    expect(names).toContain('g2');
    expect(names).toContain('T9');
    expect(fig.lookup('f')?.type.arity).toBe(before?.type.arity);
    expect(fig.lookup('f')?.type.arity).toBe(1);
  });

  it('cycle: the path names every object on the loop', () => {
    const fig = newFig();
    fig.define('b9', 'Number', 4, { source: 'b9 = a * 2', inputs: ['a'] });
    fig.define('c9', 'Number', 8, { source: 'c9 = b9 * 2', inputs: ['b9'] });
    const e = errOf(analyseLine('a = c9 + 1', fig));
    expect(e.kind).toBe('cycle');
    const chain = JSON.stringify([e.related, e.path, e.message]);
    expect(chain).toContain('b9');
    expect(chain).toContain('c9');
    expect(e.message).toContain('a');
  });
});

describe('errors.md 1: batches', () => {
  it('lines after a failed line are still tried; line numbers count lines of the batch', () => {
    const fig = emptyFig();
    const rs = fig.applyAll(['A = (1, 2)', 'B = $', 'C = A']);
    expect(rs[0]?.ok).toBe(true);
    const bad = rs[1] ? errOf(rs[1]) : undefined;
    expect(bad?.line).toBe(2);
    expect(rs[2]?.ok).toBe(true);
  });

  it('errors.md 1: a line reading a name made by a failed line is unknown_name with blockedBy and recovery fix_earlier', () => {
    const fig = emptyFig();
    const rs = fig.applyAll(['A = (1, 2)', 'B = Foo(A)', 'C = B', 'D = A']);
    expect(rs[1] ? errOf(rs[1]).kind : '').toBe('unknown_command');
    const dep = rs[2] ? errOf(rs[2]) : undefined;
    expect(dep?.kind).toBe('unknown_name');
    expect(dep?.blockedBy).toEqual({ line: 2, kind: 'unknown_command' });
    expect(dep?.recovery).toBe('fix_earlier');
    expect(rs[3]?.ok).toBe(true);
  });

  it('parseProgram numbers physical lines, so an error on line 3 says line 3', () => {
    const rs = parseProgram('A9 = (1, 2)\n# note\nB9 = $');
    const last = rs[rs.length - 1];
    const e = last ? errOf(last.result) : undefined;
    expect(e?.line).toBe(3);
    expect(e?.col).toBe(6);
  });

  it('parseLine takes the number of the first physical line', () => {
    const e = errOf(parseLine('n = $', { line: 7 }));
    expect(e.line).toBe(7);
    const e2 = errOf(analyseLine('n = $', newFig(), { line: 9 }));
    expect(e2.line).toBe(9);
  });
});

describe('errors/design.md 3.3: columns are UTF-16 code units of the text as typed', () => {
  it('a surrogate pair inside a string counts two columns', () => {
    const e = failure('tx = "\u{1F600}" + $');
    expect(e.kind).toBe('bad_character');
    expectAt(e, { col: 13, endCol: 14, token: '$' });
  });

  it('two emoji before the error', () => {
    const e = failure('tx = "\u{1F600}\u{1F601}" $');
    expect(e.token).toBe('$');
    expect(e.col).toBe('tx = "\u{1F600}\u{1F601}" '.length + 1);
  });

  it('an emoji in a comment on an earlier line does not shift the next line', () => {
    const rs = parseProgram('# \u{1F600}\nn = $');
    const e = rs[1] ? errOf(rs[1].result) : undefined;
    expect(e?.line).toBe(2);
    expect(e?.col).toBe(5);
  });

  it('an emoji token has width 2 and carries the whole character', () => {
    const e = failure('n = 1 + \u{1F600}');
    expect(e.endCol - e.col).toBe(2);
    expect(e.token).toBe('\u{1F600}');
  });

  it('an unterminated string after an emoji', () => {
    const e = failure('tx = "\u{1F600}');
    expect(e.kind).toBe('unterminated_string');
    expect(e.col).toBe(6);
  });

  it('NFC: a decomposed letter is one name, and columns still point at the text as typed', () => {
    // alpha + combining acute accent composes to a single Greek letter under NFC.
    const e = failure('\u03b1\u0301 = $');
    expect(e.kind).toBe('bad_character');
    expectAt(e, { col: 6, endCol: 7, token: '$' });
  });

  it('typographic characters that normalise to other widths keep the right columns', () => {
    // "<=" is typed as one character ≤, "pi" as one character π.
    const e = failure('b9 = \u03c0 \u2264 $');
    expect(e.token).toBe('$');
    expect(e.col).toBe(10);
  });

  it('tokenize uses the same columns', () => {
    const { tokens } = tokenize('tx = "\u{1F600}" + a', newFig());
    const str = tokens.find((t) => t.kind === 'string');
    expect(str?.col).toBe(6);
    expect(str?.endCol).toBe(10);
    const plus = tokens.find((t) => t.text === '+');
    expect(plus?.col).toBe(11);
  });
});

describe('language/design.md 3.13 notices and warnings', () => {
  it('shadowed: a parameter or binder hides an object; severity warning; names the object', () => {
    const r = check('h9(a) = a + 1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.notices.find((x) => x.kind === 'shadowed');
    expect(n).toBeDefined();
    expect(n?.severity).toBe('warning');
    expect(n?.code).toBeTruthy();
    expect(n?.message.length).toBeGreaterThan(0);
    expect(JSON.stringify(n)).toContain('a');
  });

  it('index_literal: severity warning', () => {
    const r = check('out = L[0]');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = r.notices.find((x) => x.kind === 'index_literal');
    expect(n?.severity).toBe('warning');
  });

  it('precision_loss is a notice kind of the shared set and 1e-400 carries it', () => {
    const r = check('n = 1e-400');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notices.some((x) => x.kind === 'precision_loss')).toBe(true);
  });

  it('a clean line has no notices', () => {
    const r = check('n = a + b');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notices).toEqual([]);
  });

  it('every notice has severity info or warning, a code and a message', () => {
    for (const src of ['h9(a) = a + 1', 'out = L[0]', 'S9 = Seq(3, k, 1, 5)', 'n = 1e-400']) {
      const r = check(src);
      expect(r.ok, src).toBe(true);
      if (!r.ok) continue;
      expect(r.notices.length, src).toBeGreaterThan(0);
      for (const n of r.notices) {
        expect(['info', 'warning']).toContain(n.severity);
        expect(n.code).toBeTruthy();
        expect(n.message).toBeTruthy();
      }
    }
  });
});

describe('language/design.md 3.12 and kernel 9.1: with-clause properties', () => {
  it('PROPERTIES has the documented keys', () => {
    for (const k of ['visible', 'label', 'caption', 'aux', 'fixed', 'selectable', 'layer', 'showIf', 'color', 'opacity', 'width', 'pointSize', 'lineStyle', 'pointStyle', 'fill', 'trace', 'tip', 'tags']) {
      expect(PROPERTIES[k], k).toBeDefined();
    }
  });

  it('DIRECTIVES has view, grid, axes, beat and clock; COLOR_WORDS has the basic colours', () => {
    for (const d of ['view', 'grid', 'axes', 'beat', 'clock']) expect(DIRECTIVES[d], d).toBeDefined();
    for (const c of ['red', 'blue', 'green', 'black']) expect(COLOR_WORDS).toContain(c);
  });

  it('a restyle line checks to op restyle with the style items', () => {
    const c = checked('A with color = red, pointSize = 4');
    expect(c.op).toBe('restyle');
    expect(c.names).toEqual(['A']);
    expect(c.style?.map((s) => s.key)).toEqual(['color', 'pointSize']);
    const first = c.style?.[0]?.value;
    expect(first && 'word' in first ? first.word : undefined).toBe('red');
  });

  it('a style clause on a definition is kept on the definition', () => {
    const c = checked('P9 = (1, 2) with color = red');
    expect(c.op).toBe('add');
    expect(c.style?.map((s) => s.key)).toEqual(['color']);
  });

  it('values: visible, layer 0..9, opacity, expressions for showIf', () => {
    expect(check('A with visible = false').ok).toBe(true);
    expect(check('A with layer = 0').ok).toBe(true);
    expect(check('A with layer = 9').ok).toBe(true);
    expect(check('A with opacity = 0.5').ok).toBe(true);
    expect(check('A with showIf = a > 1').ok).toBe(true);
    expect(check('A with color = rgb(255, 0, 0)').ok).toBe(true);
    expect(check('A with width = 3, color = blue').ok).toBe(true);
    expect(check('A with caption = "start"').ok).toBe(true);
  });

  it('unknown_property: the hint lists the keys valid for the object', () => {
    const e = failure('A with colour = red');
    expect(e.kind).toBe('unknown_property');
    expect(e.hint).toContain('color');
    expect(e.token).toBe('colour');
    expect(e.col).toBe(8);
  });

  it('bad_property_value: out-of-range layer is refused, not clamped', () => {
    const e = failure('A with layer = 10');
    expect(e.kind).toBe('bad_property_value');
    expect(e.message).toMatch(/layer/);
    expect(failure('A with layer = -1').kind).toBe('bad_property_value');
    expect(failure('A with visible = 5').kind).toBe('bad_property_value');
  });

  it('restyle of an unknown object is unknown_name', () => {
    expect(failure('Q9 with color = red').kind).toBe('unknown_name');
  });

  it('showIf needs a Bool', () => {
    expect(check('A with showIf = 5').ok).toBe(false);
  });

  it('unknown colour word is refused', () => {
    expect(check('A with color = notacolour').ok).toBe(false);
  });
});

function okApply(fig: ReturnType<typeof newFig>, src: string): void {
  const r = fig.apply(src);
  if (!r.ok) throw new Error(`${src}: ${r.kind}`);
}
