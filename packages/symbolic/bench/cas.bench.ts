/**
 * CAS speed targets (cas/design.md 5.13): school-level inputs on a warm engine.
 *
 * Plain timing script, no bench runner: each case warms up, then runs a fixed
 * number of timed iterations and prints the mean milliseconds per call next to
 * the 5.13 target. Run with `npx tsx packages/symbolic/bench/cas.bench.ts`.
 */
import {
  assumptions, completeSquareNode, csolveEquation, expandNode, factorNode, integrateNode,
  limitNode, nsolveEquation, parseCondition, parseExpression, ruleCtx, simplifyNode, solveEquation,
  solveSystem, symN, toDifference, upolyToTree, upolyFromInts,
} from '../src/index.js';

const tick = { tick(): void {} };
const ctx = (): ReturnType<typeof ruleCtx> => ruleCtx(assumptions(), tick);
const x = symN('x');

interface BenchCase {
  readonly name: string;
  readonly targetMs: number;
  readonly iters: number;
  readonly fn: () => void;
}

const WARMUP = 5;

function timeCase(c: BenchCase): { meanMs: number } {
  for (let i = 0; i < WARMUP; i++) c.fn();
  const t0 = performance.now();
  for (let i = 0; i < c.iters; i++) c.fn();
  const total = performance.now() - t0;
  return { meanMs: total / c.iters };
}

function trigSetup(): { f: ReturnType<typeof parseExpression> } {
  const c = parseCondition('a*x^2 + b*x + c == 0');
  const f = toDifference(c);
  if (f === null) throw new Error('bench setup');
  return { f };
}

const CASES: readonly BenchCase[] = [
  {
    name: 'Simplify 20-node expression',
    targetMs: 5,
    iters: 50,
    fn: (): void => {
      const e = parseExpression('(x^2 + 2*x + 1)*(x^2 - 2*x + 1) + sin(x)^2 + cos(x)^2');
      simplifyNode(e, ctx());
    },
  },
  {
    name: 'Expand((x + 1)^20)',
    targetMs: 2,
    iters: 100,
    fn: (): void => {
      const e = parseExpression('(x + 1)^20');
      expandNode(e, tick);
    },
  },
  {
    name: 'Factor degree-6 polynomial',
    targetMs: 5,
    iters: 50,
    fn: (): void => {
      const e = parseExpression('x^6 - 2*x^5 - 3*x^4 + 8*x^3 + 3*x^2 - 8*x + 4');
      factorNode(e, ctx());
    },
  },
  {
    name: 'Solve quadratic with symbolic coefficients',
    targetMs: 3,
    iters: 50,
    fn: (): void => {
      const { f } = trigSetup();
      solveEquation(f, x, assumptions(), tick, {});
    },
  },
  {
    name: 'Solve 3x3 linear system',
    targetMs: 2,
    iters: 50,
    fn: (): void => {
      const eqs = [
        parseExpression('2*x + y - z - 1'),
        parseExpression('x - y + 2*z - 4'),
        parseExpression('3*x + 2*y + z - 7'),
      ];
      solveSystem(eqs, [symN('x'), symN('y'), symN('z')], assumptions(), tick, {});
    },
  },
  {
    name: 'Integral of x^2*exp(x)',
    targetMs: 40,
    iters: 10,
    fn: (): void => {
      integrateNode(parseExpression('x^2*exp(x)'), x, ctx());
    },
  },
  {
    name: 'Integral of a rational function',
    targetMs: 40,
    iters: 10,
    fn: (): void => {
      integrateNode(parseExpression('(2*x + 3)/(x^2 + x - 2)'), x, ctx());
    },
  },
  {
    name: 'Limit sin(x)/x at 0',
    targetMs: 30,
    iters: 20,
    fn: (): void => {
      limitNode(parseExpression('sin(x)/x'), x, parseExpression('0'), 'both', ctx());
    },
  },
  {
    name: 'NSolve x + exp(x) == 3',
    targetMs: 30,
    iters: 10,
    fn: (): void => {
      nsolveEquation(parseExpression('x + exp(x) - 3'), x, assumptions(), tick, {});
    },
  },
  {
    name: 'CSolve x^2 + 1 == 0',
    targetMs: 5,
    iters: 50,
    fn: (): void => {
      csolveEquation(parseExpression('x^2 + 1'), x, assumptions(), tick);
    },
  },
  {
    name: 'CompleteSquare',
    targetMs: 5,
    iters: 50,
    fn: (): void => {
      completeSquareNode(parseExpression('2*x^2 + 8*x + 3'), x, ctx());
    },
  },
  {
    name: 'upoly round trip',
    targetMs: 2,
    iters: 200,
    fn: (): void => {
      const p = upolyFromInts([1n, 2n, 1n]);
      upolyToTree(p, x);
    },
  },
];

let failed = 0;
for (const c of CASES) {
  const { meanMs } = timeCase(c);
  const ok = meanMs <= c.targetMs;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}: ${meanMs.toFixed(3)} ms/call over ${c.iters} iters (target ${c.targetMs} ms)`);
}
if (failed > 0) console.log(`${failed} case(s) over target (machine-dependent; see builder notes)`);
