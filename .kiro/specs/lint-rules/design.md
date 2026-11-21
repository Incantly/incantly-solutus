# Lint rules: design

| Path | Holds |
|---|---|
| `tools/eslint-rules/index.js` | The `incantly` plugin: every rule below |
| `tools/eslint-rules/state.js` | The five state rules |
| `tools/eslint-rules/imports.js` | `allowed-imports`, reading `docs/design/libraries.md` |
| `tools/eslint-rules/code.js` | `no-throw-export`, `no-ai-credit` |
| `tools/eslint-rules/test/*.test.ts` | ESLint `RuleTester` cases, run by Vitest (project `tools`) |
| `tools/check-repo.mjs` | Banned names by hash, spec per package, `.gitignore` |
| `packages/kernel/src/contracts/state-machine.ts` | `transition`, `canTransition`, `StateMachine` |

## The helper

```ts
type MachineTable<S extends string, E extends string> = { readonly [K in S]: { readonly [V in E]?: S } };
transition(TABLE_MACHINE, from, event): S | undefined;      // undefined: the table has no such move
canTransition(TABLE_MACHINE, from, event): boolean;
new StateMachine(TABLE_MACHINE, initial, onRefused?)        // .state, .send(event): boolean, .can(event), .is(...states)
```

A refused move changes nothing; `onRefused(from, event)` lets a host report it.

## `allowed-imports`

The rule reads the "Ship in the product" table of `docs/design/libraries.md` and maps each library name to its npm packages (`KaTeX` → `katex`, `Tone.js` → `tone`, `Tiptap` → `@tiptap/*`, …). A library missing from the table is refused even if it is installed; a table row with no known npm name allows nothing until the map is updated. The "Dev and test only" table is allowed in tests, benches and configs.

## Strength

`eslint.config.js` has one block for new code (`packages/board/**`, `packages/tiptap/**`, `tools/**`) where every rule is `error`, and the default block where the state rules and `no-throw-export` are `warn`.
