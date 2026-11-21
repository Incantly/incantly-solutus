/** RuleTester cases for every rule of the `incantly` plugin: code it accepts and code it refuses. */
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { rules } from '../index.js';
import { packageOf, tableNames } from '../imports.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser, ecmaVersion: 2022, sourceType: 'module' } });

tester.run('state-no-flag-soup', rules['state-no-flag-soup'], {
  valid: [
    'class A { a = false; b = false; f() { this.a = true; this.b = true; } }',
    // set only in the constructor
    'class A { a = false; b = false; c = false; constructor() { this.a = true; this.b = true; this.c = true; } }',
    // read-only flags do not change
    'class A { readonly a = false; readonly b = true; readonly c = false; }',
    'class A { n = 0; s = ""; f() { this.n = 1; this.s = "x"; } }',
  ],
  invalid: [
    {
      code: 'class A { a = false; b = false; c = false; f() { this.a = true; this.b = true; this.c = true; } }',
      errors: [{ messageId: 'soup' }],
    },
    {
      code: 'class A { private x: boolean; #y = true; z: boolean | undefined; f() { this.x = true; this.#y = false; this.z = true; } }',
      errors: [{ messageId: 'soup' }],
    },
    {
      // a callback made in the constructor runs later
      code: 'class A { a = false; b = false; c = false; constructor() { on(() => { this.a = true; this.b = true; this.c = true; }); } }',
      errors: [{ messageId: 'soup' }],
    },
    { code: 'class A { a = false; b = false; f() { this.a = true; this.b = true; } }', options: [{ max: 1 }], errors: [{ messageId: 'soup' }] },
  ],
});

tester.run('state-transition-only', rules['state-transition-only'], {
  valid: [
    'class A { state: S; constructor() { this.state = "idle"; } go() { this.state = transition(A_MACHINE, this.state, "go") ?? this.state; } }',
    'x.state = transition(T_MACHINE, x.state, "e");',
    'el.dataset["state"] = "live";',
    'this.mode = "a";',
  ],
  invalid: [
    { code: 'class A { go() { this.state = "live"; } }', errors: [{ messageId: 'direct' }] },
    { code: 'job.phase = "done";', errors: [{ messageId: 'direct' }] },
    { code: 'r.status = 2;', errors: [{ messageId: 'direct' }] },
    { code: 'this.mode = "a";', options: [{ names: ['mode'] }], errors: [{ messageId: 'direct' }] },
  ],
});

tester.run('state-union-type', rules['state-union-type'], {
  valid: [
    "class A { state: 'idle' | 'live' = 'idle'; }",
    'class A { state: Life = "idle"; }',
    'class A { readonly state = new StateMachine(A_MACHINE, "idle"); }',
    'class A { phase = "idle" as Phase; }',
    'class A { other = "x"; }',
  ],
  invalid: [
    { code: 'class A { state = "idle"; }', errors: [{ messageId: 'loose' }] },
    { code: 'class A { state: string = "idle"; }', errors: [{ messageId: 'loose' }] },
    { code: 'class A { private phase: number = 0; }', errors: [{ messageId: 'loose' }] },
    { code: 'class A { #status: any; }', errors: [{ messageId: 'loose' }] },
  ],
});

tester.run('state-table-required', rules['state-table-required'], {
  valid: ['transition(FIGURE_MACHINE, s, "go");', 'new StateMachine(machines.JOB_MACHINE, "idle");', 'canTransition(T_MACHINE, s, e);', 'other({}, s);'],
  invalid: [
    { code: 'transition({ idle: { go: "live" } }, s, "go");', errors: [{ messageId: 'table' }] },
    { code: 'new StateMachine(table, "idle");', errors: [{ messageId: 'table' }] },
    { code: 'canTransition(rows, s, e);', errors: [{ messageId: 'table' }] },
  ],
});

tester.run('state-no-stale-after-await', rules['state-no-stale-after-await'], {
  valid: [
    'async function f() { await x(); const s = this.state; use(s); }',
    'async function f() { const s = this.state; use(s); await x(); }',
    'async function f() { const s = this.state; await x(); if (this.state === "live") use(this.state); }',
    'function f() { const s = this.state; use(s); }',
  ],
  invalid: [
    { code: 'async function f() { const s = this.state; await x(); use(s); }', errors: [{ messageId: 'stale' }] },
    { code: 'const f = async () => { const p = job.phase; await x(); if (p === "a") go(); };', errors: [{ messageId: 'stale' }] },
  ],
});

tester.run('allowed-imports', rules['allowed-imports'], {
  valid: [
    "import { a } from './a';",
    "import { Figure } from '@incantly/kernel';",
    "import katex from 'katex';",
    "import { Editor } from '@tiptap/core';",
    "import { EditorState } from '@tiptap/pm/state';",
    "const m = import('katex/dist/katex.mjs');",
    { code: "import { describe } from 'vitest';", options: [{ dev: true }] },
    { code: "import nerdamer from 'nerdamer-prime';", options: [{ dev: true }] },
    { code: "import { readFileSync } from 'node:fs';", options: [{ nodeBuiltins: true }] },
    { code: "import x from 'mylib';", options: [{ extra: ['mylib'] }] },
  ],
  invalid: [
    { code: "import * as THREE from 'three';", errors: [{ messageId: 'library' }] },
    { code: "import { describe } from 'vitest';", errors: [{ messageId: 'library' }] },
    { code: "import nerdamer from 'nerdamer-prime';", errors: [{ messageId: 'library' }] },
    { code: "import { readFileSync } from 'node:fs';", errors: [{ messageId: 'node' }] },
    { code: "export * from 'lodash';", errors: [{ messageId: 'library' }] },
    { code: "import * as Y from 'yjs';", errors: [{ messageId: 'library' }] },
  ],
});

tester.run('no-throw-export', rules['no-throw-export'], {
  valid: [
    'function inner() { throw new Error("x"); }',
    'export function f() { try { throw new Error("x"); } catch { return 1; } }',
    'export function f() { const g = () => { throw new Error("x"); }; return g; }',
    'export class A { private f() { throw new Error("x"); } #g() { throw new Error("x"); } }',
    'class A { f() { throw new Error("x"); } }',
  ],
  invalid: [
    { code: 'export function f() { throw new Error("x"); }', errors: [{ messageId: 'thrown' }] },
    { code: 'export const f = () => { throw new Error("x"); };', errors: [{ messageId: 'thrown' }] },
    { code: 'export class A { f() { throw new Error("x"); } }', errors: [{ messageId: 'thrown' }] },
    { code: 'export default function () { throw new Error("x"); }', errors: [{ messageId: 'thrown' }] },
    { code: 'export function f() { try { g(); } catch { throw new Error("x"); } }', errors: [{ messageId: 'thrown' }] },
  ],
});

tester.run('no-ai-credit', rules['no-ai-credit'], {
  valid: ['// see .kiro/specs/cas R3', 'const a = "the geminid meteors";', '// Generated from the table'],
  invalid: [
    { code: '// Written with Claude', errors: [{ messageId: 'credit' }] },
    { code: '/* Co-authored-by: someone */', errors: [{ messageId: 'credit' }] },
    { code: 'const s = "Generated with AI";', errors: [{ messageId: 'credit' }] },
    { code: 'const s = `built by ChatGPT`;', errors: [{ messageId: 'credit' }] },
    { code: '// made with Kiro', errors: [{ messageId: 'credit' }] },
  ],
});

describe('libraries.md reading', () => {
  it('reads the library names of one table', () => {
    const md = '## Ship in the product\n\n| Library | L |\n|---|---|\n| [KaTeX](https://x) | MIT |\n| [Tone.js](https://y) | MIT |\n\n## Dev and test only\n\n| [mathjs](https://z) | A |\n';
    if (tableNames(md, 'Ship in the product').join() !== 'KaTeX,Tone.js') throw new Error('ship table');
    if (tableNames(md, 'Dev and test only').join() !== 'mathjs') throw new Error('dev table');
    if (tableNames(md, 'Missing').length !== 0) throw new Error('missing table');
  });

  it('names the package of an import', () => {
    if (packageOf('@tiptap/pm/state') !== '@tiptap/pm') throw new Error('scoped');
    if (packageOf('katex/dist/x.mjs') !== 'katex') throw new Error('plain');
  });
});
