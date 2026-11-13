# Lists and matrices: builder notes

Built from `docs/features/lists-matrices/` and the spec in `.kiro/specs/lists-matrices/`. Lint, typecheck and the whole
suite pass; the area's own tests are in `packages/kernel/test/spec/lists/` (66 tests).

## What is built

| Part | Where | Notes |
|---|---|---|
| List commands (R1, R2) | `commands/lists/list-commands.ts` | Every command of design 4.1 to 4.6. Stepped ranges compute `from + i * step` with the `1e-9` count slack; step 0 is `bad_step`. Binders take the list's element type. `Sum` is compensated. `Sort` is stable with undefined last; `Unique` keeps first occurrences; `Shuffle` is seeded (mulberry32). Literal counts over 1,000,000 are `limit` at check time. |
| Broadcasting (R2.5) | `commands/lists/ops.ts` | `list op list` (equal lengths, else `size_mismatch`), `number op list`, `-list`. `list op number` was already a core row. |
| Matrix type (R3) | `types.ts`, `ops.ts` | Row-major `Float64Array`; fields `rows`, `cols`, `trace`; `M[i]` is a row, so `M[i][j]` is an entry. Operators of design 5.4, including `A * P` (2×2 linear, 3×3 homogeneous with `point_at_infinity`) and `A ^ n` by squaring. |
| Exact path (R3.3) | `exact.ts` | BigInt rationals. A matrix is exact when every literal entry is a number, `-x` or `a / b` of literals with at most 9 significant digits, up to 12×12 and 4,096 bits. Exact: `+ - *`, scaling, `^`, `Transpose`, `Determinant` (Bareiss), `Invert`, `Rank`, `Rref`, `Solve`, `NullSpace`, `Adjugate`, `CharPoly` (Faddeev–LeVerrier), `MinPoly` (Krylov). `Solve` with an exact matrix stays exact when the right side is short decimals. Summaries print exact entries as fractions. |
| Matrix commands (R4) | `matrix-commands.ts`, `linalg.ts` | Makers of 5.2, everyday operations of 6.1, factorisations of 6.2. Float algorithms: LU with partial pivoting and one refinement step, Householder QR, least squares by QR, Cholesky, one-sided Jacobi SVD, cyclic Jacobi for symmetric eigen, Hessenberg plus Francis double-shift QR for general eigenvalues, inverse iteration for eigenvectors (null space of `A − λI` for repeated ones). Tolerances scale with the matrix. Size limits of errors 5 give `too_large`. |
| Record type (R5) | `types.ts`, `ops.ts`, language | `Record<LU>`, `Record<QR>`, `Record<SVD>`, `Record<Eigen>`, `Record<Diagonalize>`, `Record<Tally>`. Fields typed from the schema; `lu.Z` is `unknown_field` listing the real fields. A field may be undefined while the others are defined (`Eigen(M).vectors` with complex eigenvalues). Other areas add schemas with `registerRecordSchema`. |
| Errors (R6) | kernel tables | Kinds `unknown_field` (C070), `bad_option` (C072); reasons `size_mismatch`, `not_rectangular`, `not_square`, `singular`, `not_positive_definite`, `complex_eigenvalues`, `needs_exact`, `bad_step`, `point_at_infinity`, `too_large`, `empty_matrix`, `has_undefined`; notices `ill_conditioned` (L101), `least_squares` (L102), `approximate` (L103). |

## Language changes this area needed

All generic, for any area type; listed in `docs/features/kernel/design.md` ("Area hooks"):

- Area operator, unary and index rows (`registerBinaryOp`, `registerUnaryOp`, `registerIndexOp`), and area equality in
  comparisons.
- `Record<Schema>` types (`Ty.schema`), `registerFieldNames` for `unknown_field`.
- `@list` and `=param` parameter types; values are checked before binders.
- `registerValueText` for summaries.
- A binder whose element type is a list (`Map(rows, r, r[1])`) is one name, not a list of names.

## Decided against the design

- **`Trace(M)` is not a command**: the animation area's `Trace(P)` action owns the name. Use the field `M.trace`.
  To be confirmed by the product owner.
- **Jagged list literals are refused by the language** (`[[1, 2], [3]]` is a `type_mismatch`), against design 10 which
  allows them. A ragged `Matrix` literal therefore fails with the language's `type_mismatch` (with the row lengths)
  rather than `bad_argument`. Jagged lists still come from commands (`Map(L, r, Head(r, k))`). Product owner to decide
  whether the language should allow jagged literals.
- **`unknown_binder` is not used**: the language reports an unknown name inside a body as `unknown_name` (language
  regression LANG-SM-16), with the local names among its suggestions.
- **A list with an undefined element is undefined as a whole** (language 3.10), not NaN inside the list. Commands that
  build lists report `has_undefined` with the first bad element.
- **`Minor(M, i, j)`** is the matrix without row i and column j (design 5.2); `Cofactor` gives the signed determinant.
  Design 6.1 also lists `Minor` as returning a Number.
- **`Flatten`** flattens one level (a list of lists into a list); deeper nesting needs it again.
- **`Close(a, b, tol)`** is a core-function change and is not built.

## To be implemented

- `Zip(…, trim = true)`: named arguments are not built; unequal lengths are always `size_mismatch`.
- Jordan form in `Diagonalize` (defective matrices give `needs_exact` for now).
- The plane-map drawable of a 2×2 or 3×3 matrix (`with map = true`) and the editable grid (view and studio rounds).
- The `cost` hint for heavy rules while dragging (design 8.3).
- Warnings `large_result` and `exact_dropped`.

## Found in another area

- After `SetValue(n, 5)` (numbers), formulas that read `n` update, but command objects that read it (`Range(1, n)`,
  geometry's `Midpoint((0, 0), (n, 0))`) keep their old value until the next update pass. `setFree` followed by
  `flush` updates everything. For the numbers area to look at.
