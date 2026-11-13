# Statistics and charts: tasks

Pipeline: `docs/process/pipeline.md`. Branch: `feat/statistics`.

- [x] 1. Build the area from the design docs (builder, writes no tests)
  - [x] 1.1 Shared core: argument helpers, sort cache, sums and moments, quantile methods, ranks
  - [x] 1.2 Describe one list and two lists, with frequencies (R1, R2)
  - [x] 1.3 Classes, frequency, tables (R3)
  - [x] 1.4 Charts (R4)
  - [x] 1.5 Distribution functions; tests and intervals (R6)
  - [x] 1.6 Linear and nonlinear least squares; fit commands (R5)
  - [x] 1.7 Reasons, warnings, record schemas, summaries (R7)
- [x] 2. Write blind spec tests from the docs and the public API only (tester)
- [x] 3. Fix code until the spec tests pass (fixer)
- [ ] 4. Check state machines, security and speed; write findings (checker, reports only)
- [ ] 5. Fix the checker's findings in one round; mark anything left `to be implemented` (fixer)
- [ ] 6. Add regression tests for each finding (tester)
- [ ] 7. Review the code against the docs; fix the must-fix items in one round (spec reviewer, fixer)
- [x] 8. Build the area's studio screens: the data-analysis panels (studio builder)
- [x] 3a. Benchmarks against the speed targets (R8)
- [ ] 9. Merge into `integration` once lint, typecheck and tests pass (integrator)
