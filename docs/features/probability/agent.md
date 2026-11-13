# Probability: how the model uses it

## 1. Catalogue entries

Two groups: `dist` (distributions and evaluation) and `random` (simulation). Load `dist` when the lesson uses a bell curve, a binomial, a tail area or a p-value; load `random` for simulation, dice, coins, sampling.

### Group `dist` (about 520 tokens)

```text
Normal(mu, sigma) / StudentT(df) / ChiSquared(df) / F(d1, d2) -> ContinuousDistribution
Exponential(rate) / Gamma(shape, rate) / Erlang(k, rate) / Beta(a, b) -> ContinuousDistribution
Cauchy(median, scale) / Weibull(shape, scale) / LogNormal(mu, sigma) / Logistic(mu, scale) -> ContinuousDistribution
Triangular(min, mode, max) / Uniform(min, max) -> ContinuousDistribution
Binomial(n, p) / Bernoulli(p) / Geometric(p) / NegBinomial(r, p) / Poisson(mean) -> DiscreteDistribution
HyperGeometric(N, K, n) / Zipf(s, N) / DiscreteUniform(lo, hi) / Discrete(values, probs) -> DiscreteDistribution
Pdf(d, x) -> Number                     # density, or mass for discrete
Pdf(d) / Cdf(d) -> Function             # curve to draw
Cdf(d, x) -> Number                      # P(X <= x)
Sf(d, x) -> Number                       # P(X > x)
Prob(d, a, b[, ends]) -> Number          # ends "[]" (default) "[)" "(]" "()"; a, b may be -inf, inf
Quantile(d, q[, "left"|"right"]) -> Number
CentralInterval(d, mass) -> Record{lo, hi}
Mean/Variance/StdDev/Skewness/Kurtosis/Median(d) -> Number     Mode(d) -> List<Number>
Support(d) / PlotRange(d) -> Record{lo, hi[, ymax]}
Shade(d, a, b[, ends]) -> Region (continuous) | Chart (discrete)      # .mass = probability
ShadeTails(d, lo, hi) -> Region | Chart
PdfTable(d, from, to[, step]) -> Table
BarChart(d[, from, to]) -> Chart         # discrete only
NormalApprox(d) -> ContinuousDistribution
MinTrials(p, k, confidence) -> Number
```

### Group `random` (about 230 tokens)

```text
Draw(d[, seed = s]) -> Number
Sample(d, n[, seed = s]) -> List<Number>
Sample(list, n[, replace][, seed = s]) -> List
RandomInt(lo, hi[, n][, seed = s]) -> Number | List<Number>       # both ends included
RandomReal(lo, hi[, n][, seed = s]) -> Number | List<Number>
RandomElement(list[, seed = s]) / Shuffle(list[, seed = s]) -> element | List
RandomPolynomial(degree, lo, hi[, seed = s]) -> Function
Reroll(obj, ...)                         # action: new random numbers for these objects
@seed N                                  # figure seed (default 1)
Notes: randomness is fixed by the script; changing n keeps earlier values; renaming an object changes its numbers.
```

The two groups together are about 750 tokens. `inf` is a constant (add 5 tokens to the grammar note).

## 2. What `draw` returns

| Type | Summary |
|---|---|
| Distribution | `Normal(μ = 0, σ = 1): mean 0, sd 1` / `Binomial(n = 10, p = 0.5): mean 5, sd 1.58` |
| `Pdf(d)` function | `Function: density of Normal(0,1), peak 0.399 at 0` |
| `Shade` | `Region: P(-1 ≤ X ≤ 1) = 0.6827` / `Chart: P(3 ≤ X ≤ 7) = 0.8906, 5 bars highlighted` |
| `Prob`, `Cdf`, `Quantile` | the number, e.g. `0.6827`; for discrete `Quantile`: `7 (reaches 0.9453)` |
| `Sample` | `List<Number>[50] 0.12, -1.31, 0.77, … (mean 0.04, sd 1.02)` |
| `PdfTable` | `Table 11 rows × 4 columns (k, P(X=k), P(X≤k), P(X≥k))` |

The teacher uses `.mass` and the `Prob` summary for the sentence, not an extra call.

## 3. Writing lines: patterns

```text
d = Normal(100, 15)
curve = Pdf(d)
a = Shade(d, 85, 115)
Readout("P(85 ≤ X ≤ 115)", Prob(d, 85, 115))
```

```text
d = Binomial(10, 0.5)
bars = BarChart(d)
s = Shade(d, 3, 7)
p = Prob(d, 3, 7)
```

```text
n = 20 in 1..500 step 1
flips = Sample(Bernoulli(0.5), n)
heads = Mean(flips)
Readout("share of heads", heads)
```

Habits (about 70 tokens):

- Build a distribution first, then ask it things; do not look for `InverseNormal`.
- `Prob(d, a, b)` is closed at both ends by default; add `"[)"` etc. for strict inequalities on discrete distributions.
- Use `inf` and `-inf` for tails.
- Random numbers are fixed by the script. To show different numbers say `Reroll(name)` or use a seed slider; do not expect them to change on their own.
- Use a slider for `n` to show more draws; earlier draws stay.

## 4. Fixing errors

| Result | Next step |
|---|---|
| `unknown_command` (`RandomNormal` etc.) | Use the replacement named in `hint` |
| `bad_argument` on a constructor | Change the named parameter within `allowed` |
| `bad_option` on `ends` / `tail` | Use a value in `allowed` |
| `undefined (bad_parameter)` | Say the slider has gone out of range; fix the slider range; do not retry the same line |
| `undefined (undefined_moment)` | Use `Median`; explain the heavy tail |
| `type_mismatch` on `BarChart(Normal…)` | Use `Pdf(d)` and `Shade` |
| warning `rounding_discrete_quantile` | Speak the reached probability from the warning |

## 5. Live teacher snippets

### 5.1 The bell curve and a tail area

> "Test scores are often bell-shaped. Let's say they average 100 with a spread of 15."

```text
d = Normal(100, 15)
curve = Pdf(d)
@view 40 160 -0.005 0.03
```

`draw`: `d: Normal(μ = 100, σ = 15): mean 100, sd 15`; `curve: Function: density of Normal(100,15), peak 0.0266 at 100`.

> "About two thirds of people are within one spread of the average. Here is that region."

```text
a = Shade(d, 85, 115)
p = Prob(d, 85, 115)
```

`draw`: `a: Region: P(85 ≤ X ≤ 115) = 0.6827`; `p: Number 0.6827`.

> "Sixty-eight percent. Who scores above 130?"

```text
t = Shade(d, 130, inf)
q = Sf(d, 130)
```

`draw`: `q: Number 0.02275`.

> "Only about two people in a hundred."

### 5.2 Coins and the law of large numbers

> "Flip a fair coin and track the share of heads."

```text
n = 10 in 1..1000 step 1
flips = Sample(Bernoulli(0.5), n)
share = Mean(flips)
Readout("heads so far", share)
```

`draw`: `flips: List<Number>[10] 1, 0, 0, 1, 1, 0, 1, 1, 0, 0 (mean 0.5)`; `share: Number 0.5`.

> "With ten flips it could be anything. Watch it settle as the number of flips grows."

(The teacher calls `show_me` to move `n` to 50, then 300. The first ten flips never change. `share` reads 0.46, then 0.51.)

> "With more flips the share stays close to one half."

### 5.3 Recovering from an error

> "How likely are exactly four heads in ten flips?"

```text
b = Binomial(10, 1.5)
```

`draw` returns:

```json
{
  "ok": false, "line": 1, "col": 17, "endCol": 20,
  "kind": "bad_argument", "token": "1.5",
  "message": "Binomial needs 0 ≤ p ≤ 1; got 1.5.",
  "param": "p", "got": 1.5, "allowed": "0 ≤ p ≤ 1",
  "forms": ["Binomial(n: Number, p: Number) -> DiscreteDistribution"],
  "hint": "Use p = 0.5 for a fair coin."
}
```

> "A probability can't be above one. A fair coin is one half."

```text
b = Binomial(10, 0.5)
bars = BarChart(b)
k4 = Shade(b, 4, 4)
```

`draw`: `k4: Chart: P(4 ≤ X ≤ 4) = 0.2051, 1 bar highlighted`.

> "About twenty percent: not the most likely count, five is, but close to it."

### 5.4 The p-value as an area

> "Is a result of 62 heads in 100 flips surprising for a fair coin? Under a fair coin the count is roughly bell-shaped around 50."

```text
d = Binomial(100, 0.5)
bars = BarChart(d, 30, 70)
tail = Shade(d, 62, inf)
p = Prob(d, 62, inf)
```

`draw`: `tail: Chart: P(62 ≤ X ≤ inf) = 0.0105, 39 bars highlighted`.

> "About one percent of the time. That's rare, though not impossible."

## 6. Token budget

| Item | Tokens |
|---|---|
| `dist` | about 520 |
| `random` | about 230 |
| Habits and grammar notes (`inf`, `@seed`, `seed =`) | about 80 |
| Typical `draw` result for three lines | 120 to 220 |

Together at most 830 when both are loaded.

## 7. As built (second round)

- **Two types.** Constructors return `ContinuousDistribution` or `DiscreteDistribution`; `Distribution` in a signature
  accepts both. `Shade(d, a, b)` is a `Region` for a continuous `d` and a `Chart<ShadedBars>` for a discrete one (with
  `ends`); both have `.mass`, the probability. `BarChart(d)` takes only a discrete distribution.
- **`F(d1, d2)` is `FDist(d1, d2)`**: `F` is a common point name.
- **`seed =` is named only.** `RandomInt(1, 6, 10)` is ten numbers; `RandomInt(1, 6, seed = 3)` is one.
- **Same script, same numbers.** Random values come from `@seed`, the object's name, where the call sits in its line and
  `with reroll = k`. Renaming an object changes its numbers. `Reroll(xs)` adds one to the count; on a free number used as
  a seed it adds one to the number.
- **`Kurtosis(d)` is the plain kurtosis** (3 for a normal), like `Kurtosis(list)`.
- **`Shuffle(list, seed)`** stays the lists command: its seed is the second argument, not the figure seed.
- Notices: `probs_normalised` P101, `probs_not_normalised` P102, `rounding_discrete_quantile` P103, `heavy_tail_plot` P104.
