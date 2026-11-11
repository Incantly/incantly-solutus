/** TEMP PROBE 5 - deleted before committing. */
import { describe, expect, test } from 'vitest';
import { parseCondition, parseExpression, toText } from '@incantly/symbolic';

describe('probe5', () => {
  test('printer outputs', () => {
    for (const s of ['x^2 - 5*x + 6', 'x - (1/2 * sqrt(3))', '6 - 5 * x + x^2', 'x - 2', '-x^2 + 1']) {
      const n = parseExpression(s);
      const t = toText(n);
      const m = parseExpression(t);
      console.log(`IN=${s} OUT=${t} SAME=${m === n}`);
    }
    for (const s of ['x == 1 and y == 2', '(x == 1) and (y == 2)', 'not x == 1', 'x > 0 or x < -1']) {
      try {
        console.log(`COND ${s} -> ok`);
        parseCondition(s);
      } catch (e) {
        console.log(`COND ${s} -> THROWS ${(e as Error).message}`);
      }
    }
    expect(true).toBe(true);
  });
});
