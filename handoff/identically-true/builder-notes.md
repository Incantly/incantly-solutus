# Identically true relations: builder notes

Branch `feat/identically-true`. Tasks 1–3 are in the code. No tests were written, and nothing under `packages/kernel/test/` was edited.

`npx eslint` on the files below passed. `npx tsc -p tsconfig.json` passed. Existing language tests (2096) and the curve and inequality specs (76 passed, 5 still skipped) passed.

## Files

| File | What changed |
|---|---|
| `packages/kernel/src/language/relation.ts` | `identicallyTrue(tree, sx, sy)` is the proof in design 1. One comparison only. `==`, `>=` and `<=` of the same tree (the comparison `fixed-axis.ts` uses, source positions ignored). A difference whose every coefficient is the number `0`, at any degree, for those three operators; `>` and `<` of that polynomial are not proved. Otherwise a polynomial of degree at most 2 whose six coefficients are finite numbers: the quadratic `A x^2 + B xy + C y^2 + D x + E y + F` against `0`, with a coefficient snapped to `0` below `1e-12` times the largest absolute coefficient (or `1`). `<=` and `<` use the negated coefficients. A name, or any other non-number, blocks this step. `classify` is unchanged in the shape it returns and sets `identicallyTrue` when the proof holds. |
| `packages/kernel/src/language/fixed-axis.ts` | `sameTree` is exported so the proof and the axis check share one structural comparison. |
| `packages/kernel/src/language/tnode.ts` | The relation node and a comparison node may carry `identicallyTrue: true`. |
| `packages/kernel/src/language/check.ts` | `buildRelation` copies that flag onto the relation node. It does not warn. When the chosen form of `Curve` takes a `Relation` argument that carries the flag, the line gets one `makeNotice('identically_true')`. |
| `packages/kernel/src/language/lines.ts` | A defining line whose value is that relation gets the same notice, once. A predicate `p(x)` or `q(x, y)` whose body is one proved comparison gets it once, and the comparison node keeps the flag. |
| `packages/kernel/src/language/compile.ts` | `compileRelation` copies the flag onto `RelationValue`. `residual` and `test` are the same functions as before. A predicate function copies the flag from its comparison body onto the `FunctionValue`. |
| `packages/kernel/src/language/runtime.ts` | `RelationValue` and `FunctionValue` gain optional `identicallyTrue: true`. |
| `packages/kernel/src/commands/functions/index.ts` | Registered severity of `identically_true` is `warning`. Code stays `F103`. The template is unchanged. |
| `packages/kernel/src/commands/functions/types.ts` | `identically_true` is appended to `AreaNoticeKinds` so `makeNotice` accepts the kind that the runtime registry already had. |
| `packages/sdk/src/screen/paint.ts` | `paintCurveLike` returns immediately when `identicallyTrue` is true, before `fillRegion` and before `traceImplicit`. |

`runCurveRelation` does not call `notify`. A `Curve(x == x)` line and a `c(x, y) = x == x` line each carry the notice once, from the check above.

## What the spec asks for that this code does not do

The tests in requirements R4. Those are task 4. The builder wrote none of them.

These are outside the proof, as the spec already says, and the code leaves them unproved: `sin(x)^2 + cos(x)^2 == 1`, `x^4 >= 0`, a boolean combination (`x >= x and y >= y`), and a chain (`x <= x <= x`). An equality chain `x == x == x` still fails the existing chained-comparison error, so the proof never sees it.

An inline relation that is only an argument of `Area`, `PointIn`, `Boundary`, or `Line` does not get this notice. Design section 2 attaches it when the line defines the relation, when the line is a predicate of that comparison, or when `Curve` is applied to the equation. The sentence on the notice says the result is the whole plane, which is not true of those commands.

`packages/sdk/src/screen/symplot.ts` still rebuilds a symbolic relation from `ops`, `residual`, and `test` only. A symbolic row does not receive this flag. Design section 3 allows no other painter change.

## Tolerance

Coefficients are still snapped to `0` once, when the absolute value is below `1e-12` times the largest absolute coefficient (or `1`). After that snap, `quadraticAlways` and `minHolds` compare exactly. A negative determinant is not positive semidefinite, a nonzero flat-axis quantity (`A E - (B/2) D`, or `D` when the form is only in `y`) is not proved, and a negative minimum is not `>= 0`. The tolerance is not applied again to the determinant, that quantity, or the minimum. `x^2 + 0.000001 x >= 0`, `x^2 + 10^{-12} y >= 0`, and `x^2 + (2 + 10^{-13}) x y + y^2 >= 0` do not warn.
