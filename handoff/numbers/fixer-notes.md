# Numbers area: fixer notes

Branch `feat/numbers`. Code in `packages/kernel/src/commands/numbers/`. The kernel core, the other areas and
`packages/kernel/test/spec/` were not edited.

## Fixer round

Input: `handoff/numbers/test-report.md` (474 spec tests, 97 failing).

**Result: 474 spec tests, 416 pass, 58 fail.** The full suite is 3,954 tests: 3,896 pass, 58 fail, and every
failure is in `packages/kernel/test/spec/numbers/`. Of the 58, 54 need a kernel change (listed under "To be
implemented (kernel)") and 4 are contested.

### Commits (all on `feat/numbers`, each staging only `packages/kernel/src/commands/numbers/`)

| Commit | Group |
|---|---|
| `9323952` | `resume = false`; 500-animating limit; `animated_input` on Animate through the API |
| `df5ac67` | `@digits` / `@sig` read from the figure; `bad_range` carries the step |
| `f6ddddf` | Learner gestures run `change` handlers; `click` event; `discarded` list; Choice summary |
| `5f2eaa4` | Handlers follow renames and deletes; `SetValue(L[k], v)`; loop variable in guards; `out_of_range` skip; `on` as a step |
| `d8497dd` | `Reset` is one undo entry and skips unchanged lists |
| `5f42fec` | Angle unit from the literal; input nesting depth; Function box text; `clamped` notice `from` / `to`; `target_not_free` |
| `31b92b4` | `place = screen(x, y)` and `at(x, y)` |
| `5baadd8` | One `change` event builder for every write path |
| `7df8d89` | `min`, `max`, `step` as handler steps |

The notes file is committed after these.

### Fixes, with the rule applied everywhere it applies

1. **Learner gestures run handlers** (`controls-scripting/design.md` 210 to 224). One function, `emitChange`
   (`valuewrite.ts`), now both tells host listeners and, for `by: 'learner'`, runs the `change` handler of the
   object and then `on figure change`. Every write path ends there: numbers, bools, texts, points, vectors,
   dropdown picks (index and caption), list elements, input commits (including Function targets). Writes by the
   host and writes a handler makes raise no handler, so handlers cannot loop. Tests: 7 in `run.test.ts`.
2. **Host events.** `clickButton` reports `trigger` as `learner` or `host` (the Click action keeps
   `click_call`) and emits `click` even when no handler exists. A dropdown `change` carries the chosen value and
   the 1-based `index`. `events.ts` builds the `change` event for all paths, including writes made inside a run.
3. **Run abort lists what it discarded** (`handler_limit` for steps and for Click depth), and names the handler.
4. **Handlers follow their objects** (`handlers.ts`, through `figure.on`): a rename rewrites step text (outside
   text literals, with name boundaries that also catch `a+a`); deleting a target parks its handlers and an undo
   that brings the object back restores them; undo and redo of a rename rewrite the steps again.
   `rewriteStepsForRename` and `stepsMentioning` use the same name matching.
5. **Steps.** The loop variable is known in the guard. `SetValue(L[k], v)` and `SetValue(L, k, v)` are valid and
   run (the overlay holds the list with the element replaced; `discarded` shows `L[k]`). `SetValue(d, i)` on a
   dropdown or input box is not `not_free`; a computed index outside the options skips with `out_of_range`; a
   constant one is `bad_index` at definition. Another `on` line as a step is `handler_structure`. `a with min =
   0`, `max`, `step` (constant, or `auto` for `step`) are valid steps and run as a `rerange` line
   (`rangestep.ts`); a formula is `handler_graph_change`; `none` is refused with a reason (no kernel operation).
6. **Reset** restores through the `slider` write kind and commits one gesture, so it is one undo entry. Objects
   that still hold their initial value are skipped, which also fixes the free-List failure; a changed list is
   rewritten through its literal (`restoreList`).
7. **Animation.** `resume = false` leaves the animation stopped after a release. `animateAll` and `Animate(on)`
   refuse more than 500 sliders with a `limit` error (`limit` 500, `actual` n) and start none. `Animate` of a
   slider that a rate reads is `animated_input` (rates are read from the script; dependents from the kernel
   graph); `Animate(true)` skips such sliders.
8. **Units.** The unit regex missed `30deg` because there is no word boundary between a digit and a letter. Fixed
   once in `inferUnitFromDefinition`: reads only the text after the first `=` (never the name), finds `deg`,
   `turn`, `grad` alone or glued to a number, and `°` / `Angle(`. This fixes the display unit, the 5 degree auto
   step, the slider in radians and "redefinition keeps the unit"; `animate.ts` and `format.ts` use the same
   function.
9. **Rounding directives.** `@digits N` and `@sig N` are read from the figure's script (cached; refreshed on
   `directive`, `undo`, `redo` events). `setFigureDefaults` still wins when the host sets it.
10. **Input boxes.** Nesting depth counts brackets in the text (the typed tree drops plain parentheses). A
    Function target shows its body. A target that stops being free disables the box with `target_not_free`
    (the box rule asks `RuleCall.slice` whether the target is free).
11. **Notices and errors.** `clamped` carries `from` and `to`. `validateSliderRange` returns the step in every
    `bad_range` result. A Choice summary reads `Red (1 of 3: red, green, blue)` (caption, then the values).
12. **`place`.** `place = screen(x, y)` / `at(x, y)` work: `place` is a text property and `screen`, `at` are
    functions of this area (in `withNumbersFunctions()`). `placeX` and `placeY` (the interim spelling) are gone;
    `anchor` stays.

### Contested tests (left failing)

| Test | Doc lines that show it is wrong or unclear |
|---|---|
| `bools` > the caption is the label, and the name by default | `docs/features/kernel/design.md:347` types `label` as `'name' \| 'value' \| 'both' \| 'caption' \| 'none'` and `:382-383` lists `caption` as the Text property; `numbers-sliders/design.md:153` says `label` is text. Two feature docs disagree; the merged kernel follows the kernel doc. Product owner to decide; the numbers docs should say `caption`. |
| `lines` > a text label sets the caption of a slider | Same conflict as above. |
| `lines` > a label longer than 120 characters is a limit error | Same conflict (the kernel's `label` is a word; a long text goes to `caption`). The 120-character `limit` for `caption` also needs the kernel (K2). |
| `lines` > a step larger than the range is allowed | `numbers-sliders/design.md:263` says allowed, but `docs/features/algebra-view/errors.md:13` ("step larger than the range" is `slider_range`) and `:140` say it is an error, and the merged kernel (`checkRange`) refuses it. Product owner to decide. |

### To be implemented (kernel)

Each item says what the kernel lacks. Checked against the public hooks: `ActionRule` outcomes
(`{ summary, data }` only; a throw becomes `internal`), `registerTypeStyle`, `registerPropertyTypes`, `PROPERTIES`,
`FIELDS`, `RuleCall.slice`, `figure.on`. None of them reaches these cases.

| # | Missing in the kernel | Tests (58 total fail; 54 here) |
|---|---|---|
| K1 | **Action error and notice channel.** `ActionOutcome` needs `error?: ErrorObject` (returned to the caller of `apply`) and `notices?: Notice[]` (into the result). `applyAction` today wraps every outcome in `okResult`. The area already computes the full errors (`not_animatable`, `animated_input`, `not_free`, `bad_index`, the `clamped` notice) and keeps them in a side table. | animation: Animate(b), Animate(r), draw `animated_input`; bools: Toggle dependent; controls: `SetValue(d, 9)`; setvalue: dependent `SetValue`, `Click(a)`, `SetValue(a, 15)` clamped notice. 8 |
| K2 | **Line-time checks for area commands and for range lines.** A `CommandForm.check(args, figure)` hook that returns an `ErrorObject` at definition; and, in `checkDefine` / `checkRange`: `not_free` for a range on a dependent number, `limit` above 10^6 steps (with `limit` and `actual`), a range that reads its own slider (`cycle` with path), `bad_range` params `min` / `max` / `step`, `unit_mismatch` (the area's `checkSliderLineUnits` is ready), the 100-control `limit`, `animated_input` on a rate line (the area's `animatedInputError` logic is ready). Parser messages for `a = 3 in 0 10` (kind `syntax`, "Expected '..' between the two ends"), `a = 3 step 1` ("'step' only follows a range", with hint) and `a = 3 in 0..10 step` ("Expected a number after step"). Input targets that are dependent, a Button or a List must be `bad_input_target` at definition (today `no_matching_form`, or an accepted line with an undefined box). | input x3; controls limits x2; animation rate line; lines: dependent range, `unit_mismatch` x2, valid hint, `bad_range` params, 10^6 steps, cycle, three parse messages. 16 |
| K3 | **Notices and values from define lines.** A hook so a free Number with a range is committed through the area's `commit` at definition and redefinition: snap of an initial value off the grid (with `snapped`), `unit_inferred`, `range_kept`, and `clamped` with `from` / `to` (the kernel's own `noteClamped` has `name`, `value`, `end` only). | lines: `unit_inferred`, `range_kept`, clamped `from`/`to`, snapped initial. 4 |
| K4 | **Range keys in `with`.** `min`, `max`, `step` as `with` keys that edit the range (a style-key handler that issues a `rerange`), `step` accepted by the parser as a property name, and the words `none` / `auto` as values (`showIf = none`, `min = none`, `step = auto`). Until then `applySliderRange` and handler steps (fix 5) are the only way. | bools: `showIf = none`; handlers: restyle row `showIf = none`; lines: `min`/`max` together, `step = auto`, dependent `not_free`, `min = none`. 6 |
| K5 | **Field evaluation.** `fieldOf` in `language/compile.ts` is a fixed switch with no area hook, so `FIELDS` entries check but evaluate to undefined. Needed: an evaluator registered next to `FIELDS` (`a.min`, `a.max`, `a.step`, `a.animating`, `d.index`, `d.count`, `q.text`, `q.valid`), element-typed fields (`d.value` has the option type), and call syntax on a field (`g.value(x)`). | controls x3; input `q.text`; lines `a.min`, `a.animating`. 6 |
| K6 | **Constants `turn`, `grad`** and the literal suffixes `0.5turn`, `0.5grad`. `BUILTIN_CONSTANTS` is copied into a private map at load. | maths x3 |
| K7 | **Dynamic slider bounds.** The kernel's range evaluation must make the slider undefined (`range_undefined`, `empty_range`), restore the last value clamped when the bound returns, and re-commit when a dynamic step changes. | animation x4 |
| K8 | **The `on` line kind** in `Figure.apply` (one undo entry), `toScript`, the `Delete` result (`handler_orphan` list), and a word literal for `ClearHandler(go, click)`. The area has the parser, store, `handlersToScript` and `stepsMentioning` ready. | handlers x5 |
| K9 | `setFree` needs a way to write "undefined with reason" so `SetValue(a, inf)` on a slider gives `not_finite` (today `explicit`). | setvalue x1 |
| K10 | A bare word such as `dock` as a value of a text property (a prop-value hook). `place = "dock"` works; `place = dock` is `unknown_name`. | lines x1 |

## Second fixer round

All the kernel items above (K1 to K10) are now in place, and every numbers spec test passes (lint, typecheck and the
whole suite are green: 6258 passed, 9 skipped, the skips are the functions area's).

| # | What was added |
|---|---|
| K1 | `ActionOutcome` has `error` and `notices`; `applyAction` returns the error to the caller of `apply` and puts the notices in the result. Actions report through it unless they run inside a handler. |
| K2 | `registerLineCheck`: a check that runs after the language check and before commit. The numbers check gives `not_free` for a range on a computed number, `unit_mismatch` with the fixed line, the 100-control `limit`, `bad_input_target` and `animated_input` on rate lines. The language gives the `bad_range` params, the 10^6-step `limit`, the bound cycle and the three parse messages. |
| K3, K4, K10 | `registerLineRewriter`: an area may read a line before it is parsed and put another line in its place, add notices, or refuse it. The numbers rewrite handles `a with min/max/step`, `none` and `auto`, `range_kept`, a snapped initial value, `unit_inferred`, `label = "text"` on a control (it becomes the caption, at most 120 characters), and `place = dock`. A rewrite may set `dropRange`, so `a with min = none` turns the slider back into a plain number. |
| K5 | `registerFieldReader` evaluates the fields an area adds; `registerFieldTyper` types a field from the object (`d.value` has the type of the options). A field can be called: `g.value(x)` calls the function the dropdown holds. |
| K6 | The constants `turn` and `grad`. |
| K7 | A slider whose bound is undefined or crosses is undefined with `range_undefined` or `empty_range`. It keeps its last value and gets it back, clamped, when the range returns. A dynamic step that changes re-snaps the value. |
| K8 | `registerLineHandler`: an area may carry out a whole line itself, recorded as one `ext` undo entry with its own undo and redo. `on` lines and `ClearHandler(go, click)` go through it. `registerScriptTail` puts the `on` lines at the end of `toScript`, and `registerDeleteNotes` adds `handler_steps_broken` (N125) to the result of a delete. |
| K9 | `setFree` takes a `reason`, so `SetValue(a, inf)` on a slider is undefined with `not_finite`. |

**Contested, decided by the numbers design:** a step larger than the range is now allowed (only the two ends are left),
as `numbers-sliders/design.md` section 4 says. `algebra-view/errors.md` still lists it as an error; that line should be
changed when the product owner agrees. A step that is not finite is still `bad_range`.

## What changed in the public API

- `emitChange` (exported from `valuewrite.ts`, not from the package index) is the single write notifier.
- `clickButton(figure, name, { by, trigger })`: new `trigger` option.
- `restoreList(figure, id, value)` in `valuewrite.ts`.
- `withNumbersFunctions()` now includes `screen(x, y)` and `at(x, y)` (they return the placement text).
- `placementOf` / `parsePlacement` read `place` as text; `placeX` / `placeY` no longer exist.
- `inferUnitFromDefinition` reads only the right-hand side.
