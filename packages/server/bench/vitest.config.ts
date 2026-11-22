import { defineConfig } from 'vitest/config';

// Runs the server benchmarks: `npx vitest run --config packages/server/bench/vitest.config.ts`.
export default defineConfig({
  test: { include: ['packages/server/bench/**/*.bench.ts'], environment: 'node', testTimeout: 120_000, pool: 'forks' },
});
