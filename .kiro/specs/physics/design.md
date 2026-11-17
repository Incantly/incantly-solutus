# Physics: design notes for building

The full design is `docs/features/physics/design.md`. This file says where each part lives and what the core must offer.

## Where it lives

| Part | Place |
|---|---|
| Exact maths (`sin`, `cos`, `atan2`, `exp`, `pow`) | `packages/kernel/src/physics/math.ts` |
| 2D world: bodies, shapes, broad and narrow phase, solver, joints, sleep, checkpoints | `packages/kernel/src/physics/world2.ts` and helpers |
| 3D world | `packages/kernel/src/physics/world3.ts` and helpers |
| Liquids, water, waves, smoke | `packages/kernel/src/physics/fluid*.ts` |
| Cloth, and the shared particle step and neighbour grid for cloth and drops | `packages/kernel/src/physics/cloth.ts`, `particles.ts` |
| The physics worker (a whole world with cloth or liquid) | `packages/sdk/src/worker/physics-worker.ts` |
| The WebGL 2 painter for cloth and drops in space | `packages/view/src/gl/` |
| Commands, types, readouts, the `world` object, errors | `packages/kernel/src/commands/physics/` |
| The figure driver (inputs, steps, checkpoints, input log, writing body cells) | `packages/kernel/src/commands/physics/driver.ts` |
| Drawing 2D, 3D, arrows, the grab | `packages/sdk/src/screen/` |
| Tools, examples, panel row | `apps/studio/src/` |
| Benches | `packages/kernel/bench/physics.bench.ts`, `packages/sdk/bench/physics.bench.ts`, a throttled Chrome script |

## Core hooks

1. **Post-pass drivers.** `registerWorldDriver(factory)`: after a pass, each driver of the figure may write the cells of objects it owns and return them; the figure runs one more pass over their downstream objects. The driver also says whether it needs frames (`needsFrame`), whether it is catching up, and its warnings.
2. **Driven rule objects.** A body is a rule object. Its rule gives the start value. The driver writes the pose over it after each pass. A rule run of a driven object keeps the driver's pose (the driver gets the new start through a hook), so dependents never see the start by mistake mid-film.
3. **Input log lines.** `@input grab …`, `@input push …` go to the driver through the existing `onInputLine` hook, extended to area handlers.
4. **Free writes.** A changed free value read by the world goes to the driver (restart or log, by `rerun`).
5. **Per-step evaluation.** The driver evaluates force, motor and mover formulas at each step time, through a slice over the clock for movers and a cone recompute for formulas that read bodies, as the state solver does.
6. **Handler events.** A `hit` event kind for `on` handlers, with `hit` as a name only inside its handler.
7. **A driver in a worker.** The driver can run on a headless copy of the figure in a worker: the page sends free values and logged inputs, and gets back the cells it owns each frame, with their typed arrays moved, not copied. The kernel stays free of workers and timers; the SDK hosts the worker.

## Determinism rules

- No `Math.sin`, `Math.cos`, `Math.atan2`, `Math.exp`, `Math.pow`, `Math.hypot` in `packages/kernel/src/physics/` (a test greps for them).
- Every loop in id order; pair lists sorted.
- Typed arrays only in steps; no allocation per step after warm-up (checked by a bench).

## Decisions

- The 2D and 3D engines are separate worlds, each with its own driver. A figure with a body in space is a world in space; the plane driver leaves it alone.
- Cloth uses XPBD with 4 small steps and one pass each (design 9.5), not more passes: stiffer and cheaper.
- Bodies give and take cloth and drop impulses with a lag of one step, in a fixed order, so the film stays exact (design 9.6).
- A world with cloth or liquid runs whole in one worker, bodies included, so every hit has one order.
- Cloth checkpoints every 0.25 s, so a seek is at most 30 steps.
- `world` is a reserved object written `world = World(...)`; `world with gravity = …` is rewritten to it, as `space` is.
- Compiled user formulas keep `Math.*` for now; the cross-browser test covers films whose formulas use only arithmetic. Moving the compiler to exact maths is task 10.5.
