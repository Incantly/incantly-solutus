/**
 * The symbolic tree and canonical form (docs/features/cas/design.md 5.2, 5.4, 5.5,
 * acceptance test 2). Nodes are immutable and interned; smart constructors keep one shape.
 */
import { describe, expect, test } from 'vitest';
import {
  add,
  andCond,
  asInteger,
  asRational,
  bigGcd,
  compareNodes,
  constN,
  decN,
  divideNodes,
  floatN,
  fn,
  freeSymbols,
  hasInexact,
  intN,
  isExactNumber,
  isOneNode,
  isZeroNode,
  listN,
  mul,
  negateNode,
  nodeCount,
  notCond,
  orCond,
  piecewiseN,
  pow,
  ratN,
  refN,
  rel,
  rootofN,
  symN,
  toFloat,
  upolyDegree,
  upolyDivMod,
  upolyFromInts,
  upolyGcd,
  upolyIsolate,
  upolyRationalRoots,
  upolySquarefree,
  upolyToTree,
} from '@incantly/symbolic';
import { floatToExactRat, nearestFraction, shortestDecimalRational } from '@incantly/symbolic';
import { tree } from './helpers';

const x = (): ReturnType<typeof symN> => symN('x');
const y = (): ReturnType<typeof symN> => symN('y');

// design 5.2: "two equal trees are the same object, so sameValue is a pointer test"
describe('interning', () => {
  test('equal parses are identical objects', () => {
    expect(tree('x^2 + 2*x + 1')).toBe(tree('x^2 + 2*x + 1'));
  });
  test('constructors return identical objects for equal trees', () => {
    expect(add(x(), intN(2))).toBe(add(intN(2), x()));
    expect(mul(x(), intN(3))).toBe(mul(intN(3), x()));
  });
  test('every node carries an id and a hash', () => {
    const n = tree('x + 1');
    expect(typeof n.id).toBe('number');
    expect(typeof n.hash).toBe('number');
  });
});

// design 5.2: "Subtraction and division do not exist as nodes"
describe('one shape for sub and div', () => {
  test('a - b is an add node', () => {
    expect(tree('a - b').k).toBe('add');
  });
  test('a / b is a mul node', () => {
    expect(tree('a / b').k).toBe('mul');
  });
  test('division is mul(a, pow(b, -1))', () => {
    const t = tree('a / b');
    if (t.k !== 'mul') throw new Error('expected mul');
    expect(t.factors.length).toBe(2);
    const p = t.factors[1];
    if (p?.k !== 'pow') throw new Error('expected pow factor');
    expect(asInteger(p.exp)).toBe(-1n);
  });
});

// design 5.2: sqrt and exp sugar
describe('sqrt and exp forms', () => {
  test('sqrt(x) is pow(x, 1/2)', () => {
    const t = tree('sqrt(x)');
    if (t.k !== 'pow') throw new Error(`expected pow, got ${t.k}`);
    expect(t.base).toBe(x());
    expect(asRational(t.exp)).toEqual({ n: 1n, d: 2n });
  });
  test('e^x is pow(const e, x)', () => {
    const t = tree('e^x');
    if (t.k !== 'pow') throw new Error(`expected pow, got ${t.k}`);
    expect(t.base).toEqual(expect.objectContaining({ k: 'const', name: 'e' }));
    expect(t.exp).toBe(x());
  });
  test('exp(x) parses to the same tree as e^x', () => {
    expect(tree('exp(x)')).toBe(tree('e^x'));
  });
});

// design 5.5: canonical add
describe('canonical add', () => {
  test('flattens nested sums', () => {
    const t = tree('x + (y + 2)');
    if (t.k !== 'add') throw new Error('expected add');
    expect(t.terms.length).toBe(3);
  });
  test('collects like terms: 2x + 3x is 5x', () => {
    const t = tree('2*x + 3*x');
    if (t.k !== 'mul') throw new Error(`expected mul, got ${t.k}`);
    expect(asInteger(t.factors[0] ?? tree('0'))).toBe(5n);
  });
  test('drops zeros', () => {
    expect(tree('x + 0')).toBe(x());
  });
  test('numbers sort first', () => {
    const t = tree('x + 2');
    if (t.k !== 'add') throw new Error('expected add');
    expect(t.terms[0]?.k).toBe('int');
  });
  test('one term collapses, no terms give 0', () => {
    expect(add(x())).toBe(x());
    expect(isZeroNode(add())).toBe(true);
  });
  test('independent of argument order (acceptance 2)', () => {
    expect(add(x(), y(), intN(2))).toBe(add(intN(2), y(), x()));
  });
  test('idempotent (acceptance 2)', () => {
    const t = tree('2*x + 3 + y');
    if (t.k !== 'add') throw new Error('expected add');
    expect(add(...t.terms)).toBe(t);
  });
});

// design 5.5: canonical mul
describe('canonical mul', () => {
  test('flattens nested products', () => {
    const t = tree('2*(3*x)');
    if (t.k !== 'mul') throw new Error('expected mul');
    expect(asInteger(t.factors[0] ?? tree('0'))).toBe(6n);
  });
  test('combines equal bases: x * x^2 is x^3', () => {
    const t = tree('x * x^2');
    if (t.k !== 'pow') throw new Error(`expected pow, got ${t.k}`);
    expect(asInteger(t.exp)).toBe(3n);
  });
  test('0 annihilates', () => {
    expect(isZeroNode(tree('0 * (x + 1)'))).toBe(true);
  });
  test('0 with an inf factor stays unfolded (undefined, not 0)', () => {
    const t = mul(intN(0), constN('inf'));
    expect(t.k).toBe('mul');
    expect(isZeroNode(t)).toBe(false);
  });
  test('independent of argument order (acceptance 2)', () => {
    expect(mul(x(), y(), intN(2))).toBe(mul(y(), intN(2), x()));
  });
});

// design 5.5: canonical pow
describe('canonical pow', () => {
  test('x^0 is 1', () => {
    expect(isOneNode(tree('x^0'))).toBe(true);
  });
  test('0^0 stays unfolded (indeterminate)', () => {
    expect(tree('0^0').k).toBe('pow');
  });
  test('x^1 is x', () => {
    expect(tree('x^1')).toBe(x());
  });
  test('1^x is 1', () => {
    expect(isOneNode(tree('1^x'))).toBe(true);
  });
  test('number to integer power folds exactly', () => {
    expect(asInteger(tree('2^10'))).toBe(1024n);
    expect(asInteger(tree('(-3)^3'))).toBe(-27n);
  });
  test('(a*b)^n splits for integer n', () => {
    expect(tree('(a*b)^2')).toBe(tree('a^2*b^2'));
  });
  test('(x^a)^n folds for integer n', () => {
    expect(tree('(x^2)^3')).toBe(tree('x^6'));
  });
});

// design 5.5: fn folding and parity
describe('function folding', () => {
  test.each([
    ['sin(0)', '0'],
    ['cos(0)', '1'],
    ['cos(pi/3)', '1/2'],
    ['sin(pi/6)', '1/2'],
    ['ln(1)', '0'],
    ['exp(0)', '1'],
  ])('%s folds to %s', (input, folded) => {
    expect(tree(input)).toBe(tree(folded));
  });
  test('sin(-x) is -sin(x) (parity)', () => {
    expect(tree('sin(-x)')).toBe(tree('-sin(x)'));
  });
  test('cos(-x) is cos(x) (parity)', () => {
    expect(tree('cos(-x)')).toBe(tree('cos(x)'));
  });
  test('unknown values stay folded as fn nodes', () => {
    expect(tree('sin(2)').k).toBe('fn');
  });
});

// design 5.5: total order
describe('node ordering', () => {
  test('compareNodes is antisymmetric', () => {
    const a = tree('x^2 + 1');
    const b = tree('sin(x)');
    expect(compareNodes(a, b)).toBe(-compareNodes(b, a));
    expect(compareNodes(a, a)).toBe(0);
  });
  test('sorting is stable whatever order the nodes were built', () => {
    const items = ['x^2', 'sin(x)', '1/2', 'x', 'x + 1', '2^x'].map(tree);
    const once = [...items].sort(compareNodes);
    const twice = [...items].reverse().sort(compareNodes);
    expect(twice).toEqual(once);
  });
});

// design 5.2: conditions
describe('conditions', () => {
  test('rel/and/or/not constructors build the documented shapes', () => {
    expect(rel('==', x(), intN(1))).toEqual({ c: 'rel', op: '==', l: x(), r: intN(1) });
    const c = andCond(rel('>', x(), intN(0)), rel('<', x(), intN(1)));
    expect(c.c).toBe('and');
    expect(orCond(c, c).c).toBe('or');
    expect(notCond(c).c).toBe('not');
  });
});

// design 5.2: remaining node kinds
describe('other node kinds', () => {
  test('list, piecewise, ref and dec nodes keep their shape', () => {
    expect(listN([x(), intN(1)]).k).toBe('list');
    const p = piecewiseN([{ when: rel('>', x(), intN(0)), then: x() }], intN(0));
    expect(p.k).toBe('piecewise');
    expect(refN(7)).toEqual(expect.objectContaining({ k: 'ref', obj: 7 }));
    expect(decN(1414n, -3, 4).k).toBe('dec');
    expect(floatN(0.5).k).toBe('float');
  });
  test('rootof carries poly, index and hint', () => {
    const r = rootofN(upolyFromInts([-1n, 0n, 0n, 0n, 0n, 1n]), 1, 1.16);
    if (r.k !== 'rootof') throw new Error('expected rootof');
    expect(r.index).toBe(1);
    expect(r.hint).toBeCloseTo(1.16, 5);
  });
});

// design 5.5 helpers + 5.2 exactness
describe('node queries', () => {
  test('asRational / asInteger read exact numbers', () => {
    expect(asRational(tree('3/2'))).toEqual({ n: 3n, d: 2n });
    expect(asInteger(tree('5'))).toBe(5n);
    expect(asInteger(tree('3/2'))).toBe(null);
    expect(asRational(tree('x + 1'))).toBe(null);
  });
  test('freeSymbols collects names', () => {
    expect(freeSymbols(tree('x^2 + a'))).toEqual(new Set(['x', 'a']));
  });
  test('nodeCount counts distinct nodes', () => {
    expect(nodeCount(tree('x + x'))).toBeLessThanOrEqual(nodeCount(tree('x + y')));
    expect(nodeCount(intN(3))).toBe(1);
  });
  test('hasInexact is true only with float or decimal leaves', () => {
    expect(hasInexact(tree('1/3 + sqrt(2) + pi'))).toBe(false);
    expect(hasInexact(add(floatN(0.1), x()))).toBe(true);
    expect(hasInexact(add(decN(1n, -1, 1), x()))).toBe(true);
  });
  test('exact-number predicates', () => {
    expect(isExactNumber(intN(3))).toBe(true);
    expect(isExactNumber(ratN(1n, 2n))).toBe(true);
    expect(isExactNumber(floatN(0.5))).toBe(false);
    expect(isZeroNode(intN(0))).toBe(true);
    expect(isOneNode(ratN(2n, 2n))).toBe(true);
  });
  test('negateNode, toFloat, divideNodes, bigGcd', () => {
    expect(negateNode(intN(3))).toBe(intN(-3));
    expect(toFloat(tree('1/4'))).toBe(0.25);
    expect(divideNodes(intN(1), intN(4))).toBe(tree('1/4'));
    expect(bigGcd(12n, 18n)).toBe(6n);
  });
});

// design 5.4: the number tower and entry rules
describe('number entry (design 5.4)', () => {
  test('0.3 enters as the exact rational 3/10', () => {
    expect(shortestDecimalRational(0.3)).toEqual({ n: 3n, d: 10n });
  });
  test('0.30000000000000004 is not exactly representable (enters as float)', () => {
    expect(shortestDecimalRational(0.30000000000000004)).toBe(null);
  });
  test('1/3 as a double is not exactly representable', () => {
    expect(shortestDecimalRational(1 / 3)).toBe(null);
  });
  test('every double still has an exact binary value', () => {
    const r = floatToExactRat(0.1);
    expect(r).not.toBe(null);
    expect(floatToExactRat(Number.NaN)).toBe(null);
    expect(floatToExactRat(Number.POSITIVE_INFINITY)).toBe(null);
  });
  test('nearestFraction finds the close simple fraction (Rationalize, tolerance 1e-12)', () => {
    expect(nearestFraction(0.333333333333, 1e-12)).toEqual({ n: 1n, d: 3n });
    const pi = nearestFraction(Math.PI, 1e-12);
    expect(pi).not.toBe(null);
    if (pi !== null) expect(Math.abs(Number(pi.n) / Number(pi.d) - Math.PI)).toBeLessThan(1e-12);
    expect(nearestFraction(Math.PI, 1e-12)).not.toEqual({ n: 3n, d: 1n });
  });
});

// design 5.6: univariate polynomials (dense, c[i] is x^i)
describe('univariate polynomials', () => {
  test('treeToUPoly is dense with c[i] = x^i', () => {
    const p = upolyFromInts([1n, 2n, 1n]);
    expect(upolyDegree(p)).toBe(2);
    expect(upolyToTree(p, x())).toBe(tree('x^2 + 2*x + 1'));
  });
  test('division with remainder is exact', () => {
    const { q, r } = upolyDivMod(upolyFromInts([-1n, 0n, 1n]), upolyFromInts([-1n, 1n]));
    expect(upolyToTree(q, x())).toBe(tree('x + 1'));
    expect(upolyToTree(r, x())).toBe(tree('0'));
  });
  test('gcd finds the common factor', () => {
    const g = upolyGcd(upolyFromInts([-1n, 0n, 1n]), upolyFromInts([-1n, 1n]));
    expect(upolyToTree(g, x())).toBe(tree('x - 1'));
  });
  test('square-free split separates repeats', () => {
    const sq = upolySquarefree(upolyFromInts([1n, -2n, 1n]));
    expect(sq.length).toBeGreaterThanOrEqual(1);
    expect(sq.reduce((n, p) => n + p.m, 0)).toBe(2);
  });
  test('rational roots are peeled exactly', () => {
    const roots = upolyRationalRoots(upolyFromInts([6n, -5n, 1n]));
    const texts = roots.map((r) => `${r.n}/${r.d}`);
    expect(texts).toContain('2/1');
    expect(texts).toContain('3/1');
  });
  test('real roots are isolated (Sturm)', () => {
    const ivs = upolyIsolate(upolyFromInts([-2n, 0n, 1n]));
    expect(ivs.length).toBe(2);
    const lo0 = ivs[0]?.lo;
    const hi0 = ivs[0]?.hi;
    const lo1 = ivs[1]?.lo;
    expect(lo0 === undefined || hi0 === undefined || lo1 === undefined).toBe(false);
    if (lo0 !== undefined && hi0 !== undefined) expect(Number(hi0.n) / Number(hi0.d)).toBeLessThan(0);
    if (lo1 !== undefined) expect(Number(lo1.n) / Number(lo1.d)).toBeGreaterThan(0);
  });
  test('fn constructor and function-arg parsing', () => {
    expect(fn('sin', x())).toBe(tree('sin(x)'));
    expect(tree('max(x, y)').k).toBe('fn');
  });
});
