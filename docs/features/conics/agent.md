# Circles, arcs, sectors and conics: how the model uses them

Syntax from the core design; forms from `design.md` in this folder.

## 1. Catalogue entries given to the model

### Tier A: always in the prompt (about 190 tokens)

```text
Circle(C, r) | (C, P) | (C, segment) | (A, B, C) -> Circle
Arc(C, r, from, to) | (C, S, E) | (circle, P, Q) -> Arc   # counter-clockwise, radians
Sector(C, r, from, to) | (circle, P, Q) -> Sector
Semicircle(A, B) -> Arc
Ellipse(F1, F2, a | segment | P) -> Conic
Parabola(F, line) -> Conic
Tangent(P, conic) -> List<Line>                          # 2 for an outside point
```

### Tier B: loaded when the lesson is about conics (about 420 tokens)

```text
Hyperbola(F1, F2, a | segment | P) -> Conic
Conic(A, B, C, D, E, F) | (list) | (P1, P2, P3, P4, P5) | (x^2/9 + y^2/4 == 1) -> Conic
ArcThrough(A, B, C) -> Arc;  SectorThrough(A, B, C) -> Sector
Incircle(A, B, C) -> Circle
Center | Radius | SemiMajor | SemiMinor | Eccentricity | LinearEccentricity | Parameter | Tilt (conic) -> Point | Number
Focus | Vertex | Directrix | Axes | Asymptote (conic) -> List<Point> | List<Line>
MajorAxis | MinorAxis (conic) -> Line
Tangent(line, conic) -> List<Line>; Tangent(conic, conic) -> List<Line>
Polar(P, conic) -> Line;  Pole(line, conic) -> Point;  ConjugateDiameter(line | vector, conic) -> Line
Curvature | CurvatureVector | OsculatingCircle (P, curve)
Area | Circumference | Perimeter (conic or sector) -> Number;  Length(arc) -> Number
Coefficients(conic) | Equation(conic) | Type(conic);  IsTangent(line, conic) -> Bool
```

Area total: about 610 tokens. Tier A fits inside the 1,200-token base; tier B is loaded by group name `conics`.

Short rules the prompt carries (about 50 tokens): arcs run counter-clockwise from the first angle to the second; `Ellipse` needs the major axis longer than the distance between the foci; `Tangent` returns a list: use `Tangent(P, c)[1]` for one line; conic equations use `==`.

## 2. Lines the model writes, by intent

| Intent | Lines |
|---|---|
| Circle and radius | `O = (0, 0)` / `c = Circle(O, 3)` / `P = PointOn(c, 0.2)` / `r = Segment(O, P)` |
| Inscribed angle | `A = PointOn(c, 0.5)` / `B = PointOn(c, 0.8)` / `C = PointOn(c, 0.1)` / `α = Angle(A, C, B)` / `β = Angle(A, O, B)` |
| Tangent to a circle at a point | `t = Tangent(P, c)[1]` (on the circle there is only slot 1) |
| Tangents from outside | `T = Tangent(Q, c)` then `t1 = T[1]`, `t2 = T[2]` |
| Sector with area | `s = Sector(O, 3, 0, α)` / `Readout("area", Area(s))` |
| Arc length | `l = Length(Arc(O, 3, 0, α))` |
| Ellipse from foci | `F1 = (-3, 0)` / `F2 = (3, 0)` / `e = Ellipse(F1, F2, 5)` |
| Ellipse by sum of distances | `P = PointOn(e, 0.2)` / `d1 = Distance(P, F1)` / `d2 = Distance(P, F2)` / `Readout("d1 + d2", d1 + d2)` |
| Parabola | `F = (0, 1)` / `d = Line((-5, -1), (5, -1))` / `p = Parabola(F, d)` |
| Hyperbola with asymptotes | `h = Hyperbola(F1, F2, 2)` / `as = Asymptote(h)` |
| Conic from an equation | `k = Conic(x^2/9 + y^2/4 == 1)` |
| Live equation | `r = 2 in 0..5` / `k = Conic(x^2 + y^2 == r^2)` |
| Polar | `L = Polar(P, c)` |
| Reflection property | `T = Tangent(P, e)[1]` / `N = Perpendicular(P, T)` |

## 3. Results the model gets

```json
{ "ok": true, "line": 1, "name": "c", "type": "Circle", "value": "centre (0, 0), radius 3", "notes": [] }
{ "ok": true, "line": 2, "name": "e", "type": "Conic", "value": "ellipse, a = 5, b = 4, centre (0, 0)", "notes": [] }
{ "ok": true, "line": 3, "name": "T", "type": "List<Line>", "value": "[y = 0.58x + 2.3, y = -1.4x - 3.1]", "notes": [] }
{ "ok": true, "line": 4, "name": "s", "type": "Sector", "value": "radius 3, from 0° sweep 60°, area 4.71", "notes": [] }
{ "ok": true, "line": 5, "name": "k", "type": "Conic", "value": "hyperbola", "notes": ["near_boundary:parabola"] }
```

Undefined:

```json
{ "ok": true, "line": 6, "name": "e", "type": "Conic", "undefined": true, "reason": "too_short",
  "because": "2a = 3 is not more than the distance between the foci, 4",
  "summary": "That ellipse cannot exist: the major axis must be longer than the distance between the foci." }
```

`value` strings give the kind and the numbers a teacher can speak. The model describes only these.

## 4. Fixing errors

| Result | What the model does |
|---|---|
| `too_short` | Re-issue with a larger `a` (the `because` gives both numbers) or `Hyperbola` |
| `inside` for `Tangent(P, c)` | Say "the point must be outside the circle", move the point (`show_me`) |
| `wrong_kind` on `Radius` | Use `SemiMajor` / `SemiMinor` |
| `bad_equation` | Replace `=` with `==` |
| `not_quadratic` | Switch to `Curve(…)` |
| `no_matching_form` for `Arc(O, 3, 0)` | Add the end angle |
| `negative_radius` | Set the slider range to start at 0 |

## 5. Worked lessons

### 5.1 The ellipse: sum of distances stays constant

> **Teacher:** "Two pins, a string, and a pencil. The pins are the foci." *(draw)*

```text
F1 = (-3, 0)
F2 = (3, 0)
```

> **Teacher:** "The string is ten units long, so the pencil can reach everywhere the two distances add up to ten." *(draw)*

```text
e = Ellipse(F1, F2, 5)
P = PointOn(e, 0.15)
d1 = Segment(F1, P)
d2 = Segment(F2, P)
```

> **Teacher:** "Watch the two lengths." *(draw)* `Readout("d1 + d2", Length(d1) + Length(d2))`, then `show_me` runs `P` around with `Along`-driven motion by switching to `P = Along(e, t / 10)`. The readout stays 10.

### 5.2 Tangent from outside, with a recovery

> **Teacher:** "A circle and a point close to it." *(draw)*

```text
O = (0, 0)
c = Circle(O, 2)
Q = (1, 1)
T = Tangent(Q, c)
```

Result: `T` undefined, `reason: inside`, `because: "Q is inside c"`.

> **Teacher:** *(no apology; next call)* "Let me move the point outside, so we can see the tangents." *(show_me sets `Q = (4, 1)`)* `figure` now shows `T` as two lines.

> **Teacher:** "Two tangents, both the same length from Q." *(draw)*

```text
t1 = T[1]
t2 = T[2]
A = Intersect(t1, c, 1)
B = Intersect(t2, c, 1)
Readout("QA", Distance(Q, A))
Readout("QB", Distance(Q, B))
```

### 5.3 Conic from an equation and a slider (circle to ellipse to hyperbola)

> **Teacher:** "Let a number change the shape." *(draw)*

```text
k = 1 in -2..2 step 0.1
c = Conic(x^2 + k y^2 == 4)
```

The result: for `k = 1` "circle"; for `k = 0.25` "ellipse"; `k = 0` "two parallel lines"; `k = -1` "hyperbola". After a `show_me` setting `k = 0` the teacher reads `value: "parallel lines"` and says what that is.

## 6. Streaming order

Foci and points first, then the conic, then the point on it, then measures and special lines. A conic's drawing appears after the object that defines it; its `PointOn` appears at the same time.

## 7. Token budget

| Item | Tokens |
|---|---|
| Tier A (always) | about 190 |
| Tier B (on demand) | about 420 |
| Rules in the prompt | about 50 |
| Typical `draw` result, 3 lines | about 130 |

Area total with points-lines tier A: about 520 always-on tokens. If the whole-v1 budget of 1,200 is a hard limit, tier A of conics can be reduced to `Circle`, `Arc`, `Tangent` (about 90 tokens) and the rest loaded by group.
