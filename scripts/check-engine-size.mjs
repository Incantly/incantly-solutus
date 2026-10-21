#!/usr/bin/env node
// Fails when a shipped engine bundle exceeds the PRD budget:
// "Under 250 KB minified and compressed for the core; kits load on demand."
// Also fails when the browser side of generation carries generation internals
// (PRD 18.6): the rules, the prompts, the model client or server code.
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 250 * 1024;

const entries = [
  ['host API (@incantly/core)', 'packages/core/src/index.ts'],
  ['frame renderer', 'packages/core/src/sandbox/frame-entry.ts'],
  ['worker runtime', 'packages/core/src/sandbox/worker-entry.ts'],
  ['TipTap integration', 'packages/tiptap/src/index.ts'],
  ['generation client', 'packages/generation/src/client/index.ts'],
].filter(([, path]) => existsSync(path));

/** Text that only the service may hold. */
const SERVER_ONLY = ['Rules for every scene', 'PLAN format', 'BUILD format', 'REPAIR format', 'x-api-key', 'createHmac', 'node:'];

let failed = false;
for (const [name, entry] of entries) {
  const external = name === 'TipTap integration' || name === 'generation client' ? ['@tiptap/*', '@incantly/core'] : [];
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
  if (name === 'generation client') {
    const leaked = SERVER_ONLY.filter((text) => output.text.includes(text));
    if (leaked.length > 0) {
      failed = true;
      console.log(`FAIL ${name} carries generation internals: ${leaked.join(', ')}`);
    }
  }
}

if (failed) {
  console.error('A bundle is over its size budget, or generation internals reached the browser.');
  process.exit(1);
}
