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
