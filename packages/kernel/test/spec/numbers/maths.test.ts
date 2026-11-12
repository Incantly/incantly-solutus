/**
 * The functions and constants this area adds (numbers-sliders/design.md 1, 3.6, 9.1): deg, turn, grad, round, sig, snap, wrap,
 * approx, and the relative tolerance of == and != on Numbers.
 */
import { describe, expect, it } from 'vitest';
import { numbersFunctionSpecs } from '@incantly/kernel';
import { fig, num, reasonOf, each } from './helpers';

const one = (expr: string): ReturnType<typeof fig> => fig(`r1 = ${expr}`);

describe('9.1 constants', () => {
  it('deg is pi / 180', () => {
    expect(num(one('deg'), 'r1')).toBe(Math.PI / 180);
  });
  it('turn is tau', () => {
    expect(num(one('turn'), 'r1')).toBe(2 * Math.PI);
  });
  it('grad is pi / 200', () => {
    expect(num(one('grad'), 'r1')).toBe(Math.PI / 200);
  });
  it('0.5turn is pi', () => {
    expect(num(one('0.5turn'), 'r1')).toBeCloseTo(Math.PI, 14);
  });
  it('every whole degree literal equals the value an angle slider commits for it', () => {
    const f = fig([]);
    for (let k = 0; k <= 360; k += 15) f.apply(`d${k} = ${k}deg`);
    for (let k = 0; k <= 360; k += 15) expect(num(f, `d${k}`)).toBeCloseTo((k * Math.PI) / 180, 14);
  });
});

describe('9.1 round(x, n): decimals', () => {
  each([
    ['round(3.14159, 2)', 3.14],
    ['round(2.5, 0)', 3],
    ['round(-2.5, 0)', -3],
    ['round(0.5, 0)', 1],
    ['round(1.234, 1)', 1.2],
    ['round(1234.5678, 3)', 1234.568],
  ])('%s is %s', (expr, want) => {
    expect(num(one(expr), 'r1')).toBe(want);
  });
});

describe('9.1 sig(x, n): significant figures', () => {
  each([
    ['sig(1234.5678, 3)', 1230],
    ['sig(0.0012345, 3)', 0.00123],
    ['sig(-1234.5678, 3)', -1230],
    ['sig(0, 3)', 0],
    ['sig(5, 1)', 5],
    ['sig(15, 1)', 20],
    ['sig(99.95, 3)', 100],
  ])('%s is %s', (expr, want) => {
    expect(num(one(expr), 'r1')).toBe(want);
  });
  it('sig with n = 0 is undefined', () => {
    expect(reasonOf(one('sig(5, 0)'), 'r1')).toBeDefined();
  });
  it('sig with a fractional n is undefined', () => {
    expect(reasonOf(one('sig(5, 1.5)'), 'r1')).toBeDefined();
  });
});

describe('9.1 snap(x, step)', () => {
  each([
    ['snap(7.3, 0.5)', 7.5],
    ['snap(7.2, 0.5)', 7],
    ['snap(-7.3, 0.5)', -7.5],
    ['snap(0.30000000000000004, 0.1)', 0.3],
    ['snap(17, 5)', 15],
    ['snap(18, 5)', 20],
  ])('%s is %s', (expr, want) => {
    expect(num(one(expr), 'r1')).toBe(want);
  });
  it('a step of zero is undefined', () => {
    expect(reasonOf(one('snap(7, 0)'), 'r1')).toBeDefined();
  });
});

describe('9.1 wrap(x, lo, hi): into [lo, hi)', () => {
  each([
    ['wrap(370, 0, 360)', 10],
    ['wrap(-10, 0, 360)', 350],
    ['wrap(360, 0, 360)', 0],
    ['wrap(0, 0, 360)', 0],
    ['wrap(725, 0, 360)', 5],
    ['wrap(3, -1, 1)', -1],
    ['wrap(2.5, 0, 1)', 0.5],
  ])('%s is %s', (expr, want) => {
    expect(num(one(expr), 'r1')).toBeCloseTo(want, 12);
  });
  it('wraps a radian result into 0..2 pi', () => {
    expect(num(one('wrap(7, 0, 2 * pi)'), 'r1')).toBeCloseTo(7 - 2 * Math.PI, 12);
  });
  it('wraps an angle into -180deg..180deg', () => {
    expect(num(one('wrap(190deg, -180deg, 180deg)'), 'r1')).toBeCloseTo((-170 * Math.PI) / 180, 12);
  });
  it('an empty interval is undefined', () => {
    expect(reasonOf(one('wrap(1, 5, 5)'), 'r1')).toBeDefined();
  });
});

describe('9.1 approx(a, b, eps)', () => {
  it('0.1 + 0.2 is approximately 0.3', () => {
    expect(fig('ok1 = approx(0.1 + 0.2, 0.3, 1e-9)').value('ok1')).toBe(true);
  });
  it('1 and 2 are not within 0.5', () => {
    expect(fig('ok1 = approx(1, 2, 0.5)').value('ok1')).toBe(false);
  });
  it('1 and 1.4 are within 0.5', () => {
    expect(fig('ok1 = approx(1, 1.4, 0.5)').value('ok1')).toBe(true);
  });
});

describe('9.1 the function group', () => {
  it('numbersFunctionSpecs adds sig, snap, wrap and approx', () => {
    const names = numbersFunctionSpecs().map((s) => s.name);
    for (const n of ['sig', 'snap', 'wrap', 'approx']) expect(names).toContain(n);
  });
});

describe('3.6 Number equality has a relative tolerance of 1e-12', () => {
  each([
    ['0.1 + 0.2 == 0.3', true],
    ['1 == 1.0000000001', false],
    ['1e12 == 1e12 + 0.5', true],
    ['1e12 == 1e12 + 5', false],
    ['3 == 3', true],
    ['3 == 4', false],
    ['0.1 + 0.2 != 0.3', false],
    ['1 != 1.0000000001', true],
    ['3 != 4', true],
  ])('%s is %s', (expr, want) => {
    expect(fig(`t1 = ${expr}`).value('t1')).toBe(want);
  });
  it('a slider can be compared with a decimal: a == 0.3', () => {
    const f = fig(['a = 0.3 in 0..1 step 0.1', 't1 = a == 0.3']);
    expect(f.value('t1')).toBe(true);
  });
  it('an angle slider value equals its degree literal', () => {
    const f = fig(['θ = 30deg in 0deg..360deg step 1deg', 't1 = θ == 30deg']);
    expect(f.value('t1')).toBe(true);
  });
});
