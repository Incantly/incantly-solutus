# Rules for every agent working in this repository

## Read first

1. `docs/design/formula-language-and-kernel.md`: the core design and its decisions (section 13).
2. `docs/features/README.md`: the feature areas and the decisions that settle overlaps.
3. `docs/design/performance.md`: performance rules and budgets that apply to every area.
4. `docs/design/libraries.md`: the only third-party libraries allowed, with their licences.
5. `docs/process/pipeline.md`: who does what, and the hand-off files.
6. Your area's folder in `docs/features/`.

Where a feature folder and the core design disagree, `docs/features/README.md` and section 13 of the core design decide.

## Legal

- The reference app's code is EUPL 1.2 and its apps and manual are non-commercial. We learned from it; we copy nothing.
- Never put the reference app's code, manual text, assets, or its class, method, file or package names into this repository. Do not read the reference app's source while building: build from our docs.
- Add a dependency only if it is listed in `docs/design/libraries.md`. To add another, stop and report it; do not add it.

## Code

- TypeScript, strict, ES2022 modules. Node 22 or later.
- Packages under `packages/`, the web app under `apps/studio`. Each package exports from `src/index.ts`.
- `kernel`, `plot`, `symbolic`, `modes`, `view/src/core` and `board/src/core` have no DOM, timers, network or `Date`. They must run in Node, a worker and on mobile.
- Nothing throws across a package boundary. Public functions return `Result<T>` from `packages/kernel/src/contracts/errors.ts`, and errors use the format in `docs/features/errors/design.md`.
- Shared contracts live in `packages/kernel/src/contracts/`. Other areas may only append entries to their registries.
- No `eval`, no `new Function`, no running code from figures or files.
- No `console` in package code.
- Determinism: no wall clock and no unseeded randomness in the kernel.
- Explicit state: a part's states live in one field changed through a `*_MACHINE` table (`StateMachine` or `transition` from `@incantly/kernel`), never in several flags that must agree. Write the machine in `docs/state-machines.md` before the code.

## Rules are checked by code

- A rule is not done until code checks it: a lint rule in `tools/eslint-rules/` (the `incantly` plugin in `eslint.config.js`), a check in `tools/check-repo.mjs`, or a test. `npm run lint` runs both.
- Fix every lint error; never turn a rule off in a file to get past it. Every rule is an error in every package.
- Flags that must agree become one state field over a `*_MACHINE` table. A table whose rows are all the same refuses nothing (`state-table-refuses`): write only the moves that may happen, or derive the state from the data when any state may follow any other. Marks that do not depend on each other (cache marks, facts a pass found, what a call is doing) go together in one named `readonly` record (`this.layers.bgDirty`), never as loose boolean fields.
- A nullable field (`X | null`) that a method sets when its machine begins is part of the state (`state-no-shadow-null`): clear it when the machine leaves the state, or keep it in the state's data, so the field and the machine cannot disagree.
- A module's object is shared by everyone who imports it, so nobody writes into one they imported (`no-imported-mutation`: no `x.y = …`, `x.y++` or `Object.assign(x, …)` on an imported name); the owner of a registry gives a function that writes it (`registerProperty`, `registerFields`), and a thing that differs between two apps, such as the frame style, is held by each app and passed in.
- A state machine in `packages/board`, `packages/tiptap` and `tools` is made with its third argument, `onRefused` (`state-refusal-reported`), so a refused move is reported (the board through its `onError` as `internal`, Tiptap through `reportError`), never silent; a call that may come in any state asks `can` first.
- Only what a package's entry points reach is its boundary (`no-throw-export`). A package's inner engine that unwinds with exceptions sits behind an internal entry (`incantly.internal` in its package.json, such as `@incantly/symbolic/engine`), which only its own tests and benches may import. A wrong argument type may throw `TypeError` (a programming error, embed-files-export design).
- The rules: `state-no-flag-soup`, `state-transition-only`, `state-union-type`, `state-table-required`, `state-table-refuses`, `state-no-stale-after-await`, `state-no-shadow-null`, `state-refusal-reported`, `no-imported-mutation`, `allowed-imports` (from `docs/design/libraries.md`), `no-throw-export`, `no-ai-credit`, DOM-free globals and `Math.random`, and core folders that may not import a web or GPU layer. The repository check: no name of the reference app, a spec for every package with code, `.kiro` never ignored.

## Tests

- Builders write no tests. Testers write all tests, in `packages/<pkg>/test/spec/`, from the docs and the public API only.
- Benchmarks go in `packages/<pkg>/bench/` and use the targets in `docs/design/performance.md`.
- A change is done when `npm run lint`, `npm run typecheck` and `npm test` pass.

## Branches

- Each area builds on its own branch, `feat/<area>`, cut from `integration`.
- A finished area merges into `integration`. `integration` merges into `main` once, with the product owner's go-ahead.
- Never push to `main`. Never force-push. Commit only files in your area.

## Attribution

- Never credit Claude, Anthropic or any AI assistant in commits, PRs, issues, code, packages or release notes: no co-author trailers, no "generated with" lines.
- Two exceptions, for the hackathon submission: `.kiro/steering/kiro-usage-log.md` records how Kiro was used, and the README may say the project was built with Kiro.

## Hackathon rules

`.kiro/steering/hackathon-rules.md` applies to every task. In short: `.kiro/` stays at the repository root and is never ignored; every feature starts as a spec in `.kiro/specs/<feature>/` (`requirements.md`, `design.md`, `tasks.md`) before code; no third-party trademarks or copyrighted material without permission; only SDKs, APIs and data we are licensed to use.
