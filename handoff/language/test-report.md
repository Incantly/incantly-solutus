# Test report: language area

Tester: fresh agent, step 2 of `docs/process/pipeline.md`. Tests were written from `docs/` and the public API only (`@incantly/kernel`). No file under `packages/kernel/src/` and no `builder-notes.md` was read.

Command: `npx vitest run packages/kernel/test/spec`

| | Count |
|---|---|
| Total | 1048 |
| Passed | 1000 |
| Failed | 48 |

`npm run typecheck` and `eslint packages/kernel/test` are clean.

Tests live in `packages/kernel/test/spec/language/`:

| File | Covers |
|---|---|
| `grammar.test.ts` | line kinds, precedence, associativity, implicit multiplication, normalisation, continuation lines, ranges, sliders, rate rules, lists, `if`, edge cases |
| `names.test.ts` | reserved names, valid names, Greek, case, parameters and scope, `suggestName`, `closestNames` |
| `definitions.test.ts` | what a definition makes, equations versus assignments, operator table, fields, unit tag, type helpers |
| `commands.test.ts` | argument matching, named arguments, binders, rest and optional parameters, closest-form diagnosis, `checkTable`, `formText` |
| `builtins.test.ts` | every documented function and constant, values, undefined reasons, evaluation |
| `errors.test.ts` | one input per error kind with phase, code, line, col, endCol and token; `fix`; compact size; limits; UTF-16 columns; notices; `with` properties |
| `redefinition.test.ts` | redefinition rules, type change, cycle, `breaks_dependents`, atomic failure |
| `tooling.test.ts` | previews, signature help, completion, syntax colouring |
| `agent.test.ts` | the worked lessons in `agent.md`, the language card, the printer |
| `robustness.test.ts` | empty input, very long and deep input, 4,000 random junk lines, 1,500 mutated lines, purity, determinism |
| `performance.test.ts` | parse plus check timing, apply, preview, completion with 5,000 objects, evaluation speed |

Performance: parse plus check of a typical line averages about 0.008 ms over 10,000 lines (target 0.2 ms, fail above 0.5 ms). All performance tests pass.

Entries marked `doc-question` fail because the docs contradict each other or are unclear. They need a ruling from the product owner and a doc fix, not a code change. Several tests are also tagged `[doc-question]` in their names.

## Doc questions (the docs disagree with themselves)

| # | Where | Question |
|---|---|---|
| Q1 | `design.md` 1.2 vs 3.6 and `core` 3 | 1.2 shows `f(x) = m (x - A.x) + A.y` as a good line. 3.6 and core 3 say implicit multiplication happens only after a number literal and "a name followed by `(` is a call". |
| Q2 | `design.md` 3.5 vs 3.6 | 3.5 says `(1/2)x` is fine, and `errors.md` offers `(1/2) x` as a quick fix. 3.6 says `)` followed by a name is `missing_operator`. |
| Q3 | `design.md` 3.5 vs 3.10 rule 1 | 3.5 says `undefined and false` is `false`. Rule 1 types the `undefined` literal as `Number`, so `and` with a Bool is a type error. |
| Q4 | `README` 7 vs `design.md` 3.14 | README: `Number` may be `±inf`. 3.14: `inf` is "never stored as a result". |
| Q5 | `errors.md` 5 example vs `design.md` 3.11 step 6 | The `Circle(A, 2, 3)` example lists the 3-point form first with problems at argIndex 1 and 2. Step 6 says the closest form has the fewest problems, which is the radius form (one extra argument). |
| Q6 | `docs/design/formula-language-and-kernel.md` 9 vs `errors.md` 5 | The core example for `Circle(A, B, 2)` points at the one argument (col 12, token `2`). The `errors.md` example spans the whole call (col 5, token `Circle(A, 2, 3)`). |
| Q7 | `README` 3 and `errors/design.md` 4 vs `errors.md` 5 and core 9 | A wrong argument count is its own kind `arg_count` in one place and `no_matching_form` in the other. `errors.md` also lists `bad_arity`, which is not in the shared `ErrorKind` list. The implementation uses `arg_count`. |
| Q8 | `design.md` 3.1/3.3 vs shared `ErrorKind` | The docs name `bad_char`, `too_long` and `too_deep`. The shared list has `bad_character` and `limit`. The tests follow the shared list. |
| Q9 | `design.md` 3.9 vs `errors.md` 3 | `3x + 4y = 12` is `syntax` with expected `["=="]` in 3.9, and `assign_in_expr` in `errors.md`. The `errors.md` example JSON also has `col 8, endCol 9`, which is a space in `3x + 4y = 12`; the `=` is at col 9. |
| Q10 | `errors.md` 2 vs `design.md` 3.3 | `errors.md` lists `1e+` as `bad_number` ("exponent has no digits"). 3.3 says an exponent counts only when digits follow, so `1e+` reads as `1 * e +`. |
| Q11 | `errors.md` 4 vs `design.md` 3.6 | `bad_name` lists "leading digit". `1a = 1` reads as the expression `1 * a`. |
| Q12 | `errors/design.md` 3.3 vs `errors.md` 3 | A zero-width error has `token === ""` in one place and `token` = `end of line` in the other. Not tested. |
| Q13 | `errors/design.md` 5.2 vs `errors.md` 4 | One error per line in the first, up to 8 (`more`) in the second. The tests follow `errors.md` (the language area is more specific). |
| Q14 | `errors.md` 1 vs `errors/design.md` 3 | The relation between `fix` and `suggest` is not stated. The test expects every `fix` to also be in `suggest`. It passes. |

## Failing tests

Each entry: test name (file), the doc section and sentence, the input, what the test expected, and what came back.

### A. Syntax and lexing

1. **`an integer literal above 2^53 warns precision_loss once`** (`grammar.test.ts`)
   - `design.md` 3.13: "`precision_loss`: an integer literal above 2^53 was rounded." Also `errors.md` 8: "the literal warning `precision_loss` appears once, at definition."
   - Input: `n = 9007199254740993`
   - Expected: success with one notice of kind `precision_loss`.
   - Got: success with no `precision_loss` notice. `1e-400` does give the notice.

2. **`a missing argument before a comma is syntax; expected has expression and )`** (`grammar.test.ts`)
   - `errors.md` 3, "Example, `syntax` with expectations": `expected: ["expression", ")"]`.
   - Input: `c = Circle(A,, 2)`
   - Expected: `syntax` at col 14, token `,`, expected containing `expression` and `)`.
   - Got: position and token as expected; `expected` is `["expression"]` only.

3. **`ui.md 9 a square-bracket command call is syntax with a mechanical fix`** (`grammar.test.ts`)
   - `ui.md` 9: "Pasting a GeoGebra-style line such as `A:(1,2)` or `Circle[A, 2]` gives a `syntax` error with a `fix` in our form when the rewrite is mechanical."
   - Input: `c9 = Circle[A, 2]`
   - Expected: `syntax` with `fix` = `c9 = Circle(A, 2)`.
   - Got: `syntax`, `fix` undefined. (`A9: (1, 2)` and `A9 := 3` do get their fixes.)

4. **`errors.md 3 unnamed_object: a bare object command, value or expression`** (`grammar.test.ts`)
   - `errors.md` 3: "`fix` is the same line with the suggested name in front (`c = Circle(A, 2)`)". `design.md` 3.7: Circle takes `c d k`.
   - Input: `Circle(A, 2)` in a figure that has `A` only.
   - Expected: `fix` = `c = Circle(A, 2)`.
   - Got: `fix` = `a = Circle(A, 2)`, which does not pass: `a` is read as a Number name. The same happens in `errors.test.ts` "fix is something that would pass the same checks: Circle(A, 2)", where `a` already exists and the fix fails with `type_change`.

5. **`bad_number: a lone point`** (`errors.test.ts`)
   - `errors.md` 2: `bad_number` when "`1.2.3`, `1e+`, `1e999`, `1__0`, `.`, `5.` followed by a name".
   - Input: `n = .`
   - Expected: `bad_number`.
   - Got: `syntax`.

6. **`[doc-question Q10] bad_number: an exponent with no digits`** (`errors.test.ts`)
   - Input: `n = 1e+`; expected `bad_number`; got `syntax`.

7. **`limit: nesting deeper than 64 is refused before recursion`** (`errors.test.ts`)
   - `design.md` 3.3: "Maximum nesting depth 64 (brackets and calls)."
   - Input: `n = ` + 64 `(` + `1` + 64 `)`
   - Expected: accepted (64 is the maximum). 60 levels are accepted; 65 and 200 are refused with `limit`.
   - Got: 64 levels refused.

8. **`unbalanced: n = (1 + 2` and `unbalanced: n = 1 + 2)`** (`errors.test.ts`)
   - `design.md` 3.1: step 2 (parse) failure kinds include `unbalanced`.
   - Expected: `phase` = `parse`. Position, token, `fix`/hint are as expected.
   - Got: `phase` = `lex` for both.

9. **`errors.md 1: hint is always present and never empty`** (`errors.test.ts`)
   - `errors.md` 1: "`hint` is always present, never empty."
   - Inputs: `n = (1 + )` and `n = * 2` (both `syntax`).
   - Got: `hint` undefined.

### B. Fixes and diagnosis

10. **`fix is something that would pass the same checks: n = ab`** (`errors.test.ts`) and **`3.6 "ab" is one name ... unknown_name`** (`grammar.test.ts`)
    - `errors.md` 4, "Example, an unknown name that is a product of known names": `hint` "a and b both exist. Did you mean a * b?", `fix` `p = a * b`.
    - Inputs: `p = ab`, `n = ab` with `a` and `b` defined.
    - Expected: `fix` = `p = a * b`.
    - Got: `unknown_name` at the right span, hint contains `a * b`, `fix` undefined.

11. **`fix is something that would pass the same checks: x = A.x`** (`errors.test.ts`) and **`agent.md 5.2 x = P.x is refused with the fix px = P.x`** (`names.test.ts`), **`... x = P.x fails with reserved_name and the fix is accepted`** (`agent.test.ts`)
    - `agent.md` 5.2: the error for `x = P.x` has `"fix": "px = P.x"`.
    - Input: `x = P.x` (`P` a Point).
    - Expected: `reserved_name` at col 1-2 with `fix` = `px = P.x`.
    - Got: `reserved_name` at col 1-2, `fix` undefined.

12. **`3.11 step 1: a named argument for a parameter already bound by position is duplicate_arg`** (`commands.test.ts`)
    - `design.md` 3.11 step 1: "A named argument after a positional one that is already bound to the same parameter is `duplicate_arg`."
    - Input: `d = Distance(A, a = B)`
    - Expected: `duplicate_arg`.
    - Got: `arg_count`. (`Circle(center = A, center = B)` does give `duplicate_arg`.)

13. **`errors.md 4 not_a_binder: a binder position that is not a bare name`** (`commands.test.ts`)
    - `errors.md` 4: `not_a_binder`, "A binder position got something other than a bare name"; `expected: ["name"]`.
    - Input: `S9 = Seq(2, 3, 1, 5)`
    - Expected: `not_a_binder` at col 13-14, token `3`, expected `["name"]`.
    - Got: `no_matching_form`.

14. **`errors.md 4 not_a_binder: the doc example Seq(k^2, 3, 1, 5)`** (`commands.test.ts`)
    - Input: `S9 = Seq(k^2, 3, 1, 5)`
    - Expected: `not_a_binder` among the main error and `more`.
    - Got: only `unknown_name` for `k`. (`k` is unknown because the binder position holds `3`; the doc example expects `not_a_binder` to be reported.)

15. **`[Q5] 3.11 step 6: the closest form has the fewest problems`** (`commands.test.ts`) — doc-question.
    - Input: `c = Circle(A, 2, 3)`. By step 6 the radius form has one problem (an extra argument) and the other two have two.
    - Expected: `forms[0]` = `Circle(center: Point, radius: Number) -> Circle`, one problem, `argIndex` 2, `got` `extra`.
    - Got: `forms[0]` = the 3-point form (this matches the `errors.md` example). The sibling test `[Q5] errors.md 5 example ...` passes.

16. **`[Q6] errors.md 5 no_matching_form: the token spans the whole call`** (`commands.test.ts`) — doc-question.
    - Input: `d = Distance(A, 5)`. Expected col 5, token `Distance(A, 5)` (the `errors.md` example). Got col 17 (the argument), as in the core design example.

17. **`errors.md 5: c9 = Circle(A, 2, 3) compact size`** (`errors.test.ts`)
    - `errors/design.md` 3.5: "An error object must serialise to at most ~800 characters in the compact form sent to a model."
    - Input: `c9 = Circle(A, 2, 3)`; compact form built by the rules in 3.5 (drop `source`, `forms` to 4, `expected` to 8, `suggest` to 3).
    - Expected: at most 900 characters (800 plus slack).
    - Got: 961. Other kinds (`syntax`, `unknown_name`, `type_mismatch`, `reserved_name`, `Many(A)` with eight forms) are within 900.

### C. Names, reserved words, suggestions

18. **`keyword and / or / not / xor / if / in / step / with is reserved_name`** (8 tests, `names.test.ts`)
    - `design.md` 3.7 and `errors.md` 4: keywords `true false and or not xor if in step with` are "refused for objects (`reserved_name`)".
    - Input: `<keyword> = 1`
    - Expected: `reserved_name` at col 1.
    - Got: `and`, `or`, `xor`, `in`, `step`, `with` give `syntax`; `not` and `if` give `assign_in_expr`. `true` and `false` do give `reserved_name`.

19. **`3.7 every built-in function name is reserved`** (`names.test.ts`)
    - Same sentence, for the function names. Only `step` fails (it is also a keyword): got `syntax`. Every other built-in gives `reserved_name`.

20. **`[Q11] 1a = 1`** (`names.test.ts`) — doc-question. Expected `bad_name`; got `assign_in_expr`.

21. **`3.7 a type given as text with a parameter is understood too`** (`names.test.ts`)
    - `names.d.ts`: `suggestName(type: Ty | TypeName | string, ...)`; `design.md` 3.7: List gives `L M N`.
    - Input: `suggestName('List<Number>', new Set())` and `suggestName('Function<Number>', ...)`.
    - Expected: `L` and `f`. Got: `obj1`. (The `Ty` form `listOf(T.Number)` and the plain `'List'` work.)

22. **`reserved names are skipped`** (`names.test.ts`)
    - `design.md` 3.7: "The first free name in the sequence wins. Names reserved or taken are skipped."
    - Input: `suggestName('List', new Set(['L']), { commands })` where the command table has a command named `M`.
    - Expected: `N`. Got: `M`.

### D. Equations and types

23. **`c9 = (x - a)^2 + (y + b)^2 == 16 is a Circle`** (`definitions.test.ts`)
    - `design.md` 3.9: "`(x - h)^2 + (y - k)^2 == r2` with `r2 > 0` | Circle". `3.9` also says the expansion keeps expression coefficients.
    - Input: `c9 = (x - a)^2 + (y + b)^2 == 16`, with `a` and `b` Numbers.
    - Expected: type `Circle`, shape `circle`.
    - Got: `Curve`. (The same shape with literal centres, such as `(x - 1)^2 + (y - 2)^2 == 9`, is a Circle.)

### E. Built-ins

24. **`gcd(1.5, 3)` and `lcm(2.5, 3)` are undefined with reason out_of_domain** (`builtins.test.ts`)
    - `design.md` 3.14, Modular: "`gcd`/`lcm` on non-integers: `out_of_domain`."
    - Expected `out_of_domain`; got `not_integer`.

25. **`one-argument log(x) is refused with a hint to use ln, log10 or log2`** (`builtins.test.ts`)
    - `design.md` 3.14: "One-argument `log(x)` is refused: `no_matching_form` with hint 'use ln, log10 or log2'."
    - Input: `out = log(100)`
    - Expected: hint matching `ln, log10 or log2`. The kind may be `no_matching_form` or `arg_count` (see Q7).
    - Got: kind `arg_count`, hint "Add the missing x: log(base: Number, …".

26. **`[Q4] out = inf`** (`builtins.test.ts`) — doc-question. Expected a defined Number `Infinity` (README 7); got undefined.

### F. Table checks

27. **`checkTable rejects overlapping aliases where neither is more specific (Shape and Path)`** and **`checkTable names the offending command when one of several is ambiguous`** (`commands.test.ts`)
    - `design.md` 3.11 step 5 and `checkTable` description: "for every pair of forms that can both accept the same arguments, one must be strictly more specific."
    - Input: command `Over` with forms `(a: Shape)` and `(a: Path)`. They overlap on `Segment`, `Ray`, `Line`, `Circle`, `Arc` and `Curve`; `Path` also holds `Function`, `Shape` also holds `Point`, `Polygon` and `Vector`, so neither contains the other.
    - Expected: at least one `TableProblem` with `command` = `Over`.
    - Got: `[]`. (Identical forms and `Number|Point` against `Point|Vector` are rejected, and a concrete type next to its alias is accepted, as expected.)

### G. Editing aids

28. **`case-insensitive prefix, subsequence and typo matches find the command`** and **`prefix match outranks case-insensitive prefix, which outranks a subsequence match`** (`tooling.test.ts`)
    - `design.md` 3.18 ranking: "word-boundary subsequence (`mp` matches `Midpoint`), 500".
    - Input: `complete('M9 = mp', 7, fig)` and `complete('x9 = sgm', 8, fig)`.
    - Expected: `Midpoint` and `Segment` in the list. Got: neither. (Prefix, case-insensitive prefix and the typo match `Cirlce` -> `Circle` work.)

29. **`after @: directive names`** (`tooling.test.ts`)
    - `design.md` 3.18 table: "After `@` | Directive names".
    - Input: `complete('@', 1, fig, { limit: 20 })`.
    - Expected: `view`, `grid`, `axes`, `beat`, `clock`, all of kind `directive`.
    - Got: an empty list. (`@vi` gives `view`.)

30. **`a binder or parameter inside a call is not marked unknown`** (`tooling.test.ts`)
    - `ui.md` 2: "Colouring is done from the lexer plus the resolver's classification." "Unknown name | red | squiggle underline".
    - Input: `tokenize('S9 = Seq(k^2, k, 1, 5)', fig)` and `tokenize('h9(x) = x^2', fig)`.
    - Expected: the binder `k` and the parameter `x` are not `unknown`.
    - Got: every `k` and every `x` has `kind` = `unknown`.

### H. Doc-question tests that fail (Q1 to Q3)

31. **`[Q1] "f(x) = m (x - A.x) + A.y" is written as a good line in 1.2`** (`grammar.test.ts`). Got `not_callable` at col 8-9: "m is a Number, not a function or command." The implementation follows core 3 and 3.6.
32. **`[Q2] (1/2)x is fine`** (`grammar.test.ts`). `out = (1/2) a` gives `missing_operator`; the implementation follows 3.6. The opposite test, `[Q2] ... missing_operator`, passes.
33. **`[Q3] "undefined and false" is false`** (`grammar.test.ts`). `out = undefined and false` gives `type_mismatch` "Cannot use and on a Number and a Bool". The same logic on undefined Bools (`(sqrt(-1) > 0) and false`) works.

## What passes (summary)

- All line kinds parse to the right node; precedence, associativity, `-2^2`, `2^-1`, right-associative power, postfix `!` and `°`, and chains behave as 3.5 says.
- Implicit multiplication after number literals (`2x`, `2e3`, `2e`, `2sin(pi/6)^2`, `3(a+1)`, `0.5 pi`, `2 Distance(A, B)`), and the errors for `a b`, `2 3`, `1/2a`, `a/2b`, `6/2(3)`.
- Normalisation (`−`, `×`, `÷`, `≤`, `π`, `²`, `⁻¹`, `√`, NBSP, smart quotes) with columns in the text as typed.
- Continuation lines, comments, directives, `with`, ranges, sliders, rate rules, `state(...)`.
- Every row of the "what a definition makes" table except the dynamic-centre circle; Line, Circle, Curve and Region classification; the operator table; fields; the unit tag.
- Command matching: exact forms, named arguments, binders, rest and optional parameters, closest-form diagnosis with `problems` (positions are right), `forms` ordering for the core example `Circle(A, B, 2)`.
- Over 200 built-in values and undefined reasons; first-reason-wins; `input_undefined` with `via`; `t`, `bt`, `beat`.
- Every error kind in `errors.md` except those listed: kind, code, phase, line, col, endCol, token, UTF-16 columns with emoji and NFC, limits (line, tokens, depth 65, objects 5,000, parameters 4, arguments 16, range 100,000).
- Redefinition, `type_change`, `cycle` with path, `breaks_dependents` with the list of dependents and no change to the figure, atomic failure, `blockedBy` and `fix_earlier` in batches.
- Previews, signature help, completion (other than the items above), syntax colouring columns.
- Robustness: 4,000 random junk lines, 1,500 mutated lines, 600 multi-line blobs, a one-million-character line and 100,000 nested brackets never throw; error positions and tokens are consistent with the input; analysis never changes the figure; results are deterministic.
