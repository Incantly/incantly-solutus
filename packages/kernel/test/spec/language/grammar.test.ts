import { describe, expect, it } from 'vitest';
import { analyseLine, parseLine, parseProgram, preview } from '@incantly/kernel';
import type { LineNode } from '@incantly/kernel';
import { bool, check, checked, emptyFig, errOf, expectAt, expectFixPasses, failure, newFig, num, okValue, undefinedReason } from './helpers';

function node(src: string): LineNode {
  return okValue(parseLine(src)).node;
}

describe('language/design.md 3.4 line kinds', () => {
  it('3.19 an empty line and a comment-only line are no-ops', () => {
    expect(node('').k).toBe('noop');
    expect(node('   ').k).toBe('noop');
    expect(node('# the right angle').k).toBe('noop');
    expect(node('\t# indented comment').k).toBe('noop');
  });

  it('3.19 a no-op checks to op "noop" and changes nothing', () => {
    const fig = newFig();
    const before = fig.names().length;
    const c = checked('# nothing', fig);
    expect(c.op).toBe('noop');
    expect(fig.names().length).toBe(before);
  });

  it('core 3 "Starts with": # comment, @ directive', () => {
    expect(node('@view -5 5 -3 3').k).toBe('directive');
    expect(node('@grid on').k).toBe('directive');
    expect(node('@axes off').k).toBe('directive');
    expect(node('@clock 0..30').k).toBe('directive');
    expect(node('@beat intro "Title"').k).toBe('directive');
    const n = node('@view -5 5 -3 3');
    if (n.k === 'directive') expect(n.name).toBe('view');
  });

  it('3.4 define: Name = expr', () => {
    const n = node('A = (1, 2)');
    expect(n.k).toBe('define');
    if (n.k === 'define') expect(n.target.name).toBe('A');
  });

  it('3.4 define with a trailing comment', () => {
    expect(node('A = (1, 2) # the first point').k).toBe('define');
  });

  it('3.4 function: one or more parameters', () => {
    const one = node('f(x) = x^2 - 2');
    expect(one.k).toBe('function');
    if (one.k === 'function') {
      expect(one.target.name).toBe('f');
      expect(one.params.map((q) => q.name)).toEqual(['x']);
    }
    const two = node('g(x, y) = x*y');
    expect(two.k).toBe('function');
    if (two.k === 'function') expect(two.params.map((q) => q.name)).toEqual(['x', 'y']);
  });

  it('3.4 defmany: several outputs from a command', () => {
    const n = node('A, B = Intersect(c, d)');
    expect(n.k).toBe('defmany');
    if (n.k === 'defmany') expect(n.targets.map((t) => t.name)).toEqual(['A', 'B']);
  });

  it('3.4 rate: Name = rate of a state', () => {
    const n = node("v' = -g");
    expect(n.k).toBe('rate');
    if (n.k === 'rate') expect(n.target.name).toBe('v');
  });

  it('3.4 restyle: Name with prop = value', () => {
    const n = node('A with color = red');
    expect(n.k).toBe('restyle');
    if (n.k === 'restyle') {
      expect(n.target.name).toBe('A');
      expect(n.style.map((s) => s.key)).toEqual(['color']);
    }
    const many = node('A with color = red, width = 3');
    if (many.k === 'restyle') expect(many.style.map((s) => s.key)).toEqual(['color', 'width']);
  });

  it('3.4 rerange: Name in lo..hi changes a range only', () => {
    expect(node('a in 0..20').k).toBe('rerange');
    expect(node('a in 0..20 step 2').k).toBe('rerange');
  });

  it('3.4 action: Command(args) with no result', () => {
    const n = node('Hide(A)');
    expect(n.k).toBe('action');
  });

  it('3.4 define with a range makes a slider and keeps its step', () => {
    const n = node('a = 3 in 0..10 step 0.5');
    expect(n.k).toBe('define');
    if (n.k === 'define') {
      expect(n.range).toBeDefined();
      expect(n.range?.step).toBeDefined();
    }
  });

  it('3.4 define and function may end with a style clause', () => {
    const d = node('P = (1, 2) with color = red, pointSize = 4');
    if (d.k === 'define') expect(d.style?.map((s) => s.key)).toEqual(['color', 'pointSize']);
    else expect(d.k).toBe('define');
    const f = node('f(x) = x^2 with color = blue');
    if (f.k === 'function') expect(f.style?.map((s) => s.key)).toEqual(['color']);
    else expect(f.k).toBe('function');
  });

  it('1.2 the teacher example: six good lines and one wrong line that fails at the colon', () => {
    const fig = emptyFig();
    const lines = [
      'A = (1, 2)',
      'B = (4, 6)',
      'm = (B.y - A.y) / (B.x - A.x)',
      'f(x) = m * (x - A.x) + A.y',
      'a = 3 in 0..10 step 0.5',
    ];
    for (const l of lines) expect(fig.apply(l).ok, l).toBe(true);
    const bad = errOf(fig.apply('c: x^2 + y^2 = 4'));
    expect(bad.kind).toBe('syntax');
    expectAt(bad, { col: 2, endCol: 3, token: ':' });
    // The earlier lines stay.
    expect(fig.lookup('f')).toBeDefined();
    expect(fig.lookup('a')).toBeDefined();
  });
});

describe('language/design.md 1.2 and rulings.md Q1', () => {
  it('rulings.md Q1: "f(x) = m (x - A.x) + A.y" is not_callable, because implicit multiplication follows only a number literal', () => {
    const fig = emptyFig();
    for (const l of ['A = (1, 2)', 'B = (4, 6)', 'm = (B.y - A.y) / (B.x - A.x)']) expect(fig.apply(l).ok).toBe(true);
    const e = errOf(fig.apply('f(x) = m (x - A.x) + A.y'));
    expect(e.kind).toBe('not_callable');
    expectAt(e, { col: 8, endCol: 9, token: 'm' });
    expect(e.fix).toContain('m * (x - A.x)');
    expect(e.hint ?? '').toMatch(/\*/); // the hint says to write the product with *
    expectFixPasses(e, fig);
  });

  it('rulings.md Q1: the same line with an explicit * is a good line', () => {
    const fig = emptyFig();
    for (const l of ['A = (1, 2)', 'B = (4, 6)', 'm = (B.y - A.y) / (B.x - A.x)']) expect(fig.apply(l).ok).toBe(true);
    expect(fig.apply('f(x) = m * (x - A.x) + A.y').ok).toBe(true);
  });

  it('rulings.md Q1: a name followed by ( is a call; a Number name there is not_callable, with and without a space', () => {
    expect(failure('out = a (2)').kind).toBe('not_callable');
    expect(failure('out = a(2)').kind).toBe('not_callable');
    expect(num('3 (a + 1)')).toBe(12); // after a number literal it stays a product
  });
});

describe('language/design.md 3.5 operators, precedence, associativity', () => {
  it.each([
    ['1 + 2 * 3', 7],
    ['(1 + 2) * 3', 9],
    ['10 - 2 + 3', 11],
    ['2 - 3 - 4', -5],
    ['100 / 10 / 2', 5],
    ['2 * 3 / 4', 1.5],
    ['2 + 3 * 4 - 5', 9],
    ['2 * (3 + 4) * 5', 70],
    ['7 - (2 - 1)', 6],
  ])('3.5 levels 5 and 6: %s = %d', (src, v) => {
    expect(num(src)).toBeCloseTo(v, 12);
  });

  it.each([
    ['2 ^ 3 ^ 2', 512], // right associative: 2^(3^2)
    ['2 ^ 3', 8],
    ['-2 ^ 2', -4], // unary minus is below ^
    ['(-2) ^ 2', 4],
    ['2 ^ -1', 0.5], // a sign right after ^
    ['2 ^ -2', 0.25],
    ['2 ^ -2 ^ 2', 0.0625], // 2^(-(2^2))
    ['-2 ^ 2 + 10', 6],
    ['2 ^ 3!', 64], // postfix ! binds tighter than ^
    ['-3!', -6], // -x! is -(x!)
    ['4 ^ 0.5', 2],
  ])('3.5 level 2 and 4: %s = %d', (src, v) => {
    expect(num(src)).toBeCloseTo(v, 12);
  });

  it('3.5 unary minus: -x^2 is -(x^2) for a name', () => {
    expect(num('-a^2')).toBe(-9);
    expect(num('2^-a')).toBeCloseTo(0.125, 12);
    expect(num('-a!')).toBe(-6);
  });

  it('3.5 level 1: factorial and degree are postfix', () => {
    expect(num('3!')).toBe(6);
    expect(num('(a)!')).toBe(6);
    expect(num('a!')).toBe(6);
    expect(num('0!')).toBe(1);
    expect(num('(1 + 2)!')).toBe(6);
    expect(num('3!!')).toBe(720); // (3!)!
  });

  it.each([
    ['30°', Math.PI / 6],
    ['30 deg', Math.PI / 6],
    ['30deg', Math.PI / 6],
    ['(30 + 60)°', Math.PI / 2],
    ['(a * 10)°', Math.PI / 6],
    ['90°', Math.PI / 2],
    ['180°', Math.PI],
    ['0.5°', Math.PI / 360],
  ])('3.5 degree: %s', (src, v) => {
    expect(num(src)).toBeCloseTo(v, 12);
  });

  it('3.5 degree: sin(30°) is 0.5 and angles are radians', () => {
    expect(num('sin(30°)')).toBeCloseTo(0.5, 12);
    expect(num('cos(60 deg)')).toBeCloseTo(0.5, 12);
    expect(num('todeg(pi)')).toBeCloseTo(180, 12);
  });

  it.each([
    ['true or false and false', true], // and binds tighter than or
    ['(true or false) and false', false],
    ['true or true xor true', true], // xor binds tighter than or: true or (true xor true)
    ['true xor false and false', true], // and tighter than xor: true xor (false and false)
    ['not true and false', false], // not binds tighter than and
    ['not (true and false)', true],
    ['not 1 < 2', false], // not is looser than comparison: not (1 < 2)
    ['1 < 2 and 3 < 4', true],
    ['1 < 2 and 3 > 4', false],
    ['1 + 1 == 2 and 2 * 2 == 4', true],
    ['false or false or true', true],
    ['true xor true xor true', true],
  ])('3.5 levels 7 to 11: %s is %s', (src, v) => {
    expect(bool(src)).toBe(v);
  });

  it.each([
    ['0 < 3 <= 5', true],
    ['0 < 5 <= 5', true],
    ['0 < 6 <= 5', false],
    ['0 <= 0 < 1', true],
    ['0 < 0 < 1', false],
    ['5 > 3 >= 3', true],
    ['5 > 3 > 3', false],
    ['1 <= 2 < 3 <= 4', true],
    ['1 <= 2 < 2 <= 4', false],
  ])('3.5 chains: %s is %s', (src, v) => {
    expect(bool(src)).toBe(v);
  });

  it('3.5 a chain evaluates each middle operand once', () => {
    // 0 < f(2) < 5 with f(x) = x^2 is a single read of the middle operand; the result is the same either way,
    // but the chain must still type-check as one relation.
    expect(bool('0 < f(2) <= 4')).toBe(true);
  });

  it.each([
    ['1 < 5 > 0', 'b = 1 < 5 > 0', 11, 12, '>'],
    ['1 > 5 < 9', 'b = 1 > 5 < 9', 11, 12, '<'],
    ['a == b == a', 'b2 = a == b == a', 13, 15, '=='],
    ['1 == 1 == 1', 'b = 1 == 1 == 1', 12, 14, '=='],
  ])('3.5 chained_comparison: %s', (_n, src, col, endCol, token) => {
    const e = failure(src);
    expect(e.kind).toBe('chained_comparison');
    expectAt(e, { col, endCol, token });
    expect(e.hint ?? '').toMatch(/\band\b/);
  });

  it('3.5 != is never chained', () => {
    const e = failure('b = 1 != 2 != 3');
    expect(e.kind).toBe('chained_comparison');
    expect(e.token).toBe('!=');
    // The doc does not say which "!=" is reported; both the first (col 7) and the second (col 12) are reasonable.
    expect([7, 12]).toContain(e.col);
    expect(e.endCol).toBe(e.col + 2);
  });

  it('3.5 numeric equality uses a relative tolerance of 1e-12', () => {
    expect(bool('0.1 + 0.2 == 0.3')).toBe(true);
    expect(bool('0.1 + 0.2 != 0.3')).toBe(false);
    expect(bool('1e20 == 1e20 + 1e5')).toBe(true); // |diff| = 1e5 <= 1e-12 * 1e20
    expect(bool('1 == 1.0000001')).toBe(false);
    expect(bool('1e-13 == 0')).toBe(true); // |diff| <= 1e-12 * max(1, ...)
    expect(bool('1e-10 == 0')).toBe(false);
  });

  it('3.5 points and vectors compare per coordinate with the same tolerance', () => {
    expect(bool('(0.1 + 0.2, 1) == (0.3, 1)')).toBe(true);
    expect(bool('(0.1 + 0.2, 1) == (0.31, 1)')).toBe(false);
    expect(bool('A == A')).toBe(true);
    expect(bool('A != B')).toBe(true);
    expect(bool('u == u')).toBe(true);
  });

  it('3.5 text and Bool compare exactly', () => {
    expect(bool('"a" == "a"')).toBe(true);
    expect(bool('"a" == "b"')).toBe(false);
    expect(bool('"a" != "b"')).toBe(true);
    expect(bool('true == true')).toBe(true);
    expect(bool('true != false')).toBe(true);
  });

  it('3.5 comparing different types is type_mismatch', () => {
    const e = failure('r = 1 == "a"');
    expect(e.kind).toBe('type_mismatch');
    const e2 = failure('r = A == u');
    expect(e2.kind).toBe('type_mismatch');
    expect(failure('r = true == 1').kind).toBe('type_mismatch');
  });

  it('3.5 logic on undefined Bools: false and undefined is false; true or undefined is true', () => {
    const ub = '(sqrt(-1) > 0)'; // an undefined Bool
    expect(bool(`${ub} and false`)).toBe(false);
    expect(bool(`false and ${ub}`)).toBe(false);
    expect(bool(`${ub} or true`)).toBe(true);
    expect(bool(`true or ${ub}`)).toBe(true);
    expect(bool(`${ub} and true`)).toBeUndefined();
    expect(bool(`${ub} or false`)).toBeUndefined();
    expect(bool(`not ${ub}`)).toBeUndefined();
    expect(bool(`${ub} xor true`)).toBeUndefined();
  });

  it('rulings.md Q3: the literal undefined is a Number, so "undefined and false" is type_mismatch', () => {
    const e = failure('out = undefined and false');
    expect(e.kind).toBe('type_mismatch');
    expect(e.left).toBe('Number');
    expect(e.right).toBe('Bool');
  });

  it('rulings.md Q3: "undefined or true", "not undefined" and "true and undefined" are type_mismatch too', () => {
    expect(failure('out = undefined or true').kind).toBe('type_mismatch');
    expect(failure('out = true and undefined').kind).toBe('type_mismatch');
    expect(failure('out = not undefined').kind).toBe('type_mismatch');
  });

  it('3.5 / 8 a comparison with an undefined operand is undefined, never false', () => {
    expect(bool('sqrt(-1) < 1')).toBeUndefined();
    expect(bool('1 < sqrt(-1)')).toBeUndefined();
    expect(bool('sqrt(-1) == sqrt(-1)')).toBeUndefined();
    expect(bool('undefined == 1')).toBeUndefined();
    expect(bool('(sqrt(-1) > 0) or true')).toBe(true);
    expect(bool('(sqrt(-1) > 0) and false')).toBe(false);
    expect(bool('not (sqrt(-1) > 0)')).toBeUndefined();
  });
});

describe('language/design.md 3.6 implicit multiplication, exactly', () => {
  it.each([
    ['2a', 6],
    ['0.5 a', 1.5],
    ['3(a + 1)', 12],
    ['3 (a + 1)', 12],
    ['2a^2', 18], // 2*(a^2)
    ['2 pi', 2 * Math.PI],
    ['3 pi', 3 * Math.PI],
    ['2 deg', (2 * Math.PI) / 180],
    ['2deg', (2 * Math.PI) / 180],
    ['3 sqrt(4)', 6],
    ['2sqrt(9)', 6],
    ['2sin(pi/6)^2', 0.5], // 2*(sin(pi/6)^2) = 0.5, not (2 sin)^2 = 1
    ['2 sin(pi/6)', 1],
    ['2 A.x', 2],
    ['2 B.y', 12],
    ['.5a', 1.5],
    ['1_000a', 3000],
    ['2e3', 2000], // an exponent only when digits follow
    ['1.5e2', 150],
    ['1e-2', 0.01],
    ['2 e', 2 * Math.E], // "2e" is 2 times e
    ['2e', 2 * Math.E],
    ['1_000', 1000],
    ['.5', 0.5],
  ])('3.6 implicit after a number literal: %s', (src, v) => {
    expect(num(src)).toBeCloseTo(v, 10);
  });

  it('3.6 a number literal before a command call is allowed (the one exception)', () => {
    const c = checked('d = 2 Distance(A, B)');
    expect(c.type?.k).toBe('Number');
  });

  it('3.6 numbers times a vector command', () => {
    const c = checked('v2 = 2 Vector(A)');
    expect(c.type?.k).toBe('Vector');
  });

  it('3.6 between two names: missing_operator with fix inserting *', () => {
    const fig = newFig();
    const e = failure('out = a b', fig);
    expect(e.kind).toBe('missing_operator');
    expect(e.fix).toBe('out = a * b');
    expect(e.hint ?? '').not.toBe('');
    expectFixPasses(e, fig);
  });

  it('3.6 between two number literals: missing_operator', () => {
    const e = failure('out = 2 3');
    expect(e.kind).toBe('missing_operator');
    expect(e.fix).toBe('out = 2 * 3');
  });

  it('3.6 between ")" and a name or "(": missing_operator', () => {
    expect(failure('out = (a) b').kind).toBe('missing_operator');
    expect(failure('out = (a)(b)').kind).toBe('missing_operator');
  });

  it('rulings.md Q2: (1/2)x is not allowed; ")" followed by a name is missing_operator', () => {
    for (const src of ['out = (1/2) a', 'out = (1/2)a']) {
      const e = failure(src);
      expect(e.kind, src).toBe('missing_operator');
      expect(e.phase, src).toBe('parse');
    }
  });

  it('rulings.md Q2: the quick fix for (1/2)x is (1/2) * x, never (1/2) x', () => {
    const fig = newFig();
    const e = failure('out = (1/2) a', fig);
    expect(e.fix).toBe('out = (1/2) * a');
    expectFixPasses(e, fig);
    expect(num('(1/2) * a')).toBe(1.5);
    const amb = failure('h = 1/2a', fig);
    const lines = (amb.quickFixes ?? []).flatMap((q) => q.lines);
    expect(lines).toContain('h = (1/2) * a');
    expect(lines).toContain('h = 1/(2a)');
    expect(lines).not.toContain('h = (1/2) a');
    expect(lines.join('\n')).not.toMatch(/\) a\b/);
  });

  it('3.6 "ab" is one name, so an unknown "ab" with a and b known is unknown_name (not a product)', () => {
    const fig = newFig();
    const e = failure('p = ab', fig);
    expect(e.kind).toBe('unknown_name');
    expectAt(e, { col: 5, endCol: 7, token: 'ab' });
    expect(e.hint).toContain('a * b');
    expect(e.fix).toBe('p = a * b');
    expectFixPasses(e, fig);
  });

  it('3.6 a number literal followed by x( is a call on the free variable and an error, never a product', () => {
    const e = failure('h(x) = 2x(3)');
    expect(e.kind).toBe('not_callable');
  });

  it.each([
    ['h = 1/2a', 7, 9, '2a'],
    ['h = a/2b', 7, 9, '2b'],
    ['h = 1/2 pi', 7, 11, '2 pi'],
    ['h = 6/2(3)', 7, 11, '2(3)'],
  ])('3.5/3.6 ambiguous_implicit after "/": %s', (src, col, endCol, token) => {
    const e = failure(src);
    expect(e.kind).toBe('ambiguous_implicit');
    expectAt(e, { col, endCol, token });
    expect(e.fix).toBeUndefined(); // two readings, so no single fix
    expect(e.quickFixes?.length).toBe(2);
  });

  it('errors.md 3 ambiguous_implicit (rulings.md Q2): quickFixes offer (1/2) * a and 1/(2a)', () => {
    const e = failure('h = 1/2a');
    const lines = (e.quickFixes ?? []).flatMap((q) => q.lines);
    expect(lines).toContain('h = (1/2) * a');
    expect(lines).toContain('h = 1/(2a)');
  });

  it('3.5 brackets after "/" are fine', () => {
    expect(num('1/(2a)')).toBeCloseTo(1 / 6, 12);
    expect(num('1/2 * a')).toBe(1.5);
    expect(num('a/2*b')).toBe(6);
    expect(num('6/2')).toBe(3);
    expect(num('a/(2b)')).toBeCloseTo(3 / 8, 12);
  });
});

describe('language/design.md 3.2 normalisation', () => {
  it.each([
    ['5 − 3', 2], // minus sign
    ['5 – 3', 2], // en dash
    ['4 × 5', 20],
    ['4 · 5', 20],
    ['4 ⋅ 5', 20],
    ['4 ∙ 5', 20],
    ['8 ÷ 2', 4],
    ['2π', 2 * Math.PI],
    ['π', Math.PI],
    ['τ', 2 * Math.PI],
    ['a²', 9],
    ['a³', 27],
    ['a⁴', 81],
    ['a⁵', 243],
    ['a⁶', 729],
    ['a⁷', 2187],
    ['a⁸', 6561],
    ['a⁹', 19683],
    ['a⁻¹', 1 / 3],
    ['√4', 2],
    ['√(a + 1)', 2],
    ['√a', Math.sqrt(3)],
    ['1\u00a0+\u00a02', 3], // NBSP is a space
    ['1\t+\t2', 3], // tab is a space
  ])('3.2 %s', (src, v) => {
    expect(num(src)).toBeCloseTo(v, 12);
  });

  it('3.2 ≤ ≥ ≠ ∧ ∨ ¬ become <= >= != and or not', () => {
    expect(bool('3 ≤ 4')).toBe(true);
    expect(bool('4 ≥ 4')).toBe(true);
    expect(bool('3 ≠ 4')).toBe(true);
    expect(bool('true ∧ false')).toBe(false);
    expect(bool('true ∨ false')).toBe(true);
    expect(bool('¬true')).toBe(false);
  });

  it('3.2 ∞ becomes inf', () => {
    expect(bool('∞ > 1e300')).toBe(true);
    expect(bool('-∞ < 0')).toBe(true);
  });

  it('3.2 smart quotes become straight quotes', () => {
    const fig = newFig();
    const r = fig.apply('tx = \u201chello\u201d');
    expect(r.ok).toBe(true);
    expect(fig.valueOf('tx')).toBe('hello');
  });

  it('3.2 CRLF line endings are accepted by parseProgram', () => {
    const rs = parseProgram('A1 = (1, 2)\r\nB1 = (3, 4)\r\n');
    const lines = rs.filter((r) => r.result.ok && r.result.value.node.k !== 'noop');
    expect(lines.length).toBe(2);
  });

  it('3.2 superscript digits apply to the previous primary only', () => {
    expect(num('(a + 1)²')).toBe(16);
    expect(num('2a²')).toBe(18);
  });

  it('3.2 the input bar spellings <> => ** are not accepted by the kernel', () => {
    expect(check('b = 1 <> 2').ok).toBe(false);
    expect(check('b = 2 ** 3').ok).toBe(false);
  });

  it('3.2 columns point at the text as typed, after normalisation', () => {
    // "−" (U+2212) and "×" are single UTF-16 units; the error must still point at the right column.
    const e = failure('out = 5 − 3 × $');
    expect(e.kind).toBe('bad_character');
    expectAt(e, { col: 15, endCol: 16, token: '$' });
  });

  it('3.2 a normalised token is reported as typed', () => {
    const e = failure('b = 1 ≤ 5 ≥ 0');
    expect(e.kind).toBe('chained_comparison');
    expect(e.token).toBe('≥');
    expectAt(e, { col: 11, endCol: 12 });
  });
});

describe('language/design.md 3.3 tokens and comments', () => {
  it('3.3 # starts a comment outside strings and may follow a line', () => {
    expect(num('1 + 2 # three')).toBe(3);
    const fig = newFig();
    fig.apply('memo = "a#b"');
    expect(fig.valueOf('memo')).toBe('a#b');
  });

  it('3.3 a number: digits [. digits] [e [+-] digits], or . digits, with _ between digits', () => {
    expect(num('12')).toBe(12);
    expect(num('12.5')).toBe(12.5);
    expect(num('1e3')).toBe(1000);
    expect(num('1E3')).toBe(1000);
    expect(num('1e+3')).toBe(1000);
    expect(num('1e-3')).toBeCloseTo(0.001, 15);
    expect(num('.25')).toBe(0.25);
    expect(num('1_000_000')).toBe(1e6);
  });

  it('3.3 "1..5" is 1, "..", 5: a range inside a list', () => {
    const fig = newFig();
    fig.apply('R = [1..5]');
    expect(Array.from(fig.valueOf('R') as ArrayLike<number>)).toEqual([1, 2, 3, 4, 5]);
  });

  it('3.3 text escapes \\" \\\\ \\n \\{ \\}', () => {
    const fig = newFig();
    expect(fig.apply('t1 = "a\\"b"').ok).toBe(true);
    expect(fig.valueOf('t1')).toBe('a"b');
    expect(fig.apply('tx2 = "a\\\\b"').ok).toBe(true);
    expect(fig.valueOf('tx2')).toBe('a\\b');
    expect(fig.apply('t3 = "a\\nb"').ok).toBe(true);
    expect(fig.valueOf('t3')).toBe('a\nb');
    expect(fig.apply('t4 = "\\{a\\}"').ok).toBe(true);
    expect(fig.valueOf('t4')).toBe('{a}');
  });

  it('3.10 rule 10 text interpolation {expr} and {expr:fmt}', () => {
    const fig = newFig();
    fig.apply('r = 3.14159');
    expect(fig.apply('tx = "r = {r:2}"').ok).toBe(true);
    expect(fig.valueOf('tx')).toBe('r = 3.14');
    expect(fig.apply('t5 = "n = {a}"').ok).toBe(true);
    expect(fig.valueOf('t5')).toBe('n = 3');
    expect(fig.apply('t6 = "{r:.3}"').ok).toBe(true);
    expect(fig.valueOf('t6')).toBe('3.14');
    expect(fig.apply('t7 = "{flag}"').ok).toBe(true);
    expect(fig.valueOf('t7')).toBe('true');
    expect(fig.apply('t8 = "{m}!"').ok).toBe(true);
    expect(fig.valueOf('t8')).toBe('hi!');
  });

  it('3.10 rule 10 interpolation accepts Number, Bool, Text, Point, Vector only', () => {
    expect(check('tx = "{A}"').ok).toBe(true);
    expect(check('tx = "{u}"').ok).toBe(true);
    const e = failure('tx = "{s}"'); // a Segment
    expect(e.kind).toBe('type_mismatch');
  });

  it('3.10 rule 10 an unknown format is bad_format and lists the formats', () => {
    const e = failure('tx = "{a:q}"');
    expect(e.kind).toBe('bad_format');
    for (const f of ['2', '.3', 'd', 'f', '%']) expect(e.expected).toContain(f);
  });

  it('3.10 formats d (degrees from radians) and %', () => {
    const fig = newFig();
    fig.apply('h = 1.5707963267948966');
    fig.apply('tx = "{h:d}"');
    expect(String(fig.valueOf('tx'))).toMatch(/^90/);
    fig.apply('q = 0.25');
    fig.apply('tx2 = "{q:%}"');
    expect(String(fig.valueOf('tx2'))).toMatch(/^25/);
  });

  it('3.1 a text with an interpolation depends on the object it reads', () => {
    const c = checked('tx = "a = {a}"');
    expect(c.reads.length).toBe(1);
    expect(c.free).toBe(false);
  });
});

describe('language/design.md 3.4 / README 17: continuation lines', () => {
  it('a call may run over several lines while a bracket is open', () => {
    const rs = parseProgram('P = (1,\n 2)\nQ = (3, 4)');
    expect(rs.length).toBe(2);
    expect(rs[0]?.line).toBe(1);
    expect(rs[1]?.line).toBe(3);
    expect(rs.every((r) => r.result.ok)).toBe(true);
  });

  it('a command call across three physical lines is one logical line', () => {
    const rs = parseProgram('c = Circle(\n  A,\n  2\n)\nd = 1');
    expect(rs.length).toBe(2);
    expect(rs[1]?.line).toBe(5);
    const first = rs[0]?.result;
    expect(first?.ok).toBe(true);
  });

  it('a list may run over several lines', () => {
    const rs = parseProgram('L2 = [1,\n 2,\n 3]');
    expect(rs.length).toBe(1);
    expect(rs[0]?.result.ok).toBe(true);
  });

  it('parseLine takes a multi-line logical line', () => {
    const r = parseLine('P = (1,\n 2)');
    expect(r.ok).toBe(true);
  });

  it('blank lines and comments between statements are no-ops and keep numbering', () => {
    const rs = parseProgram('A1 = 1\n\n# note\nB1 = 2');
    const real = rs.filter((r) => r.result.ok && r.result.value.node.k === 'define');
    expect(real.map((r) => r.line)).toEqual([1, 4]);
  });

  it('an error on a later physical line of a continued call reports that physical line', () => {
    const rs = parseProgram('c = Circle(A,\n  $)');
    const first = rs[0]?.result;
    expect(first?.ok).toBe(false);
    if (first && !first.ok) {
      expect(first.line).toBe(2);
      expect(first.col).toBe(3);
    }
  });

  it('brackets inside strings and comments are not counted', () => {
    const rs = parseProgram('tx = "(" # (\nu1 = 1');
    expect(rs.length).toBe(2);
    expect(rs[0]?.result.ok).toBe(true);
  });

  it('input that ends with a bracket still open is unbalanced, pointing at the opener', () => {
    const e = errOf(parseLine('A = (1, 2'));
    expect(e.kind).toBe('unbalanced');
    expectAt(e, { col: 5, endCol: 6, token: '(' });
    expect(e.fix).toBe('A = (1, 2)');
  });
});

describe('language/design.md 3.4 ranges, sliders and rate rules', () => {
  it('3.8 a = 3 in 0..10 step 0.5 makes a slider with a range', () => {
    const c = checked('s1 = 3 in 0..10 step 0.5');
    expect(c.op).toBe('add');
    expect(c.type?.k).toBe('Number');
    expect(c.range?.min).toBe(0);
    expect(c.range?.max).toBe(10);
    expect(c.range?.stepValue).toBe(0.5);
    expect(c.free).toBe(true);
  });

  it('3.4 the range clause accepts expressions', () => {
    const c = checked('s1 = 3 in 0..tau step 0.01');
    expect(c.range?.max).toBeCloseTo(2 * Math.PI, 12);
    const c2 = checked('s2 = 3 in -a..a');
    expect(c2.range).toBeDefined();
  });

  it('3.4 rerange changes a slider range only', () => {
    const fig = newFig();
    fig.apply('sl = 3 in 0..10 step 0.5');
    const c = checked('sl in 0..20', fig);
    expect(c.op).toBe('rerange');
    expect(c.names).toEqual(['sl']);
    expect(c.range?.max).toBe(20);
  });

  it('3.4 rerange of an unknown name is unknown_name', () => {
    expect(failure('nothere in 0..20').kind).toBe('unknown_name');
  });

  it('errors.md 3 bad_range: lower bound above upper; fix swaps literal bounds', () => {
    const fig = newFig();
    const e = failure('s1 = 3 in 10..0', fig);
    expect(e.kind).toBe('bad_range');
    expect(e.fix).toBe('s1 = 3 in 0..10');
    expectFixPasses(e, fig);
  });

  it('errors.md 3 bad_range: step <= 0', () => {
    expect(failure('s1 = 3 in 0..10 step 0').kind).toBe('bad_range');
    expect(failure('s1 = 3 in 0..10 step -1').kind).toBe('bad_range');
  });

  it('errors.md 3 bad_range: a bound that is not a Number expression', () => {
    expect(failure('s1 = 3 in "x"..10').kind).toBe('bad_range');
    expect(failure('s1 = 3 in A..10').kind).toBe('bad_range');
  });

  it('3.4 a state and a rate rule', () => {
    const fig = newFig();
    fig.define('vel', 'Number', 0, { free: true, state: true });
    const c = checked("vel' = -9.8", fig);
    expect(c.op).toBe('rate');
    expect(c.kind).toBe('rate');
    expect(c.rate?.name).toBe('vel');
    expect(c.rate?.order).toBe(1);
  });

  it('3.4 a rate rule on an unknown name is unknown_name', () => {
    expect(failure("nothere' = 1").kind).toBe('unknown_name');
  });

  it('core 7.2 state(initial) is a state', () => {
    const c = checked('th = state(0.6)');
    expect(c.isState).toBe(true);
    expect(c.type?.k).toBe('Number');
    expect(checked('q1 = 3').isState).toBe(false);
  });
});

describe('language/design.md 3.10 rules: lists, ranges, index, if, points', () => {
  it('3.4 list literals, ranges and ranges with a step', () => {
    const fig = newFig();
    fig.apply('R1 = [1..5]');
    expect(Array.from(fig.valueOf('R1') as ArrayLike<number>)).toEqual([1, 2, 3, 4, 5]);
    fig.apply('R2 = [0..1 step 0.25]');
    expect(Array.from(fig.valueOf('R2') as ArrayLike<number>)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    fig.apply('R3 = []');
    expect(fig.lookup('R3')).toBeUndefined();
  });

  it('README 1: lists are 1-based; negative indexes count from the end', () => {
    expect(num('L[1]')).toBe(1);
    expect(num('L[2]')).toBe(2);
    expect(num('L[3]')).toBe(3);
    expect(num('L[-1]')).toBe(3);
    expect(num('L[-3]')).toBe(1);
    expect(num('[10, 20, 30][2]')).toBe(20);
  });

  it('3.10 rule 8 / errors.md 8: out-of-range index is undefined index_out_of_range', () => {
    expect(undefinedReason('L[4]')).toBe('index_out_of_range');
    expect(undefinedReason('L[0]')).toBe('index_out_of_range');
    expect(undefinedReason('L[-4]')).toBe('index_out_of_range');
  });

  it('errors.md 8: a non-integer index is undefined not_integer', () => {
    expect(undefinedReason('L[1.5]')).toBe('not_integer');
  });

  it('3.13 index_literal: a literal index that is 0, negative-out or not an integer warns', () => {
    for (const src of ['out = L[0]', 'out = L[1.5]']) {
      const r = check(src);
      expect(r.ok, src).toBe(true);
      if (r.ok) expect(r.notices.map((n) => n.kind)).toContain('index_literal');
    }
    const fine = check('out = L[2]');
    if (fine.ok) expect(fine.notices.map((n) => n.kind)).not.toContain('index_literal');
  });

  it('3.10 rule 8: L[i] needs a list and a Number index', () => {
    expect(failure('out = a[1]').kind).toBe('type_mismatch');
    expect(failure('out = L["x"]').kind).toBe('type_mismatch');
    expect(failure('out = L[A]').kind).toBe('type_mismatch');
  });

  it('3.10 rule 7: list elements share one type; a mix is type_mismatch', () => {
    const e = failure('M2 = [1, (2, 3)]');
    expect(e.kind).toBe('type_mismatch');
    expect(failure('M2 = [A, 2]').kind).toBe('type_mismatch');
  });

  it('3.10 rule 7: [] with no type is empty_list_type and the hint mentions Seq', () => {
    const e = failure('M2 = []');
    expect(e.kind).toBe('empty_list_type');
    expect(e.hint ?? '').toMatch(/Seq|first element/);
  });

  it('3.10 nested lists are List<List<T>>', () => {
    const c = checked('M2 = [[1, 2], [3, 4]]');
    expect(c.type?.k).toBe('List');
    expect(c.type?.of?.k).toBe('List');
    expect(c.type?.of?.of?.k).toBe('Number');
  });

  it('3.4 points: Cartesian and polar', () => {
    const fig = newFig();
    fig.apply('Q1 = (2; 90°)');
    const q = fig.valueOf('Q1') as { x: number; y: number };
    expect(q.x).toBeCloseTo(0, 12);
    expect(q.y).toBeCloseTo(2, 12);
    fig.apply('Q2 = (3; 0)');
    const q2 = fig.valueOf('Q2') as { x: number; y: number };
    expect(q2.x).toBeCloseTo(3, 12);
    expect(q2.y).toBeCloseTo(0, 12);
    fig.apply('Q3 = (a; pi)');
    const q3 = fig.valueOf('Q3') as { x: number; y: number };
    expect(q3.x).toBeCloseTo(-3, 12);
    expect(q3.y).toBeCloseTo(0, 12);
  });

  it('3.10 fields .x and .y', () => {
    expect(num('A.x')).toBe(1);
    expect(num('A.y')).toBe(2);
    expect(num('u.x + w.y')).toBe(5);
  });

  it('3.10 rule 6 / README 13: if(c, a, b), two arguments, and any number of arms', () => {
    expect(num('if(1 < 2, 10, 20)')).toBe(10);
    expect(num('if(1 > 2, 10, 20)')).toBe(20);
    expect(undefinedReason('if(1 > 2, 10)')).toBe('condition_false');
    expect(num('if(-5 < 0, -1, 5 == 0, 0, 1)')).toBe(-1);
    expect(num('if(0 < 0, -1, 0 == 0, 0, 1)')).toBe(0);
    expect(num('if(5 < 0, -1, 5 == 0, 0, 1)')).toBe(1);
    expect(undefinedReason('if(false, 1, false, 2)')).toBe('condition_false');
    expect(num('if(true, 1, undefined)')).toBe(1);
    expect(undefinedReason('if(false, 1, undefined)')).toBe('explicit');
  });

  it('3.10 rule 6: branch types must agree; the condition must be Bool', () => {
    expect(failure('out = if(true, 1, "a")').kind).toBe('type_mismatch');
    expect(failure('out = if(true, A, 2)').kind).toBe('type_mismatch');
    expect(failure('out = if(1, 2, 3)').kind).toBe('type_mismatch');
    expect(checked('Q9 = if(a > 1, (1, 1), (2, 2))').type?.k).toBe('Point');
  });
});

describe('language/design.md 3.19 edge cases', () => {
  it('a name on its own defines nothing: syntax with expected = with in \'', () => {
    const e = failure('A');
    expect(e.kind).toBe('syntax');
    for (const x of ['=', 'with', 'in', "'"]) expect(e.expected).toContain(x);
  });

  it('trailing comma is syntax with expected expression', () => {
    const e = failure('c = Circle(A, 2,)');
    expect(e.kind).toBe('syntax');
    expect(e.expected).toContain('expression');
    expectAt(e, { col: 17, token: ')' });
  });

  it('a missing argument before a comma is syntax; expected has expression and )', () => {
    const e = failure('c = Circle(A,, 2)');
    expect(e.kind).toBe('syntax');
    expectAt(e, { col: 14, endCol: 15, token: ',' });
    expect(e.expected).toContain('expression');
    expect(e.expected).toContain(')');
    expect(e.expected.length).toBeLessThanOrEqual(8);
  });

  it('errors.md 3: forms of the command are listed when the parser is given them', () => {
    const forms = ['Circle(center: Point, radius: Number) -> Circle'];
    const r = parseLine('c = Circle(A,, 2)', { commandForms: (n) => (n === 'Circle' ? forms : []) });
    const e = errOf(r);
    expect(e.forms).toEqual(forms);
  });

  it('self-reference a = a + 1 when a does not exist is unknown_name', () => {
    expect(failure('nothere = nothere + 1').kind).toBe('unknown_name');
  });

  it('self-reference after creation is cycle', () => {
    const e = failure('a = a + 1');
    expect(e.kind).toBe('cycle');
  });

  it('1e400 is bad_number (out of range)', () => {
    const e = failure('n = 1e400');
    expect(e.kind).toBe('bad_number');
    expect(e.message).toMatch(/range/i);
  });

  it('1e-400 is 0 with a precision_loss warning', () => {
    const fig = newFig();
    const r = check('n = 1e-400', fig);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notices.map((n) => n.kind)).toContain('precision_loss');
    expect(num('1e-400')).toBe(0);
  });

  it('an integer literal above 2^53 warns precision_loss once', () => {
    const r = check('n = 9007199254740993');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notices.filter((n) => n.kind === 'precision_loss').length).toBe(1);
    const fine = check('n = 9007199254740992');
    if (fine.ok) expect(fine.notices.map((n) => n.kind)).not.toContain('precision_loss');
  });

  it('1,5 is two arguments or a pair, never 1.5', () => {
    const c = checked('Q = (1,5)');
    expect(c.type?.k).toBe('Point');
  });

  it('Line = 3 is reserved_name (commands are not variables)', () => {
    expect(failure('Line = 3').kind).toBe('reserved_name');
  });

  it('[1..1000000] is limit with the cap 100,000 elements', () => {
    const e = failure('L9 = [1..1000000]');
    expect(e.kind).toBe('limit');
    expectAt(e, { col: 6, endCol: 18, token: '[1..1000000]' });
    expect(e.limit?.max).toBe(100000);
    expect(e.limit?.got).toBe(1000000);
  });

  it('a range of exactly 100,000 elements is allowed', () => {
    expect(check('L9 = [1..100000]').ok).toBe(true);
    const e = failure('L9 = [1..100001]');
    expect(e.kind).toBe('limit');
    expect(e.limit?.got).toBe(100001);
  });

  it('rulings.md Q9: 3x + 4y = 12 is assign_in_expr at the =, expected ==, fix names the line', () => {
    const fig = emptyFig();
    const e = errOf(analyseLine('3x + 4y = 12', fig));
    expect(e.kind).toBe('assign_in_expr');
    expect(e.phase).toBe('parse');
    expectAt(e, { col: 9, endCol: 10, token: '=' });
    expect(e.expected).toContain('==');
    expect(e.fix).toBeDefined();
    expect(e.fix).toContain('3x + 4y == 12');
    expect(e.fix).not.toBe('3x + 4y == 12'); // wrapped as the line kind it needs
    expect(e.fix).toMatch(/^[a-z]\w* = /);
    expectFixPasses(e, fig);
  });

  it('rulings.md Q9: the fix of 3x + 4y = 12 makes a Line', () => {
    const fig = emptyFig();
    const e = errOf(analyseLine('3x + 4y = 12', fig));
    const fixed = fig.apply(e.fix ?? '');
    expect(fixed.ok).toBe(true);
    expect(fig.lookup('l')?.type.k).toBe('Line');
  });

  it('errors.md 3 assign_in_expr: a second = in an expression', () => {
    const e = failure('f(x) = x = 2');
    expect(e.kind).toBe('assign_in_expr');
    expectAt(e, { col: 10, endCol: 11, token: '=' });
    const e2 = failure('A2 = (1, 2) = B');
    expect(e2.kind).toBe('assign_in_expr');
    expectAt(e2, { col: 13, endCol: 14, token: '=' });
  });

  it('errors.md 3 colon_label: A: (1, 2) is syntax at the colon with a fix using =', () => {
    const e = failure('A9: (1, 2)');
    expect(e.kind).toBe('syntax');
    expectAt(e, { col: 3, endCol: 4, token: ':' });
    expect(e.fix).toBe('A9 = (1, 2)');
    const e2 = failure('A9 := 3');
    expect(e2.kind).toBe('syntax');
    expect(e2.fix).toBe('A9 = 3');
  });

  it('ui.md 9 a square-bracket command call is syntax with a mechanical fix', () => {
    const e = failure('c9 = Circle[A, 2]');
    expect(e.kind).toBe('syntax');
    expect(e.fix).toBe('c9 = Circle(A, 2)');
  });

  it.each([
    ['A = (1, 2', 'unbalanced', 5, 6, '('],
    ['c = Circle(A, 2', 'unbalanced', 11, 12, '('],
    ['L2 = [1, 2, 3', 'unbalanced', 6, 7, '['],
    ['A = (1, 2))', 'unbalanced', 11, 12, ')'],
    ['A = (1, 2]', 'unbalanced', 10, 11, ']'],
  ])('errors.md 3 unbalanced: %s', (src, kind, col, endCol, token) => {
    const e = failure(src);
    expect(e.kind).toBe(kind);
    expectAt(e, { col, endCol, token });
  });

  it('errors.md 3 unbalanced: fix appends the missing closers', () => {
    expect(failure('c9 = Circle(A, 2').fix).toBe('c9 = Circle(A, 2)');
    expect(failure('L2 = [1, 2, 3').fix).toBe('L2 = [1, 2, 3]');
  });

  it('errors.md 3 unnamed_object: a bare object command, value or expression', () => {
    const fig = emptyFig();
    fig.apply('A = (0, 0)');
    const e = errOf(analyseLine('Circle(A, 2)', fig));
    expect(e.kind).toBe('unnamed_object');
    expect(e.fix).toBe('c = Circle(A, 2)');
    expectFixPasses(e, fig);
    const e2 = errOf(analyseLine('(1, 2)', fig));
    expect(e2.kind).toBe('unnamed_object');
    expect(e2.fix).toBe('B = (1, 2)');
    const e3 = errOf(analyseLine('3 + 4', fig));
    expect(e3.kind).toBe('unnamed_object');
    expect(e3.fix).toBe('a = 3 + 4');
  });

  it('errors.md 3 unnamed_object is raised by the parser when it is told which commands are objects', () => {
    const r = parseLine('Circle(A, 2)', { isObjectCommand: (n) => n === 'Circle' });
    expect(errOf(r).kind).toBe('unnamed_object');
    // An action stands alone.
    expect(parseLine('Hide(A)', { isObjectCommand: (n) => n === 'Circle' }).ok).toBe(true);
  });

  it('core 3 unknown / malformed directives', () => {
    const e = failure('@nothing 1 2');
    expect(['unknown_directive', 'bad_directive']).toContain(e.kind);
    const names = e.expected.map((x) => x.replace(/^@/, ''));
    for (const d of ['view', 'grid', 'axes', 'beat', 'clock']) expect(names).toContain(d);
  });

  it('core 3 a well-formed directive checks to op "directive"', () => {
    const c = checked('@view -5 5 -3 3');
    expect(c.op).toBe('directive');
    expect(c.directive?.name).toBe('view');
  });

  it('3.1 a preview of an unfinished line is "incomplete", a wrong line is not', () => {
    const fig = newFig();
    for (const src of ['a2 = ', 'a2 = 1 +', 'a2 = (1,', 'a2 = sqrt(', 'c9 = Circle(A, ']) {
      const r = preview(src, fig);
      expect(r.ok, src).toBe(false);
      if (!r.ok) expect(r.incomplete, src).toBe(true);
    }
    const bad = preview('a2 = 3 $ 4', fig);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.incomplete).toBe(false);
  });
});
