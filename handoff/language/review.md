# Language area: spec review (pipeline step 8)

Branch `feat/language` at `1f4b68a`. Reviewer: fresh agent, no code or test changes. `LANG-SM-33`, `LANG-SM-34` and the design 3.5 wording note are known and not re-filed.

Method: read the docs listed in the brief, read the code, then ran about 700 probe lines through the public API (`ScratchFigure.apply`, `analyseLine`, `preview`, `signatureHelp`, `complete`, `tokenize`, `compileLine`) from throwaway vitest files (deleted afterwards). File:line evidence points at `packages/kernel/src/language/` unless a path is given. Numbers in quotes are measured output.

## Summary

| Category | Items | Meaning |
|---|---|---|
| A: fix before the kernel builds on it | 4 | A contract the kernel or another area will depend on is wrong or unchecked |
| B: can wait for the kernel area | 22 | Kernel work, other-area work, or language polish that blocks nobody |
| C: change the doc instead | 17 | Code is right or the choice is forced; the doc is stale, contradictory or wrong |

Section coverage (rows in "Doc section by section", below):

| Status | Rows |
|---|---|
| Done | 39 |
| Partial | 13 |
| Different | 4 |
| Missing | 1 |

Performance (measured, Node, warm): parse plus check of a typical line 0.008 ms (target 0.2 ms); lexing 0.003 ms; compile 0.001 ms; preview 0.010 ms; signature help 0.004 ms; completion 0.04 ms on the test figure and 0.2 to 1.6 ms on 5,000 objects with 200 command names (target 2 ms; the worst case, a prefix `ob12` that matches many names, is 1.6 ms, so there is little slack); analysis on a 5,000-object figure 0.06 ms; a 2,000-sample batch of a 30-node function 0.26 ms and 124 ns per single call (about 170 to 230 million node evaluations per second against a target of 10 million).

### The A list

| # | Item | Where |
|---|---|---|
| A1 | An action command used as a value is typed `Bool`, so `P2 = Hide(A)`, `x = [Hide(A)]` and `Hide(Hide(A))` are accepted and define objects | `check.ts:1098` |
| A2 | The undefined cascade link is called `via` in the language API but `cause` in the shared contract and README decision 2 | `runtime.ts:76`, `compile.ts:1325`, `contracts/values.ts:43` |
| A3 | `Function2` (README decision 5; declared by functions-calculus and space-3d) can never be satisfied: a user `g(x, y) = …` is `Function<Number>(2)`, and `Function<Number>(2)` as a parameter type does not parse | `types.ts` (`parseTy`, `accepts`), `check.ts` |
| A4 | The command table is not validated: unknown parameter or return types, duplicate commands, duplicate parameter names and lower-case command names pass `checkTable` and `createCommandTable` silently | `table.ts:130`, `table.ts:229` |

Details for each are under "A: fix before the kernel builds on it".

## Doc section by section

Status is one of Done, Partial, Different, Missing. "Different" means the code does something other than the doc says (the reason is in the note).

### `design.md`

| Section | Status | Evidence and note |
|---|---|---|
| 3.1 Pipeline, five steps, error recovery | Done | `parser.ts:1074` (`parseLine`), `lines.ts:29` (`checkLine`), `compile.ts` (`compileLine`); up to 8 errors per line (`check.ts:96`, `check.ts:260`), main error plus `more`. Steps 1 and 2 take optional figure callbacks (`ParseOptions.isTaken`, `tokenize(source, fig)`), so "never read the figure" is not literal (C15) |
| 3.2 Normalisation and offset map | Done | `source.ts:14` (`REPLACE`), `source.ts:226` (`SourceMap`). Columns stay in typed text: `v = a² b` gives col 8, `v = ∞ ∞` col 7. All rows of the table accepted (`× · ⋅ ∙ ÷ ≤ ≥ ≠ ∧ ∨ ¬ π τ ∞ ° ² ³ ⁻¹ √ “ ” NBSP tab CRLF`); the input-bar-only spellings `<>`, `=>`, `**` are refused as the doc says |
| 3.3 Tokens, limits | Done | Limits at `source.ts:7` (2,000), `lexer.ts:34` (800 tokens), `lexer.ts:35` (depth 64; 64 allowed, 65 `limit`). `1_000`, `.5`, `2e`, `2e3`, `1..5` as probed |
| 3.4 Grammar, every rule | Done | `directive` `parser.ts:517`, `define` 403, `defmany` 329, `function` 362, `rate` 389, `restyle`/`rerange` in `parseLine` 186, `action`, `range` 474, `style` 494, `or/xor/and/not` 560-601, `relation` 601, `juxt` 729, `power`/`signed-power` 742-752, `postfix` incl. tick-call 778, `polar`, `list` with `step` 1026, `cond` 974, named `arg`. Every line kind and rule was probed and parses. Not-in-v1 forms (`|x|`, `∈`, `Circle[…]`, `A: …`) give the documented errors with a mechanical `fix` for the last two |
| 3.5 Operators, precedence, rules | Done | Precedence rows, `-2^2 = -4`, `2^-1`, right-associative `^`, chains, degree, `1/2x` `ambiguous_implicit`, tolerance equality (`1 == 1 + 1e-13` true, `1 == 1.0000001` false), undefined logic (`(1/0 > 1) or true` true, `… and false` false). Wording problems are C items |
| 3.6 Implicit multiplication | Done | `parser.ts:729`; all allowed cases (`2x`, `0.5 pi`, `2sin(a)^2`, `3(a+b)`, `2 A.x`, `2 Distance(A, B)`) and all refused cases (`a b`, `(a)(b)`, `2 3`, `x(1)` after a number) |
| 3.7 Names, reserved, scope, `suggestName` | Done | `names.ts:31`, `names.ts:45`, `names.ts:93`. Every sequence of the suggestion table checked (`A B C D`, `u v w u_1`, `l m n`, `a b c d a_1`, `α β`, `f g h p … f_1`, `c d k`, `poly1`, `reg1`, `text1`, `L M N`, `cond1`, `fx1`). `P_{1}` stores `P_1`. Scope names (`i u v age`) work through `ParamSpec.scope` with a `shadowed` notice |
| 3.8 What a definition makes | Different | All rows hold except `f(g(x))` with `f`, `g` functions: `h = f(g(x))` is `free_variable` with fix `h(x) = f(g(x))` (builder note, "left out"). The row contradicts the free-variable rule of the same section (C5) |
| 3.9 Equations versus assignments | Partial | `=` never builds an equation (`parser.ts:157`), Line/Circle/Curve/Region classification (`relation.ts:203-209`), `Line(3x + 4y == 12)`, `type_change` Line to Circle. Circle needs a constant r²: `c = x^2 + y^2 == a^2` with a slider is a conic `Curve` (C6). The AV hint for `y == x^2` is not produced (B19) |
| 3.10 Types, inference, operator table | Done | `types.ts:187` (`binaryOp`) matches the table row for row (`2 * A`, `A + B`, `u * u`, `L * 2`, `f + g`, `2 f + 1`). Rule 9 field table at `check.ts:109`. `Function<R>` with 1 to 4 parameters, unit tag, nested lists with equal rows. `2 * L` is `type_mismatch` (C8) |
| 3.11 Command argument matching | Partial | Order-independent, named arguments, optional/default, binder/body, aliases, closest form (`check.ts:1132`), `problems`, `duplicate_arg`. Differences: parameter types are text, not the `TypeSet` object; `matchForms` and `CheckCtx` are internal, not exported (C7); `Function2` (A3); no table validation (A4) |
| 3.12 Redefinition, rename, delete | Partial | Steps 1 to 4 done: cycle `lines.ts:164`, `type_change` `lines.ts:197`, `breaks_dependents` `lines.ts:239` (direct readers, which is enough: every other change is already `type_change`, see C17). Steps 5 to 7, `Rename`, `Delete` and undo are kernel work (B1, B2) |
| 3.13 Warnings | Done | `shadowed` `check.ts:289`, `index_literal` 900, `precision_loss` `lexer.ts:408/420`, `clamped` `lines.ts:301`, `unused_binder` 1459. Carried as `Notice` (README 4), under core names (`clamped`, not `slider_clamped`): C3 |
| 3.14 Built-ins and constants | Partial | 68 functions (doc: "about 75"); every function and form in the table exists (`hsv` is extra); every "undefined when" row probed and right (`log(5)` refused with the hint, `nroot(-8, 3) = -2`, `mod`/`rem` signs, `gcd(4.5, 2)` `out_of_domain`). Held-back names reserved. Gaps: display rounding (B9), numeric derivative (B10), `abs(L)` (C9) |
| 3.15 Evaluation and compile target | Done | Closures only, no `eval`; `Compiled` has `eval`, `reads`, `usesT`; function values have `call`, `call1`, `batch`; first reason wins; constant folding skips MathLib calls on purpose (`compile.ts:285`). Naming: A2 |
| 3.16 Previews | Done | `tooling.ts:70`. Nothing is committed (figure unchanged after 21 previews), unnamed lines get the next name (`c`, `D`), `incomplete` is set for open input. `type` is a `Ty` object, not a `TypeName` (C7) |
| 3.17 Syntax help | Partial | `tooling.ts:300`; `activeParam`, `matches`, `active`, nested calls, named arguments, `max(L, ` all right. Missing: the inline problem when no form matches (B14) |
| 3.18 Autocomplete | Partial | `tooling.ts:468`; scores follow the ranking table (prefix 1000, subsequence 500, type fit +300, recency, form match +150), default limit 12, `$n` placeholders. Gaps listed in B12; the tolerant-parser claim is not what was built (C17) |
| 3.19 Edge cases | Done | Each bullet probed: empty and comment lines no-op, trailing comma, bare name, `a = a + 1`, `1e400`, `1e-400`, Unicode digits, `(1,5)` as a point, open bracket, `Line = 3`, `t = 1`, `[1..1000000]`. The 1,000,000-element total is not enforceable (B3) |
| 5 Changes to the core design (12 items) | Partial | Items 1 to 8, 10, 11, 12 done. Item 9 (`Rename(obj, Text)`) is kernel work: only `nameProblem` is offered (B1) |

### `errors.md`

| Section | Status | Evidence and note |
|---|---|---|
| 1 Error object, rules | Done | `errors.ts:130` (`buildError`): `fix`, `quickFixes`, `more` (7), `after`, `hint` never empty, `message` never repeats `forms`. `related` is `string[]` (unified format), not the `{ line, col, endCol, note }` objects the doc shows (C3). `fix` is always also `suggest[0]` (ruling Q14) |
| 1 Undefined reasons | Done | All eleven reasons are produced or registered (`explicit`, `condition_false`, `division_by_zero`, `out_of_domain`, `not_finite`, `overflow`, `index_out_of_range`, `empty_list`, `not_integer`, `input_undefined`; `no_value_yet` registered, raised by the kernel). Cascade field: A2 |
| 2 Lexical errors | Done | `bad_character` (`lexer.ts:289-311`, look-alike hint and fix), `bad_number` (178, 388, 398; reason in the message), `unterminated_string` 518 (points at the opening quote), `bad_escape` 449, `bad_format` 499, `limit` for length and depth. Every one raised in a probe |
| 3 Parse errors | Done | `syntax` with `expected` (at most 8), `unbalanced` with `fix` and mismatch case, `unnamed_object` with a free name, `missing_operator` with `fix`, `ambiguous_implicit` with two `quickFixes` and no `fix`, `chained_comparison`, `assign_in_expr` (col 9-10 for Q9), `bad_range`, `bad_directive`, colon label as `syntax` with `fix`. Syntax errors inside a call carry no `forms` (B15) |
| 4 Name errors | Partial | Raised and probed: `unknown_name` (with `after` in a batch, product fix, slider quick fix), `unknown_command` (3 closest), `unknown_function`, `not_callable` (fix `*`), `free_variable` (fix), `reserved_name`, `bad_name`, `duplicate_param`, `duplicate_arg`, `not_a_binder`. `name_taken` is never raised (Rename is the kernel's, B1) |
| 5 Type and argument errors | Done | `type_mismatch` with `left`/`right` and legal neighbours, `no_matching_form` with `problems` and closest form first (`Circle(A, 2, 3)` and `Distance(A, 5)` as ruled), `arg_count` (replaces `bad_arity`), `type_change`, `cycle` with `path`, `breaks_dependents`, `empty_list_type`. `unit_mismatch` is not raised, as the doc says |
| 6 Command-specific errors | Done | Only type, count and name errors are raised; value-dependent failures are undefined |
| 7 Limits | Partial | Raised and probed: line 2,000, tokens 800, depth 64/65, range 100,000, objects 5,000 (via `FigureView.size`), parameters 4, command arguments 16/17, ticks 3, rate order 2. Not enforceable: total list elements 1,000,000 (B3). Implemented but unreachable: nodes 2,000 (`check.ts:308`), list literal 10,000 (`check.ts:770`), text 10,000 at line time (`check.ts:490`) because the token and line caps trigger first (C11) |
| 8 Runtime and numeric failures | Done | Every row of the table probed (`sqrt(-1)`, `1/0`, `10^400`, `fact(200)`, `inf - inf`, `0 * inf`, `L[0]`, `max([])`, `fact(2.5)`, cascade) |
| 9 GeoGebra comparison | Done | Informational |

Shared error list (`docs/features/errors/design.md` section 4), each kind checked for "raisable":

| Group | Kinds | Result |
|---|---|---|
| Raised by the language, shared list (25) | `syntax unbalanced bad_number unterminated_string bad_character unknown_directive bad_directive unknown_name unknown_command unknown_property reserved_name bad_name unnamed_object duplicate_param not_callable no_matching_form arg_count type_mismatch type_change bad_property_value bad_range bad_argument cycle limit internal` | All raised in probes with `hint`; `fix` or `suggest` where the doc asks |
| Added by the language (12) | `bad_escape bad_format missing_operator ambiguous_implicit chained_comparison assign_in_expr unknown_function free_variable breaks_dependents empty_list_type duplicate_arg not_a_binder` | All raised; registered in `contracts/errors.ts`; codes `L008` to `L019` still need the errors area to confirm |
| Not the language's (10) | `name_taken forward_reference locked not_free missing_rate nothing_to_undo load_failed version tool_input tool_busy` | Not raised here. All are kernel or tool work (B1, B4) |

### `agent.md`

| Section | Status | Evidence and note |
|---|---|---|
| 1 Language card | Done | Every example line on the card was run and passes (`P = (2; 30°)`, `g(x, y) = x*y`, `a in 0..20`, `A, B = Intersect(c, d)`, `A with color = red`, `Hide(A)`, `@view -5 5 -3 3`, relations, lists, text, `0 < x < 5`). The card shows `v' = -g` but never how to make a state (C13) |
| 2 Catalogue lines | Done | Function and field names printed in the doc all exist (checked against the function table); operator lines match the table. `2 * L` is refused although the line says "Lists with a number work element-wise" (C8) |
| 3 `draw` results | Partial | The language returns `Applied` (name, type, `summary`, `defined`, `reason`) plus `notices`. The `warnings` and `undefined: [...]` arrays, `line`, `noop` and the AV `summarize` text are assembled by the kernel and the teacher tool (B22) |
| 4 Repair rules | Done | Every field the model acts on exists: `fix`, `quickFixes`, `forms`+`problems`, `hint`, `after`, `limit`, `breaks_dependents`; `fingerprint` for the retry rule |
| 5 Worked lessons | Different | 5.2 (`x = P.x`, fix `px = P.x`) and 5.3 (`v = f(x)`, fix `v(x) = f(x)`, hint text) match the code exactly. 5.1 uses `f(x) = m (x - A.x) + A.y` and 5.4 uses `(1/2) x`; both are invalid by rulings Q1 and Q2 (C1) |
| 6, 7 Style rules, token budget | Done | Teacher-side. Typical error object for `Circle(A, 2, 3)` is within the 800-character budget (tester's test); compaction itself is B19 |

### `ui.md` (data the editor needs)

| Section | Status | Evidence and note |
|---|---|---|
| 2 Syntax colouring | Partial | `tooling.ts:732` (`tokenize`): classes object, unknown, command, function, constant, number, operator, string, comment, keyword, name, directive, error; unmatched brackets reported at once. `{ }` parts inside a text are not coloured as expressions: the whole text is one `string` token (B13) |
| 3 Error display | Done | Spans in typed columns, `forms`, `fix`, `quickFixes`, `incomplete` with `expected` |
| 4 Completion | Partial | B12 |
| 5 Signature help | Partial | `matches` lets the editor hide contradicted forms; the hover summary needs only `fig.commands.lookup`. Inline problem: B14 |
| 6 Preview (ghost) | Done | `ghost` carries type and value, unnamed lines get a name, undefined results give `valueText` with the reason, no side effects |
| 7 Symbol entry | Done | Greek letters, `× ÷ −`, `π τ ∞ °`, `≤ ≥ ≠` are accepted and normalised (probed) |
| 9 Paste | Done | Smart quotes, `×`, `−`, `A:(1,2)`, `Circle[A, 2]` with a mechanical `fix` |

### `docs/features/README.md` decisions that touch the language

| Decision | Status | Evidence and note |
|---|---|---|
| 1 One-based lists, negative index from the end | Done | `L[-1]` is the last item; `L[0]` undefined with `index_literal` |
| 2 Undefined registry with `cause` | Different | A2 |
| 3 One `bad_argument` | Done | Raised at `check.ts:983`, `1046`, `1159`, `lines.ts:684`. It is also used for an unknown named parameter and for a rate on a non-state, which is a loose fit (B15) |
| 4 `notices` | Done | `Result.notices` with `severity`, `code`, `message` |
| 5 `Function2` | Different | A3 |
| 6 `Point - Point` is `Vector` | Done | |
| 7 `inf` is a constant and a stored value | Done | `v = inf` stores `inf`; `inf - inf` is `not_finite` |
| 12 Degrees | Done | `30°`, `30 deg`, `(a + b)°` |
| 13 `if` with any number of arms | Done | 2, 3, 4, 5 arguments probed; one argument is `arg_count` |
| 14 Reserved names | Done | `x y z t bt beat inf deg undefined` refused; `i u v age` scope-local |
| 15 `xaxis`/`yaxis` lower case | Done | Reserved (`xaxis`, `yaxis`, `zaxis` all refused) |
| 16 Images named `A_1` | Done | `A'` is never a name |
| 17 Continuation lines | Done | `parseProgram` joins lines while a bracket is open; `parseLine` rejects a second line |
| functions-calculus decision 12 (inline function arguments) | Missing | `Limit(sin(x)/x, 0)` is `free_variable` (B7) |

## A: fix before the kernel builds on it

### A1. An action used as a value becomes a `Bool` object

- **Doc:** core design 6.6 and `design.md` 3.8 ("A command call: the command form's return type"); `CommandForm.returns` is `null` for actions (`table.ts:93`).
- **Code:** `inferCommand` sets `ty = T.Bool` when `form.returns === null` (`check.ts:1098`). Only a line-level action goes through `checkAction` (`lines.ts:756`).
- **Evidence:** `P2 = Hide(A)` gives `P2 : Bool`; `x1 = [Hide(A)]` gives `List<Bool>`; `Hide(Hide(A))` is accepted; `x1 = Hide(A) + 1` fails only with "Cannot add a Bool and a Number".
- **Harm:** the kernel would create an object whose rule runs an action each time an input changes (hide, delete, rename on recompute).
- **Fix:** in `inferCommand`, when `ret === null` and the call is not the whole line, raise `type_mismatch` (or `bad_argument`) "Hide is an action, not a value", hint "Write it on its own line". Keep `checkAction` for the line case.

- **Status:** fixed

### A2. `via` versus `cause`

- **Doc:** README decision 2 and `contracts/values.ts:43` define an undefined value as `{ reason, detail?, cause? }`. `language/errors.md` and `design.md` 3.15 say `via`.
- **Code:** `Env.via` (`runtime.ts:76`), `EvalResult.via` (`compile.ts:1325`, `1343`), `FunctionValue` reasons.
- **Harm:** the kernel stores `Undefined` objects built from `evaluate()`; every call site needs a rename, and a missed one drops the cascade link silently (the field would be `undefined`, not an error).
- **Fix:** rename to `cause` in `Env`, `EvalResult` and `resetEnv`; update the two language docs (C3). Behaviour is unchanged.

- **Status:** fixed

### A3. `Function2`

- **Doc:** README decision 5: "`Function2` is defined once, in `functions-calculus`. `language` and `space-3d` use it." `functions-calculus/design.md:34` makes `g(x, y) = …` a `Function2`; its `Integral`, `Derivative`, `SolveODE` forms and space-3d's `TangentPlane` and `Gradient` take `Function2` parameters.
- **Code:** a two-parameter definition is `Function<Number>(2)` (`design.md` 3.10; builder note 12). `parseTy('Function2')` returns an opaque `{ k: 'Function2' }` that no expression produces. `accepts` never relates the two.
- **Evidence:** with a command that takes `Function2`, `Integral2(g2)` where `g2(x, y) = x*y` fails: "argument 1 (g) should be a Function2, but g2 is a Function<Number>(2)". A parameter typed `Function<Number>(2)` does not parse at all: the message reads "should be a , but fa is a Function<Number>" (empty expected type).
- **Harm:** the first calculus or 3D command table the kernel loads will reject every two-variable function. This is a type-registry decision the kernel owns, so it must be settled before the table is built.
- **Fix:** make `accepts('Function2', Function<Number>(2))` true (and accept `Function<Number>(2)` in `parseTy`), and print an arity-2 function as `Function2` in `tyStr`; or drop `Function2` from the README. Pick one, then update `design.md` 3.10 (C7).

- **Status:** fixed

### A4. The command table is not validated

- **Doc:** `design.md` 4.6 and 3.11: one table drives typing, errors, catalogue, completion and signature help; "The table builder proves at load time" there are no ambiguous overloads. The kernel will load a table with several hundred forms written by about 20 areas.
- **Code:** `checkTable` (`table.ts:229`) tests overload ambiguity only; `createCommandTable` (`table.ts:130`) checks nothing.
- **Evidence:** all of these return no problem and no throw: a parameter of type `Fnord`; a return type `Banana`; two parameters both named `f`; a command called `lower`; a binder parameter with no body; a command with no forms; two commands with the same name (`createCommandTable` keeps one of them and drops the other without a message). The first of these, an unparsable type, produced the empty "should be a ," message in A3.
- **Fix:** extend `checkTable` to return a `TableProblem` for each of these, and have `createCommandTable` report duplicate names. The kernel then runs `checkTable` in its own load test.

## B: can wait for the kernel area

| # | Item | Why it can wait / who owns it |
|---|---|---|
| B1 | `Rename`, `Delete`, `Show`, `Hide`, `applyBatch`, `name_taken`, `forward_reference`, `locked`, `not_free`, `nothing_to_undo`, `load_failed`, `version`, `tool_input`, `tool_busy` are not raised. `Rename(A, "Z")` is `unknown_command` without a kernel table. Only `nameProblem` (`names.ts:45`) is offered for the name checks | Kernel services (README 8, 11). Builder note "kernel services" is right. The kernel must call `nameProblem` and `reservedGroup` from `Rename` |
| B2 | Redefinition steps 5 to 7 (move after a later input, free to dependent and back, one undo entry). `CheckedLine` gives `op`, `existing`, `reads`, `free`; `ScratchFigure` drops the slider range on `sa = 5` after `sa = 4 in 0..8 step 2`, which doc 3.12 step 6 does not say for free to free | Kernel owns order and undo; decide the free-to-free range rule in the kernel doc |
| B3 | Total list elements per figure (1,000,000) cannot be enforced: `FigureView` has `size` (objects) but nothing for list elements. `ScratchFigure` accepted 12 lists of 100,000 | Add `FigureView.listElements` or let the kernel raise `limit` itself. The `limit` payload shape is in `errors.ts` |
| B4 | A state and its rate are not paired: `th = state(0.5)` then `th'' = 1` is accepted (`lines.ts:667-717` ignores the velocity); `missing_rate` is never raised | Needs the whole figure at commit or step time. `CheckedLine.state` and `.rate.order` carry what the kernel needs |
| B5 | Directive validation: `DIRECTIVES` (`props.ts`) holds usage strings only; six of 31 directives are validated (`lines.ts:785-842`). `@seed abc`, `@sheet x y`, `@rounding zz` all pass | Each owning area validates. Give `DIRECTIVES` an optional `check` hook so `bad_directive` comes from one place |
| B6 | `with` values are checked per key but not per object type; `unknown_property` lists every key, not those valid for the type (kernel design 9.1) | Needs the kernel's type-to-property table |
| B7 | Inline function arguments (functions-calculus decision 12): `Limit(sin(x)/x, 0)` and `Integral2(x*y)` give `free_variable` | Needs `x`/`y` as implicit binders inside parameters of type `Function`/`Function2` (`check.ts` binder scope at 1323-1356 is the place). Schedule with functions-calculus; not needed for the kernel |
| B8 | Slider clamp: `a = 30 in 0..10` yields the `clamped` notice but keeps 30; a non-literal bound or a later `a in 6..9` gives no notice (`lines.ts:301`) | The kernel clamps at run time and decides notices from the range evaluators |
| B9 | Display rounding: `formatNumber` prints 6 significant digits (`runtime.ts`, `valueText`); `sin(pi)` shows `1.22465e-16`, `sin(180 deg)` the same, where doc 3.14 says "shown as `0` after display rounding" | Rounding is a figure setting (`@rounding`, `@digits`); the kernel passes it. Add a `digits` argument to `valueText` |
| B10 | `f'(x)` is a numeric central difference (orders 1 to 3): `f'''(2)` of `x^2` is `4.046e-7`, not 0 | `Derivative` in functions-calculus gives exact forms; add a hook so the kernel can swap in the exact rule when one exists (`inferTick`, `check.ts:924`) |
| B11 | Commands inside expressions need `CompileOptions.runCommand`; without it `Midpoint(A, B).x` and `2 Distance(A, B)` are undefined `not_set` | The kernel supplies it. Decide there whether a nested command call builds a hidden object or evaluates inline |
| B12 | Completion gaps (`tooling.ts:468`): no legal values after `prop =` (`A with color = ` offers objects, not `red`, `blue`; colour words appear only once a letter is typed); no fields after `.` inside `"{A."`; no flag marking "type fits the current parameter" (ui.md 4 wants a leading dot); the `Completion` result has no `fits` field | The tolerant scan (C17) cannot see these positions. Language polish; no kernel dependency |
| B13 | `{ }` parts of a text are one `string` token, not expressions (`tokenize`), so an unknown name inside `{b}` is not flagged | Language polish for the editor |
| B14 | Signature help with no matching form marks the closest form active but returns no inline problem (design 3.17 last sentence); no `describeCommand(name)` for the hover summary | Language polish; `fig.commands.lookup(name).forms[i].summary` is enough for the editor today |
| B15 | Error polish found in probes: limit errors for `function_params`, `ticks`, `command_args`, `rate_order` carry the generic hint "Check the marked part of the line."; `bad_property_value` repeats its message as the hint; `1 < 2 == true` says "A chain must keep one direction"; `A1, A1 = Intersect(c1, c2)` says "The parameter A1 appears twice"; `x == 3` suggests the Bool name `cond1` for what is a Line; `if(a > 1)` says "takes 2 argument(s)" for a form that takes 2 or more; `"abc".length` is `bad_number`; one-letter names get unrelated suggestions (`A` gives "Did you mean e?"); syntax errors inside a command call carry no `forms` although the `errors.md` 3 example does; `cause` (unified format 5.1) is never set; `bad_argument` is used for an unknown named parameter | Cosmetic; none changes a kind or a field the kernel reads |
| B16 | Public functions throw on bad JavaScript input although the types forbid it: `parseLine(undefined)`, `parseProgram(undefined)`, `compileLine(null)`, `suggestName(undefined)`. `setMathLib(null)` is accepted. `tokenize`, `analyseLine`, `preview`, `complete`, `signatureHelp`, `evaluate` return safely | AGENTS.md "nothing throws across a package boundary". The teacher tool validates input first (`tool_input`), so this is a belt-and-braces fix |
| B17 | `packages/kernel/bench/` is empty; AGENTS.md puts benchmarks there. The timings above exist only as pass/fail tests in `test/spec/language/performance.test.ts` | Add the benches with the kernel's, using the numbers above as the baseline |
| B18 | `MathLib` is an interface only; the bit-exact port and the two-engine byte test (design 3.14) are not built | Builder note: deferred. Belongs with the film-replay work |
| B19 | Error compaction (errors/design 3.5: at most about 800 characters, 4 forms plus `formsOmitted`) is not in the language; `buildError` caps `forms` at 6. AV hint for `y == x^2` (3.9 table) and the typeset preview strip (ui.md 1; `printExpr` gives canonical text only) | Teacher tool, Algebra view and studio own these |
| B20 | `$…$` display maths in Text stays plain text (builder note). Core decision 3 renders it with KaTeX | Text-logic area |
| B21 | `kernel.slice`, `dryRun`, `drag` use the checker through `OverlayFigure`/`FigureView`; the only `FigureView` implementation is `ScratchFigure`, which the builder says is not the kernel | Kernel implements `FigureView` (including `inputsOf`, `dependentsOf` with sources, `read`, `clock`, `styleRulesReading`); no language change |
| B22 | `draw` result assembly: `warnings`, `undefined: [{ name, reason, via }]` for downstream objects, `summary` equal to the AV `summarize` text, `line`, `noop` (agent.md 3, errors.md 8). `Applied` reports only the new object's own state | Kernel and teacher tool build them from `CheckedLine`, notices and the cascade |

## C: change the doc instead

| # | Doc | Change |
|---|---|---|
| C1 | `design.md` 1.2 and 3.5 (`(1/2)x is fine`), `agent.md` 5.1 (`m (x - A.x)`) and 5.4 (`(1/2) x`), `errors.md` 3 (`ambiguous_implicit` quick fix `(1/2) x`), 4 (slider quick fix `g(x) = k x`), 2 (`fix` `area = pi r^2`) | Rulings Q1, Q2: implicit multiplication follows only a number; `(1/2)x`, `k x`, `pi r` and `m (x - A.x)` are errors. Rewrite each example with `*` (`(1/2) * x`, `g(x) = k * x`, `area = pi * r^2`, `m * (x - A.x)`). Q1 says "the 1.2 example is wrong" but the file was not edited |
| C2 | `design.md` 3.1 table, `errors.md` 2 and 7 | Kind names: use `bad_character`, `limit` (with `params`/`limit.name`), `arg_count`; remove `bad_char`, `too_long`, `too_deep`, `bad_arity` (rulings Q7, Q8). `design.md` 3.3 and 3.19 still say "`limit`-kind errors" correctly |
| C3 | `errors.md` 1, 4 and 5 examples; `design.md` 3.13; `design.md` 3.15 | Use the unified fields: `related` as a list of text lines, `notices` instead of the `Warning` interface (kind `clamped`, not `slider_clamped`), `cause` instead of `via` (after A2), `suggest` beside `fix`/`quickFixes`, `recovery`, `code`, `phase`, `committed` |
| C4 | `design.md` 3.14 constants row for `inf` | Says "never stored as a result". README 7 and ruling Q4 say `out = inf` stores `inf`; only `inf - inf` and `0 * inf` are `not_finite`. (The 3.5 finite-number note on `==` is already known.) |
| C5 | `design.md` 3.8 row `f(g(x))` | `h = f(g(x))` has a free `x`, so it is `free_variable` like `a = x + 1`. The Function row should read `h(x) = f(g(x))` |
| C6 | `design.md` 3.9 classification row for Circle | "with `r2 > 0`" is a value test that cannot be made at check time when the radius is a slider. State the rule that was built: Circle only when the radius squared is a constant; `x^2 + y^2 == a^2` with a slider `a` is a conic `Curve`; use `Circle(O, a)` for a circle that follows a slider. Say it in the agent card too: this is a common lesson |
| C7 | `design.md` 3.10, 3.11, 3.16, 3.17; `agent.md` 3 | Types in results are `Ty` objects (`{ k: 'Function', ret, arity }`) with `tyStr` text (`Function<Number>(2)`), not `TypeName` strings. `matchForms`, `CheckCtx`, `infer` are internal; the exported surface is in `builder-notes.md`. `ParamSpec.type` is text. Add the `Function2` decision once A3 is settled |
| C8 | `design.md` 3.10 operator table and `agent.md` 2 | The table row `List<Number> op Number` is list on the left only: `L * 2` works, `2 * L` is `type_mismatch` ("Number * works with: Number, Vector, Function"). `agent.md` says "Lists with a number work element-wise". Either say "list on the left" or add the `Number op List` rows (a code change of five lines in `binaryOp`; the model will often write `2 * L`) |
| C9 | `design.md` 3.14 "`abs`, `min`, `max`, `sum`-style list forms take a list too" | Only `min` and `max` take a list; `abs(L)` is `no_matching_form`; `sum` and `mean` are not built-ins (they are list-area commands). Fix the sentence |
| C10 | `design.md` 3.14 speed target | "At least 10 million node-evaluations per second … 10 functions in under 1 ms" does not follow from itself: 2,000 samples × 20 nodes × 10 functions is 400,000 node evaluations per redraw, which needs 400 million per second to fit 1 ms, not 10 million. Measured: about 170 to 230 million per second; a 2,000-sample batch of a 30-node function with `sin`, `cos`, `sqrt` takes 0.26 ms, so 10 such functions take 2.6 ms. State the target per function per redraw (for example "a 2,000-sample batch of a 20-node function under 0.2 ms") |
| C11 | `errors.md` 7 | Expression nodes 2,000, list literal 10,000 and text 10,000 cannot be reached at line time: 800 tokens and 2,000 characters stop the line first. Say they are backstops for built values (concatenated text, `Seq` results), or raise the token cap |
| C12 | `docs/design/performance.md` | Add the language targets that today live only in `ui.md` 2, `design.md` 3.16/3.18 and the tester's test: parse plus check 0.2 ms per line, preview 1 ms, completion 2 ms at 5,000 objects. Measured values are in the summary above |
| C13 | `agent.md` 1 card | The card teaches `v' = -g` but not how to make the state it applies to (`th = state(0.5)`). Add one line, or point to animation-time |
| C14 | `errors.md` 1 versus README decision 8 | `errors.md` says lines after a failed line are still tried, with `after` set; README 8 says `applyBatch` is all-or-nothing. State which entry point does which: `draw` is independent lines (the language supports it through `CheckOptions.failed` and `targetNamesOf`); `applyBatch` is atomic |
| C15 | `design.md` 3.1 "Steps 1 and 2 never read the figure" | `parseLine` takes optional callbacks (`isTaken`, `isObjectCommand`) used only to name unnamed results; `tokenize` takes the figure for colouring. Say "no figure is needed" |
| C16 | `errors.md` 2 `bad_number` row (and `errors/errors.md` L003: `1e`, `0x`) | `2e` is `2 * e` and `0x10` is `0 * x10` (design 3.3, builder note 4). Remove `1e` and `0x` from the list |
| C17 | `design.md` 3.12 step 4 and 3.18 first paragraph | Step 4: say direct readers are enough, because a changed type is already `type_change` and a function's arity is the only signature that can change. 3.18: the "error-recovering variant of the same grammar" is a token scan over the text left of the cursor plus the normal parser for finished arguments (builder note), which is why B12 gaps exist; describe that, or build the recovering parser |

## What the builder left out on purpose

| Left out | Is it the kernel's job? | Verdict |
|---|---|---|
| Rule factories and command evaluation (`runCommand` hook) | Yes: rules and updates are kernel design 4 and 8 | Right. Open question for the kernel: B11 |
| Error-recovering parser for completion | No: it is the language's own feature (design 3.18) | Not the kernel's. The scan works for most positions; the misses are B12 and the doc line is C17 |
| Exact `f'(x)` | No: functions-calculus owns `Derivative` | Right to defer; the numeric rule needs a swap hook (B10) |
| `h = f(g(x))` as a Function | No: it is a language rule | The builder chose the free-variable rule; the doc should follow (C5) |
| Circle from a non-constant equation | No: language typing | Forced by static types (a slider cannot change the type); doc change (C6) |
| Dependents test beyond direct readers | No: language | Correct (C17) |
| Directive validation beyond six | Partly: each area owns its own arguments | Add the hook (B5); the language still owns the one `bad_directive` error shape |
| Property table per object type | Yes: kernel design 9 | Right (B6) |
| Localisation | No: not in v1 | Right; templates are keyed (`errors.ts` `MESSAGE_TEMPLATES`) |
| `MathLib` bit-exact port | No: the film area | Right (B18) |
| `$…$` maths in Text | No: text-logic | Right (B20) |
| Kernel services (`Rename`, `Delete`, `applyBatch`, undo, ordering moves, object count) | Yes | Right (B1, B2, B3) |

## Not found wrong

These were probed against the docs and rulings and needed no item: Q1 to Q14, depth, sliders, SM-23 and Q-R4-1 behaviour on an empty figure (`P9 = (1, 2) with showIf = P9.x > 0` and `c1 = (1, 2) with opacity = c1.x / 10` accepted; `k = 3 in 0..k` is `unknown_name`; `a in 0..a` and `a in 0..b` with `b = a + 1` are `cycle` with `path`; `a = 3 in 0..20 with opacity = a / 20` accepted); the closest-form rule and span rule (Q5, Q6); `Circle(A, 2, 3)`, `Distance(A, 5)`, `3x + 4y = 12` columns; hex colours (`color = #ff0000`, `#f00`, followed by a comment); superscript digits; offset-map columns after normalisation; every undefined-reason row; prototype-pollution names (`__proto__`, `constructor`, `toString`) as names, properties, fields, commands, functions, directives and named arguments (none change behaviour); the 100,000-element range edge; the 5,000-object edge; and the sixteen- and seventeen-argument edge.
