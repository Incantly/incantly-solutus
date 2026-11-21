# Findings: the board

One review round per build round (Opus 5.5). **Fix now** is fixed by that round's fixer; **Later** is the fix-later list. Every new kind of hidden state found here also becomes a lint rule in `tools/eslint-rules/` with tests.

## Round 1 (PR #132, reviewed at `15c062f`)

### Fix now

#### BR-1. A state table that refuses nothing (new lint rule)

- **Status:** Fixed in 911f375.
- **Where:** `packages/board/src/core/pages.ts` `PAGES_MACHINE`; the same flaw in `packages/ui/src/line-editor.ts` `ERROR_MACHINE` and `packages/kernel/src/physics/grid-life.ts` `GRID_MACHINE`.
- **What:** every row of `PAGES_MACHINE` is the same map (`ANY`), so every move is allowed and the state is only a copy of the page count; the count and the state can disagree, and the table guards nothing. `ERROR_MACHINE` (every row identical) and `GRID_MACHINE` (both rows identical) are the same.
- **Fix:**
  1. New rule `incantly/state-table-refuses`: a `*_MACHINE` table whose rows are all the same identifier, or all object literals with the same events and targets, is an error ("a table that refuses nothing is a value: derive it, or write only the moves that may happen"). Tests: accepted and refused tables.
  2. Pages: drop `PAGES_MACHINE`; `Pages.state` is derived from the count (`empty`, `single`, `several`, `full`) each time it is read. Update `docs/state-machines.md` B3 and the machine tests.
  3. `ERROR_MACHINE`: `type` only from `quiet` and `error` back to `typing` (and `typing` to itself), `settleQuiet`/`settleError` only from `typing`, `fail` from any state. Keep the line editor's behaviour; its tests must still pass.
  4. `GRID_MACHINE`: `running: { blowUp: 'unstable' }`, `unstable: { reset: 'running' }`; a checkpoint load uses explicit `loadRunning`/`loadUnstable` events that every state accepts only if the rule allows that, else read the saved state and send `blowUp` or `reset` only when it differs. Films must not change: run the physics tests.

#### BR-2. A board over a lowered page limit does not open

- **Status:** Fixed in 31efb55.
- **Where:** `core/file.ts` `loadBoard` through `Store.change` limits.
- **What:** `loadBoard(text, { limits: { pages: 2 } })` on a 3-page file returns `limit`. `docs/state-machines.md` B3 says the board opens as `full` and the next add is refused. A host that lowers a limit must not lose a user's board.
- **Fix:** the load transaction does not test limits (a `ChangeOptions` flag used only by load); every later write tests them as now. Test: the tester's failing test in `file.test.ts`.

#### BR-3. `duplicatePage` refuses a page holding an unknown kind

- **Status:** Fixed in 31efb55.
- **Where:** `core/pages.ts` `duplicatePage`.
- **What:** returns `kind_unknown`; `errors.md` and design 12 say a record of an unknown kind is kept as it is, so a newer board loses nothing in an older app.
- **Fix:** the copy keeps unknown shapes unchanged (`allowUnknownKinds`, as undo does). Test: the tester's failing test.

#### BR-4. Copied records share their props

- **Status:** Fixed in 31efb55.
- **Where:** `core/pages.ts` `duplicatePage` (and any later copy, such as paste in round 3).
- **What:** copies share `props` objects and typed arrays with the originals. Round 2 grows a live stroke's points; one in-place write would change both pages and the undo history.
- **Fix:** a `copyProps` helper (deep copy of plain data and typed arrays) used by every copy; store records are frozen on write (shallow `Object.freeze` of the record and of `props`). Design 4 gets one line: "props are never written in place; a change writes a new record". Test: change a duplicated page's shape points in a new record; the original stays the same.

#### BR-5. A record that fails its check alone loses the whole board

- **Status:** Fixed in 31efb55.
- **Where:** `core/file.ts` load.
- **What:** `errors.md` (`board_invalid`) says a record that fails alone is kept raw and drawn as a grey box when the rest is good; the load returns `board_invalid` for the whole file.
- **Fix:** a shape whose props fail its kind's check, on a page that exists, is kept as it was with a `meta.invalid` note (the field and why), the load succeeds with a notice `record_kept_raw` naming the records, and the record is saved back unchanged. A broken page, camera or binding still fails the load. Add `record_kept_raw` to `errors.md`. Test.

#### BR-6. Two doc gaps the tests had to guess

- **Status:** Fixed in 31efb55.
- **Ruling:** a newer file whose records fail the checks gives `board_too_new` (the version is the reason the reader can act on). `Tx.update` that changes a record's id is refused with `bad_argument`. Write both in `errors.md`, make the code do it, and tighten the two tests that accepted either outcome.

#### BR-7. The error shape

- **Status:** Fixed in 31efb55.
- **Ruling:** the board's errors use the SDK's and Tiptap's shape `{ ok: false, kind, message, hint?, detail? }`, not the kernel's line error (it has no line or column). Write this in `errors.md` and design 4. No code change.

### Later

- **BR-8.** The Chrome bench with the CPU 4× slower and the zero-garbage row (design 13) wait for round 6, with the painter.
- **BR-9.** A shape the load kept raw stays raw through `Tx.update` and through undo and redo (the mark is the stored record object), but a host that builds a new record by hand (`{ ...s, x: 1 }`) and calls `Tx.put` with it gets `record_invalid` while its props still fail the kind. Decide whether `put` of a record whose props are the same as a kept-raw record's keeps it raw.
- **BR-10.** (Round 2: the `ink` kind's `check` copies the points, and the live stroke writes into its own buffer and commits a fresh record; kept open for other kinds with typed arrays.) Freezing is shallow: a typed array inside `props` (ink points) and the objects inside `meta` are shared with the caller, and a typed array cannot be frozen. A caller that keeps its `Float32Array` and writes into it after `put` changes the stored record and the history. Round 2 grows a live stroke's points: the live stroke should write into its own buffer and `put` a copy, or `put` should copy typed arrays.
- **BR-11.** `meta.invalid` is reserved on a kept-raw shape: a host's own `meta.invalid` on such a shape is replaced by the note on load, and the saved file has the note removed, so the host's value is lost. Move the note to a field of its own, or keep the host's value under another key.

## Round 2 (PR #133, reviewed at `11ba2cb`)

### Fix now

#### BR-12. Moving a stroke rebuilds its outline

- **Where:** `core/draw.ts` / the outline cache (`OutlineCache` keyed by the record).
- **What:** design 6.2 item 4 says moving or panning never rebuilds an outline; a move writes a new record, so the cache misses and rebuilds. A drag of 2,000 strokes rebuilds them all every frame.
- **Fix:** key the outline by what it is made of (the points array, its count and stride, nib and size); the shape's `x`, `y` and `rotation` only change the transform. Test: the tester's failing test in `ink.test.ts`.

#### BR-13. `touchDraws: 'always'` is refused while a pen is near

- **Where:** `core/input.ts` `PointerGate`, B5.
- **What:** `penNear` has no `touchDown` row, so the option the design promises (design 6.5, B5 invariants) cannot work.
- **Fix:** the gate's table has the moves for `touchDraws: 'always'` (a touch draws in `penNear`, and while the pen is down it stays a second pointer as the design says), chosen from the option at construction. Update B5. Test: the tester's failing test in `input.test.ts`.

#### BR-14. The mode's name

- **Ruling:** the product owner calls it the board, so the mode's title is "Board" ("Tableau" in French); its id stays `notes`. Change `docs/features/app-modes/ui.md` (the tile `[ Board ]`) and the other app-modes docs that name the tile, and make the two tests that expect "Notes" expect "Board".

#### BR-15. The lasso of 2,000 strokes takes 6.4 to 7.2 ms (goal 4 ms)

- **Where:** the lasso selection pass.
- **Fix:** ask the index grid for the strokes whose boxes touch the lasso's box; a stroke whose box is inside the lasso is in without a point test; a stroke whose box is outside is out; only the rest count points, stopping as soon as more than half are in or can no longer be. Bench row must meet 4 ms.

#### BR-16. A 10 s stroke makes 7 garbage collections (goal 0)

- **Where:** `core/ink/live.ts` `LiveStroke.rebuild` → `Outliner.build`.
- **Fix:** the outliner writes into buffers it keeps and grows by doubling, and the live stroke extends its outline from the last settled point instead of rebuilding the whole stroke each frame (only the last few segments, which streamlining can still move, are made again). The bench row must show 0 collections, and the outline must equal a full rebuild (test).

#### BR-17. A live stroke keeps its page after it ends

- **Where:** `core/ink/live.ts` `#page`.
- **What:** `#page` is set on `begin` and never cleared, so `page` reports the last page while the stroke is `idle`; the field and the machine can disagree.
- **Fix:** clear it when the stroke ends or is cancelled, or hold the page in the drawing state's data. Test: `page` is `null` when idle.

### Later

- **BR-18.** The page backgrounds (`grid`, `dots`, `lines`) are not drawn yet (round 6 or with the style bar in round 4).
- **BR-19.** No key for the next or previous page (ui.md lists `mod+pagedown`, `mod+pageup`): round 4, with the custom keys.
- **BR-20.** The pen-only paths (tilt, a 0.5-only pen, the eraser end, palm rejection, pinch) have not been tried on a real stylus or touch screen.
- **BR-21.** An ink shape's `rotation` is ignored until round 3.
