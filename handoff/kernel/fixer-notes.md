# Kernel and errors area: fixer notes

Branch `feat/kernel`. Fixer, step 3.

## Round 1

Result: `npx vitest run` gives 3,171 tests, all passing (2,118 language tests, 1,053 kernel and errors spec tests; the 48 failing spec tests are fixed). `npx eslint .` and `npx tsc -p tsconfig.json` are clean. No spec test is contested. Nothing under `packages/kernel/test/spec/` was edited.

### Fixes by cause

| # | Cause | Fix |
|---|---|---|
| 1 | Host limits ignored at line time | `LangLimits` (`language/source.ts`) is passed to `parseLine` and `checkLine` (`ParseOptions.limits`, `CheckOptions.limits`). The lexer, the parser and the checker read line length, depth, expression nodes, list size and objects from it; the language's own values stay the default when no host limits are given. The figure builds it once (`FigureCore.langLimits`) and `apply` passes it, so `new Figure({ limits })` and `fromScript(..., { limits })` both reach the checks. Limit names are now the doc names: `depth` (was `nesting_depth`), `expr_nodes` (was `expression_nodes`), `list_size` (was `list_literal`). |
| 2 | Run-time `limit` reason never produced | `FigureCore.sizeChecked` makes a cell undefined with reason `limit` when a rule's result (or one part of a tuple) is a list longer than `listSize`. `Env.maxList` carries the same limit into the language's own `[a..b]` range at run time. |
| 3a | Replacing a rate rule had no effect | `applyRate` now settles the state after the rule changes (a write to the rule used to wait for the next clock move, and a seek to the same time did nothing). |
| 3b | One blown-up state made unrelated states undefined | `StateSolver` forms connected groups (states whose rates read each other, directly or through objects). A group that blows up, or whose rate is undefined, is put out at that step and keeps its last values; every other group keeps stepping. `unstable_state` names the states of the failed group. A state whose initial value is undefined is a group failed at step 0. |
| 4 | `acceptsUndefined` rules got `NaN` | `runCommand` passes `undefined` (not `NaN`) for an undefined Number argument, also through `evalArg` and the `invert` call. |
| 5 | Error suggestions | `FigureTx.repaired` runs on every error leaving `apply`, `rename`, `delete` and `setFree`: it adds the line that defines an unknown name (`k = 1 in 0..10`), and tries each suggested line with a dry run, keeping only lines that pass (at most 3). `type_change` now suggests a free name (`c2 = Circle(O, 2)`) and its hint says what Delete would take (`this removes 2 objects that use c: d, g`). `forward_reference` on `insertAt` suggests the line without a position. `not_free` suggests `M = <value>` instead of the invalid `M = ...`. |
| 6 | Error details | `locked` points at the whole line (both define and restyle-like paths). `unknown_property` is checked per object type at line time (`CheckOptions.propertyKeys`), lists every valid key (`ErrorExtra.uncapped`; only the compact form caps at 8), puts `color` first, and the hint is `Did you mean color?`. `bad_property_value` keeps `fix_line` with its suggestion. `unbalanced` is phase `lex` in the registry and in `err()`. `no_matching_form` reads `{command} has no form ({given}).` |
| 7 | Message keys | Keys follow the area of the code: K codes are `kernel.<kind>`, C codes `cmd.<kind>`, T codes `tool.<kind>` (`messageKeyFor` in `language/errors.ts`, applied in `buildError` and in the registry). Templates are copied to the new keys at load. |
| 8 | Compact error kept `fingerprint` and `committed` | Both are dropped from `compactError`. |
| 9a | `confusable_name` on a new object | `applyDefine` raises it when a new name differs only by case from an existing one (`Rename` already did). |
| 9b | `Rename(M, N)` with an existing `N` | `rewriteRename` reads a bare name as the new name unless it names a Text object, so `name_taken` comes from `doRename` as for `Rename(M, "N")` (K1). |
| 9c | A fixed object could not be renamed | The `locked` check is removed from `doRename`. |
| 9d | A Bool was not draggable | `planDrag` accepts a free Bool. |
| 9e | A restyle sent two style events | The explicit `queue({ ev: 'style' })` in `applyRestyle` and `Show`/`Hide` is gone; `applyPersist` already marks the style for the one event of the pass. |
| 9f | Junk arguments threw | `apply`, `suggestName`, `stepTo`, `insertAt`, `setBeats`, `setClock`, `toScript`, `append`, `fromScript`, `undo`, `applyBatch`, `drag`, `setDemand`, `on` and the `Figure` constructor now check their arguments. `insertAt` with a position that is not a whole number from 0 to the object count returns `bad_argument` (it used to clamp). |
| 10 | `animate` (K11) | `animate` is in the property table (`language/props.ts`) as an enum (`off`, `oscillate`, `forward`, `backward`, `bounce`, `loop`, `once`), valid on every type. The kernel stores it in `ext`; its meaning is the motion area's. |

### Extra places fixed (same rule, other cases)

- Limits: `defmany` counts every new name against the object limit (`P, Q = Intersect(...)` at the limit used to pass); the range check `[a..b]`, the list literal check and the rule-result check all read `listSize`; the printed re-parse of a redefinition keeps the limits.
- Messages and keys: every kind of the registry got its area key, not only the four named in the tests (`cmd.type_mismatch`, `cmd.bad_range`, `cmd.no_matching_form`, `tool.input`, `tool.busy` match the doc examples 5.4, 5.5, 5.7, 5.9). `unknown_property` and `bad_property_value` carry the params their template needs (`type`, `token`).
- Suggestions: vetting runs for API errors too (`rename`, `delete`, `setFree`), not only for lines. The `forward_reference` of `move` has no line form to suggest, so its hint names the objects that have to move with it.
- Junk arguments: a probe (not committed) called every public method of `Figure` with 19 junk values in 8 argument shapes; all return an error or do nothing.
- Solver: the dead-group rule applies to Point states and second-order states (velocity) as well as plain Numbers.

### Doc conflicts that the product owner should settle

1. `unbalanced` phase. `docs/features/errors/errors.md` section 2 and example 5.2 say `lex`; `docs/features/language/errors.md` section 3 lists it under parse and `packages/kernel/test/spec/language/errors.test.ts` line 30 expects `parse`. The registry (`errorTable`, `err()`) says `lex`, as the kernel/errors spec test needs; the language lexer still reports `parse`.
2. Range limit name. `docs/features/errors/errors.md` 5.8 and `docs/features/kernel/errors.md` section 6 name a list that is too long `list_size`; `docs/features/language/errors.md` (the JSON example after section 7) names the `[a..b]` case `range_elements`. The range check keeps `range_elements` (its maximum is now the host's `listSize`).
3. `animate` values. `docs/features/kernel/design.md` section 10 uses `oscillate`, `forward`, `backward`; `docs/features/animation-time/design.md` 5.2 uses `off`, `bounce`, `loop`, `loop-down`, `once`, `once-down`. The table accepts every value that is a plain word in both (`loop-down` and `once-down` are not plain words). The motion area should settle the set.
4. Expression nodes. `docs/features/kernel/errors.md` section 6 says 400 per line; `docs/features/language/errors.md` section 7 says 2,000. The kernel default is 400 (`DEFAULT_LIMITS.exprNodes`); the language alone keeps 2,000.

### Contested tests

None.

### Not done

- `setClock` to a very large time with states (for example `1e9`) integrates every step; there is no step budget. Out of scope for this round.
- Memory per object (K9) and the flat rate program (K10) stay as the rulings say.

### Commits

`c9685a4` limits (causes 1, 2); `5e3da16` solver (3a, 3b); `17a4649` `acceptsUndefined` (4); `a98b6ba` message keys, per-type property keys, `animate`, wording, phase (6, 7, 10); `0ec0aab` and `fe65662` suggestions, locked, rename, confusable (5, 6, 9a to 9c); `c684813` compact error (8); `b8b694e` junk arguments, Bool drag, style event, insertAt, API vetting (9d to 9f).

## Round 2 (checker findings)

Branch `feat/kernel`. Fixer, step 5, the only fix round. All 20 findings of `handoff/kernel/findings.md` (KERN-SM-1 to 20) are `status: fixed`, each with a one-line `fix:` note there. `npx eslint .` and `npx tsc -p tsconfig.json` are clean. `npx vitest run` gives 3,370 tests; 3,369 pass and 1 is contested (below). Nothing under `packages/kernel/test/spec/` was edited.

### Fixes by group

| Group | Findings | What changed |
|---|---|---|
| D. Budgets and bounded text | 1, 2, 7 | `Limits` gained `items` (5,000), `lines` (20,000) and `textLength` (10,000). `applyBatch` and `load` refuse over `lines` or `fileSize`; comments and directives count against `items` (also in dry runs). `err()` clips caller text in params, token, key, related and hint; `compactError` shortens hint, token and message last so it always fits 800 characters. Directives are found by a `Map<name, index>` (`insertItem`/`removeItem`), also used by `clockRange` and the solver step. The journal measures an entry by the texts it holds, cached per entry. |
| Registry | 3 | A `CommandRegistry` given to `Figure` is copied; the kernel actions are added only to the figure's own copy. |
| F. No throw, no re-entry | 4 (getter), 6, 8, 19 | `setFree` copies Points and Vectors inside a `try`. `pull` is iterative. A figure operation called while a rule runs returns `tool_busy`; `faults` is capped at 100 and cleared per frame; a frame that throws returns an empty delta. Exported table lookups use `Object.hasOwn`. |
| 4 | 4 | `setFree` rejects a `why` outside the five, `solver` on a non-state, and a Text over `textLength`. |
| E. Clock and solver | 5, 16 | `setClock` rejects a non-finite time. One `sync` takes at most 400,000 grid steps; a farther seek leaves the states undefined (`timeout`) and later flushes catch up. Checkpoints are capped at 2,000 by doubling the spacing. After a structure change the solver compares a signature (states, rates, everything they read, step, film start) and keeps its checkpoints when it is unchanged. |
| A. History in a group | 9, 15 | `Journal` counts `begin`/`end` depth (only the opener closes the group), `Undo()` and `Redo()` inside an open group act on the group's own entries (a group-local redo list), `snapshot`/`restore` bring both stacks back. `beginUnit`/`rollbackUnit` are shared by `applyBatch` and `load`. `deliver` is re-entrant safe. |
| B. Rejected means unchanged | 10 | `apply` keeps a log of the entries it recorded and the undo or redo steps it took; any failure after a change unwinds the log newest first (`Journal.putBack` returns a taken entry to where it came from) and drops the events the line queued. |
| C. Gestures | 11 | `apply`, `delete`, `rename`, `move`, `load` and `setFree` with `show_me` or `api` commit an open gesture first. |
| G. Save format | 12 | `setFree` on a Text parses the saved line and refuses (`bad_argument`, or `limit` for the line length) a text that does not read back. |
| Steps | 13 | `insertAt` moves the `@step` items after the previous object onto the new object; `move` and a redefinition's reorder anchor each `@step` again in front of its marked object. Journalled for undo and redo. |
| Dry run | 14, 20 | A dry run of a definition, restyle, rerange or rate runs the whole commit and `apply` takes it back (journal, redo stack, next id, reveal cursor, pending events and values restored). One `clamped` notice: the kernel's replaces the checker's. |
| Speed | 17 | Case-insensitive names come from a map, `renumber` starts at the insert or remove position, and the solver reads a maintained set of state objects (a 20,000-object chain builds in 0.3 s). |
| Events | 18 | The listener-failure count resets at the start of each operation; `flush` and `setClock` return it as `FrameDelta.listenerFailures`. |

### Extra places fixed (same rule, other cases)

- Budgets: `load`, `append`, `fromScript`, `applyBatch` and `insertAt` all go through one `lines`/`fileSize`/`items` check; every directive and comment path counts, dry runs included.
- Error text: all `err()` callers (`need`, `doRename`, `fail`, `setFree`, `move`, `slice`, `describe`) are covered at the one constructor.
- `busy` guards: `apply`, `delete`, `rename`, `move`, `undo`/`redo`, `applyBatch`, `setFree`, `commitDrag`, `setClock`, `stepTo`, `flush`, `load`.
- Atomic rollback of a line applies to actions another area registered (an action that changes the figure and then throws) as well as to `Undo()`.
- Own-key lookups: `defaultsFor`, `validKeysFor`, `makeNotice`, `reasonPhrase`, `err`, and `registerReasonPhrase('__proto__')`.
- Dry run: rerange, rate and restyle follow the commit path too, not only definitions.

### Decisions and what is not done

- KERN-SM-12: the language has no escape for `“`, `”`, `„` or a carriage return in a Text, so those texts are refused by `setFree` instead of written. Adding `\u{...}` is the language area's change; once it exists, the refusal in `FigureHist.textReadsBack` can go. A free Text is also limited to what fits one saved line (`lineLength`, 2,000), though `textLength` is 10,000 (a rule can build a longer text).
- KERN-SM-1: one group can still hold up to `lines` (20,000) entries, so the byte cap can be exceeded by one large batch; the line, item and object budgets bound it.
- `delete`, `rename`, `move`, `setFree` and the public `undo`/`redo` still report a change as made when a rule throws during their pass (the cell is `not_finite`); only `apply` rolls back, as K5 says.
- The `limits` doc table (`docs/features/kernel/errors.md` section 6) does not list `items`, `lines` and `textLength`; the product owner should add the rows.

### Contested regression test

- `packages/kernel/test/spec/kernel/regressions.test.ts`, "KERN-SM-18 ... a failure during an undo is not reported on the next line". The listener throws once on a `value` event. `figure(['a = 1', 'b = 2'])` then `f.undo()` takes back an `add`: the events are `remove` and `undo`, and no `value` event (`docs/features/kernel/design.md` line 206: `{ ev: 'value'; ids }  // batched per pass`; a removed object changes no value). The listener is still armed, so it throws on the `value` event of `apply('c = 5')`, and the failure is correctly reported on that line. The test needs an undo that changes a value (for example undo of `setFree(..., 'api')`) to test what it means to test.

Two other tests were first contested (a `z` object name, which `docs/features/language/design.md` line 235 reserves; a 10 s seek that needs 9,600 rule runs at 4 per RK4 step, `docs/features/animation-time/design.md` 7.3); the tester has already corrected both.

### Commits

`cfbc6ec` budgets, error text, registry, setFree, directives (1, 2, 3, 4, 7); `d8929e7` and `af92cc8` seek budget, lazy pull, rule re-entry, solver signature, linear adds, Text round trip (5, 6, 8, 12, 16, 17); `41d446f` history in a group, line rollback, gestures, load rollback, delivery, listener failures (9, 10, 11, 15, 18); `a1a7795` step titles, dry run, own-key lookups, clamped notice (13, 14, 19, 20).

## Spec review fixes

Branch `feat/kernel`. Fixer for `handoff/kernel/review.md`, items A1 to A6, one round. All six are done; each has a status line in `review.md`. B and C items were not touched, except the `registerNotice` gap the review attached to A2.

### Fixes

| # | What changed | Files under `packages/kernel/src/` |
|---|---|---|
| A1 | `WriteWhy` has a sixth value, `'anim'`. `setFree(x, v, 'anim')` clamps and snaps like a slider, may write a fixed object, marks the value and its readers, and is never journalled and never joins a gesture. | `graph/hist.ts` |
| A2 | `registerTypeStyle(type, { defaults, freeDefaults, keys, drawable })`; repeated calls merge. `registerPropertyTypes` now merges the types of earlier calls. A type the core does not know takes the base drawable keys (`width lineStyle fill fillAngle fillGap`) unless `drawable: false`; `Bool`, `Text`, `Color`, `Particles` stay as they were. `registerNotice(kind, spec)` lets an area add a notice code. | `graph/props.ts`, `errors/notices.ts`, `errors/index.ts`, `index.ts` |
| A3 | `RuleCall` gained `ids`, `tol`, `work`, `limits`, `slice`; `InvertCall` gained `ids` and `tol`. `CompiledArg.ref` carries the object an argument names. Tolerance comes from `@tol N` (alias `@tolerance N`, checked as a positive number), then `FigureOptions.tolerance`, then `1e-9`; a change re-runs every rule, also on undo and redo. `Limits.ruleWork` (100,000) caps the steps of one run. `Figure.slice` and `RuleCall.slice` share one implementation that saves and restores the environment (reason, clock, locals) as well as the cells, so it is safe inside a running rule. | `graph/core.ts`, `graph/registry.ts`, `graph/tx.ts`, `graph/types.ts`, `graph/figure.ts`, `errors/limits.ts`, `language/compile.ts`, `language/lines.ts`, `language/props.ts` |
| A4 | `stepTo(n)` counts the steps `steps()` lists. The stored cursor is the list position of the first hidden object. The `cursor` getter returns the number of listed steps shown. | `graph/figure.ts` |
| A5 | The checker records the type each bare-name argument needs (`params.type` on `unknown_name`). The repair lists rewrites with an existing name first and sets `recovery: 'use_suggestion'`, then a define line of the needed type. The `Create slider` quick fix follows the same type. Single-letter constants are never near names. A one-letter name is near only to a case variant. `defineLine` for a Vector is `u = Vector(1, 0)`. | `language/check.ts`, `language/errors.ts`, `graph/tx.ts`, `errors/suggest.ts` |
| A6 | `applyBatch(lines, { group, mode?, dryRun: true })` runs the lines in a unit and takes the unit back. Later lines see earlier ones. Ids, redo stack, reveal cursor and an open gesture are put back; no event is sent. `BatchResult.dryRun` and `dryRun: true` on each success. | `graph/hist.ts`, `graph/types.ts` |

### Extra places fixed (same rule, other cases)

- A1: the `bad_argument` text for a wrong `why` lists all six reasons; the fixed-object check and the snap check treat `anim` like `slider`.
- A2: `registerNotice` (the review's closing note); keys from `registerTypeStyle` also reach `unknown_property` suggestions through `validKeysFor`.
- A3: `invert` rules get `ids` and `tol` too. `Figure.slice` no longer has its own copy of the evaluator. The `depth` limit also bounds nested `slice` calls.
- A4: the `cursor` getter changed with `stepTo`, so the two use one unit.
- A5: the one-letter and constant rules sit in `closestNames` and the checker's candidate list, so every caller gets them (`need`, property keys, directives, commands). The `Create slider` quick fix of the checker follows the needed type.
- A6: a dry batch works in both modes (`atomic`, `independent`) and with `force`.

### Names the tester assumed

The tests in `test/spec/kernel/spec-review.test.ts` use `'anim'`, `registerTypeStyle`, `RuleCall.ids/.tol/.work/.limits/.slice`, `work.limit`, `FigureOptions.tolerance`, `Limits.ruleWork` and `BatchOptions.dryRun`. The code uses exactly these names. The directive is `@tol N` (the name in the language table and in the points-lines and conics docs); `@tolerance N` is accepted as an alias.

### Not done

- Nothing in A1 to A6 is left. B1 to B16 and C1 to C11 are untouched (B16 is the one that still matters for rules that throw inside `delete`, `rename`, `move`, `setFree`).
- Animation-time still has to append `unstable` and `owned_by_solver` to `AreaUndefReasons` (B15).
- `docs/` was not edited (a doc editor owns it). The docs should say: `'anim'` in kernel design 10 and 11.2; the rule context fields in README 9 and curves-loci 3.8; `@tol` and `Limits.ruleWork` in kernel errors 6; `dryRun` on `applyBatch` in README 10.
