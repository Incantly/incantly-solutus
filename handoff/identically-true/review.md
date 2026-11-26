# Identically true relations: spec review

Branch `feat/identically-true`. This revision only updates the review. The finding under Must-fix is the original record.

**Verdict.** Matches. **Must-fix count: 0.**

The notice is one `identically_true` warning. The registered code stays `F103`, the template is unchanged, and the registered severity is now `warning`, which `makeNotice` copies onto the notice. `runCurveRelation` returns the relation value and does not call `notify`. A defining line whose value is the relation, a predicate whose body is one proved comparison, and `Curve` applied to such an equation each warn from the checker, once.

The proof in `identicallyTrue` uses the checked tree and the polynomial `classify` builds. It does not sample, and it does not read a name's value. The same tree on `==`, `>=`, or `<=` warns, so `sin(x) == sin(x)` warns and `x + 0` is a different tree from `x`. A difference whose every coefficient is the number `0` warns for those three operators at any degree, and a strict comparison of that polynomial does not, so `x > x` has no notice. A name blocks the quadratic step, so `x^2 >= a` has no notice. `x^2 + y^2 == -1` has no notice. `sin(x)^2 + cos(x)^2 == 1` has no notice, because that difference is not a polynomial. `x^2 >= 0` and `x^2 + y^2 + 1 > 0` warn. `x^2 > 0` and `x^2 + y^2 < 4` do not.

`quadraticAlways` snaps the six coefficients once, at `1e-12` times the largest absolute coefficient (or `1`). The determinant, the flat-axis quantity `A E − (B/2) D`, and the minimum are then compared exactly: `det < 0` is not proved, `det === 0` is the flat case, and `minHolds` is `min >= 0` or `min > 0` with no second snap. The three lines that used to get a false warning have tests, and those tests passed with no `identically_true` notice.

`compileRelation` copies `identicallyTrue: true` onto the relation value. The bodies of `residual` and `test` are unchanged. `Area`, `Intersect`, and `PointIn` are untouched. `paintCurveLike` returns before `fillRegion` and before `traceImplicit` when the field is set, for `Curve`, `Relation`, and `Region`. No new dependency, no `console`, and the new functions return booleans and notices.

## Must-fix

**Design 1, R1.4, R2.4.** `packages/kernel/src/language/relation.ts` (`quadraticAlways`, `minHolds`).

Design 1 treats a coefficient as `0` when its absolute value is below `1e-12` times the largest absolute coefficient (or `1`). After that snap, positive semidefinite means `A >= 0`, `C >= 0`, and `A C - (B/2)^2 >= 0`. A nonzero coefficient on the flat axis is not proved. `>=` holds when the minimum is `>= 0`, and `>` holds when the minimum is `> 0`.

The code applies that tolerance a second time: the determinant may be as low as `-tol`, the flat-axis quantity `A E - (B/2) D` may be as large as `tol`, and `minHolds` replaces a negative minimum with `0` when its absolute value is below `tol`. `>=` and `<=` then warn. These three are warned, and each fails at a real point:

- `x^2 + 0.000001 x >= 0` is `-2.5e-13` at `x = -0.0000005`. The linear coefficient stays above the snap, and `minHolds` turns the negative minimum into `0`.
- `x^2 + 10^{-12} y >= 0` is `-10^{-12}` at `(0, -1)`. The `y` coefficient is not below the snap threshold. `|A E|` equals the tolerance, so the flat-axis test accepts it. Design 1 says a nonzero coefficient on the flat axis is unbounded and is not proved.
- `x^2 + (2 + 10^{-13}) x y + y^2 >= 0` is about `-10^{-13}` at `(1, -1)`. The determinant is negative. It lies inside the tolerance, so the form is treated as semidefinite and the minimum is taken to be `0`.

R1.4 allows a missed identity. A false warning is outside the requirement. R2.4 asks for a quadratic that is true for every real `x` and `y`, or that is not warned.

**Fixed.** `packages/kernel/src/language/relation.ts` (`quadraticAlways`, `minHolds`). Coefficients are snapped once. The determinant, `A E − (B/2) D` (and `D` on the swapped axis), and the minimum are compared exactly. `q1`, `q2`, and `q3` in the test report succeed with no `identically_true` notice.

## Note

**R3 and design 3.** `packages/sdk/src/screen/symplot.ts`.

R3 holds for the painter design 3 names. R3.1 puts `identicallyTrue` on the relation value. R3.3 is that painter drawing no stroke and no fill for that value, and design 3 says the early return in `paintCurveLike` is the only painter change. A symbolic row is a CAS plot. `packages/symbolic/src/kernel-engine.ts` stores `ops`, `residual`, and `test`, and `symDrawing` copies those three onto a scene `Relation`. That object is not the relation value, and the CAS plot has no `identicallyTrue` field to drop. The ordinary scene path passes the cell value through, so a relation, a region, or `Curve(x == x)` with the flag is left blank. The other `traceImplicit` in `packages/sdk/src/screen/paint.ts` is the `Conic` case, which reads a conic's six coefficients. An identically true equation is classified as a curve, so that stroke does not see it.
