# Probability: what the learner sees and does

## 1. How GeoGebra presents it

- A separate **Probability Calculator** window or perspective with two tabs, Distribution and Statistics.
- Distribution tab: a drop-down of distributions, text boxes for each parameter, a plot of the density, buttons for density versus cumulative curve, four buttons for the probability mode (interval, left, right, two-tailed), text boxes for the lower and upper bounds, a result box, draggable markers on the x axis, a table of values for discrete distributions, and a style bar with a normal-curve overlay and export (picture, clipboard, or drag into the graphics view).
- Statistics tab: a drop-down of tests and intervals (z and t for means, one and two samples; z for proportions; chi-squared), text boxes for hypotheses and data, and an output area with the numbers.
- The plot is a small copy of the graphics view; what the user builds there is not live objects in the main figure, unless exported.

We keep the two-tab idea, the four modes, the markers and the result box. We change: the calculator is made of ordinary figure objects and can be docked as a panel or a floating card; a results card draws the statistic's curve with the p-value shaded; random simulation has a strip of its own; keyboard and screen reader are first class.

## 2. Layout

### 2.1 Docked panel (wide screens)

```text
┌ Probability ─────────────────────────────────────── ✕ ┐
│ ( Distribution | Statistics )                          │
│ Distribution: [ Normal ▾ ]   μ [ 0 ]  σ [ 1 ]          │
│ Show: ( density ● | cumulative )   ☐ normal overlay      │
│ Mode: [ P(a ≤ X ≤ b) ] [ P(X ≤ b) ] [ P(X ≥ a) ] [ two-tailed ] │
│                                                        │
│          ▁▂▄▆███▆▄▂▁                                    │
│   ──────[▒▒▒▒▒▒▒▒▒▒]──────                              │
│        a=-1.00       b=1.00                             │
│                                                        │
│ a [ -1 ]   b [ 1 ]   P = [ 0.6827 ]                      │
│            [ Add to figure ] [ Copy lines ] [ Image ]   │
└────────────────────────────────────────────────────────┘
```

### 2.2 Narrow screens

A bottom sheet with the plot on top and three collapsible sections (Distribution, Probability, Table). Tapping the plot dismisses the sheet to a handle.

### 2.3 Inside the figure

Because the calculator is made of objects, the same picture can sit in the main view: the teacher's `draw` creates the objects; the **Probability** panel can then adopt them (the panel detects `Shade(d, …)` objects and offers to control them).

## 3. The plot

### 3.1 Continuous

- Density curve in the object's colour, 2.5 px; area under the curve between the bounds filled at 35 % opacity.
- The x axis shows tick labels chosen from `PlotRange(d)`: about 6 to 9 ticks, rounded to 1, 2, 5 steps.
- Markers (small triangles on the x axis) at the bounds with their values printed. The shaded edges also have vertical guide lines.
- In left/right modes only one marker is shown; in two-tailed mode two markers, tails shaded; the middle left white.
- Cumulative: the S-curve; markers show the points `(a, F(a))` and `(b, F(b))` with horizontal guide lines to the y axis; the probability is drawn as a vertical double arrow between them (interval), or from 0 to `F(b)` (left).
- Heavy-tailed distributions use the 98 % window and show "tails extend beyond view" arrows at both ends.

### 3.2 Discrete

- Bars (one per whole value) of width 0.9, heights are the mass. Bars in the interval are full colour, outside are pale (25 % opacity). Bars with zero mass are not drawn.
- Cumulative: step function with filled circles on the right end of each step and open circles on the left; the interval shown as two vertical guide lines.
- Bounds snap to whole numbers. Bracket toggles: small `[` / `(` buttons beside each bound switch between closed and open ends; the result label reads `P(3 ≤ X < 7)` accordingly.

### 3.3 Normal overlay

A dashed curve of `NormalApprox(d)`. For discrete distributions the overlay is drawn with the area from `a − 0.5` to `b + 0.5` shaded in hatching; the result area shows:

```text
exact   0.8906
normal  0.8914   (continuity correction)   Δ 0.0008
```

### 3.4 Table of values

- Opened by a `Table` toggle (discrete); scroll area with columns `k`, `P(X = k)`, `P(X ≤ k)`, `P(X ≥ k)`; the rows in the interval are highlighted; clicking a row sets both bounds to that `k`; shift-click sets the other bound.
- For continuous distributions an optional table with a `step` shows `x`, `f(x)`, `F(x)`.
- Copy the table as TSV; **Add to figure** emits `PdfTable(d, from, to)`.

## 4. Controls

### 4.1 Distribution picker

- A drop-down grouped as Continuous and Discrete, sorted in teaching order (Normal, Student t, Chi-squared, F, Exponential, Uniform, Gamma, Beta, then the rest; Binomial, Poisson, Geometric, Negative binomial, Hypergeometric, Bernoulli, Discrete uniform, Zipf, Custom).
- Choosing a distribution fills its default parameters (design section 7.3).
- Parameter fields show names with the proper symbols (μ, σ, ν, λ, α, β, n, p) and accept numbers or formulas. A tiny slider handle beside each field makes it a figure slider (`mu = 0 in -5..5`) so it can be dragged with the markers.
- A custom distribution opens a small grid for values and probabilities (up to 50 rows), with a sum line that turns red unless it is 1.

### 4.2 Mode buttons

Four buttons with plain icons and text labels. The label shows the symbol in use (`P(a ≤ X ≤ b)`, `P(X ≤ b)`, `P(X ≥ a)`, `P(X ≤ a) + P(X ≥ b)`). Screen readers read the full phrase.

### 4.3 Bounds and the result box

- Bounds are number inputs. Dragging a marker updates them continuously; the result updates live (computed in under a millisecond).
- **Result editing**: in left/right and two-tailed modes the result box is a field. Typing a probability moves the marker (the inverse). For discrete distributions the value that is reached replaces the typed one, with the small note `nearest above`.
- Pressing `Up`/`Down` in a bound field changes it by a small step (`0.1 σ`; `1` for discrete); with `Shift` by 10×.
- `Esc` restores the last valid values.

### 4.4 Drag behaviour

- Markers are draggable. Snap: continuous bounds snap to multiples of `σ/20` (a faint grid) while holding `Alt`; otherwise free. Discrete bounds always snap to whole numbers.
- Dragging past the other marker swaps their roles, with a brief flash.
- Dragging in the curve area pans the x range; pinch or wheel zooms. A "Fit" button restores `PlotRange`.

### 4.5 Style bar

Show/hide: normal overlay, grid, labels, mean marker, mean ± 1, 2, 3 sd bands (drawn as light vertical stripes), table.

## 5. Statistics tab

### 5.1 Picker

A grouped drop-down:

- Tests: z for a mean, z for two means, t for a mean, t for two means (pooled or not), t paired, z for a proportion, z for two proportions, chi-squared (goodness of fit; independence), ANOVA.
- Intervals: the matching confidence intervals.

### 5.2 Input

- A hypothesis block: `H₀: μ = [ 100 ]`, `H₁:` a three-way toggle (`≠`, `<`, `>`) chosen from the tail.
- Data: either summary numbers (mean, sd or sigma, n) or a chosen list from the figure. A toggle switches between them. The chosen list's statistics are shown so the learner sees which numbers the test used.
- Tables (chi-squared): an editable grid for observed counts; the expected grid appears next to it, with cells below 5 underlined.
- Level box for intervals (default 95 %).

### 5.3 Result card

As in `statistics/ui.md` section 5: hypotheses, statistic, df, p-value, estimate, standard error, the distribution curve of the statistic with the p-value area shaded and the observed statistic marked. A line under it reads "If H₀ were true, a result at least this extreme would happen about 1 time in 56 (p = 0.0179)". The sentence is generated from `p` (words: "about 1 time in N" for p between 0.001 and 0.5; "less than 1 time in 1,000" below). A switch can turn the sentence off for exam use.

The card is made of objects: `r = TTest(...)`, `Pdf(r.dist)`, `Shade(r.dist, ...)`, `Readout` rows. **Add to figure** keeps them.

### 5.4 Decision (optional)

An "α" field (default off). When on, it draws a rejection region lightly in a second colour and writes "p < α: reject H₀" or "p ≥ α: do not reject H₀". It never appears unless asked.

## 6. Simulation strip

A thin strip at the bottom of the figure when any random object exists (or from the **Simulate** button of the panel):

```text
 Seed [ 1 ]  [ ↻ Reroll ]   Samples n [────●──────] 120    ▶ Run   ⏸
```

- **Seed**: the figure seed; typing a number sets `@seed N`. **Reroll** adds one to the seed (or to the selected random objects' re-roll counts: with a random object selected, it rerolls only that).
- **n slider** appears for each `Sample(…, n)` whose `n` is a free number: draws appear one at a time as the slider moves; earlier draws stay.
- **Run** advances `n` by 1 every 0.1 s (adjustable 0.02 to 1 s) up to the slider's max; the clock is `t`-driven so a film seeks exactly.
- A tally strip under it shows `Tally` of the sample (bars) next to the theoretical distribution (outlined bars or curve): the **empirical versus theoretical** display. The difference (maximum bar gap, or the Kolmogorov distance) is printed.
- Speed control and a "Last draw" highlight (the newest value pulses for 300 ms).

Dice and coin helpers: the **Simulate** menu has `Coin`, `Die`, `Two dice (sum)`, `Spinner (n equal sectors)` that emit the right `Sample(Discrete(…), n)` lines. The die faces shown as large glyphs for small `n` (under 12) in a row above the tally.

## 7. Keyboard and screen reader

- The plot is focusable. Left/Right moves the focused marker by one step; Shift+Left/Right by ten steps; Tab switches marker; `M` cycles the mode; `T` toggles the table; `C` toggles cumulative.
- The live region reads: `Normal, mean 0, standard deviation 1. Probability between −1 and 1 is 0.6827.` After a change, the new bounds and probability.
- Discrete: `Binomial, n 10, p 0.5. Probability that X is between 3 and 7 inclusive is 0.8906.`
- A hidden table mirror lists the bars (`k`, mass) for discrete distributions, and quantiles at 5, 25, 50, 75, 95 % for continuous ones (Alt+T shows it).
- Statistics results are read as a sentence: `T test, mean greater than 100: t 2.31, 11 degrees of freedom, p 0.0206.`

## 8. Touch

- Markers have a 44 px touch target. Long press on the plot opens the bounds as numeric fields.
- Pinch to zoom, two-finger drag to pan. A double tap on a bar (discrete) sets both bounds to it.
- Mode buttons are 44 px tall.

## 9. Colours and defaults

| Item | Default |
|---|---|
| Density curve | figure colour 1, 2.5 px |
| Shaded area | same colour at 35 % opacity (discrete: full colour inside, 25 % outside) |
| Normal overlay | dashed, grey `#6b7280`, 1.5 px |
| Markers | triangles, 10 px, same colour as the shaded area |
| Table highlight | shaded area colour at 15 % |
| p-value region | `#d1495b` at 40 % (distinct from the curve), statistic marker a vertical line |
| Rejection region (when α on) | `#ee964b` at 25 % |
| Axis | numbers in a size relative to the figure |

Colours are never the only cue: shaded regions carry labels (`P = 0.6827`), markers carry their numbers.

## 10. Animation

- The shaded area follows markers live; no easing during a drag. After a typed change it eases over 200 ms.
- Changing a parameter morphs the curve over 250 ms (the plotter interpolates the sample values), with the bounds held; discrete bars grow or shrink in place.
- Switching distribution cross-fades 200 ms.
- Simulation: new draws appear with a 150 ms fade/scale-in; the tally bars rise with the same easing.
- Reduce-motion: all of the above become instant or crossfades.

## 11. What we change from GeoGebra

- The calculator is built from figure objects and can be adopted by the main view.
- Interval brackets (open and closed ends) for discrete distributions.
- Normal approximation with continuity correction side by side with the exact value.
- A p-value results card with the statistic's curve shaded.
- Simulation strip with seed, reroll, run, empirical versus theoretical display.
- Keyboard control of markers, screen-reader sentences, hidden data table.
- Clear invalid-parameter feedback instead of silent fallback.
