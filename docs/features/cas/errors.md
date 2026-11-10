# Symbolic maths: failures

Every failure the symbolic layer can produce. Error objects follow `../errors/design.md` section 3. Area letter for codes: `Y`. Kinds reused from other areas keep their own codes.

Two classes, never mixed (as in the kernel):

- **Errors**: the line was rejected before anything ran. The figure is unchanged. Returned as data.
- **Undefined values**: the line was accepted and the object exists, but the maths could not produce a value. The cell carries `reason` and, new in this area, `detail`.

The rule for choosing: if the line is wrong whatever the numbers are (wrong type, unknown name, a variable that is not a symbol), it is an error. If it is right but the engine cannot answer for these inputs (no closed form, too slow, no limit), it is an undefined value.

```ts
interface UndefinedDetail {
  code: string;                 // 'Y2xx', stable
  text: string;                 // one plain sentence
  suggest?: string[];           // up to 3 complete lines that may work
  stage?: string;               // 'classify' | 'factor' | 'isolate' | 'integrate' | …
}
```

---

## 1. Line errors

### 1.1 Reused from the core, with symbolic specifics

| Kind | Raised when | GeoGebra | Ours |
|---|---|---|---|
| `unknown_name` | A name in a symbolic argument does not exist | Offers sliders or reads `ab` as `a*b`; in the CAS view an unknown letter is silently a symbol | Always an error. `suggest` includes `k = Symbol()` when the name is one letter, and the nearest existing names |
| `no_matching_form` | Argument count or types fit no form | Generic "illegal argument" with forms appended | `forms` lists every form of the command (max 4 plus `formsOmitted`), `hint` names the mismatching argument position |
| `type_mismatch` | An operator on types it does not take, for example `Expr` plus `Text` | "Illegal operation" | Error naming both types and a conversion if one exists (`ToNumber`, `ToExpr`) |
| `limit` | A size budget is exceeded at plan time (input over 20,000 nodes, list over 10,000 items) | Out of memory or hang | Error with `limit` (name) and the allowed value |

### 1.2 New kinds

| Kind | Code | Phase | Raised when | GeoGebra | Ours |
|---|---|---|---|---|---|
| `not_symbolic` | Y001 | resolve | A symbolic argument names or contains an object that is not a number, symbol, expression or function (a Point, List, Text, Polygon, …) | The object is passed to the engine as text and comes back as a question mark or an engine error string | Error naming the object and its type; `related` has the name; hint suggests a field (`P.x`) or `ToExpr` |
| `bad_variable` | Y002 | typecheck | The "with respect to" argument is not a Symbol, `x`, `y` or `z` (a Number, an Expr that is more than a symbol, a Function) | The engine treats whatever it gets as a variable name, so `Solve(…, 2)` gives odd results | Error; hint shows which names are valid variables in the current figure |
| `time_dependent_input` | Y003 | plan | A heavy command's input depends on the clock `t` through the graph | Not detected; CAS re-runs on every tick and stutters | Error with `path`: the chain from `t` to the argument; hint shows the Symbol-then-`Substitute` pattern |
| `not_polynomial` | Y004 | typecheck or run | A polynomial command (`Coefficients`, `Degree`, `Div`, `Mod`, `GCD` polynomial form, `CompleteSquare`) gets something that is not a polynomial in the variable | Returns the engine's answer for the nearest interpretation, or undefined | Error when the non-polynomial part is syntactic (a `sin(x)` containing the variable, a negative or fractional power of the variable). The `token` is that sub-expression |
| `bad_digits` | Y005 | typecheck | `Numeric(e, digits)` with digits not a whole number from 1 to 200 | Clamps or ignores | Error with the allowed range |
| `bad_domain` | Y006 | typecheck | `domain =` value is not `real` or `complex`; `Symbol() with domain =` not in the list | Not applicable (global setting) | Error listing valid values |
| `bad_option` | Y007 | typecheck | A named argument the command does not have, or `from` greater than `to` | Not applicable | Error listing the command's named arguments |
| `solve_arity` | Y008 | typecheck | The numbers of equations and unknowns in a system are inconsistent in a way the command refuses (more unknowns than 6, lists of different kinds) | Passes to the engine | Error; an under-determined system with 6 or fewer unknowns is allowed and returns a parametric answer |
| `bad_assumption` | Y009 | typecheck | `Assume(c, e)` where `c` is not a Cond about symbols, or contradicts itself (`a > 0 and a < 0`) | Engine accepts, results are unspecified | Error; contradictory facts name the pair in `related` |
| `redefinition_domain` | Y010 | commit | Redefining a Symbol to a different domain when dependents hold results built under the old domain | Not applicable | Warning-level notice (not an error) `domain_changed` lists the objects that recompute; it is an error only if `locked` |
| `division_by_zero_literal` | Y011 | resolve | A literal `/0` or `^-1` of a literal zero in an `Expr(…)` argument | Result is a question mark | Error at the literal with `suggest` of the likely intent; the same situation arising from values later is undefined `division_by_zero` |

All other parse-level errors (`syntax`, `unbalanced`, `bad_number`, …) belong to the language area.

### 1.3 Notices (accepted, with a fact the caller should know)

| Code | Kind | When |
|---|---|---|
| Y101 | `numeric_fallback` | A definite integral or a solve used a numeric method because no exact form was found |
| Y102 | `multiple_root` | NSolve found a double or higher root and reports it once |
| Y103 | `irreducible` | `Factor` returned the input because it does not factor over the chosen field |
| Y104 | `denominator_unchecked` | A root was kept though the denominator could not be proved nonzero (inexact input) |
| Y105 | `real_odd_root` | An odd root of a negative number was taken as the real root |
| Y106 | `precision_lost` | A Number entered the engine as an inexact double |
| Y107 | `excluded_values` | Simplification cancelled a factor; `names` holds the excluded conditions |
| Y108 | `periodic_family` | Trig solutions are given as families with an integer parameter |
| Y109 | `cases` | The answer is generic; special parameter cases are listed |
| Y110 | `no_steps` | `Steps` has no phrase for this derivation |
| Y111 | `domain_changed` | See Y010 |
| Y112 | `differ_at` | `Equivalent` returned true but the forms differ at the listed excluded values |

---

## 2. Undefined values (not errors)

Reason codes come from the kernel's list (`out_of_domain`, `division_by_zero`, `no_root`, `not_finite`, `overflow`, `no_convergence`, `timeout`, `input_undefined`, `limit`). This area adds reasons (kernel change 4) and fills `detail`.

| Reason | Detail code | Meaning | Typical command | GeoGebra | Ours |
|---|---|---|---|---|---|
| `pending` | Y200 | The job is running in the worker | any heavy command | The UI blocks until done | The previous value stays visible, dimmed; the object settles when done |
| `unsupported` | Y201 | The engine has no method for this form | `Solve`, `Integral`, `SolveODE`, `Limit` | A question mark, or the engine returns the command unevaluated | `detail.text` says what part could not be handled; `suggest` offers `NSolve` or a substitution when one applies |
| `non_elementary` | Y202 | Proved to have no elementary antiderivative (table of known cases) | `Integral` | Returns an unevaluated integral or a special function if the engine knows it | Undefined with `detail` naming the special function, `suggest` a numeric definite integral |
| `no_limit` | Y203 | The limit does not exist | `Limit`, `LimitAbove` | Question mark or "undefined" | `detail` says "left and right limits differ: A and B" or "oscillates" |
| `divergent` | Y204 | An improper integral does not converge | `Integral` definite | Engine returns infinity or a question mark | Undefined; the `detail` names the singular point |
| `indeterminate` | Y205 | `0/0`, `inf - inf`, `0^0` and similar in exact arithmetic | any | May return 1 or a question mark | Undefined with the form named |
| `unproven` | Y206 | `Equivalent` or `IsZero` could not decide | `Equivalent` | n/a | Undefined, `detail` says whether random testing found no difference ("probably equal") |
| `singular` | Y207 | A matrix is singular | `Inverse`, `Eigenvectors` | Question mark | Undefined, `detail` gives the rank |
| `timeout` | Y208 | The step or time budget ran out | any heavy command | After 5 s the call is stopped and a generic message shows | Undefined `timeout`; `detail.stage` says where it stopped |
| `limit` | Y209 | A size limit stopped the computation | `Expand`, `Power`, `Factor` | Hang or memory error | Undefined `limit`; `detail` has the limit name and value |
| `out_of_domain` | Y210 | Real-mode function of an argument outside its domain | `ln(-1)`, `acos(2)`, `sqrt(-4)` in real mode | Complex result or question mark depending on settings | Undefined; `suggest` is the same line with `domain = complex` where it applies |
| `division_by_zero` | Y211 | Exact division by zero | `1/0` | Question mark | Undefined, with the sub-expression named |
| `no_solution` | Y212 | Only for commands that return a single value from the solutions (for example `Solutions(…)[0]` of an empty list) | indexing | Question mark | `index_out_of_range` is used for the index; `Solve` itself returns `[]` |
| `not_finite` | Y213 | A numeric step produced NaN or infinity | `Numeric`, `NSolve` | Question mark | Undefined, with the step named |

`Solve` returning `[]` is a **value**: it means there are no solutions. It is never an undefined cell, because "no solution" is an answer.

---

## 3. Numeric failures

| Situation | GeoGebra | Ours |
|---|---|---|
| `NSolve` finds no root in the window | Question mark | Returns `[]` and notice `window_searched` with the window; widen with `from`/`to` |
| `NSolve` with a start value that diverges | Question mark or a far-away root | Starts a bracketing search from the start value outward; reports `no_convergence` only if the search window is exhausted |
| Newton step meets zero derivative | Question mark | Falls back to bisection when a bracket exists; else `no_convergence` |
| Pole mistaken for root | Possible | Bracketed sign changes whose magnitude grows are rejected as poles |
| Definite integral with oscillating integrand | Wrong digits | Adaptive Gauss-Kronrod with an error estimate; if the estimate exceeds 1e-8 relative after the evaluation cap, undefined `no_convergence` with the estimate in `detail` |
| Very high precision request | Slow | Digits above 200 are `bad_digits`; evaluation time is bounded by the budget |
| Overflow in a power | Infinity | BigInt powers beyond 100,000 digits: `limit`; float powers: `overflow` |

---

## 4. Limits table

| Limit | Value | Kind when exceeded |
|---|---|---|
| Nodes in one input | 20,000 | `limit` (error) |
| Nodes created by one command | 200,000 | undefined `limit` |
| Digits in any integer | 100,000 | undefined `limit` |
| Terms after `Expand` | 5,000 | undefined `limit` |
| Variables in a system | 6 | `solve_arity` |
| Degree for `Factor` | 200 | undefined `limit` |
| Digits for `Numeric` | 200 | `bad_digits` |
| Steps per command | 2,000,000 | undefined `timeout` |
| Wall time per command | 1,000 ms (worker), 2 ms (fast lane) | `timeout` or `pending` |
| Cache | 4,000 entries or 32 MB | evicts oldest |
| Matrix size (phase 2) | 4 by 4 exact | undefined `limit` |

---

## 5. Examples

### 5.1 Unknown letter in a symbolic argument

Line: `s = Solve(a x + b == 0, x)` when `a` and `b` are not defined.

```json
{
  "ok": false,
  "committed": false,
  "kind": "unknown_name",
  "code": "K002",
  "phase": "resolve",
  "message": "a is not defined.",
  "line": 1, "col": 13, "endCol": 14, "token": "a",
  "expected": [],
  "forms": [],
  "hint": "Make an unknown first: a = Symbol(). Then use it in the equation.",
  "suggest": ["a = Symbol()", "b = Symbol()"],
  "recovery": "create_first",
  "related": [],
  "fingerprint": "unknown_name:a"
}
```

### 5.2 An object that cannot be an expression

Line: `e = Expr(P + 1)` where `P` is a Point.

```json
{
  "ok": false,
  "committed": false,
  "kind": "not_symbolic",
  "code": "Y001",
  "phase": "resolve",
  "message": "P is a Point and cannot be used in an expression.",
  "line": 1, "col": 11, "endCol": 12, "token": "P",
  "expected": ["Number", "Expr", "Symbol", "Function"],
  "forms": ["Expr(e: Expr) -> Expr", "Expr(c: Cond) -> Cond"],
  "hint": "Use a coordinate: P.x or P.y.",
  "suggest": ["e = Expr(P.x + 1)", "e = Expr(P.y + 1)"],
  "recovery": "use_suggestion",
  "related": ["P"],
  "fingerprint": "not_symbolic:P:Point"
}
```

### 5.3 Heavy command on the clock

Line: `r = Solve(a x == t, x)` where `a = Symbol()` and `t` is the film clock.

```json
{
  "ok": false,
  "committed": false,
  "kind": "time_dependent_input",
  "code": "Y003",
  "phase": "plan",
  "message": "Solve cannot read the clock t; it would redo the algebra on every frame.",
  "line": 1, "col": 15, "endCol": 16, "token": "t",
  "path": ["t", "Solve argument 1"],
  "expected": [],
  "forms": ["Solve(c: Cond, v: Symbol) -> List<Cond>"],
  "hint": "Do the algebra with a Symbol, then put the clock in: r0 = Solve(a x == s, x) then r = Substitute(r0, s, t).",
  "suggest": ["s = Symbol()", "r0 = Solve(a x == s, x)", "r = Substitute(r0, s, t)"],
  "recovery": "rewrite",
  "fingerprint": "time_dependent_input:Solve"
}
```

### 5.4 Not a polynomial

Line: `d = Degree(sin(x) + x^2, x)`.

```json
{
  "ok": false,
  "committed": false,
  "kind": "not_polynomial",
  "code": "Y004",
  "phase": "typecheck",
  "message": "sin(x) is not a polynomial in x.",
  "line": 1, "col": 12, "endCol": 18, "token": "sin(x)",
  "expected": [],
  "forms": ["Degree(e: Expr, v: Symbol) -> Number"],
  "hint": "Degree works on sums of powers of x. Use Taylor expansion or work on x^2 alone.",
  "suggest": [],
  "recovery": "rewrite",
  "fingerprint": "not_polynomial:Degree:sin(x)"
}
```

### 5.5 Undefined: unsupported

Line: `s = Solve(x + exp(x) == 3, x)` accepted; the cell is:

```json
{
  "name": "s",
  "type": "List<Cond>",
  "defined": false,
  "reason": "unsupported",
  "detail": {
    "code": "Y201",
    "text": "No exact method for an equation with x both outside and inside exp.",
    "suggest": ["s = NSolve(x + exp(x) == 3, x)"],
    "stage": "classify"
  }
}
```

### 5.6 Undefined: no limit

Line: `L = Limit(abs(x)/x, x, 0)`:

```json
{
  "name": "L",
  "type": "Expr",
  "defined": false,
  "reason": "no_limit",
  "detail": {
    "code": "Y203",
    "text": "The left limit is -1 and the right limit is 1.",
    "suggest": ["Lr = LimitAbove(abs(x)/x, x, 0)", "Ll = LimitBelow(abs(x)/x, x, 0)"],
    "stage": "limit"
  }
}
```

### 5.7 Undefined: pending, then settled (change report)

```json
{
  "committed": true,
  "changed": [{ "name": "F", "type": "Expr", "defined": false, "reason": "pending" }],
  "later": "settle F within 800 ms or report pending in the draw result"
}
```

After the worker finishes: `{ "name": "F", "defined": true, "value": "(x^2 - 1)/(x + 1) simplifies to x - 1", "excluded": ["x != -1"] }`.

---

## 6. How the model recovers

| Kind or reason | Next line the model writes |
|---|---|
| `unknown_name` (one letter) | `k = Symbol()` then the original line |
| `not_symbolic` | Take `suggest[0]`, or use a field of the object |
| `bad_variable` | Replace the variable with `x` or a Symbol |
| `time_dependent_input` | The three lines in `suggest` |
| `not_polynomial` | Use a different command (`Derivative`, `NSolve`) or rewrite the argument |
| `unsupported` | The `suggest` line (usually `NSolve` or a numeric definite integral); else say what the engine could not do and move on |
| `timeout`, `limit` | Simplify the input first, or break the line into two |
| `pending` | Do nothing; the next `figure` call shows it settled |
| `no_limit` | Use the one-sided commands in `suggest` and talk about each |
| `non_elementary` | Use a definite integral (numeric) and say there is no closed form |
| `unproven` | Treat as not established; do not say two expressions are equal |

The model retries a line at most twice, as in the core design; the third failure becomes "I'll show it numerically instead."
