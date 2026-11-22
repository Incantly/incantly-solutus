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


## plot

Checked at commit `8f3a4c8` (pass 1) on `feat/plot`. Paths are under `packages/plot/src/`. Line numbers refer to `8f3a4c8`. Findings are in `handoff/plot/findings.md`; all are `open` after pass 1.

### P1. Sample cache

- **Where:** `cache.ts` `createSampleCache`, `cacheKey`, `seedForRange`, `paramSeedForRange` (lines 11 to 106). Used by callers to build `seed` for `plotFunction` and `traceParamCurve`.
- **States:** per cache: two insertion-ordered maps (scalar, parametric), each `key -> { version, samples }`, at most `capacity` keys each (default 8). No notion of function identity or current version.

| State | Holds |
|---|---|
| `empty` | No entries |
| `holding` | 1 to `capacity` entries per map, any mix of versions |

- **Invariants:** a seed for `(function, version)` holds only that function's samples at that version, one value per x; a seed only saves evaluations, so a plot is the same with or without it; a version change discards the older samples (functions-calculus 9, "Cache and incremental update").
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| any | `put(key, version, xs, ys)` | | `holding` | copies the arrays; an existing key keeps its insertion position |
| `holding` | `put` | size > capacity | `holding` | drops the first-inserted key (`trim`) |
| any | `seedForRange(version, lo, hi)` | | same | merges samples in `[lo, hi]` from every entry whose version matches, regardless of key |
| any | `clear()` | | `empty` | |

- **Reachable invalid states or transitions:**
  - Entries of other functions or views with the same version number are merged into one seed, with duplicate x values; the most recently re-put key can be evicted first; nothing clears older versions. [PLOT-SM-10](../handoff/plot/findings.md), open.
  - Seed samples count against `maxSamples` in the tracers, so a large seed stops refinement before it starts. [PLOT-SM-6](../handoff/plot/findings.md), open.

### P2. Function plot run (setup, refine, classify, band; suspend and resume)

- **Where:** `function.ts` `plotFunction` (1427), `resumeFunctionPlot` (1499), `runLoop` (1019), `runCurve` (1032), `runSetup` (314), `runRefine` (362), `runClassify` (461), `runExact` (992), `toToken` (1313), `checkToken` (1353), `finishSuspended`/`finishComplete` (1393, 1397); budgets in `evalAt` (277) and `intervalAt` (291).
- **States:** `phase` in `setup | refine | classify | band`, plus `suspended` (budget for this call spent) and `done`. A suspended run is serialised as a `FunctionResume` token: samples, the three span lists, markers, ink, counters, flags, phase, pieces, breaks, coarse grid and configuration.

| State | Holds |
|---|---|
| `setup` | Coarse grid `coarseXs`, `coarseDone` evaluated so far; each new coarse point pushes one pending span |
| `refine` | `pending` spans being split by the screen tests |
| `classify` | `suspicious` spans getting verdicts; verdicts may push back to `pending` |
| `band` | Exact mode only: one pending span per device-pixel column, one enclosure each |
| `suspended` | Any of the above with the budget spent; output empty, `resume` present |
| `done` | Paths, markers, ink and stats; no `resume` |

- **Invariants:**
  1. `stats.complete` is false exactly when `resume` is present, and then output is empty.
  2. The finished plot is the same however the work was sliced (functions-calculus 9, "Budgets").
  3. A suspension leaves `pending`, `suspicious`, `accepted`, markers, ink and the flags as they were before the interrupted step; a classify verdict is atomic (rolled back and redone whole).
  4. Every call with a positive budget makes progress.
  5. All samples in a run belong to one `(function version, view, pixel size)`.
  6. `band` is entered only with an enclosure; `complete: true` means every phase drained.
  7. A resumed run has the same limits as a fresh one.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| (start) | `plotFunction` | inputs valid | `setup` | pieces, coarse grid; seed samples loaded into `samples` |
| `setup` | coarse grid evaluated | | `refine` | batch form first when it fits the budget |
| `refine` | `pending` empty | `suspicious` empty | `done` (or `band`) | |
| `refine` | `pending` empty | `suspicious` not empty | `classify` | |
| `refine` | `samples.size >= maxSamples` | | `classify` or `done` | pending spans accepted as they are, `capped` |
| `classify` | verdict pushes to `pending` | `suspicious` drained | `refine` | |
| `classify` | `suspicious` empty, `pending` empty | | `done` (or `band`) | |
| `refine`/`classify` | `steps > STEP_CAP` | | same | `forceCap`: accept pending, drop suspicious, `capped`, `rigorous = false` |
| curve done | | `exact` and enclosure | `band` | ink cleared, one span per column |
| any | `evalAt`/`intervalAt` over budget | | `suspended` | classify rolls back the current verdict |
| `suspended` | `resumeFunctionPlot(token, fn, opts)` | token passes `checkToken` | token's phase | fresh per-call budget, totals carried |
| `done` | | | | chain spans, resolve breaks, thin to `maxSamples`, domain end markers, sort |

- **Reachable invalid states or transitions:**
  - A budget stop inside `refineUndefined` is not propagated: the loop spins to `STEP_CAP`, `forceCap` discards pending and suspicious spans, and the token carries the damage (breaks 2, 3). [PLOT-SM-4](../handoff/plot/findings.md), open.
  - A token has no function version; resuming with another function stitches two functions into one plot (breaks 5). [PLOT-SM-5](../handoff/plot/findings.md), open.
  - Interval evaluations are not cached, so a verdict costing more than one call's budget is rolled back forever (breaks 4). [PLOT-SM-8](../handoff/plot/findings.md), open.
  - `band` resumed without the enclosure returns `complete: true` with a partial band and the curve (breaks 1, 6). [PLOT-SM-9](../handoff/plot/findings.md), open.
  - `checkToken` does not check `depth`, `bendPx`, `chordPx`, `maxSamples`, `coarseXs` or `pieces` (breaks 7). [PLOT-SM-15](../handoff/plot/findings.md), open.
  - Seeds count against the cap (see P1). [PLOT-SM-6](../handoff/plot/findings.md), open.
  - Forked tokens (one token resumed twice) and interleaved runs of different functions stay independent and equal to the direct plot: checked, nothing found.

### P3. Function span lifecycle and verdicts

- **Where:** `function.ts` `runRefine` (362), `refineUndefined` (430), `classifyDefined` (588), `classifyUndefined` (748), `classifyEdge` (780), `classifyEdgeEnclosed` (818), `finishEdge` (867), `probeHole` (945), `findPartner` (959), `markJump` (572), `inkForSpan` (721), `resolveBreaks` (1126).
- **States:** each x-span `[xl, xr]` at a depth is in exactly one list.

| State | Meaning |
|---|---|
| `pending` | To be tested by the screen tests |
| `accepted` | Drawn as a chord |
| `suspicious` | Needs a verdict |
| dropped | A gap (undefined), or replaced by its halves, an ink column or a feature split |

- **Invariants:** a span is in one list at a time; a marker is recorded only for a verdict (pole, hole, jump, open or closed end) that the enclosure or the heuristics support; oscillation becomes ink, not markers; the cost of one verdict is a bounded number of evaluations and lookups.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `pending` | both ends defined, midpoint defined | fails bend or chord test, depth < limit, wider than 0.5 px | two `pending` halves | |
| `pending` | same | fails, at the depth limit or narrower than 0.5 px | `suspicious` | |
| `pending` | same | passes | `accepted` | |
| `pending` | one end or midpoint undefined | depth < limit | `pending` halves touching a defined end | |
| `pending` | same | at the depth limit | `suspicious` | |
| `suspicious` | both defined, values leave the view on both sides | enclosure unbounded, or both sides tall | two `accepted` sides | `pole` marker |
| `suspicious` | both defined, change in one place | enclosure bounded and `def = 2` | `accepted` | steep rise |
| `suspicious` | same | step flat on both sides | two `accepted` sides | `jump`, `openEnd`/`closedEnd` |
| `suspicious` | same | not flat, or two or more sign flips | dropped | ink column |
| `suspicious` | neither end defined | enclosure `def = 1` or a defined midpoint, wider than 0.1 px | two `suspicious` halves | |
| `suspicious` | one end defined | edge bisected; tall | `pending` approach | `pole` |
| `suspicious` | same | matching value across | `accepted` across | `hole` |
| `suspicious` | same | partner across with a different value | `pending` approach | `jump` and ends, or ink |
| chains at a break | `resolveBreaks` | limits and value agree / limits agree / tall / otherwise | merged / merged / cut / cut | none / `hole` / `pole` / `jump` and ends |

- **Reachable invalid states or transitions:**
  - `findPartner` (and `edgeFallbackY`) scan every sample per verdict, so cost per verdict grows with the sample count. [PLOT-SM-3](../handoff/plot/findings.md), open.
  - `sin(1/x)` without an enclosure still records about 1,000 `hole`/`openEnd`/`jump` markers. [PLOT-SM-14](../handoff/plot/findings.md), open.

### P4. Parametric tracer

- **Where:** `param.ts` `traceParamCurve` (583), `cullBoxes` (160), `findHoles` (198), `runRefine` (257), `runClassify` (355), `classifyEdge` (435), `joinPartner` (479), `markJoins` (702), `finishParam` (760).
- **States:** `cull -> holes -> coarse -> refine <-> classify -> done`, or `dead` (budget spent: `complete: false`, empty output). No suspend and resume. Spans use the same `pending`/`accepted`/`suspicious` lists as P3.

| State | Holds |
|---|---|
| `cull` | Parameter boxes from the enclosure; off-view and `def = 0` boxes dropped; boxes over 128 px split to depth 10 |
| `holes` | `def = 1` bounded boxes bisected to depth 40; up to 8 hole probes per box |
| `coarse` | `max(64, widthPx / 6)` samples spread over kept boxes |
| `refine`/`classify` | As P3, with a turning-angle test, cusp and stall markers, pole and hole-like verdicts |
| `dead` | Budget spent in any state |
| `done` | Chains, joins marked, thinned, clipped, closed flags |

- **Invariants:** the hole search costs a bounded share of the budget; an enclosure never makes a trace less likely to finish; markers carry drawable pixel coordinates; output points at most `maxSamples`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| (start) | valid input | enclosure | `cull` | else one box over the range |
| `cull` | boxes kept | enclosure | `holes` | |
| `holes`/`cull` | done | | `coarse` | |
| `coarse` | grid evaluated | | `refine` | |
| `refine` | pending empty | suspicious not empty | `classify` | |
| `classify` | pending refilled | | `refine` | |
| any | over budget | | `dead` | |
| `refine` | `samples.size >= maxSamples` | | `done` | pending accepted, `capped` |
| `refine`/`classify` | drained | | `done` | `end` markers unless the curve is closed |

- **Reachable invalid states or transitions:**
  - `findHoles` descends every `def = 1` box to depth 40, so a curve with many defined/undefined boundaries fails with a sound enclosure and succeeds without one. [PLOT-SM-11](../handoff/plot/findings.md), open.
  - `joinPartner` scans every sample per edge. [PLOT-SM-3](../handoff/plot/findings.md), open.
  - `addMarker` records any coordinates (pole markers at `py = ±7.1e19`). [PLOT-SM-16](../handoff/plot/findings.md), open.
  - Seeds count against the cap (see P1). [PLOT-SM-6](../handoff/plot/findings.md), open.

### P5. Implicit quadtree

- **Where:** `implicit.ts` `traceImplicit` (449), `runQuadtree` (385), `runDense` (370), `splitNode` (415), `boxAt` (110), `gEval` (84), `cornerAt` (100).
- **States:** per node of the leaf grid (padded view, 2 px leaves for `final`, 6 px for `draft`, roots of 32 px): `queued`, `dropped`, `split`, `leaf` (traced by P6). Per run: `running`, `dead` (budget spent: `complete: false`, empty), `done`. Without an enclosure the run is `dense`: every leaf is traced, `rigorous: false`.
- **Invariants:** a node is dropped only when its enclosure excludes the level or `def = 0`; every residual input is evaluated once (`memo`); memory per call is bounded by a figure-sized budget; the view limits count the device pixels actually sampled; the default budget completes an ordinary figure.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `queued` | `boxAt` | `def = 0`, or `lo > 0`, or `hi < 0` | `dropped` | |
| `queued` | `boxAt` | contains the level, wider than one leaf | `split` | 2 or 4 children queued |
| `queued` | `boxAt` | contains the level, one leaf | `leaf` | `emitLeaf` (P6) |
| `running` | over budget | | `dead` | |
| `dense` | every leaf visited | | `done` | |
| `running` | queue drained | | `done` | link, clip, thin, markers |

- **Reachable invalid states or transitions:**
  - `memo` and `corners` grow with string keys up to the evaluation cap; with `devicePixelRatio: 4` a view inside `checkView`'s limits held 1.9 GB; no leaf-cell limit as in `fillRegion`. [PLOT-SM-2](../handoff/plot/findings.md), open.
  - Without an enclosure, `sin(x) + sin(y) == sin(x*y)` on a 1,000 x 600 view returns `complete: false` at the default budget. [PLOT-SM-7](../handoff/plot/findings.md), open.

### P6. Implicit leaf classification and linking

- **Where:** `implicit.ts` `emitLeaf` (221), `correctCrossing` (130), `probeSmallFeature` (295), `uniqueMarkers` (506), `finishChains` (522); `squares.ts` `segmentsForCase` (37), `linkSegments` (202); `clip.ts` `clipPolyline`.
- **States:** per leaf, the marching-squares case (0 to 15). Per grid edge, one crossing (`crossings`, shared by both leaves). Per chain: `open` or `closed`; after clipping, a closed chain that was cut becomes open pieces; a closed chain under 0.25 px becomes an `isolated` marker.
- **Invariants:** neighbouring leaves use the same crossing on a shared edge; a Newton correction is kept only when it lowers `|F|`; chains are deterministic (sorted); work and output follow the curve length and the sample cap.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| leaf | corners | any NaN | skipped | |
| leaf | case 0 or 15 | enclosure | probed | 5 x 5 subgrid and Newton; `isolated` marker when found |
| leaf | case 0 or 15 | a corner exactly on the level, all 8 neighbours on one side | marked | `isolated` |
| leaf | case 5 or 10 | | segments | centre value decides the pairing |
| leaf | other cases | | segments | crossings interpolated and corrected; `singular` when the gradient vanishes |
| segments | `linkSegments` | shared keys | chains | `closed` when the ends share a key |
| chains | `finishChains` | | paths | clip to view, open chains from the smaller end, sort, thin |

- **Reachable invalid states or transitions:**
  - `uniqueMarkers` is quadratic and markers are uncapped: `x - x == 0` with an exact enclosure on a 400 px view gives 53,824 markers in 64 s. [PLOT-SM-1](../handoff/plot/findings.md), open.
  - `linkSegments` stayed linear for long chains: checked, nothing found.

### P7. Region filler

- **Where:** `region.ts` `fillRegion` (549), `runFill` (117), `runDense` (162), `fillCoarse` (212), `checkCap` (218), `boundaryLeaf` (228), `supersample` (312), `addMarker` (378), `mergeRects` (387), `traceBorder` (441), `segmentOnBoundary` (498).
- **States:** per node: `queued`, `false` (skipped), `true` (filled in the leaf bitmap), `split`, boundary `leaf` (polygon or supersampled). Per run: `running`, `capped` (remaining nodes filled coarsely), `dead`, `borders` (one implicit trace per primitive, sharing the budget), `done`. Without an enclosure the run is `dense`: every leaf corner tested once.
- **Invariants:** a `true` cell is wholly inside, a `false` cell wholly outside; emitted points are at most `maxSamples`; `capped` is set exactly when output was limited; a capped fill never claims area the predicate does not hold; work follows the boundary length; the default budget completes an ordinary figure.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `queued` | enclosure | `false` | skipped | |
| `queued` | enclosure | `true` | filled | bitmap cells set |
| `queued` | enclosure | `maybe`, wider than one leaf | `split` | |
| `queued` | enclosure | `maybe`, one leaf | boundary leaf | polygon if exactly one primitive crosses and the case is not a saddle; else 4 x 4 supersample |
| `running` | `points > maxSamples` | enclosure path only | `capped` | |
| `capped` | next node | not `false` | filled | whole node filled |
| `dense` | 4 true corners / 0 / mixed | | filled / skipped / boundary leaf | |
| supersample | 16 covered | not a corner leaf | filled | joins the bitmap |
| supersample | 1 or 2 covered | | rects | `isolated` marker |
| fill done | | margins given | `borders` | `traceImplicit` per margin, segments kept where a point just inside satisfies the body |
| `borders` | done | | `done` | merge rows into rectangles, polygons to pixels |
| any | over budget or a border trace incomplete | | `dead` | |

- **Reachable invalid states or transitions:**
  - `addMarker` scans every marker per insert; touching checkerboard cells produce 18,321 `isolated` markers and 5.4 s at 500 x 400 px. [PLOT-SM-1](../handoff/plot/findings.md), open.
  - `points` counts covered sub-cells, the dense path never checks the cap, and a tripped cap fills every non-`false` node (a checkerboard becomes one rectangle). [PLOT-SM-12](../handoff/plot/findings.md), open.
  - Without an enclosure, a half-plane on a 1,000 x 600 view returns `complete: false` at the default budget. [PLOT-SM-7](../handoff/plot/findings.md), open.
  - Borders with an enclosure cost about 4 times the fill (half-plane 5.7 ms against 0.3 ms). [PLOT-SM-13](../handoff/plot/findings.md), open.

### P8. One-variable predicate filler

- **Where:** `region.ts` `fillPredicate1D` (658 to 816).
- **States:** a stack of x-spans; each popped span becomes `true` (in `spans`), `false` (in `falses`) or splits; sub-half-pixel `maybe` spans are decided by one centre test. Then true spans merge, and each edge that abuts a false span is bisected to 0.1 px. Run: `running`, `dead`, `done`.
- **Invariants:** spans tile the view; every true edge inside the view abuts a false span; the budget bounds the work.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| span | three-valued state | `true` / `false` | `spans` / `falses` | |
| span | `maybe` | wider than 0.5 px and splittable | two spans | |
| span | `maybe` | narrower than 0.5 px | `spans` or `falses` | one centre test |
| merged span | edge | abutting false span | sharpened edge | bisection to 0.1 px |
| any | over budget | | `dead` | empty output |

- **Reachable invalid states or transitions:** none found. `falses.find` per merged span is linear per lookup; 200 to 625 bands stayed fast.


## symbolic

Checked at commit `3266a74` on `feat/symbolic` (pass 1, pipeline step 4). Paths are under `packages/symbolic/src/`; line numbers refer to `3266a74`. Findings are in `handoff/symbolic/findings.md` (SYM-SM-1 to SYM-SM-27, all open). Every reachable invalid state below was reproduced through the public entry (`src/index.ts`: `run`, `parseExpression`, `parseCondition`, `toText`, `toLatex`, `handleWorkerRequest`, `arena`, `clearCache`).

### S1. `run`: one call from arguments to a cell

- **Where:** `run.ts` `run` (lines 318 to 384), `runInner` (lines 386 to 470), `cacheKey`/`argKey` (lines 88 to 108), `cacheGet`/`cachePut` (lines 110 to 130), `runSteps` (lines 533 to 572); `ops.ts` `OPS` (line 2108).
- **States:**

| State | Holds |
|---|---|
| `validate` | positional and named arguments split; named names checked against the command's forms |
| `resolve` | `ref` nodes replaced by live values (`ctx.resolveRef`) |
| `plan` | heavy op with a clock read refused (`time_dependent_input`) |
| `keyed` | cache key built from engine version, op, argument keys, domains and facts |
| `fast-lane` | heavy op with `opts.fastLaneMs`: cache hit or `pending` |
| `cached` | cache hit (not when `opts.steps`) |
| `computing` | `OPS[op]` running under a fresh `Budget` and a `note` closure |
| `done` | cell (defined or undefined) and notices; cell put in the cache unless `steps` or `pending` |
| `failed` | an exception mapped by `run`'s `catch`: `OpError` to an error object; `Unsupported`, `NonElementary`, `LimitExceeded`, `BudgetExceeded` to undefined cells; `ParseFailure` to `syntax`/`limit`; anything else to `internal` |

- **Invariants:** `run` never throws; the cache key covers every input that can change the output (arguments with their `exact`, `excluded` and `display` fields, assumptions, limits, engine version) and two different inputs never share a key; a budget stop never becomes a defined cell; `pending` is never cached; the same call gives the same cell whatever ran before (design 5.12, 5.13, acceptance 9); `op` names only an entry of the command table.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `validate` | named argument | name not in any form (op is not `Steps`) | `failed` | `bad_option` |
| `validate` | done | | `resolve` | |
| `resolve` | done | heavy op and an argument tree holds `t` | `failed` | `time_dependent_input` |
| `resolve` | done | otherwise | `keyed` | |
| `keyed` | | heavy and `fastLaneMs` set | `fast-lane` | |
| `fast-lane` | cache lookup | hit | `done` | LRU touch |
| `fast-lane` | cache lookup | miss | `done` (pending) | no computation at all, even for trivial input |
| `keyed` | cache lookup | not `steps`, hit | `cached` → `done` | |
| `keyed` | | op is `Steps` | `runSteps` | parses the call text, re-enters `run` with `{ steps: true }` and `ctx` only (`opts.limits` dropped) |
| `keyed` | | otherwise | `computing` | `new Budget(limits, fastLaneMs)` |
| `computing` | op returns | | `done` | `cachePut` unless `steps` |
| `computing` | `BudgetExceeded('ms')` | `fastLaneMs` set | `done` (pending) | not cached |
| `computing` | any exception | | `failed` | not cached |

- **Reachable invalid states or transitions:**
  - Two inputs share a key: `argKey` keys a Cond by `condText`, which prints `and`/`or`/`not` without brackets, and keys an Expr by node id only (no `excluded`, no `display`); `limits` are not in the key at all. `Assume((a < 0 or b > 0) and a > 0, sqrt(a^2))` is `a`; after it, `Assume(a < 0 or (b > 0 and a > 0), sqrt(a^2))` returns the cached `a` (fresh: `abs(a)`). An `Equivalent` whose first argument carries `excluded` leaves a `differ_at` notice in the cache for the same call without `excluded`. A `Simplify` run with a small `maxSteps` caches the unsimplified input, and the default call then gets it. SYM-SM-9 (open).
  - `OPS[call.op]` in `runSteps` reads `Object.prototype`: `Steps("constructor(x)")`, `Steps("toString(x)")` and `Steps("valueOf()")` call those functions as ops, reach `computing` with no cell, put `{ cell: undefined }` in the cache and end in `internal`. SYM-SM-5 (open).
  - `runSteps` parses untrusted text (and `Expr` with a text argument parses it) before any `Budget` exists, so S9's exponential parse is not in any state of this machine. SYM-SM-1 (open).
  - The heavy fast lane never computes, so a heavy cell can never update in the same frame after a fast finish (design 5.13); with the worker in another realm its results never reach this cache (S7). SYM-SM-26 (open).

### S2. Budget

- **Where:** `run.ts` `Budget` (lines 52 to 72), `BudgetExceeded` (lines 32 to 41); `poly.ts` `Ticker`, `NO_TICK` (line 16); every `tick.tick(n)` call; `contracts.ts` `DEFAULT_LIMITS` (lines 207 to 218).
- **States:** `counting` (steps ≤ `maxSteps`, wall time not yet checked or under `maxMs`); `exceeded-steps` (sticky: every later `tick` throws again); `exceeded-ms` (thrown once, then re-armed: the next 1,023 ticks pass before the next check).
- **Invariants:** every loop whose length depends on the input ticks, or is bounded by a documented size limit checked before it starts; a `BudgetExceeded` always reaches `run` (S1 `failed`) and becomes `timeout` or `limit`; `maxNodes` (200,000) and `maxDigits` (100,000) are enforced; the number of steps and the result do not depend on the wall clock.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `counting` | `tick(n)` | steps + n > `maxSteps` | `exceeded-steps` | throw `BudgetExceeded('steps')` |
| `counting` | `tick(n)` | 1,024 ticks since the last check and elapsed > `maxMs` | `exceeded-ms` | throw `BudgetExceeded('ms')` |
| `exceeded-ms` | 1,024 more ticks | still over | `exceeded-ms` | throw again |
| any | code path with `NO_TICK` or no ticker | | unchanged | no bound |

- **Reachable invalid states or transitions:**
  - Never-ticking paths: the `rootof` branch of the parser (`parse.ts` line 516, `upolyIsolate(p)` with `NO_TICK`; `Expr("rootof((x+1)^1000 - 2, 1)")` takes 215 s with `fastLaneMs: 2`), trial division in `roots.pull` and `roots.exact` (`rules.ts` lines 139, 367), all whole-number ops (`num.ts` `isPrimeBig`, `nextPrimeBig`, `divisorsFromFactors`, `primeFactorsBig` with its own 2,000,000-step budget, `binomialBig`). SYM-SM-2, SYM-SM-4 (open).
  - `maxNodes` and `maxDigits` are never read: `Budget` never throws `'nodes'` or `'digits'`; `intPowNumber` squares the base before its digit check (`node.ts` line 605); `roots.exact` raises to `whole` with no check (`rules.ts` line 382); `ratPow` in `treeToUPoly` and `intDivisors` have none. `Factor(x^2 - (10^1000)^99)` with `maxMs: 50` kills the process with an out-of-memory abort. SYM-SM-3 (open).
  - `Simplify` catches `BudgetExceeded` per candidate (S3), so a budget stop becomes a defined cell. SYM-SM-10 (open).

### S3. Rewrite engine and the Simplify search

- **Where:** `rules.ts` `runPasses` (lines 56 to 79), `SIMPLIFY_RULES` (line 390), `tryCandidate` (line 1392), `simplifyNode` (lines 1410 to 1452), `togetherNode` (line 507), `factorNode` (line 1145), `verifyFactor` (line 1201).
- **States:** `canonical` (input after the constructors); `passes` (bottom-up rule application, repeated while a rule fired, at most 10,000 rule tries in total); per round (at most 3): `candidates` (input, expansion, together with cancelled factors, factored, trig-reduced, log/power, radicals), `scored` (cost, then fewer `add` nodes, then printed text), `chosen`; `final-together` (cancel once more if not dearer); `done` with `excluded`.
- **Invariants:** each candidate is equal to the input wherever both are defined; `excluded` lists exactly the values a chosen cancellation removed; a candidate that fails is dropped, but a budget stop ends the whole call as `timeout` (design 5.13: a budget stop "becomes undefined `timeout`"); the result does not depend on wall time.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `canonical` | `runPasses(SIMPLIFY_RULES)` | | `candidates` | `note` per rule fired |
| `candidates` | build each | builder throws anything | candidate dropped | exception swallowed (`tryCandidate`) |
| `scored` | best is the current form | | `final-together` | |
| `scored` | best differs | round < 3 | `candidates` | `simplify.choose` noted; excluded of a together winner added |
| `final-together` | together result | has excluded and cost ≤ current + 1 | `done` | excluded added |

- **Reachable invalid states or transitions:** `tryCandidate` swallows `BudgetExceeded`, `LimitExceeded` and internal errors, so `Simplify((x^2 - 1)/(x - 1))` with `maxSteps: 40` is the defined value `(x^2 - 1)/(x - 1)` (not `timeout`), and with the `ms` budget the result depends on machine speed; S1 then caches it. SYM-SM-10 (open). `roots.pull` and `roots.exact` loop without ticking (S2). `factorNode` builds multivariate results whose content is a junk constant (`x^2 - y^2` → `-36 * (x/36 + y/36) * (y - x)`) and stops early on `x^12 - 1`. SYM-SM-17 (open).

### S4. Interning arena

- **Where:** `node.ts` `createArena`, `arena` (lines 154 to 187), `ZERO`/`ONE`/`MINUS_ONE`/`TWO`/`HALF` (lines 332 to 336), `keyOf` (line 122), the id-keyed memo maps (`mapNodes`, `freeSymbols`, `nodeCount`, `substituteList`).
- **States:** `live(n)` (a map from structural key to node; the next id is `n`); `cleared` (map empty, next id 1).
- **Invariants:** one object per structure in a realm, so `===` is structural equality; the module constants are members of the arena; node ids are unique for the life of every cache entry and memo that holds them; the arena is rebuilt from live nodes past 1,000,000 nodes (design 5.13).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `live(n)` | `intern(body)` | key present | `live(n)` | returns the existing node |
| `live(n)` | `intern(body)` | key absent | `live(n + 1)` | new node with id `n` |
| `live(n)` | `arena.clear()` | | `cleared` | constants and cached ids now point outside the arena |
| any | size passes 1,000,000 | | (no transition) | nothing is ever rebuilt |

- **Reachable invalid states or transitions:** after `arena.clear()`, `0` built by the parser is a different object from `ZERO`, so `Solve(x^2 - 4 == 0, x)` returns `[]`; ids restart at 1 while the run cache still holds entries keyed by old ids. The arena only grows: 3,000 calls of `Expand((x + i)^12)` with `clearCache()` between them leave 525,628 nodes and 169 MB of heap. SYM-SM-7 (open).

### S5. Assumptions

- **Where:** `assume.ts` (`assumptions`, `signOf`, `factSign`, `factSignBound`, `findContradiction`); `ops.ts` `opAssume` (lines 1723 to 1750); `run.ts` `makeAssumptions(ctx.domains, ctx.facts)` and the cache key (line 104).
- **States:** an immutable `Assumptions` value per call: `domains` (symbol to domain) and `facts` (conditions). `Assume(c, e)` makes a new value with `facts ∪ c` (split on top-level `and`) for the inner `simplifyNode` only.
- **Invariants:** no assumption outlives the call that made it; the cache key holds every domain and fact; a fact that contradicts another is `bad_assumption`; `factSignBound` drops the fact it is reading, so circular facts end.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| none | `run(op, args, opts, ctx)` | | `A0 = (ctx.domains, ctx.facts)` | part of the cache key (facts by `condText`) |
| `A0` | `Assume(c, e)` | a fact names no symbol | error | `bad_assumption` |
| `A0` | `Assume(c, e)` | a direct contradiction (`a > 0`, `a < 0`) | error | `bad_assumption` with `related` |
| `A0` | `Assume(c, e)` | otherwise | `A1 = A0 + facts(c)` | `simplifyNode(e)` under `A1`; `A1` dropped on return |

- **Reachable invalid states or transitions:** the store itself does not leak between calls (checked: no module state; the Assume facts live in a local value). The cache leaks them: facts and Cond arguments are keyed by bracket-free `condText`, so two different fact sets share a key (S1). SYM-SM-9 (open).

### S6. Steps recorder

- **Where:** `run.ts` `note` closure and `stage` (lines 437 to 441), `runSteps` (lines 533 to 572); `steps.ts` `TEACHING_RULES`, `PHRASES`, `stepsToText`, `parseCommandCall`.
- **States:** `off` (`opts.steps` not set: `note` only updates `stage` and forwards to `ctx.note`); `recording` (each `note` appends `{ rule, before, after, teaching }` to `logged`); `formatted` (teaching steps with a phrase, at most 12 lines; none gives one line and notice `no_steps`).
- **Invariants:** recording never reads or writes the cache; the inner command runs with the caller's budget and limits; a `Steps` call is a heavy op and never nests (`Steps(Steps(…))` is refused).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `off` | `run(op, …, { steps: true })` | | `recording` | cache read and write skipped |
| `recording` | rule fires | | `recording` | step appended; `stage` = `op: rule` |
| `recording` | op returns | | `formatted` | |
| `runSteps` | call text parsed | `OPS[op]` is undefined or op is `Steps` | error | `unknown_command` |
| `runSteps` | inner `run` | | `recording` | inner call gets `ctx` only, never `opts.limits` |

- **Reachable invalid states or transitions:** `OPS[op]` finds `Object.prototype` members (S1); the inner call drops `opts.limits`, so `Steps` always uses the default budget whatever the caller asked. SYM-SM-5, SYM-SM-4 (open). Step texts are built with `toText`, so they inherit S9's round-trip faults. SYM-SM-19 (open).

### S7. Worker protocol

- **Where:** `worker.ts` `WorkerRequest`, `WorkerResponse`, `handleWorkerRequest`, `WorkerHost` (lines 1 to 74).
- **States (host side, per request id):** `posted` → `running` (the worker's synchronous `run`) → `answered`. Worker side: one module instance with its own arena (S4), run cache (S1) and family counter (S8).
- **Invariants:** a job's arguments mean the same in the worker as on the main thread; an answer belongs to exactly one request id; a superseded job can be stopped or its answer recognised as stale; the worker's result is usable by the main thread's fast lane.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| none | `post(req)` | | `posted` | arguments cross by structured clone |
| `posted` | `handleWorkerRequest` | | `running` | `ctx` from `domains`/`facts`; no `resolveRef` (the `needRef` round trip named in the comment does not exist) |
| `running` | `run` returns | | `answered` | `{ id, result }` posted |
| `running` | host wants to cancel | | (no transition) | there is no cancel message; the job runs to its budget (1,000 ms) |

- **Reachable invalid states or transitions:** structured clone gives new objects that are not the worker arena's nodes, and in a real worker their ids name other nodes. In one process, `handleWorkerRequest(structuredClone({ id: 1, op: 'Solve', args: [x^2 - 1 == 0, x] }), run)` returns `[]`; the same call on the original objects returns `[x == -1, x == 1]`. SYM-SM-8 (open). No cancel, no stale-answer rule and no way to feed the main-thread cache. SYM-SM-26 (open).

### S8. Family parameter counter

- **Where:** `solve.ts` `trigParamNext` (line 882), `resetTrigParams`, uses at lines 817, 945, 988 and 2269.
- **States:** a module-wide integer `n`; each trig, complex-exponential or enumerated family takes `k{n}` and moves to `n + 1`.
- **Invariants:** a result does not depend on calls made before it (design 5.12, acceptance 9); the parameter is an integer symbol for the result (design 2.3).
- **Transitions:** `n` → `n + 1` on every family built, including families later dropped and calls that end `unsupported`; `resetTrigParams()` → 1.
- **Reachable invalid states or transitions:** `Solve(sin(x) == 1/2, x)` gives `k1`, then `Solve(tan(x) == 1, x)` gives `k2`, and after `clearCache()` the first call gives `k3`; `Steps` (which skips the cache) moves it on every call. The symbol carries no `integer` domain. SYM-SM-21 (open).

### S9. Text parser

- **Where:** `parse.ts` `lex` (lines 43 to 121), `Parser` (lines 123 to 455), `numNode`, `nameNode`, `callNode` (lines 460 to 532); printer counterpart `print.ts` `textOf`, `condText`.
- **States:** `cond-attempt` (`parseNot` at `(`, and `parseCondOrExpr` in `if` arguments: try a condition, on failure rewind `pos` and parse an expression); `expr` (sum, product with implicit multiplication after a number literal, unary, power, postfix degree, primary); `depth` (at most 500 nested primaries, then a `limit` failure).
- **Invariants:** every text `toText`/`condText` prints parses back to the same node (design 5.11, acceptance 1); parse time is linear in the text (each token read a bounded number of times); keywords `and`, `or`, `not`, `in` are never operands; a number literal is a finite number; `rootof(p, k)` names an existing real root.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `if` argument | `parseCondOrExpr` | | `cond-attempt` | the whole argument is parsed as a condition first |
| `cond-attempt` | no comparison follows | | rewind, `expr` | the argument is parsed a second time |
| `expr` | number literal then a name or `(` | | product | implicit multiplication, also for the names `and`, `or`, `in` |
| `lex` | digits and dots | | number token | `1.2.3` is one token, `Number` gives NaN |
| `callNode` | `rootof(p, k)` | `p` a polynomial in `x` | node | `upolyIsolate(p)` with no ticker; `k` not checked against the root count |

- **Reachable invalid states or transitions:** nested `if` arguments are parsed twice per level, so time doubles per level (16 levels 957 ms, 18 levels 3.8 s, through `run('Expr', [text])` with `fastLaneMs: 2`). SYM-SM-1 (open). `x > 0 and y < 1`, `x < 1 or x > 2` and the `cases` that `Solve(a*x == b, x)` prints (`a == 0 and -b == 0`) do not parse, because `0 and` is read as `0 * and`; `condText` drops the brackets of `and(or(…))` and `not(and(…))`; a float prints as a decimal that parses back as an exact rational (`0.5` → `1/2`), and NaN/Infinity print as names. SYM-SM-19 (open). `rootof(x^2 + 1, 1)` is accepted and `Numeric` gives `0`. SYM-SM-18 (open).

### S10. Solve dispatch for one equation

- **Where:** `solve.ts` `solveEquation` (lines 448 to 506), strategies `solveExact`, `solveRational`, `solveRadical`, `solveExpLog`, `solveTrig`, `solveAbs`, `solveBySubstitution`; `ops.ts` `solveOneCond` (lines 1054 to 1116); root isolation `poly.ts` `upolyIsolate`, `cauchyBound` (lines 531 to 591).
- **States:** `absent` (unknown not in `f`: all or none); `classify` (strategies in order; `Unsupported` moves to the next); `family` (an integer parameter, enumerated when both `from` and `to` are finite); `filter` (interval, domain restrictions, `verifyRoot`); `sorted`; for `and`: solve the first equation, then keep solutions that satisfy the other relations.
- **Invariants:** every solution satisfies the equation and every side condition; no real solution is missed; a case split lists only possible parameter values, and every value where the generic answer fails; "all" or "none" for a constant equation is decided exactly.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| start | `f` free of `v` | simplifies to 0 | all | |
| start | `f` free of `v` | numeric value | all if \|value\| < 1e-12, else none | float test |
| `classify` | a strategy returns | | `family` or `filter` | |
| `classify` | all throw `Unsupported` | | `unsupported` | `detail` names the forms |
| `and` | each solution of the equation | substituted difference is exactly 0 | kept | for every relation, including `<`, `>` and `!=` |
| `and` | otherwise | float value | kept if the relation holds within 1e-9 | |
| isolation | Cauchy bound | a coefficient above 1.8e308 | `BigInt(±Infinity)` | `RangeError` |

- **Reachable invalid states or transitions:** `Solve(x^2 == 4 and x < 2, x)` and `Solve(x^2 == 4 and x != 2, x)` keep `x == 2`. SYM-SM-13. `Solve(exp(-30) == 0, x)` is "all". SYM-SM-12. `Solve(x^2 == a, x)` has no `a >= 0` condition and lists the impossible cases `1 == 0 and …`. SYM-SM-16. `Solve(x^3 - x - 10^400 == 0, x)` is `[]` after 992 ms and `NSolve` of it is `internal`. SYM-SM-6. `Solve(ln(x) == 0, x)` is `unsupported` while `ln(x) == 1` solves. SYM-SM-24. All open.

## tiptap

Checked at commit `20d5770` on `feat/tiptap` (the one review round of PR #126). Paths are under `packages/tiptap/src/`; line numbers refer to `20d5770`. Findings are in `handoff/tiptap/findings.md` (TT-R1 to TT-R10; TT-R1 to TT-R5 and TT-R10 are fixed). JavaScript is single-threaded, so "concurrency" below means work interleaved across `await`s: a mount, a picture export or an AI stream, with scheduler orders, editor updates and other requests in between.

### T1. Figure node view lifecycle

- **Where:** `node-view.ts` `FigureNodeView`: `render` (197), `build` (338), `goLive` (346), `save` (370), `doMount` (378), `mountFailed` (493), `giveUp` (508), `doSave` (516), `unmountNow` (539), `modeChanged` (803), `revive` (834), `onContextLost` (885), `onContextRestored` (899), `destroy` (1004). Every mount, save and unmount runs on one promise chain (`queue`).
- **States:**

| State | Holds |
|---|---|
| `placeholder` | no app; the picture or the caption; `wantsMount` false |
| `bad` | attributes fail `checkAttrs`; no app; message and Edit lines; never mounts |
| `mounting` | `wantsMount` true, `app` undefined, `createApp` in flight |
| `live` | `app` and `liveHost` set; counted against `liveLimit` |
| `saving` | `wantsMount` false, `app` set, `pictureOf` in flight; `saved` holds the reader's script |
| `saved` | no app; `saved` holds `{script, readerScript}`; the picture shows |
| `failed` | `failures` 1; retried only by a live order after `lastFailSeq` |
| `dead` | `failures` 2; left the scheduler; revived by a script or mode change |
| `context-lost` | `live` with `contextLost`; the picture shows until the context comes back |
| `destroyed` | terminal; app freed, scheduler key and store entry dropped |

- **Invariants:** at most `liveLimit` views hold `wantsMount` (R2.2); a view holds at most one app; a `bad` view holds no app; the reader's state comes back only when the script is unchanged, otherwise `restore_failed`; a view that is `destroyed` takes no order and keeps no app.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `placeholder` | `build` | good attrs, `hasRoom` | `mounting` | |
| `placeholder`, `saved` | `goLive`, `restore` | good attrs | `mounting` | `makeRoom` saves the least recently used non-live view |
| `mounting` | `createApp` resolves | still wanted, same mode | `live` | `loadInto` (saved reader script or the script), store `setLive` |
| `mounting` | `createApp` resolves | mode changed | `mounting` | app freed, mount again |
| `mounting` | `createApp` throws | | `failed` or `dead` | `mount_failed` |
| `live` | `save` | | `saving` | `saved` taken |
| `saving` | picture made | not wanted again | `saved` | unmount; picture written without an undo step |
| `saving` | `goLive` during the export | | `live` | `saved` dropped |
| `live` | attrs turn bad | | `bad` | unmount queued |
| `bad` | attrs good again | | `placeholder` | asks again for the mount the scheduler holds as `live` or `ready` (TT-R4, fixed) |
| `live` | mode change | not to or from 3D, `setMode` ok | `live` | |
| `live` | mode change | otherwise | `mounting` | unmount, mount again; keeps its place under the cap, and a `save` order that arrives first wins (TT-R5, fixed) |
| `live` | `webglcontextlost` | | `context-lost` | `context_lost` |
| `context-lost` | `webglcontextrestored` | | `mounting` | reader's state kept, mount again; same rule as a mode change (TT-R5, fixed) |
| `dead` | script or mode change | | `placeholder` | registered again |
| any | `destroy` | | `destroyed` | |

- **Reachable invalid states or transitions:** none known for TT-R4 and TT-R5 after the fixes (commit `21e9362`): a figure fixed after being `bad` mounts again in view, and a remount holds its slot under `liveLimit` and yields to a `save` order. A mode change that arrives while `createApp` is in flight mounts again in the new mode (TT-R9 was not a bug; a test now holds it). A remount that yields to a save, or a save during a mode change, made the old mode's picture (TT-R10, fixed: the picture is made from the script in the new mode).
- **Explicit since `feat/lint-rules`:** the lifecycle is one `StateMachine` over `FIGURE_MACHINE` in `node-view.ts` (states `idle`, `mounting`, `live`, `saving`, `lost`, `dead`, `destroyed`; events `claim`, `release`, `mounted`, `unmounted`, `lose`, `regain`, `giveUp`, `revive`, `destroy`). `wantsMount` is `mounting`, `live` or `lost`; the former flags `wantsMount`, `dead`, `destroyed` and `contextLost` are gone. `bad` stays a display state derived from the attributes. `test/spec/life.test.ts` walks every row of the table.

### T2. Script sync between the node, the live figure and the code panel

- **Where:** `node-view.ts` `commitScript`, `commitAttrs`, `update`, `scriptChanged` (791), `applyScript` (696); `code-panel.ts` `onInput` (217), `apply` (229), `outsideScript` (167).
- **States:** the node's `script`; `applied` (what the live figure shows); `ownCommit` (a script this view wrote and expects back); the panel's `pending` (typed, not committed), its 300 ms `timer`, and `kept` (the writer's lines after a clash).
- **Invariants:** the live figure shows the node's script once no commit is in flight; one commit is one transaction; an outside change never loses typed lines silently (they go to `kept` with `collab_conflict`).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| idle | typing | | `pending` | timer restarts at 300 ms |
| `pending` | timer or close | fits 64 KB | idle | lines checked, applied, `commitScript` in a microtask |
| idle | node update | equals `ownCommit` | idle | not applied again |
| idle | node update from outside | adds lines at the end | idle | only the new lines run |
| idle | node update from outside | other change | idle | `loadScript` of the whole script |
| `pending` | node update from outside | differs from `pending` | `kept` | `collab_conflict`, Re-apply or Discard |

- **Reachable invalid states or transitions:** the AI's commit is an `ownCommit`, so it never reaches `outsideScript`; lines typed during an AI stream are committed over the AI's lines with no clash (TT-R6, later).

### T3. AI request per figure

- **Where:** `ai.ts` `askIncantly`: the job map (178), `applyTo` (194), the superseded branch (243).
- **States:** none, `streaming` (controller in the map), `superseded` (aborted by a newer request), `done`, `stopped` (`ai_unavailable` or `ai_partial`).
- **Invariants:** at most one running request per figure; a request commits only its accepted lines, once; a replaced request leaves the figure and panel to the newer one; every streamed line runs on a figure holding all earlier accepted lines.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| none | `askIncantly` | good attrs | `streaming` | older request aborted, `beginAi`, panel opens |
| `streaming` | lines | fits 64 KB | `streaming` | lines run in the live figure, or a headless app of base plus accepted lines when not live |
| `streaming` | `done` | | `done` | one commit of `base` plus accepted lines |
| `streaming` | error, or end without `done` | | `stopped` | accepted lines committed, `ai_partial` or `ai_unavailable` |
| `streaming` | newer request | | `superseded` | `resetToNode` only when no newer request runs on the figure (TT-R2, fixed) |

- **Reachable invalid states or transitions:** none known for TT-R2 and TT-R3 after the fixes (commit `733cda0`): a superseded request leaves the figure and panel to the newer request, and the headless fallback starts from the base script plus the accepted lines.

### T4. Editor scheduler

- **Where:** `scheduler.ts` `EditorScheduler`: `register`, `unregister`, `hasRoom` (67), `makeRoom` (75), `route`, `measure`.
- **States:** a view is unregistered or registered; the host's record is `idle`, `ready`, `live`, `paused` or `saved` (view section V1); the cap counts views with `wantsMount`.
- **Invariants:** an order goes only to a registered view; one view's failed order never stops the others; `mountedCount() <= liveLimit`.
- **Transitions:** as in V1, routed one to one (`build`, `goLive`, `pause`, `save`, `restore`). Without `IntersectionObserver`, `measure` sets visible and near from the boxes on scroll (50 ms later) and resize.
- **Reachable invalid states or transitions:** the cap is only kept by the views themselves; T1's remount paths pass it (TT-R5).

## board

Written before the code of round 1 (branch `feat/board`, `packages/board/src/core/`). Round 2 appends B5 to B18 (below), round 3 B19 to B24 (select tool, shape tools, text editor, snap, recognise hold, image decode) and B25 (gesture, added by the round 3 fixes); round 4 appends B26 to B30 (figure card, card input, camera motion for cards, menus, key map), round 5 appends B31 to B35 (agent runner, agent job, circle to ask, hand animation, agent panel). Every machine is a `*_MACHINE` table over `StateMachine` from `@incantly/kernel`; the lint rules `incantly/state-*` are errors in `packages/board`. A machine is made with its third argument, `onRefused` (`incantly/state-refusal-reported`): a move the table refuses is reported to the board's `onError` as `internal`, with `detail.machine`, `detail.state` and `detail.event` (`refusedMove` in `core/errors.ts`); a call that may come in any state asks first (`sendIfAble` in `core/machine.ts`), so a report always means a bug. Data that is not a state (a counter, a timestamp, a stack) sits next to the machine and is named in the invariants.

Three machines and one derived state in round 1: the store transaction (B1), the history (B2), the page count (B3, derived: it has no table) and the steady zoom (B4). B1 has a second small table for the handle a transaction hands to its callback. A table whose rows are all the same refuses nothing and is not a machine; `incantly/state-table-refuses` makes it an error, so a state that any count or event may reach is derived from the data each time it is read.

### B1. Store transaction

- **Where:** `core/store.ts` `Store.change`, `TX_MACHINE`, `HANDLE_MACHINE` (the `Tx` handle).
- **States:** the store is `idle` (nothing running), `open` (the callback of `change` is writing; writes are staged, not applied), `notifying` (a committed diff is being delivered to listeners) or `nested` (a listener called `change` while notifying, and its callback is running). A `Tx` handle is `live` (its callback is running) or `closed` (the callback returned; any later call returns `bad_argument`).

| State | Holds |
|---|---|
| `idle` | the committed records only; no staged writes |
| `open` | the staged writes of one transaction (a map of id to record or removal); the records are unchanged |
| `notifying` | a queue of committed diffs; the owner (the `change` that began from `idle`) delivers them in order |
| `nested` | the staged writes of a listener's transaction; the owner's queue waits |

- **Invariants:** the records change only in `commit`, in one step, after every check passed; a transaction that fails any check or limit applies nothing and sends no diff; one commit sends one diff, with its origin, and listeners see the records already in their new state; no two transactions are `open` or `nested` together (a `change` inside a callback is refused with `bad_argument`); diffs reach every listener in commit order; a throwing callback or listener is caught (a callback aborts its transaction; a listener's error goes to `onError`); a diff has each id once, with its net effect (add then remove of one id is nothing, two updates are one).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `begin` | origin is one of `user`, `model`, `host`, `remote` | `open` | handle `live`, empty staging |
| `open` | `commit` | every record checks, integrity and limits hold | `notifying` | records applied, diff queued, handle `closed` |
| `open` | `abort` | a check, integrity or limit failed, or the callback threw | `idle` | staging dropped, handle `closed`, the error is the result |
| `notifying` | `drained` | queue empty | `idle` | |
| `notifying` | `begin` | | `nested` | handle `live`; the owner keeps delivering after it |
| `nested` | `commit` | as for `open` | `notifying` | records applied, diff queued |
| `nested` | `abort` | | `notifying` | staging dropped |
| `live` (handle) | `close` | | `closed` | |

- **Reachable invalid states or transitions:** none known. `begin` in `open` or `nested` has no row, so a nested `change` is refused. A listener that writes on every diff without end would never reach `idle`; the host's listener must stop (no guard in the store).

### B2. History

- **Where:** `core/history.ts` `History`, `HISTORY_MACHINE`.
- **States:** `recording` (the history listens to the store and records steps), `undoing` and `redoing` (the history is writing a step back through the store).
- **Invariants:** a transaction with `history: false` is not a step; a replayed step is not recorded again; any recorded step empties the redo stack; a step with the `mergeKey` of the step on top of the undo stack joins it (the stroke's samples, a drag's moves) and keeps its first `before` and its last `after` per record, and a record that ends a merged step with the same values it began with (a cancelled gesture put it back) is no part of the step, so a step with no record left is dropped; `seal()`, `undo` and `redo` end merging; one `undo` or `redo` is one store transaction, so listeners see one diff; a refused replay leaves both stacks as they were; the undo stack holds at most `maxSteps` steps.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `recording` | `undo` | undo stack not empty | `undoing` | the top step's `before` values are written in one transaction, `history: false` |
| `recording` | `redo` | redo stack not empty | `redoing` | the step's `after` values are written in one transaction, `history: false` |
| `undoing` | `done` | the write succeeded | `recording` | the step moves to the redo stack |
| `undoing` | `done` | the write was refused | `recording` | stacks unchanged, the error is returned |
| `redoing` | `done` | as for `undoing` | `recording` | the step moves to the undo stack |

- **Reachable invalid states or transitions:** `undo` or `redo` called from a listener while a replay runs has no row and is refused with `bad_argument`. An empty stack is `nothing_to_undo`, returned before the machine moves. A change made with `history: false` to a record that a step holds is not part of that step, so undo writes the older value back (the camera, selection and pictures are not in steps, so this does not happen for them).

### B3. Page count (derived, no table)

- **Where:** `core/pages.ts` `Pages.state`.
- **States:** `empty` (no page), `single` (one page), `several` (2 up to the limit minus one), `full` (the page limit, 100 by default). The state is **not stored**: `Pages.state` reads the number of page records and the limit each time, so the state and the count cannot disagree.
- **Why no table:** the first version had a table in which every state accepted every count (`to_empty`, `to_single`, `to_several`, `to_full` from every state). A table that refuses nothing guards nothing, and the field was a copy of the count. Any count can follow any count (an undo, a redo, a load or a command changes it by any step), so there is no move to refuse.
- **Derivation:** 0 pages is `empty`; 1 is `single`; a count at or above the limit (and above 1) is `full`; any other count is `several`.
- **Invariants:** the state always matches the number of page records; `removePage` is refused with `last_page` in `single`; `addPage` and `duplicatePage` are refused with `limit` in `full`; the current page is always a page that exists (or none in `empty`); every command except `goToPage` is one store transaction, so one undo step; a command that fails changes nothing; removing a page removes its shapes, its camera and the bindings of its shapes in the same transaction. A command reads the state before it writes (`last_page`, `limit`).
- **Reachable invalid states or transitions:** none known. A host that lowers `limits.pages` below the count of a loaded board gets `full`, and the load opens the board (a load does not test limits); the next add is refused.

### B4. Camera steady zoom

- **Where:** `core/camera.ts` `Camera`, `CAMERA_MACHINE`. One `Camera` per page.
- **States:** `steady` (the steady zoom equals the zoom) and `zooming` (the zoom changed less than 150 ms ago). Pan alone does not change the state.
- **Invariants:** `zoom` is always inside 0.05 to 20; `steadyZoom` changes only when `tick` settles; the camera never reads a clock: the time of the last zoom change and the time `tick` is given come from the input layer; a non-finite number is ignored and changes nothing.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `steady` | `zoom` | the clamped zoom differs from the zoom | `zooming` | the time of the change is kept |
| `zooming` | `zoom` | | `zooming` | the time of the change is kept |
| `zooming` | `settle` | `now - changedAt >= 150`, or `now` is before `changedAt` (the clock went back) | `steady` | `steadyZoom = zoom`; `tick` returns true |

- **Reachable invalid states or transitions:** none known. A zoom that is clamped to the same value is not a change, so the camera does not leave `steady` at the zoom limits.

### Round 2 (branch `feat/board-2`: ink, tools, painter)

Written before the code of round 2 (`core/input.ts`, `core/ink/`, `core/tools/`, `core/draw.ts`, `web/input.ts`, `web/painter.ts`, `web/board-view.ts`). Data that is not a state is named in each invariants line: counts, the last kept sample, the clock the input layer hands in, byte totals. Marks that do not depend on each other go in one named `readonly` record (`layers`, `frame`), never in loose booleans. Every table below refuses at least one move (`incantly/state-table-refuses`).

### B5. Pointer gate and palm rule

- **Where:** `core/input.ts` `PointerGate`, `GATE_MACHINE` and, for `touchDraws: 'always'`, `GATE_ALWAYS_MACHINE`; used by `web/input.ts`. The gate takes one of the two tables when it is made, from the option (BR-13); they differ in one row, `penNear` `touchDown`.
- **States:** `idle` (nothing happening), `penNear` (a pen hovers), `penDown` (a pen is writing), `mouseDown` (a mouse button is down), `touchDown` (one finger is drawing), `gesture` (two or more fingers pan and zoom).
- **Invariants:** a touch never draws while the state is `penNear` or `penDown`, nor within 600 ms (the grace, from the input clock) of the last pen sample, unless the host sets `touchDraws: 'always'`; then a touch draws in `penNear` and within the grace (the `penNear` `touchDown` row of `GATE_ALWAYS_MACHINE`), and while the pen is down (`penDown`, which has no `touchDown` row in either table) the touch stays a second pointer that is only counted; `touchDraws: 'never'` ignores every single touch; two touches always give `gesture` except while a pen is writing; a pen that goes down while a finger draws cancels that finger's stroke (`cancelThenDraw`) and wins; the number of touches down (`touches`) and the pointer that draws (`drawing`) are data next to the machine, and `touches` never goes below 0; a sample the machine refuses is `ignore`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `penHover` | | `penNear` | the pen time is kept |
| `idle` | `penDown` | | `penDown` | `draw` |
| `idle` | `mouseDown` | | `mouseDown` | `draw` |
| `idle` | `touchDown` | one touch, drawing allowed | `touchDown` | `draw` |
| `idle` | `secondTouch` | touches reach 2 | `gesture` | `gesture` |
| `penNear` | `penHover` | | `penNear` | |
| `penNear` | `penDown` | | `penDown` | `draw` |
| `penNear` | `penAway` | the pen left | `idle` | |
| `penNear` | `mouseDown` | | `mouseDown` | `draw` |
| `penNear` | `secondTouch` | touches reach 2 | `gesture` | `gesture` |
| `penNear` | `touchDown` | `touchDraws: 'always'` only (`GATE_ALWAYS_MACHINE`) | `touchDown` | `draw` |
| `penDown` | `penUp` | | `penNear` | `draw` (the `up` sample) |
| `penDown` | `penCancel` | | `idle` | `draw` (the `cancel` sample) |
| `mouseDown` | `mouseUp` | | `idle` | `draw` |
| `touchDown` | `touchUp` | | `idle` | `draw` |
| `touchDown` | `secondTouch` | touches reach 2 | `gesture` | the finger's stroke is cancelled |
| `touchDown` | `penHover`, `penDown` | | `penNear`, `penDown` | `cancelThenDraw` |
| `gesture` | `secondTouch` | a third finger | `gesture` | |
| `gesture` | `gestureEnd` | touches fall below 2 | `idle` | |

- **Reachable invalid states or transitions:** a touch in `penDown` has no row (in both tables), so it is ignored and only counted. In `penNear` a touch has no row unless `touchDraws` is `'always'`, and the default gate ignores it through the same refusal. `penAway` is the pen's `pointerleave`; a browser that never sends it leaves `penNear` until the next pen or mouse event, and the grace then runs from the last pen sample.

### B6. Pen pressure probe

- **Where:** `core/input.ts` `PressureProbe`, `PROBE_MACHINE`; one probe per pen.
- **States:** `unknown` (not enough samples), `flat` (every sample so far was exactly 0.5, so the pen has no sensor), `real` (a sample other than 0.5 was seen).
- **Invariants:** in `unknown` and `flat` a 0.5 is reported as `NaN`, so the sampler simulates pressure from speed; in `real` every value is reported as it is; `flat` is decided after 8 samples that are all 0.5 (`flatSeen`, data); a value other than 0.5 moves `unknown` and `flat` to `real`; `real` is final, as a sensor does not go away.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `unknown` | `varied` | pressure is above 0 and not 0.5 | `real` | |
| `unknown` | `flat` | the 8th sample of exactly 0.5 | `flat` | |
| `flat` | `varied` | | `real` | |

- **Reachable invalid states or transitions:** none known. `real` has no move; a probe never goes back.

### B7. Live stroke (pen and highlighter tools)

- **Where:** `core/ink/live.ts` `LiveStroke`, `LIVE_MACHINE`. The pen and the highlighter are one tool over two presets, so their tool state is the live stroke's state.
- **States:** `idle` (no stroke), `drawing` (samples are being added to the stroke's own buffer, outside the store).
- **Invariants:** the page the stroke is drawn on (`page`, a nullable field) is data of the `drawing` state: it is set by `begin` and cleared by `end` (also when the store refuses the write) and by `cancel`, so `page` is `null` whenever the state is `idle` (BR-17, checked by `incantly/state-no-shadow-null`); the outline is extended each frame from the last settled point and equals a full build of the points (BR-16); BR-10: the buffer is never a stored record's array; the store gets a fresh record at `end` (`board.change('user', put)`, one undo step, merge key none) and the live buffer is cleared at once; nothing is written to the store while `drawing`; a sample closer than 0.5 screen pixels to the last kept one is dropped unless pressure changed by more than 0.05; a stroke with no kept sample is not stored; a refused commit (`limit`) keeps the board as it was and leaves the machine `idle`; predicted samples are never added.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `begin` | a pen, mouse or drawing touch went down | `drawing` | buffer cleared, first sample added |
| `drawing` | `sample` | | `drawing` | filter, simulated pressure, push |
| `drawing` | `end` | the up sample | `idle` | one `ink` record put, buffer cleared |
| `drawing` | `cancel` | cancel, or a second finger, or the page changed | `idle` | buffer cleared, nothing stored |

- **Reachable invalid states or transitions:** `sample` and `end` in `idle` have no row (a stray `move` is ignored); `begin` in `drawing` has no row (a second pointer is ignored by the gate and the tool).

### B8. Eraser tool

- **Where:** `core/tools/eraser.ts` `EraserTool`, `ERASER_MACHINE`.
- **States:** `idle`, `erasing` (the pointer is down; every move erases along the segment from the last point).
- **Invariants:** a drag is one undo step (the writes go through one gesture, B25, and `seal()` ends them); a cancel puts back every stroke the drag erased or cut, and leaves no undo step; the whole mode removes every stroke whose outline meets the eraser's circle; the partial mode cuts a stroke at each of its segments that meets the circle and keeps the runs of 2 or more points as new strokes; locked shapes are never erased; the pen's eraser end picks this tool through B12 for as long as it is used.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `down` | | `erasing` | erase at the point |
| `erasing` | `move` | | `erasing` | erase along the segment |
| `erasing` | `up` | | `idle` | history sealed |
| `erasing` | `cancel` | | `idle` | the gesture is cancelled (what was erased comes back), history sealed |

- **Reachable invalid states or transitions:** `move` and `up` in `idle` have no row. A refused write (a `limit` on the pieces of a cut stroke) leaves the stroke as it was.

### B9. Laser tool

- **Where:** `core/tools/laser.ts` `LaserTool`, `LASER_MACHINE`.
- **States:** `idle`, `pointing` (the pointer is down and the trail grows), `fading` (the pointer is up and the trail dies out).
- **Invariants:** nothing is stored; the trail holds at most 256 points and a point older than 1,200 ms is dropped; the trail has no clock of its own, `now` comes from the samples and from `tick(now)`; `tick` ends `fading` when the trail is empty; a new `down` in `fading` keeps the old points while they fade.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `down` | | `pointing` | first point |
| `pointing` | `move` | | `pointing` | point added |
| `pointing` | `up` | | `fading` | |
| `pointing` | `cancel` | | `fading` | |
| `fading` | `down` | | `pointing` | first point |
| `fading` | `faded` | the trail is empty | `idle` | |

- **Reachable invalid states or transitions:** `up` and `faded` in `idle` have no row; `faded` in `pointing` has no row, so a held pointer keeps its trail.

### B10. Lasso tool

- **Where:** `core/tools/lasso.ts` `LassoTool`, `LASSO_MACHINE`.
- **States:** `idle`, `drawing` (the loop is open).
- **Invariants:** the loop is a polygon of page points, closed on `up`; selected are the strokes with more than half of their points inside, and later shapes whose centre is inside; locked shapes are not selected; the selection is not in the store and is not an undo step; a loop of fewer than 3 points selects nothing and clears the selection; the loop is drawn on the overlay only.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `down` | | `drawing` | loop starts |
| `drawing` | `move` | | `drawing` | point added (0.5 px filter) |
| `drawing` | `up` | | `idle` | selection set from the loop |
| `drawing` | `cancel` | | `idle` | loop dropped, selection kept |

- **Reachable invalid states or transitions:** `move` and `up` in `idle` have no row.

### B11. Hand tool (pan)

- **Where:** `core/tools/hand.ts` `HandTool`, `HAND_MACHINE`.
- **States:** `idle`, `panning`.
- **Invariants:** a drag moves the camera by the pointer's screen delta (`Camera.panBy`); the camera never leaves finite numbers; the wheel, the pinch and the two-finger pan move the camera without this machine (they are single events, with no state between them).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `down` | | `panning` | last point kept |
| `panning` | `move` | | `panning` | `panBy` |
| `panning` | `up` | | `idle` | |
| `panning` | `cancel` | | `idle` | |

- **Reachable invalid states or transitions:** `move` and `up` in `idle` have no row.

### B12. Tool host (which tool is in force)

- **Where:** `core/tools/host.ts` `ToolHost`, `TOOLS_MACHINE`. The chosen tool (`current`) is data; the machine says whether it is the chosen tool or a temporary one that answers input.
- **States:** `chosen` (the chosen tool answers), `eraserEnd` (a pen's eraser end is down: the eraser answers), `handHeld` (Space is held, or the middle button is down: the hand answers), `askHeld` (the pen's barrel button is down: the Ask tool answers, round 5).
- **Invariants:** a tool is switched only while no pointer is down (`setTool` while a stroke is in progress cancels it first); the pen's eraser end (button bit 32) enters `eraserEnd` on its `down` and leaves on `up`, then the chosen tool answers again; a held Space or a middle button gives the hand; one temporary tool at a time (`eraserEnd` and `handHeld` do not nest); an unknown tool id is refused with `tool_unknown`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `chosen` | `eraserDown` | the sample has the eraser bit | `eraserEnd` | the chosen tool is cancelled |
| `chosen` | `handDown` | Space is held, or the middle button is down | `handHeld` | the chosen tool is cancelled |
| `eraserEnd` | `eraserUp` | | `chosen` | |
| `handHeld` | `handUp` | | `chosen` | |
| `chosen` | `askDown` | the sample has the barrel bit and the Ask tool is in the list | `askHeld` | the chosen tool is cancelled |
| `askHeld` | `askUp` | | `chosen` | |

- **Reachable invalid states or transitions:** `handDown` in `eraserEnd` and `eraserDown` in `handHeld` have no row, so a second temporary tool does not start while one is in force; the same for `askDown` in `eraserEnd` and `handHeld`.

### B13. Page bar

- **Where:** `web/board-view.ts` `PageBar`, `PAGEBAR_MACHINE`.
- **States:** `closed` (only the current page's name shows), `open` (the list of pages shows).
- **Invariants:** a page is chosen by a click on its entry (`goToPage`, not an undo step); the add button is `addPage` (one undo step) and is refused with `limit` at 100 pages; the list closes when a page is chosen or on `Escape`; the bar reads the page list from `Pages` each time it opens, and never keeps its own copy of the page count.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `closed` | `open` | | `open` | list built |
| `open` | `close` | choice, `Escape` or outside click | `closed` | list removed |

- **Reachable invalid states or transitions:** `open` in `open` and `close` in `closed` have no row.

### B14. Tile and tile cache

- **Where:** `core/draw.ts` `Tile`, `TILE_MACHINE`, `TileCache`. The tile's GPU or canvas handle is held by `web/painter.ts`; the cache only keeps the key, the byte size and the order of use.
- **States of one tile:** `blank` (made, nothing drawn), `fresh` (drawn and up to date), `stale` (drawn, but a shape that touches it changed), `gone` (evicted; the object is dropped from the cache).
- **Invariants:** a tile's key is its zoom step `k` (the tile is drawn at 2^k device pixels per page unit), its column `tx` and its row `ty`; it covers 512 device pixels; a changed shape marks every tile of every step whose box meets the shape's old or new bounds `stale`, and no other; `blank` is never marked; the least recently used tiles are evicted when the bytes held pass the cap (64 MB; 24 MB on a device with 4 GB or less), never one the current frame uses; a lost GPU context sends every tile to `blank` (its handle is dead); `gone` takes no event.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `blank` | `draw` | the painter drew it | `fresh` | bytes counted |
| `fresh` | `dirty` | a shape that touches it changed | `stale` | |
| `stale` | `dirty` | | `stale` | |
| `stale` | `draw` | the painter drew it again | `fresh` | |
| `fresh`, `stale` | `lose` | the context was lost | `blank` | bytes released |
| `blank`, `fresh`, `stale` | `evict` | over the cap, least recently used | `gone` | handle released |

- **Reachable invalid states or transitions:** `dirty` in `blank` and `draw` in `fresh` have no row (a fresh tile is not drawn again); every event in `gone` has no row.

### B15. Painter back-end

- **Where:** `web/painter.ts` `WebPainter`, `BACKEND_MACHINE`.
- **States:** `gl` (the view package's WebGL 2 back-end draws the tiles), `lost` (the context was lost; the last picture stays and nothing is drawn), `canvas2d` (the Canvas 2D backup draws them).
- **Invariants:** WebGL 2 is tried first; if it is not offered, or a shader or a target fails to build, the painter goes to `canvas2d` and returns the `render_failed` notice once (`errors.md`); `canvas2d` is final for this painter, as a second back-end switch would flicker; a lost context goes to `lost` and `webglcontextrestored` back to `gl` with every tile `blank`; the board's data is never touched by a back-end change.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `gl` | `contextLost` | | `lost` | tiles sent `lose` |
| `lost` | `contextRestored` | | `gl` | programs and targets built again |
| `gl`, `lost` | `fail` | a build failed, or the context cannot come back | `canvas2d` | `render_failed` returned; tiles sent `lose` |

- **Reachable invalid states or transitions:** `contextLost` and `contextRestored` in `canvas2d` have no row; `contextRestored` in `gl` has no row.

### B16. Painter frame

- **Where:** `web/painter.ts` `WebPainter`, `FRAME_MACHINE`.
- **States:** `between` (no frame open), `drawing` (`beginFrame` was called, `endFrame` was not).
- **Invariants:** `drawTile`, `drawItems`, `drawLiveStroke` and `drawOverlay` outside a frame return `bad_argument` and draw nothing; a second `beginFrame` before `endFrame` is refused; `endFrame` ends the frame even when a draw call failed.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `between` | `begin` | | `drawing` | size and camera kept |
| `drawing` | `end` | | `between` | the frame is shown |

- **Reachable invalid states or transitions:** `begin` in `drawing` and `end` in `between` have no row.

### B17. Live layer

- **Where:** `web/painter.ts` `LiveLayer`, `LIVELAYER_MACHINE`. Independent marks of the layer (how many points are already drawn, the stroke's colour and opacity) are one named record, `ink`.
- **States:** `clear` (nothing on the live canvas), `inking` (a stroke grows on it), `holding` (the stroke ended; the canvas still shows it until the tile that now holds the stroke is drawn).
- **Invariants:** the canvas asks for `desynchronized`; each frame draws only the segments added since the last frame, with one segment of overlap so no seam shows; the tail not yet final (the last 3 points) and the predicted samples go to the overlay and are cleared each frame; the stroke's opacity is the canvas's CSS opacity, so overlapping segments of one stroke do not darken; `holding` ends in the frame that draws the tile (`settle`), so the stroke is never missing for a frame and never drawn twice. The live canvas sits above the figure cards (BR-55), so a stroke drawn over a card shows while it grows. The top layer that holds the shapes above a card is not a state: it is cleared and drawn again every frame from the shapes (`drawOverCards`).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `clear` | `ink` | a stroke began | `inking` | colour and opacity set |
| `inking` | `ink` | | `inking` | new segments drawn |
| `inking` | `release` | the stroke ended and was stored | `holding` | |
| `inking` | `abort` | the stroke was cancelled | `clear` | canvas cleared |
| `holding` | `settle` | the frame drew the tile | `clear` | canvas cleared |

- **Reachable invalid states or transitions:** `release` in `clear` and `ink` in `holding` have no row; `ink` in `holding` is held back until `settle`, so a fast second stroke starts on the next frame.

### B18. Frame loop

- **Where:** `web/board-view.ts` `FrameLoop`, `LOOP_MACHINE`.
- **States:** `idle` (no frame asked for), `queued` (a frame is on the animation frame queue), `running` (the frame body runs), `again` (a frame was asked for while one ran).
- **Invariants:** at most one animation frame is queued; a request made during a frame runs one more frame after it, never nested; a body that returns true (a fading laser trail, a zoom not yet steady, tiles still waiting for their turn) asks for the next frame itself; a body that throws is dropped and the loop goes back to `idle`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `request` | | `queued` | frame scheduled |
| `queued` | `request` | | `queued` | |
| `queued` | `run` | the frame came | `running` | |
| `running` | `request` | | `again` | |
| `running` | `done` | | `idle` | |
| `again` | `request` | | `again` | |
| `again` | `done` | | `queued` | next frame scheduled |

- **Reachable invalid states or transitions:** `run` and `done` in `idle`, and `run` in `running`, have no row.

### Round 3 (branch `feat/board-3`: shapes and editing)

Written before the code of round 3 (`core/tools/select.ts`, `core/tools/shape.ts`, `core/text-editor.ts`, `core/snap.ts`, `core/ink/hold.ts`, `web/images.ts`). Round 3 has no new store or history state: every change a tool makes is a transaction (B1) and an undo step (B2), and a gesture that makes many writes (a drag, a resize, typing in a shape) shares one merge key, so it is one step, sealed when the gesture ends. Data that is not a state sits next to its machine and is named in the invariants: the gesture record of a tool (`gesture`: what was hit, where the pointer went down, the records as they were at the start), the guides of the snapper, the text and the selection range of the editor. Every table refuses at least one move.

### B19. Select tool

- **Where:** `core/tools/select.ts` `SelectTool`, `SELECT_MACHINE`.
- **States:** `idle`; `pointing` (the pointer is down on a shape or on empty page and has not moved past the slop of 4 screen pixels); `dragging` (the selection moves); `resizing` (one of the 8 resize handles is held); `rotating` (the rotate handle is held); `handling` (a handle of the kind, such as an arrow's end or bend or a line's point, is held); `brushing` (a box is dragged on empty page to select what it meets); `editing` (the text editor of B21 is open on a shape of this board).
- **Invariants:** what the pointer went down on is in `gesture` (`hit`, `handle`, `start`, `originals`), reset by every `down` and never read in `idle`; a drag, a resize, a rotation and a handle drag write one transaction for each move through one gesture (B25, begun with the first write), and the gesture is committed on `up`, so each press is one undo step; the shapes moved are the selection and everything inside a selected frame or group; a locked shape is selected but never changed; the arrows bound to a changed shape follow it in the same transaction (`core/bindings.ts`), also the arrow whose binding the transaction has just put, and a bound end stops `ARROW_GAP` (8 units) short of its target's outline, so the head shows beside the target (BR-55); a shape dropped inside a frame is parented to it, one dragged out of its frame is not; the selection is not in the store and is not an undo step; a click on a shape of a group selects the whole group; Shift toggles the shape in the selection; `editing` starts when the text editor opens (a double click on a shape with text, Enter, or a new text shape) and ends when it closes (a click outside, Esc); a `down` while `editing` closes the editor first; the snap guides (B22) are shown only in `dragging` and `resizing`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `down` | the point is not on a handle | `pointing` | the hit shape is selected (Shift toggles) |
| `idle` | `grabResize` | the point is on a resize handle of the selection | `resizing` | originals kept |
| `idle` | `grabRotate` | the point is on the rotate handle | `rotating` | originals and start angle kept |
| `idle` | `grabHandle` | the point is on a handle of the kind | `handling` | original kept |
| `idle` | `edit` | the text editor opened | `editing` | |
| `pointing` | `dragShape` | moved past the slop on a shape | `dragging` | snapper begins (B22) |
| `pointing` | `brush` | moved past the slop on empty page | `brushing` | box starts |
| `pointing` | `up` | | `idle` | a click on empty page clears the selection; a double click opens the editor |
| `pointing` | `cancel` | | `idle` | |
| `dragging` `resizing` `rotating` `handling` `brushing` | `move` | | same | one merged transaction (a box: the selection is set) |
| `dragging` `resizing` `rotating` `handling` `brushing` | `up` | | `idle` | history sealed; a dragged shape may change its parent; the snapper ends |
| `dragging` `resizing` `rotating` `handling` `brushing` | `cancel` | | `idle` | the gesture is cancelled: every record any write changed is put back from the store's diffs (the arrow, the binding an end drag dropped, the arrows that followed, a group's members), and no undo step is left |
| `editing` | `close` | the editor closed | `idle` | |

- **Reachable invalid states or transitions:** `move` and `up` in `idle`, `edit` in any state but `idle`, and `dragShape` or `brush` anywhere but `pointing` have no row. A refused write (a limit, a locked shape) leaves the shapes as they were; the next move tries again.

### B20. Shape tools (rect, ellipse, triangle, diamond, star, line, arrow, text, sticky, frame)

- **Where:** `core/tools/shape.ts` `ShapeTool`, `SHAPE_TOOL_MACHINE`. One table; each tool is one instance of the class for its kind (`rect`, `ellipse`, `triangle`, `diamond`, `star`, `line`, `arrow`, `text`, `sticky`, `frame`) and keeps its own state.
- **States:** `idle`; `making` (the pointer is down: the shape follows it).
- **Invariants:** a drag makes the shape from the down point to the pointer; a `up` before the pointer moved past the slop makes the kind's default size centred on the point; Shift makes the box square (a circle for an ellipse) and snaps a line or arrow to steps of 15 degrees; Alt makes the box from its centre; the shape is written on the first move past the slop and updated on every move, all through one gesture (B25), so it is one undo step; when the shape is made the selection is the new shape and the tool host chooses the select tool again; `text` and `sticky` open the text editor on the new shape when the pointer comes up (an empty text shape is removed when the editor closes); a cancel removes the shape that was started and the frame it joined, and leaves no undo step; a click makes the kind's own default size (`KindDef.defaults`); new shapes take the styles of the style bar (`ToolStyles.shape`); locked or missing pages refuse the tool (the `down` is ignored).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `down` | a page exists | `making` | start point kept |
| `making` | `move` | | `making` | shape written or updated |
| `making` | `up` | | `idle` | default size if it was a click; selected; text editor for `text` and `sticky`; history sealed |
| `making` | `cancel` | | `idle` | the gesture is cancelled: the started shape goes |

- **Reachable invalid states or transitions:** `move` and `up` in `idle` have no row.

### B21. Text editor

- **Where:** `core/text-editor.ts` `TextEditor`, `EDITOR_MACHINE`; `BoardCore.editor`. The web view puts a hidden text field over the shape and sends what it holds (`set`) and its composition events; nothing in the core knows a DOM.
- **States:** `closed`; `editing` (the editor holds a shape id, its text and the selection range); `composing` (an input method is making a character; the text is the field's text with the composition in it).
- **Invariants:** the shape id, the text and the range are the state's data, kept in `session` (empty id when `closed`); every `set` in `editing` or `composing` writes the shape's `text` (a `label` for a box shape) with the merge key `edit:<n>`, so typing is one undo step, sealed on close; closing a `text` or `sticky` shape that holds only white space removes it in the same step; `open` is refused for a locked shape, a shape of a kind that holds no text, or a shape that is not there (`bad_argument`); listeners are told on `open` and on `close` (the select tool's `editing`, the web field).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `closed` | `open` | the shape takes text and is not locked | `editing` | session set, listeners told |
| `editing` | `set` | | `editing` | text and range written to the shape |
| `editing` | `compose` | an input method started | `composing` | |
| `editing` | `commit` | | `closed` | history sealed, empty text shape removed, session cleared |
| `composing` | `set` | | `composing` | text written |
| `composing` | `endCompose` | | `editing` | |
| `composing` | `commit` | | `closed` | as above |

- **Reachable invalid states or transitions:** `set`, `compose` and `commit` in `closed` have no row; `open` in `editing` or `composing` has no row, so a second shape cannot be opened before the first is committed; `compose` in `composing` has no row.

### B22. Snap

- **Where:** `core/snap.ts` `Snapper`, `SNAP_MACHINE`.
- **States:** `idle` (no gesture); `tracking` (a move or a resize is running and no guide is near); `snapped` (at least one guide holds the box).
- **Invariants:** the moving box is snapped to the edges and the centres of the other shapes on the page (those the index finds near it), to equal gaps (the gap on one side of the box equals a gap between two other boxes, or the gaps on both sides are equal) and to the page grid when the page shows one (24 units); the threshold is 6 screen pixels, so `6 / zoom` page units; for a move the box's three vertical and three horizontal lines are tried, for a resize only the lines of the edges that move; the nearest line within the threshold wins on each axis; `guides` holds the lines to draw (a guide has two ends in page units and a kind: `edge`, `centre`, `gap`, `grid`) and is empty unless `snapped`; the snapper has no clock and writes nothing to the store; `end` empties the guides.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `begin` | | `tracking` | candidate boxes read |
| `tracking` | `found` | a line is within the threshold | `snapped` | guides set |
| `tracking` | `miss` | | `tracking` | guides empty |
| `snapped` | `found` | | `snapped` | guides set |
| `snapped` | `miss` | | `tracking` | guides emptied |
| `tracking` `snapped` | `end` | | `idle` | guides emptied |

- **Reachable invalid states or transitions:** `found`, `miss` and `end` in `idle` have no row; `begin` while `tracking` or `snapped` has no row, so a second gesture cannot start before the first ends.

### B23. Recognise hold

- **Where:** `core/ink/hold.ts` `HoldWatch`, `HOLD_MACHINE`; used by the pen tool (`core/tools/pen.ts`).
- **States:** `idle` (no stroke, or the stroke ended); `watching` (the pen is down and the stroke is being drawn; the time since the pen last moved is counted); `fired` (the pen stayed still for 500 ms and the stroke was handed to shape fixing; the pen is still down).
- **Invariants:** the clock is the input layer's (`time` of the samples and the `now` of `tick`); the pen has moved when it is more than 3 screen pixels from where it last moved; the data of `watching` is the place and the time of the last move (`since`); the hold fires only for a stroke of at least 8 points and 40 screen pixels of length (a dot or a tap is not a shape); the highlighter does not watch; `fired` commits the stroke (one undo step), then replaces the ink by the clean shape in a second step when the fit is under 6% (`core/ink/recognise.ts`), and leaves the ink when nothing fits; after `fired` the rest of the gesture is ignored until the pen comes up; the toolbar's Fix does the same on the selected strokes (or the newest stroke) without this machine.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `begin` | the stroke began | `watching` | place and time kept |
| `watching` | `move` | the pen moved | `watching` | place and time kept again |
| `watching` | `fire` | 500 ms since the last move | `fired` | the stroke is committed and fixed |
| `watching` | `end` | the pen came up | `idle` | |
| `watching` | `cancel` | | `idle` | |
| `fired` | `end` | the pen came up | `idle` | |
| `fired` | `cancel` | | `idle` | |

- **Reachable invalid states or transitions:** `fire` in `idle` or `fired` has no row (a hold fires once); `move` in `fired` has no row, so the ink of a fixed stroke cannot grow; `begin` in `watching` or `fired` has no row.

### B24. Image decode

- **Where:** `web/images.ts` `ImageEntry`, `IMAGE_MACHINE`; one entry for each image asset the page shows.
- **States:** `pending` (the browser is decoding the asset's bytes); `ready` (the picture can be drawn); `failed` (it cannot be decoded; a grey box with a cross is drawn).
- **Invariants:** an entry is made the first time a tile asks for the asset and is kept until the asset record is gone; `ready` and `failed` are final; the entry's picture is released when the entry is dropped; the board draws a grey box with the asset's name while an entry is `pending` or `failed`, and asks for the tiles of the image to be drawn again when an entry leaves `pending`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `pending` | `decoded` | | `ready` | tiles of the image shapes marked, a frame asked for |
| `pending` | `fail` | | `failed` | the same, with the cross |

- **Reachable invalid states or transitions:** every move out of `ready` and `failed` has no row.

### B25. Gesture

- **Where:** `core/edit.ts` `Gesture`, `GESTURE_MACHINE`, `beginGesture(core, origin)`. Added in the round 3 fixes (BR-26); the select tool, the shape tools and the eraser write only through it, and `eslint.config.js` makes a `.change(` call in `core/tools/` an error ("tools write through a gesture, so a cancel puts back everything"). The editing commands of `core/edit.ts` take it in `WriteOptions.gesture`.
- **States:** `open` (the gesture takes writes); `committed` (finished, its writes stay); `cancelled` (finished, its writes were put back).
- **Invariants:** the gesture has one merge key (`gesture:<n>`, a count for each store), so every write of it joins one undo step; `write(fn)` runs `fn` as one store transaction (B1) and, when it was accepted, keeps for each record in its diff what the record was before the gesture's first write to it (`undefined` for a record the gesture added); a refused write changes nothing and is not counted; `cancel` writes every kept record back (a record the gesture added is removed, one it removed or changed is put back exactly) in one transaction with the same merge key, so the history finds the step empty and drops it; `commit` and `cancel` seal the history, so the next write starts a new step; a write after `commit` or `cancel` is refused (`bad_argument`).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `open` | `write` | | `open` | one transaction; the records before are kept |
| `open` | `commit` | | `committed` | history sealed |
| `open` | `cancel` | | `cancelled` | every kept record written back; history sealed |

- **Reachable invalid states or transitions:** every event in `committed` and `cancelled` has no row (a second `commit` or `cancel` and a late `write` do nothing). A listener that writes while the gesture's transaction notifies makes a diff of its own; the gesture does not keep it.

### Round 4 (branch `feat/board-4`: figure cards and the customisable board)

Written before the code of round 4 (`web/figures.ts`, `web/ui/`, `core/keymap.ts`). A figure card follows tiptap's `FIGURE_MACHINE` (T1) with one more state, `moving`, for the time the camera is moving; the layer that owns the cards has its own two small machines (the camera's motion as the cards see it, and who has the input). Every table below refuses at least one move. Marks that do not depend on each other sit in one named `readonly` record (`FigureCard.facts`: `pictureAsked`, `inputAsked`, `pictureDue`); the id of the card that holds the input is never kept in a field, it is the card whose own input machine is in `input`.

### B26. Figure card

- **Where:** `web/figures.ts` `FigureCard`, `CARD_MACHINE`; one card for each figure shape of the current page, owned by `FigureLayer`. Every mount, save and unmount of one card runs on its own promise chain (`queue`).
- **States:** `picture` (no app; the slot shows the shape's `picture`, or nothing and the canvas shows the placeholder); `mounting` (claimed, `createApp` in flight); `live` (an app is there and shown, counted against the cap of 3); `moving` (an app is there, hidden, and the card's picture shows because the camera is moving; still counted against the cap); `saving` (not claimed, the app is still there while its picture is made); `failed` (the mount or the script failed once: the picture and a small error badge; tried again by the next live order); `dead` (failed twice; a picture until the script or mode changes); `gone` (terminal: the shape is removed, the page is left or the board is disposed).
- **Invariants:** at most 3 cards are `mounting`, `live` or `moving` (the scheduler's `maxLive` and `makeRoom` both keep it: a card is claimed only when `makeRoom` says there is a place, otherwise it stays a `picture` and the scheduler's next order decides); a card holds at most one app; a card on another page has no card at all (the layer drops every card when the page changes); the script is the only source of truth: the card reads `props.script` and nothing else, and a script change from outside (undo, a paste, the lines panel) applies to the live card (added lines run alone, any other change loads again); the picture is a cache: it is written with `history: false`, and a script change writes `picture: null` in the same undo step; a card that is `gone` takes no order; `figure_failed` is reported once for each failure and the card keeps its picture.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `picture` | `claim` | the script and mode check | `mounting` | `makeRoom` saves the least recently used card that is not live |
| `mounting` | `claim` | | `mounting` | |
| `mounting` | `mounted` | still wanted, same mode | `live` | the script is loaded; the scheduler is told (`noteMounted`) |
| `mounting` | `release` | the card is asked to give its place up (`makeRoom`, a save order) | `picture` | the app being made is freed when it arrives (the card no longer wants it) |
| `mounting` | `unmounted` | released before the app came | `picture` | app freed |
| `mounting` | `fail` | first failure: the app cannot be made, or its script cannot be loaded | `failed` | `figure_failed`, badge; `fail` is sent while the card is still `mounting`, and then the app is freed |
| `mounting` | `giveUp` | second failure | `dead` | `figure_failed`; the card leaves the scheduler |
| `failed` | `claim` | a live order after the failure | `mounting` | |
| `live` | `claim` | | `live` | |
| `live` | `move` | the camera moved (B28) | `moving` | the picture shows, the app hides |
| `moving` | `claim` | | `moving` | |
| `moving` | `settle` | the camera was still for 150 ms | `live` | the host is sized for the steady zoom and the app paints again |
| `live`, `moving`, `saving` | `unmounted` | the mode changed, or the app is lost: the graphics context was lost (`webglcontextlost` on the app's canvas), or the app was destroyed from outside (its element left the host) | `picture` | app freed; the card is claimed again when the scheduler still wants it and there is a place |
| `live`, `moving` | `release` | | `saving` | the reader's lines are kept, the picture is made |
| `saving` | `claim` | wanted again during the export | `live` | the kept lines are dropped |
| `saving` | `unmounted` | picture made | `picture` | app freed; the picture is written without an undo step |
| `failed` | `revive` | script or mode changed | `picture` | failure count cleared |
| `dead` | `revive` | script or mode changed | `picture` | registered again |
| any but `gone` | `remove` | | `gone` | app freed, scheduler key dropped |

- **Reachable invalid states or transitions:** `move` and `settle` in `picture`, `mounting`, `saving`, `failed` and `dead` have no row (a card with no shown app has nothing to hide); `mounted` in `picture` or `saving` has no row, so an app that arrives after a release is freed and the card stays as it was; `release` in `picture` and `failed` has no row (`mounting` has one, to `picture`); every event in `gone` has no row.

### B27. Card input

- **Where:** `web/figures.ts` `FigureCard.input`, `INPUT_MACHINE`; the layer keeps the rule that at most one card is in `input`.
- **States:** `board` (pointer and keys go to the board; the card's host has `pointer-events: none`); `input` (the card has the pointer and the keys; the board ignores them).
- **Invariants:** only a `live` card takes the input; a double click on a card or Enter with one card selected gives it (`give`), Esc inside the card, a press on the board outside the card, another page or the card leaving `live` takes it back (`release`); giving the input to one card first releases the one that had it; while a card is in `input` the board's tools see no pointer and no key from it; Esc inside the card does not clear the board's selection.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `board` | `give` | the card is `live` | `input` | the host takes `pointer-events`, the card takes the focus, the toolbar shows |
| `input` | `release` | Esc, outside press, card not live | `board` | the host gives them back, the board takes the focus |

- **Reachable invalid states or transitions:** `give` in `input` and `release` in `board` have no row.

### B28. Camera motion (as the cards see it)

- **Where:** `web/figures.ts` `FigureLayer.motion`, `MOTION_MACHINE`. Not the camera's own steady zoom (B4); it also counts a pan.
- **States:** `still` (the camera is where it was at the last frame); `moving` (it changed at a recent frame).
- **Invariants:** the layer compares the camera's `x`, `y` and `zoom` with the last frame's; a change sends `moved`; `settle` is sent when 150 ms of the frame clock pass with no change (`STEADY_DELAY_MS`); entering `moving` sends `move` to every card, leaving it sends `settle` to every card; while `moving` the layer asks for frames, so the settle comes with no other event; the scheduler is told of the motion (`noteScroll`) so a card builds only after the camera settled.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `still` | `moved` | camera changed | `moving` | cards `move` |
| `moving` | `moved` | camera changed | `moving` | the settle time starts again |
| `moving` | `settle` | 150 ms with no change | `still` | cards `settle` |

- **Reachable invalid states or transitions:** `settle` in `still` has no row.

### B29. Menus

- **Where:** `web/ui/menus.ts` `MenuHost`, `MENU_MACHINE`. The page list (B13) and the More shapes menu keep their own state; this machine is for the menus whose items are a list the host can change.
- **States:** `closed`; `main` (the main menu, from the top-left button); `page` (the menu of one page, from the page bar); `context` (right-click or a long press, at a point).
- **Invariants:** one menu is open at a time; the items are built when the menu opens, by the host's function over the default list (`menus.main`, `menus.page`, `menus.context`: `(items, target) => MenuItem[]`), and a function that throws or returns a bad list gives the default list (`onError`); an item whose `enabled(target)` is false is shown disabled and its `run` is never called; a menu closes when an item runs, on Esc and on a press elsewhere; `run` is called after the menu closed and a throw from it is reported (`onError`) and goes no further.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `closed` | `openMain` | | `main` | items built |
| `closed` | `openPage` | the page exists | `page` | items built for the page |
| `closed` | `openContext` | | `context` | items built for the target |
| `main`, `page`, `context` | `close` | item, Esc, outside press | `closed` | element removed |
| `main` | `openPage`, `openContext` | | `page`, `context` | the open menu closes first |
| `page` | `openMain`, `openContext` | | `main`, `context` | the same |
| `context` | `openMain`, `openPage` | | `main`, `page` | the same |

- **Reachable invalid states or transitions:** `close` in `closed` has no row; opening the menu that is already open has no row, so a second press on the button does not rebuild it (it closes it, through `close`).

### B30. Key map

- **Where:** `core/keymap.ts` `KeyMap`, `KEYMAP_MACHINE`.
- **States:** `building` (the map takes bindings); `sealed` (the map answers lookups).
- **Invariants:** a map is made from the defaults and the host's `keys` option: the host's entries first, in the order the host wrote them, then the defaults the host did not name; `false` removes an action's keys; a string or a list replaces them; each key string is normalised (`mod`, `shift`, `alt`, the key in lower case, in that order); a key string already taken by an earlier action is `shortcut_conflict` (`detail.key`, `detail.actions`) and the later action goes without it (the earlier one keeps it); a key string that does not parse is `bad_argument` and is left out; a lookup reads the map only when it is `sealed`, so a half-built map never answers; `rebind` (a host changing `keys` while the board runs) opens it again and seals it when done.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `building` | `bind` | the key is free | `building` | action to key |
| `building` | `bind` | the key is taken | `building` | `shortcut_conflict`; the later action has no key |
| `building` | `seal` | | `sealed` | |
| `sealed` | `rebind` | | `building` | the table is cleared |

- **Reachable invalid states or transitions:** `bind` in `sealed` and `seal` in `sealed` have no row (the sealed map is read only).

### Round 5 (branch `feat/board-5`: agents on the board)

Written before the code of round 5 (`core/agent.ts`, `core/agent-service.ts`, `core/agent-hand.ts`, `core/circle.ts`, `core/tools/ask.ts`, `web/agent-*.ts`, `web/ui/agent-panel.ts`). The runner (B31) writes the model's actions through one gesture for each call; the job (B32) is one request to the server and its answer; circle to ask (B33) is the user's side of a request; the hand animation (B34) is what the live layer shows while an action is being drawn; the panel (B35) is the screen's side. Every table below refuses at least one move, and a refused move is reported (`internal`). Data that is not a state sits in a named record or a list that is emptied when the machine leaves the state; no nullable field holds part of a state.

### B31. Agent runner

- **Where:** `core/agent.ts` `BoardAgent`, `RUNNER_MACHINE`. One runner for each board; `board_read` needs no state and is a plain method.
- **States:** `idle` (no `board` call is running); `running` (a call is applying its actions, in one gesture with origin `model`); `stopping` (`stop` was called: the action in hand is ended and the rest of the call is not run).
- **Invariants:** calls run one after the other (a call that arrives while one runs waits for it); each call has one gesture (B25), or the job's gesture when the job (B32) gives one, and every action of it is one `gesture.write` (one store transaction, B1), so a failed action changes nothing and the next action still runs; a call with its own gesture commits it when it ends, even when it was stopped, so what was made stays and is one undo step; the job commits its gesture when the job ends; `$last` is the id of the shape the previous action made (an arrow does not count, so a label can follow it), kept from one call to the next (a streamed answer is several calls), and forgotten when a `page` action changes the page or a new request begins (`forget`); the shapes the runner makes carry `meta.madeBy: 'model'`; `edit`, `move` and `delete` of a shape without that mark are refused with `agent_refused` unless the call allows it; an action that was stopped before it ran is reported `agent_partial`; the epoch (a count that `stop` raises) tells a call that was stopped from one that was not, so a call that begins after a stop is not stopped by it; a hand-style action waits for the hand animation (B34) and, when it is stopped part of the way, stores what was drawn so far; a `limit` from the store is reported as `agent_refused`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `run` | the call is valid (1 to 20 actions) | `running` | gesture begun |
| `running` | `done` | the last action ended | `idle` | gesture committed |
| `running` | `stop` | | `stopping` | the epoch is raised; the hand animation is cancelled |
| `stopping` | `done` | the action in hand ended | `idle` | gesture committed; unrun actions reported `agent_partial` |

- **Reachable invalid states or transitions:** `run` in `running` or `stopping` has no row (a second call waits on the queue and begins in `idle`); `stop` in `idle` and in `stopping` has no row (asked first with `can`).

### B32. Agent job

- **Where:** `core/agent-service.ts` `AgentJob`, `JOB_MACHINE`; `AgentService` keeps the jobs, the newest last, and the conversation.
- **States:** `ready` (made, nothing sent); `waiting` (the request is out and no answer has come); `working` (at least one answer of actions has come); `done` (the server said `done`); `stopped` (the user pressed Stop); `failed` (the server or the network failed, or the answer was not understood); `replaced` (a newer request took over). The last four are final.
- **Invariants:** a job is one request and has one gesture (B25, origin `model`) that every runner call of its answer writes through, committed when the job ends, so the whole answer is one undo step; a newer request aborts the older one at once (`replace`, its signal is aborted) and the older answer is not applied any more, what it made stays; Stop aborts the signal, ends the animation and the runner call that is applying actions (B31), and the job is `stopped`; the ids of what a job made are kept with the job; an answer is applied one event at a time, in order, each `actions` event as one runner call; a final job takes no more events; without a transport `ask` returns `agent_unavailable` and makes no job; a job that ended before `done` with something made gives `agent_partial` (what was made stays; the notice lists what failed), one that ended with nothing made gives `agent_unavailable` when it failed and `agent_partial` when it was stopped or replaced; the server's own `error` event ends the job `failed` with the server's message; a `say` event (a piece of the agent's words) is data, not a move: while the job is live, `ask` keeps the pieces of the answer in a local list and, when the job ends, writes them joined as one `agent` line of the conversation (after the lines that say what the actions did), so the words of a stopped or failed answer are shown too; the pieces of a replaced job are dropped (a newer request has begun); an answer with words and no action ends `done` and the notice "The agent made nothing." is not written when there were words.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `ready` | `start` | | `waiting` | the request is sent |
| `waiting` | `actions` | the event holds a list | `working` | applied by the runner |
| `waiting` | `done` | | `done` | |
| `working` | `actions` | | `working` | applied by the runner |
| `working` | `done` | | `done` | |
| `waiting`, `working` | `stop` | | `stopped` | signal aborted, the runner stopped |
| `waiting`, `working` | `fail` | an `error` event, a thrown transport, a bad line | `failed` | `onError` gets the error |
| `waiting`, `working` | `replace` | a newer request | `replaced` | signal aborted |

- **Reachable invalid states or transitions:** every event in `done`, `stopped`, `failed` and `replaced` has no row (a late event of an aborted stream is dropped, and the loop asks first with `can`); `actions` and `done` in `ready` have no row; `start` anywhere but `ready` has no row. `say` has no row in any state: it is not an event of the table (see the invariants).

### B33. Circle to ask

- **Where:** `core/circle.ts` `CircleAsk`, `CIRCLE_MACHINE`; the Ask tool (`core/tools/ask.ts`) and the pen's barrel button only feed it points.
- **States:** `idle` (nothing circled); `drawing` (the loop is being drawn); `choosing` (the loop is closed, the items are found and the suggestions are shown); `asking` (a suggestion was picked and its request is out).
- **Invariants:** the loop is kept in page units in one array that is emptied when the machine goes to `idle`; a loop of fewer than 3 points goes back to `idle`; the items are found when the loop closes (shapes whose middle is inside, ink with more than half its points inside, as the lasso does), at most 60, in reading order; the suggestions are made at once from the item kinds, with no server (design 11.1), and always end with `ask`; a loop with nothing in it has only `ask`; the pen's barrel button held gives the Ask tool for that stroke (B12 `askHeld`); `pick` builds the request of agent.md 3 and gives it to the service; a new loop while `choosing` or `asking` replaces the old one (the service aborts the older request, B32); `dismiss` (Esc, a press elsewhere) goes back to `idle`; the pick `ask` is refused until its text is not empty; the loop, the items and the suggestions are emptied when the machine leaves `choosing` and `asking`.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `down` | | `drawing` | loop begun |
| `drawing` | `move` | | `drawing` | a point added |
| `drawing` | `up` | 3 or more points | `choosing` | items found, suggestions made |
| `drawing` | `cancel` | | `idle` | loop emptied |
| `choosing` | `pick` | a suggestion of the list, and text for `ask` | `asking` | the request goes to the service |
| `choosing` | `down` | | `drawing` | the old loop, items and suggestions are dropped |
| `choosing` | `dismiss` | | `idle` | emptied |
| `asking` | `finish` | the job ended | `idle` | emptied |
| `asking` | `down` | | `drawing` | the older request is aborted by the service |
| `asking` | `dismiss` | | `idle` | emptied; the job is not stopped (Stop is the panel's) |

- **Reachable invalid states or transitions:** `pick` in `idle`, `drawing` and `asking` has no row; `up` and `move` in `idle`, `choosing` and `asking` have no row (a stray pointer event is asked first with `can`); `finish` in any state but `asking` has no row.

### B34. Hand animation

- **Where:** `core/agent-hand.ts` `HandAnimation`, `ANIMATION_MACHINE`; the web layer (`web/agent-hand.ts`) gives it the frame time and draws what it says on the live layer.
- **States:** `idle` (nothing is being drawn by the hand); `playing` (one action is being drawn); `landing` (the drawing is done and stored, and the hand's picture stays one frame, until the tile that holds the stored shape is drawn, so the shape does not blink).
- **Invariants:** the animation has no clock: the time of every frame is given to `step`; the rate is 400 characters a second (`HAND_CPS`), a stroke counts one character for every 4 page units of its length (`STROKE_UNITS_PER_CHAR`), and no action takes more than 3 seconds; with reduced motion nothing is begun and the shape is stored at once; one animation at a time (a second `begin` is refused, the runner waits); `progress` is from 0 to 1 and never goes back; `cancel` gives the progress reached, so a stopped stroke stores what was drawn so far; the plan is a record that is not in the store, read only, and each frame is made from it, never by writing the store.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `begin` | a plan with something to draw | `playing` | the first frame's time is kept |
| `playing` | `step` | progress below 1 | `playing` | a frame is made |
| `playing` | `finish` | progress reached 1 | `landing` | the runner is told |
| `playing` | `cancel` | Stop, a newer request | `landing` | the progress reached is given |
| `landing` | `settle` | the next frame | `idle` | the hand's picture is dropped |

- **Reachable invalid states or transitions:** `begin` in `playing` and `landing` has no row; `step` in `idle` and `landing` has no row (asked first with `can`: a frame with nothing playing is a plain frame); `cancel` in `idle` and `landing` has no row.

### B35. Agent panel

- **Where:** `web/ui/agent-panel.ts` `AgentPanel`, `PANEL_MACHINE`.
- **States:** `closed` (only the small Agent button shows); `open` (the conversation and the box to talk show; nothing is running); `busy` (a request is running: the Stop button shows, the box is off, and the hand icon shows where the agent draws).
- **Invariants:** the panel exists only when the board has an agent (a transport or a server); the conversation is read from the service's list, so the panel keeps no copy (the agent's words of an answer are one `agent` line of that list, so the panel shows them with no state of its own); the hand icon's place is a record `{ x, y }` in page units (the last place the runner told) and the icon shows only while `busy`, so no flag says whether it shows; Stop stops the job through the service (B32), at once, and the panel goes back to `open`; the panel opens by itself when a new request begins (a circle was picked), so the answer is seen (the panel counts the requests it has seen, so a job that goes on while the panel is shut does not open it again); without a transport the panel says the agent is unavailable and has no box.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `closed` | `open` | | `open` | the panel shows |
| `closed` | `begin` | a request began (a circle was picked) | `busy` | the panel shows, the hand icon appears |
| `open` | `close` | | `closed` | |
| `open` | `begin` | a request began (a message, or a circle) | `busy` | the hand icon appears |
| `busy` | `end` | the job ended (done, stopped, failed, replaced) | `open` | the hand icon goes |
| `busy` | `close` | | `closed` | the job goes on |
| `closed` | `end` | | `closed` | a job that ended while the panel was shut |

- **Reachable invalid states or transitions:** `begin` in `busy` has no row (a newer request that replaces the running one keeps the panel `busy`: the panel asks first and does not send `begin`); `close` in `closed` has no row; `open` in `open` and `busy` has no row; `end` in `open` has no row.

### B36. Lift (fix round, branch `fix/board-drag-gc`, BR-82)

- **Where:** `core/lift.ts` `Lift`, `LIFT_MACHINE`; `BoardCore.lift`. Written by `Gesture` (B25) for origin `user`; read by the web view's tiles (`DrawList.plan(…, leave)`, `diffRegions(…, leave)`) and its overlay.
- **States:** `resting` (no shape is held; some may still be settling); `held` (a person's gesture is open and holds the shapes it wrote).
- **Invariants:** the held ids and the settling ids are two sets of data of the machine, not flags: a shape is in at most one of them; a held shape is in no tile and is drawn on the overlay every frame; a shape is held from the write after the first that changed it, so the tiles that showed it are drawn again once, without it; a removed shape is let go; only shape records are held, at most `LIFT_MAX` (400), the rest stay in the tiles; `release` moves every held id to settling and tells the listeners which ones (the view draws their tiles again); a settling shape is drawn over the visible tiles not drawn yet and is let go (`settled`) when none of them meets it; `clear` (a page change) forgets both sets; the model's gestures hold nothing.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `resting` | `hold` | a person's gesture wrote a shape | `held` | its id is held (it leaves settling) |
| `held` | `hold` | | `held` | more ids held |
| `held` | `release` | the gesture was committed or cancelled | `resting` | the held ids settle; listeners told |

- **Reachable invalid states or transitions:** `release` in `resting` has no row (a gesture that wrote nothing ends with nothing held; `release` asks first). `clear` sends `release` when it can and empties both sets.

## teacher

Written before the code of round 1 (branch `feat/teacher-r1`, `packages/teacher/src/`). Later rounds append their machines below (round 4: `VOICE_MACHINE` in the studio). Every machine is a `*_MACHINE` table over `StateMachine` from `@incantly/kernel`, made with its third argument, `onRefused`: a refused move is a bug, so the turn ends with an `internal` error event (`loop/turn.ts`) and a target reports it to the host's `onFault` (`tools/targets.ts`); a call that may come in any state asks `can` first. Data that is not a state (the counters of model and tool calls, the retry book, the failure streak, the loaded catalogue groups) sits next to the machine and is named in the invariants.

### TE1. Turn

- **Where:** `loop/turn.ts` `Turn`, `TURN_MACHINE`; `runTurn`.
- **States:** `idle` (made, not started), `calling` (a model call is open and no tool call has arrived in it yet, or the next call is about to open), `running_tool` (the open reply has given at least one tool call, which runs as soon as its arguments are complete), `done` (a reply ended with no tool calls, or the stream was cut and reported), `limited` (a limit was hit: 8 model calls, 24 tool calls, or 60 s on the caller's clock or by the caller's `AbortSignal.timeout`, which aborts with a `TimeoutError` reason), `stopped` (the caller's `AbortSignal` fired), `failed` (the model client reported an error). `done`, `limited`, `stopped` and `failed` are final.

| State | Holds |
|---|---|
| `idle` | the request; nothing sent |
| `calling` | the messages so far; the reply's text goes out as `say` events as it arrives |
| `running_tool` | the same, and the results of the tool calls run in this reply |
| `done` | the notices of the turn (`retry_spent`, `stream_cut`) |
| `limited` | what was drawn stays; one `turn_limit` (T003) error event ends the stream |
| `stopped` | what was applied stays; a final `done` event with the notices |
| `failed` | one error event, in the SDK shape, ends the stream |

- **Invariants:** the model-call counter, the tool-call counter, the start time (from the caller's `now()`), the retry book (per line key: how many failures, the fingerprints, and whether the line is spent), the failure streak (kind and length, reset by a line that passes) and the loaded catalogue groups are data of the turn, never states; the counters only grow; a tool call never runs in `idle`, `done`, `limited`, `stopped` or `failed`; a tool call that arrives after a limit or an abort is not run; `say` events go out before the reply's tool calls run; the messages of a turn are the assistant reply (text and tool calls) followed by one tool message per tool call, in call order, then at most one line naming what did not draw; a final state sends no event to the machine again (the loop returns).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `start` | | `calling` | the prompt is built |
| `calling` | `toolCall` | calls < 24 | `running_tool` | the tool runs; its outputs (`lines`, `control`) go out |
| `calling` | `replyEnd` | the reply had no tool call | `done` | `done` event with the notices |
| `calling` | `cut` | the client reported `stream_cut` | `done` | `done` event with a `stream_cut` notice |
| `running_tool` | `toolCall` | calls < 24 | `running_tool` | another call of the same reply runs |
| `running_tool` | `results` | the reply ended | `calling` | the messages grow by the reply and its results; model calls < 8 |
| `running_tool` | `cut` | the client reported `stream_cut` | `done` | the calls that ran stay; `done` event with a `stream_cut` notice |
| `calling`, `running_tool` | `limit` | a counter or the clock passed its limit, or the signal fired with a `TimeoutError` reason, also while the model sends nothing | `limited` | `turn_limit` error event |
| `calling`, `running_tool` | `abort` | `signal.aborted` with any other reason | `stopped` | `done` event |
| `calling`, `running_tool` | `modelError` | the client sent an error event | `failed` | error event |

- **Reachable invalid states or transitions:** none known. `start` in any state but `idle` has no row (`runTurn` makes a new `Turn` each call). `replyEnd` in `running_tool` has no row: a reply that gave tool calls ends with `results`. `toolCall`, `results`, `replyEnd` in a final state have no row; the loop returns before it could send one.

### TE2. Tool guard

- **Where:** `tools/guard.ts` `ToolGuard`, `TOOL_MACHINE`; held by each target (`figureTarget`), used by `Toolset.call`.
- **States:** `idle` (no tool runs on this target), `running` (one tool call runs on this target).
- **Invariants:** at most one tool call runs on a target; a call that finds the guard `running` gets `tool_busy` (T002), is not run and does not change the guard; `end` always follows `begin`, also when the tool returns an error or throws (the throw is caught and becomes an `internal` error).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `begin` | | `running` | |
| `running` | `end` | | `idle` | |

- **Reachable invalid states or transitions:** `begin` in `running` has no row: `enter()` asks `can` first and answers `tool_busy`. `end` in `idle` has no row: `leave()` asks `can` first.

### TE3. Figure stream (prompt to figure)

Written before the code of round 2 (branch `feat/teacher-r2`).

- **Where:** `stream/apply.ts` `FigureStream`, `FIGURE_STREAM_MACHINE`; `streamFigure`. The splitter (`stream/split.ts`) holds only the text of the line being written (data), no state.
- **States:** `idle` (made, not started), `planning` (the plan call is open: words only, no lines), `scripting` (the script call is open: each line is applied when its newline arrives), `repairing` (the repair call is open: replacement lines for the lines that failed), `done` (the stream ended well, or was cut and reported), `limited` (the deadline passed: the caller's `AbortSignal.timeout` aborted with a `TimeoutError` reason), `stopped` (the caller's signal fired with any other reason), `failed` (the model client reported an error in the plan or script call, or no line passed at all). `done`, `limited`, `stopped` and `failed` are final.

| State | Holds |
|---|---|
| `idle` | the request; nothing sent |
| `planning` | the plan text so far (never sent out) |
| `scripting` | the lines that passed, the lines that failed with their errors, the unfinished line |
| `repairing` | the same, and the failures given to the model |
| `done` | the notices (`retry_spent` for each line left out, `stream_cut`) |
| `limited` | what passed stays; one `turn_limit` error event ends the stream |
| `stopped` | what passed stays; a final `done` event with the notices |
| `failed` | one error event, in the SDK shape, ends the stream (`model_bad_output` when no line passed) |

- **Invariants:** the lines that passed, the lines that failed and the model-call counter are data, never states; a line goes out as a `lines` event only after it passed on the target, so what the client commits is always a script that loads; the plan text is never sent out; only the script call and the repair call write lines; the repair call runs at most once and only when at least one line failed and the script call ended well; a final state sends no event to the machine again.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `idle` | `plan` | the plan call is not skipped | `planning` | plan call opened |
| `idle` | `script` | the plan call is skipped (an edit of fewer than 3 objects, a request that names the result) | `scripting` | script call opened |
| `planning` | `planned` | the plan reply ended | `scripting` | script call opened with the plan |
| `scripting` | `repair` | the reply ended, at least one line failed | `repairing` | repair call opened with the failures |
| `scripting` | `finish` | the reply ended, no line failed | `done` | `done` event |
| `scripting` | `cut` | the client reported `stream_cut` | `done` | the unfinished line is dropped; `done` with a `stream_cut` notice |
| `repairing` | `finish` | the reply ended | `done` | lines still failing are left out; `done` with a `retry_spent` notice each |
| `planning`, `scripting`, `repairing` | `limit` | the signal fired with a `TimeoutError` reason, or a call or line limit passed | `limited` | `turn_limit` error event |
| `planning`, `scripting`, `repairing` | `abort` | the signal fired with any other reason | `stopped` | `done` event |
| `planning`, `scripting` | `modelError` | the client sent an error event | `failed` | error event |
| `scripting`, `repairing` | `unusable` | the reply ended and no line has passed in the whole stream, and none is left to repair | `failed` | `model_bad_output` error event |
| `repairing` | `cut` | the client reported an error or `stream_cut` in the repair call | `done` | the lines that passed stay; the failures are left out |

- **Reachable invalid states or transitions:** `plan` and `script` in any state but `idle` have no row (`streamFigure` makes a new `FigureStream` each call). `repair` in `planning` has no row: the plan call never writes lines. `modelError` in `repairing` has no row: a failed repair call is `cut`, because the figure already holds good lines.

### Round 3 (branch `feat/teacher-r3`): the board on the real AI, no new machine

Round 3 adds no state of its own; this note says where each new part gets its states, so a reviewer does not look for a table.

| Part | Where | States come from |
|---|---|---|
| `board_read` and `board` tools, `boardTarget` | `tools/board.ts`, `tools/board-target.ts` | The tool guard (TE2) of the target. The request's items, page and `allowEdit` are data fixed when the target is made. The one thing that changes while a call runs, how many `page` actions the answer has made, is a counter in the named record `seen` (after a page action the items no longer describe the current page, so the id checks leave the rest to the board). |
| `boardTurn` (jobs `circle` and `talk`) | `loop/board.ts` | The turn (TE1). The count of `actions` events sent and whether the model said anything are data, read once at the end: a talk with words and no action ends with `done`; a turn with neither, and a circle that drew nothing, end with `model_bad_output`. A circle's words are held in a local list until `done`. |
| `POST /v1/board/ask` | `packages/server/src/jobs/board.ts` | The request job (SV1) and the model call (SV2), as `/v1/figure/draw`. |
| The studio's choice of agent | `apps/studio/src/board-agent.ts`, `studio-page.ts` | One probe answer, read once after the board first opens. The board opens at once with the demo agent; a ready server then replaces its transport and label. Nothing else changes, so there is no state to table. |

## server

Written before the code of round 1 (branch `feat/teacher-r1`, `packages/server/src/`). Every machine is a `*_MACHINE` table over `StateMachine` from `@incantly/kernel`, made with its third argument, `onRefused`: a refused move is logged as `internal` with its fingerprint (`log.ts`) and the response is ended with `internal`. The rate limiter and the daily budget are counters, not states (server design 7).

### SV1. Request job

- **Where:** `jobs/job.ts` `Job`, `SERVER_JOB_MACHINE`; `http/ndjson.ts` writes through the job.
- **States:** `received` (the request is read; checks not done), `running` (the checks passed; nothing is written yet), `streaming` (the first event of an NDJSON answer is written), `done` (the answer is complete: a JSON body, or the last event), `refused` (a check failed; the HTTP error body is the answer), `aborted` (the client closed the connection; the model call is aborted), `failed` (an error ended the job; before streaming it is an HTTP error, after it the last event). `done`, `refused`, `aborted` and `failed` are final.

| State | Holds |
|---|---|
| `received` | the method, the path, the client's address and origin |
| `running` | the parsed request, the job's `AbortController`, the client's rate slot |
| `streaming` | the response head sent (`200`, `application/x-ndjson`); events flushed one by one |
| `done` | the response ended; the rate slot released |
| `refused` | one HTTP error body (`400`, `403`, `404`, `413`, `429`) |
| `aborted` | the model call aborted; nothing more is written |
| `failed` | `internal` (500 or a last event) with a fingerprint, or the job's own error |

- **Invariants:** exactly one response ends each request; nothing is written in a final state; the head of an NDJSON answer is written once. On a model route it is written as soon as `checked` passes (`firstEvent` follows at once, with no event), so every error after the checks is the stream's last event and only a check answers with an HTTP status; the client's rate slot (one model request at a time) is released in every final state; a closed connection moves the job to `aborted` from `running` or `streaming` and aborts the model call at once; an exception in a handler becomes `internal`, never an unhandled rejection; a handler that returns without answering is failed through the machine (`ensureEnded` sends `fail`, as `internal`), never answered from the response's own flags, which only the low-level writers (`write*`) read (`incantly/state-no-io-flags`).
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `received` | `checked` | method, route, origin, size, JSON, fields, rate, budget and key pass | `running` | slot taken; on a model route `firstEvent` follows at once and the head is written |
| `received` | `refuse` | a check failed | `refused` | HTTP error body written |
| `received` | `fail` | an exception while checking | `failed` | `internal` HTTP error body written |
| `running` | `firstEvent` | an NDJSON answer begins | `streaming` | head and first event written, flushed |
| `running` | `finish` | a JSON answer is ready | `done` | body written |
| `streaming` | `finish` | the turn ended | `done` | last event written, response ended |
| `running`, `streaming` | `close` | the client closed | `aborted` | model call aborted, slot released |
| `running` | `fail` | an error before any event (a route that is not a model route) | `failed` | HTTP error body written |
| `streaming` | `fail` | an error after the first event | `failed` | `{ "error": … }` written as the last event, response ended |

- **Reachable invalid states or transitions:** `finish`, `fail` and `close` in a final state have no row; the writer asks `can` first, so a late event of a closed connection is dropped, not reported. `firstEvent` in `streaming` has no row: the writer asks `can`. `checked` and `refuse` in `running` or later have no row.

### SV2. Model call through the fallback

Written before the code of round 2 (branch `feat/teacher-r2`).

- **Where:** `providers/fallback.ts` `Fallback`, `CALL_MACHINE`; `fallbackClient`. One machine for each `chat` call. The skip list (model id to the time its 429 skip ends) is data shared by every call, not a state.
- **States:** `trying` (no output has reached the caller: a model is open, or the next one is about to be), `streaming` (the first event of a model reached the caller: this model stays to the end), `done` (the reply ended), `failed` (no model gave output, or the model failed after output), `stopped` (the caller's signal fired). `done`, `failed` and `stopped` are final.

| State | Holds |
|---|---|
| `trying` | the models not tried yet, why each tried one passed (busy, failed, timed out), the first-byte timer of the open model |
| `streaming` | the model that answered; its events go out unchanged |
| `done` | the model's `done` event went out |
| `failed` | one error event: `model_busy`, `model_timeout` or `model_unavailable` before output; the model's own error after output |
| `stopped` | the open request to the model is aborted; nothing more goes out |

- **Invariants:** a model never changes after output reached the caller (the machine has no row from `streaming` back to `trying`); the first event of a model is its first byte (the first chat event with content: text, a tool call, `done` or an error; a keep-alive comment or a chunk with only the role does not count), and the 15 s timer is set only in `trying` and cleared by the first event or by the pass; a model that gave 429 is skipped for 60 s from the call that saw it (`skipUntil`, on the injected clock), and a call that finds every model skipped or busy ends as `model_busy` with the shortest wait as `retryAfterMs`; an error event before output passes to the next model, an error event after output is the caller's last event; the model request is aborted when the call ends in any final state; no event goes out after a final state.
- **Transitions:**

| From | Event | Guard | To | Side effects |
|---|---|---|---|---|
| `trying` | `passOn` | HTTP 429, 5xx, another failure, a network error, no first byte in 15 s, or an error event before output | `trying` | the model's request aborted; a 429 sets its skip |
| `trying` | `output` | the model's first event is text or a tool call | `streaming` | the event goes out |
| `trying` | `finish` | the model's first event is `done` | `done` | the event goes out |
| `trying` | `exhaust` | no model is left | `failed` | `model_busy`, `model_timeout` or `model_unavailable` error event |
| `streaming` | `finish` | the model's `done` event (the stream ended with `[DONE]`, or a choice carried a `finish_reason`) | `done` | the event goes out |
| `streaming` | `fail` | the model's error event, or the stream ended with neither `done` nor a `finish_reason` | `failed` | the error event goes out (a cut stream is `stream_cut`) |
| `trying`, `streaming` | `abort` | the caller's signal fired | `stopped` | the model's request aborted |

- **Reachable invalid states or transitions:** `passOn` in `streaming` has no row (the fallback asks `can` first and forwards the error). `output` and `finish` in a final state have no row; the loop returns first.

## Explicit since the lint rules (branch `fix/lint-warnings`)

Machines that were written as flags or direct writes are now tables over `transition` or `StateMachine` from `@incantly/kernel` (`AGENTS.md`, "Rules are checked by code"). The behaviour did not change; every test and film hash is the same. `GRID_MACHINE` and `ERROR_MACHINE` first had one row copied into every state; `incantly/state-table-refuses` found them (board review BR-1) and their rows now list only the moves that may happen.

| Machine | Where | States | Notes |
|---|---|---|---|
| `SCHEDULE_MACHINE` | `packages/view/src/core/scheduler.ts` | placeholder, ready, live, paused, saved | V1: `build`, `restore`, `promote`, `pause`, `save` |
| `TICK_MACHINE` | `packages/view/src/web/scheduler-host.ts` | idle, ticking, again | A tick asked for inside a tick runs once more, never nested |
| `SAMPLER_MACHINE` | `packages/plot/src/function.ts` | setup, refine, classify, band | Refine and classify alternate; the exact band is last |
| `WORKER_MACHINE` | `packages/sdk/src/worker/physics-host.ts` | off, idle, waiting, failed | One frame in flight; `failed` (no worker, or it crashed) is final |
| `GRID_MACHINE` | `packages/kernel/src/physics/grid-life.ts` | running, unstable | Smoke and fire grids in the plane and in space. `running`: `blowUp` to `unstable`. `unstable`: `reset` to `running`; nothing else. A checkpoint load does not send an event of its own: `restoreLife` reads the saved state and sends `blowUp` or `reset` only when the state differs |
| `ERROR_MACHINE`, `COVER_MACHINE` | `packages/ui/src/line-editor.ts` | typing, quiet, error; open, dismissed, confirm, confirmDismissed | The line's errors show after a pause; Esc hides the strip, then asks to clear. `ERROR_MACHINE`: `type` from every state to `typing` (and `typing` to itself); `settleQuiet` and `settleError` only from `typing` (the pause timer is started by an edit and cleared by a failed submit, so it fires only there); `fail` from every state to `error` |
| `FIGURE_MACHINE` | `packages/tiptap/src/node-view.ts` | see T1 | |

Marks that do not depend on each other are grouped in named records instead of loose flags: the physics drivers' `coneFacts`, `advanceFacts` and `doing`, the checker's `found` and `context`, the figure view's `frameLoop` and `layers`, the event hub's `queued`. The smoke grids' `staticDirty` became a count of wall moves (`markWallsAgain`), and the figure's `@clock` and `@solver` caches keep the item they were read from instead of a "read" flag.
