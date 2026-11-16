import { defineConfig } from 'vitest/config';

// Runs the SDK benchmarks: `npx vitest run --config packages/sdk/bench/vitest.config.ts`.
export default defineConfig({
  test: { include: ['packages/sdk/bench/**/*.bench.ts'], environment: 'node', testTimeout: 120_000 },
});
