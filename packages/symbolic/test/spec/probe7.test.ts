/** TEMP PROBE 7 - deleted before committing. */
import { describe, expect, test } from 'vitest';
import { condText, parseCondition, parseExpression, run, toText } from '@incantly/symbolic';

describe('probe7', () => {
  test('solve outputs', () => {
    const cc = (s: string) => ({ k: 'cond' as const, c: parseCondition(s), exact: true });
    const sy = (name: string) => ({ k: 'sym' as const, name, domain: 'real' as const });
    const show = (op: 'Solve' | 'Solutions' | 'NSolve' | 'NSolutions' | 'CSolve' | 'CSolutions', c: string): void => {
      const r = run(op, [cc(c), sy('x')]);
      if (!r.ok) {
        console.log(`${op}(${c}) -> ERROR ${String(r.kind)}`);
        return;
      }
      const cell = r.value.cell;
      if (!cell.defined) {
        console.log(`${op}(${c}) -> UNDEF ${cell.reason}: ${cell.detail?.text ?? ''}`);
        return;
      }
      const v = cell.value;
      if (v.k !== 'list') {
        console.log(`${op}(${c}) -> ${v.k}`);
        return;
      }
      const texts = v.items.map((i) => (i.k === 'cond' ? condText(i.c) : i.k === 'expr' ? toText(i.e) : i.k));
      console.log(`${op}(${c}) -> [${texts.join(' ; ')}]`);
    };
    show('NSolve', 'x^5-x-1==0');
    show('NSolutions', 'x^2-2==0');
    show('CSolutions', 'exp(x)==2');
    show('Solve', 'x/(x-1)==2');
    show('Solve', '1/x>0');
    show('Solutions', 'ln(x)==1');
    show('Solve', 'abs(x)<2');
    show('Solutions', 'a*x^2+b*x+c==0');
    expect(true).toBe(true);
  });
});
