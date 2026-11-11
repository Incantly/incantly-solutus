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
