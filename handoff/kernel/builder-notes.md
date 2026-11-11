# Kernel and errors area: builder notes

Branch `feat/kernel`. Code is in `packages/kernel/src/`, exported from `packages/kernel/src/index.ts`. No tests were written. `npx eslint .`, `npx tsc -p tsconfig.json` and `npx vitest run` (2,118 tests) pass.

Three throwaway probe files that the builder used (smoke, undo exactness, perf, clock/lazy/fault) are kept as text in this folder (`undo-probe.ts.txt`, `perf-probe.ts.txt`, `behaviour-probe.ts.txt`). They are not tests; the tester may mine them for cases.

## What was built

| Folder | Holds |
|---|---|
| `errors/` | `errorTable` (one entry per `ErrorKind`: code, phase, recovery, message key, declared params), `err()` (the one error constructor, never throws, falls back to the hard-coded `internal` object), `checkErrorTable()` (registry self-test), `internalError`, notices (`makeNotice`, K101 to K112), the undefined-reason phrase table (`reasonPhrase`, `registerReasonPhrase`), `Limits` and `DEFAULT_LIMITS`, `compactError` (at most 800 characters, 4 forms, 8 expected, 3 suggest), `nearestNames`, `defineLine` |
| `graph/core.ts` | `ObjRec`, `FigureCore`: object store (`Map` by id and name, ordered `list`), edges (`kids`, `inputs`, `styleKids`), closures cached per structure version (`downOf`, `clockDown` = the time set), `reaches` (binary search on the cached closure), the update pass `flush`, lazy values (`setDemand`, stale flags, pull on read), style evaluation (`styleOf`), batched events, `runCommand` (the compile hook that runs rules) |
| `graph/base.ts`, `tx.ts` | The line pipeline: parse, resolve, check (language), plan (cycle, locked, reorder, `forward_reference`), compute once, commit, change report. Define, function, defmany, restyle, rerange, rate, directive, comment, action lines. Replay of journal entries (shared by undo, redo and rollback) |
| `graph/hist.ts` | Delete with cascade and detach, `Rename`, `Show`/`Hide`, undo and redo, `applyBatch`, `setFree` with gestures and `commitDrag`, `dragPlan`/`drag`, `movePlan`/`move`/`insertAt`, `describe`, `dependsOn`/`uses`, `suggestName` |
| `graph/figure.ts` | `Figure`: clock (`setClock`, `setBeats`, `clockRange`), solver wiring, `steps`/`stepTo`, `toScript`/`fromScript`/`append`, `slice`, read-only views (`get`, `objects`, `cellOf`, `value`, `rootCause`), `problems()`, `takeWarnings()` |
| `graph/registry.ts`, `actions.ts` | `CommandRegistry` (the hook the command areas fill), the rule contract (`CommandRule`, `RuleCall`, `ActionRule`, `undef()` for a tuple component), the nine kernel actions as command specs |
| `graph/props.ts`, `rename.ts`, `values.ts`, `types.ts` | Property defaults, valid keys per object type (`registerPropertyTypes` for areas), colour words, coercion; rename through syntax trees; `sameValue`, `valueSource`; all result and cell types |
| `history/journal.ts` | `Journal`: entries `add`, `remove`, `sets`, `item`, `group`; undo and redo stacks; capacity 500 entries or 4 MB, `undoInfo()` reports dropped entries |
| `clock/solver.ts` | `StateSolver`: fixed-step RK4 (1/240 s or `@solver step 1/n`), checkpoints every 120 steps, cubic Hermite dense output, restart when an input of a rate changes, blow-up detection with an `unstable_state` notice |

### Language fixes made here
- **LANG-SM-33**: `compileLine` maps a style read of `SELF_ID` to `selfId` in `CompiledLine.styleReads`; `ScratchFigure.recordStyleRules` keeps the self link. (`compile.ts`, `figure.ts` in `language/`.)
- **LANG-SM-34**: `compileRelation` evaluates the maximal x/y-free parts of a relation with no polynomial form once and returns undefined with their reason (`freeParts`, not entered through `if` branches or commands). (`compile.ts`.)
- Additive edits to the language package: `ERROR_KINDS` and `MESSAGE_TEMPLATES` in `language/errors.ts` gained `forward_reference` K012, `not_free` K013 (it fell back to `internal` before), `locked` K014, `nothing_to_undo` K030, `load_failed` K041, `version` K042, `tool_input` T001, `tool_busy` T002 and the `kernel.*` templates; `CommandForm` gained optional `explain` and `acceptsUndefined` (core change 8). `contracts/errors.ts` gained eight kernel notice kinds under `// kernel`.

## Design decisions the docs left open

1. **Values are the language's runtime values** (`number`, `{x, y}`, arrays), typed by the object's `Ty`, not the tagged `Value` union of design 4.2. A cell is `{ defined: true, value }` or `{ defined: false, reason, detail?, cause? }`.
2. **Persist**: everything undo restores about an object is one immutable `Persist` record replaced as a whole. A journal entry holds two references, so undo is exact and ids never change. Each accepted line is exactly one journal entry (`add`, `remove`, `sets` or `item`); a `draw` call is a `group`.
3. **Free to free keeps the slider range** (review B2): `a = 5` after `a = 4 in 0..8 step 2` keeps `in 0..8 step 2`. A free object redefined to a rule loses the range. Out-of-range values clamp at run time with a `clamped` notice (B8).
4. **`a = a + 1`** on a free Number, Point or Bool is an assignment (kernel 8, README). When the language raises `cycle` for a self-reference only, the kernel re-checks without the graph test, checks the other inputs itself, and stores the computed value as the new free value. The stored node becomes `a = <value>`.
5. **defmany** (`P, Q = Intersect(c, d)`): one single-output object per name, each evaluating the same command and taking its component. A rule returns an array; a component may be `undef('no_intersection')`. Redefining some of the names and not others is refused with `bad_argument`.
6. **Property rules**: a `with` value that reads objects or the clock is a style edge (`StyleEntry.eval`); a constant is evaluated once and stored. A constant equal to the type default is not stored (`shadowed_default` notice). Dynamic values clamp or fall back to the static value when undefined, with no notice (design 9.4). `unknown_property` lists the keys valid for the object type (review B6).
7. **Delete** detaches property rules and rate rules that read a removed object (`property_detached` notice), journalled, so undo restores them. Script comments and directives re-anchor to the nearest surviving object.
8. **Batches**: `applyBatch(lines, { group, mode })`. `atomic` (default) is README 8: the first failure takes back the earlier lines through the journal and restores the redo stack and the pending events. `independent` is the teacher's `draw`: each line stands alone and a line reading a failed name gets `blockedBy`. Events and the change report are merged once per batch. A nested `apply` tracks its own changes, so per-line reports are exact.
9. **Gestures**: `setFree` with `why` `drag` or `slider` joins a gesture, journalled as one `sets` entry (first to last value) by `commitDrag()`; `show_me` and `api` writes are journalled at once; `solver` writes are not journalled. `undo`, `applyBatch` and `dragPlan` commit an open gesture first.
10. **Drag plans**: a free Point or Number writes itself; a rule whose `CommandRule.invert(target, call)` exists returns new parameter values, and the kernel maps each to the free object the argument names (recursively, depth 8). Reasons: `unknown_object`, `locked`, `owned_by_solver`, `not_draggable`, `undefined`, `bad_target`.
11. **Lazy values**: `setDemand(ids)` limits the pass to the demanded objects and what they read; others are marked stale and computed when read. `apply` and the other line operations always run eagerly so their reports are complete.
12. **Time set**: `clockDown()` is the cached closure of every object that reads `t`, `bt` or `beat`. A seek (`setClock`) is one pass; `bt` and `beat` follow `setBeats(starts)`, else `bt = t` and `beat = 0`. `t` is clamped to `@clock a..b`.
13. **Solver**: the rate cone is evaluated with the figure's own compiled closures (not a flat rate program), with the cone's cells put back after each integration. A blow-up makes every state undefined (`not_finite`) from that step and adds an `unstable_state` notice (`takeWarnings()`); the doc's per-group handling is simplified to the whole set. A state without a rate holds a rate of 0 and `problems()` reports `missing_rate`.
14. **`slice(source, target)`** (README 9): a scratch evaluation of the rules between a free object (or `'t'`) and the target; cells are swapped in place and restored, nothing is journalled or emitted.
15. **`Rename(M, N)`**: a bare new name that no object has is read as the text `"N"` (kernel agent.md writes it this way). `Rename(M, "N")` is the checked form.
16. **Names in the API**: `Figure.valueOf` would shadow `Object.prototype.valueOf`, so it is `Figure.value(x)`.
17. **FigureView**: the language's `FigureView` is `figure.view` (not the `Figure` itself) because `Figure.dependentsOf` returns ids as design 4.5 says and `FigureView.dependentsOf` returns `ObjectInfo[]`.

## Doc conflicts

1. Rename form. `docs/features/kernel/agent.md` section 1: "`Rename(M, N)`"; its section 2: "`Rename(obj, "NewName")`"; `design.md` section 14: "`Rename(obj, Text)`". Both accepted (decision 15).
2. Self-reference. `docs/features/language/design.md` line 580: "**Self-reference** `a = a + 1` is `cycle`"; `docs/features/kernel/design.md` section 8: "Self-reference on a free `Number`, `Point` or `Bool` ... **Allowed**". Kernel reading used; the language still reports `cycle` and the kernel overrides it (decision 4).
3. Warnings versus notices. `docs/features/kernel/errors.md` section 4: "`changed`: { ... `warnings`: [] }"; `docs/features/README.md` decision 4: "Line results carry `notices` ... replaces the `warnings` and `notices`". `TxResult.notices` is the field; `changed.warnings` is the same array.
4. Summary text. `docs/features/kernel/design.md` section 5: `summary?: string; // "M = (2, 3) : Point"`; `docs/features/kernel/agent.md` section 3: `"summary": "M = (2, 1)"` with a separate `type`. The agent.md form is used.
5. Value shape. `docs/features/kernel/design.md` 4.2 defines `{ t: 'Number'; v: number }`; the language compiles to raw values and the contracts file has no `Value` type. Raw values used (decision 1).
6. Batch semantics. `docs/features/README.md` 8: "`kernel.applyBatch(lines)` is all-or-nothing"; `docs/features/kernel/errors.md` section 5 rule 2: "In a batch, later lines run even if earlier ones failed". `mode: 'atomic' | 'independent'` (decision 8).
7. Version error. `docs/features/kernel/design.md` 13.1: "refuses with `load_failed` kind `version`"; `docs/features/errors/errors.md` 1.5 has `version` K042 as its own kind. The own kind is used.
8. `dragPlan`. `docs/features/kernel/design.md` section 7: "returns either `null` or a list of `{id, value}` free writes ... `null` with reason `locked`". It returns `{ writes, reason?, kind? }`, since a null cannot carry a reason.
9. Memory per object. `docs/features/kernel/design.md` section 15: "< 600 bytes plus value". Each object keeps its checked and compiled line (the typed tree and closures), so a typical object is a few kilobytes. Not met; see "Left out".
10. Rate evaluation. `docs/features/animation-time/design.md` 7.2 asks for a flat `RateProgram.eval(y, t, inputs, out)` with `evalInto` forms. The kernel evaluates the rate cone with compiled closures (decision 13).

## Review items (handoff/language/review.md B) status

| Item | Status |
|---|---|
| B1 `Rename`, `Delete`, `Show`, `Hide`, `applyBatch`, `name_taken`, `forward_reference`, `locked`, `not_free`, `nothing_to_undo`, `load_failed`, `version` | built. `tool_input` and `tool_busy` are in the registry; the teacher tool raises them |
| B2 redefinition steps 5 to 7 | built: reorder, free to rule and back, one undo entry; free-to-free keeps the range |
| B3 total list elements | left out: `FigureView` has no hook for it and the language caps one list at 100,000 |
| B4 state and rate pairing, `missing_rate` | built as `problems()` (raised at the first frame, as the doc says), not at line time |
| B5 directive checks | left out: areas own them |
| B6 per-type `with` keys | built |
| B8 slider clamp | built |
| B9 display digits | left out (`valueText` is unchanged; needs a `@digits` setting) |
| B10 exact derivative hook | left out |
| B11 `runCommand` | built (a nested command runs inline; it makes no hidden object) |
| B12 to B15, B18 to B20 | not kernel work |
| B16 bad JS input | not changed |
| B17 benches | no runner: Vitest 5 has no `bench` export in this repo, and the brief limits writes to `src/` and `handoff/`. The numbers below were measured with the probe |
| B21 `FigureView` | `figure.view` implements it, with `styleRulesReading` |
| B22 `draw` result assembly | `TxResult` carries `changed`, `notices`, `summary`, `line`; `becameUndefined` lists `cause` names |

## Public API (`packages/kernel/src/index.ts`)

```ts
class Figure {
  constructor(opts?: { commands?: CommandRegistry | CommandSpec[] | CommandTable; functions?; directives?; limits?: Partial<Limits>; now?: () => number })
  static fromScript(text, opts?: LoadOpts): { figure: Figure; report: LoadReport }
  readonly view: FigureView;  readonly journal;  readonly solver: StateSolver;  readonly registry: CommandRegistry;  readonly limits: Limits

  // lines
  apply(line: string | ParsedLine, opts?: { line?; dryRun?; failed?; insertAt?; force? }): TxResult
  applyBatch(lines, { group, mode?: 'atomic' | 'independent', force?, lines? }): BatchResult
  insertAt(index, line, opts?): TxResult
  delete(x, opts?): TxResult      deletePlan(x): Name[]
  rename(x, to, opts?): TxResult
  move(x, to, { withDependencies? }): TxResult      movePlan(x, to): { ok; alsoMove }

  // values and frames
  setFree(x, value, why: 'drag'|'slider'|'show_me'|'api'|'solver', { force? }): { ok: true; changed } | ErrorObject
  commitDrag(): { committed }
  dragPlan(x, target): { writes; reason?; kind? }      drag(plan): { ok; delta? | reason? }
  flush(): FrameDelta     setDemand(ids | null)
  setClock(t, { bt?, beat?, flush? }): FrameDelta | ErrorObject     setBeats(starts)     clockRange()

  // history
  undo({ unit?: 'group' | 'line' }): TxResult      redo(): TxResult      undoInfo(): UndoInfo

  // queries
  get(x): ObjectView | undefined      objects(): ObjectView[]      cellOf(x)      value(x)      rootCause(x)
  styleOf(id): EffectiveStyle | undefined      describe(x): Description | ErrorObject
  dependentsOf(x): ObjId[]      ancestorsOf(x): ObjId[]      names(): string[]      count
  suggestName(type, hint?): Name      problems(): ErrorObject[]      takeWarnings(): Notice[]
  slice(source | 't', target): Slice | ErrorObject

  // steps and files
  steps({ helpers? }): Step[]      stepTo(n)      cursor
  toScript({ header? }): string      append(text, { mode? }): LoadReport
  on(listener): () => void        // events: add remove value style rename reorder step undo redo directive clock
}
```

Also exported: `CommandRegistry`, `RuleUndefined`, `undef`, `CommandRule`, `RuleCall`, `InvertCall`, `ActionRule`, `KERNEL_ACTIONS`, `kernelActionSpecs`; the result and cell types; `defaultsFor`, `validKeysFor`, `registerPropertyTypes`, `colorFromWord`, `sameValue`, `valueSource`; `StateSolver`; and from `errors/`: `errorTable`, `checkErrorTable`, `err`, `internalError`, `makeNotice`, `NOTICE_TABLE`, `reasonPhrase`, `registerReasonPhrase`, `DEFAULT_LIMITS`, `resolveLimits`, `compactError`, `nearestNames`, `defineLine`.

Kernel actions as lines: `Show(obj, ...)`, `Hide(obj, ...)`, `Delete(obj)`, `Rename(obj, "Name")`, `Undo()` (one line), `Redo()`, `Describe(obj)`, `DependsOn(obj)`, `Uses(obj)` (data in `TxResult.data`). Directives `@fig`, `@step`, `@clock`, `@solver` have kernel meaning; every other directive is kept in place as text.

How an area plugs in: `new CommandRegistry([...specs])` or `figure.registry.register(spec)`. A form's `rule: (args) => CommandRule` returns `{ run(call), acceptsUndefined?, invert? }`; `run` returns the value, or `call.fail(reason)` / an array with `undef(...)` for a tuple. An action's rule returns `ActionRule`. Rule faults (an exception) roll the line back and give `internal` with `recovery: 'skip'`.

## Left out, and why

- **Actions of other areas** (`Highlight`, `Trace`, `Untrace`, `Play`, `Pause`, `Restart`): the hook is `ActionRule`; the bodies belong to the motion and view areas.
- **Input log, `rerun = continue | restart`, what-if replays** (animation-time section 8): the kernel only restarts the states from `t = 0` and replays when an input of a rate changes.
- **Idle pre-computation of checkpoints, reverse-play ring cache, events and bodies** (animation-time 7.6, 7.9): not built. Seeks beyond the frontier integrate once and fill checkpoints.
- **Flat rate program and `evalInto`** (decision 13), **per-group instability** (decision 13).
- **Memory per object** under 600 bytes: each object keeps its checked and compiled line; a memory budget needs a slimmer representation (share compiled lines of identical text, drop trees for free objects).
- **Per-rule time budget** abort is by design not done; `slowRules` records overruns only when the host passes `now`.
- **`@limit` directive** is stored but does not change `Limits`. Total list elements per figure (B3), `expr_nodes` and `depth` are enforced by the language, not re-checked here.
- **Worker hosting** is the `sdk` area's; the kernel has no DOM, timers, `Date` or `eval`.
- **`Describe` string forms** carry the same text as `describe()`; the `figure` tool's `onlyProblems` filter is the teacher tool's.
- **Journal size** is estimated, not measured in bytes of snapshot text.

## Speed (Node, warm, Apple silicon laptop)

| Measure | Target | Result |
|---|---|---|
| Slider write plus `flush`, 5,000 objects, 2,499 downstream | n/a | 1.1 ms |
| Slider write plus `flush`, 500 objects, 200 downstream | < 0.5 ms | 0.04 ms |
| `apply` a simple line, 5,000 objects | < 0.3 ms | 0.026 ms warm (0.35 ms the first call) |
| `apply` a redefinition with 49 downstream | n/a | 0.02 ms |
| `undo` of one line | < 1 ms | 0.004 to 0.007 ms |
| Load 5,000 lines (`applyBatch`, independent) | 1,000 lines < 100 ms | 219 ms (0.044 ms per line) |
| `fromScript` of a 5,000-object script | 1,000 lines < 100 ms | 213 ms (about 43 ms per 1,000) |
| `toScript`, 5,000 objects | 1,000 objects < 20 ms | 2.5 ms |
| `Delete` cascade of 2,500 objects | 200 objects < 2 ms | 5.2 ms (about 0.4 ms per 200) |
| `undo` of that delete | n/a | 17 ms |
