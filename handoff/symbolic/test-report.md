# Test report: symbolic (blind spec tests)

Package `packages/symbolic/` (entry `@incantly/symbolic`). Spec tests live in `packages/symbolic/test/spec/`.

## Result

- **497 spec tests** in 8 files. **411 pass, 86 fail** (one more test, `Expand past 5,000 terms`, timed out once in a full parallel run and passes alone; its timeout is now 30 s).
- The failures are findings for the fixer. No source file was changed.
- Repo gates after this work: `npx eslint .` clean, `npx tsc -p tsconfig.json` clean. `npx vitest run`: the 2118 non-symbolic tests all pass; the symbolic spec failures above are the only red tests.

## Pass / fail by doc section

| File | Doc sections | Tests | Pass | Fail |
|---|---|---|---|---|
| `canonical.test.ts` | cas/design 5.2 tree, 5.4 number entry, 5.5 constructors, 5.6 polynomials | 60 | 59 | 1 |
| `print.test.ts` | cas/design 5.11 printers, acceptance 1; rulings (re-enterable text); agent.md 3 | 55 | 50 | 5 |
| `algebra.test.ts` | cas/design 2.2, 5.7 Simplify, 5.8 Factor | 46 | 36 | 10 |
| `solve.test.ts` | cas/design 2.3, 5.9, acceptance 4 | 71 | 55 | 16 |
| `calculus.test.ts` | cas/design 2.5, 5.10, acceptance 5; errors.md 2 (Y202 to Y204) | 85 | 63 | 22 |
| `numbers.test.ts` | cas/design 2.1, 2.4, 2.6, 5.4, 8; optimisation-discrete design 5.1 and 8.1 | 97 | 82 | 15 |
| `assume-equiv.test.ts` | cas/design 2.2 Equivalent/IsZero, 5.12; errors.md Y009, Y112, Y206 | 32 | 26 | 6 |
| `contracts-errors.test.ts` | errors.md 1 to 4; design 2.7, 5.13, 9.7, 9.9, 11 | 51 | 40 | 11 |

## Failing tests and the doc line each one checks

### Printing and round trip (`print.test.ts`, `canonical.test.ts`)

| Test | Doc promise | What happened |
|---|---|---|
| ruling example `(x - 2)*(x - 3)` prints as `(x - 2) * (x - 3)` | rulings.md "Docs round" (3); agent.md 3 `value: "(x - 2) * (x - 3)"` | prints `(-3 + x) * (-2 + x)` (constant first) |
| `x^2 - 5*x + 6` round-trips | design 5.11 "`parse(toText(n))` interns to `n`" | parse of the printed text is a different tree |
| 10,000 generated expressions round-trip | design 9.1 | first break: `x - (1/2 * sqrt(3))` prints `x - (-1/2 * sqrt(3))` |
| toSpeech polynomials | design 5.11 "x squared minus 5 x plus 6" | reads "six minus minus five times x plus x squared..." |
| toSpeech roots | design 5.11 "the square root of 2 over 2" | reads "one over two times the square root of..." |
| `x * x^2` is `x^3` | design 5.5 mul "combine equal bases" | stays a product |

### Algebra (`algebra.test.ts`)

| Test | Doc promise | What happened |
|---|---|---|
| Simplify cancels a common factor and records the excluded value | design 5.7 `Simplify((x^2-1)/(x-1))` is `x + 1`, `excluded: [x != 1]` | returns the input unchanged, no `excluded` |
| Simplify excluded values print as `x != 1` | design 5.7, agent.md 5.3 | no excluded value |
| `x/x` is 1 with excluded `x != 0` | design 8 | same: not simplified, `Equivalent` cannot prove it |
| Factor quadratic over the rationals | design 5.8 step 3 to 4; agent.md 5.1 `(x - 2) * (x - 3)` | returns the sum, sets `irreducible` |
| Expand(Factor(p)) is Expand(p) | design 9.3 | Factor returns a sum for all four planted products |
| the minus sign belongs to the front | design 5.8 step 4 `-(x - 1)(x + 1)` | no product |
| a whole number factors into primes | design 2.2 Factor `(n)` returns an Expr product | `Factor(12)` is `12` |
| `over = complex` splits `x^2 + 1` | design 5.8 step 5 | unchanged |
| non-polynomial atoms are generators | design 5.8 step 7 `sin(x)^2 - 1` | unchanged |
| CompleteSquare of a cubic | errors.md 1.2 Y004 `not_polynomial` lists `CompleteSquare` | error kind `bad_argument` |

### Solve (`solve.test.ts`)

| Test | Doc promise | What happened |
|---|---|---|
| degree 5+ uses `rootof`, display shows 1.1673 | design 5.4 "printed as `x ≈ 1.1673`" | display text shows the `rootof(...)` form only |
| the rootof value evaluates to the root | design 5.4 (ordered, arbitrary precision) | `ToNumber` is undefined `not_finite` |
| Numeric refines a rootof | design 5.4 | `Numeric` is undefined `not_finite` |
| rational: clearing denominators can empty the answer | design 5.9 "Rational: ... remove roots that make a denominator zero" (`(x^2-1)/(x-1) == 2`) | undefined `unsupported` |
| rational: kept roots (`x/(x-1) == 2`) | design 5.9 | undefined `unsupported` |
| logarithmic in one place (`ln(x) == 1`) | design 5.9 "Exponential and logarithmic" | undefined `unsupported` |
| substitution (`exp(2x) - 3exp(x) + 2 == 0`) | design 5.9 "A substitution that turns the equation into a polynomial" | undefined `unsupported` |
| quadratic formula with symbolic coefficients | design 2.3, agent.md 2 (`a=1, b=-3, c=2` gives 1 and 2) | substituting numbers gives 4 |
| trig families print `x == pi/6 + 2 * pi * k1` | design 2.3 | prints `asin(1/2)` forms, not `pi/6` |
| bounded interval prints `-1 < x < 1` | design 2.3 "printed as `a < v < b`" | prints `-1 < x and x < 1` |
| interval output re-enters | rulings (re-enterable) | `parseCondition` rejects the printed `and` form |
| absolute inequality `abs(x) < 2` | design 5.9 inequalities "Absolute values ... reduced with case splits" | undefined `unsupported` |
| endpoints (`x^2 - 1 <= 0`) | design 2.3 | prints `-1 <= x and x <= 1` |
| NSolve polynomial (`x^5 - x - 1`) | design 5.9 Sturm, 1e-12 | returns `x == NaN` |
| NSolutions `x^2 - 2` | design 2.3 | returns `NaN` twice |
| verification `x/(x-1) == 2` | design 9.4 | undefined `unsupported` |

### Calculus (`calculus.test.ts`)

| Test | Doc promise | What happened |
|---|---|---|
| `1/cos(x)^2`, `2x exp(x^2)`, `x cos(x^2+1)` have antiderivatives | design 5.10 table forms and substitution | undefined `unsupported` |
| antiderivative of `x^2 exp(x)`, `x sin(x)`, `sin(x)^2` differentiates back | design 5.10 "tabular parts", trig reductions; acceptance 5 | derivative of the answer differs from the integrand |
| definite integrals agree with quadrature (`x sin(x)` on [0, 3]) | design 5.10, acceptance 5 (1e-10) | off by 4.68 |
| `1/x` from 0 diverges | errors.md Y204 | defined `-ln(0) + ln(1)` |
| `1/x` to infinity diverges | errors.md Y204 | undefined `unsupported` |
| `Limit((1+1/x)^x, inf)` is e | design 5.10 standard limits | returns 1 |
| rational function at infinity | design 5.10 "dominant terms" | undefined `unsupported` ("this one-sided limit") |
| `exp(x)` at `-inf` is 0 | design 5.10 | returns `exp(-1 / 0)` |
| L'Hopital inf/inf (`ln(x)/x`) | design 5.10 | undefined `unsupported` |
| `sqrt(x^2+x) - x` at inf | design 5.10 "inf - inf rewritten" | returns `-inf` (true value 1/2) |
| `(1 + 2/x)^x` at inf | design 5.10 "1^inf" | returns 1 (true value e^2) |
| oscillation has no limit | design 5.10, errors.md Y203 "oscillates" | undefined `unsupported` |
| `Limit(abs(x)/x, x, 0)` is `no_limit` (three tests: reason, text, suggest) | errors.md 5.6, agent.md 5.4 | defined `sign(0)` |
| `LimitAbove` is 1, `LimitBelow` is -1 | agent.md 5.4 | both return 0 |
| `Derivative(Integral(f))` equals f over the table | design 9.5 | `x^3-2x+1`, `x exp(-x)`, `x cos(x)` differentiate to something else; `ln(x)^2/x` unsupported |

### Numbers, edge cases, whole numbers (`numbers.test.ts`)

| Test | Doc promise | What happened |
|---|---|---|
| swapping two symbols is simultaneous | design 2.4 "simultaneous, not one after another" | gives the sequential result |
| `Numeric` keeps free symbols | design 2.4 "Returns an Expr whose numbers are decimals" (silent for symbols, see choices) | undefined `out_of_domain` |
| `Hold` keeps as typed | design 2.1, 5.2 `display.asTyped` | `asTyped` unset |
| exact answer prints exactly | design 1 `sqrt(2)/2` | `1/sqrt(2)` simplifies to `2^(-1/2)` |
| `0^0` | design 8 undefined `indeterminate` | evaluates to 1 |
| `inf - inf` | design 8 `indeterminate` | evaluates to 0 |
| `0 * inf` | design 8 `indeterminate` | stays `0 * inf`, defined |
| `1/0` | design 8, errors.md Y211 | defined `0^-1` |
| `ln(-1)`, `sqrt(-4)`, `acos(2)` in real mode (three tests) | design 8, errors.md Y210 | defined |
| `2^400000` | design 5.5, 8, errors.md Y209 `limit` | defined |
| literal `1/0` in `Expr` | errors.md Y011 | accepted |
| `IsPrime(-7)` | design 2.6 (silent; prime means positive) | true |
| strong pseudoprime 3317044064679887385961981 | design 2.6 "proven-bound set beyond 3.3e24" | reported prime |

### Assumptions and equivalence (`assume-equiv.test.ts`)

| Test | Doc promise | What happened |
|---|---|---|
| fact `a > b` with `b >= 0` makes `a` positive | design 5.12 signOf rules | `unknown` |
| contradictory facts name the pair in `related` | errors.md Y009 | error raised, `related` empty |
| a Cond not about symbols (`2 > 1`) | errors.md Y009 | accepted |
| `Equivalent(1/x + 1/y, (x+y)/(x*y))` | design 2.2, 7.7 "deterministic test for rational expressions" | `unproven` |
| cancelled factor is `true` with notice `differ_at` | design 5.7, errors.md Y112 | `unproven` |
| `Equivalent` on Conds with the same solution set | design 2.2 `(c1, c2)` | `false` |

### Contracts, errors, budgets, phase 2 (`contracts-errors.test.ts`)

| Test | Doc promise | What happened |
|---|---|---|
| undefined detail code for `no_solution` | errors.md 2 Y212 | missing from `SYMBOLIC_UNDEF_CODES` |
| `CharacteristicPolynomial` is heavy | design 12.2 `heavy: true`; catalogue says heavy | not in `HEAVY_OPS` |
| non-symbol variable is `bad_variable` (`Solve(c, 2)`, `Solve(c, x+1)`) | errors.md Y002 | succeeds |
| unknown named argument is `bad_option` | errors.md Y007 | succeeds |
| wrong argument type lists forms | errors.md 1.1 `forms` lists every form (max 4) | `forms` empty |
| errors carry at most 3 suggestions | errors.md 1 (shares the `Solve(c, 2)` call) | succeeds, no error |
| tiny step budget gives `timeout` with `detail.stage` | errors.md Y208 "stage says where it stopped" | stage empty |
| Swinnerton-Dyer degree 16 | design 9.7 stops or stays correct | **returns a different polynomial**: value at x = 2 is 28708864 instead of 2324736 |
| `TrigExpand(cos(2x))` | design 11 phase 2 trig forms | unchanged |
| `CharacteristicPolynomial([[1,2],[3,4]])` | design 2.7 | sign error: gives `x^2 + 5x - 2` |
| 5 by 5 matrix is undefined `limit` | errors.md 4 "Matrix size ... undefined `limit`" | an error `limit` is returned instead of an undefined cell |

## Choices where the docs are silent

- Unknown: a `Numeric` digit count means decimal places or significant digits. Tests only check that the leading digits match the known constant and that half-to-even rounding holds for cases where both readings agree (`1/8`, `3/8`, `5/8` at 2 digits).
- `Numeric(x + 1/3, 5)` with a free symbol: read as "keep the symbol, make the numbers decimals" (design 2.4 returns an Expr). The engine refuses. This test is the least certain one.
- Infinity as a point of approach or integral bound is passed as `{ k: 'num', v: Infinity }` (the commands take `Number`).
- `IsPrime` of a negative number is `false` (a prime is positive).
- `PrimeFactors` over budget: either `limit` (design 2.6) or `timeout` (errors.md 4) is accepted.
- Wrong argument count: `arg_count` (language ruling Q7) or `no_matching_form` (errors.md 1.1) is accepted.
- Equivalence of non-rational expressions (trig, log): `true` or `unproven` is accepted, `false` is not (design 2.2 says exact random-point testing only proves for rational input).
- `Equivalent` and `IsZero` on the trig identity: `true` or `unproven`.
- Pole or singularity checks use `Integral(1/x, -1, 1)` and `(1, inf)` as the non-integrable cases.
- Solve reasons for budget exhaustion: `timeout`, `limit` or `unsupported`.
- Equivalence test points use positive and negative non-integer values so poles at simple integers are avoided.
- Display vs text: text mode must re-enter (ruling), so `x ≈ 1.1673` is checked on display mode, and `a < v < b` is checked on text output only where the ruling allows a chain (the chain is accepted by the parser).
- Acceptance 1 uses a fixed-seed generator (`prng`), acceptance 3, 4, 5 use fixed tables.

## Not tested, and why

- `time_dependent_input`, `not_symbolic`, `reserved_name`, `unknown_name`, `redefinition_domain` / `domain_changed`: these are raised by the kernel bridge and command table from the language's syntax tree (`TNode`); the package entry gives no way to build one without importing the kernel.
- `SolveODE`: the docs do not say how `y'` is written in the condition. The only convention (`yp`) is in the builder notes outside the Public API section, so no ODE test was written.
- `pending` and the two-lane `settle` flow, film seeking, frame time (acceptance 8): need the kernel and a Web Worker host. Only the `fastLaneMs` argument and the worker request handler are exercised.
- `Hold` display of the typed tree, `MixedNumber` display, plot switch, CAS view: UI parts (`ui.md`); only the value flags `display.asTyped`, `display.mixed`, `display.digits` are checked.
- Nerdamer, Algebrite and Compute Engine cross-checks (acceptance 6): none is installed. Independent finite-difference, quadrature and BigInt references are used instead.
- Speed targets in design 5.13 and the 250 KB bundle: they belong to the bench, not the spec tests.
- `Factor` of multivariate polynomials with 4 variables of total degree 12, Cantor-Zassenhaus size claims: only degree 16 Swinnerton-Dyer and degree 201 are exercised.
- Integral of piecewise functions and the derivative at a breakpoint (design 5.10): the public text syntax has no `piecewise` form to build from.
- `Rationalize` tolerance 1e-12 only through one float input.
- `over = reals` and `gaussian` (phase 2, `unsupported` in this build).

## Isolation

Files read:

- `handoff/symbolic/continue-symbolic-test.md`, `handoff/symbolic/test-brief.md`.
- `handoff/symbolic/builder-notes.md`: I read the **whole file** by mistake, not only the Public API section. It also contains the builder's design decisions, a bug list and gate-fix notes. I did not use them to choose an expectation: every expectation in the tests comes from the docs. The notes did show the `OPS` and `run` signatures, which are also in the declaration files.
- Docs: `docs/features/cas/design.md`, `errors.md`, `agent.md` (all in full); `docs/features/optimisation-discrete/design.md` (lines 200 to 204 and 352 to 360, plus a keyword search of all four files for symbolic mentions); `docs/design/libraries.md`; `docs/features/language/rulings.md`. I did not read `AGENTS.md`, `docs/process/pipeline.md` or `docs/features/cas/ui.md`.
- Public API: `packages/symbolic/src/index.ts`, and the `.d.ts` files produced by `npx tsc --declaration --emitDeclarationOnly --outDir $KIROCREW_SCRATCH/dts` (outside the repo) for the exported modules, plus the kernel's `Result`, `Notice` and `ErrorObject` declarations.
- Existing tests: the earlier agents' `algebra.test.ts`, `canonical.test.ts`, `print.test.ts`, `solve.test.ts`, `helpers.ts`. Their probe files were deleted without being opened.
- Incidental: vitest failure output printed a few source lines and stack frames from `packages/symbolic/src/parse.ts` (error construction at line 141). I did not open any `src` file. I also ran throwaway probe tests (deleted before commit) that print what `run` returns, to learn how arguments must be shaped (for example that notices are on `Result.notices`, not inside the value, and that `Infinity` is passed as a Number). The expectations in the committed tests were not changed to match that output.

Earlier agents wrote `algebra`, `canonical`, `print` and `solve` before I took over; I kept them, fixed the helper bug that hid every notice (notices were read from `value.notices` instead of `Result.notices`), loosened one test that assumed an unspecified denominator size (`nearestFraction` of pi), and made the rootof test check display mode. I cannot vouch for their isolation beyond what they wrote in their commits.

## Needs the integrator

- Nothing outside the allowed shell commands was needed.
- The brief says not to push; this run was told to push each commit to `origin feat/symbolic`, which was done.
