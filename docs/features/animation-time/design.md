# Animation and time: design

Status: draft for review. Details the clock `t`, slider animation, states and rates, traces, paths and particles from sections 7 and 8 of `docs/design/formula-language-and-kernel.md`, and how physics is built with them. The canvas side is in `../graphics-view/design.md`.

## 1. What the feature does

### For a learner

- Presses play and watches the figure move. Pauses, scrubs, steps a frame, changes speed, loops.
- Sees sliders animate on their own (a parameter sweeping its range) and can still grab one.
- Sees trails behind moving points, and trails of shapes that sweep out an envelope.
- Sees fire, rain, smoke or stars made of thousands of small particles.
- Changes a slider and sees a pendulum, spring or orbit react at once.

### For a teacher

- Writes `P = (cos(t), sin(t))` and the point moves. No setup.
- Writes a few lines (`θ = state(0.6)`, `θ' = ω`, ...) and gets a pendulum that obeys physics and seeks exactly.
- Writes one `Particles(...)` line for a fire.
- Asks "what if the length were 2?" by changing a slider while it plays.
- Draws a point's whole path without running it (`Path`).

### Sub-features covered

| # | Sub-feature | Section |
|---|---|---|
| 1 | The clock `t`, the player, seeking, looping, speed, time sources | 3 |
| 2 | Frame loop and one update pass | 4 |
| 3 | Slider animation (speed, repeat modes, drag while animating) | 5 |
| 4 | Time in formulas (`t`, `bt`, helper functions) | 6 |
| 5 | States, rates, solver, checkpoints, seeking, accuracy | 7 |
| 6 | Input changes while playing (what-if) | 8 |
| 7 | Traces and paths | 9 |
| 8 | Particles | 10 |
| 9 | Building physics: recipes | 11 |
| 10 | Performance and budgets | 12 |

## 2. How GeoGebra does it (plain words)

What we learned from the animation code in the kernel, the slider code, the trace code in the view, and the manual's pages on animation, trace and the graphics view.

### Animation

- **Only numbers (sliders), angles and points on paths animate.** Each is flagged "animating" and added to a list held by an animation manager.
- **A timer drives it.** The manager runs a timer at up to 30 frames per second. On each tick every animated object takes one step, then the changed ones are updated together in one cascade, then the views repaint once.
- **Step size** is the slider's range times its speed, divided by a "standard" time of 10 seconds and the actual frame rate. So speed 1 sweeps the range in about 10 s. The step is recomputed from the **measured** time since the last tick, so a slow machine still runs at roughly the right speed.
- **Frame rate adapts.** The manager measures how long a step plus repaint took, and picks the rate that would use at most 80% of the time, between 6 and 30 fps.
- **Repeat modes**: oscillating (bounce), increasing (wrap to the start), decreasing (wrap to the end), and increasing once (stop at the end).
- **Increments**: an animated slider's value is rounded to its increment, then cleaned to a decimal fraction (no `2.8000000001`).
- **Random sliders**: a slider can be a random number that re-rolls at animation time.
- **One button**: the play/pause button appears in the view when something animates. Individual objects are toggled from their context menu.
- **The animation is wall-clock state**: the animated value is accumulated step by step. There is no function from time to value, so it cannot be seeked, and reload starts from the stored slider value.

### Trace

- Any point (and some other objects) can have "trace" on. While on, each time the object is repainted after a change, the view draws it into a persistent background bitmap, which is never cleared until the view changes or the user clears it.
- Because it is a bitmap that is reset whenever the view is redrawn from scratch (for example after a zoom or pan), the trail is lost on view changes, depends on resolution, and cannot be replayed or seeked.
- A **locus** is a different, geometric thing: a curve of sample points computed by moving one point along a path and recording another.

### Physics

- There is no physics engine. People make motion from:
  - a **time slider**: a number animated from 0 up, with all other quantities as formulas of it;
  - **sequences and iteration**: lists built by repeating a rule, to make a discrete simulation (Euler steps) and then pick an element with a second slider;
  - an **ODE command** that numerically solves first and second order equations over an interval, returning a curve, which is a static object (a function or locus) not a running simulation;
  - **conditions** inside formulas for bounces (`if` with hand-written reflection).
- Collisions, contacts and joints are not supported. Energy conservation is up to the author.
- This works for lessons but is slow to author, discrete, and a "what if" requires rebuilding the list.

### What works

- Animated sliders as the one way to drive a model.
- One batched update per tick.
- Four repeat modes.
- Time-based step sizes so speed is steady.
- Locus as an honest sampled curve.

### What is weak

- Animation state is accumulated, not computed from time: no seek, drift with frame drops, no replay.
- A timer separate from the view's animation (zoom tweens) and from the film.
- Trace is a bitmap that cannot be zoomed, exported or seeked.
- ODE results are static curves, not live states.
- Frame rate adapts downward and can look jerky; numerical results depend on frame rate.
- Physics needs workarounds.

## 3. The clock and the player

### 3.1 Clock

- `t` is **film time in seconds**, a float64. It is a special free value; only the player writes it (core 7.1).
- Also read-only built-ins:
  - `bt`: seconds since the start of the current beat (answers core open question 1: yes, add it). Outside a film with no beats, `bt = t`.
  - `beat`: the index of the current beat (integer), `0` outside a film.
- `t` has range `[0, duration]` where `duration` comes from `@clock a..b` (core directive; `a` is almost always 0). With no `@clock`, `duration = ∞` (open-ended play, as in the playground).

### 3.2 Player

```ts
type PlayMode = 'stopped' | 'playing' | 'paused';

interface PlayerState {
  readonly mode: PlayMode;
  readonly t: number;                    // film time (s)
  readonly rate: number;                 // speed multiplier; -4..-0.1 or 0.1..4; sign is direction
  readonly duration: number;             // seconds, Infinity if none
  readonly loop: null | { from: number; to: number };
  readonly source: ClockSourceKind;
}

type ClockSourceKind = 'wall' | 'external';

interface ClockSource {
  /** Seconds on a monotonic clock. 'external' sources are the audio clock when the teacher's voice is playing. */
  now(): number;
}

interface Player {
  readonly state: PlayerState;
  play(): void; pause(): void; toggle(): void;
  seek(t: number, why?: 'user' | 'beat' | 'script'): void;
  stepFrames(n: number): void;           // ±n frames of 1/60 s
  setRate(r: number): void;
  setLoop(l: PlayerState['loop']): void;
  readonly beats: readonly Beat[];       // from @beat directives
  subscribe(fn: (e: PlayerEvent) => void): () => void;
}

type PlayerEvent =
  | { kind: 'frame'; t: number }
  | { kind: 'mode'; mode: PlayMode }
  | { kind: 'seek'; t: number; why: 'user' | 'beat' | 'script' }
  | { kind: 'beat'; index: number; id: string }
  | { kind: 'end' };
```

### 3.3 Rules

1. **`t` never goes outside `[0, duration]`.** Reaching `duration` fires `end`, pauses (or wraps to `loop.from` if looping).
2. **Time source.** With the voice playing, the source is the audio clock, so the figure never drifts from speech. Otherwise it is `performance.now()`. Switching source never jumps `t`: the player stores `t` and the source's reading at the switch and measures from there.
3. **Frame delta.** `dt = clamp(source.now() - last, 0, 0.1) * rate`. A hidden tab or a long pause produces one capped step; it does not fast-forward. If the clamp fires, the player tells the voice code that the figure fell behind (`PlayerEvent` is enough; the voice code decides).
4. **Reverse play** (`rate < 0`) works because every `t`-dependent rule is a function of `t` and states can run backward from checkpoints (7.7).
5. **Seeking** (`seek(t)`) sets `t`, runs one update pass, and does not need the frames in between: every pure rule is a function of `t`, states use checkpoints (7.6), traces and tracks rebuild (9). Seek cost target: under 50 ms for a 60 s film with states (core), under 5 ms without.
6. **Beat jumps.** `seek_beat` in the film tools is `seek(beat.start, 'beat')`.
7. **Pausing does not stop interaction.** Dragging, tools and slider moves work when paused; the figure updates through the normal pass.
8. **Determinism.** The same script, the same input log (section 8) and the same `t` give the same figure, regardless of frame rate, seek history or machine (within float64 for the kernel; particles within the stated tolerance in 10.7).
9. **Single timer.** The player's frame callback is the only `requestAnimationFrame` loop in the app. View tweens (graphics-view 4.4), slider animation and particles all run inside it. When the player is stopped or paused and no tween is running, there is no loop (zero idle cost).

### 3.4 Frame step

`stepFrames(n)` moves `t` by `n / 60` seconds (not by `n` display frames, so it does not depend on the monitor), pausing first.

### 3.5 Time units

Seconds throughout. Display `m:ss.s` in the UI; formulas use seconds.

## 4. The frame loop

One function, run by `requestAnimationFrame` while something is changing:

```text
frame(now):
  if playing:
    advance t by the frame delta (3.3 rule 3), apply loop and end rules
  solver.advanceTo(t)                      # states, section 7; may use dense output
  sources = {t, bt, beat if changed} ∪ animated sliders (computed from t) ∪ states that moved
             ∪ free values the user dragged this frame ∪ view tweens
  kernel.update(sources)                   # one pass: merged downstream lists, once each
  view.update(changed objects)             # dirty drawables, layout
  particles.upload(uniforms)               # CPU values read for GPU programs
  view.paint()
  emit 'frame'
  if still playing or tween running or catching up: schedule next frame
```

Properties:

- **Fixed order** each frame: time, solver, kernel pass, view, paint. Labels never lag values.
- **Only what changed runs.** The kernel keeps the downstream list of `t` ready (core 2). If no object depends on `t`, states or animated sliders, playing costs nothing and the loop shows only the clock readout.
- **No adaptive frame rate for correctness.** Because values come from `t`, a slow frame just shows the figure at the right time. Quality (curve resolution, drawn particle count) adapts instead (graphics-view 7.3, section 10.6); the clock never slows.

## 5. Slider animation

### 5.1 What animates

A **free Number with a range** (a slider, core section 3: `a = 3 in 0..10 step 0.5`). Angles are Numbers with `unit = angle`. Points on paths animate by the same mechanism through their parameter `s` (graphics-view 12.4): `P = PointOn(c, 0)` with `animate` runs the point round the circle. Free Bool and free points do not animate.

### 5.2 Script form

```text
a = 0 in 0..10 step 0.1
a with animate = bounce, seconds = 8
P = PointOn(c, 0)
P with animate = loop, seconds = 5
a with animate = off
```

| Property | Values | Default |
|---|---|---|
| `animate` | `off`, `bounce`, `loop`, `loop-down`, `once`, `once-down` | `off` |
| `seconds` | Time for one pass from low end to high end of the range, 0.1 to 3,600 | 10 |
| `phase` | Fraction 0..1 of the range at which the track starts at `t = 0` | derived from the slider's initial value |
| `smooth` | `true` to ignore `step` while animating | `false` |
| `rerun` | `continue` or `restart` (section 8) | `continue` |

Mode meanings:

| Mode | Behaviour |
|---|---|
| `bounce` | Up to the high end, then down to the low end, forever |
| `loop` | Up, jump to the low end, repeat |
| `loop-down` | Down, jump to the high end, repeat |
| `once` | Up, stop at the high end |
| `once-down` | Down, stop at the low end |

The word `seconds` replaces the idea of a "speed" number: the author says what they mean. (A speed of 1 meant 10 seconds in GeoGebra; ours is just `seconds = 10`.)

### 5.3 The track is a function of time

An animated slider's value is **computed**, not accumulated:

```ts
interface Track {
  readonly lo: number; readonly hi: number; readonly step: number;     // from the slider
  readonly mode: AnimMode;
  readonly seconds: number;
  readonly phase0: number;       // fraction at t = t0
  readonly t0: number;           // when this segment of the track started
  readonly smooth: boolean;
}

/** value of the slider at film time t */
function trackValue(k: Track, t: number): number;
```

With `dir = +1` (or `-1` for the `-down` modes) and progress `u = phase0 + dir * (t - t0) / seconds`:

| Mode | Fraction `f` of the range |
|---|---|
| `loop`, `loop-down` | `fract(u)` |
| `bounce` | let `x = mod(u, 2)`; `f = x ≤ 1 ? x : 2 - x` |
| `once` | `clamp(u, 0, 1)` |
| `once-down` | `clamp(u, 0, 1)` with `u = phase0 - (t - t0)/seconds` |

`value = lo + f * (hi - lo)`. Unless `smooth`, the value is **quantised to `step`**: `value = lo + round((value - lo) / step) * step`, then rounded to the number of decimals of `step` so that `0.1 + 0.2` never shows as `0.30000000000000004`.

For `once`, when `u ≥ 1` the track reports `done` and the slider becomes plain (the object keeps the end value; `animate` shows `off` in the style bar).

Why a function: the value at any `t` is exact and repeatable, seeking is free, and a replayed film shows the same slider values.

### 5.4 Drag while animating

When the learner grabs an animated slider (or changes its value by keyboard or `show_me`):

1. The track pauses for that slider while the pointer is down.
2. On release, a new track segment starts: `t0 = t`, `phase0 =` fraction of the dragged value, same mode and seconds.
3. The change is appended to the input log (section 8) as `{ t, id, kind: 'track', phase0 }`, so replays and seeks reproduce it.

If the film's time moves back before the change, the track follows the log: the value before `t` of the change is the older segment. Only that slider is paused; the rest of the figure keeps running.

### 5.5 Several animated numbers

Each runs from its own track, all evaluated from the same `t` in one pass. The player's "animation" and "film" are the same clock; there is not a separate global animation button. `Play()` and `Pause()` (core 6.6) are the only commands.

### 5.6 Random sliders

A random slider is `a = rand(seed + floor(t / period))`-style: a pure function of `t` (`a = lerp(lo, hi, rand(floor(t * rate)))`) written by the author. No special slider type. (GeoGebra has a random-number slider that re-rolls on a timer.)

## 6. Time in formulas

- `t`, `bt`, `beat` can appear in any formula, including style values (graphics-view 9.1) and particles.
- New pure helpers (to add to the language area's builtins list; core 6.7 gets these):

| Function | Meaning |
|---|---|
| `fract(x)` | `x - floor(x)` |
| `wrap(x, a, b)` | `a + mod(x - a, b - a)` |
| `pingpong(x, len)` | triangle wave: `0` at `0`, `len` at `len`, back to `0` at `2 len`, repeating |
| `ramp(x, a, b)` | `clamp((x - a) / (b - a), 0, 1)`; `0` before `a`, `1` after `b` |
| `ease(x)` | `smooth(clamp(x, 0, 1))` |
| `at(obj, time)` | the value `obj` had at film time `time`; allowed only for objects that depend on `t` or states, not on user-dragged values. Cost note in 12. Not available on the GPU unless inlined (10.4). |

- A formula that depends on `t` is pure and can be seeked (core 7.1).
- `bt` is set from the beat table (`@beat` directives) with a binary search on `t` each frame: O(log beats).
- Formulas **must not** call the wall clock; there is none.

## 7. States and rates

### 7.1 Language

```text
g = 9.8
L = 1 in 0.5..2
θ = state(0.6)
ω = state(0)
θ' = ω
ω' = -g / L * sin(θ)
bob = (L * sin(θ), -L * cos(θ))
```

Second order sugar:

```text
θ = state(0.6, 0)           # value and first derivative
θ'' = -g / L * sin(θ)       # ≡ ω = state(0); θ' = ω; ω' = ...
```

Vector (Point) states:

```text
p = state((3, 0))
p' = (vx, vy)               # in a rate rule a pair is a Vector
```

Rules (extending core 7.2):

- `state(x0)` creates a state whose type is the type of `x0`: `Number` or `Point`.
- `state(x0, v0)` creates a second-order state; the rate rule is `name'' = expr`.
- `x' = expr` has type `Number` for a Number state and Vector for a Point state. A pair literal in this position is read as a Vector (an exception to "a pair is a Point"; core change A2).
- `x0` and `v0` are expressions evaluated at `t = 0` (and again on restart): `state(L0)` is allowed. They may read sliders and other numbers.
- Every state needs exactly one rate rule, in any order after the state. A missing one is `missing_rate` at the first frame (core), reported by name. It is not raised when the state line is applied, because the rule usually follows on the next line.
- A rate rule is not an object; it attaches to the state. Redefinition keeps working: `ω' = -g / L * sin(θ) - 0.1 * ω` replaces the rule.
- A state **is** a Number or Point object in the figure: it can be drawn, read by formulas, labelled. It cannot be dragged (plan kind `none` with reason `owned_by_solver`) and cannot be set by `show_me`.

### 7.2 What the solver sees

At compile time the kernel builds, for the whole set of states `Y` (a vector of float64), a **rate program**: a flat list of numeric operations that, given `Y` and `t` (and the current values of every free object it reads), computes `Y'`. It is built from the **rate cone**: the objects on a path from any state (as an input) to any rate expression, in kernel order. Objects outside the cone are never evaluated during integration.

```ts
interface RateProgram {
  readonly dim: number;                     // length of Y (Number states count 1, Point states 2)
  readonly layout: readonly { id: ObjectId; offset: number; kind: 'number' | 'point' }[];
  readonly reads: readonly ObjectId[];      // free objects and sliders the cone reads (inputs)
  eval(y: Float64Array, t: number, inputs: Float64Array, out: Float64Array): void;
}
```

- `inputs` is the current free values read by the cone, indexed by `reads`.
- Commands inside the cone (a `Distance(A, B)` between two state points) are allowed if their rule has a numeric kernel (an `evalInto` form); otherwise the cone is rejected with `rate_not_numeric` and a hint.
- Rules in the cone are evaluated in kernel order; state objects act as leaves reading from `y`.
- The cone is rebuilt only when lines add, redefine or delete objects in it (same cache rule as the downstream lists).

### 7.3 Integrator

**Fixed-step fourth-order Runge-Kutta** with step `h = 1/240` s. A fixed step makes results independent of frame rate and seek path. Per step:

```text
k1 = F(y, t)
k2 = F(y + h/2 k1, t + h/2)
k3 = F(y + h/2 k2, t + h/2)
k4 = F(y + h k3, t + h)
y_next = y + h/6 (k1 + 2 k2 + 2 k3 + k4)
```

(Standard textbook RK4.) Step index `n` with `t_n = n h`; the grid is exact in integers, avoiding drift from adding floats.

**Dense output.** Between grid points the figure shows a **cubic Hermite** interpolation of `y` using `y_n, y_{n+1}, F(y_n), F(y_{n+1})` (the next step's `k1` is the second slope), so display at any `t` is smooth and does not depend on the display frame rate. Interpolation error is O(h^4) of the same order as the step.

**Solver step directive.** `@solver step 1/480` changes `h` (allowed: `1/n` with integer `n` from 60 to 4800). Smaller `h` for stiff springs and fast orbits. Changing it clears checkpoints.

**Accuracy targets** (test goals, not guarantees; checked in CI):

| Test | Target |
|---|---|
| Harmonic oscillator `x'' = -x`, 100 periods, `h = 1/240` | amplitude error under 1e-9 |
| Planar Kepler orbit, `e = 0.5`, 100 periods | position error under 1e-4, energy drift under 1e-7 relative |
| Pendulum, amplitude 0.6 rad, 1,000 s | period within 1e-9 relative of the series value |
| Damped oscillator vs closed form | error under 1e-10 |
| Double pendulum (chaotic) | same results on any machine (determinism test), not accuracy |

**Stability bound.** RK4 is stable for `|λ| h < 2.78`; with `h = 1/240` the fastest oscillation ω must be below about 660 rad/s. Beyond that the solver blows up. The solver watches for it (7.8).

**Cost.** One step costs four rate-program evaluations. Estimate for plain JS: a 100-operation program takes about 2 µs per evaluation, so about 8 µs per step. A 16.7 ms frame at 1× needs 4 steps (16 at 4×). Even a 2,000-operation cone costs well under 1 ms per frame at 1×.

### 7.4 Which `t` do states see?

Inside the cone `t` is the stage time `t_n + c h` (RK4 stage), so rates written as functions of `t` (driven oscillators: `ω' = ... + F cos(w t)`) are integrated correctly.

### 7.5 Initial values and restart

State values at `t = 0` are the evaluated `x0` (and `v0`). If `@clock` starts at a time `a > 0`, the states start at `a` with their initial values (the clock a = 0 is by far the normal case). `Restart()` (action) sets the states back to initial values **at the current `t`** and appends a reset to the input log (8.2).

### 7.6 Checkpoints and seeking

```ts
interface Checkpoint {
  readonly n: number;                      // step index
  readonly y: Float64Array;                // state vector at t_n
  readonly logIndex: number;               // how many input-log entries were applied
}
```

- **Every 0.5 s of film time** (every 120 steps) the solver stores a checkpoint, for the longest `t` it has computed (the "frontier"). A 60 s film with 8 state numbers holds 120 checkpoints of 64 bytes each: negligible.
- **Seek to `t`:**
  1. Find the latest checkpoint with `n ≤ floor(t * 240)`.
  2. If none (before the frontier's first checkpoint and no checkpoint at 0), start from the initial state.
  3. Integrate forward step by step, applying the input log (8.2), until `n_target`; at most 120 steps (plus the step needed for the Hermite end slope).
  4. Interpolate for the fractional part.
- Seeking beyond the frontier integrates forward from the frontier, storing checkpoints as it goes. A seek to 55 s from 0 integrates 13,200 steps once: at 8 µs per step that is about 100 ms. Slow only the first time; subsequent seeks hit checkpoints. To keep the first seek under 50 ms for typical films, the solver pre-computes checkpoints in idle slices (`requestIdleCallback` or a worker) up to the film's duration once the figure is loaded and states exist, at most 5 ms per slice. Worker use is optional, since the rate program is pure arithmetic and transferable.
- **Reverse play** needs the dense steps backward: the solver keeps a ring cache of the 120 dense steps of the current checkpoint interval (about 120 × dim × 8 bytes), so each reverse frame is a lookup.
- **Looping** uses `from` and `to`; if the loop wraps to a time with no state continuity, states are re-seeked (jump) — the figure shows a jump unless the author designed it periodic. Documented behaviour, no magic.

### 7.7 Cache rules

- Checkpoints are keyed by `(rate program version, solver step, inputs version)`.
- Any line that changes the cone invalidates all checkpoints.
- Input log changes (section 8) invalidate checkpoints after the earliest affected time.

### 7.8 Stability and failure

After each step, if any component of `y` is NaN, infinite, or `|y| > 1e9`:

- All states in the affected **connected group** (states whose rates read each other) become `undefined` with reason `not_finite` from that time on.
- The solver stops stepping that group and keeps stepping others.
- A warning goes to the teacher and to the learner console: `unstable_state` with the group, the time, and a hint: lower the stiffness, add damping, or `@solver step 1/960`.
- Downstream objects become undefined (core undefined rules). The figure keeps running.
- A seek to a time before the failure shows valid values.

An optional diagnostic `Stiffness(s)` is not needed in v1.

### 7.9 Bodies and events (designed now, built later)

- The state vector layout reserves slots for **events**: a rule `when` described as data `{ guard: Expr<Number>, direction: 'down' | 'up' | 'either', action: assignments }`. After each step the solver checks the guard for a sign change; on a change it finds the event time within the step by bisection on the dense output to `1e-9` s, applies the action (such as `v = -e * v`), and finishes the step to the next grid time with a shorter sub-step. Checkpoints are only taken on the grid, so seeking stays exact.
- Commands that will use it (v1.5): `Bounce(y, v, floor, e)` (a ball: when `y` crosses `floor` downward, set `v` to `-e v`). A `Wall`, `Spring`, `Joint` and rigid `Body` come with the physics kit (core 7.4).
- Bodies in the kit are states owned by the solver; the same checkpoint scheme applies.

## 8. Changing inputs while playing

### 8.1 The problem

A pendulum's length `L` is a slider. The learner (or `show_me`) changes `L` at `t = 12`. What does the figure show at `t = 20`, and what at `t = 5` after seeking back? Core open question 5 asked whether to restart at `t = 0`.

### 8.2 Input log

Every change of a **solver input** (a free object in a rate cone's `reads`, or an animated slider's track) while the player is playing or paused is appended to a log:

```ts
type LogEntry =
  | { kind: 'set'; t: number; id: ObjectId; value: number | [number, number] }
  | { kind: 'track'; t: number; id: ObjectId; phase0: number }
  | { kind: 'reset'; t: number };            // Restart()

interface InputLog { readonly entries: readonly LogEntry[] }
```

- The log is part of the film state, stored with the film (so a recorded lesson replays the same).
- The solver applies an entry at the first grid step `n ≥ ceil(t * 240)`, so outcomes are deterministic.
- Evaluating `L` at any time is a pure function of the log: the latest `set` with `t_entry ≤ t`, else the figure's base value.

### 8.3 Two policies (per input)

`L with rerun = continue` (default): the change takes effect **from now on**. At `t = 12` the pendulum swings on from its current angle with the new length. Seeking back to `t = 5` shows the old length; seeking to 20 replays and shows the new length from 12 on. Checkpoints after 12 are dropped and rebuilt.

`L with rerun = restart`: the change rewrites history: the base value changes, all log entries for `L` are dropped, all checkpoints are dropped, and the figure replays from `t = 0` with the new `L`. "What if `L` were 2?" then shows the whole motion again.

The teacher chooses by what it wants to say ("from here on" vs "the whole thing"). The default is `continue` because a learner dragging a slider mid-swing expects the pendulum to keep swinging.

### 8.4 History rewrite

A new entry for object `X` at time `t_e` removes later entries for `X` (the future of that input is rewritten); entries for other objects stay. Checkpoints after `t_e` are dropped. This is the one place the future changes.

### 8.5 Catch-up budget

After checkpoints are dropped, the figure needs the states at the current `t` right away. The solver replays from the latest valid checkpoint in time slices of at most 6 ms per frame. While replaying, the last valid frame is shown and the player bar shows a small "catching up" indicator. In practice replays from `restart` take under 20 ms for 60 s of film and a 100-op cone.

### 8.6 Other free values

Objects the solver does not read (a draggable point that only moves a drawing) are not logged: the film's own beat lines hold their values. Dragging them while playing changes the figure from that moment, seeking back does not undo the drag (there is no time axis for them). The film layer (outside this area) owns that.

## 9. Traces and paths

### 9.1 Script

```text
Trace(P)                    # trace on, whole history
Trace(P, 5)                 # last 5 seconds only
P with trace = true, traceWindow = 5, traceFade = true
Untrace(P)                  # off, history cleared
ClearTrace(P)               # keep tracing, clear history
Path(P, 0, 10)              # an object: the curve P draws for t in 0..10
```

`ClearTrace` is new (change A5). `Trace` returns no object; the trace belongs to the view and is shown with the traced object.

### 9.2 What can be traced

| Object | Trace shows |
|---|---|
| Point | Its positions as a polyline |
| Segment, Line, Ray, Vector, Circle, Polygon | Faded copies at intervals (an envelope) |
| Text | Not supported (`not_traceable`) |

### 9.3 Sources

The trace source is decided by the object's ancestors:

- **time** if P depends on `t`, `bt`, a state or an animated slider (directly or through objects). The trace is a pure function of `t`.
- **drag** otherwise (it depends only on user-moved free objects). The trace records the positions during drags.

### 9.4 Time traces

A **sampler** evaluates P at `t_k = k * dt` with `dt = 1/60` s. To do this without disturbing the live figure, it uses a **path program**: the flat program for the ancestors of P that depend on `t` or states (a smaller cone than the full figure), run on scratch memory. States are read from the solver's dense output at `t_k`.

- **Playing:** each frame appends the samples for `[last, t]` (usually 1 sample, never more than 6 per frame).
- **Seeking:** the trace is rebuilt for `[max(0, t - W), t]` (window `W`, or the whole `[0, t]` if no window). At 60 Hz × 10 s that is 600 evaluations.
- **Window and cap:** at most 5,000 points. With no window, once the count would pass 5,000 the trace is decimated by 2 (every second point kept) and the sampling interval doubles, so very long histories coarsen but keep their whole shape. With a window, the oldest samples fall off.
- **Undefined** samples insert a gap (a NaN), so a trace of an intersection that disappears breaks.
- **Jumps**: consecutive samples farther apart than 25% of the view diagonal are not joined (the drawable breaks the line), unless the author says `traceJoin = true`.

### 9.5 Drag traces

While a drag is active, each coalesced pointer position is evaluated and appended (cap 5,000 points, decimation as above). Not replayed by seeking. Cleared by `ClearTrace`, `Untrace`, undo of the traced object, or any redefinition of the traced object (its meaning changed).

### 9.6 Shape traces

Every `1/30` s of film time (or every pointer step, for drag), a snapshot of the object's **value** (not geometry) is appended: up to 300 snapshots (decimated like points). Drawing re-derives each snapshot's geometry for the current view, so it is correct at any zoom. Lines and rays are clipped to the view. Fade by age.

### 9.7 Drawing

- A trace is drawn by the owner object's drawable, in the same layer, **below** the object.
- Colour is the object's colour; width is half the object's. With `traceFade`, alpha falls from 1 at the head to 0.05 at the tail, drawn in 8 alpha buckets (8 draw calls) to keep cost low.
- Trace geometry is stored in **maths coordinates**, mapped on each paint, so zoom and pan do not erase it (unlike a bitmap).
- It is included in export at the export's `time`.

### 9.8 Paths

`Path(P, t0, t1)` is a pure object of type `Curve` (core 7.5). Algorithm:

1. Choose a start of 64 uniform samples of the parameter `t` over `[t0, t1]` (using the path program).
2. Refine any interval where: the turning angle at a sample exceeds 8°, or the screen length of the chord exceeds 4% of the view diagonal, up to recursion depth 8 (at most 4,096 samples).
3. Break at undefined samples, and at jumps beyond 25% of the view diagonal where the sample before and after disagree on side (same rule as the function plotter in the core design).
4. Cache by `(path version, view size class)`; recompute when the program or the interval changes. It does not depend on the zoom except for the screen-length rule, so it is recomputed only when the zoom changes by more than 2×.

`Path` over states: the path program reads the solver's dense output; if `t1` is beyond the frontier it integrates forward (and stores checkpoints), which can take time. The object shows `pending` for slices of 6 ms until it is ready (a hatched placeholder polyline), then replaces it.

`Locus(P, a, from, to)` (core 7.5, owned by the curves-loci area) uses the same sampler over a free number `a` instead of `t`; it shares `PathSampler`.

## 10. Particles

### 10.1 Script

```text
fire = Particles(count = 1500, life = 1.2,
  pos = (0.4 (u - 0.5) + 0.15 noise(i, 3 age), 2.2 age - 0.6 age^2),
  color = Gradient(ph, rgb(255, 230, 120), rgb(255, 120, 30), rgb(90, 90, 90)),
  size = 0.08 (1 - ph),
  alpha = 1 - ph,
  blend = add)
```

A line is one logical line (core: a line ends at a newline; a call may continue across lines inside its brackets: change A6, small).

### 10.2 Parameters

| Param | Type | Meaning | Default |
|---|---|---|---|
| `count` | integer 1..20,000 | Particles alive in a steady emitter | required |
| `life` | Number > 0 | Seconds each particle lives | required |
| `pos` | Point expression | Position (maths units) | required |
| `color` | Color expression | Colour | `black` |
| `size` | Number expression | Radius in maths units (so it scales with zoom) or `px(…)` for pixels | `0.05` |
| `alpha` | Number expression 0..1 | Opacity | `1` |
| `angle` | Number expression (radians) | Rotation for streaks and squares | `0` |
| `shape` | `dot`, `ring`, `square`, `streak`, `spark` | Sprite | `dot` |
| `blend` | `normal`, `add` | Compositing | `normal` |
| `start`, `end` | Numbers (film time) | Emission window; before `start` and after `end` + `life`: nothing | `0`, `∞` |
| `loop` | Bool | `true`: continuous emitter. `false`: one burst: each particle lives once | `true` |
| `seed` | integer | Different seeds, different randomness | `0` |
| `layer` | 0..9 | As other objects | `0` |
| `renderer` | `auto`, `cpu`, `gpu` | Where to evaluate and draw | `auto` |

Named arguments are allowed in any order (core grammar `arg`). `count`, `life`, `pos` are required. An omitted optional uses the default.

### 10.3 Names in the formulas

| Name | Meaning |
|---|---|
| `i` | Index, 0 to `count - 1` |
| `n` | `count` |
| `u`, `v`, `w` | Three random numbers in [0, 1), fixed for this particle's current life: pure functions of `(i, cycle, seed)` |
| `cycle` | Integer: which life of the particle this is (0, 1, 2, ...) |
| `age` | Seconds since this life began |
| `life` | The `life` parameter |
| `ph` | `age / life`, 0 to 1 |
| `t`, `bt` | Film time and beat time |

Also visible: any number, point or colour in the figure by name, and the lowercase built-ins. Particle formulas may not call commands (only built-ins, arithmetic, `if`, `noise`, `rand`, `Gradient`, `at` on CPU).

### 10.4 Per-particle model

A particle is a **pure function** of `(i, t)`:

```text
phase_i    = life * rand(hash(i, seed))                    # a fixed offset for particle i
loop = true:
  s        = t - start + phase_i                           # time since a notional first emission
  cycle    = floor(s / life)
  age      = s - cycle * life                              # = mod(s, life)
loop = false:
  born     = start + life * rand2(i, seed)                 # a spread of birth times over one life
  age      = t - born ; alive iff 0 ≤ age < life ; cycle = 0
alive also requires: emission time (t - age) within [start, end]
u, v, w    = rand(hash(i, cycle, seed, 1)), rand(hash(i, cycle, seed, 2)), rand(hash(i, cycle, seed, 3))
```

`rand` here is the engine's integer-hash-based generator (a 32-bit integer mixing function with good avalanche, identical on CPU and GPU, defined once in the kernel's math module with test vectors). `noise(x, y)` uses the same hash for lattice values.

No state is stored per particle. Seeking, reverse play and export work for free.

**Emitter that moves.** If `pos` reads an object `E` that moves with `t`, the whole system would move rigidly with `E`, losing the trail. To spawn from where the emitter *was*, write `at(E, t - age)`. The compiler tries to **substitute time** symbolically: if `E`'s definition is a pure formula of `t` (no states, no commands, no user input), `E` evaluated at `t - age` is the same formula with `t` replaced, which the GPU can run. Otherwise `at` makes the system CPU-only (`gpu_unsupported: at`).

### 10.5 Two evaluators

```ts
interface ParticleProgram {
  readonly spec: ParticlesSpec;
  readonly gpuOk: boolean;
  readonly gpuReason?: string;                       // why not
  evalCpu(t: number, bt: number, out: ParticleBatch): void;   // fills typed arrays
  gpuSource(): { vertex: string; fragment: string; uniforms: readonly UniformSlot[] };
}

interface ParticleBatch {
  readonly count: number;
  readonly x: Float32Array; readonly y: Float32Array;     // maths coordinates
  readonly size: Float32Array; readonly alpha: Float32Array;
  readonly rgba: Uint32Array;                             // packed colour
  readonly angle: Float32Array;
}
```

**CPU.** A closure compiled once from the formula tree. Per frame: loop over `count` particles, compute `(age, u, v, w, ...)`, call the closures, write typed arrays; draw in colour buckets (16 quantised colours × 4 size classes), one path per bucket, so a 3,000-particle system is about 60 draw calls. Target: 3,000 particles at 60 fps with 40 operations each (under 1.5 ms evaluation + 3 ms draw).

**GPU (WebGL2).** One instanced draw call. The vertex shader derives `i` from the instance id and computes everything: the formula tree is compiled to GLSL ES 3.00, with uints for the hash. The fragment shader draws the sprite shape. External values (sliders, points, colours the formulas read) go into a uniform array filled each frame from the kernel's values (up to 64 slots; more makes it CPU-only: `gpu_unsupported: too_many_inputs`). Target: 20,000 particles at 60 fps on integrated graphics.

**GPU subset.** Numbers, points (as `vec2`), colours (as `vec4`), operators `+ - * / ^`, comparisons, `if`, and the built-ins `sin cos tan asin acos atan atan2 sinh cosh tanh sqrt cbrt exp ln log10 log2 abs sign floor ceil round min max hypot clamp mod lerp step smooth fract wrap pingpong ramp ease rand noise rgb hsl Gradient`. Lists, functions of `x`, commands and non-inlinable `at` make a system CPU-only. The reason is reported in `figure`.

**Mixed:** `renderer = auto` chooses GPU when `gpuOk` and WebGL2 exists and `count > 1,500`; otherwise CPU.

### 10.6 Limits and load shedding

| Limit | Default |
|---|---|
| Particles per system | 20,000 |
| Particles per figure | 50,000 (answers core open question 4: per system and per figure, with device adaptation below) |
| Uniform slots | 64 |
| Formula size | 400 nodes per expression |
| GPU on a weak device | detected by a one-frame benchmark at load; sets a `quality` multiplier 0.25 to 1 |

**Load shedding.** If the frame's total time exceeds 14 ms for 5 frames, the renderer draws only the first `ceil(count × q)` indices with `q` reduced by 25% steps (minimum 25%), scaling `alpha` and `size` by `1 / sqrt(q)` to keep the same look. It recovers upward after 60 good frames. Particles are independent, so dropping some does not change the others. The clock and the kernel never slow down.

### 10.7 Determinism

- CPU path: float64, identical on all machines (the hash uses only integer ops).
- GPU path: float32. Positions agree with the CPU path to within 1e-4 relative or 0.05 px, whichever is larger (tested by rendering both and comparing on fixtures). Not bit-identical.
- Export and film rendering default to the CPU path (`renderer` is ignored for export) so frames are reproducible.

### 10.8 Drawing, interaction, access

- Particles are not selectable and have no hit test. Their drawable reports no bounding box (never culled).
- Layer and rank: draw order uses the object's layer, rank 5 (graphics-view 8).
- `describe()` returns `Particle system fire, 1,500 particles` plus the author's `alt`.
- `Hide(fire)` stops evaluation and drawing.
- Particles obey reduced motion: shown as a still frame at the current `t` until play is pressed.

## 11. Building physics: recipes

How GeoGebra does each (a time slider and formulas, or sequence lists, or an ODE command returning a curve) and how we do it. All run on `t`, states and the tools above.

### 11.1 Projectile (closed form)

```text
g = 9.8
v0 = 12 in 1..20
α = 0.9 in 0.1..1.5
ball = (v0 cos(α) t, v0 sin(α) t - 0.5 g t^2)
Trace(ball)
```

Pure function of `t`; seeks free. GeoGebra: same idea, with a time slider.

### 11.2 Pendulum (state)

```text
g = 9.8
L = 1 in 0.5..2
θ = state(0.6, 0)
θ'' = -g / L * sin(θ)
pivot = (0, 0)
bob = (L sin(θ), -L cos(θ))
rod = Segment(pivot, bob)
```

GeoGebra: an ODE command solved for a curve, then a slider to pick a point on it; changing `L` re-solves but the "time" is a separate slider. Ours: live state, `rerun` policy, seekable, any rate formula (including damping and driving).

### 11.3 Damped spring and driven oscillator

```text
k = 20 in 1..80
c = 0.4 in 0..3
m = 1
x = state(1, 0)
x'' = (-k * x - c * x') / m + 2 cos(3 t)
```

Here `x'` may appear on the right side of a second-order rate as the first derivative of the state (the compiler reads it as the velocity component). Change A3.

### 11.4 Orbit (vector state)

```text
GM = 4
r = state((1, 0))
v = state((0, 1.3))
r' = v
v' = -GM * r / hypot(r.x, r.y)^3
planet = r
```

With `h = 1/240`, a 100-period run keeps the orbit closed within the accuracy table. GeoGebra: iterate a list of Euler steps, with visible drift.

### 11.5 Waves

```text
k = 3 in 1..8
ω = 2 in 0.5..6
f(x) = sin(k x - ω t)
```

A function that reads `t` re-plots every frame (the plotter caches by `(version, viewport)`; `t` changes the version each frame). Cost: 600 samples × the expression, about 50 µs. Standing waves, interference: sums of such functions.

### 11.6 Bounce (v1.5)

```text
y = state(3, 0)
y'' = -9.8
Bounce(y, y', 0, 0.8)
```

Energy loss 20% per bounce, exact event time by bisection. GeoGebra: hand-written reflection with `if` and piecewise time formulas.

### 11.7 Simple particles for a lesson on projectile spread

```text
spray = Particles(count = 400, life = 1.5, loop = true,
  pos = (v0 cos(α + 0.2 (u - 0.5)) age, v0 sin(α + 0.2 (u - 0.5)) age - 0.5 g age^2),
  size = 0.04, alpha = 1 - ph)
```

### 11.8 Not supported (v1)

Collisions between bodies, contacts, friction on surfaces, joints, rigid rotation: from the physics kit later (core 7.4). A body in that kit is a state group on the same solver with event rules.

## 12. Performance and budgets

| Item | Budget |
|---|---|
| Player frame overhead (clock, loop, events) | under 0.1 ms |
| Solver per frame at 1× (4 steps), cone of 200 ops | under 0.2 ms |
| Kernel pass, 500 objects | under 4 ms (core) |
| Track evaluation per animated slider | under 1 µs |
| Time trace sample | under 20 µs for a 100-op path program |
| `Path` build (4,096 points) | under 10 ms, cached |
| CPU particles, 3,000 | 4.5 ms total (1.5 eval + 3 draw) |
| GPU particles, 20,000 | 2 ms GPU, under 0.3 ms CPU (uniforms) |
| `at(E, ·)` per call (path program, 50 ops) | 5 µs |
| Seek in a 60 s film with states, warm | under 5 ms; cold under 50 ms (after pre-computing checkpoints) |
| Memory | checkpoints 120 × 64 B; traces 5,000 × 16 B each; particle batch 20,000 × 28 B |

## 13. Better than GeoGebra

- **Time is a function, not an accumulator.** Seeking, reverse play, loops and replay are exact. Sliders, paths and particles all follow the same clock.
- **One timer** shared by the film, the view tweens and slider animation.
- **Frame-rate independence**: values depend on `t`, not on how many frames ran. Adaptive rate is replaced by adaptive quality.
- **Live states**: real integration with checkpoints, so physics responds to sliders in real time and rewinds.
- **Traces as data**, vector, zoomable, exportable, seekable.
- **Events and what-if semantics** (`continue` vs `restart`) are explicit and logged.
- **Particles** as pure functions evaluated on the GPU with the same formulas.
- **Explicit animation words** (`seconds`, `bounce`) instead of an abstract speed number.
- **Deterministic physics** across machines (CPU path), with a documented GPU tolerance.

## 14. Changes to the core design

| # | Change | Why |
|---|---|---|
| A1 | Add `bt` and `beat` read-only built-ins, set by the player; answers open question 1. | Formulas that want "time since this beat started". |
| A2 | In a rate rule `name' = expr`, a pair literal is a Vector. Add `state(x0, v0)` and `name'' = expr`. | Point states and second-order sugar. |
| A3 | Allow `x'` (the first derivative of a second-order state) on the right side of its own `x''` rule. | Damping terms. |
| A4 | Open question 5 answered: input log with `rerun = continue` (default) or `restart` (per input). The input log is stored with the film. | Deterministic what-if. |
| A5 | New action `ClearTrace(P)`; `Trace(P, seconds)` form; trace properties `trace`, `traceWindow`, `traceFade`, `traceJoin`. | Core 6.6 has `Trace`/`Untrace` only. |
| A6 | A call may continue on following lines while its brackets are open, up to 12 lines. | `Particles(...)` is naturally multi-line. Core says "a line ends at a newline"; the rule becomes "a line ends at a newline when no bracket is open". |
| A7 | Add builtins `fract wrap pingpong ramp ease` and `at(obj, time)`. | Section 6. |
| A8 | Slider animation properties `animate`, `seconds`, `phase`, `smooth`, `rerun`. | Section 5. |
| A9 | `@solver step 1/n` directive. | Stiff systems. |
| A10 | Open question 4 answered: 20,000 per system, 50,000 per figure, with device-adaptive load shedding. | Section 10.6. |
| A11 | Particle parameter names and the extra formula names `n w cycle ph life`. | Section 10.3. |
| A12 | Undefined reasons `owned_by_solver`, `unstable`; warning code `unstable_state`; errors in errors.md. | Section 7. |

## 15. Sources studied

GeoGebra source (read-only, commit 3608374), under `source/shared/common/src/main/java/org/geogebra/common/`:

- `kernel/AnimationManager.java` (the timer, step, frame rate adaptation)
- `kernel/geos/GeoNumeric.java` (animation step for sliders, repeat modes, increments, random sliders)
- `kernel/Kernel.java` (where the manager is held)
- `kernel/algos/` (locus, iteration, ODE-related algorithm names)
- `euclidian/EuclidianView.java` (trace flag and background bitmap drawing)
- `euclidian/Drawable.java` (trace support in drawables)
- `euclidian/PathTracker.java`

Manual pages (https://geogebra.github.io/docs/manual/en/):

- `Animation/`
- `Graphics_View/`
- `commands/SolveODE/`
- `Tools/`
