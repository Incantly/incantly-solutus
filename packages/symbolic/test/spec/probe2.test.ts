/** TEMP PROBE 2 - deleted before committing. */
import { describe, expect, test } from 'vitest';
import { SYMBOLIC_COMMANDS, run } from '@incantly/symbolic';

describe('probe2', () => {
  test('full catalogue', () => {
    for (const c of SYMBOLIC_COMMANDS) console.log(`${c.name} heavy=${c.heavy} ${JSON.stringify(c.forms)}`);
  });
  test('named args guess', () => {
    const r = run('Numeric', [
      { k: 'expr', e: { k: 'const', name: 'pi', id: 0, hash: 0 } as never, exact: true },
      { k: 'named', name: 'digits', v: { k: 'int', v: 5n } },
    ]);
    console.log('NUMERIC:', JSON.stringify(r).slice(0, 800));
    expect(r.ok).toBe(true);
  });
});
