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

# Round 2: checker findings LANG-SM-1 to LANG-SM-21

All 21 findings are `fixed` in `handoff/language/findings.md`, each with a one-line account of what changed and where; none is `blocked`. `npm run lint`, `npm run typecheck` and `npx vitest run packages/kernel/test/spec` pass (1,156 of 1,156, including the tester's `regressions.test.ts`). No test contradicts the docs.

## Where the fix differs from the suggestion

- **SM-5:** over-long logical lines are still joined, not cut at 2,000 characters. The scan is now linear, and the lexer reports one `limit`. Cutting would turn each continuation line into its own error line.
- **SM-9:** `CheckedLine.reads` now lists only the inputs of the value rule, as the invariant in `docs/state-machines.md` L5 and `docs/features/kernel/design.md` 9.2 say (the cycle check follows value edges only). New fields: `rangeReads`, `styleReads`, `styleUsesT` on `CheckedLine`; `styleReads`, `rangeReads`, `styleUsesT` on `CompiledLine`. The kernel builds property rules from these.
- **SM-11:** the same per-value rule is applied to arithmetic (`+ - * / ^`), not only builtins, so `1e308 * 10` next to an `inf` is also `overflow`. `Env.inf` and `Compiler.usesInf` are deleted.
- **SM-13:** builtin calls, field reads and `^` are not constant-folded, instead of versioning compiled lines against `setMathLib`.
- **SM-18 (preview):** an unnamed line is checked under the name the line would get (taken from the `unnamed_object` error), and error positions are moved back onto the typed text. No `pvwN` appears unless no name was offered.
- **SM-8:** `normalise` also closes a text on `„` inside `{…}`, so the normaliser, the splitter and the lexer agree.

## Public surface changes

- `props.ts`: new `own(table, key)`.
- `source.ts`: new `scanLineDepth`, `lastLogicalStart` (not exported from `index.ts`).
- `Env.inf` removed from `runtime.ts`.
- `CheckedLine` and `CompiledLine` gain the optional or read-only fields named above.

## Behaviour changes worth knowing

- A line that starts with blank lines reports `ParsedLine.line` as the line of its first non-blank physical line.
- `1/-2x` and `1/+2x` give `ambiguous_implicit`.
- A text longer than 10,000 characters at run time is undefined with reason `limit`.
- `ncr` and `npr` overflow earlier, with the same reason `overflow`.

# Round 3: checker findings LANG-SM-9 (reopened), 22, 23, 24

The four findings are `fixed` in `handoff/language/findings.md`. `npm run lint` and `npm run typecheck` pass. `npx vitest run packages/kernel/test/spec`: 1,197 of 1,198 pass; the one failure is contested below.

## Fixes

| Finding | Fix | Where |
|---|---|---|
| SM-9 | `apart` saves and restores `hasCommand` with `reads` and `usesT` | `check.ts` |
| SM-22 | `list-num`: an element that overflows from finite inputs makes the list undefined with `overflow`. `pointwise`: an infinity from finite inputs is `overflow`; one that follows an infinite input is a value; `inf - inf` is `not_finite`; an undefined input is `input_undefined` | `compile.ts` |
| SM-23 | Ruling SM-23. `checkCycle` runs `findPath` from the value, range and style reads together, in define, function, rerange and restyle lines. `ScratchFigure` records all three as inputs, so an object that a range or style reads is found when it is redefined | `lines.ts`, `figure.ts` |
| SM-24 | `hexColourLength(text, i)` is the one test for a colour: `#` and 3, 4, 6 or 8 hex digits, not followed by a name character, after a single `=` (blanks between; not `==`, `<=`, `>=`, `!=`). `normalise` copies the colour and stays in code, `scanLineDepth` skips it, the lexer reads it as a name | `source.ts`, `lexer.ts` |
| Split flag | `styleUsesT` is true only for a style value that reads the clock; new `rangeUsesT` is true only for a range bound that does. Both are on `CheckedLine` and `CompiledLine`; the kernel re-runs only the rule that reads `t` | `check.ts`, `lines.ts`, `compile.ts` |

## Behaviour changes worth knowing

- A hex colour on a new line directly after `=` (`=\n#ff0000`) is now a comment in the lexer too. Before, the lexer read it as a colour while the other two scanners did not.
- In function arithmetic, `f / g` where `g(x) = 0` with finite inputs reports `overflow`, not `not_finite`.
- Restyle (`P with …`) and rerange (`a in …`) lines now run the cycle test, so `a in 0..a` and `P with showIf = P.x > 0` are `cycle`.

## Contested test

`packages/kernel/test/spec/language/regressions.test.ts`, "LANG-SM-24: a colour, then several properties with a Unicode minus", uses `size = 3 − 1`. `size` is not a property (`props.ts` `PROPERTIES`; the property list in `docs/features/language/design.md`), so the line fails with `unknown_property` for a reason unrelated to the finding. The same line with `pointSize = 3 − 1` passes. The test should use `pointSize`.

## Not updated

`docs/state-machines.md` belongs to the checker; L1, L2, L3, L5, L7 and L8 still describe the open state of these four findings.

# Round 4: checker findings LANG-SM-24, 25, 26, 27

All four findings are `fixed` in `handoff/language/findings.md`.

## Fixes

| Finding | Fix | Where |
|---|---|---|
| SM-27 | Ruling SM-23 (narrowed): `checkCycle` follows value and range reads only. `checkRestyle` no longer runs it. `ScratchFigure` stores value and range reads as an object's inputs; style reads stay on `CheckedLine` for the kernel | `lines.ts`, `figure.ts` |
| SM-24 | `hexColourLength` skips every character `normalise` rewrites to a space; the set is built from `REPLACE`, so the two cannot drift | `source.ts` |
| SM-25, SM-26 | One arithmetic rule on every path (below) | `compile.ts`, `builtins.ts` |

## The arithmetic rule

Division by zero gives `division_by_zero`. Finite inputs that overflow give `overflow`. An infinity is a value only when an input was infinite. A result that is not a number from numeric inputs (`inf - inf`, `0 * inf`) gives `not_finite`. An undefined operand gives `input_undefined`. A list, point or vector with any undefined part is undefined as a whole; it is never stored as a defined value.

## Paths checked

- Number `+ - * / ^`: already followed the rule; `guardInf` now also sets `not_finite` for a NaN made from numeric inputs.
- Number negation, `fact`, the Number built-ins (`fin`): unchanged, they already followed the rule.
- `num*vec`, `vec*num`, `vec/num`, `vec+vec`, `pt+vec`, `vec-vec`, `pt-vec`, `pt-pt`: per coordinate `guardInf`; zero divisor is `division_by_zero`; an undefined operand is `input_undefined`.
- Vector negation: an undefined operand is `input_undefined`.
- `list-num` (`+ - * / ^`): zero divisor and any undefined or overflowing item make the whole list undefined with the matching reason.
- `fn` (function with function or Number, `^`, `/`): `pointwise` now takes the operator; zero divisor and `0 ^ negative` are `division_by_zero`, negative base with fractional exponent is `out_of_domain`, overflow and `not_finite` as above; an undefined Number operand makes the function undefined.
- Function negation: an undefined function operand is `input_undefined` (it used to throw inside `evaluate`).
- Polar point `(r; a)`: infinite angle is `not_finite`; coordinates go through `guardInf`.
- Point literal: undefined coordinate gives `input_undefined` unless a reason is set.
- List literal (Number and other item types): any undefined item makes the list undefined.
- Fields (`.length`, `.area`, `.perimeter`, `.point`, ...): an infinity or NaN from an object with only finite numbers is `overflow` or `not_finite`; `Line.point` of a line with no direction is `division_by_zero`.
- Built-ins with a `call` that return a Number: the infinite-input test now looks inside points, vectors and lists (`norm`, `dot`, `cross`).
- `unit`: infinite vector is `not_finite`; a length that overflows from finite parts is computed from the scaled vector instead of giving `(0, 0)`.
- Text parts: no arithmetic of their own; the parts' expressions are compiled by the paths above.
- Not changed: derivative ticks (`f'(x)`), ranges `[a..b]` (bounds and step must be finite, size limited), index, conditional, relation coefficients, commands (run by the kernel).

## Behaviour changes worth knowing

- `L / 0` and `[1, 1/0]` are undefined, not a list holding undefined items.
- `-f` with `f` undefined is `input_undefined`.
- `P with showIf = P.x > 0` and `a with opacity = a / 20` are accepted; `a in 0..a` and `a = 3 in 0..b` with `b = a + 1` are still `cycle`.

## Checks

`npm run lint` and `npm run typecheck` pass; `npx vitest run packages/kernel/test/spec`: 1,323 of 1,323 pass. No contested tests.
