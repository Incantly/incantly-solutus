# Animation and time: tasks

Pipeline: `docs/process/pipeline.md`. Branch: `feat/animation-time`.

- [x] 1. Build the area from the design docs (builder, writes no tests)
  - [x] 1.1 The player: modes, frame delta, end and loop, seek, frame steps, rate, time sources, beats (R1)
  - [x] 1.2 Time helpers `wrap`, `pingpong`, `ramp`, `ease` (R2); `at(obj, time)` is to be implemented
  - [x] 1.3 `Play()`, `Pause()`, `Restart()` (R3)
  - [x] 1.4 Input log with `rerun = continue | restart` in the solver (R4)
  - [x] 1.5 Traces: actions, properties, sampler, caps, the view's `trace` value (R5)
  - [x] 1.6 Particles: the command and its checks, the CPU program, the GLSL program (R6)
  - [x] 1.7 Error kinds, runtime reports and undefined reasons (R7)
- [x] 2. Write blind spec tests from the docs and the public API only (tester)
- [x] 3. Fix code until the spec tests pass (fixer)
- [ ] 4. Check state machines, security and speed; write findings (checker, reports only)
- [ ] 5. Fix the checker's findings in one round; mark anything left `to be implemented` (fixer)
- [ ] 6. Add regression tests for each finding (tester)
- [ ] 7. Review the code against the docs; fix the must-fix items in one round (spec reviewer, fixer)
- [ ] 8. Build the area's studio screens (studio builder)
- [ ] 9. Merge into `integration` once lint, typecheck and tests pass (integrator)
