/**
 * Which functions of a package other packages can call: everything reachable from the entry points in the package's
 * `package.json` `exports` (default `./src/index.ts`), through `export * from` and `export { … } from`. Entry points
 * listed in `incantly.internal` (for example `./engine`) are the package's own, for its tests and benches, and are not
 * a boundary; `allowed-imports` keeps other packages out of them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

const cache = new Map();

function resolveFile(from, spec) {
  const base = resolve(dirname(from), spec);
  for (const c of [base, `${base}.ts`, `${base}.js`, join(base, 'index.ts'), join(base, 'index.js')]) {
    if (existsSync(c) && !c.endsWith(sep) && /\.(ts|js)$/.test(c)) return c;
  }
  return undefined;
}

/** The re-exports of a file: `export * from` and `export { a, b as c } from`, skipping type-only ones. */
function reexportsOf(text) {
  const out = [];
  for (const m of text.matchAll(/export\s+\*\s+(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/g)) out.push({ spec: m[1], all: true });
  for (const m of text.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from\s+['"]([^'"]+)['"]/g)) {
    if (m[1]) continue;
    const items = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '' && !s.startsWith('type '))
      .map((s) => {
        const [src, as] = s.split(/\s+as\s+/);
        return { src: src.trim(), as: (as ?? src).trim() };
      });
    out.push({ spec: m[3], all: false, items });
  }
  return out;
}

/** For one package folder: file → '*' (all its exports are public) or the set of its public names. */
export function publicMap(pkgDir) {
  let map = cache.get(pkgDir);
  if (map) return map;
  map = new Map();
  cache.set(pkgDir, map);
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    pkg = {};
  }
  const internal = new Set(pkg.incantly?.internal ?? []);
  const exp = pkg.exports ?? { '.': './src/index.ts' };
  const entries = typeof exp === 'string' ? [exp] : Object.entries(exp).filter(([k]) => !internal.has(k)).map(([, v]) => (typeof v === 'string' ? v : (v.import ?? v.default)));
  const seen = new Set();
  const visit = (file, names) => {
    const key = `${file}|${names === '*' ? '*' : [...names].sort().join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    const had = map.get(file);
    if (had !== '*') {
      if (names === '*') map.set(file, '*');
      else map.set(file, new Set([...(had ?? []), ...names]));
    }
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    for (const r of reexportsOf(text)) {
      const target = resolveFile(file, r.spec);
      if (!target) continue;
      if (r.all) visit(target, names);
      else {
        const picked = r.items.filter((i) => names === '*' || names.has(i.as)).map((i) => i.src);
        if (picked.length > 0) visit(target, new Set(picked));
      }
    }
  };
  for (const e of entries) {
    if (typeof e !== 'string') continue;
    const f = resolveFile(join(pkgDir, 'package.json'), e);
    if (f) visit(f, '*');
  }
  return map;
}

/** The package folder of a source file (`…/packages/<name>/src/…`), or undefined. */
export function packageDirOf(file) {
  const m = /^(.*[\\/]packages[\\/][^\\/]+)[\\/]src[\\/]/.exec(file);
  return m ? m[1] : undefined;
}

/** True when `name`, exported from `file`, can be called from another package. */
export function isPublic(file, name) {
  const dir = packageDirOf(file);
  if (!dir) return false;
  const names = publicMap(dir).get(file);
  if (names === undefined) return false;
  return names === '*' || names.has(name);
}
