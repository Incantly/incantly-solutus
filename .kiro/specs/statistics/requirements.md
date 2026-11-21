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

### R8. Speed

**Acceptance criteria:** THE SYSTEM SHALL meet the targets of design 7.3, 9 and 10.4 (histogram of 1e6 values under
15 ms, box plot of 1e6 under 40 ms, a median of 1e6 under 25 ms, Levenberg–Marquardt on 1,000 points and 4 parameters
under 5 ms and on 10,000 under 40 ms, a refit of 1,000 points under 20 ms), checked by `packages/kernel/bench/`.

### R9. The data-analysis panel and the studio

**User story:** As a teacher, I want to explore a list in a panel and keep what I find as lines.

**Acceptance criteria:**

1. THE SYSTEM SHALL offer the one-variable, two-variable and several-variable panels of design 9 and ui.md 4, each
   showing a plot, its controls and the statistics, computed from the lines the panel would write.
2. **Add to figure** SHALL apply those lines with an `@datalab` directive; opening the figure SHALL restore the panel.
3. Charts, fits, bands, distributions and regions SHALL draw on the studio's graph with the looks of ui.md 2.2; tests
   and intervals SHALL show a result card (ui.md 5).

## Decided against the design

- **Charts and tables are `Chart<Kind>` and `Table`**, through a generic language hook (`registerSchemaType`): a type
  name that carries a record schema. Their values are record values, so field access and `unknown_field` work as for
  `Record`. (The first round used plain records; the product owner asked for real types.)
- **The `Distribution` type** comes from a first probability round built with this area (`.kiro/specs/probability/`),
  so tests and intervals carry `dist` and `BarChart(d)` works.
- **`F(d1, d2)` is `FDist(d1, d2)`**: a command name is reserved for objects, and `F` is a common point name.
- **`unknown_option`** is not added: the language already refuses a named argument no form has, as `bad_argument` with
  the closest name.
- **`Rank`** shares its name with the matrix rank of `lists-matrices`; the forms differ by type (`List<Number>` gives
  ranks, `Matrix` the rank).
- **`FitModel`'s Jacobian** uses central differences: a function value carries no expression tree to differentiate.
