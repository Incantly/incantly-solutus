# Plan: finish cloth (physics task 9.8)

Written by the planner for the builder. Spec: `.kiro/specs/physics/tasks.md` 9.8. Docs: `docs/features/physics/design.md`
9.5 (the tether lines), 11.2 (budgets), 11.5 (the "Heavy ball, wide swing" row), 11.6 (the Rust rule);
`docs/research/physics-papers.md` 8.

## Where

- Repository: `/Users/iteoluwakisibello/Documents/incantly-solutus`, branch `feat/physics-9` (draft PR #113). It already
  has integration merged in (soft step). Do not create another branch. Do not touch `main` or `integration`.
- Your files: `packages/kernel/src/physics/cloth.ts`, `cloth2.ts`, `cloth3.ts`, `particles.ts`,
  `packages/kernel/src/commands/physics/cloth.ts`, `driver.ts`, `driver3.ts` (only where the cloth hooks are), a new
  `packages/kernel/bench/chrome-physics.mjs` and its page, `docs/features/physics/design.md` (9.5 "Choices made" notes
  and 11.2 measured numbers only), `.kiro/specs/physics/tasks.md` (ticks of 9.8.x), `.kiro/steering/kiro-usage-log.md`
  (one row), `handoff/physics/builder-notes.md`.
- You write no tests (`AGENTS.md`). A tester writes them after you.

## Rules that always hold

- The film is exact: no `Math.random`, no wall clock, a fixed order. Seek equals play. Checkpoints hold every value a
  step reads. All 214 physics tests must still pass:
  `npx vitest run packages/kernel/test/spec/physics packages/sdk/test/spec/physics apps/studio/test/physics.test.ts`.
- No memory made in a step (the "no garbage" bench must still pass). Float64 stays.
- No `console` in package code. No new library.
- Set `TMPDIR=$KIROCREW_SCRATCH/tmp` before tests (`/tmp` is nearly full).
- Shell: never use long heredocs or python one-liners that write files; use the file tools.

## T1. The body's tether (task 9.8.3)

The bug. A 1 kg ball on the end of a 2 m, 0.01 kg rope of 50 points, let go with the rope level, stretches the rope
75% by 0.9 s and the points reach 30 m/s. The planner measured:

| Case | Rope length at 2.9 s | Ball from pin |
|---|---|---|
| 50 points, 0.01 kg, ball 1 kg, level | 3.43 (should be 2) | 2.49 |
| 30 points, 0.2 kg, ball 1 kg, 3 m, level | 3.000 | 2.999 (fine) |
| 10 points, 0.01 kg, ball 1 kg | 2.000 | 2.000 (fine) |
| 50 points hanging still | 2.000 | 2.000 (fine) |
| 8 chain solves a small step instead of 1 | 2.089 | 2.033 (better, not fixed) |
| No point tethers | 22.3 | 13.0 (blows up) |
| No bend links / no hits | same as the bug | same |

So the chain solve alone cannot hold a body 5,000 times heavier than one point when the slack rope snaps taut. Point
tethers hold the points but not the body.

The fix (design 9.5 "A body's tether"):

1. In `ClothSet` (`cloth.ts`), when building tethers, also build body tethers: for each pin `q` with
   `pinBody[q] >= 0`, of a cloth whose def has no `tears`, and for each world pin `q0` of the same cloth: length `L`.
   For a rope, `L` = sum of `rest` of the stretch links between the two pinned points. For a sheet or net, `L` = the
   start distance between the two points times `1 + 2 (1 − stretch)`, the same slack as point tethers. Store them in
   typed arrays sized at build time (like `tePoint`, `teL2`).
2. In `substep`, right after `this.solveTethers(...)` for that cloth, solve body tethers: only for bodies that take the
   small steps (`subOf[b] >= 0`). Get the anchor `A` of pin `q` with `this.anchor(q, out)` and the world pin `P`
   (`pinX/pinY/pinZ[q0]`). If `|A − P| > L`, move the body's small-step centre (`spx/spy/spz[subOf[b]]`) by
   `(|A − P| − L)` toward `P`, along `(P − A) / |A − P|`. Add the same move, over the body's inverse mass, to
   `pinFx/pinFy/pinFz[q0]` the way `solveTethers` counts a point's pull (so `pinF` stays a force after the step's
   scaling). Then set the pinned point to the new anchor, as step 3 of `substep` does.
3. The body's speed comes out of `svx = (spx − sqx) / hs` at the end of the small step, so the outward speed is taken
   away with no extra code.
4. Body tethers are made from the defs, so checkpoints need nothing new. Check that a checkpoint load rebuilds them.
5. Both worlds use `ClothSet`, so 2D and 3D both get it. Check `anchor` works for both.

Done when the planner's probe (`$KIROCREW_SCRATCH/prof/rope2.ts`, bundled with the rolldown line in
`$KIROCREW_SCRATCH/prof/build.mjs`, run as `node rope2.mjs 50 0.01 1 2`) shows, at every sample to 3 s, a rope
length within 2% of 2 and the ball within 2% of 2 m from the pin; and `node rope2.mjs 30 0.2 1 3` is unchanged. Read the
probe before running it.

## T2. Pinned bodies and the soft step (task 9.8.2)

Since the soft step (design 6.2, 6.5) the world steps bodies in `ceil(passes / 2)` small steps; the cloth then takes 4
small steps of its own for bodies held by pins, starting from the body's pose at the start of the world step and adding
a quarter of the world's change of speed each small step (`beginSub`).

Check, with a probe of your own in `$KIROCREW_SCRATCH/prof/`:
- a ball pinned under a 32 × 32 sheet held by its corners, resting on `Ground()`, for 10 s: after 3 s it moves under 1
  mm a second and sinks under 1 cm into the ground;
- the hammock example in `apps/studio/src/examples.ts` (`hammock`) with its ball, 10 s: the same.

If both pass, write that in builder notes and change nothing. If not, fix it so the body's contacts and the cloth's
small steps agree (for example, take the body's speed change from contacts once, not twice), and say what you changed.

## T3. Speed (task 9.8.4)

Node budgets (frame = two steps, mean) and the planner's numbers on this branch:

| Row in `packages/kernel/bench/physics.bench.ts` | Now | Budget |
|---|---|---|
| 2D rope, 400 points | 0.41 | 0.5 |
| 3D cloth 32 × 32 on a ball | 0.87 | 0.75 |
| 64 × 32 in gusts | 1.12 | 1.5 |
| 64 × 32 over 40 bodies | 2.28 | 2 |
| self = true | 1.85 (95%: 2.77) | 2 |
| two cloths | 2.63 | 2 |
| cloth in water | 2.55 | 2 |

Run them with
`npx vitest run --config packages/kernel/bench/vitest.config.ts packages/kernel/bench/physics.bench.ts -t "cloth"`.

Profiles (`node --cpu-prof` on `$KIROCREW_SCRATCH/prof/probe.ts` scenes, summed by `top.mjs`):

| Scene | Top costs |
|---|---|
| sheet32 | `solveLinks` 20%, `hitSphere` 6%, `faceHeight` 4%, `collide` 4% |
| two | `solveLinks` 33%, `solveTethers` 11%, `speedsAdvance` 10%, `airForces` 9%, `prepareSelf` 7% |
| over40 | `hitHull` 21%, `solveLinks` 19%, `collide` 5%, `hullPlanes` 4% |

Do these in order. After each, run the cloth physics tests and the cloth bench rows; keep a change only if every test
passes, and write its gain in builder notes.

1. **Hits listed once a step** (`cloth3.ts`, `cloth2.ts`, `collide` and `prepare`). In `prepare(h)` build, for each body
   and solid shape, the list of points inside its box grown by `this.pad`, in point order. Each small step only tests
   those pairs. A shape's pose through the small steps stays as now. This should take most of `hitHull` in over40.
2. **Tethers every second small step** (small steps 2 and 4 of 4), plus body tethers every small step. Keep only if the
   "every link within 2%" test and the hanging rope test pass.
3. **Three small steps instead of four** (`SUBSTEPS` in `cloth.ts`): try it. Keep only if every cloth test passes
   without changing a test, and the rope pendulum stays within 1%. Change the design text (9.5, R10.2 "4 small steps")
   only if you keep it, and say so in builder notes.
4. **Cloth against cloth and itself once a step** (`prepareSelf`, `solveSelf`): build the tiles once a step and solve
   once per step if the `self` tests still pass; else keep every small step.
5. **Drops by cells** (`prepareDrops`, `solveDrops`): profile the `wet` scene first. Make drops meet only the faces
   listed in their grid cell.

Stop T3 when every Node row is within budget, or when these five are done. Report every row before and after.

## T4. Chrome with the CPU 4× slower (task 9.8.5)

Make `packages/kernel/bench/chrome-physics.mjs` on the pattern of `packages/sdk/bench/chrome-gl.mjs` (Vite on
127.0.0.1, Playwright from `PLAYWRIGHT_DIR`, the installed Chrome, CPU throttling through the DevTools protocol). The
page loads the kernel, builds the seven scenes of `$KIROCREW_SCRATCH/prof/probe.ts` (rope, sheet32, flag, over40,
self, two, wet), runs 1 s warm-up and 5 s of frames of two steps each, and prints mean, 95% and worst. Playwright
lives in `$KIROCREW_SCRATCH/pw` (use `PLAYWRIGHT_DIR=$KIROCREW_SCRATCH/pw`); it is not a dependency of the repository.

Run it once at the start and once at the end. Put both tables in builder notes and the end table in design 11.2 as a
"measured (round 9 finish)" note under the table. Goals: sheet32 3 ms, flag 6 ms, over40 / self / two / wet 8 ms.

Then the Rust rule (design 11.6): list each row more than 25% over its goal. Do not install Rust or any crate.

## When you are done

1. `npm run lint` and `npm run typecheck` pass; the physics tests pass.
2. Tick 9.8.2 to 9.8.5 in `.kiro/specs/physics/tasks.md` only for what is done; leave the rest open with a reason.
3. Add one row to `.kiro/steering/kiro-usage-log.md` (Spec task, task 9.8, what changed, numbers).
4. Write `handoff/physics/builder-notes.md` (section "9.8 cloth finish"): what you built, what you left and why,
   every measurement.
5. Commit only your files with clear messages (no AI credit, no co-author lines) and push:
   `git push -q origin feat/physics-9`. Do not merge. Do not open a new PR.
6. Reply with: the commit hashes, the T1 probe numbers, the Node table before and after, the Chrome table before and
   after, the Rust-rule list, and anything you could not do.
