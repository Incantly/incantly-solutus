/**
 * The board's tools write through a gesture (docs/state-machines.md B25, board review BR-26): `eslint.config.js` makes
 * a `.change(` call in `packages/board/src/core/tools/**` an error. The sample files are linted with the repo's own
 * config through the ESLint Node API.
 */
import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const eslint = new ESLint({ cwd: root });

const MESSAGE = 'tools write through a gesture, so a cancel puts back everything';

/** The messages of the rule `no-restricted-syntax` for a sample file at `filePath`. */
async function refusals(filePath, code) {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax');
}

describe('a tool of the board writes through a gesture', () => {
  it('refuses a direct store.change call in a tool file', async () => {
    const found = await refusals('packages/board/src/core/tools/sample.ts', "export function go(core: { store: { change(o: string, f: () => void): void } }): void { core.store.change('user', () => undefined); }\n");
    expect(found).toHaveLength(1);
    expect(found[0]?.message).toBe(MESSAGE);
    expect(found[0]?.severity).toBe(2);
  });

  it('refuses it in a nested folder of the tools too', async () => {
    const found = await refusals('packages/board/src/core/tools/more/sample.ts', 'export const go = (s: { change(): void }): void => s.change();\n');
    expect(found).toHaveLength(1);
  });

  it('accepts a write through a gesture', async () => {
    const found = await refusals('packages/board/src/core/tools/sample.ts', "export function go(g: { write(f: () => void): void }): void { g.write(() => undefined); }\n");
    expect(found).toEqual([]);
  });

  it('does not touch the commands of core/edit.ts, which write through the gesture or their own transaction', async () => {
    const found = await refusals('packages/board/src/core/edit.ts', "export const go = (s: { change(): void }): void => s.change();\n");
    expect(found).toEqual([]);
  });

  it('keeps the other rules of the tool files: console is still an error there', async () => {
    const [result] = await eslint.lintText('export const go = (): void => { console.log(1); };\n', { filePath: 'packages/board/src/core/tools/sample.ts' });
    expect((result?.messages ?? []).some((m) => m.ruleId === 'no-console')).toBe(true);
  });
});
