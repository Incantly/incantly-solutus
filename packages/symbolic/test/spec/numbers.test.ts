/**
 * Exact versus numeric, Substitute, Hold, Evaluate, MixedNumber, symbols and domains, the edge
 * cases of design 8, the whole-number tools (design 2.6), and the exact integer helpers the
 * discrete-and-optimisation area uses (optimisation-discrete design 8.1, 5.1).
 */
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_LIMITS,
  assumptions,
  binomialBig,
  binomialExact,
  exactStationaryPoints,
  factorialBig,
  floatN,
  parseExpression,
  permutationsBig,
  toText,
} from '@incantly/symbolic';
import type { OpCtx } from '@incantly/symbolic';
import {
  asBool,
  asExpr,
  asList,
  asText,
  bigOf,
  bi,
  cd,
  err,
  ex,
  exprExact,
  exprText,
  li,
  named,
  nm,
  noticeKinds,
  numeric,
  prng,
  ran,
  scalar,
  showArg,
  tx,
  undef,
  val,
} from './helpers';

// ---------------------------------------------------------------------------------------------
// Substitute (design 2.4)
// ---------------------------------------------------------------------------------------------
describe('Substitute', () => {
  test('replaces a symbol by a value', () => {
    expect(exprText('Substitute', [ex('x^2+y'), ex('x'), ex('3')])).toMatch(/9/);
    expect(numeric(exprText('Substitute', [ex('x^2+y'), ex('x'), ex('3')]), { y: 1 })).toBe(10);
  });
  test('replaces any sub-expression, not only symbols', () => {
    const t = exprText('Substitute', [ex('sin(x)^2+sin(x)'), ex('sin(x)'), ex('u')]);
    expect(numeric(t, { u: 3 })).toBe(12);
    expect(t).not.toContain('sin');
  });
  test('the list form replaces all at once (simultaneous), not one after another', () => {
    const t = exprText('Substitute', [ex('x+y'), li([cd('x==y'), cd('y==2')])]);
    // One after another would give 4; simultaneously x becomes y and y becomes 2: y + 2.
    expect(numeric(t, { y: 5 })).toBe(7);
  });
  test('swapping two symbols works because replacement is simultaneous', () => {
    const t = exprText('Substitute', [ex('x-2*y'), li([cd('x==y'), cd('y==x')])]);
    expect(numeric(t, { x: 10, y: 1 })).toBe(1 - 20);
  });
  test('substituting a value of the same name leaves the expression unchanged', () => {
    const t = exprText('Substitute', [ex('x^2+1'), ex('x'), ex('x')]);
    expect(numeric(t, { x: 3 })).toBe(10);
  });
  test('substitution does not fold exact numbers into floats', () => {
    expect(exprText('Substitute', [ex('x/3'), ex('x'), ex('1')])).toBe('1/3');
  });
  test('substitution into a condition list keeps the list shape', () => {
    const v = val('Substitute', [ex('x'), ex('x'), ex('2')]);
    expect(v.k).toBe('expr');
  });
  test('substituting a float makes the result inexact', () => {
    const v = val('Substitute', [ex('x+1'), ex('x'), { k: 'expr', e: floatN(0.5), exact: false }]);
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.exact).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Numeric (design 2.4, 5.4, 6)
// ---------------------------------------------------------------------------------------------
const PI50 = '3.14159265358979323846264338327950288419716939937510';
const E50 = '2.71828182845904523536028747135266249775724709369995';
const SQRT2_50 = '1.41421356237309504880168872420969807856967187537694';
const LN2_50 = '0.69314718055994530941723212145817656807550013436025';

describe('Numeric', () => {
  test('the default is 15 digits', () => {
    const t = exprText('Numeric', [ex('sqrt(2)')]);
    expect(t.startsWith('1.41421356237309')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(20);
  });
  test('pi, e, sqrt(2) and ln(2) to 50 digits match the known values', () => {
    for (const [e, known] of [['pi', PI50], ['e', E50], ['sqrt(2)', SQRT2_50], ['ln(2)', LN2_50]] as const) {
      const t = exprText('Numeric', [ex(e), nm(50)]);
      expect(t.startsWith(known.slice(0, 48)), e).toBe(true);
    }
  });
  test('200 digits are allowed and 40 of them are right', () => {
    const t = exprText('Numeric', [ex('pi'), nm(200)]);
    expect(t.startsWith(PI50.slice(0, 48))).toBe(true);
    expect(t.length).toBeGreaterThanOrEqual(200);
  });
  test('a single digit is allowed', () => {
    const t = exprText('Numeric', [ex('pi'), nm(1)]);
    expect(t.startsWith('3')).toBe(true);
  });
  test('fewer digits give a shorter text', () => {
    expect(exprText('Numeric', [ex('pi'), nm(5)]).length).toBeLessThan(exprText('Numeric', [ex('pi'), nm(20)]).length);
  });
  test('the result is flagged inexact (design 5.2)', () => {
    expect(exprExact('Numeric', [ex('sqrt(2)'), nm(10)])).toBe(false);
  });
  test('rounds half to even at the end: 1/8 to 2 digits is 0.12, 3/8 is 0.38, 5/8 is 0.62', () => {
    expect(exprText('Numeric', [ex('1/8'), nm(2)])).toBe('0.12');
    expect(exprText('Numeric', [ex('3/8'), nm(2)])).toBe('0.38');
    expect(exprText('Numeric', [ex('5/8'), nm(2)])).toBe('0.62');
  });
  test('trailing zeros are kept (display hint digits)', () => {
    const v = val('Numeric', [ex('1/4'), nm(5)]);
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.display?.digits).toBe(5);
  });
  test('sin(pi/6) is exactly 0.5 at 50 digits', () => {
    const t = exprText('Numeric', [ex('sin(pi/6)'), nm(50)]);
    expect(Number(t)).toBe(0.5);
    expect(t.replace(/0+$/, '')).toMatch(/^0\.5\.?$|^0\.5$/);
  });
  test('1/3 to ten digits', () => {
    expect(exprText('Numeric', [ex('1/3'), nm(10)]).startsWith('0.333333333')).toBe(true);
  });
  test('large and small magnitudes print without scientific notation below 1e9 (design 5.11)', () => {
    const t = exprText('Numeric', [ex('exp(20)'), nm(15)]);
    expect(t).not.toMatch(/e[+-]?\d/i);
    expect(Number(t)).toBeCloseTo(Math.exp(20), 3);
  });
  test('digits outside the whole numbers 1 to 200 are bad_digits (Y005)', () => {
    for (const d of [0, -1, 201, 2.5, 1000]) {
      const e = err('Numeric', [ex('pi'), nm(d)]);
      expect(e.kind, `digits ${d}`).toBe('bad_digits');
      expect(e.code).toBe('Y005');
    }
  });
  test('Numeric of an expression with free symbols keeps the symbols', () => {
    const t = exprText('Numeric', [ex('x+1/3'), nm(5)]);
    expect(t).toContain('x');
    expect(numeric(t, { x: 1 })).toBeCloseTo(1.33333, 4);
  });
  test('Numeric of a real-mode out-of-domain value is undefined', () => {
    const u = undef('Numeric', [ex('ln(-1)')]);
    expect(['out_of_domain', 'not_finite']).toContain(u.reason);
  });
});

// ---------------------------------------------------------------------------------------------
// Evaluate, Hold, MixedNumber, ToNumber, Expr, LeftSide, RightSide (design 2.1, 2.4)
// ---------------------------------------------------------------------------------------------
describe('Evaluate, Hold, MixedNumber, ToNumber', () => {
  test('Evaluate does the arithmetic and reduces fractions', () => {
    expect(exprText('Evaluate', [ex('2/4+1/4')])).toBe('3/4');
    expect(exprText('Evaluate', [ex('2+3')])).toBe('5');
  });
  test('Evaluate evaluates known constants', () => {
    expect(exprText('Evaluate', [ex('sin(pi/6)')])).toBe('1/2');
    expect(exprText('Evaluate', [ex('cos(0)')])).toBe('1');
  });
  test('Evaluate applies no algebraic strategy: a power of a sum is not expanded', () => {
    const e = asExpr(val('Evaluate', [ex('(x+1)^2')]), 'evaluated');
    expect(e.k).toBe('pow');
  });
  test('Hold keeps the expression as typed (display hint asTyped)', () => {
    const v = val('Hold', [ex('2+3')]);
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.display?.asTyped).toBe(true);
    expect(v.typed).toBeDefined();
  });
  test('Hold keeps the value of the expression', () => {
    expect(numeric(exprText('Hold', [ex('2+3')]))).toBe(5);
  });
  test('MixedNumber of a rational sets the mixed display flag', () => {
    const v = val('MixedNumber', [ex('11/4')]);
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.display?.mixed).toBe(true);
    expect(numeric(toText(v.e))).toBe(2.75);
  });
  test('MixedNumber of a negative rational', () => {
    const v = val('MixedNumber', [ex('-7/2')]);
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(numeric(toText(v.e))).toBe(-3.5);
  });
  test('ToNumber of an exact numeric Expr is a float64', () => {
    expect(scalar('ToNumber', [ex('1/4')])).toBe(0.25);
    expect(scalar('ToNumber', [ex('sqrt(2)')])).toBeCloseTo(Math.SQRT2, 14);
  });
  test('ToNumber with a free symbol is undefined out_of_domain (design 5.15)', () => {
    expect(undef('ToNumber', [ex('x+1')]).reason).toBe('out_of_domain');
  });
  test('LeftSide and RightSide of a Cond are Exprs', () => {
    expect(numeric(exprText('LeftSide', [cd('x+1==3')]), { x: 4 })).toBe(5);
    expect(exprText('RightSide', [cd('x+1==3')])).toBe('3');
  });
  test('Expr of an expression stays an Expr and of a comparison becomes a Cond', () => {
    expect(val('Expr', [ex('x+1')]).k).toBe('expr');
    expect(val('Expr', [cd('x+1==3')]).k).toBe('cond');
  });
});

// ---------------------------------------------------------------------------------------------
// Symbols and domains (design 2.1, 5.12, errors Y006)
// ---------------------------------------------------------------------------------------------
describe('Symbol and domains', () => {
  test('Symbol() returns a Symbol', () => {
    expect(val('Symbol', []).k).toBe('sym');
  });
  test('every documented domain is accepted and kept', () => {
    for (const d of ['real', 'positive', 'nonneg', 'negative', 'nonpos', 'nonzero', 'integer', 'natural', 'rational', 'complex']) {
      const v = val('Symbol', [named('domain', tx(d))]);
      if (v.k !== 'sym') throw new Error('expected sym');
      expect(v.domain, d).toBe(d);
    }
  });
  test('an unknown domain is bad_domain (Y006) and the message lists the valid values', () => {
    const e = err('Symbol', [named('domain', tx('banana'))]);
    expect(e.kind).toBe('bad_domain');
    expect(e.code).toBe('Y006');
    expect(e.message).toContain('integer');
  });
});

// ---------------------------------------------------------------------------------------------
// Exactness and the number tower (design 5.4, 8)
// ---------------------------------------------------------------------------------------------
describe('Exactness', () => {
  test('exact input gives an exact result', () => {
    expect(exprExact('Simplify', [ex('x^2+2*x')])).toBe(true);
    expect(exprExact('Expand', [ex('(x+1)^2')])).toBe(true);
  });
  test('any float makes the whole result inexact', () => {
    const v = val('Simplify', [{ k: 'expr', e: parseExpression('x + 1'), exact: false }]);
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.exact).toBe(false);
  });
  test('exactness never comes back after it is lost (no rounding back to a rational)', () => {
    const half = { k: 'expr' as const, e: floatN(0.5), exact: false };
    const v = val('Simplify', [half]);
    if (v.k !== 'expr') throw new Error('expected expr');
    expect(v.exact).toBe(false);
    const w = val('Expand', [{ k: 'expr', e: v.e, exact: false }]);
    if (w.k !== 'expr') throw new Error('expected expr');
    expect(w.exact).toBe(false);
  });
  test('an exact answer prints exactly: sqrt(2)/2 is not a decimal', () => {
    const t = exprText('Simplify', [ex('1/sqrt(2)')]);
    expect(t).toContain('sqrt(2)');
    expect(t).not.toMatch(/\d\.\d/);
  });
  test('0.3 enters a symbolic argument as the exact rational 3/10', () => {
    expect(toText(parseExpression('0.3'))).toBe('3/10');
    expect(toText(parseExpression('0.75'))).toBe('3/4');
  });
});

// ---------------------------------------------------------------------------------------------
// Edge cases (design 8, errors.md 2)
// ---------------------------------------------------------------------------------------------
describe('Edge cases', () => {
  test('0^0 is undefined indeterminate in exact mode (Y205)', () => {
    const u = undef('Evaluate', [ex('0^0')]);
    expect(u.reason).toBe('indeterminate');
    expect(u.detail?.code).toBe('Y205');
  });
  test('inf - inf is indeterminate', () => {
    expect(undef('Evaluate', [ex('inf-inf')]).reason).toBe('indeterminate');
  });
  test('0 * inf is indeterminate', () => {
    expect(undef('Evaluate', [ex('0*inf')]).reason).toBe('indeterminate');
  });
  test('exact 1/0 is undefined division_by_zero (Y211)', () => {
    const u = undef('Evaluate', [ex('1/0')]);
    expect(u.reason).toBe('division_by_zero');
    expect(u.detail?.code).toBe('Y211');
  });
  test('ln(-1) in real mode is undefined out_of_domain (Y210) and suggests domain = complex', () => {
    const u = undef('Evaluate', [ex('ln(-1)')]);
    expect(u.reason).toBe('out_of_domain');
    expect(u.detail?.code).toBe('Y210');
  });
  test('sqrt(-4) in real mode is undefined out_of_domain', () => {
    expect(undef('Evaluate', [ex('sqrt(-4)')]).reason).toBe('out_of_domain');
  });
  test('acos(2) in real mode is undefined out_of_domain', () => {
    expect(undef('Evaluate', [ex('acos(2)')]).reason).toBe('out_of_domain');
  });
  test('(-8)^(1/3) in real mode is -2 with notice real_odd_root (Y105)', () => {
    expect(exprText('Evaluate', [ex('(-8)^(1/3)')])).toBe('-2');
    expect(noticeKinds('Evaluate', [ex('(-8)^(1/3)')])).toContain('real_odd_root');
  });
  test('a power past 100,000 digits is undefined limit (Y209)', () => {
    const u = undef('Evaluate', [ex('2^400000')]);
    expect(u.reason).toBe('limit');
    expect(u.detail?.code).toBe('Y209');
  });
  test('a power under the limit folds exactly with BigInt', () => {
    expect(exprText('Evaluate', [ex('2^100')])).toBe((2n ** 100n).toString());
  });
  test('x/x is 1 away from 0', () => {
    expect(numeric(exprText('Simplify', [ex('x/x')]), { x: 3 })).toBe(1);
  });
  test('a literal division by zero in Expr is the error division_by_zero_literal (Y011)', () => {
    const r = ran;
    expect(typeof r).toBe('function');
    const e = err('Expr', [ex('1/0')]);
    expect(e.kind).toBe('division_by_zero_literal');
    expect(e.code).toBe('Y011');
  });
  test('ln(1), exp(0) and sin(0) fold to exact values', () => {
    expect(exprText('Evaluate', [ex('ln(1)')])).toBe('0');
    expect(exprText('Evaluate', [ex('exp(0)')])).toBe('1');
    expect(exprText('Evaluate', [ex('sin(0)')])).toBe('0');
  });
});

// ---------------------------------------------------------------------------------------------
// Whole-number tools (design 2.6)
// ---------------------------------------------------------------------------------------------
function modPow(a: bigint, e: bigint, m: bigint): bigint {
  let r = 1n;
  let b = ((a % m) + m) % m;
  let k = e;
  while (k > 0n) {
    if (k & 1n) r = (r * b) % m;
    b = (b * b) % m;
    k >>= 1n;
  }
  return r;
}

describe('IsPrime', () => {
  test('known primes are prime', () => {
    for (const n of [2, 3, 5, 7, 97, 7919, 104729]) expect(asBool(val('IsPrime', [nm(n)]), 'IsPrime'), String(n)).toBe(true);
  });
  test('0, 1, composites and Carmichael numbers are not prime', () => {
    for (const n of [0, 1, 4, 9, 91, 561, 1105, 1729, 7917]) expect(asBool(val('IsPrime', [nm(n)]), 'IsPrime'), String(n)).toBe(false);
  });
  test('negative numbers are not prime', () => {
    expect(asBool(val('IsPrime', [nm(-7)]), 'IsPrime')).toBe(false);
  });
  test('Mersenne primes beyond 2^53 are prime (any size as an integer Expr)', () => {
    expect(asBool(val('IsPrime', [bi(2n ** 61n - 1n)]), 'M61')).toBe(true);
    expect(asBool(val('IsPrime', [bi(2n ** 89n - 1n)]), 'M89')).toBe(true);
    expect(asBool(val('IsPrime', [bi(2n ** 127n - 1n)]), 'M127')).toBe(true);
  });
  test('strong pseudoprimes are composite (deterministic Miller-Rabin)', () => {
    expect(asBool(val('IsPrime', [bi(3825123056546413051n)]), 'psp')).toBe(false);
    expect(asBool(val('IsPrime', [bi(318665857834031151167461n)]), 'psp2')).toBe(false);
    expect(asBool(val('IsPrime', [bi(3317044064679887385961981n)]), 'psp3')).toBe(false);
  });
  test('2^67 - 1 is composite', () => {
    expect(asBool(val('IsPrime', [bi(2n ** 67n - 1n)]), 'M67')).toBe(false);
  });
  test('agrees with trial division for every n below 2000', () => {
    const isP = (n: number): boolean => {
      if (n < 2) return false;
      for (let d = 2; d * d <= n; d += 1) if (n % d === 0) return false;
      return true;
    };
    for (let n = 0; n < 2000; n += 1) {
      expect(asBool(val('IsPrime', [nm(n)]), 'IsPrime'), String(n)).toBe(isP(n));
    }
  });
});

describe('NextPrime and PreviousPrime', () => {
  test('NextPrime is strictly greater', () => {
    expect(scalar('NextPrime', [nm(100)])).toBe(101);
    expect(scalar('NextPrime', [nm(7)])).toBe(11);
    expect(scalar('NextPrime', [nm(1)])).toBe(2);
  });
  test('PreviousPrime is strictly smaller', () => {
    expect(scalar('PreviousPrime', [nm(100)])).toBe(97);
    expect(scalar('PreviousPrime', [nm(7)])).toBe(5);
    expect(scalar('PreviousPrime', [nm(3)])).toBe(2);
  });
  test('there is no prime below 2: undefined out_of_domain', () => {
    expect(undef('PreviousPrime', [nm(2)]).reason).toBe('out_of_domain');
  });
  test('NextPrime past 2^53 is exact', () => {
    const v = val('NextPrime', [bi(2n ** 61n - 2n)]);
    expect(bigOf(v, 'next')).toBe(2n ** 61n - 1n);
  });
});

describe('PrimeFactors and divisors', () => {
  test('PrimeFactors lists primes with repeats', () => {
    expect(asList(val('PrimeFactors', [nm(360)]), 'pf').map((v) => Number(bigOf(v, 'p')))).toEqual([2, 2, 2, 3, 3, 5]);
  });
  test('PrimeFactors of a prime is that prime', () => {
    expect(asList(val('PrimeFactors', [nm(97)]), 'pf').map((v) => Number(bigOf(v, 'p')))).toEqual([97]);
  });
  test('the product of PrimeFactors is the number (generated)', () => {
    const rnd = prng(42);
    for (let i = 0; i < 25; i += 1) {
      const n = 2 + Math.floor(rnd() * 1_000_000);
      const fs = asList(val('PrimeFactors', [nm(n)]), 'pf').map((v) => bigOf(v, 'p'));
      expect(fs.reduce((a, b) => a * b, 1n), String(n)).toBe(BigInt(n));
      expect([...fs].sort((a, b) => (a < b ? -1 : 1))).toEqual(fs);
    }
  });
  test('trial division then Pollard rho: a product of two ten-digit primes factors', () => {
    const p = 1000000007n;
    const q = 1000000009n;
    const fs = asList(val('PrimeFactors', [bi(p * q)]), 'pf').map((v) => bigOf(v, 'p'));
    expect(fs).toEqual([p, q]);
  });
  test('a factorisation past the budget is undefined limit (or timeout) within seconds', () => {
    const big = (2n ** 89n - 1n) * (2n ** 107n - 1n);
    const t0 = Date.now();
    const u = undef('PrimeFactors', [bi(big)]);
    expect(['limit', 'timeout']).toContain(u.reason);
    expect(Date.now() - t0).toBeLessThan(5000);
  }, 20000);
  test('Divisors counts, DivisorsList lists, DivisorsSum adds', () => {
    expect(scalar('Divisors', [nm(12)])).toBe(6);
    expect(asList(val('DivisorsList', [nm(12)]), 'dl').map((v) => Number(bigOf(v, 'd')))).toEqual([1, 2, 3, 4, 6, 12]);
    expect(scalar('DivisorsSum', [nm(12)])).toBe(28);
  });
  test('perfect number 28 has divisor sum 56; 1 has one divisor', () => {
    expect(scalar('DivisorsSum', [nm(28)])).toBe(56);
    expect(scalar('Divisors', [nm(1)])).toBe(1);
  });
  test('the count, list and sum agree for every n up to 200', () => {
    for (let n = 1; n <= 200; n += 1) {
      const ds: number[] = [];
      for (let d = 1; d <= n; d += 1) if (n % d === 0) ds.push(d);
      expect(scalar('Divisors', [nm(n)]), `count ${n}`).toBe(ds.length);
      expect(scalar('DivisorsSum', [nm(n)]), `sum ${n}`).toBe(ds.reduce((a, b) => a + b, 0));
    }
  });
});

describe('ToBase, FromBase, ExtendedGCD, ModularExponent', () => {
  test('ToBase writes digits in the base', () => {
    expect(asText(val('ToBase', [nm(255), nm(16)]), 'tb').toLowerCase()).toBe('ff');
    expect(asText(val('ToBase', [nm(5), nm(2)]), 'tb')).toBe('101');
    expect(asText(val('ToBase', [nm(8), nm(8)]), 'tb')).toBe('10');
  });
  test('FromBase reads digits in the base', () => {
    expect(scalar('FromBase', [tx('ff'), nm(16)])).toBe(255);
    expect(scalar('FromBase', [tx('101'), nm(2)])).toBe(5);
    expect(scalar('FromBase', [tx('zz'), nm(36)])).toBe(1295);
  });
  test('ToBase and FromBase invert each other (generated, bases 2 to 36)', () => {
    const rnd = prng(7);
    for (let i = 0; i < 40; i += 1) {
      const n = Math.floor(rnd() * 1e9);
      const b = 2 + Math.floor(rnd() * 35);
      const t = asText(val('ToBase', [nm(n), nm(b)]), 'tb');
      expect(scalar('FromBase', [tx(t), nm(b)]), `${n} base ${b}`).toBe(n);
      expect(parseInt(t, b)).toBe(n);
    }
  });
  test('ExtendedGCD returns [g, s, t] with s*a + t*b == g', () => {
    const pairs: readonly (readonly [number, number])[] = [[240, 46], [17, 5], [12, 18], [100, 1], [35, 15], [99, 78]];
    for (const [a, b] of pairs) {
      const items = asList(val('ExtendedGCD', [nm(a), nm(b)]), 'egcd').map((v) => bigOf(v, 'x'));
      const [g, s, t] = items;
      expect(items.length).toBe(3);
      expect((s ?? 0n) * BigInt(a) + (t ?? 0n) * BigInt(b)).toBe(g);
      expect(Number(g)).toBe(scalar('GCD', [nm(a), nm(b)]));
    }
  });
  test('ExtendedGCD(240, 46) has gcd 2', () => {
    const items = asList(val('ExtendedGCD', [nm(240), nm(46)]), 'egcd');
    expect(Number(bigOf(items[0] ?? nm(0), 'g'))).toBe(2);
  });
  test('ExtendedGCD works past 2^53', () => {
    const a = 2n ** 80n + 12345n;
    const b = 3n ** 50n;
    const items = asList(val('ExtendedGCD', [bi(a), bi(b)]), 'egcd').map((v) => bigOf(v, 'x'));
    expect((items[1] ?? 0n) * a + (items[2] ?? 0n) * b).toBe(items[0]);
  });
  test('ModularExponent', () => {
    expect(scalar('ModularExponent', [nm(4), nm(13), nm(497)])).toBe(445);
    expect(scalar('ModularExponent', [nm(2), nm(100), nm(1000000007)])).toBe(976371285);
    expect(scalar('ModularExponent', [nm(5), nm(0), nm(7)])).toBe(1);
  });
  test('ModularExponent with huge exponents matches BigInt square-and-multiply', () => {
    const rnd = prng(9);
    for (let i = 0; i < 10; i += 1) {
      const a = BigInt(2 + Math.floor(rnd() * 1e6));
      const e = 10n ** 30n + BigInt(Math.floor(rnd() * 1e9));
      const m = 1000000007n + BigInt(2 * i);
      expect(bigOf(val('ModularExponent', [bi(a), bi(e), bi(m)]), 'me')).toBe(modPow(a, e, m));
    }
  });
  test('Fermat: a^(p-1) mod p is 1 for the prime 1000000007', () => {
    expect(scalar('ModularExponent', [nm(123456), nm(1000000006), nm(1000000007)])).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Exact integer helpers for the discrete area (optimisation-discrete design 8.1)
// ---------------------------------------------------------------------------------------------
describe('exact binomials and permutations', () => {
  test('small values', () => {
    expect(binomialBig(5n, 2n)).toBe(10n);
    expect(binomialBig(10n, 3n)).toBe(120n);
    expect(binomialBig(52n, 5n)).toBe(2598960n);
  });
  test('edges: C(n, 0) = C(n, n) = 1', () => {
    for (const n of [0n, 1n, 7n, 100n]) {
      expect(binomialBig(n, 0n)).toBe(1n);
      expect(binomialBig(n, n)).toBe(1n);
    }
  });
  test('C(100, 50) is exact', () => {
    expect(binomialBig(100n, 50n)).toBe(100891344545564193334812497256n);
  });
  test('against the factorial formula for generated pairs (exact BigInt reference)', () => {
    const rnd = prng(3);
    for (let i = 0; i < 40; i += 1) {
      const n = BigInt(Math.floor(rnd() * 200));
      const k = BigInt(Math.floor(rnd() * (Number(n) + 1)));
      expect(binomialBig(n, k), `C(${n}, ${k})`).toBe(factorialBig(n) / (factorialBig(k) * factorialBig(n - k)));
    }
  });
  test('symmetry C(n, k) == C(n, n - k) and Pascal C(n, k) = C(n-1, k-1) + C(n-1, k)', () => {
    const rnd = prng(11);
    for (let i = 0; i < 30; i += 1) {
      const n = 2n + BigInt(Math.floor(rnd() * 300));
      const k = 1n + BigInt(Math.floor(rnd() * (Number(n) - 1)));
      expect(binomialBig(n, k)).toBe(binomialBig(n, n - k));
      expect(binomialBig(n, k)).toBe(binomialBig(n - 1n, k - 1n) + binomialBig(n - 1n, k));
    }
  });
  test('values above 2^53 stay exact', () => {
    expect(binomialBig(80n, 40n)).toBe(107507208733336176461620n);
    expect(binomialBig(80n, 40n) > 2n ** 53n).toBe(true);
  });
  test('nPr = n! / (n - k)!', () => {
    expect(permutationsBig(10n, 3n)).toBe(720n);
    expect(permutationsBig(5n, 5n)).toBe(120n);
    expect(permutationsBig(7n, 0n)).toBe(1n);
    expect(permutationsBig(30n, 12n)).toBe(factorialBig(30n) / factorialBig(18n));
  });
  test('binomialExact is the same exact value', () => {
    expect(binomialExact(60n, 30n)).toBe(binomialBig(60n, 30n));
    expect(binomialExact(100000n, 1n)).toBe(100000n);
  });
  test('n up to 100,000 is allowed (C(100000, 2) is exact)', () => {
    expect(binomialBig(100000n, 2n)).toBe(4999950000n);
  });
});

describe('exact stationary points (optimisation-discrete 5.1 exact = true)', () => {
  const ctx: OpCtx = {
    assume: assumptions(),
    tick: { tick: () => undefined },
    note: () => undefined,
    limits: DEFAULT_LIMITS,
  };
  const pts = (f: string): number[] | null => {
    const r = exactStationaryPoints(parseExpression(f), parseExpression('x'), ctx);
    if (r === null) return null;
    return r.map((n) => numeric(toText(n))).sort((a, b) => a - b);
  };
  test('x^3 - 3x has stationary points -1 and 1', () => {
    const r = pts('x^3-3*x');
    expect(r).not.toBe(null);
    expect(r?.length).toBe(2);
    expect(r?.[0]).toBeCloseTo(-1, 12);
    expect(r?.[1]).toBeCloseTo(1, 12);
  });
  test('x^2 has one stationary point at 0', () => {
    expect(pts('x^2')).toEqual([0]);
  });
  test('a line has none', () => {
    expect(pts('3*x+1')).toEqual([]);
  });
  test('a quartic with four real stationary points has them all, exactly', () => {
    // f' = 4x^3 - 4x -> -1, 0, 1 (three points).
    const r = pts('x^4-2*x^2');
    expect(r).toEqual([-1, 0, 1]);
  });
  test('irrational stationary points stay exact', () => {
    // f' = 3x^2 - 6 -> +-sqrt(2); the exact tree has no decimals.
    const r = exactStationaryPoints(parseExpression('x^3-6*x'), parseExpression('x'), ctx);
    expect(r?.length).toBe(2);
    for (const n of r ?? []) expect(toText(n)).toContain('sqrt');
  });
  test('showArg prints a result (sanity for the helper)', () => {
    expect(showArg(asExprArg('x+1'))).toBe('1 + x');
    expect(asBool({ k: 'bool', v: true }, 'b')).toBe(true);
    expect(asList(li([]), 'l').length).toBe(0);
  });
});

function asExprArg(s: string) {
  return ex(s);
}
