# Kernel and errors: test report (tester, step 2)

Branch `feat/kernel`. Tests are in `packages/kernel/test/spec/kernel/` and `packages/kernel/test/spec/errors/`.
Run them with `npx vitest run packages/kernel/test/spec/kernel packages/kernel/test/spec/errors`.

Lint and typecheck are clean on these files (`npx eslint packages/kernel/test/spec/kernel packages/kernel/test/spec/errors`, `npx tsc -p tsconfig.json`).

## Result

**1,053 tests: 1,004 pass, 49 fail.** The 49 failures group into 10 causes (below). The whole run takes about 3 s; the slowest file is `speed.test.ts` (about 2 s, it builds 5,000-object figures).

| File | Area | Tests | Fail |
|---|---|---|---|
| `kernel/objects.test.ts` | object store, free and dependent objects, ids, names, suggestName, Describe | 42 | 0 |
| `kernel/graph.test.ts` | dependency graph, update order, one pass per frame, cut-off, time set, reorder, lazy demand | 33 | 0 |
| `kernel/undefined.test.ts` | undefined with reason, input_undefined, cause chain, rootCause, recovery, literal `undefined` | 34 | 1 |
| `kernel/redefine.test.ts` | redefinition, free to dependent, type_change, cycle, self-assignment (K2), locked, dryRun | 55 | 4 |
| `kernel/rename-delete.test.ts` | Rename, Delete, deletePlan, property detach | 56 | 3 |
| `kernel/history.test.ts` | Undo, Redo, undo units, gestures, capacity, nothing_to_undo | 52 | 0 |
| `kernel/batch.test.ts` | applyBatch atomic and independent, blockedBy | 28 | 2 |
| `kernel/drag.test.ts` | setFree, dragPlan, drag, commitDrag | 31 | 1 |
| `kernel/clock-states.test.ts` | t, bt, beat, seeking, states and rates, solver accuracy, stability, directives | 45 | 2 |
| `kernel/steps.test.ts` | steps, stepTo, @step, insertAt, move | 29 | 1 |
| `kernel/save-load.test.ts` | toScript, fromScript, append, versions, strict and lenient, round trip of random figures | 50 | 2 |
| `kernel/slice.test.ts` | slice | 23 | 0 |
| `kernel/events.test.ts` | on, every event, batching, listener faults | 28 | 1 |
| `kernel/properties.test.ts` | defaults, keys, layers, showIf, dynamic colour, style edges | 84 | 1 |
| `kernel/limits.test.ts` | Limits, limit errors, run-time limit, rule budget, determinism, rule faults | 33 | 13 |
| `kernel/speed.test.ts` | speed targets, 5,000-object update | 17 | 0 |
| `errors/registry.test.ts` | error table, `err`, fallback, internalError | 62 | 2 |
| `errors/notices-phrases.test.ts` | notices, phrase table | 45 | 0 |
| `errors/compact-suggest.test.ts` | compactError, nearestNames, defineLine | 32 | 2 |
| `errors/golden.test.ts` | golden tests: 26 error kinds x (3+ lines, hint, message, JSON, suggestions, near miss, atomicity), doc examples | 231 | 13 |
| `errors/fuzz.test.ts` | 600 mutations, every prefix, 30 hostile inputs, junk API arguments | 43 | 1 |
| | **Total** | **1,053** | **49** |

(`dryRun` tests are in `redefine.test.ts`; `Describe`, `DependsOn` and `Uses` are in `objects.test.ts` and `graph.test.ts`; the speed target for a 5,000-object update is in `speed.test.ts`.)

## Failing tests, grouped by cause, worst first

Each row gives the test name, the file, and the doc line it checks.

### 1. Host limits are not applied at line time (14 tests)

`new Figure({ limits })` and `fromScript(text, { limits })` reach the journal and the file-size check, but not the line checks. Only the defaults are enforced, and the default expression limit is a 800-token limit, not 400 nodes.

Doc: `kernel/errors.md` 6 "Limits are values in a `Limits` object passed to the figure; hosts can lower them" and the table (objects 5,000 / expression nodes 400 / line length 2,000 / list size 100,000 / depth 64, error `limit` values `objects`, `expr_nodes`, `line_length`, `list_size`, `depth`).

- `limits.test.ts` "objects: the line that would go over is refused...", "after a delete there is room again", "line_length: one character over...", "expr_nodes: more than 400 nodes in one line" (fails even with the default of 400), "expr_nodes can be lowered by the host", "list_size: a literal list over the limit...", "the message and hint of a limit error...", "a batch refuses what goes over the limit...", "loading respects the object limit"
- `batch.test.ts` "a batch on a figure with a limit refuses the line that goes over...", "independent mode keeps the lines that fit under the limit"
- `save-load.test.ts` "limits passed to fromScript apply to the loaded figure (objects)"
- `golden.test.ts` "limit: the object limit names which limit and the maximum"
- `limits.test.ts` "depth: nesting ... fails with the depth limit": the error is `limit` but `params.limit` is `nesting_depth`; the table says `depth`.

The 5,000-object default and the 2,000-character line default are enforced (those tests pass).

### 2. The run-time `limit` reason is never produced (3 tests)

A rule that returns a list longer than `listSize` gives a defined cell. Doc: `kernel/errors.md` 2 "`limit` | result would exceed a size limit | huge `Seq`"; `errors/design.md` 9 "Limits are errors at line time (`limit`) and undefined at run time (`limit` reason)".
- `limits.test.ts` "a rule that would make a list over list_size gives undefined with reason limit", "at the default 100,000 a longer list from a rule is undefined (limit)", "what reads it inherits input_undefined".

### 3. A rate rule that replaces an earlier one is ignored; a blown-up state stops its neighbours (2 tests)

- `clock-states.test.ts` "a rate rule is not an object and can be replaced": after `x1' = 1` then `x1' = 2`, the state still moves at rate 1. Doc: `animation-time/design.md` 7.1 "Redefinition keeps working: `ω' = ... ` replaces the rule" and 7.7 "Any line that changes the cone invalidates all checkpoints".
- `clock-states.test.ts` "a stable state next to a blown-up one keeps stepping": an unrelated state becomes undefined when another blows up. Doc: `animation-time/design.md` 7.8 "All states in the affected connected group become undefined ... The solver stops stepping that group and keeps stepping others."

### 4. `acceptsUndefined` rules get `NaN`, not `undefined` (1 test)

`undefined.test.ts` "a rule declared acceptsUndefined still runs and sees undefined". Doc: the exported `CommandRule.acceptsUndefined` comment ("receive `undefined` in `values`") and `kernel/design.md` 6.4.

### 5. Error `suggest` lines (7 tests)

Doc: `errors/errors.md` 7 "a check that `suggest` lines parse and apply cleanly"; `kernel/errors.md` 1 and 4.
- `golden.test.ts` "unknown_name: every suggested line passes": `r = k + 1` suggests `r = A + 1` (a Point where a Number is needed).
- `golden.test.ts` "unknown_property: every suggested line passes": `A with wdth = 3` suggests `A with width = 3`, but a Point has no `width`.
- `golden.test.ts` "unknown name that looks like a slider": `suggest` should hold `k = 1 in 0..10` (`kernel/errors.md` 1 `unknown_name`: "`suggest` includes a line that would define it"). The line exists only in `quickFixes`.
- `golden.test.ts` "type_change: message, params and a suggestion that passes" and `redefine.test.ts` "suggests another name for the same line": `suggest` is empty; the doc example has `["c2 = Circle(O, 2)"]`.
- `redefine.test.ts` "the hint says what Delete would take with it": hint should say "this removes 2 objects that use c: d, e" (`kernel/errors.md` 4 type_change example). It says only "Delete(c) first...".
- `steps.test.ts` "insertAt before an input is forward_reference...": `suggest` empty; `kernel/errors.md` 1 "`suggest` has the move".

### 6. Error object details that differ from the doc examples (8 tests)

- `locked` points at the object name, not the whole line. Doc: `kernel/errors.md` 4 locked example (`"token": "P = (1, 1)"`). Tests: `golden.test.ts` "locked case 0" and "case 2", `redefine.test.ts` "cannot be redefined by a line".
- `unknown_property.expected` is cut at 8 keys and lacks `color`. Doc: `kernel/errors.md` 4 (the example lists all 15 keys; only the compact form caps at 8, `errors/design.md` 3.5). Tests: `properties.test.ts` "unknown_property: K020...", `golden.test.ts` "unknown property: expected lists the valid keys...".
- `bad_property_value` for `layer = 12` has recovery `use_suggestion`; `errors/errors.md` 5.6 shows `fix_line`. Test: `golden.test.ts` "bad_property_value layer = 12...".
- `unbalanced` has phase `parse`; `errors/errors.md` 2 ("counted during lexing") and 5.2 say `lex`. Test: `registry.test.ts` "unbalanced is detected while lexing".
- `no_matching_form` message reads "Circle has no form for (...)"; the doc template and examples read "Circle has no form (...)" (`errors/design.md` 3.4, `errors/errors.md` 1.4 and 5.4). Test: `registry.test.ts` "no_matching_form reads...".

### 7. Message keys use `lang.*` for kernel kinds (4 tests)

`cycle`, `unknown_command`, `bad_property_value` and `limit` have `lang.<kind>`. Doc: `errors/design.md` 3 (`"kernel.cycle"`), `errors/errors.md` 5.3, 5.6, 5.8 (`kernel.unknown_command`, `kernel.bad_property_value`, `kernel.limit`). `locked`, `nothing_to_undo` and others already use `kernel.*`. Tests: `golden.test.ts` "message keys: ...".

### 8. Compact error keeps `fingerprint` and `committed` (2 tests)

`compact-suggest.test.ts` "leaves out fingerprint..." and "leaves out committed...". Doc: `errors/agent.md` 1 "Compact form omits `source`, `params`, `messageKey`, `fingerprint`, `committed`, `phase`". (`errors/design.md` 3.5 does not list the omitted fields, so this is low severity.)

### 9. Small behaviour gaps (6 tests)

- `rename-delete.test.ts` "a new object whose name differs only by case from another also gets the notice": no `confusable_name` notice on `b = 3` when `B` exists (it is raised by Rename). Doc: `kernel/design.md` 15, `kernel/errors.md` 3, `errors/errors.md` 4 K106.
- `rename-delete.test.ts` "name_taken also for the bare form Rename(M, N)": gives `no_matching_form` when `N` is an existing object. Doc: ruling K1 (both forms do the same) and `errors/errors.md` 1.2 `name_taken` "`Rename` to existing".
- `drag.test.ts` "a Bool checkbox writes itself": `dragPlan` of a free Bool gives `not_draggable`. Doc: `kernel/design.md` 7 "Draggable if they are Points, sliders (Numbers with a range), Booleans (checkbox)".
- `events.test.ts` "a restyle line sends a style event, with no value event": two `style` events for one line. Doc: `kernel/design.md` 4.5 "one event per pass".
- `rename-delete.test.ts` "a fixed object can still be renamed": see choices below.
- `fuzz.test.ts` "API calls with junk arguments...": `apply(null)`, `apply(undefined)`, `suggestName(null)`, `suggestName(undefined)`, `stepTo(Symbol)` and `insertAt(Symbol, ...)` throw a `TypeError`. Doc: AGENTS.md "Nothing throws across a package boundary".

### 10. Doc conflicts the tests cannot settle (2 tests, product owner to decide)

- `save-load.test.ts` "the `animate` property of design 10 is accepted on a slider": `a = 2 in 0..5 step 0.5 with animate = oscillate` (the example in `kernel/design.md` 13.1, and 10) is `unknown_property`, because the key table in 9.1 has no `animate`.
- `redefine.test.ts` "works on a free Point: the doc example A = A + (1, 1)": `kernel/design.md` 8 and ruling K2 name this line as the example, but it is `type_mismatch` (Point + Point). The same test with a Vector (`A = A + v`) passes.

## Choices where the docs were silent (tests written to the closest reading)

- `suggestName`: `kernel/design.md` 14 says `A1`, `l1`, `c1`, `flag1`; `language/design.md` 3.7 says `A_1`, `l`, `c`, `cond1` (and README decision 16 keeps `A_1` for images). I followed the language doc. `poly1` and `text1` agree.
- A free `undefined` Number: `kernel/errors.md` says reason `not_set`, `language/design.md` says `explicit`. The test accepts either.
- Cause chain: `kernel/design.md` 6.4 says the cause "always names a root", while 4.2, README decision 2 and `errors/errors.md` say the nearest undefined input. I followed the README (nearest). `rootCause` and `describe().undefined.root` give the root.
- Cycle `path`: for longer cycles the docs only show `A -> M -> A`. The test requires that each name reads the next and the path closes on the first.
- Redefinition to the same text: the docs say "a plain update" and name the `redefined_to_same` notice; the test requires the notice and that the rule runs again.
- `setFree` with a value of the wrong type: an error (kind not fixed), figure unchanged. A slider write is clamped into its range (`numbers-sliders/design.md` 3.3).
- Deleting an unfixed object whose dependent is fixed: either a `locked` error with the figure unchanged, or a cascade that reports the removal. The test accepts both.
- Renaming a fixed object is allowed (design 9.7 lists drag, slider, redefine and delete, not rename). The implementation refuses it.
- `fromScript` of text with no `@fig` header loads as version 1. CRLF line endings load, with correct line numbers. A `@fig` version larger than 1 gives `version` (K042).
- Lenient load counts: `applied` counts lines that took effect (comments and directives included), `skipped` equals the number of failed lines; only `skipped === errors.length` and `applied >= objects` are asserted.
- An unclosed bracket in a script swallows the next line as a continuation (README decision 17), so the lenient-load syntax test uses `A = * 2` instead.
- `slice` of a target that does not read the source returns the target's current cell for every value.
- `movePlan(...).ok` is not asserted (the docs do not say what it means when other objects must move); `alsoMove` is.
- `Delete(th)` on a state that another state's rate reads: only `th` and the objects that read its value must go.
- A rule whose style value gives no number falls back to the plain property (the default once a rule replaced a value).
- `listener_failed` may be reported on the line's `notices` or through `takeWarnings()`; either passes.
- `setClock(NaN)` and `setClock(-Infinity)` must leave a finite, non-negative `t`. `+Infinity` on an open-ended film is not tested.
- Lists of numbers come back as typed arrays (`performance.md` 5.7), so tests compare them element by element with `Array.from`.
- `bad_range` for a bad `step`: only the kind and code are checked (the docs fix the span for `5..0` only).
- Unterminated string: the span is the opening quote (`language` and `errors.md` give the column of the start).
- `bad_character`: `×`, `÷` and `−` are normalised by the language (`language/design.md` 3.1), so the golden cases use other-script letters, digits and emoji.
- Timing limits are 10 to 30 times the doc targets (for example flush of 200 downstream: 15 ms against 0.5 ms; 5,000-object slider update: 250 ms; 1,000-line load: 1.5 s). Measured values on this machine are well inside them: each 5,000-object test finishes in about 0.2 s including the build.
- The tests register their own small command set (Midpoint, Line, Parallel, Intersect, Distance, Segment, Circle, Translate, PointOn, Vector, Reciprocal, Boom, Unlucky, Defined, Pair, Orbit, Range, Total, Length, Center) through the public `CommandSpec` contract, because the kernel ships no geometry commands.

## Observations that are not failing tests

- `CommandRule` has no way to declare that a rule reads the clock. `RuleCall.t` exists, but a rule that reads `call.t` is not re-run on a seek. The tests pass `t` as an argument (`Orbit(2, t)`), which works. The motion area will need a declaration or must always pass `t` as an argument.
- `reasonPhrase('input_undefined')` returns a flat phrase ("depends on an undefined object"); the doc table has slots for `{cause}` and the root phrase. Nothing fills them in, so the UI has to build the sentence itself.
- The solver passes the accuracy targets of `animation-time` 7.3 that are tested (harmonic oscillator over 100 periods, damped oscillator against the closed form, pendulum period), and the whole `clock-states.test.ts` file runs in about 0.3 s.
- Rulings K9 (memory per object) and K10 (rate evaluation) are known gaps and are not tested.

## Isolation

- Read: `docs/` only (the kernel, errors, language, animation-time and numbers-sliders feature docs, README, the core design, performance), the existing `packages/kernel/test/spec/language/` tests (for helper style), `packages/kernel/src/index.ts`, `packages/kernel/src/contracts/`, and the "Public API" section of `handoff/kernel/builder-notes.md` (lines 79 to 123).
- The exported type declarations were read from a `.d.ts` emit that `tsc --declaration --emitDeclarationOnly` wrote to a scratch directory. They hold signatures and doc comments only, no function bodies. No other file under `packages/kernel/src/` was opened. No file under `handoff/kernel/` other than the Public API section was read.
- Tests import only `@incantly/kernel` (the package entry).
- Two throw-away probe test files were used to see the shape of results through the public API; they were deleted and never committed.
