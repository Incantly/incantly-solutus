# Build pipeline

Every feature area goes through the same steps. Each step is a fresh agent with no memory of the others. Agents hand work to each other only through files on the area's branch.

## Steps

| Step | Role | Model | Reads | Writes |
|---|---|---|---|---|
| 1 | Builder | Sonnet 5.5 | Docs | Code in its area. No tests. |
| 2 | Tester | Sonnet 5.5 | Docs and the package's public API (`src/index.ts` and the types it exports) only. Never `src/` internals. | `test/spec/` |
| 3 | Fixer | Sonnet 5.5 | `handoff/<area>/test-report.md` | Code fixes, until the tester's tests pass |
| 4 | Checker | Opus 5.5 | All code in the area | `docs/state-machines.md` (its section), `handoff/<area>/findings.md` |
| 5 | Fixer | Sonnet 5.5 | `handoff/<area>/findings.md` | Code fixes |
| 6 | Tester | Sonnet 5.5 | `handoff/<area>/findings.md` and the public API | A regression test for each fix, in `test/spec/` |
| 7 | Checker | Opus 5.5 | The fixes | Closes findings in `handoff/<area>/findings.md`; updates `docs/state-machines.md` |
| 8 | Spec reviewer | Sonnet 5.5 | Docs and code | `handoff/<area>/review.md` |
| 9 | Studio builder | Sonnet 5.5 | The area's public API and `ui.md` | Screens in `apps/studio` |

Steps 5 and 6 (fix, regression tests) run once, in one round after the first check. There is no confirm pass by a second checker; the integrator runs the full test suite instead. Anything the round does not fix is marked `status: to be implemented` in `findings.md` and handed to the area that owns it; it does not hold up the merge.

## Hand-off files

All live in `handoff/<area>/` on the area's branch and are kept after merge as the area's record.

- `test-report.md`: the tester's failing tests, each with the doc line it checks.
- `findings.md`: the checker's confirmed bugs, ranked by harm, grouped, each with evidence (the path through the code, and the retry or concurrency case that reaches it), status `open`, `fixed` or `closed`.
- `review.md`: the spec reviewer's list of gaps against the docs, each with the doc section.
- `builder-notes.md`: what the builder built, what it left out and why, and the public API.

## Fix every case of a rule

When a fix applies a rule (for example the overflow rule, a position rule or a security check), the fixer finds every place the same rule applies, not only the case named in the finding, and fixes them together. For number rules that means every value kind: numbers, lists, functions, points, vectors and any other numeric type.

## Disputes

A tester's test may be wrong. The fixer may contest a test only by quoting the doc line that shows it. If the doc is unclear, the dispute goes to the product owner, and the doc is fixed.

## The checker's job

1. Find the explicit and implicit state machines in the area's code.
2. Document their states, invariants and transition tables in its section of `docs/state-machines.md`.
3. Find invalid states or transitions the code can actually reach, with evidence, including through retries and concurrency.
4. Rank confirmed bugs by impact and group related fixes in `handoff/<area>/findings.md`.
5. Fix nothing. The fixer fixes; the tester adds regression tests; the checker confirms and keeps the document updated.
6. Also check security: input from files, the network and models; resource limits; anything that could run code or leak keys.
