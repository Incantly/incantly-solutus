# Statistics and charts: how the model uses them

## 1. Catalogue entries

Four groups, loaded on demand: `stats` (describe, correlate, tables, classes), `charts`, `fits`, `tests`. Load `stats` and `charts` for any data lesson; `fits` when a trend line or curve is wanted; `tests` for significance.

Notation in catalogue lines: `; opt` means an optional named argument at the end of the call (`Q1(xs, method = "linear")`). The printer writes it as `[, opt = ...]`; the shorter `;` form is used here to save space.

**Types of results.** A chart is a `Chart<Kind>` value (`Chart<Histogram>`, `Chart<BoxPlot>`, `Chart<PieChart>` …) and a table a `Table`. Fit, describe and test results are `Record<Schema>` values (`Record<Fit>`, `Record<Describe>`, `Record<Test>`). Read any of them by field name (`h.counts`, `b.q1`, `fit.r2`, `T.rows`); an unknown field is `unknown_field` and lists the real ones. A parameter that wants one kind refuses another: `FrequencyPolygon(b)` with a bar chart is `no_matching_form`. A table's column by its title: `Column(T, "count")`.

### Group `stats` (about 330 tokens)

```text
Describe(list[, freqs][; method]) -> Record{n,mean,median,mode,min,max,q1,q3,iqr,sd,sampleSd,variance,sampleVariance,skewness,kurtosis,...}
Describe(points) -> Record{x,y,r,r2,cov,spearman,n}
Mean/Median/Min/Max/Sum(list[, freqs]) -> Number         Mode(list) -> List<Number>
Q1/Q3/IQR(list[; method]) -> Number                        # method: "halves"(default)|"hinges"|"linear"|"exclusive"|"nearest"
Quantile(list, p[; method]) -> Number                      # default "linear"
FiveNumber(list) -> Record{min,q1,median,q3,max}           Outliers(list[, k]) -> List<Number>
StdDev/Variance(list[, freqs]) -> Number                   # divide by n
SampleStdDev/SampleVariance(list[, freqs]) -> Number       # divide by n-1
MeanAbsDev/MedianAbsDev/Rms/GeometricMean/HarmonicMean/Skewness/Kurtosis(list) -> Number
ZScores/Rank/RankOrdinal(list) -> List<Number>             Rescale(list, lo, hi) -> List<Number>
Correlation/Spearman/Covariance/SampleCovariance(xs, ys | points) -> Number
Sxx/SumSq(list), Sxy/SumProd(xs, ys) -> Number
RSquare/SumSquaredErrors(points, f) -> Number              Residuals(points, f) -> List<Number>
Classes(list[, bins]) -> List<Number>                      ClassesByWidth(list, width[, start]) -> List<Number>
Frequency(edges, list[, "left"|"right"]; scale, cumulative) -> List<Number>
FrequencyTable(edges, list) -> Table                       ContingencyTable(a, b) -> Record{observed,table,...}
Table(titles, col1, col2, ...) -> Table
```

### Group `charts` (about 360 tokens)

```text
Histogram(list[, bins]) / Histogram(edges, list|heights)[; scale, closed] -> Chart
BarChart(heights) / BarChart(labels, heights) / BarChart(xs, heights, width) / BarChart(list, width) -> Chart
BarChart(expr, k, from, to) / BarChart(dist[, from, to]) -> Chart      # dist must be discrete
FrequencyPolygon(edges, list|heights | histogram)[; cumulative] -> Chart
BoxPlot(y, halfHeight, list)[; whisker, method, label] -> Chart       whisker: "minmax"(default)|"tukey"
BoxPlot(y, halfHeight, min, q1, med, q3, max) -> Chart
BoxPlots(lists[, labels]) -> Chart
DotPlot(list[, binWidth]) / StemPlot(list[, scale]) -> Chart
PieChart(values[, labels[, centre, radius]]) -> Chart
LineGraph/StepGraph/StickGraph(points) -> Chart
NormalQuantilePlot(list) -> Chart                           ResidualPlot(points, f) -> Chart
Squares(points, f) -> List<Polygon>                          # area of all = sum of squared errors
BarChart(dist[, from, to]) -> Chart<BarChart>              # probability of each whole number of a discrete distribution
charts are Chart<Kind>: Chart<Histogram>, Chart<BoxPlot>, Chart<PieChart>, Chart<PointsChart>, …
chart fields: h.counts, h.edges, h.total; b.q1, b.median, ...; pie.fractions; nq.r
```

### Group `fits` (about 260 tokens)

```text
FitLine/FitLineX(points) -> Record Fit
FitPoly(points, degree) / FitPow / FitExp / FitGrowth / FitLog / FitSin / FitLogistic(points) -> Record Fit
FitImplicit(points, degree) -> Curve
Fit(points, [f1, f2, ...]) -> Record Fit                   # y = c1 f1 + c2 f2 + ...
FitModel(points, f, start) -> Record Fit                   # f(x, p1..pk), start = [p1..pk]
all fits take (xs, ys) instead of points; options: weights, space ("data"|"log"), from, to (the drawn range)
Fit fields: f, equation, params, names, stderr, r2, adjR2, sse, rmse, n, dof, residuals, model, space, from, to
FitBand(fit[; level, kind]) -> Region   # kind "mean"(default)|"prediction"; line, poly, log and basis fits only
FitImplicit(points, degree) -> Curve    # degree 1..6
CorrTest(points[, tail]) -> Record
```

### Group `tests` (about 330 tokens)

```text
tail: "two" (default) | "left" | "right"
ZTest(sample, mu0, sigma[, tail]) / ZTest(mean, sigma, n, mu0[, tail]) -> Record{statistic,p,estimate,se,n,dist}
TTest(sample, mu0[, tail]) / TTest(mean, sd, n, mu0[, tail]) -> Record{statistic,p,df,...}
ZTest2/TTest2(sample1, sample2[, tail]) ; TTest2 option pooled ; TTestPaired(sample1, sample2[, tail])
ZPropTest(x, n, p0[, tail]) / ZPropTest2(x1, n1, x2, n2[, tail])
ChiSquaredTest(matrix) / ChiSquaredTest(observed, expected[, ddof]) -> Record{statistic,p,df,expected,contributions}
ANOVA(groups) -> Record{F,p,dfBetween,dfWithin,ssBetween,ssWithin,table}
ZInterval/TInterval(sample[, level]) / (mean, sd, n[, level]) -> Record{lo,hi,level,margin,estimate}
ZInterval2/TInterval2/TIntervalPaired(...) ; ZPropInterval(x, n[, level]; method) ; ZPropInterval2(...)
r.dist is the Distribution of the statistic (Normal(0, 1), StudentT(df), ChiSquared(df), FDist(d1, d2)):
Shade(r.dist, r.statistic, inf) draws the right tail; Sf(r.dist, r.statistic) is its probability
```

Together about 1,280 tokens if all four are loaded; typical lessons load two (about 600 to 700).

## 2. What `draw` returns

| Type | Summary |
|---|---|
| `List<Number>` | as in lists-matrices |
| `Record` from `Describe` | `Describe n 12, mean 5.2, median 5, sd(n) 1.9, min 2, max 9, q1 4 (halves), q3 7` |
| `Fit` | `Fit line: y = 1.92 x + 0.41, R² 0.992, n 5, rmse 0.22` |
| `Histogram` | `Histogram 6 classes [0,10) … [50,60], counts 3 7 12 9 4 1, heights are counts` or `, heights are density` |
| `BoxPlot` | `BoxPlot min 2 q1 4 median 5 q3 7 max 9, 1 outlier (14)` |
| test result | `ZTest right-tailed: z 2.1, p 0.0179` / `TTest two-tailed: t -1.43, df 9, p 0.187` |
| interval | `TInterval 95%: [3.2, 6.8], estimate 5, margin 1.8` |
| `Table` | `Table 5 rows × 3 columns (class, count, relative)` |

The teacher reads numbers from the summary; it does not call `figure` just to learn a mean.

## 3. Writing lines: patterns

```text
data = [4, 7, 8, 8, 9, 10, 12, 15, 21]
h = Histogram(data)
b = BoxPlot(-1, 0.5, data)
m = Mean(data)
Readout("mean", m)
```

```text
P = [(1, 2.1), (2, 3.9), (3, 6.2), (4, 7.8), (5, 10.1)]
fit = FitLine(P)
Readout("R²", fit.r2)
resid = ResidualPlot(P, fit.f)
```

```text
r = TTest(sample, 100, "right")
curve = Pdf(r.dist)
area = Shade(r.dist, r.statistic, 1e9)
Readout("p", r.p)
```

Habits (about 70 tokens in the prompt):

- Name the data list first, then build charts from it.
- Say which standard deviation: `StdDev` divides by n, `SampleStdDev` by n-1.
- Fits are Records: read `fit.r2`, `fit.params[1]`; the curve is already drawn.
- Tests take `"two"`, `"left"`, `"right"`.
- `draw` summaries give the numbers: speak from them.

## 4. Fixing errors

| Result | Next step |
|---|---|
| `bad_option` | Use a value from `allowed` |
| `no_matching_form` | Pick the form with the same parameter count; `Mean(P)` needs `Mean(Xs(P))` |
| `bad_argument` "no form has a parameter called …" | A misspelt option name; use the name in `hint` |
| `undefined (too_few_values)` | Add points, or lower the degree |
| `undefined (zero_variance)` | Say the numbers do not vary; show a different relationship |
| `undefined (no_convergence)` | Retry once with `FitModel(P, f, start)` and a guess based on what the plot shows; then move on |
| `undefined (has_undefined)` | Use `RemoveUndefined(xs)` on the list |
| warning `unequal_classes` | Nothing to fix; tell the learner heights are densities |
| warning `overfit` | Say the fit is flexible and lower the degree on the next line |

At most two retries, per core design.

## 5. Live teacher snippets

### 5.1 Spread and the box plot

> "These are the minutes nine students took to finish a puzzle. Let me put them on a line."

```text
times = [4, 7, 8, 8, 9, 10, 12, 15, 21]
d = DotPlot(times)
```

`draw`: `times: List<Number>[9] 4, 7, 8, 8, 9, 10, 12, 15, 21`; `d: DotPlot 9 values`.

> "Most are bunched between 7 and 12, and one is far out at 21. The middle value is..."

```text
med = Median(times)
Readout("median", med)
```

`draw`: `med: Number 9`.

> "Nine. Now the box plot, with the outlier shown properly."

```text
b = BoxPlot(-1, 0.6, times, whisker = "tukey")
```

`draw`: `b: BoxPlot min 4 q1 7.5 median 9 q3 13.5 max 21, 1 outlier (21)`.

> "The box holds the middle half; the dot at 21 is an outlier because it is more than one and a half box-lengths past the box."

### 5.2 A trend line with its quality

> "Here are five measurements: hours studied against score."

```text
P = [(1, 52), (2, 61), (3, 64), (4, 75), (5, 79)]
fit = FitLine(P)
```

`draw`: `Fit line: y = 6.9 x + 46.1, R² 0.971, n 5, rmse 2.3`.

> "A line with slope about seven: each extra hour goes with about seven more points. The fit explains 97 percent of the variation."

```text
Readout("R²", fit.r2)
sq = Squares(P, fit.f)
```

> "These squares show the error at each point. The best line makes their total area as small as possible."

### 5.3 Recovering from an error

> "Let's see if a cubic fits these four points even better."

```text
q = FitPoly(P, 3)
```

Say `P` has only three distinct x values: `draw` returns `q: undefined (too_few_values): FitPoly degree 3 needs 4 distinct x values, got 3`.

> "A cubic needs four different x values, and we only have three. A quadratic is the most we can do here."

```text
q = FitPoly(P, 2)
```

`draw`: `Fit poly2: y = -0.5 x² + 4.1 x + 1.2, R² 1.000, n 3, dof 0`, warning `overfit`.

> "It passes through all three points exactly. That tells us nothing about the pattern: with only three points a quadratic can always do that."

(One typing slip, for contrast: `t = TTest(xs, 5, "greater")` returns `bad_option` with `allowed: ["two","left","right"]`; the next call uses `"right"`.)

### 5.4 Significance

> "Is the average of this class above 100?"

```text
r = TTest(scores, 100, "right")
```

`draw`: `TTest right-tailed: t 2.31, df 11, p 0.0206`.

> "A p-value of about 2 percent. If the true average were 100, a sample this high would happen about two times in a hundred. Here is that region."

```text
curve = Pdf(r.dist)
tail = Shade(r.dist, r.statistic, inf)
```

## 6. Token budget

| Item | Tokens |
|---|---|
| `stats` | about 330 |
| `charts` | about 360 |
| `fits` | about 260 |
| `tests` | about 330 |
| Habits + grammar notes (named options `name = value`) | about 100 |
| Typical `draw` result for three lines | 150 to 250 |

All four groups together: about 1,380 tokens. The loader is expected to load at most two at a time for ordinary lessons.
