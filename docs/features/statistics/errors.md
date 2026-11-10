# Statistics and charts: errors

Format: section 9 of the core design. Static errors stop the line. Runtime problems give undefined with a reason code and a detail. Shared kinds from `lists-matrices/errors.md` (`unknown_binder`, `bad_argument`, `unknown_field`, `limit`, warnings) apply here too.

## 1. How GeoGebra handles failures here

- Wrong arguments: "illegal argument" or "wrong number of arguments" plus the accepted forms. Good, kept.
- A statistic of an empty list, a list with one value (sample deviation), or a list with a non-number: undefined, no reason.
- A correlation of a constant list: undefined.
- A fit that cannot converge or has too few points: undefined. The user cannot tell which of "too few points", "bad start" or "all x equal" happened.
- Test and interval commands with a text sign for the alternative: a wrong sign gives a generic illegal-argument message.
- A histogram with edges not in increasing order, or with class widths that make no sense: nothing drawn or an undefined object.
- A chart given the wrong kind of list does nothing or errors without saying which argument.
- No warnings: a chi-squared test with tiny expected counts, a proportion interval with few successes, a fit with more parameters than the data supports all report a number as if it were reliable.

## 2. Static errors

| Kind | When | Fields and notes |
|---|---|---|
| `no_matching_form` | Counts or types fit no form | `forms` lists all; hint points at the nearest form by parameter count |
| `bad_option` | Text option outside its set: `TTest(xs, 5, "greater")`, `Histogram(xs, scale = "percent")`, `Quantile(xs, 0.5, method = "R7")` | `param`, `got`, `allowed`; aliases accepted for tails (`"<"`, `">"`, `"!="`) are listed in `hint` |
| `unknown_option` | Named argument not in the form: `FitLine(P, weight = w)` | `expected` = option names; closest name in `hint` |
| `bad_argument` | A literal is wrong: `FitPoly(P, 2.5)`, `FitPoly(P, 15)`, `Classes(xs, 0)`, `ZInterval(xs, 2, 1.5)` (level not in (0,1)), `PieChart([1,2,3], ["a","b"])` (label count mismatch known statically) | `param`, `got`, `allowed` |
| `type_mismatch` | `Mean(P)` (points, not numbers), `Correlation(xs, 5)` | `expected`, `got`; hint "use Xs(P) or Ys(P)" |
| `unknown_field` | `fit.r_squared` | `expected` = `["f","equation","params","names","stderr","r2","adjR2","sse","rmse","n","dof","residuals","model","space","iterations"]` |
| `unknown_command` | `Mean2(…)`, `Stdev(…)`, `Regression(…)` | closest names in `hint` (`StdDev`, `SampleStdDev`, `FitLine`) |
| `limit` | A constant over the limit (`FitPoly(P, 13)` is `bad_argument`, `PieChart` with 5000 slices literal) | `limit`, `got` |
| `arity_mismatch` | `FitModel(P, f, [1, 2])` where `f` takes 2 arguments (needs 3) | `expected` arity, `got`; checked at line time because `f` and the literal list are known |

## 3. Runtime undefined reasons

| Reason | Commands | Detail example | GeoGebra | Recovery |
|---|---|---|---|---|
| `empty_list` | all statistics | "xs has no values" | undefined | Fill the list; check upstream `Filter` |
| `too_few_values` | `SampleVariance` (needs 2), `Correlation` (2), `FitLine` (2), `FitPoly(d)` (d+1 distinct x), `FitSin` (4), `TTest` (2), `CorrTest` (3) | "FitPoly degree 3 needs 4 distinct x values, got 3" | undefined | Add points or lower the degree |
| `zero_variance` | `Correlation`, `Spearman`, `ZScores`, `CorrTest`, `NormalQuantilePlot` | "all y values are 4" | undefined | Add spread |
| `has_undefined` | any aggregate | "value 7 is undefined (division_by_zero)" | undefined | `RemoveUndefined(xs)` |
| `size_mismatch` | two-list commands, `weights`, `Frequency` freq lists | "xs has 10 values, ys has 9" | undefined | Make the lengths equal |
| `degenerate_x` | `FitLine`, `FitPoly`, `FitLog` | "all x values are 3" | undefined | Use `FitLineX` for a vertical cloud |
| `out_of_domain` | `GeometricMean` (≤ 0), `HarmonicMean` (zero), `FitLog` (x ≤ 0), `FitPow` log start (x or y ≤ 0 with `space = "log"`) | "x = -2 at position 5; ln undefined" | undefined | Remove or shift those points |
| `negative_value` | `PieChart` | "value 3 is -4" | draws nonsense or undefined | Use a bar chart |
| `bad_edges` | `Histogram`, `Frequency`, `FrequencyPolygon` | "edges 4 and 3 are out of order" | undefined | Sort the edges, or use `Classes` |
| `bad_weights` | weights negative, non-whole frequencies | "frequency 3 is -1" | undefined | |
| `no_convergence` | `FitModel`, `FitPow`, `FitExp`, `FitSin`, `FitLogistic` | "stopped after 200 steps, sse still falling 3e-4 per step" | undefined | Give start values with `FitModel`, scale the data, or switch `space` |
| `singular_fit` | `FitPoly`, `Fit` | "basis functions are linearly dependent (condition 4e17)" | undefined | Remove a basis function; for polynomials lower the degree |
| `no_dof` | standard errors with `n = params` | "no spare degrees of freedom" | n/a | The fit is exact; no standard errors given (field undefined, record defined) |
| `not_linear_model` | `FitBand` on exponential/logistic/sine | "bands need a model linear in its parameters" | n/a | Use a linear or polynomial fit |
| `not_discrete` | `BarChart(d)` | "Normal is continuous" | n/a | Use `Histogram` of samples or `Pdf` |
| `bad_parameter` | tests: sigma ≤ 0, n < 1, `x > n`, `p0` not in (0,1), negative counts | "x = 12 exceeds n = 10" | undefined | |
| `cells_empty` | `ChiSquaredTest` with a zero row or column total | "row 2 sums to 0" | undefined | Remove that row |
| `groups_too_few` | `ANOVA` with fewer than 2 groups or a group with < 1 value | | undefined | |
| `not_finite` | overflow in sums of squares | | undefined | |

## 4. Warnings

| Warning | When | Fields |
|---|---|---|
| `expected_count_low` | any expected cell < 5 in a chi-squared test | `cells` (positions) |
| `normal_approx_weak` | `ZPropTest`/`ZPropInterval` with `n p` or `n (1 - p)` < 10 | `hint` suggests `method = "wilson"` or an exact binomial |
| `overfit` | `dof` < 3, or `FitPoly` degree ≥ n / 2 | `dof`, `degree` |
| `unequal_classes` | histogram chose density because class widths differ | text says "heights are density" |
| `ties_in_data` | `Spearman` with many ties (average ranks used) | |
| `all_equal_values` | `Classes`, `Histogram` on constant data | one class made |
| `log_space_bias` | `space = "log"` chosen | text: "errors are measured in log y" |
| `extrapolating` | prediction outside the data range | emitted by the panel, not a command |
| `large_result` | chart over 100,000 values will be binned for display | |

## 5. Examples

An enum option wrong:

```json
{
  "ok": false,
  "line": 6,
  "col": 27,
  "endCol": 34,
  "kind": "bad_option",
  "token": "\"larger\"",
  "message": "tail must be one of \"two\", \"left\", \"right\".",
  "param": "tail",
  "got": "larger",
  "allowed": ["two", "left", "right"],
  "forms": [
    "TTest(sample: List<Number>, mu0: Number, tail?: Text) -> Record",
    "TTest(mean: Number, sd: Number, n: Number, mu0: Number, tail?: Text) -> Record"
  ],
  "hint": "Use \"right\" for a test that the mean is larger. The signs \"<\" \">\" \"!=\" are also accepted."
}
```

A bad degree known at check time:

```json
{
  "ok": false,
  "line": 3,
  "col": 22,
  "endCol": 24,
  "kind": "bad_argument",
  "token": "15",
  "message": "FitPoly degree must be a whole number from 0 to 12.",
  "param": "degree",
  "got": 15,
  "allowed": "whole number 0..12",
  "forms": ["FitPoly(points: List<Point>, degree: Number) -> Record"],
  "hint": "A degree this high will oscillate. Try 2 or 3."
}
```

An undefined fit (not an error):

```json
{
  "ok": true,
  "name": "q",
  "type": "Record",
  "summary": "undefined (too_few_values): FitPoly degree 3 needs 4 distinct x values, got 3",
  "undefined": { "reason": "too_few_values", "detail": "degree 3 needs 4 distinct x values, got 3", "inputs": ["P"] }
}
```

A defined fit with a warning:

```json
{
  "ok": true,
  "name": "fit",
  "type": "Record",
  "summary": "Fit line: y = 1.92 x + 0.41, R² 0.992, n 5",
  "warnings": [
    { "kind": "overfit", "message": "Only 3 degrees of freedom remain; standard errors are unreliable.", "dof": 3 }
  ]
}
```

A non-convergent fit and the follow-up:

```json
{
  "ok": true,
  "name": "s",
  "type": "Record",
  "summary": "undefined (no_convergence): stopped after 200 steps",
  "undefined": {
    "reason": "no_convergence",
    "detail": "FitSin stopped after 200 steps; sse 12.4, still falling",
    "inputs": ["P"],
    "hint": "Try FitModel(P, f, start) with an estimate: a sine's c is about 2π divided by the period you can see."
  }
}
```

## 6. Better than GeoGebra

- Reasons on every undefined; `too_few_values` says how many are needed.
- Closed text options with the allowed list; tail signs accepted as aliases.
- Warnings for statistics that are computed but not trustworthy (small expected counts, overfitting, normal approximation).
- Fit failures say whether the problem is data (degenerate x), model (singular basis) or optimiser (no convergence), and what to try.
- Record field errors list all fields.
- Arity of `FitModel` is checked when the line is applied.
