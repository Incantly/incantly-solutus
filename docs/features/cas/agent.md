# Symbolic maths: how the model uses it

## 1. Catalogue entries (loaded when the lesson needs algebra)

The group loads when the plan contains any of: solve, factor, expand, simplify, derivative (exact), integral (exact), limit, "show the steps", "is it true that". The always-on core catalogue (about 1,200 tokens) is unchanged.

```text
e = Expr(x^2 - 5x + 6)                 expression (x y z are unknowns; t is the clock, not an unknown)
q = Expr(x^2 - 5x + 6 == 0)            equation or inequality: == != < <= > >=, joined by and / or / not
k = Symbol() with domain = positive    your own unknown; domain: real positive nonneg negative nonpos nonzero integer natural rational complex
Simplify(e)  Expand(e)  Factor(e)  Factor(e, over = complex)  Rationalize(e)  PartialFractions(e, x)  CompleteSquare(e, x)
Solve(q, x) -> list of x == value      Solve([q1, q2], [x, y])      options: from = a, to = b, domain = complex
Solutions(q, x) -> list of values      NSolve(q, x[, start])        NSolutions(q, x)       CSolve(q, x)
Substitute(e, x, 3)                    Substitute(e, [x == 2, y == 5])   (all replaced at once)
Derivative(e, x[, n])   Integral(e, x)   Integral(e, x, a, b)   Limit(e, x, a)   LimitAbove(e, x, a)   LimitBelow(e, x, a)   (a may be inf)
Numeric(e[, digits])   Evaluate(e)   Hold(e) keeps as typed   MixedNumber(e)   ToNumber(e)
Equivalent(e1, e2) -> Bool   IsZero(e) -> Bool     true only if proved, false only if a counter-example exists
Coefficients(p, x)  Degree(p, x)  Div(p, q, x)  Mod(p, q, x)  GCD(a, b)  LCM(a, b)
LeftSide(q)  RightSide(q)  Assume(a > 0, Simplify(sqrt(a^2)))
f = ToFunction(e, x)   ToExpr(f)       to plot or call an expression
PrimeFactors(n)  IsPrime(n)  NextPrime(n)  Divisors(n)  ExtendedGCD(a, b)  ModularExponent(a, e, m)
```

Token budget: about 650 tokens for the group, plus about 90 for the short rules below.

Rules the model is told in one sentence each:

- Create an unknown with `Symbol()` before using any letter other than `x`, `y`, `z`.
- `Solve` returns a list of equations; use `Solutions` for the bare values.
- Never say two expressions are equal unless `Equivalent` returned `true`.
- Do the algebra with Symbols, then `Substitute` the clock; do not feed `t` to `Solve`, `Factor`, `Integral` and the other heavy commands.
- To draw an expression use `f = ToFunction(e, x)` and then `Show(f)`, or set the row visible.
- An exact answer prints exactly; ask for `Numeric(e, 4)` when you want to say a decimal.

## 2. Lines the model writes

A worked quadratic:

```text
p = Expr(x^2 - 5x + 6)
fp = Factor(p)
q = Expr(p == 0)
s = Solve(q, x)
```

The same with a drawn curve and marked roots:

```text
f = ToFunction(p, x)
r = Solutions(q, x)
R1 = (r[0], 0)
R2 = (r[1], 0)
```

(`r[0]` is an `Expr`; the point rule reads a numeric Expr through `ToNumber`.)

Calculus with exactness:

```text
g = Expr(x^3 - 3x)
dg = Derivative(g, x)
crit = Solutions(dg == 0, x)
A = Integral(g, x, 0, 2)
```

Checking a claim before saying it:

```text
ok = Equivalent(Expand((x + 1)^2), x^2 + 2x + 1)
```

Parameters:

```text
a = Symbol() with domain = nonzero
b = Symbol()
c = Symbol()
gen = Solve(a*x^2 + b*x + c == 0, x)
```

A sequence with the clock:

```text
s0 = Symbol()
sol = Solve(x^2 == s0, x)
m = Substitute(sol, s0, t)
```

## 3. What `draw` gives back

Per line, one object. Symbolic results are summarised in text the model can read aloud, and with the exact flag.

```json
{ "line": 2, "ok": true, "name": "fp", "type": "Expr", "value": "(x - 2)(x - 3)", "exact": true }
{ "line": 4, "ok": true, "name": "s", "type": "List<Cond>", "value": "[x == 2, x == 3]", "exact": true }
{ "line": 3, "ok": true, "name": "r", "type": "List<Expr>", "value": "[2, 3]", "exact": true }
{ "line": 5, "ok": true, "name": "A", "type": "Expr", "value": "-2", "exact": true }
{ "line": 1, "ok": true, "name": "ok", "type": "Bool", "value": "true" }
```

Special fields:

- `excluded`: `["x != 1"]` when Simplify cancelled a factor.
- `notices`: `["irreducible"]`, `["periodic_family"]`, `["cases"]` with `cases` listed on the object (also in `figure`).
- `defined: false` with `reason` and `detail.text` for undefined results (`unsupported`, `pending`, `no_limit`, …). The model reads `detail.text` and `suggest`.
- Long values are shortened: expressions over 120 characters are cut with `… (N terms)`; the full text is available with `figure` and the line `Describe(name)` (kernel action).
- `exact: false` appears when any inexact number entered; the model must say "about" for those.

`figure` lists every symbolic object with `type`, `value` (short), `exact`, `visible`, and for undefined ones `reason`.

## 4. Fixing errors

| Error | One-line fix |
|---|---|
| `unknown_name` for a letter | Add `k = Symbol()` first; send both lines in the same `draw` call (the first commits, then the second) |
| `not_symbolic` | Use the suggestion (a coordinate, or `ToExpr`) |
| `time_dependent_input` | Use the three-line pattern in `suggest` |
| `no_matching_form` | Pick a form from `forms`; the commonest slip is `Solve(expr, x)` without `== 0`: add it |
| `not_polynomial` | Choose `NSolve` or `Derivative` instead, or rewrite |
| undefined `unsupported` | Use the `suggest` (`NSolve`, numeric definite integral) and say "no closed form" |
| undefined `pending` | Wait; do not repeat the line |
| undefined `timeout` | Break the input into smaller lines and simplify first |

## 5. The live teacher: worked snippets

The teacher speaks a sentence and, in the same instant, calls `draw` with the lines for it. Speech is in quotes; lines are in code blocks.

### 5.1 Solve a quadratic by factoring

> "Let's solve x squared minus five x plus six equals zero."

```text
q = Expr(x^2 - 5x + 6 == 0)
```

> "The left side has two factors."

```text
fp = Factor(LeftSide(q))
```

`draw` returns `fp = (x - 2)(x - 3)`.

> "A product is zero when one of the factors is zero, so x is two or three."

```text
s = Solutions(q, x)
f = ToFunction(LeftSide(q), x)
R1 = (s[0], 0)
R2 = (s[1], 0)
```

> "And you can see the parabola cross the axis at exactly those two points."

### 5.2 Why the algebra must be checked (recovering from an error)

> "Let me show that a squared plus two a b plus b squared is a plus b all squared."

```text
lhs = Expr(a^2 + 2*a*b + b^2)
```

`draw` returns the error `unknown_name` for `a` with `suggest: ["a = Symbol()", "b = Symbol()"]`.

> "I need to name my two unknowns first."

```text
a = Symbol()
b = Symbol()
lhs = Expr(a^2 + 2*a*b + b^2)
rhs = Expr((a + b)^2)
ok = Equivalent(lhs, rhs)
```

`draw` returns `ok = true`.

> "And the machine agrees that they're the same expression."

(The teacher said "agrees" only after `ok = true` came back.)

### 5.3 A removable hole

> "Look at this fraction, x squared minus one over x minus one."

```text
h = ToFunction(Expr((x^2 - 1)/(x - 1)), x)
```

> "It looks like the line y equals x plus one, except at x equals one."

```text
s = Simplify(Expr((x^2 - 1)/(x - 1)))
```

`draw` returns `s = x + 1`, `excluded: ["x != 1"]`.

> "The simplified form tells us the hole is at x equals one, and the value there would be two."

```text
H = (1, 2)
```

### 5.4 Limit that does not exist

> "What happens to absolute value of x over x as x goes to zero?"

```text
L = Limit(abs(x)/x, x, 0)
```

`draw` returns undefined `no_limit` with `detail.text`: "The left limit is -1 and the right limit is 1."

> "The answer depends on the side: from the left it is minus one, from the right plus one, so there is no single limit."

```text
Lr = LimitAbove(abs(x)/x, x, 0)
Ll = LimitBelow(abs(x)/x, x, 0)
```

### 5.5 A moving quantity (clock and algebra kept apart)

> "Suppose a particle's height is t squared minus four t."

```text
s = Symbol()
hs = Expr(s^2 - 4 s)
v = Derivative(hs, s)
```

> "Velocity is two s minus four, zero when s is two."

```text
z = Solutions(v == 0, s)
h = Substitute(hs, s, t)
vt = Substitute(v, s, t)
Readout("height", ToNumber(h))
Readout("velocity", ToNumber(vt))
```

(`Substitute` is cheap, so the readouts follow the clock without any algebra on the frame.)

## 6. Events from the learner

When the learner edits a CAS row in the view, the teacher receives a change report like any other edit: `{ "name": "c3", "text": "Factor(c2)", "value": "…" }`. The teacher may comment on it. When the learner drags a slider that feeds a symbolic row, the report lists any rows that became `pending` and the teacher should wait for the next `figure` before describing them.

## 7. Rules of thumb for the model

1. Say exactly what `draw` returned. If the result is inexact, say "about".
2. Prefer `Solutions` when you only need to place points; prefer `Solve` when you want to show the equation `x = 2`.
3. Use `Equivalent` before every "these are the same" claim.
4. Use `Hold` when you want the learner to see the expression as typed (not tidied).
5. Do the algebra first, plot second.
6. For anything the engine cannot do, show it numerically and say so in one sentence; do not retry more than twice.
7. Use short names for rows (`s1`, `s2`) so the spoken steps and the names match.

## 8. Prompt size

Catalogue 650 tokens, rules 90 tokens, one worked example 150 tokens (the model gets the first quadratic example only). Total about 900 tokens, loaded on demand.
