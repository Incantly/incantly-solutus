# Points, lines, vectors, intersections and measures: how the model uses them

Applies to the live teacher (`draw`, `figure`) and to non-live generation. Syntax from the core design; forms from `design.md` in this folder.

## 1. Catalogue entries given to the model

The model must know the names and the argument shapes, nothing else. The base prompt budget for the whole v1 catalogue is about 1,200 tokens (core design section 5). This area is large, so entries are split in two tiers.

### Tier A: always in the prompt (about 330 tokens)

```text
Point(x, y) -> Point            # just write (x, y)
PointOn(path[, u]) -> Point     # draggable on a line/segment/circle/curve; u in 0..1
Midpoint(P, Q) | (Segment) -> Point
Segment(P, Q) -> Segment
Ray(P, Q | v) -> Ray
Line(P, Q | v | line) -> Line   # also Line(2x + 3y == 6)
Vector(P, Q) | (dx, dy) -> Vector
Perpendicular(P, line) -> Line
Parallel(P, line) -> Line
Bisector(P, Q) | (A, B, C) | (L1, L2) -> Line | List<Line>
Intersect(a, b) -> Point | List<Point>; Intersect(a, b, k) -> Point   # k from 1
Distance(P, Q | line) -> Number
Length(segment | vector) -> Number
Angle(A, B, C) -> Number        # at B, counter-clockwise, in radians
Slope(line) -> Number
Dot(u, v) | Cross(u, v) -> Number
Translate(v, P) -> Vector       # vector moved to start at P
```

### Tier B: loaded when the lesson mentions it (about 330 tokens)

Loaded under the group label `geometry+`:

```text
PointIn(region) -> Point
Along(path, u) -> Point         # not draggable; use with t for motion
ParamOf(P) -> Number
Closest(path, P) -> Point
RandomIn(region, seed) -> Point
Barycenter(points, weights) | TriangleCenter(A, B, C, n) -> Point
Direction(line) | Normal(line) | UnitVector(v|line) | PerpVector(v|line) | UnitPerpVector(v|line) -> Vector
ToPolar(v) -> [r, theta]; FromPolar(r, theta) -> Point
Angle(L1, L2) | Angle(u, v) | Angle(v) -> Number
AffineRatio(A, B, C) | CrossRatio(A, B, C, D) -> Number
Locus(Q, P) | Locus(Q, s, from, to) -> Curve
Relation(a, b) -> Text
AreCollinear(A, B, C) | AreParallel(l, m) | ArePerpendicular(l, m) | AreConcurrent(l, m, n) | AreConcyclic(A, B, C, D) | AreEqual(a, b) -> Bool
Intersect(a, b, near = P) | Intersect(a, b, extend = true)
```

Tier A is part of the 1,200-token base. Tier B adds about 330 tokens when loaded. Area total: about 660 tokens.

Syntax reminders in the prompt (shared across areas, repeated once): name every object; points use capitals, lines and curves lowercase; indices count from 1; angles are in radians, write `30°` for degrees.

## 2. Lines the model writes, by intent

| Intent | Lines |
|---|---|
| Triangle skeleton | `A = (0, 0)` / `B = (4, 0)` / `C = (1, 3)` / `a = Segment(B, C)` / `b = Segment(C, A)` / `c = Segment(A, B)` |
| Midpoint and median | `M = Midpoint(B, C)` / `m = Segment(A, M)` |
| Altitude | `h = Perpendicular(A, Line(B, C))` / `H = Intersect(h, Line(B, C))` |
| Perpendicular bisector | `p = Bisector(A, B)` |
| Angle bisector | `d = Bisector(B, A, C)` (apex is the middle point: here A) |
| Circumcentre | `O = Intersect(Bisector(A, B), Bisector(B, C))` |
| A point that slides on a line | `P = PointOn(l, 0.3)` |
| A point that circles | `P = Along(c, t / 8)` |
| Distance readout | `d = Distance(A, B)` then `Readout("AB", d)` |
| Angle mark | `α = Angle(B, A, C)` |
| Vector sum | `w = u + v` and `Translate(v, tip)` to show the head-to-tail arrangement |

Rules the prompt states once:
- `Intersect` of two line-likes returns one point; for a circle it returns a list, so write `Intersect(l, c, 1)` for a single point.
- An intersection index is a position in a fixed order (first along the line's direction), not "the nearer one".
- A segment or ray only meets things on the segment or ray. To meet the whole line, `Intersect(a, b, extend = true)`.
- Angles are counter-clockwise from the first arm to the second. If the mark looks reflex, swap the arms.

## 3. What `draw` and `figure` return for this area

`draw` returns per line. Successful lines for geometry:

```json
{ "ok": true, "line": 1, "name": "P", "type": "Point", "value": "(2, 1.5)", "notes": [] }
{ "ok": true, "line": 2, "name": "d", "type": "Number", "value": "3.606", "notes": [] }
{ "ok": true, "line": 3, "name": "T", "type": "List<Point>", "value": "[(1.2, 0.5), (-0.4, 1.9)]", "notes": [] }
{ "ok": true, "line": 4, "name": "α", "type": "Angle", "value": "56.3°", "notes": [] }
```

A defined-but-undefined case is `ok: true` with an `undefined` marker:

```json
{ "ok": true, "line": 5, "name": "P", "type": "Point", "undefined": true, "reason": "parallel", "because": "a, b",
  "summary": "a and b are parallel, so P has no position." }
```

`figure` returns the same fields for every object plus `visible`. It also lists `undefined` objects first, so the model sees problems before it speaks.

The model must describe only what these results say. It may use `summary` strings directly in speech.

## 4. Fixing errors

| Error | Fix by the model |
|---|---|
| `unnamed_object` | Add a name: `P = Intersect(a, b)` |
| `no_matching_form` on `Bisector(A, B, 2)` | Read `forms`; decide between `Bisector(A, B)`, `Bisector(A, B, C)`; fix the call |
| `bad_argument` index | Use 1 or 2 |
| `no_dependency` | Build the tracer from the mover first |
| undefined `parallel` | Do not retry the same line. Move a point (`show_me`) or describe the parallelism as the lesson point |
| undefined `outside_path` | Say "the segment is too short to meet it", or use `extend = true` to show the line meeting |
| undefined `no_intersection` | Say "the line misses the circle"; move the line to cross it |
| note `ill_conditioned` | Do not claim the lines meet "nearby"; say they are almost parallel |

The model retries a failing line at most twice (core design), then moves on and only states what was drawn.

## 5. Worked lesson snippets

### 5.1 The altitudes of a triangle meet at one point

> **Teacher:** "Here is a triangle." *(calls draw)*

```text
A = (0, 0)
B = (6, 0)
C = (2, 4)
tri = Polygon(A, B, C)
```

> **Teacher:** "From each corner we drop a perpendicular onto the opposite side." *(calls draw)*

```text
ha = Perpendicular(A, Line(B, C))
hb = Perpendicular(B, Line(C, A))
hc = Perpendicular(C, Line(A, B))
```

> **Teacher:** "Watch where they meet." *(calls draw)*

```text
H = Intersect(ha, hb)
Highlight(H, 2)
```

Result of the last call: `H` at `(2, 1.5)`. The teacher says "they all pass through this one point, the orthocentre" and then drags: `show_me` sets `C = (5, 4)`; the figure updates, `H` moves outside the triangle for the obtuse case.

### 5.2 Circle locus of a midpoint, recovering from an error

> **Teacher:** "Take a circle and a point on it." *(draw)*

```text
O = (0, 0)
c = Circle(O, 3)
P = PointOn(c, 0.1)
B = (6, 0)
```

> **Teacher:** "The midpoint of P and B." *(draw)*

```text
M = Midpoint(P, B)
tr = Locus(M, P)
```

Suppose the first attempt was `tr = Locus(P, M)`. The result:

```json
{ "ok": false, "line": 2, "kind": "no_dependency",
  "message": "Locus(Q, P): Q does not depend on P, so its locus is one point.",
  "hint": "Build Q from P (for example Q = Midpoint(P, B)), then repeat." }
```

> **Teacher:** *(next call, no speech about the error)* `tr = Locus(M, P)`

> **Teacher:** "As P goes round the big circle, its midpoint with B traces a smaller circle."

### 5.3 Two lines that never meet (undefined as teaching)

> **Teacher:** "These two lines have the same slope." *(draw)*

```text
A = (0, 0)
B = (1, 2)
C = (0, 3)
D = (1, 5)
a = Line(A, B)
b = Line(C, D)
P = Intersect(a, b)
```

Result: `P` is undefined with reason `parallel`, `because: "a, b"`.

> **Teacher:** "They never meet. That's what parallel means." *(draw)* `Hide(P)` then `show_me` tilts `b` by setting `D = (1, 5.4)`; `figure` now shows `P` defined at `(7.5, 15)`.

## 6. Streaming behaviour

- A tool line needs everything before it. The model streams objects in dependency order: points, then lines, then derived points, then marks and readouts.
- First object on screen within one frame of the first line. Intersection lines compute in microseconds.
- During generation of a figure from a prompt, geometry lines appear as soon as they pass; the order shown above is also the visual build order (points, then lines, then intersections).

## 7. Token budget

| Item | Tokens |
|---|---|
| Tier A catalogue (always) | about 330 |
| Tier B catalogue (on demand) | about 330 |
| Syntax reminders for this area | about 60 |
| One typical `draw` result (3 lines) | about 120 |
| Worst `figure` listing for 40 geometry objects | about 1,000, of which only changed or undefined objects are listed after the first call |

The base v1 prompt target (1,200 tokens for all commands) holds if tier A of every area is kept to the sizes in each area's `agent.md`.
