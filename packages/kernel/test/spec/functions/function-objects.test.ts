/**
 * Function objects: docs/features/functions-calculus/design.md sections 1 ("Defining functions"), 6, 10, 11 and 14.
 */
import { describe, expect, it } from 'vitest';
import { ev, evReason, expectUndefined, fails, fig, ok, setFree, useTimeout } from './helpers';
import { near } from './helpers';

useTimeout();

describe('functions: defining and calling (FC 1)', () => {
  it('f(x) = x^2 - 2 makes a Function object', () => {
    const f = fig('f(x) = x^2 - 2');
    expect(f.get('f')?.type).toBe('Function');
  });

  it.each([
    ['x^2 - 2', 3, 7],
    ['1 / (1 + x^2)', 2, 0.2],
    ['max(x, 2 - x)', 3, 3],
  ])('f(x) = %s gives f(%d) = %d', (body, x, want) => {
    const f = fig(`f(x) = ${body}`);
    near(ev(f, `f(${x})`), want as number, 1e-12);
  });

  it('functions call functions: h(x) = f(x) + g(x, 1)', () => {
    const f = fig(['f(x) = x^2', 'g(x, y) = x^2 - y^2', 'h(x) = f(x) + g(x, 1)']);
    near(ev(f, 'h(3)'), 17);
  });

  it('a function of a slider follows the slider', () => {
    const f = fig(['k = 2 in 0..5 step 0.5', 'f(x) = k * x^2']);
    near(ev(f, 'f(3)'), 18);
    setFree(f, 'k', 3);
    near(ev(f, 'f(3)'), 27);
  });

});

describe('functions: derivative marks in expressions (FC 14.5)', () => {
  it("f'(x) in an expression means Derivative(f)(x)", () => {
    const f = fig('f(x) = x^3');
    near(ev(f, "f'(2)"), 12, 1e-8);
  });

  it("f'(x) = ... (assigning to a derivative) is a syntax error", () => {
    const f = fig('f(x) = x^2');
    fails(f, "f'(x) = 3 x", ['syntax', 'assign_in_expr']);
  });
});

describe('functions: piecewise with if (FC 1, 6; README 13)', () => {
  it.each([
    [-3, 3],
    [2, 4],
  ])('if(x < 0, -x, x^2) at %d is %d', (x, want) => {
    const f = fig('f(x) = if(x < 0, -x, x^2)');
    near(ev(f, `f(${x})`), want as number);
  });

  it.each([
    [-2, 4],
    [2, -2],
  ])('three-arm if(x < -1, x^2, x <= 1, 1, 2 - x^2) at %d is %d', (x, want) => {
    const f = fig('f(x) = if(x < -1, x^2, x <= 1, 1, 2 - x^2)');
    near(ev(f, `f(${x})`), want as number);
  });

  it('evaluation is lazy: the untaken branch is never evaluated', () => {
    const f = fig('f(x) = if(x >= 0, sqrt(x), 0)');
    near(ev(f, 'f(-4)'), 0);
    near(ev(f, 'f(9)'), 3);
  });

  it('chained comparison: if(0 <= x <= 3, sin(x)) is defined on the interval only', () => {
    const f = fig('f(x) = if(0 <= x <= 3, sin(x))');
    near(ev(f, 'f(1.5)'), Math.sin(1.5));
    expect(evReason(f, 'f(4)')).toBeDefined();
    expect(evReason(f, 'f(-0.1)')).toBeDefined();
  });

  it('mixed-direction chains are a syntax error (0 < x > 3)', () => {
    const f = fig('f(x) = x');
    const e = fails(f, 'g(x) = if(0 < x > 3, 1, 2)', ['syntax', 'chained_comparison']);
    expect(e.hint ?? '').toMatch(/and|lean|direction/i);
  });
});

describe('functions: restricted domains with in a..b (FC 6, 14.2)', () => {
  it('f(x) = x^2 in -1..3 is defined inside the interval', () => {
    const f = fig('f(x) = x^2 in -1..3');
    near(ev(f, 'f(2)'), 4);
  });

  it('the in-bounds are closed: both end points are defined', () => {
    const f = fig('f(x) = x^2 in -1..3');
    near(ev(f, 'f(-1)'), 1);
    near(ev(f, 'f(3)'), 9);
  });

  it('outside the interval the value is undefined with out_of_domain', () => {
    const f = fig('f(x) = x^2 in -1..3');
    expect(evReason(f, 'f(4)')).toBe('out_of_domain');
    expect(evReason(f, 'f(-1.0001)')).toBe('out_of_domain');
  });

  it('the bounds are expressions that follow a slider', () => {
    const f = fig(['k = 2 in 0..5 step 0.5', 'f(x) = x^2 in 0..k']);
    expect(evReason(f, 'f(3)')).toBe('out_of_domain');
    setFree(f, 'k', 4);
    near(ev(f, 'f(3)'), 9);
  });

});

describe('functions: arithmetic edge cases (FC 11)', () => {

  it('(-8)^(1/3) is -2: odd denominator reads as a real root', () => {
    const f = fig('f(x) = x^(1/3)');
    near(ev(f, 'f(-8)'), -2, 1e-9);
  });

  it('a negative base with an even-denominator exponent is undefined', () => {
    const f = fig('f(x) = x^(1/2)');
    expect(evReason(f, 'f(-4)')).toBeDefined();
  });

});

describe('functions: errors at definition (FC errors 2)', () => {
  it('an unknown second variable is unknown_name with a hint about two variables', () => {
    const f = fig([]);
    const e = fails(f, 'f(x) = x + y', ['unknown_name', 'free_variable']);
    expect(e.token).toBe('y');
  });

  it('a Number is not callable: a(2) is not_callable', () => {
    const f = fig('a = 3');
    fails(f, 'v = a(2)', 'not_callable');
  });

  it('a call cycle is caught at definition', () => {
    const f = fig('f(x) = x');
    ok(f, 'g(x) = f(x)');
    fails(f, 'f(x) = g(x)', 'cycle');
  });

  // to be implemented: contested: language design 3.12 step 3 lets the parameter count change; needs a ruling
  it.skip('redefining a Function2 as a one-variable Function is type_change', () => {
    const f = fig('f(x, y) = x + y');
    fails(f, 'f(x) = x', 'type_change');
  });

  it('Roots of a function that reads an undefined number is undefined with input_undefined', () => {
    const f = fig(['a = -1', 'b = sqrt(a)', 'f(x) = x + b', 'r = Roots(f, -5, 5)']);
    expectUndefined(f, 'r', 'input_undefined');
  });

});

describe('functions: inline function arguments (FC 14.12)', () => {
  it('Limit(sin(x) / x, 0) works without a prior f(x) line', () => {
    const f = fig('L = Limit(sin(x) / x, 0)');
    near(Number((f.value('L') as number)), 1, 1e-9);
  });

  it('Taylor(sin(x), 0, 5) accepts an inline expression', () => {
    const f = fig('W = Taylor(sin(x), 0, 5)');
    near(ev(f, 'W(1)'), 1 - 1 / 6 + 1 / 120, 1e-9);
  });

  it('Integral(x^2, 0, 3) accepts an inline expression', () => {
    const f = fig('I = Integral(x^2, 0, 3)');
    near(Number(f.value('I')), 9, 1e-8);
  });

  it('Derivative(x^3) accepts an inline expression', () => {
    const f = fig('d = Derivative(x^3)');
    near(ev(f, 'd(2)'), 12, 1e-8);
  });

});
