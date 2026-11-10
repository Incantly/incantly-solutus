# Test report: language area

Tester: fresh agent, steps 2 and 4 of `docs/process/pipeline.md`. Tests were written from `docs/` and the public API only (`@incantly/kernel`). No file under `packages/kernel/src/` other than `contracts/`, and no `builder-notes.md` or `fixer-notes.md`, was read.

Command: `npx vitest run packages/kernel/test/spec`

| | Count |
|---|---|
| Total | 1070 |
| Passed | 1062 |
| Failed | 8 |

`npm run typecheck` and `eslint packages/kernel/test` are clean.

The fixer was changing `packages/kernel/src/` while this run was made, so the failing list is a snapshot. Rerun the command for the current state.

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

## Rulings applied

`docs/features/language/rulings.md` answered Q1 to Q14 and the nesting depth. No test carries the `doc-question` tag any more. Each test that follows a ruling has `rulings.md Qn` (or `rulings.md Depth`) in its name.

| Ruling | Tests |
|---|---|
| Q1 | `grammar`: `m (x - A.x)` is `not_callable` at col 8 with a fix using `m * (...)`; the `*` version is a good line; `a (2)` and `a(2)` are `not_callable` |
| Q2 | `grammar`: `(1/2) a` and `(1/2)a` are `missing_operator` with fix `out = (1/2) * a`; the `ambiguous_implicit` quick fixes are `h = (1/2) * a` and `h = 1/(2a)`, never `(1/2) a` |
| Q3 | `grammar`: `undefined and false`, `undefined or true`, `true and undefined`, `not undefined` are `type_mismatch` |
| Q4 | `builtins`: `out = inf` and `hi = inf` store `Infinity`, `lo = -inf` stores `-Infinity`; `inf` in a command argument, a point, a list, `min` and comparisons; finite overflow stays undefined |
| Q5 | `commands`: `Circle(A, 2, 3)` lists the 3-point form first (errors.md 5 example, columns included); `Midpoint(A, 2)`; `Midpoint(A, B, C)` takes the fewest problems because no form fits |
| Q6 | `commands`: `Distance(A, 5)` col 17 token `5`; `Circle(A, B, 2)` token `2`; `Circle(s, 2)` token `s`; count fits no form gives the whole call (`Distance(A)`, `Distance(A, B, C)`, `Circle()`, `Hide()`); the errors.md 5 example `Circle(A, 2, 3)` with two wrong arguments spans the whole call |
| Q7 | `commands`, `builtins`, `definitions`: wrong count is `arg_count`, type problem with a fitting count is `no_matching_form`, `bad_arity` is never raised; `ERROR_KINDS` has `arg_count` and no `bad_arity` |
| Q8 | `errors`: kind `limit` with the limit in `params` for a long line and for nesting; `bad_char`, `too_long`, `too_deep` are not kinds |
| Q9 | `grammar`: `3x + 4y = 12` is `assign_in_expr` at col 9-10, expected `==`, fix wraps `3x + 4y == 12` in a named line and the fix makes a `Line` |
| Q10 | `errors`: `1e+` and `1e-` are `syntax` at col 8 with token `""`; `1e` is `1 * e`; `1e+2` is 100; `2e+a` is `2 * e + a` |
| Q11 | `names`: `1a = 1` is `bad_name` with fix `a1 = 1`; `2x = 3` is `bad_name`; `n9 = 1a` and `f9(x) = 2x` stay valid |
| Q12 | `errors`: a zero-width error has `endCol === col` and `token === ""` |
| Q13 | `commands`: 20 unknown names give one main error and 7 or 8 in `more`, in order; one mistake gives no `more` |
| Q14 | `errors`: for every input with a `fix`, `suggest[0]` is the `fix` |
| Depth | `errors`: depth 60 and 64 pass, 65 and 200 are `limit`, 70 nested calls are `limit` |

Two readings the tests accept either way, because the docs do not settle them:

- Q13: the ruling says "up to 8 more", `errors.md` 6 says "1 + 7 in `more`". The test accepts 7 or 8.
- Q4: the ruling says overflow of finite arithmetic gives `not_finite`; `errors.md` 8 gives `overflow` for `10^400` and `fact(200)`. The Q4 overflow test accepts either reason. The `10^400` and `fact(200)` tests keep `overflow`, and `inf - inf` keeps `not_finite`.

## Failing tests

Each entry: test name (file), the doc or ruling, the input, what the test expects, and what came back.

1. **`rulings.md Q4: out = inf stores positive infinity`** (`builtins.test.ts`)
   - Ruling Q4, README decision 7. Input: `out = inf`. Expected: a defined Number with value `Infinity`. Got: undefined, reason `not_finite`.
2. **`rulings.md Q4: -inf is stored as negative infinity, and a stored inf is a defined Number`** (`builtins.test.ts`)
   - Ruling Q4. Input: `lo = -inf`, then `hi = inf`. Expected: both defined, values `-Infinity` and `Infinity`, type `Number`. Got: `lo = -inf` is undefined, reason `not_finite`.
3. **`rulings.md Q2: the quick fix for (1/2)x is (1/2) * x, never (1/2) x`** (`grammar.test.ts`)
   - Ruling Q2. Input: `h = 1/2a` (`ambiguous_implicit`). Expected: quick fix lines include `h = (1/2) * a` and `h = 1/(2a)`. Got: `['h = (1/2) a', 'h = 1/(2a)']`.
4. **`errors.md 3 unnamed_object: a bare object command, value or expression`** (`grammar.test.ts`)
   - `design.md` 3.7: Point names run `A B C ...` and taken names are skipped. Input: `(1, 2)` in a figure that holds `A`. Expected: fix `B = (1, 2)`. Got: `A = (1, 2)`, a taken name. This assertion passed in the first run, so the name suggestion regressed while the `Circle(A, 2)` fix was changed.
5. **`errors/design.md 3.5: the compact form is about 800 characters: c9 = Circle(A, 2, 3)`** (`errors.test.ts`)
   - Input: `c9 = Circle(A, 2, 3)`. Expected: compact form (no `source`, `forms` 4, `expected` 8, `suggest` 3) at most 900 characters. Got: 974.
6. **`case-insensitive prefix, subsequence and typo matches find the command`** and **`prefix match outranks case-insensitive prefix, which outranks a subsequence match`** (`tooling.test.ts`)
   - `design.md` 3.18 ranking: "word-boundary subsequence (`mp` matches `Midpoint`), 500". Input: `complete('M9 = mp', 7, fig)` and `complete('x9 = sgm', 8, fig)`. Expected: `Midpoint` and `Segment` in the list. Got: neither.
7. **`a binder or parameter inside a call is not marked unknown`** (`tooling.test.ts`)
   - `ui.md` 2: only an unknown name is red. Input: `tokenize('S9 = Seq(k^2, k, 1, 5)', fig)` and `tokenize('h9(x) = x^2', fig)`. Expected: the binder `k` and the parameter `x` are not `unknown`. Got: `unknown`.

All other tests pass, including the tests for Q1, Q3, Q5 to Q14 and the depth ruling.

## What passes (summary)

- All line kinds parse to the right node; precedence, associativity, `-2^2`, `2^-1`, right-associative power, postfix `!` and `°`, and chains behave as 3.5 says.
- Implicit multiplication after number literals, and the errors for `a b`, `2 3`, `1/2a`, `a/2b`, `6/2(3)`, `(1/2)a`, `m (x)`.
- Normalisation with columns in the text as typed. Continuation lines, comments, directives, `with`, ranges, sliders, rate rules, `state(...)`.
- Every row of the "what a definition makes" table except the dynamic-centre circle; Line, Circle, Curve and Region classification; the operator table; fields; the unit tag.
- Command matching: exact forms, named arguments, binders, rest and optional parameters, closest-form diagnosis, spans by ruling Q6 for a single wrong argument.
- Over 200 built-in values and undefined reasons; first-reason-wins; `input_undefined` with `via`; `t`, `bt`, `beat`.
- Every error kind in `errors.md` that is not listed above: kind, code, phase, line, col, endCol, token, UTF-16 columns, limits, nesting depth 64 and 65.
- Redefinition, `type_change`, `cycle` with path, `breaks_dependents`, atomic failure, `blockedBy` and `fix_earlier` in batches.
- Previews, signature help, completion (other than the items above), syntax colouring columns.
- Robustness: random junk, mutated lines, huge and deep input never throw; analysis never changes the figure; results are deterministic. Performance: parse plus check of a typical line averages about 0.008 ms (target 0.2 ms).

## Regression tests

`packages/kernel/test/spec/language/regressions.test.ts` holds 253 tests (128 after round 2, see "Round 3 tests"): 86 for the checker's round 1 findings LANG-SM-1 to LANG-SM-21 and 42 added in round 2 for LANG-SM-9 (reopened), LANG-SM-22, LANG-SM-23 and LANG-SM-24 (`handoff/language/findings.md`). They use the public API only. Each finding has at least one test that fails before its fix and passes after it. Hang and memory tests assert a time or size bound.

Round 1 tests (86): all pass on the current worktree (they were checked against commit `35067a3`, where 59 fail and every finding has a failing test). Round 2 tests (42): checked against commit `35e9177` (the last commit before the round 2 fixes), where 32 fail and every round 2 finding has at least one failing test. Run against the worktree while the fixer is still working: 23 of the 42 pass, 19 fail (table at the end of this section).

Notes on two tests that fix a reading the findings leave open:

- LANG-SM-13, constant folding: the test requires a line compiled before `setMathLib` to give the same answer as the same line compiled after it (so folded constants must not outlive the library, whether the fix is not folding or recompiling). A fix that keeps stale compiled lines and only flags them through a new API would need the test changed.
- LANG-SM-13, `gamma`, `beta`, `erf`, `erfc`, function power and range folding: the test installs a `MathLib` whose results are visibly shifted and requires every one of them to change.

| Finding | Tests | Now |
|---|---|---|
| LANG-SM-1 | `LANG-SM-1: a field named like an Object.prototype member is refused` | pass |
|  | `LANG-SM-1: a refused prototype field leaves the name free to be defined later` | pass |
|  | `LANG-SM-1: real fields still work` | pass |
|  | `LANG-SM-1: a property named like an Object.prototype member is unknown_property` | pass |
|  | `LANG-SM-1: a property in a definition clause named like an Object.prototype member is refused` | pass |
|  | `LANG-SM-1: a directive named like an Object.prototype member is unknown_directive` | pass |
|  | `LANG-SM-1: completion after a dot, a `with` and an @ does not offer prototype members` | pass |
| LANG-SM-2 | `LANG-SM-2: preview of ncr(1e8, 5e7) returns within 50 ms and shows overflow` | pass |
|  | `LANG-SM-2: preview of npr(1e8, 1e8) returns within 50 ms and shows overflow` | pass |
|  | `LANG-SM-2: applying ncr and npr with huge arguments is fast and undefined with reason overflow` | pass |
|  | `LANG-SM-2: ordinary ncr and npr values are unchanged` | pass |
| LANG-SM-3 | `LANG-SM-3: doubling a 1,000 character text stops at the 10,000 character limit with reason limit` | pass |
|  | `LANG-SM-3: the same limit holds for text with interpolations` | pass |
|  | `LANG-SM-3: a text of exactly 10,000 characters is allowed` | pass |
| LANG-SM-4 | `LANG-SM-4: redefining the end of a 5,000 object chain without a cycle is accepted` | pass |
|  | `LANG-SM-4: a real cycle through the whole chain is still found` | pass |
|  | `LANG-SM-4: the middle of the chain can be redefined too` | pass |
| LANG-SM-5 | `LANG-SM-5: a program with one never-closed bracket splits in linear time` | pass |
|  | `LANG-SM-5: parseProgram on that text is bounded and reports the first line as an error` | pass |
|  | `LANG-SM-5: splitting still joins a normal multi-line call into one logical line` | pass |
|  | `LANG-SM-5: completion at the end of 10,000 lines under one open bracket stays fast` | pass |
| LANG-SM-6 | `LANG-SM-6: a line with an open bracket and a trailing comment parses quickly` | pass |
|  | `LANG-SM-6: the fix closes the bracket and keeps the comment as a comment` | pass |
|  | `LANG-SM-6: a line without a comment still gets the closers at its end` | pass |
| LANG-SM-7 | `LANG-SM-7: 1,801 tokens inside a text interpolation are over the token limit` | pass |
|  | `LANG-SM-7: tokens in several interpolations add up` | pass |
|  | `LANG-SM-7: a small interpolation is still fine` | pass |
|  | `LANG-SM-7: brackets around a text and inside its interpolation add up to the depth limit` | pass |
|  | `LANG-SM-7: nesting that stays within 64 levels across the text boundary is accepted` | pass |
| LANG-SM-8 | `LANG-SM-8: an unfinished text inside a call does not swallow the lines after it` | pass |
|  | `LANG-SM-8: a string never spans a newline in the splitter` | pass |
|  | `LANG-SM-8: a text closed with a low double quote ends there for the splitter too` | pass |
|  | `LANG-SM-8: a closed text with brackets in it still hides them from the splitter` | pass |
| LANG-SM-9 | `LANG-SM-9: a slider whose range reads a variable is free` | pass |
|  | `LANG-SM-9: after such a slider is made, its range can be changed` | pass |
|  | `LANG-SM-9: a number whose style value reads a variable is free` | pass |
|  | `LANG-SM-9: a point with a showIf rule is free and is stored as free` | pass |
|  | `LANG-SM-9: a value that reads another object is still not free` | pass |
| LANG-SM-10 | `LANG-SM-10: functions sharing an Env keep their own parameters` | pass |
|  | `LANG-SM-10: a relation value keeps x and y while it calls a function in the same Env` | pass |
|  | `LANG-SM-10: the figure gives the same answers` | pass |
| LANG-SM-11 | `LANG-SM-11: exp(1000) beside an unrelated inf in a condition stays undefined with reason overflow` | pass |
|  | `LANG-SM-11: an earlier object holding inf does not make later overflow infinite` | pass |
|  | `LANG-SM-11: a function of an infinite input still gives an infinite result (ruling Q4)` | pass |
|  | `LANG-SM-11: the stored value of inf itself is unchanged` | pass |
|  | `LANG-SM-11: an inf in a style value does not change the overflow of the value` | pass |
| LANG-SM-12 | `LANG-SM-12: undefined + "x" is undefined with a reason` | pass |
|  | `LANG-SM-12: "x" + undefined is undefined with a reason` | pass |
|  | `LANG-SM-12: two defined texts still join` | pass |
| LANG-SM-13 | `LANG-SM-13: the platform library is installed at the start` | pass |
|  | `LANG-SM-13: a folded constant call and a recompiled one agree after the library changes` | pass |
|  | `LANG-SM-13: gamma, beta, erf and erfc use the installed library` | pass |
|  | `LANG-SM-13: a power of a function uses the installed library` | pass |
|  | `LANG-SM-13: folding a range bound uses the installed library` | pass |
|  | `LANG-SM-13: under the platform library the answers are the usual ones` | pass |
| LANG-SM-14 | `LANG-SM-14: 1/2x is ambiguous (control)` | pass |
|  | `LANG-SM-14: 1/-2x is ambiguous_implicit` | pass |
|  | `LANG-SM-14: 1/+2x is ambiguous_implicit` | pass |
|  | `LANG-SM-14: a/-2x is ambiguous_implicit` | pass |
|  | `LANG-SM-14: clear spellings are accepted` | pass |
| LANG-SM-15 | `LANG-SM-15: Fz([], 1) fits the first form (control)` | pass |
|  | `LANG-SM-15: Fz([], A) fits the second form` | pass |
|  | `LANG-SM-15: the order of the forms does not decide` | pass |
|  | `LANG-SM-15: a call that fits no form is still refused` | pass |
| LANG-SM-16 | `LANG-SM-16: an unknown name in the body is reported as unknown_name` | pass |
|  | `LANG-SM-16: the same mistake in a body with a point result is reported too` | pass |
|  | `LANG-SM-16: a good body picks its form` | pass |
| LANG-SM-17 | `LANG-SM-17: an unknown input name is ignored or reported, not thrown` | pass |
|  | `LANG-SM-17: known and unknown inputs together` | pass |
|  | `LANG-SM-17: the figure stays usable after the call` | pass |
| LANG-SM-18 | `LANG-SM-18: leading blank lines count in the line number` | pass |
|  | `LANG-SM-18: an error on a second line points at that line` | pass |
|  | `LANG-SM-18: an error at the end of an interpolation points at the closing brace` | pass |
|  | `LANG-SM-18: preview of an unnamed line reports columns of the text typed` | pass |
|  | `LANG-SM-18: preview of an unnamed line keeps the typed columns when it starts with spaces` | pass |
|  | `LANG-SM-18: the temporary name of a preview never reaches the writer` | pass |
| LANG-SM-19 | `LANG-SM-19: lex reports one bad_character for an emoji` | pass |
|  | `LANG-SM-19: tokenize reports one error and one error token covering the whole character` | pass |
|  | `LANG-SM-19: parseLine gives one error for an emoji in a line` | pass |
|  | `LANG-SM-19: two emoji give two errors` | pass |
| LANG-SM-20 | `LANG-SM-20: a reader of P_1 is blocked by a failed P_{1} line` | pass |
|  | `LANG-SM-20: a reader of P_{1} is blocked by a failed P_1 line` | pass |
|  | `LANG-SM-20: plain subscripts keep working (control)` | pass |
| LANG-SM-21 | `LANG-SM-21: tokens are returned for every line of a script over 2,000 characters` | pass |
|  | `LANG-SM-21: columns restart on every line` | pass |
|  | `LANG-SM-21: a single line over 2,000 characters is still reported as a limit` | pass |

Round 1 findings, all tests pass now: LANG-SM-1 to LANG-SM-21.

Round 1 findings with a failing test now: none.


### Round 2 tests

Notes on readings the findings leave open:

- LANG-SM-22, a list item that overflows: the findings do not say whether the item or the whole list becomes undefined. The list tests accept an undefined list with reason `overflow`, or a defined list with no infinity in it. A defined list holding `inf` made from finite numbers fails the test.
- LANG-SM-22, an infinity from an infinite input (`L * big` with `big = inf`, `g(big)` with `g = f * f`) must stay a defined `Infinity` (ruling Q4). Lists come back as `Float64Array`, so the list tests compare `Array.from(...)`.
- LANG-SM-23, the style case (`a = 3 with opacity = b / 10` with `b = a + 1` is `cycle`) follows the last sentence of ruling SM-23, "Range and style edges are part of the cycle test".
- LANG-SM-23, a new name read in its own range (`zz = 3 in 0..zz`) accepts `cycle` or `unknown_name`, because design 3.19 gives `unknown_name` for a self-reference before the object exists.
- LANG-SM-24: the hex colour is not in the language docs; the tests take the syntax from the finding (`=` then `#` and 3, 4, 6 or 8 hex digits). A `#` that does not follow `=` stays a comment.
- LANG-SM-9, command calls use the `Distance(Point, Point) -> Number` command of the test helpers.

| Finding | Tests | Now |
|---|---|---|
| LANG-SM-9 (reopened) | `a style value that calls a command leaves the number free` | pass |
|  | `a number with a command in its style value can be given a new range` | pass |
|  | `a slider whose range bound calls a command is free and stays a slider` | pass |
|  | `a command in the lower bound behaves the same way` | pass |
|  | `after such a slider is made, its range can be changed` (command in the bound) | pass |
|  | `a point with a showIf rule that calls a command is free and stays draggable` | pass |
|  | `a command in the value itself still makes the object dependent` | pass |
|  | `a command in a style value does not add the command inputs to the value reads` | pass |
| LANG-SM-22 | `[1, 2] * 1e308 does not store an infinity made from finite numbers` | fail |
|  | `the list literal on the left gives the same answer` | fail |
|  | `every list-with-number operator guards its result` (`+ - * /`) | fail |
|  | `the single-number line gives overflow, and the list agrees with it` | fail |
|  | `an infinity that follows from an infinite input stays a value in a list` | pass |
|  | `ordinary list arithmetic is unchanged` | pass |
|  | `a product of two functions that overflows gives overflow, as the same product written by hand` | fail |
|  | `a power of a function that overflows gives overflow` | fail |
|  | `the other function operators overflow the same way` | fail |
|  | `a function of an infinite input still gives an infinite result` | fail |
|  | `ordinary function arithmetic is unchanged` | pass |
| LANG-SM-23 | `a = 3 in 0..b is a cycle with a path` | pass |
|  | `changing the range of a with a in 0..b is a cycle too` | pass |
|  | `the lower bound counts as well` | pass |
|  | `a range that reads the slider itself is a cycle` | pass |
|  | `a longer chain of dependents is found, and the path shows the chain` | pass |
|  | `a refused range leaves the slider as it was` | pass |
|  | `a style value that reads a dependent of the object is a cycle (range and style edges both count)` | pass |
|  | `a range that reads something that does not depend on the slider is accepted` | pass |
|  | `a new slider whose range reads an existing object is accepted` | pass |
|  | `a new name that reads itself in its range is refused (cycle or unknown name)` | pass |
| LANG-SM-24 | `a colour followed by a property with a Unicode minus is accepted` | fail |
|  | `the colour last is accepted (control), and the colour first gives the same answer` | fail |
|  | `a definition with a colour and a later Unicode minus is accepted` | fail |
|  | `a Unicode minus after the colour is not reported as bad_character, for every colour length` | fail |
|  | `a colour, then several properties with a Unicode minus` | fail |
|  | `a continuation line after a colour joins the line` | fail |
|  | `parseProgram gives two good entries for that script and no bracket error` | fail |
|  | `a colour on a later physical line of a continued line also works` | fail |
|  | `a # that does not follow = is still a comment` | pass |
|  | `a comment after a colour stays a comment` | pass |
|  | `tokenize reports no error for a colour followed by a Unicode minus` | fail |
|  | `completion on a continuation line after a colour does not offer start-of-line snippets` | fail |
|  | `the offers after a colour match the offers without it (control)` | fail |

Command: `npx vitest run packages/kernel/test/spec` gives 1198 tests, 1179 passed, 19 failed (all in `regressions.test.ts`: 8 for LANG-SM-22, 11 for LANG-SM-24). The fixer's uncommitted changes in `packages/kernel/src/language/` are in the worktree and already make the LANG-SM-9 and LANG-SM-23 tests pass. `npm run typecheck` and `eslint` on the test file are clean.

### Round 3 tests

`regressions.test.ts` goes from 128 to 253 tests: one LANG-SM-23 test changed, one added, and 123 new tests for LANG-SM-24 (reopened), LANG-SM-25, LANG-SM-26 and LANG-SM-27. They use `@incantly/kernel` only. Checked against commit `3550111` with the `src` changes left out: 59 of the 253 fail, and every round 3 finding has failing tests. Run against the worktree with the fixer's uncommitted `src` changes: 253 of 253 pass, and `npx vitest run packages/kernel/test/spec` gives 1,323 of 1,323. `npm run typecheck` and `eslint` on the test file are clean.

Notes on readings the findings leave open:

- LANG-SM-23: ruling SM-23 now counts range edges only. The test that expected `a = 3 with opacity = b / 10` to be a `cycle` now expects it accepted with `a` still free. A new test keeps `a = 3 in 0..b with opacity = 0.5` a `cycle`.
- LANG-SM-27: a new name that reads itself in its own style (`P9 = (1, 2) with showIf = P9.x > 0` on an empty figure) is `unknown_name` by design 3.19, so the self-reading cases use an object that already exists.
- LANG-SM-24: the blanks tested between `=` and `#` are space, tab, U+00A0, U+2009, U+202F, U+2003 and U+2002. A `#` after a value (not after `=`) stays a comment for every blank. Tokenize agreement means the same token kinds as the plain-space line.
- LANG-SM-25 and LANG-SM-26 are one table (`it.each`, 47 rows) over Number, List, Function, Point and Vector. Functions are judged at a point (`q = f / 0`, then `q(1)`). A point has no division, so its division-by-zero rows divide the vector in `P + V / 0`. An infinite input is accepted as a defined value holding an infinity and no NaN, or as an undefined value whose reason is neither `overflow` nor `division_by_zero`. Every row also checks that `defined` is false exactly when `reason` is set, and that a defined value has no NaN part.

| Finding | Tests | At `3550111` | Now |
|---|---|---|---|
| LANG-SM-23 | style case now accepted (changed) | fail | pass |
|  | range cycle with a style on the same line (new) | pass | pass |
| LANG-SM-27 | `P with showIf = P.x > 0`, `P with opacity = if(...)`, `P = (1, 2) with showIf = P.x > 0` | fail | pass |
|  | `P with showIf = Q.x > 0` and `P = (1, 2) with opacity = Q.x / 10` with `Q` reading `P` | fail | pass |
|  | `a = 3 in 0..20 with opacity = a / 20`, `a with opacity = a / 20`, style reading a dependent | fail | pass |
|  | object stays free; style reads stay out of the value reads | fail | pass |
|  | range cycles and value cycles are still `cycle` (controls); a style on the slider does not change the range answer | pass, fail | pass |
| LANG-SM-24 | for each of U+2009, U+202F, U+2003, U+2002: Unicode minus after the colour, definition, continuation line, `parseProgram`, `tokenize`, completion | fail (6 each) | pass |
|  | same tests for space, tab and U+00A0; comment after a colour; colour last | pass | pass |
|  | all blanks and all four colour lengths in the scanners together | fail | pass |
| LANG-SM-25 | List `/ 0` (3 rows), Function `/ 0`, `/ w`, `^ -1` (4 rows) give `division_by_zero` | fail | pass |
|  | Number `/ 0`, Vector `/ 0`, Point `P + V / 0` give `division_by_zero` | pass | pass |
|  | `input_undefined` rows for all five kinds | pass | pass |
|  | a list divided by zero is not a defined list; Number, List and Function agree on the reason | fail | pass |
| LANG-SM-26 | Vector `VB * 10`, `10 * VB`, `VB / 1e-10`, `VB + VB`, `VB - NVB`, point minus point; Point `PB + VB`, `PB - NVB` give `overflow` | fail | pass |
|  | `inf - inf` gives `not_finite` for List, Vector and Point | fail | pass |
|  | Number and Function `inf - inf`; Number, List and Function overflow; infinite-input rows for all kinds | pass | pass |
|  | overflowing point or vector is never a defined `(inf, 0)`; Number and vector agree | fail | pass |

Round 3 findings with a failing test now: none.
