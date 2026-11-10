# Statistics and charts: what the learner sees and does

## 1. How GeoGebra presents it

- Charts are ordinary graphics objects, each added by a command or by a data analysis panel. They sit on the same axes as everything else.
- Three analysis panels live in a spreadsheet-driven window: one variable (plot beside a statistics table, class controls), two variables (scatter plot, model menu, statistics, prediction box) and several variables (stacked box plots, table, ANOVA).
- The panel plots are small copies of the graphics view; changes in the panel do not change the main figure unless the user exports the plot.
- Statistics tests and intervals are on a separate Statistics tab in the probability window, with drop-downs, text boxes and a results table.
- Numbers from commands are plain numbers or lists in the algebra view.

We keep the three-panel idea and the tests tab. We change: the panels are driven by lines and can write lines, charts are interactive objects with readable bars, results are records with names, and nothing needs a spreadsheet.

## 2. Charts on the main view

### 2.1 Shared behaviour

- A chart is one object with one style (colour, opacity, line width, label). Per-bar colours: `with color = list`.
- Hover (mouse) or focus (keyboard) on a bar, box, slice or dot cluster shows a tooltip: `Class [10, 20): 7 values, 23 %` / `Q3 = 7.5` / `Slice "Blue": 4 of 12 (33 %)`.
- Click selects the chart; double click opens its data (a table for histograms; the list for others).
- Data edits: if the chart was made from a free list or ready heights, bars of bar charts and histograms can be dragged vertically to change a height, and histogram edges can be dragged horizontally to change a class boundary (snaps to the nearest 0.5 of the bin width; Shift disables snapping). Each drag rewrites the literal line. Computed heights (from raw data) are not draggable; the cursor shows "from data".
- Labels: heights above bars (`with labels = "counts" | "percent" | "none"`), default `counts` for fewer than 20 bars, else `none`.
- Axis help: a histogram's y axis is labelled by its scale (`Frequency`, `Relative frequency`, `Density`). Density y-labels are printed in small text beside the axis to remind that area, not height, is the count.
- When classes are unequal the chart carries a small badge "heights are density" at its top left; clicking it offers "show counts" (re-draw as counts, with a warning that heights now mislead).

### 2.2 Default look

| Chart | Look |
|---|---|
| Histogram | bars touch, 1 px white gap line between bars, fill at 55 % opacity, outline in the full colour |
| Bar chart | bars separated by 20 % gap, bars centred on their x |
| Box plot | box with median line (2 px), whiskers with end caps; outliers as open circles; label at left |
| Dot plot | one dot per value, stacked upward, dot diameter = min(bin width in pixels, 12 px) |
| Stem plot | monospace text block with a vertical rule between stem and leaves; stem units caption "Key: 1 | 2 = 12" |
| Pie chart | slices clockwise from the top, colour-blind safe 8-colour palette, white 1 px separators, labels outside with leader lines when the slice is under 6 % |
| Line / step / stick graph | 2 px, same colour as points; sticks end in a 4 px dot |
| Normal quantile plot | points plus a dashed reference line; `r` printed in a corner |
| Residual plot | points plus a dashed zero line; bars to the line optional |
| Squares | square outlines at 1.5 px, fill 25 % opacity, same colour family as the fit line |

Default colours follow the figure's palette. Pairs that must be told apart (boxes in `BoxPlots`, groups in ANOVA) use the colour-blind palette: blue `#2f6fdb`, orange `#e07b1a`, green `#2a9d6f`, purple `#7b52c6`, pink `#cc4c8c`, grey `#6b7280`, gold `#c9a227`, cyan `#1498b3`; the same order every time. Colour is never the only cue: boxes also carry text labels.

### 2.3 Screen reader and keyboard

- A chart announces: `Histogram of data, 6 classes. Counts 3, 7, 12, 9, 4, 1.` Arrow keys step through bars; the read-out says `Class 3 of 6, 20 to 30, 12 values, 33 percent`.
- Box plot: `Box plot of times, minimum 4, first quartile 7.5, median 9, third quartile 13.5, maximum 21, one outlier at 21.`
- Pie: `Pie chart, 3 slices. Red 5 of 12, 42 percent; ...`.
- Scatter plus fit: `Scatter of 5 points with line fit y equals 6.9 x plus 46.1, R squared 0.971.`
- A hidden table mirror of every chart is available (Alt+T toggles a visible data table).

### 2.4 Touch

- Tap a bar to show its tooltip; long press to start a drag on a draggable chart.
- Bars and slices get a minimum hit target of 24 px height/width even if thinner.
- Two-finger gestures belong to the view (pan, zoom), not the chart.

### 2.5 Animation

- A chart that rebuilds because its data changed morphs bar heights over 250 ms (not on every frame when dragging a slider that changes data; it snaps while the slider moves, easing on release).
- A newly made chart grows from zero over 300 ms. Reduce-motion turns these into fades.
- A fit line draws left to right over 400 ms the first time it appears; the teacher's `draw` can pass `with animate = false` to skip.
- Histogram class changes slide the bars to the new edges rather than jumping.

## 3. Regression on the view

- The fit curve is drawn in a contrasting colour, 2.5 px, extending 5 % beyond the data on each side by default and dashed outside the data range (extrapolation).
- Points above the line and below the line are tinted by sign of residual only when residuals are switched on (`with residuals = true`): short vertical segments from the point to the curve, red above, blue below; plus a small label of the biggest residual.
- **Squares mode** (`Squares(P, f)`): the object draws a square for each point; dragging a free line's parameters (when the model is a line with free `m` and `b`) updates the squares live; a readout shows total area and the best-fit total for comparison. The learner sees the total shrink as the line approaches the fit.
- **Bands**: `FitBand` draws a translucent band; hovering shows `at x = 3.5: 66.2 ± 5.1 (95 % mean)`.
- Equation label: draggable text placed near the curve, `y = 6.9 x + 46.1  (R² = 0.971)`, updates with the fit; font follows the figure.
- Prediction: with the fit selected, `Alt+click` on the x axis drops a vertical guide and reads `x = 3.5 → ŷ = 70.3` (a transient overlay, not an object).

## 4. The data-analysis panel

One panel, three modes, opened from the view menu (`Data analysis`) or from a chart's context menu (`Analyse this data…`). It is a side panel (320 to 480 px wide, resizable) on wide screens and a bottom sheet on narrow ones.

```text
┌ Data analysis ────────────────────────────── ✕ ┐
│ Data: [ times ▾ ]   ( One var | Two var | Several ) │
│ ┌ Plot ──────────────────────────────────────┐ │
│ │  Histogram ▾                               │ │
│ │  ▇▇                                        │ │
│ │  ▇▇ ▇▇▇                                    │ │
│ │  ▇▇ ▇▇▇ ▇▇                                  │ │
│ │  4      12      20                         │ │
│ └────────────────────────────────────────────┘ │
│ Classes: ( Auto ● | Bins [ 6 ] | Width [ 5 ] Start [ 0 ] )  │
│ Overlay: ☐ normal curve  ☐ polygon  ☐ cumulative │
│ ┌ Statistics ───────────────────┐  sd: ( n ● | n-1 ) │
│ │ n 9      mean 10.4   median 9  │              │
│ │ min 4    q1 7.5      q3 13.5   │              │
│ │ sd 4.9   max 21      iqr 6     │              │
│ └────────────────────────────────┘              │
│            [ Add to figure ]  [ Copy as lines ]    │
└──────────────────────────────────────────────────┘
```

### 4.1 One variable

- Data picker: any `List<Number>` in the figure, or a pair (values, frequencies).
- Plots: histogram, box plot, dot plot, normal quantile plot, stem-and-leaf, bar chart (for whole-number or categorical data).
- Class controls change the chart live; typed edges go into a text box; invalid edges show a red outline and the `bad_edges` reason.
- Table: the `Describe` record. A switch picks population or sample deviation; the label always says which (`sd (n)` / `s (n-1)`).
- A frequency table tab shows `FrequencyTable` for the current classes.
- **Add to figure** emits lines for the visible plot and its table (`h = Histogram(data; ...)`, `Readout(...)`) into the figure; **Copy as lines** puts them on the clipboard (and the teacher can read them back with `figure`).

### 4.2 Two variables

- Data picker: a `List<Point>`, or two lists chosen as x and y.
- Plots: scatter (default), residual plot.
- Model menu: none, line, line (x on y), polynomial (degree box 1 to 12), power, exponential, growth, logarithmic, sine, logistic, and `custom…` which opens an expression box and start values (runs `FitModel`). A "log space" toggle appears for power/exponential/growth.
- Statistics: `n`, means, sds, `r`, `r²`, Spearman, covariance, `Sxx`, `Sxy`, `Syy`, SSE, equation, adjusted R², standard errors for each coefficient.
- Prediction box: type x, read ŷ and (if x is in the data) the residual. Extrapolation shows a warning icon.
- Toggles: show residual segments, show squares, show confidence or prediction band (level box).
- Failure messages appear under the model menu in plain words using the undefined `detail`, with the hint line.

### 4.3 Several variables

- Data picker: several `List<Number>` objects, or a list of lists; a labels row for names.
- Plot: stacked box plots on a shared axis; a switch for `tukey` whiskers.
- Table: n, mean, sd, five numbers per variable.
- ANOVA tab: the `ANOVA` table (source, SS, df, MS, F, p) and the group means with a dotted line at the grand mean.
- Colours follow the palette order; each group's label is repeated in text.

### 4.4 Data entry

For lists that are free literals, a **Data** tab opens a simple grid (one column per list, up to 12; 1,000 rows shown, virtualised). Typing a value rewrites the literal. Paste from the clipboard accepts tab/comma/newline separated numbers. Computed lists show their rule instead of a grid. This is the minimum data editor (not a spreadsheet): no formulas in cells, no ranges.

### 4.5 Keyboard

- `Tab` moves between controls; arrow keys switch plots in the plot picker; `Enter` applies class edits.
- Panels trap no focus: `Esc` returns to the graphics view.

## 5. Test results

The Statistics tab of the probability window and the `Record` display share one **results card**:

```text
┌ TTest — mean of times vs 10, right-tailed ────────┐
│ H₀: μ = 10     H₁: μ > 10                           │
│ t = 0.24    df = 8    p = 0.408                     │
│ mean 10.4   se 1.6                                  │
│        ╱╲        shaded: P(T ≥ 0.24)                │
│    ___╱  ╲___                                       │
└──────────────────────────────────────────────────────┘
```

- The card shows the hypotheses in words and symbols (`H₀`, `H₁` from the tail), the statistic, df, p, estimate, se, and the curve of `dist` with the p-value region shaded and the statistic marked.
- Intervals show a number line with the estimate and the interval; the margin is labelled.
- Chi-squared shows the observed and expected tables side by side; cells with expected count under 5 are underlined with a tooltip. ANOVA shows the table plus the F curve.
- A card can be pinned to the figure (**Add to figure**), which writes the lines for `r = TTest(...)`, `Shade(...)`, and `Readout` rows.
- Alpha: an optional slider (default 0.05) draws the rejection region lightly and prints "reject H₀" or "do not reject H₀" under the p-value. It is off by default so the card does not decide for the learner.

## 6. Defaults

| Item | Default |
|---|---|
| Number format | 4 significant digits in cards; full precision in tooltips |
| Histogram opacity | 55 % |
| Fit line width | 2.5 px |
| Squares opacity | 25 % |
| Data grid | 8 columns × 20 rows visible |
| Panel width | 360 px |

## 7. What we change from GeoGebra

- Panels write and read lines; charts are first-class interactive objects.
- Hover tooltips, keyboard stepping, and screen-reader summaries for every chart.
- Density badge for unequal classes; histogram edges draggable.
- A fit that explains itself: equation label, residual segments, squares, bands, extrapolation dashes.
- A results card with hypotheses, the statistic's curve and the shaded p-value.
- A data grid that is minimal but real, not a spreadsheet dependency.
