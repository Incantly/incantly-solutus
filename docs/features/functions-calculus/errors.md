# Functions and calculus: errors

Follows section 9 of the core design: an error is data, returned to the caller, never a dialog. A line either commits or returns one error object and changes nothing. Problems that appear only while computing (a root that does not exist, a limit that fails) are not errors: they make a value `undefined` with a reason and the figure keeps running.

Two channels, then:

1. **Line errors** (parse, resolve, type-check, argument checks). Returned by `draw` for the failing line.
2. **Undefined values** (runtime). Reported in `draw` results and in `figure` as `undefined: { reason, detail?, hint? }`.

Core additions used here (listed in `design.md` section 14): kinds `bad_argument`, `wrong_arity`, `not_differentiable`, `missing_range`, `needs_interval`; undefined carries `detail` and `hint`; new reasons.

## 1. Error object

The core fields stay: `ok, line, col, endCol, kind, token, message, expected, forms, hint`. This area adds three optional fields, used only by the kinds that need them:

| Field | Meaning |
|---|---|
| `param` | The parameter name in the command form that failed (`b`, `n`, `rule`) |
| `got` | What was passed, as short text (`"3"`, `"Function2"`) |
| `allowed` | What would have been accepted (`"integer 0..20"`, `["left","right"]`) |

## 2. Line errors

### Parse

| Situation | The reference app | Ours |
|---|---|---|
| `f(x) = ` empty right side | One generic "check your input" message, no position | `syntax`, `col` at end of line, `expected: ["expression"]` |
| `f(x) = x^^2` or `x**2` | Generic message | `syntax`, token `**`, hint "Use ^ for powers" |
| `f(x) = 2 x + 1 y` | Reads as a product, or creates sliders | `syntax` at `y`: "a b is not a product, write a * b" (core rule: implicit multiplication only after a number) |
| `f(x) = if(x < 0, -x)` | Accepted; undefined where false | Accepted (two arguments mean no otherwise) |
| `f(x) = if(x < 0, -x, x, 3)` | Mis-parsed list | `syntax`: the arms are `cond, value` pairs; four arguments are two arms with no otherwise; hint shows the pair structure |
| `0 < x > 3` (chained comparison with mixed directions) | Parses as boolean arithmetic | `syntax` at the second operator, `hint`: "Both comparisons must lean the same way, or write 0 < x and x > 3" |
| `f(x) = x^2 in 3` | Generic | `syntax`, `expected: [".."]` |
| `f'(x) =` (trying to assign to a derivative) | Redefines or errors generically | `syntax`: "f'(x) can be used in an expression but not defined: write g(x) = Derivative(f)(x)" |

### Resolve

| Kind | Situation | Detail |
|---|---|---|
| `unknown_name` | `f(x) = x + y` where `y` is not an object | `token: "y"`, `hint: "f has parameter x only. To use two variables write f(x, y) = ... "`. If an object with a similar name exists, `hint` names it |
| `unknown_command` | `Intergal(f, 0, 1)` | `hint` suggests the closest command by edit distance |
| `not_callable` | `a(2)` where `a` is a Number | Hint: "a is a Number. Did you mean a * 2?" |
| `wrong_arity` | `f(1, 2)` where `f` is `f(x)` | `got: "2 arguments"`, `allowed: "1 argument (x)"`, `hint: "f takes x only"` |
| `reserved_name` | `e(x) = x^2`, `inf = 3` | Core rule |
| `cycle` | `f(x) = g(x)` then `g(x) = f(x)` | The redefinition fails; `detail` lists the loop |
| `type_change` | `f(x) = x` when `f` is a `Function2` | Core rule; hint "Delete(f) first" |

### Type and argument

| Kind | Situation | Example fields |
|---|---|---|
| `no_matching_form` | `Integral(g, 0, 1)` where `g` is `Function2` | `forms` lists the `Integral` forms; `hint: "g has two variables; integrate out one: Integral(g, y, 0, 1)"` |
| `type_mismatch` | `f + (1, 2)` | Core rule |
| `bad_argument` | `Derivative(f, 2.5)`; `Derivative(f, -1)`; `Taylor(f, 0, 100)`; `Riemann(f, 0, 1, 0)`; `Riemann(f, 0, 1, 4, "middle")` | `param`, `got`, `allowed` |
| `not_differentiable` | `Derivative(h)` where `h(x) = noise(x, 1) * x` | `token: "noise"`, `hint: "No derivative rule for noise. NDerivative(h) differentiates numerically."`. Checked at definition time, because it is a property of the tree |
| `missing_range` | A Curve line without a range (curves doc) | n/a here |
| `needs_interval` | `Roots(f)` for a non-polynomial `f`; `Extremum(f)` for a non-polynomial | `hint: "Roots(f) with no interval works for polynomials and rational functions. Write Roots(f, a, b)"` |
| `limit` | `Riemann(f, 0, 1, 1000000)`; `NSolveODE` with more than 16 variables; `Taylor` order above 40; `IterateList` count above 100,000 | `allowed` gives the limit |
| `duplicate_param` | `f(x, x) = x` | Core rule |

## 3. Undefined values (runtime)

The kernel reports after each line the objects that are undefined and why (core §9). The reasons for this area:

| `reason` | Where | What it means | Typical `hint` |
|---|---|---|---|
| `out_of_domain` | any function value | The input is outside the function's domain or no `if` arm matched, or a built-in rejected it (`sqrt(-1)`, `ln(0)`) | "f is defined only for 0 ≤ x ≤ 3" |
| `division_by_zero` | `/`, `Slope` | | |
| `not_finite` | sums, iterations | A value became `inf` or `NaN` | |
| `no_root` | `Root` | No sign change and no tangential zero in the interval (or none near the start value) | "Try a wider interval or look at the graph" |
| `empty_interval` | `Roots`, `Extremum`, ... | `a == b` | |
| `no_extremum` | `Maximum`, `Minimum` | Interval empty or function undefined everywhere on it | |
| `no_limit` | `Limit` | The two one-sided limits differ, or the function oscillates | `detail` shows both sides |
| `diverges` | `Integral(f, a, b)` | An integrable singularity is not present: the integral is infinite or does not settle | `detail: "f is not integrable near x = 0"` and `at: 0` |
| `step_limit` | `Integral`, `NSolveODE` | The budget of panels or steps ran out; the value is still the best estimate and `err` is attached | "Split the interval or loosen rtol" |
| `no_convergence` | `Root(f, x0)`, `Taylor` coefficient check | The iteration did not settle | "Pick a start closer to the root, or give an interval" |
| `blowup` | ODE | The solution became unbounded at `s = ...` | "The solution reaches infinity near s = 1.57" |
| `stiff` | ODE | Steps are forced extremely small | "Shorten the interval or lower the stiffness" |
| `corner` | `Slope`, `Derivative` at a break | One-sided derivatives differ | "f has a corner at 0; use Limit of the difference quotient from one side" |
| `identically_zero` | `Roots` | The function is zero everywhere on the interval | "Every x is a root" |
| `input_undefined` | any | An input is undefined; `detail` names it | |
| `bad_argument` | any command fed by a slider | A dynamic argument is out of range (`n = 0`, a negative order) | |
| `unbounded_search` | `Asymptote`, `Extremum` | The search interval is too large to decide | |

**Not found is not an error.** `Roots(f, 2, 3)` with no roots returns the empty list `[]` (defined). `Root(f, 2, 3)` returns `undefined(no_root)`, because it promised a point.

**Reporting.** In `draw` results and `figure`, an undefined object is `{"name":"r","type":"Point","undefined":{"reason":"no_root","detail":"f has no sign change on [2, 3]","hint":"Try Roots(f, -5, 5)"}}`. `detail` is one sentence meant to be read aloud.

**Partial results.** `step_limit` and `blowup` keep the part that was computed (`Function` with a shortened domain, or a number plus `err`). The object is *not* undefined; it carries a `warning: { reason, detail }` shown by `figure`.

## 4. How the reference app handles these, in summary

- Parse failures: one generic message, no position.
- Argument-count and type mismatches: a named error with the command's accepted forms appended. That we keep.
- Calculation failures: the output becomes undefined with no reason. Numeric exceptions inside the system ODE command make all outputs undefined. A budget on the single-equation ODE and on locus points and implicit curves is a clock (a number of milliseconds), so the same input can succeed or fail by machine speed. Root-finder loss of roots under a sample cap is only a debug log. A count of rectangles above 10,000 is clamped silently. The manual lists several limits in prose only: integrals up to an asymptote may not work; extrema near discontinuities may be false; a limit the engine cannot find gives undefined.
- Limits and asymptotes depend on a CAS that can fail or time out; the failure is not visible.

## 5. How we do it better

1. Every undefined has a code, a sentence, and a recovery hint, in the same shape as line errors.
2. No clocks: limits count work, so errors are the same everywhere and replay in films.
3. Static problems fail at the line (`not_differentiable`, `bad_argument`, `wrong_arity`), so the teacher finds out immediately and retries with the next line.
4. Warnings for partial results instead of all-or-nothing.
5. The `forms` array shows only forms of the right arity first, ordered by closeness of types.

## 6. Example error objects

A two-variable function given to a one-variable command:

```json
{
  "ok": false,
  "line": 3,
  "col": 14,
  "endCol": 15,
  "kind": "no_matching_form",
  "token": "g",
  "message": "Integral has no form (Function2, Number, Number).",
  "expected": [],
  "forms": [
    "Integral(f: Function) -> Function",
    "Integral(f: Function, a: Number, b: Number) -> Number",
    "Integral(f: Function, g: Function, a: Number, b: Number) -> Number",
    "Integral(g: Function2, v: binder) -> Function2",
    "Integral(g: Function2, v: binder, a: Number, b: Number) -> Function"
  ],
  "got": "Function2",
  "hint": "g has two variables. Integrate one out: Integral(g, y, 0, 1) gives a function of x."
}
```

A derivative order out of range:

```json
{
  "ok": false,
  "line": 2,
  "col": 21,
  "endCol": 24,
  "kind": "bad_argument",
  "token": "2.5",
  "message": "Derivative order must be a whole number from 0 to 20.",
  "param": "n",
  "got": "2.5",
  "allowed": "integer 0..20",
  "expected": [],
  "forms": ["Derivative(f: Function, n: Number) -> Function"],
  "hint": "Use 2 for the second derivative."
}
```

A body with no derivative rule:

```json
{
  "ok": false,
  "line": 5,
  "col": 16,
  "endCol": 17,
  "kind": "not_differentiable",
  "token": "h",
  "message": "h uses noise, which has no derivative rule.",
  "expected": [],
  "forms": [],
  "hint": "NDerivative(h) differentiates numerically and works for any function."
}
```

A missing interval:

```json
{
  "ok": false,
  "line": 4,
  "col": 11,
  "endCol": 12,
  "kind": "needs_interval",
  "token": "f",
  "message": "f is not a polynomial or rational function, so Roots needs an interval.",
  "expected": ["a: Number, b: Number"],
  "forms": [
    "Roots(f: Function, a: Number, b: Number) -> List<Point>",
    "Roots(f: Function) -> List<Point>   (polynomials and rational functions only)"
  ],
  "hint": "Write Roots(f, -10, 10)."
}
```

A runtime undefined (reported by `draw` for a line that committed):

```json
{
  "ok": true,
  "line": 6,
  "name": "r",
  "type": "Point",
  "value": null,
  "undefined": {
    "reason": "no_root",
    "detail": "f has no sign change and no tangent touch on [2, 3]; its smallest absolute value there is 1.0 at x = 2.",
    "hint": "The root is not in [2, 3]. Roots(f, -5, 5) lists every root in a wider interval."
  }
}
```

A partial ODE solution:

```json
{
  "ok": true,
  "line": 8,
  "name": "y",
  "type": "Function",
  "value": "domain [0, 1.5707]",
  "warning": {
    "reason": "blowup",
    "detail": "The solution reaches infinity near x = 1.5708, so it is drawn only up to x = 1.5707.",
    "hint": "Shorten the interval, or this is the right answer: y' = 1 + y^2 blows up there."
  }
}
```

A limit that does not exist:

```json
{
  "ok": true,
  "line": 3,
  "name": "L",
  "type": "Number",
  "value": null,
  "undefined": {
    "reason": "no_limit",
    "detail": "From the left f tends to -1, from the right to 1.",
    "hint": "Ask for one side: Limit(f, 0, \"right\")."
  }
}
```

## 7. Recovery patterns the model learns

| Error | Fix on the next line |
|---|---|
| `unknown_name` for a second variable | Redefine with both parameters (`g(x, y) = ...`) |
| `needs_interval` | Same command with `a, b` |
| `no_matching_form` for `Integral` | Use the form in `forms` closest to the intent (the `hint` names it) |
| `bad_argument` | Use a value in `allowed` |
| `not_differentiable` | Use `NDerivative` |
| `no_root` | Widen the interval or use `Roots`; say what the interval was |
| `no_limit` | Ask for a side; say that the limit does not exist if both sides are needed |
| `blowup` | Shorten the interval; say the solution has a vertical asymptote |

## Sources studied

Removed before the repository was made public. The study notes above are in our own words.
