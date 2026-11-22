/**
 * The package as a whole (server design 2, requirements R3.5, R5.2): no web framework and no new library, the layers
 * the design names, and the entry points the design gives.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as server from '../../src/index';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));
const PKG = fileURLToPath(new URL('../../package.json', import.meta.url));

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(`${dir}${e.name}/`) : e.name.endsWith('.ts') ? [`${dir}${e.name}`] : []));
}

const files = filesIn(SRC);

describe('no new library, no web framework (design 2)', () => {
  it('package.json declares no dependency of its own', () => {
    const pkg = JSON.parse(readFileSync(PKG, 'utf8')) as Record<string, unknown>;
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) expect(pkg[field], field).toBeUndefined();
    expect(pkg['name']).toBe('@incantly/server');
    expect(pkg['type']).toBe('module');
  });

  it('every import is a node: module, a relative file or one of the allowed @incantly packages', () => {
    const allowed = /^@incantly\/(kernel|teacher|modes|sdk|board\/core)$/;
    const bad: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/(?:from|import)\s+'([^']+)'/g)) {
        const spec = m[1] as string;
        if (spec.startsWith('node:') || spec.startsWith('.') || allowed.test(spec)) continue;
        bad.push(`${f.slice(SRC.length)}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the layers of design 2 exist: env, http, limits, jobs, log, main, index', () => {
    const names = files.map((f) => f.slice(SRC.length));
    for (const want of ['env.ts', 'log.ts', 'main.ts', 'index.ts']) expect(names, want).toContain(want);
    for (const dir of ['http/', 'limits/', 'jobs/']) expect(names.some((n) => n.startsWith(dir)), dir).toBe(true);
  });
});

describe('the entry points (design 2)', () => {
  it('index.ts exports createServer for tests and hosts, and the settings reader', () => {
    expect(typeof server.createServer).toBe('function');
    expect(typeof server.readSettings).toBe('function');
  });

  it('main.ts is the only file that reads process.env or exits the process', () => {
    const users = files.filter((f) => /process\.(env|exit|argv)|loadEnvFile/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(SRC.length));
    expect(users.every((u) => u === 'main.ts')).toBe(true);
  });

  it('the settings are read from an env object that is passed in, never from process.env directly', () => {
    const src = readFileSync(`${SRC}env.ts`, 'utf8');
    expect(src).not.toMatch(/process\.env/);
  });
});
