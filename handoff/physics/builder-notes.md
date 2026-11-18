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
