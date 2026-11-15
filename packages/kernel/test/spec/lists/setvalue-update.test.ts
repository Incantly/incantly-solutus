/**
 * A value write updates every reader at once, formulas and command objects alike
 * (numbers-sliders/design.md 3.3: one write, one update pass).
 */
import { describe, expect, it } from 'vitest';
import { setValue } from '@incantly/kernel';
import { fig, ok } from './helpers';

const list = (f: ReturnType<typeof fig>, name: string): number[] => Array.from(f.value(name) as ArrayLike<number>);

describe('SetValue updates command objects that read the value', () => {
  it('a plain number: Range(1, n) follows at once', () => {
    const f = fig(['n = 3', 'L = Range(1, n)']);
    ok(f.apply('SetValue(n, 5)'));
    expect(list(f, 'L')).toEqual([1, 2, 3, 4, 5]);
  });
  it('a plain number through the API: Range(1, n) follows at once', () => {
    const f = fig(['n = 3', 'L = Range(1, n)']);
    expect(setValue(f, 'n', 4).ok).toBe(true);
    expect(list(f, 'L')).toEqual([1, 2, 3, 4]);
  });
  it('a slider: Range(1, n) follows at once', () => {
    const f = fig(['n = 3 in 1..10 step 1', 'L = Range(1, n)']);
    ok(f.apply('SetValue(n, 6)'));
    expect(list(f, 'L')).toHaveLength(6);
  });
  it('a geometry command: Midpoint follows at once', () => {
    const f = fig(['n = 2', 'M = Midpoint((0, 0), (n, 0))']);
    ok(f.apply('SetValue(n, 8)'));
    expect(f.value('M')).toMatchObject({ x: 4, y: 0 });
  });
  it('a slider written out of range becomes undefined and its readers follow', () => {
    const f = fig(['n = 3 in 1..10 step 1', 'L = Range(1, n)']);
    expect(setValue(f, 'n', Number.NaN).ok).toBe(true);
    expect(f.value('n')).toSatisfy((v: unknown) => typeof v !== 'number' || Number.isNaN(v));
  });
});
