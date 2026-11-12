# Lists and matrices: design

Status: draft for review. Fits `docs/design/formula-language-and-kernel.md` (the "core design"). Companion areas: `docs/features/statistics/` (descriptive statistics, fits, charts, tests), `docs/features/probability/` (distributions, random sampling). This area owns the `List` type in full, the `Matrix` and `Record` types, and every command that builds, reshapes, searches or decomposes them.

## 1. What this area does

A learner or the live teacher needs to hold many values under one name: the terms of a sequence, the marks of a class, the corners of a shape, a table of coefficients. They need to build such a collection from a rule, change it, search it, and feed it to something else (a plot, a statistic, a transform). A second need is matrices: a grid of numbers that maps the plane, solves several equations at once, or describes a change of basis.

For the learner:

- Type `squares = Seq(k^2, k, 1, 10)` and see ten numbers, or ten points if the rule gives points.
- Drag a slider that the list reads and watch the whole list rebuild.
- Write a 2×2 matrix, see the unit square it maps to, its determinant as a signed area, and its eigen-directions as lines through the origin.

For the teacher (the live voice): every command below is one short line. The result of `draw` says the length and the first few elements, so the teacher can talk about them without calling `figure`.

### Sub-features

| Sub-feature | Where |
|---|---|
| List literals, ranges, indexing, equality | 3.1 |
| Build: `Seq`, `Range`, `Repeat`, `Linspace`, `Zip`, `Map`, `Fold`, `Scan`, `Iterate`, `IterateList` | 4.1 |
| Select and test: `Filter`, `Count`, `Contains`, `IndexOf`, `Min`, `Max`, `ArgMin`, `ArgMax`, `Sum`, `Product` | 4.2 |
| Reorder: `Sort`, `Reverse`, `Shuffle`, `Unique`, `Rank` helpers | 4.3 |
| Cut and join: `Head`, `Tail`, `Slice`, `First`, `Last`, `Rest`, `Append`, `Prepend`, `Insert`, `Remove`, `RemoveAt`, `RemoveUndefined`, `Join`, `Flatten` | 4.4 |
| Sets: `Union`, `Intersection`, `Difference` | 4.5 |
| Lists of points: `Points`, `Xs`, `Ys`, `OnAxis` | 4.6 |
| Running values: `CumSum`, `Diff` | 4.2 |
| Matrix type, literals, generators, operators | 5 |
| Matrix commands: transpose, determinant, inverse, rank, row reduction, solve, null space, trace, norms, condition | 6.1 |
| Matrix factorisations: LU, QR, SVD, Cholesky, characteristic and minimal polynomial, eigen-anything, Jordan form | 6.2 |
| Record type (shared with statistics and probability) | 7 |
| Plane-map display of 2×2 and 3×3 matrices | 9 (view hooks) and `ui.md` |

Out of scope here, with the owner: spreadsheet cell, row, column and fill commands (no spreadsheet in v1); selected-element and selected-index of a dropdown (controls-scripting); random choice and shuffling with seeds (shuffle is declared here, the random machinery in `probability`); vector products and unit vectors (geometry and vectors); applying a matrix to a shape (transforms, which calls the `Matrix * Point` rule below).

## 2. How the reference app does it (summary)

Read from the source and the manual; described in our words.

- **A list is one object type holding other objects.** Every element is a full object with its own value, style and drawing. A list of 1,000 points is 1,000 objects held inside one. This makes lists of anything possible (lists of lists, of segments, of texts), and it makes them heavy.
- **Sequences rebuild elements through the whole object machinery.** The sequence rule keeps a local variable, and for each step it copies the expression, updates it and stores the resulting object. It also guards against being re-entered while updating. It works and handles any element type, but a 100,000-term list pays object-creation cost 100,000 times, and each rebuild when an input moves repeats that.
- **A matrix is not a type.** It is a list whose elements are lists of numbers. Determinant, inverse, transpose, rank and row reduction copy the nested lists into an internal numeric matrix, compute, and copy back. A ragged or non-numeric list gives an undefined result with no reason.
- **Tolerance is a global constant.** Zero tests use one fixed epsilon. The determinant of an all-integer matrix is rounded to a whole number after the float computation; the inverse of an integer matrix is cleaned by multiplying by the rounded determinant, rounding and dividing. These are practical tricks that keep classroom examples tidy (`2` not `1.9999999999999996`) but they hide real errors: a nearly singular integer-looking matrix can print a confident wrong answer.
- **Eigen and decomposition commands are limited.** Eigenvalues and eigenvectors are offered for small matrices; there is a singular value decomposition, an LU and QR decomposition, a Jordan form, characteristic and minimal polynomials. Results come back as lists of lists of numbers. Complex results are not first-class.
- **Many list commands exist as separate objects**: sort (with an optional key list), unique (which also sorts), union, intersection, flatten, insert, remove, reverse, append, take, first, last, join, index-of, count-if, keep-if (a filter), zip, product, sum, min, max, frequency. Most take lists of numbers only or lists of any element; the checks are hand written per command.
- **Weak spots**: lists of objects instead of values (cost), no typed matrix (shape errors surface late and silently), tolerance by one constant, rounding hacks that hide numeric error, no incremental update, no reason when a result is undefined, and sorting or uniqueness rules that change the element order without saying so.

## 3. Our design: the List type

### 3.1 Values and syntax

A list holds values, not objects. Elements have no style, no label, no id.

```ts
type ElemType = Exclude<TypeName, 'Particles'>;     // anything but Particles

type ListValue =
  | { readonly elem: 'Number'; readonly data: Float64Array }          // NaN marks an undefined element
  | { readonly elem: 'Bool'; readonly data: Uint8Array }              // 0, 1
  | { readonly elem: Exclude<ElemType, 'Number' | 'Bool'>; readonly items: readonly Value[] };
```

- Lists are immutable. Every rule that changes a list builds a new one. Rules reuse the input array when the output is identical (for example `Sort` on an already-sorted list returns the same array), so equality checks are pointer checks first.
- A list has one element type, which may itself be a list or a matrix row. `[1, (2, 3)]` is `type_mismatch`.
- `[]` is a list whose element type is open. It unifies with the other argument where it is used (`Append([], (1, 2))` is a `List<Point>`). Stored alone (`xs = []`) it is `List<Number>`.
- Literals and ranges come from the core grammar: `[1, 2, 3]`, `[a, b + 1]`, `[1..10]`. We add: `[a..b]` has `floor(b - a) + 1` elements counting from `a` in steps of 1 (a descending range `[5..1]` is allowed); the element is computed as `a + i`, never by accumulation.
- **Indexing is 1-based**: `xs[1]` is the first element. `xs[-1]` is the last, `xs[-2]` the one before. `xs[0]` or out of range is undefined with reason `index_out_of_range` (not an error, because the index may come from a slider). Reason for 1-based: it is how a learner counts and how every textbook writes `a₁`.
- Fields: `xs.length` (Number). For a list of points, `xs.x` and `xs.y` are not provided (use `Xs` and `Ys`).
- Equality `==` and `!=` compare element by element, exactly. Two lists of different lengths are unequal. `Close(a, b, tol)` is a core-function candidate (see section 11).
- Maximum list length: 1,000,000 elements (`limit`, section "Limits" in `errors.md`). A list of lists may hold at most 4,000,000 leaf values in all.

### 3.2 Scoped expressions (binders)

Several commands take an expression and a local name: `Seq(k^2, k, 1, 10)`. The core design shows this with `Seq` and `Map`. We make the shape explicit so the checker, the catalogue printer and the dependency tracker all treat it the same way.

```ts
type ParamSpec =
  | { name: string; type: TypeName | ListOf<TypeName> | Generic; optional?: boolean }     // as the core design
  | { name: string; binder: true; of: ParamRef }          // a fresh local name bound to elements of another parameter
  | { name: string; scoped: true; returns: TypeName | Generic };   // an expression checked with the binders in scope
```

How the checker handles a form with binders:

1. Resolve the non-scoped parameters first (the list, the bounds).
2. Introduce the binder names with the element type of what they bind to (`k` is `Number` for `Seq(…, k, 1, 10)`, `Point` for `Map(points, p, …)`).
3. Type-check the scoped expression with those names in scope. A binder name may not shadow an object or a command (`reserved_name` if it collides with a keyword or command; shadowing an object is allowed inside the expression only and reported as a warning).
4. Compile the expression once into a closure over a small slot array. Run it per element by writing the binder slots and calling the closure. No object, no allocation for `Number` results.
5. The rule's input list is the expression's free names, minus the binders. A slider that the expression reads is therefore an input; the binder is not.

Binders live only inside the command's parentheses. After the line they are gone.

### 3.3 Cost, laziness and incremental update

- Targets: `Seq(sin(k), k, 1, n)` with n = 100,000 in under 5 ms; with n = 1,000,000 in under 50 ms. `Sort` of 1,000,000 numbers in under 150 ms (typed-array sort). `Unique` of 1,000,000 numbers in under 120 ms.
- A rule recomputes only when one of its inputs changes. Dragging a slider that is outside the list's inputs costs nothing.
- Lists that feed only a plot are sampled lazily: a `List<Point>` with more than 20,000 points is drawn by decimating to screen resolution (see `ui.md`). The data stays complete.
- For a large `Seq` whose body depends on `k` only and one slider `a` the rule keeps no state between runs. We do not build a partial-update scheme in v1: a rebuild at under 50 ms per million terms is enough.

## 4. List commands

All commands are PascalCase, listed with their forms in our syntax. `T` stands for any element type; `N` for `Number`. Forms are tried in the order shown. Index positions are 1-based; ranges in `Slice` are inclusive.

### 4.1 Build

| Command | Forms | Notes |
|---|---|---|
| `Seq` | `(expr, k, from, to)`, `(expr, k, from, to, step)`, `(n)`, `(from, to)` | Whole-number or stepped `k`. `Seq(n)` is `[1..n]`. Element i is `from + i*step`. Count = `floor((to - from)/step + 1e-9) + 1`; zero if the sign is wrong. A step of 0 is undefined (`bad_step`). |
| `Range` | `(from, to)`, `(from, to, step)` | Same count rule as `Seq` but the elements are the numbers themselves. |
| `Repeat` | `(x: T, n)` | `n` copies. |
| `Linspace` | `(from, to, n)` | `n` points evenly spaced, both ends included. `n = 1` gives `[from]`. |
| `Map` | `(list, k, expr)` | As in the core design. |
| `Zip` | `(expr, a, listA, b, listB)`, up to four pairs | One output per index. Lists of unequal length: undefined `size_mismatch`; `trim = true` as a last named argument cuts to the shortest. |
| `Fold` | `(list, acc, v, init, expr)` | Reduce: `acc` starts at `init`; for each element `v` the next `acc` is `expr`. Result is the last `acc`. |
| `Scan` | `(list, acc, v, init, expr)` | Like `Fold`, but returns every step's `acc` (length = list length). |
| `Iterate` | `(expr, x, start, n)` | Apply `expr` (which reads `x`) `n` times from `start`. Number or Point. |
| `IterateList` | `(expr, x, start, n)` | The `n + 1` values from `start` on, including `start`. |
| `IterateList` | `(expr, a, b, first, second, n)` | Two-term recurrence: next = `expr(a, b)` where `a` is the older term. `n` further terms; result has `n + 2` elements. |

`n` must be a whole number from 0 to 1,000,000. `Fold`, `Scan` and `Iterate` use the same closure machinery as `Seq`.

### 4.2 Test, count, total

| Command | Forms | Notes |
|---|---|---|
| `Count` | `(list)`, `(list, k, cond)` | Length, or how many elements satisfy `cond`. |
| `Contains` | `(list, x)` | Bool. Numbers compare exactly. |
| `IndexOf` | `(x, list)`, `(x, list, from)` | First position at or after `from`, or 0 when absent. (0 is never a valid position, so no ambiguity; a Number result keeps lessons simple.) |
| `Sum` | `(list)`, `(list, k, expr)` | Numbers, Points (component sums), Vectors, Text (concatenation). Numbers use compensated summation (section 8.1). |
| `Product` | `(list)`, `(list, k, expr)` | Numbers. |
| `Min`, `Max` | `(list)` | Numbers, or Text. Undefined for an empty list (`empty_list`). |
| `ArgMin`, `ArgMax` | `(list)` | Position of the first minimum or maximum. |
| `CumSum` | `(list)` | Running totals. |
| `Diff` | `(list)` | Successive differences; length minus one. |
| `Filter` | `(list, k, cond)` | Elements for which `cond` is true, order kept. |

`Mean`, `Median` and the rest of the descriptive statistics are in `statistics`.

### 4.3 Reorder and dedupe

| Command | Forms | Notes |
|---|---|---|
| `Sort` | `(list)`, `(list, order)`, `(list, k, key)`, `(list, k, key, order)` | `order` is the text `"up"` (default) or `"down"`. Stable. Numbers by value, Text by code point, Points by x then y. The `key` form sorts by `key` computed per element (a list of N, Text or Point keys). Undefined numbers sort last in either order. |
| `Reverse` | `(list)` | |
| `Shuffle` | `(list)`, `(list, seed)` | Seeded; see `probability`. |
| `Unique` | `(list)`, `(list, tol)` | Keeps the **first** occurrence of each value, original order. `tol` merges numbers closer than `tol` after sorting a copy. Use `Sort(Unique(list))` for a sorted set. |
| `Tally` | `(list)` | A Record with `values` (unique, sorted) and `counts`. Lives here because it only needs equality; `statistics` uses it for frequency tables. |

### 4.4 Cut, grow and join

| Command | Forms | Notes |
|---|---|---|
| `First`, `Last` | `(list)` | One element. Undefined `empty_list` when empty. |
| `Head`, `Tail` | `(list, n)` | First or last `n` elements; fewer if the list is shorter. |
| `Rest` | `(list)` | All but the first. |
| `Slice` | `(list, from, to)` | Inclusive, 1-based; negative counts from the end; clamps to the list. |
| `Append` | `(list, x)` | `x` must have the element type. |
| `Prepend` | `(x, list)` | |
| `Insert` | `(x: T, list, pos)`, `(items: List<T>, list, pos)` | `pos` is the position the first inserted item will have. If `T` is itself a list the first form wins; use `Join` to splice lists. |
| `Remove` | `(list, x)` | Removes every element equal to `x`. |
| `RemoveAt` | `(list, pos)` | |
| `RemoveUndefined` | `(list)` | Drops undefined elements; also drops points with an undefined coordinate. |
| `Join` | `(list1, list2, …)`, `(lists: List<List<T>>)` | |
| `Flatten` | `(list)`, `(list, depth)` | Whole flatten, or the given number of levels. |

### 4.5 Sets

`Union(a, b)`, `Intersection(a, b)`, `Difference(a, b)`: treat lists as sets of exactly-equal values; the result keeps first-occurrence order of `a` then `b`. They accept `tol` as an optional third argument for numbers. Sets of Points compare both coordinates.

### 4.6 Lists of points

| Command | Forms | Notes |
|---|---|---|
| `Points` | `(xs, ys)`, `(xs)` | Zips two number lists into points; `Points(xs)` gives `(1, x1), (2, x2), …`. |
| `Xs`, `Ys` | `(points)` | Coordinates as number lists. |
| `OnAxis` | `(xs)` | The points `(x, 0)`: handy for marking roots found by `Roots`. |

Short forms for `MeanX`, `SDY`, `Sxy` and similar are not separate commands: `Mean(Xs(P))` does it, and statistics commands accept `List<Point>` directly where the x and y lists belong together.

### 4.7 Broadcasting (recommended core change)

The core design forbids mapping over lists. Fits, residuals and every statistics lesson then need `Map` for trivial work: `res = Map(Points..., ...)`. We recommend allowing `+ - * / ^` and the built-in functions on `List<Number>` as scalar-list and equal-length list-list operations, returning `List<Number>`. Unequal lengths are undefined `size_mismatch`. Matrix and List are different types, so `A * B` for matrices stays a matrix product. If the core design declines, every example here still works with `Map` and `Zip`.

## 5. The Matrix type

### 5.1 Representation

```ts
interface MatrixValue {
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;                 // row-major, length rows*cols
  readonly exact?: RationalGrid;               // present when every entry is a small exact rational (5.3)
}
interface RationalGrid { readonly num: readonly bigint[]; readonly den: readonly bigint[]; }   // row-major
```

- A matrix is rectangular by construction. Ragged input never becomes a matrix.
- Entries are Numbers. A matrix of Points, Text or other types is a `List<List<T>>`, not a Matrix.
- Row and column counts are fixed per value but may change when a rule runs again (a matrix built from a slider-sized `Seq` changes shape). Dependants that need a square matrix recheck.
- `M.rows`, `M.cols`, `M.trace` (square only) are fields. `M[i]` gives row `i` as `List<Number>`; `M[i][j]` gives one entry (both 1-based, negative from the end).

### 5.2 Making matrices

| Command | Forms | Notes |
|---|---|---|
| `Matrix` | `([[1, 2], [3, 4]])` | From a list of equal-length number lists. A ragged literal is the error `bad_argument` at check time when all lengths are literal; otherwise undefined `not_rectangular`. |
| | `(rows, cols, expr, i, j)` | Generator: entry `(i, j)` is `expr`. Binders `i` and `j` are 1-based. |
| `Identity` | `(n)` | |
| `Zeros` | `(rows, cols)` | |
| `Diag` | `(list)`, `(M)` | Diagonal matrix from a list; or the diagonal of a matrix as a list. |
| `FromRows`, `FromCols` | `(lists)` | Same data as `Matrix`, with the choice of reading each list as a row or a column. |
| `HStack`, `VStack` | `(A, B, …)` | Join side by side or top to bottom. Shape mismatch: undefined `size_mismatch`. |
| `Submatrix` | `(M, r1, r2, c1, c2)` | Inclusive ranges. |
| `Row`, `Col` | `(M, i)` | As a `List<Number>`. |
| `Minor` | `(M, i, j)` | Remove row `i` and column `j`. |
| `ToLists` | `(M)` | Back to `List<List<Number>>`. |

A free matrix is `A = Matrix([[2, 1], [1, 3]])`. Entries given by formulas make it dependent: `B = Matrix([[a, -b], [b, a]])` reads sliders `a` and `b`. The view shows a free matrix as an editable grid (see `ui.md`); editing a cell rewrites the line.

### 5.3 Exact mode for classroom integers

Learners compare their hand work to the screen. A float answer of `0.33333333333333337` for `1/3` helps nobody, and the reference app's rounding tricks hide real errors. We do this instead:

- When every entry of a matrix literal is a decimal literal of at most 9 significant digits (no formulas, no sliders), the matrix also keeps the exact rational grid. Entries as `BigInt` numerator and denominator.
- Operations that can stay exact do: `+ - *`, `Transpose`, `Determinant`, `Invert`, `Rank`, `Rref`, `Solve`, `NullSpace`, `CharPoly`, `^` with an integer exponent. The exact path is used only if the matrix has at most 12 rows and 12 columns, and the BigInt sizes stay below 4,096 bits (else it falls back to floats and drops `exact`).
- The float `data` is always filled with the nearest double to the exact value. Anything that reads the matrix as numbers sees an ordinary matrix.
- Display uses `exact` when present: `1/3` rather than `0.333…`. The formatting rule is the numbers area's `fraction` display mode.
- Any operation involving a non-exact matrix is floating point and drops `exact`. A matrix that has a slider in it is never exact.
- This replaces "round the result if the input looked like integers". A nearly singular matrix with integer-looking entries no longer prints a rounded wrong answer: its exact determinant is exactly what it is.

### 5.4 Operators

| Expression | Result | Notes |
|---|---|---|
| `A + B`, `A - B` | Matrix | Same shape, else undefined `size_mismatch`. |
| `k * A`, `A * k`, `A / k` | Matrix | |
| `A * B` | Matrix | Columns of `A` equal rows of `B`. Blocked loop; 300×300 in under 60 ms. |
| `A * v` where `v` is `List<Number>` | `List<Number>` | `v` is a column. |
| `A * P` where `P` is Point or Vector | Point or Vector | `A` is 2×2 (linear), or 3×3 with the point as `(x, y, 1)` (homogeneous; result divided by w, undefined `point_at_infinity` if w ≈ 0). |
| `A ^ n` | Matrix | Integer `n`; negative is inverse then power; `n = 0` is identity. Square-and-multiply. |
| `A == B` | Bool | Exact comparison. |

`List * Matrix`, `Matrix * Matrix` of unequal shapes and `Matrix ^ 0.5` are type errors or undefined; see `errors.md`.

## 6. Matrix commands

Inputs are `Matrix` unless noted. A `List<List<Number>>` is accepted where a Matrix is expected and converted once (rectangular check included), so `Determinant([[1, 2], [3, 4]])` works.

### 6.1 Everyday operations

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `Transpose` | `(M)` | Matrix | |
| `Determinant` | `(M)` | Number | Square. Exact path first (Bareiss, no division); else LU with partial pivoting. |
| `Invert` | `(M)` | Matrix | Square, non-singular. Float: LU with pivoting and iterative refinement (one step). Exact path via fraction-free elimination. Undefined `singular` when the exact determinant is 0 or the float pivot is below `n * eps * ‖M‖∞`. If condition estimate exceeds 1e12 the value is still defined and `Cond(M)` shows why it is untrustworthy (see 8.3). |
| `Rank` | `(M)` | Number | Exact path where possible; else SVD with the tolerance `max(rows, cols) * eps * σ_max`. Optional `tol` second argument. |
| `Rref` | `(M)` | Matrix | Reduced row echelon form. Float: Gauss–Jordan with partial pivoting and the tolerance above, tiny entries set to 0. Exact path gives fractions. |
| `Solve` | `(A, b)` | List or Matrix | Solves `A x = b`. `b` is a `List<Number>` (gives a list) or a Matrix (gives a matrix). Square: LU. Otherwise least-squares by QR (a flag in the summary). Singular: undefined `singular` with a hint to use `NullSpace`. |
| `NullSpace` | `(M)` | Matrix | Columns form a basis of the solutions of `M x = 0`; zero columns if full rank. From RREF (exact) or SVD (float). |
| `ColSpace` | `(M)` | Matrix | A basis of the column space (pivot columns of the original). |
| `Trace` | `(M)` | Number | |
| `Norm` | `(M)`, `(M, kind)` | Number | `kind` is `"fro"` (default), `"1"`, `"inf"`, `"2"` (largest singular value). |
| `Cond` | `(M)` | Number | 2-norm condition number from singular values; `inf` when singular. |
| `Dim` | `(M)` | `List<Number>` | `[rows, cols]`. Or use fields. |
| `Minor`, `Cofactor`, `Adjugate` | `(M, i, j)`, `(M, i, j)`, `(M)` | Number or Matrix | Cofactor and adjugate from the exact or float determinant. |
| `Kron` | `(A, B)` | Matrix | Kronecker product. |

### 6.2 Factorisations and eigen-anything

Several commands return more than one matrix. They return a Record (section 7), with the fields named below.

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `LU` | `(M)` | Record `{ L, U, P }` | `P * M = L * U`, partial pivoting. `L` unit lower, `P` a permutation matrix. |
| `QR` | `(M)` | Record `{ Q, R }` | Householder. `Q` has orthonormal columns. |
| `Cholesky` | `(M)` | Matrix | Lower factor `L` of a symmetric positive-definite `M`, `L Lᵀ = M`. Undefined `not_positive_definite`. |
| `SVD` | `(M)` | Record `{ U, S, V }` | One-sided Jacobi. `S` is a list of singular values in descending order; `M = U diag(S) Vᵀ`. |
| `Eigenvalues` | `(M)` | `List<Point>` | Each eigenvalue as `(re, im)`: real ones have `im == 0`. They are drawn as points in the complex plane at once. Order: by real part, then imaginary part; multiplicity repeated. |
| `Eigenvectors` | `(M)` | Matrix | Columns, unit length, in the order of `Eigenvalues`. Defined only when every eigenvalue is real (else undefined `complex_eigenvalues`). |
| `Eigen` | `(M)` | Record `{ values, vectors, multiplicities, defective }` | `values` as in `Eigenvalues`; `vectors` a Matrix (columns) or undefined; `multiplicities` list of (algebraic) counts; `defective` Bool. For a symmetric matrix the vectors are orthonormal. |
| `Diagonalize` | `(M)` | Record `{ P, D, jordan }` | `M = P D P⁻¹` if diagonalisable; `jordan` is true when `D` is a Jordan form and `P` holds generalised eigenvectors. Real eigenvalues only; else undefined `complex_eigenvalues`. |
| `CharPoly` | `(M)` | Function | `det(x I - M)` as a polynomial in `x`. Exact path for integer matrices. |
| `MinPoly` | `(M)` | Function | Smallest monic polynomial `p` with `p(M) = 0`. Needs the exact path (small rational matrices); else undefined `needs_exact`. |
| `ApplyMatrix` | `(M, shape)` | shape | Declared in transforms; calls `M * P` per defining point. Listed for completeness. |

Algorithms in section 8.

## 7. The Record type

Several results have named parts: LU gives three matrices, a test gives a statistic, a p-value and a confidence interval, a fit gives a function and its error. Returning a list loses names; returning many objects needs multi-output lines the core design does not have.

```ts
interface RecordValue {
  readonly schema: RecordSchema;            // field names and types, fixed per command form
  readonly fields: Readonly<Record<string, Value>>;   // any field may be undefined with its own reason
  readonly draws?: string;                  // name of a field the view draws on behalf of the record
}
interface RecordSchema { readonly name: string; readonly fields: readonly { name: string; type: TypeName }[]; }
```

- A Record is one object. `lu = LU(A)` makes it. Fields are read with the dot: `lu.L`, `lu.P`. The checker knows the schema, so `lu.Z` is the error `unknown_field` listing the real field names.
- A field may be undefined while the others are defined (`Eigen(M).vectors` is undefined when eigenvalues are complex; `.values` is not).
- Records are read-only and cannot be written in a line. They only come from commands.
- `draws` lets a record show something without more lines: a `Fit` record draws its curve. See `statistics`.
- Records take part in `toScript` as their defining line; nothing about the fields is saved.
- A value summary for `draw` and `figure` lists the field names, types and a short value for each (`ui.md`, `agent.md`).

This is a **core design change** (section 11).

## 8. Numerical methods

### 8.1 Summation

`Sum` and `Mean` (statistics) use Neumaier-style compensated summation. A million-term sum of `0.1` is within 1 ulp of the correctly rounded result. `CumSum` compensates each running total.

### 8.2 Sorting and searching

- Numbers: copy into a Float64Array, `sort()` (numeric), move NaN to the end. Stable sort for other types uses the engine's stable sort with a comparator by type.
- `Unique`: for exact mode a `Map` keyed on a canonical value (`-0` becomes `0`); for `tol` mode sort a copy and sweep.
- `IndexOf`, `Contains`, `Remove`: linear scan; a `Set` is built only when a rule scans the same list repeatedly (`Intersection`, `Difference`).

### 8.3 Linear algebra

Target sizes (rows = cols = n) and time budgets on a mid-range laptop:

| Operation | Algorithm | n limit | Budget |
|---|---|---|---|
| Multiply | blocked loops | 300 | under 60 ms at 300 |
| Determinant, solve, inverse | LU, partial pivoting (+ 1 refinement for inverse and solve) | 300 | under 40 ms at 200 |
| Exact determinant, inverse, rank, RREF | Bareiss / fraction-free Gauss–Jordan on BigInt | 12 | under 20 ms |
| QR | Householder | 300 | under 80 ms at 200 |
| Symmetric eigen | Householder tridiagonalisation then implicit QL | 150 | under 60 ms at 100 |
| General eigen | Hessenberg reduction, then shifted QR (double-shift) to real Schur form | 100 | under 80 ms at 60 |
| Eigenvectors (general, real) | back-substitution on the Schur form, then normalise | 100 | included |
| SVD | one-sided Jacobi (sweeps until off-diagonal below `eps * norm`, max 60) | 100 | under 100 ms at 60 |
| Rank, null space (float) | SVD | 100 | |
| Rank, RREF (float) | pivoted elimination with the SVD tolerance estimated from the infinity norm | 300 | |
| Characteristic polynomial | Faddeev–LeVerrier on BigInt (exact path); float path via eigenvalues, flagged `approximate` | 12 exact; 100 float | |
| Minimal polynomial | exact Krylov sequence of `I, M, M², …` over the rationals until dependent | 12 | |
| Jordan form | exact only: rational roots of `CharPoly`, then chains from kernels of `(M - λI)ᵏ` | 8 | |

Accuracy targets:

- LU residual `‖P M - L U‖ ≤ 4 n eps ‖M‖`.
- Inverse: `‖M M⁻¹ - I‖∞ ≤ 8 n eps cond(M)` (reported by tests); typical well-conditioned 100×100 within 1e-13.
- Eigenvalues: backward stable, error `≤ c n eps ‖M‖`; repeated eigenvalues are reported with multiplicity by clustering values closer than `1e-8 * ‖M‖` for the `multiplicities` field only (the `values` list keeps the computed numbers).
- SVD singular values with high relative accuracy (Jacobi).
- Symmetric eigenvectors orthogonal to `~eps`.

Tolerance is not a global constant. It scales with the matrix: `tol = max(m, n) * eps * ‖M‖`. The test files include near-singular examples (Hilbert matrices of size 8, rank-deficient noise) as golden tests.

Heavy rules (cost estimate above 20 ms at the current size) are marked in the rule's `cost` hint so the frame scheduler can show the last value while a slider drags, and recompute once at release. This is a small scheduler flag, not a new kind of rule.

### 8.4 Plane maps

For a 2×2 matrix `A` the view can show how `A` deforms the plane (section 9 and `ui.md`): the images of the unit square, basis vectors and a grid; `det A` as signed area (negative = orientation flipped); real eigenvectors as lines through the origin; singular directions. This uses `A * P`, `Eigen`, `SVD`, no extra maths.

## 9. How it plugs into the kernel

- **Command table.** Each command above is a `CommandSpec` row. `group` is `lists`, `matrices`. Forms with binders use the `ParamSpec` of 3.2. The catalogue printer prints them as one-liners (`agent.md`).
- **Rules.** Each form's `rule` receives the checked inputs (typed values) and returns a value or `undefined(reason)`. Reasons used in this area: `empty_list`, `index_out_of_range`, `size_mismatch`, `not_rectangular`, `not_square`, `singular`, `not_positive_definite`, `complex_eigenvalues`, `needs_exact`, `bad_step`, `not_found` (only for `Solve`), `point_at_infinity`, `no_convergence`, `too_large`.
- **Drawables.** `List<Point>`: one batch drawable (points or polyline with `with connect = true`). `List<Segment>`, `List<Circle>`, `List<Polygon>`: one batch per element type. `List<Text>`: texts drawn at their anchors. Lists of numbers and matrices have no drawable of their own; they appear in the side panel (readouts) and as data for other objects. A Matrix object has an optional **plane map** drawable (style `with map = true`, section 8.4).
- **Style.** One style for the whole list (color, width, label of the list as a group). Elements do not carry style. A per-element colour is made by a list of colours: `with color = list` (the core `Color` list) is allowed for point lists.
- **Dependencies.** An element's value reads like any other free name. `xs[2]` is a rule with inputs `xs` and the index expression's names. A slider driving `xs[k]` re-evaluates only the index lookup.
- **Undefined elements.** An undefined element inside a list is NaN (numbers) or a marker (other types). It is skipped by the drawable, and aggregate commands report `has_undefined` unless the model removed it with `RemoveUndefined`.
- **Redefinition.** Changing `xs` from `Seq(k, k, 1, 5)` to `Seq(k^2, k, 1, 5)` keeps its id and anything that reads it. Changing a list's element type is `type_change`.

## 10. Edge cases

- Empty lists: `Sum([])` is 0, `Product([])` is 1, `Count([])` is 0; `Min`, `Max`, `First`, `Last`, `ArgMin` of an empty list are undefined `empty_list`.
- `Seq` with `from > to` and a positive step is the empty list (not an error), so `Seq(k, k, 1, n)` with `n = 0` is empty.
- Float ranges: `Seq(k, k, 0, 1, 0.1)` has 11 elements. Element `i` is `from + i*step` (never a running sum, so no drift), and the count uses a `1e-9` slack so the last element is not lost to rounding.
- NaN and infinities: `+inf` and `-inf` are legal elements (sorted at the ends); NaN is the undefined marker.
- Lists of lists with different lengths are fine (jagged) and are not matrices.
- A matrix with 0 rows or columns is allowed only as the result of `Zeros(0, n)`; operations on it return the usual identities (`Determinant` of 0×0 is 1) or undefined `empty_matrix`.
- Sorting mixed integer and float values is plain numeric. Sorting `Point`s with an undefined coordinate puts them last.
- `A ^ -1` and `Invert(A)` give identical values and share a cache entry.
- Very large entries (above 1e150) in matrix products can overflow to `inf`: undefined `not_finite`.

## 11. Better than the reference app

- **Values, not objects.** A million-number list is one `Float64Array`. The reference app holds a million objects.
- **A real matrix type.** Shape is known at check time for literals; every shape problem has a name; the `exact` path gives `1/3` without rounding tricks. No silent "undefined".
- **Reasons everywhere.** `singular`, `not_square`, `complex_eigenvalues` explain themselves to the teacher.
- **Tolerance scales with the matrix.**
- **First-class complex eigenvalues** as points in the plane.
- **Records** for multi-result commands: `Eigen(M).values`, `LU(A).L`.
- **Plane-map view** that shows determinants, eigen-lines and singular directions with one style flag.
- **Seeded and deterministic:** `Shuffle` and `Unique` are pure functions of their inputs.
- **Incremental behaviour is simple:** a list rule recomputes only when its inputs change.
- **Unique keeps order**, with sorting left to `Sort`: a learner can see what happened.

## 12. Changes to the core design

1. **Add the `Matrix` type** (section 5) and its operators (5.4) to the type table (section 4 of the core design). `List * Matrix` is not defined.
2. **Add the `Record` type** (section 7), fields read with `.name`, schemas fixed per command form. The command form's `returns` becomes `TypeName | RecordSchema | null`.
3. **Add binder parameters** to `CommandForm` (3.2) so `Seq`, `Map`, `Filter`, `Zip`, `Fold`, `Scan`, `Iterate`, `Sum(list, k, expr)` and others share one mechanism.
4. **Fix list indexing at 1-based** with negative counting from the end, `xs.length`, and `ListValue` as typed arrays for Numbers.
5. **Allow broadcasting** of `+ - * / ^` and built-in functions over `List<Number>` (4.7). Optional; recommended.
6. **Add error kinds** `unknown_field` and `bad_argument` (argument value can be judged wrong at check time) to the table in core section 9. See `errors.md`.
7. **Add undefined-reason codes** listed in section 9 of this document to the core reasons list.
8. **Add a `cost` hint** on rules (8.3) so the frame scheduler can delay heavy rules while dragging.
9. **Allow `[a..b]` ranges to be descending**, computing element `i` as `a + i` (rather than accumulating).
10. **Add the function `Close(a, b, tol)`** (also useful in teaching "equal up to rounding") to the built-in list.

## 13. Open questions

1. Should `Eigenvalues` return a `Complex` type if the numbers area adds one, instead of `List<Point>`? Points show the values in the plane already; a `Complex` type would give algebra (`z1 * z2`). Keep points for v1.
2. Should the exact path extend to matrices with symbolic entries (`a`, `b`) later? That needs the CAS the core design leaves out.
3. Do we expose per-element style (colour a single point inside a list) through a style list, or force separate objects? Current answer: style list for colour only.

## Sources studied

Removed before the repository was made public. The study notes above are in our own words.
