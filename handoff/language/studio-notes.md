# Language area: studio notes

Branch `feat/language`. Step 9 (studio builder). Uses only the public API of `@incantly/kernel` (`packages/kernel/src/index.ts`); nothing from `packages/kernel/src/language/` internals.

## What was built

Plain TypeScript Web Components with shadow DOM, no framework, no new dependency. Light and dark themes through CSS custom properties (`--inc-*`).

| Where | What |
|---|---|
| `packages/ui/src/line-editor.ts` | `<incantly-line-editor>`: the line editor of `docs/features/language/ui.md` |
| `packages/ui/src/line-list.ts` | `<incantly-line-list>`: the list of accepted lines |
| `packages/ui/src/text.ts` | Pure helpers: logical-line offsets, `speak` (operators in words), `typeset`, form parsing, placeholders, reason codes in words |
| `packages/ui/src/highlight.ts` | Tokens to coloured runs, bracket matching and boxing, definition-target rule |
| `packages/ui/src/styles.ts` | Light and dark palettes (every text colour is at least 4.5:1, tested) and the CSS |
| `apps/studio/src/session.ts` | `ScratchSession`: the language's `ScratchFigure` plus the bookkeeping the list needs (not a kernel) |
| `apps/studio/src/sample-commands.ts` | Five sample commands so completion and signature help have something to show |
| `apps/studio/src/studio-page.ts`, `main.ts`, `page.css` | The screen: line list, input, figure placeholder, keyboard help |

### Line editor (`ui.md` sections 1 to 5, 8, 10, 11)

- A `<textarea>` over a mirror `<pre>` that holds the coloured runs. The text the learner sees is the saved text.
- Colouring from `tokenize(text, figure)`: all classes in section 2, command in bold, comment in italic, matched bracket pair boxed when the caret touches one, unmatched brackets and bad characters wavy-red at once, unknown names wavy-red after the pause. A name on the left of the first `=` is not shown as unknown.
- Live checking with `preview`: preview after 100 ms, errors after 400 ms or Enter. Incomplete input (`incomplete: true`) shows `expects: …` and never an error.
- Error strip: message, hint, `more` errors, form chips (click replaces the call's arguments with that form's placeholders, first one selected), a `fix` button labelled with the changed text, `quickFixes` buttons, up to 3 `suggest` lines as buttons. A fix changes the field only; Enter then submits. The gutter marker (`✗`) and `aria-invalid` are set with the squiggle.
- Completion with `complete`: opens after 2 letters (1 after `.` or `@`) and on Ctrl+Space; up to 8 rows visible; icon plus kind word; Up/Down, Enter or Tab accept, Esc closes. Accepting a command fills placeholders with the latest object whose type fits each parameter (no object reused), selects the first, Tab and Shift+Tab step.
- Signature help with `signatureHelp`: forms for the command at the caret, the active form bold, the current parameter underlined, forms contradicted by typed arguments hidden. Ctrl+Shift+Space shows it again after Esc.
- Submit: the host sets `onSubmitLine(line, {index, total})`. Pasted lines run in order. A failing line stops the run, the field keeps that line and the rest, selects `col..endCol`, and the strip shows the error at once.
- History (Up/Down in an empty or unchanged field, 200 entries, `editor.lines` get/set for the host to save), auto-close and step-over for `( [ "`, Backspace removes an empty pair, Ctrl+/ toggles `#`, superscript digits become `^n`, Esc closes completion, then clears the strip, then asks before clearing the field.
- Accessibility: textarea has `aria-multiline`, `aria-autocomplete="list"`, `aria-controls` to the listbox, `aria-activedescendant`, `aria-describedby` to the strip. A separate visually hidden `role="status"` region announces `Error in column N: …. Suggested fix: …` once per pause, and the submit announcement. The preview line has an accessible name with operators in words (`x squared`). Targets grow to 44 px on coarse pointers. No animation.

### Line list (`algebra-view/ui.md` sections 2, 10, 11, reduced to what the language fills)

- `role="list"` labelled "Lines"; each row has a type chip, the typeset definition and `= value` when the value adds something.
- Undefined rows show `—`, the reason in words, and the `cause` chain as an ordered list (nearest undefined input first, root last); each name is a button that moves focus to that row.
- Row accessible name in one sentence (`k, number, undefined because g is undefined: division by zero`).
- Roving tab stop, Up/Down/Home/End, Enter (or double click) fires `incantly-row-edit`, Alt+click fires `incantly-row-insert` with the name, Ctrl+Alt+click with the definition. Rows are keyed and only changed rows are rebuilt.

### Events and properties (the contract for later areas)

- Editor: `figure` (a `FigureView`), `onSubmitLine`, `value`, `lines`, `insertText`, `refresh()`, `announce()`. Events `incantly-preview` (`{ result: PreviewResult | null }`, for the ghost) and `incantly-submitted` (`{ applied, failed }`).
- List: `rows` (`LineRow[]`), `focusRow(name)`. Events `incantly-row-edit`, `incantly-row-insert`.
- `defineLanguageElements()` registers both tags.

### The screen

`mountStudio(root)` builds it. A short placeholder where the figure will go says that there is no kernel or drawing and what that means for values. Under it a line says what the preview would draw (from `preview().type`). "Load example" applies seven lines, including a `1/0` and a line that reads it, so the cascade can be seen. `/` focuses the input from anywhere.

## What waits for the kernel and later areas

- **Drawing, ghost, marble, selection on the canvas.** There is no canvas. The ghost is only the one-line note under the placeholder. Rows have no visibility marble.
- **Running commands.** The kernel's real command table replaces `sample-commands.ts`. Until then a line that uses a command is accepted and typed, and its value is undefined with reason `not_set` (the row says why).
- **Real undo, delete, rename, reorder, duplicate, sliders, groups, sorting, search, display modes, next-step cards.** All need kernel services (`Delete`, `Rename`, undo groups). A multi-line quick fix (slider creation) is applied line by line; making it one undo step needs the kernel's `applyBatch`.
- **Object limit and `FigureView.clock/read` for animated values.** `ScratchSession` has no clock.
- **Per-object `detail` on undefined values.** `ScratchFigure` keeps the reason code but not `detail`; the cause chain is rebuilt from `CheckedLine.reads` and each object's value. The kernel's undefined value (`{ reason, detail?, cause? }`) should replace that bookkeeping in `session.ts`.

## Not built from `ui.md`, and why

- Symbol palette (Σ), Alt shortcuts, Ctrl+R history filter, the touch accessory bar and long-press alternates: not part of this pass.
- Hover or focus on a name for its type or the command summary (the textarea is under the coloured layer, so this needs hit-testing from pointer position).
- Completion rows do not show the "fits the current parameter" leading dot or dim the others: `Completion` has no fit flag (the list is already ordered by fit).
- Typeset preview is a text rewrite (`²`, `−`, `≤`, `√`, `π`, `·`); fractions are not set as fractions.
- "Prettify operators" and "pi vs π" settings: the strip always prettifies; the saved text is never changed.
- Confirm on the second Esc is an inline "Enter to clear, Esc to keep" strip, not a dialog.
- Virtual scrolling in the list (rows are reused but all are in the DOM). Fine for scratch figures; the real Algebra view needs it for thousands of rows.
- A programmatic text change (fix, completion, history) goes through `execCommand('insertText')` when the browser allows, so the field's own undo mostly keeps working; where it does not, the native undo stack is reset.

## Things the next agent should know

- `@incantly/ui` and `@incantly/studio` import `@incantly/kernel` without listing it in their `package.json`. It resolves through the workspace link. Declaring the dependency changes `package-lock.json`, which is outside this step's files, so it is left to whoever owns the lockfile. The studio design says it should be built on `@incantly/sdk` only; until the SDK exists it uses the kernel's public API directly, as asked.
- The root `tsconfig.json` does not include `apps/*/test`, so `npx tsc -p tsconfig.json` does not type-check `apps/studio/test`. Checked once with a temporary config (clean). Adding `"apps/*/test"` to `include` is a one-line change.
- Mismatch found while building: a definition target (`c` in `c = Circle(A, 2)`) is classified `unknown` by `tokenize`. The UI works around it (`markDefinitionTargets`). The language could classify the target as `name` itself.
- `x` is a reserved name, so `x = 2` is rejected (`reserved_name`); the sample lines avoid it.

## Checks

`npx eslint .`, `npx tsc -p tsconfig.json` and `npx vitest run` pass (2,083 existing tests plus 35 new: 10 text helpers and colour contrast, 13 line editor and 6 line list in `packages/ui/test/`, 6 session and page in `apps/studio/test/`). `npx vite build` in `apps/studio` builds (about 208 kB, 68 kB gzip).
