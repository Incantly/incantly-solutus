/**
 * Calculus on expressions (docs/features/cas/design.md 2.5, 5.10; errors.md 2 and agent.md 5):
 * Derivative, Integral (indefinite and definite), Limit, LimitAbove, LimitBelow.
 *
 * Answers are checked by value (finite differences, quadrature, known constants) so that a
 * test does not depend on how the engine orders or prints a correct answer.
 */
import { describe, expect, test } from 'vitest';
import { parseExpression, toText } from '@incantly/symbolic';
import {
  agree,
  asExpr,
  ex,
  exprText,
  li,
  nm,
  noticeKinds,
  numeric,
  numResult,
  ran,
  sy,
  undef,
  val,
} from './helpers';

/** Central difference of the expression text `t` in x at `p`. */
function fd(t: string, p: number, h = 1e-5): number {
  return (numeric(t, { x: p + h }) - numeric(t, { x: p - h })) / (2 * h);
}

/** Closed-form check: the derivative of `f` equals the finite difference of `f` at the points. */
function checkDerivative(f: string, points: readonly number[]): void {
  const d = exprText('Derivative', [ex(f), sy('x')]);
  for (const p of points) {
    const want = fd(f, p);
    const got = numeric(d, { x: p });
    expect(Math.abs(got - want), `d/dx ${f} at ${p}: got ${got}, want ${want}`).toBeLessThan(1e-5 * Math.max(1, Math.abs(want)));
  }
}

/** Composite Simpson quadrature with n panels (even). */
function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i += 1) s += f(a + i * h) * (i % 2 === 1 ? 4 : 2);
  return (s * h) / 3;
}

// design 5.10: Derivative — exact, standard rules on the tree.
describe('Derivative rules', () => {
  test('sum rule and constants', () => {
    expect(exprText('Derivative', [ex('x^2+3*x+5'), sy('x')])).toMatch(/./);
    checkDerivative('x^2+3*x+5', [0.5, 2, -1.5]);
  });
  test('power rule', () => {
    expect(numeric(exprText('Derivative', [ex('x^5'), sy('x')]), { x: 2 })).toBeCloseTo(80, 9);
  });
  test('product rule', () => {
    checkDerivative('x^3*sin(x)', [0.4, 1.3, 2.6]);
  });
  test('quotient rule (product with a negative power)', () => {
    checkDerivative('x/(x^2+1)', [0.4, 1.3, -2.6]);
    checkDerivative('sin(x)/x', [0.4, 1.3, 2.6]);
  });
  test('chain rule', () => {
    checkDerivative('sin(x^2)', [0.4, 1.3, 2.6]);
    checkDerivative('exp(3*x+1)', [0.4, 1.3, -1.6]);
    checkDerivative('(x^2+1)^5', [0.4, 1.3, -1.6]);
  });
  test('power with a variable exponent goes through exp and ln', () => {
    checkDerivative('x^x', [0.4, 1.3, 2.6]);
    checkDerivative('2^x', [0.4, 1.3, -2.6]);
  });
  test('inverse trig', () => {
    checkDerivative('atan(x)', [0.4, 1.3, -2.6]);
    checkDerivative('asin(x)', [0.4, -0.3, 0.8]);
    checkDerivative('acos(x)', [0.4, -0.3, 0.8]);
  });
  test('log, abs and roots', () => {
    checkDerivative('ln(x)', [0.4, 1.3, 2.6]);
    checkDerivative('sqrt(x)', [0.4, 1.3, 2.6]);
    checkDerivative('abs(x)', [0.4, 1.3, -2.6]);
  });
  test('trig functions', () => {
    checkDerivative('tan(x)', [0.4, 1.0, -1.2]);
    checkDerivative('cos(x)', [0.4, 1.0, -1.2]);
  });
  test('the derivative of a constant is 0', () => {
    expect(numResult('Derivative', [ex('7'), sy('x')])).toBe(0);
    expect(numResult('Derivative', [ex('pi'), sy('x')])).toBe(0);
  });
  test('other symbols are constants', () => {
    const d = exprText('Derivative', [ex('a*x^2'), sy('x')]);
    expect(numeric(d, { x: 3, a: 5 })).toBeCloseTo(30, 9);
  });
  test('nth derivative', () => {
    const d2 = exprText('Derivative', [ex('x^4'), sy('x'), nm(2)]);
    expect(numeric(d2, { x: 2 })).toBeCloseTo(48, 9);
    const d4 = exprText('Derivative', [ex('x^4'), sy('x'), nm(4)]);
    expect(numeric(d4)).toBeCloseTo(24, 9);
    const d5 = exprText('Derivative', [ex('x^4'), sy('x'), nm(5)]);
    expect(numeric(d5)).toBe(0);
  });
  test('mixed partial derivative', () => {
    const d = exprText('Derivative', [ex('x^2*y^3'), li([sy('x'), sy('y')])]);
    expect(numeric(d, { x: 2, y: 3 })).toBeCloseTo(2 * 2 * 3 * 9, 9);
  });
  test('the result is exact on exact input', () => {
    const v = val('Derivative', [ex('x^3'), sy('x')]);
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.exact).toBe(true);
  });
  test('exact derivative of sin(x) at 0 is exactly 1', () => {
    const d = exprText('Derivative', [ex('sin(x)'), sy('x')]);
    expect(toText(parseExpression(exprText('Substitute', [ex(d), ex('x'), ex('0')])))).toBe('1');
  });
});

// design 5.10: piecewise derivative.
describe('Derivative of abs and sign', () => {
  test('derivative of abs(x) is sign(x) away from 0', () => {
    const d = exprText('Derivative', [ex('abs(x)'), sy('x')]);
    expect(numeric(d, { x: 3 })).toBe(1);
    expect(numeric(d, { x: -3 })).toBe(-1);
  });
});

// design 5.10: Integral (indefinite) — antiderivative found by the listed methods.
describe('Integral (indefinite)', () => {
  const cases: readonly (readonly [string, string, readonly number[]])[] = [
    ['sum by linearity', 'x^2+3*x+1', [0.5, 2, -1]],
    ['reciprocal gives a log', '1/x', [0.5, 2]],
    ['exp with a linear argument', 'exp(3*x)', [0.5, 1.2]],
    ['sin with a linear argument', 'sin(2*x+1)', [0.5, 1.2]],
    ['sec squared', '1/cos(x)^2', [0.5, 1.0]],
    ['1/(1+x^2) gives atan', '1/(1+x^2)', [0.5, 2, -1]],
    ['1/sqrt(1-x^2) gives asin', '1/sqrt(1-x^2)', [0.2, -0.5, 0.7]],
    ['polynomial times exp (parts)', 'x^2*exp(x)', [0.5, 1.2]],
    ['polynomial times sin (tabular parts)', 'x*sin(x)', [0.5, 1.2, 2.2]],
    ['rational function with distinct factors', '1/(x^2-1)', [2, 3, 4.5]],
    ['rational function with a repeated factor', '1/(x-1)^2', [2, 3, 4.5]],
    ['rational function with three factors', '1/((x+1)*(x+2)*(x+3))', [0.5, 1, 2]],
    ['sin cubed times cos squared', 'sin(x)^3*cos(x)^2', [0.5, 1.2, 2.2]],
    ['sin squared', 'sin(x)^2', [0.5, 1.2, 2.2]],
    ['substitution: derivative of a sub-expression as a factor', '2*x*exp(x^2)', [0.5, 1.2]],
    ['substitution, second level', 'x*cos(x^2+1)', [0.5, 1.2]],
    ['x^n ln x by parts', 'x*ln(x)', [0.5, 1.2, 3]],
    ['inverse trig by parts', 'atan(x)', [0.5, 1.2, -3]],
    ['1/sqrt(quadratic) by completing the square', '1/sqrt(x^2+2*x+5)', [0.5, 1.2, -3]],
    ['sqrt(quadratic) by completing the square', 'sqrt(x^2+2*x+5)', [0.5, 1.2, -3]],
  ];
  test.each(cases)('%s: d/dx of the antiderivative of %s is the integrand', (_name, f, points) => {
    const F = exprText('Integral', [ex(f), sy('x')]);
    for (const p of points) {
      const got = fd(F, p);
      const want = numeric(f, { x: p });
      expect(Math.abs(got - want), `at ${p}: ${got} vs ${want} (F = ${F})`).toBeLessThan(1e-5 * Math.max(1, Math.abs(want)));
    }
  });
  test('the constant of integration is omitted', () => {
    const F = exprText('Integral', [ex('2*x'), sy('x')]);
    expect(F).not.toMatch(/\bc\b/i);
    expect(numeric(F, { x: 0 })).toBeCloseTo(0, 12);
  });
  test('the indefinite integral of 0 is 0', () => {
    expect(numResult('Integral', [ex('0'), sy('x')])).toBe(0);
  });
  test('integral is exact on exact input', () => {
    const v = val('Integral', [ex('x^2'), sy('x')]);
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.exact).toBe(true);
  });
  test('other symbols are constants', () => {
    const F = exprText('Integral', [ex('a*x'), sy('x')]);
    expect(numeric(F, { x: 2, a: 3 }) - numeric(F, { x: 0, a: 3 })).toBeCloseTo(6, 9);
  });
});

// design 5.10: known non-elementary integrals are named, not hung on.
describe('Integral non-elementary', () => {
  test('the four listed forms are undefined non_elementary naming the special function', () => {
    for (const [f, special] of [['exp(-x^2)', 'erf'], ['sin(x)/x', 'Si'], ['exp(x)/x', 'Ei'], ['1/ln(x)', 'li']] as const) {
      const u = undef('Integral', [ex(f), sy('x')]);
      expect(u.reason, f).toBe('non_elementary');
      expect(u.detail?.code, f).toBe('Y202');
      expect(u.detail?.text.toLowerCase(), f).toContain(special.toLowerCase());
    }
  });
  test('the non-elementary detail suggests a numeric definite integral', () => {
    const u = undef('Integral', [ex('exp(-x^2)'), sy('x')]);
    expect(u.detail?.suggest?.length ?? 0).toBeGreaterThan(0);
  });
  test('an integral the engine cannot do is unsupported, never a wrong antiderivative', () => {
    const { cell } = ran('Integral', [ex('x^x'), sy('x')]);
    if (cell.defined) {
      // If an answer is returned it must differentiate back to the integrand.
      const F = toText(asExpr(cell.value, 'F'));
      expect(Math.abs(fd(F, 1.7) - 1.7 ** 1.7)).toBeLessThan(1e-5);
    } else {
      expect(cell.reason).toBe('unsupported');
      expect(cell.detail?.code).toBe('Y201');
    }
  });
});

// design 5.10: Integral (definite).
describe('Integral (definite)', () => {
  test('polynomial over an interval is exact (agent.md 2: A = Integral(g, x, 0, 2))', () => {
    expect(exprText('Integral', [ex('x^3-3*x'), sy('x'), nm(0), nm(2)])).toBe('-2');
  });
  test('x^2 over [0, 3] is exactly 9', () => {
    expect(exprText('Integral', [ex('x^2'), sy('x'), nm(0), nm(3)])).toBe('9');
  });
  test('exact rational results stay rational', () => {
    expect(exprText('Integral', [ex('x^2'), sy('x'), nm(0), nm(1)])).toBe('1/3');
  });
  test('exact trig values: sin over [0, pi] is 2', () => {
    expect(numResult('Integral', [ex('sin(x)'), sy('x'), nm(0), nm(Math.PI)])).toBeCloseTo(2, 9);
  });
  test('reversed bounds change the sign', () => {
    expect(exprText('Integral', [ex('x^2'), sy('x'), nm(3), nm(0)])).toBe('-9');
  });
  test('equal bounds give 0', () => {
    expect(exprText('Integral', [ex('exp(x)'), sy('x'), nm(2), nm(2)])).toBe('0');
  });
  test('no elementary antiderivative falls back to numeric with notice numeric_fallback (Y101)', () => {
    const v = numResult('Integral', [ex('exp(-x^2)'), sy('x'), nm(0), nm(1)]);
    expect(v).toBeCloseTo(0.7468241328124271, 10);
    expect(noticeKinds('Integral', [ex('exp(-x^2)'), sy('x'), nm(0), nm(1)])).toContain('numeric_fallback');
  });
  test('the numeric fallback is flagged inexact', () => {
    const r = val('Integral', [ex('exp(-x^2)'), sy('x'), nm(0), nm(1)]);
    if (r.k !== 'expr') throw new Error('expected expr');
    expect(r.exact).toBe(false);
  });
  test('definite integrals agree with adaptive quadrature to 1e-10 (acceptance 5)', () => {
    const table: readonly (readonly [string, (x: number) => number, number, number])[] = [
      ['x^2*exp(x)', (x) => x * x * Math.exp(x), 0, 1.5],
      ['1/(1+x^2)', (x) => 1 / (1 + x * x), -1, 2],
      ['sin(x)^2', (x) => Math.sin(x) ** 2, 0, 2],
      ['x*sin(x)', (x) => x * Math.sin(x), 0, 3],
      ['ln(x)', (x) => Math.log(x), 1, 4],
      ['sqrt(x)', (x) => Math.sqrt(x), 0, 4],
    ];
    for (const [f, g, a, b] of table) {
      const got = numResult('Integral', [ex(f), sy('x'), nm(a), nm(b)]);
      expect(Math.abs(got - simpson(g, a, b, 4000)), f).toBeLessThan(1e-10);
    }
  });
  test('a non-integrable pole inside the interval is undefined divergent (Y204)', () => {
    const u = undef('Integral', [ex('1/x'), sy('x'), nm(-1), nm(1)]);
    expect(u.reason).toBe('divergent');
    expect(u.detail?.code).toBe('Y204');
  });
  test('1/x from 0 diverges and names the singular point', () => {
    const u = undef('Integral', [ex('1/x'), sy('x'), nm(0), nm(1)]);
    expect(u.reason).toBe('divergent');
    expect(u.detail?.text).toContain('0');
  });
  test('an integrable singularity is an improper integral: 1/sqrt(x) over [0, 1] is 2', () => {
    expect(exprText('Integral', [ex('1/sqrt(x)'), sy('x'), nm(0), nm(1)])).toBe('2');
  });
  test('infinite bounds use a limit of the antiderivative', () => {
    expect(numResult('Integral', [ex('exp(-x)'), sy('x'), nm(0), nm(Infinity)])).toBeCloseTo(1, 9);
    expect(numResult('Integral', [ex('1/(1+x^2)'), sy('x'), nm(-Infinity), nm(Infinity)])).toBeCloseTo(Math.PI, 9);
  });
  test('a divergent infinite bound is undefined divergent', () => {
    expect(undef('Integral', [ex('1/x'), sy('x'), nm(1), nm(Infinity)]).reason).toBe('divergent');
  });
});

// design 5.10: Limit.
describe('Limit', () => {
  test('continuity: substitute and test', () => {
    expect(exprText('Limit', [ex('x^2+1'), sy('x'), nm(3)])).toBe('10');
  });
  test('cancelling a common factor at a finite point', () => {
    expect(exprText('Limit', [ex('(x^2-1)/(x-1)'), sy('x'), nm(1)])).toBe('2');
  });
  test('standard limit sin(x)/x at 0 is 1', () => {
    expect(exprText('Limit', [ex('sin(x)/x'), sy('x'), nm(0)])).toBe('1');
  });
  test('standard limit (exp(x) - 1)/x at 0 is 1', () => {
    expect(exprText('Limit', [ex('(exp(x)-1)/x'), sy('x'), nm(0)])).toBe('1');
  });
  test('standard limit (1 + 1/x)^x at inf is e', () => {
    expect(numResult('Limit', [ex('(1+1/x)^x'), sy('x'), nm(Infinity)])).toBeCloseTo(Math.E, 9);
  });
  test('rational function at infinity: dominant terms', () => {
    expect(exprText('Limit', [ex('(2*x+1)/(x-3)'), sy('x'), nm(Infinity)])).toBe('2');
    expect(exprText('Limit', [ex('(x^2+1)/(x^3+x)'), sy('x'), nm(Infinity)])).toBe('0');
  });
  test('a limit of inf is a valid answer (the inf constant)', () => {
    expect(exprText('Limit', [ex('x^2'), sy('x'), nm(Infinity)])).toBe('inf');
    expect(exprText('Limit', [ex('-x^2'), sy('x'), nm(Infinity)])).toBe('-inf');
  });
  test('inf is accepted as the point of approach in both directions', () => {
    expect(exprText('Limit', [ex('exp(x)'), sy('x'), nm(-Infinity)])).toBe('0');
  });
  test("L'Hopital for 0/0", () => {
    expect(numResult('Limit', [ex('(1-cos(x))/x^2'), sy('x'), nm(0)])).toBeCloseTo(0.5, 12);
    expect(numResult('Limit', [ex('(exp(x)-1-x)/x^2'), sy('x'), nm(0)])).toBeCloseTo(0.5, 12);
  });
  test("L'Hopital for inf/inf", () => {
    expect(exprText('Limit', [ex('ln(x)/x'), sy('x'), nm(Infinity)])).toBe('0');
    expect(exprText('Limit', [ex('x^2/exp(x)'), sy('x'), nm(Infinity)])).toBe('0');
  });
  test('0 * inf rewritten as a quotient: x ln x at 0+', () => {
    expect(exprText('LimitAbove', [ex('x*ln(x)'), sy('x'), nm(0)])).toBe('0');
  });
  test('inf - inf rewritten: sqrt(x^2 + x) - x at inf is 1/2', () => {
    expect(numResult('Limit', [ex('sqrt(x^2+x)-x'), sy('x'), nm(Infinity)])).toBeCloseTo(0.5, 9);
  });
  test('1^inf: (1 + 2/x)^x at inf is e^2', () => {
    expect(numResult('Limit', [ex('(1+2/x)^x'), sy('x'), nm(Infinity)])).toBeCloseTo(Math.E ** 2, 9);
  });
  test('the limit is exact on exact input', () => {
    const v = val('Limit', [ex('sin(x)/x'), sy('x'), nm(0)]);
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.exact).toBe(true);
  });
  test('1/x at 0 has different one-sided limits: undefined no_limit', () => {
    const u = undef('Limit', [ex('1/x'), sy('x'), nm(0)]);
    expect(u.reason).toBe('no_limit');
    expect(u.detail?.code).toBe('Y203');
  });
  test('oscillation has no limit', () => {
    const u = undef('Limit', [ex('sin(x)'), sy('x'), nm(Infinity)]);
    expect(u.reason).toBe('no_limit');
  });
});

// errors.md 5.6 and agent.md 5.4: the abs(x)/x example.
describe('Limit abs(x)/x at 0 (docs example)', () => {
  test('two-sided limit is undefined no_limit (Y203)', () => {
    const u = undef('Limit', [ex('abs(x)/x'), sy('x'), nm(0)]);
    expect(u.reason).toBe('no_limit');
    expect(u.detail?.code).toBe('Y203');
    expect(u.detail?.stage).toBe('limit');
  });
  test('the detail text reads "The left limit is -1 and the right limit is 1."', () => {
    const u = undef('Limit', [ex('abs(x)/x'), sy('x'), nm(0)]);
    expect(u.detail?.text).toBe('The left limit is -1 and the right limit is 1.');
  });
  test('the detail suggests the one-sided commands', () => {
    const u = undef('Limit', [ex('abs(x)/x'), sy('x'), nm(0)]);
    expect(u.detail?.suggest).toEqual([
      'Lr = LimitAbove(abs(x)/x, x, 0)',
      'Ll = LimitBelow(abs(x)/x, x, 0)',
    ]);
  });
  test('LimitAbove is 1', () => {
    expect(exprText('LimitAbove', [ex('abs(x)/x'), sy('x'), nm(0)])).toBe('1');
  });
  test('LimitBelow is -1', () => {
    expect(exprText('LimitBelow', [ex('abs(x)/x'), sy('x'), nm(0)])).toBe('-1');
  });
});

describe('One-sided limits', () => {
  test('1/x from above is inf, from below is -inf', () => {
    expect(exprText('LimitAbove', [ex('1/x'), sy('x'), nm(0)])).toBe('inf');
    expect(exprText('LimitBelow', [ex('1/x'), sy('x'), nm(0)])).toBe('-inf');
  });
  test('1/x^2 is inf from both sides, so the two-sided limit is inf', () => {
    expect(exprText('Limit', [ex('1/x^2'), sy('x'), nm(0)])).toBe('inf');
  });
  test('sign(x) from each side', () => {
    expect(exprText('LimitAbove', [ex('sign(x)'), sy('x'), nm(0)])).toBe('1');
    expect(exprText('LimitBelow', [ex('sign(x)'), sy('x'), nm(0)])).toBe('-1');
  });
  test('floor(x) from each side at 2', () => {
    expect(exprText('LimitAbove', [ex('floor(x)'), sy('x'), nm(2)])).toBe('2');
    expect(exprText('LimitBelow', [ex('floor(x)'), sy('x'), nm(2)])).toBe('1');
  });
  test('ln(x) from above at 0 is -inf', () => {
    expect(exprText('LimitAbove', [ex('ln(x)'), sy('x'), nm(0)])).toBe('-inf');
  });
  test('a continuous function has equal one-sided limits', () => {
    expect(exprText('LimitAbove', [ex('x^2'), sy('x'), nm(3)])).toBe('9');
    expect(exprText('LimitBelow', [ex('x^2'), sy('x'), nm(3)])).toBe('9');
  });
});

// design 9 acceptance 5: Derivative(Integral(f)) is Equivalent to f.
describe('Derivative(Integral(f)) round trip (acceptance 5)', () => {
  const table = [
    'x^3-2*x+1',
    'exp(2*x)',
    'sin(3*x)',
    'x*exp(-x)',
    '1/(x^2+4)',
    'x^2/(x^2+1)',
    '1/(x*(x+1))',
    'cos(x)^2',
    'sin(x)*cos(x)',
    'x*cos(x)',
    '2^x',
    'sqrt(x)',
    '1/sqrt(x)',
    'ln(x)^2/x',
  ];
  test('d/dx of the antiderivative equals the integrand for the whole table', () => {
    const bad: string[] = [];
    for (const f of table) {
      const { cell } = ran('Integral', [ex(f), sy('x')]);
      if (!cell.defined) {
        bad.push(`${f}: Integral undefined (${cell.reason})`);
        continue;
      }
      const F = toText(asExpr(cell.value, 'F'));
      const dF = exprText('Derivative', [ex(F), sy('x')]);
      if (!agree(dF, f, 'x')) bad.push(`${f}: d/dx of ${F} is ${dF}`);
    }
    expect(bad).toEqual([]);
  });
});
