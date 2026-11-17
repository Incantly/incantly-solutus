# Physics: design

Status: proposed, for review by the product owner. This is the "bodies and collisions" area that the core design keeps for later (core 7.4, wave 4) and that `docs/features/animation-time/design.md` 7.9 reserves room for. It covers rigid bodies, friction, joints, vehicles, liquids and smoke, in 2D and in 3D.

The engine is our own TypeScript code. No physics library is on the allowed list (`docs/design/libraries.md`), and adding one needs the product owner's approval. We may reuse ideas and code from our own legacy kit on `legacy/v1` (`packages/core/src/kits/physics2d/`), which we wrote: a sequential-impulse solver with warm starting, joints, a liquid tank and force accounting, at a fixed step of 1/120 s and at most 60 bodies.

## 1. What the learner and the teacher get

### For the learner

- Make any shape solid and drop things on it: a ramp, a floor, a bowl, the graph of `sin(x)`.
- Turn a shape into a body with a mass. Gravity pulls it, it slides, rolls, bounces and stops by friction.
- Change friction, bounce, mass or gravity with a slider and see the result at once.
- Connect bodies with hinges, springs, ropes and welds to build a see-saw, a pendulum, a chain, a cradle or a car.
- See the forces that act: gravity, the push of the ground, friction, rope tension and the net force, as arrows.
- Drive a car with sliders and crash it into a wall, in 2D or 3D.
- Pour water into a glass, break a dam, float a boat, blow smoke past a ball.
- Pause, seek and replay. A film plays out the same every time and on every computer.

### For the teacher (the live AI voice)

- "Drop a ball on a ramp" is two or three short lines.
- Every body, joint and liquid is a named object with readable values (`b.speed`, `b.energy`), so the teacher can say what happened from the `figure` result.
- Errors say exactly what to fix, as everywhere else (section 3 of `errors.md`).

### Out of scope here

- Soft bodies, cloth and ropes that bend along their length (a rope here is a length limit between two points).
- Breaking shapes into pieces, other than welds that break.
- Exact simulation for engineering. The engine is built for lessons: stable, honest and fast. Accuracy targets are in section 12.

## 2. Everything the physics layer offers (full list, in our syntax)

### 2.1 Three parts a shape can play

| Part | How it is written | What moves it | Pushed by bodies? |
|---|---|---|---|
| **Wall** | `p with solid = true`, where `p` does not move | Nothing | No |
| **Mover** | `p with solid = true`, where `p` reads a slider, `t`, a state or a dragged point | Its own definition | No, but it pushes bodies |
| **Body** | `b = Body(p, mass = 2)` | The physics | Yes |

A wall and a mover are the same thing: a solid shape that follows its definition. The engine finds out each step whether it moved, and gives it a speed from the move, so a moving paddle hits a ball properly.

`with solid = true` works on every flat shape the figure already has:

| Shape | Becomes |
|---|---|
| `Polygon`, `Box` | A solid block |
| `Circle` | A round post |
| `Segment`, `Polyline` | A thin wall, solid from both sides |
| `Line`, `Ray` | An endless thin wall |
| `Arc`, `Curve`, a function graph `f(x) = …` | A chain of thin walls along the curve: hills, a bowl, a loop |
| `Ellipse` | A solid oval |

A body copies its shape once. That is the one rule that keeps definitions honest. If `p = Polygon(A, B, C)` became a body directly, physics would move it and `p`'s definition (the polygon through `A`, `B`, `C`) would stop being true. So `Body(p)` makes a new object `b`. At the film start `b` takes the shape and place of `p`. After that the physics owns `b`'s place, turn and speed. `p` is hidden by default and stays editable: changing `p` changes `b`'s start (section 5.3).

### 2.2 Object types

| Type | What it is | Value (plain data) |
|---|---|---|
| `Body` | A rigid body in the plane | Shape in its own frame, `pos: Point`, `angle`, `speed: Vector`, `spin`, `mass`, `asleep` |
| `Body3` | A rigid body in space | Shape in its own frame, `pos: Point3`, turn as a quaternion, `speed: Vector3`, `spin: Vector3`, `mass`, `asleep` |
| `Joint` | A link between two bodies, or a body and a wall | Kind, anchors, current length or angle, `force`, `broken` |
| `Vehicle` | A chassis with wheels | Chassis body, wheel states, `speedometer` |
| `Liquid` | Liquid particles | Particle positions and speeds (typed arrays), `count`, `level` |
| `Water` | A still or waving body of water | Surface height or grid |
| `Smoke` | Smoke on a grid | Density and flow grid |
| `World` | The one physics world of a figure | Gravity, step, solver passes, `time`, `energy` |

Type names are registered in `AreaTypeNames` (`packages/kernel/src/contracts/values.ts`).

### 2.3 The world: the reserved object `world`

Each figure has one physics world. It exists once the figure has a body, a solid shape, a liquid or smoke. Like the camera object `space` in 3D (`docs/features/space-3d/design.md` 8.1), the world is a reserved object whose properties are its settings:

```text
world with gravity = (0, −9.8)          # the default; (0, 0, −9.8) in space
world with gravity = (0, −g)            # a formula: g can be a slider
world with air = 0.02                   # air drag on every body, per second
world with passes = 8                   # solver passes (1 to 20)
world with timestep = 1/120                 # seconds per step (1/60 to 1/480)
world with sleep = false                # keep every body awake
```

| Property | Type | Default | Allowed |
|---|---|---|---|
| `gravity` | `Vector` or `Vector3` | `(0, −9.8)` / `(0, 0, −9.8)` | any finite vector |
| `air` | `Number` | `0` | 0 to 10 |
| `passes` | `Number` | `8` | integer 1 to 20 |
| `timestep` | `Number` | `1/120` | `1/n`, `n` from 60 to 480, and a whole number of solver steps (section 10.1) |
| `sleep` | `Bool` | `true` | |
| `range` | range `a..b` | `−50..50` | the world's size in every direction; bodies and particles that leave it are removed (`errors.md` 5) |
| `show` | `Text` | `"bodies"` | `"bodies"`, `"forces"`, `"speeds"`, `"contacts"`, `"none"` |

Read-only values: `world.time`, `world.energy` (kinetic plus potential of every body), `world.momentum`, `world.awake` (bodies awake), `world.contacts`.

`world = …` is refused with `reserved_name`, like `space = …` in a figure that is not 3D.

### 2.4 Commands: the physics group

All commands are in a new command group `physics` (section 15).

**Shapes made for physics** (plain geometry; they are useful outside physics too):

| Command | Forms | Result |
|---|---|---|
| `Box` | `(centre: Point, w: Number, h: Number)`, named `angle` | `Polygon` |
| `Box` | `(centre: Point3, w: Number, d: Number, h: Number)` | `Polyhedron` (a cuboid) |
| `Ground` | `()` the line `y = 0`; `(y: Number)`; in space `()` the floor `z = 0` | `Line` or `Plane`, already solid |

**Bodies:**

| Command | Forms | Result |
|---|---|---|
| `Body` | `(shape)` with `mass` or `density` named; shape is a `Polygon`, `Circle`, `Ellipse`, `Box` or a closed `Polyline` | `Body` |
| `Body` | `(shape3)` where the shape is a `Sphere`, `Cube`, `Box`, `Cylinder`, `Cone`, `Prism`, `Pyramid` or any convex `Polyhedron` | `Body3` |
| `Bodies` | `(shapes: List)` | `List<Body>`, each with the same named settings |

Body properties (all accept formulas; section 5.4 says when a change takes effect):

| Property | Type | Default | Meaning |
|---|---|---|---|
| `mass` | `Number` | from `density` | kg |
| `density` | `Number` | `1` | kg per m² (2D) or m³ (3D); gives `mass` from the area or volume |
| `speed` | `Vector` / `Vector3` | `(0, 0)` | speed at the start |
| `spin` | `Number` / `Vector3` | `0` | turning speed at the start, radians per second |
| `bounce` | `Number` | `0.2` | 0 (no bounce) to 1 (a perfect bounce) |
| `friction` | `Number` | `0.4` | the friction number μ, 0 to 2 |
| `force` | `Vector` / `Vector3` | `(0, 0)` | a steady push, may read the body itself (`(0, −k * b.y)`) |
| `torque` | `Number` / `Vector3` | `0` | a steady turning push |
| `fixed` | `Bool` | `false` | `true` pins the body where it is; it still blocks others |
| `turns` | `Bool` | `true` | `false` keeps the body from turning (a sliding block) |
| `bullet` | `Bool` | `false` | extra checks for a very fast body (section 6.6) |
| `group` | `Number` | `0` | bodies with the same non-zero group never hit each other (car parts) |
| `charge` | `Number` | `0` | electric charge, for lessons on forces between charges |
| `show` | `Text` | from `world.show` | arrows for this body only: `"forces"`, `"speeds"`, `"none"` |

Values a figure can read from a body:

| Read | Type | Meaning |
|---|---|---|
| `b.pos`, `b.x`, `b.y`, `b.z` | | the centre of mass |
| `b.angle` | `Number` | turn in the plane (2D only) |
| `b.speed` | `Vector` / `Vector3` | velocity |
| `b.v` | `Number` | size of the velocity |
| `b.spin` | `Number` / `Vector3` | turning speed |
| `b.energy` | `Number` | kinetic plus potential energy |
| `b.momentum` | `Vector` / `Vector3` | `mass * speed` |
| `b.shape` | `Polygon`, `Circle`, … | the shape where it is now, so `Area`, `Vertices`, `Distance` work on it |
| `b.force(kind)` | `Vector` | the force of one kind in the last step: `"gravity"`, `"normal"`, `"friction"`, `"tension"`, `"spring"`, `"buoyancy"`, `"drag"`, `"electric"`, `"applied"`, `"net"` |
| `b.touching` | `List` | the bodies and walls it touches |
| `b.asleep` | `Bool` | |

`Trace(b)` draws the path of its centre, as for any point (`docs/features/animation-time/design.md` 9).

**Actions** (allowed in `on` handlers, `docs/features/controls-scripting/`):

| Command | Effect |
|---|---|
| `Push(b, impulse)` | One kick, in N·s, at the centre |
| `Push(b, impulse, at)` | A kick at a point, so the body also starts to turn |
| `Wake(b)`, `Sleep(b)` | Wake a body, or put it to sleep |
| `Restart()` | Already in the animation area; also puts every body back at its start |

Each action while playing is an entry in the input log, so a replay is exact (section 10.4).

**Joints:**

| Command | Forms | What it does |
|---|---|---|
| `Hinge` | `(a, b, at: Point)`; named `motor` (rad/s), `torque` (max N·m), `min`, `max` (angle limits) | `a` and `b` turn about a shared point: a door, a see-saw, an arm |
| `Spring` | `(a, b)`; `(a, b, k)`; `(a, b, k, rest)`; named `damping`, `pa`, `pb` (anchors on each body) | A spring of stiffness `k` N/m |
| `Rope` | `(a, b, length)`; named `pa`, `pb` | The distance can be at most `length` |
| `Rod` | `(a, b)`; named `pa`, `pb` | The distance stays fixed |
| `Weld` | `(a, b)`; named `breaks` (N) | `a` and `b` move as one; it breaks above `breaks` |
| `Slider` | `(a, b, axis: Vector)`; named `min`, `max`, `motor` | `b` slides along a line fixed in `a`: a piston |
| `Pulley` | `(a, b, P, Q, ratio)` | A rope over two fixed points |
| `Grab` | `(b, target: Point)` | A stiff spring that pulls `b` toward a moving point; the drag gesture uses it (`ui.md` 4) |

`a` or `b` may be a wall or mover (a solid shape), which acts as a body with no motion. Joints also work in space with `Point3` anchors (`Hinge` then takes an axis: `Hinge(a, b, at, axis)`).

Values: `j.force` (the force it carries), `j.length`, `j.angle`, `j.broken`.

**Vehicles:**

| Command | Forms |
|---|---|
| `Wheel` | `(chassis, at, r)`; named `spring` (N/m), `damping`, `travel` (m), `grip`, `drive` (`true` or `false`), `steers` (`true` or `false`), `breaks` (N) |
| `Vehicle` | `(chassis, wheels: List)`; named `motor` (−1 to 1), `steer` (angle), `brake` (0 to 1), `power` (W) |

The usual way to write a car is four `Wheel` lines and one `Vehicle` line. `motor`, `steer` and `brake` are formulas, usually sliders, so the learner drives. Section 8 says how it works.

**Liquids, water and smoke:**

| Command | Forms | What it is |
|---|---|---|
| `Liquid` | `(region, count)`; named `viscosity`, `density`, `color` | Liquid particles that fill `region` (a polygon or a box) at the start |
| `Pour` | `(at: Point, rate, speed)`; named `max` | A tap: adds particles over time, up to `max` |
| `Water` | `(level: Number)`, `(region, level)` | Still water: bodies float by Archimedes' rule, cheap |
| `Waves` | `(box: Polyhedron, n)` in space; `(segment, n)` in the plane | A water surface on an `n` by `n` grid (or `n` points) that waves when hit |
| `Smoke` | `(region, n)`; named `source`, `heat`, `wind` | Smoke and air on an `n` by `n` grid in a box of the plane |

All of them hit solid shapes and bodies (section 9).

**Events.** The controls area's handlers gain one event:

```text
on b hit if hit.other == floor: Note(note("C5"), 0.1)
on b hit: c with color = red
```

The guard uses the controls area's `if` (`docs/features/controls-scripting/design.md`). In a `hit` handler, `hit.speed`, `hit.point`, `hit.other` and `hit.impulse` are readable. A body that stays in contact does not keep firing: one hit per new contact, and none for contacts slower than 0.05 m/s (resting).

### 2.5 Measures for lessons

| Command | Gives |
|---|---|
| `Energy(b)`, `Energy(world)` | kinetic + potential (+ spring) energy |
| `Momentum(b)`, `Momentum(world)` | total momentum |
| `KineticEnergy(b)`, `PotentialEnergy(b)` | the parts |
| `Forces(b)` | a list of the force vectors that acted last step, with kinds |

### 2.6 Tools the learner can pick

A new "Physics" tool group (in `docs/features/tools-2d/` and `space-3d`): Make solid (click shapes), Make body (click a shape), Hinge (click two bodies, then the point), Spring, Rope, Weld, Push (drag an arrow from a body), Water (drag a level). Each tool writes the same lines a person would type. Details in `ui.md` 3.

## 3. How the reference app does it, in plain words

From the animation and time study (`docs/features/animation-time/design.md` 2, "Physics"): the reference app has no physics engine. People build motion from a time slider, from lists of Euler steps, from an ODE command that returns a fixed curve, and from hand-written `if` formulas for bounces. There are no contacts, no joints and no collisions. Energy is up to the author. A "what if" means rebuilding the list.

What we keep: the idea that motion is driven by values in the figure. What we add: a real engine, in the same language, that seeks and replays exactly.

## 4. Principles

1. **One line, one change.** Every body, joint and setting is one line. A bad line changes nothing.
2. **Shapes stay honest.** A shape follows its definition. Only a `Body` is moved by physics, and it is a new object.
3. **The film is exact.** A fixed step, our own maths functions, a stable order and checkpoints make a film play the same on every replay, every seek and every computer (section 10).
4. **One speed level for every computer.** The engine is sized for a slow 4 GB laptop, and every computer gets the same counts and the same results. A fast computer just has time to spare (section 11).
5. **Honest physics, visible.** Forces are counted per kind, so the arrows show the forces that really acted.
6. **Nothing throws.** A world that blows up makes its bodies undefined with a reason; the figure keeps running (`errors.md` 4).
7. **No DOM in the engine.** It lives in the kernel, runs in Node, a worker and on mobile.

## 5. How physics fits the kernel

### 5.1 Bodies are states the solver owns

The kernel's solver already owns `state()` values and their checkpoints (`animation-time/design.md` 7). A body is a state too, with a special stepper. The physics world is one more group in the solver:

- The figure's object graph holds `b` as an object whose value at film time `t` is read from the world at `t`.
- `b`'s inputs are its shape, its properties and the world settings. They are read like rate inputs: through the solver's input log (5.4).
- Other objects can read `b` (`Text(b.v)`, `Segment(b.pos, P)`, a speed graph). They update after each frame's physics steps, in kernel order.

### 5.2 What reads what in a step

A step at time `t_n` reads every input at `t_n`: mover positions, formula forces, `world.gravity`, slider values and state values. Then it moves bodies to `t_{n+1}`. A force formula that reads the body itself (`force = (0, −k * b.y)`) reads the body at `t_n`. So there is no loop in the graph, and no `cycle` error, as long as the reading goes through the step. A body's **shape** or **mass** that reads the body itself is a real loop and gives `cycle`.

`state()` rates may read bodies, and body forces may read states. Both read the other's value at the start of the step. This is the same rule as above, and it is exact on replay.

### 5.3 The start of the film

At `t = 0` (or at `Restart()`):

1. Each body takes its shape's current definition: the shape in its own frame, its centre of mass, its turn, its mass and inertia.
2. Each body takes `speed` and `spin` as its start values.
3. Joints take their anchors from where the bodies are.

While the film is at `t = 0` and paused, changing the source shape (dragging a corner of `p`) moves the body's start. The body redraws at once. After the film starts, a change to `p` is a change to an input (5.4).

### 5.4 Changing things while playing

Every change to a physics input while playing or paused at `t > 0` goes through the input log, with the `rerun` policy of the animation area (`animation-time/design.md` 8):

| What changes | Default `rerun` | What happens |
|---|---|---|
| A slider read by `friction`, `gravity`, `motor`, a force | `restart` (kernel ruling K12) | the film replays from 0 with the new value |
| Same, with `with rerun = continue` on the slider | `continue` | from this moment on |
| The learner drags a body | always `continue` | a `Grab` acts from now on, logged with every pointer move |
| `Push(b, …)` in a handler | always `continue` | applied at the next step, logged |
| A mover's point is dragged | `continue` | the mover moves from now on and pushes bodies |
| A line redefines a body, joint or the world | rebuild | checkpoints are dropped, the film replays from 0 |

The log is saved as `@input` lines, so a recorded lesson replays the same. A grab is saved as `@input grab b 1.2 3.4 at 5.25`, one line per logged pointer move, thinned to at most 30 a second.

### 5.5 Undefined inputs

If a body's shape is undefined at the start (its points are undefined), the body is undefined with reason `input_undefined` and takes no part. If a force or a property formula is undefined during the film, the step uses `0` for a force and the last good value for a property, and the body gets a notice `input_undefined` once.

## 6. The 2D engine

The engine is in `packages/kernel/src/physics/`. It is plain arithmetic on typed arrays. It has no DOM, no timers and no wall clock.

### 6.1 Data layout

- Bodies live in one structure of arrays: `Float64Array`s for position, angle, speed, spin, inverse mass, inverse inertia, and the friction and bounce numbers; `Int32Array`s for flags, shape index and island.
- Shapes are stored once in their own frame. A body's world-space shape is computed into a scratch buffer only when needed.
- No objects are made during a step. Every buffer is made when the world is built or grows, and grows by doubling. So a step never makes garbage, and the browser never pauses to collect it.

### 6.2 Step order

Each step of `h = world.step` seconds:

1. **Inputs.** Read movers (their new pose and the speed implied by the move), formula forces, gravity, joint settings and the input log entries due at this step.
2. **Forces.** Add gravity, air drag, steady forces, springs, charge forces and buoyancy to each awake body's speed (semi-implicit Euler: speed first, then position).
3. **Broad phase.** Find pairs whose boxes overlap (6.3).
4. **Narrow phase.** For each pair, find contact points with their normal, depth and feature ids (6.4).
5. **Warm start.** Each contact point that existed last step starts with last step's impulses.
6. **Velocity passes.** `world.passes` passes over joints and contacts (sequential impulses): push apart, bounce, friction, joint limits and motors (6.5).
7. **Move.** Positions and angles move by speed times `h`.
8. **Position passes.** Three passes that remove leftover overlap without adding speed, so nothing gains energy.
9. **Sleep.** Islands that stayed still long enough fall asleep (6.7).
10. **Count forces.** Store each kind of force on each body, for the arrows and `b.force(kind)`.
11. **Events.** Collect new hits for `on … hit` handlers. Handlers run after the step, through the controls area, as one batch.

### 6.3 Broad phase

Sweep and prune on the x axis: body boxes are kept sorted by their left edge, and the sort is a stable insertion sort, which is near free when little moves between steps. Pairs are reported in the order (lower id, higher id), sorted, so the order never depends on the run. Sleeping pairs are skipped. Walls are long, so curve walls are split into short pieces, each with its own box.

### 6.4 Narrow phase

| Pair | Method |
|---|---|
| circle – circle | distance |
| circle – polygon | closest feature |
| polygon – polygon | separating axis test, then clip the incident edge (up to 2 points) |
| any – thin wall piece | the same as a polygon with two corners and both sides solid |
| ellipse | treated as a polygon of 24 sides for contacts; drawn as an ellipse |

Polygons with dents (concave) are split once, when the body is made, into pieces with no dents: ear clipping, then merging pieces while they stay without dents. The split shapes share one body. A notice `split_shape` says how many pieces were made. A polygon whose edges cross is refused (`errors.md` 3).

Contact points carry feature ids (which edge and which corner made them), so a point keeps its warm-start impulse from step to step.

### 6.5 Solver

Sequential impulses with warm starting, as in our legacy kit:

- **Push apart:** a contact may only push, never pull. The impulse is clamped so the total stays zero or more.
- **Bounce:** at a new hit faster than 1 m/s, the target separation speed is `bounce` times the approach speed. Slower hits do not bounce, so resting bodies settle. The pair's bounce is the larger of the two.
- **Friction:** the sideways impulse is clamped to `μ` times the push-apart impulse (Coulomb's rule). The pair's μ is `sqrt(μa * μb)`. One μ is used for both sticking and sliding.
- **Joints:** each joint is one or two rows of the same kind. Motors are rows with a target speed and a max torque. Limits are one-sided rows, like contacts.
- **Order:** joints first, then contacts, each in a fixed order by id.

### 6.6 Fast bodies

A fast small body could jump over a thin wall in one step. Two guards:

1. **Speculative contacts.** A contact is made up to `|speed| * h` before the shapes touch. The solver lets the gap close but not go below zero. This stops most pass-through at no extra cost.
2. **Bullets.** A body with `bullet = true`, or any body faster than its own size per step, gets a sweep test against walls: the first time of touch within the step, found by bisection. The body is moved to that time, and the rest of the step continues.

### 6.7 Sleeping and islands

Bodies joined by contacts or joints form an island. An island whose bodies all moved slower than 0.01 m/s and 0.02 rad/s for 0.5 s falls asleep. A sleeping island costs nothing. It wakes when a body touches it, a joint to it changes, a force on it changes, or a mover near it moves.

The sleep timers are part of the world state, so sleeping is the same on replay.

### 6.8 Curves as ground

A function graph or curve with `solid = true` becomes a chain of short thin walls. The chain is sampled over its own domain, or over the clip range `world with range = -50..50` when the domain is endless, with at most 2,000 pieces. A curve that changes with a slider is sampled again when its value changes. Pieces are joined, so a ball rolls smoothly along the chain without catching on the joins (each piece knows its neighbours' corners).

## 7. The 3D engine

The 3D engine shares the 2D engine's step order (6.2), solver (6.5), sleep (6.7) and data layout (6.1). What differs:

- **Turn** is a quaternion, normalised after each step. Inertia is a 3 by 3 tensor in the body's own frame, from the shape (exact for spheres, boxes, cylinders and cones; from the faces for convex polyhedra).
- **Broad phase:** sweep and prune on the axis with the most spread, chosen when the world is built.
- **Narrow phase:**

| Pair | Method |
|---|---|
| sphere – sphere, sphere – plane | distance |
| sphere – box, sphere – convex | closest point |
| box – box | separating axis test (15 axes), then clip faces (up to 4 points) |
| convex – convex (cylinders, cones, prisms) | GJK for the distance, EPA for the depth, then a face clip for the points |
| any – heightfield (terrain) | the cells under the body, as triangles |

- **Contact manifolds** keep at most 4 points per pair: the deepest point and the three that span the largest area.
- **Ground** is the floor plane `z = 0` with `Ground()`. A surface `z = f(x, y)` with `solid = true` becomes a heightfield on a grid of at most 128 by 128 cells over the clip box (`space-3d/design.md` 8.7).
- **Cylinders and cones** are convex shapes with smooth sides. For contacts they are approximated by 24 sides; they are drawn round.

## 8. Vehicles

A car is a chassis body and wheels. We use **ray wheels**, which are the usual way for games and lessons, because they stay stable at speed:

1. Each wheel casts a ray from its mount on the chassis, down the chassis's own down direction, as long as `travel + r`.
2. If the ray hits the ground or a solid, the wheel's spring and damper push the chassis up at the mount.
3. The tyre's grip gives sideways and forward forces at the touch point, limited by `grip` times the spring push (the same friction rule as 6.5). `motor` drives the wheels marked `drive`, `brake` slows every wheel, and `steer` turns the wheels marked `steers`.
4. The wheel is drawn at the hit point, turned by its own spin.

**Crashes.** The chassis is a real body, so it hits walls and other bodies with the full solver. A wheel with `breaks = F` comes off when its spring force goes above `F`: it becomes a free `Body3` cylinder from that moment, with the wheel's speed and spin. A body made of welded parts (`Weld(a, b, breaks = 5000)`) breaks apart in a hard hit. So "a car hits a wall" shows a dented stop, flying wheels and loose parts, with forces that can be read.

In 2D the same `Wheel` and `Vehicle` make a side-view car on hills; the wheels are real circle bodies on `Slider` joints with springs, because in the side view the wheels must roll over bumps.

## 9. Liquids, water and smoke

### 9.1 Liquid particles (`Liquid`, `Pour`)

**Position-based fluids**, for 2D and 3D:

1. Predict each particle's new place from its speed and gravity.
2. Find neighbours on a uniform grid with cells as wide as the particle's reach. The grid is rebuilt each step by counting sort, which costs no garbage.
3. Two passes: move each particle so the local density matches the rest density.
4. Push particles out of solid shapes and bodies, and push bodies back with the equal and opposite impulse, so a box floats and a ball splashes.
5. New speed is the change in place over `h`, plus a little viscosity (smoothing neighbours' speeds).

This method stays stable at our fixed step, which is why we choose it. Particles that leave the world range are removed, with a notice `left_world` once.

### 9.2 Still water (`Water`)

Cheap buoyancy, from the legacy kit's tank: each body is clipped by the water line, and the part under it gives an upward push at its centre, plus water drag. This handles boats, ice and density lessons with no particles at all.

### 9.3 Waves (`Waves`)

A height grid that follows the wave equation, stepped with the same `h`. Bodies that touch the surface push it down and are pushed up (the buoyancy of 9.2 at the local height). It is drawn as a surface mesh in 3D or as a line in 2D.

### 9.4 Smoke (`Smoke`)

A grid of flow and smoke density, stepped by the stable-fluids method: carry the flow along itself, add heat as an upward force, make the flow lose no volume (20 pressure passes), then carry the smoke along the flow. Solid shapes and bodies block the flow, and moving bodies stir it. It is drawn as a shaded image on the board.

## 10. Time, exact replay and seeking

### 10.1 The step and the solver grid

The solver steps `state()` on a grid of `1/240` s (`animation-time/design.md` 7.3). The physics step must be a whole number of solver steps: the default `1/120` is two. If `@solver step` changes, the physics step must still divide evenly, or the line is refused with `bad_property_value`. Both step on the same integer counter, so they never drift apart.

Between physics steps, the screen shows bodies interpolated between the last two steps, so motion looks smooth at any frame rate.

### 10.2 Exact on every computer

JavaScript's `+`, `−`, `*`, `/` and `Math.sqrt` give the same answer on every browser. `Math.sin`, `Math.cos`, `Math.atan2`, `Math.exp` and `Math.pow` do not have to. So:

1. The engine uses its own `sin`, `cos`, `atan2`, `exp` and `pow`, written with only exact operations, in `packages/kernel/src/physics/math.ts`.
2. Every loop over bodies, pairs and contacts runs in id order. No order comes from a hash or an unordered set.
3. No randomness, except `seed`-based numbers from the probability area's seeded generator (for example where `Pour` puts each drop).
4. Formulas the user writes (forces, motors) are run by the kernel's compiled functions. Those use `Math.sin` today. For exact replay across browsers, the compiled-function maths in the kernel switches to the same functions in `math.ts`. This is a change to the core (section 16).

A test runs the same 60 s film in Chrome, Firefox and Safari and compares a hash of the world every second (section 11.4).

### 10.3 Checkpoints

The world is saved every 0.5 s of film time, with the solver's checkpoints. A checkpoint holds everything a step reads: every body's pose, speed and spin, sleep timers, the warm-start impulses of every contact point, joint state, wheel spin, liquid particles, the water and smoke grids, and the input log index. Without the warm-start impulses a replay would not match, so they are kept.

Size, at full Float64 precision:

| Scene | Per checkpoint | 60 s film (120 checkpoints) |
|---|---|---|
| 300 bodies in 2D, about 2 contacts each | about 45 KB | about 5.4 MB |
| 100 boxes in 3D | about 25 KB | about 3 MB |
| 2,000 liquid particles in 2D | about 64 KB | about 7.7 MB |
| 2,000 liquid particles in 3D | about 96 KB | about 11.5 MB |
| A 64 by 64 smoke grid | about 100 KB | about 12 MB |

A figure may use at most **32 MB** for physics checkpoints. Past that, the oldest half of the checkpoints is thinned to every 1 s, then every 2 s, with a notice `checkpoints_thinned`. Seeking into a thinned part takes longer (section 11.2).

### 10.4 Seeking

Seek to `t`: load the last checkpoint at or before `t`, then step forward to `t` (at most 60 steps of 1/120 s). A figure that was just loaded computes checkpoints ahead in idle slices, at most 5 ms each, so the first seek is fast too. While the world is behind, the player shows "catching up", as for states (`animation-time/design.md` 8.5).

### 10.5 Falling behind

If one frame's steps take too long, the frame runs at most 4 steps. The film clock then runs slower than real time, and the player bar shows a small "slow" mark (`physics_behind`, once). The steps themselves never change, so the result is the same, only later. A slow computer never gets a different film.

## 11. Speed

### 11.1 One level for every computer

The engine runs the same counts, the same passes and the same step on every computer. The budgets below are sized so a slow 4 GB laptop meets them. A fast computer meets them with time to spare.

**How "a slow laptop" is measured.** Every budget is checked twice:

1. In Node, on the build machine, as a normal bench (`packages/kernel/bench/physics.bench.ts`). Target: a quarter of the budget.
2. In Chrome, with the CPU slowed 4 times (the DevTools CPU throttle, driven from the bench script). Target: the full budget. A 4 times slower CPU is about a low-end laptop with 4 GB of memory.

Memory is not the limit on such laptops. Every scene below uses under 40 MB including checkpoints. The CPU is the limit.

### 11.2 Budgets

At 60 frames a second, a frame is 16.7 ms. Physics gets at most **6 ms** of it; drawing and the rest of the kernel need the other 10 ms. At the default step of 1/120 s, one frame is 2 steps.

| Scene | Count | Physics per frame (Chrome, CPU 4× slower) | Node, normal speed |
|---|---|---|---|
| Apply one physics line | 1 | under 1 ms | under 0.25 ms |
| 2D bodies, all awake (a pile-up) | 300 | 6 ms | 1.5 ms |
| 2D bodies, most asleep | 1,000 (100 awake) | 3 ms | 0.75 ms |
| 2D chain of hinges | 200 links | 4 ms | 1 ms |
| 2D car on hills | 1 car, 2,000 ground pieces | 0.5 ms | 0.12 ms |
| 3D boxes, all awake | 100 | 6 ms | 1.5 ms |
| 3D car with terrain | 1 car, 128 × 128 ground | 0.5 ms | 0.12 ms |
| 2D liquid, in a worker | 2,000 particles | 6 ms | 1.5 ms |
| 3D liquid, in a worker | 2,000 particles | 6 ms | 1.5 ms |
| Waves | 64 × 64 | 1 ms | 0.25 ms |
| Smoke | 64 × 64 | 3 ms | 0.75 ms |
| Seek anywhere in a 60 s film, 300 bodies, warm | | 100 ms | 25 ms |
| Seek anywhere in a 60 s film, 2,000 particles, warm | | 250 ms | 60 ms |
| Restart a 60 s film with 300 bodies | | catches up within 1 s, film shown at once | |

### 11.3 Hard limits

These are the same on every computer. Over a limit, the line is refused with `limit` (`errors.md` 3).

| Item | Limit per figure |
|---|---|
| Bodies (2D and 3D together) | 1,000 |
| Joints | 1,000 |
| Liquid particles (all `Liquid` and `Pour` together) | 2,000 |
| Wave grid | 64 × 64 |
| Smoke grid | 64 × 64 |
| Ground pieces from curves | 2,000 per curve |
| Contact points | 4,000; past that, the deepest are kept, with a notice `contacts_dropped` |
| Physics checkpoints | 32 MB (10.3) |

The limits are deliberately below what a fast computer could do. That is the price of one level for every computer, and it buys the same film everywhere.

### 11.4 What the benches check

Speed on average is not enough. The physics bench suite checks all of these, and CI fails on a regression past 10% (`docs/design/performance.md` 6):

| Check | What it measures | Pass |
|---|---|---|
| Worst frame | The slowest frame of a 60 s film, not the mean | within the budget of 11.2 |
| Pile-up | 300 boxes dropped at once on a floor, the slowest second | 6 ms a frame |
| Calm stack | A tower of 20 boxes for 60 s | the top box moves under 1 mm, no box falls |
| Pyramid | 210 boxes in a pyramid for 60 s | stands, all asleep within 3 s |
| No pass-through | A ball of radius 0.05 at 100 m/s at a wall 0.01 thick, 1,000 shots | never passes |
| Energy | A ball with `bounce = 1` and no air, 1,000 bounces | top height within 1% |
| Energy, joints | A hinge pendulum swinging for 1,000 s | energy within 2% |
| Same result | One film twice, and on Chrome, Firefox and Safari | world hash equal every second |
| Seek | Seek to 100 random times in a 60 s film | each within 11.2 |
| Long run | 10 minutes of film | memory stops growing after the checkpoint cap |
| Wake storm | One ball hits a sleeping pile of 500 | worst frame within budget |
| Worker cost | Sending the world from the worker to the page each frame | under 0.5 ms a frame for 2,000 particles |
| One line | `ball with bounce = 0.9` in a figure with 300 bodies | under 1 ms |
| No garbage | Steps of a 300-body world | no memory made during a step after the first second |

### 11.5 Accuracy checks (lessons must be right)

| Lesson | Check | Pass |
|---|---|---|
| Projectile | A body thrown with no air, against `y = v0 t − g t² / 2` | within 1 mm over 2 s |
| Incline | A block on a ramp of angle θ | sticks when `tan θ < μ`, slides when above, within 0.5° |
| Sliding block | Speed down a ramp against `g (sin θ − μ cos θ) t` | within 1% |
| Elastic hit | Two balls with `bounce = 1` | momentum and energy kept within 0.1% |
| Spring | A mass on a spring | period within 0.5% of `2π √(m / k)` |
| Pendulum | A `Hinge` pendulum against the `state()` pendulum | the same period within 0.5% |
| Newton's cradle | 5 balls on ropes, the end one lifted | one ball leaves the other end |
| Floating | A box of density 0.5 in `Water` | floats half under, within 2% |
| Car | A car at full motor on flat ground | reaches the speed set by `power` and drag, within 5% |

## 12. Drawing

- Bodies draw as their shape at their pose, interpolated between steps (10.1), with the shape's style. A sleeping body looks the same; the algebra row shows it is asleep.
- Force arrows (with `world with show = "forces"` or the style bar button) start at the centre of mass, one per kind, with the kind's colour and label; tension starts at the anchor. Speed arrows the same way.
- Joints draw thin: a hinge as a small ring, a spring as a zigzag, a rope as a line that sags when slack, a weld as a small cross.
- Liquid particles draw as one batch of discs in the liquid's colour (the particle painter, `animation-time/design.md` 10.8). A smooth surface (metaballs) is for later.
- Waves draw as a surface in the Space view, smoke as a shaded image under the shapes.
- 2D drawing is in `packages/sdk/src/screen/`, 3D in its Space painter, as for every area.

## 13. Where each part lives

| Part | Place |
|---|---|
| Engine: world, shapes, broad and narrow phase, solver, joints, vehicles, liquids, waves, smoke, checkpoints, exact maths | `packages/kernel/src/physics/` |
| Commands, types, properties, readouts, errors, reasons | `packages/kernel/src/commands/physics/` |
| Error kinds and undefined reasons | the kernel's registries (`contracts/errors.ts`, `contracts/values.ts`, `language/errors.ts`) |
| The `hit` event | `packages/kernel/src/commands/numbers/handlers.ts` (the controls handlers) |
| Command group `physics` and mode allow lists | `packages/modes` |
| Worker hosting for liquids and big worlds | `packages/sdk` |
| 2D and 3D drawing, the drag `Grab`, the style bar | `packages/sdk/src/screen/` |
| Tools, examples, the performance panel's physics row | `apps/studio` |
| Benches | `packages/kernel/bench/physics.bench.ts`, `packages/sdk/bench/physics.bench.ts` |

## 14. What we build first

Each round is one PR, with tests, examples in the studio and screenshots.

1. **2D bodies.** The world, `Body`, `Box`, `Ground`, `with solid = true` on every shape, movers, circles and polygons with dents, friction and bounce, sleep, checkpoints, seeking, exact maths. Examples: a ball on a ramp, a falling tower, dominoes.
2. **2D joints and forces.** `Hinge`, `Spring`, `Rope`, `Rod`, `Weld`, `Slider`, `Pulley`, motors, the force arrows, `Energy`, `Push`, the `hit` event. Examples: a see-saw, Newton's cradle, a wrecking ball, a ball that clicks when it bounces.
3. **2D in the studio.** The physics tools, dragging bodies with `Grab`, the style bar, the performance row, the 2D car. Examples: a car on hills, a catapult.
4. **3D bodies.** `Body3` for spheres, boxes, cylinders and convex solids, the floor, terrain from `z = f(x, y)`. Examples: falling dice, toppling dominoes, balls rolling down a surface.
5. **3D car and crashes.** `Wheel`, `Vehicle`, breaking wheels and welds. Examples: drive a car, a car hits a wall.
6. **Water and liquid in 2D.** `Water`, `Liquid`, `Pour`, the worker. Examples: a floating boat, density of ice, a dam breaking, filling a glass.
7. **Liquid and waves in 3D.** Examples: a splash, a boat on waves.
8. **Smoke.** Examples: smoke past a ball, a candle.
9. **Speed round.** The full bench suite of 11.4 and 11.5, in Node and in throttled Chrome, and the browser hash test.

## 15. Changes to other areas

- **Core design 7.4** is now designed here. The names change a little: the core named `Body`, `Wall`, `Spring`, `Joint`. We keep `Body` and `Spring`; a wall is `with solid = true`; `Joint` is the type of every link.
- **Animation and time 7.9** named `Bounce(y, v, floor, e)`. It is not needed: a body with `bounce = e` on a solid floor does it. The event slots of 7.9 are not used by physics, which keeps its own hit list.
- **Kernel:** compiled functions use the exact maths of `physics/math.ts` (10.2). Reserved names `world` and `hit`. A new undefined reason `unstable_world` and the notices in `errors.md` 5.
- **Controls and scripting:** a `hit` event, and `Push`, `Wake`, `Sleep` allowed in handlers (`STEP_ACTIONS`).
- **App modes:** a new command group `physics`, allowed in Classic, Graphing, Geometry and 3D. Scientific, Probability and CAS refuse it. Exam profiles may forbid it.
- **Performance (`docs/design/performance.md` 5):** the budget rows of 11.3.
- **Tools 2D and Space 3D:** a Physics tool group.

## 16. Better than the reference app

- A real engine with contacts, friction, joints, vehicles and liquids, where the reference app has none.
- Every part is a line in the same language, so formulas, sliders and the teacher drive it.
- Seek and replay are exact, and the same on every computer.
- Forces are counted per kind and drawn, so a lesson shows why a body moves.
- One speed level for every computer, so a lesson made on a fast laptop plays the same on a slow one.

## 17. Sources studied

- Our own legacy kit on `legacy/v1`, `packages/core/src/kits/physics2d/` (solver, joints, tank, force accounting).
- The reference app's motion workarounds, as studied in `docs/features/animation-time/design.md` 2.
- Public methods, used from their descriptions and not from any code: sequential impulses with warm starting (Erin Catto, GDC talks 2006 to 2014); separating axis tests, GJK and sweep and prune (Christer Ericson, *Real-Time Collision Detection*, 2005); expanding polytope depth (Gino van den Bergen, 2001); position-based fluids (Macklin and Müller, 2013); stable fluids (Jos Stam, 1999); ray wheels, as described in many public vehicle write-ups.
