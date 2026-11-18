# Plan: the cloth and liquid hot loops in Rust (design 11.6, task 10.9)

Written by the planner for the builder. The product owner approved Rust for this on 2026-11-18 (finding PH-6: cloth in
water 10.2 ms against 8 ms in Chrome with the CPU 4× slower). Docs: `docs/features/physics/design.md` 11.2, 11.6,
10 (exact films); `docs/research/physics-papers.md` 4, 8; `AGENTS.md`.

## The shape of it

Design 11.6 asks for one `step()` call a step. The planner changed that to **hot loops in Rust, called from the
TypeScript step**, because the TypeScript step reads bodies, solids, the smoke flow and the liquid through many hooks;
moving all of it would move most of the physics. Each call works on whole arrays (thousands of points), so the cost of
a call (tens of nanoseconds) is nothing. Write this change into design 11.6 ("As built").

| Part | Language |
|---|---|
| The step's order, pins, grabs, body coupling, slow links, tearing, sleep, checkpoints | TypeScript, unchanged |
| The arrays the loops read and write | live in the WebAssembly memory; TypeScript keeps `Float64Array` / `Int32Array` views on it |
| The hot loops (list below) | Rust, `#![no_std]`, no crates, compiled to `wasm32-unknown-unknown` |
| The same loops in TypeScript | stay, as the fallback and the reference |

Profiles on integration `8677d89` (`node --cpu-prof` on `$KIROCREW_SCRATCH/prof/probe.ts`, summed by `top.mjs`):

| Scene | Top costs |
|---|---|
| wet | `pairsHashed` 15%, `solveLinks` 12%, `prepareDrops` 10%, `solveTethers` 9%, `faceTable` 5%, grid `build` + `slotOf` + `inBox` 9% |
| two | `solveLinks` 33%, `airForces` 10%, `prepareSelf` 9%, `solveTethers` 9%, `speedsAdvance` 5% |
| over40 | `solveLinks` 21%, `hitHull` 18%, `hullPlanes` 4%, `pushOut` 3% |
| sheet32 | `solveLinks` 18%, `hitSphere` 5%, `collide` 4% |

## The loops to port (round 1)

| TypeScript | File | Rust export |
|---|---|---|
| `solveLinks` (the fast loop only; links with `q < 0` stay in TypeScript, as now after the loop) | `physics/cloth.ts` | `solve_links` |
| `solveTethers` | `physics/cloth.ts` | `solve_tethers` |
| `advance`, `speedsAdvance`, `speeds` | `physics/cloth.ts` | `advance`, `speeds_advance`, `speeds` |
| `solveChain` | `physics/cloth.ts` | `solve_chain` (the pinned-point part, `pinForce`, returns through an output array the TypeScript adds up) |
| `airForces` | `physics/cloth.ts` | `air_forces` |
| `NeighbourGrid3.build`, `slotOf`, `pairsHashed`, `inBox` | `physics/grid3.ts` | `grid_build`, `grid_pairs`, `grid_in_box` |
| `hitHull`'s test over the candidate list of one hull, writing the hits (point, normal, depth) to an output list; `pushOut` stays in TypeScript and runs on the hits in the same order | `physics/cloth3.ts` | `hull_hits` |

Round 2 (only if the Chrome table still misses a goal after round 1): `prepareSelf` tiles, `prepareDrops` /
`faceTable`, `hitSphere`. Do not start round 2 in this job; list it in builder notes with the numbers.

## Exact films (the hard rule)

The Rust loops must give **the same bits** as the TypeScript loops, so a film is the same with or without
WebAssembly, on every computer.

- Same operations in the same order: copy each loop line by line. Keep every `(a + b) + c` grouping as written.
- `f64` only. No `mul_add`, no fused anything (WebAssembly has no FMA by default; do not enable `relaxed-simd`).
- Square root: `core::arch::wasm32::f64_sqrt` (the `f64.sqrt` instruction, correctly rounded like `Math.sqrt`).
- No SIMD in round 1. No `-C target-cpu`, no fast-math flags.
- Integer indexes as `i32`/`u32` like the typed arrays; read the typed arrays' bytes as the same types.
- A hash test proves it (below).

## The crate

- `packages/kernel/wasm/Cargo.toml` (`[lib] crate-type = ["cdylib"]`; `[profile.release]` `opt-level = 3`,
  `lto = true`, `codegen-units = 1`, `panic = "abort"`, `debug = false`) and `packages/kernel/wasm/src/lib.rs`
  (`#![no_std]`, a `#[panic_handler]` that loops, `#[no_mangle] pub unsafe extern "C" fn …`). No dependencies.
- Exports take byte offsets into the memory (`*mut f64`, `*const i32`) and counts. No allocator in Rust.
- Memory: exported by the module; TypeScript grows it.
- `packages/kernel/wasm/build.mjs`: runs
  `cargo build --release --target wasm32-unknown-unknown --manifest-path packages/kernel/wasm/Cargo.toml`
  with `CARGO_TARGET_DIR` under `packages/kernel/wasm/target`, then writes
  `packages/kernel/src/physics/wasm/kernels-wasm.ts`: a header comment (what it is, how to rebuild, the SHA-256 of
  the bytes) and `export const KERNELS_WASM_BASE64 = '…'`. Commit that file; the repository and CI need no Rust.
- Add `packages/kernel/wasm/target/` to `.gitignore` (nothing under `.kiro` is ever ignored).
- Root `package.json` script: `"build:wasm": "node packages/kernel/wasm/build.mjs"`.

## The TypeScript side

- `packages/kernel/src/physics/wasm/kernels.ts`:
  - `loadKernels(): Kernels | undefined` compiles the module once (`new WebAssembly.Module(bytes)`, synchronous; the
    module is small) and caches it; `undefined` when `WebAssembly` is missing or compiling fails (no throw across the
    package, `AGENTS.md`).
  - `class KernelArena` — one instance of the module per `ClothSet` (and one per liquid grid): `alloc(kind, n)` hands
    out aligned regions; after all regions are asked for, `seal()` grows the memory once and makes the views. Views
    are made once and never again during steps (no growth in a step, so views never go stale).
  - `setPhysicsKernels(on: boolean)` — a switch for tests and the hash check (default on). Export it from the kernel's
    `src/index.ts`.
- `ClothSet`: when kernels load, its arrays that the ported loops touch are views into its arena; else plain typed
  arrays as now. Every place that replaces one of those arrays later (search `= new Float64Array`, `F()`, `roomDrops`,
  `beginSub`, checkpoint `load`) must keep using the arena: size those arrays for the cloth's limits at build time
  instead of growing them. The ported methods call the Rust export when there is one, else run their TypeScript loop.
- `NeighbourGrid3`: the same, with its own arena, sized for the 2,000-drop and 4,096-point limits (design 11.3).
- `core` rule: the kernel has no DOM, timers or network. `WebAssembly` is a language global, allowed. No `eval`.

## Checks (the builder runs them; the tester writes spec tests after)

1. All physics tests pass with kernels on, and again with `setPhysicsKernels(false)`:
   `npx vitest run packages/kernel/test/spec/physics packages/sdk/test/spec/physics apps/studio/test/physics.test.ts`.
   (Add a tiny local switch for the second run, for example an env read in a scratch probe; do not add tests.)
2. A probe in `$KIROCREW_SCRATCH/prof/` plays the seven scenes of `probe.ts` for 10 s with kernels on and off and
   compares the world hash every second: all equal.
3. Node bench rows (`-t "cloth"` and the 3D liquid rows) before and after.
4. Chrome with the CPU 4× slower: `PLAYWRIGHT_DIR=$KIROCREW_SCRATCH/pw node packages/kernel/bench/chrome-physics.mjs`
   before and after (the page must load the kernels; check it does).
5. `npm run lint`, `npm run typecheck`.

## Where

- Branch `feat/physics-rust` (already created from integration and checked out). Never push to `main` or
  `integration`. Never chain `git push` after other commands in one shell call.
- Your files: `packages/kernel/wasm/**`, `packages/kernel/src/physics/wasm/**`, `physics/cloth.ts`, `cloth3.ts`,
  `grid3.ts`, `fluid3.ts` (only arena wiring), `packages/kernel/src/index.ts` (one export), root `package.json` (one
  script), `.gitignore` (one line), `docs/features/physics/design.md` 11.6 ("As built") and 11.2 (measured note),
  `docs/design/libraries.md` (a short "Build tools" note: the Rust toolchain builds `kernels-wasm.ts`; no crates),
  `.kiro/specs/physics/tasks.md` (add and tick `10.9 Rust kernels`), `.kiro/steering/kiro-usage-log.md`,
  `handoff/physics/builder-notes.md` (section "10.9 Rust kernels").
- You write no tests.
- `TMPDIR=$KIROCREW_SCRATCH/tmp`. No heredocs or python to write files.

## Done

Commit (no AI credit lines), push `feat/physics-rust` as its own command, open a draft PR to `integration`
("feat(physics): cloth and liquid hot loops in Rust (WebAssembly)"). Reply with: the PR link, the commits, the hash
check result, the Node and Chrome tables before and after, the wasm size, and what is left for round 2.
