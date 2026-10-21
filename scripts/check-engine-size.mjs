#!/usr/bin/env node
// Fails when a shipped engine bundle exceeds the PRD budget:
// "Under 250 KB minified and compressed for the core; kits load on demand."
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 250 * 1024;

const entries = [
  ['host API (@incantly/core)', 'packages/core/src/index.ts'],
  ['frame renderer', 'packages/core/src/sandbox/frame-entry.ts'],
  ['worker runtime', 'packages/core/src/sandbox/worker-entry.ts'],
  ['TipTap integration', 'packages/tiptap/src/index.ts'],
].filter(([, path]) => existsSync(path));

let failed = false;
for (const [name, entry] of entries) {
  const external = name === 'TipTap integration' ? ['@tiptap/*', '@incantly/core'] : [];
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    write: false,
    legalComments: 'none',
    drop: ['console', 'debugger'],
    external,
    logLevel: 'silent',
  });
  const output = result.outputFiles[0];
  const gzipped = gzipSync(output.contents, { level: 9 }).length;
  const ok = gzipped <= BUDGET_BYTES;
  failed ||= !ok;
  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${kb(output.contents.length)} minified, ${kb(gzipped)} gzipped (budget ${kb(BUDGET_BYTES)})`);
}

if (failed) {
  console.error('Engine size budget exceeded.');
  process.exit(1);
}
