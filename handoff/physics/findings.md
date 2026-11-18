# Physics: findings

The checker's bugs, ranked by harm. Each review gets one round of fixes. A bug found after that round is added here
with `status: to be implemented` and fixed in a later batch; it does not hold up the merge.

| Id | Found | Where | What | How to see it | Harm | Status |
|---|---|---|---|---|---|---|
| PH-1 | 2026-11-18 | `packages/kernel/bench/` (3D liquid) | The 3D liquid bench is 1.52 ms against a 1.5 ms budget in Node; the same on integration before the soft step | `npx vitest run --config packages/kernel/bench/vitest.config.ts packages/kernel/bench/physics.bench.ts -t "3D liquid"` | low | to be implemented |

## Review of 9.8 cloth finish (2026-11-18, one round)

Read: the builder's diff `d4822ea..1f3d8d8` (`cloth.ts`), builder notes, `test-report.md` 9.8.

| Id | Where | What | Evidence | Harm | Status |
|---|---|---|---|---|---|
| PH-2 | `cloth.ts` `substep` steps 3 and 4, `endSub`; `cloth3.ts`, `cloth2.ts` | A body held by cloth pins ignores its own world contacts during the cloth's small steps. The pin moves (`spx += dx·im/wb`) and the body tether can push it into the ground inside the step; `endSub` writes that back, and the world's soft contact pushes it out at up to 3 m/s next step, so it bounces and gains energy. | Tester F1 and F2: a 0.5 m ball resting on `Ground()`, pinned at its top under a flat sheet held by its corners: 4.8 cm into the ground after one frame, then −0.70 to 2.85 m; at `stretch = 1` it blows up at 2.22 s. A 0.3 m ball pinned 0.7 m under the sheet (no touch) sinks only 1.6 mm. | high | fixed (c419a07) |
| PH-3 | `cloth.ts` `buildBodyTethers` | On a sheet at `stretch = 1` the body tether's length is exactly the start distance, so a body resting where it started sits at the limit of every corner's tether at once and each small step projects it between them. | Builder notes T2 ("over-constrained"); tester F2. | medium | fixed (c419a07) |
| PH-4 | `apps/studio/src/examples.ts` `hammock` | The hammock's ball (not pinned) keeps bouncing for 10 s, the same before this work. | Builder notes T2. | low | to be implemented |
| PH-5 | `cloth.ts` (damping) | A ball pinned under a corner-held sheet still moves 14 mm/s at 3 s with the default damping (the sheet rings); at rest by 6 to 10 s. | Builder notes T2. | low | to be implemented |
| PH-6 | cloth speed | Over budget after 9.8: Node 32 × 32 sheet 0.78 (0.75), two cloths 2.29 (2), cloth in water 2.30 (2), over 40 bodies 95% 2.33 (2); Chrome 4× slower: sheet32 3.45 (3), over40 8.02 (8), self 8.71 (8), two 9.85 (8), wet 10.21 (8). By the 11.6 rule (mean more than 25% over) only `wet` qualifies for Rust (128%). | Builder notes, design 11.2 "Measured (round 9 finish)". | medium | to be implemented (round 10; Rust needs the product owner's approval) |

Found while fixing (after the review, so not fixed in this round):

| Id | Where | What | Evidence | Harm | Status |
|---|---|---|---|---|---|
| PH-7 | `cloth3.ts`, `cloth.ts` `save` / `load`, `world3.ts` | Seeking back and forth gives another film than playing, by 1e-16 to 1e-11, for a sheet with a body pin in space. The same on the commit before the fixes (`36a213b`). Something the next step reads is not in the checkpoint. | A 3 × 3 m sheet of 28 × 28 points held by its corners with a 3 kg ball pinned under it on `Ground()`: sought 2.3 s, then 0.7 s, then forward frame by frame, the ball's z differs from the played film from frame 43 (0.39998846266045 against 0.39998846266045396). Sought straight from 0 it equals playing. | medium | to be implemented |

**Fixes for PH-2 and PH-3** (the one fix round; what was built differs from the list below in three places, see "As built"):

- PH-2: at the end of the cloth's small steps (`endSub`), before `setBody`, keep a pinned body out of its contacts.
  Add a hook (`protected keepOut(b, out)`, a no-op in `ClothSet`) that `cloth3.ts` and `cloth2.ts` implement with the
  world's touching contacts of body `b` against fixed shapes, the ground and terrain: for each contact normal `n` (out
  of the fixed shape, into the body), if the cloth's move of the body this step (end place − the world's end place)
  has `Δ·n < 0`, take that part out of `Δ`; if the speed has `v·n < 0`, take that part out of `v`. Use the contacts
  the world found this step (no new narrow phase). Do it in figure order of contacts, fixed.
- PH-3: a sheet's or net's body tether is `start distance × max(slack, 1.02)` (2%, the stretch every check allows);
  a rope's stays the sum of its rest lengths. Change design 9.5 "A body's tether" to say so.

**As built** (commit `c419a07`; the fixer measured each point):

- PH-2: `keepOut` is a hook of `ClothSet` (a no-op there) that `cloth3.ts` and `cloth2.ts` pass to `World3.keepOut` and `World2.keepOut`, which walk the world's touching contacts of the body against fixed shapes (any other body that is not dynamic, so the ground, terrain, static and kinematic bodies) in the world's order. It runs in two places: in `endSub` (the cloth's move and speed of a body that took the small steps) and in `keepFixed`, once at the end of the cloth's step (the move `bdx` and the push `bj` that the world applies at the next step; the part into the ground is taken out of the move, and out of the body's speed now). The second place is needed: the tester's ball was driven into the ground by held points pushing it as a wall (`give` with `dt = h`: 6 cm and 38 m/s in one step), not by the pin. It is at the end of the cloth's step, not in `applyImpulses`, because after a seek the world has no contact list until it steps.
- PH-3: the fix as listed (the body tether of a sheet at `start distance × 1.02`) made the tester's two failing tests worse (the ball was lost at 0.65 s instead of 0.0 s) and breaks the "body's tether" tests (a ball on a sheet reached 1.0200 to 1.0204 of the start distance, the test allows less than 1.02): a ball that may wander 4 cm along the ground rolls off its pin. What fixes it is the 2% of play on the sheet's point tethers, and only for a sheet or net that holds a body (`max(1 + 2 (1 − stretch), 1.02)`; a rope and a sheet with no body pin keep theirs, or the hanging-sheet check of 2% on its links and the pinned-ball weight check break). The body's own tether stays `start distance × (1 + 2 (1 − stretch))`. Design 9.5 says so.

## Review of 10.9 Rust kernels (2026-11-18, one round)

Read: the builder's diff `36a31ee..f124249` (crate, `kernels.ts`, cloth, grid and hull wiring), builder notes, the tester's
report. Ran the "no garbage" bench.

| Id | Where | What | Evidence | Harm | Status |
|---|---|---|---|---|---|
| PH-8 | `physics/wasm/kernels.ts`, the wiring in `cloth.ts`, `grid3.ts` | With kernels on, cloth steps make garbage: the bench "Cloth, no garbage" fails (design 11.4). | `npx vitest run --config packages/kernel/bench/vitest.config.ts packages/kernel/bench/physics.bench.ts -t "no garbage"`: 3 collections in 2,000 steps (0 with kernels off). | high | partly fixed (05aee97), see PH-14 |
| PH-9 | `packages/sdk` (createApp, headless app, worker start), `apps/studio` start | Nothing calls `initPhysicsKernels()`, so in a browser the page's own physics (no worker, the SDK on the page) always uses the TypeScript loops. Only the worker can compile synchronously. | Builder notes, "Main-thread compile". | medium | fixed (05aee97) |
| PH-10 | `kernels.ts`, the kernel's public API | No public way to tell whether a solver uses the Rust loops, so a module that silently fails to load passes every test. | Tester report 10.9. | medium | fixed (05aee97) |
| PH-11 | `packages/kernel/wasm/build.mjs`, `kernels-wasm.ts` | CI has no Rust, so nothing notices when `lib.rs` changes and the committed `kernels-wasm.ts` is not rebuilt. | By reading. | medium | fixed (05aee97) |
| PH-12 | rope with kernels | The rope's worst frame in Chrome is 5 ms with Rust against 2.9 ms without, in all 3 runs. | Builder notes. | low | to be implemented |
| PH-13 | round 2 | Still over goal in Chrome 4× slower: cloth in water 9.11 (8), 32 × 32 on a ball 3.13 (3), self 8.00 (8). Round 2 list: `prepareDrops`/`faceTable`, `prepareSelf` and batched `grid_in_box`, `hitSphere`, link layout or SIMD. | Builder notes. | medium | to be implemented (replaces the cloth part of PH-6) |
| PH-14 | `packages/kernel/bench/physics.bench.ts` "Cloth, no garbage" | The row counts collections in a window that starts wherever V8's young generation happens to be. With the kernels on it fails in about half of the runs (0, 3, 0, 0, 0, 3, 1, 3, 1, 3, 0, 0 collections in 12 runs, after the fix of PH-8), with them off in none of 20, yet the sheet makes no garbage that fills it: with one `gc()` before the observer starts, 10 runs in 10 show 0 collections. | New space at the start of the window, printed in the row's own setup: 29 to 31 MB of 32 in the failing runs (a collection follows at the first idle moment, the row's `await` of 50 ms, or inside the loop), 9 MB in the passing ones. The first frames (the sheet's construction, 9 MB, and the engine's first runs of every loop) put 16.5 MB in the young generation with the kernels on and, estimated, about 25 MB with the loops in TypeScript (their first runs make more garbage): the TypeScript run wraps round the 32 MB to a low fill, the Rust run lands near the top. | medium | to be implemented (tester: start Node with `--expose-gc` in `packages/kernel/bench/vitest.config.ts` and call `gc()` before `obs.observe`, or warm up for 600 frames; the row is the tester's file) |
| PH-15 | `cloth.ts` steps, both modes | About 110 bytes of garbage a step remain with the kernels on and off (sampling heap profile over 3,000 steps after 8,000: `sizeBodies` 40 B, the step's own boxed `h` 24 B, `stepCloth` 17 B, `prepLinks` 16 B). Not enough to fill the young generation in 2,000 steps (0.2 MB), but design 11.4 says none. | `HeapProfiler.startSampling` with minor collections included. | low | to be implemented |

**Fixes for PH-8 to PH-11** (the one fix round):

- PH-8: find what allocates per step with kernels on (`--trace-gc`, or a heap profile over 2,000 steps after warm-up;
  likely a typed-array view, a closure, or a boxed number at a call). Fix it so the bench shows 0 collections; the bench
  is not changed.
- PH-9: call `initPhysicsKernels()` once (not awaited by anything that changes a film) in the SDK's app start
  (`createApp` and the headless app) and in the studio's start; a solver built before it resolves uses the TypeScript
  loops and the film is the same. One line in design 11.6.
- PH-10: export `physicsKernelsActive(figure): boolean | undefined` from the kernel (true when the figure's cloth or
  liquid solver runs the Rust loops; undefined with no such solver), and show it in the studio's physics readout as
  "Rust" or "TypeScript". Regression test: in Node a 3D sheet's figure reports `true`; with `setPhysicsKernels(false)`
  it reports `false`.
- PH-11: `build.mjs` writes into the header of `kernels-wasm.ts` a SHA-256 of `lib.rs`, `Cargo.toml` and `Cargo.lock`
  (the sources). Regression test: it hashes those three files and expects the header's value, with a message that
  says to run `npm run build:wasm`.

**As fixed (fix round, commit 05aee97):**

- PH-8: what allocated, found with a sampling heap profile (minor collections included) and `v8.getHeapSpaceStatistics` for the young generation. (1) `stepCloth` made three typed-array views a step (`x.subarray(0, n)` to copy the start-of-step places): about 300 bytes a step in both modes; the arrays hold exactly `n` points, so `sx.set(this.x)` does it. (2) With the loops in Rust, `advance`, `speedsAdvance` and `speeds` kept only a call and a few products (`hs * this.gx`, the speeds' factor with its `Math.min`/`Math.max`): too few calls to be optimised soon, and until then every product is a heap number (about 250 KB over the first 700 steps, on top of the TypeScript run's own). The Rust loops now take the raw inputs from the block (`KP.gx`, `KP.damp`) and work out `hs * gx` and the factor themselves, the same operations in the same order (the hash tests are unchanged and pass). With both in, the young generation grows by the same 110 bytes a step as with the kernels off (PH-15). The bench row still fails about half of the runs for a reason outside the solver (PH-14): with a `gc()` before its observer, 10 runs in 10 show 0 collections.
- PH-9: `createHeadlessApp` (which `createApp` starts through) and the studio's `main.ts` call `initPhysicsKernels()` once, not awaited; it now keeps one compile in flight however many apps start. Design 11.6 "Main thread" says so.
- PH-10: `physicsKernelsActive(figure)` (kernel index) over `ClothSet.usesKernels` and `Fluid3.usesKernels`; the studio's readout ends with "Rust" or "TypeScript" (for a world in the worker, `info.kernels` of the worker's reply). Four regression tests in `physics-kernels.test.ts`.
- PH-11: `build.mjs` writes the SHA-256 of the three sources into the header of `kernels-wasm.ts`; one regression test hashes them and compares.
