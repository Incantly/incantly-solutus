# Probability: design (first round)

## Code

- `packages/kernel/src/commands/probability/dists.ts`: the distribution table, one entry per distribution (design 3.2),
  on top of the special functions in `commands/statistics/dist.ts` (log-gamma, incomplete gamma and beta, the normal
  quantile).
- `packages/kernel/src/commands/probability/index.ts`: constructors, evaluation commands, fields, summaries,
  `registerProbability(registry)`.

## Decisions

- See "Decided against the design" in `requirements.md`.
- Discrete quantiles search the cdf by bisection with a 1e-12 allowance for rounding, so `Quantile(Binomial(10, 0.5),
  0.5)` is 5.
