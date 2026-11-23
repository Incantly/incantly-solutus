import { defineConfig } from 'vitest/config';

// Runs the studio benchmarks: `npx vitest run --config apps/studio/bench/vitest.config.ts`.
export default defineConfig({
  test: { include: ['apps/studio/bench/**/*.bench.ts'], environment: 'node', testTimeout: 120_000 },
});
