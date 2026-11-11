# Formula language: tasks

Pipeline: `docs/process/pipeline.md`. Branch: merged into `main` (PR #27).

- [x] 1. Build the area from the design docs (builder, writes no tests)
  - [x] 1.1 What the language does (R1, `docs/features/language/design.md` section 1)
  - [x] 1.2 Our design (R2, `docs/features/language/design.md` section 3)
  - [x] 1.3 Changes to the core design (R3, `docs/features/language/design.md` section 5)
  - [x] 1.4 What the feature does (R4, `docs/features/algebra-view/design.md` section 1)
  - [x] 1.5 Our design (R5, `docs/features/algebra-view/design.md` section 3)
  - [x] 1.6 Changes to the core design (R6, `docs/features/algebra-view/design.md` section 5)
- [x] 2. Write blind spec tests from the docs and the public API only (tester)
- [x] 3. Fix code until the spec tests pass (fixer)
- [x] 4. Check state machines, security and speed; write findings (Opus checker, reports only)
- [x] 5. Fix the checker's findings in one round; mark anything left `to be implemented` (fixer)
- [x] 6. Add regression tests for each finding (tester)
- [x] 7. Review the code against the docs; fix the must-fix items in one round (spec reviewer, fixer)
- [x] 8. Build the area's studio screens (studio builder)
- [x] 9. Merge into `integration` once lint, typecheck and tests pass (integrator)
