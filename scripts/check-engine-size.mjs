#!/usr/bin/env node
// Fails when a shipped engine bundle exceeds the PRD budget:
// "Under 250 KB minified and compressed for the core; kits load on demand."
// Also fails when the browser side of generation carries generation internals
// (PRD 18.6): the rules, the prompts, the model client or server code.
import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_BYTES = 250 * 1024;
/** Each kit loads on its own, only for scenes that call it. */
const KIT_BUDGET_BYTES = 120 * 1024;

const entries = [
  ['host API (@incantly/core)', 'packages/core/src/index.ts'],
  ['frame renderer', 'packages/core/src/sandbox/frame-entry.ts'],
  ['worker runtime', 'packages/core/src/sandbox/worker-entry.ts'],
  ['TipTap integration', 'packages/tiptap/src/index.ts'],
  ['generation client', 'packages/generation/src/client/index.ts'],
].filter(([, path]) => existsSync(path));

/** Text that only the service may hold. */
const SERVER_ONLY = ['Rules for every scene', 'PLAN format', 'BUILD format', 'REPAIR format', 'x-api-key', 'createHmac', 'node:'];

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
let failed = false;
for (const [name, entry] of entries) {
  const external = name === 'TipTap integration' || name === 'generation client' ? ['@tiptap/*', '@incantly/core'] : [];
  // Split chunks so code behind import() (kits, kit scripts) is measured as loaded on demand, not with the core.
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'esm',
    splitting: true,
    outdir: 'size-check',
    metafile: true,
    platform: 'browser',
    target: 'es2022',
    write: false,
    legalComments: 'none',
    drop: ['console', 'debugger'],
    external,
    logLevel: 'silent',
  });
  const files = new Map(result.outputFiles.map((file) => [file.path.slice(file.path.lastIndexOf('size-check')), file]));
  const outputs = result.metafile.outputs;
  const entryPath = Object.keys(outputs).find((path) => outputs[path].entryPoint);
  // The entry and every chunk it imports statically load together.
  const eager = new Set();
  const visit = (path) => {
    if (eager.has(path)) return;
    eager.add(path);
    for (const imported of outputs[path].imports) if (imported.kind === 'import-statement' && outputs[imported.path]) visit(imported.path);
  };
  visit(entryPath);
  const contents = Buffer.concat([...eager].map((path) => Buffer.from(files.get(path.slice(path.lastIndexOf('size-check'))).contents)));
  const gzipped = gzipSync(contents, { level: 9 }).length;
  const lazy = Object.keys(outputs).filter((path) => !eager.has(path) && path.endsWith('.js')).length;
  const ok = gzipped <= BUDGET_BYTES;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${kb(contents.length)} minified, ${kb(gzipped)} gzipped (budget ${kb(BUDGET_BYTES)})${lazy ? `; ${lazy} chunks load on demand` : ''}`);
  const text = contents.toString('utf8');
  if (name === 'generation client') {
    const leaked = SERVER_ONLY.filter((needle) => text.includes(needle));
    if (leaked.length > 0) {
      failed = true;
      console.log(`FAIL ${name} carries generation internals: ${leaked.join(', ')}`);
    }
  }
}

// Kit scripts, as the sandbox Worker receives them.
const kitScripts = 'packages/core/src/sandbox/generated/kits';
if (existsSync(kitScripts)) {
  for (const file of readdirSync(kitScripts).filter((name) => name.endsWith('.ts')).sort()) {
    const text = readFileSync(join(kitScripts, file), 'utf8');
    const script = JSON.parse(text.slice(text.indexOf('KIT_SCRIPT = ') + 'KIT_SCRIPT = '.length, text.lastIndexOf(';')));
    const bytes = Buffer.from(script, 'utf8');
    const gzipped = gzipSync(bytes, { level: 9 }).length;
    const ok = gzipped <= KIT_BUDGET_BYTES;
    failed ||= !ok;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${file.replace(/\.ts$/, '')} kit (on demand): ${kb(bytes.length)} minified, ${kb(gzipped)} gzipped (budget ${kb(KIT_BUDGET_BYTES)})`);
  }
}

if (failed) {
  console.error('A bundle is over its size budget, or generation internals reached the browser.');
  process.exit(1);
}
