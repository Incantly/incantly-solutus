import { describe, expect, it } from 'vitest';
import { DARK, LIGHT } from '../src/index';
import type { Palette } from '../src/index';
import { changedText, countArgs, expandInsert, logicalLines, offsetOf, parseForm, plainSuperscripts, reasonText, speak, typeset } from '../src/text';

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('colours (ui.md section 2)', () => {
  const textKeys: (keyof Palette)[] = ['ink', 'secondary', 'accent', 'error', 'ok', 'object', 'unknown', 'command', 'fn', 'constant', 'number', 'operator', 'string', 'comment', 'keyword'];
  for (const [name, p] of [['light', LIGHT], ['dark', DARK]] as const) {
    it(`every ${name} text colour has contrast of at least 4.5:1 on the background`, () => {
      for (const k of textKeys) expect(contrast(p[k], p.bg), `${name} ${k}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('text helpers', () => {
  it('speaks common exponents and operators in words', () => {
    expect(speak('x^2 - 2')).toBe('x squared minus 2');
    expect(speak('2x^3 + 1')).toBe('2x cubed plus 1');
    expect(speak('a <= b')).toBe('a at most b');
    expect(speak('sqrt(a^2 + b^2)')).toBe('square root of (a squared plus b squared)');
  });

  it('typesets superscripts and operators but leaves strings alone', () => {
    expect(typeset('f(x) = 2x^2 - 3x + 1')).toBe('f(x) = 2x² − 3x + 1');
    expect(typeset('t = "a^2 <= b"')).toBe('t = "a^2 <= b"');
    expect(typeset('r = sqrt(2) * pi')).toBe('r = √(2) · π');
  });

  it('turns typed superscript digits into ^ form and keeps the caret after them', () => {
    expect(plainSuperscripts('x²', 2)).toEqual({ text: 'x^2', caret: 3 });
    expect(plainSuperscripts('x', 1)).toEqual({ text: 'x', caret: 1 });
  });

  it('maps a reason code to words, and an unknown code to its own words', () => {
    expect(reasonText('division_by_zero')).toBe('division by zero');
    expect(reasonText('some_new_reason')).toBe('some new reason');
  });

  it('splits a form into parameters and finds each one in the text', () => {
    const f = 'Circle(center: Point, [radius: Number]) -> Circle';
    const parts = parseForm(f);
    expect(parts.name).toBe('Circle');
    expect(parts.params.map((p) => [p.name, p.type, p.optional])).toEqual([['center', 'Point', false], ['radius', 'Number', true]]);
    expect(parts.returns).toBe('Circle');
    const first = parts.spans[0] as { start: number; end: number };
    expect(f.slice(first.start, first.end)).toBe('center: Point');
    expect(parseForm('Seq(body: Number, from: List<Number>, …) -> List<Number>').rest).toBe(true);
  });

  it('fills placeholders and reports where they are', () => {
    const r = expandInsert('Midpoint($1, $2)', (n) => (n === 1 ? 'A' : 'B'));
    expect(r.text).toBe('Midpoint(A, B)');
    expect(r.holes.map((x) => r.text.slice(x.start, x.end))).toEqual(['A', 'B']);
  });

  it('finds the changed text of a fix and counts arguments', () => {
    expect(changedText('c = Circle(A, 2, 3)', 'c = Circle(A, 3)')).toEqual({ added: '', removed: '2, ' });
    expect(countArgs('Circle(A, 2, 3)')).toBe(3);
    expect(countArgs('Circle(f(a, b), 2)')).toBe(2);
    expect(countArgs('Circle()')).toBe(0);
  });

  it('keeps a call that continues over lines as one logical line, with offsets', () => {
    const text = 'A = (1, 2)\nB = Midpoint(A,\n  A)\nC = 3';
    const lines = logicalLines(text);
    expect(lines.map((l) => l.text)).toEqual(['A = (1, 2)', 'B = Midpoint(A,\n  A)', 'C = 3']);
    expect(text.slice(lines[2]?.start, lines[2]?.end)).toBe('C = 3');
    expect(offsetOf('ab\ncd', 2, 2)).toBe(4);
  });
});
