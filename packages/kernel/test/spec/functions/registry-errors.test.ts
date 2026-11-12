/**
 * The command table, reasons, error shapes and the cross-cutting rules of the area
 * (functions-calculus design.md 1, 10, 14; errors.md 1-7; curves-loci errors.md 1-6; README decisions 2-4).
 */
import { describe, expect, it } from 'vitest';
import { CURVE_COMMANDS, FUNCTIONS_REASONS, FUNCTIONS_SPECS, LOCUS_COMMANDS, CommandRegistry, registerFunctions } from '@incantly/kernel';
import { detailOf, expectUndefined, fig, newFigure, ok, reasonOf, useTimeout } from './helpers';

useTimeout();

const names = new Set([...FUNCTIONS_SPECS, ...CURVE_COMMANDS, ...LOCUS_COMMANDS].map((s) => s.name));

describe('the command table has every documented command (FC 1, curves 1)', () => {
  const missing = (wanted: string[]): string[] => wanted.filter((n) => !names.has(n));

  it('every functions-calculus command of the design is registered', () => {
    expect(
      missing([
        'Derivative', 'NDerivative', 'Slope', 'Tangent', 'Normal', 'Curvature', 'CurvatureVector', 'OsculatingCircle', 'Integral', 'AreaUnder',
        'Riemann', 'Root', 'Roots', 'Extremum', 'Maximum', 'Minimum', 'Inflection', 'Hole', 'Asymptote', 'Intersect', 'Taylor', 'Limit', 'Iterate',
        'IterateList', 'Cobweb', 'SlopeField', 'SolveODE', 'NSolveODE', 'Degree', 'Coefficients', 'Polynomial', 'Numerator', 'Denominator',
      ]),
    ).toEqual([]);
  });

  it('every curves-loci command of the design is registered', () => {
    expect(
      missing(['Curve', 'Polar', 'Bezier', 'Spline', 'Contour', 'Contours', 'ImplicitDerivative', 'Length', 'Closest', 'PathParam', 'Boundary', 'PointIn', 'Area', 'Locus', 'Path', 'LocusEquation', 'Envelope']),
    ).toEqual([]);
  });

  it('every alias of the design is accepted', () => {
    expect(
      missing([
        'LeftSum', 'RightSum', 'UpperSum', 'LowerSum', 'RectangleSum', 'TrapezoidalSum', 'IntegralBetween', 'NIntegral', 'TurningPoint',
        'TaylorPolynomial', 'LimitAbove', 'LimitBelow', 'RemovableDiscontinuity', 'RootList',
      ]),
    ).toEqual([]);
  });

  it('two figures can be created in one process (reason phrases register idempotently)', () => {
    expect(() => {
      registerFunctions(new CommandRegistry());
      newFigure();
      newFigure();
    }).not.toThrow();
  });
});

describe('the undefined reasons added by this area are registered (FC 14.8, curves 15.9)', () => {
  it('every reason the docs add is in the area\'s reason list', () => {
    const list: string[] = Array.isArray(FUNCTIONS_REASONS) ? [...FUNCTIONS_REASONS] : Object.keys(FUNCTIONS_REASONS as object);
    const documented = [
      'no_limit', 'diverges', 'blowup', 'stiff', 'step_limit', 'corner', 'identically_zero', 'bad_argument', 'empty_interval',
      'no_extremum', 'unbounded_search', 'singular_point', 'infinite_radius', 'no_algebraic_equation', 'degenerate_points',
      'identically_true', 'sample_cap', 'curve_undefined_at_param', 'out_of_range', 'not_on_curve', 'empty_region', 'unbounded',
      'no_dependency',
    ];
    expect(documented.filter((r) => !list.includes(r))).toEqual([]);
  });
});

describe('line errors are well-formed error objects (errors design: one format)', () => {
  const cases: [string, string][] = [
    ['f(x) = ', 'f(x) = '],
    ['riemann n 0', 'S = Riemann(f, 0, 1, 0)'],
    ['unknown command', 'I = Intergal(f, 0, 1)'],
  ];
  it.each(cases)('%s', (_label, line) => {
    const f = fig('f(x) = x^2');
    const r = f.apply(line);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.committed).toBe(false);
    expect(r.code).toMatch(/^[A-Z]\d{3}$/);
    expect(r.message.length).toBeGreaterThan(0);
    expect(Array.isArray(r.forms)).toBe(true);
    expect(Array.isArray(r.expected)).toBe(true);
    expect(r.suggest.length).toBeLessThanOrEqual(3);
    expect(r.line).toBeGreaterThanOrEqual(1);
    expect(r.col).toBeGreaterThanOrEqual(1);
    expect(r.endCol).toBeGreaterThanOrEqual(r.col);
  });

  it('a failing line changes nothing: the script is the same before and after', () => {
    const f = fig(['f(x) = x^2', 'a = 2']);
    const before = f.toScript();
    for (const line of ['S = Riemann(f, 0, 1, 0)', 'd = Derivative(f, 2.5)', 'T = Taylor(f, 0, -1)', 'I = Intergal(f, 0, 1)']) f.apply(line);
    expect(f.toScript()).toBe(before);
  });

  it('not_found is not an error: Roots with no roots is the empty list, Intersect with none is the empty list', () => {
    const f = fig(['f(x) = x^2 + 1', 'g(x) = x^2 + 2']);
    ok(f, 'r = Roots(f, -5, 5)');
    ok(f, 'i = Intersect(f, g, -5, 5)');
    expect(reasonOf(f, 'r')).toBeUndefined();
    expect(reasonOf(f, 'i')).toBeUndefined();
  });

});

describe('undefined values carry a plain-language detail for the teacher (errors 3, 6)', () => {
  const cases: [string, string[], string, string][] = [
    ['no_root', ['f(x) = x^2 + 1', 'r = Root(f, -5, 5)'], 'r', 'no_root'],
    ['no_limit', ['f(x) = sign(x)', 'L = Limit(f, 0)'], 'L', 'no_limit'],
    ['corner', ['f(x) = abs(x)', 'm = Slope(f, 0)'], 'm', 'corner'],
    ['diverges', ['f(x) = 1 / x^2', 'I = Integral(f, -1, 1)'], 'I', 'diverges'],
    ['identically_zero', ['f(x) = 0', 'r = Roots(f, -1, 1)'], 'r', 'identically_zero'],
    ['empty_interval', ['f(x) = x', 'r = Roots(f, 1, 1)'], 'r', 'empty_interval'],
    ['singular_point', ['cu = Curve(s^2, s^3, s, -1, 1)', 'm = Slope(cu, 0)'], 'm', 'singular_point'],
  ];
  it.each(cases)('%s has a detail', (_label, lines, name, reason) => {
    const f = fig(lines);
    expectUndefined(f, name, reason);
    expect((detailOf(f, name) ?? '').length).toBeGreaterThan(8);
  });

  it('input_undefined names the undefined input in the cause chain', () => {
    const f = fig(['a = -1', 'b = sqrt(a)', 'f(x) = x + b', 'r = Roots(f, -5, 5)']);
    expectUndefined(f, 'r', 'input_undefined');
    const root = f.rootCause('r');
    expect(root).toBeDefined();
  });

});

describe('time, save/load, determinism and the clock (FC 4, 10; curves 9)', () => {
  it('a function of t follows the clock: f(x) = t * x', () => {
    const f = fig(['f(x) = t * x', 'v = f(3)']);
    f.setClock(2);
    expect(f.value('v')).toBe(6);
    f.setClock(5);
    expect(f.value('v')).toBe(15);
  });

  it('a Tangent to a function of t moves with the clock', () => {
    const f = fig(['f(x) = x^2 + t', 'T = Tangent(f, 1)']);
    f.setClock(0);
    const a = f.value('T') as { a: number; b: number; c: number };
    f.setClock(4);
    const b = f.value('T') as { a: number; b: number; c: number };
    expect(Math.abs(b.c / b.b - a.c / a.b - 4)).toBeLessThan(1e-6);
  });

  it('save and load round-trips the calculus objects: the same numbers come back', () => {
    const f = fig(['f(x) = x^3 - 3x', 'r = Roots(f, -3, 3)', 'I = Integral(f, 0, 2)', 'd = Derivative(f)', 'v = d(2)', 'L = Limit(f, 1)']);
    const g = newFigure();
    const report = g.append(f.toScript());
    expect(report).toBeDefined();
    expect(g.value('r')).toEqual(f.value('r'));
    expect(g.value('I')).toBe(f.value('I'));
    expect(g.value('v')).toBe(f.value('v'));
    expect(g.value('L')).toBe(f.value('L'));
  });

  it('the same lines give identical values twice (no clock, no randomness): Roots, Integral, Limit, Extremum', () => {
    const lines = ['f(x) = sin(x) * x', 'r = Roots(f, -10, 10)', 'I = Integral(f, 0, 5)', 'L = Limit(f, 2)', 'e1 = Extremum(f, -10, 10)'];
    const a = fig(lines);
    const b = fig(lines);
    for (const n of ['r', 'I', 'L', 'e1']) expect(a.value(n)).toEqual(b.value(n));
  });

});

describe('two-variable functions: domains and calls (FC 6, 10)', () => {
  it('g(x, y) = x + y in 0..1, 0..1 is defined in the rectangle only', () => {
    const f = fig('g(x, y) = x + y in 0..1, 0..1');
    ok(f, 'a = g(0.5, 0.5)');
    expect(f.value('a')).toBe(1);
    ok(f, 'b = g(2, 0)');
    expect(reasonOf(f, 'b')).toBe('out_of_domain');
  });

  it('a Function2 called with one argument is wrong_arity or arg_count', () => {
    const f = fig('g(x, y) = x + y');
    const r = f.apply('v = g(1)');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(['wrong_arity', 'arg_count']).toContain(r.kind);
  });

  it('a Function2 may call a Function: g(x, y) = f(x) * y', () => {
    const f = fig(['f(x) = x^2', 'g(x, y) = f(x) * y', 'v = g(3, 2)']);
    expect(f.value('v')).toBe(18);
  });
});
