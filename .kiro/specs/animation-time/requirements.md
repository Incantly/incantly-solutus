# Animation and time: requirements

The player and its clock, time helpers in formulas, the what-if input log, traces and particles. The full rules are in
`docs/features/animation-time/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Where they differ from another area,
`docs/features/README.md` and section 13 of `docs/design/formula-language-and-kernel.md` decide.

Already built by other areas and not repeated here: the clock `t`, `bt`, `beat` and `@clock` (kernel); states, rates,
the RK4 solver, checkpoints and `unstable_state` (kernel); slider animation (numbers); `Path` and `Locus` (functions).

## Shared acceptance criteria

1. WHEN a line is applied, THE SYSTEM SHALL either apply it fully or change nothing and return an error in the format
   of `docs/features/errors/design.md`.
2. WHEN a public function fails, THE SYSTEM SHALL return a `Result` error and SHALL NOT throw across the package boundary.
3. THE SYSTEM SHALL NOT read a wall clock, a timer or an unseeded random source in the kernel: the player is given its
   time source by the host.
4. THE SYSTEM SHALL pass `npm run lint`, `npm run typecheck` and `npm test`.

## Requirements

### R1. The player

**User story:** As a learner, I want to play, pause, scrub, step, loop and change the speed of a figure, so that I can
watch it move and look at any moment again.

**Acceptance criteria:**

1. THE SYSTEM SHALL keep a player state with `mode` (`stopped`, `playing`, `paused`), `t`, `rate`, `duration`, `loop`
   and `source` (design 3.2).
2. WHEN the host calls `frame(now)` while playing, THE SYSTEM SHALL advance `t` by
   `clamp(now - last, 0, 0.1) * rate` and run one kernel pass at the new `t` (design 3.3 rule 3, section 4).
3. WHEN `t` reaches `duration`, THE SYSTEM SHALL emit `end` and pause, or wrap to `loop.from` when a loop is set
   (rule 1). `t` SHALL never leave `[0, duration]`.
4. WHEN `seek(t)` is called, THE SYSTEM SHALL clamp `t`, run one pass and emit `seek` with its reason (rule 5); a
   clamped seek SHALL add the notice `seek_clamped`.
5. WHEN `stepFrames(n)` is called, THE SYSTEM SHALL pause and move `t` by `n / 60` seconds (3.4).
6. WHEN `setRate(r)` is called, THE SYSTEM SHALL accept `-4 ≤ r ≤ -0.1` or `0.1 ≤ r ≤ 4` and refuse other values.
7. WHEN the time source changes, THE SYSTEM SHALL keep `t` without a jump (rule 2).
8. WHEN `t` crosses the start of a beat (`@beat`), THE SYSTEM SHALL emit `beat`.
9. WHEN the frame delta clamp fires three frames in a row, THE SYSTEM SHALL report `behind_audio`.
10. THE SYSTEM SHALL give the same figure for the same script, input log and `t`, whatever the frame rate or seek
    history (rule 8).

### R2. Time in formulas

**User story:** As a teacher, I want small time helpers, so that motion is one short formula.

**Acceptance criteria:**

1. THE SYSTEM SHALL provide `wrap(x, a, b)`, `pingpong(x, len)`, `ramp(x, a, b)` and `ease(x)` as built-ins (design 6).
2. THE SYSTEM SHALL provide `at(obj, time)`: the value `obj` had at film time `time`, for an object that depends only on
   `t` and states. On an object that reads a value the learner can change, it SHALL be undefined with reason
   `not_time_dependent`; outside `[0, duration]`, `out_of_domain` (errors 4).

### R3. Play, Pause and Restart

**User story:** As a teacher, I want to start, stop and restart the motion from a line, so that a lesson controls time.

**Acceptance criteria:**

1. WHEN `Play()` or `Pause()` is applied, THE SYSTEM SHALL set the player's mode (core 6.6, design 5.5).
2. WHEN `Restart()` is applied, THE SYSTEM SHALL set every state back to its initial value at the current `t` and add
   a `reset` entry to the input log (design 7.5).

### R4. Changing inputs while playing

**User story:** As a learner, I want to change a slider while a pendulum swings and see it carry on, and seek back to
see the old motion, so that "what if" is honest.

**Acceptance criteria:**

1. WHEN a free value that a rate reads changes while a film runs, THE SYSTEM SHALL add a `set` entry to the input log
   at the current `t` (design 8.2).
2. WHEN the input has `rerun = restart` (the default, kernel ruling K12), THE SYSTEM SHALL drop that input's entries,
   change its base value and replay from the start (8.3).
3. WHEN the input has `rerun = continue`, THE SYSTEM SHALL apply the change from that time on: a seek to an earlier
   time SHALL show the old value and the old motion (8.3).
4. WHEN a new entry for an input is added at `t_e`, THE SYSTEM SHALL remove that input's later entries and report
   `log_rewrite` (8.4).
5. THE SYSTEM SHALL apply an entry at the first grid step at or after its time, so outcomes are deterministic (8.2).
6. THE SYSTEM SHALL keep the input log with the figure's script, so a saved film replays the same.

### R5. Traces

**User story:** As a learner, I want a trail behind a moving point that stays when I zoom and comes back when I seek,
so that I can see the path it took.

**Acceptance criteria:**

1. THE SYSTEM SHALL accept `Trace(P)`, `Trace(P, seconds)`, `Untrace(P)` and `ClearTrace(P)`, and the properties
   `trace`, `traceWindow`, `traceFade` and `traceJoin` (design 9.1).
2. WHEN `Trace` names a Text, Number or Bool, THE SYSTEM SHALL refuse it with `not_traceable` (9.2).
3. WHEN the player advances, THE SYSTEM SHALL sample a traced point every 1/60 s of film time; WHEN it seeks, THE
   SYSTEM SHALL rebuild the trace for the window before `t` (9.4).
4. THE SYSTEM SHALL keep at most 5,000 points per trace, decimating by 2 without a window and dropping the oldest with
   one, and SHALL report `trace_decimated` (9.4).
5. WHEN a sample is undefined, THE SYSTEM SHALL break the trace there (9.4).
6. THE SYSTEM SHALL store a trace in maths coordinates and hand it to the view as a `trace` value (9.7).
7. THE SYSTEM SHALL keep at most 20 traces (errors 6).

### R6. Particles

**User story:** As a teacher, I want one `Particles(...)` line for a fire, so that a lesson can show thousands of small
moving things that seek and replay exactly.

**Acceptance criteria:**

1. THE SYSTEM SHALL accept `Particles(...)` with the named parameters of design 10.2; `count`, `life` and `pos` are
   required (`missing_particle_param`), other names are `unknown_particle_param`, and bad values are
   `bad_particle_value`.
2. THE SYSTEM SHALL make `i n u v w cycle age life ph` visible only inside the call, and SHALL report
   `particle_name_outside` for them elsewhere and `particle_command` for a command inside a formula (10.3).
3. THE SYSTEM SHALL compute every particle as a pure function of `(i, t)` (10.4), with the integer hash `rand` shared
   with the GPU.
4. THE SYSTEM SHALL implement the view's `ParticleProgram`: `evalCpu(t, bt, out)` fills the batch; `gpuSource()` gives
   GLSL ES 3.00 for the GPU subset, and `gpuOk` is false with a reason otherwise (10.5).
5. THE SYSTEM SHALL keep at most 20,000 particles per system and 50,000 per figure (`limit`) (10.6).

### R7. Errors and runtime reports

**User story:** As a model writing lines, I want every mistake in this area to come back with its kind, place, hint and
fix, so that I can correct it on the next line.

**Acceptance criteria:** THE SYSTEM SHALL register the line errors, runtime reports and undefined reasons of
`docs/features/animation-time/errors.md` that belong to R1 to R6 in the one error table.

### R8. Performance

**User story:** As a learner on a school laptop, I want playing to stay smooth.

**Acceptance criteria:** THE SYSTEM SHALL meet the budgets of design section 12 for the player (under 0.1 ms per frame),
trace samples (under 20 µs) and CPU particles (3,000 evaluated in under 1.5 ms).

### R9. Second round: what the first round left out

**User story:** As a teacher, I want the motion features to work for every kind of motion (states, drags, saved films),
so that what the class sees does not depend on how it was made.

**Acceptance criteria:**

1. WHEN the player seeks, THE SYSTEM SHALL rebuild a trace of an object that moves through states from the solver's
   dense output, each sample at its own time (9.4).
2. WHILE a drag gesture moves a traced object, THE SYSTEM SHALL add one sample per drag step, capped and thinned like
   time samples, not replayed by a seek, and forgotten by `ClearTrace`, `Untrace` or a redefinition (9.5).
3. THE SYSTEM SHALL save the input log at the end of the script as `@input` lines and read them back on load (R4.6).
4. WHEN the states are behind the clock after a far seek, THE SYSTEM SHALL report `catching_up` once and keep the player
   asking for frames until they catch up (8.5).
5. WHEN the fastest rate of the states is too fast for the step (`ω h > 2`), THE SYSTEM SHALL report `stiff_system`
   (errors 3).
6. THE SYSTEM SHALL let `Path(P, t0, t1)` follow a point that moves through states, and report `path_pending` with how
   much is ready when the solver has not reached `t1` (9.8).
7. THE SYSTEM SHALL provide `Gradient(x, c1, c2, ...)` on the CPU and the GPU, `size = px(...)` and `layer` for
   particles (10.2), and the load shedding of 10.6 with `particle_shed`.
8. THE SYSTEM SHALL animate sliders one way only, the numbers area's `loop`, `period` and `Animate(a)`, on the player's
   clock, and refuse `with animate = ...` with a hint to that form (design 5).

## Decided against the design

- **The `rerun` default is `restart`**, not `continue`: section 13 of the core design and kernel ruling K12 decide it.
  An input opts in with `L with rerun = continue`.
- **Slider animation words (A8).** Decided by the product owner on 12 November 2026: one way to write it, the numbers
  area's `loop`, `period` and `Animate(a)`. `animate`, `seconds`, `phase` and `smooth` are dropped from the design.
- **`fract`** is the language's `x - trunc(x)`, not `x - floor(x)`. Decided by the product owner on 12 November 2026.
- **`Gradient` is a command**, not a built-in: built-ins are lowercase and capital names are commands. It is the one
  command a particle formula may call.
- **`px(...)`** is not a built-in (that would reserve the name `px`). Inside `Particles`, `size = px(e)` is rewritten
  to `size = e, sizeUnit = "px"`.
- **Bodies and events (7.9)** are designed for v1.5 and are not built here.
