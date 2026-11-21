# Numbers area: builder notes

Branch `feat/numbers`. Code in `packages/kernel/src/commands/numbers/`, exported
from its `index.ts` and re-exported by one appended line in
`packages/kernel/src/index.ts`. No tests written. `npx eslint .`,
`npx tsc -p tsconfig.json` and `npx vitest run` (3,480 tests) pass.

Probes used during building (`probe-core`, `probe-figure`, `probe-perf` plus a
throwaway vitest config) were deleted before the last commit; the behaviour they
checked is listed under "Probe coverage" so the tester can mine it for cases.

## What was built

### numbers-sliders/design.md

- 1 (What this area does): done. Numbers, sliders, angles (display unit on a
  Number), bools/checkboxes, `showIf` visibility. `showIf` itself is the
  kernel's `showIf` style rule (see Doc conflicts); this area adds no new
  mechanism for it.
- 3.1 (Types): done as public types (`AngleUnit`, `NumberDisplay`, `Bound`,
  `LoopMode`, `SliderSpec`, `AnimAnchor`, `Placement`, `SliderView`, `BoolView`).
  Slider bounds live in the kernel's range clause; `SliderSpec` is the
  design's shape for hosts, not kernel storage.
- 3.2 (Parsing): partial. The kernel parses ranges, units (`deg` constant,
  `°`), `with` lists and Bool lines. This area adds: `unit_inferred` notice
  kind, `validateSliderRange` (line-time bound checks incl. the 10^6-step limit
  and the 1e-12-of-range floor), `checkSliderLineUnits` (`unit_mismatch` for
  bare nonzero bounds on angle objects; bare zero passes as unit-agnostic),
  and the `with` properties below. Redefinition keep-range behaviour is the
  kernel's (free-to-free keeps the range). `with min/max/step` range edits are
  NOT `with` properties (they are range operations, not style); the same edits
  go through `applySliderRange`, which applies a rerange line. Removing a range
  (`min = none`) has no kernel operation: left out (Kernel gaps).
- 3.2 (Style properties): done except `min`, `max`, `step` (above). Registered:
  `unit`, `digits`, `sig`, `trim`, `loop`, `period`, `seed`, `resume`,
  `vertical`, `length`, `place`, `placeX`, `placeY`, `anchor`, `captions`,
  `clickable`. `label = "text"` is the kernel's `caption` (Doc conflicts);
  `width` on Input reuses the kernel's `width` key (Doc conflicts);
  `place = screen(x, y)` call syntax needs a kernel prop-value hook, so the
  interim spelling is `place = screen, placeX, placeY, anchor` (Doc conflicts).
- 3.3 (commit): done. `commit()` implements clamp, display-unit-space snap with
  the reachable top end (ties pick the top), decimal repair capped at 12, and
  `v * unitScale` conversion so `30deg` commits to exactly the literal's double
  (verified by probe). Auto step is `nice((hi-lo)/100)`; typed/SetValue/
  animation values stay continuous under auto; a runtime-undefined step falls
  back to auto with `step_fallback`. Below-precision (|v|/step > 2^52) clamps
  without snapping (`step_below_precision`); huge angles flag `precision_loss`.
- 3.4 (Animation): done. `animFraction` for all five modes, `animRandom`
  (deterministic, mirrors the language's `rand` hashing), `animationValueAt`
  (fraction, unit conversion, then `commit` with source `animation`), anchor
  store per figure, `tickAnimations` (writes through `setFree(id, v, 'anim')`,
  which never enters undo history), pause/resume for drags, `Animate` action
  plus `animateSlider`/`animateAll` direct APIs. `once` completion is derived
  from t (the anchor is kept, so seeking back resumes); a `once` start at the
  top sets no anchor. `animated_input` (rate reading an animating slider) is
  left out: rate bodies are not publicly readable (Kernel gaps).
- 3.5 (Rounding and text): done. `formatDisplayNumber` (decimal-expansion
  rounding half away from zero via exact BigInt digit arithmetic, sig figs,
  trim, auto with `×10` superscripts, unit symbols, `-0` to `0`, dash for
  undefined), `formatAuralNumber` (e-notation, unit words), `parseFormatSpec`
  (`.N`, `Nsf`, units, `.Ndeg`), `formatWithSpec`, `resolveDisplay` (own props,
  then figure defaults, then auto), `setFigureDefaults` (the `@digits`/`@sig`
  mirror; directives have no read hook). Display-unit conversion noise is
  repaired to 12 decimals for angle units.
- 3.6 (Booleans): done. Free-Bool checkbox semantics, `showIf` as a graph edge
  (kernel), `approx` function (2- and 3-arg forms), `==` tolerance stays the
  kernel's. Undefined-Bool hiding is the kernel's `shown` computation.
- 3.7 (Kernel integration): done through public hooks only. No new object type
  for sliders; `commit` is called by this area's write paths (SetValue,
  input commits, handler writes, animation ticks). The kernel's own write path
  (`setFree`, `updateRange`) cannot call it (Kernel gaps); hosts should route
  slider writes through `writeNumberValue`/`commitInputText`.
- 3.8 (View interfaces): done as types plus selectors. The view reads
  `SliderView`-shaped data via `placementOf`, `labelOf`, `buttonLabelOf`,
  `minOf`/`maxOf`/`stepOf` (resolved), `isAnimating`, `loopOf`, `periodOf`,
  `orientationOf`, `lengthOf`, `formatObjectNumber`, `resolveDisplay`.
- 4 (Edge cases): done per the table, except kernel-owned line checks (see Doc
  conflicts for step-larger-than-range and range-on-dependent).
- 5 (Notices): done. Kinds `clamped` (core), `snapped`, `range_kept` (kept for
  hosts; the kernel owns redefinition reports), `unit_inferred`,
  `step_fallback`, `step_below_precision`, `precision_loss` (core) registered.
- 6 (Better than the reference app): the nine items are the properties of the above.
- 7 (Performance): done, see "Speed".
- 8 (Test plan): builders write no tests; the probes covered commit tables,
  idempotency/clamp spot checks, format goldens, animation determinism and the
  3.2 line shapes end to end (see "Probe coverage").
- 9 (Core changes): constants `turn`/`grad` exported as values (`TURN`,
  `GRAD`; `tau`/`deg` reused) but NOT as language constants (no registry hook;
  Kernel gaps). Functions `sig`, `snap`, `wrap`, `approx` shipped as
  `FunctionSpec`s plus pure implementations; `round(x, n)` reused from
  built-ins. `showIf`-as-rule is the kernel's. Tolerance/`==` stays the
  kernel's. New undefined reasons (`range_undefined`, `empty_range`) and error
  kinds (`unit_mismatch`, `not_animatable`, `animated_input`, `bad_format`
  reused) registered in this area's tables.

### controls-scripting/design.md

- 1, 3.1 (Objects): done. `Button`, `Choice`, `Input` object commands with
  `ButtonValue`/`ChoiceValue`/`InputValue` rule values. Choice index is
  1-based, clamped live, `empty_choice` when empty; live-list options follow
  the list; captions via `with captions`. Input links free Number/Text/Point/
  Vector/Bool/Function targets.
- 3.2 (Input boxes): done. `typeInputText` (validity without commit) and
  `commitInputText` (parse as expression only; PascalCase calls rejected
  syntactically as `input_command`; `=`/`with`/`on`/`@`/`#` rejected as
  `input_not_expression`; 500 chars / 2000 nodes / depth 16 enforced; unknown
  names surface; per-target typing; Number commits through `commit` with clamp
  notices; Text raw; Bool/Point/Vector evaluated once and frozen; Function
  bodies applied as same-name redefinition transactions). Any failure leaves
  the target unchanged with the error as box data. `q.text`/`q.valid` via
  `inputTextOf`/`inputValidOf`/`inputErrorOf`.
- 3.3 (Handlers): done. Own `on` line parser (grammar order `#n`, `for`,
  `if`, top-level colon split), `addHandler` with definition-time checks
  (event/target compatibility, step allow-list, `handler_define` vs
  `handler_structure` split, `handler_graph_change` for formula `showIf`,
  static Click-cycle detection, 50-step / 200-handler / 1000-literal-loop
  limits, `#n` replace/append, `bad_step_index`, clock reads rejected,
  SetValue/Toggle/Animate target checks incl. constant `bad_index`), per-step
  `self`/`value`/`event`/`k` substitution checked through the kernel's own
  parse/check pipeline.
- 3.4 (Runs): done. `runHandler` expands guards, loops and Click steps against
  a staging overlay (later steps see earlier writes), enforces the 2000-step
  and depth-8 budgets BEFORE applying, then commits one atomic batch (one
  transaction, one undo entry). Skips (`guard_false`, `undefined_argument`,
  `out_of_range` recorded for Choice overflow, `loop_range`, `broken`) and
  `HandlerRun` records (last 20 kept) per the design. Click expands inline, so
  runs are synchronous and no event queue can form (`dropped` stays 0).
  Restyle steps freeze dynamic values (one-time eval, never new rules).
- 3.5 (Actions): done. `SetValue` (all nine form families; list elements for
  Number/Text/Bool/Point lists via literal redefinition), `Toggle`,
  `Animate` (single + all-sliders + 500-cap), `Reset` (listed + all, initials
  tracked from add events with lazy capture on first write), `Click`,
  `ClearHandler` ((target, event-text, [step]) — bare event words need a kernel
  word-literal hook). Registered as draw-channel actions (best effort: the
  kernel passes area actions no values and no error channel, so arguments are
  evaluated from the checked trees and outcomes go to a side table) and as
  direct APIs returning full `Result`s.
- 3.6 (No JavaScript): by construction. Steps are line-language only; hosts
  subscribe via `onControlEvent` (TypeScript, outside figure files).
- 3.7 (Integration): handlers stored beside the figure (WeakMap; the kernel
  has no handler map). `handlersToScript`/`loadHandlers` for save/load,
  `rewriteStepsForRename`/`stepsMentioning`/`brokenSteps` for rename/delete,
  `summarizeControl` for catalogue summaries (kernel summaries cannot see new
  types).
- 3.8 (Choice details): done (1-based per README decision 1; element types
  Number/Text/Color/Point/Function/Bool; single-option allowed).
- 3.9 (Limits): all enforced where the area runs (`NUMBERS_LIMITS`); the
  100-controls-per-figure cap is host-enforced via `countControls` (object
  creation cannot be intercepted).
- 4-6: properties of the above.
- 7 (Test plan): see section 8 above; the fuzz/property ideas are recorded for
  the tester (handler determinism, input never-throws, atomicity).
- 8 (Core changes): `on` lines, Button/Choice/Input types, the six actions,
  the learner-gesture event model, counted budgets and the host listener API
  are all in this folder. No kernel file was changed except the one export line.
- 9 (Open questions): Q1 (film seek vs learner values) is for the film area;
  Q2 answered yes (change fires during drags; the view throttles); Q3 left to
  the view area (`clickable` flag shipped); Q4 answered (1-based); Q5 answered
  yes, Input-on-Function shipped (v1) via the redefinition path.

Left out with reasons: `min = none` range removal, `animated_input`
enforcement, `bad_choice` as a draw-channel kind (empty literals fail as
`empty_list_type` instead), `not_free` for range-on-dependent lines, bare-word
`ClearHandler(go, click)`, `d.value`/`a.min`/etc. field EVALUATION (fields
check, evaluation needs the kernel hook; selectors provided), `turn`/`grad`
language constants, `@digits`/`@sig` directive reads, Choice value fields in
`FIELDS` (element-typed; needs generic fields), View/Axes/Grid/Highlight/
Trace/Untrace/Play/Pause bodies (other areas; accepted as deferred steps).

## Public API

`registerNumbers(registry)` registers everything (commands, properties, type
styles, fields, notices, reason phrases, message templates). Figure
construction: `new Figure({ commands: registry, functions:
withNumbersFunctions() })`.

- Pure core: `commit`, `validateSliderRange`, `decimals`, `nice`, `autoStep`,
  `unitScale`; `animFraction`, `animRandom`, `animationValueAt`,
  `onceFinished`, `onceEndTime`, `startDir`; `formatDisplayNumber`,
  `formatAuralNumber`, `parseFormatSpec`, `formatWithSpec`, `resolveDisplay`,
  `setFigureDefaults`, `formatObjectNumber`; `sigNumber`, `snapNumber`,
  `wrapNumber`, `approxNumber`, `TURN`, `GRAD`, `constantsAgree`,
  `numbersFunctionSpecs`, `withNumbersFunctions`.
- Figure API: `writeNumberValue`, `writeSimpleValue`, `toggleValue`,
  `setChoiceIndex`, `setChoiceCaption`, `setListElement`, `setValue`,
  `setListElementByName`, `toggleCheckbox`, `animateSlider`, `animateAll`,
  `startAnimation`, `stopAnimation`, `isAnimating`, `tickAnimations`,
  `pauseAnimation`, `resumeAnimation`, `getAnchor`, `setAnchor`,
  `clearAnchor`, `animatingIds`, `lastTickT`, `resetObjects`,
  `ensureResetTracking`, `initialOf`, `captureResetInitial`,
  `applySliderRange`, `checkSliderLineUnits`, `countControls`,
  `summarizeControl`, `choiceValueOf`, `choiceIndexOf`, `choiceCountOf`,
  `choiceOptionsOf`, `choiceStateOf`, `defaultCaption`.
- Handlers: `parseHandlerLine`, `addHandler`, `clearHandler`, `listHandlers`,
  `lastRuns`, `brokenSteps`, `stepsMentioning`, `rewriteStepsForRename`,
  `handlersToScript`, `loadHandlers`, `runHandler`, `runLoadHandlers`,
  `clickButton`, `onControlEvent`, `emitControlEvent`,
  `pushActionOutcome`, `drainActionOutcomes`, plus store accessors.
- Input: `checkInputTarget`, `typeInputText`, `commitInputText`,
  `inputTargetOf`, `inputTextOf`, `inputValidOf`, `inputErrorOf`,
  `targetTextOf`, `clearInputState`.
- Props/selectors: `registerNumbersProperties`, `placementOf`,
  `parsePlacement`, `labelOf`, `buttonLabelOf`, `captionsOf`, `isClickable`,
  `resumeOf`, `loopOf`, `periodOf`, `seedOf`, `displayUnitOf`,
  `inferUnitFromDefinition`, `minOf`, `maxOf`, `stepOf`, `orientationOf`,
  `lengthOf`, `resolveId`.
- Errors: `numbersError`, `numbersNotice`, `registerNumbersErrors`;
  `numbersCommandSpecs`, `registerNumbersCommands`, `NUMBERS_TYPE_NAMES`,
  `NUMBERS_LIMITS`; shared `checkProbeLine`, `evalTNode`, `substituteLine`,
  value-literal helpers.
- Area kinds travel as strings (see KG-ERR): compare with
  `String(err.kind) === 'handler_define'` etc. in tests.

## Kernel gaps

Hooks the kernel would need for full behaviour. Each was worked around inside
this folder as described; file/line evidence is from this checkout.

- KG-ACT-VALS (`packages/kernel/src/graph/tx.ts` ~870): area actions receive
  `values: [undefined, ...]`; `ActionCall` documents evaluated values.
  Workaround: arguments are evaluated from the checked trees captured by the
  rule factory (`evalTNode`). Nested object commands inside step arguments
  evaluate to undefined (no public `runCommand`).
- KG-ACT-ERR (`tx.ts` `applyAction`): `ActionRule.run` returns
  `ActionOutcome | void`; any throw becomes `internal`. Area actions cannot
  fail with kinds. Workaround: structured outcomes in a side table
  (`pushActionOutcome`/`drainActionOutcomes`); runs zip them onto steps; the
  direct APIs return full `Result`s.
- KG-ON (`language/ast.ts`, `parser.ts`): no `on` line kind (`on` lexes as a
  name). Workaround: own parser, store, checks and runner in this folder.
- KG-FIELD (`language/compile.ts` `fieldOf`): fixed switch, no area hook, so
  `a.min`, `d.index`, `q.text` etc. check (via `FIELDS`) but evaluate to
  undefined. Workaround: selectors (`minOf`, `choiceIndexOf`, `inputTextOf`,
  ...). `d.value` additionally needs generic (element-typed) fields.
- KG-ERR (`errors/table.ts` `META: Record<ErrorKind, Meta>`): extending
  `AreaErrorKinds` breaks typechecking of kernel code, and there is no runtime
  kind registrar. Workaround: area kinds as strings, `numbersError` stamps
  kind/code/phase/message onto the kernel shape; templates appended to
  `MESSAGE_TEMPLATES`.
- KG-CONST (`language/builtins.ts` `CONSTANT_MAP` private): cannot add `turn`/
  `grad` constants. Workaround: `TURN`/`GRAD` value exports (`tau`/`deg`
  reused); `constantsAgree` checks the overlap.
- KG-FUNC-REG: no registry for built-in functions (constructor-only
  `FigureOptions.functions`). Workaround: `withNumbersFunctions()` merged
  table for the host to pass.
- KG-RANGE-WITH: `with min/max/step` cannot reach the kernel range (style
  storage is not range storage); no un-range op for `min = none`. Workaround:
  `applySliderRange` rerange lines; `min`/`max`/`step` deliberately NOT
  registered as style props (a stored-but-ignored value would lie).
- KG-WRITE-PATH (`graph/hist.ts` `setFree`, `graph/core.ts` `updateRange`):
  the kernel clamps but does not run this area's `commit` (no display-unit
  snap, no reachable top end, no auto-step rules). Workaround: hosts route
  slider writes through `writeNumberValue`/`commitInputText`.
- KG-UNIT-READ: the angle tag (`Persist.unit`) and rate bodies are not
  publicly readable, so unit inheritance through angle arithmetic and
  `animated_input` enforcement are unimplementable here. Workaround: explicit
  `with unit` plus definition-text inference for literals/`Angle(...)`.
- KG-CLOCK-READ: no public clock getter for `Animate` anchors. Workaround:
  `animateSlider(..., { t })` takes t; draw-channel actions anchor at the last
  tick (`lastTickT`).
- KG-DIRECTIVE-READ: `@digits`/`@sig` kept as text, not readable. Workaround:
  `setFigureDefaults` mirror for the host.
- KG-INITIAL: events do not distinguish redefine from write, so
  author-redefines cannot refresh Reset initials (creation values + lazy
  first-write capture only).
- KG-PLACE/STEP-AUTO/NONE: prop values cannot be calls (`screen(x, y)`),
  words (`auto`), or removals (`none`); `step = auto` / `min = none` /
  `showIf = none` have no `with` spelling. Workarounds: `place/placeX/placeY/
  anchor` props, rerange-without-step for auto, `showIf = true` to neutralise.
- KG-LIMITS: control-count (100) and per-line `bad_choice`/`not_free`-on-range
  checks cannot hook creation/checking. Helpers provided
  (`countControls`, `validateSliderRange`, `checkSliderLineUnits`).
- KG-SUMMARY/CHECK-TABLE: `valueText` summaries and `checkTable` known types
  have no area hooks. Workarounds: `summarizeControl`,
  `NUMBERS_TYPE_NAMES` for the integrator's `checkTable` call.

## Doc conflicts

- `showif` vs `showIf`: numbers-sliders/design.md 3.1 ("stored ... as
  `showIf`" — the table in 3.2 lists `showif`) and agent.md (`obj with showif
  = <Bool>`) use lowercase; the kernel uses `showIf` (`PROPERTIES`,
  `EffectiveStyle`). The kernel (merged) wins: this area uses `showIf`
  everywhere and provides no alias (an alias would store but never hide).
  Recommend fixing the area docs to `showIf`.
- `label = "text"` vs `caption`: numbers-sliders/design.md 3.2
  (`label | Number, Bool | text`) and agent.md (`show with label = "Show
  tangent"`) treat `label` as text; the kernel's `label` is an enum and the
  text key is `caption`. The kernel wins: captions are read from `caption`
  (`labelOf`, `buttonLabelOf`). Recommend fixing the docs to `caption`.
- Step larger than range: numbers-sliders/design.md 4 ("Allowed; only `lo`
  and `hi` are reachable") vs kernel `checkRange` (`The step ... is larger
  than the range`, `bad_range`). The kernel (merged) wins at line time; this
  area's `commit`/`validateSliderRange` implement the design (a step above the
  range is refused, matching the kernel; the top end stays reachable when the
  step merely does not divide the range).
- Range on a dependent number: numbers-sliders/design.md 3.2
  (`a = 2n in 0..10` is `not_free`) vs the kernel, which accepts a range on a
  dependent definition (`checkDefine` has no such check; only `rerange` checks
  `not_free`). The kernel wins until it gains the hook (listed above).
- `bad_style_value` vs `bad_property_value`: numbers-sliders/design.md 9.7
  and errors.md name `bad_style_value`; the kernel/language use
  `bad_property_value` (K021). The kernel wins; this area never emits
  `bad_style_value`.
- `on update` (this brief: "`on` click and `on update` handlers") vs
  controls-scripting/design.md 3.3 ("There is no `update` event"). The design
  wins: click/change/input/dragend/load only, no update event.
- `resume`: used by numbers-sliders/design.md 3.4 ("if the author set
  `resume = true` (default true)") and ui.md but absent from the 3.2 property
  table. Implemented as a registered bool prop defaulting to true.
- Random-mode first period: numbers-sliders/design.md 3.4 gives both
  `f = rand(seed·1e6 + floor((t − t0) / period) + 1)` and "the anchor value
  during the first period". Implemented as: anchor value while s < 1, then
  `rand(seed·1e6 + floor(s))` per period.
- `once` completion: "anim becomes null at the instant ..." vs seekability.
  Implemented as a t-derived flag (anchor kept): seeking past the end shows
  the stopped state and seeking back resumes, which is the section's stated
  purpose.
- Value conversion: 3.3 step 6 says `v * PI / 180` (multiply then divide) "so
  `30deg` gives exactly the same double as the literal". Probed: both orders
  coincide on typical values; implemented as `v * unitScale` with the same
  double the language constant uses, which guarantees the stated goal by
  construction.
- `period` floor: 3.2 says seconds > 0 but the prop check is inclusive, so
  `period` registered with min 0.001 (sub-millisecond sweeps are meaningless
  against ~16 ms frames). `length` registered 1..4000 px (no range in docs).

## Needs the integrator

- Construct figures with this area's tables: `registerNumbers(registry)` and
  `new Figure({ commands: registry, functions: withNumbersFunctions() })`;
  run `checkTable` with `types: [...NUMBERS_TYPE_NAMES, ...]` when the full
  table is assembled.
- Wire `tickAnimations(figure, t)` into the player (and the free-play clock),
  `pauseAnimation`/`resumeAnimation` into slider drags, and pass `t` into
  `animateSlider` where the host knows the clock.
- Route slider writes through `writeNumberValue`/`commitInputText` (see
  KG-WRITE-PATH); mirror `@digits`/`@sig` into `setFigureDefaults`; enforce
  the 100-control cap with `countControls`; append `handlersToScript` output
  to `toScript` and feed files through `loadHandlers`; call
  `rewriteStepsForRename` after renames and surface `stepsMentioning` after
  deletes; throttle learner `change` events in the view (250 ms) — this
  package has no timers.
- Doc fixes proposed above (`showIf`, `caption`, step/range line checks) and
  every KG- item need a kernel owner.

## Probe coverage (deleted before commit)

- Pure core: commit snap/repair/top-reach/tie/auto-modes/deg-exactness/
  not_finite/range_undefined/empty_range/step-fallback/decimals/nice/autoStep/
  validate-limits; format goldens (1.005, -0, sig, auto, sci, deg, deg-15,
  specs, bad specs); animation fractions per mode incl. negative-s clamp,
  once-finish, random determinism/first-period; sig/snap/wrap/approx/turn/grad.
- Figure integration: slider/angle/checkbox lines, `with` props, formatted
  readout, Button/Choice/Input lines + summaries, direct setValue snapping,
  toggle, choice index/caption, list elements, input commit/clamp/error-keeps-
  target/input_command, animate start/tick determinism/stop/undo-silence,
  reset-to-initial, handler add/append/run/events, loop/guard/replace-step,
  all handler error kinds, Click-cycle, draw-channel SetValue/Toggle/Animate/
  Reset/Click, live-list choice + shrink clamp, empty-choice clean rejection,
  function-input commit, figure-load + autorun:false, script round-trip,
  clear step/handler, idempotent registration, slider rerange, unit checks.
- Perf (below).

## Speed (Node, warm, Apple silicon laptop)

| Measure | Target | Result |
|---|---|---|
| `commit` (clamp, snap, repair) | under 2 µs | 0.35 µs |
| `formatDisplayNumber` (2 decimals) | under 3 µs | 0.44 µs |
| `animationValueAt` | (sub-µs, 3.4) | 0.33 µs |
| Tick, 20 animating sliders | under 0.1 ms | 0.054 ms |
| Apply a slider line | under 0.2 ms | 0.040 ms |
| 3-step handler run, 500 objects | under 0.5 ms | 0.43 ms |
| Input commit (typical) | under 0.1 ms compile | 0.054 ms end to end |
| Drag-to-kernel path | under 1 ms | not measured (view-owned; kernel `setFree`+`flush` is the path) |

## Public API (summary)

See `packages/kernel/src/commands/numbers/index.ts` (the list above). Entry
points: `registerNumbers`, `withNumbersFunctions`, `commit`,
`formatDisplayNumber`, `tickAnimations`, `setValue`, `runHandler`,
`commitInputText`, `addHandler`, `onControlEvent`.
