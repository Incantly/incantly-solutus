# Statistics and charts: builder notes

Built from `docs/features/statistics/` and the spec in `.kiro/specs/statistics/`. Lint, typecheck and the whole suite
pass; the area's own tests are in `packages/kernel/test/spec/statistics/` (67 tests, reference values from SciPy).

## What is built

| Part | Where | Notes |
|---|---|---|
| One list (R1) | `commands/statistics/describe-commands.ts`, `core.ts` | Every command of design 4. Frequency forms never expand the data (order statistics by binary search on cumulative counts). Quantile methods `halves`, `hinges`, `linear`, `exclusive`, `nearest`; a literal outside the set is `bad_option`. Neumaier sums, corrected two-pass variance. One sort per list value (a `WeakMap` cache). |
| Two lists (R2) | same | Point lists or two number lists. Correlation clamped to [−1, 1]; Spearman is Pearson of average ranks and notes `ties_in_data`. |
| Frequency and tables (R3) | same | The automatic class rule of design 5 (one class per whole value for small ranges, Freedman–Diaconis rounded to 1, 2 or 5 × 10^k, Sturges when IQR is 0, at most 200 classes). |
| Charts (R4) | `chart-commands.ts` | Every chart of design 6 except `BarChart(dist)`. Unequal classes give density and `unequal_classes`. A chart of no data is defined with `n = 0`. |
| Fits (R5) | `fit.ts`, `fit-commands.ts` | Householder QR; polynomials on a Chebyshev basis mapped back to powers of x with their covariance; Levenberg–Marquardt as in design 7.3; data space by default, `space = "log"` on request. `FitSin` scans 400 frequencies then refines. The `Fit` record of 7.1. |
| Tests and intervals (R6) | `test-commands.ts`, `dist.ts` | Every test and interval of design 8 with data and summary forms. Normal (AS 241 quantile), t, chi-squared and F from log-gamma and the incomplete gamma and beta functions; p-values agree with SciPy to about 1e-12. Welch by default. |
| Errors (R7) | `index.ts`, `types.ts` | Reasons of errors 3; notices `S101` to `S108`; summaries of agent 2. |

## Changes outside the area

- `lists/types.ts`, `lists/ops.ts`: `registerRecordText(schema, text)`, so an area gives its records their own summary
  (a fit prints its equation). The generic record text is the fallback.

## Decided against the design

- **Charts and tables are records** (`Record<Histogram>`, `Record<Table>` …): the language's schema types are records
  only. The view should draw a record whose schema is in `CHART_SCHEMAS`.
- **No `dist` field** on tests and intervals: the `Distribution` type belongs to probability, not built yet.
- **`unknown_option`** is the language's `bad_argument` ("no form has a parameter called …").
- **`FitModel`'s Jacobian** is by central differences; a function value carries no expression tree.
- **`Quantile` with `halves` or `hinges`** for a p other than 0.25, 0.5 or 0.75 interpolates linearly through the five
  numbers.
- **`Frequency(..., scale = "relative")`** divides by the values inside the edges, the same as the histogram.
- **FitLineX** has no `line` field: the `Fit` schema is shared; `f` is y as a function of x (undefined for a vertical
  line).
- **Log-space fits** report standard errors of `ln a` and `b`, the line's own parameters.

## To be implemented

- `FitImplicit` (needs a `Curve` from an implicit polynomial) and `FitBand` (needs a `Region` between two curves).
- `BarChart(d: Distribution)`, `dist` fields, `Shade(r.dist, …)`: with probability.
- The `from` and `to` options of fits (the drawn range), the `mark` option of `Table`, `T.col("name")`.
- Record `draws` (design 13.4): the view draws `fit.f` for a fit.
- The data-analysis panels and `@datalab` (studio round).
- Benchmarks for the speed targets of design 10.4.
