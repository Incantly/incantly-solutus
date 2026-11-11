# Builder notes: symbolic (CAS layer)

## Summary

Built the whole CAS layer in `packages/symbolic/src/` (18 modules, ~11k lines): the
interned exact-expression tree, the rule engine with `Simplify` candidate search,
univariate/multivariate polynomial arithmetic with factoring, the solver pipeline
(exact, inequalities, systems, numeric, complex, ODEs), calculus (derivative,
integral, limits), equivalence testing, small exact matrices, teaching steps, the
single `run()` entry point with budgets and cache, the worker protocol, the kernel
bridge, and every CAS command as a pure op. No tests (per pipeline: the tester writes
them). One bench file with the section-5.13 speed targets.

## Files

- `contracts.ts` — kernel-handoff shapes (`ExprValue`, `CondValue`, `SymbolValue`,
  `Domain`, `DisplayHints`, `SolutionCase`, `SymArg`, `RunContext`, `Step`), the Y0xx /
  Y1xx / Y2xx code tables, `DEFAULT_LIMITS`, `HEAVY_OPS`, and `SYMBOLIC_COMMANDS` (the
  full command catalogue data for the kernel's command table).
- `node.ts` — `SymNode` (interned, canonical: no sub/div nodes; `sqrt` is `x^(1/2)`),
  smart constructors, total order, exact trig folding, traversal helpers,
  `LimitExceeded`.
- `num.ts` — BigInt number theory: Miller-Rabin, next/previous prime, Pollard-Brent
  factorisation, divisors, extended gcd, modular powers, bases, binomials,
  decimal/rational conversions incl. exact float values.
- `assume.ts` — domains + local facts, sign analysis, integer/nonzero tests,
  contradiction detection.
- `poly.ts` — `UPoly`/`MPoly`, division, gcd, Yun square-free split, rational roots,
  factor (peeling + bounded Kronecker), Kronecker multivariate factor/gcd with exact
  trial division, resultants, Sturm isolation, real-root refinement.
- `print.ts` — `toText` (re-enterable, products with `*`), `toLatex`, `toSpeech`.
- `parse.ts` — expression/condition parser; accepts everything `toText` prints
  (round-trip property), including `rootof`, `ref`, `if`, lists, `in` and chains.
- `rules.ts` — rule engine, `Simplify` (7 candidates, costed, 3 rounds), `Expand`,
  `Together`/cancel with excluded values, partial fractions, `Rationalize`,
  `CompleteSquare`, trig forms, `Evaluate`, `Factor` (self-verifying), numeric eval.
- `solve.ts` — `solveEquation` (polynomial, rational, radical, exp/log, trig with
  families, abs, substitution; parameters with case splits), inequalities by sign
  charts, linear systems (RREF, parametric) and nonlinear 2x2 (resultant,
  substitution), `NSolve` (Sturm + guarded scan + damped Newton), `CSolve`,
  `SolveODE` (separable, linear 1st-order, const-coeff 2nd-order).
- `calc.ts` — exact derivatives, integrals (linearity, tables, tabular parts, partial
  fractions, trig reductions, substitution, sqrt-of-quadratic; known non-elementary
  forms named), definite integrals with numeric fallback, limits (continuity, cancel,
  standard forms, L'Hopital x6, one-sided `u -> 0+` analysis, `NoLimit` details).
- `equiv.ts` — `Equivalent`/`IsZero`: proof by normal forms, refutation by seeded
  random points, else `unproven`.
- `matrix.ts` — determinant, inverse, characteristic polynomial, eigenvalues
  (over C), eigenvectors (exact or numeric nullspace) to 4x4.
- `steps.ts` — phrase table (24 rules), `stepsToText` (12-line cap), command-call
  parser for `Steps(cmd)`.
- `run.ts` — `run(op, args, opts, ctx)`: budgets, LRU cache, fast-lane `pending`,
  derivation logging, error mapping. Never throws.
- `worker.ts` — worker request/response protocol + handler (no DOM; host owns Worker).
- `bridge.ts` — `TNode` -> `SymNode`/`SymCond` (symbolic-mode rules, number entry
  rules), clock handling, `compileFunction` for `ToFunction`.
- `ops.ts` — every command as `(args, named, ctx) -> OpOut`; value validation
  (`bad_digits`, `bad_domain`, `bad_option`, `not_polynomial`, …); exact decimals to
  200 digits (rationals, square roots via Newton, pi by Machin, e by series);
  `exactStationaryPoints` + `binomialExact` for the optimisation area.
- `index.ts` — the public API (everything above).
- `bench/cas.bench.ts` — the section-5.13 speed targets.

## Public API (for the tester)

- `run(op, args, opts?, ctx?) -> Result<RunSuccess>`: the entry point. `args` are
  `SymArg` values (`{k:'expr'|'cond'|'sym'|'num'|'int'|'text'|'bool'|'list'|'matrix'|
  'function'|'named'}`); text can be parsed with `parseExpression`/`parseCondition`.
  Results are `Cell<SymArg>` (a value or `{reason, detail}`); failures are `Result`
  errors. Nothing throws.
- Engine modules are exported for white-box use: `simplifyNode`, `expandNode`,
  `factorNode`, `solveEquation`, `solveSystem`, `solveInequality`, `nsolveEquation`,
  `csolveEquation`, `solveODE`, `diffNode`, `integrateNode`, `definiteIntegral`,
  `limitNode`, `equivalent`, `toText`, `toLatex`, `toSpeech`, `stepsToText`, number
  theory, polynomials, matrices.
- `toText(parseExpression(s))` round-trips; printed output re-enters.

## Design decisions (where the docs left room)

- `exp(x)` parses to `pow(e, x)` and `sqrt(x)` to `pow(x, 1/2)` (5.2: one form each);
  both print back as `exp(...)`/`sqrt(...)`. `cbrt` stays a function (real-valued).
- `0^0` and `0^negative` stay unfolded (never `inf`); `1/0` evaluates to undefined
  `division_by_zero`, not infinity.
- `t` (clock) converts to `sym('t')` + `readsClock`; heavy ops refuse it
  (`time_dependent_input`); cheap ops get the current value substituted by the kernel
  (`substituteClock`), except `ToFunction`, whose closure takes `t` at call time.
- `Solve` families enumerate only with finite `from` AND `to`; one-sided bounds keep
  the symbolic family. `Solutions` of an inequality returns the boundary values.
- `Div` is the floored quotient, consistent with floored `Mod`.
- `Assume(c, e)` re-simplifies `e` under the facts (the inner call already ran).
- `SolveODE` reads `y'` as the symbol `yp` and `y''` as `ypp`; initial data solves
  for `C1` (a second-order IVP keeps `C2` — one point cannot fix two constants).
- `Eigenvalues` solve over C (exact through quadratics, numeric above);
  `Eigenvectors` returns one vector per eigenvalue.
- `Numeric` above 17 digits for transcendental trees falls back to floats pending
  decimal.js (see below); rationals, square roots, pi and e are exact to 200 digits.
- `x in R`-style `in` conditions and chained `a < v < b` parse (the latter only in
  this parser and display mode; text mode prints the re-enterable `and` form).
- `degree` for `Factor` over 200 is `limit`; `i` (imaginary unit) is a symbolic-mode
  constant; `deg`/`tau` expand to `pi` forms.

## Left out, and why

- `decimal.js` (libraries.md allows it): not installed in this checkout (no network,
  no shell to install). `Numeric` is built behind the `toDecimal` interface with a
  float fallback; integrating decimal.js later only widens the exact path. Noted in
  code at `ops.ts` (`toDecimal`).
- Full Cantor-Zassenhaus/Hensel factorisation: rational-root peeling + a bounded
  Kronecker step covers school inputs; the rest returns `irreducible` with notice
  Y103 (plus self-verification of every factorisation, so a wrong factorisation is
  impossible — worst case is unfactored).
- `Factor over=reals|gaussian`, Laplace, `TrigAuto`, resonance ODEs, quartic
  Ferrari, `RootOf` display forms: documented phase-2/3 work, not in this build.
- Risch integration: heuristics per 5.10; misses return `unsupported`, never a
  wrong antiderivative.
- `Freeze`, `Binomial`/`nCr`/`nPr`: not this area (kernel action / calculator
  area). This package provides the exact-integer type plus `binomialExact` and
  `exactStationaryPoints` for them.

## Performance

Budgets: 2M steps/op, 1000 ms fallback (checked every 1024 ticks), input 20k nodes,
5k expansion terms, degree-200 factor cap, 6-var systems, 4x4 matrices. Every loop
ticks or is structurally bounded; factorisation, Sturm isolation and numeric scans
all carry caps. `bench/cas.bench.ts` encodes the 5.13 targets.

## Integration notes (kernel team)

1. Add our kinds to the registries: `AreaErrorKinds` += the 11 `SymbolicErrorKind`;
   `AreaNoticeKinds` += the 12 `SymbolicNoticeKind`; undef reasons += the 8 symbolic
   reasons. Our error objects cast to the kernel types; the casts become exact once
   you add the entries.
2. Build `CommandSpec`s from `SYMBOLIC_COMMANDS` (`group: 'symbolic'`); `Expr`
   parameters parse in symbolic mode via `bridge.nodeFromTNode`/`condFromTNode`
   (symbolic names: `x y z` + `Symbol` objects + `keep` refs; comparisons become
   `Cond`s; `ref` entry for `keep`).
3. Rules call `run(op, args, opts, {domains, facts, resolveRef})`. Heavy ops
   (`HEAVY_OPS`) run in the worker (`worker.handleWorkerRequest`); the fast lane
   passes `fastLaneMs` and treats `pending` as "job running".
4. `Symbol()` needs the result object name: pass it as `opts.name`.
5. Replace the `K000` placeholder codes in `run.ts` (`CORE_ERROR_CODES`) with the
   real kernel codes for `syntax`, `no_matching_form`, `bad_argument`,
   `unknown_command`, `limit`.
6. `ToFunction` returns a `{k:'function'}` descriptor; compile it with
   `bridge.compileFunction` (takes `(x, t)`).
7. Display: `ExprValue.display` (`mixed`, `digits`), `excluded` conditions (Y107),
   `SolutionCase[]` on solve lists (Y109 notice), `rootof` hover (exact form).
8. `run()` is the only cross-package boundary (it never throws; everything is
   `Result` or a cell). The exported engine functions (`simplifyNode`,
   `solveEquation`, …) signal `Unsupported`/`NonElementary`/`LimitExceeded` by
   throwing; that is internal by design (5.1: no rule is ever called directly).
   Error objects carry `line: 1, col: 1, endCol: 1` — the kernel overwrites them
   with the real span.

## Open questions

- None blocking. The `K000` codes (above) and the `AreaErrorKinds`/`AreaNoticeKinds`
  additions are the only hand-off items needing kernel-side edits.

## Self-check results

- Shell was unavailable in this session (sandbox executor broken; unsandboxed
  execution needs human approval, which is disabled), so `npm run lint`,
  `npm run typecheck` and `npm test` could NOT be run, and no commit could be made.
  I compensated with a line-by-line static audit of every module: all imports
  verified used, `exactOptionalPropertyTypes`/`noUncheckedIndexedAccess` patterns
  checked, switch exhaustiveness checked, no `console`/`eval`/`Date`, no DOM in
  package code. The tester/integrator must run the three gates first.
- No tests written (per brief). No GeoGebra material touched. No new dependencies.
