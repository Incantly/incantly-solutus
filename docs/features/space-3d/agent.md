# Space (3D): how the AI model uses it

Companion to `design.md` and `errors.md`. The model writes lines in the one language of the core design and calls `draw` (one to five lines) and `figure`. This file gives the 3D catalogue chunks, what comes back, how to fix errors, and how the live teacher talks while building.

---

## 1. Rules the model is told (about 220 tokens, always loaded with the 3D chunk)

```text
SPACE (3D). A point with three numbers is in space: A = (1, 2, 3). Two numbers is flat. Never mix.
Flat points in a space command: write (x, y, 0).
The camera is the object `space`: space with azimuth = 40deg, elevation = 25deg, projection = persp.
Angles take deg: 30deg. Axes: x right, y into the screen, z up.
Planes/solids/surfaces are objects: give each a name. Slice with Intersect(plane, solid).
Hide the floor or axes: space with floor = false, axes = false.
Transparent: P with opacity = 0.3. Ask `figure` to see what is visible, hidden or clipped.
Keep the scene inside about -6..6 on each axis, or call ViewAll().
One command makes one object. Measures return Numbers: V = Volume(pyr).
```

---

## 2. Catalogue chunks

The core design loads the whole catalogue (about 1,200 tokens for 2D v1). For 3D, chunks load on demand so a flat lesson pays nothing. The teacher's instructions list the chunk names; the first 3D object (or `@view3`) loads `space-basic` and the camera chunk. The model can ask for more with the tool `figure` field `want: ["space-solids"]` (returns the lines), or the host loads them when the lesson topic says so (“volume”, “sphere”, “cone”, “surface”).

Each entry is one line: `Command(params) -> Type`. `|` separates alternative argument types inside a position. Named arguments are given with their names.

### 2.1 `space-basic` (points, lines, planes, flat shapes, measures) — target 520 tokens

```text
(x, y, z) -> Point3
Vector(x, y, z) | Vector(P, Q) -> Vector3
Midpoint(P, Q) | Midpoint(Segment3) -> Point3
Segment(P, Q) -> Segment3          Ray(P, Q|v) -> Ray3          Line(P, Q|v) -> Line3
PointOn(path3, t) | PointOn(surface, u, v) -> Point3        PointIn(Polygon3|Plane|solid) -> Point3
Plane(P, Q, R) | Plane(P, Line3) | Plane(Line3, Line3) | Plane(P, normal: v) | Plane(Polygon3) | Plane(a*x + b*y + c*z == d) -> Plane
OrthogonalPlane(P, Line3|v) -> Plane       Parallel(P, Line3) -> Line3       Parallel(P, Plane) -> Plane
Perpendicular(P, Plane|Line3) -> Line3     Bisector(P, Q) -> Plane           Bisector(P, V, Q) -> Line3
Polygon(P, Q, R, ...) | Polygon(P, Q, n, normal: v) -> Polygon3         Polyline(P, Q, ...) -> PolyLine3
Circle(center: P, radius, axis: v) | Circle(P, Q, R) | Circle(center: P, through: Q, axis: v) | Circle(axisLine: L, through: P) -> Circle3
Arc(Circle3, from, to) -> Arc3     Ellipse(F1, F2, P) -> Conic3      Curve(x(s), y(s), z(s), s, a, b) -> Curve3
Intersect(a, b) -> Point3|Segment3|Line3|Circle3|Conic3|List     Intersect(a, b, k) -> slot k
Distance(P, Q|Line3|Plane)  Distance(Line3, Line3|Plane)  Distance(Plane, Plane) -> Number
Angle(u, v) | Angle(P, V, Q) | Angle(Line3, Line3|Plane) | Angle(Plane, Plane) -> Number (radians)
Length(v|Segment3|Arc3|Circle3)  Area(Polygon3|Circle3)  Dot(u, v)  Cross(u, v) -> Vector3  Normal(Plane|Polygon3) -> Vector3
Translate(shape, v)  Rotate(shape, angle, axis: Line3)  Reflect(shape, Plane|Line3|P)  Dilate(shape, k, center: P)
Center(c) Radius(c) Vertex(shape) Direction(Line3)
```

### 2.2 `space-solids` (polyhedra and curved solids) — target 400 tokens

```text
Pyramid(Polygon3, apex: P | height) | Pyramid(P1, P2, P3, ..., apex) -> Polyhedron
Prism(Polygon3, top: P | height) | Prism(P1, ..., Pn, top: P) -> Polyhedron       Extrude(Polygon3|Circle3, height|v)
Tetrahedron(P, Q, side: R)  Cube(P, Q, side: R)  Octahedron(...)  Dodecahedron(...)  Icosahedron(...) -> Polyhedron
Polyhedron(vertices: List<Point3>, faces: List<List<Number>>)   Hull3(List<Point3>) -> Polyhedron
Net(Polyhedron, t) | Net(Polyhedron, t, base: faceIndex) -> Net      (t: 0 folded, 1 flat)
Vertices(p) Edges(p) Faces(p) -> List
Sphere(center: P, radius) | Sphere(center: P, through: Q) | Sphere(diameter: Segment3) -> Quadric
Cylinder(P, Q, radius) | Cylinder(Circle3, height) -> Quadric       Cone(P, apex: Q, radius) | Cone(Circle3, height) -> Quadric
InfiniteCylinder(Line3, radius)  InfiniteCone(apex: P, axis: v, halfAngle) -> Quadric
x^2/4 + y^2/9 + z^2 == 1 -> Quadric  (any quadratic equation in x, y, z)
TopFace(s) BottomFace(s) Lateral(s) Height(s)
Volume(solid) -> Number     SurfaceArea(solid|surface) -> Number
TangentPlane(surface|Quadric, P) -> Plane
```

### 2.3 `space-surfaces` (functions of two variables, parametric, implicit, revolution) — target 240 tokens

```text
f(x, y) = sin(x*y)                          -> surface z = f(x, y)
Surface(x(u,v), y(u,v), z(u,v), u, u0, u1, v, v0, v1) -> Surface
F = x^2 + y^2 - z^2 == 1                   -> implicit surface (non-quadratic) or Quadric
Revolve(f, a, b, axis: Line3) | Revolve(Curve3, from, to, axis: Line3, angle) -> Surface
SolidOfRevolution(f, a, b, axis: Line3) | SolidOfRevolution(f, g, a, b, axis: Line3) -> Solid   (Volume works)
Gradient(f, x, y) -> Vector3
```

### 2.4 `space-view` (camera and display) — target 190 tokens

```text
space with azimuth, elevation, roll = angle    target = P    zoom = n    projection = ortho|persp|oblique   fov = angle
space with axes|floor|grid = true|false    light = on|off|flat    background = color    zUp = true|false
space with clip = true, clipMin = (x, y, z), clipMax = (x, y, z)
space with stereo = off|anaglyph|sidebyside     space with spin = degrees_per_second
ViewFacing(obj)  ViewAll()  ViewReset()  ViewPreset(front|back|left|right|top|bottom|isometric)  Spin(deg_per_s)
obj with opacity = 0..1, mesh = true|false, hidden = dashed|faded|off, color = red, lineWidth = n
```

**Budget.** Rules (220) + basic (520) + solids (400) + surfaces (240) + view (190) = about 1,570 tokens when everything is loaded; a typical lesson loads rules + basic + view = about 930. The combined cost of the 2D v1 catalogue (1,200) plus 3D basic and view is therefore below 2,200 tokens. Each form line averages 14 tokens; the table above is counted at 4 characters per token and has been trimmed to meet the targets. Line count: basic 21, solids 16, surfaces 6, view 6.

---

## 3. What `draw` and `figure` return

### 3.1 `draw`: per line

```json
[
  { "ok": true, "line": 1, "name": "A", "type": "Point3", "summary": "(2, 0, 0)" },
  { "ok": true, "line": 2, "name": "pl", "type": "Plane",  "summary": "z = 1.5",
    "view": { "visible": true } },
  { "ok": true, "line": 3, "name": "s",  "type": "Quadric", "summary": "sphere centre (0,0,0) r 2",
    "view": { "visible": true, "clipped": false } },
  { "ok": true, "line": 4, "name": "c",  "type": "Circle3", "summary": "circle centre (0,0,1.5) r 1.32, in plane z = 1.5",
    "view": { "visible": true } }
]
```

- `summary` is short and carries the numbers a teacher wants (centre and radius of a sphere, normal and offset of a plane, volume of a solid, count of faces).
- `view` appears for 3D objects: `visible`, `occluded` (and `by`), `clipped`, `offscreen`. Only non-default flags are listed.
- `warnings` (S101–S112) appear on the line that caused them.
- Undefined results are `ok: true` with `undefined: { reason, detail, cause? }` and the changed-object list from the kernel report (“became undefined: c, because the plane misses the sphere”).

### 3.2 `figure`

```json
{
  "space": { "azimuth": "-40deg", "elevation": "22deg", "projection": "ortho", "zoom": 1,
             "clip": false, "visibleBounds": [[-6,-6,-1],[6,6,6]] },
  "objects": [
    { "name": "pyr", "type": "Polyhedron", "value": "pyramid, 5 vertices, 5 faces, volume 8", "visible": true },
    { "name": "V",   "type": "Number",     "value": "8" },
    { "name": "pl",  "type": "Plane",      "value": "z = 1.5", "visible": true, "occluded": false },
    { "name": "sec", "type": "Polygon3",   "value": "4 points, area 2.25", "visible": true }
  ],
  "undefined": [],
  "warnings": [],
  "render": { "backend": "webgl2", "degraded": [] }
}
```

`value` for space objects is always one line of words, never raw arrays larger than 3 numbers.

---

## 4. How the model fixes errors

The error object carries `kind`, `forms`, `hint`, `suggest`, `recovery` (see `errors.md`). The patterns:

| Error | What to write next |
|---|---|
| `mixed_dimension` | Take `suggest[0]` as is, or rewrite the 2D point with `, 0` |
| `no_matching_form` on `Plane` | Add the missing point or give a normal; copy a form from `forms` |
| `bad_property_value` on `projection = isometric` | Use `ViewPreset(isometric)` |
| `not_a_path` for `PointOn(sphere, t)` | `PointOn(s, u, v)` |
| `unknown_name` for a point in the line | Define the point first, then repeat the line (same batch order) |
| Undefined `degenerate` (collinear points for a plane) | Move one point, then re-state; do not repeat the same line |
| Undefined `no_intersection` | Say so: “the plane misses the sphere”; then change the plane (`pl = Plane(...)` with a new z) in the next line |
| Undefined `not_coplanar` | Rebuild the polygon from three points then derive the fourth: `D = A + (C - B)` |
| `S101` mesh truncated | Narrow the domain or add `space with clip = true`, `clipMin`, `clipMax` |
| `occluded` view flag | Add `opacity = 0.3` to the blocking solid, or `ViewFacing(obj)` |

Retry rule from the core design applies: at most twice per line, then speak only what was drawn.

---

## 5. Lesson snippets

Each snippet is speech, then the lines sent in the same call. `⚠` marks an error returned by `draw`.

### 5.1 A plane cuts a cone (conic sections), with an error and recovery

> "Here is a cone standing on the floor, point at the top."

```text
space with azimuth = -50deg, elevation = 20deg
O = (0, 0, 0)
T = (0, 4)
k = Cone(O, T, 2)
k with opacity = 0.35
```

`draw` accepts lines 1 to 3 and refuses line 4 (`T` is a flat point):

```json
{ "ok": false, "line": 4, "kind": "mixed_dimension", "code": "S001",
  "message": "Cone(O, T, 2): O is a point in space but T is a flat point (2 numbers).",
  "forms": ["Cone(base: Point3, apex: Point3, radius: Number) -> Quadric",
            "Cone(base: Circle3, height: Number) -> Quadric"],
  "hint": "Give T a z value: T = (0, 0, 4).",
  "suggest": ["k = Cone(O, (T.x, 0, T.y), 2)"],
  "recovery": "use_suggestion" }
```

> (no pause) "The top of the cone is four up."

`T` already exists as a flat point, and redefining it as a point in space would be `type_change`. The model uses a fresh name:

```text
Tp = (0, 0, 4)
k = Cone(O, Tp, 2)
k with opacity = 0.35
```

> "Now slice it with a flat plane, halfway up."

```text
pl = Plane((0, 0, 2), normal = Vector(0, 0, 1))
pl with opacity = 0.2
c = Intersect(pl, k)
c with color = red, lineWidth = 3
```

`draw` returns `c` as `Circle3`, summary "circle centre (0,0,2) r 1, in plane z = 2".

> "The slice is a circle, radius 1: half the height, half the radius. Now let me tilt the plane."

```text
a = 0 in 0deg..40deg
pl2 = Plane((0, 0, 2), normal = Vector(sin(a), 0, cos(a)))
pl2 with opacity = 0.2
e = Intersect(pl2, k)
```

> "See how the circle stretches into an ellipse." (`show_me` sets `a = 25deg`; `figure` returns `e` as a `Conic3`, "ellipse, semi-axes 1.1 and 0.95".)

### 5.2 Pyramid volume is one third of a prism, with a net

> “A triangle on the floor, and a pyramid on it.”

```text
A = (0, 0, 0)
B = (4, 0, 0)
C = (0, 3, 0)
tri = Polygon(A, B, C)
pyr = Pyramid(tri, 4)
pyr with opacity = 0.4
V1 = Volume(pyr)
```

`draw` returns `V1` “8”.

> “Eight. Now the prism with the same base and height.”

```text
pri = Prism(tri, 4)
pri with opacity = 0.15, color = gray
V2 = Volume(pri)
Readout("prism", V2)
Readout("pyramid", V1)
```

> “Twenty-four against eight: one third. To see why, unfold the pyramid.”

```text
t0 = 0 in 0..1 step 0.01
n = Net(pyr, t0)
Hide(pyr, pri)
```

> “Drag the slider and it lies flat.” (`show_me` moves `t0` to 1.)

### 5.3 A solid of revolution with a camera move

> “Take the curve y = √x from 0 to 4 and spin it around the x-axis.”

```text
space with azimuth = -35deg, elevation = 18deg, zUp = false
f(x) = sqrt(x)
ax = Line((0, 0, 0), Vector(1, 0, 0))
S = Revolve(f, 0, 4, ax)
S with opacity = 0.6
```

`zUp = false` makes y vertical so the picture reads like the graph. `draw` returns `S` “surface of revolution, 0 ≤ x ≤ 4”.

> “The solid has a volume. π times the integral of x, from zero to four.”

```text
sol = SolidOfRevolution(f, 0, 4, ax)
V = Volume(sol)
Readout("volume", V)
```

`V` = 25.133 (8π). The model reads `8π ≈ 25.13`.

> “Let's look at it end-on.”

```text
ViewFacing(ax)
```

> “Now from the side again, slowly turning.”

```text
space with azimuth = -35deg + 20deg * t
```

---

## 6. Common patterns the model should know

- **Regular solids on an edge.** `Cube(A, B, side = C)`: C picks the side of the edge. For a cube standing on the floor with edge along x, use C above or beside the edge: `C = (A.x, A.y, 1)` for upward. If unclear, `Cube(A, B, side = (A.x, A.y, 1))` and read the `figure` bounds.
- **Section of a solid.** `Intersect(plane, solid)` returns a `Polygon3` (polyhedron), a `Circle3`/`Conic3` (sphere or quadric), or `PolyPath3`. Use `Area(sec)` for polygons and circles.
- **Lines and distances.** Perpendicular distance from a point to a plane: `Distance(P, pl)`; draw it with `Segment(P, Intersect(Perpendicular(P, pl), pl))`.
- **Dragging.** Free points `A = (1, 2, 3)` are draggable; `show_me` can set them.
- **Camera for a lesson.** One `space with …` line at the start; use `ViewFacing(obj)` when you want to look at something; avoid changing the camera every sentence.
- **Opacity.** Opaque by default for surfaces; set `opacity` on every solid you cut.
- **Readouts.** `Readout("volume", V)` gives a live value.

---

## 7. Token budget summary

| Part | Tokens |
|---|---|
| Rules (always, with any 3D chunk) | ~220 |
| `space-basic` | ~520 |
| `space-solids` | ~400 |
| `space-surfaces` | ~240 |
| `space-view` | ~190 |
| Typical lesson load (rules + basic + view) | ~930 |
| Everything | ~1,570 |
| A `draw` result line | ~25–45 |
| A `figure` result for 20 space objects | ~500 |

If the host is short of context, drop `space-surfaces` first, then `space-solids`.
