/**
 * VerticalText and RotateText (docs/features/text-logic/design.md 2.1, 4.7; .kiro/specs/text-logic task 8).
 * Both return the text with a property set, so the value never changes and `with` can still override it.
 */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, registerNumbers, registerText } from '@incantly/kernel';

const registry = new CommandRegistry();
geometry.registerGeometry(registry);
registerNumbers(registry);
registerText(registry);

const fig = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: registry });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${r.message}`);
  }
  return f;
};
const ext = (f: Figure, name: string): Record<string, unknown> => (f.get(name)?.style.ext ?? {}) as Record<string, unknown>;

describe('RotateText (design 4.7)', () => {
  it('keeps the text and sets rotate in radians', () => {
    const f = fig(['T = "hello"', 'R = RotateText(T, 30deg)']);
    expect(f.value('R')).toBe('hello');
    expect(ext(f, 'R')['rotate']).toBeCloseTo(Math.PI / 6, 12);
  });

  it('follows a slider without the text recomputing', () => {
    const f = fig(['a = 0.5 in 0..3', 'R = RotateText("tilt", a)']);
    expect(ext(f, 'R')['rotate']).toBeCloseTo(0.5, 12);
    expect(f.apply('SetValue(a, 1.25)').ok).toBe(true);
    expect(ext(f, 'R')['rotate']).toBeCloseTo(1.25, 12);
    expect(f.value('R')).toBe('tilt');
  });

  it('lets a written with win over the command', () => {
    const f = fig(['R = RotateText("x", 1) with rotate = 2, at = (1, 1)']);
    expect(ext(f, 'R')['rotate']).toBeCloseTo(2, 12);
    expect(ext(f, 'R')['at']).toEqual({ x: 1, y: 1 });
  });

  it('refuses a non-text with a fix that wraps it in Text', () => {
    const f = fig(['A = (1, 2)']);
    const r = f.apply('R = RotateText(A, 1)');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.kind).toBe('type_mismatch');
    expect(JSON.stringify(r.suggest ?? [])).toContain('Text(A)');
  });

  it('is the text unchanged inside a larger expression', () => {
    const f = fig(['L = ReplaceAll(RotateText("abc", 1), "b", "x")']);
    expect(f.value("L")).toBe("axc");
  });
});

describe('VerticalText (design 4.7)', () => {
  it('keeps the text and sets vertical', () => {
    const f = fig(['V = VerticalText("axis") with at = (0, 0)']);
    expect(f.value('V')).toBe('axis');
    expect(ext(f, 'V')['vertical']).toBe(true);
  });

  it('can be turned off again with with', () => {
    const f = fig(['V = VerticalText("y") with vertical = false']);
    expect(ext(f, 'V')['vertical']).toBe(false);
  });

  it('takes one argument', () => {
    const f = fig([]);
    expect(f.apply('V = VerticalText("a", 2)').ok).toBe(false);
  });
});
