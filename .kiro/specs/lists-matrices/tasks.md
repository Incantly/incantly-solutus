# Lists and matrices: tasks

Pipeline: `docs/process/pipeline.md`. Branch: `feat/lists-matrices`.

- [x] 1. Build the area from the design docs (builder, writes no tests)
  - [x] 1.1 Language hooks: area operators, area indexing, `Record<Schema>` types, `@list` element types
  - [x] 1.2 List commands: build, test and total, reorder, cut and join, sets, lists of points (R1, R2)
  - [x] 1.3 List broadcasting (R2.5)
  - [x] 1.4 The Matrix type: makers, operators, fields, indexing, the exact path (R3)
  - [x] 1.5 Matrix commands and factorisations (R4)
  - [x] 1.6 The Record type and schemas (R5)
  - [x] 1.7 Error kinds, undefined reasons and warnings (R6)
- [x] 2. Write blind spec tests from the docs and the public API only (tester)
- [x] 3. Fix code until the spec tests pass (fixer)
- [ ] 4. Check state machines, security and speed; write findings (checker, reports only)
- [ ] 5. Fix the checker's findings in one round; mark anything left `to be implemented` (fixer)
- [ ] 6. Add regression tests for each finding (tester)
- [ ] 7. Review the code against the docs; fix the must-fix items in one round (spec reviewer, fixer)
- [ ] 8. Build the area's studio screens (studio builder)
- [ ] 9. Merge into `integration` once lint, typecheck and tests pass (integrator)
