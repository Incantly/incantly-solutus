import { defineConfig } from 'vitest/config';

// Runs the kernel benchmarks: `npx vitest run --config packages/kernel/bench/vitest.config.ts`.
export default defineConfig({
  test: { include: ['packages/kernel/bench/**/*.bench.ts'], environment: 'node', testTimeout: 120_000 },
});
