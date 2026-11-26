# Identically true relations: requirements

Area: a curve or a predicate that is true at every point. Source: `docs/features/curves-loci/design.md` section 13 (the identically-zero edge case) and section 15.9, and `docs/features/curves-loci/errors.md` section 2 (the warning `identically_true`). Branch: `feat/identically-true`.

Already registered, and left as a warning rather than a new error kind:

- The notice kind `identically_true` is already in the functions registry, code `F103`, with the sentence that every point satisfies it and the result is the whole plane.
- `identically_zero` is a different reason. It stays an undefined value (every input is a root, or an implicit derivative with no `y`). This work does not change it.
- An empty curve (`x^2 + y^2 == -1`) stays defined and draws nothing, with no `identically_true` notice (design 13). `empty_region` stays the reason for a predicate that is false throughout a window.

### R1. The line succeeds and carries one warning

1. WHEN the text of the line proves the relation is true at every real point, THE SYSTEM SHALL accept the line. The object stays defined.
2. THE SYSTEM SHALL attach one notice to that line's result. Its `kind` is `identically_true` and its `severity` is `warning`. The registry code stays `F103`.
3. THE SYSTEM SHALL NOT attach the notice twice when both the checker and a command see the same relation.
4. WHEN the text does not prove it, THE SYSTEM SHALL NOT attach the notice. A missed identity is allowed. A false warning is not.

### R2. What the text proves

The decision uses the checked tree. It does not sample, and it does not read a name's current value.

1. One comparison. A chain (`x == x == x`) and a boolean combination (`and`, `or`, `not`) are not proved here.
2. `==`, `>=` and `<=` whose two sides are the same tree. Same tree means the same shape, the same literals and the same names, ignoring source positions. `sin(x)` matches `sin(x)`. `x + 0` does not match `x`.
3. A difference that is the zero polynomial, of any degree, with every coefficient the number `0`. This covers `x == x` and `(x + 1) == (x + 1)` when the polynomial expansion cancels.
4. A polynomial of degree at most 2 in `x` and `y` whose six coefficients are numbers, decided exactly: true for every real `x` and `y`, or not. `x^2 >= 0` and `x^2 + y^2 + 1 > 0` are true. `x^2 > 0` is not, because it fails at the origin. `x^2 + y^2 < 4` is not.
5. A coefficient that is a name, or any other non-number, blocks the proof. `x^2 >= a` has no notice, even when `a` is `0` now.
6. A strict comparison of two identical sides, or of the zero polynomial, is not true. `x > x` has no notice.
7. A non-polynomial identity that is not the same tree on both sides is not proved. `sin(x)^2 + cos(x)^2 == 1` has no notice.

### R3. Nothing is drawn

1. The relation value SHALL carry `identicallyTrue: true` when R2 holds, so a painter can see it without reading the notice.
2. `test` and `residual` stay the mathematical functions. `Area`, `Intersect` and `PointIn` are unchanged.
3. The studio painter SHALL draw no stroke and no fill for that value. The warning is why the picture is blank.

### R4. Tests the tester writes

The builder writes none of these. They live in `packages/kernel/test/spec/functions/curves-implicit.test.ts` and `packages/kernel/test/spec/functions/inequalities.test.ts`. Assert `kind` and `severity`. The helper `noticeCodes` reads `code`, which is `F103`, so it does not show the reason name.

1. `tc = Curve(x == x)` succeeds, the object is defined, and the line has one notice with kind `identically_true` and severity `warning`. The value has `identicallyTrue: true`.
2. `tt(x, y) = x^2 >= 0` succeeds with that same notice, once, and `identicallyTrue: true`.
3. `x^2 + y^2 == -1` is defined and has no `identically_true` notice.
4. `x^2 + y^2 < 4` has no `identically_true` notice.
5. `x > x` has no notice. `x >= x` has the notice.
6. `sin(x) == sin(x)` has the notice. `sin(x)^2 + cos(x)^2 == 1` does not.
7. `x^2 >= a`, with `a` a number object, has no notice.
