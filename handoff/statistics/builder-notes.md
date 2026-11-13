# Statistics and charts: builder notes

Built from `docs/features/statistics/` and the spec in `.kiro/specs/statistics/`, with a first probability round
(`.kiro/specs/probability/`). Lint, typecheck and the whole suite pass. The area's tests are in
`packages/kernel/test/spec/statistics/` (81 tests, reference values from SciPy); the studio's in `apps/studio/test/`
(48 tests).

## What is built

| Part | Where | Notes |
|---|---|---|
| One list (R1) | `commands/statistics/describe-commands.ts`, `core.ts` | Every command of design 4. Frequency forms never expand the data. Quantile methods `halves`, `hinges`, `linear`, `exclusive`, `nearest`; a literal outside the set is `bad_option`. Neumaier sums, corrected two-pass variance. One sort per list value (a `WeakMap` cache); lists over 4,096 values sort by a radix sort on the bit patterns. |
| Two lists (R2) | same | Point lists or two number lists. Correlation clamped to [−1, 1]; Spearman notes `ties_in_data`. |
| Frequency and tables (R3) | same | The automatic class rule of design 5; `Column(T, title)` reads a table column. |
| Charts (R4) | `chart-commands.ts` | Every chart of design 6, `BarChart(d)` included. Unequal classes give density and `unequal_classes`. A chart of no data is defined with `n = 0`. |
| Types | `types.ts`, `index.ts`, language `registerSchemaType` | Charts are `Chart<Histogram>`, `Chart<BoxPlot>` …, tables `Table`, with fields from the record schemas. |
| Fits (R5) | `fit.ts`, `fit-commands.ts` | Householder QR; polynomials on a Chebyshev basis; Levenberg–Marquardt (design 7.3); data space by default, `space = "log"` on request; `FitBand` for line, polynomial, log and basis fits; `FitImplicit` by the smallest singular vector; `from`, `to` give the drawn range. |
| Tests and intervals (R6) | `test-commands.ts`, `dist.ts` | Every test and interval of design 8, data and summary forms, with `dist`. p-values agree with SciPy to about 1e-12. |
| Probability, first round | `commands/probability/` | `Distribution` type, ten distributions, `Pdf`, `Cdf`, `Sf`, `Prob`, `Quantile`, moments, `Shade`, `CentralInterval`. |
| Errors (R7) | `index.ts`, `types.ts` | Reasons of errors 3; notices `S101` to `S108`; summaries of agent 2. |
| Speed (R8) | `packages/kernel/bench/statistics.bench.ts` | Every target met; see below. |
| Studio (R9) | `apps/studio/` | See below. |

## Speed (Node, warm; `npx vitest run --config packages/kernel/bench/vitest.config.ts`)

| Case | ms | Target |
|---|---|---|
| Histogram, 1e6 values | 9.6 | 15 |
| Histogram, 1e5 values, changed bins | 1.0 | 5 |
| Box plot, 1e6 values, sort included | 23.7 | 40 |
| Median, 1e6 values, fresh list | 23.5 | 25 |
| Variance, 1e6 values | 8.6 | (none; 15 used) |
| FitModel, 1,000 points, 4 parameters | 3.2 | 5 |
| FitModel, 10,000 points | 33.5 | 40 |
| FitExp / FitPoly 3 / FitSin, 1,000 points | 4.2 / 0.4 / 15.3 | 20 |

The median is close to its target: a single median of a fresh million-value list sorts it (design 10.1 suggests
quickselect, which would be faster for one call but gives up the shared sort).

## The studio

- `apps/studio/src/registry.ts`: every area built so far is registered; the stand-in commands are gone.
- Layout: a top bar (New, Examples, Data analysis, Script, undo, redo, keyboard help), the expression list on the
  left, the graph on the right, the data-analysis panel on the right when open; one column below 760 px.
- Expression list (`expressions.ts`): one row per line, colour swatch to hide or show, editable text, value, slider,
  inline error with suggested fixes, command completion and the active form while typing, result cards for tests and
  intervals with the statistic's distribution and the p-value region (`mini.ts`). A bare expression gets a free name.
- Graph (`graph/`): grid and axes with 1-2-5 steps, pan, wheel zoom, keyboard, zoom buttons, zoom to fit (charts may
  stretch the axes; geometry, pies and squares keep one scale), drag free points, tooltips on points, bars, boxes and
  slices. Draws points, vectors, segments, lines, rays, circles, arcs, polygons, functions and relations (through
  `@incantly/plot`), curves, regions, slope fields, lists of points and shapes, every chart, fits, distributions.
- Data analysis (`datalab.ts`): one variable (six plots, classes, overlays, statistics with n or n−1), two variables
  (models, degree, log space, residual plot, squares, bands, prediction), several variables (box plots, summary
  table, ANOVA). Add to figure writes the lines and `@datalab …`; Copy as lines.
- Nine examples cover geometry, functions, animation, lists and matrices, statistics, regression, tests,
  probability and charts.

## Decided against the design

- See `.kiro/specs/statistics/requirements.md` and `.kiro/specs/probability/requirements.md`.
- **`Quantile` with `halves` or `hinges`** for a p other than 0.25, 0.5 or 0.75 interpolates through the five numbers.
- **`Frequency(..., scale = "relative")`** divides by the values inside the edges, like the histogram.
- **FitLineX** has no `line` field; `f` is y as a function of x (undefined for a vertical line).
- **Log-space fits** report standard errors of `ln a` and `b`.
- **`FitModel`'s Jacobian** is by central differences: a function value carries no expression tree.
- **Bands of weighted fits** are `not_linear_model` for now.
- **The studio has its own Canvas 2D painter** rather than `packages/view`'s `FigureView`, which needs an adapter from
  kernel values to its drawables; that adapter is a view-integration task.

## To be implemented

- Chart interactions of ui.md 2.1: dragging bars and edges, the data table toggle (Alt+T), grow and morph animations.
- `with labels =`, `with residuals = true`, per-bar colours; the `mark` option of `Table`.
- The data grid of ui.md 4.4.
- The rest of probability (sampling, more distributions, the calculator view).

## Found in another area

- After `SetValue(n, 5)` (numbers), command objects that read `n` keep their old value until the next update pass
  (noted in the lists round, still open).
