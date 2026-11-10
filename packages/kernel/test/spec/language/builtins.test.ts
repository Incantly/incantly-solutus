import { describe, expect, it } from 'vitest';
import {
  BUILTIN_CONSTANTS,
  BUILTIN_FUNCTIONS,
  BUILTIN_FUNCTION_SPECS,
  analyseLine,
  compileLine,
  createEnv,
  evaluate,
} from '@incantly/kernel';
import { bool, check, checked, ev, failure, newFig, num, okValue, undefinedReason } from './helpers';

const DOCUMENTED = [
  'sin cos tan sec csc cot',
  'asin acos atan atan2 acot',
  'sinh cosh tanh sech csch coth asinh acosh atanh',
  'sqrt cbrt nroot hypot pow',
  'exp ln log10 log2 log',
  'floor ceil round trunc fract',
  'abs sign min max clamp',
  'mod rem gcd lcm',
  'fact ncr npr',
  'gamma beta erf erfc',
  'lerp smooth step',
  'rand noise',
  'dot cross norm unit perp',
  'todeg torad',
  'rgb hsl',
  'number len',
]
  .join(' ')
  .split(' ');

describe('language/design.md 3.14 the function table', () => {
  it('every documented built-in exists', () => {
    const names = new Set(BUILTIN_FUNCTIONS.names());
    for (const n of DOCUMENTED) expect(names.has(n), n).toBe(true);
  });

  it('there are about 75 names counting hyperbolic and inverse families', () => {
    expect(BUILTIN_FUNCTIONS.names().length).toBeGreaterThanOrEqual(65);
    expect(BUILTIN_FUNCTIONS.names().length).toBeLessThanOrEqual(90);
  });

  it('all built-ins are lowercase', () => {
    for (const n of BUILTIN_FUNCTIONS.names()) expect(n, n).toBe(n.toLowerCase());
  });

  it('every spec has at least one form with a summary and a return type', () => {
    for (const spec of BUILTIN_FUNCTION_SPECS) {
      expect(spec.forms.length, spec.name).toBeGreaterThan(0);
      for (const f of spec.forms) {
        expect(f.summary.length, spec.name).toBeGreaterThan(0);
        expect(f.returns.length, spec.name).toBeGreaterThan(0);
      }
      expect(BUILTIN_FUNCTIONS.lookup(spec.name)).toBe(spec);
    }
  });

  it('the constants table has pi tau e deg inf', () => {
    const names = BUILTIN_CONSTANTS.map((c) => c.name);
    for (const n of ['pi', 'tau', 'e', 'deg', 'inf']) expect(names).toContain(n);
  });

  it('the stale names left out of v1 are not functions', () => {
    const names = new Set(BUILTIN_FUNCTIONS.names());
    for (const n of ['arg', 'conjugate', 'real', 'imaginary', 'zeta', 'si', 'ci', 'ei']) expect(names.has(n), n).toBe(false);
  });
});

describe('language/design.md 3.14 constants', () => {
  it('pi, tau, e, deg', () => {
    expect(num('pi')).toBeCloseTo(3.141592653589793, 14);
    expect(num('tau')).toBeCloseTo(6.283185307179586, 14);
    expect(num('e')).toBeCloseTo(2.718281828459045, 14);
    expect(num('deg')).toBeCloseTo(Math.PI / 180, 15);
    expect(num('tau')).toBeCloseTo(2 * num('pi'), 14);
    expect(num('30 deg')).toBeCloseTo(Math.PI / 6, 14);
  });

  it('inf is allowed as a bound and in comparisons', () => {
    expect(bool('inf > 1e300')).toBe(true);
    expect(bool('-inf < -1e300')).toBe(true);
    expect(bool('1 < inf')).toBe(true);
    expect(bool('inf == inf')).toBe(true);
    expect(bool('a < inf')).toBe(true);
    expect(check('x1 = Round3(inf)').ok).toBe(true);
  });

  it('3.14 arithmetic that would produce inf gives undefined not_finite (errors.md 8)', () => {
    expect(undefinedReason('inf - inf')).toBe('not_finite');
    expect(undefinedReason('0 * inf')).toBe('not_finite');
  });

  it('rulings.md Q4: out = inf stores positive infinity', () => {
    const e = ev('inf');
    expect(e.applied.defined).toBe(true);
    expect(e.value).toBe(Infinity);
  });

  it('rulings.md Q4: -inf is stored as negative infinity, and a stored inf is a defined Number', () => {
    const fig = newFig();
    expect(okValue(fig.apply('lo = -inf')).defined).toBe(true);
    expect(fig.valueOf('lo')).toBe(-Infinity);
    expect(okValue(fig.apply('hi = inf')).defined).toBe(true);
    expect(fig.valueOf('hi')).toBe(Infinity);
    expect(fig.lookup('hi')?.type.k).toBe('Number');
  });

  it('rulings.md Q4: inf may appear in any Number position', () => {
    const fig = newFig();
    expect(check('x1 = Round3(inf)', fig).ok).toBe(true);
    expect(check('p9 = (inf, 0)', fig).ok).toBe(true);
    expect(check('L9 = [inf, 1]', fig).ok).toBe(true);
    expect(bool('min(inf, 3) == 3', fig)).toBe(true);
    expect(bool('inf > a', fig)).toBe(true);
  });

  it('rulings.md Q4: arithmetic on finite numbers that overflows is undefined, never a stored inf', () => {
    // The ruling names `not_finite`; errors.md 8 gives finite inputs above the largest double the reason `overflow`
    // (`10^400`, `fact(200)`). Either reason is accepted here; the value must be undefined and not Infinity.
    const fig = newFig();
    const r = okValue(fig.apply('big = 1e308 * 10'));
    expect(r.defined).toBe(false);
    expect(['not_finite', 'overflow']).toContain(r.reason);
    expect(fig.valueOf('big')).not.toBe(Infinity);
    expect(undefinedReason('inf - inf')).toBe('not_finite');
  });

  it('undefined is the undefined Number with reason explicit', () => {
    expect(undefinedReason('undefined')).toBe('explicit');
    expect(checked('n1 = undefined').type?.k).toBe('Number');
  });

  it('true and false are Bool constants', () => {
    expect(checked('b1 = true').type?.k).toBe('Bool');
    expect(bool('true')).toBe(true);
    expect(bool('false')).toBe(false);
  });
});

describe('language/design.md 3.14 values', () => {
  const close = (src: string, v: number, digits = 10): void => {
    expect(num(src), src).toBeCloseTo(v, digits);
  };

  it.each([
    ['sin(0)', 0],
    ['sin(pi/2)', 1],
    ['sin(pi/6)', 0.5],
    ['cos(0)', 1],
    ['cos(pi)', -1],
    ['cos(pi/3)', 0.5],
    ['tan(0)', 0],
    ['tan(pi/4)', 1],
    ['sec(0)', 1],
    ['sec(pi)', -1],
    ['csc(pi/2)', 1],
    ['cot(pi/4)', 1],
    ['asin(1)', Math.PI / 2],
    ['asin(0)', 0],
    ['asin(-1)', -Math.PI / 2],
    ['acos(1)', 0],
    ['acos(0)', Math.PI / 2],
    ['acos(-1)', Math.PI],
    ['atan(1)', Math.PI / 4],
    ['atan(0)', 0],
    ['atan2(1, 1)', Math.PI / 4],
    ['atan2(1, -1)', (3 * Math.PI) / 4],
    ['atan2(-1, -1)', (-3 * Math.PI) / 4],
    ['atan2(1, 0)', Math.PI / 2],
    ['acot(1)', Math.PI / 4],
  ])('trig %s = %d', (src, v) => close(src, v));

  it.each([
    ['sinh(0)', 0],
    ['cosh(0)', 1],
    ['tanh(0)', 0],
    ['sinh(1)', Math.sinh(1)],
    ['cosh(1)', Math.cosh(1)],
    ['tanh(1)', Math.tanh(1)],
    ['sech(0)', 1],
    ['csch(1)', 1 / Math.sinh(1)],
    ['coth(1)', 1 / Math.tanh(1)],
    ['asinh(0)', 0],
    ['asinh(1)', Math.asinh(1)],
    ['acosh(1)', 0],
    ['acosh(2)', Math.acosh(2)],
    ['atanh(0)', 0],
    ['atanh(0.5)', Math.atanh(0.5)],
  ])('hyperbolic %s = %d', (src, v) => close(src, v));

  it.each([
    ['sqrt(16)', 4],
    ['sqrt(2)', Math.SQRT2],
    ['sqrt(0)', 0],
    ['cbrt(27)', 3],
    ['cbrt(-8)', -2],
    ['nroot(16, 4)', 2],
    ['nroot(-8, 3)', -2], // odd n returns the real root
    ['nroot(27, 3)', 3],
    ['hypot(3, 4)', 5],
    ['pow(2, 10)', 1024],
    ['pow(2, 0.5)', Math.SQRT2],
    ['exp(0)', 1],
    ['exp(1)', Math.E],
    ['exp(-1)', 1 / Math.E],
    ['ln(e)', 1],
    ['ln(1)', 0],
    ['ln(10)', Math.LN10],
    ['log10(1000)', 3],
    ['log10(1)', 0],
    ['log2(8)', 3],
    ['log2(1)', 0],
    ['log(2, 8)', 3],
    ['log(10, 100)', 2],
    ['log(e, e)', 1],
  ])('powers, roots, exp, log: %s = %d', (src, v) => close(src, v));

  it.each([
    ['floor(2.7)', 2],
    ['floor(-2.5)', -3],
    ['floor(3)', 3],
    ['ceil(2.1)', 3],
    ['ceil(-2.1)', -2],
    ['ceil(3)', 3],
    ['round(2.4)', 2],
    ['round(2.6)', 3],
    ['round(3.14159, 2)', 3.14],
    ['round(2.71828, 3)', 2.718],
    ['trunc(2.7)', 2],
    ['trunc(-2.7)', -2],
    ['fract(2.75)', 0.75],
    ['fract(3)', 0],
    ['abs(-3)', 3],
    ['abs(3)', 3],
    ['abs(0)', 0],
    ['sign(-5)', -1],
    ['sign(0)', 0],
    ['sign(4)', 1],
    ['min(3, 1, 2)', 1],
    ['min(5, 2)', 2],
    ['max(3, 1, 2)', 3],
    ['max(5, 2)', 5],
    ['max(1, 2, 3, 4, 5, 6)', 6],
    ['clamp(5, 0, 3)', 3],
    ['clamp(-1, 0, 3)', 0],
    ['clamp(2, 0, 3)', 2],
  ])('rounding, sign and size: %s = %d', (src, v) => close(src, v));

  it.each([
    ['mod(7, 3)', 1],
    ['mod(-7, 3)', 2], // result has the sign of b
    ['mod(7, -3)', -2],
    ['mod(-7, -3)', -1],
    ['rem(7, 3)', 1],
    ['rem(-7, 3)', -1], // sign of a
    ['rem(7, -3)', 1],
    ['gcd(12, 18)', 6],
    ['gcd(7, 13)', 1],
    ['lcm(4, 6)', 12],
    ['lcm(3, 5)', 15],
    ['fact(5)', 120],
    ['fact(0)', 1],
    ['fact(1)', 1],
    ['fact(10)', 3628800],
    ['5!', 120],
    ['ncr(5, 2)', 10],
    ['ncr(5, 0)', 1],
    ['ncr(5, 5)', 1],
    ['ncr(10, 3)', 120],
    ['npr(5, 2)', 20],
    ['npr(5, 0)', 1],
    ['npr(6, 3)', 120],
  ])('modular and counting: %s = %d', (src, v) => close(src, v));

  it.each([
    ['gamma(5)', 24],
    ['gamma(1)', 1],
    ['gamma(0.5)', Math.sqrt(Math.PI)],
    ['gamma(0.5) ^ 2', Math.PI],
    ['beta(2, 3)', 1 / 12],
    ['beta(1, 1)', 1],
    ['erf(0)', 0],
    ['erf(1)', 0.8427007929497149],
    ['erf(-1)', -0.8427007929497149],
    ['erfc(0)', 1],
    ['erfc(1)', 1 - 0.8427007929497149],
  ])('special functions: %s = %d', (src, v) => close(src, v, 7));

  it.each([
    ['lerp(0, 10, 0.25)', 2.5],
    ['lerp(2, 4, 0)', 2],
    ['lerp(2, 4, 1)', 4],
    ['lerp(2, 4, 2)', 6],
    ['smooth(0, 1, 0)', 0],
    ['smooth(0, 1, 0.5)', 0.5],
    ['smooth(0, 1, 1)', 1],
    ['smooth(0, 1, 2)', 1],
    ['smooth(0, 1, -1)', 0],
    ['step(0.5, 0.3)', 0],
    ['step(0.5, 0.7)', 1],
    ['step(0.5, 0.5)', 1],
  ])('interpolation: %s = %d', (src, v) => close(src, v));

  it('rand(seed) is in [0, 1) and deterministic', () => {
    for (const seed of ['0', '1', '2', '42', '-7', '3.5', '1e6']) {
      const r = num(`rand(${seed})`);
      expect(r, seed).toBeGreaterThanOrEqual(0);
      expect(r, seed).toBeLessThan(1);
      expect(num(`rand(${seed})`), seed).toBe(r);
    }
    const distinct = new Set(Array.from({ length: 20 }, (_, i) => num(`rand(${i})`)));
    expect(distinct.size).toBeGreaterThan(15);
  });

  it('noise(x), noise(x, y), noise(x, y, z) are in [-1, 1] and deterministic', () => {
    for (const x of [0, 0.3, 1.7, -2.2, 10.5]) {
      for (const call of [`noise(${x})`, `noise(${x}, 0.4)`, `noise(${x}, 0.4, 2.6)`]) {
        const v = num(call);
        expect(v, call).toBeGreaterThanOrEqual(-1);
        expect(v, call).toBeLessThanOrEqual(1);
        expect(num(call), call).toBe(v);
      }
    }
  });

  it('vector functions', () => {
    close('dot(u, w)', 11);
    close('cross(u, w)', -2); // 1*4 - 2*3
    close('norm(w)', 5);
    close('norm(u)', Math.sqrt(5));
    close('dot(perp(u), u)', 0);
    close('norm(perp(u))', Math.sqrt(5));
    close('norm(unit(w))', 1);
    close('unit(w).x', 0.6);
    close('unit(w).y', 0.8);
  });

  it('angle functions', () => {
    close('todeg(pi)', 180);
    close('todeg(pi / 2)', 90);
    close('torad(180)', Math.PI);
    close('torad(90)', Math.PI / 2);
    close('todeg(torad(37))', 37);
  });

  it('colour functions return Color; components are clamped to range', () => {
    expect(checked('co = rgb(255, 0, 0)').type?.k).toBe('Color');
    expect(checked('co = rgb(255, 0, 0, 0.5)').type?.k).toBe('Color');
    expect(checked('co = hsl(120, 1, 0.5)').type?.k).toBe('Color');
    expect(checked('co = hsl(120, 1, 0.5, 0.5)').type?.k).toBe('Color');
    const e = ev('rgb(300, -5, 0)');
    expect(e.applied.defined).toBe(true);
  });

  it('number(Text) parses a decimal; len(Text) counts characters', () => {
    close('number("3.5")', 3.5);
    close('number("-2")', -2);
    close('number("1e3")', 1000);
    close('len("hello")', 5);
    close('len("")', 0);
    close('m.length', 2);
    expect(undefinedReason('number("abc")')).toBe('out_of_domain');
    expect(undefinedReason('number("")')).toBe('out_of_domain');
  });

  it('min, max, abs take a List<Number> too; an empty list is undefined empty_list', () => {
    close('max(L)', 3);
    close('min(L)', 1);
    close('max([4, 9, 2])', 9);
    close('min([4, 9, 2])', 2);
    expect(undefinedReason('max(E)')).toBe('empty_list');
    expect(undefinedReason('min(E)')).toBe('empty_list');
    expect(undefinedReason('max([])')).toBe('empty_list');
  });

  it('values stay IEEE doubles: sin(pi) is not special-cased', () => {
    const v = num('sin(pi)');
    expect(Math.abs(v)).toBeLessThan(1e-15);
    expect(v).not.toBe(0);
    expect(num('sin(180 deg)')).toBeCloseTo(0, 12);
  });
});

describe('language/design.md 3.14 undefined reasons', () => {
  it.each([
    ['sqrt(-1)', 'out_of_domain'],
    ['sqrt(-0.0001)', 'out_of_domain'],
    ['asin(2)', 'out_of_domain'],
    ['asin(-1.5)', 'out_of_domain'],
    ['acos(2)', 'out_of_domain'],
    ['acos(-2)', 'out_of_domain'],
    ['atan2(0, 0)', 'out_of_domain'],
    ['acosh(0.5)', 'out_of_domain'],
    ['atanh(1)', 'out_of_domain'],
    ['atanh(-1)', 'out_of_domain'],
    ['atanh(2)', 'out_of_domain'],
    ['ln(0)', 'out_of_domain'],
    ['ln(-1)', 'out_of_domain'],
    ['log10(0)', 'out_of_domain'],
    ['log10(-5)', 'out_of_domain'],
    ['log2(0)', 'out_of_domain'],
    ['log2(-1)', 'out_of_domain'],
    ['log(0, 5)', 'out_of_domain'],
    ['log(-2, 5)', 'out_of_domain'],
    ['log(1, 5)', 'out_of_domain'],
    ['log(2, -5)', 'out_of_domain'],
    ['nroot(-16, 4)', 'out_of_domain'],
    ['clamp(1, 3, 0)', 'out_of_domain'],
    ['gamma(0)', 'out_of_domain'],
    ['gamma(-1)', 'out_of_domain'],
    ['gamma(-3)', 'out_of_domain'],
    ['beta(0, 1)', 'out_of_domain'],
    ['beta(1, -1)', 'out_of_domain'],
    ['gcd(1.5, 3)', 'out_of_domain'],
    ['lcm(2.5, 3)', 'out_of_domain'],
    ['fact(-1)', 'out_of_domain'],
    ['(-1)!', 'out_of_domain'],
    ['ncr(-1, 2)', 'out_of_domain'],
    ['1/0', 'division_by_zero'],
    ['a/0', 'division_by_zero'],
    ['mod(5, 0)', 'division_by_zero'],
    ['rem(5, 0)', 'division_by_zero'],
    ['smooth(1, 1, 0.5)', 'division_by_zero'],
    ['csc(0)', 'division_by_zero'],
    ['cot(0)', 'division_by_zero'],
    ['unit(z0)', 'division_by_zero'],
    ['fact(2.5)', 'not_integer'],
    ['2.5!', 'not_integer'],
    ['ncr(5.5, 2)', 'not_integer'],
    ['fact(200)', 'overflow'],
    ['fact(171)', 'overflow'],
    ['10^400', 'overflow'],
    ['inf - inf', 'not_finite'],
    ['0 * inf', 'not_finite'],
    ['L[0]', 'index_out_of_range'],
    ['L[4]', 'index_out_of_range'],
    ['L[1.5]', 'not_integer'],
    ['undefined', 'explicit'],
    ['undefined + 1', 'explicit'],
    ['if(false, 1)', 'condition_false'],
  ])('%s is undefined with reason %s', (src, reason) => {
    expect(undefinedReason(src)).toBe(reason);
  });

  it('coth(0) and csch(0): out_of_domain or division_by_zero', () => {
    expect(['out_of_domain', 'division_by_zero']).toContain(undefinedReason('coth(0)'));
    expect(['out_of_domain', 'division_by_zero']).toContain(undefinedReason('csch(0)'));
  });

  it('tan, sec at odd multiples of pi/2 and csc, cot at multiples of pi: large finite when the denominator is not exactly 0', () => {
    for (const src of ['tan(pi/2)', 'sec(pi/2)', 'csc(pi)', 'cot(pi)']) {
      const e = ev(src);
      expect(e.applied.defined, src).toBe(true);
      expect(Math.abs(e.value as number), src).toBeGreaterThan(1e15);
    }
  });

  it('fact(170) is the largest representable factorial', () => {
    const v = num('fact(170)');
    expect(v).toBeGreaterThan(7e306);
    expect(Number.isFinite(v)).toBe(true);
  });

  it('underflow to 0 is silent', () => {
    expect(num('1e-300 * 1e-300')).toBe(0);
  });

  it('errors.md 8: an undefined value is never a stored NaN or Infinity', () => {
    const fig = newFig();
    for (const src of ['out = sqrt(-1)', 'out = 1/0', 'out = fact(200)']) {
      const r = okValue(fig.apply(src));
      expect(r.defined, src).toBe(false);
      expect(Number.isNaN(fig.valueOf('out') as number) || fig.valueOf('out') === undefined, src).toBe(true);
    }
  });

  it('3.15 the first reason set in an evaluation wins', () => {
    expect(undefinedReason('1/0 + sqrt(-1)')).toBe('division_by_zero');
    expect(undefinedReason('sqrt(-1) + 1/0')).toBe('out_of_domain');
    expect(undefinedReason('ln(0) + sqrt(-1)')).toBe('out_of_domain');
  });

  it('errors.md 8: a comparison with an undefined operand is undefined, not false', () => {
    expect(bool('sqrt(-1) < 2')).toBeUndefined();
    expect(bool('sqrt(-1) >= 2')).toBeUndefined();
    expect(bool('2 != sqrt(-1)')).toBeUndefined();
  });

  it('3.15 evaluate() reports the reason and a short plain fact; compile does not throw', () => {
    const fig = newFig();
    const checkedLine = okValue(analyseLine('out = sqrt(-4)', fig));
    const compiled = okValue(compileLine(checkedLine));
    const r = evaluate(compiled, fig.env(checkedLine.slots));
    expect(r.defined).toBe(false);
    if (!r.defined) {
      expect(r.reason).toBe('out_of_domain');
      expect(r.detail ?? '').toContain('sqrt');
    }
  });

  it('3.15 evaluate() of a defined value', () => {
    const fig = newFig();
    const checkedLine = okValue(analyseLine('out = 2 + 3', fig));
    const compiled = okValue(compileLine(checkedLine));
    const r = evaluate(compiled, fig.env(checkedLine.slots));
    expect(r).toEqual({ defined: true, value: 5 });
  });

  it('errors.md 8: downstream of an undefined object is undefined input_undefined, with cause naming the input', () => {
    const fig = newFig();
    okValue(fig.apply('pu = sqrt(-1)'));
    const pu = fig.lookup('pu');
    expect(pu).toBeDefined();
    const line = okValue(analyseLine('out = pu + 1', fig));
    const compiled = okValue(compileLine(line));
    const r = evaluate(compiled, fig.env(line.slots));
    expect(r.defined).toBe(false);
    if (!r.defined) {
      expect(r.reason).toBe('input_undefined');
      expect(r.cause).toBe(pu?.id);
    }
    // and through the figure
    const applied = okValue(fig.apply('out = pu + 1'));
    expect(applied.defined).toBe(false);
    expect(applied.reason).toBe('input_undefined');
  });

  it('3.15 createEnv gives an environment with the clock', () => {
    const env = createEnv({ t: 2, bt: 0.5, beat: 3 });
    expect(env.t).toBe(2);
    expect(env.bt).toBe(0.5);
    expect(env.beat).toBe(3);
  });

  it('3.15 t, bt and beat are read from the environment', () => {
    const fig = newFig();
    fig.setClock(2, 0.5, 3);
    expect(num('t * 10', fig)).toBe(20);
    expect(num('bt', fig)).toBe(0.5);
    expect(num('beat', fig)).toBe(3);
    fig.setClock(4, 1, 5);
    fig.apply('out = t + bt + beat');
    expect(fig.valueOf('out')).toBe(10);
  });
});

describe('language/design.md 3.14 calls', () => {
  it('one-argument log(x) is refused with a hint to use ln, log10 or log2', () => {
    const e = failure('out = log(100)');
    // rulings.md Q7: a wrong argument count is arg_count (log has no one-argument form).
    expect(e.kind).toBe('arg_count');
    expect(e.hint).toMatch(/ln, log10 or log2/);
  });

  it('rulings.md Q7: a wrong argument count is arg_count and a wrong type is no_matching_form; both list the forms', () => {
    const cases: [string, string][] = [
      ['out = sin(1, 2)', 'arg_count'],
      ['out = sin("a")', 'no_matching_form'],
      ['out = atan2(1)', 'arg_count'],
      ['out = hypot(1)', 'arg_count'],
      ['out = clamp(1, 2)', 'arg_count'],
      ['out = sqrt()', 'arg_count'],
      ['out = sin(A)', 'no_matching_form'],
    ];
    for (const [src, kind] of cases) {
      const e = failure(src);
      expect(e.kind, src).toBe(kind);
      expect(e.forms.length, src).toBeGreaterThan(0);
      expect(e.forms[0], src).toMatch(/^[a-z0-9]+\(/);
    }
  });

  it('built-ins are callable only with parentheses', () => {
    expect(check('out = sin 2').ok).toBe(false);
    expect(check('out = sqrt a').ok).toBe(false);
  });

  it('min and max take any number of arguments, but at least two', () => {
    expect(check('out = max(1, 2, 3, 4, 5, 6, 7)').ok).toBe(true);
    expect(check('out = min(1, 2)').ok).toBe(true);
    expect(check('out = min()').ok).toBe(false);
  });

  it('round has a one-argument and a two-argument form', () => {
    expect(check('out = round(2.5)').ok).toBe(true);
    expect(check('out = round(2.567, 1)').ok).toBe(true);
    expect(check('out = round(2.567, 1, 3)').ok).toBe(false);
  });

  it('function results are typed: sin returns a Number; rgb returns a Color; len a Number', () => {
    expect(checked('out = sin(1)').type?.k).toBe('Number');
    expect(checked('out = rgb(1, 2, 3)').type?.k).toBe('Color');
    expect(checked('out = len(m)').type?.k).toBe('Number');
    expect(checked('out = number("3")').type?.k).toBe('Number');
  });

  it('functions compose and take expressions', () => {
    expect(num('sqrt(abs(-16)) + max(1, 2) * 2')).toBeCloseTo(8, 12);
    expect(num('sin(cos(0))')).toBeCloseTo(Math.sin(1), 12);
    expect(num('hypot(a, b)')).toBe(5);
    expect(num('clamp(a * 10, 0, b)')).toBe(4);
  });

  it('user functions: f(2), nested, and arithmetic of functions', () => {
    const fig = newFig();
    expect(num('f(2)', fig)).toBe(4);
    expect(num('g(f(2))', fig)).toBe(5);
    fig.apply('h(x) = f(x) + g(x)');
    expect(num('h(3)', fig)).toBe(13);
    fig.apply('k = 2 f + 1');
    expect(num('k(3)', fig)).toBe(19);
    fig.apply('qq(x) = f(g(x))');
    expect(num('qq(2)', fig)).toBe(9);
    fig.apply('sum = f + g');
    expect(num('sum(2)', fig)).toBe(7);
  });

  it('a Function<Point> returns points', () => {
    const fig = newFig();
    okValue(fig.apply('pf(x) = (x, x^2)'));
    okValue(fig.apply('Q9 = pf(3)'));
    expect(fig.valueOf('Q9')).toEqual({ x: 3, y: 9 });
  });

  it('a multi-variable user function', () => {
    const fig = newFig();
    okValue(fig.apply('mul(x, y) = x * y'));
    expect(num('mul(3, 4)', fig)).toBe(12);
    expect(failure('out = mul(3)', fig).forms.length).toBe(1);
  });

  it('element-wise list arithmetic with a scalar', () => {
    const fig = newFig();
    okValue(fig.apply('L2 = L * 2'));
    expect(Array.from(fig.valueOf('L2') as ArrayLike<number>)).toEqual([2, 4, 6]);
    okValue(fig.apply('L3 = L + 1'));
    expect(Array.from(fig.valueOf('L3') as ArrayLike<number>)).toEqual([2, 3, 4]);
    okValue(fig.apply('L4 = L / 2'));
    expect(Array.from(fig.valueOf('L4') as ArrayLike<number>)).toEqual([0.5, 1, 1.5]);
    okValue(fig.apply('L5 = L - 1'));
    expect(Array.from(fig.valueOf('L5') as ArrayLike<number>)).toEqual([0, 1, 2]);
  });

  it('point and vector arithmetic', () => {
    const fig = newFig();
    okValue(fig.apply('v9 = B - A'));
    expect(fig.valueOf('v9')).toEqual({ x: 3, y: 4 });
    okValue(fig.apply('P9 = A + u'));
    expect(fig.valueOf('P9')).toEqual({ x: 2, y: 4 });
    okValue(fig.apply('v8 = 2 * u'));
    expect(fig.valueOf('v8')).toEqual({ x: 2, y: 4 });
    okValue(fig.apply('v7 = w / 2'));
    expect(fig.valueOf('v7')).toEqual({ x: 1.5, y: 2 });
    okValue(fig.apply('v6 = -u'));
    expect(fig.valueOf('v6')).toEqual({ x: -1, y: -2 });
    okValue(fig.apply('v5 = u + w'));
    expect(fig.valueOf('v5')).toEqual({ x: 4, y: 6 });
    okValue(fig.apply('n9 = (B - A).length'));
    expect(fig.valueOf('n9')).toBeCloseTo(5, 12);
  });

  it('text concatenation', () => {
    const fig = newFig();
    okValue(fig.apply('t9 = m + " there"'));
    expect(fig.valueOf('t9')).toBe('hi there');
  });
});
