# Kernel rulings

Rulings on places where the docs disagree. They win over the other kernel docs where the two differ. The product owner can change any of them.

| # | Topic | Ruling |
|---|---|---|
| K1 | `Rename` form | Both `Rename(M, N)` and `Rename(M, "N")` are accepted and do the same thing. |
| K2 | `a = a + 1` | On an existing free `Number`, `Point` or `Bool` it is an assignment, run once with the old value (design section 8). On a new name it is `unknown_name`. Any other self-reference is `cycle`. Language design 3.17 now says the same. |
| K3 | Warnings and notices | A result's notices live in `notices` (README decision 4). `changed.warnings` is the same array, kept only so older readers work. |
| K4 | Summary text | `summary` is `"M = (2, 1)"`, with the type in a separate `type` field (agent.md form). |
| K5 | Value shape | Values are the language's raw runtime values (numbers, points, lists, function values), not a `{ t, v }` tagged union. The type comes from the object's `type` field. |
| K6 | `applyBatch` | `mode: 'atomic'` is the default: all lines or none, one undo step (README decision 8). `mode: 'independent'` runs every line on its own, as `errors.md` 5 rule 2 describes. |
| K7 | File version error | A file with an unknown version fails with its own kind, `version` (errors code K042), not `load_failed`. |
| K8 | `dragPlan` result | Returns `{ writes, reason?, kind? }`. `writes` is the list of `{ id, value }` free writes; when the drag is refused, `writes` is empty and `reason` says why (for example `locked`). |
| K9 | Memory per object | The 600-byte target is not met: each object keeps its checked and compiled line. Known gap, revisit after the first areas plug in. |
| K10 | Rate evaluation | Rates run as compiled closures. The flat `RateProgram` form in animation-time 7.2 is the motion area's job. |
