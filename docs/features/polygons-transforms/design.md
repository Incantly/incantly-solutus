# Polygons and transformations: design

Status: draft for review. Plane-geometry area, third folder. Uses the shared model in `docs/features/points-lines/design.md` (sections 3.1 to 3.5: `V2`, `HLine`, `Tol`, `det2`, `orient`, `Path`, notes, ordering) and the conic values in `docs/features/conics/design.md` (section 3). Fits `docs/design/formula-language-and-kernel.md`. Nothing is copied from GeoGebra; section 14 lists what was read.

## 1. What the learner and the teacher get

Polygons that stay polygons while their corners move: area and perimeter update, interior angles add up, a regular polygon grows when a slider turns. Transformations that show what they do: a triangle slides along a vector, turns about a point, flips across a line, grows from a centre, shears, stretches. The image is **live**: drag a corner of the original and the image follows; turn the angle slider and the image turns.

### 1.1 Command coverage

Forms are in our syntax. `shape` means Point, Vector, Segment, Ray, Line, Circle, Conic, Arc, Sector, Polygon, Polyline, Function, Curve or a `List` of those.

**Polygons and polylines**

| Command | Forms | Result |
|---|---|---|
| `Polygon` | `(Point, Point, Point, …)` (3 or more), `(List<Point>)`, `(Point center, Number radius, Number sides)` regular, `(Point P, Point Q, Number sides)` regular on the edge PQ, `(Point start, Vector, Vector, …)` vector polygon | Polygon |
| `Polyline` | `(Point, Point, …)`, `(List<Point>)`, `(Point start, Vector, Vector, …)` | Polyline (open) |
| `Rigid` | `(Polygon)`, `(Polygon, Number dx, Number dy)`, `(Point, Point, Point, …)` | Polygon with a fixed shape and a free pose (section 5) |
| `Vertex` | `(Polygon, Number k)`, `(Polyline, Number k)` | Point |
| `Vertices` | `(Polygon)`, `(Polyline)` | `List<Point>` |
| `Side` | `(Polygon, Number k)` (from vertex k to k+1, wrapping) | Segment |
| `Sides` | `(Polygon)`, `(Polyline)` | `List<Segment>` |
| `Centroid` | `(Polygon)` | Point |
| `Convex` | `(Polygon)` | Bool |
| `Simple` | `(Polygon)` (no self-crossing) | Bool |

Named arguments for regular polygons: `start = angle` (direction of the first vertex from the centre, default `π/2`: point up) and, for the edge form, nothing else (orientation is counter-clockwise from P to Q).

**Measures**

| Command | Forms | Result |
|---|---|---|
| `Area` | `(Polygon)`, `(Point, Point, Point, …)` (the polygon through these points, no object made), `(Sector)`, `(Conic)`, `(Region)` | Number |
| `SignedArea` | `(Polygon)`: positive for counter-clockwise order | Number |
| `Perimeter` | `(Polygon)`, `(Polyline)`, `(Conic)` (circle and ellipse), `(Sector)` | Number |
| `Circumference` | `(Conic)` | Number (alias of `Perimeter` for conics; defined in `conics`) |
| `Length` | `(Polyline)`, `(Arc)`, `(Segment)`, `(Vector)` | Number |
| `InteriorAngles` | `(Polygon)` | `List<Angle>`, one per vertex, in vertex order |
| `Angle` | `(Point, Point, Point)` etc. in `points-lines`; the polygon form is `InteriorAngles` | |
| `Distance` | `(Point, Polygon)` to the boundary: `points-lines` | Number |
| `Slope` | `points-lines` | |
| `InRegion` | `(Point, Polygon)`, `(Point, Conic)`, `(Point, Sector)` | Bool (boundary counts as inside, within tolerance) |

**Polygon operations**

| Command | Forms | Result |
|---|---|---|
| `IntersectPath` | `(Line-like, Polygon)`: the parts of the line inside the polygon, in order along the line; `(Polygon, Polygon)`: the common area | `List<Segment>` for the first form, `List<Polygon>` for the second |
| `Union` | `(Polygon, Polygon)` | `List<Polygon>` (one polygon if they overlap or touch, otherwise two) |
| `Difference` | `(Polygon, Polygon)` | `List<Polygon>` |

Boolean results are lists because the answer can be several pieces or none. A hole (the second polygon strictly inside the first) is not representable in v1: the result is undefined with reason `has_hole` and a hint to split. See 4.4.

**Transformations**

| Command | Forms | Notes |
|---|---|---|
| `Translate` | `(shape, Vector)`, `(Vector, Point)` (place the vector with its start at the point) | |
| `Rotate` | `(shape, Number angle, Point center)`, `(shape, Number angle)` (about the origin) | Counter-clockwise for positive angles |
| `Reflect` | `(shape, Line)`, `(shape, Point)`, `(shape, Circle)` (inversion) | Also accepts Segment and Ray as the mirror; the carrier line is used |
| `Dilate` | `(shape, Number factor, Point center)`, `(shape, Number factor)` (about the origin) | Negative factors turn the figure through half a turn |
| `Shear` | `(shape, Line, Number ratio)` | Points on the line stay fixed; a point at signed distance `d` from the line moves `ratio·d` along the line |
| `Stretch` | `(shape, Line, Number ratio)`, `(shape, Vector)` | Perpendicular to the line (first form); along the vector with ratio equal to its length, about the line through its start perpendicular to it (second) |
| `ApplyMatrix` | `(Matrix, shape)` with a 2×2 (linear) or 3×3 (affine or projective) matrix | The matrix type comes from the numbers-and-matrices area |

All forms of `Translate`, `Rotate`, `Reflect`, `Dilate`, `Shear` and `Stretch` accept the named argument `progress = u` (a number from 0 to 1, default 1): the figure is shown `u` of the way from the original to the image (section 8.5).

**Transformations as values** (v1.1, same module, section 8.6)

| Command | Forms | Result |
|---|---|---|
| `Shift`, `Turn`, `Mirror`, `Scale`, `ShearBy`, `StretchBy`, `Linear` | the transformation without a figure: `Shift(v)`, `Turn(angle, center)`, `Mirror(line)`, `Scale(factor, center)`, `ShearBy(line, ratio)`, `StretchBy(line, ratio)`, `Linear(Matrix)` | Transform |
| `Then` | `(Transform, Transform, …)`: first, second, … | Transform |
| `Inverse` | `(Transform)` | Transform |
| `Move` | `(shape, Transform)` | the shape's image |

**Not in v1:** 3D transformations, rotation about an axis, `Reflect` about a plane, boolean operations that give holes, polygon offsetting, triangulation commands, `Polygon` with automatic labelled vertex objects (see 3.3).

### 1.2 Tools the learner can pick

Polygon; Regular Polygon; Rigid Polygon; Vector Polygon; Translate by Vector; Rotate around Point; Reflect about Line; Reflect about Point; Reflect about Circle; Dilate from Point by Factor; plus the measurement tools Area and Angle. Details in `ui.md`.

## 2. How GeoGebra does it (in plain words)

**Polygons.** A polygon is a list of vertex points and a set of segment objects, one per side, plus an area value. Creating a polygon from clicked points creates the vertices (named), the segments (named) and the polygon. Regular polygons create the missing vertices as dependent points rotated around the computed centre, one at a time. The area is the shoelace sum, using the absolute value; a self-crossing polygon gives an unexpected number. A "rigid polygon" is a copy whose shape is fixed and whose first vertex is dragged to move it and whose second vertex is dragged to turn it. There is a "vector polygon" tool that builds a closed shape from a start and vectors. Boolean operations (intersection, union, difference) exist for polygons; the union only works if the result is one polygon.

**Transformations.** One class per kind (translate, rotate, mirror, dilate, shear/stretch) with a shared base. Transforming a polygon (or a segment, arc, sector) also transforms every vertex, creating new named points and new segments, so a single command leaves a whole family of auxiliary objects. Transforming a point, line, conic, vector gives one image. Function images become parametric curves when the transformation is not a function-preserving one (rotation, shear). Each image gets the source's style and the next free label with a prime (A', A'', A''').

**Dependency.** The image is a dependent object of the source and of the parameters (vector, angle, centre, line, factor). Changing a parameter or the source recomputes the image. Dragging an image drags nothing (it is dependent); it behaves like any dependent object.

**What works well.** Every transformation is an affine map applied to each point, so one framework covers all kinds. Images stay live. The labelled prime naming makes the correspondence visible (A to A'). Vector images keep their start.

**What is weak.**
- One command creates many objects (vertices, sides). Hiding or deleting them is a chore, and the construction list floods.
- Shapes whose image is no longer the same type (a circle under shear is an ellipse; a circle inverted through a point on it is a line) either fail or silently become a different object type.
- The area of a self-crossing polygon is a plain shoelace value with no warning.
- A reflection about a line that is defined by two identical points gives undefined images with no reason.
- Rotations by 90 degrees leave tiny rounding errors in coordinates.
- Boolean polygon operations handle only the single-polygon case and are not robust when vertices lie exactly on edges.
- Showing a transformation as a motion (rotating gradually) requires the user to build a slider and rewrite the angle expression by hand.
- Rigid polygons are special-cased in the file format and in dragging.

## 3. Our polygon model

### 3.1 Value types

```ts
export interface PolygonValue {
  readonly pts: readonly V2[];           // n ≥ 3, in order; the closing edge is implied
  readonly signedArea: number;           // shoelace, compensated (3.2)
  readonly orientation: -1 | 0 | 1;      // from signedArea and orient, 0 if degenerate
  readonly flags: number;                // bit set: simple, convex, checked (computed on demand, cached)
}

export interface PolylineValue { readonly pts: readonly V2[] }   // n ≥ 2, open
```

Polygons are plain data: vertex positions only. No vertex objects, no segment objects exist unless the user asks for them with `Vertex`, `Side` and friends. These accessor commands are ordinary rules (`pts[k]`, a segment between two stored points). They update live when the polygon changes.

Type table additions: `Polygon`, `Polyline` (already named in the core design for Polygon; Polyline is new).

### 3.2 Numerics for polygon measures

- **Area (shoelace).** Translate every vertex by the first vertex (`q_i = p_i − p_0`) before summing `q_i × q_{i+1}`. A polygon with coordinates near 1e6 and size near 1 would otherwise lose six digits. Accumulate the sum with Neumaier compensation. Accuracy: relative error below `4·n·ε` of the sum of absolute terms.
- **Orientation.** Sign of the signed area, except when its magnitude is within the rounding bound; then 0 (degenerate polygon).
- **Perimeter.** Sum of `hypot(dx, dy)`, Neumaier compensated.
- **Centroid.** Area centroid, in coordinates relative to the first vertex: `Σ (q_i + q_{i+1})·(q_i × q_{i+1}) / (6·A)`. Zero area (within the rounding bound) → undefined `zero_area`; the teacher can use `Centroid` of the `List<Point>` form (vertex mean) instead.
- **Simple (no self-crossing).** For `n ≤ 256` test all non-adjacent edge pairs with the robust `orient` predicate (worst case 32k tests, about 0.2 ms, only when a vertex changed); beyond 256 vertices the check is skipped and `Area` carries the note `unchecked`.
- **Convex.** All consecutive `orient` results have the same sign (zero ignored), and the total turning is one full turn (sum of exterior angles = 2π) to reject stars.
- **Self-crossing polygons.** `Area` returns the absolute value of the signed area (the algebraic area) with the note `self_intersecting`; `Perimeter` is unaffected. The fill rule for drawing and for `InRegion` is configurable, default **even-odd**, so a pentagram has the usual hollow centre; `Area` under that rule is not offered (it would need a decomposition) and the note says so.
- **InRegion (point in polygon).** Winding number with exact crossing decisions through `orient`; points within `tol.on · scale` of an edge count as inside. Cost O(n).
- **InteriorAngles.** For vertex `i` with previous `p` and next `q`: for a counter-clockwise polygon the interior angle is the counter-clockwise angle from `q − v` to `p − v` wrapped to `(0, 2π)`; for clockwise, the mirror. It is computed with `atan2(cross, dot)` (points-lines 7), so a reflex vertex gives an angle above π. For a simple polygon the sum is `(n − 2)π` to within rounding; the test suite checks that; self-intersecting polygons add the note `self_intersecting`.

### 3.3 No automatic vertex and side objects

GeoGebra makes named vertex and segment objects for every polygon. We do not. Reasons: one line, one change; no floods of labels; a polygon that moves with a vertex slider has no hidden children. If the learner wants named corners, the tools do it by writing normal lines: `A = (0, 0)`, `B = (4, 0)`, `C = (1, 3)`, `tri = Polygon(A, B, C)`. For images, the figure shows the corner labels of the image (`A′`, `B′`, `C′`) as a **style**: `tri2 = Rotate(tri, 40°, O) with vertexlabels = prime`. These labels belong to the polygon and are not objects; they update with it and are saved as a style property.

Tools that create several free points do so as separate lines before the polygon line (3.5).

### 3.4 Rules for each polygon command

- **`Polygon(P1, …, Pn)`**: `n < 3` → check-time error `too_few_points`. Duplicate consecutive points are allowed (a degenerate edge, zero length); all points equal → area 0, defined.
- **`Polygon(List<Point>)`**: same, with the list's length known only at run time: fewer than 3 defined points → undefined `too_few_points`. Undefined entries in the list: the polygon is undefined with `undefined_input`.
- **Regular, centre form** `Polygon(C, r, n)`: `n` must be a whole number (within 1e-9), `3 ≤ n ≤ 1000`; whole-number test fails → `not_whole`; `n < 3` → `too_few_sides`; above 1000 → `limit`. `r < 0` → vertices point the opposite way (rotation by π); `r = 0` all vertices equal. Vertex `k` (0-based): `C + r·(cos(s + 2πk/n), sin(s + 2πk/n))`, `s = start` (default `π/2`). Each vertex uses the direct angle, never repeated rotation, so there is no error build-up at `n = 1000`.
- **Regular, edge form** `Polygon(P, Q, n)`: side `s = |PQ|`, midpoint `M`, apothem `h = s/(2·tan(π/n))`, centre `O = M + h·n̂` with `n̂` the left normal of `PQ`. Vertices are `P` rotated about `O` by `2πk/n`. Counter-clockwise from `P`: vertex 0 is `P`, vertex 1 is `Q` (up to rounding; the rule sets vertex 1 to `Q` exactly). `P = Q` → `coincident_points`.
- **Vector polygon** `Polygon(S, v1, …, vm)`: vertices `S`, `S + v1`, `S + v1 + v2`, …; the closing edge goes back to `S` (the last vector need not close the shape). Needs `m ≥ 2`. The polygon equals the one a learner draws by laying the vectors head to tail. `Polyline` gives the open version.
- **`Vertex(poly, k)`**: `k` whole and in `1..n`; the literal `k` is checked at check time. Run-time out of range (a list-derived `k`) → `index_out_of_range`.
- **`Side(poly, k)`**: segment from vertex `k` to `k+1` (wrapping at `n`).

### 3.5 Tool-created figures

A polygon tool click sequence writes the free points first (named `A`, `B`, `C`, …), then the polygon. Clicking existing points reuses them. The regular polygon tool writes two free points then `Polygon(A, B, n)`. This keeps the script compact and readable.

## 4. Polygon operations

### 4.1 `IntersectPath(Line-like, Polygon)`

1. Collect the line's intersections with all edges (points-lines 4.5), as parameters `s` along the line.
2. Deduplicate vertices hit by two edges; classify a vertex hit as *crossing* or *touching* by the sides of the neighbouring vertices (`orient`), so a line grazing a corner does not split a chord.
3. Sort by `s`. Pair them up using an inside test of the midpoint of each consecutive pair (more robust than parity counting).
4. Limits: a segment or ray limits the parameter range; chord ends are clipped to it.
5. Result `List<Segment>` in order along the line; empty list when the line misses (as a value, not undefined). A line along an edge returns that edge as a segment with the note `overlap`.

### 4.2 `IntersectPath(Polygon, Polygon)`, `Union`, `Difference`

Inputs are simple polygons (self-crossing inputs → `not_simple`). Outputs are lists of simple polygons, each counter-clockwise, ordered by their lowest-left vertex.

Method:
- **Both convex** (very common in lessons): Sutherland–Hodgman clipping for intersection, 3 µs for two 8-gons. Union and difference through the general method.
- **General:** build the intersection graph of the two boundaries (the intersection points of all edge pairs, found with `orient`-based tests, ordered along each boundary), label each crossing entering or leaving, and walk the graph to assemble the result rings for each operation. Degenerate contacts (a vertex of one polygon lying exactly on an edge or vertex of the other, edges overlapping) are handled by perturbing the second polygon by a fixed tiny shift `1e-9·scale·(0.37, 0.71)` and setting the note `perturbed`; the shift is deterministic, so the same inputs give the same output. The perturbation is far below the drawing resolution and below `tol.on`.
- **Disjoint and containment:** if the boundaries do not cross, test one vertex of each polygon inside the other. Intersection of disjoint polygons: empty list. Union of disjoint: both. Containment: intersection is the inner polygon; union is the outer; `Difference(outer, inner)` would make a hole: undefined `has_hole`; `Difference(inner, outer)` is the empty list.
- Output rings smaller than `1e-12·scale²` in area are dropped.
- Cap: 256 total input vertices; above that `limit`.
- Accuracy: intersection vertices are accurate to 1 ulp of the edge parameter; area of result within `4nε` of exact for non-perturbed inputs.

### 4.3 Output and identity

Results are `List<Polygon>`; `L[1]` is the first. The order is canonical (lowest-left vertex), so replay is exact. If the number of pieces changes while dragging, the later pieces appear or disappear; labels of earlier pieces can swap when two pieces trade lowest-left positions. For a single-piece result, `Union(a, b)[1]` is the polygon.

### 4.4 Holes

A hole is an inner ring. Polygons with holes are v2 (a `Polygon` with `rings`). In v1 any result with a hole is `has_hole` and the hint suggests `Difference` of pieces or `IntersectPath` with a line to cut. This is a deliberate narrowing: the data model, the area, the fill rule, `InRegion` and hit testing are all simple for rings-free polygons.

## 5. Rigid polygons

`R = Rigid(poly)` makes a polygon `R` that has the **shape** of `poly` (side lengths and angles) but its own **pose**: a position and a turn. The pose is two free values owned by `R` (core change in `points-lines` 13.1):

- `R.anchor` (Point): where the first vertex is.
- `R.turn` (Number angle): the direction from the first vertex to the second.

Shape data: for source vertices `S_i`, the local coordinates `l_i = Rot(−φ)(S_i − S_1)`, with `φ` the direction of `S_2 − S_1`. The rigid copy has vertices `V_i = anchor + Rot(turn)·l_i`. `Rigid(poly)` starts with `anchor = S_1` (exactly on top of the source), `turn = φ`. `Rigid(poly, dx, dy)` starts at `S_1 + (dx, dy)`. The forms with points `Rigid(A, B, C, …)` take the current positions as the source shape and then no longer depend on those points.

Behaviour:
- Dragging vertex 1 (or the body) writes `anchor`. Dragging vertex 2 writes `turn` as the direction from `anchor` to the pointer. Other vertices cannot be dragged.
- If the source polygon is reshaped, the rigid copy takes the new shape and keeps its pose (the copy is a "live template").
- The script saves it as `R = Rigid(poly) with anchor = (3, 1), turn = 0.4` (a restyle-like line for params), so replay is exact.
- `Reflect(R, line)` is the way to flip it; rigid polygons are never mirrored.

This replaces GeoGebra's special-case dragging code with two ordinary free values and a pure rule.

## 6. Transformations: model

### 6.1 Transform value

Every transformation is a value of this shape, built by the rule from its parameters. Commands apply it to a shape; the transform values of 8.6 expose it.

```ts
export interface Affine2 { readonly a: number; readonly b: number; readonly c: number;
                           readonly d: number; readonly e: number; readonly f: number }
// x' = a·x + c·y + e,   y' = b·x + d·y + f

export type TfKind = 'translate' | 'rotate' | 'reflectLine' | 'reflectPoint'
                   | 'dilate' | 'shear' | 'stretch' | 'linear' | 'projective' | 'inversion';

export interface Tf {
  readonly kind: TfKind;
  readonly apply: (p: V2) => V2 | Undef;            // exact, centre-based (6.2)
  readonly affine?: Affine2;                        // absent for projective, inversion
  readonly h?: readonly number[];                   // 3×3 for projective
  readonly similar: boolean;                        // preserves shapes up to scale
  readonly isometry: boolean;
  readonly reversesOrientation: boolean;
  readonly singular: boolean;                       // determinant ≈ 0
  readonly cond: number;                            // condition number of the linear part
}
```

### 6.2 Precision: centre-based application

A rotation about a far-away centre written as `x' = cos·x − sin·y + e` with a precomputed `e` loses digits to cancellation. The rules apply the transformation in the **geometric form** `C + R(p − C)`, `p − 2((p − O)·n)n`, `C + k(p − C)`, and only build the `Affine2` (for composition, for conics, for the `Linear` form) when needed. `affine` is computed lazily and cached.

### 6.3 Exact quarter turns

`sincos(θ)` snaps to exact values when `θ` is within `4ε|θ|` of a multiple of `π/2`: `cos 90° = 0`, `sin 90° = 1`, exactly. Rotating `(3, 4)` by `90°` gives `(−4, 3)` with no `1e-16`. All other angles use `Math.cos` and `Math.sin`.

### 6.4 Constructors

| Transform | Parameters | Apply | Flags |
|---|---|---|---|
| Translate | vector `v` | `p + v` | isometry |
| Rotate | angle `θ`, centre `C` | `C + R_θ (p − C)` | isometry |
| Reflect, line | unit normal `n`, `c₀` with `n·p + c₀ = 0` on the line | `p − 2 (n·p + c₀) n` | isometry, reverses orientation |
| Reflect, point | centre `C` | `2C − p` | isometry (= rotation by π) |
| Dilate | factor `k`, centre `C` | `C + k (p − C)` | similar; `k = 0` singular; `k < 0` includes a half-turn |
| Shear | line (unit direction `d`, unit left normal `n`, offset `c₀`), ratio `r` | `p + r (n·p + c₀) d` | affine, area-preserving, not similar unless `r = 0` |
| Stretch, line | line, ratio `r` | `p + (r − 1)(n·p + c₀) n` | affine; `r = 0` singular; `r < 0` also flips |
| Stretch, vector | vector `v` with start `s`, unit `v̂`, ratio `|v|` | `p + (|v| − 1)((p − s)·v̂) v̂` | affine |
| Linear / ApplyMatrix 2×2 | `[[a, c], [b, d]]` | linear | `det` sets orientation and singular flag |
| ApplyMatrix 3×3 | `H` | `(x, y, 1)ᵀ → H·(x, y, 1)ᵀ`, divide by `w` | affine if last row `(0,0,1)`, else projective |
| Inversion | circle (centre `C`, radius `r`) | `C + r²(p − C)/|p − C|²` | similar? no; circle-preserving |

Singular tests are relative: for the linear part `L`, `|det L| ≤ 1e-12·(|a d| + |b c|)` (affine), or `cond > 1e12`. Dilate and Stretch use the exact zero factor test `|k| ≤ 1e-12`.

For `Reflect` about a line object: the line (or the carrier of a segment or ray) gives `n` and `c₀`. A degenerate line (zero direction) → `coincident_points`.

### 6.5 What the image of each shape is

Result types follow a table. A "similarity" is translate, rotate, reflect, dilate (any non-zero factor). An "affine map" is any of the above plus shear, stretch, linear (non-singular).

| Source | Similarity | Other affine map | Projective (3×3) | Inversion |
|---|---|---|---|---|
| Point | Point | Point | Point; undefined `at_infinity` if `w → 0` | Point; centre → `at_infinity` |
| Vector | Vector (direction by the linear part; start by the full map) | same | direction by the Jacobian at the start (undefined `not_affine` if the start is unknown) | not supported |
| Segment | Segment | Segment | Segment; `crosses_horizon` if the end `w` values differ in sign | not supported |
| Ray | Ray | Ray | Ray or Segment if the ray crosses the horizon: `crosses_horizon` | not supported |
| Line | Line | Line | Line | **Conic** (line through the centre stays a line, otherwise a circle) |
| Circle | Circle | **Conic** (ellipse; degenerate if singular: `singular_transform`) | Conic | **Conic** (circle or line) |
| Conic | Conic | Conic | Conic | not supported (unless circle kind) |
| Arc, Sector | Arc, Sector (reflection reverses the sweep: the reflected arc is stored counter-clockwise by swapping its ends) | Arc / Sector of a **Conic** | Arc / Sector with range check, undefined if the range crosses the horizon | not supported |
| Polygon, Polyline | Polygon, Polyline (vertices mapped; orientation flag follows) | same | vertices mapped; edges straight, so `crosses_horizon` if signs of `w` differ | not supported |
| Function | Function for translate; dilate with `k ≠ 0`; reflect about vertical and horizontal lines; stretch along an axis | **Curve** otherwise (parametric `(x(s), y(s))`) | Curve | not supported |
| Curve | Curve | Curve | Curve | not supported |
| List of those | List of images (element-wise) | same | same | same |

"Not supported" produces `not_supported` at check time when the static type is known (for example `Reflect(segment, circle)`), with the hint "invert the end points instead".

Static type rule for the checker: `Translate`, `Rotate`, `Reflect` (line, point), `Dilate` return the input's type; `Shear`, `Stretch`, `ApplyMatrix` return the input's type except `Circle → Conic`, `Function → Function` when the form preserves functions and otherwise `Curve` (decided at check time from the form), `Reflect(·, Circle)` returns `Conic` for `Line` and `Circle` inputs and `Point` for `Point`.

### 6.6 Conics under a transformation

Matrix form: for an invertible map with homogeneous matrix `H`, the new conic matrix is `H⁻ᵀ M H⁻¹`. The rule builds it from `Affine2` (or `H`), rescales, and classifies (conics 3.3). For similarities of circles and ellipses with native frames (conics 3.2), the frame is mapped directly: centre by the map, axes rotated by the rotation part, semi-axes scaled by the dilation. This keeps focus and vertex labels.

### 6.7 Transformations of functions

Cross-area: the calculus area owns function values. The geometry rules for each form:

| Transformation | Function result |
|---|---|
| `Translate(f, v)` | `g(x) = f(x − vx) + vy` |
| `Dilate(f, k, C)`, `k ≠ 0` | `g(x) = Cy + k (f(Cx + (x − Cx)/k) − Cy)` |
| `Reflect(f, vertical line x = c)` | `g(x) = f(2c − x)` |
| `Reflect(f, horizontal line y = c)` | `g(x) = 2c − f(x)` |
| `Reflect(f, point C)` | `g(x) = 2Cy − f(2Cx − x)` |
| `Stretch(f, horizontal line y = c, r)` | `g(x) = c + r (f(x) − c)` |
| Anything else | `Curve` `(X(s), Y(s))` with `X, Y` the transformed `(s, f(s))`, over the function's domain |

The checker decides function versus curve at check time from the literal form of the line or vector when it can (axis-parallel lines), and otherwise returns `Curve` conservatively; a `Curve` image of a function is always correct.

## 7. Dependency and live behaviour

- **Rules, not copies.** `image = Rotate(source, angle, centre)` is one rule with inputs `source`, `angle`, `centre`. Change any of them (a drag, a slider, the clock) and the image is recomputed in the same pass. The image of a dependent object (a rotated midpoint) works the same; chains cost one rule per link, each O(vertices).
- **Free parameters animate.** `Rotate(tri, 30° * t, O)` turns once per 12 seconds with no other setup. Seeking is exact because the rule is pure.
- **Not draggable.** Images are dependent; dragging one is a no-op with a lock hint. The learner drags the source or a parameter point.
- **Redefining the source.** If the source's type changes to one that makes the image's type change, the kernel rejects the redefinition with `type_change` naming the image and the objects downstream of it (core design).
- **Deleting.** Deleting the source deletes the image and what depends on it (core design) and reports the list.
- **Composition.** `Rotate(Translate(tri, v), a, C)` is two rules. The kernel does not fuse them; each stage's numerical error is below `4ε` of the coordinates' magnitude.
- **Cost.** `Rotate` of a 100-vertex polygon: 0.5 µs. A frame with 100 images of 20-gons: 0.1 ms.

## 8. Better than GeoGebra, in detail

### 8.1 One command, one object

`Rotate(poly, a, C)` yields one polygon. No new vertices or sides. Corner labels of the image are a style (3.3).

### 8.2 Honest image types

A circle under a shear becomes a `Conic` with kind `ellipse`; inversion of a circle through the centre becomes a `Conic` with kind `line`. The static table (6.5) tells the model what it gets.

### 8.3 Exact quarter turns and precise far-centre rotations

6.2 and 6.3.

### 8.4 Singular maps are explicit

`Dilate(c, 0, O)`, `Stretch(c, l, 0)` and singular `ApplyMatrix` collapse conics and lines; the rule reports `singular_transform` for those shapes and still maps points, segments and polygons (which degenerate to a segment or point; polygon area 0).

### 8.5 `progress`: show the motion

`Rotate(tri, 90°, O, progress = u)` with a slider `u` (or `u = t / 5`) shows the figure turning. The parameters are scaled by `u`:

| Transformation | At progress `u` |
|---|---|
| Translate | `u·v` |
| Rotate | `u·θ` |
| Dilate | factor `1 + u (k − 1)` (passes through the identity at `u = 0` and crosses 0 only if `k < 0` reaches it) |
| Reflect, line | `p − 2u (n·p + c₀) n`: the figure folds through the mirror line, flat at `u = 0.5` (note `flat`) |
| Reflect, point | `p + u·(2C − 2p)`: shrinks through the centre |
| Shear | ratio `u·r` |
| Stretch | ratio `1 + u (r − 1)` |

At `u = 0` the image equals the source exactly. The result is a normal image object; all measures and dependents work. A flat intermediate state is a `Polygon` of zero area, not an error.

### 8.6 Transformations as values (v1.1)

`T = Then(Shift(v), Turn(40°, O))` and `Move(tri, T)`; `Move(tri, Inverse(T))`. Value type `Transform` holds `Tf`. Composition multiplies `Affine2` (or 3×3). `Inverse` needs `singular = false`, otherwise `singular_transform`. Teachers use it for "a rotation followed by a reflection is a glide reflection" lessons: the figure shows the first image, the second image, and `Move(tri, T)` for the combined map.

### 8.7 Projective and matrix maps

`ApplyMatrix` with a 3×3 handles points, lines and conics exactly; segments and polygons are checked for the horizon.

### 8.8 Reliable boolean polygon ops

Exact orientation predicates plus a fixed perturbation for degenerate contacts; deterministic output order.

### 8.9 Rigid polygons without special cases

Two free values and a pure rule (section 5).

### 8.10 Safer areas

Compensated sums, translated coordinates, a `self_intersecting` note.

## 9. Rules and the command table

```ts
const rotate: CommandSpec = {
  name: 'Rotate', kind: 'object', group: 'transforms',
  forms: [
    { params: [{name:'shape', type:'Shape'}, {name:'angle', type:'Number'}, {name:'center', type:'Point'}],
      returns: 'SameAsFirst', rule: rotateAbout, summary: 'Turn a figure about a point' },
    { params: [{name:'shape', type:'Shape'}, {name:'angle', type:'Number'}],
      returns: 'SameAsFirst', rule: rotateOrigin, summary: 'Turn a figure about the origin' },
  ],
};
```

- `Shape` is a checker union name (not a user type) for the shape kinds; `returns: 'SameAsFirst'` and the other result-type functions in 6.5 are checker helpers that compute the static return type from the first argument's type and the form (the command table's `returns` field is a type name in the core design; this adds a small set of result-type functions: `SameAsFirst`, `ConicIfCircle`, `FunctionOrCurve`). Core change 2.
- One shared function `applyTransform(tf, value)` maps any shape. Each shape type implements `mapBy(tf)` (one small method per type). The command rules are one-liners over it. This removes the duplicated algorithm per shape and per transformation.
- Named arguments `progress` and (for regular polygons) `start` are in the forms as optional named params.

## 10. Numerical robustness

| Situation | Behaviour |
|---|---|
| Polygon far from the origin | Coordinates relative to the first vertex in sums |
| Nearly collinear polygon | `orientation` 0, area ~0, centroid `zero_area` when below the rounding bound; the figure draws it |
| Self-crossing polygon | `Area` with note; `Simple` false; fill rule even-odd |
| Duplicate consecutive vertices | Allowed; `Convex` ignores zero turns |
| Reflect about a line through coincident points | `coincident_points` |
| `Dilate` by a tiny factor | Defined; no check |
| `Dilate` by 0 | Points → centre; polygons collapse to a point (area 0); Circle/Line/Conic → `singular_transform` |
| Near-singular affine | `cond > 1e12`: conic/line/circle images `singular_transform`, point/segment/polygon images computed |
| Projective with `w` near 0 | `at_infinity` |
| Quarter turns | Exact |
| Large rotation angles | `Math.cos/sin` handle; no pre-reduction needed for `|θ| < 1e10`; above that `not_finite` |
| Boolean ops degenerate | Perturbation, note `perturbed` |
| Inversion centre | The centre of inversion maps to `at_infinity`; points within `1e-12 r` of it map to `too_far` |

Speed targets: area 0.01 µs per vertex, simple test 0.2 ms at 256 vertices (on change only), regular polygon of 1000 sides 15 µs, transformation of a 100-vertex polygon 0.5 µs, convex clipping of two 8-gons 3 µs, general boolean of two 64-gons 40 µs, rigid polygon pose update 0.2 µs per vertex.

## 11. Changes to the core design

1. **Free parameters owned by objects** (`Rigid`, plus `PointOn` and `PointIn` from `points-lines`): `params`.
2. **Result-type functions in the command table.** A form's `returns` may name one of a few checker helpers (`SameAsFirst`, `ConicIfCircle`, `FunctionOrCurve`) so `Rotate(tri, …)` is typed `Polygon` and `Rotate(f, …)` `Function` or `Curve`.
3. **Types:** add `Polyline`, `Transform` (v1.1), the `Shape` union as a checker name, and `Matrix` (from the numbers area).
4. **Style property `vertexlabels = prime | none | names`** for polygon images.
5. **Named args `progress` and `start`** (grammar already allows named args).
6. **A `Rotate`/`Dilate` form without a centre** (about the origin).
7. **Defined Bool in the `with` style line** for fill rule: `with fill = evenodd`.
8. **Names with a prime** are not legal (core: `Name'` is the rate rule). Images are named by the user or by tools (`A_1`), with the caption `A′`.
9. **Notes:** `self_intersecting`, `unchecked`, `perturbed`, `flat` join the list in `points-lines` 10.2.

## 12. Open questions

1. Is `Polygon(center, radius, n)` with the first vertex pointing up the right default? Alternative: vertex on the +x axis (math convention).
2. Should boolean polygon operations accept polygons with holes in v2, or switch to a ring-based `Region` type shared with the calculus area?
3. Should the `Transform` values land in v1 rather than v1.1? They need only the existing `Tf`, so cost is small; the risk is catalogue size.

## 13. Better than GeoGebra, in a list

1. One object per command; vertex labels as a style.
2. Honest result types for sheared and inverted shapes.
3. `progress` for animated transformations; `Transform` values for composition.
4. Exact quarter turns; centre-based application for precision.
5. Explicit singular-map handling.
6. Robust, deterministic boolean operations.
7. Rigid polygons through free params.
8. Safe polygon areas with a warning for self-crossing.
9. Regular polygons by direct angles at any `n`.
10. Vector polygons and open polylines from vectors.

## 14. Sources studied

GeoGebra source (commit 3608374), `source/shared/common/src/main/java/org/geogebra/common/`:
- `kernel/Transform.java`, `TransformTranslate.java`, `TransformRotate.java`, `TransformMirror.java`, `TransformDilate.java`, `TransformShearOrStretch.java`, `MatrixTransformable.java`
- `kernel/algos/`: translate, rotate, mirror, dilate, shear/stretch and generic-transformation algorithms; polygon, regular polygon, polygon boolean (intersection, union, difference), vertex, centroid and area algorithms; angle algorithms for polygons
- `kernel/geos/`: polygon, poly-line, poly types and their transformable interfaces (`Transformable`, `Mirrorable`, `Rotatable`, `Translateable`, `Dilateable`)
- `kernel/advanced/AlgoApplyMatrix.java`, `TransformApplyMatrix.java`
- `kernel/commands/`: argument handling for transformation and polygon commands (to learn forms)

GeoGebra manual:
- https://geogebra.github.io/docs/manual/en/commands/Transformation_Commands/ and pages Translate, Rotate, Reflect, Dilate, Shear, Stretch
- https://geogebra.github.io/docs/manual/en/commands/Vector_and_Matrix_Commands/ page ApplyMatrix
- https://geogebra.github.io/docs/manual/en/commands/Geometry_Commands/ pages Polygon, Polyline, RigidPolygon, Area, Perimeter, Centroid, Vertex, InteriorAngles, IntersectPath, Union, IsInRegion
- https://geogebra.github.io/docs/manual/en/tools/Polygon_Tools/, https://geogebra.github.io/docs/manual/en/tools/Transformation_Tools/, https://geogebra.github.io/docs/manual/en/tools/Measurement_Tools/
