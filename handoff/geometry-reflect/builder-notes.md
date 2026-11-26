# Function images that stay functions: builder notes

Branch `feat/geometry-reflect`. Tasks 1–3 are in the code. No tests were written, and nothing under `packages/kernel/test/` was edited. The skipped vertical-reflection test is still skipped.

`npx eslint` on the files below passed. `npx tsc -p tsconfig.json` passed (this package has no tsconfig of its own).

## Files

| File | What changed |
|---|---|
| `packages/kernel/src/language/table.ts` | `CommandForm` gains optional `resultType`. `ArgFacts` gains optional `axis: 'vertical' \| 'horizontal'`. |
| `packages/kernel/src/language/check.ts` | `inferCommand` calls `resultType` only after `matchForms` has chosen the form and the check hook has not refused the line. A returned string replaces `form.returns` for that call. `undefined` keeps `form.returns`. A throw becomes an `internal` error, as the check hook already does. `argFacts` sets `axis` from `fixedAxisOf` and still attaches `value` and `source` for a bare name, without an axis. |
| `packages/kernel/src/language/fixed-axis.ts` | The R4 decision, on the checked tree only. `yaxis` is vertical and `xaxis` is horizontal. A `Line`, `Segment` or `Ray` through two point literals is vertical when the `x` subtrees match and the `y` subtrees do not, and horizontal when swapped. Both pairs matching (a point) sets nothing. A relation the language already classifies as a line is vertical when the `y` coefficient is the number 0 and the `x` coefficient is not, and horizontal when swapped. `Line` of such an equation carries the same axis. A bare `ref`, a point-and-vector line, a parallel, a perpendicular, and any other command do not. Structural equality compares shape, literals, names and object ids, not source positions. `a` matches `a`. `a + 0` does not match `a`. |
| `packages/kernel/src/commands/geometry/commands.ts` | `Reflect(Function, line-like)` without progress: `resultType` is `Function` when `args[1].axis` is set, otherwise `Curve`. `Stretch(Function, line-like, ratio)` without progress: `Function` only when that axis is `horizontal`, otherwise `Curve`. The progress forms, vector stretch, and every other transform form are unchanged and have no `resultType`. Catalogue summaries say an axis-parallel mirror stays a function and any other mirror is a curve, and a horizontal line keeps a stretched function a function. The formulas are not in the summaries. |
| `packages/kernel/src/commands/geometry/transforms.ts` | `reflectLineFuncRule` calls `mapFunction` when there is no progress, the text fixed an axis, and the carrier is axis-parallel. Otherwise it calls `mapFunctionToCurve`, including a slanted mirror, so the oblique case is not a failure. `mapFunction` gains the horizontal stretch `g(x) = c + r (f(x) − c)` for the line `y = c`, and a zero ratio is `singular_transform`. `stretchFuncRule` uses that path only for a horizontal line fixed by the text and no progress. Vertical, slanted and named lines go through `mapFunctionToCurve`. A zero effective ratio (including progress once the ratio reaches 0) is `singular_transform` before either path. |

## Left as they were

`Translate`, `Dilate`, `Reflect` in a point, `Rotate`, vector stretch, and every `progress` form. No new error kind, state machine, dependency, or `console`.

## What the spec asks for that this code does not do

The tests in requirements R6. Those are tasks 5–7. The builder wrote none of them.

Nothing else in tasks 1–3 was left out. A bare name that is vertical or horizontal right now is still a curve value, because the text does not fix the direction: the rule does not read `ArgFacts.value` or `source`, and it does not treat a numerically axis-parallel carrier as a function unless `fixedAxisOf` says the text fixed that direction.
