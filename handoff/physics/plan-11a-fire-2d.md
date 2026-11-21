# Plan: fire in the plane (physics tasks 11.1 to 11.4, and the 2D part of 11.7)

Written by the planner for the builder. Spec: `.kiro/specs/physics/requirements.md` R11 (items 1 to 6, 8, 9) and
`tasks.md` round 11. Docs: `docs/features/physics/design.md` 9.4 (smoke), 9.5 (cloth, tearing), 9.7 (fire), 11.2,
11.3; `errors.md` (B020, B021, `burnt`, `fire_out`); `docs/research/physics-papers.md` 9.

This plan settles every number the design leaves open. Where it differs from the design, the plan wins; write the
difference into design 9.7 "Choices made" (a new list at its end, as 9.4 has).

## Where

- Repository `/Users/iteoluwakisibello/Documents/incantly-solutus`, branch `feat/physics-11a` (already created from
  integration `efe4cdb` and checked out). Never push to `main` or `integration`. Never chain `git push` after other
  commands in one shell call.
- Since 10.9 the cloth's hot arrays may live in a WebAssembly arena (`physics/wasm/kernels.ts`, design 11.6). Burning
  cloth cells must tear links only through the existing tearing path and must not replace any cloth array; the hash
  tests in `packages/kernel/test/spec/physics-kernels.test.ts` must still pass. Do not touch the Rust crate.
- Your files: `packages/kernel/src/physics/smoke2.ts`, a new `packages/kernel/src/physics/fire2.ts` if it keeps
  `smoke2.ts` small, `packages/kernel/src/commands/physics/` (`smoke.ts`, `smoke-reg.ts`, a new `fire.ts`,
  `fire-reg.ts`, `driver.ts`, `index.ts`, `types.ts`, `shapes.ts`, `cloth.ts`), `packages/kernel/src/physics/cloth.ts`
  (only a hook to burn cells), the kernel registries (`contracts/errors.ts`, `contracts/values.ts`, `errors/table.ts`,
  `language/errors.ts`, `language/lines.ts` for the `@input` word), `packages/kernel/src/commands/numbers/handlers.ts`
  (add `Ignite` to `STEP_ACTIONS`), `packages/kernel/src/commands/sound/index.ts` (one hook, below),
  `packages/modes` (allow `Fire` and `Ignite` wherever `Smoke` and `Push` are), `packages/sdk/src/screen/physics.ts`
  and `scene.ts` (drawing), `apps/studio/src/examples.ts` (examples), `apps/studio` speaker logic if it needs the new
  sound source, `docs/features/physics/design.md` (9.7 notes), `agent.md` (rows for `Fire`, `Ignite`, `burns`),
  `.kiro/specs/physics/tasks.md` (ticks), `.kiro/steering/kiro-usage-log.md` (one row),
  `handoff/physics/builder-notes.md` (section "11A fire in the plane"),
  `packages/kernel/bench/physics.bench.ts` (one row).
- You write no tests. A tester writes them after you.

## Rules that always hold

- Exact films: no `Math.random`, no wall clock, fixed loop order, exact maths only (`+ − × ÷`, `Math.sqrt`, the
  functions of `physics/math.ts`). Every value a step reads goes into checkpoints. Seek equals play.
- No memory made in a step. Typed arrays made once.
- A figure with smoke and no fire, and `swirl` left out, must give **exactly** the same film as today (the smoke tests
  and hashes must pass unchanged). So every new term is skipped when its setting is 0 or absent.
- No `console`, no new library. `TMPDIR=$KIROCREW_SCRATCH/tmp` for tests. No heredocs or python to write files.
- Check: `npm run lint`, `npm run typecheck`, and
  `npx vitest run packages/kernel/test/spec/physics packages/sdk/test/spec/physics apps/studio/test/physics.test.ts packages/kernel/test/spec/sound`.

## 1. `swirl` on smoke (task 11.1)

- Named argument `swirl` on `Smoke` (Number, 0 to 10, default 0); a literal out of range is `bad_property_value`
  like `heat`.
- In `Smoke2.step`, after the lift (step 3) and before the solid faces (step 4), when `swirl > 0`: vorticity
  confinement (Fedkiw, Stam and Jensen 2001).
  1. `ω` at each cell centre from the face speeds: `ω = (v(i+1) − v(i−1)) / 2dx − (u(j+1) − u(j−1)) / 2dy` using the
     centre speeds (mean of the two faces); 0 in solid cells and at the box edge.
  2. `N = ∇|ω| / (|∇|ω|| + 1e-9)` by central differences.
  3. Force per cell `f = swirl × min(dx, dy) × (N_y ω, −N_x ω)`.
  4. Add `h × f` to the faces, each face taking the mean of the two cells beside it; skip faces next to solids.

## 2. `Fire` (task 11.2)

**Type and value.** A new type `Fire`. Its value `FireValue` is a `SmokeValue` with extra fields, so
`isSmokeValue` is true for it and every smoke readout works. The driver collects `Fire` records with the smoke ones
(today `k === 'Smoke'`; make it `Smoke` or `Fire`).

**Forms** (in `fire.ts`):

| Form | Grid |
|---|---|
| `Fire(region, n)` | as `Smoke(region, n)` |
| `Fire(at: Point)` | box `x − 1 … x + 1`, `y − 0.5 … y + 3.5`, `n = 48`, source `Circle(at, 0.25)` |

**Named arguments** and checks (`bad_property_value` for literals out of range, with `allowed` as smoke does):

| Name | Type | Range | Default |
|---|---|---|---|
| `source` | Point, Circle, Polygon | | `Circle(at, 0.25)` for `Fire(at)`, else none |
| `fuel` | Number | 0 to 10 | 1 |
| `burn` | Number | 0.1 to 10 | 1 |
| `heat` | Number | 100 to 2,000 | 1,000 |
| `smoke` | Number | 0 to 5 | 1 |
| `swirl` | Number | 0 to 10 | 2 |
| `wind` | Vector, Point | as smoke | |
| `until` | Number | 0 or more | forever |
| `sound` | Boolean | | false |

**Cells.** The grid gains `T` (°C above the air) and `F` (fuel), `Float64Array` of `n²`, carried like `s`, with their
scratch copies. Only a fire grid makes them (a smoke grid keeps `T` and `F` empty, length 0, and skips their steps).

**The step** of a fire grid, in this order inside `Smoke2.step` (the smoke steps are unchanged):

1. Marks and carrying of the flow, as smoke. Then carry `T` and `F` along the flow with the same back-tracing as `s`.
   Air coming in at the edges has `T = 0`, `F = 0`. No mass rescaling for `T` and `F` (only `s` keeps its mass).
2. **Lift** replaces the smoke lift for a fire grid: on each horizontal face, `a = 0.01 T̄ − 0.5 s̄` m/s², with `T̄`
   and `s̄` the mean of the two cells beside the face (a cell at 1,000 °C lifts at 10 m/s²). `v += h a`.
3. **Swirl** as in section 1, with the fire's `swirl`.
4. **Burning**, each cell in index order, where `F > 0` and `T > 150`:
   `ξ = smoothstep((T − 150) / 250)` (`3x² − 2x³`, clamped to 0..1),
   `r = min(F, burn × h × ξ)`, `F −= r`, `T = min(heat, T + 2 × heat × r)`, `s += smoke × r`.
5. **Source**, while the film time is under `until`: each source cell gets `F += fuel × h` (at most `F = 1`) and
   `T = heat`.
6. **Cooling**, each cell: `T −= 3 × T⁴ / heat³ × h`, never below 0.
7. **Water** (section 4).
8. Solid faces, the projection and smoke carrying, as smoke.

**Readouts** (`fire-reg.ts`, on the pattern of `smoke-reg.ts`): all smoke fields, plus `temperature` (a function of
`(x, y)`: the cell's `T`, 0 outside the box), `burning` (Boolean: some cell above 500 °C) and `fuel` (sum of
`F × dx × dy`). Row text: `fire, 48 by 48, up to 980 °C, burning` (or `out`). Default style colour `#e8742a`.

**Notice `fire_out`** once, when the source has stopped (`until` passed, or no source) and no cell is above 150 °C and
the fuel sum is 0; raised by the driver as other notices are.

**Limits.** All smoke and fire grids of a figure together at most 64 × 64 cells: extend the smoke line check to count
`Fire` too, refusing with `limit` as now.

**Checkpoints.** `save`, `load` and `saveLength` of the grid include `T` and `F` when present.

## 3. `burns` and `Ignite` (task 11.3)

**Settings.**

- Bodies: named `burns` (Boolean or Number, seconds of burning; `true` = 10 s per kg of start mass, at least 1 s) and
  `ignite` (Number, 150 to 1,000 °C, default 250), also as `with` properties, in `BodySpec` (`types.ts`).
- Cloth in the plane (rope, net): the same two named arguments on `Cloth`. A cloth burns cell by cell (below).
- Solid shapes: `p with burns = true` and `ignite`, next to `solid` (find where `solid` is read in `shapes.ts` and the
  driver, and do the same). `true` = 10 s per m² of area, at least 1 s.
- `burns` on anything else (a point, a smoke) is `not_burnable` (B020) at typecheck.

**State per burnable thing**, kept by the driver in figure order, saved in checkpoints: `Tm` (°C above air), `Fm`
(seconds of burning left), `F0` (its start), `lit` (0 or 1), `gone` (0 or 1).

**Each smoke step**, after the grid's step, for each burnable thing inside a fire grid's box, in figure order:

1. **Its cells.** The air cells that touch it: the grid's 4-neighbours of the cells `own` marks as this body or shape
   that are air themselves. A thing smaller than a cell (no cell marked) uses the cell at its centre. A cloth cell uses
   the grid cell at its quad's centre.
2. **Heat swap.** `Ta` = mean `T` of those cells. `Tm += (Ta − Tm) × 0.5 × h`; each of the cells gets
   `T += (Tm − T) × 2 × h / count`.
3. **Lighting.** `lit = 1` when `Tm ≥ ignite`, or at `Ignite`. Once lit it stays lit until `Fm = 0`.
4. **Burning** while lit and `Fm > 0`: `Fm = max(0, Fm − h)`; `Tm` moves toward `0.6 × heat` at rate 1 per second
   (`Tm += (0.6 heat − Tm) h`); each of its cells gets `F = min(1, F + 0.5 h × 4 / count)` (its gas burns in the
   air, so flames rise from it) and `s += smoke × 0.2 h`.
5. `burnt = 1 − Fm / F0`.

**What burning does.**

- A body's mass is `m0 × (1 − 0.8 burnt)`, set in the world each smoke step (find the world's way to change a body's
  mass and inertia; scale the inertia by the same factor). Its drawn colour goes toward `#2b2622` by `burnt`.
- At `burnt = 1` a body leaves the world on the pattern of `left_world` (`leftAt` in `driver.ts`): its value is
  undefined with the new reason `burnt`, joints to it break (as a weld that breaks: `broken`), and the notice `burnt`
  ("log burnt away at t = 12.3 s.") shows once.
- A solid shape at `burnt = 1` stops being solid: the driver drops it from the walls and marks the grid's walls dirty.
- A cloth cell at `burnt = 1` tears its links through the cloth's own tearing path (`tornNow`, `broken`), so torn links
  are saved and replayed as today. A cloth with `burns` tears there even without `tears`.
- Readouts: `b.temperature` (`Tm`), `b.burnt` (0 to 1), `b.burning` (lit and `Fm > 0`); `c.burnt` for a cloth (the
  part of its cells burnt).

**`Ignite(thing)`** — an action like `Push` (`index.ts` `action('Push', …)`): allowed in handlers (add to
`STEP_ACTIONS`), logged as `@input physics ignite <name> at <t>` (parse it in `driver.ts` and accept the word in
`language/lines.ts` next to `push`), replayed on seek. Refusals: a thing without `burns` → `not_burnable` (B020); a
thing outside every fire grid's box → `no_fire_grid` (B021) with `suggest` `Fire(b.pos)`.

**Errors and reasons** — register as `not_a_cloth` (B018) and `left_world` were: B020, B021 in the error tables;
reason `burnt` in `contracts/values.ts`; notices `burnt` and `fire_out`. Messages exactly as `errors.md`.

## 4. Water puts fire out (part of 11.3)

In the fire step 7: for each liquid drop inside the grid's box (drops are in `fluid2.ts`; the driver has them), in
drop order, the cell it is in loses `min(T, 50)` and all its `F`. A burnable thing whose cells hold a drop also gets
`Tm −= min(Tm, 50)` and, when `Tm < ignite`, `lit = 0`.

## 5. Drawing and the crackle (task 11.4)

**Fire image** (`packages/sdk/src/screen/physics.ts`, next to `smokeImage`): `fireImage(T, s, n, heat, out)`, one RGBA
pixel per cell. Colour from `T` by this ramp (linear between rows), alpha from `T`:

| T (°C) | R | G | B | alpha |
|---|---|---|---|---|
| 0 to 400 | | | | 0 |
| 500 | 130 | 20 | 0 | 0.35 |
| 800 | 230 | 80 | 0 | 0.7 |
| 1,100 | 255 | 160 | 30 | 0.85 |
| 1,500 and up | 255 | 240 | 180 | 0.95 |

Draw it like the smoke image (scaled to the box, smoothed), with `globalCompositeOperation = 'lighter'`, then the
smoke image over it. SVG export: the same two images. Bodies with `burnt > 0` draw toward `#2b2622`.

**The crackle.** In `packages/kernel/src/commands/sound/index.ts` add one hook: `registerSoundSource(fn)` where
`fn(figure, t) => { sounds: PlayingSound[]; has: boolean }`; `soundsAt` calls every source after the sound objects
and sets `hasSound` when one says `has`. Physics registers one: for each `Fire` object with `sound = true`, `has` is
true, and while some cell is above 500 °C it plays `{ key: 'fire:<id>', name, kind: 'noise', color: 'brown', gain,
pan: 0 }` with `gain = 0.3 × min(1, flameCells / (0.05 n²)) × (0.7 + 0.3 q)`, where `q` in 0..1 is a hash of
`(object id, floor(t × 20))` (integer maths only, no `Math.random`). Silent without `sound = true`.

## 6. Examples, docs, bench (2D part of 11.7 and 11.8)

Four examples in `apps/studio/src/examples.ts`, on the pattern of the smoke examples, tagged with the same modes, each
opening with every line and moving when the film runs:

| id | Title | Lines (sketch; make them work) |
|---|---|---|
| `physics-candle` | a candle flame that flickers | `Fire((0, 0), heat = 800, fuel = 0.3, burn = 2)` and a wax `Box` |
| `physics-campfire` | a camp fire; the log burns away | `g = Ground()`, `f = Fire((0, 0.2), fuel = 1)`, `log = Body(Box((0, 0.4), 1.2, 0.2), burns = true)` |
| `physics-curtain-fire` | a curtain catches fire and tears | `Fire(Box((0, 2), 4, 4), 64, source = Circle((0, 0.3), 0.3))`, `curtain = Cloth(Box((0.8, 2.5), 1.5, 2), 20, 14, pins = "top", burns = true)` |
| `physics-put-out` | a tap puts the fire out | a `Fire`, a burning log, `Pour((0, 3), 200, 2)` starting at t = 4 via a slider or `until` |

Docs: design 9.7 "Choices made" (every number above that differs from the design text, and anything you had to
decide); `agent.md` rows for `Fire`, `Ignite`, `burns` on the pattern of `Smoke` and `Push`; tasks ticks 11.1 to 11.4
(and the 2D items of 11.7 and 11.8 only if done).

Bench row in `packages/kernel/bench/physics.bench.ts`: "fire in the plane, 64 × 64, two burning bodies: a frame under
1 ms in Node" (design 11.2). Run it and report.

## When you are done

1. Lint, typecheck and the test command above pass.
2. Commit only your files (no AI credit, no co-author lines); push `git push -q -u origin feat/physics-11a`; open a
   draft PR to `integration` with `gh pr create --draft --base integration --title "feat(physics): round 11A, fire in the plane"`.
3. Write builder notes; add the usage-log row.
4. Reply with: the PR link, the commit hashes, the bench number, what you left out and why.
