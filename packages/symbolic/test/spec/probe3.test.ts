/** TEMP PROBE 3 - deleted before committing. */
import { describe, expect, test } from 'vitest';
import { condText, parseCondition, parseExpression, run, toText } from '@incantly/symbolic';

const J = (v: unknown): string => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `B${x}` : x));

describe('probe3', () => {
  test('shapes', () => {
    const ex = (s: string) => ({ k: 'expr' as const, e: parseExpression(s), exact: true });
    const cd = (s: string) => ({ k: 'cond' as const, c: parseCondition(s), exact: true });
    const sy = (name: string) => ({ k: 'sym' as const, name, domain: 'real' as const });
    // Solutions shape
    console.log('SOLUTIONS:', J(run('Solutions', [cd('x^2-5*x+6==0'), sy('x')])));
    // Equivalent shape
    console.log('EQUIV:', J(run('Equivalent', [ex('(x+1)^2'), ex('x^2+2*x+1')])));
    // Degree shape
    console.log('DEGREE:', J(run('Degree', [ex('x^3+2*x'), sy('x')])));
    // bad variable error shape
    console.log('BADVAR:', J(run('Degree', [ex('x^3'), { k: 'num', v: 2 }]))?.slice(0, 1200));
    // unsupported shape
    console.log('UNSUP:', J(run('Solve', [cd('x+exp(x)==3'), sy('x')]))?.slice(0, 1200));
    // Solve with from/to positional
    console.log(
      'FROMTO:',
      J(run('Solve', [cd('sin(x)==1/2'), sy('x'), { k: 'num', v: 0 }, { k: 'num', v: 7 }]))?.slice(0, 1500),
    );
    // Factor over complex
    console.log('CFACTOR:', J(run('Factor', [ex('x^2+1'), { k: 'text', v: 'complex' }]))?.slice(0, 1500));
    // Div numbers
    console.log('DIV:', J(run('Div', [{ k: 'num', v: 7 }, { k: 'num', v: 3 }])));
    // ToFunction
    const tf = run('ToFunction', [ex('x^2+1'), sy('x')]);
    console.log('TOFN:', J(tf)?.slice(0, 800));
    // Steps
    console.log('STEPS:', J(run('Steps', [{ k: 'text', v: 'Solve(x^2-5*x+6==0, x)' }]))?.slice(0, 2000));
    // Matrix det
    const m = {
      k: 'matrix' as const,
      rows: [
        [parseExpression('1'), parseExpression('2')],
        [parseExpression('3'), parseExpression('4')],
      ],
    };
    console.log('DET:', J(run('Determinant', [m]))?.slice(0, 800));
    console.log('TEXT-CHECK:', toText(parseExpression('2*pi')), '|', condText(parseCondition('x==2')));
    expect(true).toBe(true);
  });
});
