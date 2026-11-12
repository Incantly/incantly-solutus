# Symbolic maths (CAS): design

Status: draft for review. Follows `docs/design/formula-language-and-kernel.md` and the kernel, language and errors designs under `docs/features/`. The core design lists "a symbolic algebra system" as not in v1. This document designs it so that v1 can leave it out cleanly and a later release can add it without changing the kernel's shape. Section 12 lists the few core changes it needs.

No the reference app's code, text or names are used here. Command names that are ordinary maths words (Simplify, Factor, Solve, Limit) are listed because teachers say them.

---

## 1. What the feature does

### For the learner

- Ask the machine to do algebra and see the exact answer: expand a bracket, factor a quadratic, solve an equation, differentiate, integrate, take a limit, substitute a value.
- Keep a worked solution as a list of lines. Each line uses the one above, so editing line 2 updates lines 3 to 6.
- See exact answers (`sqrt(2)/2`, `3/7`, `pi/6`) and, on request, decimal answers to as many digits as they ask for.
- See the answer on the graph: an expression in `x` plots as a curve, an equation in `x` and `y` as an implicit curve, the solutions of a system as points.
- Use letters as unknowns: solve `a*x^2 + b*x + c == 0` for `x` and get the quadratic formula, with the special cases listed.

### For the teacher (the live AI voice)

- Build a worked solution while speaking, one line per sentence: `s1 = Expr(x^2 - 5x + 6 == 0)`, then `s2 = Factor(LeftSide(s1))`, then `s3 = Solve(s1, x)`. Each line renders as typeset maths when it commits.
- Check a claim before saying it: `Equivalent(Expand((x+1)^2), x^2 + 2x + 1)` returns `true`, so the teacher does not misstate algebra.
- Get exact values for the figure: the exact area under a curve, the exact coordinates of an intersection, the exact derivative as a function it can plot.
- Ask for steps: `Steps(Solve(...))` returns the rewriting steps as text lines the teacher can read aloud (phase 2, section 11).

### Sub-features (all of them)

| # | Sub-feature | Phase |
|---|---|---|
| 1 | Symbolic values: `Expr` (expression), `Cond` (equation or inequality), `Symbol` (an unknown with a domain) | 1 |
| 2 | CAS view: a list of derived lines with typeset output, references between lines, a toolbar of operations, and a plot switch per line | 1 |
| 3 | Simplify, Expand, Factor (over the rationals; over the complex numbers by option), Rationalize, PartialFractions, CompleteSquare | 1 |
| 4 | Solve, Solutions, NSolve, NSolutions, CSolve, CSolutions: equations, inequalities, systems | 1 |
| 5 | Substitute | 1 |
| 6 | Exact versus numeric: exact rational and algebraic numbers, `Numeric` to N digits, `Evaluate`, `Hold` (keep as typed), `MixedNumber` | 1 |
| 7 | Assumptions: symbol domains, and `Assume(cond, e)` | 1 |
| 8 | Calculus on expressions: Derivative, Integral (indefinite and definite), Limit, LimitAbove, LimitBelow | 1 |
| 9 | Polynomial tools: Coefficients, Degree, Div, Mod, Division, GCD, LCM | 1 |
| 10 | Whole-number tools: IsPrime, NextPrime, PreviousPrime, PrimeFactors, Divisors, DivisorsList, DivisorsSum, ToBase, FromBase, ExtendedGCD, ModularExponent | 1 |
| 11 | Trig forms: TrigExpand, TrigCombine, TrigSimplify | 2 |
| 12 | Equivalence test `Equivalent` and zero test `IsZero` | 1 |
| 13 | Steps (derivations as data) | 2 |
| 14 | Differential equations: SolveODE (first order separable and linear, second order constant coefficients) | 2 |
| 15 | Small matrices: Eigenvalues, Eigenvectors, CharacteristicPolynomial, Inverse, Determinant | 2 |
| 16 | Transforms: Laplace and InverseLaplace for table cases | 3 |
| 17 | Left out on purpose: Groebner bases, Eliminate, Jordan form, LU and QR as exact decompositions, MinimalPolynomial, general Risch integration | none |

Section 3 maps every command in the manual's CAS-specific and algebra groups to a row here.

---

## 2. The command set, in our syntax

Conventions: `e` is an Expr, `c` is a Cond, `v` is a Symbol or one of `x y z`, `n` a whole number. Named arguments follow the core design (`from = 0`). Every command is one entry in the command table (core section 5); the table below is its source.

### 2.1 Making symbolic values

| Command | Forms | Returns |
|---|---|---|
| `Expr` | `Expr(e)` where the argument is parsed in symbolic mode (section 5.3) | `Expr`, or `Cond` when the argument is a comparison |
| `Symbol` | `Symbol()`; use as `k = Symbol() with domain = integer` | `Symbol` |
| `Hold` | `Hold(e)`: keep the expression exactly as typed; no folding of numbers, no reordering | `Expr` |
| `Evaluate` | `Evaluate(e)`: do the arithmetic only (add numbers, reduce fractions, evaluate known constants); no algebraic strategy | `Expr` |
| `LeftSide`, `RightSide` | `(Cond)` | `Expr` |
| `ToFunction` | `ToFunction(e, v)`: a plottable, callable Function from an Expr with one free symbol | `Function` |
| `ToExpr` | `ToExpr(f: Function)`: back the other way; fails if the function used a numeric-only builtin | `Expr` |

`Hold` replaces the reference app's "keep input" switch. It is a command on a line, not a hidden mode of a row, so the script says what happened.

### 2.2 Algebra

| Command | Forms | Notes |
|---|---|---|
| `Simplify` | `(e)`, `(c)` | Section 5.7. On a Cond, simplifies both sides and may flip to a canonical side. |
| `Expand` | `(e)`, `(e, v)` | The second form expands only inside the powers of `v`'s coefficient structure (collect by `v`). |
| `Factor` | `(e)`, `(e, over = complex)`, `(n: whole number)` | Over the rationals by default. A whole number factors into primes and returns an Expr product. |
| `Rationalize` | `(e)` | Removes surds from denominators; for numeric inputs finds the nearest simple fraction (tolerance 1e-12). |
| `PartialFractions` | `(e, v)` | Rational functions only. |
| `CompleteSquare` | `(e, v)` | Quadratics in `v`; returns `a (v + h)^2 + k`. |
| `Coefficients` | `(e, v)` returns `List<Expr>` from the highest power down | Polynomial in `v`, else `not_polynomial`. Coefficients of lines and conics are the geometry areas' business. |
| `Degree` | `(e, v)` | A whole number as Number. |
| `Div`, `Mod`, `Division` | `Div(a, b)`, `Mod(a, b)` for whole numbers; `Div(p, q, v)`, `Mod(p, q, v)` for polynomials; `Division(a, b)` returns `[quotient, remainder]` | Exact. Mod of negative numbers follows the sign of the divisor and is documented. |
| `GCD`, `LCM` | `(a, b)`, `(List)`; polynomial forms `(p, q, v)` | Whole numbers use BigInt. |
| `Equivalent` | `(e1, e2)`, `(c1, c2)` | Bool. `true` only when proved; `false` only when a counter-example exists; otherwise the cell is undefined with reason `unproven`. |
| `IsZero` | `(e)` | Bool with the same three-way rule. |

### 2.3 Equations

| Command | Forms | Returns |
|---|---|---|
| `Solve` | `(c, v)`, `([c, c, …], [v, v, …])`, `(c)` when exactly one symbol is free; named `from`, `to`, `domain = real\|complex` | `List<Cond>` for one unknown; `List<List<Cond>>` for a system |
| `Solutions` | same forms | `List<Expr>`: the right-hand sides only (for one unknown) |
| `NSolve` | `(c, v)`, `(c, v, start)`, `(c, v, from, to)`, systems `([c…], [v…], [start…])` | Numeric solutions, same shape as `Solve` |
| `NSolutions` | same | `List<Expr>` of decimals |
| `CSolve`, `CSolutions` | `(c, v)` | Same as `Solve` and `Solutions` with `domain = complex` |

Shape rules for `Solve`, which a model needs to know:

- One unknown, equation: a list of `v == value` entries, one per solution, in ascending real order (complex: by real part, then imaginary part). No solutions: the empty list `[]`. Every value works: `[v in R]`.
- One unknown, inequality: a list of pieces, joined by "or". A piece is `v < a`, `v >= a`, or an interval `a < v and v < b`, printed as `a < v < b`. The empty list means no solutions.
- Parameters stay symbolic. `Solve(a*x == b, x)` returns a piecewise answer: `[x == b/a]` when `a != 0`; if `a == 0` the cases are named in the result's `cases` (section 5.9).
- Trig, exp and log families use a whole-number parameter: `Solve(sin(x) == 1/2, x)` returns `[x == pi/6 + 2 * pi * k1, x == 5 pi/6 + 2 * pi * k1]`, and `k1` is an integer Symbol created for the result. With `from` and `to` the list is concrete: the members inside the interval.
- Systems: one inner list per solution, one `v == value` per unknown. Linear systems with infinitely many solutions return parametric forms with one free unknown on the right.

### 2.4 Substitute and numeric

| Command | Forms |
|---|---|
| `Substitute` | `(e, old, new)` where `old` is a Symbol or any sub-expression; `(e, [old == new, …])` replaces all at once (simultaneous, not one after another) |
| `Numeric` | `(e)`, `(e, digits)`; digits 1 to 200, default 15 | Returns an Expr whose numbers are decimals. |
| `MixedNumber` | `(e)` for a rational number, returns `2 3/4` as an Expr with a mixed-number display flag |
| `Assume` | `Assume(c, e)`: compute `e` while `c` holds (section 5.12) |

### 2.5 Calculus on expressions

| Command | Forms |
|---|---|
| `Derivative` | `(e, v)`, `(e, v, n)`, `(e, [v, w])` for a mixed partial. The calculus area's `Derivative(Function)` calls this layer. |
| `Integral` | `(e, v)` indefinite (constant of integration omitted; `+ c` is added by display only when asked), `(e, v, a, b)` definite, exact where possible else numeric with a notice |
| `Limit` | `(e, v, a)` two-sided; `a` may be `inf` or `-inf` |
| `LimitAbove`, `LimitBelow` | `(e, v, a)` |
| `SolveODE` (phase 2) | `(c, y, x)` general solution; `(c, y, x, [x0, y0])` particular solution |

### 2.6 Whole-number tools

`IsPrime(n)`, `NextPrime(n)`, `PreviousPrime(n)`, `PrimeFactors(n)` returns `List` of primes with repeats, `Divisors(n)` returns the count, `DivisorsList(n)`, `DivisorsSum(n)`, `ToBase(n, b)` returns Text, `FromBase(text, b)`, `ExtendedGCD(a, b)` returns `[g, s, t]` with `s a + t b == g`, `ModularExponent(a, e, m)`. These take whole numbers up to 2^53 as Number or any size as an Expr integer; results above 2^53 are Expr. Primality uses deterministic Miller-Rabin bases that are exact below 3.3e24 and a proven-bound set beyond; factorisation uses trial division to 10^6, then Pollard rho (Brent variant), with a budget (error `limit` if exceeded).

### 2.7 Matrices (phase 2)

`Eigenvalues(M)`, `Eigenvectors(M)`, `CharacteristicPolynomial(M)` for exact matrices up to 4 by 4, with the matrix type owned by the vectors-and-matrices area (`Matrix` as `List<List<Expr>>` until that area says otherwise).

---

## 3. Every command in the manual's groups, and what we do

"Ours" is the form in section 2. "Fold" means the command becomes an option of another command.

| The reference app command | Ours |
|---|---|
| Simplify, Expand, Factor | Same names |
| CFactor, CIFactor | `Factor(e, over = complex)`; the second one's integer variant is `Factor(e, over = gaussian)` (phase 2) |
| IFactor | `Factor(n)` for a whole number; `PrimeFactors(n)` |
| Solve, Solutions, NSolve, NSolutions | Same names |
| CSolve, CSolutions | Same names |
| SolveCubic, SolveQuartic | Fold into `Solve`; closed forms only when they are real and short (section 5.9); otherwise `RootOf` values (section 5.4) |
| Substitute | Same |
| Numeric | Same |
| KeepInput | `Hold` |
| Evaluate | `Evaluate` |
| MixedNumber, Rationalize | Same |
| Assume | `Assume(cond, e)` plus symbol domains |
| IntegralSymbolic | Fold into `Integral` (it is exact by default for Expr arguments) |
| Derivative, Integral, Limit, LimitAbove, LimitBelow | Same names |
| PartialFractions, TrigExpand, TrigCombine, TrigSimplify | Same names |
| Coefficients, Degree, Div, Mod, Division, GCD, LCM, CompleteSquare | Same names |
| ExtendedGCD, ModularExponent, IsPrime, NextPrime, PreviousPrime, PrimeFactors, Divisors, DivisorsList, DivisorsSum, ToBase, FromBase | Same names |
| SolveODE | Phase 2 |
| Eigenvalues, Eigenvectors, CharacteristicPolynomial | Phase 2 |
| LeftSide, RightSide | Same names |
| ToExponential | Left out in v1: complex output in polar form is rare in school; `Expr` supports `exp(i theta)` and `Simplify` will not auto-convert. Phase 3 if asked. |
| Laplace, InverseLaplace | Phase 3, table cases only |
| Eliminate, GroebnerLex, GroebnerDegRevLex, GroebnerLexDeg | Left out. These need a Groebner engine (a project of its own); they serve geometry theorem proving and research algebra, not lessons. If geometry proving is wanted later, use a small purpose-built resultant elimination for two variables (section 5.9). |
| JordanDiagonalization, LUDecomposition, QRDecomposition, MinimalPolynomial | Left out. Rare in lessons; `Eigenvalues` covers the common need. Numeric LU and QR belong to the matrices area if wanted. |

---

## 4. How the reference app does it (plain words)

### The CAS view

- A table of rows. Each row has an input and an output. The row number can be used in later rows: one symbol means "the row above, always live", another means "that row's result as it is now, frozen". Rows can also be plain text.
- Evaluating a row produces three possible displays: the exact answer (default), a decimal answer (a "numeric" switch), or the input kept as typed (a "keep input" switch). A toolbar offers one button per common operation (evaluate, numeric, keep input, factor, expand, substitute, solve, derivative, integral, and a few more).
- A row that assigns a name (`a := …`) creates a real object that the graphics and algebra views can use. A small marble beside a row shows or hides that row's result in the graphics view, when the result can be drawn (the code checks for things like a function of one variable, a point, or a list of points).
- A row's result is a separate "twin" object kept in step with the row. Keeping the twin and the row consistent is a large share of the row's code.
- Before evaluating, the input is cleaned (a trailing `=` is dropped; `a :=` with nothing after becomes a delete). Circular row references are detected and reported.
- The same engine is also used outside the CAS view: in the main algebra view's "symbolic" mode, and by many ordinary commands (a tangent, a derivative, a limit, a length of a curve, a surd text) that quietly ask it for help and then use the answer as an ordinary number or function.

### The bridge to the engine

- Everything symbolic goes to Giac, a separate open-source computer algebra system written in C++. The source tree holds a native binding module for it, and the web app loads a compiled JavaScript or WebAssembly build (we saw the binding and test resources, not the web build itself). It starts only on first use, because it is large and slow to start.
- The bridge is textual. The reference app turns its expression tree into Giac's input syntax using a table of about 180 templates, keyed by command name and argument count, each a string with holes for the arguments. The result string comes back, is parsed by a dedicated reader, and becomes an expression tree again.
- Variable names are renamed on the way in and out so they do not clash with Giac's own names, and some commands are small Giac programs defined in text and loaded on demand.
- A timeout (5 seconds by default, a setting) stops a runaway call. Results are cached by the exact input string, with a list of inputs that must not be cached because the engine keeps hidden state between calls (for example assumptions).
- If Giac returns something the reference app's own reader cannot turn into an object, the result is undefined (a question mark).

### What works

- Reach: a real CAS with factorisation, integration, ODEs, matrices and Groebner bases, for the price of a binary.
- A forgiving input language and a notebook-like view that students find familiar.
- The cache and lazy start keep ordinary use fast.

### What is weak

- **Text in, text out.** The tree is printed, sent, and reparsed. Round trips lose structure, make names fragile, and make every new command a string template.
- **Hidden state.** Assumptions and some modes live inside the engine between calls, which is why caching needs an exclusion list and why the same row can answer differently depending on what ran before.
- **Time.** The call blocks the caller up to the timeout. A slider that feeds a CAS row makes dragging stutter.
- **Two places for one result.** A row and its twin object; the "marble" lifetime; static versus dynamic references that behave differently when a row is edited.
- **Opaque failures.** A failed row shows a generic message or a question mark; the reason (unsupported, too slow, no solution) is lost.
- **Size and licence.** The engine is tens of megabytes on the web and its licence (GPL, section 6) is why the apps are non-commercial.

---

## 5. Our design

### 5.1 Where it lives

A new package `packages/symbolic`, pure TypeScript, no DOM, no kernel import except types. The kernel imports it lazily (dynamic `import()`) the first time a symbolic command is applied, so a lesson with no algebra pays nothing.

| Module | Holds |
|---|---|
| `node` | `SymNode` types, smart constructors, interning, hashing, ordering |
| `num` | BigInt rationals, algebraic numbers, decimal numbers, number theory |
| `poly` | Univariate and multivariate polynomials; division, gcd, factoring, resultants, Sturm sequences, root isolation |
| `rules` | Rewrite rules and the strategy (simplify, expand, trig, log) |
| `assume` | Domains, sign and nonzero queries |
| `solve` | Equation, inequality and system solvers; numeric solvers |
| `calc` | Derivative, integral, limit |
| `print` | Plain text, LaTeX, speech, MathBox layout input |
| `bridge` | Conversion between the language's syntax tree and `SymNode`; compile to a numeric function |
| `run` | The single entry point `run(op, args, opts, ctx)` with budgets, caching and derivation logging |
| `worker` | Wrapper that runs `run` in a Web Worker |

The command table entries (`Factor`, `Solve`, …) call `run`. No rule is ever called directly from the kernel.

### 5.2 Types

New kernel value types, added to the core union:

Ruling K5 (`../kernel/rulings.md`): the kernel does not wrap values in a `{ t, ... }` union; it stores the language's raw runtime values, and the type comes from the object's `type`. The union below lists the shapes this area adds, with `t` standing for that `type`.

```ts
type Value =
  | /* … existing … */
  | { t: 'Expr'; e: SymNode; exact: boolean; excluded?: readonly SymCond[]; display?: DisplayHints }
  | { t: 'Cond'; c: SymCond; exact: boolean }
  | { t: 'Symbol'; name: string; domain: Domain };

interface DisplayHints {
  readonly mixed?: boolean;           // MixedNumber
  readonly asTyped?: boolean;         // Hold: print the original tree
  readonly digits?: number;           // Numeric: show this many digits, keep trailing zeros
}
```

`exact` is false as soon as any inexact number (a float or a decimal) appears. `excluded` lists values the expression is not defined at, when simplification cancelled a factor (section 5.7).

The symbolic tree:

```ts
type SymNode = Readonly<SymNodeBody> & { readonly id: number; readonly hash: number };   // interned

type SymNodeBody =
  | { k: 'int'; v: bigint }
  | { k: 'rat'; n: bigint; d: bigint }                 // d > 1, gcd(n, d) = 1
  | { k: 'dec'; mant: bigint; exp: number; prec: number } // a decimal with prec digits
  | { k: 'float'; v: number }                          // a double that came from outside
  | { k: 'const'; name: 'pi' | 'e' | 'i' | 'inf' }
  | { k: 'sym'; name: string }
  | { k: 'ref'; obj: number }                          // a live object, left unfolded (section 5.4)
  | { k: 'add'; terms: readonly SymNode[] }
  | { k: 'mul'; factors: readonly SymNode[] }
  | { k: 'pow'; base: SymNode; exp: SymNode }
  | { k: 'fn'; name: SymFn; args: readonly SymNode[] }  // sin, cos, tan, asin, …, ln, exp, abs, sign, floor, ceil, min, max, sqrt kept as pow(x, 1/2)
  | { k: 'rootof'; poly: UPoly; index: number; hint: number } // the index-th real root of poly, with a float hint
  | { k: 'list'; items: readonly SymNode[] }
  | { k: 'piecewise'; cases: readonly { when: SymCond; then: SymNode }[]; other?: SymNode };

type SymCond =
  | { c: 'rel'; op: '==' | '!=' | '<' | '<=' | '>' | '>='; l: SymNode; r: SymNode }
  | { c: 'in'; l: SymNode; set: 'R' | 'C' | 'Z' | 'N' | 'Q' }
  | { c: 'and' | 'or'; of: readonly SymCond[] }
  | { c: 'not'; of: SymCond }
  | { c: 'true' | 'false' };

type Domain = 'real' | 'positive' | 'nonneg' | 'negative' | 'nonpos' | 'nonzero' | 'integer' | 'natural' | 'rational' | 'complex';
```

Design notes:

- Nodes are immutable and interned: two equal trees are the same object, so `sameValue` is a pointer test, memo keys are small, and common sub-expressions are shared for free.
- Subtraction and division do not exist as nodes: `a - b` is `add(a, mul(-1, b))`, `a / b` is `mul(a, pow(b, -1))`. The printer restores the familiar look. One shape means one set of rules.
- `sqrt(x)` is `pow(x, 1/2)`; `e^x` is `pow(const e, x)` printed as `exp(x)` when the base is `e`.
- `piecewise` is a first-class node so the core language's `if(...)` and conditional functions can be differentiated and integrated.
- `Value.Expr` holds both the canonical tree and, in `display.asTyped`, the typed tree. `Hold` sets that.

### 5.3 Symbolic mode for arguments

A command parameter may be marked `mode: 'symbolic'` in the command table (core section 5 gains this field). The checker then parses and resolves that argument differently:

1. `x`, `y`, `z` are symbols with domain `real`. (The core design reserves these names; here they are allowed.)
2. Any other bare name must be an existing object. A `Symbol` object contributes its symbol. A `Number` object contributes its value (section 5.4). A `Function` object, called as `f(2)` or `f(x)`, contributes its body with the argument substituted. A `Expr` object contributes its tree. Everything else (Point, List, Text, …) is the error `not_symbolic` with the object's type.
3. `==` `!=` `<` `<=` `>` `>=` produce a `Cond`, not a Bool. `and`, `or`, `not` combine Conds. (Outside symbolic mode they keep their meaning.)
4. The clock `t` is a Number object whose value changes every frame. A heavy command refuses an argument that depends on it (error `time_dependent_input`, section 5.13). A cheap one (`Substitute`, `Numeric`, `ToFunction`) accepts it.
5. An unknown name is `unknown_name`, as everywhere. The error's `suggest` offers `k = Symbol()` when the name is one letter.

This keeps "no guessing": the model must create a Symbol before it uses one, and a typo in a name is an error and not a new unknown.

### 5.4 Numbers, exactness, and where objects enter

Number tower, from exact to approximate: `int` (BigInt), `rat`, algebraic (`pow` of rationals with fractional exponents, and `rootof` for roots that have no short closed form), constants (`pi`, `e`, `i`), `dec` (a decimal with a stated number of digits), `float` (a double).

Entry rules for a Number object that appears in a symbolic argument:

- **Free, defined by a literal or a slider**: its value is read as the shortest decimal that round-trips, and if that has at most 15 significant digits it enters as an exact rational (`0.3` is `3/10`; a slider at `0.30000000000000004` is not exactly representable and enters as `float`). A slider step grid is exact by construction (`min + k step` as rationals), so slider values enter exact.
- **Dependent** (a formula, a command result): enters as `float`, so the result is flagged inexact and printed with `≈`.
- **Left as a reference**: a command can ask for `ref` entry (`Solve(a*x^2 + b*x + c == 0, x, keep = [a, b, c])`) so the number stays a named parameter and the answer is a formula in `a, b, c`; the kernel substitutes current values for display. The reference makes the result re-evaluate cheaply when the number moves, with no new symbolic work. Default is not to keep, because most lessons want the exact number for the current value.

`Numeric(e, digits)` evaluates with `digits + 10` guard digits using decimal arithmetic (section 6) and rounds half-even at the end. Comparisons that must decide (`sign`, equality) use exact arithmetic where the operands are exact, and interval arithmetic with outward rounding otherwise; an undecidable comparison on inexact numbers returns `unknown` and the rule does not fire.

`rootof(poly, index, hint)` is how we avoid pages of nested radicals: `Solve(x^5 - x - 1 == 0, x)` returns `[x == rootof(x^5 - x - 1, 1)]`, printed as `x ≈ 1.1673` with the exact form on hover. Real roots of an integer polynomial are isolated with Sturm sequences, refined by bisection on exact rationals to any precision, and ordered by value, so `index` is stable. Cubics and quartics return radicals only when a rational root or a depressed form makes them short (at most 40 nodes); otherwise `rootof`.

### 5.5 Canonical form (smart constructors)

All `SymNode`s are built by constructors that keep trees canonical. This is the base of everything else; get it right and the rest is rule writing.

- `add`: flatten nested sums; fold numeric terms into one; collect like terms (`2x + 3x` → `5x`) by comparing the non-numeric part; drop zeros; sort terms by a total order (numbers first, then by degree, then by node order); one term collapses to itself, no terms to `0`.
- `mul`: flatten; fold numbers; combine equal bases (`x · x^2` → `x^3`) with exponent addition; `0` annihilates only when the other factors are finite (an `inf` factor makes it undefined); sort; distribute a number over a sum only on request (`Expand`), not in the constructor, to keep `2(x+1)` as typed in `Hold`-free results.
- `pow`: `x^0` → `1` (with `0^0` left as undefined `indeterminate`), `x^1` → `x`, `1^x` → `1`, number to integer power folds exactly (BigInt, with a size guard: more than 100,000 digits is `limit`), `(a b)^n` → `a^n b^n` for integer `n`, `(x^a)^n` → `x^(a n)` for integer `n`; other forms wait for the assumption-aware rules.
- `fn`: fold when the argument is exact and the value is known (`sin(0)`, `cos(pi/3)`, `ln(1)`, `exp(0)`) from a small table of exact trig values at multiples of `pi/12`, `pi/10`, `pi/8`, `pi/6`, `pi/5`, `pi/4`, `pi/3`, `pi/2`; reduce `sin(-x)` → `-sin(x)` and the other parity rules; leave the rest.
- Ordering is a total order: kind rank, then structural comparison, then `id`. It never depends on object identity or insertion time, so results are reproducible across runs.

### 5.6 Polynomials

Rules that need polynomial arithmetic first convert a sub-tree to a polynomial in chosen generators (symbols and non-polynomial sub-expressions treated as atoms: `sin(x)`, `sqrt(2)`). The conversion fails with `not_polynomial` if a generator appears in a denominator or a non-integer power, unless the caller wants rational functions (a pair of polynomials).

```ts
interface UPoly { readonly c: readonly bigint[]; readonly den: bigint }     // dense, c[i] is x^i, content kept separate
interface MPoly { readonly gens: readonly SymNode[]; readonly terms: ReadonlyMap<string, bigint>; readonly den: bigint } // key = exponent tuple
```

Operations and targets (median laptop, coefficients under 30 digits):

| Operation | Method | Target |
|---|---|---|
| Add, multiply | schoolbook; Karatsuba above 64 terms | 1000-term by 1000-term under 40 ms |
| Divide with remainder | long division, exact | degree 200 under 10 ms |
| GCD | modular gcd with a final division check, falling back to the subresultant sequence | degree 40 under 15 ms |
| Square-free part | Yun's algorithm | degree 100 under 10 ms |
| Factor over the rationals (one variable) | square-free split; rational-root peeling; factoring modulo a prime (Cantor-Zassenhaus); Hensel lifting; subset recombination bounded by the Mignotte bound | degree 30 under 50 ms; degree 60 under 600 ms |
| Factor over the rationals (several variables) | content and gcd; Kronecker substitution to one variable; trial division of the candidates; at most 4 variables, total degree 12 | under 200 ms typical |
| Resultant and discriminant | subresultant | degree 10 under 5 ms |
| Real root isolation | Sturm sequence, or Descartes with bisection for large degree | degree 30 under 30 ms |

All coefficient work uses BigInt; a fast path using JS numbers is used while all intermediates stay under 2^26 (decided per operation, so the code does not change). Every loop reports to the budget (section 5.13).

### 5.7 The rule engine and `Simplify`

A **rule** is a pure function on a node that returns a replacement or nothing, with a name, a cost effect, and a list of assumption queries it needs. Rules are grouped into **passes**; a **strategy** is a list of passes.

```ts
interface Rule {
  readonly id: string;                       // 'pow.product', 'log.sum', 'trig.pythagoras'
  readonly on: 'add' | 'mul' | 'pow' | 'fn' | 'rel' | 'any';
  apply(n: SymNode, ctx: RuleCtx): SymNode | null;
}
interface RuleCtx {
  readonly assume: Assumptions;
  readonly budget: Budget;
  note(rule: string, before: SymNode, after: SymNode): void;   // derivation log (a no-op unless Steps is on)
  addExcluded(c: SymCond): void;                                // side condition (hole)
}
```

Rewriting is bottom-up; each pass runs until nothing changes or the pass's step limit is reached.

**Simplify** is a search with a fixed menu, not a single rewrite chain:

1. Canonicalise (the constructors do it already).
2. Build candidates: the input; its expansion; its common-denominator form (`Together`, with the gcd of numerator and denominator cancelled); the factored form of that; the trig-reduced form; the log/exp-combined form; the radical-simplified form. Each candidate is built under the budget; one that blows the budget is dropped.
3. Score each by a cost: number of nodes, plus weight 2 for each function node, plus the number of digits in large integers divided by 4, plus 3 for each division. Lowest cost wins; ties go to the form with fewer `add` nodes, then to the lexicographically smaller printed text.
4. Repeat with the winner up to three rounds.

Cancelling a common factor records an excluded value: `Simplify((x^2 - 1)/(x - 1))` returns `x + 1` with `excluded: [x != 1]`. The plotter draws a hole, `Text` shows "(x ≠ 1)" when asked, and `Equivalent` knows the two forms differ at `x = 1` (it reports `true` and `note: 'differ at x = 1'`).

Rule families (names are ours; the table is the plan, not the full list):

| Family | Examples | Needs |
|---|---|---|
| Powers | `x^a x^b` → `x^(a+b)`; `(x^a)^b` → `x^(a b)` when `x > 0` or `b` is an integer; `sqrt(x^2)` → `abs(x)`, or `x` when `x >= 0` | sign of `x` |
| Roots | pull perfect powers out of radicals (`sqrt(12)` → `2 sqrt(3)`); rationalise denominators; denest `sqrt(a ± b sqrt(c))` when the discriminant is a perfect square | none |
| Logs and exps | `ln(a b)` → `ln a + ln b` when `a, b > 0`; `exp(ln x)` → `x` when `x > 0`; `ln(exp x)` → `x` when `x` is real | positivity |
| Trig | Pythagoras, double and half angle, sum to product and back, exact values, inverse composition on principal ranges | domain of the angle |
| Absolute value and sign | `abs(a b)` → `abs(a) abs(b)`; `abs(x)` → `x` when `x >= 0`; piecewise otherwise only in `Solve` | sign of `x` |
| Rational functions | together, cancel gcd, apart (only on request) | none |
| Complex | `i^2` → `-1`; conjugate, modulus, argument for exact inputs | none |

`Expand` is a separate, deterministic algorithm: distribute products over sums using the polynomial multiplier (so repeated sub-products are not recomputed), expand integer powers with multinomial coefficients, leave functions' arguments expanded recursively. A limit on the number of output terms (5,000) returns the error `limit` instead of freezing.

### 5.8 Factor

1. If the input is a whole number: prime factorisation (section 2.6).
2. Convert to a rational function over the generators; factor numerator and denominator separately.
3. Extract content (the gcd of coefficients), then the square-free decomposition, then factor each square-free part (section 5.6).
4. Rebuild with `pow`, ordering factors by degree then by value, with a leading sign handled so `-x^2 + 1` factors to `-(x - 1)(x + 1)` (the minus sign belongs to the front).
5. `over = complex`: factor each irreducible quadratic by its complex roots; higher irreducible factors use `rootof` only in phase 2.
6. A polynomial that is irreducible returns itself, not an error. The notice `irreducible` is set so the teacher can say "this does not factor over the rationals".
7. Non-polynomial atoms (`sin(x)`, `sqrt(2)`) are treated as generators. `Factor(x^2 - 2)` stays `x^2 - 2` (no extension fields), with `over = reals` giving `(x - sqrt(2))(x + sqrt(2))` (phase 2).

### 5.9 Solve

Input: a `Cond` or list of Conds, the unknowns, the domain (real by default), an optional interval. Output: the shapes in section 2.3.

**Pipeline for one equation in one unknown.**

1. Move everything to one side: `f(v) == 0`. If the unknown is absent, the answer is "all" or "none" by evaluating the condition.
2. **Domain facts**: collect where each sub-expression is defined (denominators nonzero, radicands nonnegative, log arguments positive). These filter the answers at the end.
3. **Classify and reduce** in this order, stopping at the first that fits:
   - Polynomial in `v` (after clearing denominators): factor (section 5.8); solve each factor of degree 1 or 2 exactly; degree 3 and 4 by rational roots first, then closed forms when short, else `rootof`; degree 5 and higher by factor then `rootof`. Biquadratics and any polynomial in `v^k` solve by substitution `u = v^k` and back-substitution.
   - Rational: clear denominators, solve the polynomial, remove roots that make a denominator zero.
   - Radicals: isolate one radical, raise to the power, repeat, then discard extraneous roots by exact substitution.
   - Exponential and logarithmic with `v` in one place: isolate and invert (`a^v == b` → `v == ln(b)/ln(a)`, with the sign conditions).
   - Trig in one function of one argument: reduce to `sin(u) == c`, `cos(u) == c` or `tan(u) == c` and write the base solutions with the integer parameter; mixed trig tries the standard identities (double angle, `a sin + b cos` as one sine).
   - Absolute value: split into the two sign cases and solve each under its condition.
   - A substitution that turns the equation into a polynomial in a sub-expression (`e^(2x) - 3e^x + 2`).
   - Otherwise: undefined `unsupported`, with `detail` naming what the engine could not do ("both a polynomial and an exponential term contain x").
4. Apply the domain filter (step 2); apply `from`/`to` (concrete list for periodic families, intersection for the rest); sort.
5. If parameters (symbols other than the unknown) caused a branch (`a*x == b`), return the generic answer and list the special cases in the result's `cases`: `[{ when: a == 0 and b == 0, all }, { when: a == 0 and b != 0, none }]`.

**Inequalities** follow the same pipeline up to the roots, then build a sign chart: the real roots and poles (exact, ordered by isolating intervals and exact comparison) cut the line into pieces; the sign of each piece comes from evaluating at an exact rational test point; the result is the union of pieces where the sign matches, with adjacent pieces merged and endpoints included or not according to the relation. Absolute values, square roots and rational inequalities are reduced to this form with case splits.

**Systems**: linear systems (any number of unknowns) by fraction-free Gaussian elimination (Bareiss), reporting a unique solution, none, or a parametric family. Polynomial systems: substitution when one equation is linear in an unknown; for two unknowns and two polynomial equations of total degree at most 4, eliminate by the resultant, solve the resulting univariate polynomial, back-substitute and verify; larger systems return `unsupported`. (An elimination engine like Groebner bases is not built, section 3.)

**NSolve** is a different algorithm on purpose: for a polynomial it isolates all real roots with Sturm sequences and refines them (exact and fast, never misses a root); for other functions it scans a window (default `[-100, 100]` or `from`/`to`) with an adaptive grid of at least 2,000 samples, brackets sign changes, and refines each with a bracketing method guarded against poles (a sign change whose value grows as the bracket shrinks is a pole, not a root). Near-tangent double roots (no sign change) are found by checking the local minimum of `|f|` and testing `f'` as well. Systems use damped Newton from a start grid. Accuracy: 1e-12 relative on the root for simple roots; double roots to 1e-7, reported with a notice `multiple_root`.

**CSolve** works on the complex plane: factor, solve the factors over `C`, produce `a + b i` forms; for transcendental equations only the principal families are returned, with a notice.

### 5.10 Calculus operations

- **Derivative**: exact, by the standard rules on the tree (sum, product, quotient as product with negative power, chain, power with variable exponent via `exp`/`ln`, inverse trig and hyperbolic), then a light `Simplify` pass (expand-free; combine like terms; powers). For `piecewise`, differentiate each case and keep the breakpoints; the value at a breakpoint is undefined unless both sides agree. The derivative of a function the user typed is a function that can be compiled and plotted; derivative of a `rootof` is not supported (`unsupported`).
- **Integral** (indefinite): in this order: constants and sums (linearity); table of elementary forms with linear argument; polynomial times `exp`, `sin`, `cos` by repeated parts; rational functions by partial fractions (`log` and `atan` terms, repeated factors); powers and products of sines and cosines by the standard reductions; substitution by trying the derivative of a sub-expression as a factor (one level, then two); `x^n ln x` and inverse trig by parts; integrals of the form `1/sqrt(quadratic)` and `sqrt(quadratic)` by completing the square. Known non-elementary integrals (`exp(-x^2)`, `sin(x)/x`, `exp(x)/x`, `1/ln(x)`) return undefined `non_elementary` with `detail` naming the special function; this saves the user the wait. Anything else returns `unsupported` after the step limit. No Risch algorithm in v1.
- **Definite integral**: use the antiderivative if found and continuous on `[a, b]` (poles detected through the domain facts in section 5.9); otherwise numeric (adaptive Gauss-Kronrod to 1e-12 relative, 10,000 evaluations max) with notice `numeric_fallback`. A pole inside the interval is `divergent` for non-integrable singularities (`1/x`) and handled as an improper integral when integrable (`1/sqrt(x)`); infinite bounds use a limit of the antiderivative.
- **Limit**: in order: continuity (substitute and test); rational functions by dominant terms at infinity or cancelling at a finite point; known standard limits (`sin(x)/x`, `(1 + 1/x)^x`, `(e^x - 1)/x`); L'Hopital up to 6 times for `0/0` and `inf/inf`, after rewriting `0 * inf`, `inf - inf`, `1^inf`, `0^0`, `inf^0` into quotients through `exp` and `ln`; series expansion to a fixed order for what remains. One-sided variants take the direction into account (sign of `1/x`, `abs`, `floor`, piecewise). A limit that is `+inf` or `-inf` is a valid answer (`inf` constant). One that does not exist is undefined `no_limit`, with `detail` saying "left and right limits differ: -1 and 1" or "oscillates".

### 5.11 Printing

`print` has three outputs, all from the tree, never from each other:

- `toText(node)`: our syntax, so a line can be copied back (`(x^2 - 1) / (x - 1)`). Fully parenthesised only where precedence demands it. Round trip: `parse(toText(n))` interns to `n` for every canonical node (a test property).
- `toLatex(node)`: for typeset display and for `LaTeX(obj)`. Fractions as `\frac`, roots as `\sqrt`, `\left(` `\right)` sized, `e^x` shown as `e^{x}` or `\exp`, decimals with the requested digits and no scientific notation for exponents below 1e9.
- `toSpeech(node)`: a plain-English reading for screen readers and the teacher: "x squared minus 5 x plus 6", "the square root of 2 over 2", "integral of …". Rules for pauses, groups ("the quantity …"), and long expressions (over 30 tokens: "a long expression with N terms, starting …").

Equations print `lhs = rhs` for display (the input syntax stays `==`).

### 5.12 Assumptions

Two layers, both data, neither hidden:

1. **Symbol domains**: `k = Symbol() with domain = integer`. `x`, `y`, `z` are real by default. A `Number` object that enters the engine as an exact value has its own exact domain (for example `positive`).
2. **Local facts**: `Assume(a > 0, Simplify(sqrt(a^2)))` returns `a`. The first argument is a Cond (or `and` of Conds). The facts apply only inside that call. They go into the cache key.

```ts
interface Assumptions {
  readonly domains: ReadonlyMap<string, Domain>;
  readonly facts: readonly SymCond[];      // each a relation on a symbol or an expression
}
type Sign = 'pos' | 'neg' | 'zero' | 'nonneg' | 'nonpos' | 'nonzero' | 'unknown';
function signOf(n: SymNode, a: Assumptions): Sign;       // propagates through sums, products, powers, exp, abs, sqrt
function isInteger(n: SymNode, a: Assumptions): boolean | 'unknown';
```

`signOf` rules: a number has its sign; a product multiplies signs; a sum of `nonneg` is `nonneg` (strictly positive if one term is positive); `exp` is positive; `abs` and even powers are `nonneg`; `sqrt` of `nonneg` is `nonneg`; a fact `a > 0` sets `a` positive; a fact `a > b` and `b >= 0` gives `a` positive; unknown otherwise. A rule that needs a sign and gets `unknown` does not fire; the result stays correct. For cases that depend on the sign (`Solve(a*x == b, x)`) the engine returns the case split.

Why this is better than a global switch: the same line always gives the same answer, results can be cached, and the teacher can see in the line which assumptions held.

### 5.13 Budgets, speed, caching, and not freezing the frame

```ts
interface Budget {
  steps: number;           // default 2_000_000 basic operations (≈ 200 ms)
  ms: number;              // default 1000; checked every 1024 steps
  maxNodes: number;        // default 200_000 new nodes
  maxDigits: number;       // default 100_000 digits in any integer
  tick(n?: number): void;  // throws BudgetExceeded('steps' | 'ms' | 'nodes' | 'digits')
}
```

- A rule never starts a thread or reads a clock outside `tick`. `BudgetExceeded` is caught by `run` and becomes undefined `timeout` (steps or ms) or `limit` (nodes or digits). A cooperative budget replaces the reference app's "kill the thread after 5 seconds".
- **Cache**: `run` keys on `op | argument node ids | options | assumption hash | engine version`. Hit is O(1). LRU, 4,000 entries or 32 MB, whichever first.
- **Two lanes** (this is how heavy rules fit into the kernel's one-pass frame): the kernel calls a symbolic rule with a *fast-lane* budget of 2 ms. On a cache hit or a fast finish, the cell updates in the same frame. Otherwise the rule returns `{ defined: false, reason: 'pending' }`, the job runs in the worker with the full budget, and when it finishes the kernel receives `settle(objId, cell)`, which marks downstream and requests a frame. Between the two, views show the previous value dimmed (the kernel keeps the last defined value for a `pending` cell).
- **The clock**: a heavy command whose input depends on `t` through the graph is rejected at plan time with `time_dependent_input`. The hint shows the working pattern: do the algebra with a Symbol, then `Substitute` the clock into the result (a cheap, structural step). This keeps every playing frame free of algebra.
- **Seeking and determinism**: all results are pure functions of their inputs, so replay gives the same values. Film seeking calls `await kernel.settled()` before showing a frame that depends on a pending cell; the teacher's `draw` waits at most 800 ms for pending cells and reports any that are still pending as `pending` in its result.
- **Interning memory**: nodes live in an arena owned by one engine instance. When it passes 1,000,000 nodes, the engine rebuilds the arena from the nodes reachable from live cells and the cache keys, dropping the rest.

Speed targets for school-level input (median laptop, warm engine): `Simplify` of a 20-node expression under 5 ms; `Expand((x + 1)^20)` under 2 ms; `Factor` of a degree-6 integer polynomial under 5 ms; `Solve` of a quadratic with symbolic coefficients under 3 ms; `Solve` of a 3-by-3 linear system under 2 ms; `Integral` of a textbook expression (polynomial × exp, a rational function with 3 factors, `sin^3 x cos^2 x`) under 40 ms; `Limit` under 30 ms. Cold start (first symbolic command in a session): the module loads in under 150 ms from cache and 600 ms from network, with a bundle of about 250 KB gzipped for phase 1.

### 5.14 CAS cells and references

A CAS cell is **an ordinary object line** whose type is `Expr`, `Cond`, `List<Cond>`, `List<List<Cond>>`, `List<Expr>` or `Symbol`. There is no separate cell type and no twin object.

- Cell names: the CAS view names new rows `c1`, `c2`, … (first free name). The user may rename a row (`Rename`), which is the kernel's normal rename.
- **References**: a row refers to another by name. A name is a live reference: change row 2 and rows that use it recompute. There is no second kind of "frozen" reference in the syntax; `Freeze(c2)` (a kernel action added for this) makes row 2 a free `Expr` with its current value, which is the same as a static reference with an honest name.
- "The row above" is a view feature (an arrow key inserts the previous row's name into the input); it never appears in a saved script, so scripts do not depend on row order.
- **Text rows** are `#` comment lines, shown in the view as notes.
- **Assignment rows**: `f = ToFunction(c3, x)` makes a Function from a row; `a = Solutions(c3, x)[0]`, with `[0]` the first element, makes a Number if the result is a numeric Expr (`ToNumber(e)`, section 5.15).
- **Plot switch**: a row has the standard `visible` property. When it is true, the view draws the row by adapting its value (section 7 of `ui.md`): an Expr with one free symbol as a curve; a `Cond` with two free symbols as an implicit curve; a `List<Cond>` of `x == a` and `y == b` pairs as points; a `Cond` inequality in one or two variables as a shaded region. Rows whose value has no drawing (a constant, an integer list) have no switch.
- **Errors**: a row that fails to commit does not exist; the CAS view shows the error object under the input and keeps the text for editing. A row that commits but is undefined shows the reason (`unsupported`, `timeout`, `pending`) in place of the output.

### 5.15 How it plugs into the kernel and the command table

- **Command table**: each command in section 2 is a `CommandSpec` with `group: 'symbolic'`. Parameters are `Expr`, `Cond`, `Symbol` or `List` of those, with `mode: 'symbolic'` on the parameters that need section 5.3. The `rule` factory builds a `RuleInstance` whose `eval` calls `symbolic.run(op, args, opts, ctx)`.
- **Conversions between worlds** (all pure, all in the table):
  - `ToNumber(e: Expr) -> Number`: a numeric Expr to a float64 (fails with `out_of_domain` if the Expr has free symbols).
  - `ToFunction(e, v) -> Function`: compile via the same numeric compiler as ordinary formulas (the language's `bridge` module hands the symbolic tree to it). The compiled function keeps the `SymNode` as its `ast` so `Derivative(f)` stays symbolic.
  - `ToExpr(f)` for a Function `f`: the body as an Expr (section 2.1).
  - Number objects enter by the rules in section 5.4; Expr values leave to Number objects by `ToNumber`.
- **Calculus area**: `Derivative(Function)`, `Tangent`, `Integral(Function, a, b)` and `Extremum` call `symbolic.run` when the argument has an AST, and fall back to their own numeric methods when it is undefined with `unsupported`. The calculus area keeps its numeric Simpson and finite-difference code for values; this layer is only for exactness.
- **Text area**: `FormulaText(e)` and `LaTeX(e)` call `toLatex`. `Text("{e}")` uses `toText`.
- **Undefined reasons**: the layer adds the reasons in section 12 and returns `detail` (section 12) so the teacher can say why.
- **Derivation log**: `run(op, …, { steps: true })` returns `Step[]` with rule ids. The `Steps` command (phase 2) prints them. The log costs nothing when off (`note` is a shared no-op function).

### 5.16 What we build, what we leave out, and libraries

**We build** (own code, own tests): the tree, canonical constructors, rationals and number theory, polynomial arithmetic and factoring, the rule engine and the Simplify search, the solver pipeline, the calculus rules, the printers, the budget and cache, and the bridge to the numeric compiler. Reason: the whole stack has to share one tree, one budget, one set of reason codes, deterministic output and no hidden state; and each part is small enough at school level (the polynomial and solve parts are the largest, about 4,000 lines of TypeScript each as an estimate).

**We leave out** (section 3): Groebner and elimination, Jordan form, exact LU and QR, minimal polynomial, Laplace beyond tables, full Risch integration, differential equations beyond the three classes in phase 2, symbolic summation and products (`Sum(1/n^2, n, 1, inf)`) in v1, and special functions (gamma, erf, Bessel) as exact results.

**Could a permissively licensed library fit?** Checked 2026-11-10.

| Library | Licence (as checked) | What it offers | Fit |
|---|---|---|---|
| Nerdamer (`nerdamer-prime`) | MIT (package manifest and repository) | Expressions, simplify, solve, factor, calculus, matrices; JavaScript with a type file | Good as a **test oracle** (compare answers in tests, dev dependency only). Not for production: global state, mutable trees, uneven factor and solve quality, no budgets, no reasons. |
| Cortex Compute Engine | MIT (repository and its fork) | MathJSON trees, LaTeX parse and serialise, a modest simplifier | Useful for **LaTeX input** in the math field (same authors as the MathLive editor). Not a solver. Optional at the edge, never inside the engine. |
| mathjs | Apache-2.0 | Parser, simplify and derivative with rule sets, fractions, complex numbers, matrices | Weak symbolic core; its `simplify` is a small rule set and `derivative` has no budget. Use no part in the engine. |
| Algebrite | MIT (licence file read on 2026-11-10, see `docs/design/libraries.md`) | Wide set (integrals, factor, roots) from an older design | Unmaintained; would carry its own tree. Reference only. |
| decimal.js | MIT (licence file read) | Arbitrary precision decimals with `exp`, `ln`, `sin`, `cos`, `atan`, `sqrt` | **Fits** for `Numeric` above 17 digits and for guard-digit evaluation. About 12 KB gzipped. We use it behind our own `dec` node, not as our number type. |
| SymPy (BSD) through Pyodide | BSD-3 (SymPy repository) | Everything | Technically possible; the download is tens of megabytes and starts in seconds. Rejected for the live teacher; could be offered as an opt-in "heavy CAS" worker in a later desktop build for research use. |
| Giac | GPL-3 | Everything the reference app uses | **Not usable** (section 6). |

Recommendation: write the engine ourselves; use decimal.js for high-precision output; keep Nerdamer as a dev-time cross-check; take Compute Engine only if the math input field needs LaTeX parsing.

---

## 6. Giac, GPL, and what it means for us

- Giac is a GPL-3 program. If we ship it, whether linked or compiled to WebAssembly and delivered to the browser, the combined program must be offered under the GPL with source. That is incompatible with a closed commercial product. The reference app's own apps are non-commercial; whether the GPL engine is part of the reason is not stated in what we read, so we draw no conclusion about their choice, only about ours.
- Running Giac as a separate server process that our app talks to over a network might avoid linking, but it turns every symbolic step into a network call (breaking the "first object within a second" and offline goals), adds cost per user, and still invites a licence question. Do not take this route without a lawyer's advice.
- Re-implementing from Giac's source is also a derived work. We learn from the *interfaces* (what a CAS must offer, what commands users expect) and from published algorithms (Cantor-Zassenhaus, Hensel lifting, Bareiss, Sturm, partial fractions, Risch-style heuristics) described in textbooks and papers. We copy no source.
- Consequence for design: the engine is ours, smaller, pure, and deterministic; unsupported cases are honest (`unsupported`) and not hidden by falling back to a bigger engine.

---

## 7. Better than the reference app

1. **Typed trees all the way.** No print-send-parse round trip, so no renaming of variables, no template per command, and errors keep their positions.
2. **No hidden state.** Assumptions are data in the line or on the symbol, so the same line always gives the same answer and every answer can be cached.
3. **Never blocks a frame.** Two lanes plus a worker; heavy rules never run on the playing clock; a pending result shows the previous value dimmed.
4. **Reasons.** `unsupported`, `non_elementary`, `no_limit`, `divergent`, `timeout`, `limit`, each with `detail`, instead of a question mark.
5. **Holes are remembered.** `Simplify` records the excluded values, so the graph shows the hole and `Equivalent` tells the truth.
6. **Algebraic numbers.** `rootof` gives exact, ordered, arbitrary-precision roots of high-degree polynomials instead of nested radicals or an unexplained decimal.
7. **Equivalence tests.** `Equivalent` lets a teacher check a claim before saying it, using a deterministic test for rational expressions and exact random-point testing otherwise.
8. **No twin objects.** A CAS row is an ordinary object; the plot switch is a view adapter.
9. **Steps from day one.** The rule engine already names every rewrite; showing steps is a flag.
10. **Cooperative budgets.** A slow call stops at a defined step count with a defined reason, on every platform, and never needs a thread kill.
11. **Parametric answers with cases.** `Solve(a*x == b, x)` names the special cases instead of silently assuming `a != 0`.
12. **Small.** About 250 KB gzipped versus a multi-megabyte engine, loaded only when needed.

---

## 8. Edge cases

- `0^0`: undefined `indeterminate` in exact mode; `1` is not assumed.
- `x/x`: `1` with excluded `x != 0`.
- `sqrt(x^2)`: `abs(x)` unless sign known.
- `ln(-1)`: real mode, undefined `out_of_domain`; complex mode, `i pi`.
- `(-8)^(1/3)`: real mode returns `-2` (real cube root for odd denominators, documented), complex mode returns the principal value `1 + sqrt(3) i`. `Expr` printing makes the choice visible with a notice `real_odd_root`.
- `inf - inf`, `0 * inf`, `0/0`: `indeterminate`.
- A number too large (more than 100,000 digits after a power): `limit`.
- Mixed exact and inexact: any `float` or `dec` makes the whole result inexact; exactness never returns after it is lost (no "rounding back" to a rational).
- Integers over 2^53 as Number inputs: the entry rule warns `precision_lost` if the Number's definition was not an integer literal.
- Symbols with the same name as a function (`sin`): `reserved_name`, as in the core design.
- Very long inputs: more than 20,000 nodes is `limit` at plan time.
- Trig solutions with `from`/`to` of huge width (more than 10^6 periods): `limit`.
- Equation with the unknown missing: `Solve(2 == 2, x)` returns `[x in R]`; `Solve(2 == 3, x)` returns `[]`.
- Division by an expression that might be zero in `Solve`: root filtered if it is exactly zero; if undecidable (inexact), the root stays and a notice `denominator_unchecked` is added.

---

## 9. Acceptance tests

1. **Round trip**: for 10,000 generated expressions, `parse(toText(n)) === n` (interned identity).
2. **Canonical form**: constructors are idempotent and independent of argument order for `add` and `mul`.
3. **Expand/Factor inverse**: for generated integer polynomials with known factorisations, `Expand(Factor(p))` equals `Expand(p)`, and `Factor` recovers the planted factors (up to sign and order).
4. **Solve verification**: every exact solution substitutes back to an expression that `Equivalent` proves is zero; generated equation families (linear, quadratic, rational, radical, exponential, log, trig) have no missed solutions against a dense numeric scan.
5. **Calculus**: `Derivative(Integral(f))` is `Equivalent` to `f` for 500 table cases; definite integrals agree with adaptive quadrature to 1e-10.
6. **Cross-check**: Nerdamer as an oracle on the same generated families; disagreements are triaged, not ignored.
7. **Budgets**: pathological inputs (`Expand((x + y + z + w + 1)^40)`, `Factor` of a Swinnerton-Dyer polynomial of degree 16, `Solve(x^x == 7, x)`) stop with `limit`, `timeout` or `unsupported` within 1.2 s and leave the figure intact.
8. **Frame time**: dragging a slider that feeds a heavy symbolic row keeps frames under 8 ms (kernel part) with the previous value dimmed until the job settles.
9. **Determinism**: two runs on different machines give byte-identical `toText` output for the same script.

---

## 10. Phases

1. **Phase 1**: tree, constructors, numbers, polynomials, Simplify, Expand, Factor, Solve (all classes in 5.9 except those marked phase 2), Substitute, Numeric, Hold, Evaluate, derivative, integral, limit, assumptions, whole-number tools, `Equivalent`, printers, cache, budgets, worker, CAS view.
2. **Phase 2**: trig forms, Steps, SolveODE (three classes), small matrices, complex factoring beyond quadratics, `over = reals`.
3. **Phase 3**: Laplace tables, symbolic sums, `ToExponential`, optional heavy-CAS worker.

---

## 11. Phase 2 detail: Steps

`Steps(cmd)` where `cmd` is a symbolic command call returns `List<Text>`; each text is one line such as "Move 6 to the left: x^2 - 5x + 6 = 0", "Factor the left side: (x - 2) * (x - 3) = 0", "A product is zero when a factor is zero". Each line is built from a `Step` (rule id, before, after) by a phrase table keyed by rule id, so phrases can be reviewed and localised. Not every rewrite is shown: the derivation is filtered to "teaching steps" (a flag on rules), and the number of lines is capped at 12 (the rest is merged into "simplify"). Steps only exist for the rules that have phrases; a command whose derivation has none returns a single line "(no steps available)" and the notice `no_steps`.

---

## 12. Changes to the core design

1. **Types**: add `Expr`, `Cond`, `Symbol` to section 4. Reason: symbolic values are not numbers or functions, and equality of interned trees is cheap and exact.
2. **Command table**: add `mode: 'symbolic' | 'value'` on parameters (section 5.3), and `heavy: true` on commands that must not read the clock and may go async. Reason: argument parsing differs, and the planner must know.
3. **Cell**: add `{ reason: 'pending' }` and an async `settle(objId, cell)` event, and let an undefined cell carry `detail?: { code: string; text: string; suggest?: string[] }`. Reason: heavy rules cannot meet a 1 ms apply, and a model fixes failures better with a stated cause.
4. **Undefined reasons added**: `pending`, `unsupported`, `non_elementary`, `no_limit`, `divergent`, `indeterminate`, `unproven`, `singular`.
5. **Errors added** (kinds, catalogued in `errors.md`): `not_symbolic`, `bad_variable`, `time_dependent_input`, `not_polynomial`, `bad_digits`, `bad_domain`.
6. **Kernel action `Freeze(obj)`**: replaces an object's definition by its current value (a free object). Reason: the CAS view's "static reference", and useful for any figure.
7. **Section 1 "Not in v1"**: a symbolic algebra system moves to "phase 1 of the symbolic package, loaded lazily". The v1 kernel needs only the type slots and the `pending` cell state.
8. **Name rule**: `x`, `y`, `z` are symbols inside symbolic parameters (section 5.3), though reserved elsewhere.

---

## 13. Open questions

1. Is `k1` the right display name for the integer parameter in trig families (The reference app-like `k_1` is harder to type)? We use `k1` and create the Symbol with domain `integer`.
2. Should `Solve` over the reals return `rootof` forms when a short radical exists but is long to read? Current rule: radicals only when 40 nodes or fewer.
3. How large a polynomial should `Factor` accept in the live teacher? Current budget is 1 s, then `timeout`.
4. Do we want the CAS view to offer `Steps` in phase 1 as a stretch, given the rule names already exist?

---

## Sources studied

Removed before the repository was made public. The study notes above are in our own words.
