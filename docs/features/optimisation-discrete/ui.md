# Optimisation, discrete, financial, calculator: what the learner sees and does

## 1. Optimisation

### 1.1 The result as a marker on the slider

When a `Maximize`, `Minimize`, `MaxValue` or `MinValue` object is visible:

```
 w  ──●───────────◆─────────────●──
    0             5.00           10        ◆ = best (Maximize)
```

- The slider track shows a small diamond at the best value, in the result object's colour. Hover: "best: w = 5.00 (A = 25.00)". The diamond is not draggable (it is a result); clicking it sets the slider to it (a one-tap "go to best" that is an ordinary slider change, so it is undoable).
- With a point on a path: a diamond on the path at the best position, labelled with its name.
- When a result is at the boundary of the range, the diamond sits on the end with a small bar and the tooltip adds "at the edge of the range".
- Several optima: a diamond at each (with `all = true`), or the first plus a "+1" chip that lists the others on click.
- For a function form, the best point is a diamond on the curve with a drop line to the axis.

### 1.2 Quality indicator

The object's label can show a small status chip:

| Chip | Meaning |
|---|---|
| `✓` | proved (exact mode) |
| `≈` | found by search (`global: sampled`) |
| `…` | refining (anytime search still running) |
| `!` | a notice needs attention (narrow feature possible, no optimum attained) |

The chip is in the Algebra panel row and in the tooltip. A learner can hover to read the sentence ("Found by checking 400 values and refining the best; a very narrow peak could be missed").

### 1.3 Tool

Toolbar group "Optimise": **Best** tool. Click a measure (a number object), then a slider (or a point on a path): creates `Maximize` or `Minimize` according to a two-button toggle shown after the first click ("Largest / Smallest"). The new object is a diamond marker. Long press the tool to choose several sliders (clicking up to four), which creates the list form. Keyboard: select the measure, press **M**, choose the slider from the list.

### 1.4 Dragging

While the learner drags a slider the best value follows if the target depends on other things the slider also controls; the diamond may jump if a different optimum becomes better. The warm-start rule keeps it from jumping between near-equal optima. While the search is `refining`, the diamond is drawn hollow, and fills when settled.

### 1.5 How the reference app presents it and what we change

The reference app creates a copy of the free object (a slider or a point) placed at the optimum, which looks like a second slider or a second point. Ours is a marker on the same slider, with status; there is no extra draggable object to confuse.

## 2. Discrete maths

### 2.1 Tools

Toolbar group "Point sets":

| Tool | What it does | Creates |
|---|---|---|
| **Point set** | Click to add points to a list; double-click or Enter finishes; Esc cancels | `S = [A, B, C, …]` with named points |
| **Hull** | Click a point set | `H = ConvexHull(S)` |
| **Triangles** | Click a point set | `T = DelaunayTriangulation(S)` |
| **Regions** | Click a point set | `V = Voronoi(S)` (and optionally `VoronoiCells` in phase 2, shown as shaded cells) |
| **Network** | Click a point set | `M = MinimumSpanningTree(S)` |
| **Tour** | Click a point set | `R = TravelingSalesman(S)` |
| **Route** | Click a graph, then start, then end | `P = ShortestDistance(G, A, F)` |
| **Graph** | Click points to place vertices, drag from one vertex to another to add an edge | `G = Graph(…)` from segments |

A point set can also be made from existing points by selecting a rectangle with the Select tool and pressing **L** ("make a list").

### 2.2 What the learner sees

- **Hull**: a thin outline around the points, with a light fill (opacity 0.08). Vertices on the hull have a filled dot; interior points stay as they are. Hover: "hull: 4 of 7 points, area 31.5".
- **Triangulation**: thin lines in a neutral colour (grey, 1 px); triangles highlight on hover. A toggle "circumcircles" shows the empty circle of the hovered triangle (a lesson on why it is called Delaunay).
- **Voronoi**: the cell boundaries in a second neutral colour; hovering anywhere in the figure highlights the nearest site and shows a thin line to it with the distance (a small, live demonstration of "nearest"). Cells are clipped to the box; the box can be dragged (its corners) when the object is selected.
- **Network** (spanning tree): edges as a bold line in the object colour, with the total length in the tooltip.
- **Tour**: a closed polyline with small direction arrows; the label shows the length and a chip: `exact` or `heuristic`. A slider-like **Replay** button in the object's panel animates a dot travelling the tour (a `Trace` of a moving point, driven by the clock).
- **Route**: the path highlighted over the graph in an accent colour; start and end marked with a flag-shaped dot; label "length 5.0".
- **Graph**: vertices as dots, edges as lines, weights (if any) as small labels in the middle; hovering a vertex highlights its edges.

### 2.3 Dragging and snapping

Dragging a point in the set moves it; all outputs recompute and redraw in the same frame (under 16 ms for 1,000 points; beyond that the output dims during a sliced recomputation and the old output stays visible until the new one is ready). A snap-to-grid option applies as in the rest of the figure. Points that coincide are merged visually with a small count badge ("2") and a notice appears in the Algebra row ("duplicates removed").

### 2.4 Degenerate states

When fewer than three points are present or all lie on a line, the hull and triangulation objects are undefined: their drawable is hidden, and the Algebra row shows the reason in plain words ("All 5 points lie on one line"). The Hull tool shows a one-line hint when clicked on such a set.

### 2.5 Keyboard and screen reader

- Tab cycles through the points of a set; arrow keys move the focused point by one grid step (Shift: a tenth of a step); the outputs update.
- Screen-reader text: hull: "convex hull of seven points with four corners, area 31.5"; triangulation: "twelve triangles"; Voronoi: "nine cell edges"; tour: "closed tour through seven points, length 17.4, found exactly"; route: "route from A to F through B, C and D, length 5".
- Cell and triangle hover is mirrored by focus: Tab into the figure's object list and pressing Enter on "Voronoi" announces the nearest site to the keyboard cursor.

### 2.6 Touch

Point set tool: tap to add, double-tap to finish. Drag points by touch with a 24 px hit area. Hover info is replaced by a tap-and-hold readout.

## 3. Financial

There is no special view. The commands give Numbers; the usual ways to show them apply: `Readout`, text with `{m:2}`, and sliders for rate, periods and amount.

### 3.1 The financial panel (optional, phase 2)

A small panel template, opened from the Insert menu, "Loan calculator": four labelled inputs (amount, yearly rate, years, payments per year) as sliders with number boxes, and a read-out for the payment, total paid and total interest. It creates plain lines (`rate = …`, `pay = Payment(…)`, `Readout(…)`), so everything is visible and editable as a script. A **Table** button creates the `LoanTable` text (phase 2).

### 3.2 Number display

- Money results display with 2 decimals by default (`{m:2}`) and a thousands separator when the text format `{m:2,}` is used (phase 2 format letter).
- Negative values (money out) display with a minus sign; a toggle in the read-out "show payments as positive" flips the sign **in the display text** only (the object keeps the sign convention).
- The notice `rate_looks_like_percent` appears as an inline amber hint under the input.

## 4. Calculator (scientific profile)

### 4.1 Layout

```
┌──────────────────────────────────────┐
│ 3/4 + 1/6                            │  row r1 (input)
│                          = 11/12     │  output
│ nCr(10, 3)                           │  row r2
│                          = 120       │
│ Normal(0, 1, 1.96)                   │  row r3
│                          = 0.9750021 │
│ ▸ _                                  │  new row
├──────────────────────────────────────┤
│ [S⇔D] [DEG] [Ans] [ x/y ] [ √ ] [ ^ ] │  top key row
│  7  8  9  ÷  ( )                      │
│  4  5  6  ×  nCr nPr                  │
│  1  2  3  −  Mean SD                  │
│  0  .  π  +  =                        │
└──────────────────────────────────────┘
```

- **Rows** are the standard object lines in a calc view, in order. Each is editable; editing a row updates rows that use it.
- **S⇔D**: toggles each output between exact (fractions, surds, π) and decimal. This is a display switch on the view (it does not change the saved lines).
- **DEG/RAD**: shows the angle mode. In degree mode, a bare angle typed after `sin(` is stored with the `deg` suffix, so the saved line says `sin(30deg)`. The row shows `sin(30°)`.
- **Ans**: inserts the previous row's name.
- **Fraction key**: inserts a stacked-fraction template, stored as `a/b`.
- **Statistics keys** (Mean, SD) open a small list editor (comma-separated numbers) that inserts `Mean([2, 4, 4, 5])`.
- Hidden commands: the key pad shows only the profile's commands. Typing a hidden command gives the inline message "not available in the calculator; the Graphing profile has it".

### 4.2 How the reference app presents it and what we change

The reference app's Scientific app hides everything except the nine commands via filters and a forced perspective. Ours does the same but as an explicit profile and with the saved lines being honest about angle mode; the history is a script, not a hidden list.

### 4.3 Accessibility

Rows are list items with speech text ("three quarters plus one sixth equals eleven twelfths"). Large-key mode (touch) offers 56 px keys. High-contrast theme follows the system setting.

## 5. Colours and styles (defaults)

| Object | Colour | Width | Notes |
|---|---|---|---|
| Best marker (diamond) | accent 2 (orange-gold) | 8 px | hollow while refining |
| Hull outline | accent 1 (blue) | 2 px | fill opacity 0.08 |
| Triangulation | neutral grey | 1 px | |
| Voronoi edges | neutral grey (darker) | 1.5 px | |
| Network (MST) | accent 3 (green) | 3 px | |
| Tour | accent 4 (purple) | 2.5 px | arrows every 80 px |
| Route | accent 5 (red) | 4 px | flag dots at ends |
| Graph | dark grey | 1.5 px edges, 5 px vertices | |
| Labels | main text colour | | font follows figure |

Colours come from the figure palette, so a theme change restyles them. All have a pattern or shape cue (diamond, arrows, flags, dash for heuristic) so colour is never the only signal.

## 6. Animation

- A new best marker slides from the old position to the new (200 ms) when the optimum changes through dragging; with reduced motion, it jumps.
- The tour's replay is a moving dot at constant speed (default 2 units per second), controlled by the film clock.
- Triangulation and Voronoi lines do not animate when points drag (they change every frame, and animation would lag); when a point is added, new lines fade in over 120 ms.
- Shortest path highlight: segments light up in sequence from start to end (80 ms apart) when first created.

## 7. Errors and undefined in the UI

- An error from a tool click (for example, `no_dependency`) shows as a toast near the tool with the first `suggest` line as a button ("Use w instead").
- An undefined object shows its reason as a one-line chip in the Algebra row; hovering the dimmed drawable shows the same.
- A `refining` object shows a thin progress sweep on its row.
