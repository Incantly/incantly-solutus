/** Algebra view text (docs/features/algebra-view/design.md 3.3 to 3.5, 3.10, 3.17), from the docs and public API only. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_FORMAT, describeObject, formatNumber, fractionOf, lineEquation, niceRange, prettyText, summarize, valueTextOf } from '@incantly/kernel';

const f = (x: number, patch: Partial<typeof DEFAULT_FORMAT> = {}): string => formatNumber(x, { ...DEFAULT_FORMAT, ...patch }).text;

describe('numbers (3.3)', () => {
  it('rounds on the shortest decimal form, half away from zero', () => {
    expect(f(2.675)).toBe('2.68');
    expect(f(-2.675)).toBe('−2.68');
    expect(f(1.5)).toBe('1.5');
    expect(f(1.005)).toBe('1.01');
    expect(f(0.004)).toBe('0');
    expect(f(-0)).toBe('0');
    expect(f(1.5, { trimZeros: false })).toBe('1.50');
    expect(formatNumber(1 / 3).approx).toBe(true);
  });
  it('fractions, scientific and significant figures', () => {
    expect(f(0.75, { notation: 'fraction' })).toBe('3/4');
    expect(f(Math.PI / 2, { notation: 'fraction' })).toBe('π/2');
    expect(fractionOf(Math.SQRT2)).toBeUndefined();
    expect(f(1.234e10)).toBe('1.23 × 10¹⁰');
    expect(f(0.0000012)).toBe('1.2 × 10⁻⁶');
    expect(f(123.456, { significant: 4 })).toBe('123.5');
    expect(f(Infinity)).toBe('∞');
  });
});

describe('values of every type (3.3)', () => {
  it('points, vectors, lines, circles, segments, polygons, lists', () => {
    expect(valueTextOf('Point', { x: 1.5, y: -2 })).toBe('(1.5, −2)');
    expect(valueTextOf('Vector', { x: 3, y: 4 })).toBe('⟨3, 4⟩');
    expect(lineEquation(-2, 1, -1)).toBe('y = 2x + 1');
    expect(lineEquation(1, 0, -3)).toBe('x = 3');
    expect(lineEquation(0, 1, -4)).toBe('y = 4');
    expect(lineEquation(1, 1, 0)).toBe('y = −x');
    expect(valueTextOf('Circle', { cx: 1, cy: -2, r: 3 })).toBe('(x − 1)² + (y + 2)² = 9');
    expect(valueTextOf('Segment', { a: { x: 0, y: 0 }, b: { x: 3, y: 4 } })).toBe('5');
    expect(valueTextOf('Polygon', { pts: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }] })).toBe('6');
    expect(valueTextOf('List<Number>', Float64Array.from([1, 2.5, 3]))).toBe('{1, 2.5, 3}');
    expect(valueTextOf('List<Number>', Float64Array.from({ length: 10 }, (_, i) => i))).toBe('{0, 1, 2, 3, 4, 5, 6, 7, … 10 items}');
  });
});

describe('definitions, descriptions and summaries (3.4, 3.5, 3.17)', () => {
  it('pretty text', () => {
    expect(prettyText('f(x) = x^2 - 2*x')).toBe('f(x) = x² − 2x');
    expect(prettyText('h = sqrt(a^2 + b^2)')).toBe('h = √(a² + b²)');
    expect(prettyText('t = "x^2 - 1"')).toBe('t = "x^2 - 1"');
    expect(prettyText('p = q <= 2*pi')).toBe('p = q ≤ 2π');
  });
  const obj = (definition: string, type = 'Point', free = false, cell: { defined: boolean; value?: unknown; reason?: string } = { defined: true, value: { x: 2, y: 3 } }) => ({ name: definition.split(' ')[0] as string, type, typeText: type, free, definition, cell });
  it('descriptions from calls, free objects and expressions', () => {
    expect(describeObject(obj('M = Midpoint(A, B)'))).toBe('Midpoint of A and B');
    expect(describeObject(obj('P = PointOn(c, 0.3)'))).toBe('Point on c');
    expect(describeObject(obj('P = PointOn(c)'))).toBe('Point on c');
    expect(describeObject(obj('X = Intersect(l, m)'))).toBe('Intersection of l and m');
    expect(describeObject(obj('M = Midpoint(A, B)'), [], 'Midpoint of {0} and {1}')).toBe('Midpoint of A and B');
    expect(describeObject(obj('A = (1, 2)', 'Point', true))).toBe('Point');
    expect(describeObject({ ...obj('a = 3', 'Number', true), range: { min: 0, max: 10 } })).toBe('Slider');
    expect(describeObject(obj('h = a + b', 'Number'), ['a', 'b'])).toBe('Number from a and b');
  });
  it('summaries', () => {
    expect(summarize(obj('A = (2, 3)', 'Point', true)).text).toBe('A = (2, 3)');
    expect(summarize(obj('M = Midpoint(A, B)')).text).toBe('M = Midpoint(A, B) → (2, 3)');
    expect(summarize(obj('h = sqrt(a^2 + b^2)', 'Number', false, { defined: true, value: 5 })).text).toBe('h = √(a² + b²) = 5');
    expect(summarize(obj('f(x) = x^2 - 2', 'Function', false, { defined: true, value: {} })).text).toBe('f(x) = x² − 2');
    const u = summarize(obj('r = Root(f, 0, 1)', 'Point', false, { defined: false, reason: 'out_of_domain' }));
    expect(u.text).toBe('r = undefined (out_of_domain)');
    expect(u.undef?.reason).toBe('out_of_domain');
    expect(summarize(obj(`L = [${'1, '.repeat(60)}1]`, 'List<Number>', true, { defined: true, value: Float64Array.from({ length: 61 }, () => 1) }), { maxChars: 30 }).text.length).toBe(30);
  });
});

describe('slider ranges (3.10)', () => {
  it.each([[3, 0, 10, 0.1], [12, 0, 50, 0.5], [-0.4, -1, 0, 0.01], [0, -5, 5, 0.1]])('%d', (v, lo, hi, step) => {
    expect(niceRange(v)).toEqual({ min: lo, max: hi, step });
  });
  it('angles', () => expect(niceRange(1, 'angle')).toEqual({ min: 0, max: 2 * Math.PI, step: Math.PI / 180 }));
});
