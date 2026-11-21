# Plan: smoke and fire in space (physics tasks 11.5, 11.6, the 3D part of 11.7 and 11.8)

Written by the planner for the builder. Spec: `.kiro/specs/physics/requirements.md` R11 items 7, 9, 10, 11;
`tasks.md` 11.5 to 11.8. Docs: `docs/features/physics/design.md` 9.4, 9.7 (as built by round 11A, with its "Choices
made"), 9.8, 10.3, 11.2, 11.3, 11.6, 12.1; `handoff/physics/plan-11a-fire-2d.md` (every number of the fire step);
`handoff/physics/builder-notes.md` section 11A.

Round 11A built fire in the plane. This round runs the same step on a cubic grid in space. Every number (lift, burning,
cooling, source, water, burnable things, colours, crackle) is the one 11A used; only the grid gains a third axis.

## Where

- Branch `feat/physics-11b`, already created from integration and checked out. Never push to `main` or
  `integration`. Never chain `git push` after other commands in one shell call.
- Your files: a new `packages/kernel/src/physics/smoke3.ts`; `packages/kernel/src/commands/physics/` (`smoke.ts`,
  `fire.ts`, their `-reg.ts`, `driver3.ts`, `index.ts`, `body3.ts` for `burns` on bodies in space);
  `packages/kernel/src/physics/cloth3.ts` (the air hook only); `packages/sdk/src/worker/` (only if a grid in space needs
  wiring to go to the worker); `packages/sdk/src/screen/space/` (scene item and fallback drawing);
  `packages/view/src/gl/` (a new `volume3.ts` and its shaders; the backend only to add it to the frame);
  `apps/studio/src/examples.ts`; `packages/kernel/bench/physics.bench.ts` and `packages/kernel/bench/chrome/` (rows);
  docs (design 9.8 "As built", 11.2 measured note, 12.1 a line), `agent.md` rows, tasks ticks, usage-log row,
  `handoff/physics/builder-notes.md` section "11B fire in space".
- You write no tests. Do not touch the Rust crate in this round.
- `TMPDIR=$KIROCREW_SCRATCH/tmp`. No heredocs or python to write files. Targeted test runs only.

## Rules

- Exact films; seek equals play; checkpoints hold everything a step reads; no memory made in a step.
- The grid in space keeps its values in `Float32Array` (round each stored value with the array; the arithmetic stays
  Float64). A film is still exact: the same rounding every time.
- Every figure that worked before gives the same film (the physics tests and hash tests pass unchanged).

## 1. The grid (`smoke3.ts`, task 11.5)

- `Smoke3` on the box `x0..x1, y0..y1, z0..z1` with `n` cells a side (4 to 32), staggered: `u` on the x faces
  (`(n+1) n n`), `v` on the y faces, `w` on the z faces, `s`, `T`, `F`, pressure `p` (padded by one ghost cell each side)
  at the centres; their scratch copies; all `Float32Array` made once.
- The step is 9.4's and 11A's, in the same order, with trilinear back-tracing, the 7-point pressure stencil, 20
  red-black over-relaxed passes (ω = 1.8) started from the last step's pressure, open faces of the box at pressure 0,
  solids closed. Lift along `+z`. Swirl: `ω` is a vector (the curl of the centre speeds), `N = ∇|ω| / (|∇|ω|| + 1e-9)`,
  `f = swirl × dx × (N × ω)`.
- Solids and bodies: mark cells inside spheres, convex hulls (the hull's planes), the floor (`z < 0` for `Ground()`),
  and terrain (below the height at the cell's centre); a body's cells take its speed at the face. Drag on bodies as 9.4
  in 3D (`D` the body's width, `½ ρ Cd D² |Δv| Δv`), applied over the following steps.
- `save`, `load`, `saveLength`; `mass`, `maxSpeed`, `maxDivergence` as `Smoke2` has.
- Health: over 1e6 or not a number stops the grid with `unstable_world`, as 9.4.

## 2. Commands (task 11.5)

- `Smoke(box: Polyhedron, n)` and `Fire(box: Polyhedron, n)` in space (a box is any convex `Polyhedron`; use its
  bounding box, as `Liquid` in space reads its region); `Fire(at: Point3)`: box `x ± 1`, `y ± 1`, `z − 0.5 … z + 2.5`,
  `n = 24`, source a sphere of radius 0.25 at `at`. Named arguments as in the plane; `source` takes a point, a sphere
  or a solid. A line is in space by its form, as `Liquid`.
- Limits: one grid in space per figure (a second is `limit`), `n` 4 to 32 (`bad_property_value` outside).
- Readouts: `at(x, y, z)` and `temperature(x, y, z)` take three numbers in space; the rest as in the plane.
- `burns` and `ignite` on bodies in space (`Body3`) and on cloth in space (sheets): the rules of 11A section 3 with a
  body's cells being the air cells beside the cells it fills (6-neighbours), or the cell at its centre; a sheet's cell
  uses the grid cell at its quad's centre. `Ignite` in space, logged as `@input physics ignite <name> at <t>` in
  `driver3.ts`.
- Water in space: drops of `Liquid` in space cool and douse cells as 11A section 4.

## 3. The driver, the worker, checkpoints (task 11.5)

- `driver3.ts` collects `Smoke` and `Fire` records in space, builds the grid, steps it 60 times a second of film (one
  grid step every `round(rate / 60)` world steps, as 2D), after the bodies and before cloth, and writes the values.
- A figure with a grid in space runs in the physics worker, as one with liquid (design 9.6): find where liquid in space
  sends a world to the worker and do the same for the grid. The grid's `T` and `s` go to the page as one moved
  `Float32Array` each frame.
- Cloth in a grid in space feels its flow as wind: in `cloth3.ts`, the air hook (as `cloth2.ts` `airAt` does with
  `Smoke2`) adds the flow at a point (trilinear on the faces) to `world.wind`.
- Checkpoints: while a figure has a grid in space, the world's checkpoints are every 1 s of film instead of 0.5 s
  (design 9.8). Say so in design 10.3.

## 4. Drawing (task 11.6)

- Scene item `volume` (`packages/sdk/src/screen/space/scene3.ts`): the box, `n`, the `T` and `s` arrays, `heat`, the
  smoke colour.
- **WebGL 2** (`packages/view/src/gl/volume3.ts`): upload `T / heat` and `s` into one `RG8` (or `RG16F` when
  `EXT_color_buffer_float` is not needed) 3D texture each frame (`texSubImage3D`, made once per `n`); draw the box's
  back faces; the fragment shader marches 48 steps from where the ray enters the box to where it leaves or hits the
  solids' depth (the depth texture of 12.1), front to back: emission = the 11A black-body ramp of `T` times its alpha,
  absorption from smoke `s × 0.85`; stop at alpha 0.98. Premultiplied output, composited as the sheet is (12.1).
- **Without WebGL 2**: the software painter draws 12 slices across the axis that faces the camera most, each as the
  cells with alpha above 0.02 drawn as filled quads (the 11A colours), sorted with the faces far to near. Notice
  `cloth_drawn_coarse` is not used; no new notice.
- PNG from the GPU path; SVG from the slices.

## 5. Examples and benches (3D part of tasks 11.7, 11.8)

| id | Title | Lines (sketch) |
|---|---|---|
| `physics-3d-flag-fire` | a flag ripples over a fire | `g = Ground()`, `f = Fire((0, 0, 0))`, `flag = Cloth((-1, -0.2, 2.4), (2, 0, 0), (0, 0, -1), 32, 16, pins = "top")` |
| `physics-3d-smoke-ball` | smoke flows round a ball | `Smoke(Cube(…) or a box, 24, source = (−1, 0, 0.5), wind = (2, 0, 0))`, `ball = Sphere((0, 0, 0.5), 0.4)`, `ball with solid = true` |
| `physics-3d-crate-burns` | a crate catches fire and burns away | `g = Ground()`, `f = Fire((0, 0, 0))`, `crate = Body(Cube(…), burns = true)` |

Each opens with every line and moves when the film runs (check with the existing example-loading test locally).

Bench rows (design 11.2) in `physics.bench.ts`: "smoke or fire in space, 24³, a frame under 2 ms in Node", "fire in
space, 32³, under 4 ms", "flag over a fire in space under 2.5 ms", "seek anywhere in a 60 s film, fire in space,
warm, under 120 ms"; and the 24³ and flag scenes in the Chrome page (`packages/kernel/bench/chrome/`), goal 8 ms.
Report every number. If the 24³ row in Chrome is more than 25% over 8 ms, write it in builder notes as a Rust-rule
candidate (design 11.6); do not port it.

## Done

Lint, typecheck,
`npx vitest run packages/kernel/test/spec/physics packages/sdk/test/spec/physics apps/studio/test/physics.test.ts apps/studio/test/space.test.ts`
pass. Commit (no AI credit lines), push `feat/physics-11b` as its own command, open a draft PR to `integration`
("feat(physics): round 11B, smoke and fire in space"). Reply with the PR link, commits, every bench number, what you
left out and why, and every decision the plan did not settle.
