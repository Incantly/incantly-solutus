# Circles, arcs, sectors and conics: design

Status: draft for review. Plane-geometry area, second folder. Uses the shared geometry model in `docs/features/points-lines/design.md` (sections 3.1 to 3.5: `V2`, `HLine`, `Tol`, `det2`, `orient`, `Path`, slot ordering, notes). Read that first. Fits `docs/design/formula-language-and-kernel.md`. Nothing is copied from GeoGebra; section 15 lists what was read.

## 1. What the learner and the teacher get

Circles, ellipses, parabolas and hyperbolas as live objects. Drag a focus and the ellipse reshapes; slide a number and the eccentricity changes; ask for the tangent from a point and get both lines; put a point on the conic and watch the tangent roll along it. Arcs and sectors give angle and area lessons; the polar line and conjugate diameters give projective geometry lessons.

### 1.1 Command coverage

All forms are in our syntax. Results of multi-solution commands are `List<…>` of a fixed length per kind; `[k]` reads one (1-based).

**Circles**

| Command | Forms | Result |
|---|---|---|
| `Circle` | `(Point center, Number radius)`, `(Point center, Point through)`, `(Point center, Segment)` (radius is the segment's length, live), `(Point, Point, Point)` (through three points) | Circle |
| `Incircle` | `(Point, Point, Point)` | Circle |
| `Circumcircle` | not a separate name: `Circle(A, B, C)` | |
| `Semicircle` | `(Point A, Point B)`: the half on the left of the directed segment A→B | Arc |

**Arcs and sectors** (`Arc` and `Sector` take the same argument shapes)

| Command | Forms | Result |
|---|---|---|
| `Arc` | `(Point center, Number radius, Number from, Number to)`, `(Point center, Point start, Point end)` (radius `|start − center|`; `end` only gives the direction), `(Conic, Number from, Number to)` (angles about the centre), `(Conic, Point P, Point Q)` (counter-clockwise from P to Q) | Arc |
| `ArcThrough` | `(Point A, Point B, Point C)`: the arc from A through B to C | Arc |
| `Sector` | `(Point center, Number radius, Number from, Number to)`, `(Conic, Number from, Number to)`, `(Conic, Point P, Point Q)` | Sector |
| `SectorThrough` | `(Point A, Point B, Point C)` | Sector |
| `Sector` | also `(Point center, Point start, Point end)`: radius `|start − center|`; `end` only gives the direction | Sector |

**Conics**

| Command | Forms | Result |
|---|---|---|
| `Conic` | `(Point, Point, Point, Point, Point)`, `(Number A, B, C, D, E, F)` for `A x² + B xy + C y² + D x + E y + F = 0`, `(List<Number>)` (six numbers), `(Bool equation)` such as `Conic(x^2/9 + y^2/4 == 1)` | Conic |
| `Ellipse` | `(Point F1, Point F2, Number semimajor)`, `(Point F1, Point F2, Segment)`, `(Point F1, Point F2, Point through)` | Conic (ellipse; a hyperbola if the length is too small) |
| `Hyperbola` | `(Point F1, Point F2, Number semimajor)`, `(…, Segment)`, `(…, Point through)` | Conic |
| `Parabola` | `(Point focus, Line directrix)` | Conic |

Setting `Ellipse` with a semi-major axis less than half the focus distance does not silently become a hyperbola in our version: it is undefined with reason `too_short` (section 11). The reverse for `Hyperbola`. A teacher asks for the other command.

**Properties** (all take a `Conic` unless marked)

| Command | Result | Notes |
|---|---|---|
| `Center(c)` | Point | Circle, ellipse, hyperbola; parabola: `no_center` |
| `Radius(c)` | Number | Circle only (`not_circle` otherwise) |
| `SemiMajor(c)`, `SemiMinor(c)` | Number | Ellipse, hyperbola (`SemiMinor` is the conjugate semi-axis for hyperbola); circle gives the radius |
| `Eccentricity(c)` | Number | Circle 0; parabola 1 |
| `LinearEccentricity(c)` | Number | Centre to focus; parabola: focus to vertex |
| `Focus(c)` | `List<Point>` | Ellipse, hyperbola 2; circle: the centre twice; parabola 1 |
| `Vertex(c)` | `List<Point>` | Ellipse and circle 4 (ends of major axis first, then minor), hyperbola 2, parabola 1 |
| `Directrix(c)` | `List<Line>` | Ellipse and hyperbola 2, parabola 1; circle `no_directrix` |
| `MajorAxis(c)`, `MinorAxis(c)` | Line | |
| `Axes(c)` | `List<Line>` | [major, minor]; parabola: the axis only |
| `Tilt(c)` | Number (angle) | Direction angle of the major axis, in `[0, π)` |
| `Parameter(c)` | Number | Parabola: distance from focus to directrix |
| `Coefficients(c)` | `List<Number>` | `[A, B, C, D, E, F]` scaled so the first non-zero of A, C, B is 1 (section 3.3) |
| `Equation(c)` | Text | Readable equation |
| `Type(c)` | Text | `"circle"`, `"ellipse"`, `"hyperbola"`, `"parabola"`, `"two lines"`, `"parallel lines"`, `"double line"`, `"point"`, `"line"`, `"empty"` |
| `Area(c)` | Number | Circle, ellipse; others `unbounded` |
| `Circumference(c)`, `Perimeter(c)` | Number | Circle, ellipse; same value |

**Lines tied to conics**

| Command | Forms | Result |
|---|---|---|
| `Tangent` | `(Point, Conic)` all tangents through the point; `(Line, Conic)` tangents parallel to the line; `(Conic, Conic)` common tangents; function and curve forms are in the calculus area | `List<Line>` (lengths 2, 2, 4) |
| `Polar` | `(Point, Conic)` | Line |
| `Pole` | `(Line, Conic)` | Point |
| `ConjugateDiameter` | `(Line, Conic)`, `(Vector, Conic)` | Line |
| `Asymptote` | `(Conic)` | `List<Line>` (2); `(Function)` and `(Curve)` forms: section 6.6 | `List<Line>` |
| `IsTangent` | `(Line, Conic)` | Bool |

**Curvature**

| Command | Forms | Result |
|---|---|---|
| `Curvature` | `(Point, Conic or Function or Curve)` | Number (signed) |
| `CurvatureVector` | same | Vector |
| `OsculatingCircle` | same | Circle (or `Line` when curvature is 0: undefined `straight`) |

**Intersections with conics** are specified in `points-lines` section 4.3 and 4.4. The centre of a conic is `Center(c)`; `Midpoint` takes points, segments and arcs only.

**Not in v1:** 3D quadrics (sphere, cone, axes of a quadric), `Cubic`/`TriangleCurve`, circle inversion as its own command (it is `Reflect(shape, circle)` in `polygons-transforms`), `Locus` of conics via symbolic equation, tangents to implicit curves.

### 1.2 Tools the learner can pick

Circle with centre through point; Circle with centre and radius; Compass; Circle through 3 points; Semicircle; Circular Arc; Circumcircular Arc; Circular Sector; Circumcircular Sector; Ellipse; Hyperbola; Parabola; Conic through 5 points; Tangents; Polar or Diameter Line. Each writes one script line (`ui.md`).

## 2. How GeoGebra does it (in plain words)

**Model.** Every conic is a symmetric 3×3 matrix, stored as six numbers. A type tag is derived from it by classification: single point, intersecting lines, ellipse, circle, hyperbola, empty, double line, parallel lines, parabola, line (a circle with infinite radius, which circle inversion can produce). The classification looks at the determinant of the whole matrix, the determinant of the 2×2 quadratic part, and the rank. From the type it computes a frame: centre, two axis directions (eigenvectors of the quadratic part), and semi-axis lengths, and keeps them next to the matrix.

**Parametrisation.** A point on a conic is stored as a parameter in the frame: an angle for ellipses, and a path parameter with a squeeze for parabolas and hyperbolas. Projecting a dragged point uses the frame; for ellipses the nearest-point problem is solved by a polynomial of degree four with a safeguarded solver.

**Constructors.** Circle (centre-radius, through-point, three points), ellipse and hyperbola from foci plus a length or a point, parabola from focus and directrix, conic from five points (a linear system whose tolerance for "nearly a parabola" is loosened by hand), conic from six coefficients, from a typed equation.

**Arcs and sectors.** Stored as a conic plus two parameters. Many separate algorithms: arc from centre and two points, circumcircular arc through three points, circular sector, conic parts from parameters and from points, semicircle.

**Special lines.** Tangents, polars, asymptotes, directrix, conjugate diameters are one small algorithm each; they re-use the matrix (the polar line is the matrix times the point). Common tangents of two conics are done with specialised code for circles.

**Tolerances.** Absolute constants (1e-8 and 1e-5). The classification test "is the determinant of the quadratic part zero" uses a per-object tolerance that the five-point constructor loosens by hand.

**What works.** The matrix form: polar, tangent and intersection all come out of the same representation, with no cases for vertical or rotated conics. Having the frame precomputed makes drawing and measuring cheap.

**What is weak.**
- The frame comes from an eigen-decomposition each time. When an ellipse passes through a circle the axes swap suddenly, so points riding on it jump and labels (focus 1 and focus 2) swap.
- Classification uses fixed absolute tolerances, so a nearly parabolic ellipse of huge size is called a parabola at one scale and an ellipse at another.
- Arcs and sectors are defined by many near-duplicate algorithms.
- The ellipse circumference is computed by plain numeric integration, slow and only moderately accurate for very flat ellipses.
- The type changes silently: a slider that moves an ellipse's focus beyond the limit turns it into a hyperbola with the same name.
- A tangent from a point on the conic and one from a point very near the conic are different code paths; the latter flickers.
- Type is read as a number code in the scripting commands.

## 3. Our value model

### 3.1 Types

```ts
export type ConicKind =
  | 'circle' | 'ellipse' | 'hyperbola' | 'parabola'
  | 'lines' | 'parallel' | 'double' | 'point' | 'line' | 'empty';

/** Symmetric 3×3 coefficient matrix of  A x² + B xy + C y² + D x + E y + F = 0, stored as six numbers. */
export interface Quad { readonly A: number; readonly B: number; readonly C: number;
                        readonly D: number; readonly E: number; readonly F: number }

/** Where a central conic sits. Axes are unit vectors; u points along the major (transverse) axis. */
export interface CentralFrame { readonly cx: number; readonly cy: number;
                                readonly ux: number; readonly uy: number;   // major axis direction
                                readonly a: number;  readonly b: number }   // semi-axes, a ≥ b for ellipse; a = transverse for hyperbola
export interface ParabolaFrame { readonly vx: number; readonly vy: number;   // vertex
                                 readonly ux: number; readonly uy: number;   // axis direction, from vertex toward focus
                                 readonly p: number }                        // focus-to-directrix distance (p > 0)

export interface ConicValue {
  readonly q: Quad;                     // always present; normalised to unit Frobenius norm of the 3×3 matrix
  readonly kind: ConicKind;
  readonly frame?: CentralFrame | ParabolaFrame;  // present for circle, ellipse, hyperbola, parabola
  readonly margin: number;              // distance to the nearest other kind, see 3.4 (0 = exactly on a boundary)
  readonly lines?: readonly [HLine, HLine?];      // for lines, parallel, double, line kinds
  readonly point?: V2;                  // for kind 'point'
}

export interface ArcValue {             // also used for sectors
  readonly conic: ConicValue;           // circle or ellipse
  readonly from: number;                // polar angle about the centre, radians
  readonly sweep: number;               // 0 < sweep ≤ 2π, counter-clockwise from `from`
}
```

Static object types: `Circle` (always kind `circle` or undefined; subtype of `Conic`), `Conic`, `Arc`, `Sector`. A `Conic` object's kind changes at run time with its inputs; a `Circle` object's does not. This keeps `Circle`-only commands total.

### 3.2 Native frames

Constructors that know their geometry store the frame directly instead of deriving it from the matrix:

| Constructor | Frame comes from |
|---|---|
| `Circle(...)` | centre and radius |
| `Ellipse(F1, F2, a)` | centre = midpoint of the foci, `u` = unit vector F1→F2, `a`, `b = √(a² − c²)` with `c = |F1F2|/2` |
| `Hyperbola(F1, F2, a)` | same, `b = √(c² − a²)` |
| `Parabola(F, d)` | vertex = midpoint of F and its foot on `d`, `u` = from the foot toward F, `p` = |F − foot| |
| `Conic(5 pts / numbers / equation)` | derived from the matrix (3.3) |

This removes the discontinuity of axis swapping at the circle crossing for all constructed conics: foci keep their names, the axis points the same way, and the first focus is always `F1`.

### 3.3 From the matrix (classification and frame)

Input `Quad`. Steps, all closed form (no iteration), about 0.2 µs:

1. **Scale.** Divide by the Frobenius norm of the symmetric matrix `M = [[A, B/2, D/2], [B/2, C, E/2], [D/2, E/2, F]]`. If the norm is 0 or not finite: undefined `degenerate_conic` (`0 = 0`).
2. **Quantities.**
   - `δ = AC − B²/4` (the quadratic part's determinant, `det2`).
   - `Δ = det(M)`.
   - `tr = A + C`.
   - Eigenvalues of the quadratic part: `λ = (tr ± √((A−C)² + B²))/2`; compute the larger-magnitude one first and get the other as `δ/λ` to avoid cancellation.
3. **Rank** of `M` by comparing `|Δ|` and the 2×2 principal minors against `ρ`, with `ρ = 1e-10` (relative to the unit-norm matrix; adjustable by `@tol`): rank 3 if `|Δ| > ρ`; rank 2 if some 2×2 minor exceeds `ρ`; rank 1 otherwise.
4. **Kind.**

| Rank | Condition | Kind |
|---|---|---|
| 3 | `|δ| ≤ ρ'`, with `ρ' = 1e-9·|λmax|²` | parabola |
| 3 | `δ > 0` and `Δ·tr < 0` | ellipse; circle if `|λ1 − λ2| ≤ 1e-10·|λmax|` |
| 3 | `δ > 0` and `Δ·tr > 0` | empty |
| 3 | `δ < 0` | hyperbola |
| 2 | `δ < 0` (beyond `ρ'`) | lines (intersecting) |
| 2 | `δ > 0` | point |
| 2 | `|δ| ≤ ρ'` | parallel lines (real: the line part's discriminant is positive), else empty |
| 1 | | double line |
| quadratic part zero, linear part non-zero | | line |

5. **Frame.**
   - Axis angle `θ = ½·atan2(B, A − C)`. Major direction is the eigenvector of the larger-magnitude eigenvalue `λ1`; the unit vector `u = (cos θ, sin θ)` or its perpendicular. Sign convention: `u.x > 0`; when `|u.x| ≤ 1e-12`, `u.y > 0`.
   - Centre `c`: solve `S c = −(D, E)/2` with `det2`; the denominator `δ`.
   - Semi-axes: `a² = −Δ/(δ·λ_a)`, `b² = −Δ/(δ·λ_b)`, with `λ_a` the smaller-magnitude eigenvalue (the longer axis). Sorted so `a ≥ b` for the ellipse.
   - Parabola: axis direction from the eigenvector of the zero-eigenvalue; vertex from the linear solve in the rotated frame.
6. **Margin.** `margin = min(|δ|/λmax² … , |Δ|/…, |λ1−λ2|/λmax)`, specifically the smallest relative distance to a change of kind among the boundaries that are adjacent to the current kind (parabola ↔ ellipse/hyperbola by `δ`, circle ↔ ellipse by the eigenvalue gap, degenerate ↔ regular by `Δ`). Used by notes and by the UI (3.4).

`Coefficients(c)` returns `[A, B, C, D, E, F]` divided by the first non-zero of `A, C, B` (so the circle `x² + y² = 4` reports `[1, 0, 1, 0, 0, −4]`). A conic given by the user as numbers is stored with those exact numbers and the monic scale is only applied on read.

### 3.4 Near a boundary

If `margin < 1e-6` the value carries the note `near_boundary` with the other kind's name (`near_boundary:parabola`). The kind reported is the one the numbers say, with no hysteresis (hysteresis needs history and would break replay).

Consumers do not branch on the kind when they don't have to: tangents, polars, and intersections use the matrix, so a near-parabolic ellipse of semi-axis 1e8 is handled exactly like any other. Only presentation (the frame for drawing, vertex lists) needs the kind.

### 3.5 Paths of conics

The `Path` of a conic (points-lines 3.2):

| Kind | Raw parameter `s` | Notes |
|---|---|---|
| Circle, ellipse | **Polar angle about the centre**, in `(−π, π]`, global (not measured in the frame) | `at(s)`: radius along that ray from the quadratic form: `r(s) = √(−F′/q(s))` with `q(s) = A cos² s + B cos s sin s + C sin² s`, `F′` the constant after moving to the centre |
| Parabola | `u ∈ (−∞, ∞)`: position `V + u·n + (u²/(2p))·axis`, `n` the unit normal; `norm = 0.5 + atan(u/p)/π` | |
| Hyperbola | `(branch, w ∈ ℝ)`: `C + σ·a·cosh w·u + b·sinh w·n` with `σ = ±1` per branch (`n` the left normal of `u`); `norm`: branch 1 maps to (0, 0.5), branch 2 to (0.5, 1) via `0.25 ± atan(w)/(2π)` | The default `PointOn(h)` parameter is `0.25` (vertex of the first branch), not 0.5 |
| Lines, double line, parallel lines | as a line | `PointOn` on a line pair: parameter of the first line; use the lines individually |

**Why the global polar angle for ellipses.** A parameter measured in a frame that is rederived from the matrix jumps when the axes swap (at the circle). The angle about the centre depends on nothing but the centre. A point riding on an ellipse stays put through a circle crossing and a rotation of the ellipse moves it by the real rotation of the shape, not by an artifact of eigenvector choice. (Constructed ellipses with native frames could use the eccentric angle, but one convention for all is simpler and it makes `Conic` objects interchangeable.)

`project(p)`:
- Circle: direction from centre, closed form.
- Ellipse: solve for the nearest point in the frame: with `(u, v)` the pointer in axis coordinates (absolute values), find the root `t` of `g(t) = (a·u/(t + a²))² + (b·v/(t + b²))² − 1` on the bracket `(−b² + ε, ∞)`; `g` is strictly decreasing there, so bisection with a Newton accelerator converges to 1e-15 in under 20 steps and never fails (cases `u = 0` or `v = 0` are handled as the axis special cases). Cost about 1 µs.
- Parabola: one real cubic root, closed form with trigonometric branch.
- Hyperbola: same monotone-function method per branch, with the bracket picked by which branch the pointer is nearer.
- Ties (a point equidistant from two parts, such as the centre of a circle): choose the previous parameter if a `hint` is given, else the smallest parameter.

## 4. Constructors: rules

### 4.1 Circles

- `Circle(C, r)`: `r < 0` → `negative_radius`; `r = 0` is a point conic (`kind: 'point'`, type `Circle` allows this as a degenerate circle: drawn as a dot); `r` not finite → `not_finite`.
- `Circle(C, P)`: radius `|P − C|`. `Circle(C, seg)`: radius `Length(seg)`.
- `Circle(A, B, C)`: circumscribed circle. With `d = 2·det2(Bx−Ax, By−Ay, Cx−Ax, Cy−Ay)` (twice the signed area), centre `Ux = (|B′|²·Cy′ − |C′|²·By′)/d`, `Uy = (|C′|²·Bx′ − |B′|²·Cx′)/d` in coordinates relative to A (primes), which avoids the cancellation of the textbook formula. `|d| ≤ tol.parallel·scale²` → undefined `collinear`. Otherwise defined; radius above `tol.far/2` → `too_far`; condition number `scale²/|d|` over 1e6 adds `ill_conditioned`.
- `Incircle(A, B, C)`: sides `a, b, c`, incentre `(aA + bB + cC)/(a+b+c)`, radius `2·area/(a+b+c)`.

### 4.2 Ellipse, hyperbola, parabola

- `Ellipse(F1, F2, a)`: with `c = |F1F2|/2`: `a < c` → `too_short` (message: "the major axis must be longer than the distance between the foci"); `a = c` degenerate: kind `line` segment is not representable, so `a ≤ c·(1+1e-12)` → `too_short`. Otherwise the frame of 3.2, `b = √((a−c)(a+c))` (this form avoids cancellation).
- `Ellipse(F1, F2, P)`: `a = (|PF1| + |PF2|)/2`.
- `Ellipse(F1, F2, seg)`: `a = Length(seg)`.
- `Hyperbola(F1, F2, a)`: needs `0 < a < c`: otherwise `too_long` (2a at least the distance of the foci) or `non_positive`. `b = √((c−a)(c+a))`.
- `Hyperbola(F1, F2, P)`: `a = ||PF1| − |PF2||/2`.
- `Parabola(F, d)`: `F` on `d` (distance ≤ `tol.on`·scale) → `focus_on_directrix`. `d` is a line-like; the carrier line is used.
- Coincident foci with `Ellipse` give a circle with centre at the point; that is allowed (`c = 0`, `b = a`); `Hyperbola` with `c = 0` → `coincident_points`.

### 4.3 `Conic` from five points

1. Reject coincident points (`coincident_points`).
2. **Normalise** (Hartley): translate to the centroid; scale so the mean distance to the origin is √2. This reduces the condition number of the next step by orders of magnitude for figures far from the origin or at unusual scales.
3. Build the 5×6 matrix of `(x², xy, y², x, y, 1)`, pad to 6×6 with a zero row, and take its **right singular vector for the smallest singular value** using a one-sided Jacobi SVD (about 5 µs). This avoids squaring the condition number as the normal-equations method does.
4. **Rank test.** Let `σ1 ≥ … ≥ σ6` be the singular values. If `σ5 ≤ 1e-10·σ1`, the five points do not determine one conic (four on a line, or other dependency): undefined `collinear` for four collinear points, `degenerate_points` otherwise. If `σ6 ≤ 1e-10·σ1` and `σ5 > 1e-10·σ1` it is the normal case.
5. De-normalise the 6-vector with the inverse similarity applied to the quadratic form. Classify (3.3). Three collinear points among the five give a line pair, a valid result of kind `lines`.
6. **Near-parabola.** The classification test is relative (3.3), so no hand-tuning is needed; `margin` reports how close.

The conic *passes through the five points to about 1e-14 relative to the figure scale* for conditioning under 1e6; the speed target is 8 µs.

### 4.4 `Conic` from numbers, a list or an equation

- Six numbers or a list of six: stored as given. A list of the wrong length → `bad_argument`.
- `Conic(Bool equation)`: the kernel expands the two sides into a polynomial in `x` and `y` (core formula compiler: a small polynomial-expansion pass: sums, products, integer powers, division by an expression free of `x` and `y`). The coefficients are expressions of other objects, so `Conic(x^2 + y^2 == r^2)` with a slider `r` is dependent and live. Degree above 2 → definition error `not_quadratic` with the highest term in `token`. A term with `x` or `y` inside a function (`sin(x)`) → `not_polynomial`. All `x`, `y` mentions must be bare names.
- The result has kind per 3.3. `Circle(Bool equation)` does not exist; if the user knows it is a circle, `Conic(…)` is enough and `Radius`, `Center` work.

### 4.5 Arcs and sectors

- `Arc(C, r, from, to)`: sweep `s = to − from` if `0 ≤ s ≤ 2π` (this keeps a slider that sets `to` continuous, including the full circle at `s = 2π` and the empty arc at 0); otherwise `s = wrap(to − from)` into `[0, 2π)`. `sweep = 0` is a defined empty arc (drawn as nothing; `Length` 0).
- `Arc(C, S, E)` (three points): as `Sector(C, S, E)` below, without the radii.
- `Arc(Conic, P, Q)`: angles are the polar angles of `P − C` and `Q − C` (so the points need not be exactly on the conic: the arc is cut at the ray's intersection). `P` or `Q` at the centre → `coincident_points`. `from` = angle of P, sweep = counter-clockwise to Q, wrapped into `(0, 2π]` (equal angles give the full conic here, because the user gave points).
- `ArcThrough(A, B, C)`: the circumscribed circle (4.1), and the arc that starts at A, passes through B and ends at C. If `orient(A, B, C)` is positive the walk is counter-clockwise: `from` = angle of A, `sweep` = counter-clockwise angle from A to C. If it is negative the walk is clockwise, so the stored arc is the counter-clockwise one from C to A and the value sets `reversed: true`; `Vertex`-style readers of its end points then report A first and C second. Collinear → `collinear`.
- `Semicircle(A, B)`: arc, centre = midpoint, from = angle(B − M), sweep = π (left of A→B).
- `Sector(…)` same data as `Arc`, drawn closed through the centre, with `Area`.
- `Sector(C, start, end)`: `from` = angle of `start − C`, sweep ccw to the direction of `end − C`, radius `|start − C|`.
- **Ellipse arcs:** angles are the global polar angles about the centre, like the path parameter. For area and length they are converted to eccentric angles: with `φ′` the polar angle measured from the major axis, `η = atan2(a·sin φ′, b·cos φ′)`. The two end angles are unwrapped so that `η_end − η_start` has the same sign and nearly the same size as the polar sweep, which keeps area and length continuous when the sweep passes 0 or 2π.

### 4.6 Measures of conics, arcs and sectors

| Measure | Formula and method |
|---|---|
| Circle area | `π r²` |
| Ellipse area | `π a b` |
| Circle circumference | `2π r` |
| Ellipse circumference | `4 a E(m)` with `m = 1 − b²/a²`, `E` the complete elliptic integral of the second kind by the arithmetic-geometric mean iteration (about 6 iterations to 1e-16); stable for very flat ellipses; `b = 0` handled as `4a` |
| Arc length, circle | `r·sweep` |
| Arc length, ellipse | Gauss–Kronrod 15 point per interval on `√(a² sin²η + b² cos²η)` over the eccentric angle, adaptive to 1e-13 relative; ≤ 64 intervals |
| Arc length, parabola / hyperbola arcs (via `Length(Arc)` on a conic arc) | parabola closed form `½(u√(1+u²) + asinh u)` scaled; hyperbola by the same adaptive scheme in `w` |
| Circle sector area | `½ r² sweep` |
| Ellipse sector area | `½ a b Δη` over the eccentric angle (from the centre) |
| Area of a segment (chord and arc) | Not a command; teacher writes `Area(Sector) − Area(Polygon(O, P, Q))` |

All results are `Number`. Undefined `unbounded` for hyperbola and parabola areas.

## 5. Properties of a conic: rules

Rules read the frame. Orders (per points-lines 3.5) are:

| Output | Slot 1 | Slot 2 | Slots 3, 4 |
|---|---|---|---|
| `Focus` | `C + c·u` (positive side) | `C − c·u` | none |
| `Vertex` (ellipse) | `C + a·u` | `C − a·u` | `C + b·n`, `C − b·n` with `n` the left normal of `u` |
| `Vertex` (hyperbola) | `C + a·u` | `C − a·u` | none |
| `Directrix` | line perpendicular to `u` through `C + (a/e)·u` | line perpendicular to `u` through `C − (a/e)·u` | none |
| `Axes` | major line (through `C` along `u`) | minor line | none |
| `Asymptote` | direction `(a, b)` in the frame | direction `(a, −b)` | none |

For a conic with a native frame, `u` is the construction's direction (F1→F2): the labels follow the user's focus order. For a matrix-derived conic the orientation convention of 3.3 applies and the property outputs may swap order if the conic is rotated past vertical; the docs tell the teacher to use `Ellipse(F1, F2, a)` when focus names matter.

Further formulas:
- `Eccentricity = c/a` (ellipse), `c/a` (hyperbola, > 1), 1 (parabola), 0 (circle).
- `LinearEccentricity = c`; parabola: `p/2`.
- `Parameter(parabola) = p`.
- `Tilt` = `atan2(uy, ux)` wrapped to `[0, π)`.
- Circle `Focus`: the centre twice; `Directrix` → `no_directrix`.
- Degenerate kinds (`lines`, `parallel`, `double`, `point`, `empty`, `line`) make every property undefined with `wrong_kind` and `because` naming the kind, except `Center` (the intersection point of the two lines; the point for `point`), `Axes` (the two angle bisectors of intersecting lines), and `Asymptote` (for `lines` the lines themselves).

## 6. Special lines

### 6.1 `Polar` and `Pole`

`Polar(P, c)`: the homogeneous line `M · (Px, Py, 1)ᵀ`, normalised as `HLine`. If `M·p` is the zero vector (P is the singular point of a rank-2 conic) → `degenerate_conic`. Works for every conic kind. For a point on the conic the polar is its tangent.

`Pole(L, c)`: the point `M⁻¹ · L`. Needs rank 3. A pole at infinity (the line passes through the centre of a central conic, or is parallel to a parabola's axis) → `at_infinity` (a value the lesson can state). Condition number from the singular values; over 1e8 adds `ill_conditioned`.

### 6.2 `Tangent(Point P, Conic c)`

1. `s = pᵀ M p` (the conic value at `P`), compared with `‖M‖·(|P|² + 1)·tol.on`.
2. `s` within tolerance: `P` is on the conic. Slot 1 is the polar line (the tangent), slot 2 undefined with `on_conic` (meaning: only one tangent).
3. Inside (the sign of `s` equals the sign of the interior for ellipses; computed by comparing with the value at the centre): both slots undefined with `inside`.
4. Outside: intersect the polar line with the conic (points-lines 4.3, relative discriminant). The two touching points `T1`, `T2`; tangents are `Line(P, Ti)` (computed as `p × t_i` homogeneous, then normalised). Slot order: `T1` is the one on the **left** of the ray from `P` toward the conic's reference point (centre; for a parabola, the vertex), decided by `orient`.
5. Hyperbola/parabola: if `P` is on an asymptote, one tangent is the asymptote at infinity: the polar meets the conic in one finite point only; slot 2 undefined with `at_infinity`.
6. Because the on/outside decision and the intersection use the same relative scale, a point that is "almost on" the conic gives two nearly equal tangents rather than flicker; the note `near_boundary` is set when `|s|` is within `1e3×` the tolerance.

### 6.3 `Tangent(Line l, Conic c)` (parallel tangents)

Use the dual conic `M* = adj(M)` (the adjugate; a line `(a, b, c₀)` is tangent iff `(a b c₀) M* (a b c₀)ᵀ = 0`). For the fixed normal `(a, b)` of `l`, this is a quadratic in `c₀`: solve with the stable pair form (points-lines 4.3). Two real roots → two tangents (slot 1 has the smaller `c₀`, that is, the one toward the negative side of the line's normal); none → undefined `no_tangent`; one (a parabola, `M*₃₃ = 0`) → slot 1 defined, slot 2 `no_tangent`. Rank-deficient `M` → `degenerate_conic`.

### 6.4 `Tangent(Conic c1, Conic c2)` (common tangents)

The dual conics `M1*` and `M2*` are conics in line space; the tangents common to both are their intersections in that space (points-lines 4.4, treating the homogeneous line triple as a point). Up to four. For two circles this yields the familiar 2 outer, 2 inner (or fewer when circles overlap or nest). Slots are ordered by the angle of the line normal; the same canonical rule as points-lines 4.4. Each line is normalised to a unit normal and validated: residual `lᵀM*l` below tolerance for both.

### 6.5 `ConjugateDiameter`

For direction `d` (given by a line or a vector), the conjugate diameter is the polar line of the point at infinity in direction `d`: `M · (dx, dy, 0)ᵀ`. For central conics it passes through the centre; for a parabola it is parallel to the axis. A direction that is an asymptote direction of a hyperbola gives the asymptote itself (note `asymptote`).

### 6.6 `Asymptote`

- **Conic.** Hyperbola: the two lines through the centre with directions `a·u ± b·n`. `lines` kind: the two lines. Else `not_hyperbola`.
- **Function** (list of lines; the calculus area owns the polynomial extraction):
  1. If the function is rational (polynomial over polynomial, found by expansion of its tree): vertical asymptotes at denominator roots that are not roots of the numerator with at least the same multiplicity (compute by exact polynomial gcd of rational-coefficient polynomials when the coefficients are literal numbers; otherwise numeric roots with a relative 1e-9 test); horizontal or oblique from polynomial division (degree comparison).
  2. Otherwise: horizontal/oblique by the limits `m = lim f(x)/x`, `k = lim (f(x) − m·x)` as `x → ±∞`, estimated at x = ±1e3, ±1e4, ±1e5, ±1e6 with Richardson extrapolation, accepted when successive estimates agree to 1e-6 relative; vertical by scanning for poles: where `|f|` grows without bound approaching a point from both sides (bracketing by a sign-of-1/f change plus magnitude test) over the figure's requested interval (default scan interval `[−100, 100]`, a figure-level directive).
  3. Results sorted: vertical lines by x, then horizontal/oblique left to right.
  4. Not guaranteed complete; the result carries `sampled` when step 2 was used.
- **Curve (implicit, parametric):** v1 handles parametric curves with rational components and returns `[]` otherwise; implicit curves are v2.

### 6.7 `IsTangent(l, c)`

Bool: the relative discriminant of the line-conic quadratic is within `tol`, or the dual-conic test `lᵀ M* l` is within tolerance scaled by `‖M*‖‖l‖²`. Same threshold as the intersection's tangency, so `IsTangent(l, c)` is true exactly when `Intersect(l, c)` is a tangent contact.

## 7. Curvature and osculating circles

For an implicit curve `F(x, y) = 0` with gradient `g = (Fx, Fy)` and Hessian `H`: signed curvature `κ = −(Fy² Fxx − 2 Fx Fy Fxy + Fx² Fyy)/|g|³`; for a conic `F` is the quadratic. For `y = f(x)`: `κ = f″/(1 + f′²)^{3/2}`. For a parametric curve: `κ = (x′y″ − y′x″)/(x′² + y′²)^{3/2}`. Derivatives come from exact symbolic differentiation of the function's tree (core design: `Derivative` is exact). The point argument is projected onto the curve first (`Closest`); a point not on the curve evaluates the curve at the projection and carries the note `projected`.

- `Curvature(P, obj)` → number.
- `CurvatureVector(P, obj)` → `κ·N` with `N` the unit normal on the concave side (equivalently `T′/|r′|`).
- `OsculatingCircle(P, obj)` → circle with centre `P + N/κ`, radius `1/|κ|`; `κ = 0` (inflection, line) → `straight` undefined. Gradient zero (singular point) → `singular_point`.

## 8. Intersections that involve conics

See points-lines 4.3, 4.4. The conic side contributes: `Quad`, `kind` (degenerate conics are intersected as their lines), the native frame (for ordering and for arc filtering), and the arc's angle range.

## 9. Rules and the command table

```ts
// Examples of entries; shape follows core design section 5.
const ellipse: CommandSpec = {
  name: 'Ellipse', kind: 'object', group: 'conics',
  forms: [
    { params: [{name:'f1', type:'Point'}, {name:'f2', type:'Point'}, {name:'a', type:'Number'}],  returns:'Conic', rule: ellipseFociLength,  summary:'Ellipse from two foci and the semi-major axis' },
    { params: [{name:'f1', type:'Point'}, {name:'f2', type:'Point'}, {name:'seg', type:'Segment'}], returns:'Conic', rule: ellipseFociSegment, summary:'…' },
    { params: [{name:'f1', type:'Point'}, {name:'f2', type:'Point'}, {name:'p',  type:'Point'}],   returns:'Conic', rule: ellipseFociPoint,   summary:'Ellipse through a point' },
  ],
};
```

- Constructors return `ConicValue`; the property commands are one table `property(kind → fn)` rather than a rule per command: `Focus`, `Vertex`, `Directrix`, `Axes`, `Eccentricity` and the rest pull from the frame and kind. A new property is one row.
- `Arc` and `Sector` share one rule family; the `Sector` flag only changes drawing and adds `Area`.
- **Static types** of the forms: `Circle` constructors return `Circle`; `Ellipse`, `Hyperbola`, `Parabola`, `Conic` return `Conic`; any command that says `Conic` also accepts `Circle` (subtype).

## 10. Rendering data

The kernel provides drawing data, not pixels:

| Kind | Data given to the view |
|---|---|
| circle, ellipse | frame; the plotter draws with the exact sagitta rule: segments such that the maximum deviation is ≤ 0.25 px at the current zoom |
| parabola, hyperbola | frame; the view solves for the parameter range that covers the visible rectangle expanded by 20% and draws only that range |
| line kinds | the lines |
| arcs, sectors | the conic plus `from`, `sweep` |

For a huge, nearly flat ellipse (`a ≥ 1e6` pixels), the view clips to the visible rectangle through the parameter solve rather than sampling the whole curve.

## 11. Numerical robustness

| Situation | Behaviour |
|---|---|
| Near-parabola (`|δ|` tiny) | Relative test `ρ'`; the matrix-based commands still work; `near_boundary:parabola` note when margin < 1e-6; the frame is the ellipse or hyperbola frame with a very large semi-axis; if `a` exceeds `1e12` (centre beyond `tol.far`) the kind is reported as parabola |
| Near-circle | Eigenvalue gap test `1e-10`; ellipse frame still fine (axes arbitrary); `PointOn` unaffected (global angle) |
| Degenerate conic from equation | Reported kind (`lines`, `double`, …); commands that need a regular conic give `wrong_kind` |
| Tangent from near-boundary points | Single relative test shared with intersection (6.2) |
| Huge or tiny coefficients | Scale to unit Frobenius norm first; magnitudes beyond 1e150 → `not_finite` |
| Five almost-collinear points | `σ5` test; `ill_conditioned` when `σ5/σ1 < 1e-6` |
| Three points almost collinear for `Circle(A,B,C)` | Defined with `ill_conditioned` until `collinear` |
| Ellipse with `b → 0` | `b = √((a−c)(a+c))` keeps precision; `b < 1e-12 a` is a flat ellipse and still defined; the circumference formula handles `b = 0` |
| Arc sweep crossing 0 and 2π | continuous by 4.5 |
| Elliptic integrals | AGM and Gauss–Kronrod have documented error bounds (1e-16, 1e-13) |

Speed targets: classification 0.2 µs; frame 0.3 µs; five-point 8 µs; tangent from a point 0.8 µs; common tangents 15 µs; closest point on ellipse 1 µs; AGM circumference 0.3 µs; adaptive ellipse arc length 4 µs.

## 12. Better than GeoGebra

1. **Native frames** for constructed conics: no axis swap at the circle crossing; labelled foci stay put.
2. **Global polar angle** as the ellipse parameter: points on ellipses survive any shape change.
3. **Relative classification with margin**: `near_boundary` notes instead of silent flips; no per-object hand-tuned tolerances.
4. **Total `Circle` type**: `Circle` commands never see an ellipse; `Conic` handles the general case.
5. **Ellipse circumference by AGM**: exact to machine precision, fast, for any flatness.
6. **Tangents robust to near-on-conic points**: one test shared with intersection.
7. **No silent type change**: `Ellipse` with a too-short axis is `too_short`, not a hyperbola.
8. **Common tangents** as one intersection in the dual plane: one code path for all conic pairs.
9. **Stable five-point conic** with normalisation and SVD.
10. **Live equation conics**: `Conic(x^2 + y^2 == r^2)` depends on `r` (the polynomial-extraction pass), so equations are teachable and slidable.
11. **`Type` as text**, not numeric codes.
12. **One property table** instead of one algorithm per property.

## 13. Open questions for the owner

1. Is the `too_short` rule right for teaching? Some lessons slide the major axis from "ellipse" to "hyperbola". A separate `Conic2(F1, F2, k)` that returns either by the sign of `k − c` could be added; for now two commands.
2. Should `Vertex` list the co-vertices for ellipses by default (4 entries)?
3. Is a global polar angle (non-uniform arc speed) acceptable for `PointOn(ellipse)` animated with `Along(c, t / 10)`? It moves faster where the ellipse is nearer the centre. Alternative: `Along` on an ellipse can use the eccentric angle, since `Along` has no stored parameter and needs no continuity across frames. Proposed: yes, `Along` uses eccentric angle for ellipses (uniform in the construction), `PointOn` uses the polar angle.

## 14. Changes to the core design

1. **Type table:** `Conic` (supertype of `Circle`), `Arc` gets angle range and sweep, `Sector` added (see points-lines 13.8).
2. **Equation forms:** a polynomial-extraction pass in the formula compiler for `Conic(Bool)`, `Line(Bool)` and the calculus area's exact-derivative and asymptote needs. It expands sums, products, integer powers, division by constants-in-`x,y` and yields coefficient expressions.
3. **`@tol`** directive (shared) also controls `ρ`.
4. **Notes:** `near_boundary`, `projected`, `asymptote` join the note list of points-lines 10.2.
5. **Undefined reasons** (list in `errors.md`).
6. **Defined `Circle` with radius 0** is a degenerate circle (a dot) and not an error, so a slider through 0 does not blink the figure's dependents.
7. **No need for new line kinds:** everything is a `Line`, a `Circle` or a `Conic`.

## 15. Sources studied

GeoGebra source (commit 3608374), `source/shared/common/src/main/java/org/geogebra/common/`:
- `kernel/kernelND/GeoConicND.java`, `ConicMatrix.java`, `GeoConicPartND.java`, `GeoConicNDConstants.java`, `GeoQuadricND.java` : matrix form, type constants, classification, frame, path parameters
- `kernel/geos/GeoConic.java`, `GeoConicPart.java`
- `kernel/algos/`: circle, ellipse, hyperbola, parabola, five-point and six-coefficient conic algorithms; conic part (arc, sector) algorithms; tangent, polar, diameter, focus, vertex, directrix, axes, eccentricity, area, circumference, incircle and common-tangent algorithms; line-conic and conic-conic intersections
- `kernel/advanced/`: asymptote, curvature, osculating circle, directrix, eccentricity, incircle
- `kernel/Kernel.java` : precision constants
- `kernel/commands/`: `CmdCircle`, `CmdConic`, `CmdEllipse`-family argument handling (to learn which forms exist)

GeoGebra manual:
- https://geogebra.github.io/docs/manual/en/commands/Conic_Commands/ and its pages: Axes, Center, Circle, Circumference, Coefficients, Conic, ConjugateDiameter, Curvature, Directrix, Eccentricity, Ellipse, Focus, Hyperbola, Incircle, LinearEccentricity, MajorAxis, MinorAxis, OsculatingCircle, Parabola, Parameter, PathParameter, Perimeter, Polar, Radius, Sector, SemiMajorAxisLength, SemiMinorAxisLength, Semicircle, Tangent, Type, Vertex
- https://geogebra.github.io/docs/manual/en/commands/Geometry_Commands/ pages: Arc, Circle, CircularSector, CircumcircularArc, CircumcircularSector, Angle (conic), Area, Asymptote, IsTangent
- https://geogebra.github.io/docs/manual/en/tools/Circle_and_Arc_Tools/ and https://geogebra.github.io/docs/manual/en/tools/Conic_Section_Tools/
