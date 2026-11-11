/**
 * Algebra commands (docs/features/cas/design.md 2.2, 5.6, 5.7, 5.8): Simplify, Expand,
 * Factor, Rationalize, PartialFractions, CompleteSquare, Coefficients, Degree, Div, Mod,
 * Division, GCD, LCM.
 */
import { describe, expect, test } from 'vitest';
import { condText, floatN, parseCondition, parseExpression, run, toText } from '@incantly/symbolic';
import type { Result, RunSuccess } from '@incantly/symbolic';
import {
  asCond,
  asExpr,
  asList,
  asNum,
  bi,
  cd,
  err,
  ex,
  expectProvedEqual,
  exprExact,
  exprText,
  exprTexts,
  li,
  named,
  nm,
  noticeKinds,
  provedEqual,
  sy,
  tx,
  undef,
  val,
} from './helpers';

// design 2.2, 5.7: Simplify
describe('Simplify', () => {
  test('collects like terms', () => {
    expect(exprText('Simplify', [ex('2*x+3*x')])).toBe('5 * x');
  });
  test('cancels a common factor and records the excluded value', () => {
    const v = val('Simplify', [ex('(x^2-1)/(x-1)')]);
    expectProvedEqual(toText(asExpr(v, 'simplified')), 'x + 1');
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.excluded?.length).toBe(1);
  });
  test('excluded values print as x != 1', () => {
    const v = val('Simplify', [ex('(x^2-1)/(x-1)')]);
    if (v.k !== 'expr' || v.excluded?.[0] === undefined) throw new Error('expected excluded');
    expect(condText(v.excluded[0])).toBe('x != 1');
  });
  test('x/x is 1 with excluded x != 0 (edge case)', () => {
    const v = val('Simplify', [ex('x/x')]);
    expectProvedEqual(toText(asExpr(v, 'x/x')), '1');
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.excluded?.length).toBe(1);
  });
  test('combines powers without assumptions', () => {
    expectProvedEqual(exprText('Simplify', [ex('x^a * x^b')]), 'x^(a+b)');
  });
  test('sqrt(x^2) is abs(x) unless the sign is known', () => {
    expectProvedEqual(exprText('Simplify', [ex('sqrt(x^2)')]), 'abs(x)');
  });
  test('pulls perfect powers out of radicals', () => {
    expectProvedEqual(exprText('Simplify', [ex('sqrt(12)')]), '2*sqrt(3)');
  });
  test('trig Pythagoras collapses', () => {
    expectProvedEqual(exprText('Simplify', [ex('sin(x)^2+cos(x)^2')]), '1');
  });
  test('i^2 is -1', () => {
    expect(exprText('Simplify', [ex('i^2')])).toBe('-1');
  });
  test('on a Cond, simplifies both sides', () => {
    const v = val('Simplify', [cd('2*x+4 == 2+2*3')]);
    const c = asCond(v, 'simplified cond');
    if (c.c !== 'rel') throw new Error('expected a relation');
    const l = toText(c.l);
    const r = toText(c.r);
    // Either side order is allowed ("may flip to a canonical side").
    const straight = provedEqual(l, '2*x+4') && provedEqual(r, '8');
    const flipped = provedEqual(l, '8') && provedEqual(r, '2*x+4');
    expect(straight || flipped).toBe(true);
  });
  test('stays exact on exact input', () => {
    expect(exprExact('Simplify', [ex('(x^2-1)/(x-1)')])).toBe(true);
  });
});

// design 2.2, 5.7: Expand
describe('Expand', () => {
  test('(x+1)^2 multiplies out', () => {
    expectProvedEqual(exprText('Expand', [ex('(x+1)^2')]), 'x^2+2*x+1');
  });
  test('(x+1)^20 has degree 20 and leading coefficient 1', () => {
    const expanded = exprText('Expand', [ex('(x+1)^20')]);
    expect(asNum(val('Degree', [ex(expanded), sy('x')]), 'degree')).toBe(20);
    const coeffs = exprTexts('Coefficients', [ex(expanded), sy('x')]);
    expect(coeffs.length).toBe(21);
    expect(coeffs[0]).toBe('1');
  });
  test('(x+1)^20 at x = 1 is 2^20', () => {
    const expanded = exprText('Expand', [ex('(x+1)^20')]);
    const at1 = exprText('Substitute', [ex(expanded), ex('x'), ex('1')]);
    expectProvedEqual(at1, '1048576');
  });
  test('expands inside function arguments', () => {
    expectProvedEqual(exprText('Expand', [ex('sin(x*(y+1))')]), 'sin(x*y + x)');
  });
  test('Expand(e, v) agrees in value with Expand(e)', () => {
    const a = exprText('Expand', [ex('(x+1)*(y+1)'), sy('x')]);
    expectProvedEqual(a, exprText('Expand', [ex('(x+1)*(y+1)')]));
  });
  test('past 5,000 terms is undefined limit', () => {
    const u = undef('Expand', [ex('(x+y+z+w+1)^40')]);
    expect(u.reason).toBe('limit');
    expect(u.detail?.code).toBe('Y209');
  }, 30000);
});

// design 2.2, 5.8: Factor
describe('Factor', () => {
  test('factors a quadratic over the rationals', () => {
    const t = exprText('Factor', [ex('x^2-5*x+6')]);
    expect(parseExpression(t).k).toBe('mul');
    expectProvedEqual(t, 'x^2-5*x+6');
  });
  test('Expand(Factor(p)) is Expand(p) (acceptance 3)', () => {
    for (const p of ['x^2-5*x+6', 'x^3-2*x^2-x+2', '2*x^2+7*x+3', 'x^4-5*x^2+4']) {
      const f = exprText('Factor', [ex(p)]);
      expect(parseExpression(f).k, `Factor(${p}) should be a product`).toBe('mul');
      expectProvedEqual(exprText('Expand', [ex(f)]), exprText('Expand', [ex(p)]));
    }
  });
  test('the minus sign belongs to the front', () => {
    const t = exprText('Factor', [ex('-x^2+1')]);
    expect(t.startsWith('-')).toBe(true);
    expectProvedEqual(t, '-x^2+1');
  });
  test('a whole number factors into primes and returns an Expr product', () => {
    const t = exprText('Factor', [nm(12)]);
    expect(t).toContain('*');
    expect(t).toContain('2');
    expect(t).toContain('3');
    expectProvedEqual(t, '12');
  });
  test('irreducible input returns itself with notice irreducible', () => {
    const t = exprText('Factor', [ex('x^2+1')]);
    expectProvedEqual(t, 'x^2+1');
    expect(t).not.toContain('*');
    expect(noticeKinds('Factor', [ex('x^2+1')])).toContain('irreducible');
  });
  test('over = complex splits irreducible quadratics by their complex roots', () => {
    const t = exprText('Factor', [ex('x^2+1'), named('over', tx('complex'))]);
    expect(t).toContain('i');
    expectProvedEqual(t, 'x^2+1');
  });
  test('x^2 - 2 stays over the rationals (no extension fields)', () => {
    const t = exprText('Factor', [ex('x^2-2')]);
    expect(t).not.toContain('*');
    expect(noticeKinds('Factor', [ex('x^2-2')])).toContain('irreducible');
  });
  test('non-polynomial atoms are generators', () => {
    const t = exprText('Factor', [ex('sin(x)^2-1')]);
    expect(parseExpression(t).k).toBe('mul');
    expectProvedEqual(t, '(sin(x)-1)*(sin(x)+1)');
  });
});

// design 2.2, 5.7: Rationalize
describe('Rationalize', () => {
  test('removes surds from denominators', () => {
    expectProvedEqual(exprText('Rationalize', [ex('1/sqrt(2)')]), 'sqrt(2)/2');
  });
  test('rationalizes binomial denominators by conjugates', () => {
    expectProvedEqual(exprText('Rationalize', [ex('1/(1+sqrt(2))')]), 'sqrt(2)-1');
  });
  test('numeric input finds the nearest simple fraction', () => {
    const v = val('Rationalize', [{ k: 'expr', e: floatN(1 / 3), exact: false }]);
    expectProvedEqual(toText(asExpr(v, 'rationalized')), '1/3');
  });
});

// design 2.2: PartialFractions
describe('PartialFractions', () => {
  test('splits a rational function', () => {
    expectProvedEqual(exprText('PartialFractions', [ex('1/(x^2-1)'), sy('x')]), '(1/(x-1) - 1/(x+1))/2');
  });
  test('a non-rational function is never answered wrongly', () => {
    // Docs promise "rational functions only" with no failure mode: an honest error or
    // undefined is accepted, and a defined answer must equal the input.
    const r: Result<RunSuccess> = run('PartialFractions', [ex('sin(x)'), sy('x')]);
    if (!r.ok) return;
    if (!r.value.cell.defined) return;
    expectProvedEqual(toText(asExpr(r.value.cell.value, 'apart of sin')), 'sin(x)');
  });
});

// design 2.2: CompleteSquare
describe('CompleteSquare', () => {
  test('returns a (v + h)^2 + k', () => {
    const t = exprText('CompleteSquare', [ex('x^2+4*x+1'), sy('x')]);
    expect(t).toContain('^2');
    expectProvedEqual(t, '(x+2)^2 - 3');
  });
  test('a non-quadratic is not_polynomial', () => {
    const e = err('CompleteSquare', [ex('x^3'), sy('x')]);
    expect(e.kind).toBe('not_polynomial');
    expect(e.code).toBe('Y004');
  });
});

// design 2.2: Coefficients, Degree
describe('Coefficients and Degree', () => {
  test('coefficients run from the highest power down', () => {
    expect(exprTexts('Coefficients', [ex('3*x^2+2*x+1'), sy('x')])).toEqual(['3', '2', '1']);
  });
  test('degree is a whole Number', () => {
    expect(asNum(val('Degree', [ex('x^3+2*x'), sy('x')]), 'degree')).toBe(3);
  });
  test('Degree of sin(x) + x^2 names sin(x) (errors.md 5.4)', () => {
    const e = err('Degree', [ex('sin(x)+x^2'), sy('x')]);
    expect(e.kind).toBe('not_polynomial');
    expect(e.code).toBe('Y004');
    expect(e.token).toBe('sin(x)');
  });
  test('a negative power of the variable is not_polynomial', () => {
    expect(err('Degree', [ex('1/x + 1'), sy('x')]).kind).toBe('not_polynomial');
  });
});

// design 2.2: Div, Mod, Division
describe('Div, Mod, Division', () => {
  test('whole-number quotient and remainder', () => {
    expect(asNum(val('Div', [nm(7), nm(3)]), 'div')).toBe(2);
    expect(asNum(val('Mod', [nm(7), nm(3)]), 'mod')).toBe(1);
  });
  test('Mod follows the sign of the divisor', () => {
    expect(asNum(val('Mod', [nm(-7), nm(3)]), 'mod')).toBe(2);
    expect(asNum(val('Mod', [nm(7), nm(-3)]), 'mod')).toBe(-2);
    expect(asNum(val('Mod', [nm(-7), nm(-3)]), 'mod')).toBe(-1);
  });
  test('Division returns [quotient, remainder] with a = q*b + r', () => {
    for (const [a, b] of [[7, 3], [-7, 3], [7, -3], [-7, -3]] as const) {
      const items = asList(val('Division', [nm(a), nm(b)]), 'division');
      const q = asNum(items[0] ?? nm(0), 'q');
      const r = asNum(items[1] ?? nm(0), 'r');
      expect(q * b + r).toBe(a);
    }
  });
  test('polynomial quotient and remainder', () => {
    expectProvedEqual(exprText('Div', [ex('x^2-1'), ex('x-1'), sy('x')]), 'x+1');
    expectProvedEqual(exprText('Mod', [ex('x^2-1'), ex('x-1'), sy('x')]), '0');
    expectProvedEqual(exprText('Mod', [ex('x^2+1'), ex('x-1'), sy('x')]), '2');
  });
  test('division by zero is undefined division_by_zero', () => {
    expect(undef('Division', [nm(7), nm(0)]).reason).toBe('division_by_zero');
  });
});

// design 2.2: GCD, LCM
describe('GCD and LCM', () => {
  test('whole numbers', () => {
    expect(asNum(val('GCD', [nm(12), nm(18)]), 'gcd')).toBe(6);
    expect(asNum(val('LCM', [nm(4), nm(6)]), 'lcm')).toBe(12);
  });
  test('lists', () => {
    expect(asNum(val('GCD', [li([nm(12), nm(18), nm(24)])]), 'gcd')).toBe(6);
    expect(asNum(val('LCM', [li([nm(4), nm(6), nm(8)])]), 'lcm')).toBe(24);
  });
  test('whole numbers use BigInt: results above 2^53 are exact Expr integers', () => {
    const v = val('GCD', [bi(2n ** 60n), bi(2n ** 70n)]);
    if (v.k !== 'expr') throw new Error(`expected expr, got ${v.k}`);
    expect(toText(v.e)).toBe((2n ** 60n).toString());
  });
  test('polynomial forms', () => {
    expectProvedEqual(exprText('GCD', [ex('x^2-1'), ex('x-1'), sy('x')]), 'x-1');
    expectProvedEqual(exprText('LCM', [ex('x^2-1'), ex('x-1'), sy('x')]), 'x^2-1');
  });
});

// design 2.2: Cond results print re-enterably
describe('algebra outputs re-enter', () => {
  test('every algebra output above re-parses (ruling)', () => {
    for (const t of [
      exprText('Simplify', [ex('(x^2-1)/(x-1)')]),
      exprText('Factor', [ex('x^2-5*x+6')]),
      exprText('CompleteSquare', [ex('x^2+4*x+1'), sy('x')]),
    ]) {
      expect(() => parseExpression(t)).not.toThrow();
    }
    const c = condText(asCond(val('Simplify', [cd('2*x+4 == 8')]), 'simplified'));
    expect(() => parseCondition(c)).not.toThrow();
  });
});
