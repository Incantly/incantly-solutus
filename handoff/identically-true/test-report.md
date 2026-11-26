# Identically true relations: test report

Branch `feat/identically-true`. Tests written from `docs/features/curves-loci/design.md` section 13, `docs/features/curves-loci/errors.md` section 2, and `.kiro/specs/identically-true/requirements.md` R4. Public API only.

Command: `npx vitest run packages/kernel/test/spec/functions/curves-implicit.test.ts packages/kernel/test/spec/functions/inequalities.test.ts`

Result: **83 passed, 3 skipped** (the three skips were already skipped and are not R4). Every R4 test passed. No product code was changed.

## R4 cases

| Case | Result | Doc line |
|---|---|---|
| 1. `tc = Curve(x == x)` succeeds, the object is defined, one notice with kind `identically_true` and severity `warning`, and the value has `identicallyTrue: true` | pass | `docs/features/curves-loci/design.md` line 372; `docs/features/curves-loci/errors.md` line 64; requirements R3 line 32 and R4 line 40 |
| 2. `tt(x, y) = x^2 >= 0` succeeds with that notice once, and `identicallyTrue: true` | pass | `docs/features/curves-loci/errors.md` line 64; requirements R2 line 24 and R4 line 41 |
| 3. `x^2 + y^2 == -1` is defined and has no `identically_true` notice | pass | `docs/features/curves-loci/design.md` line 373; requirements R4 line 42 |
| 4. `x^2 + y^2 < 4` has no `identically_true` notice | pass | requirements R2 line 24; requirements R4 line 43 |
| 5. `x > x` has no notice. `x >= x` has the notice, once, severity `warning`, and `identicallyTrue: true` | pass | requirements R2 lines 22 and 26; requirements R4 line 44 |
| 6. `sin(x) == sin(x)` has the notice and `identicallyTrue: true`. `sin(x)^2 + cos(x)^2 == 1` does not | pass | requirements R2 lines 22 and 27; requirements R4 line 45 |
| 7. `x^2 >= a`, with `a` a number object (`a = 0`), has no notice | pass | requirements R2 line 25; requirements R4 line 46 |

No R4 case failed, so there is no failure output.

## Must-fix: false identically_true warnings

Added in `packages/kernel/test/spec/functions/inequalities.test.ts`, inside `identically true predicates`. Each line must succeed and have no notice whose kind is `identically_true`. No product code was changed.

Command: `npx vitest run packages/kernel/test/spec/functions/inequalities.test.ts`

Result: **37 passed, 2 skipped** (the two skips were already skipped). All three new cases pass. No `identically_true` notice on any of them.

| Case | Result |
|---|---|
| `q1(x, y) = x^2 + 0.000001 x >= 0` succeeds with no `identically_true` notice | pass |
| `q2(x, y) = x^2 + 1e-12 y >= 0` succeeds with no `identically_true` notice | pass |
| `q3(x, y) = x^2 + (2 + 1e-13) * x * y + y^2 >= 0` succeeds with no `identically_true` notice | pass |

The first q3 line, `q3(x, y) = x^2 + (2 + 1e-13) x y + y^2 >= 0`, was a syntax error, not an `identically_true` failure. In this language two values next to each other need an explicit `*`, so that line was rejected as `missing_operator` (`L010`) before any notice check. The line above uses `*`. It succeeds and has no notice whose kind is `identically_true`.
