/* Throwaway vitest config for the functions probe. Deleted before committing. */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/kernel/src/commands/functions/probe.test.ts'],
    environment: 'node',
  },
});
