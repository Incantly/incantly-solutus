import { defineConfig } from 'vitest/config';

// Runs the board benchmarks: `npx vitest run --config packages/board/bench/vitest.config.ts`.
// The rows that measure memory and count collector runs call `gc()` first, so each worker process starts with
// `--expose-gc` (vitest 5: `test.execArgv`, with the `forks` pool), as in the kernel benches.
export default defineConfig({
  test: { include: ['packages/board/bench/**/*.bench.ts'], environment: 'node', testTimeout: 120_000, pool: 'forks', execArgv: ['--expose-gc'] },
});
