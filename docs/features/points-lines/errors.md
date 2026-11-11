# Points, lines, vectors, intersections and measures: errors

Error objects follow core design section 9. Definition-time problems are **errors** (the line changes nothing). Runtime problems are **undefined values with a reason** (the line commits). This file lists both, and the new reasons this area adds. Reasons and notes are shared by `conics` and `polygons-transforms`; those folders list their own additions.

## 1. How the reference app handles these

- Parse failures of a geometry line collapse to one generic message with no position.
- Wrong operand types on a command give "illegal argument" plus the list of that command's syntaxes, but no position and the dialog appears in the UI.
- Two parallel lines, a missing intersection, a zero-length segment, all simply make the output undefined. The learner sees nothing (the point disappears) and gets no reason.
- Near-parallel and near-tangent input are not reported. The tolerance ladder in line-conic intersection can accept a worse answer after the first attempt failed, silently.
- A locus whose tracer does not depend on the mover produces a single point with no message.
- Intersect index too large: the output is undefined; no message.
- Redefining a point to depend on itself raises a "circular definition" error without naming the cycle.

## 2. How we do it

1. **Check time catches what it can.** Anything knowable from types, literal numbers and the dependency graph is an error with a position: unknown names, wrong forms, literal index out of range, a locus without dependency, cycles, impossible literal arguments (regular polygon with 2 sides).
2. **Runtime is a reason, never an exception.** Reasons are short snake_case codes with a one-line explanation in the catalogue so the teacher can speak them.
3. **Every undefined object reports its reason and the nearest cause.** `figure` and the after-line report list `{name, reason, because}` where `because` names the input that triggered it ("a and b are parallel").
4. **Defined but fragile values carry notes**, not errors.
5. **Recovery.** Every error has a `hint` that is a concrete next line or a form to use; the teacher retries at most twice (core design).

## 3. Definition-time errors

All have `ok: false`, `line`, `col`, `endCol`, `token`, `message`, `expected`, `forms`, `hint`. New or area-specific `kind`s are marked **new**.

| kind | When | hint pattern |
|---|---|---|
| `syntax` | Core | |
| `unknown_name` | `Perpendicular(P, lin)` where `lin` does not exist | "Did you mean `line1`?" |
| `unknown_command` | `Perpendicualr(…)` | closest names |
| `no_matching_form` | `Line(A)`, `Bisector(A, B, 3)` | all forms of the command |
| `type_mismatch` | `u * v` with two vectors, `A + B` with two points | "Use `Dot(u, v)` for the scalar product, `Cross(u, v)` for the signed area" or "Use `Midpoint(A, B)`, or `A + (B - A)/2`" |
| `unnamed_object` | `Intersect(a, b)` alone | "Name it: `P = Intersect(a, b)`" |
| `cycle` | `A = Midpoint(A, B)` | names the loop: "A depends on A" |
| `bad_argument` **new** | A literal or statically known argument is invalid for the form | see below |
| `no_dependency` **new** | `Locus(Q, P)` where `Q` does not depend on `P` | "Make Q depend on P, for example by building it from P." |
| `not_a_path` **new** | `PointOn(x, …)` where `x` is a Number, Text, Point | "PointOn needs a line, segment, circle, conic, polygon, function or curve." |
| `not_a_region` **new** | `PointIn(circleLine)` where the argument has no interior | "Use a polygon, circle, ellipse or sector." |
| `limit` | Core: 64-result truncation is a note, not this error; `limit` is for >5000 points in a list passed to `Barycenter` or similar | |

`bad_argument` is **new** and generic across the three geometry folders:

```json
{
  "ok": false, "line": 3, "col": 24, "endCol": 25,
  "kind": "bad_argument",
  "token": "3",
  "param": "index",
  "message": "Intersect of a line and a circle has at most 2 points; index 3 is out of range.",
  "expected": ["1", "2"],
  "forms": ["Intersect(a: LineLike, b: Circle, index: Number) -> Point"],
  "hint": "Use 1 or 2, or Intersect(a, b) to get the list."
}
```

### 3.1 Examples

```json
{
  "ok": false, "line": 5, "col": 5, "endCol": 20,
  "kind": "unnamed_object", "token": "Intersect",
  "message": "Intersect(a, b) makes a point, so it needs a name.",
  "expected": ["Name = Intersect(…)"],
  "forms": [],
  "hint": "Write P = Intersect(a, b)."
}
```

```json
{
  "ok": false, "line": 2, "col": 16, "endCol": 17,
  "kind": "type_mismatch", "token": "*",
  "message": "A vector times a vector has no single meaning.",
  "expected": [],
  "forms": ["Dot(u: Vector, v: Vector) -> Number", "Cross(u: Vector, v: Vector) -> Number"],
  "hint": "Use Dot(u, v) for the scalar product or Cross(u, v) for the signed area."
}
```

```json
{
  "ok": false, "line": 7, "col": 1, "endCol": 28,
  "kind": "no_dependency", "token": "Locus",
  "message": "Locus(Q, P): Q does not depend on P, so its locus is one point.",
  "expected": [],
  "forms": ["Locus(tracer: Point, mover: Point) -> Curve", "Locus(tracer: Point, s: Number, from: Number, to: Number) -> Curve"],
  "hint": "Build Q from P (for example Q = Midpoint(P, B)), then repeat."
}
```

```json
{
  "ok": false, "line": 4, "col": 15, "endCol": 21,
  "kind": "not_a_path", "token": "radius",
  "message": "PointOn needs something a point can ride; radius is a Number.",
  "expected": ["Line", "Segment", "Ray", "Circle", "Conic", "Arc", "Polygon", "Function", "Curve"],
  "forms": ["PointOn(path, param: Number) -> Point", "PointOn(path) -> Point"],
  "hint": "Did you mean PointOn(c, 0.5) with c a circle?"
}
```

## 4. Undefined reasons (runtime)

A value is `{ undefined: true, reason, because? }`. Reasons used by this area (shared names are used by the other folders too):

| reason | Meaning | Commands | Teacher can say |
|---|---|---|---|
| `parallel` | Directions are parallel, no common point | Intersect(line-like pair), Bisector(L1, L2) second slot | "these never meet" |
| `coincident` | Infinitely many common points | Intersect(identical lines or conics), Bisector of identical lines | "these are the same line" |
| `no_intersection` | Real solution does not exist | Intersect(line, circle) when the line misses | "the line misses the circle" |
| `outside_path` | The carriers meet but not within the limited object | Intersect with segment, ray, arc, polygon | "they would meet if the segment were longer" |
| `too_far` | Result beyond `tol.far` | Intersect of near-parallel lines | "the meeting point is off the page" |
| `zero_length` | Segment, vector or arm has zero length | Perpendicular(Point, Segment), Angle, UnitVector, Direction | |
| `coincident_points` | Two defining points are the same | Line(A, A), Bisector(A, A) | |
| `collinear` | Three points on one line where a triangle is needed | TriangleCenter, Circle(A,B,C) | "A, B and C are on a line" |
| `not_collinear` | Points not on one line where a ratio needs it | AffineRatio, CrossRatio | |
| `vertical` | Slope of a vertical line | Slope | "a vertical line has no slope" |
| `inside` | Point lies inside a conic where an outside point is needed | Tangent, Polar-based | |
| `division_by_zero`, `not_finite`, `out_of_domain` | Core | | |
| `no_root`, `no_convergence` | Function intersection found nothing, or Newton failed | Intersect(f, g, …), Closest(function, P) | |
| `undefined_input` | An input is undefined | any | "because B is undefined" |

`because` names the immediate cause: the failing input's name (for `undefined_input`) or the pair that triggered it (`"a, b"` for `parallel`).

### 4.1 Examples (as returned by `figure`)

```json
{ "name": "P", "type": "Point", "undefined": true, "reason": "parallel", "because": "a, b" }
```

```json
{ "name": "Q", "type": "Point", "undefined": true, "reason": "outside_path", "because": "s ends at x = 3; the meeting point is at x = 4.2" }
```

```json
{ "name": "T", "type": "List<Point>", "value": "[(1.2, 0.5), undefined]", "notes": [] }
```

## 5. Notes on defined values

| note | Meaning |
|---|---|
| `tangent` | The solution is a double root (touching) |
| `ill_conditioned` | Input is nearly degenerate (lines nearly parallel). Value is correct to the shown digits minus the condition number's digits |
| `sampled` | Found by sampling and refinement (curves, conic fall-back); a double contact could be missed |
| `clamped` | A point was pushed back inside its region or onto its path |
| `overlap` | A line shares a segment with an edge |
| `truncated` | A list was cut at its cap |

Example from `draw`:

```json
{ "ok": true, "line": 3, "name": "P", "type": "Point", "value": "(14.2, 0.01)", "notes": ["ill_conditioned"],
  "summary": "P is 14 units away because a and b are almost parallel." }
```

## 6. Numeric limits

| Case | Behaviour |
|---|---|
| Inputs ≥ 1e150 in magnitude | `not_finite`; never `Infinity` stored |
| Result beyond 1e14 | `too_far` |
| Polygon intersect with more than 5,000 edges | note `truncated`, first 5,000 edges used |
| Locus above 4,000 samples | refinement stops, note `truncated` |
| Function-intersection scan finds more than 64 roots | first 64 by x, note `truncated` |
| Newton in `near` form not converged in 50 steps | `no_convergence` |
| Conic × conic validation fails after fall-back | `no_convergence` and note `sampled` is absent |

Limits are budget errors (`limit`) only when they stop the line from being applied (size of a literal list, for example). Everything computed at runtime degrades to a note or reason.

## 7. Recovery patterns the model uses

| Failure | Next line |
|---|---|
| `unnamed_object` | add `Name =` |
| `no_matching_form` for `Segment(A, B, C)` | remove an argument, or use `Polygon` |
| `type_mismatch` for `A + B` (two points) | `Midpoint(A, B)` or `A + Vector(A, B)/2` |
| `bad_argument` index | drop the index and use the list: `L = Intersect(a, b)` |
| `not_a_path` | create the missing object first, then retry |
| undefined `parallel` | ask the learner which line to move, or `Hide` the point; do not retry |
