#!/usr/bin/env node
// Bundles the generation service and the eval runner for Node:
//   dist/serve.mjs  - the generation service
//   dist/evals.mjs  - the eval runner
//   dist/bench.mjs  - the agent bench (stage-by-stage prompts and checks)
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from '../../../scripts/generate.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

await generate();
await build({
  entryPoints: { serve: join(here, 'src/cli/serve.ts'), evals: join(here, 'src/cli/evals.ts'), bench: join(here, 'src/cli/bench.ts') },
  outdir: join(here, 'dist'),
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
});
