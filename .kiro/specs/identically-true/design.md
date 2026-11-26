# Identically true relations: design

Source of truth for behaviour: `docs/features/curves-loci/design.md` section 13 and `docs/features/curves-loci/errors.md` section 2, and `requirements.md` in this folder. This file says where the code changes.

The notice is already registered in `packages/kernel/src/commands/functions/index.ts` as kind `identically_true`, code `F103`. Its severity there is `info`. errors.md lists it as a warning, and design 13 says `warning: identically_true`. Change the registered severity to `warning`. Keep the code and the template.

No new error kind, no state machine, no dependency, no `console`. A relation that is not proved stays exactly as it is today.

## 1. The decision

One function, used while the relation node is checked. Input: the checked comparison and the polynomial `classify` already builds in `packages/kernel/src/language/relation.ts`. Output: true only for R2.

`classify` subtracts the two sides into a polynomial in `x` and `y`. Coefficients are expression nodes.

1. Same tree on the two sides of `==`, `>=` or `<=`. Compare structure the way `fixed-axis.ts` compares coordinates: ignore source positions, and do not treat `a + 0` as `a`. `>` and `<` of the same tree are false.
2. Every coefficient of that polynomial is the number `0`. Then `==`, `>=` and `<=` are true, and `>` and `<` are false. This holds at any degree.
3. Otherwise, when the polynomial has degree at most 2 and all six coefficients are numbers, decide the quadratic `A x^2 + B xy + C y^2 + D x + E y + F` against `0`:
   - Positive semidefinite means `A >= 0`, `C >= 0` and `A C - (B/2)^2 >= 0`, with a coefficient treated as `0` when its absolute value is below `1e-12` times the largest absolute coefficient (or `1`).
   - A positive definite form (`A > 0` and the determinant above that tolerance) has one minimum, `F -` the value of the linear terms at the critical point. `>=` holds when the minimum is `>= 0`. `>` holds when the minimum is `> 0`.
   - A form with `A = C = B = 0` is the linear `D x + E y + F`. It is constant only when `D` and `E` are `0`. Then compare `F` with `0`.
   - A semidefinite form that still depends on `x` or `y` (`x^2 >= 0`, so `A > 0`, `B = 0`, `C = 0`) is true in the `>=` sense when the free variable has coefficient `0` and the remaining one-variable quadratic has minimum `>= 0`. The same with the axes swapped. A nonzero coefficient on the flat axis makes it unbounded above and below, so it is not proved.
   - `<=` and `<` are the same tests on the negated coefficients.
4. A coefficient that is not a number stops step 3. Step 1 and step 2 can still succeed.
5. Do not sample. Do not call the CAS. Do not prove `sin(x)^2 + cos(x)^2 == 1`.

## 2. Where the notice is attached

Check notices already travel onto the transaction result (`packages/kernel/src/language/figure.ts` copies `checked.notices`).

Warn once, with `makeNotice('identically_true')`, when the line defines a relation that step 1 proved, or when `Curve` is applied to one such equation. A command rule must not also call `notify` for the same line.

The relation node remembers the proof (`identicallyTrue: true` on that node) so the compiler can copy it.

## 3. The value and the painter

`RelationValue` in `packages/kernel/src/language/runtime.ts` gains an optional `identicallyTrue: true`. `compileRelation` in `packages/kernel/src/language/compile.ts` sets it from the node. `residual` and `test` are unchanged.

`paintCurveLike` in `packages/sdk/src/screen/paint.ts` returns before `fillRegion` and before `traceImplicit` when that field is set. No other painter change.

## 4. Out of this change

`tangent`, `sample_cap`, `missing_range`, an inequality of degree above 2 that is not the zero polynomial (`x^4 >= 0`), boolean combinations, chains of comparisons, `identically_zero`, `Area`, `Intersect`, `PointIn`, and any new studio screen.
