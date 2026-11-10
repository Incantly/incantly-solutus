# Language area: fixer notes, round 1

Branch `feat/language`. `npm run lint` and `npm run typecheck` pass. `npx vitest run packages/kernel/test/spec`: 1,068 of 1,070 pass. The two failures are contested below. Parse plus check of a typical line stays far below 0.2 ms (performance tests pass).

## Fixes

Report numbers refer to `handoff/language/test-report.md`; rulings to `docs/features/language/rulings.md`.

| # | Fix | Where |
|---|---|---|
| 1 | `precision_loss` for `9007199254740993`: the rounded value equals 2^53, so the test is now `>=` 2^53 and compares the exact digits | `lexer.ts` |
| 2 | `Circle(A,, 2)`: a missing argument before `,` or `)` inside a command call lists `expression` and `)` in `expected` | `parser.ts` |
| 3 | `Circle[A, 2]`: a PascalCase name followed by `[expr,` is `syntax` with the mechanical fix to round brackets (`fix` and `suggest[0]`) | `parser.ts` |
| 4 | `Circle(A, 2)` as a bare line: the parser no longer decides the name. `analyseLine` and `ScratchFigure.apply` leave PascalCase calls to the checker, which names the object by result type (`c`). Parser-level `unnamed_object` (when `isObjectCommand` is passed) and bare `(1, 2)`, `3 + 4` now pick a free name through the new `ParseOptions.isTaken` and `suggestName` | `parser.ts`, `figure.ts`, `tooling.ts` |
| 5 | `n = .` is `bad_number`; a `.` is a field access only directly after a name or `)` / `]` | `lexer.ts` |
| 6 | `1e+` stays `syntax` (Q10). Already the case; no change | |
| 7 | Nesting depth: 64 levels are allowed, 65 is `limit` (Q, "Depth"). `parseExpr` no longer counts; calls and unary/power chains count once | `parser.ts` |
| 8 | `unbalanced` has phase `parse` (design 3.1 lists it under step 2) | `errors.ts` |
| 9 | `hint` is always present and never empty: `buildError` falls back to a default hint when the caller gave none | `errors.ts` |
| 10 | `p = ab` with `a` and `b` known: `fix` is `p = a * b` (the slider quick fix no longer hides it); hint reads "a and b both exist" | `check.ts` |
| 11 | `x = P.x`: `reserved_name` carries `fix` = `px = P.x` when the name comes from the field (also first in `suggest`) | `lines.ts` |
| 12 | `Distance(A, a = B)` is `duplicate_arg` even when other arguments are also missing | `check.ts` |
| 13 | `Seq(2, 3, 1, 5)` and `Seq(k^2, 3, 1, 5)`: a binder position that is not a bare name raises `not_a_binder` (`expected: ["name"]`), after any error found inside the other arguments | `check.ts` |
| 14 | Q5/Q6/Q7: closest form prefers forms whose count fits, then fewest problems. A count that fits no form is `arg_count` (always, also for several forms) with the whole call as span. A fitting count with exactly one wrong argument points at that argument; with several wrong arguments the span is the whole call | `check.ts` |
| 15 | Compact size of `Circle(A, 2, 3)`: dropped the copy of the message from `params` and shortened the hint to "Closest form: Circle(a, b, c)." | `check.ts`, `errors.ts` |
| 16 | Keywords as names: `and = 1`, `or`, `not`, `xor`, `if`, `in`, `step`, `with` parse as a definition and fail in the checker with `reserved_name` | `parser.ts` |
| 17 | Q11: `1a = 1` (digits, a directly adjacent name, then `=`) is `bad_name` ("A name cannot start with a digit") with fix `a1 = 1` | `parser.ts` |
| 18 | `suggestName` understands `List<Number>` and `Function<Number>` as text; it skips command names, function names and held-back names whenever those tables are passed (also when only `commands` is given) | `names.ts` |
| 19 | `(x - a)^2 + (y + b)^2 == 16` is a `Circle`: the radius squared is computed over opaque atoms (objects, parameters, fields), so it is the constant 16 whatever `a` and `b` are. A radius that still depends on an object (`x^2 + y^2 == r^2`) stays a conic `Curve` | `relation.ts` |
| 20 | `gcd` and `lcm` of non-integers are undefined with `out_of_domain` (design 3.14); `fact`, `ncr`, `npr` keep `not_integer` | `builtins.ts` |
| 21 | One-argument `log(x)`: `arg_count` with the hint "use ln, log10 or log2" | `check.ts` |
| 22 | Q4: an infinity that comes from `inf` (written in the line, or read from a stored object) is a defined Number; `inf - inf` and `0 * inf` are still undefined `not_finite`, and overflow of finite numbers is undefined `overflow`. `Env.inf` records that a stored infinity was read | `compile.ts`, `runtime.ts` |
| 23 | Slider bound `inf`: `bad_range` with the hint "Pick a finite bound" (new ruling) | `lines.ts` |
| 24 | `checkTable`: two forms are ambiguous unless one is strictly more specific at every position (a subset of the other), so `Shape` against `Path` is rejected | `table.ts` |
| 25 | Completion: the query's letters in order with the first letter at the start of the name (`mp` in `Midpoint`, `sgm` in `Segment`) score 500 | `tooling.ts` |
| 26 | Syntax colouring: parameters of `f(x) = …` and binders or body-scope names of a command call (`Seq(k^2, k, 1, 5)`) are `name`, not `unknown` | `tooling.ts` |
| 27 | Q2: the quick fix for `1/2a` is `(1/2) * a` (never `(1/2) a`) | `parser.ts` |

## Contested tests

Both contradict `rulings.md` Q2 ("`)` followed by a name is `missing_operator`. The quick fix is `(1/2) * x`, not `(1/2) x`") and the tester's own test in `grammar.test.ts`, "rulings.md Q2: the quick fix for (1/2)x is (1/2) * x, never (1/2) x", which asserts that no quick fix of `h = 1/2a` contains `(1/2) a`. Both cannot pass.

1. `packages/kernel/test/spec/language/grammar.test.ts`, "errors.md 3 ambiguous_implicit: quickFixes offer (1/2) a and 1/(2a)": expects the line `h = (1/2) a`. It should expect `h = (1/2) * a`.
2. `packages/kernel/test/spec/language/agent.test.ts`, "agent.md 5.4 disambiguation > h = 1/2x with x a function parameter": expects `h(x) = (1/2) x`. It should expect `h(x) = (1/2) * x`. (`agent.md` 5.4 shows `(1/2) x`; Q2 overrides it.)

## Not changed

- Q1, Q3 behave as the rulings say already (`not_callable`, `type_mismatch`).
- Q9, Q12, Q13, Q14 already held; the checker keeps `more` to 7 entries.
