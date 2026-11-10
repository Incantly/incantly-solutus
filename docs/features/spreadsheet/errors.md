# Spreadsheet: errors

All errors use the core format (section 9 of the core design): `ok: false`, `line`, `col`, `endCol`, `kind`, `token`, `message`, `expected`, `forms`, `hint`. New `kind` values are listed here and must be added to the core table. Runtime problems are **not** errors: they are undefined values with a reason.

## 1. Parse errors

| Kind | When | GeoGebra | Ours |
|---|---|---|---|
| `syntax` | A bad reference such as `A` + `$` alone, `A1:` with no end, `A1:B` | One generic "check your input" message | Position, token, and `expected: ["row number"]` etc. |
| `bad_reference` | `$` not followed by letters or digits; a column beyond `ZZ`; row 0; row above 9999 | Often silently becomes a different name | Names the part that is out of range, e.g. column `AAA` |
| `range_not_object` | `r = A1:C5` | Not applicable (it makes a list) | Hint: `ListFrom(A1:C5)` or `MatrixFrom(A1:C5)` |
| `range_misplaced` | A range used where a number is wanted: `A1:B3 + 1` | Evaluates to a list and then fails later | Error at the range, hint names commands that accept ranges |

## 2. Name and type errors

| Kind | When | Ours |
|---|---|---|
| `cell_out_of_range` | `Z200 = 1` when the sheet is 26 x 100 | Says the current size and `@sheet` to enlarge it |
| `reserved_name` | Defining a point named `B2` in a figure that has a sheet | Hint: use `P_B2` or remove `@sheet` |
| `no_sheet` | A cell reference or sheet command in a figure with no `@sheet` | Hint: add `@sheet 26 100` first |
| `cell_locked` | Editing a locked cell, or a paste/fill that includes one | Lists the locked cells in the target (up to 5) and says nothing was applied |
| `bad_shape` | `PointsFrom` on a range with other than 2 columns; `MatrixFrom` on empty range; `OperationTable` smaller than 2 x 2 | Gives expected and actual shape |
| `no_matching_form` | e.g. `FillColumn(2)` | Standard, lists forms |
| `type_mismatch` | `FillColumn(1, 5)`: a number where a list is needed | Standard |
| `type_change` | Script redefines a cell with a different type | Hint: `ClearCells(B2)` first |
| `cycle` | `A1 = B1`, `B1 = A1`; range containing its own cell | Message gives the chain `A1 -> B1 -> A1` in `token` order; `chain: ["A1","B1","A1"]` extra field |

## 3. Batch and limit errors

| Kind | When | Ours |
|---|---|---|
| `batch_failed` | Any line of a batch failed | `failedIndex`, the inner error, `applied: 0`. Nothing changed |
| `limit` | More than 50,000 cells in a paste; 20,000 cell objects; 2,000 ranges; file over 5 MB | `limit: { name, max, actual }` |
| `import_format` | A file with a binary header, or not text, or unreadable encoding | Says what was seen in the first bytes |
| `import_conflict` | Import target cells already filled and `replace` is false | Lists first few conflicts |

## 4. Runtime: undefined with a reason

| Reason | When | Display |
|---|---|---|
| `off_sheet` | A shifted reference lands outside the grid | Cell shows `#OFF`; tooltip explains |
| `deleted_cell` | A referenced row or column was deleted | `#DEL` |
| `empty_cell` | A command needs a value (matrix, operation table) and found a hole | `#EMPTY` |
| `not_numeric` | An aggregate had zero numeric inputs (e.g. `Mean` of text) | `#NUM` |
| `div_zero`, `out_of_domain`, `not_finite` | As core | `#DIV`, `#DOM`, `#INF` |
| `upstream` | An input is undefined | `#UP`, tooltip names the first undefined input |

The kernel's per-line report lists the undefined cells and their reasons. For a batch, it lists at most 20, then a count.

## 5. How GeoGebra handles them, and how we are better

- GeoGebra shows a dialog for a failed cell entry, or silently turns it into text. Ours: the cell shows a red border and the error text under it; the cell is not changed.
- GeoGebra's paste can fail half way. Ours: all or nothing.
- GeoGebra gives no reason for an undefined cell. Ours: reason codes, short display text, tooltip.
- GeoGebra's circular reference message does not say the chain. Ours does.

## 6. Example error objects

An out-of-size cell:

```json
{
  "ok": false, "line": 1, "col": 1, "endCol": 5,
  "kind": "cell_out_of_range",
  "token": "Z200",
  "message": "Cell Z200 is outside the sheet (26 columns by 100 rows).",
  "expected": [],
  "forms": [],
  "hint": "Use @sheet 26 200 to make the sheet taller, or pick a row from 1 to 100."
}
```

A cycle:

```json
{
  "ok": false, "line": 2, "col": 1, "endCol": 3,
  "kind": "cycle",
  "token": "B1",
  "message": "B1 would depend on itself through A1.",
  "chain": ["B1", "A1", "B1"],
  "expected": [], "forms": [],
  "hint": "Remove one of the two references."
}
```

A bad shape:

```json
{
  "ok": false, "line": 3, "col": 14, "endCol": 20,
  "kind": "bad_shape",
  "token": "A1:C10",
  "message": "PointsFrom needs 2 columns; A1:C10 has 3.",
  "expected": ["a range with 2 columns, e.g. A1:B10"],
  "forms": ["PointsFrom(Range) -> List<Point>"],
  "hint": "Use A1:B10, or choose two columns."
}
```

A failed batch:

```json
{
  "ok": false,
  "kind": "batch_failed",
  "failedIndex": 17,
  "applied": 0,
  "message": "Nothing was filled: line 18 of 40 failed.",
  "cause": {
    "ok": false, "line": 18, "col": 5, "endCol": 7, "kind": "unknown_name",
    "token": "k2", "message": "k2 is not defined.", "hint": "Did you mean k1?"
  }
}
```

A paste with warnings (success, `ok: true`):

```json
{
  "ok": true,
  "written": 120,
  "warnings": [
    { "kind": "text_number_mix", "cell": "B7", "message": "'1,2,3' looks like a number list; stored as text." },
    { "kind": "skipped_non_numeric", "cell": "C1", "count": 1 }
  ]
}
```

## 7. Recovery for a model

- `cell_out_of_range`: the next line is `@sheet 26 N` then the original line.
- `reserved_name`: rename the object (`P_B2`).
- `bad_shape`: call `figure()`; the range of used cells is in its summary; fix the range.
- `batch_failed`: fix the one line at `failedIndex` and resend the whole batch.
- `cell_locked`: tell the learner; do not try again.
