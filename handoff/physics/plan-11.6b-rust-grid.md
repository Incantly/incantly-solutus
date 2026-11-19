# Plan: the grid in space in Rust (design 11.6, finding PH-35)

Written by the planner for the builder. The product owner approved Rust for every solver that the 11.6 rule picks;
PH-35 picks the grid in space. Docs: `docs/features/physics/design.md` 9.8 (as built), 10, 11.2, 11.6 (as built,
round 1); `handoff/physics/plan-11.6-rust-kernels.md` and `builder-notes.md` 10.9 (how round 1 was done, and what
worked); `handoff/physics/findings.md` PH-8, PH-15, PH-35.

## Numbers to beat (from 11B, integration `650e922`)

| Row | Goal Node / Chrome 4× | Now |
|---|---|---|
| Fire 24³ | 2 / 8 ms | 4.0 / 15.5 |
| Fire 32³ | 4 / 8 ms | 9.1 / 35.3 |
| Flag over a fire 24³ | 2.5 / 8 ms | 5.1 / 20.7 |
| Seek in a 60 s film, warm | 120 ms Node | 128 median, 300 worst |

A grid step is about 3.7 ms in Node at 24³; the 20 pressure passes are 1.3 to 1.5 ms of it.

## What moves to Rust

The per-cell loops of `Smoke3` (`physics/smoke3.ts`) and of the fire step (`physics/fire3.ts`), each as one export
that works on the whole grid:

| TypeScript | Rust export |
|---|---|
| `advectFlow` (trilinear back-tracing of `u`, `v`, `w`) | `grid3_advect_flow` |
| `lift` | `grid3_lift` |
| the swirl force | `grid3_swirl` |
| the fire cells: burn, source, cool, water (`fire3.ts`) | `grid3_fire` (water drops' cells passed as a list) |
| `solidFaces` (faces take the solid's speed) | `grid3_solid_faces` (the speeds per solid passed as arrays) |
| `divergence`, `project` (the 20 red-black passes and the gradient) | `grid3_divergence`, `grid3_project` |
| `advectSmoke` (`s`, `T`, `F`) and `outflow` | `grid3_advect_scalars`, `grid3_outflow` |

Stays in TypeScript: marking solids (`markSolids` and its helpers), `drag`, `applyImpulses`, `checkHealth`, `flowAt`
(called per cloth point), `save` / `load`, burnable things (`burn3.ts`), the order of the step.

## Exact films

Same rules as round 1 (copy each loop line by line; f64 arithmetic; no FMA; `f64::sqrt`, `floor`). The grid's values
are `Float32Array`: read an `f32`, widen to `f64`, compute, store with `as f32` (round to nearest, ties to even: the
same as a `Float32Array` store in JavaScript). The hash tests must stay equal with kernels on and off.

**SIMD is allowed in this job** (`-C target-feature=+simd128`, `core::arch::wasm32` `f64x2_*`), but only where each lane
does exactly the scalar operations of one cell and no lane reads a value another lane writes in the same pass: the
red-black pressure passes (cells of one colour are independent), the gradient, `lift`, and the advection loops (each
cell reads the old arrays and writes the new one). No horizontal sums: any reduction (the outflow sum, mass) stays
scalar in index order. If SIMD changes a single bit in the hash check, drop it for that loop. Build the module twice
(scalar, SIMD) once to prove the hash is equal, then keep SIMD. A browser without SIMD (old Safari): the module fails to
compile, the TypeScript loops run, the film is the same (check `loadKernels` handles it; if the arena is shared with
the cloth kernels, compile a separate SIMD module for the grid so cloth still uses scalar Rust there).

## Wiring

- `Smoke3` takes its arrays from a `KernelArena` sized for `n` at build (`u`, `v`, `w`, `s`, `T`, `F`, `p` and their
  scratch copies, the solid marks, the source cells, the per-solid speeds), as `ClothSet` does; plain typed arrays
  when the kernels are off or missing.
- Numbers go through the arena's parameter block, never as call arguments (PH-8).
- No memory made in a step: the "no garbage" bench rows must pass (add one for a 24³ fire grid on the pattern of the
  others: `gc()` before counting, kernels on and off).
- `physicsKernelsActive(figure)` must also report the grid (true when the grid uses Rust).

## Checks

1. Hash check: the space fire scenes (fire 24³, 32³, flag over a fire, burning crate, smoke round a ball, a liquid
   dousing a fire), 10 s each, kernels on and off: equal every second.
2. The physics set: `npx vitest run packages/kernel/test/spec/physics packages/sdk/test/spec/physics apps/studio/test/physics.test.ts apps/studio/test/space.test.ts`.
3. Node bench rows and the Chrome page (`PLAYWRIGHT_DIR=$KIROCREW_SCRATCH/pw node packages/kernel/bench/chrome-physics.mjs`),
   before and after.
4. If the 24³ Chrome row is still over 8 ms after the port, profile the Rust module (Chrome's profiler shows wasm
   functions) and list the next steps in builder notes; do not change the algorithm (pass count, grid size) without
   the planner.

## Where

- Branch `feat/physics-rust-grid`, already created from integration and checked out. Never push to `main` or
  `integration`; never chain `git push` after other commands in one shell call.
- Files: `packages/kernel/wasm/**`, `packages/kernel/src/physics/wasm/**`, `physics/smoke3.ts`, `physics/fire3.ts`,
  `packages/kernel/bench/**`, design 11.6 ("As built, round 2") and 11.2 (measured note), tasks (add and tick 10.10),
  usage log, builder notes (section "10.10 Rust grid").
- Another agent works in a separate worktree on garbage in `driver3.ts`, `world3.ts`, `fluid3.ts`: do not edit those.
- You write no tests. `TMPDIR=$KIROCREW_SCRATCH/tmp`. No heredocs or python to write files.

## Done

Commit (no AI credit lines), push as its own command, open a draft PR to `integration`
("perf(physics): the grid in space in Rust (WebAssembly)"). Reply: PR link, commits, hash check result, scalar vs SIMD
hash equality, Node and Chrome tables before and after, wasm size, anything left.
