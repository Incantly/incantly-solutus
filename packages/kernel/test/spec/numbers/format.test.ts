/**
 * Rounding and number text (numbers-sliders/design.md 3.5, 5 notice, errors.md 2 bad_format).
 *
 * Silent-doc choices (written down):
 *  - A value that rounds to zero never prints a minus sign ("-0 prints as 0" is read to cover -0.00 too).
 *  - The thin space before rad, turn and grad is U+2009 or U+202F.
 *  - `{expr:.2}` fixes the decimals: trailing zeros stay (3.10), as for a fixed object.
 */
import { describe, expect, it } from 'vitest';
import { formatAuralNumber, formatDisplayNumber, formatObjectNumber, formatWithSpec, parseFormatSpec, resolveDisplay, setFigureDefaults } from '@incantly/kernel';
import { NONE, decimalsFmt, disp, fig, num, ok, reject, sigFmt, each } from './helpers';

const fmt = formatDisplayNumber;
const THIN = /[\u2009\u202f]/;

describe('3.5 rule 1 and 2: undefined and fallbacks', () => {
  it('undefined prints as a dash', () => {
    expect(fmt(undefined, NONE)).toBe('–');
  });
  it('-infinity falls back to minus infinity', () => {
    expect(fmt(-Infinity, NONE)).toMatch(/^[-−]∞$/);
  });
});

describe('3.5 rule 6: auto format', () => {
  each([
    [3.14159, '3.142'],
    [2, '2'],
    [2.5, '2.5'],
    [0, '0'],
    [1234.5678, '1234.568'],
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.333'],
    [2 / 3, '0.667'],
    [100, '100'],
    [-2.5, '-2.5'],
    [0.0005, '0.001'],
    [0.0004, '0'],
    [999999999, '999999999'],
  ])('auto prints %s as %s', (x, want) => {
    expect(fmt(x, NONE)).toBe(want);
  });
  it('-0 prints as 0', () => {
    expect(fmt(-0, NONE)).toBe('0');
  });
  each([
    [1.2e-7, '1.2×10⁻⁷'],
    [1e9, '1×10⁹'],
    [1.5e10, '1.5×10¹⁰'],
    [5e-7, '5×10⁻⁷'],
  ])('scientific notation prints %s as %s', (x, want) => {
    expect(fmt(x, NONE)).toBe(want);
  });
  it('a negative number in scientific notation keeps its sign', () => {
    expect(fmt(-1.2e-7, NONE)).toMatch(/^[-−]1\.2×10⁻⁷$/);
  });
  it('the aural string uses e-notation: 1.2e-7', () => {
    expect(formatAuralNumber(1.2e-7, NONE)).toBe('1.2e-7');
  });
  it('the aural string rounds like the readout', () => {
    expect(formatAuralNumber(3.14159, NONE)).toBe('3.142');
  });
});

describe('3.5 rule 4: decimals round half away from zero on the decimal expansion', () => {
  each([
    [1.005, 2, '1.01'],
    [2.675, 2, '2.68'],
    [0.125, 2, '0.13'],
    [-0.125, 2, '-0.13'],
    [1, 2, '1.00'],
    [2.5, 0, '3'],
    [-2.5, 0, '-3'],
    [0.5, 0, '1'],
    [3.14159, 3, '3.142'],
    [1234.5, 1, '1234.5'],
    [0, 2, '0.00'],
    [9.995, 2, '10.00'],
    [100, 0, '100'],
    [0.1 + 0.2, 15, '0.300000000000000'],
  ])('%s with %s decimals prints %s', (x, n, want) => {
    expect(fmt(x, decimalsFmt(n))).toBe(want);
  });
  it('a small negative rounded to zero prints without a minus sign', () => {
    expect(fmt(-0.004, decimalsFmt(2))).toBe('0.00');
  });
  it('trim removes trailing zeros after the point', () => {
    expect(fmt(1, decimalsFmt(2, true))).toBe('1');
    expect(fmt(1.5, decimalsFmt(2, true))).toBe('1.5');
    expect(fmt(2.675, decimalsFmt(2, true))).toBe('2.68');
  });
  it('trim never strips zeros of a whole number', () => {
    expect(fmt(100, decimalsFmt(2, true))).toBe('100');
    expect(fmt(10, decimalsFmt(0, true))).toBe('10');
  });
});

describe('3.5 rule 5: significant figures', () => {
  each([
    [1234.5678, 3, '1230'],
    [0.0012345, 3, '0.00123'],
    [9.995, 3, '10.0'],
    [123456, 2, '120000'],
    [-1234.5678, 3, '-1230'],
    [0.5, 1, '0.5'],
    [1.5, 1, '2'],
    [2.5, 1, '3'],
    [15, 1, '20'],
    [99.95, 3, '100'],
  ])('%s to %s significant figures prints %s', (x, n, want) => {
    expect(fmt(x, sigFmt(n))).toBe(want);
  });
  it('trailing zeros are kept when trim is false: 3sf of 2 is 2.00', () => {
    expect(fmt(2, sigFmt(3, false))).toBe('2.00');
  });
  it('trailing zeros are removed when trim is true: 3sf of 2 is 2', () => {
    expect(fmt(2, sigFmt(3, true))).toBe('2');
  });
});

describe('3.5 rule 3 and 7: units', () => {
  it('30 degrees prints as 30° with no space', () => {
    expect(fmt(Math.PI / 6, disp({ unit: 'deg' }))).toBe('30°');
  });
  it('pi in degrees is 180°', () => {
    expect(fmt(Math.PI, disp({ unit: 'deg' }))).toBe('180°');
  });
  it('degrees with fixed decimals', () => {
    expect(fmt(Math.PI, disp({ unit: 'deg', format: { mode: 'decimals', n: 1 }, trim: false }))).toBe('180.0°');
  });
  it('one radian in degrees is 57.296° under auto', () => {
    expect(fmt(1, disp({ unit: 'deg' }))).toBe('57.296°');
  });
  it('radians print with a thin space and rad', () => {
    const s = fmt(1, disp({ unit: 'rad' }));
    expect(s).toMatch(/^1.rad$/);
    expect(s).toMatch(THIN);
  });
  it('turns print with a thin space and turn', () => {
    const s = fmt(2 * Math.PI, disp({ unit: 'turn' }));
    expect(s).toMatch(/^1.turn$/);
    expect(s).toMatch(THIN);
  });
  it('gradians print with a thin space and grad', () => {
    const s = fmt(Math.PI / 2, disp({ unit: 'grad' }));
    expect(s).toMatch(/^100.grad$/);
    expect(s).toMatch(THIN);
  });
  it('the aural string says degrees in words', () => {
    expect(formatAuralNumber(Math.PI / 6, disp({ unit: 'deg' }))).toBe('30 degrees');
  });
});

describe('3.5 text specs: parseFormatSpec', () => {
  each([
    ['.2', { decimals: 2 }],
    ['.0', { decimals: 0 }],
    ['.15', { decimals: 15 }],
    ['3sf', { sig: 3 }],
    ['1sf', { sig: 1 }],
    ['15sf', { sig: 15 }],
    ['deg', { unit: 'deg' }],
    ['rad', { unit: 'rad' }],
    ['turn', { unit: 'turn' }],
    ['grad', { unit: 'grad' }],
    ['.1deg', { decimals: 1, unit: 'deg' }],
    ['.3rad', { decimals: 3, unit: 'rad' }],
  ])('parses %s', (spec, want) => {
    expect(parseFormatSpec(spec)).toMatchObject(want);
  });
  it('a decimals spec has no sig and a sig spec has no decimals', () => {
    expect(parseFormatSpec('.2')).not.toHaveProperty('sig');
    expect(parseFormatSpec('3sf')).not.toHaveProperty('decimals');
  });
  each(['x', '', '.', '.-1', '0sf', '16sf', '.16', 'sf', '3', '.2.3', 'degrees', '.2xyz'])('refuses %j (the line fails with bad_format)', (spec) => {
    expect(parseFormatSpec(spec)).toBeUndefined();
  });
});

describe('3.5 text specs: formatWithSpec', () => {
  it('.2 fixes two decimals', () => {
    expect(formatWithSpec(3.14159, '.2', NONE)).toBe('3.14');
  });
  it('.2 keeps the trailing zero: 3.1 prints as 3.10', () => {
    expect(formatWithSpec(3.1, '.2', NONE)).toBe('3.10');
  });
  it('3sf gives three significant figures', () => {
    expect(formatWithSpec(1234.5678, '3sf', NONE)).toBe('1230');
  });
  it('deg shows a radian value as degrees', () => {
    expect(formatWithSpec(Math.PI / 2, 'deg', NONE)).toBe('90°');
  });
  it('.1deg combines decimals and degrees', () => {
    expect(formatWithSpec(Math.PI / 2, '.1deg', NONE)).toBe('90.0°');
  });
  it('the spec decimals override the object decimals and keep its unit', () => {
    expect(formatWithSpec(Math.PI / 2, '.2', disp({ unit: 'deg' }))).toBe('90.00°');
  });
  it('a bad spec gives undefined so the Text line can fail with bad_format', () => {
    expect(formatWithSpec(1, 'x', NONE)).toBeUndefined();
  });
});

describe('3.5 on a figure: per-object and figure-wide rounding', () => {
  it('the default is auto: 3 decimals, trimmed', () => {
    expect(formatObjectNumber(fig('x1 = 3.14159'), 'x1')).toBe('3.142');
  });
  it('x with digits = 2 prints two decimals', () => {
    const f = fig(['x1 = 3.14159', 'x1 with digits = 2']);
    expect(formatObjectNumber(f, 'x1')).toBe('3.14');
  });
  it('digits = 2 keeps trailing zeros by default (trim false for fixed)', () => {
    const f = fig(['x1 = 3.1', 'x1 with digits = 2']);
    expect(formatObjectNumber(f, 'x1')).toBe('3.10');
  });
  it('digits = 2 with trim = true removes them', () => {
    const f = fig(['x1 = 3.1', 'x1 with digits = 2, trim = true']);
    expect(formatObjectNumber(f, 'x1')).toBe('3.1');
  });
  it('x with sig = 3 prints three significant figures', () => {
    const f = fig(['x1 = 1234.5678', 'x1 with sig = 3']);
    expect(formatObjectNumber(f, 'x1')).toBe('1230');
  });
  it('sig = 3 keeps the zeros of 2: 2.00', () => {
    const f = fig(['x1 = 2', 'x1 with sig = 3']);
    expect(formatObjectNumber(f, 'x1')).toBe('2.00');
  });
  it('digits never reach the maths: a reader of a rounded-looking number gets the full value', () => {
    const f = fig(['x1 = 3.14159', 'x1 with digits = 1', 'y1 = x1 * 2']);
    expect(num(f, 'y1')).toBe(3.14159 * 2);
  });
  it('resolveDisplay: the default is auto, no unit, trim true', () => {
    expect(resolveDisplay(fig('x1 = 1'), 'x1')).toMatchObject({ unit: 'none', format: { mode: 'auto' }, trim: true });
  });
  it('resolveDisplay: digits = 2 gives decimals mode with trim false', () => {
    const f = fig(['x1 = 1', 'x1 with digits = 2']);
    expect(resolveDisplay(f, 'x1')).toMatchObject({ format: { mode: 'decimals', n: 2 }, trim: false });
  });
  it('@digits 3 sets the figure default for numbers with no own digits', () => {
    const f = fig('x1 = 3.14159');
    setFigureDefaults(f, { digits: 1 });
    expect(formatObjectNumber(f, 'x1')).toBe('3.1');
  });
  it('@sig 4 sets a figure default of four significant figures', () => {
    const f = fig('x1 = 1234.5678');
    setFigureDefaults(f, { sig: 4 });
    expect(formatObjectNumber(f, 'x1')).toBe('1235');
  });
  it('an own digits beats the figure default', () => {
    const f = fig(['x1 = 3.14159', 'x1 with digits = 2']);
    setFigureDefaults(f, { digits: 1 });
    expect(formatObjectNumber(f, 'x1')).toBe('3.14');
  });
  it('the @digits directive itself is accepted', () => {
    ok(fig('x1 = 3.14159').apply('@digits 3'));
  });
  it('@digits 3 formats numbers with no own setting', () => {
    const f = fig(['x1 = 3.14159', '@digits 1']);
    expect(formatObjectNumber(f, 'x1')).toBe('3.1');
  });
  it('a digits value outside 0..15 is bad_property_value', () => {
    reject(fig('x1 = 1'), 'x1 with digits = 16', 'bad_property_value');
  });
});
