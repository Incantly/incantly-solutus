# Animation and time: builder notes

Built from `docs/features/animation-time/` and the spec in `.kiro/specs/animation-time/`. Lint, typecheck and the whole
suite pass; the area's own tests are in `packages/kernel/test/spec/animation/` (64 tests).

## What is built

| Part | Where | Notes |
|---|---|---|
| The player (R1) | `packages/kernel/src/clock/player.ts` | Pure: the host passes a `ClockSource` and calls `frame(now)` while `needsFrame()`. Modes, the 0.1 s frame-delta cap, `end` and loops, clamped seeks (`seek_clamped`), `stepFrames`, speed −4..−0.1 and 0.1..4, source switches without a jump, `beat` events, `behind` after three capped frames. `playerOf(figure)` keeps one player per figure. Areas add per-frame work with `registerFrameTicker`. |
| Time helpers (R2) | `language/builtins.ts` | `pingpong`, `ramp`, `ease`. `wrap` was already in numbers. |
| `Play`, `Pause`, `Restart` (R3) | `commands/animation/index.ts` | `Restart()` adds a `reset` to the input log: the states go back to their initial values from now on; the past is unchanged. |
| Input log and `rerun` (R4) | `clock/solver.ts` | `set` and `reset` entries, applied at the first grid step at or after their time. `rerun = restart` is the default (kernel ruling K12): history is rewritten. `L with rerun = continue` logs the change instead; a newer entry at an earlier time removes that input's later ones (`log_rewrite`). A change before the film starts, or to a value only an initial value reads, restarts. |
| Traces (R5) | `commands/animation/traces.ts` | `Trace(P)`, `Trace(P, seconds)`, `Untrace`, `ClearTrace`, and `trace`, `traceWindow`, `traceFade`, `traceJoin` in `with`. Points every 1/60 s, shapes every 1/30 s as value snapshots. A frame adds samples; a seek rebuilds from the slice over the clock. 5,000 points (300 snapshots), thinned by 2 without a window (`trace_decimated`); 20 traces. Undefined samples are gaps (`NaN`). `tracePoints` gives the view's `trace` value in maths coordinates. |
| Particles (R6) | `commands/animation/particles.ts`, `particlecheck.ts` | The command with the parameters of design 10.2; each particle a pure function of `(i, t)` over an integer hash shared with GLSL; the view's `ParticleProgram` (`evalCpu` and `gpuSource`, GLSL ES 3.00 with figure values as uniforms). Errors: `unknown_particle_param`, `missing_particle_param`, `bad_particle_value`, `particle_command`, `particle_name_outside`, the 50,000-per-figure `limit`. |
| Errors (R7) | kernel error and notice tables | C050 to C056; notices A101 to A105; reason `not_time_dependent`. |

CPU particles: 3,000 particles of the design's fire formula (3D noise and a colour each) take about 1.5 ms per frame on
the build machine, at the budget of design 12.

## Kernel changes this area needed

- **Frame tickers** (`registerFrameTicker`): work an area does each time the player moves the clock.
- **Rule factories receive each argument's checked tree** (`BoundArg.expr`, as the contract already said). The particle
  compiler turns the formulas into GLSL from it.
- **Body arguments record their scope slots** (`scopeSlots`), so a rule can fill names such as `u` and `age`.
- **Area actions receive the evaluated values of their arguments** (`ActionCall.values`); before, every value was
  `undefined` and each area evaluated its own.
- `onFreeWritten` gets the value before the write, so the input log knows an input's value before its first change.
- `Figure.beats()` reads the beat starts.

## Decided against the design

- `rerun` defaults to `restart`, not `continue` (core decision 5, kernel ruling K12).
- Slider animation words `animate`, `seconds`, `phase`, `smooth` (A8) are not built: the numbers area already animates
  sliders with `loop` and `period`. To be confirmed by the product owner.
- `fract` stays the language's (`x - trunc(x)`); the animation design writes `x - floor(x)`. They differ for negative
  numbers. The particle GLSL follows the language.

## To be implemented

- `at(obj, time)` (R2.2): a built-in function cannot see which object its argument names. Needs a call form that
  passes the object, or a command.
- `Gradient(ph, c1, c2, ...)` for particle colours: not in the language yet. `rgb` and `hsl` with `ph` work.
- Saving the input log with the script (R4.6), and the catch-up slices of design 8.5.
- Drag traces (9.5): only time traces are built. A traced point that moves only through states is sampled at its
  current value on each frame, so a seek shows it flat; the slice over the clock does not run the solver.
- `px(...)` sizes (`sizeIsPx` is always false) and the `layer` parameter (accepted, not used).
- The GLSL program has not run on a real GPU yet: the view's integrator should render CPU and GPU on fixtures and
  compare (design 10.7).
- `path_pending`, `catching_up`, `stiff_system` and `particle_shed` runtime reports.
