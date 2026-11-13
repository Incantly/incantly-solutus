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

## Not done

- `not_accurate`: the reason is registered but no rule reports it yet; the special functions are not checked against a
  per-parameter accuracy range.
- The Kolmogorov–Smirnov check of every sampler (design 6.2) is replaced by mean, variance and chi-squared tests.
- Hypergeometric and Zipf quantiles bisect on the summed cdf rather than walking from the mode.
- The random strip at the bottom of the figure (ui.md 6) lives in the Probability panel's Simulate row instead.
- Unknown-command hints for `RandomNormal`, `InverseNormal` and the like (errors 2) need a kernel hook for renamed
  commands, which does not exist yet.
