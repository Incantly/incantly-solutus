# Controls and scripting: design

Source of truth: `docs/features/controls-scripting/design.md` and `ui.md`. This file says how the studio meets
`requirements.md`.

## 1. Rows

`packages/ui` `RowControl` gains three kinds:

| Kind | Fields |
|---|---|
| `button` | `label` |
| `choice` | `options: string[]`, `index` (1-based), `empty` |
| `input` | `caption`, `text`, `error?` (message, col, endCol), `notice?` |

`KernelSession.controlOf` fills them from `choiceStateOf`, `inputTextOf`, `inputErrorOf` and the button label
(`summarizeControl`). The row stamp includes the control, so a row redraws only when its control changes.

## 2. Learner writes

`KernelSession` routes every learner gesture through one helper, `learner(name, event, value)`:

- slider move: `setFree` as today, then `change` (the run, if any, happens after the flush);
- slider release and point release: `dragend`;
- checkbox, choice pick, input commit: through the numbers writers (`toggleCheckbox`, `setChoiceIndex`,
  `commitInputText`) with `by: 'learner'`, which raise `change` themselves;
- button: `clickButton(figure, name, { by: 'learner' })`.

Change handlers run only when one is stored (`getStoredHandler`), so a slider drag with no handler costs nothing new.
Typing in an input calls `typeInputText` at once (for `q.text`, `q.valid`) and runs `input` handlers after 150 ms.

## 3. Runs and the badge

`clickButton` returns the `HandlerRun`. When `ok` is false the row's button gets the class `aborted` and the title for
3 s. A run is already one undo entry (`applyBatch` with a group), so undo needs nothing new.

## 4. Clickable objects

The scene item gains `clickable` when the object has `clickable = true` and a stored click handler. The graph pane
sets `cursor: pointer` over its hit area, and a click without a drag calls `session.click(name)`.

## 5. Handler list

`listHandlers(figure)` and `brokenSteps` give, per target, the events and steps. The row of the target gets a
`handlers` block: `on click` and then `1  SetValue(a, 0) ✓` and a delete button. Handlers on `figure` show under a
"Figure" row at the end of the list.

## 6. Load

`loadExample` and `load` call `runLoadHandlers(figure)` after the lines are in.

## 7. Not in this round

- `Highlight`, `View`, `Axes`, `Grid` as handler steps (they are deferred commands in the kernel).
- The author-mode panel with Edit, Up and Down per step (ui.md 5): this round shows steps with delete only.
- `on update` (README phase 2).
