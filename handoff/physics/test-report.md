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
