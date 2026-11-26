# Function images that stay functions: tasks

Branch: `feat/geometry-reflect`. Pipeline: `docs/process/pipeline.md`.

- [x] 1. Builder: the check-time result type and `ArgFacts.axis` (design 1 and 2, R1, R4)
- [x] 2. Builder: `Reflect` of a function in a fixed vertical or horizontal line stays a function; a slanted line or a bare name stays a curve (design 3 and 4, R2, R5)
- [x] 3. Builder: `Stretch` of a function across a fixed horizontal line stays a function (design 3 and 4, R3, R5)
- [x] 4. Builder: `handoff/geometry-reflect/builder-notes.md`. No tests.
- [x] 5. Tester: the tests in requirements R6, from the docs and the public API only
- [x] 6. Fixer: not run. The tester's 74 transform tests passed, including every R6 case, so there was nothing to fix.
- [x] 7. Reviewer: code against this spec; findings in `handoff/geometry-reflect/review.md`; fix nothing
