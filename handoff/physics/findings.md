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
