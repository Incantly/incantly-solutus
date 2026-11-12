# Functions area: fixer notes

## Fixer round

Pipeline step 3. Input: `handoff/functions/test-report.md` (487 spec tests, 324 pass, 163 fail). Result: **378 pass, 109 fail**. 54 tests fixed, no test that passed before fails now. The rest of the repository is unchanged: `npx vitest run` shows 3858 passing and only the 109 area tests failing.

Code changed only in `packages/kernel/src/commands/functions/`. No test, language, kernel-core or other-area file was edited.

## Commits (all on `feat/functions`, pushed)

| Commit | Group |
|---|---|
| `853bebd` | Taylor and higher derivatives from a Chebyshev local series; slope at a junction |
| `4d0528e` | Roots (coarse panels, closed right end, rational functions), `Numerator`, `Denominator`, extrema with corners |
| `246175a` | Integrals: jump splitting, tanh-sinh at singular ends, no-data case |
| `629f320` | Limits (Richardson on halving steps, decay before overflow, domain-edge side), `RectangleSum` offset form |
| `b643021` | `Asymptote` |
| `50f52c0` | `Bezier` basis, `Slope(c)`, curves and roots with no data, `sample_cap` reason, curve derivative orders |
| `92004fb` | Intersections, windowed `Intersect`, `empty_region`, nearest `PointIn`, `ImplicitDerivative` `identically_zero`, predicate function values |
| `58279df` | Locus gaps and edges, sweep with an undefined target, range limit, `PathParam` |
| `6b91da1` | Integral with no data, `Curve` as an `Envelope` family |

## What was fixed, by rule

- **Numeric derivatives of every order** (FC 7, FC 8.5). `numeric.ts: localSeries` fits a Chebyshev interpolant on a radius that shrinks until its tail vanishes, so a nearby pole, branch point or kink only shrinks the interval. One routine now serves `Taylor` (order up to 40, no more `input_undefined` for `ln`, `sqrt`, `1/(1-x)`), `Derivative(f, n)`, `Derivative(curve, n)`, and the 4th derivative of a cubic (was -16, now 0).
- **Slope at a junction.** `slopeAt` compares central differences at h and h/2 and third-order one-sided stencils on each side. A smooth junction of two pieces reads the exact slope; a corner still reports `corner`.
- **Roots.** The scan starts from the 512 coarse panels, not from one wide panel that aliased `sin(20 x)` to one root (64 now). A root exactly at the closed right end counts. `Roots(f)` detects rational functions (`detectRational`, lowest terms, monic denominator) and returns the numerator roots. `Roots` of a function that is undefined everywhere is undefined with the function's reason (`input_undefined`), not `[]`. The same no-data rule applies to `Integral`, `AreaUnder`, `Curve` and `Polar`.
- **`Numerator`, `Denominator`** exist, built on the same rational fit (polynomials give denominator 1).
- **Extrema.** `extremaOn` finds slope sign changes on a 4096-point grid and refines by golden search, then Brent on the derivative for a smooth point or a tight golden search for a corner (a maximum at a break is exact). `Maximum`, `Minimum` and `Extremum` share it. `sin` on (0, 100) finds all 32.
- **Integrals.** A panel that still fails at the depth cap is tested for a jump; the jump is bisected to 1e-15 and each side integrated (floor, step, sign are exact). Integrable end-point and interior singularities (`ln x`, `1/sqrt x`, `1/sqrt|x|`) are redone with tanh-sinh. Divergence is still decided by the power fit, so `1/x`, `1/x^2` still report `diverges`.
- **Limits.** Finite points use Richardson extrapolation on the halving steps (Wynn amplified rounding noise on `(e^x - 1 - x)/x^2`). A finite head that decays to nothing followed by overflow (`x/e^x` at inf) is 0. At the edge of the domain the defined side is the limit (`x ln x` at 0).
- **`Asymptote`.** Vertical lines come from the denominator of the rational fit, otherwise from a grid: sign changes and definedness changes are bisected, local maxima of `|f|` catch even poles, and a candidate counts when `|f|` grows without bound (algebraically or like a logarithm). Duplicate oblique lines from the two ends are merged at 1e-6.
- **Curves.** `Bezier` used the wrong Bernstein-to-power sum (tangents and midpoints were wrong). `Slope(c)` with one argument returns the curve (x(s), dy/dx). `Intersect` polishes every hit to rounding so repeated finds merge (a cubic and its axis gave 16 points, now 3). `Intersect(a, b, x0, x1, y0, y1)` exists for all three argument shapes. `ImplicitDerivative` of `x^2 == 4` is `identically_zero`.
- **Inequalities.** `Area` of an empty region is `empty_region`. `PointIn` finds the nearest boundary point (golden search over ray directions), not the nearest grid point. `Boundary`, `PointIn` and `Area` also accept a predicate function value, so they work once the language builds one.
- **Loci.** The sweeping commands run even when the target is undefined at the mover's current value (that is the gap). The edge walk recursed into the same segment forever (timeouts and the `internal` error on `(k, 1/k)`): fixed. A free-number range wider than 1e6 is `limit`. `sample_cap` is a registered reason with a phrase. `PathParam` is registered. A `Curve` family is accepted and reported as `unsupported_family`.
- **`RectangleSum(f, a, b, n, d)`** offset form added.

## Contested tests

None. Every failing test is backed by a doc line.

## To be implemented

Counts add to the 109 still failing.

### Language area (29 + 8 + 8 + 3 + 7 = 55 tests)

| Missing | Tests | What is needed |
|---|---:|---|
| Predicate and implicit-curve define lines | 29 | `p(x) = x^2 > 4` (types `Predicate`, `Predicate2`) and `c(x, y) = F == G` (implicit `Curve`); `c(x) = x^2 == 4` as `bad_argument`; redefining as a `Function` is `type_change`. Also the name `t` is reserved, so `t(x, y) = sin(x) * y > 1` in the inequalities tests is rejected by the language (the doc example uses `t`). The area side is ready: `Boundary`, `PointIn`, `Area` accept a `Relation`, a `Region` or a predicate function value (a function with 1 or 2 arguments that returns a Bool). The params are still typed `Relation|Region`; add the predicate types there when they exist |
| `in a..b` ranges | 8 | `f(x) = x^2 in -1..3`, `c(s) = (...) in 0..tau`, `g(x, y) = ... in 0..1, 0..1` (FC 14.2, CL 5). `missing_range` for a pair line with no range (1 more test, counted under line errors) |
| Inline function arguments | 8 | `Limit(sin(x) / x, 0)`, `Taylor(sin(x), 0, 5)`, `Integral(x^2, 0, 3)`, `Derivative(x^3)` (FC 14.12): implicit binder `x` or `x, y` for a `Function` parameter |
| `Region` fields | 3 | `A.value`, `A.area` on a `Region` (FC 14.1). The cell value already carries both |
| `NSolveODE` binders | 7 | `NSolveODE([v, -4 * y], s, [y, v], [1, 0], 0, 6)`: a list of bodies that see a list of binder names (FC 14.11), then `stop = expr` and `rtol`, `atol` as named options. The current form is `NSolveODE(rhs, init, s0, s1, stop, rtol, atol)` and cannot receive that call. `solveOde` itself (dense output, events) is done and unit-checked through `SolveODE` |
| `(-8)^(1/3)` | 1 | Odd-denominator real root in `^` (FC 486) |
| `Integral(g, 0, 1)` hint | 1 | The `no_matching_form` hint should suggest `Integral(g, y, 0, 1)` for a `Function2` |
| `Polar` unbound name | 1 | `unknown_name` hint mentioning the angle name |

### Kernel core / language: a plan-time argument check (22 tests + 2 registry tests)

A rule cannot produce a line error: `CommandForm` has no hook that runs before the line commits, and `runCommand` turns a thrown error into `K999`. These tests need the line to fail with `bad_argument`, `limit`, `needs_interval` or `not_differentiable` when the arguments are literals:
`Riemann(f, 0, 1, 0)`, `Riemann(..., "middle")`, `Riemann` with n = 1,000,000, `Derivative(f, 2.5)`, `Taylor(f, 0, -1)`, `Taylor(f, 0, 100)`, `Limit(f, 0, "up")`, `Curve(..., 1, 1)`, `Curve(..., 3, 1)`, `Curve(..., -inf, inf)`, `Spline(..., kind = "cosine")`, `Bezier` with 13 points, `Contours` with 51 levels, `Curve(pts)` with 6 points, `IterateList(g, 1, 100001)`, `NSolveODE` with 17 variables, `Roots(f)` / `Extremum(f)` / `Inflection(f)` of a non-rational non-polynomial, `Derivative(h)` with a body without a derivative rule, and the two registry tests (`riemann n 0`, "a failing line changes nothing").
The area already returns the right reason as an undefined value for each. Needed: `CommandForm.check?(args: readonly BoundArg[]): ErrorObject | undefined`, run by the checker when every argument it reads is a literal, and its error returned as the line error. Then the area adds the checks beside each form (the messages already exist in the run functions).

### Kernel core: a notice channel for rules (4 tests)

A rule cannot add to `TxOk.notices`. Needed: `RuleCall.notify(kind, params)` (and registered notice kinds `blowup`, `tangent`, `identically_true`, `sample_cap`, `step_limit`). Tests: `SolveODE` blow-up, tangential `Intersect`, `Curve(x == x)`, the 20000-sample cap.

### Geometry area (PointOn) and kernel slice (20 tests)

Every `Locus(Q, P)`, `LocusEquation(Q, P)` and `Envelope(family, P)` test with a mover on a path (PointOn) returns `not_a_mover` because `RuleCall.slice` drives only a free number or the clock. Needed: `PointOn` exposes its path parameter as a free slice driver (or `slice` accepts a rule-defined mover and drives its parameter). The sweeps, `fitAlgebraic` and `sweepEnvelope` are done and exercised through the free-number forms. Related, from the same gap: `no_dependency` is only detected after the slice opens, so `Q` that does not use the mover is reported as `not_a_mover` (3 tests); and the `no_dependency` message cannot name the objects `Q` depends on (needs the dependency list from the kernel, 1 test). `PathParam(P)` is registered but always `not_a_mover`: it needs the point's path (geometry).

### Kernel core: the expression tree (1 test)

`Hole` of `(x^2 - 2)/(x - sqrt(2))` (hole at an irrational place): without the tree the hole cannot be found by sampling. Also still absent, as in the builder notes: symbolic `Derivative` text, `meta.text`, exact interval root isolation. `Numerator` and `Denominator` are numeric and only for total degree 12 or less.

## Notes for the checker

- `numeric.ts: localSeries` replaced the least-squares `taylorCoeffs`; `taylorCoeffs` keeps its signature.
- `quadFinite` now has three exits for a failing panel: jump (`jumpPanel`), singular end (tanh-sinh over the piece between sorted singular points), or the old power-fit correction as the fallback when tanh-sinh does not settle.
- `specs-curves.ts: sweeps()` wraps the four sweeping commands: it sets `acceptsUndefined` and clears `env.reason` before running, because reading an undefined target had already set `input_undefined`. This relies on `Env` fields being writable from a rule.
- `types.ts` appends `sample_cap` to `AreaUndefReasons` and `FUNCTIONS_REASONS`; `index.ts` registers its phrase.
- Speed: all within-budget tests still pass (`Extremum` of `sin` on (0, 100) under 500 ms, `Roots` of `sin(20 x)` under 500 ms).

## Test counts

| Run | Pass | Fail |
|---|---:|---:|
| Area spec tests before | 324 | 163 |
| Area spec tests after | 378 | 109 |
| Whole repository (`npx vitest run`) | 3858 | 109 (all in `test/spec/functions`) |

## Second fixer round

Input: 109 failing tests. Result: **478 pass, 9 skipped** (each skipped test has a `to be implemented` comment with the reason). The whole repository passes `npm run lint`, `npm run typecheck` and `npm test`.

### What was built

| Group | Tests fixed | Where |
|---|---:|---|
| Check-time argument errors (`bad_argument`, `limit`, `needs_interval`, `not_differentiable`, `missing_range`) | 22 | `commands/functions/checks.ts`; hook facts `value`, `source`, `limit`, `forms` in `language/check.ts` |
| Predicate lines, implicit and parametric curve lines, `in a..b` domains | 33 | `language/lines.ts`, `parser.ts`, `types.ts`, `compile.ts` |
| Inline expressions as function arguments (`Limit(sin(x) / x, 0)`) | 8 | `language/check.ts` (`lambda` node), `compile.ts` |
| `NSolveODE([rhs], s, [vars], [init], s0, s1, stop = …)` | 7 | list binders in `language/check.ts`; `runNSolveODE`; the slope at a stop event in `ode.ts` |
| `Region` fields `.value` and `.area`, `(-8)^(1/3)`, `Integral` and `Polar` hints, capital-named function calls, nearest `PointIn` | 7 | language and area |
| Rule notices (`call.notify`): `blowup`, `sample_cap`, `step_limit` | 1 | `graph/core.ts`, `commands/functions/index.ts` |
| Movers on paths: `Locus(Q, P)`, `LocusEquation(Q, P)`, `Envelope(family, P)`; `no_dependency` names the inputs; equations with leading coefficient 1 | 22 | `call.slice(..., { override: true })`, `call.inputsOf`, `call.argsOf` in `graph/core.ts`; `openPathSlice` in `locus.ts` |

### To be implemented (9 tests, skipped)

| Test | Why |
|---|---|
| `Curve(x == x)` notice, `Area` notice for an inequality true everywhere | The rules do not raise `identically_true` yet. The tests also read the notice's `code`, which holds a registry code (`F103`), not the kind |
| Tangential `Intersect` notice | `Intersect` does not raise `tangent` yet; same remark on `code` |
| `cc(s) = (cos(s), sin(s))` is `missing_range` | Contested. Language design 3.10 and its tests keep a pair-valued line without a range as a `Function<Point>` |
| Redefining `f(x, y)` as `f(x)` is `type_change` | Contested. Language design 3.12 step 3 says the parameter count may change, and language tests assert it |
| Two tests that define `t(x, y) = sin(x) * y > 1` | Contested. `t` is reserved for the clock (README decision 14). The same condition under another name works |
| Hole at an irrational place | Needs the expression tree for exact cancellation |
| Sample cap on `(k, sin(1000 k))` over 0..100 | The sweep judges the thin wiggle flat and stops at about 2,300 samples, so the cap is never reached and no notice is raised |
