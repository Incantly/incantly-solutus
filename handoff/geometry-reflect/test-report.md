# Function images that stay functions: test report

Branch `feat/geometry-reflect`. Tests are in `packages/kernel/test/spec/geometry/transforms.test.ts`, written from requirements R6, design 6.5 and 6.7, and the public figure API already used in that file. No package source was edited.

## Result

`npx vitest run packages/kernel/test/spec/geometry/transforms.test.ts`

| | |
|---|---|
| Tests | 74 |
| Pass | 74 |
| Fail | 0 |
| Duration | 604 ms |

Every R6 case passed. None failed.

## R6

| Case | Result | Assertion |
|---|---|---|
| 1 | pass | `f(x) = x^2 + x`, `g = Reflect(f, Line((1, 0), (1, 1)))`. `g` has type `Function`. `g(3)` equals `f(-1)`, which is `0`. |
| 2 | pass | `f(x) = x^2`, mirror `Line((0, 1), (1, 1))` (`y = 1`). `g` has type `Function`. `g(2)` equals `-2` (`2 - f(2)`). |
| 3 | pass | `Stretch(f, Line((0, 1), (1, 1)), 2)` with `f(x) = x^2`. `g` has type `Function`. `g(2)` equals `7` (`1 + 2 (4 - 1)`). |
| 4 | pass | `Reflect(f, Line((0, 0), (1, 1)))` with `f(x) = x^2` has type `Curve`. |
| 5 | pass | `m = Line((1, 0), (1, 1))`, `g = Reflect(f, m)` with `f(x) = x^2`. `g` has type `Curve`. |
| 6 | pass | `f(x) = x^2`, `g = Reflect(f, Line((a, 0), (a, 1)))`. `g` stays type `Function` after `a` moves from `1` to `4`. `g(3)` follows `g(x) = f(2a - x)`: `1` at `a = 1`, then `25` at `a = 4`. |
| 7 | pass | `Reflect(f, yaxis)` with `f(x) = x` has type `Function`, and `g(3)` equals `-3`. `Stretch(f, xaxis, 2)` with `f(x) = x^2` has type `Function`, and `g(3)` equals `18`. |
| 8 | pass | With `f(x) = x^2`, each of these has type `Curve`: `Reflect` in `Line((1, 0), (1, 1))` at `progress = 0.5`; `Reflect` in `Line((0, 1), (1, 1))` at `progress = 1`; `Stretch` across `Line((0, 1), (1, 1))` by `2` at `progress = 0.5`; `Stretch` across `Line((1, 0), (1, 1))` by `2` at `progress = 1`. |

No R6 case failed, so there is no actual type or value that disagreed with the assertion.
