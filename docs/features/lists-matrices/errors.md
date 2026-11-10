# Lists and matrices: errors

Follows section 9 of the core design: every error is data with `line`, `col`, `endCol`, `kind`, `token`, `message`, `expected`, `forms`, `hint`. Runtime problems are not errors; they make a value undefined with a reason code.

## 1. How GeoGebra handles failures here

- A line that does not parse gives one generic message. Brackets in a list literal that do not match give "unbalanced brackets" without a position.
- A command with wrong arguments gives "illegal argument" or "wrong number of arguments" and appends the accepted forms. This is good and we keep it.
- A matrix command given a non-rectangular or non-numeric list returns an undefined object. There is no reason and nothing says which row was wrong.
- A non-invertible matrix gives an undefined result. Nothing tells the user that the determinant is zero.
- An index out of range on a list element gives undefined.
- Very large lists are not limited by a rule the user can see; the app slows down or runs out of memory.
- Rounding makes integer-looking results neat, which also hides near-singular matrices.

## 2. Our error kinds in this area

Static errors (found when the line is checked; nothing is applied).

| Kind | When | Fields beyond the core set |
|---|---|---|
| `syntax` | Broken list or matrix literal, missing `]`, `[1, , 2]`, `[1..]` | `expected` lists the tokens |
| `unknown_command` | `Sorted(xs)` | `hint` names `Sort` |
| `no_matching_form` | Wrong count or types | `forms` lists every accepted form |
| `type_mismatch` | `[1, (2, 3)]`; `A * (1, 2)` for a 3×3; `xs + ys` when broadcasting is off | `expected`, `got` |
| `unknown_binder` | A scoped expression uses a name that is not a binder or an object, as in `Seq(j^2, k, 1, 5)` | `token = "j"`, `hint` lists the binders and a close object name |
| `binder_not_used` (warning only) | `Seq(5, k, 1, 5)`: the binder never appears | in the `warnings` list of an `ok` result |
| `unknown_field` | `lu.Z`, `m.rowz` | `expected` = the real field names |
| `bad_argument` | A literal argument is wrong: `Matrix([[1, 2], [3]])`, `Identity(-1)`, `Linspace(0, 1, 0)`, `Slice(xs, 3, 1)` with literal bounds that can never work, `Norm(M, "l3")` | `param` (parameter name), `got`, `allowed` |
| `bad_option` | A text option outside its set: `Sort(xs, "ascending")` | `allowed`: `["up", "down"]` |
| `reserved_name` | A binder named like a command or keyword: `Seq(k, if, 1, 5)` | |
| `type_change` | Redefining a list with a different element type | |
| `cycle` | `xs = Append(xs, 1)` | The path of names in `hint` |
| `limit` | A constant size over the limit: `Seq(k, k, 1, 5000000)`, `Identity(100000)` | `limit`, `got` |

## 3. Runtime: undefined reasons

A rule that cannot compute sets its output to undefined with a reason code and a short human `detail`. The kernel reports the list of undefined objects after each line.

| Reason | Where | Detail example | GeoGebra | Recovery for the teacher |
|---|---|---|---|---|
| `empty_list` | `Min`, `Max`, `First`, `Last`, `ArgMin`, `ArgMax` | "xs has no elements" | Undefined, no reason | Give the list an element, or check the filter that made it |
| `index_out_of_range` | `xs[i]`, `Slice` from-bound beyond end for `First/Last` forms | "xs has 5 elements, asked for 7" | Undefined | Clamp the index, or change the slider's range |
| `size_mismatch` | `Zip`, `HStack`, `A + B`, `A * B`, broadcast | "lengths 5 and 6" or "3×2 cannot multiply 4×4" | Undefined | Use `trim = true` (`Zip`) or fix a length |
| `not_rectangular` | `Matrix(list of lists)` at runtime | "row 3 has 2 entries, row 1 has 3" | Undefined | Pad the row |
| `not_square` | `Determinant`, `Invert`, `Eigen…`, `CharPoly`, `Trace`, `A ^ n` | "matrix is 3×2" | Undefined | Use `Rank` or `Solve` for non-square |
| `singular` | `Invert`, `Solve`, `A ^ -1` | "determinant is 0" (exact) or "pivot 3e-17 below 2e-14" | Undefined | Use `NullSpace`, `Rank`, or `Solve` on a different `b` |
| `not_positive_definite` | `Cholesky` | "leading minor 2 is not positive" | n/a | Check symmetry first with `M == Transpose(M)` |
| `complex_eigenvalues` | `Eigenvectors`, `Diagonalize` | "2 of 3 eigenvalues are complex" | Not available | Read `Eigenvalues` (they are points in the plane) |
| `needs_exact` | `MinPoly`, `Diagonalize` (Jordan case) | "entries are not small rationals" | n/a | Use whole numbers or short decimals |
| `no_convergence` | General eigen, SVD, Jacobi | "QR iteration hit 600 steps" | n/a | Scale the matrix; the detail names the largest residual |
| `bad_step` | `Seq`, `Range` with step 0 or not finite | "step is 0" | Undefined | |
| `not_finite` | Overflow in products, determinants | "entry 2,1 is inf" | Undefined | Scale the matrix |
| `too_large` | Matrix operation bigger than its limit at run time (sizes come from sliders) | "SVD supports 100×100, got 140×140" | Slow or crash | Reduce the size |
| `empty_matrix` | Operation on 0×n | | | |
| `point_at_infinity` | `A * P` with homogeneous w near 0 | "w = 3e-17" | Undefined | |
| `has_undefined` | Aggregate over a list that contains an undefined element | "element 4 is undefined (division_by_zero)" | Undefined | `RemoveUndefined(xs)` |

Where several reasons apply, the first in the table above wins and the `detail` names the first offending element.

## 4. Warnings

An `ok` result may carry `warnings: Warning[]` (a core-design addition used across areas). Warnings never block a line.

| Warning | When |
|---|---|
| `binder_not_used` | Binder never appears in the expression |
| `ill_conditioned` | A float `Invert` or `Solve` with estimated condition number above 1e12; carries `cond` |
| `shadowed_name` | A binder hides an object name inside the expression |
| `large_result` | A list over 100,000 elements will be decimated when drawn |
| `exact_dropped` | A matrix literal exceeded exact size limits and became floating point |

## 5. Limits

| Limit | Value | Kind when exceeded |
|---|---|---|
| List length | 1,000,000 | `limit` (static if known) or undefined `too_large` |
| Leaf values in nested lists | 4,000,000 | same |
| Matrix multiply, determinant, inverse, solve, LU, QR | 300 × 300 | same |
| Symmetric eigen | 150 × 150 | same |
| General eigen, SVD, Jordan-free diagonalise | 100 × 100 | same |
| Exact path | 12 × 12, 4,096-bit entries | falls back to floats with a warning |
| Jordan form | 8 × 8 | undefined `needs_exact` |
| Line length | the core limit | `limit` |

## 6. Example error objects

A wrong form:

```json
{
  "ok": false,
  "line": 3,
  "col": 6,
  "endCol": 21,
  "kind": "no_matching_form",
  "token": "Zip",
  "message": "Zip has no form (Number, List, List).",
  "expected": [],
  "forms": [
    "Zip(expr, a, listA, b, listB) -> List",
    "Zip(expr, a, listA, b, listB, c, listC) -> List",
    "Zip(expr, a, listA, b, listB, c, listC, d, listD) -> List"
  ],
  "hint": "Zip takes the expression first, then each list with its own local name."
}
```

An unknown binder:

```json
{
  "ok": false,
  "line": 2,
  "col": 10,
  "endCol": 11,
  "kind": "unknown_binder",
  "token": "j",
  "message": "j is not defined inside Seq. The local name here is k.",
  "expected": ["k"],
  "forms": ["Seq(expr, k, from, to) -> List"],
  "hint": "Write Seq(k^2, k, 1, 5)."
}
```

A bad literal matrix:

```json
{
  "ok": false,
  "line": 1,
  "col": 5,
  "endCol": 28,
  "kind": "bad_argument",
  "token": "[[1, 2], [3]]",
  "message": "Matrix needs rows of equal length: row 1 has 2 entries, row 2 has 1.",
  "param": "rows",
  "got": "[[1, 2], [3]]",
  "allowed": "equal-length rows",
  "forms": ["Matrix(rows: List<List<Number>>) -> Matrix", "Matrix(rows, cols, expr, i, j) -> Matrix"],
  "hint": "Add a second entry to row 2, for example [3, 0]."
}
```

Undefined at run time (not an error; shown in the post-line report):

```json
{
  "ok": true,
  "name": "Ainv",
  "type": "Matrix",
  "summary": "undefined (singular): determinant is 0",
  "undefined": { "reason": "singular", "detail": "determinant is 0 (exact)", "inputs": ["A"] }
}
```

A warning that comes with a defined value:

```json
{
  "ok": true,
  "name": "B",
  "type": "Matrix",
  "summary": "Matrix 3×3, det 1.2e-13",
  "warnings": [{
    "kind": "ill_conditioned",
    "message": "B is nearly singular (condition number about 8.4e12). Its inverse will be unreliable.",
    "cond": 8.4e12,
    "hint": "Check the rows for near-duplicates; Rank(B) with a tolerance shows the true rank."
  }]
}
```

A limit:

```json
{
  "ok": false,
  "line": 5,
  "col": 20,
  "endCol": 27,
  "kind": "limit",
  "token": "5000000",
  "message": "A list may have at most 1,000,000 elements; this Seq makes 5,000,000.",
  "limit": 1000000,
  "got": 5000000,
  "hint": "Use fewer terms, or Linspace with a smaller n."
}
```

## 7. Better than GeoGebra

- Every undefined carries a reason and the offending input, so "why is there no inverse" has an answer.
- Shape errors in literals are caught when the line is checked, not when a downstream object turns undefined.
- Binder mistakes are named, with the binder list as `expected`.
- Tolerance is explicit in the detail text (`pivot 3e-17 below 2e-14`).
- Near-singular but defined results come with a warning and a condition number; GeoGebra hides this by rounding.
- Record field errors list the real field names.
- Size limits are published and consistent, and a slider that pushes a size over the limit gives `too_large`, not a freeze.
