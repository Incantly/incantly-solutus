/** TEMP PROBE - deleted before committing. Learns run() conventions. */
import { describe, expect, test } from 'vitest';
import {
  SYMBOLIC_COMMANDS,
  condText,
  parseCondition,
  parseExpression,
  run,
  toText,
} from '@incantly/symbolic';

describe('probe', () => {
  test('simplify basic', () => {
    const r = run('Simplify', [{ k: 'expr', e: parseExpression('2*x+3*x'), exact: true }]);
    console.log(JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? `B${v}` : v)).slice(0, 2000));
    expect(r.ok).toBe(true);
  });
  test('solve basic', () => {
    const r = run('Solve', [
      { k: 'cond', c: parseCondition('x^2-5*x+6==0'), exact: true },
      { k: 'sym', name: 'x', domain: 'real' },
    ]);
    console.log('SOLVE:', JSON.stringify(r, (k, v) => (typeof v === 'bigint' ? `B${v}` : v)).slice(0, 3000));
    expect(r.ok).toBe(true);
  });
  test('catalogue', () => {
    for (const c of SYMBOLIC_COMMANDS.slice(0, 8)) console.log(c.name, JSON.stringify(c.forms));
  });
  test('texts', () => {
    console.log(toText(parseExpression('(x-2)*(x-3)')));
    console.log(condText(parseCondition('x==2')));
  });
});
