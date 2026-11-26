# Identically true relations: tasks

Branch: `feat/identically-true`. Pipeline: `docs/process/pipeline.md`. No new state, so there is no state-machine checker pass.

- [x] 1. Builder: the proof (design 1, R2) and one warning on the line (design 2, R1). Registered severity becomes `warning`.
- [x] 2. Builder: `identicallyTrue` on the relation value, and the painter draws nothing (design 3, R3).
- [x] 3. Builder: `handoff/identically-true/builder-notes.md`. No tests.
- [x] 4. Tester: the tests in requirements R4, from the docs and the public API only.
- [x] 5. Fixer: the review's false-warning case. Coefficients snap once, then the determinant, the flat axis and the minimum are compared exactly. Three regressions passed.
- [x] 6. Reviewer: code against this spec; findings in `handoff/identically-true/review.md`; fix nothing.
