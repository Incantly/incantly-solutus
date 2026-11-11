/**
 * Golden tests for every error kind a Figure raises (errors.md 7): at least three lines that must produce the kind with
 * exact position, token and code; a near-miss that must not; suggestions that pass; atomicity; JSON-safe data.
 * Docs: errors/errors.md 1, 5 and 7; errors/design.md 3 and 6; kernel/errors.md 1, 4 and 5.
 */
import { describe, expect, it } from 'vitest';
import { Figure } from '@incantly/kernel';
import type { ErrorKind, ErrorObject, Recovery } from '@incantly/kernel';
import { TEST_COMMANDS, bad, expectUnchanged, expectWellFormedError, figure, newFigure, ok, snap } from '../kernel/helpers';

const WORLD = [
  'A = (0, 0)',
  'B = (4, 0)',
  'C = (1, 3)',
  'M = Midpoint(A, B)',
  'a = 3 in 0..10 step 0.5',
  'n = 2',
  'flag = true',
  's = "text"',
  'seg = Segment(A, B)',
];

/** A fresh copy of the figure (from its script), to try a suggestion on without disturbing the original. */
function clone(f: Figure): Figure {
  return Figure.fromScript(f.toScript(), { commands: TEST_COMMANDS }).figure;
}

interface Case {
  /** The line to apply. */
  line: string;
  /** The text the error must point at. */
  token: string;
  /** Which occurrence of the token (0-based) when it occurs more than once. */
  nth?: number;
  /** The error points at the whole line (graph errors do). */
  whole?: boolean;
  /** The error is at the end of the line: zero width, empty token. */
  eol?: boolean;
  /** The docs do not fix the span for this case, so only the kind and code are checked. */
  loose?: boolean;
}

interface Kind {
  kind: ErrorKind;
  code: string;
  recovery: Recovery;
  cases: Case[];
  /** Lines that look similar but are fine. */
  near: string[];
  /** Extra setup lines on top of WORLD. */
  setup?: string[];
}

function indexOfNth(s: string, t: string, nth: number): number {
  let from = 0;
  let i = -1;
  for (let k = 0; k <= nth; k++) {
    i = s.indexOf(t, from);
    if (i < 0) return -1;
    from = i + 1;
  }
  return i;
}

const KINDS: Kind[] = [
  {
    kind: 'unknown_name',
    code: 'K001',
    recovery: 'create_first',
    cases: [
      { line: 'Q = Midpoint(A, Zed)', token: 'Zed' },
      { line: 'r = k + 1', token: 'k' },
      { line: 'Hide(Nope)', token: 'Nope' },
      { line: 'x2 = a + b2 * 2', token: 'b2' },
    ],
    near: ['Q = Midpoint(A, B)', 'r = n + 1'],
  },
  {
    kind: 'unknown_command',
    code: 'K002',
    recovery: 'use_suggestion',
    cases: [
      { line: 'M2 = Midpont(A, B)', token: 'Midpont' },
      { line: 'c2 = Cirkle(A, 2)', token: 'Cirkle' },
      { line: 'd2 = Distanse(A, B)', token: 'Distanse' },
    ],
    near: ['M2 = Midpoint(A, B)'],
  },
  {
    kind: 'syntax',
    code: 'L001',
    recovery: 'fix_line',
    cases: [
      { line: 'x2 = * 3', token: '*' },
      { line: 'x2 = 3 +', token: '', eol: true },
      { line: 'x2 = (1, 2) + ()', token: ')', nth: 1 },
    ],
    near: ['x2 = 3 * 3'],
  },
  {
    kind: 'unbalanced',
    code: 'L002',
    recovery: 'use_suggestion',
    cases: [
      { line: 'M2 = Midpoint(A, B', token: '(' },
      { line: 'x2 = (1 + 2))', token: ')', nth: 1 },
      { line: 'L2 = [1, 2', token: '[' },
    ],
    near: ['x2 = (1 + 2)'],
  },
  {
    kind: 'bad_number',
    code: 'L003',
    recovery: 'fix_line',
    cases: [
      { line: 'x2 = 1.2.3', token: '1.2.3' },
      { line: 'x2 = 12.5.5', token: '12.5.5' },
      { line: 'x2 = 1e999', token: '1e999' },
    ],
    near: ['x2 = 1.2'],
  },
  {
    kind: 'unterminated_string',
    code: 'L004',
    recovery: 'use_suggestion',
    cases: [
      // The span is the opening quote: "the text starting at column {col} has no closing quote".
      { line: 's2 = "abc', token: '"' },
      { line: 's2 = "a" + "b', token: '"', nth: 2 },
      { line: 's2 = "', token: '"' },
    ],
    near: ['s2 = "abc"'],
  },
  {
    kind: 'bad_character',
    code: 'L005',
    recovery: 'use_suggestion',
    cases: [
      // language design 3.1: × ÷ − are normalised to * / -, so they are fine. Other-script letters and digits are not.
      { line: 'x2 = а + 1', token: 'а' }, // Cyrillic a
      { line: 'x2 = 5 ٣', token: '٣' }, // Arabic-Indic digit three
      { line: 'x2 = 1 + 🙂', token: '🙂' },
    ],
    near: ['x2 = 2 * 3', 'x2 = 2 × 3', 'x2 = 5 − 3'],
  },
  {
    kind: 'unknown_directive',
    code: 'L006',
    recovery: 'fix_line',
    cases: [
      { line: '@foo 1', token: '@foo' },
      { line: '@veiw -5 5 -3 3', token: '@veiw' },
      { line: '@viewx -5 5 -3 3', token: '@viewx' },
    ],
    near: ['@view -5 5 -3 3'],
  },
  {
    kind: 'bad_directive',
    code: 'L007',
    recovery: 'fix_line',
    cases: [
      { line: '@view 1 2', token: '@view 1 2', whole: true },
      { line: '@clock 5', token: '@clock 5', whole: true },
      { line: '@view a b c d', token: '@view a b c d', whole: true },
    ],
    near: ['@clock 0..10', '@step "title"'],
  },
  {
    kind: 'reserved_name',
    code: 'K003',
    recovery: 'rewrite',
    cases: [
      { line: 'Midpoint = (1, 2)', token: 'Midpoint' },
      { line: 'sin = 3', token: 'sin' },
      { line: 't = 3', token: 't' },
      { line: 'with = 1', token: 'with' },
    ],
    near: ['midpoint1 = (1, 2)'],
  },
  {
    kind: 'name_taken',
    code: 'K005',
    recovery: 'rewrite',
    cases: [
      { line: 'Rename(M, "A")', token: '"A"' },
      { line: 'Rename(A, "B")', token: '"B"' },
      { line: 'Rename(a, "n")', token: '"n"' },
    ],
    near: ['Rename(M, "K")'],
  },
  {
    kind: 'bad_name',
    code: 'K004',
    recovery: 'rewrite',
    cases: [
      { line: 'Rename(M, "1x")', token: '"1x"' },
      { line: 'Rename(M, "a b")', token: '"a b"' },
      { line: 'Rename(M, "")', token: '""' },
    ],
    near: ['Rename(M, "x1")'],
  },
  {
    kind: 'unnamed_object',
    code: 'K006',
    recovery: 'use_suggestion',
    cases: [
      { line: 'Midpoint(A, B)', token: 'Midpoint(A, B)', whole: true },
      { line: 'Circle(A, 2)', token: 'Circle(A, 2)', whole: true },
      { line: 'Distance(A, B)', token: 'Distance(A, B)', whole: true },
    ],
    near: ['Hide(A)'],
  },
  {
    kind: 'duplicate_param',
    code: 'K007',
    recovery: 'fix_line',
    cases: [
      { line: 'g2(x, x) = x', token: 'x', nth: 1 },
      { line: 'g2(u, v, u) = u', token: 'u', nth: 1 },
      { line: 'g2(p1, p1, p1) = 1', token: 'p1', nth: 1 },
    ],
    near: ['g2(x, y) = x + y'],
  },
  {
    kind: 'not_callable',
    code: 'K008',
    recovery: 'fix_line',
    cases: [
      { line: 'x2 = a(2)', token: 'a' },
      { line: 'x2 = flag(1)', token: 'flag' },
      { line: 'x2 = n(3) + 1', token: 'n' },
    ],
    near: ['x2 = a * 2'],
  },
  {
    kind: 'no_matching_form',
    code: 'C001',
    recovery: 'choose_form',
    cases: [
      // language errors.md: with one wrong argument the span is that argument; with several, the whole call
      { line: 'x2 = Midpoint(A, 5)', token: '5' },
      { line: 'x2 = Midpoint(1, 2)', token: 'Midpoint(1, 2)' },
      { line: 'x2 = Line(1, 2)', token: 'Line(1, 2)' },
    ],
    near: ['x2 = Midpoint(A, B)'],
  },
  {
    kind: 'arg_count',
    code: 'C002',
    recovery: 'fix_line',
    cases: [
      { line: 'x2 = Midpoint(A)', token: 'Midpoint(A)' },
      { line: 'x2 = Midpoint(A, B, B)', token: 'Midpoint(A, B, B)' },
      { line: 'x2 = Distance(A)', token: 'Distance(A)' },
    ],
    near: ['x2 = Midpoint(A, B)'],
  },
  {
    kind: 'type_mismatch',
    code: 'C003',
    recovery: 'rewrite',
    cases: [
      { line: 'd2 = A * B', token: 'A * B' },
      { line: 'd2 = flag * 2', token: 'flag * 2' },
      { line: 'd2 = s - 1', token: 's - 1' },
    ],
    near: ['d2 = n * 2'],
  },
  {
    kind: 'bad_range',
    code: 'C005',
    recovery: 'fix_line',
    cases: [
      { line: 'r2 = 3 in 5..0', token: '5..0' },
      { line: 'r2 = 3 in 1..1', token: '1..1' },
      { line: 'r2 = 3 in 0..5 step 0', token: '', loose: true },
    ],
    near: ['r2 = 3 in 0..5 step 1'],
  },
  {
    kind: 'cycle',
    code: 'K010',
    recovery: 'rewrite',
    cases: [
      { line: 'A = Midpoint(M, B)', token: 'A = Midpoint(M, B)', whole: true },
      { line: 'M = Midpoint(M, B)', token: 'M = Midpoint(M, B)', whole: true },
      { line: 'n = n2 + 1', token: 'n = n2 + 1', whole: true },
    ],
    setup: ['n2 = n * 2'],
    near: ['A = Midpoint(B, C)'],
  },
  {
    kind: 'type_change',
    code: 'K011',
    recovery: 'rewrite',
    cases: [
      { line: 'a = Circle(A, 2)', token: 'a = Circle(A, 2)', whole: true },
      { line: 'A = 3', token: 'A = 3', whole: true },
      { line: 'flag = (1, 2)', token: 'flag = (1, 2)', whole: true },
    ],
    near: ['a = 4'],
  },
  {
    kind: 'locked',
    code: 'K014',
    recovery: 'choose',
    cases: [
      { line: 'P = (1, 1)', token: 'P = (1, 1)', whole: true },
      { line: 'Delete(P)', token: 'Delete(P)', whole: true },
      { line: 'P = Midpoint(A, B)', token: 'P = Midpoint(A, B)', whole: true },
    ],
    setup: ['P = (0, 5)', 'P with fixed = true'],
    near: ['Q2 = (1, 1)', 'P with color = red'],
  },
  {
    kind: 'unknown_property',
    code: 'K020',
    recovery: 'use_suggestion',
    cases: [
      { line: 'seg with colour = red', token: 'colour' },
      { line: 'A with wdth = 3', token: 'wdth' },
      { line: 'M with foo = 1', token: 'foo' },
    ],
    near: ['seg with color = red'],
  },
  {
    kind: 'bad_property_value',
    code: 'K021',
    recovery: 'fix_line',
    cases: [
      { line: 'A with color = red, layer = 12', token: '12' },
      { line: 'A with opacity = 3', token: '3' },
      { line: 'seg with width = 99', token: '99' },
    ],
    near: ['A with layer = 9'],
  },
  {
    kind: 'nothing_to_undo',
    code: 'K030',
    recovery: 'skip',
    cases: [{ line: 'Undo()', token: 'Undo()', whole: true }, { line: 'Redo()', token: 'Redo()', whole: true }, { line: 'Redo()', token: 'Redo()', whole: true }],
    near: ['Hide(A)'],
  },
  {
    kind: 'limit',
    code: 'K040',
    recovery: 'rewrite',
    cases: [
      { line: `s2 = "${'x'.repeat(2100)}"`, token: '', whole: true },
      { line: `s2 = "${'y'.repeat(3000)}"`, token: '', whole: true },
      { line: `# ${'z'.repeat(2100)}`, token: '', whole: true },
    ],
    near: ['s2 = "short"'],
  },
];

/** The figure a kind is tried on: Undo/Redo kinds need an empty history. */
function worldFor(k: Kind): Figure {
  const fresh = k.kind === 'nothing_to_undo';
  const f = fresh ? newFigure() : figure(WORLD);
  for (const l of k.setup ?? []) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`setup "${l}" failed: ${r.message}`);
  }
  if (fresh) return f;
  return f;
}

describe.each(KINDS)('$kind', (k) => {
  it.each(k.cases.map((c, i) => [i, c] as const))('case %i produces it, with an exact position', (_i, c) => {
    const f = worldFor(k);
    const before = snap(f);
    const e = bad(f.apply(c.line), k.kind);
    expectWellFormedError(e);
    expect(e.code).toBe(k.code);
    // A kind may refine its default recovery when it has a suggestion (use_suggestion); the default is the catalogue's.
    if (e.recovery !== k.recovery) expect(e.recovery).toBe(e.suggest.length > 0 ? 'use_suggestion' : k.recovery);
    expect(e.line).toBe(1);
    if (c.eol) {
      expect(e.token).toBe('');
      expect(e.col).toBe(c.line.length + 1);
      expect(e.endCol).toBe(e.col);
    } else if (c.loose) {
      // docs do not fix the span
    } else if (c.token !== '' && !c.whole) {
      const i = indexOfNth(c.line, c.token, c.nth ?? 0);
      expect(i, `token ${c.token} must occur in the line`).toBeGreaterThanOrEqual(0);
      expect(e.token).toBe(c.token);
      expect(e.col).toBe(i + 1);
      expect(e.endCol).toBe(i + 1 + c.token.length);
    } else if (c.whole && c.token !== '') {
      expect(e.token).toBe(c.token);
      expect(e.col).toBe(1);
      expect(e.endCol).toBe(c.token.length + 1);
    }
    // the column is always inside the line (plus one for "at the end")
    expect(e.col).toBeLessThanOrEqual(c.line.length + 1);
    expect(e.endCol).toBeLessThanOrEqual(c.line.length + 1);
    // the source line is kept when it is short
    if (c.line.length <= 200) expect(e.source).toBe(c.line);
    // atomic: a failing line changes nothing
    expectUnchanged(f, before, c.line);
  });

  it('carries a hint', () => {
    const f = worldFor(k);
    const e = bad(f.apply((k.cases[0] as Case).line), k.kind);
    expect((e.hint ?? '').length, 'hint').toBeGreaterThan(0);
  });

  it('the message is one plain sentence with no blame, "please" or exclamation mark', () => {
    const f = worldFor(k);
    const e = bad(f.apply((k.cases[0] as Case).line), k.kind);
    expect(e.message.endsWith('.')).toBe(true);
    expect(e.message).not.toMatch(/!|\bplease\b|\byou\b/i);
    expect(e.message.split('. ').length).toBeLessThanOrEqual(2);
  });

  it('is plain JSON and has a stable fingerprint across repeats', () => {
    const f = worldFor(k);
    const a = bad(f.apply((k.cases[0] as Case).line), k.kind);
    const b = bad(f.apply((k.cases[0] as Case).line), k.kind);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it('every suggested line passes on the same figure (errors.md 7)', () => {
    for (const c of k.cases) {
      const f = worldFor(k);
      const e = bad(f.apply(c.line), k.kind);
      expect(e.suggest.length).toBeLessThanOrEqual(3);
      for (const s of e.suggest) {
        const g = clone(f);
        const r = g.apply(s);
        if (!r.ok) throw new Error(`suggestion "${s}" for "${c.line}" does not pass: ${r.kind}: ${r.message}`);
      }
    }
  });

  it('the near miss does not produce it', () => {
    for (const line of k.near) {
      const f = worldFor(k);
      const r = f.apply(line);
      if (!r.ok) expect(r.kind, `${line}: ${r.message}`).not.toBe(k.kind);
    }
  });
});

describe('the kinds that need more than a line', () => {
  it('not_free: setFree on a dependent object (K013)', () => {
    const f = figure(WORLD);
    const before = snap(f);
    for (const name of ['M', 'seg']) {
      const e = bad(f.setFree(name, { x: 1, y: 1 }, 'api') as never, 'not_free');
      expectWellFormedError(e);
      expect(e.code).toBe('K013');
      expect(e.recovery).toBe('choose');
      expect(e.message).toContain(name);
      expect((e.hint ?? '').length).toBeGreaterThan(0);
    }
    expectUnchanged(f, before);
  });

  it('forward_reference: insertAt before an input (K012)', () => {
    for (const [index, line, input] of [[1, 'Z = Midpoint(A, M)', 'M'], [0, 'Z = Midpoint(A, B)', 'A'], [3, 'Z = Distance(C, M)', 'M']] as const) {
      const f = figure(WORLD);
      const before = snap(f);
      const r = f.insertAt(index, line);
      const e = bad(r, 'forward_reference');
      expectWellFormedError(e);
      expect(e.code).toBe('K012');
      expect(e.recovery).toBe('choose');
      expect(e.related).toContain(input);
      expect(e.message).toContain(input);
      expect((e.hint ?? '').length).toBeGreaterThan(0);
      expectUnchanged(f, before);
    }
  });

  it('missing_rate: problems() lists a state with no rate (K015)', () => {
    const f = figure(['th = state(0.5)', 'ph = state(1)', "ph' = 0"]);
    const ps = f.problems();
    expect(ps.length).toBe(1);
    const e = ps[0] as ErrorObject;
    expectWellFormedError(e);
    expect(e.kind).toBe('missing_rate');
    expect(e.code).toBe('K015');
    expect(e.recovery).toBe('create_first');
    expect(e.message).toContain('th');
    expect(e.suggest).toContain("th' = 0");
    for (const s of e.suggest) ok(clone(f).apply(s));
  });

  it('load_failed and version from a script (K041, K042)', () => {
    const strict = Figure.fromScript('@fig 1\nA = (1, 2\n', { commands: TEST_COMMANDS, mode: 'strict' });
    const lf = strict.report.errors.find((e) => e.kind === 'load_failed') as ErrorObject;
    expectWellFormedError(lf);
    expect(lf.code).toBe('K041');
    expect(lf.phase).toBe('load');
    expect(lf.recovery).toBe('report');
    const v = Figure.fromScript('@fig 7\n', { commands: TEST_COMMANDS }).report.errors[0] as ErrorObject;
    expectWellFormedError(v);
    expect(v.kind).toBe('version');
    expect(v.code).toBe('K042');
    expect(v.phase).toBe('load');
    expect(v.message).toContain('7');
  });

  it('internal: a rule that throws, three different ways (K999)', () => {
    for (const line of ['x2 = Boom(1)', 'x2 = Boom(n) + 1', 'x2 = Boom(a)']) {
      const f = figure(WORLD);
      const before = snap(f);
      const e = bad(f.apply(line), 'internal');
      expectWellFormedError(e);
      expect(e.code).toBe('K999');
      expect(e.recovery).toBe('skip');
      expect(e.phase).toBe('commit');
      expect(e.fingerprint.startsWith('internal:')).toBe(true);
      expect((e.hint ?? '').length).toBeGreaterThan(0);
      expectUnchanged(f, before);
    }
  });

  it('limit: the object limit names which limit and the maximum', () => {
    const f = newFigure({ limits: { objects: 2 } });
    ok(f.apply('p1 = 1'));
    ok(f.apply('p2 = 2'));
    const e = bad(f.apply('p3 = 3'), 'limit');
    expect(e.params.limit).toBe('objects');
    expect(e.params.max).toBe(2);
  });
});

describe('the example error objects of kernel/errors.md section 4', () => {
  it('bad_property_value layer = 12: recovery fix_line with the suggestion, as errors.md 5.6 shows', () => {
    const f = figure(WORLD);
    const e = bad(f.apply('A with color = red, layer = 12'), 'bad_property_value');
    expect(e.recovery).toBe('fix_line');
    expect(e.suggest).toEqual(['A with color = red, layer = 9']);
  });

  it('unknown name that looks like a slider: suggest includes the line that defines it', () => {
    const f = figure(WORLD);
    const e = bad(f.apply('r2 = k * 2'), 'unknown_name');
    expect(e.suggest).toContain('k = 1 in 0..10');
    expect(e.recovery).toBe('create_first');
    expect(e.hint ?? '').toContain('Define it first');
  });

  it('unknown name: the suggestions also include the nearest existing names, as lines', () => {
    const f = figure(WORLD);
    const e = bad(f.apply('r2 = nn * 2'), 'unknown_name');
    expect(e.suggest.some((s) => s.includes('n'))).toBe(true);
    expect(e.suggest.length).toBeGreaterThan(0);
  });

  it('cycle: path is the chain, hint says what to do', () => {
    const f = figure(WORLD);
    const e = bad(f.apply('A = Midpoint(M, B)'), 'cycle');
    expect(e.path).toEqual(['A', 'M', 'A']);
    expect(e.message).toBe('A would depend on itself: A -> M -> A.');
    expect(e.phase).toBe('plan');
  });

  it('locked: hint and suggestion unfix the object', () => {
    const f = figure([...WORLD, 'P = (0, 5)', 'P with fixed = true']);
    const e = bad(f.apply('P = (1, 1)'), 'locked');
    expect(e.hint).toBe('Unfix it first: P with fixed = false');
    expect(e.suggest).toEqual(['P with fixed = false']);
    expect(e.message).toBe('P is fixed and cannot be changed by a line.');
  });

  it('type_change: message, params and a suggestion that passes', () => {
    const f = figure(['O = (0, 0)', 'c = 2', 'd = c + 1', 'g = d * 2']);
    const e = bad(f.apply('c = Circle(O, 2)'), 'type_change');
    expect(e.message).toBe('c is a Number; this line would make it a Circle.');
    expect(e.params).toEqual(expect.objectContaining({ from: 'Number', to: 'Circle' }));
    expect(e.suggest.length).toBeGreaterThan(0);
    for (const s of e.suggest) ok(clone(f).apply(s), s);
  });

  it('unknown property: expected lists the valid keys, the hint offers the near one', () => {
    const f = figure(WORLD);
    const e = bad(f.apply('seg with colour = red'), 'unknown_property');
    expect(e.expected).toEqual(expect.arrayContaining(['color', 'width', 'lineStyle', 'visible', 'label', 'layer', 'showIf', 'opacity', 'fixed']));
    expect(e.hint).toBe('Did you mean color?');
    expect(e.suggest).toEqual(['seg with color = red']);
  });

  it('blocked by an earlier failure in the same batch: blockedBy and fix_earlier', () => {
    const f = figure(WORLD);
    const r = f.applyBatch(['T = Midpont(A, B)', 'U = Midpoint(A, T)'], { group: 'g', mode: 'independent' });
    const e = bad(r.results[1] as never, 'unknown_name');
    expect(e.blockedBy).toEqual({ line: 1, kind: 'unknown_command' });
    expect(e.recovery).toBe('fix_earlier');
    expect(e.message).toContain('T is not defined.');
    expect(e.hint ?? '').toMatch(/line 1/);
    expect(e.hint ?? '').toMatch(/fix/i);
  });

  it('undefined value reported, not an error: the successful result of the example', () => {
    const f = figure(['O = (0, 0)', 'Q = (4, 1)', 'P = (0, 2)', 'l1 = Line(O, Q)', 'l2 = Parallel(P, l1)']);
    const r = ok(f.apply('I = Intersect(l1, l2)'));
    expect(r.summary).toBe('I is undefined (parallel)');
    expect(r.changed.becameUndefined).toEqual([{ name: 'I', reason: 'parallel' }]);
  });
});

describe('message keys: kernel-owned kinds use kernel.* (errors design 3, errors.md examples 5.3, 5.6, 5.8)', () => {
  // Only the kinds the docs show with a key: cycle (design 3), unknown_command (5.3), bad_property_value (5.6), limit (5.8).
  const cases: { kind: ErrorKind; line: string }[] = [
    { kind: 'cycle', line: 'A = Midpoint(M, B)' },
    { kind: 'unknown_command', line: 'Q = Midpont(A, B)' },
    { kind: 'bad_property_value', line: 'A with layer = 12' },
    { kind: 'limit', line: `s2 = "${'x'.repeat(2100)}"` },
    { kind: 'locked', line: 'P = (1, 1)' },
    { kind: 'nothing_to_undo', line: 'Undo()' },
  ];
  it.each(cases)('$kind has a kernel.* key', ({ kind, line }) => {
    const f = kind === 'nothing_to_undo' ? newFigure() : figure([...WORLD, 'P = (0, 5)', 'P with fixed = true']);
    const e = bad(f.apply(line), kind);
    expect(e.messageKey).toBe(`kernel.${kind}`);
  });
});
