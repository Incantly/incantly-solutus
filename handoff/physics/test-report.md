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
