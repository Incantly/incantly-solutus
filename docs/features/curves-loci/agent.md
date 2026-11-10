# Curves, inequalities, loci and envelopes: how the model uses it

Reads with `design.md` and `errors.md`, and with `docs/features/functions-calculus/agent.md` for the shared `draw` and `figure` result shapes.

## 1. The lines the model writes

Short rules told to the model (about 110 tokens):

- A curve from a formula of one parameter is `c(s) = (x(s), y(s)) in a..b`. Always give the range. `tau` is a full turn.
- A curve from an equation is `c(x, y) = lhs == rhs`.
- A region is `q(x, y) = condition` with `<`, `<=`, `>`, `>=`, `and`, `or`. Chains such as `1 < x^2 + y^2 < 4` are fine.
- A locus needs a mover: `P = PointOn(path, 0.3)`, then points built from `P`, then `Locus(Q, P)`.
- Say what you built only after `draw` reports it.

### Common lines

```text
c(s) = (2 cos(s), sin(s)) in 0..tau
heart(s) = (16 sin(s)^3, 13 cos(s) - 5 cos(2 s) - 2 cos(3 s) - cos(4 s)) in 0..tau
rose = Polar(sin(3 θ), θ, 0, tau)
e(x, y) = x^2 / 4 + y^2 == 1
w(x, y) = sin(x) + sin(y) == sin(x*y)
k = Contour(g, 0.5)
disc(x, y) = x^2 + y^2 <= 4
band(x, y) = 1 < x^2 + y^2 < 4
sys(x, y) = y >= x and x + y < 3 and y < 2
p(x) = x^2 > 4
B = Boundary(p, -5, 5)
I = Intersect(e, c)
T = Tangent(c, 1.2)
N = Normal(e, (2, 0))
K = Curvature(c, 0.5)
O = OsculatingCircle(c, 0.5)
L = Length(c, 0, pi)
Q = PointOn(e, (0, 1))
S = Spline([(0, 0), (1, 2), (2, 1), (3, 3)])
Bz = Bezier([(0, 0), (1, 2), (2, 2), (3, 0)])
```

### Locus line pattern

```text
O = (0, 0)
C = Circle(O, 2)
A = (5, 0)
P = PointOn(C, 0.1)
M = Midpoint(A, P)
loc = Locus(M, P)
eq = LocusEquation(M, P)
```

### Envelope line pattern

```text
P = PointOn(Circle((0, 0), 3), 0.2)
L = Line(P, (6, 0))
env = Envelope(L, P)
```

## 2. Catalogue entries the model is given

Tier A (always, 11 lines). Tier B (loaded when the beat is about loci, regions or advanced curves).

### Tier A

```text
c(s) = (x(s), y(s)) in a..b                 parametric Curve, range required
Polar(r: expr in θ, θ, a: Number, b: Number) -> Curve
c(x, y) = lhs == rhs                        implicit Curve
q(x, y) = condition                         Predicate2: shaded region   (also p(x) = condition)
Contour(g: Function2, level: Number) -> Curve
Intersect(c1, c2) -> List<Point>            curves, lines, circles, functions
Tangent(c: Curve, s: Number | P: Point) -> Line
Normal(c: Curve, s: Number | P: Point) -> Line
Length(c: Curve, a: Number, b: Number) -> Number
PointOn(c: Curve, u: Number | P0: Point) -> Point
Locus(Q: Point, P: Point) -> Curve          P made with PointOn
```

About 260 tokens.

### Tier B

```text
Locus(Q: Point, P: Point, from: Number, to: Number) -> Curve
Locus(Q: Point, a: Number, from: Number, to: Number) -> Curve
LocusEquation(Q: Point, P: Point) -> Curve
Envelope(family: Line|Segment|Ray|Circle, P: Point) -> Curve
Boundary(p: Predicate, a: Number, b: Number) -> List<Number>
PointIn(q: Predicate2, P0: Point) -> Point
Area(q: Predicate2, x0, x1, y0, y1: Number) -> Number
Curvature(c, s | P) -> Number ; OsculatingCircle(c, s | P) -> Circle ; CurvatureVector(c, s | P) -> Vector
Slope(c: Curve, s | P) -> Number ; ImplicitDerivative(c: Curve) -> Function2 ; Derivative(c: Curve [, n]) -> Curve
Closest(c: Curve, P: Point) -> Point ; PathParam(P: Point) -> Number
Bezier(pts: List<Point>) -> Curve ; Spline(pts: List<Point>[, closed=false, kind="natural"|"centripetal"]) -> Curve
Curve(pts: List<Point>) -> Curve            lowest-degree curve through n(n+3)/2 points
Asymptote(c: Curve) -> List<Line>           polynomial implicit curves
Contours(g: Function2, levels: List<Number>) -> List<Curve>
```

About 330 tokens.

### Budget

| Part | Tokens (approx.) |
|---|---|
| Rules paragraph | 110 |
| Tier A | 260 |
| Tier B | 330 |
| **Both** | **700** |

Tier B loads when the planner marks the beat `locus`, `region`, `curves`, or when the model calls `figure` with `catalogue: "curves"`. Together with the functions-calculus tiers this area keeps the always-on cost under about 600 tokens (rules plus both Tier A lists).

## 3. Results from `draw` and `figure`

| Type | `value` summary |
|---|---|
| `Curve` (parametric) | `"param s in [0, 6.283], bbox [-2, 2] x [-1, 1], closed"` |
| `Curve` (implicit) | `"x^2/4 + y^2 = 1"` (printed equation); `"pieces: 2"` after tracing |
| `Curve` (locus) | `"locus of M, 3 pieces, 412 samples, bbox [...]"` |
| `Predicate2` | `"region: x^2 + y^2 <= 4 (area in view ~12.5)"` (area from `Area` over the view, cached) |
| `Predicate` | `"x^2 > 4: x < -2 or x > 2"` (intervals from `Boundary` over the view) |
| `List<Point>` | As in the FC doc |
| `Line` | `"y = 0.8 x + 1.2"` |
| `Circle` | `"centre (1, 2) radius 2.5"` |
| Undefined / warning | As in `errors.md`, with `reason`, `detail`, `hint` |

`figure` adds for each curve its **summary** (type, range, bounding box, closed or not, number of self-intersections up to 20), which is cheap to compute and lets the model say "it crosses itself twice" correctly.

## 4. Fixing errors

The model has two retries per line. In this area the common slips and their fixes:

1. **Forgot the range.** `missing_range` names the exact append. Copy the line, add `in 0..tau`.
2. **Locus mover not on a path.** `not_a_mover` tells it to create `P = PointOn(...)`. It writes the point first, then redefines `Q`, then asks for `Locus`.
3. **Q does not use P.** `no_dependency` names what `Q` does depend on. Redefine `Q`.
4. **Wrong point count for `Curve(pts)`.** The `allowed` field gives valid counts.
5. **Implicit versus function.** If it writes `y = x^2` as a curve (a syntax error), the `hint` says: functions are `f(x) = ...`; curves are `c(x, y) = lhs == rhs`.
6. **Quoting a region by speech without checking.** The model reads `figure` for `Predicate2` before saying how big or empty it is. `empty_region` is a reason it can say aloud.

## 5. Worked lesson snippets

### Lesson 1: a parabola from "equally far from a point and a line" (locus, with an error recovery)

> "A parabola is every point that is the same distance from a fixed point, the focus, and a fixed line, the directrix. Let me set those up."

```text
d = Segment((-6, -2), (6, -2))
F = (0, 2)
```

> "Now a point that slides along the line."

```text
P = PointOn(d, 0.5)
```

> "From that point, drop a perpendicular to the line, and make the perpendicular bisector of the focus and that point. Where they meet is a point on the parabola."

```text
p = Perpendicular(P, d)
b = Bisector(F, P)
Q = Intersect(p, b)
```

`draw` returns `ok` for each line, with `Q` as `(0, 0)` (for `P = (0, -2)`).

> "Let me trace where that meeting point goes as the other point slides."

```text
loc = Locus(Q, F)
```

`draw` returns:

```json
{ "ok": false, "line": 1, "col": 15, "endCol": 16, "kind": "not_a_mover", "token": "F",
  "message": "F is not on a path, so it cannot move along one.",
  "forms": ["Locus(Q: Point, P: Point) -> Curve        P made with PointOn"],
  "hint": "Make P with P = PointOn(circle, 0.25), then give Q a rule that uses P." }
```

The model sees it typed `F` and meant `P`. It says nothing about the slip beyond "one moment" and writes:

```text
loc = Locus(Q, P)
```

`draw` returns `"locus of Q, 1 piece, 266 samples, bbox [-6, 6] x [0, 4.5]"`. The teacher says: "There: a curve that bends away from the line and wraps around the focus. That is the parabola."

> "Its equation:"

```text
eq = LocusEquation(Q, P)
```

`draw` returns `"x^2 - 8 y = 0"`. The teacher reads "x squared equals eight y" from the reported text. (For focus `(0, 2)` and directrix `y = -2` that is the correct equation, and the model may state it because `draw` reported it.)

### Lesson 2: a region from inequalities (no error; shows tri-state fill)

> "Let me show all the points inside the circle of radius two."

```text
disc(x, y) = x^2 + y^2 <= 2^2
```

> "Now only the ones above the line y equals x."

```text
half(x, y) = y > x
both(x, y) = disc(x, y) and half(x, y)
```

`draw` returns `"region: disc(x, y) and half(x, y)"`. The learner sees the half disc, the arc border solid and the diagonal border dashed.

> "The area of that half disc, in the window, is…"

```text
A = Area(both, -3, 3, -3, 3)
```

`draw` returns `"6.2832"` (half of `pi * 4 / 1`: the half-disc area is `2 pi = 6.283`); the teacher says "about six point three, which is two pi".

### Lesson 3: the envelope of a sliding ladder

> "A ladder five units long leans on a wall. Its foot slides along the floor."

```text
Pm = PointOn(Segment((0.5, 0), (4.9, 0)), 0.2)
Pf = (Pm.x, 0)
Pw = (0, sqrt(25 - Pm.x^2))
ladder = Segment(Pf, Pw)
```

> "Each position of the ladder is a line. Together they brush a curve. That curve is the envelope."

```text
env = Envelope(ladder, 0.2)
```

`draw` returns an error because the second argument is a number, not the mover point:

```json
{ "ok": false, "line": 1, "col": 22, "endCol": 25, "kind": "no_matching_form", "token": "0.2",
  "message": "Envelope has no form (Segment, Number).",
  "forms": ["Envelope(family: Line|Segment|Ray|Circle, P: Point) -> Curve"],
  "hint": "The second argument is the mover: a point made with PointOn." }
```

The model passes the mover:

```text
env = Envelope(ladder, Pm)
```

`draw` returns `"envelope, 1 piece, 604 samples"`. The teacher says: "the ladder's top edge sweeps out this curved boundary" and, from its own knowledge, may add "mathematicians call the full curve an astroid". It does not claim that the whole astroid is drawn: `figure` says 1 piece within the first quadrant, which is what a ladder can reach.

### Lesson 4: a rose by polar formula (no error, shows animation by a slider)

> "A rose curve: the radius is sine of k times the angle."

```text
k = 3 in 1..9 step 1
rose = Polar(sin(k * θ), θ, 0, tau)
```

> "Change k and count the petals."

The model calls `show_me` with `k = 5`, then reads the new `figure` summary (`closed`, `self-intersections 5`) and says "five petals". It never claims a petal count it has not read.

## 6. Tips that keep the model short and right

- Ask for `Length`, `Area`, `Intersect` only when the sentence needs the number: each result is a readout the learner will read.
- Prefer `Contour(g, k)` to many separate implicit curves when showing level sets of one function.
- Use `Boundary` for one-variable solutions to inequalities: it is the answer to "where is this true".
- For ellipses, circles and conics, the geometry commands of the core are better; use implicit curves for the general case.
- Name the mover. The learner's drag target is the mover; the model should say "drag the point P".
- Do not use `LocusEquation` on a locus that is not algebraic; the answer is a clear undefined but the learner hears nothing useful.

## 7. Streaming generation

Curves and regions are cheap to define (one line, one object). A locus plus equation takes about 3 + 4 ms. The streamed lines are applied as they arrive; the locus sits after its mover and rules. A repair call gets the failed lines with their error objects.

## Sources studied

See `design.md`. Additionally the manual pages `Locus`, `LocusEquation`, `Envelope` and `Inequalities` informed typical learner tasks and the phrasing of the lesson examples.
