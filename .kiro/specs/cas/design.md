# CAS: design

Source of truth: `docs/features/cas/design.md`. This file says how `requirements.md` is met.

## 1. Budgets (R1)

`packages/symbolic`: a digit predictor (`bitLength(base) * exponent`) before every power and big product; the run's
ticker passed to `roots.pull`, `roots.exact`, `primeFactorsBig` and `binomialBig`. Tests in
`packages/symbolic/test/spec/budgets.test.ts` run each evidence case of SYM-SM-3 and SYM-SM-4.

## 2. Kernel link (R2)

A command area `packages/kernel/src/commands/cas/` registers the commands with `group: 'symbolic'`. The kernel takes
an engine through a hook, `registerSymbolicEngine(engine)`, so the kernel never imports the package: the studio (or
any host) loads `@incantly/symbolic` and hands it over. Until an engine is set, a symbolic line fails with
`engine_loading`, and the host loads the engine and applies the line again (R2.7: no engine for figures without
algebra).

Symbolic mode (design 5.3): the checker reads arguments of symbolic commands as expression trees. A free lowercase
name is an unknown; a name of a figure object is a reference whose value enters as a number or an Expr (design 5.4).

Values: an `Expr`, `Cond` or `Symbol` value is the engine's node with its printed text and LaTeX. A rule calls
`symbolic.run(op, args, opts)` and maps a refusal to an undefined reason.

## 3. Studio (R3)

The studio registers the engine at start-up, lazily: the first line that fails with `engine_loading` loads it and is
applied again. Rows print `toLatex` through the view's math layout.

## 4. Decisions made while building

- The kernel never imports the engine package: the catalogue comes from `@incantly/symbolic/catalogue` (data only) and
  the engine from `@incantly/symbolic` (`casEngine`), loaded by the host. The studio loads it as its own chunk the
  first time a line names a CAS command, then builds pending figures again from their lines.
- Inside a symbolic argument an Expr or Symbol reads as a number formula and a Cond as a condition, so builtins and
  `and`/`or` check as usual. Outside one, arithmetic on an Expr is a type error: write `Expr(p + 1)`.
- `Derivative(x^3, x)` and `Integral(x^3, x, 0, 2)` with a bare formula stay the functions area's (a function of x);
  the CAS forms take an Expr: `Derivative(Expr(x^3), x)` or an Expr object. Agent.md's lines use Expr objects.
- Lists count from 1 (kernel lists): the first solution is `r[1]`; agent.md writes `r[0]`.
- `k = Symbol() with domain = positive` is stored as `k = Symbol(domain = "positive")`.
- `Hold(2 + 3)` gives 5: the engine's constructors fold numbers, so the typed form is not kept yet.

## 5. Not in this round

The CAS panel, plotting, the toolbar and the remaining correctness findings (rounds 3 to 7 of the plan).
