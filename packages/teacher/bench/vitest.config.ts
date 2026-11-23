import { defineConfig } from 'vitest/config';

// Runs the teacher benchmarks: `npx vitest run --config packages/teacher/bench/vitest.config.ts`.
export default defineConfig({
  test: { include: ['packages/teacher/bench/**/*.bench.ts'], environment: 'node', testTimeout: 120_000, pool: 'forks' },
});
