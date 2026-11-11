/** TEMP PROBE 6 - deleted before committing. */
import { describe, expect, test } from 'vitest';
import { condText, parseExpression, run, toText } from '@incantly/symbolic';

describe('probe6', () => {
  test('factor and simplify outputs', () => {
    const ex = (s: string) => ({ k: 'expr' as const, e: parseExpression(s), exact: true });
    const show = (op: 'Factor' | 'Simplify', s: string): void => {
      const r = run(op, [ex(s)]);
      if (!r.ok) {
        console.log(`${op}(${s}) -> ERROR ${r.kind}`);
        return;
      }
      const c = r.value.cell;
      if (!c.defined) {
        console.log(`${op}(${s}) -> UNDEF ${c.reason}`);
        return;
      }
      const v = c.value;
      if (v.k !== 'expr') {
        console.log(`${op}(${s}) -> ${v.k}`);
        return;
      }
      console.log(
        `${op}(${s}) -> ${toText(v.e)} excl=${(v.excluded ?? []).map((x) => condText(x)).join(';')} notices=${JSON.stringify(((r.value as unknown as { notices?: { kind: string }[] }).notices ?? []).map((n) => n.kind))}`,
      );
    };
    show('Factor', 'x^2-5*x+6');
    show('Factor', 'x^2-1');
    show('Factor', '2*x+2');
    show('Factor', 'x^2+2*x+1');
    show('Simplify', '(x^2-1)/(x-1)');
    show('Simplify', 'x/x');
    show('Simplify', '(x^2-3*x+2)/(x-1)');
    expect(true).toBe(true);
  });
});
