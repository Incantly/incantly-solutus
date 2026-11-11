# Functions and calculus: design

Status: draft for review. Fits `docs/design/formula-language-and-kernel.md` (the "core design"). Companion folder: `docs/features/curves-loci` (parametric and implicit curves, inequalities, loci, envelopes). Files in this folder: `design.md` (this), `errors.md`, `agent.md`, `ui.md`.

All syntax below is ours, written to the core grammar. Command names are ordinary maths words. Nothing here copies the reference app's code, names or manual text.

## 1. What the feature does

### For a learner

- Type a formula, see its graph. Change a slider, the graph moves.
- Ask for the things a calculus class asks for: slope at a point, the derivative as its own graph, the area under a curve, where it crosses the axis, where it peaks, where it bends, what it does near a hole or a wall, what it looks like up close as a polynomial, what a differential equation's solutions look like.
- Watch an idea build: rectangles that grow thinner as `n` rises, a tangent that slides along a curve, a Taylor polynomial that hugs the curve more closely as its order rises.

### For a teacher (and the live teacher model)

- Every result is an object in the figure. A root is a point you can name, label, highlight or move a tangent to. An area is a region you can shade and read a number from.
- Everything is dynamic. `f(x) = a * x^2 + b` followed by `r = Roots(f, -5, 5)` keeps `r` right as `a` and `b` change, including when the number of roots changes.
- Answers are honest. When a limit does not exist, an integral diverges, or there is no root in the interval, the object is `undefined` with a reason the teacher can say out loud (see `errors.md`).

### Sub-features and commands (full list, our syntax)

Forms are written as the command table will print them. `f` is a one-variable function, `g` a two-variable function.

**Defining functions**

| Line | Makes |
|---|---|
| `f(x) = x^2 - 2` | `Function` (ℝ → ℝ) |
| `f(x) = x^2 in -1..3` | `Function` restricted to a closed interval |
| `f(x) = if(x < 0, -x, x^2)` | Piecewise `Function` |
| `f(x) = if(x < -1, x^2, x <= 1, 1, 2 - x^2)` | Piecewise with several branches, last value is the "otherwise" |
| `f(x) = if(0 <= x <= 3, sin(x))` | Defined on the interval only; elsewhere `undefined` |
| `g(x, y) = x^2 - y^2` | `Function2` (ℝ² → ℝ) |
| `p(x) = x > 2` | `Predicate` (ℝ → Bool). Drawn by `curves-loci` |
| `h(x) = f(x) + g(x, 1)` | Functions call functions |
| `f'(x)`, `f''(x)` (in an expression) | Sugar for `Derivative(f)(x)`, `Derivative(f, 2)(x)` |

**Derivatives and slopes**

| Command | Forms |
|---|---|
| `Derivative` | `(f) -> Function`; `(f, n: Number) -> Function`; `(g, v) -> Function2` partial in variable `v` (the name `x` or `y`); `(g, v, n) -> Function2`; `(c: Curve) -> Curve`; `(c: Curve, n) -> Curve` (parametric curves) |
| `NDerivative` | `(f) -> Function`: derivative by automatic differentiation, for bodies the symbolic rules cannot print |
| `Slope` | `(f, x0: Number) -> Number`: the derivative's value at a point |
| `Tangent` | `(f, x0) -> Line` (core). `Normal(f, x0) -> Line` |
| `Curvature`, `CurvatureVector`, `OsculatingCircle` | `(f, x0)`; curve forms are in `curves-loci` |

**Integrals and areas**

| Command | Forms |
|---|---|
| `Integral` | `(f) -> Function` antiderivative (exact when the rule table finds one, else numeric); `(f, through: Point) -> Function` antiderivative passing a given point; `(f, a, b) -> Number` definite; `(f, g, a, b) -> Number` of `f - g`; `(g, v) -> Function2` partial antiderivative; `(g, v, a, b) -> Function` integrate out one variable |
| `AreaUnder` | `(f, a, b) -> Region`; `(f, g, a, b) -> Region` (core). A `Region` carries `.value` (signed integral) and `.area` (unsigned) |
| `Riemann` | `(f, a, b, n) -> Region` left rectangles; `(f, a, b, n, rule: Text) -> Region` with `rule` one of `"left" "right" "mid" "upper" "lower" "trapezoid" "simpson"`; `(f, a, b, n, offset: Number) -> Region` rectangles whose height is read at fraction `offset` (0 to 1) of each slice |

**Special points**

| Command | Forms |
|---|---|
| `Root` | `(f, a, b) -> Point` first root in `[a, b]` (core); `(f, x0) -> Point` nearest root found from a start value |
| `Roots` | `(f, a, b) -> List<Point>` every root, sorted; `(f) -> List<Point>` for polynomials and rational functions only; `(f, guesses: List<Number>) -> List<Point>` one root near each guess |
| `Extremum` | `(f, a, b) -> List<Point>` all local extrema in the open interval; `(f)` for polynomials. Changes the core form, see section 14 |
| `Maximum`, `Minimum` | `(f, a, b) -> Point` the global one on the closed interval |
| `Inflection` | `(f, a, b) -> List<Point>`; `(f)` for polynomials |
| `Hole` | `(f, a, b) -> List<Point>` removable discontinuities: places where the formula is undefined but both sides head to the same finite value |
| `Asymptote` | `(f) -> List<Line>`; `(f, a, b) -> List<Line>`. Vertical, horizontal and oblique |
| `Intersect` | `(f, g, a, b) -> List<Point>` (core had one point; list form added) |

**Approximation, limits, sequences**

| Command | Forms |
|---|---|
| `Taylor` | `(f, a, n) -> Function` degree-`n` Taylor polynomial about `x = a` |
| `Limit` | `(f, a) -> Number`; `(f, a, side: Text) -> Number` with `side` `"left"` or `"right"`; `a` may be `inf` or `-inf` |
| `Iterate` | `(f, x0, n) -> Number`; `IterateList(f, x0, n) -> List<Number>`; `Cobweb(f, x0, n) -> List<Point>` (the zig-zag points) |

**Differential equations**

| Command | Forms |
|---|---|
| `SlopeField` | `(g) -> Field`; named options `n` (grid size, default 25), `length` (0 to 1 of a cell, default 0.8), `x0 x1 y0 y1` (rectangle; default: the view) |
| `SolveODE` | `(g, x0, y0, x1) -> Function` solution of `y' = g(x, y)` from `(x0, y0)` to `x1` (to the left when `x1 < x0`); `(dy: Function2, dx: Function2, x0, y0, tEnd) -> Curve` the parametric form `dy/dx = dy/dx` driven by a hidden parameter, safe at vertical tangents |
| `NSolveODE` | `(rhs: List<expr>, s, vars: List<name>, init: List<Number>, s0, s1) -> List<Function>`: a system, one `Function` per variable; named options `stop` (an expression in `s` and the variables, ends the solve where it first becomes true), `rtol`, `atol` |

**Polynomial helpers (v1)**

`Degree(f) -> Number`, `Coefficients(f) -> List<Number>` (index `k` is the coefficient of `x^k`), `Polynomial(points: List<Point>) -> Function` (interpolating polynomial), `Numerator(f)`, `Denominator(f)` for rational functions.

**Accepted but not printed (aliases)** so a model that knows common names is not punished: `LeftSum RightSum UpperSum LowerSum RectangleSum TrapezoidalSum` (map to `Riemann`), `IntegralBetween` (to `Integral(f, g, a, b)`), `NIntegral` (to `Integral`), `TurningPoint` (to `Extremum`), `TaylorPolynomial` (to `Taylor`), `LimitAbove LimitBelow` (to `Limit` with a side), `RemovableDiscontinuity` (to `Hole`), `RootList` (to `Roots` with guesses), `ParametricDerivative` (to `Slope` of a curve, in `curves-loci`). Aliases need one core addition (section 14).

**Left out of v1, with the reason**

- `Factors`, `PartialFractions`, `ComplexRoot`: they need exact arithmetic over the integers or the complex numbers, which is a computer algebra system. Not in v1 (core design says no CAS).
- Exact `SolveODE` (closed-form solutions with an arbitrary constant): same reason. We solve numerically and say so. A later release can add a small pattern table (separable, linear first order).
- 3D graphs of two-variable functions: core design says no 3D. Two-variable functions are shown in 2D as heat maps and contours (`ui.md`, `curves-loci`).

## 2. How the reference app does it (plain words)

Read from `kernel/arithmetic`, `kernel/algos`, `kernel/cas`, `kernel/optimization`, `kernel/roots`, `kernel/interval`, `euclidian/plot` and the manual pages for these commands.

**Model.** A function is a formula tree plus a variable. Derivative, integral and Taylor commands rewrite that tree by rules and wrap the new tree as another function object. A conditional function is one tree node with a condition and branches, and the derivative of it is built branch by branch with no check at the joins. A function can carry an optional closed interval to which it is restricted. Polynomials get a special fast form with their own root finder. Every calculus command is an algorithm in the object graph, so results update when inputs change.

**Algorithms by command.**

| Area | What it does | Observation |
|---|---|---|
| Derivative | Symbolic on the tree. A "fast" variant skips tidying. Cached on the function | Good idea, but no fallback when a part has no rule |
| Definite integral | Two numerical rules of different order (Gauss-Legendre) compared against a tolerance, with a call budget; or the CAS when available. On the web the CAS is too slow, so it always goes numeric | Weak at end-point singularities; the manual itself warns about `ln` from 0 |
| Indefinite integral, limits, asymptotes (functions), exact ODE solutions, Taylor of symbolic input | Sent to the CAS (Giac, GPL). Failure comes back as plain undefined | We cannot use a CAS. We replace its useful part (section 8) |
| Roots in an interval | Samples the interval at a count derived from the screen, finds sign changes, polishes each with Brent's method, doubles the sample count while many roots are found | Results depend on the view size. Touching roots (double roots) are missed |
| Root near a start value | Brent on a bracket around the start, else Newton | Fine, but no reason when it fails |
| Extremum, inflection | Exact for polynomials (roots of derivatives). Numeric search in an interval for other functions | Interval form returns one point, and the manual warns about false extrema near jumps |
| Sums (rectangles, trapezoids) | Computes the sum and draws bars. Count capped at 10,000, silently | Bars are "a visual aid", not exact for large counts |
| Slope field | Evaluates `y'` on a grid of the view, draws unit-ish segments, handles quotient forms specially | Grid fixed to the view |
| ODE, first order | Fixed-step fourth-order Runge-Kutta (step 0.02) for the single-equation command | Fixed step: either wasteful or inaccurate |
| ODE system | A library's adaptive Dormand-Prince 5(4) integrator with set tolerances; results are stored as lists of points; any numeric exception makes all outputs undefined | Adaptive is right; error reporting is not |
| Limits, asymptotes | Entirely CAS; a failed CAS is undefined | Silent failure |

**Plotting a function.**

1. *Adaptive sampler.* The curve is sampled at least every 6 pixels (and at least 80 samples). Any stretch where the end points are more than about 10 pixels apart, or the path bends more than about 10 degrees, is split in half, to a depth of 16. A stack of already evaluated points avoids evaluating twice. An undefined end point triggers a search for a defined sub-interval (up to 8 splits). When a function is undefined at a point but the values on both sides are within about 5 pixels of each other the plot treats it as a hole and joins across. A jump is tested by bisecting to see whether the picture shrinks towards a point. If not, the pen is lifted.
2. *Interval-arithmetic mode.* A second plotter, used when switched on for one-variable functions made only of supported operations. It takes one slice of the x-axis per screen pixel and computes, for that whole slice at once, an interval that is guaranteed to contain every value the function takes there. It then draws the vertical extent of each slice and joins neighbours. Division by an interval containing zero yields "everything outside a gap", which tells it that the curve shoots up on one side and down on the other. It handles zoom stops by resampling and panning by extending the stored slices at one edge.

**What works.** The adaptive sampler is quick and good on smooth curves. Interval mode never misses a narrow spike and draws poles correctly.

**What is weak.** The adaptive sampler can step over spikes narrower than its sample spacing. It decides poles by guesses (the 5-pixel rule). Interval mode takes one slice per pixel with no refinement, so overestimates show as fuzz, it covers limited operations, and it is a separate mode with separate code. Roots, implicit curves and the integrator all depend on the screen or on the clock in places. The CAS dependency hides failures.

## 3. Our design in one picture

```text
 line text ──parse──▶ Expr (typed tree) ──┬─▶ Real algebra     (fast numbers)       ─┐
                                          ├─▶ Interval algebra (guaranteed boxes)   ─┤
                                          ├─▶ Dual/Jet algebra (derivatives, series)─┼─▶ commands
                                          └─▶ Symbolic rewrite (diff, integral, simplify)
                                                                                     │
 commands (Derivative, Roots, Integral, Limit, Taylor, ODE, ...) ◀───────────────────┘
        │ values (Function, Region, List<Point>, ...)           ┌─ plot package ─┐
        └──────────────────────────────────────────────────────▶│ function plotter│─▶ view
                                                                └────────────────┘
```

One expression tree, evaluated by several small "algebras" that all share the same walker. That one decision replaces the reference app's separate tree walkers for numbers, intervals and derivatives, and makes every numeric method below work on every function without special cases.

## 4. Types and data structures

New and changed value types (the core type list in section 4 of the core design is extended, see section 14):

```ts
/** A set of x values, as sorted disjoint spans. */
interface Span { lo: number; hi: number; loOpen: boolean; hiOpen: boolean }
type Domain = readonly Span[];            // [] means empty; whole line is one span (-inf, inf)

/** The typed formula tree. Immutable. Shared by all algebras. */
type Expr =
  | { k: 'num'; v: number }
  | { k: 'var'; slot: number }                         // a bound parameter (x, y, k, ...)
  | { k: 'ref'; id: number }                           // another object's current value (slider, point coord, ...)
  | { k: 'un'; op: 'neg'; a: Expr }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Expr; b: Expr }
  | { k: 'call'; fn: BuiltinName; args: readonly Expr[] }
  | { k: 'user'; id: number; args: readonly Expr[] }   // call of another Function object
  | { k: 'if'; arms: readonly { cond: Expr; then: Expr }[]; otherwise: Expr | null }
  | { k: 'cmp'; op: '<' | '<=' | '>' | '>=' | '==' | '!='; a: Expr; b: Expr }
  | { k: 'logic'; op: 'and' | 'or' | 'not'; args: readonly Expr[] };

interface FunctionValue {
  readonly kind: 'function';
  readonly params: readonly string[];       // length 1 → Function; length 2 → Function2
  readonly result: 'number' | 'bool';       // 'bool' → Predicate / Predicate2 (curves-loci)
  readonly body: Expr;
  readonly domain: Domain;                  // from `in lo..hi` and from `if` without otherwise
  readonly version: number;                 // bumps whenever any referenced value changes
  readonly meta: { exact: boolean; text: string; polynomial?: readonly number[] };
}

interface RegionValue {                     // result of AreaUnder, Riemann
  readonly kind: 'region';
  readonly shape:
    | { t: 'under'; f: FunctionValue; g: FunctionValue | null; a: number; b: number }
    | { t: 'bars'; f: FunctionValue; a: number; b: number; n: number; rule: SumRule; offset: number };
  readonly value: number;                   // signed
  readonly area: number;                    // unsigned (sum of |pieces|, split at sign changes)
}

interface OdeSolutionPiece { s0: number; s1: number; knots: Float64Array; dense: Float64Array }
```

Rules about values:

- `Function` call outside its `domain`, or in an `if` with no matching branch, gives `NaN` internally and `undefined(out_of_domain)` when reported. A slot read of `NaN` never throws.
- Evaluation entry points, used by everything: `real(f)(x): number`, `interval(f)(X: Iv): IvSet`, `dual(f)(x): {v, d}`, `jet(f, n)(x): Float64Array`. Each is built once per `version` and cached.
- `FunctionValue.meta.text` is the printed formula after simplification. It is what `figure` shows and what labels draw.

**Evaluation environment.** `ref` nodes read from a flat `Float64Array` of object values owned by the kernel. A slider move writes one slot and bumps the `version` of the dependent functions. No recompilation: the compiled closures already point at the slots.

## 5. The algebras

One walker, `fold(expr, algebra)`, builds a closure tree. An algebra provides: numbers, variables, the five operations, every built-in function, comparison, and `if`.

| Algebra | Value | Used for |
|---|---|---|
| Real | `number` | plotting samples, sums, ODE right-hand sides, everything hot. Hand-specialised closures, no allocation |
| Interval | `IvSet` (below) | pole and gap detection, root isolation, global bounds, implicit curve culling, inequalities |
| Dual | `{v, d}` | first derivative at a point: Newton, tangent, `Slope`, extrema |
| Hyper-dual | `{v, d1, d2}` | second derivative: curvature, inflection |
| Jet(n) | `Float64Array(n+1)` of Taylor coefficients | `Taylor`, `Limit` series path, `Hole` |
| Symbolic | `Expr` | `Derivative`, `Integral`, simplifier |

**Interval sets.** Real intervals are not enough because `1/x` over `[-1, 2]` is "everything outside the gap `(-1, 0.5)`". An `IvSet` is:

```ts
interface IvSet {
  readonly n: 0 | 1 | 2;               // number of pieces; 0 = nothing (the function is undefined everywhere here)
  readonly lo0: number; readonly hi0: number;
  readonly lo1: number; readonly hi1: number;     // second piece when n = 2
  readonly def: 0 | 1 | 2;             // 0 undefined everywhere on the box, 1 maybe undefined somewhere, 2 defined everywhere
}
```

Two pieces are enough for every built-in. More than two merge into their hull, which is a sound over-estimate. `def` is what lets the plotter tell a hole (maybe undefined at one point) from a gap (undefined on the box).

**Outward rounding.** JavaScript has no directed rounding. After each operation the result is widened by one unit in the last place on each side (`prevDouble`, `nextDouble` through a shared `Float64Array`/`Uint32Array`). For `sin cos exp ln` and friends, which the platform computes to within about one unit in the last place, widen by 4. This makes the enclosures sound for plotting, root isolation and culling; it is not a formal proof of correctness and we say so in code comments.

**Better enclosures.** Naive interval evaluation over-estimates when a variable appears twice (`x - x`). Two measures: (1) subdivide boxes (the callers always do); (2) a mean-value form: `f(c) + f'(X) (X - c)` using the Dual algebra on the interval, intersected with the naive result. That cuts the over-estimate from first order to second order in the box width.

**Tri-state truth.** Comparison on intervals gives `true | false | maybe`. `if` on `maybe` returns the hull of the branches that may apply. `and`/`or`/`not` use three-valued logic. This is what makes piecewise functions and inequalities work in interval mode.

## 6. Piecewise functions, domains, two variables

### Piecewise

`if(c1, a, c2, b, ..., otherwise)` evaluates lazily (only the chosen branch is touched) so a branch can safely be `sqrt(x)` where `x >= 0` is the condition. An even number of arguments means there is no `otherwise`: if no condition holds the value is `undefined(out_of_domain)`.

**Break points.** `breaks(expr)` walks the tree and returns the x-values where the function may change form: for each `cmp` whose one side is the variable and the other side does not contain it, the other side's value. Also the kinks of `abs`, `floor`, `ceil`, `round`, `sign`, `min`, `max`, `clamp`, `step`, `mod` (found by solving the argument `= 0`, `= k` over the visible or requested interval; for linear arguments exact, otherwise by `Roots`). Breaks serve three consumers: the integrator splits there; the plotter inserts exact samples on both sides and draws the open/closed circles; `Extremum` tests them as candidates.

**Derivative of a piecewise function** is the piecewise of derivatives. At a break `c` where the two one-sided derivatives differ by more than `1e-9` (relative), evaluating the derivative exactly at `c` gives `undefined(corner)`, not a value from whichever branch the condition happened to select. (The reference app's version silently picks a branch.)

### Restricted domains

`f(x) = expr in a..b` sets `domain = [a, b]`. The bounds are expressions, so `f(x) = x^2 in 0..k` follows a slider. `in` bounds are closed. Open bounds come from `if(0 < x < 3, ...)`. The domain is the intersection of the `in` span and the spans implied by an `if` with no `otherwise` when each condition is a comparison of the variable with bounds; otherwise the domain is "whole line, with holes decided at evaluation".

Rules that propagate domains: `Derivative` keeps the domain (minus corners); `Integral(f)` keeps it; `f + g` intersects; composition `f(g(x))` is evaluated, not intersected, so the restriction shows up as `undefined` where it applies.

### Two variables

`g(x, y) = expr` is a `Function2`. It supports:

- evaluation `g(1, 2)`;
- partial derivatives `Derivative(g, x)`, `Derivative(g, y, 2)` (symbolic, same rule table);
- partial integrals `Integral(g, y)`;
- `Integral(g, y, a, b) -> Function`: a function of the other variable, computed with the same adaptive quadrature at each evaluation (the inner integral is evaluated lazily and memoised by the outer variable's value);
- as the right-hand side of `SlopeField` and `SolveODE`;
- as the field of an implicit curve and as contour/heat-map input in `curves-loci`.

A `Function2` has a `Domain2`: v1 supports a rectangle-or-all domain only (`in x0..x1, y0..y1`).

## 7. Symbolic engine (no CAS, small and exact)

The symbolic algebra is a rewriting step on `Expr`. It is deliberately small.

### Differentiation

`diff(e, v)`: a rule table, one entry per built-in (`sin cos tan asin acos atan sinh cosh tanh sqrt cbrt exp ln log10 log2 abs sign floor ceil round hypot atan2 min max clamp lerp smooth` and `^` with variable base, exponent or both, and `user` calls via the chain rule through the called function's own derivative). `floor ceil round sign step` have derivative `0` everywhere defined; `abs` gives `sign(x) * x'`; `min/max/clamp` give `if` forms. A body containing `rand`, `noise`, `mod` with a variable divisor, or a `ref` to a non-numeric value has no rule: `Derivative` fails with `not_differentiable` and the hint names `NDerivative`.

### Simplification

A fixed-point rewrite with about twelve local rules, run to a fixed point with a step cap of 200, in this order:

1. Fold constants (`2 * 3` to `6`; exact rationals when both sides are integers, otherwise floats).
2. Identity and zero: `a + 0`, `a * 1`, `a * 0`, `a ^ 1`, `a ^ 0`, `0 / a`.
3. Flatten sums and products; order terms (numbers first, then by degree in the variable, then by name).
4. Combine like terms: `x + x` to `2 x`, `a x + b x` to `(a + b) x` only when both coefficients are numbers.
5. Combine powers: `x * x` to `x^2`, `x^a * x^b` to `x^(a + b)` for numeric `a, b`.
6. `-(-a)` to `a`; `a - -b` to `a + b`.
7. `exp(ln(a))` to `a` only when `a` is provably positive (a square, an exp, a positive number); likewise `sqrt(a^2)` to `abs(a)`.
8. Push negation into products for printing.

No factoring, expansion or cancellation of rational functions. The derivative of `x^3 + x^2 + x` prints `3 x^2 + 2 x + 1`; of `sin(x) / x` prints `(x cos(x) - sin(x)) / x^2`. Numbers print with up to 10 significant digits and are rationalised to a fraction when a continued fraction within 1e-12 is shorter than 7 characters.

### Antiderivatives

`antiderivative(e, v): Expr | null` by a table, applied to a sum term by term with constant factors pulled out:

- powers `x^n` (including `n = -1` → `ln(abs(x))`), `a^x`, `exp`, `sin`, `cos`, `tan` (→ `-ln(abs(cos(x)))`), `sinh`, `cosh`, `1/(1+x^2)`, `1/sqrt(1-x^2)`, `ln(x)`, `sqrt`;
- linear substitution: if the argument of an elementary function is `a v + b` with `a` constant, divide by `a`;
- one level of integration by parts for `x^n * (exp | sin | cos)(a x + b)` and `x^n * ln(x)` with small integer `n`;
- partial fractions only for a denominator that is a product of distinct linear factors (found from `Roots`), numerator of lower degree;
- anything else returns `null`.

On `null`, `Integral(f)` falls back to the numeric antiderivative (below) and marks `meta.exact = false`; the printed text is `integral of f from 0`.

### Numeric antiderivative

`F(x) = c + ∫_{x0}^{x} f` where `x0 = 0` by default or the `through` point. It is a `FunctionValue` whose `real` closure uses a **panel cache**: the real line is cut into panels of power-of-two width; each panel's integral is computed once by adaptive quadrature and kept; `F(x)` is a prefix sum of panel integrals plus a partial panel. Sequential evaluation (plotting) therefore costs one quadrature per panel overall, not one per sample.

## 8. Numerical methods

### 8.1 Definite integral

- **Method.** Adaptive Gauss-Kronrod 7/15 on a priority queue ordered by error estimate; always bisect the worst panel. Wynn epsilon extrapolation on the sequence of partial results for end-point singularities (this is the QUADPACK "QAGS" family of ideas, standard textbook material).
- **Improper bounds.** `inf` or `-inf` bounds use `x = a + t / (1 - t)`, `t ∈ [0, 1)`; both infinite bounds split at 0.
- **Break points** from section 6 split the interval first, so `abs`, floor and piecewise integrands are exact to rounding.
- **Singularities inside.** If an interior sample is non-finite, bisect around it for up to 40 levels; if the contributions near it do not shrink the result is `undefined(diverges)` with `at` = the location.
- **Tolerance.** Absolute `1e-10`, relative `1e-10`, whichever is looser; at most 2,000 panels (30,000 evaluations). Hit the limit: return the best estimate with `err` and `reason: 'step_limit'` on the value (not undefined) so a teacher can still say it, with `hint` to split the interval.
- **Deterministic.** No clock; budget is counted in evaluations.
- **Speed.** A smooth integrand: about 45 evaluations, under 0.1 ms. Median textbook integrand under 0.3 ms.

### 8.2 Sums

`Riemann(f, a, b, n, rule)`:

- `left`, `right`, `mid`, `offset`: `h Σ f(a + (i + o) h)`. Kahan-compensated summation.
- `trapezoid`: `h (f(a)/2 + Σ f(a + i h) + f(b)/2)`. `simpson` requires even `n` (otherwise `n + 1` is used and the result says so).
- `upper` and `lower`: per slice, the exact supremum or infimum. For each slice, evaluate the Dual algebra's derivative interval over it. If the derivative interval excludes zero, the extremum is at an end point. Otherwise find the critical points by Brent on `f'` inside the slice (at most 3 iterations of bisection to bracket, then Brent to `1e-12`). Slices where the function is non-differentiable (break points) include the break point as a candidate.
- `n` up to `100,000` (error `limit` above that). Drawing groups bars narrower than one pixel into a filled area (`ui.md`).
- `RegionValue.value` is the signed sum, `.area` the sum of absolute values per slice.

### 8.3 Roots

`Roots(f, a, b)` deterministic and screen-independent:

1. **Isolate.** Branch-and-bound with the Interval algebra: put `[a, b]` in a stack. For a box `X`: evaluate `F(X)`. If `0 ∉ F(X)` discard. If the mean-value form's derivative interval `F'(X)` excludes 0 and `F(lo) F(hi) <= 0`, the box holds exactly one simple root: hand to the refiner. If width is below `1e-9 (b - a)` and `0 ∈ F(X)`, report a candidate (a tangential or multiple root). Otherwise bisect.
2. **Refine.** Brent's method on the bracket (`xtol = 4 ε |x|`, `ε` = machine epsilon). For candidates (even multiplicity or zeros of both `f` and `f'`) refine with Newton on `f'` and then report the root with multiplicity 2 (or more, by repeating on higher derivatives up to 4).
3. **Sort and deduplicate** within `1e-12 (1 + |x|)`.
4. **Fall back** when the body is not interval-evaluable (a user function whose body uses an unsupported operation, such as `noise`): sample 1,024 points (+ break points) for sign changes and local minima of `|f|`, polish. Result carries a flag `rigorous: false` that `figure` reports.

Targets: a degree-8 polynomial on `[-10, 10]`: all roots to `1e-13` in under 1 ms; `sin(1/x)` on `[0.01, 1]` finds the 62 roots in under 10 ms.

`Roots(f)` for polynomial or rational functions: find the polynomial coefficients (`meta.polynomial`, or numerator and denominator after tree-to-polynomial conversion), then use Sturm's sequence for the count of real roots and bisection/Newton inside isolating intervals; coefficients that are not numbers (they depend on sliders) are fine because values are plugged in at evaluation time. A rational function's roots are the numerator's roots that are not also denominator roots (within `1e-9`; those become `Hole`s).

`Root(f, a, b)`: the leftmost root from the list above, cheaper: stop at the first. `Root(f, x0)`: Dual-algebra Newton with step damping; if 40 steps fail, expand a bracket outward from `x0` by doubling to 60 doublings and use Brent. Reasons: `no_root`.

`Intersect(f, g, a, b)`: roots of `f - g`, mapped to points `(x, f(x))`.

### 8.4 Extrema and inflection

- Critical points are `Roots(f')` using the Dual/Interval pair (interval enclosure of `f'` from the Dual algebra on boxes).
- Kinks: for each break point from section 6 where `f` is continuous, compare `f` at `c ± δ` with `δ = 1e-6 max(1, |c|)`.
- Classification: sign change of `f'` around the point (by evaluating at midpoints between neighbouring critical points) gives minimum or maximum; no sign change gives a saddle (not an extremum).
- `Inflection`: roots of `f''` (Hyper-dual) with a sign change of `f''` across them.
- `Maximum/Minimum(f, a, b)`: candidates are the end points, interior critical points and breaks; pick the best. A guaranteed bound check by Interval algebra on the chosen result (if the enclosure of `f` over `[a, b]` exceeds the pick, run a global branch-and-bound).
- Accuracy `1e-12` in `x`; the `y` value is `f(x)` directly.

### 8.5 Series, Taylor, limits

**One series module**, used twice.

`Series` is a truncated power series in `h = x - a` with coefficients in float64 (and exact rationals when all inputs are integers or simple fractions; used only for printing). Operations: `+ - *`, division, power with real exponent, composition, and the built-ins lifted by the standard recurrences (`exp`, `ln`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `sinh`, `cosh`, `tanh`, `sqrt`). Cost `O(n^2)` per multiply. Maximum order 40.

`Taylor(f, a, n)`: evaluate `f` in the Jet(n) algebra at `a`. Coefficients `c_k = f^(k)(a) / k!` come out directly. The result is the polynomial `Σ c_k (x - a)^k` as a `FunctionValue` with `meta.polynomial` set; its printed text rationalises coefficients. Because the coefficients are numbers read at evaluation time, a slider on `a` animates the polynomial. Accuracy: coefficients to about `1e-12` relative for order up to 12.

`Limit(f, a)`:

1. **Direct.** If `f` is defined and the Interval enclosure over `[a - δ, a + δ]` shrinks to a point as `δ → 0` (check at δ = 1e-3, 1e-6), the limit is `f(a)`.
2. **Series.** Substitute `x = a + h` (or `x = 1/h` for infinite `a`); evaluate in the Series algebra with Laurent terms allowed (a series carries a starting power `m`, possibly negative, so `1/x` is `h^-1`). The lowest non-zero term decides: power `> 0` gives 0; power `= 0` gives its coefficient; power `< 0` gives `±inf` (sign from that coefficient and the side; if the two sides disagree, a two-sided limit does not exist: `undefined(no_limit)` with both one-sided values in `detail`). If cancellation leaves zero coefficients up to the order cap, raise the cap twice (order 10, then 20, then 40) before giving up. This handles `sin(x)/x`, `(1 - cos x)/x^2`, `(e^x - 1 - x)/x^2`, `x ln x`, `(1 + 1/x)^x` at infinity (via `exp` and `ln` of series), and all rational functions.
3. **Numeric extrapolation.** If the series route cannot lift an operation (`floor`, `abs` at the point is handled by sides; `sign`; user functions with unsupported nodes), evaluate at `a ± 10^-k` for `k = 2..14` (or `a = ±10^k`), then apply Wynn's epsilon algorithm. Accept when the last three extrapolated values agree to `1e-9` relative; classify growth if the values grow monotonically with ratio near `10`; otherwise `no_limit` (oscillating). The value is marked `exact: false`.
4. Results with `inf` are legal `Number` values; `undefined(no_limit)` when the limit does not exist.

Targets: 95% of limits in a standard calculus text handled by routes 1 and 2 (exact); 1 ms typical, 10 ms worst.

**One-sided limits and piecewise functions.** `side = "right"` evaluates `h > 0`; branches decided by `cmp` against the break value are chosen by the side. This is what the reference app's manual tells users to use `LimitAbove/Below` for; we do it automatically when `Limit` hits a break (two-sided: compute both sides, agree or `no_limit`).

### 8.6 Asymptotes

`Asymptote(f, a, b)` (default `a, b = -100, 100`; stated in the catalogue entry):

- **Vertical.** Candidates: roots of every denominator of a `/`, of cosine inside `tan`, of the argument of `ln` and `log` (boundaries where the argument reaches 0), and of any interval-detected pole: bisect the Interval algebra for boxes where `F(X)` has an unbounded piece (an `IvSet` piece reaching ±inf). Confirm each candidate `c` with `Limit(f, c, "left")` and `Limit(f, c, "right")`; keep it when at least one side is `±inf`. (A candidate with finite equal limits is a `Hole`.)
- **Horizontal and oblique, each end.** `m = Limit(f(x) / x, ±inf)`; when finite and non-zero, `c = Limit(f(x) - m * x, ±inf)`; when `m` is 0, `c = Limit(f, ±inf)`. Finite results produce `Line`s `y = m x + c`; when both ends give the same line it is reported once.
- Result sorted: vertical by `x`, then horizontal, then oblique. Each line has `meta.side` (`"left"`, `"right"`, `"both"`) so the plotter can draw it dashed over only the relevant ranges if the UI wants that.

For the rational function `(x^3 - 2 x^2 - x + 4) / (2 x^2 - 2)` this returns the two vertical lines `x = ±1` and the oblique `y = x/2 - 1`.

### 8.7 Holes

`Hole(f, a, b)`: candidates are the zeros of denominators and arguments found by `Roots`; for each, if `f` is undefined at it and `Limit(f, c)` is finite and the two one-sided limits agree, report `(c, limit)`. The plotter also uses holes to draw the open circle without a command.

### 8.8 Iterates and cobweb

Plain loops on the Real algebra. `n <= 100000`. `Cobweb` returns `2n + 1` points `(x0, 0), (x0, f(x0)), (f(x0), f(x0)), ...`. Orbits that become non-finite end the list and the object says `undefined(not_finite)` only if the first step fails; otherwise it returns the points so far with a hint in `figure`.

### 8.9 Differential equations

**Integrator.** Dormand-Prince 5(4) with the standard 7-stage tableau, first-same-as-last, PI step-size control (`safety 0.9`, grow `<= 5`, shrink `>= 0.2`), initial step from the standard first-step estimate.

| Option | Default |
|---|---|
| `rtol` | `1e-8` |
| `atol` | `1e-10` |
| max steps | 200,000 |
| min step | `1e-14 (1 + |s|)` |

**Dense output.** The integrator's own continuous extension of order 4 (the standard published Shampine interpolant), stored per step as 5 coefficients per variable. So each solution is a piecewise polynomial `s ↦ y(s)` evaluated in O(log steps) by binary search and then a Horner step. This is what `y[1](2.5)` and the plotter call. The plotter never needs to re-solve on zoom.

**Events.** `stop = expr`: after each step check the expression's sign; on a change, locate the root with bisection on the dense output to `1e-12` and end the solution there. The solution's domain ends at that point.

**Blow-up and stiffness.** If the step shrinks below the minimum step: `undefined(blowup)` if the value was growing fast (`|y| > 1e8` or ratio of successive steps below 1e-3 for 10 steps), else `undefined(stiff)` with the hint to shorten the interval (a stiff solver, a Rosenbrock method, is a follow-up). The partial solution up to the last accepted step is still kept as the function's domain, so the plot shows the curve up to the trouble.

**Scalar first-order.** `SolveODE(g, x0, y0, x1)` runs the same integrator with one variable and `s = x`. It returns a `Function` with domain `[min(x0, x1), max(...)]` clipped at a blow-up.

**Parametric form.** `SolveODE(dy, dx, x0, y0, tEnd)`: the system `x' = dx(x, y)`, `y' = dy(x, y)`; stops at `tEnd` (negative runs backwards). It returns a sampled `Curve` (the dense output as piecewise polynomial in both coordinates).

**Systems.** `NSolveODE([rhs1, rhs2, ...], s, [v1, v2, ...], [init1, init2, ...], s0, s1)`. The right-hand sides are expressions in the binder names `s, v1, v2, ...`; they compile in the Real algebra with the state vector as the variables. A second-order equation `y'' + b y' + c y = f` is written as the system `[v, f - b v - c y]` with `vars = [y, v]` (the catalogue entry shows the pattern).

**Cost.** A two-variable system with 2,000 steps: 14,000 right-hand-side evaluations, under 3 ms. A slider-driven solve at 60 fps is fine up to about 3,000 steps; the kernel keeps the last result and re-solves only when an input changes, and in a film the solve is done once (it does not depend on `t` unless the author wrote `t` in it).

**Determinism.** No clock budgets anywhere. All limits count steps and evaluations.

### 8.10 Slope fields

`SlopeField(g)` is a `Field` value: it stores `g`, `n`, `length` and the rectangle (or "the view"). The view package samples it: for each cell centre `(x_i, y_j)` evaluate `s = g(x_i, y_j)`; in **screen space** the direction is `(1, -s * (yScale / xScale))` normalised to the cell size times `length`, so steep slopes and non-square axes look right. Cells where `g` is non-finite are skipped (with a faint dot so the learner sees a gap, not an omission). Quotient fields `g = p / q` where `q` can be zero (`dy/dx = x / y`) are drawn as vertical segments when `q = 0` and `p ≠ 0`, via a small rewrite `dir = (q, p)` before normalising — which also removes any special handling of "quotient" forms.

## 9. The adaptive function plotter and interval mode, in plain words

### Plain-words explanation

*Plotting by points.* Pick many x values, compute f at each, join the dots. Cheap and nice for smooth curves. The risk is what happens between the dots: a narrow spike can sit between two samples and vanish; a pole (like `1/x` at 0) can be drawn as a false line joining the two sides; a function with a hole can look unbroken.

*Adaptive* points: put more dots where the curve changes direction quickly or where neighbouring dots are far apart on screen. It cuts the risk, but it still cannot be certain that nothing hides between two dots.

*Interval arithmetic*: instead of asking "what is f(3.2)?", ask "what are all the values f can take for x between 3.2 and 3.3?" The answer is a range that is guaranteed to hold every value, though it may be wider than needed. Do that for every thin vertical slice of the picture. A slice whose range is small gives the curve's height there. A slice whose range is huge or has two infinite ends contains a pole. A slice whose answer is "no values" has no curve there. Nothing can hide, because each slice is covered. The cost is some blur: ranges are sometimes wider than the true curve, so they must be made thinner by cutting slices smaller.

### Our design: a single hybrid, always on

The hybrid keeps the cheap sampler for what it is good at and calls interval arithmetic only where certainty matters. The user never chooses a mode.

**Inputs.** `FunctionValue`, `ViewBox {x0, x1, y0, y1, widthPx, heightPx}`, `devicePixelRatio`.

**Output.** `PlotResult`:

```ts
interface PlotResult {
  paths: Float64Array[];            // polylines in view-pixel coordinates, one array per connected piece: x0,y0,x1,y1,...
  markers: PlotMarker[];            // hole, closedEnd, openEnd, pole (x), jump
  inkColumns: { x: number; y0: number; y1: number }[];  // sub-pixel oscillation: vertical hairlines
  stats: { evals: number; intervalEvals: number; maxDepth: number; complete: boolean };
}
```

**Algorithm (per function per view).**

1. *Pieces.* Split the visible x-range by `domain` spans and by `breaks(expr)`. Each piece is plotted on its own. Exact samples are placed at each end of a piece (open ends drawn as open circles).
2. *Coarse samples.* `m = max(64, widthPx / 4)` evenly spaced samples (cache keyed by `(version, x0, x1, widthPx)`; pan reuses samples, zoom reuses none but draws the previous result scaled until the new one is ready).
3. *Refine with a screen-space test.* For each pair of neighbouring samples `(p, q)` in pixel coordinates evaluate the midpoint `r`. Split the pair if the midpoint's distance to the chord `pq` exceeds `0.25 px`, or if `|q - p|` (length in pixels) exceeds `8 px`. Depth limit 14 (so the finest step is `1/16384` of a sample gap). Counting evaluations, not time. The stack reuse trick (evaluating each point once) applies.
4. *Classify suspicious pairs.* After refinement, a pair is suspicious if any of: one end is non-finite; the two ends are on opposite sides of the view by more than `2 heightPx`; the pair still fails the screen tests at the depth limit.
5. *Verify with intervals.* For a suspicious pair over `[xl, xr]` evaluate the Interval algebra on that stretch and then recurse on halves until the stretch is under `0.1 px` wide or the enclosure is clean. The verdict:
   - enclosure bounded and `def = 2`: the function is continuous there and the huge slope is real (a steep rise); draw the polyline through the refined samples; no break.
   - `def = 0`: gap; end the path at the last defined sample; resume at the next.
   - `def = 1` on a tiny stretch and the neighbours finite and close: a **hole**; join across and add a hole marker at the stretch centre.
   - enclosure has an unbounded piece: a **pole** at the location where the unbounded piece lies. Cut the path there; extend each side's path to the view edge in the direction of its sign (up if the near values are positive and growing, down if negative). Add a `pole` marker; the UI may draw the vertical asymptote line dashed.
   - enclosure bounded but the two sides differ by a gap that does not shrink with width: a **jump**: break the path, add `closedEnd/openEnd` markers according to which side the function's value at the break belongs to (evaluate the function exactly at the break value).
6. *Sub-pixel oscillation.* If after depth 14 a column still fails the bend test (`sin(1/x)` near 0), stop refining that column and emit an `inkColumn` spanning the column's enclosure (from the interval evaluation), clipped to the view, instead of a sawtooth.
7. *Emit paths.* Convert to pixel coordinates; clip y to `[-4 heightPx, 5 heightPx]` (so stroking never has to cover astronomical numbers); join consecutive samples; `Path` objects are ready for the canvas or SVG graphics interface.

**Budgets.** About 1,200 function evaluations for a smooth curve at 1,000 px; at most 20,000 for a hard one; interval evaluations only on suspicious pairs, typically 0 to 50. Target time on a mid-range laptop: smooth `sin(x)+x^2/10` under 0.3 ms; `tan(x)` across 12 poles under 1.5 ms; `sin(1/x)` under 5 ms; `floor(x)` under 0.5 ms. The plot runs in the animation frame when the function version or view changes; it never blocks (`stats.complete` is false if a frame budget of 4 ms was exceeded and the remainder resumes next frame; the final result is identical regardless of how it was sliced).

**Cache and incremental update.** The cache stores the refined sample list per piece. A pan trims one side and extends the other. A change of `version` discards. A zoom keeps the previous `PlotResult` as a scaled preview until the new one is complete.

**Output stability for films.** For a given `(function version, view, pixel size)` the result is a pure function. So exported frames are identical on every machine.

### Interval-arithmetic mode as a user-visible aid

An option `with exact = true` on a function draws its enclosure instead: the thin vertical extents per pixel. Useful in class to show "why this looks like a wall"; it is the same code path with stage 5 applied everywhere, drawn as a light band. Default off.

## 10. How it plugs into the kernel

**Types.** Added to the type table: `Function2`, `Predicate`, `Predicate2` (the last two are drawn by `curves-loci`), `Field`, plus `Region` fields `.value`, `.area`. `Number` may be `±inf`.

**Commands.** All calculus commands are `CommandSpec` entries with `group: 'functions'`. A form's `rule` factory receives checked inputs and returns an object `{ inputs, compute(ctx): Value | Undefined }`. Heavy computations are `compute` closures; they read input values from the flat value array, and write one output (a `List<Point>` is one object with a variable number of points).

**Dependency edges.** A function object's inputs are the objects its body `ref`s plus the functions it `user`-calls. `Derivative(f)` has `f` as input; when `f` changes, its derivative's body is rebuilt (cheap) and its `version` bumps.

**Caching and invalidation.** Each command result stores the `version` stamps of its inputs; a rule runs only when a stamp changes. Sliders animate commands through the normal update pass.

**Undefined propagation.** If any input is undefined, the output is `undefined(input_undefined)` with `detail` naming the input, so `Roots` of an undefined function says why.

**Time.** `t` is a free variable like any `ref`. A function of `t` is simply a function whose `ref` list includes the clock; the player bumps its version each frame. The ODE and quadrature caches therefore re-run when `t` is inside a body, and are free otherwise.

**Package split.** Pure maths (`expr`, algebras, symbolic, series, quadrature, roots, ode) lives in `packages/kernel/src/calculus`. The plotter (`plotFunction`, implicit tracer, inequality fill) is pure geometry, so it lives in a new `packages/plot` that imports `kernel` and has no DOM; `view` draws its output. Reason: the live teacher can call the plotter to check what the learner will see (for example, whether an asymptote is visible), and tests can run it in Node.

## 11. Edge cases

- `f` with a user call cycle: caught at definition (`cycle`).
- Division by exactly zero in a Real sample gives `±inf`; treated as non-finite → plot pole logic.
- `0^0` is `1` in `^` with integer exponent (polynomial convention) and `undefined` otherwise (`ln(0)` forms).
- Negative base with a fraction exponent: `(-8)^(1/3)` is `-2` when the exponent is a ratio of integers with an odd denominator, else undefined (matches the classroom reading). `cbrt` is always real.
- `Integral(f, a, b)` with `a > b` is the negative of the swapped value. `Roots(f, a, b)` with `a > b` swaps (the order is not a mistake in intent) and the result carries a note in `figure`.
- Huge intervals: `Roots(f, -1e9, 1e9)` works (interval bisection is logarithmic), but `Asymptote` and `Extremum` with spans above `1e6` get `limit`.
- `Taylor` order `0` is the constant; negative or non-integer order is `bad_argument` at line time or `undefined(bad_argument)` when the order comes from a slider.
- `Slope(f, x0)` at a corner is `undefined(corner)`; use `Limit` of the difference quotient from a side.
- A `Function` that is constant gets `Roots = []` (empty list, not undefined) unless it is identically zero: `undefined(identically_zero)`.
- Functions of `t` in `SlopeField`: the field is drawn for the current `t`.
- Interval `IvSet` with NaN input: output `n = 0`.

## 12. Better than the reference app

1. **No CAS, but fewer silent failures.** Limits, Taylor, asymptotes and indefinite integrals have a deterministic engine (series algebra, rule table, panel cache) that works in the browser and in Node, and every failure says why.
2. **Screen-independent roots.** Interval branch-and-bound finds every simple root and flags touching roots, regardless of window size. The reference app's depend on the view size and miss tangential roots.
3. **Derivatives that never print a wrong value at a corner**, and a numeric fallback (automatic differentiation) for any body.
4. **One expression tree, many algebras.** A new built-in costs one entry per algebra, not a new walker per feature.
5. **Exact upper/lower sums** by critical points, not by sampling.
6. **Piecewise-aware integrals and extrema**, because break points are known.
7. **Hybrid plotter**: adaptive speed plus interval certainty only where needed; poles, holes and jumps are classified and drawn (open circles, dashed walls), not guessed from a pixel rule.
8. **Dense-output ODE solutions as real functions** (`y[1](2.5)`, plot, differentiate, integrate, intersect), with events, and no clock-dependent behaviour.
9. **Deterministic results**: same inputs give the same figure on every machine; budgets count evaluations, not milliseconds.
10. **A single object for variable-size results**: `Roots` returns a list that grows and shrinks with a slider, without creating or deleting named objects behind the author's back.

## 13. Build order for this area

1. `Expr` typed tree; Real algebra; function definition lines; simple plotter (adaptive only).
2. Dual and Interval algebras; hybrid plotter with poles/holes/jumps.
3. Symbolic: `diff`, simplifier; `Derivative`, `Slope`, `Tangent`, `Normal`.
4. Quadrature; `Integral`, `AreaUnder`, `Riemann`.
5. Roots, `Extremum`, `Inflection`, `Intersect`, `Hole`.
6. Series; `Taylor`, `Limit`, `Asymptote`.
7. ODE integrator; `SolveODE`, `NSolveODE`, `SlopeField`.
8. Polynomial helpers, iteration, antiderivative table.

Each step ends with golden tests (known values), property tests (derivative against a finite difference, integral against a high-order rule, roots against polynomial companion matrix) and the speed targets above.

## 14. Changes to the core design

1. **Types.** Add `Function2`, `Predicate`, `Predicate2`, `Field` to the type table; `Region` gets `.value` and `.area`; `Number` may be `±inf`; add constant `inf`. Reason: calculus and inequalities need them and the core table has one `Function` type.
2. **Function lines accept a range.** `function = name "(" ... ")" "=" expr [ range ] [ style ]` where `range` restricts the domain (core allowed `range` only on `define`, where it means "slider"). Reason: restricted domains are common in lessons and `in` already reads that way.
3. **`if` takes more arms.** `"if" "(" expr "," expr { "," expr "," expr } [ "," expr ] ")"`: two arguments is valid (no otherwise), three is the old form, longer lists add arms. Reason: piecewise functions with three or more pieces.
4. **Chained comparisons.** `compare = sum { op sum }` where all operators lean the same way (`<`/`<=` or `>`/`>=`), meaning "and" of neighbours. Reason: `0 <= x <= 3` is how a learner writes it.
5. **Derivative marks in expressions.** A name followed by one or more `'` and `(` inside an expression means `Derivative`. The `Name' =` rate rule stays line-initial only. Reason: `f'(x)` is universal and unambiguous at that position.
6. **Aliases.** `CommandSpec.aliases?: readonly string[]`: accepted names that are not printed in the model catalogue and not listed in `no_matching_form`. Reason: catalogue budget and tolerance for names the model already knows.
7. **Core command forms.** `Extremum(Function, a, b)` returns `List<Point>` (all local extrema), with `Maximum`/`Minimum` for the single global point; `Intersect(Function, Function, a, b)` returns `List<Point>`; `Riemann` takes optional `rule`/`offset`. Reason: one point is the wrong answer for most functions.
8. **Undefined values carry `detail` and `hint`** as well as `reason`; reasons added: `no_limit diverges no_convergence blowup stiff step_limit corner identically_zero input_undefined bad_argument empty_interval`.
9. **New error kinds:** `bad_argument` (a value that is wrong for a parameter), `wrong_arity` (calling a function with the wrong number of arguments), `not_differentiable`, `missing_range`, `needs_interval` (see `errors.md`).
10. **New package `packages/plot`** (pure geometry from values and a view box). Reason: section 10.
12. **Inline function arguments.** Where a command parameter is a `Function` (or `Function2`), an expression with exactly one free variable `x` (or free variables `x`, `y`) is accepted and wrapped as an unnamed function, so `Limit(sin(x) / x, 0)` works without a prior `f(x) = ...` line. Reason: fewer lines per sentence for the live teacher. The checker treats `x` and `y` as implicit binders only inside such parameters; elsewhere unknown names stay errors.
11. **Command names for binders.** Commands may take identifier arguments that bind names for later expression arguments (core already does this for `Seq` and `Map`); formalise as `ParamType 'binder'` so `NSolveODE` and `Derivative(g, y)` can be type-checked from the table.

## Sources studied

Removed before the repository was made public. The study notes above are in our own words.
