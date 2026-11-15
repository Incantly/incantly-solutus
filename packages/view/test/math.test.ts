/** The math layout engine (docs/features/text-logic/design.md 6.1 to 6.6). */
import { describe, expect, it } from 'vitest';
import { math } from '../src/index';
import type { MathLayout } from '../src/index';

const lay = (src: string, px = 20): MathLayout => {
  const r = math.parseTex(src);
  if (!r.ok) throw new Error(r.message);
  return math.layoutBox(r.box, px, math.roughMeasure);
};
const glyphs = (l: MathLayout): string[] => l.items.flatMap((i) => (i.k === 'glyph' ? [i.s] : []));

describe('parsing the subset (6.3)', () => {
  it.each([
    '\\frac{x^{2}}{2} - 3 x', '\\sqrt{2}', '\\sqrt[3]{x + 1}', '\\left(\\frac{a}{b}\\right)', 'x_{1}^{2}', '\\alpha + \\beta \\leq \\pi',
    '\\sum_{k=1}^{n} k^{2}', '\\int_{0}^{1} x \\, dx', '\\lim_{x \\to 0} \\frac{\\sin x}{x}', '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}',
    '\\begin{cases} x & \\text{if } x > 0 \\\\ -x & \\text{otherwise} \\end{cases}', '\\begin{array}{lc} a & b \\\\ \\hline c & d \\end{array}',
    '\\hat{x} + \\vec{v} + \\bar{y}', '\\mathbb{R} \\to \\mathbb{R}', '\\color{red}{x}', '3 + \\cfrac{1}{7 + \\cfrac{1}{15}}', '\\left[1; 2, 2, \\ldots\\right]',
  ])('%s', (src) => {
    expect(math.parseTex(src).ok).toBe(true);
  });
  it('an unknown macro is latex_unsupported with its name and place', () => {
    const r = math.parseTex('x + \\tikz{y}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('latex_unsupported');
      expect(r.macro).toBe('\\tikz');
      expect(r.at).toBe(4);
    }
  });
  it('splits plain runs from $…$ runs, with \\$ as a literal dollar', () => {
    expect(math.splitMath('Area $\\frac12$ m and \\$5')).toEqual([
      { kind: 'text', s: 'Area ' }, { kind: 'math', s: '\\frac12' }, { kind: 'text', s: ' m and $5' },
    ]);
    expect(math.hasMath('no maths')).toBe(false);
  });
});

describe('layout (6.1)', () => {
  it('a fraction is taller than its parts and has a rule', () => {
    const l = lay('\\frac{1}{2}');
    const one = lay('1');
    expect(l.asc + l.desc).toBeGreaterThan(1.6 * (one.asc + one.desc));
    expect(l.items.some((i) => i.k === 'rule')).toBe(true);
  });
  it('a superscript is smaller and raised', () => {
    const l = lay('x^{2}');
    const two = l.items.find((i) => i.k === 'glyph' && i.s === '2');
    expect(two && two.k === 'glyph' && two.px).toBeLessThan(20);
    expect(two && two.k === 'glyph' && two.y).toBeLessThan(0);
  });
  it('a root has a sign and a bar over its body', () => {
    const l = lay('\\sqrt{x}');
    expect(l.items.some((i) => i.k === 'path')).toBe(true);
    expect(l.items.some((i) => i.k === 'rule')).toBe(true);
  });
  it('fences grow with their body', () => {
    const small = lay('\\left( x \\right)');
    const big = lay('\\left( \\frac{\\frac{1}{2}}{3} \\right)');
    const height = (l: MathLayout): number => l.asc + l.desc;
    expect(height(big)).toBeGreaterThan(height(small) * 1.5);
  });
  it('a matrix has a cell for each entry', () => {
    expect(glyphs(lay('\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}'))).toEqual(['1', '2', '3', '4']);
  });
  it('a binary minus has space on both sides; a leading one does not', () => {
    const l = lay('a - b');
    const [a, minus, b] = l.items.filter((i) => i.k === 'glyph') as { x: number }[];
    expect((minus?.x ?? 0) - (a?.x ?? 0)).toBeGreaterThan(20 * 0.55 + 2);
    expect((b?.x ?? 0) - (minus?.x ?? 0)).toBeGreaterThan(20 * 0.55 + 2);
    const u = lay('-b');
    const [m2, b2] = u.items.filter((i) => i.k === 'glyph') as { x: number }[];
    expect((b2?.x ?? 0) - (m2?.x ?? 0)).toBeLessThan(20 * 0.55 + 1);
  });
  it('Greek, blackboard bold and functions become the right glyphs', () => {
    expect(glyphs(lay('\\alpha \\Omega'))).toEqual(['α', 'Ω']);
    expect(glyphs(lay('\\mathbb{R}'))).toEqual(['ℝ']);
    expect(glyphs(lay('\\sin x'))).toEqual(['sin', 'x']);
  });
  it('a whole text: plain runs in the text font, maths typeset, unsupported maths shown as source', () => {
    const l = math.layoutText('Area $\\frac{1}{2} b h$', 16, math.roughMeasure);
    expect(l.items.some((i) => i.k === 'rule')).toBe(true);
    const bad = math.layoutText('see $\\tikz$', 16, math.roughMeasure);
    expect(glyphs(bad)).toContain('$\\tikz$');
  });
});

describe('SVG and speed (6.6)', () => {
  it('writes an SVG with escaped text', () => {
    const svg = math.mathSvg(lay('a < b'));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('&lt;');
    expect(svg).not.toMatch(/<script/);
  });
  it('a typical formula lays out in under 0.3 ms', () => {
    const src = '\\frac{-b \\pm \\sqrt{b^{2} - 4 a c}}{2 a} + \\sum_{k=1}^{n} \\frac{1}{k^{2}}';
    const r = math.parseTex(src);
    if (!r.ok) throw new Error('parse');
    for (let k = 0; k < 50; k++) math.layoutBox(r.box, 20, math.roughMeasure);
    const t0 = performance.now();
    for (let k = 0; k < 500; k++) math.layoutBox(r.box, 20, math.roughMeasure);
    expect((performance.now() - t0) / 500).toBeLessThan(0.3);
  });
});
