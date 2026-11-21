import { defineConfig } from 'vitest/config';

// Packages that run without a DOM are tested in Node; browser packages in happy-dom.
const node = ['kernel', 'plot', 'symbolic', 'modes', 'teacher', 'server'];
const dom = ['view', 'audio', 'ui', 'sdk', 'tiptap', 'board'];

const project = (name: string, environment: 'node' | 'happy-dom') => ({
  test: {
    name,
    include: [`packages/${name}/test/**/*.test.ts`],
    benchmark: { include: [`packages/${name}/bench/**/*.bench.ts`] },
    environment,
  },
});

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      ...node.map((name) => project(name, 'node')),
      ...dom.map((name) => project(name, 'happy-dom')),
      {
        test: {
          name: 'studio',
          include: ['apps/studio/test/**/*.test.ts'],
          environment: 'happy-dom',
        },
      },
      {
        test: {
          name: 'tools',
          include: ['tools/**/*.test.js'],
          environment: 'node',
        },
      },
    ],
  },
});
