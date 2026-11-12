# Curves, inequalities, loci and envelopes: design

Status: draft for review. Fits `docs/design/formula-language-and-kernel.md` (the "core design") and builds on `docs/features/functions-calculus/design.md` (called "FC" below): its expression tree, algebras (Real, Interval, Dual, Hyper-dual, Jet), tri-state truth, `IvSet`, `Function2`, `Predicate`, `Predicate2` and the `packages/plot` package. Companion files here: `errors.md`, `agent.md`, `ui.md`.

Syntax is ours and follows the core grammar. Command names are ordinary maths words. Nothing is copied from the reference app.

Not here: curve fitting by regression (statistics). The algebraic fit used by `LocusEquation` and the interpolation form of `Curve` through points are included because they are shape tools, not statistics.

## 1. What the feature does

### For a learner

- Draw any curve you can write: a circle by its angle, a heart by its parametric formula, a rose by its polar formula, an ellipse by its equation, a bumpy equation like `sin(x) + sin(y) == sin(x*y)`.
- Shade any region you can write as inequalities: a half-plane, a disc, an intersection of conditions, a band between curves; see where the solution of a system of inequalities lives.
- Explore how paths come from motion: pin a point on a circle, attach a construction to it, and ask for the path some other point traces (a locus). See the family of lines that a sliding ladder or a rolling wheel makes, and the curve they hug (an envelope).
- Ask for the algebraic equation of a locus.

### For a teacher and the live model

- Everything is a normal object and obeys the rules of the core design: one line each, redefinable, undefined with a reason when it breaks, deterministic on replay.
- Curves can be queried like functions: tangent, normal, slope, curvature, length, closest point, intersections.
- The model writes short lines; the figure draws immediately.

### Commands, lines and forms (full coverage, our syntax)

**Parametric curves**

| Line or command | Forms and meaning |
|---|---|
| `c(s) = (x(s), y(s)) in a..b` | A parametric `Curve`. The range is required (error `missing_range`); `a` and `b` are expressions |
| `Curve(x(s), y(s), s, a, b)` | Same, with the parameter named in the command. Core form |
| `Polar(r, θ, a, b)` | Polar curve: `r` is an expression in the binder `θ`. Same as `(r cos θ, r sin θ)` |
| `Bezier(pts: List<Point>)` | Bézier curve of degree (count − 1), parameter 0..1 |
| `Spline(pts: List<Point>)` | Smooth curve through points: natural cubic spline in chord-length parameter. Named options `closed` (default false), `kind` (`"natural"` or `"centripetal"`) |

**Implicit curves**

| Line or command | Forms and meaning |
|---|---|
| `c(x, y) = F == G` | An implicit `Curve`: all `(x, y)` with `F = G` |
| `Curve(F == G)` | Inline form (binders `x`, `y` are implicit here; core form) |
| `Contour(g: Function2, level: Number)` | The set `g(x, y) = level` |
| `Contours(g, levels: List<Number>)` | `List<Curve>` |
| `Curve(pts: List<Point>)` | The algebraic curve of lowest degree through the points: `n(n+3)/2` points give degree `n` (5 points, a conic; 9 points, a cubic) |

**Queries on curves** (parametric and implicit unless stated)

| Command | Forms |
|---|---|
| `Derivative(c: Curve [, n])` | Parametric curves only: the derivative curve `(x', y')` |
| `Slope(c: Curve) -> Curve` | Parametric: `(x(s), y'(s)/x'(s))`; `Slope(c, s) -> Number` value of `dy/dx` at parameter `s`; `Slope(c, P: Point) -> Number` for an implicit curve at a point on it |
| `ImplicitDerivative(c: Curve) -> Function2` | `-F_x / F_y` for an implicit curve |
| `Tangent(c, s_or_P) -> Line` | By parameter (parametric) or point (implicit) |
| `Normal(c, s_or_P) -> Line` | |
| `Curvature(c, s_or_P) -> Number` | Signed; also `Curvature(f, x0)` for functions |
| `CurvatureVector(c, s_or_P) -> Vector` | |
| `OsculatingCircle(c, s_or_P) -> Circle` | |
| `Length(c, a, b) -> Number` | Arc length over a parameter range (parametric) |
| `Length(c) -> Number` | Whole curve (parametric, finite range) |
| `PointOn(c, u) -> Point` | Core command; `u` in 0..1 is the fraction of the parameter range (not of arc length); for an implicit curve the second argument is a start `Point` that is projected onto the curve |
| `PathParam(P) -> Number` | The `0..1` parameter of a point on a path (circle, segment, curve, function) |
| `Closest(c, P: Point) -> Point` | Nearest point on the curve |
| `Intersect(c1, c2) -> List<Point>` | Any two of curve, line, circle, function; window defaults to the curves' bounding box. Core forms with an index stay |
| `Asymptote(c: Curve) -> List<Line>` | Implicit algebraic curves (polynomial `F`) |
| `Translate`, `Rotate`, `Reflect`, `Dilate` | Core transforms accept `Curve` and return `Curve` |

**Inequalities**

| Line or command | Forms and meaning |
|---|---|
| `p(x) = x^2 > 4` | `Predicate` (one variable): drawn as shaded vertical bands and as intervals on the x-axis |
| `q(x, y) = x^2 + y^2 < 4` | `Predicate2`: a shaded region |
| `q(x, y) = y >= x and x + y < 3` | Combine with `and`, `or`, `not`. Chains allowed: `1 < x^2 + y^2 < 4` |
| `Boundary(p, a, b) -> List<Number>` | Where a one-variable predicate changes truth in `[a, b]` |
| `PointIn(q, P0: Point) -> Point` | A point kept inside the region; dragged outside it moves to the nearest inside point |
| `Area(q, x0, x1, y0, y1) -> Number` | Measure of the region inside a rectangle |
| Calls | `p(2)` and `q(1, 2)` give a `Bool` |

**Loci and envelopes**

| Command | Forms and meaning |
|---|---|
| `Locus(Q: Point, P: Point) -> Curve` | Path of `Q` as the mover `P` (a `PointOn` point) goes along its path |
| `Locus(Q, P, from, to) -> Curve` | Same over a natural-unit range (needed for unbounded paths) |
| `Locus(Q, a: Number, from, to) -> Curve` | Path of `Q` as the free number `a` goes from `from` to `to` (core form) |
| `Path(P, from, to) -> Curve` | Path of a point over the clock range (core form) |
| `LocusEquation(Q, P) -> Curve` | The algebraic equation of the locus, as an implicit curve with `.equation` text |
| `Envelope(family, P: Point) -> Curve` | Curve tangent to every member of the family (a line, segment, ray or circle that depends on the mover `P`) |

**Not covered in v1:** the form `LocusEquation(Bool, Point)` (positions that make a geometric statement true, for example collinear): it needs a symbolic geometry prover. For statements that reduce to an equation of coordinates, use `Curve(F == G)` in the coordinates. 3D curves and surfaces: core says no 3D.

## 2. How the reference app does it (plain words)

Read from `euclidian/plot`, `euclidian/draw` (parametric curve, implicit curve, inequality, locus drawables), `kernel/implicit`, `kernel/algos` (locus, curve), `kernel/arithmetic` (inequality, expression tree), the locus-equation prover directory, and the manual pages for these.

**Parametric curves.** A curve is two formulas in one parameter plus a range. It is drawn with the same adaptive sampler as functions, run in parameter space: at least 80 samples (more on wide screens), each stretch split in half while its end points are more than about 10 pixels apart or the path bends by more than about 10 degrees, to a depth of 16. If a sample is undefined the stretch is split to find defined parts; breaks are decided by a continuity check that bisects towards the suspected gap. Derivatives of curves are symbolic, as for functions. Closest-point and point-on-curve use a numeric search on the parameter.

**Implicit curves.** A polynomial equation is classified (line, conic, higher) and often factored into factors that are drawn separately; other equations are evaluated numerically. The drawing uses a grid on the view. The grid is coarse (cells at least 8 pixels wide, capped at 40 cells per side), marching-squares inside each cell, then cells that touch the curve are split to a depth of three. Cells with a very small gradient are flagged as singular and treated specially. The drawing code has a work meter: on a slow machine it lowers the depth, and after half a second of wall-clock time it gives up.

**Inequalities.** Each inequality is classified into a type: one variable in x or y, linear, conic, "parametric in x/y" (one variable alone on one side, like `y < sin(x)`), or implicit. Types outside that list are accepted by the algebra view but not drawn. Combined inequalities (`and`, `or`) form a tree and each node draws its own filled shape clipped by its parent. Borders are dashed for strict signs.

**Loci.** To draw the locus of Q as P moves along a path, the reference app copies the part of the figure between P and Q into a private second construction (by writing it out in its file format and reading it back), then moves P along its path in steps chosen from the path's length and the pixel distances between successive Q positions, with at least 128 steps and an allowance of half a second of wall-clock time per step. A 2D locus is a list of points. Related commands: `Locus` on a slider, on a slope field, and on the solution of a differential equation.

**Locus equation and envelope.** These do not draw; they compute an algebraic equation. The construction is turned into polynomial equations over the coordinates and a Gröbner-basis elimination (a computer-algebra step) removes the helper variables. The manual says only envelopes whose construction leads to an algebraic system can be computed, and that for a segment the whole supporting line is used. A related `LocusEquation(Bool, Point)` uses the same machinery as a geometric prover.

**What works.** Familiar, broad: the curve types students meet are drawn; loci are very flexible (any construction can be a locus); exact equations for algebraic loci; inequalities of common shapes.

**What is weak.** Implicit curves can miss thin features and are timing-dependent. Inequalities of unusual shapes are not drawn. A locus copies and replays a construction through its file format (slow, fragile) and depends on wall-clock time. Locus equation and envelope depend on an algebra system, and on algebraic constructions only.

## 3. Our design in one picture

```text
 Curve objects ── CurveValue (param | implicit | sampled | piecewise)
        │
        ├─ queries: eval, derivative, bbox, closest, intersect, length ─▶ commands
        └─ plotting (packages/plot):  param tracer   implicit tracer   inequality filler
                                          ▲                ▲                  ▲
                                          └── Interval algebra (FC §5): certainty, culling ──┘

 Locus / Envelope / LocusEquation:  slice of the rule graph  ─▶ run on scratch values ─▶ sampled Curve
```

## 4. Data structures

```ts
type CurveValue =
  | { kind: 'param';     x: Expr; y: Expr; param: number /*slot*/; lo: Expr; hi: Expr; closed: boolean }
  | { kind: 'implicit';  f: FunctionValue /* Function2 */; level: number; poly?: readonly Coef2[] }
  | { kind: 'piecewise'; pieces: readonly PolyPiece[]; closed: boolean }       // Bezier, Spline
  | { kind: 'sampled';   pieces: readonly Float64Array[]; closed: readonly boolean[]; origin: 'locus'|'ode'|'envelope'|'path' };

interface Coef2 { i: number; j: number; c: number }        // coefficient of x^i y^j
interface PolyPiece { s0: number; s1: number; cx: Float64Array; cy: Float64Array }   // power-basis coefficients

interface CurveOps {                                       // every curve kind implements the same operations
  at(s: number): readonly [number, number] | null;         // parametric kinds only
  derivative(s: number): readonly [number, number] | null;
  bbox(): Box | null;                                      // finite curves; null for unbounded implicit curves
  closest(P: Point, hint?: number): { s: number; p: Point; d: number };
  field(): FunctionValue | null;                           // F for implicit kinds
}

interface PredicateValue extends FunctionValue {           // result: 'bool'; params 1 or 2
  readonly prims: readonly Primitive[];                    // the comparisons inside, for margins and borders
}
interface Primitive { margin: Expr; strict: boolean }      // true when margin > 0 (or >= 0 when not strict)
```

- `CurveValue` of kind `sampled` is plain data. It is what `Locus`, `Path`, `Envelope` and parametric `SolveODE` return. A sampled curve answers `at(s)` by linear interpolation over arc fraction, so `PointOn` works; `closest` is exact on the polyline.
- A `Curve` carries `meta.text` (the printed equation), as functions do.
- A Predicate keeps its comparison primitives so the filler and the border drawer can compute margins (`G - F` for `F < G`).

## 5. Parametric curves

### Definition and range

`c(s) = (e1, e2) in a..b`. The type of the right-hand side (`Point` pair) with the call head `c(s)` decides the type: `Curve`, not `Function`. A pair-valued function without a range is `missing_range`. The parameter name is arbitrary. Closed curves (end equals start within `1e-9 (scale)`) are flagged `closed` for joins and for fill options.

`Polar(r, θ, a, b)` rewrites to the pair form: `(r(θ) cos θ, r(θ) sin θ)`; a negative `r` is allowed (the curve passes through the pole).

### Derivatives and geometry

All by the algebras from FC §5.

| Quantity | Method |
|---|---|
| `Derivative(c)` | Symbolic `diff` on both components (FC §7). For `sampled`/`piecewise`: component-wise differentiation of the stored polynomials or finite differences of the polyline (documented as approximate) |
| `Slope(c, s)` | `y'/x'` via Dual: `±inf` if `x' = 0` and `y' != 0`; `undefined(singular_point)` if both are 0 |
| `Tangent(c, s)` | Line through `c(s)` with direction `c'(s)`; at a singular point (`c'` = 0) use the first non-zero higher derivative direction (Jet algebra, up to order 4) |
| `Normal` | Perpendicular to the tangent |
| `Curvature(c, s)` | `(x' y'' - y' x'') / (x'^2 + y'^2)^(3/2)` with Hyper-dual; implicit: `(−F_y² F_xx + 2 F_x F_y F_xy − F_x² F_yy) / (F_x² + F_y²)^(3/2)` |
| `CurvatureVector` | `κ N` with unit normal `N`, i.e. `(−y', x') / |c'| * κ` |
| `OsculatingCircle` | Centre `c + N / κ`, radius `1 / |κ|`; for `κ = 0` (inflection): `undefined(infinite_radius)` with the tangent as the hint |
| `Length(c, a, b)` | Adaptive Gauss-Kronrod (FC §8.1) on `√(x'² + y'²)`, split at points where `x'` and `y'` both vanish and at parameter breaks; target `1e-10` |

### Parametric tracer (plotting)

Plotting is in `packages/plot`. Input `CurveValue`, `ViewBox`, pixel size. Output paths in pixel coordinates plus markers (cusp, end, singular point).

1. *Cull with the Interval algebra.* Evaluate `(x(S), y(S))` over parameter boxes, starting with the whole range; if the box (padded by half a stroke width) does not meet the view, drop it. This is the speed-up that makes `s in 0..1000` cheap and prevents missing on-screen parts of a wild curve.
2. *Sample on-screen boxes.* Start with `max(64, widthPx / 6)` uniform samples per box, then refine in parameter space by the screen test: split when the midpoint is farther than `0.25 px` from the chord, when the chord is longer than `8 px`, or when the turning angle between successive chords exceeds 12 degrees. Depth limit 14, counted in evaluations, not time.
3. *Undefined and unbounded values.* If a sample is non-finite, interval-evaluate the stretch: `def = 0` → gap; unbounded enclosure → the curve leaves to infinity (a branch of `1/s`): continue the path to the view edge along the last direction, mark `pole`; bounded and `def = 1` → hole-like marker, join.
4. *Cusps and corners.* If successive chords turn by more than 120 degrees after the depth limit, mark `cusp` and keep a sharp join (round joins would hide it).
5. *Overlapping loops.* No special care: all loops are in the path.
6. *Output stability.* Pure function of `(CurveValue, view, pixel size)`.

Targets: a heart curve at 1,000 px: 0.3 ms; a Lissajous figure with 6 loops: 0.8 ms; `s in 0..1000` spiral: 1.5 ms.

### Closest point and point-on

`closest(P)`: 1. Coarse: evaluate 64 uniform parameters plus the hint; 2. Take the best 3 candidates; 3. Refine each with a safeguarded Newton step on `d²(s)` using Dual/Hyper-dual, falling back to golden section on `[s - h, s + h]` if the Newton step leaves the bracket; 4. Return the global best. Accuracy `1e-12`; time 0.05 ms.

`PointOn(c, u)` free parameter `u` in 0..1 maps to `s = a + u (b − a)`. Dragging calls `closest` with the previous `u` as hint, then converts. Wrap-around on closed curves is allowed (`u` wraps) unless the user dragged a distance larger than a quarter of the curve in one move, in which case the nearest wins (prevents a jump across the curve when the pointer passes a branch).

## 6. Implicit curves

### Definition

`c(x, y) = F == G` makes `FunctionValue` with params `(x, y)` and body `F - G`, `level 0`. Comparison of two reals with `==` as the top operator is the signal for "curve". The same rule inside a `Curve(...)` call allows implicit binders `x`, `y`. `Contour(g, k)` has `f = g`, `level = k`. For a polynomial `F` (all operations are `+ − *` and non-negative integer powers over `x, y`, numbers and slider references) we also store the coefficient list `poly` (read at evaluation, so sliders animate). `poly` is used for exact asymptotes and for degree-based shortcuts.

### Implicit tracer (plotting)

Goal: a faithful drawing of `F(x, y) = level` in the view, including small closed loops, isolated points, crossings and cusps, in a fixed number of evaluations.

1. **Quadtree with certainty.** Start with the view box padded by one cell, as a grid of 32 px cells. For a cell evaluate `F` in the Interval algebra over the cell. If `level ∉ F(cell)`: the curve cannot pass through; discard the cell and all its children. If `def = 0`: discard (the function is undefined there). Otherwise split into four, down to leaf cells of 2 px (draft quality while the user is dragging the view or a slider: 6 px; final quality: 2 px). The interval enclosure gets tighter at depth, so the survivors hug the curve; cost scales with the curve length, not the area.
2. **Leaf evaluation.** Corner values come from a hash keyed by integer grid coordinates, so each shared corner is evaluated once. For each leaf compute the four signs of `F - level`.
3. **Marching squares.** For leaves with mixed signs, find the crossing on each sign-changing edge by linear interpolation, then correct it with one or two Newton steps along the gradient (Dual algebra; if the gradient is zero, skip). Saddle leaves (diagonal signs) are decided by the centre value; if the centre value is within `1e-3` of the interpolated saddle value, split the leaf once more (to 1 px).
4. **Small features.** A leaf whose enclosure contains `level` but whose corners all have the same sign may hold a tiny loop or a touching point. Split to 0.5 px and, if still unresolved, test whether the minimum of `|F − level|` in the leaf is below `1e-9 × scale`, found by a short Newton on the gradient from the centre; if so, emit a point marker (isolated point, tangency, or tiny loop). This gives certainty down to features about a quarter of a pixel, and a marker beyond that.
5. **Singular points.** Where the gradient enclosure contains 0 (nodes, cusps, isolated points) split to 0.5 px and join the segments by their shared edge keys; the sharp corners stay.
6. **Linking.** Each crossing has an edge key. Segments that share a key are chained into polylines; closed chains are flagged closed; a chain that ends at the view border ends there. Chain output order is deterministic (sorted by first key).
7. **Output.** Paths in pixel coordinates, markers, and a `complete` flag. The Newton-corrected crossings make a smooth polyline, no stair-stepping.

Targets: unit circle, 1,000 x 700 view: 2 ms; a lemniscate: 3 ms; `sin(x) + sin(y) == sin(x*y)` with many components: 15 ms; draft quality is 4x cheaper. Evaluations counted: about `10 × (curve length in px / cell size)` Interval evaluations.

Determinism: the same `(F, level, view, pixel size, quality)` gives the same paths. Quality is chosen by the view from interaction state, never from a clock.

### Derived quantities

| Quantity | Method |
|---|---|
| `Tangent(c, P)`, `Normal(c, P)` | `P` is first projected onto the curve (Newton along the gradient, 20 steps, tolerance `1e-12`). The tangent direction is `(−F_y, F_x)`; at a singular point (gradient zero) `undefined(singular_point)` |
| `Slope(c, P)` | `−F_x / F_y`; `±inf` when `F_y = 0`; `undefined(singular_point)` when both are 0 |
| `ImplicitDerivative(c)` | Symbolic `−diff(F, x) / diff(F, y)` as a `Function2` |
| `Curvature`, `OsculatingCircle` | Formulas in §5 |
| `PointOn(c, P0)` | Projection of `P0` onto `c` as above; dragging projects the pointer onto the nearest point of the curve in the same *connected piece* as before (so the point cannot hop to a different loop) |
| `Closest(c, P)` | Starting at the best of 64 random-free seeds (a fixed grid of seeds around `P`, radius doubling until a crossing is bracketed), Newton on the distance with the gradient constraint; deterministic |

### Intersections

`Intersect(c1, c2)` for any two curves, lines, circles and functions:

1. Convert both to the pair of conditions `F = 0`, `G = 0` (parametric with a parameter: add the unknown parameter, giving a system in `(x, y, s)` or `(s, u)`).
2. Search box: the intersection of the curves' bounding boxes with `[−1e6, 1e6]²` (or an explicit window `Intersect(c1, c2, x0, x1, y0, y1)`).
3. **Interval branch and bound**: bisect the box (longest side); discard when either enclosure excludes 0. When the box is small (`< 1e-3` of the original) and the Jacobian enclosure is invertible, apply the interval Newton step (`Krawczyk`) to prove one root; if it contracts, polish with ordinary Newton to `1e-14`. Boxes with a singular Jacobian that cannot shrink below `1e-9` are reported as a single tangential root, once, flagged `tangent`.
4. Sort by `x`, then `y`; remove duplicates within `1e-10`.
5. Time: two conics in under 1 ms; two generic curves in a 10 by 10 window: 5 ms.

Line and circle special cases use closed forms; the index forms in the core stay (`Intersect(Line, Circle, 1)`), ordering the two points along the line direction, so loci stay continuous (section 9).

### Algebraic helpers

- `Asymptote(c)` for polynomial `F` of degree `n`: let `H` be the homogeneous part of degree `n`. Directions are the real roots `(1, m)` of `H(1, m) = 0` (and the vertical direction when `H` has factor `x`); for each simple root `m` the asymptote is `y = m x + b` with `b = −F_{n−1}(1, m) / H_m(1, m)` (the standard formula, where `F_{n−1}` is the degree `n−1` part and `H_m` the derivative of `H(1, m)` in `m`). Multiple roots (parabolic branches) give no asymptote. Result sorted by slope.
- `Curve(pts)`: fit the lowest degree `n` with `n(n+3)/2 = count`. Build the matrix of monomials `x^i y^j` (`i + j ≤ n`) in coordinates scaled to `[−1, 1]`, take its null vector by SVD, reject if the second smallest singular value is within `1e-8` of the smallest (points not determining a unique curve: `undefined(degenerate_points)`), and convert back. A point count that is not of the form `n(n+3)/2` is `bad_argument`, and the hint names the nearest valid counts.

## 7. Inequalities

### Representation

A `Predicate` or `Predicate2` is a `FunctionValue` with `result: 'bool'`. Its body is built from `cmp`, `logic`, and numeric subexpressions. `prims` are the comparisons found in the body (after distributing `not`). The tri-state evaluation (FC §5) of the body over a box gives true, false or maybe.

### Filling algorithm (plotting)

1. *Quadtree.* Same grid as the implicit tracer. Evaluate the body on each cell in the Interval algebra. `true` → fill the whole cell (merge into maximal rectangles by run-length along rows as the tree is walked); `false` → skip; `maybe` → split to 2 px (draft 6 px).
2. *Boundary leaves.* For a `maybe` leaf containing exactly one primitive boundary, compute the polygon of `{margin > 0}` by the marching-squares polygon tables with the Newton-corrected crossings. For a leaf where two or more primitive boundaries meet (corners of a region), supersample at 4 x 4 centres with exact three-valued evaluation and fill the covered sub-cells; the boundary strokes are drawn by the implicit tracer anyway, so the corner is correct to a sub-pixel.
3. *Borders.* Each primitive that bounds the region is traced as an implicit curve of `margin = 0`, kept only where it is on the boundary of the *combined* region (a sample just inside the margin satisfies the whole body when the margin is replaced by a small positive value). Strict inequalities (`<`, `>`) use a dashed border; non-strict, solid.
4. *Output.* `rects`, `polygons`, `borders`, `markers` (isolated true points, such as `x^2 + y^2 <= 0`).

Complexity follows the boundary length, not the area, because big true or false regions are decided at coarse cells. Targets: half-plane: 0.3 ms; disc ∩ half-plane: 1.5 ms; `sin(x) y > 1` in a 1,000 x 700 view: 8 ms.

### One-variable predicates

`p(x) = x^3 > x + 1`: the same algorithm in 1D. The filler returns vertical bands spanning the view height and the *intervals on the axis*.

`Boundary(p, a, b)`: bisect `[a, b]` with tri-state evaluation until each `maybe` box is smaller than `1e-9 (b − a)`; inside each, locate the sign change of the active primitive's margin with Brent. Return the sorted points; open or closed status is carried by `.closed`.

### Others

- `PointIn(q, P0)`: if `P0` satisfies `q` it stays; else it is moved to the nearest satisfying point: find the violated primitive nearest to `P0` and walk along its gradient with Newton to its boundary, then step 1e-9 inside; final check with the full body.
- `Area(q, x0, x1, y0, y1)`: quadtree measure: sum of true cells; boundary leaves counted by their polygon area (exact by clipping); refine boundary leaves until the sum of boundary leaf areas is below `1e-4` of the total or depth 14. Returns a number with `err`.
- Calling `q(1, 2)` returns the Bool by the Real algebra; `Point` arguments also work: `q(P)`.

## 8. Piecewise curves: Bezier and splines

`Bezier(pts)`: degree `n − 1`; de Casteljau for evaluation; derivative is a Bezier of the differences; stored as a `piecewise` curve with one piece, power basis coefficients computed by conversion (stable for `n ≤ 12`; above that, `limit`).

`Spline(pts)`: natural cubic spline with chord-length parameter; solving the tridiagonal system for the second derivatives in `O(n)`; for `closed = true` use the cyclic version. `kind = "centripetal"` gives the Catmull-Rom form (alpha = 0.5), which cannot loop or overshoot at uneven spacing; its pieces are stored as cubic polynomials. Moving a defining point updates only the pieces that depend on it for centripetal; natural splines update globally in `O(n)`.

Both are exact for `at/derivative`, which is what makes `Tangent`, `Length`, `Closest` work uniformly.

## 9. Loci

### Concept

Given `Q` (a point that depends on a mover `P`), the locus is the set of positions of `Q` as `P` moves along its path or as a number changes. Our approach evaluates part of the rule graph on scratch values, with no private copy of the figure and no clock.

### The slice

1. **Slice selection.** `U = upstream(Q)` (every object `Q` depends on, found by walking inputs) and `D = downstream(P)` (the cached downstream list from FC / core §2). The slice is `U ∩ D` in object order. These are the only rules that react to the mover and affect `Q`.
2. **Slice.** `kernel.slice(mover, Q)` returns a `Slice` with `chain` (the names of the objects that run, in order) and `run(values)`. It is built on each call, not kept as a cached compiled program. Rules never mutate the real figure: they are pure (core §2). If `chain` is empty, `Q` does not depend on the mover, and `Locus` reports `no_dependency`.
3. **Run.** `run(values)` gives the cell of `Q` for each mover value `s`: it writes `s` into the mover on a scratch copy, runs the rules of the chain in order and reads `Q`. A run costs the number of rules in the slice times about 0.2 to 2 µs.
4. **Mover parameter.** For a `PointOn` point the parameter is its `u` in `[0, 1]`; for a free number `a`, it is `a`. For a path that is unbounded (line or ray), `u` is not suitable; `Locus(Q, P, from, to)` takes a range in natural units along the path (signed distance from the path's first defining point) and, if none is given, the range `±50 × construction scale`, where the construction scale is the bounding-box diagonal of all free points (or 1).

### Sampling (view independent)

Because the result is data stored in the figure and used by `PointOn`, `Length`, `LocusEquation` and exports, it cannot depend on the screen.

1. Start with `N0 = 128` uniform samples of the mover parameter.
2. Let `D` be the diagonal of the bounding box of the samples so far (re-computed as the set grows). For consecutive samples `Q_i`, `Q_{i+1}` with midpoint sample `M`: refine (insert the midpoint sample) if the distance from `M` to the chord exceeds `5e-4 D`, or if the chord is longer than `D / 64`, or if either end is undefined and the other defined.
3. Depth limit 12; total samples cap `20,000` (limit error `limit` if exceeded at definition when the caller asked for more via a huge range; otherwise `warning: sample_cap` on the value).
4. **Discontinuities.** If a chord is longer than `D / 6` and bisecting 20 times does not bring the neighbour distance below half, there is a jump: break the polyline (a gap), and mark both ends.
5. **Undefined stretches.** Where `Q` is undefined (no intersection), find the boundary of the defined stretch by bisecting to `1e-12` in the parameter, then end the piece there.
6. **Closed paths.** If the mover's path is closed (circle, closed curve) and the last sample equals the first within `1e-9 D`, the polyline is closed.
7. **Branch continuity.** Rules that pick one of several answers (intersections of a line with a circle) use an index order defined by the rule: the intersection points of a line with a conic are ordered by the signed distance along the line's direction; circle with circle by the side relative to the centre-to-centre direction. This order is continuous except at tangency, where the two answers merge and then become undefined. (This is a requirement on the `Intersect` rule in the core; see §14.)

### Output

A `sampled` `Curve` with `pieces` and `closed` flags, ready for the polyline drawer. Data is `Float64Array` per piece. `Length`, `PointOn`, `Closest` work on it.

Time: a locus with 8 slice rules and 600 samples after refinement: 3 ms; recomputed when the mover's path or any slice input changes; cached otherwise.

### Variants

- `Locus(Q, a, from, to)`: the same but the mover is the free number `a`.
- `Path(P, from, to)`: the mover is the clock `t`; the slice is `downstream(t) ∩ upstream(P)`, which is already computed for the film player.
- Locus of a locus: the sampled curve is a value like any other; `PointOn(loc, u)` is then the mover of the next locus.

### Dependency and update

The locus object has the rules in the slice as inputs, so when any free point moves, the locus is recomputed. To keep dragging smooth, the kernel limits recomputation of loci to once per frame and, while a drag is in progress, uses `N0 = 64` and the chord rule `D / 32` (draft); the final value after the drag ends uses the full rules. The draft rule is selected by an explicit flag from the view, never by a timer, so a recorded film and a replay agree.

## 10. Locus equation

`LocusEquation(Q, P)`:

1. Run the locus (final quality) and collect `m = 600` points evenly spaced by arc length on the sampled polyline (taking all pieces).
2. For degree `d = 1..8`: build the matrix of monomials `x^i y^j` with `i + j ≤ d`, in coordinates scaled to `[−1, 1]` and expanded in a Chebyshev basis for conditioning. Compute singular values by an SVD.
3. If the smallest singular value is below `1e-11 × the largest` and the next one is larger than `1e-7 × the largest`: a unique polynomial of degree `d` vanishes on the sample. Take its null vector.
4. **Verify** on `200` held-out points taken at other parameter values: the residual must be below `1e-9 × scale`.
5. Convert to the power basis in original coordinates, normalise the leading coefficient to 1, rationalise coefficients within `1e-9` (continued fractions) for the printed equation, and return an implicit curve with `poly` and `meta.text`. The implicit tracer draws it (so the whole algebraic curve is drawn even where the locus only covers an arc, which matches what an algebraic equation means).
6. If no degree up to 8 works: `undefined(no_algebraic_equation)`.

Accuracy: exact (to rounding) for conics, cissoids, conchoids, limaçons, cardioids (degree 4), lemniscates (degree 4) when the sampled arc is not tiny. Fails on transcendental loci with a clear reason. Time: SVD of 600 x 45 about 4 ms (degree 8 worst).

Limits: if the locus has several components (reducible algebraic curve), the fit finds the product (higher degree). If the sample covers a very short arc, the second singular value condition can fail: `degenerate_points` hint "the locus covers too little of the curve".

## 11. Envelopes

`Envelope(family, P)`: `family` is an object (line, segment, ray or circle) that depends on the mover `P` (a `PointOn` point), found with the slice method of §9. The envelope is the curve that touches every member.

**Representation of each member.**

- Line: `a(s) x + b(s) y = c(s)` (normalised so `a² + b² = 1`).
- Circle: centre `(p(s), q(s))`, radius `r(s)`.

**Envelope point formulas.**

- Line family: the envelope point at `s` solves the 2 x 2 linear system `a x + b y = c`, `a' x + b' y = c'`. Determinant `a b' − b a'`; zero determinant (family of parallel lines, or a stationary member) → undefined at that `s` (a gap).
- Circle family: `(x − p)² + (y − q)² = r²` and the derivative condition `(x − p) p' + (y − q) q' + r r' = 0` (a line); intersect the line with the circle: zero, one or two points; two branches, kept apart by the sign of the cross product of `(x − p, y − q)` with `(p', q')`. Fewer than one point means the circle family has no envelope at that `s`.
- Derivatives with respect to `s` (`a', b', c', p', q', r'`) are 5-point central differences on the slice with step `1e-4 × (range of s)`, accuracy about `1e-9`. If any member is non-smooth at `s` (a branch change) the sample is dropped.
- Segment and ray: compute from their supporting lines, then keep only points whose line parameter lies inside the segment (or on the ray). (The reference app's manual says the supporting line is used; the clipped version matches what a student means by "the envelope of the ladder".)

**Sampling.** Same adaptive rule as loci (§9) on the envelope points.

**Result.** A `sampled` curve with one piece per branch.

**Other families (v1 gap).** Families of parametric curves or implicit curves return `unsupported_family` with the hint to use `Locus` of the contact point if it is known. A follow-up solves `F(x, y; s) = 0 = F_s(x, y; s)` by continuation using the Dual algebra on `s`.

## 12. How it plugs into the kernel and the command table

- **Types.** `Curve` (with `CurveValue`), `Predicate`, `Predicate2` are added with FC's type changes; `List<Curve>` is allowed.
- **Lines.** The define-line rule `Name(params) = expr` decides the type from the right-hand side and parameter count: `Point` pair with one parameter and a range → `Curve`; top-level `==` with two parameters → implicit `Curve`; top-level comparison or logic with one or two parameters → `Predicate`/`Predicate2`.
- **Rules.** Each command is a `CommandSpec`. Locus-type commands get the slice from the kernel's graph API: `kernel.slice(moverId, targetId)` returns a `Slice` (`chain` and `run(values)`), built on each call and not cached. A slice is valid only until the next line changes the figure's structure.
- **Undefined.** `Locus` is undefined with reason `no_dependency` if `Q` does not depend on `P`, that is, when the slice's `chain` is empty (then the locus is a point; the reason says so). The kernel does not raise `no_dependency`; the area does.
- **Dragging.** `PointOn` on curves uses `closest` with the previous parameter as the hint; on loci it uses the sampled polyline; on inequalities `PointIn`.
- **Package split.** Maths in `packages/kernel/src/curves` (values, queries, intersections, locus, envelope, fit). Tracers and filler in `packages/plot`.

## 13. Edge cases

- A parametric curve with `x(s)` constant: `Slope` is `±inf`.
- A curve passing through its own singular point: tangent undefined there, curve still drawn.
- A polar curve with negative radius: allowed.
- Implicit `F == G` where `F − G` is identically zero: the whole plane; drawn as nothing, with `warning: identically_true`.
- Empty implicit curve (`x² + y² == −1`): defined, draws nothing, `Intersect` gives `[]`.
- Implicit equation of one variable only (`x^2 == 4`): two vertical lines; the tracer handles by the same mechanism.
- `Curve` on `inf` ranges (`s in -inf..inf`): not supported for plotting; `missing_range` explains finite ranges are required, or use a large finite range.
- Inequality `f(x, y)` with strict and non-strict borders in a combined body: the border style is per primitive.
- Predicates containing `rand` or `noise`: allowed; they are pure functions of `x, y`.
- Locus where `Q` is a free point: `no_dependency`.
- Moving `P` makes the construction pass through degenerate cases (coincident points): those samples are undefined; the locus has a gap there.
- A locus with one piece but very many oscillations: capped at 20,000 samples, `warning: sample_cap`.

## 14. Better than the reference app

1. **Certainty in implicit curves**: interval culling means small loops and isolated points are found; there is no 8-pixel coarse grid. Cost follows curve length.
2. **No clocks anywhere**: tracing, loci and fills count evaluations, so frames and files agree on every machine.
3. **Any inequality is drawn**: three-valued evaluation handles every combination of `and`, `or`, `not`, products and transcendental terms; unsupported types do not exist.
4. **Loci without copying the figure**: slices on scratch values are faster and cannot disturb the real figure; `PointOn` on a locus works the same as on any curve.
5. **Branch-stable loci**: intersection order is a documented rule, so loci do not swap branches.
6. **View-independent loci and envelopes**: the data is the same at any zoom, which films and exports need.
7. **Locus equation without a CAS**: a numerical algebraic fit with held-out verification and a clear failure reason.
8. **Envelope of a segment clipped to the segment** and returned as branches.
9. **Parametric curve culling** makes huge parameter ranges cheap.
10. **Dense interpolation, closest-point and intersection work uniformly across curve kinds** because each kind implements the same operation set.

## 15. Changes to the core design

1. **Types**: `Curve` is a union (`param | implicit | piecewise | sampled`); `Predicate`, `Predicate2` as in FC; core's `Curve` row says "parametric or implicit" and gains sampled and piecewise.
2. **Define-line typing**: a pair-valued right-hand side with a parameter and `in a..b` is a `Curve`; a top-level `==` over two parameters is an implicit `Curve`; a top-level comparison/logic over one or two parameters is a `Predicate`/`Predicate2`. Reason: no new keywords.
3. **`Intersect` index order** is part of the specification: along the line direction for conics, side of the centre line for two circles. Reason: loci need continuity.
4. **`Locus` forms**: `Locus(Q, P)` with `P` a `PointOn` point and `Locus(Q, P, from, to)` added beside the core `Locus(P, a, from, to)`. The core's first argument order (`Locus(P, a, ...)`) stays: the point is first, then the mover.
5. **Kernel API**: `kernel.slice(moverId, targetId)` returns a `Slice` (`chain`, `run(values)`) that runs on a scratch copy of the figure, built on each call. An empty `chain` means no dependency. Reason: loci, envelopes, `Path`.
6. **`PointIn`** and **`Closest`** as commands; `PointOn(implicit, P0)`.
7. **Quality flag** for tracing and loci passed explicitly (`draft` | `final`), never derived from time.
8. **`Length(c, a, b)`** and **`PathParam`** added.
9. **New error kinds** `missing_range`, `not_a_mover`, `no_dependency`, `unsupported_family`, `bad_argument` (see `errors.md`); new undefined reasons `singular_point`, `infinite_radius`, `no_algebraic_equation`, `degenerate_points`, `no_intersection`, `identically_true`, `sample_cap`.

## Sources studied

Removed before the repository was made public. The study notes above are in our own words.
