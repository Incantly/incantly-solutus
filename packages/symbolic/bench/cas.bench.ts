/** CAS speed targets (cas/design.md 5.13): school-level inputs on a warm engine. */
import { bench, describe } from 'vitest';
import {
  assumptions, completeSquareNode, csolveEquation, expandNode, factorNode, integrateNode,
  limitNode, nsolveEquation, parseCondition, parseExpression, ruleCtx, simplifyNode, solveEquation,
  solveSystem, symN, toDifference, upolyToTree, upolyFromInts,
} from '../src/index.js';

const tick = { tick(): void {} };
const ctx = () => ruleCtx(assumptions(), tick);
const x = symN('x');

describe('cas targets', () => {
  bench('Simplify 20-node expression', () => {
    const e = parseExpression('(x^2 + 2*x + 1)*(x^2 - 2*x + 1) + sin(x)^2 + cos(x)^2');
    simplifyNode(e, ctx());
  });

  bench('Expand((x + 1)^20)', () => {
    const e = parseExpression('(x + 1)^20');
    expandNode(e, tick);
  });

  bench('Factor degree-6 polynomial', () => {
    const e = parseExpression('x^6 - 2*x^5 - 3*x^4 + 8*x^3 + 3*x^2 - 8*x + 4');
    factorNode(e, ctx());
  });

  bench('Solve quadratic with symbolic coefficients', () => {
    const c = parseCondition('a*x^2 + b*x + c == 0');
    const f = toDifference(c);
    if (f === null) throw new Error('bench setup');
    solveEquation(f, x, assumptions(), tick, {});
  });

  bench('Solve 3x3 linear system', () => {
    const eqs = [
      parseExpression('2*x + y - z - 1'),
      parseExpression('x - y + 2*z - 4'),
      parseExpression('3*x + 2*y + z - 7'),
    ];
    solveSystem(eqs, [symN('x'), symN('y'), symN('z')], assumptions(), tick, {});
  });

  bench('Integral of x^2*exp(x)', () => {
    integrateNode(parseExpression('x^2*exp(x)'), x, ctx());
  });

  bench('Integral of a rational function', () => {
    integrateNode(parseExpression('(2*x + 3)/(x^2 + x - 2)'), x, ctx());
  });

  bench('Limit sin(x)/x at 0', () => {
    limitNode(parseExpression('sin(x)/x'), x, parseExpression('0'), 'both', ctx());
  });

  bench('NSolve x + exp(x) == 3', () => {
    nsolveEquation(parseExpression('x + exp(x) - 3'), x, assumptions(), tick, {});
  });

  bench('CSolve x^2 + 1 == 0', () => {
    csolveEquation(parseExpression('x^2 + 1'), x, assumptions(), tick);
  });

  bench('CompleteSquare', () => {
    completeSquareNode(parseExpression('2*x^2 + 8*x + 3'), x, ctx());
  });

  bench('upoly round trip', () => {
    const p = upolyFromInts([1n, 2n, 1n]);
    upolyToTree(p, x);
  });
});
