/**
 * Text and logic (docs/features/text-logic/design.md 2.3, 4, 5; errors.md; .kiro/specs/text-logic R1 to R5).
 * Built from the docs and the public API only.
 */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, registerFunctions, registerLists, registerNumbers, registerText, text } from '@incantly/kernel';

const registry = new CommandRegistry();
geometry.registerGeometry(registry);
registerNumbers(registry);
registerFunctions(registry);
registerLists(registry);
registerText(registry);

const fig = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: registry });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${r.message}`);
  }
  return f;
};
const val = (setup: readonly string[], line: string): unknown => {
  const f = fig([...setup, line]);
  return f.value(line.split('=')[0]?.trim() as string);
};
const reason = (setup: readonly string[], line: string): string | undefined => {
  const f = fig([...setup, line]);
  const c = f.get(line.split('=')[0]?.trim() as string)?.cell;
  return c && !c.defined ? c.reason : undefined;
};

describe('formats in text (R1, design 2.3)', () => {
  it.each([
    ['"{1.005:2}"', '1.01'],
    ['"{-0.001:2}"', '0.00'],
    ['"{2.5:0}"', '3'],
    ['"{3.14159:3sf}"', '3.14'],
    ['"{pi:deg}"', '180°'],
    ['"{pi/3:deg2}"', '60.00°'],
    ['"{0.25:pct}"', '25%'],
    ['"{12345:sci}"', '1.23 × 10^4'],
    ['"{21:ord}"', '21st'],
    ['"{0.75:frac}"', '3/4'],
    ['"{0.75:f}"', '3/4'],
  ])('%s is %s', (src, want) => {
    expect(val([], `s = ${src}`)).toBe(want);
  });
  it('an unknown format is refused with the list', () => {
    const r = fig([]).apply('s = "{1:zz}"');
    expect(r.ok).toBe(false);
  });
});

describe('making text (R2, design 4.1)', () => {
  const base = ['A = (0, 0)', 'B = (4, 2)', 'M = Midpoint(A, B)', 'f(x) = x^2/2 - 3*x', 'k = 2', 'g(x) = k*x + 1'];
  it('Text shows the value, or the definition', () => {
    expect(val(base, 'tx = Text(M)')).toBe('(2, 1)');
    expect(val(base, 'tx = Text(M, show = "definition")')).toBe('Midpoint(A, B)');
  });
  it('LaTeX gives the source, FormulaText the typeset formula', () => {
    expect(val(base, 'tx = LaTeX(f)')).toBe('f\\left(x\\right) = \\frac{x^{2}}{2} - 3 x');
    expect(val(base, 'tx = FormulaText(f)')).toBe('$f\\left(x\\right) = \\frac{x^{2}}{2} - 3 x$');
  });
  it('FormulaText with substitute puts the values in', () => {
    expect(val(base, 'tx = FormulaText(g, substitute = true)')).toBe('$g\\left(x\\right) = 2 x + 1$');
    expect(val(base, 'tx = FormulaText(g)')).toBe('$g\\left(x\\right) = k \\cdot x + 1$');
  });
  it('the LaTeX printer: roots, absolute values, powers of sums, Greek names', () => {
    // an expression that is not a named object prints by value
    expect(val([], 'tx = LaTeX(sqrt(2) + abs(-3))')).toMatch(/^4\.414/);
    const f = fig(['h(x) = sqrt(x + 1) / (x - 1)^2', 'θ = 0.5', 'w = 2*θ']);
    const t = f.apply('tx = LaTeX(h)');
    expect(t.ok).toBe(true);
    expect(f.value('tx')).toBe('h\\left(x\\right) = \\frac{\\sqrt{x + 1}}{\\left(x - 1\\right)^{2}}');
    f.apply('tx2 = LaTeX(w)');
    expect(f.value('tx2')).toBe('2 \\theta');
  });
});

describe('numbers as text (R3, design 4.2 to 4.5)', () => {
  it.each([
    ['FractionText(0.30000000000000004)', '$\\frac{3}{10}$'],
    ['FractionText(-1.25)', '$-\\frac{5}{4}$'],
    ['FractionText(4)', '$4$'],
    ['SurdText(sqrt(8)/3)', '$\\frac{2\\sqrt{2}}{3}$'],
    ['SurdText((1 + sqrt(5))/2)', '$\\frac{1 + \\sqrt{5}}{2}$'],
    ['SurdText(3*pi/4)', '$\\frac{3\\pi}{4}$'],
    ['SurdText(0.125)', '$\\frac{1}{8}$'],
    ['ScientificText(12345, sig = 3)', '$1.23 \\times 10^{4}$'],
    ['ScientificText(0)', '$0$'],
    ['Ordinal(1)', '1st'], ['Ordinal(2)', '2nd'], ['Ordinal(3)', '3rd'], ['Ordinal(11)', '11th'], ['Ordinal(12)', '12th'],
    ['Ordinal(13)', '13th'], ['Ordinal(21)', '21st'], ['Ordinal(101)', '101st'], ['Ordinal(111)', '111th'],
    ['ContinuedFraction(sqrt(2), 5, true)', '$\\left[1; 2, 2, 2, 2, \\ldots\\right]$'],
    ['ContinuedFraction(0.5)', '$0 + \\cfrac{1}{2}$'],
  ])('%s', (cmd, want) => {
    expect(val([], `tx = ${cmd}`)).toBe(want);
  });
  it('a random decimal is not dressed up as a surd', () => {
    expect(val([], 'tx = SurdText(0.7390851332151607)')).not.toMatch(/\$/);
  });
  it('the reasons of errors.md 3', () => {
    expect(reason([], 'tx = Ordinal(-2)')).toBe('out_of_domain');
    expect(reason([], 'tx = Ordinal(2.5)')).toBe('out_of_domain');
    expect(reason([], 'tx = FractionText(pi, 10)')).toBe('no_convergence');
  });
  it('the pure helpers', () => {
    expect(text.bestRational(355 / 113, 1000).f).toEqual({ p: 355, q: 113 });
    expect(text.continuedFraction(Math.PI, 4).terms).toEqual([3, 7, 15, 1]);
  });
});

describe('tables and string tools (R4, design 4.6 to 4.8)', () => {
  it('TableText makes an array with brackets and a header', () => {
    expect(val([], 'tx = TableText([[1, 2], [3, 4]], brackets = "paren")')).toBe('$\\left(\\begin{array}{ll} 1 & 2 \\\\ 3 & 4 \\end{array}\\right)$');
    const h = val([], 'tx = TableText([["x", "y"], ["1", "2"]], header = true, align = "c")') as string;
    expect(h).toContain('\\mathbf{\\text{x}}');
    expect(h).toContain('\\hline');
    expect(h).toContain('{cc}');
  });
  it('ragged rows are padded with a notice', () => {
    // a ragged literal is refused by the lists area (matrix rows); rows made apart reach the table
    const f = fig(['r1 = ["a", "b", "c"]', 'r2 = ["d"]']);
    const r = f.apply('tx = TableText([r1, r2])');
    expect(r.ok && r.notices.map((n) => n.kind)).toContain('ragged_table');
  });
  it.each([
    ['ReplaceAll("a-b-c", "-", "+")', 'a+b+c'],
    ['LetterToUnicode("A")', 65],
    ['UnicodeToText([72, 105])', 'Hi'],
    ['UnicodeToLetter(955)', 'λ'],
  ])('%s', (cmd, want) => {
    expect(val([], `tx = ${cmd}`)).toBe(want);
  });
  it('Split keeps empty pieces; TextToUnicode counts code points', () => {
    expect(val([], 'tx = Split("a,b,,c,", ",")')).toEqual(['a', 'b', '', 'c', '']);
    expect(Array.from(val([], 'tx = TextToUnicode("h😀")') as ArrayLike<number>)).toEqual([104, 128512]);
  });
  it('surrogates and control characters are out of the domain', () => {
    expect(reason([], 'tx = UnicodeToLetter(55296)')).toBe('out_of_domain');
    expect(reason([], 'tx = UnicodeToText([65, 7])')).toBe('out_of_domain');
    expect(reason([], 'tx = LetterToUnicode("")')).toBe('empty_list');
  });
});

describe('logic (R5, design 5.2 to 5.4)', () => {
  const base = ['L = [1, 2, 3, 4, 5, 6]'];
  it('CountIf and KeepIf', () => {
    expect(val(base, 'n = CountIf(L, k, k > 2)')).toBe(4);
    expect(Array.from(val(base, 'm = KeepIf(L, k, k > 2 and k < 6)') as ArrayLike<number>)).toEqual([3, 4, 5]);
  });
  it('an undefined condition is skipped with a notice', () => {
    const f = fig(base);
    const r = f.apply('n = CountIf(L, k, sqrt(3 - k) > 0.5)');
    expect(f.value('n')).toBe(2);
    expect(r.ok && r.notices.map((x) => x.kind)).toContain('skipped_undefined');
  });
  it('IsInteger with its tolerance', () => {
    expect(val([], 'q = IsInteger(4.0000000000001)')).toBe(true);
    expect(val([], 'q = IsInteger(4.5)')).toBe(false);
    expect(val([], 'q = IsInteger(2^60 + 0.5)')).toBe(true);
  });
  it('IsDefined and UndefinedReason read an undefined object', () => {
    const s = ['w = 0', 'u = 1/w', 'P = Intersect(Line((0, 0), (1, 0)), Line((0, 1), (1, 1)))'];
    expect(val(s, 'q = IsDefined(u)')).toBe(false);
    expect(val(s, 'q = IsDefined(w)')).toBe(true);
    expect(val(s, 'q = UndefinedReason(u)')).toBe('division by zero');
    expect(val(s, 'q = UndefinedReason(P)')).toBe('the lines are parallel');
    expect(val(s, 'q = UndefinedReason(w)')).toBe('');
  });
  it('IsInRegion: polygon, boundary, circle, self-crossing', () => {
    const s = ['sq = Polygon((0, 0), (4, 0), (4, 4), (0, 4))', 'c = Circle((0, 0), 2)', 'bow = Polygon((0, 0), (4, 4), (4, 0), (0, 4))'];
    expect(val(s, 'q = IsInRegion((1, 1), sq)')).toBe(true);
    expect(val(s, 'q = IsInRegion((5, 1), sq)')).toBe(false);
    expect(val(s, 'q = IsInRegion((4, 2), sq)')).toBe(true);
    expect(val(s, 'q = IsInRegion((1, 1), c)')).toBe(true);
    expect(val(s, 'q = IsInRegion((2, 0), c)')).toBe(true);
    const f = fig(s);
    const r = f.apply('q = IsInRegion((2, 1), bow)');
    expect(r.ok && r.notices.map((x) => x.kind)).toContain('self_crossing');
  });
  it('Related answers for each pair, and refuses a kind that does not apply', () => {
    const s = ['A = (0, 0)', 'B = (4, 2)', 'M = Midpoint(A, B)', 'l1 = Line(A, B)', 'l2 = Line((0, 1), (4, 3))', 'l3 = Line((0, 0), (-1, 2))', 'c = Circle(A, 2)', 'c2 = Circle((3, 0), 2)'];
    expect(val(s, 'q = Related(l1, l2, "parallel")')).toBe(true);
    expect(val(s, 'q = Related(l1, l3, "perpendicular")')).toBe(true);
    expect(val(s, 'q = Related(M, l1, "on")')).toBe(true);
    expect(val(s, 'q = Related(B, c, "outside")')).toBe(true);
    expect(val(s, 'q = Related(c, c2, "intersecting")')).toBe(true);
    expect(val(s, 'q = Related(3, 4, "less")')).toBe(true);
    expect(reason(s, 'q = Related(3, 4, "parallel")')).toBe('bad_argument');
  });
});

describe('speed (R7)', () => {
  it('a text with 3 live parts rebuilds fast', { retry: 2 }, () => {
    const f = fig(['a = 1 in 0..10', 'b = 2 * a', 'c = a + b', 's = "a = {a:2}, b = {b:3sf}, c = {c:pct}"']);
    const t0 = performance.now();
    for (let k = 0; k < 2000; k++) {
      f.setFree('a', (k % 100) / 10, 'slider');
      f.flush();
    }
    const per = (performance.now() - t0) / 2000;
    // the whole pass (three objects and the text) per slider move; the text's part is well inside it
    expect(per).toBeLessThan(0.2);
    expect(f.value('s')).toMatch(/^a = 9\.90/);
  });
});
