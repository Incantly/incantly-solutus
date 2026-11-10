# Statistics and charts: design

Status: draft for review. Fits `docs/design/formula-language-and-kernel.md` (the "core design"). Uses the `List`, `Matrix` and `Record` types from `docs/features/lists-matrices/design.md`, and distribution maths from `docs/features/probability/design.md` (p-values, critical values). This area covers descriptive statistics, ranking and frequency, correlation, regression and fit commands, every chart, hypothesis tests and intervals, and the three data-analysis tools (one variable, two variables, several variables).

## 1. What this area does

A learner has numbers and wants to see what they say: where the middle is, how spread out they are, whether two quantities move together, what line or curve fits, whether an observed difference is real. A teacher wants a figure that shows this while talking: a histogram appears, a box plot slides in under it, a fitted line sits on a scatter plot with its R² in a readout, a shaded p-value region shows how unusual a result is.

### Sub-features

| Group | Commands |
|---|---|
| Describe one list | `Describe`, `Count`, `Sum`, `Mean`, `Median`, `Mode`, `Min`, `Max`, `DataRange`, `Q1`, `Q3`, `IQR`, `Quantile`, `FiveNumber`, `Outliers`, `Variance`, `StdDev`, `SampleVariance`, `SampleStdDev`, `MeanAbsDev`, `MedianAbsDev`, `Rms`, `GeometricMean`, `HarmonicMean`, `Skewness`, `Kurtosis`, `Sxx`, `SumSq`, `ZScores`, `Rank`, `RankOrdinal`, `Rescale` |
| Describe two lists | `Covariance`, `SampleCovariance`, `Correlation`, `Spearman`, `Sxy`, `Syy`, `SumProd`, `RSquare`, `SumSquaredErrors`, `Residuals`, `Describe` (on points) |
| Frequency and classes | `Tally` (lists), `Classes`, `ClassesByWidth`, `Frequency`, `FrequencyTable`, `ContingencyTable`, `Table` |
| Charts | `BarChart`, `Histogram`, `FrequencyPolygon`, `BoxPlot`, `BoxPlots`, `DotPlot`, `StemPlot`, `PieChart`, `LineGraph`, `StepGraph`, `StickGraph`, `NormalQuantilePlot`, `ResidualPlot`, `Squares` |
| Regression and fits | `FitLine`, `FitLineX`, `FitPoly`, `FitPow`, `FitExp`, `FitGrowth`, `FitLog`, `FitSin`, `FitLogistic`, `FitImplicit`, `Fit`, `FitModel`, `FitBand`, `CorrTest` |
| Tests and intervals | `ZTest`, `TTest`, `ZTest2`, `TTest2`, `TTestPaired`, `ZPropTest`, `ZPropTest2`, `ChiSquaredTest`, `ANOVA`, `ZInterval`, `TInterval`, `ZInterval2`, `TInterval2`, `TIntervalPaired`, `ZPropInterval`, `ZPropInterval2` |
| Data-analysis tools | One variable, two variable regression, several variable: section 7 |

Left out here, with the owner:

- Spreadsheet cell, row, column, fill and range commands, and the spreadsheet view: not in v1.
- Percentile of the position in a distribution (`Quantile(Distribution, p)`) and all distributions: `probability`.
- The Probability Calculator view and its Statistics tab as a window: `probability/ui.md` (it calls the tests defined here).

Command names are ours and follow ordinary statistics words. Many of GeoGebra's twenty-odd `X`/`Y`/`Sigma`/`Sample` variants collapse into composition: the mean of the x values is `Mean(Xs(P))`, the sample standard deviation of the y values is `SampleStdDev(Ys(P))`.

## 2. How GeoGebra does it (summary)

- **Statistics are many separate commands**, each a small calculation object over a list. Mean, median, mode, quartiles, variance and deviation exist in population and sample forms; for lists of points there are separate `X` and `Y` variants of mean, deviation and sum-of-squares, about forty names in all. Each reads the list again.
- **Quartiles** use one convention (median of halves); percentile uses a library routine with its own interpolation rule. The two do not agree in general, and the manual does not make the difference prominent.
- **Regression** is a family of commands for line, polynomial, power, exponential, growth, logarithmic, sine and logistic fits. Linear least squares is done directly, others by closed forms or a nonlinear least-squares optimiser from a numerical library (Levenberg–Marquardt). They return a function object; a separate set of commands gives R², sum of squared errors, correlation and covariance. There is also an implicit-curve fit and a general fit by supplied functions.
- **Charts** are separate objects: bar chart, histogram (left- or right-closed variants), frequency polygon, box plot, dot plot, stem plot (as text), pie chart, line, step and stick graphs, normal quantile plot, residual plot. Several take either raw data or ready-made counts; a "density" flag with a scale factor controls histogram heights.
- **Tests and intervals** are commands returning lists of numbers, in a fixed positional order that the user must look up (statistic, p-value, degrees of freedom, and so on). Alternatives are given as text signs. Many are duplicated for "data" and "summary numbers" inputs.
- **Data Analysis tools** (inside the spreadsheet) offer: one-variable analysis (histogram, box plot, dot plot, normal quantile, stem-and-leaf, with a statistics table and class controls), two-variable regression analysis (scatter plot, a choice of models, residuals, statistics, prediction), and multi-variable analysis (stacked box plots, summary table, ANOVA). The panels read their data from the spreadsheet range.
- **Weak spots**: unnamed output lists; one convention for quartiles; a histogram with unequal classes silently misleads unless density mode is chosen by hand; fits that fail return undefined with no reason; log-space versus data-space ambiguity for exponential and power fits is not stated; the analysis tools depend on a spreadsheet; the same statistic computed many times on the same list.

## 3. Our design: values and types

### 3.1 New value types

`Record` and `Matrix` come from the lists-matrices area. This area adds `Table` and `Chart`.

```ts
interface TableValue {
  readonly caption?: string;
  readonly cols: readonly TableCol[];          // equal length columns
}
type TableCol =
  | { readonly title: string; readonly kind: 'Number'; readonly data: Float64Array }
  | { readonly title: string; readonly kind: 'Text'; readonly data: readonly string[] };
```

`Table(titles, col1, col2, ...)` builds one from lists. Tables are drawn as a grid, each cell formatted by the figure's digits setting; cells can be highlighted by a Bool column (`Table(...)` option `mark = list`). A `Table` has fields `.rows`, `.cols`, and `T.col("name")` is the column as a list (a field access `T.name` when the title is a legal name).

```ts
type ChartValue =
  | BarChart | Histogram | Polygon | BoxPlotChart | DotPlotChart | PieChartValue
  | StemChart | PointsChart | NormalQuantileChart;

interface BarChart       { kind: 'bar'; xs: Float64Array; heights: Float64Array; width: number; labels?: string[] }
interface Histogram      { kind: 'histogram'; edges: Float64Array; heights: Float64Array; counts: Float64Array;
                           scale: 'count' | 'relative' | 'density'; closed: 'left' | 'right'; outside: number }
interface BoxPlotChart   { kind: 'boxplot'; y: number; halfHeight: number; stats: FiveNumberValue; outliers: Float64Array;
                           whisker: 'minmax' | 'tukey'; label?: string }
interface DotPlotChart   { kind: 'dotplot'; values: Float64Array; binWidth: number }
interface PieChartValue  { kind: 'pie'; values: Float64Array; labels?: string[]; centre: Point; radius: number }
interface StemChart      { kind: 'stem'; stems: number[]; leaves: string[]; unit: number }
interface PointsChart    { kind: 'line' | 'step' | 'stick' | 'freqpoly' | 'residual'; points: Point[] }
interface NormalQuantileChart { kind: 'nq'; z: Float64Array; x: Float64Array; refSlope: number; refIntercept: number; r: number }
```

A chart is an object with a value and a drawable. Fields give the numbers behind it: `h.counts`, `h.edges`, `h.total`, `b.q1`, `p.fractions`. Charts are dependent on their inputs and recompute when data changes. Data of a free list is editable on the chart (bars are draggable when the chart was made from ready heights; see `ui.md`).

### 3.2 Shared rules for statistic commands

- Inputs are `List<Number>` unless a form says `List<Point>`. A `List<Point>` is accepted where two lists are needed (x and y taken from it).
- The value of any statistic over a list with an undefined element is undefined (`has_undefined`) with the first offending position in the detail. A hint tells the model to use `RemoveUndefined`.
- Empty or too-short lists give undefined with the reason (`empty_list`, `too_few_values`, `zero_variance`, `size_mismatch`).
- **Weights.** `Mean`, `Variance`, `StdDev`, `Median`, `Quantile`, `Q1`, `Q3`, `Mode`, `Count`, `Sum`, `Describe` all accept a second list of frequencies in the same position: `Mean(values, freqs)`. Frequencies are non-negative whole numbers (counts), up to 2^53 total. Computation never expands the data.
- **One sort per list.** The kernel keeps a one-slot cache keyed by the list value's identity: the sorted copy and its cumulative sums. `Median`, `Q1`, `Q3`, `Quantile`, `Mode`, `Rank`, `Describe` on the same list reuse it. A rule's output is recomputed only when the list changes.

### 3.3 Defaults that matter

| Choice | Our default | Reason |
|---|---|---|
| `Variance`, `StdDev` | population (divide by n) | Names say it. `SampleVariance`, `SampleStdDev` divide by n-1. The two sets exist side by side so the model never has to choose a flag. |
| `Covariance` | population; `SampleCovariance` for n-1 | Same. |
| Quartile family (`Q1`, `Q3`, `IQR`, `FiveNumber`, `BoxPlot`, `Describe`, `Outliers`) | method `"halves"` | School convention. |
| `Quantile(list, p)` | method `"linear"` | The general-purpose convention. |
| Histogram heights | counts if class widths are equal; densities if unequal | An unequal-width histogram of counts misleads. We choose density by default and say so in the summary. |
| Histogram classes | left-closed, last class closed | `[a, b)`, last `[a, b]` |
| Box whiskers | `"minmax"` | `"tukey"` (1.5 IQR, outliers as dots) is a named option. |
| Tail words | `"two"`, `"left"`, `"right"` (aliases `"!="`, `"<"`, `">"`) | Readable by a model. |
| Interval level | 0.95 | |
| Two-sample t | Welch (unequal variance) | `pooled = true` for equal variance. |

Quantile methods (a fixed enumeration for the `method` named argument):

| Name | Rule | Used by default in |
|---|---|---|
| `"halves"` | median of lower half and upper half; the middle value is excluded when n is odd | `Q1`, `Q3`, `IQR`, box plot |
| `"hinges"` | as halves, but the middle value is included in both halves when n is odd | on request |
| `"linear"` | linear interpolation at position `1 + p (n - 1)` | `Quantile` |
| `"exclusive"` | interpolation at `p (n + 1)`, clamped | on request |
| `"nearest"` | the smallest data value whose cumulative share is at least p | on request |

## 4. Descriptive commands

`L` is `List<Number>`; `F` is an optional frequency list of the same length. `P` is `List<Point>`.

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `Count` | `(L)`, `(L, F)` | Number | lists area has the base form |
| `Sum`, `Product` | as lists | | |
| `SumSq` | `(L)`, `(L, F)` | Number | sum of squares of the values |
| `SumProd` | `(L1, L2)` | Number | sum of the products |
| `Mean` | `(L)`, `(L, F)` | Number | |
| `Median` | `(L)`, `(L, F)` | Number | |
| `Mode` | `(L)`, `(L, F)` | `List<Number>` | all values with the highest count, ascending. If every value occurs once, returns all values and the summary says "no repeated value". |
| `Min`, `Max` | `(L)` | Number | |
| `DataRange` | `(L)` | Number | max minus min |
| `Q1`, `Q3`, `IQR` | `(L[, F][, method])` | Number | `method` named |
| `Quantile` | `(L, p[, F][, method])` | Number | `p` in [0, 1]; `Quantile(L, ps)` with a list of `p` gives a list |
| `FiveNumber` | `(L[, method])` | Record `{ min, q1, median, q3, max }` | |
| `Outliers` | `(L[, k])` | `List<Number>` | values outside `[q1 - k IQR, q3 + k IQR]`, `k` default 1.5 |
| `Variance`, `StdDev` | `(L[, F])` | Number | population |
| `SampleVariance`, `SampleStdDev` | `(L[, F])` | Number | needs n ≥ 2 |
| `MeanAbsDev` | `(L)` | Number | mean of `|x - mean|` |
| `MedianAbsDev` | `(L)` | Number | median of `|x - median|` |
| `Rms` | `(L)` | Number | square root of the mean of squares |
| `GeometricMean` | `(L)` | Number | positive values only; else `out_of_domain` |
| `HarmonicMean` | `(L)` | Number | non-zero values of one sign |
| `Skewness`, `Kurtosis` | `(L)` | Number | moment ratios (population); kurtosis is not "excess" |
| `Sxx` | `(L)` | Number | sum of squared deviations from the mean |
| `ZScores` | `(L)` | `List<Number>` | `(x - mean) / sd` using population sd |
| `Rank` | `(L)` | `List<Number>` | ranks 1..n; ties get the average |
| `RankOrdinal` | `(L)` | `List<Number>` | ties broken by position |
| `Rescale` | `(L, lo, hi)` | `List<Number>` | linear map of min..max to lo..hi |
| `Describe` | `(L[, F][, method])` | Record | `n, sum, mean, median, mode, min, max, range, q1, q3, iqr, variance, sd, sampleVariance, sampleSd, sumSq, sxx, skewness, kurtosis, method` |
| `Describe` | `(P)` | Record | adds `x: Record`, `y: Record` (each a one-variable describe), `r`, `r2`, `cov`, `sampleCov`, `sxy`, `spearman`, `n` |

Two lists:

| Command | Forms | Notes |
|---|---|---|
| `Covariance`, `SampleCovariance` | `(L1, L2)`, `(P)` | |
| `Correlation` | `(L1, L2)`, `(P)` | Pearson `r` in [-1, 1]. Undefined `zero_variance` if either list is constant. |
| `Spearman` | `(L1, L2)`, `(P)` | Pearson of the average ranks. |
| `Sxy`, `Syy` | `(L1, L2)`, `(P)` / `(L)` | Sum of products of deviations; sum of squared deviations of y. |
| `RSquare` | `(P, f)` | `1 - SSE/SST` of the function `f` against the data (can be negative if `f` is worse than the mean). |
| `SumSquaredErrors` | `(P, f)` | |
| `Residuals` | `(P, f)` | `List<Number>` of `y - f(x)`. |

Command mapping: the "X and Y" variants of mean, deviation (population and sample) and sums of squares are `Mean(Xs(P))`, `StdDev(Ys(P))` and so on; the sum-of-squares and sum-of-products families are `SumSq`, `SumProd`, `Sxx`, `Sxy`, `Syy`.

## 5. Frequency, classes and tables

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `Tally` | `(L)` | Record `{ values, counts }` | lists area |
| `Classes` | `(L)`, `(L, bins)` | `List<Number>` of edges | Auto rule below. `bins` a whole number from 1 to 10,000. |
| `ClassesByWidth` | `(L, width)`, `(L, width, start)` | `List<Number>` | Edges at `start + i*width` covering the data; `start` defaults to the largest multiple of `width` not above the minimum. |
| `Frequency` | `(edges, L)`, `(edges, L, closed)` | `List<Number>` | Counts per class, `closed` `"left"` (default) or `"right"`. Named: `scale = "count"|"relative"|"density"`, `cumulative = true`. Values outside the edges are not counted. |
| `FrequencyTable` | `(edges, L[, closed])`, `(L)` | Table | Columns: class, count, relative, cumulative count, cumulative relative. `(L)` uses the distinct values. |
| `ContingencyTable` | `(a, b)` | Record `{ observed, rowLabels, colLabels, table }` | `a`, `b` equal-length lists of categories (Text or Number). `table` has totals. |
| | `(observed: Matrix, rowLabels, colLabels)` | same | From ready counts. |
| `Table` | `(titles, col1, col2, …)` | Table | Up to 12 columns, 1,000 rows (more are paged in the view). |

**Auto class rule** for `Classes(L)` and for all chart forms that take raw data:

1. If the data is all whole numbers and range ≤ 30: one class per integer value, edges at half-integers (`k - 0.5`).
2. Else use Freedman–Diaconis width `2 IQR n^(-1/3)`. If IQR is 0 use Sturges, `ceil(log2 n) + 1` classes.
3. Round the width up to 1, 2 or 5 times a power of ten; set the first edge at the largest multiple of the width not above the minimum.
4. Cap at 200 classes.

This replaces "the user must pick the number of classes" and gives stable pictures when the list changes by one value.

## 6. Charts

All chart commands return a `Chart` (or `Table`). Forms with raw data accept the auto rule. In the tables of this document, `; opt` after a form means the optional named argument `opt = value` at the end of the call, for example `Histogram(data, scale = "relative")`.

| Command | Forms | Options |
|---|---|---|
| `BarChart` | `(heights)`, `(labels, heights)`, `(xs, heights, width)`, `(L, width)` | `(L, width)` counts raw data into bars of that width centred on distinct values |
| | `(expr, k, from, to)` | heights `expr` for each whole `k`; bars at `k` |
| | `(d: Distribution)`, `(d, from, to)` | bar heights are the probability mass at each whole number (discrete distributions) |
| `Histogram` | `(L)`, `(L, bins)`, `(edges, L)`, `(edges, heights)` | `scale`, `closed`; the two-list form is told apart by the shape: a list of length `edges - 1` is heights |
| `FrequencyPolygon` | `(edges, L)`, `(edges, heights)`, `(h: Histogram)` | `cumulative` makes an ogive |
| `BoxPlot` | `(y, halfHeight, L)`, `(y, halfHeight, min, q1, med, q3, max)` | `whisker`, `method`, `label` |
| `BoxPlots` | `(lists: List<List<Number>>)`, `(lists, labels)` | stacked plots with automatic y positions; `whisker`, `shared = true` (common axis) |
| `DotPlot` | `(L)`, `(L, binWidth)` | stacked dots at each value; bins merge values closer than `binWidth`; default width is `DataRange/60` |
| `StemPlot` | `(L)`, `(L, scale)` | text chart; `scale` shifts stem units by powers of ten; leaves sorted; negative stems shown with the sign |
| `PieChart` | `(values)`, `(values, labels)`, `(values, labels, centre, radius)` | `start` angle; negative or all-zero values: undefined |
| `LineGraph`, `StepGraph`, `StickGraph` | `(P)` | one rendering mode each: polyline, steps, vertical sticks |
| `NormalQuantilePlot` | `(L)` | plots sorted data against expected normal scores with the plotting position `(i - 0.375)/(n + 0.25)`; reference line through the quartile pairs; field `r` (correlation of the pairs) |
| `ResidualPlot` | `(P, f)` | points `(x, y - f(x))` with a zero line |
| `Squares` | `(P, f)` | `List<Polygon>`: for each point, the square whose side is the residual; the total area is `SumSquaredErrors`. Used to teach least squares by dragging a line. |

Fields on charts: `Histogram`: `edges`, `counts`, `heights`, `total` (area or count), `binWidth` (if uniform), `outside`. `BoxPlot`: `min q1 median q3 max iqr outliers`. `PieChart`: `fractions`, `angles` (radians), `total`. `BarChart`: `heights`, `total`. `NormalQuantilePlot`: `r`, `slope`, `intercept`. `StemPlot`: `text` (Text, monospace layout).

Rules and edge cases:

- Heights in `Histogram(edges, heights)` are used as given (the model says what they mean through `scale`; the chart records it for labels and for `total`).
- A `Histogram` over data with outside values reports `outside`.
- Zero-width or reversed edges: undefined `bad_edges`. Edges must be strictly increasing.
- `BarChart(d: Distribution)` for a continuous distribution is `bad_argument` at check time (a `Distribution` knows whether it is discrete); a mismatch at run time is undefined `not_discrete`.
- `PieChart` fractions of negative values are undefined `negative_value`.
- A chart of 0 data points draws nothing; its value is defined with `n = 0`, not undefined, so the figure keeps its place.

## 7. Regression and fit commands

### 7.1 The `Fit` record

Every fit command returns this record (schema name `Fit`):

```ts
interface FitRecord {
  f: Function;                 // the fitted curve (drawn by default: draws = 'f')
  equation: string;            // "y = 1.92 x + 0.41", text for the teacher and the screen reader
  params: number[];            // coefficients in the order of the model's definition
  names: string[];             // ['a', 'b'] etc.
  stderr: number[];            // standard errors of params (undefined entries allowed)
  r2: number; adjR2: number;
  sse: number; rmse: number;
  n: number; dof: number;      // dof = n - params.length
  residuals: number[];
  model: string;               // 'line', 'poly3', 'exp', ...
  space: 'data' | 'log';       // where the least squares was done
  iterations: number;          // 0 for closed forms
}
```

Use: `fit = FitLine(P)` makes the record; the line is drawn because the record draws `f`. `fit.r2`, `fit.params[1]`, `fit.residuals`. `g = fit.f` makes a stand-alone Function object when a style of its own is needed.

All commands take data as `List<Point>` or as two lists `(xs, ys)`. Named options on every fit: `weights = list` (non-negative, same length), `from`, `to` (the x-range the drawn curve covers, default the data range extended 5 % each side).

### 7.2 Commands

| Command | Model | Algorithm | Domain checks |
|---|---|---|---|
| `FitLine(P)` | `y = a x + b` | centred two-pass closed form | at least 2 points, not all x equal (`degenerate_x`) |
| `FitLineX(P)` | `x = a y + b` (x on y); record also has `line: Line` and draws it | same with roles swapped | not all y equal |
| `FitPoly(P, degree)` | polynomial, degree 0 to 12 | QR on a Chebyshev basis after mapping x to [-1, 1]; coefficients converted to powers of x | needs more than `degree` distinct x |
| `FitPow(P)` | `y = a x^b` | `space = "data"` default: Levenberg–Marquardt started from the log-log line; `space = "log"`: line in log-log | x > 0 and y > 0 for the log start; if y has other signs and `space = "data"`, uses a heuristic start |
| `FitExp(P)` | `y = a e^(b x)` | same scheme | y of one sign |
| `FitGrowth(P)` | `y = a b^x` | same; `b > 0` | |
| `FitLog(P)` | `y = a + b ln x` | linear least squares on `ln x` | x > 0 |
| `FitSin(P)` | `y = a + b sin(c x + d)` | variable projection: scan `c` over 400 values from `2π/(range)` to the Nyquist limit of the spacing, solve the three linear coefficients at each `c`, then refine all four with Levenberg–Marquardt | at least 4 points; needs spread in x |
| `FitLogistic(P)` | `y = a / (1 + b e^(-c x))` | start from range heuristics (`a` ≈ 1.1 max y, midpoint x at the median crossing), then Levenberg–Marquardt | |
| `FitImplicit(P, degree)` | algebraic curve of that degree through the points | smallest singular vector of the monomial design matrix (after centring and scaling) | degree 1 to 6; at least `(d+1)(d+2)/2 - 1` points. Returns a `Curve`. |
| `Fit(P, basis)` | `y = c1 f1(x) + c2 f2(x) + …` | linear least squares by QR over the supplied `List<Function>` | at least as many points as functions |
| `FitModel(P, f, start)` | `f(x, p1, …, pk)` with parameters starting at `start` (a `List<Number>`) | Levenberg–Marquardt with exact Jacobian from differentiating the expression tree | `f` takes `1 + length(start)` arguments |
| `FitBand(fit, level, kind)` | confidence or prediction band | for models linear in their parameters (line, poly, `Fit`, log) | `kind` is `"mean"` or `"prediction"`; returns a Region between two curves; else undefined `not_linear_model` |
| `CorrTest(P[, tail])` | t test of `r = 0` | `t = r sqrt((n-2)/(1-r²))` | n ≥ 3 |

Examples (our syntax):

```text
P = [(1, 2.1), (2, 3.9), (3, 6.2), (4, 7.8), (5, 10.1)]
fit = FitLine(P)
Readout("R²", fit.r2)
q = FitPoly(P, 2)
```

### 7.3 Nonlinear least squares: Levenberg–Marquardt

- Parameters scaled by their start magnitude; damping `λ` starts at `1e-3 * max(diag(JᵀJ))`; accept a step if the sum of squares drops, else multiply `λ` by 10 and retry; after acceptance divide `λ` by 3.
- Jacobian columns come from symbolic partial derivatives of the model's expression tree (the same derivative engine as `Derivative`). Where that fails (a user function built from numeric routines) central differences with step `cbrt(eps) * max(1, |p|)`.
- Stops when the relative drop in the sum of squares is below 1e-14 on two steps, or the scaled gradient norm is below 1e-10, or at 200 iterations (undefined `no_convergence`).
- Standard errors from `sqrt(diag(s² (JᵀJ)⁻¹))` where `s² = sse/dof`; reported undefined when `dof = 0` (`no_dof`).
- Speed target: 1,000 points and 4 parameters in under 5 ms; 10,000 points in under 40 ms.

### 7.4 Why two spaces

Fitting `y = a e^(bx)` by a straight line through `ln y` weights small values heavily and can give a poor fit in the original data. Minimising the error in y itself is what most learners expect. We default to the data space, start from the log-space solution, and expose `space = "log"` for the textbook method. The record says which was used.

## 8. Tests and intervals

All return a Record. `x` and `n` are counts.

### 8.1 Common fields

| Test result field | Meaning |
|---|---|
| `statistic` | z, t, chi-squared or F value |
| `p` | p-value for the tail |
| `df` | degrees of freedom (undefined for z) |
| `tail` | `"two"`, `"left"` or `"right"` as used |
| `estimate` | the sample statistic tested (mean, difference, proportion) |
| `se` | standard error used |
| `n` | sample size (or total) |
| `dist` | the `Distribution` of the test statistic under the null (so the Probability Calculator and `Shade` can draw it) |

Interval results: `lo`, `hi`, `level`, `margin`, `estimate`, `se`, `df`, `dist` (the distribution used for the critical value).

### 8.2 Test commands

| Command | Forms |
|---|---|
| `ZTest` | `(sample, mu0, sigma[, tail])`, `(mean, sigma, n, mu0[, tail])` |
| `TTest` | `(sample, mu0[, tail])`, `(mean, sd, n, mu0[, tail])` |
| `ZTest2` | `(sample1, sample2, sigma1, sigma2[, tail])`, `(mean1, sigma1, n1, mean2, sigma2, n2[, tail])` |
| `TTest2` | `(sample1, sample2[, tail])`, `(mean1, sd1, n1, mean2, sd2, n2[, tail])`; option `pooled` |
| `TTestPaired` | `(sample1, sample2[, tail])` |
| `ZPropTest` | `(x, n, p0[, tail])` |
| `ZPropTest2` | `(x1, n1, x2, n2[, tail])` (pooled proportion for the standard error) |
| `ChiSquaredTest` | `(observed: Matrix)` independence; `(observed: List, expected: List[, ddof])` goodness of fit. Extra fields: `expected`, `contributions`, and a warning when any expected count is below 5. |
| `ANOVA` | `(groups: List<List<Number>>)` → `{ F, p, dfBetween, dfWithin, ssBetween, ssWithin, msBetween, msWithin, grandMean, groupMeans, table }` |
| `CorrTest` | section 7 |

`Wald` and `Wilson` proportion intervals: `ZPropInterval(x, n, level, method = "wald"|"wilson")`, default `"wald"` as taught; a warning suggests Wilson when `x` or `n - x` is below 10.

### 8.3 Interval commands

`ZInterval(sample, sigma[, level])`, `ZInterval(mean, sigma, n[, level])`, `TInterval(sample[, level])`, `TInterval(mean, sd, n[, level])`, `ZInterval2(sample1, sample2, sigma1, sigma2[, level])`, `TInterval2(sample1, sample2[, level])` (option `pooled`), `TIntervalPaired(sample1, sample2[, level])`, `ZPropInterval(x, n[, level])`, `ZPropInterval2(x1, n1, x2, n2[, level])`, and the summary-number forms of each.

### 8.4 Method notes

- p-values come from the distribution functions in `probability`: normal, Student t, chi-squared, F. A two-sided p for an asymmetric statistic (chi-squared, F) is always the right tail only.
- Welch degrees of freedom by the Satterthwaite formula; the t distribution takes non-integer `df`.
- Small cell warnings: `expected_count_low`.
- Tests record the `dist` so a single line draws the picture: `Shade(r.dist, r.statistic, 1e9)` for the right tail.

## 9. The data-analysis tools

These are the one-variable, two-variable and several-variable panels. In our design they are views over the same commands, not separate engines. A **data source** is any of:

- a `List<Number>` object (one variable);
- a `List<Point>` object, or two number lists chosen as x and y (two variables);
- several `List<Number>` objects, or a `List<List<Number>>`, optionally with a labels list (several variables);
- a frequency pair: values list and frequency list.

```ts
interface DataLabState {
  mode: 'one' | 'two' | 'multi';
  sources: ObjectRef[];                 // names; the panel rewrites if a source is renamed
  plot: 'histogram' | 'boxplot' | 'dotplot' | 'nq' | 'stem' | 'bar'        // one variable
      | 'scatter' | 'residual'                                         // two variables
      | 'boxplots';                                                    // several
  classes: { auto: boolean; edges?: number[]; bins?: number; width?: number; start?: number };
  histogram: { scale: 'count' | 'relative' | 'density'; polygon: boolean; normalOverlay: boolean; cumulative: boolean };
  box: { whisker: 'minmax' | 'tukey'; method: QuantileMethod };
  regression: { model: 'none' | 'line' | 'lineX' | 'poly' | 'pow' | 'exp' | 'growth' | 'log' | 'sin' | 'logistic'; degree: number;
                space: 'data' | 'log'; band: null | { level: number; kind: 'mean' | 'prediction' }; showSquares: boolean };
  stats: { show: boolean; sample: boolean };
  predict: { x?: number };
}
```

The panel's job:

- **One variable.** Show the chosen plot beside a statistics table (the `Describe` record) with a switch between population and sample deviations. Class controls change `edges` (auto, number of bins, width and start, or typed edges). Overlay options add the normal curve with the data's mean and sd, the frequency polygon, or the cumulative curve. Frequency data is accepted.
- **Two variables.** A scatter plot, a model selector that runs the matching fit command, a residual plot toggle, the statistics (n, means, standard deviations, `r`, `r²`, Spearman, covariance, `Sxx`, `Sxy`, `Syy`, SSE, equation), and a prediction box: type `x`, read `ŷ` and the residual if `x` is in the data.
- **Several variables.** Stacked box plots on a shared axis, a table of the summary per variable (n, mean, sd, five numbers), and an ANOVA table with F and p.

Every control is an edit of one or more lines: the panel does not hold hidden state. **Apply to figure** emits the lines it implies (`h = Histogram(data)`, `fit = FitLine(data)`) so the teacher or the learner can keep the results and the model can continue from them. `DataLabState` is saved with the figure as a directive line (`@datalab …`) so that opening the figure restores the panel; the plots in the panel are also drawn by the same drawables as figure objects.

Performance: toggling the model re-runs one fit; target under 20 ms for 1,000 points. Class edits recompute a histogram in under 5 ms for 100,000 values.

## 10. Numerical methods

### 10.1 Sums and moments

- Sum, Mean: Neumaier compensation. Variance: two-pass with correction term `Σ(x - m)` (the "corrected two-pass"); a million values near 1e9 with variance 1 stay accurate to 1e-10 relative.
- Skewness, kurtosis: central moments from the same pass using the stable update formulas for third and fourth sums.
- Covariance, correlation: centred two-pass; a result is clamped to [-1, 1] after rounding.
- Median, quartiles, quantiles: one sort per list, shared cache (3.2). For a single call on a list of a million values, quickselect in expected O(n), under 25 ms.
- Mode: after the sort, a run-length scan.
- Weighted: cumulative frequencies; binary search for positions.

### 10.2 Rank and Spearman

Average ranks via sort with index; ties found by exact equality. Spearman is Pearson of the ranks, which is correct with ties.

### 10.3 Tests

Statistic and df from the formulas of the test; p from the distribution's survival function (accurate in the tails, from `probability`). Intervals use the quantile function. Exact definitions are in the unit-test table; each test has a worked example from a standard textbook as a golden test.

### 10.4 Accuracy and speed targets

| Item | Target |
|---|---|
| Mean, variance on 1e6 values | relative error ≤ 1e-13 for conditioning up to 1e6 |
| Correlation | within 2 ulp of the mpmath reference for n ≤ 1e4 |
| `FitLine` and `FitPoly` (degree ≤ 8, well scaled) | coefficient relative error ≤ 1e-10 against references |
| R² | ≤ 1e-12 |
| LM convergence on the standard test set (Exp, Pow, Sin, Logistic, noise 5 %) | ≥ 98 % converge from the automatic start |
| Histogram of 1e6 values | under 15 ms |
| Box plot of 1e6 values | under 40 ms (sort) |
| t-test p-value | within 1e-12 relative |

### 10.5 Limits

Lists up to 1,000,000 values for descriptive commands and charts; fits up to 100,000 points; `FitPoly` degree ≤ 12; `FitImplicit` degree ≤ 6; `ANOVA` up to 50 groups; `ChiSquaredTest` tables up to 30×30; `StemPlot` up to 2,000 values; `DotPlot` up to 5,000 dots drawn (above that the dot plot becomes a histogram suggestion); `PieChart` up to 200 slices; `Table` up to 1,000 rows.

## 11. Plugging into the kernel

- **Command table.** Each command above is a `CommandSpec` in group `statistics`, `charts`, `fits` or `tests`. Named options (`method`, `closed`, `scale`, `weights`, `space`, `tail`, `level`, `pooled`, `whisker`) are named parameters of forms with `optional` and an `enum` marker on text-valued options. The checker validates enums and returns `bad_option` with the allowed values.
- **Records** (`Fit`, `Describe`, test results, `ANOVA`) have fixed schemas in the table.
- **Chart drawables.** Each `Chart` kind has a drawable class; they share a geometry cache, hit-testing by bar or slice, and a text label layer. A chart's `label` option is a Text with `{expr}` allowed.
- **Rule inputs.** A fit reads its data list and options. Because `Fit` records contain a Function built from numbers, the function is rebuilt only when the numbers change.
- **Clock.** Charts are pure functions of their data. A data list that reads `t` makes an animated histogram; the cost is one recomputation per frame (under 15 ms at a million values, so films should use lists under 100,000 values).
- **Randomness.** None here. Simulated data comes from `probability`'s seeded sampling.

## 12. Better than GeoGebra

- One `Describe` record instead of forty commands; weights supported everywhere with no expansion.
- Choice of quantile method as data, shown in the output.
- Histograms choose density when classes are unequal; auto classes are stable and rounded to "nice" widths.
- Fits return a record: coefficients, standard errors, R², adjusted R², residuals, equation text. Failure has a reason.
- Fitting in data space or log space is a visible choice.
- Exact Jacobians for nonlinear fits from our own expression tree.
- Confidence and prediction bands; least-squares squares for teaching.
- Tests return the distribution of the statistic, so the picture is one `Shade` line away.
- The data-analysis panels do not need a spreadsheet and are driven by lines, so the teacher's `draw` can do whatever the panel does.
- Pure and deterministic: same lists, same results, and cached sorting.

## 13. Changes to the core design

1. Add `Table` and `Chart` types (3.1) and the Record/Matrix types from `lists-matrices`.
2. Add enum-valued text options: a text parameter can declare a closed set of allowed values, checked at line time (error kind `bad_option`).
3. Allow named arguments after positional ones for every form (already in the grammar); formalise that unknown names are `unknown_option` with the list of options.
4. A Record may declare `draws: fieldName` so the view draws a field of it.
5. Add the directive `@datalab` (saved panel state) and the rule that the panel only edits lines.
6. Add warnings on `ok` results (shared with lists-matrices).
7. Add undefined reasons: `too_few_values`, `zero_variance`, `has_undefined`, `degenerate_x`, `not_linear_model`, `no_convergence`, `no_dof`, `bad_edges`, `not_discrete`, `negative_value`, `out_of_domain` (already present), `expected_count_low` (warning only).
8. Add a built-in constant or function set for the t, F and chi-squared tails to the formula language: `pnorm`, `qnorm` and similar are provided by `probability`; this area relies on them.

## 14. Open questions

1. Should `StdDev` mean sample or population? We follow the name; some curricula expect sample as default. The summary line prints the divisor ("sd (n)").
2. Should `Histogram` default to counts (the common classroom expectation) even with unequal widths? We choose density and say so; a warning is printed once.
3. Should `FiveNumber` default to `"linear"` quartiles to match spreadsheets? We use `"halves"` for classroom match; the record carries `method`.
4. Do we expose an `Interval` type so intervals can be drawn on a number line? `Shade`/Region can already do it.

## Sources studied

GeoGebra source, read-only, commit 3608374, under `/Users/iteoluwakisibello/.kiro/crew/scratch/runtime-7c51f956/geogebra-src/source/shared/common/src/main/java/org/geogebra/common/`:

- `kernel/statistics/` (descriptive statistics, regression and fit algorithms and command processors, chart algorithms, tests and intervals, frequency and classes, ranking, regression enumeration, regression maths helpers)
- `kernel/algos/` (box plot, bar chart algorithms, list statistics helpers)
- `gui/view/data/` (data analysis model and controller, plot types, statistics table models, regression and inference models, panel settings)
- `main/settings/` (data analysis settings)

GeoGebra manual (read for command lists and behaviour, not copied):

- https://geogebra.github.io/docs/manual/en/commands/Statistics_Commands/
- https://geogebra.github.io/docs/manual/en/commands/Chart_Commands/
- https://geogebra.github.io/docs/manual/en/commands/List_Commands/
- https://geogebra.github.io/docs/manual/en/tools/Spreadsheet_Tools/ (navigation to the data analysis tools)
- https://geogebra.github.io/docs/manual/en/Probability_Calculator/ (the Statistics tab)
