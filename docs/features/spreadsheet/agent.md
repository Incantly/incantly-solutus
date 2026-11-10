# Spreadsheet: how the model uses it

## 1. When the model reaches for a sheet

Only when the lesson is about data: a table of values, a data set, a pattern of numbers, a comparison. Otherwise a plain list or `Seq` is shorter. The catalogue entry for `@sheet` tells it so.

## 2. Lines it writes

`FillColumn` writes from row 1 down, so it would overwrite a header. With a header row, the model writes the headers first, then fills below with `FillCells`:

```text
@sheet 4 12
A1 = "x"
B1 = "x squared"
FillCells(A2, Seq(k, k, 1, 8))
B2 = A2^2
FillDown(B2:B9)
pts = PointsFrom(A2:B9)
```

Data from a user's text:

```text
FillCells(A1, [[1, 2.1], [2, 3.9], [3, 6.2], [4, 7.8]])
pts = PointsFrom(A1:B4)
fit = FitLine(pts)               # statistics area
```

Single cells:

```text
C1 = Sum(A1:A8)
C2 = Mean(A1:A8)
```

## 3. Catalogue entries (one line each)

```text
@sheet cols rows                      adds a cell grid (cells A1.. are then reserved names)
A1 = expr                             a cell is an ordinary object; $A$1 is absolute
Cell(col: Number, row: Number) -> any
CellRange(from, to) -> Range          same as A1:B3
Column(cell) -> Number   Row(cell) -> Number   ColumnName(cell) -> Text
FillColumn(col: Number, List)         free values from row 1 down
FillRow(row: Number, List)
FillCells(topLeft, List|Matrix)
FillDown(Range)  FillRight(Range)     extend series or copy formulas
ClearCells(Range)
ListFrom(Range) -> List               PointsFrom(Range) -> List<Point> (2 columns)
MatrixFrom(Range) -> Matrix           TableFrom(Range) -> Table
PolylineFrom(Range)                   OperationTable(Range) -> Table
```

Token budget: about 330 tokens for the full group. It loads only when the lesson mentions data or tables (the teacher's group loader, core design section 10).

## 4. What `draw` returns

For a cell line: `{ ok: true, name: "B2", type: "Number", value: "4" }`.

For a fill: one result for the whole batch:

```json
{ "ok": true, "action": "FillDown", "written": 8, "range": "B2:B9",
  "sample": ["B2 = 1", "B3 = 4", "…", "B9 = 64"], "undefined": [] }
```

`figure()` adds, when a sheet exists, a `sheet` block: size, used range, count of filled and undefined cells, header guess (first row all text), up to 12 sample cells.

## 5. Fixing errors

| Error | Next line |
|---|---|
| `no_sheet` | `@sheet 26 100`, then retry |
| `cell_out_of_range` | `@sheet` with a larger size, then retry |
| `bad_shape` | change the range; `figure()` shows the used range |
| `reserved_name` | rename the point (`P_A1`) |
| `batch_failed` | resend with the line at `failedIndex` corrected |
| `type_change` | `ClearCells(B2)`, then retry |

## 6. Worked lessons

### 6.1 A table builds as it is explained

Teacher: "Let's look at squares. I'll put the numbers one to eight in a column."

```text
@sheet 3 12
A1 = "n"
FillCells(A2, Seq(k, k, 1, 8))
```

Teacher: "Next to each one, its square."

```text
B1 = "n squared"
B2 = A2^2
FillDown(B2:B9)
```

Teacher: "And here are those pairs as points. See how they curve?"

```text
sq = PointsFrom(A2:B9)
@view -1 10 -5 70
```

### 6.2 Recovering from an error

Teacher: "Here is the height data you gave me."

```text
FillCells(A1, [[150, 48], [155, 52], [160, 57]])
pts = PointsFrom(A1:B3)
```

Result: `no_sheet` at line 1 (hint `@sheet 26 100`).

Teacher: "Let me set up the grid first." (no apology, no retelling)

```text
@sheet 26 100
FillCells(A1, [[150, 48], [155, 52], [160, 57]])
pts = PointsFrom(A1:B3)
```

Result ok. Teacher: "Three points. Weight rises with height."

### 6.3 What if

Teacher: "Now change the first number and watch the total."

```text
A1 = 10
```

`figure()` shows `C1` (the `Sum`) updated. The teacher reads the value from the result of the line, not from memory.

## 7. Style rules for the model

- Headers go in row 1 as text; data from row 2.
- Prefer `FillDown` over writing 20 lines.
- Never use cell names for geometry points when a sheet exists.
- At most 300 cells written per `draw` call (limit; the tool returns `limit` otherwise).
