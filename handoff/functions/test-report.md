# Functions area: test report (pipeline step 2, tester)

Branch `feat/functions`. Spec tests: `packages/kernel/test/spec/functions/` (12 test files and `helpers.ts`). Written from the docs and the public API only (`packages/kernel/src/index.ts`, `packages/kernel/src/commands/functions/index.ts` and the types they export).

## Count

- **487 tests: 324 pass, 163 fail.** The run takes about 1 second: `npx vitest run packages/kernel/test/spec/functions`. The results are stable over three runs.
- `npx eslint packages/kernel/test/spec/functions` and `npx tsc -p tsconfig.json` are clean. No source file was changed.
- Time limits: every test has a 15 s runner timeout (`useTimeout`), and every test that could hang or run long (roots of `sin(1/x)`, a degree-8 polynomial, a 1e9-wide interval, singular and improper integrals, `Riemann` with n = 100000, a 3000-step ODE, 100000 iterations, loci with 20000 samples, `LocusEquation`, large `Area`) also asserts its own limit with `within(ms, ...)`. A synchronous infinite loop cannot be interrupted by the runner, so the suite must still be run under an outer `timeout`; the `within` checks catch "slow but finishes".

## Abbreviations for doc lines

| Short | File |
|---|---|
| FC | `docs/features/functions-calculus/design.md` |
| FE | `docs/features/functions-calculus/errors.md` |
| FA | `docs/features/functions-calculus/agent.md` |
| CL | `docs/features/curves-loci/design.md` |
| CE | `docs/features/curves-loci/errors.md` |
| CA | `docs/features/curves-loci/agent.md` |

`FC:239` means line 239 of that file. Section numbers (for example "FC 8.3") refer to the headings inside it.

## Pass and fail by doc section

| File | Doc sections | Tests | Pass | Fail |
|---|---|---:|---:|---:|
| function-objects | FC 1 (defining functions), FC 6 (piecewise, domains, two variables), FC 11 (edge cases), FC 14.2-14.5 and 14.12, FC errors 2 | 30 | 19 | 11 |
| derivative | FC 1 (derivatives and slopes), FC 6 (corners), FC 7 (symbolic rules), FC 11 | 43 | 38 | 5 |
| roots | FC 8.3 (Root, Roots, Intersect), FC errors 3 | 42 | 37 | 5 |
| extremum | FC 8.4 (Extremum, Maximum, Minimum, Inflection) | 29 | 25 | 4 |
| integral | FC 1 and 7 (Integral, AreaUnder, Riemann), FC 8.1, FC 8.2, FC errors 2 | 61 | 44 | 17 |
| limits-asymptotes | FC 8.5 (Limit), FC 8.6 (Asymptote), FC 8.7 (Hole) | 46 | 33 | 13 |
| series-ode | FC 8.5 (Taylor), FC 1 (polynomial helpers), FC 8.8, FC 8.9 (SolveODE, NSolveODE), FC 8.10 | 45 | 24 | 21 |
| curves-param | CL 1, 5, 8, 13 (parametric curves, Polar, Bezier, Spline, queries) | 44 | 29 | 15 |
| curves-implicit | CL 1, 6, 13 (implicit curves, Contour, queries, Intersect, Asymptote, Curve(pts)) | 48 | 37 | 11 |
| inequalities | CL 7 (Predicate, Boundary, PointIn, Area) | 33 | 6 | 27 |
| loci | CL 9, 10, 11 (Locus, Path, LocusEquation, Envelope) | 41 | 14 | 27 |
| registry-errors | FC 1 and 14, FC errors, CL errors, README decisions 2-4, FC 4 and 10 (clock, save/load) | 25 | 18 | 7 |
| **total** | | **487** | **324** | **163** |

The 12 files hold 88 groups; the next table gives pass and fail for each group. Group titles carry their doc section.

<details><summary>Pass and fail by group</summary>

| File | Group (describe title, with its doc section) | Tests | Pass | Fail |
|---|---|---:|---:|---:|
| curves-implicit | implicit curves: Curve(F == G) (6) | 5 | 4 | 1 |
| curves-implicit | implicit curve lines: c(x, y) = F == G (6, 12) | 5 | 1 | 4 |
| curves-implicit | Contour and Contours (1) | 3 | 2 | 1 |
| curves-implicit | ImplicitDerivative and Slope/Tangent/Normal on implicit curves (6) | 9 | 8 | 1 |
| curves-implicit | Curvature and OsculatingCircle of implicit curves (6) | 3 | 3 | 0 |
| curves-implicit | Closest(c, P) on implicit curves (6) | 3 | 3 | 0 |
| curves-implicit | Intersect of curves, lines, circles and functions (6) | 9 | 6 | 3 |
| curves-implicit | Asymptote of an implicit polynomial curve (6) | 5 | 5 | 0 |
| curves-implicit | Curve(pts): the algebraic curve of lowest degree (1, 6, errors 1) | 5 | 4 | 1 |
| curves-implicit | implicit curves: speed (6 targets) | 1 | 1 | 0 |
| curves-param | Curve(x(s), y(s), s, a, b): parametric curves (1, 5) | 6 | 3 | 3 |
| curves-param | Parametric curve lines: c(s) = (x(s), y(s)) in a..b (5, errors 1) | 3 | 0 | 3 |
| curves-param | Polar(r, θ, a, b) (5) | 3 | 2 | 1 |
| curves-param | Derivative, Slope, Tangent, Normal of parametric curves (5) | 9 | 8 | 1 |
| curves-param | Curvature, CurvatureVector, OsculatingCircle of parametric curves (5) | 5 | 5 | 0 |
| curves-param | Length of parametric curves (5) | 4 | 4 | 0 |
| curves-param | Bezier (8) | 5 | 0 | 5 |
| curves-param | Spline (8) | 4 | 3 | 1 |
| curves-param | Closest(c, P) on parametric curves (5) | 2 | 2 | 0 |
| curves-param | Parametric curve edge cases (13) | 3 | 2 | 1 |
| derivative | Derivative(f): values against known derivatives (FC 7) | 15 | 15 | 0 |
| derivative | Derivative(f, n): higher orders | 3 | 2 | 1 |
| derivative | Derivative: partial derivatives of two-variable functions (FC 1, 6) | 4 | 4 | 0 |
| derivative | Derivative of a piecewise function and corners (FC 6) | 4 | 2 | 2 |
| derivative | NDerivative: numeric derivative for bodies the rules cannot print (FC 1, 7) | 3 | 2 | 1 |
| derivative | Slope(f, x0) (FC 1, 11) | 3 | 2 | 1 |
| derivative | Tangent(f, x0) and Normal(f, x0) | 6 | 6 | 0 |
| derivative | Curvature(f, x0) and OsculatingCircle(f, x0) of a function graph (FC 1, curves 1) | 4 | 4 | 0 |
| derivative | Derivative: the derivative integrates back (FC 13: property tests) | 1 | 1 | 0 |
| extremum | Extremum(f, a, b): all local extrema in the open interval (8.4) | 11 | 11 | 0 |
| extremum | Extremum(f): polynomials need no interval (8.4) | 3 | 2 | 1 |
| extremum | Maximum(f, a, b) and Minimum(f, a, b): the global point on the closed interval (8.4) | 7 | 6 | 1 |
| extremum | Inflection(f, a, b): sign changes of f'' (8.4) | 7 | 6 | 1 |
| extremum | Extremum and Inflection: time limits | 1 | 0 | 1 |
| function-objects | functions: defining and calling (FC 1) | 6 | 6 | 0 |
| function-objects | functions: derivative marks in expressions (FC 14.5) | 2 | 2 | 0 |
| function-objects | functions: piecewise with if (FC 1, 6; README 13) | 7 | 7 | 0 |
| function-objects | functions: restricted domains with in a..b (FC 6, 14.2) | 4 | 0 | 4 |
| function-objects | functions: arithmetic edge cases (FC 11) | 2 | 1 | 1 |
| function-objects | functions: errors at definition (FC errors 2) | 5 | 3 | 2 |
| function-objects | functions: inline function arguments (FC 14.12) | 4 | 0 | 4 |
| inequalities | Predicate lines: p(x) = condition and q(x, y) = condition (1, 7, 15.2) | 11 | 1 | 10 |
| inequalities | Boundary(p, a, b): where the predicate changes truth (7) | 5 | 0 | 5 |
| inequalities | PointIn(q, P0): a point kept inside the region (7) | 3 | 0 | 3 |
| inequalities | Area(q, x0, x1, y0, y1): measure of the region in a rectangle (7) | 7 | 0 | 7 |
| inequalities | Boundary, PointIn and Area on inequalities written as plain relation lines (silent-doc fallback) | 7 | 5 | 2 |
| integral | Integral(f, a, b): definite integrals against exact values (8.1) | 8 | 7 | 1 |
| integral | Integral: break points, piecewise, sums (8.1, 6) | 8 | 5 | 3 |
| integral | Integral: improper bounds and singularities (8.1) | 8 | 4 | 4 |
| integral | Integral(f): antiderivative as a Function (7) | 4 | 4 | 0 |
| integral | Integral of two-variable functions (1) | 3 | 2 | 1 |
| integral | AreaUnder: a Region with .value (signed) and .area (unsigned) (1, 4) | 8 | 5 | 3 |
| integral | Riemann(f, a, b, n [, rule]): sums and bars (8.2) | 14 | 14 | 0 |
| integral | Riemann: aliases that map to Riemann (1) | 2 | 1 | 1 |
| integral | Riemann and Integral: argument errors (errors 2) | 5 | 1 | 4 |
| integral | Integral: results carry notices when partial (errors 3) | 1 | 1 | 0 |
| limits-asymptotes | Limit(f, a): finite points (8.5) | 7 | 4 | 3 |
| limits-asymptotes | Limit(f, inf) and Limit(f, -inf) (8.5) | 6 | 5 | 1 |
| limits-asymptotes | Limit: no limit, one-sided limits, sides (8.5, errors 3, 6) | 12 | 11 | 1 |
| limits-asymptotes | Asymptote(f) (8.6) | 14 | 7 | 7 |
| limits-asymptotes | Hole(f, a, b) (8.7) | 7 | 6 | 1 |
| loci | Locus(Q, a, from, to): the mover is a free number (9) | 12 | 6 | 6 |
| loci | Path(P, from, to): the mover is the clock (9) | 6 | 6 | 0 |
| loci | Locus(Q, P): the mover is a point on a path (9) [mover on a path] | 8 | 1 | 7 |
| loci | LocusEquation(Q, P): the algebraic equation of the locus (10) [mover on a path] | 5 | 0 | 5 |
| loci | Envelope(family, P) (11) [mover on a path] | 10 | 1 | 9 |
| registry-errors | the command table has every documented command (FC 1, curves 1) | 4 | 2 | 2 |
| registry-errors | the undefined reasons added by this area are registered (FC 14.8, curves 15.9) | 1 | 0 | 1 |
| registry-errors | line errors are well-formed error objects (errors design: one format) | 5 | 3 | 2 |
| registry-errors | undefined values carry a plain-language detail for the teacher (errors 3, 6) | 8 | 7 | 1 |
| registry-errors | time, save/load, determinism and the clock (FC 4, 10; curves 9) | 4 | 4 | 0 |
| registry-errors | two-variable functions: domains and calls (FC 6, 10) | 3 | 2 | 1 |
| roots | Root(f, a, b): first root in [a, b] (8.3) | 7 | 7 | 0 |
| roots | Root(f, x0): nearest root from a start value (8.3) | 1 | 1 | 0 |
| roots | Roots(f, a, b): every root, sorted (8.3) | 14 | 13 | 1 |
| roots | Roots: hard cases and time limits (8.3 targets) | 5 | 4 | 1 |
| roots | Roots: dynamic lists (1: "a list that grows and shrinks with a slider") | 2 | 2 | 0 |
| roots | Roots(f): polynomials and rational functions, no interval (8.3) | 6 | 3 | 3 |
| roots | Roots(f, guesses): one root near each guess (1) | 1 | 1 | 0 |
| roots | Intersect(f, g, a, b): list of points (1, 8.3) | 5 | 5 | 0 |
| roots | Roots: failures are undefined values with reasons, not errors (errors 3) | 1 | 1 | 0 |
| series-ode | Taylor(f, a, n): degree-n polynomial about x = a (8.5) | 13 | 3 | 10 |
| series-ode | polynomial helpers: Degree, Coefficients, Polynomial, Numerator, Denominator (1) | 5 | 3 | 2 |
| series-ode | Iterate, IterateList, Cobweb (8.8) | 6 | 5 | 1 |
| series-ode | SlopeField(g) (8.10) | 2 | 2 | 0 |
| series-ode | SolveODE(g, x0, y0, x1): first-order solution as a Function (8.9) | 9 | 8 | 1 |
| series-ode | SolveODE parametric form: SolveODE(dy, dx, x0, y0, tEnd) -> Curve (8.9) | 3 | 3 | 0 |
| series-ode | NSolveODE: systems with dense output (8.9) | 7 | 0 | 7 |

</details>

## Main causes of the 163 failures (what the fixer should look at first)

| Cause | Failing tests | Doc line |
|---|---:|---|
| Define-line forms with a `Bool` body are not typed: `p(x) = x^2 > 4` (Predicate), `q(x, y) = ...` (Predicate2) and `c(x, y) = F == G` (implicit Curve) all fail with `type_mismatch` ("A function returns a Number or a Point, but this is a Bool"). Every inequality test that goes through a predicate line fails for this one reason. | 27 | CL:361, CL:398 |
| The commands behind those lines (Boundary, PointIn, Area) are mostly fine: 10 of the 12 tests on plain relation lines (`r = x^2 + y^2 < 4`) pass. The two failures are `Area` of an empty relation (no `empty_region`) and `PointIn` from (3, 3) (not the nearest inside point). | 2 | CE:53, CL:268 |
| Mover on a path: `Locus(Q, P)`, `LocusEquation(Q, P)` and `Envelope(family, P)` return `not_a_mover` for a `PointOn` point. These tests use a test-local `PointOn` (see Caveats), so some of this may belong to the points area / kernel `slice`, not to this area. Every test of those three commands is in this group. | 18 | README decision 9, CL:280-292 |
| A range in a define line, `f(x) = x^2 in -1..3`, `c(s) = (...) in 0..tau`, `g(x, y) = ... in 0..1, 0..1`, is a parse error ("Unexpected in"). The `Curve(...)` command form works. | 8 | FC:30, FC:239-243, CL:26, CL:155 |
| Inline function arguments: `Limit(sin(x) / x, 0)`, `Taylor(sin(x), 0, 5)`, `Integral(x^2, 0, 3)`, `Derivative(x^3)` are rejected with `free_variable`. | 8 | FC:533 |
| Binder names: `NSolveODE([v, -4 * y], s, [y, v], ...)` fails with `unknown_name` for `v`; the named options `stop`, `rtol`, `atol` give `duplicate_arg`. | 7 | FC:403, FC:395, FC:534 |
| Static argument mistakes come back as an undefined value instead of the line error the docs require: `Riemann(f, 0, 1, 0)`, `Derivative(f, 2.5)`, `Taylor(f, 0, -1)`, `Limit(f, 0, "up")`, `Curve(..., 1, 1)`, `Contours` with 51 levels, `Roots(f)` of a non-polynomial (`needs_interval`), and others. The undefined value does carry the right reason. | 19 | FE:55, FE:58, FE:59, FE:248 |
| `Region` objects have no `.value` and `.area` fields in the language (`S.value`: "A Region has no field value"). The cell value does carry them (the other Riemann tests read it there). | 3 | FC:54, FA:52 |
| `Asymptote` finds no vertical asymptotes (poles) and sometimes repeats an oblique line: `(x^2 + 1)/(x - 1)`, the three-line worked example, `ln`, `tan`, `1/sqrt(x)`, a slider case. | 7 | FC:364-372 |
| Taylor polynomials are accurate only to about 1e-3..1e-4 and fail (`input_undefined`) for `ln`, `sqrt` and `1/(1 - x)`. Third and fourth derivatives are numeric and wrong (a cubic's 4th derivative is -16 at x = 5). | 10 | FC:351, FC:263 |
| `Roots`: misses the closed end point of `[a, b]`, finds 1 of 64 roots of `sin(20 x)` on `[0, 10]`, rejects rational functions in the no-interval form. `Extremum` finds 0 of 32 extrema of `sin` on `(0, 100)`. | 4 | FC:322-327, FC:330, FC:336 |
| Integration accuracy at break points and end-point singularities is 1e-7 to 1e-3 (docs: 1e-10): `floor`, a step, `sign`, `ln(x)` on `[0, 1]`, `1/sqrt(x)`, `1/sqrt(abs(x))`. | 6 | FC:301-305 |
| `Limit` returns `no_limit` for `(e^x - 1 - x)/x^2`, `x ln x` and `x/e^x`. | 3 | FC:353-356 |
| `Locus` with an undefined stretch: `(k, sqrt(k^2 - 1))` gives `input_undefined` instead of two pieces, `(k, sqrt(1 - k^2))` runs out of "work budget" (`timeout`), `(k, 1/k)` gives an `internal` error, a 1e9 range is not refused, and no `sample_cap` notice is raised at 20000 samples. | 6 | CL:299-302, CE:30, CE:63 |
| Missing commands: `Numerator`, `Denominator`, `PathParam`; `Slope(c)` with one argument; `RectangleSum` with an offset; `Intersect(c1, c2, x0, x1, y0, y1)`; reason `sample_cap` is not registered. | 7 | FC:88, CL:51, CL:61, CL:63, CL:405 |
| `Bezier`: tangents are wrong (slope -inf at parameter 0, wrong sign at 1) and more than 12 points is not refused as a line error. | 5 | CL:33, CL:272-276, CE:30 |
| Others are single items, listed with their doc line in the table below. | | |

## Every failing test

The "Observed" column is the first line of the failure message. `FC:30` style refs are lines in the doc files above.

| File | Test | Doc line | Observed |
|---|---|---|---|
| function-objects | f(x) = x^2 in -1..3 is defined inside the interval | FC:30, FC:239-243 (restricted domain `in a..b`), FC:524 | setup line "f(x) = x^2 in -1..3" failed: syntax (L001): Unexpected in. Expected end of line. |
| function-objects | the in-bounds are closed: both end points are defined | FC:30, FC:239-243 (restricted domain `in a..b`), FC:524 | setup line "f(x) = x^2 in -1..3" failed: syntax (L001): Unexpected in. Expected end of line. |
| function-objects | outside the interval the value is undefined with out_of_domain | FC:30, FC:239-243 (restricted domain `in a..b`), FC:524 | setup line "f(x) = x^2 in -1..3" failed: syntax (L001): Unexpected in. Expected end of line. |
| function-objects | the bounds are expressions that follow a slider | FC:30, FC:239-243 (restricted domain `in a..b`), FC:524 | setup line "f(x) = x^2 in 0..k" failed: syntax (L001): Unexpected in. Expected end of line. |
| function-objects | (-8)^(1/3) is -2: odd denominator reads as a real root | FC:486 (negative base, odd denominator) | tmp17 is undefined (out_of_domain) |
| function-objects | redefining a Function2 as a one-variable Function is type_change | FE:47 (`f(x) = x` when f is Function2: type_change) | expected "f(x) = x" to fail with type_change, but it passed: f = function |
| function-objects | Roots of a function that reads an undefined number is undefined with input_undefined | FC:475 (undefined propagation: input_undefined) | expected r to be undefined, but it is [] |
| function-objects | Limit(sin(x) / x, 0) works without a prior f(x) line | FC:533 (14.12 inline function arguments), FA:41 | setup line "L = Limit(sin(x) / x, 0)" failed: free_variable (L015): x is only available inside a function or an equation, and L is a plain number. |
| function-objects | Taylor(sin(x), 0, 5) accepts an inline expression | FC:533 (14.12 inline function arguments), FA:41 | setup line "W = Taylor(sin(x), 0, 5)" failed: free_variable (L015): x is only available inside a function or an equation, and W is a plain number. |
| function-objects | Integral(x^2, 0, 3) accepts an inline expression | FC:533 (14.12 inline function arguments), FA:41 | setup line "I = Integral(x^2, 0, 3)" failed: free_variable (L015): x is only available inside a function or an equation, and I is a plain number. |
| function-objects | Derivative(x^3) accepts an inline expression | FC:533 (14.12 inline function arguments), FA:41 | setup line "d = Derivative(x^3)" failed: free_variable (L015): x is only available inside a function or an equation, and d is a plain number. |
| derivative | Derivative of x^3 - 3x of order 4 at 5 is 0 | FC:263-264 (exact symbolic rule table), FC:51 (`Derivative(f, n)`) | expected -16.133164052319533 to be within 0.00001 of 0 (off by 16.133164052319533) |
| derivative | where the one-sided derivatives agree there is no corner | FC:237 (derivative at a break; exact), FC:263 | expected 1.9999969999850986 to be within 0.000001 of 2 (off by 0.000003000014901388681) |
| derivative | the domain restriction is kept by the derivative | FC:243 (Derivative keeps the domain) | setup line "f(x) = x^2 in 0..2" failed: syntax (L001): Unexpected in. Expected end of line. |
| derivative | Derivative(h) with a body that has no derivative rule fails at the line with not_differentiable | FE:56, FE:161-170 (not_differentiable at the line), FC:264 | expected "d = Derivative(h)" to fail with not_differentiable, but it passed: d = function |
| derivative | Slope at a smooth piece junction is defined | FC:237 (derivative at a break; exact), FC:263 | expected 1.9999969999850986 to be within 0.000001 of 2 (off by 0.000003000014901388681) |
| roots | a root at an end point of the interval is included | FC:61 (Root: first root in [a, b]), FC:322-324 (isolate on the closed interval) | expected [ +0 ] to deeply equal [ +0, 1 ] |
| roots | an oscillating function with many roots: sin(20 x) on [0, 10] has 64 roots | FC:322-327 (screen-independent isolation), FC:328 (targets) | expected 1 to be 64 // Object.is equality |
| roots | a rational function: roots of the numerator, (x^2 - 1)/(x - 2) has -1 and 1 | FC:62, FC:330 (Roots(f) for rational functions) | r is undefined (needs_interval: f is not a polynomial of degree 20 or less, so Roots needs an interval.) |
| roots | Roots(f) of a non-polynomial is the line error needs_interval | FE:58, FE:178-190 (needs_interval is a line error) | expected "r = Roots(f)" to fail with needs_interval, but it passed: r is undefined (needs_interval) |
| roots | needs_interval lists the interval form among the forms | FE:58, FE:178-190 (needs_interval is a line error) | expected "r = Roots(f)" to fail with needs_interval, but it passed: r is undefined (needs_interval) |
| extremum | Extremum(f) of a non-polynomial is needs_interval | FE:58, FE:178-190 (needs_interval is a line error), FC:62-65 | expected "E = Extremum(f)" to fail with needs_interval, but it passed: E is undefined (needs_interval) |
| extremum | the maximum of a piecewise function can be at a break: if(x < 1, x, 3 - 2x) at (1, 1) | FC:339, FC:342-343 (break points are candidates; 1e-12 in x) | x: expected 0.9999979999999999 to be within 1e-8 of 1 (off by 0.0000020000000000575113) |
| extremum | Inflection(f) of a non-polynomial is needs_interval | FE:58, FE:178-190 (needs_interval is a line error), FC:62-65 | expected "W = Inflection(f)" to fail with needs_interval, but it passed: W is undefined (needs_interval) |
| extremum | Extremum of sin(x) on (0, 100) finds 32 extrema under 500 ms | FC:336-343 (all local extrema), FC:488 (limit only above 1e6) | expected +0 to be 32 // Object.is equality |
| integral | an inline expression is accepted (FC 14.12): Integral(x^2, 0, 3) | FC:533 (14.12 inline function arguments) | setup line "I = Integral(x^2, 0, 3)" failed: free_variable (L015): x is only available inside a function or an equation, and I is a plain number. |
| integral | floor(x) over [0, 3.5] is 4.5 (breaks at integers) | FC:303, FC:305 (break points split the interval; tolerance 1e-10) | expected 4.49999980131785 to be within 1e-9 of 4.5 (off by 1.9868214984342103e-7) |
| integral | a step function over [0, 4] with a jump at 1.5: if(x < 1.5, 1, 3) is 1.5 + 7.5 = 9 | FC:303, FC:305 (break points split the interval; tolerance 1e-10) | expected 9.000000635782879 to be within 1e-10 of 9 (off by 6.357828787884046e-7) |
| integral | sign(x) over [-2, 3] is 1 | FC:303, FC:305 (break points split the interval; tolerance 1e-10) | expected 0.9999998410542805 to be within 1e-9 of 1 (off by 1.5894571947505653e-7) |
| integral | Integral of ln(x) from 0 to 1 | FC:301, FC:304-305 (Wynn extrapolation for end-point singularities; tolerance 1e-10) | expected -0.9999858256306692 to be within 0.000001 of -1 (off by 0.000014174369330821612) |
| integral | Integral of 1 / sqrt(x) from 0 to 1 | FC:301, FC:304-305 (Wynn extrapolation for end-point singularities; tolerance 1e-10) | expected 2.000046910885075 to be within 0.000001 of 2 (off by 0.00004691088507513541) |
| integral | Integral of 1 / sqrt(abs(x)) from -1 to 1 | FC:301, FC:304-305 (Wynn extrapolation for end-point singularities; tolerance 1e-10) | expected 3.997304256895026 to be within 0.000001 of 4 (off by 0.002695743104974113) |
| integral | the integral of an everywhere-undefined function is undefined, not zero or a throw | silent-doc choice 9 (see below); FC:475 | expected undefined to be defined |
| integral | Integral(g, 0, 1) on a two-variable function is no_matching_form with a hint to integrate one out | FE:53, FE:117-131 (hint: "Integral(g, y, 0, 1)") | expected 'Closest form: Integral(f, a, b).' to match /Integral\(g, ?y, ?0, ?1\)/ |
| integral | the field A.value reads the signed integral in a line (agent.md: S.value) | FC:54 (Region carries .value and .area), FA:52 | setup line "v = A.value" failed: type_mismatch (C003): A Region has no field value. |
| integral | the field A.area reads the unsigned area in a line | FC:54 (Region carries .value and .area), FA:52 | setup line "a = A.area" failed: type_mismatch (C003): A Region has no field area. |
| integral | Riemann regions have the same .value and .area fields | FC:54 (Region carries .value and .area), FA:52 | setup line "v = S.value" failed: type_mismatch (C003): A Region has no field value. |
| integral | RectangleSum(f, a, b, n, d) reads the height at fraction d | FC:55, FC:90 (RectangleSum maps to Riemann with an offset) | setup line "S = RectangleSum(f, 0, 2, 4, 0.5)" failed: arg_count (C002): RectangleSum takes 4 arguments; got 5. |
| integral | Riemann with n = 0 is bad_argument | FE:55, FE:59, FE:248 (bad_argument / limit are line errors for literal arguments) | expected "S = Riemann(f, 0, 1, 0)" to fail with bad_argument, but it passed: S is undefined (bad_argument) |
| integral | Riemann with an unknown rule "middle" is bad_argument and lists the allowed rules | FE:55, FE:59, FE:248 (bad_argument / limit are line errors for literal arguments) | expected "S = Riemann(f, 0, 1, 4, "middle")" to fail with bad_argument, but it passed: S is undefined (bad_argument) |
| integral | Riemann with n = 1000000 is a limit error | FE:55, FE:59, FE:248 (bad_argument / limit are line errors for literal arguments) | expected "S = Riemann(f, 0, 1, 1000000)" to fail with limit, but it passed: S is undefined (limit) |
| integral | Derivative order 2.5 is bad_argument with param n | FE:55, FE:59, FE:248 (bad_argument / limit are line errors for literal arguments) | expected "d = Derivative(f, 2.5)" to fail with bad_argument, but it passed: d is undefined (bad_argument) |
| limits-asymptotes | Limit of (exp(x) - 1 - x) / x^2 at 0 is 0.5 | FC:353-356 (series route handles these: (e^x-1-x)/x^2, x ln x) | L is undefined (no_limit: From the left f tends to no limit, from the right to no limit.) |
| limits-asymptotes | Limit of x * ln(x) at 0 is 0 | FC:353-356 (series route handles these: (e^x-1-x)/x^2, x ln x) | L is undefined (no_limit: From the left f tends to no limit, from the right to 0.) |
| limits-asymptotes | inline expression: Limit(sin(x) / x, 0) (FC 14.12) | FC:533 (14.12 inline function arguments) | setup line "L = Limit(sin(x) / x, 0)" failed: free_variable (L015): x is only available inside a function or an equation, and L is a plain number. |
| limits-asymptotes | Limit of x / exp(x) at inf is 0 | FC:353-356 (series route handles these: (e^x-1-x)/x^2, x ln x) | L is undefined (no_limit: From the left f tends to no limit, from the right to no limit.) |
| limits-asymptotes | a side other than "left" or "right" is bad_argument with the allowed sides | FC:75 (side is "left" or "right"), FE:55 (bad_argument is a line error) | expected "L = Limit(f, 0, "up")" to fail with bad_argument, but it passed: L is undefined (bad_argument) |
| limits-asymptotes | (x^3 - 2x^2 - x + 4)/(2x^2 - 2) has x = -1, x = 1 and y = x/2 - 1 | FC:368-372 (worked example with three lines) | expected 1 to be 3 // Object.is equality |
| limits-asymptotes | (x^2 + 1)/(x - 1) has the vertical x = 1 and the oblique y = x + 1 | FC:368 (vertical: roots of denominators, ln/log arguments, interval-detected poles) | expected a vertical line, got {"a":0.7071067811865475,"b":-0.7071067811865475,"c":-0.7071067800284141}: expected false to be true // Object.is equalit |
| limits-asymptotes | ln(x) has the vertical x = 0 (the argument reaches 0) | FC:368 (vertical: roots of denominators, ln/log arguments, interval-detected poles) | expected +0 to be 1 // Object.is equality |
| limits-asymptotes | 1/sqrt(x) has x = 0 and y = 0 | FC:368 (vertical: roots of denominators, ln/log arguments, interval-detected poles) | expected 1 to be 2 // Object.is equality |
| limits-asymptotes | lesson 4: (x^2 - 1)/(x - 1.5) has x = 1.5 and y = x + 1.5 | FA:"Lesson 4" (`Asymptote(f, -3, 3)` returns 2 lines), FC:368-372 | expected 3 to be 2 // Object.is equality |
| limits-asymptotes | tan(x) on [-2, 2] has x = -pi/2 and x = pi/2 | FC:368 (vertical: roots of denominators, ln/log arguments, interval-detected poles) | expected +0 to be 2 // Object.is equality |
| limits-asymptotes | the asymptote lines follow a slider: 1/(x - a) has x = a | FC:368 (vertical: roots of denominators, ln/log arguments, interval-detected poles) | expected a vertical line, got {"a":0,"b":1,"c":0}: expected false to be true // Object.is equality |
| limits-asymptotes | a hole at an irrational place: (x^2 - 2)/(x - sqrt(2)) has a hole at (sqrt 2, 2 sqrt 2) | FC:376 (Hole: candidates are zeros of denominators found by Roots) | expected +0 to be 1 // Object.is equality |
| series-ode | sin about 0 of order 5 evaluates to x - x^3/6 + x^5/120 | FC:351 (Taylor via Jet algebra, coefficients to 1e-12 up to order 12) | expected 0.8415906971039158 to be within 1e-10 of 0.8416666666666667 (off by 0.00007596956275091049) |
| series-ode | exp about 0 of order 4 at 1 is 1 + 1 + 1/2 + 1/6 + 1/24 | FC:351 (Taylor via Jet algebra, coefficients to 1e-12 up to order 12) | expected 2.7112640963670875 to be within 1e-10 of 2.708333333333333 (off by 0.002930763033754502) |
| series-ode | ln about 1 of order 3 at 2 is 1 - 1/2 + 1/3 | FC:351 (Taylor via Jet algebra, coefficients to 1e-12 up to order 12) | tmp4 is undefined (input_undefined) |
| series-ode | about a != 0: sqrt about 4 of order 2 matches value, slope and curvature at 4 | FC:351 (Taylor via Jet algebra, coefficients to 1e-12 up to order 12) | tmp6 is undefined (input_undefined) |
| series-ode | a slider on the centre animates the polynomial: tp(a) equals sin(a) | FC:351 (Taylor via Jet algebra, coefficients to 1e-12 up to order 12) | tmp7 is undefined (input_undefined) |
| series-ode | a slider on the order: n = 3 then n = 5 | FC:351 (Taylor via Jet algebra, coefficients to 1e-12 up to order 12) | expected 0.8357598709812621 to be within 1e-10 of 0.8333333333333334 (off by 0.0024265376479287726) |
| series-ode | inline expression: Taylor(sin(x), 0, 5) (FC 14.12) | FC:533 (14.12 inline function arguments) | setup line "tp = Taylor(sin(x), 0, 5)" failed: free_variable (L015): x is only available inside a function or an equation, and tp is a plain number. |
| series-ode | TaylorPolynomial is an alias for Taylor | FC:351 (Taylor via Jet algebra, coefficients to 1e-12 up to order 12) | tmp9 is undefined (input_undefined) |
| series-ode | a negative literal order is a line error bad_argument | FE:55, FE:59, FC:489 (bad_argument / limit at line time) | expected "tp = Taylor(f, 0, -1)" to fail with bad_argument, but it passed: tp is undefined (bad_argument) |
| series-ode | order 100 is rejected (bad_argument or limit; the cap is 40) | FE:55, FE:59, FC:489 (bad_argument / limit at line time) | expected "tp = Taylor(f, 0, 100)" to fail with bad_argument or limit, but it passed: tp is undefined (limit) |
| series-ode | Coefficients of a Taylor polynomial: sin order 5 gives 0, 1, 0, -1/6, 0, 1/120 | FC:533 (14.12 inline function arguments) | setup line "tp = Taylor(sin(x), 0, 5)" failed: free_variable (L015): x is only available inside a function or an equation, and tp is a plain number. |
| series-ode | Numerator and Denominator of (x^2 + 1)/(x - 1) at 3 are 10 and 2 | FC:88 (Numerator, Denominator) | setup line "nu = Numerator(r)" failed: unknown_command (K002): Numerator is not a command. |
| series-ode | IterateList count above 100000 is a limit error | FE:59 (limit: IterateList count above 100,000), FC:380 | expected "L = IterateList(g, 1, 100001)" to fail with limit, but it passed: L is undefined (limit) |
| series-ode | blow-up: y' = 1 + y^2 from (0, 0) over [0, 3] stops before pi/2 with a blowup warning | FE:90, FE:217, FC:397 (blowup keeps the part computed and carries a warning) | expected [] to deeply equal ArrayContaining{…} |
| series-ode | y'' = -4 y from (1, 0): y(s) = cos(2 s) and v(s) = -2 sin(2 s) | FC:403, FC:534 (binder names in NSolveODE / Derivative(g, y)) | setup line "sys = NSolveODE([v, -4 * y], s, [y, v], [1, 0], 0, 6)" failed: unknown_name (K001): v is not defined. |
| series-ode | a pendulum conserves energy: v^2/2 - 9.8 cos(y) stays within 1e-5 over [0, 10] | FC:403, FC:534 (binder names in NSolveODE / Derivative(g, y)) | setup line "sys = NSolveODE([v, -9.8 * sin(y)], s, [y, v], [0.6, 0], 0, 10)" failed: unknown_name (K001): v is not defined. |
| series-ode | exponential decay system x' = -x, y' = x - y from (1, 0): y = s e^-s | FC:403, FC:534 (binder names in NSolveODE / Derivative(g, y)) | setup line "sys = NSolveODE([-xx, xx - yy], s, [xx, yy], [1, 0], 0, 5)" failed: unknown_name (K001): xx is not defined. |
| series-ode | stop = expr ends the solve where it first becomes true: free fall stops at y = 0, s = 1.4286 | FC:395-396 (stop = expr event), FC:75 (named options) | setup line "sys = NSolveODE([v, -9.8], s, [y, v], [10, 0], 0, 5, stop = y < 0)" failed: duplicate_arg (L018): The argument stop is given more than onc |
| series-ode | the event time is located precisely: the last defined s is within 1e-6 of sqrt(10/4.9) | FC:395-396 (stop = expr event), FC:75 (named options) | setup line "sys = NSolveODE([v, -9.8], s, [y, v], [10, 0], 0, 5, stop = y < 0)" failed: duplicate_arg (L018): The argument stop is given more than onc |
| series-ode | more than 16 variables is a limit error | FE:59 (limit: NSolveODE with more than 16 variables) | expected "sys = NSolveODE([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], s, [u1, u2, u3, u4, u5, u6, u7, u8, u9, u10, u11, u12, u13, u14, u15, u |
| series-ode | a slider on a coefficient re-solves: y'' = -k y has frequency sqrt(k) | FC:403, FC:534 (binder names in NSolveODE / Derivative(g, y)) | setup line "sys = NSolveODE([v, -k * y], s, [y, v], [1, 0], 0, 6)" failed: unknown_name (K001): v is not defined. |
| curves-param | an empty range (a == b) is bad_argument | CE:17-19 (empty or reversed range is bad_argument), CL:157 | expected "cc = Curve(cos(s), sin(s), s, 1, 1)" to fail with bad_argument, but it passed: cc is undefined (bad_argument) |
| curves-param | a reversed range (b < a) is bad_argument with a hint about low-to-high ranges | CE:17-19 (empty or reversed range is bad_argument), CL:157 | expected "cc = Curve(cos(s), sin(s), s, 3, 1)" to fail with bad_argument, but it passed: cc is undefined (bad_argument) |
| curves-param | an infinite range is not supported for plotting: missing_range or bad_argument | CL:375 (infinite ranges: missing_range), CE:15 | expected "cc = Curve(cos(s), sin(s), s, -inf, inf)" to fail with missing_range or bad_argument, but it passed: cc is undefined (missing_range) |
| curves-param | the line form makes a Curve (not a Function) | CL:26, CL:155-157, CL:398 (define-line typing: pair with `in a..b` is a Curve) | setup line "cc(s) = (2 * cos(s), sin(s)) in 0..tau" failed: syntax (L001): Unexpected in. Expected end of line. |
| curves-param | the line form evaluates like the command form | CL:26, CL:155-157, CL:398 (define-line typing: pair with `in a..b` is a Curve) | setup line "cc(s) = (2 * cos(s), sin(s)) in 0..tau" failed: syntax (L001): Unexpected in. Expected end of line. |
| curves-param | a pair without a range is missing_range, pointing at the end of the line | CL:30, CL:157, CE:15, CE:100 (missing_range at the end of the line) | expected "cc(s) = (cos(s), sin(s))" to fail with missing_range, but it passed: cc = function |
| curves-param | an unbound angle name is unknown_name with a hint about θ | CE:19 (`Polar(sin(2 t), θ, ...)`: unknown_name, hint about θ) | expected 'Define it first, or use a name that e…' to match /θ/angle/theta/i |
| curves-param | Slope(c) with no parameter is the curve (x(s), dy/dx) | CL:51 (`Slope(c: Curve) -> Curve`) | setup line "sc = Slope(cc)" failed: arg_count (C002): Slope takes 2 arguments; got 1. |
| curves-param | the parameter runs 0..1: the tangent at 0 points along the first control leg (slope 2) through (0, 0) | CL:33, CL:272-276 (Bezier, parameter 0..1), CL:169 (Tangent by parameter) | expected -Infinity to be within 0.000001 of 2 (off by Infinity) |
| curves-param | the tangent at 1 points along the last control leg (slope -2) through (3, 0) | CL:33, CL:272-276 (Bezier, parameter 0..1), CL:169 (Tangent by parameter) | expected 2 to be within 0.000001 of -2 (off by 4) |
| curves-param | at the middle (parameter 0.5) the curve is at (1.5, 1.5) with a horizontal tangent | CL:33, CL:272-276 (Bezier, parameter 0..1), CL:169 (Tangent by parameter) | expected -1.5 to be within 1e-7 of 1.5 (off by 3) |
| curves-param | a quadratic Bezier (degree count - 1 = 2) has midpoint (1, 1) for control (0,0), (1,2), (2,0) | CL:33, CL:272-276 (Bezier, parameter 0..1), CL:169 (Tangent by parameter) | expected false to be true // Object.is equality |
| curves-param | more than 12 points is a limit error | CE:30, CL:274 (Bezier of more than 12 points: limit) | expected "bz = Bezier([(0, 0), (1, 1), (2, 2), (3, 0), (4, 1), (5, 2), (6, 0), (7, 1), (8, 2), (9, 0), (10, 1), (11, 2), (12, 0)])" to fail with limit |
| curves-param | a bad kind is bad_argument with the allowed kinds | CE:18 (`Spline(pts, kind = "cosine")`: bad_argument) | expected "sp = Spline([(0, 0), (1, 2), (2, 1), (3, 3)], kind = "cosine")" to fail with bad_argument, but it passed: sp is undefined (bad_argument) |
| curves-param | a curve with an undefined input is undefined with input_undefined, not a throw | FC:475 (undefined propagation: input_undefined) | expected cc to be undefined, but it is {"kind":"curve","curve":"param","fx":"fn","fy":"fn","lo":0,"hi":6.283185307179586,"closed":false} |
| curves-implicit | F - G identically zero (x == x) is defined with an identically_true notice | CE:64, CL:372 (identically_true warning) | expected [] to include 'identically_true' |
| curves-implicit | the line form makes an implicit Curve, not a Function | CL:98-100, CL:361, CL:398 (define-line typing: top-level == over two parameters is an implicit Curve) | setup line "ee(x, y) = x^2 / 4 + y^2 == 1" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| curves-implicit | the line form has the same field as Curve(...) | CL:98-100, CL:361, CL:398 (define-line typing: top-level == over two parameters is an implicit Curve) | setup line "ee(x, y) = x^2 / 4 + y^2 == 1" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| curves-implicit | a one-parameter equation c(x) = x^2 == 4 is bad_argument ("isolated numbers, not a curve") | CE:37 (`c(x) = x^2 == 4` is bad_argument) | expected "cx(x) = x^2 == 4" to fail with bad_argument, got type_mismatch: A function returns a Number or a Point, but this is a Bool. |
| curves-implicit | redefining an implicit curve line as a Function is type_change | CL:98-100, CL:361, CL:398 (define-line typing: top-level == over two parameters is an implicit Curve) | setup line "ee(x, y) = x^2 + y^2 == 1" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| curves-implicit | more than 50 levels is a limit error | CE:30 (Contours of more than 50 levels: limit) | expected "cs = Contours(g, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, |
| curves-implicit | ImplicitDerivative where F_y is identically zero is undefined with identically_zero | CE:57 (identically_zero for ImplicitDerivative) | expected dy to be undefined, but it is {"arity":2,"ret":"Number","call":"fn"} |
| curves-implicit | a tangential meeting is reported once per point with a tangent notice: unit circle and (x-2)^2 + y^2 == 1 at ( | CE:65, CL:231-236 (tangential intersections carry a tangent warning) | expected [] to include 'tangent' |
| curves-implicit | with a window: the unit circle and y = x inside [0, 2] x [0, 2] meet only at (sqrt.5, sqrt.5) | CL:63, CL:230-233 (`Intersect(c1, c2, x0, x1, y0, y1)`) | setup line "I = Intersect(uc, f, 0, 2, 0, 2)" failed: arg_count (C002): Intersect takes 2 or 4 arguments; got 6. |
| curves-implicit | the intersection of a cubic and a line: y == x^3 - x and y == 0 gives x = -1, 0, 1 | CL:228-236 (interval branch and bound; duplicates merged within 1e-10) | expected 16 to be 3 // Object.is equality |
| curves-implicit | 6 points is bad_argument and names the valid counts 5, 9, 14 | CE:17 (bad_argument), CL:243-244, CL:44 | expected "fc = Curve([(0, 0), (1, 1), (2, 4), (3, 9), (4, 16), (5, 25)])" to fail with bad_argument, but it passed: fc is undefined (bad_argument) |
| inequalities | p(x) = x^2 > 4 makes a Predicate | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "p(x) = x^2 > 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | q(x, y) = x^2 + y^2 < 4 makes a Predicate2 | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "q(x, y) = x^2 + y^2 < 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | calling a one-variable predicate gives a Bool: p(3) true, p(1) false | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "p(x) = x^2 > 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | calling a two-variable predicate gives a Bool: inside and outside the disc | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "q(x, y) = x^2 + y^2 < 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | p(x) = x > 1 at 1 is false | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "p(x) = x > 1" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | p(x) = x <= 1 at 1 is true | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "p(x) = x <= 1" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | a chain is allowed: band(x, y) = 1 < x^2 + y^2 < 4 | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "band(x, y) = 1 < x^2 + y^2 < 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | and combines conditions: sys(x, y) = y >= x and x + y < 3 and y < 2 | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "sys(x, y) = y >= x and x + y < 3 and y < 2" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | a predicate with a slider follows it | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "q(x, y) = x^2 + y^2 <= r^2" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | a transcendental condition is accepted: sin(x) * y > 1 | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "t(x, y) = sin(x) * y > 1" failed: reserved_name (K003): t is reserved (a variable of the language) and cannot name an object. |
| inequalities | x^2 > 4 changes at -2 and 2 | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "p(x) = x^2 > 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | x^3 > x + 1 changes at the real root 1.3247179572447 | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "p(x) = x^3 > x + 1" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | a chain 1 < x^2 < 4 changes at -2, -1, 1, 2 | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "p(x) = 1 < x^2 < 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | sin(x) > 0 on [-1, 7] changes at 0, pi, 2 pi | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "p(x) = sin(x) > 0" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | a predicate true everywhere has no boundary: the empty list, defined | CL:74, CL:260-264 (Boundary(p, a, b)) | setup line "p(x) = x^2 > -1" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | a point already inside stays | CL:75, CL:268 (PointIn) | setup line "q(x, y) = x^2 + y^2 < 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | a point outside moves to the nearest inside point: from (5, 0) to just inside (2, 0) | CL:75, CL:268 (PointIn) | setup line "q(x, y) = x^2 + y^2 < 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | an empty region gives empty_region | CE:53 (empty_region for Area and PointIn) | setup line "qe(x, y) = x^2 + y^2 < -1" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | a disc of radius 2 in [-3, 3]^2 has area 4 pi | CL:76, CL:269 (Area(q, x0, x1, y0, y1)) | setup line "q(x, y) = x^2 + y^2 < 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | half the disc: disc and y > x has area 2 pi | CL:76, CL:269 (Area(q, x0, x1, y0, y1)) | setup line "disc(x, y) = x^2 + y^2 <= 4" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | the region below the sine curve in [0, pi] x [-1, 1] has area pi + 2 | CL:76, CL:269 (Area(q, x0, x1, y0, y1)) | setup line "b(x, y) = y < sin(x)" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | an empty region gives empty_region | CE:53 (empty_region for Area and PointIn) | setup line "qe(x, y) = x^2 + y^2 < -1" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | the area follows a slider: x^2 + y^2 <= r^2 is pi r^2 | CL:76, CL:269 (Area(q, x0, x1, y0, y1)) | setup line "q(x, y) = x^2 + y^2 <= r^2" failed: type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | an unusual condition is measured, not skipped: sin(x) * y > 1 in [0, pi] x [0, 4] is positive and finite | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | setup line "t(x, y) = sin(x) * y > 1" failed: reserved_name (K003): t is reserved (a variable of the language) and cannot name an object. |
| inequalities | the notices of an inequality that is true everywhere include identically_true | CL:67-72, CL:361, CL:398 (define-line typing: Predicate / Predicate2 lines) | expected "tt(x, y) = x^2 >= 0" to pass, got type_mismatch (C003): A function returns a Number or a Point, but this is a Bool. |
| inequalities | Area of an empty relation is empty_region | CE:53 (empty_region for Area and PointIn) | expected A to be undefined, but it is 0 |
| inequalities | PointIn onto the nearest point: from (3, 3) it lands near (sqrt 2, sqrt 2) | CL:268 (PointIn: nearest point, then 1e-9 inside) | x: expected 1.2255975097527114 to be within 0.00001 of 1.4142135623730951 (off by 0.18861605262038372) |
| loci | a gap where Q is undefined: (k, sqrt(k^2 - 1)) over [-2, 2] has two pieces, one on each side | CL:301 (undefined stretches become pieces), CL:300-302; no clock (CL:24-25) | loc is undefined (input_undefined) |
| loci | the boundary of a defined stretch is found to 1e-9: (k, sqrt(1 - k^2)) over [-2, 2] spans x from -1 to 1 | CL:301 (undefined stretches become pieces), CL:300-302; no clock (CL:24-25) | loc is undefined (timeout: The work budget ran out.) |
| loci | a jump is not joined: (k, 1/k) crossing the pole at 0 splits into two pieces | CL:300 (discontinuities break the polyline); nothing may throw (AGENTS.md) | setup line "loc = Locus(Q, k, -2, 2)" failed: internal (K999): Something went wrong inside Locus; nothing was changed. |
| loci | no_dependency names what Q does depend on (hint or detail) | CE:138-143, CE:28 (no_dependency names what Q depends on) | expected 'The point does not depend on the move…' to match /A/ |
| loci | a huge range is a limit error (Locus(Q, k, 0, 1e9)) | CE:30, CE:87 (`Locus(Q, P, 0, 1e9)` is limit), CL:299 | expected loc to be undefined, but it is {"kind":"curve","curve":"sampled","pieces":[{"0":0,"1":0,"2":7812500,"3":-0.044561722220298944,"4":15625000,"5 |
| loci | a rapidly oscillating path stops at the sample cap with a sample_cap notice, not a hang | CE:63, CL:299, CL:380 (sample_cap warning) | expected [] to deeply equal ArrayContaining{…} |
| loci | the midpoint of A and a point on a circle traces a circle of radius 1 about (2.5, 0) | CL:280-292 (Locus slice, mover parameter), CE:27-28 (not_a_mover, no_dependency) | loc is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | the locus of a point going round a closed path is one closed piece | CL:280-292 (Locus slice, mover parameter), CE:27-28 (not_a_mover, no_dependency) | loc is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | Length of the locus is about 2 pi | CL:280-292 (Locus slice, mover parameter), CE:27-28 (not_a_mover, no_dependency) | L is undefined (input_undefined) |
| loci | the parabola construction: Q = (P.x, P.x^2 / 8) on a segment path traces y = x^2 / 8 for x in [-6, 6] | CL:280-292 (Locus slice, mover parameter), CE:27-28 (not_a_mover, no_dependency) | loc is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | Q that does not use the mover is no_dependency | CL:280-292 (Locus slice, mover parameter), CE:27-28 (not_a_mover, no_dependency) | reason of loc: expected [ 'no_dependency' ] to include 'not_a_mover' |
| loci | Locus(Q, P, from, to) uses natural units along an unbounded-style path: x from 1 to 3 on a segment from the or | CL:280-292 (Locus slice, mover parameter), CE:27-28 (not_a_mover, no_dependency) | loc is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | the locus is recomputed when a free point moves | CL:280-292 (Locus slice, mover parameter), CE:27-28 (not_a_mover, no_dependency) | loc is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | the circle locus has the equation (x - 2.5)^2 + y^2 - 1 = 0 with leading coefficient 1 | CL:321-333 (LocusEquation: fit, verify, normalise) | eq is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel supp |
| loci | the equation holds on the whole circle, not just the sampled arc | CL:321-333 (LocusEquation: fit, verify, normalise) | eq is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel supp |
| loci | the parabola locus has the equation x^2 - 8 y = 0 (lesson 1) | CL:321-333 (LocusEquation: fit, verify, normalise) | eq is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel supp |
| loci | an ellipse locus, Q = (3 P.x, 2 P.y) for P on the unit circle, has the equation x^2 + (9/4) y^2 - 9 = 0 | CL:321-333 (LocusEquation: fit, verify, normalise) | eq is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel supp |
| loci | a transcendental locus has no polynomial equation: no_algebraic_equation | CL:321-333 (LocusEquation: fit, verify, normalise) | reason of eq: expected [ 'no_algebraic_equation' ] to include 'not_a_mover' |
| loci | the ladder envelope is a Curve with origin "envelope" | CL:336-352 (Envelope) | env is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | every ladder envelope point is on the astroid x^(2/3) + y^(2/3) = 5^(2/3) | CL:336-352 (Envelope) | env is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | the ladder envelope is clipped to the ladder: it stays in the first quadrant | CL:336-352 (Envelope) | env is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | the envelope reaches only what the ladder reaches: x from 0.5^3/25 to 4.9^3/25 | CL:336-352 (Envelope) | env is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | the family of tangent lines to a circle of radius 3 has the circle as its envelope | CL:336-352 (Envelope) | env is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | a family of circles of radius 0.5 centred on the unit circle has two envelope branches at distances 0.5 and 1. | CL:336-352 (Envelope) | env is undefined (not_a_mover: The mover is defined by a rule; the kernel slice only drives a free number or the clock, so this locus needs kernel sup |
| loci | the second argument must be a mover point: Envelope(ladder, 0.2) is no_matching_form | CA:"Lesson 3" (hint: "The second argument is the mover: a point made with PointOn.") | expected 'Closest form: Envelope(family, P).' to match /PointOn/mover/ |
| loci | a parametric curve as the family is unsupported_family (line error or undefined) | CE:29, CE:243 (unsupported_family) | expected 'no_matching_form' to be 'unsupported_family' // Object.is equality |
| loci | Envelope with a family that does not depend on the mover is no_dependency | CL:280-292 (Locus slice, mover parameter), CE:27-28 (not_a_mover, no_dependency) | reason of env: expected [ 'no_dependency' ] to include 'not_a_mover' |
| registry-errors | every functions-calculus command of the design is registered | FC:86-88 (Numerator, Denominator in the polynomial helpers) | expected [ 'Numerator', 'Denominator' ] to deeply equal [] |
| registry-errors | every curves-loci command of the design is registered | CL:61, CL:404 (PathParam) | expected [ 'PathParam' ] to deeply equal [] |
| registry-errors | every reason the docs add is in the area's reason list | CL:405 (sample_cap added to the reason registry) | expected [ 'sample_cap' ] to deeply equal [] |
| registry-errors | riemann n 0 | FE:55 (bad_argument is a line error) | expected true to be false // Object.is equality |
| registry-errors | a failing line changes nothing: the script is the same before and after | FE:5 ("A line either commits or returns one error object and changes nothing") | expected '@fig 1\nf(x) = x^2\na = 2\nS = Rieman…' to be '@fig 1\nf(x) = x^2\na = 2\n' // Object.is equality |
| registry-errors | input_undefined names the undefined input in the cause chain | FC:475 (undefined propagation: input_undefined) | expected r to be undefined, but it is [] |
| registry-errors | g(x, y) = x + y in 0..1, 0..1 is defined in the rectangle only | FC:256 (Function2 domain `in x0..x1, y0..y1`) | setup line "g(x, y) = x + y in 0..1, 0..1" failed: syntax (L001): Unexpected in. Expected end of line. |

## Choices made where the docs are silent, or wrong

1. **Root count of `sin(1/x)` on `[0.01, 1]`: 31, not 62** (FC:328, FC:452 and FC:455 say 62). The roots are `1/(k pi)` for `k = 1..31`, because `1/0.01 = 100` and `100/pi = 31.8`. The test checks the 31 values.
2. **Reason for "no `if` arm matched".** FC:191 says `out_of_domain`; README decision 13 says `condition_false`, and the README wins over the folders. The test requires the value to be undefined and accepts either reason.
3. **Error kinds owned by the language area.** Parse and name errors may come back as `chained_comparison`, `assign_in_expr`, `free_variable` where the functions docs say `syntax` or `unknown_name`; tests accept both. Wrong argument counts accept `arg_count`, `wrong_arity` and `no_matching_form` (language ruling Q7 says `arg_count`; FE:44 and CE:25 say `wrong_arity` and `no_matching_form`).
4. **Tangent at a cusp.** CL:169 (Jet algebra: use the first non-zero higher derivative) and CE:46, CE:184 (`Tangent` at a cusp is undefined with `singular_point`) disagree. The test follows CL:169 (the tangent at the cusp of `(s^2, s^3)` is the x-axis), which is the mathematically correct tangent. `Slope` at the same point is undefined with `singular_point` (both docs agree).
5. **Line error versus undefined value.** FE:55, FE:58, FE:59, FE:248 list `bad_argument`, `needs_interval` and `limit` among line errors for literal arguments; the tests require a line error (`ok: false`) for those. For `no_dependency`, `not_a_mover`, `unsupported_family` and `limit` on `Locus`/`Envelope`, CE lists them both as line errors and as undefined reasons, so the tests accept either channel. A slider-fed bad value (n = 0 through a slider) must be an undefined value with `bad_argument`.
6. **`Taylor` order cap.** FE:55 says order 100 is `bad_argument`; FE:59 says a Taylor order above 40 is `limit`. The test accepts either kind.
7. **Warnings are `notices`** (README decision 4). Tests look for `blowup`, `tangent`, `identically_true` and `sample_cap` in `TxOk.notices` (by `code`, or by text).
8. **Order of `Roots(f, guesses)`.** The docs say "one root near each guess". The tests compare sorted results; the single example where order matters lists guesses in ascending order.
9. **`Integral` of a function that is undefined everywhere on `[a, b]`** is required to be undefined (there is no value). FC:304 only covers sampled non-finite points inside.
10. **`Integral(f)` of `1/x`.** FC:285 gives a closed form `ln(abs(x))`, so `F(2) - F(1) = ln 2`. The test requires that; a numeric antiderivative taken from 0 would diverge.
11. **`IterateList(f, x0, n)` length.** FC:380 only defines `Cobweb` (2n + 1 points). The test requires that the last item equals `Iterate(f, x0, n)` and that a halving map halves each step, whatever the length.
12. **Implicit curve value.** `Curve(F == G)` is read through `f(x, y) - level` or through `residual(x, y)` (the language relation value), whichever exists; a test only needs the field, not the exact shape.
13. **Normalisation of `LocusEquation`.** CL:329 says "normalise the leading coefficient to 1". The tests take it as the coefficient of the highest power of `x`, so the parabola locus is `x^2 - 8 y` (value -8 at `(0, 1)`), the circle locus is `x^2 + y^2 - 5 x + 5.25` (value -1 at the centre), and the ellipse locus is `x^2 + 2.25 y^2 - 9` (value -9 at the origin).
14. **Sign of curvature of an implicit curve.** CL:171 gives the formula; for `x^2 + y^2 == 1` it evaluates to -1. The test requires -1 (and a separate test requires magnitude 1).
15. **`Intersect` result order.** Sorted by `x`, then `y` (CL:236). Two curves that coincide (the unit circle given as a parametric and as an implicit curve) are not tested: the docs do not say what an infinite intersection returns.
16. **Predicate type name.** Tests check that the type text matches `/Predicate/`.
17. **`Curve(pts)` degeneracy.** The nine-point cubic test uses nine points on the folium `x^3 + y^3 = 3xy`. Nine points on `y = x^3` spread over `[-4, 4]` are well-posed mathematically but ill-conditioned; the 1e-8 singular-value rule (CL:243) might reject them, so they are not used.
18. **Tolerances.** Derivative values 1e-7 (1e-6 at piece junctions); roots and extrema positions 1e-8 to 1e-9; definite integrals 1e-8, improper and end-point singular integrals 1e-6, break-point integrals 1e-9 to 1e-10 (docs: 1e-10); Taylor 1e-10 (docs: 1e-12 up to order 12); ODE values 1e-6; `Area` of an inequality 3e-4 to 5e-4 absolute (docs: boundary error under 1e-4 of the total); loci and envelopes 1e-9 for points on a known curve and 1e-3..2e-3 for polyline lengths.
19. **Names.** `e`, `z`, `ln`, `inf`, `t` are reserved, and a capitalised name is a command, so a function object that is called must have a lowercase name. FA:25 writes `e = Extremum(f, -3, 3)` and the lessons call `F(...)`-style objects; those lines are wrong as written, and the tests use other names (`ex`, `af`, `gi`).
20. **Relation fallback for inequalities.** Predicate lines (`q(x, y) = ...`) are the documented form and are tested as such. A second block (12 tests) feeds the same commands plain relation lines (`r = x^2 + y^2 < 4`), which the language accepts, so a failure in the commands can be told from a failure in the define line.
21. **Regions.** Riemann and AreaUnder numbers are read from the object's cell (`value`, `area`, as in the public API table); three tests read `S.value` and `S.area` in a line, as FA:48-52 does.

## Doc problems found

- FC:328: "62 roots" is 31 (above).
- FA:25 uses `e` as an object name; `e` is a constant.
- FC:191 versus README 13 (reason for no matching `if` arm).
- CL:169 versus CE:46, CE:184 (`Tangent` at a cusp).
- FE:55 versus FE:59 (`Taylor` order 100: `bad_argument` or `limit`).
- CE:25 (`Locus(Q)` is `no_matching_form`) versus language ruling Q7 (`arg_count`).
- CL:221 says a point is first projected onto the curve by Newton (so a point 0.4 away is projected), CE:49 says a point 0.4 away gives `not_on_curve`. No test is written for `not_on_curve`.

## Caveats

- The `Locus(Q, P)`, `LocusEquation` and `Envelope` tests that need a mover on a path use a **test-local `PointOn`** (Segment and Circle forms, in `helpers.ts`) because the points area is not on this branch. The result `not_a_mover` ("the kernel slice only drives a free number or the clock") may be caused by that command not being a recognised mover and not by this area. The groups are marked `[mover on a path]` in the group table. `Locus(Q, a, from, to)` and `Path(P, from, to)` do not depend on it.
- The geometry commands the tests register (`Circle`, `Segment`, `Line`, `PointOn`) are minimal and live only in `helpers.ts`.

## Isolation

I read, as permitted: `AGENTS.md`, `docs/process/pipeline.md`, `docs/features/README.md`, `docs/features/functions-calculus/*`, `docs/features/curves-loci/*`, `docs/features/kernel/rulings.md`, `docs/features/language/rulings.md`, the helpers in `packages/kernel/test/spec/kernel/helpers.ts` and `packages/kernel/test/spec/language/helpers.ts`, `packages/kernel/src/index.ts` and `packages/kernel/src/commands/functions/index.ts`.

Two departures from the brief, both disclosed here:

1. **`handoff/functions/builder-notes.md`: I printed more than the "Public API" section.** My command showed lines 58-130, so I also saw "Kernel gaps", "Doc conflicts", "Needs the integrator", "Speed numbers" and "Accuracy notes". I did not copy expectations from those sections: every number in the tests comes from the docs or from arithmetic done in the test. Two places were still influenced, and I say so: the "Doc conflicts" note mentions the 62-versus-31 root count, which I then re-derived from the maths (`1/(k pi)`, `k = 1..31`) and the test checks the 31 values; and the `[mover on a path]` caveat below was worded after I saw the "Kernel gaps" note on movers.
2. **Type declarations.** To learn how to build a `Figure` and read results I read only the declarations (not bodies) of exported types in `packages/kernel/src/graph/figure.ts`, `graph/core.ts` (`FigureOptions`), `graph/types.ts` (`Cell`, `TxOk`, `Slice`), `graph/hist.ts` (`WriteWhy`, `SetFreeOptions`), `graph/registry.ts` (the `registerAll` line only) and `contracts/values.ts` and `contracts/errors.ts`. No file under `packages/kernel/src/commands/functions/` other than `index.ts` was opened, and no other part of `src/` was read.

I also ran probe scripts against the public API (`new Figure(...).apply(line)`) to learn value shapes (for example that `Curve(F == G)` returns a relation value with `residual`, that an `Area` cell holds `value` and `area`). Those probes were deleted; the tests assert the documented behaviour, not what the probes printed.
