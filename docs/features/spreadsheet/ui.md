# Spreadsheet: what the learner sees

## 1. Layout

The sheet is a view beside the figure, like the algebra list. Default split on a wide screen: figure 60%, sheet 40%. On a phone it is a tab ("Figure" | "Sheet").

```text
+--------------------------------------------------+
| fx [ =A2^2                                  ] [✓]|   formula bar (setting, default off)
+----+--------+--------+--------+--------+---------+
|    |   A    |   B    |   C    |   D    |    E    |
+----+--------+--------+--------+--------+---------+
|  1 | n      | n sq.  |        |        |         |
|  2 | 1      | 1      |        |        |         |
|  3 | 2      |[4     ]|        |        |         |  <- selected cell, handle at corner ■
|  4 | 3      | 9    ■ |        |        |         |
+----+--------+--------+--------+--------+---------+
 [ list ][ points ][ matrix ][ table ][ polyline ][ op. table ]   <- appear when a range is selected
```

The reference app shows a toolbar of tool groups at the top and a context menu for creating objects. We keep the context menu but also show a **selection bar** under the grid as soon as a range is selected: one tap on the thing you want. Each button shows the line it will write on hover or long-press ("`list1 = ListFrom(A1:A8)`").

## 2. Cells

- Default cell 70 x 25 px (touch: 80 x 36). Column width and row height are draggable at the header edges; double-click an edge to fit content.
- A cell shows the value, not the formula. Numbers align right, text left, booleans centre as a tick. Points show `(1, 2)`. Lists show `{…}` with the length.
- A cell with a formula shows a tiny dot in its top right corner. Hover or focus shows the formula in a tooltip (setting `allowTooltips`).
- A cell with an **undefined** value shows a short code (`#DIV`, `#OFF`, `#UP`…) in grey-red with the reason in the tooltip. No dialog.
- A cell that holds a drawable object has a small coloured square matching its colour in the figure; clicking the square toggles visibility (default for cells: visible for points and functions, label off).
- Locked cells show a small padlock and a pale grey background; input cells show a pale yellow background.

## 3. Editing

- Click selects. Typing starts editing with the typed character. `F2` or double-click edits with the existing text. `Enter` commits and moves down; `Shift+Enter` up; `Tab` right; `Shift+Tab` left. `Esc` cancels.
- While editing, references can be picked by clicking other cells: their name is inserted and they are outlined in matching colours in the grid (so you see which cells the formula reads).
- A commit that fails to parse stays in edit mode with the error under the cell in red (message and hint). The cell keeps its old value.
- Autocomplete (setting, default on) offers command names and cell names after two letters.
- Typing text: if `requireEquals` is on, text is the default and formulas start with `=`; a badge "text mode" shows in the formula bar. If off, text needs quotes, and the editor wraps a lone word in quotes after the learner presses `Enter` only when it is not a name, with the hint "stored as text".

## 4. Selection

- Click-drag, `Shift+click` and `Shift+arrows` make a rectangle. `Ctrl/Cmd+click` adds non-adjacent cells. Click a header to select a column or row; `Ctrl/Cmd+A` selects all used cells.
- The selection has a drag handle (a square at the bottom-right corner) for fill.
- Selection summary at the bottom: count, sum, mean of numeric cells (like most spreadsheets), a quick check with no object created.

## 5. Fill, copy, paste

- **Drag the handle** down or right (or up or left): a ghost outline shows the target; the first three results appear as a preview in the target cells in light text. Release applies it as one step.
- `Ctrl/Cmd+D` fills down, `Ctrl/Cmd+R` right. A **fill options** chip appears after a fill: "copy cells", "fill series", "fill formatting only".
- `Ctrl/Cmd+C/X/V` as usual. Paste shows a small chip: "values only", "with formulas", "transpose".
- After a paste or fill, a toast says "Filled 8 cells" with Undo. Any warning (cells skipped, references off the sheet) is a link that lists them.
- `Delete` clears values; `Backspace` clears and starts editing.

## 6. Context menu

Copy, Cut, Paste, Paste values, Insert row above/below, Insert column left/right, Delete row/column, Clear, Lock/Unlock (teacher mode), Format (bold, italic, align, background, borders, number format), Create (List, List of points, Matrix, Table, Polyline, Operation table), Statistics (One variable, Two variables, Multiple variables), Import data file.

## 7. Style bar

Bold, italic, align left/centre/right, background colour (8 swatches plus none), borders, number format (decimals 0..10), and a settings button. Default colours: header cells (row 1 text) are not auto-styled; headers (A, B, 1, 2) are pale grey (`#F2F2F4`); selection fill `#DCE8FF` with a `#2F6FEB` 2 px outline; formula-reference colours cycle through 6 hues.

## 8. Settings panel (cog)

Formula bar, gridlines, row headers, column headers, scrollbars, tooltips, require `=`, autocomplete, decimal separator, sheet size, enforce locks (teacher). Changes apply at once and are saved with the figure (`@sheetview` and `@sheet` lines).

## 9. Keyboard and accessibility

- Whole grid is one `role="grid"` with `role="row"`, `role="gridcell"`. Headers are `columnheader`/`rowheader`. Only visible cells and a 2-cell margin exist in the DOM (virtual scrolling).
- Arrow keys move; `Ctrl+arrow` jumps to the data edge; `Home/End` row start and end; `PageUp/Down` one screen.
- A screen reader hears: "B3, value 4, formula A3 squared, row 3 of 12, column 2 of 3." Undefined cells: "B3, undefined, divides by zero."
- Fill and paste announce the result in a polite live region ("Filled 8 cells in B2 to B9").
- Contrast of undefined codes at least 4.5:1. No colour-only signals: locked cells have the padlock, inputs a dashed border.

## 10. Touch

- Tap selects; double-tap edits; long-press opens the context menu.
- The fill handle is a 24 px circle on touch; drag with a preview as above.
- Pinch zooms the sheet text (80% to 160%).
- Two-finger drag scrolls even while a cell is edited.

## 11. Relation to the figure

- Clicking a cell highlights its object in the figure (same pulse as `Highlight`). Clicking an object in the figure that is a cell scrolls the sheet to it.
- Dragging a free point that is a cell updates its two components when the cell holds a point; a number cell with a range slider shows an inline slider on selection.
- The teacher's live `draw` calls scroll the sheet to the last written cell and outline the written range for 1.5 s; this keeps the learner's eyes with the talk.

## 12. Animation

- Fill preview fades in 80 ms. Written cells flash a pale highlight for 400 ms (not when `prefers-reduced-motion`; then a static outline for 1 s).
- No animation during scroll.

## 13. Differences from the reference app

- Selection bar with visible lines instead of a toolbar of groups.
- Error shown in the cell, no dialog.
- Fill preview and options chip.
- Reference colours while editing.
- Lock and input cells.
- Whole-grid screen-reader model with live announcements.
