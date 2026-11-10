# Language rulings

Answers to the contradictions the language tester found (Q1 to Q14 in `handoff/language/test-report.md`). These rulings win over `design.md`, `errors.md` and `agent.md` in this folder, and over `docs/features/errors/` where they touch the language.

| # | Question | Ruling |
|---|---|---|
| Q1 | `m (x - A.x)` | Not allowed. Implicit multiplication only follows a number literal (3.6). A name followed by `(` is a call; if the name is not callable the error is `not_callable` with the fix `m * (x - A.x)`. The 1.2 example is wrong. |
| Q2 | `(1/2)x` | Not allowed: `)` followed by a name is `missing_operator`. The quick fix is `(1/2) * x`, not `(1/2) x`. |
| Q3 | `undefined and false` | The literal `undefined` is a `Number` (3.10 rule 1). `undefined and false` is `type_mismatch`. The 3.5 example is wrong. |
| Q4 | Storing `inf` | README decision 7 wins: `out = inf` stores positive infinity, and `inf` may appear in any Number position. Arithmetic on finite numbers that overflows (`10^400`, `fact(200)`) gives undefined `overflow`; `not_finite` is for results that are not numbers at all, such as `inf - inf`. |
| Q5 | Closest form | First prefer forms whose argument count fits; among them, the fewest problems. Only if no form fits the count, take the fewest problems overall. So for `Circle(A, 2, 3)` the three-point form comes first, as in the `errors.md` example. |
| Q6 | Span of `no_matching_form` | When the count fits and one argument has the wrong type, the span and token are that argument. When the count does not fit any form, or more than one argument is wrong, the span is the whole call. `Distance(A, 5)`: col 17, token `5`. |
| Q7 | Wrong argument count | Its own kind, `arg_count`, from the shared list. `bad_arity` does not exist. `no_matching_form` is for type problems with a fitting count. |
| Q8 | Kind names | The shared list wins: `bad_character` (not `bad_char`) and `limit` (not `too_long` or `too_deep`), with the specific limit in `params`. |
| Q9 | `3x + 4y = 12` | `assign_in_expr` at the `=` (col 9, endCol 10), `expected: ["=="]`, fix `3x + 4y == 12` wrapped as the line kind it needs, for example `l = Line(3x + 4y == 12)`. |
| Q10 | `1e+` | 3.3 wins: an exponent needs digits after `e`, `e+` or `e-`; otherwise `e` is the constant. `n = 1e+` is `syntax` (missing operand after `+`), not `bad_number`. |
| Q11 | `1a = 1` | A line whose first token is a number directly followed by a name and then a top-level `=` is `bad_name` ("A name cannot start with a digit"), with the fix `a1 = 1`. |
| Q12 | Zero-width token | `token` is `""`; the message may say "end of line". |
| Q13 | Errors per line | One main error per line, plus up to 7 more in `more` (8 in all), as `errors.md` says. |
| Q14 | `fix` and `suggest` | Every `fix` is also the first entry of `suggest`. |
| Depth | Nesting limit | Depth 64 is allowed; 65 or more is `limit`. |
| Sliders | `inf` as a slider bound | Slider bounds must be finite. `a = 3 in 0..inf` is `bad_range` with the hint to pick a finite bound. |
| SM-23 | A slider range that reads the slider | A range bound may not read the slider itself or anything downstream of it. `a = 3 in 0..a` and `a = 3 in 0..b` with `b = a + 1` are `cycle`, with `path` showing the chain. Only range edges join the cycle test. Style edges never form a cycle (kernel design 9.2): a style may read its own object or its dependents, so `P with showIf = P.x > 0` and `a = 3 in 0..20 with opacity = a / 20` are accepted. Only value edges decide free versus dependent. |
| Q-R4-1 | A defining line's style reading its own name | Option (a), chosen by the product owner. In the `with` list of a defining line, the name being defined resolves to the new object, so `P9 = (1, 2) with showIf = P9.x > 0` and `c1 = (1, 2) with opacity = c1.x / 10` are accepted on a figure without `P9` or `c1`. No cycle edge is added (style edges never form a cycle). A range bound on a defining line still may not read the name: `k = 3 in 0..k` is `unknown_name` on a new name and `cycle` once `k` exists. Saved figures may keep self-reading styles on the defining line. |
