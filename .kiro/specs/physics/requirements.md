# Physics: requirements

Source: `docs/features/physics/` (design, errors, agent, ui). Section numbers below are from `design.md` unless marked.

## R1. Solid shapes and 2D bodies (design 2.1 to 2.4, 5, 6)

1. `p with solid = true` makes any flat shape a wall: polygons, boxes, circles, ellipses, segments, polylines, lines, rays, arcs, curves and function graphs.
2. A solid shape whose definition moves (a slider, `t`, a dragged point) is a mover: it pushes bodies and is never pushed.
3. `Body(p, mass = …)` or `density` makes a body from a polygon, box, circle, ellipse or closed polyline. `Bodies(list, …)` makes many. `Box` and `Ground` make shapes.
4. Body properties `mass`, `density`, `speed`, `spin`, `bounce`, `friction`, `force`, `torque`, `fixed`, `turns`, `bullet`, `group`, `charge`, `show` work as named arguments and as `with` properties, and accept formulas.
5. Readouts `pos`, `x`, `y`, `angle`, `speed`, `v`, `spin`, `energy`, `momentum`, `shape`, `touching`, `asleep`, `force(kind)` work in other lines.
6. Gravity, friction (Coulomb, `sqrt(μa μb)`), bounce (with a 1 m/s threshold, larger of the two), sleeping islands, speculative contacts and bullet sweeps behave as in design 6.
7. Polygons with dents are split into convex parts with a `split_shape` notice. Literal self-crossing polygons are refused.
8. The `world` object holds `gravity`, `air`, `passes`, `step`, `sleep`, `range`, `show`; `world.time`, `energy`, `momentum`, `awake`, `contacts` are readable.

## R2. Exact film (design 10)

1. The physics step is a whole number of solver steps (default 1/120 s); other values are refused (errors B005).
2. Results are the same on replay, on seek and on every browser: own `sin`, `cos`, `atan2`, `exp`, `pow`; fixed id order everywhere; seeded randomness only.
3. Checkpoints every 0.5 s hold the full world (warm-start impulses and sleep timers included), capped at 32 MB with thinning.
4. A seek loads the last checkpoint and steps forward; a far seek catches up over several frames with `catching_up`.
5. Slider changes follow `rerun`; drags (`Grab`) and `Push` are logged and saved as `@input` lines; replays match.
6. When steps fall behind, the film slows (`physics_behind`) and never changes.

## R3. Joints, forces and events (design 2.4, 6.5, 12)

1. `Hinge` (motor, torque, limits), `Spring` (k, rest, damping, anchors), `Rope`, `Rod`, `Weld` (breaks), `Slider`, `Pulley`, `Grab`, each between two bodies or a body and a solid shape.
2. `j.force`, `j.length`, `j.angle`, `j.broken`.
3. Forces are counted per kind; `world with show = "forces"` and `b with show = …` draw them.
4. `Push`, `Wake`, `Sleep` actions, also in handlers. `Restart()` resets bodies.
5. `on b hit: …` with `hit.speed`, `hit.point`, `hit.other`, `hit.impulse`, one per new contact faster than 0.05 m/s.
6. `Energy`, `Momentum`, `KineticEnergy`, `PotentialEnergy`, `Forces`.

## R4. Studio and embed, 2D (ui.md)

1. Bodies, solid shapes and joints draw as in ui.md 7; force, speed and contact arrows as in ui.md 5.
2. The film opens paused; the player bar shows for physics; "catching up" and "slow" marks.
3. Dragging a body at `t = 0` moves its start; while playing it grabs. Arrow keys push the selected body.
4. Algebra rows show live body, joint, world and liquid values.
5. A Physics tool group writes the lines of ui.md 3.
6. A physics row in the performance panel.
7. Examples: ramp, tower, dominoes, see-saw, Newton's cradle, wrecking ball, clicking ball, car on hills, catapult.

## R5. 3D bodies (design 7)

1. `Body` on spheres, boxes, cubes, cylinders, cones, prisms, pyramids and convex polyhedra gives `Body3`. Dented polyhedra are refused (B003).
2. Quaternion turn, inertia tensors, contact manifolds of at most 4 points, GJK and EPA for general convex pairs.
3. The floor from `Ground()` in space, and terrain from a solid `z = f(x, y)`.
4. Drawn in the Space view with drag and grab.
5. Examples: falling dice, dominoes, balls rolling on a surface.

## R6. Vehicles (design 8)

1. `Wheel` and `Vehicle` with ray wheels in 3D, wheel bodies on sliders in 2D.
2. `motor`, `steer`, `brake`, `power`, `speedometer`; arrow keys drive in the Space view.
3. Wheels with `breaks` come off as free bodies; welds break.
4. Examples: drive a car, a car hits a wall.

## R7. Liquids, water, waves, smoke (design 9)

1. `Liquid` and `Pour` (position-based fluids, 2D and 3D) hit and push solids and bodies.
2. `Water` gives buoyancy and drag; `Waves` a wave grid; `Smoke` a stable-fluids grid.
3. Liquids run in a worker when the host has one.
4. Examples: floating boat, ice, dam break, filling a glass, splash, boat on waves, smoke past a ball, candle.

## R8. Errors and modes (errors.md)

1. Every error B001 to B019, every undefined reason and notice in errors.md 4 to 6.
2. Command group `physics` allowed in Classic, Graphing, Geometry and 3D only.

## R9. Speed (design 11)

1. One level for every computer: the limits of 11.3 everywhere.
2. Every budget of 11.2 in Node at a quarter of the budget, and in Chrome with the CPU slowed 4 times at the full budget, the cloth rows and the worker's 8 ms among them.
3. Every check of 11.4 and 11.5.

## R10. Cloth (design 9.5, 9.6, 12.1)

1. `Cloth` in space (a sheet), and in the plane (a rope that bends, a net); `Pin` to the world or to a body; `world with wind`.
2. XPBD with 4 small steps a step: stretch, shear and bend links, compliance from `stretch` and `bend`, `damping`, `tears`, sleep.
3. Two-way hits with solids, bodies (equal and opposite impulse), liquid drops (against triangles) and, with `self = true`, itself.
4. A world with cloth or liquid runs whole in the physics worker; without a worker the same steps run on the page and give the same film.
5. A WebGL 2 painter for cloth and drops in the Space view; without WebGL 2 the software painter draws every second point.
6. Drag grabs the nearest point (logged); a drag at the start moves the cloth's start.
7. Examples: a flag in the wind, a sheet on a ball, a swinging rope, a hammock, a net that tears, a cloth that catches water.
