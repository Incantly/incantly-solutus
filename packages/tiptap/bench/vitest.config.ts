import { defineConfig } from 'vitest/config';

// Runs the Tiptap benchmarks: `npx vitest run --config packages/tiptap/bench/vitest.config.ts`.
export default defineConfig({
  test: { include: ['packages/tiptap/bench/**/*.bench.ts'], environment: 'happy-dom', testTimeout: 120_000 },
});
