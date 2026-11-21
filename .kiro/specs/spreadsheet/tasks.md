# Spreadsheet: tasks

Branches: `feat/sheet-1` and up, one PR per round into `integration`.

- [x] 1. Round 1: language: references, `$` flags, ranges, `Range` and `CellAddr`; `@sheet` checks; read commands (`Cell`, `CellRange`, `Column`, `Row`, `ColumnName`, `ListFrom`, `PointsFrom`, `MatrixFrom`, `TableFrom`, `PolylineFrom`, `OperationTable`); late cells; errors and reasons (R1, R2, R3.1, R3.2, R7)
- [x] 2. Round 2: `shiftRefs`, `FillColumn`, `FillRow`, `FillCells`, `FillDown`, `FillRight`, `ClearCells` as batches, series detection, locked and input cells (R3.3 to R3.5, R4, R5)
- [x] 3. Round 3: paste and CSV parser, `planImport` (R6)
- [x] 4. Round 4: studio grid: view, editing, selection, fill handle, clipboard, selection bar, toast, settings (R8)
- [x] 5. Round 5: examples, benches, screenshots, final check (R9)
- [x] 6. Round 6: fills meet design 4: plan 9,998 formulas under 20 ms, apply under 100 ms (R9)
