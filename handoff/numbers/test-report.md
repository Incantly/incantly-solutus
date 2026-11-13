# Numbers area: test report

Tester (step 2). Branch `feat/numbers`. Specs are in `packages/kernel/test/spec/numbers/`.

**Count: 474 tests. 377 pass, 97 fail.** Two consecutive full runs gave the same result. `npm run lint` and `npm run typecheck` pass on the spec files. Run with `npx vitest run packages/kernel/test/spec/numbers`.

A table test (`each(rows)(...)` in `helpers.ts`) is one test with several rows; a failing table lists the rows that failed. Rows are counted once.

## Pass and fail by doc section

| Spec file | Doc section | Tests | Pass | Fail |
|---|---|---|---|---|
| `animation.test.ts` | 3.4 fraction table | 5 | 5 | 0 |
| `animation.test.ts` | 3.4 once, start direction, random draws | 5 | 5 | 0 |
| `animation.test.ts` | 3.4 animationValueAt: the slider value at time t | 11 | 11 | 0 |
| `animation.test.ts` | 3.4 random mode | 3 | 3 | 0 |
| `animation.test.ts` | 3.4 on a figure: start, tick, stop | 24 | 24 | 0 |
| `animation.test.ts` | 3.4 dragging an animating slider | 4 | 3 | 1 |
| `animation.test.ts` | 4 and errors.md: Animate needs a free Number with a range | 6 | 4 | 2 |
| `animation.test.ts` | 3.4 sliders whose range is undefined | 7 | 3 | 4 |
| `animation.test.ts` | errors.md 2: animated_input | 5 | 2 | 3 |
| `animation.test.ts` | errors.md 2: limit on sliders animating at once | 1 | 0 | 1 |
| `bools.test.ts` | 3.6 a free Bool is a checkbox | 7 | 5 | 2 |
| `bools.test.ts` | 3.6 showif: visibility is a rule on a Bool | 15 | 14 | 1 |
| `commit.test.ts` | 3.3 step 1: a value that is not finite is undefined, never 0 | 2 | 2 | 0 |
| `commit.test.ts` | 3.3 step 2: clamp | 3 | 3 | 0 |
| `commit.test.ts` | 3.3 steps 3 to 5: snapping to lo + k*step | 7 | 7 | 0 |
| `commit.test.ts` | 3.3 step 4: the top end is reachable when the step does not divide the range | 2 | 2 | 0 |
| `commit.test.ts` | 3.3 automatic step | 5 | 5 | 0 |
| `commit.test.ts` | 3.3 angles: display-unit space and exact doubles | 4 | 4 | 0 |
| `commit.test.ts` | 3.3 empty and undefined ranges at run time | 3 | 3 | 0 |
| `commit.test.ts` | errors.md 3 numeric limits | 3 | 3 | 0 |
| `commit.test.ts` | 3.8 test plan: properties of commit | 4 | 4 | 0 |
| `commit.test.ts` | 7 performance: commit under 2 microseconds | 1 | 1 | 0 |
| `commit.test.ts` | 3.3 decimals(): the length of the shortest decimal string that reads back | 1 | 1 | 0 |
| `commit.test.ts` | 3.3 nice() and the automatic step | 2 | 2 | 0 |
| `commit.test.ts` | 3.3 Limits and errors.md bad_range: validateSliderRange | 5 | 4 | 1 |
| `controls.test.ts` | 3.1 Button | 3 | 3 | 0 |
| `controls.test.ts` | 3.1 and 3.8 Choice: a dropdown over a list | 10 | 6 | 4 |
| `controls.test.ts` | 3.1 bad_choice | 3 | 3 | 0 |
| `controls.test.ts` | 3.5 and 3.8 selecting | 7 | 5 | 2 |
| `controls.test.ts` | 3.9 limits on controls | 4 | 2 | 2 |
| `format.test.ts` | 3.5 rule 1 and 2: undefined and fallbacks | 2 | 2 | 0 |
| `format.test.ts` | 3.5 rule 6: auto format | 6 | 6 | 0 |
| `format.test.ts` | 3.5 rule 4: decimals round half away from zero on the decimal expansion | 4 | 4 | 0 |
| `format.test.ts` | 3.5 rule 5: significant figures | 3 | 3 | 0 |
| `format.test.ts` | 3.5 rule 3 and 7: units | 8 | 8 | 0 |
| `format.test.ts` | 3.5 text specs: parseFormatSpec | 3 | 3 | 0 |
| `format.test.ts` | 3.5 text specs: formatWithSpec | 7 | 7 | 0 |
| `format.test.ts` | 3.5 on a figure: per-object and figure-wide rounding | 15 | 14 | 1 |
| `handlers.test.ts` | 3.3 grammar: parseHandlerLine | 8 | 8 | 0 |
| `handlers.test.ts` | 3.3 which events a target has (bad_event) | 4 | 4 | 0 |
| `handlers.test.ts` | 3.3 steps: append, replace, list | 9 | 7 | 2 |
| `handlers.test.ts` | 3.3 what a step may be | 7 | 4 | 3 |
| `handlers.test.ts` | 3.3 steps are checked when the line is applied | 6 | 4 | 2 |
| `handlers.test.ts` | 3.3 and errors.md handler_cycle | 3 | 3 | 0 |
| `handlers.test.ts` | 3.9 and errors.md handler_limit at definition | 3 | 3 | 0 |
| `handlers.test.ts` | 3.3 ClearHandler | 3 | 2 | 1 |
| `handlers.test.ts` | 3.7 handlers and the rest of the figure | 6 | 2 | 4 |
| `input.test.ts` | 3.1 and 3.2 defining an input box | 9 | 4 | 5 |
| `input.test.ts` | 3.2 stage 5: commit by target type | 14 | 12 | 2 |
| `input.test.ts` | 3.2 and errors.md 4: a failed commit leaves the target and the figure alone | 7 | 6 | 1 |
| `input.test.ts` | 3.2 typing: validation without committing | 4 | 4 | 0 |
| `input.test.ts` | 3.2 and 7 fuzz: learner text never breaks the figure | 4 | 4 | 0 |
| `lines.test.ts` | 3.2 what each line makes | 9 | 8 | 1 |
| `lines.test.ts` | 3.2 range with a dependent number is not_free | 1 | 0 | 1 |
| `lines.test.ts` | 3.2 units: inferred from the literal, never from the name | 8 | 5 | 3 |
| `lines.test.ts` | 3.2 unit_mismatch: bounds on an angle are never silently reinterpreted | 3 | 1 | 2 |
| `lines.test.ts` | 4 edge cases: initial value, range and step | 13 | 8 | 5 |
| `lines.test.ts` | errors.md 2: parse-level cases | 7 | 3 | 4 |
| `lines.test.ts` | 3.2 redefinition keeps what it should | 8 | 5 | 3 |
| `lines.test.ts` | 3.3 dynamic bounds and the rulings on bound cycles | 8 | 7 | 1 |
| `lines.test.ts` | 3.2 style properties: values and defaults | 18 | 13 | 5 |
| `lines.test.ts` | 3.2 changing the range later: a with min = 0, max = 20, step = auto | 3 | 0 | 3 |
| `lines.test.ts` | 1 Read the slider: a.min, a.max, a.step, a.animating | 2 | 0 | 2 |
| `maths.test.ts` | 9.1 constants | 5 | 2 | 3 |
| `maths.test.ts` | 9.1 round(x, n): decimals | 1 | 1 | 0 |
| `maths.test.ts` | 9.1 sig(x, n): significant figures | 3 | 3 | 0 |
| `maths.test.ts` | 9.1 snap(x, step) | 2 | 2 | 0 |
| `maths.test.ts` | 9.1 wrap(x, lo, hi): into [lo, hi) | 4 | 4 | 0 |
| `maths.test.ts` | 9.1 approx(a, b, eps) | 3 | 3 | 0 |
| `maths.test.ts` | 9.1 the function group | 1 | 1 | 0 |
| `maths.test.ts` | 3.6 Number equality has a relative tolerance of 1e-12 | 3 | 3 | 0 |
| `run.test.ts` | 3.4 a run in order, as one transaction | 10 | 9 | 1 |
| `run.test.ts` | 3.4 steps: guards, loops, skipped steps | 13 | 10 | 3 |
| `run.test.ts` | 3.4 and 3.9 budgets: counted, not timed | 9 | 8 | 1 |
| `run.test.ts` | 3.3 events come from learner gestures only, so handlers cannot loop | 13 | 6 | 7 |
| `run.test.ts` | 3.6 and 7 host listeners | 4 | 3 | 1 |
| `setvalue.test.ts` | 3.3 and 3.5 SetValue on a slider goes through commit | 8 | 6 | 2 |
| `setvalue.test.ts` | 3.5 SetValue forms | 9 | 7 | 2 |
| `setvalue.test.ts` | 3.5 Reset restores the value an object had when it was defined | 7 | 5 | 2 |
| `setvalue.test.ts` | 3.5 Click | 2 | 1 | 1 |
| | **Total** | **474** | **377** | **97** |

### By file

| File | Area | Tests | Fail |
|---|---|---|---|
| `animation.test.ts` | numbers 3.4, errors 2 | 71 | 11 |
| `bools.test.ts` | numbers 3.6 | 22 | 3 |
| `commit.test.ts` | numbers 3.3 commit, 4, errors 3 | 42 | 1 |
| `controls.test.ts` | controls 3.1, 3.8, 3.9 | 27 | 8 |
| `format.test.ts` | numbers 3.5 | 48 | 1 |
| `handlers.test.ts` | controls 3.3, 3.7, 3.9 | 49 | 12 |
| `input.test.ts` | controls 3.2, errors 4 | 38 | 8 |
| `lines.test.ts` | numbers 3.2, 4, errors 2 | 80 | 30 |
| `maths.test.ts` | numbers 9.1, 3.6 | 22 | 3 |
| `run.test.ts` | controls 3.3 to 3.6, 5 | 49 | 13 |
| `setvalue.test.ts` | controls 3.5 | 26 | 7 |

## Failing tests

Every failure below is a difference between a doc line and what the public API does. Line numbers are in the file named. "Doc says" is paraphrased; "Gets" is what the build does.

| # | Test (file > section > title) | Doc line | Doc says | Gets |
|---|---|---|---|---|
| 1 | `animation` > 3.4 dragging an animating slider > with resume = false the animation stays stopped after the release | `docs/features/numbers-sliders/design.md:199` | resume = false: the animation stays stopped after release | resumeAnimation still returns true and sets an anchor |
| 2 | `animation` > 4 and errors.md: Animate needs a free Number with a range > through the draw channel: Animate(b) on a dependent number is an error result | `docs/features/numbers-sliders/design.md:268, docs/features/numbers-sliders/errors.md:28` | Animate on a dependent number is a not_animatable error in the draw result | apply returns ok with summary "Animate(b) failed" |
| 3 | `animation` > 4 and errors.md: Animate needs a free Number with a range > through the draw channel: Animate(r) on a number with no range is an error result | `docs/features/numbers-sliders/errors.md:28` | Animate without a range is not_animatable (reason no_range) | apply returns ok with a "failed" summary |
| 4 | `animation` > 3.4 sliders whose range is undefined > an undefined bound makes the slider undefined with reason range_undefined | `docs/features/numbers-sliders/errors.md:53, docs/features/numbers-sliders/design.md:178` | undefined bound gives slider undefined, reason range_undefined | slider stays defined; dynamic bounds do not drive the value |
| 5 | `animation` > 3.4 sliders whose range is undefined > a bound that crosses (min >= max) makes the slider undefined with reason empty_range | `docs/features/numbers-sliders/errors.md:54, docs/features/numbers-sliders/design.md:178` | min >= max at run time gives undefined, reason empty_range | slider stays defined |
| 6 | `animation` > 3.4 sliders whose range is undefined > the slider returns to its last defined value, clamped, when the bound returns | `docs/features/numbers-sliders/design.md:178` | slider is undefined while a bound is undefined and returns when it is back | slider never became undefined |
| 7 | `animation` > 3.4 sliders whose range is undefined > a dynamic step re-snaps the value | `docs/features/numbers-sliders/design.md:178` | a step that is a rule re-commits the value when it changes | value is not re-snapped (3.5 stays 3.5 for step 2) |
| 8 | `animation` > errors.md 2: animated_input > a rate that reads a slider set to animate is animated_input | `docs/features/numbers-sliders/design.md:202, docs/features/numbers-sliders/errors.md:29` | animated_input at definition (params slider, rate) | rate line accepted |
| 9 | `animation` > errors.md 2: animated_input > animating a slider that a rate already reads is animated_input | `docs/features/numbers-sliders/design.md:202, docs/features/numbers-sliders/errors.md:29` | refused with animated_input | Animate accepted |
| 10 | `animation` > errors.md 2: animated_input > the same refusal through the draw channel | `docs/features/numbers-sliders/design.md:202` | refused with animated_input | Animate(k) accepted |
| 11 | `animation` > errors.md 2: limit on sliders animating at once > 501 animating sliders is a limit error with the limit and the actual count | `docs/features/numbers-sliders/errors.md:34` | more than 500 sliders animating is a limit error | animateAll starts 500 and reports ok (cap applied silently) |
| 12 | `bools` > 3.6 a free Bool is a checkbox > Toggle of a dependent Bool is not_free, through the API and through a draw line | `docs/features/controls-scripting/design.md:259, docs/features/controls-scripting/errors.md:33` | Toggle of a dependent Bool is not_free | apply returns ok "Toggle failed" |
| 13 | `bools` > 3.6 a free Bool is a checkbox > the caption is the label, and the name by default | `docs/features/numbers-sliders/design.md:153` | show with label = "Show tangent" sets the checkbox caption | bad_property_value: kernel label is a mode word (doc conflict with the kernel property table) |
| 14 | `bools` > 3.6 showif: visibility is a rule on a Bool > showIf = none removes the condition | `docs/features/numbers-sliders/agent.md:14, docs/features/numbers-sliders/design.md:25` | showif = none removes the condition | unknown_name: none is not defined |
| 15 | `commit` > 3.3 Limits and errors.md bad_range: validateSliderRange > a bad_range result carries min, max and step as evaluated | `docs/features/numbers-sliders/errors.md:25` | bad_range carries min, max, step as evaluated | step missing from the range check result |
| 16 | `controls` > 3.1 and 3.8 Choice: a dropdown over a list > d.count and d.index can be read in an expression | `docs/features/controls-scripting/design.md:31` | d.value, d.index, d.count are readable | n is undefined (not_finite): field reads are not wired |
| 17 | `controls` > 3.1 and 3.8 Choice: a dropdown over a list > d.value can be read in an expression and has the option type | `docs/features/controls-scripting/design.md:31, docs/features/controls-scripting/design.md:117` | d.value has the option type | type_mismatch: A Choice has no field value |
| 18 | `controls` > 3.1 and 3.8 Choice: a dropdown over a list > function objects as options: h(x) = g.value(x) | `docs/features/controls-scripting/design.md:118` | g(x) = d.value(x) is allowed | missing_operator on g.value(x) |
| 19 | `controls` > 3.1 and 3.8 Choice: a dropdown over a list > the summary reads: Red (1 of 3: red, green, blue) | `docs/features/controls-scripting/agent.md:93` | summary Red (1 of 3: red, green, blue) | options listed as captions (Red, Green, Blue) |
| 20 | `controls` > 3.5 and 3.8 selecting > SetValue(d, 9) with a constant index is bad_index at definition time | `docs/features/controls-scripting/errors.md:32, docs/features/controls-scripting/design.md:268` | a constant index out of range is bad_index at definition | apply returns ok "SetValue(d) failed" |
| 21 | `controls` > 3.5 and 3.8 selecting > a learner pick tells the host: change, the value and the 1-based index | `docs/features/controls-scripting/agent.md:111` | change event carries the chosen value and the 1-based index | value is "…" and index is missing |
| 22 | `controls` > 3.9 limits on controls > the 100th control is accepted and the 101st is a limit error | `docs/features/controls-scripting/design.md:322` | 101st Button/Choice/Input is a limit error | no limit enforced |
| 23 | `controls` > 3.9 limits on controls > the limit counts buttons, dropdowns and input boxes together | `docs/features/controls-scripting/design.md:322` | limit counts all three kinds together | no limit enforced |
| 24 | `format` > 3.5 on a figure: per-object and figure-wide rounding > @digits 3 formats numbers with no own setting | `docs/features/numbers-sliders/design.md:219` | @digits N sets the default for numbers with no own digits | the directive is accepted but formatObjectNumber ignores it (only setFigureDefaults works) |
| 25 | `handlers` > 3.3 steps: append, replace, list > an on line is accepted by Figure.apply, as the core line kind it is | `docs/features/controls-scripting/design.md:154, docs/features/controls-scripting/design.md:369` | on is a line kind of the core parser | missing_operator |
| 26 | `handlers` > 3.3 steps: append, replace, list > toScript prints the on lines | `docs/features/controls-scripting/design.md:298` | toScript prints on lines | handlers are not in toScript |
| 27 | `handlers` > 3.3 what a step may be > the restyle * with a constant is a valid step | `docs/features/controls-scripting/design.md:185-186` | showif/min/max/step with a constant or none are valid steps | showIf = none: unknown_name; min/max/step: unknown_property |
| 28 | `handlers` > 3.3 what a step may be > the restyle * with a formula is handler_graph_change | `docs/features/controls-scripting/design.md:186, docs/features/controls-scripting/errors.md:26` | showif/min/max/step formulas are handler_graph_change | min/max/step give unknown_property (the properties do not exist) |
| 29 | `handlers` > 3.3 what a step may be > the step * is handler_structure | `docs/features/controls-scripting/design.md:187, docs/features/controls-scripting/errors.md:25` | another on line as a step is handler_structure | missing_operator (syntax error) |
| 30 | `handlers` > 3.3 steps are checked when the line is applied > a constant index outside the choice is bad_index | `docs/features/controls-scripting/errors.md:32` | SetValue(d, 9) is bad_index at definition | not_free: a Choice is treated as not free in a step check |
| 31 | `handlers` > 3.3 steps are checked when the line is applied > the loop variable is known in the guard too | `docs/features/controls-scripting/design.md:196-198` | k is a name in steps; the guard sits on the loop step | unknown_name: k in the guard |
| 32 | `handlers` > 3.3 ClearHandler > works through a draw line too: ClearHandler(go, click) | `docs/features/controls-scripting/design.md:30, docs/features/controls-scripting/design.md:263` | ClearHandler(go, click) is a command | unknown_name: click is not defined |
| 33 | `handlers` > 3.7 handlers and the rest of the figure > renaming an object rewrites the steps that name it | `docs/features/controls-scripting/design.md:297` | Rename updates step text | steps keep the old name |
| 34 | `handlers` > 3.7 handlers and the rest of the figure > deleting an object reports the handlers that used it | `docs/features/controls-scripting/design.md:297, docs/features/controls-scripting/design.md:341` | Delete result lists the broken steps (handler_orphan) | Delete result does not mention handlers |
| 35 | `handlers` > 3.7 handlers and the rest of the figure > deleting the target removes its handlers | `docs/features/controls-scripting/design.md:297` | Delete removes handlers on the object | handler still stored |
| 36 | `handlers` > 3.7 handlers and the rest of the figure > an on line costs one undo entry like any line | `docs/features/controls-scripting/design.md:299` | an on line is one entry like any line | missing_operator via apply |
| 37 | `input` > 3.1 and 3.2 defining an input box > a dependent target is bad_input_target and says which types are allowed | `docs/features/controls-scripting/design.md:148, docs/features/controls-scripting/errors.md:30` | Input on a dependent object is bad_input_target | accepted |
| 38 | `input` > 3.1 and 3.2 defining an input box > a Button as target is bad_input_target | `docs/features/controls-scripting/errors.md:30` | Input on a Button is bad_input_target | no_matching_form |
| 39 | `input` > 3.1 and 3.2 defining an input box > a type with no text form (a list) is bad_input_target | `docs/features/controls-scripting/errors.md:30` | Input on a type with no text form is bad_input_target | no_matching_form |
| 40 | `input` > 3.1 and 3.2 defining an input box > q.text and q.valid can be read | `docs/features/controls-scripting/design.md:31, docs/features/controls-scripting/design.md:150` | q.text and q.valid are readable | q.text is undefined |
| 41 | `input` > 3.1 and 3.2 defining an input box > a target that becomes dependent disables the box with reason target_not_free | `docs/features/controls-scripting/design.md:345` | box becomes disabled with reason target_not_free | redefinition accepted; box stays defined |
| 42 | `input` > 3.2 stage 5: commit by target type > a slider target is clamped and the result carries a clamped notice from 12 to 5 | `docs/features/controls-scripting/errors.md:71, docs/features/controls-scripting/design.md:139, docs/features/numbers-sliders/errors.md:151` | clamped notice {code clamped, from 12, to 5} | notice has no from/to params |
| 43 | `input` > 3.2 stage 5: commit by target type > a Function target takes the body: x^2 - 3 redefines f | `docs/features/controls-scripting/design.md:145` | the box shows the function body as text | box shows the word "function" |
| 44 | `input` > 3.2 and errors.md 4: a failed commit leaves the target and the figure alone > nesting of 16 is accepted and 17 is input_too_deep | `docs/features/controls-scripting/design.md:135` | nesting depth above 16 is input_too_deep | 17 nested brackets accepted |
| 45 | `lines` > 3.2 what each line makes > the automatic step of a 0deg..360deg slider is 5 degrees | `docs/features/numbers-sliders/design.md:174` | a 0..360 degree slider gives a 5 degree auto step | stepOf returns 0.05 rad (about 2.9 deg) |
| 46 | `lines` > 3.2 range with a dependent number is not_free > a = 2n in 0..10 is not_free and names its inputs | `docs/features/numbers-sliders/design.md:126, docs/features/numbers-sliders/errors.md:26` | a range on a dependent number is not_free | accepted; the line makes a dependent number and drops the range |
| 47 | `lines` > 3.2 units: inferred from the literal, never from the name > θ = 30deg gets display unit deg | `docs/features/numbers-sliders/design.md:132` | a literal ending in deg gets display unit deg | displayUnitOf returns none |
| 48 | `lines` > 3.2 units: inferred from the literal, never from the name > θ = 30deg in 0deg..360deg step 1deg is an angle slider in radians | `docs/features/numbers-sliders/design.md:132` | angle slider has display unit deg | displayUnitOf returns none |
| 49 | `lines` > 3.2 units: inferred from the literal, never from the name > the unit is announced as a notice when it is inferred (unit_inferred) | `docs/features/numbers-sliders/design.md:285` | unit_inferred notice | no notice |
| 50 | `lines` > 3.2 unit_mismatch: bounds on an angle are never silently reinterpreted > θ = 30deg in 0..360 step 1 is unit_mismatch | `docs/features/numbers-sliders/design.md:134, docs/features/numbers-sliders/errors.md:27` | bounds without a unit on a deg object are unit_mismatch | accepted |
| 51 | `lines` > 3.2 unit_mismatch: bounds on an angle are never silently reinterpreted > the error names the unit and tells the author to add deg | `docs/features/numbers-sliders/errors.md:27, docs/features/numbers-sliders/errors.md:100` | unit_mismatch carries unit and hint | no error raised |
| 52 | `lines` > 4 edge cases: initial value, range and step > the clamped notice carries the old and the new value (from 3 to 5) | `docs/features/numbers-sliders/design.md:282, docs/features/numbers-sliders/errors.md:151` | notice has from and to | params hold name, value, end |
| 53 | `lines` > 4 edge cases: initial value, range and step > an initial value off the grid is snapped, with a snapped notice | `docs/features/numbers-sliders/design.md:136, docs/features/numbers-sliders/design.md:285` | initial value is snapped to the step with a snapped notice | 3.3 stays 3.3 |
| 54 | `lines` > 4 edge cases: initial value, range and step > bad_range carries min, max and step as evaluated | `docs/features/numbers-sliders/errors.md:25, docs/features/numbers-sliders/errors.md:92` | bad_range carries min, max, step | only "why" in params |
| 55 | `lines` > 4 edge cases: initial value, range and step > a step larger than the range is allowed | `docs/features/numbers-sliders/design.md:263` | allowed; only lo and hi reachable | bad_range |
| 56 | `lines` > 4 edge cases: initial value, range and step > more than 10^6 steps is a limit error with the limit and the actual count | `docs/features/numbers-sliders/design.md:176, docs/features/numbers-sliders/design.md:265, docs/features/numbers-sliders/errors.md:34` | limit error above 10^6 steps | accepted |
| 57 | `lines` > errors.md 2: parse-level cases > a = 3 in 0 10 is a syntax error that mentions the two dots | `docs/features/numbers-sliders/errors.md:41` | kind syntax, "Expected .. between the two ends" | missing_operator |
| 58 | `lines` > errors.md 2: parse-level cases > a = 3 step 1 is a syntax error: 'step' only follows a range | `docs/features/numbers-sliders/errors.md:42` | message "'step' only follows a range", hint in 0..10 step 1 | generic "Expected end of line" |
| 59 | `lines` > errors.md 2: parse-level cases > a = 3 in 0..10 step is a syntax error that expects a number after step | `docs/features/numbers-sliders/errors.md:43` | "Expected a number after step" | generic "line ends too soon" |
| 60 | `lines` > errors.md 2: parse-level cases > a hint that is a replacement line passes when applied (rule 2: a hint is a valid line) | `docs/features/numbers-sliders/errors.md:157` | a hint is a valid line | suggestions for unit_mismatch case never produced (line accepted) |
| 61 | `lines` > 3.2 redefinition keeps what it should > keeps the unit | `docs/features/numbers-sliders/design.md:138` | redefinition keeps the unit | unit lost (never inferred) |
| 62 | `lines` > 3.2 redefinition keeps what it should > a = 5 on a slider does not remove the slider | `docs/features/numbers-sliders/design.md:138, docs/features/numbers-sliders/design.md:285` | range_kept notice | no notice |
| 63 | `lines` > 3.2 redefinition keeps what it should > a with min = none removes the slider | `docs/features/numbers-sliders/design.md:25, docs/features/numbers-sliders/design.md:138` | min = none removes the slider | unknown_property: Number has no property min |
| 64 | `lines` > 3.3 dynamic bounds and the rulings on bound cycles > k = 3 in 0..k on an existing k is a cycle with a path | `docs/features/language/rulings.md:23` | range reading its own slider is cycle (with path) | accepted |
| 65 | `lines` > 3.2 style properties: values and defaults > place = screen(20, 20) is a screen placement | `docs/features/numbers-sliders/design.md:155, docs/features/numbers-sliders/design.md:28` | place = screen(x, y) | unknown_function: screen |
| 66 | `lines` > 3.2 style properties: values and defaults > place = at(1, 2) is a placement in maths coordinates | `docs/features/numbers-sliders/design.md:155` | place = at(x, y) | unknown_function: at |
| 67 | `lines` > 3.2 style properties: values and defaults > place = dock is the default dock | `docs/features/numbers-sliders/design.md:155` | place values accepted | setup with screen(...) fails first (same root) |
| 68 | `lines` > 3.2 style properties: values and defaults > a text label sets the caption of a slider | `docs/features/numbers-sliders/design.md:153` | label = "text" is a caption | bad_property_value (kernel label is a mode) |
| 69 | `lines` > 3.2 style properties: values and defaults > a label longer than 120 characters is a limit error | `docs/features/numbers-sliders/errors.md:34` | label over 120 characters is a limit error | bad_property_value |
| 70 | `lines` > 3.2 changing the range later: a with min = 0, max = 20, step = auto > min and max can be changed together | `docs/features/numbers-sliders/design.md:24` | a with min = 1, max = 20 | unknown_property |
| 71 | `lines` > 3.2 changing the range later: a with min = 0, max = 20, step = auto > step = auto goes back to the automatic step | `docs/features/numbers-sliders/design.md:24` | a with step = auto | syntax error: step is not a property name |
| 72 | `lines` > 3.2 changing the range later: a with min = 0, max = 20, step = auto > a range property on a dependent number is not_free | `docs/features/numbers-sliders/errors.md:26` | not_free | unknown_property |
| 73 | `lines` > 1 Read the slider: a.min, a.max, a.step, a.animating > a.min and a.max read the range | `docs/features/numbers-sliders/design.md:37` | a.min, a.max, a.step, a.animating | fields are undefined |
| 74 | `lines` > 1 Read the slider: a.min, a.max, a.step, a.animating > a.animating is false until the slider is animated | `docs/features/numbers-sliders/design.md:37` | a.animating | field undefined |
| 75 | `maths` > 9.1 constants > turn is tau | `docs/features/numbers-sliders/design.md:39, docs/features/numbers-sliders/design.md:318` | constant turn = tau | unknown_name |
| 76 | `maths` > 9.1 constants > grad is pi / 200 | `docs/features/numbers-sliders/design.md:39` | constant grad = pi/200 | unknown_name |
| 77 | `maths` > 9.1 constants > 0.5turn is pi | `docs/features/numbers-sliders/design.md:132, docs/features/numbers-sliders/design.md:39` | 0.5turn works as a literal | unknown_name |
| 78 | `run` > 3.4 a run in order, as one transaction > the trigger is reported as learner or host | `docs/features/controls-scripting/design.md:235` | trigger learner or host | always click_call |
| 79 | `run` > 3.4 steps: guards, loops, skipped steps > a computed choice index out of range skips the step with reason out_of_range | `docs/features/controls-scripting/design.md:268, docs/features/controls-scripting/errors.md:48` | skipped out_of_range at run time | definition rejects SetValue(d, i) as not_free |
| 80 | `run` > 3.4 steps: guards, loops, skipped steps > a guard on a loop step sees k | `docs/features/controls-scripting/design.md:159, docs/features/controls-scripting/design.md:162` | for k ... if k > 2 | unknown_name: k |
| 81 | `run` > 3.4 steps: guards, loops, skipped steps > the example form SetValue(L[k], 0) works in a loop | `docs/features/controls-scripting/design.md:26, docs/features/controls-scripting/design.md:173, docs/features/controls-scripting/agent.md:79` | SetValue(L[k], 0) in a loop | bad_argument: target must be an object |
| 82 | `run` > 3.4 and 3.9 budgets: counted, not timed > an aborted run reports what it discarded | `docs/features/controls-scripting/errors.md:55, docs/features/controls-scripting/errors.md:159` | handler_limit lists discarded writes | no discarded list |
| 83 | `run` > 3.3 events come from learner gestures only, so handlers cannot loop > a learner change runs the handler of that object | `docs/features/controls-scripting/design.md:210, docs/features/controls-scripting/design.md:224` | a learner change of a free value raises change and runs the handler | setValue(by learner) emits the host event but runs no handler |
| 84 | `run` > 3.3 events come from learner gestures only, so handlers cannot loop > the handler write does not raise the other handler: a stays where the learner put it | `docs/features/controls-scripting/design.md:216-218` | one run only | no handler ran at all |
| 85 | `run` > 3.3 events come from learner gestures only, so handlers cannot loop > a learner change of the value runs the handler: value is the new value | `docs/features/controls-scripting/design.md:194-204` | value is the new value | handler not run |
| 86 | `run` > 3.3 events come from learner gestures only, so handlers cannot loop > a checkbox toggle by the learner raises change | `docs/features/controls-scripting/design.md:210` | toggle raises change | handler not run |
| 87 | `run` > 3.3 events come from learner gestures only, so handlers cannot loop > a dropdown pick by the learner raises change with the chosen value | `docs/features/controls-scripting/design.md:210` | pick raises change | handler not run |
| 88 | `run` > 3.3 events come from learner gestures only, so handlers cannot loop > an input commit by the learner raises change on the target | `docs/features/controls-scripting/design.md:210` | commit raises change on the target | handler not run |
| 89 | `run` > 3.3 events come from learner gestures only, so handlers cannot loop > on figure change runs for a change of any object, once, and its own write does not repeat it | `docs/features/controls-scripting/design.md:211` | figure change runs for any change | handler not run |
| 90 | `run` > 3.6 and 7 host listeners > a button press tells the host: click, the name, learner | `docs/features/controls-scripting/design.md:287, docs/features/controls-scripting/agent.md:110` | click event to host listeners | no click event |
| 91 | `setvalue` > 3.3 and 3.5 SetValue on a slider goes through commit > a non-finite value makes the slider undefined with reason not_finite | `docs/features/numbers-sliders/design.md:167` | not finite is undefined, reason not_finite | reason is explicit |
| 92 | `setvalue` > 3.3 and 3.5 SetValue on a slider goes through commit > through a draw line SetValue(a, 15) clamps and carries the clamped notice | `docs/features/controls-scripting/design.md:266` | SetValue on a slider makes a clamped notice | no notice on the draw result |
| 93 | `setvalue` > 3.5 SetValue forms > through a draw line a dependent target is an error result, not a quiet success | `docs/features/controls-scripting/errors.md:33, docs/features/controls-scripting/design.md:266` | SetValue of a dependent object is not_free | apply returns ok "SetValue(b) failed" |
| 94 | `setvalue` > 3.5 SetValue forms > the example form SetValue(L[2], 8) sets an element | `docs/features/controls-scripting/design.md:26` | SetValue(L[2], 8) | "needs an object target", list unchanged |
| 95 | `setvalue` > 3.5 Reset restores the value an object had when it was defined > Reset() is one undo entry | `docs/features/controls-scripting/design.md:268, docs/features/controls-scripting/design.md:246` | one run, one undo entry | 2 entries for 2 changed objects |
| 96 | `setvalue` > 3.5 Reset restores the value an object had when it was defined > Reset on a figure that was never changed is harmless | `docs/features/controls-scripting/design.md:268` | Reset() resets all free objects | fails when a free List exists ("setFree: L holds a List") |
| 97 | `setvalue` > 3.5 Click > Click of an object that is not a button or clickable is an error | `docs/features/controls-scripting/design.md:209` | Click needs a Button or clickable object | apply returns ok "Click(a) failed" |

## Root causes behind the failures

Many of the 97 share a cause. A fixer can clear them in groups. The counts are approximate: one test can sit under two causes.

| Cause | Tests it explains | Doc lines |
|---|---|---|
| Action commands have no error channel: a failed `Animate`, `Toggle`, `SetValue`, `Reset`, `Click` returns `ok: true` with a "failed" summary instead of the documented error | Animate x2, Toggle, SetValue(b), SetValue(d, 9), Click(a), Animate Bool | `numbers-sliders/errors.md` 28, `controls-scripting/errors.md` 32 to 33 |
| `with` has no `min`, `max`, `step` (so `min = none`, `step = auto` and the `handler_graph_change` cases cannot be reached) | 8 | `numbers-sliders/design.md` 24, 25 |
| `with label = "text"` is rejected: the kernel `label` is a mode word | 3 | `numbers-sliders/design.md` 153 |
| `place = screen(x, y)` and `at(x, y)` do not parse | 3 | `numbers-sliders/design.md` 155 |
| Constants `turn`, `grad` are missing from the language | 3 (and `0.25turn` style literals) | `numbers-sliders/design.md` 39, 318 |
| Unit inference from a `30deg` literal returns `none`, so `unit_inferred`, `unit_mismatch` and the 5 degree auto step are all off | 8 | `numbers-sliders/design.md` 132, 134, 174 |
| Dynamic bounds and steps do not drive the slider value (`range_undefined`, `empty_range`, re-snap) | 4 | `numbers-sliders/design.md` 178 |
| Range line checks missing: dependent number with a range, step above the range, more than 10^6 steps, a range reading itself | 5 | `numbers-sliders/design.md` 126, 176, 263; `language/rulings.md` 23 |
| Initial value is clamped but not snapped | 1 | `numbers-sliders/design.md` 136 |
| Field reads `a.min`, `a.max`, `a.step`, `a.animating`, `d.value`, `d.index`, `d.count`, `q.text`, `q.valid` are not wired | 8 | `numbers-sliders/design.md` 37, `controls-scripting/design.md` 31 |
| Learner gestures raise a host event but do not run the handler; `trigger` is always `click_call`; no `click` event; Choice event lacks value and index | 10 | `controls-scripting/design.md` 209 to 211, 235, 287 |
| `on` is not a line kind of `Figure.apply`, not in `toScript`, not renamed or deleted with its objects, no `ClearHandler` command | 7 | `controls-scripting/design.md` 30, 154, 297, 298 |
| Handler guard cannot see the loop variable; `SetValue(L[k], v)` form unsupported; `SetValue(d, i)` on a Choice is `not_free` in a step | 4 | `controls-scripting/design.md` 26, 159 to 168, 258 |
| Controls limit (100) and animating limit (500) not enforced as errors | 3 | `controls-scripting/design.md` 322, `numbers-sliders/errors.md` 34 |
| Input box checks: dependent target, Button and list targets, nesting depth 17, `target_not_free`, clamped-notice params, Function text | 6 | `controls-scripting/design.md` 135, 145, 148, 345; `errors.md` 30 |
| Notice and error params: `from`/`to` of `clamped`, `min`/`max`/`step` of `bad_range`, `discarded` of `handler_limit`, `range_kept` notice | 5 | `numbers-sliders/design.md` 282, 285; `errors.md` 25; `controls-scripting/errors.md` 159 |
| Parse errors are generic: `a = 3 in 0 10`, `a = 3 step 1`, `a = 3 in 0..10 step` | 3 | `numbers-sliders/errors.md` 41 to 43 |
| `Reset()` fails when a free List exists, and writes one undo entry per object | 2 | `controls-scripting/design.md` 246, 268 |
| `@digits` and `@sig` directives are not read by `formatObjectNumber` | 1 | `numbers-sliders/design.md` 219 |
| `SetValue` on a slider with infinity gives reason `explicit`, not `not_finite` | 1 | `numbers-sliders/design.md` 167 |
| `animated_input` is never raised (rate reading an animating slider) | 3 | `numbers-sliders/design.md` 202 |

## Silent-doc choices

Where the docs are silent or disagree, the tests take the reading closest to the docs. Each is also stated at the top of the spec file.

1. **`showIf` spelling.** The numbers design writes `showif`; the language rulings (SM-23, Q-R4-1) write `showIf`. Tests use `showIf`. `showif = none` follows `numbers-sliders/agent.md` 14.
2. **`x = true`.** The design uses `x` as a Bool name, but README decision 14 reserves `x`. A test asserts `reserved_name`; other tests use `chk`.
3. **Checkbox caption.** The numbers design sets it with `with label = "text"`. The kernel's own `label` is a mode word. The tests follow the numbers design (so they fail). A doc fix is needed to settle which wins.
4. **`down` loop with the anchor at the bottom.** The formula as written gives 1 (starts at the top). The tests do not assert p0 = 0, s = 0 for `down`.
5. **`Animate` on a dependent number.** `design.md` 268 says `not_animatable`; `errors.md` 26 lists `Animate` under `not_free` too. Tests use `not_animatable` with reason `dependent`.
6. **Step below 1e-12 of the range and above 10^6 steps** (e.g. `1e-13` on 0..1). Both rules apply; the test accepts `bad_range` or `limit`.
7. **`a = expr` as a handler step.** Listed under both `handler_structure` and `handler_define`. Tests use `handler_define` for a bare `name = expr` and `handler_structure` for `f(x) = ...`.
8. **Rounding to zero.** `-0.0001` and `-0.004 (2 decimals)` print without a minus sign.
9. **Thin space** before `rad`, `turn`, `grad` is U+2009 or U+202F.
10. **`{expr:.2}`** keeps trailing zeros (`3.10`), like a fixed object.
11. **A start index above the option count** is clamped to the count (the rule for shrinking options), not an error.
12. **A caption that matches no option** is an error from `setChoiceCaption`.
13. **`Choice([])` and mixed-type options.** The test accepts `bad_choice` or the language's own `empty_list_type` and `type_mismatch`.
14. **Choice of colours or built-in functions** (`[red, green, blue]`, `[sin, cos]`) cannot be written in this build (those names are not objects). Dropdown tests use text, numbers and function objects.
15. **1000 and 1001 Choice options** cannot be written on one line (2000-character line limit), so the option-count limit has no test.
16. **`deg` on a Bool or Text** (`unit = deg`): accepts `unit_mismatch` or `unknown_property`.
17. **Nesting depth** for learner input means bracket nesting (17 nested brackets is `input_too_deep`). The length tests use a flat 498-digit number so depth does not interfere.
18. **A box with typed, uncommitted text** counts as focused; its text is not refreshed from the target.
19. **A PascalCase call** in learner text is `input_command` whether or not the command exists.
20. **A reversed loop range** (`5..m` with m = 0) runs zero iterations. **An undefined guard** skips the step.
21. **`trigger`** is taken from the `by` the host passes (`learner` or `host`).
22. **List element writes.** The forms table says `SetValue(L, 2, 9)`; the examples say `SetValue(L[2], 8)`. Both are tested; only the second fails.
23. **A learner gesture runs the handler.** `controls-scripting/design.md` 210 and 224 say a learner change raises `change` and the handler runs. The tests call `setValue`, `toggleCheckbox`, `setChoiceIndex` and `commitInputText` with `by: 'learner'` and expect the run. The run semantics themselves (`value`, `self`) are also tested through `runHandler` with a payload, which passes.
24. **Exact tie** between the top end and the last grid point is not tested (the doc says "nearest" and is silent on ties).
25. **Time limits.** Every test has vitest's 5 s timeout; tests that start a counted-budget run use an explicit 5 s timeout and, for the abort case, a 1 s wall-clock check. A synchronous infinite loop cannot be preempted by vitest, so a hang would stop the worker rather than fail one test.

## Not covered, and why

- `Text("r = {r:.2}")`, `{θ:deg}` and the `bad_format` error: the `Text` command is not registered by this area. The format specs are tested through `parseFormatSpec` and `formatWithSpec`.
- `Angle(A, B, C)`: a points-lines command, not registered here.
- `SliderView` and `BoolView` builders: no public function produces them.
- Film seek and replay of handler writes, the free-play clock, and pointer-driven drags: view and film work.
- Effects of `Highlight`, `Trace`, `Untrace`, `Play`, `Pause`, `View`, `Axes`, `Grid`: owned by other areas. The tests only check that they are accepted as steps.
- Event queueing (20 queued, `dropped`): runs are synchronous in this build, so only `dropped: 0` is checked.

## Isolation

Read only: `AGENTS.md`, `docs/process/pipeline.md`, `docs/features/README.md`, `docs/features/numbers-sliders/*`, `docs/features/controls-scripting/*`, `docs/features/kernel/rulings.md`, `docs/features/language/rulings.md`; `packages/kernel/test/spec/kernel/helpers.ts` and the first 60 lines of `events.test.ts` and `drag.test.ts` for helper style; the `Public API` section of `handoff/numbers/builder-notes.md`; `packages/kernel/src/index.ts` and `packages/kernel/src/commands/numbers/index.ts`. The type declarations were produced by running `tsc --declaration --emitDeclarationOnly` into the scratch directory and reading only the generated `.d.ts` files (numbers, graph, contracts); no `.ts` source under `packages/kernel/src/` was opened. I ran the public API in throwaway probe tests (deleted) to learn call shapes.

Disclosed slips: my line ranges on `builder-notes.md` ran past the section edges and showed about 5 lines at the end of "What was built" (it names deferred pieces: `turn`/`grad` constants, Choice value fields, some action bodies) and 1 row of its speed table. `git log --oneline` showed the builder's commit subjects. `ls` listed `handoff/numbers/` file names (`brief.md`, `continue-numbers-build.md` were not opened). I tested those deferred pieces from the docs regardless, and they fail.
