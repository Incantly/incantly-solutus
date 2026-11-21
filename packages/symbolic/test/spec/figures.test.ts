/**
 * CAS commands in figures (cas/design.md 2, 5.2 to 5.4, 5.15; agent.md 1 and 2; .kiro/specs/cas R2).
 * Lines go through `Figure.apply`, as the teacher and the learner write them.
 */
import { describe, expect, it } from 'vitest';
import {
  CommandRegistry, Figure, casEngineReady, geometry, isSymValue, onCasEngine, registerCas, registerFunctions, registerLists, registerNumbers,
  registerText, setCasEngine, valueText,
} from '@incantly/kernel';
import { SYMBOLIC_COMMANDS } from '@incantly/symbolic/catalogue';
import { casEngine } from '@incantly/symbolic';

const registry = new CommandRegistry();
geometry.registerGeometry(registry);
registerNumbers(registry);
registerFunctions(registry);
registerLists(registry);
registerText(registry);
registerCas(registry, SYMBOLIC_COMMANDS);

describe('before the engine is set (R2.7)', () => {
  it('a symbolic object is pending, and the host is told when the engine arrives', () => {
    expect(casEngineReady()).toBe(false);
    const f = new Figure({ commands: registry });
    expect(f.apply('p = Expr(x^2 - 1)').ok).toBe(true);
    const c = f.get('p')?.cell;
    expect(c?.defined).toBe(false);
    expect(c && !c.defined ? c.reason : '').toBe('pending');
    let told = 0;
    onCasEngine(() => told++);
    setCasEngine(casEngine);
    expect(told).toBe(1);
    expect(casEngineReady()).toBe(true);
    // a figure built again from its lines now computes
    const g = Figure.fromScript(f.toScript(), { commands: registry }).figure;
    expect(valueText(g.value('p'))).toBe('x^2 - 1');
  });
});

const fig = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: registry });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${r.message}`);
  }
  return f;
};
const text = (f: Figure, name: string): string => {
  const c = f.get(name)?.cell;
  if (!c) return 'missing';
  return c.defined ? valueText(c.value) : `undefined: ${c.reason}`;
};
const one = (line: string, setup: readonly string[] = []): string => {
  const f = fig([...setup, line]);
  return text(f, line.split('=')[0]?.trim() as string);
};

describe('symbolic values (R2.1, design 2.1)', () => {
  it('Expr of a formula in x is an Expr; of a comparison a Cond', () => {
    const f = fig(['p = Expr(x^2 - 5x + 6)', 'q = Expr(p == 0)']);
    expect(f.get('p')?.type).toBe('Expr');
    expect(f.get('q')?.type).toBe('Cond');
    expect(text(f, 'p')).toBe('x^2 - 5 * x + 6');
    expect(text(f, 'q')).toBe('x^2 - 5 * x + 6 = 0');
    const v = f.value('p');
    expect(isSymValue(v) && v.latex.length > 0).toBe(true);
  });

  it('Symbol() is an unknown named after its object, with a domain', () => {
    const f = fig(['k = Symbol()', 'a = Symbol() with domain = positive']);
    expect(f.get('k')?.type).toBe('Symbol');
    expect(text(f, 'k')).toBe('k');
    expect(one('r = Assume(a > 0, Simplify(sqrt(a^2)))', ['a = Symbol() with domain = positive'])).toBe('a');
  });

  it('Symbol(domain = "integer") is the same as with domain = integer', () => {
    const f = fig(['n = Symbol(domain = "integer")', 'm = Symbol() with domain = integer']);
    expect(text(f, 'n')).toBe('n');
    expect(text(f, 'm')).toBe('m');
  });
});

describe('symbolic mode (R2.2, design 5.3)', () => {
  it('x, y and z are unknowns; another letter must be made first, and the fix says how', () => {
    const f = fig([]);
    const r = f.apply('s = Solve(k*x == 1, x)');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('unknown_name');
    expect(r.suggest).toContain('k = Symbol()');
    expect(r.hint).toMatch(/Symbol\(\)/);
  });

  it('a free number enters exactly; a computed one as a decimal', () => {
    expect(one('w = Expand((x + k)^2)', ['k = 3'])).toBe('x^2 + 6 * x + 9');
    expect(one('w = Expand((x + h)^2)', ['k = 0.5', 'h = k * 2'])).toMatch(/^x\^2 \+ 2(\.0+)? \* x \+ 1/);
  });

  it('an Expr object enters by its tree, and a change to it flows on', () => {
    const f = fig(['k = 2', 'p = Expr(x^2 - k)', 'r = Solutions(p == 0, x)']);
    expect(text(f, 'r')).toBe('[-sqrt(2), sqrt(2)]');
    f.apply('k = 9');
    expect(text(f, 'r')).toBe('[-3, 3]');
  });

  it('a function object called in an expression enters with its body', () => {
    expect(one('w = Expr(h(x) + 1)', ['h(x) = x^2 - 3x'])).toBe('x^2 - 3 * x + 1');
    expect(one('d = Derivative(Expr(h(x)), x)', ['h(x) = x^3'])).toBe('3 * x^2');
  });

  it('a point is not an expression', () => {
    const f = fig(['A = (1, 2)']);
    expect(f.apply('w = Expr(A + x)').ok).toBe(false);
  });

  it('heavy commands refuse the clock; Substitute accepts it', () => {
    expect(one('b = Factor(t * x)')).toBe('undefined: time_dependent_input');
    expect(one('m = Substitute(sol, s0, t)', ['s0 = Symbol()', 'sol = Solve(x^2 == s0, x)'])).toMatch(/t/);
  });
});

describe('the phase 1 commands (R2.3, design 2.2 to 2.6, agent.md 2)', () => {
  it.each([
    ['fp = Factor(x^2 - 5x + 6)', '(x - 2) * (x - 3)'],
    ['fn = Factor(360)', '2^3 * 3^2 * 5'],
    ['ex = Expand((x + 1)^3)', 'x^3 + 3 * x^2 + 3 * x + 1'],
    ['sm = Simplify((x^2 - 1)/(x - 1))', 'x + 1'],
    ['cs = CompleteSquare(x^2 + 4x + 1, x)', '(x + 2)^2 - 3'],
    ['s = Solve(x^2 - 5x + 6 == 0, x)', '[x = 2, x = 3]'],
    ['r = Solutions(x^2 == 4, x)', '[-2, 2]'],
    ['sys = Solve([x + y == 3, x - y == 1], [x, y])', '[[x = 2, y = 1]]'],
    ['cso = CSolve(x^2 + 1 == 0, x)', '[x = -i, x = i]'],
    ['d = Derivative(Expr(x^3 - 3x), x)', '3 * x^2 - 3'],
    ['d2 = Derivative(Expr(x^4), x, 2)', '12 * x^2'],
    ['A = Integral(Expr(x^3 - 3x), x, 0, 2)', '-2'],
    ['F = Integral(Expr(2x), x)', 'x^2'],
    ['L = Limit(sin(x)/x, x, 0)', '1'],
    ['Li = Limit(1/x, x, inf)', '0'],
    ['sub = Substitute(x^2 - 5x + 6, x, 3)', '0'],
    ['nn = Numeric(sqrt(2), 20)', '1.41421356237309504880'],
    ['mx = MixedNumber(7/3)', '2 1/3'],
    ['ev = Evaluate(2/4 + 1/4)', '3/4'],
    ['dv = Div(x^3 - 1, x - 1, x)', 'x^2 + x + 1'],
    ['g = GCD(x^2 - 1, x^2 + 2x + 1, x)', 'x + 1'],
    ['co = Coefficients(x^2 + 2x + 3, x)', '[1, 2, 3]'],
    ['pf = PrimeFactors(360)', '[2, 2, 2, 3, 3, 5]'],
    ['ip = IsPrime(97)', 'true'],
    ['np = NextPrime(100)', '101'],
    ['dl = DivisorsList(12)', '[1, 2, 3, 4, 6, 12]'],
    ['ds = DivisorsSum(12)', '28'],
    ['tb = ToBase(255, 16)', '"ff"'],
    ['eg = ExtendedGCD(240, 46)', '[2, -9, 47]'],
    ['me = ModularExponent(3, 200, 7)', '2'],
  ])('%s gives %s', (line, want) => {
    expect(one(line)).toBe(want);
  });

  it('Equivalent and IsZero are true only when proved, nested commands included', () => {
    expect(one('ok = Equivalent(Expand((x + 1)^2), x^2 + 2x + 1)')).toBe('true');
    expect(one('no = Equivalent(x^2, x)')).toBe('false');
    expect(one('iz = IsZero(sin(x)^2 + cos(x)^2 - 1)')).toBe('true');
  });

  it('a Cond object joins other conditions with and', () => {
    expect(one('s = Solve(q and x > 0, x)', ['q = Expr(x^2 == 4)'])).toBe('[x = 2]');
  });

  it('LeftSide and RightSide take a condition apart', () => {
    const f = fig(['q = Expr(x^2 == 2x + 3)', 'l = LeftSide(q)', 'r = RightSide(q)']);
    expect(text(f, 'l')).toBe('x^2');
    expect(text(f, 'r')).toBe('2 * x + 3');
  });

  it('the general quadratic with Symbols', () => {
    const r = one('gen = Solutions(a*x^2 + b*x + c == 0, x)', ['a = Symbol() with domain = nonzero', 'b = Symbol()', 'c = Symbol()']);
    expect(r).toContain('sqrt');
    expect(r).toContain('2 * a');
  });

  it('a solution is an Expr; its first item and ToNumber make a point', () => {
    const f = fig(['q = Expr(x^2 - 5x + 6 == 0)', 'r = Solutions(q, x)', 'R = (ToNumber(r[1]), 0)']);
    expect(f.value('R')).toEqual({ x: 2, y: 0 });
  });
});

describe('results as figure values (R2.4, R2.5)', () => {
  it('a refusal is an undefined object with the engine reason', () => {
    expect(one('n = NextPrime(10^700)')).toMatch(/^undefined: /);
    expect(one('L = Limit(1/x, x, 0)')).toMatch(/^undefined: /);
  });

  it('nested numeric commands are refused with a fix', () => {
    const f = fig([]);
    const r = f.apply('w = Expr(Distance((0, 0), (3, 4)) * x)');
    expect(r.ok ? 'ok' : r.message).toBe('ok');
    const c = f.get('w')?.cell;
    expect(c && !c.defined ? c.reason : '').toBe('not_symbolic');
  });

  it('a Cond, a list and an Expr print through FormulaText as maths', () => {
    const f = fig(['p = Expr(x^2 - 1)', 's = Solve(p == 0, x)', 'a = FormulaText(p)', 'b = FormulaText(s)']);
    expect(f.value('a')).toMatch(/^\$.*x.*\^\{2\}.*\$$/);
    expect(f.value('b')).toMatch(/^\$x = -1,.*x = 1\$$/);
  });

  it('the script keeps the lines as written, and loads again', () => {
    const f = fig(['p = Expr(x^2 - 1)', 'fp = Factor(p)', 'k = Symbol() with domain = positive']);
    const g = Figure.fromScript(f.toScript(), { commands: registry }).figure;
    expect(text(g, 'fp')).toBe('(x - 1) * (x + 1)');
    expect(text(g, 'k')).toBe('k');
  });
});

describe('conversions (R2.6, design 5.15)', () => {
  it('ToFunction makes a function that plots and calls', () => {
    const f = fig(['p = Expr(x^2 - 5x + 6)', 'g = ToFunction(p, x)', 'v = g(4)']);
    expect(f.get('g')?.type).toMatch(/^Function/);
    expect(f.value('v')).toBe(2);
  });

  it('ToExpr gives a function body back as an Expr', () => {
    expect(one('w = ToExpr(h)', ['h(x) = x^2 - 3x'])).toBe('x^2 - 3 * x');
  });

  it('ToNumber of an exact integral is a number', () => {
    expect(one('n = ToNumber(Integral(x^2, x, 0, 3))')).toBe('9');
  });
});
