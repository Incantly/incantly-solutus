# Polygons and transformations: errors

Error object format: core design section 9. Generic kinds and the shared `bad_argument`, undefined reasons and notes are in `points-lines/errors.md`; conic reasons are in `conics/errors.md`. This file lists what polygons and transformations add.

## 1. How GeoGebra handles these

- Polygons from fewer than three points: the tool does nothing; the command line fails with a generic message.
- Self-crossing polygon: area is the absolute shoelace value, no hint.
- Regular polygon with a non-integer or too small vertex count: the vertex count is rounded or the result is undefined with no explanation.
- Reflection about a degenerate line, dilation by zero, singular matrices: undefined images, nothing said.
- Transform of an unsupported kind (inversion of a polygon): the command fails with "illegal argument" and a syntax list that does not say what is unsupported.
- Boolean polygon operations that would make a hole or several pieces: undefined, nothing said.
- Redefining a transformed source to another type: the image is silently rebuilt or lost.

## 2. How we do it

1. Check-time errors for what types and literals reveal: too few points, unsupported shape/transform combination, bad literal counts.
2. Run-time reasons with `because` for values: `not_whole`, `has_hole`, `singular_transform`, `crosses_horizon`.
3. Notes for fragile results: `self_intersecting`, `perturbed`, `unchecked`, `flat`.
4. Each error says what to write instead.

## 3. Definition-time errors

New kinds are marked **new**.

| kind | When | hint |
|---|---|---|
| `too_few_points` **new** | `Polygon(A, B)`; literal list shorter than 3 | "A polygon needs 3 or more points. For a segment use `Segment(A, B)`." |
| `bad_argument` | `Polygon(O, 2, 2)` (literal 2 sides); `Vertex(tri, 0)`; `Side(tri, 7)` for a triangle; `Rigid(A, B)` | names `param` and the allowed range |
| `not_supported` **new** | `Reflect(seg, c)` (inversion of a segment); `Rotate(text, …)`; a shape/transformation pair the table in `design.md` 6.5 marks unsupported | "Invert the end points: `Segment(Reflect(A, c), Reflect(B, c))` gives the chord, not the arc." |
| `no_matching_form` | wrong argument shapes | all forms |
| `type_mismatch` | `Rotate(tri, A)` with a point instead of an angle | "The second argument is an angle: a number, such as 40° or pi/3." |
| `type_change` | Redefining the source of an image so the image's type would change | names the image and its dependants |
| `not_a_transform` **new** | `Move(tri, 3)` | "Move takes a Transform: Shift, Turn, Mirror, Scale, ShearBy, StretchBy, Linear, or Then(...)." |
| `unnamed_object` | `Rotate(tri, 40°, O)` alone | "Name it: `tri2 = Rotate(tri, 40°, O)`." |
| `limit` | More than 1000 regular-polygon sides; more than 256 vertices in a boolean operation; lists of more than 5000 points | |

```json
{
  "ok": false, "line": 4, "col": 7, "endCol": 20,
  "kind": "too_few_points", "token": "Polygon(A, B)",
  "message": "A polygon needs at least 3 points; this has 2.",
  "expected": [],
  "forms": ["Polygon(P1: Point, P2: Point, P3: Point, …) -> Polygon", "Polygon(points: List<Point>) -> Polygon"],
  "hint": "Add a third point, or use Segment(A, B) for two points."
}
```

```json
{
  "ok": false, "line": 6, "col": 14, "endCol": 15,
  "kind": "bad_argument", "token": "2", "param": "sides",
  "message": "A regular polygon needs at least 3 sides; found 2.",
  "expected": ["3", "4", "…", "1000"],
  "forms": ["Polygon(center: Point, radius: Number, sides: Number) -> Polygon"],
  "hint": "Use 3 or more."
}
```

```json
{
  "ok": false, "line": 3, "col": 6, "endCol": 28,
  "kind": "not_supported", "token": "Reflect(s, c)",
  "message": "Inversion of a segment (its image is an arc) is not supported.",
  "expected": [],
  "forms": ["Reflect(shape: Point|Line|Circle|List<Point>, mirror: Circle) -> Point|Conic|List"],
  "hint": "Invert the end points with Reflect(A, c) and Reflect(B, c), then use Arc(...) if you need the arc."
}
```

```json
{
  "ok": false, "line": 8, "col": 1, "endCol": 12,
  "kind": "type_change", "token": "tri",
  "message": "Redefining tri as a Circle would change the type of tri2 (a Polygon).",
  "expected": [],
  "forms": [],
  "hint": "Delete(tri2) first, or keep tri a polygon."
}
```

## 4. Undefined reasons (runtime)

Shared reasons apply (`coincident_points`, `collinear`, `zero_length`, `undefined_input`, `not_finite`, `too_far`, `at_infinity`). New:

| reason | Meaning | Commands |
|---|---|---|
| `too_few_points` | A list-derived polygon has fewer than 3 defined points | `Polygon(list)` |
| `too_few_sides` | Regular polygon with fewer than 3 sides | `Polygon(C, r, n)` with a computed `n` |
| `not_whole` | A count that must be a whole number is not | `Polygon(C, r, n)`, `Vertex`, `Side` |
| `index_out_of_range` | Index outside `1..n` at run time | `Vertex`, `Side` |
| `zero_area` | Polygon has zero area | `Centroid` |
| `not_simple` | Boolean operations need non-self-crossing polygons | `IntersectPath`, `Union`, `Difference` |
| `has_hole` | Result would have a hole | `Difference`, `Union` |
| `singular_transform` | The transformation squashes the figure and its image is not representable | `Dilate` by 0 on a circle, `Stretch` with ratio 0 on a conic, singular `ApplyMatrix` on a line or conic, `Inverse` of a singular `Transform` |
| `crosses_horizon` | A projective map sends part of a segment, ray or polygon edge to infinity | `ApplyMatrix` (3×3) |
| `not_affine` | The linear part of a map is needed but the map is projective | `ApplyMatrix` on vectors |
| `undefined_input` | A parameter (angle, centre, line) is undefined | any transform |

Examples:

```json
{ "name": "tri2", "type": "Polygon", "undefined": true, "reason": "undefined_input", "because": "O is undefined" }
```

```json
{ "name": "c2", "type": "Conic", "undefined": true, "reason": "singular_transform",
  "because": "Dilate by 0 squashes circle c to a point" }
```

```json
{ "name": "u", "type": "List<Polygon>", "undefined": true, "reason": "has_hole",
  "because": "b lies inside a, so the difference has a hole; polygons with holes are not supported yet" }
```

```json
{ "name": "p", "type": "Polygon", "undefined": true, "reason": "not_whole", "because": "sides = 4.5; a regular polygon needs a whole number" }
```

## 5. Notes

| note | Meaning |
|---|---|
| `self_intersecting` | The polygon crosses itself; `Area` is the algebraic area |
| `unchecked` | Self-intersection check skipped (more than 256 vertices) |
| `perturbed` | A boolean operation moved the second polygon by about 1e-9 of the figure size to resolve a degenerate contact |
| `flat` | A `progress` value made a reflection collapse the figure onto the mirror line |
| `overlap` | A line shares a segment with an edge (shared with points-lines) |
| `ill_conditioned` | Near-singular affine map (condition number above 1e8) |

```json
{ "ok": true, "line": 5, "name": "a", "type": "Number", "value": "2.0",
  "notes": ["self_intersecting"],
  "summary": "The polygon crosses itself, so this is the algebraic area." }
```

## 6. Numeric limits

| Case | Behaviour |
|---|---|
| Regular polygon above 1000 sides | `limit` (check time for literals) |
| Boolean ops above 256 vertices in total | `limit` |
| Simple test above 256 vertices | skipped, `unchecked` |
| Rotation angle beyond 1e10 radians | `not_finite` |
| Coordinates beyond 1e150 | `not_finite` |
| Image coordinates beyond `tol.far` | the vertex is `too_far`; the polygon is undefined with `because` naming the vertex |

## 7. Recovery patterns the model uses

| Failure | Next line |
|---|---|
| `too_few_points` | Add the missing point; confirm the third point is not collinear |
| `not_supported` | Transform the end points, or use a form on the supported list |
| `not_whole` | Make the slider `in 3..12 step 1` |
| `has_hole` | Describe it in words; cut it with `IntersectPath(line, poly)`; or change the shapes so they overlap |
| `singular_transform` | Do not use factor 0; tell the learner the figure collapses to a point |
| `self_intersecting` note | Say "the polygon crosses itself, so area is not the usual area" or reorder the vertices |
| `type_change` | `Delete` the image, redefine the source, redraw the image |
