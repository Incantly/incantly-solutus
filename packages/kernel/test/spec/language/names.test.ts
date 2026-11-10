import { describe, expect, it } from 'vitest';
import {
  BUILTIN_FUNCTIONS,
  T,
  listOf,
  EMPTY_COMMANDS,
  MAX_NAME_LENGTH,
  closestNames,
  createCommandTable,
  editDistance,
  nameProblem,
  reservedGroup,
  suggestName,
} from '@incantly/kernel';
import { COMMANDS, check, checked, emptyFig, expectAt, expectFixPasses, failure, form, newFig, p } from './helpers';

const table = createCommandTable(COMMANDS);

describe('language/design.md 3.7 reserved names', () => {
  it.each(['pi', 'tau', 'e', 'deg', 'inf', 'undefined'])('constant %s is reserved_name', (n) => {
    const e = failure(`${n} = 1`);
    expect(e.kind).toBe('reserved_name');
    expectAt(e, { col: 1, endCol: n.length + 1, token: n });
  });

  it.each(['true', 'false', 'and', 'or', 'not', 'xor', 'if', 'in', 'step', 'with'])('keyword %s is reserved_name', (n) => {
    expect(failure(`${n} = 1`).kind).toBe('reserved_name');
  });

  it.each(['t', 'x', 'y', 'z', 'bt', 'beat'])('variable %s is reserved_name', (n) => {
    expect(failure(`${n} = 1`).kind).toBe('reserved_name');
  });

  it.each(['xaxis', 'yaxis', 'zaxis'])('README 15 axis constant %s is reserved_name', (n) => {
    expect(failure(`${n} = 1`).kind).toBe('reserved_name');
  });

  it('3.7 every command name in the table is reserved', () => {
    for (const n of table.names()) {
      expect(failure(`${n} = 3`, newFig()).kind, n).toBe('reserved_name');
    }
  });

  it('3.7 every built-in function name is reserved', () => {
    const names = BUILTIN_FUNCTIONS.names();
    expect(names.length).toBeGreaterThan(60);
    for (const n of names) {
      expect(failure(`${n} = 3`).kind, n).toBe('reserved_name');
    }
  });

  it.each(['arg', 'conjugate', 'real', 'imaginary', 'polygamma', 'zeta', 'si', 'ci', 'ei'])(
    '3.14 name held back for a later function (%s) is reserved',
    (n) => {
      expect(failure(`${n} = 3`).kind).toBe('reserved_name');
    },
  );

  it('3.7 the refusal hint offers the nearest valid name (e becomes e_1)', () => {
    const e = failure('e = 2');
    expect(e.kind).toBe('reserved_name');
    expect(e.hint).toContain('e_1');
  });

  it('agent.md 5.2 x = P.x is refused with the fix px = P.x', () => {
    const fig = newFig();
    const e = failure('x = P.x', fig);
    expect(e.kind).toBe('reserved_name');
    expectAt(e, { col: 1, endCol: 2, token: 'x' });
    expect(e.fix).toBe('px = P.x');
    expectFixPasses(e, fig);
  });

  it('3.7 reservedGroup names the group of a reserved name', () => {
    const fns = BUILTIN_FUNCTIONS;
    expect(reservedGroup('Circle', table, fns)).toBe('command');
    expect(reservedGroup('sin', table, fns)).toBe('function');
    expect(reservedGroup('pi', table, fns)).toBe('constant');
    expect(reservedGroup('inf', table, fns)).toBe('constant');
    expect(reservedGroup('with', table, fns)).toBe('keyword');
    expect(reservedGroup('and', table, fns)).toBe('keyword');
    expect(reservedGroup('x', table, fns)).toBe('variable');
    expect(reservedGroup('t', table, fns)).toBe('variable');
    expect(reservedGroup('xaxis', table, fns)).toBe('axis');
    expect(reservedGroup('zeta', table, fns)).toBe('held back');
    expect(reservedGroup('ordinary', table, fns)).toBeUndefined();
    expect(reservedGroup('Pt', table, fns)).toBeUndefined();
    expect(reservedGroup('Circle', EMPTY_COMMANDS, fns)).toBeUndefined();
  });
});

describe('language/design.md 3.7 valid names', () => {
  it.each(['A', 'a', 'Ab', 'ab', 'P_1', 'P_12', 'P_{1,2}', 'Pt', 'Lens', 'θ', 'ω', 'α_1', 'Δ', 'x_1', 'aB_2'])('%s is a valid name', (n) => {
    const r = emptyFig().apply(`${n} = 1`);
    expect(r.ok, n).toBe(true);
    expect(nameProblem(n)).toBeUndefined();
  });

  it('3.7 case matters: a, A and Ab are different objects', () => {
    const fig = emptyFig();
    expect(fig.apply('a = 1').ok).toBe(true);
    expect(fig.apply('A = (0, 0)').ok).toBe(true);
    expect(fig.apply('Ab = 3').ok).toBe(true);
    expect(fig.lookup('a')?.type.k).toBe('Number');
    expect(fig.lookup('A')?.type.k).toBe('Point');
    expect(fig.lookup('Ab')?.type.k).toBe('Number');
    const e = failure('q = B', fig);
    expect(e.kind).toBe('unknown_name');
  });

  it('3.7 P_1 and P_{1} are the same name', () => {
    const fig = emptyFig();
    expect(fig.apply('P_1 = (1, 2)').ok).toBe(true);
    const c = checked('Q = P_{1}', fig);
    expect(c.type?.k).toBe('Point');
    expect(c.reads.length).toBe(1);
  });

  it('3.7 a name of exactly 32 characters is valid, 33 is bad_name', () => {
    expect(MAX_NAME_LENGTH).toBe(32);
    expect(emptyFig().apply(`${'a'.repeat(32)} = 1`).ok).toBe(true);
    const e = failure(`${'a'.repeat(33)} = 1`);
    expect(e.kind).toBe('bad_name');
  });

  it.each([
    ['trailing underscore', 'a_ = 1', 1],
    ['bare subscript marker', 'P_ = (1, 2)', 1],
    ['doubled underscore', 'a__b = 1', 1],
  ])('errors.md 4 bad_name: %s', (_n, src, col) => {
    const e = failure(src);
    expect(e.kind).toBe('bad_name');
    expect(e.col).toBe(col);
    expect(e.hint ?? '').not.toBe('');
  });

  it('[doc-question: errors.md 4 lists "leading digit" as bad_name, but 3.6 reads "1a" as 1 times a] 1a = 1', () => {
    expect(failure('1a = 1').kind).toBe('bad_name');
  });

  it('3.7 nameProblem returns the broken rule for invalid names', () => {
    for (const bad of ['', '1a', 'a_', 'a__b', 'P_', 'a b', "a'", 'a'.repeat(33), 'a-b', 'a.b']) {
      expect(nameProblem(bad), JSON.stringify(bad)).toEqual(expect.any(String));
      expect((nameProblem(bad) ?? '').length).toBeGreaterThan(0);
    }
  });

  it('3.2 names accept only Latin letters, Greek letters, digits and _: Cyrillic is bad_character', () => {
    // U+0430 CYRILLIC SMALL LETTER A looks like Latin a.
    const e = failure('\u0430rea = 1');
    expect(e.kind).toBe('bad_character');
    expectAt(e, { col: 1, endCol: 2, token: '\u0430' });
    expect(e.hint ?? '').toMatch(/Latin|a\b/i);
    expect(e.message).toContain('0430');
  });

  it('errors.md 2 bad_character: an emoji counts two UTF-16 columns', () => {
    const e = failure('a2 = \u{1F600}');
    expect(e.kind).toBe('bad_character');
    expectAt(e, { col: 6, endCol: 8, token: '\u{1F600}' });
  });

  it('errors.md 2 bad_character: a digit from another script, with a hint to use ASCII digits', () => {
    const e = failure('a2 = \u0663');
    expect(e.kind).toBe('bad_character');
    expect(e.col).toBe(6);
    expect(e.hint ?? '').toMatch(/ASCII|digit/i);
  });

  it('errors.md 2 bad_character: a control character', () => {
    const e = failure('a2 = 1\u0001');
    expect(e.kind).toBe('bad_character');
    expect(e.col).toBe(7);
  });

  it('3.7 Greek letters are letters: α, β, θ in names and a Greek letter in a subscript', () => {
    const fig = emptyFig();
    for (const l of ['α = 1', 'β = 2', 'θ = α + β', 'γ_1 = θ']) expect(fig.apply(l).ok, l).toBe(true);
    expect(fig.valueOf('θ')).toBe(3);
  });
});

describe('language/design.md 3.7 scope names and parameters', () => {
  it('3.7 function parameters may be x, y, t or any non-reserved name', () => {
    expect(check('h1(x) = x').ok).toBe(true);
    expect(check('h1(t) = t^2').ok).toBe(true);
    expect(check('h1(y) = y').ok).toBe(true);
    expect(check('h1(u1) = u1 + 1').ok).toBe(true);
    expect(check('h1(x, y, t) = x + y + t').ok).toBe(true);
  });

  it('3.7 parameters may not be reserved names', () => {
    expect(failure('h1(pi) = pi').kind).toBe('reserved_name');
    expect(failure('h1(sin) = 1').kind).toBe('reserved_name');
    expect(failure('h1(Circle) = 1').kind).toBe('reserved_name');
  });

  it('errors.md 4 duplicate_param points at the second x', () => {
    const e = failure('h1(x, x) = x');
    expect(e.kind).toBe('duplicate_param');
    expectAt(e, { col: 7, endCol: 8, token: 'x' });
  });

  it('3.7 a parameter that hides an object succeeds with a shadowed warning', () => {
    const r = check('h1(a) = a + 1'); // a is a Number in the figure
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notices.map((n) => n.kind)).toContain('shadowed');
  });

  it('3.7 a parameter that hides nothing gives no shadowed warning', () => {
    const r = check('h1(q1) = q1 + 1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notices.map((n) => n.kind)).not.toContain('shadowed');
  });

  it('3.7 inside the function the local meaning wins (the parameter is a Number even if the object is a Point)', () => {
    const c = checked('h1(A) = A + 1'); // A is a Point in the figure
    expect(c.type?.k).toBe('Function');
    expect(c.type?.ret).toBe('Number');
  });

  it('3.7 a binder is local to its command call', () => {
    const e = failure('out2 = k + 1');
    expect(e.kind).toBe('unknown_name');
  });

  it('3.7 limit: a function has at most 4 parameters', () => {
    expect(check('h1(a1, b1, c1, d1) = a1').ok).toBe(true);
    const e = failure('h1(a1, b1, c1, d1, e1) = a1');
    expect(e.kind).toBe('limit');
    expect(e.limit?.max).toBe(4);
    expect(e.limit?.got).toBe(5);
  });
});

describe('language/design.md 3.7 suggested names', () => {
  const none = new Set<string>();
  const seq = (type: string, n: number, opts?: Parameters<typeof suggestName>[2]): string[] => {
    const taken = new Set<string>();
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const s = suggestName(type, taken, opts);
      out.push(s);
      taken.add(s);
    }
    return out;
  };

  it('Point: A B C … Z, then A_1 B_1 …', () => {
    const names = seq('Point', 28);
    expect(names.slice(0, 5)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(names[25]).toBe('Z');
    expect(names[26]).toBe('A_1');
    expect(names[27]).toBe('B_1');
  });

  it('Vector: u v w, then u_1', () => {
    expect(seq('Vector', 4)).toEqual(['u', 'v', 'w', 'u_1']);
  });

  it.each(['Line', 'Ray', 'Segment'])('%s: l m n, then l_1', (t) => {
    expect(seq(t, 4)).toEqual(['l', 'm', 'n', 'l_1']);
  });

  it('Number: a b c d, then a_1', () => {
    expect(seq('Number', 5)).toEqual(['a', 'b', 'c', 'd', 'a_1']);
  });

  it('Number with the angle unit: α β γ δ, then α_1', () => {
    expect(seq('Number', 5, { unit: 'angle' })).toEqual(['α', 'β', 'γ', 'δ', 'α_1']);
  });

  it('Function: f g h p q r, then f_1', () => {
    expect(seq('Function', 7)).toEqual(['f', 'g', 'h', 'p', 'q', 'r', 'f_1']);
  });

  it.each(['Circle', 'Arc', 'Curve'])('%s: c d k, then c_1', (t) => {
    expect(seq(t, 4)).toEqual(['c', 'd', 'k', 'c_1']);
  });

  it('Polygon: poly1 poly2; Region: reg1 reg2', () => {
    expect(seq('Polygon', 2)).toEqual(['poly1', 'poly2']);
    expect(seq('Region', 2)).toEqual(['reg1', 'reg2']);
  });

  it('Text: text1 text2; Bool: cond1 cond2; Particles: fx1 fx2', () => {
    expect(seq('Text', 2)).toEqual(['text1', 'text2']);
    expect(seq('Bool', 2)).toEqual(['cond1', 'cond2']);
    expect(seq('Particles', 2)).toEqual(['fx1', 'fx2']);
  });

  it('List: L M N, then L_1', () => {
    expect(seq('List', 4)).toEqual(['L', 'M', 'N', 'L_1']);
    expect(suggestName(listOf(T.Number), new Set<string>())).toBe('L');
  });

  it('3.7 a type given as text with a parameter is understood too', () => {
    expect(suggestName('List<Number>', new Set<string>())).toBe('L');
    expect(suggestName('Function<Number>', new Set<string>())).toBe('f');
  });

  it('the first free name wins: a taken name is skipped', () => {
    expect(suggestName('Point', new Set(['A', 'B']))).toBe('C');
    expect(suggestName('Point', new Set(['B']))).toBe('A');
    expect(suggestName('Point', none)).toBe('A');
  });

  it('taken may be a predicate', () => {
    expect(suggestName('Point', (n) => n === 'A' || n === 'B')).toBe('C');
  });

  it('reserved names are skipped', () => {
    const cmds = createCommandTable([{ name: 'M', kind: 'object', group: 'x', forms: [form([p('a', 'Number')], 'Number')] }]);
    expect(suggestName('List', new Set(['L']), { commands: cmds })).toBe('N');
  });

  it('a name from the figure is never suggested (via the preview of an unnamed line)', () => {
    const fig = newFig(); // has a, b, A, B, C, P
    expect(suggestName('Number', new Set(fig.names()))).toBe('c');
    expect(suggestName('Point', new Set(fig.names()))).toBe('D');
  });
});

describe('language/errors.md 4 closest names', () => {
  it('editDistance counts a transposition as one edit', () => {
    expect(editDistance('ab', 'ba')).toBe(1);
    expect(editDistance('Circle', 'Cirlce')).toBe(1);
    expect(editDistance('a', 'a')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('abc', 'abd')).toBe(1);
  });

  it('closestNames: threshold is max(1, floor(len / 3)), case-insensitive, exact-ignoring-case first', () => {
    expect(closestNames('Cirlce', ['Circle', 'Ellipse', 'Segment'])).toEqual(['Circle']);
    expect(closestNames('circle', ['Cirle', 'Circle'])[0]).toBe('Circle');
    expect(closestNames('abc', ['abd', 'axy'])).toEqual(['abd']); // len 3: threshold 1
    expect(closestNames('abcdef', ['abcxyf'])).toEqual(['abcxyf']); // len 6: threshold 2
    expect(closestNames('abcdef', ['abxyzf'])).toEqual([]); // 3 edits
  });

  it('closestNames: at most k results', () => {
    const c = ['abd', 'abe', 'abf', 'abg', 'abh'];
    expect(closestNames('abc', c, 2).length).toBeLessThanOrEqual(2);
    expect(closestNames('abc', c).length).toBeLessThanOrEqual(3);
  });

  it('errors.md 4 unknown_name: the hint names the closest existing name', () => {
    const fig = emptyFig();
    fig.apply('radius = 5');
    const e = failure('q = radus', fig);
    expect(e.kind).toBe('unknown_name');
    expect(e.hint).toContain('radius');
  });

  it('errors.md 4 unknown_name: a name made of known names asks about a product', () => {
    const e = failure('p = ab');
    expect(e.hint).toMatch(/a \* b/);
  });

  it('errors.md 4 unknown_name: a never-made slider offers a quick fix with the two lines', () => {
    const e = failure('g1(x) = k*x');
    expect(e.kind).toBe('unknown_name');
    expectAt(e, { col: 9, endCol: 10, token: 'k' });
    const qf = e.quickFixes?.[0];
    expect(qf?.lines).toEqual(['k = 1 in -5..5 step 0.1', 'g1(x) = k*x']);
  });
});
