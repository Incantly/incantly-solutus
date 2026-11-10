# Lists and matrices: how the model uses them

## 1. Catalogue entries (given to the model)

Printed from the command table, one line per form. Two groups, loaded on demand: `lists` when the lesson mentions sequences, data, sorting, collections, or the script already uses a list; `matrices` when it mentions matrices, linear maps, equations in several unknowns, eigen anything. Binders are written as bare names in the form (`k`, `a`, `b`).

### Group `lists` (core subset; always loaded when any list exists)

```text
Seq(expr, k, from, to[, step]) -> List
Seq(n) -> List<Number>                       # 1..n
Range(from, to[, step]) -> List<Number>
Linspace(from, to, n) -> List<Number>
Repeat(x, n) -> List
Map(list, k, expr) -> List
Filter(list, k, cond) -> List
Zip(expr, a, listA, b, listB[, c, listC]) -> List     # equal lengths, or trim = true
Fold(list, acc, v, init, expr) -> value
Scan(list, acc, v, init, expr) -> List
Iterate(expr, x, start, n) -> Number|Point
IterateList(expr, x, start, n) -> List
IterateList(expr, a, b, first, second, n) -> List     # a is the older term
Count(list[, k, cond]) -> Number
Sum(list[, k, expr]) -> Number|Point|Vector
Product(list[, k, expr]) -> Number
Min(list) / Max(list) -> Number
ArgMin(list) / ArgMax(list) -> Number                 # 1-based position
Contains(list, x) -> Bool
IndexOf(x, list[, from]) -> Number                    # 0 if absent
Sort(list[, "up"|"down"]) -> List
Sort(list, k, key[, "up"|"down"]) -> List
Reverse(list) / Unique(list[, tol]) / Shuffle(list[, seed]) -> List
First(list) / Last(list) -> element
Head(list, n) / Tail(list, n) / Rest(list) -> List
Slice(list, from, to) -> List                         # inclusive, 1-based, -1 = last
Append(list, x) / Prepend(x, list) -> List
Insert(x|items, list, pos) -> List
Remove(list, x) / RemoveAt(list, pos) / RemoveUndefined(list) -> List
Join(list1, list2, ...) / Flatten(list[, depth]) -> List
Union(a, b) / Intersection(a, b) / Difference(a, b) -> List
CumSum(list) / Diff(list) -> List<Number>
Points(xs, ys) -> List<Point>
Xs(points) / Ys(points) -> List<Number>
OnAxis(xs) -> List<Point>
Tally(list) -> Record{values, counts}
```

About 520 tokens. Indexing note, included once in the grammar summary (about 25 tokens): `xs[1]` is the first, `xs[-1]` the last, `xs.length`.

### Group `matrices`

```text
Matrix([[1, 2], [3, 4]]) -> Matrix
Matrix(rows, cols, expr, i, j) -> Matrix              # entry (i, j) = expr
Identity(n) / Zeros(rows, cols) -> Matrix
Diag(list) -> Matrix       Diag(M) -> List<Number>
HStack(A, B, ...) / VStack(A, B, ...) -> Matrix
Submatrix(M, r1, r2, c1, c2) -> Matrix
Row(M, i) / Col(M, j) -> List<Number>
Transpose(M) / Invert(M) / Rref(M) / NullSpace(M) / ColSpace(M) -> Matrix
Determinant(M) / Rank(M[, tol]) / Trace(M) / Cond(M) -> Number
Norm(M[, "fro"|"1"|"inf"|"2"]) -> Number
Solve(A, b) -> List|Matrix                            # A x = b, least squares if not square
Eigenvalues(M) -> List<Point>                         # (re, im); real ones have im = 0
Eigenvectors(M) -> Matrix                             # columns; real eigenvalues only
Eigen(M) -> Record{values, vectors, multiplicities, defective}
Diagonalize(M) -> Record{P, D, jordan}
LU(M) -> Record{L, U, P}      QR(M) -> Record{Q, R}
SVD(M) -> Record{U, S, V}     Cholesky(M) -> Matrix
CharPoly(M) / MinPoly(M) -> Function
A + B, A - B, A * B, k * A, A * v, A * P, A ^ n       # n whole, -1 = inverse
M[i][j], M.rows, M.cols
```

About 540 tokens. With the grammar note on matrices (about 20 tokens), the two groups together cost about 1,100 tokens. Load only what the lesson uses; when neither is needed the cost is 0.

## 2. What `draw` returns

Per line, `ok` with `name`, `type`, `summary`. Summary rules (fit in about 120 characters, so the model can read it aloud):

| Type | Summary |
|---|---|
| `List<Number>` | `List<Number>[12] 1, 4, 9, 16, 25, 36, … 144 (min 1, max 144)` |
| `List<Point>` | `List<Point>[8] (1,2), (2,3), … (8,9)` |
| `Matrix` | `Matrix 2×2 [[2,1],[1,3]]` and, for square matrices up to 4×4, `det 5`; larger shows the first 3 rows |
| `Record` | `Record LU{ L: Matrix 3×3, U: Matrix 3×3, P: Matrix 3×3 }` |
| undefined | `undefined (singular): determinant is 0` |

`figure` lists every object with the same summary plus `visible`.

The teacher reads from the summary what it needs. It does not call `figure` to learn the length of a list it just made.

## 3. Writing lines: patterns

```text
squares = Seq(k^2, k, 1, 10)
P = Points(Seq(k, k, 1, 10), squares)          # drawn as ten points
fib = IterateList(a + b, a, b, 1, 1, 10)       # 1,1,2,3,5,...
big = Filter(squares, k, k > 20)
A = Matrix([[2, 1], [1, 3]])
e = Eigen(A)
v1 = Segment((0, 0), (e.vectors[1][1], e.vectors[2][1]))   # first eigenvector (column 1)
```

Habits the model should follow (a short block in the system prompt, about 60 tokens):

- Name every result.
- Binders are fresh names, never objects already in the figure.
- 1-based indices.
- Use a slider for sizes the learner may want to change (`n = 8 in 1..30 step 1`).
- Read `draw` summaries, do not guess lengths.

## 4. Fixing errors

| Error | What the model does next |
|---|---|
| `unknown_binder` | Rewrite using the binder named in `expected` |
| `no_matching_form` | Pick the form whose parameter list fits; the forms are in the object |
| `bad_argument` with `allowed` | Change the value; the `hint` has an example |
| `unknown_field` | Use a name from `expected` |
| `undefined (size_mismatch)` | Add `trim = true`, or build both lists from the same `n` |
| `undefined (singular)` | Do not retry. Say the matrix has no inverse and draw something else, such as `NullSpace` or a determinant readout |
| `undefined (complex_eigenvalues)` | Read `Eigenvalues(M)` and place them with a Point list |

At most two retries per line (core design 10). After two, the teacher says only what was drawn.

## 5. Live teacher snippets

### 5.1 Squares and a pattern (speech, then lines)

> "Let's list the first ten square numbers and see what they look like."

```text
n = 10 in 3..20 step 1
squares = Seq(k^2, k, 1, n)
P = Points(Seq(k, k, 1, n), squares)
```

`draw` returns `squares: List<Number>[10] 1, 4, 9, 16, 25, 36, … 100`, `P: List<Point>[10] (1,1), (2,4), … (10,100)`.

> "Ten points, and they curve upward. The gaps between neighbours are the odd numbers: 3, 5, 7. Here are the gaps."

```text
gaps = Diff(squares)
```

> "`gaps` is 3, 5, 7, 9, and so on. Slide `n` to make the list longer."

### 5.2 A matrix as a map of the plane

> "A 2 by 2 matrix moves every point of the plane. Take this one."

```text
A = Matrix([[2, 1], [1, 2]])
A with map = true
```

> "The square becomes a stretched parallelogram. Its signed area is the determinant."

```text
d = Determinant(A)
Readout("det A", d)
```

`draw`: `d: Number 3`.

> "The directions that only stretch are the eigenvectors. Here is the full picture."

```text
e = Eigen(A)
L1 = Line((0, 0), (e.vectors[1][1], e.vectors[2][1]))
L2 = Line((0, 0), (e.vectors[1][2], e.vectors[2][2]))
```

> "Along the first line points keep their size, factor 1. Along the second they stretch by 3."

(`e.values` is `(1,0), (3,0)`, in that order, so the first line goes with 1 and the second with 3.)

### 5.3 Recovering from an error

> "Can we undo this stretch? Let's find the inverse of a squashing matrix."

```text
B = Matrix([[1, 2], [2, 4]])
Binv = Invert(B)
```

`draw` result:

```json
[
  {"ok": true, "name": "B", "type": "Matrix", "summary": "Matrix 2×2 [[1,2],[2,4]] det 0"},
  {"ok": true, "name": "Binv", "type": "Matrix", "summary": "undefined (singular): determinant is 0 (exact)"}
]
```

> "No inverse appears, because the determinant is zero: this matrix squashes the whole plane onto a line, and many points land on the same spot, so there is nothing to undo. Let's show the line it flattens onto."

```text
N = NullSpace(B)
C = ColSpace(B)
```

`draw`: `N: Matrix 2×1 [[-2],[1]]`, `C: Matrix 2×1 [[1],[2]]`.

> "Points along this direction all land on zero, and everything else lands on this line."

(The teacher did not retry `Invert`; the undefined was a mathematical fact, not a typing slip.)

A typing slip, for contrast:

```text
w = Seq(j^2, k, 1, 5)
```

returns `unknown_binder` with `expected: ["k"]`. The next call is `w = Seq(k^2, k, 1, 5)`.

## 6. Token budget

| Item | Tokens |
|---|---|
| `lists` catalogue | about 520 |
| `matrices` catalogue | about 540 |
| Grammar notes for this area (1-based, `.length`, `M[i][j]`, Records) | about 60 |
| Habit block | about 60 |
| Typical `draw` result for three lines | 120 to 200 |

Together at most 1,200 if both are loaded; usually only one is.
