# Points, lines, vectors, intersections and measures: design

Status: draft for review. Part of the plane-geometry area (with `conics` and `polygons-transforms`). It fits `docs/design/formula-language-and-kernel.md`. Nothing here copies the reference app's code, text or names; section 12 lists what was read.

This document also defines the **shared geometry value model** (section 3): the numeric types, tolerances, paths and ordinal rules that `conics` and `polygons-transforms` reuse. Read section 3 first.

## 1. What the learner and the teacher get

A learner sees points, lines, segments, rays and vectors that stay true when something moves: the midpoint stays in the middle, the perpendicular stays square, the intersection follows both lines. A teacher (the live model) says "now the perpendicular through C" and writes one line. Measures (distance, length, slope, angle) appear as live readouts and marks.

### 1.1 Command coverage in this folder

All forms are in our syntax (PascalCase, one result per call, `Name = Command(args)`). `Number index` is a whole number counted from 1.

**Points**

| Command | Forms | Result |
|---|---|---|
| `Point` | `(Number x, Number y)` is just `(x, y)`; `Point(List<Number>)`; `Point(Point, Vector)` | Point |
| `PointOn` | `(path, Number param)`, `(path)` | Point that can be dragged along `path` (section 6) |
| `PointIn` | `(region)`, `(region, Number u, Number v)` | Point that can be dragged inside a region (section 6.4) |
| `Midpoint` | `(Point, Point)`, `(Segment)`, `(Arc)` (the middle of the arc, on the arc); the centre of a conic is `Center(c)` in `conics` | Point |
| `Vertex` | `(Segment, Number index)`, `(Ray)`; polygon, conic and sector forms are in the other two folders | Point |
| `Closest` | `(path, Point)`, `(Line, Line)` (the point of the first line nearest the second), `(region, Point)` | Point |
| `Along` | `(path, Number param)` | Point on the path, **not** draggable (a plain rule of the parameter) |
| `ParamOf` | `(Point on path)` | Number: the point's normalised path parameter 0..1 (section 6.3) |
| `RandomIn` | `(region, Number seed)`, `(Number x0, Number x1, Number y0, Number y1, Number seed)` | Point; pure, uses `rand(seed)` |
| `Barycenter` | `(List<Point>, List<Number> weights)` | Point |
| `Centroid` | `(Polygon)` is in `polygons-transforms`; `Centroid(List<Point>)` here | Point |
| `TriangleCenter` | `(Point, Point, Point, Number n)` for n in 1..13 (incenter, centroid, circumcenter, orthocenter, nine-point centre, symmedian point, Gergonne, Nagel and the rest of the short list in section 5.6) | Point |
| `Trilinear` | `(Point, Point, Point, Number, Number, Number)` | Point |
| `Intersect` | many forms, section 4 | Point or `List<Point>` |

**Lines, rays, segments, vectors**

| Command | Forms | Result |
|---|---|---|
| `Line` | `(Point, Point)`, `(Point, Vector)`, `(Point, Line)` (parallel), `(Bool equation)` such as `Line(2x + 3y == 6)` | Line |
| `Segment` | `(Point, Point)`, `(Point, Number length)` (direction along +x; to aim it, use `Along(Ray(P, Q), length)` for the end point and the two-point form) | Segment |
| `Ray` | `(Point, Point)`, `(Point, Vector)` | Ray |
| `Vector` | `(Number, Number)`, `(Point, Point)`, `(Point)` (position vector) | Vector |
| `Perpendicular` | `(Point, Line)`, `(Point, Segment)`, `(Point, Ray)`, `(Point, Vector)` | Line |
| `Parallel` | `(Point, Line)`, `(Point, Segment)`, `(Point, Ray)`, `(Point, Vector)` | Line |
| `Bisector` | `(Point, Point)` perpendicular bisector; `(Segment)`; `(Point, Point, Point)` angle bisector with the middle point as apex; `(Line, Line)` gives `List<Line>` of the two bisectors | Line or List |
| `Direction` | `(Line)`, `(Segment)`, `(Ray)` | Vector (unit length, section 5.2) |
| `Normal` | `(Line)`, `(Segment)`, `(Vector)` | Vector, unit length, turned 90° counter-clockwise from the direction |
| `Tangent`, `Polar`, `Asymptote`, `Axes` | conic and function forms are in `conics` | |
| `Locus` | `(Point tracer, Point mover)`, `(Point tracer, Number free, Number from, Number to)` | Curve (section 8) |

**Vectors** (the vector half of the vector-and-matrix group; matrix commands belong to the number/matrix area)

| Command | Forms | Result |
|---|---|---|
| `Vector` | see above | Vector |
| `UnitVector` | `(Vector)`, `(Line)`, `(Segment)` | Vector, length 1 |
| `PerpVector` | `(Vector)`, `(Line)`, `(Segment)`: same length, turned 90° counter-clockwise | Vector |
| `UnitPerpVector` | same forms, length 1 | Vector |
| `Dot` | `(Vector, Vector)`; also accepts `(Point, Point)` as position vectors | Number |
| `Cross` | `(Vector, Vector)`: the signed area, the z-part of the 3D product | Number |
| `Length` | `(Vector)`, `(Point)` (distance from the origin), `(Segment)`, `(Ray)` is undefined, arc/polyline forms are in the other folders | Number |
| `ToPolar` | `(Vector)`, `(Point)` returns `List<Number>` `[r, θ]`, θ in (−π, π] | List |
| `FromPolar` | `(Number r, Number θ)` | Point |
| `CurvatureVector` | `(Point, Function or Curve or Conic)`: forms and numeric method live in `conics` section 8 | Vector |
| `Translate` | `(Vector, Point)` moves a vector's start | Vector |
| `ApplyMatrix` | in `polygons-transforms` | |

**Measures**

| Command | Forms | Result |
|---|---|---|
| `Distance` | `(Point, Point)`, `(Point, Line)`, `(Point, Segment)`, `(Point, Ray)`, `(Point, Conic)`, `(Point, Polygon)` (to the boundary), `(Line, Line)` (0 unless parallel), `(Point, Function)` and `(Point, Curve)` (numeric, nearest point) | Number |
| `Length` | segment, vector, point (above) | Number |
| `Slope` | `(Line)`, `(Segment)`, `(Ray)`, `(Vector)`: rise over run, undefined for vertical | Number |
| `Angle` | `(Point, Point vertex, Point)`, `(Line, Line)`, `(Vector, Vector)`, `(Vector)` (from the x-axis), `(Point)` (position vector), `(Number)` (wrap into one turn) | Number marked as an angle |
| `Area`, `Perimeter`, `Circumference` | other folders | |
| `AffineRatio` | `(Point A, Point B, Point C)` with C = A + λ·AB, returns λ | Number |
| `CrossRatio` | `(Point, Point, Point, Point)` of four collinear points | Number |
| `Relation` | `(a, b)` returns a Text summary: parallel, perpendicular, equal length, incident, tangent, intersecting | Text |

**Predicates** (return Bool; use the tolerance in section 3.3; accept an optional named `tol`)

`AreCollinear(Point, Point, Point)`, `AreConcurrent(Line, Line, Line)`, `AreParallel(Line, Line)`, `ArePerpendicular(Line, Line)`, `AreConcyclic(Point, Point, Point, Point)`, `AreEqual(a, b)`, `AreCongruent(a, b)`, `OnPath(Point, path)`, `InRegion(Point, region)`.

**Not in v1, and why**

- `Prove`, `ProveDetails`, `LocusEquation`, `Envelope` (symbolic), `Cubic`/`TriangleCurve` (triangle cubics), `TriangleCenter` indexes above 13, `Trilinear` for an arbitrary index. They need a symbolic engine or a large table of centre formulas. The numeric predicates and `Locus` cover lessons. `Envelope` can come later as a sampled curve (section 8.3).
- 3D forms of `Line`, `Perpendicular`, `Cross`, `Distance`.

### 1.2 Tools the learner can pick (full detail in `ui.md`)

Point, Point on Object, Attach/Detach, Intersect, Midpoint, Line, Segment, Segment with Given Length, Ray, Vector, Vector from Point, Perpendicular Line, Parallel Line, Perpendicular Bisector, Angle Bisector, Locus, Angle, Angle with Given Size, Distance or Length, Slope, Relation. Each tool produces exactly one script line (or the single shortest list of lines) and appears in the same history as typed lines.

## 2. How the reference app does it (in plain words)

**Model.** Points, lines, segments and rays are objects whose coordinates are stored as three numbers (homogeneous form). A line is `(a, b, c)` for `a x + b y + c = 0`. A point is `(x, y, w)`; `w = 0` is a point at infinity. The intersection of two lines is the cross product of their triples, and the line through two points is the cross product of the points. This is neat, needs no special cases for vertical lines, and gives points at infinity for free. Segments and rays are lines plus limits.

**Intersections.** Each pair of types has its own algorithm. Two lines: cross product, then a check that the result lies on both (needed for segments). Line and conic: solve a quadratic, but retry with a ladder of growing tolerances until the answer passes a "does it lie on both" test; if no tolerance passes, both outputs become undefined. Conic and conic: the harder case, using a degenerate member of the pencil of conics, then line-conic. Function against function and curve cases use Newton iteration from start points, and polynomials use exact root solving.

**Identity of output points.** An intersection has two or four output slots. When an input moves, the algorithm computes the new solutions and then matches them to the previous outputs by minimising total distance (with an "age" counter for slots that were undefined). The effect is smooth motion: point `A` does not suddenly swap with point `B` when you drag. The cost: the output depends on the history of drags. A reloaded file or a different drag order can label the two points the other way round. Intersections with segments also keep "where the other solution used to be" so a point can go undefined and come back at the same place.

**Tolerances.** Fixed absolute constants: 1e-8 for "equal", 1e-5 for "lies on" and for the line-conic acceptance test, 1e-12 for a stricter case. They do not scale with coordinates, so a figure drawn at scale 1e-6 or 1e6 behaves differently.

**Points on paths.** A point on a path stores one parameter and a path-type tag; when the path moves, the point is recomputed from the parameter (so it rides along). When a free point is dragged, the pointer position is projected onto the path to get a new parameter. Parameters are normalised to the range 0..1 for display; unbounded paths (lines, rays, parabolas) are squeezed through a smooth map.

**Special lines.** Perpendicular, parallel and bisector are small algorithms. Angle bisector of two lines yields both lines. Tangent, polar, asymptote and friends live in the conic section of the library.

**Measures.** Angle between three points is counter-clockwise from the first arm to the second, 0 to 360°; a separate algorithm exists for every pair of operand types (point-point-point, line-line, vector-vector, polygon, conic). Distance has one algorithm per pair type.

**What works well.** Homogeneous coordinates. Undefined as a value. The "matching old output to new output" idea gives drags that feel continuous. The set of special-line commands matches how geometry is taught.

**What is weak.**
- Absolute tolerances, and a retry ladder that can accept a worse answer than the first try.
- Output labels depend on drag history, so files do not replay to the same labels.
- Many near-duplicate algorithms for operand type pairs (hand-written overload chains).
- Near-parallel lines produce points that fly off to huge coordinates with no warning; near-tangent lines flicker between two points and none.
- A command such as `Intersect` returns different numbers of objects depending on the types, which complicates dependency (an unnamed second object appears).
- Angle conventions differ by command, and the result is always an object with its own unit setting.

## 3. Shared geometry value model

Everything below lives in `packages/kernel/src/geom/` (kernel code, no DOM). Types are plain data; rules are pure functions.

### 3.1 Numbers and vectors

```ts
/** A finite point or vector in the figure's maths units. */
export interface V2 { readonly x: number; readonly y: number }

/** A point in homogeneous form. w = 0 is a point at infinity. Never stored as an object value. */
export interface HPoint { readonly x: number; readonly y: number; readonly w: number }

/** Line a·x + b·y + c = 0. Normalised so a² + b² = 1 whenever it is a real line. */
export interface HLine { readonly a: number; readonly b: number; readonly c: number }
```

- Objects of type `Point` hold `V2` or are undefined. Rules use `HPoint` and `HLine` internally and convert at the end. A homogeneous result with `|w|` below a relative bound becomes undefined with reason `parallel` (lines) or `too_far` (section 3.3), not a point at infinity.
- Why keep homogeneous inside: one formula covers vertical lines, no branching on slope, and the same cross-product code serves "line through two points" and "point from two lines".

### 3.2 Limited and unlimited paths

All curves a point can ride, or an intersection can be filtered by, implement one interface:

```ts
export type PathKind =
  | 'line' | 'ray' | 'segment'
  | 'circle' | 'ellipse' | 'parabola' | 'hyperbola' | 'arc'
  | 'polyline' | 'polygon'
  | 'function' | 'curve' | 'implicit';

export interface Path {
  readonly kind: PathKind;
  readonly closed: boolean;                    // true for circle, ellipse, polygon, closed curve
  /** Raw parameter domain, possibly infinite. */
  readonly domain: readonly [number, number];
  /** Position at raw parameter s. Defined for every s in domain. */
  at(s: number): V2;
  /** Unit tangent at s, or undefined at corners and cusps. */
  tangent(s: number): V2 | undefined;
  /** Nearest raw parameter to p. `hint` is the previous parameter, used to pick among ties and to stay continuous. */
  project(p: V2, hint?: number): { s: number; dist: number };
  /** Map raw parameter to the stable 0..1 range shown to users (section 6.3), and back. */
  norm(s: number): number;
  unnorm(u: number): number;
  /** Infinite-domain paths use a monotone squeeze; bounded ones are affine. */
}
```

Concrete paths are built from the owning object's value. A `Circle` yields a `Path` with `s` = angle from the +x direction, `domain [−π, π]`, closed. A `Segment` has `s ∈ [0, 1]`, a `Ray` `s ∈ [0, ∞)` in units of the defining vector length, a `Line` `s ∈ (−∞, ∞)` in units of the defining vector length. Conics, polygons, functions and curves define theirs in the other folders and the calculus area.

### 3.3 Tolerances: relative, explicit, and scale-aware

The reference app uses fixed absolute epsilons. We use **relative** ones, derived from the sizes of the inputs, and keep the policy in one place.

```ts
export interface Tol {
  /** Equal when |a − b| ≤ eq · max(1, |a|, |b|). Default 1e-12 (about 4500 ulps of a unit value). */
  readonly eq: number;
  /** "Lies on" / incidence in user-visible predicates. Default 1e-9, relative to the larger of the object sizes involved. */
  readonly on: number;
  /** Sine of the angle below which two directions are treated as parallel. Default 1e-12. */
  readonly parallel: number;
  /** Results farther than this from the origin are `too_far`. Default 1e14 (leaves about 2 decimals of precision). */
  readonly far: number;
}
export const DEFAULT_TOL: Tol;
```

- Rules never use literal epsilons; they take a `Tol`. The figure carries one `Tol` (default above). The `@tol eq on` directive may change it (new directive; section 13 core change). Predicates accept `tol=1e-6` per call.
- **Why 1e-12 and 1e-9?** Doubles carry about 1.1e-16 relative error; ten operations in a cross product and normalisation lose at most 3 to 4 digits. 1e-12 therefore catches "numerically equal" while 1e-9 is the user-visible "drawn on the same pixel" level for a figure spanning a few thousand units.
- **Incidence uses a scale.** `on` is multiplied by the larger of the lengths involved (segment length, circle radius, distance from origin). A point is on a circle of radius 1e6 if it is within 1e-3, and on one of radius 1e-3 if it is within 1e-12.

### 3.4 Exact-enough small determinants

Collinearity, orientation and line-meets-line use 2×2 and 3×3 determinants where cancellation is the danger (`ad − bc` with `ad ≈ bc`). The kernel ships `det2(a, b, c, d)` using an error-free product split (Dekker's two-product, no fused multiply-add needed in JavaScript) and compensated subtraction, accurate to about 1 ulp of the exact result for finite inputs. This is the one place we pay the extra 8 flops. It also returns a **rounding bound** so the caller can distinguish "exactly zero" from "indistinguishable from zero".

```ts
export function det2(a: number, b: number, c: number, d: number): { value: number; err: number };
export function orient(p: V2, q: V2, r: V2): { sign: -1 | 0 | 1; value: number; err: number };
```

`sign = 0` only when `|value| ≤ err` (rounding cannot decide). All geometry rules that ask "left or right" use `orient`.

### 3.5 Ordinal rules for multi-solution commands

A command such as `Intersect` can have several answers. The rule must return them in an order that depends **only on the inputs now** (so files replay and seeking in a film are exact) and is as continuous as possible while dragging. Each such command declares its canonical order in section 4 and section 5. Where no continuous order exists we say so and give a `near` form.

```ts
type Slots<T> = readonly (T | Undef)[];  // fixed length per command form, undefined for missing
```

`Intersect(a, b)` returns a `List<Point>`: for forms with a fixed maximum (line×line 1, line×conic 2, conic×conic 4) the list **has that length, with undefined entries where there is no solution, and never shrinks**. For forms with unbounded counts (polygon, curve, function) the list is compact and sorted. `Intersect(a, b, k)` returns slot `k` (1-based) as a single `Point`. A literal `k` outside the form's range is a check-time error (`bad_argument`).

## 4. `Intersect`: every case

`Intersect(a, b)` → `List<Point>`; `Intersect(a, b, Number k)` → `Point`; `Intersect(a, b, near = Point P)` → `Point`: the solution closest to `P` (ties: lowest slot); `Intersect(a, b, extend = true)` intersects the **carriers** (a segment becomes its whole line, an arc its whole circle).

Plain `Intersect(a, b)` with limited objects (`Segment`, `Ray`, `Arc`, polygons, sectors) filters the solutions to those lying on both limited paths, using a parameter tolerance `tol.eq`; excluded slots are undefined with reason `outside_path`.

### 4.1 Table of cases

| a \ b | Line-like | Circle / Conic | Polygon / Polyline | Function | Curve (param) | Implicit |
|---|---|---|---|---|---|---|
| Line-like (line, ray, segment) | 4.2 | 4.3 | 4.5 | 4.6 | 4.7 | 4.7 |
| Circle / Conic (incl. arcs, sectors) | 4.3 | 4.4 | 4.5 | 4.6 | 4.7 | 4.7 |
| Polygon / Polyline | 4.5 | 4.5 | 4.5 | 4.6 | 4.7 | 4.7 |
| Function | 4.6 | 4.6 | 4.6 | 4.6 | 4.7 | 4.7 |

Also: `Intersect(Point, path)` is not a command; use `OnPath`. Three objects at once is not supported; make two calls.

### 4.2 Line-like with line-like

1. Build both as `HLine` plus limits.
2. `h = cross(L1, L2)` (the homogeneous point). Let `s = |a1·b2 − a2·b1|` with `det2` from the unit normals; this is the sine of the angle between the lines.
3. If `s ≤ tol.parallel`: the lines are parallel or identical. Test identical with the distance of one line's reference point to the other (relative `tol.on`): identical → `[undefined(coincident)]`; else `[undefined(parallel)]`. (`coincident` means infinitely many points, a statement the teacher can say.)
4. Else `P = (h.x/h.w, h.y/h.w)`. If `√(x²+y²) > tol.far`: undefined `too_far`.
5. Limits: for each limited operand compute its parameter at `P` by projection onto the direction vector. Accept if within `[−eq, 1+eq]` (segment) or `≥ −eq` (ray), after scaling by the segment length. Endpoint touching therefore counts. Otherwise undefined `outside_path`.
6. **Conditioning note.** Error of `P` is roughly `ε · |P − anchor| / s`. If the condition estimate exceeds 1e6 the value is kept but carries the note `ill_conditioned` (section 10.2), so the teacher can say "these lines are almost parallel, the meeting point is far away".

Output: slot 1 only. One output means `Intersect(a, b)` of two line-likes returns a `List<Point>` of length 1; the common spelling `P = Intersect(a, b)` is typed `Point` because the checker picks the single-result form when both operands are line-like. (The checker rule: the form's `returns` is `Point` for fixed-1 cases and `List<Point>` otherwise; section 13 explains why this is allowed by the command-form table.)

### 4.3 Line-like with circle or conic

Substitute the line `p(s) = o + s·d` (unit `d`, `o` the foot point of the origin on the line) into the conic matrix `M` (section 3 of `conics`). The quadratic is `α s² + 2 β s + γ = 0`, with `α = dᵀSd`, `β = oᵀSd + (linear part)·d / 2`, `γ = value at o`. Solve with the **stable pair form**: `q = −(β + sign(β)·√Δ)`, roots `q/α` and `γ/q`, `Δ = β² − αγ`. This avoids cancellation when `α` is tiny (line nearly parallel to a parabola axis or a hyperbola asymptote) and gives the roots in ascending `s`.

- **Tangency.** If `|Δ| ≤ 64·ε·(β² + |αγ|)` the line is treated as tangent: both slots equal the touching point (`s = −β/α`), with the note `tangent`. This makes `Intersect(Tangent(P, c), c)` return a point instead of flickering. If `Δ < −64ε(…)`: no real roots, slots undefined with reason `no_intersection`.
- **Degenerate conic.** If the conic is a pair of lines, intersect with each (4.2) and return up to two slots. A double line or a point: handle explicitly, never go through the quadratic with `α = β = 0`.
- **`α` exactly 0** (line parallel to a parabola axis): the quadratic is linear; one root, second slot undefined `no_intersection`.
- **Order (canonical).** Slot 1 is the root with smaller `s` along the line's own direction (for a segment, from first to second end point; for a ray, away from its start; for a line through `A`, `B`, from `A` toward `B`). It is continuous while the line moves, including through tangency, because the two roots merge and separate along the same ordering.
- **Polish.** Newton step on `M(x, y)` along the line, one iteration, to push the residual below `ε·‖M‖·scale²`.
- **Limits.** Filter by the line's limits and, for arcs and sectors, by angle range (4.4).
- Accuracy target: residual `|conic(P)| / (‖M‖ · max(1,|P|)²) ≤ 4e-16` for well-conditioned input; speed under 1 µs.

### 4.4 Circle and conic with circle and conic

- **Circle with circle.** Radical line: subtract the two circle equations to get a line; intersect it with the first circle by 4.3. Slots: slot 1 lies on the **left** of the directed centre line from `c1` to `c2`, slot 2 on the right (decided by `orient`, section 3.4). Tangent circles give two equal points with note `tangent`. Concentric circles: `coincident` if the radii are equal, else `no_intersection`. Accuracy is the best available, because the radical line is exact in the circle coefficients.
- **General conic with conic (up to four points).**
  1. Normalise both matrices to unit Frobenius norm.
  2. Cubic `det(M1 + λ M2) = 0` in λ. Solve with a stable trigonometric/Cardano hybrid and polish each root with Newton on the determinant.
  3. Pick the real root λ* whose matrix `M1 + λ* M2` is the **best-conditioned degenerate conic** (largest gap between its two non-zero and the zero singular values). It is a pair of lines (possibly complex-conjugate, possibly a double line).
  4. Split the pair of lines (a rank-2 symmetric 3×3 factorises into two lines), intersect each with the better-conditioned of the two original conics using 4.3.
  5. **Polish** each candidate with two Newton steps on the pair of equations `{M1(P) = 0, M2(P) = 0}` using the 2×2 Jacobian. This removes the amplification the cubic step can introduce.
  6. Validate: residual under `1e-12 · scale` on both, else treat the candidate as spurious.
  - Fall-backs: if the cubic has three real roots, try them in order of conditioning. If none gives a validated set, run a sampled search: trace conic 1 with an adaptive parametrisation, find sign changes of conic 2, bracket with Brent. This is slower (about 0.3 ms) but never silently wrong; we mark such results with the note `sampled`.
  - Same conic (up to scale): `coincident`. Concentric with no common point: `no_intersection`.
  - Multiple points (tangency at 2, 3 or 4 contact order): report the distinct points and the note `tangent` on those that are double.
- **Canonical order for four slots.** Sort by the **angle of the point around the centroid of the real solutions**, starting from the direction of the first conic's major axis (if the conic is a circle, the +x axis). This is continuous as long as the number of real solutions is constant. Slots stay stable until the number changes. At the instant the number of real solutions changes (tangency at birth), two slots appear or vanish together at the same place; the rest keep their numbers because empty slots are left undefined *in their rank position by that angle order*, and missing ones are placed last. For drags that cross a topology change, use the `near` form.
- **Arcs and sectors.** Treat as their conic carriers, then filter by parameter range with `tol.eq` angle slack; excluded slots become `outside_path`.
- **Hyperbola branches.** Slots are by angle, so branches are not distinguished; the hyperbola's two branches are one conic.
- Accuracy target: residual `≤ 1e-12` relative for conditioning below 1e6; for tangent contact the point is accurate to `√ε ≈ 1.5e-8` (inherent) and carries `tangent`.
- Speed target: 15 µs typical; 0.3 ms worst-case sampled fall-back.

### 4.5 With polygons and polylines

- Intersect a line-like or a conic against **each edge** (4.2 or 4.3 with the edge as a segment), gather the hits, and remove duplicates at shared vertices (two edges touching at one vertex give one point; tolerance `tol.eq` scaled by edge length).
- Result: `List<Point>` compact and sorted by **boundary order** (`s` along the polygon starting at the first vertex). For a line intersecting a convex polygon this is 0, 1 or 2 points, in edge order.
- `Intersect(line, polygon, near = P)`: pick by distance. `Intersect(poly, poly)` yields all crossing points in boundary order of the first polygon. Overlap *regions* are `IntersectPath` (`polygons-transforms`).
- A line passing exactly through a vertex: the vertex appears once. A line collinear with an edge: reported as the two edge end points (the segment overlap is `IntersectPath`'s job) and note `overlap`.
- Orientation of shared-vertex tests uses `orient` from 3.4, so a line through a vertex is decided robustly, not by an epsilon on distance.

### 4.6 With functions

- **Function with line.** If the function is a polynomial of degree ≤ 4 (checked by expanding its syntax tree; section 6.4 of the calculus area owns the polynomial extraction), solve exactly by companion/closed form then polish. Otherwise sign-scan on the **form's interval** (`Intersect(f, line, from, to)`): sample 256 intervals, adaptively bisect any interval where the function changes sign or the slope changes by more than 10× between neighbours, refine each bracket by Brent's method to `1e-14` relative. Returns compact list sorted by x.
- **Function with function.** Root of `f − g` as above. Intervals are required: `Intersect(f, g, from, to)`. Without an interval, the polynomial path above (degree ≤ 4 of `f − g`) works; otherwise `no_matching_form` with the message "needs an interval for non-polynomial functions".
- **Tangential roots.** A double root does not change sign. The scan also tests local minima of `|f − g|` found by derivative sign change on the sampled `f − g`, and accepts them when the minimum is below `1e-10·scale`.
- **Newton form.** `Intersect(f, g, near = P)` or `IntersectNear(f, g, x0)` runs damped Newton from `x0`, max 50 steps; failure → undefined `no_convergence`.
- Discontinuities (poles) are skipped by checking that the sign change is not an asymptote: `|f−g|` at the bracket's midpoint must be smaller than at the ends.
- Cap: 64 results; beyond that the note `truncated`.

### 4.7 With parametric and implicit curves

`Intersect(curve, line | conic | curve | function)`: sample both with their adaptive plot samplers (the same ones the view uses), find segment-segment crossings, refine each with 2-D Newton on the exact definitions. Accuracy `1e-10` relative when conditioned; every result carries the note `sampled` (approximate in the sense of possibly missing a double contact). A self-crossing curve against itself is `Intersect(curve, curve)` and lists self-crossings.

### 4.8 Result typing and the rule input list

A form of `Intersect` declares `returns: 'Point'` for the fixed-1 forms (line-like × line-like, and any form with an explicit index, with `near`), and `List<Point>` for the rest. Because `List<Point>[k]` is already in the grammar (`L[k]`, 1-based), `P = Intersect(c, d)[2]` works. All forms are one rule family `intersectRule(kindA, kindB)` registered in a table keyed by pair; the command table's `rule` field points there. There is no `if (a instanceof …)` chain.

## 5. Special lines, directions, centres

### 5.1 Perpendicular and parallel

`Perpendicular(P, L)`: line through `P` with normal `(−b, a)` of `L`'s unit normal, i.e. `HLine` built from direction `(a, b)`. `Parallel(P, L)`: `HLine` with the same `(a, b)` and `c = −(a·Px + b·Py)`. Forms with a segment, ray or vector use the carrier direction. Result type is always `Line` (unlimited). Undefined: carrier degenerate (`zero_length`, `coincident_points`).

### 5.2 Direction, normal, unit vectors

`Direction(L)` returns the unit vector `(b, −a)`, oriented the same way the user built the line (from the first to the second defining point, or from the stored direction). For a line given only by equation: `(b, −a)` with sign chosen so that the first non-zero component is positive. `Normal` is the direction turned 90° counter-clockwise. `UnitVector`, `PerpVector`, `UnitPerpVector` behave as named; the zero vector gives `zero_length` (unit forms) and a zero result (non-unit perpendicular).

### 5.3 Bisectors

- `Bisector(P, Q)` / `Bisector(Segment)`: through the midpoint with direction turned 90° from `PQ`. Coincident points: `coincident_points`.
- `Bisector(A, B, C)` (apex `B`): unit vectors `u = (A−B)/|A−B|`, `v = (C−B)/|C−B|`, line through `B` with direction `u + v`. When `u + v` is tiny (A, B, C collinear with B between them: a straight angle) the direction is the left normal of `u`. When `u ≈ v` (angle zero) direction `u`. Both cases are stable because the sum is computed from unit vectors. Zero arm: `zero_length`.
- `Bisector(L1, L2)`: `List<Line>` of two. With unit normals `n1`, `n2` (oriented so that `n1·n2 ≥ 0`): slot 1 has normal `n1 + n2` (bisects the acute angle), slot 2 has normal `n1 − n2` (the obtuse). Parallel lines: slot 1 is the mid-line, slot 2 undefined (`parallel`). Coincident: slot 1 = the line, slot 2 undefined (`coincident`).

### 5.4 Centres and means

- `Midpoint(P, Q)`: `(P+Q)/2` computed as `P + (Q−P)/2` to avoid overflow.
- `Barycenter(pts, weights)`: weighted mean; zero total weight → `division_by_zero`.
- `TriangleCenter(A, B, C, n)`: closed forms for n = 1 (incentre: weights `a, b, c` of side lengths), 2 (centroid), 3 (circumcentre: from `sin 2A` weights), 4 (orthocentre: `A + B + C − 2·O` with `O` circumcentre), 5 (nine-point centre: midpoint of `O` and `H`), 6 (symmedian: weights `a²`), 7 (Gergonne: weights `1/(s−a)`), 8 (Nagel: weights `s−a`), 9 (Mittenpunkt), 10 (Spieker: incentre of the medial triangle), 11 (Feuerbach point), 12 (Feuerbach point reflection) and 13 (first isogonic). Others → `bad_argument` with the supported list. Collinear vertices: `collinear`.
- `Trilinear(A, B, C, x, y, z)`: barycentric weights `a·x, b·y, c·z` normalised; zero sum is `division_by_zero`.

### 5.5 Distance and closest point

`Closest(path, P)` uses the path's `project`. Lines, segments, rays and circles are closed-form; ellipses use the stable quartic route (`conics` section 7); polygon: nearest over edges; functions and curves: coarse sample at 128 points then Newton polish on `d²`, clamped by the domain; results carry `sampled` when the polish does not converge to 1e-10 in 20 steps. `Distance(P, path) = |P − Closest(path, P)|` with exact forms for line-like and circle.

### 5.6 Cross and affine ratios

`AffineRatio(A, B, C)`: if `AB` is zero → `coincident_points`; collinearity is tested with `orient` and `tol.on`; not collinear → undefined with reason `not_collinear`. Otherwise `λ = (AC·AB)/(AB·AB)`. `CrossRatio(A,B,C,D) = AffineRatio(B,C,D)/AffineRatio(A,C,D)`: second factor zero → `division_by_zero`.

## 6. Points on paths and regions

### 6.1 `PointOn`

`P = PointOn(path)` creates a point at the path's default parameter (the midpoint, 0.5). `P = PointOn(path, 0.25)` sets the parameter. **A `PointOn` holds its normalised parameter as a free value** (this is the one place the core design's "free" idea needs an extension: section 13). The kernel exposes it as `P.param`; the point's value is the rule `path.at(unnorm(param))` re-evaluated whenever the path changes. So:

- Dragging `P` writes only `P.param` (the pointer is projected with `project(pointer, hint = current s)`), never the path.
- Moving the path moves `P` with it, keeping its relative position.
- The point is stable under redefinition and replays exactly from its script (`P = PointOn(c, 0.25)` saves the parameter).

Free points can be **attached**: `A = PointOn(path, ParamOf-at-A)` is generated by the Attach tool, which sets `param` from `project(A)` once; **detached**: the tool rewrites the line to `A = (x, y)` with the current coordinates.

### 6.2 `Along`

`Along(path, s)` is the same value, but with no parameter state and no dragging. It is the right command for animation: `P = Along(c, t / 10)` rides the circle once every 10 seconds.

### 6.3 Parameter normalisation

`norm(s)` maps the raw parameter to 0..1 so that `PointOn(path, u)` reads the same for every path:

| Path | Raw `s` | `norm` |
|---|---|---|
| Segment | 0 to 1 | `s` |
| Line through `A`, `B` | −∞..∞ in `|AB|` units | `0.5 + atan(s)/π` |
| Ray | 0..∞ | `(2/π)·atan(s)` |
| Circle, ellipse | angle from the reference direction | `(s + π)/(2π)` |
| Parabola, hyperbola branch | by arc-parameter | squeeze `0.5 + atan(s)/π` |
| Polygon, polyline | arc length fraction along the boundary | `u` |
| Function | x | `0.5 + atan(x/xscale)/π` where `xscale` = 1 (no view dependence) |

Squeezes are strictly monotone so the inverse is exact. Using `atan` (not the reference app's other rational map) makes 0.5 the natural middle and the derivative at 0.5 equal to `1/π` units per parameter step: easy to explain ("halfway").

### 6.4 `PointIn`

A region is a polygon, circle/ellipse interior, or sector. `PointIn(region)` stores two free values `(u, v)`:

- Convex polygon or any polygon: **mean-value coordinates**. At creation or after a drag, we compute the mean-value weights `w_i` of the point inside, store them, and the point value is `Σ w_i V_i`. As vertices move, the point moves with the polygon like rubber (this is what a learner expects) and stays inside any convex polygon. For a non-convex polygon, weights can send the point outside after a big deformation; if the point leaves the region, project it to the boundary and add the note `clamped`.
- Circle or ellipse: `(u, v)` in the unit disc mapped through the frame (`center + u·a·axis₁ + v·b·axis₂`).
- Sector: `(r, θ)` fractions.
- Dragging inverts: given a pointer position inside, solve for weights; outside, project to the nearest boundary point and then invert.

### 6.5 Random points

`RandomIn(region, seed)` uses `rand(seed)` twice: rejection-free for triangle (barycentric folding), fan decomposition for polygons weighted by triangle area, polar `√u` mapping for discs. Pure.

## 7. Measures

- **Distance, Length:** `hypot`-style scaling, never `sqrt(dx*dx+dy*dy)` on overflow-prone inputs (inputs above 1e154 give `not_finite`).
- **Slope:** `−a/b` of the unit line; `|b| ≤ tol.parallel·|a|` → undefined `vertical`. A *slope triangle* mark is drawn when the readout is shown (UI).
- **Angle(A, B, C):** `atan2(cross(u, v), dot(u, v))` with `u = A−B`, `v = C−B`, then wrapped into `[0, 2π)`. This is exact for tiny angles (no `acos` flat spot) and never fails on rounding. Orientation counter-clockwise from arm `BA` to arm `BC`. A zero arm → undefined `zero_length`.
- **Angle(L1, L2):** between direction vectors, wrapped to `[0, π)`: lines have no orientation. **Angle(v1, v2):** as three points, `[0, 2π)`. **Angle(v) / Angle(P):** `atan2` wrapped to `[0, 2π)`. **Angle(Number):** wrap.
- The result type is `Number` flagged as an angle: drawn as a mark, displayed in degrees (display unit is a figure setting, internal unit radians). A literal degree suffix (`30°`) is accepted: section 13.
- A **right-angle** mark (small square) is drawn when `|angle − π/2| ≤ 1e-9`; the readout keeps the exact number.
- `Relation(a, b)`: tests, in order: identical, parallel, perpendicular, incident (point on object), tangent (line and circle), equal lengths (segments), intersecting. Returns the first that holds plus a flag list: for example `"perpendicular"`. Pure and cheap.

## 8. Loci and traces

`Locus(Q, P)` where `P` is a `PointOn` (or `Locus(Q, s, from, to)` where `s` is a free number): sweep the mover's parameter, re-run only the rules between mover and tracer (the downstream list from the mover, restricted to `Q`'s ancestors), and collect `Q`.

- The sweep domain is the full parameter range 0..1 for bounded or closed paths; for lines and rays 0.001..0.999 in the squeezed parameter (a finite window); explicit `from, to` override.
- **Adaptive sampling:** start with 64 uniform samples in the parameter; recursively split an interval when the chord from `Q(s_i)` to `Q(s_{i+1})` deviates from the midpoint sample `Q(mid)` by more than 0.25% of the figure's diagonal, or when one end is undefined and the other is not (find the boundary by 20 bisection steps). Cap 4,000 points.
- Undefined samples break the curve into pieces. The output is a `Curve` value holding pieces (polylines) plus the sampled parameters. It behaves as a path for `PointOn` and `Intersect` (nearest-point queries use the polyline).
- The tracer must depend on the mover. Otherwise the locus is a single point and the rule reports `no_dependency` (an error at definition time, not a runtime undefined, because the dependency graph shows it).
- **Envelope** (v2): sweep a line or conic with a parameter, sample the family, take the envelope as the curve of the intersections of neighbouring members; output a sampled `Curve` marked `sampled`.
- Cost: each sample runs a handful of rules (50 ns to 2 µs each); 4,000 samples in under 10 ms; the locus recomputes only when its inputs change, not every frame, and the view caches the polyline.

## 9. Rules and the command table

Each command form is one `CommandForm` entry (core design section 5). The geometry rules share the `geom` module:

```ts
// Examples of how entries look; params and types follow the core design.
const perpendicular: CommandSpec = {
  name: 'Perpendicular', kind: 'object', group: 'geometry',
  forms: [
    { params: [{name:'through', type:'Point'}, {name:'to', type:'Line'}],    returns:'Line', rule: perpToLine,   summary:'Perpendicular line through a point' },
    { params: [{name:'through', type:'Point'}, {name:'to', type:'Segment'}], returns:'Line', rule: perpToSegment, summary:'…' },
    { params: [{name:'through', type:'Point'}, {name:'to', type:'Vector'}],  returns:'Line', rule: perpToVector,  summary:'…' },
  ],
};
```

- **Subtype matching.** `Segment` and `Ray` are subtypes of `Line` for forms that say `Line` ("line-like"): a form written once with `Line` accepts `Segment` and `Ray` and the rule reads the carrier. This avoids the near-duplicate algorithms the reference app has. The rule receives a `LineLike { carrier: HLine, from: V2, dir: V2, limits: [lo, hi] }`.
- **Rule signature.** `(inputs: Values, tol: Tol) => Result<Value>` where `Result` is a value or `{undef: Reason}`. No access to wall-clock, randomness (other than `rand(seed)`), or the view.
- **Allocation.** Rules write into the output object's preallocated value slot (`V2` records mutated in place) to keep the frame GC-free at 500 objects.
- **Complexity.** Everything in sections 4.2 to 5 is O(1); polygon cases are O(n); curve cases O(samples).

## 10. Numerical robustness

### 10.1 Near-parallel lines

Within `tol.parallel` (1e-12 sine): parallel. Between 1e-12 and 1e-6: defined, with condition estimate `κ = 1/s` and note `ill_conditioned` above 1e6. The meeting point is computed from unit normals via `det2`, so the *relative* error is `ε·κ`, and the view clips far points rather than overflowing. Past `tol.far` the value is `too_far`.

### 10.2 Notes on defined values

A defined value may carry `notes: readonly Note[]` where `Note = 'tangent' | 'ill_conditioned' | 'sampled' | 'clamped' | 'overlap' | 'truncated'` (core design change: section 13). `figure` returns them and `draw` returns them in the per-line summary so the teacher can mention them. They never change the numbers.

### 10.3 Near-tangent

Handled by the relative discriminant test in 4.3; the same test is used by `Tangent`'s inside/outside decision so that `Tangent(P, c)` and `Intersect(…)` agree.

### 10.4 Huge and tiny scales

Because all tolerances are relative and the line form is normalised, a figure at 1e-6 or 1e6 scale behaves like a figure at scale 1. Inputs are not rescaled (it would add rounding). Overflow guards: coordinates beyond 1e150 are `not_finite`.

### 10.5 Collinear and coincident inputs

Three collinear points as vertex of `Angle`: angle 0 or π by `atan2`, exact. Two coincident points as `Line` ends: `coincident_points`. Segment of length below `tol.eq` relative to the larger coordinate magnitude: treated as a point for `Perpendicular` (undefined) but `Midpoint` is fine.

### 10.6 Determinism

No order depends on history. No state across frames except the user-visible `param` of `PointOn` and `PointIn`. A film seek recomputes every geometry rule from the free values at that time.

### 10.7 Speed targets

| Operation | Target |
|---|---|
| line × line | 60 ns |
| line × circle/conic | 400 ns |
| conic × conic, well-conditioned | 15 µs |
| angle, distance, slope | 50 ns |
| `PointOn` re-evaluate on a circle | 80 ns |
| Locus, 4,000 samples | 10 ms, only on input change |

A frame of 500 geometry objects, 100 of them dependent on a dragged point, takes under 0.3 ms of kernel work.

## 11. Better than the reference app

1. **Replay-exact labels.** Slot order depends only on the current inputs (section 3.5), not on drag history, so a file, a film seek and a second run agree.
2. **Scale-free tolerances.** Relative, with explicit `Tol`; no fixed 1e-8.
3. **Honest near-degenerate cases.** The rule reports conditioning and tangency as notes instead of letting a point fly off silently or flicker.
4. **One rule per concept**, using line-like subtyping, instead of one algorithm per operand-type pair.
5. **Pure, seekable points on paths.** `PointOn` stores one parameter; the film can seek anywhere and every point lands where it was.
6. **Intersect the carriers on request** (`extend = true`) instead of a hidden global setting.
7. **`near` form**: a deterministic way to track one intersection through topology changes.
8. **Stable angle computation** via `atan2` instead of `acos`.
9. **Typed results**: `Intersect` returns a list or a point by form, so unnamed second objects never appear.
10. **Readable undefined reasons** (`outside_path`, `no_intersection`, `coincident`) so the teacher can explain.

## 12. Sources studied

Removed before the repository was made public. The study notes above are in our own words.

## 13. Changes to the core design

1. **Objects may own free parameters.** `PointOn`, `PointIn`, and later rigid polygons hold values that dragging edits and that are saved with the figure. Proposed: an object has `params: Record<string, number>` of free values; the rule reads them; the script saves them as ordinary arguments (`PointOn(c, 0.25)`). Reason: the core design treats dependent points as non-draggable and free points as the only draggable ones, which excludes points on paths, the most common construction.
2. **Defined values may carry notes** (section 10.2): `tangent`, `ill_conditioned`, `sampled`, `clamped`, `overlap`, `truncated`. `draw` and `figure` return them.
3. **More undefined reasons** (full list in `errors.md`): `coincident`, `no_intersection`, `outside_path`, `not_collinear`, `zero_length`, `coincident_points`, `too_far`, `vertical`, `no_convergence`, `no_dependency` (definition error), `collinear`, `inside` (no tangent from an interior point).
4. **Result type by form.** A command form may return `Point` for a fixed single result and `List<Point>` for variable ones, selected by operand types (already allowed by the form table; we use it for `Intersect`).
5. **List indexing is 1-based** (`L[1]` is the first) and applies to slot lists. The core design left this open.
6. **Operators:** add `Point − Point → Vector`, `Vector / Number`, `-Vector`, and a `°` postfix on number literals (`30°` is `30·π/180`). `Vector * Vector` stays a `type_mismatch` whose hint says "use Dot or Cross".
7. **Named arguments** `near`, `extend`, `tol` are used on several forms; the core grammar already allows `ident = expr` in arguments.
8. **Type table additions:** `Conic` as a supertype of `Circle` (see `conics`), `Sector`, `Polyline`, `Angle` as a subtype of `Number`, and `LineLike` as the checker's name for "Line, Segment or Ray".
9. **`@tol`** directive (section 3.3) to override tolerances for the figure.
10. **Locus dependency.** `no_dependency` is a definition-time check.
