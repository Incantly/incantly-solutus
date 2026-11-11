# Kernel area: studio notes

Branch `feat/kernel`. Step 9 (studio builder). Uses only the public API of `@incantly/kernel` (`packages/kernel/src/index.ts`). Builds on the language screen (`handoff/language/studio-notes.md`): same Web Components, same page, no new dependency.

## What was built

| Where | What |
|---|---|
| `apps/studio/src/session.ts` | `KernelSession` replaces `ScratchSession`. It owns one kernel `Figure` and turns it into rows and action outcomes. |
| `apps/studio/src/commands.ts` | Stand-in commands with real kernel rules (`Midpoint` with `invert`, `Distance`, `Segment`, `Circle`, `Line`, `Intersect`). Replaces `sample-commands.ts`. The geometry area supplies the real table. |
| `apps/studio/src/studio-page.ts`, `page.css` | The screen: toolbar (Undo, Redo, Load example), rename and delete bar, error card, status line, line list, input, figure placeholder, clock, script panel. |
| `packages/ui/src/line-list.ts` | Rows gained a free marker, a pinned marker, a related marker, a control (field, checkbox or slider), Rename and Delete buttons, and the keys F2 and Delete. |
| `packages/ui/src/error-card.ts` | `<incantly-error-card>`: one unified error object away from the input line. |

### Figure and lines
- The figure is `new Figure({ commands })`. The editor checks against `figure.view`; Enter calls `figure.apply`. A failing line changes nothing and the editor shows the error under the input as before.
- The screen follows the kernel through `figure.on(...)`: any event refreshes the rows, the undo buttons and the clock.
- "Load example" is one `applyBatch(..., { mode: 'independent' })`, so it is one undo step ("Undo: Load example").

### Line list
- Each row: definition, type chip, a `free` chip for free objects, a `pinned` chip for `fixed` objects, and the value when it adds something. A free object prints as its current value (as `toScript` does), so an edit in place shows in the definition.
- Undefined rows show the reason in words and the `cause` chain: nearest undefined input first, root last, from each cell's `cause` link, checked against `rootCause`. Each name is a button that moves focus to that row.
- Free `Number` and `Point`: a text field. Edit and press Enter (or leave the field); Esc restores. Free `Bool`: a checkbox. A free `Number` with a range: a slider (arrows, Home/End, PageUp/PageDown natively; Shift+arrow moves ten steps).
- A plain value of the object's type goes through `setFree(..., 'api')`, one undo step. Any other text goes through `apply("name = text")`, so the language's own error (for example `type_change`) shows.
- A slider drag calls `setFree(..., 'slider')` on each move and `commitDrag()` on release: one undo step. After each write the session calls `flush()`.
- Controls are reused when a row updates, so focus and an in-progress drag survive a refresh. The field being edited keeps its text.
- Roving tab stop: a row's buttons and field are tab stops only while that row is the current one.

### Undo and redo
- Buttons and Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z. The Undo button's name and tooltip come from `undoInfo().next` ("Undo: A = (1, 2)"); both buttons are disabled when there is nothing to do. The status line says "Undid: ...". In the input field, Ctrl/Cmd+Z stays the field's own while it has text.
- `undoInfo()` has no label for redo, so the Redo button names the number of steps.

### Rename and delete
- Rename: the button or F2 on a row opens a bar with a field pre-filled with the name. Enter renames; `name_taken` shows in the error card and marks the other object in the list. Esc cancels.
- Delete: the button or the Delete key on a row. The session reads `deletePlan`. A leaf is deleted at once (`ui.md` section 1: no confirm for a leaf); Undo brings it back. When it cascades, the bar says "Deleting A also removes M, N." with "Delete 3 objects" and "Cancel" (focus on Cancel; Esc cancels).

### Errors
- Errors from rename, delete, in-place writes, undo and script loading appear in the error card: "!" glyph and message, hint, the `cause` chain, "Related:" buttons for `related` and `path` names, "Try:" buttons for `suggest`. A suggestion is put in the input and is not run. The card is a polite live region and never a dialog. `card.technical = true` prefixes the kind and code.
- `related` and `path` names are marked in the list with a "related" chip, a left border and the row's accessible name, so colour is not the only cue. A submit error from the input line marks them too.
- Notices from an accepted action (for example `dependents_removed`) are joined to the status line. Solver warnings from `takeWarnings()` are shown there as well.

### Save and load
- "Script (save and load)" panel. Save fills the text box with `toScript()` and downloads `figure.inc` where `URL.createObjectURL` exists. Load calls `Figure.fromScript` (lenient) from the box or a chosen file, replaces the figure, rebinds the editor and clears the undo history. The report says "Loaded N of M lines." (the `@fig` header counts as a line) and lists each problem as `line N: message hint`. A script with no usable line, or a `version` error, keeps the current figure.

### Clock
- Shown only when some object reads `t`: a definition that mentions `t`, `bt` or `beat` and a `slice('t', id)` with a non-empty chain. Play/Pause (a button with `aria-pressed`), "Back to start", a time slider when `@clock a..b` is finite, and a `t = 1.5 s` readout. Play uses `requestAnimationFrame` (injectable for tests) and calls `setClock`; it stops at the end of a finite range. The editor is not re-checked on every frame while playing.

### Keyboard and screen reader
- `ui.md` section 1 keys: Up/Down, Home/End, Enter edit, F2 rename, Delete remove, Ctrl/Cmd+Z. Every control has a name (`Rename B`, `Value of P`, `a, slider`, `Time`, `Undo: ...`). Row names say free and pinned. `/` still focuses the input. The keyboard table on the page lists the new keys.

## What waits for later areas

- **Drawing, dragging in the figure, selection, hover, the ghost.** No renderer. The placeholder says so; the preview line still says what a line would draw.
- **Real commands.** `commands.ts` is a stand-in. The studio should take the table from the SDK once it exists. The editor's completion and signature help read these specs.
- **Visibility marbles, hidden-by-condition, layers, `aux` handling, Space to toggle visible**: need the properties panel and the renderer. Rows show `pinned` only.
- **Reorder by drag** (`move`, `movePlan`), **insert at** (`insertAt`), **step list and reveal cursor** (`steps`, `stepTo`), **dragPlan/drag**, **properties panel**, **Show/Hide/Describe actions' UI**: not part of this pass.
- **Toasts with auto-dismiss and a stack, flash on undo, fade-in.** Outcomes go to one status line that is replaced by the next action.
- **Row-level Undo on the cascade notice** (the Undo button does it).
- **Multi-line quick fixes as one undo step.** The input line still applies pasted lines one by one through `onSubmitLine`; a batch needs the editor to hand over all lines at once.
- **`problems()` display.** `missing_rate` for a state without a rate is not shown; it needs the states UI.
- **Load report actions**: a per-problem "fix" button and jump-to-line in an editor view. Problems are listed as text; the person edits the box and loads again.
- **Worker hosting.** The figure runs on the page thread.

## Things the next agent should know

- `apps/studio/test/` is not in the root `tsconfig.json` `include`, so `npx tsc -p tsconfig.json` does not type-check it. It was checked once with a temporary config that includes `apps/*/test` (clean). Adding `"apps/*/test"` to `include` is a one-line change outside this step's files.
- `@incantly/ui` and `@incantly/studio` still import `@incantly/kernel` without listing it in `package.json` (lockfile is outside this step).
- `valueText` prints `-1` with a hyphen; the list shows it as the kernel does.
- A `Figure` write (`setFree`) does not update dependents until `flush()`; `KernelSession` calls it after each write.
- `mountStudio` returns `dispose()`, which removes the page-wide key handler. Tests call it.

## Checks

`npx eslint .`, `npx tsc -p tsconfig.json` and `npx vitest run` pass (3,480 tests: the 3,450 before plus 30 new). `npx vite build` in `apps/studio` builds (about 339 kB, 108 kB gzip). New tests: 14 session and 12 page tests in `apps/studio/test/studio.test.ts` (replacing the 6 scratch-session tests), 6 line-list control tests in `packages/ui/test/line-list.test.ts`, and 4 in `packages/ui/test/error-card.test.ts`.
