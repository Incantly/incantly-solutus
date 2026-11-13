# Statistics and charts: requirements

Area: `docs/features/statistics/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Cross-area decisions:
`docs/features/README.md`. Branch: `feat/statistics`. Uses the `List`, `Matrix` and `Record` types of
`lists-matrices`.

### R1. Describing one list

**User story:** As a learner, I want the middle, the spread and the shape of a list in one line, so that I can see what
the numbers say.

**Acceptance criteria:**

1. THE SYSTEM SHALL provide the commands of design 4 for one list: `Mean`, `Median`, `Mode`, `DataRange`, `Q1`, `Q3`,
   `IQR`, `Quantile`, `FiveNumber`, `Outliers`, `Variance`, `StdDev`, `SampleVariance`, `SampleStdDev`, `MeanAbsDev`,
   `MedianAbsDev`, `Rms`, `GeometricMean`, `HarmonicMean`, `Skewness`, `Kurtosis`, `Sxx`, `SumSq`, `ZScores`, `Rank`,
   `RankOrdinal`, `Rescale` and `Describe`, and the frequency forms of `Count`, `Sum`, `Mean`, `Median`, `Mode`,
   `Variance`, `StdDev`, `Q1`, `Q3`, `Quantile` and `Describe` (design 3.2).
2. `Variance` and `StdDev` SHALL divide by n; `SampleVariance` and `SampleStdDev` SHALL divide by n − 1 and need 2
   values (`too_few_values`).
3. THE SYSTEM SHALL offer the quantile methods `"halves"`, `"hinges"`, `"linear"`, `"exclusive"` and `"nearest"`
   (design 3.3); the quartile family defaults to `"halves"`, `Quantile` to `"linear"`. A literal outside the set is
   `bad_option` with the allowed values.
4. Frequencies SHALL be non-negative whole numbers (`bad_weights`), and the data SHALL never be expanded.
5. Sums SHALL be compensated and the variance computed in two passes with a correction term (design 10.1).
6. A list with an undefined element SHALL give undefined `has_undefined`; an empty list `empty_list`.

### R2. Two lists

**User story:** As a learner, I want to see whether two quantities move together.

**Acceptance criteria:**

1. THE SYSTEM SHALL provide `Covariance`, `SampleCovariance`, `Correlation`, `Spearman`, `Sxy`, `Syy`, `SumProd`,
   `RSquare`, `SumSquaredErrors`, `Residuals` and `Describe(points)`, each taking two lists or a list of points
   (design 4).
2. Unequal lengths SHALL be undefined `size_mismatch`; a constant list SHALL make `Correlation` and `Spearman`
   undefined `zero_variance`. The correlation SHALL be clamped to [−1, 1].

### R3. Frequency, classes and tables

**Acceptance criteria:**

1. THE SYSTEM SHALL provide `Classes`, `ClassesByWidth`, `Frequency`, `FrequencyTable`, `ContingencyTable` and
   `Table` (design 5), with the automatic class rule of design 5.
2. Edges that are not strictly increasing SHALL be undefined `bad_edges`.

### R4. Charts

**User story:** As a teacher, I want a histogram, a box plot or a pie chart from one line, with the numbers behind it.

**Acceptance criteria:**

1. THE SYSTEM SHALL provide the chart commands of design 6, each returning a value with the fields of design 6.
2. A histogram over unequal classes SHALL default to density heights and warn `unequal_classes`.
3. `PieChart` of a negative value SHALL be undefined `negative_value`; a chart of no data SHALL be defined with
   `n = 0`.

### R5. Fits

**User story:** As a learner, I want the line or curve that fits my points, with its R² and a reason when it fails.

**Acceptance criteria:**

1. THE SYSTEM SHALL provide `FitLine`, `FitLineX`, `FitPoly`, `FitPow`, `FitExp`, `FitGrowth`, `FitLog`, `FitSin`,
   `FitLogistic`, `Fit`, `FitModel` and `CorrTest` (design 7.2), each taking a list of points or two lists.
2. Every fit SHALL return the `Fit` record of design 7.1.
3. Nonlinear fits SHALL use Levenberg–Marquardt as in design 7.3, in data space by default and in log space with
   `space = "log"`, with the reasons `too_few_values`, `degenerate_x`, `singular_fit`, `no_convergence` and `no_dof`.
4. `FitPoly` SHALL take a degree from 0 to 12; another literal is `bad_argument` at check time.

### R6. Tests and intervals

**User story:** As a learner, I want a test result with named fields, so that I never look up which number is the
p-value.

**Acceptance criteria:**

1. THE SYSTEM SHALL provide the tests and intervals of design 8, with data and summary-number forms, returning records
   with the fields of design 8.1.
2. Tails SHALL be `"two"`, `"left"` or `"right"`, with the aliases `"!="`, `"<"` and `">"`; another literal is
   `bad_option`.
3. p-values SHALL come from the normal, Student t, chi-squared and F distributions, accurate to 1e-12 relative in the
   middle of the range; Welch degrees of freedom SHALL use the Satterthwaite formula.
4. THE SYSTEM SHALL warn `expected_count_low` and `normal_approx_weak` (errors 4).

### R7. Errors

**Acceptance criteria:** THE SYSTEM SHALL register the undefined reasons and warnings of `errors.md` that R1 to R6 use.

## Decided against the design

- **Charts and tables are records.** The language's schema types are records only, so a chart is a
  `Record<Histogram>`, `Record<BoxPlot>` and so on, and a table a `Record<Table>`. Field access, type checks and
  `unknown_field` then come for free. The view draws a record whose schema is a chart schema.
- **`dist` on test and interval records** is not built: the `Distribution` type belongs to `probability`, which is not
  built yet. The distribution functions this area needs live in `statistics/dist.ts` for `probability` to reuse.
- **`unknown_option`** is not added: the language already refuses a named argument no form has, as `bad_argument` with
  the closest name.
- **`Rank`** shares its name with the matrix rank of `lists-matrices`; the forms differ by type (`List<Number>` gives
  ranks, `Matrix` the rank).
- **`FitModel`'s Jacobian** uses central differences: a function value carries no expression tree to differentiate.
