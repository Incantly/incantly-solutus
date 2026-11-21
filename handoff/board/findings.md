# Findings: the board

One review round per build round (Opus 5.5). **Fix now** is fixed by that round's fixer; **Later** is the fix-later list. Every new kind of hidden state found here also becomes a lint rule in `tools/eslint-rules/` with tests.

## Round 1 (PR #132, reviewed at `15c062f`)

### Fix now

#### BR-1. A state table that refuses nothing (new lint rule)

- **Where:** `packages/board/src/core/pages.ts` `PAGES_MACHINE`; the same flaw in `packages/ui/src/line-editor.ts` `ERROR_MACHINE` and `packages/kernel/src/physics/grid-life.ts` `GRID_MACHINE`.
- **What:** every row of `PAGES_MACHINE` is the same map (`ANY`), so every move is allowed and the state is only a copy of the page count; the count and the state can disagree, and the table guards nothing. `ERROR_MACHINE` (every row identical) and `GRID_MACHINE` (both rows identical) are the same.
- **Fix:**
  1. New rule `incantly/state-table-refuses`: a `*_MACHINE` table whose rows are all the same identifier, or all object literals with the same events and targets, is an error ("a table that refuses nothing is a value: derive it, or write only the moves that may happen"). Tests: accepted and refused tables.
  2. Pages: drop `PAGES_MACHINE`; `Pages.state` is derived from the count (`empty`, `single`, `several`, `full`) each time it is read. Update `docs/state-machines.md` B3 and the machine tests.
  3. `ERROR_MACHINE`: `type` only from `quiet` and `error` back to `typing` (and `typing` to itself), `settleQuiet`/`settleError` only from `typing`, `fail` from any state. Keep the line editor's behaviour; its tests must still pass.
  4. `GRID_MACHINE`: `running: { blowUp: 'unstable' }`, `unstable: { reset: 'running' }`; a checkpoint load uses explicit `loadRunning`/`loadUnstable` events that every state accepts only if the rule allows that, else read the saved state and send `blowUp` or `reset` only when it differs. Films must not change: run the physics tests.

#### BR-2. A board over a lowered page limit does not open

- **Where:** `core/file.ts` `loadBoard` through `Store.change` limits.
- **What:** `loadBoard(text, { limits: { pages: 2 } })` on a 3-page file returns `limit`. `docs/state-machines.md` B3 says the board opens as `full` and the next add is refused. A host that lowers a limit must not lose a user's board.
- **Fix:** the load transaction does not test limits (a `ChangeOptions` flag used only by load); every later write tests them as now. Test: the tester's failing test in `file.test.ts`.

#### BR-3. `duplicatePage` refuses a page holding an unknown kind

- **Where:** `core/pages.ts` `duplicatePage`.
- **What:** returns `kind_unknown`; `errors.md` and design 12 say a record of an unknown kind is kept as it is, so a newer board loses nothing in an older app.
- **Fix:** the copy keeps unknown shapes unchanged (`allowUnknownKinds`, as undo does). Test: the tester's failing test.

#### BR-4. Copied records share their props

- **Where:** `core/pages.ts` `duplicatePage` (and any later copy, such as paste in round 3).
- **What:** copies share `props` objects and typed arrays with the originals. Round 2 grows a live stroke's points; one in-place write would change both pages and the undo history.
- **Fix:** a `copyProps` helper (deep copy of plain data and typed arrays) used by every copy; store records are frozen on write (shallow `Object.freeze` of the record and of `props`). Design 4 gets one line: "props are never written in place; a change writes a new record". Test: change a duplicated page's shape points in a new record; the original stays the same.

#### BR-5. A record that fails its check alone loses the whole board

- **Where:** `core/file.ts` load.
- **What:** `errors.md` (`board_invalid`) says a record that fails alone is kept raw and drawn as a grey box when the rest is good; the load returns `board_invalid` for the whole file.
- **Fix:** a shape whose props fail its kind's check, on a page that exists, is kept as it was with a `meta.invalid` note (the field and why), the load succeeds with a notice `record_kept_raw` naming the records, and the record is saved back unchanged. A broken page, camera or binding still fails the load. Add `record_kept_raw` to `errors.md`. Test.

#### BR-6. Two doc gaps the tests had to guess

- **Ruling:** a newer file whose records fail the checks gives `board_too_new` (the version is the reason the reader can act on). `Tx.update` that changes a record's id is refused with `bad_argument`. Write both in `errors.md`, make the code do it, and tighten the two tests that accepted either outcome.

#### BR-7. The error shape

- **Ruling:** the board's errors use the SDK's and Tiptap's shape `{ ok: false, kind, message, hint?, detail? }`, not the kernel's line error (it has no line or column). Write this in `errors.md` and design 4. No code change.

### Later

- **BR-8.** The Chrome bench with the CPU 4× slower and the zero-garbage row (design 13) wait for round 6, with the painter.
