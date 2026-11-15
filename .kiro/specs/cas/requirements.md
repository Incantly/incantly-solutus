# CAS: requirements

Area: `docs/features/cas/` (`design.md`, `ui.md`, `agent.md`, `errors.md`). Branch: `feat/cas`.

Already built by the symbolic area (`packages/symbolic`, `.kiro/specs/symbolic/`, `handoff/symbolic/`): the tree, numbers,
polynomials, Simplify, Expand, Factor, Solve, calculus, printers, budgets, the worker and 599 spec tests. This spec
covers the open safety findings and the link between the engine and the figure language.

### R1. Budgets hold for every input (findings SYM-SM-3, SYM-SM-4; design 5.13)

1. THE SYSTEM SHALL refuse with `limit` (digits or nodes) any value past 100,000 digits or 200,000 nodes, before it
   is built: powers, products, divisor lists, roots and polynomial coefficients.
2. Every loop whose length grows with the input SHALL tick the run's budget: `roots.pull`, `roots.exact`, prime
   factoring, `binomialExact`.
3. `Factor(x^2 - (10^1000)^99)` SHALL end as `limit` or `timeout` without running out of memory, and the evidence
   cases of SYM-SM-4 SHALL finish within twice their `maxMs`.

### R2. Symbolic values in figures (design 5.2, 5.3, 5.15)

1. Figures SHALL have the types `Expr`, `Cond` and `Symbol`, made by `Expr(…)`, `Cond(…)`, `Symbol(name, domain)`.
2. Symbolic commands SHALL take their arguments in symbolic mode: a free letter such as `x` is an unknown, not an
   error.
3. The phase 1 commands of design section 2 SHALL be commands of the figure language: Simplify, Expand, Factor,
   Rationalize, PartialFractions, CompleteSquare, Solve, Solutions, NSolve, NSolutions, CSolve, CSolutions,
   Substitute, Numeric, Evaluate, Hold, MixedNumber, Assume, Derivative, Integral, Limit, LimitAbove, LimitBelow,
   Coefficients, Degree, Div, Mod, Division, GCD, LCM, the whole-number tools, Equivalent, IsZero, LeftSide, RightSide.
4. Each result SHALL be a value of the figure: other lines read it, and it updates when an object it reads changes.
5. An engine refusal SHALL make the object undefined with the engine's reason and detail (errors.md).
6. `ToNumber(e)`, `ToFunction(e, x)` and `ToExpr(f)` SHALL convert between symbolic values and numbers and functions.
7. The kernel SHALL NOT import the engine; a host loads it, and a figure with no symbolic command never waits for it.

### R3. Studio and tests

1. Symbolic values SHALL print in the list as typeset maths (the LaTeX printer and the view's layout engine).
2. A "CAS" example SHALL show a quadratic solved by factoring, an expansion, a derivative, an integral and a limit.
3. Tests SHALL cover R1 and R2; screenshots SHALL show the example.
