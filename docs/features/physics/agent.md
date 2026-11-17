# Physics: how the AI model uses it

Companion to `design.md` and `errors.md`. The model writes lines in the one language of the core design and calls `draw` (one to five lines) and `figure`. This file gives the rules, the catalogue chunks, what comes back, how to fix errors, and lesson snippets.

---

## 1. Rules the model is told (about 200 tokens, loaded with the physics chunk)

```text
PHYSICS. A shape that should not move but should block things: p with solid = true.
A thing that falls, slides and bounces: b = Body(p, mass = 2). p is its start shape.
Never write b's position. To move its start, change p. To kick it: Push(b, (2, 0)).
Ground: g = Ground(). Settings live on `world`: world with gravity = (0, -9.8).
Properties: bounce (0..1), friction (0..2), speed, spin, force. Sliders may drive them.
Links: Hinge(a, b, P), Spring(a, b, k), Rope(a, b, L), Weld(a, b).
Read results: b.v, b.energy, b.force("friction"), j.force. Show arrows: world with show = "forces".
Motion needs the film: say "press play". A changed slider replays the film from 0 unless rerun = continue.
Describe only what `figure` reports at the current time.
```

---

## 2. Catalogue chunks

Physics chunks load on demand, so a lesson with no physics pays nothing. The first physics line loads `physics-basic`. The others load when the topic needs them ("spring", "car", "water", "smoke"), or when the model asks with `figure` `want: ["physics-joints"]`.

### 2.1 `physics-basic` (target 260 tokens)

```text
Body(shape, mass?: Number, density?: Number) -> Body       # shape: Polygon | Circle | Ellipse | Box | closed Polyline
Body(solid: Sphere | Cube | Box | Cylinder | Cone | Prism | Pyramid | Polyhedron) -> Body3
Bodies(shapes: List) -> List<Body>
Box(centre: Point, w, h, angle?) -> Polygon      Box(centre: Point3, w, d, h) -> Polyhedron
Ground(y?: Number) -> Line    # solid; in space: the floor z = 0
<shape> with solid = true                       # wall or mover
<body> with bounce, friction, speed, spin, force, torque, fixed, turns, bullet, group, charge
world with gravity, air, passes, timestep, sleep, range, show
Push(b, impulse: Vector, at?: Point)   Wake(b)   Sleep(b)   Restart()
b.pos b.x b.y b.angle b.speed b.v b.spin b.energy b.momentum b.shape b.touching b.asleep b.force(kind)
Energy(b | world)  Momentum(b | world)  KineticEnergy(b)  PotentialEnergy(b)  Forces(b)
on b hit: …   (hit.speed, hit.point, hit.other, hit.impulse)
```

### 2.2 `physics-joints` (target 150 tokens)

```text
Hinge(a, b, at: Point, motor?, torque?, min?, max?) -> Joint     # in space: Hinge(a, b, at, axis)
Spring(a, b, k?, rest?, damping?, pa?, pb?) -> Joint
Rope(a, b, length, pa?, pb?) -> Joint      Rod(a, b, pa?, pb?) -> Joint
Weld(a, b, breaks?) -> Joint               Slider(a, b, axis: Vector, min?, max?, motor?) -> Joint
Pulley(a, b, P, Q, ratio) -> Joint         Grab(b, target: Point) -> Joint
j.force j.length j.angle j.broken
```

### 2.3 `physics-vehicles` (target 80 tokens)

```text
Wheel(chassis, at, r, spring?, damping?, travel?, grip?, drive?, steers?, breaks?) -> Wheel
Vehicle(chassis, wheels: List, motor?: -1..1, steer?: angle, brake?: 0..1, power?) -> Vehicle
v.speedometer
```

### 2.4 `physics-fluids` (target 90 tokens)

```text
Liquid(region, count, viscosity?, density?, color?) -> Liquid   # at most 2,000 particles per figure
Pour(at: Point, rate, speed, max?) -> Liquid
Water(level) -> Water      Water(region, level) -> Water        # floating, cheap
Waves(box, n) -> Waves     Smoke(region, n, source?, heat?, wind?) -> Smoke
l.count l.level
```

---

## 3. What `draw` and `figure` return

### 3.1 `draw`: per line

```json
[
  { "ok": true, "line": 1, "name": "ramp", "type": "Polygon", "summary": "triangle, solid" },
  { "ok": true, "line": 2, "name": "b", "type": "Body", "summary": "box 1 by 1, mass 2 kg, at (−4, 3.5), still",
    "notices": [] },
  { "ok": true, "line": 3, "name": "world", "type": "World", "summary": "gravity (0, −9.8), 1 body" }
]
```

- `summary` is short and gives the numbers a teacher wants: the size, mass, place, and whether it moves.
- A body's summary is its state at the current film time.
- Notices such as `split_shape` come on the line that caused them.

### 3.2 `figure`

```json
{
  "clock": { "t": 2.5, "playing": true, "slow": false },
  "world": { "gravity": "(0, −9.8)", "awake": 1, "energy": "39.2 J" },
  "objects": [
    { "name": "b", "type": "Body", "value": "at (−0.6, 1.4), speed 3.9 m/s down the ramp, touching ramp" },
    { "name": "mu", "type": "Number", "value": "0.3" }
  ],
  "events": [ { "t": 1.2, "kind": "hit", "body": "b", "other": "ramp", "speed": "2.1 m/s" } ],
  "undefined": [],
  "warnings": []
}
```

- `value` for a body is one line of words, never a raw array.
- `events` lists hits and broken joints since the last `figure` call, at most 10, newest last.
- A blown-up world shows in `undefined` (reason `unstable_world`) and in `warnings`.

---

## 4. How the model fixes errors

| Error | Fix in the next `draw` |
|---|---|
| `not_a_body_shape` on `Body(L)` | Use `suggest`: `L with solid = true` |
| `read_only` on `b with pos = …` | Change the start shape `p`, or `Push(b, …)` |
| `not_a_body` on `Hinge(a, p, P)` | First `p with solid = true` or `q = Body(p)`, then the hinge |
| `same_body` | Use the second body's name |
| `bad_property_value` | Pick a value from `expected` |
| `limit` | Turn still bodies into solid shapes |
| `unstable_world` warning | `s with damping = 0.5`, a smaller `k`, or `world with timestep = 1/240` |

---

## 5. Lesson snippets

### 5.1 Friction on a ramp, with an error and recovery

Teacher: "Here is a ramp."

```text
ramp = Polygon((−6, 0), (4, 0), (−6, 5))
ramp with solid = true
```

Teacher: "And a box at the top."

```text
p = Box((−4.4, 4.76), 1, 1, angle = −26.6deg)
b = Body(p, mass = 2)
```

Teacher: "Now friction. Let me add a slider."

Model writes `b with friction = mu` before `mu` exists. The result is `unknown_name` with `suggest: ["mu = 0.6 in 0..1"]`. The next `draw`:

```text
mu = 0.6 in 0..1
b with friction = mu
```

Teacher: "Press play. With friction 0.6 the box stays put. Slide mu below one half, and watch it start to slide. The ramp's slope is one half, so that is where it tips over."

The model reads `figure` after play: `b` "still, touching ramp". After the learner moves `mu` to 0.4: "speed 1.3 m/s down the ramp". It says only that.

### 5.2 Newton's cradle

Teacher: "Five balls on strings."

```text
bar = Segment((−3, 5), (3, 5)) with solid = true
balls = Bodies(Seq(Circle((k, 1), 0.5), k, −2, 2), bounce = 1, friction = 0)
strings = Seq(Rope(bar, balls[k], 4, pa = (k − 3, 5)), k, 1, 5)
```

Teacher: "Lift the first ball and let go."

```text
Push(balls[1], (−4, 0))
```

Teacher: "One ball goes in, and one ball comes out the other side. Momentum and energy both pass straight through."

### 5.3 A car hits a wall (3D)

Teacher: "A car: a box with four wheels."

```text
g = Ground()
chassis = Body(Box((0, 0, 1), 4, 2, 0.8), mass = 800)
wheels = [Wheel(chassis, (1.4, 1, 0.6), 0.4, drive = true, breaks = 30000), Wheel(chassis, (1.4, −1, 0.6), 0.4, drive = true, breaks = 30000), Wheel(chassis, (−1.4, 1, 0.6), 0.4, steers = true, breaks = 30000), Wheel(chassis, (−1.4, −1, 0.6), 0.4, steers = true, breaks = 30000)]
```

Teacher: "Give it a pedal and a wall to hit."

```text
gas = 0 in 0..1
car = Vehicle(chassis, wheels, motor = gas)
wall = Box((25, 0, 1.5), 1, 8, 3) with solid = true
```

Teacher: "Press play and push the pedal. Watch the forces when it hits."

```text
world with show = "forces"
```

After the hit, `figure` lists `events`: a hit at 18 m/s and two broken wheels. The teacher says: "It hit at 18 metres a second, about 65 km/h, and two wheels came off."

### 5.4 A dam breaks

```text
tank = Polyline((−6, 6), (−6, 0), (6, 0), (6, 6)) with solid = true
gate = Segment((−2, 0), (−2, 4)) with solid = true
water = Liquid(Box((−4, 2), 4, 4), 1500)
```

Teacher: "Now open the gate."

```text
Hide(gate)
gate with solid = false
```

---

## 6. Common patterns the model should know

- Still things should be solid shapes, not bodies with `fixed = true`. They cost almost nothing.
- A function graph is a hill: `f(x) = 0.5 sin(x)`, then `f with solid = true`.
- A slider used by a body replays the film from 0 when it moves. For "from now on", add `with rerun = continue` to the slider.
- A body's start is its shape. To start a ball higher, move the circle's centre.
- `b.force("normal")` and `b.force("friction")` give numbers to say out loud.
- `Trace(b)` draws the path.

## 7. Token budget summary

| Item | Tokens |
|---|---|
| Rules (section 1) | about 200 |
| `physics-basic` | 260 |
| `physics-joints` | 150 |
| `physics-vehicles` | 80 |
| `physics-fluids` | 90 |
| All loaded | about 780 |
