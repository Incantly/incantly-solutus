# Lint rules: requirements

Every rule of `AGENTS.md`, `.kiro/steering/` and `docs/state-machines.md` that code can check is a lint rule or a check script, so `npm run check` fails and an agent must fix it before a merge. A rule that cannot be checked by code is checked by tests, benches or the one review, and says so.

Area: `tools/eslint-rules/` (a local ESLint plugin, `incantly`), `tools/check-repo.mjs`, `eslint.config.js`, and a small state-machine helper in `packages/kernel/src/contracts/state-machine.ts`. No new library. Branch `feat/lint-rules`.

### R1. Explicit state (docs/state-machines.md)

1. A class SHALL NOT hold more than 2 boolean fields that change after construction (`incantly/state-no-flag-soup`); the states go in one field with a table instead.
2. A field named `state`, `phase` or `status` SHALL change only through `transition(...)` or a `StateMachine` (`incantly/state-transition-only`); a constructor may set its first value.
3. Such a field SHALL have a type that is a union of string literals or a named type alias, not `string`, `number`, `any` or no type (`incantly/state-union-type`).
4. `transition(...)` and `new StateMachine(...)` SHALL take a table whose name ends in `_MACHINE` (`incantly/state-table-required`).
5. A `*_MACHINE` table whose rows are all the same identifier, or all object literals with the same events and targets, SHALL be refused: a table that refuses nothing is a value, so it is derived or written with only the moves that may happen (`incantly/state-table-refuses`).
6. A local copy of a state field made before an `await` SHALL NOT be read after it (`incantly/state-no-stale-after-await`).
7. The kernel SHALL export `transition`, `canTransition` and `StateMachine`, with no DOM, timers or `Date`.
8. In a class that holds a `StateMachine`, a field typed `X | null` or `X | undefined` that a method sets to a value when it sends a begin-like move (`begin`, `start`, `down`, `open`, `enter`, `press`, `grab`, `arm`, `activate`, `engage`) SHALL be set back to `null` or `undefined` somewhere in the class: it holds part of the state, so it is cleared when the machine leaves the state, or kept in the state's data (`incantly/state-no-shadow-null`).

9. In `packages/board`, `packages/tiptap` and `tools`, `new StateMachine(table, initial)` SHALL take the third argument, `onRefused`, so a refused move is reported and never silent (`incantly/state-refusal-reported`). The board reports through its `onError` as `internal`; Tiptap through `reportError`.
10. In a file that makes a `StateMachine`, reading `headersSent`, `writableEnded`, `writableFinished` or `readyState` (and `destroyed`, in a file that imports a `node:` module) off another object SHALL be an error outside a function whose name starts with `write` (`incantly/state-no-io-flags`): an I/O object's own flags are a second record of whether an answer or a stream is over, and the machine is the one record. A class's own getter (`this.destroyed`) derived from its machine is allowed.

### R2. Package rules (AGENTS.md)

1. Product code SHALL import only `@incantly/*` packages, `node:` built-ins where allowed, relative files, and the libraries in the "Ship in the product" table of `docs/design/libraries.md` (`incantly/allowed-imports`). Tests, benches and configs MAY also import the dev and test libraries of that file, `vitest`, `vite` and `playwright`.
2. An exported function or method of an exported class in `packages/*/src` SHALL NOT `throw` directly (`incantly/no-throw-export`); it returns a `Result`.
3. Code and comments SHALL NOT credit an AI assistant (`incantly/no-ai-credit`).
4. The DOM-free packages, now including `packages/board/src/core`, SHALL NOT use DOM globals, timers, `fetch`, `Date` or `Math.random`.
5. A core folder SHALL NOT import its web layer or a DOM package (`no-restricted-imports`).

6. In product code, a property of an imported binding SHALL NOT be assigned (`x.y = …`), changed with `++` or `--`, or given to `Object.assign`, `Object.defineProperty` or `Object.setPrototypeOf` as the target (`incantly/no-imported-mutation`): a module's object is shared by everyone who imports it, so state is passed in, or each owner has its own, or the owner of a registry gives a function that writes it.

### R3. Repository checks (`tools/check-repo.mjs`, hackathon rules)

1. No tracked text file SHALL contain a name of the reference app; the names are stored only as SHA-256 hashes.
2. A package with code SHALL have a spec in `.kiro/specs/` (spec first).
3. `.gitignore` SHALL NOT ignore `.kiro` or a folder in it.
4. `npm run lint` SHALL run the check script after ESLint.

### R4. Strength

1. Every rule SHALL be an error in every package. (Until `fix/lint-warnings`, older code had the state rules and `no-throw-export` as warnings.)
2. `no-throw-export` SHALL look only at what a package's entry points reach (package.json `exports`, through `export *` and `export { … } from`), leave out entries listed in `incantly.internal`, and allow `throw new TypeError(…)` for a wrong argument type. `allowed-imports` SHALL refuse an internal entry outside tests, benches and configs.
3. Each rule SHALL have tests that show code it accepts and code it refuses.

### R5. Tiptap

The Tiptap figure node view and code panel SHALL pass every rule as errors: the figure's lifecycle (docs/state-machines.md T1) becomes one `StateMachine`, which also fixes TT-R9.
