# Lint rules: requirements

Every rule of `AGENTS.md`, `.kiro/steering/` and `docs/state-machines.md` that code can check is a lint rule or a check script, so `npm run check` fails and an agent must fix it before a merge. A rule that cannot be checked by code is checked by tests, benches or the one review, and says so.

Area: `tools/eslint-rules/` (a local ESLint plugin, `incantly`), `tools/check-repo.mjs`, `eslint.config.js`, and a small state-machine helper in `packages/kernel/src/contracts/state-machine.ts`. No new library. Branch `feat/lint-rules`.

### R1. Explicit state (docs/state-machines.md)

1. A class SHALL NOT hold more than 2 boolean fields that change after construction (`incantly/state-no-flag-soup`); the states go in one field with a table instead.
2. A field named `state`, `phase` or `status` SHALL change only through `transition(...)` or a `StateMachine` (`incantly/state-transition-only`); a constructor may set its first value.
3. Such a field SHALL have a type that is a union of string literals or a named type alias, not `string`, `number`, `any` or no type (`incantly/state-union-type`).
4. `transition(...)` and `new StateMachine(...)` SHALL take a table whose name ends in `_MACHINE` (`incantly/state-table-required`).
5. A local copy of a state field made before an `await` SHALL NOT be read after it (`incantly/state-no-stale-after-await`).
6. The kernel SHALL export `transition`, `canTransition` and `StateMachine`, with no DOM, timers or `Date`.

### R2. Package rules (AGENTS.md)

1. Product code SHALL import only `@incantly/*` packages, `node:` built-ins where allowed, relative files, and the libraries in the "Ship in the product" table of `docs/design/libraries.md` (`incantly/allowed-imports`). Tests, benches and configs MAY also import the dev and test libraries of that file, `vitest`, `vite` and `playwright`.
2. An exported function or method of an exported class in `packages/*/src` SHALL NOT `throw` directly (`incantly/no-throw-export`); it returns a `Result`.
3. Code and comments SHALL NOT credit an AI assistant (`incantly/no-ai-credit`).
4. The DOM-free packages, now including `packages/board/src/core`, SHALL NOT use DOM globals, timers, `fetch`, `Date` or `Math.random`.
5. A core folder SHALL NOT import its web layer or a DOM package (`no-restricted-imports`).

### R3. Repository checks (`tools/check-repo.mjs`, hackathon rules)

1. No tracked text file SHALL contain a name of the reference app; the names are stored only as SHA-256 hashes.
2. A package with code SHALL have a spec in `.kiro/specs/` (spec first).
3. `.gitignore` SHALL NOT ignore `.kiro` or a folder in it.
4. `npm run lint` SHALL run the check script after ESLint.

### R4. Strength

1. New and rebuilt code (`packages/board`, `packages/tiptap`, `tools`) SHALL get every rule as an error.
2. Older code SHALL get the state rules and `no-throw-export` as warnings until a later batch fixes it; every other rule is an error everywhere.
3. Each rule SHALL have tests that show code it accepts and code it refuses.

### R5. Tiptap

The Tiptap figure node view and code panel SHALL pass every rule as errors: the figure's lifecycle (docs/state-machines.md T1) becomes one `StateMachine`, which also fixes TT-R9.
