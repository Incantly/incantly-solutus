# Optimisation, discrete, financial, calculator: failures

Error objects follow `../errors/design.md` section 3. Area letters for codes: `O` optimisation, `G` discrete and graph, `F` financial, `S` calculator group.

Two classes, as in the kernel: **errors** (line rejected, figure unchanged) and **undefined values** (line accepted, maths cannot give a value, with a reason and a `detail`). A search that finds nothing useful is an undefined value with a reason, not an error. A line that is wrong whatever the numbers are is an error.

---

## 1. Line errors

### 1.1 Reused kinds

| Kind | When | The reference app | Ours |
|---|---|---|---|
| `no_matching_form` | Argument count or types fit no form | "Illegal argument" with forms | `forms` lists all forms (4 plus `formsOmitted`); `hint` names the mismatching position |
| `not_free` | `over` in `Maximize` / `Minimize` is a dependent object | The command runs and returns undefined | Error; `suggest` offers the free parents (as the kernel's drag plan finds them) |
| `unknown_name`, `type_mismatch` | As in the core | | |
| `limit` | Input over a cap at plan time (list lengths, section 5) | Hang or slow | Error with the limit name and value |

### 1.2 New kinds

| Kind | Code | Phase | When | The reference app | Ours |
|---|---|---|---|---|---|
| `no_dependency` | O001 | plan | The target does not depend on any `over` object | The result is the starting value, silently | Error; `related` has both names; hint "Maximize needs a target that changes when `a` changes" |
| `missing_range` | O002 | commit | A free Number in `over` has no slider range and no `from`/`to` | Result undefined | Error at commit; `suggest` has `a with min = 0, max = 10` and the `from=`/`to=` form |
| `bad_range` | O003 | typecheck | `from` is not less than `to`, or a range is not finite | Undefined | Error with the two values |
| `too_many_variables` | O004 | typecheck | More than 4 objects in `over` | Not supported | Error; hint says to fix some variables or use a function form |
| `bad_constraint` | O005 | typecheck | `where` is not a Bool, or does not depend on any `over` object | Not supported | Error; the second case is `no_dependency` on the constraint |
| `bad_samples` | O006 | typecheck | `samples` not a whole number from 8 to 20,000 | Not applicable | Error with the allowed range |
| `bad_graph_edge` | G001 | typecheck or run | In `Graph(S, pairs)` a pair is not two whole numbers in `0 … len(S) - 1` | Not applicable | Error naming the pair index; if the values come from a computed list, undefined `index_out_of_range` instead |
| `bad_weight` | G002 | typecheck or run | A negative weight, or the weights list length differs from the edges | Not applicable | Error with the count; a negative value from a computed list gives undefined `out_of_domain` |
| `bad_box` | G003 | typecheck | `box` is not four numbers with `x0 < x1`, `y0 < y1` | Not applicable | Error showing the four values |
| `bad_option_value` | G004 | typecheck | `weighted` not a Bool, `r` not positive | | Error listing allowed values |
| `bad_timing_flag` | F001 | typecheck | `atStart` not a Bool (a common slip is `type = 1`) | Number flag whose meaning is easy to invert | Error; `suggest` shows `atStart = true` |
| `not_a_list_of_numbers` | S001 | typecheck | `Mean`, `SD`, … on a list with non-numbers | Undefined | `no_matching_form` with the form `Mean(List<Number>)`; plus the index of the first bad item in `related` when known |
| `command_not_in_profile` | S002 | resolve | In the calculator profile, a command that exists but is hidden | Unknown command | `unknown_command` family; hint names the profile that has it (`Graphing`) |

---

## 2. Undefined values (not errors)

New and reused reasons. Each carries `detail` (`code`, `text`, `suggest?`).

### 2.1 Optimisation

| Reason | Detail | Meaning | The reference app | Ours |
|---|---|---|---|---|
| `unbounded` | O101 | The range is missing at run time (the slider's range was removed) | Undefined | `detail.text` "a has no range"; `suggest` the range line |
| `infeasible` | O102 | No sample satisfied `where` or all samples were undefined | n/a | `detail` says how many samples were tried and the nearest feasible one |
| `no_convergence` | O103 | The refine step hit its iteration cap | Result is whatever the search stopped at | Undefined only if the best candidate's value is not stable to 1e-6; otherwise a result with notice `low_accuracy` |
| `timeout` | O104 | Time budget spent (only for the largest cases) | | Result so far is kept as `refining` if one exists; undefined if none |
| `pending` | O105 | Job running | UI blocks | Previous value shown dimmed |
| `input_undefined` | | The target is undefined at the current point | | Standard |

Notices: `multiple_optima` (O201), `at_boundary` (O202), `not_attained` (O203), `narrow_feature_possible` (O204), `flat_target` (O205), `holes_in_target` (O206), `off_step` (O207), `where_is_thin` (O208), `low_accuracy` (O209), `proved` (O210).

### 2.2 Discrete

| Reason | Detail | Meaning | The reference app | Ours |
|---|---|---|---|---|
| `degenerate` | G101 | Too few distinct points, or all collinear | Undefined | `detail` says which; `suggest` offers `Segment(P, Q)` for a degenerate hull of two extremes |
| `no_path` | G102 | `from` and `to` are in different components | Undefined | `detail` gives the two component sizes |
| `not_a_vertex` | G103 | `from` or `to` is not within tolerance of a vertex | Undefined | `detail` names the nearest vertex and the distance; `suggest` the line with that vertex |
| `disconnected_hull` | G104 | `Hull(S, r)` pieces are separate | n/a | `detail` gives the number of pieces; `suggest` a larger `r` |
| `empty_list` | G105 | `S` has no points | Undefined | Standard |
| `limit` | G106 | Over the size cap (Delaunay and Voronoi 20,000 points; TSP 2,000 points; graph 100,000 edges) | Slow or frozen | Undefined with the limit name |
| `timeout` | G107 | TSP heuristic or Delaunay on the largest input out of time | | The best tour so far is kept as `refining` |
| `pending` | G108 | Sliced job running | | Previous value dimmed |

Notices: `duplicates_removed` (G201), `cocircular` (G202), `disconnected` (G203, MST gave a forest), `self_crossing` (G204, heuristic tour crosses itself), `heuristic` (G205, TSP not proved optimal), `exact` (G206, TSP proved optimal).

### 2.3 Financial

| Reason | Detail | Meaning | The reference app | Ours |
|---|---|---|---|---|
| `out_of_domain` | F101 | `rate <= -1`, `nper < 0` for `Payment`, negative `nper` where not allowed | Undefined | `detail.text` names the argument |
| `no_root` | F102 | `Rate` has no solution (all cash flows the same sign, or target unreachable) | Undefined | `detail` says which: "all cash flows have the same sign" or "the payments cannot reach the target" |
| `no_root` | F103 | `Periods` has no solution because the payment does not cover the interest | Undefined | `detail` "payment smaller than the interest each period" with the interest amount |
| `division_by_zero` | F104 | `Payment` with `nper = 0`; `Periods` with `pmt = 0` and `rate = 0` | Undefined | `detail` names the argument |
| `overflow` | F105 | `(1 + rate)^nper` exceeds the number range | Infinity | Undefined with the argument values |
| `not_finite` | F106 | Any NaN input | | Standard |

Notices: `multiple_rates` (F201, other roots listed), `rate_looks_like_percent` (F202), `fractional_periods` is not used.

### 2.4 Calculator group

| Reason | Detail | Meaning | The reference app | Ours |
|---|---|---|---|---|
| `out_of_domain` | S101 | `nCr`/`nPr`/`Binomial` with `k < 0`, `k > n`, or non-integers; `p` outside `[0, 1]`; `sd <= 0` | Undefined | `detail.text` names the argument and the allowed range |
| `empty_list` | S102 | `Mean`, `SD`, `MAD` of `[]` | Undefined | Standard |
| `degenerate` | S103 | `SampleSD` of one value | Undefined | `detail` "needs at least two values" |
| `limit` | S104 | `n` above 100,000 for combinations or 1,000,000 for `BinomialDist` | Slow | Undefined with the cap |
| `overflow` | S105 | The result as a Number is not finite (huge `nPr` shown as float) | Infinity | The exact `Expr` integer is returned instead when possible; undefined only above 1e6 digits |

---

## 3. Numeric failures

| Situation | The reference app | Ours |
|---|---|---|
| Optimiser meets NaN in the target | Search continues with NaN, may report an arbitrary point | NaN samples are skipped; share reported by `holes_in_target` |
| Target is constant | Returns the start | Returns the first sample, notice `flat_target` |
| Target has a jump at the optimum | Possibly a wrong point | Candidate refined to the jump; notice `not_attained` when the supremum is not reached |
| Catastrophic cancellation in `Rate` near zero | Wrong rate | `expm1`/`log1p` form plus series for tiny rates; verified by residual `|g(r)| < 1e-9 (1 + |v| + |p| n + |f|)` or undefined `no_convergence` |
| Rate root outside the grid (above 1000 % per period) | Fallback 0.1 | Undefined `no_root` with detail "no rate between -99.9% and 1000% per period" |
| Orientation test near zero | Wrong triangle, loops | Exact predicates: no failure |
| Many identical points in Delaunay | Ignored duplicates | Same, with the notice `duplicates_removed` |
| `Normal` far in the tail | May lose accuracy | Uses the complementary form: relative accuracy 1e-15 down to `z = -37`; below that returns exactly 0 |
| `BinomialDist` with large `n` | Overflow | Log-space and incomplete-beta forms; no overflow |

---

## 4. Limits

| Limit | Value | Result |
|---|---|---|
| Variables in `over` | 4 | `too_many_variables` |
| Samples per variable | 8 to 20,000 | `bad_samples` |
| Optimiser total evaluations | 2,000,000 | `timeout` with best so far |
| Points for hull | 200,000 | undefined `limit` |
| Points for Delaunay, Voronoi, MST | 20,000 | undefined `limit` |
| Points for TSP | 2,000 | undefined `limit` |
| Graph edges | 100,000 | undefined `limit` |
| `nCr`, `nPr` n | 100,000 | undefined `limit` |
| `BinomialDist` n | 1,000,000 | undefined `limit` |
| `BinomialDist(n, p)` list n | 10,000 | `limit` |

---

## 5. Examples

### 5.1 Target does not depend on the free number

Line: `best = Maximize(A, w)` where `A = Area(c)` and `w` is a slider not used by `c`.

```json
{
  "ok": false,
  "committed": false,
  "kind": "no_dependency",
  "code": "O001",
  "phase": "plan",
  "message": "A does not change when w changes.",
  "line": 1, "col": 20, "endCol": 21, "token": "w",
  "expected": [],
  "forms": [
    "Maximize(target: Number, over: Number) -> Number",
    "Maximize(target: Number, over: Point) -> Point",
    "Maximize(f: Function, a: Number, b: Number) -> Number"
  ],
  "hint": "Use a slider that A depends on. A depends on: r.",
  "suggest": ["best = Maximize(A, r)"],
  "recovery": "use_suggestion",
  "related": ["A", "w"],
  "fingerprint": "no_dependency:A:w"
}
```

### 5.2 Dependent object

Line: `best = Maximize(A, B)` where `B = r + 1`.

```json
{
  "ok": false,
  "committed": false,
  "kind": "not_free",
  "code": "K005",
  "phase": "typecheck",
  "message": "B depends on r, so it cannot be searched. Use a free number.",
  "line": 1, "col": 20, "endCol": 21, "token": "B",
  "expected": ["a free Number with a range"],
  "forms": ["Maximize(target: Number, over: Number) -> Number"],
  "suggest": ["best = Maximize(A, r)"],
  "recovery": "use_suggestion",
  "related": ["B", "r"],
  "fingerprint": "not_free:B"
}
```

### 5.3 Missing range

```json
{
  "ok": false,
  "committed": false,
  "kind": "missing_range",
  "code": "O002",
  "phase": "commit",
  "message": "w has no range to search.",
  "line": 1, "col": 20, "endCol": 21, "token": "w",
  "hint": "Give w a range, or pass from and to.",
  "suggest": ["w with min = 0, max = 10", "best = Maximize(A, w, from = 0, to = 10)"],
  "recovery": "choose",
  "related": ["w"],
  "fingerprint": "missing_range:w"
}
```

### 5.4 Constraint leaves nothing

Line accepted; the cell:

```json
{
  "name": "best",
  "type": "Number",
  "defined": false,
  "reason": "infeasible",
  "detail": {
    "code": "O102",
    "text": "No value of w between 0 and 10 makes w > 12 true.",
    "suggest": ["best = Maximize(A, w)"]
  }
}
```

### 5.5 Collinear points

Line: `H = ConvexHull(S)` where all points lie on a line:

```json
{
  "name": "H",
  "type": "Polygon",
  "defined": false,
  "reason": "degenerate",
  "detail": {
    "code": "G101",
    "text": "All 5 points lie on one line, so there is no hull area.",
    "suggest": ["H = Segment(S[0], S[4])"]
  }
}
```

### 5.6 No path

```json
{
  "name": "path",
  "type": "List<Segment>",
  "defined": false,
  "reason": "no_path",
  "detail": {
    "code": "G102",
    "text": "A and F are in different parts of the network (sizes 4 and 3).",
    "suggest": []
  }
}
```

### 5.7 Payment does not cover interest

Line: `n = Periods(0.01, -50, 10000)` (the payment is smaller than the interest, 100):

```json
{
  "name": "n",
  "type": "Number",
  "defined": false,
  "reason": "no_root",
  "detail": {
    "code": "F103",
    "text": "The payment of 50 is less than the interest of 100 each period, so the loan is never repaid.",
    "suggest": ["n = Periods(0.01, -150, 10000)"]
  }
}
```

### 5.8 Percent mistake (notice, not error)

Line: `m = Payment(5, 12, 1000)`:

```json
{
  "ok": true,
  "name": "m",
  "type": "Number",
  "value": "-0.000083",
  "notices": [{
    "code": "F202",
    "kind": "rate_looks_like_percent",
    "message": "A rate of 5 means 500% per period. For 5% write 0.05.",
    "severity": "warning"
  }]
}
```

### 5.9 Invalid combinations

Line: `c = nCr(5, 7)`:

```json
{
  "name": "c",
  "type": "Number",
  "defined": false,
  "reason": "out_of_domain",
  "detail": { "code": "S101", "text": "k must be between 0 and n; got n = 5, k = 7.", "suggest": ["c = nCr(7, 5)"] }
}
```

---

## 6. How the model recovers

| Kind or reason | Next line |
|---|---|
| `no_dependency` | Use `suggest[0]` (the free number the target uses) |
| `not_free` | Use a free parent |
| `missing_range` | Add the range, then resend |
| `infeasible` | Drop or loosen `where`; say that no value satisfies it |
| `unbounded` | Same as `missing_range` |
| `degenerate` | Add or move points; or use the segment suggestion |
| `no_path` | Add a segment that joins the parts, or say they are separate |
| `not_a_vertex` | Use the nearest vertex in the suggestion |
| `no_root` (financial) | Change the payment as suggested, or say that no rate exists |
| `rate_looks_like_percent` | Resend with the rate divided by 100 |
| `out_of_domain` (calculator) | Fix the arguments as suggested |

At most two retries, then the teacher says only what was drawn.
