import { defineConfig } from 'vitest/config';

// Runs the board benchmarks: `npx vitest run --config packages/board/bench/vitest.config.ts`.
export default defineConfig({
  test: { include: ['packages/board/bench/**/*.bench.ts'], environment: 'node', testTimeout: 120_000 },
});
