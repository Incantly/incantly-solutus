/** RuleTester cases for every rule of the `incantly` plugin: code it accepts and code it refuses. */
import { RuleTester } from 'eslint';
import { fileURLToPath } from 'node:url';
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

tester.run('state-table-refuses', rules['state-table-refuses'], {
  valid: [
    // rows differ
    "const A_MACHINE: MachineTable<S, E> = { idle: { go: 'live' }, live: { stop: 'idle' } };",
    // same events, different targets
    "const A_MACHINE = { a: { go: 'x' }, b: { go: 'y' } };",
    // same targets, different events
    "const A_MACHINE = { a: { go: 'x' }, b: { run: 'x' } };",
    // a row that refuses everything next to one that does not
    "const A_MACHINE = { live: { close: 'closed' }, closed: {} };",
    // one row cannot be compared with another
    "const A_MACHINE = { only: { go: 'only' } };",
    // not a *_MACHINE
    "const TABLE = { a: { go: 'x' }, b: { go: 'x' } };",
    // rows that are different names
    'const A_MACHINE = { a: ROW_A, b: ROW_B };',
    // a table that is not an object literal is out of reach of this rule
    'const A_MACHINE = makeTable();',
  ],
  invalid: [
    {
      code: "const PAGES_MACHINE: MachineTable<S, E> = { a: ANY, b: ANY, c: ANY };",
      errors: [{ messageId: 'same' }],
    },
    {
      code: "const A_MACHINE = { a: { go: 'x', stop: 'y' }, b: { stop: 'y', go: 'x' } };",
      errors: [{ messageId: 'same' }],
    },
    {
      code: "const A_MACHINE = { a: { go: 'x' }, b: { go: 'x' } } as const;",
      errors: [{ messageId: 'same' }],
    },
    {
      code: "const A_MACHINE = Object.freeze({ a: { go: 'x' }, b: { go: 'x' } });",
      errors: [{ messageId: 'same' }],
    },
    {
      code: 'const A_MACHINE = { a: {}, b: {} };',
      errors: [{ messageId: 'same' }],
    },
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

tester.run('state-no-shadow-null', rules['state-no-shadow-null'], {
  valid: [
    // cleared when the machine leaves the state
    `class A { #m = new StateMachine(A_MACHINE, 'idle'); #page: string | null = null;
      begin(p: string) { if (!this.#m.send('begin')) return; this.#page = p; }
      end() { this.#m.send('end'); this.#page = null; } }`,
    // cleared with undefined, in another method
    `class A { m = new StateMachine(A_MACHINE, 'idle'); page: string | undefined;
      begin(p: string) { this.m.send('begin'); this.page = p; }
      reset() { this.page = undefined; } }`,
    // a nullable field set in a method that makes no begin-like move
    `class A { #m = new StateMachine(A_MACHINE, 'idle'); #label: string | null = null;
      end() { this.#m.send('end'); this.#label = 'done'; } }`,
    // no machine in the class
    `class A { #page: string | null = null; begin(p: string) { this.#page = p; } }`,
    // a field that is not nullable
    `class A { #m = new StateMachine(A_MACHINE, 'idle'); #page = ''; begin(p: string) { this.#m.send('begin'); this.#page = p; } }`,
    // the constructor only starts the field
    `class A { #m = new StateMachine(A_MACHINE, 'idle'); #page: string | null; constructor() { this.#page = 'x'; this.#m.send('begin'); } }`,
    // the data lives with the state
    `class A { #m = new StateMachine(A_MACHINE, 'idle'); #drawing: { page: string } | null = null;
      begin(p: string) { this.#m.send('begin'); this.#drawing = { page: p }; }
      end() { this.#m.send('end'); this.#drawing = void 0; } }`,
  ],
  invalid: [
    {
      code: `class A { #m = new StateMachine(A_MACHINE, 'idle'); #page: string | null = null;
        begin(p: string) { this.#m.send('begin'); this.#page = p; }
        end() { this.#m.send('end'); } }`,
      errors: [{ messageId: 'shadow' }],
    },
    {
      code: `class A { m = new StateMachine(A_MACHINE, 'idle'); target: Node | undefined;
        start(n: Node) { if (this.m.send('start')) this.target = n; } }`,
      errors: [{ messageId: 'shadow' }],
    },
    {
      // set inside a callback of the beginning method, cleared only in the constructor
      code: `class A { m = new StateMachine(A_MACHINE, 'idle'); id: number | null = null;
        constructor() { this.id = null; }
        down(x: number) { this.m.send('down'); items.forEach(() => { this.id = x; }); } }`,
      errors: [{ messageId: 'shadow' }],
    },
    {
      // two fields, only one cleared
      code: `class A { #m = new StateMachine(A_MACHINE, 'idle'); #a: string | null = null; #b: number | null = null;
        begin(a: string, b: number) { this.#m.send('begin'); this.#a = a; this.#b = b; }
        end() { this.#m.send('end'); this.#a = null; } }`,
      errors: [{ messageId: 'shadow' }],
    },
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
    { code: 'export function f(x) { if (typeof x !== "string") throw new RangeError("x"); }', errors: [{ messageId: 'thrown' }] },
    { code: 'export function f(x) { if (typeof x !== "string") throw new TypeError("x"); }', options: [{ allow: [] }], errors: [{ messageId: 'thrown' }] },
  ],
});

// inside packages/<name>/src only what the package's entry points reach is a boundary
const demo = fileURLToPath(new URL('./fixtures/packages/demo/src/', import.meta.url));
tester.run('no-throw-export at the package boundary', rules['no-throw-export'], {
  valid: [
    // a wrong argument type is a programming error (embed-files-export design)
    'export function f(x) { if (typeof x !== "string") throw new TypeError("f: x must be text"); }',
    { code: 'export function inner() { throw new Error("x"); }', filename: `${demo}inner.ts` },
    { code: 'export function hidden() { throw new Error("x"); }', filename: `${demo}named.ts` },
    { code: 'export function anything() { throw new Error("x"); }', filename: `${demo}engine.ts` },
  ],
  invalid: [
    { code: 'export function pub() { throw new Error("x"); }', filename: `${demo}pub.ts`, errors: [{ messageId: 'thrown' }] },
    { code: 'export function shown() { throw new Error("x"); }', filename: `${demo}named.ts`, errors: [{ messageId: 'thrown' }] },
    { code: 'export class Pub { go() { throw new Error("x"); } }', filename: `${demo}pub.ts`, errors: [{ messageId: 'thrown' }] },
  ],
});

tester.run('allowed-imports of an internal entry', rules['allowed-imports'], {
  valid: [{ code: "import { simplifyNode } from '@incantly/symbolic/engine';", options: [{ dev: true }] }, "import { run } from '@incantly/symbolic';", "import { SYMBOLIC_COMMANDS } from '@incantly/symbolic/catalogue';"],
  invalid: [{ code: "import { simplifyNode } from '@incantly/symbolic/engine';", errors: [{ messageId: 'internal' }] }],
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

tester.run('no-imported-mutation', rules['no-imported-mutation'], {
  valid: [
    "import { style } from './style'; const s = { ...style }; s.axes = true;",
    "import { style } from './style'; function f(o) { o.axes = true; } f({});",
    "import { style } from './style'; function f(style) { style.axes = true; }",
    "import { style } from './style'; const read = style.axes; use(style.grid);",
    "import { style } from './style'; Object.assign({}, style);",
    "import { make } from './make'; make().axes = true;",
    "import { style } from './style'; class A { style = {}; f() { this.style.axes = true; } }",
    "import { style } from './style'; { const style = {}; style.axes = true; }",
  ],
  invalid: [
    { code: "import { style } from './style'; style.axes = true;", errors: [{ messageId: 'mutated' }] },
    { code: "import { style } from './style'; function f() { style.grid.on = false; }", errors: [{ messageId: 'mutated' }] },
    { code: "import * as ns from './style'; ns.count += 1;", errors: [{ messageId: 'mutated' }] },
    { code: "import style from './style'; style['axes'] = true;", errors: [{ messageId: 'mutated' }] },
    { code: "import { n } from './n'; n.count++;", errors: [{ messageId: 'mutated' }] },
    { code: "import { n } from './n'; --n.count;", errors: [{ messageId: 'mutated' }] },
    { code: "import { style } from './style'; Object.assign(style, { axes: true });", errors: [{ messageId: 'mutated' }] },
    { code: "import { style } from './style'; Object.assign(style.grid, { on: true });", errors: [{ messageId: 'mutated' }] },
    { code: "import { style } from './style'; style!.axes = true;", errors: [{ messageId: 'mutated' }] },
  ],
});

tester.run('state-refusal-reported', rules['state-refusal-reported'], {
  valid: [
    "const m = new StateMachine(A_MACHINE, 'idle', (from, event) => report(from, event));",
    "class A { #m = new StateMachine(A_MACHINE, 'idle', this.#refused); #refused = () => {}; }",
    "const m = new Other(A_MACHINE, 'idle');",
  ],
  invalid: [
    { code: "const m = new StateMachine(A_MACHINE, 'idle');", errors: [{ messageId: 'silent' }] },
    { code: "class A { #m = new StateMachine<S, E>(A_MACHINE, 'idle'); }", errors: [{ messageId: 'silent' }] },
    { code: 'const m = new StateMachine(A_MACHINE);', errors: [{ messageId: 'silent' }] },
  ],
});

tester.run('gl-clear-masks', rules['gl-clear-masks'], {
  valid: [
    'function f(gl) { gl.depthMask(true); gl.colorMask(true, true, true, true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }',
    'function f(gl) { gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); }',
    'function f(gl) { gl.colorMask(true, true, true, true); gl.clear(gl.COLOR_BUFFER_BIT); }',
    // a clear of something else, and calls named clear that are not a GL clear
    'function f(gl, list) { gl.clear(gl.STENCIL_BUFFER_BIT); list.clear(); cache.clear(); }',
  ],
  invalid: [
    { code: 'function f(gl) { gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }', errors: [{ messageId: 'depth' }, { messageId: 'color' }] },
    { code: 'function f(gl) { gl.colorMask(true, true, true, true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }', errors: [{ messageId: 'depth' }] },
    // set after the clear, or turned off, does not count
    { code: 'function f(gl) { gl.clear(gl.DEPTH_BUFFER_BIT); gl.depthMask(true); }', errors: [{ messageId: 'depth' }] },
    { code: 'function f(gl) { gl.depthMask(false); gl.clear(gl.DEPTH_BUFFER_BIT); }', errors: [{ messageId: 'depth' }] },
    { code: 'function f(gl) { gl.colorMask(true, true, true, false); gl.clear(gl.COLOR_BUFFER_BIT); }', errors: [{ messageId: 'color' }] },
    // in another function, it is not known to run first
    { code: 'function g(gl) { gl.depthMask(true); } function f(gl) { gl.clear(gl.DEPTH_BUFFER_BIT); }', errors: [{ messageId: 'depth' }] },
  ],
});

tester.run('no-length-reset', rules['no-length-reset'], {
  valid: [
    // written by index and cut to the count
    'function f(out, xs) { let n = 0; for (const x of xs) out[n++] = x; out.length = n; }',
    // emptied and never filled again here
    'class H { #undo = []; clear() { this.#undo.length = 0; } }',
    // pushed in another function: a local list of its own
    'function a(list) { list.length = 0; } function b(list) { list.push(1); }',
    // a number field called length
    'function f(s) { s.length = 0; s.points++; }',
  ],
  invalid: [
    { code: 'function f(out, xs) { out.length = 0; for (const x of xs) out.push(x); }', errors: [{ messageId: 'reset' }] },
    { code: 'class P { #shown = []; begin() { this.#shown.length = 0; } draw(t) { this.#shown.push(t); } }', errors: [{ messageId: 'reset' }] },
    { code: 'class P { items = []; begin() { this.items.length = 0; } add(t) { this.items.push(t); } }', errors: [{ messageId: 'reset' }] },
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
