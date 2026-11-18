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
| `Smoke` | `(region, n)`; named `source`, `heat`, `wind`, `until` | Smoke and air on an `n` by `n` grid (4 to 64) in a box of the plane; read `sm.mass`, `sm.speed`, `sm.at(x, y)` |
| `Smoke` | `(box: Polyhedron, n)` in space; named as in the plane, and `swirl` | Smoke on an `n` × `n` × `n` grid (4 to 32) in a box of space (9.8); `swirl` (0 to 10, also in the plane) keeps its curls |
| `Fire` | `(region, n)`, `(box: Polyhedron, n)`, `(at: Point)`, `(at: Point3)`; named `source`, `fuel`, `burn`, `heat`, `smoke`, `swirl`, `wind`, `until`, `sound` | Fire and its smoke on a smoke grid (9.7); read `f.temperature(x, y)`, `f.burning`, `f.fuel`, and every smoke readout |
| `Ignite` | `(thing)` | Sets a burnable body, cloth or solid shape on fire now; a handler step, logged as `@input physics ignite …` |

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
| `Push(b, …)`, `Ignite`, `Wake`, `Sleep` in a handler | always `continue` | applied at the next step, logged (`@input physics push`, `ignite`, `wake`, `sleep`). In an `on b hit` handler the line is at the film time of the hit, not of the clock, so playing, seeking and reloading the script give one film; the script's own lines are not written again when the handler runs on a reload (round 11A, findings PH-16) |
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
2. **Broad phase.** Find pairs whose boxes overlap (6.3).
3. **Narrow phase.** For each pair, find contact points with their normal, depth and feature ids (6.4), once a step. Each point keeps its anchor on both bodies, so its gap can be worked out again from how far the bodies moved.
4. **Small steps (soft step, 6.5).** The step is cut into `s = ceil(world.passes / 2)` small steps of `h / s` (4 at the default 8 passes). In each:
   1. **Forces.** Gravity, air drag, steady forces, springs, charge forces and buoyancy go into each awake body's speed (semi-implicit Euler). Push impulses and the drops' and air's pushes go in at the first small step only.
   2. **Warm start.** Each contact point and joint starts with its impulse of the small step before (the first small step: of the last step).
   3. **Solve.** One pass over joints and contacts, with soft contacts that push overlap out gently (6.5).
   4. **Move.** Positions and angles move by speed times `h / s`.
   5. **Relax.** One more pass with no push-out, which takes away the speed the push-out added, so nothing gains energy.
5. **Bounce.** After the small steps, at a new hit faster than 1 m/s (6.5); the points of one face bounce together.
6. **Joint positions.** Up to three passes that remove leftover joint stretch without adding speed.
7. **Sleep.** Islands that stayed still long enough fall asleep (6.7).
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

Sequential impulses with warm starting, run as a **soft step** (Erin Catto's Solver2D comparison, 2024, the solver of Box2D v3; see `docs/research/physics-papers.md`): small steps instead of many passes in one step, soft contacts, and a relax pass. Hard sequential passes in one step left tall stacks rocking: a 20-box tower dropped from a small height walked over, columns of 50 balls kept moving for 10 s, and 3D towers swayed. Small steps carry a push through a tall stack in a few small steps, and the relax pass removes the extra speed the push-out leaves.

- **Soft contacts:** a point that overlaps is pushed out like a stiff, heavily damped spring (30 Hz, damping ratio 10, at most 3 m/s), solved as one row. A point with a gap may close it within the small step but not go below zero (speculative, 6.6). The relax pass solves the same rows with no push-out.
- **Gaps from the move:** a point's gap in a small step is its gap at the narrow phase plus how far its two anchors moved toward each other since, so the narrow phase runs once a step.
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
- **Ground** is the floor plane `z = 0` with `Ground()`. A surface `z = f(x, y)` with `solid = true` becomes a heightfield on a grid of at most 128 by 128 cells over the clip box (`space-3d/design.md` 8.7). Each triangle under a moving shape is a slab 0.5 m deep, written when met into one slab shape the terrain reuses, so a long drive keeps nothing per triangle crossed (keeping one made the young collector copy about 14 KB of new shapes a frame, 1 to 2 ms frames every 2 s). The 11.2 car row also holds the worst frame of a 60 s drive under 0.5 ms in Node, frames with a collector pause aside.
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

Choices made while building it (round 8, `packages/kernel/src/physics/smoke2.ts`, `commands/physics/smoke.ts`):

- **The grid.** A staggered grid over the bounding box of `region`: smoke and pressure at cell centres, the flow's x speeds on the vertical faces and its y speeds on the horizontal ones, so the divergence, the pressure gradient and the pressure solve are one operator. `n` is 4 to 64 (11.3: all smoke grids of a figure together at most 64 × 64 cells).
- **The step.** Smoke steps 60 times a second of film (every second step at the default 1/120 s), with `h = 1/60`: (1) mark the cells inside solid shapes (once, again when a mover moves) and bodies (each step); (2) carry the flow back along itself (semi-Lagrangian, bilinear), air from outside the box coming in with the wind; (3) heat lifts the flow by `heat × density` m/s²; (4) the faces of a solid cell take that solid's speed at the face (a moving body or mover pushes the air); (5) the projection: 20 red-black over-relaxed passes (ω = 1.8) of the pressure solve, started from the last step's pressure, with the open air outside the box at pressure 0 and no term for a solid neighbour; (6) carry the smoke along the new flow and make smoke at the source (density 1 in its cells).
- **The start.** The air starts moving with the wind (the smoke's own `wind`, else `world.wind` at the first step), and ten projections (200 passes) once make that start flow lose no volume round the solids. The source starts full of smoke, so it shows before the film runs. A first guess of 0 pressure in a cell a body has just left is replaced by the mean of its neighbours.
- **Named arguments.** `source` is a point (its cell), a circle or a polygon; `heat` is the lift of thick smoke in m/s², −50 to 50, 2 when a source is given and 0 without one (a candle is about 5); `wind` is the smoke's own wind, each part at most 100 m/s; `until` (seconds, 0 or more) stops the source, so `until = 0` is one puff. A source or heat that reads `t` or a slider is read at each smoke step.
- **Smoke kept.** Carrying smoke back and blending four cells is not exact about mass: it loses about 0.05% to 0.3% a step. With no source making smoke, the new smoke is scaled so it holds what it held less what flowed out of the open edges this step, by at most 0.5% a step (`0.5% × (1 + swirl)` with `swirl`, 9.7: a turning flow loses 0.4% to 1% a step). Smoke inside a solid is taken away.
- **Two-way.** The air pushes each body beside it with a drag `½ ρ Cd D |Δv| Δv` (ρ = 1.2 kg/m³, Cd = 1, D the body's width, Δv the mean air speed in the air cells beside it less the body's speed), capped at half the speed difference per smoke step, counted as `drag` and applied over the bodies' steps up to the next smoke step (one step late, as drops push, 9.6). A body smaller than a cell feels the air at its centre and does not block it.
- **Blowing up.** A flow speed over 1e6 m/s or not a number stops the grid: `unstable_world` on the smoke, a notice once; seeking back shows it again.
- **Where it runs.** A 64 × 64 grid costs about 0.5 ms a frame in Node (11.2), so smoke stays on the page. In a figure with liquid it runs with the rest of the world in the worker, and its density grid comes back moved, not copied.
- **Drawing.** One grey image a frame, one pixel per cell, its cover the density (0.85 at density 1), scaled to the box and smoothed, under every other shape, with a faint dashed frame for the box (ui.md 7). Where the board cannot draw images (SVG export), each cell is a grey square.

### 9.5 Cloth (`Cloth`, `Pin`)

A cloth is a grid of points joined by links of fixed length. We use **extended position-based dynamics (XPBD) with small steps**, the method most games and film tools now use for cloth, because it stays stable at our fixed step for any stiffness, and its stiffness does not change with the number of passes.

**Links.** Each point is joined to its neighbours by three kinds of link:

| Link | Joins | Resists | Set by |
|---|---|---|---|
| Stretch | each point and the next along each thread | stretching | `stretch` |
| Shear | each point and the next across the diagonal | skewing | `stretch` |
| Bend | each point and the one two along each thread | folding | `bend` |

A rope in the plane has stretch and bend links only. A 64 by 32 sheet has about 12,000 links.

**One step (h = 1/120 s)** is split into **3 small steps** of `h / 3`, or **4** of `h / 4` when a cloth has `self = true` (a cloth folding on itself needs the fourth). Each small step:

1. Moves each point by its speed, gravity and the push of the air (below).
2. Pulls each link back toward its length once, in a fixed order: stretch links in red-black order, so no two links in one batch share a point, then shear, then bend. Stiffness is a compliance, so `stretch = 1` is the same cloth at any step.
3. Keeps pinned points where their pin is.
4. Pushes points out of solids, bodies, liquid drops and (with `self = true`) other parts of the cloth, with friction (9.6).
5. Sets each point's speed from how far it moved, less `damping`.

Three or four small steps with one pass each are stiffer and cheaper than one step with as many passes. That is the finding of the "small steps" method (Macklin and others, 2019), and why we choose it.

**Air.** Each triangle of the sheet feels the wind on its face: a force along its normal, set by its area and by how fast the air moves through it (`world.wind` minus the triangle's speed). This is what makes a flag ripple. In 2D, smoke's flow (9.4) counts as wind, so smoke blows a curtain.

**Tearing.** With `tears = k`, a link stretched past `k` times its length breaks for good, in id order, so the same links tear in every replay. `c.torn` counts them, a `torn` notice says when, and the `figure` result lists it as an event.

**Sleep.** A cloth whose points all move under 1 mm/s for 0.5 s sleeps and costs nothing, as a body does (6.7). Wind that changes, a body that touches it, a drag or a push wakes it.

**Pins.** A pin to the world holds a point in place. A pin to a body is a two-way link: the point moves with the body, and the cloth's pull acts on the body. So a cape follows a moving ball and slows it.

**Drag.** Dragging a cloth grabs its nearest point with the stiff spring of `Grab`, as for a body (`ui.md` 4). The grab is logged with the point's index.

Choices made while building it (round 9, `packages/kernel/src/physics/cloth.ts`, `cloth2.ts`, `cloth3.ts`, `commands/physics/cloth.ts`):

- **Forms and values.** A sheet's points are row by row from `corner`, `u` along a row; a rope is one row from `a` to `b`; a net covers the box's bounding box, row 0 along its top. `pins` words: `"top"` the edge highest up, `"left"` the edge furthest to −x, `"corners"` (a rope's two ends), `"top corners"`; a list pins the point nearest each item. `Pin` has a type of its own, `Pin`; it holds the point nearest `at` where that point starts. `c.at(i, j)` counts from 1 (a rope's `j` is not read). The value holds the points as `xs`, `ys`, `zs` (Float64, so readouts are exact), what tore (`cut`), and where each pin holds.
- **Links.** Stretch links along the threads in red-black order, then **one shear diagonal a cell**, the two kinds in a checkerboard (half the links of both diagonals, the same feel at our stiffness), then bend links. Compliance is `(1 − s) / (s m ω²)` per link, with ω = 400 rad/s for `stretch` and 200 rad/s for `bend`; `stretch = 1` and `bend = 1` are rigid. **Bend links are solved once a world step** (a sheet), as one small step as long as the step, so their stiffness is unchanged; a rope solves them every second small step with four, once a step with three.
- **A rope is one chain.** A rope's stretch links are solved together each small step: made linear about the places now they form a three-band system, solved exactly in linear time (the Thomas method). One pass then reaches from one end to the other, so a 200-point rope holds its length (a pass link by link left it 6% long) and hangs on the catenary within 2% of its sag.
- **Tethers.** With no `tears`, every free point keeps within its start distance (times `1 + 2 (1 − stretch)`) of its two nearest pins. It is a one-way limit that moves only the point, once each small step, and stops a hanging sheet from stretching under its own weight (every link within 2% for 64 × 32 hanging from two corners).
- **A body's tether** (round 9, finish). A body held by a pin of a cloth with no `tears` also keeps within reach of that cloth's world pins: the length along the cloth from the world pin to the body's pin (for a rope, the sum of the rest lengths between them; for a sheet, the start distance times the slack `1 + 2 (1 − stretch)`, so exactly the start distance at `stretch = 1`; a body that may wander 2% along the ground rolls off its pin, so the body's tether gets no extra play). A sheet or net that holds a body also gives each of its points' tethers at least 2% of play (`max(1 + 2 (1 − stretch), 1.02)`, the stretch every check allows; a rope's stay as above): a flat, taut sheet at `stretch = 1` held every point at its limit at once, and the body under it took all the push (a 0.5 m ball pinned under such a sheet on `Ground()` was thrown out within 2.2 s; now it stays for 10 s). Past it, the body is moved back toward the world pin in the small step, by its centre, and the pull counts on that world pin. A link-by-link solve cannot hold a body thousands of times heavier than one point when a slack rope snaps taut; the tether does it in one move, as tethers do for points (Kim, Chentanez and Müller 2012). The body's pinned point moves with it, so the links' pull on that point still reaches the body. A 1 kg ball on a 2 m rope of 0.01 kg in 50 points, let go with the rope level, keeps the rope within 0.2% of 2 m and the ball within 0.1% of 2 m from the pin for 3 s (before: the rope stretched to 3.43 m).
- **Air.** The push of the air (`½ ρ A (u·n)|u·n|` along the normal, plus a tenth of that as skin drag along the face, ρ = 1.2) is worked out once a step from the speeds at its start, on whole cells (half the cross of their diagonals), and felt in each small step. With no wind the air does nothing ("still air", as for smoke), so a cloth with no wind and `damping = 0` keeps its energy.
- **Bodies.** Within the cloth's small steps a body holds its pose. A free point pushed out of a body moves out whole and the body takes the point's change of momentum at the start of the next step (so a ball resting on a sheet sends its weight to the pins, within 1%). A point that the cloth holds (a pin, or a tether at its length) does not move: the body goes back out instead, as off a wall, so a ball fired at a pinned sheet at 20 m/s stops. A ball also meets the faces (in the plane, the threads) under its centre, so it cannot slip between points. A cloth point pinned to a body, and the points near it on the cloth, do not hit that body.
- **Bodies held by pins take the small steps.** A body with a pin starts the cloth's step where it started the world's step, with the speed it started with, gains a part of the world's change of its speed each small step, moves by the world's own move of the step in equal parts (its contacts and push-outs included, so a ball pinned under a sheet stays on the ground: it sank 3 to 5 cm before, under 1 mm now) and is moved by its pins; its place and speed then go back to the world. Before they go back, and for the move and push the cloth owes the body at the next step, whatever the cloth gave the body that goes into a fixed shape (ground, terrain, a static body) it touches is taken out, from the contacts the world found that step, in their fixed order: the part of the move along the normal into the shape, and the part of the speed along it. Without it a heavy ball on a light rope pumped energy into the rope (the rope moved several times a step, the ball once). A 1 kg ball on a 2 m rope of 0.01 kg (10 points) swings with the period `2π √(L / g)` within 1%.
- **Drops.** Drops meet the cloth's faces (threads in the plane) in the liquid's step, after the bodies and before the walls. A drop's side is where it started the step against the face where the last liquid step left it (the cloth's own step may have carried the face past a drop on it). A drop that came within its radius plus `thickness`, or crossed, goes back whole to its side; the cloth's corners take its change of momentum as a change of speed (a pinned corner, its pin), and the cloth wakes.
- **Self and other cloths.** Point and face pairs are found once a step on the cloth's grid (not a point's own face or the faces beside it on the grid); each small step a point closer than `thickness` to a face it stands over goes back to the side it started the step on, the point and the corners sharing the move by their weights. A point already further than `thickness` on the other side is left alone, so a wrong side never flings the cloth.
- **Checkpoints.** A world with cloth keeps a checkpoint every 0.25 s: 30 steps in the plane, 28 in space (a whole number of the drops' listing rounds). A checkpoint holds the points' places and speeds, the torn links 32 to a number, the pins, each cloth's sleep, and the pushes and moves still owed to bodies (a 64 × 32 cloth is about 97 KB). Grabs are found from the log at each step, so a seek holds the same points.
- **Sleep and wake.** A cloth sleeps as 9.5 says, also with no pins; a change of wind, a grab, an awake body whose box comes near or a drop on it wakes it.
- **Drawing.** In the plane a net is its threads and a rope one smooth line through the midpoints of its links; pins are small dark dots. In space a cloth is one sheet item for the WebGL 2 painter of 12.1 (round 9B): every point, faint threads every 8 points, the whole faces only once it tore (two a cell, split as the engine splits them), its pins as small dark points; without WebGL 2 the software painter draws every second point.

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

How it is built (round 6, `packages/sdk/src/worker/`): the worker holds a headless copy of the figure, loaded from the page's script whenever the page's lines change (its `@input` log included). Each frame the page sends the film time, the free values that changed and the `@input` lines made on the page since (pushes, grabs, restarts, which the page's driver makes instead of applying), and gets back the cells of every object the world owns, with the drops' and forces' typed arrays moved. One frame is in flight at a time, so a slow worker makes the film slower, not a queue longer. The page's driver steps nothing meanwhile; it writes the cells it is sent. If the worker stops, the page takes the world back, rebuilds it from its start with the same log and catches up (`worker_crashed`). A figure with liquid or waves goes to the worker, in the plane or in space (round 7: the host talks to whichever driver holds the world), and its smoke goes with it; a figure with smoke and no liquid or waves stays on the page, which its 0.5 ms a frame fits (9.4); cloth joins the worker in round 9. When the worker's own `@input` log changes (a car's pedal or a slider with `rerun = continue` moved while the film played, which the worker logs itself), it is sent back with the cells, and the page saves it with its own lines not yet sent; so a line edit that reloads the worker's script keeps them (round 7, fixing a round 6 gap).

### 9.7 Fire (`Fire`, `Ignite`, `burns`)

Status: built in the plane (round 11A, `packages/kernel/src/physics/fire2.ts`, `burn2.ts`) and in space (round 11B, 9.8, `fire3.ts`, `burn3.ts`). Research: `docs/research/physics-papers.md` 9.

Fire is the smoke grid of 9.4 with two more values in each cell: **temperature** `T` (°C above the air) and **fuel**
`F`. The smoke value `s` stays. The same grid runs in the plane and in space (9.8).

```text
f = Fire((0, 0))                                  # a camp fire at the origin: a 2 m × 4 m grid, 48 cells across
f = Fire(Box((0, 2), 4, 4), 64, source = Circle((0, 0.3), 0.3), fuel = 2, burn = 1)
f = Fire((0, 0, 0))                               # in space: 2 × 2 × 3 m, 24 cells a side
log = Body(Box((0, 0.2), 1, 0.2), burns = true)   # a log that catches fire from the flames
flag with burns = true                            # a cloth that burns: its burnt links tear
on button click: Ignite(log)
```

**Named arguments.**

| Name | What it does | Default |
|---|---|---|
| `source` | Where fuel comes in: a point, circle or polygon (a point, sphere or solid in space) | a small circle at the point, for `Fire(at)` |
| `fuel` | Fuel made at the source, per second, 0 to 10 | 1 |
| `burn` | How fast fuel burns, 0.1 to 10: fast burning makes short flames, slow burning tall ones | 1 |
| `heat` | The hottest a flame gets, 100 to 2,000 °C; hotter rises faster | 1,000 |
| `smoke` | Smoke made per unit of fuel burnt, 0 to 5 | 1 |
| `swirl` | Curls kept by vorticity confinement, 0 to 10 | 2 for fire, 0 for smoke |
| `wind`, `until` | As for smoke (9.4) | |
| `sound` | `true` plays a soft crackle that follows how much burns (the sound area's `Noise`, its pops from the figure's seed); off unless asked | `false` |

**The step** (60 times a second of film, as smoke):

1. Marks, carrying and the wind, as smoke (9.4 steps 1 and 2). `T`, `F` and `s` are carried along the flow.
2. **Lift:** `a = α T − β s`, upward (Fedkiw, Stam and Jensen 2001), with `α` set so the hottest flame lifts at
   `heat / 100` m/s² and `β = 0.5` m/s² per unit of smoke. The fire's `heat` replaces the smoke's `heat` lift.
3. **Swirl:** vorticity confinement, force `ε dx (N × ω)` with `ε = swirl`, `ω` the curl of the flow and `N` the unit
   gradient of `|ω|`.
4. **Burning:** where `F > 0` and `T` is above the ignite point (150 °C), burn
   `r = min(F, burn × h × ξ)`, `ξ` the smoothstep from 150 °C to 400 °C (FlameForge). Then `F −= r`,
   `T += heat × r × 2`, capped at `heat`, and `s += smoke × r`. The source puts in fuel and keeps its cells at `heat`
   while `until` has not passed, so it lights.
5. **Cooling:** `T −= c T⁴ / heat³ × h` (black-body cooling, Nguyen 2002), `c = 3` per second, and `T` never below 0.
6. Solid faces, bodies and the projection, as smoke (9.4 steps 4 and 5).
7. **Water:** a liquid drop in a cell takes up to 50 °C and all the fuel of that cell each step; so water puts a fire
   out. The drop is not changed (no steam yet).

**Burnable things.** `burns = true` (or a number: the fuel it holds, in seconds of burning; `true` is 10 s per kg)
on a body, a cloth or a solid shape. Each one gets its own temperature `Tm`, read as `b.temperature`.

- **Heat swaps** with the air cells it touches: `Tm += (T − Tm) φm h`, and the cells get `(Tm − T) φa h` back, with
  `φm = 0.5` and `φa = 2` per second (FlameForge eq. 6, made faster for lessons).
- **Burning** starts when `Tm` passes `ignite` (named, default 250 °C) or at `Ignite(b)`. It burns at the rate of
  step 4 with `ξ` from `Tm`, puts the heat and smoke it makes into the cells it touches, and keeps itself hot.
- **A body** loses up to 80% of its mass as it burns and darkens to char. `b.burnt` goes from 0 to 1; at 1 the body
  leaves the world: it reads `undefined` with the reason `burnt`, its joints break (`broken`), and the notice `burnt`
  shows once.
- **A cloth** burns cell by cell (each quad has its own `Tm`, from the grid at its centre). A burnt cell's links tear,
  as `tears` (9.5) would; a cloth that burns tears even without `tears`. `c.burnt` is the part burnt.
- **A solid shape** burns as a body would, and when it is burnt it stops being solid.
- Only things inside a fire grid can burn. `Ignite(b)` with `b` outside every fire grid is refused with
  `no_fire_grid` (B021), and `Ignite` of a thing without `burns` with `not_burnable` (B020).

**Drawing.** Each cell's colour is the black-body colour of its temperature (dark red at 500 °C, orange, yellow, white
at 1,500 °C), added over the picture, with the smoke grey on top by its density (9.4's image). In space, the WebGL 2
painter ray-marches a 3D texture of `T` and `s` through the grid's box, front to back, with the depth of the solids
(12.1); without WebGL 2, the software painter draws 12 slices facing the camera. PNG comes from the GPU; SVG gets the
slices as images.

**The film.** Grids save in checkpoints (10.3) with `Tm` and `burnt` of every burnable thing. `Ignite` steps are
`@input` lines, so seek and replay are exact. Burning a body changes the world's list of bodies at a step; that is a
state change the solver already handles (a weld that breaks).

Choices made while building it in the plane (round 11A, `physics/fire2.ts`, `physics/burn2.ts`, `commands/physics/fire.ts`, `driver.ts`). Where one differs from the text above, this list wins.

- **The step.** In this order inside the smoke step of 9.4: carry the flow; carry `T` and `F` along it (the same back-tracing as smoke, from the air cells round the point only; air from outside has `T = 0`, `F = 0`; no mass rescaling: only smoke keeps its mass; fuel under 1e-6 is dropped); lift; swirl; burn; source; cool; water; solid faces; projection; carry the smoke. A fire makes no smoke at its source (its smoke comes from burning), so the smoke step's `makeSmoke` is skipped. The lift is `a = 0.01 T̄ − 0.5 s̄` m/s² on each horizontal face (`T̄` and `s̄` the mean of the two cells beside it; a face at the box edge has one cell and takes its value, as the smoke lift does), `α` is fixed at 0.01 per °C, so a cell at its `heat` lifts at `heat / 100` m/s², as the text says.
- **Cooling** `T −= 3 T⁴ / heat³ h` (h = 1/60 s) is fast at first and slow after: a cell at 1,000 °C is at 465 °C after a second and about 330 °C after three. A plume therefore stays above 400 °C (dark red, 35% cover) a long way up; that is the law, not a bug.
- **Burning** (`ξ` the smoothstep of `(T − 150) / 250`, `r = min(F, burn h ξ)`, `T = min(heat, T + 2 heat r)`, `s += smoke r`), the **source** (`F = min(1, F + fuel h)`, `T = heat`, air cells only, while the film time is under `until`) and the **start** (no fuel, the source cells at `heat` so it shows before the film runs; none with `until = 0`) are as the plan gave them.
- **`swirl`** (vorticity confinement) is in `Smoke` too and is skipped at 0, so a smoke with no `swirl` keeps exactly its film (and its spec, checkpoint and hash). `ω` is 0 in solid cells and in the outer ring of cells; faces next to a solid or the box edge take no force. A fire's default is 2 (written into its spec only when above 0).
- **Value and type.** `Fire` has a type of its own; its value is a smoke value (`schema: 'Smoke'`, so `isSmokeValue` holds and every smoke readout works) whose `spec.fire` holds `fuel`, `burn`, `heat`, `smoke`, `sound`, with `temp` (Float32, laid out as `density`), `hottest`, `burning` (a cell above 500 °C), `fuel` (Σ F dx dy), `flames` (cells above 500 °C) and `out`. `f.temperature(x, y)` is the cell's `T`, 0 outside the box. The row text is `fire, 48 by 48, up to 980 °C, burning` (or `out`). `Fire(at)` is a box 1 m each side of `at` in x, from 0.5 m below to 3.5 m above it, 48 cells, with a source `Circle(at, 0.25)`. All smoke and fire grids of a figure together hold at most 64 × 64 cells (so two `Fire(at)` do not fit).
- **Checkpoints.** A fire grid adds `alive`, `T` and `F` to its saved part; a smoke grid's checkpoint is byte for byte what it was. The burnable things save `Tm`, `Fm`, `lit` and `gone` as one more part, after the cloth's.
- **`fire_out`** is raised once, when the fire has been alight (a cell above 150 °C or holding fuel at some step), its source has stopped (`until` passed, or no source), no cell is above 150 °C and less than 1e-4 m² of fuel is left (a fire's fuel is never exactly 0: bilinear carrying leaves traces).
- **Burnable things** are units: a body or a solid shape is one unit, a cloth has one for each cell (a quad of a sheet or net, a segment of a rope). At most 64 things burn in a figure (bodies and shapes in figure order, then cloths); the line that makes a 65th burn is refused with `limit` (the engine also ignores a 65th whose `burns` is a formula, which is read while the film plays). A unit is in the first fire grid whose box holds its centre (a body's centre of mass, a shape's box centre, a cloth cell's mean corner); outside every grid it does not swap heat or burn. Its cells are the air cells that share a side with a cell it fills, each once; a unit that fills no cell (smaller than one, or a cloth cell) uses the grid cell at its centre. `burns = true` is 10 s a kg of a body's start mass, 10 s a m² of a solid shape, and for a cloth 10 s a kg of one cell's mass (so at least 1 s a cell); a number is the seconds, a cell of a cloth burning that long. `ignite` is 150 to 1,000 °C, default 250. `burns` and `ignite` are also `with` properties (`burns` takes `true`, `false` or a number of seconds: a new kind of property, `boolnum`).
- **Water** (a drop in a cell takes up to 50 °C and all its fuel, in drop order) comes after the cooling; the cells that held a drop also cool the unit beside them by up to 50 °C, applied after the heat swap and before the lighting, and put it out when it falls under its ignite point. A fire with a source cannot be put out while the source runs (it makes 1,000 °C again each step): the example puts out a log and a fire whose source has stopped.
- **A body that burns** has `m0 (1 − 0.8 burnt)` as its mass, with the inertia scaled the same way, set in the world at each smoke step and again after a checkpoint loads; at `burnt = 1` it is removed from the world (as `left_world` does), reads `undefined` with the reason `burnt`, its joints are marked broken, and the notice `burnt` shows once. A joint whose rule goes undefined because a body burnt (or left the world) keeps its place in the world: the world is not built again from its start for it. `b.temperature`, `b.burnt` and `b.burning` are readouts; a body drawn burnt is moved toward `#2b2622` by `burnt`.
- **A solid shape** that burns is removed from the world the same way (the grids mark their walls again).
- **A cloth that burns** has no tethers and a `tears` of 1,000 for the engine when it was given none (so nothing but burning tears it). A cell that burnt away breaks the stretch and shear links on it (an edge shared by two cells goes when either is burnt) and then the bend links across a broken stretch link, through `ClothSet.burnCells`, which writes `broken` in place, counts the links in `torn` and `tornNow`, and wakes a sleeping cloth; the `torn` notice and event come as for any tear. `c.burnt` is the part of its cells that burnt away.
- **`Ignite(thing)`** lights a whole body, shape or cloth (every cell not yet burnt) at the next step. It is logged as `@input physics ignite name at t` (and `name[k]` for an item of a list), and goes to the physics worker as an input line. It is refused with `not_burnable` (B020, code C139) when the thing does not burn, and with `no_fire_grid` (B021, code C140) when its centre is outside every fire's box, with the suggestion `fire = Fire(b.pos)`. `burns` or `ignite` on a point, a smoke or any other type is `not_burnable` at typecheck.
- **The crackle** (`sound = true`) plays brown noise (`key fire:<id>`) while some cell is above 500 °C, as loud as `0.3 min(1, flames / (0.05 n²)) (0.7 + 0.3 q)`, `q` a 32-bit integer mixer of the object's id and `floor(t × 20)`; the sound area's `registerSoundSource` hook adds it to `soundsAt`.
- **Drawing.** The fire image (`fireImage(T, s, n, heat, out)`) is one pixel a cell by the ramp of the plan (nothing under 400 °C, 35% cover at 500, 70% at 800, 85% at 1,100, 95% from 1,500 °C, a cell never drawn hotter than `heat`, 40% less cover under thick smoke), drawn smoothed with `lighter` over the picture, then the smoke image over it; where the board takes no image (SVG) each cell is a square of its colour.
- **After the review (round 11A fix round, `handoff/physics/findings.md` PH-16 to PH-19).** (1) **Swirl and smoke kept:** the jar of 11.5 with `swirl = 10` lost 23% of its smoke, because carrying smoke back along a turning flow loses 0.7% to 1% a step and the scale that puts it back was capped at 0.5%. With `swirl` above 0 the cap is `0.5% × (1 + swirl)` (5.5% at 10); with no swirl it is 0.5% as before, so a film with no swirl is the same. The jar keeps its mass to 1e-13 for `swirl` up to 10. Films with `swirl` of 3 or more are not the films of the build before (their mass is kept now); those of 0.5 and 2 are the same (the cap did not bind). A face also takes at most `0.5 min(dx, dy) / h` of speed from the swirl in a step (it did not bind in any scene tried). (2) **A solid shape that burnt away** reads `undefined` with the reason `burnt` (a seek back before the burn gives it back), and the sleeping bodies that rested on a shape or a body that burnt away wake and fall. (3) **A 65th thing with `burns`** is refused with `limit`, naming the 64 (each item of a list of bodies counts; a `burns` that is a formula is read while the film plays, where the engine ignores the things past the 64th). (4) **A hit handler's actions** (`Push`, `Ignite`, `Wake`, `Sleep`, in the plane and in space) are logged at the film time of the hit (5.4); `Wake` and `Sleep` are input lines too.
- **Cost.** 64 × 64 with two burning bodies: a frame (two steps, one smoke step) 0.84 ms on average in Node (the same grid as smoke alone 0.56 ms), under the 1 ms of 11.2. The smoke grid pays for the new terms only when it has them.

### 9.8 Smoke and fire in space

Status: built (round 11B, `packages/kernel/src/physics/smoke3.ts`, `fire3.ts`, `burn3.ts`; "As built" at the end of this section).

`Smoke(box, n)` and `Fire(box, n)` in space run the same step on a cubic grid of `n` cells a side (4 to 32; one grid in
space per figure). Flow is staggered as in the plane, with a third speed on the faces across `z`; the pressure solve is
the same red-black passes. The grid in space keeps its values in `Float32Array` (the arithmetic stays Float64, so the
film stays exact) to halve the memory and the copy. It runs in the physics worker with the rest of the world, and its
`T` and `s` go to the page as one moved buffer each frame.

- Cloth in a grid feels its flow as wind, in space as in the plane (9.5 Air), so a flag over a fire ripples.
- Bodies feel its drag as in 9.4.
- Checkpoints of a grid in space are kept every 1 s, not every 0.5 s: a 24³ grid is about 390 KB each, so 60 s of film
  is about 23 MB of the 32 MB (10.3). A seek may replay up to 1 s of grid steps (11.2).

**As built (round 11B).** Files: `physics/smoke3.ts` (the grid and its step), `fire3.ts` (the fire's steps), `burn3.ts` (things that burn), `commands/physics/smoke.ts`, `fire.ts`, `smoke-reg.ts`, `fire-reg.ts`, `body3.ts`, `driver3.ts`, `index.ts`. The choices that the plan left open or that differ from the text above:

- **The grid.** `Smoke3` is the plane's `Smoke2` with a third axis: `u`, `v` and `w` on the faces, cell `(k n + j) n + i`, the pressure padded by one ghost cell each side. Every value it keeps (`u v w s T F p`) is a `Float32Array` made once; each stored value is rounded with the array and the arithmetic stays Float64. The cells are `dx × dy × dz` over the bounding box of the region (a box 2 × 2 × 3 m has cells 0.083 × 0.083 × 0.125 m), the pressure solve takes each axis's own weight, and the swirl and its cap use the smallest edge. The step is the plane's, in the plane's order: marks, flow carried (trilinear, the wind from outside), `T` and `F` carried, lift along +z (`a = 0.01 T̄ − 0.5 s̄`), swirl with `ω` a vector (`N × ω`), burning, source, cooling, water, solid faces, 20 red-black passes (ω = 1.8, warm-started, open faces at 0), smoke carried and its mass kept (cap 0.5% × (1 + swirl)), the drag on bodies. A grid with no fire skips the fire steps.
- **Solids.** Cells are marked inside spheres, convex hulls (their face planes), planes (the floor: `n · x < d`) and terrain (a cell is solid when its centre is under the terrain's triangle at that place); a body's cells take its speed at the face; a body that is not moving at all (the floor) sets its faces to 0 with no sum. A hull thinner than a cell marks the cell of its middle (a thin wall leaks at its edges). The drag is `½ ρ Cd D² |Δv| Δv` with `D` the body's width (`2 × reach`), `ρ = 1.2`, `Cd = 1`, from the mean air speed in the air cells beside the body, at most half the speed difference a smoke step, one step late, added to the world's impulses and counted as `drag`; a push too small to see does not wake a resting body.
- **Checkpoints.** A grid saves its Float32 values packed two to a Float64 slot (bytes are copied, never read as numbers), so a 24³ grid is 399.7 KB and 60 s of film (a checkpoint a second) is 23.4 MB. A figure with a grid keeps a checkpoint every 1 s, also with cloth (the grid's size decides), which a seek may replay in up to 120 steps. The step budget of a pass counts a grid's cells (a thirty-second of them a body).
- **Commands.** `Smoke(box, n)` and `Fire(box, n)` take any `Polyhedron` and use its bounding box; `Fire(at: Point3)` is a box 1 m each side of `at` across, from 0.5 m below to 2.5 m above, 24 cells, a ball of fuel of radius 0.25. `source` is a point, a ball or a convex solid. `n` outside 4 to 32 is `bad_property_value`; a second grid in space is `limit` (the 64 × 64 limit of the plane counts only grids in the plane). `sm.at(x, y, z)` and `f.temperature(x, y, z)` take three numbers (the field's type is told by the value, else by the line). The value is the plane's with `spec.space`, `z0`, `z1`, `source3` and `windZ`; its `density` and `temp` are one `Float32Array` each (copies, so the worker moves them to the page each frame).
- **Where it runs.** A figure with a grid in space runs in the physics worker (`PhysicsWorkerHost` asks the space driver, `hasSmokeGrid()`); the driver steps it after the bodies and the drops and before the cloth, 60 times a second of film (every `round(rate / 60)` world steps). A cloth in a grid feels its flow as wind (`Cloth3.airAt`, trilinear on the faces), and a figure with a grid keeps its cloth awake (a sleeping cloth would not feel a fire that starts later).
- **Things that burn in space** are bodies, the cells of a sheet and solid shapes (a polyhedron, sphere, cylinder or cone with `solid = true`; round 11B fix round, below). `Body(solid, burns = x, ignite = y)` (and `with burns`) as in the plane; `burns = true` is 10 s a kg, at least 1 s. A body's mass and inertia are 80% less when burnt, the world inverse inertia made again from its turn (the quaternion is not normalised again). At `burnt = 1` it leaves the world as in the plane (`burnt`, joints broken, what rested on it wakes). `Ignite` on a body, a list item or a sheet is an `@input physics ignite name at t` line, as in the plane. A sheet's cell uses the grid cell at its quad's centre and tears through `ClothSet.burnCells`.
- **After the review (round 11B fix round, `handoff/physics/findings.md` PH-30 to PH-34).** (1) **`Ignite` of a sheet** reaches the space driver: the argument that names an object has no value of its own in the call, so the action read the sheet as a plane thing and refused it with `not_burnable`; it reads the object's value now (a sheet, and a solid shape in space, are told by what they are). (2) **The `torn` notice of a burning sheet** comes: the cloth step clears its count of links torn in the step, and the burnt cells' links were torn before that step, so the count was lost; they are torn after the step, as in the plane (a burning sheet's links in space tear one step later than in the build before, so films of burning sheets in space change a little). (3) **B021 in space** keeps its suggestion `fire = Fire(b.pos)` when the figure already has its one grid in space: the line is refused with `limit`, so the check that offers only lines that would work dropped it. `no_fire_grid` now keeps a suggestion refused for `limit` alone (a plane figure with its 64 × 64 cells used has the same case), and in space the hint says a figure has one smoke or fire grid, so the line should change the grid it has. (4) **Bodies in space count toward the 64 burnable things**, with sheets and solid shapes: the 65th is refused with `limit` by `burns = …` or `with burns`, each item of a list counts. (5) **A solid shape in space that burns** (`p with burns = true`, a number of seconds, `ignite`) is a burnable unit like the plane's: `true` is 10 s a m³ of its volume (at least 1 s), its place is the middle of its box, and a plane, the floor or terrain cannot burn. Once burnt it leaves the world, its cell reads `undefined` with the reason `burnt` (shown once as the notice `burnt`), the grids mark their walls again, the sleeping bodies whose boxes meet it wake (`World3.wakeAround`, used for burnt bodies too, in place of a search of the touching pairs, which made a list each time), and a seek back before the burn gives it back. A rule is told to be a solid by its `solid` style when it is computed, not by the scan of the driver (a rule whose value was not kept before the shelf burnt gave a world built again without the shelf, so the film started over; the driver also keeps the value the rule has when the shelf burns. The plane's driver has the same two guards).
- **Drawing** is 12.1 ("Smoke and fire in space").
- **Cost.** A 24³ grid, Float32, 20 passes: about 3.7 ms a smoke step in Node, so a frame is about 4 ms (the plan's budget was 2 ms): the pressure passes alone are 1.3 ms. 32³ is 9 ms, the flag over a fire 5 ms, a seek 130 ms median (11.2). With the loops in Rust (task 10.10, 11.6 "As built, round 2") a step is about 1.5 ms, 32³ 3.6 ms, the flag over a fire 2.7 ms and a seek 45 ms.

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
| A 64 by 64 smoke grid (flow, smoke and the pressure the next step starts from) | about 131 KB | about 16 MB |
| A 32 by 32 cloth | about 50 KB | about 12 MB (240 checkpoints) |
| A 64 by 32 cloth | about 100 KB | about 24 MB (240 checkpoints) |
| Two 64 by 32 cloths | about 200 KB | about 48 MB: thinned after about 40 s |

A figure with cloth saves a checkpoint every **0.25 s** instead of 0.5 s, so a seek steps at most 30 steps (11.2). A checkpoint holds each point's place and speed, the torn links as bits, and the pins.

A figure with a smoke or fire grid in space (9.8) saves a checkpoint every **1 s** instead (0.5 s, or 0.25 s with cloth): a 24³ grid is 399.7 KB a checkpoint (its Float32 values packed two to a slot), so 60 s of film is 23.4 MB, and a 32³ grid (0.95 MB) is thinned after about 30 s. A seek replays at most 1 s of the world, 120 steps.

A figure may use at most **32 MB** for physics checkpoints. Past that, the oldest half of the checkpoints is thinned to every 1 s, then every 2 s, with a notice `checkpoints_thinned`. Seeking into a thinned part takes longer (section 11.2).

### 10.4 Seeking

Seek to `t`: load the last checkpoint at or before `t`, then step forward to `t` (at most 60 steps of 1/120 s, or 30 with cloth). A figure that was just loaded computes checkpoints ahead in idle slices, at most 5 ms each, so the first seek is fast too. While the world is behind, the player shows "catching up", as for states (`animation-time/design.md` 8.5).

A world can be built at any film time (the time the figure is shown when it is loaded or sought), so nothing in the first step may depend on that time: a mover starts at rest at the first step (its speed is the change of its shape between steps, and there is no step before the first), and a smoke grid takes its wind and source at the first step (round 8).

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
| Fire in the plane, with two burning bodies | 64 × 64 | 4 ms | 1 ms |
| Smoke or fire in space, the default size, in a worker | 24 × 24 × 24 | 8 ms | 2 ms |
| Fire in space, the largest, in a worker | 32 × 32 × 32 | 8 ms (in Rust, 16 ms measured, 11.6) | 4 ms |
| Flag over a fire in space, in a worker | 64 × 32 cloth and 24³ fire | 8 ms | 2.5 ms |
| Seek anywhere in a 60 s film, fire in space, warm | 24³ | 500 ms | 120 ms |
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

**Measured (round 9 finish), cloth rows.** Chrome 157 with the CPU 4× slower, `packages/kernel/bench/chrome-physics.mjs`: 1 s of warm-up, then 5 s of frames of two steps each. Node is `packages/kernel/bench/physics.bench.ts`, the mean of a frame, the same machine.

| Scene | Goal (Chrome ×4) | Chrome mean | 95% | Worst | Node mean | Node budget |
|---|---|---|---|---|---|---|
| 2D rope, 400 points, a ball on it | 2 ms | 1.27 ms | 1.80 ms | 2.50 ms | 0.35 ms | 0.5 ms |
| 3D cloth 32 × 32 on a ball | 3 ms | 3.45 ms | 4.20 ms | 5.00 ms | 0.78 ms | 0.75 ms |
| 64 × 32 flag in gusts | 6 ms | 4.21 ms | 4.80 ms | 5.60 ms | 0.92 ms | 1.5 ms |
| 64 × 32 over 40 bodies | 8 ms | 8.02 ms | 9.10 ms | 9.90 ms | 1.92 ms | 2 ms |
| 64 × 32 that hits itself | 8 ms | 8.71 ms | 12.90 ms | 15.80 ms | 1.88 ms | 2 ms |
| Two 64 × 32 cloths | 8 ms | 9.85 ms | 12.10 ms | 16.60 ms | 2.29 ms | 2 ms |
| 64 × 32 and 2,000 drops | 8 ms | 10.21 ms | 11.60 ms | 12.50 ms | 2.30 ms | 2 ms |

Three small steps instead of four (9.5) took the Chrome rows down by 8% to 19%, except the cloth that hits itself, which keeps four (before: rope 1.57, 32 × 32 3.76, flag 5.06, over 40 bodies 9.67, self 8.67, two cloths 12.04, water 11.78 ms). Rows still over their goal: the 32 × 32 sheet, two cloths and cloth in water in Node; in Chrome, every row but the rope and the flag.

**Measured (task 10.9, round 1 of the Rust loops, 11.6).** The same Chrome script and Node bench, the TypeScript loops (`--kernels off`) against the Rust loops, on one computer in one session, three runs of each in turn, the run with the lowest mean of each:

| Scene | Goal (Chrome ×4) | Chrome TypeScript | Chrome Rust | Node TypeScript | Node Rust | Node budget |
|---|---|---|---|---|---|---|
| 2D rope, 400 points, a ball on it | 2 ms | 1.38 ms (95% 2.10) | 1.10 ms (1.80) | 0.33 ms | 0.28 ms | 0.5 ms |
| 3D cloth 32 × 32 on a ball | 3 ms | 3.50 ms (4.30) | 3.13 ms (3.80) | 0.80 ms | 0.78 ms | 0.75 ms |
| 64 × 32 flag in gusts | 6 ms | 4.50 ms (5.20) | 3.05 ms (3.70) | 0.93 ms | 0.70 ms | 1.5 ms |
| 64 × 32 over 40 bodies | 8 ms | 8.25 ms (9.20) | 6.98 ms (7.80) | 1.91 ms | 1.74 ms | 2 ms |
| 64 × 32 that hits itself | 8 ms | 8.88 ms (13.20) | 8.00 ms (11.90) | 1.89 ms | 1.93 ms | 2 ms |
| Two 64 × 32 cloths | 8 ms | 10.30 ms (12.70) | 7.57 ms (9.80) | 2.17 ms | 1.86 ms | 2 ms |
| 64 × 32 and 2,000 drops | 8 ms | 11.04 ms (12.50) | 9.11 ms (10.40) | 2.29 ms | 2.04 ms | 2 ms |
| 3D liquid, 2,000 drops | | | | 1.60 ms | 1.57 ms | 1.5 ms |

The Chrome means drift by about 10% between runs and over a session on this computer (the first run of the TypeScript loops that day gave the numbers of the round 9 table above), so compare the two columns of this table with each other, not with the table above. The worst frame of the rope is 5 ms with the Rust loops (2.9 ms without), in all three runs; it was not looked into (the product runs cloth in a worker). Rows over their goal in Chrome with the Rust loops: cloth in water, the 32 × 32 on a ball, and the cloth that hits itself (by 14%, 4% and 0%).

**Measured (round 11B), smoke and fire in space.** Node (`physics.bench.ts`, a frame is two steps and one grid step, 20 s after 1 s of warm-up) and Chrome 157 with the CPU 4× slower (`chrome-physics.mjs`, the page's main thread; the product runs it in the worker), Apple M1 Pro:

| Scene | Goal (Chrome ×4) | Chrome mean (95%) | Node goal | Node mean (95%) |
|---|---|---|---|---|
| Fire in space, 24³ | 8 ms | 15.5 ms (16.5) | 2 ms | 4.0 to 4.4 ms (5.0) |
| Fire in space, 32³ | 8 ms | 35.3 ms (36.7) | 4 ms | 9.1 ms (9.7) |
| 64 × 32 flag over a fire, 24³ | 8 ms | 20.7 ms (22.0) | 2.5 ms | 5.0 to 5.2 ms (5.8) |
| Seek anywhere in a 60 s film, fire 24³, warm | | | 120 ms | 128 ms median, 300 ms worst |

All four missed their goals by about a factor of two. A smoke step was about 3.7 ms in Node: the 20 pressure passes 1.3 to 1.5, carrying the flow 0.75, `T`, `F` and smoke 0.75, swirl 0.4, the rest 0.3. They were Rust-rule candidates (11.6); no port was made in that round. A checkpoint is 399.7 KB; 200 grid steps make no collection.

**Measured (task 10.10, the grid in space in Rust, 11.6).** The same Node bench and Chrome script, on the same computer, before the port (the TypeScript loops, the table above, measured again the same day) and after it (the Rust loops, the grid on the build with SIMD):

| Scene | Goal (Chrome ×4) | Chrome before | Chrome after | Node goal | Node before | Node after |
|---|---|---|---|---|---|---|
| Fire in space, 24³ | 8 ms | 13.8 ms (95% 14.3) | 6.7 to 7.4 ms (7.6 to 8.1) | 2 ms | 3.3 to 3.4 ms (3.7) | 1.6 ms (1.7) |
| Fire in space, 32³ | 8 ms | 32.5 ms (34.2) | 15.5 to 16.7 ms (16.5 to 20.2) | 4 ms | 7.8 ms (8.2) | 3.6 ms (3.8) |
| 64 × 32 flag over a fire, 24³ | 8 ms | 18.4 ms (20.0) | 11.8 to 12.9 ms (12.6 to 13.9) | 2.5 ms | 4.7 to 4.9 ms (5.0) | 2.7 ms (2.9) |
| Seek anywhere in a 60 s film, fire 24³, warm | | | | 120 ms | 101 ms median, 208 worst | 45 ms median, 86 worst |

The 24³ fire and the 32³ fire meet their Node goals and the 24³ fire its Chrome goal. The 32³ fire (194%) and the flag over a fire (148%) are still over in Chrome, the flag over a fire by 8% in Node (11.6 lists what is left to try). A checkpoint is 399.7 KB; 200 grid steps make no collection, with the kernels on and off.

### 11.3 Hard limits

These are the same on every computer. Over a limit, the line is refused with `limit` (`errors.md` 3).

| Item | Limit per figure |
|---|---|
| Bodies (2D and 3D together) | 1,000 |
| Joints | 1,000 |
| Liquid particles (all `Liquid` and `Pour` together) | 2,000 |
| Wave grid | 64 × 64 |
| Smoke grid | 64 × 64 |
| Smoke and fire grids in the plane, together | 64 × 64 cells |
| Smoke or fire grid in space | one, at most 32 × 32 × 32 |
| Burnable things | 64 |
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
| Cloth, no garbage | 2,000 steps of a 64 × 32 flag in wind, with the Rust loops on and with them off | no collector run in the 2,000 steps |

The "no garbage" rows count collector runs (Node's `gc` performance entries) in a window that starts after a `gc()`, so what
the setup left in the young generation does not fall into it: the bench's Node is started with `--expose-gc`
(`packages/kernel/bench/vitest.config.ts`), and a row that needs the setup's garbage gone fails with a message that says so
when it is not. A row collects once before its own setup too: a collection frees the Rust module of the row before, and
the code the engine made that holds that module is thrown away with it, which makes the next steps run in the interpreter
and make megabytes in their first 40 steps (a collection in the window, from a row that makes none).

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
| Heavy ball, wide swing | A 1 kg ball pinned to the end of a 2 m rope of 0.01 kg and 50 points, let go with the rope level, for 3 s | the rope's length within 2%, the ball within 2% of 2 m from the pin, and never higher than where it started (9.5, the body's tether) |
| Smoke, no volume lost | Smoke past a ball in a steady wind, a candle, and a gusty wind with a light body, read at 0.5 to 3 s | after the projection, the largest divergence is under 0.25% of (fastest air / cell size); measured at most 0.15%. 20 passes leave the slowest, box-wide part of the error a little open, so it is not 0 |
| Smoke kept | Hot smoke in a closed jar, its source stopped (`until = 0.5`), for 10 s | the mass stays within 0.1%; measured within 1e-12, because the step scales the carried smoke back to its mass (9.4) and the blending loses far less than the 0.5% a step that scaling may make up |
| Still air | Smoke round a solid ball with no heat and no wind, 10 s | every air speed stays exactly 0 and the smoke does not move, to the last bit |

### 11.6 When a solver moves to Rust

Status: round 1 built (task 10.9, "As built" below); the grid in space built (task 10.10, "As built, round 2"); the cloth's round 2 open. Each solver is first made as fast as it can be in TypeScript (the fixes in
`docs/research/physics-papers.md` 8 and 9). Then, in Chrome with the CPU 4 times slower:

- A solver whose rows are all within their goal stays TypeScript.
- A solver with any row more than 25% over its goal moves to Rust compiled to WebAssembly, alone: one `step()` call a
  step, its arrays read by TypeScript through typed-array views, its checkpoints as bytes. The TypeScript solver stays
  as the fallback and the reference; a test compares the two films' hashes.
- The order, if needed: cloth, then the grid in space (9.8), then liquid. Bodies, the driver, the kernel and the UI stay
  TypeScript.
- The Rust tools (rustup, cargo, the `wasm32` target) and any crate need the product owner's approval first, and a
  crate needs an entry in `docs/design/libraries.md`.

**As built (task 10.9, round 1; the product owner approved the Rust toolchain on 2026-11-18, no crates).** The proposal
above is one `step()` call a step. What is built is smaller, because the TypeScript step reads bodies, solids, the smoke
flow and the liquid through many hooks, and moving all of it would move most of the physics:

- **The step stays in TypeScript** (its order, pins, grabs, body coupling, slow links, tearing, sleep, checkpoints). Its
  **hot loops** are in Rust and called from it, each on whole arrays (thousands of points), so a call costs nothing next
  to the loop. Round 1 ported, in `packages/kernel/wasm/src/lib.rs`: the stretch, shear and bend pass over the links
  (`solve_links`; the links with a pinned end stay TypeScript), the tethers, the moves and speeds of a small step
  (`advance`, `speeds_advance`, `speeds`), a rope's three-band chain, the air on the faces (for a steady wind; a smoke flow
  that changes the air by place stays TypeScript), the neighbour grid in space (`grid_build`, `grid_pairs`,
  `grid_in_box`: the cloth's and the 3D liquid's) and a hull's test of its candidate points (`hull_hits`; `pushOut` stays
  TypeScript and runs on each hit in the same order).
- **The same bits.** Each Rust loop is a line-by-line copy of its TypeScript loop: the same operations in the same order,
  `f64` only, no fused multiply-add (WebAssembly has none), no SIMD, `f64.sqrt`, `f64.floor` and `f64.abs` (which round
  as `Math.sqrt`, `Math.floor` and `Math.abs` do). The TypeScript loops stay, as the fallback (no WebAssembly, or the
  module did not compile) and as the reference. A scratch hash check plays 15 scenes (the seven of the Chrome bench, a
  cross of two sheets, a net torn by a ball in wind, a pour, a rope in wind, pins to bodies in the plane and in space,
  two thicknesses over a box) for 10 s with and without the kernels and compares a hash of every cloth, drop and body
  array every second: equal in all 15.
- **The arrays the loops read live in the module's memory.** One instance of the module for each `ClothSet` and one for
  each 3D liquid grid (`KernelArena`, `physics/wasm/kernels.ts`); TypeScript keeps typed-array views on it, made once when
  the set is built and never again (nothing grows in a step, so a view never goes stale). The set is sized for its own
  counts; the grid for the limits of 11.3 (2,000 drops, 4,096 points). Every call has integer arguments only (byte offsets
  and counts); the numbers a call needs (the small step, gravity, the wind, the box of a search) are written first to a
  block of the same memory, because a floating-point argument is boxed by the caller (garbage) unless the engine inlines
  the call.
- **Rust without `no_std`.** `f64::sqrt` and `floor` are not in `core` on stable Rust, and `core::arch::wasm32::f64_sqrt` is
  unstable; `std` gives the same instructions and the module needs no allocator (it takes no imports and none of the
  module's code allocates). Size: 13.5 KB, `packages/kernel/src/physics/wasm/kernels-wasm.ts` (base64, committed, rebuilt by
  `npm run build:wasm`; `node packages/kernel/wasm/build.mjs --check` tells whether the file is what the source builds to).
- **Main thread.** A browser's main thread may refuse to compile a module over 4 KB in one go (Chrome). The loader
  compiles in a worker or Node at the first use, and a page's main thread calls `initPhysicsKernels()` once at start-up
  (the Chrome bench page does, and so do `createHeadlessApp`, which `createApp` starts through, and the studio's
  `main.ts`; nothing waits for it, one compile serves every call); a solver built before it resolves runs the TypeScript
  loops, with the same film. `setPhysicsKernels(false)` turns the kernels off for solvers built after it (tests, the hash
  check). `physicsKernelsActive(figure)` says which loops a figure's cloth and liquid solvers run (`true`, `false`, or
  `undefined` with no such solver); the studio's physics readout ends with "Rust" or "TypeScript" (for a world in the
  worker, the worker's answer in its reply).
- **A stale module is caught.** `build.mjs` writes into the header of `kernels-wasm.ts` the SHA-256 of `lib.rs`,
  `Cargo.toml` and `Cargo.lock`; a spec test hashes the three files and compares, so CI (which has no Rust) fails when a
  source changed and `npm run build:wasm` was not run.
- **No garbage in a step.** The moves and speeds hand the Rust loop their raw inputs (the small step, gravity, the cloth's
  damping) and it works out the products and the speeds' factor itself, the same operations as the TypeScript loops: a
  number worked out in TypeScript is a heap number until the engine has optimised that function, and with the loop gone
  the function is called too seldom to be optimised soon. A step's copy of the points to the start-of-step arrays no
  longer makes three views a step.
- **No garbage in the rest of a step (findings PH-15).** What was left, 110 bytes a step with the kernels on and off, and
  in a sheet resting on a ball 130 KB a step, came from numbers handed from one method to the next and from objects made
  at each call, in both modes. A sampling heap profile (minor collections included, 3,000 steps after 8,000) found them;
  the rules that fixed them hold for every method a step calls. (1) A double passed as an argument or returned is a heap
  number unless the engine inlines the call, and it inlines only small calls, so the collision code hands doubles
  through `ClothSet.ar` (a `Float64Array` of 24: the caller writes the slots, the callee reads them; the slots are named
  at each method), the step's length through the fields `hStep` and `hsub` (a driver sets `hStep` and calls `stepWorld`),
  the box of a grid search through `NeighbourGrid3.box`, and the liquid's masses are read from its array. (2) No closure
  made inside a method a step calls (it puts a context on the heap at each call, even when the closure is never made),
  no `for … of` and no `some`/`find` with a function in the step, a loop with an index instead. (3) A method that
  returns at once on most steps is checked in its caller (`prepLinks`), since a small method called once a step is not
  optimised for a long time and boxes every number it reads. None of it changes an operation or its order: the film is
  the same bits (a hash of every readout and array every second, 12 scenes, 8 s, kernels on and off, equal before and
  after).
- **Measured**, Chrome 157 with the CPU 4× slower, mean of a frame of two steps, the TypeScript loops and the Rust loops
  on the same computer in the same session (best of three runs each): rope 1.38 → 1.10 ms, 32 × 32 on a ball 3.50 → 3.13,
  flag 4.50 → 3.05, over 40 bodies 8.25 → 6.98, self 8.88 → 8.00, two cloths 10.30 → 7.57, cloth in water 11.04 → 9.11
  (goals 2, 3, 6, 8, 8, 8, 8). In Node (the rows of 11.2, same way): flag 0.93 → 0.70 ms, two cloths 2.17 → 1.86, cloth in
  water 2.29 → 2.04, over 40 bodies 1.91 → 1.74, rope 0.33 → 0.28; the 32 × 32 on a ball (0.80 → 0.78), the cloth that hits
  itself (1.89 → 1.93) and the 3D liquid (1.60 → 1.57) did not change. The link pass is the least helped (1.2×: it is bound
  by memory, not by the maths); the moves, speeds, tethers and air are 2× to 3.5× faster.
- **Left (round 2, only if a Chrome row still misses its goal):** `prepareSelf` (24% of the cloth that hits itself, 12% of
  two cloths) with its `grid_in_box` calls (15% of `self`: about 2,000 small searches a step, 70 ns each, so the cost is the
  call and a batch of boxes in one call is the next step), `prepareDrops` and `faceTable` (14% of cloth in water),
  `hitSphere` and the faces a ball meets (about 17% of the 32 × 32 on a ball). Rows still over their goal in Chrome after
  round 1: cloth in water (114%), the 32 × 32 on a ball (104%), self (100%).
- **Candidates from round 11B (now built, below):** the grid in space (9.8). In Chrome with the CPU 4× slower the 24³ fire was
  15.5 ms against 8 (194%), the 32³ fire 35.3 ms (441%) and the flag over a fire 20.7 ms (258%), all far over the 25% of the
  rule. In Node a smoke step was 3.7 ms: the 20 red-black passes of the pressure solve (1.3 to 1.5 ms), carrying the three
  speeds (0.75), `T` and `F` (0.4), smoke (0.35) and the swirl (0.4).

**As built, round 2 (task 10.10, the grid in space; finding PH-35).** Same rules as round 1 (`f64` arithmetic, line-by-line
copies, no fused multiply-add, the TypeScript loops stay as the fallback and the reference, no memory made in a step).

- **What is in Rust** (`lib.rs`, the exports `grid3_*`): the three carries of the flow (`advectFlow`), the lift of a smoke and
  of a fire (`lift`, `fireLift3`), the swirl (`confine3`), the fire's cells (`burnFuel3`, `fireSource3` and `coolFire3` in one pass
  over the cells, then `quench3` over a list of the cells the drops are in: each cell's three steps read and write that cell
  only, so one pass gives the bits of three), the solid faces (`solidFaces`, from nine numbers a body that TypeScript writes
  each step), the projection (`project`: the rows' air spans, the cells off the plain stencil, 20 red-black passes, the gradient),
  the carrying of `T` and `F` and of smoke with its mass kept and the outflow (`advectFire3`, `advectSmoke`, `outflow`), the health
  check (`checkHealth`) and the readouts (`hottest3`, `flameCells3`, `fuelSum3`, `Smoke3.mass`, `Smoke3.maxSpeed`: sums stay in
  index order). `divergence` (a measure for tests, not in a step), marking solids, the drag, `applyImpulses`, `flowAt` (called per
  cloth point, 25 ns), the source marks, `save` and `load` stay TypeScript. `grid3_outflow` is not an export: it returns a number,
  and a number returned to TypeScript is boxed; it is a function inside `grid3_advect_smoke`.
- **Two blocks, no number in a call.** Each export takes two byte offsets: an integer block (`GI` in `kernels.ts`: the size, the flags and
  where each array is) and a number block (`GF`: the cell sizes, the step, the wind, the lift, the swirl, the fire's settings, and a
  slot for a result). `Smoke3` writes them, swaps an array's slot when it swaps the array (`u` with `u2`, `s` with `s2`, `T` with
  `T2`), and every array of the grid is a view on the grid's own module instance (`KernelArena`, about 2 MB for 24³ and 4.5 MB for 32³),
  made once. Without the kernels the arrays are plain typed arrays and the old loops run. `physicsKernelsActive` also asks the grid.
- **SIMD.** The same source is built twice (`build.mjs`), without and with `-C target-feature=+simd128`; the grid takes the second
  where the engine compiles it (`setPhysicsGridSimd(false)` is the switch for the hash check; cloth and liquid keep the scalar
  module). Where the engine has no SIMD, the loader marks that build failed and the grid runs the scalar module. SIMD is in the
  three carries of the flow and in the carrying of `T`, `F` and smoke: each lane of an `f64x2` is one cell and does that cell's
  scalar operations in the same order; a pair that has a lane outside the box, in a solid, at rest or with no air to gather from
  is done by the scalar code, cell by cell. The 20 pressure passes were tried with SIMD (two cells of one colour a vector, `f32x4`
  loads and shuffles) and were no faster (0.63 against 0.59 ms), so they are scalar. The hash is equal in all three modes.
- **Numbers.** Node, `physics.bench.ts` (a frame, two steps and a grid step): 24³ fire 3.3 to 3.4 ms → 1.6, 32³ 7.8 → 3.6, flag over a
  fire 4.7 to 4.9 → 2.7, seek in a 60 s film (median, warm) 101 → 45 ms. Chrome 157, CPU 4× slower: 24³ 13.8 → 6.7 to 7.4 ms, 32³ 32.5 →
  15.5 to 16.7, flag over a fire 18.4 → 11.8 to 12.9. A 24³ grid step in Node is about 1.5 ms: the pressure passes 0.47, setup and
  gradient of the projection 0.12, the flow's carrying 0.29, `T` and `F` 0.16, smoke 0.13, swirl 0.14, solid faces 0.045.
- **Size.** `kernels-wasm.ts` holds the two builds: 35,183 bytes scalar and 44,767 bytes with SIMD (round 1 alone was 13.5 KB), about 107 KB of base64.
  A grid step makes no collection with the kernels on and off (bench rows of 11.4).
- **Still over their goal in Chrome:** 32³ (194% of 8 ms) and the flag over a fire (148%); in Node the flag over a fire (2.7 against 2.5).
  The pressure passes (30% of a step) cost 1.7 ns a cell and a pass; a two-cell vector there was no faster (above), so what is left
  is the instruction count of a cell, not the arithmetic; what is left to try, none of which changes a bit: (1) the swirl and the gradient of the projection with `f64x2` (the
  loops are contiguous; about 0.1 ms of 24³), (2) the pressure kept as `f64` values rounded to `f32` in a work array in red and black halves, so
  that a vector is two cells of one colour with no shuffles (a bigger change, the layout of `p` in a checkpoint stays), (3) the cloth's
  own cost in the flag row (tethers 10% and links 10% of the row, the air from the flow 12%, round 2 of the cloth). A 32³ fire at 8 ms
  in Chrome needs about 2× more than (1) and (2) together; a change of the pass count or the grid size is the planner's.

## 12. Drawing

- Bodies draw as their shape at their pose, interpolated between steps (10.1), with the shape's style. A sleeping body looks the same; the algebra row shows it is asleep.
- Force arrows (with `world with show = "forces"` or the style bar button) start at the centre of mass, one per kind, with the kind's colour and label; tension starts at the anchor. Speed arrows the same way.
- Joints draw thin: a hinge as a small ring, a spring as a zigzag, a rope as a line that sags when slack, a weld as a small cross.
- Liquid particles draw as one batch of discs in the liquid's colour (the particle painter, `animation-time/design.md` 10.8). A smooth surface (metaballs) is for later.
- Waves draw as a surface in the Space view, smoke as a shaded image under the shapes.
- In space (round 7; since round 9 this is the software painter's path, and the WebGL 2 painter of 12.1 draws drops and waves where WebGL 2 exists): drops are the software painter's dots, a drop wide, drawn far to near among the faces, so a ball in a tank shows over the drops behind it; waves are a lit mesh through the cell corners, from every second corner past 32 a side (at most about a thousand faces), that hides no lines; still water is a translucent patch the size of the view at its level. Waves in the plane are a line through their points over a light fill down to their bottom. Measured in Node with a canvas that draws nothing, 2,000 drops and a 64 × 64 wave grid cost 0.3 ms for the scene and 2.3 ms for the painter a frame.
- Cloth in space draws as a lit sheet, two-sided (the back a little darker), with faint threads every 8 points. Cloth in the plane draws as its threads, a rope as a smooth line.
- 2D drawing is in `packages/sdk/src/screen/`, 3D in its Space painter, as for every area.

### 12.1 The WebGL 2 painter for cloth and liquid in space

The Space view's software painter (Canvas 2D) sorts and fills every face each frame. That is fast enough for solids and surfaces, but 4,000 cloth triangles on a CPU 4 times slower would take more than the whole frame. So cloth and liquid in space are drawn by a WebGL 2 painter in `packages/view`, the first part of the WebGL 2 renderer of `docs/features/space-3d/design.md` 9, written against its `GpuBackend` interface:

- The cloth's points go into one vertex buffer each frame (the copy of 11.2); the triangles are fixed, so their index buffer is made once. Normals are worked out on the GPU.
- Drops draw as one instanced batch of discs.
- The depth buffer hides what is behind, so nothing is sorted on the CPU.
- The software painter draws everything else on its canvas, under or over the WebGL canvas as depth needs: solids, points and labels stay exactly as today.

Without WebGL 2, the software painter draws the cloth from every second point (a 32 by 16 sheet for a 64 by 32 cloth) and every second drop. Only the picture is coarser: the physics and the film are the same.

**What round 9 built.**

- **Scene items.** The Space view's scene (`packages/sdk/src/screen/space/scene3.ts`) has two new kinds. A `sheet` is nx × ny points in one `Float32Array` (point i + j nx), with a colour, an alpha, a thread every k points, whether it hides lines (a cloth does, waves do not), optional triangles with a topology number (for a torn cloth), and the software painter's steps (`coarse` for a screen without WebGL 2, `fine` for an SVG). A `drops` item is one batch: the centres in one `Float32Array`, a colour and a radius. A `Liquid` in space is now one `drops` item and `Waves` a `sheet` through its (n + 1) × (n + 1) cell corners, plus its rim lines. A `Cloth` adds a `sheet` with `threads = 8`, `occludes = true`, `coarse = 2`, `fine = 1`. The clip box does not cut these items in the scene; their painter cuts them (the GPU per pixel, the software painter per face and dot).
- **The painter** (`packages/view/src/gl/`, the subpath `@incantly/view/gl`, outside `core/`). `GlBackend3` is the small WebGL 2 back-end: the context (MSAA, depth, premultiplied alpha), three programs, resizing and context loss (lost: every frame returns `webgl_lost` and the software painter draws; restored: everything is made again). `MeshPainter3.paint(frame)` takes a `GlFrame3`: the Space view's own `cam.vp` and the rotation of `cam.view`, the light, the clip box, the solids as triangles, the sheets and the drops. A sheet's points go into an RGB32F texture each frame (one `texSubImage2D`, 24 KB for 2,048 points); its index buffer is made once per size and topology; the vertex shader reads each point by `gl_VertexID` and the four points round it, so the normals are worked out on the GPU. The light is the software painter's own (key and fill fixed to the camera, the back shaded as its other side at 0.85), and the threads are drawn in the fragment shader a pixel wide. Each batch of drops is one instanced draw of camera-facing discs, lit like small balls. The `GpuBackend` of `space-3d` 9.1 (`core/gpu.ts`, `backends/webgl2.ts`) has no per-instance attributes or float textures yet, so the painter does not draw through it. It keeps to the same rules: the host owns the canvas, nothing throws, everything returns a `Result`. Folding the two together is for the full renderer.
- **Compositing.** There is one canvas on the screen, the 2D one. The page has one WebGL 2 context on a canvas that is never shown (`sharedSpaceGpu()` in `packages/sdk/src/screen/space/gpu3.ts`), shared by every Space view and the PNG export (performance 4.1). Each frame with sheets or drops: (1) the software painter draws the background, floor and faces far to near, with the software dots among them; (2) the GPU writes the faces that hide things (`occludes`, alpha at least 0.5) into its depth buffer only, pushed back a little so a cloth lying on a solid wins; then it draws the opaque sheets, the see-through sheets (no depth write) and the drops, all tested against that depth; (3) its picture is copied over the 2D canvas with `drawImage`; (4) the software painter draws the lines, points and labels on top. Lines and points behind a cloth are drawn dashed and faint, as they are behind a solid: the cloth hides them through a coarse copy of its faces, at most 16 a side. So solids and sheets hide each other per pixel. The limits: a see-through face (a glass tank, a plane, still water) does not hide a sheet or drop behind it, which shows through it as through glass. A sheet or drop in front of a see-through face is drawn over it. Lines and points are judged against the coarse copy, so a line within a few pixels of a cloth's edge can be dashed or not on the wrong side. Labels are always on top, as with solids. A figure with no sheets or drops never touches the GPU.
- **Without WebGL 2** (the host fault `webgl_unavailable`): the screen's software painter draws a sheet from every `coarse`-th point and every second drop, among the faces as in round 7. The Space pane raises the notice `cloth_drawn_coarse` (B114) once, naming the first object drawn coarser. Waves are drawn as in round 7 (every second corner past 32 a side), which is no coarser than before, so they raise no notice. An SVG always uses the software painter at full detail: every drop, and every point of a cloth. A PNG takes the GPU's picture at its scale, as the screen does.
- **Speed** (round 9, Chrome 157, Apple M1 Pro, `packages/sdk/bench/chrome-gl.mjs`): a 64 × 32 sheet with threads, 2,000 drops and a ball, 1,000 × 640 px. With the CPU slowed 4 times, the sheet and drops cost about 1.0 ms of the page's frame (median; 95% of frames under 1.4 ms) against the budget of 3 ms. The software fallback on the same page costs 6.1 ms. In Node the page's share is 0.16 ms against a quarter of the budget (0.75 ms).

**Smoke and fire in space (round 11B).** A grid in space is a scene item `volume` (the box, `n`, the `T` and smoke arrays, the fire's `heat`, the smoke colour). *WebGL 2* (`packages/view/src/gl/volume3.ts`): each frame one `texSubImage3D` writes `T / heat` and the smoke into an `RG8` 3D texture (made once per `n`); one full-screen draw a grid marches 48 steps from where each pixel's ray enters the box to where it leaves or meets a solid, front to back, with the plane's black-body ramp of `T` (`fireColor`) as emission times its cover, smoke absorbing `0.85 s` (the covers are for one cell, so a step of `d` cells is `1 − (1 − a)^d`), stopping at alpha 0.98; the output is premultiplied and composited over the sheets and drops. The screen's depth buffer cannot be read, so the painter fills a depth texture of its own (a second pass of the same solids, and a cloth's coarse faces, as triangles) and the shader stops the ray there; the rays come from the inverse of the Space view's own matrix, so every projection works, the eye may be inside the box, and only the box's projected rectangle runs. *Without WebGL 2* the software painter draws 12 slices across the axis that faces the camera most, each cell with a cover over 0.02 a quad of the plane's colour (smoke a grey quad over it), far to near among the faces, with no notice (`cloth_drawn_coarse` is for cloth). PNG takes the GPU's picture; SVG the slices.

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
11. **Fire, and smoke in space.** `swirl` for smoke, `Fire` in the plane, burnable bodies, cloth and walls, water that puts fire out, the crackle on request; then the grid in space, its ray-marched drawing, cloth in its wind. Examples: a candle, a camp fire with a log that burns away, a curtain that catches fire, a fire put out by a tap, a flag over a fire in space, smoke round a ball in space.

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
- For fire and smoke in space (9.7, 9.8) and the cloth fixes: the papers and manuals in `docs/research/physics-papers.md` 8 and 9 (Fedkiw, Stam and Jensen 2001; Nguyen, Fedkiw and Jensen 2002; Pirk et al. 2017; FlameForge 2024; Macklin et al. 2019; Kim, Chentanez and Müller 2012; Vertex Block Descent 2024; the PhysX 3 cloth manual; Blender's gas manual). Methods only, no code.
- The reference app's motion workarounds, as studied in `docs/features/animation-time/design.md` 2.
- Public methods, used from their descriptions and not from any code: sequential impulses with warm starting (Erin Catto, GDC talks 2006 to 2014); separating axis tests, GJK and sweep and prune (Christer Ericson, *Real-Time Collision Detection*, 2005); expanding polytope depth (Gino van den Bergen, 2001); position-based fluids (Macklin and Müller, 2013); extended position-based dynamics (Macklin, Müller and Chentanez, 2016); small steps in physics simulation (Macklin and others, 2019); unified particle physics for cloth and liquids together (Macklin and others, 2014); stable fluids (Jos Stam, 1999); ray wheels, as described in many public vehicle write-ups.
