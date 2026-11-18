# Physics test report

## 9.8 cloth finish

Tests: `packages/kernel/test/spec/physics-cloth-finish.test.ts`, 19 tests: 17 pass, 2 fail. `npm run lint` and `npm run typecheck` pass.

Passing: Heavy ball, wide swing (11.5); the body's tether in the plane and in space for balls of 0.1, 1 and 10 kg on ropes or sheets of 0.01 and 0.2 kg (12 tests, within 1.02 of the start distance); a ball of radius 0.3 pinned under a sheet sinks under 1 cm (stretch 0.9 and 1); seek equals play with the tether (play, seek from 0, back and forth, same ball x, y and world hash, bit for bit); Rope pendulum within 1%.

### F1. A ball of radius 0.5 pinned at its top under a sheet (stretch 0.9) does not stay on the ground

- Test: `A ball pinned under a sheet held by its corners ... > the same with a ball of radius 0.5 pinned at its top, the sheet resting on it (stretch 0.9): sinks under 1 cm into the ground`
- Doc line: design 9.5, "Bodies held by pins take the small steps": "a ball pinned under a sheet stays on the ground: it sank 3 to 5 cm before, under 1 mm now"; and the 9.8.2 task text, "a ball pinned under a sheet sinks under 1 mm". The docs give no ball size or sheet height, so a ball whose top touches the sheet at the pin is within them.
- Scene:

  ```text
  g = Ground()
  sheet = Cloth((-1.5, -1.5, 1), (3, 0, 0), (0, 3, 0), 32, 32, mass = 1, stretch = 0.9, pins = "corners")
  ball = Body(Sphere((0, 0, 0.5), 0.5), mass = 2)
  tie = Pin(sheet, (0, 0, 1), ball)
  ```

- Code gave: over 10 s the ball's centre goes 1.199 m below its resting height 0.5 m (to z = -0.70, through the ground), and up to 2.35 m above it (z = 2.85). After the first frame (1/60 s) z is already 0.452 (4.8 cm down), then 0.477, 0.500, 0.369, 0.726: the ball is flung about from the start.
- With a smaller ball (radius 0.3, pin 0.7 m above its centre) the same sheet gives a sink of 1.6 mm, so the failure needs the sheet to rest on the ball at the pin.

### F2. Same scene with the default stretch of 1: the ball is lost

- Test: `... > the same with a ball of radius 0.5 pinned at its top, the sheet resting on it (default stretch of 1): sinks under 1 cm into the ground`
- Doc line: the same as F1.
- Scene: F1 with `stretch` left at its default (1).
- Code gave: the ball's value is `undefined` from frame 133 (2.22 s): the body is gone (NaN or removed), so there is no sink to measure and the test reads NaN. Before that z jumps 0.452, 0.477, 0.500, 0.369, 0.726, 0.676, 0.521, ... 1.35 at 1 s, 0.16 at 1.5 s, 1.44 at 2 s.
- The builder notes (T2) name a flat sheet at `stretch = 1` pinned to a ball at exactly its start distance as an over-constrained scene. The tester's reading is that a figure the learner can type must not lose the ball, whatever the constraints; the design text has no such exception.

## 10.9 Rust kernels

Tests: `packages/kernel/test/spec/physics-kernels.test.ts`, 41 tests: 41 pass, 0 fail. `packages/kernel/test/spec/physics-bodies.test.ts` (29) passes after its source scan was changed to walk files under `src/physics` recursively (it threw `EISDIR` on `wasm/`). The physics set (17 files, 278 tests) and `npm run lint` pass.

No failing tests, so there are no findings for the fixer. What is covered (design 11.6 "As built"):

- Kernels on against off, 5 s, every second, `toBe` on every readout (`c.at(i, j)`, `torn`, body `x`/`y`/`z`, drop `count` and `level`) and `toEqual` on the whole `xs`/`ys`/`zs`/`cut` arrays: a 3D sheet on a ball, a flag in wind, a 64 × 32 sheet over boxes, two cloths (one with `self`), a sheet with 2,000 drops, a 2D rope with a ball, a 2D net that tears, a body pinned to a 3D sheet, plus a sheet that hits itself, a box hull falling on a sheet, a rope in smoke, and a 3D liquid with a ball.
- Seek from 0 to 3 s equals play to 3 s with kernels on (all 12 scenes), seek back and forward, and a film played with kernels on against one sought with them off.
- No WebAssembly (`globalThis.WebAssembly` stubbed to `undefined`, fresh figure built after): no throw, same film as the TypeScript loops. The docs do not say whether a module compiled earlier in the process is dropped, so the tests check only the promised film. `initPhysicsKernels()` under the stub neither throws nor rejects and resolves to a boolean.
- `physicsKernelsOn()` follows `setPhysicsKernels`; `initPhysicsKernels()` resolves `true` in Node, also on repeated and concurrent calls; the film after it equals the kernels-off film; the switch flipped mid-film (either way) keeps the film; three figures played frame by frame at once, with different switch states, give the same film.
- At the limits of 11.3: two 64 × 32 cloths (4,096 points, one with `self`) with 2,000 3D drops, 2 s on against off; the net tears the same links with one `torn` notice on and off.

Limit of these tests: the public API gives no way to see that the Rust loops ran (only `physicsKernelsOn()`, the switch). If the module were silently missing in Node, the on-against-off tests would still pass; the test that `initPhysicsKernels()` resolves `true` is the only guard.

## 11A fire in the plane

Tests: `packages/kernel/test/spec/physics-fire.test.ts` (78 tests, 4 fail) and `packages/kernel/test/spec/physics-fire-sound.test.ts` (12 tests, all pass). `npm run lint` and `npm run typecheck` pass. The physics set (kernel physics specs, `packages/sdk/test/spec/physics*`, `apps/studio/test/physics.test.ts`, kernel `sound`; 20 files) is 387 pass, 4 fail, the 4 below.

Covered and passing: `swirl` range (Smoke and Fire), `swirl = 0` equal to no swirl (every density, hash and checkpoint to the bit), `swirl > 0` changes the flow, swirl 0.5 and 2 keep the jar's mass, divergence and still air with swirl; `Fire(at)` box, cells, source and readouts; every named argument's limits and the 64 × 64 cells shared with smoke; source lights, cooling, `fire_out` once, lift, `burn`, `smoke`, `heat` cap, symmetry, wind; water puts the fire out earlier (6.0 s against 7.0 s); a body that burns (lit, `b.burnt` 0 to 1, mass 1 − 0.8 burnt, undefined with reason `burnt`, `burnt` notice once, weld notice `broken`); a cloth that burns (`c.burnt`, `c.torn`, `torn` notice); `Ignite` as a line, in a hit handler, on a list item (`row[2]`), on a cloth; B020 and B021 kinds, hints and suggestions; `ignite` range; seek equals play (body, cloth, `Ignite` line and handler, reload of the script), kernels on against off; the crackle.

### 11A.1 Smoke kept with `swirl = 10`: the jar loses 23% of its smoke

- Test: `swirl on Smoke > smoke kept with the largest swirl (10): the same jar keeps its mass within 0.1% for 10 s`
- Doc line: design 11.5 "Smoke kept" (hot smoke in a closed jar, source stopped at 0.5 s, mass within 0.1% for 10 s) with 9.7 "`swirl` ... 0 to 10", and the round task "smoke mass check of 11.5 still holds with swirl".
- Scene: `jar = Polyline((-2, 2), (-2, -2), (2, -2), (2, 2), (-2, 2))`, `jar with solid = true`, `sm = Smoke(Box((0, 0), 5, 5), 40, source = Circle((0, -1), 0.4), heat = 5, until = 0.5, swirl = 10)`.
- Code gave: mass divided by its value at 0.6 s is 0.956 at 1 s, 0.791 at 2 s and 0.771 from 3 s on (worst 22.9%). With no swirl, `swirl = 0.5` and `swirl = 2` it is 1.00000 at every second.

### 11A.2 A ball on a shelf that burnt away stays up for seconds

- Test: `burns and Ignite: cloth and solid shapes > a ball on a shelf that burns away falls soon after the burnt notice (1.5 s is time enough to fall a metre)`
- Doc line: design 9.7 "A solid shape burns as a body would, and when it is burnt it stops being solid", and the choices list, "A solid shape that burns is removed from the world the same way (the grids mark their walls again)".
- Scene: `g = Ground()`, `cold = Fire(Box((0, 2), 4, 4), 32)`, `shelf = Box((0, 1), 1.6, 0.2)`, `shelf with solid = true, burns = 1`, `ball = Body(Circle((0, 1.5), 0.2))`; play to 2 s, `Ignite(shelf)`.
- Code gave: the `burnt` notice comes at 3.0 s; the ball's `y` is still 1.2999 (resting on the shelf) 1.5 s later and at 8 s; it reads 0.2 (on the ground) at 12 s. A ball left in the air would fall 1.1 m in 0.47 s. The ball may be asleep and not woken, or the walls are marked again late; the tester did not look inside.

### 11A.3 A solid shape that burnt away still reads defined

- Tests: `... > a shape that burnt away reads undefined with the reason burnt (errors.md 4)` (shelf lit by `Ignite`) and `... > a solid shape beside a fire lights on its own, burns away and reads undefined with the reason burnt` (shelf at `Box((0, 0.9), 1.6, 0.2)` over `CAMP`, `burns = 1`, lit by the fire alone, 30 s).
- Doc line: errors.md 4, reason `burnt` "On: body, solid shape ... It burnt away (`b.burnt` reached 1)", and 9.7 "at 1 the body leaves the world: it reads `undefined` with the reason `burnt`" (the shape "the same way").
- Code gave: the notice `shelf burnt away at t = 3 s.` comes once (so the shape did burn, and it lights by itself beside a fire), but `f.get('shelf').cell` stays `{ defined: true, value: Polygon }`; no reason `burnt`.

### Notes (no test failed on these)

- The row text of a fire (`fire, 48 by 48, up to 980 °C, burning`) is not tested: no function of the kernel's public API gives a fire's row (`clothRow` exists; no `fireRow`), and `ui.md` does not give one.
- A `Weld` to a body that burnt away reads undefined (`input_undefined`, cause the body) rather than `j.broken = true`, with a `broken` notice (`w broke at t = 5.083 s.`) at the same time as `burnt`. The test accepts either reading (9.7 says both "its joints break (`broken`)" and "a joint whose rule goes undefined because a body burnt keeps its place").
- A fresh figure with `on ball hit: Ignite(wood)` that is sought straight from 0 to 6 s logs `@input physics ignite wood at 6` (twice) instead of the hit times (0.55 s and 0.7 s when played), and its hash differs from the played film. A reload of the played film's script gives the same hash as the played film (tested, passes). Design 10 does not say whether a handler runs during a seek that never played the hit, so no test asserts it; the product owner may want a ruling.
- `Ignite(list)` of a whole list is `not a body`; the list item form `Ignite(row[2])` works and is logged as `row[2]`.

## 11B fire in space

Tests: `packages/kernel/test/spec/physics-fire-space.test.ts` (92 tests, 6 fail) and `packages/sdk/test/spec/physics-fire-space.test.ts` (10 tests, all pass). `npm run lint` and `npm run typecheck` pass. The physics set (kernel physics specs, `packages/sdk/test/spec/physics*`, `apps/studio/test/physics.test.ts`, `apps/studio/test/space.test.ts`; 22 files) is 495 pass, 6 fail, the 6 below. The kernel file takes about 90 s (two long films: 60 s of a 24³ grid and 45 s of a 32³ grid for the checkpoint rows).

Covered and passing: `Smoke(box, n)`, `Fire(box, n)` and `Fire(at: Point3)` (box, 24 cells, ball of fuel, defaults, point, ball and solid sources, any polyhedron's bounding box); `n` outside 4 to 32 is `bad_property_value`; a second grid in space is `limit` (a plane grid does not count); the named ranges of `Fire` and of `Smoke`, `wind` parts over 100; `sm.at(x, y, z)` and `f.temperature(x, y, z)` against the arrays, `burning`, `fuel`, `mass`, `speed`; the step (source lights, `heat` cap, hot region and smoke rise along z, `burn`, `smoke`, `fuel = 0`, cooling, `fire_out` once, `swirl` changes the flow and `swirl = 0` is the film with none, wind, solid sphere and floor block the flow, a light ball is lifted); 11.5 "Smoke kept" in a closed jar (`swirl` 0, 2, 10) and "Still air" in space; water puts the fire out sooner; a body that burns (lights, `burnt` 0 to 1, mass 1 − 0.8 `burnt`, undefined with the reason `burnt`, notice once, `ignite` and `burns` seconds, `burns = true` is 10 s a kg, weld breaks, what rested on it falls, `Ignite` of a body, in a handler and of a list item); a sheet that burns (`c.burnt`, `c.torn`, far sheet and sheet with no `burns` stay whole); cloth in a grid feels its flow (a taut sheet over a fire rises and moves more than over a cold grid, a flag over a fire differs from the one over a cold grid, a smoke's own `wind` lifts a sheet); B020 and B021 kinds and messages for bodies; `ignite` range; `burns` forms; the 65th sheet with `burns` is `limit`; a 24³ checkpoint is 399.7 KB, no `checkpoints_thinned` in 60 s of a 24³ grid, one comes between 25 s and 45 s with a 32³ grid; seek equals play (fire, flag and burning crate; 5 s, back and forth; at frames either side of each 1 s checkpoint; a crate that burns away and back; `Ignite` as a line and in a handler with a reload of the script; a fire that goes out; a smoke with water and a body), the same film twice, kernels on against off. SDK: the grid in space runs in the worker with the page's film (hash, `temp`, `density`, flag and crate every second, grids moved not copied), smoke alone in the worker, `Ignite` from the page reaches the worker and the script, a body burnt in the worker reads `burnt` on the page with one notice, `worker_crashed` and `worker_unavailable` give the same film, SVG and PNG exports of the view in space with fire, smoke, a fire that is out and t = 0.

### 11B.1 `Ignite` of a sheet in space is refused with `not_burnable`

- Tests: `burns and Ignite: a sheet in space > Ignite(sheet) lights every cell not yet burnt: the whole sheet burns away to burnt = 1`; `errors: B020 not_burnable, B021 no_fire_grid in space > Ignite of a sheet outside every fire is no_fire_grid`; `the exact film with fire in space > Ignite of a sheet: seek equals play, and a reload of the script plays the same`.
- Doc line: design 9.8 "Things that burn in space": "`Ignite` on a body, a list item or a sheet is an `@input physics ignite name at t` line, as in the plane"; 9.7 "`Ignite(thing)` lights a whole body, shape or cloth"; errors.md B021 (`Ignite(b)` on a thing outside every fire).
- Scene: `cold = Fire(Box((0, 0, 1.5), 3, 3, 3), 16)`, `flag = Cloth((-0.6, 0, 2), (1.2, 0, 0), (0, 0, -1), 10, 6, mass = 0.2, pins = "top", burns = 1)` (also `burns = true`, and `flag with burns = true` added after), then `Ignite(flag)`.
- Code gave: `not_burnable` (C139), "flag can't burn yet. Add flag with burns = true first." every time, though the same kind of sheet with `burns` burns in a fire in the same figure (`c.burnt` grows). `Ignite(c)` for a sheet at x = 20, outside the grid, also gives `not_burnable`, not `no_fire_grid`. The same line works for a sheet in the plane (11A).

### 11B.2 Links torn by burning in space bring no `torn` notice

- Test: `burns and Ignite: a sheet in space > the links a burnt cell tears bring the torn notice, once for each tear, as any tear does`.
- Doc line: design 9.7 "A cloth that burns": "the `torn` notice and event come as for any tear"; 9.5 "Tearing": "a `torn` notice says when".
- Scene: `g = Ground()`, `fire = Fire(Box((0, 0, 1.5), 3, 3, 3), 16, source = Sphere((0, 0, 0.3), 0.3))`, `curtain = Cloth((-0.6, 0, 2.3), (1.2, 0, 0), (0, 0, -1.4), 13, 8, mass = 0.3, pins = "top", burns = 1)`, played 12 s.
- Code gave: `curtain.torn` is 95 at 4 s and 183 at 8 s, `curtain.burnt` 0.67, and no `torn` notice in any frame. A sheet in space torn by `tears = 1.2` gives `net tore at t = 0.525 s: 1 links.` (and a sheet in the plane that burns gives the notice).

### 11B.3 `B021` in space has no suggestion

- Test: `errors: B020 not_burnable, B021 no_fire_grid in space > Ignite of a burnable body outside every fire is no_fire_grid (B021), with the suggestion Fire(b.pos)`.
- Doc line: errors.md 3 B021: "`suggest`: `Fire(b.pos)`" (the plane gives `fire = Fire(far.pos)`).
- Scene: `cold = Fire(Box((0, 0, 1.5), 3, 3, 3), 12)`, `far = Body(Box((20, 0, 1), 1, 1, 1), burns = true)`, `Ignite(far)`.
- Code gave: kind `no_fire_grid`, code C140, message "far is outside every fire.", hint "Nothing can burn outside a fire. Make a fire round far.", and `suggest: []`. The test wants `['fire = Fire(far.pos)']`. With no fire in the figure at all the suggestion is given (`['fire = Fire(b.pos)']`, test passes); it is empty only when the figure has a fire elsewhere.

### 11B.4 More than 64 bodies with `burns` in space are accepted

- Test: `errors: B020 not_burnable, B021 no_fire_grid in space > the 65th thing with burns in space is refused with limit, naming the 64; the 64 before it are accepted and play`.
- Doc line: design 11.3 table "Burnable things | 64" and "Over a limit, the line is refused with `limit`"; errors.md B013 "a 65th thing with `burns`".
- Scene: `cold = Fire(Box((0, 0, 1.5), 3, 3, 3), 8)`, then `b<k> = Body(Box((x, y, 2), 0.1, 0.1, 0.1), burns = true)` on a lattice 0.3 m apart.
- Code gave: all 130 tried were accepted. A 65th sheet (`Cloth(..., burns = true)`) is refused with `limit` ("That would exceed the limit of 64 things that burn in a figure."), so the count works for sheets (test passes) and not for bodies in space. In the plane the 65th body is refused.

### Notes (no test failed on these)

- Checkpoints every 1 s are not visible through the public API. They are checked through what they decide: a checkpoint is 399.7 KB (`checkpointBytes()`), no `checkpoints_thinned` in 60 s with a 24³ grid, one between 25 s and 45 s with a 32³ grid, and seek equals play at the frames either side of each second.
- A crate of 0.5 × 0.5 × 0.4 m on the floor, beside a fire's source (touching), reached only 127 °C in 20 s and a 0.6 m cube overlapping the source stayed under 200 °C, so neither lit; a low crate (0.5 × 0.5 × 0.2 m) overlapping the source lights in 4 s. The heat swap uses the mean of every cell the body touches, so a body with many cold neighbour cells heats slowly. Not read as a bug; the tests use the low crate.
- A cloth in a grid with still air is slowed by the relative speed (a flag in a `Smoke` grid with no source swings differently from the same flag with no grid; a rope in a plane `Smoke` grid does the same). Design 9.5 says "with no wind the air does nothing" but also that the push uses the air's speed minus the triangle's, so the test only checks that still air adds no energy. The product owner may want the doc to say which.
- A solid shape in space does not burn (9.8 "left out"); `p with burns = true` on a polyhedron is refused with `not_burnable`. Not tested further.
- The body's `force("gravity")` reads 0 at t = 0 in space (it needs a step first); the mass-loss test reads it after 0.2 s.

## 10.10 Rust grid

Tests: `packages/kernel/test/spec/physics-kernels-grid.test.ts`, 41 tests: 41 pass, 0 fail (Node 26.0.0). `npm run lint` passes.

No failing tests for 10.10, so there are no findings for the fixer. What is covered (design 9.8, 10.4, 11.6 "As built, round 2"):

- Kernels on against off, 5 s, every second, `toBe` on every readout (`sm.at(x, y, z)`, `f.temperature(x, y, z)`, `fuel`, `burning`, `mass`, `speed`, body `x`/`y`/`z`, `temperature`, `burnt`, `burning`, cloth `c.at(i, j)`, `torn`, drop `count`, `level`) and `toEqual` on the whole `density`, `temp`, `xs`/`ys`/`zs` and `cut` arrays, plus the notice kinds of each second: fire 24³ (`Fire((0, 0, 0))`), fire 32³, a flag over a fire, a burning crate (`burns = 10`), a crate that burns away (`burns = 2`, with a ball resting on it), smoke round a solid ball in wind, smoke in wind with a ball moving through it, a liquid on a fire whose source stopped (`until = 1`), swirl 10 in a closed box, a fire with swirl 10, `n = 4` and `n = 5` (fire and smoke), a fire in the plane, and a plane fire with a burning log and a rope. Each film moves, and no probe reads `undefined` at 1 s.
- `physicsKernelsActive(figure)`: true for a figure with only a fire or only a smoke in space, true for a flag over a fire; false for each with `setPhysicsKernels(false)`.
- Seek equals play with kernels on (checkpoints every 1 s): fire 24³, flag over a fire, burning crate, and the three together; seek 0 → 4 s against play; 4 → 1 → 4 → 2.5 → 4 s against the straight film at each time; a film played with kernels off and sought with kernels on; a seek back from 3 s to 0.5 s and forward, then playing on to 4 s.
- With `WebAssembly` stubbed undefined and a fresh figure: eight scenes (fire 24³, flag over a fire, crate, smoke round a ball, `n = 4`, `n = 5`, the plane's fire, swirl 10) play 3 s equal to the kernels-off film, no throw; `physicsKernelsActive` does not throw.
- A figure with a grid built with kernels on and played on with the switch off from 2 s keeps the film; three figures (on, off, on) of a flag over a fire played frame by frame together do not share memory.

Not testable from the public API: the SIMD build (`setPhysicsGridSimd` is not exported from `packages/kernel/src/index.ts`), so "on" is whichever build Node picks. `physicsKernelsActive` for a figure with no WebAssembly is not asserted (the docs give no value).

Seen while running the physics set, not caused by 10.10: `packages/sdk/test/spec/physics-worker.test.ts` has 3 failing tests (`a world with liquid runs whole in the worker ...`, `a push made on the page goes to the worker as an @input line ...`, `a worker that stops hands the world back to the page ...`), all `DataCloneError: Cannot transfer object of unsupported type` at `structuredClone(reply, { transfer })` in the test's same-thread channel. They fail the same with the kernels switched off, the file is unchanged since round 6, and Node 26.0.0 is the runtime here (the repo asks for Node 22 or later). The scene is a plane liquid, which the Rust grid does not touch. Needs a check on the integrator's Node version.
