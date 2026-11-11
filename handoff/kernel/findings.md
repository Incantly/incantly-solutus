# Kernel and errors area: checker findings

Branch `feat/kernel`, checked at `00a69c4` (pass 1, step 4). The state machines are K1 to K15 in `docs/state-machines.md`, section `kernel`. Paths are under `packages/kernel/src/`; line numbers refer to `00a69c4`.

Every reproduction uses only the public API (`src/index.ts`) and the test commands of `packages/kernel/test/spec/kernel/helpers.ts` (`figure(lines)`, `newFigure()`, `TEST_COMMANDS`, `snap`). The observed output was produced by a scratch Vitest file that was deleted before the commit. JavaScript is single-threaded, so "concurrency" here means re-entrancy (a listener, a rule or an action calling back into the figure), operations interleaved by the host, and the order of events.

## Summary

| Impact | Findings |
|---|---|
| Security | KERN-SM-1, 2, 3, 4 |
| Hangs and crashes | KERN-SM-5, 6, 7, 8 |
| Wrong results | KERN-SM-9, 10, 11, 12, 13, 14, 15 |
| Speed (a documented target missed, or growth that will miss it) | KERN-SM-16, 17 |
| Wrong errors and notices | KERN-SM-18, 19 |
| Cosmetic | KERN-SM-20 |

### Fix groups

Related findings that one change should fix together (pipeline.md: fix every case of a rule).

| Group | Findings | One change |
|---|---|---|
| A. Journal groups and history inside a batch | 9, 15a | History operations refuse or act inside the open group; nested `begin`/`end` count depth; every rollback restores both stacks and the event queues (one helper shared by `applyBatch` and `load`). |
| B. "Rejected" must mean unchanged | 10 | Snapshot the journal depth and the pending queues at the start of `apply`; on any fault after a change, revert everything recorded since (not only `txEntry`), or report the line as committed. |
| C. Gestures | 11 | Commit an open gesture before every journalled write (`apply`, `delete`, `rename`, `move`, `insertAt`, `setFree` with `show_me` or `api`, `append`). |
| D. Size budgets on every path | 1, 7, 2 | One budget check at every entry (`apply`, `applyBatch`, `append`, `fromScript`, `setFree`): line count, script items, file size, text length; error texts cut to a fixed length; directive lookup by map. |
| E. Bounded work in the clock and solver | 5, 16 | Step budget per seek, finite film range, restart only when the cone changes. |
| F. No throw across the boundary | 6, 8, 19, 4 (getter) | Iterative `pull`; a guard around the pass; own-key lookups in exported tables; `setFree` copies the value inside a `try`. |
| G. Save format | 12 | Escape every character the normaliser reads as a quote or a newline; split or refuse texts the loader cannot read back. |

---

## Security

### KERN-SM-1. Size limits can be bypassed: batches, comments and directives, one big undo group, free Texts

- **Impact:** security (unbounded memory and work). Status: fixed.
- **fix:** every path into the figure is budgeted: Limits gained items (5,000), lines (20,000) and textLength (10,000); applyBatch and load refuse over lines or fileSize, comments and directives count against items, setFree caps a Text, and the journal measures an entry by the texts it holds (size cached per entry).
- **Evidence:**
  1. `applyBatch` has no size check. `new Figure({ limits: { fileSize: 1000 } }).applyBatch(2,000 lines 'n<i> = <i>', { group: 'g' })` is accepted; the figure's script is 23,787 characters. `load` (`graph/figure.ts:456`) is the only place that reads `fileSize`.
  2. Comments and directives are counted by no limit. `new Figure().applyBatch(100,000 × '# comment <i>', { group: 'g', mode: 'independent' })` succeeds in 268 ms; `toScript()` is 1,588,897 characters; `items` has 100,000 entries. The `objects` limit counts only objects. The same works with repeated `apply('# c')` and with repeatable directives (`@step`, `@beat`, `@cell`, `@colwidth`, `@limit`).
  3. The journal caps are per entry. The batch above leaves `undoInfo()` at `{ depth: 1 }`: one `group` entry holding 100,000 entries. `Journal.trim` (`history/journal.ts:166`) never drops the last entry, and `sizeOf` estimates a fixed 80 to 200 bytes per entry whatever its content, so neither `journalEntries` nor `journalBytes` bounds the memory.
  4. `setFree` accepts any length of Text (`graph/values.ts` `fitsType` only checks `typeof`); the language caps texts at 10,000 characters. Each `api` write keeps the old and new `Persist` in the journal, so 500 writes of a 10 MB text keep 5 GB.
- **Invariant broken:** K15 and kernel errors.md 6: every size budget is enforced on every path into the figure; K6: the journal is bounded by `journalEntries` and `journalBytes`.
- **Suggested fix (group D):** apply `fileSize` to the total text of a batch, and add a line-count budget per batch; count comments and directives (an `items` budget, for example 5,000 by default, `limit` `items`); measure a journal entry by the size of the texts it holds and let `trim` split or refuse a group over the byte cap; cap free Text values at the language's 10,000 characters in `setFree` (`bad_argument` or `limit`).

### KERN-SM-2. Errors echo unbounded caller text; the compact error is not bounded

- **Impact:** security (a model's context and the logs can be flooded; errors design 3.5 caps the compact form at about 800 characters). Status: fixed.
- **fix:** err() cuts caller text in params, token, key, related and hint to fixed lengths; compactError shortens hint, token and message last so the form always fits 800 characters.
- **Evidence:**
  - `figure(['A = (0, 0)']).delete('x'.repeat(5000))`: `message` is 5,016 characters; `JSON.stringify(compactError(e)).length` is 10,133.
  - `f.rename('A', 'Q'.repeat(100000))`: `bad_name` `message` is 100,051 characters; the compact form is 100,157.
  - Path: `FigureHist.need` (`graph/hist.ts:79`) and `doRename` (`graph/hist.ts:252`) put the caller's string in `params`, `token`, `fingerprint` and `hint`; `compactError` (`errors/compact.ts`) drops `source`, `cause`, `related`, `forms`, `expected`, `endCol` and trims `hint`, but never `message` or `token`. The same holds for `setFree`, `describe`, `slice`, `move` and every other call that takes a name or id. Lines are capped at 2,000 characters by the lexer, so line errors are bounded; API errors are not.
- **Invariant broken:** K15: the compact form is at most about 800 characters; messages name the thing without echoing unbounded text.
- **Suggested fix (group D):** cut any caller text placed in an error to a fixed length (for example 64 characters plus `…`) in one helper used by `need`, `doRename` and `err`; let `compactError` shorten `message` and `token` last, so the result always fits `limit`.

### KERN-SM-3. A `CommandRegistry` shared by several figures is mutated by each one

- **Impact:** security (leak between figures; unbounded growth). Status: fixed.
- **fix:** a CommandRegistry passed to a Figure is copied, never written to; the kernel actions are added to the figure own copy.
- **Evidence:** `const reg = new CommandRegistry(TEST_COMMANDS)` (20 specs); after `new Figure({ commands: reg })` three times, `reg.all().length` is 47 and `reg.problems().length` is 18 (the nine kernel actions are registered once per figure, `graph/base.ts:37`). `figures[0].registry.register(spec)` makes the command available in `figures[1]` (`figures[1].apply('k = Leak()')` succeeds). Every figure made from a host's registry adds nine more specs, forever.
- **Invariant broken:** K15: the registry is not changed by building a figure; figures do not share state the host did not share on purpose.
- **Suggested fix:** when `opts.commands` is a `CommandRegistry`, build the figure's own registry from its specs (or a layered view: the host's specs plus the kernel actions) instead of registering into the caller's object; add the kernel actions only to a registry the figure owns.

### KERN-SM-4. `setFree` trusts its caller: the `solver` reason bypasses `fixed` and history, unknown reasons are not journalled, values are kept by reference

- **Impact:** security (authorisation of `fixed`, integrity of history and values). Status: fixed.
- **fix:** setFree rejects a why outside the five and solver on a non-state; the value is copied (Points as fresh numbers) inside a try, so a getter that throws or a later change by the caller cannot reach the figure; a Text over textLength is a limit error.
- **Evidence:**
  - `figure(['A = (1, 1) with fixed = true']).setFree('A', { x: 5, y: 5 }, 'solver')` returns `{ ok: true, changed: true }`; `A` is `(5, 5)` and the undo depth stays 1. `writeFree` (`graph/hist.ts:533`) skips the `locked` check for `why === 'solver'` on any free object, and `solver` writes are never journalled.
  - `setFree('A', { x: 7, y: 7 }, 'bogus')` is accepted and not journalled (only `show_me` and `api` record, `graph/hist.ts:573`; `drag`/`slider` join a gesture). The junk-argument fix did not cover `why`.
  - `const v = { x: 2, y: 2 }; f.setFree('A', v, 'api'); v.x = 99` → `f.value('A')` is `{ x: 99, y: 2 }` and `toScript()` writes `A = (99, 2)`, with no pass, no event and no journal entry; the journal's `after` `Persist` changed too.
  - `f.setFree('A', { get x() { throw new Error('g') }, y: 1 }, 'api')` throws out of `setFree` (`fitsType` reads `x`).
- **Invariant broken:** K9: a fixed object is not written without `force`; every user write is undoable; a stored value is never changed afterwards; nothing throws across the boundary (AGENTS.md).
- **Suggested fix (group F for the getter):** reject a `why` outside the five with `bad_argument`; accept `solver` only for `state` records (the solver writes through `writeCell`, not `setFree`); copy Points and Vectors into fresh `{ x, y }` numbers (and lists into frozen arrays) inside a `try`, returning `bad_argument` when reading the value throws.

## Hangs and crashes

### KERN-SM-5. A seek with states has no step budget: `setClock(Infinity)` never returns

- **Impact:** hang. Status: fixed.
- **fix:** a seek takes at most 400,000 grid steps per call and setClock rejects a non-finite t; a seek further than that leaves the states undefined (timeout) and later flushes catch up; checkpoints are capped at 2,000 by doubling the spacing.
- **Evidence:** `figure(['s1 = state(1)', "s1' = -s1"])`: `setClock(100)` takes 9.9 ms, `setClock(1000)` 70 ms with 2,000 checkpoints kept; time grows linearly, so `setClock(1e6)` is about 70 s and keeps about 2 million `Float64Array` checkpoints. Without `@clock`, `clockRange()` is `{ from: 0, to: Infinity }` (`graph/figure.ts:132`), `setClock` accepts `Infinity` (it rejects only NaN, line 156), and `StateSolver.at(n)` (`clock/solver.ts:343`) loops `for (let i = from; i < n; i++)` with `n = Infinity`: the call never returns. The fixer notes list `1e9` as not done; it is a hang reachable from one host call or one film value.
- **Invariant broken:** K11: work and memory per seek are bounded; K10: `t` is a finite number inside the film range.
- **Suggested fix (group E):** reject a non-finite `t` in `setClock` (`bad_argument`); give `at()` a step budget per call (for example 240 × 60 steps), stop at the frontier and report `timeout` on the states (undefined with reason `timeout`, design errors.md 2) until later calls catch up; thin checkpoints beyond a cap (keep every k-th).

### KERN-SM-6. Reading a value in lazy mode recurses once per stale ancestor: `RangeError` at the default limits

- **Impact:** crash (throws across the boundary). Status: fixed.
- **fix:** pull collects the stale ancestors with a stack and computes them in ascending order, so no recursion.
- **Evidence:** a 5,000-object chain `h = 1`, `c1 = h + 1`, `c<i> = c<i-1> + 1` (the default `objects` limit); `f.setDemand([])`; `f.setFree('h', 2, 'api')`; `f.flush()`; `f.value('c4999')` throws `RangeError: Maximum call stack size exceeded`. The same with `limits: { objects: 20000 }`. Path: `readValue` → `pull` (`graph/core.ts:276`), which calls `pull` on each stale input before computing; one frame per link.
- **Invariant broken:** K3: no public read throws; the walks are iterative (K2 says so for the graph, `pull` breaks it).
- **Suggested fix (group F):** make `pull` iterative: collect the stale ancestors with `ancestorRecs` (or an explicit stack), sort by `order`, compute each once.

### KERN-SM-7. Directive replacement is quadratic: a 2 MB file of comments and directives takes tens of seconds

- **Impact:** hang (from a file the loader accepts). Status: fixed.
- **fix:** directives are found by a Map<name, index> kept by insertItem/removeItem (also used for clockRange and the solver step); the items budget bounds the file.
- **Evidence:** `n` comment lines then `n` `@view -<i> <i> -3 3` lines through `applyBatch(..., { mode: 'independent' })`: n = 2,000 takes 61 ms, 4,000 161 ms, 8,000 566 ms (×3.5 per doubling). A non-repeatable directive is replaced through `this.items.findIndex(...)` (`graph/tx.ts:311`), which scans every comment before it. A 2 MB file holds about 130,000 such lines; at this rate that is well over 20 s inside one `fromScript`.
- **Invariant broken:** K12 and K13: loading is linear (1,000 lines under 100 ms, kernel design 15); a file under `fileSize` loads in bounded time.
- **Suggested fix (group D):** keep a `Map<name, index>` of non-repeatable directives (updated on insert, replace, undo and re-anchor), and apply the `items` budget of KERN-SM-1.

### KERN-SM-8. A rule that re-enters the figure during a pass makes `flush` throw; `faults` grows every frame

- **Impact:** crash (throws across the boundary); unbounded memory. Status: fixed.
- **fix:** a figure operation called while a rule runs (runCommand depth) returns tool_busy; faults are capped at 100 and cleared at the start of each frame outside an operation; a frame that throws returns an empty delta.
- **Evidence:**
  - A command `Sneaky(x)` whose rule calls `fig.apply('Delete(k)')` once, on a figure `a = 1`, `k = a + 1`, `m = Sneaky(a)`, `n = k + m`: `setFree('a', 2, 'api')` then `flush()` throws `TypeError: Cannot read properties of undefined (reading 'inputs')`. The nested delete removes records while `FigureCore.flush` (`graph/core.ts:623`) walks order indices computed before it.
  - `figure(['a = 1', 'u = Unlucky(a + 0 * t)'])`, `setFree('a', 13, 'api')`, then 1,000 × `setClock(i)`: `faults` holds 999 entries. `runCommand` pushes on every throw (`graph/core.ts:388`) and only line operations clear the list.
- **Invariant broken:** K3: no public call throws; `faults` is per operation. The rule contract asks for pure rules, but AGENTS.md says nothing throws across a package boundary, and an area's bug must become `internal` or `not_finite`, not a crash of the host.
- **Suggested fix (group F):** set a `passing` flag during `flush` and `settle`; a figure operation called while it is set returns `tool_busy` (or is queued until the pass ends); wrap the walk in `try`/`finally` that clears the flag; clear `faults` at the start of every `flush` (or cap it and count).

## Wrong results

### KERN-SM-9. `Undo()`, `Redo()` and nested batches inside an open journal group act outside it; atomic rollback then loses data

- **Impact:** wrong results with data loss. Status: open.
- **Evidence:**
  1. `figure(['a = 1']).applyBatch(['b = 2', 'Undo()'], { group: 'g', mode: 'independent' })`: names `['b']`, redo depth 1. `Undo()` removed `a`, written before the batch, instead of `b` (kernel design 11.2: the teacher's `Undo()` takes back its last line).
  2. `figure(['a = 1']).applyBatch(['b = 2', 'Undo()', 'c = nope + 1'], { group: 'g' })` (atomic): `rolledBack: true`, names `[]`, undo depth 1 → 0, redo depth 0. `a` is gone and no undo or redo can bring it back.
  3. A figure with the group `['a = 1', 'b = 2']`, then `applyBatch(['c = 3', 'Undo()'], { group: 'g2' })`: names `['a', 'c']`; `b` from the earlier batch was taken back.
  4. `figure(['a = 1', 'b = 2']).append('c = 3\nUndo()\nUndo()')`: names `['c']`, redo depth 2. A loaded file took back the host's own lines.
  5. An action `Macro()` whose rule calls `figure.applyBatch(['m1 = 1'], ...)`, in `applyBatch(['Macro()', 'b = 2', 'c = nope'], { group: 'outer' })` (atomic): `rolledBack: true` but names `['a', 'm1', 'b']` and undo depth 3.
  - Path: `Journal.takeUndo` and `takeRedo` (`history/journal.ts:178`, 195) read `stack`, which holds what was recorded before the group opened; `stepHistory` (`graph/hist.ts:381`) does not look at `journal.isOpen`; the atomic rollback (`graph/hist.ts:478`) reverts only the group's entries and restores `redoStack` to its saved copy, so the undone entry is in neither stack. `Journal.begin` joins an open group but `end` closes it whoever opened it (`history/journal.ts:104`, 113), so the nested batch closes the outer one and the outer `abandon()` returns nothing.
- **Invariant broken:** K6: while a group is collecting, nothing outside it is taken back; a group is closed only by its opener. K7: `Undo()` in a batch takes back the batch's own last line. K8: an atomic failure leaves the figure and both stacks as they were. K13: a file cannot reach earlier history.
- **Suggested fix (group A):** inside an open group, `Undo()` takes back the last entry of the group (and `Redo()` replays only what that `Undo()` took), or both are refused with `bad_argument` when the group is empty; never touch `stack` while a group is open. Give `Journal` a depth counter so a nested `begin`/`end` does not close the outer group. In the atomic rollback, restore `stack` as well as `redoStack` (save both at `begin`). Decide (product owner) whether `Undo()` and `Redo()` lines may appear in a loaded file at all; at least keep them inside the file's own group.

### KERN-SM-10. A fault after a change is reported as rejected (`committed: false`) while the change stays

- **Impact:** wrong results (the caller is told nothing changed). Status: open.
- **Evidence:**
  - An action `Spawn()` whose rule does `call.figure.apply('Z = 1'); throw new Error('x')`: `apply('Spawn()')` returns `internal`, `committed: false`; names `['Z']`, undo depth 1. `applyAction` (`graph/tx.ts:731`) catches and returns `internalError` without reverting what the action did.
  - `figure(['a = 1', 'u = Unlucky(a)'])`, `setFree('a', 13, 'api')`, `flush()`, `apply('a = 2')`, `apply('Undo()')`: the result is `internal`, `committed: false`, but `a` is 13 and redo depth is 1. The undo ran; its `settle` made `Unlucky` throw; `apply` saw `faults` and called `rollbackTx`, which had no `txEntry` (undo does not record), so nothing was reverted. `stepHistory` also clears the outer `faults` (`graph/hist.ts:385`).
- **Invariant broken:** K5 and errors design 6 rule 1: a failed line changes nothing; `committed: false` is always true.
- **Suggested fix (group B):** record the journal depth (both stacks) and the queue marks when `apply` starts; on a fault, revert every entry recorded since and undo a history step the line took (re-push it), then report `internal`. Run action rules inside that bracket. Where a revert is not possible, return the change as committed with an `internal` notice instead of an error.

### KERN-SM-11. A gesture is journalled after the edits made during it: undo goes back past them and then forward

- **Impact:** wrong results (undo order). Status: open.
- **Evidence:**
  - `figure(['A = (0, 0)'])`, `setFree('A', (5, 5), 'drag')`, `flush()`, `apply('A = (1, 1)')`, `commitDrag()`, then undo until empty: values `(1, 1)` → `(0, 0)` → `(5, 5)` → removed. Undo goes to the start of the gesture, then forward to its middle.
  - `figure(['a = 1 in 0..10'])`, `setFree('a', 5, 'slider')`, `setFree('a', 7, 'show_me')`, `setFree('a', 8, 'slider')`, `commitDrag()`: undo gives 8 → 1 → 5 → removed.
  - Path: `apply` and the `show_me`/`api` branch of `writeFree` record their entries at once; the gesture's entry (`before` = the `Persist` at the gesture's first write) is recorded only at `commitDrag` (`graph/hist.ts:587`). Builder notes decision 9 commits the gesture first only in `undo`, `applyBatch` and `dragPlan`.
- **Invariant broken:** K9: a gesture is one entry ordered with the others by when it happened; K7: undo replays states in reverse order.
- **Suggested fix (group C):** call `commitDrag()` at the start of every operation that records (`apply`, `insertAt`, `delete`, `rename`, `move`, `append`, and `setFree` with `show_me` or `api`), as `undo` already does.

### KERN-SM-12. Some free Texts are saved in a form that does not load

- **Impact:** wrong results (a saved figure does not reopen; data loss). Status: fixed.
- **fix:** setFree on a Text parses the saved line and refuses (bad_argument, or limit for line length) any text that does not read back as the same text; the language has no escape for typographic quotes or carriage returns, so those are refused, not escaped.
- **Evidence:** `figure(['s = "hi"'])`, `setFree('s', v, 'api')`, `Figure.fromScript(f.toScript())`:

| `v` | Load |
|---|---|
| `'a\rb'` | fails, `unterminated_string` |
| `'say “hi” now'` | fails, `missing_operator` |
| `'x„y'` | fails, `unterminated_string` |
| a 5,000-character text | fails, `limit` (line length) |
| `\t`, `{`, `"`, `#`, U+2028 | loads back unchanged |

  `textSource` (`graph/values.ts:55`) escapes `\`, `"`, `{`, `}` and `\n` only. The language's normaliser reads `“`, `”` and `„` as quotes and `\r` as a line end (L1, L2), and a logical line is capped at 2,000 characters. Text typed in a UI goes through `setFree`, so these values are ordinary user input.
- **Invariant broken:** K13: `fromScript(toScript(f))` gives the same free values (kernel design 13.3).
- **Suggested fix (group G):** in `textSource`, also escape `\r` and the three typographic quotes (as `\u{...}` or another escape the lexer reads; if the language has none, add one in the language area and report it); refuse in `setFree` a Text the loader cannot read back (over the line budget after escaping), or write long texts as a concatenation over continuation lines.

### KERN-SM-13. `insertAt` moves a `@step` breakpoint onto the inserted object

- **Impact:** wrong results (the build list's stops). Status: open.
- **Evidence:** `figure(['a = 1', '@step "two"', 'b = 2']).insertAt(1, 'w = a + 1')`: `steps()` gives `[a, —], [w, "two"], [b, —]`; before, `b` carried the title. `toScript()` writes `@step "two"` before `w`. Items are anchored after an object id (`ScriptItem.after`), and `steps()` gives the title to whatever object follows the anchor (`graph/figure.ts:313`); the inserted object becomes that object.
- **Invariant broken:** K12: a `@step` title stays with the object it marked after `insertAt` and `move`.
- **Suggested fix:** anchor `@step` items to the object they mark (store `before: ObjId`), or re-anchor items in `applyDefine` when `insertAt` puts an object directly after an anchor; check `move` with the same test.

### KERN-SM-14. A dry run does not match the commit

- **Impact:** wrong results (kernel design 8 and 16.6: "a preview that is guaranteed to match what Enter will do"). Status: open.
- **Evidence:** on an empty figure:

| Line | Dry run | Commit |
|---|---|---|
| `a = 20 in 0..10` | summary `a = 20` | summary `a = 10` |
| `r = Reciprocal(0)` | `becameUndefined` `[]` | `[{ name: 'r', reason: 'division_by_zero' }]` |
| `R = 1` (with `r` present) | notices `[]` | `['confusable_name']` |

  The dry branch of `applyDefine` (`graph/tx.ts:564`) returns before `settle` (the slider clamp), before `diffReport` and before the `confusable_name` loop.
- **Invariant broken:** K5: a dry run returns the same summary, report and notices as the commit.
- **Suggested fix:** in the dry branch, clamp the computed free value with the evaluated range, add the new objects' undefined cells to `becameUndefined`, and run the `confusable_name` check; better, build the summary, notices and report in one function that both branches call.

### KERN-SM-15. Events and rollbacks: a rejected strict append is visible, and re-entrant listeners see events out of order

- **Impact:** wrong results (history and the view's picture of the figure). Status: open.
- **Evidence:**
  - a. `figure(['a = 1', 'b = 2'])`, `undo()` (redo depth 1), then `append('c = 3\nd = nope + 1', { mode: 'strict' })`: the report fails and the objects are as before, but redo depth is 0. A listener sees `add`, `remove`, `value` for `c`, which never existed. `load` (`graph/figure.ts:488`) reverts the entries but restores neither `redoStack` nor the pending queues, which `applyBatch` does.
  - b. Two listeners on `newFigure()`: the first, on `add` of `X`, calls `f.apply('Delete(X)')`; after `f.apply('X = 1')` the second sees `remove:1`, `add:1`, `value`. `deliver` (`graph/core.ts:751`) runs the nested operation's delivery to every listener inside the outer loop.
- **Invariant broken:** K13: a rejected strict load leaves both stacks and the listeners' view unchanged; K4: a listener sees events in the order the figure changed.
- **Suggested fix (group A for part a):** share one rollback helper between `applyBatch` and `load` that restores both stacks and the queue marks. For part b, make `deliver` re-entrant safely: if a delivery is running, append new events to the running queue and return; the outer loop delivers them after the current ones.

## Speed

Measured in Node 22, warm, on the scratch probe (median of three where shown). Targets are kernel design 15 and `docs/design/performance.md` 1.

| Measure | Target | Result |
|---|---|---|
| `flush`, 500 objects, 200 downstream | < 0.5 ms | 0.05 ms (0.21 ms first call) |
| Slider write plus `flush`, 5,000 objects, 2,499 downstream | (frame with 500 playing < 4 ms) | 1.3 to 1.5 ms (3.5 ms first) |
| `apply` a simple line at 5,000 objects | < 0.3 ms | 0.014 to 0.027 ms (0.13 ms first) |
| Redefine with reorder of 50 objects | < 1 ms | 0.12 to 0.35 ms |
| Delete with cascade of 201 objects | < 2 ms | 0.42 ms |
| Undo of one line, 500 objects | < 1 ms | 0.02 ms |
| Undo of one line, 5,000 objects | n/a | 0.007 to 0.38 ms (one 127 ms outlier, a GC pause) |
| `fromScript` 1,000 lines | < 100 ms | 27 to 31 ms |
| `toScript` 1,000 objects | < 20 ms | 0.65 ms (5,000 objects: 3.9 ms) |
| `fromScript` 5,000 lines | n/a | 441 ms (quadratic, KERN-SM-17) |
| `apply` of a line that touches no state, clock at `t = 100`, one state | < 0.3 ms | 6.6 ms (KERN-SM-16) |

### KERN-SM-16. Any structural change restarts the state solver from the film start

- **Impact:** speed (misses the 0.3 ms line target; grows with `t`). Status: fixed.
- **fix:** the solver compares a signature of the states, their rates and everything they read (identities and free values) after a structure change and keeps its checkpoints when it is unchanged.
- **Evidence:** `figure(['s1 = state(1)', "s1' = -s1"])`, `setClock(100)`, then `apply('q = 5')` takes 6.6 ms, and at `t = 1000` about 70 ms (K11 timings: 0.07 ms per film second). `StateSolver.rebuild` (`clock/solver.ts:87`) clears every checkpoint when `structureVersion` changes, and `wire`, `unwire` and `renumber` bump it for any object. The next `flush` (the line's own `settle`) re-integrates from `t0`. During a load into a figure whose clock is not at 0 this happens on every line.
- **Invariant broken:** K11: a change that does not touch a state, a rate or their inputs does not restart the integration.
- **Suggested fix (group E):** keep a separate solver version that changes only when the layout, the cone or the inputs change (compare the set of state ids, rate rules and cone ids after a rebuild, and keep checkpoints when equal).

### KERN-SM-17. The cost of adding an object grows with the figure, so a load is quadratic

- **Impact:** speed (targets met today; 5,000 lines take 441 ms). Status: fixed.
- **fix:** names differing by case come from a lower-case map, renumber starts at the insert or remove position, and the solver reads a maintained set of state objects instead of scanning the list (20,000-object chain builds in 0.3 s).
- **Evidence:** `fromScript` of `n` lines `v<i> = <i>`: 1,000 lines 27 ms, 2,000 84 ms, 4,000 288 ms. 200 more adds cost 14 ms on a 2,000-object figure and 24 ms on a 4,000-object one. Each add runs the `confusable_name` scan over every name with `toLowerCase` (`graph/tx.ts:591`) and `renumber(0)` over the whole list (`graph/base.ts:148`), even when appending at the end.
- **Invariant broken:** kernel design 13.2: about 100 µs per line whatever the figure size (bulk load).
- **Suggested fix:** keep a `Map<lowercase name, names>` updated on add, rename and remove; renumber only from the insert position (`renumber(pos)`).

## Wrong errors and notices

### KERN-SM-18. A listener failure in a frame is reported on the next line

- **Impact:** wrong notices. Status: open.
- **Evidence:** `figure(['a = 1 in 0..10', 'b = a + 1'])` with a listener that throws on `value` once; `setFree('a', 2, 'slider')`, `flush()`; after disarming, `apply('c = 5')` returns notices `['listener_failed']`. `deliver` counts failures from `flush` and `setClock` (`graph/core.ts:765`), and only `apply` and `applyBatch` read and reset the counter.
- **Invariant broken:** K4: a listener failure becomes a notice on the result of the operation it happened in.
- **Suggested fix:** return the count from `flush` and `setClock` in the `FrameDelta` (for example `listenerFailures`), and reset the counter at the start of each operation.

### KERN-SM-19. Exported table helpers throw on names of `Object.prototype` members

- **Impact:** wrong errors (throws across the boundary). Status: open.
- **Evidence:** `validKeysFor('constructor')` throws `TypeError: (BY_TYPE[type] ?? []) is not iterable`; `defaultsFor('constructor', true)` throws reading `slice`; `makeNotice('constructor')` throws reading `replace`. `BY_TYPE`, `DEFAULTS` (`graph/props.ts`) and `NOTICE_TABLE` (`errors/notices.ts`) are plain objects read with `[key]`; `reasonPhrase('constructor')` returns `Object` itself. The kernel calls them only with internal type names, but they are public exports. `Object.prototype` itself is never polluted (checked below).
- **Invariant broken:** K15: exported helpers never throw.
- **Suggested fix (group F):** read every exported table through `Object.hasOwn` (as `colorFromWord` and `own` already do), and fall back to the default entry.

## Cosmetic

### KERN-SM-20. A clamped slider gets two `clamped` notices

- **Impact:** cosmetic. Status: open.
- **Evidence:** `apply('a = 20 in 0..10')` returns two notices: "The value 20 is outside 0..10 and will be clamped to 10." (from the checker) and "a was moved to 10, the high end of its range." (`graph/tx.ts:617`).
- **Invariant broken:** one notice per fact.
- **Suggested fix:** drop the kernel's notice when the checker already gave one for the same name, or drop the checker's on lines the kernel commits.

---

## Categories with nothing found

- **Code execution from user text or files:** no `eval`, `new Function` or dynamic import in `packages/kernel/src/` outside `language/` (and none there); `fromScript` text goes through the parser, checker and compiler only; directives the kernel does not know are kept as text; actions run only rules the host registered.
- **Prototype pollution through names, properties or files:** objects are stored in `Map`s, so `constructor = 1`, `toString = 2` and `hasOwnProperty = 3` are plain objects; `__proto__` is `bad_character` in lines and files; `with constructor = 1` is `unknown_property`; unknown property keys are written with a computed key into a fresh `ext` object; `Object.keys(Object.prototype)` stays empty after every probe. (KERN-SM-19 is about exported lookups throwing, not pollution.)
- **Cycles and order:** the redefinition cycle test, the `a = a + 1` assignment path (the kernel re-tests the other inputs with `reaches`) and `forward_reference` on `insertAt` and `move` match K5 on reading the code and in the passing spec tests; the probed reorder of 50 objects moved exactly the 50 inputs.
- **Delete, detach and undo:** a cascade with a detached property rule (`A with opacity = a / 10`, then `Delete(a)`) and its undo restore the rule, its edges and the script exactly.
- **Rename:** rename with a reader whose `showIf` reads the renamed object, its undo, and reloading the renamed script all round-trip.
- **Slice:** read, not probed: `run` restores cells, stale flags, `t` and `bt` in `finally`, so a throwing rule cannot leave the figure changed.
- **Leaks between figures through module state:** each figure has its own `Env`, rule cache, journal and solver. The module-level tables (`registerPropertyTypes`, `registerReasonPhrase`, the language's `setMathLib`) are shared on purpose; only the registry case (KERN-SM-3) leaks unintentionally.
- **Clock fields:** `bt` and `beat` follow `setBeats`, `t` is clamped to `@clock a..b`, and a seek to the same time is a no-op (apart from the non-finite case in KERN-SM-5).
- **Deep structures other than the lazy pull:** `downOf`, `ancestorRecs`, `rootOf`, the language cycle test and `sameValue` (depth cap 8) are iterative or bounded; a 5,000-object chain builds and flushes, and a 5,000-object figure saves and reloads.
- **Error registry:** `checkErrorTable()` is clean; `err()` with an unknown kind falls back to `internal` without throwing.
