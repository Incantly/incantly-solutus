# Lists and matrices: requirements

Area: `docs/features/lists-matrices/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Cross-area decisions:
`docs/features/README.md`. Branch: `feat/lists-matrices`.

### R1. Building lists

**User story:** As a learner, I want to build a list from a rule in one line, so that I can see a whole sequence at once.

**Acceptance criteria:**

1. THE SYSTEM SHALL provide `Seq`, `Range`, `Repeat`, `Linspace`, `Map`, `Zip`, `Fold`, `Scan`, `Iterate` and
   `IterateList` with the forms of design 4.1.
2. THE SYSTEM SHALL compute element `i` of a stepped `Seq` or `Range` as `from + i * step`, with the count
   `floor((to - from) / step + 1e-9) + 1`, the empty list when the sign is wrong, and undefined `bad_step` for a step
   of 0 (design 4.1, 10).
3. WHEN a binder takes the elements of a list (`Map(points, p, …)`), THE SYSTEM SHALL give the binder the list's
   element type (design 3.2).
4. THE SYSTEM SHALL refuse a literal count above 1,000,000 with `limit` (errors 5).

### R2. Testing, totals, reordering, cutting and sets

**User story:** As a teacher, I want the everyday list commands, so that a lesson never needs a loop.

**Acceptance criteria:**

1. THE SYSTEM SHALL provide the commands of design 4.2 to 4.6 with their forms, 1-based positions and negative
   positions from the end.
2. `Sum` SHALL use compensated summation (8.1); `Sum([])` is 0, `Product([])` is 1; `Min`, `Max`, `First`, `Last`,
   `ArgMin` and `ArgMax` of an empty list SHALL be undefined `empty_list` (10).
3. `Sort` SHALL be stable, sort numbers by value with undefined last, texts by code point and points by x then y, and
   take `"up"` or `"down"` (any other text is `bad_option`).
4. `Unique` SHALL keep the first occurrence in the original order; `Tally` SHALL return a Record with `values` and
   `counts`.
5. `+ - * / ^` SHALL work on a `List<Number>` and a Number on either side, and on two lists of the same length
   (design 4.7); unequal lengths are undefined `size_mismatch`.

### R3. The Matrix type

**User story:** As a learner, I want a real matrix, so that shape mistakes are named and `1/3` stays `1/3`.

**Acceptance criteria:**

1. THE SYSTEM SHALL add a `Matrix` type: rectangular, row-major `Float64Array`, with fields `rows`, `cols` and
   `trace` (square only), and `M[i]` as row `i` (a `List<Number>`), so `M[i][j]` is one entry (design 5.1).
2. THE SYSTEM SHALL provide the makers of design 5.2. A ragged literal is `bad_argument` at check time; a ragged list
   at run time is undefined `not_rectangular`.
3. WHEN every entry of a matrix literal is a number literal, THE SYSTEM SHALL keep an exact rational grid, used by
   `+ - *`, `^` with a whole exponent, `Transpose`, `Determinant`, `Invert`, `Rank`, `Rref`, `Solve`, `NullSpace` and
   `CharPoly` up to 12×12 (design 5.3).
4. THE SYSTEM SHALL provide the operators of design 5.4: `A ± B`, `k * A`, `A * k`, `A / k`, `A * B`, `A * v` (a
   list), `A * P` for a 2×2 (linear) or 3×3 (homogeneous) map, `A ^ n`, `-A`, `A == B`.

### R4. Matrix commands

**User story:** As a learner, I want determinants, inverses, eigenvalues and factorisations with reasons when they
fail, so that I know why.

**Acceptance criteria:**

1. THE SYSTEM SHALL provide the commands of design 6.1 and 6.2 with the algorithms of 8.3, the tolerance
   `max(m, n) * eps * ‖M‖`, and the reasons `not_square`, `singular`, `not_positive_definite`,
   `complex_eigenvalues`, `needs_exact`, `no_convergence`, `too_large`, `size_mismatch`.
2. Commands that return several matrices SHALL return a Record (R5).
3. `Eigenvalues` SHALL return each eigenvalue as a point `(re, im)`, ordered by real part then imaginary part.

### R5. The Record type

**User story:** As a model writing lines, I want named results, so that `LU(A).L` reads like it says.

**Acceptance criteria:**

1. THE SYSTEM SHALL add a `Record` type whose schema is fixed per command form, with fields read by `.name`; an
   unknown field is an error naming the real fields (design 7).
2. A field MAY be undefined while the others are defined.

### R6. Errors

**Acceptance criteria:** THE SYSTEM SHALL register the error kinds, undefined reasons and warnings of
`errors.md` that R1 to R5 use.

## Decided against the design

- **`Trace(M)` is not a command**: the animation area's `Trace(P)` action has the name. The trace of a matrix is the
  field `M.trace`. To be confirmed by the product owner.
- **A list with an undefined element is undefined as a whole**, as the language already does (language design 3.10);
  design 9's "NaN elements inside a list" is not followed. `RemoveUndefined` therefore works on point lists with a
  `NaN` coordinate.
- **`Close(a, b, tol)`** (design 12, item 10) is a core-function change and is not built here.
- **Jagged list literals** stay refused by the language (`type_mismatch`); design 10 allows them. To be decided by the
  product owner.
- **`unknown_binder`** is not used: the language's `unknown_name` (LANG-SM-16) covers an unknown name in a body.
- **`Minor`** is the matrix without row i and column j (design 5.2); `Cofactor` is the signed determinant.
