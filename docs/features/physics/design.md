# Physics: design

Status: proposed, for review by the product owner. This is the "bodies and collisions" area that the core design keeps for later (core 7.4, wave 4) and that `docs/features/animation-time/design.md` 7.9 reserves room for. It covers rigid bodies, friction, joints, vehicles, liquids, smoke and cloth, in 2D and in 3D.

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
- Hang a flag in the wind, drop a sheet over a ball, swing a rope that bends, tear a net, soak a cloth in water.
- Pause, seek and replay. A film plays out the same every time and on every computer.

### For the teacher (the live AI voice)

- "Drop a ball on a ramp" is two or three short lines.
- Every body, joint and liquid is a named object with readable values (`b.speed`, `b.energy`), so the teacher can say what happened from the `figure` result.
- Errors say exactly what to fix, as everywhere else (section 3 of `errors.md`).

### Out of scope here

- Soft bodies that keep their volume (jelly, balloons). Cloth and bending ropes are in scope (section 9.5); a `Rope` joint stays a length limit between two points.
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
| `Cloth` | A sheet or a rope of points joined by links, in the plane or in space | Point positions and speeds (typed arrays), grid size, pins, torn links |
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
world with wind = (3, 0, 0)             # moving air: pushes cloth and smoke
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
| `wind` | `Vector` or `Vector3` | `(0, 0)` / `(0, 0, 0)` | any finite vector, m/s; a formula of `t` makes gusts |

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
| `Liquid` | `(region, count)`; named `viscosity`, `density`, `color` | Liquid particles that fill `region` at the start: a polygon in the plane, a box (convex `Polyhedron`) or a `Sphere` in space |
| `Pour` | `(at: Point, rate, speed)`, `(at: Point3, rate, speed)`; named `max` | A tap: adds particles over time, up to `max` |
| `Water` | `(level: Number)`, `(region, level)` | Still water: bodies float by Archimedes' rule, cheap |
| `Waves` | `(box: Polyhedron, n)` in space; `(segment, n)` in the plane | A water surface on an `n` by `n` grid (or `n` points) that waves when hit |
| `Smoke` | `(region, n)`; named `source`, `heat`, `wind` | Smoke and air on an `n` by `n` grid in a box of the plane |

All of them hit solid shapes and bodies (section 9). Readouts: `l.count`, `l.level` for a liquid; `wa.level` for still water; `w.level`, `w.speed` and `w.height(x, y)` for waves (9.3). `Waves` takes `damping` named, and in the plane `depth`.

**Cloth:**

| Command | Forms | What it is |
|---|---|---|
| `Cloth` | `(corner: Point3, u: Vector3, v: Vector3, nu, nv)` in space | A sheet of `nu` by `nv` points spanning `corner + s u + r v`, `s` and `r` from 0 to 1 |
| `Cloth` | `(a: Point, b: Point, n)` in the plane | A rope of `n` points from `a` to `b` that bends, swings and drapes |
| `Cloth` | `(box: Polygon, nu, nv)` in the plane | A net of `nu` by `nv` points over a box, seen from the side (a curtain, a hammock) |
| `Pin` | `(c: Cloth, at: Point or Point3)`, `(c, at, b: Body)` | Holds the cloth point nearest `at` still, or to a body, so the cloth moves with it and pulls on it |

Named arguments of `Cloth`:

| Name | Type | Default | Allowed | What it does |
|---|---|---|---|---|
| `mass` | `Number` | `1` | over 0 | Mass of the whole cloth in kg, shared by its points |
| `stretch` | `Number` | `1` | 0 to 1 | How hard the links resist stretching; 1 is cloth, 0.5 is rubber |
| `bend` | `Number` | `0.1` | 0 to 1 | How hard it resists folding; 0 is silk, 1 is card |
| `damping` | `Number` | `0.02` | 0 to 1 | Loss of speed per second, so a flag settles |
| `pins` | `Text` or `List` | none | `"top"`, `"left"`, `"corners"`, `"top corners"`, or a list of points | Points held still at the start; each becomes a `Pin` |
| `tears` | `Number` | none | 1.1 to 10 | A link breaks when stretched past this many times its length |
| `self` | `Bool` | `false` | | The cloth hits itself (costs more, section 11.2) |
| `thickness` | `Number` | `0.02` | 0.005 to 0.2 | How far points keep from solids, bodies and each other |
| `friction` | `Number` | `0.4` | 0 to 2 | Friction against solids and bodies |

Read-only values: `c.count` (points), `c.torn` (broken links), `c.stretchMax` (the most stretched link, as a ratio), `c.energy`, `c.at(i, j)` (a point, as `Point3` or `Point`), `c.asleep`, `c.touching`.

```text
flag = Cloth((0, 0, 3), (3, 0, 0), (0, 0, -2), 48, 32, pins = "left")
world with wind = (4 + 2 sin(3 t), 1, 0)
sheet = Cloth((-2, -2, 4), (4, 0, 0), (0, 4, 0), 32, 32, mass = 0.5)
ball = Sphere((0, 0, 1), 1) with solid = true
rope = Cloth((0, 5), (4, 5), 40, pins = [(0, 5)])
```

**Events.** The controls area's handlers gain one event:

```text
on b hit if other == "floor": Note(note("C5"), 0.1)
on b hit: c with color = red
```

The guard uses the controls area's `if` (`docs/features/controls-scripting/design.md`). In a `hit` handler, `speed` (m/s), `point`, `other` (the other object's name, as a text) and `impulse` (N s) are readable, as `value` and `self` are in other handlers. A hit runs its handlers once: a replay or a seek back over it does not run them again. A body that stays in contact does not keep firing: one hit per new contact, and none for contacts slower than 0.05 m/s (resting).

### 2.5 Measures for lessons

| Command | Gives |
|---|---|
| `Energy(b)`, `Energy(world)` | kinetic + potential (+ spring) energy |
| `Momentum(b)`, `Momentum(world)` | total momentum |
| `KineticEnergy(b)`, `PotentialEnergy(b)` | the parts |
| `Forces(b)` | a list of the force vectors that acted last step, with kinds |

### 2.6 Tools the learner can pick

A new "Physics" tool group (in `docs/features/tools-2d/` and `space-3d`): Make solid (click shapes), Make body (click a shape), Hinge (click two bodies, then the point), Spring, Rope, Weld, Push (drag an arrow from a body), Water (drag a level), Cloth (drag a box or a line), Pin (click a cloth). Each tool writes the same lines a person would type. Details in `ui.md` 3.

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

**Decisions taken when building it (round 5).**

- `Wheel(chassis, at, r)` in space: `at` is the wheel's centre at the start with its spring at full `travel`; the mount is `travel` above it. A car faces its chassis's own x axis; `steer` is an angle, left (towards +y) positive, at most 1.2 rad. Defaults: `spring` 30 N/m per kg of chassis, `damping` about half of critical, `travel` 0.6 r, `grip` 1, `mass` 4% of the chassis.
- The spring pushes along the ground's normal at the touch point. The tyre's forward and side impulses push the chassis at the wheel's hub, as an axle does, so a hard turn leans the car instead of rolling it over. Grip is a box of `grip` times the spring's push in each direction, the friction rule of the contacts in space (6.5).
- `motor` gives each driven wheel its share of `power` as a torque at its spin (at most what its grip can pass on); the wheel's spin is a state, saved in checkpoints.
- A wheel's load for `breaks` is its spring's push plus the force it takes to carry the wheel's own mass with the chassis, so a hard stop throws a wheel off as well as a hard landing. A wheel that comes off is a free round slab of 24 sides with the wheel's speed and spin; the wheel object becomes undefined with reason `broken`, and the car's value lists it under `loose` so it is still drawn.
- `Weld` in space breaks when its pull plus its turning push over the distance between the parts' centres goes over `breaks`.
- `Box(centre: Point3, w, d, h)` gives a cuboid in space (x, y and z sizes), turned by `angle` about z.
- Terrain is a heightfield of 128 × 128 cells over the clip box: the cells under a shape are tested, each triangle as a slab half a unit deep, culled by the slab's top plane and by the moving hull's own faces.
- A joint in space takes `Point3` anchors; `Hinge(a, b, at, axis)` and `Slider(a, b, axis)` take a `Vector3` axis. Joint forces count in `b.force("tension")` and `"spring"`; a wheel's in `"normal"` and `"friction"`.

In 2D the same `Wheel` and `Vehicle` make a side-view car on hills; the wheels are real circle bodies on `Slider` joints with springs, because in the side view the wheels must roll over bumps.

## 9. Liquids, water, smoke and cloth

### 9.1 Liquid particles (`Liquid`, `Pour`)

**Position-based fluids**, for 2D and 3D:

1. Predict each particle's new place from its speed and gravity.
2. Find neighbours on a uniform grid with cells as wide as the particle's reach. The grid is rebuilt each step by counting sort, which costs no garbage.
3. Two passes: move each particle so the local density matches the rest density.
4. Push particles out of solid shapes and bodies, and push bodies back with the equal and opposite impulse, so a box floats and a ball splashes.
5. New speed is the change in place over `h`, plus a little viscosity (smoothing neighbours' speeds).

This method stays stable at our fixed step, which is why we choose it. Particles that leave the world range are removed, with a notice `left_world` once.

Choices made while building it (round 6, `packages/kernel/src/physics/fluid2.ts`, `particles.ts`, `grid2.ts`):

- **One drop size per figure.** The first `Liquid` sets the spacing `d` that fills its region with its count on a square grid; a figure with only taps uses `d = 0.1` m. A drop reaches `1.8 d` (about ten neighbours at rest), and is a disc of radius `d / 2` against solids and bodies. A drop's mass is `density × d²`.
- **The start.** `Liquid` fills its region from the bottom row up, left to right; drops that do not fit stand in rows above it and fall in. `l.count` and `l.level` read at once, before the film runs. `l.level` is the middle of the column tops (one spacing wide), so a few splashing drops do not move it; with no drops it is undefined.
- **Density passes** push only where drops crowd (never pull at a free surface), are Jacobi over each pair once, and move a drop at most half a spacing a pass.
- **Taps.** `Pour(at, rate, speed)` lets out drops three abreast, with seeded jitter; a number `speed` is straight down, a vector is the direction. When `rate` is more than three lanes of drops one spacing apart can carry, they leave faster, so new drops never land on the last ones. `max` defaults to 500.
- **Walls.** A drop that crosses a thin wall in one step is put back on the side it started on, so a glass never leaks.
- **Viscosity** is XSPH smoothing, 0 to 1 (`0.01` default), with the weights of the last density pass.

Choices made for liquid in space (round 7, `packages/kernel/src/physics/fluid3.ts`, `grid3.ts`):

- **Forms.** `Liquid(region, count)` with a box (any convex `Polyhedron`) or a `Sphere`, and `Pour(at: Point3, rate, speed)`, where a number `speed` is straight down and a `Vector3` is the direction. A liquid's line is in space by its form, so a figure with a liquid or waves in space is a world in space even with no body yet. The drops' `density` is 1 by default, as water and bodies. The 2,000-drop limit counts every liquid of the figure, in the plane or in space.
- **Drop size.** The first `Liquid` sets the spacing `d` that fills its region with its count on a cubic grid (bottom layer first); with only taps `d = 0.1` m. A drop reaches `1.6 d` (18 neighbours on the grid, about 14 in a settled tank) and is a ball of radius `d / 2` against solids and bodies.
- **Neighbour grid.** Cubic cells as wide as the reach, counting sort, the 13 cells of one half searched round each cell, so each pair is found once. The pairs are listed on every second step and kept for the next one (a drop moves far less than its reach in a step, and the weights fade to nothing at the reach); a load or a drop that left lists them afresh. Checkpoints fall on listing steps (a whole number of rounds apart), so a seek lists them where the film did.
- **One density pass a step** (two in the plane). λ divides by the sum of the neighbours' gradients squared plus a small `eps`; the drop's own gradient (the sum of theirs, which nearly cancels where drops crowd, the only place λ acts) is left out. A second pass kept the volume no better (3.6% against 3.5% in a 1 m tank) and cost 0.25 ms a step, so space has one; crowded drops have larger gradients and move less, so a body that squeezes drops against the floor makes no jets.
- **Viscosity** smooths speeds on every second step, twice as strongly (at most 1): the same smoothing for half the work.
- **Walls and bodies.** After the pass, each drop is pushed out of bodies, then out of the floor, terrain and solids (walls win). Against a solid the drop's whole path this step is tested (it goes back out through the face it came in by, also when it started on that face, so a thin wall never leaks). Against a moving body a drop inside goes out through the nearest face; the body takes the equal and opposite impulse at the start of the next step, as in the plane.
- **Readouts.** `l.count`, `l.level` (the middle of the column tops, one spacing square), as in the plane. The drops' places are `xs`, `ys` and `zs` of the value.

### 9.2 Still water (`Water`)

Cheap buoyancy, from the legacy kit's tank: each body is clipped by the water line, and the part under it gives an upward push at its centre, plus water drag. This handles boats, ice and density lessons with no particles at all.

Round 6 (`packages/kernel/src/physics/water2.ts`): water has density 1. Before each body step, every awake body's shapes (a circle as 48 sides, its area kept) are clipped by the water line and by the water's region (a convex region, else its box); the weight of water under it pushes up at that part's centre, and drag of `2 × (mass of that water)` per second slows that part's speed and the body's turn. Both go into the step as impulses, and are counted as `buoyancy` and `drag`. A level that reads `t` or a slider is read at each step, so a tide lifts a boat.

In space (round 7, `packages/kernel/src/physics/water3.ts`): `Water(level)` is still water below the plane `z = level` (density 1). The part of each awake body under the plane is exact: a cap for a ball, the hull clipped by the plane for a convex hull. Its weight of water pushes up at its centre; drag of `2 × (mass of that water)` per second slows that part's speed and turn. A sleeping body keeps the forces it showed when it fell asleep, and they are kept in checkpoints, so a seek shows the same arrows.

### 9.3 Waves (`Waves`)

A height grid that follows the wave equation, stepped with the same `h`. Bodies that touch the surface push it down and are pushed up (the buoyancy of 9.2 at the local height). It is drawn as a surface mesh in 3D or as a line in 2D.

How it is built (round 7, `packages/kernel/src/physics/waves.ts`):

- **Forms.** `Waves(box: Polyhedron, n)` in space: an `n` by `n` grid over the box's floor plan, the water at rest up to the box's top, as deep as the box. `Waves(segment, n)` in the plane: `n` points along the segment, at its height, `depth` deep (named, 1 m). Both take `damping` (0 to 10 per second, 0.2 by default). The box itself is not solid; hide it with `visible = false`. At most 64 a side (B013); fewer than 2 is B017.
- **The step.** Each cell holds a height `u` and a speed `v`. A body over a cell pushes on it with the water standing over the body's bottom (tested at 3 by 3 points a cell, so the push covers the body's own footprint): the head is `F = u + P`, and `v += h c² ∇²F`, `v ×= 1 / (1 + h damping)`, `u += h v`, with the edges as walls, so the water keeps its volume exactly. `c = √(g × depth)`, at most `0.45` cells a step (the grid's limit with a margin).
- **Bodies.** Before the body step each body is pushed up by the buoyancy of 9.2 under the plane that touches the head below its centre, so a boat rides the waves and rocks on them. A body asleep on water that moves faster than 2 mm/s wakes.
- **Readouts.** `w.level`: the rest level raised by the water the bodies over it move aside (their buoyancy over `g`, over the surface's area), exact. `w.speed`: `c`. `w.height(x, y)`: the water's height at a point (in the plane `w.height(x, 0)`; the second number is not read). `heights` in the value is each cell's head, so under a floating body it reads its waterline and the surface round a boat at rest reads flat. The drawn surface rises by about 70% of what `w.level` says round a body, because the grid holds the water under a body down by the body's push, not to its bottom.
- **Checkpoints** hold `u`, `v` and the last head of every cell (three numbers a cell: 96 KB for 64 × 64).

### 9.4 Smoke (`Smoke`)

A grid of flow and smoke density, stepped by the stable-fluids method: carry the flow along itself, add heat as an upward force, make the flow lose no volume (20 pressure passes), then carry the smoke along the flow. Solid shapes and bodies block the flow, and moving bodies stir it. It is drawn as a shaded image on the board.

### 9.5 Cloth (`Cloth`, `Pin`)

A cloth is a grid of points joined by links of fixed length. We use **extended position-based dynamics (XPBD) with small steps**, the method most games and film tools now use for cloth, because it stays stable at our fixed step for any stiffness, and its stiffness does not change with the number of passes.

**Links.** Each point is joined to its neighbours by three kinds of link:

| Link | Joins | Resists | Set by |
|---|---|---|---|
| Stretch | each point and the next along each thread | stretching | `stretch` |
| Shear | each point and the next across the diagonal | skewing | `stretch` |
| Bend | each point and the one two along each thread | folding | `bend` |

A rope in the plane has stretch and bend links only. A 64 by 32 sheet has about 12,000 links.

**One step (h = 1/120 s)** is split into **4 small steps** of `h / 4`. Each small step:

1. Moves each point by its speed, gravity and the push of the air (below).
2. Pulls each link back toward its length once, in a fixed order: stretch links in red-black order, so no two links in one batch share a point, then shear, then bend. Stiffness is a compliance, so `stretch = 1` is the same cloth at any step.
3. Keeps pinned points where their pin is.
4. Pushes points out of solids, bodies, liquid drops and (with `self = true`) other parts of the cloth, with friction (9.6).
5. Sets each point's speed from how far it moved, less `damping`.

Four small steps with one pass each are stiffer and cheaper than one step with four passes. That is the finding of the "small steps" method (Macklin and others, 2019), and why we choose it.

**Air.** Each triangle of the sheet feels the wind on its face: a force along its normal, set by its area and by how fast the air moves through it (`world.wind` minus the triangle's speed). This is what makes a flag ripple. In 2D, smoke's flow (9.4) counts as wind, so smoke blows a curtain.

**Tearing.** With `tears = k`, a link stretched past `k` times its length breaks for good, in id order, so the same links tear in every replay. `c.torn` counts them, a `torn` notice says when, and the `figure` result lists it as an event.

**Sleep.** A cloth whose points all move under 1 mm/s for 0.5 s sleeps and costs nothing, as a body does (6.7). Wind that changes, a body that touches it, a drag or a push wakes it.

**Pins.** A pin to the world holds a point in place. A pin to a body is a two-way link: the point moves with the body, and the cloth's pull acts on the body. So a cape follows a moving ball and slows it.

**Drag.** Dragging a cloth grabs its nearest point with the stiff spring of `Grab`, as for a body (`ui.md` 4). The grab is logged with the point's index.

### 9.6 How particles meet bodies, and each other

Liquid drops and cloth points are both moving points. So they share one neighbour grid and one step, and every pair below is handled both ways.

| Pair | How it is found | What happens |
|---|---|---|
| Cloth point and a solid shape | the shape's distance test (sphere, hull, plane, terrain, the 2D shapes) | the point is pushed out to `thickness`, with friction |
| Cloth point and a body | the same test on the body's shape at its pose | the point is pushed out; the body gets the equal and opposite impulse |
| Cloth and a liquid drop | the drop's grid cell, against the cloth's triangles (segments in 2D), so drops never slip between points | both are pushed apart by their masses: a sheet holds water, a drop wets and weighs down the cloth |
| Liquid drop and a body | 9.1 step 4 | as before |
| Cloth and itself (`self = true`) | point against triangle, on the grid | points keep `thickness` apart, so a falling sheet folds instead of passing through |
| Cloth and another cloth | as `self` | always on |

**Order inside one step.** First the rigid bodies take their step (section 6 or 7). Then drops and cloth take their small steps against the bodies at their new poses, and add up the impulses they give each body. Those impulses are applied to the bodies at the start of the next step. The lag is one step (8 ms), which nobody can see, and it is the same on every computer and in every replay, so the film stays exact.

**Where it runs.** A figure with cloth or liquid runs its whole physics world, bodies included, in one worker (a second thread). One world in one thread keeps every hit in a fixed order, so the film is exact. The page sends inputs (sliders, drags, pushes) and gets back, each frame, the points and the poses to draw (11.2: under 0.5 ms). Without a worker, the same steps run on the page: the film is the same, and plays slower on a slow computer (10.5), with a `worker_unavailable` notice.

How it is built (round 6, `packages/sdk/src/worker/`): the worker holds a headless copy of the figure, loaded from the page's script whenever the page's lines change (its `@input` log included). Each frame the page sends the film time, the free values that changed and the `@input` lines made on the page since (pushes, grabs, restarts, which the page's driver makes instead of applying), and gets back the cells of every object the world owns, with the drops' and forces' typed arrays moved. One frame is in flight at a time, so a slow worker makes the film slower, not a queue longer. The page's driver steps nothing meanwhile; it writes the cells it is sent. If the worker stops, the page takes the world back, rebuilds it from its start with the same log and catches up (`worker_crashed`). A figure with liquid or waves goes to the worker, in the plane or in space (round 7: the host talks to whichever driver holds the world); cloth joins it in round 9. When the worker's own `@input` log changes (a car's pedal or a slider with `rerun = continue` moved while the film played, which the worker logs itself), it is sent back with the cells, and the page saves it with its own lines not yet sent; so a line edit that reloads the worker's script keeps them (round 7, fixing a round 6 gap).

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
| A 32 by 32 cloth | about 50 KB | about 12 MB (240 checkpoints) |
| A 64 by 32 cloth | about 100 KB | about 24 MB (240 checkpoints) |
| Two 64 by 32 cloths | about 200 KB | about 48 MB: thinned after about 40 s |

A figure with cloth saves a checkpoint every **0.25 s** instead of 0.5 s, so a seek steps at most 30 steps (11.2). A checkpoint holds each point's place and speed, the torn links as bits, and the pins.

A figure may use at most **32 MB** for physics checkpoints. Past that, the oldest half of the checkpoints is thinned to every 1 s, then every 2 s, with a notice `checkpoints_thinned`. Seeking into a thinned part takes longer (section 11.2).

### 10.4 Seeking

Seek to `t`: load the last checkpoint at or before `t`, then step forward to `t` (at most 60 steps of 1/120 s, or 30 with cloth). A figure that was just loaded computes checkpoints ahead in idle slices, at most 5 ms each, so the first seek is fast too. While the world is behind, the player shows "catching up", as for states (`animation-time/design.md` 8.5).

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

At 60 frames a second, a frame is 16.7 ms. Physics on the page gets at most **6 ms** of it; drawing and the rest of the kernel need the other 10 ms. At the default step of 1/120 s, one frame is 2 steps.

A world with cloth or liquid runs in a worker (9.6). The worker has its own core, so it gets **8 ms** a frame for its steps, which leaves room for slow moments in a 16.7 ms frame. The page then pays only the copy of what to draw and the drawing:

| Part of a frame with cloth or liquid | Where | Chrome, CPU 4× slower | Node, normal speed |
|---|---|---|---|
| Steps of the whole world (2 steps) | worker | under 8 ms | under 2 ms |
| Copy points and poses to the page | page | under 0.5 ms | |
| Draw 2,048 cloth points as a sheet (WebGL 2, 12.1) | page | under 3 ms | |
| Everything else on the page | page | about 10 ms | |

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
| 2D rope or curtain | 400 points | 2 ms | 0.5 ms |
| 3D cloth, the default size | 32 × 32 | 3 ms | 0.75 ms |
| 3D cloth, the largest, in wind | 64 × 32 | 6 ms, in a worker | 1.5 ms |
| 3D cloth over bodies | 64 × 32 and 40 bodies | 8 ms, in a worker | 2 ms |
| Cloth that hits itself | 64 × 32, `self = true` | 8 ms, in a worker | 2 ms |
| Cloth in water | 64 × 32 and 2,000 drops | 8 ms, in a worker | 2 ms |
| Two cloths | 2 × 64 × 32 | 8 ms, in a worker | 2 ms |
| Seek anywhere in a 60 s film, 300 bodies, warm | | 100 ms | 25 ms |
| Seek anywhere in a 60 s film, 2,000 particles, warm | | 250 ms | 60 ms |
| Seek anywhere in a 60 s film, cloth up to 2,048 points, warm | | 100 ms | 25 ms |
| Seek anywhere in a 60 s film, 4,096 cloth points, warm | | 100 ms in the first 40 s, 200 ms after (10.3) | 50 ms |
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
| Cloth points (all cloths together) | 4,096 |
| One cloth | 64 × 32 points (a sheet), 400 points (a rope) |
| Cloths with `self = true` | 1 per figure |
| Pins | 64 per cloth |
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
| Cloth, worst frame | A 64 × 32 flag in gusts for 60 s, then a sheet over 40 bodies | every frame within 11.2 |
| Cloth, still flag | A 32 × 32 cloth pinned at the top, no wind, 60 s | no point moves more than 1 mm after 3 s, and it sleeps |
| Cloth, stretch | A 64 × 32 sheet hanging from two corners | every link within 2% of its length |
| Cloth, no pass-through | A sheet dropped on a ball, a box and terrain, 100 drops; a ball fired at a pinned sheet at 20 m/s | no point ends inside a solid; the ball never passes |
| Cloth, two-way | A ball resting on a sheet pinned at its four corners | the pins carry the ball's weight within 1% |
| Cloth and water | 2,000 drops poured on a sheet held at its corners | no drop passes through; the sheet sags under the water's weight within 5% |
| Cloth, energy | A cloth swinging with `damping = 0` and no air for 60 s | never gains energy |
| Cloth, tearing | A net with `tears = 1.5` torn by a heavy ball, played twice and on three browsers | the same links tear at the same steps |
| Cloth, page cost | 4,096 cloth points and 2,000 drops | copy under 0.5 ms, draw under 3 ms a frame |
| Cloth, no worker | The 64 × 32 flag with the worker turned off | the same world hash every second as with it |
| Cloth, no garbage | Steps of a 64 × 32 sheet | no memory made during a step after the first second |

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
| Floating in space | A `Body3` box of density 0.5 in `Water`, and on still `Waves` | half under within 2% (round 7: 0.2% in water, 1.3% on waves) |
| Wave speed | The first sloshing mode of a basin 20 m long, 1 m deep, 64 points: its period against `2 L / c` | `c` within 5% (round 7: 1.5%) |
| Liquid volume | 2,000 drops filling a 3 m tank 1 m deep, left to settle | the level within 5% of where it filled (round 7: 2.6%) |
| Level under waves | A floating boat and a sunk rock in a 10 m pool | `w.level` rises by the water they move aside over the area, within 10% (round 7: 1%) |
| Car | A car at full motor on flat ground | reaches the speed set by `power` and drag, within 5% |
| Hanging rope | A 2D rope of 200 points hanging from two pins at the same height | follows the catenary `a cosh(x / a)`, within 2% of its sag |
| Rope pendulum | A 1 kg ball pinned to the end of a 2 m rope of 0.01 kg, swung 5° | period within 1% of `2π √(L / g)` |
| Wet cloth | A sheet that holds 1 kg of water | the pins carry the sheet's weight plus 9.8 N, within 2% |

## 12. Drawing

- Bodies draw as their shape at their pose, interpolated between steps (10.1), with the shape's style. A sleeping body looks the same; the algebra row shows it is asleep.
- Force arrows (with `world with show = "forces"` or the style bar button) start at the centre of mass, one per kind, with the kind's colour and label; tension starts at the anchor. Speed arrows the same way.
- Joints draw thin: a hinge as a small ring, a spring as a zigzag, a rope as a line that sags when slack, a weld as a small cross.
- Liquid particles draw as one batch of discs in the liquid's colour (the particle painter, `animation-time/design.md` 10.8). A smooth surface (metaballs) is for later.
- Waves draw as a surface in the Space view, smoke as a shaded image under the shapes.
- In space (round 7, until the WebGL 2 painter of 12.1): drops are the software painter's dots, a drop wide, drawn far to near among the faces, so a ball in a tank shows over the drops behind it; waves are a lit mesh through the cell corners, from every second corner past 32 a side (at most about a thousand faces), that hides no lines; still water is a translucent patch the size of the view at its level. Waves in the plane are a line through their points over a light fill down to their bottom. Measured in Node with a canvas that draws nothing, 2,000 drops and a 64 × 64 wave grid cost 0.3 ms for the scene and 2.3 ms for the painter a frame.
- Cloth in space draws as a lit sheet, two-sided (the back a little darker), with faint threads every 8 points. Cloth in the plane draws as its threads, a rope as a smooth line.
- 2D drawing is in `packages/sdk/src/screen/`, 3D in its Space painter, as for every area.

### 12.1 The WebGL 2 painter for cloth and liquid in space

The Space view's software painter (Canvas 2D) sorts and fills every face each frame. That is fast enough for solids and surfaces, but 4,000 cloth triangles on a CPU 4 times slower would take more than the whole frame. So cloth and liquid in space are drawn by a WebGL 2 painter in `packages/view`, the first part of the WebGL 2 renderer of `docs/features/space-3d/design.md` 9, written against its `GpuBackend` interface:

- The cloth's points go into one vertex buffer each frame (the copy of 11.2); the triangles are fixed, so their index buffer is made once. Normals are worked out on the GPU.
- Drops draw as one instanced batch of discs.
- The depth buffer hides what is behind, so nothing is sorted on the CPU.
- The software painter draws everything else on its canvas, under or over the WebGL canvas as depth needs: solids, points and labels stay exactly as today.

Without WebGL 2, the software painter draws the cloth from every second point (a 32 by 16 sheet for a 64 by 32 cloth) and every second drop. Only the picture is coarser: the physics and the film are the same.

## 13. Where each part lives

| Part | Place |
|---|---|
| Engine: world, shapes, broad and narrow phase, solver, joints, vehicles, liquids, waves, smoke, cloth, checkpoints, exact maths | `packages/kernel/src/physics/` |
| Cloth and liquid in one step, their shared neighbour grid | `packages/kernel/src/physics/particles.ts`, `cloth.ts` |
| The WebGL 2 painter for cloth and drops in space | `packages/view` |
| Commands, types, properties, readouts, errors, reasons | `packages/kernel/src/commands/physics/` |
| Error kinds and undefined reasons | the kernel's registries (`contracts/errors.ts`, `contracts/values.ts`, `language/errors.ts`) |
| The `hit` event | `packages/kernel/src/commands/numbers/handlers.ts` (the controls handlers) |
| Command group `physics` and mode allow lists | `packages/modes` |
| Worker hosting for liquids, cloth and big worlds | `packages/sdk` |
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
9. **Cloth.** `Cloth`, `Pin`, `world with wind`, tearing, cloth with bodies and water in the worker, the WebGL 2 painter. Examples: a flag in the wind, a sheet dropped on a ball, a rope that swings, a hammock with a ball, a net that tears, a cloth that catches water.
10. **Speed round.** The full bench suite of 11.4 and 11.5, in Node and in throttled Chrome, and the browser hash test.

## 15. Changes to other areas

- **Core design 7.4** is now designed here. The names change a little: the core named `Body`, `Wall`, `Spring`, `Joint`. We keep `Body` and `Spring`; a wall is `with solid = true`; `Joint` is the type of every link.
- **Animation and time 7.9** named `Bounce(y, v, floor, e)`. It is not needed: a body with `bounce = e` on a solid floor does it. The event slots of 7.9 are not used by physics, which keeps its own hit list.
- **Kernel:** compiled functions use the exact maths of `physics/math.ts` (10.2). Reserved names `world` and `hit`. A new undefined reason `unstable_world` and the notices in `errors.md` 5.
- **Controls and scripting:** a `hit` event, and `Push`, `Wake`, `Sleep` allowed in handlers (`STEP_ACTIONS`).
- **App modes:** a new command group `physics`, allowed in Classic, Graphing, Geometry and 3D. Scientific, Probability and CAS refuse it. Exam profiles may forbid it.
- **Performance (`docs/design/performance.md` 5):** the budget rows of 11.3, cloth points among them, and the worker's 8 ms.
- **View:** a WebGL 2 painter for cloth and drops in the Space view (12.1). The Space 3D phase plan put the WebGL 2 back-end later; cloth needs this part of it now.
- **SDK:** a world with cloth or liquid runs in the SDK's physics worker, bodies and all (9.6).
- **Tools 2D and Space 3D:** a Physics tool group.

## 16. Better than the reference app

- A real engine with contacts, friction, joints, vehicles, liquids and cloth, where the reference app has none.
- Cloth, water and bodies push each other both ways, in one exact film.
- Every part is a line in the same language, so formulas, sliders and the teacher drive it.
- Seek and replay are exact, and the same on every computer.
- Forces are counted per kind and drawn, so a lesson shows why a body moves.
- One speed level for every computer, so a lesson made on a fast laptop plays the same on a slow one.

## 17. Sources studied

- Our own legacy kit on `legacy/v1`, `packages/core/src/kits/physics2d/` (solver, joints, tank, force accounting).
- The reference app's motion workarounds, as studied in `docs/features/animation-time/design.md` 2.
- Public methods, used from their descriptions and not from any code: sequential impulses with warm starting (Erin Catto, GDC talks 2006 to 2014); separating axis tests, GJK and sweep and prune (Christer Ericson, *Real-Time Collision Detection*, 2005); expanding polytope depth (Gino van den Bergen, 2001); position-based fluids (Macklin and Müller, 2013); extended position-based dynamics (Macklin, Müller and Chentanez, 2016); small steps in physics simulation (Macklin and others, 2019); unified particle physics for cloth and liquids together (Macklin and others, 2014); stable fluids (Jos Stam, 1999); ray wheels, as described in many public vehicle write-ups.
