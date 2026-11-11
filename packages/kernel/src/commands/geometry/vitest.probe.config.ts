import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/kernel/src/commands/geometry/probe-tmp.test.ts'],
    environment: 'node',
  },
});
