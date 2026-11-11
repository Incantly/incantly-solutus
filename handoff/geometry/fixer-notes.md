# Geometry area: fixer notes

## Fixer round

Branch `feat/geometry`. Input: `handoff/geometry/test-report.md` (61 failing spec tests of 493). Code changed only in
`packages/kernel/src/commands/geometry/`. After this round 457 of 493 geometry spec tests pass and 36 fail; none of the
36 can be fixed inside this area (see "To be implemented"). Whole repo: 3,937 of 3,973 tests pass.

Checks: `npx eslint .` clean. `npx vitest run`: 36 failures, all in `test/spec/geometry/`. `npx tsc -p tsconfig.json`:
8 errors, all at `packages/kernel/test/spec/geometry/conics.test.ts` line 157 (`x`/`y` "possibly undefined" in the
five-point residual test). That file is the tester's and may not be edited; the same 8 errors appear on the
unchanged branch head. The source compiles with no error.

## Fixes (test-report item numbers in brackets)

### Group 1: paths and measures
- **`PointOn` unit on lines and rays [9].** A line built from two points or a point and a vector now stores its first
  defining point `p` and the vector length `len`; a ray stores `len`. `linePath` and `rayPath` measure the normalised
  parameter in units of `len` from `p` (points-lines 3.2). A line from an equation keeps the foot of the origin and a
  unit of 1. Files: `types.ts` (`HLine.p`, `HLine.len`), `paths.ts`, `points.ts`.
- **Hyperbola default parameter [10].** `PointOn(h)` uses 0.25 (the first vertex), other paths 0.5 (conics 3.5).
- **Feuerbach point [15].** The incircle touches the nine-point circle from inside, so the point is the external
  homothety centre `(R/2·I − r·N)/(R/2 − r)`. `TriangleCenter` 12 (its reflection across the nine-point centre) uses the
  same value.
- **`Angle(Line, Line)` [19].** Counter-clockwise from the first line, wrapped to `[0, pi)`.
- **`Relation(Point, Line)` [20].** A point or vector is not compared by direction against a line; it falls through to
  the incidence test.
- **`Direction(Line(equation))` [22].** The equation line stores its normal so that `(b, -a)` has a positive first
  non-zero component (points-lines 5.2).
- **`PerpVector` of a segment, ray or line [23].** Same length as the defining vector (`len`), turned 90° counter-clockwise.

### Group 2: intersections and tangents
- **Pair of lines [4, 29, 31].** `splitPair` built its parametrisation on the wrong points, so a degenerate conic such as
  `x^2 - y^2 == 0` kept one line. It now restricts the form to a coordinate line missing the singular point and solves the
  homogeneous quadratic. This fixes `Intersect(line, pair)`, `Center` of a pair, `Asymptote` of a pair, and every other
  reader of `lines`.
- **Parallel threshold [3].** `intersectLineLine` treats lines as parallel at a sine of `tol * 1e-3` (1e-12 for the default
  tolerance), not `tol` (points-lines 4.2 step 4, 10.1). A meeting point past 1e14 is `too_far`.
- **Conic-conic slot order [5].** Angles around the centroid are measured counter-clockwise from the first conic's major
  axis in `[0, 2 pi)`; they were left in `(-pi, pi]`.
- **Tangent contact [8].** The tangency test scaled its tolerance by `|alpha * gamma|`, which is about 0 when the line's
  foot of the origin is the touching point. It now also uses the size of the terms that add up to `gamma`. A double root
  is no longer Newton-polished (zero derivative). `Intersect(Tangent(Q, c)[1], c)` returns the touching point.
- **Tangent from a point to a hyperbola [30].** The "inside" sign test against the centre is for ellipses only. For a
  hyperbola the polar's intersection decides, so a point on an asymptote gets its one finite tangent (conics 6.2 step 5).
- **Touching roots of functions [7].** `scanRoots` refines a grid minimum of `|f - g|` by golden-section search and accepts
  it below `1e-10 * scale`, so `1 + cos(x)` meets the axis at `pi` (points-lines 4.6). The scan is shared by all function
  intersections.

### Group 3: conics
- **Five-point conic [26].** The Hartley de-normalisation used the inverse scale (`E = [1,0,-cx; 0,1,-cy; 0,0,s]` instead
  of `[s,0,-s cx; 0,s,-s cy; 0,0,1]`). The conic now passes through its five points.

### Group 4: polygons and transforms
- **`Vertex`/`Side` with a computed index that is not whole [38].** `not_whole` (polygons-transforms errors 4).
- **`Convex` with a repeated vertex [39].** Consecutive duplicates are dropped before the turns are summed (design 10).
- **Line grazing a corner [42].** A piece of the line counts as a chord only when its midpoint is strictly inside the
  polygon or on an edge that runs along the line.
- **Union of polygons sharing an edge [41].** The shifted copy of the second polygon is tested for contact exactly (the
  shift is below the tolerance), the inside test that labels crossings is exact, and when `+shift` merely separates the
  polygons the opposite shift is tried. The result is one polygon of area `8 - 3e-9`.
- **Degenerate mirror [43].** Every line-based transform (Reflect, Shear, Stretch, progress forms, the `Transform` values)
  gives `coincident_points` when the axis has no direction, not `zero_length` (design 6.4, 390).
- **Inversion near the centre [44].** A point within `1e-12 r` of the centre maps to `too_far`; the centre itself stays
  `at_infinity`. The rule is in `applyStored`, so `Then` chains follow it.
- **A function turned or reflected [48 and part of 47].** `Rotate(f, ...)` and `Reflect(f, line)` return a `Curve`
  (design 6.7: "anything else" is a Curve). `Reflect(f, line)` was `no_matching_form`; it now gives the Curve. Added forms
  `rotateFuncRule` and `reflectLineFuncRule`.

## To be implemented (owner)

Each item is a spec test that still fails, with the reason it cannot be fixed in `packages/kernel/src/commands/geometry/`.

### Kernel: no check-time hook on a command form (errors design: "Check time")
A rule runs only after the line is accepted. The command spec has no hook that sees a literal argument or the type of an
argument and refuses the line, and `ErrorKind` has no entries for `not_a_path`, `not_a_region`, `no_dependency`,
`not_quadratic`, `not_polynomial`, `bad_equation`, `too_few_points`, `not_supported`, `not_a_transform`. Needed: a
`check(args)` hook on `CommandForm` that returns an `ErrorObject`, and the new kinds in the error table. Failing tests:
- `Vertex(s, 3)` on a segment, `Intersect(l, m, 2)`, `Intersect(l, m, 0)`, `TriangleCenter(A, B, C, 14)`,
  `Circle(O, -2)`, `Conic([1, 0, 1, 0, 0])`, `Polygon(O, 1, 2)`, `Polygon(O, 1, 1001)`, `Vertex(sq, 0)`, `Side(tri, 7)`:
  literal `bad_argument` / `limit` [1, 2, 16, 24, 25, 35, 36, 37].
- `PointOn(r, 0.5)` with a Number, `PointOn(A)` with a Point: `not_a_path`; `PointIn(line)`: `not_a_region` [12, 14].
- `Conic(x^3 + y == 1)`, `Conic(sin(x) + y == 0)`: `not_quadratic`, `not_polynomial` [27].
- `Conic(x^2 + y^2)` (no `==`): `bad_equation`. The language already refuses it earlier with `free_variable` [28].
- `Polygon(A, B)`: `too_few_points` with a hint naming `Segment` [34].
- `Reflect(segment, circle)`, `Reflect(polygon, circle)`: `not_supported` [45]. `Move(tri, 3)`: `not_a_transform` [46].
- `Intersect(sin, cos)` with no interval: needs a "polynomial" check on a `Function` argument [6].
- `Locus(W, P)` with W independent of P and `Locus(P, M)` the wrong way round: definition-time `no_dependency` [18].

### Kernel: free parameters owned by a command (points-lines 13.1)
`PointOn`, `PointIn` and `Rigid` need a value of their own that a drag writes; a literal argument is not a parent object,
so `planDrag` gives `not_draggable`, and a rule cannot read the definition of its argument.
- `dragPlan` of `P = PointOn(c, 0.25)` and `PointOn(s, 0.5)` [11] (two tests).
- `ParamOf(P)` with one argument [13] (two tests).
- `Locus(M, P)` with `P = PointOn(c, 0.1)`: `slice` needs a free source [17] (two tests).
- `Rigid(A, B, C)` should snapshot the points and then stop depending on them [40]. A rule must be pure, so a snapshot
  needs a kernel-owned value.

### Kernel: operator hint
`u * w` of two vectors: the kernel's `type_mismatch` hint says `dot(u, w)`; the doc says `Dot(u, v)` and `Cross(u, v)`
[21]. The hint text is in the kernel operator table, outside this area.

### Functions (calculus) area: function forms
The functions area owns function values and exact derivatives (conics design 6.6, 7; polygons-transforms 6.7); it needs to
merge forms into the geometry specs (duplicate names are dropped today):
- `Asymptote(f)` for `1/x` and for a polynomial [32] (two tests).
- `Curvature(P, f)` and `OsculatingCircle(P, f)` [33] (two tests).
- `Reflect(f, vertical line)` must be a `Function`, `g(x) = f(2c - x)` [47]. The geometry forms return a `Curve` for any
  line because the checker cannot tell an axis-parallel line from the type alone; the functions area needs the
  literal-line check at check time (design 6.7).

## Contested tests

None. Every test follows its doc line.

Note on the tester's report, item 21 (`Dot`/`Cross` hint): correct, but owned by the kernel (see above).

## Same rule, every case

- Parallel threshold: all callers of `intersectLineLine` (Intersect, Relation, predicates, tangents, line pairs, bisectors).
- Pair-of-lines split: every reader of a degenerate conic's `lines` benefits (Intersect, Center, Asymptote, Relation).
- Tangency scale: shared by line-circle, line-conic, circle-circle (radical line), tangent contact and the polar test.
- Degenerate-axis reason: all 17 axis checks in `transforms.ts` changed together.
- `not_whole` for `Vertex`/`Side`; `Vertex` of a segment or ray and the `Intersect` index forms keep
  `index_out_of_range` (the points-lines doc has no `not_whole` row).
- Line and ray `len`: `PointOn`, `Along`, `ParamOf`, `PerpVector`.

## Check-time round (after the kernel hook)

The kernel now has check-time hooks on commands (`CommandForm.check`, `CommandSpec.refuse`; errors design 5.0), merged in from `feat/kernel-check`. Spec tests failing: 19, from 36. Lint and typecheck are clean.

### Done

- `packages/kernel/src/commands/geometry/checks.ts` holds every geometry hook; `commands.ts` attaches them by command and parameter name.
- Literal checks (`bad_argument`, or `limit` for more than 1,000 sides): `Vertex(segment, k)`, `Vertex(polygon, k)`, `Side(polygon, k)` below 1, `Intersect(line, line, k)`, `TriangleCenter(..., n)`, `Circle(O, r)` with a negative radius, `Conic([...])` with a list that is not 6 long, `Polygon(..., sides)`.
- Arguments that fit no form: `PointOn` (`not_a_path`), `PointIn` (`not_a_region`), `Polygon(A, B)` (`too_few_points`, hint names `Segment`), `Reflect(shape, circle)` (`not_supported`), `Move(shape, not a transform)` (`not_a_transform`).
- Nine geometry error kinds are in the error table with codes C010 to C018. C010 to C029 are kept for geometry.
- The `Vector * Vector` hint names `Dot` and `Cross` when the figure has those commands.

### Still failing, and what each needs

- `Side(tri, 7)` (1 test): the hook is told the type of `tri`, not how many corners it has. Needs the hook to see facts about a named object.
- `Conic(x^3 + y == 1)`, `Conic(sin(x) + y == 0)`, `Conic(x^2 + y^2)` (3 tests): the hook is not told the degree of an equation or whether it is a polynomial, and the last one is refused earlier by the language as `free_variable`.
- `Locus` (4 tests) and `PointOn` dragging and `ParamOf` (4 tests), `Rigid` (1 test): a command needs a value of its own that a drag writes. This is the "free parameters owned by a command" item above.
- `Asymptote(f)`, `Curvature(P, f)`, `OsculatingCircle(P, f)`, `Reflect(f, vertical line)` (5 tests): forms that belong to the functions area.
- `Intersect(sin, cos)` with no interval (1 test): needs a check on whether a function argument is a polynomial.
