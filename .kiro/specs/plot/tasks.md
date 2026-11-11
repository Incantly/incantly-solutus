# Plotting and sampling: tasks

Pipeline: `docs/process/pipeline.md`. Branch: `feat/plot`.

- [x] 1. Build the area from the design docs (builder, writes no tests)
  - [x] 1.1 The adaptive function plotter and interval mode, in plain words (R1, `docs/features/functions-calculus/design.md` section 9)
  - [x] 1.2 Parametric curves (R2, `docs/features/curves-loci/design.md` section 5)
  - [x] 1.3 Implicit curves (R3, `docs/features/curves-loci/design.md` section 6)
  - [x] 1.4 Piecewise curves: Bezier and splines (R4, `docs/features/curves-loci/design.md` section 8)
- [ ] 2. Write blind spec tests from the docs and the public API only (tester)
- [ ] 3. Fix code until the spec tests pass (fixer)
- [ ] 4. Check state machines, security and speed; write findings (Opus checker, reports only)
- [ ] 5. Fix the checker's findings in one round; mark anything left `to be implemented` (fixer)
- [ ] 6. Add regression tests for each finding (tester)
- [ ] 7. Review the code against the docs; fix the must-fix items in one round (spec reviewer, fixer)
- [ ] 8. Build the area's studio screens (studio builder)
- [ ] 9. Merge into `integration` once lint, typecheck and tests pass (integrator)
