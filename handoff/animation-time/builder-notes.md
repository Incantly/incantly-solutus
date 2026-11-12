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

## Second round (12 November 2026)

| Part | Where | Notes |
|---|---|---|
| Traces of states after a seek | `graph/core.ts` `sliceRecs`, `clock/solver.ts` `statesAt` | A slice over the clock now sets the states the target reads from the solver's dense output at each time (`Slice.states` names them). `sync` is `statesAt` plus the writes. `Path` over states uses the same. |
| Drag traces (9.5) | `traces.ts` `traceDragStep`; kernel `registerDragListener` | Each drag step appends the traced object's value; capped and thinned like time samples; a seek keeps them; `ClearTrace`, `Untrace` and a redefinition forget them. `tracePoints` puts them after the time samples with a gap; `traceDragPoints` and `traceDragSnapshots` give them alone. |
| Saved input log (R4.6) | `index.ts` `inputLogLines`, `graph/tx.ts`, `graph/figure.ts` | `@input L 1 base`, `@input L 2 at 12.5`, `@input P 1 2 at 3`, `@input reset at 20`, written at the end of the script and read back into the log (not kept as script items, so a save never doubles them). |
| `catching_up` (8.5) | `clock/solver.ts`, `clock/player.ts` | The kernel has no clock, so a slice is a step budget (the existing 400,000 steps a call). Reported once; the player asks for frames, even paused, until the states reach `t`. |
| `stiff_system` | `clock/solver.ts` `checkStiffness` | ω from 8 power-iteration steps on finite differences of the rates at the start (geometric mean over an even count, so an oscillator gives its frequency). Warned when ω h > 2. |
| `path_pending` | `functions/specs-curves.ts` `runPath` | A path that reaches past the solver draws what is ready and reports how much (found by bisection). |
| `Gradient` | `commands/animation/colour.ts` | A command (capital names are commands; built-ins are lowercase). The one command a particle formula may call; the GLSL is a chain of `mix`. |
| `px` sizes, `layer` | `particlecheck.ts`, `particles.ts` | `size = px(e)` is rewritten to `size = e, sizeUnit = "px"`. `layer` 0..9, kept on the spec. |
| Load shedding (10.6) | `particles.ts` `ParticleShedder` | Pure; the host reports each frame's milliseconds. |
| One slider animation | `numbers/index.ts`, `animation/index.ts` | The numbers area's slider tick is a frame ticker, so `Animate(a)` follows `Play()` and seeks. `with animate = ...` is refused (`bad_property_value`) with a hint to `loop`, `period` and `Animate(a)`. |

Tests: `packages/kernel/test/spec/animation/second.test.ts` (22).

## Decided against the design

- `rerun` defaults to `restart`, not `continue` (core decision 5, kernel ruling K12).
- Slider animation words `animate`, `seconds`, `phase`, `smooth` (A8) are dropped: one way to write it, the numbers
  area's (product owner, 12 November 2026). The design doc now says so. Kernel ruling K11 still lists `animate` in the
  property table; this area refuses it. Removing it from the table is a kernel change, left for the kernel owner.
- `fract` stays the language's (`x - trunc(x)`), decided by the product owner on 12 November 2026; the design doc now
  says so.

## To be implemented

- `at(obj, time)` (R2.2): a built-in function cannot see which object its argument names, and the numbers area already
  has `at(x, y)` (a place in the maths plane for `place = at(1, 2)`). `at(k, 3)` with a Number `k` would be ambiguous.
  Needs a product-owner decision on the name.
- A trace of a point that moves only through an animated slider is sampled at the slider's current value when a seek
  rebuilds it: the slider is a free value the numbers area writes each frame, not a rule of `t`, so the slice over the
  clock cannot replay it.
- The GLSL program has not run on a real GPU yet: the view's integrator should render CPU and GPU on fixtures and
  compare (design 10.7).
