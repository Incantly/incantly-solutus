# Symbolic maths (CAS): tasks

Pipeline: `docs/process/pipeline.md`. Branch: `feat/symbolic`.

- [x] 1. Build the area from the design docs (builder, writes no tests)
  - [x] 1.1 What the feature does (R1, `docs/features/cas/design.md` section 1)
  - [x] 1.2 The command set, in our syntax (R2, `docs/features/cas/design.md` section 2)
  - [x] 1.3 Every command in the manual's groups, and what we do (R3, `docs/features/cas/design.md` section 3)
  - [x] 1.4 Our design (R4, `docs/features/cas/design.md` section 5)
  - [x] 1.5 Giac, GPL, and what it means for us (R5, `docs/features/cas/design.md` section 6)
  - [x] 1.6 Edge cases (R6, `docs/features/cas/design.md` section 8)
  - [x] 1.7 Acceptance tests (R7, `docs/features/cas/design.md` section 9)
  - [x] 1.8 Phases (R8, `docs/features/cas/design.md` section 10)
  - [x] 1.9 Phase 2 detail: Steps (R9, `docs/features/cas/design.md` section 11)
  - [x] 1.10 Changes to the core design (R10, `docs/features/cas/design.md` section 12)
  - [x] 1.11 Open questions (R11, `docs/features/cas/design.md` section 13)
- [ ] 2. Write blind spec tests from the docs and the public API only (tester)
- [ ] 3. Fix code until the spec tests pass (fixer)
- [ ] 4. Check state machines, security and speed; write findings (Opus checker, reports only)
- [ ] 5. Fix the checker's findings in one round; mark anything left `to be implemented` (fixer)
- [ ] 6. Add regression tests for each finding (tester)
- [ ] 7. Review the code against the docs; fix the must-fix items in one round (spec reviewer, fixer)
- [ ] 8. Build the area's studio screens (studio builder)
- [ ] 9. Merge into `integration` once lint, typecheck and tests pass (integrator)
