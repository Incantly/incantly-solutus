# Circles, arcs, sectors and conics: errors

Error object format: core design section 9 (`ok`, `line`, `col`, `endCol`, `kind`, `token`, `message`, `expected`, `forms`, `hint`). Generic kinds (`syntax`, `unknown_name`, `no_matching_form`, `type_mismatch`, `cycle`, `unnamed_object`) are shared with `points-lines/errors.md`; the shared `bad_argument` kind (with `param`) and the shared undefined reasons and notes are defined there. This file lists what conics add.

## 1. How the reference app handles these

- A typed equation that is not a conic (degree 3) becomes a different object (an implicit curve) or fails with a generic message. Equation input is parsed by a guessing step: an equation can become a line, a conic, a function or an implicit curve, depending on its shape.
- Impossible constructors (ellipse whose major axis is too short) silently become the other type (a hyperbola), which is surprising in a lesson.
- Degenerate results (circle through three collinear points, conic through five points with four collinear) are simply undefined with no explanation.
- A tangent from an inside point: undefined, nothing shown.
- Wrong operand kind for a property (`Radius` of an ellipse, `Directrix` of a circle): undefined or a wrong value for the nearest type.
- Numerical misclassification near a parabola: no signal.

## 2. How we do it

1. Everything knowable at check time is an error with position: equation degree, non-polynomial terms, a literal list of the wrong length.
2. Everything depending on values is an undefined reason with a `because` string that states the numbers ("2a = 3 is less than the focus distance 4").
3. Types do not change silently. Wrong-kind property access says what kind the conic is.
4. Near-boundary results carry notes.

## 3. Definition-time errors

New kinds are marked **new**.

| kind | When | hint |
|---|---|---|
| `not_quadratic` **new** | `Conic(x^3 + y == 1)`: degree above 2 | "This has a cubic term. Use `Curve(x^3 + y == 1)` for a general curve." |
| `not_polynomial` **new** | `Conic(sin(x) + y == 0)`: `x` or `y` inside a function | "Conic needs x and y only in sums, products and powers." |
| `bad_equation` **new** | `Conic(x^2 + y^2)` (not an equation), `Conic(x^2 = 4)` (single `=`, core design makes this a define) | "Write `==`: `Conic(x^2 + y^2 == 4)`." |
| `bad_argument` | `Conic(1, 2, 3)` wrong count of numbers; literal `Circle(A, -2)` | "Conic takes six numbers: A, B, C, D, E, F for A x² + B xy + C y² + D x + E y + F = 0." |
| `no_matching_form` | Wrong shape of arguments | all forms |
| `type_mismatch` | `Focus(P)` with a point | |
| `unnamed_object` | `Circle(O, 2)` alone | "Name it: `c = Circle(O, 2)`." |

```json
{
  "ok": false, "line": 3, "col": 7, "endCol": 28,
  "kind": "not_quadratic", "token": "x^3 + y == 1",
  "message": "x^3 + y == 1 has a cubic term, so it is not a conic.",
  "expected": [],
  "forms": ["Conic(equation: Bool) -> Conic", "Curve(equation: Bool) -> Curve"],
  "hint": "Use Curve(x^3 + y == 1) for a general curve."
}
```

```json
{
  "ok": false, "line": 2, "col": 1, "endCol": 18,
  "kind": "bad_equation", "token": "Conic(x^2 = 4)",
  "message": "Inside Conic(...) a single = is a definition, not an equation.",
  "expected": ["=="],
  "forms": ["Conic(equation: Bool) -> Conic"],
  "hint": "Write Conic(x^2 + y^2 == 4)."
}
```

```json
{
  "ok": false, "line": 5, "col": 20, "endCol": 21,
  "kind": "bad_argument", "token": "5",
  "param": "list",
  "message": "A conic list needs six numbers, found 5.",
  "expected": ["[A, B, C, D, E, F]"],
  "forms": ["Conic(coeffs: List<Number>) -> Conic"],
  "hint": "A x² + B x y + C y² + D x + E y + F = 0: give all six, using 0 for missing terms."
}
```

## 4. Undefined reasons (runtime)

Shared reasons from `points-lines` apply (`coincident_points`, `collinear`, `no_intersection`, `outside_path`, `undefined_input`, `division_by_zero`, `not_finite`, `too_far`). New for conics:

| reason | Meaning | Commands |
|---|---|---|
| `negative_radius` | Radius below 0 | `Circle(C, r)`, `Arc(C, r, …)`, `Sector` |
| `too_short` | Major axis not longer than the distance between the foci | `Ellipse(F1, F2, a)` |
| `too_long` | Transverse axis not shorter than the distance between the foci | `Hyperbola(F1, F2, a)` |
| `non_positive` | A length that must be positive is not | `Hyperbola(F1, F2, 0)`, `Ellipse(F1, F2, 0)` |
| `focus_on_directrix` | The focus lies on the directrix | `Parabola` |
| `degenerate_conic` | The conic is all zero (`0 = 0`) or the needed matrix is singular | `Conic(0,…,0)`, `Pole`, tangents |
| `degenerate_points` | The five points do not fix one conic | `Conic(P1…P5)` |
| `wrong_kind` | Property asked of the wrong kind of conic; `because` names the kind | `Radius`, `Focus`, … |
| `not_circle` | `Radius`, `Arc` start of a non-circle where only a circle works | `Radius` |
| `not_hyperbola` | `Asymptote(conic)` of a non-hyperbola | `Asymptote` |
| `no_center` | Parabola has no centre | `Center` |
| `no_directrix` | Circle has no directrix | `Directrix` |
| `unbounded` | Area or length of an unbounded conic | `Area`, `Circumference` |
| `inside` | Point inside the conic: no tangent | `Tangent(P, c)` |
| `on_conic` | Only one tangent exists (point on the conic): the second slot | `Tangent` |
| `no_tangent` | No tangent line of that direction | `Tangent(l, c)` |
| `at_infinity` | The answer is a point or line at infinity | `Pole`, `Tangent(P, hyperbola)` |
| `straight` | Zero curvature (a line, an inflection) | `OsculatingCircle` |
| `singular_point` | The curve's gradient vanishes | `Curvature` |
| `no_convergence` | Iteration failed | `Closest` on a curve |

Examples as `figure` lists them:

```json
{ "name": "e", "type": "Conic", "undefined": true, "reason": "too_short",
  "because": "2a = 3 is not more than the distance between the foci, 4" }
```

```json
{ "name": "T", "type": "List<Line>", "value": "[undefined, undefined]",
  "undefined": true, "reason": "inside", "because": "P is inside c" }
```

```json
{ "name": "r", "type": "Number", "undefined": true, "reason": "wrong_kind", "because": "c is an ellipse; Radius needs a circle" }
```

```json
{ "name": "c", "type": "Conic", "value": "ellipse", "notes": ["near_boundary:parabola"] }
```

## 5. Notes specific to conics

| note | Meaning |
|---|---|
| `near_boundary:K` | The conic is within `1e-6` (relative) of kind `K`, so a small change will switch kind |
| `projected` | A curvature or tangent was evaluated at the nearest curve point, not at the given point |
| `asymptote` | A conjugate diameter or tangent direction is an asymptote |
| `ill_conditioned` | Five points almost dependent, three points almost collinear, near-flat ellipse |

## 6. Numeric failure and limits

| Case | Behaviour |
|---|---|
| Quartic or monotone solve for closest point does not reach 1e-14 in 50 steps | `no_convergence` (never happens for ellipses: bracketed monotone function; documented for hyperbola/curve) |
| Five-point SVD does not converge in 30 sweeps | `no_convergence` |
| Coefficients ≥ 1e150 | `not_finite` |
| Asymptote scan over a function finds more than 32 poles | first 32, note `truncated` |
| Arc length integral needs more than 64 intervals | value returned, note `sampled` |
| Equation expansion creates more than 256 terms | `limit` (check time) |

## 7. Recovery patterns the model uses

| Failure | Next line |
|---|---|
| `too_short` | Increase `a`, or switch the command to `Hyperbola`, or move the foci closer |
| `inside` | Move the point outside (`show_me`), or `Hide` the tangent line |
| `wrong_kind` | Use a command for the kind the `because` names (`SemiMajor` instead of `Radius`) |
| `not_quadratic` | Use `Curve(equation)` |
| `bad_equation` | Replace `=` with `==` |
| `degenerate_points` | Move one point off the common line |
| `negative_radius` | Make the slider start at 0 or use `abs` |
