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
