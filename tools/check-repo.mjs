#!/usr/bin/env node
/**
 * Repository checks that ESLint cannot make (.kiro/specs/lint-rules R3; hackathon rules):
 * 1. no tracked text file names the reference app (the names are kept here only as SHA-256 hashes);
 * 2. every package with code has a spec in .kiro/specs/;
 * 3. .gitignore does not ignore .kiro or a folder in it.
 * Exits 1 and lists every problem when one fails.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const problems = [];

// 1. Names of the reference app, lower case, as SHA-256 hashes: the app's name and its best-known class names.
const BANNED = new Set([
  '44f87e411573a4d325328e0fd41ed36272b65d4e124b3574d4bbb4966c672e7d',
  'c87a57e2acd02ad317f0f3ac245b0c015e0f9c01d97e13a9232a0a2e68a22fba',
  '5f27def7ce0e8483bcf2990b3c5a3091222f31470f85e299d4d039fff88b97d9',
  '3fd395641273581055da82502a3d492a4763e6f648b1a8526cbee1e724b531e3',
]);
const hash = (w) => createHash('sha256').update(w).digest('hex');
const TEXT = /\.(ts|js|mjs|cjs|json|md|html|css|txt|yml|yaml|toml|rs|svg)$/;

const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const wordsOf = new Map();
for (const f of files) {
  if (!TEXT.test(f) || f.endsWith('package-lock.json')) continue;
  const p = join(root, f);
  let size;
  try {
    size = statSync(p).size;
  } catch {
    continue;
  }
  if (size > 1_000_000) continue;
  const text = readFileSync(p, 'utf8');
  for (const w of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    let set = wordsOf.get(w);
    if (!set) wordsOf.set(w, (set = new Set()));
    set.add(f);
  }
}
for (const [w, where] of wordsOf) {
  if (BANNED.has(hash(w))) problems.push(`A name of the reference app is in ${[...where].join(', ')}. Write "the reference app" instead.`);
}

// 2. Spec first: each package with code has its spec.
const SPEC_OF = {
  kernel: ['kernel'],
  plot: ['plot'],
  symbolic: ['symbolic', 'cas'],
  view: ['view'],
  audio: ['sound'],
  ui: ['algebra-view'],
  modes: ['app-modes'],
  sdk: ['sdk'],
  tiptap: ['tiptap'],
  teacher: ['teacher'],
  server: ['server'],
  board: ['board'],
};
const hasCode = (dir) => {
  const src = join(dir, 'src');
  if (!existsSync(src)) return false;
  const entries = readdirSync(src);
  if (entries.some((e) => e !== 'index.ts')) return true;
  const index = readFileSync(join(src, 'index.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '').trim();
  return index !== '' && index !== 'export {};';
};
for (const pkg of readdirSync(join(root, 'packages'))) {
  const dir = join(root, 'packages', pkg);
  if (!statSync(dir).isDirectory() || !hasCode(dir)) continue;
  const specs = SPEC_OF[pkg] ?? [pkg];
  const found = specs.some((s) => ['requirements.md', 'design.md', 'tasks.md'].every((f) => existsSync(join(root, '.kiro/specs', s, f))));
  if (!found) problems.push(`packages/${pkg} has code but no spec: write .kiro/specs/${specs[0]}/requirements.md, design.md and tasks.md first.`);
}

// 3. .kiro stays tracked.
if (existsSync(join(root, '.gitignore'))) {
  const lines = readFileSync(join(root, '.gitignore'), 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) return;
    if (/(^|\/)\.kiro(\/|\*|$)/.test(line) || line === '.*' || line === '.k*') problems.push(`.gitignore line ${i + 1} ("${line}") would ignore .kiro; .kiro must stay in the repository.`);
  });
}

if (problems.length > 0) {
  for (const p of problems) process.stderr.write(`check-repo: ${p}\n`);
  process.exit(1);
}
process.stdout.write(`check-repo: ${files.length} files, ${wordsOf.size} words; no problems.\n`);
