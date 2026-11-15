/**
 * Correctness findings fixed in CAS round 6 (handoff/symbolic/findings.md SYM-SM-16, 17, 19, 21, 23, 25, 27;
 * cas/design.md 2.3, 5.6, 5.8, 5.9, 5.11, 5.13; .kiro/specs/cas task 10).
 */
import { describe, expect, it } from 'vitest';
import { clearCache, condText, floatN, parseExpression, run, toText } from '@incantly/symbolic';
import type { SymArg } from '@incantly/symbolic';
import { cd, ex, sy } from './helpers';

const value = (r: ReturnType<typeof run>): SymArg => {
  if (!r.ok || !r.value.cell.defined) throw new Error('undefined');
  return r.value.cell.value;
};
const exprText = (r: ReturnType<typeof run>): string => {
  const v = value(r);
  return v.k === 'expr' ? toText(v.e) : '?';
};
const conds = (r: ReturnType<typeof run>): string[] => {
  const v = value(r);
  return v.k === 'list' ? v.items.map((i) => (i.k === 'cond' ? condText(i.c) : '?')) : [];
};
const cases = (r: ReturnType<typeof run>): string[] => {
  const v = value(r);
  return v.k === 'list' ? (v.cases ?? []).map((c) => `${condText(c.when)} -> ${typeof c.solutions === 'string' ? c.solutions : c.solutions.map((s) => toText(s)).join(', ')}`) : [];
};

describe('Factor recovers every factor (SYM-SM-17, acceptance 3)', () => {
  it.each([
    ['x^12 - 1', '(x - 1) * (x + 1) * (x^2 - x + 1) * (x^2 + 1) * (x^2 + x + 1) * (x^4 - x^2 + 1)'],
    ['x^4 + 4', '(x^2 - 2 * x + 2) * (x^2 + 2 * x + 2)'],
    ['x^10 - 1', '(x - 1) * (x + 1) * (x^4 - x^3 + x^2 - x + 1) * (x^4 + x^3 + x^2 + x + 1)'],
    ['(x^2 + 3*x + 7)*(2*x^3 - x + 5)*(x^2 - 2)', '(2 * x^3 - x + 5) * (x^2 - 2) * (x^2 + 3 * x + 7)'],
    ['x^2 - y^2', '(x - y) * (x + y)'],
    ['6*x^2 - 6*y^2', '6 * (x - y) * (x + y)'],
    ['x^2 + 2*x*y + y^2 - z^2', '(x + y - z) * (x + y + z)'],
    ['x^4 - y^4', '(x - y) * (x + y) * (x^2 + y^2)'],
    ['a*x + a*y + b*x + b*y', '(a + b) * (x + y)'],
  ])('Factor(%s) is %s', (input, want) => {
    expect(exprText(run('Factor', [ex(input)]))).toBe(want);
  });

  it('x^30 - 1 splits into its eight cyclotomic factors', () => {
    const t = exprText(run('Factor', [ex('x^30 - 1')]));
    expect(t.split(') * (').length).toBe(8);
  });

  it('irreducible inputs come back whole', () => {
    for (const e of ['x^4 + 1', 'x^5 - x - 1', 'x^6 - 2*x^5 - 3*x^4 + 8*x^3 + 3*x^2 - 8*x + 4']) {
      expect(exprText(run('Factor', [ex(e)]))).toBe(toText(parseExpression(e)));
    }
  });
});

// The targets themselves (5 ms, 3 ms on the reference machine) are checked by bench/cas.bench.ts; a shared CI runner
// is several times slower, so these ceilings only catch a return to the old search (85 ms on the reference machine).
describe('speed (SYM-SM-25, design 5.13)', () => {
  const ms = (f: () => void): number => {
    for (let i = 0; i < 3; i++) {
      clearCache();
      f();
    }
    const t = performance.now();
    for (let i = 0; i < 10; i++) {
      clearCache();
      f();
    }
    return (performance.now() - t) / 10;
  };
  it('Factor of the degree-6 bench polynomial stays far below the old 85 ms', () => {
    expect(ms(() => void run('Factor', [ex('x^6 - 2*x^5 - 3*x^4 + 8*x^3 + 3*x^2 - 8*x + 4')]))).toBeLessThan(30);
  });
  it('Solve of the general quadratic stays within a loose ceiling', () => {
    expect(ms(() => void run('Solve', [cd('a*x^2 + b*x + c == 0'), sy('x')]))).toBeLessThan(40);
  });
});

describe('case splits list only possible values (SYM-SM-16)', () => {
  it('x^2 == a has no real solution when a < 0', () => {
    expect(cases(run('Solve', [cd('x^2 == a'), sy('x')]))).toEqual(['a < 0 -> none']);
  });
  it('a*x == 0 is every x when a == 0', () => {
    expect(cases(run('Solve', [cd('a*x == 0'), sy('x')]))).toEqual(['a == 0 -> all']);
  });
  it('a*x == b splits on a and b only', () => {
    expect(cases(run('Solve', [cd('a*x == b'), sy('x')]))).toEqual(['a == 0 and b == 0 -> all', 'a == 0 and b != 0 -> none']);
  });
  it('the general quadratic adds the negative discriminant', () => {
    expect(cases(run('Solve', [cd('a*x^2 + b*x + c == 0'), sy('x')]))).toContain('a != 0 and -4 * a * c + b^2 < 0 -> none');
  });
  it('an equation with no parameter has no cases', () => {
    expect(cases(run('Solve', [cd('ln(x) == 1'), sy('x')]))).toEqual([]);
  });
});

describe('printed text parses back (SYM-SM-19)', () => {
  it('an inexact number prints as float(…) and reads back inexact', () => {
    const f = floatN(0.5);
    expect(toText(f)).toBe('float(0.5)');
    expect(parseExpression(toText(f))).toBe(f);
    expect(toText(f, { display: true })).toBe('0.5');
  });
});

describe('family parameters (SYM-SM-21)', () => {
  it('a parameter skips names the input already uses', () => {
    // k1 appears in the input (on both sides), so the period parameter is k2
    const t = conds(run('Solve', [cd('sin(x) + k1 == k1 + 1/2'), sy('x')])).join(' ');
    expect(t).toContain('k2');
    expect(t).not.toContain('k1');
  });
});

describe('a sin + b cos stays exact (SYM-SM-23)', () => {
  it('Solve(sin(x) == cos(x), x) is pi/4 plus a period', () => {
    const t = conds(run('Solve', [cd('sin(x) == cos(x)'), sy('x')]));
    expect(t[0]).toBe('x == pi/4 + 2 * pi * k1');
    expect(t.join(' ')).not.toMatch(/0\.785/);
  });
});

describe('results in their tidy form (SYM-SM-27)', () => {
  it('Factor(6/35) is 2 * 3 / (5 * 7)', () => {
    expect(exprText(run('Factor', [ex('6/35')]))).toBe('2 * 3 / (5 * 7)');
  });
  it('a cancelled square names its value: x != -1', () => {
    const v = value(run('Simplify', [ex('(x^2 + 2*x + 1)/(x + 1)^3')]));
    expect(v.k === 'expr' ? toText(v.e) : '').toBe('1 / (x + 1)');
    expect(v.k === 'expr' ? (v.excluded ?? []).map((c) => condText(c)) : []).toEqual(['x != -1']);
  });
  it('CSolve(exp(x) == -1) uses i pi for ln(-1)', () => {
    expect(conds(run('CSolve', [cd('exp(x) == -1'), sy('x')]))).toEqual(['x == i * pi + 2 * i * pi * k1']);
  });
});
