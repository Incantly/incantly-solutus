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

- **Status:** Fixed in 461156c. `OutlineCache` is keyed by the stroke's points array and also checks stride, size, nib and tolerance; the `ink` kind's `check` keeps an array it made itself (so a move or any patch to another field writes a record with the same array) and still copies an array a caller hands in (BR-10). Tests in `fixes-round2.test.ts` and the tester's `ink.test.ts` case.

- **Where:** `core/draw.ts` / the outline cache (`OutlineCache` keyed by the record).
- **What:** design 6.2 item 4 says moving or panning never rebuilds an outline; a move writes a new record, so the cache misses and rebuilds. A drag of 2,000 strokes rebuilds them all every frame.
- **Fix:** key the outline by what it is made of (the points array, its count and stride, nib and size); the shape's `x`, `y` and `rotation` only change the transform. Test: the tester's failing test in `ink.test.ts`.

#### BR-13. `touchDraws: 'always'` is refused while a pen is near

- **Status:** Fixed in 461156c. `GATE_ALWAYS_MACHINE` is `GATE_MACHINE` plus `penNear` `touchDown`; the gate takes the table from the option when it is made. B5 is updated. Tests in `fixes-round2.test.ts` and the tester's `input.test.ts` case.

- **Where:** `core/input.ts` `PointerGate`, B5.
- **What:** `penNear` has no `touchDown` row, so the option the design promises (design 6.5, B5 invariants) cannot work.
- **Fix:** the gate's table has the moves for `touchDraws: 'always'` (a touch draws in `penNear`, and while the pen is down it stays a second pointer as the design says), chosen from the option at construction. Update B5. Test: the tester's failing test in `input.test.ts`.

#### BR-14. The mode's name

- **Status:** Fixed in aa276f3. The locale files already said "Board" and "Tableau"; the two tests (`packages/modes/test/spec/modes.test.ts`, `apps/studio/test/modes.test.ts`) expect "Board", and `app-modes/ui.md`, `design.md` and `features/README.md` name the tile "Board".

- **Ruling:** the product owner calls it the board, so the mode's title is "Board" ("Tableau" in French); its id stays `notes`. Change `docs/features/app-modes/ui.md` (the tile `[ Board ]`) and the other app-modes docs that name the tile, and make the two tests that expect "Notes" expect "Board".

#### BR-15. The lasso of 2,000 strokes takes 6.4 to 7.2 ms (goal 4 ms)

- **Status:** Fixed in 461156c. `IndexGrid.queryLassoSplit` says which boxes lie wholly inside the loop (no polygon edge touches the box and a corner is inside); `mostlyInside` counts points and stops once the half is settled. Bench row: 6.95 ms before, 0.69 ms after (goal 4 ms). Tests: `mostlyInside` equals the full count on 400 random strokes and loops, and the lasso selection equals counting every point.

- **Where:** the lasso selection pass.
- **Fix:** ask the index grid for the strokes whose boxes touch the lasso's box; a stroke whose box is inside the lasso is in without a point test; a stroke whose box is outside is out; only the rest count points, stopping as soon as more than half are in or can no longer be. Bench row must meet 4 ms.

#### BR-16. A 10 s stroke makes 7 garbage collections (goal 0)

- **Status:** Fixed in 461156c. `Outliner.extend` keeps the triangles of the points that can no longer change (eight points behind the end) and makes the rest again; its arrays grow by doubling and keep their numbers. A full build allocated about 370 KB per call at 2,000 points (measured with the scavenger off); the per-point `Math.hypot` calls are replaced by a square root, the options and view objects are reused, and the work per frame no longer grows with the stroke. Bench rows: 7 collections before, 0 after; a frame while drawing 0.219 ms before, 0.008 ms after. Tests: `extend` equals `build` after every point of a stroke for every nib and both strides, after several points at a time, after a change of zoom or size, after `reset`, and for the live stroke frame by frame.

- **Where:** `core/ink/live.ts` `LiveStroke.rebuild` → `Outliner.build`.
- **Fix:** the outliner writes into buffers it keeps and grows by doubling, and the live stroke extends its outline from the last settled point instead of rebuilding the whole stroke each frame (only the last few segments, which streamlining can still move, are made again). The bench row must show 0 collections, and the outline must equal a full rebuild (test).

#### BR-17. A live stroke keeps its page after it ends

- **Status:** Fixed in ec79faf (the rule) and 461156c (the test). At `6e21a38` `end` and `cancel` already set `#page` to `null`, so `page` was `null` when idle (checked by the new test, which passes on the unchanged code); what was missing was a check that it stays so. `incantly/state-no-shadow-null` is that check: the repository lints clean with it, so no other class has the flaw. The field is now documented as data of the `drawing` state in B7.

- **Where:** `core/ink/live.ts` `#page`.
- **What:** `#page` is set on `begin` and never cleared, so `page` reports the last page while the stroke is `idle`; the field and the machine can disagree.
- **Fix:** clear it when the stroke ends or is cancelled, or hold the page in the drawing state's data. Test: `page` is `null` when idle.

### Later

- **BR-18.** The page backgrounds (`grid`, `dots`, `lines`) are not drawn yet (round 6 or with the style bar in round 4).
- **BR-19.** No key for the next or previous page (ui.md lists `mod+pagedown`, `mod+pageup`): round 4, with the custom keys.
- **BR-20.** The pen-only paths (tilt, a 0.5-only pen, the eraser end, palm rejection, pinch) have not been tried on a real stylus or touch screen.
- **BR-21.** An ink shape's `rotation` is ignored until round 3.
- **BR-22.** `incantly/state-no-shadow-null` knows a begin move by the event's name (`begin`, `start`, `down`, `open`, `enter`, `press`, `grab`, `arm`, `activate`, `engage`) and reads only `this.<machine>.send('literal')`. A machine whose first move has another name, or a send through a variable, is not checked. Reading the table's moves would make it exact.
- **BR-23.** With `touchDraws: 'always'` a finger that draws in `penNear` and lifts leaves the gate `idle`, not `penNear`; the pen is still in range but the gate forgets it until the next pen event, so the palm grace runs from the last pen sample only. Harmless in `always` mode (touch draws anyway); the pen's `hover` also cancels a finger stroke in progress (`touchDown` `penHover` row), which `always` may not want.
- **BR-24.** A stored `ink` record's `points` array is shared by every record written from it (BR-12), and a typed array cannot be frozen, so a host that writes into `record.props.points` changes the store and the history (BR-10 again, for arrays that came from the store).
- **BR-25.** `packages/modes/src/locales/ar.ts` has no `mode.notes.*` entries (nor `mode.graphing3d.*`): not checked what the Arabic tile shows.

## Round 3 (PR #134, reviewed at `b2b4a6f`)

### Fix now

#### BR-26. A cancelled drag leaves part of its work behind (new lint rule)

- **Status:** Fixed in 2d8a219.
- **Where:** `core/tools/select.ts` (the arrow end drag), and every tool that writes the store during a gesture.
- **What:** B19 says a cancel writes the originals back; the arrow comes back but the binding the drag removed does not. Each tool keeps its own list of what to put back, so a record the drag touched indirectly (a binding, a bound arrow, a grouped child) is missed.
- **Fix:** one gesture API in `core/edit.ts`: `beginGesture(origin)`, `gesture.write(fn)` (each write is merged into one undo step), `gesture.commit()`, `gesture.cancel()`. Cancel puts back every record any write of the gesture changed, from the store's own diffs, so nothing can be missed. Every tool uses it. New lint rule: in `packages/board/src/core/tools/**` a call to `.change(` is an error (`no-restricted-syntax` in `eslint.config.js`, with the message "tools write through a gesture, so a cancel puts back everything"). Test: the tester's failing binding test, and a cancel of a group drag with a bound arrow.

#### BR-27. Front and back reverse a multi-selection

- **Status:** Fixed in 2d8a219.
- **Where:** `core/edit.ts` order commands.
- **What:** `back` of [d, c] gives [c, d]; a selection keeps its own order when it moves forward or back (ruling).
- **Fix:** keep the relative order. Write it in design 7.4. Test: the tester's failing test.

#### BR-28. Default sizes come from two places

- **Status:** Fixed in 2d8a219.
- **Ruling:** a kind's default size is in its `KindDef.defaults`, and the shape tool reads it from there (design 7.2), so a host's own kind gets the same rule. Triangle and diamond 120 × 100, star 110 × 105 are fine as their defaults. Change the three tests to read the kind's defaults, and the tool to use them.

#### BR-29. Lines and arrows show only their own handles

- **Status:** Fixed in 2d8a219.
- **Ruling:** a line or an arrow alone shows only its own handles (ends, bend), as the code does; with other shapes in the selection the box with 8 handles and rotate shows. Write it in design 7.4 and ui.md, and change the two tests.

#### BR-30. The toolbar

- **Status:** Fixed in 3adf988.
- **What:** the order is not ui.md's (Hand second, Arrow before Line), and the toolbar wraps onto three rows (`round3-shapes.png`).
- **Fix:** ui.md's order; triangle, diamond and star in a "More shapes" menu on the rectangle button's group, so the toolbar stays one row on a laptop and scrolls on a phone. The studio test follows ui.md and requires the three extras in the menu. Screenshot.

#### BR-31. Text with maths is cut off at its box

- **Status:** Fixed in 3adf988.
- **Where:** the text kind's auto width (`round3-shapes.png`: "½ bh" clipped).
- **Fix:** auto width measures the laid-out maths boxes, not the source characters. Test: an auto-width text with `$\frac{1}{2}bh$` has a box at least as wide as its layout.

#### BR-32. A drawn pentagon becomes an ellipse

- **Status:** Fixed in ed7d7b1.
- **What:** the fit order (line, ellipse, polygon) makes a regular pentagon or hexagon a circle, which a teacher who drew a pentagon does not want.
- **Fix:** find corners first: a stroke with 3 to 6 clear corners (turn over 45°) is tried as a polygon before the ellipse. Update design 7.3. Test: regular pentagon and hexagon become polygons; a circle stays a circle.

#### BR-33. `IMAGE_MACHINE` is not exported

- **Status:** Fixed in 2d8a219.
- **Fix:** export it with the other tables from the package entry; the machine test imports it from there.

### Later

- **BR-34.** Image paste and the Image button's file picker were not tried in a browser; an input method (IME) was not tried in the text editor.
- **BR-35.** Tiles holding shapes are painted with Canvas 2D and uploaded; a WebGL path for shapes would be faster on big boards (measure in round 6 first).
