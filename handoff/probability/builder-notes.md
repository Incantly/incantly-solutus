# Probability: builder notes (second round)

Built on `feat/probability` from `.kiro/specs/probability` (R3 to R8).

## What is in

- 23 distributions (`commands/probability/dists.ts`), each with density, log density, cdf, survival, quantile (upper-tail
  quantile where the spec has one), moments with skewness, kurtosis, median and modes, and a sampler.
- Commands: `LogPdf`, `Skewness`, `Kurtosis`, `Median`, `Mode`, `Support`, `PlotRange`, `NormalApprox`, `MinTrials`,
  `ShadeTails`, `PdfTable`, `Shade` of a discrete distribution, `Discrete(values, probs)`; `Draw`, `Sample` (of a
  distribution or a list), `RandomInt`, `RandomReal`, `RandomElement`, `RandomPolynomial`, the action `Reroll`.
- Kernel hooks: `registerTypeAlias`, named-only parameters, `RuleCall.random`, `@seed` (checked), `with reroll = k`.
- Studio: the Probability panel (`apps/studio/src/probcalc.ts`) with both tabs, drag markers, the normal overlay with
  continuity correction, the table, typing a probability to move a bound, the seed and reroll, and adding a sample.
  The painter draws shaded bars, tails, mass functions as stems and step cdfs.

## Speed (bench/probability.bench.ts, this machine)

| Case | Result | Target |
|---|---|---|
| 1e6 normal draws | 77 ms | 150 ms |
| 1e6 gamma draws | 103 ms | 250 ms |
| 1e6 Binomial(100, 0.3) | 131 ms | 200 ms |
| 2,000 density points | 0.02 ms | 0.5 ms |
| gamma cdf | < 1 µs | 2 µs |
| gamma quantile | 6 µs | 50 µs |
| PdfTable, 10,000 rows | 0.4 ms | 15 ms |

## Third round (15 November 2026): the items left from round two

- **Large parameters.** The incomplete gamma (shape ≥ 100) and the incomplete beta (both shapes ≥ 3,000) are now
  integrated by Gauss–Legendre quadrature near the peak, with the prefactor reduced by Stirling's series. `lbeta` and
  `gammaLogDensity` replace every difference of large log-gammas (binomial, negative binomial, Poisson and t masses,
  the F and beta densities). `betaI` takes `1 − x` exactly when the caller knows it, so `Binomial(1e12, 1e-11)` keeps
  its digits. Measured: `Cdf(Gamma(1e8, 1), 1e8)` was 0.040, now 0.5000133 (right); `Cdf(Beta(1e8, 1e8), 0.5)` is
  0.5 to 1e-14; the quadrature agrees with the series to 2e-12 where the series converges.
- **`not_accurate`.** A shape or count parameter above 1e15 makes every evaluation undefined `not_accurate`
  (`ACCURATE_MAX`, `accuracyProblem`). Closed-form moments, `Support` and `NormalApprox` stay defined, so the recovery
  in errors.md works. The errors.md example moved from 3e9 (now accurate) to 3e15.
- **Renamed commands.** The language has a new hook, `registerCommandRename` in `language/check.ts`. Probability
  registers `RandomNormal`, `InverseNormal`, `NormalPdf`, `Pascal`, `BinomialDist` and their family (`RandomPoisson`,
  `InverseT`, `ChiSquaredCdf`, …): the `unknown_command` error carries the replacement in `hint` and its `forms`.
- **Quantiles.** HyperGeometric walks from the mode by the mass recurrence (a tiny upper tail still bisects on the
  survival function); Zipf binary-searches its cumulative table.
- **Kolmogorov–Smirnov.** `test/spec/probability/leftovers.test.ts` runs a KS test on all 27 samplers (n = 20,000,
  false-alarm rate 1e-6).
- **Simulation strip** (`apps/studio/src/simstrip.ts`): under the graph when a random object exists, or from the
  panel's "Simulation strip" button. Seed, Reroll, one slider per free `Sample(…, n)` count, Run with 0.02 to 1 s per
  draw, the tally against the distribution with the largest bar gap or the Kolmogorov distance, a 300 ms pulse on the
  newest draw, die faces under 12 rolls, and the Simulate menu (coin, die, two dice, spinner).

## Not done

- Run uses a timer, not the clock: ui.md 6 asks for a `t`-driven run so a film seeks exactly. That needs `n` written
  as a clock formula, which would make it stop being a free slider; left for the animation area.
- Reroll always adds one to the figure seed: the studio has no selection yet, so "reroll only the selected object"
  waits for selection linking.
