# Probability: design

Status: draft for review. Fits `docs/design/formula-language-and-kernel.md` (the "core design"). Uses `List`, `Matrix` and `Record` from `docs/features/lists-matrices/design.md`. Feeds `docs/features/statistics/design.md` (tests read distribution functions from here). This area covers probability distributions (every one, with density, cumulative and inverse), random numbers and seeding, simulation, shading and the Probability Calculator view.

## 1. What this area does

A learner wants to see how likely things are: the bell curve, the shaded area that is "the probability of being between 60 and 80", the bars of a binomial and where 7 successes sit among them. A teacher wants to throw a hundred dice and watch the bars settle toward one sixth, then drag a slider and see the same hundred throws grow to a thousand without reshuffling. A statistics lesson wants the p-value as an area under a curve.

### Sub-features

| Group | Commands |
|---|---|
| Distributions (constructors) | continuous: `Normal`, `StudentT`, `ChiSquared`, `F`, `Exponential`, `Gamma`, `Erlang`, `Beta`, `Cauchy`, `Weibull`, `LogNormal`, `Logistic`, `Triangular`, `Uniform`. discrete: `Binomial`, `Bernoulli`, `Geometric`, `NegBinomial`, `Poisson`, `HyperGeometric`, `Zipf`, `DiscreteUniform`, `Discrete` (custom values and probabilities) |
| Evaluate | `Pdf`, `LogPdf`, `Cdf`, `Sf`, `Prob`, `Quantile`, `CentralInterval`, `MinTrials` |
| Describe | `Mean`, `Variance`, `StdDev`, `Skewness`, `Kurtosis`, `Median`, `Mode`, `Support`, `PlotRange` |
| Show | `Shade`, `ShadeTails`, `PdfTable`, `NormalApprox`, bar charts of discrete distributions (`BarChart(d)` in statistics) |
| Random | `Draw`, `Sample` (from a distribution or a list), `RandomInt`, `RandomReal`, `RandomElement`, `RandomPolynomial`, `Shuffle`, `Reroll`, the `@seed` directive and the `seed =` argument |
| Probability Calculator view | Distribution tab (type, parameters, probability mode, markers, table, cumulative toggle, normal overlay) and Statistics tab (tests and intervals, from the statistics area) |

Command coverage mapped to ours:

- Every distribution's density, cumulative and inverse command in the manual (about 45 commands: for each distribution a "density or cumulative" command plus an "inverse" command) are `Pdf`, `Cdf`, `Quantile` applied to a constructor. Example: `Quantile(Normal(100, 15), 0.9)`.
- The binomial "list of all probabilities" forms are `PdfTable(Binomial(n, p), 0, n)` or `BarChart(Binomial(n, p))`.
- The inverse binomial "minimum number of trials" is `MinTrials`.
- The random-number commands (between, uniform, normal, binomial, Poisson, discrete, element, polynomial, shuffle, sample) are `RandomInt`, `RandomReal`, `Sample`, `Draw`, `RandomElement`, `RandomPolynomial`, `Shuffle`. `RandomNormal(mu, sigma, n)` is `Sample(Normal(mu, sigma), n)`; we keep no alias per distribution.
- Random points in a region (`RandomPointIn`) belong to geometry; it uses this area's seeded streams (section 6.5).
- Chi-squared test and the other tests in the Probability group of the manual are in `statistics`.

## 2. How the reference app does it (summary)

- **Distributions are commands, not values.** A distribution command takes the parameters and a point, plus a Boolean saying "density or cumulative", and returns a number or a function; a second command (named "Inverse…") gives the quantile. Each distribution therefore has up to four commands, and the manual lists them separately. Discrete ones have extra forms returning a list of all values.
- **Maths come from a numerical library** (Apache Commons Math style distribution classes), with a few special cases (Zipf, Erlang, Triangular, Pascal counted differently from the textbook). Accuracy in the far tails and non-integer parameters follows the library.
- **Random numbers use one global generator** owned by the kernel. They re-evaluate when the construction is updated (a menu command or key) and there is no seed the user can set. A file cannot reproduce its randomness. Many random commands exist, each with its own definition of the "between" or "count" argument.
- **The Probability Calculator is a separate view** of about 2,400 lines plus a 1,000-line manager. It supports 16 distributions with a different parameter count each, switches on the distribution type in at least four places (parameters, formulas, labels, quantiles), and shows the density or cumulative curve, a probability mode (interval, left, right, two-tailed), editable lower and upper bounds with draggable markers, a result box, a table of values for discrete distributions, a normal-curve overlay and an export. The Statistics tab handles tests and intervals.
- **Discrete distributions use cached tables** of probabilities and a separate class per distribution type.
- **Weak spots**: the view duplicates what the commands know (adding a distribution means editing many switches); no seeds; "inverse" for discrete distributions needs care with which end of the step is returned; no way to ask for a tail probability without losing precision at the far end; the view's picture cannot be dragged into the figure as live objects (it can be exported as an image or copied as a static plot).

## 3. Our design: the Distribution type

### 3.1 Value and spec

```ts
type DistKind =
  | 'Normal' | 'StudentT' | 'ChiSquared' | 'F' | 'Exponential' | 'Gamma' | 'Erlang' | 'Beta'
  | 'Cauchy' | 'Weibull' | 'LogNormal' | 'Logistic' | 'Triangular' | 'Uniform'
  | 'Binomial' | 'Bernoulli' | 'Geometric' | 'NegBinomial' | 'Poisson' | 'HyperGeometric'
  | 'Zipf' | 'DiscreteUniform' | 'Discrete';

interface DistributionValue {
  readonly spec: DistSpec;                    // static entry from the table (section 3.2)
  readonly params: readonly number[];         // positional, in the spec's order
  readonly extra?: { values: Float64Array; probs: Float64Array };   // only for 'Discrete'
  readonly valid: boolean;                    // parameters satisfy the domain
}
```

The type system has three Distribution types: `Distribution` (any), `ContinuousDistribution` and `DiscreteDistribution`; the constructors return the specific ones, which lets the checker pick the right form of `Shade` and `BarChart` statically.

### 3.2 One table, one spec per distribution

Everything about a distribution lives in one entry. Adding a distribution means adding one entry and its test vectors; no other file changes.

```ts
interface DistSpec {
  readonly kind: DistKind;
  readonly discrete: boolean;
  readonly params: readonly { name: string; domain: Domain; whole?: boolean }[];
  readonly support: (p: readonly number[]) => { lo: number; hi: number };          // lo/hi may be ±Infinity
  readonly pdf: (p: readonly number[], x: number) => number;                       // mass for discrete
  readonly logpdf: (p: readonly number[], x: number) => number;
  readonly cdf: (p: readonly number[], x: number) => number;                       // P(X <= x)
  readonly sf: (p: readonly number[], x: number) => number;                        // P(X > x), accurate in the upper tail
  readonly quantile: (p: readonly number[], q: number, upper?: boolean) => number; // smallest x with cdf(x) >= q for discrete
  readonly moments: (p: readonly number[]) => { mean?: number; variance?: number; skewness?: number; kurtosis?: number;
                                                 median?: number; mode?: readonly number[] };   // absent = undefined moment
  readonly sample: (p: readonly number[], rng: Stream) => number;                  // section 6
  readonly plotRange: (p: readonly number[]) => { lo: number; hi: number; ymax: number };
  readonly summary: (p: readonly number[]) => string;                              // "Normal(μ = 0, σ = 1)"
}
```

The command table produces its forms from specs: `Normal(mu: Number, sigma: Number) -> ContinuousDistribution`.

### 3.3 The distributions

Parameters are named; constraints are checked as in `errors.md`. "Whole" parameters accept only whole numbers.

| Constructor | Parameters | Support | Notes |
|---|---|---|---|
| `Normal(mu, sigma)` | `sigma > 0` | ℝ | |
| `StudentT(df)` | `df > 0` (real) | ℝ | mean undefined for `df ≤ 1`; variance infinite for `1 < df ≤ 2` |
| `ChiSquared(df)` | `df > 0` (real) | `[0, ∞)` | |
| `F(d1, d2)` | `d1 > 0`, `d2 > 0` | `[0, ∞)` | |
| `Exponential(rate)` | `rate > 0` | `[0, ∞)` | mean `1/rate` |
| `Gamma(shape, rate)` | both `> 0` | `[0, ∞)` | rate form, not scale |
| `Erlang(k, rate)` | `k` whole `≥ 1`, `rate > 0` | `[0, ∞)` | same as `Gamma(k, rate)`, kept for the textbook name |
| `Beta(a, b)` | both `> 0` | `[0, 1]` | |
| `Cauchy(median, scale)` | `scale > 0` | ℝ | no mean or variance |
| `Weibull(shape, scale)` | both `> 0` | `[0, ∞)` | |
| `LogNormal(mu, sigma)` | `sigma > 0`; parameters are those of the logarithm | `(0, ∞)` | |
| `Logistic(mu, scale)` | `scale > 0` | ℝ | |
| `Triangular(min, mode, max)` | `min < max`, `min ≤ mode ≤ max` | `[min, max]` | |
| `Uniform(min, max)` | `min < max` | `[min, max]` | |
| `Binomial(n, p)` | `n` whole `≥ 0`, `0 ≤ p ≤ 1` | `0..n` | |
| `Bernoulli(p)` | `0 ≤ p ≤ 1` | `{0, 1}` | |
| `Geometric(p)` | `0 < p ≤ 1` | `0, 1, 2, …` | number of failures before the first success |
| `NegBinomial(r, p)` | `r > 0` (whole for a plain count), `0 < p ≤ 1` | `0, 1, 2, …` | failures before the r-th success |
| `Poisson(mean)` | `mean ≥ 0` | `0, 1, 2, …` | |
| `HyperGeometric(N, K, n)` | whole, `0 ≤ K ≤ N`, `0 ≤ n ≤ N` | `max(0, n - (N - K)) .. min(n, K)` | N population, K successes in it, n draws |
| `Zipf(s, N)` | `s ≥ 0`, `N` whole `≥ 1` | `1..N` | |
| `DiscreteUniform(lo, hi)` | whole, `lo ≤ hi` | `lo..hi` | |
| `Discrete(values, probs)` | equal-length `List<Number>`; probs `≥ 0` and sum within 1e-9 of 1 (else normalised and a warning is given) | the values | any finite set of numbers |

Parameterisation is chosen once and written in the signature; there is no "scale or rate" ambiguity. (`Gamma` and `Exponential` use a rate; `Weibull`, `Cauchy` and `Logistic` use a scale.) `NegBinomial` counts failures, and the summary text says so.

## 4. Commands

`d` is a Distribution of either kind; `cd` continuous; `dd` discrete.

### 4.1 Evaluate

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `Pdf` | `(d, x)` | Number | density (continuous) or probability mass (discrete; zero off the support, and for non-whole x) |
| | `(d)` | Function | the density as a function of x; for discrete the function is defined only at whole numbers (undefined elsewhere) and carries a "lattice" flag so the view draws bars or stems |
| `LogPdf` | `(d, x)` | Number | log of the above, accurate where `Pdf` underflows |
| `Cdf` | `(d, x)` | Number | `P(X ≤ x)` |
| | `(d)` | Function | right-continuous steps for discrete |
| | `(d, a, b)` | Number | `P(a ≤ X ≤ b)` (shortcut for `Prob`) |
| `Sf` | `(d, x)` | Number | `P(X > x)`, accurate in the upper tail |
| `Prob` | `(d, a, b)`, `(d, a, b, ends)` | Number | probability of the interval; `ends` is a text `"[]"` (default), `"[)"`, `"(]"` or `"()"` showing which ends are included. Bounds may be `-inf` and `inf`. For continuous distributions the ends make no difference. |
| `Quantile` | `(d, q)`, `(d, q, tail)` | Number | `q` in `[0, 1]`. Default `tail = "left"`: the smallest `x` with `Cdf(d, x) ≥ q` (the true inverse for continuous). `tail = "right"`: the smallest `x` with `Sf(d, x) ≤ q`, which is precise for tiny `q`. For `q = 0`/`1` the ends of the support (possibly `-inf`/`inf`). |
| | `(list, q)` | Number | the sample quantile (in `statistics`) |
| `CentralInterval` | `(d, mass)` | Record `{ lo, hi }` | the interval with equal tails, e.g. `mass = 0.95` gives the 2.5 % and 97.5 % points |
| `MinTrials` | `(p, k, confidence)` | Number | smallest whole `n` such that `P(Binomial(n, p) ≥ k) ≥ confidence`; bisection on the monotone cdf; undefined if `p = 0` |

### 4.2 Describe

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `Mean`, `Variance`, `StdDev`, `Skewness`, `Kurtosis`, `Median` | `(d)` | Number | from the spec; undefined (`undefined_moment`) where the moment does not exist |
| `Mode` | `(d)` | `List<Number>` | one value, or all values when tied |
| `Support` | `(d)` | Record `{ lo, hi, discrete }` | |
| `PlotRange` | `(d)` | Record `{ lo, hi, ymax }` | a sensible window: central 99.9 % for light tails; for heavy tails (Cauchy, StudentT with df < 3) the central 98 % so the picture is not flat; for discrete, whole bounds around `mean ± 4 sd` clipped to the support |
| `NormalApprox` | `(d)` | `ContinuousDistribution` | `Normal(Mean(d), StdDev(d))` |

### 4.3 Show

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `Shade` | `(cd, a, b)` | Region | area under the density from `a` to `b` (bounds may be infinite; the region is clipped to the view) |
| | `(dd, a, b)`, `(dd, a, b, ends)` | Chart | bars of `dd` in the interval highlighted, rest drawn pale. Field `.mass` is the probability. |
| `ShadeTails` | `(d, lo, hi)` | Region or Chart | left of `lo` and right of `hi`; for discrete `X < lo` and `X > hi` unless `ends` says otherwise |
| `PdfTable` | `(dd, from, to)` | Table | columns `k`, `P(X = k)`, `P(X ≤ k)`, `P(X ≥ k)`; also on continuous distributions with a `step` argument (`(cd, from, to, step)`) |

A Region's `.mass` field is the probability; so `p = Shade(d, a, b).mass` gives the number and the picture in one line, though `Prob` is the direct way.

### 4.4 Known values (for unit tests and for the doc reader)

| Expression | Value |
|---|---|
| `Cdf(Normal(0, 1), 1.96)` | 0.9750021048517795 |
| `Quantile(Normal(0, 1), 0.975)` | 1.959963984540054 |
| `Quantile(StudentT(10), 0.975)` | 2.228138851986274 |
| `Quantile(ChiSquared(1), 0.95)` | 3.841458820694124 |
| `Quantile(F(5, 10), 0.95)` | 3.325834530413012 |
| `Cdf(Binomial(10, 0.5), 5)` | 0.623046875 |
| `Pdf(Poisson(3), 2)` | 0.22404180765538775 |
| `Cdf(Exponential(2), 1)` | 0.8646647167633873 |

(Reference values from a high-precision library; the golden test file is generated at build time and checked against several independent implementations.)

## 5. Numerical methods

### 5.1 Special functions (our own implementation, standard algorithms)

| Function | Method | Accuracy target |
|---|---|---|
| `erf`, `erfc` | rational Chebyshev approximations in three ranges; `erfc` relative accuracy in the far tail | 1e-15 relative |
| Normal quantile | Wichura's algorithm AS 241 (PPND16), one Halley step | 1e-16 |
| `lgamma` | Lanczos for `x < 20`; Stirling series with correction terms above; reflection for `x < 0.5` | 1e-15 relative |
| Regularised incomplete gamma `P(a, x)`, `Q(a, x)` | series for `x < a + 1`, Lentz continued fraction otherwise; large `a` uses a uniform asymptotic expansion (Temme) | 1e-13 for `a ≤ 1e6` |
| Regularised incomplete beta `I_x(a, b)` | continued fraction (Lentz) with the symmetry `I_x(a, b) = 1 - I_{1-x}(b, a)` when `x > (a + 1)/(a + b + 2)`; prefactor via `lgamma` or the saddle-point series for large parameters | 1e-13 for `a, b ≤ 1e6` |
| Binomial and Poisson pmf | Loader's saddle-point formula (Stirling-error and deviance terms) | 1e-15 relative |
| Hypergeometric pmf | log-binomials via `lgamma`; cdf by summing outward from the mode using the pmf ratio until terms fall below `1e-18` of the running sum | 1e-13 |
| Zipf normaliser | direct sum for `N ≤ 1e6`, Euler–Maclaurin above | 1e-14 |

### 5.2 Distribution functions in terms of those

| Distribution | cdf | Quantile |
|---|---|---|
| Normal | `erfc` | closed (AS 241) |
| Student t | incomplete beta; for `df > 1e8` normal | start from Cornish–Fisher, safeguarded Newton/Halley, bracket kept |
| Chi-squared, Gamma, Erlang | incomplete gamma | start from Wilson–Hilferty; safeguarded Newton |
| F, Beta | incomplete beta | start from the normal-based approximation (Abramowitz–Stegun 26.5.22 for F); safeguarded Newton |
| Exponential, Weibull, Logistic, Cauchy, Triangular, Uniform, LogNormal | closed forms | closed forms (LogNormal via Normal) |
| Binomial | incomplete beta `I_{1-p}(n-k, k+1)` | start from Cornish–Fisher; walk along the pmf ratio to the exact smallest `k` |
| Poisson | `Q(k + 1, mean)` | same walk |
| NegBinomial, Geometric | incomplete beta / closed geometric | same walk (closed for Geometric) |
| Hypergeometric | summed pmf (above) | same walk |
| Zipf, DiscreteUniform, Discrete | cumulative table + binary search | binary search |

**Safeguarded Newton**: keep a bracket `[lo, hi]` on the quantile (from the support and from successive evaluations); take a Newton step with the density; if it leaves the bracket or reduces the bracket by less than half in two steps, bisect; stop when `|Δx| ≤ 4 eps |x|` or the bracket is tight. Typical 3 to 6 evaluations.

**Discrete quantile** is the smallest integer `k` with `cdf(k) ≥ q`, found by the walk from the starting point; the cdf is evaluated once, then moved by the pmf recurrence. The cost is O(√variance) in the worst case, with the start point within a few steps of the answer. A comparison uses a relative slack of 4 eps so that `Quantile(Binomial(10, 0.5), 0.623046875)` is 5, not 6.

**Tails**: every `cdf` and `sf` pair is computed so that the small side is computed directly (the incomplete-gamma and incomplete-beta routines return both `P` and `Q`). `Prob(d, a, b)` for far-apart bounds on the same side uses a difference of survival values, not of cdfs.

**Accuracy and speed targets:**

| Item | Target |
|---|---|
| `cdf`, `sf`, `pdf` relative error | ≤ 1e-12 for parameters in a practical range (shape, df up to 1e6; n up to 1e9), ≤ 1e-9 outside it, never silently below 1e-6 (then undefined `not_accurate`) |
| Quantile round trip | `|cdf(quantile(q)) - q| ≤ 1e-12 max(q, 1 - q)` for continuous; exact smallest `k` for discrete |
| Evaluation time | normal pdf/cdf < 100 ns; gamma/beta cdf typical < 2 µs, worst < 30 µs; quantile < 50 µs |
| Plotting `Pdf(d)` | batch evaluation of 2,000 points in < 0.5 ms (Function carries a batch evaluator) |
| `PdfTable` of 10,000 rows | < 15 ms |

### 5.3 Moments and summaries

Closed forms from the spec. Undefined moments are `undefined_moment` with an explanation (`Cauchy has no mean`). `Mode` for continuous distributions is the argmax (closed form where it exists, numeric golden-section on a bracket otherwise).

## 6. Random numbers and seeding

### 6.1 Principles

1. **Pure.** A random object is a pure function of its inputs and its seed. The same script gives the same numbers on every machine and every replay.
2. **Prefix-stable.** The `i`th value of a sample does not depend on how many values were asked for. Raising `n` from 100 to 200 keeps the first 100 and adds 100 more. A learner sliding `n` sees the existing points stay put.
3. **Independent streams.** Two different random objects get different streams without the author doing anything.
4. **Explicit re-roll.** Nothing changes on its own. A re-roll is an action or a changed seed.

### 6.2 The generator

```ts
interface Stream { next(): number; }          // next() returns a float64 in (0, 1), 53 bits, never 0 or 1
function streamFor(key: Key128, index: number): Stream;   // an independent sub-stream per draw index
```

- A **key** is four 32-bit words derived from: the figure's seed (`@seed`, default 1), a hash of the object's name, the call's position in the defining line, the call's own `seed =` argument (default 0), and the object's re-roll count (default 0).
- A stream is a counter-based generator: output `m` of stream `(key, index)` is a 64-bit mixing function (the SplitMix64 finaliser written on two 32-bit halves with `Math.imul`) applied to `(key, index, m)`. The 53-bit result `(hi >>> 5) * 2^26 + (lo >>> 6)` is offset by half a unit and scaled so it lies strictly between 0 and 1.
- **Draw `i` of a sample uses sub-stream `(key, i)`** and may consume any number of values from it (a rejection sampler may use two or six). That is what makes samples prefix-stable even for samplers that reject.
- The algorithm and a table of golden outputs are part of the file format version. Changing the generator would change every figure that uses randomness, so a version tag (`@seed 42 v1`) is saved in the script, and old versions stay available.
- Quality tests in the build: chi-square uniformity over 10^7 draws, serial correlation, a Kolmogorov–Smirnov test of every sampler against its own cdf, and golden vectors for seeds 1, 2, 3 for every distribution.

### 6.3 Commands

| Command | Forms | Returns | Notes |
|---|---|---|---|
| `Draw` | `(d)` | Number | one random value; `seed =` as for all random commands |
| `Sample` | `(d, n)` | `List<Number>` | `n` independent draws |
| | `(list, n)`, `(list, n, replace)` | list | draws from a list; `replace` Bool, default true; without replacement `n` ≤ length (undefined `sample_too_large` otherwise); partial shuffle where step `i` uses sub-stream `i`, so prefixes are stable |
| `RandomInt` | `(lo, hi)`, `(lo, hi, n)` | Number or list | whole numbers, both ends included |
| `RandomReal` | `(lo, hi)`, `(lo, hi, n)` | Number or list | uniform in `[lo, hi)` |
| `RandomElement` | `(list)` | element | |
| `RandomPolynomial` | `(degree, lo, hi)` | Function | whole-number coefficients in `[lo, hi]`; leading coefficient non-zero |
| `Shuffle` | `(list)` | list | uniform permutation (Fisher–Yates with a sub-stream per step) |
| `Reroll` | `(obj, …)` | action | adds 1 to each object's re-roll count (stored in the object's style properties and saved in the script as `with reroll = k`) |

Every random command accepts the named argument `seed = <Number>`. The seed is an ordinary number: `s = 7 in 0..999 step 1` and `xs = Sample(Normal(0, 1), 50, seed = s)` makes a slider that re-rolls. `Reroll(s)` on a slider-seed steps it by 1.

The directive `@seed 42` sets the figure's seed. `@seed` is saved in the script. Opening a film restores the same numbers; a teacher may type `@seed 7` to try a different universe.

Interpreting the pieces of the key, given only names and positions: renaming an object changes its numbers. This is deliberate and documented (the script is the file; names are identity). Redefinition under the same name keeps them.

### 6.4 Samplers

| Distribution | Sampler | Uniforms used per draw |
|---|---|---|
| Normal | inverse cdf | 1 |
| Uniform, Exponential, Weibull, Logistic, Cauchy, LogNormal, Triangular | inverse cdf | 1 |
| Gamma, Erlang, ChiSquared | Marsaglia–Tsang squeeze (shape < 1 by boosting) | about 2.3 |
| Beta | two gammas | about 4.6 |
| StudentT | normal over square root of chi-squared | about 3.3 |
| F | ratio of chi-squared | about 4.6 |
| Binomial | inversion by the pmf recurrence from zero when `n min(p, 1-p) < 14`; transformed rejection with squeeze (BTRS) otherwise | 1 to 3 |
| Poisson | multiplication method when `mean < 10`; transformed rejection (PTRS) otherwise | 1 to 3 |
| Geometric, NegBinomial | closed form (geometric); sum of geometrics or Gamma–Poisson mixture | 1 to `r` |
| HyperGeometric | inversion by pmf recurrence from the mode | 1 |
| Zipf, DiscreteUniform, Discrete | cumulative table and binary search, or alias table for lists above 64 values and more than 1,000 draws | 1 |

Speed: 1e6 normal draws under 150 ms; 1e6 gamma under 250 ms; 1e6 binomial(100, 0.3) under 200 ms.

### 6.5 Random points in a region

`RandomPointIn(shape, n)` (declared in geometry) uses rejection from the bounding box with sub-stream per output, or a direct formula for circles, polygons (triangulate and pick by area) and segments. It is seeded like every random command.

### 6.6 Animation of randomness

A slider `n` or the clock `t` can drive `Sample(d, n)`. Because of prefix stability, `Sample(Discrete([1..6], Repeat(1/6, 6)), floor(t * 5))` shows one new die throw every 0.2 s without changing earlier throws, and seeking back and forth replays exactly. This is the main teaching use: law of large numbers, central limit theorem, bootstrapping.

## 7. The Probability Calculator view

### 7.1 It is a figure, not a separate engine

The view is a panel over a small set of ordinary objects. Each control edits a line; the view draws with the same drawables as the main figure. Anything the learner sets up can be copied into the main figure and the teacher can build the same scene with `draw`.

The generated lines for a normal distribution in interval mode:

```text
d = Normal(0, 1)
lo = -1 in -6..6 step 0.01
hi = 1 in -6..6 step 0.01
curve = Pdf(d)
area = Shade(d, lo, hi)
p = Prob(d, lo, hi)
```

For a discrete distribution (binomial):

```text
d = Binomial(10, 0.5)
lo = 3 in 0..10 step 1
hi = 7 in 0..10 step 1
bars = BarChart(d)
area = Shade(d, lo, hi)
p = Prob(d, lo, hi)
```

### 7.2 State

```ts
interface ProbCalcState {
  tab: 'distribution' | 'statistics';
  dist: { kind: DistKind; params: number[]; extra?: { values: number[]; probs: number[] } };
  mode: 'interval' | 'left' | 'right' | 'two-tailed';
  low: number;               // used by interval, right, two-tailed
  high: number;              // used by interval, left, two-tailed
  curve: 'pdf' | 'cdf';
  normalOverlay: boolean;
  table: { open: boolean; from: number; to: number };       // discrete: row range
  view: { lo: number; hi: number; ymax: number };           // from PlotRange, user can zoom
  resultEditable: boolean;                                    // left/right modes: typing a probability moves the marker
}
```

The mapping from mode to lines:

| Mode | Probability | Shade |
|---|---|---|
| `interval` | `P(low ≤ X ≤ high)`: `Prob(d, low, high)` | `Shade(d, low, high)` |
| `left` | `P(X ≤ high)`: `Cdf(d, high)` | `Shade(d, -inf, high)` |
| `right` | `P(X ≥ low)`: `Prob(d, low, inf)` (for continuous `Sf(d, low)`) | `Shade(d, low, inf)` |
| `two-tailed` | `P(X ≤ low) + P(X ≥ high)` | `ShadeTails(d, low, high)` |

Switching mode keeps the bounds that still make sense: moving from interval to left keeps `high`; from left to right moves `low` to the old `high`. Two-tailed requires `low ≤ high`; the view swaps them when a drag crosses.

**Probability entry.** In left, right and two-tailed modes the result box is an input. Typing a probability `q` sets the bound with `Quantile` (`high = Quantile(d, q)` for left; `low = Quantile(d, q, "right")` for right; symmetric tails around the median of a symmetric distribution, otherwise equal tail halves for two-tailed). The marker moves to it. For a discrete distribution the achieved probability (a step value) replaces the typed one, with a note: `asked 0.90, nearest above is 0.9453 at k = 6`.

**Bound handling for discrete.** Bounds snap to whole numbers. `P(X ≥ 4)` uses closed ends; a toggle chooses open or closed ends on each side (`[` / `(` buttons) because `P(X < 4)` and `P(X ≤ 4)` differ.

**Normal overlay.** `NormalApprox(d)` is drawn as a curve on top of the bars or density. The result box shows the exact probability and the normal approximation (with continuity correction for discrete), and their difference.

**Table of values** (discrete): `PdfTable(d, from, to)` in a scroll area; the rows inside the shaded interval are highlighted. The default range is the central 99.9 %.

**Cumulative toggle.** Switches the curve to `Cdf(d)`; markers then show `(low, F(low))` and `(high, F(high))` and the interval's probability as the vertical gap.

### 7.3 Parameters

Each distribution brings its own parameter fields from `DistSpec.params` (name, domain, whole-number rule). Defaults on choosing a distribution:

| Distribution | Defaults |
|---|---|
| Normal | μ 0, σ 1 |
| StudentT | df 5 |
| ChiSquared | df 3 |
| F | 5, 10 |
| Exponential | rate 1 |
| Gamma | shape 3, rate 1 |
| Beta | 2, 5 |
| Cauchy | 0, 1 |
| Weibull | 2, 1 |
| LogNormal | 0, 0.5 |
| Logistic | 0, 1 |
| Triangular | 0, 1, 2 |
| Uniform | 0, 1 |
| Binomial | 10, 0.5 |
| Geometric | 0.3 |
| NegBinomial | 3, 0.5 |
| Poisson | 4 |
| HyperGeometric | 50, 20, 10 |
| Zipf | 1, 10 |
| Erlang | 3, 1 |
| Bernoulli | 0.5 |
| DiscreteUniform | 1, 6 |

Parameter fields accept numbers and formulas (so a figure slider can drive them). Invalid values show a red field and the reason; the curve stays at the last valid distribution.

### 7.4 Statistics tab

The tab runs the tests and intervals from `statistics/design.md` section 8: mean (z, t; one sample, two samples, paired), proportion (one, two), chi-squared (goodness of fit and independence), ANOVA, and the matching intervals. Inputs can be typed summary numbers or chosen lists/matrices from the figure. The result shows the `Record`; the distribution `dist` of the statistic is drawn with the p-value region shaded (section 7.1 machinery, same `Shade`). The card layout is in `ui.md`.

### 7.5 Export

- "Add to figure" writes the lines of section 7.1 into the main figure (the objects then belong to the figure).
- "Copy as image" exports SVG/PNG of the plot.
- "Copy as lines" copies the script.

## 8. How it plugs into the kernel

- **Command table.** `group: 'distributions' | 'probability' | 'random'`. Constructors are `object` commands returning the Distribution types; `Pdf(d)` and `Cdf(d)` return `Function` values with attached batch evaluators and flags (`lattice`, `step`). The plotter uses the flags to draw bars or open/closed circles.
- **Rules.** All evaluation rules are pure functions of `(spec, params, x)`. Rules that take randomness read their key from the rule's context (figure seed, object name, call position, `seed` argument, re-roll count) and are otherwise pure.
- **Undefined.** Reasons used: `bad_parameter`, `undefined_moment`, `out_of_range` (a probability outside [0, 1]), `not_accurate`, `no_convergence` (quantile bracket failed), `sample_too_large`, `empty_list`, `not_finite`.
- **Dependency.** `Shade` depends on `d`, `a`, `b`. Distribution objects are dependent on their parameters; sliders drive them.
- **Drawables.** `Region` for the continuous shade (clipped to the visible range, fill under the curve), `Chart` with highlight for the discrete shade. Function plotter for `Pdf(d)`/`Cdf(d)` as the core. No special drawable for the calculator.
- **Determinism and film seeking.** Pure functions; seeking is free.

## 9. Better than the reference app

- **One value, many views.** A distribution is a value; density, cdf, quantile, moments, sampling, shading, tables hang off it. No per-distribution command sets and no density-or-cumulative Boolean.
- **Data-driven specs.** The calculator and the commands read the same table, so the view cannot disagree with the commands, and adding a distribution is one entry.
- **Accurate tails**: survival functions and `tail = "right"` quantiles.
- **Interval notation** for open/closed ends; the discrete case is no longer a mystery.
- **Reproducible randomness**: seeded, scripted, prefix-stable, with an explicit re-roll.
- **Animating samples** with `t` or a slider just works.
- **The calculator is made of figure objects** that the teacher can create and the learner can keep.
- **Normal approximation with continuity correction** shown side by side with the exact value.
- **`MinTrials`, `CentralInterval`, `PlotRange`** remove common manual loops.

## 10. Changes to the core design

1. **Add the `Distribution` types** (`Distribution`, `ContinuousDistribution`, `DiscreteDistribution`) to the type table. Distribution objects are values with no drawable of their own.
2. **Add the constant `inf`** (positive infinity; `-inf` by negation) to the built-in constants.
3. **Add seeded randomness**: the `@seed` directive (with optional version tag), the `seed =` named argument on every random command, per-object re-roll counts saved as style (`with reroll = k`), and the `Reroll` action. Rules that use randomness take a `RandomContext` (figure seed, object name, call position, seed argument, re-roll) as an explicit input; the key rules in 6.2 are part of the file format.
4. **Function values may carry** a batch evaluator `evalBatch(xs: Float64Array): Float64Array` and flags `lattice` and `step` for the plotter.
5. **`rand(seed)`** in the core's built-in function list becomes a thin wrapper of the first value of stream `(figure seed, 0, 0, seed, 0)` so old scripts keep their meaning; `noise` is unchanged.
6. **Warnings and undefined reasons** as in `errors.md`.
7. **Closed-set text options** (`ends`, `tail`): shared with statistics (`bad_option`).
8. **Static checking of literal parameters**: when every parameter of a constructor is a literal, a violated domain is the static error `bad_argument`; when parameters depend on objects it is the runtime undefined `bad_parameter`. This pattern is shared with lists-matrices (literal ragged matrix).

## 11. Open questions

1. Should object name be part of the random key (rename changes numbers)? We say yes; alternative is the object id, which makes numbers depend on creation history.
2. Should the default `ends` for discrete `Prob` be `"[]"`? Teachers often say "at most" and "at least", which are `[]`; strict inequalities need the explicit form.
3. Do we offer `Bootstrap(list, statistic, n)` as a built-in simulation helper? It can be built from `Seq` and `Sample`, but a command shortens the teacher's lines.
4. Truncated or mixture distributions: not in v1 (`Discrete` and `Triangular` cover the common cases).

## Sources studied

Removed before the repository was made public. The study notes above are in our own words.
