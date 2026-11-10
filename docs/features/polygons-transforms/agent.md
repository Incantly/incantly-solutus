# Polygons and transformations: how the model uses them

Syntax from the core design; forms from `design.md` in this folder.

## 1. Catalogue entries given to the model

### Tier A: always in the prompt (about 250 tokens)

```text
Polygon(A, B, C, …) | (list) | (center, radius, n) | (P, Q, n) -> Polygon     # n whole, ≥ 3
Vertex(poly, k) -> Point;  Side(poly, k) -> Segment                          # k from 1
Area(poly) | Perimeter(poly) -> Number
Translate(shape, v) | Rotate(shape, angle, center) -> same type as shape
Reflect(shape, line | point | circle) -> same type
Dilate(shape, factor, center) -> same type
Angles: radians; write 40° for degrees. Positive = counter-clockwise.
Every transform takes progress = u (0..1) to show the motion
```

### Tier B: loaded when the lesson needs it (about 380 tokens)

```text
Polyline(A, B, …) | (list) -> Polyline;  Length(polyline) -> Number
Polygon(S, v1, v2, …) -> Polygon          # head-to-tail vectors from S
Rigid(poly[, dx, dy]) -> Polygon          # fixed shape, draggable pose
Vertices(poly) -> List<Point>;  Sides(poly) -> List<Segment>
InteriorAngles(poly) -> List<Angle>;  SignedArea(poly) -> Number
Centroid(poly) -> Point;  Convex(poly) | Simple(poly) -> Bool
InRegion(P, poly | conic | sector) -> Bool
IntersectPath(line, poly) -> List<Segment>;  IntersectPath(poly, poly) | Union(poly, poly) | Difference(poly, poly) -> List<Polygon>
Rotate(shape, angle) | Dilate(shape, factor)          # about the origin
Shear(shape, line, ratio);  Stretch(shape, line, ratio) | (shape, vector)
ApplyMatrix(M, shape)         # 2x2 linear, 3x3 affine or projective
Shift(v) | Turn(angle, C) | Mirror(line) | Scale(k, C) | ShearBy(l, r) | StretchBy(l, r) | Linear(M) -> Transform
Then(T1, T2, …) | Inverse(T) -> Transform;  Move(shape, T) -> same type as shape
```

Area total about 630 tokens.

Prompt rules (about 60 tokens): name every image (`tri2 = Rotate(...)`); corners of an image are not objects: use `Vertex(tri2, 1)` or `with vertexlabels = prime`; sliders for sides use `in 3..12 step 1`; booleans return lists.

## 2. Lines the model writes, by intent

| Intent | Lines |
|---|---|
| Triangle | `A = (0, 0)` / `B = (4, 0)` / `C = (1, 3)` / `tri = Polygon(A, B, C)` |
| Area and perimeter readout | `Readout("area", Area(tri))` / `Readout("perimeter", Perimeter(tri))` |
| Regular polygon with a slider | `n = 5 in 3..12 step 1` / `p = Polygon(O, 2, n)` |
| Angle sum | `ang = InteriorAngles(tri)` / `Readout("sum", Sum(ang))` |
| Translate | `v = Vector(3, 1)` / `tri2 = Translate(tri, v)` |
| Rotate | `O = (0, 0)` / `tri2 = Rotate(tri, 90°, O)` |
| Rotate live | `a = 0 in 0..6.283` / `tri2 = Rotate(tri, a, O)` |
| Rotate step by step | `u = 0 in 0..1 step 0.01` / `tri2 = Rotate(tri, 90°, O, progress = u)` |
| Reflect across a line | `m = Line(P, Q)` / `tri2 = Reflect(tri, m)` |
| Reflect across a point | `tri2 = Reflect(tri, O)` |
| Dilate | `k = 2 in 0.5..3` / `tri2 = Dilate(tri, k, O)` |
| Compare images | `Readout("scale of area", Area(tri2) / Area(tri))` |
| Shear and stretch | `s = Shear(sq, base, 0.5)` / `t = Stretch(sq, base, 2)` with `base = Line(A, B)` made first |
| Composition | `T = Then(Turn(60°, O), Shift(v))` / `tri3 = Move(tri, T)` |
| Congruence | `Readout("equal?", AreCongruent(tri, tri2))` |
| Vector polygon | `S = (0, 0)` / `w = Polygon(S, Vector(2, 0), Vector(0, 3), Vector(-2, 0))` |
| Overlap | `ov = IntersectPath(tri, sq)` / `Readout("overlap area", Area(ov[1]))` |

(The "Rotate live" row writes the slider in radians because angle sliders are plain numbers.)

## 3. Results the model gets

```json
{ "ok": true, "line": 4, "name": "tri", "type": "Polygon", "value": "3 vertices, area 6, perimeter 12.64", "notes": [] }
{ "ok": true, "line": 5, "name": "tri2", "type": "Polygon", "value": "3 vertices, area 6, perimeter 12.64", "notes": [] }
{ "ok": true, "line": 6, "name": "ang", "type": "List<Angle>", "value": "[63.4°, 71.6°, 45°]", "notes": [] }
{ "ok": true, "line": 7, "name": "ov", "type": "List<Polygon>", "value": "1 polygon, area 2.3", "notes": [] }
```

`figure` lists vertex positions for polygons of up to 8 vertices; for larger polygons it gives the count, area and bounding box.

## 4. Fixing errors

| Result | What the model does |
|---|---|
| `too_few_points` | Add a point, check collinearity |
| `bad_argument` `sides` | Use ≥ 3 |
| `not_supported` | Use the hint's alternative |
| `has_hole` | Describe or restructure; do not retry |
| `singular_transform` | Do not use factor 0; teach it as "everything collapses" |
| `self_intersecting` | Mention; reorder points if unintended |
| `not_whole` | Tell the user/slider to use whole numbers; set the slider step |
| `type_change` | `Delete` the image, redefine, redraw |

## 5. Worked lessons

### 5.1 A rotation turns every point by the same angle

> **Teacher:** "Here is a triangle and a centre." *(draw)*

```text
O = (0, 0)
A = (2, 1)
B = (4, 1)
C = (3, 3)
tri = Polygon(A, B, C)
```

> **Teacher:** "Now we turn it a quarter turn about O." *(draw)*

```text
u = 0 in 0..1 step 0.01
tri2 = Rotate(tri, 90°, O, progress = u) with vertexlabels = prime
```

> **Teacher:** *(show_me sets `u` from 0 to 1 over three seconds, speaking)* "Every corner moves along a circle about O, and the angle at O is always the same: ninety degrees."

> **Teacher:** "The shape did not change." *(draw)* `Readout("area before", Area(tri))`, `Readout("area after", Area(tri2))`. Both read 3.

### 5.2 Regular polygon with a slider, recovering from an error

> **Teacher:** "A regular polygon. How many sides?" *(draw)*

```text
O = (0, 0)
n = 5 in 3..12
p = Polygon(O, 2, n)
```

Result of the third line: `p` is undefined, `reason: not_whole`, `because: "sides = 5.37; a regular polygon needs a whole number"`. (The slider had no step.)

> **Teacher:** *(next call, no apology)* `n = 5 in 3..12 step 1`. Then: "Each time we add a side, the interior angles get bigger." *(draw)*

```text
ang = InteriorAngles(p)
Readout("one angle", ang[1])
```

### 5.3 Overlap of two polygons

> **Teacher:** "Two squares." *(draw)*

```text
a = Polygon((0, 0), (3, 0), (3, 3), (0, 3))
b = Polygon((2, 2), (5, 2), (5, 5), (2, 5))
```

Point expressions may stand inside `Polygon(...)` (each tuple is a point). Result: `a` and `b` polygons, areas 9 and 9.

> **Teacher:** "Where they overlap." *(draw)*

```text
ov = IntersectPath(a, b)
Readout("overlap area", Area(ov[1]))
```

Result: `ov` has 1 polygon, area 1.

> **Teacher:** "They share a one-by-one square." *(draw)* `Difference(a, b)` returns one L-shaped polygon (no hole), so `Readout("rest", Area(Difference(a, b)[1]))` shows 8.

## 6. Streaming order

Free points, then the polygon, then measures; for transformations: source, parameter (sliders, vectors, centre, line), image, readouts. The image appears as soon as its line passes; a `progress` slider starts at 0 so the image sits on the source first.

## 7. Token budget

| Item | Tokens |
|---|---|
| Tier A (always) | about 250 |
| Tier B (on demand) | about 380 |
| Rules | about 60 |
| Typical `draw` result, 3 lines | about 140 |

Across the three plane-geometry folders the always-on cost is about 770 tokens (points-lines 330, conics 190, this 250). If the whole-v1 catalogue budget of 1,200 tokens must hold for all areas, tier A of every folder shrinks to the core command names and forms (about 500 tokens combined) and the rest loads by group, as the core design allows.
