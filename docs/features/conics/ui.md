# Circles, arcs, sectors and conics: what the learner sees and does

## 1. How GeoGebra presents it

- Circle, arc and conic tools sit in two toolbar groups. Each needs several clicks on points; a preview shows the shape under the cursor.
- A circle shows as a thin outline; its centre is a point, and dragging the circle drags the free defining points. Arcs and sectors have a filled light region; the sector's area shows as its value.
- Conics from five points are drawn through the points; dragging any of them reshapes the conic in a way that can cause a sudden change of type.
- Tangent tool: click a point then a conic; the tangents appear as lines and the user has to find which tangent touches where.
- The equation is shown in a side list in the form the program chose (sometimes `x² + y² = 4`, sometimes the expanded form).
- Foci, vertices and axes are created as separate named objects by commands; no visual cue ties them to the conic.
- Marking the focus-directrix definition or the string construction of an ellipse requires several manual steps.

## 2. What we change, and why

1. **Show the definition.** A conic made by a defining construction shows its construction as an optional overlay: the string (two segments from the foci to the point on the conic) for an ellipse and hyperbola, and the focus-directrix segments for a parabola. The overlay is a view setting (`Show definition`), not extra objects.
2. **Type changes are visible.** When a conic crosses between kinds (ellipse to parabola to hyperbola, circle to ellipse), a small badge near its label shows the new kind for 1.5 seconds, and `near_boundary` conics show a faint dotted halo.
3. **Tangent pairs are numbered on the figure**: "1" and "2" at the touching points, so the list `T[1]`, `T[2]` is not abstract.
4. **Arcs always have visible ends**: small tick caps; the sweep angle can be shown with a dimension arc.
5. **Equations are shown in standard form by kind**: `(x − h)² + (y − k)² = r²`, `x²/a² + y²/b² = 1` after rotation, and so on, using the frame values. A toggle shows the general form.
6. **No hidden dragging jumps.** Because the ellipse parameter is the global polar angle, points on an ellipse do not jump when an ellipse becomes a circle.

## 3. Views and styles

### 3.1 Default styles

| Object | Style |
|---|---|
| Circle, ellipse, parabola, hyperbola | 2 px stroke in the theme `ink` colour, no fill |
| Arc | 2.5 px stroke; round end caps; a small tick at each end |
| Sector, Semicircle | stroke as arc plus the two radii or diameter, fill 16% of the stroke colour |
| Tangent lines | 1.5 px, `accent`, extend across the view |
| Polar, conjugate diameter | 1.5 px dashed 6/4 |
| Asymptotes | 1.5 px dotted 2/4 |
| Axes of a conic | 1 px dash-dot, 40% opacity |
| Focus points | hollow disc 4 px, label "F₁", "F₂" |
| Vertices | small square 4 px |
| Directrix | 1.5 px dashed |
| Osculating circle | 1.5 px, `accent`, 60% opacity; centre point small |
| Curvature vector | arrow with the same head as a vector, tail at the curve point |

Dark theme: strokes use the lighter theme colour; fills use alpha 22% instead of 16%.

### 3.2 Drawing quality

- Ellipse, circle: the plotter uses exact subdivision so that the deviation from the true curve stays under 0.25 px; a circle of radius 100 px is about 40 segments; zoom changes recompute the subdivision.
- Hyperbola and parabola: only the visible range, expanded by 20%; asymptotic tails fade over the last 12 px at the view edge.
- A huge ellipse is clipped; a straight-line limit (`line` kind) is drawn as a line.
- A degenerate conic draws its lines or point. An empty conic draws nothing and shows an "empty" tag when selected.

## 4. Tools

| Tool | Clicks | Line produced |
|---|---|---|
| Circle with Centre through Point | centre, point | `c = Circle(O, P)` |
| Circle with Centre and Radius | centre, then a typed radius (number or formula) | `c = Circle(O, 3)` |
| Compass | a segment (or two points), then a centre | `c = Circle(O, Length(s))` (radius follows the segment) |
| Circle through 3 Points | three points | `c = Circle(A, B, C)` |
| Semicircle through 2 Points | two points | `s = Semicircle(A, B)` |
| Circular Arc | centre, start, end | `a = Arc(O, S, E)` |
| Circumcircular Arc | three points | `a = ArcThrough(A, B, C)` |
| Circular Sector / Circumcircular Sector | as arcs | `s = Sector(…)` / `SectorThrough(…)` |
| Ellipse | two foci, then a point on the ellipse | `e = Ellipse(F1, F2, P)` |
| Hyperbola | two foci, then a point | `h = Hyperbola(F1, F2, P)` |
| Parabola | focus, then the directrix | `p = Parabola(F, d)` |
| Conic through 5 Points | five points | `k = Conic(A, B, C, D, E)` |
| Tangents | point then conic; or line then conic; or conic then conic | `T = Tangent(…)` |
| Polar or Diameter Line | point then conic (polar) or vector/line then conic (diameter) | `L = Polar(P, c)` / `ConjugateDiameter(v, c)` |

A tool that produces a list (Tangents) names the list and then reveals the entries: the list's lines are shown as `T[1]`, `T[2]` with labels `t₁`, `t₂` (display names; they are not separate objects unless the user names them).

### 4.1 Preview and snapping

- While the tool is armed, a ghost of the shape being built follows the cursor with the current inputs.
- Circle through points: snap to existing points (12 px). The radius field accepts expressions.
- Ellipse/Hyperbola: after the two foci, the ghost shows the ellipse through the cursor; if the cursor position would give a `too_short` ellipse the ghost is red with "too short: major axis must exceed the distance between the foci".
- Tangent tool: highlights the conic under the cursor and shows the tangent segment to the nearest touching point.
- Arc tool: ghost arc with end markers; Shift snaps the sweep to multiples of 15°.

### 4.2 Dragging

- Drag a circle's centre or radius point: moves/reshapes as expected. Dragging the circle's outline when defined by `Circle(O, P)` moves both points (translates the circle).
- Drag a focus: the conic reshapes; labels stay with their foci (native frames).
- Drag a point defining a five-point conic: the conic follows; if kind changes, the badge shows it.
- Drag a `PointOn` along a conic: pointer projected with the previous parameter as hint; no jump across the conic's far side.
- Drag the sweep handle on an arc: a small handle at the arc end changes the `to` angle (it writes `to = angle` if the arc was defined by free numbers; otherwise it is not available).
- Dependent conics are not directly draggable.

### 4.3 Keyboard

As in `points-lines`, plus:
- With an arc selected: Left/Right change the sweep by 1° (15° with Shift) when the sweep is a free number.
- With a conic selected: `F` toggles the foci, `A` the axes, `D` the directrix, `S` the asymptotes (view toggles; they add no objects).

### 4.4 Screen-reader text

- Circle: "Circle c, centre (0, 0), radius 3."
- Arc: "Arc a of circle c from 0 degrees to 60 degrees, length 3.14."
- Sector: "Sector s, radius 3, 60 degrees, area 4.71."
- Ellipse: "Ellipse e, centre (0, 0), semi-major 5 along 0 degrees, semi-minor 4."
- Hyperbola: "Hyperbola h, centre (0, 0), transverse semi-axis 2."
- Parabola: "Parabola p, focus (0, 1), directrix y equals minus 1."
- Tangent list: "Two tangents from Q to circle c: t1 touches at (1.8, 0.9), t2 touches at (0.9, 1.8)."
- Undefined: "Ellipse e is undefined: the major axis 3 is not longer than the focus distance 4."
- Kind change: "Conic k became a parabola."

### 4.5 Touch

- Hit radius for conic outlines 16 px.
- Drag handles on arcs are 28 px.
- Long press on a conic: radial menu (rename, show definition, show foci/axes, equation form, delete).
- The ghost preview of a tool is offset above the finger.

## 5. Animation

- **Draw-in:** circles, arcs, conics draw themselves along their path over 300 ms (a circle starts at angle 0 counter-clockwise).
- **Compass mode (style `construct`):** a circle is drawn as a compass would: the radius segment sweeps through 360° over 1 second.
- **String mode (style `string`):** the ellipse construction shows a point moving round the conic with the two string segments, changing length but staying constant in sum; used by teachers with `Along(e, t / 8)`.
- **Tangent roll:** when a `PointOn` moves and a tangent depends on it, the tangent line is drawn with a faint trail (last 0.5 s) in 30% opacity so the envelope is visible.
- **Type-change badge** fades in 120 ms, out in 400 ms after 1.5 seconds.
- No tweening of geometry.

## 6. Properties panel

- Name, caption, style (stroke width, dash, colour, opacity, fill for sectors).
- Equation form: standard, general, parametric.
- Show: foci, vertices, axes, directrix, asymptotes, centre, definition overlay.
- Sector: show area label, show radii.
- Arc: show sweep dimension arc, show length.
- Label includes: name, equation, value.

Changes emit `with` lines (core design), for example `c with color = blue, width = 3`.

## 7. Differences from GeoGebra in one list

1. A definition overlay that shows the string or focus-directrix construction.
2. A visible badge when a conic changes kind and a halo near boundaries.
3. Numbered tangents on the figure.
4. Ghost previews that reject impossible ellipses with a reason.
5. Foci keep their labels through every drag.
6. Equations are shown in the form that matches the kind and the lesson.
7. Arc handles and keyboard sweep adjust.
8. Compass and string construction animations.
