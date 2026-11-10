# Animation and time: errors

Follows core section 9. Line errors are returned as data. Failures that happen **while playing** (a solver that blows up, a particle program that cannot go to the GPU) cannot be line errors, because no line is being applied; they are **runtime reports**: a structured warning delivered to the teacher's next `draw` or `figure` result and shown in the player bar, never a dialog. Undefined values carry reasons (core section 2).

## 1. How GeoGebra handles these

- Animation has few failure modes: the slider simply does not animate if its range is not finite or minimum and maximum are not active; a locked or fixed slider may refuse the dialog change.
- A bad speed or increment is blocked by the dialog or corrected silently (for example, a step bigger than the range).
- The ODE command, when it cannot solve, returns an undefined object; a numerical solver gives wrong output with no warning if the step is too coarse.
- Trace and locus failures: the object is undefined, or the sample is dropped.
- Frame overload is handled by dropping the frame rate, which changes numerical results without telling anyone.
- Script errors in the failing run are reported by line number, otherwise by a generic message.

We keep "undefined, not a crash". We add reasons, positions and runtime reports.

## 2. Line errors

| Kind | When | Extra fields | Hint |
|---|---|---|---|
| `missing_rate` (core) | A state has no `name' =` rule at the first frame | `state`, `declaredAt` (line) | "Add `θ' = …` after the `state` line." |
| `duplicate_rate` **new** | Two rules for one state | `state`, `lines` | "Keep one; the second line replaces nothing." |
| `rate_without_state` **new** | `x' = …` for a name that is not a state | `name`, `closest` (states) | "Declare it first: `x = state(0)`." |
| `state_order` **new** | `x'' = …` on a state declared with one argument, or `x' = …` on a second-order state | `state`, `order` | "Use `state(x0, v0)` for `x''`." |
| `rate_type_mismatch` **new** | Rate type does not match the state (Number state with a Point rate) | `state`, `expected`, `got` | "A Point state needs a rate like `(vx, vy)`." |
| `rate_not_numeric` **new** | The rate cone contains an object the solver cannot evaluate numerically (a command without a numeric form, a Text) | `object`, `command` | "Replace `Intersect(...)` by formulas, or compute it outside the rates." |
| `rate_reads_draggable` **new** | The cone reads a free point the learner can drag, without a `rerun` policy | `object` | "Fine to proceed; its changes are logged. Set `rerun = restart` if you want history rewritten." (A warning, not an error, unless strict.) |
| `cycle` (core) | An algebraic loop in the cone (an object that depends on a rate that depends on it, not through a state) | `chain` | "Break the loop with a `state`." |
| `bad_animate` **new** | `animate` on something that cannot animate (a Bool, a dependent number, a point with no path) | `object`, `type`, `canAnimate` | "Only free numbers with a range and points on paths can animate." |
| `bad_animate_mode` **new** | Unknown mode | `got`, `known` | "Use `bounce`, `loop`, `loop-down`, `once`, `once-down`." |
| `bad_seconds` **new** | `seconds` not a number in 0.1..3,600 | `got`, `range` | |
| `bad_phase` **new** | `phase` outside 0..1 | `got` | |
| `bad_range` **new** | Slider range empty or infinite when `animate` is set | `lo`, `hi` | "Give both ends: `a = 1 in 0..10`." |
| `bad_clock` **new** | `@clock` malformed: `a >= b`, negative, NaN | `reason`: `empty_range`, `negative`, `not_finite` | "`@clock 0..30`" |
| `bad_solver_step` **new** | `@solver step` outside `1/60 .. 1/4800` or not `1/n` | `got`, `range` | |
| `bad_trace_option` **new** | Unknown trace property, bad window | | |
| `not_traceable` **new** | `Trace` on Text, Number or Bool | `object`, `type`, `traceable` | "Trace a point, segment, line, circle or polygon." |
| `unknown_particle_param` **new** | `Particles(colour = …)` | `param`, `closest`, `known` | |
| `missing_particle_param` **new** | No `count`, `life` or `pos` | `missing` | |
| `bad_particle_value` **new** | `count` > 20,000, `life` ≤ 0, `alpha` not Number | `param`, `got`, `expected` | |
| `particle_name_outside` **new** | `u`, `v`, `w`, `age`, `ph`, `cycle` used outside a `Particles` call | `name` | "These names exist only inside `Particles(...)`." Replaces `unknown_name` when the name is one of these, since it is more helpful. |
| `particle_command` **new** | A command (not a built-in) inside a particle formula | `command` | "Use built-in functions only inside `Particles`." |
| `path_range` **new** | `Path(P, t0, t1)` with `t0 >= t1` | | |
| `path_not_time` **new** | `Path` of a point that does not depend on `t` or states | `object` | "This point doesn't move with time. Use `Locus`." |
| `limit` (core) | Total particles over 50,000, more than 100 states, more than 20 traces, `Path` samples over 4,096 | `limit`, `value`, `max` | |
| `restart_in_film` **new** | `Restart()` used inside a beat of a locked film | | Only when a film is read-only |

### Examples

A rate without its state:

```json
{
  "ok": false,
  "line": 7,
  "col": 1,
  "endCol": 3,
  "kind": "rate_without_state",
  "token": "ω'",
  "message": "ω' has no state to attach to: ω is not declared as a state.",
  "name": "ω",
  "closest": ["θ"],
  "hint": "Declare it first: ω = state(0)."
}
```

A bad slider animation:

```json
{
  "ok": false,
  "line": 3,
  "col": 18,
  "endCol": 25,
  "kind": "bad_animate",
  "token": "bounce",
  "message": "L depends on other objects, so it cannot animate.",
  "object": "L",
  "type": "Number",
  "canAnimate": ["free Number with a range", "Point on a path"],
  "hint": "Animate the free number it comes from, or write L as a formula of t."
}
```

Particle name used outside:

```json
{
  "ok": false,
  "line": 5,
  "col": 6,
  "endCol": 7,
  "kind": "particle_name_outside",
  "token": "u",
  "message": "`u` is a particle's random number and exists only inside Particles(...).",
  "name": "u",
  "hint": "Move this expression inside the Particles call, or use rand(seed)."
}
```

Missing required parameter:

```json
{
  "ok": false,
  "line": 1,
  "col": 8,
  "endCol": 41,
  "kind": "missing_particle_param",
  "token": "Particles(count = 100, life = 1)",
  "message": "Particles needs `pos`.",
  "missing": ["pos"],
  "forms": [
    "Particles(count: Number, life: Number, pos: Point, color?: Color, size?: Number, alpha?: Number, angle?: Number, shape?: Name, blend?: Name, start?: Number, end?: Number, loop?: Bool, seed?: Number, layer?: Number, renderer?: Name) -> Particles"
  ],
  "hint": "Add pos = (x, y) where x and y may use i, u, v, age and t."
}
```

## 3. Runtime reports (not line errors)

Delivered as part of the next `draw`/`figure` result (`reports` array) and shown in the player bar.

| Code | When | Fields | Effect | Hint |
|---|---|---|---|---|
| `unstable_state` | A state group went non-finite or past 1e9 | `group`, `t`, `states` | Group becomes undefined from `t`; others continue | "Lower the stiffness or add damping, or `@solver step 1/960`." |
| `stiff_system` | Estimated `ω h > 2` (about to be unstable) | `states`, `omega` | Warning only | Same hint, earlier |
| `catching_up` | Replay slice in progress after a log change | `from`, `to` | Last valid frame shown | none |
| `behind_audio` | The frame delta clamp fired three times in a row | `lag` | The voice code may skip a beat | |
| `gpu_unsupported` | A particle system cannot use the GPU | `object`, `reason` (`at`, `command`, `list`, `too_many_inputs`, `no_webgl2`) | CPU path used | "3,000 is fine on CPU; over that, remove `at()`." |
| `particle_shed` | Load shedding active | `object`, `quality` | Fewer drawn | |
| `trace_decimated` | A trace passed its cap | `object`, `points` | Coarser history | |
| `path_pending` | `Path` over states is waiting for the solver | `object`, `ready` fraction | Placeholder | |
| `log_rewrite` | A change removed later log entries | `object`, `from`, `count` | History changed | "Entries after t=12.0 s for L were replaced." |
| `seek_clamped` | A seek outside `[0, duration]` | `asked`, `used` | Clamped | |

None of these stop playback. Each is reported once per change in state (not each frame).

## 4. Undefined reasons

| Reason | When |
|---|---|
| `owned_by_solver` | Attempt to set or drag a state |
| `unstable` | A state after the solver blew up |
| `not_finite` | Core |
| `before_birth` | A particle program queried at an age outside its life (internal; the particle is simply not drawn) |
| `no_trace_data` | A trace asked for before any sample (empty polyline, no error) |
| `out_of_domain` | `at(E, time)` with `time` outside `[0, duration]` |
| `not_time_dependent` | `at(E, ...)` on an object that depends on user input (an error at definition time when detectable, otherwise this reason) |

## 5. Better than GeoGebra

- Rate and state mistakes name the state and give the line to fix.
- A solver failure is reported with a time and a fix instead of silently producing numbers.
- Frame problems reduce **quality**, not numerical results, and are reported.
- Particle limits, GPU fallbacks and load shedding are visible to the teacher.
- Every animation error says what can animate.

## 6. Limits

| Limit | Value |
|---|---|
| States | 100 numbers (a Point state counts 2) |
| Rate cone operations | 5,000 |
| Solver step | 1/60 to 1/4800 s |
| Film duration | 6 hours (`@clock`) |
| Checkpoints | 43,200 (6 h × 2 per s) at most; older ones thinned to every 2 s beyond 1 h |
| Input log entries | 10,000 |
| Animated objects | 200 |
| Traces | 20 active, 5,000 points each |
| Shape trace snapshots | 300 |
| `Path` samples | 4,096 |
| Particles | 20,000 per system, 50,000 per figure |
| Particle uniforms | 64 slots |
| Particle formula size | 400 nodes per expression |

Overflow returns `limit` with `limit`, `value`, `max`; the kernel never truncates silently.
