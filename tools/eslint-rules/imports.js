/**
 * `allowed-imports`: product code imports only our packages and the libraries of docs/design/libraries.md
 * ("Ship in the product"). Tests, benches and configs may also use the "Dev and test only" table and the test tools.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The npm packages of each library name used in docs/design/libraries.md. */
export const NPM_OF = {
  'decimal.js': ['decimal.js'],
  KaTeX: ['katex'],
  MathLive: ['mathlive'],
  Delaunator: ['delaunator'],
  'robust-predicates': ['robust-predicates'],
  'polygon-clipping': ['polygon-clipping'],
  Manifold: ['manifold-3d'],
  'Tone.js': ['tone'],
  Tiptap: ['@tiptap/*'],
  'Nerdamer Prime': ['nerdamer-prime'],
  Algebrite: ['algebrite'],
  'Compute Engine': ['@cortex-js/compute-engine'],
  mathjs: ['mathjs'],
};

const TEST_TOOLS = ['vitest', 'vite', 'playwright', 'playwright-core', '@playwright/test', 'eslint', 'typescript-eslint', '@eslint/js', 'globals', 'happy-dom'];

const cache = new Map();

/** The library names of one table ("Ship in the product" or "Dev and test only"). */
export function tableNames(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) return [];
  const rest = markdown.slice(start + heading.length + 3);
  const end = rest.indexOf('\n## ');
  const section = end < 0 ? rest : rest.slice(0, end);
  const names = [];
  for (const line of section.split('\n')) {
    const m = /^\|\s*\[([^\]]+)\]\(/.exec(line);
    if (m) names.push(m[1].trim());
  }
  return names;
}

function allowedFrom(cwd, dev) {
  const key = `${cwd}|${dev}`;
  let set = cache.get(key);
  if (set) return set;
  let md;
  try {
    md = readFileSync(join(cwd, 'docs/design/libraries.md'), 'utf8');
  } catch {
    md = '';
  }
  const names = [...tableNames(md, 'Ship in the product'), ...(dev ? tableNames(md, 'Dev and test only') : [])];
  set = new Set(names.flatMap((n) => NPM_OF[n] ?? []));
  if (dev) for (const t of TEST_TOOLS) set.add(t);
  cache.set(key, set);
  return set;
}

/** The npm package of an import source: `@scope/name` or `name`. */
export function packageOf(source) {
  const parts = source.split('/');
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isAllowed(pkg, allowed) {
  if (allowed.has(pkg)) return true;
  if (pkg.startsWith('@')) return allowed.has(`${pkg.split('/')[0]}/*`);
  return false;
}

export const allowedImports = {
  meta: {
    type: 'problem',
    docs: { description: 'Import only our packages and the libraries listed in docs/design/libraries.md.' },
    schema: [
      {
        type: 'object',
        properties: { dev: { type: 'boolean' }, nodeBuiltins: { type: 'boolean' }, extra: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
    ],
    messages: {
      library: '`{{pkg}}` is not in docs/design/libraries.md{{where}}. Stop and ask the product owner before adding a library.',
      node: '`{{source}}` is a Node built-in; this code must also run in a browser and on mobile.',
    },
  },
  create(context) {
    const opt = context.options[0] ?? {};
    const allowed = allowedFrom(context.cwd, opt.dev === true);
    const extra = new Set(opt.extra ?? []);
    const check = (node, source) => {
      if (typeof source !== 'string' || source.startsWith('.') || source.startsWith('/')) return;
      if (source.startsWith('@incantly/')) return;
      if (source.startsWith('node:')) {
        if (opt.nodeBuiltins !== true) context.report({ node, messageId: 'node', data: { source } });
        return;
      }
      const pkg = packageOf(source);
      if (isAllowed(pkg, allowed) || extra.has(pkg)) return;
      context.report({ node, messageId: 'library', data: { pkg, where: opt.dev === true ? '' : ' ("Ship in the product")' } });
    };
    return {
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) => check(node.source, node.source.value),
      ImportExpression: (node) => node.source.type === 'Literal' && check(node.source, node.source.value),
    };
  },
};
