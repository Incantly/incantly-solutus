# Kernel and errors area: spec review (step 8)

Branch `feat/kernel` at `37175ad`. Reviewer: fresh agent, no code or tests changed. Paths are under `packages/kernel/src/`. Rulings in `docs/features/kernel/rulings.md` (K1 to K11) win over the other kernel docs, so a gap that a ruling settles is not listed.

Method: read the docs listed in the brief, read the code outside `language/`, and ran about 70 throwaway calls through the public API (deleted afterwards, nothing committed) to check results that the docs show as examples. Speed and memory numbers were not re-measured; the checker's table in `findings.md` (Speed) and the builder's table are cited as they stand.

## Summary

| Category | Count | Items |
|---|---|---|
| A. Fix before wave 2 builds on the kernel | 6 | A1 to A6 |
| B. Can wait, or belongs to another area | 16 | B1 to B16 |
| C. The doc should change, not the code | 11 | C1 to C11 |

| # | A: must fix | Wave 2 areas that hit it |
|---|---|---|
| A1 | No way to write a free value from the clock or an animation without it entering the undo history | animation-time, numbers-sliders, controls-scripting |
| A2 | Area types cannot get default styles or valid `with` keys; `registerPropertyTypes` overwrites an earlier call for the same key | conics, polygons-transforms, lists-matrices, statistics, probability, curves-loci |
| A3 | A rule cannot reach `slice`, the object ids of its arguments, the figure tolerance or a work budget | curves-loci, points-lines, functions-calculus, probability |
| A4 | `stepTo(n)` reveals the wrong objects when a helper (`aux`) object exists | graphics-view, tiptap, the build list |
| A5 | `unknown_name` puts a Number slider line first in `suggest`, whatever type the argument needs, and offers constants as names | the teacher and every area's repair tests |
| A6 | `applyBatch` has no dry run; `kernel.dryRun(lines)` (README 10) exists only for one line | tools-2d, graphics-view |

## Section status

Legend: done, partial, missing, different. "Probe" means I ran it.

### docs/features/kernel/design.md

| Section | Status | Evidence |
|---|---|---|
| 4.1 ids, names | done | `contracts/values.ts:9-13`; ids stay across redefine and undo (probe: `A = (6, 0)` keeps id 1) |
| 4.2 values | different (K5) | raw values, `Cell` at `graph/types.ts:18-20`. `sameValue` compares functions by identity (`graph/values.ts:11-17`), doc says rule identity plus inputs: B12 |
| 4.3, 4.4 object record, definitions | different, same behaviour | `Persist` at `graph/types.ts:114`; rate rules live on the state, no separate `rate` kind |
| 4.5 `Figure` | done | `graph/figure.ts`, `graph/hist.ts`. `applyBatch` returns `BatchResult` (`hist.ts:463`), not `TxResult[]` (K6) |
| 5 transaction, `TxResult`, `ChangeReport` | done | `graph/types.ts:186-230`; probe: failed line leaves `toScript()` and journal depth unchanged; `dryRun` on one line matches commit |
| 6.1 reorder | done | `moved_for_order` at `graph/tx.ts:730` |
| 6.2, 6.3 downstream, one pass, cut-off | done | `graph/core.ts` (`downOf`, `flush`); probe: drag of `A` gives one `value` event after `flush`, none before |
| 6.4 undefined, `cause` chain | done | probe: `T = Midpoint(I, B)` gives `cause: I`, `describe` gives `root: parallel` |
| 7 drag plans | done | `hist.ts:693` (`dragPlan`), `:748` (`drag`); probe: free, slider, `Midpoint` (inverted), dependent (`not_draggable`), fixed (`locked`). No cancel: B1 |
| 8 redefinition rules | done | probes: cycle path `["A","M","A"]`, `type_change`, `locked`, free to free keeps `in 0..8 step 2`, `a = a + 1` assigns, `A = A + (1, 1)` is `type_mismatch` (K2) |
| 9 properties | partial | static props, style edges, detach, defaults for core types done (`graph/props.ts:60-130`). Area types: A2. `showIf` text prints `a < 3` without the doc's brackets: C2 |
| 10 clock, states, sliders | partial | `setClock`, `solver`, `animate` stored (probe: `a with animate = oscillate` round-trips). Animated slider write path: A1 |
| 11 undo | done | `history/journal.ts`; `undo({unit})`; probe: line undo then group undo; drag with end equal to start leaves no entry |
| 12 step list | partial | model, `@step`, `explain` sentence, `insertAt`, `movePlan`, `deletePlan` done. `stepTo` index: A4 |
| 13 save, load | done | probe: round trip equal; `@fig 99` gives `version` K042; lenient gives `blockedBy`; strict gives `load_failed` with `cause` |
| 14 actions, `suggestName` | partial | `Rename`, `Undo`, `Redo`, `Describe`, `DependsOn`, `Uses`, `Show`, `Hide`, `Delete` done (`graph/actions.ts`). Name sequences differ from the doc: C1, B6 |
| 15 targets | done except memory | speed per `findings.md` (Speed); memory 600 B not met (K9) |

### docs/features/kernel/agent.md

| Section | Status | Evidence |
|---|---|---|
| 1, 2 lines and catalogue | done | all lines in section 1 accepted in probes; `Rename(M, N)` and `Rename(M, "N")` both work (K1) |
| 3 `draw` result | done for the kernel part | `TxOk` has `line, ok, name, type, op, summary, changed` (`graph/types.ts:201`). The "only non-empty fields appear" compaction is the teacher tool's: B14 |
| 3 `figure` result | different | `Description` (`types.ts:261`) has `definition`, no `def`, and omits `undefined` when defined; no `names/type/onlyProblems` filter: C2, B14 |
| 4 decision table | partial | `unknown_name` first move is wrong in the kernel: A5 |
| 5.1, 5.2, 5.4 snippets | done | probes match: `I` gets `becameUndefined` `parallel`; redefine gives `op: redefine`; `Undo()` gives `removed: ["M"]` |
| 5.3 typo | different | probe `M = Midpoint(A, Bb)`: `suggest = ["Bb = 1 in 0..10", "M = Midpoint(A, B)"]`, `recovery: create_first`. Doc: `suggest[0]` is the midpoint line: A5 |
| 6 phrase table | partial | `reasonPhrase` done (`errors/phrases.ts`); `input_undefined` is not composed with cause and root: B9 |

### docs/features/kernel/errors.md and docs/features/errors/

| Section | Status | Evidence |
|---|---|---|
| Kernel kinds K001 to K015, K020, K021, K030, K040 to K042, T001, T002, K999 | done | every kind has a registry entry (`errors/table.ts:35-83`, `checkErrorTable()` clean). Probes raised: `unknown_name`, `unknown_command`, `reserved_name`, `bad_name`, `name_taken`, `cycle`, `type_change`, `locked`, `not_free`, `unknown_property`, `bad_property_value`, `bad_range`, `nothing_to_undo`, `limit`, `version`, `load_failed`, `bad_argument`. `forward_reference` raised at `tx.ts:602`, `hist.ts:791`; `missing_rate` is raised by `problems()` (`figure.ts:201`), as the builder noted, not at line time |
| `unknown_name` extras | different | A5 |
| `not_free` suggest | partial | gives `X = value` only; doc also wants the free parents: B13 |
| `internal` rollback | partial | `apply` rolls back; `delete`, `rename`, `move`, `setFree`, public `undo`/`redo` report a change as made when a rule throws (fixer-notes round 2): B16 |
| Undefined reasons, phrase table | done | `contracts/values.ts:24-27`, `errors/phrases.ts:15-40`; area reasons append through `AreaUndefReasons` and `registerReasonPhrase` |
| Declared `reasons` test (kernel errors 2) | missing | no `reasons` on `CommandForm` (`language/table.ts:46-61`): B4 |
| Notices K101 to K109 | done | all emitted (`tx.ts`, `hist.ts`, `base.ts`); K110 to K112 added, not in doc: C7 |
| Limits table | partial | `errors/limits.ts`; `@limit` stored only, `extra` never read, no list-total check: B5. Rows missing in doc: C5 |
| Error object, `err`, compact form (errors/design 3, 5) | done | `contracts/errors.ts`, `errors/table.ts:170-210`, `errors/compact.ts`; `fixesFor` missing: B8; `Result<T>` shape: B11 |
| Numeric failures (errors/design 8) | partial | overflow threshold: B10; tolerance and work budget hooks: A3 |

### docs/features/README.md kernel decisions

| Decision | Status |
|---|---|
| 2 one undefined registry | done (`AreaUndefReasons`, `registerReasonPhrase`) |
| 3 `bad_argument`, area kinds | done (`AreaErrorKinds`) |
| 4 `notices` | done (K3) |
| 8 `applyBatch` atomic, one step | done (probe: atomic default, `independent` for `draw`) |
| 9 `slice` | done, different shape: C3, A3 |
| 10 `dryRun`, `drag`, `commitDrag` | partial: single-line dry run only (A6); names differ from the other areas' docs (C4) |
| 11 `Rename` | done |

## A. Must fix before wave 2 builds on the kernel

### A1. Free-value writes from the clock or an animation enter the undo history

**Status:** fixed in `graph/hist.ts`. New write reason `'animation'` for `setFree(x, v, 'animation')`: not journalled, joins no gesture, clamps and snaps like a slider, may write a fixed object, still marks the value for events.

- Docs: kernel design 10 and 11.2 ("Slider animation, the clock and solver writes are never journalled"); animation-time 5.3 (a slider's value is a function of `t`, written each frame); numbers-sliders 3.7.
- Code: `WriteWhy` has five values (`graph/hist.ts:28,30`). `solver` is refused for anything but a state (`hist.ts:570`, KERN-SM-4). `slider` and `drag` join a gesture that `commitDrag` journals (`hist.ts:624`, `:671`); `apply` and `undo` commit an open gesture first. `show_me` and `api` journal at once.
- Probe: five `setFree('a', i + 0.5, 'slider')` calls, then `apply('b = a + 1')`: undo depth 3, `next: "b = a + 1"`, and a `moved a` entry sits between. One animated slider therefore adds an undo step the next time any line is applied.
- Fix: add a sixth reason (for example `anim`) that does not join a gesture, is not journalled, clamps and snaps like `slider`, may write a `fixed` slider (the player is not the learner), and still marks `valueIds` and the time set. Fix every path with the same rule: the clock-driven writes in numbers-sliders (`clampRule`, `sliderAnimRule`) and any `Animate` in controls-scripting.
- Also decide who owns the track: animation-time 5.3 computes the value, so the kernel only needs the write path.

### A2. Area types cannot declare default styles or valid `with` keys; a second registration overwrites the first

**Status:** fixed in `graph/props.ts`, `errors/notices.ts`. `registerTypeStyle(type, { defaults, freeDefaults, keys, drawable })` merges across calls; `registerPropertyTypes` now merges too; an unknown type takes the base drawable keys (`width lineStyle fill fillAngle fillGap`) unless `drawable: false`; `registerNotice(kind, spec)` added for area notice codes.

- Docs: kernel design 9.3 ("data in a `defaultsFor(type, free)` table"), 9.1 ("`unknown_property` lists the keys valid for that object's type"); every wave 2 area adds types (Conic, Matrix, Distribution, Sector, ...).
- Code: `DEFAULTS` (`graph/props.ts:60`) and `BY_TYPE` (`:109`) are closed constants; an unknown type falls back to black, width 2, no `width` or `fill` key. `registerPropertyTypes(key, types)` does `extraKeys.set(key, types)` (`:128-129`), which replaces the list from an earlier call.
- Probe: `registerPropertyTypes('k', ['ConicA'])` then `registerPropertyTypes('k', ['PolyB'])`: `validKeysFor('ConicA')` no longer has `k`. `validKeysFor('Conic')` is `color visible label caption aux fixed selectable layer showIf opacity tags tip animate` (no `width`, `lineStyle`, `fill`).
- Fix: make `registerPropertyTypes` merge; add `registerTypeStyle(type, { defaults, keys })` (data, append-only, like the other registries); give `defaultsFor` and `validKeysFor` the new entries. Export it from `index.ts`.

### A3. A rule sees only its argument values: no `slice`, no argument ids, no tolerance, no work budget

- Docs: README 9 and curves-loci 3.8 (`Locus`, `Path`, `Envelope` run `kernel.slice(mover, target)` inside a command); errors/design 8 (tolerance "set once in the figure", a per-rule work budget counted in iterations); kernel errors 6 (rule budget); lists-matrices and probability (host limits).
- Code: `RuleCall` (`graph/registry.ts:26`; built at `graph/core.ts:394-414`) has `env, spec, form, args, values, t, fail, evalArg`. `ActionCall` has the `figure` (`registry.ts:70`), an object command does not. The rule is cached per compiled line (`core.ts:146`) and the registry is shared between figures, so a factory cannot close over a figure. `Figure.slice` swaps cells in place and never checks `busy` (`figure.ts:276`), so calling it from a running pass is not safe as written. There is no tolerance setting (`grep tol` finds only the language) and no work counter; `Limits.extra` is never read (`errors/limits.ts:32,48`); `timeout` is produced only by the solver (`clock/solver.ts:474`).
- Why now: each of 12 areas will invent its own tolerance and iteration cap, and curves-loci cannot be built at all.
- Fix (additive on `RuleCall`): `ids[i]` (the `ObjId` an argument names, or `undefined`), `slice(sourceId | 't', targetId)` returning a pass-safe scratch evaluator, `tol` (default `1e-9`, set by a `@tolerance` directive or option), `work` (a counter with a cap per rule run that makes the rule return `no_convergence` or `timeout` deterministically), `limits`.

### A4. `stepTo(n)` and `Step.index` use different counts when a helper object exists

- Docs: kernel design 12.1 (`index` is the position in the list shown; helpers hidden unless asked), 12.2 (`stepTo(n)` reveals the first `n` steps).
- Code: `steps()` numbers only the rows it emits (`graph/figure.ts:345`, `index: out.length`) but marks a row visible with `r.order < cursor` (`:353`), where `cursor` is a list position including `aux` objects (`:338`, `:380`).
- Probe: objects `A`, `h` (aux), `B`, `C`; `stepTo(2)`: `steps()` shows `A` visible, `B` and `C` hidden. Two steps were asked for. With `helpers: true` the same call shows `A`, `h` visible (index 1 is `h`), so the count is right only for that listing.
- Fix: define the cursor in one unit. Recommended: the cursor counts steps as `steps({ helpers })` lists them, stored as the list position of the first hidden object; add a regression test for an `aux` object before the cursor.

### A5. `unknown_name` repair puts a wrong slider line first and suggests constants

- Docs: kernel agent.md 4 ("prefer a `suggest` line"), 5.3; errors.md 1.2 (`suggest` = closest names; a define line when used as a number), 2 ("edit-distance suggestions use object names and command names only"); errors/design 6 rule 4.
- Code: `repaired()` always prepends `defineLine(name, 'Number')` (`graph/tx.ts:203-214`), whatever type the argument position needs, and the language adds a "Create slider" quick fix (`language/check.ts:620-624`). Near names are searched in `fig.names()` plus `CONSTANT_NAMES` (`language/check.ts:604`).
- Probes: `M = Midpoint(A, Bb)`: `suggest[0] = "Bb = 1 in 0..10"` (a slider, but `Midpoint` wants a Point), `recovery: create_first`. `C = Midpoint(A, Q)`: hint `Did you mean A or B or e?`. `l = Vector(1, m)`: hint `Did you mean e?`, `suggest` includes `l = Vector(1, e)`. A model that sends `suggest[0]` creates a junk object and then gets `type_mismatch`.
- Fix: (1) when a near object name exists, put the rewrite lines first and set `recovery: 'use_suggestion'`; (2) build the define line from the expected parameter type (`defineLine` already handles Point, Vector, Bool, Text); (3) leave constants out of the candidates unless the name is also a constant-like word; (4) for one-letter names, do not offer every other one-letter name.

### A6. No dry run for a batch

- Docs: README 10, graphics-view C6 (`kernel.dryRun(lines)` returns the value and type of the last line), tools-2d T1 and 5.5 (previews from "the lines for the shortest completion"), errors/design 6 rule 9.
- Code: `apply(line, { dryRun: true })` works for one line and leaves figure, journal and script unchanged (probe). `BatchOptions` (`graph/types.ts:236`) has no `dryRun`; passing one is ignored and the lines are committed (probe: `P` and `Q` were added).
- Workaround to avoid: `applyBatch` then `undo` clears the redo stack and fires events.
- Fix: `applyBatch(lines, { group, dryRun: true })` that reuses `beginUnit`/`rollbackUnit` (`hist.ts`), emits no events and returns the last line's `type` and value text.

## B. Can wait, or belongs to another area

| # | Item | Evidence | Owner / note |
|---|---|---|---|
| B1 | No `cancelDrag()` for Esc (graphics-view 12.2 step 5) | `commitDrag` only commits (`hist.ts:671`) | kernel, small. Workaround works today: write the start values back, then `commitDrag`; equal start and end leave no entry (probe) |
| B2 | Display digits: `valueText` is fixed at 6 significant digits (`language/runtime.ts:125`); builder left out the `@digits` setting (B9 of the language review) | `summary`, `Describe`, `Step.valueText` all use it | numbers-sliders needs a figure option; do with that area |
| B3 | `cost` hint on rules and heavy-rule deferral while dragging (lists-matrices 8.3 and 12 item 8, performance 5.6) | `CommandForm` has no `cost` (`language/table.ts:46-61`); `flush` has no skip mode | add the field and a `flush({ deferHeavy })` flag before lists-matrices and statistics ship heavy rules; they can omit the hint meanwhile |
| B4 | Declared `reasons` per rule and the registry self-test that reaches each one (kernel errors 2) | no such field | add `reasons?` to `CommandForm` when the first wave 2 area has a table to check |
| B5 | `@limit` is stored but changes nothing; total list elements per figure not checked; `Limits.extra` is a bag nothing reads; points and particles caps (performance 5) | builder-notes "Left out"; `errors/limits.ts:32` | particles and view areas enforce their own; kernel should read `@limit` |
| B6 | `Figure.suggestName` (`hist.ts:845`) never passes `unit: 'angle'`, so no `α β γ` names; no measure (`d s m`), image (`A_1`) or helper kinds; names of deleted objects are reused (probe: `C` after `Delete(C)`), tools-2d 5.7 says they are not | `language/names.ts:93` has the angle option | kernel wrapper plus tools-2d; sequences: C1 |
| B7 | Phase mismatches: `unbalanced` is `lex` in the registry (`errors/table.ts:94`) and `parse` in what the lexer reports; `unnamed_object` is `parse` (`language/errors.ts:68`), errors.md 1.2 groups it under resolve | fixer-notes round 1, dispute 1 | language area |
| B8 | `fixesFor(kind, ctx)` helper of errors/design 5 is missing; only `nearestNames` and `defineLine` are exported (`errors/index.ts`) | the checker holds its own fixes | language/errors; add when a second area needs it |
| B9 | `input_undefined` phrase is a fixed sentence (`errors/phrases.ts:28`); errors.md 3 composes "depends on {cause}, which is undefined ({root phrase})". Notices say "T became undefined: depends on an undefined object" | probe p2 | add `undefinedPhrase(cause, rootReason)`; the teacher and UI need it |
| B10 | Overflow threshold: `2e300 + 2e300` stays defined (probe); errors/design 8 says `|x| > 1e300` is `overflow` | `1e200 * 1e200` is `overflow` | language/numbers; follows the "fix every case of a rule" note in pipeline.md |
| B11 | Several methods return `T \| ErrorObject` with no `ok: true` on the success side (`setClock`, `slice`, `describe`, `get`-style calls); AGENTS.md says `Result<T>` | `figure.ts` (`setClock`, `slice`), `hist.ts` (`describe`) | `isErrorObject` is exported; SDK wraps it. Decide once before the SDK is built |
| B12 | `sameValue` compares functions and curves by identity (`graph/values.ts:11-17`); a re-run rule that rebuilds an equal function never cuts off its readers | safe, only slower | change the code to "rule identity plus inputs", or accept (and see C) |
| B13 | `not_free` suggest has only `X = value`; doc also offers the free parents from `dragPlan` | probe p12 | kernel, small |
| B14 | Teacher tool pieces the kernel docs describe but a kernel call does not give: compact success (only non-empty `changed` fields), `figure` rows with `def`, `shown`, `why`, `undefined: {reason, cause, root}`, and the `names/type/onlyProblems` filter | `ObjectView`, `Description`, `ChangeReport` carry all fields | teacher area; `objects()` plus `rootCause()` are enough to build it |
| B15 | Left out by the builder, owned by animation-time: input log, `rerun = continue \| restart`, idle checkpoints, reverse ring cache, flat `RateProgram` (K10); a blow-up writes `not_finite` where animation-time A12 names `unstable` | builder-notes "Left out"; `clock/solver.ts` | animation-time; its reasons `unstable`, `owned_by_solver` still have to be appended to `AreaUndefReasons` |
| B16 | `delete`, `rename`, `move`, `setFree` and the public `undo`/`redo` report a change as made when a rule throws during their pass (only `apply` rolls back) | fixer-notes round 2, "Decisions" | kernel; errors.md 5 rule 4 asks for rollback everywhere |

## C. The doc should change

| # | Change | Why |
|---|---|---|
| C1 | One name table. Kernel design 14 says `l1`, `c1`, `flag1`, `A1`; tools-2d 5.7 says `a b c ...`, `A_1`, never reuse; `language/names.ts:93` (built and tested) gives points `A..Z` then `A_1`, vectors `u v w`, lines `l m n`, circles `c d k`, booleans `cond1`, polygons `poly1`, texts `text1` | three sources disagree; `A_1` already fits README 16. Pick the language's table, edit kernel design 14 and tools-2d 5.7, keep T2 |
| C2 | `figure` entry in kernel agent.md 3: field names match `Description` (`definition`, `value` text, `shown`, `why`, `undefined` only when undefined); `why` reads `showIf a < 3 is false`, not `showIf (a < 3) is false` (`graph/props.ts` `toEffective`) | the code is consistent and tested; the doc has an older sketch |
| C3 | `slice` in README 9, curves-loci 3.8 and 5: it returns a `Slice` with `chain` and `run(values)` built per call, not a cached compiled program; "`Q` does not depend on `P`" is `slice.chain.length === 0` (probe: `chain: []`, cells unchanged), the area turns it into `no_dependency` | matches `figure.ts:276`; caching can wait |
| C4 | Other areas' names for kernel calls: graphics-view C5/C6 (`kernel.drag(plan, target)`, `kernel.dryRun(lines)`), animation-time 4 (`kernel.update(sources)`), numbers-sliders 3.7 (`kernel.setFree(id, raw)`), tools-2d T1 | real names: `dragPlan(x, target)` then `drag(plan)`, `apply(line, { dryRun })` (and A6), `setFree(x, v, why)` then `flush()`, `applyBatch(lines, { group, mode })` |
| C5 | Kernel errors 6 limits table: add `items`, `lines`, `textLength`, `journalBytes` (all in `errors/limits.ts`); state which `limit` names exist (`list_size`, `range_elements`, `file_size`, `lines`, `items`, `text_length`, `line_length`); expression nodes are 400 in the kernel and 2,000 in language errors 7 | fixer-notes round 1 and 2, doc conflicts 2 and 4 |
| C6 | `animate` values: kernel design 10 lists `oscillate/forward/backward`, animation-time 5.2 lists `off, bounce, loop, loop-down, once, once-down` | the kernel stores any plain word (probe); defer to animation-time |
| C7 | Add notices K110 `clamped`, K111 `shadowed_default`, K112 `unstable_state` to errors.md 4; kernel errors 3 should say `notices` (K3), and list the same codes | `errors/notices.ts:15-30` |
| C8 | Make kernel design.md match the rulings: 4.2 (tagged `Value` union, K5), 5 (`summary` format K4, `warnings` K3, `applyBatch` returns `TxResult[]`, K6), 7 (`dragPlan` returns `null`, K8), 13.1 (`version` under `load_failed`, K7), 15 (600 B, K9), 10 (rates as compiled closures, K10) | the rulings file is correct but the design text still contradicts it; builders read design.md first |
| C9 | Rule time budget: kernel errors 6 says a rule over 2 ms "stops itself" with `timeout`; the kernel only records `slowRules` when the host passes `now` (`graph/core.ts:340`), and errors/design 8 already replaces wall-clock limits with an iteration budget | align kernel errors 6 with errors/design 8; the budget API is A3 |
| C10 | `rerun` default: core design 13 #5 says `restart`, animation-time 8.3 says `continue`, README 19 says each figure picks. The kernel restarts today | the product owner decides; fix the loser |
| C11 | Cell `detail`: errors.md 3 says numeric reasons carry `achieved`, `wanted`, `iterations`; `Cell.detail` is one string (`graph/types.ts:20`) | say "short text" or change the type before functions-calculus relies on it |

## Hooks wave 2 needs: are they enough?

| Hook | Where | Enough for wave 2? |
|---|---|---|
| Command registry (`CommandRegistry`, `register`, shared between figures) | `graph/registry.ts` | Yes for value commands (probes: single output, tuple with `undef`, `acceptsUndefined`, `invert`). Needs A3 for loci and tolerance |
| `ActionRule` | `registry.ts:69` | Yes. Probe: an action that calls `figure.apply('A with trace = true')` runs inside the line, gives one undo entry and persists in `toScript()`. `Highlight`, `Play`, `Pause`, `Trace` can be built on it |
| `FigureView` for the language | `figure.view` | Yes (`dependentsOf`, `styleRulesReading`, `clock`, `read`) |
| Slice | `Figure.slice` | Works from outside the pass (probe); not callable from a rule: A3 |
| Drag plans | `dragPlan`, `drag`, `commitDrag` | Yes for tools; add `cancelDrag` (B1). `invert` is per rule, so each area declares it |
| Events | `Figure.on` | Yes: `add remove value style rename reorder step undo redo directive clock`, batched per pass, nothing before `flush`. Order: `undo`/`redo` first, then `value`/`style` (probe) |
| Properties | `registerPropertyTypes`, `defaultsFor` | No for new types: A2 |
| Undefined reasons, phrases | `AreaUndefReasons`, `registerReasonPhrase` | Yes. Areas must append their reasons and phrases in the same change |
| Error kinds, notices | `AreaErrorKinds`, `AreaNoticeKinds`, `makeNotice` | Yes; `NOTICE_TABLE` is a frozen object, so an area cannot add a notice code except by editing it (K1xx codes need a registration function) |
| Clock and states | `setClock`, `setBeats`, `StateSolver` | Yes for `t`, `bt`, `beat` and states. Slider animation needs A1; the input log, `rerun` and caches are animation-time's |
| Steps | `steps`, `stepTo`, `insertAt` | After A4 |
| Names | `suggestName` | Partly: B6, C1 |
| Batches and previews | `applyBatch`, `apply(.., { dryRun })` | After A6 |

One more point for the integrator: `NOTICE_TABLE` (`errors/notices.ts:15`) has no `registerNotice`; areas that follow README 4 and need their own `K1xx` or `A`-prefixed notice code have nowhere to put it. Small, but it is the same kind of gap as A2, so fix it with A2.
