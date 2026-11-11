# Spreadsheet: design

Status: draft. Stage 2 feature (the core design lists the spreadsheet as "not in v1"). This document is complete enough to build from, and says which parts must be in the kernel from day one so we do not have to rework it later (section 9).

## 1. What it does

### For a learner

A grid of cells next to the figure. Each cell holds one value or formula. A cell is also an object in the figure: type `A1 = 3` in the grid and `A1` exists as a number the figure can use. Typical uses:

- Enter data (heights, test scores, an experiment), then draw a scatter plot, a histogram or a fitted line from it.
- Build a table of values for a function and plot the points.
- Make a pattern by filling: type `1` and `2`, drag down, get 1 to 20.
- Compare "what if" columns: change one input cell and every dependent cell and the graph follow.
- Operation table: a two-variable formula with row and column inputs, like a times table.

### For a teacher

- Paste a column from any spreadsheet program or a CSV file and have it ready in seconds.
- Hand out a figure whose sheet has locked cells (inputs the learner may change, formulas they may not).
- The live teacher can fill a table while speaking, one `FillColumn` line per sentence.

### Sub-features (complete list)

| # | Sub-feature | Stage |
|---|---|---|
| 1 | Grid view with row and column headers, scrolling, selection, resize | 2 |
| 2 | Cells as objects with names `A1`..`ZZ9999` | 2 |
| 3 | Typed entry: number, text, boolean, point, list, function, formula | 2 |
| 4 | References: relative, absolute (`$A$1`), mixed (`A$1`, `$A1`) | 2 |
| 5 | Ranges `A1:C5` as values | 2 |
| 6 | Copy, cut, paste with reference shifting | 2 |
| 7 | Fill by drag handle, `Ctrl+D` (down), `Ctrl+R` (right), with series detection | 2 |
| 8 | Commands: `Cell`, `CellRange`, `Column`, `Row`, `ColumnName`, `FillCells`, `FillColumn`, `FillRow`, plus ours `FillDown`, `FillRight` | 2 |
| 9 | Create-from-selection tools: list, list of points, matrix, table, polyline, operation table | 2 |
| 10 | Statistics tools on selection: one-variable, two-variable, multi-variable, sum, mean, count, product, min, max | 2 (calls the statistics area) |
| 11 | Import: paste text (tab or comma separated), import `.csv`, `.txt`, `.dat` | 2 |
| 12 | Cell formatting: bold, italic, alignment, background, borders, number format | 2 |
| 13 | Display in other views: a cell's object shows in the figure when the object type is drawable | 2 |
| 14 | Settings: formula bar, gridlines, headers, scrollbars, tooltips, require-`=`, autocomplete, size | 2 |
| 15 | Locked cells and input cells (teacher authoring) | 2, ours |
| 16 | Undo and redo per fill, paste, import | 2 |

## 2. How the reference app does it

In plain words, from the source (`gui/view/spreadsheet`, `main/settings`) and the manual:

- **A cell is an ordinary object whose name is its address.** Typing in cell B2 creates the object `B2`. There is no separate cell store: the table asks the construction for the object with that name. That keeps one model, and the figure and the sheet agree for free.
- **Copy is textual rewriting.** To copy `B1` to `B2`, the reference app takes the definition of the source, finds every spreadsheet-style name in its expression tree, shifts the relative parts by the offset, and defines the result in the target. A `$` before the column or row pins that part. Targets that fall off the grid are not shifted.
- **Fill by drag** looks at the source selection. If the selected cells are numbers, it works out a linear step and continues the series in the dragged direction (there are four direction variants of the same procedure: up, down, left, right). Otherwise it repeats the source cells, shifting references.
- **Tools** (create list, matrix, and so on) read the selected rectangle and issue ordinary commands (a list of cells, a matrix of cells), so results stay live.
- **Commands** are thin: one gives a cell by numbers, one gives a range, one gives the column or row number or letters of a cell, three copy lists into cells.
- **Settings** are a small bag of booleans plus per-column widths and per-row heights, a default size (26 columns by 100 rows), and a saved scroll and selected cell.
- **What works:** one object model; relative copy is intuitive; selection to command is a good bridge to the rest of the program.
- **What is weak:**
  - Rewriting by text and a regular expression on names. It clashes with any object that happens to look like a cell, e.g. a point named `A1`.
  - Dependencies of range expressions are re-derived per cell, so a sheet with thousands of range formulas gets slow.
  - Cell content is guessed from text: an entry that fails to parse becomes text, silently.
  - Fill is not one transaction: each cell is committed and undone separately, and a mid-way failure leaves a half-filled block.
  - The grid is a fixed-size table that renders every visible cell as a widget.
  - No errors visible in the cell, except via a dialog.

## 3. Our design

### 3.1 Naming and the namespace

Cell names are the pattern letters then digits, e.g. `A1`, `AB12`. Letters are `A`..`Z` for columns 1..26, `AA`.. for 27..702 (two letters is the limit). Rows 1..9999.

Because `A1` is also a plausible point name, cell names are **reserved only when the figure has a sheet** (`@sheet 26 100`, a directive, section 9). With a sheet:

- a `A1 = …` line addresses the cell if `A1` is within the declared size;
- `A1 = …` outside the declared size is the error `cell_out_of_range`;
- point and other object names that match the pattern are a `reserved_name` error in a figure that has a sheet. The teacher is told this in the catalogue entry for `@sheet`.

Without `@sheet` the pattern is an ordinary name, so the v1 grammar is unchanged.

Absolute markers `$` are legal only inside references. The tokenizer gets one new rule: a `$` immediately followed by letters or digits starts a reference token. Nowhere else is `$` legal in a line (the maths-text `$…$` of strings is inside a string and unaffected).

### 3.2 Types

```ts
/** 1-based, as users see them. */
interface CellAddress { readonly col: number; readonly row: number }

/** A reference as written: carries the absolute flags. */
interface CellRef extends CellAddress {
  readonly colAbs: boolean;   // `$A`
  readonly rowAbs: boolean;   // `$1`
}

interface RangeRef { readonly from: CellRef; readonly to: CellRef } // normalised so from <= to

/** Value of a range expression. Holes are explicit. */
interface Grid<T = Value> {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly (T | Empty)[];   // row-major, length cols*rows
}
declare const EMPTY: unique symbol;
type Empty = typeof EMPTY;

interface CellMeta {
  readonly address: CellAddress;
  readonly locked: boolean;                 // teacher authoring
  readonly format: CellFormat;
}

interface CellFormat {
  readonly bold?: boolean; readonly italic?: boolean;
  readonly align?: 'left' | 'center' | 'right';
  readonly background?: Color; readonly border?: Partial<Record<'top'|'right'|'bottom'|'left', boolean>>;
  readonly numberFormat?: { decimals?: number; sig?: number };
}

interface SheetSpec { readonly cols: number; readonly rows: number } // limits: cols<=702, rows<=9999
```

An object gains an optional field `cell?: CellMeta` (change to the core model, section 10). Everything else about a cell object is as any object: `id`, `name`, `type`, `def`, `value`, `style`, `order`.

New value type for expressions only: `Range` (a lazy `RangeRef`, evaluated to a `Grid` or consumed by a command). It is not an object type: you cannot write `r = A1:C5` (error `range_not_object`, hint `ListFrom(A1:C5)` or `MatrixFrom(A1:C5)`).

### 3.3 Grammar additions

```ebnf
cellref   = [ "$" ] colletters [ "$" ] rowdigits ;     (* A1  $A1  A$1  $A$1 *)
range     = cellref ":" cellref ;                      (* only where a Range is accepted *)
primary  += cellref | range ;
```

`:` is not an operator elsewhere in the language, so there is no ambiguity. A range may be used as an argument of a command whose parameter type is `Range` or `List` (a range of one row or column converts to `List`; a 2D range converts to `List<List>`), and nowhere else.

A cell entry from the grid UI is a line body: typing `=B1+1` or `B1+1` in cell `C1` becomes the line `C1 = B1 + 1`. Typing something that does not parse in a cell is **an error shown in the cell** (section 5 of `errors.md`), not silent text. Text must be typed in quotes, or by setting the cell's text mode in the UI, which wraps it in quotes for the line. This fixes the "silently becomes text" weakness.

### 3.4 References and rewriting on the syntax tree

Rewriting works on the parsed tree, never on text.

```ts
/** Pure. Returns a new tree; never mutates. */
function shiftRefs(tree: Expr, dCol: number, dRow: number): ShiftResult;

type ShiftResult =
  | { ok: true; tree: Expr }
  | { ok: false; reason: 'off_sheet'; ref: CellRef };   // a relative ref would leave the grid
```

- A relative column part moves by `dCol`; an absolute one stays. Same for rows.
- A range shifts both ends independently.
- References into other objects (not cells) are untouched.
- If a relative reference would land at column or row below 1 or above the limit, the shift fails with `off_sheet`. The target cell is defined as `undefined` (reason `off_sheet`) and a warning is returned, so a fill never stops half-way.
- Complexity: linear in tree size. A fill of 1000 cells of an expression of 20 nodes costs about 20,000 node visits (< 2 ms).

### 3.5 Dependencies of ranges

A range input is not expanded into one edge per cell. The kernel's dependency graph gets a second kind of edge:

```ts
type RuleInput =
  | { kind: 'object'; id: ObjectId }
  | { kind: 'range'; sheet: SheetId; c0: number; r0: number; c1: number; r1: number };
```

The sheet keeps an index from cell address to the ranges that cover it: one sorted array of range starts per column band of 32 columns (so a column of 1000 cell edits asks only ~1 band). When a cell value changes, the sheet asks "which range inputs contain (c, r)?" in O(log n + k) and marks their rules dirty. So `Sum(A1:A1000)` is one edge, not 1000, and an edit of `A500` costs one lookup.

An object that moves (e.g. the cell is deleted) leaves the range edges intact; edges refer to addresses, not objects, so a cell that appears later in the range is picked up automatically (this is how `Sum(A1:A10)` sees a newly typed `A7`).

### 3.6 Storage

- Cells are objects in the kernel. The sheet adds a sparse map `Map<number, ObjectId>` keyed by `(row << 10) | col`, plus per-cell `CellMeta` for formatted-but-empty cells in a second sparse map.
- Column widths and row heights: `Map<number, number>` of overrides, with defaults 70 and 25 px.
- Memory target: 100,000 filled cells under 40 MB; 10,000 under 4 MB. Empty cells cost nothing.
- Hard limits (`limit` error): 20,000 cell objects per figure for the first version, 2,000 range edges.

### 3.7 Entry and parsing

The entry rule for a cell, from the UI or a line:

1. Parse as an expression. If it parses, the cell becomes that type (number, point, list, formula…). The usual type rules apply; redefinition may not change the type, except that **a cell may be cleared first** (typing nothing deletes the object), so the user can always retype.
2. If it fails to parse, return the parse error.
3. Locked cells reject the edit with `cell_locked`.

A cell's redefinition may change its type in the UI, because the UI does `Delete` then define as one transaction. A script line cannot: it keeps the core rule.

### 3.8 Commands (complete list)

All indices are 1-based. `Range` accepts `A1:B3` or the result of `CellRange`.

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `Cell` | `(col: Number, row: Number)` | the value of that cell | Reads by index. Dependent: updates when the cell updates. `Cell(1, 1)` is the same as `A1`. |
| `CellRange` | `(from: CellAddr, to: CellAddr)` | `Range` | Same as `A1:B3` but from computed values. Arguments may be `Cell` results' addresses via `A1`, `B3` names. |
| `Column` | `(CellAddr)` | Number | Column index of that cell. |
| `Row` | `(CellAddr)` | Number | Row index. |
| `ColumnName` | `(CellAddr)` | Text | Letters, `"C"`. |
| `FillColumn` | `(col: Number, List)` | action | Puts list items into rows 1.. of that column as free values. Replaces what was there; reports how many cells were written. |
| `FillRow` | `(row: Number, List)` | action | Same across a row. |
| `FillCells` | `(topLeft: CellAddr, List \| Matrix)` | action | A list goes down a column, a matrix fills a rectangle. |
| `FillDown` | `(Range)` | action | Ours. Copies/extends the first row of the range down through the range, with series detection (3.9). |
| `FillRight` | `(Range)` | action | Ours. Same across. |
| `ClearCells` | `(Range)` | action | Ours. Deletes the cells' objects (reports what went downstream). |
| `ListFrom` | `(Range)` | `List` | A live list; a 2D range gives list of rows. Holes are dropped. |
| `PointsFrom` | `(Range)` | `List<Point>` | Range must have 2 columns (x, y); error `bad_shape` otherwise. |
| `MatrixFrom` | `(Range)` | Matrix | No holes allowed; hole makes the value undefined with reason `empty_cell`. |
| `TableFrom` | `(Range)` | Table | A formatted table object that can be placed in the figure. |
| `PolylineFrom` | `(Range)` | Polyline | Joins the points in order. |
| `OperationTable` | `(Range)` | Table | Top-left cell is a two-variable formula in `x` and `y`; first row supplies `x`, first column `y`; the table is the formula over all pairs. |

Notes:

- `FillColumn`, `FillRow` and `FillCells` write **free values**, not formulas, just as users expect from "paste values". `FillDown` and `FillRight` write **definitions** (formulas with shifted references).
- Every fill is a **batch transaction** (section 3.10).
- The statistics tools in the grid (one-variable, two-variable, multi-variable, sum, mean, count, product, min, max) are UI front ends to commands of the statistics and lists areas (`Mean`, `Count`, `Sum`, `Min`, `Max`, `Product`, `Stats1(list)`, `Stats2(points)`). This area does not define them; it lists them and passes `ListFrom(selection)`.

### 3.9 Fill and series detection

```ts
type FillDirection = 'down' | 'right' | 'up' | 'left';

interface FillPlan {
  readonly direction: FillDirection;
  readonly source: RangeRef;          // what the user selected
  readonly target: RangeRef;          // where to write
  readonly lines: readonly string[];  // generated definitions, in dependency order
  readonly warnings: readonly Warning[];
}

function planFill(sheet: SheetView, source: RangeRef, target: RangeRef, dir: FillDirection): FillPlan;
```

Rules, applied per line of fill (each column when filling down, each row when filling right):

1. If all source cells in this line are **numeric constants** (free numbers) and there are at least two: step = the common difference if constant, else fall back to rule 3. Continue as arithmetic series: `value_k = last + step * (k - n + 1)`. Floating point is computed as `first + step * index` (not by repeated addition) so no drift. If the numbers are all integers and the step is integer, results are integers.
2. If the source cells are **text ending in an integer** and share the same prefix (e.g. `Week 1`), continue the integer by +1 (or the common step), keeping the prefix.
3. If the source is **one cell**: copy it, shifting references by the offset from the source (rule of 3.4). A single numeric constant is copied unchanged (a repeated value), not incremented.
4. Otherwise **repeat the source block** cyclically with shifting references.
5. Fill up and left run the same logic mirrored: the series is extrapolated backwards.

All lines of a plan are produced before any is applied. If any produces `off_sheet`, that cell gets an undefined value and a warning is added; the rest apply.

Complexity: planning is O(target cells * tree size). 10,000 cells: under 20 ms planning and under 100 ms to apply as one batch.

### 3.10 Batch transactions

The core design applies one line at a time. Fill, paste, import and `FillColumn` need **all or nothing**. Add to the kernel:

```ts
interface Kernel {
  /** Applies all lines in dependency order. On any error, nothing is changed. */
  applyBatch(lines: readonly string[], opts?: { allowUndefinedWarnings?: boolean }): BatchResult;
}

type BatchResult =
  | { ok: true; applied: LineResult[]; warnings: Warning[]; undo: UndoToken }
  | { ok: false; failedIndex: number; error: KernelError };   // nothing applied
```

- Evaluate once at the end of the batch, not after each line (one update pass over the merged downstream lists). That gives the 100 ms target for 10,000 cells.
- One undo entry for the whole batch.
- The batch error carries the index of the first failing line and the usual error object.

### 3.11 Copy, cut, paste

- **Copy** captures `{ range, definitions[], styles[], format[] }` into an internal clipboard and also puts tab-separated *values* in the system clipboard as text.
- **Paste inside the figure** (internal clipboard still valid): rewrites the definitions with the offset between the source's top-left and the paste cell (3.4) and applies them as a batch. Style and format come along.
- **Paste from outside** (system text only): split rows by newline and columns by tab or comma (tab wins if present); each field is parsed as a number if the whole field is a number (decimal point or comma; the setting `decimalSeparator` decides), else as text. Quoted fields (`"a, b"`) are honoured. Result is a batch of free values. Fields that look like a number but are not valid (`1,2,3`) are text with a warning.
- **Cut** is copy then clear, one batch, one undo step. References that point to the cut cells are **not** rewritten (they become undefined), as in the move model of most spreadsheets, and the warnings list them.
- Pasting over locked cells: the whole paste is rejected (`cell_locked`).
- Size limit: 50,000 cells per paste, else `limit`.

### 3.12 Import files

`.csv`, `.txt` and `.dat` through the same parser as paste. Extra rules: a header row is detected when the first row is all text and the second row has at least one number; the user is asked once (UI) or the option `header: boolean` decides (API). Encoding is UTF-8 with or without BOM. The default separator is detected from the first line (tab, semicolon, comma). Max file size 5 MB for the first version.

```ts
interface ImportOptions {
  readonly at: CellAddress;                 // top-left target
  readonly separator?: ',' | ';' | '\t' | 'auto';
  readonly decimal?: '.' | ',' | 'auto';
  readonly header?: boolean | 'auto';
  readonly replace?: boolean;               // default false: error if cells already filled
}
function planImport(text: string, opts: ImportOptions): FillPlan;
```

### 3.13 Create-from-selection tools

Each tool is a button that composes one command line from the selection, shows the line to the user (so they learn the language), and applies it. Naming rules for the result follow the next free name (`list1`, `matrix1`).

| Tool | Generated line |
|---|---|
| Create list | `list1 = ListFrom(A1:A10)` |
| Create list of points | `pts1 = PointsFrom(A1:B10)` |
| Create matrix | `m1 = MatrixFrom(A1:C3)` |
| Create table | `table1 = TableFrom(A1:C3)` |
| Create polyline | `poly1 = PolylineFrom(A1:B10)` |
| Create operation table | `ot1 = OperationTable(A1:D4)` |

### 3.14 Settings

```ts
interface SheetSettings {
  showFormulaBar: boolean;      // default false
  showGridlines: boolean;       // true
  showRowHeaders: boolean;      // true
  showColumnHeaders: boolean;   // true
  showScrollbars: { v: boolean; h: boolean };  // true, true
  allowTooltips: boolean;       // true
  requireEquals: boolean;       // false: typing `3` makes 3; true: only `=3` is accepted as content
  autocomplete: boolean;        // true (ours; the reference app's default is off)
  size: SheetSpec;              // 26 x 100
  columnWidth: number; rowHeight: number;   // 70, 25
  decimalSeparator: '.' | ',';
  columnWidths: Record<number, number>; rowHeights: Record<number, number>;
}
```

`requireEquals` exists for classrooms that want to type plain text without quotes. In that mode the grid UI treats an entry not starting with `=` as text (wrapped in quotes in the generated line). It is a setting, not a guess: the learner sees a visible "text mode" badge.

### 3.15 Locked and input cells (ours)

A teacher can mark cells `locked` (the learner cannot edit) or `input` (highlighted, learner may edit, e.g. a measurement). Stored in `CellMeta`. Directive: `@cell B2 locked` and `@cell B2 input`. The embed API can set this too. Lock is **soft**: it stops the UI and the line interface when `enforceLocks` is on; the teacher's own session turns it off.

## 4. Numerical and performance targets

| Measure | Target |
|---|---|
| Edit one cell with 100 dependents (incl. ranges) | under 1 ms |
| Edit a cell inside `Sum` over 10,000 cells | under 1 ms (incremental: see below) |
| Fill 10,000 cells, one batch | under 100 ms |
| Paste 50,000 numbers | under 400 ms |
| Scroll through 1,000,000-cell window | 60 fps (virtualised rendering) |
| Memory for 10,000 filled cells | under 4 MB |

**Incremental aggregates.** `Sum`, `Count`, `Mean` over a range keep a running total when only one input changes: the rule gets `(oldValue, newValue)` of the changed cell from the sheet and adjusts. Every 10,000 incremental updates (or when a value was non-finite) the rule recomputes from scratch to prevent drift. Sum uses Kahan compensation. `Min` and `Max` recompute only when the removed value was the current extreme.

## 5. Edge cases

- Self reference (`A1 = A1 + 1`) and cycles: `cycle` error naming the chain `A1 -> B1 -> A1`.
- A range containing the cell that uses it (`A1 = Sum(A1:A5)`): `cycle`.
- Deleting a column or row (UI action): shifts cells and rewrites every dependent definition on the tree (like paste with offset, but only for refs past the deleted band); references to deleted cells become undefined with reason `deleted_cell`. One batch, one undo.
- Inserting a row or column: same, shifting references that point at or past the insertion.
- Relative references in a fill that cross sheet borders: `off_sheet` (3.4).
- Cell holding a drawable object (point, function): it shows in the figure under the cell's name; the label is off by default for cells to avoid clutter.
- Sheet and slider: a cell can be a free number; the grid offers a slider handle when `A1 = 3 in 0..10` is used (the range syntax in the core design applies to a cell too).
- Mixed types in one column are fine; aggregates skip non-numbers and report a warning `skipped_non_numeric` with a count.
- Very long text in a cell: the cell shows the first line with an ellipsis; the formula bar shows it all.
- Large numbers: displayed with the cell's decimals; scientific notation beyond 1e15 or below 1e-6.

## 6. Better than the reference app

- **All-or-nothing batches** with one undo for fills, pastes and imports, and an update pass once per batch.
- **Tree rewriting** instead of text rewriting, so names that look like cells never confuse it, and errors name the exact reference.
- **Range edges** in the dependency graph, and incremental aggregates; large sheets stay fast.
- **Parse errors shown in the cell**, not silent text.
- **Typed pasting**: decimal comma handling, quoted fields, header detection, with warnings rather than silent coercion.
- **Virtualised grid** (only visible cells exist as DOM or canvas) and a canvas renderer for the sheet for the same speed as the figure.
- **Locked and input cells** for worksheets.
- **Everything is a line.** Every grid action reduces to lines the model can also write, so the live teacher can fill a table the same way a person does.

## 7. How it plugs into the kernel and the command table

- The command table (`CommandSpec`) gets the group `'sheet'`. The commands in 3.8 are entries with the normal `forms`.
- Actions (`Fill*`, `ClearCells`) return an `ActionResult` listing written cells; they are the first actions that create objects, so the action result type gains `created: ObjectId[]`.
- The type checker gets two extra parameter types: `CellAddr` (accepts a cell name or a call to `Cell`) and `Range`.
- `toScript()` writes sheet cells in row-major order as ordinary lines, after a `@sheet` directive, followed by `@cell` and `@colwidth` lines for formats. Loading replays them.

## 8. Changes to the core design

1. Add `@sheet cols rows`, `@cell A1 locked|input|fmt…`, `@colwidth`, `@rowheight` directives.
2. Add the reference token (`$A$1`), the range token (`A1:B3`) and the `Range` expression type (internal, not an object type).
3. Add `RuleInput` kind `'range'` to the dependency graph (3.5).
4. Add `Kernel.applyBatch` with all-or-nothing semantics and one update pass (3.10). The embed API, the paste feature and the teacher's multi-line `draw` all want it; `draw` can call it when the model asks for an "atomic" group.
5. Add optional `cell` field to the object record.
6. Action results can report created objects.
7. The reserved-name rule for cell patterns applies only when `@sheet` is present.

## 9. Must be in the kernel from day one

To avoid rework: batches (point 4), the `RuleInput` union (point 3), and the `cell` field (point 5). None needs the view or the sheet itself. The rest can wait.

## Sources studied

Removed before the repository was made public. The study notes above are in our own words.
