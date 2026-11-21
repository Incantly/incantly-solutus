/**
 * Budgets hold for every input (cas/design.md 5.13; findings SYM-SM-3 and SYM-SM-4; .kiro/specs/cas R1).
 * Each case was an evidence line of a finding: it ran out of memory or ran for seconds past its budget.
 */
import { describe, expect, it } from 'vitest';
import { binomialExact, run } from '@incantly/symbolic/engine';
import type { RunOptions, SymArg } from '@incantly/symbolic/engine';
import { ex, tx } from './helpers';

const timed = (op: Parameters<typeof run>[0], args: readonly SymArg[], opts: RunOptions) => {
  const t = performance.now();
  const r = run(op, args, opts);
  return { ms: performance.now() - t, r };
};
const cell = (r: ReturnType<typeof run>) => {
  expect(r.ok).toBe(true);
  return r.ok ? r.value.cell : undefined;
};

describe('size limits are checked before a value is built (SYM-SM-3)', () => {
  it('Factor of x^2 - (10^1000)^99 ends as a refusal, without running out of memory', { retry: 2 }, () => {
    const { ms, r } = timed('Factor', [ex('x^2 - (10^1000)^99')], { limits: { maxMs: 50 } });
    const c = cell(r);
    expect(c?.defined).toBe(false);
    expect(['timeout', 'limit']).toContain(c && !c.defined ? c.reason : '');
    expect(ms).toBeLessThan(1000);
  });

  it('2^(2000000001/2) is a digits limit, at once', { retry: 2 }, () => {
    const { ms, r } = timed('Simplify', [ex('2^(2000000001/2)')], { limits: { maxMs: 50 } });
    const c = cell(r);
    expect(c && !c.defined ? c.reason : '').toBe('limit');
    expect(ms).toBeLessThan(200);
  });

  it('a power past 100,000 digits is a limit, and its message stays short', () => {
    const c = cell(run('Simplify', [ex('(10^1000)^65536')], { limits: { maxMs: 50 } }));
    expect(c && !c.defined ? c.reason : '').toBe('limit');
    const text = c && !c.defined ? c.detail?.text ?? '' : '';
    expect(text.length).toBeLessThan(200);
  });

  it('(10^100)^65536 typed as text stays a power and is quick', { retry: 2 }, () => {
    const { ms, r } = timed('Expr', [tx('(10^100)^65536')], { limits: { maxMs: 50 } });
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(200);
  });

  it('a polynomial power whose coefficients would pass the limit is refused', () => {
    const c = cell(run('Expand', [ex('(x + 10^50)^5000')], { limits: { maxMs: 200 } }));
    expect(c?.defined).toBe(false);
  });
});

describe('loops that grow with the input tick the run budget (SYM-SM-4)', () => {
  it('Simplify of 40 large square roots stops near its budget', { retry: 2 }, () => {
    const sum = Array.from({ length: 40 }, (_, i) => `sqrt(${i + 2} * 1000000000039)`).join(' + ');
    const { ms } = timed('Simplify', [ex(sum)], { limits: { maxMs: 200 } });
    expect(ms).toBeLessThan(400);
  });

  it.each([
    ['IsPrime', '2^4423 - 1'],
    ['NextPrime', '10^600'],
    ['PrimeFactors', '(2^61 - 1) * (2^89 - 1) * 1000000007 * 998244353'],
  ] as const)('%s(%s) stops within twice its budget', (op, e) => {
    const { ms, r } = timed(op, [ex(e)], { limits: { maxMs: 50 } });
    expect(r.ok).toBe(true);
    expect(ms).toBeLessThan(100);
  });

  it('the divisor count of a product of 30 primes comes from the factorisation, at once', { retry: 2 }, () => {
    const p30 = '2*3*5*7*11*13*17*19*23*29*31*37*41*43*47*53*59*61*67*71*73*79*83*89*97*101*103*107*109*113';
    const { ms, r } = timed('Divisors', [ex(p30)], { limits: { maxMs: 50, maxSteps: 1000 } });
    const c = cell(r);
    expect(c?.defined).toBe(true);
    expect(ms).toBeLessThan(100);
  });

  it('DivisorsList of a number with a billion divisors is refused, not listed', () => {
    const p30 = '2*3*5*7*11*13*17*19*23*29*31*37*41*43*47*53*59*61*67*71*73*79*83*89*97*101*103*107*109*113';
    const c = cell(run('DivisorsList', [ex(p30)], { limits: { maxMs: 50 } }));
    expect(c && !c.defined ? c.reason : '').toBe('limit');
  });

  it('binomialExact refuses a k past a million instead of looping', () => {
    expect(binomialExact(10n ** 9n, 5_000_000n)).toBeUndefined();
    expect(binomialExact(10n, 3n)).toBe(120n);
  });
});
