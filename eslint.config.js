import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import incantly from './tools/eslint-rules/index.js';

// Packages that must run unchanged in Node, in a worker and on mobile.
// They may not touch the DOM, timers, the network, the clock or unseeded randomness.
const domFree = [
  'packages/kernel/src/**/*.ts',
  'packages/plot/src/**/*.ts',
  'packages/symbolic/src/**/*.ts',
  'packages/modes/src/**/*.ts',
  'packages/view/src/core/**/*.ts',
  'packages/board/src/core/**/*.ts',
];

// Product code: what ships. Tests, benches and configs are not product code.
const product = ['packages/*/src/**/*.{ts,js}', 'apps/*/src/**/*.{ts,js}'];
const devCode = ['packages/*/test/**', 'packages/*/bench/**', 'packages/*/wasm/**', 'apps/*/test/**', 'tools/**', '**/*.config.{js,ts,mjs}'];

const stateRules = (level) => ({
  'incantly/state-no-flag-soup': level,
  'incantly/state-transition-only': level,
  'incantly/state-union-type': level,
  'incantly/state-table-required': level,
  'incantly/state-no-stale-after-await': level,
});

export default defineConfig([
  { ignores: ['**/node_modules/**', '**/dist/**', '**/generated/**', 'coverage/**', 'tools/eslint-rules/test/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { incantly },
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
      'incantly/no-ai-credit': 'error',
      ...stateRules('error'),
    },
  },
  {
    files: product,
    rules: {
      'incantly/allowed-imports': 'error',
      'incantly/no-throw-export': 'error',
    },
  },
  {
    files: ['packages/server/src/**/*.ts'],
    rules: { 'incantly/allowed-imports': ['error', { nodeBuiltins: true }] },
  },
  {
    files: ['apps/*/vite.config.ts'],
    rules: { 'incantly/allowed-imports': ['error', { dev: true, nodeBuiltins: true }] },
  },
  {
    files: devCode,
    rules: { 'incantly/allowed-imports': ['error', { dev: true, nodeBuiltins: true }] },
  },
  {
    files: domFree,
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'setInterval', 'fetch', 'Date'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the seeded random of the kernel; films must replay the same.' }],
      'no-restricted-imports': [
        'error',
        {
          paths: ['@incantly/sdk', '@incantly/ui', '@incantly/tiptap', '@incantly/audio', '@incantly/board', '@incantly/studio'].map((name) => ({
            name,
            message: 'A DOM-free core may not import a package with a screen.',
          })),
          patterns: [{ group: ['**/web', '**/web/**', '**/gl', '**/gl/**', '**/backends/**'], message: 'A core folder may not import its web or GPU layer.' }],
        },
      ],
    },
  },
  {
    // the helper that the state rules point to
    files: ['packages/kernel/src/contracts/state-machine.ts'],
    rules: stateRules('off'),
  },
  {
    // the rule's own test cases hold the words it refuses
    files: ['tools/eslint-rules/test/rules.test.js'],
    rules: { 'incantly/no-ai-credit': 'off' },
  },
  {
    files: ['packages/*/test/**/*.ts', 'packages/*/bench/**/*.ts', 'tools/**/*.js', '**/*.config.{js,ts}'],
    rules: { 'no-console': 'off', 'incantly/no-throw-export': 'off' },
  },
]);
