import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Modules that must run unchanged in a Worker, in Node and in the browser.
// They may not touch the DOM, timers or the animation clock: the renderer owns those.
const domFreeModules = [
  'packages/core/src/api/**/*.ts',
  'packages/core/src/expr/**/*.ts',
  'packages/core/src/runtime/**/*.ts',
  'packages/core/src/scene/**/*.ts',
  'packages/core/src/graph2d/**/*.ts',
  'packages/core/src/helpers/**/*.ts',
  'packages/core/src/kits/**/*.ts',
  'packages/core/src/probe/**/*.ts',
  'packages/core/src/protocol/**/*.ts',
  'packages/core/src/validation/**/*.ts',
];

export default defineConfig([
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/generated/**',
      'test-results/**',
      'playwright-report/**',
      // Scene fragments are checked by the SDK's own validator, not by ESLint.
      'packages/*/scenes/**',
      'packages/*/test/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Release hygiene (RM-5): the engine, bridge and host integration never write to the console.
      'no-console': 'error',
      // Object-literal handles keep their own `this` for chaining, so the owner is aliased by name.
      '@typescript-eslint/no-this-alias': ['error', { allowedNames: ['runtime', 'graph', 'renderer', 'host'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: domFreeModules,
    rules: {
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'localStorage',
        'sessionStorage',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'setTimeout',
        'setInterval',
        'fetch',
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs', '**/*.config.{js,ts}', 'apps/*/e2e/**/*.ts', 'packages/*/test/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
]);
