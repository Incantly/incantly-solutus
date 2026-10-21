import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'core',
          include: ['packages/core/test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'tiptap',
          include: ['packages/tiptap/test/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
      {
        test: {
          name: 'generation',
          include: ['packages/generation/test/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
