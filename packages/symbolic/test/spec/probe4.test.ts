/** TEMP PROBE 4 - deleted before committing. */
import { describe, expect, test } from 'vitest';
import { condText, parseCondition, parseExpression, run, toText } from '@incantly/symbolic';

const J = (v: unknown): string => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `B${x}` : x));
const ex = (s: string) => ({ k: 'expr' as const, e: parseExpression(s), exact: true });
const cd = (s: string) => ({ k: 'cond' as const, c: parseCondition(s), exact: true });
const sy = (name: string) => ({ k: 'sym' as const, name, domain: 'real' as const });

describe('probe4', () => {
  test('more shapes', () => {
    console.log('SOLS:', J(run('Solutions', [cd('x^2-5*x+6==0'), sy('x')]))?.slice(0, 600));
    console.log('NUMPOS:', J(run('Numeric', [ex('sqrt(2)'), { k: 'num', v: 5 }]))?.slice(0, 600));
    console.log('NUMP:', J(run('Numeric', [ex('sqrt(2)')]))?.slice(0, 600));
    console.log('EXPROP:', J(run('Expr', [{ k: 'text', v: 'x^2+1' }]))?.slice(0, 600));
    console.log('SYMOP:', J(run('Symbol', []))?.slice(0, 600));
    console.log('ASSUME:', J(run('Assume', [cd('a>0'), ex('sqrt(a^2)')]))?.slice(0, 600));
    console.log('NSOLVE:', J(run('NSolve', [cd('x+exp(x)==3'), sy('x')]))?.slice(0, 900));
    console.log('GCDL:', J(run('GCD', [{ k: 'list', items: [{ k: 'num', v: 12 }, { k: 'num', v: 18 }, { k: 'num', v: 24 }] }]))?.slice(0, 400));
    console.log('TOBASE:', J(run('ToBase', [{ k: 'num', v: 255 }, { k: 'num', v: 16 }]))?.slice(0, 400));
    console.log('ISPRIME:', J(run('IsPrime', [{ k: 'num', v: 7 }]))?.slice(0, 400));
    console.log('COEFF:', J(run('Coefficients', [ex('3*x^2+2*x+1'), sy('x')]))?.slice(0, 900));
    console.log('DIVISION:', J(run('Division', [{ k: 'num', v: 7 }, { k: 'num', v: 3 }]))?.slice(0, 400));
    console.log('DOMAIN:', J(run('Solve', [cd('x^2+1==0'), sy('x'), { k: 'named', name: 'domain', v: { k: 'text', v: 'complex' } }]))?.slice(0, 900));
    console.log('NAMEDFROM:', J(run('Solve', [cd('sin(x)==1/2'), sy('x'), { k: 'named', name: 'from', v: { k: 'num', v: 0 } }, { k: 'named', name: 'to', v: { k: 'num', v: 7 } }]))?.slice(0, 500));
    console.log('MIXED:', J(run('MixedNumber', [ex('11/4')]))?.slice(0, 700));
    console.log('HOLD:', J(run('Hold', [ex('2+3*x')]))?.slice(0, 700));
    console.log('TONUM:', J(run('ToNumber', [ex('1/3')]))?.slice(0, 400));
    expect(true).toBe(true);
  });
});
