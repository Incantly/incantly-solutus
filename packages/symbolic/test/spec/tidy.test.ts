/**
 * Answers in their tidy form (cas/design.md 5.5 and 5.11; finding SYM-SM-27; .kiro/specs/cas R2): no square factor
 * left under a root, no root left in a denominator, and quadratic roots split into a number and a root.
 */
import { describe, expect, it } from 'vitest';
import { intN, pow, ratN, run, toLatex, toText } from '@incantly/symbolic';
import { cd, ex, sy } from './helpers';

const value = (r: ReturnType<typeof run>): string => {
  if (!r.ok || !r.value.cell.defined) return 'undefined';
  const v = r.value.cell.value;
  if (v.k === 'expr') return toText(v.e);
  if (v.k === 'list') return `[${v.items.map((i) => (i.k === 'expr' ? toText(i.e) : i.k === 'cond' && i.c.c === 'rel' ? `${toText(i.c.l)} = ${toText(i.c.r)}` : '?')).join(', ')}]`;
  return '?';
};

describe('roots (SYM-SM-27)', () => {
  it.each([
    [4n, '2'],
    [8n, '2 * sqrt(2)'],
    [12n, '2 * sqrt(3)'],
    [7n, 'sqrt(7)'],
  ])('sqrt(%s) is %s', (n, want) => {
    expect(toText(pow(intN(n), ratN(1n, 2n)))).toBe(want);
  });

  it('a negative half power is a root over a number', () => {
    expect(toText(pow(intN(2n), ratN(-1n, 2n)))).toBe('sqrt(2)/2');
    expect(toText(pow(intN(3n), ratN(-3n, 2n)))).toBe('sqrt(3)/9');
    expect(value(run('Rationalize', [ex('1/sqrt(2)')]))).toBe('sqrt(2)/2');
  });

  it('Factor over the complex numbers gives (x - i)(x + i)', () => {
    expect(value(run('Factor', [ex('x^2 + 1'), { k: 'named', name: 'over', v: { k: 'text', v: 'complex' } }]))).toBe('(x - i) * (x + i)');
  });

  it('Solve(x^2 == a, x) gives ±sqrt(a)', () => {
    expect(value(run('Solutions', [cd('x^2 == a'), sy('x')]))).toBe('[sqrt(a), -sqrt(a)]');
  });

  it('quadratic roots split into a number and a root', () => {
    expect(value(run('Solutions', [cd('x^2 - 2*x - 1 == 0'), sy('x')]))).toBe('[-sqrt(2) + 1, sqrt(2) + 1]');
  });
});

describe('LaTeX products as written by hand', () => {
  it('a number next to a letter or a root has no dot; two numbers keep one', () => {
    expect(toLatex(pow(intN(8n), ratN(1n, 2n)))).toBe('2 \\sqrt{2}');
    const r = run('Expand', [ex('5*x + 6')]);
    expect(r.ok && r.value.cell.defined && r.value.cell.value.k === 'expr' ? toLatex(r.value.cell.value.e) : '').toBe('5 x + 6');
  });

  it('a leading -1 is a minus sign', () => {
    const r = run('Expand', [ex('-sqrt(2)')]);
    expect(r.ok && r.value.cell.defined && r.value.cell.value.k === 'expr' ? toLatex(r.value.cell.value.e) : '').toBe('-\\sqrt{2}');
  });
});
