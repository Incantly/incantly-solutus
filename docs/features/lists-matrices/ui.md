# Lists and matrices: what the learner sees and does

## 1. How the reference app presents it

- A list shows in the algebra panel as `{1, 4, 9, …}`. A list of points or shapes also draws all its elements in the graphics view.
- A matrix is a list of lists. The algebra view can show it as a matrix, with brackets, and lets you type or edit a matrix through a dialog in some apps. No built-in picture of what the matrix does to the plane.
- Data comes from the spreadsheet or a typed list.
- Undefined results show as `?` with no reason.

We keep: a readable algebra panel entry, and drawing of lists of points and shapes. We change: reasons for undefined, editing in place, a picture of linear maps, large-list drawing, and screen-reader summaries.

## 2. The list on screen

### 2.1 Side panel row

```text
squares   List<Number>[10]   1  4  9  16  25  36  49  64  81  100        ▸
```

- Shows up to 12 values, then `…`. A caret opens the full list in a scrolling grid of up to 100,000 rows (virtualised).
- Clicking a value in the grid selects the line that defined it. Editing a free list (a literal) edits the cell, and the kernel rewrites that line (`squares = [1, 4, ...]`); editing a computed value is not allowed and the cell shows the formula instead.
- Undefined elements show `—` with a tooltip giving the reason.
- A list that is too long to read gets a tiny summary: length, min, max, and a sparkline (a 40-bin histogram for numbers).

### 2.2 In the drawing

- `List<Point>` draws as dots. Default size 4 px, colour from the object's palette. With `with connect = true`: a polyline. With `with connect = "smooth"`: a spline through the points.
- `List<Segment>`, `List<Circle>`, `List<Polygon>` draw each element with one shared style.
- A list over 20,000 points is decimated for drawing: one point per pixel cell, the density shown by opacity. Hit testing uses the full data through a spatial index. The side panel shows `drawn 12,400 of 1,000,000` when this happens.
- A list's `label` is drawn once, near its first element, as the list's name; elements get no labels unless `with labels = "index"` (numbers 1, 2, 3 beside points) or `with labels = "values"`.
- Highlight: `Highlight(xs, 2)` pulses all elements together. `Highlight(xs[3], 2)` is not a drawable (a list element is not an object); the model should use `PointOn` or `Points` for single points it will refer to.

### 2.3 Dragging

- A free list of points (`P = [(1, 1), (2, 3), (3, 2)]`) can be edited by dragging each point: the drag rewrites the literal line. Dependent lists (`Seq`, `Map`) are not draggable; the cursor shows "driven by n".
- A point inside a list takes a drag handle only when the pointer is within 10 px (16 px on touch).
- Snap: optional grid snap to 0.1 or to whole numbers while dragging a list point; hold Shift to turn snapping off.

### 2.4 Keyboard and screen reader

- The panel row is a list: `squares, list of 10 numbers: 1, 4, 9, 16, … 100. Press Enter to open.`
- Opened grid: arrow keys move between cells; Enter edits a free list cell; Escape closes.
- A list of points on the canvas is announced as one object: "squares points, 10 points, first (1, 1), last (10, 100)". An arrow-key move on a focused point list steps through points: Tab goes to the next point, the point's coordinates are read.
- Sorting or filtering that changes the list is announced: "Sorted: 10 numbers, from 1 to 100".

## 3. Matrices

### 3.1 The grid

A matrix appears in the side panel as an editable grid:

```text
A  =  ⎡ 2   1 ⎤
      ⎣ 1   3 ⎦          2×2   det 5   rank 2        ▸ map
```

- Free (literal) matrices: each cell is an input. Tab and arrow keys move; Enter commits; the line is rewritten as the user types out of a cell. Add and remove row or column buttons appear on hover (they rewrite the literal). The max grid size shown is 12×12; larger matrices scroll.
- Exact matrices show fractions (`1/3`) and a small `exact` badge. A toggle in the row switches to decimals.
- Dependent matrices (from `A * B`, `Invert(A)`) are read-only; each cell shows its formula on hover.
- Undefined matrices show a one-line reason with a link to the object that caused it: "singular — determinant is 0. Rank is 1" (using `Rank` of the input).
- Entries that are very close to zero (below `tol`) display as `0` and a thin dotted underline; a tooltip shows the true value (`3.2e-17`).
- Small readouts under the grid: determinant (square), rank, trace, condition number when above 1e6 (red) — each toggled by the user in the row's menu.

### 3.2 Plane map

A 2×2 matrix (and a 3×3 homogeneous matrix) can show how it moves the plane. Toggle: the "map" control in the row, or `A with map = true`.

```text
 y
 │        ╱╲                 unit square → parallelogram (filled, light)
 │      ╱  ╱                 e₁ → column 1, e₂ → column 2 (arrows from origin)
 │    ╱__╱                   grid lines → deformed grid (thin)
 └───────────── x            eigen-lines: dashed, through the origin
```

Layers, all optional (each is a style property):

| Property | Meaning | Default |
|---|---|---|
| `map` | whole map on or off | off |
| `grid` | deformed grid (range -5..5) | on when map is on |
| `basis` | images of e₁ and e₂ as arrows | on |
| `square` | image of the unit square, filled | on |
| `eig` | real eigenvectors as lines, labelled with eigenvalues | off |
| `ghost` | the original grid and square drawn light grey for comparison | on |
| `det` | signed area label inside the parallelogram | on |

- When the determinant is negative the parallelogram is drawn with a diagonal hatch, a "flipped" label, and the basis arrows swap colours so orientation is visible.
- When the determinant is near zero (below 1e-9) the parallelogram collapses to a segment; the segment is drawn with a thick line and the caption "flattens the plane onto a line".
- Dragging: the two basis arrow heads are draggable if the matrix is a free literal. Dragging an arrow head rewrites the column. Snap to grid. The determinant label updates live.
- Animation: a "play" toggle morphs from the identity to `A` over 1.5 seconds with `t`-driven interpolation `(1-s) I + s A`. A matrix with a slider (`Matrix([[1, s], [0, 1]])`) shows the shear live as `s` moves.
- Colours: ghost grid `#c8cdd4` at 50 % opacity; image grid in the object's colour; e₁ arrow red-orange, e₂ arrow teal (colour-blind safe pair, both distinct in grayscale); eigen-lines dashed purple.
- 3×3: homogeneous matrices show the image of the unit square only (a 2D affine map). Real 3D is not in v1.

### 3.3 Eigenvalues in the plane

`Eigenvalues(M)` is a `List<Point>`, so it already draws in the same graphics view. To keep them readable next to the map, the view offers a mini "complex plane" inset (bottom-left corner, 140 px) that shows eigenvalues plus the unit circle; a double-click opens it as a full view. Complex pairs are drawn as symmetric dots.

### 3.4 Decompositions

- A Record shows its fields as a collapsible tree in the side panel: `LU{ L, U, P }` → three small grids. Clicking a field pins it as its own panel row (no new object is made; it displays `lu.L`).
- For `SVD`, the plane map can show three steps in order: Vᵀ (rotation), diagonal S (stretch), U (rotation). A stepper control moves through them.
- For `QR`, show columns of Q as orthonormal arrows over the columns of the input.

## 4. Touch

- Cells have 44 px touch targets; a matrix row stretches to fit.
- Long press on a list point starts a drag; a quick tap selects.
- Pinch zooms the map as it zooms the graphics view.
- The grid uses a numeric keyboard for number cells; a `−` and `/` key are present for negatives and fractions.

## 5. Defaults

| Item | Default |
|---|---|
| Points in a list | 4 px, solid, object colour |
| Polyline through list | 2 px |
| Plane-map square fill | object colour at 18 % opacity |
| Hatch for negative determinant | 45°, 1 px, 6 px apart |
| Number format in grid | 6 significant digits; `exact` shows fractions |
| Max rows shown before virtualisation | 40 |

## 6. Animation

- A list that grows (slider `n`) animates its newest points with a 150 ms fade-in; points that go away fade out. Existing points do not move.
- `Sort(...)` of a list of points that are shown with labels can animate the reorder when the user switches on "show steps" (a 400 ms transition of the label positions). Off by default.
- Plane map morph as above; respect the system "reduce motion" setting by turning it into a crossfade.

## 7. What we change from the reference app

- Reasons for undefined, in the panel, with a link to the cause.
- Editable matrix grid with fractions when exact.
- Plane-map view with determinant, eigen-lines, hatch for orientation flips.
- Drawing of huge lists by density.
- Keyboard and screen reader summaries for lists and matrices.
- Record trees instead of a long list of output objects.
