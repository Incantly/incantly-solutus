# Curves, inequalities, loci and envelopes: what the learner sees and does

Reads with `design.md` and `docs/features/functions-calculus/ui.md` (views, palette, command line, keyboard, animation presets, reduced motion, screen-reader list). Only what is specific to this area is described here. Everything draws in the 2D graph view with output from `packages/plot`.

## 1. Default look

| Object | Default |
|---|---|
| Parametric and implicit curves | 2.5 px, round joins; sharp joins at marked cusps; colour from the shared palette |
| Curve start and end (open range) | Small 5 px end caps: filled dots when the range is closed, rings if the author wrote an open condition |
| Closed curves | Optional fill (`with fill = true`), 14% alpha of the stroke colour |
| Singular points and isolated points (implicit) | A 6 px dot in the curve colour; tangencies and crossings have no marker unless selected |
| Locus | 2.5 px, same as a curve; the mover `P` gets a "drag me" ring (dashed, 9 px) while a locus depends on it; the traced point `Q` is a 7 px dot of the locus colour |
| Envelope | 2.5 px curve; members (the lines the envelope touches) drawn faint (25% alpha, 1 px) at the current mover position only; with `with trail = true`, drawn at 30 evenly spaced mover positions |
| Region (inequality) | Fill 18% alpha; border 2 px; dashed border for strict signs (`<`, `>`), solid for `<=`, `>=` |
| Overlapping regions | Fills add in alpha (darker where several overlap); a toggle `with solid = true` fills with one flat colour and a hatch overlay for the second region so the overlap is visible without relying on darkness alone |
| One-variable predicate | Vertical bands across the full view height at 10% alpha, plus a thick bar on the x-axis with a ring at open ends and a filled dot at closed ends |
| `PointIn` point | Same dot as any free point; when dragged outside the region it slides along the nearest border; the region border pulses once |
| Tangent / normal on a curve | Same as for functions; the contact point is draggable (a `PointOn`) |
| Osculating circle | Thin (1.5 px) dashed circle, same hue as the curve; centre is a small cross; a line from the contact point to the centre shows the radius |
| Curvature vector | An arrow from the contact point; length scaled by the view so that it never exceeds 40 px; true length in the tooltip |
| Intersection points | 7 px dots, labelled with their coordinates on hover |

**Palette.** Shared with functions-calculus. Regions pick from the same palette with the fill alphas above; two regions in one figure get adjacent palette entries, not neighbours in hue. Loci use the colour of the object they trace (`Q`).

## 2. Drag and snap

### Dragging the mover

- The mover is any `PointOn` point (on a circle, segment, line, curve, spline, or locus). Dragging projects the pointer onto the path with the `closest` method from the design (§5, §6), using the previous parameter as the hint so the point glides and never hops across a loop of an implicit curve.
- On a **closed** path the point wraps (dragging past the end continues from the start). On an open path it stops at the end with a small elastic resistance.
- On an **implicit curve with several components** the point stays on its component. A modifier (Alt/Option, or a long press on touch followed by a drag) lets it jump to the nearest component.
- While a mover drags, the locus recomputes in `draft` quality; on release it settles to `final`. The settle is visually a refinement, not a jump: the polyline gets more samples between the same shape.
- The locus itself cannot be dragged. A tap on it selects it, and its definition appears.

### Snap

- Grid snap is optional (off by default). With snap on, a free point rounds to the grid when within 8 px of an intersection of grid lines.
- A mover can snap to **special parameters** of its path: ends, the midpoint, a quarter and the cusp/singular parameters of the curve, when within 8 px. Snap gives a gentle haptic tick on touch devices that support it.
- A free point near a curve or intersection within 10 px shows a magnet ring (the preview of where it would attach if the user holds Shift). Attaching writes `PointOn(c, P0)` or `Intersect(...)` as a visible line.

### Dragging a curve's defining points

- For `Bezier`, `Spline` and `Curve(pts)` the defining points are free points and are draggable; the curve updates live. Selected curves show handles at the points; tangent handles for Bezier appear on hover.
- For parametric ranges `in a..b`, selecting a curve shows two grips at the ends on the curve; dragging a grip changes `a` or `b` when they are free numbers (dimmed with a tooltip "a is computed from k" otherwise).

## 3. Keyboard

Same as the functions-calculus table, plus:

| Key | Action |
|---|---|
| `[` / `]` on a selected `PointOn` | Move the parameter by 1 % of its range (Shift = 10 %, Alt = 0.1 %) |
| `Home` / `End` | Go to the start or end of the path |
| `T` | Toggle trail of the selected locus (draw the family members, or the mover's trace) |
| `I` | Cycle through the intersection points of the selected curve with others |
| `Tab` on a region | Cycle through its corners (the vertices where two borders meet), reading their coordinates |

## 4. Tools

Every tool writes a line (core design principle). They appear as a small group in the toolbar:

| Tool | Gesture | Line written |
|---|---|---|
| Curve (parametric) | Click the tool, type the two formulas in a small bar with a range picker | `c(s) = (..., ...) in a..b` |
| Curve (equation) | Type an equation | `c(x, y) = lhs == rhs` |
| Region | Type conditions; the shaded preview updates while typing | `q(x, y) = ...` |
| Locus | Click the traced point `Q`, then the mover `P`. If `P` is not a mover, the tool offers to attach it to a path (click the path) | `loc = Locus(Q, P)` |
| Envelope | Click the family object, then the mover | `env = Envelope(L, P)` |
| Intersect | Click two curves | `X = Intersect(c1, c2)` |
| Tangent / Normal | Click a curve, click a point | `T = Tangent(c, s)`; the point is a `PointOn` |
| Osculating circle | Click a curve and a point | `O = OsculatingCircle(c, s)` |
| Spline/Bezier | Click to place points; double-click to finish | `S = Spline([...])`; the points become free points |
| Contour | Click a two-variable function; drag on the surface to choose the level | `k = Contour(g, level)` |

If the tool cannot proceed it shows the same `hint` as the error would (for example the "make P with PointOn" message) as an inline prompt.

## 5. Showing the process

### Locus trail

When a locus is selected, a **play** button moves the mover along its path (over 6 s by default, adjustable) with a faint trace of `Q`'s path being drawn, so the learner sees "this point makes that curve". The play is bound to the film clock in a film: the mover's `u` becomes `smooth(t / 6)` by an automatic line the author can see and edit (`P = PointOn(C, smooth(t / 6))`). Pressing play when not in a film writes nothing; it animates a preview.

### Envelope reveal

The members of the family appear one by one as the mover plays; the envelope curve stays faint until the member count passes a few dozen, then the envelope strokes in. Reduced motion: the envelope is shown at once with the members at 5 fixed positions.

### Region building

Typing `and` conditions one by one into the region tool shows each condition's half-region in its own colour at 12% alpha; pressing Enter merges them into the final region. The merge is a 300 ms cross-fade (none in reduced motion).

### Curvature

With the osculating circle selected, dragging the contact point moves the circle; the radius text shows in the figure list. At inflections the circle grows off-screen; the tooltip says "straight here".

## 6. Screen-reader text

The hidden list produces one sentence per object, generated from values:

- Parametric/implicit: "Curve c: ellipse-like closed curve, x from minus 2 to 2, y from minus 1 to 1. Crosses itself 0 times." The words "ellipse-like" appear only if the equation fits a conic; otherwise "closed curve" or "open curve".
- Region: "Region q: inside the circle of radius 2 centred at the origin, above the line y equals x. Area in view about 6.28."
- Locus: "Locus of Q as P moves along the circle: one closed curve, about 266 points, x from minus 6 to 6."
- Envelope: "Envelope of the ladder: one curve from (0.5, 4.97) to (4.9, 0.4)."
- Intersections: "Curves c1 and c2 meet in 2 points: (1.2, 0.5) and (−1.2, 0.5)."
- Warning: "Gap in the locus where P is between 0.31 and 0.69."
- Undefined: "Tangent T is undefined: the curve has a cusp here."

Arrow keys move the focus along the curve in steps of 5% of its range and speak `(x, y)` and the slope. `Enter` on a region reads its corners. Colour is never the only cue: borders are dashed or solid by strictness, regions can be hatched, and ends of intervals have rings or dots.

## 7. Touch

- One-finger drag on a mover moves it (hit radius 22 px); on empty space it pans.
- Two fingers pan/zoom; pinch zoom redraws curves in `draft` quality while moving and in `final` on release.
- A long press on a curve selects it and shows a tooltip with its definition; long press on a region shows its border definition(s).
- A double-tap on a curve opens its line for editing.
- Tool prompts (see §4) use large buttons; two-step tools (Locus) show which step is next in the prompt line.
- Handles are 44 px hit targets even if the visible dot is 7 px.

## 8. How GeoGebra presents this and what we change

GeoGebra shows curves as items in an algebra list with a style dialog for each; a locus is a drawn curve with no visible link to its mover except in the algebra list; envelope and locus equation produce curves or an equation in the list; inequalities are shaded regions with a boundary that is dashed or solid, with a few shape classes drawn and the rest silent. A locus is recomputed on every change of the construction, with a wall-clock allowance.

We change:

1. The mover is visibly marked (dashed ring) while a locus depends on it, and the trail can be played.
2. Draft and final quality: smooth dragging first, a refinement on release, never a timer.
3. All inequalities draw; borders show strictness and are visible on overlap with a non-darkening option.
4. Tools write visible lines; the toolbar prompts with the same hints as the error messages.
5. Curves in any representation share the same handles, snap and tooltip behaviour.
6. Special parameters (ends, midpoints, cusps) snap.
7. The screen-reader text describes curves and regions geometrically from values; the learner can navigate along a curve with arrow keys.

## 9. Sketches

### Locus with its mover

```text
   y ▲                                   toolbar:  ◉ Curve  ◎ Region  ⊙ Locus  ⊞ Envelope
     │            Q•                                                         
     │         ╱╲  ╱ ╲  ← locus of Q                   [P] mover ◌ (drag me)     
     │       ╱    ╳    ╲                               trail ▶  0:03 / 0:06
   ──┼──────●─────╱╲────────────▶ x
     │      P◌ (on the circle)
```

### Region with dashed and solid borders

```text
   y ▲        ╲  y = x   (dashed: y > x, strict)
     │     ╱‾‾‾╲╲
     │    │░░░░░░╲╲
     │    │░░░░░░░░╲        solid arc: x²+y² ≤ 4
     │    ╲░░░░░░░╱
   ──┼─────╲___╱───────────▶ x
```

### Overlap without relying on darkness

```text
   region A: fill 18% blue                 region B: fill 18% orange
   overlap:  solid mix + diagonal hatch     (with solid = true: flat colour per region)
```

### Envelope reveal

```text
   members faint, one per mover step:         envelope strokes in after ~30 members:
   │╲                                          │╲
   │ ╲  ╲                                      │ ╲___
   │  ╲  ╲  ╲                                  │     ‾‾‾‾╲
   └───────────────                            └───────────╲
```

## Sources studied

See `design.md`. Interaction ideas informed by how GeoGebra's drawables handle curves, inequalities and loci in `euclidian/draw/` and `euclidian/plot/` and by the manual pages `Inequalities`, `Locus`, `Envelope`, `Curves`.
