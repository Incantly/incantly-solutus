import { evaluate as mathjsEvaluate } from 'mathjs';
import { describe, expect, it } from 'vitest';
import { ExpressionError, compileExpression, tryCompileExpression } from '../src/expr';
import { MAX_DEPTH } from '../src/expr/parser';
import { MAX_SOURCE_LENGTH } from '../src/expr/tokens';

const run = (source: string, scope: Record<string, number> = {}, variables = Object.keys(scope)) =>
  compileExpression(source, variables).evaluate(scope);

function errorOf(source: string, variables: string[] = []): ExpressionError {
  const result = tryCompileExpression(source, variables);
  if (result.ok) throw new Error(`expected "${source}" to fail`);
  return result.error;
}

describe('the built-ins the PRD names (FM-5)', () => {
  const at = (source: string, x: number) => compileExpression(source, ['x']).evaluate({ x });
  it('evaluates log, ln, sign and step, with the rest of the list', () => {
    // log is the natural logarithm, as ln is; log10 and log2 name their bases.
    expect(at('log(x)', Math.E)).toBeCloseTo(1, 12);
    expect(at('ln(x)', Math.E ** 2)).toBeCloseTo(2, 12);
    expect(at('log10(x)', 1000)).toBeCloseTo(3, 12);
    expect(at('log2(x)', 8)).toBeCloseTo(3, 12);
    expect([at('sign(x)', -3), at('sign(x)', 0), at('sign(x)', 2.5)]).toEqual([-1, 0, 1]);
    expect([at('step(x)', -0.1), at('step(x)', 0), at('step(x)', 4)]).toEqual([0, 1, 1]);
    // A piecewise function from step: |x| written without abs.
    expect(at('x*(2*step(x) - 1)', -2)).toBe(2);
    expect(at('abs(x) + floor(x) + min(x, 1) + max(x, 0)', -1.5)).toBeCloseTo(1.5 - 2 - 1.5 + 0, 12);
    expect(at('exp(x) + sin(x) + cos(x) + tan(x)', 0)).toBeCloseTo(2, 12);
    expect(Number.isNaN(at('log(x)', -1))).toBe(true);
  });
});

describe('expression parser', () => {
  it.each([
    ['2+3*4', 14],
    ['(2+3)*4', 20],
    ['2^3^2', 512],
    ['-2^2', -4],
    ['10-4-3', 3],
    ['8/4/2', 1],
    ['-(-3)', 3],
    ['2*-3', -6],
    ['1e3 + 2e-2', 1000.02],
    ['3 < 4 ? 1 : 2', 1],
    ['1 && 0 || 1', 1],
    ['!0', 1],
    ['max(1, 5, 3) + min(4, 2)', 7],
    ['clamp(12, 0, 10)', 10],
    ['2*pi', 2 * Math.PI],
    ['e', Math.E],
  ])('evaluates %s', (source, expected) => {
    expect(run(source)).toBeCloseTo(expected, 12);
  });

  it('reads Greek letters as names, as a scene may write them', () => {
    expect(run('ρ*g*h', { ρ: 1000, g: 9.8, h: 2 })).toBeCloseTo(19600, 9);
    expect(run('2*π*r', { π: Math.PI, r: 1 })).toBeCloseTo(2 * Math.PI, 12);
  });

  it('agrees with math.js on operator precedence', () => {
    for (const source of ['2+3*4', '2^3^2', '-2^2', '10-4-3', '8/4/2', '2*-3', '-(2+3)^2', '1+2*3^2/4-5']) {
      expect(run(source), source).toBeCloseTo(mathjsEvaluate(source) as number, 12);
    }
  });

  it('reads declared variables from the scope', () => {
    const wave = compileExpression('A*sin(w*x + phi - t)', ['A', 'w', 'phi', 'x', 't']);
    expect(wave.variables).toEqual(['A', 'w', 'x', 'phi', 't']);
    expect(wave.evaluate({ A: 2, w: 1, phi: 0, x: Math.PI / 2, t: 0 })).toBeCloseTo(2, 12);
  });

  it('returns NaN for a declared variable missing from the scope', () => {
    expect(Number.isNaN(run('x + 1', {}, ['x']))).toBe(true);
  });

  it('supports piecewise definitions with conditionals', () => {
    const abs = compileExpression('x < 0 ? -x : x', ['x']);
    expect(abs.evaluate({ x: -3 })).toBe(3);
    expect(abs.evaluate({ x: 4 })).toBe(4);
  });

  it('has smooth noise in one and two dimensions, the same every time (FM-5)', () => {
    const one = compileExpression('noise(x)', ['x']);
    const two = compileExpression('noise(x, y)', ['x', 'y']);
    const xs = Array.from({ length: 4001 }, (_, i) => -20 + i * 0.01);
    const values = xs.map((x) => one.evaluate({ x }));
    // From -1 to 1, 0 on the lattice, and not flat in between.
    expect(Math.max(...values.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.8);
    for (const x of [-3, 0, 2, 7]) expect(one.evaluate({ x })).toBeCloseTo(0, 12);
    // Continuous: neighbours 0.01 apart differ by little.
    for (let i = 1; i < values.length; i++) expect(Math.abs(values[i]! - values[i - 1]!)).toBeLessThan(0.05);
    // Deterministic, here and in two dimensions.
    expect(compileExpression('noise(x)', ['x']).evaluate({ x: 3.7 })).toBe(one.evaluate({ x: 3.7 }));
    const grid = xs.slice(0, 400).map((x, i) => two.evaluate({ x, y: i * 0.013 }));
    expect(Math.max(...grid.map(Math.abs))).toBeLessThanOrEqual(1);
    expect(new Set(grid.map((v) => v.toFixed(3))).size).toBeGreaterThan(100);
    expect(two.evaluate({ x: 1.25, y: -4.5 })).toBe(two.evaluate({ x: 1.25, y: -4.5 }));
    expect(Number.isNaN(one.evaluate({ x: Number.POSITIVE_INFINITY }))).toBe(true);
    expect(errorOf('noise(1, 2, 3)').message).toMatch(/noise/);
  });
});

describe('expression errors carry source positions', () => {
  it.each([
    ['x + y', ['x'], 'Unknown variable "y"', 4],
    ['foo(1)', [], 'Unknown function "foo"', 0],
    ['sin(1, 2)', [], 'sin takes 1 argument, got 2', 0],
    ['2 * (3 + 4', [], 'Expected ")"', 10],
    ['2 +', [], 'Unexpected end of expression', 3],
    ['2 3', [], 'Unexpected "3"', 2],
    ['a ? 1', ['a'], 'Expected ":" in a conditional expression', 5],
    ['1 # 2', [], 'Unexpected character "#"', 2],
  ])('%s', (source, variables, message, position) => {
    const error = errorOf(source, variables);
    expect(error.message).toBe(message);
    expect(error.position).toBe(position);
  });

  it('rejects built-in names as variables', () => {
    expect(() => compileExpression('pi', ['pi'])).toThrow('"pi" is a built-in name');
    expect(() => compileExpression('x', ['sin'])).toThrow('"sin" is a built-in name');
  });

  it('caps source length and nesting depth', () => {
    expect(errorOf('1+'.repeat(MAX_SOURCE_LENGTH) + '1').message).toContain('longer than');
    expect(errorOf('('.repeat(MAX_DEPTH + 1) + '1' + ')'.repeat(MAX_DEPTH + 1)).message).toContain('nests deeper');
  });
});

describe('expression sandboxing', () => {
  it('has no property access, strings or assignment', () => {
    expect(errorOf('x.constructor', ['x']).message).toBe('Unexpected character "."');
    expect(errorOf('"alert"').message).toBe('Unexpected character """');
    expect(errorOf("'a'").message).toBe(`Unexpected character "'"`);
    expect(errorOf('x = 1', ['x']).message).toBe('Unexpected character "="');
    expect(errorOf('[1]').message).toBe('Unexpected character "["');
  });

  it('cannot reach inherited properties through function or variable names', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
      expect(errorOf(`${name}(1)`).message).toBe(`Unknown function "${name}"`);
      expect(errorOf(name).message).toBe(`Unknown variable "${name}"`);
    }
  });

  it('never reads inherited scope properties even for declared names', () => {
    const scope = Object.create({ inherited: 5 }) as Record<string, number>;
    expect(Number.isNaN(compileExpression('inherited', ['inherited']).evaluate(scope))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// math.js as a test oracle
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomExpression(random: () => number, depth: number): string {
  if (depth === 0 || random() < 0.25) {
    const leaves = ['x', 't', 'a', String(Math.round(random() * 90) / 10)];
    return leaves[Math.floor(random() * leaves.length)]!;
  }
  const pick = random();
  if (pick < 0.55) {
    const op = ['+', '-', '*', '/', '^'][Math.floor(random() * 5)]!;
    // Our evaluator is real-valued; keep bases non-negative so math.js never goes complex.
    const left = op === '^' ? `abs(${randomExpression(random, depth - 1)})` : randomExpression(random, depth - 1);
    return `(${left} ${op} ${randomExpression(random, depth - 1)})`;
  }
  if (pick < 0.65) return `(-${randomExpression(random, depth - 1)})`;
  const fn = ['sin', 'cos', 'exp', 'abs', 'atan', 'floor', 'ceil'][Math.floor(random() * 7)]!;
  if (random() < 0.2) return `sqrt(abs(${randomExpression(random, depth - 1)}))`;
  return `${fn}(${randomExpression(random, depth - 1)})`;
}

function sameNumber(ours: number, theirs: unknown): boolean {
  if (typeof theirs === 'object' && theirs !== null && 're' in theirs && 'im' in theirs) {
    const complex = theirs as { re: number; im: number };
    return complex.im === 0 ? sameNumber(ours, complex.re) : Number.isNaN(ours);
  }
  if (typeof theirs !== 'number') return false;
  if (Number.isNaN(ours) || Number.isNaN(theirs)) return Number.isNaN(ours) && Number.isNaN(theirs);
  if (!Number.isFinite(ours) || !Number.isFinite(theirs)) return ours === theirs;
  return Math.abs(ours - theirs) <= 1e-9 * Math.max(1, Math.abs(ours), Math.abs(theirs));
}

describe('math.js oracle', () => {
  it('agrees on 2,000 random expressions', () => {
    const random = mulberry32(42);
    let compared = 0;
    for (let i = 0; i < 2000; i++) {
      const source = randomExpression(random, 4);
      const scope = { x: random() * 8 - 4, t: random() * 3, a: random() * 4 - 2 };
      const ours = compileExpression(source, ['x', 't', 'a']).evaluate(scope);
      const theirs = mathjsEvaluate(source, { ...scope });
      expect(sameNumber(ours, theirs), `${source} with ${JSON.stringify(scope)}: ${ours} vs ${String(theirs)}`).toBe(
        true,
      );
      compared++;
    }
    expect(compared).toBe(2000);
  });
});
