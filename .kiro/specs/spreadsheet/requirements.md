# Spreadsheet: requirements

Area: `docs/features/spreadsheet/` (`design.md`, `ui.md`, `agent.md`, `errors.md`). Kernel side in
`packages/kernel/src/language/` (references and ranges) and `packages/kernel/src/commands/sheet/`, the grid in
`apps/studio`. Branch: `feat/sheet-*`.

### R1. Cells and the sheet (design 3.1, 3.6)

1. `@sheet cols rows` SHALL give the figure a sheet; cols at most 702 (`ZZ`), rows at most 9999.
2. A cell SHALL be an ordinary object whose name is its address (`A1`, `AB12`): `B2 = A2^2` defines cell B2.
3. With a sheet, a cell line outside the size SHALL be `cell_out_of_range` with the size and the `@sheet` line that fits.
4. With a sheet, a function or a multi-name line whose name is a cell address SHALL be `reserved_name`.
5. Without `@sheet`, `A1` SHALL be an ordinary name; `$A$1`, a range or a sheet command SHALL be `no_sheet`.

### R2. References and ranges (design 3.3; errors 1)

1. `$A$1`, `$A1`, `A$1` SHALL be read as the cell `A1` with absolute flags kept in the tree and printed back.
2. `A1:C5` SHALL be a range: one type `Range`, its cells read as one input set.
3. A range SHALL be accepted only by a parameter of type `Range` or a list parameter; a one-row or one-column range
   gives a list, a 2D range a list of rows, empty cells are left out (`Sum(A1:A8)`).
4. `r = A1:C5` SHALL be `range_not_object` (hint `ListFrom` or `MatrixFrom`); a range anywhere else
   (`A1:B3 + 1`) SHALL be `range_misplaced`.
5. A `$` not followed by a reference, a column past `ZZ`, row 0 or a row above 9999 SHALL be `bad_reference`;
   `A1:` or `A1:B` SHALL be `syntax` with what was expected.
6. A cell typed later inside a range SHALL be picked up: `C1 = Sum(A1:A10)` sees a new `A7`.

### R3. Commands (design 3.8)

1. `Cell(col, row)`, `CellRange(from, to)`, `Column(cell)`, `Row(cell)`, `ColumnName(cell)`.
2. `ListFrom(Range)`, `PointsFrom(Range)` (2 columns, else `bad_shape`), `MatrixFrom(Range)` (a hole gives
   `empty_cell`), `TableFrom(Range)`, `PolylineFrom(Range)`, `OperationTable(Range)` (at least 2 x 2).
3. `FillColumn(col, List)`, `FillRow(row, List)`, `FillCells(topLeft, List | Matrix)` SHALL write free values.
4. `FillDown(Range)`, `FillRight(Range)` SHALL write definitions with shifted references and series detection
   (design 3.9); `ClearCells(Range)` SHALL delete the cells, keeping range readers.
5. Every fill and clear SHALL be one batch: all or nothing, one undo step.

### R4. Rewriting on the tree (design 3.4)

1. `shiftRefs(tree, dCol, dRow)` SHALL move relative parts and keep absolute ones, never touching names that are not
   cells; a reference leaving the grid SHALL give `off_sheet`, and the filled cell is undefined with that reason.

### R5. Locked and input cells (design 3.15)

1. `@cell B2 locked` and `@cell B2 input` SHALL mark cells; with locks enforced, editing a locked cell, or a fill or
   paste that touches one, SHALL be `cell_locked` naming up to 5 cells, and nothing changes.

### R6. Paste and import (design 3.11, 3.12)

1. Pasted text SHALL split by newline and tab, or comma when there is no tab; quoted fields kept; numbers with the
   chosen decimal separator; other fields text; `1,2,3` stays text with a warning.
2. `planImport(text, opts)` SHALL detect the separator and a header row, refuse binary data (`import_format`) and
   filled targets without `replace` (`import_conflict`), and stop past 50,000 cells or 5 MB (`limit`).

### R7. Undefined reasons (errors 4)

1. `off_sheet` (`#OFF`), `deleted_cell` (`#DEL`), `empty_cell` (`#EMPTY`), `not_numeric` (`#NUM`) SHALL be undefined
   reasons with short display codes.

### R8. The grid (ui)

1. A sheet view beside the figure (classic mode, and a Sheet button where the mode allows it): headers, virtual
   scrolling, values not formulas, a dot on formula cells, short codes on undefined cells.
2. Editing: typing starts an edit, Enter, Tab, Shift, Esc; a bad entry stays in edit with the error under the cell.
3. Selection with mouse and keys, a fill handle, `Ctrl+D`, `Ctrl+R`, copy, cut and paste, Delete.
4. A selection bar with the create tools, each showing its line; a summary of count, sum and mean.
5. A toast after a fill or paste with Undo.

### R9. Examples, benches, screenshots

1. Examples: a table of squares with its points, a data set with a fitted line, a times table.
2. Benches for the design 4 targets; screenshots of the grid.
