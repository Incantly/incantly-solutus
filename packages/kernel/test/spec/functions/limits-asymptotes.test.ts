/**
 * Limit, Asymptote, Hole (functions-calculus design.md 8.5, 8.6, 8.7, 11; errors.md 3 and 6; agent.md lesson 4).
 */
import { describe, expect, it } from 'vitest';
import {
  detailOf,
  expectHorizontal,
  expectLine,
  expectUndefined,
  expectVertical,
  fails,
  fig,
  isHorizontal,
  isVertical,
  list,
  near,
  nearPt,
  num,
  pts,
  reasonOf,
  setFree,
  useTimeout,
  within,
  type Ln,
} from './helpers';

useTimeout();

const INF = Infinity;
const PI = Math.PI;

describe('Limit(f, a): finite points (8.5)', () => {
  const cases: [string, string, number][] = [
    ['sin(x) / x', '0', 1],
    ['(exp(x) - 1 - x) / x^2', '0', 0.5],
    ['x * sin(1 / x)', '0', 0],
    ['x * ln(x)', '0', 0],
  ];
  it.each(cases)('Limit of %s at %s is %d', (body, a, want) => {
    const f = within(500, () => fig([`f(x) = ${body}`, `L = Limit(f, ${a})`]));
    near(num(f, 'L'), want, 1e-8);
  });

  it('inline expression: Limit(sin(x) / x, 0) (FC 14.12)', () => {
    const f = fig('L = Limit(sin(x) / x, 0)');
    near(num(f, 'L'), 1, 1e-8);
  });

  it('a limit at a hole is defined even though f is undefined there', () => {
    const f = fig(['f(x) = (x^2 - 1) / (x - 1)', 'L = Limit(f, 1)', 'v = f(1)']);
    near(num(f, 'L'), 2, 1e-8);
    expect(reasonOf(f, 'v')).toBeDefined();
  });

  it('the limit follows a slider: (x^2 - a^2)/(x - a) at a gives 2a', () => {
    const f = fig(['a = 1 in -5..5 step 0.5', 'f(x) = (x^2 - a^2) / (x - a)', 'L = Limit(f, a)']);
    near(num(f, 'L'), 2, 1e-8);
    setFree(f, 'a', 3);
    near(num(f, 'L'), 6, 1e-8);
  });
});

describe('Limit(f, inf) and Limit(f, -inf) (8.5)', () => {
  const cases: [string, string, number][] = [
    ['(1 + 1 / x)^x', 'inf', Math.E],
    ['(x^2 + 3 * x) / (2 * x^2 - 1)', 'inf', 0.5],
    ['(3 * x^2 + 1) / (x^2 - 5)', '-inf', 3],
    ['exp(x)', 'inf', INF],
    ['sqrt(x^2 + x) - x', 'inf', 0.5],
    ['x / exp(x)', 'inf', 0],
  ];
  it.each(cases)('Limit of %s at %s is %d', (body, a, want) => {
    const f = within(500, () => fig([`f(x) = ${body}`, `L = Limit(f, ${a})`]));
    near(num(f, 'L'), want, 1e-7);
  });

});

describe('Limit: no limit, one-sided limits, sides (8.5, errors 3, 6)', () => {
  it('1/x at 0 has no limit: left -inf, right +inf', () => {
    const f = fig(['f(x) = 1 / x', 'L = Limit(f, 0)']);
    expectUndefined(f, 'L', 'no_limit');
  });

  it('1/x^2 at 0 is +inf from both sides', () => {
    const f = fig(['f(x) = 1 / x^2', 'L = Limit(f, 0)']);
    expect(num(f, 'L')).toBe(INF);
  });

  it('sign(x) at 0 has no limit and the detail shows both sides', () => {
    const f = fig(['f(x) = sign(x)', 'L = Limit(f, 0)']);
    expectUndefined(f, 'L', 'no_limit');
    const d = detailOf(f, 'L') ?? '';
    expect(d).toMatch(/left/i);
    expect(d).toMatch(/right/i);
    expect(d).toContain('-1');
    expect(d).toContain('1');
  });

  it('sin(1/x) at 0 oscillates: no_limit', { retry: 2 }, () => {
    const f = within(1000, () => fig(['f(x) = sin(1 / x)', 'L = Limit(f, 0)']));
    expectUndefined(f, 'L', 'no_limit');
  });

  it('sin(x) at inf oscillates: no_limit', { retry: 2 }, () => {
    const f = within(1000, () => fig(['f(x) = sin(x)', 'L = Limit(f, inf)']));
    expectUndefined(f, 'L', 'no_limit');
  });

  it('tan(x) at pi/2: left side is +inf, right side is -inf, two-sided has no limit', () => {
    const f = fig(['f(x) = tan(x)', 'L = Limit(f, pi / 2)', 'Ll = Limit(f, pi / 2, "left")', 'Lr = Limit(f, pi / 2, "right")']);
    expectUndefined(f, 'L', 'no_limit');
    expect(num(f, 'Ll')).toBe(INF);
    expect(num(f, 'Lr')).toBe(-INF);
  });

  it('a piecewise jump: if(x < 1, x, x + 1) has left limit 1 and right limit 2 at 1', () => {
    const f = fig(['f(x) = if(x < 1, x, x + 1)', 'Ll = Limit(f, 1, "left")', 'Lr = Limit(f, 1, "right")', 'L = Limit(f, 1)']);
    near(num(f, 'Ll'), 1, 1e-9);
    near(num(f, 'Lr'), 2, 1e-9);
    expectUndefined(f, 'L', 'no_limit');
  });

  it('sqrt(x) at 0 from the right is 0', () => {
    const f = fig(['f(x) = sqrt(x)', 'L = Limit(f, 0, "right")']);
    near(num(f, 'L'), 0, 1e-9);
  });

  it('LimitAbove is an alias for the right-hand limit', () => {
    const f = fig(['f(x) = sign(x)', 'L = LimitAbove(f, 0)']);
    near(num(f, 'L'), 1, 1e-9);
  });

  it('LimitBelow is an alias for the left-hand limit', () => {
    const f = fig(['f(x) = sign(x)', 'L = LimitBelow(f, 0)']);
    near(num(f, 'L'), -1, 1e-9);
  });

  it('a side other than "left" or "right" is bad_argument with the allowed sides', () => {
    const f = fig('f(x) = sign(x)');
    const e = fails(f, 'L = Limit(f, 0, "up")', 'bad_argument');
    expect(JSON.stringify(e.params) + e.message).toMatch(/left/);
  });

  it('the no_limit detail is one sentence for the teacher to say aloud', () => {
    const f = fig(['f(x) = 1 / x', 'L = Limit(f, 0)']);
    expect((detailOf(f, 'L') ?? '').length).toBeGreaterThan(10);
  });
});

describe('Asymptote(f) (8.6)', () => {
  const sortedKinds = (ls: Ln[]): string => ls.map((l) => (isVertical(l) ? 'V' : isHorizontal(l) ? 'H' : 'O')).join('');

  it('(x^3 - 2x^2 - x + 4)/(2x^2 - 2) has x = -1, x = 1 and y = x/2 - 1', () => {
    const f = fig(['f(x) = (x^3 - 2 * x^2 - x + 4) / (2 * x^2 - 2)', 'as = Asymptote(f)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(3);
    expectVertical(ls[0] as Ln, -1);
    expectVertical(ls[1] as Ln, 1);
    expectLine(ls[2] as Ln, 0.5, -1);
  });

  it('(x^2 + 1)/(x - 1) has the vertical x = 1 and the oblique y = x + 1', () => {
    const f = fig(['f(x) = (x^2 + 1) / (x - 1)', 'as = Asymptote(f)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(2);
    expectVertical(ls[0] as Ln, 1);
    expectLine(ls[1] as Ln, 1, 1);
  });

  it('1/x has x = 0 and y = 0', () => {
    const f = fig(['f(x) = 1 / x', 'as = Asymptote(f)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(2);
    expectVertical(ls[0] as Ln, 0);
    expectHorizontal(ls[1] as Ln, 0);
  });

  it('2/(x - 3) + 1 has x = 3 and y = 1, vertical first', () => {
    const f = fig(['f(x) = 2 / (x - 3) + 1', 'as = Asymptote(f)']);
    const ls = list<Ln>(f, 'as');
    expect(sortedKinds(ls)).toBe('VH');
    expectVertical(ls[0] as Ln, 3);
    expectHorizontal(ls[1] as Ln, 1);
  });

  it('(x^2 - 1)/(x^2 + 1) has only y = 1', () => {
    const f = fig(['f(x) = (x^2 - 1) / (x^2 + 1)', 'as = Asymptote(f)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(1);
    expectHorizontal(ls[0] as Ln, 1);
  });

  it('atan(x) has y = -pi/2 and y = pi/2', () => {
    const f = fig(['f(x) = atan(x)', 'as = Asymptote(f)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(2);
    const ys = ls.map((l) => l.c / l.b).sort((a, b) => a - b);
    near(ys[0] as number, -PI / 2, 1e-6);
    near(ys[1] as number, PI / 2, 1e-6);
  });

  it('ln(x) has the vertical x = 0 (the argument reaches 0)', () => {
    const f = fig(['f(x) = ln(x)', 'as = Asymptote(f)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(1);
    expectVertical(ls[0] as Ln, 0);
  });

  it('sin(x)/x has the single horizontal y = 0 (both ends give the same line, reported once)', () => {
    const f = fig(['f(x) = sin(x) / x', 'as = Asymptote(f)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(1);
    expectHorizontal(ls[0] as Ln, 0);
  });

  it('1/sqrt(x) has x = 0 and y = 0', () => {
    const f = fig(['f(x) = 1 / sqrt(x)', 'as = Asymptote(f)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(2);
    expectVertical(ls[0] as Ln, 0);
    expectHorizontal(ls[1] as Ln, 0);
  });

  it('a hole is not a vertical asymptote: (x^2 - 1)/(x - 1) has no vertical line', () => {
    const f = fig(['f(x) = (x^2 - 1) / (x - 1)', 'as = Asymptote(f)']);
    for (const l of list<Ln>(f, 'as')) expect(isVertical(l)).toBe(false);
  });

  it('lesson 4: (x^2 - 1)/(x - 1.5) has x = 1.5 and y = x + 1.5', () => {
    const f = fig(['f(x) = (x^2 - 1) / (x - 1.5)', 'as = Asymptote(f, -3, 3)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(2);
    expectVertical(ls[0] as Ln, 1.5);
    expectLine(ls[1] as Ln, 1, 1.5);
  });

  it('tan(x) on [-2, 2] has x = -pi/2 and x = pi/2', () => {
    const f = fig(['f(x) = tan(x)', 'as = Asymptote(f, -2, 2)']);
    const ls = list<Ln>(f, 'as');
    expect(ls.length).toBe(2);
    expectVertical(ls[0] as Ln, -PI / 2);
    expectVertical(ls[1] as Ln, PI / 2);
  });

  it('a vertical asymptote outside the window is not listed: 1/(x - 5) on [-1, 1] has only y = 0', () => {
    const f = fig(['f(x) = 1 / (x - 5)', 'as = Asymptote(f, -1, 1)']);
    for (const l of list<Ln>(f, 'as')) expect(isVertical(l)).toBe(false);
  });

  it('the asymptote lines follow a slider: 1/(x - a) has x = a', () => {
    const f = fig(['a = 1 in -3..3 step 0.5', 'f(x) = 1 / (x - a)', 'as = Asymptote(f)']);
    expectVertical(list<Ln>(f, 'as')[0] as Ln, 1);
    setFree(f, 'a', -2);
    expectVertical(list<Ln>(f, 'as')[0] as Ln, -2);
  });

});

describe('Hole(f, a, b) (8.7)', () => {
  it('(x^2 - 1)/(x - 1) has a hole at (1, 2)', () => {
    const f = fig(['f(x) = (x^2 - 1) / (x - 1)', 'h = Hole(f, -3, 3)']);
    const r = pts(f, 'h');
    expect(r.length).toBe(1);
    nearPt(r[0] as { x: number; y: number }, 1, 2, 1e-7);
  });

  it('sin(x)/x has a hole at (0, 1)', () => {
    const f = fig(['f(x) = sin(x) / x', 'h = Hole(f, -3, 3)']);
    const r = pts(f, 'h');
    expect(r.length).toBe(1);
    nearPt(r[0] as { x: number; y: number }, 0, 1, 1e-7);
  });

  it('two holes, sorted by x: (x^2 - 1)/(x^2 - 1) has holes at -1 and 1, both with value 1', () => {
    const f = fig(['f(x) = (x^2 - 1) / (x^2 - 1)', 'h = Hole(f, -3, 3)']);
    const r = pts(f, 'h');
    expect(r.length).toBe(2);
    nearPt(r[0] as { x: number; y: number }, -1, 1, 1e-7);
    nearPt(r[1] as { x: number; y: number }, 1, 1, 1e-7);
  });

  // to be implemented: needs the expression tree of the function (exact cancellation); sampling cannot find a hole at an irrational place
  it.skip('a hole at an irrational place: (x^2 - 2)/(x - sqrt(2)) has a hole at (sqrt 2, 2 sqrt 2)', () => {
    const f = fig(['f(x) = (x^2 - 2) / (x - sqrt(2))', 'h = Hole(f, -3, 3)']);
    const r = pts(f, 'h');
    expect(r.length).toBe(1);
    nearPt(r[0] as { x: number; y: number }, Math.SQRT2, 2 * Math.SQRT2, 1e-6);
  });

  it('a pole is not a hole: 1/x has none', () => {
    const f = fig(['f(x) = 1 / x', 'h = Hole(f, -3, 3)']);
    expect(pts(f, 'h')).toEqual([]);
  });

  it('a hole outside [a, b] is not reported', () => {
    const f = fig(['f(x) = (x^2 - 1) / (x - 1)', 'h = Hole(f, 2, 5)']);
    expect(pts(f, 'h')).toEqual([]);
  });

  it('the hole moves with a slider: (x^2 - a^2)/(x - a) has its hole at (a, 2a)', () => {
    const f = fig(['a = 2 in -4..4 step 1', 'f(x) = (x^2 - a^2) / (x - a)', 'h = Hole(f, -6, 6)']);
    nearPt(pts(f, 'h')[0] as { x: number; y: number }, 2, 4, 1e-6);
    setFree(f, 'a', 3);
    nearPt(pts(f, 'h')[0] as { x: number; y: number }, 3, 6, 1e-6);
  });

});
