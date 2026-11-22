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

- **BR-18.** The page backgrounds (`grid`, `dots`, `lines`) are not drawn yet (round 6 or with the style bar in round 4). **Fixed in round 4:** drawn in each tile (`drawBackground2D`), chosen in the style bar and the page menu (`Pages.setBackground`, one undo step).
- **BR-19.** No key for the next or previous page (ui.md lists `mod+pagedown`, `mod+pageup`): round 4, with the custom keys. **Fixed in round 4:** the actions `nextPage` and `prevPage` in the key map.
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

- **BR-34.** Image paste and the Image button's file picker were not tried in a browser; an input method (IME) was not tried in the text editor. **Tried in round 6 (Chrome 158, Playwright):** a paste event with a PNG file adds an image shape; a real clipboard write (`navigator.clipboard.write`) and Ctrl+V adds one; `setInputFiles` on the Image button's input adds one; a file that is not an image says "This image could not be added." and adds nothing; typing `Café déjà vu: naïve` and `x² + 1` in the text editor keeps every accent; an IME composition (`Input.imeSetComposition`, then the committed `今日は`) ends as that text. Nothing broke, nothing to fix.
- **BR-35.** (Shapes on the GPU in d8556d7.) Tiles holding shapes are painted with Canvas 2D and uploaded; a WebGL path for shapes would be faster on big boards (measure in round 6 first). **Round 6:** measured, and it mattered for the strokes: a tile with any shape drew every stroke through Canvas 2D (116 ms a frame on average while zooming a 10,000-shape board, CPU ×4). Strokes now stay on the GPU in mixed tiles (`bench.md`). The shapes themselves (rects, text, notes) are still Canvas 2D, and are what keeps the zoom row over its goal (BR-68).
- **BR-36.** The selection bar wraps to two rows (it is placed from `left: 50%` with a translate, so its width is half the view). **Fixed in round 4:** one row that never wraps, centred as the toolbar is, and it scrolls sideways on a phone (`.ib-actions`).
- **BR-37.** A listener's own write during a gesture's transaction makes a separate diff the gesture does not keep, so a cancel will not undo it; nothing does this today.
- **BR-38** (moved to Fix now in round 4; fixed there). A live figure card in the Board app draws with the studio's frame style (axes and grid off in the Board app), because `frameStyle` in the SDK's `screen/paint.ts` is one module-wide object set by the app mode, while a card's picture (made in a headless app) draws axes and grid. A card and its picture can look different. Fix: let `createApp` take its frame style as an option, or have the picture use the same style.
- **BR-39.** Not built in round 4: the long press that opens the context menu on touch, the main menu's New, Open and Export (the host adds them through `menus.main`; Save is there), the minimap part of `ui`, and a French or Arabic catalogue for the board's strings beyond the tool names (the rest fall back to English).
- **BR-40.** The card toolbar is above the selected card only on the page the card is on and is not a real toolbar for the keyboard (Tab from the board does not reach it); the Edit lines panel and the toolbar buttons are reachable by Tab only after a click.

## Round 4 (PR #135, reviewed at `f64b465`)

### Fix now

#### BR-38. Live cards draw without axes or grid (new lint rule)

- **Status:** Fixed in 7ab2f7c (the frame style of each app) and bbb241d (`incantly/no-imported-mutation`).
- **Where:** `packages/sdk/src/screen/paint.ts` `frameStyle`, one module-wide object; `packages/sdk/src/export.ts` and the studio's app mode write into it.
- **What:** the app mode sets the page-wide style, so a card live in Board mode loses its axes and grid while its picture (made in a headless app) has them: the card changes look when it goes live (`round4-five-cards.png`). Two apps on one page share one style.
- **Fix:** the frame style belongs to each app (`MountedApp` holds its own, from its mode and `@axes`/`@grid`); `paintScene`, the grid painter and the export take it as an argument; nothing writes a module's object from outside. New rule `incantly/no-imported-mutation` in `tools/eslint-rules/`: assigning to a property of an imported binding (`x.y = …`, `x.y++`, `Object.assign(x, …)` where `x` is imported) is an error ("a module's object is shared by everyone who imports it; pass state in, or give each owner its own"), registered as 'error' for product code, with RuleTester cases. Fix whatever else it finds so the repo lints clean. Test: a live card and its picture draw the same axes and grid; two apps with different `@axes` on one page each keep their own.

#### BR-46. The live cap is broken (new lint rule)

- **Status:** Fixed in bbb241d.
- **Where:** `web/figures.ts` card layer `goLive`/`activate`; B26 has no `release` row in `mounting`.
- **What:** giving the input to a fourth card while 3 are live makes 4 (`makeRoom` returning false is ignored); a fast pan has up to 5 cards mounting, live or moving (bench). B26's invariant is at most 3.
- **Fix:** a card claims a place only when `makeRoom` says there is one; otherwise it stays a picture and the scheduler's next order decides. `mounting` gets a `release` row (the app being made is freed when it arrives). Tests: the tester's failing test and failing bench row.
- **New rule `incantly/state-refusal-reported`:** in `packages/board`, `packages/tiptap` and `tools`, `new StateMachine(...)` without the third argument (`onRefused`) is an error, so a refused move is reported, never silent (the mount-failure case of BR-47). Board machines report through the board's `onError` as `internal` with the state and event. RuleTester cases.

#### BR-47. A lost app is not noticed

- **Status:** Fixed in bbb241d.
- **Where:** `web/figures.ts`.
- **What:** a `webglcontextlost` on a card's canvas, or an app destroyed from outside, leaves the card holding a dead app; after a lost context the card is not claimed again; a script that fails at mount ends in `picture` instead of `failed` (the app is freed before `fail` is sent, and `picture` has no `fail` row).
- **Fix:** the card listens for context loss and the app's destroy, frees the app (`unmounted`), and is claimed again when the scheduler still wants it, as the Tiptap figure does; a mount failure sends `fail` before the app is freed. Tests: the tester's four failing tests.

#### BR-48. `defaultTools`

- **Status:** Fixed in bbb241d.
- **Ruling:** `defaultTools` is every built-in tool (design 10, R7.2); the round-2 six become `inkTools`. Remove `boardTools` or make it the same list; the studio and tests use `defaultTools`.

#### BR-49. String lookup order

- **Status:** Fixed in bbb241d.
- **Fix:** host strings, then the language catalogue, then the English table, then a tool's own label (design 10). Test: the tester's failing test.

#### BR-50. Key order

- **Status:** Fixed in bbb241d.
- **Fix:** a key string is written `mod+shift+alt+key` (B30). Test: the tester's failing test.

### Later

- **BR-39** and **BR-40** above (from the builder) stay on the fix-later list. BR-38 moved up to Fix now.
- **BR-51.** A card that is asked for the input while no place is free (`makeRoom` says no) keeps `inputAsked` set, so it takes the input when the scheduler later makes it live, which may be long after the user asked. Clear the ask when the order was not followed, or keep a time on it.
- **BR-52.** The default key map of the tools (`core/tools/keys.ts` `defaultMap`) is one module-level `KeyMap` with no error sink, so a refused move in it is not reported. It is only read, so no move is refused today.
- **BR-53.** The Tiptap figure keeps its app in `lost` after a lost graphics context and takes it back on `webglcontextrestored`; the board's card frees the app and claims again (BR-47). The two behave differently; pick one and write it in both designs.
- **BR-54.** A refused move of a machine is now reported as `internal`, so calls that may come in any state (cancel with nothing going on, `release` of a card with no input) ask first (`sendIfAble` in `core/machine.ts`). Other machines in `packages/view`, `packages/ui` and `packages/sdk` still make refused moves silently; the rule `state-refusal-reported` covers only `packages/board`, `packages/tiptap` and `tools`.

## Round 5 (PR #136, reviewed at `5300a3f`)

No new kind of hidden state was found in this round: the five new tables (B31 to B35) refuse moves and report refusals, and nothing shadows them. So this round adds no lint rule.

### Fix now

#### BR-55. Ink and arrows are hidden under live cards

- **Status:** Fixed in dc4916e. The cause was larger than the gap: `bindEnd` called `followArrow`, which read the bindings from the store, so the binding the same transaction had just put was not seen and an arrow the agent made with both ends stuck stayed with its ends at the shapes' middles (inside the card). `followArrow` now also takes the bindings the transaction put and skips the ones it removed. The ends stop `ARROW_GAP` (8 units) short of the outline (at most half the way). The top layer is a fourth canvas (`WebPainter.drawOverCards`) above the card layer, the live stroke and the tiles, below the overlay: the shapes above a shown card in order that touch it (`core/card-over.ts`) are drawn on it, clipped to the outline of each card they are above, so on screen nothing is drawn twice (the card hides the tile under it; no tile changes). It covers every shown card, live or picture, since both hide the tile. The live stroke canvas moved above the card layer, so a stroke shows while it grows. Tests: `fixes-round5.test.ts`, `bindings.test.ts`; bench row 0.096 ms a frame with 2,000 strokes over 3 cards. Screenshots: `round5-card-arrow.png`, `round5-fix-ink-over-card.png`, `round5-fix-ink-drawing-over-card.png`.

- **Where:** `web/figures.ts` (the card layer is a DOM layer above the board's canvas), the painter.
- **What:** the arrow from the circle to its answer card has its head under the card (`round5-card-arrow.png`); any ink, arrow or text drawn over a live card is hidden, though it is above the card in the page's order.
- **Fix:**
  1. A third canvas above the card layer (`pointer-events: none`) draws, each frame the board draws, the shapes whose order is above a card and whose box touches a live card; the tiles leave them out only where a live card covers them, so nothing is drawn twice on screen. A card's picture (not live) stays in the board's own drawing, in order.
  2. A bound arrow's end stops at its target's outline plus a gap of 8 units, so the head shows beside the card, not on it.
  - Tests: a stroke and an arrow over a live card are drawn on the top layer; one under it is not; an arrow bound to a card ends 8 units from its edge. Screenshot.

#### BR-56. The talk request drops `allowEdit: false`

- **Status:** Fixed in 1c93f1a. `TalkRequest.allowEdit` is required and `talk` always writes it; `agent-panel.test.ts` checks `allowEdit` is `false` again.

- **Fix:** the request body always has `allowEdit` (agent.md 3). Test: the tester's failing test; restore the strict check in `agent-panel.test.ts`.

#### BR-57. `'free'` misses an empty strip in view

- **Status:** Fixed in 7a2d91b. `freeSpot` takes each shape's box grown by the new box and the air as the corners that are not allowed, tries the rows at the edges of those boxes nearest the middle first, and on a row cuts the clear stretches at the corner nearest the middle; it stops when the rows left cannot beat the spot found. Tests: the tester's failing test, `place-round5.test.ts`. Bench: `'free'` with 2,000 shapes around 0.35 ms; with a view packed with 2,000 shapes (no spot, the whole search) 1.3 ms.

- **Where:** `core/agent-place.ts` `freeSpot`.
- **Fix:** search the view for the nearest spot the box fits in (scan rows and columns of the empty areas between the shapes' boxes, nearest to the view's centre first) before falling back below the view. Test: the tester's failing test. Bench row `'free'` with 2,000 shapes stays under 4 ms.

#### BR-58. A click on a toolbar button leaves an ink dot

- **Status:** Fixed in d10508d. `WebInput` takes an `accepts(target)` option; the board passes its surface and what is inside its painter (canvases, card layer), and a press that is not accepted is ignored together with its moves and its release. Not reproduced as written: the review's script clicked `[data-tool=pen]`, which matches the board's root element (it carries `data-tool` for the current tool), so the click landed on the middle of the board; a click on the real toolbar button (`.ib-tools [data-tool=pen]`), with a mouse or a pen, never reached the board, because the bars are siblings of the surface. The guard stays for anything put inside the surface. Tests: `input-round5.test.ts`. Screenshot: `round5-fix-toolbar-click.png` (a pen taps pen, rectangle, pen; the shape count stays).

- **Where:** `web/input.ts`: pointer events from the shell's buttons reach the board.
- **Fix:** the input layer takes only events whose target is the board's canvas or its card layer; events from the shell, menus, panels and bars are not board input. Test: a pointer down and up on a toolbar button with the pen chosen adds no shape.

#### BR-59. Hand-style writing is text, not ink

- **Status:** Docs only, as ruled, in `agent.md` 2 (the action list said "stored as normal ink" for `write`, the notes said text; now both say text for `write` and ink for `stroke`) and design 11.2. The code and its test (`agent-actions.test.ts`) already did this.

- **Ruling:** with no stroke font, hand-style `write` is stored as a text shape in the hand font, revealed as if written; `stroke` is stored as ink. Write this in agent.md 2 and design 11.2.

### Later

- **BR-60.** Shape fixing works one stroke at a time; a triangle drawn in three strokes is not recognised.
- **BR-61.** The `agent.vision` picture has not been tried with a model (no server yet).
- **BR-62.** A shape that is between two overlapping cards in order (above the lower, below the upper) is drawn on the top layer over both, because the clip is the union of the cards it is above; the upper card should cover it where they overlap.
- **BR-63.** For the few frames after a stroke ends, the live stroke canvas (`holding`) and the top layer both draw it over a card, so a translucent stroke is a little darker there until the tile is drawn.
- **BR-64.** The top layer's clip is the card's rectangle, but the card has rounded corners (10 px) and a shadow, so in the four corners the stroke is drawn twice (tile and top layer) for a translucent stroke.
- **BR-65.** `followArrow` still reads the bindings of the store: a binding the transaction updates (rather than puts or removes) is read from the store, so an `update` of a binding's `props` in the same transaction is not seen.

## Round 6 (the builder's measurements, not a review)

### Later

- **BR-66.** Chrome's `getCoalescedEvents()` makes garbage of its own (3 scavenges in 10 s on a blank page with a 120 Hz pen). **Round 6 fix round:** this was wrong. `getCoalescedEvents` exists only in a secure context; on `about:blank` the call was not a function and the errors thrown into the listener were the garbage. On a page served from the loopback address the browser's own garbage for a 120 Hz pen is about 90 KB in 10 s and no collection (see BR-77). Use `pointerrawupdate` where it exists (Chrome), keep `getCoalescedEvents` elsewhere, and take the predicted samples from the frame's `pointermove` as now. Not tried: the DevTools protocol makes no raw updates, so it needs a real pen or a flag that does. Part of the "0 collections over a 10 s stroke" row (4 in Chrome).
- **BR-67.** (Fixed in 6d3cb2d.) The live stroke and its tail are drawn with Canvas 2D (`fillTriangles`), and each call with a decimal argument allocates a number object: about 0.5 MB over 10 s. Draw the live layer with WebGL (opaque triangles of one colour on a canvas of its own, the stroke's opacity stays the canvas's CSS opacity, a typed array uploaded each frame) and the predicted tail with a polyline from a typed array.
- **BR-68.** (Fixed in d8556d7 and 90e926b: 5.4 to 5.5 ms.) Zooming a 10,000-shape board with 30% shapes other than strokes (rects, ellipses, text, notes) is 10.2 ms at the 95th percentile with the CPU ×4 (goal 8 ms); with strokes only 7.1 ms. Each tile that has to be drawn costs about 9 ms there (2 ms unslowed): the shapes of a run are drawn with Canvas 2D (12 calls a shape). Options: paint rects, ellipses and lines with the ink program (triangles from the geometry, cached on the record), a glyph atlas for text, or tiles of at most N shapes at low zoom.
- **BR-69.** (Fixed in 471a3e6 and 2e1ab0b.) The lasso of 2,000 strokes is 3.8 to 4.3 ms in Chrome with the CPU ×4 (goal 4 ms) and 1.14 ms in Node. The loop is a polygon of 48 points tested against every stroke's box and then its points; a box test against the loop's own box first (done) and a coarse grid of the loop's cells would cut the polygon tests.
- **BR-70.** The frame after a lasso of 2,000 strokes (outlines of every selected shape on the overlay) is 9 to 10 ms with the CPU ×4. Past a few hundred selected shapes draw their one frame and a count, not each outline.
- **BR-71.** The nib list (pen, marker, pencil) could not be shown in a screenshot: with a mouse the three nibs make strokes that look the same (their difference is how they answer pressure and tilt), and the bench's pen events through the protocol did not draw in the script that made the screenshots (they did in the Chrome bench). A pen with real pressure was not tried.

## Round 6 (PR #137, reviewed at `3ad3fb5`)

### Fix now

#### BR-72. A tile is left blank

- **Where:** `web/painter.ts`, `web/painter-gl.ts`: the round 6 tile budget and the "compose nothing when nothing changed" memo.
- **What:** in `final-background-lines.png` the tile at screen x 512 to 1024, y 48 to 560 is blank: no ruled lines, the strokes cut at its left edge, while the laser runs. A blank tile on a teacher's board is the worst visible bug the board can have.
- **Fixed in b5e7417.** Root cause: the paper layer's GPU target was made the first time a tile with paper was drawn, in the middle of that tile's frame. Making a target unbinds the framebuffer (`createTarget` ends with `bindFramebuffer(null)`), so the paper quad and every stroke of that first tile were drawn into the canvas, and the tile was resolved from an empty multisample target: fresh, counted, and blank. It happened for the first tile drawn after the paper was chosen (it needs no laser: choosing Lines on a board with strokes shows it). The layer target is now made when the GPU raster opens, never inside a frame. The failing test records which framebuffer each draw call goes to (`round6-tiles.test.ts`, BR-72). No lint rule: the cause was not a cache or memo that could disagree with what it stands for. The memo the finding suspected (`#screen`, what the tile canvas shows) is keyed on the camera, the size, the list of tiles and the number of tiles drawn, which changes with every tile drawn, and the draw list's own memos are keyed on the stored record and the scale. What is left is a hazard in the view package (BR-80).
- **Fix (as asked):** find the cause in the Chrome script that made the picture (switch the background to lines while the laser is drawing, then wait), with a failing test first. Likely places: a tile marked drawn before its draw finished or after the budget cut it; the memo of what the screen shows keyed on tile ids, not on each tile's content version. If the cause is a memo that can disagree with what it stands for, add a lint rule or a check that makes that kind of memo impossible (each cached "what is shown" keyed by a version the owner bumps), with tests. Retake the picture.

#### BR-73. Zoom with 10,000 shapes: 10.2 to 11.7 ms (goal 8 ms)

- **What:** the shapes of each tile (rects, ellipses, text, sticky notes) are drawn with Canvas 2D, about 9 ms a tile with the CPU 4 times slower.
- **Fixed in d8556d7 and 90e926b.** The view package had no path tessellator, so `packages/view/src/core/tessellate.ts` is one (flattening, a fan or ear clipping for fills, quads with round joins and caps and dashes for lines; tests in `packages/view/test/spec/tessellate.test.ts`). Every shape's paths are triangles of the same draw call as the strokes, each fill and line with its own depth; text is quads from a glyph atlas (`web/painter-atlas.ts`), so only pictures, shapes inside a frame and shapes the tessellator refuses (several contours, crossing edges) still go through a Canvas 2D layer. Stroke outlines are shared by every zoom step that gives the same triangles, meshes and draw items are kept for the last four scales, and a tile with many shapes is drawn in slices that stop at the frame's budget and go on in the next frame. Zoom row: 5.5 ms and 5.4 ms at the 95th percentile in two full runs (10.2 ms before).
- **Fix (as asked):** draw shape outlines and fills on the GPU with the view package's tessellated paths, as ink is; keep Canvas 2D only for text (from a glyph atlas if needed) and images. Chrome row must be under 8 ms at the 95th percentile on two runs.

#### BR-74. Collections over a 10 s stroke: 4 (goal 0)

- **Ruling:** the goal counts the garbage our code makes. The Chrome row subtracts a blank page's count with the same listener and `getCoalescedEvents()` (the browser's own garbage, measured in the same run), and says both numbers.
- **Partly fixed in 6d3cb2d; the row is not 0 (BR-77).** The live stroke and its predicted tail are drawn with WebGL from the outliner's typed arrays (`web/painter-live.ts`), one draw call for the stroke and one for the tail, no Canvas 2D call. `chrome-board.mjs` now subtracts a blank page's count (a page of its own, a secure context, one listener that calls `getCoalescedEvents()`) and prints both. Over a 10 s stroke the board's page still makes 3 collections (1 scavenge and 2 major in the full runs, 4 scavenges when the row is run alone) and the blank page 0, so the row reads 3. Where the garbage comes from is in BR-77.
- **Fix (as asked):** draw the live stroke and its predicted tail with WebGL from the stroke's typed arrays, so no Canvas 2D call makes a number object. The row must show 0 after the subtraction, on two runs.

#### BR-75. Lasso of 2,000 strokes: 3.8 to 4.3 ms (goal 4 ms)

- **Fixed in 471a3e6 and 2e1ab0b.** A grid of 16 by 16 cells over the loop's own box answers most strokes (in cells no edge of the loop touches, so wholly inside or wholly outside) with a few lookups, and only strokes near the loop's line are tested edge by edge; the ids of a lasso with no groups are the selection, without a copy or a second look-up of each shape. The row is now the slowest of four runs, not the best: 2.6 ms and 3.3 ms in two full runs, each of the four runs under 4 ms. The frame after the lasso (outlines of 2,000 selected shapes on the overlay) is still 7 to 9 ms (BR-70, not part of this finding).
- **Fix (as asked):** do only the selection on pointer up (outlines of the selected shapes drawn on the next frame from cached geometry); the row must be under 4 ms on every one of four runs.

#### BR-76. Two gallery pictures do not show their feature

- **Fixed in fc5309d.** The three pictures were retaken (`final-card-takes-input.png` with the point A dragged up and to the right, `final-three-live-cards-with-pictures.png` with a green "live" and a grey "picture" tag over each card, put there by the script, and `final-background-lines.png` after BR-72), all 33 `final-*.png` were opened and compared with `screens/README.md`, and the README rows of the three pictures were rewritten. The other 30 match their rows.
- **Fix (as asked):** retake `final-card-takes-input.png` with point A dragged to a new place, and `final-three-live-cards-with-pictures.png` with a caption overlay in the shot ("live" / "picture" over each card, added by the script, not the product), and `final-background-lines.png` after BR-72. Check all 33 pictures by eye after the retakes and keep README.md matching.

### Later

- **BR-77.** Garbage while drawing: 3 collections over a 10 s stroke with the CPU ×4 (a blank page makes none). The sampling heap profile of the stroke (about 2 MB; the browser's own share for a 120 Hz pen is about 90 KB) shows, in order: `getPredictedEvents()` for every pointer move (about 0.4 MB, and one collection: without it the row reads 3 instead of 4), the outliner's scratch arrays growing for each stroke (0.4 MB of typed arrays), numbers read from pointer events and the sample objects (`input.ts` `#move` and `#fill`, `ink/samples.ts` `add`, `ink/hold.ts` `move`: about 0.6 MB), the frame loop (`render` in `board-view.ts`, `core.camera` making a `Result` on every read, `tick`: about 0.4 MB) and the live layer's calls. Running Chrome with every function optimised changes none of it, so these are real allocations, not boxed numbers of slow code. Ideas: ask for the predicted events once a frame, or extrapolate them; keep one outliner and its arrays for every stroke; read the camera without a `Result`; fix the order of the remaining sites with the heap profile (`chrome-board.mjs --rows gc --profile`).
- **BR-78.** The tile cache holds 64 MB, about 61 tiles, and a fit view of the 10,000-shape board needs 62 at the steady step, so a zoom out and in again draws the tiles of the fit view again (195 tile draws for three cycles of the zoom row). A cap in tiles that grows with the view, or a cap that is at least a view and a half, would stop it.
- **BR-79.** Text from the glyph atlas is a picture of the text at the zoom step: upright text sits on whole device pixels, and turned text is smoothed, where Canvas 2D drew vector text. No picture of the gallery shows a difference, but a turned text shape at a high zoom is a little softer than it was.
- **BR-80.** `WebGL2Backend.createTarget` (and `createArena`) leave `FRAMEBUFFER` unbound and the texture unit changed, so a target made while a frame is open breaks that frame: the cause of BR-72. The board now makes all its targets before any frame, but the back-end should restore what it found.
- **BR-81.** `chrome-board.mjs` `--profile` and the screenshots' scripts are not in the repository (the screenshots' scripts are run from outside, as the README says); a gallery script that rebuilds the 33 pictures would let the next round retake any of them.

## Fix round: drag and garbage (branch `fix/board-drag-gc`)

- **BR-77, partly fixed.** Script garbage over a 10 s stroke went from about 2 MB to about 0.7 MB (the browser's own share is about 0.09 MB). The row reads 2 in the full run (0 scavenges, 2 major collections) and 1 to 2 scavenges when it runs alone (it was 3 to 5). What was done: the tail is guessed by `core/ink/predict.ts` `Predictor` from the samples and `getPredictedEvents()` is no longer called; lists filled every frame keep their storage (`painter.ts` shown tiles and items, `TileCache.visible`, the lift lists, the figure cards on show), because `length = 0` drops an array's storage and the next push makes new storage (new lint rule `no-length-reset`, board only for now, BR-84); numbers no longer go as arguments to hot calls that may not be inlined (the outliner's `#vertex` and `#arc` take them from a scratch `Float64Array`, `#smooth`, `#widths`, `#strokeOf` and `#dot` read the size and tolerance from fields, `PointBuffer.reserve` lets the sampler write points itself, `HoldWatch.move` and `Predictor.push` take the sample whole, the live layer's uniforms go in through kept `Float32Array`s, `endFrame` reads the camera itself); no `Math.hypot` in the pen's path; `StateMachine.is` takes up to four states and makes no array; `core.camera` reads the camera without a `Result`; `Pages.get` makes no closure; an unchanged view answers `visible` from its last tiles; `selectionView`, `overCardItems` and the hand's frame are not called when there is nothing to show; the live stroke's arrays hold a ten-second stroke and every outliner array grows four times over; the pen's code runs once on a throwaway stroke 400 ms after the board opens (`web/warm-ink.ts`). What is left, and why: the scavenges that remain come early in the stroke and stop once the engine has optimised the outline code (with a 5 s or 10 s warm-up stroke, or after the pen row in the full run, there is none). Chrome's first tiers keep every number on the heap, and the bench's 2 s warm-up does not run the code long enough at 4× slower. The 2 major collections come about 8 s after the bench's forced collection (`HeapProfiler.collectGarbage`), back to back: V8's memory reducer. Measured with the new `chrome-board.mjs` options `--gcdetail` (when each collection comes and the heap before and after), `--usage` (script, Blink and array-buffer growth from `Runtime.getHeapUsage`, on the board's page and the blank one), `--track` (the allocation tracker), `--gcpage bare` (the board alone, without the studio) and `--alloc`. A calibration on a blank page: plain script garbage of 1 KB a frame makes no scavenge in 10 s, 2 KB makes 1, 4 KB makes 2. Ideas left: a longer warm-up in the bench, or measuring after it; the outline of a stored stroke built once instead of again at commit (when the tile's tolerance is the live one's).
- **BR-82, fixed.** Moved shapes and pictures lag and seem to fall apart while dragged; whole again when the drag stops (the product owner's report). Cause: every move marked the tiles under the shape stale, before and after, and drew them again a few a frame within the 4 ms budget; the tiles not drawn yet showed the shape where it had been, and a tile being drawn in slices was started again at every move, so a busy tile was never done while the drag went on. Fix: `core/lift.ts` `Lift` (B36). A person's gesture holds the shapes it writes; the tiles leave them out (`DrawList.plan(box, scale, leave)`, `diffRegions(…, leave)`), the overlay draws them each frame (`WebPainter.drawItems`), and when the gesture ends they settle: drawn again into their tiles, and drawn over the tiles not drawn yet (`drawItems(items, clip)`) until those tiles hold them. A tile being drawn in slices is started again only when a change meets it. Chrome, CPU ×4, 2,000 strokes under a rectangle and a picture shaken for 3 s: frame script 2.3 ms to 0.4 ms mean, no tile drawn after the first move (`packages/board/bench/chrome-drag.mjs`, which also films the drag and counts frames with a ghost or a missing part). Trade-off: a moved shape is drawn above the others until the drag ends. 9 spec tests (`drag-lift.test.ts`).
- **BR-83, fixed.** Strokes in redrawn tiles look frayed: parts of strokes are missing in the tiles drawn again during a drag, at a 2× pixel ratio. Cause: `WebGL2Backend.beginFrame` cleared the target with whatever depth mask the last draw left, and a draw with `depthWrite: false` (a quad laid over a tile, a see-through face) leaves it off, so the clear kept the depth of the last tile drawn into the shared target and the next tile's strokes failed the depth test where the last one had strokes. Fix: `beginFrame` sets the depth and colour masks before it clears; `blitToCanvas` and the live layer's clear set the colour mask. New lint rule `gl-clear-masks`: a `clear` of the depth or colour buffer must follow `depthMask(true)` or `colorMask(true, true, true, true)` in the same function. 1 spec test in the view package (`clear-masks.test.ts`), which fails without the fix.
- **BR-84, fix later (other areas).** `no-length-reset` finds lists emptied with `length = 0` and filled again with `push` in 16 files of other areas: `kernel` (physics drivers and worlds, cloth, fluids, history journal), `sdk` (events, screen paint), `view` (scene, surface), `ui` (tools engine), `modes` (exam) and `apps/studio` (tools UI). Each makes new storage at every refill; the physics ones run every step. The rule is on for `packages/board` only; turn it on for each area as it is fixed.
