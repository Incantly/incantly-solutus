# Curves, inequalities, loci and envelopes: errors

Follows section 9 of the core design and `docs/features/functions-calculus/errors.md` (the shared fields `param`, `got`, `allowed`; undefined carries `reason`, `detail`, `hint`). Line errors come back from `draw` and change nothing. Runtime problems make a value undefined or attach a `warning`.

## 1. Line errors

### Parse and shape

| Kind | Situation | Fields and hint |
|---|---|---|
| `syntax` | `c(s) = (cos(s), )` | `expected: ["expression"]` at the closing bracket |
| `syntax` | `q(x, y) = x^2 + y^2 <` | `expected: ["expression"]` |
| `syntax` | `c(s) = (cos(s), sin(s)) in 0..` | `expected: ["expression"]` |
| `syntax` | `1 < x > 3` | Hint: both signs must lean the same way, or use `and` |
| `missing_range` | `c(s) = (cos(s), sin(s))` | `message: "A parametric curve needs a range."` `hint: "Add in 0..tau."` Position at the end of the line |
| `bad_argument` | `Curve(pts)` with 6 points | `param: "pts"`, `got: "6 points"`, `allowed: "n(n+3)/2 points: 5, 9, 14, 20"`, hint "Pass 5 points for a conic, 9 for a cubic" |
| `bad_argument` | `Spline(pts, kind = "cosine")` | `allowed: ["natural", "centripetal"]` |
| `bad_argument` | `Polar(r, θ, 0, 0)` or an empty range `in 3..1` | Hint: ranges run low to high; for a reverse path use `a + b − s` in the formula |
| `unknown_name` | `Polar(sin(2 t), θ, 0, tau)` where `t` is not bound | Hint "The angle is θ in this command" |

### Type and forms

| Kind | Situation | Fields and hint |
|---|---|---|
| `no_matching_form` | `Tangent(c, 1, 2)`; `Locus(Q)`; `Envelope(L)` | `forms` lists the forms of the command, ordered by closeness |
| `type_mismatch` | `Derivative(c)` where `c` is implicit | Message says derivatives of implicit curves are `ImplicitDerivative`; `hint: "ImplicitDerivative(c) gives dy/dx as a function of x and y."` |
| `not_a_mover` | `Locus(Q, P)` where `P` is a free point, not on a path | `message: "P is not on a path, so it cannot move along one."` `hint: "Make P with PointOn(path, 0.3) and give Q a rule that uses P."` |
| `no_dependency` | `Locus(Q, P)` where `Q` does not depend on `P` | `message: "Q does not depend on P, so its locus is a single point."` Hint names the objects Q depends on |
| `unsupported_family` | `Envelope(c, P)` where the family is a parametric or implicit curve; `Asymptote(c)` on a non-polynomial implicit curve | `hint: "Envelope supports lines, segments, rays and circles. If you know the contact point, Locus of that point is the envelope."` |
| `limit` | `Locus(Q, P, 0, 1e9)`; `Bezier` of more than 12 points; `Contours` of more than 50 levels; `Curve` with an expression of more than 400 nodes | `allowed` gives the maximum |
| `wrong_arity` | `c(1, 2)` where `c` is a one-parameter `Curve` | Core style |
| `cycle` | A locus that depends on itself (`Q` defined from `loc`) | Core rule |
| `type_change` | Redefining a `Curve` line as a `Function` | Core rule |

### Notes

- A define-line whose right-hand side is `==` over real operands with only one parameter (`c(x) = x^2 == 4`) describes isolated numbers, not a curve, so it is rejected: `bad_argument`, `message: "x^2 == 4 describes isolated numbers, not a curve."`, `hint: "Use Roots for the solutions, or write c(x, y) = ... for a curve in the plane."`
- `c(s) = (f(s), g(s))` with a function-valued result that mixes a `Number` and a `Point` is `type_mismatch` with the position of the offending component.

## 2. Undefined values and warnings

| `reason` | Where | Meaning | `hint` |
|---|---|---|---|
| `curve_undefined_at_param` | `Tangent`, `PointOn`, ... | The curve is not defined at that parameter (a formula returned a non-finite value) | "c is defined for s from 0 to 1" |
| `out_of_range` | `PointOn(c, u)` etc. | A parameter or `u` is outside its range (`u` is clamped to 0..1 for `PointOn`, so this only occurs for `Tangent(c, s)` with `s` outside `[a, b]`) | |
| `singular_point` | `Tangent`, `Slope`, `Normal` | Velocity or gradient is zero here | "c has a cusp at s = 0; use a nearby parameter" |
| `infinite_radius` | `OsculatingCircle` | Curvature is zero | "The curve is straight here; Tangent(c, s) is the best fit" |
| `no_intersection` | `Intersect` with an index form | Fewer intersections than the index | "The curves meet in 2 points, not 3" |
| `not_on_curve` | `Tangent(c, P)` for an implicit curve | The point is not on the curve and could not be projected within the tolerance | "P is 0.4 from the curve. Use Closest(c, P)." |
| `degenerate_points` | `Curve(pts)`, `LocusEquation` | The data does not determine one curve | "Points lie on more than one conic. Add more points" |
| `no_algebraic_equation` | `LocusEquation` | No polynomial of degree ≤ 8 fits | "The locus may involve sin, exp, or integrals; Locus draws it, but it has no polynomial equation" |
| `no_dependency` | `Locus` | Rule changed so Q no longer depends on P | |
| `empty_region` | `Area`, `PointIn` | The predicate is false everywhere in the window | "No point of the window satisfies q" |
| `unbounded` | `Length(c)` | The curve's range or length is infinite | "Give a finite range with Length(c, a, b)" |
| `diverges` | `Length` | Arc length integral does not converge | Shared with FC |
| `not_finite`, `input_undefined`, `step_limit` | any | Shared with FC | |
| `identically_zero` | `ImplicitDerivative` | `F_y` is identically zero | |

**Warnings** (value is defined; `warning: {reason, detail, hint}` is reported by `draw` and `figure`):

| `reason` | Where | Meaning |
|---|---|---|
| `sample_cap` | Locus, envelope | The sample cap was reached; the curve is the best available |
| `identically_true` | Implicit `F == G` with `F − G ≡ 0`, a predicate that is true everywhere | The whole plane satisfies it; nothing is drawn |
| `tangent` | `Intersect` | A returned point is a tangential (double) intersection |
| `partial_algebraic` | `LocusEquation` | A degree was found but the sample covered a short arc; verification passed on held-out points of that arc only |
| `rigorous_false` | Roots/tracer fallback | Not interval-evaluable body: result is by sampling (shared with FC) |
| `gap` | Locus, `Curve` | The curve has a gap (undefined stretch); `detail` gives the parameter range |

**Not found is not an error.** `Intersect(c1, c2)` with no intersections returns `[]`; an implicit curve with no real points is a valid empty curve.

## 3. How the reference app handles these

- Parse failures: one generic message, no position.
- A parametric curve with an undefined sample is split to find defined parts; the result is a curve with gaps and no message.
- Implicit curves: coarse grid; thin features are silently missed; the drawing has a work meter and a wall-clock cutoff after which it gives up (nothing says so). Singular points are flagged internally by a small-gradient test.
- Inequality types outside the supported list are accepted in the algebra list and silently not drawn.
- Locus: each step has a time allowance; a step that exceeds it is skipped. If the mover is not on a path the command fails with its generic "illegal argument" style message. A construction that leaves its domain leaves a gap.
- Envelope and locus equation: when the construction does not give an algebraic system the result is undefined (no reason); the manual says so in prose.

## 4. How we do it better

1. Static mistakes (`missing_range`, `not_a_mover`, `no_dependency`, `bad_argument`) fail at the line with a named fix.
2. Every undefined has a code, a spoken sentence, and a next step.
3. No timeouts or clocks anywhere: the same figure fails or succeeds the same way on every machine.
4. Gaps and caps are warnings the teacher can read, not silent.
5. Inequalities are never silently skipped: either drawn or `limit`-rejected with a reason (for example a body of more than 400 nodes).
6. A locus built on a point that is not a mover says so at once, with the command that makes one.

## 5. Example error objects

Missing range:

```json
{
  "ok": false,
  "line": 2,
  "col": 27,
  "endCol": 27,
  "kind": "missing_range",
  "token": "",
  "message": "A parametric curve needs a range for s.",
  "expected": ["in a..b"],
  "forms": ["c(s) = (x(s), y(s)) in a..b", "Curve(x(s), y(s), s, a, b) -> Curve"],
  "hint": "Append in 0..tau for one full turn."
}
```

Locus of a point that does not move:

```json
{
  "ok": false,
  "line": 6,
  "col": 15,
  "endCol": 16,
  "kind": "not_a_mover",
  "token": "P",
  "message": "P is not on a path, so it cannot move along one.",
  "expected": [],
  "forms": [
    "Locus(Q: Point, P: Point) -> Curve        P made with PointOn",
    "Locus(Q: Point, P: Point, from: Number, to: Number) -> Curve",
    "Locus(Q: Point, a: Number, from: Number, to: Number) -> Curve"
  ],
  "hint": "Make P with P = PointOn(circle, 0.25), then give Q a rule that uses P."
}
```

Locus of a point that does not depend on the mover:

```json
{
  "ok": false,
  "line": 7,
  "col": 12,
  "endCol": 13,
  "kind": "no_dependency",
  "token": "Q",
  "message": "Q does not depend on P, so its locus would be a single point.",
  "expected": [],
  "forms": [],
  "hint": "Q depends on A and B. Build Q from P, for example Q = Midpoint(P, A)."
}
```

Wrong number of points:

```json
{
  "ok": false,
  "line": 3,
  "col": 14,
  "endCol": 17,
  "kind": "bad_argument",
  "token": "pts",
  "message": "Six points do not fix one curve of low degree.",
  "param": "pts",
  "got": "6 points",
  "allowed": "5 (conic), 9 (cubic), 14 (quartic)",
  "expected": [],
  "forms": ["Curve(pts: List<Point>) -> Curve   n(n+3)/2 points for degree n"],
  "hint": "Remove one point for a conic or add three for a cubic."
}
```

Unsupported family:

```json
{
  "ok": false,
  "line": 9,
  "col": 22,
  "endCol": 23,
  "kind": "unsupported_family",
  "token": "c",
  "message": "Envelope handles lines, segments, rays and circles. c is a parametric Curve.",
  "expected": [],
  "forms": ["Envelope(family: Line|Segment|Ray|Circle, P: Point) -> Curve"],
  "hint": "If you know the point where each member touches the envelope, use Locus of that point."
}
```

An undefined tangent at a cusp:

```json
{
  "ok": true,
  "line": 5,
  "name": "T",
  "type": "Line",
  "value": null,
  "undefined": {
    "reason": "singular_point",
    "detail": "The curve has zero speed at s = 0 (a cusp).",
    "hint": "Move s slightly: Tangent(c, 0.1)."
  }
}
```

A locus equation failure:

```json
{
  "ok": true,
  "line": 12,
  "name": "eq",
  "type": "Curve",
  "value": null,
  "undefined": {
    "reason": "no_algebraic_equation",
    "detail": "No polynomial of degree 8 or less vanishes on 600 points of this locus.",
    "hint": "The locus uses sin or a similar function. Locus(Q, P) still draws it."
  }
}
```

A warning on a gapped locus:

```json
{
  "ok": true,
  "line": 8,
  "name": "loc",
  "type": "Curve",
  "value": "2 pieces, bbox [-4, 4] x [-3, 3]",
  "warning": {
    "reason": "gap",
    "detail": "Q is undefined for P between 0.31 and 0.69 of the circle (the lines are parallel).",
    "hint": "That is expected; the locus is in two pieces."
  }
}
```

## 6. Recovery patterns

| Error | Next line the model writes |
|---|---|
| `missing_range` | Same line with `in 0..tau` (or the range the hint gives) |
| `not_a_mover` | `P = PointOn(path, 0.3)` first, redefine `Q` with a rule using `P`, then `Locus` |
| `no_dependency` | Redefine `Q = ...P...` |
| `bad_argument` on point counts | Change the list size |
| `unsupported_family` | Use `Locus` of the contact point or describe in words |
| Undefined with `gap` | Mention the gap; do nothing |
| `no_algebraic_equation` | Say it has no polynomial equation; keep `Locus` |

## Sources studied

Removed before the repository was made public. The study notes above are in our own words.
