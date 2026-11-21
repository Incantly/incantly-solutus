# Spreadsheet: design

The feature design is `docs/features/spreadsheet/design.md`. This file says where each part lives and where we chose a
simpler way that meets the same targets.

## Language (`packages/kernel/src/language/`)

- `cells.ts`: cell addresses (`A1` to `ZZ9999`), column letters, `isCellName`, and finding the cell objects inside a
  rectangle (by address when the rectangle is small, by scanning names when it is large).
- Lexer: `$A$1`, `A$1`, `$A1` are name tokens of the cell `A1` with `cabs` and `rabs` flags.
- Parser: `A1:B3` written without spaces is the node `cells`. A `name` node keeps the flags, so the printer writes `$`
  back.
- Checker: a `cells` node becomes the typed node `cells` with the cell objects it covers. Bound to a `Range` parameter it
  stays a range value; bound to a list parameter it becomes a list (holes left out, mixed cells keep the numbers and
  give `skipped_non_numeric`). A cell name given to a `CellAddr` parameter is its address, so `FillCells(A2, …)` works on
  empty cells. A form parameter named `sheet` of type `Range` that is left out is bound to the whole sheet (`Cell`).
- Each covered cell is an ordinary input of the object. This is one edge per filled cell, not one per range (design
  3.5): with the 20,000-cell limit it is simpler and meets the targets of design 4. A cell that appears later inside a
  range is picked up by the sheet (below).

## Sheet commands (`packages/kernel/src/commands/sheet/`)

- `registerSheet(registry)`: the commands of design 3.8 in group `sheet`, the line check (`no_sheet`,
  `cell_out_of_range`, `reserved_name`, `cell_locked`), the undefined reasons, and the after-line hook.
- After-line hook (a kernel hook): when a cell is added, objects whose ranges cover it are checked again from their own
  definition (`rebind`), so their inputs include the new cell.
- `shift.ts`: `shiftRefs` on the syntax tree, and printing back.
- `fill.ts`: `planFill` with series detection; `FillDown` and `FillRight` apply the plan as one nested batch.
- `paste.ts`: the paste and CSV parser and `planImport`.

## Kernel hooks added

- `Figure.directive(name)`: the words of a directive, for areas.
- `registerAfterLine(hook)`: runs after a committed line, inside its transaction.
- `ApplyOptions.rebind`: a redefinition to the same text checks the line again instead of only refreshing the value.

## Studio

- `apps/studio/src/sheet/`: the grid Web Component (virtual rows and columns), the editor, selection, fill handle,
  clipboard, selection bar and toast. It writes lines through the session like every other view.
