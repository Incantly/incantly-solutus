import { defineConfig } from 'vitest/config';

// Runs the kernel benchmarks: `npx vitest run --config packages/kernel/bench/vitest.config.ts`.
// The rows that count collector runs ("no garbage") call `gc()` before they start counting, so each worker process
// starts with `--expose-gc` (vitest 5: `test.execArgv`, with the default `forks` pool).
export default defineConfig({
  test: { include: ['packages/kernel/bench/**/*.bench.ts'], environment: 'node', testTimeout: 120_000, pool: 'forks', execArgv: ['--expose-gc'] },
});
