/**
 * The package as a whole (requirements R1, design 3): no DOM, timers, network, `Date` or unseeded randomness; only
 * the allowed imports; one public entry; and the state tables the docs name exist where the docs say.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHeadlessApp } from '@incantly/sdk';
import * as teacher from '../../src/index';
import type { ModeName } from './helpers';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesIn(`${dir}${e.name}/`) : e.name.endsWith('.ts') ? [`${dir}${e.name}`] : []));
}

/** Code without comments and without the text of string literals, so a word in a message does not count. */
function codeOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

const files = filesIn(SRC);

describe('no DOM, timers, network, Date or unseeded randomness (R1.1)', () => {
  it('there are source files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  const forbidden: readonly [string, RegExp][] = [
    ['Date', /\bDate\b/],
    ['setTimeout', /\bsetTimeout\b/],
    ['setInterval', /\bsetInterval\b/],
    ['requestAnimationFrame', /\brequestAnimationFrame\b/],
    ['fetch', /\bfetch\s*\(/],
    ['XMLHttpRequest', /\bXMLHttpRequest\b/],
    ['WebSocket', /\bWebSocket\b/],
    ['window', /\bwindow\b/],
    ['document', /\bdocument\./],
    ['navigator', /\bnavigator\b/],
    ['localStorage', /\blocalStorage\b/],
    ['Math.random', /\bMath\.random\b/],
    ['performance.now', /\bperformance\b/],
    ['process', /\bprocess\./],
    ['crypto.randomUUID', /\brandomUUID\b|\bgetRandomValues\b/],
  ];
  for (const [name, pattern] of forbidden) {
    it(`no ${name}`, () => {
      const hits = files.filter((f) => pattern.test(codeOf(f))).map((f) => f.slice(SRC.length));
      expect(hits).toEqual([]);
    });
  }

  it('imports no node: module and no package with a screen', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1] as string;
        if (spec.startsWith('node:') || /\/(web|gl)(\/|$)/.test(spec) || /@incantly\/(ui|view|audio|tiptap|server)\b/.test(spec)) bad.push(`${f.slice(SRC.length)}: ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('imports only the packages the design allows (kernel, modes, sdk, board core)', () => {
    const seen = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/from\s+'(@incantly\/[^']+)'/g)) seen.add(m[1] as string);
    const allowed = /^@incantly\/(kernel|modes|sdk|board\/core)$/;
    expect([...seen].filter((s) => !allowed.test(s))).toEqual([]);
  });
});

describe('the public entry (design 3)', () => {
  it('exports the tools, the prompt builder, the loop and the fake model', () => {
    for (const name of ['toolset', 'drawTool', 'figureTool', 'figureTarget', 'buildPrompt', 'catalogueFor', 'runTurn', 'fakeModel', 'TURN_MACHINE', 'TOOL_MACHINE']) {
      expect(teacher, name).toHaveProperty(name);
    }
  });

  it('hostile but well-typed input gives a result, never a throw (R7)', () => {
    const names = ['', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'a'.repeat(10_000), '\u0000', '\ud800'];
    for (const name of names) {
      expect(() => teacher.toolset([name]), `toolset ${name.slice(0, 20)}`).not.toThrow();
      expect(() => teacher.catalogueFor(name), `catalogueFor ${name.slice(0, 20)}`).not.toThrow();
      expect(teacher.catalogueFor(name).ok).toBe(false);
      const set = teacher.toolset(['draw', 'figure']);
      if (!set.ok) throw new Error('toolset');
      const app = createHeadlessApp({ mode: 'graphing' as ModeName });
      const target = teacher.figureTarget(app);
      expect(() => set.value.call(target, name, {}), `call ${name.slice(0, 20)}`).not.toThrow();
      expect(set.value.call(target, name, {}).result.ok).toBe(false);
    }
  });

  it('draw with hostile lines gives line errors, never a throw, and leaves the target free', () => {
    const set = teacher.toolset(['draw']);
    if (!set.ok) throw new Error('toolset');
    const app = createHeadlessApp({ mode: 'graphing' as ModeName });
    const target = teacher.figureTarget(app);
    const lines = ['__proto__ = 1', 'constructor = 2', '\u0000', '\ud800 = 1', 'a'.repeat(100_000), '= =', '((((((((((((((((((((', '"unterminated'];
    for (const line of lines) {
      expect(() => set.value.call(target, 'draw', { lines: [line] })).not.toThrow();
      expect(target.guard.busy).toBe(false);
    }
  });

  it('buildPrompt with strange request text gives a prompt, never a throw', () => {
    const app = createHeadlessApp({ mode: 'geometry' as ModeName });
    const target = teacher.figureTarget(app);
    for (const text of ['', '\u0000'.repeat(50), '\ud800', 'x'.repeat(200_000), '</material>'.repeat(1000)]) {
      const built = teacher.buildPrompt('live', target, { text });
      expect(built.ok, text.slice(0, 10)).toBe(true);
    }
  });
});
