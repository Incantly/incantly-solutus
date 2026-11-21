# Probability: requirements (first round)

Area: `docs/features/probability/` (`design.md`, `errors.md`, `agent.md`, `ui.md`). Branch: `feat/statistics` for this
round, which statistics needs; the rest of the area follows on `feat/probability`.

### R1. The Distribution type

**User story:** As a learner, I want a distribution as one value, so that its density, cdf and quantiles hang off it.

**Acceptance criteria:**

1. THE SYSTEM SHALL add a `Distribution` type whose values carry their spec and parameters (design 3.1, 3.2).
2. THE SYSTEM SHALL provide the constructors `Normal`, `StudentT`, `ChiSquared`, `FDist`, `Exponential`, `Uniform`,
   `Binomial`, `Poisson`, `Bernoulli` and `Geometric` with the parameter rules of design 3.3. Literal parameters that
   break a rule are `bad_argument` at check time; parameters from objects give undefined `bad_parameter`.
3. Fields `mean`, `variance`, `sd`, `name`, `discrete`, `params`.

### R2. Evaluate and show

**Acceptance criteria:**

1. THE SYSTEM SHALL provide `Pdf(d, x)`, `Pdf(d)`, `Cdf(d, x)`, `Cdf(d)`, `Cdf(d, a, b)`, `Sf(d, x)`, `Prob(d, a, b[, ends])`,
   `Quantile(d, q[, tail])`, `Mean(d)`, `Variance(d)`, `StdDev(d)`, `Shade(d, a, b)` and `CentralInterval(d, mass)`
   (design 4.1, 4.3), matching the table of design 4.4.
2. A moment that does not exist SHALL be undefined `undefined_moment`; `Shade` of a discrete distribution SHALL be
   undefined `not_continuous`.

## Left for the probability round

Sampling and seeds, the rest of the distributions of design 3.3, `LogPdf`, `MinTrials`, `ShadeTails`, `PdfTable`,
`NormalApprox`, the `ContinuousDistribution` and `DiscreteDistribution` subtypes, and the calculator view.

## Decided against the design

- **`F(d1, d2)` is `FDist(d1, d2)`**: command names are reserved for objects, and `F` is a common name for a point.
- **One `Distribution` type** for this round; whether a distribution is discrete is checked when the rule runs.

# Probability: requirements (second round)

Branch: `feat/probability`, cut from `integration`.

### R3. Two distribution types

**User story:** As a learner, I want `Shade` of a coin-toss distribution to give bars and of a normal to give an area,
so that one command fits both.

**Acceptance criteria:**

1. THE SYSTEM SHALL have the types `ContinuousDistribution` and `DiscreteDistribution`; `Distribution` in a parameter
   accepts either (design 3.1, 10.1). Each constructor returns the specific type.
2. `BarChart(d)` SHALL accept only a `DiscreteDistribution`; a continuous one is the static `type_mismatch`.

### R4. The rest of the distributions

**Acceptance criteria:**

1. THE SYSTEM SHALL add `Gamma`, `Erlang`, `Beta`, `Cauchy`, `Weibull`, `LogNormal`, `Logistic`, `Triangular`,
   `NegBinomial`, `HyperGeometric`, `Zipf`, `DiscreteUniform` and `Discrete(values, probs)` with the parameter rules of
   design 3.3.
2. `Discrete` with probabilities that sum within 1e-6 of 1 (but not 1e-9) SHALL rescale them with the notice
   `probs_normalised`; further off, rescale with `probs_not_normalised`; negative, all zero or unequal lengths SHALL be
   undefined `bad_weights`.

### R5. Describe and show

**Acceptance criteria:**

1. THE SYSTEM SHALL provide `LogPdf`, `Skewness`, `Kurtosis` (plain, 3 for a normal), `Median`, `Mode`, `Support`, `PlotRange`,
   `NormalApprox`, `MinTrials`, `ShadeTails` and `PdfTable` (design 4.1 to 4.3).
2. `Shade(dd, a, b[, ends])` SHALL give a `Chart<ShadedBars>` whose `mass` is the probability; `Shade(cd, a, b)` stays a
   Region.
3. `Quantile(d, q, "right")` SHALL be computed from the survival function where the distribution can, so tiny upper
   tails are precise. A discrete quantile whose cdf misses `q` by more than 1e-9 SHALL add the notice
   `rounding_discrete_quantile` with the probability reached.
4. `PlotRange` of a heavy-tailed distribution SHALL use the central 98 % and add `heavy_tail_plot`.

### R6. Seeded randomness

**User story:** As a teacher, I want random samples that are the same on every replay and that grow without changing,
so that a slider on `n` shows the law of large numbers.

**Acceptance criteria:**

1. THE SYSTEM SHALL provide `Draw`, `Sample(d, n)`, `Sample(list, n[, replace])`, `RandomInt`, `RandomReal`,
   `RandomElement`, `RandomPolynomial`, `Shuffle` and the action `Reroll` (design 6.3). Each random command SHALL accept
   `seed =`.
2. Values SHALL be a pure function of the figure seed (`@seed N`, default 1), the object's name, the call's position in
   its line, the `seed` argument and the object's re-roll count (`with reroll = k`). Reloading a script SHALL give the
   same numbers.
3. Samples SHALL be prefix-stable: draw `i` uses its own sub-stream.
4. `Sample(list, n, false)` with `n` above the length SHALL be undefined `sample_too_large`; an empty list `empty_list`.
5. A literal `n` above 1,000,000 SHALL be the static `limit`; `@seed` that is not a whole number from 0 to 4,294,967,295
   SHALL be `bad_directive`.

### R7. Speed

1. 1e6 normal draws under 150 ms, 1e6 gamma under 250 ms, 1e6 Binomial(100, 0.3) under 200 ms; `PdfTable` of 10,000 rows
   under 15 ms; 2,000 batch density points under 0.5 ms (design 5.2, 6.4).

### R8. The probability calculator (studio)

1. THE studio SHALL have a Probability panel: a distribution picker grouped as continuous and discrete with the default
   parameters of design 7.3, the four modes, bounds, the result, the cumulative toggle, the normal overlay with the
   continuity-corrected approximation, and a table for discrete distributions.
2. The panel SHALL be made of figure lines (design 7.1): **Add to figure** writes them into the expression list.
3. A seed field and a **Reroll** button SHALL set `@seed`.

## Decided against the design (second round)

- **`rand(seed)` is unchanged.** It already gives a fixed number per seed; tying it to the figure seed would change the
  numbers of saved figures.
- **The generator** is a counter-based hash: two 32-bit avalanche mixers per output, 53 bits, never 0 or 1. The design
  names the SplitMix64 finaliser; ours avoids 64-bit arithmetic and is version `v1` of the file format.
- **`Kurtosis(d)` is the plain kurtosis** (3 for a normal), the same convention as `Kurtosis(list)` in statistics, so
  a sample's kurtosis and its distribution's can be compared directly.
- **`Shuffle` stays in lists**, where it already takes an optional seed; it is not tied to the figure seed.
- **The call position** is the column of the command in its line, plus how many times that call has run while the line
  is computed, so `Seq(Draw(d), k, 1, 5)` gives five different draws.
