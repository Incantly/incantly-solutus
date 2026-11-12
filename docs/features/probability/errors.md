# Probability: errors

Format: section 9 of the core design. Static errors stop the line; runtime problems give undefined with a reason code. Shared kinds (`bad_option`, `bad_argument`, `unknown_option`, warnings) are defined in `lists-matrices/errors.md` and `statistics/errors.md`.

## 1. How the reference app handles failures here

- Distribution commands with a wrong parameter (negative standard deviation, probability above 1, non-whole `n`) give undefined with no explanation, or in some cases an "illegal argument" message that does not say which parameter.
- A probability outside [0, 1] given to an inverse command gives undefined.
- A random command in a file loses its numbers when the file is reloaded or the construction updates, with no warning.
- In the calculator view: an invalid parameter in a text box reverts or leaves the old curve with no message; a lower bound above the upper bound is silently swapped or ignored; a discrete distribution with a very large parameter can freeze the table.
- Quantile for discrete distributions returns a value without saying that the probability reached differs from the one asked.

## 2. Static errors

| Kind | When | Fields and notes |
|---|---|---|
| `no_matching_form` | `Prob(Normal(0,1), 1)` (missing second bound); `Shade(d, 1)` | forms listed |
| `bad_argument` | Every constructor parameter is a literal and one violates its domain: `Normal(0, -1)`, `Binomial(10, 1.5)`, `Binomial(2.5, 0.5)`, `Triangular(0, 3, 2)`, `Quantile(d, 1.2)`, `Sample(d, -3)`, `RandomInt(5, 1)` | `param`, `got`, `allowed` (for example "sigma > 0"), plus the closest legal example in `hint` |
| `bad_option` | `Prob(d, 1, 2, "<>")`, `Quantile(d, 0.9, "up")` | `allowed`: `["[]","[)","(]","()"]`; `["left","right"]` |
| `type_mismatch` | `BarChart(Normal(0,1))` (continuous in a discrete-only form), `Mean(Normal)` (a constructor name used without a call), `Pdf(5, 1)` | `expected`, `got` |
| `unknown_command` | `RandomNormal`, `InverseNormal`, `NormalPdf`, `Pascal`, `BinomialDist` | `hint` gives the replacement: `Sample(Normal(mu, sigma), n)`, `Quantile(Normal(mu, sigma), p)`, `Pdf(Normal(mu, sigma), x)`, `NegBinomial(r, p)`, `Binomial(n, p)` |
| `unknown_option` | `Sample(d, 10, sed = 3)` | `expected`: `["seed"]` |
| `type_change` | redefining a `ContinuousDistribution` object as a `DiscreteDistribution` | the checker says why: bars and curves differ; delete first |
| `cycle` | `xs = Sample(Normal(Mean(xs), 1), 5)` | |
| `limit` | `Sample(d, 5000000)` literal | `limit` 1,000,000; `PdfTable` over 100,000 rows |
| `bad_directive` | `@seed abc`, `@seed -1.5` | `expected`: a whole number from 0 to 4,294,967,295 |

## 3. Runtime undefined reasons

| Reason | Where | Detail example | The reference app | Recovery |
|---|---|---|---|---|
| `bad_parameter` | any constructor whose parameters come from objects | "sigma is -0.3; Normal needs sigma > 0" | undefined, silent | Change the slider range so it cannot cross 0; the detail names the offending input |
| `out_of_range` | `Quantile` with `q` outside [0, 1]; `CentralInterval` with mass outside (0, 1); `MinTrials` | "q = 1.2 must be between 0 and 1" | undefined | |
| `undefined_moment` | `Mean`, `Variance`, `Skewness`, `Kurtosis` | "Cauchy has no mean"; "StudentT with df 1.5 has infinite variance" | undefined | Use `Median`, or a different distribution |
| `not_accurate` | extreme parameters where our algorithms cannot reach 1e-6 relative | "Gamma shape 3e9 is outside the accurate range" | wrong digits | Reduce the parameter; use `NormalApprox` |
| `no_convergence` | `Quantile` (bracket failure) | "no bracket for q = 1e-320" | undefined | Use `tail = "right"` for tiny tail probabilities |
| `sample_too_large` | `Sample(list, n, false)` with `n > length` | "asked 12, list has 10" | undefined | Use `replace = true` or smaller `n` |
| `empty_list` | `RandomElement([])`, `Sample([], n)` | | undefined | |
| `bad_weights` | `Discrete(values, probs)`: negative, all zero, length mismatch (runtime form) | "probability 3 is -0.1" | undefined | |
| `not_discrete` | `BarChart(d)` with a runtime-continuous distribution | | n/a | |
| `not_finite` | overflow in `Pdf` of extreme parameters | | | |
| `too_large` | `PdfTable` or table view range beyond limits at run time | "range 0..5e6 exceeds 100,000 rows" | freeze | Narrow the range |
| `zero_probability` | `MinTrials` with `p = 0` and `k > 0` | "can never reach k successes" | | |

## 4. Warnings

| Warning | When | Fields |
|---|---|---|
| `probs_normalised` | `Discrete(values, probs)` sums to 1 ± 1e-6 but not 1e-9; probabilities were rescaled | `sum` |
| `probs_not_normalised` | sum off by more than 1e-6: rescaled, loudly | `sum` |
| `rounding_discrete_quantile` | `Quantile` of a discrete distribution; the cumulative probability reached differs from `q` by more than 1e-9 | `reached` |
| `heavy_tail_plot` | a plot range for heavy tails uses 98 % | |
| `seed_ignored` | `seed =` given where the command is not random | |
| `random_in_film` | a random object that reads `t` but has no explicit seed; its numbers are still deterministic, the warning is informational | |

## 5. Example error objects

Parameter out of domain, known at check time:

```json
{
  "ok": false,
  "line": 2,
  "col": 13,
  "endCol": 15,
  "kind": "bad_argument",
  "token": "-1",
  "message": "Normal needs sigma > 0; got -1.",
  "param": "sigma",
  "got": -1,
  "allowed": "sigma > 0",
  "forms": ["Normal(mu: Number, sigma: Number) -> ContinuousDistribution"],
  "hint": "Write Normal(0, 1) for the standard normal."
}
```

A renamed command:

```json
{
  "ok": false,
  "line": 4,
  "col": 5,
  "endCol": 17,
  "kind": "unknown_command",
  "token": "RandomNormal",
  "message": "RandomNormal is not a command here.",
  "expected": [],
  "forms": ["Sample(d: Distribution, n: Number) -> List<Number>"],
  "hint": "Use Sample(Normal(mu, sigma), n). For one value use Draw(Normal(mu, sigma))."
}
```

A wrong interval notation:

```json
{
  "ok": false,
  "line": 3,
  "col": 22,
  "endCol": 26,
  "kind": "bad_option",
  "token": "\"<>\"",
  "message": "ends must be one of \"[]\", \"[)\", \"(]\", \"()\".",
  "param": "ends",
  "got": "<>",
  "allowed": ["[]", "[)", "(]", "()"],
  "forms": ["Prob(d: Distribution, a: Number, b: Number, ends?: Text) -> Number"],
  "hint": "Square bracket includes the end; round bracket leaves it out. \"[)\" means a ≤ X < b."
}
```

An undefined moment:

```json
{
  "ok": true,
  "name": "m",
  "type": "Number",
  "summary": "undefined (undefined_moment): Cauchy has no mean",
  "undefined": { "reason": "undefined_moment", "detail": "Cauchy has no mean", "inputs": ["d"], "hint": "Use Median(d) or a different distribution." }
}
```

A discrete quantile with a warning:

```json
{
  "ok": true,
  "name": "k",
  "type": "Number",
  "summary": "7",
  "warnings": [
    { "kind": "rounding_discrete_quantile",
      "message": "Binomial is discrete: P(X ≤ 7) = 0.9453, the smallest value reaching at least 0.9.",
      "reached": 0.9453125 }
  ]
}
```

## 6. Calculator view errors

The view shows the same reason and detail text beside the field. Examples:

- Parameter field `σ` set to `0`: field turns red, text "σ must be greater than 0"; curve stays at the last valid distribution; the Enter key keeps the old value.
- Probability field `1.3`: "a probability is between 0 and 1".
- Lower bound above upper bound while dragging: the view swaps them and flashes both markers once (no message needed). Typing `lo = 5`, `hi = 2` in the boxes swaps on commit with a one-line note "bounds swapped".
- A table range too large: "showing the first 100,000 rows".

## 7. Better than the reference app

- The parameter that is wrong is named, with its allowed range and an example.
- Renamed or removed commands (`RandomNormal`, `InverseNormal`) answer with the replacement.
- Undefined moments explain themselves.
- Discrete quantile says what probability it really reached.
- Interval notation errors list the four allowed forms.
- Randomness is never lost silently: it is deterministic, and the only change is an explicit re-roll.
