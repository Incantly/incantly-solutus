/**
 * Assumptions (design 5.12) and equivalence tests (design 2.2 Equivalent/IsZero, errors.md
 * Y206, Y112, Y009).
 */
import { describe, expect, test } from 'vitest';
import {
  assumptions,
  findContradiction,
  isInteger,
  isNonneg,
  isNonzero,
  isPositive,
  parseCondition,
  parseExpression,
  signOf,
} from '@incantly/symbolic';
import type { Domain, SymCond } from '@incantly/symbolic';
import { asBool, cd, equivVerdict, err, ex, expectWellFormed, exprText, noticeKinds, numeric, ran, val } from './helpers';

const dom = (...pairs: readonly (readonly [string, Domain])[]) => assumptions(new Map(pairs));
const e = (s: string) => parseExpression(s);

// design 5.12: signOf rules.
describe('signOf', () => {
  test('a number has its sign', () => {
    expect(signOf(e('3'), assumptions())).toBe('pos');
    expect(signOf(e('-2'), assumptions())).toBe('neg');
    expect(signOf(e('0'), assumptions())).toBe('zero');
    expect(signOf(e('1/2'), assumptions())).toBe('pos');
  });
  test('a product multiplies signs', () => {
    const a = dom(['a', 'positive'], ['b', 'negative']);
    expect(signOf(e('a*b'), a)).toBe('neg');
    expect(signOf(e('a*a'), a)).toBe('pos');
    expect(signOf(e('b*b'), a)).toBe('pos');
    expect(signOf(e('0*a'), a)).toBe('zero');
  });
  test('a sum of nonneg terms is nonneg, strictly positive when one term is', () => {
    const a = dom(['a', 'nonneg'], ['b', 'positive']);
    expect(signOf(e('a+a'), a)).toBe('nonneg');
    expect(signOf(e('a+b'), a)).toBe('pos');
  });
  test('exp is positive; abs and even powers are nonneg; sqrt of nonneg is nonneg', () => {
    const a = assumptions();
    expect(signOf(e('exp(x)'), a)).toBe('pos');
    expect(['nonneg', 'pos']).toContain(signOf(e('abs(x)'), a));
    expect(['nonneg', 'pos']).toContain(signOf(e('x^2'), a));
    expect(['nonneg', 'pos']).toContain(signOf(e('x^4'), a));
    expect(['nonneg', 'pos']).toContain(signOf(e('sqrt(c)'), dom(['c', 'nonneg'])));
  });
  test('symbol domains set the sign', () => {
    expect(signOf(e('p'), dom(['p', 'positive']))).toBe('pos');
    expect(signOf(e('p'), dom(['p', 'negative']))).toBe('neg');
    expect(signOf(e('p'), dom(['p', 'nonneg']))).toBe('nonneg');
    expect(signOf(e('p'), dom(['p', 'nonpos']))).toBe('nonpos');
    expect(signOf(e('p'), dom(['p', 'nonzero']))).toBe('nonzero');
  });
  test('a fact a > 0 makes a positive', () => {
    expect(signOf(e('a'), assumptions(undefined, [parseCondition('a > 0')]))).toBe('pos');
  });
  test('a fact a > b with b >= 0 makes a positive', () => {
    const facts: SymCond[] = [parseCondition('a > b'), parseCondition('b >= 0')];
    expect(signOf(e('a'), assumptions(undefined, facts))).toBe('pos');
  });
  test('unknown otherwise (and a rule that gets unknown does not fire)', () => {
    expect(signOf(e('y'), assumptions())).toBe('unknown');
    expect(signOf(e('y+z'), assumptions())).toBe('unknown');
    expect(signOf(e('y*z'), assumptions())).toBe('unknown');
  });
  test('predicates agree with signOf', () => {
    const a = dom(['p', 'positive'], ['q', 'nonneg']);
    expect(isPositive(e('p'), a)).toBe(true);
    expect(isPositive(e('q'), a)).toBe(false);
    expect(isNonneg(e('q'), a)).toBe(true);
    expect(isNonzero(e('p'), a)).toBe(true);
    expect(isNonzero(e('q'), a)).toBe(false);
  });
});

describe('isInteger and contradictions', () => {
  test('integer literals, integer symbols and their sums', () => {
    const a = dom(['k', 'integer']);
    expect(isInteger(e('3'), a)).toBe(true);
    expect(isInteger(e('1/2'), a)).toBe(false);
    expect(isInteger(e('k'), a)).toBe(true);
    expect(isInteger(e('k+1'), a)).toBe(true);
    expect(isInteger(e('2*k'), a)).toBe(true);
    expect(isInteger(e('y'), a)).toBe('unknown');
  });
  test('findContradiction names the pair; consistent facts give null', () => {
    const pair = findContradiction([parseCondition('a > 0'), parseCondition('a < 0')]);
    expect(pair).not.toBe(null);
    expect(findContradiction([parseCondition('a > 0'), parseCondition('a > 1')])).toBe(null);
  });
});

// design 5.12 Assume(c, e), errors.md Y009.
describe('Assume', () => {
  test('Assume(a > 0, Simplify(sqrt(a^2))) returns a', () => {
    expect(exprText('Assume', [cd('a>0'), ex('sqrt(a^2)')])).toBe('a');
  });
  test('Assume(a < 0, sqrt(a^2)) returns -a', () => {
    expect(numeric(exprText('Assume', [cd('a<0'), ex('sqrt(a^2)')]), { a: -3 })).toBe(3);
  });
  test('Assume(x >= 0, abs(x)) returns x', () => {
    expect(exprText('Assume', [cd('x>=0'), ex('abs(x)')])).toBe('x');
  });
  test('facts apply only inside the call, and they go into the cache key', () => {
    const pos = exprText('Assume', [cd('a>0'), ex('sqrt(a^2)')]);
    const neg = exprText('Assume', [cd('a<0'), ex('sqrt(a^2)')]);
    const none = exprText('Simplify', [ex('sqrt(a^2)')]);
    expect(pos).toBe('a');
    expect(neg).not.toBe('a');
    expect(none).not.toBe('a');
    expect(exprText('Assume', [cd('a>0'), ex('sqrt(a^2)')])).toBe('a');
  });
  test('symbol domains in the context behave like local facts', () => {
    const ctx = { domains: new Map<string, Domain>([['k', 'positive']]) };
    expect(exprText('Simplify', [ex('abs(k)')], undefined, ctx)).toBe('k');
  });
  test('contradictory facts are bad_assumption (Y009) naming the pair in related', () => {
    const c: SymCond = { c: 'and', of: [parseCondition('a > 0'), parseCondition('a < 0')] };
    const er = err('Assume', [{ k: 'cond', c, exact: true }, ex('a')]);
    expect(er.kind).toBe('bad_assumption');
    expect(er.code).toBe('Y009');
    expectWellFormed(er);
    expect((er.related ?? []).length).toBeGreaterThan(0);
  });
  test('a Cond that is not about symbols is bad_assumption', () => {
    expect(err('Assume', [cd('2>1'), ex('x')]).kind).toBe('bad_assumption');
  });
});

// design 2.2: Equivalent and IsZero — three-way rule.
describe('Equivalent', () => {
  test('true when proved: expanded square', () => {
    expect(equivVerdict('(x+1)^2', 'x^2+2*x+1')).toBe(true);
  });
  test('true for symbolic identities (agent.md 5.2)', () => {
    expect(equivVerdict('a^2+2*a*b+b^2', '(a+b)^2')).toBe(true);
  });
  test('true for rational expressions needing common denominators', () => {
    expect(equivVerdict('1/x+1/y', '(x+y)/(x*y)')).toBe(true);
  });
  test('false when a counter-example exists', () => {
    expect(equivVerdict('x+1', 'x+2')).toBe(false);
    expect(equivVerdict('x^2', 'x^3')).toBe(false);
    expect(equivVerdict('sin(x)', 'cos(x)')).toBe(false);
    expect(equivVerdict('sqrt(x^2)', 'x')).toBe(false);
    expect(equivVerdict('x', 'abs(x)')).toBe(false);
  });
  test('never true for different expressions (generated)', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['x^2+1', 'x^2+2'], ['(x+1)^2', 'x^2+1'], ['x/(x+1)', 'x'], ['2*x', 'x^2'], ['exp(x)', 'x+1'],
      ['sin(x)', 'x'], ['ln(x)', 'x-1'], ['(x-1)*(x+1)', 'x^2'], ['x^3-x', 'x^3+x'], ['1/x', '1/(x+1)'],
    ];
    for (const [a, b] of pairs) expect(equivVerdict(a, b), `${a} vs ${b}`).not.toBe(true);
  });
  test('never false for equal expressions (soundness over identities)', () => {
    const pairs: readonly (readonly [string, string])[] = [
      ['sin(x)^2+cos(x)^2', '1'], ['sin(2*x)', '2*sin(x)*cos(x)'], ['exp(x)*exp(y)', 'exp(x+y)'],
      ['(x^2-1)/(x-1)', 'x+1'], ['x*(y+z)', 'x*y+x*z'], ['sqrt(4*x^2)', '2*abs(x)'], ['ln(x^2)', '2*ln(abs(x))'],
      ['(x+1)^3', 'x^3+3*x^2+3*x+1'], ['cos(x)^2', '1-sin(x)^2'], ['x/2+x/3', '5*x/6'],
    ];
    for (const [a, b] of pairs) expect(equivVerdict(a, b), `${a} vs ${b}`).not.toBe(false);
  });
  test('is symmetric', () => {
    expect(equivVerdict('x^2+2*x+1', '(x+1)^2')).toBe(equivVerdict('(x+1)^2', 'x^2+2*x+1'));
    expect(equivVerdict('x+1', 'x+2')).toBe(equivVerdict('x+2', 'x+1'));
  });
  test('an undecided case is undefined unproven (Y206) with a detail that mentions random testing', () => {
    for (const [a, b] of [['sin(x)^2+cos(x)^2', '1'], ['sin(2*x)', '2*sin(x)*cos(x)'], ['ln(x^2)', '2*ln(abs(x))']] as const) {
      const { cell } = ran('Equivalent', [ex(a), ex(b)]);
      if (!cell.defined) {
        expect(cell.reason).toBe('unproven');
        expect(cell.detail?.code).toBe('Y206');
        expect(cell.detail?.text.toLowerCase()).toContain('random');
      }
    }
  });
  test('cancelling a factor is true with notice differ_at (Y112)', () => {
    expect(equivVerdict('(x^2-1)/(x-1)', 'x+1')).toBe(true);
    expect(noticeKinds('Equivalent', [ex('(x^2-1)/(x-1)'), ex('x+1')])).toContain('differ_at');
  });
  test('conditions: same solution set is equivalent', () => {
    expect(asBool(val('Equivalent', [cd('x+1==3'), cd('x==2')]), 'eq')).toBe(true);
    expect(asBool(val('Equivalent', [cd('2*x==4'), cd('x==2')]), 'eq')).toBe(true);
    expect(asBool(val('Equivalent', [cd('x+1==3'), cd('x==3')]), 'eq')).toBe(false);
  });
});

describe('IsZero', () => {
  test('true for an expression that expands to zero', () => {
    expect(asBool(val('IsZero', [ex('(x+1)^2-x^2-2*x-1')]), 'iz')).toBe(true);
    expect(asBool(val('IsZero', [ex('0')]), 'iz')).toBe(true);
  });
  test('true for exact algebraic numbers that are zero', () => {
    expect(asBool(val('IsZero', [ex('sqrt(2)^2-2')]), 'iz')).toBe(true);
  });
  test('false when a counter-example exists', () => {
    expect(asBool(val('IsZero', [ex('x')]), 'iz')).toBe(false);
    expect(asBool(val('IsZero', [ex('1/1000000')]), 'iz')).toBe(false);
  });
  test('the trig identity is true or unproven, never false', () => {
    const { cell } = ran('IsZero', [ex('sin(x)^2+cos(x)^2-1')]);
    if (cell.defined) expect(cell.value).toEqual({ k: 'bool', v: true });
    else expect(cell.reason).toBe('unproven');
  });
});
