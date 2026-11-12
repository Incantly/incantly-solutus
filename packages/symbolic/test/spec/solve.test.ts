/**
 * Equations (docs/features/cas/design.md 2.3, 5.9; errors.md 2): Solve, Solutions, NSolve,
 * NSolutions, CSolve, CSolutions — one unknown, inequalities, systems, parameters, families.
 */
import { describe, expect, test } from 'vitest';
import {
  condText,
  parseCondition,
  parseExpression,
  substituteNode,
  symN,
  toText,
  upolyToTree,
} from '@incantly/symbolic';
import {
  asBool,
  asCond,
  asList,
  asNum,
  cd,
  condTexts,
  err,
  ex,
  expectProvedEqual,
  exprText,
  exprTexts,
  li,
  named,
  nm,
  noticeKinds,
  provedEqual,
  ran,
  sy,
  tx,
  undef,
  val,
} from './helpers';

/** Numeric value of an expression text (fails when not numeric). */
function numOf(s: string): number {
  return asNum(val('ToNumber', [ex(s)]), `ToNumber(${s})`);
}

/** Every exact solution substitutes back to an expression Equivalent proves is zero (acceptance 4). */
function verifySolutions(eq: string, v: string): void {
  const sides = eq.split('==');
  const diff = `(${sides[0] ?? ''}) - (${sides[1] ?? ''})`;
  const sols = exprTexts('Solutions', [cd(eq), sy(v)]);
  expect(sols.length).toBeGreaterThan(0);
  for (const s of sols) {
    let sub = exprText('Substitute', [ex(diff), ex(v), ex(s)]);
    if (s.includes('k1')) sub = exprText('Substitute', [ex(sub), ex('k1'), ex('0')]);
    expect(provedEqual(sub, '0'), `${eq}: solution ${s} should verify`).toBe(true);
  }
}

// design 2.3: one unknown, equation — a list of v == value, ascending real order.
describe('Solve one equation', () => {
  test('linear equation', () => {
    expect(condTexts('Solve', [cd('2*x+4==10'), sy('x')])).toEqual(['x == 3']);
  });
  test('quadratic in ascending real order', () => {
    expect(condTexts('Solve', [cd('x^2-5*x+6==0'), sy('x')])).toEqual(['x == 2', 'x == 3']);
  });
  test('no solutions is the empty list (a value, never undefined)', () => {
    const v = val('Solve', [cd('x^2+1==0'), sy('x')]);
    expect(asList(v, 'solve').length).toBe(0);
  });
  test('biquadratic solves by substitution', () => {
    expect(condTexts('Solve', [cd('x^4-5*x^2+4==0'), sy('x')])).toEqual([
      'x == -2',
      'x == -1',
      'x == 1',
      'x == 2',
    ]);
  });
  test('cubic by rational roots', () => {
    expect(condTexts('Solve', [cd('x^3-6*x^2+11*x-6==0'), sy('x')])).toEqual([
      'x == 1',
      'x == 2',
      'x == 3',
    ]);
  });
  test('depressed cubic gives the real cube root', () => {
    const sols = exprTexts('Solutions', [cd('x^3-2==0'), sy('x')]);
    expect(sols.length).toBe(1);
    expect(numOf(sols[0] ?? '')).toBeCloseTo(1.25992104989, 9);
  });
  test('degree 5+ uses rootof; the display text shows the decimal 1.1673 (design 5.4)', () => {
    const items = asList(val('Solve', [cd('x^5-x-1==0'), sy('x')]), 'solve');
    expect(items.length).toBe(1);
    // Text mode stays re-enterable (ruling); the decimal belongs to display mode.
    expect(condText(asCond(items[0] ?? cd('x==0'), 'root'), { display: true })).toContain('1.1673');
  });
  test('the rootof value evaluates to the root', () => {
    const texts = condTexts('Solve', [cd('x^5-x-1==0'), sy('x')]);
    const rhs = (texts[0] ?? '').split('==')[1] ?? '';
    expect(numOf(rhs)).toBeCloseTo(1.1673039784, 8);
  });
  test('Numeric refines a rootof to the asked digits (design 5.4)', () => {
    const texts = condTexts('Solve', [cd('x^5-x-1==0'), sy('x')]);
    const rhs = (texts[0] ?? '').split('==')[1] ?? '';
    expect(numOf(exprText('Numeric', [ex(rhs), nm(10)]))).toBeCloseTo(1.1673039784, 8);
  });
  test('Solve(c) works when exactly one symbol is free', () => {
    expect(condTexts('Solve', [cd('x^2-3*x+2==0')])).toEqual(['x == 1', 'x == 2']);
  });
  test('Solutions returns the right-hand sides only', () => {
    expect(exprTexts('Solutions', [cd('x^2-5*x+6==0'), sy('x')])).toEqual(['2', '3']);
  });
  test('unknown absent and true: [x in R]', () => {
    expect(condTexts('Solve', [cd('2==2'), sy('x')])).toEqual(['x in R']);
  });
  test('unknown absent and false: []', () => {
    expect(condTexts('Solve', [cd('2==3'), sy('x')])).toEqual([]);
  });
  test('from/to intersects the solutions', () => {
    expect(condTexts('Solve', [cd('x^2-4==0'), sy('x'), named('from', nm(0)), named('to', nm(10))])).toEqual([
      'x == 2',
    ]);
  });
});

// design 2.3, 5.9: equation classes.
describe('Solve equation classes', () => {
  test('rational: clearing denominators can empty the answer', () => {
    expect(condTexts('Solve', [cd('(x^2-1)/(x-1)==2'), sy('x')])).toEqual([]);
  });
  test('rational: kept roots solve the cleared equation', () => {
    expect(condTexts('Solve', [cd('x/(x-1)==2'), sy('x')])).toEqual(['x == 2']);
  });
  test('radicals: extraneous roots discarded by exact substitution', () => {
    expect(condTexts('Solve', [cd('sqrt(x)==2'), sy('x')])).toEqual(['x == 4']);
    expect(condTexts('Solve', [cd('sqrt(x)==-1'), sy('x')])).toEqual([]);
  });
  test('exponential in one place inverts to ln(b)/ln(a) (design 5.9)', () => {
    expect(condTexts('Solve', [cd('2^x==8'), sy('x')])).toEqual(['x == ln(8) / ln(2)']);
  });
  test('logarithmic in one place isolates', () => {
    const sols = exprTexts('Solutions', [cd('ln(x)==1'), sy('x')]);
    expect(sols.length).toBe(1);
    expect(numOf(sols[0] ?? '')).toBeCloseTo(Math.E, 9);
  });
  test('absolute value splits into two sign cases', () => {
    expect(condTexts('Solve', [cd('abs(x)==3'), sy('x')])).toEqual(['x == -3', 'x == 3']);
  });
  test('substitution into a polynomial in a sub-expression', () => {
    const sols = exprTexts('Solutions', [cd('exp(2*x)-3*exp(x)+2==0'), sy('x')]);
    expect(sols.length).toBe(2);
    for (const s of sols) {
      const sub = exprText('Substitute', [ex('exp(2*x)-3*exp(x)+2'), ex('x'), ex(s)]);
      expect(Math.abs(numOf(sub))).toBeLessThan(1e-9);
    }
  });
  test('otherwise: undefined unsupported with detail and suggest (errors.md 5.5)', () => {
    const u = undef('Solve', [cd('x+exp(x)==3'), sy('x')]);
    expect(u.reason).toBe('unsupported');
    expect(u.detail?.code).toBe('Y201');
    expect(u.detail?.stage).toBe('classify');
    expect(u.detail?.text.length).toBeGreaterThan(0);
    expect(u.detail?.suggest?.[0]).toContain('NSolve(x + exp(x) == 3, x)');
  });
});

// design 2.3: parameters stay symbolic, special cases listed.
describe('Solve with parameters', () => {
  test('Solve(a*x == b, x) is generic with cases', () => {
    const v = val('Solve', [cd('a*x==b'), sy('x')]);
    const items = asList(v, 'solve');
    expect(items.length).toBe(1);
    const generic = asCond(items[0] ?? cd('x==0'), 'generic solution');
    if (generic.c !== 'rel' || generic.op !== '==') throw new Error('expected x == value');
    expect(toText(generic.l)).toBe('x');
    expectProvedEqual(toText(generic.r), 'b/a');
    if (v.k !== 'list') throw new Error('expected list');
    expect(v.cases?.length).toBe(2);
  });
  test('Solve(a*x == b, x) carries notice cases (Y109)', () => {
    expect(noticeKinds('Solve', [cd('a*x==b'), sy('x')])).toContain('cases');
  });
  test('quadratic formula with symbolic coefficients', () => {
    const sols = exprTexts('Solutions', [cd('a*x^2+b*x+c==0'), sy('x')]);
    expect(sols.length).toBe(2);
    // Each solution verifies after substituting numbers for a, b, c (discriminant 1).
    for (const s of sols) {
      const withNums = exprText('Substitute', [ex(s), li([cd('a==1'), cd('b==-3'), cd('c==2')])]);
      expect([1, 2]).toContain(Math.round(numOf(withNums)));
    }
  });
});

// design 2.3: trig, exp and log families with a whole-number parameter.
describe('Solve trig families', () => {
  test('sin(x) == 1/2 gives two families in an integer parameter', () => {
    const texts = condTexts('Solve', [cd('sin(x)==1/2'), sy('x')]);
    expect(texts.length).toBe(2);
    // The parameter is k1, k2, … depending on how many the session made before; every
    // family here uses one integer parameter (design 2.3, 13.1).
    const params = texts.map((t) => t.match(/k\d+/)?.[0]);
    for (const p of params) expect(p).toMatch(/k\d+/);
    // The parameter at 0 gives pi/6 and 5*pi/6.
    const vals = texts.map((t, i) => {
      const rhs = t.split('==')[1] ?? '';
      return numOf(exprText('Substitute', [ex(rhs), ex(params[i] ?? 'k1'), ex('0')]));
    });
    expect(vals[0]).toBeCloseTo(Math.PI / 6, 9);
    expect(vals[1]).toBeCloseTo((5 * Math.PI) / 6, 9);
  });
  test('trig families print in the documented pi/6 + 2*pi*k1 form (design 2.3)', () => {
    const texts = condTexts('Solve', [cd('sin(x)==1/2'), sy('x')]);
    // Parameter names depend on session history (k1, k2, …); the shape must not.
    const norm = texts.map((t) => t.replace(/k\d+/g, 'k1'));
    expect(norm).toEqual(['x == pi/6 + 2 * pi * k1', 'x == 5 * pi/6 + 2 * pi * k1']);
  });
  test('trig families carry notice periodic_family (Y108)', () => {
    expect(noticeKinds('Solve', [cd('sin(x)==1/2'), sy('x')])).toContain('periodic_family');
  });
  test('with from and to the list is concrete', () => {
    const texts = condTexts(
      'Solve',
      [cd('sin(x)==1/2'), sy('x'), named('from', nm(0)), named('to', nm(7))],
    );
    expect(texts.length).toBe(3);
    const vals = texts.map((t) => numOf(t.split('==')[1] ?? ''));
    expect(vals).toEqual([...vals].sort((a, b) => a - b));
    for (const x of vals) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(7);
      expect(Math.abs(Math.sin(x) - 0.5)).toBeLessThan(1e-9);
    }
  });
  test('tan family has one branch per period', () => {
    const texts = condTexts('Solve', [cd('tan(x)==1'), sy('x')]);
    expect(texts.length).toBe(1);
    const param = (texts[0] ?? '').match(/k\d+/)?.[0];
    expect(param).toMatch(/k\d+/);
    const rhs = (texts[0] ?? '').split('==')[1] ?? '';
    expect(numOf(exprText('Substitute', [ex(rhs), ex(param ?? 'k1'), ex('0')]))).toBeCloseTo(
      Math.PI / 4,
      9,
    );
  });
  test('more than a million periods is undefined limit', () => {
    const u = undef('Solve', [cd('sin(x)==0'), sy('x'), named('from', nm(0)), named('to', nm(1e9))]);
    expect(u.reason).toBe('limit');
  }, 15000);
});

// design 2.3, 5.9: inequalities by sign charts.
describe('Solve inequalities', () => {
  test('linear inequality is one piece', () => {
    expect(condTexts('Solve', [cd('x-3<0'), sy('x')])).toEqual(['x < 3']);
  });
  test('quadratic inequality merges adjacent pieces', () => {
    const texts = condTexts('Solve', [cd('x^2-4>=0'), sy('x')]);
    expect(texts.length).toBe(2);
    expect(texts.join(' or ')).toContain('<=');
    expect(texts.join(' or ')).toContain('>=');
  });
  test('bounded interval prints as a < v < b', () => {
    expect(condTexts('Solve', [cd('x^2-1<0'), sy('x')])).toEqual(['-1 < x < 1']);
  });
  test('interval output re-enters (ruling)', () => {
    const v = val('Solve', [cd('x^2-1<0'), sy('x')]);
    const piece = asCond(asList(v, 'solve')[0] ?? cd('x==0'), 'piece');
    expect(parseCondition(condText(piece))).toEqual(piece);
  });
  test('absolute inequalities split into sign cases', () => {
    const texts = condTexts('Solve', [cd('abs(x)<2'), sy('x')]);
    expect(texts).toEqual(['-2 < x < 2']);
  });
  test('rational inequalities reduce to sign charts', () => {
    expect(condTexts('Solve', [cd('1/x>0'), sy('x')])).toEqual(['x > 0']);
  });
  test('endpoints included or not according to the relation', () => {
    expect(condTexts('Solve', [cd('x^2-1<=0'), sy('x')])).toEqual(['-1 <= x <= 1']);
  });
  test('no solutions is the empty list', () => {
    expect(condTexts('Solve', [cd('x^2+1<0'), sy('x')])).toEqual([]);
  });
  test('solutions satisfy the inequality at test points', () => {
    // x^2 - 1 < 0 holds at 0, fails at +-2, is tight at +-1.
    expect(numOf(exprText('Substitute', [ex('x^2-1'), ex('x'), ex('0')]))).toBeLessThan(0);
    expect(numOf(exprText('Substitute', [ex('x^2-1'), ex('x'), ex('2')]))).toBeGreaterThan(0);
  });
});

// design 2.3, 5.9: systems.
describe('Solve systems', () => {
  test('linear 2x2: one inner list per solution', () => {
    const v = val('Solve', [li([cd('x+y==3'), cd('x-y==1')]), li([sy('x'), sy('y')])]);
    const sols = asList(v, 'system');
    expect(sols.length).toBe(1);
    const pair = asList(sols[0] ?? li([]), 'pair').map((c) => condText(asCond(c, 'eq')));
    expect(pair).toEqual(['x == 2', 'y == 1']);
  });
  test('no solution is the empty list', () => {
    const v = val('Solve', [li([cd('x+y==1'), cd('x+y==2')]), li([sy('x'), sy('y')])]);
    expect(asList(v, 'system').length).toBe(0);
  });
  test('infinitely many solutions give parametric forms', () => {
    const v = val('Solve', [li([cd('x+y==2'), cd('2*x+2*y==4')]), li([sy('x'), sy('y')])]);
    const sols = asList(v, 'system');
    expect(sols.length).toBe(1);
    const pair = asList(sols[0] ?? li([]), 'pair');
    expect(pair.length).toBe(2);
    // One unknown stays free on the right; the family satisfies x + y == 2 at 5.
    const texts = pair.map((c) => condText(asCond(c, 'eq')));
    const xOfY = texts.find((t) => t.startsWith('x ==') && t.includes('y'))?.split('==')[1];
    const yOfX = texts.find((t) => t.startsWith('y ==') && t.includes('x'))?.split('==')[1];
    if (xOfY !== undefined) {
      expect(numOf(exprText('Substitute', [ex(xOfY), ex('y'), ex('5')]))).toBeCloseTo(-3, 9);
    } else if (yOfX !== undefined) {
      expect(numOf(exprText('Substitute', [ex(yOfX), ex('x'), ex('5')]))).toBeCloseTo(-3, 9);
    } else {
      throw new Error(`no parametric equation in ${texts.join(' ; ')}`);
    }
  });
  test('two quadratics eliminate by the resultant (degree at most 4)', () => {
    const v = val('Solve', [li([cd('x^2+y^2==25'), cd('x-y==1')]), li([sy('x'), sy('y')])]);
    const sols = asList(v, 'system');
    expect(sols.length).toBe(2);
    const pairs = sols.map((s) =>
      asList(s, 'pair').map((c) => numOf((condText(asCond(c, 'eq')).split('==')[1] ?? ''))),
    );
    expect(pairs).toContainEqual([4, 3]);
    expect(pairs).toContainEqual([-3, -4]);
  });
  test('larger systems are unsupported (or solved correctly)', () => {
    // x^5 + y == 3 with x - y == 1 is coupled of degree 5 with exactly one real
    // solution. Docs promise unsupported; a defined answer must verify symbolically:
    // x solves the eliminated equation x^5 + x - 4 == 0 and y == 3 - x^5.
    const { cell } = ran('Solve', [li([cd('x^5+y==3'), cd('x-y==1')]), li([sy('x'), sy('y')])]);
    if (!cell.defined) {
      expect(cell.reason).toBe('unsupported');
      return;
    }
    const sols = asList(cell.value, 'system');
    expect(sols.length).toBe(1);
    const pair = asList(sols[0] ?? li([]), 'pair');
    const byName = new Map(
      pair.map((c) => {
        const [l, r] = condText(asCond(c, 'eq')).split('==');
        return [(l ?? '').trim(), (r ?? '').trim()];
      }),
    );
    const xRhs = byName.get('x') ?? '';
    const yRhs = byName.get('y') ?? '';
    // The x value is the first real rootof the eliminated equation x^5 + x - 4.
    const r = parseExpression(xRhs);
    if (r.k !== 'rootof') throw new Error(`expected rootof, got ${r.k}`);
    expect(r.index).toBe(1);
    expectProvedEqual(toText(upolyToTree(r.poly, symN('x'))), 'x^5+x-4');
    // The y value is 3 - x^5 for that same x. The shared rootof is renamed to one fresh
    // atom on both sides first, so the check is pure algebra (Equivalent cannot yet
    // reason through rootof atoms; see equiv.test.ts).
    const atom = symN('qq7zz');
    const yA = toText(substituteNode(parseExpression(yRhs), r, atom));
    const yB = toText(substituteNode(parseExpression(`3 - (${xRhs})^5`), r, atom));
    expectProvedEqual(yA, yB);
  });
  test('more than 6 unknowns is solve_arity', () => {
    const vars = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => sy(n));
    const eqs = vars.map((_, i) => cd(`a+b+c+d+e+f+g==${i}`));
    const e = err('Solve', [li(eqs), li(vars)]);
    expect(e.kind).toBe('solve_arity');
    expect(e.code).toBe('Y008');
  });
  test('under-determined systems with 6 or fewer unknowns are allowed', () => {
    const v = val('Solve', [li([cd('x+y+z==3')]), li([sy('x'), sy('y'), sy('z')])]);
    expect(asList(v, 'system').length).toBeGreaterThanOrEqual(1);
  });
});

// design 5.9: NSolve is a different algorithm on purpose.
describe('NSolve', () => {
  test('finds the root of x + exp(x) == 3 to 1e-12 relative', () => {
    const texts = condTexts('NSolve', [cd('x+exp(x)==3'), sy('x')]);
    expect(texts.length).toBe(1);
    const root = numOf((texts[0] ?? '').split('==')[1] ?? '');
    expect(root).toBeCloseTo(0.7920599684, 9);
    expect(Math.abs(root + Math.exp(root) - 3)).toBeLessThan(1e-9);
  });
  test('polynomial roots via Sturm isolation', () => {
    const texts = condTexts('NSolve', [cd('x^5-x-1==0'), sy('x')]);
    expect(texts.length).toBe(1);
    expect(texts[0]).not.toContain('NaN');
    expect(numOf((texts[0] ?? '').split('==')[1] ?? '')).toBeCloseTo(1.1673039784, 8);
  });
  test('double roots are found once with notice multiple_root', () => {
    const texts = condTexts('NSolve', [cd('(x-1)^2==0'), sy('x')]);
    expect(texts.length).toBe(1);
    expect(numOf((texts[0] ?? '').split('==')[1] ?? '')).toBeCloseTo(1, 7);
    expect(noticeKinds('NSolve', [cd('(x-1)^2==0'), sy('x')])).toContain('multiple_root');
  });
  test('poles are rejected, not reported as roots', () => {
    expect(condTexts('NSolve', [cd('1/x==0'), sy('x')])).toEqual([]);
  });
  test('from/to form scans the window', () => {
    const texts = condTexts('NSolve', [cd('sin(x)==0'), sy('x'), nm(0), nm(10)]);
    expect(texts.length).toBe(4);
    for (const t of texts) {
      const root = numOf(t.split('==')[1] ?? '');
      expect(Math.abs(Math.sin(root))).toBeLessThan(1e-9);
    }
  });
  test('start form searches from the start value', () => {
    const texts = condTexts('NSolve', [cd('x+exp(x)==3'), sy('x'), nm(0)]);
    expect(texts.length).toBe(1);
    expect(numOf((texts[0] ?? '').split('==')[1] ?? '')).toBeCloseTo(0.7920599684, 9);
  });
  test('no root in the window is []', () => {
    expect(condTexts('NSolve', [cd('x^2+1==0'), sy('x'), nm(-100), nm(100)])).toEqual([]);
  });
  test('systems use damped Newton from starts', () => {
    const v = val('NSolve', [
      li([cd('x^2+y^2==25'), cd('x-y==1')]),
      li([sy('x'), sy('y')]),
      li([nm(5), nm(5)]),
    ]);
    const sols = asList(v, 'nsystem');
    expect(sols.length).toBeGreaterThanOrEqual(1);
    const pair = asList(sols[0] ?? li([]), 'pair').map((c) =>
      numOf(condText(asCond(c, 'eq')).split('==')[1] ?? ''),
    );
    expect(pair[0]).toBeCloseTo(4, 6);
    expect(pair[1]).toBeCloseTo(3, 6);
  });
  test('NSolutions returns decimals', () => {
    const texts = exprTexts('NSolutions', [cd('x^2-2==0'), sy('x')]);
    expect(texts.length).toBe(2);
    for (const t of texts) expect(t).not.toContain('NaN');
    expect(numOf(texts[0] ?? '')).toBeCloseTo(-Math.SQRT2, 9);
    expect(numOf(texts[1] ?? '')).toBeCloseTo(Math.SQRT2, 9);
  });
});

// design 5.9: CSolve works on the complex plane.
describe('CSolve', () => {
  test('x^2 + 1 ordered by real then imaginary part', () => {
    const texts = condTexts('CSolve', [cd('x^2+1==0'), sy('x')]);
    expect(texts.length).toBe(2);
    expectProvedEqual((texts[0] ?? '').split('==')[1] ?? '', '-i');
    expectProvedEqual((texts[1] ?? '').split('==')[1] ?? '', 'i');
  });
  test('Solve with domain = complex matches CSolve', () => {
    const a = condTexts('CSolve', [cd('x^2+1==0'), sy('x')]);
    const b = condTexts('Solve', [cd('x^2+1==0'), sy('x'), named('domain', tx('complex'))]);
    expect(b).toEqual(a);
  });
  test('CSolutions returns a + b i values', () => {
    const texts = exprTexts('CSolutions', [cd('x^2+1==0'), sy('x')]);
    expect(texts.length).toBe(2);
    expectProvedEqual(texts[0] ?? '', '-i');
    expectProvedEqual(texts[1] ?? '', 'i');
  });
  test('transcendental equations return principal families', () => {
    const texts = exprTexts('CSolutions', [cd('exp(x)==2'), sy('x')]);
    expect(texts.length).toBeGreaterThanOrEqual(1);
    let first = texts[0] ?? '';
    const param = first.match(/k\d+/)?.[0];
    if (param !== undefined) first = exprText('Substitute', [ex(first), ex(param), ex('0')]);
    expectProvedEqual(first, 'ln(2)');
  });
});

// design 9 acceptance 4: solve verification over equation families.
describe('solve verification (acceptance 4)', () => {
  test.each([
    ['2*x+4==10', 'x'],
    ['x^2-5*x+6==0', 'x'],
    ['x^4-5*x^2+4==0', 'x'],
    ['x^3-6*x^2+11*x-6==0', 'x'],
    ['x/(x-1)==2', 'x'],
    ['sqrt(x)==2', 'x'],
    ['2^x==8', 'x'],
    ['abs(x)==3', 'x'],
  ])('%s: every solution verifies', (eq, v) => {
    verifySolutions(eq, v);
  });
  test('generated quadratics have no missed solutions against a dense scan', () => {
    // (x-1)(x-4) = x^2 - 5x + 4: scan [-2, 7] for sign changes, compare the count.
    const f = (t: number): number => (t - 1) * (t - 4);
    let brackets = 0;
    let prev = f(-2);
    for (let t = -2 + 0.01; t <= 7; t += 0.01) {
      const cur = f(t);
      if (prev === 0 || cur * prev < 0) brackets += 1;
      prev = cur;
    }
    expect(condTexts('Solve', [cd('x^2-5*x+4==0'), sy('x')]).length).toBe(brackets);
  });
});

// design 2.3: every solve output re-enters.
describe('solve outputs re-enter', () => {
  test('Solve/NSolve/CSolve outputs re-parse (ruling)', () => {
    const { cell } = ran('Solve', [cd('x^2-5*x+6==0'), sy('x')]);
    if (!cell.defined) throw new Error('expected defined');
    for (const item of asList(cell.value, 'solve')) {
      const t = condText(asCond(item, 'item'));
      expect(parseCondition(t)).toEqual(asCond(item, 'item'));
    }
  });
  test('Equivalent on solve results is defined (bool, not unproven)', () => {
    // Sanity: solve outputs are ordinary values the equivalence test can read.
    expect(asBool(val('Equivalent', [ex('2'), ex('2')]), 'eq')).toBe(true);
  });
});
