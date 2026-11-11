# Fixer notes: symbolic

## Fixer round

Round 1 of at most 3, step 3 of `docs/process/pipeline.md`. Input: `handoff/symbolic/test-report.md` (86 failing spec tests of 497). Only `packages/symbolic/src/` was changed; `packages/symbolic/test/spec/` is untouched.

Result: 495 of 497 spec tests pass. The 2 that remain are contested below. The 2118 non-symbolic tests still pass. `npx eslint .`, `npx tsc -p tsconfig.json` and `npx vitest run` were run at the end (see Gates).

### Contested tests (left failing)

1. `numbers.test.ts` > "exact stationary points ... > showArg prints a result (sanity for the helper)". It expects `toText(x + 1)` to be `1 + x`. No doc line says that. The docs print the sum as `x + 1`: `docs/features/cas/agent.md` line 195 ("`draw` returns `s = x + 1`") and `docs/features/cas/design.md` line 371 ("`Simplify((x^2 - 1)/(x - 1))` returns `x + 1`"). The same spec suite also needs `(x - 2) * (x - 3)` (agent.md line 94) and `pi/6 + 2 * pi * k1` (design 2.3), which cannot print the constant first. The test pins the old internal order of the sanity helper, not a documented output.
2. `calculus.test.ts` > "definite integrals agree with adaptive quadrature to 1e-10 (acceptance 5)", the `sqrt(x)` row on [0, 4] only. The reference is a fixed 4000-step Simpson rule, not adaptive quadrature (`docs/features/cas/design.md` section 9, item 5, says "agree with adaptive quadrature to 1e-10"). Simpson's rule converges slowly at the `sqrt` endpoint singularity: that reference is off from the true value 16/3 by 2.567e-6 (measured: `simpson(Math.sqrt, 0, 4, 4000) - 16/3`). `Integral(sqrt(x), x, 0, 4)` now returns exactly `16/3`, so no correct engine can match the reference to 1e-10. The five rows before it (`x^2*exp(x)`, `1/(1+x^2)`, `sin(x)^2`, `x*sin(x)`, `ln(x)`) pass.

### Judgement calls (tests pass, doc is not explicit)

- `CompleteSquare` of a cubic returns `not_polynomial` (Y004). `errors.md` section 2 lists `CompleteSquare` under Y004 but a cubic is a polynomial; the error says "not a quadratic". Tell me if the doc should say `bad_argument` instead.
- `Factor(12)` returns a display product `2^2 * 3` built directly (`factoredIntegerNode` in `node.ts`). The canonical constructors fold it back to `12`, so the node is not canonical and `parse(toText(n))` gives `12`.
- `Solve` no longer accepts a bare number as its second argument (it used to be read as a lower bound). The documented forms are `(c, v)`, `(cs, vs)` and `(c)`; the bound is the named `from`.
- A bounded interval prints as the chain `-1 < x < 1` in text mode too (the parser reads the chain back). The `and` form is gone from text.

### Fixes, by group (one commit each)

Group 1, commit `359bd8e`: products and printing.
- `node.ts` `mul`: equal bases combine, `x * x^2` is `x^3` (the base `x` with exponent 1 was skipped). This made `expandNode` recurse forever on `(x + 1) * (x + 1)`; `rules.ts` now distributes with `mulExpanded` instead of going through `mul`.
- `assume.ts` `signOf`: an even power of a nonzero base is `pos` (needed once `a * a` became `a^2`).
- `print.ts`: a negated product term used to print wrong (`x - (-5 * x)`); it now negates through `negateNode`. Sums print in polynomial order with plain numbers last; products put sum factors last, in text order. Rational coefficients print as a quotient (`sqrt(2)/2`). Speech uses digits in `toSpeech` ("5 x") and words in `condSpeech`. A zero base with a negative exponent stays in the numerator, so `x/(0*e)` round-trips.

Group 2, commit `f522f2f`: algebra, assumptions, equivalence.
- `poly.ts` `mpolyGcd`: the Kronecker images of the two polynomials used different bases whenever their degrees differed, so the gcd of `x^2 - 1` and `x - 1` came out 1. Both now use one base. This one bug broke `Simplify` cancellation, `Factor` self-verification and `Equivalent`.
- `rules.ts` `collectAtoms`: a negative integer power of a polynomial is no longer a generator (it made `together` distribute instead of cancel).
- `node.ts` `mul`: `x * x^-1` is no longer merged while the base can vanish, so `Simplify` can record the excluded value (`x/x` is `1` with `x != 0`). `simplifyNode` keeps the excluded values of whichever candidate wins; `togetherNode` records monomial factors too.
- `poly.ts` `mpolyFactor`: the factors of the univariate image are now recombined by subsets (needed for `sin(x)^2 - 1`).
- Complex factoring: `verifyFactor` multiplies out and reduces `i^2`; `Equivalent`/`IsZero` do the same (`reduceImaginary`).
- `assume.ts`: a fact `a > b` takes its sign from `b`; `Assume` rejects a condition with no symbol and names the contradicting pair in `related`.
- `Equivalent` on conditions: structural proof by a constant factor, then solution-set comparison (`equivalentBySolutions`); it no longer answers `false` from shape alone. `Equivalent` reports notice `differ_at` when the two sides cancel different factors.
- `Factor(n)`, `CompleteSquare` error kind: see judgement calls.

Group 3, commit `f8e7ba6`: errors, limits of the contract tables, edge cases.
- `contracts.ts`: `no_solution` is Y212; `CharacteristicPolynomial`, `Inverse`, `Determinant` are in `HEAVY_OPS` (they are `heavy: true` in the catalogue).
- `run.ts`: a named argument the command does not have is `bad_option` (Y007) with the options listed; `no_matching_form` and `arg_count` list up to four forms; a budget stop carries `detail.stage` (command and last rule).
- `ops.ts`: the variable argument of `Solve` must be a symbol (`bad_variable`); a matrix over the size limit is undefined `limit`, not an error.
- Undefined cases (`undefinedness` in `ops.ts`): `0^0`, `0 * inf`, `0/0` and `inf - inf` are `indeterminate`; `1/0` is `division_by_zero`; `ln`, `log`, `sqrt`, `asin`, `acos` outside the real domain are `out_of_domain` with the `domain = complex` suggestion; a power over 100,000 digits is `limit`. Applied to `Evaluate`, `Simplify`, `Expand`, `Substitute` and `Numeric`, not only `Evaluate`. `Expr` with a literal `/0` is the error `division_by_zero_literal` (Y011). For these to be visible, `add` no longer cancels `inf - inf`, and `mul` no longer lets a zero annihilate `0 * inf` or `0 * 0^-1`.
- `TrigExpand` expands `sin`/`cos`/`tan` of sums and of whole multiples (`cos(2x)`, up to 12).
- `Numeric` keeps free symbols and turns every symbol-free part into a decimal. `Hold` sets `display.asTyped`.
- `IsPrime` of a non-positive number is `false`. Miller-Rabin uses 20 prime bases from 3317044064679887385961981 up (that number is a strong pseudoprime to the first 13).
- `rules.ts`: `1/sqrt(2)` simplifies to `sqrt(2)/2` (rule `roots.rationalize`); `4^(3/2)` to `8` and `2^(3/2)` to `2 sqrt(2)` (rule `roots.exact`).

Group 4, commit `75988e1`: solving and printing.
- `poly.ts` `refineRootFloat`: bisection squared the denominator every step and overflowed to `NaN`; it now bisects on one shared denominator. This fixed `NSolve` (`x == NaN`), `ToNumber`/`Numeric` of a `rootof`. `Numeric(rootof(...), 40)` is exact to 40 digits (`refineRootRational`).
- `print.ts`: display mode shows `x ≈ 1.1673` for a `rootof`.
- `node.ts`: exact inverse trig folds (`asin(1/2)` is `pi/6`, `atan(1)` is `pi/4`, ...), so trig families print as `pi/6 + 2 * pi * k1`. The family parameter orders after the base value.
- `solve.ts`: an exponential equation in one base (`exp(2x) - 3 exp(x) + 2 == 0`) is solved through `u = b^x`; a linear equation with a constant coefficient such as `e` solves (`ln(x) == 1` is `x == e`).

Group 5, commit `4422723`: `Solve` for `abs(g) < k` squares both sides and decides by the sign of `k`.

Group 6, commit `29a2977`: calculus.
- `calc.ts` `substitutionCandidates` skipped the whole integrand, so no substitution was ever tried; `x * exp(x^2)` and `x * cos(x^2 + 1)` now integrate. Tabular integration started from the wrong column for `sin`/`cos` (`x * sin(x)` was wrong, and so was the definite integral). `1/cos(x)^2` and `1/sin(x)^2` are in the table.
- Definite integrals: an endpoint where the antiderivative is not finite is decided by the one-sided limit; an infinite one is `divergent` (`1/x` on [0, 1], `1/x` to infinity). Infinite bounds report `divergent` when the result is infinite.
- Limits: infinity-aware folding (`exp(-inf)` is 0, `ln(inf)`, `atan(inf)`); `foldExtended` no longer depends on factor order; `1^inf`, `0^0` and `inf^0` go through `exp(exponent * ln(base))` before `1^x` folds to 1; roots split near `0+` (`sqrt((1+u)/u^2)`); L'Hopital for `inf/inf`, for `0 * inf`, and on the original variable at infinity (`ln(x)/x`, `x^2/exp(x)`). A function that can jump (`abs`, `sign`, `floor`, `ceil`, `round`, `min`, `max`, piecewise) is decided by comparing both sides: `abs(x)/x` at 0 is `no_limit` with "The left limit is -1 and the right limit is 1." and the `LimitAbove`/`LimitBelow` suggestions. An oscillating function at infinity is `no_limit`.

### To be implemented

Nothing in the 86 failing tests is left unfixed. Items outside this round's test list that the builder noted and that remain open:
- `Factor` over the rationals still uses peeling plus a bounded Kronecker step, not Cantor-Zassenhaus with Hensel lifting (`docs/features/cas/design.md` section 5.6, algorithm table). The bench case `x^6 - 2*x^5 - 3*x^4 + 8*x^3 + 3*x^2 - 8*x + 4` (irreducible) takes about 8 ms per call against the 5 ms target; I did not change the algorithm. The degree-16 Swinnerton-Dyer polynomial passes the budget test (stops or returns a correct result).
- `Factor` `over = reals | gaussian`, Laplace, `TrigAuto`, resonance ODEs and quartic Ferrari are phase 2 and 3 (builder notes, "Left out").
- Limits by series expansion (design 5.10, "series expansion to a fixed order for what remains") are not built; forms that need it return `unsupported`.
- `Numeric` of an expression with free symbols turns closed parts into decimals through `toDecimal`, which falls back to a double when decimal.js cannot evaluate a part.

### Gates

Run from the repository root of the working copy on branch `feat/symbolic`:

- `npx eslint .`: clean.
- `npx tsc -p tsconfig.json`: clean.
- `npx vitest run`: 2613 passed, 2 failed (the 2 contested tests above); 2615 total.

## Findings round (step 5) and regression tests (step 6)

Input: `handoff/symbolic/findings.md`, SYM-SM-1 to 27. Result: 15 fixed, 12 marked `to be implemented` (8 of them partly fixed, with what is left written in the finding). Lint and typecheck are clean and all 599 symbolic tests pass.

### Regression tests

`packages/symbolic/test/spec/regressions.test.ts` has a section per finding for SYM-SM-1 to 15, 18 to 24, 26 and 27. It was written from the evidence in the findings before the second half of the fixes; 40 of its 102 tests failed at that point and all pass now. SYM-SM-16, 17 and 25 have no test because they are not fixed.

### Spec test that changed behaviour

- `contracts-errors.test.ts` "input over 20,000 nodes is the error limit" builds a 42,000-token list with `parseExpression`. The token cap is 100,000 so that the node limit, not the parser, refuses it.

### Choices where the docs are silent

- `DivisorsList` returns at most 100,000 divisors and is undefined `limit` above that.
- A prime test charges one step per 64-bit word of the number for each modular multiplication, so a very large test ends as `timeout` by steps on every machine.
- `IsZero` of a closed constant that cannot be proved zero and is not clearly non-zero is `unproven`. It was `true` under a float tolerance before.
- The zero test rewrites `ln` of a whole perfect power over its smallest base (`ln(8)` as `3 ln(2)`) before giving up, so `2^(ln(8)/ln(2)) - 8` is proved zero.
- A limit at a trig pole that runs to the same infinity from both sides is that infinity; to opposite infinities it is `no_limit`.
