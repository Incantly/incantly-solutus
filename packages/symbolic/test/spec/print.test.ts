/**
 * Printing (docs/features/cas/design.md 5.11, acceptance test 1) and the re-enterable
 * ruling (docs/features/language/rulings.md, docs round item 3): printed expression text,
 * including CAS results and step lines, must be re-enterable as a line, so products print
 * with `*`. Equations print `=` for display; the input syntax stays `==`.
 */
import { describe, expect, test } from 'vitest';
import {
  condLatex,
  condSpeech,
  condText,
  nodeSummary,
  parseCondition,
  parseExpression,
  toLatex,
  toSpeech,
  toText,
} from '@incantly/symbolic';
import { cond, prng, tree } from './helpers';

// Ruling: products print with `*` so the text re-enters.
describe('products print with * (re-enterable)', () => {
  test.each([
    ['(x - 2)*(x - 3)', '(x - 2) * (x - 3)'],
    ['2*pi*k1', '2 * pi * k1'],
  ])('ruling example %s prints as %s', (input, printed) => {
    expect(toText(tree(input))).toBe(printed);
  });
  test.each(['(x - 2)*(x - 3)', '2*(x+1)', '3*x^2', '(a+b)*(c+d)', 'x*y*z', '-x^2 + 1'])(
    '%s prints its products with * and re-enters',
    (input) => {
      const t = toText(tree(input));
      if (input !== '-x^2 + 1') expect(t).toContain('*');
      expect(parseExpression(t)).toBe(tree(input));
    },
  );
  test('no bare juxtaposition in any printed product', () => {
    for (const s of ['(x-2)*(x-3)', '2*pi', '3*x^2', '(a+b)*(c+d)', 'x*y*z']) {
      const t = toText(tree(s));
      expect(t.includes(')(') || /[0-9a-z)]\s+\(/.test(t) || /[0-9a-z)] [a-z(]/.test(t)).toBe(false);
    }
  });
});

// design 5.11: round trip parse(toText(n)) interns to n for every canonical node.
describe('round trip (acceptance 1)', () => {
  test.each([
    'x',
    '2',
    '-3',
    '1/2',
    '-7/3',
    'x + 1',
    'x^2 - 5*x + 6',
    '(x^2 - 1)/(x - 1)',
    'sin(x) + cos(2*x)',
    'ln(x^2 + 1)',
    'exp(-x^2)',
    'sqrt(2)/2',
    'pi/6',
    '2^10',
    'x^(1/3)',
    '(a + b)^2',
    'abs(x)/x',
    'floor(x) + ceil(y)',
    'min(x, y) + max(1, 2)',
    'asin(x) + acos(x) + atan(x)',
    'sinh(x) - cosh(x)',
    '1/(1 + exp(-x))',
    '0',
  ])('%s round-trips', (s) => {
    const t = toText(tree(s));
    expect(parseExpression(t)).toBe(tree(s));
  });
  test.each(['x == 2', 'x != 1', 'a < v', 'a <= v', 'x > 0', 'x >= -1', 'not x == 1'])(
    'cond %s round-trips',
    (s) => {
      const t = condText(cond(s));
      expect(parseCondition(t)).toEqual(cond(s));
    },
  );
  // `and`/`or` of Conds are exercised output-first in solve.test.ts: whatever Solve prints
  // (the `and` form or the chained `a < v < b` form, design 2.3) must re-enter. The package
  // parser does not accept hand-written `and`/`or` at top level; hand-written coverage of
  // those spellings belongs to the kernel's parser tests, not to this package.
  test('10,000 generated expressions round-trip', { timeout: 120000 }, () => {
    const rnd = prng(20261110);
    const atoms = ['x', 'y', 'z', '2', '3', '1/2', 'pi', 'e'];
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
    const gen = (depth: number): string => {
      if (depth <= 0 || rnd() < 0.3) return pick(atoms);
      const op = pick(['+', '-', '*', '/', '^', 'sin', 'cos', 'ln', 'exp', 'sqrt', 'abs']);
      if (op === '^') return `(${gen(depth - 1)})^${1 + Math.floor(rnd() * 3)}`;
      if (op.length > 1) return `${op}(${gen(depth - 1)})`;
      return `(${gen(depth - 1)} ${op} ${gen(depth - 1)})`;
    };
    for (let i = 0; i < 10000; i++) {
      const s = gen(3);
      let n;
      try {
        n = parseExpression(s);
      } catch {
        continue; // the generator may emit edge syntax; only parsed trees count
      }
      expect(parseExpression(toText(n)), `round trip of ${s} -> ${toText(n)}`).toBe(n);
    }
  },);
});

// design 5.11: display `=` versus input `==`.
describe('equations print = for display, == stays the input syntax', () => {
  test('condText uses == by default', () => {
    expect(condText(cond('x == 2'))).toBe('x == 2');
  });
  test('display mode prints lhs = rhs', () => {
    expect(condText(cond('x == 2'), { display: true })).toBe('x = 2');
  });
  test('inequalities print through', () => {
    expect(condText(cond('x < 2'))).toBe('x < 2');
    expect(condText(cond('x >= y'))).toBe('x >= y');
  });
});

// design 5.11: LaTeX output.
describe('toLatex', () => {
  test('fractions use \\frac', () => {
    expect(toLatex(tree('1/2'))).toContain('\\frac');
  });
  test('roots use \\sqrt', () => {
    expect(toLatex(tree('sqrt(2)'))).toContain('\\sqrt');
  });
  test('brackets are sized with \\left( \\right)', () => {
    expect(toLatex(tree('(x+1)^2'))).toContain('\\left(');
    expect(toLatex(tree('(x+1)^2'))).toContain('\\right)');
  });
  test('equations render for LaTeX(obj)', () => {
    expect(condLatex(cond('x == 2'))).toContain('=');
  });
  test('no scientific notation for ordinary decimals', () => {
    expect(toLatex(tree('0.5'))).not.toMatch(/[eE][+-]?\d/);
  });
});

// design 5.11: speech output.
describe('toSpeech', () => {
  test('polynomials read aloud', () => {
    expect(toSpeech(tree('x^2 - 5*x + 6'))).toBe('x squared minus 5 x plus 6');
  });
  test('roots read aloud', () => {
    expect(toSpeech(tree('sqrt(2)/2'))).toBe('the square root of 2 over 2');
  });
  test('conditions read aloud', () => {
    expect(condSpeech(cond('x == 2'))).toContain('x');
    expect(condSpeech(cond('x == 2'))).toContain('two');
  });
  test('long expressions are shortened (over 30 tokens)', () => {
    const terms = Array.from({ length: 40 }, (_, i) => `x^${i + 1}`).join(' + ');
    const speech = toSpeech(tree(terms));
    expect(speech).toMatch(/a long expression with \d+ terms, starting/);
  });
  test('short expressions are never shortened', () => {
    expect(toSpeech(tree('x + 1'))).not.toMatch(/a long expression/);
  });
});

// agent.md 3: long values are shortened with the full text available.
describe('summaries', () => {
  test('nodeSummary cuts long text with a term count', () => {
    const terms = Array.from({ length: 60 }, (_, i) => `x^${i + 1}`).join(' + ');
    const s = nodeSummary(tree(terms), 120);
    expect(s.length).toBeLessThanOrEqual(140);
    expect(s).toMatch(/…/);
  });
  test('nodeSummary leaves short text alone', () => {
    expect(nodeSummary(tree('x + 1'))).toBe(toText(tree('x + 1')));
  });
});
