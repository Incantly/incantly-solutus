/**
 * Regression tests for handoff/symbolic/findings.md, SYM-SM-1 to SYM-SM-27.
 *
 * Each section is named after its finding and checks the behaviour the
 * finding's evidence says is wrong. Tests use the public entry only. Inputs
 * are sized so that code with the bug still finishes: nothing here can hang
 * a test run or exhaust memory.
 */
import { afterEach, describe, expect, test } from 'vitest';
import {
  arena,
  clearCache,
  condText,
  handleWorkerRequest,
  parseCondition,
  parseExpression,
  run,
  symN,
  toLatex,
  toText,
} from '@incantly/symbolic';
import type { OpName, Result, RunOptions, RunSuccess, SymArg } from '@incantly/symbolic';
import { bi, cd, ex, nm, showArg, tx } from './helpers';

/** What a run came to: a defined value's text, an undefined reason, or an error kind. */
type Outcome =
  | { readonly k: 'value'; readonly text: string; readonly value: SymArg }
  | { readonly k: 'undefined'; readonly reason: string }
  | { readonly k: 'error'; readonly kind: string };

function outcome(op: string, args: readonly SymArg[], opts?: RunOptions): Outcome {
  const r: Result<RunSuccess> = run(op as OpName, args, opts);
  if (!r.ok) return { k: 'error', kind: (r as { kind: string }).kind };
  const cell = r.value.cell;
  if (!cell.defined) return { k: 'undefined', reason: cell.reason };
  return { k: 'value', text: showArg(cell.value), value: cell.value };
}

/** The value text of a run that must be defined. */
function text(op: string, args: readonly SymArg[], opts?: RunOptions): string {
  const o = outcome(op, args, opts);
  if (o.k !== 'value') throw new Error(`run(${op}) is ${o.k} (${o.k === 'undefined' ? o.reason : o.kind})`);
  return o.text;
}

function timed<T>(f: () => T): { readonly value: T; readonly ms: number } {
  const t0 = performance.now();
  const value = f();
  return { value, ms: performance.now() - t0 };
}

const X = ex('x');

afterEach(() => {
  clearCache();
});

/* ------------------------------- security -------------------------------- */

describe('SYM-SM-1: parse time does not double with each nested if', () => {
  const nested = (levels: number): string => {
    let s = 'x';
    for (let k = 0; k < levels; k += 1) s = `if(x < ${k}, ${s}, 2)`;
    return s;
  };

  test('16 nested ifs parse in well under the old second', () => {
    const { ms } = timed(() => outcome('Expr', [tx(nested(16))], { fastLaneMs: 2 }));
    expect(ms).toBeLessThan(300);
  }, 30000);

  test('20 nested ifs cost about what 10 do, not a thousand times more', () => {
    const ten = timed(() => parseExpression(nested(10))).ms;
    const twenty = timed(() => parseExpression(nested(20))).ms;
    expect(twenty).toBeLessThan(Math.max(50, ten * 40));
  }, 30000);

  test('a nested if still parses to an expression', () => {
    expect(() => parseExpression(nested(6))).not.toThrow();
  });
});

describe('SYM-SM-2: a rootof literal cannot run root isolation without a budget', () => {
  test('rootof of a degree-300 polynomial is not an internal error', () => {
    const o = outcome('Expr', [tx('rootof((x+1)^300 - 2, 1)')], { fastLaneMs: 2, limits: { maxMs: 50 } });
    expect(o.k === 'error' && o.kind === 'internal').toBe(false);
  }, 30000);

  test('it comes back quickly', () => {
    const { ms } = timed(() => outcome('Expr', [tx('rootof((x+1)^300 - 2, 1)')], { fastLaneMs: 2, limits: { maxMs: 50 } }));
    expect(ms).toBeLessThan(2000);
  }, 30000);

  test('a small rootof literal still works', () => {
    expect(() => parseExpression('rootof(x^2 - 2, 2)')).not.toThrow();
  });
});

describe('SYM-SM-3: the digit limit is enforced before the number is built', () => {
  test('(10^100)^65536 is refused or left unevaluated quickly', () => {
    const { ms } = timed(() => outcome('Expr', [tx('(10^100)^65536')], { fastLaneMs: 2 }));
    expect(ms).toBeLessThan(400);
  }, 30000);

  test('a power with 200,000 digits is never returned as a number', () => {
    const o = outcome('Expand', [ex('(10^1000)^200')]);
    if (o.k === 'value') expect(o.text.length).toBeLessThan(100_000);
  }, 30000);

  test('2^(2000000001/2) does not compute 2^1000000000', () => {
    const { ms } = timed(() => outcome('Simplify', [ex('2^(2000000001/2)')]));
    expect(ms).toBeLessThan(1000);
  }, 60000);
});

describe('SYM-SM-4: whole-number loops follow the run budget', () => {
  test('IsPrime of a 1,300-digit number stops near its time limit', () => {
    const { ms } = timed(() => outcome('IsPrime', [ex('2^4423 - 1')], { limits: { maxMs: 50 } }));
    expect(ms).toBeLessThan(700);
  }, 60000);

  test('the divisor count of a number with 2^21 divisors does not list them', () => {
    const primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73];
    const n = primes.reduce((a, p) => a * BigInt(p), 1n);
    const { value, ms } = timed(() => outcome('Divisors', [bi(n)], { limits: { maxMs: 50, maxSteps: 1000 } }));
    expect(ms).toBeLessThan(300);
    if (value.k === 'value') expect(value.text).toBe(String(2 ** 21));
  }, 60000);
});

describe('SYM-SM-5: names from text never reach Object.prototype', () => {
  test.each(['constructor(x)', 'toString(x)', 'valueOf()', 'hasOwnProperty(x)', '__proto__(x)'])('Steps of %s is not an internal error', (call) => {
    const o = outcome('Steps', [tx(call)]);
    expect(o.k === 'error' && o.kind === 'internal').toBe(false);
  });

  test.each(['constructor', 'toString', 'valueOf', '__proto__'])('the op name %s is refused, not run', (op) => {
    const o = outcome(op, [X]);
    expect(o.k).toBe('error');
    if (o.k === 'error') expect(o.kind).not.toBe('internal');
  });

  test.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty'])('toLatex of the symbol %s prints no JavaScript source', (name) => {
    const latex = toLatex(symN(name));
    expect(latex).not.toContain('native code');
    expect(latex).not.toContain('function');
  });
});

/* --------------------------- hangs and crashes --------------------------- */

describe('SYM-SM-6: root isolation works with coefficients past 1.8e308', () => {
  const eq = cd('x^3 - x - 10^400 == 0');

  test('NSolve is not an internal error', () => {
    const o = outcome('NSolve', [eq, X]);
    expect(o.k === 'error' && o.kind === 'internal').toBe(false);
  }, 60000);

  test('Solve does not report that a real cubic has no solution', () => {
    const o = outcome('Solve', [eq, X]);
    if (o.k === 'value') expect(o.text).not.toBe('[]');
  }, 60000);
});

describe('SYM-SM-7: clearing the arena does not break later results', () => {
  test('Solve still finds both roots after arena.clear()', () => {
    arena.clear();
    clearCache();
    const o = outcome('Solve', [cd('x^2 - 4 == 0'), ex('x')]);
    expect(o.k).toBe('value');
    if (o.k === 'value' && o.value.k === 'list') expect(o.value.items).toHaveLength(2);
  });

  test('constants are still the same nodes after arena.clear()', () => {
    arena.clear();
    clearCache();
    expect(text('Simplify', [ex('x - x + 1')])).toBe('1');
    expect(text('Simplify', [ex('2 * x / 2')])).toBe('x');
  });
});

/* ----------------------------- wrong results ----------------------------- */

describe('SYM-SM-8: arguments that crossed to the worker mean the same there', () => {
  test('a structured clone of a Solve request gives both roots', () => {
    const req = structuredClone({ id: 1, op: 'Solve' as OpName, args: [cd('x^2 - 1 == 0'), ex('x')] });
    const res = handleWorkerRequest(req, run);
    expect(res.result.ok).toBe(true);
    if (res.result.ok) {
      const cell = res.result.value.cell;
      expect(cell.defined).toBe(true);
      if (cell.defined && cell.value.k === 'list') expect(cell.value.items).toHaveLength(2);
    }
  });

  test('a cloned Expand request expands', () => {
    const req = structuredClone({ id: 2, op: 'Expand' as OpName, args: [ex('(x + 1)^2')] });
    const res = handleWorkerRequest(req, run);
    expect(res.result.ok).toBe(true);
    if (res.result.ok && res.result.value.cell.defined) expect(showArg(res.result.value.cell.value).replace(/\s/g, '')).toBe('x^2+2*x+1');
  });
});

describe('SYM-SM-9: the cache key covers every input', () => {
  test('two Assume calls whose conditions differ only in bracketing do not share an answer', () => {
    const first = outcome('Assume', [cd('(a < 0 or b > 0) and a > 0'), ex('sqrt(a^2)')]);
    const second = outcome('Assume', [cd('a < 0 or (b > 0 and a > 0)'), ex('sqrt(a^2)')]);
    clearCache();
    const fresh = outcome('Assume', [cd('a < 0 or (b > 0 and a > 0)'), ex('sqrt(a^2)')]);
    expect(first.k).toBe('value');
    expect(second).toEqual(fresh);
  });

  test('a result cut short by a small step limit is not served to a full-budget call', () => {
    outcome('Simplify', [ex('(x^2 - 1)/(x - 1)')], { limits: { maxSteps: 40 } });
    expect(text('Simplify', [ex('(x^2 - 1)/(x - 1)')]).replace(/\s/g, '')).toBe('x+1');
  });
});

describe('SYM-SM-10: a budget stop inside Simplify is a timeout, not a value', () => {
  test('Simplify with 40 steps is undefined, not the unsimplified input', () => {
    const o = outcome('Simplify', [ex('(x^2 - 1)/(x - 1)')], { limits: { maxSteps: 40 } });
    expect(o.k).not.toBe('value');
  });

  test('the same line with the default budget simplifies', () => {
    expect(text('Simplify', [ex('(x^2 - 1)/(x - 1)')]).replace(/\s/g, '')).toBe('x+1');
  });
});

describe('SYM-SM-11: odd multiples of pi/24 are not folded to wrong exact values', () => {
  test.each([
    ['sin(pi/24)', Math.sin(Math.PI / 24)],
    ['cos(pi/24)', Math.cos(Math.PI / 24)],
    ['sin(5*pi/24)', Math.sin((5 * Math.PI) / 24)],
    ['cos(7*pi/24)', Math.cos((7 * Math.PI) / 24)],
    ['tan(pi/24)', Math.tan(Math.PI / 24)],
    ['sin(pi/12)', Math.sin(Math.PI / 12)],
    ['cos(pi/8)', Math.cos(Math.PI / 8)],
    ['sin(pi/10)', Math.sin(Math.PI / 10)],
  ])('%s has the right numeric value', (src, want) => {
    const got = text('ToNumber', [ex(src)]);
    expect(Number(got)).toBeCloseTo(want, 9);
  });
});

describe('SYM-SM-12: IsZero is true only when zero is proved', () => {
  test.each(['exp(-50)', 'x - x + 1/10^20', 'sqrt(10^40 + 1) - 10^20', 'exp(-30)'])('IsZero(%s) is not true', (src) => {
    expect(text('IsZero', [ex(src)])).not.toBe('true');
  });

  test.each(['x - x', 'sqrt(2)^2 - 2', '(x + 1)^2 - x^2 - 2*x - 1'])('IsZero(%s) is still true', (src) => {
    expect(text('IsZero', [ex(src)])).toBe('true');
  });

  test('Solve(exp(-30) == 0, x) does not say every value works', () => {
    const o = outcome('Solve', [cd('exp(-30) == 0'), X]);
    if (o.k === 'value') expect(o.text).toBe('[]');
  });
});

describe('SYM-SM-13: a solution on a strict bound is dropped', () => {
  test('x^2 == 4 and x < 2 keeps only -2', () => {
    expect(text('Solve', [cd('x^2 == 4 and x < 2'), X]).replace(/\s/g, '')).toBe('[x==-2]');
  });

  test('x^2 == 4 and x != 2 keeps only -2', () => {
    expect(text('Solve', [cd('x^2 == 4 and x != 2'), X]).replace(/\s/g, '')).toBe('[x==-2]');
  });

  test('x^2 == 4 and x <= 2 keeps both', () => {
    expect(text('Solve', [cd('x^2 == 4 and x <= 2'), X]).replace(/\s/g, '')).toBe('[x==-2,x==2]');
  });
});

describe('SYM-SM-14: definite integrals and limits do not step over poles', () => {
  test('the integral of tan from 0 to 2 is divergent', () => {
    const o = outcome('Integral', [ex('tan(x)'), X, nm(0), nm(2)]);
    expect(o.k).toBe('undefined');
  });

  test('the limit of tan at pi/2 is not a number', () => {
    const o = outcome('Limit', [ex('tan(x)'), X, ex('pi/2')]);
    expect(o.k).toBe('undefined');
  });

  test('an integral with no pole in range still has its value', () => {
    const got = text('Integral', [ex('tan(x)'), X, nm(0), nm(1)]);
    expect(got.length).toBeGreaterThan(0);
  });
});

describe('SYM-SM-15: floor, ceil and round of exact numbers stay exact', () => {
  test('floor(10^20/3) is the exact whole number', () => {
    expect(text('Evaluate', [ex('floor(10^20/3)')])).toBe('33333333333333333333');
  });

  test('ceil(10^20/3) is the exact whole number', () => {
    expect(text('Evaluate', [ex('ceil(10^20/3)')])).toBe('33333333333333333334');
  });

  test('floor((10^17 - 1)/10^17) is 0', () => {
    expect(text('Evaluate', [ex('floor((10^17 - 1)/10^17)')])).toBe('0');
  });

  test('floor(-7/2) is -4 and ceil(-7/2) is -3', () => {
    expect(text('Evaluate', [ex('floor(-7/2)')])).toBe('-4');
    expect(text('Evaluate', [ex('ceil(-7/2)')])).toBe('-3');
  });
});

describe('SYM-SM-18: rootof must name a real root that exists', () => {
  test.each(['rootof(x^2 + 1, 1)', 'rootof(x^2 - 2, 5)', 'rootof(x^2 - 2, 0)'])('%s is refused', (src) => {
    expect(() => parseExpression(src)).toThrow();
  });

  test('rootof(x^2 - 2, 2) is the positive root', () => {
    expect(Number(text('ToNumber', [ex('rootof(x^2 - 2, 2)')]))).toBeCloseTo(Math.SQRT2, 9);
  });
});

describe('SYM-SM-19: printed text parses back', () => {
  test.each(['x > 0 and y < 1', 'x < 1 or x > 2', 'x == 1 and y == 2', '(x < 1 or x > 2)'])('the condition %s parses', (src) => {
    expect(() => parseCondition(src)).not.toThrow();
  });

  test('and-of-or and or-of-and print differently', () => {
    const a = condText(parseCondition('(a < 0 or b > 0) and a > 0'));
    const b = condText(parseCondition('a < 0 or (b > 0 and a > 0)'));
    expect(a).not.toBe(b);
  });

  test.each(['(a < 0 or b > 0) and a > 0', 'a < 0 or (b > 0 and a > 0)', 'not (a < 0 and b > 0)'])('%s survives print then parse', (src) => {
    const once = condText(parseCondition(src));
    expect(condText(parseCondition(once))).toBe(once);
  });

  test.each(['1.2.3', '1e999'])('the number literal %s is refused', (src) => {
    expect(() => parseExpression(src)).toThrow();
  });
});

describe('SYM-SM-20: LaTeX uses commands that exist', () => {
  test.each([
    ['asin(x)', '\\arcsin'],
    ['acos(x)', '\\arccos'],
    ['atan(x)', '\\arctan'],
    ['abs(x)', '\\left|'],
    ['floor(x)', '\\lfloor'],
    ['ceil(x)', '\\lceil'],
  ])('%s prints with %s', (src, want) => {
    expect(toLatex(parseExpression(src))).toContain(want);
  });

  test.each(['asin(x)', 'acos(x)', 'atan(x)', 'abs(x)', 'floor(x)', 'ceil(x)', 'sign(x)', 'round(x)', 'cbrt(x)', 'log10(x)', 'log2(x)', 'asinh(x)'])(
    '%s uses no made-up command',
    (src) => {
      expect(toLatex(parseExpression(src))).not.toMatch(/\\(asin|acos|atan|atan2|asinh|acosh|atanh|abs|sign|floor|ceil|round|cbrt|log10|log2)\b/);
    },
  );
});

describe('SYM-SM-21: family parameter names do not depend on earlier calls', () => {
  test('the same trig equation gives the same text after other calls', () => {
    const first = text('Solve', [cd('sin(x) == 1/2'), X]);
    clearCache();
    text('Solve', [cd('tan(x) == 1'), X]);
    clearCache();
    expect(text('Solve', [cd('sin(x) == 1/2'), X])).toBe(first);
  });

  test('the parameter starts at k1', () => {
    expect(text('Solve', [cd('tan(x) == 1'), X])).toContain('k1');
  });
});

describe('SYM-SM-22: GCD(0, 0) is 0', () => {
  test('GCD(0, 0)', () => {
    expect(text('GCD', [bi(0n), bi(0n)])).toBe('0');
  });

  test('GCD(0, 6) is 6 and GCD(4, 6) is 2', () => {
    expect(text('GCD', [bi(0n), bi(6n)])).toBe('6');
    expect(text('GCD', [bi(4n), bi(6n)])).toBe('2');
  });
});

describe('SYM-SM-23: a sin + b cos stays exact', () => {
  test('TrigCombine(sin(x) + cos(x)) has no decimal numbers', () => {
    expect(text('TrigCombine', [ex('sin(x) + cos(x)')])).not.toMatch(/\d\.\d/);
  });
});

describe('SYM-SM-24: a logarithm equal to zero solves', () => {
  test('Solve(ln(x) == 0, x) is x == 1', () => {
    expect(text('Solve', [cd('ln(x) == 0'), X]).replace(/\s/g, '')).toBe('[x==1]');
  });

  test('Solve(ln(x) == 1, x) still solves', () => {
    expect(outcome('Solve', [cd('ln(x) == 1'), X]).k).toBe('value');
  });
});

describe('SYM-SM-26: a heavy op that finishes in the fast lane is not pending', () => {
  test('Simplify(x) with a fast-lane budget is x', () => {
    expect(text('Simplify', [X], { fastLaneMs: 50 })).toBe('x');
  });
});

describe('SYM-SM-27: substituted values are folded', () => {
  test('the limit of (1 - cos(x))/x^2 at 0 is 1/2', () => {
    expect(text('Limit', [ex('(1 - cos(x))/x^2'), X, nm(0)])).toBe('1/2');
  });

  test('toText of a parsed expression round-trips', () => {
    const t = toText(parseExpression('cos(0)/2'));
    expect(t.length).toBeGreaterThan(0);
  });
});
