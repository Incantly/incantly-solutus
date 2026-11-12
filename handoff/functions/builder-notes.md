# Functions area: builder notes

Paths: `/Users/iteoluwakisibello/.kiro/crew/scratch/runtime-40097a5d/wt-functions/packages/kernel/src/commands/functions/` (code) and this folder. Branch `feat/functions`. No tests were written (a blind tester does that). Typecheck, lint and the existing 3480 tests pass.

## What was built

Files in the code folder:

| File | Holds |
|---|---|
| `index.ts` | `registerFunctions(registry)`, reason phrases, the `Field` type style, public exports |
| `types.ts` | `CurveData`, `RegionData`, `FieldData`, `Line3`, `Circle3`, guards, area registries for undefined reasons and the `Field` type name |
| `numeric.ts` | adaptive Gauss-Kronrod with Wynn extrapolation, root finder (scan, Brent, Newton, touch detection), polynomial detection, finite differences, golden search |
| `ode.ts` | adaptive Dormand-Prince 5(4) with dense output, blow-up and stiffness reasons |
| `sample.ts` | wrappers that read a `FunctionValue` as a sampled `Fn1`/`Fn2` |
| `curves.ts` | curve helpers the points area uses: `asCurve`, `curvePoint`, `curveVel`, `curveAcc`, `curveRange`, `curveAt01`, `curveBbox`, `projectImplicit`, `closestOnCurve` |
| `locus.ts` | slice sweeps for `Locus`, `Path`, `Envelope`, algebraic fit for `LocusEquation` |
| `specs-functions.ts` | function and calculus command specs |
| `specs-curves.ts` | curve, inequality, locus and envelope command specs, and the curve forms of shared commands (`Tangent`, `Normal`, `Slope`, `Derivative`, `Curvature`, `Length`, `Intersect`, `Asymptote`) |
| `rules.ts` | spec builders, `FunctionValue` constructors with per-call undefined reasons, line helpers |

### functions-calculus design.md

| Section | Status |
|---|---|
| 1 defining functions | The language area owns parsing (`f(x) = ...`, `if`, `in`). Nothing built here. |
| 1 Derivative, NDerivative, Slope, Tangent, Normal, Curvature, CurvatureVector, OsculatingCircle | done (numeric; see "Left out") |
| 1 Integral (all five forms), AreaUnder, Riemann (all rules and the offset form) | done; antiderivative is numeric |
| 1 Root, Roots (interval, guesses, polynomial), Extremum, Maximum, Minimum, Inflection, Hole, Asymptote, Intersect | done |
| 1 Taylor, Limit (both sides, `inf`), Iterate, IterateList, Cobweb | done |
| 1 SlopeField, SolveODE (plain and parametric), NSolveODE | done; `NSolveODE` takes `stop` (a `Function<Number>`), `rtol` and `atol` as optional trailing parameters, not as named options |
| 1 Degree, Coefficients, Polynomial | done. `Numerator` and `Denominator` left out (need the expression tree) |
| 1 aliases (`LeftSum`, `RightSum`, `UpperSum`, `LowerSum`, `RectangleSum`, `TrapezoidalSum`, `IntegralBetween`, `NIntegral`, `TurningPoint`, `TaylorPolynomial`, `LimitAbove`, `LimitBelow`, `RemovableDiscontinuity`, `RootList`, `ParametricDerivative`) | done as separate specs sharing the same rules (the language has no `CommandSpec.aliases` field in this kernel, so they are listed in the catalogue; see Needs the integrator) |
| 3 to 5 Expr tree and algebras (Real, Interval, Dual, Jet, Symbolic) | left out: the kernel hands out compiled closures (`FunctionValue`), not the tree. Every method works on closures: finite differences instead of Dual, sampling plus Brent instead of interval root isolation, Chebyshev fit for polynomial detection |
| 6 piecewise, domains | closures return NaN outside the domain. `Slope` of a piecewise function reports `corner` at a break where the one-sided slopes differ; `Derivative(f)` is a numeric function, so it evaluates by central difference at a break. Break-point splitting of integrals is done by sampling for kinks, not from the tree |
| 7 symbolic differentiation, simplifier, antiderivative table | left out (no tree). `Derivative` and `Integral(f)` return numeric functions. `meta.text` is not produced |
| 8.1 definite integral | done: adaptive GK with Wynn, improper bounds by substitution, singularity bisection, `step_limit` best estimate, budget counted in evaluations |
| 8.2 sums | done, Kahan summation, `upper`/`lower` by dense sampling plus golden refinement, `n` up to 100000 |
| 8.3 roots | done by scan plus Brent plus touch detection. Not interval branch-and-bound (no interval algebra); `rigorous: false` is not reported |
| 8.4 extrema, inflection | done; polynomial no-interval forms use detected polynomial degree up to 20 |
| 8.5 limits | done: growth classification, Wynn on the shortest clean prefix, halving steps at finite points to avoid cancellation noise. Route 1 (series via Jet) and route 2 (exact rules) left out |
| 8.6 to 8.10 Taylor, ODE, iteration, slope field | done |
| 9 plotter | not in this area (packages/plot). Object shapes are listed below |
| 10 plug-in | done through `CommandRegistry.registerAll`, `registerReasonPhrase`, `registerTypeStyle` |

### curves-loci design.md

| Section | Status |
|---|---|
| 5 parametric: `Curve(x, y, s, a, b)`, `Polar`, `Derivative`, `Slope`, `Tangent`, `Normal`, `Curvature`, `CurvatureVector`, `OsculatingCircle`, `Length`, cusp handling (higher-derivative tangent) | done |
| 6 implicit: `Contour`, `Contours`, `Curve(pts)` fit through 5/9/14/20 points, `ImplicitDerivative`, `Slope`/`Tangent`/`Normal`/`Curvature` at a point, `Closest`, `Asymptote` of polynomial curves, `Intersect` (curve/line/circle/function pairs, conic-conic exact paths) | done |
| 7 inequalities: `Boundary`, `PointIn`, `Area`, region algebra (`and`) | done. `Area` is a deterministic grid-plus-edge-refinement estimate (12.5661 for the radius-2 disc, relative error about 2e-5) |
| 8 `Bezier`, `Spline` (natural and centripetal, closed option) | done, exact polynomial pieces |
| 9 `Locus`, `Path` | done for a free number or the clock as the mover (`Locus(Q, a, from, to)`, `Path`, `Envelope(family, a, from, to)`). `Locus(Q, P)` and `Envelope(family, P)` with a point on a path always return `undefined`: see Kernel gaps |
| 10 `LocusEquation` | done by fitting a polynomial of degree up to 8 to swept samples with held-out checking (`no_algebraic_equation` otherwise). No Gröbner basis |
| 11 `Envelope` | done for lines, segments, rays and circles; other families give `unsupported_family` |

## Public API

Exported from `packages/kernel/src/commands/functions/index.ts` and, through one appended line, from `packages/kernel/src/index.ts` (`export * from './commands/functions/index'`):

- `registerFunctions(registry: CommandRegistry): void`
- `FUNCTIONS_SPECS`, `CURVE_COMMANDS`, `LOCUS_COMMANDS` (the `CommandSpec[]` lists), `FUNCTIONS_TYPES` (`['Field']`), `FUNCTIONS_REASONS`
- Types: `CurveData` (= `ParamCurveData | ImplicitCurveData | PiecewiseCurveData | SampledCurveData`), `RegionData`, `FieldData`, `Coef2`, `PolyPiece`, `Line3`, `Circle3`, `Fn1`, `Fn2`, `Sampled1`, `AnyCurve`, `ClosestOut`
- Guards: `isCurveData`, `isRegionData`, `isFieldData`, `isFunctionValue`, `isRelationValue`, `isPt`, `isLine3`, `isCircle3`
- Curve helpers for the points area: `asCurve`, `relationCurve`, `isEquation`, `curvePoint`, `curveVel`, `curveAcc`, `curveRange`, `curveAt01`, `curveBbox`, `projectImplicit`, `closestOnCurve`

### Object shapes the plotter reads

All carry a `kind` discriminator.

| Command results | Shape |
|---|---|
| `Function`, `Function2` (from `Derivative`, `Integral(f)`, `Taylor`, `SolveODE`, `NSolveODE`, `Polynomial`, `ImplicitDerivative`, ...) | the language's `FunctionValue` (`call`, `call1`, `batch`, `reason`). `batch` is set on one-variable results |
| `Curve`, `Polar`, `Derivative(curve)`, `Slope(curve)` | `{ kind: 'curve', curve: 'param', fx, fy, lo, hi, closed }` (closures return NaN where undefined) |
| `Bezier`, `Spline` | `{ kind: 'curve', curve: 'piecewise', pieces: PolyPiece[], lo, hi, closed }`, power-basis pieces |
| `Contour`, `Contours`, `Curve(pts)`, `LocusEquation` | `{ kind: 'curve', curve: 'implicit', f(x, y), level, poly?: Coef2[], text? }` |
| `Locus`, `Path`, `Envelope`, parametric `SolveODE` | `{ kind: 'curve', curve: 'sampled', pieces: Float64Array[] (x0,y0,x1,y1,...), closed: boolean[], origin }` |
| `AreaUnder`, `Riemann` and the sum aliases | `{ kind: 'region', shape: { t: 'under', a, b } or { t: 'bars', a, b, n, rule, offset }, value, area, f, g }` |
| `SlopeField` | `{ kind: 'field', slope(x, y), n, length, rect }` with type name `Field` (style defaults registered: colour `#64748b`, width 1.2, label none) |
| Inequalities and implicit equations written as lines | stay the language's `RelationValue` |
| `Roots`, `Extremum`, `Hole`, ... | `List<Point>` of `{ x, y }`; `Asymptote` returns `Line` values `{ a, b, c }` for `ax + by = c` |

Undefined reasons added (27, listed in `FUNCTIONS_REASONS`) all have phrases registered by `registerFunctions`.

## Kernel gaps

1. `FunctionValue` is a closure with no expression tree, no domain and no version. This blocks symbolic `Derivative`/`Integral` text, `meta.text`, `Numerator`/`Denominator`, interval-algebra root isolation and exact `Dual` derivatives. Workaround: finite differences (errors about 1e-11 for smooth functions), sampling, Chebyshev polynomial detection.
2. `call.slice(mover, target)` drives only a free number or `'t'` (`not_free` otherwise). `Locus(Q, P)` and `Envelope(family, P)` with `P` a point on a path (`PointOn`) therefore return `undefined` with a detail naming this gap. The points area's `PointOn` needs to expose a path parameter as a slice driver, or the kernel slice must accept it. `runLocusPP` and `runEnvelopeP` stop at that point with `not_a_mover` or the slice's refusal; once the slice accepts a path mover they need only the sweep call that `Locus(Q, a, from, to)` already uses.
3. Built-in function names cannot be passed as function arguments (`Iterate(cos, 1, 30)` gives `unknown_name`); write `g(x) = cos(x)` first. This is a language-area behaviour.
4. `RuleWork` is not exported from `packages/kernel/src/index.ts` (it is exported from `graph/registry`). Not needed by this area's public API.
5. `len` and `inf` are reserved names, which is correct but surprised the earlier probes. No action.

## Doc conflicts

- `docs/features/functions-calculus/design.md` section 8.3: "`sin(1/x)` on `[0.01, 1]` finds the 62 roots". The roots are at `x = 1 / (k pi)` for `k = 1..31` (since `1 / 0.01 = 100` and `100 / pi = 31.8`), so the correct count is 31. The build returns 31.
- `docs/features/functions-calculus/design.md` section 8.4 says the derivative at a break gives `undefined(corner)` "not a value from whichever branch", while the same design (section 1) prints `Derivative(f)` as an ordinary `Function`. The build makes `Slope(f, x0)` return `undefined(corner)` at a corner (and `inf` at a vertical tangent such as `Slope(sqrt, 0)`), and leaves the `Derivative(f)` function numeric.
- Section 1 says a closed-form `Integral(f)` is "exact when the rule table finds one"; the build has no tree, so every antiderivative is numeric (`meta.exact` does not exist on the closure).

## Needs the integrator

- Call `registerFunctions(registry)` where the other areas register (the studio's registry setup). The kernel's own `index.ts` only re-exports.
- Aliases (core design change 6, `CommandSpec.aliases`) are not in the table; the alias commands are plain specs here. Hide them from the catalogue once the field exists.
- Push of `feat/functions` is done by these commits (the continuing task rule allowed `git push origin feat/functions`).
- The plot package must read the shapes above. `CurveData.sampled` pieces and `RegionData.f/g` are plain closures and typed arrays, so they can cross a worker boundary only as data: the plotter should run in the same thread as the figure or the integrator should add a serialiser.
- The points area should use `curveAt01`, `closestOnCurve` and `projectImplicit` for `PointOn` and `PathParam` on curves.

## Speed numbers

Measured on this machine (Node 22, vitest, mid-range laptop), through `Figure.apply` (line parse and rule included), mean of 5 runs after a warm-up:

| Case | Target in docs | Measured |
|---|---|---|
| `Roots` degree-8 polynomial on `[-3, 3]` | under 1 ms | 0.6 ms |
| `Roots(sin(1/x), 0.01, 1)` (31 roots) | under 10 ms | 0.4 ms |
| `Integral(sin(x) + x^2/10, 0, 5)` | under 0.3 ms median | 0.28 ms (0.027 ms for the method alone) |
| `NSolveODE` two variables, pendulum on `[0, 10]` | about 3 ms for 2000 steps | 1.9 ms |
| `Locus` of a parabola point over `[-2, 2]` | n/a | 0.5 ms |
| `Taylor` order 12 of `exp` | n/a | 0.3 ms |
| `Area` of a disc in a `[-3, 3]` square | n/a | 5.9 ms |
| `Derivative` batch of 2000 samples (`sin(x) cos(2x) + sqrt(x + 2)`) | n/a | 1.4 ms |

Targets not measured because the plotter is another area: plotting budgets in design section 9.

## Accuracy notes

- Finite-difference derivatives are good to about 1e-10 (for example `Slope(x^3 - 3x, 2)` is 9.00000000007), inside the shared tolerance of 1e-9.
- A double root such as `(x - 1)^2` is found to about 1e-11.
- `Limit` snaps values below `tol * 1e-6` to zero and settles on the shortest sample prefix where Wynn converges, so `(1 - cos x) / x^2` at 0 gives 0.5 to 6e-12, and `(1 + 1/x)^x` at `inf` gives e to 1e-9.
- `Hole` looks at an even grid of 2049 points and a lattice of multiples of 1/120 (coarser on wide intervals). A hole at an irrational place is found only when a grid point falls in its undefined run.
