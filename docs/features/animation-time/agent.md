# Animation and time: how the model uses it

## 1. Catalogue entries

One-line forms printed by the catalogue builder. They go into the teacher's instructions with the command catalogue (this area's block is about 470 tokens).

```text
t, bt, beat                          film time (s), time in this beat, beat index; read-only
P = (cos(t), sin(t))                 any formula may read t
a = 0 in 0..10 step 0.1              slider
a with loop = bounce|up|down|once|random, period = 8
Animate(a)    Animate(a, false)    the numbers area's slider animation
x = state(x0)  x = state(x0, v0)     a value that changes by a rate (Number or Point)
x' = expr      x'' = expr            rate rule; in x' a pair (vx, vy) is a Vector
@solver step 1/480                   smaller step for stiff or fast systems
@clock 0..30                         film length
Trace(P)  Trace(P, seconds)          trail behind a moving thing; Untrace(P)  ClearTrace(P)
c = Path(P, t0, t1)                  the curve P draws for t in t0..t1 (no playing needed)
fire = Particles(count, life, pos, color?, size?, alpha?, shape?, blend?, start?, end?, loop?, seed?)
   inside Particles only: i n u v w (random per particle, 0..1) age ph (=age/life) cycle life t
fract(x) wrap(x,a,b) pingpong(x,len) ramp(x,a,b) ease(x)
ValueAt(obj, time)                   the value obj had at a film time
Play()  Pause()                      the film clock
L with rerun = continue|restart      what a changed slider does to a running simulation
```

## 2. What the tools return

`draw` line results:

```json
{ "ok": true, "name": "θ", "type": "Number", "summary": "state, 0.6 at t=0", "visible": true }
{ "ok": true, "name": "fire", "type": "Particles", "summary": "1500 particles, gpu", "visible": true }
{ "ok": true, "directive": "clock", "summary": "0..30 s" }
```

`figure` extras for this area:

```json
{ "clock": { "t": 12.4, "mode": "playing", "duration": 30, "beat": 3 },
  "states": [{ "name": "θ", "value": 0.31, "rate": "ω", "ok": true }],
  "animated": [{ "name": "a", "mode": "bounce", "seconds": 8, "value": 4.2 }],
  "traces": [{ "name": "bob", "source": "time", "points": 412 }],
  "reports": [] }
```

Runtime `reports` (errors.md section 3) appear in the next `draw` or `figure`: for example `unstable_state` after a spring went wild. The model should say what happened and fix it, not ignore it.

The model never sets `t`. It uses `Play()`, `Pause()`, and the film tools (`seek_beat`, `show_me`). `show_me` changes sliders; the figure reacts per `rerun`.

## 3. How the model decides

| Wanted motion | Use |
|---|---|
| A path with a formula (circle, projectile, wave) | `t` in formulas |
| Something that sweeps a parameter back and forth for the learner to watch | A slider with `loop` and `period`, then `Animate(a)` |
| A physical system with forces (pendulum, spring, orbit) | `state` and rates |
| A crowd of small things (fire, rain, stars) | `Particles` |
| A trail | `Trace` |
| The whole path at once | `Path` |
| A learner-controlled parameter on a running system | A slider; set `rerun` |

Rules of thumb the instructions teach:

- Use formulas of `t` when they exist. States only when there is no closed form.
- Always give a state its rate on the next line.
- Name states with the symbol the teacher will say (`θ`, `ω`).
- Keep a slider range sensible so the figure stays on screen (read `onScreen` in the result).
- For particles, `count` is a ceiling; start at 800 and raise only if it looks thin.
- Use `Trace(P, 4)` for a fading trail; whole-history traces get busy.

## 4. Fixing errors

| Error or report | What the model does next |
|---|---|
| `missing_rate` | Write the rate line |
| `rate_without_state` | Declare the state first (use `closest`) |
| `rate_type_mismatch` | Change the rate to a pair for a Point state |
| `bad_animate` | Animate the free number it comes from |
| `missing_particle_param` | Add the listed parameter |
| `particle_name_outside` | Move the formula inside `Particles` |
| `unstable_state` report | Add damping, lower stiffness, or add `@solver step 1/960`; say "that was too stiff; let me soften it" |
| `gpu_unsupported` | Say nothing unless it matters; the system works on CPU |
| `limit` | Reduce `count`; do not retry the same number |

Two retries per line, then move on and describe only what was drawn (core 10).

## 5. Lesson snippets

### 5.1 A pendulum, built while talking

Teacher: "A pendulum is a weight on a rod. Let's start with the pivot and the rod length."

```text
g = 9.8
L = 1 in 0.5..2
pivot = (0, 0)
```

Teacher: "Gravity pulls the weight back toward the middle. The angle changes faster the more it is tilted."

```text
θ = state(0.6, 0)
θ'' = -g / L * sin(θ)
bob = (L * sin(θ), -L * cos(θ))
rod = Segment(pivot, bob)
```

Result: all `ok`; `bob` summary `(0.56, -0.83)`. Teacher presses nothing; it calls `Play()` and says: "It swings. Watch where it moves fastest: at the bottom."

Then: `Trace(bob, 3)`. "That's its path over the last three seconds."

Then the what-if. The learner drags `L` to 2 at `t = 12`. Next turn the teacher says: "A longer rod swings more slowly." (It does not redraw anything; the state continued with the new length because `rerun` is `continue`.)

### 5.2 Recovering from an unknown name in a rate

Teacher: "Now add damping, so the swing fades."

```text
θ'' = -g / L * sin(θ) - 0.2 * ω
```

The line redefines the rate and returns:

```json
{ "ok": false, "line": 1, "col": 33, "endCol": 34, "kind": "unknown_name", "token": "ω",
  "message": "ω is not defined.", "closest": ["θ", "L"],
  "hint": "For the speed of a second-order state θ, write θ'." }
```

The old rule stays in force (a failed line changes nothing). The teacher's next call:

```text
θ'' = -g / L * sin(θ) - 0.2 * θ'
```

Result: `ok`. It says: "Now the swing fades." It does not mention the failed line.

### 5.3 Fire

Teacher: "Heat makes air rise. Here is a flame."

```text
fire = Particles(count = 1000, life = 1.2,
  pos = (0.3 (u - 0.5) + 0.12 noise(i, 3 age), 2 age - 0.5 age^2),
  color = Gradient(ph, rgb(255, 230, 120), rgb(255, 120, 30), rgb(90, 90, 90)),
  size = 0.07 (1 - ph), alpha = 1 - ph, blend = add)
```

Result: `ok`, "1000 particles, gpu". The teacher adds wind from a slider:

```text
wind = 0 in -1..1 step 0.05
fire = Particles(count = 1000, life = 1.2,
  pos = (0.3 (u - 0.5) + 0.12 noise(i, 3 age) + wind * age^2, 2 age - 0.5 age^2),
  color = Gradient(ph, rgb(255, 230, 120), rgb(255, 120, 30), rgb(90, 90, 90)),
  size = 0.07 (1 - ph), alpha = 1 - ph, blend = add)
```

Redefinition keeps the id. If the model had written `windd * age^2` the result would be `unknown_name` with `closest: ["wind"]`.

### 5.4 Animated slider for a locus lesson

Teacher: "Let the point run around the circle by itself."

```text
s = 0 in 0..2 pi
s with loop = up, period = 6
P = (2 cos(s), 2 sin(s))
Animate(s)
Trace(P)
```

Teacher: "Now it traces the circle." Then `Animate(s, false)` when it wants to freeze the picture.

## 6. Token budget

| Entry | Tokens |
|---|---|
| Catalogue block (section 1) | 330 |
| Decision table and rules of thumb (section 3), condensed | 90 |
| Error table, condensed to 6 lines | 50 |
| **Total for this area** | **~470** |

If space is needed, the particle names and helper functions can be loaded only when the lesson needs them (groups load on demand per the core design), saving about 140 tokens in other lessons.
