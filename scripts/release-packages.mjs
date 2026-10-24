#!/usr/bin/env node
// Builds the SDK packages for installing in other projects, from GitHub Packages:
//   .release/<package>/package.json  - the published manifest: exports point at dist, workspace
//                                       dependencies pinned to the released version
//   .release/<package>/dist/          - ESM JavaScript, one file per export plus shared chunks,
//                                       and .d.ts types next to it
// The workspace's own package.json files keep pointing at src, so the playground,
// tests and typecheck run on the sources as before.
//
//   node scripts/release-packages.mjs            builds every package
//   node scripts/release-packages.mjs --publish  builds, then runs npm publish for each
//                                                (needs NODE_AUTH_TOKEN with write:packages)
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.release');
const REGISTRY = 'https://npm.pkg.github.com';
const REPOSITORY = 'https://github.com/Incantly/incantly-solutus';

/** In dependency order: a package's types are built against those released before it. */
const PACKAGES = [
  { dir: 'core', platform: 'neutral' },
  { dir: 'tiptap', platform: 'browser' },
  { dir: 'generation', platform: 'node', bin: { 'incantly-serve': 'src/cli/serve.ts' } },
];

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const manifests = Object.fromEntries(PACKAGES.map(({ dir }) => [dir, read(join(root, 'packages', dir, 'package.json'))]));
const released = Object.fromEntries(Object.entries(manifests).map(([dir, m]) => [m.name, { dir, version: m.version }]));

/** "./src/scenes/index.ts" -> "scenes/index": the dist path of an export, without extension. */
const distName = (source) => source.replace(/^\.\/src\//, '').replace(/\.ts$/, '');

function pinned(deps = {}) {
  return Object.fromEntries(Object.entries(deps).map(([name, range]) => [name, released[name] ? released[name].version : range]));
}

async function bundle({ dir, platform, bin }, manifest, pkgOut) {
  const entryPoints = Object.fromEntries(Object.values(manifest.exports).map((source) => [distName(source), join(root, 'packages', dir, source.slice(2))]));
  const common = {
    bundle: true,
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
    // Dependencies, @incantly packages among them, are installed beside this one.
    packages: 'external',
    // Node built-ins are only reached by the server side of @incantly/generation.
    external: ['node:*'],
    logLevel: 'warning',
    legalComments: 'none',
  };
  await build({ ...common, entryPoints, outdir: join(pkgOut, 'dist'), platform, splitting: true, chunkNames: 'chunks/[name]-[hash]' });
  for (const [name, source] of Object.entries(bin ?? {})) {
    await build({
      ...common,
      entryPoints: { [`bin/${name}`]: join(root, 'packages', dir, source) },
      outdir: join(pkgOut, 'dist'),
      platform: 'node',
      banner: { js: '#!/usr/bin/env node' },
    });
  }
}

/** Emits .d.ts files with tsc, resolving earlier @incantly packages to their released types. */
function declarations({ dir }, manifest, pkgOut) {
  const pkgDir = join(root, 'packages', dir);
  const paths = {};
  for (const [name, { dir: depDir }] of Object.entries(released)) {
    if (depDir === dir || !manifest.dependencies?.[name]) continue;
    for (const [sub, source] of Object.entries(manifests[depDir].exports)) {
      paths[name + sub.slice(1)] = [join(out, depDir, 'dist', `${distName(source)}.d.ts`)];
    }
  }
  const config = join(pkgOut, 'tsconfig.release.json');
  writeFileSync(
    config,
    JSON.stringify({
      extends: join(root, 'tsconfig.base.json'),
      compilerOptions: {
        noEmit: false,
        declaration: true,
        emitDeclarationOnly: true,
        rootDir: join(pkgDir, 'src'),
        outDir: join(pkgOut, 'dist'),
        types: ['node'],
        typeRoots: [join(root, 'node_modules/@types')],
        paths,
      },
      files: Object.values(manifest.exports).map((source) => join(pkgDir, source.slice(2))),
    }),
  );
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit', cwd: root });
  rmSync(config);
  addExtensions(join(pkgOut, 'dist'));
}

/**
 * tsc keeps the sources' extensionless relative imports in the .d.ts files; projects
 * on "moduleResolution": "node16"/"nodenext" need full paths, so spell them out.
 */
function addExtensions(distDir) {
  const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
  for (const file of walk(distDir).filter((f) => f.endsWith('.d.ts'))) {
    const here = dirname(file);
    const text = readFileSync(file, 'utf8').replace(/((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]*)(['"])/g, (match, before, spec, after) => {
      if (/\.(js|json)$/.test(spec)) return match;
      if (existsSync(join(here, `${spec}.d.ts`))) return `${before}${spec}.js${after}`;
      if (existsSync(join(here, spec, 'index.d.ts'))) return `${before}${spec}/index.js${after}`;
      return match;
    });
    writeFileSync(file, text);
  }
}

function releaseManifest({ dir }, manifest) {
  const exports = Object.fromEntries(
    Object.entries(manifest.exports).map(([sub, source]) => [sub, { types: `./dist/${distName(source)}.d.ts`, default: `./dist/${distName(source)}.js` }]),
  );
  const bin = Object.fromEntries(Object.keys(PACKAGES.find((p) => p.dir === dir).bin ?? {}).map((name) => [name, `dist/bin/${name}.js`]));
  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    type: 'module',
    license: 'UNLICENSED',
    repository: { type: 'git', url: `git+${REPOSITORY}.git`, directory: `packages/${dir}` },
    exports,
    ...(Object.keys(bin).length ? { bin } : {}),
    files: ['dist'],
    engines: { node: '>=20' },
    dependencies: pinned(manifest.dependencies),
    publishConfig: { registry: REGISTRY },
  };
}

await generate();
rmSync(out, { recursive: true, force: true });
for (const pkg of PACKAGES) {
  const manifest = manifests[pkg.dir];
  const pkgOut = join(out, pkg.dir);
  mkdirSync(pkgOut, { recursive: true });
  await bundle(pkg, manifest, pkgOut);
  declarations(pkg, manifest, pkgOut);
  writeFileSync(join(pkgOut, 'package.json'), `${JSON.stringify(releaseManifest(pkg, manifest), null, 2)}\n`);
  process.stdout.write(`built ${manifest.name}@${manifest.version} -> ${relative(root, pkgOut)}\n`);
}

if (process.argv.includes('--publish')) {
  for (const { dir } of PACKAGES) {
    // npm publishes a prerelease such as 0.1.0-dev only under a tag other than latest.
    const tag = manifests[dir].version.includes('-') ? ['--tag', 'next'] : [];
    execFileSync('npm', ['publish', '--registry', REGISTRY, ...tag], { stdio: 'inherit', cwd: join(out, dir) });
  }
}
