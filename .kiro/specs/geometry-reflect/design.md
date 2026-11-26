# Function images that stay functions: design

Source of truth for behaviour: `docs/features/polygons-transforms/design.md` sections 6.5 and 6.7, and `requirements.md` in this folder. This file says where the code changes.

## 1. Result type on a form

`CommandForm` in `packages/kernel/src/language/table.ts` gains an optional hook:

```ts
resultType?: (c: FormCheck) => string | undefined
```

`inferCommand` in `packages/kernel/src/language/check.ts` calls it after the form is chosen and after `check` has accepted the line. A returned string replaces `form.returns` for that call. `undefined` keeps `form.returns`. The hook is pure. It reads `FormCheck` only.

No new state and no new error kind. The type is derived at check time. Nothing is stored on the figure besides the ordinary object type.

## 2. What the language tells the hook

`ArgFacts` gains an optional `axis: 'vertical' | 'horizontal'`.

`argFacts` sets it only when R4 holds. A bare name of a figure object never gets `axis`, even when `read` shows a vertical line. `value` and `source` stay as they are. The hook must not decide from them.

The comparison of two coordinate expressions is structural, on the checked tree, not on evaluated numbers.

## 3. Geometry forms

In `packages/kernel/src/commands/geometry/commands.ts`:

| Form | `returns` today | After |
|---|---|---|
| `Reflect(Function, line-like)` | `Curve` | `resultType`: `Function` when `args[1].axis` is set, otherwise `Curve` |
| `Reflect(Function, line-like, progress)` | `Curve` | unchanged |
| `Stretch(Function, line-like, ratio)` | `Curve` | `resultType`: `Function` when `args[1].axis` is `horizontal`, otherwise `Curve` |
| `Stretch(Function, line-like, ratio, progress)` | `Curve` | unchanged |
| `Stretch(Function, vector)` and its progress form | `Curve` | unchanged |

Summaries change as R5 says. The arithmetic is not duplicated in the summary.

## 4. Rules

`mapFunction` in `packages/kernel/src/commands/geometry/transforms.ts` already reflects a function in an axis-parallel line. `reflectLineFuncRule` calls it when the mirror is axis-parallel and calls `mapFunctionToCurve` otherwise. It does not report the oblique case as a failure.

`mapFunction` gains the horizontal stretch from design 6.7: normal along `y`, line `y = c`, `g(x) = c + r (f(x) − c)`. `stretchFuncRule` uses that when the line is horizontal and `mapFunctionToCurve` otherwise. A zero ratio is still `singular_transform`, as stretch of any other shape.

`progress` rules keep building a curve.

## 5. Out of this change

`Translate`, `Dilate`, `Reflect` in a point, `Rotate`, vector stretch, and every `progress` form. Jordan form, `Prove`, `LocusEquation`, `Envelope`, and the board. No studio screen.
