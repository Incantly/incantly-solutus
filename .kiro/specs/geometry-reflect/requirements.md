# Function images that stay functions: requirements

Area: geometry transforms of a function of one number. Source: `docs/features/polygons-transforms/design.md` sections 6.5 and 6.7. Branch: `feat/geometry-reflect`.

Already built, and left as they are:

- `Translate(f, v)` and `Dilate(f, k, C)` stay a `Function`.
- `Reflect(f, point)` stays a `Function`. The formula `g(x) = 2Cy − f(2Cx − x)` is already in `mapFunction`.
- `Rotate(f, …)`, a slanted mirror, and every form with `progress` are a `Curve`. A partial fold is not a function of `x`.

### R1. The result type is chosen when the line is checked

1. A command form SHALL be able to name its result type from the arguments, at check time, before the line is committed.
2. The choice SHALL be `Function` or `Curve` for the forms in R2 and R3. It SHALL NOT be stored as a flag. It is derived from the argument.
3. WHEN the direction of the mirror is not fixed by the text of the line, THE SYSTEM SHALL choose `Curve`. A `Curve` image of a function is always correct (design 6.7).

### R2. Reflect a function in a line

1. WHEN the mirror is a vertical line fixed by the text, `x = c`, `Reflect(f, mirror)` SHALL be a `Function` `g(x) = f(2c − x)`.
2. WHEN the mirror is a horizontal line fixed by the text, `y = c`, `Reflect(f, mirror)` SHALL be a `Function` `g(x) = 2c − f(x)`.
3. `c` MAY be a name or a slider. `Reflect(f, Line((a, 0), (a, 1)))` stays a function while `a` changes, and `g` follows `a`.
4. `xaxis` is the horizontal line `y = 0`. `yaxis` is the vertical line `x = 0`. Both directions are fixed.
5. WHEN the mirror is a bare name of a figure object, `Reflect(f, m)`, THE SYSTEM SHALL return a `Curve`, even when `m` is vertical now. A later edit can tilt `m`, and the result type cannot change.
6. WHEN the mirror is slanted, or is a line through a point and a vector, or is parallel to another line, THE SYSTEM SHALL return a `Curve`.
7. The acceptance line is `f(x) = x^2 + x`, `g = Reflect(f, Line((1, 0), (1, 1)))`, and `g(3)` equals `f(−1)`, which is `0`. `g` has type `Function`.

### R3. Stretch a function across a horizontal line

1. WHEN the line is horizontal and fixed by the text, `Stretch(f, line, r)` SHALL be a `Function` `g(x) = c + r (f(x) − c)`, where `y = c` is the line.
2. WHEN the line is vertical, slanted, or a bare name, THE SYSTEM SHALL return a `Curve`. Scaling `x` stops the graph being a function of `x`.
3. `Stretch(f, vector)` and every `Stretch` with `progress` SHALL stay a `Curve`.

### R4. What counts as a fixed axis

The direction is fixed by the text only in these cases. The carrier of a segment or a ray counts, because a reflection uses the carrier.

1. `yaxis`, and a line, segment or ray through two points whose `x` expressions are the same tree and whose `y` expressions are not. Same tree means the same shape, the same literals and the same names. `a` matches `a`. `a + 0` does not match `a`.
2. `xaxis`, and the same with the coordinates swapped, for a horizontal line.
3. An equation the language already classifies as a line, whose `y` coefficient is the number `0` and whose `x` coefficient is not the number `0` (vertical), or the swap (horizontal). `x == a` is vertical. `x + y == 1` is not.
4. A point-and-vector line, a parallel, a perpendicular, or any other construction is not a fixed axis.

### R5. Catalogue

1. The catalogue line for reflecting a function across a line SHALL say that an axis-parallel mirror stays a function and any other mirror is a curve.
2. The catalogue line for stretching a function across a line SHALL say that a horizontal line keeps it a function.

### R6. Tests the tester writes

The builder writes none of these. They live in `packages/kernel/test/spec/geometry/transforms.test.ts`.

1. Unskip the vertical reflection: `g` is a `Function` and `g(3)` equals `0`.
2. A horizontal reflection: `f(x) = x^2`, mirror `y = 1`, `g(2)` equals `−2`, and `g` is a `Function`.
3. A horizontal stretch: `Stretch(f, Line((0, 1), (1, 1)), 2)` with `f(x) = x^2` gives `g(2) = 1 + 2 (4 − 1) = 7`, and `g` is a `Function`.
4. A slanted mirror, `Line((0, 0), (1, 1))`, is a `Curve`.
5. `Reflect(f, m)` where `m` is a vertical line object is a `Curve`.
6. `Reflect(f, Line((a, 0), (a, 1)))` stays a `Function` after `a` changes, and the value follows `a`.
7. `Reflect(f, yaxis)` is a `Function`. `Stretch(f, xaxis, 2)` is a `Function`.
8. `Reflect` and `Stretch` of a function with `progress` stay a `Curve`.
