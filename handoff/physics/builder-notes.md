# Physics builder notes

## 9.8 cloth finish

Branch `feat/physics-9`. Files changed: `packages/kernel/src/physics/cloth.ts`, `packages/kernel/bench/chrome-physics.mjs` and
`packages/kernel/bench/chrome/` (page), `docs/features/physics/design.md` (9.5, 11.2), `.kiro/specs/physics/tasks.md`,
`.kiro/specs/physics/requirements.md` (R10.2: "3 small steps, 4 for a cloth that hits itself"), `.kiro/specs/physics/design.md`
(one line, same words), `.kiro/steering/kiro-usage-log.md`. No tests written. The 214 physics tests pass after every commit.

`docs/features/physics/design.md` has no section 11.6 and `docs/research/physics-papers.md` has no section 8 on this branch (the
plan names both). I used the plan's own words for the Rust rule: list every row more than 25% over its goal.

### T1. The body's tether (9.8.3): done

`ClothSet` builds body tethers from the defs (`buildBodyTethers`, after `buildChains`): for each body pin and each world pin of
a cloth with no `tears`, a length (rope: sum of the stretch links' rest lengths between the two pinned points; sheet or net:
start distance times `1 + 2 (1 − stretch)`). `solveBodyTethers` runs right after `solveTethers` in each small step, only for
bodies that take the small steps. Past the length, the body's small-step centre moves toward the world pin by the excess, and
`pinF` of the world pin gets minus that move times the body's mass.

One difference from the plan: the plan says to set the body's pinned point to the new anchor. I move the point by the same
move instead (keeping the links' pull on it), so step 3 of `substep` still hands that pull to the body. Setting it to the anchor
would throw the links' correction away in every small step the tether fires.

Checkpoints need nothing: the tethers come from the defs when the set is built, and a checkpoint load fills an existing set.
`anchor` is used as is; both worlds go through `ClothSet`.

Probe `$KIROCREW_SCRATCH/prof/rope2.ts` (every 0.1 s to 3 s, final code):

| Case | Rope length | Ball from pin | Before |
|---|---|---|---|
| 50 points, 0.01 kg, ball 1 kg, 2 m, level | 2.000 to 2.003 | 1.999 to 2.000 | length 3.43, ball 2.49 |
| 30 points, 0.2 kg, ball 1 kg, 3 m | 3.000 to 3.001 | 2.949 (first sample) to 3.000 | unchanged |
| 10 points, 0.01 kg, ball 1 kg, 2 m | 2.000 | 1.999 to 2.000 | unchanged |

### T2. Pinned bodies and the soft step (9.8.2): a fix was needed

Probe `$KIROCREW_SCRATCH/prof/t2.ts`. A 1 kg sheet (32 × 32, `stretch = 0.9`, 3 × 3 m, held by its four corners at 1 m) with a 2 kg
ball on `Ground()` pinned under its middle (`Pin(sheet, (0, 0, 1), ball)`), 10 s:

| | Sinks into the ground | Speed after 3 s |
|---|---|---|
| Before (T1 only) | 29 to 55 mm (`damping = 1`: 29 mm) | 19 mm/s, creeping down until it slept |
| After | under 1 mm (0.5 to 0.9 mm) | `damping = 1`: 0 at 3 s. Default damping: 14 mm/s at 3 s, 0 by 6 to 10 s: the sheet rings and the ball rings with it |

Cause: a body held by pins took its place from `p0 + Σ (v0 + k Δv / 4) hs`. The soft step's contact push-outs are not in that
path, so the ball crept into the ground by the pull of the sheet each step. Fix (`cloth.ts`, `beginSub` and `substep`): the body
takes the world's own move of the step in equal parts per small step (`swx`), plus only what the cloth added to its speed
(`svx − swvx`) times `hs`. The speed that goes back to the world is unchanged (world speed plus the cloth's part), so momentum
counts are as before.

Not met as written: "after 3 s it moves under 1 mm a second" holds only with `damping = 1` or after 6 s with the default. A
2 kg ball hung in a 0.9-stretch sheet rings for several seconds at the default damping of 0.02.

The hammock example (`apps/studio/src/examples.ts`, `hammock`): the ball there is not pinned (it falls on a net), so none of
this code runs for it. It is a trampoline: the ball bounces 0.5 to 1 m for the whole 10 s, with the same numbers on the older
base commit (`d90e85b`) and now. I changed nothing for it.

A flat sheet at `stretch = 1`, pinned to a ball at exactly its start distance from the corners, is an over-constrained scene:
the sheet cannot sag, so the ball takes an unbounded pull. It jitters and is thrown out with or without the body tether
(checked with the tether off). I did not try to fix it.

### T3. Speed (9.8.4): partly done

Node bench rows (frame of two steps, mean of the last retry; `npx vitest run --config packages/kernel/bench/vitest.config.ts
packages/kernel/bench/physics.bench.ts -t cloth`), before this round's work and after:

| Row | Before | After | Budget |
|---|---|---|---|
| 2D rope, 400 points | 0.429 | 0.354 | 0.5 |
| 3D cloth 32 × 32 on a ball | 0.880 | 0.776 | 0.75 |
| 64 × 32 in gusts | 1.139 | 0.923 | 1.5 |
| 64 × 32 over 40 bodies | 2.333 | 1.920 | 2 |
| self = true | 1.926 (95%: 2.95) | 1.876 (95%: 2.88) | 2 |
| two cloths | 2.682 | 2.287 | 2 |
| cloth in water | 2.619 | 2.303 | 2 |

The planner's numbers on its machine were a little lower (0.87, 2.28, 2.63, 2.55); mine ran the same code a little slower.
Other bench results that changed: the "no garbage" row showed 3 collections before and 0 after (it is noisy, not caused by this
work); worst-frame row (flag 60 s then over 40 bodies, p95 limit 2): over 40 bodies p95 2.54 before, 2.33 after (still over);
seek with 4,096 points (95% frame limit 50 ms): median 35.7 before, 31.2 after, still over.

What I did, in the plan's order:

1. Hits listed once a step: already so. `prepare` in `cloth3.ts` lists, for each body and solid shape, the points inside its box
   grown by `pad`, once a step; the 1,344 pairs in over40 are points really inside the padded box of a shape (the sheet
   rests on the boxes). `hitHull` costs about 65 ns a pair. Nothing to change.
2. Tethers every second small step: tried. One test fails (a ball resting on a sheet pinned at four corners: the pins carry its
   weight within 1%; the measured force is 0). Reverted. Gain was 6% on two cloths.
3. Three small steps instead of four: kept, **with four when any cloth has `self = true`**. With three and `self`, the 64 × 32
   sheet over a post never settles (max speed 1 to 2 m/s for 12 s) and a frame costs 47 ms. Every test passes with three, including
   the rope pendulum within 1% and the "every link within 2%" test. Cross-cloth contact (two sheets, one dropped on the other)
   settles about as with four. `ClothSet.subs` is 3 or 4, fixed when the set is built. Bend links: a sheet solves them once a
   step as before; a rope solves them every second small step with four and once a step with three (stiffness is the same
   by the compliance scaling). Design 9.5, R10.2 and the spec design line are updated. Gain: 3% (self, still four) to 19%.
4. Cloth against cloth once a step: `prepareSelf` already builds its pairs once a step. Tried a per-cloth box test to skip it when
   no cloth hits itself and the cloths are apart: no gain in the `two` scene (the cloths are within reach of each other in the
   gusts). Reverted.
5. Drops by cells: `prepareDrops` already takes the drops' points from the grid and only the faces round the nearest point.
   Profile of `wet`: liquid pair search (`pairsHashed`) 14%, link pass 13%, tethers 10%, `prepareDrops` 7%. Not changed.

Also tried and reverted: listing tethers once a step (skip a tether whose point is further inside than twice `pad`): the
film is bit for bit the same, and no faster (two cloths 2.28 against 2.29 ms).

Still over budget in Node: 32 × 32 (0.78 of 0.75), two cloths (2.29 of 2), cloth in water (2.30 of 2). The profile of the two-cloth
scene is the link pass 30%, air 10%, tethers 10%, `prepareSelf` 9%. What would help next: the link pass (see the Rust rule below).

### T4. Chrome with the CPU 4× slower (9.8.5): done

`packages/kernel/bench/chrome-physics.mjs` with the page `packages/kernel/bench/chrome/index.html` and `main.ts` (the seven scenes
of the probes). Run from the repository root:
`PLAYWRIGHT_DIR=$KIROCREW_SCRATCH/pw node packages/kernel/bench/chrome-physics.mjs [--rate 4] [--scenes rope,flag]`. Chrome 157
(the installed one), Vite on 127.0.0.1, 1 s warm-up and 5 s of frames of two steps. It exits 1 when a mean is over its goal. The
Playwright 404 line in its output is the page's favicon.

| Scene | Goal | Before: mean / 95% / worst | After: mean / 95% / worst |
|---|---|---|---|
| rope | 2 ms | 1.57 / 2.30 / 3.40 | 1.27 / 1.80 / 2.50 |
| sheet32 | 3 ms | 3.76 / 4.50 / 5.10 | 3.45 / 4.20 / 5.00 |
| flag | 6 ms | 5.06 / 5.70 / 6.70 | 4.21 / 4.80 / 5.60 |
| over40 | 8 ms | 9.67 / 11.20 / 13.00 | 8.02 / 9.10 / 9.90 |
| self | 8 ms | 8.67 / 13.50 / 15.80 | 8.71 / 12.90 / 15.80 |
| two | 8 ms | 12.04 / 14.30 / 18.60 | 9.85 / 12.10 / 16.60 |
| wet | 8 ms | 11.78 / 14.00 / 15.00 | 10.21 / 11.60 / 12.50 |

The end table is in design 11.2 as "Measured (round 9 finish)".

The Rust rule, rows more than 25% over their goal (by the mean): **wet** (128%). By the 95% frame, also sheet32 (140%), self
(161%), two (151%) and wet (145%), and over40 (114%). Rows within the goal by the mean: rope, flag, over40 (100.3%). Rows between 100% and
125% by the mean: sheet32, self, two.

### What I did not do

- 9.8.4 is not ticked: the Node rows of 32 × 32, two cloths and cloth in water are still over budget (above).
- "Hits listed once a step", "cloth against cloth once a step" and "drops by cells" needed no change: they were already so.
- Hammock: not applicable to the pin fix (see T2). Pinned-ball speed under 1 mm/s after 3 s needs `damping = 1`.
- No 11.6 or research section 8 to read on this branch.

## 10.9 Rust kernels (round 1)

Branch `feat/physics-rust`. Plan: `handoff/physics/plan-11.6-rust-kernels.md`. No tests written.

Files: `packages/kernel/wasm/` (`Cargo.toml`, `Cargo.lock`, `rustfmt.toml`, `src/lib.rs`, `build.mjs`),
`packages/kernel/src/physics/wasm/` (`kernels.ts`, generated `kernels-wasm.ts`), `physics/cloth.ts`, `cloth3.ts`, `grid3.ts`,
`fluid3.ts` (arena wiring only), `packages/kernel/src/index.ts` (one export line), root `package.json` (`build:wasm`),
`.gitignore` (`packages/kernel/wasm/target/`), `packages/kernel/bench/chrome-physics.mjs` and `bench/chrome/main.ts`
(`--kernels off`, `initPhysicsKernels()`, a line saying whether the kernels run), `docs/features/physics/design.md` 11.2 and
11.6, `docs/design/libraries.md` ("Build tools"), `.kiro/specs/physics/tasks.md` (10.9 ticked), `.kiro/steering/kiro-usage-log.md`.

Public API (exported from `packages/kernel/src/index.ts`): `setPhysicsKernels(on)` (for solvers built after the call; default on),
`physicsKernelsOn()`, `initPhysicsKernels(): Promise<boolean>` (compiles the module without blocking).

### What is in Rust

`solve_links` (the fast loop only; links with a pinned end stay TypeScript, after it, in the same order), `solve_tethers`, `advance`,
`speeds_advance`, `speeds`, `solve_chain` (a rope), `air_forces` (steady wind only), `grid_build`, `grid_pairs` (dense and hashed, with the
gather of places), `grid_in_box`, `hull_hits`. The cloth's arrays and the grid's live in one `KernelArena` per `ClothSet`; the 3D liquid's
grid has its own. Each TypeScript loop stays and runs when there are no kernels.

### Where it differs from the plan, and why

1. **`std`, not `#![no_std]`.** `f64::sqrt` and `floor` are not in `core` on stable Rust 1.94, and `core::arch::wasm32::f64_sqrt` is unstable
   (feature `wasm_numeric_instr`). `std`'s `f64::sqrt`, `floor`, `abs` compile to `f64.sqrt`, `f64.floor`, `f64.abs`: the same instructions.
   The module has no imports and no allocation; 13.5 KB.
2. **`solve_chain` adds the pins' pull itself** (it gets `pinOf`, `pinFx`, `pinFy`, `pinFz`) instead of returning it through an output array:
   the same additions in the same order, one pass less in TypeScript.
3. **`hull_hits` stops at the first point inside the hull** and TypeScript runs `pushOut` on it, then calls again from the next point: a
   `pushOut` that hands the push to a held body moves that body's offset, which the next point's test reads. A list of hits written first
   and pushed after would not give the same bits. A run is the shape's consecutive candidates for one cloth; a hull with more than 256
   faces, or a world with a pin to a body (`hasBodyPins`: its `nearBodyPin` test), uses the TypeScript test.
4. **Integer arguments only.** A call with a floating-point argument makes the caller box it (a heap number) unless the engine inlines the
   call, and the "no garbage" check counts collections. The small step, gravity, the wind, the grid's reach and a search box go to a block
   of the arena (`KP` in `kernels.ts`, `MF_*` in the grid) and the call gets its offset.
5. **A module this size cannot be compiled by `new WebAssembly.Module` on a browser's main thread** (Chrome: over 4 KB). `loadKernels` is
   synchronous (Node, workers); a page's main thread calls `initPhysicsKernels()` once. The Chrome bench page does, and
   `window.physicsKernels` says `{wanted, compiled, running}`; the script prints it. Without it the TypeScript loops run, the same film.
   **The studio does not call it** (not my files): it matters only if physics runs on the page's main thread, which design 9.6 avoids.
6. **Memory in one arena of a fixed size**, from counts known when the set is built (`arenaBytes` in `cloth.ts`, `NeighbourGrid3.arenaBytes`).
   A region that does not fit is an ordinary typed array and sets `overflow`; then the set runs the TypeScript loops. It has not happened.
   Every set takes its own instance and memory (about 2.6 MB for 4,096 points, most of it the grid's room for the limits; creating one
   takes about 0.1 ms, and 1,500 live ones were made in Node without a failure), freed when the set is collected.
7. `design.md` 11.6 says one `step()` call; as the plan says, the hot loops are called from the TypeScript step. Written as "As built".

### Checks

- Hash check (scratch, not in the repository: `$KIROCREW_SCRATCH/prof/parity.ts`): 15 scenes, 10 s each, kernels off then on, a hash of
  every cloth array (`save()` and the speeds, pin forces, torn links, owed pushes), the drops' places and pairs, and every array of the world,
  every second. **All 15 equal in every second.** Scenes: the seven of the Chrome bench (rope, sheet32, flag, over40, self, two, wet), two
  sheets crossing, a net with `tears = 1.5` hit by a 6 kg ball in wind, a `Pour`, a 400-point rope in wind, a rope and a sheet with a `Pin`
  to a body, a sheet over a box, two cloths of different thickness over a box.
- 237 physics tests (`packages/kernel/test/spec/physics-*`, `packages/sdk/test/spec/physics-*`, `apps/studio/test/physics.test.ts`) with the
  kernels on, and again with them off (a scratch vitest config with a setup file): the same 236 pass and the same one fails (below).
- `npx tsc -p tsconfig.json`, `npx eslint packages/kernel`: clean. `cargo clippy --release --target wasm32-unknown-unknown` and `cargo fmt`: clean.
- **A test fails: `packages/kernel/test/spec/physics-bodies.test.ts` line 62 ("no inexact Math function appears in the engine")** reads
  every entry of `src/physics` with `readFileSync`; the plan's folder `src/physics/wasm/` makes it throw `EISDIR`. It needs the tester (skip
  directories, or recurse; the new files have no `Math.sin` and the like). The other choice is to move `kernels.ts` and `kernels-wasm.ts`
  up one level into `src/physics/`: say so and I will.
- `npm run bench` row "Cloth, no garbage" (`physics.bench.ts`, 2,000 steps after 60 frames): **1 to 3 collections with the kernels on, 0 with
  them off.** The count does not grow with the number of steps (3, 3 and 3 collections for 3,000, 12,000 and 24,000 steps, scratch probe
  `gc.ts`), and with 600 frames of warm-up it was 0 with the kernels on and 0 off (1 and 0 with 1,500 frames). So it is a start-up cost, not
  memory made by every step; I think it is the engine compiling the module's functions again when they get hot, but did not check that. Every
  call has integer arguments and the copies in `hullRun` are loops (no `subarray`). The check may want a longer warm-up (the tester's file).

### Numbers

In `docs/features/physics/design.md` 11.2 ("Measured (task 10.9, …)") and 11.6 ("As built"). The Chrome means move by about 10% from run to run on
this computer, so the table compares the TypeScript loops and the Rust loops in turn, three runs each.

### Round 2 (not started)

Chrome rows still over their goal: cloth in water 9.11 ms (goal 8), the 32 × 32 on a ball 3.13 (3), the cloth that hits itself 8.00 (8). Profile
(Node, with the Rust loops):

| Scene | What is left in TypeScript |
|---|---|
| wet | `prepareDrops` 10%, `faceTable` 4%, `levelOf` 3.5%, `tileBoxes` 2.5% |
| two | `prepareSelf` 12.5%, `stretchMax` 3%, `settle` 3%, `tileBoxes` 3%, `tileMeets` 2.6% |
| self | `prepareSelf` 24%, `footOn` 7%, `faceHeight` 3%; `grid_in_box` 15% (about 2,000 calls a step, each 70 ns: batch them) |
| over40 | `hullRun` 12% (its copies and the calls after each hit), `centre` 6%, `pushOut` 4%, `bodyV` 2.6% |
| sheet32 | `hitSphere` 7%, `faceMayMeet` 6%, `prepare` 4%, `collide` 3.6%, `addFaces` 3.5% |

The link pass is 15% (over40, sheet32, self) to 34% (two) of what is left and only 1.2× faster in Rust: it is bound by the gathers and stores,
not the maths (a version that did two links at a time when they share no point was no faster and was dropped). A layout with a link's ends and
numbers side by side, or a point's `x y z w` side by side, would be the next try; SIMD (f64x2 gives the same bits lane by lane) is the other.

## 11A fire in the plane

Branch `feat/physics-11a`. Plan: `handoff/physics/plan-11a-fire-2d.md`. Design: `docs/features/physics/design.md` 9.7 ("Choices made while building it in the plane" holds every number and decision). No tests written. Scratch probes only (`$KIROCREW_SCRATCH/probe/`).

### Files

- New: `packages/kernel/src/physics/fire2.ts` (the fire steps on a `Smoke2`, swirl), `physics/burn2.ts` (`Burnables`: the burnable units and their step), `commands/physics/fire.ts` (`Fire`), `fire-reg.ts` (readouts, row text, notices, reason), `crackle.ts` (the sound source).
- Changed: `physics/smoke2.ts` (fire fields, `step(w, h, drops?)`, checkpoint), `physics/cloth.ts` (`ClothSet.burnCells`), `commands/physics/` `smoke.ts`, `smoke-reg.ts`, `cloth.ts`, `cloth-reg.ts`, `types.ts`, `index.ts`, `driver.ts`; `commands/sound/index.ts` (`registerSoundSource`); `commands/numbers/handlers.ts` (`Ignite` in `STEP_ACTIONS`); errors (`contracts/errors.ts`, `errors/table.ts`, `language/errors.ts`); the `boolnum` property kind (`language/props.ts`, `language/lines.ts`, `graph/props.ts`); `packages/sdk/src/screen/` `physics.ts`, `scene.ts`, `paint.ts`; `apps/studio/src/` `examples.ts`, `session.ts`; docs, tasks, usage log, bench.

### Public API

`Fire`, `Ignite`, `Smoke(…, swirl = k)`, `burns` and `ignite` on `Body`, `Cloth` (rope, net) and (as `with`) any solid shape; readouts `f.temperature(x, y)`, `f.burning`, `f.fuel`, `b.temperature`, `b.burnt`, `b.burning`, `c.burnt`. Kernel exports: `physics.isFireValue`, `FireValue`, `FireSpec`. SDK exports: `fireImage`, `fireColor`, `charred` in `screen/physics.ts`.

### Decisions the plan did not settle

See design 9.7 for the full list. The ones to look at first: the example id `physics-candle-flame` (the id `physics-candle` is the smoke candle that is already there) and `wood` for `log` (`log` is a reserved name); `Ignite` lights a whole thing at once; a cloth's `burns = true` is 10 s a kg of one cell's mass (at least 1 s a cell); `fire_out` needs the fire to have been alight and 1e-4 m² of fuel (never exactly 0); a joint whose rule goes undefined because a body burnt or left the world no longer makes the world start again (it did, and with a burnt body in a weld the film restarted at every pass); `with burns` takes a number too (new property kind `boolnum`); at most 64 burnable things, the rest ignored with no `limit` refusal.

### Left out

- The `limit` refusal of design 11.3 for the 65th burnable thing (ignored in the driver instead).
- `Pin` to a burnt body (its rule goes undefined; not looked at).
- Crackle: not muted by `Mute` (that is for `Sound` objects); no test of it.
- `ui.md` (a Fire tool for the toolbar, the drawing row), screenshots, Chrome numbers, spec tests: later steps.
- Fire in space (11B).

### Numbers

`physics.bench.ts`, "fire in the plane, 64 × 64, two burning bodies": mean 0.84 ms, 95% 0.89 ms, 99% 0.96 ms, worst 1.28 ms a frame (budget 1 ms); the smoke row on the same run: 0.56 ms. A burning curtain (20 × 14, a 48 × 48 fire) with a burning body and a weld: about 0.9 ms a frame.
