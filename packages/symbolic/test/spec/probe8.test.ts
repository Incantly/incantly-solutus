/** TEMP PROBE 8 - deleted before committing. */
import { describe, expect, test } from 'vitest';
import { condText, parseCondition, parseExpression, run, toText } from '@incantly/symbolic';

describe('probe8', () => {
  test('rootof numeric and big system', () => {
    const cc = (s: string) => ({ k: 'cond' as const, c: parseCondition(s), exact: true });
    const ex = (s: string) => ({ k: 'expr' as const, e: parseExpression(s), exact: true });
    const sy = (name: string) => ({ k: 'sym' as const, name, domain: 'real' as const });
    const li = (items: readonly { k: 'cond' }[] | readonly { k: 'sym' }[]): never => items as never;
    void li;
    // Numeric of rootof text
    const n = run('Numeric', [ex('rootof(-1 - x + x^5, 1)'), { k: 'num', v: 10 }]);
    console.log('NUMROOT:', JSON.stringify(n, (k, v) => (typeof v === 'bigint' ? 0 : v))?.slice(0, 500));
    // Big system raw
    const r = run('Solve', [
      { k: 'list', items: [cc('x^5+y==3'), cc('x-y==1')] },
      { k: 'list', items: [sy('x'), sy('y')] },
    ]);
    if (!r.ok) console.log('SYS -> ERROR');
    else if (!r.value.cell.defined) console.log('SYS -> UNDEF', r.value.cell.reason);
    else {
      const v = r.value.cell.value;
      if (v.k === 'list') {
        for (const s of v.items) {
          if (s.k === 'list') console.log('SYS sol:', s.items.map((c) => (c.k === 'cond' ? condText(c.c) : c.k)).join(' ; '));
          else console.log('SYS item:', s.k);
        }
      } else console.log('SYS ->', v.k);
    }
    expect(true).toBe(true);
  });
});
