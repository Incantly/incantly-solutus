# Geometry area: test report (tester, step 2)

Branch `feat/geometry`. Tests are in `packages/kernel/test/spec/geometry/` (`helpers.ts` plus 8 test files). They register the geometry commands with `geometry.registerGeometry(registry)`, build `new Figure({ commands: registry })`, and drive every case through `figure.apply(line)`, `cellOf`, `setFree`, `dragPlan`/`drag`. No source file was changed.

## Result

| | |
|---|---|
| Tests | 493 |
| Pass | 432 |
| Fail | 61 |
| Run time | about 1 s for the whole folder |
| `npx eslint packages/kernel/test/spec/geometry` and `npx tsc -p tsconfig.json` | clean |

Time limits: every file sets `vi.setConfig({ testTimeout: 5000 })`. A rule stuck in a synchronous loop cannot be interrupted by vitest; the speed tests also assert a wall-clock budget (`expectFast`). No test hung in this run.

## Pass / fail by doc section

Doc paths are under `docs/features/`.

| Test file: group | Doc section | Tests | Fail |
|---|---|---|---|
| points: Midpoint | points-lines design 1.1 | 6 | 0 |
| points: Vertex (segment, ray) | points-lines design 1.1; errors 3 | 3 | 1 |
| points: Barycenter, Centroid, Trilinear | points-lines design 5.4 | 5 | 0 |
| points: TriangleCenter 1 to 13 | points-lines design 5.4 | 15 | 2 |
| points: FromPolar, ToPolar | points-lines design 1.1 | 4 | 0 |
| points: Closest | points-lines design 5.5 | 8 | 0 |
| points: PointOn, Along, ParamOf | points-lines design 3.2, 6.1 to 6.3; conics design 3.5; errors 3 | 19 | 9 |
| points: PointIn | points-lines design 6.4; errors 3 | 5 | 1 |
| points: RandomIn | points-lines design 6.5 | 6 | 0 |
| lines: Line, Segment and Ray | points-lines design 1.1 | 10 | 0 |
| lines: Vector, operators | points-lines design 1.1, 13.6; errors 3 | 6 | 1 |
| lines: Direction, Normal | points-lines design 5.2 | 6 | 1 |
| lines: Perpendicular, Parallel | points-lines design 5.1 | 12 | 0 |
| lines: Bisector | points-lines design 5.3 | 13 | 0 |
| lines: Unit/Perp vectors | points-lines design 1.1, 5.2 | 7 | 1 |
| lines: Dot, Cross, Length | points-lines design 1.1, 7 | 6 | 0 |
| lines: names, kinds, cycles | points-lines errors 3; kernel rulings K2; language rulings Q5 to Q7 | 7 | 0 |
| intersect: line with line | points-lines design 3.5, 4.2, 10.1 | 12 | 3 |
| intersect: line with circle | points-lines design 4.3 | 12 | 0 |
| intersect: line with other conics | points-lines design 4.3 | 4 | 1 |
| intersect: circle with circle | points-lines design 4.4 | 8 | 0 |
| intersect: conic with conic | points-lines design 4.4 | 9 | 1 |
| intersect: polygons, polylines | points-lines design 4.5 | 7 | 0 |
| intersect: functions | points-lines design 4.6 | 11 | 2 |
| intersect: speed, determinism | points-lines design 10.6, 10.7 | 2 | 0 |
| measures: Distance | points-lines design 5.5, 7 | 10 | 0 |
| measures: Slope | points-lines design 7 | 9 | 0 |
| measures: Angle | points-lines design 7 | 10 | 1 |
| measures: AffineRatio, CrossRatio | points-lines design 5.6 | 5 | 0 |
| measures: Relation | points-lines design 7 | 5 | 1 |
| measures: predicates | points-lines design 1.1, 3.3; polygons-transforms design 3.2 | 17 | 0 |
| measures: Locus | points-lines design 8; errors 3 | 6 | 4 |
| conics: circles | conics design 4.1 | 10 | 1 |
| conics: arcs, sectors | conics design 4.5, 4.6 | 15 | 0 |
| conics: Ellipse, Hyperbola, Parabola | conics design 4.2 | 10 | 0 |
| conics: Conic from numbers, list, points, equation | conics design 3.3, 4.3, 4.4; errors 3 | 26 | 6 |
| conics: properties | conics design 5 | 12 | 1 |
| conics: areas, lengths | conics design 4.6 | 4 | 0 |
| tangents: Tangent (point) | conics design 6.2 | 8 | 2 |
| tangents: Tangent (line, conic) | conics design 6.3, 6.4 | 8 | 0 |
| tangents: Polar, Pole, ConjugateDiameter | conics design 6.1, 6.5 | 8 | 0 |
| tangents: Asymptote, IsTangent | conics design 6.6, 6.7 | 6 | 3 |
| tangents: curvature | conics design 7 | 6 | 2 |
| polygons: constructors | polygons-transforms design 3.4; errors 3 | 14 | 3 |
| polygons: Vertex, Side | polygons-transforms design 3.4; errors 3, 4 | 7 | 3 |
| polygons: measures | polygons-transforms design 3.2, 10 | 12 | 1 |
| polygons: Rigid | polygons-transforms design 5 | 4 | 1 |
| polygons: boolean operations, IntersectPath | polygons-transforms design 4.1 to 4.4 | 15 | 2 |
| transforms: Translate | polygons-transforms design 6.4 | 3 | 0 |
| transforms: Rotate | polygons-transforms design 6.2, 6.3 | 7 | 0 |
| transforms: Reflect, inversion | polygons-transforms design 6.4, 6.5, 10; errors 3 | 12 | 4 |
| transforms: Dilate | polygons-transforms design 6.4, 10 | 4 | 0 |
| transforms: Shear, Stretch | polygons-transforms design 6.4 | 7 | 0 |
| transforms: ApplyMatrix | polygons-transforms design 6.5, 8.7 | 8 | 0 |
| transforms: progress | polygons-transforms design 8.5 | 5 | 0 |
| transforms: Transform values | polygons-transforms design 8.6; errors 3 | 10 | 1 |
| transforms: images, functions, live | polygons-transforms design 6.5, 6.7, 7 | 7 | 2 |
| **Total** | | **493** | **61** |

## Failing tests, with the doc line each one checks

Fail messages are quoted from the run. "Check time" means the doc says the error is raised when the line is checked (the line must be refused); the code accepts the line and gives an undefined value instead.

### Intersect and points on paths

1. `Vertex(s, 3)` on a segment: a literal index out of range must be a `bad_argument` error. Got a defined line, undefined `index_out_of_range`. Doc: points-lines errors 3 (`bad_argument`); design 3.5 ("A literal `k` outside the form's range is a check-time error").
2. `Intersect(l, m, 2)` (line, line) and `Intersect(l, m, 0)`: same rule, same result. Doc: points-lines design 3.5; errors 3 example. Two tests.
3. Lines with sine 1e-9 whose meeting point is at x = 1e15: expected `too_far`, got `parallel`. Doc: points-lines design 4.2 step 4, 10.1 (parallel only at sine at most 1e-12).
4. `Intersect(line, Conic(x^2 - y^2 == 0))`: one point instead of two. Doc: points-lines design 4.3 "Degenerate conic: intersect with each line".
5. Circle with ellipse: slots start at 207 degrees, expected 27, 153, 207, 333 degrees (counter-clockwise from +x). Doc: points-lines design 4.4 "Canonical order for four slots".
6. `Intersect(sin, cos)` with no interval: got an empty list, expected a `no_matching_form` error ("needs an interval for non-polynomial functions"). Doc: points-lines design 4.6.
7. `1 + cos(x)` against the x axis on 0.5..5: no root found, expected the touching root at pi. Doc: points-lines design 4.6 "Tangential roots".
8. `Tangent(Q, c)[1]` intersected with the circle gives `no_intersection` (twice: the `T[1]` test in tangents and the "equal tangent lengths" test). Expected the touching point. Doc: points-lines design 4.3 "Tangency", 10.3; conics design 6.2 step 6. One failing test (tangent lengths); the contact-point test with P on the circle passes.
9. `PointOn(line, 0.75)` on a line through (0,0),(4,0): got x = 1, expected x = 4. `PointOn(ray, 0.5)`: got x = 1, expected 4. Doc: points-lines design 3.2 (parameter "in units of the defining vector length"), 6.3 table. Two tests.
10. `PointOn(hyperbola)` default: got x about 1.6e13, expected the vertex (3, 0). Doc: conics design 3.5 ("The default `PointOn(h)` parameter is 0.25").
11. Dragging `P = PointOn(c, 0.25)` and `PointOn(s, 0.5)`: `dragPlan` says `not_draggable`. Doc: points-lines design 6.1 ("Dragging P writes only P.param"), 13.1. Two tests.
12. `PointOn(r, 0.5)` with a Number and `PointOn(A)` with a Point: got `no_matching_form`, expected `not_a_path`. Doc: points-lines errors 3. Two tests.
13. `ParamOf(P)` (one argument): undefined `out_of_domain`. Doc: points-lines design 1.1 table (`ParamOf | (Point on path)`), 6.3. Two tests.
14. `PointIn(line)`: got `no_matching_form`, expected `not_a_region`. Doc: points-lines errors 3.
15. `TriangleCenter(A, B, C, 11)`: got y = 0.889, expected the Feuerbach point (1, 2) (the touching point of the incircle and the nine-point circle). Doc: points-lines design 5.4 (n = 11).
16. `TriangleCenter(A, B, C, 14)`: undefined `index_out_of_range`, expected a `bad_argument` error. Doc: points-lines design 5.4 ("Others to `bad_argument` with the supported list").

### Locus

17. `Locus(M, P)` with `P = PointOn(c, 0.1)`: the locus is undefined (`no_dependency`), so `Distance(point, locus)` has `input_undefined`. Two tests (ring radius; moving B). Doc: points-lines design 8 ("`Locus(Q, P)` where `P` is a `PointOn`").
18. `Locus(W, P)` with W independent of P, and `Locus(P, M)` the wrong way round: the line is accepted and `tr` is undefined; expected a definition-time `no_dependency` error. Doc: points-lines errors 3; design 8 ("an error at definition time, not a runtime undefined"). Two tests.

### Measures, lines

19. `Angle(m, l)` for lines at 135 and 0 degrees: got 135, expected 45 (counter-clockwise from the first line, wrapped to `[0, pi)`). Doc: points-lines design 7.
20. `Relation((5, 0), l)` (point on a line): got "parallel", expected "incident". Doc: points-lines design 7 (Relation order: incident).
21. `u * w` of two vectors: the hint says `dot(u, w)`; the doc hint names `Dot(u, v)` and `Cross(u, v)`. Doc: points-lines errors 3. Low severity (spelling of the suggested command).
22. `Direction(Line(x == 2))`: got (0, -1), expected (0, 1). Doc: points-lines design 5.2 ("sign chosen so that the first non-zero component is positive").
23. `PerpVector(Segment((0,0),(3,4)))`: got (-0.8, 0.6), expected (-4, 3) ("same length, turned 90 degrees counter-clockwise"). Doc: points-lines design 1.1 (PerpVector row).

### Conics

24. `Circle(O, -2)` (literal): undefined `negative_radius`; expected a `bad_argument` error. Doc: conics errors 3 (`bad_argument` row).
25. `Conic([1, 0, 1, 0, 0])`: undefined `out_of_domain`; expected a `bad_argument` error. Doc: conics errors 3, design 4.4.
26. `Conic` through five points on `x^2/9 + y^2/4 = 1`: kind is ellipse but the coefficients are wrong, and the conic does not pass through the points (residual 6.9). Two tests. Doc: conics design 4.3 ("passes through the five points to about 1e-14").
27. `Conic(x^3 + y == 1)` and `Conic(sin(x) + y == 0)`: accepted, undefined `not_quadratic` / `not_polynomial`; expected check-time errors with those kinds. Doc: conics errors 3. Two tests.
28. `Conic(x^2 + y^2)` (no `==`): got `free_variable`, expected `bad_equation`. Doc: conics errors 3.
29. `Center(Conic(x^2 - y^2 == 0))`: undefined `wrong_kind`; expected the crossing point of the two lines. Doc: conics design 5, last bullet ("except `Center`").

### Tangents, asymptotes, curvature

30. `Tangent((3, 4), hyperbola)` with the point on an asymptote: whole result undefined `inside`; expected one finite tangent in slot 1. Doc: conics design 6.2 step 5.
31. `Asymptote(Conic(x^2 - y^2 == 0))`: one line, expected both. Doc: conics design 5 (last bullet), 6.6.
32. `Asymptote(f)` for a function (`1/x`, and a polynomial): `no_matching_form`. Doc: conics design 6.6 (function forms), 1.1 table. Two tests. Possibly owned by the calculus area (merge of forms); the doc for this area lists the form.
33. `Curvature(P, f)` and `OsculatingCircle(P, f)` for a function: `no_matching_form`. Doc: conics design 1.1, 7. Two tests. Same note as 32.

### Polygons

34. `Polygon(A, B)`: got `no_matching_form`, expected `too_few_points` with a hint naming `Segment`. Doc: polygons-transforms errors 3.
35. `Polygon(O, 1, 1001)` (literal): undefined `limit`; expected a `limit` error. Doc: polygons-transforms errors 3, 6.
36. `Polygon(O, 1, 2)` (literal): undefined `too_few_sides`; expected a `bad_argument` error. Doc: polygons-transforms errors 3.
37. `Vertex(sq, 0)` and `Side(tri, 7)` (literals): undefined `index_out_of_range`; expected `bad_argument` errors. Two tests. Doc: polygons-transforms design 3.4; errors 3.
38. `Vertex(sq, 2.5)` from a variable: `index_out_of_range`, expected `not_whole`. Doc: polygons-transforms errors 4 (`not_whole`: `Vertex`, `Side`).
39. `Convex` of a square with a repeated vertex: false, expected true. Doc: polygons-transforms design 10 ("Duplicate consecutive vertices: Allowed; `Convex` ignores zero turns").
40. `Rigid(A, B, C)` then moving A: the copy moves. Expected no dependency on the points. Doc: polygons-transforms design 5.
41. `Union` of two squares sharing a whole edge: one polygon of area 4, expected area 8. Doc: polygons-transforms design 4.2 (degenerate contacts resolved by perturbation, note `perturbed`).
42. `IntersectPath(Line((-1,1),(1,-1)), sq)` (line touching only the corner (0,0)): returns a chord of non-zero length, expected no chord. Doc: polygons-transforms design 4.1 step 2.

### Transforms

43. `Reflect(P, Segment(A, A))` (degenerate mirror): `zero_length`, expected `coincident_points`. Doc: polygons-transforms design 6.4.
44. `Reflect((1e-13, 0), circle of radius 2)`: defined (4e13, 0), expected `too_far`. Doc: polygons-transforms design 10 (Inversion centre: within `1e-12 r`).
45. `Reflect(segment, circle)` and `Reflect(polygon, circle)`: `no_matching_form`, expected `not_supported` with a hint about inverting the end points. Two tests. Doc: polygons-transforms errors 3.
46. `Move(tri, 3)`: `no_matching_form`, expected `not_a_transform`. Doc: polygons-transforms errors 3.
47. `Reflect(f, Line((1,0),(1,1)))` for a function: `no_matching_form`; expected a Function. Doc: polygons-transforms design 6.7. (Same ownership note as 32.)
48. `Rotate(f, 30°, O)` for a function: type `Function`, expected `Curve`. Doc: polygons-transforms design 6.5, 6.7.

(Numbers 1 to 48 cover 61 failing tests: several rows hold two tests.)

## Silent-doc choices and doc conflicts

Where the docs are silent or disagree, the test follows the reading closest to the docs; these are the choices.

- **Line values** are read as `a·x + b·y = c` with `a² + b² = 1` (the public API note and the kernel's own convention). `points-lines` design 3.1 writes `a·x + b·y + c = 0`. Tests go through helpers (`expectOnLine`, `expectLine`) that do not depend on the sign of `c`.
- **Undefined slot in a defined list** is `null` (or `undefined`); `slotUndef` accepts both. When every slot is undefined the whole cell is undefined with the reason (matches the `T` example in conics errors 4 and points-lines errors 4.1).
- **Reason for an undefined input** is `input_undefined` with a `cause` (README decision 2); `undefined_input` in the area docs is not asserted.
- **Language rulings win over area wording:** wrong argument count is `arg_count` (Q7), a wrong type with a fitting count is `no_matching_form` (Q5, Q6), a single `=` inside an expression is `assign_in_expr` (Q9, so `Conic(x^2 = 4)` is not `bad_equation`), `A = Midpoint(A, B)` on a free point is an assignment (kernel ruling K2). Reserved names (`e`, `x`, `in`, `ci`, `ln`, `t`, `z`) were avoided.
- **Types of lists** are `List`, not `List<Point>` (kernel `type` field).
- **Check-time versus runtime:** where `errors.md` says a literal argument gives an error (`bad_argument`, `limit`, `not_a_path`, `not_quadratic`, `no_dependency`, and so on) the test requires the line to be refused. The same value from a variable is asserted as an undefined reason (for example `Circle(O, r0)` with `r0 = -1` is `negative_radius`; this passes).
- **`PointOn` on a line or ray:** raw parameter 0 is the first defining point and 1 is one defining-vector length (so the second defining point). `norm = 0.5 + atan(s)/pi` (line) and `2 atan(s)/pi` (ray). Design 3.2 gives the unit; the origin is inferred.
- **`Along` beyond 0..1** on a closed path wraps (a point "riding once every 10 seconds"); not stated explicitly.
- **Conic-conic slot order** "starting from the major axis" is read as increasing counter-clockwise angle.
- **`Tangent(Line, Conic)` slot order** is not asserted: design 6.3 says slot 1 has the smaller `c0` and also "toward the negative side of the normal", which disagree under the `a·x + b·y + c = 0` convention. Tests compare the two lines as a set.
- **`Focus` order:** tested relatively (swapping the foci swaps the slots); design 5 says slot 1 is `C + c·u` and also that labels follow the user's order.
- **`TriangleCenter` n = 12** ("Feuerbach point reflection") names no formula; only definedness is tested. n = 13 is tested by the 120-degree property.
- **`Curvature` of a circle** is tested by magnitude (the sign depends on the stored scale of the matrix); for graphs of functions the sign is tested.
- **Not tested:** value notes (`tangent`, `ill_conditioned`, `sampled`, `perturbed`, `near_boundary`, ...) because the public cell type carries none; `Arc`/`Sector` on hyperbola or parabola (design 4.5 and the `ArcValue` type disagree); the `fill = evenodd` style (polygons-transforms 11.7 collides with the kernel `fill` pattern values); curve and implicit-curve intersections (no Curve constructor in this area); the lazy `Length(Ray)` reason (only "undefined" is asserted).
- **`Rigid(A, B)`** is `arg_count` (Q7), not the `bad_argument` row in polygons errors 3.
- **Hyperbola `inside`:** design 6.2 step 3 (compare with the centre value) and step 5 (point on an asymptote has a tangent) disagree for hyperbolas; the test follows step 5.

## Isolation

Read: `AGENTS.md`; `docs/process/pipeline.md`; `docs/features/README.md`; `docs/features/kernel/rulings.md`; `docs/features/language/rulings.md`; `docs/features/points-lines/{design,errors,agent}.md`; `docs/features/conics/{design,errors,agent}.md`; `docs/features/polygons-transforms/{design,errors,agent}.md`. For helper style and kernel calls: `packages/kernel/test/spec/kernel/helpers.ts`, `packages/kernel/test/spec/language/helpers.ts`, `packages/kernel/test/spec/kernel/objects.test.ts` (first 120 lines), `drag.test.ts` (lines 95 to 260), `save-load.test.ts` (lines 1 to 28), `slice.test.ts` (lines 1 to 40). Public API: `packages/kernel/src/index.ts`, `packages/kernel/src/commands/geometry/index.ts`, and `handoff/geometry/builder-notes.md` (the file tool returned the whole file, not only the "Public API" section, so the rest of it was seen; the tests use only the Public API section's facts, and nothing in the rest was used to pick or soften a test). Also listed directories and file sizes under `docs/`, `handoff/geometry/` and `packages/kernel/test/spec/`, and read `package.json` for the test scripts. I ran probe tests against the public API to see value shapes (since deleted). I did not open `docs/**/ui.md`, `handoff/geometry/brief.md`, any other file under `packages/kernel/src/`, or any other area's docs.
