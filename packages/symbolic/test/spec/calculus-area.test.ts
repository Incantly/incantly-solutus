/**
 * Exact calculus for Function objects (cas/design.md 5.10, 5.15; finding SYM-SM-14; .kiro/specs/cas task 9).
 * With the engine set, Integral(f, a, b), Integral(f) and Extremum(f) of a named function use exact results; every
 * pole inside an interval is found and decided from both sides.
 */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, Figure, geometry, registerCas, registerFunctions, registerNumbers, setCasEngine } from '@incantly/kernel';
import { SYMBOLIC_COMMANDS } from '@incantly/symbolic/catalogue';
import { casEngine, run } from '@incantly/symbolic/engine';
import { ex, nm, sy } from './helpers';

const registry = new CommandRegistry();
geometry.registerGeometry(registry);
registerNumbers(registry);
registerFunctions(registry);
registerCas(registry, SYMBOLIC_COMMANDS);
setCasEngine(casEngine);

const fig = (lines: readonly string[]): Figure => {
  const f = new Figure({ commands: registry });
  for (const l of lines) {
    const r = f.apply(l);
    if (!r.ok) throw new Error(`${l}: ${r.message}`);
  }
  return f;
};
const cell = (f: Figure, n: string) => f.get(n)?.cell;

describe('Integral(f, a, b) of a Function object', () => {
  it.each([
    ['k(x) = x^2', 'Integral(k, 0, 3)', 9],
    ['k(x) = a*x^2 - 3x', 'Integral(k, 0, 3)', 4.5],
    ['k(x) = 1/sqrt(abs(x))', 'Integral(k, -1, 1)', 4],
    ['k(x) = 1/sqrt(x)', 'Integral(k, 0, 4)', 4],
    ['k(x) = ln(x)', 'Integral(k, 0, 1)', -1],
  ])('%s: %s is %s', (def, line, want) => {
    const f = fig(['a = 2 in 0..5', def, `I = ${line}`]);
    const c = cell(f, 'I');
    expect(c?.defined).toBe(true);
    expect(c?.defined ? (c.value as number) : NaN).toBeCloseTo(want, 9);
  });

  it.each([
    ['k(x) = 1/x', 'Integral(k, -1, 2)', '0'],
    ['k(x) = 1/x^2', 'Integral(k, -1, 1)', '0'],
    ['k(x) = 1/(x - 1)', 'Integral(k, 0, 2)', '1'],
    ['k(x) = 1/cos(x)', 'Integral(k, 0, 3)', '1.5707'],
  ])('%s: %s diverges near %s', (def, line, at) => {
    const f = fig([def, `I = ${line}`]);
    const c = cell(f, 'I');
    expect(c?.defined).toBe(false);
    expect(c && !c.defined ? c.reason : '').toBe('diverges');
    expect(c && !c.defined ? c.detail : '').toContain(`near ${at}`);
  });

  it('the value follows a slider the function reads', () => {
    const f = fig(['a = 1 in 0..5', 'k(x) = a*x', 'I = Integral(k, 0, 2)']);
    expect(f.value('I')).toBeCloseTo(2, 12);
    f.apply('SetValue(a, 3)');
    expect(f.value('I')).toBeCloseTo(6, 12);
  });
});

describe('Integral(f) and Extremum(f)', () => {
  it('the antiderivative is exact and starts at 0', () => {
    const f = fig(['k(x) = 3x^2 + 1', 'F = Integral(k)', 'v = F(2)']);
    expect(f.value('v')).toBeCloseTo(10, 12);
  });

  it('Extremum of a polynomial uses its exact stationary points', () => {
    const f = fig(['h(x) = x^3 - 3x', 'E = Extremum(h)']);
    expect(f.value('E')).toEqual([{ x: -1, y: 2 }, { x: 1, y: -2 }]);
    const g = fig(['h(x) = x^4 - 2x^2', 'E = Extremum(h)']);
    expect((g.value('E') as { x: number }[]).map((p) => p.x)).toEqual([-1, 0, 1]);
  });
});

describe('the engine on poles (SYM-SM-14)', () => {
  it('an integrable singularity is an improper integral, not divergent', () => {
    const r = run('Integral', [ex('1/sqrt(abs(x))'), sy('x'), nm(-1), nm(1)]);
    expect(r.ok && r.value.cell.defined).toBe(true);
  });

  it('a simple pole inside the interval diverges, and the message names the exact point', () => {
    const r = run('Integral', [ex('1/x'), sy('x'), nm(-1), nm(2)]);
    expect(r.ok && !r.value.cell.defined ? r.value.cell.reason : '').toBe('divergent');
    expect(r.ok && !r.value.cell.defined ? r.value.cell.detail?.text : '').toContain('near 0.');
  });
});
