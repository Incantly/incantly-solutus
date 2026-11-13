# Animation and time: design

The player and its clock, time helpers, the what-if input log, traces and particles.

## Where the design lives

`docs/features/animation-time/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Cross-area decisions:
`docs/features/README.md` and section 13 of `docs/design/formula-language-and-kernel.md`.

## Code

- `packages/kernel/src/clock/player.ts`: the player. Pure: the host passes a `ClockSource` and calls `frame(now)` from
  its one animation-frame loop; the player never schedules anything itself.
- `packages/kernel/src/commands/animation/`: `Play`, `Pause`, `Restart`, `Trace`, `Untrace`, `ClearTrace`, `ValueAt`,
  `Particles`, the trace store and sampler, the particle compiler (CPU closures and GLSL), the error kinds.
- `packages/kernel/src/clock/solver.ts`: the input log and the `rerun` policy.
- Branch `feat/animation-time`. Hand-off notes in `handoff/animation-time/`.

## How it fits

- The player drives the kernel through `setClock(t)` and `flush()`; the solver follows `t` as it does now.
- Traces and particles reach the view through its `KernelView` contract (`trace` values and `particlesOf`), which the
  view area already defines in `packages/view/src/contracts.ts`.
- Area lines plug in through the kernel's hooks: commands and actions in the `CommandRegistry`, `registerLineCheck`,
  `registerLineRewriter`, and the error table.
- The particle hash is integer-only, so the CPU and GPU paths agree.

## Decisions

- `rerun` defaults to `restart` (core decision 5, kernel ruling K12); an input opts in to `continue`.
- Slider animation stays with the numbers area (`loop`, `period`); the design's `animate` and `seconds` (A8) are not
  built.
- Bodies and events (design 7.9) wait for v1.5.
