# State machines

Every explicit and implicit state machine in the code, with its states, invariants and transition tables, and the invalid states or transitions found. Written and kept up to date by each area's checker (`docs/process/pipeline.md`). One section per area.

Format for each machine:

- **Where:** file paths.
- **States:** a table of states and what each holds.
- **Invariants:** what must always be true.
- **Transitions:** a table of from, event, guard, to, and side effects.
- **Reachable invalid states or transitions:** each with evidence and a link to its entry in `handoff/<area>/findings.md`, and its status.

## kernel

Checked at commit `00a69c4` on `feat/kernel` (pass 1, after the step-3 fixer round). Paths are under `packages/kernel/src/`; line numbers refer to `00a69c4`. Findings are in `handoff/kernel/findings.md` (KERN-SM-1 to KERN-SM-20, all open). Every reproduction there goes through the public API (`src/index.ts`) with the test commands of `test/spec/kernel/helpers.ts`. JavaScript is single-threaded, so "concurrency" below means re-entrancy (a listener, a rule or an action calling back into the figure), operations interleaved by the host, and the order of events.

The machines are layered. K1 to K4 are the store, the graph, the pass and the operation bracket every public call runs inside. K5 is one line; K6 and K7 are the history; K8 is a batch; K9 is free writes and drags; K10 and K11 are the clock and the states; K12 is the step list and script items; K13 is save and load; K14 is `slice`; K15 is the error and limit layer.

### K1. Object store and object record

- **Where:** `graph/core.ts` `ObjRec` (lines 31 to 70), `byIdMap`, `byNameMap`, `list`, `nextId`; `graph/base.ts` `applyPersist` (126), `insertRecs` (142), `removeRecs` (158), `applyReorder` (177); `graph/types.ts` `Persist`.
- **States:** an `ObjRec` is `absent` (not yet made), `live` (in `list`, `byIdMap` and `byNameMap`), or `detached` (removed from the three tables but still held by a journal entry, so undo can put the same record back). A live record's `Persist` has `kind` `free`, `rule` or `state`; a free record holds `value` (and `freeReason` when undefined). `Persist` is immutable and replaced as a whole.

| State | Holds |
|---|---|
| `absent` | nothing; the id is not issued |
| `live/free` | `p.value`, cell from the value, no value inputs (`valueIn` empty), maybe range inputs |
| `live/rule` | compiled line, value and range inputs, cell from `compute` |
| `live/state` | initial value and rates, cell written by the solver (K11) |
| `detached` | the record and its last `Persist`, in a `remove` or `add` journal entry |

- **Invariants:** `list[i].order === i`; `list` is a valid dependency order (every value or range input has a smaller order); `byIdMap` and `byNameMap` hold exactly the records in `list`; names are unique; an id is issued once and never reused (`nextId` only grows, also after a rollback); a free value is immutable once stored; the record a journal entry holds is the one undo puts back (ids stay stable).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| absent | `applyDefine` commit, new name | checks pass, objects < limit | live | `insertRecs` at `insertAt ?? end`, `renumber(0)`, `wire`, `add` event, `add` entry |
| live | redefine | same type, not fixed (or `force`) | live | `applyPersist` (unwire, swap `Persist`, rewire), optional reorder |
| live/free | `setFree` / gesture | K9 guards | live/free | `p` and `cell` replaced in place, no rewire |
| live | `Delete` cascade | nothing fixed in the cascade (or `force`) | detached | readers' property rules and rates detached, items re-anchored, `remove` entry |
| detached | undo of `remove` / redo of `add` | | live | same record, saved `Persist`, saved position |
| live | undo of `add` / redo of `remove` | | detached | |
| live | `move` | no order crossing, or `withDependencies` | live | `applyReorder`, `sets` entry with a reorder |

- **Reachable invalid states or transitions:** a free value stored by `setFree` is the caller's object, so the caller can change it later without a write, a pass or a journal entry (KERN-SM-4, open). Undo or redo run inside an open batch can leave a record `detached` with no journal entry that holds it (KERN-SM-9, open).

### K2. Dependency graph and closure caches

- **Where:** `graph/core.ts` `wire` (435), `unwire` (459), `renumber` (469), `downOf` (475), `clockDown` (495), `reaches` (517), `ancestorRecs` (533), `neededArray` (558); `structureVersion`.
- **States:** per record: `kids` (value and range readers), `styleKids` (owners of property rules that read it), `inputs`, `valueIn`, `rangeIn`, `styleIn`; cached `down` closure with `downVersion`; figure-wide `clockDown_` and `clockStyleCache` with `clockDownVersion`; lazy `needed` with `neededVersion`. A cache is `valid` when its version equals `structureVersion`, else `stale`.
- **Invariants:** `x ∈ y.kids ⇔ y ∈ x.inputs`; `x ∈ y.styleKids ⇔ y ∈ x.styleIn`; style edges are never followed by the cycle test or `downOf`; a valid `down` is the ascending order list of every value or range descendant; every structural change (wire, unwire, renumber, the `@clock` and `@solver` directives) bumps `structureVersion` before the next read; the walks are iterative (no recursion).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| valid | `wire`, `unwire`, `renumber`, `onDirective('clock'|'solver')` | | stale | `structureVersion++` |
| stale | `downOf(r)` | | valid for `r` | DFS over `kids`, sorted `Int32Array` |
| stale | `clockDown()` | | valid | union of the closures of every reader of `t`, `bt`, `beat` |
| any | `reaches(from, to)` | | | binary search in `downOf(from)` |
| stale | `neededArray()` in lazy mode | | valid | ancestors of the demanded ids |

- **Reachable invalid states or transitions:** none found in the graph itself. Two costs ride on `structureVersion`: every structural change also restarts the state solver (KERN-SM-16, K11), and the per-add cost of a load grows with the figure (KERN-SM-17).

### K3. Update pass, cells and lazy values

- **Where:** `graph/core.ts` `flush` (588), `setCell` (284), `compute` (301), `cellFromResult` (315), `sizeChecked` (328), `runCommand` (339 to 393), `updateRange` (407), `setDemand` (551), `readValue` (263), `pull` (276); `graph/base.ts` `settle` (202); `graph/figure.ts` `flush` (112).
- **States:** per record, a cell (`defined` with a value, or undefined with `reason`, `cause`, `detail`), `changedAt` (the epoch of its last change), `stale` (lazy mode: an input changed and the value is not computed). Figure-wide: `dirty` (sources written since the last pass), `clockDirty`, `epoch`, `demand` (`null` = eager), `forceAll` (true inside an operation), `faults` (commands whose rule threw).
- **Invariants:** one pass runs each rule at most once, in ascending order, and only when an input changed in this pass or is stale, or the rule reads the clock and the clock moved (cut-off); a rule never runs with an undefined input unless it accepts undefined (`input_undefined` instead); a list longer than `listSize` is undefined with reason `limit`; in eager mode no record is stale after a pass; in lazy mode a stale record is computed when read; a rule that throws makes its cell `not_finite` and is recorded in `faults`; no public read throws.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | `setFree`, `markDirty`, `setClock` | | marked | `dirty` / `clockDirty` |
| marked | `flush()` | nothing marked and not forced | idle | empty delta |
| marked | `flush()` | | walking | solver `sync` first (K11), `epoch++`, candidates = union of `downOf(dirty)` (+ `clockDown()`) |
| walking | candidate | no changed or stale input, clock rule not hit | skip | |
| walking | candidate | lazy, not needed, not `forceAll` | stale | `r.stale = true` |
| walking | candidate rule | | computed | `compute`; `setCell` stores and adds to `pendingValues` only when the cell differs |
| walking | rule throws inside `runCommand` | | computed | cell `not_finite`, `faults.push(name)` |
| walking | done | | idle | style owners of changed values marked for one `style` event; `deliver()` (K4) |
| stale | `readValue`, `cellOf`, `value` | | fresh | `pull`: recursively pulls stale inputs, then computes |
| eager | `setDemand(ids)` | | lazy | |
| lazy | `setDemand(null)` | | eager | every stale record pulled |

- **Reachable invalid states or transitions:** `pull` recurses once per stale ancestor, so reading the tail of a 5,000-object chain in lazy mode throws `RangeError` out of `value()` (KERN-SM-6, open). A rule that calls back into the figure during a pass can remove records the walk still holds, and `flush()` throws a `TypeError` (KERN-SM-8, open). `faults` is cleared only by line operations, so a rule that throws on every frame adds one entry per frame for as long as the clock plays (KERN-SM-8).

### K4. Operation bracket and events

- **Where:** `graph/base.ts` `inPass` (75), `diffReport` (99); `graph/core.ts` `on` (740), `queue` (746), `deliver` (751), `takeListenerFailures` (772); `graph/figure.ts` `stepTo` (361).
- **States:** `opDepth` and `passDepth` (0 = no operation running), `pass` (the change tracker of the innermost operation: first cell of each record, records added), `pendingEvents`, `pendingValues`, `pendingStyles`, `listeners`, `listenerFailures`.
- **Invariants:** events are delivered only when no operation runs (`opDepth === 0`); one `value` and one `style` event per delivery; a nested operation reports its own changes and hands them to the outer one; a listener's exception never escapes and becomes one `listener_failed` notice on the result of the operation it happened in; a listener sees events in the order the figure changed.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| outside | `apply`, `delete`, `rename`, `move`, `undo`, `applyBatch`, `load` | | inside (depth+1) | fresh `pass`, `forceAll = true` |
| inside | nested operation | | inside (depth+1) | inner `pass`; merged into the outer when it ends |
| inside | end | depth > 1 | inside | |
| inside | end | depth = 1 | outside | caller calls `deliver()` |
| outside | `deliver()` | | delivering | swap out the queues, build `value`/`style` events, call each listener in order |
| delivering | listener calls a figure operation | | delivering (nested) | the nested operation delivers its own events to every listener before the outer loop goes on |
| delivering | listener throws | | delivering | `listenerFailures++` |
| outside | `flush`, `setClock`, `stepTo` (no bracket) | | delivering | |

- **Reachable invalid states or transitions:** a listener that changes the figure on an event makes the later listeners see the newer events first (`remove` before `add` of the same object; KERN-SM-15 part b, open). A listener failure during a frame (`flush`, `setClock`) is reported on the next line's result instead (KERN-SM-18, open).

### K5. Line transaction (apply, dry run, redefinition)

- **Where:** `graph/tx.ts` `apply` (113), `repaired` (153), `applyInner` (189), `applyDefine` (422 to 630), `applyRestyle` (632), `applyRerange` (650), `applyRate` (679), `applyAction` (707), `rollbackTx` (98), `record` (92); `graph/hist.ts` `insertAt` (730).
- **States:**

| State | Holds |
|---|---|
| `idle` | |
| `parsing` | `parseLine` with the host's `langLimits` |
| `checking` | `checkLine` against `figure.view`; a self-reference on a free Number, Point or Bool re-checks without graph checks (`assign`) |
| `planning` | partial redefinition refused, `locked`, cycle (`reaches`), `forward_reference` (`insertAt`), compile, compute once, styles built |
| `dry` | `opts.dryRun`: the plan summary is returned, nothing committed |
| `committed` | records inserted or `Persist` swapped, one journal entry (`txEntry`), `settle` pass |
| `faulted` | `faults` not empty after the commit: `rollbackTx` reverts `txEntry` |
| `rejected` | an error object; `repaired` vets each suggestion with a dry run (`vetting = true`) |

- **Invariants:** a rejected line leaves the figure, the journal (both stacks) and the clock unchanged and says `committed: false`; an accepted line is exactly one journal entry; a dry run returns the same result (summary, report, notices) that the commit would return and changes nothing; `a = a + 1` on a free Number, Point or Bool is stored as a free value; a fixed object is not redefined or reranged without `force`; nothing throws.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | `apply(text)` | junk input | rejected | `tool_input` |
| idle | `apply(text)` | | parsing | `faults = []`, `txEntry = undefined` |
| parsing | parse error | | rejected | |
| checking | `cycle` with path `[a, a]` on a free Number, Point or Bool | | checking (assign) | graph checks skipped; the kernel tests the other inputs with `reaches` |
| checking | other error | | rejected | |
| planning | some names of a defmany exist | | rejected | `bad_argument` |
| planning | existing fixed object | not `force` | rejected | `locked` |
| planning | an input reaches the object | | rejected | `cycle` |
| planning | `insertAt` and an input at or after the index | | rejected | `forward_reference` |
| planning | rule throws while computing once | | rejected | `internal` |
| planning | `dryRun` | | dry | summary from the computed cell |
| planning | same text, no `with` | | committed | `redefined_to_same`, value refresh only |
| planning | | | committed | `add` or `sets` entry, reorder (`moved_for_order`), `settle`, `clamped`, `diffReport` |
| committed | a downstream rule threw in `settle` | | faulted | `rollbackTx`: revert `txEntry`, `journal.discard` |
| faulted | | | rejected | `internal` |
| committed | action line | | committed | the handler's own operation (K6, K7, K8, Delete, Rename, Show, Hide) |
| rejected | not `vetting`, not `dryRun` | | rejected | `repaired`: suggestions tried with `apply(s, { dryRun: true })` |

- **Reachable invalid states or transitions:** an action rule that changes the figure and then throws, and an `Undo()` line whose replay makes a rule throw, both return `internal` with `committed: false` while the change stays (`faulted` with no `txEntry`; KERN-SM-10, open). The `dry` row skips the slider clamp, the `becameUndefined` diff and the `confusable_name` notice, so a dry run does not match the commit (KERN-SM-14, open). The commit of an out-of-range slider gives two `clamped` notices (KERN-SM-20, open).

### K6. Journal (undo and redo stacks, groups)

- **Where:** `history/journal.ts` `Journal` (lines 85 to 214): `begin` (104), `end` (113), `abandon` (123), `discard` (130), `record` (154), `trim` (166), `takeUndo` (178), `pushRedo`, `takeRedo`, `pushUndo`.
- **States:** `stack` (undo), `redoStack`, `open` (`null` or one group being collected), `bytes` (an estimate), `dropped`. Entries: `add`, `remove`, `sets`, `item`, `group` (one level).

| State | Holds |
|---|---|
| `closed` | `open === null`; records go straight to `stack` |
| `collecting` | `open` group; records go into it; `begin` again joins it |

- **Invariants:** a new record clears the redo stack; `stack` holds at most `journalEntries` entries and about `journalBytes` bytes, oldest dropped and counted; entries are undone in reverse order of recording; while a group is collecting, nothing outside it is taken back or replayed; a group is closed only by the operation that opened it.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| closed | `begin(label)` | | collecting | |
| collecting | `begin(label)` | | collecting | joins the open group (label ignored) |
| any | `record(e)` | | same | `redoStack` cleared; into `open` or onto `stack` (+ `trim`) |
| collecting | `end()` | group empty | closed | no entry |
| collecting | `end()` | one entry with the group's label | closed | the entry itself |
| collecting | `end()` | | closed | one `group` entry pushed |
| collecting | `abandon()` | | closed | entries returned for the caller to revert |
| any | `discard(e)` | `e` is the newest | same | removed |
| any | `takeUndo('group')` | `stack` not empty | same | top popped |
| any | `takeUndo('line')` | top is a group of more than one | same | last entry popped out of the group in place |
| any | `takeRedo()` / `pushUndo` / `pushRedo` | | same | |

- **Reachable invalid states or transitions:** `takeUndo` and `takeRedo` are allowed while a group is collecting, and they act on `stack`, which holds entries recorded before the group opened (KERN-SM-9, open). A nested `begin` joins the open group, but the nested `end` closes the outer one (KERN-SM-9). One group can hold any number of entries and counts as one against `journalEntries`; `trim` never drops the last entry, so a single large batch bypasses both caps (KERN-SM-1, open).

### K7. Undo and redo

- **Where:** `graph/hist.ts` `undo` (373), `redo` (377), `stepHistory` (381), `effectOf` (409), `actionHistory` (430); `graph/tx.ts` `revertEntry` (738), `replayEntry` (778), `performRemove` (809).
- **States:** `idle`, `replaying` (`this.replaying = true`: `record` does not write the journal), and the journal states of K6.
- **Invariants:** an undo reverses exactly one entry (or one line of the top group for the line unit), with the same records and ids; undo followed by redo is the identity; undo and redo commit an open gesture first; `Undo()` in a batch takes back the batch's own last line (kernel design 11.2: the teacher's `Undo()` takes back one line); a faulting rule during a replay is reported without hiding that the replay happened.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | `undo({unit})` / `Undo()` | | idle | `commitDrag()` first |
| idle | `undo` | `takeUndo` gives nothing | idle | `nothing_to_undo` |
| idle | `undo` | entry | replaying | `revertEntry(e)`, `pushRedo(e)`, `effectOf`, `diffReport`, `undo` event |
| idle | `redo` | entry | replaying | `replayEntry(e)`, `pushUndo(e)` |
| replaying | done | | idle | `deliver()` when outermost |
| replaying | `add` reverted | | | `removeRecs` |
| replaying | `remove` reverted | | | `insertRecs` at saved positions, detached rules and item anchors restored, `settle` |
| replaying | `sets` reverted / replayed | | | reorder, `applyPersist` per change, `settle`, solver restart when rates changed |

- **Reachable invalid states or transitions:** `Undo()` and `Redo()` inside `applyBatch` or `append` act on entries from before the batch, and an atomic rollback after them loses both the object and its history entry (KERN-SM-9, open). An `Undo()` whose replay faults is reported as rejected (KERN-SM-10, open). Undo after a drag that was not committed before a redefinition replays the states out of order (KERN-SM-11, open).

### K8. applyBatch (atomic and independent)

- **Where:** `graph/hist.ts` `applyBatch` (449 to 505).
- **States:** `atomic` or `independent` mode; `running` (journal collecting, one outer bracket, each line its own nested `apply`), `rolled back`, `done`. Saved at entry: `redoBefore`, `evMark`, `valMark`, `styMark`.
- **Invariants:** atomic: either every line commits and the batch is one undo step, or the figure, both journal stacks and the pending events are exactly what they were; independent: each line commits or fails alone, a line reading a failed name gets `blockedBy`; events are delivered once at the end; an open gesture is committed first.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | `applyBatch(lines)` | `lines` not an array | done | `tool_input` |
| idle | `applyBatch` | | running | `commitDrag()`, `journal.begin(group)` |
| running | line ok | | running | `merge` the report |
| running | line fails | independent | running | `failed` += the line's target names |
| running | line fails | atomic | rolled back | `abandon()`, revert entries newest first, restore `redoStack`, pending queues, clear `pass` |
| running | last line | | done | `journal.end()`, `diffReport` |
| done / rolled back | | | idle | `deliver()`, `listener_failed` notice |

- **Reachable invalid states or transitions:** a `Undo()`, `Redo()`, nested `applyBatch` or `append` inside the batch breaks both modes: atomic rollback reports `rolledBack: true` with objects left in place, or removes an object that existed before the batch (KERN-SM-9, open). The batch has no size limit of its own: the `fileSize` limit of `fromScript` and `append` does not apply, and comment and directive lines are not counted by any limit (KERN-SM-1, open). A drag during a batch can only come from re-entrancy (a listener runs after the batch; a rule or an action calling `setFree`), and is covered by KERN-SM-8 and KERN-SM-11.

### K9. Free writes, gestures and drags

- **Where:** `graph/hist.ts` `setFree` (514), `writeFree` (519 to 580), `commitDrag` (587), `dragPlan` (609), `planDrag` (615 to 661), `drag` (664); `gesture` map in `graph/base.ts`.
- **States:** per figure, `no gesture` (`gesture` empty) or `gesture open` (a map from record to the `Persist` it had when the gesture began). A write has a `why`: `drag` and `slider` join the gesture; `show_me` and `api` are journalled at once; `solver` is never journalled.
- **Invariants:** only free (or, for the solver, state) records are written; a fixed object is not written without `force`; a value of the wrong type is refused; a gesture is one journal entry from its first to its last value, ordered with the other entries by when it ended; every user write is undoable; a stored value is never changed afterwards; drag plans write only free parents and never a fixed one.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `setFree(x, v, why)` | unknown name | same | `unknown_name` |
| any | `setFree` | a state and `why` is not `solver` | same | `not_free` (state owned) |
| any | `setFree` | a rule | same | `not_free` with a suggested `X = value` |
| any | `setFree` | fixed, `why` not `solver`, no `force` | same | `locked` |
| any | `setFree` | value does not fit the type | same | `bad_argument` |
| any | `setFree` | same value | same | `{ changed: false }` |
| no gesture | `setFree` `drag`/`slider` | | gesture open | `gesture.set(rec, before)`, value clamped and snapped to the range |
| gesture open | `setFree` `drag`/`slider` | | gesture open | last write wins |
| any | `setFree` `show_me`/`api` | | same | `sets` entry now |
| any | `setFree` `solver` or any other `why` | | same | no entry |
| gesture open | `commitDrag()`, `undo`, `redo`, `applyBatch` | | no gesture | one `sets` entry when a value changed |
| gesture open | `apply`, `delete`, `rename`, `move`, `setFree('show_me')` | | gesture open | their own entries are recorded before the gesture's |
| any | `dragPlan(x, target)` | fixed / state / not draggable / undefined / bad target | same | `{ writes: [], reason }` |
| any | `dragPlan` | free Point, Number or Bool | same | one write |
| any | `dragPlan` | rule with `invert`, depth ≤ 8 | same | the parents' writes |
| any | `drag(plan)` | writes | gesture open | `setFree(..., 'drag')` each, one `flush` |

- **Reachable invalid states or transitions:** a line or a `show_me` write during an open gesture is journalled before the gesture, so undo goes back to the start of the gesture and then forward to the middle of it (KERN-SM-11, open). `why: 'solver'` writes a fixed free object with no journal entry, any `why` outside the five is accepted and not journalled, the stored value is the caller's object, and a value with a throwing getter throws out of `setFree` (KERN-SM-4, open).

### K10. Clock

- **Where:** `graph/figure.ts` `setClock` (155), `setBeats` (145), `clockRange` (132); `clockState` and `env.t`, `env.bt`, `env.beat` in `graph/core.ts`.
- **States:** `clockState` `{ t, bt, beat }`, `beatStarts`, the `@clock a..b` item (film range; `0..Infinity` without it).
- **Invariants:** `t` is a number inside the film range; `bt = t - start of the current beat` and `beat` is the index of the last beat start at or before `t`, unless given; the clock changes only through `setClock` and `setBeats`, never through undo; a seek is one pass; `clockState` and `env` agree.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `setClock(t)` | `t` not a number or NaN | same | `bad_argument` |
| any | `setClock(t)` | the clamped `t`, `bt` and `beat` are unchanged | same | empty delta |
| any | `setClock(t)` | | moved | clamp to the range, compute `beat` and `bt`, `markClockDirty`, `clock` event, `flush` (unless `flush: false`) |
| any | `setBeats(starts)` | an array | moved | finite starts sorted, then `setClock(t)` |
| any | `@clock` directive | | same | `structureVersion++`, `markClockDirty` (the next pass recomputes; `t` is not re-clamped until the next `setClock`) |

- **Reachable invalid states or transitions:** the default range ends at `Infinity` and `setClock(Infinity)` is accepted, so with a state in the figure the seek never returns (KERN-SM-5, open; K11).

### K11. State solver

- **Where:** `clock/solver.ts` `StateSolver` (lines 54 to 437): `rebuild` (87), `formGroups` (133), `initial` (181), `deriv` (239), `step` (297), `at` (343), `sync` (371); hooked in `graph/figure.ts` (constructor, `stateDriver`) and called at the start of every `flush`.
- **States:** `version` (the figure structure it was built for), `dirtyInputs`, `layout` (one slot per state), `cone` (rules between states and rates), `groups` with `failedAt` (grid step at which a group blew up, or `Infinity`), `y0`, `checkpoints` (every 120 steps), `curN`/`curY` (last grid point reached).

| State | Holds |
|---|---|
| `inactive` | no state objects |
| `stale` | structure version changed, or an input of a rate or initial value was written: checkpoints cleared |
| `ready` | `y0` and checkpoints valid up to the frontier |
| `group failed` | a group's `failedAt` ≤ the current step: its states are `not_finite`, other groups keep stepping |

- **Invariants:** results do not depend on frame rate or seek path; the cone's and the states' cells are put back after integrating; a seek costs at most the steps from the nearest checkpoint; work and memory per seek are bounded; a change that does not touch a state, a rate or their inputs does not restart the integration.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `flush` → `active` | version changed | stale (rebuilt) | layout, cone, inputs, groups rebuilt; `missing` rates |
| any | `noteFree(rec)` | `rec` is an input | stale | checkpoints cleared on the next `sync` |
| stale/ready | `sync()` | | ready | `at(n)` from the nearest checkpoint ≤ n (or `y0`) up to `n = floor((t - t0) / h)`; Hermite between grid points |
| ready | step | a group's value not finite or > 1e9, or its rate undefined | group failed | `failedAt = n + 1`, one `unstable_state` notice |
| ready | `sync` | | ready | states written with `setCell`; changed states become pass sources |

- **Reachable invalid states or transitions:** `at(n)` has no step budget: `setClock(1000)` takes 70 ms, `setClock(1e6)` about 70 s and `setClock(Infinity)` never returns, and `checkpoints` keeps two arrays per film second (KERN-SM-5, open). The `stale` row fires on every structural change (`structureVersion` is bumped by any `wire`), so a line that touches no state re-integrates from `t0` to the clock: 6.6 ms at `t = 100` (KERN-SM-16, open).

### K12. Step list, reveal cursor and script items

- **Where:** `graph/figure.ts` `steps` (311), `sentence` (341), `stepTo` (361), `cursor` (370); `graph/tx.ts` `applyNoop` (279), `applyDirective` (297), `insertItem` (292); `graph/hist.ts` `doDelete` re-anchoring, `move` (697), `movePlan` (677), `insertAt` (730); `history/journal.ts` `ScriptItem`.
- **States:** `stepCursor` (`undefined` = every step shown, or `0..count-1`); `items` (comments and directives, each anchored `after` an object id or at the top); a `@step "title"` item marks the object right after its anchor as a breakpoint.
- **Invariants:** the step list is a view over `list` (no second structure); the cursor is not part of undo; the cursor is in `0..count`; a comment, a directive and a `@step` title stay next to the object they were written after, also after `insertAt`, `move` and `Delete` (re-anchored to the nearest surviving object); a non-repeatable directive replaces the earlier one in place.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `stepTo(n)` | NaN or not a number | same | |
| any | `stepTo(n)` | `n ≥ count` | all shown (`undefined`) | `step` event |
| any | `stepTo(n)` | | cursor `n` | `step` event |
| all shown | new object | | all shown | |
| cursor `k` | new object | | cursor `k` | `step_hidden` notice |
| any | comment line | | | item after the last object, `item` entry |
| any | directive | repeatable (`step`, `beat`, `cell`, `colwidth`, `limit`) | | appended |
| any | directive | other, already present | | replaced in place (`findIndex` over all items), keeps its anchor |
| any | `Delete` | an item's anchor removed | | anchor moves to the nearest earlier survivor (journalled) |
| any | `insertAt(i, line)` / `move` | | | items keep their anchor id |

- **Reachable invalid states or transitions:** `insertAt(i, ...)` after an object that anchors a `@step` title moves the breakpoint from the object it marked to the inserted one (KERN-SM-13, open). Directive replacement scans every item, so a file of many comments and directives is quadratic (KERN-SM-7, open). Items are counted by no limit (KERN-SM-1, open).

### K13. Save and load

- **Where:** `graph/figure.ts` `objectLine` (377), `toScript` (403), `fromScript` (436), `append` (446), `load` (450 to 506); `graph/values.ts` `valueSource`, `numberSource`, `textSource`.
- **States:** `load` runs `checking` (type, `fileSize`, `@fig` version) → `applying` (journal collecting, one bracket, each logical line through `apply` with `failed` for `blockedBy`) → `done` (`end()`) or, in strict mode with an error, `rolled back` (`abandon()`, revert). `fromScript` builds a new figure and clears its journal; `append` keeps the history and adds one `load` group.
- **Invariants:** `fromScript(toScript(f))` gives the same names, definitions, free values, properties and cells (kernel design 13.3); a rejected strict load or append leaves the figure, both journal stacks and the listeners' view unchanged; every file line that fails is in the report with its file line; a file larger than `fileSize` is refused before parsing; a file cannot reach history from before it was loaded.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | `load(text)` | not a string | done | `tool_input` |
| idle | `load` | `text.length > fileSize` | done | `limit` `file_size` |
| idle | `load` | first line `@fig n`, `n > SCRIPT_VERSION` | done | `version` |
| idle | `load` | | applying | `journal.begin('load')` |
| applying | line ok | | applying | |
| applying | line fails | lenient | applying | error recorded, `failed` += target names |
| applying | line fails | strict | rolled back | revert entries; `load_failed` with the first error as `cause` |
| applying | end | | done | `journal.end()`, `deliver()` |
| any | `toScript()` | | | header, items by anchor, each object's line (free values as literals), rate lines last |

- **Reachable invalid states or transitions:** a free Text with `\r`, `“`, `”` or `„` is written unescaped and the file fails to load (`unterminated_string`, `missing_operator`); a free Text longer than about 2,000 characters is written on one line and fails with `limit` (KERN-SM-12, open). A rejected strict `append` clears the redo stack and sends `add` and `remove` events for an object that never existed (KERN-SM-15 part a, open). `Undo()` and `Redo()` lines in an appended file take back the host's earlier lines (KERN-SM-9, open).

### K14. Slice

- **Where:** `graph/figure.ts` `slice` (257 to 307).
- **States:** a `Slice` value holding `chain` (rule records between the source and the target, in order) and `touched`; during `run(values)`: `swapped` (cells, stale flags and the clock overwritten) then `restored` in `finally`.
- **Invariants:** nothing is journalled or emitted; every cell, stale flag and clock field is put back after `run`, also when a rule throws; the source is free or the clock.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | `slice(source, target)` | unknown name | idle | `unknown_name` |
| idle | `slice` | source not free | idle | `not_free` |
| idle | `slice` | | built | chain from `downOf(source)` (or `clockDown`) ∩ ancestors of the target |
| built | `run(values)` | | swapped | for each value: write the source cell (or `env.t`, `env.bt`, `clockState.t`), compute the chain, read the target |
| swapped | end or throw | | restored | cells, stale flags, `t` and `bt` put back |

- **Reachable invalid states or transitions:** none found. The chain is computed when the slice is made, so a slice used after a structural change computes the records it held then; that is the documented scratch behaviour, not a state the figure keeps.

### K15. Errors, suggestions and limits

- **Where:** `errors/table.ts` `err` (169), `fallbackInternal`, `internalError`, `checkErrorTable`; `errors/compact.ts` `compactError`; `errors/notices.ts` `makeNotice`; `errors/limits.ts` `resolveLimits`; `graph/tx.ts` `repaired` (153, `vetting`); `graph/props.ts` `validKeysFor`, `defaultsFor`.
- **States:** the error registry is immutable after load; `vetting` is `true` while `repaired` dry-runs suggestions (a failing try is not repaired in turn); `Limits` is frozen per figure.
- **Invariants:** `err` never throws and falls back to the hard-coded `internal` object; every error has `committed: false` and is true about it; at most 3 suggestions, each one passes a dry run; the compact form is at most about 800 characters; messages name the thing without echoing unbounded user text; every size budget in kernel errors.md 6 is enforced on every path into the figure; exported helpers never throw.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| | `err(kind, at, params)` | kind known | error | code, phase, recovery, message from the registry |
| | `err` | building throws | error | `fallbackInternal` |
| error | leaves `apply`, `delete`, `rename`, `setFree` | not `vetting`, not a dry run | error | `repaired`: `unknown_name` gets a define line; each suggestion dry-run; kept ≤ 3 |
| error | `compactError(e)` | | compact | drops `params`, `messageKey`, `fingerprint`, `committed`, `phase`; caps lists; drops `source`, `cause`, `related`, `forms`, `expected`, `endCol` and trims `hint` until it fits |

- **Reachable invalid states or transitions:** `compactError` never shortens `message` or `token`, and API errors echo the caller's text, so a 5,000-character unknown name gives a 10,133-character compact error and a 100,000-character rename a 100,157-character one (KERN-SM-2, open). `validKeysFor`, `defaultsFor` and `makeNotice` throw on names of `Object.prototype` members (KERN-SM-19, open). Limits that can be bypassed: KERN-SM-1. A shared `CommandRegistry` gains the nine kernel actions again for every figure built on it (KERN-SM-3, open).

## language

Checked at commit `d2d9d9e` (pass 1), at `3220d23` (round 2, after the fixes for LANG-SM-1 to LANG-SM-21) at `94f9db0` (round 3, after the fixes for LANG-SM-9, 22, 23 and 24) at `03d9ae2` (round 4, after the narrowed ruling SM-23 and the fixes for LANG-SM-24 to 27) and at `eddcac1` (round 5, after ruling Q-R4-1 option a and the fixes for LANG-SM-28 to 32) on `feat/language`. Paths are under `packages/kernel/src/language/`. Line numbers in L5, L7, L8, L9 and L11 refer to `eddcac1`; L1 and L2 keep the numbers of `03d9ae2`, L3 those of `94f9db0` and the other machines those of `3220d23` (no change since). Findings are in `handoff/language/findings.md`. Open after round 5 (the last fixer round; listed there as known bugs): LANG-SM-33 and LANG-SM-34.

### L1. Normaliser modes

- **Where:** `source.ts` `normalise` (lines 54 to 216), `hexColourLength` (lines 42 to 51, shared with L2 and L3), `BLANKS` (line 32: the space and every `REPLACE` key rewritten to a space).
- **States:**

| State | Holds |
|---|---|
| `code` | Typographic rewrites apply (`−`, `×`, `π`, superscripts, smart quotes open a string) |
| `string` (braceDepth 0) | Characters copied; `\x` copied as a pair; `{` enters interpolation |
| `string` (braceDepth > 0) | Code rules apply inside `{…}`; nested `{`/`}` counted |
| `comment` | Characters copied to end of line |

- **Invariants:** `start[i]`/`end[i]` map every normalised index to the raw text; a newline always returns to `code`; the lexer (L3) and the splitter (L2) see the same string and comment boundaries as this machine.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `\n` or `\r` | | `code` | braceDepth = 0; `\r\n` becomes one `\n` |
| `code` | `#` | `hexColourLength(src, i)` > 0: previous character not in `BLANKS` (space, tab, U+00A0, U+2009, U+202F, U+2003, U+2002) is a single `=` (not `==` `<=` `>=` `!=` `≠` `≤` `≥`), then 3, 4, 6 or 8 hex digits not followed by a name character | `code` | colour copied as it is; the rest of the line keeps the code rules |
| `code` | `#` | otherwise | `comment` | |
| `code` | `"` `“` `”` `„` | | `string` | pushes `"` |
| `string`/0 | `"` `“` `”` `„` | | `code` | pushes `"` |
| `string`/0 | `{` | | `string`/1 | |
| `string`/>0 | `{` / `}` | | depth ±1 | |
| `string`/>0 | `"` `“` `”` `„` | | `code` | depth = 0 (the lexer reports the open brace) |
| `code` or `string`/>0 | superscript run, REPLACE char | | same | rewrite with offset map |

- **Reachable invalid states or transitions:** none open. `hexColourLength` runs here on the raw text and in the lexer on the normalised text; because it skips exactly the characters this machine rewrites to a space, both give the same answer for every blank (a blank this machine keeps, such as U+3000, is `bad_character` before the `#` in every scanner). Closed: LANG-SM-24 (round 4), LANG-SM-8.

### L2. Logical-line splitter (continuation lines)

- **Where:** `source.ts` `scanLineDepth`, `splitLogicalLines`, `lastLogicalStart` (lines 311 to 395), on the raw text with only `\r\n` and `\r` turned into `\n`; used by `parser.ts` `parseLine` and `parseProgram`, `tooling.ts` `cursorContext` and `tokenize`.
- **States:** per physical line: `open` (bracket depth > 0 at its end, the next line joins) or `closed`. Inside `scanLineDepth`, for one physical line: `depth` (carried in from the previous line), `inString`, `braces` (interpolation depth inside a text); a comment ends the scan of the line. Only `depth` crosses a newline.
- **Invariants:** a line continues only while a round or square bracket is open (README decision 17); texts and comments are skipped exactly as the lexer skips them; a text never spans a newline; `splitLogicalLines` and `lastLogicalStart` make the same cut; one pass, each character scanned once. An over-long logical line is still joined (the lexer reports one `limit` for it).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start of line i | scan line with depth 0 | depth at end = 0 | `closed` | emit logical line |
| start of line i | scan line | depth at end > 0 and a next line exists | `open` | scan the next line with the carried depth |
| `open` | end of program | | `closed` | emit; the lexer reports `unbalanced` |
| scan | `\r` | | | `inString` = false, `braces` = 0 |
| scan | `"` `“` `”` `„` | not in a text | `inString` | |
| scan | `"` `“` `”` `„` | in a text, any `braces` | not in a text | `braces` = 0 |
| scan, in a text, `braces` = 0 | `\` | | | skip the next character |
| scan, in a text | `{` / `}` | | | `braces` ±1; brackets inside are ignored |
| scan | `#` | not in a text, `hexColourLength` > 0 | | skip the colour; the scan goes on |
| scan | `#` | not in a text, otherwise | end of line | rest of the line is a comment |
| scan | `(` `[` / `)` `]` | not in a text | | depth ±1, never below 0 |

- **Reachable invalid states or transitions:** none open. For each blank in `BLANKS` between `=` and a colour, a bracket opened after the colour continues the line, as in the lexer. Closed: LANG-SM-24 (round 4: one blank set with L1), LANG-SM-8 (text across a newline, `„`), LANG-SM-5 (quadratic rescans).

### L3. Lexer

- **Where:** `lexer.ts` `lex`, `lexRange`, `lexString`, `lexNumber`, `lexName` (lines 76 to 531), on the normalised text (L1).
- **States:** `main` loop of `lexRange(from, to, top, base)` with a bracket `stack` (`base` is the number of brackets open around an interpolation); `string` scan (`lexString`) with an interpolation sub-scan that recurses into `lexRange(top = false, base)`; `number` scan; `name` scan (with `_{…}` subscript); terminal `limit` (line too long: no tokens). A running `tokenTotal` counts every token pushed, interpolations included.
- **Invariants:** every error carries columns of the raw text; the token count (800) and nesting depth (64) cover the whole line, interpolations included; one bad character (one code point) gives one error; tokens never overlap; the `unbalanced` suggestion closes the brackets outside any trailing comment.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | raw length > 2,000 | | `limit` | only an `eof` token |
| main | `(` `[` | base + stack < 64 | main | push |
| main | `(` `[` | base + stack = 64 | stop | `limit` error, rest of line unlexed |
| main | `)` `]` | stack empty / wrong opener | main | `unbalanced` error (pop on mismatch) |
| main | `"` | | string | carries base + stack |
| string | `{` | matching `}` before `"` or `\n` | `lexRange(top = false, base)` | tokens kept in the part, counted in `tokenTotal` |
| string | `\n` or end | | main | `unterminated_string` |
| main | `#` | `hexColourLength(text, i)` > 0 (same test as L1 and L2, run on the normalised text) | main | a `name` token `#rrggbb` |
| main | `#` | otherwise | main | `comment` token to end of line |
| main | other character | | main | one `bad` token over the whole code point + `bad_character` |
| end | | top and stack not empty | done | `unbalanced`; suggestion = text before a trailing comment + closers + the comment |
| end | | `tokenTotal` > 800 and no earlier error | done | `limit` |

- **Reachable invalid states or transitions:** none open. It runs `hexColourLength` on the normalised text and L1 and L2 on the raw text; the shared `BLANKS` set makes the answers equal. Closed: LANG-SM-24 (round 4), LANG-SM-7, LANG-SM-19, LANG-SM-6.

### L4. Parser and line-kind dispatch

- **Where:** `parser.ts` `Parser` (lines 34 to 1058), `parseLine`, `parseLineInner`, `parseLogical`, `parseProgram` (lines 1074 to 1153).
- **States:** `Parser` fields `pos`, `depth`, `callStack`, `lineHead` (`bare`, `define`, `other`), `relationLike`; exit by return or by a `Stop` exception carrying the first error. A sub-parser is created for each text interpolation and starts at the outer `depth`. `parseLogical(text, opts, probe)` tries an `unbalanced` suggestion once, with `probe = true`, which never tries a further suggestion.
- **Invariants:** depth (calls, unary signs, `not`, power chains) never exceeds 64, counted together with the interpolation it sits in; one error per line from steps 1 and 2; error columns point at the token that caused them (the end of an interpolation is its `}`); the line number of an error is the physical line it is on, leading blank lines included; division by an implicit product, signed or not, is never read silently.
- **Transitions (line kind, first tokens):**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | `eof`/`nl`/comment | | `noop` | |
| start | `@` | | directive | words collected to end of line |
| start | name `=` (or keyword `=`) | | define | `lineHead = define` |
| start | name `,` … `=` | | defmany | |
| start | name `(` names `)` `=` | | function | |
| start | name `'`… `=` | | rate | |
| start | name `with` / name `in` | | restyle / rerange | |
| start | name `:` | | Stop | `syntax` (colon label) |
| start | digits name `=` | touching | Stop | `bad_name` (ruling Q11) |
| start | anything else | | bare expression | upper-case call left to the checker; else `unnamed_object` with a free name |
| expr | `enter()` | depth > 64 | Stop | `limit` |
| term | `/` then an operand | after stripping unparenthesised `+`/`-`, the operand is an unparenthesised implicit product | Stop | `ambiguous_implicit`; both quick fixes keep the signs |
| `parseLogical` | first lexer error is `unbalanced` with a suggestion | not `probe` | `parseLogical(suggestion, probe = true)` | suggestion dropped if the candidate fails |
| `parseLine` | more than one non-empty logical line | | error | `syntax` "a second line" at the first character of the second logical line |
| `parseLine` | one logical line | | `parseLogical` | line = `opts.line` + `firstLine` − 1 |

- **Reachable invalid states or transitions:** none open. Closed: LANG-SM-14, LANG-SM-18 (positions), LANG-SM-6, LANG-SM-7.

### L5. Checker contexts and scopes

- **Where:** `check.ts` `Checker` (lines 180 to 1651; `apart` line 222, `withSelf` line 248), `OverlayFigure` (lines 131 to 176); `lines.ts` `checkLine` (line 28), `checkStyle` (line 323), `checkDefine` (`self` at line 480), `checkFunction` (`self` at line 637); `table.ts` `SELF_ID` (line 170).
- **States:** one `Checker` per line with `fig` (the figure, or an overlay while `withSelf` runs), `errors` (cap 8), `notices`, `reads`, `usesT`, `hasCommand`, `rangeReads`, `styleReads`, `rangeUsesT`, `styleUsesT`, `scopes` (a stack of frames), `slotCount`, `nodes` (cap 2,000), `ctx`, `simpleUnknown`. `apart('range' | 'style', fn)` saves `reads`, `usesT` and `hasCommand`, runs `fn` with fresh `reads` and `usesT`, then moves what it read into `rangeReads` or `styleReads`, sets `rangeUsesT` or `styleUsesT` if `fn` read the clock, and restores all three saved fields, also when `fn` throws. Inside the style `apart`, `checkStyle` swaps `reads` once more per property, so each `CheckedStyle` carries its own `reads`, and merges them back into the style set in `finally`. `withSelf(self, fn)` replaces `fig` with an `OverlayFigure` holding only the name being defined, as an `ObjectInfo` with id `SELF_ID` (-1), and puts the old `fig` back in `finally`; `self` is made only on a first definition whose value typed without error. Frames are pushed for function parameters, relation `x`/`y`, binders and body-scope names. Exit by result, by collected errors, or by `Bail` (node limit).
- **Invariants:** a frame pushed is popped on every path; a local name resolves before constants, objects and commands; `reads` lists the inputs of the object's value rule only (kernel design 9.2: the cycle check follows value edges); `rangeReads` and `styleReads` are the inputs of the range and property rules; `free` is true exactly when the value expression reads no object, no clock and no command, whatever the range and style read (`isFreeNode`, `lines.ts:478`, reads only the value's facts); registries answer only their own keys, so every type in a typed node is a real `Ty`; slot numbers are unique within the line. `rangeUsesT` is true exactly when a range bound reads the clock and `styleUsesT` exactly when a style value does, so the kernel re-runs only the rule that reads `t`; `usesT` is the value's alone. All three reach `CompiledLine` unchanged (`compile.ts:1300-1303`). The name being defined resolves in the style list of its own first definition (ruling Q-R4-1) and nowhere else on that line: the value and the range are checked with the plain `fig`. `styleReads` lists every object a property rule reads, the line's own object included (kernel design 9.2: a self-reading style is legal and its edge is a style edge, not a cycle edge); `SELF_ID` never reaches the cycle test.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | `infer(node)` | nodes ≤ 2,000 | typing | `nodes++` |
| typing | `nodes` = 2,001 | | `Bail` | one `limit` error |
| typing | name | local frame has it | `local` node | |
| typing | name | object exists | `ref` node | `reads.add` (the current set: the value's, or the one `apart` installed) |
| typing | `t`/`bt`/`beat` | | `clock` node | `usesT = true` (the value's flag, or the fresh one `apart` installed) |
| typing | command call | | `command` node | `hasCommand = true`; inside `apart` it is put back when `apart` ends |
| typing | field `.f` | `own(FIELDS, type)` and `own(table, f)` | `field` node | |
| typing | field `.f` | not an own key | error | `type_mismatch` listing the fields |
| typing | function line | | push frame | params bound to slots 0, 1, … |
| typing | relation in `x`/`y` | | push frame | `x`, `y` bound to new slots |
| define/rerange | range clause | | `apart('range')` | reads go to `rangeReads`; a clock read sets `rangeUsesT` |
| define/function/restyle | style list | | `apart('style')` | reads go to `styleReads` and, per property, to `CheckedStyle.reads`; a clock read sets `styleUsesT`; a key `own(PROPERTIES, key)` misses is `unknown_property` |
| define/function | style list | name not in the figure, value typed | `withSelf` | the name resolves to `SELF_ID`; afterwards `SELF_ID` is deleted from `styleReads` but kept in `CheckedStyle.reads` |
| define/function | style list | name not in the figure, value has an error | plain `fig` | the name in the style is `unknown_name`, as before |
| define | range clause reads the name being defined | name not in the figure | error | `unknown_name` (`k = 3 in 0..k`); `cycle` once it exists |
| directive | `@name` | not `own(DIRECTIVES, name)` and not a figure directive | error | `unknown_directive` |
| define/function | done, no errors | | redefinition check (L7) | cycle test on `reads` and `rangeReads` (ruling SM-23, narrowed) |
| rerange | done, no errors | | cycle test (L7) | on `rangeReads` |
| restyle | done, no errors | | ok | no cycle test (style edges never form a cycle) |
| done | errors > 0 | | error | first error, up to 7 in `more` |
| done | non-`Bail` exception | | `internal` | |

- **Reachable invalid states or transitions:** the `withSelf` row deletes the self read from `styleReads`, so `P9 = (1, 2) with showIf = P9.x > 0` on an empty figure has `styleReads` `[]` while the same line on a figure holding `P9` has `[id of P9]`: LANG-SM-33 (open, new with the Q-R4-1 fix). Closed: ruling Q-R4-1 (round 5: the name resolves in a first definition's style list), LANG-SM-9 (round 3: `hasCommand` saved by `apart`), LANG-SM-1.

### L6. Command and function form matcher

- **Where:** `check.ts` `matchForms`, `diagnose`, `dropSuggestions` (lines 1101 to 1560).
- **States:** `bindings` (one per form: bound, missing, extra, duplicate named); `candidates` (arity fits); `speculative` (more than one candidate); `typed` cache of value arguments keyed by argument index and expected type (errors and notices stashed), with `typedKeys` per index and `flushedArgs`; per form `Test` (problems, invalid, score, binder problems, `bodyErrors`); outcome `chosen`, `tie` (internal), `argument errors`, `body errors`, `binder errors` or `diagnosis`.
- **Invariants:** a value argument is typed with the expected type of the form it is tested against; errors inside an argument, body arguments included, are reported in preference to a form diagnosis; notices of an argument are reported once; exactly one passing form or the most specific one wins.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | named arg repeated / unknown name | | error | `duplicate_arg` / `bad_argument` |
| start | no candidate and a duplicate named arg | | error | `duplicate_arg` |
| candidates | test each form | | tested | value args typed once per (index, expected type); bodies typed per form in a binder frame; with several candidates, body errors kept in that form's `bodyErrors` |
| tested | ≥ 1 passing | one lowest score | chosen | flush the chosen form's typings; notices of other typings only for arguments not flushed |
| tested | ≥ 1 passing | equal lowest scores | `internal` | |
| tested | none passing, some invalid | flushed value-argument errors > 0 | argument errors | |
| tested | none passing, some invalid | no value-argument errors, some `bodyErrors` | body errors | those of the failing form with fewest problems |
| tested | binder problems | | `not_a_binder` | |
| tested | otherwise | | diagnosis | `arg_count` or `no_matching_form`; argument types shown from an existing typing |

- **Reachable invalid states or transitions:** none open. Closed: LANG-SM-15, LANG-SM-16.

### L7. Redefinition, cycle and dependents check

- **Where:** `lines.ts` `findPath`, `checkCycle`, `checkRedefinition`, `parseOne` (lines 134 to 252), `checkRestyle` (line 719), `checkRerange` (line 731); `check.ts` `OverlayFigure` (lines 131 to 176, forwards `styleRulesReading`); `table.ts` `FigureView.inputsOf`, `dependentsOf`, optional `styleRulesReading`; `figure.ts` `ScratchFigure.dependentsOf` (line 102), `styleRulesReading` (line 110), `recordStyleRules` (line 246).
- **States:** `new` (object limit test), `redefine` → `type test` → `cycle test` → `dependents test` (each direct value or range dependent, by its `source`, and each stored property rule that reads the object, by its one-property restyle line, re-parsed and re-checked against an overlay with the new type) → `ok` or an error. Rerange lines run only the `cycle test`; restyle lines run none. The `cycle test` (`checkCycle`) is one iterative depth-first search over `inputsOf`, started from the line's `reads` and `rangeReads` together, with an explicit stack of iterators and one `seen` set across all start points; the path is read off the stack only on a hit. The `dependents test` walks `dependentsOf` (value and range readers) and `styleRulesReading` (property rules, one per owner and property).
- **Invariants:** a line whose value or range creates a cycle through value or range edges is refused with its path (ruling SM-23, narrowed); style edges never join the cycle test, so a style may read its own object or its dependents (kernel design 9.2); a line that keeps the value and range graph acyclic is never refused; the test visits each object and edge at most once and runs in bounded stack for every figure the object limit allows (5,000); free versus dependent is decided by the value's facts only (L5); the dependents test re-checks every value, range and style reader of the redefined object (design 3.12 step 4; style owners are downstream through their style edges, kernel design 9.2). The cycle test and the dependents test therefore need different edge sets: `inputsOf` without style edges, `dependentsOf` plus `styleRulesReading` with them; the kernel must keep the same split. A property rule's edges are exactly the reads of the current rule for that property: a later rule for the same property (from `P with …` or a redefinition with a `with` list) drops the old rule's edges, and a redefinition without a `with` list keeps them (design 3.12 step 6). A redefined object's `source`, as re-checked here, is its own rule without the `with` list (`printLineNode`); the printed text parses and checks like the typed one.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | no existing object | size ≥ 5,000 | error | `limit` |
| start | no existing object | | ok | no cycle test (the name is not in the graph yet) |
| start | existing | kind differs | error | `type_change` |
| type ok | DFS from `reads` ∪ `rangeReads` | reaches the target | error | `cycle` with `path` and `related` |
| type ok | DFS | finishes | dependents | |
| dependents | re-check each in `dependentsOf` | fails or changes type | error | `breaks_dependents` |
| dependents | re-check each rule in `styleRulesReading` | fails | error | `breaks_dependents`, the rule's line in `related` |
| dependents | a rule read the target, then was replaced for that property | | not re-checked | its edges are gone |
| dependents | the only reader is a first definition's style that reads its own object (Q-R4-1) | | not re-checked | the rule was stored without its self read |
| rerange | `a in lo..hi` | DFS from `rangeReads` reaches `a` | error | `cycle` (`a in 0..a`, `a in 0..b` with `b = a + 1`) |
| restyle | `P with …` | checks pass | ok | no cycle test (`P with showIf = P.x > 0` is accepted) |

- **Reachable invalid states or transitions:** on an empty figure, `f(x) = x with opacity = f(1)` then `f(x, y) = x + y` is accepted, while the same style written after `f` exists makes it `breaks_dependents` (last dependents row): LANG-SM-33 (open, new with the Q-R4-1 fix). `ScratchFigure` does not store rerange lines, so their new range edges are missing from its graph (a known limit of the scratch figure, not of the check). Closed: LANG-SM-32 (round 5: property rules per property, re-checked through `styleRulesReading`), LANG-SM-27 (round 4: style edges left the cycle test), LANG-SM-23 (round 3: range edges in the cycle test, also on rerange), LANG-SM-4. Measured at `eddcac1` on 5,000 objects: the full-chain value cycle is found in 2 ms; an acyclic change and the dependents test of the chain head take 2 to 3 ms; on a chain built through style edges, redefining the head (also to read the tail) takes 3 ms and finds no cycle; 4,999 property rules that read one function are re-checked in 42 to 52 ms.

### L8. Compiler and constant folding

- **Where:** `compile.ts` `guardInf` (line 88), `hasNonFinite`, `nonNumberIn` (lines 122 to 146), `numEq`, `valueEq`, `cmpNum` (lines 167 to 200), `Compiler` (from line 264; `objId` line 268, built-in results line 843, `compileRelation` lines 983 to 1032), `pointwise` (line 1109), `compileLine` (line 1206); `relation.ts` `classify` circle test (line 207); `builtins.ts` `powChecked`, `hslToRgb`, `mkColor`; `runtime.ts` `formatNumber` (line 123).
- **States:** one `Compiler` per line, with no line-wide flags except `opts.selfId`, which `objId` uses to turn a `SELF_ID` read (Q-R4-1) into the id the kernel gave the new object. Each node is compiled raw or folded: folded only when `isConstant` holds (no object, local, clock, command, relation, range, `undef`, builtin call, field read or `^` anywhere below) and evaluating it once in a scratch `Env` sets no reason and gives a defined, non-NaN value.
- **Invariants (the arithmetic rule):** folding gives the same value evaluation would give later and never calls the MathLib, so a later `setMathLib` reaches every result; folding never runs unbounded work. On every path and for every value kind (Number, List, Function, Point, Vector, Color, the coefficients of a relation, a formatted number in a text): a division by exactly zero, or `0 ^ negative`, is undefined `division_by_zero` (errors.md sections 1 and 8); an infinity made from finite inputs is undefined `overflow`; an infinity is a value only when an input was infinite (ruling Q4); a result that is not a number from numeric inputs (`inf - inf`, `0 * inf`) is `not_finite`; an undefined operand gives `input_undefined`; a list, point or vector with any undefined part is undefined as a whole. A comparison treats an infinity as a value: it equals only an infinity of the same sign; the relative tolerance applies to finite numbers only. A built-in result that holds numbers (Point, Vector, Color, list) follows the same rule number by number. A relation whose x/y-free parts are undefined or not numbers is undefined (holds for polynomial relations only, see below).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| node | compile | `isConstant`, not a literal, constant or text | try fold | kept raw if the scratch run sets a reason or gives NaN or `undefined` |
| Number `+ - * / ^` | evaluate | result not finite, both inputs finite | undefined | `overflow` (`guardInf`), or `not_finite` for NaN |
| Number `+ - * / ^` | evaluate | result infinite, an input infinite | value | |
| Number `/`, `^` | evaluate | divisor 0, or `0 ^ negative` | undefined | `division_by_zero` |
| builtin returning a Number | evaluate | result infinite, an argument (or a number inside one) infinite | value | |
| builtin returning a Number | evaluate | result not finite otherwise | undefined | `overflow` (finite inputs) or `not_finite` |
| builtin returning an object (Point, Vector, Color, list) | evaluate | `nonNumberIn` finds a NaN | undefined | `not_finite` (`hsl(inf, 1, 0.5)`) |
| builtin returning an object | evaluate | `nonNumberIn` finds an infinity, no argument infinite | undefined | `overflow` |
| builtin returning an object | evaluate | an infinity, an argument infinite | value | `perp((inf, 1) - (0, 0))` is `(-1, inf)` |
| line | final Number result | infinite | value | (every finite-input overflow already failed) |
| line | final Number result | NaN, no reason | undefined | `not_finite` |
| `list-num` | evaluate | scalar 0 with `/`, an item undefined, or an item overflows from finite inputs | undefined | `division_by_zero`, `input_undefined` or `overflow` for the whole list |
| `list-num` | evaluate | an item infinite, the item or the scalar infinite | list | the item stays `inf` |
| list literal | evaluate | an item undefined | undefined | `input_undefined` unless a reason is set |
| `pointwise` (function arithmetic, `-f`) | call | an input NaN | `NaN` | `input_undefined` |
| `pointwise` | call | `/` by 0, `0 ^ negative` | `NaN` | `division_by_zero` |
| `pointwise` | call | negative base, fractional exponent | `NaN` | `out_of_domain` |
| `pointwise` | call | result infinite, both inputs finite / an input infinite | `NaN` / value | `overflow` / |
| `pointwise` | call | result NaN, inputs defined | `NaN` | `not_finite` |
| `num*vec` `vec*num` `vec/num` `vec+vec` `pt+vec` `vec-vec` `pt-vec` `pt-pt`, polar point | evaluate | a coordinate not finite | per coordinate `guardInf`, then `mkPt` | undefined `overflow` or `not_finite`, or the point with an `inf` coordinate when an input was infinite |
| `vec/num` | evaluate | scalar 0 | undefined | `division_by_zero` |
| field | evaluate | result not finite, the object holds only finite numbers | undefined | `overflow` or `not_finite`; `Line.point` of a line with no direction is `division_by_zero` |
| `==` `!=` `<=` `>=` (`numEq`), relation test | evaluate | a side infinite (or NaN) and `a !== b` | not equal | exact; otherwise tolerance `1e-12` (values) or `1e-9` (relations) |
| relation with a polynomial form | evaluate | a coefficient NaN (overflow, `inf - inf`, undefined input) | undefined | the coefficient's reason, else `not_finite` |
| relation with a polynomial form | evaluate | a coefficient infinite from an `inf` input | relation | `poly` kept; never classified a circle |
| relation with no polynomial form | evaluate | an x/y-free part undefined or overflowing | defined relation | nothing is evaluated until sampling, and sampling restores the reason |
| text part `{n:d}`, `{n:%}` | evaluate | `n` finite, scaled value not finite | text `undefined` for that part | Point and Vector parts per coordinate |
| `ref`, `callObj`, `tick` | compile | id is `SELF_ID` and `selfId` given | reads `selfId` | |

- **Reachable invalid states or transitions:** a relation with no polynomial form stays defined when an input is undefined or a constant overflows (row "relation with no polynomial form"; `sin(x) == u` with `u = 1 / 0`): LANG-SM-34 (open, found in round 5). Closed: LANG-SM-28 (round 5: `numEq` exact on infinities), LANG-SM-29 (round 5: polynomial coefficients), LANG-SM-30 (round 5: `nonNumberIn` on built-in results), LANG-SM-31 (round 5: scaled formats), LANG-SM-25 and LANG-SM-26 (round 4: one rule for `pointwise`, `list-num`, points, vectors, literals, fields and `unit`), LANG-SM-22, LANG-SM-11, LANG-SM-13, LANG-SM-2. Checked and following the rule: derivative ticks, ranges, index, conditionals, `fact`, Number negation, user function calls, and command and `Particles` body arguments (compiled by the same `Compiler`).

### L9. Env and evaluation

- **Where:** `runtime.ts` `Env`, `createEnv`, `resetEnv`, `fail` (lines 60 to 120); `compile.ts` `evaluate` (line 1328), function values (in `compileLine`, lines 1220 to 1278), relation values and `sample` (lines 983 to 1032), `pointwise` (line 1109).
- **States:** `Env` fields `reason`, `cause`, `detail` (first reason wins), `locals` (slot array), `t`/`bt`/`beat`, `read`. One `Env` may evaluate several compiled lines (design 3.15). A `FunctionValue` or `RelationValue` captures the `Env` it was made in; a call saves the slots it writes and the caller's `reason`, `cause` and `detail`, writes the slots, evaluates, and puts all of them back. A `pointwise` function value keeps its own `reason`, cleared at the start of each call.
- **Invariants:** an evaluation starts with `reason`, `cause`, `detail` cleared; a call into a function or relation value leaves the caller's locals, reason and cause as they were; a value is undefined exactly when its reason is set; texts stay within 10,000 characters; an undefined text in `+` gives an undefined text.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `evaluate` | | clear | reset three fields |
| evaluating | domain problem | `reason` unset | reason set | `fail` |
| evaluating | `fv.call(xs)` | | callee running | save `env.locals[slot]` per parameter, write, evaluate, restore; save and restore `reason`, `cause`, `detail` |
| evaluating | `fv.call1(x)` / `fv.batch(xs)` | | callee running | save, write, restore the one slot; save and restore `reason`, `cause`, `detail` |
| evaluating | `pointwise` call | | callee running | `self.reason` cleared, then set to the reason of this sample |
| evaluating | `rel.residual(x, y)` / `rel.test(x, y)` | | | `sample`: save, write, restore the `x` and `y` slots and `reason`, `cause`, `detail`; `residual` is NaN when two finite sides differ by a non-finite amount |
| evaluating | relation line, polynomial form | a coefficient NaN | undefined | its reason, else `not_finite` |
| evaluating | relation line, no polynomial form | an input undefined | defined | no reason; every sample NaN (LANG-SM-34) |
| evaluating | `text + text` | either side undefined | undefined | `input_undefined` |
| evaluating | `text + text`, interpolation | result over 10,000 characters | undefined | `limit`, checked before the text is built |
| evaluating | exception | | undefined `not_finite` | slots written by an interrupted call stay written; the next evaluation writes before it reads |

- **Reachable invalid states or transitions:** a relation with no polynomial form whose input is undefined is a defined value (`sin(x) == u` with `u = 1 / 0`): LANG-SM-34 (open). `sample` has no `try`/`finally`; an exception while sampling leaves slots and reason written, but then ends the whole evaluation (the last row). Closed: LANG-SM-29 (round 5: `sample` restores the reason; polynomial coefficients), LANG-SM-25 (round 4: `L / 0` is undefined), LANG-SM-10, LANG-SM-11, LANG-SM-12, LANG-SM-3.

### L10. Module-level mutable state

- **Where:** `builtins.ts` `M` with `setMathLib`/`getMathLib` (lines 41 to 49), `dv` (line 221); `types.ts` `setCache` (line 99); `tooling.ts` `lowerCache` (line 385, cleared at 50,000); registries `check.ts` `FIELDS`, `props.ts` `PROPERTIES` and `DIRECTIVES`, `types.ts` `TYPE_ALIASES` (plain objects other areas append to), read through `own` (`props.ts` line 20).
- **States:** MathLib `platform` or `replaced`; caches empty or filled.
- **Invariants:** every evaluation of every figure uses one MathLib, read at evaluation time (no folded result holds an older one); registries answer only their own keys.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| platform | `setMathLib(lib)` | | replaced | all figures, all later evaluations, including lines compiled before |
| registry | lookup `own(R, key)` | key not an own property | miss | an `Object.prototype` member is never returned |

- **Reachable invalid states or transitions:** none open. Closed: LANG-SM-1, LANG-SM-13.

### L11. ScratchFigure

- **Where:** `figure.ts` `ScratchFigure` (lines 70 to 272; `dependentsOf` line 102, `styleRulesReading` line 110, `define` keeps `styleRules`, `apply` lines 194 to 239, `recordStyleRules` line 246), `withoutStyle` (line 279), `targetNamesOf` (line 295).
- **States:** entries by name and id, `order`, `nextId`, `clockState`; each entry has `value`, `inputs` (the union of the line's `reads` and `rangeReads`: the edges the cycle test of L7 follows), `styleRules` (a map from property to `{ source, reads }`, one rule per property, only for rules that read an object), `info.source` (the defining line printed without its `with` list), optional `compiled` and its own `env`. `applyAll` keeps a `failed` map of names a failed line would have made.
- **Invariants:** public methods never throw; a name made by a failed line, braced subscripts included, marks later readers with `blockedBy`; `free` is what the checker said; `inputsOf` holds value and range edges (cycle test); `dependentsOf` lists value and range readers and `styleRulesReading` the property rules that read an object (dependents test, L7); a property's rule is the last one set for it, from any line kind; a line gives an object the same edges whether the object existed before or not; `compileLine` gets `selfId` = the id `define` is about to give.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| absent | `apply` define/function | checks pass | present | evaluated with a new Env kept on the entry; `inputs` = value and range reads; each style item replaces `styleRules[key]` (stored only if it reads an object other than `SELF_ID`) |
| present | `apply` restyle | checks pass | present | each item replaces `styleRules[key]`; a rule that reads nothing only removes the old one |
| any | `apply` rerange | checks pass | unchanged | returned as applied, nothing stored: the new range edges are not in `inputs` |
| present | `apply` same name, with a `with` list | | present | same id; order not moved; the listed properties replace their rules, the others are kept |
| present | `apply` same name, no `with` list / `define()` | | present | `styleRules` kept |
| any | `setValue`, `setClock` | | recomputed | creation order, each entry's own Env |
| any | `define(name, type, value, {inputs})` | an input name unknown | present | that input skipped |
| `applyAll` | line fails | | `failed` += `targetNamesOf(src)` | `P_{1}` stored as `P_1` |

- **Reachable invalid states or transitions:** the first absent-to-present row drops a `SELF_ID` read instead of mapping it to the new id, so a first definition's style that reads only its own object stores no rule and the dependents test misses it (`f(x) = x with opacity = f(1)` on an empty figure, then `f(x, y) = x + y` is accepted): LANG-SM-33 (open). Rerange lines are not stored, so a later cycle test on this figure misses their edges; that is a stated limit of the scratch figure (it is not the kernel), noted in `handoff/language/findings.md`, not a finding. The real kernel must drop a target's property rules when the target is deleted (this class has no delete). Closed: LANG-SM-32 (round 5: property rules per property), LANG-SM-27 (round 4: style reads out of `inputs`), LANG-SM-9 (stored `free` now true for a command in a range or style), LANG-SM-17, LANG-SM-20.

### L12. Preview

- **Where:** `tooling.ts` `preview`, `shiftBack`, `previewInner` (lines 70 to 140).
- **States:** `analyse` → (`unnamed_object` → `retry` under the name the line would get, from the error's `name` param, or `pvw<k>` only if none was offered) → `compiled` → `evaluated` in a fresh Env reading the figure → result; or error with `incomplete`. An error from `retry` goes through `shiftBack`.
- **Invariants:** nothing in the figure changes; error columns and lines refer to the text the user typed (prefix removed, trimmed leading whitespace and blank lines added back); a temporary `pvw` name never reaches the user unless no name was offered; a preview runs no unbounded work.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| analyse | `unnamed_object` | text not empty | retry | prefix `name = ` and analyse again |
| retry | error | | error | positions moved back; `source` set to the typed text |
| analyse | error | | error | `incomplete` from kind and key |
| ok | define, not state, not command | | evaluated | evaluation runs (builtins not folded) |

- **Reachable invalid states or transitions:** none open. Closed: LANG-SM-18, LANG-SM-2.

### L13. Cursor context, signature help, completion, highlighting

- **Where:** `tooling.ts` `cursorContext`, `typeArgs`, `signatureHelp`, `complete`, `tokenize`, `colourLine`, `localNameTokens` (lines 167 to 804); `source.ts` `lastLogicalStart`.
- **States:** cursor in `comment`, `string`, `string expression`, after `.`, after `@`, after `in`, in a style list, after `prop =`, start of line, inside a call (frame stack of open brackets with comma positions), elsewhere. Completion keeps a sorted top list of `limit + 12`. `tokenize` lexes each logical line on its own with its `firstLine`.
- **Invariants:** the logical line found for the cursor is the one the splitter (L2) makes; cost per keystroke is linear in the text before the cursor; `tokenize` colours any text it is given, line by line (a single logical line over 2,000 characters gives `limit` only); registry lookups use `own`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| prefix | `lastLogicalStart` | | logical prefix | one forward pass, same scanner as L2 |
| prefix | lex | | frames | `(`/`[` push (callee if a name precedes), `)`/`]` pop, `,` records |
| frame | `typeArgs` | complete args | typed args | one fresh `Checker` per argument |
| `tokenize(source)` | split into logical lines | | per line | lex and colour; errors collected from every line |

- **Reachable invalid states or transitions:** none open. After a hex colour preceded by any blank in `BLANKS`, `lastLogicalStart` cuts where the splitter does and `tokenize` gives the tokens of the plain-space line. Closed: LANG-SM-24 (round 4), LANG-SM-5, LANG-SM-21.

### L14. Command and function tables

- **Where:** `table.ts` `createCommandTable`, `createFunctionTable`, `checkTable` (lines 130 to 267); `builtins.ts` `BUILTIN_FUNCTIONS`.
- **States:** immutable once created (maps by name and by lower-cased name, sorted names).
- **Invariants:** a table never changes under a compiled line; `checkTable` reports every pair of forms that accept the same arguments with neither more specific.
- **Transitions:** none after creation; a new table is a new value. A figure's `commands` and `functions` may be swapped by the host between checking and compiling, but compiled lines hold the spec and form objects they were checked against.
- **Reachable invalid states or transitions:** none found.

## view

Checked at commit `1525786` (pass 1) on `feat/view`. Paths are under `packages/view/src/`; line numbers refer to `1525786`. Findings are in `handoff/view/findings.md` (VIEW-SM-1 to VIEW-SM-27, all open). Every reachable invalid state below was reproduced through the public API in happy-dom unless marked "code path".

### V1. Figure scheduler

- **Where:** `core/scheduler.ts` `schedulerTick` (lines 136 to 220), `registerFigure`, `touchFigure`, `setPlaying`; `web/scheduler-host.ts` `SchedulerHost.tick` (lines 87 to 100), `observe`, `noteScroll`, `start`.
- **States (per figure):**

| State | Holds |
|---|---|
| `placeholder` | Script and saved picture; nothing built |
| `ready` | Built, one frame drawn |
| `live` | Drawing frames while dirty or playing |
| `paused` | Built, drawing nothing; `pausedOffscreenSinceMs` set when off screen |
| `saved` | Picture plus kernel/view state; resources freed |

Per-figure flags: `inView`, `near`, `nearSinceMs`, `lastUsedMs`, `playing`. Host flags: `scrollSettled`, `tabVisible`, the visible and near sets, the 500 ms interval and the settle timer.

- **Invariants:** at most `maxLive` (3) figures are `live`; a figure is `live` only while in view and the tab is visible; a build or restore happens only after the scroll settled and the figure was near for `settleMs`; every built figure (`ready` or `paused`) that stays off screen for `saveMs` becomes `saved`; one tick's actions are dispatched in order against the state the tick produced; a tick with unchanged inputs produces no actions (no flapping).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | register | id new | `placeholder` | stats.registered |
| `live` | tick | not in view or tab hidden | `paused` | `pause`; off-screen timer starts when not in view |
| `placeholder` | tick | settled, near for >= 150 ms | `ready` | `build` |
| `saved` | tick | settled, near for >= 150 ms | `ready` | `restore` |
| `ready`, `paused` | tick | in view, tab visible, live count < 3 | `live` | `goLive` |
| `ready`, `paused` | tick | in view, live count = 3, LRU unpinned live victim not touched later than this one | `live` | victim to `paused` (`pause`), then `goLive` |
| `paused` | tick | off screen for >= 8 s | `saved` | `save`, stats.saves |
| any | unregister | | (gone) | no action emitted; the host releases resources |

- **Reachable invalid states or transitions:**
  - Flapping: four untouched in-view figures (equal `lastUsedMs`) swap one `pause` and one `goLive` on every tick forever, because the victim check at line 190 breaks only when the victim is strictly newer. VIEW-SM-13, open.
  - `ready` figures that leave the near zone never pause or save (step 5 at line 202 handles `paused` only); after 120 s far away a figure is still `ready` with no action. VIEW-SM-13, open.
  - Re-entrant tick: an `onAction` callback that calls `touch` or `setPlaying` runs a nested tick inside the dispatch loop (line 95); the outer loop then dispatches stale actions (`goLive(b)` twice, `goLive(c)` for a record already `paused`). VIEW-SM-13, open.
  - Builds wait for the next 500 ms interval tick, because the observer tick at `nearSinceMs` is too early and no tick is scheduled at `nearSinceMs + 150`: a figure seen at t = 0 builds at 500 ms. VIEW-SM-26, open.

### V2. Shared GPU context, figure boxes and the WebGL2 back-end

- **Where:** `web/shared-context.ts` `SharedGpuContext` (`create`, `acquireBox`, `resizeBox`, `releaseBox`, `present`, `dispose`); `backends/webgl2.ts` `WebGL2Backend` (`track`, `owned`, every `create*`, `readPixels`, `dispose`).
- **States:**

| State | Holds |
|---|---|
| `noGpu` | `backendValue = null`; boxes have a visible canvas and `target = null` |
| `gpu` | One `WebGL2Backend`; each box has an MSAA `Target` |
| `lost` | The GL context is lost: every `create*`, `draw`, `readPixels` returns `internal` |
| `restored` | Browser restored the context; every old handle is dead |
| `disposed` | Boxes cleared, back-end disposed |

Per box: `absent` → `acquired` (canvas, `ctx2d`, target) → `resized` (target recreated) → `released`.

- **Invariants:** figures never create their own GPU context; a box's target matches its canvas size in device pixels; every handle in `owned` is alive; after a restore every live box and every `Figure3D` gets fresh resources; a box id belongs to one figure.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| (none) | `create` | WebGL2 available | `gpu` | 16 x 16 offscreen canvas |
| (none) | `create` | otherwise | `noGpu` | |
| `gpu` | `acquireBox(id)` | id new | box `acquired` | visible canvas, target |
| `gpu` | `acquireBox(id)` | id exists | box `resized` | returns the same box (and canvas) |
| `gpu` | `resizeBox` | | box `resized` | old target disposed, new target; handles pushed to `owned` |
| `gpu` | `present(id)` | box and target | `gpu` | resolve, `readPixels`, flip, `putImageData` |
| `gpu` | context lost | | `lost` | none (no listener) |
| `lost` | context restored | | `restored` | none (no listener) |
| any | `dispose` | | `disposed` | |

- **Reachable invalid states or transitions:**
  - `restored` is never handled: no `webglcontextlost` or `webglcontextrestored` listener exists, so targets, programs and arenas cached in boxes and `Figure3D` stay dead and 3D figures stay blank until reload (code path). VIEW-SM-6, open.
  - `owned` only grows: disposed targets and arenas are never removed, so every resize keeps 5 to 7 dead handles. VIEW-SM-4, open.
  - `present` reads the whole box back to the CPU and allocates two full-size buffers every frame. VIEW-SM-25, open.
  - Two figures with the same id share one box and one canvas; releasing one blanks the other (code path; depends on the host reusing ids). Noted under VIEW-SM-6.

### V3. FigureView lifecycle and frame request

- **Where:** `web/figure-view.ts` `mount` (257), `unmount` (359), `resize` (389), `requestFrame` (545), `frame` (578), `setViewRegion`/`goHome` tweens (441, 466).
- **States:** `created` (no root) → `mounted` (root, canvases, listeners) → `destroyed` (`destroyed = true`, root null). Frame request flag `pending`. View tween `tween` (`null` or `{from, to, startMs, durMs}`); camera tween `camTween`.
- **Invariants:** a mounted figure draws when something is dirty; `pending` is true only while one frame callback is queued; `view.width/height` equal the root's CSS size after any resize; a tween never overrides a newer size.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `created` | `mount(el)` | | `mounted` | canvases, a11y nodes, listeners, first frame |
| `mounted` | `unmount` | | `destroyed` | listeners removed, box released, `Figure3D` disposed |
| `destroyed` | `mount(el)` | root null | `mounted` but `destroyed` still true | returns ok; `requestFrame` refuses forever |
| `mounted` | dirty mark | not `pending` | `pending` | schedule `frame` |
| `pending` | frame | | not `pending` | events, update, layout, paint, reader list |
| `mounted` | `resize` | | `mounted` | viewport rebuilt at the new size |
| tween active | frame | | tween active or null | `view = tweenViewport(from, to, t)` at `from`'s size |

- **Reachable invalid states or transitions:**
  - `destroyed` then `mount`: returns `ok`, queues no frame and builds no reader list. VIEW-SM-7, open.
  - Resize during a tween: the next tween frame restores `from.width`; after the tween ends the viewport is still 800 px wide in a 400 px element. VIEW-SM-15, open.
  - With a synchronous `scheduleFrame` (or no `requestAnimationFrame`), the end-of-frame `requestFrame` recurses while a highlight or tween lives (code path). Noted under VIEW-SM-23.

### V4. Draw list, dirty flags and cached layers

- **Where:** `core/drawables.ts` `DrawList` (`add`, `remove`, `resort`, `applyEvent`, `markViewDirtyAll`, `markPanDirty`, `activeIds`), `updateDrawables`, `splitForActive`; `web/figure-view.ts` `paintScene2D` (cache key at 980), `markCacheInvalid`, `paintVersion`, `bgDirty`.
- **States:** per entry `clean`, `valueDirty`, `viewDirty` (both may be set); figure-wide `paintVersion` (counter), `cacheValid` + `cacheKey` (lower and upper bitmaps), `bgDirty`.
- **Invariants:** an entry is rebuilt exactly when its value, style or the viewport changed; a pan shifts cached pixels of non-viewport-dependent kinds; the lower and upper bitmaps stay valid across the frames of one interaction and are invalidated only by a viewport change, a restyle, or an add or remove in `lower` or `upper` (design 7.4); live drawables hold live-viewport geometry whenever input can reach them.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| absent | `add` event | `create` returns a drawable | `valueDirty`+`viewDirty` | binary-search insert |
| any | `update` / `restyle` | | `valueDirty`+`viewDirty` | `paintVersion++`, cache invalid |
| any | `remove` | | absent | `indexOf` + `splice` |
| any | zoom, resize, theme | | `viewDirty` | all entries |
| any | pan | `shiftPixels` true | unchanged | pixels shifted |
| dirty | update phase | | `clean` | geometry rebuilt, hit index updated |
| `cacheValid` | frame | key equal | `cacheValid` | composite cached bitmaps |
| any | frame | key differs | `cacheValid` with new key | repaint lower and upper, new full-size canvas |
| live geometry | `exportSvg`/`exportPng` | | export geometry | rebuilt at the export viewport until the next frame |

- **Reachable invalid states or transitions:**
  - The cache key contains `paintVersion`, which every drag move bumps (via `applyEvents`), so during a drag the bitmaps are rebuilt every frame and a full-size canvas is allocated per frame (code path). VIEW-SM-22, open.
  - After an export the drawables hold export-viewport geometry until the next frame; a hit test at a point's live position finds nothing in that window. VIEW-SM-14, open.
  - `remove` and the 3D `SceneIndex` use `indexOf` per id, so removing or updating many ids is quadratic. VIEW-SM-24, open.

### V5. 2D pointer interaction modes

- **Where:** `web/figure-view.ts` `onPointerDown` (1248), `onPointerMove` (1342), `onPointerUp` (1584), `onWheel`, `onDoubleClick`, `rescaleAxis` (1426); fields `pointers`, `pinchStart`, `band`, `panning`, `drag`.
- **States:**

| State | Holds |
|---|---|
| `idle` | No pointer down; hover updates `hovered` |
| `band` | Shift-drag rubber band rectangle |
| `panning` | Background pan (`axis = both`) |
| `axisRescale` | Pan record with `axis = x` or `y` |
| `dragPending` | `drag` set, `started = false` (below 3 px mouse / 8 px touch) |
| `dragging` | `drag.started = true`; `kernel.drag` called per move |
| `labelDrag` | `drag.plan.kind = label`; `labelOverride` holds the preview |
| `pinch` | Two pointers; zoom about the midpoint |

- **Invariants:** exactly one mode at a time; leaving `dragging` always ends the kernel drag (V6); the axis-rescale path respects the same zoom limits as wheel zoom.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | down | no hit, shift | `band` | capture |
| `idle` | down | no hit, near an axis | `axisRescale` | capture |
| `idle` | down | no hit | `panning` | capture; selection cleared |
| `idle` | down | hit, plan `none` | `panning` | `drag_fixed` / `drag_path_undefined` / `drag_blocked` gesture |
| `idle` | down | hit, plan set | `dragPending` | selection set, grab offset |
| `dragPending` | move | >= threshold | `dragging` or `labelDrag` | first `kernel.drag` or override |
| any one-pointer mode | second pointer down | | `pinch` | `drag = null`, `panning = null` |
| `band` | up | | `idle` | rubber-band select |
| `dragging` | up or `pointercancel` | | `idle` | rounded `drag`, `commitDrag`, announcement |
| `labelDrag` | up | | `idle` | `onRestyle` |
| `dragging`, `labelDrag` | Esc | | `idle` | `cancelDrag`, `drag = null` |
| `axisRescale` | move | factor > 0.2 | `axisRescale` | scale changed with no zoom limit check |

- **Reachable invalid states or transitions:**
  - `dragging` → `pinch` drops the session without `commitDrag` or `cancelDrag`; the kernel log shows one `drag` and nothing else. VIEW-SM-9, open.
  - `pointercancel` (the browser took the gesture) commits instead of cancelling (code path). VIEW-SM-9, open.
  - `labelDrag` → Esc sends `cancelDrag` to a kernel that never started a drag and leaves `labelOverride` set, so the label stays at the preview position. VIEW-SM-9, open.
  - `axisRescale` skips the 1e-9 / 1e9 width limits and the precision floor and gives no `zoom_limit` feedback (code path). VIEW-SM-20, open.

### V6. Drag session protocol with the kernel

- **Where:** `web/figure-view.ts` `applyDragMove`, `onPointerUp`, `onKeyDown` (Esc at 1716, `moveSelected` at 1741), `onPointerMove3D`, `onPointerUp3D` (2099), `onKeyDown3D` (`moveSelected3` at 2168), `unmount`; `core/drag.ts` `computeDragPlan`, `projectOnSamples`, `clampParam`; `contracts.ts` `DragApplier`.
- **States:** kernel side `closed` / `open` (after the first `drag`). View side: 2D `drag` session, 3D `point3Drag` session, keyboard nudge (a one-shot `drag` + `commitDrag`).
- **Invariants:** every `open` ends in exactly one `commitDrag` or `cancelDrag`; no nudge commits while a pointer session is open; `cancelDrag` is sent only for an open drag; a `parents` drag moves each parent by the pointer delta from its value at drag start; a path drag sends `s` in the path's domain units, continuous with the previous `s`; `fixed` objects never move (2D and 3D, pointer and keyboard).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `closed` | move in `dragging` | | `open` | `drag(moves)` |
| `open` | move | | `open` | `drag(moves)` |
| `open` | pointer up | | `closed` | `drag(rounded)`, `commitDrag` |
| `open` | Esc (2D) | | `closed` | `cancelDrag` |
| `closed` | arrow key with selection | plan `free` | `closed` | `drag` + `commitDrag` |
| `open` (3D) | pointer up | | `closed` | `commitDrag` |

- **Reachable invalid states or transitions:**
  - Parents drag adds the start-to-pointer delta to the parents' current values on every move: moving the pointer 2 units in 10 moves takes A from -2 to 9 (expected 0). VIEW-SM-8, open.
  - Arrow key during an open pointer drag: log `drag, drag, commit, drag, drag, commit` (two commits, one mid-drag). VIEW-SM-9, open.
  - Esc does not end a 3D `point3Drag`; unmount does not end any drag (code path). VIEW-SM-9, open.
  - Path drag sends a fraction: the pointer at x = 3 on a function with domain -5..5 sends `s = 0.8`. With grid snap on, `snapParamToGrid` searches the whole path regardless of the pointer and sends `s = 0.7` for pointers at x = 3 and x = -4. `hintS` is a constant `null` (line 1318), so the 24 px continuity window never runs. VIEW-SM-10, open.
  - 3D arrow keys move a point styled `fixed` (`drag` + `commit` logged). VIEW-SM-17, open.

### V7. Selection, focus, hover and pick cycling

- **Where:** `core/selection.ts` (`clickSelect`, `selectAll`, `rubberBandSelect`); `core/hit.ts` (`HitIndex`, `cyclePick`); `web/figure-view.ts` fields `selection`, `focused`, `hovered`, `cycle`, `stepFocus`, Ctrl+A at 1847 and 2231, Delete.
- **States:** `selection.ids` (set), `anchor`, `focus`; `focused` id; `hovered` id; cycle state (`lastX`, `lastY`, `lastTimeMs`, `index`).
- **Invariants:** selected, focused and hovered ids are objects that exist and are visible; Ctrl+A selects visible selectable objects only (design 11); the rubber band selects every object whose bbox meets the band, points included; Delete reports only existing ids.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | click hit | selectable | `{hit}` or toggled | |
| any | click background | not additive | empty | |
| any | band release | | union with band hits | |
| any | Ctrl+A | | every head that is selectable | |
| any | Esc | no drag | empty | |
| non-empty | Delete | | empty | `onDelete(ids)` |
| any | kernel `remove` | | unchanged | nothing pruned |

- **Reachable invalid states or transitions:**
  - Ctrl+A selects an object with `show = false`; Delete then reports `[1, 2]` including the hidden one. VIEW-SM-12, open.
  - A band around a point selects nothing: a point drawable's `rubberShape` has no strokes and no fills. VIEW-SM-12, open.
  - After a kernel `remove` of A, Delete still reports A. VIEW-SM-12, open.

### V8. Snap memory

- **Where:** `core/snap.ts` `snapPosition`, `snapWithHysteresis`, `snapParamToGrid` (138); `web/figure-view.ts` `snapContext` (1219), `snapMem`.
- **States:** `free` (`target = null`), `held` (target and radius).
- **Invariants:** `held` releases beyond 1.5 x radius; candidates exclude the dragged object and its descendants; host intersections are candidates in `points` mode; the indicator names the real source; memory starts empty for each drag.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `free` | move | a candidate within 12 px | `held` | position snapped |
| `held` | move | within 18 px, fresh candidate | `held` | new target |
| `held` | move | within 18 px, none | `held` | old target, source reported as `grid` |
| `held` | move | beyond 18 px | `free` or `held` | |

- **Reachable invalid states or transitions:** the `intersections` option is never called (`intersections: []` at line 1244); descendants are not excluded; the memory survives between drags; a hold on a point is reported as `grid`. VIEW-SM-18, open.

### V9. 3D camera and gestures

- **Where:** `web/figure-view.ts` `onPointerDown3D` (1958), `onPointerMove3D` (2012), `onPointerUp3D`, `onWheel3D`, `onDoubleClick3D`, `onKeyDown3D` (2163); fields `camDrag`, `point3Drag`, `camTween`, `cameraProps`; `core/camera.ts`.
- **States:** `idle`, `orbit`, `pan` (`camDrag`), `pointDrag` (plane, axis or depth), `camTween` (400 ms ease).
- **Invariants:** zoom stays in 1e-6..1e6 on every input; a point drag ends in commit or cancel; `fixed` blocks pointer and keyboard moves.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | down | no hit, or shift, or middle button | `orbit` / `pan` | capture |
| `idle` | down | free, not fixed `point3` | `pointDrag` | gizmo axis/plane, alt depth, shift z axis |
| `orbit` / `pan` | move | | same | camera props updated |
| `pointDrag` | move | | same | `drag([point3])` |
| `pointDrag` | up | | `idle` | `commitDrag` |
| `idle` | double-click | | `camTween` | reset or retarget |
| any | `+` / `-` key | | same | zoom x 1.5 or / 1.5 with no clamp |

- **Reachable invalid states or transitions:** Esc leaves `pointDrag` open (VIEW-SM-9); arrow keys move `fixed` points (VIEW-SM-17); keyboard zoom has no clamp (VIEW-SM-20). All open.

### V10. Label layout cache

- **Where:** `web/figure-view.ts` `layoutLabels` (703, budget slice at 741), `paintOverlay3D` (2299), `prevLabelOffsets`, `labelOverride`, `placements`; `core/labels.ts` `placeLabels`; `core/drawable.ts` `paintLabel`, `setLabelOffset`, `clearLabelOffset`.
- **States:** per label `none` (no request), `auto` (offset from `placeLabels` with hysteresis), `user` (style `labelDx`/`labelDy`), `preview` (`labelOverride` during a drag), `overBudget` (beyond the first 300 requests).
- **Invariants:** at most 300 labels paint, lowest priority hidden first, with a notice (performance 5); only labels in the viewport count; at most 200 auto-place per frame; `preview` exists only during a label drag; layout cost stays within the frame budget.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `none` | frame | label mode not `none` | `auto` or `user` | offset set |
| `auto` | frame | score worse by > 25% | `auto` (moved) | |
| any | label drag move | | `preview` | override set |
| `preview` | pointer up | | `user` (after the sdk writes the line) | `onRestyle` |
| `preview` | Esc | | `preview` (stuck) | `cancelDrag` |
| request 301+ | frame | | `overBudget` | keeps the last offset or the default and still paints |

- **Reachable invalid states or transitions:** 400 labelled points export 400 `<text>` elements and the live paint loop calls `paintLabel` for all of them; `checkLabels` is never called, so no notice; the budget is taken in list order including off-screen labels (VIEW-SM-2). Markers are not culled: 300 labels with 5,000 labelled points cost 128 ms per frame (VIEW-SM-21). Esc leaves `preview` set (VIEW-SM-9). All open.

### V11. Budgets and level of detail

- **Where:** `core/budgets.ts` (`DEFAULT_BUDGETS`, `checkObjects`, `checkParticles`, `checkTriangles`, `checkLabels`, `capCurveSamples`); `core/drawables.ts` `ResolutionController`; `core/particles.ts` `ParticleQuality`; `core/geometry.ts` `capSamples`, `reduceRun`, `conicSegmentCount`; `core/export.ts` `MAX_SVG_ELEMENTS`; `backends/software.ts` `SOFTWARE_TRIANGLE_CAP`; `web/figure-3d.ts` arena sizes.
- **States:** `ResolutionController.level` 0..2 (3 overruns down, 30 good up); `ParticleQuality.q` 1 to 0.25 in 0.25 steps (5 bad down, 60 good up); export `under cap` / `refused`.
- **Invariants:** every budget in performance.md 5 is enforced where the view owns it (labels shown, SVG elements, curve samples per curve on screen); a cap stops work before the work is done; GPU arenas are never written past their capacity; caches are bounded.
- **Transitions:** level and quality counters move as in the design. The SVG cap is checked once, after the whole document is built (line 2431).
- **Reachable invalid states or transitions:**
  - A 30,000-point export builds every element (127 ms) before refusing; 5,000 curves of 4,000 samples stay under 50,000 elements, so a document of hundreds of MB is returned with no refusal (code path). VIEW-SM-3, open.
  - The canvas hatch-pattern cache keeps one tile canvas per distinct colour forever: 1,000 animated colours made 1,000 canvases. VIEW-SM-4, open.
  - `Figure3D` writes fixed arenas (lines 8 MB, about 58,000 segments; points 2 MB, 65,536 points; mesh 24 MB, about 629,000 vertices) with no bound check (code path). VIEW-SM-17, open.
  - `checkTriangles`, `checkLabels` and `capCurveSamples` have no caller in the view; a curve with many runs caps each run, not the curve (code path). VIEW-SM-2, open.

### V12. 3D scene and `Figure3D` resources

- **Where:** `core/scene.ts` `SceneIndex` (`applyEvent`, `dropId` at 136); `web/figure-3d.ts` `applyEvents` (`sceneVersion++` at 84), `ensureResources`, `uploadAll`, `paint` (upload check at 262), `drawLines`, `dispose`.
- **States:** resources `none` → `ready` (programs, three arenas) → `disposed`; upload `current` (`uploadedVersion = sceneVersion`) / `stale`.
- **Invariants:** an event re-uploads only the items it touched; resources are recreated after a context restore; every back-end draws every item kind it receives.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `none` | first paint | | `ready` | programs and arenas created |
| `current` | any kernel event | | `stale` | `sceneVersion++` |
| `stale` | paint | | `current` | every mesh and point rewritten |
| `ready` | `dispose` | | `disposed` | |

- **Reachable invalid states or transitions:** moving one point re-uploaded all 144 KB of a 60 x 60 mesh (VIEW-SM-24); the software back-end turns line quads into zero-area triangles from the wrong attribute layout, so 3D segments are invisible without WebGL2 (VIEW-SM-17); no path back from `ready` after a context restore (VIEW-SM-6). All open.

### V13. Live-region announcer

- **Where:** `web/figure-view.ts` `announce`, `flushAnnounce`, `announceTimer`, `queuedAnnounce`, `lastAnnounceMs`.
- **States:** `idle`, `spoken` (inside the 800 ms window), `queued` (timer armed, last message kept).
- **Invariants:** at most one message per 800 ms; the last queued message is spoken when the window closes; no timer survives `unmount`.
- **Transitions:** `idle` → speak → `spoken`; `spoken` + message → `queued` (timer); timer or frame → speak → `spoken`; `unmount` clears the timer.
- **Reachable invalid states or transitions:** none found.

### V14. Export

- **Where:** `web/figure-view.ts` `exportSvg` (2378), `exportPng` (2491); `core/export.ts` `normalizeExport`, `exportViewport`, `svgEscape`, `svgId`; `backends/svg.ts` `SvgSurface`.
- **States:** `validate` → `snapshot` (token held when `time` is set) → `rebuild at export viewport` → `paint` → `encode` → `restore live` (mark dirty, request frame) → result. PNG: `encode` is async after the token is released.
- **Invariants:** the snapshot token is always released; live drawables are back at live geometry before any input can reach them; untrusted text reaches SVG only escaped, in text content or quoted attributes, never as raw CSS; the element cap stops work early.
- **Transitions:** as listed; every error path releases the token (checked).
- **Reachable invalid states or transitions:** live geometry is left at the export viewport until the next frame (VIEW-SM-14); `textStyle.family` from the figure is written raw into the `style` attribute, so `x;fill:url(https://evil.example/beacon)` becomes a CSS declaration (VIEW-SM-1); the cap is checked after building (VIEW-SM-3); `region: 'objects'` uses view-clipped pixel bboxes (VIEW-SM-16). All open.
