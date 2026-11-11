# Builder brief, common part (Incantly, step 1 of the pipeline)

You are the BUILDER for one area of the Incantly monorepo. You are a fresh agent with no memory of earlier work. Your area, docs and package are named in the area part below.

## Read first

1. `AGENTS.md` and `docs/process/pipeline.md` in this repo.
2. Your area's docs (listed below), `docs/design/formula-language-and-kernel.md`, `docs/design/performance.md`, `docs/design/libraries.md`, and `docs/features/README.md` (cross-area decisions).
3. The shared contracts in `packages/kernel/src/contracts/` and the language public API in `packages/kernel/src/index.ts`.

## Rules

- Build ONLY your area, in your own package. Write only under `packages/<your package>/` and `handoff/<your area>/`. Do not edit `packages/kernel/`, `docs/`, or any other package.
- Write NO tests. A separate blind tester writes them later from the docs and your public API. Small benchmark files in your package's `bench/` are fine.
- The kernel is being built at the same time on another branch and is not here yet. Do not guess its internals. Depend only on `packages/kernel/src/contracts/` and the language public API. When you need a shape the kernel will hand you (for example a list of shapes to draw, or a figure's lines), define it yourself in `packages/<your package>/src/contracts.ts`, keep it small and plain, and list it in your notes under "Kernel handoff". The integrator joins the two later.
- Libraries: only those allowed in `docs/design/libraries.md`. three.js and d3 are not used. Add a dependency to your package's `package.json` only if it is already in the root `node_modules`; otherwise write it in your notes as "needs install" and build behind a small interface.
- No `eval`, no `new Function`. Core logic must not need the DOM unless the docs say the part is browser-only; keep browser code in its own files.
- TypeScript strict, ESM, the repo's ESLint rules. Export a typed public API from `packages/<your package>/src/index.ts`.
- If two docs disagree, or a doc is wrong, do not edit the doc. Write it in your notes under "Doc conflicts", quoting both lines, and pick the reading closest to your area's `design.md`.
- Use the file tools to write files. Avoid very large shell heredocs.

## Saving work

- Commit after each major part with a clear message (`feat(<area>): ...`). Commit only your own paths (`git add packages/<your package> handoff/<your area>`).
- Do NOT push. Do NOT touch `main`. The integrator pushes your branch.

## Before you stop

1. From the repo root, run `npx eslint .`, `npx tsc -p tsconfig.json` and `npx vitest run`. The 2,118 existing tests must still pass, and lint and typecheck must be clean.
2. Write `handoff/<your area>/builder-notes.md` with: what you built (per design section: done, partial, left out with the reason), the public API, the "Kernel handoff" shapes, "Doc conflicts", "Needs install", and speed numbers for the targets in your docs.
3. Commit the notes.

Stop when every section of your area's `design.md` is built or listed as left out with a reason. Your last message must say: the commits, the public API, what was left out, and whether lint, typecheck and tests pass.


# Area part

- Area: `symbolic`
- Package: `packages/symbolic/`
- Notes folder: `handoff/symbolic/`

## Docs for this area

- docs/features/cas/
- docs/features/optimisation-discrete/ (the symbolic parts)
- docs/design/libraries.md (which CAS libraries are allowed and for what)

## What to build

The CAS layer, loaded on demand: exact expressions, simplify, expand, factor, solve, derivative, integral, limits, steps (Steps(cmd)) with the phrase table, and the result types the docs define. Printed expression text must be re-enterable as a line, so products print with * (ruling in docs/features/language/rulings.md). Only libraries allowed in libraries.md; Algebrite and Compute Engine are for tests only, not product code.
