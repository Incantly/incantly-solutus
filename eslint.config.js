import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Packages that must run unchanged in Node, in a worker and on mobile.
// They may not touch the DOM, timers, the network or the animation clock.
const domFree = ['packages/kernel/src/**/*.ts', 'packages/plot/src/**/*.ts', 'packages/symbolic/src/**/*.ts', 'packages/modes/src/**/*.ts', 'packages/view/src/core/**/*.ts'];

export default defineConfig([
  { ignores: ['**/node_modules/**', '**/dist/**', '**/generated/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    files: domFree,
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'setInterval', 'fetch', 'Date'],
    },
  },
  {
    files: ['packages/*/test/**/*.ts', 'packages/*/bench/**/*.ts', '**/*.config.{js,ts}'],
    rules: { 'no-console': 'off' },
  },
]);
