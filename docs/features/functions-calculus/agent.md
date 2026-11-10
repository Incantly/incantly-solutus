# Functions and calculus: how the model uses it

Reads with `design.md` and `errors.md`. The model writes lines through the `draw` tool (one to five lines per call) and reads the figure through `figure`, as in section 10 of the core design.

## 1. The lines the model writes

Rules the model is told in one short paragraph (about 90 tokens):

- Define functions as `f(x) = ...`; two variables as `g(x, y) = ...`. Use `in a..b` to restrict, `if(cond, a, cond2, b, otherwise)` for pieces.
- Every calculus result gets a name: `d = Derivative(f)`, `r = Roots(f, -5, 5)`.
- Sliders are `n = 4 in 1..40 step 1`; objects that use `n` follow it.
- Write numbers and `inf`, never words. `^` for powers.
- Ask for what the sentence being spoken needs, and no more.

### Common lines

```text
f(x) = x^3 - 3x
d = Derivative(f)
d2 = Derivative(f, 2)
a = 1 in -2..2 step 0.01
T = Tangent(f, a)
P = (a, f(a))
r = Roots(f, -3, 3)
e = Extremum(f, -3, 3)
w = Inflection(f, -3, 3)
I = Integral(f, 0, 2)
A = AreaUnder(f, 0, 2)
S = Riemann(f, 0, 2, 8)
S2 = Riemann(f, 0, 2, 8, "trapezoid")
F = Integral(f)
L = Limit(sin(x) / x, 0)
Q = Taylor(sin(x), 0, 5)
as = Asymptote((x^2 + 1) / (x - 1))
g(x, y) = x - y
sf = SlopeField(g)
sol = SolveODE(g, 0, 1, 4)
sys = NSolveODE([v, -9.8 * sin(y)], s, [y, v], [0.6, 0], 0, 10)
```

Anonymous function arguments: commands accept an expression where a function is expected if it has exactly one free variable named `x` (or `x, y` for a `Function2`). So `Limit(sin(x) / x, 0)` and `Taylor(sin(x), 0, 5)` need no `f(x) = ...` first. The model is told this in the same paragraph. (This is the "binder" rule from `design.md` section 14; it is the same idea the core uses for `Seq(expr, k, ...)`.)

### Writing sums that teach

```text
n = 4 in 1..60 step 1
S = Riemann(f, 0, 2, n)
Readout("Sum with {n} slices", S.value)
Readout("Exact area", Integral(f, 0, 2))
```

`S.value` is signed; `S.area` is not. The model uses `.value` for "sum" and `.area` for "area".

## 2. Catalogue entries the model is given

Tier A is always in the prompt. Tier B is added when the lesson topic needs it (the teacher's planner marks a beat with `calculus`, `ode`, `limits`, or `series`; or the model asks by calling `figure` with `catalogue: "calculus"`). Each entry is one line, in the core's printed form.

### Tier A (always, 14 lines)

```text
Derivative(f: Function [, n: Number]) -> Function
Tangent(f: Function, x0: Number) -> Line
Slope(f: Function, x0: Number) -> Number
Integral(f: Function, a: Number, b: Number) -> Number
AreaUnder(f: Function [, g: Function], a: Number, b: Number) -> Region
Riemann(f: Function, a: Number, b: Number, n: Number [, rule: Text]) -> Region   rule: left right mid upper lower trapezoid simpson
Root(f: Function, a: Number, b: Number) -> Point
Roots(f: Function, a: Number, b: Number) -> List<Point>
Extremum(f: Function, a: Number, b: Number) -> List<Point>
Maximum(f: Function, a: Number, b: Number) -> Point
Intersect(f: Function, g: Function, a: Number, b: Number) -> List<Point>
Limit(f: Function, a: Number [, side: Text]) -> Number   a may be inf; side: left right
Asymptote(f: Function [, a: Number, b: Number]) -> List<Line>
Taylor(f: Function, a: Number, n: Number) -> Function
```

About 330 tokens.

### Tier B (calculus extras, 13 lines)

```text
Integral(f: Function) -> Function            antiderivative
Integral(f: Function, through: Point) -> Function
Integral(f: Function, g: Function, a: Number, b: Number) -> Number   of f - g
Derivative(g: Function2, v: x|y [, n: Number]) -> Function2
Normal(f: Function, x0: Number) -> Line
Minimum(f: Function, a: Number, b: Number) -> Point
Inflection(f: Function, a: Number, b: Number) -> List<Point>
Hole(f: Function, a: Number, b: Number) -> List<Point>
Iterate(f: Function, x0: Number, n: Number) -> Number
IterateList(f: Function, x0: Number, n: Number) -> List<Number>
Cobweb(f: Function, x0: Number, n: Number) -> List<Point>
Degree(f) -> Number ; Coefficients(f) -> List<Number> ; Polynomial(pts: List<Point>) -> Function
NDerivative(f: Function) -> Function
```

About 300 tokens.

### Tier C (differential equations, 4 lines)

```text
SlopeField(g: Function2 [, n=25, length=0.8, x0, x1, y0, y1]) -> Field
SolveODE(g: Function2, x0: Number, y0: Number, x1: Number) -> Function
SolveODE(dy: Function2, dx: Function2, x0: Number, y0: Number, tEnd: Number) -> Curve
NSolveODE(rhs: [expr], s, vars: [name], init: [Number], s0: Number, s1: Number [, stop=expr]) -> [Function]
```

About 170 tokens. Example sentence added once to the section: `second order y'' = -4y: NSolveODE([v, -4*y], s, [y, v], [1, 0], 0, 6)`.

### Language lines (part of the grammar summary)

```text
f(x) = expr [in a..b]      g(x, y) = expr      if(c1, a, c2, b, otherwise)      0 <= x <= 3      f'(x)
```

About 45 tokens.

### Budget

| Part | Tokens (approx.) |
|---|---|
| Rules paragraph | 90 |
| Tier A | 330 |
| Tier B | 300 |
| Tier C | 170 |
| Language lines | 45 |
| **All four** | **935** |

The core's v1 catalogue is about 1,200 tokens for all areas; this area alone, fully loaded, costs 935. Therefore only Tier A (330, which replaces the core's eight calculus lines at about 250) plus the rules paragraph is always on (about 420), and B and C load by topic. Aliases cost nothing: they are never printed.

## 3. What comes back from `draw` and `figure`

Per line, `draw` returns `ok` with `name`, `type`, and a `value` summary written to be read aloud, or the error object (see `errors.md`).

| Type | `value` summary |
|---|---|
| `Function` | `"x^3 - 3 x"` (the simplified text), `"domain [0, 3]"` if restricted |
| `Number` | `"2.5"`, `"inf"`, or `"-0.333333 (±1e-12)"` for numeric ones |
| `Point` | `"(1.732, 0)"` |
| `List<Point>` | `"3 points: (-1.732, 0), (0, 0), (1.732, 0)"`; at most 6 shown, then `"… 4 more"` |
| `Region` | `"value 2.667, area 2.667"` |
| `Line` | `"y = 0.5 x - 1"` or `"x = 1"` |
| `List<Line>` | `"3 lines: x = -1, x = 1, y = 0.5 x - 1"` |
| `Field` | `"slope field of x - y, 25 x 25"` |
| `Curve` / ODE | `"solution on [0, 4], y(4) = 3.04"` |
| undefined | `value: null` and `undefined: { reason, detail, hint }` |

`figure` lists every object with the same summary plus `visible` and `undefined`. For functions it adds a one-line **analysis** the model can use to speak accurately without extra commands: `"increasing on (-inf, -1) and (1, inf); local max at x = -1; local min at x = 1; zeros at ±1.732 and 0"`. The analysis is built from `Roots`, `Extremum` over the visible range (marked `"in view"`), cheap to compute, and cached. The teacher is told to describe only what `draw` and `figure` reported.

## 4. How the model fixes errors

The model gets at most two retries per line, then moves on and says only what was drawn. Rules it is taught (they are the `errors.md` recovery table in short):

1. **Read `hint` first.** It names the next line for most errors.
2. **`needs_interval`, `bad_argument`**: copy the call and fix the named argument.
3. **`no_matching_form`**: choose the form whose types match the objects it has; the `forms` list is ordered by closeness.
4. **`unknown_name`**: define the missing thing on the previous line, or fix the spelling named in `hint`.
5. **Undefined result**: speak the `detail` (the teacher says "that function has no zero between 2 and 3") and either change the interval or leave it.
6. **Never** repeat the same failing line.

## 5. Worked lesson snippets

Speech is in quotes. Lines go to `draw` in one call per sentence unless noted.

### Lesson 1: the derivative as a slope (three beats)

> "Here is a curve: the cubic `x` cubed minus three `x`."

```text
f(x) = x^3 - 3x
```

> "Pick a point on it, and I will draw the line that just touches the curve there: the tangent."

```text
a = -2 in -2..2 step 0.01
P = (a, f(a))
T = Tangent(f, a)
```

> "The slope of that line is the derivative. Watch it as the point moves: steep, then flat, then steep the other way."

```text
m = Slope(f, a)
Readout("slope", m)
d = Derivative(f)
D = (a, d(a))
```

`draw` returns `d` as `"3 x^2 - 3"`. The teacher says "the slope formula is three x squared minus three" using the reported text. It then calls `show_me` to set `a` to `0` (the flat tangent) and speaks: "at zero the slope is minus three; at one it is zero". (It reads `m` from `figure` to be sure.)

### Lesson 2: area by slices, with a recovery

> "To measure the area under this curve from zero to two, cut it into thin slices."

```text
f(x) = x^2
n = 4 in 1..60 step 1
S = Riemann(f, 0, 2, n)
```

> "As the slices get thinner the sum gets closer to the real area."

```text
Readout("sum", S.value)
I = Integral(f, 0, 2)
Readout("exact", I)
```

The model's next line asks for the roots of `f` without an interval.

```text
r = Roots(g)
```

`draw` returns:

```json
{ "ok": false, "line": 1, "kind": "unknown_name", "token": "g",
  "message": "No object named g.", "hint": "Did you mean f?", "forms": [], "expected": [] }
```

The model fixes it, using the hint, and moves to the right form:

> "The curve touches zero only at the origin."

```text
r = Roots(f, -1, 1)
```

`draw` returns `"1 point: (0, 0)"`. The teacher adds: "just once, at zero", using what was reported. It never claims anything about the second root, because the list has one.

### Lesson 3: a differential equation as directions and a path

> "A differential equation tells you which way to go at every point. Here the direction is `x` minus `y`."

```text
g(x, y) = x - y
sf = SlopeField(g)
```

> "Start at the point zero, one and follow the arrows."

```text
sol = SolveODE(g, 0, 1, 4)
A = (0, 1)
```

`draw` returns `"solution on [0, 4], y(4) = 3.0366"`. The teacher says: "that path curves up and then settles close to a straight line".

> "Now let me start from minus two instead."

```text
sol2 = SolveODE(g, -2, 0, 4)
```

> "And a harder one that blows up."

```text
h(x, y) = 1 + y^2
bad = SolveODE(h, 0, 0, 3)
```

`draw` returns ok with a warning:

```json
{ "ok": true, "name": "bad", "type": "Function", "value": "domain [0, 1.5707]",
  "warning": { "reason": "blowup",
    "detail": "The solution reaches infinity near x = 1.5708, so it is drawn only up to x = 1.5707.",
    "hint": "This is the true behaviour of y' = 1 + y^2." } }
```

The teacher says only what came back: "this one runs off to infinity just before one point five seven, which is pi over two."

### Lesson 4: an asymptote and a hole (the plotter at work)

> "Look at `x` squared minus one over `x` minus one. It looks like a plain line."

```text
f(x) = (x^2 - 1) / (x - 1)
```

> "But at `x` equals one there is a hole: the formula is undefined, yet the graph heads to two."

```text
h = Hole(f, -3, 3)
L = Limit(f, 1)
```

`draw` returns `"1 point: (1, 2)"` and `"2"`. The plot has already drawn the open circle. Then:

> "Change the denominator slightly and the hole becomes a wall."

```text
f(x) = (x^2 - 1) / (x - 1.5)
as = Asymptote(f, -3, 3)
```

`draw` returns `"2 lines: x = 1.5, y = x + 1.5"` (the oblique asymptote). The teacher names both.

## 6. Prompt hints that keep the model short

- The catalogue tells the model that a result like `r = Roots(...)` is a list and that `r[1]` is the first. (Index base: assumed 1, as set by the lists area.)
- `Readout` text may contain `{name}` for live values. The model does not need `Text(...)` objects for numbers.
- "One sentence, one `draw` call, at most three objects." This keeps the picture ahead of the speech.
- Do not define the same function twice with different names to restyle it; use `f with color = red`.
- The model is not shown `Hole`, `Normal`, `Inflection`, or ODE entries unless the beat needs them.

## 7. Streaming (non-live) generation

For prompt-to-figure the same lines are streamed one per line. A calculus figure usually has 5 to 12 lines; the slowest are `Roots` on a hard function (under 10 ms) and ODE (under 3 ms), so none blocks the first paint. The repair call at the end receives only failed lines, each with its error object; it replies with corrected lines only.

## Sources studied

See `design.md`. Additionally the manual pages for `SlopeField`, `SolveODE`, `NSolveODE`, `Limit`, `Asymptote`, `TaylorPolynomial` and the section "Functions" informed which tasks a learner and a model most often ask for.
