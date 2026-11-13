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

# Probability: design (second round)

## Code

- `language/types.ts`: `registerTypeAlias(name, members)`, so `Distribution` is an alias of `ContinuousDistribution`
  and `DiscreteDistribution`.
- `graph/registry.ts`: `RuleCall.random` (figure seed, owner name, call site and count, re-roll count).
  `graph/core.ts` fills it; `graph/tx.ts` reads `@seed` and re-runs the rules when it changes, and re-runs an object
  whose `reroll` changes.
- `commands/probability/dists.ts`: the table grows to 23 entries, each with `logpdf`, `quantileUpper` where a closed
  form exists, moments with skewness, excess kurtosis, median and modes, `sample` and a heavy-tail flag.
- `commands/probability/random.ts`: the stream, key hashing and the samplers (inverse cdf, Marsaglia–Tsang, BTRS,
  PTRS, alias-free cumulative search).
- `commands/probability/index.ts`: the commands of R5 and R6.
- `apps/studio/src/probcalc.ts`: the calculator panel, which writes ordinary lines.

## Key

`key = mix(seed, fnv(name), site, count, seedArg, reroll)` → two words `(a, b)`, where `mix` is a 32-bit avalanche
mixer (two multiply-xorshift rounds). Sub-stream `i`: `s = mix(a ^ i·φ)`, `t = mix(b + i) ^ s`. Output `m` (from 1):
`hi = mix(s + m·c1)`, `lo = mix(hi ^ t ^ m·c2)`, value `((hi >>> 5) · 2^26 + (lo >>> 6) + 0.5) / 2^53`. Two mixes per
number keep 1e6 normal draws under the 150 ms target.
