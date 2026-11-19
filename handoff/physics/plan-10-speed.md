# Plan: round 10, speed and checks (physics tasks 10.1 to 10.5, 10.8)

Written by the planner for the builder. Spec: `.kiro/specs/physics/tasks.md` round 10, requirements R9. Docs:
`docs/features/physics/design.md` 10.2 (exact on every computer), 11.2 (budgets), 11.4 (what the benches check), 11.5,
11.6; `docs/design/performance.md` 6; `handoff/physics/findings.md` (what is already measured).

## Where

- Branch `feat/physics-10`, already created from integration `b3ece73` and checked out. Never push to `main` or
  `integration`; never chain `git push` after other commands in one shell call.
- Files: `packages/kernel/bench/**`, `packages/sdk/bench/**`, `packages/kernel/src/language/builtins.ts` and a new
  `packages/kernel/src/language/exact-math.ts` (10.5), `packages/kernel/src/physics/math.ts` (only to share functions),
  `packages/kernel/src/index.ts` (exports for 10.5), docs (design 10.2, 11.2 measured notes, 11.4 notes, 16),
  `docs/design/performance.md` 6 (one row per new bench if it lists them), tasks ticks, usage log,
  `handoff/physics/builder-notes.md` section "Round 10".
- You write no tests (benches are yours; spec tests are the tester's). Do not change the engine to make a check pass:
  a check that fails is a finding; write it in builder notes with the numbers, and leave the bench asserting the design
  number.
- `TMPDIR=$KIROCREW_SCRATCH/tmp`. No heredocs or python to write files. Playwright is in `$KIROCREW_SCRATCH/pw`; its
  browsers (Chromium, Firefox, WebKit) are in `~/.cache/ms-playwright`.

## 10.1 Node benches for every row of 11.2

`packages/kernel/bench/physics.bench.ts` already has the liquid, smoke, fire, waves, cloth, 3D car and seek rows. Add,
in a new `describe('bodies (design 11.2)')`, on the pattern of the cloth rows (`frames(load(lines), warm, seconds)`,
mean and 95% against the Node column, `{ retry: 2 }`):

| Row | Scene |
|---|---|
| Apply one physics line | 300 2D bodies at rest, then `ball with bounce = 0.9`: the `apply` time, 50 times, median < 0.25 ms |
| 2D pile-up | 300 boxes dropped at once on `Ground()`; the slowest second's mean < 1.5 ms |
| 2D, most asleep | 1,000 bodies of which 900 have slept, 100 falling |
| 2D chain of hinges | 200 links in a chain from a wall |
| 2D car on hills | `Vehicle` on a curve cut into 2,000 ground pieces |
| 3D boxes, all awake | 100 `Body3` boxes falling and landing |
| Seek, 300 bodies | warm 60 s film, 100 seeks, 95% < 25 ms |
| Restart, 300 bodies | `restart` at 60 s: the first frame after it shows at once (< 16 ms) and the world is back at 60 s within 60 frames |

Write every number (mean, 95%, worst) in design 11.2 as "Measured (round 10)".

## 10.2 Chrome with the CPU 4× slower

`packages/kernel/bench/chrome-physics.mjs` exists for cloth and fire. Add the scenes of 10.1 and the 2D liquid, 3D
liquid, waves, smoke and fire-in-the-plane rows to its page (`packages/kernel/bench/chrome/main.ts`), with each row's
Chrome goal from 11.2. Run it twice; put the table in 11.2.

## 10.3 The checks of 11.4

New file `packages/kernel/bench/physics-checks.bench.ts` (same vitest config). One `it` per row of 11.4 that has no
bench yet: worst frame (60 s, 2D pile and 3D boxes), pile-up, calm stack (20 boxes, 60 s, top box < 1 mm, none falls),
pyramid (210 boxes, stands, all asleep within 3 s), no pass-through (1,000 shots of a 0.05 m ball at 100 m/s at a
0.01 m wall, the shots varied by a seeded offset), energy (bounce = 1, 1,000 bounces, top within 1%), energy with
joints (hinge pendulum 1,000 s, energy within 2%), same result (one film twice in Node, hash equal every second; the
browsers are 10.4), seek (100 random times, each within 11.2), long run (10 minutes of film: heap after the checkpoint
cap stops growing, compared over the last 3 minutes), wake storm (a ball into 500 sleeping bodies: worst frame within
11.2), one line (as 10.1), no garbage for a 300-body world (the pattern of the existing rows, `gc()` before counting).
Rows that already exist (cloth rows, no-garbage rows, worker cost in the sdk bench) stay where they are; list them in
builder notes as covered.

## 10.4 The same film in Chrome, Firefox and Safari

`packages/kernel/bench/cross-browser.mjs` with its page (reuse the Chrome page's Vite server): in Chromium, Firefox and
WebKit (Playwright's own builds; WebKit stands for Safari), play the same 60 s films and return the world hash every
second: a 2D pile of 300 boxes, a 3D tower with a hinge pendulum, a 2D liquid, a 64 × 32 flag in gusts, a net that
tears, fire in space 24³ with a burning crate, smoke in the plane with a body. With the Rust kernels on (where each
browser has WebAssembly) and off. Print a table; exit 1 when any hash differs. Run it and put the result in builder
notes. A difference is a finding: find the first second it differs and which values (bodies, drops, cloth points, grid
cells) differ first, and write that down; do not fix it.

## 10.5 Exact maths in compiled user formulas

Design 10.2 item 4: formulas the user writes must give the same bits in every browser.

- `packages/kernel/src/language/exact-math.ts`: a `MathLib` (the interface in `builtins.ts`) built only from `+ − × ÷`,
  `Math.sqrt`, `Math.floor`, `Math.abs`, `Math.trunc`, `Math.sign` and comparisons. Use the functions of
  `physics/math.ts` where they exist (`sin`, `cos`, `atan`, `atan2`, `exp`, `log`, `pow`), and add `tan`, `asin`, `acos`,
  `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `log2`, `log10`, `cbrt`, `hypot` the same way. Each within 1 ulp
  of the platform's on a sweep of 100,000 inputs (write the measured worst error per function in builder notes) and with
  the platform's special cases (NaN, ±Infinity, ±0, the domain edges).
- Install it with `setMathLib` when the kernel loads (default on). `PLATFORM_MATH` stays for a test switch: export
  `setExactMath(on: boolean)` from the kernel.
- Speed: a formula-heavy bench (a 2D force rule `force = (3 sin(t), 2 cos(2 t))` on 300 bodies; the probability and
  statistics benches) must not slow by more than 10%. Report before and after.
- Run the full test suite: values the tests pin with `toBe` may move in the last bit. Do not edit tests; list every
  failing test with the expected and received numbers in builder notes (the tester and the reviewer decide).

## 10.8 The Rust rule

Every cloth and fire row is within its Chrome goal since PH-48 (design 11.2 measured note). With 10.2's table, list each
row and its percentage of goal; tick 10.8 when no row is more than 25% over, else list the rows.

## Done

Lint and typecheck pass; the physics set passes
(`npx vitest run packages/kernel/test/spec/physics packages/sdk/test/spec/physics apps/studio/test/physics.test.ts apps/studio/test/space.test.ts`).
Commit (no AI credit lines), push as its own command, open a draft PR to `integration`
("feat(physics): round 10, speed and checks"). Reply: PR link, commits, the 10.1 and 10.2 tables, each 11.4 check with
pass or fail and its number, the cross-browser table, the 10.5 error table and speed, and the tests that 10.5 moved.
