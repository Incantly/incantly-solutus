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
| PH-8 | `physics/wasm/kernels.ts`, the wiring in `cloth.ts`, `grid3.ts` | With kernels on, cloth steps make garbage: the bench "Cloth, no garbage" fails (design 11.4). | `npx vitest run --config packages/kernel/bench/vitest.config.ts packages/kernel/bench/physics.bench.ts -t "no garbage"`: 3 collections in 2,000 steps (0 with kernels off). | high | fixed (27a756e), 20 of 20 runs with the kernels on and 20 of 20 with them off |
| PH-9 | `packages/sdk` (createApp, headless app, worker start), `apps/studio` start | Nothing calls `initPhysicsKernels()`, so in a browser the page's own physics (no worker, the SDK on the page) always uses the TypeScript loops. Only the worker can compile synchronously. | Builder notes, "Main-thread compile". | medium | fixed (05aee97) |
| PH-10 | `kernels.ts`, the kernel's public API | No public way to tell whether a solver uses the Rust loops, so a module that silently fails to load passes every test. | Tester report 10.9. | medium | fixed (05aee97) |
| PH-11 | `packages/kernel/wasm/build.mjs`, `kernels-wasm.ts` | CI has no Rust, so nothing notices when `lib.rs` changes and the committed `kernels-wasm.ts` is not rebuilt. | By reading. | medium | fixed (05aee97) |
| PH-12 | rope with kernels | The rope's worst frame in Chrome is 5 ms with Rust against 2.9 ms without, in all 3 runs. | Builder notes. | low | to be implemented |
| PH-13 | round 2 | Still over goal in Chrome 4× slower: cloth in water 9.11 (8), 32 × 32 on a ball 3.13 (3), self 8.00 (8). Round 2 list: `prepareDrops`/`faceTable`, `prepareSelf` and batched `grid_in_box`, `hitSphere`, link layout or SIMD. | Builder notes. | medium | to be implemented (replaces the cloth part of PH-6) |
| PH-14 | `packages/kernel/bench/physics.bench.ts` "Cloth, no garbage" | The row counts collections in a window that starts wherever V8's young generation happens to be. With the kernels on it fails in about half of the runs (0, 3, 0, 0, 0, 3, 1, 3, 1, 3, 0, 0 collections in 12 runs, after the fix of PH-8), with them off in none of 20, yet the sheet makes no garbage that fills it: with one `gc()` before the observer starts, 10 runs in 10 show 0 collections. | New space at the start of the window, printed in the row's own setup: 29 to 31 MB of 32 in the failing runs (a collection follows at the first idle moment, the row's `await` of 50 ms, or inside the loop), 9 MB in the passing ones. The first frames (the sheet's construction, 9 MB, and the engine's first runs of every loop) put 16.5 MB in the young generation with the kernels on and, estimated, about 25 MB with the loops in TypeScript (their first runs make more garbage): the TypeScript run wraps round the 32 MB to a low fill, the Rust run lands near the top. | medium | fixed (27a756e) |
| PH-15 | `cloth.ts` steps, both modes | About 110 bytes of garbage a step remain with the kernels on and off (sampling heap profile over 3,000 steps after 8,000: `sizeBodies` 40 B, the step's own boxed `h` 24 B, `stepCloth` 17 B, `prepLinks` 16 B). Not enough to fill the young generation in 2,000 steps (0.2 MB), but design 11.4 says none. | `HeapProfiler.startSampling` with minor collections included. | low | fixed (27a756e) |
| PH-24 | `fluid3.ts` `step`, `densityPass` | Found while profiling PH-15 (the 2,000-drop sheet): the 3D liquid's own step makes about 85 B a step in both modes (`step` 66 to 69 B, `densityPass` 17 B, and when drops leave the world `ps.compact((i) => …)` makes a closure and `Math.abs` a call, 24 B each). It is not a cloth step, so PH-15 leaves it. | Same profile, `Fluid3.step` called as the driver does, 3,000 steps. | low | fixed (0e6febd, b58ed02), the bench rows pass 10 of 10 and 12 of 12 |
| PH-25 | the drivers' frame (`driver3.ts`, `driver.ts`, `world3.ts`, `core.ts`) | A frame played through `setClock` (a 64 × 32 flag, kernels on) makes about 17 KB per step: iterators (`next` 3.9 to 4.5 KB), `writeCloth` 1.9 KB (three new arrays a frame for the readout), `world3.step` 1.2 KB, `flush` 1.2 KB, `beginSoft` 0.6 KB, `islands` 0.5 KB, `signature` 0.5 KB. The cloth's own part is 37 to 57 B a step (the engine's tiers, not a call that makes a number). Not a cloth step. | Same profile, 1,000 frames after 1,500. | low | fixed (505d3f0, f4f3a78, f91fb1f, b58ed02) for the physics parts; what is left is the cells' contract (below) and PH-41 to PH-45 |
| PH-41 | rules that read `t` (`graph/core.ts` `runCommand`, `compute`, `withRandom`; the World command's `run`; `stepInputs`; `saveCells`) | A frame of the 64 × 32 flag with the wind a formula, `world with wind = (5 + 3 sin(2 t), 1, 0)`, makes 13,650 B a frame (kernels on) against about 1,200 B with the wind constant: the language evaluator makes the difference. Not the physics. | `gc2` frame profile, 1,000 frames after 4,000, `flag` against `flagc`. | low | to be implemented |
| PH-42 | `world3.ts` contacts and narrow phase, `driver3.ts` body cell | Space with bodies: a 3D liquid with a ball and a stone makes 28,100 B a frame (kernels on and off): the contact solver and narrow phase (`pts` and objects for each contact, `applyAt`, `gapOf` and `meet` with many double arguments) and the 3D body cell (`pose`, `liveValue`, `stillKey`). The plane's equivalents are fixed (PH-25). | Same profile, scene `liq3`. | low | to be implemented |
| PH-43 | `world2.ts` `updateContacts`, `collide2.ts` `collidePolygons`, `joints2.ts`, `terrain` | About 0.6 KB a frame remains in the plane with contacts and fire: `updateContacts` 0.4 KB, `collidePolygons` 0.2 KB (numbers passed in calls the engine does not inline), the joints' `initVelocity(w, h)` and `solveVelocity(w, h)`, `movePose`'s array literal, the terrain's `found` arrays, `noteJointPairs` (`jointPairs.clear()`). | Same profile, scene `fire`. | low | to be implemented |
| PH-44 | `world2.ts`, `world3.ts`, `cloth.ts`, `fluid2.ts`, `grid2.ts` `save()` | A checkpoint save builds a `number[]` and copies it (a few KB for a small world, 22 KB with 300 bodies); `world2.save` writes the array at its size when there are no joints, and the others do not. The checkpoint itself is the film, kept to seek from, not garbage. About 170 B a frame averaged over the checkpoint spacing. | Same profile, `save` in the plane with joints, in space and for the cloth. | low | to be implemented |
| PH-46 | `smoke3.ts`, `fire3.ts`, `burn3.ts`, `driver3.ts` `stepSmoke`, `stepBurn` | Fire in space after merging 11B with the no-garbage work: a frame of a 24³ fire makes 3,390 B (27,279 B before; the smoke cell with its two arrays written in turn is the contract part), and the same fire with a burning body 57,677 B (88,642 B before; the 3D body cell is PH-42, the rest is the burn step's and the grid step's numbers in calls and the `Map`/`find` in the burn code). `writeSmoke`, `smokeValue3`, the signature and `syncBurntSolids` make nothing beyond the cells. | A frame's heap delta, 120 frames in windows without a checkpoint after 2,500 frames. | low | to be implemented |
| PH-45 | `graph/core.ts` `deliver`, `compute`, `withRandom`, `drivenCell` | What the figure makes in a frame with a listener (every figure has the language's): `deliver` makes a `Set` and an ids array for each round that has changed cells (about 270 B), `withRandom` makes a `Map` for a rule that is run each frame (about 180 B, with `compute` 100 B), `drivenCell` an iterator (about 170 B). | Same profile, scenes `fire` and `liq2s`. | low | to be implemented |

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

**As fixed (the fix round of PH-8, PH-14, PH-15, commit 27a756e):**

- PH-15: what a cloth step made, found with a sampling heap profile (minor collections included; 3,000 steps after 8,000; sampling interval 64 B; the cloth's `step` called as the bench calls it, the drops stepped as the driver does; three windows of 3,000 steps one after the other) and then by profiling with the engine's inlining off, which shows where a number crosses a call. A double passed as an argument or returned from a method that is not inlined is a heap number. (1) The collision code: `pushOut`, `hitSphere`, `hitCircle`, `hitThread`, `hitFace`, `give`, `holdPush`, `bodyWn`, `bodyV`, `bodyArm`, `bodyW`, `faceHeight`, `footOn`, `pushPair`, `inGrid`, `pinForce`, `airAt`, `setBody`, `shiftSpeed`, `bodyInvMass` took and returned doubles, 8 to 10 a call: 131 KB a step for a sheet on a ball, 74 KB for the rope with a ball, 9 KB for the sheet with drops (`prepareDrops`: six doubles to `inGrid`, ten to `pushPair`). They now read and write slots of `ClothSet.ar` (a `Float64Array` of 24, the slots named at each method), the small step and the step's length are the fields `hsub` and `hStep` (a driver sets `hStep`, then calls `stepWorld`/`stepNow`), the links' 1/h² is `linkInv2`, a grid search's box is `NeighbourGrid3.box` (`inBox(n)`: six doubles a call, 96 B a step with a ball), the liquid's masses are read from its `mass` array, a shape's reach is made once a step in `prepare`. (2) The 110 B: `sizeBodies` 40 B and `beginSub` 38 B were the context a closure puts on the heap at each call, even when the closure is not made (a `const F = () => new Float64Array(nb)` behind an early return); now a function at module level. `prepLinks` 16 B was a number read in a method that returns at once on most steps (called once a step, it is not optimised for a long time, and until then reading a double field makes a heap number): the check is in `stepNow`, where the code is optimised, and `prepareSelf` is checked there the same way. `stepCloth` 17 B and the boxed `h` 24 B: `h` went through three calls (`stepCloth` of the driver, `step`, `stepCloth` of the set); now a field. (3) `for … of` and `some` with a function in a step: `keepOut` in both worlds (9 B), the loops over cloths, `clothInputs` (50 B: a closure for `log.some`), the driver's time string made at each step for a notice that comes once. Nothing changes an operation or its order: a hash (SHA-256 of every readout and array, the sign of zero kept) of 12 scenes (sheet on a ball, flag, sheet over boxes, two cloths, sheet with 2,000 drops, a body pinned to a sheet, a sheet that hits itself, a net that tears, a rope with a ball and the others of `physics-kernels.test.ts`) played 8 s with the kernels on and with them off is equal on `efe4cdb` and on this commit, in all 24.
- Bytes a step, the whole profile (everything allocated in the window, the harness's own inspector call included: about 4.5 B in the first window, 0.4 to 0.6 in later ones), `efe4cdb` → this commit, window 1 (the protocol: 3,000 steps after 8,000), and this commit's windows 2 and 3:

  | Scene | Kernels | Before, window 1 | After, window 1 | After, window 2 | After, window 3 |
  |---|---|---|---|---|---|
  | 64 × 32 flag in wind | on | 76.4 | 6.1 | 2.2 | 1.5 |
  | 64 × 32 flag in wind | off | 78.2 | 5.5 | 2.8 | 1.1 |
  | 32 × 32 sheet on a ball | on | 133,486 | 6.3 | 3.2 | 1.7 |
  | 32 × 32 sheet on a ball | off | 133,532 | 6.2 | 2.1 | 2.1 |
  | 64 × 32 sheet, 2,000 drops (the cloth's part; the liquid's own about 90 B is PH-24) | on | 1,112 | 1.8 | 2.2 | 0.3 |
  | 64 × 32 sheet, 2,000 drops (the cloth's part) | off | 1,104 | 1.6 | 3.0 | 0.2 |
  | 2D rope, 400 points, a ball | on | 74,127 | 21.5 | 313 | 1.1 |
  | 2D rope, 400 points, a ball | off | 74,064 | 19.8 | 314 | 0.6 |

  After 8,000 steps the water of the drops scene has poured off the sheet (18 drops left); with 600 steps before the window (674 and 377 drops left) the cloth's part was 9,408 then 3,658 B a step before and 35 then 0 (kernels on), 14 then 23 (off) after. The rope's 313 B in window 2 is one event, not a rate: the engine threw away `hitThread`'s optimised code when the ball first met the rope (about 0.9 MB in all, 3,000 steps) and ran it in the interpreter until it optimised it again; in window 3 the rope makes 0.1 B a step. The 15 to 20 B of its window 1 is the same kind (code of the pinned body's small steps still in a lower tier); a rope with no body and a 3D sheet with one show no such window. Not a cloth step, left to PH-16 and PH-17: the liquid's step (about 90 B) and the driver's frame (about 17 KB).
- PH-14: found with `--trace-gc` and the performance entries of the row. The first guess (a window that starts wherever the young generation is) was true for the kernels-on row: `collectNow()` (a `gc()`, Node started with `--expose-gc` by `vitest.config.ts`, which sets `test.execArgv`) before the observer gave 0 collections in 3 of 3 runs. The kernels-off copy of the row still failed, 2 or 3 collections in each run, with any warm-up (120 to 4,000 steps) and alone it passed: a collection frees the Rust module of the row before, and the optimised code that holds that module goes with it; the first 40 steps of the next row then run in the interpreter and make 26 MB (a scavenge every 15 ms), whatever its warm-up. So each cloth row collects before its own setup as well, and its warm-up makes the code again. The smoke row counted nothing (it checked that its buffers were the same arrays); it counts collections now, 0 in 20 of 20 runs.
- PH-8: closed by the two above. `npx vitest run --config packages/kernel/bench/vitest.config.ts packages/kernel/bench/physics.bench.ts -t "no garbage"`, 20 runs one after the other: kernels on 0 collections in 20 of 20, kernels off 0 in 20 of 20, smoke 0 in 20 of 20; and each of the two cloth rows alone (`-t "kernels on"`, `-t "kernels off"`), 10 of 10. On `efe4cdb` the row failed in about half of the runs (PH-14).

**As fixed (the fix round of PH-24 and PH-25, branch `feat/physics-garbage-2`, commits 0e6febd, 505d3f0, f4f3a78, f91fb1f, b58ed02):**

Protocol: a sampling heap profile (`HeapProfiler.startSampling`, 16 to 64 B interval, minor and major collections included) of 1,000 frames through `Figure.setClock` after 4,000 (1,500 left some functions that run once a frame unoptimised, and an unoptimised function makes a heap number of every number it reads from a field). A frame is two steps of 1/120 s. The checkpoints are the film and are counted apart.

- PH-24: what the 3D liquid's step made was boxed numbers across calls (`collideShape` gave back a double a drop, 4,100 B a step in the scene with a ball and a stone; `step(h, range)` and `account(w, h)` took numbers; `rho.fill(self)` read a field; `compact` made a closure; `Math.abs` was a call) and iterators. The numbers now go through fields (`hStep`, `range`, a scratch `Float64Array`, `Grid.reach`, `Grid.box`), the loops are indexed, `compactInside` and `limit` take no closure. `Fluid3.step` and `Fluid2.step`: 2 to 3 B a step (the harness's own call), kernels on and off. The same rule fixed the plane's liquid and the grids. Two things found later: `pour` read `hStep` before its loop, which made a heap number in code not yet optimised (moved into the loop), and `NeighbourGrid3.build` read `inv` and `findPairs` read `reach` from a field to put them in the Rust loops' table at each step, which made 16 B a step after the cloth rows had run (they are put there when set now).
- PH-25, space and plane: what a frame made, in the order it was found. Iterators over `Map`, `Set` and arrays (indexed loops, `DirtyList`, `RecList`, `CheckpointStore`); `Map.clear()`, `Set.clear()` and `array.length = 0` each make a new table or free the store (swapped spare tables and lists, a `ContactTable` of two arrays in the plane's solver, `pop` to empty); a function that holds a closure makes its context at every call, even one that returns early (`rebuild` and `rebuildNow`, `writeLinks` and `writeLinksNow`, `igniteLogged`); numbers passed to and returned from calls (`applyAt`, `gapAt`, `addKindNow`, `setMargin`, `normalSpeed`, `step()` and `account()` of the worlds, `advectFire` with `carry` written out: 127 KB a frame); a cell value built with `{ ...v, … }` has no cache of its keys, so `sameValue` made a list of them (explicit literals for the world, cloth, liquid, body and smoke values); typed arrays of cells made new each frame (`FlipArrays`, in turn: cloth points, liquid drops, waves, forces, smoke and temperature); a list of 300 bodies copied each frame (kept, and the held cell reused when every body in it is); a sleeping body's cell reused (`BodyOut`); `deliver`, `setCell` and `setClock` make nothing for events nobody reads; `world2.save` writes its array at its size. The film is unchanged: the hash of readouts and the hash of the world for the 12 scenes of PH-15 and 6 more (a plane with joints, liquid, fire, cloth in the plane and in space, boxes), 72 lines, kernels on and off, are equal before and after.
- Bytes a frame, whole profile, before and after (kernels on, then off where it differs):

  | Scene | Before | After (on) | After (off) |
  |---|---|---|---|
  | 64 × 32 flag, constant wind (3D) | 35,046 | 1,202 | 1,198 |
  | 64 × 32 flag, wind a formula (PH-41) | 48,620 | 13,650 | not taken |
  | 3D liquid, 2,000 drops, a ball and a stone (PH-42) | 75,570 | 28,091 | 28,117 |
  | 300 boxes at rest (2D) | 528,510 to 694,542 (both box scenes, taken before the split) | 341 | not taken |
  | 300 boxes falling (2D, 12,100 B of it is the cells of the bodies that move) | 528,510 to 694,542 | 12,363 | 12,378 |
  | 2D liquid, 2,000 drops, gate shut | 60,180 | 1,619 | 1,616 |
  | Fire 64 × 64, two burning bodies | 155,999 to 172,246 | 2,544 | 2,559 |

  The 2D liquid's own gate `lift = 6 min(1, max(0, t - 0.5))` reads `t`, so its shape is made again at each step (PH-41); the rows use the gate shut.
- What is left and why. Not under 200 B in the whole frame: the contract of the cells makes it, and it is not changed. A cell that changed is a new value object (the figure compares a cell with the one it holds, so writing into the held object would hide the change from the comparison and from every reader that kept it), and `setClock` returns a `FrameDelta` (about 150 B for one changed cell, 300 B for a flag: the object, three arrays and the ids) and queues the clock's event (about 55 B). For the flag in constant wind: the delta about 300 B, the world's cell about 270 B (20 fields), the cloth's about 193 B, the events about 270 B. A body that moves needs its cell, about 40 B on average in the falling boxes (the bodies that are awake) and the cell of a moving body in full is about 280 B. The physics parts (iterators, `writeCloth`'s three arrays, `world3.step`, `flush`, `beginSoft`, `islands`, the signature, `driver.ts`, `world2.ts`) make 0 to about 0.6 KB a frame (PH-43, PH-44).
- Bench rows (`packages/kernel/bench/physics.bench.ts`, `npx vitest run --config packages/kernel/bench/vitest.config.ts packages/kernel/bench/physics.bench.ts -t "garbage"`; the 12 rows of the no-garbage kind together, 3 of them the cloth and smoke rows already there): on the last commit of code, 10 of 10 runs (and 12 of 12 before them), no collector run in any window; in one earlier loop of 10 on the same commit the kernels-off 3D liquid row failed once and did not fail again in 22 runs. A liquid step: under 16 B (measured 0.00 to 4.3, the least of five windows of 500 steps), kernels on and off, and the plane; a frame of the flag in constant wind under 2 KB (958 to 1,486 B), kernels on and off; 300 boxes at rest under 1 KB (341 to 773 B); 300 boxes falling under 30 KB (12,650 to 13,020 B); a 2D liquid under 4 KB (2,184 to 2,458 B); fire under 8 KB (2,224 to 2,903 B). A row collects once, then warms up in three rounds with a pause (the engine puts its fastest code in from another thread), then counts: a collection throws away the code that holds an earlier row's Rust module, and a row measured straight after ran `build` in the interpreter (16 B a step).
- Seen on the way, not changed: with the whole bench file played, the two timing rows "2D liquid, 2,000 drops: a frame" (p95 1.46 to 1.69 ms against 1.5) and "3D liquid, 2,000 drops: a frame" fail in some runs on this machine, on the commit before this work too (the 3D row in 2 of 3 runs, the 2D row's mean 1.22 ms there against 1.20 to 1.31 after). One full `npx vitest run` had `physics-fire.test.ts` "water puts a fire out" time out at 5 s with the whole machine busy (3 s alone); the second full run passed 8,688 of 8,688.

## Review of 11A fire in the plane (2026-11-18, one round)

Read: builder notes 11A, design 9.7 "Choices made while building it in the plane", `test-report.md` 11A (90 new
tests, 4 fail).

| Id | Where | What | Evidence | Harm | Status |
|---|---|---|---|---|---|
| PH-16 | `driver.ts` (hit handlers during a seek), `handlers.ts` | A seek that has to step through a hit runs the `on b hit` handler's physics steps at the seek's end time, not at the hit: `on ball hit: Ignite(wood)` sought from 0 to 6 s logs `@input physics ignite wood at 6` twice and gives another film than playing. Seek must equal play (design 10). Check `Push` in a hit handler too and fix every physics action the same way. | Tester report 11A, notes. | high | fixed (d9a63af) |
| PH-17 | `driver.ts` burnable shapes | A solid shape that burns away stays solid and reads defined: a ball on a burnt shelf stays up at 8 s. Design 9.7 and errors.md 4: it stops being solid and reads undefined with `burnt`. | Tester failures 2, 3, 4. | high | fixed (d9a63af) |
| PH-18 | `smoke2.ts` swirl | `swirl = 10` in a closed jar loses 22.9% of the smoke (11.5 "Smoke kept": within 0.1%). Swirl 0.5 and 2 keep it. | Tester failure 1. | medium | fixed (d9a63af) |
| PH-19 | `driver.ts`, limits | A 65th burnable thing is ignored instead of refused with `limit` (design 11.3: 64). | Builder notes. | medium | fixed (d9a63af) |
| PH-20 | `ui.md`, studio tools | No Fire tool, no fire row in `ui.md`, no screenshots or Chrome numbers for fire. | Builder notes. | low | to be implemented (round 11 examples job) |
| PH-21 | `driver.ts` | A `Pin` to a body that burns away is not handled (not looked at). | Builder notes. | medium | to be implemented |
| PH-22 | `world2.ts` `save` (contacts), `driver.ts` `worldHash` | A film that rewinds gives another `worldHash` than the same film with the same input lines given at the start, in a number no step reads: the saved `id1` (second feature id) of a contact whose manifold has one point is whatever the pooled contact held before. Positions, speeds and every readout are equal to the bit, and the hashes meet again within a few seconds. | `on ball hit: Push(wood, (0, 2))` (the ball hits at 0.55 s and 0.69 s) played to 2 s, against the played script with the handler line removed: the saved states differ in one number (contact 0, `id1`: 1 against 0) from 0.7 s; equal at 6 s. | low | to be implemented (write 0 for the ids of a point the manifold does not have; check that a manifold that grows to two points never reads the stale ones) |
| PH-23 | `driver3.ts` / `world3.ts` rewinds | In space, three films of one script differ in the last digits: the played film, the sought film, and the film with the handler's `@input` lines given at the start. The first two rewinds (hits at 0.75 s and 1.65 s) are exact; the third (2.19 s) is not. Cause not found. | `g = Ground()`, `b = Body(Sphere((0, 0, 3), 0.25), bounce = 0.6)`, `c = Body(Sphere((2, 0, 0.25), 0.25))`, `on b hit: Push(c, (0, 2, 0))`, 4 s: three hashes (`cbc17c2d23eb0e5`, `653e3d6a5cb09ca`, `c82782cac2c074a0`); first divergence at 2.2 s, by 2.8e-14 in a contact point (y about 50.35 m); at 4 s seven saved numbers differ by up to 4e-13. Gone with small pushes (the regression tests use them). | medium | to be implemented |

**Fixes for PH-16 to PH-19** (the one fix round):

- PH-16: while stepping (playing or catching up after a seek), a handler that a hit starts must run with the film time
  of that step, and its physics actions (`Push`, `Ignite`, `Wake`, `Sleep`) must be logged at that time and applied at
  that step, so playing, seeking from 0 and reloading the played script give the same hash. A replay must still not
  run a handler twice (design: run once per hit). Regression tests: `on ball hit: Ignite(wood)` and
  `on ball hit: Push(ball, (2, 0))`, seek from 0 to 6 s equals play to 6 s (hash and the `@input` lines).
- PH-17: at `burnt = 1` a solid shape leaves the walls (bodies on it fall), its value reads undefined with reason
  `burnt`, and the `burnt` notice shows once. The tester's three failing tests must pass unchanged.
- PH-18: keep smoke within 0.1% for every `swirl` up to 10: skip the swirl force on faces next to solids and the box's
  closed sides, and cap its speed change per face per step at `0.5 × min(dx, dy) / h`. The tester's failing test must
  pass unchanged; films with `swirl` 0.5 and 2 may change (state it in design 9.7).
- PH-19: a 65th thing with `burns` is refused with `limit` (errors.md 3), naming the 64.

**As fixed (fix round, commit d9a63af; the fixer measured each point):**

- PH-16: `afterFlush` (plane and space) sets the film time of the hit (`hit.t`) while a handler runs, and `push`, `ignite`,
  `wake`, `sleep`, `restart` and the cloth grabs log at that time (`clockNow()`), not at the clock's. The log entry is at a
  step the world has already passed, so `addEntry` rewinds to the checkpoint before it and the world steps on again with
  the action in place; the hit is not seen again (`frontier`), so a handler runs once per hit. Two gaps found on the way,
  fixed with it: (1) `Wake` and `Sleep` changed the world at once and were not in the log (design 5.4: "each action while
  playing is an entry in the input log"), so a seek back lost them; they are now `@input physics wake|sleep name at t`
  lines, in the plane and in space, also through the worker. (2) A reloaded script that holds the handler's lines ran the
  handler again at each hit (a `Push` doubled); an action a hit handler writes that an `@input` line of the script already
  holds is that line (claimed once, in the order of the log), so the played script and its reload have the same lines.
  Regression tests: `Ignite`, `Push` (centre and at a point) and `Sleep` in a plane handler, `Push` (centre and at a point)
  and `Sleep` in a space handler: played, sought from 0 and reloaded give the same hash and the same `@input` lines; seeking
  back and forth over the hits keeps the film; `Wake` and `Sleep` as lines. They fail on the old code (6 of 8 plane tests).
- PH-17: a solid shape's cell is overridden in `onCompute` while it has burnt away (reason `burnt`) and written when the
  state changes, also back after a seek before the burn; the world is still built from the rule's own value, so a line
  changed after the shelf burnt does not bring it back or start the film again. The ball on the shelf sat asleep and
  the wall's removal did not wake it: `World2.wakeAround(i)` wakes the sleeping bodies whose boxes meet a body that
  leaves (a burnt shape or a burnt body; a body that rested on a burnt log fell the same way before it was fixed). The
  tester's three failing tests for the shelf (the ball, and the two that read the cell) pass unchanged.
- PH-18: as listed, a face takes at most `0.5 min(dx, dy) / h` of speed from the swirl in a step. **It does not bind and
  does not keep the smoke**: the jar of the test has `swirl = 10` speeds of 3.4 m/s and a step of 0.5 cells at most, and
  capping the force at 0.5 down to 0.05 m/s a step left 23% to 17% lost; skipping the cells beside solids changed
  nothing (all the smoke is inside the jar and none is in a solid). What loses the smoke is carrying it back along a
  turning flow: the raw loss is 0.4% a step at `swirl = 2` and 0.7% to 1% at `swirl = 10` (design 9.4 says about 0.05% for a plain plume; the jar's own raw loss with no swirl was not measured),
  and the scale that restores the mass is capped at 0.5% a step. So the cap grows with the swirl: `0.5% × (1 + swirl)`
  (5.5% at 10), and stays 0.5% with no swirl, so a film with no swirl is unchanged. The jar keeps its mass to 1e-13 for
  `swirl` 0.5, 2, 3, 6 and 10; the swirled smoke's mean height at 10 s is 0.32 m (the test wants over 0.3). Films with
  `swirl` of 3 and more change (the mass is kept now); 0.5 and 2 are unchanged (the cap did not bind). Design 9.4 and 9.7
  say so.
- PH-19: `burnLimitCheck` (a line check) refuses the line that makes the 65th body (each item of a list counts), cloth or solid
  shape burn, by `burns = …` or `with burns`, with `limit` and the 64 (a `burns` that is a formula is read while the film
  plays, where the driver still ignores the things past the 64th). The tester's test that said "the 65th is ignored, with
  no refusal" contradicts design 11.3 ("Over a limit, the line is refused with `limit`", "Burnable things | 64"); it is
  rewritten (three tests: the 65th refused, every kind counts, turning one off frees a place).

Found while fixing, not fixed in this round: PH-22 and PH-23 above.

## Review of 11B smoke and fire in space (2026-11-18, one round)

Read: builder notes 11B, design 9.8 "As built", `test-report.md` 11B (102 new tests, 6 fail). Ids start at PH-30 so
they do not clash with the open garbage batch (PH-24, PH-25 and any it adds).

| Id | Where | What | Evidence | Harm | Status |
|---|---|---|---|---|---|
| PH-30 | `commands/physics` `Ignite` in space | `Ignite(sheet)` on a sheet with `burns` in space is refused with `not_burnable`; so the `no_fire_grid` case and its seek-equals-play cannot happen either. | Tester failures 1 (3 tests). | high | fixed (9a68f48) |
| PH-31 | cloth burning (space; check the plane too) | A burning sheet tears 183 links but no `torn` notice shows; a tear from `tears` does show one (design 9.5, 9.7). | Tester failure 2. | medium | fixed (9a68f48) |
| PH-32 | B021 in space | `no_fire_grid` has no `suggest` when the figure has a fire elsewhere; errors.md wants `Fire(b.pos)`. | Tester failure 3. | medium | fixed (9a68f48) |
| PH-33 | limits in space | Bodies in space with `burns` are not counted: 130 accepted (design 11.3: 64 burnable things a figure, all kinds together). | Tester failure 4. | medium | fixed (9a68f48) |
| PH-34 | `burn3.ts`, `driver3.ts` | Solid shapes that burn in space are not built (R11 item 4, design 9.7 "A solid shape"). | Builder notes, "Left out". | medium | fixed (9a68f48) |
| PH-35 | `smoke3.ts` speed | Every grid-in-space row is about 2× its goal: 24³ 4.0 ms Node (2), 15.5 ms Chrome 4× (8); 32³ 9.1 (4), 35.3 (8); flag over a fire 5.1 (2.5), 20.7 (8); seek 128 ms median (120). By design 11.6 the grid in space moves to Rust (approved by the product owner). | Builder notes, design 11.6. | high | to be implemented (next job: Rust for the grid in space) |
| PH-36 | `world3.ts` `load` | `World3.load` re-normalises the quaternion of a body that burnt away, so `worldHash` can differ by about 1e-16 after a seek (no readout depends on it). Same class as PH-22, PH-23. | Builder notes. | low | to be implemented |

**Fixes for PH-30 to PH-34** (the one fix round): make the tester's 6 failing tests pass without changing them, fix
every case of each rule in the plane as well as in space (pipeline "Fix every case of a rule"), and add one regression
test per fix. For PH-34 follow the plane's rules (design 9.7: a burnt shape leaves the walls, reads undefined with
`burnt`, bodies on it fall and wake; a seek back restores it).

**As fixed (fix round, commit 9a68f48; the fixer measured each point):**

- PH-30: the cause was not the sheet's `burns`. An argument of an action that names an object has no value in `call.values` (only `call.refs`), so `Ignite(flag)` read `isClothValue(undefined)`, took the sheet for a thing of the plane and asked the plane's driver, which has no such sheet: `not_burnable`. `igniteRun` now reads the object's own value (`call.figure.value`), and a polyhedron, sphere, cylinder or cone is told as a thing in space by its type. The plane was not affected (its driver is the default). The tester's 3 tests pass unchanged. Regression tests: `Ignite(sheet)` with `burns = 1` and with `burns = 2.5` (lit, burns away, the script keeps the `@input` line), and a sheet with no `burns` is still `not_burnable`.
- PH-31: in space `stepCloth` tore the burnt cells' links (`burnCloth`) before `c.stepWorld`, and `stepWorld` clears `tornNow` (`cloth.ts`), so the count of links torn in the step was lost, the `torn` event and notice never came, and only the total `c.torn` grew. They are torn after the step now, in the plane's order. In the plane the order was right (checked by a rope that burns, a case the 11A tests did not have: one `torn` notice with its links, and `c.torn` at least that). Films of burning sheets in space change by a step in the tearing; design 9.8 says so.
- PH-32: not a missing suggestion. `Fire(far.pos)` was built, then the check that offers only lines that would work (`repaired` in `graph/tx.ts`, a dry run of each) refused it: a figure has one grid in space and `fire = Fire(far.pos)` is a second one, `limit`. The suggestion the docs name stays when the dry run fails with `limit` and the error is `no_fire_grid` (the plane has the same case when its 64 × 64 cells are used: a test with a 64 × 64 fire), and in space the hint adds that a figure has one smoke or fire grid, so the line to change is the grid it has. Not changed: any other error's suggestions are still vetted.
- PH-33: `burningThings` counted `isBodyValue` (the plane's value) only, so bodies in space (`Body3`) and items of a list of them were never counted; the 65th of any kind (a body, a sheet, a solid shape, by `burns = …` or `with burns`, each list item) is `limit` now, and a body with `burns = false` or `with burns = false` frees a place. The plane already counted them.
- PH-34: solid shapes in space burn as in the plane. `solidBurn` (the seconds: `true` is 10 s a m³ of the shapes' volume, at least 1 s; the place: the middle of the box; planes, the floor and terrain cannot burn), `buildBurn` makes a unit of kind `BURN_SHAPE` for each, `stepBurn` removes the burnt shape (`World3.wakeAround` first, then `removeBody`; the grids mark their walls again), `syncBurntSolids` makes the cell read `undefined` with the reason `burnt` and gives it back after a seek back, `ownedCells` sends it to the page from the worker, `burnCentre` and `ignite` take a shape. The line check and `Ignite` accept polyhedra, spheres, cylinders and cones. `World3.wakeAround(i)` (new, the plane's rule on 3D boxes) wakes the sleeping bodies that meet the one that leaves; burnt bodies use it too, in place of `touchingAll()`, which made a list each time. Two guards found on the way, in space and in the plane (design 9.8): (1) a rule was told to be a solid by the driver's scan, which has not run yet when the rule is computed with its `solid` style, so its value was never kept (`solidVals`), the cell read undefined once it burnt, the signature changed and the world was built again from its start without the shelf (the ball then fell at once, by accident); `onCompute` now tells a solid by its `solid` style, and when a shelf burns the driver keeps the value its rule has if it kept none. (2) the same rebuild would have undone a seek back before the burn. Regression tests: a ball asleep on a shelf that burns (falls after the `burnt` notice), a shelf over a fire burning with no `Ignite` (notice once), seek equals play across the burn with a reload of the script and a seek back before it, a line changed after it burnt does not start the film again, a sphere, and the errors (`no_fire_grid`, `not_burnable`).

Not fixed in this round (PH-35 and PH-36 stay as listed above). Found while fixing:

| Id | Where | What | Evidence | Harm | Status |
|---|---|---|---|---|---|
| PH-40 | `driver.ts`, `driver3.ts` `buildBurn`, `burnCentre`; `cloth.ts` `named9` | `flag with burns = true` (design 9.7's own example) and `with ignite` on a cloth are accepted and do nothing, in the plane and in space: a sheet's `burns` is read from its spec (the `Cloth(…, burns = x)` argument) and never from its `with` style, as a body's and a shape's are. `Ignite(flag)` right after it is refused with `not_burnable`, and a sheet that is meant to burn does not. | `g = Ground()`, `cold = Fire(Box((0, 2), 4, 4), 32)`, `flag = Cloth(Box((0, 2), 1.2, 1), 10, 6, mass = 0.2, pins = "top")`, `flag with burns = true`, `Ignite(flag)`: `not_burnable`. The same in space. | medium | to be implemented (read `burns` and `ignite` from the style over the spec as `bodyBurn` does; the cloth's `tears` for the engine comes from `spec.burns` in `clothDef`, so the spec must be changed too, or the style read where the cloth set is built) |

## Review of 10.10 Rust grid in space (2026-11-19, one round)

Read: builder notes 10.10, design 11.6 round 2, `test-report.md` 10.10 (41 new tests, all pass). Ran
`packages/sdk/test/spec/physics-worker.test.ts` on this branch, on integration and on older commits.

| Id | Where | What | Evidence | Harm | Status |
|---|---|---|---|---|---|
| PH-47 | `commands/physics/types.ts` `collectBuffers`, `driver.ts` / `driver3.ts` `ownedCells`, `packages/sdk/src/worker/physics-worker.ts` | The worker moves (transfers) the typed arrays of the cells it owns, but keeps the same arrays in its own figure. A cell that did not change since the last frame still holds a buffer that is now detached, so the next frame's transfer list has a detached buffer and `postMessage` throws `DataCloneError`; the worker's own readouts of that cell (`b.force`) read an empty array. 3 tests of `physics-worker.test.ts` fail on integration `b58cfa0`, also on `650e922` and `8677d89`, on Node 22, 24 and 26. | A probe of the transfer list: one frame lists `ArrayBuffer:0:detached` beside the drops' arrays. | high | open |
| PH-48 | `smoke3.ts`, cloth | Still over goal in Chrome with the CPU 4× slower: fire 32³ about 16 ms (8), flag over a fire about 12 ms (8); Node flag over a fire 2.7 ms (2.5). The flag's part is the cloth in TypeScript. | Builder notes 10.10. | medium | to be implemented |
| PH-49 | `physics/wasm/kernels.ts` | The SIMD build cannot be chosen or seen through the public API, so tests cannot check it against the scalar build. | Tester report 10.10. | low | open |

PH-35 is fixed for the default grid (24³ meets Node 2 ms and Chrome 8 ms; seek 45 ms median); the rest is PH-48.

**Fixes for PH-47 and PH-49** (the one fix round):

- PH-47: the worker must never send a buffer it keeps. In `ownedCells` (plane and space), for each typed array a cell
  value holds, put a copy of it into the outgoing cell and transfer the copy (the worker's own figure keeps its arrays);
  skip copies of nothing that is detached. Find every place a worker reply transfers buffers (cells, smoke grids, drops,
  waves, cloth, fire temperatures) and do the same. Design 9.6: one line saying the worker sends copies it moves. The 3
  failing tests must pass unchanged; regression test: a figure whose body sleeps (its cell does not change) for 60
  frames in the worker, then reads `b.force` in the worker and on the page, both right.
- PH-49: export `physicsGridSimd(): boolean | undefined` (true when the grid in space uses the SIMD build) and a test
  switch `setPhysicsGridSimd(on)`, then a regression test: the same fire 24³ film with SIMD on and off, every second.
